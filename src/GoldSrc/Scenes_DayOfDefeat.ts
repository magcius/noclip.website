import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { BSPFile } from "../Common/IdTech2/BSPFile.js";
import { BSPRenderer, IdTech2Context, IdTech2Renderer } from "../Common/IdTech2/Render.js";
import { parseWAD } from "../Common/IdTech2/WAD.js";

const pathBase = `HalfLife`;

function normalizeWadPath(v: string): string {
    const filename = v.split('/').pop()!;

    // Half-Life WADs always come from valve/
    if (filename === 'halflife.wad')
        return `valve/${filename}`;

    if (v.includes('/valve/'))
        return `valve/${filename}`;
    if (v.includes('/dod/'))
        return `dod/${filename}`;

    // Default to dod for unknown paths
    return `dod/${filename}`;
}

export class DayOfDefeatSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const bspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/dod/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bspData);

        const context = new IdTech2Context(bspFile.version);
        const renderer = new IdTech2Renderer(device, context);

        renderer.textureCache.addBSP(bspFile);

        // Day of Defeat maps frequently reference WADs from other maps, and mappers
        // often included every WAD on their system, so expect some 404s.
        await Promise.all(bspFile.getWadList().map(async (v) => {
            const wadPath = normalizeWadPath(v);
            let wadData = await sceneContext.dataFetcher.fetchData(`${pathBase}/${wadPath}`, { allow404: true });

            if (wadData.byteLength === 0 && wadPath.startsWith('valve/')) {
                const dodPath = wadPath.replace(/^valve\//, 'dod/');
                wadData = await sceneContext.dataFetcher.fetchData(`${pathBase}/${dodPath}`, { allow404: true });
            }

            if (wadData.byteLength > 0) {
                const wad = parseWAD(wadData);
                renderer.textureCache.addWAD(wad);
                return;
            }

            // WAD not found - check if it matches a map name and load that BSP's textures
            const wadName = wadPath.split('/').pop()!.replace(/\.wad$/, '');
            const siblingBspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/dod/maps/${wadName}.bsp`, { allow404: true });
            if (siblingBspData.byteLength > 0) {
                const siblingBsp = new BSPFile(siblingBspData);
                renderer.textureCache.addBSP(siblingBsp);
            }
        }));

        const bspRenderer = new BSPRenderer(context, renderer.renderHelper.renderCache, renderer.textureCache, bspFile);
        renderer.bspRenderers.push(bspRenderer);

        return renderer;
    }
}

const sceneDescs = [
    new DayOfDefeatSceneDesc('dod_anzio'),
    new DayOfDefeatSceneDesc('dod_avalanche'),
    new DayOfDefeatSceneDesc('dod_caen'),
    new DayOfDefeatSceneDesc('dod_charlie'),
    new DayOfDefeatSceneDesc('dod_chemille'),
    new DayOfDefeatSceneDesc('dod_donner'),
    new DayOfDefeatSceneDesc('dod_escape'),
    new DayOfDefeatSceneDesc('dod_falaise'),
    new DayOfDefeatSceneDesc('dod_flash'),
    new DayOfDefeatSceneDesc('dod_flugplatz'),
    new DayOfDefeatSceneDesc('dod_forest'),
    new DayOfDefeatSceneDesc('dod_glider'),
    new DayOfDefeatSceneDesc('dod_jagd'),
    new DayOfDefeatSceneDesc('dod_kalt'),
    new DayOfDefeatSceneDesc('dod_kraftstoff'),
    new DayOfDefeatSceneDesc('dod_merderet'),
    new DayOfDefeatSceneDesc('dod_northbound'),
    new DayOfDefeatSceneDesc('dod_saints'),
    new DayOfDefeatSceneDesc('dod_sturm'),
    new DayOfDefeatSceneDesc('dod_switch'),
    new DayOfDefeatSceneDesc('dod_vicenza'),
    new DayOfDefeatSceneDesc('dod_zalec'),
];

const id = 'DayOfDefeat';
const name = "Day of Defeat";
export const sceneGroup: SceneGroup = { id, name, sceneDescs };
