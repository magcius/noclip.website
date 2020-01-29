import * as pako from 'pako';
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import * as GX_Material from '../gx/gx_material';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX_Texture from '../gx/gx_texture';

import { hexzero, nArray } from '../util';
import * as GX from '../gx/gx_enum';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, loadTextureFromMipChain } from '../gx/gx_render';
import { GX_VtxDesc, GX_VtxAttrFmt, compileLoadedVertexLayout, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array, getAttributeByteSize } from '../gx/gx_displaylist';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Camera, computeViewMatrix } from '../Camera';
import { mat4 } from 'gl-matrix';
import { gx_texture_asExports } from '../wat_modules';

const pathBase = 'sfa';

class ModelInstance {
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
    shapeHelper: GXShapeHelperGfx | null = null;
    materialHelper: GXMaterialHelperGfx;
    textures: (DecodedTexture | null)[] = [];

    constructor(vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: ArrayBufferSlice) {
        const mb = new GXMaterialBuilder('Basic');
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
        mb.setZMode(true, GX.CompareType.LESS, true);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;

        // const vtxArrays: GX_Array[] = [];
        // const vertsBuffer = new ArrayBufferSlice(verts.buffer);
        // vtxArrays[GX.Attr.POS] = { buffer: vertsBuffer, offs: 0, stride: getAttributeByteSize(vat[0], GX.Attr.POS) };
        // this.loadedVertexData = vtxLoader.runVertices(vtxArrays, new ArrayBufferSlice(dl.buffer));
        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList);
        console.log(`loaded vertex data ${JSON.stringify(this.loadedVertexData, null, '\t')}`);
    }

    public setTextures(textures: (DecodedTexture | null)[]) {
        this.textures = textures;
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        // mat4.mul(dst, dst, this.sceneGraphNode.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        if (this.shapeHelper === null) {
            const bufferCoalescer = loadedDataCoalescerComboGfx(device, [this.loadedVertexData]);
            this.shapeHelper = new GXShapeHelperGfx(device, renderInstManager.gfxRenderCache, bufferCoalescer.coalescedBuffers[0], this.loadedVertexLayout, this.loadedVertexData);
        }

        // const template = renderInstManager.pushTemplateRenderInst();
        // this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
        // const materialParams = new MaterialParams();
        // this.materialHelper.fillMaterialParamsDataOnInst(template, 0, materialParams);
        //this.materialHelper.fillMaterialParamsData(renderInstManager, 0, materialParams);

        // const packetParams = new PacketParams();
        // packetParams.clear();
        // for (let p = 0; p < this.shapeHelper.loadedVertexData.packets.length; p++) {
        //     const packet = this.shapeHelper.loadedVertexData.packets[p];

        //     const renderInst = this.shapeHelper.pushRenderInst(renderInstManager, packet);
        //     this.shapeHelper.fillPacketParams(packetParams, renderInst);
        // }
        
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
                materialParams.m_TextureMapping[i].width = 32;
                materialParams.m_TextureMapping[i].height = 32;
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
        this.computeModelView(packetParams.u_PosMtx[0], viewerInput.camera);
        this.shapeHelper.fillPacketParams(packetParams, renderInst);

        // renderInstManager.popTemplateRenderInst();
    }
}

class SFARenderer extends BasicGXRendererHelper {
    models: ModelInstance[] = [];

