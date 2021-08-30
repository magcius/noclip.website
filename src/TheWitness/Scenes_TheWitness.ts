
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

        const globals = new TheWitnessGlobals(device);
        globals.asset_manager = asset_manager;
        globals.entity_manager.load_world(globals);

        const r = new TheWitnessRenderer(device, globals);

        /*
        const mesh = asset_manager.load_asset(Asset_Type.Mesh, 'loc_hub_church_tower');
        const g = new Mesh_Instance(globals, mesh);
        r.mesh_instance_array.push(g);

        const lightmap = asset_manager.load_asset(Asset_Type.Lightmap, 'save_187171_00');
        console.log(lightmap);
        */

        return r;
    }
}

const sceneDescs = [
    new TheWitnessSceneDesc('main', 'Main'),
]

const id = "TheWitness";
const name = "The Witness";
export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
