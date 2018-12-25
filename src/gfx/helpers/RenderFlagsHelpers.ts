
import { GfxMegaStateDescriptor, GfxBlendMode, GfxCompareMode, GfxCullMode, GfxFrontFaceMode, GfxBlendFactor, GfxStencilOp } from "../platform/GfxPlatform";

export interface RenderFlagsPossibilities {
    blendMode?: GfxBlendMode;
    blendSrcFactor?: GfxBlendFactor;
    blendDstFactor?: GfxBlendFactor;
    depthCompare?: GfxCompareMode;
    depthWrite?: boolean;
    stencilCompare?: GfxCompareMode;
    stencilWrite?: boolean;
    stencilFailOp?: GfxStencilOp;
    stencilPassOp?: GfxStencilOp;
    cullMode?: GfxCullMode;
    frontFace?: GfxFrontFaceMode;
    polygonOffset?: boolean;
}

export class RenderFlags {
    public blendMode: GfxBlendMode;
    public blendSrcFactor: GfxBlendFactor;
    public blendDstFactor: GfxBlendFactor;
    public depthCompare: GfxCompareMode;
    public depthWrite: boolean;
    public stencilCompare: GfxCompareMode;
    public stencilWrite: boolean;
    public stencilFailOp: GfxStencilOp;
    public stencilPassOp: GfxStencilOp;
    public cullMode: GfxCullMode;
    public frontFace: GfxFrontFaceMode;
    public polygonOffset: boolean;

    constructor(setFrom: RenderFlags = defaultFlags) {
        if (setFrom !== null)
            this.set(setFrom);
    }

    private resolveField<T>(v: T | undefined, parentV: T): T {
        return v !== undefined ? v : parentV;
    }

    public set(other: RenderFlagsPossibilities): void {
        this.blendMode = this.resolveField(other.blendMode, this.blendMode);
        this.blendSrcFactor = this.resolveField(other.blendSrcFactor, this.blendSrcFactor);
        this.blendDstFactor = this.resolveField(other.blendDstFactor, this.blendDstFactor);
        this.depthCompare = this.resolveField(other.depthCompare, this.depthCompare);
        this.depthWrite = this.resolveField(other.depthWrite, this.depthWrite);
        this.stencilCompare = this.resolveField(other.stencilCompare, this.stencilCompare);
        this.stencilWrite = this.resolveField(other.stencilWrite, this.stencilWrite);
        this.stencilFailOp = this.resolveField(other.stencilFailOp, this.stencilFailOp);
        this.stencilPassOp = this.resolveField(other.stencilPassOp, this.stencilPassOp);
        this.cullMode = this.resolveField(other.cullMode, this.cullMode);
        this.frontFace = this.resolveField(other.frontFace, this.frontFace);
        this.polygonOffset = this.resolveField(other.polygonOffset, this.polygonOffset);
    }

    public resolveMegaState(): GfxMegaStateDescriptor {
        return this;
    }
}

export const defaultFlags = new RenderFlags(null);
defaultFlags.blendMode = GfxBlendMode.NONE;
defaultFlags.blendSrcFactor = GfxBlendFactor.ONE;
defaultFlags.blendDstFactor = GfxBlendFactor.ZERO;
defaultFlags.depthWrite = true;
defaultFlags.depthCompare = GfxCompareMode.LEQUAL;
defaultFlags.stencilCompare = GfxCompareMode.NEVER;
defaultFlags.stencilWrite = false;
defaultFlags.stencilFailOp = GfxStencilOp.KEEP;
defaultFlags.stencilPassOp = GfxStencilOp.KEEP;
defaultFlags.cullMode = GfxCullMode.NONE;
defaultFlags.frontFace = GfxFrontFaceMode.CCW;
defaultFlags.polygonOffset = false;

export const fullscreenFlags = new RenderFlags();
fullscreenFlags.set({ depthCompare: GfxCompareMode.ALWAYS, depthWrite: false });
