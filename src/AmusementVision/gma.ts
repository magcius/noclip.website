// Parses Amusement Vision GMA Format (GeoMetry Archive) files.
// https://gitlab.com/RaphaelTetreault/fzgx_documentation/-/blob/master/asset/GMA%20Structure.md

import * as GX from "../gx/gx_enum";
import * as GX_Material from '../gx/gx_material';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { mat4, vec3 } from "gl-matrix";
import { assert, hexzero, readString } from "../util"
import { Color, colorNewFromRGBA } from "../Color";
import { compileVtxLoaderMultiVat, getAttributeByteSize, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, VtxLoader } from "../gx/gx_displaylist";

// GCMF Attribute
export const enum GcmfAttribute{
    value16Bit = (1 << 0), // vertex length is 16bit (VTXFMT1)
    none = (1 << 1),       // maybe not exist
    stiching = (1 << 2),
    skin = (1 << 3),
    effect = (1 << 4)
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
    texIdxs: number[], // GMA can store max 3 texture index
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
    dlist0Length: number,
    dlist1Length: number
}

// GCMF GcmfTexture
export interface GcmfTexture{
    mipmap: GX.TexFilter,
    wrapS: GX.WrapMode,
    wrapT: GX.WrapMode,
    texIdx: number, // index of tpl
    anisotropy: number,
    idx: number // index of GcmfTexture
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
    const AVmipmap: GX.TexFilter = view.getInt8(0x02);
    const mipmap = GX.TexFilter.LIN_MIP_LIN;
    let uvWrap = view.getInt8(0x03);
    const wrapS: GX.WrapMode = (uvWrap >> 2) & 0x03;
    const wrapT: GX.WrapMode = (uvWrap >> 4) & 0x03;
    const texIdx = view.getInt16(0x04);
    const unk0x06 = view.getInt8(0x06);
    const anisotropy = view.getInt8(0x07);
    const unk0x0C = view.getInt8(0x0C);
    const isSwappable = ((view.getUint8(0x0D) & 0x01) == 1); // swapping textures in game
    const idx = view.getInt16(0x0E);
    const unk0x10 = view.getInt32(0x10);

    return { mipmap, wrapS, wrapT, texIdx, anisotropy, idx };
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
    const texIdxs: number[] = [];

    const unk0x02 = view.getUint8(0x02);
    const unk0x03 = view.getUint8(0x03);
    const color0: Color = colorNewFromRGBA(view.getUint8(0x04), view.getUint8(0x05), view.getUint8(0x06), view.getUint8(0x07));
    const color1: Color = colorNewFromRGBA(view.getUint8(0x08), view.getUint8(0x09), view.getUint8(0x0A), view.getUint8(0x0B));
    const color2: Color = colorNewFromRGBA(view.getUint8(0x0C), view.getUint8(0x0D), view.getUint8(0x0E), view.getUint8(0x0F));
    const emission = view.getUint8(0x10);
    const transparent = view.getUint8(0x11);
    const matCount = view.getUint8(0x12);
    const vtxRenderFlag: GX.AttrType = view.getUint8(0x13);
    const unk0x14 = view.getUint8(0x14);
    const unk0x15 = view.getUint8(0x15);
    for(let i = 0; i < 3; i++){
        let offs = 0x16 + i * 0x02;
        texIdxs[i] = view.getInt16(offs);
    }

    const vtxAttr: GX.Attr = view.getUint32(0x1C);

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
        // cullMode: (unk0x03 & (1 << 2)) == 2 ? GX.CullMode.NONE : GX.CullMode.FRONT,
        cullMode: GX.CullMode.NONE,
        lightChannels,
        texGens,
        tevStages,
        alphaTest,
        ropInfo,
        indTexStages: [],
    };

    return { gxMaterial, color0, color1, color2, emission, transparent, matCount, vtxRenderFlag, texIdxs, vtxAttr };
}

function parseExShape(buffer: ArrayBufferSlice): GcmfExShape{
    const view = buffer.createDataView();

    const unk_0x00 = view.getUint32(0x00);
    const unk_0x04 = view.getUint32(0x04);
    const dlist0Length = view.getUint32(0x08);
    const dlist1Length = view.getUint32(0x0C);

    return{ unk_0x00, unk_0x04, dlist0Length, dlist1Length };
}

