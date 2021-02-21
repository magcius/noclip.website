import * as GMA from './gma';
import * as GX from "../gx/gx_enum";
import * as GX_Material from '../gx/gx_material';
import { AVTexture, AVTpl } from './AVtpl';

import { LoadedVertexData, LoadedVertexDraw } from '../gx/gx_displaylist';
import { GfxBufferCoalescerCombo } from "../gfx/helpers/BufferHelpers";
import { GfxDevice, GfxMipFilterMode, GfxNormalizedViewportCoords, GfxSampler, GfxTexFilterMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { ColorKind, GXMaterialHelperGfx, GXShapeHelperGfx, GXTextureHolder, loadedDataCoalescerComboGfx, MaterialParams, PacketParams, translateWrapModeGfx } from "../gx/gx_render";
import { mat4 } from 'gl-matrix';
import { Camera, computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { Color, colorCopy } from '../Color';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKey, setSortKeyBias, setSortKeyDepth } from '../gfx/render/GfxRenderer';
import { nArray } from '../util';
import { AABB, IntersectionState } from '../Geometry';
import { ViewerRenderInput } from '../viewer';
import { TextureMapping } from '../TextureHolder';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';


export class AmusementVisionTextureHolder extends GXTextureHolder<AVTexture> {
    public addAVtplTextures(device: GfxDevice, avtpl: AVTpl): void {
        this.addTextures(device, avtpl.textures);
    }
}

class InstanceStateData {
    public jointToWorldMatrixVisibility: IntersectionState[] = [];
    public jointToWorldMatrixArray: mat4[] = [];
    public drawViewMatrixArray: mat4[] = [];
}

export class GcmfModel {
    public shapeHelperGfx: GXShapeHelperGfx[] = [];
    public materialData: MaterialData[] = [];
    private bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, cache: GfxRenderCache, public gcmfEntry: GMA.GcmfEntry, private materialHacks?: GX_Material.GXMaterialHacks) {
        const loadedVertexDatas: LoadedVertexData[] = [];
        gcmfEntry.gcmf.shapes.forEach(shape => {
            for (let i = 0; i < shape.loadedVertexDatas.length; i++) {
                loadedVertexDatas.push(shape.loadedVertexDatas[i]);
            }
        });
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, loadedVertexDatas);

        const gcmf = gcmfEntry.gcmf;
        let idx = 0;
        for (let i = 0; i < gcmf.shapes.length; i++) {
            const shape = gcmf.shapes[i];
            shape.loadedVertexDatas.forEach(loadedVertexDatas => {
                const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[idx];
                const shapeData = new GXShapeHelperGfx(device, cache, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer, shape.loadedVertexLayout, loadedVertexDatas);
                this.shapeHelperGfx.push(shapeData);
                idx++;
            });
        }

        for (let i = 0; i < gcmf.shapes.length; i++) {
            for(let j = 0; j < 1; j++){
                const GcmfMaterial = gcmf.shapes[i].material;
                const samplerIdx = GcmfMaterial.samplerIdxs[j];
                if (samplerIdx < 0){
                    break;
                }
                const sampler = gcmf.samplers[samplerIdx];
                const material = new MaterialData(device, GcmfMaterial, sampler, this.materialHacks);
                this.materialData.push(material);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapeHelperGfx.length; i++)
            this.shapeHelperGfx[i].destroy(device);
        for (let i = 0; i < this.materialData.length; i++)
            this.materialData[i].destroy(device);
        this.bufferCoalescer.destroy(device);
    }
}

const bboxScratch = new AABB();
const packetParams = new PacketParams();
class ShapeInstance {
    public sortKeyBias = 0;

    constructor(public shape: GMA.GcmfShape, public shapeData: GXShapeHelperGfx, public materialInstance: MaterialInstance, public shape_idx: number) {
    }

