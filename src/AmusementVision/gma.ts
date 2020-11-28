// Parses Amusement Vision GMA Format (GeoMetry Archive) files.
// https://gitlab.com/RaphaelTetreault/fzgx_documentation/-/blob/master/asset/GMA%20Structure.md

import * as GX from "../gx/gx_enum";

import ArrayBufferSlice from "../ArrayBufferSlice";
import { mat4, vec3 } from "gl-matrix";
import { assert, readString } from "../util"
import { Color, colorAdd, colorNewFromRGBA } from "../Color";
import { compileVtxLoader, DisplayListRegisters, displayListRegistersRun, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, VtxLoader } from "../gx/gx_displaylist";
import { parse } from "../oot3d/cmb";

// GCMF Attribute
const enum GcmfAttribute{
    value16Bit = 0, // vertex length is 16bit
    direct = 1,
    stiching = 2,
    skin = 3
}

// GCMF Material
interface GcmfMaterial{
    color0: Color,
    color1: Color,
    color2: Color,
    emission: number,
    transparent: number,
    vertexRenderFlag: GX.AttrType,
    tex0Index: number,
    tex1Index: number,
    tex2Index: number,
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
    // transform_matrix_indices: number
    boundingSphere: vec3,

    loadedVertexLayout: LoadedVertexLayout,
    loadedVertexData0: LoadedVertexData | null,
    loadedVertexData1: LoadedVertexData | null,
    // loadedVertexDataEx0: LoadedVertexData | null,
    // loadedVertexDataEx1: LoadedVertexData | null,
}

export interface GcmfExShape{
    unk_0x00: number,
    unk_0x04: number,
    shape0Size: number,
    shape1Size: number
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
    isSwappable: boolean, // changing textures
    index: number
}

interface GcmfEntryOffset{
    gcmfOffs: number,
    nameOffs: number
}

interface GcmfEntry{
    gcmf: Gcmf,
    name: string
}

export interface Gcmf{
    attribute: GcmfAttribute,
    origin: vec3,
    boundSpeher: number,
    textureCount: number,
    materialCount: number,
    traslucidMaterialCount: number,
    textures: GcmfTexture[],
    // matrixIndices : number,
    // matrixs: mat4,
    shapes: GcmfShape[]
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
    const isSwappable = ((view.getUint8(0x0D) & 0x01) == 1);
    const index = view.getInt16(0x0E);
    const unk0x10 = view.getInt32(0x10);

    return { mipmap, wrapS, wrapT, textureIndex, anisotropy, isSwappable, index };
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

function parseMaterial(buffer: ArrayBufferSlice): GcmfMaterial{
    const view = buffer.createDataView();

    const unk0x02 = view.getUint8(0x02);
    const unk0x03 = view.getUint8(0x03);
    const color0 = colorNewFromRGBA(view.getUint8(0x04), view.getUint8(0x05), view.getUint8(0x06), view.getUint8(0x07));
    const color1 = colorNewFromRGBA(view.getUint8(0x08), view.getUint8(0x09), view.getUint8(0x0A), view.getUint8(0x0B));
    const color2 = colorNewFromRGBA(view.getUint8(0x0C), view.getUint8(0x0D), view.getUint8(0x0E), view.getUint8(0x0F));
    const emission = view.getUint8(0x10);
    const transparent = view.getUint8(0x11);
    const materialCount = view.getUint8(0x12);
    const vertexRenderFlag = view.getUint8(0x13);
    const unk0x14 = view.getUint8(0x14);
    const unk0x15 = view.getUint8(0x15);
    const tex0Index = view.getInt16(0x16);
    const tex1Index = view.getInt16(0x18);
    const tex2Index = view.getInt16(0x1A);
    const vtxAttr = view.getUint32(0x1C);

    return { color0, color1, color2, emission, transparent, vertexRenderFlag, tex0Index, tex1Index, tex2Index, vtxAttr };
}

function parseShape(buffer: ArrayBufferSlice, attribute: GcmfAttribute): GcmfShape{
    const view = buffer.createDataView();
    const boundingSphere = vec3.create();

    const material = parseMaterial(buffer.slice(0x20));
    const shape0Size = view.getInt32(0x28);
    const shape1Size = view.getInt32(0x2C);
    vec3.set(boundingSphere, view.getFloat32(0x30), view.getFloat32(0x34), view.getFloat32(0x38));
    const unk0x3C = view.getFloat32(0x3C);
    const unk0x40 = view.getFloat32(0x40);
    const exShape = parseExShape(buffer.slice(0x40, 0x20));

    const displayList0 = buffer.slice(0x60, shape0Size);
    const displayList1 = buffer.slice(0x60+shape0Size, shape1Size);
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
    const loadedVertexData0 = loader.runVertices(arrays, displayList0);
    const loadedVertexData1 = loader.runVertices(arrays, displayList1);

    return{ material, boundingSphere, loadedVertexLayout, loadedVertexData0, loadedVertexData1 };
}

function parseExShape(buffer: ArrayBufferSlice): GcmfExShape{
    const view = buffer.createDataView();

    const unk_0x00 = view.getUint32(0x00);
    const unk_0x04 = view.getUint32(0x04);
    const shape0Size = view.getUint32(0x08);
    const shape1Size = view.getUint32(0x0C);

    return{ unk_0x00, unk_0x04, shape0Size, shape1Size };
}

function parseGcmf(buffer: ArrayBufferSlice){
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === "GCMF");
    const textures: GcmfTexture[] = [];
    const matrixs: mat4[] = [];
    const shapes: GcmfShape[] = [];
    const origin = vec3.create();

