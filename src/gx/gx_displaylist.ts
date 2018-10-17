
// GX Display List parsing.

// The Display List is natively interpreted by the GX GPU. It consists of two kinds of
// commands: primitive draws (GX.Command.DRAW_*) and register loads (GX.Command.LOAD_*).
// Most serialized model formats have some form of serialized Display List with
// primitive draw commands. We call a Display List composed entirely of such draw commands
// a "Shape Display List".

// Primitive commands specify a kind of primitive (quad, triangle, tristrip, etc.), a
// vertex format, a primitive count, and then a number of vertices. Unlike modern APIs which
// contain one global index into pointing to all of the attribute data for that vertex, the
// GX can support the attribute data either being in-line in the command, or specify an
// index per-attribute into a larger set of arrays. That is, you can have a vertex with
// POS's indexes being 0 1 2 3 and NRM's indexes being 0 0 0 0.

// We support this by compiling the data down into a vertex buffer. This is what the
// "vertex loader" does, and it's inspired by the Vertex Loader JIT in Dolphin. Instead of
// JITting x64 code, though, we compile a JavaScript file for VAT/VCD pair.

// The "VAT" (Vertex Attribute Table) contains the details on the vertex format, e.g. data
// types and component counts of the POS, NRM, TEX0, etc. There are eight vertex formats,
// though most games use only one. We make the user specify a VAT with an array of
// GX_VtxAttrFmt structures. By default, compileVtxLoader only takes VTXFMT0. You can use
// compileVtxLoaderFormats to specify a VAT with more than just VTXFMT0.

// The "VCD" (Vertex Control Descriptor) contains the details on whether an attribute exists
// inline in the vertex data ("direct"), or is an index into an array. We emulate this by
// making the user pass in an array of GX_VtxDesc structures when they construct their
// vertex loader.

// On actual hardware, the VAT/VCD exist in the CP registers, however most data formats
// don't have the display list that sets these registers serialized and instead just use
// standard formats.

import ArrayBufferSlice from '../ArrayBufferSlice';
import MemoizeCache from '../MemoizeCache';
import { align, assert } from '../util';

import * as GX from './gx_enum';
import { Endianness, getSystemEndianness } from '../endian';
import { GfxFormat, FormatCompFlags, FormatTypeFlags, getFormatCompByteSize, getFormatTypeFlagsByteSize, makeFormat, FormatFlags, getFormatCompFlagsComponentCount, getFormatTypeFlags, getFormatCompFlags, getFormatComponentCount } from '../gfx/platform/GfxPlatformFormat';

// GX_SetVtxAttrFmt
export interface GX_VtxAttrFmt {
    compType: GX.CompType;
    compCnt: GX.CompCnt;
    compShift: number;
}

// GX_SetVtxDesc
export interface GX_VtxDesc {
    type: GX.AttrType;
    enableOutput?: boolean;
}

// GX_SetArray
export interface GX_Array {
    buffer: ArrayBufferSlice;
    offs: number;
    // TODO(jstpierre): stride
}

type CompSize = 1 | 2 | 4;

