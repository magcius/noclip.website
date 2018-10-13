
export const enum GX2Dimension {
    _2D = 0x01,
    _2D_ARRAY = 0x05,
    _2D_MSAA = 0x06,
}

export const enum GX2SurfaceFormat {
    FLAG_SRGB   = 0x0400,
    FLAG_SNORM  = 0x0200,
    FMT_MASK    = 0x003F,
    FMT_BC1     = 0x0031,
    FMT_BC3     = 0x0033,
    FMT_BC4     = 0x0034,
    FMT_BC5     = 0x0035,

    FMT_TCS_R8_G8_B8_A8 = 0x1a,

    BC1_UNORM   = FMT_BC1,
    BC1_SRGB    = FMT_BC1 | FLAG_SRGB,
    BC3_UNORM   = FMT_BC3,
    BC3_SRGB    = FMT_BC3 | FLAG_SRGB,
    BC4_UNORM   = FMT_BC4,
    BC4_SNORM   = FMT_BC4 | FLAG_SNORM,
    BC5_UNORM   = FMT_BC5,
    BC5_SNORM   = FMT_BC5 | FLAG_SNORM,

    TCS_R8_G8_B8_A8_UNORM = FMT_TCS_R8_G8_B8_A8,
    TCS_R8_G8_B8_A8_SRGB  = FMT_TCS_R8_G8_B8_A8 | FLAG_SRGB,
}

export const enum GX2TileMode {
    _1D_TILED_THIN1 = 0x02,
    _2D_TILED_THIN1 = 0x04,
}

export const enum GX2AAMode {
    _1X = 0x00,
    _2X = 0x01,
    _4X = 0x02,
    _8X = 0x03,
}

export const enum GX2PrimitiveType {
    TRIANGLES = 0x04,
}

export const enum GX2IndexFormat {
    U16_LE = 0x00,
    U32_LE = 0x01,
    U16    = 0x04,
    U32    = 0x09,
}

export const enum GX2AttribFormat {
    _8_UNORM           = 0x0000,
    _8_UINT            = 0x0100,
    _8_SNORM           = 0x0200,
    _8_SINT            = 0x0300,
    _8_8_UNORM         = 0x0004,
    _8_8_SNORM         = 0x0204,
    _8_8_8_8_UNORM     = 0x000a,
    _8_8_8_8_SNORM     = 0x020a,
    _16_16_UNORM       = 0x0007,
    _16_16_SNORM       = 0x0207,
    _10_10_10_2_UNORM  = 0x000b,
    _10_10_10_2_SNORM  = 0x020b,
    _16_16_16_16_UNORM = 0x000e,
    _16_16_16_16_SNORM = 0x020e,
    _16_16_FLOAT       = 0x0808,
    _16_16_16_16_FLOAT = 0x080f,
    _32_32_FLOAT       = 0x080d,
    _32_32_32_FLOAT    = 0x0811,
}

export const enum GX2TexClamp {
    WRAP   = 0x00,
    MIRROR = 0x01,
    CLAMP  = 0x02,
}

export const enum GX2TexXYFilterType {
    POINT    = 0x00,
    BILINEAR = 0x01,
}

export const enum GX2TexMipFilterType {
    NO_MIP = 0x00,
    POINT  = 0x01,
    LINEAR = 0x02,
}

export const enum GX2CompareFunction {
    NEVER    = 0x00,
    LESS     = 0x01,
    EQUAL    = 0x02,
    LEQUAL   = 0x03,
    GREATER  = 0x04,
    NOTEQUAL = 0x05,
    GEQUAL   = 0x06,
    ALWAYS   = 0x07,
}

export const enum GX2FrontFaceMode {
    CCW = 0x00,
    CW  = 0x01,
}

export const enum GX2BlendFunction {
    ZERO = 0,
    ONE = 1,
    SRC_COLOR = 2,
    ONE_MINUS_SRC_COLOR = 3,
    SRC_ALPHA = 4,
    ONE_MINUS_SRC_ALPHA = 5,
    DST_ALPHA = 6,
    ONE_MINUS_DST_ALPHA = 7,
    DST_COLOR = 8,
    ONE_MINUS_DST_COLOR = 8,
    SRC_ALPHA_SATURATE = 10,
    CONSTANT_COLOR = 13,
    ONE_MINUS_CONSTANT_COLOR = 14,
    SRC1_COLOR = 15,
    ONE_MINUS_SRC1_COLOR = 16,
    SRC1_ALPHA = 17,
    ONE_MINUS_SRC1_ALPHA = 18,
    CONSTANT_ALPHA = 19,
    ONE_MINUS_CONSTANT_ALPHA = 20,
}

export const enum GX2BlendCombine {
    ADD = 0,
    SRC_MINUS_DST = 1,
    MIN = 2,
    MAX = 3,
    DST_MINUS_SRC = 4,
}
