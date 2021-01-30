
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { GfxRenderInstManager, GfxRenderInst } from "./GfxRenderer";
import { GfxDevice, GfxHostAccessPass } from "../platform/GfxPlatform";
import { GfxRenderCache } from "./GfxRenderCache";

// Experiments in building a common-esque scene graph.

export class GfxRenderHelper {
    public uniformBuffer: GfxRenderDynamicUniformBuffer;
    public renderInstManager = new GfxRenderInstManager();

    constructor(device: GfxDevice) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        return template;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass): void {
        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.uniformBuffer.destroy(device);
        this.renderInstManager.destroy(device);
    }

    public getCache(): GfxRenderCache {
        return this.renderInstManager.gfxRenderCache;
    }
}
