
import { GfxMegaStateDescriptor, GfxFrontFaceMode, GfxCullMode, GfxStencilOp, GfxCompareMode, GfxBlendFactor, GfxBlendMode } from "../platform/GfxPlatform";

function resolveField<T>(v: T | undefined, parentV: T): T {
    return v !== undefined ? v : parentV;
}

export function setMegaStateFlags(dst: GfxMegaStateDescriptor, other: Partial<GfxMegaStateDescriptor>): void {
    dst.colorWrite = resolveField(other.colorWrite, dst.colorWrite);
    dst.blendMode = resolveField(other.blendMode, dst.blendMode);
    dst.blendSrcFactor = resolveField(other.blendSrcFactor, dst.blendSrcFactor);
    dst.blendDstFactor = resolveField(other.blendDstFactor, dst.blendDstFactor);
    dst.depthCompare = resolveField(other.depthCompare, dst.depthCompare);
    dst.depthWrite = resolveField(other.depthWrite, dst.depthWrite);
    dst.stencilCompare = resolveField(other.stencilCompare, dst.stencilCompare);
    dst.stencilWrite = resolveField(other.stencilWrite, dst.stencilWrite);
    dst.stencilPassOp = resolveField(other.stencilPassOp, dst.stencilPassOp);
    dst.cullMode = resolveField(other.cullMode, dst.cullMode);
    dst.frontFace = resolveField(other.frontFace, dst.frontFace);
    dst.polygonOffset = resolveField(other.polygonOffset, dst.polygonOffset);
}

export function copyMegaState(src: GfxMegaStateDescriptor) {
    return Object.assign({}, src);
}

export function makeMegaState(other: Partial<GfxMegaStateDescriptor> | null = null, src: GfxMegaStateDescriptor = defaultMegaState) {
    const dst = copyMegaState(src);
    if (other !== null)
        setMegaStateFlags(dst, other);
    return dst;
}

export const defaultMegaState: GfxMegaStateDescriptor = {
    colorWrite: true,
    blendMode: GfxBlendMode.NONE,
    blendSrcFactor: GfxBlendFactor.ONE,
    blendDstFactor: GfxBlendFactor.ZERO,
    depthWrite: true,
    depthCompare: GfxCompareMode.LEQUAL,
    stencilCompare: GfxCompareMode.NEVER,
    stencilWrite: false,
    stencilPassOp: GfxStencilOp.KEEP,
    cullMode: GfxCullMode.NONE,
    frontFace: GfxFrontFaceMode.CCW,
    polygonOffset: false,
};

export const fullscreenMegaState = makeMegaState({ depthCompare: GfxCompareMode.ALWAYS, depthWrite: false }, defaultMegaState);
