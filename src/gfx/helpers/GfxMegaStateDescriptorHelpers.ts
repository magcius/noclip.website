
import { GfxMegaStateDescriptor, GfxFrontFaceMode, GfxCullMode, GfxStencilOp, GfxCompareMode, GfxBlendFactor, GfxBlendMode, GfxAttachmentState, GfxColorWriteMask, GfxChannelBlendState } from "../platform/GfxPlatform";
import { colorCopy, colorNewCopy, TransparentBlack } from "../../Color";
import { reverseDepthForCompareMode } from "./ReversedDepthHelpers";

function resolveField<T>(v: T | undefined, parentV: T): T {
    return v !== undefined ? v : parentV;
}

function copyAttachmentState(dst: GfxAttachmentState | undefined, src: GfxAttachmentState): GfxAttachmentState {
    if (dst === undefined) {
        return {
            rgbBlendState: Object.assign({}, src.rgbBlendState),
            alphaBlendState: Object.assign({}, src.alphaBlendState),
            colorWriteMask: src.colorWriteMask,
        };
    } else {
        Object.assign(dst.rgbBlendState, src.rgbBlendState);
        Object.assign(dst.alphaBlendState, src.alphaBlendState);
        dst.colorWriteMask = src.colorWriteMask;
        return dst;
    }
}

function copyAttachmentsState(dst: GfxAttachmentState[], src: GfxAttachmentState[]): void {
    for (let i = 0; i < src.length; i++)
        dst[i] = copyAttachmentState(dst[i], src[i]);
}

export function setMegaStateFlags(dst: GfxMegaStateDescriptor, src: Partial<GfxMegaStateDescriptor>): void {
    // attachmentsState replaces wholesale; it does not merge.
    // TODO(jstpierre): Should it merge?
    if (src.attachmentsState !== undefined) {
        dst.attachmentsState = [];
        copyAttachmentsState(dst.attachmentsState, src.attachmentsState);
    }

    if (src.blendConstant !== undefined)
        colorCopy(dst.blendConstant, src.blendConstant);

    dst.depthCompare = resolveField(src.depthCompare, dst.depthCompare);
    dst.depthWrite = resolveField(src.depthWrite, dst.depthWrite);
    dst.stencilCompare = resolveField(src.stencilCompare, dst.stencilCompare);
    dst.stencilWrite = resolveField(src.stencilWrite, dst.stencilWrite);
    dst.stencilPassOp = resolveField(src.stencilPassOp, dst.stencilPassOp);
    dst.cullMode = resolveField(src.cullMode, dst.cullMode);
    dst.frontFace = resolveField(src.frontFace, dst.frontFace);
    dst.polygonOffset = resolveField(src.polygonOffset, dst.polygonOffset);
}

export function copyMegaState(src: GfxMegaStateDescriptor): GfxMegaStateDescriptor {
    const dst = Object.assign({}, src);
    // Copy fields that need copying.
    dst.attachmentsState = [];
    copyAttachmentsState(dst.attachmentsState, src.attachmentsState);
    dst.blendConstant = colorNewCopy(dst.blendConstant);
    return dst;
}

export function makeMegaState(other: Partial<GfxMegaStateDescriptor> | null = null, src: GfxMegaStateDescriptor = defaultMegaState) {
    const dst = copyMegaState(src);
    if (other !== null)
        setMegaStateFlags(dst, other);
    return dst;
}

export interface AttachmentStateSimple {
    colorWrite: boolean;
    blendMode: GfxBlendMode;
    blendSrcFactor: GfxBlendFactor;
    blendDstFactor: GfxBlendFactor;
}

export function copyAttachmentStateFromSimple(dst: GfxAttachmentState, src: Partial<AttachmentStateSimple>): void {
    if (src.colorWrite !== undefined)
        dst.colorWriteMask = src.colorWrite ? GfxColorWriteMask.ALL : GfxColorWriteMask.NONE;

    if (src.blendMode !== undefined) {
        dst.rgbBlendState.blendMode = src.blendMode;
        dst.alphaBlendState.blendMode = src.blendMode;
    }

    if (src.blendSrcFactor !== undefined) {
        dst.rgbBlendState.blendSrcFactor = src.blendSrcFactor;
        dst.alphaBlendState.blendSrcFactor = src.blendSrcFactor;
    }

    if (src.blendDstFactor !== undefined) {
        dst.rgbBlendState.blendDstFactor = src.blendDstFactor;
        dst.alphaBlendState.blendDstFactor = src.blendDstFactor;
    }
}

export function setAttachmentStateSimple(dst: Partial<GfxMegaStateDescriptor>, simple: Partial<AttachmentStateSimple>): Partial<GfxMegaStateDescriptor> {
    if (dst.attachmentsState === undefined) {
        dst.attachmentsState = [];
        copyAttachmentsState(dst.attachmentsState, defaultMegaState.attachmentsState);
    }

    copyAttachmentStateFromSimple(dst.attachmentsState![0], simple);
    return dst;
}

const defaultBlendState: GfxChannelBlendState = {
    blendMode: GfxBlendMode.ADD,
    blendSrcFactor: GfxBlendFactor.ONE,
    blendDstFactor: GfxBlendFactor.ZERO,
};

export const defaultMegaState: GfxMegaStateDescriptor = {
    attachmentsState: [{
        colorWriteMask: GfxColorWriteMask.ALL,
        rgbBlendState: defaultBlendState,
        alphaBlendState: defaultBlendState,
    }],

    blendConstant: colorNewCopy(TransparentBlack),
    depthWrite: true,
    depthCompare: reverseDepthForCompareMode(GfxCompareMode.LEQUAL),
    stencilCompare: GfxCompareMode.NEVER,
    stencilWrite: false,
    stencilPassOp: GfxStencilOp.KEEP,
    cullMode: GfxCullMode.NONE,
    frontFace: GfxFrontFaceMode.CCW,
    polygonOffset: false,
};

export const fullscreenMegaState = makeMegaState({ depthCompare: GfxCompareMode.ALWAYS, depthWrite: false }, defaultMegaState);
