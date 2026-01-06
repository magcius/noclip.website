import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { BSPFile } from "../Common/IdTech2/BSPFile.js";
import { BSPRenderer, IdTech2Context, IdTech2Renderer } from "../Common/IdTech2/Render.js";
import { parseWAD } from "../Common/IdTech2/WAD.js";

const pathBase = `HalfLife`;

function normalizeWadPath(v: string): string {
    // Extract just the filename
    const filename = v.split('/').pop()!;

    // Half-Life WADs always come from valve/
    if (filename === 'halflife.wad')
        return `valve/${filename}`;
    
    // Handle known prefixes: half-life/, release/dev/, maps/foo/wad/
    if (v.includes('/valve/'))
        return `valve/${filename}`;
    if (v.includes('/cstrike/'))
        return `cstrike/${filename}`;
    
    // Default to cstrike for unknown paths
    return `cstrike/${filename}`;
}

export class CounterStrikeSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const bspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/cstrike/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bspData);

        const context = new IdTech2Context(bspFile.version);
        const renderer = new IdTech2Renderer(device, context);

        renderer.textureCache.addBSP(bspFile);

        // Counter Strike was truly a **mod**, so community-produced maps are very common,
        // hence we have some more busy logic here to find the right path for WADs, or even load
        // up _other_ map BSPs to get their textures.
        //
        // It seems like some mappers would include every WAD on their system, including silly things
        // like Team Fortress Classic... so don't be afraid of a few 404s when loading a map that never
        // seem to be even used...
        await Promise.all(bspFile.getWadList().map(async (v) => {
            const wadPath = normalizeWadPath(v);
            let wadData = await sceneContext.dataFetcher.fetchData(`${pathBase}/${wadPath}`, { allow404: true });

            if (wadData.byteLength === 0 && wadPath.startsWith('valve/')) {
                const cstrikePath = wadPath.replace(/^valve\//, 'cstrike/');
                wadData = await sceneContext.dataFetcher.fetchData(`${pathBase}/${cstrikePath}`, { allow404: true });
            }

            if (wadData.byteLength > 0) {
                const wad = parseWAD(wadData);
                renderer.textureCache.addWAD(wad);
                return;
            }

            // WAD not found - check if it matches a map name and load that BSP's textures
            const wadName = wadPath.split('/').pop()!.replace(/\.wad$/, '');
            const siblingBspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/cstrike/maps/${wadName}.bsp`, { allow404: true });
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
    "Assault",
    new CounterStrikeSceneDesc('as_oilrig'),
    "Hostage Rescue",
    new CounterStrikeSceneDesc('cs_747'),
    new CounterStrikeSceneDesc('cs_assault'),
    new CounterStrikeSceneDesc('cs_backalley'),
    new CounterStrikeSceneDesc('cs_estate'),
    new CounterStrikeSceneDesc('cs_havana'),
    new CounterStrikeSceneDesc('cs_italy'),
    new CounterStrikeSceneDesc('cs_militia'),
    new CounterStrikeSceneDesc('cs_office'),
    new CounterStrikeSceneDesc('cs_siege'),
    "Defuse",
    new CounterStrikeSceneDesc('de_airstrip'),
    new CounterStrikeSceneDesc('de_aztec'),
    new CounterStrikeSceneDesc('de_cbble'),
    new CounterStrikeSceneDesc('de_chateau'),
    new CounterStrikeSceneDesc('de_dust'),
    new CounterStrikeSceneDesc('de_dust2'),
    new CounterStrikeSceneDesc('de_inferno'),
    new CounterStrikeSceneDesc('de_nuke'),
    new CounterStrikeSceneDesc('de_piranesi'),
    new CounterStrikeSceneDesc('de_prodigy'),
    new CounterStrikeSceneDesc('de_storm'),
    new CounterStrikeSceneDesc('de_survivor'),
    new CounterStrikeSceneDesc('de_torn'),
    new CounterStrikeSceneDesc('de_train'),
    new CounterStrikeSceneDesc('de_vertigo'),
];

const id = 'CounterStrike';
const name = "Counter-Strike";
export const sceneGroup: SceneGroup = { id, name, sceneDescs };
