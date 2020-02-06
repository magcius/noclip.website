import * as pako from 'pako';
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import * as GX_Material from '../gx/gx_material';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX_Texture from '../gx/gx_texture';

import { DataFetcher } from '../DataFetcher';
import { hexzero, nArray } from '../util';
import * as GX from '../gx/gx_enum';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, loadTextureFromMipChain, translateWrapModeGfx, translateTexFilterGfx } from '../gx/gx_render';
import { GX_VtxDesc, GX_VtxAttrFmt, compileLoadedVertexLayout, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array, getAttributeByteSize } from '../gx/gx_displaylist';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Camera, computeViewMatrix } from '../Camera';
import { mat4 } from 'gl-matrix';
import { gx_texture_asExports } from '../wat_modules';
import { AreaRenderer } from '../GrandTheftAuto3/render';
import { matrixHasUniformScale } from '../MathHelpers';


abstract class BlockFetcher {
    public abstract getBlock(num: number, trkblk: number, subnum: number): ArrayBufferSlice | null;
}

interface GameInfo {
    pathBase: string;
    subdirs: {[key: number]: string};
    makeBlockFetcher: (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => Promise<BlockFetcher>;
}

class SFABlockFetcher implements BlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;
    isDeletedMap: boolean;

    public async create(locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) {
        const pathBase = gameInfo.pathBase;
        const subdir = getSubdir(locationNum, gameInfo);
        if (subdir == 'linklevel' || subdir == 'insidegal' || subdir == 'crfort') {
            console.log(`Holy smokes! Loading a deleted map!`);
            this.isDeletedMap = true;
        }
        this.blocksTab = (await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.tab`)).createDataView();
        if (this.isDeletedMap) {
            this.blocksBin = await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.bin`);
        } else {
            this.blocksBin = await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.zlb.bin`);
        }
    }

    public getBlock(num: number, trkblk: number, subnum: number): ArrayBufferSlice | null {
        if (this.isDeletedMap) {
            // Different handling for blocks from the demo version's deleted maps
            // Find a workable block number...
            let firstBlockNum = 0;
            for (let i = 0; i < this.blocksTab.byteLength/4; i++) {
                if (this.blocksTab.getUint32(i * 4) == 0x10000000)
                    break;
                firstBlockNum++;
            }

            const num = firstBlockNum + subnum;
            if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
                return null;
            }
            const tabValue = this.blocksTab.getUint32(num * 4);
            if (!(tabValue & 0x10000000)) {
                return null;
            }
            const blockOffset = tabValue & 0xFFFFFF;
            console.log(`Loading deleted block from offset 0x${blockOffset.toString(16)}`);
            const blocksBinPart = this.blocksBin.slice(blockOffset);
            return blocksBinPart;
        }

        if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
            return null;
        }
        const tabValue = this.blocksTab.getUint32(num * 4);
        if (!(tabValue & 0x10000000)) {
            return null;
        }
        const blockOffset = tabValue & 0xFFFFFF;
        const blocksBinPart = this.blocksBin.slice(blockOffset);
        const uncomp = loadRes(blocksBinPart);
        return uncomp;
    }
}

const SFA_GAME_INFO: GameInfo = {
    pathBase: 'sfa',
    makeBlockFetcher: async (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => {
        const result = new SFABlockFetcher();
        await result.create(locationNum, dataFetcher, gameInfo);
        return result;
    },
    subdirs: {
        0: 'animtest',
        2: 'animtest',
        3: 'arwing', // ???
        5: 'animtest',
        6: 'dfptop',
        7: 'volcano',
        9: 'mazecave',
        10: 'dragrockbot',
        11: 'crfort', // ???
        12: 'swaphol',
        14: 'nwastes',
        15: 'warlock',
        16: 'shop',
        18: 'crfort',
        19: 'swapholbot',
        20: 'wallcity',
        21: 'lightfoot',
        24: 'clouddungeon',
        25: 'mmpass',
        26: 'darkicemines',
        28: 'desert',
        29: 'shipbattle', // ???
        30: 'icemountain',
        31: 'animtest',
        34: 'darkicemines2',
        35: 'bossgaldon',
        37: 'insidegal',
        38: 'magiccave',
        39: 'dfshrine',
        40: 'mmshrine',
        41: 'ecshrine',
        42: 'gpshrine',
        43: 'dbshrine',
        44: 'nwshrine',
        45: 'worldmap',
        47: 'capeclaw',
        50: 'cloudrace',
        51: 'bossdrakor',
        53: 'bosstrex',
        54: 'linkb',
        56: 'arwingtoplanet',
        57: 'arwingdarkice',
        58: 'arwingcloud',
        59: 'arwingcity',
        60: 'arwingdragon',
        61: 'gamefront',
        62: 'linklevel',
        63: 'greatfox',
        64: 'linka',
        65: 'linkc',
        66: 'linkd',
        67: 'linke',
        68: 'linkf',
        69: 'linkg',
        70: 'linkh',
        71: 'linkj',
        72: 'linki',
    },
}

class SFADemoBlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;

    public async create(locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) {
        const pathBase = gameInfo.pathBase;
        this.blocksTab = (await dataFetcher.fetchData(`${pathBase}/BLOCKS.tab`)).createDataView();
        this.blocksBin = await dataFetcher.fetchData(`${pathBase}/BLOCKS.bin`);
    }

    public getBlock(num: number): ArrayBufferSlice | null {
        if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
            return null;
        }
        const blockOffset = this.blocksTab.getUint32(num * 4);
        console.log(`Loading block ${num} from BLOCKS.bin offset 0x${blockOffset.toString(16)}`);
        const blocksBinPart = this.blocksBin.slice(blockOffset);
        return blocksBinPart;
    }
}

const SFADEMO_GAME_INFO: GameInfo = {
    pathBase: 'sfademo',
    makeBlockFetcher: async (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => {
        const result = new SFADemoBlockFetcher();
        await result.create(locationNum, dataFetcher, gameInfo);
        return result;
    },
    subdirs: {
        0: 'animtest',
        1: 'dragrock',
        2: 'dragrockbot',
        3: 'swapholbot',
        4: 'wallcity',
        5: 'lightfoot',
        6: 'cloudtreasure',
        7: 'clouddungeon',
        8: 'darkicemines',
        //9: 'icemountain',
        9: 'mazecave', // ????
        10: 'darkicemines2',
        11: 'bossgaldon',
        12: 'insidegal',
        //13: 'magiccave',
        13: 'swaphol', // ???
        14: 'dfshrine',
        15: 'mmshrine',
        16: 'ecshrine',
        17: 'gpshrine',
        18: 'dbshrine',
        19: 'nwshrine',
        20: 'worldmap',
        21: 'capeclaw',
        22: 'cloudrace',
        23: 'bossdrakor',
        24: 'bosstrex',
    }
}

class ModelInstance {
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
        mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setCullMode(enableCull ? GX.CullMode.BACK : GX.CullMode.NONE);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;

        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList);
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

class SFARenderer extends BasicGXRendererHelper {
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

class ZLBHeader {
    static readonly SIZE = 16;

    magic: number;
    unk4: number;
    unk8: number;
    size: number;

    constructor(dv: DataView) {
        this.magic = dv.getUint32(0x0);
        this.unk4 = dv.getUint32(0x4);
        this.unk8 = dv.getUint32(0x8);
        this.size = dv.getUint32(0xC);
    }
}

function stringToFourCC(s: string): number {
    return (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)
}

// Reads bitfields by pulling from the low bits of each byte in sequence
class LowBitReader {
    dv: DataView
    offs: number
    num: number
    buf: number

    constructor(dv: DataView, offs: number = 0) {
        this.dv = dv;
        this.offs = offs;
        this.num = 0;
        this.buf = 0;
    }

    peek(bits: number): number {
        while (this.num < bits) {
            this.buf |= this.dv.getUint8(this.offs) << this.num
            this.offs++;
            this.num += 8;
        }
        return this.buf & ((1<<bits)-1);
    }

    drop(bits: number) {
        this.peek(bits); // Ensure buffer has bits to drop
        this.buf >>>= bits
        this.num -= bits
    }

    get(bits: number): number {
        const x = this.peek(bits)
        this.drop(bits)
        return x
    }
}

function loadZLB(compData: ArrayBufferSlice): ArrayBuffer {
    let offs = 0;
    const dv = compData.createDataView();
    const header = new ZLBHeader(dv);
    offs += ZLBHeader.SIZE;

    if (header.magic != stringToFourCC('ZLB\0')) {
        throw Error(`Invalid magic identifier 0x${hexzero(header.magic, 8)}`);
    }

    return pako.inflate(new Uint8Array(compData.copyToBuffer(ZLBHeader.SIZE, header.size))).buffer;
}

function loadDIRn(data: ArrayBufferSlice): ArrayBuffer {
    const dv = data.createDataView();
    const size = dv.getUint32(8);
    return data.copyToBuffer(0x20, size);
}

function loadRes(data: ArrayBufferSlice): ArrayBufferSlice {
    const dv = data.createDataView();
    const magic = dv.getUint32(0);
    switch (magic) {
    case stringToFourCC('ZLB\0'):
        return new ArrayBufferSlice(loadZLB(data));
    case stringToFourCC('DIRn'): // FIXME: actually just "DIR"
        return new ArrayBufferSlice(loadDIRn(data));
    default:
        console.warn(`Invalid magic identifier 0x${hexzero(magic, 8)}`);
        return data;
    }
}

interface LoadedTexture {
    texture: GX_Texture.Texture;
    wrapS: number;
    wrapT: number;
    minFilt: number;
    magFilt: number;
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

interface DecodedTexture {
    loadedTexture: LoadedTexture;
    gfxTexture: GfxTexture;
    gfxSampler: GfxSampler;
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
        return null;
    }
}

class TextureCollection {
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

class BlockRenderer {
    models: ModelInstance[] = [];
    yTranslate: number = 0;

    constructor(device: GfxDevice, blockData: ArrayBufferSlice, texColl: TextureCollection) {
        let offs = 0;
        const blockDv = blockData.createDataView();

        const modelType = blockDv.getUint16(4);
        let fields;
        switch (modelType) {
        case 0:
            fields = {
                texOffset: 0x54,
                texCount: 0xa0,
                posOffset: 0x58,
                posCount: 0x90,
                clrOffset: 0x5c,
                clrCount: 0x94,
                coordOffset: 0x60,
                coordCount: 0x96,
                polyOffset: 0x64,
                polyCount: 0xa0, // NOTE: "polys" are polygon attributes and shading information.
                                 // Rareware called these "shaders".
                shaderSize: 0x40,
                chunkOffset: 0x68, // NOTE: "chunks" are display lists. Rareware called these "lists".
                chunkCount: 0x9f,
                chunkEntrySize: 0x34,
                numListBits: 8, // ??? should be 6 according to decompilation of demo????
                bitsOffset: 0x74, // Whoa...
                bitsCount: 0x84,
            };
            break;
        case 8:
            fields = {
                texOffset: 0x54,
                texCount: 0xa0,
                posOffset: 0x58,
                posCount: 0x90,
                clrOffset: 0x5c,
                clrCount: 0x94,
                coordOffset: 0x60,
                coordCount: 0x96,
                polyOffset: 0x64,
                polyCount: 0xa2,
                shaderSize: 0x44,
                chunkOffset: 0x68,
                chunkCount: 0xa1, // TODO
                chunkEntrySize: 0x1c,
                numListBits: 8,
                bitsOffset: 0x78,
                bitsCount: 0x84,
            };
            break;
        default:
            throw Error(`Model type ${modelType} not implemented`);
        }

        // @0x8: data size
        // @0xc: 4x3 matrix (placeholder; always zeroed in files)
        // @0x8e: y translation (up/down)

        this.yTranslate = blockDv.getInt16(0x8e); // TODO: fix for demo

        //////////// TEXTURE STUFF TODO: move somewhere else

        const texOffset = blockDv.getUint32(fields.texOffset);
        const texCount = blockDv.getUint8(fields.texCount);
        // const texCount = 8; // XXX: can't find the damn field...
        // console.log(`Loading ${texCount} texture infos from 0x${texOffset.toString(16)}`);
        const texIds: number[] = [];
        for (let i = 0; i < texCount; i++) {
            const texIdFromFile = blockDv.getUint32(texOffset + i * 4);
            texIds.push(texIdFromFile);
        }
        // console.log(`tex ids: ${JSON.stringify(texIds)}`);

        //////////////////////////

        const posOffset = blockDv.getUint32(fields.posOffset);
        const posCount = blockDv.getUint16(fields.posCount);
        // const posCount = 3200; // XXX: can't find the damn field...
        // console.log(`Loading ${posCount} positions from 0x${posOffset.toString(16)}`);
        const vertBuffer = blockData.subarray(posOffset, posCount * 3 * 2);

        const clrOffset = blockDv.getUint32(fields.clrOffset);
        const clrCount = blockDv.getUint16(fields.clrCount);
        // const clrCount = 3200;
        // console.log(`Loading ${clrCount} colors from 0x${clrOffset.toString(16)}`);
        const clrBuffer = blockData.subarray(clrOffset, clrCount * 2);

        const coordOffset = blockDv.getUint32(fields.coordOffset);
        const coordCount = blockDv.getUint16(fields.coordCount);
        // const coordCount = 3200;
        // console.log(`Loading ${coordCount} texcoords from 0x${coordOffset.toString(16)}`);
        const coordBuffer = blockData.subarray(coordOffset, coordCount * 2 * 2);

        const polyOffset = blockDv.getUint32(fields.polyOffset);
        const polyCount = blockDv.getUint8(fields.polyCount);
        // console.log(`Loading ${polyCount} polytypes from 0x${polyOffset.toString(16)}`);

        interface PolygonType {
            hasNormal: boolean;
            hasColor: boolean;
            hasTexCoord: boolean[];
            numTexCoords: number;
            hasTex0: boolean;
            tex0Num: number;
            hasTex1: boolean;
            tex1Num: number;
            numLayers: number;
            enableCull: boolean;
        }

        const polyTypes: PolygonType[] = [];
        offs = polyOffset;
        for (let i = 0; i < polyCount; i++) {
            const polyType = {
                hasNormal: false,
                hasColor: false,
                hasTexCoord: nArray(8, () => false),
                numTexCoords: 0,
                hasTex0: false,
                tex0Num: -1,
                hasTex1: false,
                tex1Num: -1,
                numLayers: 0,
                enableCull: false,
            };
            // console.log(`parsing polygon attributes ${i} from 0x${offs.toString(16)}`);
            const tex0Flag = blockDv.getUint32(offs + 0x8);
            // console.log(`tex0Flag: ${tex0Flag}`);
            // if (tex0Flag == 1) {
                // FIXME: tex0Flag doesn't seem to be present...
                polyType.hasTex0 = true;
                polyType.tex0Num = blockDv.getUint32(offs + 0x24);
                // TODO: @offs+0x28: flags, including HasTransparency.
            // }
            const tex1Flag = blockDv.getUint32(offs + 0x14);
            // console.log(`tex1Flag: ${tex1Flag}`);
            // if (tex1Flag == 1) {
                // FIXME: tex1Flag doesn't seem to be present...
                polyType.hasTex1 = true;
                //polyType.tex1Num = blockDv.getUint32(offs + 0x2C);
                polyType.tex1Num = blockDv.getUint32(offs + 0x34); // According to decompilation
                // TODO: @offs+0x30: flags, including HasTransparency.
            // }

            // TODO: This offset is valid for the demo; what about final?
            polyType.numLayers = blockDv.getUint8(offs + 0x3b);
            
            // console.log(`numLayers: ${polyType.numLayers}`);
            const attrFlags = blockDv.getUint8(offs + 0x40);
            // console.log(`attrFlags: 0x${hexzero(attrFlags, 2)}`)
            polyType.hasNormal = (attrFlags & 1) != 0;
            polyType.hasColor = (attrFlags & 2) != 0;
            polyType.numTexCoords = blockDv.getUint8(offs + 0x41);
            // if (attrFlags & 4) {
            //     for (let j = 0; j < polyType.numTexCoords; j++) {
            //         polyType.hasTexCoord[j] = true;
            //     }
            // }
            // if (polyType.numTexCoords == 1) {
            //     polyType.hasTex1 = false;
            // }
            // polyType.numTexCoords = polyType.numLayers;
            for (let j = 0; j < polyType.numTexCoords; j++) {
                polyType.hasTexCoord[j] = true;
            }
            const unk42 = blockDv.getUint8(offs + 0x42);
            polyType.enableCull = (blockDv.getUint32(offs + 0x3c) & 0x8) != 0;
            // polyType.enableCull = false;
            
            // console.log(`PolyType: ${JSON.stringify(polyType)}`);
            // console.log(`PolyType tex0: ${decodedTextures[polyType.tex0Num]}, tex1: ${decodedTextures[polyType.tex1Num]}`);
            polyTypes.push(polyType);
            offs += fields.shaderSize;
        }
        
        const vcd: GX_VtxDesc[] = [];
        const vat: GX_VtxAttrFmt[][] = nArray(8, () => []);
        for (let i = 0; i <= GX.Attr.MAX; i++) {
            vcd[i] = { type: GX.AttrType.NONE };
            for (let j = 0; j < 8; j++) {
                vat[j][i] = { compType: GX.CompType.U8, compShift: 0, compCnt: 0 };
            }
        }

        // vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.DIRECT;
        vcd[GX.Attr.POS].type = GX.AttrType.DIRECT;
        vcd[GX.Attr.CLR0].type = GX.AttrType.DIRECT;
        vcd[GX.Attr.TEX0].type = GX.AttrType.DIRECT;

        // TODO: Implement normals and lighting
        vat[0][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
        vat[0][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[0][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 7, compCnt: GX.CompCnt.TEX_ST };
        
        vat[1][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 2, compCnt: GX.CompCnt.POS_XYZ };
        vat[1][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[1][GX.Attr.TEX0] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };
        
        vat[2][GX.Attr.POS] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
        vat[2][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[2][GX.Attr.TEX0] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };
        vat[2][GX.Attr.TEX1] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };

        vat[3][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
        vat[3][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[3][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[3][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[3][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[3][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        
        vat[4][GX.Attr.POS] = { compType: GX.CompType.F32, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
        vat[4][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[4][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 7, compCnt: GX.CompCnt.TEX_ST };

        vat[5][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 3, compCnt: GX.CompCnt.POS_XYZ };
        vat[5][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[5][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
        vat[5][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
        vat[5][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
        vat[5][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };

        vat[6][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
        vat[6][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[6][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[6][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[6][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[6][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

        vat[7][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
        vat[7][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
        vat[7][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[7][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[7][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
        vat[7][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

        const chunkOffset = blockDv.getUint32(fields.chunkOffset);
        const chunkCount = blockDv.getUint8(fields.chunkCount);
        // console.log(`Loading ${chunkCount} display lists from 0x${chunkOffset.toString(16)}`);

        const bitsOffset = blockDv.getUint32(fields.bitsOffset);
        const bitsCount = blockDv.getUint16(fields.bitsCount);
        // console.log(`Loading ${bitsCount} bits from 0x${bitsOffset.toString(16)}`);

        let displayList = new ArrayBufferSlice(new ArrayBuffer(1));

        const bits = new LowBitReader(blockDv, bitsOffset);
        let done = false;
        let curPolyType = 0;
        while (!done) {
            const opcode = bits.get(4);
            switch (opcode) {
            case 1: // Set polygon type
                curPolyType = bits.get(6);
                // console.log(`setting poly type ${curPolyType}`);
                break;
            case 2: // Geometry
                const chunkNum = bits.get(fields.numListBits);
                // console.log(`Drawing display list #${chunkNum}`);
                if (chunkNum >= chunkCount) {
                    console.warn(`Can't draw display list #${chunkNum} (out of range)`);
                    continue;
                }
                offs = chunkOffset + chunkNum * fields.chunkEntrySize;
                const dlOffset = blockDv.getUint32(offs);
                const dlSize = blockDv.getUint16(offs + 4);
                // console.log(`DL offset 0x${dlOffset.toString(16)} size 0x${dlSize.toString(16)}`);
                displayList = blockData.subarray(dlOffset, dlSize);

                const vtxArrays: GX_Array[] = [];
                vtxArrays[GX.Attr.POS] = { buffer: vertBuffer, offs: 0, stride: 6 /*getAttributeByteSize(vat[0], GX.Attr.POS)*/ };
                vtxArrays[GX.Attr.CLR0] = { buffer: clrBuffer, offs: 0, stride: 2 /*getAttributeByteSize(vat[0], GX.Attr.CLR0)*/ };
                for (let t = 0; t < 8; t++) {
                    vtxArrays[GX.Attr.TEX0 + t] = { buffer: coordBuffer, offs: 0, stride: 4 /*getAttributeByteSize(vat[0], GX.Attr.TEX0)*/ };
                }

                try {
                    const polyType = polyTypes[curPolyType];
                    const newModel = new ModelInstance(vtxArrays, vcd, vat, displayList, polyType.enableCull);
                    if (polyType.numTexCoords == 2) {
                        newModel.setTextures([
                            polyType.hasTex0 ? texColl.getTexture(device, texIds[polyType.tex0Num]) : null,
                            polyType.hasTex1 ? texColl.getTexture(device, texIds[polyType.tex1Num]) : null,
                        ]);
                    } else if (polyType.numTexCoords == 1) {
                        newModel.setTextures([
                            polyType.hasTex0 ? texColl.getTexture(device, texIds[polyType.tex0Num]) : null, // ???
                        ]);
                    }
                    this.models.push(newModel);
                } catch (e) {
                    console.error(e);
                }
                break;
            case 3: // Set vertex attributes
                const posDesc = bits.get(1);
                // Normal is not used in Star Fox Adventures (?)
                // const normalDesc = bits.get(1);
                const colorDesc = bits.get(1);
                const texCoordDesc = bits.get(1);
                // console.log(`posDesc ${posDesc}`);
                vcd[GX.Attr.POS].type = posDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                // if (polyTypes[curPolyType].hasNormal) {
                //     // console.log(`normalDesc ${normalDesc}`);
                //     vcd[GX.Attr.NRM].type = normalDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                // } else {
                    vcd[GX.Attr.NRM].type = GX.AttrType.NONE;
                // }
                // if (polyTypes[curPolyType].hasColor) {
                    // console.log(`colorDesc ${colorDesc}`);
                    vcd[GX.Attr.CLR0].type = colorDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                // } else {
                    // vcd[GX.Attr.CLR0].type = GX.AttrType.NONE;
                // }
                if (polyTypes[curPolyType].hasTexCoord[0]) {
                    // console.log(`texCoordDesc: ${texCoordDesc}`);
                    // Note: texCoordDesc applies to all texture coordinates in the vertex
                    for (let t = 0; t < 8; t++) {
                        if (polyTypes[curPolyType].hasTexCoord[t]) {
                            vcd[GX.Attr.TEX0 + t].type = texCoordDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                        } else {
                            vcd[GX.Attr.TEX0 + t].type = GX.AttrType.NONE;
                        }
                    }
                }
                break;
            case 4: // Set weights (skipped by SFA block renderer)
                const numWeights = bits.get(4);
                for (let i = 0; i < numWeights; i++) {
                    const weight = bits.get(8);
                    // console.log(`weight ${i}: ${weight}`);
                }
                break;
            case 5: // End
                done = true;
                break;
            default:
                console.warn(`Skipping unknown model bits opcode ${opcode}`);
                break;
            }
        }
    }

    public addToRenderer(renderer: SFARenderer, modelMatrix: mat4) {
        for (let i = 0; i < this.models.length; i++) {
            const trans = mat4.create();
            mat4.fromTranslation(trans, [0, this.yTranslate, 0]);
            const matrix = mat4.create();
            mat4.mul(matrix, modelMatrix, trans);
            renderer.addModel(this.models[i], matrix);
        }
    }
}