export function getComponentSizeRaw(compType: GX.CompType): CompSize {
    switch (compType) {
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

// PNMTXIDX, TEXnMTXIDX are special cases in GX.
function isVtxAttribMtxIdx(vtxAttrib: GX.VertexAttribute): boolean {
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
        return true;
    default:
        return false;
    }
}

function getComponentSize(vtxAttrib: GX.VertexAttribute, vatFormat: GX_VtxAttrFmt): CompSize {
    // MTXIDX fields don't have VAT entries.
    if (isVtxAttribMtxIdx(vtxAttrib))
        return 1;

    return getComponentSizeRaw(vatFormat.compType);
}

export function getAttributeFormatCompFlagsRaw(vtxAttrib: GX.VertexAttribute, compCnt: GX.CompCnt): number {
    switch (vtxAttrib) {
    case GX.VertexAttribute.POS:
        if (compCnt === GX.CompCnt.POS_XY)
            return FormatCompFlags.COMP_RG;
        else if (compCnt === GX.CompCnt.POS_XYZ)
            return FormatCompFlags.COMP_RGB;
    case GX.VertexAttribute.NRM:
        if (compCnt === GX.CompCnt.NRM_XYZ)
            return FormatCompFlags.COMP_RGB;
        // NBT*XYZ
        // XXX(jstpierre): This is impossible in modern graphics APIs. We need to split this into three attributes...
        // Thankfully, nobody seems to be using NRM_NBT.
        else if (compCnt === GX.CompCnt.NRM_NBT)
            return 9;
        // Separated NBT has three components per index.
        else if (compCnt === GX.CompCnt.NRM_NBT3)
            return FormatCompFlags.COMP_RGB;
    case GX.VertexAttribute.CLR0:
    case GX.VertexAttribute.CLR1:
        if (compCnt === GX.CompCnt.CLR_RGB)
            return FormatCompFlags.COMP_RGB;
        else if (compCnt === GX.CompCnt.CLR_RGBA)
            return FormatCompFlags.COMP_RGBA;
    case GX.VertexAttribute.TEX0:
    case GX.VertexAttribute.TEX1:
    case GX.VertexAttribute.TEX2:
    case GX.VertexAttribute.TEX3:
    case GX.VertexAttribute.TEX4:
    case GX.VertexAttribute.TEX5:
    case GX.VertexAttribute.TEX6:
    case GX.VertexAttribute.TEX7:
        if (compCnt === GX.CompCnt.TEX_S)
            return FormatCompFlags.COMP_R;
        else if (compCnt === GX.CompCnt.TEX_ST)
            return FormatCompFlags.COMP_RG;
    case GX.VertexAttribute.NULL:
    default:
        // Shouldn't ever happen
        throw new Error("whoops");
    }
}

export function getAttributeFormatCompFlags(vtxAttrib: GX.VertexAttribute, vatFormat: GX_VtxAttrFmt): FormatCompFlags {
    // MTXIDX fields don't have VAT entries.
    if (isVtxAttribMtxIdx(vtxAttrib))
        return FormatCompFlags.COMP_R;

    return getAttributeFormatCompFlagsRaw(vtxAttrib, vatFormat.compCnt);
}

export function getAttributeComponentCount(vtxAttrib: GX.VertexAttribute, vatFormat: GX_VtxAttrFmt): number {
    return getFormatCompFlagsComponentCount(getAttributeFormatCompFlags(vtxAttrib, vatFormat));
}

function getComponentShiftRaw(compType: GX.CompType, compShift: number): number {
    switch (compType) {
    case GX.CompType.F32:
    case GX.CompType.RGBA8:
        return 0;
    case GX.CompType.U8:
    case GX.CompType.U16:
    case GX.CompType.S8:
    case GX.CompType.S16:
        return compShift;
    }
}

function getComponentShift(vtxAttrib: GX.VertexAttribute, vatFormat: GX_VtxAttrFmt): number {
    // MTXIDX fields don't have VAT entries.
    if (isVtxAttribMtxIdx(vtxAttrib))
        return 0;

    return getComponentShiftRaw(vatFormat.compType, vatFormat.compShift);
}

function getComponentType(vtxAttrib: GX.VertexAttribute, vatFormat: GX_VtxAttrFmt): GX.CompType {
    if (isVtxAttribMtxIdx(vtxAttrib))
        return GX.CompType.U8;

    return vatFormat.compType;
}

function getIndexNumComponents(vtxAttrib: GX.VertexAttribute, vatFormat: GX_VtxAttrFmt): number {
    switch (vtxAttrib) {
    case GX.VertexAttribute.NRM:
        if (vatFormat.compCnt === GX.CompCnt.NRM_NBT3)
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
    default:
        throw new Error("whoops");
    }
}

function getAttributeFormatTypeFlags(vtxAttrib: GX.VertexAttribute): FormatTypeFlags {
    if (isVtxAttribMtxIdx(vtxAttrib))
        return FormatTypeFlags.U8;

    return FormatTypeFlags.F32;
}

export interface VertexAttributeLayout {
    vtxAttrib: GX.VertexAttribute;
    offset: number;
    format: GfxFormat;
}

// Describes the source vertex data for a specific VAT format & VCD.
interface VatLayout {
    srcVertexSize: number;
    vatFormat: GX_VtxAttrFmt[];
    vcd: GX_VtxDesc[];
}

// Describes the loaded vertex layout.
export interface LoadedVertexLayout {
    // Packed vertex size.
    dstVertexSize: number;
    dstVertexAttributeLayouts: VertexAttributeLayout[];
}

interface VertexLayout extends LoadedVertexLayout {
    // Source layout.
    vatLayouts: VatLayout[];
}

function translateVatLayout(vatFormat: GX_VtxAttrFmt[], vcd: GX_VtxDesc[]): VatLayout {
    if (vatFormat === undefined)
        return undefined;

    let srcVertexSize = 0;

    for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vcd.length; vtxAttrib++) {
        // Describes packed vertex layout.
        const vtxAttrDesc = vcd[vtxAttrib];
        // Describes format of pointed-to data.
        const vtxAttrFmt = vatFormat[vtxAttrib];

        if (!vtxAttrDesc || vtxAttrDesc.type === GX.AttrType.NONE)
            continue;

        // TODO(jstpierre): Find a better way to do NBT3.
        const srcIndexComponentCount = getIndexNumComponents(vtxAttrib, vtxAttrFmt);

        // MTXIDX entries can only be DIRECT if they exist.
        if (isVtxAttribMtxIdx(vtxAttrib))
            assert(vtxAttrDesc.type === GX.AttrType.DIRECT);

        switch (vtxAttrDesc.type) {
        case GX.AttrType.DIRECT: {
            const srcAttrCompSize = getComponentSize(vtxAttrib, vtxAttrFmt);
            const srcAttrCompCount = getAttributeComponentCount(vtxAttrib, vtxAttrFmt);
            const srcAttrByteSize = srcAttrCompSize * srcAttrCompCount;
            srcVertexSize += srcAttrByteSize;
            break;
        }
        case GX.AttrType.INDEX8:
            srcVertexSize += 1 * srcIndexComponentCount;
            break;
        case GX.AttrType.INDEX16:
            srcVertexSize += 2 * srcIndexComponentCount;
            break;
        }
    }

    return { srcVertexSize, vatFormat, vcd };
}

