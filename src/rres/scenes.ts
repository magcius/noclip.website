
import * as Yaz0 from '../compression/Yaz0';
import * as BRRES from './brres';
import * as U8 from './u8';
import * as Viewer from '../viewer';
import * as UI from '../ui';

import { U8Archive } from "./u8";
import { createMarioKartWiiSceneFromU8Archive } from "./mkwii_scenes";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import { GXMaterialHacks } from '../gx/gx_material';
import AnimationController from '../AnimationController';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GXRenderHelperGfx, BasicGXRendererHelper } from '../gx/gx_render_2';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.2) * ${p.matSource})`,
};

export class BasicRRESRenderer extends BasicGXRendererHelper {
    private modelInstances: MDL0ModelInstance[] = [];
    private models: MDL0Model[] = [];

    private animationController: AnimationController;

    constructor(device: GfxDevice, public stageRRESes: BRRES.RRES[], public textureHolder = new RRESTextureHolder()) {
        super(device);

        this.animationController = new AnimationController();

        for (let i = 0; i < stageRRESes.length; i++) {
            const stageRRES = stageRRESes[i];
            this.textureHolder.addRRESTextures(device, stageRRES);

            for (let j = 0; j < stageRRES.mdl0.length; j++) {
                const model = new MDL0Model(device, this.getCache(), stageRRES.mdl0[j], materialHacks);
                this.models.push(model);
                const modelRenderer = new MDL0ModelInstance(this.textureHolder, model);
                this.modelInstances.push(modelRenderer);
                modelRenderer.bindRRESAnimations(this.animationController, stageRRES);
            }
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        if (this.modelInstances.length > 1) {
            const layersPanel = new UI.LayerPanel();
            layersPanel.setLayers(this.modelInstances);
            panels.push(layersPanel);
        }

        return panels;
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        this.renderHelper.fillSceneParams(viewerInput, template);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

export function createBasicRRESRendererFromBRRES(device: GfxDevice, buffer: ArrayBufferSlice[]) {
    const rres = buffer.map((b) => BRRES.parse(b));
    return new BasicRRESRenderer(device, rres);
}

export function createBasicRRESRendererFromU8Archive(device: GfxDevice, arc: U8Archive) {
    function findRRES(rres: BRRES.RRES[], dir: U8.U8Dir) {
        for (let i = 0; i < dir.files.length; i++)
            if (dir.files[i].name.endsWith('.brres'))
                rres.push(BRRES.parse(dir.files[i].buffer));
        for (let i = 0; i < dir.subdirs.length; i++)
            findRRES(rres, dir.subdirs[i]);
    }

    const rres: BRRES.RRES[] = [];
    findRRES(rres, arc.root);

    return new BasicRRESRenderer(device, rres);
}

export function createBasicRRESRendererFromU8Buffer(device: GfxDevice, buffer: ArrayBufferSlice) {
    return Promise.resolve(buffer).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'Yaz0')
            return Yaz0.decompress(buffer);
        else
            return buffer;
    }).then((buffer: ArrayBufferSlice) => {
        const arc = U8.parse(buffer);
        return createBasicRRESRendererFromU8Archive(device, arc);
    });
}

export function createSceneFromU8Buffer(device: GfxDevice, buffer: ArrayBufferSlice) {
    const arc = U8.parse(buffer);

    // If we have a course.kmp, that means we're a Mario Kart Wii archive.
    if (arc.findFile('./course.kmp') !== null)
        return createMarioKartWiiSceneFromU8Archive(device, arc);

    // Otherwise, assume that we have a basic scene.
    return createBasicRRESRendererFromU8Archive(device, arc);
}
