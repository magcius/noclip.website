
import { GfxMegaStateDescriptor, GfxBlendMode, GfxCompareMode, GfxCullMode, GfxFrontFaceMode, GfxBlendFactor } from "../platform/GfxPlatform";

export interface RenderFlagsPossibilities {
    blendMode?: GfxBlendMode;
    blendSrcFactor?: GfxBlendFactor;
    blendDstFactor?: GfxBlendFactor;
    depthCompare?: GfxCompareMode;
    depthWrite?: boolean;
    cullMode?: GfxCullMode;
    frontFace?: GfxFrontFaceMode;
}

// The Gfx equivalent of RenderFlags. Based on a stack, rather than the "last wins" model, though.

export class RenderFlags {
    blendMode: GfxBlendMode;
    blendSrcFactor: GfxBlendFactor;
    blendDstFactor: GfxBlendFactor;
    depthCompare: GfxCompareMode;
    depthWrite: boolean;
    cullMode: GfxCullMode;
    frontFace: GfxFrontFaceMode;

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
        this.cullMode = this.resolveField(other.cullMode, this.cullMode);
        this.frontFace = this.resolveField(other.frontFace, this.frontFace);
    }

    public resolveMegaState(): GfxMegaStateDescriptor {
        return this;
    }
}

export const defaultFlags = new RenderFlags(null);
defaultFlags.blendMode = GfxBlendMode.NONE;
defaultFlags.blendSrcFactor = GfxBlendFactor.ONE;
defaultFlags.blendDstFactor = GfxBlendFactor.ZERO;
defaultFlags.cullMode = GfxCullMode.NONE;
defaultFlags.depthWrite = true;
defaultFlags.depthCompare = GfxCompareMode.LEQUAL;
defaultFlags.frontFace = GfxFrontFaceMode.CCW;

export const fullscreenFlags = new RenderFlags();
fullscreenFlags.depthCompare = GfxCompareMode.NEVER;
fullscreenFlags.blendMode = GfxBlendMode.NONE;
fullscreenFlags.cullMode = GfxCullMode.NONE;