function translateVertexLayout(vat: GX_VtxAttrFmt[][], vcd: GX_VtxDesc[]): VertexLayout {
    // Create source VAT layouts.
    const vatLayouts = vat.map((vatFormat) => translateVatLayout(vatFormat, vcd));

    // Create destination vertex layout.
    let dstVertexSize = 0;
    const dstVertexAttributeLayouts: VertexAttributeLayout[] = [];
    for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vcd.length; vtxAttrib++) {
        const vtxAttrDesc = vcd[vtxAttrib];
        if (!vtxAttrDesc || vtxAttrDesc.type === GX.AttrType.NONE)
            continue;

        const enableOutput = (vtxAttrDesc.enableOutput === undefined || vtxAttrDesc.enableOutput);
        if (!enableOutput)
            continue;

        const formatTypeFlags = getAttributeFormatTypeFlags(vtxAttrib);
        const formatComponentSize = getFormatTypeFlagsByteSize(formatTypeFlags);

        dstVertexSize = align(dstVertexSize, formatComponentSize);
        const offset = dstVertexSize;

        // Find our maximum component count by choosing from a maximum of all the VAT formats.
        let formatCompFlags = 0;
        vatLayouts.forEach((vatLayout) => {
            formatCompFlags = Math.max(formatCompFlags, getAttributeFormatCompFlags(vtxAttrib, vatLayout.vatFormat[vtxAttrib]));
        });

        dstVertexSize += formatComponentSize * getFormatCompFlagsComponentCount(formatCompFlags);

        const format = makeFormat(formatTypeFlags, formatCompFlags, FormatFlags.NONE);
        dstVertexAttributeLayouts.push({ vtxAttrib, offset, format });
    }

    // Align the whole thing to our minimum required alignment (F32).
    dstVertexSize = align(dstVertexSize, 4);
    return { dstVertexSize, dstVertexAttributeLayouts, vatLayouts };
}