interface MapInfo {
    infoOffset: number;
    blockTableOffset: number;
    blockCols: number;
    blockRows: number;
}

function getMapInfo(mapsTab: DataView, mapsBin: DataView, locationNum: number): MapInfo {
    const offs = locationNum * 0x1c;
    const infoOffset = mapsTab.getUint32(offs + 0x0);
    const blockTableOffset = mapsTab.getUint32(offs + 0x4);
    const blockCols = mapsBin.getUint16(infoOffset + 0x0);
    const blockRows = mapsBin.getUint16(infoOffset + 0x2);
    console.log(`block table offset: 0x${hexzero(blockTableOffset, 8)}`);
    return { infoOffset, blockTableOffset, blockCols, blockRows };
}

interface BlockInfo {
    base: number;
    trkblk: number;
    block: number;
}

function getBlockInfo(mapsBin: DataView, mapInfo: MapInfo, x: number, y: number, trkblkTab: DataView, locationNum: number): BlockInfo {
    const blockIndex = y * mapInfo.blockCols + x;
    const blockInfo = mapsBin.getUint32(mapInfo.blockTableOffset + 4 * blockIndex);
    const base = (blockInfo >>> 17) & 0x3F;
    const trkblk = (blockInfo >>> 23);
    let block;
    if (trkblk == 0xff) {
        block = -1;
    } else {
        try {
            block = base + trkblkTab.getUint16(trkblk * 2);
        } catch (e) {
            block = -1
        }
    }
    return {base, trkblk, block};
}

