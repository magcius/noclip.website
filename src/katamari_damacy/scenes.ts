
import * as Viewer from '../viewer';
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import Progressable from "../Progressable";
import { fetchData } from "../fetch";
import * as BIN from "./bin";
import { BINModelData, BINModelInstance, KatamariDamacyRenderer } from './render';

const pathBase = `katamari_damacy`;

class KatamariSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(`${pathBase}/180e50/${this.id}.bin`, abortSignal).then((buffer) => {
            const bin = BIN.parse(buffer);
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
    new KatamariSceneDesc('137e66', "Boombox"),
];
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
