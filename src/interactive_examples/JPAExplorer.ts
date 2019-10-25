
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { BasicRenderTarget, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { OrbitCameraController } from "../Camera";
import { colorNew } from "../Color";
import * as JPA from '../j3d/JPA';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3 } from "gl-matrix";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { assertExists, assert, hexzero } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { SceneContext } from "../SceneBase";
import { FloatingPanel, LAYER_ICON, HIGHLIGHT_COLOR, Checkbox, TextField } from "../ui";
import { GridPlane } from "./GridPlane";
import { getDebugOverlayCanvas2D, drawWorldSpacePoint } from "../DebugJunk";

class ExplorerEffectSystem {
    private emitterManager: JPA.JPAEmitterManager;
    private drawInfo = new JPA.JPADrawInfo();
    private jpacData: JPA.JPACData;
    private resourceDatas = new Map<number, JPA.JPAResourceData>();

    constructor(device: GfxDevice, private jpac: JPA.JPAC) {
        this.emitterManager = new JPA.JPAEmitterManager(device, 6000, 300);
        this.jpacData = new JPA.JPACData(this.jpac);
    }

    private findResourceData(userIndex: number): [JPA.JPACData, JPA.JPAResourceRaw] | null {
        const r = this.jpacData.jpac.effects.find((resource) => resource.resourceId === userIndex);
        if (r !== undefined)
            return [this.jpacData, r];

        return null;
    }

    private getResourceData(device: GfxDevice, cache: GfxRenderCache, userIndex: number): JPA.JPAResourceData | null {
        if (!this.resourceDatas.has(userIndex)) {
            const data = this.findResourceData(userIndex);
            if (data !== null) {
                const [jpacData, jpaResRaw] = data;
                const resData = new JPA.JPAResourceData(device, cache, jpacData, jpaResRaw);
                this.resourceDatas.set(userIndex, resData);
            }
        }

        return this.resourceDatas.get(userIndex)!;
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4, texPrjMtx: mat4 | null): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.prjMtx = prjMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
    }

    public calc(viewerInput: ViewerRenderInput): void {
        const inc = viewerInput.deltaTime * 30/1000;
        this.emitterManager.calc(inc);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, drawGroupId: number): void {
        this.emitterManager.draw(device, renderInstManager, this.drawInfo, drawGroupId);
    }

    public forceDeleteEmitter(emitter: JPA.JPABaseEmitter): void {
        this.emitterManager.forceDeleteEmitter(emitter);
    }

    public createBaseEmitter(device: GfxDevice, cache: GfxRenderCache, resourceId: number): JPA.JPABaseEmitter {
        const resData = assertExists(this.getResourceData(device, cache, resourceId));
        const emitter = this.emitterManager.createEmitter(resData)!;
        return emitter;
    }

    public destroy(device: GfxDevice): void {
        this.jpacData.destroy(device);
        this.emitterManager.destroy(device);
    }
}

function mod(a: number, b: number): number {
    return (a + b) % b;
}

function arrayNext<T>(L: T[], v: T, incr: number): T {
    const n = L.indexOf(v);
    assert(n >= 0);
    return L[mod(n + incr, L.length)];
}

export class SimpleButton {
    public onclick: (() => void) | null = null;
    public elem: HTMLElement;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.font = '16px monospace';
        this.elem.style.textShadow = '0px 0px 6px rgba(0, 0, 0, 0.5)';
        this.elem.style.color = 'white';
        this.elem.style.lineHeight = '32px';
        this.elem.style.textAlign = 'center';
        this.elem.style.userSelect = 'none';
        this.elem.onclick = () => {
            if (this.onclick !== null)
                this.onclick();
        };
    }

    public setActive(v: boolean): void {
        this.elem.style.backgroundColor = v ? HIGHLIGHT_COLOR : '#666';
        this.elem.style.cursor = v ? 'pointer' : '';
    }

    public setLabel(text: string): void {
        this.elem.textContent = text;
    }
}

class SimpleTextEntry {
    public textfield: TextField;
    private toplevel: HTMLElement;
    private label: HTMLElement;
    public elem: HTMLElement;
    public onsubmit: ((text: string) => void) | null = null;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.display = 'grid';
        this.toplevel.style.gridAutoFlow = 'column';
        this.toplevel.style.lineHeight = '20px';

        this.label = document.createElement('div');
        this.label.style.font = '16px monospace';
        this.label.style.color = 'white';
        this.label.style.userSelect = 'none';
        this.toplevel.appendChild(this.label);

        this.textfield = new TextField();
        const textarea = this.textfield.textarea;
        textarea.onchange = () => {
            if (this.onsubmit !== null)
                this.onsubmit(this.textfield.getValue());
        };
        this.toplevel.appendChild(this.textfield.elem);

        this.elem = this.toplevel;
    }

    public setLabel(text: string): void {
        this.label.textContent = text;
    }
}

const clearPass = makeClearRenderPassDescriptor(true, colorNew(0.2, 0.2, 0.2, 1.0));
const scratchVec3 = vec3.create();
export class Explorer implements SceneGfx {
    private renderTarget = new BasicRenderTarget();
    private renderHelper: GfxRenderHelper;
    private effectSystem: ExplorerEffectSystem;
    private uiContainer: HTMLElement;
    private gridPlane: GridPlane;
    private emitters: JPA.JPABaseEmitter[] = [];
    private sortedResourceIds: number[];
    private currentResourceId: number = -1;
    private wiggleEmitters: boolean = false;
    private loopEmitters: boolean = true;

