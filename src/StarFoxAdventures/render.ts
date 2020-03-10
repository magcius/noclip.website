import * as Viewer from '../viewer';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, fillSceneParams } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { GX_VtxDesc, GX_VtxAttrFmt, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array } from '../gx/gx_displaylist';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { mat4 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GXMaterial } from '../gx/gx_material';

import { SFATexture } from './textures';

export class ModelInstance {
    private loadedVertexLayout: LoadedVertexLayout;
    private loadedVertexData: LoadedVertexData;
    private shapeHelper: GXShapeHelperGfx | null = null;
    private materialHelper: GXMaterialHelperGfx;
    private textures: (SFATexture | null)[] = [];
    private materialParams = new MaterialParams();
    private packetParams = new PacketParams();

    constructor(vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: ArrayBufferSlice) {
        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;
        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList);
    }

    public setMaterial(material: GXMaterial) {
        this.materialHelper = new GXMaterialHelperGfx(material);
    }

    public setTextures(textures: (SFATexture | null)[]) {
        this.textures = textures;
        for (let i = 0; i < 8; i++) {
            if (this.textures[i]) {
                const tex = this.textures[i]!;
                this.materialParams.m_TextureMapping[i].gfxTexture = tex.gfxTexture;
                this.materialParams.m_TextureMapping[i].gfxSampler = tex.gfxSampler;
                this.materialParams.m_TextureMapping[i].width = tex.width;
                this.materialParams.m_TextureMapping[i].height = tex.height;
                this.materialParams.m_TextureMapping[i].lodBias = 0.0;
            } else {
                this.materialParams.m_TextureMapping[i].reset();
            }
        }
    }

    private computeModelView(dst: mat4, camera: Camera, modelMatrix: mat4): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4) {
        if (this.shapeHelper === null) {
            const bufferCoalescer = loadedDataCoalescerComboGfx(device, [this.loadedVertexData]);
            this.shapeHelper = new GXShapeHelperGfx(device, renderInstManager.gfxRenderCache, bufferCoalescer.coalescedBuffers[0], this.loadedVertexLayout, this.loadedVertexData);
        }
        
        this.packetParams.clear();

        const renderInst = renderInstManager.newRenderInst();
        this.shapeHelper.setOnRenderInst(renderInst);
        const materialOffs = this.materialHelper.allocateMaterialParams(renderInst);

        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialOffs, this.materialParams);
        this.computeModelView(this.packetParams.u_PosMtx[0], viewerInput.camera, modelMatrix);
        this.shapeHelper.fillPacketParams(this.packetParams, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }
}

export class SFARenderer extends BasicGXRendererHelper {
    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        // Draw sky
        const skyTemplate = this.renderHelper.pushTemplateRenderInst();
        const oldProjection = mat4.create();
        mat4.copy(oldProjection, viewerInput.camera.projectionMatrix);
        mat4.identity(viewerInput.camera.projectionMatrix);
        fillSceneParamsDataOnTemplate(skyTemplate, viewerInput, false);
        this.renderSky(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();

        mat4.copy(viewerInput.camera.projectionMatrix, oldProjection);

        // Draw world
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput, false);
        this.renderWorld(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device, hostAccessPass);
    }
}
