
// Things that should only be required by platform implementations.

// Hack to get nominal typing.
export enum _T { Buffer, Texture, ColorAttachment, DepthStencilAttachment, RenderTarget, Sampler, Program, InputLayout, InputState, RenderPipeline };

export interface GfxBuffer { _T: _T.Buffer };
export interface GfxTexture { _T: _T.Texture };
export interface GfxColorAttachment { _T: _T.ColorAttachment };
export interface GfxDepthStencilAttachment { _T: _T.DepthStencilAttachment };
export interface GfxRenderTarget { _T: _T.RenderTarget };
export interface GfxSampler { _T: _T.Sampler };
export interface GfxProgram { _T: _T.Program };
export interface GfxInputLayout { _T: _T.InputLayout };
export interface GfxInputState { _T: _T.InputState };
export interface GfxRenderPipeline { _T: _T.RenderPipeline };

export const enum FormatTypeFlags {
    U8  = 0x01,
    U16 = 0x02,
    U32 = 0x03,
    S8  = 0x04,
    S16 = 0x05,
    S32 = 0x06,
    F32 = 0x07,
};

export const enum FormatCompFlags {
    COMP_R    = 0x01,
    COMP_RG   = 0x02,
    COMP_RGB  = 0x03,
    COMP_RGBA = 0x04,
};

export const enum FormatFlags {
    NONE       = 0x00,
    NORMALIZED = 0x01,
    SRGB       = 0x02,
}

function makeFormat(type: FormatTypeFlags, comp: FormatCompFlags, flags: FormatFlags): number {
    return (type << 16) | (comp << 8) | flags;
}

export enum GfxFormat {
    F32_R    = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    F32_RG   = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RG,   FormatFlags.NONE),
    F32_RGB  = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RGB,  FormatFlags.NONE),
    F32_RGBA = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    U16_R    = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    U8_RGBA  = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
}

/**
 * Gets the byte size for an individual component.
 * e.g. for F32_RGB, this will return "4", since F32 has 4 bytes.
 */
export function getFormatCompByteSize(fmt: GfxFormat): number {
    const type: FormatTypeFlags = (fmt >>> 16) & 0xFF;
    switch (type) {
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
    }
}
