
import * as Viewer from '../viewer';
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import Progressable from "../Progressable";
import { fetchData } from "../fetch";
import * as BIN from "./bin";
import { BINModelData, BINModelInstance, KatamariDamacyRenderer } from './render';
import { mat4 } from 'gl-matrix';

const pathBase = `katamari_damacy`;

class KatamariLevelSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return Progressable.all([
            fetchData(`${pathBase}/1879b0/135b75.bin`, abortSignal),
            fetchData(`${pathBase}/1879b0/135049.bin`, abortSignal),
            fetchData(`${pathBase}/17f590/13d9bd.bin`, abortSignal),
            fetchData(`${pathBase}/17f590/13da02.bin`, abortSignal),
            fetchData(`${pathBase}/17f590/13da55.bin`, abortSignal),
            fetchData(`${pathBase}/17f590/13daa6.bin`, abortSignal),
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
                    // binModelInstance.setUseTexture(false);
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
                const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelData);
                mat4.mul(binModelInstance.modelMatrix, binModelInstance.modelMatrix, objectSpawn.modelMatrix);
                renderer.modelInstances.push(binModelInstance);
            }

            renderer.finish(device, renderer.viewRenderer);
            return renderer;
        });
    }
}

const id = 'katamari_damacy';
const name = 'Katamari Damacy';
const sceneDescs = [
    new KatamariLevelSceneDesc('13698a', "Make a Star 1"),
];
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
