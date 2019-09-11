
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as CTXB from './ctxb';
import * as CMB from './cmb';
import * as ZAR from './zar';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import { CtrTextureHolder, CmbInstance, CmbData, fillSceneParamsDataOnTemplate } from "./render";
import { GfxDevice, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { OrbitCameraController } from '../Camera';

export class GrezzoTextureHolder extends CtrTextureHolder {
    public findTextureEntryIndex(name: string): number {
        let i: number = -1;

        i = this.searchTextureEntryIndex(name);
        if (i >= 0) return i;

        i = this.searchTextureEntryIndex(`${name.split('/')[2]}.ctxb`);
        if (i >= 0) return i;

        return i;
    }

    public addCMB(device: GfxDevice, cmb: CMB.CMB): void {
        this.addTextures(device, cmb.textures.filter((tex) => tex.levels.length > 0));
    }

    public addCTXB(device: GfxDevice, ctxb: CTXB.CTXB): void {
        this.addTextures(device, ctxb.textures.map((texture) => {
            const basename = texture.name.split('/')[2];
            const name = `${basename}.ctxb`;
            return { ...texture, name };
        }));
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numSamplers: 3, numUniformBuffers: 3 }];

export class MultiCmbScene implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public cmbData: CmbData[] = [];
    public cmbRenderers: CmbInstance[] = [];
    private renderInstManager = new GfxRenderInstManager();
    private uniformBuffer: GfxRenderDynamicUniformBuffer;
    public cmab: CMAB.CMAB[] = [];
    public csab: CSAB.CSAB[] = [];

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder) {
        this.renderInstManager = new GfxRenderInstManager();
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        template.setBindingLayouts(bindingLayouts);
        fillSceneParamsDataOnTemplate(template, viewerInput.camera);

        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].prepareToRender(device, this.renderInstManager, hostAccessPass, viewerInput);

        this.renderInstManager.popTemplateRenderInst();
        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.drawOnPassRenderer(device, mainPassRenderer);
        this.renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderInstManager.destroy(device);
        this.uniformBuffer.destroy(device);
        this.renderTarget.destroy(device);

        this.textureHolder.destroy(device);
        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].destroy(device);
        for (let i = 0; i < this.cmbData.length; i++)
            this.cmbData[i].destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.cmbRenderers.length; i++)
                this.cmbRenderers[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.cmbRenderers.length; i++)
                this.cmbRenderers[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (let i = 0; i < this.cmbRenderers.length; i++)
                this.cmbRenderers[i].setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);

        const layersPanel = new UI.LayerPanel(this.cmbRenderers);
        return [renderHacksPanel, layersPanel];
    }
}

class SometimesMultiSelect extends UI.ScrollSelect {
    public itemIsOn: boolean[] = [];
    public onitemrequestselect: (index: number, v: boolean) => boolean;

    public itemFocused(index: number, first: boolean) {
        if (!this.onitemrequestselect(index, !this.itemIsOn[index]))
            return;

        this.syncInternalFlairs();
    }

    protected syncInternalFlairs() {
        const flairs: UI.Flair[] = [...this.flairs];
        for (let i = 0; i < this.getNumItems(); i++) {
            if (this.itemIsOn[i]) {
                const flair = UI.ensureFlairIndex(flairs, i);
                flair.background = UI.HIGHLIGHT_COLOR;
                flair.color = 'black';
                flair.fontWeight = 'bold';
            }
        }
        this.setInternalFlairs(flairs);
    }

    public setItemSelected(index: number, v: boolean) {
        this.itemIsOn[index] = v;
        this.syncInternalFlairs();
    }
}

