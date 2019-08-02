
import { mat4, vec3 } from 'gl-matrix';

import Progressable from '../Progressable';

import { fetchData } from '../fetch';
import { SceneGfx, ViewerRenderInput } from '../viewer';

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import { BMD, BTK } from '../j3d/j3d';
import * as RARC from '../j3d/rarc';
import { BMDModel, MaterialInstance, MaterialInstanceState, ShapeInstanceState, MaterialData, BMDModelInstance } from '../j3d/render';
import * as Yaz0 from '../compression/Yaz0';
import { ub_PacketParams, PacketParams, u_PacketParamsBufferSize, fillPacketParamsData, ub_MaterialParams, ColorKind } from '../gx/gx_render';
import { GXRenderHelperGfx } from '../gx/gx_render';
import AnimationController from '../AnimationController';
import { GfxDevice, GfxHostAccessPass, GfxBuffer, GfxInputState, GfxInputLayout, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency, GfxVertexBufferDescriptor, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { computeViewMatrix, OrbitCameraController, computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from '../Camera';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { SceneDesc, SceneContext } from '../SceneBase';
import { readString, nArray, concat } from '../util';
import { getColorsFromDZS, Colors } from '../j3d/WindWaker/zww_scenes';
import { setSortKeyDepth } from '../gfx/render/GfxRenderer';
import { FakeTextureHolder } from '../TextureHolder';

const scale = 200;
const posMtx = mat4.create();
mat4.fromScaling(posMtx, [scale, scale, scale]);

const scale2 = 1/6;
const posMtx2 = mat4.create();
mat4.fromScaling(posMtx2, [scale2, scale2, scale2]);

const scratchViewMatrix = mat4.create();
class PlaneShape {
    private vtxBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private zeroBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const vtx = new Float32Array(4 * 5);
        const txc = 1;
        const tyc = 2;
        vtx[0]  = -1;
        vtx[1]  = 0;
        vtx[2]  = -1;
        vtx[3] = 0;
        vtx[4] = 0;

        vtx[5]  = 1;
        vtx[6]  = 0;
        vtx[7]  = -1;
        vtx[8]  = txc;
        vtx[9]  = 0;

        vtx[10] = -1;
        vtx[11] = 0;
        vtx[12] = 1;
        vtx[13] = 0;
        vtx[14] = tyc;

        vtx[15] = 1;
        vtx[16] = 0;
        vtx[17] = 1;
        vtx[18] = txc;
        vtx[19] = tyc;

        this.vtxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vtx.buffer);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, makeTriangleIndexBuffer(GfxTopology.TRISTRIP, 0, 4).buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GX_Material.getVertexAttribLocation(GX.VertexAttribute.PNMTXIDX), format: GfxFormat.U8_R, bufferByteOffset: 0, bufferIndex: 1, frequency: GfxVertexAttributeFrequency.PER_INSTANCE, usesIntInShader: true },
            { location: GX_Material.getVertexAttribLocation(GX.VertexAttribute.POS), format: GfxFormat.F32_RGB, bufferByteOffset: 4*0, bufferIndex: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: GX_Material.getVertexAttribLocation(GX.VertexAttribute.TEX0), format: GfxFormat.F32_RG, bufferByteOffset: 4*3, bufferIndex: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: GX_Material.getVertexAttribLocation(GX.VertexAttribute.CLR0), format: GfxFormat.F32_RGBA, bufferByteOffset: 0, bufferIndex: 2, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];

        this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(16).buffer);
        this.colorBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Float32Array(nArray(16, () => 1)).buffer);
        this.inputLayout = cache.createInputLayout(device, {
            vertexAttributeDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const vertexBuffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.vtxBuffer, byteOffset: 0, byteStride: 4*5 },
            { buffer: this.zeroBuffer, byteOffset: 0, byteStride: 4 },
            { buffer: this.colorBuffer, byteOffset: 0, byteStride: 4*4 },
        ];
        this.inputState = device.createInputState(this.inputLayout, vertexBuffers, { buffer: this.idxBuffer, byteOffset: 0, byteStride: 0 });
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, packetParams: PacketParams, depth: number): void {
        const renderInstManager = renderHelper.renderInstManager;
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(6);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        let offs = renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(ub_PacketParams);
        fillPacketParamsData(d, offs, packetParams);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vtxBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyBuffer(this.zeroBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyInputState(this.inputState);
    }
}

