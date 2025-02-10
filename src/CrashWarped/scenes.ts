
import { GfxBindingLayoutDescriptor, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { FakeTextureHolder } from "../TextureHolder.js";
import { assertExists, hexzero, nArray } from "../util.js";
import { SceneGfx, Texture, ViewerRenderInput } from "../viewer.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { fillMatrix4x4, fillVec3v } from "../gfx/helpers/UniformBufferHelpers.js";
import { mat4, vec3 } from "gl-matrix";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { Blue, Color, Cyan, Green, Magenta, OpaqueBlack, Red, Yellow } from "../Color.js";
import { CameraController } from "../Camera.js";

import * as BIN from "./bin.js";
import * as SCRIPT from "./script.js";
import { TextureData, ModelData, AnyGFXData, QuadListData, renderWorldMesh, TextureAnimator, WaterMeshData, TerrainMeshData, RenderGlobals, renderSprite } from "./render.js";
import * as UI from "../ui.js";
import { getMatrixAxisX, getMatrixAxisZ } from "../MathHelpers.js";
const pathBase = `CrashWarped`;

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 2 }];

const myColors: Color[] = [
    Magenta,
    Yellow,
    Cyan,
    Green,
    OpaqueBlack,
    Blue,
];

interface BasicMesh {
    data: ModelData;
    pos: vec3;
    isSkybox: boolean;
    visible: boolean;
}

const scr = nArray(2, () => vec3.create());
const scrMatrix = mat4.create();
class WarpedRenderer implements SceneGfx {
    public textureHolder: FakeTextureHolder;

    public textureData: TextureData[] = [];
    public modelData: AnyGFXData[] = [];
    public worldParts: BasicMesh[] = [];
    public pointClouds: Map<string, BIN.WGEO>;
    private lightDirection = mat4.create();
    public currPts = "";
    public data: BIN.LevelData;
    public waterMesh: WaterMeshData | null = null;
    public terrainMesh: TerrainMeshData | null = null;
    private drawDebug = 0;

    public state: SCRIPT.GameState;
    public globals: RenderGlobals;

    constructor(context: SceneContext, level: BIN.LevelData, id: number) {
        this.textureHolder = new FakeTextureHolder([]);
        this.state = new SCRIPT.GameState(id, level);
        this.globals = new RenderGlobals(context.device, this.textureData, this.modelData)
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(.3);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColors = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColors.onchanged = () => {
            for (let i = 0; i < this.globals.meshData.length; i++)
                this.globals.meshData[i].setVertexColorsEnabled(enableVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColors.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.globals.meshData.length; i++)
                this.globals.meshData[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const retroMode = new UI.Checkbox('Retro Mode', false);
        retroMode.onchanged = () => {
            for (let i = 0; i < this.globals.meshData.length; i++)
                this.globals.meshData[i].setRetroMode(retroMode.checked);
        };
        renderHacksPanel.contents.appendChild(retroMode.elem);
        return [renderHacksPanel];
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const builder = this.globals.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.globals.renderInstListSkybox.drawOnPassRenderer(this.globals.renderHelper.renderCache, passRenderer);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.globals.renderInstListMain.drawOnPassRenderer(this.globals.renderHelper.renderCache, passRenderer);
            });
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);


