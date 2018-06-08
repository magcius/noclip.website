
// GX display list parsing.

// A Display List contains a number of primitive draw calls. However, instead of having
// one global index into an index buffer pointing to vertex data, the GX instead can allow
// specifying separate indices per attribute. So you can have POS's indexes be 0 1 2 3 and
// and NRM's indexes be 0 0 0 0. Additionally, each draw call can specify one of 8 different
// vertex attribute formats, though in most cases games tend to use one VAT.
//
// TODO(jtpierre): Actually support multiple VATs, which Metroid Prime uses.

import ArrayBufferSlice from 'ArrayBufferSlice';
import MemoizeCache from '../MemoizeCache';
import { align, assert } from '../util';

import * as GX from './gx_enum';
import { Endianness, getSystemEndianness } from '../endian';

// GX_SetVtxAttrFmt
export interface GX_VtxAttrFmt {
    compType: GX.CompType;
    compCnt: GX.CompCnt;
    enableOutput?: boolean;
}

// GX_SetVtxDesc
export interface GX_VtxDesc {
    type: GX.AttrType;
}

// GX_SetArray
export interface GX_Array {
    buffer: ArrayBufferSlice;
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
    case GX.VertexAttribute.PNMTXIDX:
    case GX.VertexAttribute.TEX0MTXIDX:
    case GX.VertexAttribute.TEX1MTXIDX:
    case GX.VertexAttribute.TEX2MTXIDX:
    case GX.VertexAttribute.TEX3MTXIDX:
    case GX.VertexAttribute.TEX4MTXIDX:
    case GX.VertexAttribute.TEX5MTXIDX:
    case GX.VertexAttribute.TEX6MTXIDX:
    case GX.VertexAttribute.TEX7MTXIDX:
        return 1;
    case GX.VertexAttribute.POS:
        if (componentCount === GX.CompCnt.POS_XY)
            return 2;
        else if (componentCount === GX.CompCnt.POS_XYZ)
            return 3;
    case GX.VertexAttribute.NRM:
    case GX.VertexAttribute.NBT:
        if (componentCount === GX.CompCnt.NRM_XYZ)
            return 3;
        // NBT*XYZ
        else if (componentCount === GX.CompCnt.NRM_NBT)
            return 9;
        // Separated NBT has three components per index.
        else if (componentCount === GX.CompCnt.NRM_NBT3)
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
    case GX.VertexAttribute.NULL:
        // Shouldn't ever happen
        throw new Error("whoops");
    }
}

function getIndexNumComponents(vtxAttrib: GX.VertexAttribute, compCnt: GX.CompCnt): number {
    // TODO(jstpierre): Figure out how GX_VA_NBT works.
    switch (vtxAttrib) {
    case GX.VertexAttribute.NRM:
        if (compCnt === GX.CompCnt.NRM_NBT3)
            return 3;
        // Fallthrough
    default:
        return 1;
    }
}

function getAttrName(vtxAttrib: GX.VertexAttribute): string {
    switch (vtxAttrib) {
    case GX.VertexAttribute.PNMTXIDX:   return `PNMTXIDX`;
    case GX.VertexAttribute.TEX0MTXIDX: return `TEX0MTXIDX`;
    case GX.VertexAttribute.TEX1MTXIDX: return `TEX1MTXIDX`;
    case GX.VertexAttribute.TEX2MTXIDX: return `TEX2MTXIDX`;
    case GX.VertexAttribute.TEX3MTXIDX: return `TEX3MTXIDX`;
    case GX.VertexAttribute.TEX4MTXIDX: return `TEX4MTXIDX`;
    case GX.VertexAttribute.TEX5MTXIDX: return `TEX5MTXIDX`;
    case GX.VertexAttribute.TEX6MTXIDX: return `TEX6MTXIDX`;
    case GX.VertexAttribute.TEX7MTXIDX: return `TEX7MTXIDX`;
    case GX.VertexAttribute.POS:        return `POS`;
    case GX.VertexAttribute.NRM:        return `NRM`;
    case GX.VertexAttribute.NBT:        return `NBT`;
    case GX.VertexAttribute.CLR0:       return `CLR0`;
    case GX.VertexAttribute.CLR1:       return `CLR1`;
    case GX.VertexAttribute.TEX0:       return `TEX0`;
    case GX.VertexAttribute.TEX1:       return `TEX1`;
    case GX.VertexAttribute.TEX2:       return `TEX2`;
    case GX.VertexAttribute.TEX3:       return `TEX3`;
    case GX.VertexAttribute.TEX4:       return `TEX4`;
    case GX.VertexAttribute.TEX5:       return `TEX5`;
    case GX.VertexAttribute.TEX6:       return `TEX6`;
    case GX.VertexAttribute.TEX7:       return `TEX7`;
    case GX.VertexAttribute.NULL: throw new Error("whoops");
    }
}

