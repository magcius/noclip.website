
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { decodeString } from "../util.js";
import { LooseMount, SourceFileSystem, SourceLoadContext } from "./Main.js";
import { createScene } from "./Scenes.js";

class NeoTokyoSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`HalfLife2/hl2_textures`),
                filesystem.createVPKMount(`HalfLife2/hl2_misc`),
            ]);
            const dir = decodeString(await context.dataFetcher.fetchData(`${pathBase}/NeotokyoSource/dir.txt`));
            const files = dir.split('\n');
            filesystem.loose.push(new LooseMount(`${pathBase}/NeotokyoSource/`, files));
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathBase}/NeotokyoSource/maps/${this.id}.bsp`);
    }
}

const pathBase = `NeoTokyo`;

const id = 'NeoTokyo';
const name = 'NeoTokyo';
const sceneDescs = [
    new NeoTokyoSceneDesc('nt_ballistrade_ctg'),
    new NeoTokyoSceneDesc('nt_bullet_tdm'),
    new NeoTokyoSceneDesc('nt_decom_ctg'),
    new NeoTokyoSceneDesc('nt_disengage_ctg'),
    new NeoTokyoSceneDesc('nt_dusk_ctg'),
    new NeoTokyoSceneDesc('nt_engage_ctg'),
    new NeoTokyoSceneDesc('nt_ghost_ctg'),
    new NeoTokyoSceneDesc('nt_isolation_ctg'),
    new NeoTokyoSceneDesc('nt_marketa_ctg'),
    new NeoTokyoSceneDesc('nt_oilstain_ctg'),
    new NeoTokyoSceneDesc('nt_pissalley_ctg'),
    new NeoTokyoSceneDesc('nt_redlight_ctg'),
    new NeoTokyoSceneDesc('nt_ridgeline_ctg'),
    new NeoTokyoSceneDesc('nt_rise_ctg'),
    new NeoTokyoSceneDesc('nt_sentinel_ctg'),
    new NeoTokyoSceneDesc('nt_shrine_ctg'),
    new NeoTokyoSceneDesc('nt_subsurface_ctg'),
    new NeoTokyoSceneDesc('nt_saitama_ctg'),
    new NeoTokyoSceneDesc('nt_tarmac_ctg'),
    new NeoTokyoSceneDesc('nt_threadplate_ctg'),
    new NeoTokyoSceneDesc('nt_vtol_ctg'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
