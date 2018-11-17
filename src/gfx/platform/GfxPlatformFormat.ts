
// Format enums

export const enum FormatTypeFlags {
    U8 = 0x01,
    U16,
    U32,
    S8,
    S16,
    S32,
    F32,

    // Special texture formats.
    BC1 = 0x41,
    BC3,
};

export const enum FormatCompFlags {
    COMP_R    = 0x01,
    COMP_RG   = 0x02,
    COMP_RGB  = 0x03,
    COMP_RGBA = 0x04,
};

export function getFormatCompFlagsComponentCount(n: FormatCompFlags): number {
    // The number of components is the flag value. Easy.
    return n;
}

export const enum FormatFlags {
    NONE       = 0x00,
    NORMALIZED = 0x01,
    SRGB       = 0x02,
}

export function makeFormat(type: FormatTypeFlags, comp: FormatCompFlags, flags: FormatFlags): number {
    return (type << 16) | (comp << 8) | flags;
}

export enum GfxFormat {
    F32_R        = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    F32_RG       = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RG,   FormatFlags.NONE),
    F32_RGB      = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RGB,  FormatFlags.NONE),
    F32_RGBA     = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    U8_R         = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_R,    FormatFlags.NONE),
    U8_RGBA      = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    U8_RGBA_NORM = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGBA, FormatFlags.NORMALIZED),
    U8_RGBA_SRGB = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGBA, FormatFlags.SRGB),
    U16_R        = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    U16_R_NORM   = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_R,    FormatFlags.NORMALIZED),
    U16_RGB      = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_RGB,  FormatFlags.NONE),
    U32_R        = makeFormat(FormatTypeFlags.U32, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    S8_R         = makeFormat(FormatTypeFlags.S8,  FormatCompFlags.COMP_R,    FormatFlags.NONE),
    S8_RGBA_NORM = makeFormat(FormatTypeFlags.S8,  FormatCompFlags.COMP_RGBA, FormatFlags.NORMALIZED),
    S16_R        = makeFormat(FormatTypeFlags.S16, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    S16_RGB_NORM = makeFormat(FormatTypeFlags.S16, FormatCompFlags.COMP_RGB,  FormatFlags.NORMALIZED),
    S32_R        = makeFormat(FormatTypeFlags.S32, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    BC1          = makeFormat(FormatTypeFlags.BC1, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    BC1_SRGB     = makeFormat(FormatTypeFlags.BC1, FormatCompFlags.COMP_RGBA, FormatFlags.SRGB),
    BC3          = makeFormat(FormatTypeFlags.BC3, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    BC3_SRGB     = makeFormat(FormatTypeFlags.BC3, FormatCompFlags.COMP_RGBA, FormatFlags.SRGB),
}

export function getFormatCompFlags(fmt: GfxFormat): FormatCompFlags {
    return (fmt >>>  8) & 0xFF;
}

export function getFormatTypeFlags(fmt: GfxFormat): FormatTypeFlags {
    return (fmt >>> 16) & 0xFF;
}

export function getFormatFlags(fmt: GfxFormat): FormatFlags {
    return fmt & 0xFF;
}

export function getFormatTypeFlagsByteSize(typeFlags: FormatTypeFlags): number {
    switch (typeFlags) {
    case FormatTypeFlags.F32:
    case FormatTypeFlags.U32:
    case FormatTypeFlags.S32:
        return 4;
    case FormatTypeFlags.U16:
    case FormatTypeFlags.S16:
        return 2;
    case FormatTypeFlags.U8:
    case FormatTypeFlags.S8:
        return 1;
    default:
        throw "whoops";
    }
}

/**
 * Gets the byte size for an individual component.
 * e.g. for F32_RGB, this will return "4", since F32 has 4 bytes.
 */
export function getFormatCompByteSize(fmt: GfxFormat): number {
    return getFormatTypeFlagsByteSize(getFormatTypeFlags(fmt));
}

export function getFormatComponentCount(fmt: GfxFormat): number {
    return getFormatCompFlagsComponentCount(getFormatCompFlags(fmt));
}

export function getFormatByteSize(fmt: GfxFormat): number {
    const typeByteSize = getFormatTypeFlagsByteSize(getFormatTypeFlags(fmt));
    const componentCount = getFormatCompFlagsComponentCount(getFormatCompFlags(fmt));
    return typeByteSize * componentCount;
}
