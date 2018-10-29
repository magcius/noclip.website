
// Mario Kart DS

import * as Viewer from '../viewer';
import * as CX from '../compression/CX';
import * as NARC from './narc';
import * as NSBMD from './nsbmd';

import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';

class MarioKartDSSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetchData(`data/mkds/Course/${this.id}.carc`).then((buffer: ArrayBufferSlice) => {
            return CX.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            const narc = NARC.parse(buffer);
            const courseBMDFile = narc.files.find((file) => file.path === '/course_model.nsbmd');
            const courseBMD = NSBMD.parse(courseBMDFile.buffer);
            console.log(courseBMD);
            return null;
        });
    }
}

const id = 'mkds';
const name = 'Mario Kart DS';
const sceneDescs: Viewer.SceneDesc[] = [
    new MarioKartDSSceneDesc('bank_course', 'bank_course'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
