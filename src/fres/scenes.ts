
import * as BFRES from './bfres';
import * as SARC from './sarc';
import * as Yaz0 from '../compression/Yaz0';
import { Scene } from './render';

import * as Viewer from '../viewer';

import { RenderState } from '../render';
import { fetch, readString } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

class FRESRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[];

    constructor(public mainScene: Viewer.Scene) {
        this.textures = collectTextures([this.mainScene]);
    }

    public render(state: RenderState) {
        const gl = state.gl;
        state.setClipPlanes(0.2, 500000);
        if (this.mainScene) {
            this.mainScene.render(state);
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        if (this.mainScene)
            this.mainScene.destroy(gl);
    }
}

export function createSceneFromFRESBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice, isSkybox: boolean = false): Viewer.MainScene {
    const fres = BFRES.parse(buffer);
    return new FRESRenderer(new Scene(gl, fres, isSkybox));
}

export function createSceneFromSARCBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice, isSkybox: boolean = false): Promise<Viewer.Scene> {
    return Promise.resolve(buffer).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'Yaz0')
            return Yaz0.decompress(buffer);
        else
            return buffer;
    }).then((buffer: ArrayBufferSlice) => {
        const sarc = SARC.parse(buffer);
        const file = sarc.files.find((file) => file.name.endsWith('.bfres'));
        return createSceneFromFRESBuffer(gl, file.buffer, isSkybox);
    });
}
