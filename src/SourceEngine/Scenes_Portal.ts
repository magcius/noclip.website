
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
            filesystem.createVPKMount(`${pathBase}/portal_pak`);
            filesystem.createVPKMount(`${pathBase2}/hl2_textures`);
            filesystem.createVPKMount(`${pathBase2}/hl2_misc`);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

const pathBase = `Portal`;
const pathBase2 = `HalfLife2`;

const id = 'Portal';
const name = 'Portal';
const sceneDescs = [
    new PortalSceneDesc('background1'),
    new PortalSceneDesc('testchmb_a_00'),
    new PortalSceneDesc('testchmb_a_01'),
    new PortalSceneDesc('testchmb_a_02'),
    new PortalSceneDesc('testchmb_a_03'),
    new PortalSceneDesc('testchmb_a_04'),
    new PortalSceneDesc('testchmb_a_05'),
    new PortalSceneDesc('testchmb_a_06'),
    new PortalSceneDesc('testchmb_a_07'),
    new PortalSceneDesc('testchmb_a_08'),
    new PortalSceneDesc('testchmb_a_09'),
    new PortalSceneDesc('testchmb_a_10'),
    new PortalSceneDesc('testchmb_a_11'),
    new PortalSceneDesc('testchmb_a_13'),
    new PortalSceneDesc('testchmb_a_14'),
    new PortalSceneDesc('testchmb_a_15'),
    new PortalSceneDesc('escape_00'),
    new PortalSceneDesc('escape_01'),
    new PortalSceneDesc('escape_02'),
    new PortalSceneDesc('testchmb_a_08_advanced'),
    new PortalSceneDesc('testchmb_a_09_advanced'),
    new PortalSceneDesc('testchmb_a_10_advanced'),
    new PortalSceneDesc('testchmb_a_11_advanced'),
    new PortalSceneDesc('testchmb_a_13_advanced'),
    new PortalSceneDesc('testchmb_a_14_advanced'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
