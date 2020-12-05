// Parses Amusement Vision GMA Format (GeoMetry Archive) files.
// https://gitlab.com/RaphaelTetreault/fzgx_documentation/-/blob/master/asset/GMA%20Structure.md

import * as GX from "../gx/gx_enum";
import * as GX_Material from '../gx/gx_material';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { mat4, vec3 } from "gl-matrix";
import { assert, readString } from "../util"
import { Color, colorAdd, colorNewFromRGBA } from "../Color";
import { compileVtxLoader, DisplayListRegisters, displayListRegistersRun, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, VtxLoader } from "../gx/gx_displaylist";

// GCMF Attribute
const enum GcmfAttribute{
    value16Bit = 0, // vertex length is 16bit
    direct = 1,
    stiching = 2,
    skin = 3
}

// GCMF Material
export interface GcmfMaterial{
    gxMaterial: GX_Material.GXMaterial;
    color0: Color,
    color1: Color,
    color2: Color,
    emission: number,
    transparent: number,
    matCount: number,
    vtxRenderFlag: GX.AttrType,
    tex0Idx: number,
    tex1Idx: number,
    tex2Idx: number,
    vtxAttr: GX.Attr
}

// GCMF VertexControlHeader
interface GcmfVertexControl{
    count: number;
    vtxCon1: VtxConType1,
    vtxCon2: VtxConType2,
    vtxCon3: VtxConType3,
    vtxCon4: VtxConType4
}

interface VtxConType1{
    position: vec3,
    normal: vec3,
    unk0x1C: number,
}

interface VtxConType2{
    buffer: ArrayBuffer,
}

interface VtxConType3{
    count: number,
    offs: number[]
}

interface VtxConType4{
    offs: number[]
}

// GCMF Submesh
export interface GcmfShape{
    material: GcmfMaterial,
    mtxIdxs: number[],
    dlist0Size: number,
    dlist1Size: number,
    boundingSphere: vec3,
    exShape: GcmfExShape,

    loadedVertexLayout: LoadedVertexLayout,
    loadedVertexData: LoadedVertexData
}

export interface GcmfExShape{
    unk_0x00: number,
    unk_0x04: number,
    dlist0Size: number,
    dlist1Size: number
}

// GCMF GcmfTexture
export interface GcmfTexture{
    mipmap: GX.TexFilter,
    // 0x00: LINER & MIPMAP NEAR, LINER (mipmap:0)
    // 0x01: LINER & MIPMAP LINER, LINER (mipmap:1) liner?
    // 0x02: LINER & MIPMAP LINER, LINER (mipmap:3) tri liner?
    // 0x04: LINER & MIPMAP LINER, LINER
    // 0x08: NEAR & MIPMAP NEAR, NEAR (NEAR FLAG) (mipmap:0)
    // 0x10: LINER & MIPMAP NEAR, LINER
    wrapS: GX.WrapMode,
    wrapT: GX.WrapMode,
    textureIndex: number, 
    anisotropy: number,
    idx: number
}

interface Gcmf{
    attribute: GcmfAttribute,
    origin: vec3,
    boundSpeher: number,
    texCount: number,
    materialCount: number,
    traslucidMaterialCount: number,
    mtxCount : number,
    matrixs: mat4[],
    textures: GcmfTexture[],
    shapes: GcmfShape[]
}

interface GcmfEntryOffset{
    gcmfOffs: number,
    nameOffs: number
}

export interface GcmfEntry{
    gcmf: Gcmf,
    name: string
}

export interface GMA{
    gcmfEntrys: GcmfEntry[]
}


function parseTexture(buffer: ArrayBufferSlice): GcmfTexture{
    const view = buffer.createDataView();

    const unk0x00 = view.getInt16(0x00);
    const mipmap = view.getInt8(0x02);
    let uvWrap = view.getInt8(0x03);
    const wrapS = (uvWrap >> 2) * 0x03;
    const wrapT = (uvWrap >> 4) * 0x03;
    const textureIndex = view.getInt16(0x04);
    const unk0x06 = view.getInt8(0x06);
    const anisotropy = view.getInt8(0x07);
    const unk0x0C = view.getInt8(0x0C);
    const isSwappable = ((view.getUint8(0x0D) & 0x01) == 1); // swapping textures in game
    const idx = view.getInt16(0x0E);
    const unk0x10 = view.getInt32(0x10);

    return { mipmap, wrapS, wrapT, textureIndex, anisotropy, idx };
}

