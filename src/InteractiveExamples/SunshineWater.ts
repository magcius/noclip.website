
import { mat4 } from 'gl-matrix';

import { SceneGfx, ViewerRenderInput } from '../viewer.js';

import * as GX from '../gx/gx_enum.js';
import * as GX_Material from '../gx/gx_material.js';

import { BMD, BTK, MaterialEntry, TTK1 } from '../Common/JSYSTEM/J3D/J3DLoader.js';
import * as RARC from '../Common/JSYSTEM/JKRArchive.js';
import { J3DModelData, MaterialInstance, MaterialInstanceState, ShapeInstanceState, MaterialData } from '../Common/JSYSTEM/J3D/J3DGraphBase.js';
import { SunshineRenderer, SunshineSceneDesc, SMSPass } from '../j3d/sms_scenes.js';
import * as Yaz0 from '../Common/Compression/Yaz0.js';
import { DrawParams, fillSceneParamsDataOnTemplate } from '../gx/gx_render.js';
import { GXRenderHelperGfx } from '../gx/gx_render.js';
import AnimationController from '../AnimationController.js';
import { GfxDevice, GfxBuffer, GfxInputLayout, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxIndexBufferDescriptor } from '../gfx/platform/GfxPlatform.js';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers.js';
import { computeViewMatrix, OrbitCameraController } from '../Camera.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { SceneContext, SceneDesc, SceneGroup } from '../SceneBase.js';
import { assertExists } from '../util.js';
import { VertexAttributeInput } from '../gx/gx_displaylist.js';
import { bindTTK1MaterialInstance } from '../Common/JSYSTEM/J3D/J3DGraphSimple.js';

const scale = 200;
const posMtx = mat4.create();
mat4.fromScaling(posMtx, [scale, scale, scale]);

const scratchViewMatrix = mat4.create();
class PlaneShape {
    private vtxBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private zeroBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const vtx = new Float32Array(4 * 5);
        vtx[0]  = -1;
        vtx[1]  = 0;
        vtx[2]  = -1;
        vtx[3] = 0;
        vtx[4] = 0;

        vtx[5]  = 1;
        vtx[6]  = 0;
        vtx[7]  = -1;
        vtx[8]  = 2;
        vtx[9]  = 0;

        vtx[10] = -1;
        vtx[11] = 0;
        vtx[12] = 1;
        vtx[13] = 0;
        vtx[14] = 2;

        vtx[15] = 1;
        vtx[16] = 0;
        vtx[17] = 1;
        vtx[18] = 2;
        vtx[19] = 2;

        this.vtxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vtx.buffer);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, makeTriangleIndexBuffer(GfxTopology.TriStrips, 0, 4).buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GX_Material.getVertexInputLocation(VertexAttributeInput.POS), format: GfxFormat.F32_RGB, bufferByteOffset: 4*0, bufferIndex: 0, },
            { location: GX_Material.getVertexInputLocation(VertexAttributeInput.TEX01), format: GfxFormat.F32_RG, bufferByteOffset: 4*3, bufferIndex: 0, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4*5, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 0, frequency: GfxVertexBufferFrequency.Constant, },
        ];

        this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Uint8Array(16).buffer);
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        this.vertexBufferDescriptors = [
            { buffer: this.vtxBuffer, byteOffset: 0, },
            { buffer: this.zeroBuffer, byteOffset: 0, },
        ];
        this.indexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx): void {
        const renderInstManager = renderHelper.renderInstManager;
        const renderInst = renderInstManager.newRenderInst();
        renderInst.sortKey = makeSortKey((GfxRendererLayer.TRANSLUCENT | GfxRendererLayer.OPAQUE) + 10);
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        renderInst.setDrawCount(6);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vtxBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyBuffer(this.zeroBuffer);
    }
}

