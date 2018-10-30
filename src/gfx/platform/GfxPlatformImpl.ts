
// Things that should only be required by platform implementations.

// Hack to get nominal typing.
export enum _T { Buffer, Texture, ColorAttachment, DepthStencilAttachment, RenderTarget, Sampler, Program, Bindings, InputLayout, InputState, RenderPipeline };

interface GfxResourceBase { ResourceName?: string };
export interface GfxBuffer extends GfxResourceBase { _T: _T.Buffer };
export interface GfxTexture extends GfxResourceBase { _T: _T.Texture };
export interface GfxColorAttachment extends GfxResourceBase { _T: _T.ColorAttachment };
export interface GfxDepthStencilAttachment extends GfxResourceBase { _T: _T.DepthStencilAttachment };
export interface GfxRenderTarget extends GfxResourceBase { _T: _T.RenderTarget };
export interface GfxSampler extends GfxResourceBase { _T: _T.Sampler };
export interface GfxProgram extends GfxResourceBase { _T: _T.Program };
export interface GfxBindings extends GfxResourceBase { _T: _T.Bindings };
export interface GfxInputLayout extends GfxResourceBase { _T: _T.InputLayout };
export interface GfxInputState extends GfxResourceBase { _T: _T.InputState };
export interface GfxRenderPipeline extends GfxResourceBase { _T: _T.RenderPipeline };

export type GfxResource =
    GfxBuffer | GfxTexture | GfxColorAttachment | GfxDepthStencilAttachment | GfxRenderTarget | GfxSampler | GfxProgram | GfxBindings | GfxInputLayout | GfxInputState | GfxRenderPipeline;
