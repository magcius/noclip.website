
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
import { align, assert } from '../util';

import * as GX from './gx_enum';
import { Endianness, getSystemEndianness } from '../endian';
import { GfxFormat, FormatCompFlags, FormatTypeFlags, getFormatCompByteSize, getFormatTypeFlagsByteSize, getFormatCompFlagsComponentCount, getFormatTypeFlags, getFormatComponentCount, getFormatFlags, FormatFlags, makeFormat } from '../gfx/platform/GfxPlatformFormat';
import { EqualFunc, HashMap, nullHashFunc } from '../HashMap';

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
    stride: number;
}

export interface VertexAttributeLayout {
    vtxAttrib: GX.Attr;
    bufferOffset: number;
    bufferIndex: number;
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
    indexFormat: GfxFormat;
    vertexBufferStrides: number[];
    vertexAttributeLayouts: VertexAttributeLayout[];
}

interface VertexLayout extends LoadedVertexLayout {
    // Source layout.
    vatLayouts: (VatLayout | undefined)[];
}

export interface LoadedVertexPacket {
    indexOffset: number;
    indexCount: number;
    posNrmMatrixTable: number[];
    texMatrixTable: number[];
}

export interface LoadedVertexData {
    indexData: ArrayBuffer;
    vertexBuffers: ArrayBuffer[];
    totalIndexCount: number;
    totalVertexCount: number;
    vertexId: number;
    packets: LoadedVertexPacket[];
}

export interface LoadOptions {
    firstVertexId?: number;
}

type VtxLoaderFunc = (vtxArrays: GX_Array[], srcBuffer: ArrayBufferSlice, loadOptions?: LoadOptions) => LoadedVertexData;

export interface VtxLoader {
    loadedVertexLayout: LoadedVertexLayout;
    runVertices: VtxLoaderFunc;
}

//#region Vertex Attribute Setup
type CompSize = 1 | 2 | 4;

