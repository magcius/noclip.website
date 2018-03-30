
// GX display list parsing.

// A Display List contains a number of primitive draw calls. However, instead of having
// one global index into an index buffer pointing to vertex data, the GX instead can allow
// specifying separate indices per attribute. So you can have POS's indexes be 0 1 2 3 and
// and NRM's indexes be 0 0 0 0. Additionally, each draw call can specify one of 8 different
// vertex attribute formats, though in most cases games tend to use one VAT.
//
// TODO(jtpierre): Actually support multiple VATs, which Metroid Prime uses.

import * as GX from './gx_enum';
import { align, assert } from '../util';

// GX_SetVtxAttrFmt
export interface GX_VtxAttrFmt {
    compType: GX.CompType;
    compCnt: GX.CompCnt;
}

// GX_SetVtxDesc
export interface GX_VtxDesc {
    type: GX.AttrType;
}

// GX_SetArray
export interface GX_Array {
    buffer: ArrayBuffer;
    offs: number;
    // TODO(jstpierre): stride
}

type CompSize = 1 | 2 | 4;

export function getComponentSize(dataType: GX.CompType): CompSize {
    switch (dataType) {
    case GX.CompType.U8:
    case GX.CompType.S8:
    case GX.CompType.RGBA8:
        return 1;
    case GX.CompType.U16:
    case GX.CompType.S16:
        return 2;
    case GX.CompType.F32:
        return 4;
    }
}

export function getNumComponents(vtxAttrib: GX.VertexAttribute, componentCount: GX.CompCnt): number {
    switch (vtxAttrib) {
    case GX.VertexAttribute.POS:
        if (componentCount === GX.CompCnt.POS_XY)
            return 2;
        else if (componentCount === GX.CompCnt.POS_XYZ)
            return 3;
    case GX.VertexAttribute.NRM:
        return 3;
    case GX.VertexAttribute.CLR0:
    case GX.VertexAttribute.CLR1:
        if (componentCount === GX.CompCnt.CLR_RGB)
            return 3;
        else if (componentCount === GX.CompCnt.CLR_RGBA)
            return 4;
    case GX.VertexAttribute.TEX0:
    case GX.VertexAttribute.TEX1:
    case GX.VertexAttribute.TEX2:
    case GX.VertexAttribute.TEX3:
    case GX.VertexAttribute.TEX4:
    case GX.VertexAttribute.TEX5:
    case GX.VertexAttribute.TEX6:
    case GX.VertexAttribute.TEX7:
        if (componentCount === GX.CompCnt.TEX_S)
            return 1;
        else if (componentCount === GX.CompCnt.TEX_ST)
            return 2;
    default:
        throw new Error(`Unknown vertex attribute ${vtxAttrib}`);
    }
}

interface VattrLayout {
    // Packed vertex size.
    dstVertexSize: number;
    dstAttrOffsets: number[];
    srcAttrSizes: number[]
    srcVertexSize: number;
}

function translateVattrLayout(vat: GX_VtxAttrFmt[], vtxDescs: GX_VtxDesc[]): VattrLayout {
    // First, set up our vertex layout.
    const dstAttrOffsets = [];
    const srcAttrSizes = [];

    let srcVertexSize = 0;
    let dstVertexSize = 0;
    let firstCompSize;
    for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vat.length; vtxAttrib++) {
        const vtxDesc = vtxDescs[vtxAttrib];
        if (!vtxDesc)
            continue;

        const compSize = getComponentSize(vat[vtxAttrib].compType);
        const compCnt = getNumComponents(vtxAttrib, vat[vtxAttrib].compCnt);
        const attrByteSize = compSize * compCnt;

        switch (vtxDesc.type) {
        case GX.AttrType.NONE:
            continue;
        case GX.AttrType.DIRECT:
            srcVertexSize += attrByteSize;
            break;
        case GX.AttrType.INDEX8:
            srcVertexSize += 1;
            break;
        case GX.AttrType.INDEX16:
            srcVertexSize += 2;
            break;
        }

        if (dstVertexSize === 0)
            firstCompSize = compSize;
        dstVertexSize = align(dstVertexSize, compSize);
        dstAttrOffsets[vtxAttrib] = dstVertexSize;
        srcAttrSizes[vtxAttrib] = attrByteSize;
        dstVertexSize += attrByteSize;
    }
    // Align the whole thing to the first component's size.
    dstVertexSize = align(dstVertexSize, firstCompSize);
    return { dstVertexSize, dstAttrOffsets, srcAttrSizes, srcVertexSize };
}

