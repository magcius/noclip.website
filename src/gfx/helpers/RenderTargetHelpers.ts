
import { GfxRenderPassDescriptor, GfxColor } from "../platform/GfxPlatform";
import { colorNewFromRGBA, OpaqueBlack } from "../../Color";
import { reverseDepthForClearValue } from "./ReversedDepthHelpers";

export function makeClearRenderPassDescriptor(clearColor: Readonly<GfxColor> | 'load'): GfxRenderPassDescriptor {
    return {
        colorAttachment: null,
        colorResolveTo: null,
        depthStencilAttachment: null,
        colorClearColor: clearColor,
        depthStencilResolveTo: null,
        depthClearValue: reverseDepthForClearValue(1.0),
        stencilClearValue: 0.0,
    }
}

export const standardFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(colorNewFromRGBA(0.88, 0.88, 0.88, 1.0));
export const opaqueBlackFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(OpaqueBlack);