function parseShape(buffer: ArrayBufferSlice, attribute: GcmfAttribute, idx: number, vtxCon2Offs: number): GcmfShape{
    function fillVatFormat(vtxType: GX.CompType, compShift: number): GX_VtxAttrFmt[] {
        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: vtxType, compShift };
        vatFormat[GX.Attr.NRM] = { compCnt: GX.CompCnt.NRM_XYZ, compType: vtxType, compShift };
        vatFormat[GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift };
        vatFormat[GX.Attr.CLR1] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift };
        vatFormat[GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };
        vatFormat[GX.Attr.TEX1] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };
        vatFormat[GX.Attr.TEX2] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };
        vatFormat[GX.Attr.NBT] = { compCnt: GX.CompCnt.NRM_XYZ, compType: vtxType, compShift };
        return vatFormat;
    }
    
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

    const dlistSize = dlist0Size+dlist1Size;
    const dlist = buffer.slice(0x60+0x01, 0x60+dlistSize);
    const compShift = 0x00;
    const vtxAttr = material.vtxAttr;
    // value16Bit is only VTXFM1
    const fmtVat = (attribute === GcmfAttribute.value16Bit ? GX.VtxFmt.VTXFMT1 : GX.VtxFmt.VTXFMT0);
    
    const vat: GX_VtxAttrFmt[][] = [];
    vat[GX.VtxFmt.VTXFMT0] = fillVatFormat(GX.CompType.F32, compShift);
    vat[GX.VtxFmt.VTXFMT1] = fillVatFormat(GX.CompType.S16, compShift);

    const vcd: GX_VtxDesc[] = [];
    for (let i = 0; i <= GX.Attr.MAX; i++) {
        if ((vtxAttr & (1 << i)) !== 0) {
            vcd[i] = { type: (attribute > GcmfAttribute.none ? GX.AttrType.INDEX16 : GX.AttrType.DIRECT) };
        }
    }

    const arrays: GX_Array[] = [];
    arrays[GX.Attr.POS]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.POS) };
    arrays[GX.Attr.NRM]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.NRM) };
    arrays[GX.Attr.CLR0]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.CLR0) };
    arrays[GX.Attr.CLR1]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.CLR1) };
    arrays[GX.Attr.TEX0]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX0) };
    arrays[GX.Attr.TEX1]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX1) };
    arrays[GX.Attr.TEX2]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX2) };
    arrays[GX.Attr.NBT]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.NBT) };

    const loader = compileVtxLoaderMultiVat(vat, vcd);
    const loadedVertexLayout = loader.loadedVertexLayout;
    const loadedVertexData = loader.runVertices(arrays, dlist);

    return{ material, mtxIdxs, dlist0Size, dlist1Size, boundingSphere, exShape, loadedVertexLayout, loadedVertexData };
}

function parseGcmf(buffer: ArrayBufferSlice): Gcmf{
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === "GCMF");
    const textures: GcmfTexture[] = [];
    const matrixs: mat4[] = [];
    const shapes: GcmfShape[] = [];
    const origin = vec3.create();

    const attribute: GcmfAttribute = view.getUint32(0x04);
    if (attribute === GcmfAttribute.skin || attribute === GcmfAttribute.effect){
        throw "not support attribute skin";
    }
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
    if (attribute > GcmfAttribute.none){
        vtxConCount = view.getInt32(texMtxSize + 0x00);
        vtxCon1Offs = view.getInt32(texMtxSize + 0x04);
        vtxCon2Offs = view.getInt32(texMtxSize + 0x08);
        vtxCon3Offs = view.getInt32(texMtxSize + 0x0C);
        vtxCon4Offs = view.getInt32(texMtxSize + 0x10);
    }
    
    let shapeOffs = (attribute > GcmfAttribute.none ? 0x20 : 0x00 );
    let shapeBuff = buffer.slice(texMtxSize);
    // GcmfShape
    for(let i = 0; i < allMaterialCount; i++){
        const shape = parseShape(shapeBuff.slice(shapeOffs), attribute, i, vtxCon2Offs);
        if(shape.material.texIdxs[0] < 0){
            // ignore invalid tex0Index material
            continue;
        }
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
        let gcmfOffs = gcmfEntryOffs[i].gcmfOffs;
        if (gcmfOffs < 0 && nameOffs <= 0){
            // ignore invaild gcmf
            continue;
        }
        const name = readString(nameBuff, nameOffs);
        const gcmf = parseGcmf(gcmfBuff.slice(gcmfOffs));

        if (gcmf.attribute === GcmfAttribute.skin || gcmf.attribute === GcmfAttribute.effect){
            // ignore "skin" and "effect" model.
            // TODO: Support "skin" and "effect" model.
            continue;
        }
        if (gcmf.materialCount + gcmf.traslucidMaterialCount < 1){
            // ignore invaild gcmf
            continue;
        }
        gcmfEntrys.push({gcmf, name});
    }

    return{ gcmfEntrys };
}