
import { mat4 } from 'gl-matrix';

import { SceneGfx, ViewerRenderInput } from '../viewer';

import * as GX_Material from '../gx/gx_material';

import { BMD, BTK, DRW1MatrixKind } from '../Common/JSYSTEM/J3D/J3DLoader';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import { J3DModelData, MaterialInstance, J3DModelInstanceSimple } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import * as Yaz0 from '../Common/Compression/Yaz0';
import { ub_PacketParams, PacketParams, ub_PacketParamsBufferSize, fillPacketParamsData, fillSceneParamsDataOnTemplate, ColorKind, ub_SceneParams, ub_SceneParamsBufferSize } from '../gx/gx_render';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxBuffer, GfxInputState, GfxInputLayout, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { makeSortKey, GfxRendererLayer, GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { OrbitCameraController } from '../Camera';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext, SceneDesc, GraphObjBase } from '../SceneBase';
import { assert } from '../util';
import { VertexAttributeInput } from '../gx/gx_displaylist';
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { createModelInstance } from '../j3d/scenes';
import { computeModelMatrixS } from '../MathHelpers';
import { AABB } from '../Geometry';
import * as GX from '../gx/gx_enum';
import { colorNewCopy, White } from '../Color';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { dfUsePercent } from '../DebugFloaters';

class PlaneShape {
    private vtxBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private zeroBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private indexCount: number;

    private gridSideLength: number = 6;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        // position (3) + uv (2) + color (4) = 9
        // gridSideLength * gridSideLength points

        const side = this.gridSideLength;
        const vertexCount = side ** 2;

        const vtx = new Float32Array(vertexCount * 9);

        let vertexOffs = 0;
        for (let y = 0; y < side; y++) {
            const ty = y / (side - 1);
            for (let x = 0; x < side; x++) {
                const tx = x / (side - 1);

                // Position ranges from -1 to 1.
                vtx[vertexOffs++] = tx * 2.0 - 1.0;
                vtx[vertexOffs++] = 0;
                vtx[vertexOffs++] = ty * 2.0 - 1.0;

                // UV ranges from 0 to 1.
                vtx[vertexOffs++] = tx;
                vtx[vertexOffs++] = ty;

                // Color, we handle by having the extreme edges being 1.0, and everything else is 0.0.
                const isEdgeX = tx === 0.0 || tx === 1.0;
                const isEdgeY = ty === 0.0 || ty === 1.0;

                const alpha = (isEdgeX || isEdgeY) ? 1.0 : 0.0;
                vtx[vertexOffs++] = 0.0;
                vtx[vertexOffs++] = 0.0;
                vtx[vertexOffs++] = 0.0;
                vtx[vertexOffs++] = alpha;
            }
        }

        this.indexCount = ((side - 1) ** 2) * 6;
        const indexData = new Uint16Array(this.indexCount);
        let indexOffs = 0;
        for (let y = 0; y < side - 1; y++) {
            for (let x = 0; x < side - 1; x++) {
                // HACK: For the first and last tile, we use a different triangle ordering.
                let useOtherOrder = false;
                if (x === 0 && y === 0)
                    useOtherOrder = true;
                else if (x === side - 2 && y === side - 2)
                    useOtherOrder = true;

                const base = y * side + x;
                if (useOtherOrder) {
                    indexData[indexOffs++] = base;
                    indexData[indexOffs++] = base + side;
                    indexData[indexOffs++] = base + side + 1;
                    indexData[indexOffs++] = base;
                    indexData[indexOffs++] = base + side + 1;
                    indexData[indexOffs++] = base + 1;
                } else {
                    indexData[indexOffs++] = base;
                    indexData[indexOffs++] = base + side;
                    indexData[indexOffs++] = base + 1;
                    indexData[indexOffs++] = base + side;
                    indexData[indexOffs++] = base + side + 1;
                    indexData[indexOffs++] = base + 1;
                }
            }
        }
        assert(indexOffs === this.indexCount);

        this.vtxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vtx.buffer);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GX_Material.getVertexInputLocation(VertexAttributeInput.POS),   format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04, bufferIndex: 0, },
            { location: GX_Material.getVertexInputLocation(VertexAttributeInput.TEX01), format: GfxFormat.F32_RG,   bufferByteOffset: 3*0x04, bufferIndex: 0, },
            { location: GX_Material.getVertexInputLocation(VertexAttributeInput.CLR0),  format: GfxFormat.F32_RGBA, bufferByteOffset: 5*0x04, bufferIndex: 0, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 9*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(16).buffer);
        this.inputLayout = cache.createInputLayout(device, {
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const vertexBuffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.vtxBuffer, byteOffset: 0, },
        ];
        this.inputState = device.createInputState(this.inputLayout, vertexBuffers, { buffer: this.idxBuffer, byteOffset: 0 });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, packetParams: PacketParams): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 10);
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indexCount);

        let offs = renderInst.allocateUniformBuffer(ub_PacketParams, ub_PacketParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(ub_PacketParams);
        fillPacketParamsData(d, offs, packetParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vtxBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyBuffer(this.zeroBuffer);
        device.destroyInputState(this.inputState);
    }
}

