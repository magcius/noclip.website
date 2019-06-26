
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as CTXB from './ctxb';
import * as CMB from './cmb';
import * as ZAR from './zar';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import { CtrTextureHolder, BasicRendererHelper, CmbInstance, CmbData, RoomRenderer, fillSceneParamsDataOnTemplate } from "./render";
import { GfxDevice, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer2';

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

export function createSceneFromZARBuffer(device: GfxDevice, buffer: ArrayBufferSlice): Viewer.SceneGfx {
    const textureHolder = new GrezzoTextureHolder();

    const renderer = new MultiCmbScene(device, textureHolder);
    function addZARBuffer(buffer: ArrayBufferSlice): void {
        const zar = ZAR.parse(buffer);
        for (let i = 0; i < zar.files.length; i++) {
            const file = zar.files[i];
            if (file.name.endsWith('.gar')) {
                addZARBuffer(file.buffer);
            } else if (file.name.endsWith('.cmb')) {
                const cmb = CMB.parse(file.buffer);
                const cmbData = new CmbData(device, cmb);
                textureHolder.addTextures(device, cmb.textures);
                renderer.cmbData.push(cmbData);
                const cmbRenderer = new CmbInstance(device, textureHolder, cmbData, cmb.name);
                renderer.cmbRenderers.push(cmbRenderer);
            } else if (file.name.endsWith('.ctxb')) {
                const ctxb = CTXB.parse(file.buffer);
                textureHolder.addCTXB(device, ctxb);
            } else if (file.name.endsWith('.cmab')) {
                const cmab = CMAB.parse(zar.version, file.buffer);
                textureHolder.addTextures(device, cmab.textures);
                renderer.cmab.push(cmab);
            } else if (file.name.endsWith('.csab')) {
                const csab = CSAB.parse(zar.version, file.buffer);
                (csab as any).name = file.name;
                renderer.csab.push(csab);
            }
        }
    }
    addZARBuffer(buffer);

    return renderer;
}
