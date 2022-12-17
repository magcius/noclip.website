
// Format enums

import { GfxSamplerFormatKind } from "./GfxPlatform";
import { assert } from "./GfxPlatformUtil";

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
    BC4_UNORM,
    BC4_SNORM,
    BC5_UNORM,
    BC5_SNORM,

    // Special-case packed texture formats.
    U16_PACKED_5551 = 0x61,
    U16_PACKED_565,

    // Depth/stencil texture formats.
    D24 = 0x81,
    D32F,
    D24S8,
    D32FS8,
};

export const enum FormatCompFlags {
    R    = 0x01,
    RG   = 0x02,
    RGB  = 0x03,
    RGBA = 0x04,
};

export function getFormatCompFlagsComponentCount(n: FormatCompFlags): number {
    // The number of components is the flag value. Easy.
    return n;
}

export const enum FormatFlags {
    None         = 0b00000000,
    Normalized   = 0b00000001,
    sRGB         = 0b00000010,
    Depth        = 0b00000100,
    Stencil      = 0b00001000,
    RenderTarget = 0b00010000,
}

export function makeFormat(type: FormatTypeFlags, comp: FormatCompFlags, flags: FormatFlags): GfxFormat {
    return (type << 16) | (comp << 8) | flags;
}

export enum GfxFormat {
    F16_R           = makeFormat(FormatTypeFlags.F16,       FormatCompFlags.R,                FormatFlags.None),
    F16_RG          = makeFormat(FormatTypeFlags.F16,       FormatCompFlags.RG,               FormatFlags.None),
    F16_RGB         = makeFormat(FormatTypeFlags.F16,       FormatCompFlags.RGB,              FormatFlags.None),
    F16_RGBA        = makeFormat(FormatTypeFlags.F16,       FormatCompFlags.RGBA,             FormatFlags.None),
    F32_R           = makeFormat(FormatTypeFlags.F32,       FormatCompFlags.R,                FormatFlags.None),
    F32_RG          = makeFormat(FormatTypeFlags.F32,       FormatCompFlags.RG,               FormatFlags.None),
    F32_RGB         = makeFormat(FormatTypeFlags.F32,       FormatCompFlags.RGB,              FormatFlags.None),
    F32_RGBA        = makeFormat(FormatTypeFlags.F32,       FormatCompFlags.RGBA,             FormatFlags.None),
    U8_R            = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.R,                FormatFlags.None),
    U8_R_NORM       = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.R,                FormatFlags.Normalized),
    U8_RG           = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RG,               FormatFlags.None),
    U8_RG_NORM      = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RG,               FormatFlags.Normalized),
    U8_RGB          = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGB,              FormatFlags.None),
    U8_RGB_NORM     = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGB,              FormatFlags.Normalized),
    U8_RGB_SRGB     = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGB,              FormatFlags.sRGB | FormatFlags.Normalized),
    U8_RGBA         = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGBA,             FormatFlags.None),
    U8_RGBA_NORM    = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGBA,             FormatFlags.Normalized),
    U8_RGBA_SRGB    = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGBA,             FormatFlags.sRGB | FormatFlags.Normalized),
    U16_R           = makeFormat(FormatTypeFlags.U16,       FormatCompFlags.R,                FormatFlags.None),
    U16_R_NORM      = makeFormat(FormatTypeFlags.U16,       FormatCompFlags.R,                FormatFlags.Normalized),
    U16_RG_NORM     = makeFormat(FormatTypeFlags.U16,       FormatCompFlags.RG,               FormatFlags.Normalized),
    U16_RGBA_NORM   = makeFormat(FormatTypeFlags.U16,       FormatCompFlags.RGBA,             FormatFlags.Normalized),
    U16_RGB         = makeFormat(FormatTypeFlags.U16,       FormatCompFlags.RGB,              FormatFlags.None),
    U32_R           = makeFormat(FormatTypeFlags.U32,       FormatCompFlags.R,                FormatFlags.None),
    U32_RG          = makeFormat(FormatTypeFlags.U32,       FormatCompFlags.RG,               FormatFlags.None),
    S8_R            = makeFormat(FormatTypeFlags.S8,        FormatCompFlags.R,                FormatFlags.None),
    S8_R_NORM       = makeFormat(FormatTypeFlags.S8,        FormatCompFlags.R,                FormatFlags.Normalized),
    S8_RG_NORM      = makeFormat(FormatTypeFlags.S8,        FormatCompFlags.RG,               FormatFlags.Normalized),
    S8_RGB_NORM     = makeFormat(FormatTypeFlags.S8,        FormatCompFlags.RGB,              FormatFlags.Normalized),
    S8_RGBA_NORM    = makeFormat(FormatTypeFlags.S8,        FormatCompFlags.RGBA,             FormatFlags.Normalized),
    S16_R           = makeFormat(FormatTypeFlags.S16,       FormatCompFlags.R,                FormatFlags.None),
    S16_RG          = makeFormat(FormatTypeFlags.S16,       FormatCompFlags.RG,               FormatFlags.None),
    S16_RG_NORM     = makeFormat(FormatTypeFlags.S16,       FormatCompFlags.RG,               FormatFlags.Normalized),
    S16_RGB_NORM    = makeFormat(FormatTypeFlags.S16,       FormatCompFlags.RGB,              FormatFlags.Normalized),
    S16_RGBA        = makeFormat(FormatTypeFlags.S16,       FormatCompFlags.RGBA,             FormatFlags.None),
    S16_RGBA_NORM   = makeFormat(FormatTypeFlags.S16,       FormatCompFlags.RGBA,             FormatFlags.Normalized),
    S32_R           = makeFormat(FormatTypeFlags.S32,       FormatCompFlags.R,                FormatFlags.None),

    // Packed texture formats.
    U16_RGBA_5551   = makeFormat(FormatTypeFlags.U16_PACKED_5551, FormatCompFlags.RGBA, FormatFlags.Normalized),
    U16_RGB_565     = makeFormat(FormatTypeFlags.U16_PACKED_565,  FormatCompFlags.RGB,  FormatFlags.Normalized),

    // Compressed
    BC1             = makeFormat(FormatTypeFlags.BC1,       FormatCompFlags.RGBA, FormatFlags.Normalized),
    BC1_SRGB        = makeFormat(FormatTypeFlags.BC1,       FormatCompFlags.RGBA, FormatFlags.Normalized | FormatFlags.sRGB),
    BC2             = makeFormat(FormatTypeFlags.BC2,       FormatCompFlags.RGBA, FormatFlags.Normalized),
    BC2_SRGB        = makeFormat(FormatTypeFlags.BC2,       FormatCompFlags.RGBA, FormatFlags.Normalized | FormatFlags.sRGB),
    BC3             = makeFormat(FormatTypeFlags.BC3,       FormatCompFlags.RGBA, FormatFlags.Normalized),
    BC3_SRGB        = makeFormat(FormatTypeFlags.BC3,       FormatCompFlags.RGBA, FormatFlags.Normalized | FormatFlags.sRGB),
    BC4_UNORM       = makeFormat(FormatTypeFlags.BC4_UNORM, FormatCompFlags.R,    FormatFlags.Normalized),
    BC4_SNORM       = makeFormat(FormatTypeFlags.BC4_SNORM, FormatCompFlags.R,    FormatFlags.Normalized),
    BC5_UNORM       = makeFormat(FormatTypeFlags.BC5_UNORM, FormatCompFlags.RG,   FormatFlags.Normalized),
    BC5_SNORM       = makeFormat(FormatTypeFlags.BC5_SNORM, FormatCompFlags.RG,   FormatFlags.Normalized),

    // Depth/Stencil
    D24             = makeFormat(FormatTypeFlags.D24,       FormatCompFlags.R,  FormatFlags.Depth),
    D24_S8          = makeFormat(FormatTypeFlags.D24S8,     FormatCompFlags.RG, FormatFlags.Depth | FormatFlags.Stencil),
    D32F            = makeFormat(FormatTypeFlags.D32F,      FormatCompFlags.R,  FormatFlags.Depth),
    D32F_S8         = makeFormat(FormatTypeFlags.D32FS8,    FormatCompFlags.RG, FormatFlags.Depth | FormatFlags.Stencil),

    // Special RT formats for preferred backend support.
    U8_RGB_RT       = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGB,  FormatFlags.RenderTarget | FormatFlags.Normalized),
    U8_RGBA_RT      = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGBA, FormatFlags.RenderTarget | FormatFlags.Normalized),
    U8_RGBA_RT_SRGB = makeFormat(FormatTypeFlags.U8,        FormatCompFlags.RGBA, FormatFlags.RenderTarget | FormatFlags.Normalized | FormatFlags.sRGB),
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