function parseMatrix(buffer: ArrayBufferSlice): mat4{
    const view = buffer.createDataView();
    
    const m00 = view.getFloat32(0x00);
    const m01 = view.getFloat32(0x04);
    const m02 = view.getFloat32(0x08);
    const m03 = view.getFloat32(0x0C);
    const m10 = view.getFloat32(0x10);
    const m11 = view.getFloat32(0x14);
    const m12 = view.getFloat32(0x18);
    const m13 = view.getFloat32(0x1C);
    const m20 = view.getFloat32(0x20);
    const m21 = view.getFloat32(0x24);
    const m22 = view.getFloat32(0x28);
    const m23 = view.getFloat32(0x2C);
    const matrix = mat4.fromValues(
        m00, m10, m20, 0,
        m01, m11, m21, 0,
        m02, m12, m22, 0,
        m03, m13, m23, 1,
    );

    return matrix;
}

function parseMaterial(buffer: ArrayBufferSlice, idx: number): GcmfMaterial{
    const view = buffer.createDataView();

    const unk0x02 = view.getUint8(0x02);
    const unk0x03 = view.getUint8(0x03);
    const color0 = colorNewFromRGBA(view.getUint8(0x04), view.getUint8(0x05), view.getUint8(0x06), view.getUint8(0x07));
    const color1 = colorNewFromRGBA(view.getUint8(0x08), view.getUint8(0x09), view.getUint8(0x0A), view.getUint8(0x0B));
    const color2 = colorNewFromRGBA(view.getUint8(0x0C), view.getUint8(0x0D), view.getUint8(0x0E), view.getUint8(0x0F));
    const emission = view.getUint8(0x10);
    const transparent = view.getUint8(0x11);
    const matCount = view.getUint8(0x12);
    const vtxRenderFlag = view.getUint8(0x13);
    const unk0x14 = view.getUint8(0x14);
    const unk0x15 = view.getUint8(0x15);
    const tex0Idx = view.getInt16(0x16);
    const tex1Idx = view.getInt16(0x18);
    const tex2Idx = view.getInt16(0x1A);
    const vtxAttr = view.getUint32(0x1C);

    // GX_Material
    const texGen0 = {
        idx: 0,
        type: GX.TexGenType.MTX2x4,
        source: GX.TexGenSrc.TEX0,
        matrix: GX.TexGenMatrix.IDENTITY,
        normalize: false,
        postMatrix: GX.PostTexGenMatrix.PTIDENTITY
    };
    const texGens = [texGen0];

    const lightChannel0: GX_Material.LightChannelControl = {
        alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: GX.ColorSrc.VTX, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
        colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: GX.ColorSrc.VTX, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
    };

    const lightChannels: GX_Material.LightChannelControl[] = [lightChannel0, lightChannel0];

    const tevStage0: GX_Material.TevStage = {
        channelId: GX.RasColorChannelID.COLOR0A0,

        alphaInA: GX.CA.ZERO,
        alphaInB: GX.CA.ZERO,
        alphaInC: GX.CA.ZERO,
        alphaInD: GX.CA.TEXA,
        alphaOp: GX.TevOp.ADD,
        alphaBias: GX.TevBias.ZERO,
        alphaClamp: false,
        alphaScale: GX.TevScale.SCALE_1,
        alphaRegId: GX.Register.PREV,
        konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

        colorInA: GX.CC.ZERO,
        colorInB: GX.CC.ZERO,
        colorInC: GX.CC.ZERO,
        colorInD: GX.CC.TEXC,
        colorOp: GX.TevOp.ADD,
        colorBias: GX.TevBias.ZERO,
        colorClamp: false,
        colorScale: GX.TevScale.SCALE_1,
        colorRegId: GX.Register.PREV,
        konstColorSel: GX.KonstColorSel.KCSEL_1,

        texCoordId: GX.TexCoordID.TEXCOORD0,
        texMap: GX.TexMapID.TEXMAP0,

        // We don't use indtex.
        indTexStage: GX.IndTexStageID.STAGE0,
        indTexMatrix: GX.IndTexMtxID.OFF,
        indTexFormat: GX.IndTexFormat._8,
        indTexBiasSel: GX.IndTexBiasSel.NONE,
        indTexWrapS: GX.IndTexWrap.OFF,
        indTexWrapT: GX.IndTexWrap.OFF,
        indTexAddPrev: false,
        indTexUseOrigLOD: false,
    };
    const tevStages: GX_Material.TevStage[] = [tevStage0];

    // Filter any pixels less than 0.1.
    const alphaTest: GX_Material.AlphaTest = {
        op: GX.AlphaOp.AND,
        compareA: GX.CompareType.GEQUAL,
        compareB: GX.CompareType.ALWAYS,
        referenceA: 0.1,
        referenceB: 0.0,
    };

    const ropInfo: GX_Material.RopInfo = {
        fogType: GX.FogType.NONE,
        fogAdjEnabled: false,
        blendMode: GX.BlendMode.NONE,
        blendSrcFactor: GX.BlendFactor.ONE,
        blendDstFactor: GX.BlendFactor.ONE,
        blendLogicOp: GX.LogicOp.CLEAR,
        depthFunc: GX.CompareType.LESS,
        depthTest: true,
        depthWrite: true,
        colorUpdate: true,
        alphaUpdate: false,
    };

    const gxMaterial: GX_Material.GXMaterial = {
        // GMA not have Material name
        name: `$material_${idx}`,
        cullMode: (unk0x03 & (1 << 2)) == 2 ? GX.CullMode.ALL : GX.CullMode.FRONT,
        lightChannels,
        texGens,
        tevStages,
        alphaTest,
        ropInfo,
        indTexStages: [],
    };

    return { gxMaterial, color0, color1, color2, emission, transparent, matCount, vtxRenderFlag, tex0Idx, tex1Idx, tex2Idx, vtxAttr };
}

