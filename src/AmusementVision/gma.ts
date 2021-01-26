// Parses Amusement Vision GMA Format (GeoMetry Archive) files.
// https://craftedcart.github.io/SMBLevelWorkshop/documentation/index.html?page=gmaFormat
// https://gitlab.com/RaphaelTetreault/fzgx_documentation/-/blob/master/asset/GMA%20Structure.md

import * as GX from "../gx/gx_enum";
import * as GX_Material from '../gx/gx_material';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { mat4, vec3 } from "gl-matrix";
import { assert, hexzero, readString } from "../util"
import { Color, colorNewFromRGBA } from "../Color";
import { compileVtxLoaderMultiVat, getAttributeByteSize, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, VtxLoader } from "../gx/gx_displaylist";

// GCMF Attribute
export interface GcmfAttribute{
    value16Bit: Boolean, // vertex length is 16bit (VTXFMT1)
    unk0x01: Boolean,    // maybe not exist
    stiching: Boolean,
    skin: Boolean,
    effective: Boolean
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
    samplerIdxs: number[], // GMA can store max 3 sampler index
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
    boundingSphere: vec3,
    dlistHeaders: GcmfDisplaylistHeader[],
    loadedVertexLayout: LoadedVertexLayout,
    loadedVertexDatas: LoadedVertexData[]
}

// GCMF DisplaylistHeader
interface GcmfDisplaylistHeader{
    mtxIdxs: number[],
    dlistSizes: number[],
    submesh_end_offs: number
}

// GCMF GcmfSampler
export interface GcmfSampler{
    mipmapAV: number,
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
    samplers: GcmfSampler[],
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


function parseSampler(buffer: ArrayBufferSlice): GcmfSampler{
    const view = buffer.createDataView();

    const unk0x00 = view.getInt16(0x00);
    const mipmapAV = view.getInt8(0x02);
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

    return { mipmapAV, wrapS, wrapT, texIdx, anisotropy, idx };
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
    const samplerIdxs: number[] = [];

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
        samplerIdxs[i] = view.getInt16(offs);
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
        name: `material_${idx}`,
        cullMode: (unk0x03 & (1 << 1)) !== 0 ? GX.CullMode.NONE : GX.CullMode.FRONT,
        lightChannels,
        texGens,
        tevStages,
        alphaTest,
        ropInfo,
        indTexStages: [],
    };

    return { gxMaterial, color0, color1, color2, emission, transparent, matCount, vtxRenderFlag, samplerIdxs, vtxAttr };
}

function parseExShape(buffer: ArrayBufferSlice): GcmfDisplaylistHeader{
    const view = buffer.createDataView();
    const mtxIdxs = [];
    const dlistSizes = [];
    let offs = 0x00;
    for(let i = 0; i < 8; i++){
        let mtxIdx = view.getUint32(offs);
        mtxIdxs.push(mtxIdx);
        offs += 0x01 * i;
    }
    for(let i = 0; i < 2; i++){
        let dlistSize = view.getUint32(offs);
        dlistSizes.push(dlistSize);
        offs += 0x04 * i;
    }
    const submesh_end_offs = view.byteOffset + 0x20;

    return{ mtxIdxs, dlistSizes, submesh_end_offs };
}

