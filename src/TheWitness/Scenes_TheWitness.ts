
import { SceneGroup, SceneDesc, SceneGfx } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../SceneBase.js";
import * as ZipFile from '../ZipFile.js';
import { Asset_Manager } from "./Assets.js";
import { TheWitnessGlobals } from "./Globals.js";
import { TheWitnessRenderer } from "./Render.js";

const pathBase = `TheWitness`;

class TheWitnessSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const asset_manager = new Asset_Manager(device);
        const zip = ZipFile.parseZipFile(await context.dataFetcher.fetchData(`${pathBase}/data-pc.zip`));
        asset_manager.load_root_bundle(zip);
        asset_manager.load_package('globals');

        asset_manager.load_package('save_common');
        asset_manager.load_package('save_shared');

        const globals = new TheWitnessGlobals(device, asset_manager);
        globals.entity_manager.load_world(globals);

        return new TheWitnessRenderer(device, globals);
    }
}

const sceneDescs = [
    new TheWitnessSceneDesc('main', 'Main'),
]

const id = "TheWitness";
const name = "The Witness";
export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