const drawParams = new DrawParams();
class SunshineWaterModel {
    private seaMaterialInstance: MaterialInstance;
    private shapeInstanceState = new ShapeInstanceState();
    private materialInstanceState = new MaterialInstanceState();
    private plane: PlaneShape;
    private bmdModel: J3DModelData;
    private animationController: AnimationController;
    private modelMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, bmd: BMD, btk: TTK1, configName: string) {
        mat4.copy(this.modelMatrix, posMtx);

        this.animationController = new AnimationController();
        // Make it go fast.
        this.animationController.fps = 30 * 5;

        if (configName.includes('nomip')) {
            for (let i = 0; i < bmd.tex1.samplers.length; i++) {
                const sampler = bmd.tex1.samplers[i];
                sampler.minLOD = 1;
                sampler.maxLOD = 1;
            }
        }

        this.bmdModel = new J3DModelData(device, cache, bmd);
        this.materialInstanceState.textureMappings = this.bmdModel.modelMaterialData.createDefaultTextureMappings();

        const seaMaterial = assertExists(bmd.mat3.materialEntries.find((m) => m.name === '_umi'));
        this.mangleMaterial(seaMaterial, configName);
        const seaMaterialData = new MaterialData(seaMaterial);
        this.seaMaterialInstance = new MaterialInstance(seaMaterialData, [], {});
        bindTTK1MaterialInstance(this.seaMaterialInstance, this.animationController, btk);
        this.plane = new PlaneShape(device, cache);

        this.shapeInstanceState.viewFromWorldMatrix = scratchViewMatrix;
    }

    public mangleMaterial(material: MaterialEntry, configName: string): void {
        const gxMaterial = material.gxMaterial;
        gxMaterial.usePnMtxIdx = false;

        if (configName.includes('noalpha')) {
            // Disable alpha test
            gxMaterial.alphaTest.compareA = GX.CompareType.ALWAYS;
            gxMaterial.alphaTest.op = GX.AlphaOp.OR;
        }

        if (configName.includes('noblend')) {
            // Disable blending.
            gxMaterial.tevStages[0].alphaInD = GX.CA.KONST;
            gxMaterial.tevStages[1].alphaInD = GX.CA.KONST;
            gxMaterial.ropInfo.blendSrcFactor = GX.BlendFactor.ONE;
            gxMaterial.ropInfo.blendDstFactor = GX.BlendFactor.ZERO;
            material.translucent = false;
        }

        if (configName.includes('opaque')) {
            // Make it always opaque.
            gxMaterial.tevStages[0].colorInB = GX.CC.TEXA;
            gxMaterial.tevStages[0].colorInC = GX.CC.RASA;
            gxMaterial.tevStages[0].colorInD = GX.CC.ZERO;
            gxMaterial.tevStages[0].colorScale = GX.TevScale.SCALE_1;
            gxMaterial.tevStages[1].colorInB = GX.CC.TEXA;
            gxMaterial.tevStages[1].colorInC = GX.CC.RASA;
            gxMaterial.tevStages[1].colorInD = GX.CC.CPREV;
            gxMaterial.tevStages[1].colorScale = GX.TevScale.SCALE_1;
            gxMaterial.tevStages[1].colorClamp = true;

            // Use one TEV stage.
            if (configName.includes('layer0')) {
                gxMaterial.tevStages.length = 1;
            } else if (configName.includes('layer1')) {
                gxMaterial.tevStages[0] = gxMaterial.tevStages[1];
                gxMaterial.tevStages.length = 1;
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);
        const template = renderHelper.pushTemplateRenderInst();

        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.seaMaterialInstance.setOnRenderInst(renderHelper.renderInstManager.gfxRenderCache, template);

        computeViewMatrix(this.shapeInstanceState.viewFromWorldMatrix, viewerInput.camera);
        mat4.mul(drawParams.u_PosMtx[0], this.shapeInstanceState.viewFromWorldMatrix, this.modelMatrix);
        this.seaMaterialInstance.materialHelper.allocateDrawParamsDataOnInst(template, drawParams);

        this.seaMaterialInstance.fillMaterialParams(template, this.materialInstanceState, this.shapeInstanceState.viewFromWorldMatrix, viewerInput.camera.projectionMatrix, this.modelMatrix, drawParams);

        this.plane.prepareToRender(renderHelper);

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        this.plane.destroy(device);
        this.bmdModel.destroy(device);
    }
}

class SeaRenderer extends SunshineRenderer {
    public sunshineWaterModel: SunshineWaterModel;

    public createCameraController() {
        return new OrbitCameraController(true);
    }

    protected override prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.sunshineWaterModel.prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.renderInstManager.popTemplate();
        super.prepareToRender(device, viewerInput);
    }
}

export class SunshineWaterSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
    
        const rarc = RARC.parse(await Yaz0.decompress(await dataFetcher.fetchData("SuperMarioSunshine/dolpic0.szs")));

        const renderer = new SeaRenderer(device, rarc);
        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
        const skyScene = assertExists(SunshineSceneDesc.createSunshineSceneForBasename(device, cache, SMSPass.SKYBOX, rarc, 'map/map/sky', true));
        renderer.modelInstances.push(skyScene);

        const bmd = BMD.parse(rarc.findFileData('map/map/sea.bmd')!);
        const btk = BTK.parse(rarc.findFileData('map/map/sea.btk')!);

        const seaScene = new SunshineWaterModel(device, cache, bmd, btk, this.id);
        renderer.sunshineWaterModel = seaScene;
        return renderer;
    }
}

const id = 'sunshine_water';
const name = 'Sunshine Water';
const sceneDescs = [
    new SunshineWaterSceneDesc('full'),
    new SunshineWaterSceneDesc('opaque-layer0-nomip-noalpha-noblend'),
    new SunshineWaterSceneDesc('opaque-both-nomip-noalpha-noblend'),
    new SunshineWaterSceneDesc('nomip-noalpha'),
    new SunshineWaterSceneDesc('texture-noalpha'),
];
export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
