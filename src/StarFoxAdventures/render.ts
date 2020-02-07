import * as Viewer from '../viewer';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, loadTextureFromMipChain, translateWrapModeGfx, translateTexFilterGfx } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from '../gfx/platform/GfxPlatform';
import { GX_VtxDesc, GX_VtxAttrFmt, compileLoadedVertexLayout, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array, getAttributeByteSize } from '../gx/gx_displaylist';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import * as GX from '../gx/gx_enum';
import * as GX_Texture from '../gx/gx_texture';
import { mat4 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { loadRes } from './resource';
import { GXMaterial } from '../gx/gx_material';

interface LoadedTexture {
    texture: GX_Texture.Texture;
    wrapS: number;
    wrapT: number;
    minFilt: number;
    magFilt: number;
}

interface DecodedTexture {
    loadedTexture: LoadedTexture;
    gfxTexture: GfxTexture;
    gfxSampler: GfxSampler;
}

function loadTex(texData: ArrayBufferSlice): LoadedTexture {
    const dv = texData.createDataView();
    const result = {
        texture: {
            name: `Texture`,
            width: dv.getUint16(0x0A),
            height: dv.getUint16(0x0C),
            format: dv.getUint8(0x16),
            data: texData.slice(0x60),
            mipCount: 1,
        },
        wrapS: dv.getUint8(0x17),
        wrapT: dv.getUint8(0x18),
        minFilt: dv.getUint8(0x19),
        magFilt: dv.getUint8(0x1A),
    };
    return result;
}

function decodeTex(device: GfxDevice, loaded: LoadedTexture): DecodedTexture {
    const mipChain = GX_Texture.calcMipChain(loaded.texture, 1);
    const gfxTexture = loadTextureFromMipChain(device, mipChain).gfxTexture;
    
    // GL texture is bound by loadTextureFromMipChain.
    const gfxSampler = device.createSampler({
        wrapS: translateWrapModeGfx(loaded.wrapS),
        wrapT: translateWrapModeGfx(loaded.wrapT),
        minFilter: translateTexFilterGfx(loaded.minFilt)[0], // TODO: implement mip filters
        magFilter: translateTexFilterGfx(loaded.magFilt)[0],
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0,
        maxLOD: 100,
    });

    return { loadedTexture: loaded, gfxTexture, gfxSampler };
}

function loadTextureFromTable(device: GfxDevice, tab: ArrayBufferSlice, bin: ArrayBufferSlice, id: number): (DecodedTexture | null) {
    const tabDv = tab.createDataView();
    const idOffs = id * 4;
    if (idOffs < 0 || idOffs + 4 >= tabDv.byteLength) {
        console.warn(`Texture id 0x${id.toString(16)} out of range; using first valid texture!`);
        let firstValidId = 0;
        for (let i = 0; i < tab.byteLength; i += 4) {
            if (tabDv.getUint32(i) & 0x80000000) {
                break;
            }
            ++firstValidId;
        }
        return loadTextureFromTable(device, tab, bin, firstValidId);
        // return null;
        // return null;
    }
    const tab0 = tabDv.getUint32(id * 4);
    // console.log(`tex ${id} tab 0x${hexzero(tab0, 8)}`);
    if (tab0 & 0x80000000) {
        // Loadable texture (?)
        const binOffs = (tab0 & 0x00FFFFFF) * 2;
        const compData = bin.slice(binOffs);
        const uncompData = loadRes(compData);
        const loaded = loadTex(uncompData);
        const decoded = decodeTex(device, loaded);
        return decoded;
    } else {
        // TODO: also seen is value 0x01000000
        console.warn(`Texture id 0x${id.toString(16)} not found in table; using first valid texture!`);
        let firstValidId = 0;
        for (let i = 0; i < tab.byteLength; i += 4) {
            if (tabDv.getUint32(i) & 0x80000000) {
                break;
            }
            ++firstValidId;
        }
        return loadTextureFromTable(device, tab, bin, firstValidId);
        // return null;
    }
}

export class TextureCollection {
    decodedTextures: (DecodedTexture | null)[] = [];

    constructor(public tex1Tab: ArrayBufferSlice, public tex1Bin: ArrayBufferSlice) {
    }

    public getTexture(device: GfxDevice, textureNum: number) {
        if (this.decodedTextures[textureNum] === undefined) {
            this.decodedTextures[textureNum] = loadTextureFromTable(device, this.tex1Tab, this.tex1Bin, textureNum);
        }

        return this.decodedTextures[textureNum];
    }
}

export class ModelInstance {
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
    shapeHelper: GXShapeHelperGfx | null = null;
    materialHelper: GXMaterialHelperGfx;
    textures: (DecodedTexture | null)[] = [];
    // modelMatrix: mat4 = mat4.create();

    constructor(vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: ArrayBufferSlice, enableCull: boolean) {
        const mb = new GXMaterialBuilder('Basic');
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
        mb.setZMode(true, GX.CompareType.LESS, true);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.RASC);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.RASA);
        // mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC);
        // mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setCullMode(enableCull ? GX.CullMode.BACK : GX.CullMode.NONE);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;

        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList);
    }

    public setMaterial(material: GXMaterial) {
        this.materialHelper = new GXMaterialHelperGfx(material);
    }

    public setTextures(textures: (DecodedTexture | null)[]) {
        this.textures = textures;
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
        
        const materialParams = new MaterialParams();
        const packetParams = new PacketParams();
        packetParams.clear();

        const renderInst = this.shapeHelper.pushRenderInst(renderInstManager);
        const materialOffs = this.materialHelper.allocateMaterialParams(renderInst);
        for (let i = 0; i < 8; i++) {
            if (this.textures[i]) {
                const tex = this.textures[i]!;
                materialParams.m_TextureMapping[i].gfxTexture = tex.gfxTexture;
                materialParams.m_TextureMapping[i].gfxSampler = tex.gfxSampler;
                materialParams.m_TextureMapping[i].width = tex.loadedTexture.texture.width;
                materialParams.m_TextureMapping[i].height = tex.loadedTexture.texture.height;
                materialParams.m_TextureMapping[i].lodBias = 0.0;
            } else {
                materialParams.m_TextureMapping[i].reset();
            }
        }
        mat4.identity(materialParams.u_TexMtx[0])
        // this.materialCommand.fillMaterialParams(materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialOffs, materialParams);
        this.computeModelView(packetParams.u_PosMtx[0], viewerInput.camera, modelMatrix);
        this.shapeHelper.fillPacketParams(packetParams, renderInst);

        // renderInstManager.popTemplateRenderInst();
    }
}

export class SFARenderer extends BasicGXRendererHelper {
    models: ModelInstance[] = [];
    modelMatrices: mat4[] = [];

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