const packetParams = new PacketParams();
class FakeWaterModelInstance {
    private plane: PlaneShape;
    private materialInstance: MaterialInstance;

    public visible: boolean = true;

    // alpha test high, alpha test low, _, second texture fade
    @dfUsePercent()
    public k3 = colorNewCopy(White);
    // _, _, _, vertex color fade
    @dfUsePercent()
    public c1 = colorNewCopy(White);
    // _, _, _, only vertex color fade
    @dfUsePercent()
    public c2 = colorNewCopy(White);

    constructor(device: GfxDevice, cache: GfxRenderCache, private modelInstance: J3DModelInstanceSimple) {
        this.plane = new PlaneShape(device, cache);

        // Pull out our material and do bad things to it.
        this.materialInstance = modelInstance.materialInstances.find((m) => m.name === "UnderGroundWaterA_v_x")!;

        const materialHelper = this.materialInstance.materialHelper;
        const material = materialHelper.material;

        {
            const mb = new GXMaterialBuilder();

            // Allow fading in the vertex colors.
            mb.setTevAlphaIn(0, GX.CA.KONST, GX.CA.RASA, GX.CA.A1, GX.CA.ZERO);
            mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_K0_A);
            mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.REG1);
            material.tevStages.unshift(mb.finish().tevStages[0]);

            material.tevStages[1].alphaInB = GX.CA.A1;
        }

        {
            const mb = new GXMaterialBuilder();

            // Allow fading in second texture.
            // Output both blend to REG0
            material.tevStages[2].alphaRegId = GX.Register.REG0;
            mb.setTevColorIn(0, GX.CC.CPREV, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
            // Blend between PREV (single texture) and A0 (both)
            mb.setTevAlphaIn(0, GX.CA.APREV, GX.CA.A0, GX.CA.KONST, GX.CA.ZERO);
            mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_K3_A);

            // Append in vertex color fade.
            mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.RASA, GX.CC.A2, GX.CC.ZERO);
            mb.setTevAlphaIn(1, GX.CA.APREV, GX.CA.KONST, GX.CA.A2, GX.CA.ZERO);

            material.tevStages.push.apply(material.tevStages, mb.finish().tevStages);
        }

        // Replace the alpha test section with dynamic alpha test based on s_kColor3.
        // TODO(jstpierre): Dynamic alpha reference might make perfect sense to have in core one day...
        material.alphaTest.op = GX.AlphaOp.OR;
        materialHelper.createProgram();
        // @ts-ignore
        const program = materialHelper.program;
        program.frag = program.frag.replace(/bool t_AlphaTestA = .+;/, 'bool t_AlphaTestA = t_PixelOut.a >= s_kColor3.r;');
        program.frag = program.frag.replace(/bool t_AlphaTestB = .+;/, 'bool t_AlphaTestB = t_PixelOut.a <= s_kColor3.g;');

        this.k3.r = materialHelper.material.alphaTest.referenceA;
        this.k3.g = materialHelper.material.alphaTest.referenceB;
        this.c2.a = 0.0;

        this.materialInstance.setColorOverride(ColorKind.K3, this.k3);
        this.materialInstance.setColorOverride(ColorKind.C1, this.c1);
        this.materialInstance.setColorOverride(ColorKind.C2, this.c2);

        computeModelMatrixS(this.modelInstance.modelMatrix, 500.0);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.modelInstance.animationController.setTimeInMilliseconds(viewerInput.time);
        this.modelInstance.calcAnim(viewerInput.camera);
        this.modelInstance.calcView(viewerInput.camera, viewerInput.camera.viewMatrix);

        // Calc our packet params.
        mat4.copy(packetParams.u_PosMtx[0], this.modelInstance.shapeInstanceState.drawViewMatrixArray[0]);

        // Push our material instance.
        const template = renderInstManager.pushTemplateRenderInst();
        this.materialInstance.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
        this.materialInstance.fillMaterialParams(template, this.modelInstance.materialInstanceState, this.modelInstance.shapeInstanceState.worldToViewMatrix, this.modelInstance.modelMatrix, viewerInput.camera, viewerInput.viewport, packetParams);

        this.plane.prepareToRender(renderInstManager, packetParams);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        this.plane.destroy(device);
        this.modelInstance.destroy(device);
    }
}

class SlimySpringWaterRenderer implements SceneGfx {
    private renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;

    public skybox: J3DModelInstanceSimple;
    public flowerBox: J3DModelInstanceSimple;
    public waterModel: FakeWaterModelInstance;

