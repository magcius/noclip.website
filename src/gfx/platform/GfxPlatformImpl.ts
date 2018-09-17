
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