const packetParams = new PacketParams();
class Plane {
    public materialInstance: MaterialInstance;
    public shapeInstanceState = new ShapeInstanceState();
    public materialInstanceState = new MaterialInstanceState();
    public plane: PlaneShape;
    public animationController: AnimationController;
    public modelMatrix = mat4.create();
    private origin = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, private bmdModel: BMDModel, btk: BTK | null, materialIndex: number = 0) {
        mat4.copy(this.modelMatrix, posMtx);

        this.animationController = new AnimationController();
        // Make it go fast.
        this.animationController.fps = 30;

        this.materialInstanceState.textureMappings = this.bmdModel.createDefaultTextureMappings();

        const mat = bmdModel.bmd.mat3.materialEntries[materialIndex];
        const matData = new MaterialData(mat);
        this.materialInstance = new MaterialInstance(matData, {});
        if (btk !== null)
            this.materialInstance.bindTTK1(this.animationController, btk.ttk1);
        this.plane = new PlaneShape(device, cache);

        this.shapeInstanceState.worldToViewMatrix = scratchViewMatrix;
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);
        const template = renderHelper.pushTemplateRenderInst();
        renderHelper.fillSceneParams(viewerInput, template);
        this.materialInstance.setOnRenderInst(device, renderHelper.renderInstManager.gfxRenderCache, template);
        template.filterKey = WindWakerPass.MAIN;
        template.allocateUniformBuffer(ub_MaterialParams, this.materialInstance.materialHelper.materialParamsBufferSize);
        template.sortKey = this.materialInstance.sortKey;

        computeViewMatrix(this.shapeInstanceState.worldToViewMatrix, viewerInput.camera);
        mat4.mul(packetParams.u_PosMtx[0], this.shapeInstanceState.worldToViewMatrix, this.modelMatrix);

        this.materialInstance.fillMaterialParams(template, this.materialInstanceState, this.shapeInstanceState.worldToViewMatrix, this.modelMatrix, viewerInput.camera, packetParams);

        const depth = computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(packetParams.u_PosMtx[0], this.origin);
        this.plane.prepareToRender(renderHelper, packetParams, depth);

        renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        this.plane.destroy(device);
    }
}

function createModelInstance(device: GfxDevice, cache: GfxRenderCache, rarc: RARC.RARC, name: string, isSkybox: boolean = false): BMDModelInstance | null {
    let bdlFile = rarc.findFile(`bdl/${name}.bdl`);
    if (!bdlFile)
        bdlFile = rarc.findFile(`bmd/${name}.bmd`);
    if (!bdlFile)
        return null;
    const bdl = BMD.parse(bdlFile.buffer);
    const bmdModel = new BMDModel(device, cache, bdl, null);
    const modelInstance = new BMDModelInstance(bmdModel);
    modelInstance.passMask = isSkybox ? WindWakerPass.SKYBOX : WindWakerPass.MAIN;
    modelInstance.isSkybox = isSkybox;
    return modelInstance;
}

const enum WindWakerPass {
    SKYBOX = 0x01,
    MAIN = 0x02,
}

export class WindWakerRenderer implements SceneGfx {
    public defaultCameraController = OrbitCameraController;

    private renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;

    private vr_sky: BMDModelInstance;
    private vr_uso_umi: BMDModelInstance;
    private vr_kasumi_mae: BMDModelInstance;
    private vr_back_cloud: BMDModelInstance;
    public plane: Plane[] = [];
    public modelData: BMDModel[] = [];
    public textureHolder = new FakeTextureHolder([]);

    constructor(device: GfxDevice, private stageRarc: RARC.RARC, colors: Colors) {
        this.renderHelper = new GXRenderHelperGfx(device);
        const cache = this.renderHelper.renderInstManager.gfxRenderCache;

        this.vr_sky = createModelInstance(device, cache, stageRarc, `vr_sky`, true)!;
        this.vr_uso_umi = createModelInstance(device, cache, stageRarc, `vr_uso_umi`, true)!;
        this.vr_kasumi_mae = createModelInstance(device, cache, stageRarc, `vr_kasumi_mae`, true)!;
        this.vr_back_cloud = createModelInstance(device, cache, stageRarc, `vr_back_cloud`, true)!;

        this.vr_sky.setColorOverride(ColorKind.K0, colors.vr_sky);
        this.vr_uso_umi.setColorOverride(ColorKind.K0, colors.vr_uso_umi);
        this.vr_kasumi_mae.setColorOverride(ColorKind.C0, colors.vr_kasumi_mae);
        this.vr_back_cloud.setColorOverride(ColorKind.K0, colors.vr_back_cloud, true);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();

        this.renderHelper.fillSceneParams(viewerInput, template);
        this.vr_sky.prepareToRender(device, this.renderHelper, viewerInput);
        this.vr_kasumi_mae.prepareToRender(device, this.renderHelper, viewerInput);
        this.vr_uso_umi.prepareToRender(device, this.renderHelper, viewerInput);
        this.vr_back_cloud.prepareToRender(device, this.renderHelper, viewerInput);

        for (let i = 0; i < this.plane.length; i++)
            this.plane[i].prepareToRender(device, this.renderHelper, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.setVisibleByFilterKeyExact(WindWakerPass.SKYBOX);
        renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.setVisibleByFilterKeyExact(WindWakerPass.MAIN);
        renderInstManager.drawOnPassRenderer(device, mainPassRenderer);
        renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        this.vr_sky.destroy(device);
        this.vr_kasumi_mae.destroy(device);
        this.vr_uso_umi.destroy(device);
        this.vr_back_cloud.destroy(device);
        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.plane.length; i++)
            this.plane[i].destroy(device);
    }
}

