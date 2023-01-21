
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx } from "../viewer";
import { BSPFile } from "./BSPFile";
import { BSPRenderer, GoldSrcRenderer } from "./Render";
import { parseWAD } from "./WAD";

const pathBase = `HalfLife`;

export class HalfLifeSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const renderer = new GoldSrcRenderer(device);

        const bspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/valve/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bspData);
        renderer.textureCache.addBSP(bspFile);

        await Promise.all(bspFile.getWadList().map(async (v) => {
            const wad = parseWAD(await sceneContext.dataFetcher.fetchData(`${pathBase}/${v}`));
            renderer.textureCache.addWAD(wad);
        }));

        const bspRenderer = new BSPRenderer(renderer.renderHelper.renderCache, renderer.textureCache, bspFile);
        renderer.bspRenderers.push(bspRenderer);

        return renderer;
    }
}

const sceneDescs = [
    "Deathmatch",
    new HalfLifeSceneDesc('boot_camp'),
    new HalfLifeSceneDesc('subtransit'),
    new HalfLifeSceneDesc('undertow'),
    new HalfLifeSceneDesc('bounce'),
    new HalfLifeSceneDesc('crossfire'),
    new HalfLifeSceneDesc('datacore'),
    new HalfLifeSceneDesc('frenzy'),
    new HalfLifeSceneDesc('gasworks'),
    new HalfLifeSceneDesc('lambda_bunker'),
    new HalfLifeSceneDesc('rapidcore'),
    new HalfLifeSceneDesc('snark_pit'),
    new HalfLifeSceneDesc('stalkyard'),
    "Hazard Course",
    new HalfLifeSceneDesc('t0a0'),
    new HalfLifeSceneDesc('t0a0a'),
    new HalfLifeSceneDesc('t0a0b'),
    new HalfLifeSceneDesc('t0a0b1'),
    new HalfLifeSceneDesc('t0a0b2'),
    new HalfLifeSceneDesc('t0a0c'),
    new HalfLifeSceneDesc('t0a0d'),
    "Black Mesa Inbound",
    new HalfLifeSceneDesc('c0a0'),
    new HalfLifeSceneDesc('c0a0a'),
    new HalfLifeSceneDesc('c0a0b'),
    new HalfLifeSceneDesc('c0a0c'),
    new HalfLifeSceneDesc('c0a0d'),
    new HalfLifeSceneDesc('c0a0e'),
    "Anomalous Materials",
    new HalfLifeSceneDesc('c1a0'),
    new HalfLifeSceneDesc('c1a0a'),
    new HalfLifeSceneDesc('c1a0b'),
    new HalfLifeSceneDesc('c1a0c'),
    new HalfLifeSceneDesc('c1a0d'),
    new HalfLifeSceneDesc('c1a0e'),
    new HalfLifeSceneDesc('c1a1'),
    new HalfLifeSceneDesc('c1a1a'),
    new HalfLifeSceneDesc('c1a1b'),
    new HalfLifeSceneDesc('c1a1c'),
    new HalfLifeSceneDesc('c1a1d'),
    new HalfLifeSceneDesc('c1a1f'),
    new HalfLifeSceneDesc('c1a2'),
    new HalfLifeSceneDesc('c1a2a'),
    new HalfLifeSceneDesc('c1a2b'),
    new HalfLifeSceneDesc('c1a2c'),
    new HalfLifeSceneDesc('c1a2d'),
    new HalfLifeSceneDesc('c1a3'),
    new HalfLifeSceneDesc('c1a3a'),
    new HalfLifeSceneDesc('c1a3b'),
    new HalfLifeSceneDesc('c1a3c'),
    new HalfLifeSceneDesc('c1a3d'),
    new HalfLifeSceneDesc('c1a4'),
    new HalfLifeSceneDesc('c1a4b'),
    new HalfLifeSceneDesc('c1a4d'),
    new HalfLifeSceneDesc('c1a4e'),
    new HalfLifeSceneDesc('c1a4f'),
    new HalfLifeSceneDesc('c1a4g'),
    new HalfLifeSceneDesc('c1a4i'),
    new HalfLifeSceneDesc('c1a4j'),
    new HalfLifeSceneDesc('c1a4k'),
    new HalfLifeSceneDesc('c2a1'),
    new HalfLifeSceneDesc('c2a1a'),
    new HalfLifeSceneDesc('c2a1b'),
    new HalfLifeSceneDesc('c2a2'),
    new HalfLifeSceneDesc('c2a2a'),
    new HalfLifeSceneDesc('c2a2b1'),
    new HalfLifeSceneDesc('c2a2b2'),
    new HalfLifeSceneDesc('c2a2c'),
    new HalfLifeSceneDesc('c2a2d'),
    new HalfLifeSceneDesc('c2a2e'),
    new HalfLifeSceneDesc('c2a2f'),
    new HalfLifeSceneDesc('c2a2g'),
    new HalfLifeSceneDesc('c2a2h'),
    new HalfLifeSceneDesc('c2a3'),
    new HalfLifeSceneDesc('c2a3a'),
    new HalfLifeSceneDesc('c2a3b'),
    new HalfLifeSceneDesc('c2a3c'),
    new HalfLifeSceneDesc('c2a3d'),
    new HalfLifeSceneDesc('c2a3e'),
    new HalfLifeSceneDesc('c2a4'),
    new HalfLifeSceneDesc('c2a4a'),
    new HalfLifeSceneDesc('c2a4b'),
    new HalfLifeSceneDesc('c2a4c'),
    new HalfLifeSceneDesc('c2a4d'),
    new HalfLifeSceneDesc('c2a4e'),
    new HalfLifeSceneDesc('c2a4f'),
    new HalfLifeSceneDesc('c2a4g'),
    new HalfLifeSceneDesc('c2a5'),
    new HalfLifeSceneDesc('c2a5a'),
    new HalfLifeSceneDesc('c2a5b'),
    new HalfLifeSceneDesc('c2a5c'),
    new HalfLifeSceneDesc('c2a5d'),
    new HalfLifeSceneDesc('c2a5e'),
    new HalfLifeSceneDesc('c2a5f'),
    new HalfLifeSceneDesc('c2a5g'),
    new HalfLifeSceneDesc('c2a5w'),
    new HalfLifeSceneDesc('c2a5x'),
    new HalfLifeSceneDesc('c3a1'),
    new HalfLifeSceneDesc('c3a1a'),
    new HalfLifeSceneDesc('c3a1b'),
    new HalfLifeSceneDesc('c3a2'),
    new HalfLifeSceneDesc('c3a2a'),
    new HalfLifeSceneDesc('c3a2b'),
    new HalfLifeSceneDesc('c3a2c'),
    new HalfLifeSceneDesc('c3a2d'),
    new HalfLifeSceneDesc('c3a2e'),
    new HalfLifeSceneDesc('c3a2f'),
    new HalfLifeSceneDesc('c4a1'),
    new HalfLifeSceneDesc('c4a1a'),
    new HalfLifeSceneDesc('c4a1b'),
    new HalfLifeSceneDesc('c4a1c'),
    new HalfLifeSceneDesc('c4a1d'),
    new HalfLifeSceneDesc('c4a1e'),
    new HalfLifeSceneDesc('c4a1f'),
    new HalfLifeSceneDesc('c4a2'),
    new HalfLifeSceneDesc('c4a2a'),
    new HalfLifeSceneDesc('c4a2b'),
    new HalfLifeSceneDesc('c4a3'),
    new HalfLifeSceneDesc('c5a1'),
];

const id = 'HalfLife';
const name = "Half-Life";
export const sceneGroup: SceneGroup = { id, name, sceneDescs };