    public shouldOrbit: boolean = false;
    public showFlowerBox: boolean = true;
    public useMipmaps: boolean = true;
    public orbitCC: OrbitCameraController;

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public createCameraController() {
        this.orbitCC = new OrbitCameraController(this.shouldOrbit);
        this.orbitCC.orbitSpeed *= 0.4;
        this.orbitCC.z = -1500;
        return this.orbitCC;
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        this.orbitCC.shouldOrbit = this.shouldOrbit;
        this.flowerBox.visible = this.showFlowerBox;

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.skybox.prepareToRender(device, renderInstManager, viewerInput);
        this.flowerBox.prepareToRender(device, renderInstManager, viewerInput);
        const customLODBias = this.useMipmaps ? null : -10000;
        template.allocateUniformBuffer(ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsDataOnTemplate(template, viewerInput, customLODBias);
        this.waterModel.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        this.renderHelper.renderInstManager.drawOnPassRenderer(device, passRenderer);
        this.renderHelper.renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        this.skybox.destroy(device);
        this.flowerBox.destroy(device);
        this.waterModel.destroy(device);
    }
}

export class SlimySpringWaterDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const renderer = new SlimySpringWaterRenderer(device);
        const cache = renderer.renderHelper.getCache();

        // Skybox.
        {
            const rarc = RARC.parse(await Yaz0.decompress(await dataFetcher.fetchData("SuperMarioGalaxy2/ObjectData/BeyondHorizonSky.arc")));
            const skybox = createModelInstance(device, cache, rarc.findFile('BeyondHorizonSky.bdl')!, rarc.findFile('BeyondHorizonSky.btk'), null, null, null);
            skybox.animationController.fps = 60;
            skybox.isSkybox = true;
            renderer.skybox = skybox;
        }

        // Nice-looking box. Is this worth it?
        {
            const rarc = RARC.parse(await Yaz0.decompress(await dataFetcher.fetchData("SuperMarioGalaxy2/ObjectData/SkyIslandStepPartsA.arc")));
            const bmd = BMD.parse(rarc.findFileData('SkyIslandStepPartsA.bdl')!);

            // Append a fake joint for the grass. This is disgusting.
            bmd.jnt1.joints.push({ name: 'yikes',
                bbox: new AABB(), boundingSphereRadius: 1000,
                scaleX: 1, scaleY: 0.2, scaleZ: 1,
                rotationX: 0, rotationY: 0, rotationZ: 0,
                translationX: 0, translationY: 238, translationZ: 0,
            });
            bmd.drw1.matrixDefinitions.push({ kind: DRW1MatrixKind.Joint, jointIndex: 1 });
            bmd.shp1.shapes[4].mtxGroups[0].useMtxTable[0] = 1;

            const modelData = new J3DModelData(device, cache, bmd);
            modelData.jointData.push({ jointIndex: 1, parentJointIndex: 0 });

            const flowerBox = new J3DModelInstanceSimple(modelData);
            computeModelMatrixS(flowerBox.modelMatrix, 1.675);
            flowerBox.modelMatrix[13] -= 510;
            renderer.flowerBox = flowerBox;
        }

        // Water.
        {
            const rarc = RARC.parse(await Yaz0.decompress(await dataFetcher.fetchData("SuperMarioGalaxy2/ObjectData/UnderGroundDangeonPlanetA.arc")));

            // Build a fake model instance, bind the BTK to it.
            const bmd = BMD.parse(rarc.findFileData('UnderGroundDangeonPlanetA.bdl')!);
            const btk = BTK.parse(rarc.findFileData('UnderGroundDangeonPlanetA.btk')!);
            const modelData = new J3DModelData(device, cache, bmd);

            const modelInstance = new J3DModelInstanceSimple(modelData);
            modelInstance.animationController.fps = 60;
            modelInstance.bindTTK1(btk);

            const waterModel = new FakeWaterModelInstance(device, cache, modelInstance);
            renderer.waterModel = waterModel;

            // Create our DebugFloater.
            const panel = window.main.ui.debugFloaterHolder.makeFloatingPanel('Controls');
            panel.bindSliderChain("Alpha Threshold Low", waterModel, 'k3', 'g');
            panel.bindSliderChain("Alpha Threshold High", waterModel, 'k3', 'r');
            panel.bindSliderChain("Fade In Vertex Colors", waterModel, 'c1', 'a');
            panel.bindSliderChain("Fade In Second Texture", waterModel, 'k3', 'a');
            panel.bindSliderChain("Show Only Vertex Colors", waterModel, 'c2', 'a');
            panel.bindCheckbox("Show Flower Box?", renderer, 'showFlowerBox');
            panel.bindCheckbox("Rotate Camera?", renderer, 'shouldOrbit');
            panel.bindCheckbox("Use Miptrick?", renderer, 'useMipmaps');
        }

        return renderer;
    }
}
