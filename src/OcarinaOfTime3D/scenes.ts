
import * as CMAB from './cmab.js';
import * as CSAB from './csab.js';
import * as CTXB from './ctxb.js';
import * as CMB from './cmb.js';
import * as ZAR from './zar.js';
import * as LzS from './LzS.js';

import * as Viewer from '../viewer.js';
import * as UI from '../ui.js';

import { CtrTextureHolder, CmbInstance, CmbData, fillSceneParamsDataOnTemplate } from "./render.js";
import { GfxDevice} from "../gfx/platform/GfxPlatform.js";
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { OrbitCameraController } from '../Camera.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { bindingLayouts } from './oot3d_scenes.js';
import { ZSIEnvironmentSettings } from './zsi.js';

export class GrezzoTextureHolder extends CtrTextureHolder {
    public override findTextureEntryIndex(name: string): number {
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

export class MultiCmbScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListSky = new GfxRenderInstList();
    public cmbData: CmbData[] = [];
    public cmbRenderers: CmbInstance[] = [];
    public skyRenderers: CmbInstance[] = [];
    public cmab: CMAB.CMAB[] = [];
    public csab: CSAB.CSAB[] = [];

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public getRenderCache(): GfxRenderCache {
        return this.renderHelper.renderCache;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        template.setBindingLayouts(bindingLayouts);
        fillSceneParamsDataOnTemplate(template, viewerInput.camera);

        if (this.skyRenderers.length > 0) {
            renderInstManager.setCurrentRenderInstList(this.renderInstListSky);
            for (let i = 0; i < this.skyRenderers.length; i++)
                this.skyRenderers[i].prepareToRender(device, renderInstManager, viewerInput);
        }

        renderInstManager.setCurrentRenderInstList(this.renderInstListMain);
        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListSky.reset();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

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
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    public textureHolder = new GrezzoTextureHolder();
    public cmbData: CmbData[] = [];
    public cmbRenderers: CmbInstance[] = [];

    constructor(private device: GfxDevice, private archive: ZAR.ZAR) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        fillSceneParamsDataOnTemplate(template, viewerInput.camera);

        this.renderHelper.renderInstManager.setCurrentRenderInstList(this.renderInstListMain);
        for (let i = 0; i < this.cmbRenderers.length; i++) {
            this.cmbRenderers[i].setRenderFog(false)
            this.cmbRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

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

        const cache = this.renderHelper.renderCache;
        const cmb = CMB.parse(file.buffer);
        const cmbData = new CmbData(cache, cmb);
        this.textureHolder.destroy(device);
        this.textureHolder.addTextures(device, cmb.textures);
        this.cmbData.push(cmbData);
        const cmbRenderer = new CmbInstance(cache, this.textureHolder, cmbData, file.name);

        if(cmbData.cmb.version === CMB.Version.Ocarina){
            const envSettings = new ZSIEnvironmentSettings();
            vec3.set(envSettings.lights[0].direction, -0.57715, -0.57715, -0.57715);
            vec3.set(envSettings.lights[1].direction, 0.57715, 0.57715, 0.57715);
            cmbRenderer.setEnvironmentSettings(envSettings);
        }

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
        select.setTextSelectable(true);

        const files: UI.ScrollSelectItem[] = this.archive.files.map((file): UI.ScrollSelectItem => {
            if (this.isFileSupported(file))
                return { type: UI.ScrollSelectItemType.Selectable, name: file.name };
            else
                return { type: UI.ScrollSelectItemType.Header, name: file.name };
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

                for (let i = 0; i < this.cmbRenderers.length; i++){
                    this.cmbRenderers[i].bindCMAB(cmab);
                }

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

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        
        const enableNormalsCheckbox = new UI.Checkbox('Show Vertex Normals', false);
        enableNormalsCheckbox.onchanged = () => {
            for (let i = 0; i < this.cmbRenderers.length; i++)
                this.cmbRenderers[i].setVertexNormalsEnabled(enableNormalsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableNormalsCheckbox.elem);

        return [archivePanel, renderHacksPanel];
    }
}

export function createSceneFromZARBuffer(device: GfxDevice, buffer: ArrayBufferSlice): Viewer.SceneGfx {
    return new ArchiveCmbScene(device, ZAR.parse(LzS.maybeDecompress(buffer)));
}
