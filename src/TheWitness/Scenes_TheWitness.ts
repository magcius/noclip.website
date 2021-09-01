
import { SceneGroup, SceneDesc, SceneGfx } from "../viewer";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext } from "../SceneBase";
import * as ZipFile from '../ZipFile';
import { Asset_Manager, Asset_Type } from "./Assets";
import { TheWitnessGlobals } from "./Globals";
import { TheWitnessRenderer } from "./Render";

const pathBase = `TheWitness`;

class TheWitnessSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const asset_manager = new Asset_Manager(device);
        const zip = ZipFile.parseZipFile(await context.dataFetcher.fetchData(`${pathBase}/data-pc.zip`));
        asset_manager.add_bundle(zip);

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
