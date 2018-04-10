
import * as Viewer from '../viewer';

import { createMultiSceneFromBuffer } from './scenes';

import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { fetch } from '../util';

const id = "mkdd";
const name = "Mario Kart: Double Dash!!";

class MKDDSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public name: string, public path: string) {
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const path = `data/j3d/mkdd/Course/${this.path}`;
        return fetch(path).then((buffer: ArrayBufferSlice): Viewer.MainScene => {
            return createMultiSceneFromBuffer(gl, buffer);
        });
    }
}

const sceneDescs: Viewer.SceneDesc[] = [
    new MKDDSceneDesc(`Luigi Circuit`, 'Luigi.arc'),
    new MKDDSceneDesc(`Peach Beach`, 'Peach.arc'),
    new MKDDSceneDesc(`Baby Park`, 'BabyLuigi.arc'),
    new MKDDSceneDesc(`Dry Dry Desert`, 'Desert.arc'),
    new MKDDSceneDesc(`Mushroom Bridge`, 'Nokonoko.arc'),
    new MKDDSceneDesc(`Mario Circuit`, 'Mario.arc'),
    new MKDDSceneDesc(`Daisy Cruiser`, 'Daisy.arc'),
    new MKDDSceneDesc(`Waluigi Stadium`, 'Waluigi.arc'),
    new MKDDSceneDesc(`Sherbet Land`, 'Snow.arc'),
    new MKDDSceneDesc(`Mushroom City`, 'Patapata.arc'),
    new MKDDSceneDesc(`Yoshi Circuit`, 'Yoshi.arc'),
    new MKDDSceneDesc(`DK Mountain`, 'Donkey.arc'),
    new MKDDSceneDesc(`Wario Colosseum`, 'Wario.arc'),
    new MKDDSceneDesc(`Dino Dino Jungle`, 'Diddy.arc'),
    new MKDDSceneDesc(`Bowser's Castle`, 'Koopa.arc'),
    new MKDDSceneDesc(`Rainbow Road`, 'Rainbow.arc'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
