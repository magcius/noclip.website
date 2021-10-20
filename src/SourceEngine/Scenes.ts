
import { SourceFileSystem, SourceRenderer, SkyboxRenderer, BSPRenderer, SourceRenderContext } from "./Main";
import { SceneContext } from "../SceneBase";
import { BSPFile } from "./BSPFile";
import { assert } from "../util";

export async function createScene(context: SceneContext, filesystem: SourceFileSystem, mapId: string, mapPath: string, renderContext: SourceRenderContext | null = null): Promise<SourceRenderer> {
    // Clear out old filesystem pakfile.
    filesystem.pakfiles.length = 0;

    if (renderContext === null)
        renderContext = new SourceRenderContext(context.device, filesystem);
    const renderer = new SourceRenderer(context, renderContext);

    const bspFile = await context.dataShare.ensureObject(`SourceEngine/${mapPath}`, async () => {
        const bsp = await context.dataFetcher.fetchData(mapPath);
        return new BSPFile(bsp, mapId);
    });

    if (bspFile.pakfile !== null)
        filesystem.addPakFile(bspFile.pakfile);

    if (bspFile.cubemaps[0] !== undefined)
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