    // UI
    private currentResourceIdEntry: SimpleTextEntry;

    constructor(private context: SceneContext, buffer: ArrayBufferSlice) {
        const device = context.device;
        this.uiContainer = context.uiContainer;

        this.renderHelper = new GfxRenderHelper(device);
        const jpac = JPA.parse(buffer);
        this.effectSystem = new ExplorerEffectSystem(device, jpac);

        this.sortedResourceIds = jpac.effects.map((res) => res.resourceId).sort((a, b) => a - b);
        this.gridPlane = new GridPlane(device);

        this.createUI();

        this.setResourceId(this.sortedResourceIds[0]);
    }

    private createUI(): void {
        const panel = new FloatingPanel();
        panel.setTitle(LAYER_ICON, `Particle Explorer`);
        panel.setWidth(600);
        this.uiContainer.appendChild(panel.elem);

        this.currentResourceIdEntry = new SimpleTextEntry();
        this.currentResourceIdEntry.setLabel('Resource ID');
        this.currentResourceIdEntry.onsubmit = (newValue: string) => {
            const resourceId = parseInt(newValue, 16);
            if (this.sortedResourceIds.includes(resourceId)) {
                this.setResourceId(resourceId);
            } else {
                this.currentResourceIdEntry.textfield.setValue(hexzero(this.currentResourceId, 4));
            }
        };
        panel.contents.appendChild(this.currentResourceIdEntry.elem);

        const playbackControls = document.createElement('div');
        playbackControls.style.display = 'grid';
        playbackControls.style.gridAutoFlow = 'column';
        playbackControls.style.gridGap = '4px';
        panel.contents.appendChild(playbackControls);

        const prevButton = new SimpleButton();
        prevButton.setActive(true);
        prevButton.setLabel('Previous');
        prevButton.onclick = () => {
            this.setResourceId(arrayNext(this.sortedResourceIds, this.currentResourceId, -1));
        };
        playbackControls.appendChild(prevButton.elem);

        const playButton = new SimpleButton();
        playButton.setActive(true);
        playButton.setLabel('Play');
        playButton.onclick = () => {
            this.setResourceId(this.currentResourceId);
        };
        playbackControls.appendChild(playButton.elem);

        const nextButton = new SimpleButton();
        nextButton.setActive(true);
        nextButton.setLabel('Next');
        nextButton.onclick = () => {
            this.setResourceId(arrayNext(this.sortedResourceIds, this.currentResourceId, +1));
        };
        playbackControls.appendChild(nextButton.elem);

        const wiggleCheckbox = new Checkbox('Wiggle Emitter', this.wiggleEmitters);
        wiggleCheckbox.onchanged = () => {
            this.wiggleEmitters = wiggleCheckbox.checked;
        };
        panel.contents.appendChild(wiggleCheckbox.elem);

        const loopCheckbox = new Checkbox('Loop', this.loopEmitters);
        loopCheckbox.onchanged = () => {
            this.loopEmitters = loopCheckbox.checked;
            this.setResourceId(this.currentResourceId);
        };
        panel.contents.appendChild(loopCheckbox.elem);
    }

    private createEmitter(resourceId = this.currentResourceId): void {
        const newEmitter = this.effectSystem.createBaseEmitter(this.context.device, this.renderHelper.getCache(), resourceId);
        this.emitters.push(newEmitter);
    }

    private setResourceId(newResourceId: number): void {
        this.currentResourceId = newResourceId;

        for (let i = 0; i < this.emitters.length; i++) {
            const emitter = this.emitters[i];
            // Emitter might have died of natural causes.
            if (!!(emitter.flags & JPA.BaseEmitterFlags.TERMINATE))
                continue;
            this.effectSystem.forceDeleteEmitter(this.emitters[i]);
        }

        this.emitters.length = 0;
        this.createEmitter();

        this.currentResourceIdEntry.textfield.setValue(hexzero(this.currentResourceId, 4));
    }

    public createCameraController() {
        return new OrbitCameraController();
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        this.gridPlane.prepareToRender(device, renderInstManager, viewerInput);

        if (this.wiggleEmitters) {
            const t = viewerInput.time / 100;
            scratchVec3[0] = (Math.sin(t) * 50);
            scratchVec3[1] = (Math.sin(t * 0.777) * 50);
            scratchVec3[2] = (Math.cos(t) * 50);
        } else {
            vec3.set(scratchVec3, 0, 0, 0);
        }

        for (let i = 0; i < this.emitters.length; i++) {
            vec3.copy(this.emitters[i].globalTranslation, scratchVec3);

            const ctx = getDebugOverlayCanvas2D();
            drawWorldSpacePoint(ctx, viewerInput.camera, this.emitters[i].globalTranslation);
        }

        if (this.loopEmitters) {
            for (let i = 0; i < this.emitters.length; i++) {
                if (!!(this.emitters[i].flags & JPA.BaseEmitterFlags.TERMINATE))
                    this.createEmitter();
            }
        }

        this.effectSystem.calc(viewerInput);
        const texPrjMtx: mat4 | null = null;
        this.effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, texPrjMtx);
        this.effectSystem.draw(device, this.renderHelper.renderInstManager, 0);

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, clearPass);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.drawOnPassRenderer(device, mainPassRenderer);
        renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice) {
        this.effectSystem.destroy(device);
    }
}

export function createRendererFromBuffer(context: SceneContext, buffer: ArrayBufferSlice) {
    return new Explorer(context, buffer);
}