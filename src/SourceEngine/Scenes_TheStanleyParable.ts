

import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { decodeString } from "../util";
import { CustomMount, SourceFileSystem } from "./Main";
import { createScene } from "./Scenes";

class TheStanleyParableDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase2}/hl2_textures`),
                filesystem.createVPKMount(`${pathBase2}/hl2_misc`),
            ]);
            const dir = decodeString(await context.dataFetcher.fetchData(`${pathBase}/thestanleyparable/dir.txt`));
            const files = dir.split('\n');
            filesystem.custom.push(new CustomMount(`${pathBase}/thestanleyparable`, files));
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${pathBase}/thestanleyparable/maps/${this.id}.bsp`);
    }
}

const pathBase = `TheStanleyParable`;
const pathBase2 = `HalfLife2`;

const id = 'TheStanleyParable';
const name = 'The Stanley Parable';
const sceneDescs = [
    new TheStanleyParableDesc("zending"),
    new TheStanleyParableDesc("babygame"),
    new TheStanleyParableDesc("blockbase"),
    new TheStanleyParableDesc("buttonworld"),
    new TheStanleyParableDesc("freedom"),
    new TheStanleyParableDesc("incorrect"),
    new TheStanleyParableDesc("map"),
    new TheStanleyParableDesc("map_death"),
    new TheStanleyParableDesc("map_one"),
    new TheStanleyParableDesc("map_two"),
    new TheStanleyParableDesc("map1"),
    new TheStanleyParableDesc("map2"),
    new TheStanleyParableDesc("redstair"),
    new TheStanleyParableDesc("seriousroom"),
    new TheStanleyParableDesc("testchmb_a_00"),
    new TheStanleyParableDesc("thefirstmap"),
    new TheStanleyParableDesc("theonlymap"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
