

import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { BSPFile } from "../Common/IdTech2/BSPFile.js";
import { BSPRenderer, IdTech2Context, IdTech2Renderer } from "../Common/IdTech2/Render.js";
import { parseWAD } from "../Common/IdTech2/WAD.js";

const pathBase = `Quake`;

export class QuakeSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const bspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/id1/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bspData);

        const context = new IdTech2Context(bspFile.version);
        const renderer = new IdTech2Renderer(device, context);

        const paletteData = await sceneContext.dataFetcher.fetchData(`${pathBase}/id1/gfx/palette.lmp`);
        const palette = paletteData.createTypedArray(Uint8Array);
        renderer.textureCache.setPalette(palette);

        const wadData = await sceneContext.dataFetcher.fetchData(`${pathBase}/id1/gfx.wad`);
        const wad = parseWAD(wadData);
        renderer.textureCache.addWAD(wad);

        renderer.textureCache.addBSP(bspFile);

        const bspRenderer = new BSPRenderer(context, renderer.renderHelper.renderCache, renderer.textureCache, bspFile);
        renderer.bspRenderers.push(bspRenderer);

        return renderer;
    }
}

// Map names based on https://fps.fandom.com/wiki/Quake_I_Maps
const sceneDescs = [
    "Welcome to Quake",
    new QuakeSceneDesc('start', "start - Introduction"),
    "Episode 1: Dimension of the Doomed",
    new QuakeSceneDesc('e1m1', "e1m1 - The Slipgate Complex"),
    new QuakeSceneDesc('e1m2', "e1m2 - Castle of the Damned"),
    new QuakeSceneDesc('e1m3', "e1m3 - The Necropolis"),
    new QuakeSceneDesc('e1m4', "e1m4 - The Grisly Grotto"),
    new QuakeSceneDesc('e1m5', "e1m5 - Gloom Keep"),
    new QuakeSceneDesc('e1m6', "e1m6 - The Door to Chthon"),
    new QuakeSceneDesc('e1m7', "e1m7 - The House of Chthon"),
    new QuakeSceneDesc('e1m8', "e1m8 - Ziggurat Vertigo"),
    "Episode 2: The Realm of Black Magic",
    new QuakeSceneDesc('e2m1', "e2m1 - The Installation"),
    new QuakeSceneDesc('e2m2', "e2m2 - The Ogre Citadel"),
    new QuakeSceneDesc('e2m3', "e2m3 - The Crypt of Decay"),
    new QuakeSceneDesc('e2m4', "e2m4 - The Ebon Fortress"),
    new QuakeSceneDesc('e2m5', "e2m5 - The Wizard's Manse"),
    new QuakeSceneDesc('e2m6', "e2m6 - The Dismal Oubliette"),
    new QuakeSceneDesc('e2m7', "e2m7 - The Underearth"),
    "Episode 3: The Netherworld",
    new QuakeSceneDesc('e3m1', "e3m1 - Termination Central"),
    new QuakeSceneDesc('e3m2', "e3m2 - The Vaults of Zin"),
    new QuakeSceneDesc('e3m3', "e3m3 - The Tomb of Terror"),
    new QuakeSceneDesc('e3m4', "e3m4 - Satan's Dark Delight"),
    new QuakeSceneDesc('e3m5', "e3m5 - The Wind Tunnels"),
    new QuakeSceneDesc('e3m6', "e3m6 - Chambers of Torment"),
    new QuakeSceneDesc('e3m7', "e3m7 - The Haunted Halls"),
    "Episode 4: The Elder World",
    new QuakeSceneDesc('e4m1', "e4m1 - The Sewage System"),
    new QuakeSceneDesc('e4m2', "e4m2 - The Tower of Despair"),
    new QuakeSceneDesc('e4m3', "e4m3 - The Elder God Shrine"),
    new QuakeSceneDesc('e4m4', "e4m4 - The Palace of Hate"),
    new QuakeSceneDesc('e4m5', "e4m5 - Hell's Atrium"),
    new QuakeSceneDesc('e4m6', "e4m6 - The Pain Maze"),
    new QuakeSceneDesc('e4m7', "e4m7 - Azure Agony"),
    new QuakeSceneDesc('e4m8', "e4m8 - The Nameless City"),
    "Final Level",
    new QuakeSceneDesc('end', "end - Shub-Niggurath's Pit"),
    "Deathmatch Arena",
    new QuakeSceneDesc('dm1', "dm1 - Place of Two Deaths"),
    new QuakeSceneDesc('dm2', "dm2 - Claustrophobopolis"),
    new QuakeSceneDesc('dm3', "dm3 - The Abandoned Base"),
    new QuakeSceneDesc('dm4', "dm4 - The Bad Place"),
    new QuakeSceneDesc('dm5', "dm5 - The Cistern"),
    new QuakeSceneDesc('dm6', "dm6 - The Dark Zone"),
];

const id = 'Quake';
const name = "Quake";
export const sceneGroup: SceneGroup = { id, name, sceneDescs };
