
import * as Viewer from '../viewer';
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import Progressable from "../Progressable";
import { fetchData } from "../fetch";
import * as BIN from "./bin";
import { BINModelData, BINModelInstance, KatamariDamacyRenderer } from './render';
import { mat4 } from 'gl-matrix';
import * as UI from '../ui';

const pathBase = `katamari_damacy`;

class KatamariTwiceLevelSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return Progressable.all([
            fetchData(`${pathBase}/1879b0/135b75.bin`, abortSignal),
            fetchData(`${pathBase}/1879b0/135049.bin`, abortSignal),
            fetchData(`${pathBase}/1879b0/135c43.bin`, abortSignal),
            fetchData(`${pathBase}/1879b0/1350c3.bin`, abortSignal),
        ]).then(([levelModelBinData1, levelTextureBinData1, levelModelBinData2, levelTextureBinData2]) => {
            const renderer = new KatamariDamacyRenderer(device);

            const instance1: BINModelInstance[] = [];
            {
                const gsMemoryMap = BIN.gsMemoryMapNew();

                BIN.parseLevelTextureBIN(levelTextureBinData1, gsMemoryMap);
                const levelModelBin = BIN.parseLevelModelBIN(levelModelBinData1, gsMemoryMap, `twice0`);

                for (let i = 0; i < levelModelBin.sectors.length; i++) {
                    const sector = levelModelBin.sectors[i];
                    renderer.textureHolder.addBINTexture(device, sector);

                    for (let j = 0; j < sector.models.length; j++) {
                        const binModelData = new BINModelData(device, sector.models[j]);
                        renderer.modelData.push(binModelData);
                        const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelData);
                        instance1.push(binModelInstance);
                        renderer.modelInstances.push(binModelInstance);
                    }
                }
            }

            const instance2: BINModelInstance[] = [];
            {
                const gsMemoryMap = BIN.gsMemoryMapNew();

                BIN.parseLevelTextureBIN(levelTextureBinData2, gsMemoryMap);
                const levelModelBin = BIN.parseLevelModelBIN(levelModelBinData2, gsMemoryMap, `twice1`);

                for (let i = 0; i < levelModelBin.sectors.length; i++) {
                    const sector = levelModelBin.sectors[i];
                    renderer.textureHolder.addBINTexture(device, sector);

                    for (let j = 0; j < sector.models.length; j++) {
                        const binModelData = new BINModelData(device, sector.models[j]);
                        renderer.modelData.push(binModelData);
                        const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelData);
                        instance2.push(binModelInstance);
                        renderer.modelInstances.push(binModelInstance);
                    }
                }
            }

            renderer.finish(device, renderer.viewRenderer);
            (renderer as any).setTwice = (i: number) => {
                instance1.forEach((m) => m.visible = i === 0);
                instance2.forEach((m) => m.visible = i === 1);
            };
            return renderer;
        });
    }
}

class KatamariLevelSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public levelModelFile: string, public levelTexFile: string, public levelSetupFiles: string[], public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return Progressable.all([
            fetchData(`${pathBase}/1879b0/${this.levelModelFile}.bin`, abortSignal),
            fetchData(`${pathBase}/1879b0/${this.levelTexFile}.bin`, abortSignal),
            ... this.levelSetupFiles.map((filename) => {
                return fetchData(`${pathBase}/17f590/${filename}.bin`);
            }),
        ]).then(([levelModelBinData, levelTextureBinData, ...levelSetupBinDatas]) => {
            const gsMemoryMap = BIN.gsMemoryMapNew();
            BIN.parseLevelTextureBIN(levelTextureBinData, gsMemoryMap);
            const levelModelBin = BIN.parseLevelModelBIN(levelModelBinData, gsMemoryMap, this.id);

            const renderer = new KatamariDamacyRenderer(device);

            for (let i = 0; i < levelModelBin.sectors.length; i++) {
                const sector = levelModelBin.sectors[i];
                renderer.textureHolder.addBINTexture(device, sector);

                for (let j = 0; j < sector.models.length; j++) {
                    const binModelData = new BINModelData(device, sector.models[j]);
                    renderer.modelData.push(binModelData);
                    const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelData);
                    renderer.modelInstances.push(binModelInstance);
                }
            }

            // Now parse through the level setup data.
            const levelSetupBin = BIN.parseLevelSetupBIN(levelSetupBinDatas, gsMemoryMap);

            const objectDatas: BINModelData[] = [];
            for (let i = 0; i < levelSetupBin.objectModels.length; i++) {
                const objectModel = levelSetupBin.objectModels[i];
                renderer.textureHolder.addBINTexture(device, objectModel);

                // Just do the first model for now.
                const binModelData = new BINModelData(device, objectModel.models[0]);
                objectDatas.push(binModelData);
                renderer.modelData.push(binModelData);
            }

            for (let i = 0; i < levelSetupBin.objectSpawns.length; i++) {
                const objectSpawn = levelSetupBin.objectSpawns[i];
                const binModelData = objectDatas[objectSpawn.modelIndex];
                const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelData, objectSpawn.spawnLayoutIndex);
                mat4.mul(binModelInstance.modelMatrix, binModelInstance.modelMatrix, objectSpawn.modelMatrix);
                renderer.modelInstances.push(binModelInstance);
            }

            // TODO(jstpierre): Ugly.
            renderer.createPanels = () => {
                const layers: UI.Layer[] = levelSetupBin.spawnLayouts.map((index): UI.Layer => {
                    let name = `Object Layout ${index}`;
                    const o = { name, visible: true, setVisible: (visible: boolean) => {
                        o.visible = visible;
                        for (let i = 0; i < renderer.modelInstances.length; i++)
                            if (renderer.modelInstances[i].layer === index)
                                renderer.modelInstances[i].visible = visible;
                    } };
                    return o;
                });

                if (this.levelModelFile !== '135b75') {
                    // Hide all other layers by default (causes Z-fighting on non-House levels)
                    for (let i = 1; i < layers.length; i++)
                        layers[i].setVisible(false);
                }

                const layersPanel = new UI.LayerPanel(layers);
                return [layersPanel];
            };

            renderer.finish(device, renderer.viewRenderer);
            return renderer;
        });
    }
}

const id = 'katamari_damacy';
const name = 'Katamari Damacy';
const sceneDescs = [
    new KatamariLevelSceneDesc('lvl1',  '135b75', '135049', ['13d9bd', '13da02', '13da55', '13daa6'], "Make a Star 1 (House)"),
    new KatamariLevelSceneDesc('lvl2',  '135b75', '135049', ['13daff', '13db9c', '13dc59', '13dd08'], "Make a Star 2 (House)"),
    new KatamariLevelSceneDesc('lvl3',  '135ebf', '135231', ['13e462', '13e553', '13e68e', '13e7b1'], "Make a Star 3 (City)"),
    new KatamariLevelSceneDesc('lvl4',  '135b75', '135049', ['13ddc6', '13df3f', '13e10e', '13e2b1'], "Make a Star 4 (House)"),
    new KatamariLevelSceneDesc('lvl5',  '135ebf', '135231', ['13e8d2', '13ea87', '13eca3', '13eeb0'], "Make a Star 5 (City)"),
    new KatamariLevelSceneDesc('lvl6',  '1363c5', '1353d1', ['13f0b4', '13f244', '13f443', '13f605'], "Make a Star 6 (World)"),
    new KatamariLevelSceneDesc('lvl7',  '1363c5', '1353d1', ['13f7c8', '13f97f', '13fbad', '13fda5'], "Make a Star 7 (World)"),
    new KatamariLevelSceneDesc('lvl8',  '135ebf', '135231', ['13ff91', '14017a', '1403d3', '140616'], "Make a Star 8 (City)"),
    new KatamariLevelSceneDesc('lvl9',  '1363c5', '1353d1', ['140850', '140a3e', '140cc7', '140f02'], "Make a Star 9 (World)"),
    new KatamariLevelSceneDesc('lvl10', '1363c5', '1353d1', ['141133', '141339', '1415d4', '141829'], "Make a Star 10 (World)"),
];
const sceneIdMap = new Map<string, string>();
// When I first was testing Katamari, I was testing the Tutorial Level. At some point
// I changed to Make a Star 1, but didn't change the ID before pushing live. So that's
// why the level file for the Tutorial maps to Make a Star 1.
sceneIdMap.set('13698a', 'lvl1');
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, sceneIdMap };
