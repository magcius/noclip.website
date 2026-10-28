import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Camera, CameraController, computeViewMatrix } from "../Camera.js";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxDevice, GfxViewportOrigin } from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { F3DEX_Program } from "../BanjoKazooie/render.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { MODEL_SHADE_COLORS, TGRModel } from "./model.js";
import { LightState } from "./render.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH, TGRText, TextAlign, TextAssets } from "./text.js";

const HALF_PI = 1.570796371;
const PI = 3.141592741;
const DEGREES = Math.PI / 180;
const FADE_TIME = 0.2;
const FIRST_LOGO_START = 0.0;
const PRODUCER_LOGO_START = 4.0;
const DEVELOPER_LOGO_START = 8.0;
const LOGO_LANDED_TIME = 2.0;
const LOGO_LEAVE_TIME = 3.5;
const LOGO_END_TIME = 6.0;
const DEVELOPER_LOGO_END_TIME = 5.0;
const LOGO_DEPTH = -50.0;
const LOGO_SCALE = 0.03125;
const TEXT_ALPHA = 200;
const TEXT_FADE_RATE = 4.0;
const TITLE_START = 12.0;
const TITLE_A_END = 15.0;
const TITLE_B_START = 13.0;
const TITLE_B_END = 15.0;
const TITLE_C_START = 15.2;
const TITLE_C_END = 16.2;
const TITLE_D_START = 15.0;
const TITLE_D_END = 16.0;
const COPYRIGHT_START = 17.2;
const SPLASH_END_TIME = 24.2;
const MENU_CENTER_X = 160;
const MENU_CENTER_Y = 120;
const MENU_DISTANCE = 290;
const SCREEN_FOV = 45;
export const SCREEN_NEAR = 10;
export const SCREEN_FAR = 2000;

export const SPLASH_MODEL_OFFSETS = {
    firstLogo: 0x1da030,
    producerLogo: 0x1dba40,
    developerLogo: 0x1dcd70,
    titleA: 0x1e09f0,
    titleB: 0x1e3db0,
    titleC: 0x1e2b40,
    titleD: 0x1e1ca0,
};

type SplashModelName = keyof typeof SPLASH_MODEL_OFFSETS;

function lights(direction: number[]): LightState {
    return {
        direction: vec3.normalize(vec3.create(), direction as [number, number, number]),
        dirColor: [0xff, 0xff, 0xff],
        ambient: [0x40, 0x40, 0x40],
        ramps: MODEL_SHADE_COLORS,
    };
}

const SPLASH_LIGHTS = lights([0x40, 0x40, 0x70]);
const MENU_LIGHTS = lights([0x60, 0x60, 0x60]);

export function reflectionLookAt(eye: number[], at: number[], up: number[]): [vec3, vec3] {
    const look = vec3.normalize(vec3.create(), [eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
    const right = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), up as [number, number, number], look));
    const newUp = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), look, right));
    return [right, newUp];
}

const MODEL_LOOK_AT = reflectionLookAt([0, -1, 15], [0, 0, 0], [0, 1, 0]);

export function n64DrawModelAt(base: mat4, x: number, y: number, z: number, angle: number, scale: number): mat4 {
    const m = mat4.clone(base);
    mat4.translate(m, m, [x, y, z]);
    mat4.rotateX(m, m, -90 * DEGREES);
    mat4.scale(m, m, [scale, scale, scale]);
    mat4.rotateZ(m, m, angle);
    return m;
}

export interface ScreenBox {
    x: number;
    y: number;
    width: number;
    height: number;
    normalized: number[];
}

export function screenBox(viewerInput: ViewerRenderInput): ScreenBox {
    const viewW = viewerInput.backbufferWidth;
    const viewH = viewerInput.backbufferHeight;
    const height = Math.min(viewH, (viewW * 3) / 4);
    const width = (height * 4) / 3;
    const x = (viewW - width) / 2;
    const y = (viewH - height) / 2;
    return { x, y, width, height, normalized: [x / viewW, y / viewH, width / viewW, height / viewH] };
}

export function menuProjection(viewerInput: ViewerRenderInput, box: ScreenBox, near: number, far: number): mat4 {
    const camera = new Camera();
    camera.clipSpaceNearZ = viewerInput.camera.clipSpaceNearZ;
    const tanHalf = Math.tan((SCREEN_FOV * DEGREES) / 2) * (viewerInput.backbufferHeight / box.height);
    camera.setPerspective(2 * Math.atan(tanHalf), viewerInput.backbufferWidth / viewerInput.backbufferHeight, near, far);
    return camera.projectionMatrix;
}