    public addModel(model: ModelInstance) {
        this.models.push(model);
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        
        fillSceneParamsDataOnTemplate(template, viewerInput, false);
        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
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

function loadRes(data: ArrayBufferSlice): ArrayBuffer {
    const dv = data.createDataView();
    const magic = dv.getUint32(0);
    switch (magic) {
    case stringToFourCC('ZLB\0'):
        return loadZLB(data);
    case stringToFourCC('DIRn'):
        return loadDIRn(data);
    default:
        throw Error(`Invalid magic identifier 0x${hexzero(magic, 8)}`);
    }
}

function loadTex(texData: ArrayBufferSlice): GX_Texture.Texture {
    const dv = texData.createDataView();
    const result = {
        name: `Texture`,
        width: dv.getUint16(0x0A),
        height: dv.getUint16(0x0C),
        format: dv.getUint8(22), // GX.TexFormat.RGB565, // TODO
        data: texData.slice(96),
        mipCount: 1,
    };
    return result;
}

interface DecodedTexture {
    gfxTexture: GfxTexture;
    gfxSampler: GfxSampler;
}

function decodeTex(device: GfxDevice, tex: GX_Texture.Texture): DecodedTexture {
    const mipChain = GX_Texture.calcMipChain(tex, 1);
    const gfxTexture = loadTextureFromMipChain(device, mipChain).gfxTexture;
    
    // GL texture is bound by loadTextureFromMipChain.
    const gfxSampler = device.createSampler({
        wrapS: GfxWrapMode.REPEAT, // TODO
        wrapT: GfxWrapMode.REPEAT, // TODO
        minFilter: GfxTexFilterMode.BILINEAR,
        magFilter: GfxTexFilterMode.BILINEAR,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0,
        maxLOD: 100,
    });

    return { gfxTexture, gfxSampler };
}

function loadTextureFromTable(device: GfxDevice, tab: ArrayBufferSlice, bin: ArrayBufferSlice, id: number): (DecodedTexture | null) {
    const tabDv = tab.createDataView();
    const tab0 = tabDv.getUint32(id * 4);
    console.log(`tex ${id} tab 0x${hexzero(tab0, 8)}`);
    if (tab0 & 0x80000000) {
        // Loadable texture (?)
        const binOffs = (tab0 & 0x00FFFFFF) * 2;
        const compData = bin.slice(binOffs);
        const uncompData = loadRes(compData);
        const loaded = loadTex(new ArrayBufferSlice(uncompData));
        const decoded = decodeTex(device, loaded);
        return decoded;
    } else {
        // TODO: also seen is value 0x01000000
        return null;
    }
}

class SFASceneDesc implements Viewer.SceneDesc {
    constructor(public subdir: string, public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const sceneData = await dataFetcher.fetchData(`${pathBase}/${this.subdir}/${this.id}`);
        const tex0Tab = await dataFetcher.fetchData(`${pathBase}/${this.subdir}/TEX0.tab`);
        const tex0Bin = await dataFetcher.fetchData(`${pathBase}/${this.subdir}/TEX0.bin`);
        const tex1Tab = await dataFetcher.fetchData(`${pathBase}/${this.subdir}/TEX1.tab`);
        const tex1Bin = await dataFetcher.fetchData(`${pathBase}/${this.subdir}/TEX1.bin`);

        console.log(`Creating SFA scene for ${this.subdir}/${this.id} ...`);

        let offs = 0;
        const uncomp = loadRes(sceneData);
        const uncompDv = new DataView(uncomp);

        const modelType = uncompDv.getUint16(4);
        if (modelType != 8) {
            throw Error(`Model type ${modelType} not implemented`);
        }

        //////////// TEXTURE STUFF TODO: move somewhere else

        const texOffset = uncompDv.getUint32(0x54);
        const texCount = uncompDv.getUint8(0xA0);
        console.log(`Loading ${texCount} texture infos from 0x${texOffset.toString(16)}`);
        const texIds: number[] = [];
        for (let i = 0; i < texCount; i++) {
            const texIdFromFile = uncompDv.getUint32(texOffset + i * 4);
            texIds.push(-(texIdFromFile | 0x8000)); // wtf??? based on decompilation...
        }
        console.log(`tex ids: ${JSON.stringify(texIds)}`);

        const decodedTextures: (DecodedTexture | null)[] = [];
        for (let i = 0; i < texIds.length; i++) {
            const entryNum = (-texIds[i] & 0x7FFF);
            const tex1 = loadTextureFromTable(device, tex1Tab, tex1Bin, entryNum);
            decodedTextures.push(tex1);
        }

        // const decodedTextures0: (DecodedTexture | null)[] = [];
        // const decodedTextures1: (DecodedTexture | null)[] = [];
        // for (let i = 0; i < texIds.length; i++) {
        //     const tex0 = loadTextureFromTable(device, tex0Tab, tex0Bin, texIds[i]);
        //     const tex1 = loadTextureFromTable(device, tex1Tab, tex1Bin, texIds[i]);
        //     decodedTextures0.push(tex0);
        //     decodedTextures1.push(tex1);
        // }

        //////////////////////////

        const posOffset = uncompDv.getUint32(0x58);
        const posCount = uncompDv.getUint16(0x90);
        console.log(`Loading ${posCount} positions from 0x${posOffset.toString(16)}`);
        const vertBuffer = new ArrayBufferSlice(uncompDv.buffer, posOffset, posCount * 3*2);

        const clrOffset = uncompDv.getUint32(0x5C);
        const clrCount = uncompDv.getUint16(0x94);
        console.log(`Loading ${clrCount} colors from 0x${clrOffset.toString(16)}`);
        const clrBuffer = new ArrayBufferSlice(uncompDv.buffer, clrOffset, clrCount * 2);

        const coordOffset = uncompDv.getUint32(0x60);
        const coordCount = uncompDv.getUint16(0x96);
        console.log(`Loading ${coordCount} texcoords from 0x${coordOffset.toString(16)}`);
        const coordBuffer = new ArrayBufferSlice(uncompDv.buffer, coordOffset, coordCount * 2 * 2);

        const polyOffset = uncompDv.getUint32(0x64);
        const polyCount = uncompDv.getUint8(0xA1);
        console.log(`Loading ${polyCount} polygon types from 0x${polyOffset.toString(16)}`);

        interface PolygonType {
            hasNormal: boolean;
            hasColor: boolean;
            hasTexCoord: boolean[];
            numTexCoords: number;
            hasTex0: boolean;
            tex0Num: number;
            hasTex1: boolean;
            tex1Num: number;
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
            };
            console.log(`parsing polygon attributes ${i} from 0x${offs.toString(16)}`);
            const tex0Flag = uncompDv.getUint32(offs + 0x8);
            console.log(`tex0Flag: ${tex0Flag}`);
            // if (tex0Flag == 1) {
                // FIXME: tex0Flag doesn't seem to be present...
                polyType.hasTex0 = true;
                polyType.tex0Num = uncompDv.getUint32(offs + 0x24);
                // TODO: @offs+0x28: flags, including HasTransparency.
            // }
            const tex1Flag = uncompDv.getUint32(offs + 0x14);
            console.log(`tex1Flag: ${tex1Flag}`);
            // if (tex1Flag == 1) {
                // FIXME: tex1Flag doesn't seem to be present...
                polyType.hasTex1 = true;
                //polyType.tex1Num = uncompDv.getUint32(offs + 0x2C);
                polyType.tex1Num = uncompDv.getUint32(offs + 0x34); // According to decompilation
                // TODO: @offs+0x30: flags, including HasTransparency.
            // }
            const attrFlags = uncompDv.getUint8(offs + 0x40);
            console.log(`attrFlags: 0x${hexzero(attrFlags, 2)}`)
            polyType.hasNormal = (attrFlags & 1) != 0;
            polyType.hasColor = (attrFlags & 2) != 0;
            polyType.numTexCoords = uncompDv.getUint8(offs + 0x41);
            if (attrFlags & 4) {
                for (let j = 0; j < polyType.numTexCoords; j++) {
                    polyType.hasTexCoord[j] = true;
                }
            }
            const unk42 = uncompDv.getUint8(offs + 0x42);
            
            console.log(`PolyType: ${JSON.stringify(polyType)}`);
            console.log(`PolyType tex0: ${decodedTextures[polyType.tex0Num]}, tex1: ${decodedTextures[polyType.tex1Num]}`);
            polyTypes.push(polyType);
            offs += 0x44;
        }
        
        const vcd: GX_VtxDesc[] = [];
        const vat: GX_VtxAttrFmt[][] = nArray(8, () => []);
        for (let i = 0; i <= GX.Attr.MAX; i++) {
            vcd[i] = { type: GX.AttrType.NONE };
            for (let j = 0; j < 8; j++) {
                vat[j][i] = { compType: GX.CompType.F32, compShift: 0, compCnt: 0 };
            }
        }
        vcd[GX.Attr.POS].type = GX.AttrType.INDEX16;
        for (let i = 0; i < 8; i++) {
            vat[i][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
            vat[i][GX.Attr.CLR0] = { compType: GX.CompType.RGB565, compShift: 0, compCnt: GX.CompCnt.CLR_RGB };
            for (let t = 0; t < 8; t++) {
                vat[i][GX.Attr.TEX0 + t] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
            }
        }

        const chunkOffset = uncompDv.getUint32(0x68);
        console.log(`chunkOffset 0x${chunkOffset.toString(16)}`);

        const bitsOffset = uncompDv.getUint32(0x78);
        const bitsCount = uncompDv.getUint16(0x84);
        console.log(`Loading ${bitsCount} bits from 0x${bitsOffset.toString(16)}`);

        let displayList = new ArrayBufferSlice(new ArrayBuffer(1));

        const renderer = new SFARenderer(device);

        const bits = new LowBitReader(uncompDv, bitsOffset);
        let done = false;
        let curPolyType = 0;
        while (!done) {
            const opcode = bits.get(4);
            switch (opcode) {
            case 1: // Set polygon type
                curPolyType = bits.get(6);
                console.log(`setting poly type ${curPolyType}`);
                break;
            case 2: // Geometry
                const chunkNum = bits.get(8);
                console.log(`geometry chunk #${chunkNum}`);
                offs = chunkOffset + chunkNum * 0x1C;
                const dlOffset = uncompDv.getUint32(offs);
                const dlSize = uncompDv.getUint16(offs + 4);
                displayList = new ArrayBufferSlice(uncompDv.buffer, dlOffset, dlSize);
                console.log(`DL offset 0x${dlOffset.toString(16)} size 0x${dlSize.toString(16)}`);

                const vtxArrays: GX_Array[] = [];
                vtxArrays[GX.Attr.POS] = { buffer: vertBuffer, offs: 0, stride: 6 /*getAttributeByteSize(vat[0], GX.Attr.POS)*/ };
                vtxArrays[GX.Attr.CLR0] = { buffer: clrBuffer, offs: 0, stride: 2 /*getAttributeByteSize(vat[0], GX.Attr.CLR0)*/ };
                for (let t = 0; t < 8; t++) {
                    vtxArrays[GX.Attr.TEX0 + t] = { buffer: coordBuffer, offs: 0, stride: 4 /*getAttributeByteSize(vat[0], GX.Attr.TEX0)*/ };
                }

                try {
                    const polyType = polyTypes[curPolyType];
                    const newModel = new ModelInstance(vtxArrays, vcd, vat, displayList);
                    if (polyType.numTexCoords == 2) {
                        newModel.setTextures([
                            polyType.hasTex0 ? decodedTextures[polyType.tex0Num] : null,
                            polyType.hasTex1 ? decodedTextures[polyType.tex1Num] : null,
                        ]);
                    } else if (polyType.numTexCoords == 1) {
                        newModel.setTextures([
                            polyType.hasTex0 ? decodedTextures[polyType.tex0Num] : null, // ???
                        ]);
                    }
                    renderer.addModel(newModel);
                } catch (e) {
                    console.error(e);
                }
                break;
            case 3: // Set vertex attributes
                const posDesc = bits.get(1);
                console.log(`posDesc ${posDesc}`);
                vcd[GX.Attr.POS].type = posDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                if (polyTypes[curPolyType].hasNormal) {
                    const normalDesc = bits.get(1);
                    console.log(`normalDesc ${normalDesc}`);
                    vcd[GX.Attr.NRM].type = normalDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                } else {
                    vcd[GX.Attr.NRM].type = GX.AttrType.NONE;
                }
                if (polyTypes[curPolyType].hasColor) {
                    const colorDesc = bits.get(1);
                    console.log(`colorDesc ${colorDesc}`);
                    vcd[GX.Attr.CLR0].type = colorDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                } else {
                    vcd[GX.Attr.CLR0].type = GX.AttrType.NONE;
                }
                if (polyTypes[curPolyType].hasTexCoord[0]) {
                    const texCoordDesc = bits.get(1);
                    console.log(`texCoordDesc: ${texCoordDesc}`);
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
            case 4: // Set weights
                const numWeights = bits.get(4);
                for (let i = 0; i < numWeights; i++) {
                    const weight = bits.get(8);
                    console.log(`weight ${i}: ${weight}`);
                }
                break;
            case 5: // End
                done = true;
                break;
            default:
                throw Error(`Unknown model bits opcode ${opcode}`);
            }
        }
        
        return renderer;
    }
}

const sceneDescs = [
    'Test',
    new SFASceneDesc('arwing', 'mod3.zlb.bin', 'Arwing'),
    new SFASceneDesc('arwingcity', 'mod60.zlb.bin', 'Arwing City'),
    new SFASceneDesc('arwingtoplanet', 'mod57.zlb.bin', 'Arwing To Planet'),
    new SFASceneDesc('bossdrakor', 'mod52.zlb.bin', 'Boss Drakor'),
    new SFASceneDesc('bossgaldon', 'mod36.zlb.bin', 'Boss Galdon'),
    new SFASceneDesc('bosstrex', 'mod54.zlb.bin', 'Boss T-rex'),
    new SFASceneDesc('capeclaw', 'mod48.zlb.bin', 'Cape Claw'),
    new SFASceneDesc('clouddungeon', 'mod25.zlb.bin', 'Cloud Dungeon'),
    new SFASceneDesc('darkicemines', 'mod27.zlb.bin', 'Dark Ice Mines'),
    new SFASceneDesc('desert', 'mod29.zlb.bin', 'Desert'),
    new SFASceneDesc('dragrock', 'mod4.zlb.bin', 'Drag Rock'),
    new SFASceneDesc('gpshrine', 'mod43.zlb.bin', 'GP Shrine'),
    new SFASceneDesc('greatfox', 'mod64.zlb.bin', 'Great Fox'),
    new SFASceneDesc('icemountain', 'mod31.zlb.bin', 'Ice Mountain'),
    new SFASceneDesc('linka', 'mod65.zlb.bin', 'Link A'),
    new SFASceneDesc('volcano', 'mod8.zlb.bin', 'Volcano'),
];

const id = 'sfa';
const name = 'Star Fox Adventures';
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
