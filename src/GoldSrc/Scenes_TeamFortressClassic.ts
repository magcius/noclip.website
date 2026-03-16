import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { BSPFile } from "../Common/IdTech2/BSPFile.js";
import { BSPRenderer, IdTech2Context, IdTech2Renderer } from "../Common/IdTech2/Render.js";
import { parseWAD } from "../Common/IdTech2/WAD.js";

const pathBase = `HalfLife`;

export class TeamFortressClassicSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const bspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/tfc/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bspData);

        const context = new IdTech2Context(bspFile.version);
        const renderer = new IdTech2Renderer(device, context);

        renderer.textureCache.addBSP(bspFile);

        await Promise.all(bspFile.getWadList().map(async (v) => {
            const wad = parseWAD(await sceneContext.dataFetcher.fetchData(`${pathBase}/${v}`));
            renderer.textureCache.addWAD(wad);
        }));

        const bspRenderer = new BSPRenderer(context, renderer.renderHelper.renderCache, renderer.textureCache, bspFile);
        renderer.bspRenderers.push(bspRenderer);

        return renderer;
    }
}

const sceneDescs = [
    "Capture the Flag",
    new TeamFortressClassicSceneDesc('2fort'),
    new TeamFortressClassicSceneDesc('well'),
    new TeamFortressClassicSceneDesc('rock2'),
    new TeamFortressClassicSceneDesc('badlands'),
    new TeamFortressClassicSceneDesc('crossover2'),
    new TeamFortressClassicSceneDesc('warpath'),
    new TeamFortressClassicSceneDesc('epicenter'),
    new TeamFortressClassicSceneDesc('casbah'),
    new TeamFortressClassicSceneDesc('flagrun'),
    new TeamFortressClassicSceneDesc('cz2'),
    "Hunted",
    new TeamFortressClassicSceneDesc('hunted'),
    "Attack/Defend",
    new TeamFortressClassicSceneDesc('dustbowl'),
    new TeamFortressClassicSceneDesc('avanti'),
    "Other",
    new TeamFortressClassicSceneDesc('push'),
    new TeamFortressClassicSceneDesc('ravelin'),
];

const id = 'TeamFortressClassic';
const name = "Team Fortress Classic";
export const sceneGroup: SceneGroup = { id, name, sceneDescs };
