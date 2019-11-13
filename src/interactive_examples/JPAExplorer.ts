
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
import { assertExists, hexzero } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { SceneContext } from "../SceneBase";
import { FloatingPanel, LAYER_ICON, HIGHLIGHT_COLOR, Checkbox, TextField } from "../ui";
import { GridPlane } from "./GridPlane";
import { getDebugOverlayCanvas2D, drawWorldSpacePoint } from "../DebugJunk";
import { createCsvParser } from "../SuperMarioGalaxy/JMapInfo";
import { RARC } from "../j3d/rarc";

class BasicEffectSystem {
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

function arrayNextIdx<T>(L: T[], n: number, incr: number): number {
    return mod(n + incr, L.length);
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

function makeDataList(strings: string[]): HTMLDataListElement {
    const datalist = document.createElement('datalist');
    for (let i = 0; i < strings.length; i++) {
        const opt = document.createElement('option');
        opt.textContent = strings[i];
        datalist.appendChild(opt);
    }
    return datalist;
}

const clearPass = makeClearRenderPassDescriptor(true, colorNew(0.2, 0.2, 0.2, 1.0));
const scratchVec3 = vec3.create();
export class Explorer implements SceneGfx {
    private renderTarget = new BasicRenderTarget();
    private renderHelper: GfxRenderHelper;
    private effectSystem: BasicEffectSystem;
    private uiContainer: HTMLElement;
    private gridPlane: GridPlane;
    private emitters: JPA.JPABaseEmitter[] = [];
    private currentEffectIndex: number = -1;
    private wiggleEmitters: boolean = false;
    private loopEmitters: boolean = true;
    private jpac: JPA.JPAC;

    // UI
    private currentEffectIndexEntry: SimpleTextEntry;
    private currentResourceIdEntry: SimpleTextEntry;
    private currentNameEntry: SimpleTextEntry | null = null;

    constructor(private context: SceneContext, buffer: ArrayBufferSlice, private effectNames: string[] | null = null) {
        const device = context.device;
        this.uiContainer = context.uiContainer;

        this.renderHelper = new GfxRenderHelper(device);
        this.jpac = JPA.parse(buffer);
        this.effectSystem = new BasicEffectSystem(device, this.jpac);

        this.gridPlane = new GridPlane(device);

        this.createUI();

        this.setEffectIndex(0);
    }

    private getResourceIdString(effectIndex: number): string {
        const effect = this.jpac.effects[effectIndex];
        return hexzero(effect.resourceId, 4);
    }

    private findByEffectName(effectName: string): number | null {
        const effectIndex = this.effectNames!.findIndex((name) => name.toLowerCase() === effectName.toLowerCase());
        if (effectIndex >= 0)
            return effectIndex;
        else
            return null;
    }

    private findByResourceId(resourceId: number): number | null {
        const effectIndex = this.jpac.effects.findIndex((res) => res.resourceId === resourceId);
        if (effectIndex >= 0)
            return effectIndex;
        else
            return null;
    }

    private createUI(): void {
        const panel = new FloatingPanel();
        panel.setTitle(LAYER_ICON, `Particle Explorer`);
        panel.setWidth(600);
        this.uiContainer.appendChild(panel.elem);

        const effectIndexList = makeDataList(this.jpac.effects.map((r, i) => '' + i));
        effectIndexList.id = 'EffectIndexList';
        panel.contents.appendChild(effectIndexList);

        this.currentEffectIndexEntry = new SimpleTextEntry();
        this.currentEffectIndexEntry.setLabel('Effect Index');
        const resIndexInput = this.currentEffectIndexEntry.textfield.textarea;
        resIndexInput.setAttribute('list', effectIndexList.id);
        this.currentEffectIndexEntry.onsubmit = (newValue: string) => {
            const effectIndex = parseInt(newValue, 10);
            if (effectIndex !== null) {
                this.setEffectIndex(effectIndex);
            } else {
                this.setUIToCurrent();
            }
        };
        panel.contents.appendChild(this.currentEffectIndexEntry.elem);

        const resourceIdList = makeDataList(this.jpac.effects.map((r, i) => this.getResourceIdString(i)));
        resourceIdList.id = 'ResourceIdList';
        panel.contents.appendChild(resourceIdList);

        this.currentResourceIdEntry = new SimpleTextEntry();
        this.currentResourceIdEntry.setLabel('Resource ID');
        const resIdInput = this.currentResourceIdEntry.textfield.textarea;
        resIdInput.setAttribute('list', resourceIdList.id);
        this.currentResourceIdEntry.onsubmit = (newValue: string) => {
            const resourceId = parseInt(newValue, 16);
            const effectIndex = this.findByResourceId(resourceId);
            if (effectIndex !== null) {
                this.setEffectIndex(effectIndex);
            } else {
                this.setUIToCurrent();
            }
        };
        panel.contents.appendChild(this.currentResourceIdEntry.elem);

        if (this.effectNames !== null) {
            const effectNameList = makeDataList(this.effectNames);
            effectNameList.id = 'EffectNameList';
            panel.contents.appendChild(effectNameList);

            this.currentNameEntry = new SimpleTextEntry();
            this.currentNameEntry.setLabel('Name');
            const resIdInput = this.currentNameEntry.textfield.textarea;
            resIdInput.setAttribute('list', effectNameList.id);
            this.currentNameEntry.onsubmit = (newValue: string) => {
                const effectIndex = this.findByEffectName(newValue);
                if (effectIndex !== null) {
                    this.setEffectIndex(effectIndex);
                } else {
                    this.setUIToCurrent();
                }
            };
            panel.contents.appendChild(this.currentNameEntry.elem);    
        }

        const playbackControls = document.createElement('div');
        playbackControls.style.display = 'grid';
        playbackControls.style.gridAutoFlow = 'column';
        playbackControls.style.gridGap = '4px';
        panel.contents.appendChild(playbackControls);

        const prevButton = new SimpleButton();
        prevButton.setActive(true);
        prevButton.setLabel('Previous');
        prevButton.onclick = () => {
            this.setEffectIndex(arrayNextIdx(this.jpac.effects, this.currentEffectIndex, -1));
        };
        playbackControls.appendChild(prevButton.elem);

        const playButton = new SimpleButton();
        playButton.setActive(true);
        playButton.setLabel('Play');
        playButton.onclick = () => {
            this.setEffectIndex(this.currentEffectIndex);
        };
        playbackControls.appendChild(playButton.elem);

        const nextButton = new SimpleButton();
        nextButton.setActive(true);
        nextButton.setLabel('Next');
        nextButton.onclick = () => {
            this.setEffectIndex(arrayNextIdx(this.jpac.effects, this.currentEffectIndex, +1));
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
        };
        panel.contents.appendChild(loopCheckbox.elem);
    }

    private setUIToCurrent(): void {
        const resource = this.jpac.effects[this.currentEffectIndex];
        this.currentEffectIndexEntry.textfield.setValue('' + this.currentEffectIndex);
        this.currentResourceIdEntry.textfield.setValue(this.getResourceIdString(this.currentEffectIndex));
        if (this.currentNameEntry !== null)
            this.currentNameEntry.textfield.setValue(this.effectNames![this.currentEffectIndex]);
    }

    private createEmitter(effectIndex = this.currentEffectIndex): void {
        const resourceId = this.jpac.effects[effectIndex].resourceId;
        const newEmitter = this.effectSystem.createBaseEmitter(this.context.device, this.renderHelper.getCache(), resourceId);
        this.emitters.push(newEmitter);
    }

    private setEffectIndex(newEffectIndex: number): void {
        this.currentEffectIndex = newEffectIndex;

        for (let i = 0; i < this.emitters.length; i++) {
            const emitter = this.emitters[i];
            // Emitter might have died of natural causes.
            if (!!(emitter.flags & JPA.BaseEmitterFlags.TERMINATE))
                continue;
            this.effectSystem.forceDeleteEmitter(this.emitters[i]);
        }

        this.emitters.length = 0;
        this.createEmitter();

        this.setUIToCurrent();
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

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, clearPass);
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

export function createRendererFromSMGArchive(context: SceneContext, arc: RARC) {
    const effectNamesCSV = createCsvParser(arc.findFileData(`ParticleNames.bcsv`)!);
    const effectNames = effectNamesCSV.mapRecords((iter) => {
        return assertExists(iter.getValueString('name'));
    });
    // TODO(jstpierre): AutoEffect systems?
    return new Explorer(context, arc.findFileData(`particles.jpc`)!, effectNames);
}
