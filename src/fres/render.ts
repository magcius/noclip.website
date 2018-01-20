
import * as Viewer from 'viewer';
import * as Yaz0 from 'yaz0';

import * as GX2Texture from './gx2_texture';
import * as BFRES from './bfres';
import * as SARC from './sarc';

import { assert, fetch } from 'util';

export class Scene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];

    private fres: BFRES.FRES;

    constructor(fres: BFRES.FRES) {
        this.fres = fres;

        this.textures = this.fres.textures.map((textureEntry) => {
            const canvas = GX2Texture.textureToCanvas(textureEntry.texture);
            canvas.title = `${textureEntry.entry.name} ${textureEntry.texture.type}`;
            return canvas;
        });
    }

    private translateModel(gl: WebGLRenderingContext, model: BFRES.ModelEntry) {
        const fmdl = model.fmdl;
    }

    private translateFRES(gl: WebGLRenderingContext, fres: BFRES.FRES) {
        return fres.models.map((modelEntry) => this.translateModel(gl, modelEntry));
    }

    public render(state: Viewer.RenderState) {
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGLRenderingContext): PromiseLike<Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const buf = Yaz0.decompress(result);
            const sarc = SARC.parse(buf);
            const file = sarc.files.find((file) => file.name === 'Output.bfres');
            const fres = BFRES.parse(file.buffer);
            const scene = new Scene(fres);
            return scene;
        });
    }
}