function getModNumber(locationNum: number): number {
    if (locationNum < 5) // This is strange, but it matches the decompilation.
        return locationNum
    else
        return locationNum + 1
}

function getSubdir(locationNum: number, gameInfo: GameInfo): string {
    if (gameInfo.subdirs[locationNum] === undefined) {
        throw Error(`Subdirectory for location ${locationNum} unknown`);
    }
    return gameInfo.subdirs[locationNum];
}

class BlockCollection {
    blockRenderers: BlockRenderer[] = [];
    blockFetcher: BlockFetcher;
    tex1Tab: ArrayBufferSlice;
    tex1Bin: ArrayBufferSlice;
    texColl: TextureCollection;

    public async create(device: GfxDevice, context: SceneContext, trkblk: number, gameInfo: GameInfo) {
        const dataFetcher = context.dataFetcher;
        const pathBase = gameInfo.pathBase;
        const subdir = getSubdir(trkblk, gameInfo);
        this.blockFetcher = await gameInfo.makeBlockFetcher(trkblk, dataFetcher, gameInfo);
        // const tex0Tab = await dataFetcher.fetchData(`${pathBase}/${subdir}/TEX0.tab`);
        // const tex0Bin = await dataFetcher.fetchData(`${pathBase}/${subdir}/TEX0.bin`);
        this.tex1Tab = await dataFetcher.fetchData(`${pathBase}/${subdir}/TEX1.tab`);
        this.tex1Bin = await dataFetcher.fetchData(`${pathBase}/${subdir}/TEX1.bin`);
        this.texColl = new TextureCollection(this.tex1Tab, this.tex1Bin);
    }

