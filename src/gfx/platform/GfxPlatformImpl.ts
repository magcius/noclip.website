
// Things that should only be required by platform implementations.

import { GfxBindingLayoutSamplerDescriptor, GfxSamplerFormatKind, GfxTextureDimension } from "./GfxPlatform";

// Hack to get nominal typing.
export enum _T { Buffer, Texture, RenderTarget, Sampler, Program, Bindings, InputLayout, InputState, RenderPipeline, ComputePipeline, Readback, QueryPool }

export interface GfxResourceBase { ResourceName?: string, ResourceUniqueId: number };
export interface GfxBuffer extends GfxResourceBase { _T: _T.Buffer };
export interface GfxTexture extends GfxResourceBase { _T: _T.Texture };
export interface GfxRenderTarget extends GfxResourceBase { _T: _T.RenderTarget };
export interface GfxSampler extends GfxResourceBase { _T: _T.Sampler };
export interface GfxProgram extends GfxResourceBase { _T: _T.Program };
export interface GfxBindings extends GfxResourceBase { _T: _T.Bindings };
export interface GfxInputLayout extends GfxResourceBase { _T: _T.InputLayout };
export interface GfxInputState extends GfxResourceBase { _T: _T.InputState };
export interface GfxRenderPipeline extends GfxResourceBase { _T: _T.RenderPipeline };
export interface GfxComputePipeline extends GfxResourceBase { _T: _T.ComputePipeline };
export interface GfxReadback extends GfxResourceBase { _T: _T.Readback };
export interface GfxQueryPool extends GfxResourceBase { _T: _T.QueryPool };

export type GfxResource =
    GfxBuffer | GfxTexture | GfxRenderTarget | GfxSampler | GfxProgram | GfxBindings | GfxInputLayout | GfxInputState | GfxRenderPipeline | GfxComputePipeline | GfxReadback | GfxQueryPool;

export const defaultBindingLayoutSamplerDescriptor: GfxBindingLayoutSamplerDescriptor = {
    formatKind: GfxSamplerFormatKind.Float,
    dimension: GfxTextureDimension.n2D,
};
