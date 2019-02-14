
// Elebits

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BRRES from './brres';
import * as U8 from './u8';

import { assert, leftPad } from '../util';
import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import { GXMaterialHacks } from '../gx/gx_material';
import AnimationController from '../AnimationController';
import { GfxDevice, GfxRenderPass, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `vec4(${p.matSource}.rgb, 1.0)`,
};

export class BasicRRESRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();
    private modelInstances: MDL0ModelInstance[] = [];
    private models: MDL0Model[] = [];

    public textureHolder: RRESTextureHolder = new RRESTextureHolder();
    public renderHelper: GXRenderHelperGfx;
    private animationController: AnimationController;

    constructor(device: GfxDevice, public stageRRESes: BRRES.RRES[]) {
        this.renderHelper = new GXRenderHelperGfx(device);

        this.textureHolder = new RRESTextureHolder();
        this.animationController = new AnimationController();

        for (let i = 0; i < stageRRESes.length; i++) {
            const stageRRES = stageRRESes[i];
            this.textureHolder.addRRESTextures(device, stageRRES);
            assert(stageRRES.mdl0.length >= 1);

            const model = new MDL0Model(device, this.renderHelper, stageRRES.mdl0[0], materialHacks);
            this.models.push(model);
            const modelRenderer = new MDL0ModelInstance(device, this.renderHelper, this.textureHolder, model);
            this.modelInstances.push(modelRenderer);

            modelRenderer.bindRRESAnimations(this.animationController, stageRRES);
        }

        this.renderHelper.finishBuilder(device, this.viewRenderer);
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

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        const mainPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer);
        return mainPassRenderer;
    }
}

function makeElbPath(stg: string, room: number): string {
    let z = leftPad(''+room, 2);
    return `elb/${stg}_${z}_disp01.brres`;
}

class ElebitsSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public rooms: number[]) {}

    public createScene(device: GfxDevice): Progressable<Viewer.SceneGfx> {
        const paths = this.rooms.map((room) => makeElbPath(this.id, room));
        const progressables: Progressable<ArrayBufferSlice>[] = paths.map((path) => fetchData(path));
        return Progressable.all(progressables).then((buffers: ArrayBufferSlice[]) => {
            const stageRRESes = buffers.map((buffer) => BRRES.parse(buffer));
            return new BasicRRESRenderer(device, stageRRESes);
        });
    }
}

export function createBasicRRESRendererFromBRRES(device: GfxDevice, buffer: ArrayBufferSlice) {
    const stageRRES = BRRES.parse(buffer);
    return new BasicRRESRenderer(device, [stageRRES]);
}

export function createBasicRRESRendererFromU8Archive(device: GfxDevice, buffer: ArrayBufferSlice) {
    const u8 = U8.parse(buffer);

    function findRRES(rres: BRRES.RRES[], dir: U8.U8Dir) {
        for (let i = 0; i < dir.files.length; i++)
            if (dir.files[i].name.endsWith('.brres'))
                rres.push(BRRES.parse(dir.files[i].buffer));
        for (let i = 0; i < dir.subdirs.length; i++)
            findRRES(rres, dir.subdirs[i]);
    }

    const rres: BRRES.RRES[] = [];
    findRRES(rres, u8.root);

    return new BasicRRESRenderer(device, rres);
}

function range(start: number, count: number): number[] {
    const L: number[] = [];
    for (let i = start; i < start + count; i++)
        L.push(i);
    return L;
}

const id = "elb";
const name = "Elebits";
const sceneDescs: Viewer.SceneDesc[] = [
    new ElebitsSceneDesc("stg01", "Mom and Dad's House", range(1, 18)),
    new ElebitsSceneDesc("stg03", "The Town", [1]),
    new ElebitsSceneDesc("stg02", "Amusement Park - Main Hub", [1, 5]),
    new ElebitsSceneDesc("stg02", "Amusement Park - Castle", [2]),
    new ElebitsSceneDesc("stg02", "Amusement Park - Entrance", [3, 6]),
    new ElebitsSceneDesc("stg02", "Amusement Park - Space", [4]),
    new ElebitsSceneDesc("stg04", "Tutorial", [1, 2]),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