function parseExShape(buffer: ArrayBufferSlice): GcmfExShape{
    const view = buffer.createDataView();

    const unk_0x00 = view.getUint32(0x00);
    const unk_0x04 = view.getUint32(0x04);
    const dlist0Size = view.getUint32(0x08);
    const dlist1Size = view.getUint32(0x0C);

    return{ unk_0x00, unk_0x04, dlist0Size, dlist1Size };
}

function parseShape(buffer: ArrayBufferSlice, attribute: GcmfAttribute, idx: number, vtxCon2Offs: number): GcmfShape{
    const view = buffer.createDataView();
    const mtxIdxs: number[] = [];
    const boundingSphere = vec3.create();

    const material = parseMaterial(buffer.slice(0x00, 0x20), idx);
    for(let i = 0; i < 8; i++){
        mtxIdxs[i] = view.getInt8(0x20 + i);
    }
    const dlist0Size = view.getInt32(0x28);
    const dlist1Size = view.getInt32(0x2C);
    vec3.set(boundingSphere, view.getFloat32(0x30), view.getFloat32(0x34), view.getFloat32(0x38));
    const unk0x3C = view.getInt32(0x3C);
    const unk0x40 = view.getInt32(0x40);
    const exShape = parseExShape(buffer.slice(0x40, 0x60));

    const displayList0 = buffer.slice(0x60, 0x60+dlist0Size);
    const displayList1 = buffer.slice(0x60+dlist0Size, 0x60+dlist0Size+dlist1Size);
    const compShift = 0x00;
    const vtxAttr = material.vtxAttr;
    const vertType = (attribute > 0 ? GX.CompType.F32 : GX.CompType.S16);
    
    const vat: GX_VtxAttrFmt[] = [];
    vat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: vertType, compShift };
    vat[GX.Attr.NRM] = { compCnt: GX.CompCnt.NRM_XYZ, compType: vertType, compShift };
    vat[GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA4, compShift };
    vat[GX.Attr.CLR1] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA4, compShift };
    vat[GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compType: vertType, compShift };
    vat[GX.Attr.TEX1] = { compCnt: GX.CompCnt.TEX_ST, compType: vertType, compShift };
    vat[GX.Attr.TEX2] = { compCnt: GX.CompCnt.TEX_ST, compType: vertType, compShift };

    const vcd: GX_VtxDesc[] = [];
    for (let i = 0; i <= GX.Attr.MAX; i++) {
        if ((vtxAttr & (1 << i)) !== 0) {
            vcd[i] = { type: (attribute > GcmfAttribute.direct ? GX.AttrType.INDEX16 : GX.AttrType.DIRECT) };
        }
    }
    
    const arrays: GX_Array[] = [];
    // TODO:Set GX_Array
    arrays[GX.Attr.POS]  = { buffer, offs: 0, stride: 0x00 };

    const loader = compileVtxLoader(vat, vcd);
    const loadedVertexLayout = loader.loadedVertexLayout;
    const loadedVertexData = loader.runVertices(arrays, displayList0);
    // const loadedVertexData1 = loader.runVertices(arrays, displayList1);

    return{ material, mtxIdxs, dlist0Size, dlist1Size, boundingSphere, exShape, loadedVertexLayout, loadedVertexData };
}

