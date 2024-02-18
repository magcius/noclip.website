
import { parseIV } from './iv.js';
import { Scene } from './render.js';

import * as Viewer from '../viewer.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';

const pathBase = `DarkSoulsCollisionData`;

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public paths: string[]) {
    }

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const buffers = await Promise.all(this.paths.map((path) => dataFetcher.fetchData(`${pathBase}/${path}`)));
        const ivs = buffers.map((buffer) => parseIV(buffer));
        return new Scene(gfxDevice, ivs);
    }
}

const dks1Paths = [
    "dks1/15-0 Sens Fortress.iv",
    "dks1/15-1 Anor Londo.iv",
    "dks1/16-0 New Londo Ruins+Valley of Drakes.iv",
    "dks1/17-0 Duke's Archive+Crystal Caves.iv",
    "dks1/18-0 Kiln of the first Flame.iv",
    "dks1/18-1 Undead Asylum.iv",
    "dks1/10-0 Depths.iv",
    "dks1/10-1 Undead Burg.iv",
    "dks1/10-2 Firelink Shrine.iv",
    "dks1/11-0 Painted World of Ariamis.iv",
    "dks1/12-0 Darkroot Garden+Basin.iv",
    "dks1/12-1 Oolacile.iv",
    "dks1/13-0 Catacombs.iv",
    "dks1/13-1 Tomb of the Giants.iv",
    "dks1/13-2 Ash Lake.iv",
    "dks1/14-0 Blighttown+Quelaags Domain.iv",
    "dks1/14-1 Demon Ruins+Lost Izalith.iv",
];

const dks2Paths = [
    "dks2/10_25_The Gutter & Black Gulch.iv",
    "dks2/10_27_Dragon Aerie & Dragon Shrine.iv",
    "dks2/10_29_Majula.iv",
    "dks2/10_30_Heide's Tower of Flame.iv",
    "dks2/10_31_Heide's Tower of Flame & Cathedral of Blue.iv",
    "dks2/10_32_Shaded Woods & Shrine of Winter.iv",
    "dks2/10_33_Doors of Pharros.iv",
    "dks2/10_34_Grave of Saints.iv",
    "dks2/20_10_Memory of Vammar, Orro, Jeigh.iv",
    "dks2/20_11_Shrine of Amana.iv",
    "dks2/20_21_Drangleic Castle & King's Passage & Throne of Want.iv",
    "dks2/20_24_Undead Crypt.iv",
    "dks2/20_26_Dragon Memories.iv",
    "dks2/40_03_Dark Chasm of Old.iv",
    "dks2/10_02_Things Betwixt.iv",
    "dks2/10_04_Majula.iv",
    "dks2/10_10_Forest of Fallen Giants.iv",
    "dks2/10_14_Brightstone Cove Tseldora & Lord's Private Chamber.iv",
    "dks2/10_15_Aldia's Keep.iv",
    "dks2/10_16_The Lost Bastille & Sinners' Rise & Belfry Luna.iv",
    "dks2/10_17_Harvest Valley & Earthen Peak.iv",
    "dks2/10_18_No-man's Wharf.iv",
    "dks2/10_19_Iron Keep & Belfry Sol.iv",
    "dks2/10_23_Huntsman's Copse & Undead Purgatory.iv",
];

const sceneDescs: SceneDesc[] = [
    new SceneDesc('dks1', 'Dark Souls 1', dks1Paths),
    new SceneDesc('dks2', 'Dark Souls 2', dks2Paths),
];

const name = "Dark Souls Collision Data";
const id = "dksiv";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
