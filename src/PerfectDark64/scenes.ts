import * as UI from "../ui";
import * as Viewer from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { CalcBillboardFlags, calcBillboardMatrix, clamp, lerp, MathConstants, scaleMatrix, Vec3UnitY, Vec3Zero } from '../MathHelpers.js';
import { AABB } from "../Geometry";
import { GfxBlendFactor, GfxBlendMode, GfxDevice, GfxFormat, GfxMipFilterMode, GfxTexFilterMode, makeTextureDescriptor2D, GfxMegaStateDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { TextureLUT, parseTLUT, getTLUTSize, ImageFormat, ImageSize } from "../Common/N64/Image";
import { SceneContext } from "../SceneBase";
import { computeViewMatrixSkybox, CameraController } from '../Camera.js';
import { fillVec4, fillMatrix4x2, fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { hexzero0x } from "../util";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, opaqueBlackFullClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { setSortKeyDepth, makeSortKey, GfxRendererLayer, GfxRenderInst, GfxRenderInstList, gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder } from "../gfx/render/GfxRenderInstManager";
import { vec3, mat4, quat } from "gl-matrix";
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { drawWorldSpaceAABB, drawWorldSpaceLocator, drawScreenSpaceText, drawWorldSpaceText, getDebugOverlayCanvas2D } from '../DebugJunk'

import * as tex from "./tex";
import { Program } from "./shaders";
import { RoomBlockType, Block, BGSegment, Room} from "./bg";
import { PadFlag, Pad, Setup, loadPadsFromBinary } from "./setup";
import { Stage, StageID, stages } from "./stages";
import { toReadonlyVec3, Vertex, GFX, Segment, Mesh, Interpreter } from "./f3dex";
import { updateHarcodedHacks } from './hacks';

const pathBase = `PerfectDark64/`;

export class SceneRoom {
    public number: number;
    public pos: Vertex; // only used for xyz
    public bbox: AABB;
    public absoluteBBox: AABB;

    public opaque: Mesh[];
    public translucent: Mesh[];

    public constructor(props?:Partial<SceneRoom>) {
        Object.assign(this, props);

        this.name = hexzero0x(this.number, 4);
        // Room bboxes are in their own origin space, we'll need them in world space.
        this.absoluteBBox = this.bbox.clone();
        this.absoluteBBox.offset(this.absoluteBBox, toReadonlyVec3(this.pos));
    }

    // UI.Layer
    public name: string;
    public visible: boolean = true;
    public setVisible(v: boolean): void {
        this.visible = v;
    }
}

class Scene implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;

    private renderInstListSky = new GfxRenderInstList();
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListXLU = new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards);
    private rooms: Map<number, SceneRoom>;
    private skyColor = standardFullClearRenderPassDescriptor;

    private shouldEnableHardcodedHacks: boolean = true;
    private shouldDisplayRoomIDs: boolean = false;
    private shouldDisplayPadBoundingBoxes: boolean = false;
    private shouldEnableTextures: boolean = true;
    private shouldRenderSkybox: boolean = true;
    private shouldRenderOpaque: boolean = true;
    private shouldRenderTranslucent: boolean = true;

    constructor(
        device: GfxDevice,
        public textureHolder: tex.TextureListHolder,
        private stage: Stage,
        seg: BGSegment,
        private setup: Setup,
        private pads: Pad[],
    ) {
        this.renderHelper = new GfxRenderHelper(device);
        this.skyColor = makeAttachmentClearDescriptor(stage.skyColor);
        this.rooms = this.buildSceneRooms(device, seg);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.25);
    }

    public getDefaultWorldMatrix(dst: mat4) {
        if (this.setup.spawn === undefined) {
            console.warn("level setup had no spawn position");
            return;
        }

        const pos = vec3.clone(this.setup.spawn.pos);
        pos[1] += 64; // arbitrary height

        const target = vec3.create();
        vec3.add(target, pos, this.setup.spawn.look);

        mat4.targetTo(dst, pos, target, this.setup.spawn.up);
    }

    private createProgram(mesh: Mesh): Program {
        const ret = new Program(
            mesh.DP_Combine,
            mesh.SP_GeometryMode,
            mesh.DP_OtherModeL,
            mesh.DP_OtherModeH,
        );

        if (this.shouldEnableTextures) {
            ret.defines.set('ENABLE_TEXTURES', '1');
        }

        return ret;
    }

    private buildSceneRooms(device: GfxDevice, seg: BGSegment): Map<number, SceneRoom> {
        const ret: Map<number, SceneRoom> = new Map();

        seg.rooms.forEach(room => {
            const opaque = this.buildBlockTree(device, room, room.opaqueRoot);
            opaque.forEach(v => v.sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE));
            const translucent = this.buildBlockTree(device, room, room.translucentRoot);
            translucent.forEach(v => v.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT));

            ret.set(room.number, new SceneRoom({
                number: room.number,
                pos: room.pos,
                bbox: new AABB( // did not survive serialization
                    room.bbox.min[0],
                    room.bbox.min[1],
                    room.bbox.min[2],
                    room.bbox.max[0],
                    room.bbox.max[1],
                    room.bbox.max[2],
                ),
                opaque: opaque,
                translucent: translucent,
            }));
        });

        return ret;
    }

    private buildBlockTree(device: GfxDevice, room: Room, rootIndex: number | undefined): Mesh[] {
        if (rootIndex === undefined) {
            return [];
        }

        const interpreter = new Interpreter(this.textureHolder);
        interpreter.setSegmentVertices(Segment.BGVtx, room.vertices);
        interpreter.setSegmentColors(Segment.BGCol, room.colors);
        let block: Block | undefined = room.blocks[rootIndex];

        while (block !== undefined) {
            block.gdls.forEach(gdl => {
                interpreter.processGFX(new GFX(
                    gdl.w0,
                    gdl.w1,
                ));
            });

            if (block.type === RoomBlockType.Leaf) {
                block = room.blockAtOffset(block.nextPtr);
            } else if (block.type === RoomBlockType.Parent) {
                block = room.blockAtOffset(block.childPtr);
            }
        }

        return interpreter.build(device, this.renderHelper.renderCache);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.skyColor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.handleHacksAndRoomIDs(viewerInput);
        this.updateTextureGenLookAt(viewerInput.camera.viewMatrix);

        this.renderSkybox(viewerInput);
        this.renderSceneRooms(this.rooms, viewerInput);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');

        builder.pushPass(pass => {
            pass.setDebugName("Skybox");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec(passRenderer => {
                this.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        builder.pushPass(pass => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec(passRenderer => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        builder.pushPass(pass => {
            pass.setDebugName("Translucent");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec(passRenderer => {
                this.renderInstListXLU.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.renderHelper.prepareToRender();
        builder.execute();
        this.renderInstListXLU.reset();
        this.renderInstListMain.reset();
        this.renderInstListSky.reset();
    }

    private handleHacksAndRoomIDs(viewerInput: Viewer.ViewerRenderInput): void {
        let cameraPos = vec3.create();
        cameraPos = vec3.transformMat4(cameraPos, vec3.create(), viewerInput.camera.worldMatrix);
        let currentRoom = 0x00;
        this.rooms.forEach(room => {
            if (room.absoluteBBox.containsPoint(cameraPos)) {
                currentRoom = room.number;
            }
        });
        if (this.shouldEnableHardcodedHacks) {
            updateHarcodedHacks(cameraPos, currentRoom, this.stage.id, this.rooms);
        }

        if (this.shouldDisplayRoomIDs) {
            drawScreenSpaceText(
                getDebugOverlayCanvas2D(),
                50, 50,
                [
                    cameraPos[0].toFixed(2),
                    cameraPos[1].toFixed(2),
                    cameraPos[2].toFixed(2),
                    hexzero0x(currentRoom || 0, 2),
                ].join(', '),
            );
        }

        if (this.shouldDisplayPadBoundingBoxes) {
            this.pads.forEach(pad => {
                const scratch = pad.bbox.clone();
                scratch.offset(scratch, pad.pos);

                if (pad.flags & PadFlag.HASBBOXDATA) {
                    drawWorldSpaceAABB(
                        getDebugOverlayCanvas2D(),
                        viewerInput.camera.clipFromWorldMatrix,
                        scratch
                    );
                } else {
                    drawWorldSpaceLocator(
                        getDebugOverlayCanvas2D(),
                        viewerInput.camera.clipFromWorldMatrix,
                        pad.pos,
                    );
                }
            });
        }
    }

    private renderSkybox(viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.shouldRenderSkybox) {
            return
        }

        if (this.stage.skyRoom === 0x00) {
            return;
        }

        const skyRoom = this.rooms.get(this.stage.skyRoom);
        if (skyRoom === undefined) {
            return;
        }

        skyRoom.opaque.forEach(v => v.isSkybox = true);
        skyRoom.translucent.forEach(v => v.isSkybox = true);

        this.renderSceneRoom(skyRoom, viewerInput, true).forEach(inst => {
            if (inst.getDrawCount() > 0) {
                this.renderInstListSky.submitRenderInst(inst);
            }
        });

        this.renderSceneRoom(skyRoom, viewerInput, false).forEach(inst => {
            if (inst.getDrawCount() > 0) {
                this.renderInstListSky.submitRenderInst(inst);
            }
        });
    }

    private renderSceneRooms(rooms: Map<number, SceneRoom>, viewerInput: Viewer.ViewerRenderInput): void {
        rooms.forEach(room => {
            if (room.number === this.stage.skyRoom) {
                return;
            }

            if (!room.visible) {
                return;
            }

            if (!viewerInput.camera.frustum.contains(room.absoluteBBox)) {
                return;
            }

            if (this.shouldDisplayRoomIDs) {
                const center = vec3.create();
                room.absoluteBBox.centerPoint(center);
                drawWorldSpaceText(
                    getDebugOverlayCanvas2D(),
                    viewerInput.camera.clipFromWorldMatrix,
                    center,
                    hexzero0x(room.number, 4),
                );
            }

            this.renderSceneRoom(room, viewerInput, true).forEach(inst => {
                // FIXME: Some rooms are empty. Maybe cull those before rendering.
                if (inst.getDrawCount() > 0) {
                    this.renderInstListMain.submitRenderInst(inst);
                }
            });

            this.renderSceneRoom(room, viewerInput, false).forEach(inst => {
                // FIXME: Some rooms are empty. Maybe cull those before rendering.
                if (inst.getDrawCount() > 0) {
                    this.renderInstListXLU.submitRenderInst(inst);
                }
            });
        });
    }

    private renderSceneRoom(room: SceneRoom, viewerInput: Viewer.ViewerRenderInput , opaque: boolean): GfxRenderInst[] {
        const ret: GfxRenderInst[] = [];

        if (opaque && this.shouldRenderOpaque) {
            room.opaque.forEach(mesh => {
                ret.push(this.renderMesh(mesh, room.pos, viewerInput, opaque));
            });
        }
        if (!opaque && this.shouldRenderTranslucent) {
            room.translucent.forEach(mesh => {
                ret.push(this.renderMesh(mesh, room.pos, viewerInput, opaque));
            });
        }

        return ret;
    }

    private renderMesh(
        mesh: Mesh,
        pos:Vertex,
        viewerInput: Viewer.ViewerRenderInput,
        opaque: boolean,
    ): GfxRenderInst {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{
            numSamplers: 2,
            numUniformBuffers: 3,
        }]);

        this.setSceneParams(template, mesh, pos, viewerInput);
        this.setDrawParams(template, mesh, opaque);
        this.setCombineParams(template, mesh);

        if (mesh.gfxProgram === null) {
            mesh.gfxProgram = this.renderHelper.renderCache.createProgram(
                this.createProgram(mesh),
            );
        }

        const sampler = this.renderHelper.renderCache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: mesh.wrapS,
            wrapT: mesh.wrapT,
        });

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setGfxProgram(mesh.gfxProgram);
        renderInst.setSamplerBindings(0, [
            {
                gfxTexture: mesh.texture,
                gfxSampler: sampler,
            },
            {
                gfxTexture: mesh.texture,
                gfxSampler: sampler,
            },
        ]);

        renderInst.setVertexInput(
            mesh.inputLayout,
            [{ buffer: mesh.vertexBuffer, byteOffset: 0 }],
            { buffer: mesh.indexBuffer, byteOffset: 0 },
        );

        renderInst.setDrawCount(mesh.indexCount);

        const megaStateFlags: Partial<GfxMegaStateDescriptor> = {
            cullMode: mesh.cullMode,
        };
        megaStateFlags.depthWrite = opaque;

        const camPos = vec3.create();
        mat4.getTranslation(camPos, viewerInput.camera.worldMatrix);

        const centerPoint = vec3.create();
        mesh.aabb.centerPoint(centerPoint);
        vec3.add(centerPoint, centerPoint, toReadonlyVec3(pos));

        template.sortKey = setSortKeyDepth(
            mesh.sortKeyBase,
            vec3.distance(camPos, centerPoint),
        );

        setAttachmentStateSimple(megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        renderInst.setMegaStateFlags(megaStateFlags);

        this.renderHelper.renderInstManager.popTemplate();

        return renderInst;
    }

    private setSceneParams(
        template: GfxRenderInst,
        mesh: Mesh,
        pos:Vertex,
        viewerInput: Viewer.ViewerRenderInput,
    ): void {
        const data = template.allocateUniformBufferF32(Program.ub_SceneParams, (4*4) + (3*4) + (2*2*4));
        let offs = 0;

        if (mesh.isSkybox) {
            const skyProj = mat4.create();
            computeViewMatrixSkybox(skyProj, viewerInput.camera);
            mat4.mul(skyProj, viewerInput.camera.projectionMatrix, skyProj);
            offs += fillMatrix4x4(data, offs, skyProj);
        } else {
            offs += fillMatrix4x4(data, offs, viewerInput.camera.clipFromWorldMatrix);
        }
        const mat = mat4.create();
        mat4.translate(mat, mat, [pos.x, pos.y, pos.z]);
        offs += fillMatrix4x3(data, offs, mat);

        offs += fillVec4(data, offs, this.textureGenLookAt[0], this.textureGenLookAt[4], this.textureGenLookAt[8]);
        offs += fillVec4(data, offs, this.textureGenLookAt[1], this.textureGenLookAt[5], this.textureGenLookAt[9]); // eslint-disable-line
    }

    // G_TEXTURE_GEN lookat vectors, should only move with camera rotation, not position.
    private textureGenLookAt = mat4.create();
    private updateTextureGenLookAt(viewMatrix: mat4) {
        const rot = quat.create();
        mat4.getRotation(rot, viewMatrix);
        mat4.fromRotationTranslation(this.textureGenLookAt, rot, vec3.create());
    }

    private setDrawParams(
        template: GfxRenderInst,
        mesh: Mesh,
        opaque: boolean,
    ): void {
        const data = template.allocateUniformBufferF32(Program.ub_DrawParams, (2*2*4) + 4);
        let offs = 0;
        offs += fillMatrix4x2(data, offs, mesh.texMatrix);
        offs += fillMatrix4x2(data, offs, mesh.texMatrix); // TODO second tex

        data[offs++] = +(mesh.texture !== null);
        data[offs++] = opaque ? 1.0 : 0.0; // eslint-disable-line
    }

    private setCombineParams(
        template: GfxRenderInst,
        mesh: Mesh,
    ): void {
        const data = template.allocateUniformBufferF32(Program.ub_CombineParams, 8);
        let offs = 0;
        offs += fillVec4(data, offs, 1, 1, 1, 1); // SETPRIMCOLOR is never called.
        // eslint-disable-next-line
        offs += fillVec4(data, offs, mesh.DP_EnvColor[0], mesh.DP_EnvColor[1], mesh.DP_EnvColor[2], mesh.DP_EnvColor[3]);
    }

    public destroy(device: GfxDevice): void {
        this.rooms.forEach(room => {
            if (room.opaque !== undefined) {
                room.opaque.forEach(v => v.destroy(device));
            }
            if (room.translucent !== undefined) {
                room.translucent.forEach(v => v.destroy(device));
            }
        });

        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
    }

    public createPanels(): UI.Panel[] {
        return [
            new UI.LayerPanel(Array.from(this.rooms.values())),
            this.createRenderHacksPanel(),
        ];
    }

    private createRenderHacksPanel(): UI.Panel {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.RENDER_HACKS_ICON, 'Render Settings');

        const enableHardcodedHacks = new UI.Checkbox('Enable hardcoded room display checks', this.shouldEnableHardcodedHacks);
        enableHardcodedHacks.onchanged = () => {
            this.shouldEnableHardcodedHacks = enableHardcodedHacks.checked;
            if (!this.shouldEnableHardcodedHacks) {
                this.rooms.forEach(v => v.setVisible(true));
            }
        };
        panel.contents.appendChild(enableHardcodedHacks.elem);

        const displayRoomIDs = new UI.Checkbox('Display Room IDs', this.shouldDisplayRoomIDs);
        displayRoomIDs.onchanged = () => {
            this.shouldDisplayRoomIDs = displayRoomIDs.checked;
        };
        panel.contents.appendChild(displayRoomIDs.elem);

        const displayPadBoundingBoxes = new UI.Checkbox('Display pads origins/bboxes', this.shouldDisplayPadBoundingBoxes);
        displayPadBoundingBoxes.onchanged = () => {
            this.shouldDisplayPadBoundingBoxes = displayPadBoundingBoxes.checked;
        };
        panel.contents.appendChild(displayPadBoundingBoxes.elem);

        const enableTexturesCheckbox = new UI.Checkbox('Enable textures', this.shouldEnableTextures);
        enableTexturesCheckbox.onchanged = () => {
            this.shouldEnableTextures = enableTexturesCheckbox.checked;
            this.clearPrograms();
        };
        panel.contents.appendChild(enableTexturesCheckbox.elem);

        const renderSkyboxCheckbox = new UI.Checkbox('Render skybox ', this.shouldRenderSkybox);
        renderSkyboxCheckbox.onchanged = () => {
            this.shouldRenderSkybox = renderSkyboxCheckbox.checked;
        };
        panel.contents.appendChild(renderSkyboxCheckbox.elem);

        const renderOpaqueCheckbox = new UI.Checkbox('Render opaque blocks', this.shouldRenderOpaque);
        renderOpaqueCheckbox.onchanged = () => {
            this.shouldRenderOpaque = renderOpaqueCheckbox.checked;
        };
        panel.contents.appendChild(renderOpaqueCheckbox.elem);

        const renderTranslucentCheckbox = new UI.Checkbox('Render translucent blocks', this.shouldRenderTranslucent);
        renderTranslucentCheckbox.onchanged = () => {
            this.shouldRenderTranslucent = renderTranslucentCheckbox.checked;
        };
        panel.contents.appendChild(renderTranslucentCheckbox.elem);

        return panel;
    }

    private clearPrograms(): void {
        this.rooms.forEach(room => {
            room.opaque.forEach(mesh => mesh.gfxProgram = null);
            room.translucent.forEach(mesh => mesh.gfxProgram = null);
        });
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(
        public id: string,
        public stageID: StageID,
        public name: string,
    ) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<Viewer.SceneGfx> {
        const stage: Stage|undefined = stages.find(v => v.id === this.stageID);
        if (stage === undefined) {
            throw new Error(`StageID ${hexzero0x(this.stageID, 2)} not found`);
        }

        const bgJSON = sceneContext.dataFetcher.fetchData([pathBase, stage.bgPath, ".json"].join(""));
        const setupBin = sceneContext.dataFetcher.fetchData([pathBase, "setups/", stage.setupPath].join(""));
        const padsBin = sceneContext.dataFetcher.fetchData([pathBase, stage.padsPath].join(""));

        console.groupCollapsed('loadViewerTextures');
        const textureHolder = await loadViewerTextures(sceneContext, device);
        console.groupEnd();

        const pads = loadPadsFromBinary(await padsBin);

        return new Scene(
            device,
            textureHolder,
            stage,
            BGSegment.fromJSON(await bgJSON),
            Setup.fromBinary(await setupBin, pads),
            pads,
        );
    }
}

async function loadViewerTextures(sceneContext: SceneContext, device: GfxDevice): Promise<tex.TextureListHolder> {
    const binPromise = sceneContext.dataFetcher.fetchData(pathBase + "textures.bin");
    const metaJSON = await sceneContext.dataFetcher.fetchData(pathBase + "textures.json");
    const meta = JSON.parse(new TextDecoder().decode(metaJSON.arrayBuffer)) as tex.InflatedTexture[];
    const bin = await binPromise;

    const viewerTextures = meta.map(texture => {
        const lut = new Uint8Array(4 * texture.numColors);
        if (texture.numColors > 0) {
            const originalPalData = bin.subarray(texture.palOffset, texture.palSize).createDataView();
            const palData = new Uint8Array(getTLUTSize(texture.imageSize) * 2);
            for (let i = 0; i < texture.palSize; i++) {
                palData[i] = originalPalData.getUint8(i);
            }

            parseTLUT(lut, ArrayBufferSlice.fromView(palData).createDataView(), 0, texture.imageSize, texture.lutMode);
        }

        let decoded: Uint8Array;
        try {
            const preprocessed = tex.preprocessTexture(texture, bin.subarray(texture.offset, texture.size));
            if (preprocessed === null) {
                return {gfxTexture: null, extraInfo: null};
            }

            decoded = tex.decodeTexture(texture, preprocessed, lut);
        } catch (e) {
            console.error("exception during decoding of texture", hexzero0x(texture.index, 4), e);
            return { gfxTexture: null, extraInfo: null };
        }

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(
            GfxFormat.U8_RGBA_NORM,
            texture.width, texture.height,
            1,
        ));
        device.setResourceName(gfxTexture, hexzero0x(texture.index, 4));
        device.uploadTextureData(gfxTexture, 0, [decoded]);

        const extraInfo: Map<string, string> = new Map();

        extraInfo.set("Compression", tex.CompressionMethod[texture.compressionMethod]);
        extraInfo.set("Format", tex.Format[texture.format]);
        extraInfo.set("Has LODs", "" + texture.hasLOD);
        extraInfo.set("LOD count", "" + texture.numLODs);
        extraInfo.set("Image format", ImageFormat[texture.imageFormat]);
        extraInfo.set("Image size", ImageSize[texture.imageSize]);
        extraInfo.set("LUT mode", TextureLUT[texture.lutMode]);
        if (texture.lutMode !== TextureLUT.G_TT_NONE) {
            extraInfo.set("Palette size", "" + texture.numColors);
        }

        return { gfxTexture, extraInfo };
    }).filter(v => v.gfxTexture !== null);

    return new tex.TextureListHolder(viewerTextures, meta);
}

export const sceneGroup: Viewer.SceneGroup = {
    id: "PerfectDark64",
    name: "Perfect Dark",

    // FIXME: Only background geometry is loaded for now so missions that reuse
    // BGs and only differ by pads/setups are strict duplicates.
    // There are a bunch of test maps leftovers but they're all the same two
    // planes, not worth including.
    sceneDescs: [
        "Mission 1",
        new SceneDesc("mission_01_01", StageID.Defection, "dataDyne Central - Defection"),
        new SceneDesc("mission_01_02", StageID.Investigation, "dataDyne Research - Investigation"),
        new SceneDesc("mission_01_03", StageID.Extraction, "dataDyne Central - Extraction"),
        "Mission 2",
        new SceneDesc("mission_02_01", StageID.Villa, "Carrington Villa - Hostage One"),
        "Mission 3",
        new SceneDesc("mission_03_01", StageID.Chicago, "Chicago - Stealth"),
        new SceneDesc("mission_03_02", StageID.G5Building, "G5 Building - Reconnaissance"),
        "Mission 4",
        new SceneDesc("mission_04_01", StageID.Infiltration, "Area 51 - Infiltration"),
        new SceneDesc("mission_04_02", StageID.Rescue, "Area 51 - Rescue"),
        new SceneDesc("mission_04_03", StageID.Escape, "Area 51 - Escape"),
        "Mission 5",
        new SceneDesc("mission_05_01", StageID.AirBase, "Air Base - Espionage"),
        new SceneDesc("mission_05_02", StageID.AirForceOne, "Air Force One - Antiterrorism"),
        new SceneDesc("mission_05_03", StageID.CrashSite, "Crash Site - Confrontation"),
        "Mission 6",
        new SceneDesc("mission_06_01", StageID.Pelagic, "Pelagic II - Exploration"),
        new SceneDesc("mission_06_02", StageID.DeepSea, "Deep Sea - Nullify Threat"),
        "Mission 7",
        new SceneDesc("mission_07_01", StageID.Defense, "Carrington Institute - Defense"),
        "Mission 8",
        new SceneDesc("mission_08_01", StageID.AttackShip, "Attack Ship - Covert Assault"),
        "Mission 9",
        new SceneDesc("mission_09_01", StageID.SkedarRuins, "Skedar Ruins - Battle Shrine"),
        "Special Assignments",
        new SceneDesc("mission_10_01", StageID.MisterBlondesRevenge, "Mr. Blonde's Revenge"),
        new SceneDesc("mission_10_02", StageID.MaianSOS, "Maian SOS"),
        new SceneDesc("mission_10_03", StageID.War, "WAR!"),
        new SceneDesc("mission_10_04", StageID.Duel, "The Duel"),

        "Multiplayer - Dark",
         new SceneDesc("mp_mp3",  StageID.MPArea52, "Area 52"),
         new SceneDesc("mp_mp1",  StageID.MPBase, "Base"),
         new SceneDesc("mp_mp5",  StageID.MPCarPark, "Car Park"),
         new SceneDesc("mp_mp12", StageID.MPFortress, "Fortress"),
         new SceneDesc("mp_cryp", StageID.MPG5Building, "G5 Building"),
         new SceneDesc("mp_mp15", StageID.MPGrid, "Grid"),
         new SceneDesc("mp_crad", StageID.MPPipes, "Pipes"),
         new SceneDesc("mp_arec", StageID.MPRavine, "Ravine"),
         new SceneDesc("mp_mp9",  StageID.MPRuins, "Ruins"),
         new SceneDesc("mp_mp10", StageID.MPSewers, "Sewers"),
         new SceneDesc("mp_oat",  StageID.MPSkedar, "Skedar"),
         new SceneDesc("mp_mp13", StageID.MPVilla, "Villa"),
         new SceneDesc("mp_mp4",  StageID.MPWarehouse, "Warehouse"),

        "Multiplayer - Classic",
        new SceneDesc("mp_ref",  StageID.MPComplex,  "Complex"),
        new SceneDesc("mp_mp11", StageID.MPFelicity, "Felicity"),
        new SceneDesc("mp_jun",  StageID.MPTemple,   "Temple"),
    ],

    // WIP
    hidden: !IS_DEVELOPMENT,
};