    public getBlockRenderer(device: GfxDevice, blockNum: number, trkblk: number, subnum: number): BlockRenderer | null {
        if (this.blockRenderers[blockNum] === undefined) {
            const uncomp = this.blockFetcher.getBlock(blockNum, trkblk, subnum);
            if (uncomp === null)
                return null;
            this.blockRenderers[blockNum] = new BlockRenderer(device, uncomp, this.texColl);
        }

        return this.blockRenderers[blockNum];
    }
}

class SFAMapDesc implements Viewer.SceneDesc {
    constructor(public locationNum: number, public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const mapsTab = (await dataFetcher.fetchData(`${pathBase}/MAPS.tab`)).createDataView();
        const mapsBin = (await dataFetcher.fetchData(`${pathBase}/MAPS.bin`)).createDataView();
        const trkblkTab = (await dataFetcher.fetchData(`${pathBase}/TRKBLK.tab`)).createDataView();

        console.log(`Creating scene for ${this.name} (location ${this.locationNum}) ...`);

        const mapInfo = getMapInfo(mapsTab, mapsBin, this.locationNum);
        for (let y = 0; y < mapInfo.blockRows; y++) {
            let line = '';
            for (let x = 0; x < mapInfo.blockCols; x++) {
                const blockInfo = getBlockInfo(mapsBin, mapInfo, x, y, trkblkTab, this.locationNum);
                line += ` ${JSON.stringify(blockInfo)}`;
            }
            console.log(`${line}`);
        }

        const sfaRenderer = new SFARenderer(device);
        const blockCollections: BlockCollection[] = [];
        for (let y = 0; y < mapInfo.blockRows; y++) {
            for (let x = 0; x < mapInfo.blockCols; x++) {
                const blockInfo = getBlockInfo(mapsBin, mapInfo, x, y, trkblkTab, this.locationNum);
                if (blockInfo.block == -1)
                    continue;

                if (blockCollections[blockInfo.trkblk] === undefined) {
                    const blockColl = new BlockCollection();
                    try {
                        await blockColl.create(device, context, blockInfo.trkblk, this.gameInfo);
                    } catch (e) {
                        console.error(e);
                        console.warn(`Block collection ${blockInfo.trkblk} could not be loaded.`);
                        continue;
                    }
                    blockCollections[blockInfo.trkblk] = blockColl;
                }

                const blockColl = blockCollections[blockInfo.trkblk];
                try {
                    const blockRenderer = blockColl.getBlockRenderer(device, blockInfo.block, blockInfo.trkblk, blockInfo.base);
                    if (!blockRenderer) {
                        console.warn(`Block ${blockInfo.block} (trkblk ${blockInfo.trkblk} base ${blockInfo.base}) not found`);
                        continue;
                    }

                    const modelMatrix: mat4 = mat4.create();
                    mat4.fromTranslation(modelMatrix, [640 * x, 0, 640 * y]);
                    blockRenderer.addToRenderer(sfaRenderer, modelMatrix);
                } catch (e) {
                    console.warn(`Skipped block at ${x},${y} due to exception:`);
                    console.error(e);
                }
            }
        }
        if (blockCollections.length == 0)
            console.warn(`No blocks could be rendered.`);

        return sfaRenderer;
    }
}