export interface LoadedVertexData {
    indexFormat: GfxFormat;
    indexData: ArrayBuffer;
    packedVertexData: ArrayBuffer;
    totalTriangleCount: number;
    totalVertexCount: number;
    vertexId: number;
}

export interface LoadOptions {
    firstVertexId?: number;
}

type VtxLoaderFunc = (vtxArrays: GX_Array[], srcBuffer: ArrayBufferSlice, loadOptions?: LoadOptions) => LoadedVertexData;

export interface VtxLoader {
    loadedVertexLayout: LoadedVertexLayout;
    runVertices: VtxLoaderFunc;
}

function _compileVtxLoader(vat: GX_VtxAttrFmt[][], vcd: GX_VtxDesc[]): VtxLoader {
    const loadedVertexLayout: VertexLayout = translateVertexLayout(vat, vcd);

    function makeLoaderName(): string {
        let name = 'VtxLoader';
        // TODO(jstpierre): Re-enable this at some point. Right now it's not so easy...
        /*
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vat.length; vtxAttrib++) {
            if (!vtxDescs[vtxAttrib] || vtxDescs[vtxAttrib].type === GX.AttrType.NONE)
                continue;

            const attrName = getAttrName(vtxAttrib);

            const compSizeSuffix = vat[vtxAttrib] ? getComponentSize(vat[vtxAttrib].compType) : '';
            const compCntSuffix = vat[vtxAttrib] ? getComponentCount(vtxAttrib, vat[vtxAttrib].compCnt) : '';

            const attrTypeSuffixes = ['', 'D', 'I8', 'I16'];
            const attrTypeSuffix = attrTypeSuffixes[vtxDescs[vtxAttrib].type];
            name += `_${attrName}$${attrTypeSuffix}$${compSizeSuffix}x${compCntSuffix}`;
        }
        */
        return name;
    }

    function compileVtxArrayViewName(vtxAttrib: GX.VertexAttribute): string {
        return `srcAttrArrayView${vtxAttrib}`;
    }

    function compileVtxArrayViews(): string {
        const sources = [];
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < GX.VertexAttribute.MAX; vtxAttrib++) {
            const dstAttribLayout = loadedVertexLayout.dstVertexAttributeLayouts.find((layout) => layout.vtxAttrib === vtxAttrib);

            const outputEnabled = !!dstAttribLayout;
            if (!outputEnabled)
                continue;

            const attrType = vcd[vtxAttrib].type;
            if (attrType === GX.AttrType.INDEX16 || attrType === GX.AttrType.INDEX8) {
                const viewName = compileVtxArrayViewName(vtxAttrib);
                sources.push(`const ${viewName} = vtxArrays[${vtxAttrib}].buffer.createDataView(vtxArrays[${vtxAttrib}].offs);`);
            }
        }
        return sources.join('\n');
    }

    // Loads a single vertex layout.
    function compileVatLayoutAttribute(vatLayout: VatLayout, vtxAttrib: GX.VertexAttribute): string {
        const vtxAttrFmt = vatLayout.vatFormat[vtxAttrib];
        const vtxAttrDesc = vatLayout.vcd[vtxAttrib];
        const dstAttribLayout = loadedVertexLayout.dstVertexAttributeLayouts.find((layout) => layout.vtxAttrib === vtxAttrib);

        if (!vtxAttrDesc || vtxAttrDesc.type === GX.AttrType.NONE)
            return '';

        // If we don't have a destination for the data, then don't bother outputting.
        const outputEnabled = !!dstAttribLayout;

        let srcAttrCompSize: number;
        let srcAttrCompCount: number;
        let srcAttrByteSize: number;

        // We only need vtxAttrFmt if we're going to read the data.
        if (vtxAttrDesc.type === GX.AttrType.DIRECT || outputEnabled) {
            srcAttrCompSize = getComponentSize(vtxAttrib, vtxAttrFmt);
            srcAttrCompCount = getAttributeComponentCount(vtxAttrib, vtxAttrFmt);
            srcAttrByteSize = srcAttrCompSize * srcAttrCompCount;
        }

        function compileShift(n: string): string {
            // Instead of just doing `${n} >> srcAttrCompShift`, we use division
            // to get us the fractional components...
            const srcAttrCompShift = getComponentShift(vtxAttrib, vtxAttrFmt);
            const divisor = 1 << srcAttrCompShift;
            if (divisor === 1)
                return n;
            else
                return `(${n} / ${divisor})`;
        }

        function compileReadOneComponent(viewName: string, attrOffset: string): string {
            switch (getComponentType(vtxAttrib, vtxAttrFmt)) {
            case GX.CompType.F32:
                return `${viewName}.getFloat32(${attrOffset})`;
            case GX.CompType.RGBA8:
                // This gets four components.
                return `(${viewName}.getUint8(${attrOffset}) / 0xFF)`;
            case GX.CompType.U8:
                return compileShift(`${viewName}.getUint8(${attrOffset})`);
            case GX.CompType.U16:
                return compileShift(`${viewName}.getUint16(${attrOffset})`);
            case GX.CompType.S8:
                return compileShift(`${viewName}.getInt8(${attrOffset})`);
            case GX.CompType.S16:
                return compileShift(`${viewName}.getInt16(${attrOffset})`);
            default:
                throw "whoops";
            }
        }

        function compileWriteOneComponentF32(dstOffs: string, value: string): string {
            const littleEndian = (getSystemEndianness() === Endianness.LITTLE_ENDIAN);
            return `dstVertexDataView.setFloat32(${dstOffs}, ${value}, ${littleEndian})`;
        }

        function compileWriteOneComponentU8(dstOffs: string, value: string): string {
            return `dstVertexDataView.setUint8(${dstOffs}, ${value})`;
        }

        function compileWriteOneComponent(offs: number, value: string): string {
            const dstOffs = `dstVertexDataOffs + ${offs}`;

            const typeFlags = getFormatTypeFlags(dstAttribLayout.format);
            if (typeFlags === FormatTypeFlags.F32)
                return compileWriteOneComponentF32(dstOffs, value);
            else if (typeFlags === FormatTypeFlags.U8)
                return compileWriteOneComponentU8(dstOffs, value);
            else
                throw "whoops";
        }

        function compileOneAttrib(viewName: string, attrOffsetBase: string, drawCallIdxIncr: number): string {
            let S = ``;

            if (outputEnabled) {
                const dstComponentSize = getFormatCompByteSize(dstAttribLayout.format);
                const componentCount = getFormatComponentCount(dstAttribLayout.format);
                for (let i = 0; i < componentCount; i++) {
                    const dstOffs: number = dstAttribLayout.offset + (i * dstComponentSize);
                    const srcOffs: string = `${attrOffsetBase} + ${i * srcAttrCompSize}`;

                    // Fill in components not in the source with zero.
                    let value: string;
                    if (i < srcAttrCompCount)
                        value = compileReadOneComponent(viewName, srcOffs);
                    else
                        value = `0`;

                    S += `
        ${compileWriteOneComponent(dstOffs, value)};`;
                }
            }

            S += `
        drawCallIdx += ${drawCallIdxIncr};
`;

            return S;
        }

        function compileOneIndex(viewName: string, readIndex: string, drawCallIdxIncr: number, uniqueSuffix: string = ''): string {
            const attrOffsetBase = `(${readIndex}) * ${srcAttrByteSize}`;
            const arrayOffsetVarName = `arrayOffset${vtxAttrib}${uniqueSuffix}`;
            let S = '';
            if (outputEnabled) {
                return `const ${arrayOffsetVarName} = ${attrOffsetBase};${compileOneAttrib(viewName, arrayOffsetVarName, drawCallIdxIncr)}`;
            } else {
                return compileOneAttrib('', '', drawCallIdxIncr);
            }
        }

        function compileAttribIndex(viewName: string, readIndex: string, drawCallIdxIncr: number): string {
            if (vtxAttrib === GX.VertexAttribute.NRM && vtxAttrFmt.compCnt === GX.CompCnt.NRM_NBT3) {
                // Special case: NBT3.
                return `
        // NBT Normal
        ${compileOneIndex(viewName, `${readIndex} + 0`, drawCallIdxIncr, `_N`)}
        // NBT Bitangent
        ${compileOneIndex(viewName, `${readIndex} + 3`, drawCallIdxIncr, `_B`)}
        // NBT Tangent
        ${compileOneIndex(viewName, `${readIndex} + 6`, drawCallIdxIncr, `_T`)}`;
            } else {
                return `
        // ${getAttrName(vtxAttrib)}
        ${compileOneIndex(viewName, readIndex, drawCallIdxIncr)}`;
            }
        }

        switch (vtxAttrDesc.type) {
        case GX.AttrType.DIRECT:
            return compileOneAttrib(`dlView`, `drawCallIdx`, srcAttrByteSize);
        case GX.AttrType.INDEX8:
            return compileAttribIndex(compileVtxArrayViewName(vtxAttrib), `dlView.getUint8(drawCallIdx)`, 1);
        case GX.AttrType.INDEX16:
            return compileAttribIndex(compileVtxArrayViewName(vtxAttrib), `dlView.getUint16(drawCallIdx)`, 2);
        default:
            throw "whoops";
        }
    }

    function compileVatFormats(): string {
        const sources = [];

        const vatLayoutSources = new Map<GX.VtxFmt, string>();
        for (let i = 0; i < GX.VtxFmt.VTXFMT7; i++) {
            const vatLayout = loadedVertexLayout.vatLayouts[i];
            if (!vatLayout)
                continue;

            assert(vatLayout.vcd === vcd);

            let S = '';
            for (let vtxAttrib = 0; vtxAttrib < GX.VertexAttribute.MAX; vtxAttrib++) {
                S += compileVatLayoutAttribute(vatLayout, vtxAttrib);
            }
            vatLayoutSources.set(i, S);
        }

        if (vatLayoutSources.size === 0)
            throw "whoops";

        if (vatLayoutSources.size === 1)
            return vatLayoutSources.values().next().value;

        // Dynamic dispatch.
        let S = `
        `;

        for (const [vtxFmt, vatLayoutSource] of vatLayoutSources.entries()) {
            S += `if (drawCall.vertexFormat === ${vtxFmt}) {

            ${vatLayoutSource}

        } else `;
        }

        S += `{
            throw new Error("Invalid vertex format " + vertexFormat);
        }`;

        return S;
    }

    function compileSrcVertexSizes(): string {
        return JSON.stringify(loadedVertexLayout.vatLayouts.map((vatLayout) => vatLayout && vatLayout.srcVertexSize));
    }

    const loaderName = makeLoaderName();

    const source = `
"use strict";

return function ${loaderName}(vtxArrays, srcBuffer, loadOptions) {
const firstVertexId = (loadOptions !== undefined && loadOptions.firstVertexId !== undefined) ? loadOptions.firstVertexId : 0;

// Parse display list.
const dlView = srcBuffer.createDataView();
const drawCalls = [];
const srcVertexSizes = ${compileSrcVertexSizes()};
let totalVertexCount = 0;
let totalTriangleCount = 0;
let drawCallIdx = 0;
while (true) {
    if (drawCallIdx >= srcBuffer.byteLength)
        break;
    const cmd = dlView.getUint8(drawCallIdx);
    if (cmd === 0)
        break;

    const primType = cmd & 0xF8;
    const vertexFormat = cmd & 0x07;

    const vertexCount = dlView.getUint16(drawCallIdx + 0x01);
    drawCallIdx += 0x03;
    const srcOffs = drawCallIdx;
    const first = totalVertexCount;
    totalVertexCount += vertexCount;

    switch (primType) {
    case ${GX.Command.DRAW_TRIANGLES}:
        totalTriangleCount += (vertexCount / 3);
        break;
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

    if (srcVertexSizes[vertexFormat] === undefined)
        throw new Error("No VAT for VTXFMT" + vertexFormat);

    // Skip over the index data.
    drawCallIdx += srcVertexSizes[vertexFormat] * vertexCount;
}

// Now make the data.
let indexDataIdx = 0;
const dstIndexData = new Uint16Array(totalTriangleCount * 3);
let vertexId = firstVertexId;

const dstVertexDataSize = ${loadedVertexLayout.dstVertexSize} * totalVertexCount;
const dstVertexData = new ArrayBuffer(dstVertexDataSize);
const dstVertexDataView = new DataView(dstVertexData);
let dstVertexDataOffs = 0;

${compileVtxArrayViews()}

for (let z = 0; z < drawCalls.length; z++) {
    const drawCall = drawCalls[z];

    // Convert topology to triangles.
    switch (drawCall.primType) {
    case ${GX.Command.DRAW_TRIANGLES}:
        // Copy vertices.
        for (let i = 0; i < drawCall.vertexCount; i++) {
            dstIndexData[indexDataIdx++] = vertexId++;
        }
        break;
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
${compileVatFormats()}
        dstVertexDataOffs += ${loadedVertexLayout.dstVertexSize};
    }
}

if (dstIndexData.length !== totalTriangleCount * 3)
    throw new Error("Number of indexes does not match triangle count");

return { indexFormat: ${GfxFormat.U16_R}, indexData: dstIndexData.buffer, packedVertexData: dstVertexData, totalVertexCount: totalVertexCount, totalTriangleCount: totalTriangleCount, vertexId: vertexId };

};
`;
    const runVerticesGenerator = new Function(source);
    const runVertices: VtxLoaderFunc = runVerticesGenerator();
    return { loadedVertexLayout, runVertices };
}

