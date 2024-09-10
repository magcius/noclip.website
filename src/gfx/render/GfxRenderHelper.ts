
import { GfxDevice } from "../platform/GfxPlatform.js";
import { GfxRenderCache } from "./GfxRenderCache.js";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer.js";
import { GfxRenderInst, GfxRenderInstManager } from "./GfxRenderInstManager.js";
import { GfxrRenderGraph, GfxrRenderGraphImpl } from "./GfxRenderGraph.js";
import { DebugThumbnailDrawer, TextDrawer } from "../helpers/DebugThumbnailHelpers.js";
import { DebugDraw } from "../helpers/DebugDraw.js";
import { AntialiasingSupport } from "../helpers/RenderGraphHelpers.js";

class GfxRenderHelperBase {
    public renderCache: GfxRenderCache;
    public renderGraph: GfxrRenderGraph;
    public renderInstManager: GfxRenderInstManager;
    public uniformBuffer: GfxRenderDynamicUniformBuffer;
    public debugThumbnails: DebugThumbnailDrawer;
    public debugDraw: DebugDraw;
    public antialiasingSupport: AntialiasingSupport;

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
        this.debugDraw = new DebugDraw(this.renderCache, this.uniformBuffer);
        this.debugThumbnails = new DebugThumbnailDrawer(this as unknown as GfxRenderHelper);
        this.antialiasingSupport = new AntialiasingSupport(this as unknown as GfxRenderHelper);
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const template = this.renderInstManager.pushTemplate();
        template.setUniformBuffer(this.uniformBuffer);
        return template;
    }

    public prepareToRender(): void {
        this.renderCache.prepareToRender();
        this.uniformBuffer.prepareToRender();
    }

    public destroy(): void {
        if (this.renderCacheOwn !== null)
            this.renderCacheOwn.destroy();
        this.uniformBuffer.destroy();
        this.renderGraph.destroy();
        this.debugDraw.destroy();
    }

    public getDebugTextDrawer(): TextDrawer | null {
        return null;
    }
}

// Debug Thumbnails
import { SceneContext } from "../../SceneBase.js";
import type { DebugTextDrawer } from "../helpers/DebugTextDrawer.js";

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
            const { makeDebugTextDrawer } = await import('../helpers/DebugTextDrawer.js');
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
