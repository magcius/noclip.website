
// Luigi's Mansion 3D

import * as CMB from './cmb';
import * as ZAR from './zar';

import * as Viewer from '../viewer';

import Progressable from '../Progressable';
import { CtrTextureHolder, CmbRenderer } from './render';
import { SceneGroup } from '../viewer';
import { fetchData } from '../fetch';

class SceneDesc implements Viewer.SceneDesc {
    public name: string;
    public id: string;

    constructor(name: string, id: string) {
        this.name = name;
        this.id = id;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        // Fetch the ZAR & info ZSI.
        const path_gar = `data/lm3d/${this.id}.gar`;
        return fetchData(path_gar).then((garBuffer) => {
            const gar = ZAR.parse(garBuffer);
            const roomGarFile = gar.files.find((file) => file.name === 'room.gar');
            const roomGar = ZAR.parse(roomGarFile.buffer);

            const textureHolder = new CtrTextureHolder();

            const firstCMB = roomGar.files.find((file) => file.name.endsWith('.cmb'));
    
            const cmb = CMB.parse(firstCMB.buffer);
            console.log(cmb);
            const cmbRenderer = new CmbRenderer(gl, textureHolder, cmb, cmb.name);
            return cmbRenderer;
        });
    }
}

const id = "lm3d";
const name = "Luigi's Mansion 3D";
const sceneDescs: SceneDesc[] = [
    { id: "mapmdl/map1/room_00" },
].map((entry): SceneDesc => {
    const name = entry.id;
    return new SceneDesc(name, entry.id);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