function parseShape(buffer: ArrayBufferSlice, attribute: GcmfAttribute, idx: number, vtxCon2Offs: number): GcmfShape{
    function fillVatFormat(vtxType: GX.CompType, isNBT: boolean): GX_VtxAttrFmt[] {
        const vatFormat: GX_VtxAttrFmt[] = [];
        const compShift = 0x00;
        vatFormat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: vtxType, compShift };
        vatFormat[GX.Attr.NRM] = { compCnt: isNBT ? GX.CompCnt.NRM_NBT : GX.CompCnt.NRM_XYZ, compType: vtxType, compShift };
        vatFormat[GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift };
        vatFormat[GX.Attr.CLR1] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift };
        vatFormat[GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };
        vatFormat[GX.Attr.TEX1] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };
        vatFormat[GX.Attr.TEX2] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };
        
        return vatFormat;
    }

    function generateLoadedVertexData(dlist: ArrayBufferSlice, vat: GX_VtxAttrFmt[][], fmtVat: GX.VtxFmt.VTXFMT0 | GX.VtxFmt.VTXFMT1, isNBT: boolean, loader: VtxLoader, isCW: boolean): LoadedVertexData{
        const arrays: GX_Array[] = [];
        arrays[GX.Attr.POS]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.POS) };
        arrays[GX.Attr.NRM]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.NRM) * (isNBT ? 3 : 1) };
        arrays[GX.Attr.CLR0]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.CLR0) };
        arrays[GX.Attr.CLR1]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.CLR1) };
        arrays[GX.Attr.TEX0]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX0) };
        arrays[GX.Attr.TEX1]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX1) };
        arrays[GX.Attr.TEX2]  = { buffer: dlist, offs: 0x00, stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX2) };
        const loadedVertexData = loader.runVertices(arrays, dlist);
        if (isCW) {
            // convert cw triangle-strip to ccw triangle-strip
            const dstIndexData = new Uint16Array(loadedVertexData.indexData);
            for (let i = 1; i < loadedVertexData.totalIndexCount+1; i++){
                if (i % 3 == 0 && i > 0){
                    let temp_indexData = dstIndexData[i-3];
                    dstIndexData[i-3] = dstIndexData[i-1];
                    dstIndexData[i-1] = temp_indexData;
                }
            }
            loadedVertexData.indexData = dstIndexData.buffer;
        }
        return loadedVertexData;
    }

    const view = buffer.createDataView();
    
    let mtxIdxs: number[] = [];
    const boundingSphere = vec3.create();
    let dlistSizes: number[] = [];
    const loadedVertexDatas: LoadedVertexData[] = [];
    const dlistHeaders: GcmfDisplaylistHeader[] = [];

    const material = parseMaterial(buffer.slice(0x00, 0x20), idx);
    for(let i = 0; i < 8; i++){
        let mtxIdx = view.getInt8(0x20 + i);
        mtxIdxs.push(mtxIdx);
    }
    for(let i = 0; i < 2; i++){
        let dlistSize = view.getInt32(0x28 + 0x04 * i);
        dlistSizes.push(dlistSize);
    }
    vec3.set(boundingSphere, view.getFloat32(0x30), view.getFloat32(0x34), view.getFloat32(0x38));
    const unk0x3C = view.getInt32(0x3C);
    const unk0x40 = view.getInt32(0x40);
    const submesh_end_offs = view.byteOffset + 0x60;
    dlistHeaders.push({ mtxIdxs, dlistSizes, submesh_end_offs })

    let vtxRenderFlag = material.vtxRenderFlag;
    if(vtxRenderFlag & 1 >> 2 ||  vtxRenderFlag & 1 >> 3){
        //Exsit Extra DisplayList
        console.log(`Decetct Extra DisplayList`);
        let offs = 0x60;
        for(let i = 0; i < 2; i++){
            offs += dlistHeaders[0].dlistSizes[i];
        }
        let dlistHeader = parseExShape(buffer.slice(offs, offs + 0x20));
        dlistHeaders.push(dlistHeader);
    }

    const vtxAttr = material.vtxAttr;
    const vcd: GX_VtxDesc[] = [];
    for (let i = 0; i <= GX.Attr.MAX; i++) {
        if ((vtxAttr & (1 << i)) !== 0) {
            vcd[i] = { type: GX.AttrType.DIRECT };
        }
    }
    let isNBT = ((vtxAttr & (1 << GX.Attr._NBT)) !== 0);
    if (isNBT) {
        console.log(`Decetct NBT`);
        console.log(`vtxAttr: ${hexzero(vtxAttr, 8)} submesh offset: ${hexzero(view.byteOffset, 8)}`);
        vcd[GX.Attr.NRM] = { type: GX.AttrType.DIRECT };
    }
    const vat: GX_VtxAttrFmt[][] = [];
    vat[GX.VtxFmt.VTXFMT0] = fillVatFormat(GX.CompType.F32, isNBT);
    vat[GX.VtxFmt.VTXFMT1] = fillVatFormat(GX.CompType.S16, isNBT);
    const loader = compileVtxLoaderMultiVat(vat, vcd);
    const loadedVertexLayout = loader.loadedVertexLayout;
    // value16Bit is VTXFM1
    const fmtVat = (attribute.value16Bit ? GX.VtxFmt.VTXFMT1 : GX.VtxFmt.VTXFMT0);
    
    let dlistOffs = 0x60;
    dlistHeaders.forEach(dlistHeader => {
        let dlistSizes = dlistHeader.dlistSizes;
        for(let i = 0; i < dlistSizes.length; i++) {
            let size = dlistSizes[i];
            if (size <= 0) {
                continue;
            }
            let isCW = i % 2 == 1;
            let dlisEndOffs = dlistOffs + size;
            let dlist = buffer.slice(dlistOffs + 0x01, dlisEndOffs);
            const loadedVertexData = generateLoadedVertexData(dlist, vat, fmtVat, isNBT, loader, isCW);
            loadedVertexDatas.push(loadedVertexData);

            dlistOffs = dlisEndOffs;
        }
    });

    return{ material, boundingSphere, dlistHeaders, loadedVertexLayout, loadedVertexDatas };
}

