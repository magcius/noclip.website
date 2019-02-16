
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as CTXB from './ctxb';
import * as CMB from './cmb';
import * as ZAR from './zar';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import { CtrTextureHolder, BasicRendererHelper, CmbRenderer } from "./render";
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RENDER_HACKS_ICON } from '../bk/scenes';

export class GrezzoTextureHolder extends CtrTextureHolder {
    public findTextureEntryIndex(name: string): number {
        let i: number = -1;

        i = this.searchTextureEntryIndex(name);
        if (i >= 0) return i;

        i = this.searchTextureEntryIndex(`${name.split('/')[2]}.ctxb`);
        if (i >= 0) return i;

        return i;
    }

    public addCTXB(device: GfxDevice, ctxb: CTXB.CTXB): void {
        this.addTextures(device, ctxb.textures.map((texture) => {
            const basename = texture.name.split('/')[2];
            const name = `${basename}.ctxb`;
            return { ...texture, name };
        }));
    }
}

export class MultiCmbScene extends BasicRendererHelper implements Viewer.SceneGfx {
    constructor(device: GfxDevice, public scenes: CmbRenderer[], public textureHolder: CtrTextureHolder, public cmab: CMAB.CMAB[] = [], public csabs: CSAB.CSAB[] = []) {
        super();
        for (let i = 0; i < this.scenes.length; i++)
            this.scenes[i].addToViewRenderer(device, this.viewRenderer);
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.scenes.length; i++)
            this.scenes[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.scenes.length; i++)
            this.scenes[i].destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.scenes.length; i++)
                this.scenes[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.scenes.length; i++)
                this.scenes[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const layersPanel = new UI.LayerPanel(this.scenes);
        return [renderHacksPanel, layersPanel];
    }
}

export function createSceneFromZARBuffer(device: GfxDevice, buffer: ArrayBufferSlice): Viewer.SceneGfx {
    const textureHolder = new GrezzoTextureHolder();
    const scenes: CmbRenderer[] = [];
    const cmabs: CMAB.CMAB[] = [];
    const csabs: CSAB.CSAB[] = [];

    function addZARBuffer(buffer: ArrayBufferSlice): void {
        const zar = ZAR.parse(buffer);
        for (let i = 0; i < zar.files.length; i++) {
            const file = zar.files[i];
            if (file.name.endsWith('.gar')) {
                addZARBuffer(file.buffer);
            } else if (file.name.endsWith('.cmb')) {
                const cmb = CMB.parse(file.buffer);
                scenes.push(new CmbRenderer(device, textureHolder, cmb, cmb.name));
            } else if (file.name.endsWith('.ctxb')) {
                const ctxb = CTXB.parse(file.buffer);
                textureHolder.addCTXB(device, ctxb);
            } else if (file.name.endsWith('.cmab')) {
                const cmab = CMAB.parse(zar.version, file.buffer);
                textureHolder.addTextures(device, cmab.textures);
                cmabs.push(cmab);
            } else if (file.name.endsWith('.csab')) {
                const csab = CSAB.parse(zar.version, file.buffer);
                (csab as any).name = file.name;
                csabs.push(csab);
            }
        }
    }
    addZARBuffer(buffer);

    return new MultiCmbScene(device, scenes, textureHolder, cmabs, csabs);
}
