
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem, SourceLoadContext } from "./Main";
import { createScene } from "./Scenes";

class CounterStrikeSourceSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/cstrike_pak`),
                filesystem.createVPKMount(`HalfLife2/hl2_textures`),
                filesystem.createVPKMount(`HalfLife2/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

const pathBase = `CounterStrikeSource`;

const id = 'CounterStrikeSource';
const name = 'Counter-Strike: Source';
const sceneDescs = [

    "Hostage Rescue",
    new CounterStrikeSourceSceneDesc('cs_assault'),
    new CounterStrikeSourceSceneDesc('cs_compound'),
    new CounterStrikeSourceSceneDesc('cs_havana'),
    new CounterStrikeSourceSceneDesc('cs_italy'),
    new CounterStrikeSourceSceneDesc('cs_militia'),
    new CounterStrikeSourceSceneDesc('cs_office'),
    "Defuse",
    new CounterStrikeSourceSceneDesc('de_aztec'),
    new CounterStrikeSourceSceneDesc('de_cbble'),
    new CounterStrikeSourceSceneDesc('de_chateau'),
    new CounterStrikeSourceSceneDesc('de_dust'),
    new CounterStrikeSourceSceneDesc('de_dust2'),
    new CounterStrikeSourceSceneDesc('de_inferno'),
    new CounterStrikeSourceSceneDesc('de_nuke'),
    new CounterStrikeSourceSceneDesc('de_piranesi'),
    new CounterStrikeSourceSceneDesc('de_port'),
    new CounterStrikeSourceSceneDesc('de_prodigy'),
    new CounterStrikeSourceSceneDesc('de_tides'),
    new CounterStrikeSourceSceneDesc('de_train'),
    "Other",
    new CounterStrikeSourceSceneDesc('test_hardware'),
    new CounterStrikeSourceSceneDesc('test_speakers'),
    
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