export interface LoadedVertexData {
    indexData: Uint16Array;
    packedVertexData: Uint8Array;
    totalTriangleCount: number;
    totalVertexCount: number;
}

type VtxLoaderFunc = (vtxArrays: GX_Array[], srcBuffer: ArrayBuffer, srcOffs: number) => LoadedVertexData;

export interface VtxLoader {
    vattrLayout: VattrLayout;
    runVertices: VtxLoaderFunc;
}

function _compileVtxLoader(vat: GX_VtxAttrFmt[], vtxDescs: GX_VtxDesc[]): VtxLoader {
    const vattrLayout: VattrLayout = translateVattrLayout(vat, vtxDescs);

    function getAttrName(vtxAttrib: GX.VertexAttribute): string {
        switch (vtxAttrib) {
        case GX.VertexAttribute.POS:  return `POS`;
        case GX.VertexAttribute.NRM:  return `NRM`;
        case GX.VertexAttribute.CLR0: return `CLR0`;
        case GX.VertexAttribute.CLR1: return `CLR1`;
        case GX.VertexAttribute.TEX0: return `TEX0`;
        case GX.VertexAttribute.TEX1: return `TEX1`;
        case GX.VertexAttribute.TEX2: return `TEX2`;
        case GX.VertexAttribute.TEX3: return `TEX3`;
        case GX.VertexAttribute.TEX4: return `TEX4`;
        case GX.VertexAttribute.TEX5: return `TEX5`;
        case GX.VertexAttribute.TEX6: return `TEX6`;
        case GX.VertexAttribute.TEX7: return `TEX7`;
        default: throw "whoops";
        }
    }

    function compileVattr(vtxAttrib: GX.VertexAttribute): string {
        if (!vtxDescs[vtxAttrib])
            return '';

        const srcAttrSize = vattrLayout.srcAttrSizes[vtxAttrib];
        let readVertex;
        switch (vtxDescs[vtxAttrib].type) {
        case GX.AttrType.NONE:
            return '';
        case GX.AttrType.INDEX8:
            readVertex = `
        index = view.getUint8(drawCallIdx);
        drawCallIdx += 1;`.trim();
            break;
        case GX.AttrType.INDEX16:
            readVertex = `
        index = view.getUint16(drawCallIdx);
        drawCallIdx += 2;`.trim();
            break;
        case GX.AttrType.DIRECT:
        default:
            throw "whoops";
        }

        switch (vtxDescs[vtxAttrib].type) {
        case GX.AttrType.INDEX8:
        case GX.AttrType.INDEX16:
            // TODO(jstpierre): Stride.
            readVertex = `${readVertex}
        attrOffs = vertexArray.offs + (${srcAttrSize} * index);`;
            break;
        }

        return `// ${getAttrName(vtxAttrib)}
        vertexArray = vtxArrays[${vtxAttrib}];
        ${readVertex}
        dstVertexData.set(new Uint8Array(vertexArray.buffer, attrOffs, ${srcAttrSize}), dstVertexDataOffs + ${vattrLayout.dstAttrOffsets[vtxAttrib]});`;
    }

    function compileVattrs(): string {
        const sources = [];
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vat.length; vtxAttrib++) {
            sources.push(compileVattr(vtxAttrib));
        }
        return sources.join('');
    }

    const source = `
"use strict";

// Parse display list.
const view = new DataView(srcBuffer, srcOffs);
const drawCalls = [];
let totalVertexCount = 0;
let totalTriangleCount = 0;
let drawCallIdx = 0;
while (true) {
    const cmd = view.getUint8(drawCallIdx);
    if (cmd === 0)
        break;

    const primType = cmd & 0xF8;
    const vertexFormat = cmd & 0x07;

    const vertexCount = view.getUint16(drawCallIdx + 0x01);
    drawCallIdx += 0x03;
    const srcOffs = drawCallIdx;
    const first = totalVertexCount;
    totalVertexCount += vertexCount;

    switch (primType) {
    case ${GX.PrimitiveType.TRIANGLEFAN}:
    case ${GX.PrimitiveType.TRIANGLESTRIP}:
        totalTriangleCount += (vertexCount - 2);
        break;
    default:
        throw "whoops";
    }

    drawCalls.push({ primType, vertexFormat, srcOffs, vertexCount });

    // Skip over the index data.
    drawCallIdx += ${vattrLayout.srcVertexSize} * vertexCount;
}

// Now make the data.
let indexDataIdx = 0;
const dstIndexData = new Uint16Array(totalTriangleCount * 3);
let vertexId = 0;

const dstVertexDataSize = ${vattrLayout.dstVertexSize} * totalVertexCount;
const dstVertexData = new Uint8Array(dstVertexDataSize);
let dstVertexDataOffs = 0;
for (let z = 0; z < drawCalls.length; z++) {
    const drawCall = drawCalls[z];

    // Convert topology to triangles.
    const firstVertex = vertexId;

    // First triangle is the same for all topo.
    for (let i = 0; i < 3; i++)
        dstIndexData[indexDataIdx++] = vertexId++;

    switch (drawCall.primType) {
    case ${GX.PrimitiveType.TRIANGLESTRIP}:
        for (let i = 3; i < drawCall.vertexCount; i++) {
            dstIndexData[indexDataIdx++] = vertexId - ((i & 1) ? 1 : 2);
            dstIndexData[indexDataIdx++] = vertexId - ((i & 1) ? 2 : 1);
            dstIndexData[indexDataIdx++] = vertexId++;
        }
        break;
    case ${GX.PrimitiveType.TRIANGLEFAN}:
        for (let i = 3; i < drawCall.vertexCount; i++) {
            dstIndexData[indexDataIdx++] = firstVertex;
            dstIndexData[indexDataIdx++] = vertexId - 1;
            dstIndexData[indexDataIdx++] = vertexId++;
        }
        break;
    }

    let drawCallIdx = drawCall.srcOffs;
    // Scratch.
    let index, attrOffs, vertexArray;
    for (let j = 0; j < drawCall.vertexCount; j++) {
${compileVattrs()}
        dstVertexDataOffs += ${vattrLayout.dstVertexSize};
    }
}
return { indexData: dstIndexData, packedVertexData: dstVertexData, totalVertexCount: totalVertexCount, totalTriangleCount: totalTriangleCount };
`;
    const runVertices: VtxLoaderFunc = (<VtxLoaderFunc> new Function('vtxArrays', 'srcBuffer', 'srcOffs', source));
    return { vattrLayout, runVertices };
}

