
import { mat4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';

import { SceneGfx, ViewerRenderInput } from '../viewer';

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import { BMD, BTK, MaterialEntry } from '../j3d/j3d';
import * as RARC from '../j3d/rarc';
import { BMDModel, MaterialInstance, MaterialInstanceState, ShapeInstanceState, MaterialData } from '../j3d/render';
import { SunshineRenderer, SunshineSceneDesc, SMSPass } from '../j3d/sms_scenes';
import * as Yaz0 from '../Common/Compression/Yaz0';
import { ub_PacketParams, PacketParams, u_PacketParamsBufferSize, fillPacketParamsData, ub_MaterialParams, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GXRenderHelperGfx } from '../gx/gx_render';
import AnimationController from '../AnimationController';
import { GfxDevice, GfxHostAccessPass, GfxBuffer, GfxInputState, GfxInputLayout, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency, GfxVertexBufferDescriptor } from '../gfx/platform/GfxPlatform';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { computeViewMatrix } from '../Camera';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import { assertExists } from '../util';

const scale = 200;
const posMtx = mat4.create();
mat4.fromScaling(posMtx, [scale, scale, scale]);

const scratchViewMatrix = mat4.create();
class PlaneShape {
    private vtxBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private zeroBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

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

        this.vtxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vtx.buffer);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, makeTriangleIndexBuffer(GfxTopology.TRISTRIP, 0, 4).buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GX_Material.getVertexAttribLocation(GX.VertexAttribute.PNMTXIDX), format: GfxFormat.U8_R, bufferByteOffset: 0, bufferIndex: 1, frequency: GfxVertexAttributeFrequency.PER_INSTANCE, usesIntInShader: true },
            { location: GX_Material.getVertexAttribLocation(GX.VertexAttribute.POS), format: GfxFormat.F32_RGB, bufferByteOffset: 4*0, bufferIndex: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: GX_Material.getVertexAttribLocation(GX.VertexAttribute.TEX0), format: GfxFormat.F32_RG, bufferByteOffset: 4*3, bufferIndex: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];

        this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(16).buffer);
        this.inputLayout = cache.createInputLayout(device, {
            vertexAttributeDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const vertexBuffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.vtxBuffer, byteOffset: 0, byteStride: 4*5 },
            { buffer: this.zeroBuffer, byteOffset: 0, byteStride: 4 },
        ];
        this.inputState = device.createInputState(this.inputLayout, vertexBuffers, { buffer: this.idxBuffer, byteOffset: 0, byteStride: 1 });
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, packetParams: PacketParams): void {
        const renderInstManager = renderHelper.renderInstManager;
        const renderInst = renderInstManager.pushRenderInst();
        // Force this so it renders after the skybox.
        renderInst.filterKey = SMSPass.OPAQUE;
        renderInst.sortKey = makeSortKey((GfxRendererLayer.TRANSLUCENT | GfxRendererLayer.OPAQUE) + 10);
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(6);

        let offs = renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(ub_PacketParams);
        fillPacketParamsData(d, offs, packetParams);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vtxBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyBuffer(this.zeroBuffer);
        device.destroyInputState(this.inputState);
    }
}

