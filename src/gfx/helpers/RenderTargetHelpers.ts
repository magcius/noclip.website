
import { GfxRenderTarget, GfxColorAttachment, GfxDevice, GfxDepthStencilAttachment, GfxLoadDisposition, GfxRenderPassDescriptor } from "../platform/GfxPlatform";
import { colorNew, TransparentBlack, Color } from "../../Color";

const DEFAULT_NUM_SAMPLES = 4;

export class ColorAttachment {
    public gfxColorAttachment: GfxColorAttachment | null = null;
    private width: number = 0;
    private height: number = 0;
    private numSamples: number = 0;

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): boolean {
        if (this.width !== width || this.height !== height || this.numSamples !== numSamples) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.numSamples = numSamples;
            this.gfxColorAttachment = device.createColorAttachment(width, height, numSamples);
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxColorAttachment !== null) {
            device.destroyColorAttachment(this.gfxColorAttachment);
            this.gfxColorAttachment = null;
        }
    }
}

export class DepthStencilAttachment {
    public gfxDepthStencilAttachment: GfxDepthStencilAttachment | null = null;
    private width: number = 0;
    private height: number = 0;
    private numSamples: number = 0;

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): boolean {
        if (this.width !== width || this.height !== height || this.numSamples !== numSamples) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.numSamples = numSamples;
            this.gfxDepthStencilAttachment = device.createDepthStencilAttachment(width, height, numSamples);
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxDepthStencilAttachment !== null) {
            device.destroyDepthStencilAttachment(this.gfxDepthStencilAttachment);
            this.gfxDepthStencilAttachment = null;
        }
    }
}

export class BasicRenderTarget {
    public gfxRenderTarget: GfxRenderTarget | null = null;
    public colorAttachment = new ColorAttachment();
    public depthStencilAttachment = new DepthStencilAttachment();

    public colorClearColor = colorNew(0.88, 0.88, 0.88, 0.0);
    public depthClearValue = 1.0;
    public stencilClearValue = 0.0;

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        const colorChanged = this.colorAttachment.setParameters(device, width, height, numSamples);
        const depthStencilChanged = this.depthStencilAttachment.setParameters(device, width, height, numSamples);
        if (colorChanged || depthStencilChanged) {
            this.destroy(device);
            this.gfxRenderTarget = device.createRenderTarget({
                colorAttachment: this.colorAttachment.gfxColorAttachment,
                depthStencilAttachment: this.depthStencilAttachment.gfxDepthStencilAttachment,
            });
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxRenderTarget !== null) {
            device.destroyRenderTarget(this.gfxRenderTarget);
            this.gfxRenderTarget = null;
        }
    }
}

export function makeClearRenderPassDescriptor(shouldClearColor: boolean, clearColor: Color): GfxRenderPassDescriptor {
    return {
        colorLoadDisposition: shouldClearColor ? GfxLoadDisposition.CLEAR : GfxLoadDisposition.LOAD,
        colorClearColor: clearColor,
        depthClearValue: 1.0,
        depthLoadDisposition: GfxLoadDisposition.CLEAR,
        stencilClearValue: 0.0,
        stencilLoadDisposition: GfxLoadDisposition.CLEAR,
    }
}

export const standardFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(true, colorNew(0.88, 0.88, 0.88, 0.0));
export const depthClearRenderPassDescriptor = makeClearRenderPassDescriptor(false, TransparentBlack);