export function getAttributeComponentByteSizeRaw(compType: GX.CompType): CompSize {
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
function isVtxAttribMtxIdx(vtxAttrib: GX.Attr): boolean {
    return vtxAttrib === GX.Attr.PNMTXIDX || isVtxAttribTexMtxIdx(vtxAttrib);
}

function isVtxAttribTexMtxIdx(vtxAttrib: GX.Attr): boolean {
    switch (vtxAttrib) {
    case GX.Attr.TEX0MTXIDX:
    case GX.Attr.TEX1MTXIDX:
    case GX.Attr.TEX2MTXIDX:
    case GX.Attr.TEX3MTXIDX:
    case GX.Attr.TEX4MTXIDX:
    case GX.Attr.TEX5MTXIDX:
    case GX.Attr.TEX6MTXIDX:
    case GX.Attr.TEX7MTXIDX:
        return true;
    default:
        return false;
    }
}

function isVtxAttribColor(vtxAttrib: GX.Attr): boolean {
    switch (vtxAttrib) {
    case GX.Attr.CLR0:
    case GX.Attr.CLR1:
        return true;
    default:
        return false;
    }
}

function getAttributeComponentByteSize(vtxAttrib: GX.Attr, vatFormat: GX_VtxAttrFmt): CompSize {
    // MTXIDX fields don't have VAT entries.
    if (isVtxAttribMtxIdx(vtxAttrib))
        return 1;

    return getAttributeComponentByteSizeRaw(vatFormat.compType);
}

function getAttributeByteSizeRaw(vtxAttrib: GX.Attr, vatFormat: GX_VtxAttrFmt): number {
    // MTXIDX fields don't have VAT entries.
    if (isVtxAttribMtxIdx(vtxAttrib))
        return 1;

    // Color works differently.
    if (isVtxAttribColor(vtxAttrib)) {
        switch (vatFormat.compType) {
        case GX.CompType.RGB565:
            return 2;
        case GX.CompType.RGB8:
            return 3;
        case GX.CompType.RGBX8:
            return 4;
        case GX.CompType.RGBA4:
            return 2;
        case GX.CompType.RGBA6:
            return 3;
        case GX.CompType.RGBA8:
            return 4;
        }
    }

    const compSize = getAttributeComponentByteSize(vtxAttrib, vatFormat);
    const compCount = getAttributeComponentCount(vtxAttrib, vatFormat);
    return compSize * compCount;
}

export function getAttributeByteSize(vat: GX_VtxAttrFmt[], vtxAttrib: GX.Attr): number {
    return getAttributeByteSizeRaw(vtxAttrib, vat[vtxAttrib]);
}

export function getAttributeFormatCompFlagsRaw(vtxAttrib: GX.Attr, compCnt: GX.CompCnt): number {
    switch (vtxAttrib) {
    case GX.Attr.POS:
        if (compCnt === GX.CompCnt.POS_XY)
            return FormatCompFlags.COMP_RG;
        else if (compCnt === GX.CompCnt.POS_XYZ)
            return FormatCompFlags.COMP_RGB;
    case GX.Attr.NRM:
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
    case GX.Attr.CLR0:
    case GX.Attr.CLR1:
        if (compCnt === GX.CompCnt.CLR_RGB)
            return FormatCompFlags.COMP_RGB;
        else if (compCnt === GX.CompCnt.CLR_RGBA)
            return FormatCompFlags.COMP_RGBA;
    case GX.Attr.TEX0:
    case GX.Attr.TEX1:
    case GX.Attr.TEX2:
    case GX.Attr.TEX3:
    case GX.Attr.TEX4:
    case GX.Attr.TEX5:
    case GX.Attr.TEX6:
    case GX.Attr.TEX7:
        if (compCnt === GX.CompCnt.TEX_S)
            return FormatCompFlags.COMP_R;
        else if (compCnt === GX.CompCnt.TEX_ST)
            return FormatCompFlags.COMP_RG;
    case GX.Attr.NULL:
    default:
        // Shouldn't ever happen
        throw new Error("whoops");
    }
}

function getAttributeFormatCompFlags(vtxAttrib: GX.Attr, vatFormat: GX_VtxAttrFmt): FormatCompFlags {
    // MTXIDX fields don't have VAT entries.
    if (isVtxAttribMtxIdx(vtxAttrib))
        return FormatCompFlags.COMP_R;

    return getAttributeFormatCompFlagsRaw(vtxAttrib, vatFormat.compCnt);
}

function getAttributeComponentCount(vtxAttrib: GX.Attr, vatFormat: GX_VtxAttrFmt): number {
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

function getComponentShift(vtxAttrib: GX.Attr, vatFormat: GX_VtxAttrFmt): number {
    // MTXIDX fields don't have VAT entries.
    if (isVtxAttribMtxIdx(vtxAttrib))
        return 0;

    // Normals *always* use either 6 or 14 for their shift values.
    // The value in the VAT is ignored.
    if (vtxAttrib === GX.Attr.NRM || vtxAttrib === GX.Attr.NBT) {
        if (vatFormat.compType === GX.CompType.U8 || vatFormat.compType === GX.CompType.S8)
            return 6;
        else if (vatFormat.compType === GX.CompType.U16 || vatFormat.compType === GX.CompType.S16)
            return 14;
        else
            throw "whoops";
    }

    return getComponentShiftRaw(vatFormat.compType, vatFormat.compShift);
}

function getComponentType(vtxAttrib: GX.Attr, vatFormat: GX_VtxAttrFmt): GX.CompType {
    if (isVtxAttribMtxIdx(vtxAttrib))
        return GX.CompType.U8;

    return vatFormat.compType;
}

function getIndexNumComponents(vtxAttrib: GX.Attr, vatFormat: GX_VtxAttrFmt): number {
    switch (vtxAttrib) {
    case GX.Attr.NRM:
        if (vatFormat.compCnt === GX.CompCnt.NRM_NBT3)
            return 3;
        // Fallthrough
    default:
        return 1;
    }
}

function getAttrName(vtxAttrib: GX.Attr): string {
    switch (vtxAttrib) {
    case GX.Attr.PNMTXIDX:   return `PNMTXIDX`;
    case GX.Attr.TEX0MTXIDX: return `TEX0MTXIDX`;
    case GX.Attr.TEX1MTXIDX: return `TEX1MTXIDX`;
    case GX.Attr.TEX2MTXIDX: return `TEX2MTXIDX`;
    case GX.Attr.TEX3MTXIDX: return `TEX3MTXIDX`;
    case GX.Attr.TEX4MTXIDX: return `TEX4MTXIDX`;
    case GX.Attr.TEX5MTXIDX: return `TEX5MTXIDX`;
    case GX.Attr.TEX6MTXIDX: return `TEX6MTXIDX`;
    case GX.Attr.TEX7MTXIDX: return `TEX7MTXIDX`;
    case GX.Attr.POS:        return `POS`;
    case GX.Attr.NRM:        return `NRM`;
    case GX.Attr.CLR0:       return `CLR0`;
    case GX.Attr.CLR1:       return `CLR1`;
    case GX.Attr.TEX0:       return `TEX0`;
    case GX.Attr.TEX1:       return `TEX1`;
    case GX.Attr.TEX2:       return `TEX2`;
    case GX.Attr.TEX3:       return `TEX3`;
    case GX.Attr.TEX4:       return `TEX4`;
    case GX.Attr.TEX5:       return `TEX5`;
    case GX.Attr.TEX6:       return `TEX6`;
    case GX.Attr.TEX7:       return `TEX7`;
    default:
        throw new Error("whoops");
    }
}

function getAttributeBaseFormat(vtxAttrib: GX.Attr): GfxFormat {
    if (isVtxAttribMtxIdx(vtxAttrib))
        return GfxFormat.U8_R;

    // To save on space, we put color data in U8.
    if (vtxAttrib === GX.Attr.CLR0 || vtxAttrib === GX.Attr.CLR1)
        return GfxFormat.U8_R_NORM;

    // In theory, we could use U8_R/S8_R/S16_R/U16_R for the other types,
    // but we can't easily express compShift, so we fall back to F32 for now.
    return GfxFormat.F32_R;
}

function getAttributeFormat(vatLayouts: (VatLayout | undefined)[], vtxAttrib: GX.Attr): GfxFormat {
    let formatCompFlags = 0;

    const baseFormat = getAttributeBaseFormat(vtxAttrib);

    if (isVtxAttribColor(vtxAttrib)) {
        // For color attributes, we always output all 4 components.
        formatCompFlags = FormatCompFlags.COMP_RGBA;
    } else if (isVtxAttribTexMtxIdx(vtxAttrib)) {
        // We pack TexMtxIdx into multi-channel vertex inputs.
        formatCompFlags = FormatCompFlags.COMP_RGBA;
    } else {
        // Go over all layouts and pick the best one.
        for (let i = 0; i < vatLayouts.length; i++) {
            const vatLayout = vatLayouts[i];
            if (vatLayout !== undefined)
                formatCompFlags = Math.max(formatCompFlags, getAttributeFormatCompFlags(vtxAttrib, vatLayout.vatFormat[vtxAttrib]));
        }
    }

    return makeFormat(getFormatTypeFlags(baseFormat), formatCompFlags, getFormatFlags(baseFormat));
}

function translateVatLayout(vatFormat: GX_VtxAttrFmt[], vcd: GX_VtxDesc[]): VatLayout | undefined {
    if (vatFormat === undefined)
        return undefined;

    let srcVertexSize = 0;

    for (let vtxAttrib: GX.Attr = 0; vtxAttrib < vcd.length; vtxAttrib++) {
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
        case GX.AttrType.DIRECT:
            srcVertexSize += getAttributeByteSizeRaw(vtxAttrib, vtxAttrFmt);
            break;
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

export function compileLoadedVertexLayout(vat: GX_VtxAttrFmt[][], vcd: GX_VtxDesc[]): VertexLayout {
    // Create source VAT layouts.
    const vatLayouts = vat.map((vatFormat) => translateVatLayout(vatFormat, vcd));

    const texMtxIdxLayout: (VertexAttributeLayout | null)[] = [null, null];
    const bufferIndex = 0;

    // Create destination vertex layout.
    let dstVertexSize = 0;
    const vertexAttributeLayouts: VertexAttributeLayout[] = [];
    for (let vtxAttrib: GX.Attr = 0; vtxAttrib < vcd.length; vtxAttrib++) {
        const vtxAttrDesc = vcd[vtxAttrib];
        if (!vtxAttrDesc || vtxAttrDesc.type === GX.AttrType.NONE)
            continue;

        const enableOutput = (vtxAttrDesc.enableOutput === undefined || vtxAttrDesc.enableOutput);
        if (!enableOutput)
            continue;

        let fieldBase = -1;
        let fieldByteOffset = 0;

        // TEXnMTXIDX are packed specially because of GL limitations.
        if (isVtxAttribTexMtxIdx(vtxAttrib)) {
            const layoutIdx = (vtxAttrib < GX.Attr.TEX4MTXIDX) ? 0 : 1;
            fieldByteOffset = (vtxAttrib - 1) & 0x03;

            if (texMtxIdxLayout[layoutIdx] !== null) {
                // Don't allocate a field in the packed data if we already have one...
                fieldBase = texMtxIdxLayout[layoutIdx]!.bufferOffset;
            }
        }

        const format = getAttributeFormat(vatLayouts, vtxAttrib);
        const formatTypeFlags = getFormatTypeFlags(format);
        const formatComponentSize = getFormatTypeFlagsByteSize(formatTypeFlags);

        // Allocate a field if we need to...
        if (fieldBase === -1) {
            dstVertexSize = align(dstVertexSize, formatComponentSize);
            fieldBase = dstVertexSize + fieldByteOffset;
            dstVertexSize += formatComponentSize * getFormatComponentCount(format);
        }

        const bufferOffset = fieldBase + fieldByteOffset;

        const vtxAttribLayout = { vtxAttrib, bufferIndex, bufferOffset, format };
        vertexAttributeLayouts.push(vtxAttribLayout);

        if (isVtxAttribTexMtxIdx(vtxAttrib)) {
            const layoutIdx = (vtxAttrib < GX.Attr.TEX4MTXIDX) ? 0 : 1;

            if (texMtxIdxLayout[layoutIdx] === null) {
                const baseVtxAttrib = (vtxAttrib < GX.Attr.TEX4MTXIDX) ? GX.Attr.TEX0MTXIDX : GX.Attr.TEX4MTXIDX;
                if (vtxAttrib === baseVtxAttrib) {
                    texMtxIdxLayout[layoutIdx] = vtxAttribLayout
                } else {
                    const baseAttribLayout = { vtxAttrib: baseVtxAttrib, bufferIndex, bufferOffset: fieldBase, format };
                    vertexAttributeLayouts.push(baseAttribLayout);
                    texMtxIdxLayout[layoutIdx] = baseAttribLayout;
                }
            }
        }
    }

    // Align the whole thing to our minimum required alignment (F32).
    dstVertexSize = align(dstVertexSize, 4);
    const vertexBufferStrides = [dstVertexSize];

    const indexFormat = GfxFormat.U16_R;
    return { indexFormat, vertexBufferStrides, vertexAttributeLayouts, vatLayouts };
}
//#endregion

//#region Vertex Loader JIT
type SingleVtxLoaderFunc = (dstVertexDataView: DataView, dstVertexDataOffs: number, dlView: DataView, dlOffs: number, vtxArrayViews: DataView[], vtxArrayStrides: number[]) => number;

function compileSingleVtxLoader(loadedVertexLayout: LoadedVertexLayout, vatLayout: VatLayout): SingleVtxLoaderFunc {
    function compileVtxArrayViewName(vtxAttrib: GX.Attr): string {
        return `vtxArrayViews[${vtxAttrib}]`;
    }

    // Loads a single vertex layout.
    function compileVatLayoutAttribute(vatLayout: VatLayout, vtxAttrib: GX.Attr): string {
        const vtxAttrFmt = vatLayout.vatFormat[vtxAttrib];
        const vtxAttrDesc = vatLayout.vcd[vtxAttrib];

        if (!vtxAttrDesc || vtxAttrDesc.type === GX.AttrType.NONE)
            return '';

        const dstAttribLayout = loadedVertexLayout.vertexAttributeLayouts.find((layout) => layout.vtxAttrib === vtxAttrib);

        // If we don't have a destination for the data, then don't bother outputting.
        const outputEnabled = !!dstAttribLayout;

        let srcAttrByteSize: number = -1;

        // We only need vtxAttrFmt if we're going to read the data.
        if (vtxAttrDesc.type === GX.AttrType.DIRECT)
            srcAttrByteSize = getAttributeByteSizeRaw(vtxAttrib, vtxAttrFmt);

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

        function compileWriteOneComponentU8Norm(dstOffs: string, value: string): string {
            return `dstVertexDataView.setUint8(${dstOffs}, ${value} * 0xFF)`;
        }

        function compileWriteOneComponentU8(dstOffs: string, value: string): string {
            return `dstVertexDataView.setUint8(${dstOffs}, ${value})`;
        }

        function compileWriteOneComponent(offs: number, value: string): string {
            const dstOffs = `dstVertexDataOffs + ${offs}`;

            const typeFlags = getFormatTypeFlags(dstAttribLayout!.format);
            const isNorm = getFormatFlags(dstAttribLayout!.format) & FormatFlags.NORMALIZED;
            if (typeFlags === FormatTypeFlags.F32)
                return compileWriteOneComponentF32(dstOffs, value);
            else if (typeFlags === FormatTypeFlags.U8 && isNorm)
                return compileWriteOneComponentU8Norm(dstOffs, value);
            else if (typeFlags === FormatTypeFlags.U8)
                return compileWriteOneComponentU8(dstOffs, value);
            else
                throw "whoops";
        }

        function compileOneAttribOther(viewName: string, attrOffs: string): string {
            let S = ``;

            if (outputEnabled) {
                const srcAttrCompSize = getAttributeComponentByteSize(vtxAttrib, vtxAttrFmt);
                const srcAttrCompCount = getAttributeComponentCount(vtxAttrib, vtxAttrFmt);

                const dstComponentSize = getFormatCompByteSize(dstAttribLayout!.format);
                const dstComponentCount = getFormatComponentCount(dstAttribLayout!.format);

                for (let i = 0; i < dstComponentCount; i++) {
                    const dstOffs: number = dstAttribLayout!.bufferOffset + (i * dstComponentSize);
                    const srcOffs: string = `${attrOffs} + ${i * srcAttrCompSize}`;

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

            return S;
        }

        function compileOneAttribColor(viewName: string, attrOffs: string): string {
            let S = ``;

            if (outputEnabled) {
                const dstComponentCount = getFormatComponentCount(dstAttribLayout!.format);
                const dstOffs: number = dstAttribLayout!.bufferOffset;
                assert(dstComponentCount === 4);

                const temp = `_T${vtxAttrib}`;
                switch (getComponentType(vtxAttrib, vtxAttrFmt)) {
                case GX.CompType.RGB565:
                    S += `
        var ${temp} = ${viewName}.getUint16(${attrOffs});
        ${compileWriteOneComponent(dstOffs + 0, `(((${temp} >>> 11) & 0x1F) / 0x1F)`)};
        ${compileWriteOneComponent(dstOffs + 1, `(((${temp} >>>  5) & 0x3F) / 0x3F)`)};
        ${compileWriteOneComponent(dstOffs + 2, `(((${temp} >>>  0) & 0x1F) / 0x1F)`)};
        ${compileWriteOneComponent(dstOffs + 3, `1.0`)};
`;
                    break;
                case GX.CompType.RGB8:
                case GX.CompType.RGBX8:
                    S += `
        ${compileWriteOneComponent(dstOffs + 0, `${viewName}.getUint8(${attrOffs} + 0) / 0xFF`)};
        ${compileWriteOneComponent(dstOffs + 1, `${viewName}.getUint8(${attrOffs} + 1) / 0xFF`)};
        ${compileWriteOneComponent(dstOffs + 2, `${viewName}.getUint8(${attrOffs} + 2) / 0xFF`)};
        ${compileWriteOneComponent(dstOffs + 3, `1.0`)};
`;
                    break;
                case GX.CompType.RGBA6:
                    S += `
        var ${temp} = (${viewName}.getUint8(${attrOffs} + 0) << 16) | (${viewName}.getUint8(${attrOffs} + 1) << 8) | (${viewName}.getUint8(${attrOffs} + 2));
        ${compileWriteOneComponent(dstOffs + 0, `(((${temp} >>> 18) & 0x3F) / 0x3F)`)};
        ${compileWriteOneComponent(dstOffs + 1, `(((${temp} >>> 12) & 0x3F) / 0x3F)`)};
        ${compileWriteOneComponent(dstOffs + 2, `(((${temp} >>>  6) & 0x3F) / 0x3F)`)};
        ${compileWriteOneComponent(dstOffs + 3, `(((${temp} >>>  0) & 0x3F) / 0x3F)`)};
`;
                    break;
                case GX.CompType.RGBA8:
                    S += `
        ${compileWriteOneComponent(dstOffs + 0, `${viewName}.getUint8(${attrOffs} + 0) / 0xFF`)};
        ${compileWriteOneComponent(dstOffs + 1, `${viewName}.getUint8(${attrOffs} + 1) / 0xFF`)};
        ${compileWriteOneComponent(dstOffs + 2, `${viewName}.getUint8(${attrOffs} + 2) / 0xFF`)};
        ${compileWriteOneComponent(dstOffs + 3, `${viewName}.getUint8(${attrOffs} + 3) / 0xFF`)};
`;
                    break;
                }
            }

            return S;
        }

        function compileOneAttrib(viewName: string, attrOffsetBase: string, drawCallIdxIncr: number): string {
            let S = ``;

            if (isVtxAttribColor(vtxAttrib))
                S += compileOneAttribColor(viewName, attrOffsetBase);
            else
                S += compileOneAttribOther(viewName, attrOffsetBase);

            S += `
        drawCallIdx += ${drawCallIdxIncr};
    `;
    
            return S;
        }

        function compileOneIndex(viewName: string, readIndex: string, drawCallIdxIncr: number, uniqueSuffix: string = ''): string {
            const stride = `vtxArrayStrides[${vtxAttrib}]`;
            const attrOffsetBase = `(${readIndex}) * ${stride}`;
            const arrayOffsetVarName = `arrayOffset${vtxAttrib}${uniqueSuffix}`;
            if (outputEnabled) {
                return `const ${arrayOffsetVarName} = ${attrOffsetBase};${compileOneAttrib(viewName, arrayOffsetVarName, drawCallIdxIncr)}`;
            } else {
                return compileOneAttrib('', '', drawCallIdxIncr);
            }
        }

        function compileAttribIndex(viewName: string, readIndex: string, drawCallIdxIncr: number): string {
            if (vtxAttrib === GX.Attr.NRM && vtxAttrFmt.compCnt === GX.CompCnt.NRM_NBT3) {
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
            if (!isVtxAttribMtxIdx(vtxAttrib))
                console.warn(`wtf direct`);
            return compileOneAttrib(`dlView`, `drawCallIdx`, srcAttrByteSize);
        case GX.AttrType.INDEX8:
            return compileAttribIndex(compileVtxArrayViewName(vtxAttrib), `dlView.getUint8(drawCallIdx)`, 1);
        case GX.AttrType.INDEX16:
            return compileAttribIndex(compileVtxArrayViewName(vtxAttrib), `dlView.getUint16(drawCallIdx)`, 2);
        default:
            throw "whoops";
        }
    }

    function compileVatLayout(vatLayout: VatLayout): string {
        let S = '';
        for (let vtxAttrib = 0; vtxAttrib <= GX.Attr.MAX; vtxAttrib++)
            S += compileVatLayoutAttribute(vatLayout, vtxAttrib);
        return S;
    }

    const source = `
"use strict";

return function(dstVertexDataView, dstVertexDataOffs, dlView, drawCallIdx, vtxArrayViews, vtxArrayStrides) {
${compileVatLayout(vatLayout)}

    return drawCallIdx;
};
`;
    const runVerticesGenerator = new Function(source);
    const runVertices: SingleVtxLoaderFunc = runVerticesGenerator();

    return runVertices;
}

class VtxLoaderImpl implements VtxLoader {
    public vtxLoaders: SingleVtxLoaderFunc[] = [];

    constructor(public loadedVertexLayout: VertexLayout) {
        for (let i = 0; i < loadedVertexLayout.vatLayouts.length; i++) {
            const vatLayout = loadedVertexLayout.vatLayouts[i];
            if (vatLayout !== undefined)
                this.vtxLoaders[i] = compileSingleVtxLoader(loadedVertexLayout, vatLayout);
        }
    }

    public runVertices(vtxArrays: GX_Array[], srcBuffer: ArrayBufferSlice, loadOptions?: LoadOptions): LoadedVertexData {
        // TODO(jstpierre): Clean this up eventually

        const firstVertexId = (loadOptions !== undefined && loadOptions.firstVertexId !== undefined) ? loadOptions.firstVertexId : 0;

        const vtxArrayViews: DataView[] = [];
        const vtxArrayStrides: number[] = [];
        for (let i = 0; i < GX.Attr.MAX; i++) {
            if (vtxArrays[i] !== undefined) {
                vtxArrayViews[i] = vtxArrays[i].buffer.createDataView(vtxArrays[i].offs);
                vtxArrayStrides[i] = vtxArrays[i].stride;
            }
        }

        function newPacket(indexOffset: number): LoadedVertexPacket {
            return {
                indexOffset,
                indexCount: 0,
                posNrmMatrixTable: Array(10).fill(0xFFFF),
                texMatrixTable: Array(10).fill(0xFFFF),
            };
        }

        type DrawCall = { primType: number, vertexFormat: GfxFormat, srcOffs: number, vertexCount: number };

        // Parse display list.
        const dlView = srcBuffer.createDataView();
        const drawCalls: DrawCall[] = [];
        const packets: LoadedVertexPacket[] = [];
        let totalVertexCount = 0;
        let totalIndexCount = 0;
        let drawCallIdx = 0;
        let currentPacketDraw = null;
        let currentPacketXfmem = null;

        while (true) {
            if (drawCallIdx >= srcBuffer.byteLength)
                break;
            const cmd = dlView.getUint8(drawCallIdx);
            if (cmd === 0)
                break;

            // TODO(jstpierre): This hardcodes some assumptions about the arrays and indexed units.
            switch (cmd) {
            case GX.Command.LOAD_INDX_A: { // Position Matrices
                currentPacketDraw = null;
                if (currentPacketXfmem === null)
                    currentPacketXfmem = newPacket(totalIndexCount);
                // PosMtx memory address space starts at 0x0000 and goes until 0x0400 (including TexMtx),
                // each element being 3*4 in size.
                const memoryElemSize = 3*4;
                const memoryBaseAddr = 0x0000;
                const table = currentPacketXfmem.posNrmMatrixTable;
        
                const arrayIndex = dlView.getUint16(drawCallIdx + 0x01);
                const addrLen = dlView.getUint16(drawCallIdx + 0x03);
                const len = (addrLen >>> 12) + 1;
                const addr = addrLen & 0x0FFF;
                const tableIndex = ((addr - memoryBaseAddr) / memoryElemSize) | 0;

                // For now -- it's technically valid but I'm not sure if BRRES uses it.
                if (len !== memoryElemSize)
                    throw Error();

                table[tableIndex] = arrayIndex;
                drawCallIdx += 0x05;

                continue;
            }
            case GX.Command.LOAD_INDX_C: { // Texture Matrices
                currentPacketDraw = null;
                if (currentPacketXfmem === null)
                    currentPacketXfmem = newPacket(totalIndexCount);
                // TexMtx memory address space is the same as PosMtx memory address space, but by convention
                // uses the upper 10 matrices. We enforce this convention.
                // Elements should be 3*4 in size. GD has ways to break this but BRRES should not generate this.
                const memoryElemSize = 3*4;
                const memoryBaseAddr = 0x0078;
                const table = currentPacketXfmem.texMatrixTable;

                const arrayIndex = dlView.getUint16(drawCallIdx + 0x01);
                const addrLen = dlView.getUint16(drawCallIdx + 0x03);
                const len = (addrLen >>> 12) + 1;
                const addr = addrLen & 0x0FFF;
                const tableIndex = ((addr - memoryBaseAddr) / memoryElemSize) | 0;

                // For now -- it's technically valid but I'm not sure if BRRES uses it.
                if (len !== memoryElemSize)
                    throw Error();

                table[tableIndex] = arrayIndex;
                drawCallIdx += 0x05;

                continue;
            }
            case GX.Command.LOAD_INDX_B: // Normal Matrices
            case GX.Command.LOAD_INDX_D: // Light Objects
                // TODO(jstpierre): Load these arrays as well.
                drawCallIdx += 0x05;
                continue;
            }

            const primType = cmd & 0xF8;
            const vertexFormat = cmd & 0x07;

            const vertexCount = dlView.getUint16(drawCallIdx + 0x01);
            drawCallIdx += 0x03;
            const srcOffs = drawCallIdx;
            totalVertexCount += vertexCount;

            if (currentPacketDraw === null) {
                if (currentPacketXfmem !== null) {
                    currentPacketDraw = currentPacketXfmem;
                    currentPacketXfmem = null;
                } else {
                    currentPacketDraw = newPacket(totalIndexCount);
                }
                packets.push(currentPacketDraw);
            }

            let indexCount = 0;
            switch (primType) {
            case GX.Command.DRAW_TRIANGLES:
                indexCount = vertexCount;
                break;
            case GX.Command.DRAW_TRIANGLE_FAN:
            case GX.Command.DRAW_TRIANGLE_STRIP:
                indexCount = (vertexCount - 2) * 3;
                break;
            case GX.Command.DRAW_QUADS:
            case GX.Command.DRAW_QUADS_2:
                indexCount = ((vertexCount * 6) / 4) * 3;
                break;
            default:
                throw new Error("Invalid data at " + srcBuffer.byteOffset.toString(16) + "/" + drawCallIdx.toString(16) + " primType " + primType.toString(16));
            }

            drawCalls.push({ primType, vertexFormat, srcOffs, vertexCount });
            currentPacketDraw.indexCount += indexCount;
            totalIndexCount += indexCount;

            const vatFormat = this.loadedVertexLayout.vatLayouts[vertexFormat];
            if (vatFormat === undefined)
                throw new Error("No VAT for VTXFMT" + vertexFormat);

            // Skip over the index data.
            drawCallIdx += vatFormat.srcVertexSize * vertexCount;
        }

        // Now make the data.
        let indexDataIdx = 0;
        const dstIndexData = new Uint16Array(totalIndexCount);
        let vertexId = firstVertexId;

        const dstVertexDataSize = this.loadedVertexLayout.vertexBufferStrides[0] * totalVertexCount;
        const dstVertexData = new ArrayBuffer(dstVertexDataSize);
        const dstVertexDataView = new DataView(dstVertexData);
        let dstVertexDataOffs = 0;

        for (let z = 0; z < drawCalls.length; z++) {
            const drawCall = drawCalls[z];
        
            // Convert topology to triangles.
            switch (drawCall.primType) {
            case GX.Command.DRAW_TRIANGLES:
                // Copy vertices.
                for (let i = 0; i < drawCall.vertexCount; i++) {
                    dstIndexData[indexDataIdx++] = vertexId++;
                }
                break;
            case GX.Command.DRAW_TRIANGLE_STRIP:
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
            case GX.Command.DRAW_TRIANGLE_FAN:
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
            case GX.Command.DRAW_QUADS:
            case GX.Command.DRAW_QUADS_2:
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
                drawCallIdx = this.vtxLoaders[drawCall.vertexFormat](dstVertexDataView, dstVertexDataOffs, dlView, drawCallIdx, vtxArrayViews, vtxArrayStrides);
                dstVertexDataOffs += this.loadedVertexLayout.vertexBufferStrides[0];
            }
        }
        
        return {
            indexData: dstIndexData.buffer,
            vertexBuffers: [dstVertexData],
            totalVertexCount, totalIndexCount, vertexId, packets
        };
    }
}

interface VtxLoaderDesc {
    vat: GX_VtxAttrFmt[][];
    vcd: GX_VtxDesc[];
}

function arrayEqual<T>(a: T[], b: T[], e: EqualFunc<T>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++)
        if (!e(a[i], b[i]))
            return false;
    return true;
}

function vtxAttrFmtEqual(a: GX_VtxAttrFmt | undefined, b: GX_VtxAttrFmt | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.compCnt === b.compCnt && a.compShift === b.compShift && a.compType === b.compType;
}

function vatEqual(a: GX_VtxAttrFmt[], b: GX_VtxAttrFmt[]): boolean {
    return arrayEqual(a, b, vtxAttrFmtEqual);
}

function vcdEqual(a: GX_VtxDesc | undefined, b: GX_VtxDesc | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.enableOutput === b.enableOutput && a.type === b.type;
}

function vtxLoaderDescEqual(a: VtxLoaderDesc, b: VtxLoaderDesc): boolean {
    if (!arrayEqual(a.vat, b.vat, vatEqual)) return false;
    if (!arrayEqual(a.vcd, b.vcd, vcdEqual)) return false;
    return true;
}

const cache = new HashMap<VtxLoaderDesc, VtxLoader>(vtxLoaderDescEqual, nullHashFunc);
function compileVtxLoaderDesc(desc: VtxLoaderDesc): VtxLoader {
    let loader = cache.get(desc);
    if (loader === null) {
        const vat = desc.vat;
        const vcd = desc.vcd;
        const loadedVertexLayout: VertexLayout = compileLoadedVertexLayout(vat, vcd);
        loader = new VtxLoaderImpl(loadedVertexLayout);
        cache.add(desc, loader);
    }
    return loader;
}

export function compileVtxLoaderMultiVat(vat: GX_VtxAttrFmt[][], vcd: GX_VtxDesc[]): VtxLoader {
    const desc = { vat, vcd };
    return compileVtxLoaderDesc(desc);
}

export function compileVtxLoader(vatFormat: GX_VtxAttrFmt[], vcd: GX_VtxDesc[]): VtxLoader {
    const vat = [vatFormat];
    const desc = { vat, vcd };
    return compileVtxLoaderDesc(desc);
}
//#endregion

//#region Register Loading
export class DisplayListRegisters {
    public bp: Uint32Array = new Uint32Array(0x100);
    public cp: Uint32Array = new Uint32Array(0x100);

    // Can have up to 16 values per register.
    private xf: Uint32Array = new Uint32Array(0x1000);

    // TEV colors are weird and are two things under the hood
    // with the same register address.
    public kc: Uint32Array = new Uint32Array(4 * 2 * 2);

    constructor() {
        // Initialize defaults.
        this.bp[GX.BPRegister.SS_MASK] = 0x00FFFFFF;
    }

    public bps(regBag: number): void {
        // First byte has register address, other 3 have value.
        const regAddr  = regBag >>> 24;

        const regWMask = this.bp[GX.BPRegister.SS_MASK];
        // Retrieve existing value, overwrite w/ mask.
        const regValue = (this.bp[regAddr] & ~regWMask) | (regBag & regWMask);
        // The mask resets after use.
        if (regAddr != GX.BPRegister.SS_MASK) 
            this.bp[GX.BPRegister.SS_MASK] = 0x00FFFFFF;
        // Set new value.
        this.bp[regAddr] = regValue;

        // Copy TEV colors internally.
        if (regAddr >= GX.BPRegister.TEV_REGISTERL_0_ID && regAddr <= GX.BPRegister.TEV_REGISTERL_0_ID + 4 * 2) {
            const kci = regAddr - GX.BPRegister.TEV_REGISTERL_0_ID;
            const bank = (regValue >>> 23) & 0x01;
            this.kc[bank * 4 * 2 + kci] = regValue;
        }
    }

    public xfs(idx: GX.XFRegister, sub: number, v: number): void {
        assert(idx >= 0x1000);
        idx -= 0x1000;
        this.xf[idx * 0x10 + sub] = v;
    }

    public xfg(idx: GX.XFRegister, sub: number = 0): number {
        assert(idx >= 0x1000);
        idx -= 0x1000;
        return this.xf[idx * 0x10 + sub];
    }
}

export function displayListToString(buffer: ArrayBufferSlice) {
    const view = buffer.createDataView();
    let dlString = '';
    let ssMask = 0x00FFFFFF;

    function toHexString(n: number) {
        return `0x${n.toString(16)}`;
    }

    const enum RegisterBlock { XF, BP, CP };
    const blockTables = [GX.XFRegister, GX.BPRegister, GX.CPRegister];
    const blockNames = ['XF', 'BP', 'CP'];

    function toDlString(block: RegisterBlock, regAddr: number, regValue: number) {
        const table = blockTables[block];
        const name = blockNames[block];
        const strName = table[regAddr];
        const strAddr = toHexString(regAddr);
        return `Set ${name} ${strName ? strName : strAddr} to ${toHexString(regValue)}\n`;
    }

    for (let i = 0; i < buffer.byteLength;) {
        const cmd = view.getUint8(i++);

        switch (cmd) {
        case GX.Command.NOOP:
            continue;

        case GX.Command.LOAD_BP_REG: {
            const regBag = view.getUint32(i);
            i += 4;
            
            const regAddr  = regBag >>> 24 as GX.BPRegister;
            const regValue = regBag & ssMask;
            if (regAddr !== GX.BPRegister.SS_MASK) { ssMask = 0x00FFFFFF; }
            else { ssMask = regValue; }
            
            dlString += toDlString(RegisterBlock.BP, regAddr, regValue);
            break;
        }

        case GX.Command.LOAD_CP_REG: {
            const regAddr = view.getUint8(i);
            i++;
            const regValue = view.getUint32(i);
            i += 4;
            dlString += toDlString(RegisterBlock.CP, regAddr, regValue);
            break;
        }

        case GX.Command.LOAD_XF_REG: {
            const len = view.getUint16(i) + 1;
            i += 2;
            assert(len <= 0x10);

            const regAddr = view.getUint16(i);
            i += 2;

            for (let j = 0; j < len; j++) {
                dlString += toDlString(RegisterBlock.XF, regAddr + j, view.getUint32(i));
                i += 4;
            }

            break;
        }

        default:
            console.error(`Unknown command ${cmd} at ${i} (buffer: 0x${buffer.byteOffset.toString(16)})`);
            throw "whoops 1";
        }
    }

    return dlString;
}

export function displayListRegistersRun(r: DisplayListRegisters, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    for (let i = 0; i < buffer.byteLength;) {
        const cmd = view.getUint8(i++);

        switch (cmd) {
        case GX.Command.NOOP:
            continue;

        case GX.Command.LOAD_BP_REG: {
            const regBag = view.getUint32(i);
            i += 4;
            r.bps(regBag);
            break;
        }

        case GX.Command.LOAD_CP_REG: {
            const regAddr = view.getUint8(i);
            i++;
            const regValue = view.getUint32(i);
            i += 4;
            r.cp[regAddr] = regValue;
            break;
        }

        case GX.Command.LOAD_XF_REG: {
            const len = view.getUint16(i) + 1;
            i += 2;
            assert(len <= 0x10);

            const regAddr = view.getUint16(i);
            i += 2;

            for (let j = 0; j < len; j++) {
                r.xfs(regAddr, j, view.getUint32(i));
                i += 4;
            }

            // Clear out the other values.
            for (let j = len; j < 16; j++) {
                r.xfs(regAddr, j, 0);
            }

            break;
        }

        default:
            console.error(`Unknown command ${cmd} at ${i} (buffer: 0x${buffer.byteOffset.toString(16)})`);
            throw "whoops 1";
        }
    }
}

function setBPReg(addr: number, value: number): number {
    return (addr << 24) | (value & 0x00FFFFFF);
}

export function displayListRegistersInitGX(r: DisplayListRegisters): void {
    // Init swap tables.
    for (let i = 0; i < 8; i += 2) {
        r.bps(setBPReg(GX.BPRegister.TEV_KSEL_0_ID + i + 0, 0b0100));
        r.bps(setBPReg(GX.BPRegister.TEV_KSEL_0_ID + i + 1, 0b1110));
    }
}
//#endregion

//#region Utilities
export function coalesceLoadedDatas(loadedVertexLayout: LoadedVertexLayout, loadedDatas: LoadedVertexData[]): LoadedVertexData {
    let totalIndexCount = 0;
    let totalVertexCount = 0;
    let indexDataSize = 0;
    let packedVertexDataSize = 0;
    const packets: LoadedVertexPacket[] = [];

    for (let i = 0; i < loadedDatas.length; i++) {
        const loadedData = loadedDatas[i];
        assert(loadedData.vertexBuffers.length === 1);

        for (let j = 0; j < loadedData.packets.length; j++) {
            const packet = loadedData.packets[j];
            const indexOffset = totalIndexCount + packet.indexOffset;
            const indexCount = packet.indexCount;
            const posNrmMatrixTable = packet.posNrmMatrixTable;
            const texMatrixTable = packet.texMatrixTable;
            packets.push({ indexOffset, indexCount, posNrmMatrixTable, texMatrixTable });
        }

        totalIndexCount += loadedData.totalIndexCount;
        totalVertexCount += loadedData.totalVertexCount;
        indexDataSize += loadedData.indexData.byteLength;
        packedVertexDataSize += loadedData.vertexBuffers[0].byteLength;
    }

    const indexData = new Uint8Array(indexDataSize);
    const packedVertexData = new Uint8Array(packedVertexDataSize);

    let indexDataOffs = 0;
    let packedVertexDataOffs = 0;
    for (let i = 0; i < loadedDatas.length; i++) {
        const loadedData = loadedDatas[i];
        indexData.set(new Uint8Array(loadedData.indexData), indexDataOffs);
        packedVertexData.set(new Uint8Array(loadedData.vertexBuffers[0]), packedVertexDataOffs);
        indexDataOffs += loadedData.indexData.byteLength;
        packedVertexDataOffs += loadedData.vertexBuffers[0].byteLength;
    }

    return {
        indexData: indexData.buffer,
        vertexBuffers: [packedVertexData.buffer],
        totalIndexCount,
        totalVertexCount,
        vertexId: 0,
        packets,
    };
}
//#endregion
