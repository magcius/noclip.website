
// Luigi's Mansion 3D

import * as CMB from './cmb';
import * as ZAR from './zar';
import * as BCSV from '../luigis_mansion/bcsv';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import Progressable from '../Progressable';
import { mat4 } from 'gl-matrix';
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
        
        const path_gar = `data/lm3d/map/${this.id}.gar`;
        //spacecats: this is pretty hacky, but it works
        const models_path = Number.parseInt(this.id.split('p')[1]) < 10 ? `data/lm3d/mapmdl/${this.id.replace('0','')}/` : `data/lm3d/mapmdl/${this.id}/`;
        const rooms: CmbRenderer[] = [];
        const textureHolder = new CtrTextureHolder();

        return fetchData(path_gar).then((garBuffer) => {
            const gar = ZAR.parse(garBuffer);

            const jmpGarFile = gar.files.find((file) => file.name === "JMP.gar");
            const jmpGar = ZAR.parse(jmpGarFile.buffer);
            const roomInfoFile = jmpGar.files.find((file) => file.name === "RoomInfo.gseb");
            const roomInfo =  BCSV.parse(roomInfoFile.buffer, true);

            for(let i = 0; i < roomInfo.records.length; i++){
                fetchData(models_path + ( i < 10 ? `room_0${i}.gar` : `room_${i}.gar`)).then((roomArcBuff) => {
                    
                    const roomFile = ZAR.parse(roomArcBuff);
                    const roomGarFile = roomFile.files.find((file) => file.name === 'room.gar');
                    const roomGar = ZAR.parse(roomGarFile.buffer);
                    const firstCMB = roomGar.files.find((file) => file.name.endsWith('.cmb'));
                    const cmb = CMB.parse(firstCMB.buffer);

                    const cmbRenderer = new CmbRenderer(gl, textureHolder, cmb, cmb.name);
                    rooms.push(cmbRenderer);
                });
            }
    
            return new MultiScene(rooms, textureHolder);
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
    { id: "map01" },
    { id: "map02" },
    { id: "map03" },
    { id: "map04" },
    { id: "map09" },
    { id: "map10" },
    { id: "map11" },
    { id: "map12" },
    { id: "map13" },
].map((entry): SceneDesc => {
    const name = entry.id;
    return new SceneDesc(name, entry.id);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
