
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { EmptyScene } from "../Scenes_Test.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx } from "../viewer.js";
import * as BSA from "./BSA.js";
import * as ESM from "./ESM.js";
import { MorrowindRenderer, PluginData, RenderGlobals } from "./Render.js";

const pathBase = `Morrowind`;

class MorrowindSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const renderGlobals = await context.dataShare.ensureObject(`${pathBase}/Morrowind`, async () => {
            const dataFetcher = context.dataFetcher;
            const [bsa, esm] = await Promise.all([
                (async() => new BSA.BSA(await dataFetcher.fetchData(`${pathBase}/Morrowind.bsa`)))(),
                (async() => new ESM.ESM(await dataFetcher.fetchData(`${pathBase}/Morrowind.esm`)))(),
            ]);
            const pluginData = new PluginData([bsa], esm);
            return new RenderGlobals(context.device, pluginData);
        });
        return new MorrowindRenderer(context, renderGlobals);
    }
}

const sceneDescs = [
    new MorrowindSceneDesc('Morrowind'),
];

const id = `Morrowind`;
const name = `Morrowind`;
export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
