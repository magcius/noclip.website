
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString } from '../util';

import * as UI from '../ui';
import * as Viewer from '../viewer';

import { BMD, BMT, BTK, BRK, BCK } from '../Common/JSYSTEM/J3D/J3DLoader';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import { readBTI_Texture } from '../Common/JSYSTEM/JUTTexture';
import { J3DModelData, BMDModelMaterialData } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { J3DModelInstanceSimple } from '../Common/JSYSTEM/J3D/J3DGraphSimple';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate, GXTextureHolder } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GXMaterialHacks } from '../gx/gx_material';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import * as JPAExplorer from '../InteractiveExamples/JPAExplorer';
import { SceneContext } from '../SceneBase';

export class BasicRenderer implements Viewer.SceneGfx {
    private renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;
    public modelInstances: J3DModelInstanceSimple[] = [];
    public rarc: RARC.JKRArchive[] = [];
    public textureHolder = new GXTextureHolder();

    constructor(device: GfxDevice) {
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

    public addModelInstance(scene: J3DModelInstanceSimple): void {
        this.modelInstances.push(scene);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        this.renderHelper.renderInstManager.drawOnPassRenderer(device, passRenderer);
        this.renderHelper.renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.6) * ${p.matSource})`,
};

export function createModelInstance(device: GfxDevice, cache: GfxRenderCache, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile | null, brkFile: RARC.RARCFile | null, bckFile: RARC.RARCFile | null, bmtFile: RARC.RARCFile | null) {
    const bmd = BMD.parse(bmdFile.buffer);
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    const bmdModel = new J3DModelData(device, cache, bmd);
    const scene = new J3DModelInstanceSimple(bmdModel, materialHacks);
    if (bmt !== null)
        scene.setModelMaterialDataOwned(new BMDModelMaterialData(device, cache, bmt));

    if (btkFile !== null) {
        const btk = BTK.parse(btkFile.buffer);
        scene.bindTTK1(btk);
    }

    if (brkFile !== null) {
        const brk = BRK.parse(brkFile.buffer);
        scene.bindTRK1(brk);
    }

    if (bckFile !== null) {
        const bck = BCK.parse(bckFile.buffer);
        scene.bindANK1(bck);
    }

    return scene;
}

function createScenesFromBuffer(device: GfxDevice, renderer: BasicRenderer, buffer: ArrayBufferSlice): void {
    if (readString(buffer, 0, 4) === 'RARC') {
        const rarc = RARC.parse(buffer);
        renderer.rarc.push(rarc);

        for (let i = 0; i < rarc.files.length; i++) {
            const file = rarc.files[i];

            if (file.name.endsWith('.bmd') || file.name.endsWith('.bdl')) {
                // Find the corresponding btk.
                const basename = file.name.split('.')[0];
                const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`) || null;
                const brkFile = rarc.files.find((f) => f.name === `${basename}.brk`) || null;
                const bckFile = rarc.files.find((f) => f.name === `${basename}.bck`) || null;
                const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`) || null;
                let modelInstance;
                try {
                    modelInstance = createModelInstance(device, renderer.renderHelper.renderInstManager.gfxRenderCache, file, btkFile, brkFile, bckFile, bmtFile);
                } catch(e) {
                    console.warn(`File ${basename} failed to parse:`, e);
                    continue;
                }

                modelInstance.name = basename;
                if (basename.includes('_sky'))
                    modelInstance.isSkybox = true;
                renderer.addModelInstance(modelInstance);
                renderer.textureHolder.addTextures(device, modelInstance.modelMaterialData.tex1Data!.tex1.textureDatas);
            } else if (file.name.endsWith('.bti')) {
                const texture = readBTI_Texture(file.buffer, file.name);
                renderer.textureHolder.addTextures(device, [texture]);
            }
        }
    }

    if (['J3D2bmd3', 'J3D2bdl4'].includes(readString(buffer, 0, 8))) {
        const bmd = BMD.parse(buffer);
        const bmdModel = new J3DModelData(device, renderer.renderHelper.renderInstManager.gfxRenderCache, bmd);
        const modelInstance = new J3DModelInstanceSimple(bmdModel);
        renderer.addModelInstance(modelInstance);
        renderer.textureHolder.addTextures(device, modelInstance.modelMaterialData.tex1Data!.tex1.textureDatas);
    }
}

export function createSceneFromBuffer(context: SceneContext, buffer: ArrayBufferSlice): Viewer.SceneGfx {
    if (readString(buffer, 0, 4) === 'RARC') {
        const rarc = RARC.parse(buffer);

        // Special case for SMG's Effect.arc
        if (rarc.findFile('ParticleNames.bcsv') !== null)
            return JPAExplorer.createRendererFromSMGArchive(context, rarc);
    }

    const device = context.device;
    const renderer = new BasicRenderer(device);
    createScenesFromBuffer(device, renderer, buffer);
    return renderer;
}
