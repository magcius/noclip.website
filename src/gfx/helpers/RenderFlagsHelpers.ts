
import { GfxMegaStateDescriptor, GfxBlendMode, GfxCompareMode, GfxCullMode, GfxFrontFaceMode, GfxBlendFactor } from "../platform/GfxPlatform";

// The Gfx equivalent of RenderFlags. Based on a stack, rather than the "last wins" model, though.

export class RenderFlagsChain {
    public blendMode: GfxBlendMode | undefined = undefined;
    public blendSrcFactor: GfxBlendFactor | undefined = undefined;
    public blendDstFactor: GfxBlendFactor | undefined = undefined;
    public depthCompare: GfxCompareMode | undefined = undefined;
    public depthWrite: boolean | undefined = undefined;
    public cullMode: GfxCullMode | undefined = undefined;
    public frontFace: GfxFrontFaceMode | undefined = undefined;

    public static default: RenderFlagsChain = new RenderFlagsChain(null);

    constructor(private parentRib: RenderFlagsChain | null = RenderFlagsChain.default) {
    }

    private resolveField<T>(v: T | undefined, parentV: T): T {
        return v !== undefined ? v : parentV;
    }

    public resolveMegaState(): GfxMegaStateDescriptor {
        if (this.parentRib === null)
            return this;

        // TODO: This is a bit slow.
        const parentFlags = this.parentRib.resolveMegaState();

        return {
            blendMode: this.resolveField(this.blendMode, parentFlags.blendMode),
            blendSrcFactor: this.resolveField(this.blendSrcFactor, parentFlags.blendSrcFactor),
            blendDstFactor: this.resolveField(this.blendDstFactor, parentFlags.blendDstFactor),
            depthCompare: this.resolveField(this.depthCompare, parentFlags.depthCompare),
            depthWrite: this.resolveField(this.depthWrite, parentFlags.depthWrite),
            cullMode: this.resolveField(this.cullMode, parentFlags.cullMode),
            frontFace: this.resolveField(this.frontFace, parentFlags.frontFace),
        };
    }
}

RenderFlagsChain.default.blendMode = GfxBlendMode.NONE;
RenderFlagsChain.default.blendSrcFactor = GfxBlendFactor.ONE;
RenderFlagsChain.default.blendDstFactor = GfxBlendFactor.ZERO;
RenderFlagsChain.default.cullMode = GfxCullMode.NONE;
RenderFlagsChain.default.depthWrite = true;
RenderFlagsChain.default.depthCompare = GfxCompareMode.LEQUAL;
RenderFlagsChain.default.frontFace = GfxFrontFaceMode.CCW;
