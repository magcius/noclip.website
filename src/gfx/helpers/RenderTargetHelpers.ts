
import { GfxRenderTarget, GfxColorAttachment, GfxDevice, GfxDepthStencilAttachment, GfxLoadDisposition, GfxRenderPassDescriptor, GfxFormat, GfxTexture } from "../platform/GfxPlatform";
import { colorNew, TransparentBlack, Color } from "../../Color";

export const DEFAULT_NUM_SAMPLES = 4;

export class ColorTexture {
    public gfxTexture: GfxTexture | null = null;
    private width: number = 0;
    private height: number = 0;

    public setParameters(device: GfxDevice, width: number, height: number): boolean {
        if (this.width !== width || this.height !== height) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.gfxTexture = device.createTexture(GfxFormat.U8_RGBA, width, height, 1);
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

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        const colorChanged = this.colorAttachment.setParameters(device, width, height, numSamples);
        const depthStencilChanged = this.depthStencilAttachment.setParameters(device, width, height, numSamples);
        if (colorChanged || depthStencilChanged) {
            this.destroyInternal(device);
            this.gfxRenderTarget = device.createRenderTarget({
                colorAttachment: this.colorAttachment.gfxColorAttachment,
                depthStencilAttachment: this.depthStencilAttachment.gfxDepthStencilAttachment,
            });
        }
    }

    private destroyInternal(device: GfxDevice): void {
        if (this.gfxRenderTarget !== null) {
            device.destroyRenderTarget(this.gfxRenderTarget);
            this.gfxRenderTarget = null;
        }
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
        this.depthStencilAttachment.destroy(device);
    }
}

// No depth buffer, designed for postprocessing.
export class PostFXRenderTarget {
    public gfxRenderTarget: GfxRenderTarget | null = null;
    public colorAttachment = new ColorAttachment();

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        const colorChanged = this.colorAttachment.setParameters(device, width, height, numSamples);
        if (colorChanged) {
            this.destroyInternal(device);
            this.gfxRenderTarget = device.createRenderTarget({
                colorAttachment: this.colorAttachment.gfxColorAttachment,
                depthStencilAttachment: null,
            });
        }
    }

    private destroyInternal(device: GfxDevice): void {
        if (this.gfxRenderTarget !== null) {
            device.destroyRenderTarget(this.gfxRenderTarget);
            this.gfxRenderTarget = null;
        }
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
    }
}

export function makeClearRenderPassDescriptor(shouldClearColor: boolean, clearColor: Color): GfxRenderPassDescriptor {
    return {
        colorClearColor: clearColor,
        colorLoadDisposition: shouldClearColor ? GfxLoadDisposition.CLEAR : GfxLoadDisposition.LOAD,
        depthClearValue: 1.0,
        depthLoadDisposition: GfxLoadDisposition.CLEAR,
        stencilClearValue: 0.0,
        stencilLoadDisposition: GfxLoadDisposition.CLEAR,
    }
}

export const standardFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(true, colorNew(0.88, 0.88, 0.88, 0.0));
export const transparentBlackFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(true, TransparentBlack);
export const depthClearRenderPassDescriptor = makeClearRenderPassDescriptor(false, TransparentBlack);
export const noClearRenderPassDescriptor = {
    colorClearColor: TransparentBlack,
    colorLoadDisposition: GfxLoadDisposition.LOAD,
    depthClearValue: 1.0,
    depthLoadDisposition: GfxLoadDisposition.LOAD,
    stencilClearValue: 0.0,
    stencilLoadDisposition: GfxLoadDisposition.LOAD,
};
