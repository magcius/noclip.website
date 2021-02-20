
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { GfxRenderInstManager, GfxRenderInst } from "./GfxRenderer";
import { GfxDevice } from "../platform/GfxPlatform";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxrRenderGraph, GfxrRenderGraphImpl } from "./GfxRenderGraph";

// Experiments in building a common-esque scene graph.

export class GfxRenderHelper {
    public uniformBuffer: GfxRenderDynamicUniformBuffer;
    public renderInstManager = new GfxRenderInstManager();
    public renderGraph: GfxrRenderGraph = new GfxrRenderGraphImpl();

    constructor(device: GfxDevice) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        return template;
    }

    public prepareToRender(device: GfxDevice): void {
        this.uniformBuffer.prepareToRender(device);
    }

    public destroy(device: GfxDevice): void {
        this.uniformBuffer.destroy(device);
        this.renderInstManager.destroy(device);
        this.renderGraph.destroy(device);
    }

    public getCache(): GfxRenderCache {
        return this.renderInstManager.gfxRenderCache;
    }
}
