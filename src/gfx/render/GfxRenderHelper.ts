
import { GfxDevice } from "../platform/GfxPlatform";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { GfxRenderInst, GfxRenderInstManager } from "./GfxRenderInstManager";
import { GfxrRenderGraph, GfxrRenderGraphImpl } from "./GfxRenderGraph";
import { DebugThumbnailDrawer } from "../helpers/DebugThumbnailHelpers";
import { SceneContext } from "../../SceneBase";
import type { DebugTextDrawer } from "../helpers/DebugTextDrawer";

class PromiseWithSavedValue<T> {
    public value: T | null = null;
    private completed: boolean = false;
    private promise: Promise<T> | null = null;

    constructor(private func: () => Promise<T>) {
    }

    public getValueOrStart(): T | null {
        if (this.completed)
            return this.value;

        if (this.promise === null) {
            this.promise = this.func();
            this.promise.then((value) => {
                this.value = value;
                this.promise = null;
                this.completed = true;
            });
        }

        return null;
    }
}

export class GfxRenderHelper {
    public renderCache: GfxRenderCache;
    public renderGraph: GfxrRenderGraph;
    public renderInstManager: GfxRenderInstManager;
    public uniformBuffer: GfxRenderDynamicUniformBuffer;

    public debugThumbnails: DebugThumbnailDrawer;
    private debugTextDrawer: PromiseWithSavedValue<DebugTextDrawer | null>;

    constructor(public device: GfxDevice, context: SceneContext | null = null, renderCache: GfxRenderCache | null = null) {
        this.renderCache = renderCache !== null ? renderCache : new GfxRenderCache(device);
        this.renderGraph = new GfxrRenderGraphImpl(this.device);
        this.renderInstManager = new GfxRenderInstManager(this.device, this.renderCache);
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(this.device);

        this.debugThumbnails = new DebugThumbnailDrawer(this);
        this.debugTextDrawer = new PromiseWithSavedValue<DebugTextDrawer | null>(async () => {
            const { makeDebugTextDrawer } = await import('../helpers/DebugTextDrawer');
            return context !== null ? makeDebugTextDrawer(context) : null;
        });
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        return template;
    }

    public prepareToRender(): void {
        this.uniformBuffer.prepareToRender();
    }

    public destroy(): void {
        this.uniformBuffer.destroy();
        this.renderInstManager.destroy(this.device);
        this.renderCache.destroy(this.device);
        this.renderGraph.destroy();
        this.debugThumbnails.destroy();
    }

    public getCache(): GfxRenderCache {
        return this.renderCache;
    }

    public getDebugTextDrawer(): DebugTextDrawer | null {
        return this.debugTextDrawer.getValueOrStart();
    }
}