        this.prepareToRender(device, viewerInput);
        this.globals.renderHelper.renderGraph.execute(builder);
        this.globals.renderInstListMain.reset();
        this.globals.renderInstListSkybox.reset();
    }

    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const template = this.globals.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(0, 16 + 2*4);
        const sceneParamsMapped = template.mapUniformBufferF32(0);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        let camOffset = viewerInput.camera.worldMatrix[12] + viewerInput.camera.worldMatrix[14];
        getMatrixAxisX(scr[0], viewerInput.camera.viewMatrix);
        offs += fillVec3v(sceneParamsMapped, offs, scr[0], this.state.frame);
        getMatrixAxisZ(scr[0], viewerInput.camera.viewMatrix);
        offs += fillVec3v(sceneParamsMapped, offs, scr[0], camOffset);

        SCRIPT.updateState(this.state, viewerInput);

        this.state.root.tryUpdateSelfAndChildren(this.state);

        for (let i = 0; i < this.worldParts.length; i++) {
            if (this.worldParts[i].visible)
                renderWorldMesh(this.globals, viewerInput, this.worldParts[i].data, this.worldParts[i].pos, this.worldParts[i].isSkybox);
        }
        for (let i = 0; i < this.state.objects.length; i++) {
            if (!this.state.objects[i])
                continue;
            this.state.objects[i].prepareToRender(this.globals, viewerInput, this.state);
        }

        this.globals.setCurrentList(false);
        if (this.waterMesh) {
            this.waterMesh.prepareToRender(this.globals.renderHelper.renderInstManager, viewerInput, this.state.frame, this.textureData);
        }
        if (this.terrainMesh)
            this.terrainMesh.prepareToRender(this.globals.renderHelper.renderInstManager, viewerInput, this.textureData);

        if (this.data.jetski?.buoys) {
            const buoys = this.data.jetski.buoys;
            for (let color = 0; color < buoys.coords.length; color++) {
                const pos = buoys.coords[color];
                for (let i = 0; i < pos.length; i += 2) {
                    const x = pos[i];
                    const z = pos[i+1];
                    vec3.set(scr[0], x * 64, this.state.waterHeight(x, z), z * 64);
                    mat4.fromTranslation(scrMatrix, scr[0]);
                    const frame = buoys.buoyUVs[(x + z + (this.state.frame >> 1)) % (buoys.buoyUVs.length - 1)];
                    vec3.set(scr[0], .5, color === 0 ? .15625 : .5, .15625);
                    renderSprite(this.globals, viewerInput, scrMatrix, true, frame, 0x2E, scr[0]);
                }
            }
        }

        this.globals.renderHelper.renderInstManager.popTemplate();
        this.globals.renderHelper.prepareToRender();

        if (this.drawDebug) {
            const canvas = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.data.checkpoints.length; i++)
                drawWorldSpacePoint(canvas, viewerInput.camera.clipFromWorldMatrix, this.data.checkpoints[i].position);

            for (let i = 0; i < this.state.objects.length; i++) {
                const obj = this.state.objects[i];
                if (!obj || (this.drawDebug === 1 && !obj.original) || (this.drawDebug === 2 && !obj.alive) || vec3.dist(obj.pos, this.state.player.pos) > 2000)
                    continue;
                drawWorldSpacePoint(canvas, viewerInput.camera.clipFromWorldMatrix, obj.pos, Green);
                let id = (this.drawDebug === 1) ? obj.placement.id : obj.id;
                drawWorldSpaceText(canvas, viewerInput.camera.clipFromWorldMatrix, obj.pos, `${i} ${obj.behavior.name}=${obj.behavior.index.toString(16)}:${id.toString(16)}`, (id % 5) * 10, Green);
                if (this.drawDebug === 1) {
                    const path = obj.placement.path;
                    if (path.length > 1)
                        for (let i = 0; i < path.length - 1; i++) {
                            vec3.scale(scr[0], path[i], 1 / 0x1000);
                            vec3.scale(scr[1], path[i + 1], 1 / 0x1000);
                            drawWorldSpaceLine(canvas, viewerInput.camera.clipFromWorldMatrix, scr[0], scr[1]);
                        }
                }
            }
        }
    }

    public destroy(device: GfxDevice): void {
        this.globals.renderHelper.destroy();
        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        this.textureHolder.destroy(device);
    }
}

class CrashWarpedScene implements SceneDesc {
    public id: string;

    constructor(public index: number, public name: string = index.toString(16)) {
        this.id = index.toString(16);
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const folder = (this.index / 0x10) >>> 0;
        const subpath = `S${folder.toString()}/S00000${hexzero(this.index, 2)}`;
        const levelIndex = await context.dataFetcher.fetchData(`${pathBase}/${subpath}.NSD`);
        const levelData = await context.dataFetcher.fetchData(`${pathBase}/${subpath}.NSF`);
        const pre = Date.now();
        const parsed = BIN.parse(levelIndex, levelData);

        console.log(Date.now() - pre, parsed);
        const renderer = new WarpedRenderer(context, parsed, this.index);
        SCRIPT.CrashObject.allDBs = parsed.allDBs;

        for (let tex of parsed.textures) {
            const data = new TextureData(device, tex);
            renderer.textureData.push(data);
            renderer.textureHolder.viewerTextures.push(data.viewerTexture);
        }

        renderer.textureHolder.viewerTextures.sort((a: Texture, b: Texture) => a.name.localeCompare(b.name));
        QuadListData.textureAnimator = new TextureAnimator([], [], [], renderer.textureData);

        const cache = renderer.globals.renderHelper.renderCache;
        for (let gool of parsed.behaviors.values()) {
            for (let model of gool.models.values()) {
                let data: AnyGFXData;
                if (model.kind === BIN.ModelType.MESH && model.mesh)
                    data = ModelData.fromTGEO(device, cache, model, renderer.textureData);
                else if (model.kind === BIN.ModelType.QUAD_LIST && model.data)
                    data = new QuadListData(device, cache, model);
                else
                    continue;
                model.modelIndex = renderer.modelData.length;
                renderer.modelData.push(data!);
            }
        }

        for (let wgeo of parsed.wgeos) {
            const data = ModelData.fromWGEO(device, cache, this.index, wgeo, renderer.textureData);
            renderer.modelData.push(data);
            renderer.worldParts.push({ data, pos: wgeo.origin, isSkybox: wgeo.isSkybox, visible: true });
        }

        for (let val of parsed.zdats.values())
            for (let place of val.objects) {
                const gool = assertExists(parsed.behaviors.get(place.file));
                const objData = gool.objectIndices[place.id];
                if (objData === undefined)
                    continue;
                if (gool.objectIndices[place.id] === 255) {
                    continue;
                }
                SCRIPT.CrashObject.fromPlacement(place, gool, renderer.state);
            }

        if (parsed.jetski) {
            renderer.waterMesh = new WaterMeshData(device, cache,
                !parsed.jetski.buoys,
                parsed.jetski.vertexData,
                parsed.jetski.indexData,
                parsed.jetski.waterUV,
                parsed.jetski.waveTextures
            );
        }

        if (parsed.terrain) {
            renderer.terrainMesh = new TerrainMeshData(device, cache,
                parsed.terrain.vertexData,
                parsed.terrain.indexData,
                parsed.terrain.terrainIndex,
                parsed.terrain.drawCalls,
            );
        }

        renderer.data = parsed;
        return renderer;
    }
}