function parseGcmf(buffer: ArrayBufferSlice): Gcmf{
    function parseGCMFAttribute(attribute: number): GcmfAttribute{
        const value16Bit = ((attribute >> 0) & 0x01) == 1;
        const unk0x01 = ((attribute >> 1) & 0x01) == 1;
        const stiching = ((attribute >> 2) & 0x01) == 1;
        const skin = ((attribute >> 3) & 0x01) == 1;
        const effective = ((attribute >> 4) & 0x01) == 1;

        return { value16Bit, unk0x01, skin, stiching, effective };
    }
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === "GCMF");
    const samplers: GcmfSampler[] = [];
    const matrixs: mat4[] = [];
    const shapes: GcmfShape[] = [];
    const origin = vec3.create();

    const attribute = parseGCMFAttribute(view.getUint32(0x04));
    let useVtxCon = (attribute.skin || attribute.effective);
    vec3.set(origin, view.getFloat32(0x08), view.getFloat32(0x0C), view.getFloat32(0x10));
    const boundSpeher = view.getFloat32(0x14);

    const texCount = view.getInt16(0x18);
    const materialCount = view.getInt16(0x1A);
    const traslucidMaterialCount = view.getInt16(0x1C);
    const mtxCount = view.getInt8(0x1E);
    // Texture and Matrix Size
    const texMtxSize = view.getInt32(0x20);

    let allMaterialCount = materialCount + traslucidMaterialCount;
    let offs = 0x40
    // GcmfSampler
    for(let i = 0; i < texCount; i++){
        samplers.push( parseSampler(buffer.slice(offs)) );
        offs += 0x20;
    }

    // GcnfMatrix
    for(let i = 0; i < mtxCount; i++){
        matrixs.push( parseMatrix(buffer.slice(offs)) );
        offs += 0x30;
    }

    // GcmfVertexControl
    let vtxConCount = 0x00;
    let vtxCon1Offs = 0x00;
    let vtxCon2Offs = 0x00;
    let vtxCon3Offs = 0x00;
    let vtxCon4Offs = 0x00;
    if (useVtxCon){
        vtxConCount = view.getInt32(texMtxSize + 0x00);
        vtxCon1Offs = view.getInt32(texMtxSize + 0x04);
        vtxCon2Offs = view.getInt32(texMtxSize + 0x08);
        vtxCon3Offs = view.getInt32(texMtxSize + 0x0C);
        vtxCon4Offs = view.getInt32(texMtxSize + 0x10);

        // let vtxCon: GcmfVertexControl;
    }
    
    let shapeOffs = (useVtxCon ? 0x20 : 0x00 );
    let shapeBuff = buffer.slice(texMtxSize);
    // GcmfShape
    for(let i = 0; i < allMaterialCount; i++){
        let vtxAttr = view.getUint32(texMtxSize + shapeOffs + 0x1C);
        if ((vtxAttr & (1 << GX.Attr._NBT)) !== 0){
            console.log(`Not support NBT`);
            continue;
        }
        const shape = parseShape(shapeBuff.slice(shapeOffs), attribute, i, vtxCon2Offs);
        if(shape.material.samplerIdxs[0] < 0){
            console.log(`Detect Invalid samplerIdxs[0]`);
            continue;
        }
        shapes.push( shape );
        let offs = 0x60;
        let dlistHeader = shape.dlistHeaders[shape.dlistHeaders.length -1 ];
        for (let j = 0; j < 2; j++){
            offs += dlistHeader.dlistSizes[j];
        }
        shapeOffs += offs;
    }

    return { attribute, origin, boundSpeher, texCount, materialCount, traslucidMaterialCount, mtxCount, matrixs, samplers, shapes };
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
    let offs = 0x00
    for(let i = 0; i < count; i++){
        const gcmfOffs = entryView.getInt32(offs);
        const nameOffs = entryView.getInt32(offs + 0x04);
        gcmfEntryOffs.push({gcmfOffs, nameOffs});
        offs += 0x08;
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

        let attr = view.getUint32(gcmfBaseOffs + gcmfOffs + 0x04);
        let notSupport = (attr & (1 << 3)) !== 0 || (attr & (1 << 4)) !== 0 || (attr & (1 << 5)) !== 0;
        if (notSupport){
            // ignore "Stiching Model", "Skin Model" and "Effective Model".
            // TODO: Support those model.
            console.log(`not support this model ${hexzero(gcmfBaseOffs + gcmfOffs, 8)}`);
            console.log(`Stiching Model:${(attr & (1 << 3)) !== 0} Skin Model:${(attr & (1 << 4)) !== 0} Effective Model:${(attr & (1 << 5)) !== 0}`);
            continue;
        }
        const gcmf = parseGcmf(gcmfBuff.slice(gcmfOffs));
        if (gcmf.materialCount + gcmf.traslucidMaterialCount < 1){
            // ignore invaild gcmf
            continue;
        }
        gcmfEntrys.push({gcmf, name});
    }

    return{ gcmfEntrys };
}