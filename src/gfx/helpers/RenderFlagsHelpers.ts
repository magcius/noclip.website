
import { GfxMegaStateDescriptor, GfxBlendMode, GfxCompareMode, GfxCullMode, GfxFrontFaceMode, GfxBlendFactor } from "../platform/GfxPlatform";

export interface RenderFlagsPossibilities {
    blendMode?: GfxBlendMode;
    blendSrcFactor?: GfxBlendFactor;
    blendDstFactor?: GfxBlendFactor;
    depthCompare?: GfxCompareMode;
    depthWrite?: boolean;
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
defaultFlags.cullMode = GfxCullMode.NONE;
defaultFlags.depthWrite = true;
defaultFlags.depthCompare = GfxCompareMode.LEQUAL;
defaultFlags.frontFace = GfxFrontFaceMode.CCW;
defaultFlags.polygonOffset = false;

export const fullscreenFlags = new RenderFlags();
fullscreenFlags.set({ depthCompare: GfxCompareMode.ALWAYS, depthWrite: false });
