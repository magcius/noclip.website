
import { GfxDevice, GfxAttachment, GfxRenderPassDescriptor, GfxFormat, GfxTexture, GfxRenderPass, GfxColor, GfxNormalizedViewportCoords, GfxTextureDimension } from "../platform/GfxPlatform";
import { colorNewFromRGBA, TransparentBlack, OpaqueBlack } from "../../Color";
import { reverseDepthForClearValue } from "./ReversedDepthHelpers";

export const DEFAULT_NUM_SAMPLES = 4;

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

export class Attachment {
    public gfxAttachment: GfxAttachment | null = null;
    public width: number = 0;
    public height: number = 0;
    public sampleCount: number = 0;

    constructor(public pixelFormat: GfxFormat) {
    }

    public setParameters(device: GfxDevice, width: number, height: number, sampleCount: number = DEFAULT_NUM_SAMPLES): boolean {
        if (this.width !== width || this.height !== height || this.sampleCount !== sampleCount) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.sampleCount = sampleCount;
            this.gfxAttachment = device.createAttachment(this);
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxAttachment !== null) {
            device.destroyAttachment(this.gfxAttachment);
            this.gfxAttachment = null;
        }
    }
}

export function copyRenderPassDescriptor(dst: GfxRenderPassDescriptor, src: GfxRenderPassDescriptor): void {
    dst.colorClearColor = src.colorClearColor;
    dst.depthClearValue = src.depthClearValue;
    dst.stencilClearValue = src.stencilClearValue;
}

export function makeEmptyRenderPassDescriptor(): GfxRenderPassDescriptor {
    return makeClearRenderPassDescriptor('load');
}

export function setViewportOnRenderPass(renderPass: GfxRenderPass, viewport: Readonly<GfxNormalizedViewportCoords>, attachment: Attachment): void {
    const x = attachment.width * viewport.x;
    const w = attachment.width * viewport.w;
    const y = attachment.height * viewport.y;
    const h = attachment.height * viewport.h;
    renderPass.setViewport(x, y, w, h);
}

export function setScissorOnRenderPass(renderPass: GfxRenderPass, viewport: Readonly<GfxNormalizedViewportCoords>, attachment: Attachment): void {
    const x = attachment.width * viewport.x;
    const w = attachment.width * viewport.w;
    const y = attachment.height * viewport.y;
    const h = attachment.height * viewport.h;
    renderPass.setScissor(x, y, w, h);
}

export const IdentityViewportCoords: Readonly<GfxNormalizedViewportCoords> = { x: 0, y: 0, w: 1, h: 1 };

export class BasicRenderTarget {
    public colorAttachment: Attachment;
    public depthStencilAttachment = new Attachment(GfxFormat.D32F_S8);
    private renderPassDescriptor = makeEmptyRenderPassDescriptor();

    constructor(colorFormat: GfxFormat = GfxFormat.U8_RGBA_RT) {
        this.colorAttachment = new Attachment(colorFormat);
    }

    public setParameters(device: GfxDevice, width: number, height: number, sampleCount: number = DEFAULT_NUM_SAMPLES): void {
        this.colorAttachment.setParameters(device, width, height, sampleCount);
        this.depthStencilAttachment.setParameters(device, width, height, sampleCount);
    }

    public createRenderPass(device: GfxDevice, viewport: Readonly<GfxNormalizedViewportCoords>, renderPassDescriptor: GfxRenderPassDescriptor, colorResolveTo: GfxTexture | null = null): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxAttachment;
        this.renderPassDescriptor.colorResolveTo = colorResolveTo;
        this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment.gfxAttachment;
        const passRenderer = device.createRenderPass(this.renderPassDescriptor);
        setViewportOnRenderPass(passRenderer, viewport, this.colorAttachment);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
        this.depthStencilAttachment.destroy(device);
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
export const transparentBlackFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(TransparentBlack);
export const depthClearRenderPassDescriptor = makeClearRenderPassDescriptor('load');
export const noClearRenderPassDescriptor: GfxRenderPassDescriptor = {
    colorAttachment: null,
    colorResolveTo: null,
    depthStencilAttachment: null,
    depthStencilResolveTo: null,
    colorClearColor: 'load',
    depthClearValue: 'load',
    stencilClearValue: 'load',
};
