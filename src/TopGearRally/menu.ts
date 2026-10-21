import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { CameraController, computeViewMatrix } from "../Camera.js";
import { F3DEX_Program } from "../BanjoKazooie/render.js";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBufferFrequencyHint, GfxCullMode, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import * as UI from "../ui.js";
import { nArray } from "../util.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { RSPSharedOutput, RSPState, runDL_F3DEX } from "./f3dex.js";
import { MODEL_SHADE_COLORS, TGRModel } from "./model.js";
import { GeometryBuffers, LightState, TGRDrawCallInstance, TextureHandle, createGeometryBuffers, createTextureHandle } from "./render.js";
import { SCREEN_FAR, SCREEN_NEAR, ScreenBox, menuProjection, menuView, n64DrawModelAt, reflectionLookAt, screenBox } from "./splash.js";
import { SpriteFormat, SpriteTexture, TGRSprites, TexRectBlend } from "./sprite.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH, TGRText, TextAlign, TextAssets } from "./text.js";

const DEGREES = Math.PI / 180;
const TWO_PI = 6.283185482;
const STAGE_MODEL_SCALE = 0.03125;
const SPOTLIGHT_POINTS = 31;
const SPOTLIGHT_RADIUS = 64;
const DATA_SEGMENT_RAM = 0x8025f000;
const SPOTLIGHT_DISPLAY_LIST = 0x80271db0;
const MARKER_DISPLAY_LIST = 0x80271f28;
const SPOTLIGHT_VERTICES = 0x80315ff0;
const RAM_SIZE = 0x400000;
const FADE_RATE = 0.2;

export const MAIN_MENU_ITEMS: { name: string; offset: number }[] = [
    { name: "Championship", offset: 0x202950 },
    { name: "Arcade", offset: 0x203be0 },
    { name: "Time Attack", offset: 0x204f60 },
    { name: "Practice", offset: 0x205fd0 },
    { name: "Paint Shop", offset: 0x206310 },
    { name: "Load/Save", offset: 0x1f60a0 },
    { name: "Options", offset: 0x207ca0 },
];

export const MENU_TEXTURES = {
    background: { offset: 0x1c07c0, width: 320, height: 240, format: SpriteFormat.I4 },
    title: { offset: 0x0dade0, width: 280, height: 34, format: SpriteFormat.IA16 },
    arrowLeft: { offset: 0x1c77a0, width: 24, height: 24, format: SpriteFormat.RGBA16 },
    arrowRight: { offset: 0x1c79b0, width: 24, height: 24, format: SpriteFormat.RGBA16 },
};

type MenuTextureName = keyof typeof MENU_TEXTURES;

export interface MenuAssets {
    models: ArrayBufferSlice[];
    textures: Record<MenuTextureName, ArrayBufferSlice>;
    dataSegment: ArrayBufferSlice;
    text: TextAssets;
}

const MENU_LIGHTS: LightState = {
    direction: vec3.normalize(vec3.create(), [0x60, 0x60, 0x60]),
    dirColor: [0xff, 0xff, 0xff],
    ambient: [0x40, 0x40, 0x40],
    ramps: MODEL_SHADE_COLORS,
};

const MODEL_LOOK_AT = reflectionLookAt([0, -1, 15], [0, 0, 0], [0, 1, 0]);

interface Stage {
    buffers: GeometryBuffers;
    spotlight: TGRDrawCallInstance[];
    marker: TGRDrawCallInstance[];
    handles: TextureHandle[];
}

export class TGRMenuRenderer implements SceneGfx {
    private readonly renderHelper: GfxRenderHelper;
    private readonly backList = new GfxRenderInstList(null);
    private readonly stageList = new GfxRenderInstList(null);
    private readonly frontList = new GfxRenderInstList(null);
    private readonly backSprites: TGRSprites;
    private readonly frontSprites: TGRSprites;
    private readonly backText: TGRText;
    private readonly frontText: TGRText;
    private readonly models: TGRModel[];
    private readonly textures: Record<MenuTextureName, SpriteTexture>;
    private readonly stage: Stage;
    private readonly view = menuView();
    private cursor = 0;
    private previous = 0;
    private pending = -1;
    private rotation = 4.712388992;
    private slide = 0;
    private fade = 0;
    private select: UI.SingleSelect | null = null;
    private slideDirection = -1;

