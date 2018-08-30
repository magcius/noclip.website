
import { parseIV } from './iv';
import { Scene } from './render';

import { RenderState } from '../render';
import { MainScene, SceneGroup, Texture } from '../viewer';
import * as UI from '../ui';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';

const dks1Paths = [
    "data/dksiv/dks1/15-0 Sens Fortress.iv",
    "data/dksiv/dks1/15-1 Anor Londo.iv",
    "data/dksiv/dks1/16-0 New Londo Ruins+Valley of Drakes.iv",
    "data/dksiv/dks1/17-0 Duke's Archive+Crystal Caves.iv",
    "data/dksiv/dks1/18-0 Kiln of the first Flame.iv",
    "data/dksiv/dks1/18-1 Undead Asylum.iv",
    "data/dksiv/dks1/10-0 Depths.iv",
    "data/dksiv/dks1/10-1 Undead Burg.iv",
    "data/dksiv/dks1/10-2 Firelink Shrine.iv",
    "data/dksiv/dks1/11-0 Painted World of Ariamis.iv",
    "data/dksiv/dks1/12-0 Darkroot Garden+Basin.iv",
    "data/dksiv/dks1/12-1 Oolacile.iv",
    "data/dksiv/dks1/13-0 Catacombs.iv",
    "data/dksiv/dks1/13-1 Tomb of the Giants.iv",
    "data/dksiv/dks1/13-2 Ash Lake.iv",
    "data/dksiv/dks1/14-0 Blighttown+Quelaags Domain.iv",
    "data/dksiv/dks1/14-1 Demon Ruins+Lost Izalith.iv",
];

const dks2Paths = [
    "data/dksiv/dks2/10_25_The Gutter & Black Gulch.iv",
    "data/dksiv/dks2/10_27_Dragon Aerie & Dragon Shrine.iv",
    "data/dksiv/dks2/10_29_Majula.iv",
    "data/dksiv/dks2/10_30_Heide's Tower of Flame.iv",
    "data/dksiv/dks2/10_31_Heide's Tower of Flame & Cathedral of Blue.iv",
    "data/dksiv/dks2/10_32_Shaded Woods & Shrine of Winter.iv",
    "data/dksiv/dks2/10_33_Doors of Pharros.iv",
    "data/dksiv/dks2/10_34_Grave of Saints.iv",
    "data/dksiv/dks2/20_10_Memory of Vammar, Orro, Jeigh.iv",
    "data/dksiv/dks2/20_11_Shrine of Amana.iv",
    "data/dksiv/dks2/20_21_Drangleic Castle & King's Passage & Throne of Want.iv",
    "data/dksiv/dks2/20_24_Undead Crypt.iv",
    "data/dksiv/dks2/20_26_Dragon Memories.iv",
    "data/dksiv/dks2/40_03_Dark Chasm of Old.iv",
    "data/dksiv/dks2/10_02_Things Betwixt.iv",
    "data/dksiv/dks2/10_04_Majula.iv",
    "data/dksiv/dks2/10_10_Forest of Fallen Giants.iv",
    "data/dksiv/dks2/10_14_Brightstone Cove Tseldora & Lord's Private Chamber.iv",
    "data/dksiv/dks2/10_15_Aldia's Keep.iv",
    "data/dksiv/dks2/10_16_The Lost Bastille & Sinners' Rise & Belfry Luna.iv",
    "data/dksiv/dks2/10_17_Harvest Valley & Earthen Peak.iv",
    "data/dksiv/dks2/10_18_No-man's Wharf.iv",
    "data/dksiv/dks2/10_19_Iron Keep & Belfry Sol.iv",
    "data/dksiv/dks2/10_23_Huntsman's Copse & Undead Purgatory.iv",
];

class MultiScene implements MainScene {
    public scenes: Scene[];
    public textures: Texture[];

    constructor(scenes: Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }

    public createPanels(): UI.Panel[] {
        const layers = new UI.LayerPanel();
        layers.setLayers(this.scenes);
        return [layers];
    }

    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => {
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

class SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string, public paths: string[]) {
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<MainScene> {
        return Progressable.all(this.paths.map((path) => {
            return this.createSceneForPath(gl, path);
        })).then((scenes) => {
            return new MultiScene(scenes);
        });
    }

    private createSceneForPath(gl: WebGL2RenderingContext, path: string): Progressable<Scene> {
        return fetchData(path).then((result: ArrayBufferSlice) => {
            const iv = parseIV(result);
            const basename = path.split('/').pop();
            return new Scene(gl, basename, iv);
        });
    }
}

const sceneDescs: SceneDesc[] = [
    new SceneDesc('dks1', 'Dark Souls 1', dks1Paths),
    new SceneDesc('dks2', 'Dark Souls 2', dks2Paths),
];

const name = "Dark Souls Collision Data";
const id = "dksiv";

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
