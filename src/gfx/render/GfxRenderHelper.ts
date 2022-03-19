
import { GfxDevice } from "../platform/GfxPlatform";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { GfxRenderInst, GfxRenderInstManager } from "./GfxRenderInstManager";
import { GfxrRenderGraph, GfxrRenderGraphImpl } from "./GfxRenderGraph";
import { DebugThumbnailDrawer, TextDrawer } from "../helpers/DebugThumbnailHelpers";

class GfxRenderHelperBase {
    public renderCache: GfxRenderCache;
    public renderGraph: GfxrRenderGraph;
    public renderInstManager: GfxRenderInstManager;
    public uniformBuffer: GfxRenderDynamicUniformBuffer;
    public debugThumbnails: DebugThumbnailDrawer;

    private renderCacheOwn: GfxRenderCache | null = null;

    constructor(public device: GfxDevice, renderCache: GfxRenderCache | null = null) {
        if (renderCache === null) {
            this.renderCacheOwn = new GfxRenderCache(device);
            this.renderCache = this.renderCacheOwn;
        } else {
            this.renderCache = renderCache;
        }

        this.renderGraph = new GfxrRenderGraphImpl(this.device);
        this.renderInstManager = new GfxRenderInstManager(this.renderCache);
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(this.device);
        this.debugThumbnails = new DebugThumbnailDrawer(this as unknown as GfxRenderHelper);
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
        if (this.renderCacheOwn !== null)
            this.renderCacheOwn.destroy();
        this.uniformBuffer.destroy();
        this.renderInstManager.destroy();
        this.renderGraph.destroy();
    }

    public getDebugTextDrawer(): TextDrawer | null {
        return null;
    }

    public getCache(): GfxRenderCache {
        return this.renderCache;
    }
}

// Debug Thumbnails
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

export class GfxRenderHelper extends GfxRenderHelperBase {
    private debugTextDrawer: PromiseWithSavedValue<DebugTextDrawer | null>;

    constructor(device: GfxDevice, context: SceneContext | null = null, renderCache: GfxRenderCache | null = null) {
        super(device, renderCache);
        this.debugTextDrawer = new PromiseWithSavedValue<DebugTextDrawer | null>(async () => {
            const { makeDebugTextDrawer } = await import('../helpers/DebugTextDrawer');
            return context !== null ? makeDebugTextDrawer(context) : null;
        });
    }

    public override getDebugTextDrawer(): TextDrawer | null {
        return this.debugTextDrawer.getValueOrStart();
    }

    public override destroy(): void {
        super.destroy();
        this.debugThumbnails.destroy();
    }
}