    public constructor(
        private readonly device: GfxDevice,
        assets: MenuAssets,
    ) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.backSprites = new TGRSprites(device, cache);
        this.frontSprites = new TGRSprites(device, cache);
        this.backText = new TGRText(device, cache, assets.text);
        this.frontText = new TGRText(device, cache, assets.text);
        this.models = assets.models.map((data) => {
            const model = new TGRModel(data);
            model.build(device, cache, false);
            return model;
        });
        const textures = {} as Record<MenuTextureName, SpriteTexture>;
        for (const name of Object.keys(MENU_TEXTURES) as MenuTextureName[]) {
            const t = MENU_TEXTURES[name];
            textures[name] = new SpriteTexture(device, assets.textures[name].createTypedArray(Uint8Array), t.width, t.height, t.format);
        }
        this.textures = textures;
        this.stage = this.buildStage(assets.dataSegment);
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        mat4.invert(dst, this.view);
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(0.05);
    }

    public createPanels(): UI.Panel[] {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.LAYER_ICON, "Main Menu");
        const select = new UI.SingleSelect();
        select.setStrings(MAIN_MENU_ITEMS.map((i) => i.name));
        select.onselectionchange = (index: number) => {
            if (index !== this.cursor) {
                this.pending = index;
            }
        };
        select.selectItem(0);
        this.select = select;
        panel.contents.appendChild(select.elem);
        return [panel];
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const deltaSeconds = viewerInput.deltaTime / 1000;
        this.update(deltaSeconds);
        const box = screenBox(viewerInput);
        const clear = makeAttachmentClearDescriptor({ r: 0, g: 0, b: 0, a: 1 });
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const colorID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, clear), "Main Color");
        const depthID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, clear), "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Menu");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, colorID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, depthID);
            pass.exec((passRenderer) => {
                const cache = this.renderHelper.renderCache;
                const right = Math.round(box.x + ((Math.trunc(SCREEN_WIDTH * this.fade) + 3) & ~3) * (box.width / SCREEN_WIDTH));
                passRenderer.setScissor(0, 0, Math.max(0, Math.min(right, viewerInput.backbufferWidth)), viewerInput.backbufferHeight);
                this.backList.drawOnPassRenderer(cache, passRenderer);
                this.stageList.drawOnPassRenderer(cache, passRenderer);
                this.frontList.drawOnPassRenderer(cache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, colorID);
        builder.resolveRenderTargetToExternalTexture(colorID, viewerInput.onscreenTexture);
        this.prepare(viewerInput, box);
        builder.execute();
        this.backList.reset();
        this.stageList.reset();
        this.frontList.reset();
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.models) {
            model.destroy(device);
        }
        for (const texture of Object.values(this.textures)) {
            texture.destroy(device);
        }
        device.destroyBuffer(this.stage.buffers.vertexBuffer);
        device.destroyBuffer(this.stage.buffers.indexBuffer);
        for (const handle of this.stage.handles) {
            device.destroyTexture(handle.gfxTexture);
        }
        this.backSprites.destroy(device);
        this.frontSprites.destroy(device);
        this.backText.destroy(device);
        this.frontText.destroy(device);
        this.renderHelper.destroy();
    }

    private buildStage(dataSegment: ArrayBufferSlice): Stage {
        const ram = new Uint8Array(RAM_SIZE);
        ram.set(dataSegment.createTypedArray(Uint8Array), DATA_SEGMENT_RAM & 0xffffff);
        const view = new DataView(ram.buffer);
        const base = SPOTLIGHT_VERTICES & 0xffffff;
        for (let i = 0; i < SPOTLIGHT_POINTS; i++) {
            const angle = i * 0.2094395161;
            const o = base + i * 0x10;
            view.setInt16(o, Math.trunc(Math.sin(angle) * SPOTLIGHT_RADIUS) + SCREEN_WIDTH / 2);
            view.setInt16(o + 2, (SCREEN_HEIGHT * 6) / 16);
            view.setInt16(o + 4, Math.trunc(Math.cos(angle) * SPOTLIGHT_RADIUS));
            view.setUint32(o + 0x0c, 0xffffffff);
        }
        view.setInt16(base, SCREEN_WIDTH / 2);
        view.setInt16(base + 2, (SCREEN_HEIGHT * 5) / 16);
        view.setInt16(base + 4, 0);
        const slice = new ArrayBufferSlice(ram.buffer);
        const sharedOutput = new RSPSharedOutput();
        const rsp = new RSPState(nArray(256, () => slice), sharedOutput);
        rsp.gSPTexture(false, 0, 0, 0xffff, 0xffff);
        const spotlightStart = rsp.drawCalls.length;
        runDL_F3DEX(rsp, SPOTLIGHT_DISPLAY_LIST);
        const markerStart = rsp.drawCalls.length;
        rsp.markStateChanged();
        runDL_F3DEX(rsp, MARKER_DISPLAY_LIST);
        const cache = this.renderHelper.renderCache;
        const buffers = createGeometryBuffers(this.device, cache, sharedOutput, GfxBufferFrequencyHint.Static);
        const handleMap = new Map<string, TextureHandle>();
        const instances = (start: number, end: number): TGRDrawCallInstance[] =>
            rsp.drawCalls
                .slice(start, end)
                .filter((dc) => dc.indexCount > 0)
                .map(
                    (dc) =>
                        new TGRDrawCallInstance(
                            dc,
                            dc.textures.map((levels, slot) => createTextureHandle(this.device, cache, sharedOutput, handleMap, levels, dc.tiles[slot])),
                            sharedOutput,
                            false,
                        ),
                );
        return {
            buffers,
            spotlight: instances(spotlightStart, markerStart),
            marker: instances(markerStart, rsp.drawCalls.length),
            handles: [...handleMap.values()],
        };
    }

    private update(deltaSeconds: number): void {
        const input = window.main.viewer.inputManager;
        if (this.slide === 0 && this.pending < 0) {
            const count = MAIN_MENU_ITEMS.length;
            if (input.isKeyDownEventTriggered("BracketLeft")) {
                this.select?.selectItem((this.cursor + count - 1) % count);
                this.pending = (this.cursor + count - 1) % count;
                this.slideDirection = 1;
            } else if (input.isKeyDownEventTriggered("BracketRight")) {
                this.select?.selectItem((this.cursor + 1) % count);
                this.pending = (this.cursor + 1) % count;
                this.slideDirection = -1;
            }
        }
        if (this.fade < 1) {
            this.fade = Math.min(1, this.fade + deltaSeconds / FADE_RATE);
        }
        if (this.pending >= 0) {
            this.previous = this.cursor;
            this.cursor = this.pending;
            if (this.cursor !== this.previous) {
                this.slide = this.slideDirection;
            }
            this.slideDirection = -1;
            this.pending = -1;
        }
        const step = deltaSeconds + deltaSeconds;
        this.rotation += step;
        while (TWO_PI < this.rotation) {
            this.rotation -= TWO_PI;
        }
        if (this.slide < 0) {
            this.slide = Math.min(0, this.slide + step);
        } else if (this.slide > 0) {
            this.slide = Math.max(0, this.slide - step);
        }
    }

    private prepare(viewerInput: ViewerRenderInput, box: ScreenBox): void {
        const { renderInstManager } = this.renderHelper;
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 3, numSamplers: 2 }]);
        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16 + 8);
        const scene = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(scene, offs, menuProjection(viewerInput, box, SCREEN_NEAR, SCREEN_FAR));
        const view = mat4.create();
        computeViewMatrix(view, viewerInput.camera);
        for (const axis of MODEL_LOOK_AT) {
            const v = vec3.transformMat4(vec3.create(), axis, view);
            vec3.sub(v, v, [view[12], view[13], view[14]]);
            offs += fillVec4(scene, offs, v[0], v[1], v[2], 0);
        }

        const n = box.normalized;
        this.backSprites.reset();
        this.frontSprites.reset();
        this.backText.reset();
        this.frontText.reset();
        this.backSprites.draw(this.textures.background, 0, 0, 320, 240, [0, 0, 0, 0xff], [0x40, 0x40, 0x40, 0xff], TexRectBlend.ShadedOpaque, n);
        this.backSprites.draw(this.textures.title, 25, 14, 280, 32, [0, 0, 0, 0xff], [0xff, 0xff, 0xff, 0xff], TexRectBlend.Texture2, n);
        this.backText.custom = null;
        this.backText.bold = false;
        this.backText.size = 30;
        this.backText.align = TextAlign.Center;
        this.backText.draw("%ryTOP GEAR RALLY", SCREEN_WIDTH / 2, SCREEN_HEIGHT / 6 - 2, n);

        renderInstManager.setCurrentList(this.stageList);
        const stack = mat4.fromRotation(mat4.create(), 12 * DEGREES, [1, 0, 0]);
        const stageTemplate = renderInstManager.pushTemplate();
        stageTemplate.setVertexInput(this.stage.buffers.inputLayout, [{ buffer: this.stage.buffers.vertexBuffer }], { buffer: this.stage.buffers.indexBuffer });
        const flat = { lights: MENU_LIGHTS, ramp: -1, nightLit: false, fog: null, env: null, cullMode: GfxCullMode.None };
        for (const dci of this.stage.spotlight) {
            dci.prepareToRender(renderInstManager, viewerInput, { ...flat, model: stack });
        }
        const marker = n64DrawModelAt(stack, SCREEN_WIDTH / 2, (SCREEN_HEIGHT * 6) / 16 - 4, 0, 0, 0.26);
        for (const dci of this.stage.marker) {
            dci.prepareToRender(renderInstManager, viewerInput, { ...flat, model: marker });
        }
        renderInstManager.popTemplate();

        const ease = this.slide < 0 ? this.slide * this.slide * -5 : this.slide * this.slide * 5;
        const drawItem = (index: number, offset: number): void => {
            const model = this.models[index];
            model.advanceAnimations(viewerInput.deltaTime / 1000);
            const x = SCREEN_WIDTH / 2 - (offset * SCREEN_WIDTH) / 6;
            model.prepareToRender(
                this.device,
                renderInstManager,
                viewerInput,
                undefined,
                n64DrawModelAt(stack, x, (SCREEN_HEIGHT * 6) / 16, 0, this.rotation, STAGE_MODEL_SCALE),
                MENU_LIGHTS,
            );
        };
        this.frontText.custom = null;
        this.frontText.bold = false;
        this.frontText.align = TextAlign.Center;
        if (ease !== 0) {
            drawItem(this.cursor, ease);
            drawItem(this.previous, (ease < 0 ? 5 : -5) + ease);
        } else {
            drawItem(this.cursor, 0);
            this.frontText.size = 20;
            this.frontText.draw(`%ry${MAIN_MENU_ITEMS[this.cursor].name}`, SCREEN_WIDTH / 2, (SCREEN_HEIGHT * 20) / 64, n);
        }

        this.frontSprites.draw(this.textures.arrowLeft, 100, 216, 12, 12, [0, 0, 0, 0xff], [0, 0, 0, 0xff], TexRectBlend.Texture, n);
        this.frontSprites.draw(this.textures.arrowRight, 160, 216, 12, 12, [0, 0, 0, 0xff], [0, 0, 0, 0xff], TexRectBlend.Texture, n);
        this.frontText.align = TextAlign.Left;
        this.frontText.size = 11;
        this.frontText.draw("%wwSelect", 115, (SCREEN_HEIGHT * 19) / 20 - 3, n);
        this.frontText.draw("%wwGo Back", 175, (SCREEN_HEIGHT * 19) / 20 - 3, n);

        renderInstManager.setCurrentList(this.backList);
        this.backSprites.prepareToRender(renderInstManager);
        this.backText.prepareToRender(renderInstManager);
        renderInstManager.setCurrentList(this.frontList);
        this.frontSprites.prepareToRender(renderInstManager);
        this.frontText.prepareToRender(renderInstManager);
        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }
}
