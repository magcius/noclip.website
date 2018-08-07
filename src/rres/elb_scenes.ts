
// Elebits

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BRRES from './brres';

import { fetch, assert, leftPad } from '../util';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState } from '../render';
import { RRESTextureHolder, ModelRenderer } from './render';
import { GXMaterialHacks } from '../gx/gx_material';
import AnimationController from '../AnimationController';

const materialHacks: GXMaterialHacks = {
    colorLightingFudge: (p) => `${p.matSource}`,
    alphaLightingFudge: (p) => '1.0',
};

export class BasicRRESScene implements Viewer.MainScene {
    public textures: Viewer.Texture[];
    public textureHolder: RRESTextureHolder;
    public models: ModelRenderer[] = [];
    public animationController: AnimationController;

    constructor(gl: WebGL2RenderingContext, public stageRRESes: BRRES.RRES[]) {
        this.textureHolder = new RRESTextureHolder();
        this.animationController = new AnimationController();

        this.textures = this.textureHolder.viewerTextures;

        for (const stageRRES of stageRRESes) {
            this.textureHolder.addRRESTextures(gl, stageRRES);
            assert(stageRRES.mdl0.length === 1);

            const modelRenderer = new ModelRenderer(gl, this.textureHolder, stageRRES.mdl0[0], '', materialHacks);
            this.models.push(modelRenderer);

            modelRenderer.bindRRESAnimations(this.animationController, stageRRES);
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        if (this.models.length > 1) {
            const layersPanel = new UI.LayerPanel();
            layersPanel.setLayers(this.models);
            panels.push(layersPanel);
        }

        return panels;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.textureHolder.destroy(gl);
        this.models.forEach((model) => model.destroy(gl));
    }

    public render(state: RenderState): void {
        this.animationController.updateTime(state.time);

        this.models.forEach((model) => {
            model.render(state);
        });
    }
}

function makeElbPath(stg: string, room: number): string {
    let z = leftPad(''+room, 2);
    return `data/elb/${stg}_${z}_disp01.brres`;
}

class ElebitsSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public rooms: number[]) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const paths = this.rooms.map((room) => makeElbPath(this.id, room));
        const progressables: Progressable<ArrayBufferSlice>[] = paths.map((path) => fetch(path));
        return Progressable.all(progressables).then((buffers: ArrayBufferSlice[]) => {
            const stageRRESes = buffers.map((buffer) => BRRES.parse(buffer));
            return new BasicRRESScene(gl, stageRRESes);
        });
    }
}

export function createBasicRRESSceneFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): BasicRRESScene {
    const stageRRES = BRRES.parse(buffer);
    return new BasicRRESScene(gl, [stageRRES]);
}

function range(start: number = 1, count: number = 18): number[] {
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