const packetParams = new PacketParams();
class SeaPlaneScene {
    private seaMaterialInstance: MaterialInstance;
    private shapeInstanceState = new ShapeInstanceState();
    private materialInstanceState = new MaterialInstanceState();
    private plane: PlaneShape;
    private bmdModel: BMDModel;
    private animationController: AnimationController;
    private modelMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, bmd: BMD, btk: BTK, configName: string) {
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

        this.bmdModel = new BMDModel(device, cache, bmd);
        this.materialInstanceState.textureMappings = this.bmdModel.modelMaterialData.createDefaultTextureMappings();

        const seaMaterial = assertExists(bmd.mat3.materialEntries.find((m) => m.name === '_umi'));
        this.mangleMaterial(seaMaterial, configName);
        const seaMaterialData = new MaterialData(seaMaterial);
        this.seaMaterialInstance = new MaterialInstance(seaMaterialData, {});
        this.seaMaterialInstance.bindTTK1(this.animationController, btk.ttk1);
        this.plane = new PlaneShape(device, cache);

        this.shapeInstanceState.worldToViewMatrix = scratchViewMatrix;
    }

    public mangleMaterial(material: MaterialEntry, configName: string): void {
        const gxMaterial = material.gxMaterial;

        if (configName.includes('noalpha')) {
            // Disable alpha test
            gxMaterial.alphaTest.compareA = GX.CompareType.ALWAYS;
            gxMaterial.alphaTest.op = GX.AlphaOp.OR;
        }

        if (configName.includes('noblend')) {
            // Disable blending.
            gxMaterial.tevStages[0].alphaInD = GX.CombineAlphaInput.KONST;
            gxMaterial.tevStages[1].alphaInD = GX.CombineAlphaInput.KONST;
            gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ONE;
            gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ZERO;
            material.translucent = false;
        }

        if (configName.includes('opaque')) {
            // Make it always opaque.
            gxMaterial.tevStages[0].colorInB = GX.CombineColorInput.TEXA;
            gxMaterial.tevStages[0].colorInC = GX.CombineColorInput.RASA;
            gxMaterial.tevStages[0].colorInD = GX.CombineColorInput.CPREV;
            gxMaterial.tevStages[0].colorScale = GX.TevScale.SCALE_1;
            gxMaterial.tevStages[1].colorInB = GX.CombineColorInput.TEXA;
            gxMaterial.tevStages[1].colorInC = GX.CombineColorInput.RASA;
            gxMaterial.tevStages[1].colorInD = GX.CombineColorInput.CPREV;
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
        this.seaMaterialInstance.setOnRenderInst(device, renderHelper.renderInstManager.gfxRenderCache, template);
        template.allocateUniformBuffer(ub_MaterialParams, this.seaMaterialInstance.materialHelper.materialParamsBufferSize);

        computeViewMatrix(this.shapeInstanceState.worldToViewMatrix, viewerInput.camera);
        mat4.mul(packetParams.u_PosMtx[0], this.shapeInstanceState.worldToViewMatrix, this.modelMatrix);

        this.seaMaterialInstance.fillMaterialParams(template, this.materialInstanceState, this.shapeInstanceState.worldToViewMatrix, this.modelMatrix, viewerInput.camera, packetParams);

        this.plane.prepareToRender(renderHelper, packetParams);
        renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        this.plane.destroy(device);
        this.bmdModel.destroy(device);
    }
}

class SeaRenderer extends SunshineRenderer {
    public seaPlaneScene: SeaPlaneScene;

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        this.seaPlaneScene.prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        super.prepareToRender(device, hostAccessPass, viewerInput);
    }
}

export function createScene(context: SceneContext, name: string): Promise<SceneGfx> {
    const device = context.device;
    const dataFetcher = context.dataFetcher;

    return dataFetcher.fetchData("j3d/sms/dolpic0.szs").then((buffer: ArrayBufferSlice) => {
        return Yaz0.decompress(buffer);
    }).then((buffer: ArrayBufferSlice) => {
        const rarc = RARC.parse(buffer);

        const renderer = new SeaRenderer(device, rarc);
        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
        const skyScene = assertExists(SunshineSceneDesc.createSunshineSceneForBasename(device, cache, SMSPass.SKYBOX, rarc, 'map/map/sky', true));
        renderer.modelInstances.push(skyScene);

        const bmd = BMD.parse(rarc.findFileData('map/map/sea.bmd')!);
        const btk = BTK.parse(rarc.findFileData('map/map/sea.btk')!);

        const seaScene = new SeaPlaneScene(device, cache, bmd, btk, name);
        renderer.seaPlaneScene = seaScene;
        return renderer;
    });
}
