
// Elebits

import * as Viewer from '../viewer';
import * as BRRES from './brres';

import { leftPad } from '../util';
import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { BasicRRESRenderer } from './scenes';

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