const sceneDescs = [
    'Maps',
    // Dinosaur Planet contains many maps. During the transition to the GameCube
    // when the game became Star Fox Adventures, many of these locations were
    // dropped. Their data remains, but it references missing and/or broken data
    // and thus cannot be loaded.
    new SFAMapDesc(1, 'loc1', 'Location 1'),
    new SFAMapDesc(2, 'loc2', 'Location'),
    new SFAMapDesc(3, 'loc3', 'Location'),
    new SFAMapDesc(4, 'loc4', 'Location'),
    new SFAMapDesc(5, 'loc5', 'Location'),
    new SFAMapDesc(6, 'loc6', 'Location'),
    new SFAMapDesc(7, 'loc7', 'Location'),
    new SFAMapDesc(8, 'loc8', 'Location'),
    new SFAMapDesc(9, 'loc9', 'Location'),
    new SFAMapDesc(10, 'loc10', 'Location 10'),
    new SFAMapDesc(11, 'loc11', 'Location'),
    new SFAMapDesc(12, 'loc12', 'Location'),
    new SFAMapDesc(13, 'loc13', 'Location'),
    new SFAMapDesc(14, 'loc14', 'Location'),
    new SFAMapDesc(15, 'loc15', 'Location'),
    new SFAMapDesc(16, 'loc16', 'Location'),
    new SFAMapDesc(17, 'loc17', 'Location'),
    new SFAMapDesc(18, 'loc18', 'Location'),
    new SFAMapDesc(19, 'loc19', 'Location'),
    new SFAMapDesc(20, 'loc20', 'Location 20'),
    new SFAMapDesc(21, 'loc21', 'Location'),
    new SFAMapDesc(22, 'loc22', 'Location'),
    new SFAMapDesc(23, 'loc23', 'Location'),
    new SFAMapDesc(24, 'loc24', 'Location'),
    new SFAMapDesc(25, 'loc25', 'Location'),
    new SFAMapDesc(26, 'loc26', 'Location'),
    new SFAMapDesc(27, 'loc27', 'Location'),
    new SFAMapDesc(28, 'loc28', 'Location'),
    new SFAMapDesc(29, 'loc29', 'Location'),
    new SFAMapDesc(30, 'loc30', 'Location 30'),
    new SFAMapDesc(31, 'loc31', 'Location'),
    new SFAMapDesc(32, 'loc32', 'Location'),
    new SFAMapDesc(33, 'loc33', 'Location'),
    new SFAMapDesc(34, 'loc34', 'Location'),
    new SFAMapDesc(35, 'loc35', 'Location'),
    new SFAMapDesc(36, 'loc36', 'Location'),
    new SFAMapDesc(37, 'loc37', 'Location'),
    new SFAMapDesc(38, 'loc38', 'Location'),
    new SFAMapDesc(39, 'loc39', 'Location'),
    new SFAMapDesc(40, 'loc40', 'Location 40'),
    new SFAMapDesc(41, 'loc41', 'Location'),
    new SFAMapDesc(42, 'loc42', 'Location'),
    new SFAMapDesc(43, 'loc43', 'Location'),
    new SFAMapDesc(44, 'loc44', 'Location'),
    new SFAMapDesc(45, 'loc45', 'Location'),
    new SFAMapDesc(46, 'loc46', 'Location'),
    new SFAMapDesc(47, 'loc47', 'Location'),
    new SFAMapDesc(48, 'loc48', 'Location'),
    new SFAMapDesc(49, 'loc49', 'Location'),
    new SFAMapDesc(50, 'loc50', 'Location 50'),
    new SFAMapDesc(51, 'loc51', 'Location'),
    new SFAMapDesc(52, 'loc52', 'Location'),
    new SFAMapDesc(53, 'loc53', 'Location'),
    new SFAMapDesc(54, 'loc54', 'Location'),
    new SFAMapDesc(55, 'loc55', 'Location'),
    new SFAMapDesc(56, 'loc56', 'Location'),
    new SFAMapDesc(57, 'loc57', 'Location'),
    new SFAMapDesc(58, 'loc58', 'Location'),
    new SFAMapDesc(59, 'loc59', 'Location'),
    // new SFAMapDesc(60, 'loc60', 'Location 60'),
    new SFAMapDesc(61, 'loc61', 'Location'),
    new SFAMapDesc(62, 'loc62', 'Location'),
    new SFAMapDesc(63, 'loc63', 'Location'),
    new SFAMapDesc(64, 'loc64', 'Location'),
    new SFAMapDesc(65, 'loc65', 'Location'),
    new SFAMapDesc(66, 'loc66', 'Location'),
    new SFAMapDesc(67, 'loc67', 'Location'),
    new SFAMapDesc(68, 'loc68', 'Location'),
    new SFAMapDesc(69, 'loc69', 'Location'),
    new SFAMapDesc(70, 'loc70', 'Location 70'),
    new SFAMapDesc(71, 'loc71', 'Location'),
    new SFAMapDesc(72, 'loc72', 'Location'),
    new SFAMapDesc(73, 'loc73', 'Location'),
    new SFAMapDesc(74, 'loc74', 'Location'),
    // new SFAMapDesc(75, 'loc75', 'Location'),
    // new SFAMapDesc(76, 'loc76', 'Location'),
    // new SFAMapDesc(77, 'loc77', 'Location'),
    // new SFAMapDesc(78, 'loc78', 'Location'),
    // new SFAMapDesc(79, 'loc79', 'Location'),
    // new SFAMapDesc(80, 'loc80', 'Location 80'),
    // new SFAMapDesc(81, 'loc81', 'Location'),
    // new SFAMapDesc(82, 'loc82', 'Location'),
    // new SFAMapDesc(83, 'loc83', 'Location'),
    // new SFAMapDesc(84, 'loc84', 'Location'),
    // new SFAMapDesc(85, 'loc85', 'Location'),
    // new SFAMapDesc(86, 'loc86', 'Location'),
    // new SFAMapDesc(87, 'loc87', 'Location'),
    // new SFAMapDesc(88, 'loc88', 'Location'),
    // new SFAMapDesc(89, 'loc89', 'Location'),
    // new SFAMapDesc(90, 'loc90', 'Location 90'),
    // new SFAMapDesc(91, 'loc91', 'Location'),
    // new SFAMapDesc(92, 'loc92', 'Location'),
    // new SFAMapDesc(93, 'loc93', 'Location'),
    // new SFAMapDesc(94, 'loc94', 'Location'),
    // new SFAMapDesc(95, 'loc95', 'Location'),
    // new SFAMapDesc(96, 'loc96', 'Location'),
    // new SFAMapDesc(97, 'loc97', 'Location'),
    // new SFAMapDesc(98, 'loc98', 'Location'),
    // new SFAMapDesc(99, 'loc99', 'Location'),
    // ... (Many maps contain empty or broken data) ...
    // new SFAMapDesc(110, 'loc110', 'Location 110'),
    // ...
    // new SFAMapDesc(115, 'loc115', 'Location 115'),
    // new SFAMapDesc(116, 'loc116', 'Location 116'), 
    // (end)

    'Demo',
    new SFAMapDesc(5, 'demo5', 'Location 5', SFADEMO_GAME_INFO),
];

const id = 'sfa';
const name = 'Star Fox Adventures';
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