export function coalesceLoadedDatas(loadedDatas: LoadedVertexData[]): LoadedVertexData {
    let totalTriangleCount = 0;
    let totalVertexCount = 0;
    let indexDataSize = 0;
    let packedVertexDataSize = 0;

    for (const loadedData of loadedDatas) {
        totalTriangleCount += loadedData.totalTriangleCount;
        totalVertexCount += loadedData.totalVertexCount;
        indexDataSize += loadedData.indexData.byteLength;
        packedVertexDataSize += loadedData.packedVertexData.byteLength;
    }

    const indexData = new Uint16Array(indexDataSize);
    const packedVertexData = new Uint8Array(packedVertexDataSize);

    let indexDataOffs = 0;
    let packedVertexDataOffs = 0;
    for (const loadedData of loadedDatas) {
        indexData.set(loadedData.indexData, indexDataOffs);
        packedVertexData.set(loadedData.packedVertexData, packedVertexDataOffs);
        indexDataOffs += loadedData.indexData.byteLength;
        packedVertexDataOffs += loadedData.packedVertexData.byteLength;
    }

    return { indexData, packedVertexData, totalTriangleCount, totalVertexCount };
}

class VtxLoaderCache {
    private cache = new Map<string, VtxLoader>();

    private makeKey(vat: GX_VtxAttrFmt[], vtxDescs: GX_VtxDesc[]): string {
        return JSON.stringify({ vat, vtxDescs });
    }

    public compileVtxLoader(vat: GX_VtxAttrFmt[], vtxDescs: GX_VtxDesc[]) {
        const key = this.makeKey(vat, vtxDescs);
        if (!this.cache.has(key))
            this.cache.set(key, _compileVtxLoader(vat, vtxDescs));
        return this.cache.get(key);
    }
}

const cache = new VtxLoaderCache();
export const compileVtxLoader = cache.compileVtxLoader.bind(cache);
