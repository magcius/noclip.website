
import * as CMAB from './cmab';
import * as ZAR from './zar';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { RoomRenderer } from './render';
import { SceneGroup } from '../viewer';
import { RenderState } from '../render';
import { assert } from '../util';
import { fetchData } from '../fetch';

class MultiScene implements Viewer.MainScene {
    public scenes: RoomRenderer[];
    public textures: Viewer.Texture[];

    constructor(scenes: RoomRenderer[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }

    public createPanels(): UI.Panel[] {
        const layerPanel = new UI.LayerPanel();
        layerPanel.setLayers(this.scenes);
        return [layerPanel];
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

class SceneDesc implements Viewer.SceneDesc {
    public name: string;
    public id: string;

    constructor(name: string, id: string) {
        this.name = name;
        this.id = id;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        // Fetch the ZAR & info ZSI.
        const path_zar = `data/oot3d/${this.id}.zar`;
        const path_info_zsi = `data/oot3d/${this.id}_info.zsi`;
        return Progressable.all([fetchData(path_zar), fetchData(path_info_zsi)]).then(([zar, zsi]) => {
            return this._createSceneFromData(gl, zar, zsi);
        });
    }

    private _createSceneFromData(gl: WebGL2RenderingContext, zarBuffer: ArrayBufferSlice, zsiBuffer: ArrayBufferSlice): Progressable<Viewer.MainScene> {
        const zar = zarBuffer.byteLength ? ZAR.parse(zarBuffer) : null;

        const zsi = ZSI.parse(zsiBuffer);
        assert(zsi.rooms !== null);
        const roomFilenames = zsi.rooms.map((romPath) => {
            const filename = romPath.split('/').pop();
            return `data/oot3d/${filename}`;
        });

        return Progressable.all(roomFilenames.map((filename, i) => {
            return fetchData(filename).then((roomResult) => {
                const zsi = ZSI.parse(roomResult);
                assert(zsi.mesh !== null);
                const roomRenderer = new RoomRenderer(gl, zsi, filename, null);
                if (zar !== null) {
                    const cmabFile = zar.files.find((file) => file.name.startsWith(`ROOM${i}`) && file.name.endsWith('.cmab'));
                    if (cmabFile) {
                        const cmab = CMAB.parse(CMAB.Version.Ocarina, cmabFile.buffer);
                        console.log(cmab);
                        roomRenderer.bindCMAB(cmab);
                    }
                }
                return new Progressable(Promise.resolve(roomRenderer));
            });
        })).then((scenes: RoomRenderer[]) => {
            return new MultiScene(scenes);
        });
    }
}

const id = "oot3d";
const name = "Ocarina of Time 3D";
const sceneDescs: SceneDesc[] = [
    { name: "Inside the Deku Tree", id: "ydan" },
    { name: "Inside the Deku Tree (Boss)", id: "ydan_boss" },
    { name: "Dodongo's Cavern", id: "ddan" },
    { name: "Dodongo's Cavern (Boss)", id: "ddan_boss" },
    { name: "Jabu-Jabu's Belly", id: 'bdan' },
    { name: "Jabu-Jabu's Belly (Boss)", id: 'bdan_boss' },
    { name: "Forest Temple", id: 'bmori1' },
    { name: "Forest Temple (Boss)", id: "moriboss" },
    { name: "Fire Temple", id: "hidan" },
    { name: "Fire Temple (Boss)", id: "fire_bs" },
    { name: "Water Temple", id: "mizusin" },
    { name: "Water Temple (Boss)", id: "mizusin_boss" },
    { name: "Spirit Temple", id: "jyasinzou" },
    { name: "Spirit Temple (Mid-Boss)", id: "jyasinzou_boss" },
    { name: "Shadow Temple", id: "hakadan" },
    { name: "Shadow Temple (Boss)", id: "hakadan_boss" },
    { name: "Bottom of the Well", id: "hakadan_ch" },
    { name: "Ice Cavern", id: "ice_doukutu" },
    { name: "Gerudo Training Grounds", id: "men" },
    { name: "Thieve's Hideout", id: "gerudoway" },
    { name: "Ganon's Castle", id: "ganontika" },
    { name: "Ganon's Castle (Crumbling)", id: "ganontikasonogo" },
    { name: "Ganon's Castle (Outside)", id: "ganon_tou" },
    { name: "Ganon's Castle Tower", id: "ganon" },
    { name: "Ganon's Castle Tower (Crumbling)", id: "ganon_sonogo" },
    { name: "Second-To-Last Boss Ganondorf", id: "ganon_boss" },
    { name: "Final Battle Against Ganon", id: "ganon_demo" },
    { name: "Ganondorf's Death", id: "ganon_final" },
    { name: "Hyrule Field", id: "spot00" },
    { name: "Kakariko Village", id: "spot01" },
    { name: "Kakariko Graveyard", id: "spot02" },
    { name: "Zora's River", id: "spot03" },
    { name: "Kokiri Firest", id: "spot04" },
    { name: "Sacred Forest Meadow", id: "spot05" },
    { name: "Lake Hylia", id: "spot06" },
    { name: "Zora's Domain", id: "spot07" },
    { name: "Zora's Fountain", id: "spot08" },
    { name: "Gerudo Valley", id: "spot09" },
    { name: "Lost Woods", id: "spot10" },
    { name: "Desert Colossus", id: "spot11" },
    { name: "Gerudo's Fortress", id: "spot12" },
    { name: "Haunted Wasteland", id: "spot13" },
    { name: "Hyrule Castle", id: "spot15" },
    { name: "Death Mountain", id: "spot16" },
    { name: "Death Mountain Crater", id: "spot17" },
    { name: "Goron City", id: "spot18" },
    { name: "Lon Lon Ranch", id: "spot20" },
    { name: "", id: "spot99" },

    { name: "Market Entrance (Day)", id: "entra_day" },
    { name: "Market Entrance (Night)", id: "entra_night" },
    { name: "Market Entrance (Ruins)", id: "entra_ruins" },
    { name: "Market (Day)", id: "market_day" },
    { name: "Market (Night)", id: "market_night" },
    { name: "Market (Ruins)", id: "market_ruins" },
    { name: "Market Back-Alley (Day)", id: "market_alley" },
    { name: "Market Back-Alley (Night)", id: "market_alley_n" },
    { name: "Lots'o'Pots", id: "miharigoya" },
    { name: "Bombchu Bowling Alley", id: 'bowling' },
    { name: "Temple of Time (Outside, Day)", id: "shrine" },
    { name: "Temple of Time (Outside, Night)", id: "shrine_n" },
    { name: "Temple of Time (Outside, Adult)", id: "shrine_r" },
    { name: "Temple of Time (Interior)", id: "tokinoma" },
    { name: "Chamber of Sages", id: "kenjyanoma" },
    { name: "Zora Shop", id: "zoora" },
    { name: "Dampe's Hut", id: "hut" },

    { name: "Great Fairy Fountain", id: "daiyousei_izumi" },
    { name: "Small Fairy Fountain", id: "yousei_izumi_tate" },
    { name: "Magic Fairy Fountain", id: "yousei_izumi_yoko" },

    { name: "Castle Courtyard", id: "hairal_niwa" },
    { name: "Castle Courtyard (Night)", id: "hairal_niwa_n" },
    { name: '', id: "hakaana" },
    { name: "Grottos", id: "kakusiana" },
    { name: "Royal Family's Tomb", id: "hakaana_ouke" },
    { name: "Dampe's Grave & Windmill Hut", id: "hakasitarelay" },
    { name: "Cutscene Map", id: "hiral_demo" },
    { name: "Hylia Lakeside Laboratory", id: "hylia_labo" },
    { name: "Puppy Woman's House", id: "kakariko_impa" },
    { name: "Skulltula House", id: "kinsuta" },
    { name: "Impa's House", id: "labo" },
    { name: "Granny's Potion Shop", id: "mahouya" },
    { name: "Zelda's Courtyard", id: "nakaniwa" },
    { name: "Market Potion Shop", id: "shop_alley" },
    { name: "Kakariko Potion Shop", id: "shop_drag" },
    { name: "Happy Mask Shop", id: "shop_face" },
    { name: "Goron Shop", id: "shop_golon" },
    { name: "Bombchu Shop", id: "shop_night" },
    { name: "Talon's House", id: "souko" },
    { name: "Stables", id: "stable" },
    { name: "Shooting Gallery", id: "syatekijyou" },
    { name: "Treasure Chest Game", id: "takaraya" },
    { name: "Carpenter's Tent", id: "tent" },

    { name: '', id: "k_home" },
    { name: '', id: "kakariko" },
    { name: '', id: "kokiri" },
    { name: '', id: "link" },
    { name: '', id: "shop" },
    { name: "Fishing Pond", id: "turibori" },
].map((entry): SceneDesc => {
    const name = entry.name || entry.id;
    return new SceneDesc(name, entry.id);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