interface VtxLoaderDesc {
    vat: GX_VtxAttrFmt[][];
    vcd: GX_VtxDesc[];
}

class VtxLoaderCache extends MemoizeCache<VtxLoaderDesc, VtxLoader> {
    protected make(key: VtxLoaderDesc): VtxLoader {
        return _compileVtxLoader(key.vat, key.vcd);
    }

    protected makeKey(key: VtxLoaderDesc): string {
        return JSON.stringify(key);
    }

    public compileVtxLoader = (vatFormat: GX_VtxAttrFmt[], vcd: GX_VtxDesc[]): VtxLoader => {
        const vat = [vatFormat];
        return this.get({ vat, vcd });
    }

    public compileVtxLoaderMultiVat = (vat: GX_VtxAttrFmt[][], vcd: GX_VtxDesc[]): VtxLoader => {
        return this.get({ vat, vcd });
    }
}

const cache = new VtxLoaderCache();
export const compileVtxLoader = cache.compileVtxLoader;
export const compileVtxLoaderMultiVat = cache.compileVtxLoaderMultiVat;

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
        assert(loadedData.indexFormat === loadedDatas[0].indexFormat);
    }

    const indexData = new Uint8Array(indexDataSize);
    const packedVertexData = new Uint8Array(packedVertexDataSize);

    let indexDataOffs = 0;
    let packedVertexDataOffs = 0;
    for (const loadedData of loadedDatas) {
        indexData.set(new Uint8Array(loadedData.indexData), indexDataOffs);
        packedVertexData.set(new Uint8Array(loadedData.packedVertexData), packedVertexDataOffs);
        indexDataOffs += loadedData.indexData.byteLength;
        packedVertexDataOffs += loadedData.packedVertexData.byteLength;
    }

    return {
        indexData: indexData.buffer,
        indexFormat: loadedDatas[0].indexFormat,
        packedVertexData: packedVertexData.buffer,
        totalTriangleCount,
        totalVertexCount,
        vertexId: 0,
    };
}