    const attribute = view.getUint32(0x04);
    vec3.set(origin, view.getFloat32(0x08), view.getFloat32(0x0C), view.getFloat32(0x10));
    const boundSpeher = view.getFloat32(0x14);

    const textureCount = view.getInt16(0x18);
    const materialCount = view.getInt16(0x1A);
    const traslucidMaterialCount = view.getInt16(0x1C);
    const matrixCount = view.getInt8(0x1E);
    const matrixIndices = view.getFloat32(0x20);

    // GcmfTexture
    for(let i = 0; i < textureCount; i++){
        let offs = 0x40 + 0x20 * i;

        textures.push( parseTexture(buffer.slice(offs)) );
    }

    // matrixs: mat4,
    let matPos = 0x40 + 0x20 * textureCount;
    for(let i = 0; i < matrixCount; i++){
        let offs = matPos + 0x30 * i;
        
        matrixs.push( parseMatrix(buffer.slice(offs)) );
    }

    // GcmfVertexControl
    // TODO: implement VertexControll parser
    if (attribute > GcmfAttribute.direct){
    }
    let mtxPos = matPos + (matrixCount > 0 ? 0x30 * matrixCount + 0x10 : 0x00);

    // GcmfShape
    for(let i = 0; i < textureCount; i++){
        let offs = mtxPos + (attribute > GcmfAttribute.direct ? 0x20 : 0x00) + 0x20 * i;

        shapes.push( parseShape(buffer.slice(offs), attribute) );
    }

    return { attribute, origin, boundSpeher, textureCount, materialCount, traslucidMaterialCount, textures, shapes };
}

function parseGma(buffer: ArrayBufferSlice){
    const view = buffer.createDataView();
    const count = view.getInt32(0x00);
    const entry_offset: GcmfEntryOffset[] = [];
    const entry: GcmfEntry[] = [];

    let pos_base_gcmf = 0x04;
    let pos_base_name = 0x08 * count;

    const base_gcmf = view.getUint32(pos_base_gcmf);
    const base_name = view.getUint32(base_gcmf + pos_base_name);
    // Gcmf Entry Offset
    for(let i = 0; i < count; i++){
        let offset = 0x04 * i;
        const gcmfOffs = view.getUint32(base_gcmf + offset);
        const nameOffs = view.getUint32(base_name + offset);
        entry_offset.push({gcmfOffs, nameOffs});
    }
    // GcmfEntry
    for(let i = 0; i < entry_offset.length; i++){
        let gcmfOffs = entry_offset[i].gcmfOffs;
        const gcmf = parseGcmf(buffer.slice(gcmfOffs));
        let nameOffs = entry_offset[i].nameOffs;
        const name = readString(buffer, nameOffs);

        entry.push({gcmf, name});
    }
}