export function menuView(): mat4 {
    return mat4.lookAt(mat4.create(), [MENU_CENTER_X, MENU_CENTER_Y, MENU_DISTANCE], [MENU_CENTER_X, MENU_CENTER_Y, 0], [0, 1, 0]);
}

class Fade {
    public level = 0;
    public target = 1;
    public rate = 1 / FADE_TIME;
    public left = 0;
    public right = 0;
    private skipFrame = true;

    public setTarget(target: number, seconds: number): void {
        this.skipFrame = true;
        if (target < this.level || target === 0) {
            this.rate = -1 / seconds;
            this.target = target;
            return;
        }
        this.target = target;
        this.rate = 1 / seconds;
    }

    public update(deltaSeconds: number): void {
        if (this.skipFrame) {
            this.skipFrame = false;
        } else if (this.target !== this.level) {
            this.level += this.rate * deltaSeconds;
            if (this.rate < 0 ? this.level < this.target : this.target <= this.level) {
                this.level = this.target;
            }
        }
        if (this.rate > 0) {
            this.left = 0;
            this.right = (Math.trunc(SCREEN_WIDTH * this.level) + 3) & ~3;
        } else if (this.rate < 0) {
            const move = (SCREEN_WIDTH - Math.trunc(SCREEN_WIDTH * this.level) - this.left + 3) & ~3;
            this.left += move;
            this.right = Math.min(this.right + move, SCREEN_WIDTH);
        } else {
            this.left = 0;
            this.right = SCREEN_WIDTH;
        }
    }

    public isFadingIn(): boolean {
        return this.rate > 0;
    }

    public isComplete(): boolean {
        return this.level === this.target;
    }
}

interface Scissor {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class TGRSplashRenderer implements SceneGfx {
    private readonly renderHelper: GfxRenderHelper;
    private readonly captionList = new GfxRenderInstList(null);
    private readonly modelList = new GfxRenderInstList(null);
    private readonly titleAList = new GfxRenderInstList(null);
    private readonly titleList = new GfxRenderInstList(null);
    private readonly copyrightList = new GfxRenderInstList(null);
    private readonly captions: TGRText;
    private readonly copyright: TGRText;
    private models: Record<SplashModelName, TGRModel>;
    private time = 0;
    private fade = new Fade();
    private fadingOut = false;
    private readonly view = menuView();

    public constructor(
        private readonly device: GfxDevice,
        private readonly modelData: Record<SplashModelName, ArrayBufferSlice>,
        textAssets: TextAssets,
    ) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.captions = new TGRText(device, cache, textAssets);
        this.copyright = new TGRText(device, cache, textAssets);
        this.models = this.loadModels();
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        mat4.invert(dst, this.view);
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(0.05);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const deltaSeconds = viewerInput.deltaTime / 1000;
        this.fade.update(deltaSeconds);
        if (!this.fade.isFadingIn() || this.fade.isComplete()) {
            this.time += deltaSeconds;
        }
        for (const name of ["developerLogo", "titleA", "titleB"] as SplashModelName[]) {
            this.models[name].advanceAnimations(deltaSeconds);
        }