export const id = 'CrashWarped';
export const name = "Crash Bandicoot: Warped";
export const sceneDescs = [
    "Hub",
    new CrashWarpedScene(0x3C, "Title Screen"),
    new CrashWarpedScene(0x02, "Hub"),
    "Medieval Room",
    new CrashWarpedScene(0x0B, "Toad Village"),
    new CrashWarpedScene(0x0E, "Under Pressure"),
    new CrashWarpedScene(0x0A, "Orient Express"),
    new CrashWarpedScene(0x0C, "Bone Yard"),
    new CrashWarpedScene(0x19, "Makin' Waves"),
    new CrashWarpedScene(0x06, "Tiny Tiger"),
    "Arabian Room",
    new CrashWarpedScene(0x0F, "Gee Wiz"),
    new CrashWarpedScene(0x16, "Hang 'em High"),
    new CrashWarpedScene(0x15, "Hog Ride"),
    new CrashWarpedScene(0x12, "Tomb Time"),
    new CrashWarpedScene(0x11, "Midnight Run"),
    new CrashWarpedScene(0x03, "Dingodile"),
    "Oriental Room",
    new CrashWarpedScene(0x10, "Dino Might!"),
    new CrashWarpedScene(0x1C, "Deep Trouble"),
    new CrashWarpedScene(0x1A, "High Time"),
    new CrashWarpedScene(0x14, "Road Crash"),
    new CrashWarpedScene(0x1D, "Double Header"),
    new CrashWarpedScene(0x04, "N. Tropy"),
    "Egyptian Room",
    new CrashWarpedScene(0x13, "Bye Bye Blimps"),
    new CrashWarpedScene(0x0D, "Tell No Tales"),
    new CrashWarpedScene(0x1B, "Future Frenzy"),
    new CrashWarpedScene(0x18, "Tomb Wader"),
    new CrashWarpedScene(0x1E, "Sphynxinator"),
    new CrashWarpedScene(0x05, "N. Gin"),
    "Future Room",
    new CrashWarpedScene(0x20, "Orange Asphalt"),
    new CrashWarpedScene(0x22, "Flaming Passion"),
    new CrashWarpedScene(0x23, "Gone Tomorrow"),
    new CrashWarpedScene(0x17, "Mad Bombers"),
    new CrashWarpedScene(0x24, "Bug Lite"),
    new CrashWarpedScene(0x07, "Neo Cortex"),
    "Secret",
    new CrashWarpedScene(0x21, "Ski Crazed"),
    new CrashWarpedScene(0x25, "Area 51"),
    new CrashWarpedScene(0x26, "Eggipus Rex"),
    new CrashWarpedScene(0x27, "Hot Coco"),
    new CrashWarpedScene(0x1F, "Rings of Power"),
    "Other",
    new CrashWarpedScene(0x28, "Intro"),
    new CrashWarpedScene(0x29, "Normal Ending"),
    new CrashWarpedScene(0x2A, "100% Ending"),
    new CrashWarpedScene(0x3A, "Boss Dialog"),
    new CrashWarpedScene(0x3B, "Uka Uka Dialog"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: false };
