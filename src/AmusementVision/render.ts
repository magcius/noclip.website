import * as GMA from './gma';
import * as GX_Material from '../gx/gx_material';
import { AVTexture, AVTpl } from './AVtpl';

import { LoadedVertexDraw } from '../gx/gx_displaylist';
import { GfxBufferCoalescerCombo } from "../gfx/helpers/BufferHelpers";
import { GfxDevice, GfxNormalizedViewportCoords, GfxSampler } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { ColorKind, GXMaterialHelperGfx, GXShapeHelperGfx, GXTextureHolder, loadedDataCoalescerComboGfx, MaterialParams, PacketParams, translateTexFilterGfx, translateWrapModeGfx } from "../gx/gx_render";
import { mat4 } from 'gl-matrix';
import { Camera, computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { Color} from '../Color';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKey, setSortKeyBias, setSortKeyDepth } from '../gfx/render/GfxRenderer';
import { computeNormalMatrix } from '../MathHelpers';
import { nArray } from '../util';
import { AABB, IntersectionState } from '../Geometry';
import { ViewerRenderInput } from '../viewer';


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
    public shapeData: GXShapeHelperGfx[] = [];
    public materialData: MaterialData[] = [];
    private bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, cache: GfxRenderCache, public gcmfEntry: GMA.GcmfEntry, private materialHacks?: GX_Material.GXMaterialHacks) {
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, gcmfEntry.gcmf.shapes.map((shape) => shape.loadedVertexData));

        const gcmf = gcmfEntry.gcmf;
        for (let i = 0; i < gcmf.shapes.length; i++) {
            const shape = gcmf.shapes[i];
            const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[i];
            this.shapeData[i] = new GXShapeHelperGfx(device, cache, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer, shape.loadedVertexLayout, shape.loadedVertexData);
        }

        for (let i = 0; i < gcmf.shapes.length; i++) {
            const material = gcmf.shapes[i].material;
            const texture = gcmf.textures[material.tex0Idx];
            this.materialData[i] = new MaterialData(device, material, texture);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapeData.length; i++)
            this.shapeData[i].destroy(device);
        for (let i = 0; i < this.materialData.length; i++)
            this.materialData[i].destroy(device);
        this.bufferCoalescer.destroy(device);
    }
}

const bboxScratch = new AABB();
const packetParams = new PacketParams();
class ShapeInstance {
    public sortKeyBias = 0;

