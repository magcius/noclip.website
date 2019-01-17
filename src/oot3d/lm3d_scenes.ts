
// Luigi's Mansion 3D

import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as ZAR from './zar';
import * as BCSV from '../luigis_mansion/bcsv';
import * as CTXB from './ctxb';

import * as Viewer from '../viewer';

import Progressable from '../Progressable';
import { CmbRenderer } from './render';
import { SceneGroup } from '../viewer';
import { fetchData } from '../fetch';
import { leftPad } from '../util';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GrezzoTextureHolder, MultiCmbScene } from './scenes';

class SceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public mapNumber: number, public name: string) {
        this.id = `map${mapNumber}`;
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        // Fetch the ZAR & info ZSI.
        const path_gar = `data/lm3d/map/map${leftPad(''+this.mapNumber, 2, '0')}.gar`;
        const models_path = `data/lm3d/mapmdl/map${this.mapNumber}`;

        const textureHolder = new GrezzoTextureHolder();

        return fetchData(path_gar, abortSignal).then((garBuffer) => {
            const gar = ZAR.parse(garBuffer);

            const jmpGarFile = gar.files.find((file) => file.name === 'JMP.gar');
            const jmpGar = ZAR.parse(jmpGarFile.buffer);
            const roomInfoFile = jmpGar.files.find((file) => file.name === 'RoomInfo.gseb');
            const roomInfo = BCSV.parse(roomInfoFile.buffer, true);

            const progressables: Progressable<CmbRenderer>[] = [];
            for (let i = 0; i < roomInfo.records.length; i++) {
                progressables.push(fetchData(`${models_path}/room_${leftPad(''+i, 2, '0')}.gar`, abortSignal).then((outerRoomGarBuf) => {
                    const outerRoomGar = ZAR.parse(outerRoomGarBuf);
                    const roomGarFile = outerRoomGar.files.find((file) => file.name === 'room.gar');
                    if (roomGarFile === undefined)
                        return null;

                    const roomGar = ZAR.parse(roomGarFile.buffer);

                    // TODO(jstpierre): How does the engine know which CMB file to spawn?
                    const firstCMB = roomGar.files.find((file) => file.name.endsWith('.cmb'));

                    const cmb = CMB.parse(firstCMB.buffer);
                    const ctxbFiles = roomGar.files.filter((file) => file.name.endsWith('.ctxb'));

                    for (let i = 0; i < ctxbFiles.length; i++) {
                        const ctxb = CTXB.parse(ctxbFiles[i].buffer);
                        textureHolder.addCTXB(device, ctxb);
                    }

                    const cmbRenderer = new CmbRenderer(device, textureHolder, cmb, cmb.name);

                    const cmbBasename = firstCMB.name.split('.')[0];
                    const cmabFile = roomGar.files.find((file) => file.name === `${cmbBasename}.cmab`);
                    if (cmabFile) {
                        const cmab = CMAB.parse(CMB.Version.LuigisMansion, cmabFile.buffer);
                        textureHolder.addTextures(device, cmab.textures);
                        cmbRenderer.bindCMAB(cmab, 1);
                    }

                    return cmbRenderer;
                }));
            }

            return Progressable.all(progressables).then((scenes) => {
                scenes = scenes.filter(s => !!s);
                return new MultiCmbScene(device, scenes, textureHolder);
            });
        });
    }
}

const id = "lm3d";
const name = "Luigi's Mansion 3D";
const sceneDescs: SceneDesc[] = [
    { mapNumber: 2, name: "Main Mansion" },
    // h_01.bin is a duplicate of the room.bin found in hakase.arc
    { mapNumber: 1, name: "E Gadd's Garage", },
    { mapNumber: 3, name: "Training Room", },
    { mapNumber: 4, name: "Ghost Portrificationizer", },
    { mapNumber: 5, name: "Gallery", },
    { mapNumber: 9, name: "King Boo Boss Arena", },
    { mapNumber: 10, name: "Chauncey Boss Arena", },
    { mapNumber: 11, name: "Boolossus Boss Arena", },
    { mapNumber: 13, name: "Bogmire Boss Arena", },
    { mapNumber: 12, name: "Ghost Portrificationizer (End Credits)", },
].map((entry): SceneDesc => {
    return new SceneDesc(entry.mapNumber, entry.name);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
