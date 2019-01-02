
import { GfxMegaStateDescriptor, GfxBlendMode, GfxCompareMode, GfxCullMode, GfxFrontFaceMode, GfxBlendFactor, GfxStencilOp } from "../platform/GfxPlatform";
import { defaultMegaState, fullscreenMegaState, setMegaStateFlags } from "./GfxMegaStateDescriptorHelpers";

// TODO(jstpierre): Replace with GfxMegaStateDescriptorHelpers
export class RenderFlags {
    public colorWrite: boolean;
    public blendMode: GfxBlendMode;
    public blendSrcFactor: GfxBlendFactor;
    public blendDstFactor: GfxBlendFactor;
    public depthCompare: GfxCompareMode;
    public depthWrite: boolean;
    public stencilCompare: GfxCompareMode;
    public stencilWrite: boolean;
    public stencilPassOp: GfxStencilOp;
    public cullMode: GfxCullMode;
    public frontFace: GfxFrontFaceMode;
    public polygonOffset: boolean;

    constructor(setFrom: GfxMegaStateDescriptor = defaultMegaState) {
        if (setFrom !== null)
            this.set(setFrom);
    }

    public set(other: Partial<GfxMegaStateDescriptor>): void {
        setMegaStateFlags(this, other);
    }

    public resolveMegaState(): GfxMegaStateDescriptor {
        return this;
    }
}

export const defaultFlags = new RenderFlags(defaultMegaState);
export const fullscreenFlags = new RenderFlags(fullscreenMegaState);