function parseGcmf(buffer: ArrayBufferSlice): Gcmf{
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === "GCMF");
    const textures: GcmfTexture[] = [];
    const matrixs: mat4[] = [];
    const shapes: GcmfShape[] = [];
    const origin = vec3.create();

    const attribute = view.getUint32(0x04);
    vec3.set(origin, view.getFloat32(0x08), view.getFloat32(0x0C), view.getFloat32(0x10));
    const boundSpeher = view.getFloat32(0x14);

    const texCount = view.getInt16(0x18);
    const materialCount = view.getInt16(0x1A);
    const traslucidMaterialCount = view.getInt16(0x1C);
    const mtxCount = view.getInt8(0x1E);
    // Texture and Matrix Size
    const texMtxSize = view.getInt32(0x20);

    let allMaterialCount = materialCount + traslucidMaterialCount;

    // GcmfTexture
    for(let i = 0; i < texCount; i++){
        let offs = 0x40 + 0x20 * i;

        textures.push( parseTexture(buffer.slice(offs)) );
    }

    // GcnfMatrix
    let matPos = 0x40 + 0x20 * texCount;
    for(let i = 0; i < mtxCount; i++){
        let offs = matPos + 0x30 * i;
        
        matrixs.push( parseMatrix(buffer.slice(offs)) );
    }

    // GcmfVertexControl
    let vtxConCount = 0x00;
    let vtxCon1Offs = 0x00;
    let vtxCon2Offs = 0x00;
    let vtxCon3Offs = 0x00;
    let vtxCon4Offs = 0x00;
    if (attribute > GcmfAttribute.direct){
        vtxConCount = view.getInt32(texMtxSize + 0x00);
        vtxCon1Offs = view.getInt32(texMtxSize + 0x04);
        vtxCon2Offs = view.getInt32(texMtxSize + 0x08);
        vtxCon3Offs = view.getInt32(texMtxSize + 0x0C);
        vtxCon4Offs = view.getInt32(texMtxSize + 0x10);
    }
    
    let shapeOffs = (attribute > GcmfAttribute.direct ? 0x20 : 0x00 );
    let shapeBuff = buffer.slice(texMtxSize);
    // GcmfShape
    for(let i = 0; i < allMaterialCount; i++){
        const shape = parseShape(shapeBuff.slice(shapeOffs), attribute, i, vtxCon2Offs);
        shapes.push( shape );

        shapeOffs += 0x60 + shape.dlist0Size + shape.dlist1Size;
    }



    return { attribute, origin, boundSpeher, texCount, materialCount, traslucidMaterialCount, mtxCount, matrixs, textures, shapes };
}

export function parse(buffer: ArrayBufferSlice): GMA{
    const view = buffer.createDataView();
    const count = view.getInt32(0x00);
    const gcmfEntryOffs: GcmfEntryOffset[] = [];
    const gcmfEntrys: GcmfEntry[] = [];

    const gcmfBaseOffs = view.getUint32(0x04);
    
    // Gcmf Entry Offset
    const entry = buffer.slice(0x08);
    const entryView = entry.createDataView();
    for(let i = 0; i < count; i++){
        let offset = 0x08 * i;
        
        const gcmfOffs = entryView.getInt32(offset);
        const nameOffs = entryView.getInt32(offset + 0x04);
        gcmfEntryOffs.push({gcmfOffs, nameOffs});
    }

    // GcmfEntry
    const nameBuff = entry.slice(0x08 * count, gcmfBaseOffs);
    const gcmfBuff = buffer.slice(gcmfBaseOffs);
    for(let i = 0; i < gcmfEntryOffs.length; i++){
        let nameOffs = gcmfEntryOffs[i].nameOffs;
        const name = readString(nameBuff, nameOffs);
        let gcmfOffs = gcmfEntryOffs[i].gcmfOffs;
        const gcmf = parseGcmf(gcmfBuff.slice(gcmfOffs));

        gcmfEntrys.push({gcmf, name});
    }

    return{ gcmfEntrys };
}