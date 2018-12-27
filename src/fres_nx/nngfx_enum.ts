
export const enum ImageStorageDimension {
    _1D, _2D, _3D,
}

export const enum ImageDimension {
    _1D, _2D, _3D, CubeMap, _1DArray, _2DArray, _2DMultisample, _2DMultisampleArray, CubeMapArray,
}

export const enum TileMode {
    Optimal, Linear,
}

export const enum ChannelFormat {
    Undefined,
    R4_G4,
    R8,
    R4_G4_B4_A4,
    A4_B4_G4_R4,
    R5_G5_B5_A1,
    A1_B5_G5_R5,
    R5_G6_B5,
    B5_G6_R5,
    R8_G8,
    R16,
    R8_G8_B8_A8,
    B8_G8_R8_A8,
    R9_G9_B9_E5,
    R10_G10_B10_A2,
    R11_G11_B10,
    B10_G11_R11,
    R10_G11_B11,
    R16_G16,
    R24_G8,
    R32,
    R16_G16_B16_A16,
    R32_G8_X24,
    R32_G32,
    R32_G32_B32,
    R32_G32_B32_A32,
    Bc1,
    Bc2,
    Bc3,
    Bc4,
    Bc5,
    Bc6,
    Bc7,
    Eac_R11,
    Eac_R11_G11,
    Etc1,
    Etc2,
    Etc2_Mask,
    Etc2_Alpha,
    Pvrtc1_2Bpp,
    Pvrtc1_4Bpp,
    Pvrtc1_Alpha_2Bpp,
    Pvrtc1_Alpha_4Bpp,
    Pvrtc2_Alpha_2Bpp,
    Pvrtc2_Alpha_4Bpp,
    Astc_4x4,
    Astc_5x4,
    Astc_5x5,
    Astc_6x5,
    Astc_6x6,
    Astc_8x5,
    Astc_8x6,
    Astc_8x8,
    Astc_10x5,
    Astc_10x6,
    Astc_10x8,
    Astc_10x10,
    Astc_12x10,
    Astc_12x12,
    B5_G5_R5_A1,
}

export const enum TypeFormat {
    Undefined, Unorm, Snorm, Uint, Sint, Float, UnormSrgb, DepthStencil, UintToFloat, SintToFloat, Ufloat,
    $Bits = 8,
    $Mask = ((1 << $Bits) - 1),
}

export const enum IndexFormat {
    Uint8, Uint16, Uint32,
}

export const enum PrimitiveTopology {
    // only one worth supporting...
    TriangleList = 0x03,
}

// TODO(jstpierre): Convert into enum. For now...
export type ImageFormat = number;

export const enum AttributeFormat {
    Undefined,
    _8_8_Unorm = ((ChannelFormat.R8_G8 << TypeFormat.$Bits) | TypeFormat.Unorm),
    _8_8_Snorm = ((ChannelFormat.R8_G8 << TypeFormat.$Bits) | TypeFormat.Snorm),
    _8_8_Uint = ((ChannelFormat.R8_G8 << TypeFormat.$Bits) | TypeFormat.Uint),
    _8_8_8_8_Unorm = ((ChannelFormat.R8_G8_B8_A8 << TypeFormat.$Bits) | TypeFormat.Unorm),
    _8_8_8_8_Snorm = ((ChannelFormat.R8_G8_B8_A8 << TypeFormat.$Bits) | TypeFormat.Snorm),
    _10_10_10_2_Snorm = ((ChannelFormat.R10_G10_B10_A2 << TypeFormat.$Bits) | TypeFormat.Snorm),
    _16_16_Unorm = ((ChannelFormat.R16_G16 << TypeFormat.$Bits) | TypeFormat.Unorm),
    _16_16_Snorm = ((ChannelFormat.R16_G16 << TypeFormat.$Bits) | TypeFormat.Snorm),
    _16_16_Float = ((ChannelFormat.R16_G16 << TypeFormat.$Bits) | TypeFormat.Float),
    _16_16_16_16_Float = ((ChannelFormat.R16_G16_B16_A16 << TypeFormat.$Bits) | TypeFormat.Float),
    _32_32_Float = ((ChannelFormat.R32_G32 << TypeFormat.$Bits) | TypeFormat.Float),
    _32_32_32_Float = ((ChannelFormat.R32_G32_B32 << TypeFormat.$Bits) | TypeFormat.Float),
}

export function getChannelFormat(format: ImageFormat | AttributeFormat): ChannelFormat {
    return format >>> TypeFormat.$Bits;
}

export function getTypeFormat(format: ImageFormat | AttributeFormat): TypeFormat {
    return format & TypeFormat.$Mask;
}

export const enum TextureAddressMode {
    Repeat, Mirror, ClampToEdge, ClampToBorder, MirrorClampToEdge,
}

export const enum FilterMode {
    Point  = 1 << 0,
    Linear = 1 << 1,
    MipShift = 0, MagShift = 2, MinShift = 4,

    // For documentation sake.
    MipPoint    = Point  << MipShift,
    MipLinear   = Linear << MipShift,
    MagPoint    = Point  << MagShift,
    MagLinear   = Linear << MagShift,
    MinPoint    = Point  << MinShift,
    MinLinear   = Linear << MinShift,

    Anisotropic = 1 << 6,
    Comparison  = 1 << 7,
    Minimum     = 1 << 8,
    Maximum     = 1 << 9,
};
