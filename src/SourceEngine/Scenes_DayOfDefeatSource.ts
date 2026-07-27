
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SourceFileSystem, SourceLoadContext } from "./Main.js";
import { createScene } from "./Scenes.js";

class DayOfDefeatSourceSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/dod_pak`),
                filesystem.createVPKMount(`HalfLife2/hl2_textures`),
                filesystem.createVPKMount(`HalfLife2/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

const pathBase = `DayOfDefeatSource`;

const id = 'DayOfDefeatSource';
const name = 'Day of Defeat: Source';
const sceneDescs = [
    new DayOfDefeatSourceSceneDesc('dod_anzio'),
    new DayOfDefeatSourceSceneDesc('dod_argentan'),
    new DayOfDefeatSourceSceneDesc('dod_avalanche'),
    new DayOfDefeatSourceSceneDesc('dod_colmar'),
    new DayOfDefeatSourceSceneDesc('dod_donner'),
    new DayOfDefeatSourceSceneDesc('dod_flash'),
    new DayOfDefeatSourceSceneDesc('dod_jagd'),
    new DayOfDefeatSourceSceneDesc('dod_kalt'),
    new DayOfDefeatSourceSceneDesc('dod_palermo'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
