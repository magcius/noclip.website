
import * as Viewer from '../viewer';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { GX_VtxDesc, GX_VtxAttrFmt, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array } from '../gx/gx_displaylist';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import * as GX from '../gx/gx_enum';
import { mat4 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GXMaterial } from '../gx/gx_material';

import { SFATexture } from './textures';

export class ModelInstance {
    public loadedVertexLayout: LoadedVertexLayout;
    public loadedVertexData: LoadedVertexData;
    public shapeHelper: GXShapeHelperGfx | null = null;
    public materialHelper: GXMaterialHelperGfx;
    public textures: (SFATexture | null)[] = [];

    constructor(vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: ArrayBufferSlice) {
        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);

        if (window.debug)
            console.log(JSON.stringify({ vat, vcd }), vtxLoader);

        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;
        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList);
    }

    public setMaterial(material: GXMaterial) {
        this.materialHelper = new GXMaterialHelperGfx(material);
    }

    public setTextures(textures: (SFATexture | null)[]) {
        this.textures = textures;
    }

    private computeModelView(dst: mat4, camera: Camera, modelMatrix: mat4): void {
        computeViewMatrix(dst, camera);
        // Rotate camera 90 degrees clockwise to more reliably get something in
        // view when loading a scene. TODO: A better way to set the initial camera
        // is to make default save states for each scene.
        mat4.rotateY(dst, dst, Math.PI / 2);
        mat4.mul(dst, dst, modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4) {
        if (this.shapeHelper === null) {
            const bufferCoalescer = loadedDataCoalescerComboGfx(device, [this.loadedVertexData]);
            this.shapeHelper = new GXShapeHelperGfx(device, renderInstManager.gfxRenderCache, bufferCoalescer.coalescedBuffers[0], this.loadedVertexLayout, this.loadedVertexData);
        }
        
        const materialParams = new MaterialParams();
        const packetParams = new PacketParams();
        packetParams.clear();

        const renderInst = renderInstManager.newRenderInst();
        this.shapeHelper.setOnRenderInst(renderInst);
        const materialOffs = this.materialHelper.allocateMaterialParams(renderInst);
        for (let i = 0; i < 8; i++) {
            if (this.textures[i]) {
                const tex = this.textures[i]!;
                materialParams.m_TextureMapping[i].gfxTexture = tex.gfxTexture;
                materialParams.m_TextureMapping[i].gfxSampler = tex.gfxSampler;
                materialParams.m_TextureMapping[i].width = tex.width;
                materialParams.m_TextureMapping[i].height = tex.height;
                materialParams.m_TextureMapping[i].lodBias = 0.0;
            } else {
                materialParams.m_TextureMapping[i].reset();
            }
        }

        mat4.identity(materialParams.u_TexMtx[0]);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialOffs, materialParams);
        this.computeModelView(packetParams.u_PosMtx[0], viewerInput.camera, modelMatrix);
        this.shapeHelper.fillPacketParams(packetParams, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }
}

export class SFARenderer extends BasicGXRendererHelper {
    public models: ModelInstance[] = [];
    public modelMatrices: mat4[] = [];

    public clearModels() {
        this.models = [];
        this.modelMatrices = [];
    }

    public addModel(model: ModelInstance, modelMatrix: mat4) {
        this.models.push(model);
        this.modelMatrices.push(modelMatrix);
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        
        fillSceneParamsDataOnTemplate(template, viewerInput, false);
        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, this.modelMatrices[i]);
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }
}