/**
 * 
 */
export function getFormatByteSize(fmt: GfxFormat): number {
    const typeFlags = getFormatTypeFlags(fmt);

    switch (typeFlags) {
    case FormatTypeFlags.U16_PACKED_5551:
    case FormatTypeFlags.U16_PACKED_565:
        return 2;
    case FormatTypeFlags.BC1:
    case FormatTypeFlags.BC2:
    case FormatTypeFlags.BC3:
    case FormatTypeFlags.BC4_UNORM:
    case FormatTypeFlags.BC4_SNORM:
    case FormatTypeFlags.BC5_UNORM:
    case FormatTypeFlags.BC5_SNORM:
        throw "whoops"; // Not valid to call on compressed texture formats...
    default:
        const typeByteSize = getFormatTypeFlagsByteSize(typeFlags);
        const componentCount = getFormatCompFlagsComponentCount(getFormatCompFlags(fmt));
        return typeByteSize * componentCount;
    }
}

export function setFormatCompFlags(fmt: GfxFormat, compFlags: FormatCompFlags): GfxFormat {
    return (fmt & 0xFFFF00FF) | (compFlags << 8);
}

export function setFormatFlags(fmt: GfxFormat, flags: FormatFlags): GfxFormat {
    return (fmt & 0xFFFFFF00) | flags;
}

export function getFormatSamplerKind(fmt: GfxFormat): GfxSamplerFormatKind {
    const flags = getFormatFlags(fmt);
    if (!!(flags & FormatFlags.Depth))
        return GfxSamplerFormatKind.Depth;
    if (!!(flags & FormatFlags.Normalized))
        return GfxSamplerFormatKind.Float;
    const typeFlags = getFormatTypeFlags(fmt);
    if (typeFlags === FormatTypeFlags.F16 || typeFlags === FormatTypeFlags.F32)
        return GfxSamplerFormatKind.Float;
    else if (typeFlags === FormatTypeFlags.U8 || typeFlags === FormatTypeFlags.U16 || typeFlags === FormatTypeFlags.U32)
        return GfxSamplerFormatKind.Uint;
    else if (typeFlags === FormatTypeFlags.S8 || typeFlags === FormatTypeFlags.S16 || typeFlags === FormatTypeFlags.S32)
        return GfxSamplerFormatKind.Sint;
    else
        throw "whoops";
}
