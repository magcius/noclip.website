
// Things that should only be required by platform implementations.

import { GfxBugQuirks } from "./GfxPlatform";

// Hack to get nominal typing.
export enum _T { Buffer, Texture, Attachment, Sampler, Program, Bindings, InputLayout, InputState, RenderPipeline, Readback };

export interface GfxResourceBase { ResourceName?: string, ResourceUniqueId: number };
export interface GfxBuffer extends GfxResourceBase { _T: _T.Buffer };
export interface GfxTexture extends GfxResourceBase { _T: _T.Texture };
export interface GfxAttachment extends GfxResourceBase { _T: _T.Attachment };
export interface GfxSampler extends GfxResourceBase { _T: _T.Sampler };
export interface GfxProgram extends GfxResourceBase { _T: _T.Program };
export interface GfxBindings extends GfxResourceBase { _T: _T.Bindings };
export interface GfxInputLayout extends GfxResourceBase { _T: _T.InputLayout };
export interface GfxInputState extends GfxResourceBase { _T: _T.InputState };
export interface GfxRenderPipeline extends GfxResourceBase { _T: _T.RenderPipeline };
export interface GfxReadback extends GfxResourceBase { _T: _T.Readback };

export type GfxResource =
    GfxBuffer | GfxTexture | GfxAttachment | GfxSampler | GfxProgram | GfxBindings | GfxInputLayout | GfxInputState | GfxRenderPipeline | GfxReadback;

export class GfxBugQuirksImpl implements GfxBugQuirks {
    public rowMajorMatricesBroken: boolean = false;
}
