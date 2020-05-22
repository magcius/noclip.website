
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { assert } from "../util";
import { BSPFile } from "./BSPFile";
import { BSPRenderer, SkyboxRenderer, SourceFileSystem, SourceRenderer } from "./Main";
import { createVPKMount } from "./VPK";

class PortalSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem();
            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/portal_pak`));
            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase2}/hl2_textures`));
            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase2}/hl2_misc`));
            return filesystem;
        });

        // Clear out old filesystem pakfile.
        filesystem.pakfiles.length = 0;

        const renderer = new SourceRenderer(context, filesystem);
        const renderContext = renderer.renderContext;

        const bsp = await context.dataFetcher.fetchData(`${pathBase}/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bsp, this.id);

        if (bspFile.pakfile !== null)
            filesystem.pakfiles.push(bspFile.pakfile);

        await renderContext.materialCache.bindLocalCubemap(bspFile.cubemaps[0]);

        // Build skybox from worldname.
        const worldspawn = bspFile.entities[0];
        assert(worldspawn.classname === 'worldspawn');
        if (worldspawn.skyname)
            renderer.skyboxRenderer = new SkyboxRenderer(renderContext, worldspawn.skyname);

        const bspRenderer = new BSPRenderer(renderContext, bspFile);
        renderer.bspRenderers.push(bspRenderer);

        return renderer;
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

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
