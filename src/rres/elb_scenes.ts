
// Elebits

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BRRES from './brres';

import { fetch, assert } from '../util';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState } from '../render';
import { RRESTextureHolder, ModelRenderer } from './render';

class ElebitsScene implements Viewer.MainScene {
    public textures: Viewer.Texture[];
    public textureHolder: RRESTextureHolder;
    public models: ModelRenderer[] = [];
    public animationController: BRRES.AnimationController;

    constructor(gl: WebGL2RenderingContext, public stageRRES: BRRES.RRES) {
        this.textureHolder = new RRESTextureHolder();
        this.animationController = new BRRES.AnimationController();

        this.textures = this.textureHolder.viewerTextures;

        this.textureHolder.addTextures(gl, stageRRES.textures);
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

class ElebitsSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const path = `data/elb/${this.id}_disp01.brres`;
        return fetch(path).then((buffer: ArrayBufferSlice) => {
            const stageRRES = BRRES.parse(buffer);
            return new ElebitsScene(gl, stageRRES);
        });
    }
}

const id = "elb";
const name = "Elebits";
const sceneDescs: Viewer.SceneDesc[] = [
    new ElebitsSceneDesc("stg01_01", "stg01_01_disp01"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