    constructor(public shape: GMA.GcmfShape, public shapeData: GXShapeHelperGfx, public materialInstance: MaterialInstance) {
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
        
        packetParams.clear();
        for (let p = 0; p < this.shape.loadedVertexData.draws.length; p++) {
            const packet = this.shape.loadedVertexData.draws[p];

            const renderInst = renderInstManager.newRenderInst();
            this.shapeData.setOnRenderInst(renderInst, packet);
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

const materialParams = new MaterialParams();
class MaterialInstance {
    public materialHelper: GXMaterialHelperGfx;
    public sortKey: number = 0;
    public visible = true;

    constructor(private modelInstance: GcmfModelInstance, public materialData: MaterialData) {
        const gxMaterial: GX_Material.GXMaterial = Object.assign({}, materialData.material.gxMaterial);
        gxMaterial.useTexMtxIdx = nArray(8, () => false);

        this.materialHelper = new GXMaterialHelperGfx(gxMaterial, materialData.materialHacks);
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

    private fillMaterialParamsData(materialParams: MaterialParams, textureHolder: GXTextureHolder, instanceStateData: InstanceStateData, posNrmMatrixIdx: number, packet: LoadedVertexDraw | null = null, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
        const material = this.materialData.material;

        // Fill in our environment mapped texture matrices.
        for (let i = 0; i < 10; i++) {
            let texMtxIdx: number;
            if (packet !== null) {
                texMtxIdx = packet.texMatrixTable[i];

                // Don't bother computing a normal matrix if the matrix is unused.
                if (texMtxIdx === 0xFFFF)
                    continue;
            } else {
                texMtxIdx = posNrmMatrixIdx;
            }

            computeNormalMatrix(materialParams.u_TexMtx[i], instanceStateData.drawViewMatrixArray[texMtxIdx]);
        }

        for (let i = 0; i < 8; i++)
            this.calcTexMatrix(materialParams, i, camera, viewport);
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.materialHelper.setOnRenderInst(device, cache, renderInst);
    }

    public fillMaterialParams(renderInst: GfxRenderInst, textureHolder: GXTextureHolder, instanceStateData: InstanceStateData, posNrmMatrixIdx: number, packet: LoadedVertexDraw | null, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
        this.fillMaterialParamsData(materialParams, textureHolder, instanceStateData, posNrmMatrixIdx, packet, camera, viewport);
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
        this.instanceStateData.drawViewMatrixArray = nArray(gcmfModel.gcmfEntry.gcmf.mtxCount, () => mat4.create());
        while (matrixScratchArray.length < this.instanceStateData.jointToWorldMatrixArray.length)
            matrixScratchArray.push(mat4.create());

        for (let i = 0; i < this.gcmfModel.materialData.length; i++)
            this.materialInstances[i] = new MaterialInstance(this, this.gcmfModel.materialData[i]);
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

        if (this.isSkybox)
            computeViewMatrixSkybox(viewMatrix, camera);
        else
            computeViewMatrix(viewMatrix, camera);
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

        let depth = -1;

        if (depth < 0)
            return;

        this.calcView(camera);

        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = this.passMask;
        for (let i = 0; i < this.shapeInstances.length; i++) {
            const shapeInstance = this.shapeInstances[i];
            // const shapeVisibility = shapeInstance.sortVizNode.visible;
            // if (!shapeVisibility)
            //     continue;
            shapeInstance.prepareToRender(device, this.textureHolder, renderInstManager, depth, camera, viewerInput.viewport, this.instanceStateData, this.isSkybox);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
    }

}

// export const enum AVTexFilter{
//     LINER_MIP_NEAR_LINER = 0,
//     // 0x00: LINER & MIPMAP NEAR, LINER (mipmap:0)
//     // 0x01: LINER & MIPMAP LINER, LINER (mipmap:1) liner?
//     // 0x02: LINER & MIPMAP LINER, LINER (mipmap:3) tri liner?
//     // 0x04: LINER & MIPMAP LINER, LINER
//     // 0x08: NEAR & MIPMAP NEAR, NEAR (NEAR FLAG) (mipmap:0)
//     // 0x10: LINER & MIPMAP NEAR, LINER
// }

// function translateTexFilterGfxAV(texFilter: AVTexFilter): [GfxTexFilterMode, GfxMipFilterMode] {
//     switch (texFilter) {
//         case AVTexFilter.LINER_MIP_NEAR_LINER:
//             return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP ];
//         case GX.TexFilter.NEAR:
//             return [ GfxTexFilterMode.POINT, GfxMipFilterMode.NO_MIP ];
//         case GX.TexFilter.LIN_MIP_LIN:
//             return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR ];
//         case GX.TexFilter.NEAR_MIP_LIN:
//             return [ GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR ];
//         case GX.TexFilter.LIN_MIP_NEAR:
//             return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST ];
//         case GX.TexFilter.NEAR_MIP_NEAR:
//             return [ GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST ];
//     }
// }

const matrixScratch = mat4.create();
class MaterialData {
    public gfxSamplers: GfxSampler[] = [];

    constructor(device: GfxDevice, public material: GMA.GcmfMaterial, public texture: GMA.GcmfTexture, public materialHacks?: GX_Material.GXMaterialHacks) {
        const [minFilter, mipFilter] = translateTexFilterGfx(texture.mipmap);
        const [magFilter]            = translateTexFilterGfx(texture.mipmap);
        
        const gfxSampler = device.createSampler({
            wrapS: translateWrapModeGfx(texture.wrapS),
            wrapT: translateWrapModeGfx(texture.wrapT),
            minFilter, mipFilter, magFilter,
            minLOD: 0,
            maxLOD: 100,
        });

        this.gfxSamplers[0] = gfxSampler;
    }

    public destroy(device: GfxDevice): void {
        this.gfxSamplers.forEach((r) => device.destroySampler(r));
    }
}
