
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString } from '../util';

import * as UI from '../ui';
import * as Viewer from '../viewer';

import { BMD, BMT, BTK, BRK, BCK } from './j3d';
import * as Yaz0 from '../compression/Yaz0';
import * as RARC from './rarc';
import { BMDModelInstance, J3DTextureHolder, BMDModel } from './render';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GXMaterialHacks } from '../gx/gx_material';

export class BasicRenderer implements Viewer.SceneGfx {
    private viewRenderer = new GfxRenderInstViewRenderer();
    private renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;
    public modelInstances: BMDModelInstance[] = [];
    public rarc: RARC.RARC[] = [];

    constructor(device: GfxDevice, public textureHolder: J3DTextureHolder) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const layersPanel = new UI.LayerPanel(this.modelInstances);

        return [layersPanel, renderHacksPanel];
    }

    public addModelInstance(scene: BMDModelInstance): void {
        this.modelInstances.push(scene);
    }

    public finish(device: GfxDevice): void {
        this.renderHelper.finishBuilder(device, this.viewRenderer);
    }

    private prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.executeOnPass(device, passRenderer);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderHelper.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.6) * ${p.matSource})`,
};

export function createModelInstance(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile | null, brkFile: RARC.RARCFile | null, bckFile: RARC.RARCFile | null, bmtFile: RARC.RARCFile | null) {
    const bmd = BMD.parse(bmdFile.buffer);
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    textureHolder.addJ3DTextures(device, bmd, bmt);
    const bmdModel = new BMDModel(device, renderHelper, bmd, bmt);
    const scene = new BMDModelInstance(device, renderHelper, textureHolder, bmdModel, materialHacks);

    if (btkFile !== null) {
        const btk = BTK.parse(btkFile.buffer);
        scene.bindTTK1(btk.ttk1);
    }

    if (brkFile !== null) {
        const brk = BRK.parse(brkFile.buffer);
        scene.bindTRK1(brk.trk1);
    }

    if (bckFile !== null) {
        const bck = BCK.parse(bckFile.buffer);
        scene.bindANK1(bck.ank1);
    }

    return scene;
}

function createScenesFromBuffer(device: GfxDevice, renderer: BasicRenderer, buffer: ArrayBufferSlice): Promise<BMDModelInstance[]> {
    return Promise.resolve(buffer).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'Yaz0')
            return Yaz0.decompress(buffer);
        else
            return buffer;
    }).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'RARC') {
            const rarc = RARC.parse(buffer);
            renderer.rarc.push(rarc);
            const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
            let scenes = bmdFiles.map((bmdFile) => {
                // Find the corresponding btk.
                const basename = bmdFile.name.split('.')[0];
                const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`) || null;
                const brkFile = rarc.files.find((f) => f.name === `${basename}.brk`) || null;
                const bckFile = rarc.files.find((f) => f.name === `${basename}.bck`) || null;
                const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`) || null;
                let scene;
                try {
                    scene = createModelInstance(device, renderer.renderHelper, renderer.textureHolder, bmdFile, btkFile, brkFile, bckFile, bmtFile);
                } catch(e) {
                    console.warn(`File ${basename} failed to parse:`, e);
                    return null;
                }
                scene.name = basename;
                if (basename.includes('_sky'))
                    scene.isSkybox = true;
                return scene;
            });
            scenes = scenes.filter((scene) => !!scene);

            return scenes;
        }

        if (['J3D2bmd3', 'J3D2bdl4'].includes(readString(buffer, 0, 8))) {
            const bmd = BMD.parse(buffer);
            renderer.textureHolder.addJ3DTextures(device, bmd);
            const bmdModel = new BMDModel(device, renderer.renderHelper, bmd);
            const modelInstance = new BMDModelInstance(device, renderer.renderHelper, renderer.textureHolder, bmdModel);
            return [modelInstance];
        }

        return null;
    });
}

export function createMultiSceneFromBuffer(device: GfxDevice, buffer: ArrayBufferSlice): Promise<BasicRenderer> {
    const renderer = new BasicRenderer(device, new J3DTextureHolder());
    return createScenesFromBuffer(device, renderer, buffer).then((scenes) => {
        for (let i = 0; i < scenes.length; i++)
            renderer.addModelInstance(scenes[i]);
        renderer.finish(device);
        return renderer;
    });
}