class ArchiveCmbScene implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    private renderHelper: GfxRenderHelper;
    public textureHolder = new GrezzoTextureHolder();
    public cmbData: CmbData[] = [];
    public cmbRenderers: CmbInstance[] = [];

    constructor(private device: GfxDevice, private archive: ZAR.ZAR) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        fillSceneParamsDataOnTemplate(template, viewerInput.camera);

        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, hostAccessPass, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderHelper.renderInstManager.drawOnPassRenderer(device, mainPassRenderer);
        this.renderHelper.renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);

        this.textureHolder.destroy(device);
        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].destroy(device);
        for (let i = 0; i < this.cmbData.length; i++)
            this.cmbData[i].destroy(device);
    }

    private isFileSupported(file: ZAR.ZARFile): boolean {
        return file.name.endsWith('.cmb') || file.name.endsWith('.cmab') || file.name.endsWith('.csab');
    }

    private loadCMBFile(file: ZAR.ZARFile): void {
        const device = this.device;

        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].destroy(device);
        for (let i = 0; i < this.cmbData.length; i++)
            this.cmbData[i].destroy(device);

        this.cmbRenderers = [];
        this.cmbData = [];

        const cmb = CMB.parse(file.buffer);
        const cmbData = new CmbData(device, cmb);
        this.textureHolder.destroy(device);
        this.textureHolder.addTextures(device, cmb.textures);
        this.cmbData.push(cmbData);
        const cmbRenderer = new CmbInstance(device, this.textureHolder, cmbData, file.name);
        this.cmbRenderers.push(cmbRenderer);
    }

    public createCameraController() {
        const g = new OrbitCameraController();
        g.z -= 4000;
        return g;
    }

    public createPanels(): UI.Panel[] {
        const archivePanel = new UI.Panel();
        archivePanel.setTitle(UI.LAYER_ICON, 'Archive Files');

        const select = new SometimesMultiSelect();

        const files: UI.ScrollSelectItem[] = this.archive.files.map((file): UI.ScrollSelectItem => {
            if (this.isFileSupported(file))
                return { type: UI.ScrollSelectItemType.Selectable, name: file.name };
            else
                return { type: UI.ScrollSelectItemType.Header, html: file.name };
        });

        select.setItems(files);
        select.onitemrequestselect = (i: number, v: boolean) => {
            const file = this.archive.files[i];
            if (file.name.endsWith('.cmb')) {
                // Can't de-select CMB
                if (!v)
                    return false;

                this.loadCMBFile(file);

                // Deselect all other files except ours.
                for (let j = 0; j < this.archive.files.length; j++)
                    select.itemIsOn[j] = i === j;

                return true;
            } else if (file.name.endsWith('.cmab')) {
                // Can't de-select CMB right now
                if (!v)
                    return false;

                const cmab = CMAB.parse(this.archive.version, file.buffer);
                this.textureHolder.addTextures(this.device, cmab.textures);

                for (let i = 0; i < this.cmbRenderers.length; i++)
                    this.cmbRenderers[i].bindCMAB(cmab);

                // Deselect all other CMAB files except ours.
                for (let j = 0; j < this.archive.files.length; j++)
                    if (this.archive.files[j].name.endsWith('.cmab'))
                        select.itemIsOn[j] = i === j;

                return true;
            } else if (file.name.endsWith('.csab')) {
                const csab = CSAB.parse(this.archive.version, file.buffer);
                for (let i = 0; i < this.cmbRenderers.length; i++)
                    this.cmbRenderers[i].bindCSAB(csab);

                // Deselect all other CSAB files except ours.
                for (let j = 0; j < this.archive.files.length; j++)
                    if (this.archive.files[j].name.endsWith('.csab'))
                        select.itemIsOn[j] = i === j;

                return true;
            } else {
                return false;
            }
        };

        archivePanel.contents.appendChild(select.elem);

        // Select the first CMB item we can.
        for (let i = 0; i < this.archive.files.length; i++) {
            const file = this.archive.files[i];
            if (file.name.endsWith('.cmb')) {
                select.itemFocused(i, true);
                break;
            }
        }

        return [archivePanel];
    }
}

export function createSceneFromZARBuffer(device: GfxDevice, buffer: ArrayBufferSlice): Viewer.SceneGfx {
    return new ArchiveCmbScene(device, ZAR.parse(buffer));
}