export interface VattrLayout {
    // Packed vertex size.
    dstVertexSize: number;
    dstAttrOffsets: number[];
    srcAttrSizes: number[];
    srcAttrCompSizes: number[];
    srcIndexCompCounts: number[];
    srcVertexSize: number;
}

function translateVattrLayout(vat: GX_VtxAttrFmt[], vtxDescs: GX_VtxDesc[]): VattrLayout {
    // First, set up our vertex layout.
    const dstAttrOffsets = [];
    const srcAttrSizes = [];
    const srcAttrCompSizes = [];
    const srcIndexCompCounts = [];

    let srcVertexSize = 0;
    let dstVertexSize = 0;
    let firstCompSize;
    for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vtxDescs.length; vtxAttrib++) {
        const vtxDesc = vtxDescs[vtxAttrib];
        if (!vtxDesc)
            continue;

        // If the VAT is missing, that means we don't care about the output of this vertex...
        // we still need to know about it though so we can skip over the index.
        // Obviously this doesn't work for DIRECT vertices.

        let compSize = undefined;
        let attrByteSize = undefined;

        // Default to 1. This doesn't work in the case of NBT3 without a VAT entry --
        // user has to manage that explicitly.
        let indexComponentCount = 1;
        let enableOutput = false;
        if (vat[vtxAttrib] !== undefined) {
            compSize = getComponentSize(vat[vtxAttrib].compType);
            const compCnt = getNumComponents(vtxAttrib, vat[vtxAttrib].compCnt);
            indexComponentCount = getIndexNumComponents(vtxAttrib, vat[vtxAttrib].compCnt);
            attrByteSize = compSize * compCnt * indexComponentCount;
            // VAT entries are assumed to be enabled by default.
            enableOutput = (vat[vtxAttrib].enableOutput === undefined) ? true : vat[vtxAttrib].enableOutput;
        }

        switch (vtxDesc.type) {
        case GX.AttrType.NONE:
            continue;
        case GX.AttrType.DIRECT:
            srcVertexSize += attrByteSize;
            break;
        case GX.AttrType.INDEX8:
            srcVertexSize += 1 * indexComponentCount;
            break;
        case GX.AttrType.INDEX16:
            srcVertexSize += 2 * indexComponentCount;
            break;
        }

        srcIndexCompCounts[vtxAttrib] = indexComponentCount;

        if (enableOutput) {
            dstVertexSize = align(dstVertexSize, compSize);
            dstAttrOffsets[vtxAttrib] = dstVertexSize;
            srcAttrSizes[vtxAttrib] = attrByteSize;
            srcAttrCompSizes[vtxAttrib] = compSize;
            dstVertexSize += attrByteSize;
        }
    }

    // Align the whole thing to our minimum required alignment (F32).
    dstVertexSize = align(dstVertexSize, 4);
    return { dstVertexSize, dstAttrOffsets, srcAttrSizes, srcAttrCompSizes, srcIndexCompCounts, srcVertexSize };
}

export interface LoadedVertexData {
    indexData: Uint16Array;
    packedVertexData: Uint8Array;
    totalTriangleCount: number;
    totalVertexCount: number;
}

type VtxLoaderFunc = (vtxArrays: GX_Array[], srcBuffer: ArrayBufferSlice) => LoadedVertexData;

export interface VtxLoader {
    vattrLayout: VattrLayout;
    runVertices: VtxLoaderFunc;
}

