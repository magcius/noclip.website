
// Luigi's Mansion 3D

import * as CMB from './cmb';
import * as ZAR from './zar';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import Progressable from '../Progressable';
import { CtrTextureHolder, CmbRenderer } from './render';
import { SceneGroup } from '../viewer';
import { fetchData } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState } from '../render';

class MultiScene implements Viewer.MainScene {
    constructor(public scenes: CmbRenderer[], public textureHolder: CtrTextureHolder) {
    }

    public createPanels(): UI.Panel[] {
        const layerPanel = new UI.LayerPanel();
        layerPanel.setLayers(this.scenes);
        return [layerPanel];
    }

    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => {
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

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

export function createSceneFromGARBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): Viewer.MainScene {
    const textureHolder = new CtrTextureHolder();
    const scenes: CmbRenderer[] = [];

    function addGARBuffer(buffer: ArrayBufferSlice): void {
        const gar = ZAR.parse(buffer);
        for (let i = 0; i < gar.files.length; i++) {
            const file = gar.files[i];
            if (file.name.endsWith('.gar')) {
                addGARBuffer(file.buffer);
            } else if (file.name.endsWith('.cmb')) {
                const cmb = CMB.parse(file.buffer);
                scenes.push(new CmbRenderer(gl, textureHolder, cmb, cmb.name));
            }
        }
    }
    addGARBuffer(buffer);

    return new MultiScene(scenes, textureHolder);
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
