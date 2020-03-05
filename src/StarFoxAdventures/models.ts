import * as Viewer from '../viewer';
import { nArray } from '../util';
import { mat4 } from 'gl-matrix';
import { GfxDevice, GfxSampler, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import { GX_VtxDesc, GX_VtxAttrFmt, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array } from '../gx/gx_displaylist';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, fillSceneParams } from '../gx/gx_render';
import { GXMaterial } from '../gx/gx_material';
import { Camera, computeViewMatrix } from '../Camera';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor, BasicRenderTarget, ColorTexture } from '../gfx/helpers/RenderTargetHelpers';

import { SFATexture } from './textures';
import { SFAMaterial } from './shaders';

export class ModelInstance {
    private loadedVertexLayout: LoadedVertexLayout;
    private loadedVertexData: LoadedVertexData;
    private shapeHelper: GXShapeHelperGfx | null = null;
    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();
    private packetParams = new PacketParams();
    private material: SFAMaterial;
    private sceneTextureSampler: GfxSampler | null = null;

    constructor(vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: ArrayBufferSlice) {
        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;
        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList);
    }

    // Caution: Material is referenced, not copied.
    public setMaterial(material: SFAMaterial) {
        this.material = material;

        this.materialHelper = new GXMaterialHelperGfx(material.material);
    }

    private computeModelView(dst: mat4, camera: Camera, modelMatrix: mat4): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, sceneTexture: ColorTexture) {
        if (this.shapeHelper === null) {
            const bufferCoalescer = loadedDataCoalescerComboGfx(device, [this.loadedVertexData]);
            this.shapeHelper = new GXShapeHelperGfx(device, renderInstManager.gfxRenderCache, bufferCoalescer.coalescedBuffers[0], this.loadedVertexLayout, this.loadedVertexData);
        }
        
        this.packetParams.clear();

        const renderInst = renderInstManager.newRenderInst();
        this.shapeHelper.setOnRenderInst(renderInst);
        const materialOffs = this.materialHelper.allocateMaterialParams(renderInst);

        for (let i = 0; i < 8; i++) {
            const tex = this.material.textures[i];
            if (tex === undefined || tex === null) {
                this.materialParams.m_TextureMapping[i].reset();
            } else if (tex.kind === 'fb-color-downscaled-8x') {
                this.materialParams.m_TextureMapping[i].gfxTexture = sceneTexture.gfxTexture;
                if (this.sceneTextureSampler === null) {
                    this.sceneTextureSampler = device.createSampler({
                        wrapS: GfxWrapMode.REPEAT,
                        wrapT: GfxWrapMode.REPEAT,
                        minFilter: GfxTexFilterMode.BILINEAR,
                        magFilter: GfxTexFilterMode.BILINEAR,
                        mipFilter: GfxMipFilterMode.NO_MIP,
                        minLOD: 0,
                        maxLOD: 100,
                    });
                }
                this.materialParams.m_TextureMapping[i].gfxSampler = this.sceneTextureSampler;
                this.materialParams.m_TextureMapping[i].width = sceneTexture.width;
                this.materialParams.m_TextureMapping[i].height = sceneTexture.height;
                this.materialParams.m_TextureMapping[i].lodBias = 0.0;
            } else if (tex.kind === 'texture') {
                this.materialParams.m_TextureMapping[i].gfxTexture = tex.texture.gfxTexture;
                this.materialParams.m_TextureMapping[i].gfxSampler = tex.texture.gfxSampler;
                this.materialParams.m_TextureMapping[i].width = tex.texture.width;
                this.materialParams.m_TextureMapping[i].height = tex.texture.height;
                this.materialParams.m_TextureMapping[i].lodBias = 0.0;
            }
        }
        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialOffs, this.materialParams);
        this.computeModelView(this.packetParams.u_PosMtx[0], viewerInput.camera, modelMatrix);
        this.shapeHelper.fillPacketParams(this.packetParams, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }
}