function _compileVtxLoader(vat: GX_VtxAttrFmt[], vtxDescs: GX_VtxDesc[]): VtxLoader {
    const vattrLayout: VattrLayout = translateVattrLayout(vat, vtxDescs);

    function makeLoaderName(): string {
        let name = 'VtxLoader';
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vat.length; vtxAttrib++) {
            if (!vtxDescs[vtxAttrib] || vtxDescs[vtxAttrib].type === GX.AttrType.NONE)
                continue;

            const attrName = getAttrName(vtxAttrib);

            const compSizeSuffix = vat[vtxAttrib] ? getComponentSize(vat[vtxAttrib].compType) : '';
            const compCntSuffix = vat[vtxAttrib] ? getNumComponents(vtxAttrib, vat[vtxAttrib].compCnt) : '';

            const attrTypeSuffixes = ['', 'D', 'I8', 'I16'];
            const attrTypeSuffix = attrTypeSuffixes[vtxDescs[vtxAttrib].type];
            name += `_${attrName}$${attrTypeSuffix}$${compSizeSuffix}x${compCntSuffix}`;
        }
        return name;
    }

    function compileVtxTypedArrays(): string {
        const sources = [];
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vat.length; vtxAttrib++) {
            if (vattrLayout.dstAttrOffsets[vtxAttrib] === undefined)
                continue;

            const attrType = vtxDescs[vtxAttrib].type;
            if (attrType === GX.AttrType.INDEX16 || attrType === GX.AttrType.INDEX8) {
                sources.push(`const vtxArrayData${vtxAttrib} = vtxArrays[${vtxAttrib}].buffer.createTypedArray(Uint8Array, vtxArrays[${vtxAttrib}].offs);`);
            }
        }
        return sources.join('\n');
    }

    function selectCopyFunc(compSize: number) {
        if (getSystemEndianness() === Endianness.BIG_ENDIAN || compSize === 1)
            return 'memcpy';
        else if (compSize === 2)
            return 'memcpySwap2';
        else if (compSize === 4)
            return 'memcpySwap4';
        else
            return '%whoops';
    }

    function compileVattr(vtxAttrib: GX.VertexAttribute): string {
        if (!vtxDescs[vtxAttrib])
            return '';

        const srcAttrSize = vattrLayout.srcAttrSizes[vtxAttrib];
        const srcAttrCompSize = vattrLayout.srcAttrCompSizes[vtxAttrib];
        const copyFunc = selectCopyFunc(srcAttrCompSize);

        function readOneIndexTemplate(attrOffset: string, drawCallIdxIncr: number): string {
            let S = '';
            if (vattrLayout.dstAttrOffsets[vtxAttrib] !== undefined) {
                const attrOffs = `(${srcAttrSize} * ${attrOffset})`;
                S += `${copyFunc}(dstVertexData, ${dstOffs}, vtxArrayData${vtxAttrib}, ${attrOffs}, ${srcAttrSize});`
            }
            S += `
        drawCallIdx += ${drawCallIdxIncr};`;
            return S.trim();
        }

        function readIndexTemplate(readIndex: string, drawCallIdxIncr: number): string {
            // Special case. NBT3 is annoying.
            if (vtxAttrib === GX.VertexAttribute.NRM && vattrLayout.srcIndexCompCounts[vtxAttrib] === 3) {
                return `
        // NBT Normal
        ${readOneIndexTemplate(`${readIndex} + 0`, drawCallIdxIncr)}
        // NBT Bitangent
        ${readOneIndexTemplate(`${readIndex} + 3`, drawCallIdxIncr)}
        // NBT Tangent
        ${readOneIndexTemplate(`${readIndex} + 6`, drawCallIdxIncr)}
`.trim();
            } else {
                return readOneIndexTemplate(readIndex, drawCallIdxIncr);
            }
        }

        const dstOffs = `dstVertexDataOffs + ${vattrLayout.dstAttrOffsets[vtxAttrib]}`;
        let readVertex = '';
        switch (vtxDescs[vtxAttrib].type) {
        case GX.AttrType.NONE:
            return '';
        case GX.AttrType.INDEX8:
            readVertex = readIndexTemplate(`view.getUint8(drawCallIdx)`, 1);
            break;
        case GX.AttrType.INDEX16:
            readVertex = readIndexTemplate(`view.getUint16(drawCallIdx)`, 2);
            break;
        case GX.AttrType.DIRECT:
            readVertex = `
        ${copyFunc}(dstVertexData, ${dstOffs}, srcBuffer, drawCallIdx, ${srcAttrSize});
        drawCallIdx += ${srcAttrSize};
        `.trim();
            break;
        default:
            throw new Error("whoops");
        }

        return `        // ${getAttrName(vtxAttrib)}
        ${readVertex}
`;
    }

    function compileVattrs(): string {
        const sources = [];
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vtxDescs.length; vtxAttrib++) {
            sources.push(compileVattr(vtxAttrib));
        }
        return sources.join('');
    }

    const loaderName = makeLoaderName();

    const source = `
"use strict";

return function ${loaderName}(vtxArrays, srcBuffer) {
// Parse display list.
const view = srcBuffer.createDataView();
const drawCalls = [];
let totalVertexCount = 0;
let totalTriangleCount = 0;
let drawCallIdx = 0;
while (true) {
    if (drawCallIdx >= srcBuffer.byteLength)
        break;
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
    case ${GX.Command.DRAW_TRIANGLE_FAN}:
    case ${GX.Command.DRAW_TRIANGLE_STRIP}:
        totalTriangleCount += (vertexCount - 2);
        break;
    case ${GX.Command.DRAW_QUADS}:
    case ${GX.Command.DRAW_QUADS_2}:
        totalTriangleCount += (vertexCount * 6) / 4;
        break;
    default:
        throw new Error("Invalid data at " + srcBuffer.byteOffset.toString(16) + "/" + drawCallIdx.toString(16) + " primType " + primType.toString(16));
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

function memcpy(dst, dstOffs, src, srcOffs, size) {
    while (size--)
        dst[dstOffs++] = src[srcOffs++];
}

function memcpySwap2(dst, dstOffs, src, srcOffs, size) {
    while (size > 0) {
        dst[dstOffs+0] = src[srcOffs+1];
        dst[dstOffs+1] = src[srcOffs+0];
        dstOffs += 2;
        srcOffs += 2;
        size -= 2;
    }
}

function memcpySwap4(dst, dstOffs, src, srcOffs, size) {
    while (size > 0) {
        dst[dstOffs+0] = src[srcOffs+3];
        dst[dstOffs+1] = src[srcOffs+2];
        dst[dstOffs+2] = src[srcOffs+1];
        dst[dstOffs+3] = src[srcOffs+0];
        dstOffs += 4;
        srcOffs += 4;
        size -= 4;
    }
}

${compileVtxTypedArrays()}

for (let z = 0; z < drawCalls.length; z++) {
    const drawCall = drawCalls[z];

    // Convert topology to triangles.
    switch (drawCall.primType) {
    case ${GX.Command.DRAW_TRIANGLE_STRIP}:
        // First vertex defines original triangle.
        for (let i = 0; i < 3; i++) {
            dstIndexData[indexDataIdx++] = vertexId++;
        }

        for (let i = 3; i < drawCall.vertexCount; i++) {
            dstIndexData[indexDataIdx++] = vertexId - ((i & 1) ? 1 : 2);
            dstIndexData[indexDataIdx++] = vertexId - ((i & 1) ? 2 : 1);
            dstIndexData[indexDataIdx++] = vertexId++;
        }
        break;
    case ${GX.Command.DRAW_TRIANGLE_FAN}:
        // First vertex defines original triangle.
        const firstVertex = vertexId;

        for (let i = 0; i < 3; i++) {
            dstIndexData[indexDataIdx++] = vertexId++;
        }

        for (let i = 3; i < drawCall.vertexCount; i++) {
            dstIndexData[indexDataIdx++] = firstVertex;
            dstIndexData[indexDataIdx++] = vertexId - 1;
            dstIndexData[indexDataIdx++] = vertexId++;
        }
        break;
    case ${GX.Command.DRAW_QUADS}:
    case ${GX.Command.DRAW_QUADS_2}:
        // Each quad (4 vertices) is split into 2 triangles (6 vertices)
        for (let i = 0; i < drawCall.vertexCount; i += 4) {
            dstIndexData[indexDataIdx++] = vertexId + 0;
            dstIndexData[indexDataIdx++] = vertexId + 1;
            dstIndexData[indexDataIdx++] = vertexId + 2;

            dstIndexData[indexDataIdx++] = vertexId + 1;
            dstIndexData[indexDataIdx++] = vertexId + 3;
            dstIndexData[indexDataIdx++] = vertexId + 2;
            vertexId += 4;
        }
    }

    let drawCallIdx = drawCall.srcOffs;
    for (let j = 0; j < drawCall.vertexCount; j++) {
${compileVattrs()}
        dstVertexDataOffs += ${vattrLayout.dstVertexSize};
    }
}
return { indexData: dstIndexData, packedVertexData: dstVertexData, totalVertexCount: totalVertexCount, totalTriangleCount: totalTriangleCount };

};
`;
    const runVerticesGenerator = new Function(source);
    const runVertices: VtxLoaderFunc = runVerticesGenerator();
    return { vattrLayout, runVertices };
}

interface VtxLoaderDesc {
    vat: GX_VtxAttrFmt[];
    vtxDescs: GX_VtxDesc[];
}

class VtxLoaderCache extends MemoizeCache<VtxLoaderDesc, VtxLoader> {
    protected make(key: VtxLoaderDesc): VtxLoader {
        return _compileVtxLoader(key.vat, key.vtxDescs);
    }

    protected makeKey(key: VtxLoaderDesc): string {
        return JSON.stringify(key);
    }

    public compileVtxLoader = (vat: GX_VtxAttrFmt[], vtxDescs: GX_VtxDesc[]): VtxLoader => {
        return this.get({ vat, vtxDescs });
    }
}

const cache = new VtxLoaderCache();
export const compileVtxLoader = cache.compileVtxLoader;
