
import { SourceFileSystem, SourceRenderer, SkyboxRenderer, BSPRenderer } from "./Main";
import { SceneContext } from "../SceneBase";
import { BSPFile } from "./BSPFile";
import { assert } from "../util";

export async function createScene(context: SceneContext, filesystem: SourceFileSystem, mapId: string, mapPath: string): Promise<SourceRenderer> {
    // Clear out old filesystem pakfile.
    filesystem.pakfiles.length = 0;

    const renderer = new SourceRenderer(context, filesystem);
    const renderContext = renderer.renderContext;

    const bsp = await context.dataFetcher.fetchData(mapPath);
    const bspFile = new BSPFile(bsp, mapId);

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
