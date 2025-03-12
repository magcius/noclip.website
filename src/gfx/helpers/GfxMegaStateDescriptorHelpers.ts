
import { GfxMegaStateDescriptor, GfxFrontFaceMode, GfxCullMode, GfxStencilOp, GfxCompareMode, GfxBlendFactor, GfxBlendMode, GfxAttachmentState, GfxChannelWriteMask, GfxChannelBlendState } from "../platform/GfxPlatform.js";
import { reverseDepthForCompareMode } from "./ReversedDepthHelpers.js";
import { fallbackUndefined } from "../platform/GfxPlatformUtil.js";

function copyChannelBlendState(dst: GfxChannelBlendState, src: GfxChannelBlendState): void {
    dst.blendDstFactor = src.blendDstFactor;
    dst.blendSrcFactor = src.blendSrcFactor;
    dst.blendMode = src.blendMode;
}

export function copyAttachmentState(dst: GfxAttachmentState | undefined, src: GfxAttachmentState): GfxAttachmentState {
    if (dst === undefined) {
        dst = {
            rgbBlendState: {} as GfxChannelBlendState,
            alphaBlendState: {} as GfxChannelBlendState,
            channelWriteMask: 0,
        };
    }

    copyChannelBlendState(dst.rgbBlendState, src.rgbBlendState);
    copyChannelBlendState(dst.alphaBlendState, src.alphaBlendState);
    dst.channelWriteMask = src.channelWriteMask;
    return dst;
}

function copyAttachmentsState(dst: GfxAttachmentState[], src: GfxAttachmentState[]): void {
    if (dst.length !== src.length)
        dst.length = src.length;
    for (let i = 0; i < src.length; i++)
        dst[i] = copyAttachmentState(dst[i], src[i]);
}

export function setMegaStateFlags(dst: GfxMegaStateDescriptor, src: Partial<GfxMegaStateDescriptor>): void {
    // attachmentsState replaces wholesale; it does not merge.
    if (src.attachmentsState !== undefined)
        copyAttachmentsState(dst.attachmentsState, src.attachmentsState);

    dst.depthCompare = fallbackUndefined(src.depthCompare, dst.depthCompare);
    dst.depthWrite = fallbackUndefined(src.depthWrite, dst.depthWrite);
    dst.stencilCompare = fallbackUndefined(src.stencilCompare, dst.stencilCompare);
    dst.stencilWrite = fallbackUndefined(src.stencilWrite, dst.stencilWrite);
    dst.stencilPassOp = fallbackUndefined(src.stencilPassOp, dst.stencilPassOp);
    dst.cullMode = fallbackUndefined(src.cullMode, dst.cullMode);
    dst.frontFace = fallbackUndefined(src.frontFace, dst.frontFace);
    dst.polygonOffset = fallbackUndefined(src.polygonOffset, dst.polygonOffset);
    dst.wireframe = fallbackUndefined(src.wireframe, dst.wireframe);
}

export function copyMegaState(src: GfxMegaStateDescriptor): GfxMegaStateDescriptor {
    const dst = Object.assign({}, src);
    // Copy fields that need copying.
    dst.attachmentsState = [];
    copyAttachmentsState(dst.attachmentsState, src.attachmentsState);
    return dst;
}

export function makeMegaState(other: Partial<GfxMegaStateDescriptor> | null = null, src: GfxMegaStateDescriptor = defaultMegaState) {
    const dst = copyMegaState(src);
    if (other !== null)
        setMegaStateFlags(dst, other);
    return dst;
}

export interface AttachmentStateSimple {
    channelWriteMask: GfxChannelWriteMask;
    blendMode: GfxBlendMode;
    blendSrcFactor: GfxBlendFactor;
    blendDstFactor: GfxBlendFactor;
}

export function copyAttachmentStateFromSimple(dst: GfxAttachmentState, src: Partial<AttachmentStateSimple>): void {
    if (src.channelWriteMask !== undefined)
        dst.channelWriteMask = src.channelWriteMask;

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
    blendMode: GfxBlendMode.Add,
    blendSrcFactor: GfxBlendFactor.One,
    blendDstFactor: GfxBlendFactor.Zero,
};

export const defaultMegaState: GfxMegaStateDescriptor = {
    attachmentsState: [{
        channelWriteMask: GfxChannelWriteMask.RGB,
        rgbBlendState: defaultBlendState,
        alphaBlendState: defaultBlendState,
    }],
    depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual),
    depthWrite: true,
    stencilCompare: GfxCompareMode.Always,
    stencilWrite: false,
    stencilPassOp: GfxStencilOp.Keep,
    cullMode: GfxCullMode.None,
    frontFace: GfxFrontFaceMode.CCW,
    polygonOffset: false,
    wireframe: false,
};

export const fullscreenMegaState = makeMegaState({ depthCompare: GfxCompareMode.Always, depthWrite: false }, defaultMegaState);
