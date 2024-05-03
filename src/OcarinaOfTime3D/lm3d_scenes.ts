
// Luigi's Mansion 3D

import * as CMB from './cmb.js';
import * as CMAB from './cmab.js';
import * as CSAB from './csab.js';
import * as ZAR from './zar.js';
import * as BCSV from '../LuigisMansion/bcsv.js';
import * as CTXB from './ctxb.js';

import * as Viewer from '../viewer.js';

import { CmbInstance, CmbData } from './render.js';
import { SceneGroup } from '../viewer.js';
import { leftPad, assertExists, nArray, assert } from '../util.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GrezzoTextureHolder, MultiCmbScene } from './scenes.js';
import { computeModelMatrixSRT, scaleMatrix } from '../MathHelpers.js';
import { SceneContext } from '../SceneBase.js';
import { ZSIEnvironmentSettings } from './zsi.js';
import { colorFromRGBA } from '../Color.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';

function bcsvHashLM(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash <<= 8;
        hash >>>= 0;
        hash += str.charCodeAt(i);
        // const r6 = Math.floor((4993 * hash) >>> 32);
        const r6 = Math.floor((((4993 * hash)) >>> 32) / 0x100000000);
        const r0 = ((((hash - r6) / 2) + r6) >> 24);
        hash -= (r0 * 33554393);
    }
    
    return hash;
}

function getField<T extends string | number>(bcsv: BCSV.Bcsv, record: BCSV.BcsvRecord, name: string): T | null {
    const hash = bcsvHashLM(name);
    const index = BCSV.getFieldIndexFromHash(bcsv, hash);
    if (index === -1)
        return null;
    return record[index] as T;
}

function getEntriesWithField<T extends string | number>(bcsv: BCSV.Bcsv, name: string, value: T): BCSV.Bcsv {
    const fields: BCSV.BcsvField[] = bcsv.fields;
    const records = bcsv.records.filter((record) => getField<T>(bcsv, record, name) === value);
    return { fields, records };
}

const pathBase = `LuigisMansion3D`;
class SceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public mapNumber: number, public name: string) {
        this.id = `map${mapNumber}`;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        // Fetch the ZAR & info ZSI.
        const path_gar = `${pathBase}/map/map${leftPad(''+this.mapNumber, 2, '0')}.gar`;
        const models_path = `${pathBase}/mapmdl/map${this.mapNumber}`;

        const textureHolder = new GrezzoTextureHolder();
        const dataFetcher = context.dataFetcher;

        const spawnVrbox = (renderer: MultiCmbScene, cache: GfxRenderCache, garName: string) => {
            dataFetcher.fetchData(`${pathBase}/vrbox/${garName}`).then((garBuffer) => {

                const vrGar = ZAR.parse(garBuffer);
                const firstCMB = assertExists(vrGar.files.find((file) => file.name.endsWith('.cmb')));
                
                const cmb = CMB.parse(firstCMB.buffer);
                const cmbData = new CmbData(cache, cmb);
                textureHolder.addCMB(device, cmb);
                renderer.cmbData.push(cmbData);

                const cmbRenderer = new CmbInstance(cache, textureHolder, cmbData, cmb.name);
                cmbRenderer.isSkybox = true;
                renderer.skyRenderers.push(cmbRenderer);

                const cmbBasename = firstCMB.name.split('.')[0];
                const cmabFiles = vrGar.files.filter((file) => file.name.endsWith(`.cmab`));

                for (let i = 0; i < cmabFiles.length; i++) {
                    const cmab = CMAB.parse(CMB.Version.LuigisMansion, cmabFiles[i].buffer);
                    textureHolder.addTextures(device, cmab.textures);
                    cmbRenderer.bindCMAB(cmab);
                }

                const csabFile = vrGar.files.find((file) => file.name === `${cmbBasename}.csab`);
                if (csabFile){
                    cmbRenderer.bindCSAB(CSAB.parse(CMB.Version.LuigisMansion, csabFile.buffer));
                }
            });
        }

