
import { GfxDevice, GfxRenderPassDescriptor, GfxFormat, GfxTexture, GfxColor, GfxTextureDimension } from "../platform/GfxPlatform";
import { colorNewFromRGBA, OpaqueBlack } from "../../Color";
import { reverseDepthForClearValue } from "./ReversedDepthHelpers";

export class ColorTexture {
    public readonly dimension = GfxTextureDimension.n2D;
    public readonly depth: number = 1;
    public readonly numLevels: number = 1;

    public gfxTexture: GfxTexture | null = null;
    public width: number = 0;
    public height: number = 0;

    constructor(public pixelFormat: GfxFormat = GfxFormat.U8_RGBA_RT) {
    }

    public setParameters(device: GfxDevice, width: number, height: number): boolean {
        if (this.width !== width || this.height !== height) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.gfxTexture = device.createTexture(this);
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null) {
            device.destroyTexture(this.gfxTexture);
            this.gfxTexture = null;
        }
    }
}

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
