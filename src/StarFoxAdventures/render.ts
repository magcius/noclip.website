import * as Viewer from '../viewer';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, loadTextureFromMipChain, translateWrapModeGfx, translateTexFilterGfx } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler, GfxTextureDimension } from '../gfx/platform/GfxPlatform';
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
import { hexzero } from '../util';
import { GfxFormat, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxBuffer, GfxInputLayout, GfxInputState, GfxMegaStateDescriptor, GfxProgram, GfxVertexBufferFrequency, GfxRenderPass, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { decodeTex_IA16, decodeTex_RGBA16, decodeTex_I4, decodeTex_RGBA32, decodeTex_I8 } from '../Common/N64/Image';

interface LoadedTexture {
    offset: number;
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

function loadTex(texData: ArrayBufferSlice, offset: number): LoadedTexture {
    const dv = texData.createDataView();
    const result = {
        offset,
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

function loadAncientTex(texData: ArrayBufferSlice, offset: number): LoadedTexture {
    const dv = texData.createDataView();
    const result = {
        offset,
        texture: {
            name: `Texture`,
            width: dv.getUint8(0) & 0x7f,
            height: dv.getUint8(1) & 0x7f,
            format: dv.getUint8(2), // ??????
            data: texData.slice(0x20),
            // @0x14: total data size (including header) (SOMETIMES!)
            mipCount: 1,
        },
        wrapS: GX.WrapMode.REPEAT,
        wrapT: GX.WrapMode.REPEAT,
        minFilt: GX.TexFilter.LINEAR,
        magFilt: GX.TexFilter.LINEAR,
    };
    return result;

}

function decodeTex(device: GfxDevice, loaded: LoadedTexture, isAncient: boolean): DecodedTexture {
    let gfxTexture;
    if (!isAncient) {
        const mipChain = GX_Texture.calcMipChain(loaded.texture, 1);
        gfxTexture = loadTextureFromMipChain(device, mipChain).gfxTexture;
    } else {
        gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, loaded.texture.width, loaded.texture.height, loaded.texture.mipCount));

        const dv = loaded.texture.data!.createDataView();
        const pixels = new Uint8Array(loaded.texture.width * loaded.texture.height * 4);
        let src = 0;
        let dst = 0;
        switch (loaded.texture.format) {
        case 0x00: // 32-bit RGBA? Size is 4 * width * height, not including header. might be mipmapped.
            decodeTex_RGBA32(pixels, dv, 0, loaded.texture.width, loaded.texture.height, 0);
            break;
        case 0x01: // Appears to be 16-bit
            console.log(`loading format 0x${loaded.texture.format.toString(16)} from offset 0x${loaded.offset.toString(16)}`);
            decodeTex_RGBA16(pixels, dv, 0, loaded.texture.width, loaded.texture.height, 0, false); // FIXME: where is the line parameter stored?
            break;
        case 0x05: // Appears to be 8-bit
            decodeTex_I8(pixels, dv, 0, loaded.texture.width, loaded.texture.height, 0 /*loaded.texture.width / 4*/, false);
            break;
        case 0x11: // Appears to be 16-bit
            decodeTex_IA16(pixels, dv, 0, loaded.texture.width, loaded.texture.height, 0, false);
            break;
        case 0x15: // 24-bit RGB??! Size is 3 * width * height, not including header. might be mipmapped.
            console.log(`loading format 0x${loaded.texture.format.toString(16)} from offset 0x${loaded.offset.toString(16)}`);
            decodeTex_RGBA16(pixels, dv, 0, loaded.texture.width, loaded.texture.height, 0, false); // FIXME: where is the line parameter stored?
            break;
        case 0x25: // Appears to be 8-bit
            decodeTex_I8(pixels, dv, 0, loaded.texture.width, loaded.texture.height, 0 /*loaded.texture.width / 4*/, false);
            break;
        case 0x26: // Appears to be 4-bit
            decodeTex_I4(pixels, dv, 0, loaded.texture.width, loaded.texture.height, 0, false);
            break;
        default:
            throw Error(`Unhandled texture format 0x${loaded.texture.format.toString(16)} at offset 0x${loaded.offset.toString(16)}`);
        }

        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        device.submitPass(hostAccessPass);
    }
    
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

function isValidTextureTabValue(tabValue: number, isAncient: boolean) {
    if (isAncient) {
        return tabValue != 0xFFFFFFFF;
    } else {
        return tabValue != 0xFFFFFFFF && (tabValue & 0x80000000) != 0;
    }
}

function loadFirstValidTexture(device: GfxDevice, tab: ArrayBufferSlice, bin: ArrayBufferSlice, isAncient: boolean): DecodedTexture | null {
    const tabDv = tab.createDataView();
    let firstValidId = 0;
    let found = false;
    for (let i = 0; i < tab.byteLength; i += 4) {
        const tabValue = tabDv.getUint32(i);
        if (tabValue == 0xFFFFFFFF) {
            console.log(`no valid id found`);
            break;
        }
        if (isValidTextureTabValue(tabValue, isAncient)) {
            found = true;
            break;
        }
        ++firstValidId;
    }
    if (!found) {
        return null;
    }
    console.log(`loading first valid id ${firstValidId}`);
    return loadTextureFromTable(device, tab, bin, firstValidId, isAncient);
}

function loadTextureFromTable(device: GfxDevice, tab: ArrayBufferSlice, bin: ArrayBufferSlice, id: number, isAncient: boolean = false): (DecodedTexture | null) {
    const tabDv = tab.createDataView();
    const idOffs = id * 4;
    if (idOffs < 0 || idOffs + 4 >= tabDv.byteLength) {
        console.warn(`Texture id 0x${id.toString(16)} out of range; using first valid texture!`);
        return loadFirstValidTexture(device, tab, bin, isAncient);
    }
    const tab0 = tabDv.getUint32(id * 4);
    if (isValidTextureTabValue(tab0, isAncient)) {
        // Loadable texture (?)
        const binOffs = isAncient ? tab0 : ((tab0 & 0x00FFFFFF) * 2);
        const compData = bin.slice(binOffs);
        const uncompData = isAncient ? compData : loadRes(compData);
        let loaded;
        if (isAncient) {
            loaded = loadAncientTex(uncompData, tab0);
        } else {
            loaded = loadTex(uncompData, (tab0 & 0x00FFFFFF) * 2);
        }
        const decoded = decodeTex(device, loaded, isAncient);
        return decoded;
    } else {
        // TODO: also seen is value 0x01000000
        console.warn(`Texture id 0x${id.toString(16)} (tab value 0x${hexzero(tab0, 8)}, isAncient: ${isAncient}) not found in table; using first valid texture!`);
        return loadFirstValidTexture(device, tab, bin, isAncient);
    }
}

export class TextureCollection {
    decodedTextures: (DecodedTexture | null)[] = [];

    constructor(public tex1Tab: ArrayBufferSlice, public tex1Bin: ArrayBufferSlice, private isAncient: boolean = false, private textable: DataView | null = null) {
    }

    public getTexture(device: GfxDevice, textureNum: number) {
        // FIXME: texture mappings are wrong. TEXTABLE doesn't contain the needed information to fix them.
        // if (this.isAncient) {
        //     textureNum = this.textable!.getUint16(textureNum * 2);
        // }
        if (this.decodedTextures[textureNum] === undefined) {
            this.decodedTextures[textureNum] = loadTextureFromTable(device, this.tex1Tab, this.tex1Bin, textureNum, this.isAncient);
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