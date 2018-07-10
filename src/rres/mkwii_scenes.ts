
// Mario Kart Wii

import * as Viewer from '../viewer';
import * as BRRES from './brres';
import * as U8 from './u8';
import * as Yaz0 from '../compression/Yaz0';

import { fetch } from '../util';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { BasicRRESScene } from './elb_scenes';
import { mat4 } from 'gl-matrix';

class MarioKartWiiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetch(`data/mkwii/${this.id}.szs`).then((buffer: ArrayBufferSlice) => {
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            const arch = U8.parse(buffer);
            const rres = BRRES.parse(arch.findFile('./course_model.brres').buffer);
            const scene = new BasicRRESScene(gl, [rres]);
            // Mario Kart Wii courses appear to be very, very big. Scale them down a bit.
            const scaleFactor = 0.1;
            mat4.fromScaling(scene.models[0].modelMatrix, [scaleFactor, scaleFactor, scaleFactor]);
            return scene;
        });
    }
}

const id = 'mkwii';
const name = 'Mario Kart Wii';
const sceneDescs: Viewer.SceneDesc[] = [
    new MarioKartWiiSceneDesc('shopping_course', 'Coconut Mall'),
    new MarioKartWiiSceneDesc('water_course', 'Koopa Cape'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