    public prepareToRender(device: GfxDevice, textureHolder: GXTextureHolder, renderInstManager: GfxRenderInstManager, depth: number, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>, instanceStateData: InstanceStateData, isSkybox: boolean): void {
        const materialInstance = this.materialInstance;

        if (!materialInstance.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = materialInstance.sortKey;
        template.sortKey = setSortKeyDepth(template.sortKey, depth);
        template.sortKey = setSortKeyBias(template.sortKey, this.sortKeyBias);

        materialInstance.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        const usesSkinning = this.shape.material.vtxRenderFlag < 0x08;

        for(let i = 0; i < this.shape.material.samplerIdxs.length; i++){
            if (this.shape.material.samplerIdxs[i] < 0){
                break;
            }
            materialInstance.fillMaterialParams(template, textureHolder, this.shape.material.samplerIdxs[i], null, camera, viewport);
        }

        packetParams.clear();
        for (let d = 0; d < this.shape.loadedVertexDatas[this.shape_idx].draws.length; d++) {
            const draw = this.shape.loadedVertexDatas[this.shape_idx].draws[d];

            mat4.copy(packetParams.u_PosMtx[0], instanceStateData.drawViewMatrixArray[0]);

            const renderInst = renderInstManager.newRenderInst();
            this.shapeData.setOnRenderInst(renderInst, draw);
            materialInstance.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

function colorChannelCopy(o: GX_Material.ColorChannelControl): GX_Material.ColorChannelControl {
    return Object.assign({}, o);
}

function lightChannelCopy(o: GX_Material.LightChannelControl): GX_Material.LightChannelControl {
    const colorChannel = colorChannelCopy(o.colorChannel);
    const alphaChannel = colorChannelCopy(o.alphaChannel);
    return { colorChannel, alphaChannel };
}

type CopyFunc<T> = (a: T) => T;

function arrayCopy<T>(a: T[], copyFunc: CopyFunc<T>): T[] {
    const b = Array(a.length);
    for (let i = 0; i < a.length; i++)
        b[i] = copyFunc(a[i]);
    return b;
}

const matrixScratch = mat4.create();
const materialParams = new MaterialParams();
class MaterialInstance {
    public materialHelper: GXMaterialHelperGfx;
    public sortKey: number = 0;
    public visible = true;

    constructor(private modelInstance: GcmfModelInstance, public materialData: MaterialData, public samplers: GMA.GcmfSampler[]) {
        const lightChannel0: GX_Material.LightChannelControl = {
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: GX.ColorSrc.VTX, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
            colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: GX.ColorSrc.VTX, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
        };
    
        const lightChannels: GX_Material.LightChannelControl[] = [lightChannel0, lightChannel0];
        let unk0x02 = this.materialData.material.unk0x02;
        let unk0x03 = this.materialData.material.unk0x03;

        const mb = new GXMaterialBuilder();
        mb.setTevDirect(0);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setCullMode( (unk0x03 & (1 << 1)) !== 0 ? GX.CullMode.NONE : GX.CullMode.FRONT );
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.RASC, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG0);
        mb.setTexCoordGen(0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, GX.PostTexGenMatrix.PTIDENTITY);

        mb.setZMode(true, GX.CompareType.LESS, true);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        mb.setBlendMode( (unk0x03 & (1 << 6)) !== 0 ?  GX.BlendMode.BLEND : GX.BlendMode.NONE, GX.BlendFactor.DSTALPHA, GX.BlendFactor.ONE );
        this.materialHelper = new GXMaterialHelperGfx(mb.finish(), materialData.materialHacks);

        const layer = this.materialData.material.transparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.setSortKeyLayer(layer);
    }

    public setSortKeyLayer(layer: GfxRendererLayer): void {
        if (this.materialData.material.transparent)
            layer |= GfxRendererLayer.TRANSLUCENT;
        this.sortKey = makeSortKey(layer);
    }

    public setMaterialHacks(materialHacks: GX_Material.GXMaterialHacks): void {
        this.materialHelper.setMaterialHacks(materialHacks);
    }

    private calcTexMatrix(materialParams: MaterialParams, texIdx: number, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
        const material = this.materialData.material;
        const flipY = materialParams.m_TextureMapping[texIdx].flipY;
        const flipYScale = flipY ? -1.0 : 1.0;
        const dstPost = materialParams.u_PostTexMtx[texIdx];

        mat4.identity(dstPost);

        mat4.mul(dstPost, matrixScratch, dstPost);
    }

    private calcColor(materialParams: MaterialParams, i: ColorKind, fallbackColor: Color): void {
        const dst = materialParams.u_Color[i];
        let color: Color;
        if (this.modelInstance && this.modelInstance.colorOverrides[i]) {
            color = this.modelInstance.colorOverrides[i];
        } else {
            color = fallbackColor;
        }

        colorCopy(dst, color);
    }

    private fillMaterialParamsData(materialParams: MaterialParams, textureHolder: GXTextureHolder, posNrmMatrixIdx: number, draw: LoadedVertexDraw | null = null, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
        const material = this.materialData.material;

        for (let i = 0; i < 3; i++) {
            const m = materialParams.m_TextureMapping[i];
            m.reset();

            this.fillTextureMapping(m, textureHolder, i);
        }
    }

    private fillTextureMapping(dst: TextureMapping, textureHolder: GXTextureHolder, i: number): void {
        const material = this.materialData.material;
        dst.reset();
        let samplerIdx = material.samplerIdxs[i];
        if(samplerIdx < 0){
            return;
        }
        let texIdx = 0;
        texIdx = this.samplers[samplerIdx].texIdx;
        const name: string = `texture_${texIdx}`;
        textureHolder.fillTextureMapping(dst, name);
        dst.gfxSampler = this.materialData.gfxSamplers[i];
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.materialHelper.setOnRenderInst(device, cache, renderInst);
    }

    public fillMaterialParams(renderInst: GfxRenderInst, textureHolder: GXTextureHolder, posNrmMatrixIdx: number, packet: LoadedVertexDraw | null, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
        this.fillMaterialParamsData(materialParams, textureHolder, posNrmMatrixIdx, packet, camera, viewport);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }

    public destroy(device: GfxDevice): void {
    }
}


const matrixScratchArray = nArray(1, () => mat4.create());
export class GcmfModelInstance {
    public shapeInstances: ShapeInstance[] = [];
    public materialInstances: MaterialInstance[] = [];

    private instanceStateData = new InstanceStateData();

    public colorOverrides: Color[] = [];

    public modelMatrix: mat4 = mat4.create();
    public visible: boolean = true;
    public name: string;
    public isSkybox: boolean = false;
    public passMask: number = 1;
    public templateRenderInst: GfxRenderInst;

    constructor(public textureHolder: GXTextureHolder, public gcmfModel: GcmfModel, public namePrefix: string = '') {
        this.name = `${namePrefix}/${gcmfModel.gcmfEntry.name}`;

        this.instanceStateData.jointToWorldMatrixArray = nArray(gcmfModel.gcmfEntry.gcmf.mtxCount, () => mat4.create());
        this.instanceStateData.drawViewMatrixArray = nArray(1, () => mat4.create());
        for (let i = 0; i < this.gcmfModel.materialData.length; i++){
            this.materialInstances[i] = new MaterialInstance(this, this.gcmfModel.materialData[i], this.gcmfModel.gcmfEntry.gcmf.samplers);
        }

        const gcmf = this.gcmfModel.gcmfEntry.gcmf;
        let idx = 0;
        for (let i = 0; i < gcmf.shapes.length; i++) {
            const materialInstance = this.materialInstances[i];
            const shape = gcmf.shapes[i];
            for (let j = 0; j < shape.loadedVertexDatas.length; j++){
                const shapeData = this.gcmfModel.shapeHelperGfx[idx];
                const shapeInstance = new ShapeInstance(shape, shapeData, materialInstance, j);
                this.shapeInstances.push(shapeInstance);
                idx++;
            }
        }
    }

    public setSortKeyLayer(layer: GfxRendererLayer): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setSortKeyLayer(layer);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableVertexColors: !v });
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableTextures: !v });
    }

    public setColorOverride(i: ColorKind, color: Color): void {
        this.colorOverrides[i] = color;
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    private calcView(camera: Camera): void {
        const viewMatrix = matrixScratch;

        if (this.isSkybox){
            computeViewMatrixSkybox(viewMatrix, camera);

        } else{
            computeViewMatrix(viewMatrix, camera);
        }

        const dstDrawMatrix = this.instanceStateData.drawViewMatrixArray[0];

        mat4.mul(dstDrawMatrix, viewMatrix, this.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        let modelVisibility = this.visible ? IntersectionState.PARTIAL_INTERSECT : IntersectionState.FULLY_OUTSIDE;
        const gcmf = this.gcmfModel.gcmfEntry.gcmf;
        const camera = viewerInput.camera;

        if (modelVisibility !== IntersectionState.FULLY_OUTSIDE) {
            if (this.isSkybox) {
                modelVisibility = IntersectionState.FULLY_INSIDE;
            } else {
                let bbox = new AABB();
                bbox.set(-gcmf.boundSpeher, -gcmf.boundSpeher, -gcmf.boundSpeher, gcmf.boundSpeher, gcmf.boundSpeher, gcmf.boundSpeher);
                bboxScratch.transform(bbox, this.modelMatrix);
                if (!viewerInput.camera.frustum.contains(bboxScratch))
                    modelVisibility = IntersectionState.FULLY_OUTSIDE;
            }
        }

        let depth = 2;
        this.calcView(camera);

        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = this.passMask;
        for (let i = 0; i < this.shapeInstances.length; i++) {
            const shapeInstance = this.shapeInstances[i];
            shapeInstance.prepareToRender(device, this.textureHolder, renderInstManager, depth, camera, viewerInput.viewport, this.instanceStateData, this.isSkybox);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
    }

}


class MaterialData {
    public gfxSamplers: GfxSampler[] = [];

    constructor(device: GfxDevice, public material: GMA.GcmfMaterial, public sampler: GMA.GcmfSampler, public materialHacks?: GX_Material.GXMaterialHacks) {
        function translateAVTexFilterGfx(mipmapAV: number): [GfxTexFilterMode, GfxMipFilterMode] {
            // "Debug Mode" Menu showing like this
            // 0x00: "LINER & MIPMAP NEAR, LINER"  (mipmap: 0) linear?
            // 0x01: "LINER & MIPMAP LINER, LINER" (mipmap: 1) binear?
            // 0x02: "LINER & MIPMAP LINER, LINER" (mipmap: 3) trilinear?
            // 0x04: "LINER & MIPMAP LINER, LINER"
            // 0x08: "NEAR & MIPMAP NEAR, NEAR (NEAR FLAG)" (mipmap: 0)
            // 0x10: "LINER & MIPMAP NEAR, LINER"
            let texFilter = GfxTexFilterMode.POINT;
            let MipFilter = GfxMipFilterMode.NO_MIP;

            if ((mipmapAV & (1 << 1)) !== 0){
                texFilter = GfxTexFilterMode.BILINEAR;
                MipFilter = GfxMipFilterMode.LINEAR;
            }

            return [ texFilter, MipFilter ]
        }

        for (let i = 0; i < 8; i++) {
            const [minFilter, mipFilter] = translateAVTexFilterGfx(sampler.mipmapAV);
            const [magFilter]            = translateAVTexFilterGfx(sampler.mipmapAV);

            const gfxSampler = device.createSampler({
                wrapS: translateWrapModeGfx(sampler.wrapS),
                wrapT: translateWrapModeGfx(sampler.wrapT),
                minFilter, 
                mipFilter, 
                magFilter,
                minLOD: 0,
                maxLOD: 100,
            });

            this.gfxSamplers[i] = gfxSampler;
        }
    }

    public destroy(device: GfxDevice): void {
        this.gfxSamplers.forEach((r) => device.destroySampler(r));
    }
}
