
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem } from "./Main";
import { createScene } from "./Scenes";

class PortalSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/portal_pak`),
                filesystem.createVPKMount(`${pathBase2}/hl2_textures`),
                filesystem.createVPKMount(`${pathBase2}/hl2_misc`),
            ]);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

const pathBase = `Portal`;
const pathBase2 = `HalfLife2`;

const id = 'Portal';
const name = 'Portal';
// Level names by stopmotio (you can credit me in other ways if you prefer, this method was copied from mkwii)
const sceneDescs = [
    "Campaign",
    new PortalSceneDesc('background1' , "Title screen background"),
    new PortalSceneDesc('testchmb_a_00', "Wake up and Testchamber 1"),
    new PortalSceneDesc('testchmb_a_01', "Testchambers 2 and 3"),
    new PortalSceneDesc('testchmb_a_02', "Testchambers 4 and 5"),
    new PortalSceneDesc('testchmb_a_03', "Testchambers 6, 7"),
    new PortalSceneDesc('testchmb_a_04', "Testchamber 8"),
    new PortalSceneDesc('testchmb_a_05', "Testchamber 9"),
    new PortalSceneDesc('testchmb_a_06', "Testchamber 10"),
    new PortalSceneDesc('testchmb_a_07', "Testchambers 11, 12"),
    new PortalSceneDesc('testchmb_a_08', "Testchamber 13"),
    new PortalSceneDesc('testchmb_a_09', "Testchamber 14"),
    new PortalSceneDesc('testchmb_a_10', "Testchamber 15"),
    new PortalSceneDesc('testchmb_a_11', "Testchamber 16"), //there is no testchmb_a_12 matpat create a dumb theory about that already
    new PortalSceneDesc('testchmb_a_13', "Testchamber 17"),
    new PortalSceneDesc('testchmb_a_14', "Testchamber 18"),
    new PortalSceneDesc('testchmb_a_15', "Testchamber 19"), //Plus attempted murder
    new PortalSceneDesc('escape_00', "Escape part 1"),
    new PortalSceneDesc('escape_01', "Escape part 2"),
    new PortalSceneDesc('escape_02', "GLaDOS fight"),
    "Challenge Mode",
    new PortalSceneDesc('testchmb_a_08_advanced', "Testchamber 13"),
    new PortalSceneDesc('testchmb_a_09_advanced', "Testchamber 14"),
    new PortalSceneDesc('testchmb_a_10_advanced', "Testchamber 15"),
    new PortalSceneDesc('testchmb_a_11_advanced', "Testchamber 16"),
    new PortalSceneDesc('testchmb_a_13_advanced', "Testchamber 17"),
    new PortalSceneDesc('testchmb_a_14_advanced', "Testchamber 18"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
