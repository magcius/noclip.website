
// Format enums

export const enum FormatTypeFlags {
    U8 = 0x01,
    U16,
    U32,
    S8,
    S16,
    S32,
    F16,
    F32,

    // Compressed texture formats.
    BC1 = 0x41,
    BC2,
    BC3,

    // Depth/stencil texture formats.
    D24 = 0x81,
    D32,
    D24S8,
    D32S8,
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
    NONE       = 0b00000000,
    NORMALIZED = 0b00000001,
    SRGB       = 0b00000010,
    DEPTH      = 0b00000100,
    STENCIL    = 0b00001000,
    RT         = 0b00010000,
}

export function makeFormat(type: FormatTypeFlags, comp: FormatCompFlags, flags: FormatFlags): GfxFormat {
    return (type << 16) | (comp << 8) | flags;
}

export enum GfxFormat {
    F16_RG        = makeFormat(FormatTypeFlags.F16, FormatCompFlags.COMP_RG,   FormatFlags.NONE),
    F16_RGBA      = makeFormat(FormatTypeFlags.F16, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    F32_R         = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    F32_RG        = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RG,   FormatFlags.NONE),
    F32_RGB       = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RGB,  FormatFlags.NONE),
    F32_RGBA      = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    U8_R          = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_R,    FormatFlags.NONE),
    U8_R_NORM     = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_R,    FormatFlags.NORMALIZED),
    U8_RG         = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RG,   FormatFlags.NONE),
    U8_RG_NORM    = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RG,   FormatFlags.NORMALIZED),
    U8_RGB        = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGB,  FormatFlags.NONE),
    U8_RGB_NORM   = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGB,  FormatFlags.NORMALIZED),
    U8_RGB_SRGB   = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGB,  FormatFlags.SRGB),
    U8_RGBA       = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    U8_RGBA_NORM  = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGBA, FormatFlags.NORMALIZED),
    U8_RGBA_SRGB  = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGBA, FormatFlags.SRGB),
    U16_R         = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    U16_R_NORM    = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_R,    FormatFlags.NORMALIZED),
    U16_RG_NORM   = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_RG,   FormatFlags.NORMALIZED),
    U16_RGBA_NORM = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_RGBA, FormatFlags.NORMALIZED),
    U16_RGB       = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_RGB,  FormatFlags.NONE),
    U32_R         = makeFormat(FormatTypeFlags.U32, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    U32_RG        = makeFormat(FormatTypeFlags.U32, FormatCompFlags.COMP_RG,   FormatFlags.NONE),
    S8_R          = makeFormat(FormatTypeFlags.S8,  FormatCompFlags.COMP_R,    FormatFlags.NONE),
    S8_R_NORM     = makeFormat(FormatTypeFlags.S8,  FormatCompFlags.COMP_R,    FormatFlags.NORMALIZED),
    S8_RG_NORM    = makeFormat(FormatTypeFlags.S8,  FormatCompFlags.COMP_R,    FormatFlags.NORMALIZED),
    S8_RGB_NORM   = makeFormat(FormatTypeFlags.S8,  FormatCompFlags.COMP_RGB,  FormatFlags.NORMALIZED),
    S8_RGBA_NORM  = makeFormat(FormatTypeFlags.S8,  FormatCompFlags.COMP_RGBA, FormatFlags.NORMALIZED),
    S16_R         = makeFormat(FormatTypeFlags.S16, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    S16_RG        = makeFormat(FormatTypeFlags.S16, FormatCompFlags.COMP_RG,   FormatFlags.NONE),
    S16_RG_NORM   = makeFormat(FormatTypeFlags.S16, FormatCompFlags.COMP_RG,   FormatFlags.NORMALIZED),
    S16_RGB_NORM  = makeFormat(FormatTypeFlags.S16, FormatCompFlags.COMP_RGB,  FormatFlags.NORMALIZED),
    S16_RGBA      = makeFormat(FormatTypeFlags.S16, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    S16_RGBA_NORM = makeFormat(FormatTypeFlags.S16, FormatCompFlags.COMP_RGBA, FormatFlags.NORMALIZED),
    S32_R         = makeFormat(FormatTypeFlags.S32, FormatCompFlags.COMP_R,    FormatFlags.NONE),

    // Compressed
    BC1           = makeFormat(FormatTypeFlags.BC1, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    BC1_SRGB      = makeFormat(FormatTypeFlags.BC1, FormatCompFlags.COMP_RGBA, FormatFlags.SRGB),
    BC2           = makeFormat(FormatTypeFlags.BC2, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    BC2_SRGB      = makeFormat(FormatTypeFlags.BC2, FormatCompFlags.COMP_RGBA, FormatFlags.SRGB),
    BC3           = makeFormat(FormatTypeFlags.BC3, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    BC3_SRGB      = makeFormat(FormatTypeFlags.BC3, FormatCompFlags.COMP_RGBA, FormatFlags.SRGB),

    // Depth/Stencil
    D24            = makeFormat(FormatTypeFlags.D24,   FormatCompFlags.COMP_R,  FormatFlags.DEPTH),
    D24_S8         = makeFormat(FormatTypeFlags.D24S8, FormatCompFlags.COMP_RG, FormatFlags.DEPTH | FormatFlags.STENCIL),
    D32F           = makeFormat(FormatTypeFlags.D32,   FormatCompFlags.COMP_R,  FormatFlags.DEPTH),
    D32F_S8        = makeFormat(FormatTypeFlags.D32S8, FormatCompFlags.COMP_RG, FormatFlags.DEPTH | FormatFlags.STENCIL),

    // Special RT formats for preferred backend support.
    U8_RGBA_RT     = makeFormat(FormatTypeFlags.U8,    FormatCompFlags.COMP_RGBA, FormatFlags.RT),
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

export function getFormatTypeFlagsByteSize(typeFlags: FormatTypeFlags): 1 | 2 | 4 {
    switch (typeFlags) {
    case FormatTypeFlags.F32:
    case FormatTypeFlags.U32:
    case FormatTypeFlags.S32:
        return 4;
    case FormatTypeFlags.U16:
    case FormatTypeFlags.S16:
    case FormatTypeFlags.F16:
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
export function getFormatCompByteSize(fmt: GfxFormat): 1 | 2 | 4 {
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

export function setFormatFlags(fmt: GfxFormat, flags: FormatFlags): GfxFormat {
    return (fmt & 0xFFFFFF00) | flags;
}

export function setFormatComponentCount(fmt: GfxFormat, compFlags: FormatCompFlags): GfxFormat {
    return (fmt & 0xFFFF00FF) | (compFlags << 8);
}
