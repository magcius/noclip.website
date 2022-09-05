
import { DataFetcher, NamedArrayBufferSlice } from "../DataFetcher";
import { SceneContext } from "../SceneBase";
import { assertExists } from "../util";
import { BSPFile } from "./BSPFile";
import { GMA } from "./GMA";
import { BSPRenderer, SkyboxRenderer, SourceFileSystem, SourceLoadContext, SourceRenderContext, SourceRenderer } from "./Main";

export async function createKitchenSinkSourceFilesytem(dataFetcher: DataFetcher): Promise<SourceFileSystem> {
    const filesystem = new SourceFileSystem(dataFetcher);
    // Mount all the things!
    await Promise.all([
        // filesystem.createVPKMount(`CounterStrikeGO/pak01`),
        filesystem.createVPKMount(`CounterStrikeSource/cstrike_pak`),
        filesystem.createVPKMount(`TeamFortress2/tf/tf2_textures`),
        filesystem.createVPKMount(`TeamFortress2/tf/tf2_misc`),
        filesystem.createVPKMount(`Portal2/portal2/pak01`),
        filesystem.createVPKMount(`Portal2/portal2_dlc1/pak01`),
        filesystem.createVPKMount(`Portal2/portal2_dlc2/pak01`),
        filesystem.createVPKMount(`Portal/portal_pak`),
        filesystem.createVPKMount(`GarrysMod/garrysmod`),
        // filesystem.createGMAMount(`GarrysMod/YukiTheater/base-content.gma`),
        // filesystem.createGMAMount(`GarrysMod/YukiTheater/social-content.gma`),
        // filesystem.createGMAMount(`GarrysMod/YukiTheater/content.gma`),
        filesystem.createVPKMount(`HalfLife2Ep1/ep1_pak`),
        filesystem.createVPKMount(`HalfLife2Ep2/ep2_pak`),
        filesystem.createVPKMount(`HalfLife2DM/hl2mp_pak`),
        filesystem.createVPKMount(`HalfLife2/hl2_textures`),
        filesystem.createVPKMount(`HalfLife2/hl2_misc`),
    ]);
    return filesystem;
}

export async function createFileDropsScene(context: SceneContext, buffer: NamedArrayBufferSlice) {
    const filesystem = await context.dataShare.ensureObject(`FileDrops/SourceFileSystem`, async () => {
        return createKitchenSinkSourceFilesytem(context.dataFetcher);
    });

    // Clear out old filesystem pakfile.
    filesystem.pakfiles.length = 0;

    const loadContext = new SourceLoadContext(filesystem);
    const renderContext = new SourceRenderContext(context.device, loadContext);
    const renderer = new SourceRenderer(context, renderContext);

    let bspFile: BSPFile;
    if (buffer.name.endsWith('.gma')) {
        const gma = new GMA(buffer);
        filesystem.gma.push(gma);
        const bspBuffer = assertExists(gma.files.find((entry) => entry.filename.endsWith('.bsp'))).data;
        bspFile = new BSPFile(bspBuffer, buffer.name);
    } else {
        bspFile = new BSPFile(buffer, buffer.name);
    }

    if (bspFile.pakfile !== null)
        filesystem.addPakFile(bspFile.pakfile);

    if (bspFile.cubemaps[0] !== undefined)
        await renderContext.materialCache.bindLocalCubemap(bspFile.cubemaps[0]);

    const bspRenderer = new BSPRenderer(renderContext, bspFile);
    // Build skybox from worldname.
    const worldspawn = bspRenderer.getWorldSpawn();
    if (worldspawn.skyname)
        renderer.skyboxRenderer = new SkyboxRenderer(renderContext, worldspawn.skyname);
    renderer.bspRenderers.push(bspRenderer);
    return renderer;
}
