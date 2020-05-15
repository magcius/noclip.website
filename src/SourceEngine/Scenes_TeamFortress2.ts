
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { assert } from "../util";
import { BSPFile } from "./BSPFile";
import { BSPRenderer, SkyboxRenderer, SourceFileSystem, SourceRenderer } from "./Main";
import { createVPKMount } from "./VPK";

const pathBase = `TeamFortress2`;

class TeamFortress2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem();
            // According to gameinfo.txt, it first mounts TF2 and then HL2.
            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/tf/tf2_textures`));
            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/tf/tf2_misc`));

            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/hl2/hl2_textures`));
            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/hl2/hl2_misc`));
            return filesystem;
        });

        // Clear out old filesystem pakfile.
        filesystem.pakfiles.length = 0;

        const renderer = new SourceRenderer(context, filesystem);
        const renderContext = renderer.renderContext;

        const bsp = await context.dataFetcher.fetchData(`${pathBase}/tf/maps/${this.id}.bsp`);
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

const id = 'TeamFortress2';
const name = 'Team Fortress 2';
const sceneDescs = [
    new TeamFortress2SceneDesc('background01'),
    new TeamFortress2SceneDesc('cp_dustbowl'),
    new TeamFortress2SceneDesc('ctf_2fort'),
    new TeamFortress2SceneDesc('plr_hightower'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
