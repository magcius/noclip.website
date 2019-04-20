
import * as Viewer from '../viewer';
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import Progressable from "../Progressable";
import { fetchData } from "../fetch";
import * as BIN from "./bin";
import { BINModelData, BINModelInstance, KatamariDamacyRenderer } from './render';

const pathBase = `katamari_damacy`;

class KatamariLevelSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return Progressable.all([
            fetchData(`${pathBase}/1879b0/13698a.bin`, abortSignal),
            fetchData(`${pathBase}/1879b0/13594d.bin`, abortSignal),
        ]).then(([levelModelBin, levelTextureBin]) => {
            const gsMemoryMap = BIN.gsMemoryMapNew();
            BIN.parseLevelTextureBIN(levelTextureBin, gsMemoryMap, this.id);
            const bin = BIN.parseModelBIN(levelModelBin, gsMemoryMap, this.id);

            const renderer = new KatamariDamacyRenderer(device);
            const binModelData = new BINModelData(device, bin.models[0]);
            renderer.modelData.push(binModelData);
            renderer.textureHolder.addBINTexture(device, bin);
            const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelData);
            renderer.modelInstances.push(binModelInstance);
            renderer.finish(device, renderer.viewRenderer);
            return renderer;
        });
    }
}

class KatamariObjectSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(`${pathBase}/180e50/${this.id}.bin`, abortSignal).then((buffer) => {
            const gsMemoryMap = BIN.gsMemoryMapNew();
            const bin = BIN.parseModelBIN(buffer, gsMemoryMap, this.id);

            const renderer = new KatamariDamacyRenderer(device);
            const binModelData = new BINModelData(device, bin.models[0]);
            renderer.modelData.push(binModelData);
            renderer.textureHolder.addBINTexture(device, bin);
            const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelData);
            renderer.modelInstances.push(binModelInstance);
            renderer.finish(device, renderer.viewRenderer);
            return renderer;
        });
    }
}

const id = 'katamari_damacy';
const name = 'Katamari Damacy';
const sceneDescs = [
    new KatamariObjectSceneDesc('137e66', "Boombox"),
    // new KatamariLevelSceneDesc('13698a', "Tutorial Level"),
];
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