        const box = screenBox(viewerInput);
        const clear = makeAttachmentClearDescriptor({ r: 0, g: 0, b: 0, a: 1 });
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const colorID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, clear), "Main Color");
        const depthID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, clear), "Main Depth");
        const fadeScissor = this.scissorFor(viewerInput, box, this.fade.left, 0, this.fade.right - this.fade.left, SCREEN_HEIGHT);
        const titleScissor = this.time > TITLE_A_END ? this.intersect(fadeScissor, this.scissorFor(viewerInput, box, 40, 100, 250, 50)) : fadeScissor;
        builder.pushPass((pass) => {
            pass.setDebugName("Splash");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, colorID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, depthID);
            pass.exec((passRenderer) => {
                const cache = this.renderHelper.renderCache;
                passRenderer.setScissor(fadeScissor.x, fadeScissor.y, fadeScissor.width, fadeScissor.height);
                this.captionList.drawOnPassRenderer(cache, passRenderer);
                this.modelList.drawOnPassRenderer(cache, passRenderer);
                passRenderer.setScissor(titleScissor.x, titleScissor.y, titleScissor.width, titleScissor.height);
                this.titleAList.drawOnPassRenderer(cache, passRenderer);
                passRenderer.setScissor(fadeScissor.x, fadeScissor.y, fadeScissor.width, fadeScissor.height);
                this.titleList.drawOnPassRenderer(cache, passRenderer);
                this.copyrightList.drawOnPassRenderer(cache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, colorID);
        builder.resolveRenderTargetToExternalTexture(colorID, viewerInput.onscreenTexture);

        this.prepare(viewerInput, box);
        builder.execute();
        for (const list of [this.captionList, this.modelList, this.titleAList, this.titleList, this.copyrightList]) {
            list.reset();
        }
        this.updateExit();
    }

    public destroy(device: GfxDevice): void {
        for (const model of Object.values(this.models)) {
            model.destroy(device);
        }
        this.captions.destroy(device);
        this.copyright.destroy(device);
        this.renderHelper.destroy();
    }

    private loadModels(): Record<SplashModelName, TGRModel> {
        const cache = this.renderHelper.renderCache;
        const models = {} as Record<SplashModelName, TGRModel>;
        for (const name of Object.keys(SPLASH_MODEL_OFFSETS) as SplashModelName[]) {
            const model = new TGRModel(this.modelData[name]);
            if (name.startsWith("title")) {
                model.loopAnimations();
            }
            model.build(this.device, cache, name === "titleA" || name === "titleB");
            models[name] = model;
        }
        return models;
    }

    private scissorFor(viewerInput: ViewerRenderInput, box: ScreenBox, x: number, y: number, width: number, height: number): Scissor {
        const sx = box.width / SCREEN_WIDTH;
        const sy = box.height / SCREEN_HEIGHT;
        const px = Math.round(box.x + x * sx);
        const pw = Math.max(0, Math.round(width * sx));
        const ph = Math.max(0, Math.round(height * sy));
        let py = Math.round(box.y + y * sy);
        if (this.device.queryVendorInfo().viewportOrigin === GfxViewportOrigin.LowerLeft) {
            py = viewerInput.backbufferHeight - py - ph;
        }
        return { x: px, y: py, width: pw, height: ph };
    }

    private intersect(a: Scissor, b: Scissor): Scissor {
        const x = Math.max(a.x, b.x);
        const y = Math.max(a.y, b.y);
        const right = Math.min(a.x + a.width, b.x + b.width);
        const top = Math.min(a.y + a.height, b.y + b.height);
        return { x, y, width: Math.max(0, right - x), height: Math.max(0, top - y) };
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

        const base = mat4.fromTranslation(mat4.create(), [SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 100]);
        this.captions.reset();
        this.copyright.reset();
        renderInstManager.setCurrentList(this.modelList);
        if (this.time >= FIRST_LOGO_START) {
            this.drawLogo(viewerInput, base, "firstLogo", FIRST_LOGO_START, LOGO_END_TIME);
        }
        if (this.time >= PRODUCER_LOGO_START) {
            this.drawCaption("Produced by", PRODUCER_LOGO_START, 70, box);
            this.drawLogo(viewerInput, base, "producerLogo", PRODUCER_LOGO_START, LOGO_END_TIME);
        }
        if (this.time >= DEVELOPER_LOGO_START) {
            this.drawCaption("Developed by", DEVELOPER_LOGO_START, 60, box);
            this.drawLogo(viewerInput, base, "developerLogo", DEVELOPER_LOGO_START, DEVELOPER_LOGO_END_TIME);
        }
        this.drawTitle(viewerInput, base);
        this.drawCopyright(box);
        renderInstManager.setCurrentList(this.captionList);
        this.captions.prepareToRender(renderInstManager);
        renderInstManager.setCurrentList(this.copyrightList);
        this.copyright.prepareToRender(renderInstManager);
        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    private drawModel(viewerInput: ViewerRenderInput, name: SplashModelName, model: mat4, light: LightState): void {
        this.models[name].prepareToRender(this.device, this.renderHelper.renderInstManager, viewerInput, undefined, model, light);
    }

    private drawLogo(viewerInput: ViewerRenderInput, base: mat4, name: SplashModelName, start: number, end: number): void {
        const t = this.time;
        if (t < start + LOGO_LANDED_TIME) {
            const left = start + LOGO_LANDED_TIME - t;
            const since = t - start;
            const angle = since * HALF_PI * since * since * since * 0.0625 + -PI;
            this.drawModel(viewerInput, name, n64DrawModelAt(base, -left * 32, 0, LOGO_DEPTH - left * 750, angle, LOGO_SCALE), SPLASH_LIGHTS);
            return;
        }
        if (t >= start + end) {
            return;
        }
        let x = 0;
        if (t > start + LOGO_LEAVE_TIME) {
            const since = t - (start + LOGO_LEAVE_TIME);
            x = since * since * 256;
        }
        this.drawModel(viewerInput, name, n64DrawModelAt(base, x, 0, LOGO_DEPTH, -HALF_PI, LOGO_SCALE), SPLASH_LIGHTS);
    }

    private drawCaption(text: string, start: number, y: number, box: ScreenBox): void {
        const t = this.time;
        let alpha = TEXT_ALPHA;
        if (t < start + LOGO_LANDED_TIME) {
            alpha = TEXT_ALPHA - Math.trunc((start + LOGO_LANDED_TIME - t) * 255 * TEXT_FADE_RATE);
        } else if (t > start + LOGO_LEAVE_TIME) {
            alpha = TEXT_ALPHA - Math.trunc((t - (start + LOGO_LEAVE_TIME)) * 255 * TEXT_FADE_RATE);
        }
        if (alpha > 0) {
            this.captions.custom = [alpha, alpha, alpha, alpha, alpha, alpha];
            this.captions.bold = false;
            this.captions.size = 10;
            this.captions.align = TextAlign.Center;
            this.captions.draw(text, 160, y, box.normalized);
        }
    }

    private titleDepth(start: number, end: number, speed: number): number {
        return this.time < end ? (Math.sqrt(end - start) - Math.sqrt(this.time - start)) * speed : 0;
    }

    private drawTitle(viewerInput: ViewerRenderInput, base: mat4): void {
        const { renderInstManager } = this.renderHelper;
        const t = this.time;
        if (t > TITLE_START) {
            renderInstManager.setCurrentList(this.titleAList);
            const tilted = mat4.clone(base);
            mat4.rotateZ(tilted, tilted, 7 * DEGREES);
            mat4.rotateX(tilted, tilted, -7 * DEGREES);
            const z = t < TITLE_A_END ? (Math.sqrt(TITLE_A_END - TITLE_START) - Math.sqrt(t - TITLE_START)) * 300 : -0;
            this.drawModel(viewerInput, "titleA", n64DrawModelAt(tilted, 0, 0, z, Math.sqrt(t - TITLE_START) * 0.01 + -HALF_PI, 0.05), MENU_LIGHTS);
        }
        renderInstManager.setCurrentList(this.titleList);
        if (t > TITLE_B_START) {
            this.drawModel(viewerInput, "titleB", n64DrawModelAt(base, 0, 0, this.titleDepth(TITLE_B_START, TITLE_B_END, 500), -HALF_PI, 1 / 12), MENU_LIGHTS);
        }
        if (t > TITLE_C_START) {
            this.drawModel(viewerInput, "titleC", n64DrawModelAt(base, 0, 0, this.titleDepth(TITLE_C_START, TITLE_C_END, 500), -HALF_PI, 1 / 12), MENU_LIGHTS);
        }
        if (t > TITLE_D_START) {
            this.drawModel(viewerInput, "titleD", n64DrawModelAt(base, 0, 0, this.titleDepth(TITLE_D_START, TITLE_D_END, 500), -HALF_PI, 1 / 12), MENU_LIGHTS);
        }
        renderInstManager.setCurrentList(this.modelList);
    }

    private drawCopyright(box: ScreenBox): void {
        if (!(this.time > COPYRIGHT_START)) {
            return;
        }
        const alpha = Math.min(Math.trunc((this.time - COPYRIGHT_START) * 255 * TEXT_FADE_RATE), TEXT_ALPHA);
        const text = this.copyright;
        text.custom = [alpha, alpha, alpha, alpha, alpha, alpha];
        text.bold = false;
        text.align = TextAlign.Center;
        text.size = 7;
        text.draw("O 1997 Boss Game Studios, Inc.  All Rights Reserved.", 160, 190, box.normalized);
        text.draw("Top Gear Rally is a trademark of Kemco.", 160, 197, box.normalized);
        text.draw("Distributed by Midway Home Entertainment under license.", 160, 204, box.normalized);
        text.draw("Midway is a trademark of Midway Games Inc.  Used by permission.", 160, 211, box.normalized);
        text.draw("LICENSED BY NINTENDO", 160, 224, box.normalized);
        text.size = 3;
        text.draw("c", 78, 190, box.normalized);
    }

    private updateExit(): void {
        if (this.fadingOut) {
            if (this.fade.isComplete()) {
                for (const model of Object.values(this.models)) {
                    model.destroy(this.device);
                }
                this.models = this.loadModels();
                this.time = 0;
                this.fadingOut = false;
                this.fade = new Fade();
            }
            return;
        }
        if (this.time >= SPLASH_END_TIME) {
            this.fadingOut = true;
            this.fade.setTarget(0, FADE_TIME);
        }
    }
}