        return dataFetcher.fetchData(path_gar).then((garBuffer) => {
            const gar = ZAR.parse(garBuffer);

            const jmpGarFile = assertExists(gar.files.find((file) => file.name === 'JMP.gar'));
            const jmpGar = ZAR.parse(jmpGarFile.buffer);
            const roomInfoFile = assertExists(jmpGar.files.find((file) => file.name === 'RoomInfo.gseb'));
            const roomInfo = BCSV.parse(roomInfoFile.buffer, true);
            const furnitureInfoFile = assertExists(jmpGar.files.find((file) => file.name === 'FurnitureInfo.gseb'));
            const furnitureInfo = BCSV.parse(furnitureInfoFile.buffer, true);
            const lightInfoFile = assertExists(jmpGar.files.find((file) => file.name === 'LightInfo.gseb'));
            const lightInfo = BCSV.parse(lightInfoFile.buffer, true);
            //const shadowInfoFile = assertExists(jmpGar.files.find((file) => file.name === 'ShadowDirectInfo.gseb'));
            //const shadowInfo = BCSV.parse(shadowInfoFile.buffer, true);

            const modelCache = new Map<string, CmbData>();

            const renderer = new MultiCmbScene(device, textureHolder);
            const cache = renderer.getRenderCache();
            const promises: Promise<void>[] = [];
            const envSettingsMap: Map<number, ZSIEnvironmentSettings> = new Map<number, ZSIEnvironmentSettings>();

            switch(this.mapNumber){
                case 9: spawnVrbox(renderer, cache, "vrkoopa.gar"); break;
                case 10:
                case 11:
                case 13:
                    spawnVrbox(renderer, cache, "vrball_b.gar"); break;
                default: spawnVrbox(renderer, cache, "vrball_m.gar"); break;
            }

            
            //TODO(M-1): This isn't right but it works for now
            for (let i = 0; i < lightInfo.records.length; i++) {
                const record = lightInfo.records[i];

                const roomNum = assertExists(getField<number>(lightInfo, record, "RoomNo"));
                const index = assertExists(getField<number>(lightInfo, record, "Type"));
                const distance = assertExists(getField<number>(lightInfo, record, "Distance"));

                if(!envSettingsMap.has(roomNum)){
                    envSettingsMap.set(roomNum, new ZSIEnvironmentSettings());
                }

                let envSettings = envSettingsMap.get(roomNum) as ZSIEnvironmentSettings;

                const light = envSettings.lights[index];
                
                const diffuseR = assertExists(getField<number>(lightInfo, record, "diffuse_x")) / 0xFF;
                const diffuseG = assertExists(getField<number>(lightInfo, record, "diffuse_y")) / 0xFF;
                const diffuseB = assertExists(getField<number>(lightInfo, record, "diffuse_z")) / 0xFF;

                const posX = assertExists(getField<number>(lightInfo, record, "pos_x"));
                const posY = assertExists(getField<number>(lightInfo, record, "pos_y"));
                const posZ = assertExists(getField<number>(lightInfo, record, "pos_z"));

                assert(posX == 0);
                assert(posY == 0);
                assert(posZ == 0);

                const ambientR = assertExists(getField<number>(lightInfo, record, "ambient_x")) / 0xFF;
                const ambientG = assertExists(getField<number>(lightInfo, record, "ambient_y")) / 0xFF;
                const ambientB = assertExists(getField<number>(lightInfo, record, "ambient_z")) / 0xFF;

                const specular0R = assertExists(getField<number>(lightInfo, record, "specular_0_x")) / 0xFF;
                const specular0G = assertExists(getField<number>(lightInfo, record, "specular_0_y")) / 0xFF;
                const specular0B = assertExists(getField<number>(lightInfo, record, "specular_0_z")) / 0xFF;

                const specular1R = assertExists(getField<number>(lightInfo, record, "specular_1_x")) / 0xFF;
                const specular1G = assertExists(getField<number>(lightInfo, record, "specular_1_y")) / 0xFF;
                const specular1B = assertExists(getField<number>(lightInfo, record, "specular_1_z")) / 0xFF;

                colorFromRGBA(light.diffuse, diffuseR, diffuseG, diffuseB);
                colorFromRGBA(light.ambient, ambientR, ambientG, ambientB);
                colorFromRGBA(light.specular0, specular0R, specular0G, specular0B);
                colorFromRGBA(light.specular1, specular1R, specular1G, specular1B);
            }

            for (let i = 0; i < roomInfo.records.length; i++) {
                promises.push(dataFetcher.fetchData(`${models_path}/room_${leftPad(''+i, 2, '0')}.gar`).then((outerRoomGarBuf) => {
                    const outerRoomGar = ZAR.parse(outerRoomGarBuf);
                    const roomGarFile = outerRoomGar.files.find((file) => file.name === 'room.gar');
                    if (roomGarFile === undefined)
                        return;

                    const roomGar = ZAR.parse(roomGarFile.buffer);

                    //const isSkyboxEnabled = (assertExists(getField<number>(roomInfo, roomInfo.records[i], "VRbox"))) === 0;
                    //const skyboxType = assertExists(getField<number>(roomInfo, roomInfo.records[i], "VRboxType"));
                    //assert(skyboxType === 0);

                    // TODO(jstpierre): How does the engine know which CMB file to spawn?
                    const firstCMB = assertExists(roomGar.files.find((file) => file.name.endsWith('.cmb')));
                    const cmb = CMB.parse(firstCMB.buffer);
                    const ctxbFiles = roomGar.files.filter((file) => file.name.endsWith('.ctxb'));

                    for (let i = 0; i < ctxbFiles.length; i++) {
                        const ctxb = CTXB.parse(ctxbFiles[i].buffer);
                        textureHolder.addCTXB(device, ctxb);
                    }

                    const cmbData = new CmbData(cache, cmb);
                    textureHolder.addCMB(device, cmb);
                    renderer.cmbData.push(cmbData);

                    let envSettings = envSettingsMap.get(i) as ZSIEnvironmentSettings;

                    if(envSettings === undefined){
                        envSettings = envSettingsMap.get(0) as ZSIEnvironmentSettings;
                    }
                    
                    const cmbRenderer = new CmbInstance(cache, textureHolder, cmbData, cmb.name);
                    cmbRenderer.setEnvironmentSettings(envSettings);
                    renderer.cmbRenderers.push(cmbRenderer);

                    const cmbBasename = firstCMB.name.split('.')[0];
                    const cmabFile = roomGar.files.find((file) => file.name === `${cmbBasename}.cmab`);
                    if (cmabFile) {
                        const cmab = CMAB.parse(CMB.Version.LuigisMansion, cmabFile.buffer);
                        textureHolder.addTextures(device, cmab.textures);
                        cmbRenderer.bindCMAB(cmab);
                    }

                    const roomFurnitureEntries: BCSV.Bcsv = getEntriesWithField(furnitureInfo, "room_no", i);
                    for (let j = 0; j < roomFurnitureEntries.records.length; j++) {
                        const record = roomFurnitureEntries.records[j];

                        const cmbFilename = assertExists(getField<string>(roomFurnitureEntries, record, "dmd_name"));
                        const cmbFile = outerRoomGar.files.find((file) => file.name == `${cmbFilename}.cmb`);

                        // TODO(jstpierre): What to do if the file is missing?
                        if (cmbFile === undefined)
                            continue;

                        let cmbData: CmbData | undefined = modelCache.get(cmbFilename);
                        if (cmbData === undefined) {
                            const cmb = CMB.parse(cmbFile.buffer);
                            cmbData = new CmbData(cache, cmb);
                            textureHolder.addTextures(device, cmb.textures);
                            renderer.cmbData.push(cmbData);
                            modelCache.set(cmbFilename, cmbData);
                        }

                        const cmbRenderer = new CmbInstance(cache, textureHolder, cmbData, cmb.name);
                        cmbRenderer.setEnvironmentSettings(envSettings);

                        const rotationX = assertExists(getField<number>(roomFurnitureEntries, record, "dir_x")) / 180 * Math.PI;
                        const rotationY = assertExists(getField<number>(roomFurnitureEntries, record, "dir_y")) / 180 * Math.PI;
                        const rotationZ = assertExists(getField<number>(roomFurnitureEntries, record, "dir_z")) / 180 * Math.PI;
                        const translationX = assertExists(getField<number>(roomFurnitureEntries, record, "pos_x"));
                        const translationY = assertExists(getField<number>(roomFurnitureEntries, record, "pos_y"));
                        const translationZ = assertExists(getField<number>(roomFurnitureEntries, record, "pos_z"));
                        computeModelMatrixSRT(cmbRenderer.modelMatrix, 1, 1, 1, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

                        renderer.cmbRenderers.push(cmbRenderer);
                    }
                }));
            }

            return dataFetcher.waitForLoad().then(() => {
                return renderer;
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