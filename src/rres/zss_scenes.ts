
// Skyward Sword

import * as Viewer from '../viewer';
import * as LZ77 from '../lz77';
import * as BRRES from './brres';
import * as U8 from './u8';

import { fetch } from '../util';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState } from '../render';
import { Scene } from './render';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

class SkywardSwordSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public path: string) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetch(this.path).then((buffer: ArrayBufferSlice) => {
            const decompressed = LZ77.decompress(buffer);
            const u8Archive = U8.parse(decompressed);
            const brresFile = u8Archive.findFile('g3d/stage.brres');
            const rres = BRRES.parse(brresFile.buffer);
            return new Scene(gl, rres);
        });
    }
}

const id = "zss";
const name = "Skyward Sword";
const sceneDescs: Viewer.SceneDesc[] = [
    new SkywardSwordSceneDesc("F000", "F000", `data/zss/F000_stg_l0.arc.LZ`),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