function fetchArc(archivePath: string, abortSignal: AbortSignal): Progressable<RARC.RARC> {
    return fetchData(archivePath, abortSignal).then((data) => {
        if (readString(data, 0, 0x04) === 'Yaz0')
            return Yaz0.decompress(data);
        else
            return data;
    }).then((data) => {
        return RARC.parse(data);
    });
}

export class WindWakerWater implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, context: SceneContext): Progressable<SceneGfx> {
        const abortSignal = context.abortSignal;
        return Progressable.all([
            fetchArc(`j3d/ww/Stage/sea/Stage.arc`, abortSignal),
            fetchArc(`j3d/ww/Stage/sea/Room44.arc`, abortSignal),
        ]).then(([stageRarc, roomRarc]) => {
            const dzsFile = stageRarc.findFileData(`dzs/stage.dzs`)!;
            const colors = getColorsFromDZS(dzsFile, 0, 2);
    
            const renderer = new WindWakerRenderer(device, stageRarc, colors);

            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
            const model_bmd = new BMDModel(device, cache, BMD.parse(roomRarc.findFileData('bdl/model.bdl')));
            concat(renderer.textureHolder.viewerTextures, model_bmd.tex1Data.viewerTextures);
            renderer.modelData.push(model_bmd);
            const model1_bmd = new BMDModel(device, cache, BMD.parse(roomRarc.findFileData('bdl/model1.bdl')));
            concat(renderer.textureHolder.viewerTextures, model1_bmd.tex1Data.viewerTextures);
            renderer.modelData.push(model1_bmd);
            const model1_btk = BTK.parse(roomRarc.findFileData('btk/model1.btk'));

            function setEnvColors(p: Plane): void {
                p.materialInstanceState.colorOverrides[ColorKind.K0] = colors.ocean;
                p.materialInstanceState.colorOverrides[ColorKind.C0] = colors.wave;
                p.materialInstanceState.colorOverrides[ColorKind.C1] = colors.splash;
                p.materialInstanceState.colorOverrides[ColorKind.K1] = colors.splash2;
            }

            const seaPlane = new Plane(device, cache, model1_bmd, model1_btk, 0);
            seaPlane.modelMatrix[0] = 1000;
            seaPlane.modelMatrix[10] = 1000;
            // setEnvColors(seaPlane);
            renderer.plane.push(seaPlane);

            const fx = (x: number, layerY: number) => {
                function pushPlane(plane: Plane): void {
                    plane.modelMatrix[12] = x;
                    plane.modelMatrix[13] += i++ * layerY;
                    renderer.plane.push(plane);
                    mat4.mul(plane.modelMatrix, posMtx2, plane.modelMatrix);
                }

                let i = 1;
                let plane: Plane;

                // Sand
                plane = new Plane(device, cache, model_bmd, null, 6);
                plane.modelMatrix[14] -= 200;
                const tex0 = plane.materialInstance.materialData.material.texMatrices[0].matrix;
                tex0[5] = 1/8;
                tex0[13] = -0.25;
                pushPlane(plane);

                // Sand Cover
                plane = new Plane(device, cache, model1_bmd, model1_btk, 7);
                setEnvColors(plane);
                pushPlane(plane);

                // Sea plane
                plane = new Plane(device, cache, model1_bmd, model1_btk, 0);
                plane.modelMatrix[14] += 200;
                setEnvColors(plane);
                pushPlane(plane);

                plane = new Plane(device, cache, model1_bmd, model1_btk, 1);
                plane.modelMatrix[14] += 400;
                setEnvColors(plane);
                pushPlane(plane);

                plane = new Plane(device, cache, model1_bmd, model1_btk, 6);
                setEnvColors(plane);
                pushPlane(plane);

                plane = new Plane(device, cache, model1_bmd, model1_btk, 4);
                setEnvColors(plane);
                pushPlane(plane);
            };

            fx(-250, 25);
            fx(250, 0.2);
            return renderer;
        });
    }
}
