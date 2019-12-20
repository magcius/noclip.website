
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { readZELVIEW0 } from './zelview0';

const pathBase = `zelview`;

class ZelviewSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const zelviewData = await dataFetcher.fetchData(`${pathBase}/${this.id}.zelview0`);

        const zelview = readZELVIEW0(zelviewData);
        const headers = zelview.loadMainScene();
        console.log(`headers: ${JSON.stringify(headers, null, '\t')}`);

        throw Error(`Zelview not implemented`);
    }
}

const id = 'zelview';
const name = 'The Legend of Zelda: Ocarina of Time';
const sceneDescs = [
    new ZelviewSceneDesc('ydan_scene', 'Inside the Deku Tree'),
    new ZelviewSceneDesc('ddan_scene', "Dodongo's Cavern"),
    new ZelviewSceneDesc('bdan_scene', "Inside Jabu-Jabu's Belly"),
    new ZelviewSceneDesc('Bmori1_scene', 'Forest Temple'),
    new ZelviewSceneDesc('HIDAN_scene', 'Fire Temple'),
    new ZelviewSceneDesc('MIZUsin_scene', 'Water Temple'),
    new ZelviewSceneDesc('jyasinzou_scene', 'Spirit Temple'),
    new ZelviewSceneDesc('HAKAdan_scene', 'Shadow Temple'),
    new ZelviewSceneDesc('HAKAdanCH_scene', 'Bottom of the Well'),
    new ZelviewSceneDesc('ice_doukutu_scene', 'Ice Cavern'),
    new ZelviewSceneDesc('ganon_scene', "Ganon's Castle Tower"),
    new ZelviewSceneDesc('men_scene', 'Gerudo Training Grounds'),
    new ZelviewSceneDesc('gerudoway_scene', "Thieves' Hideout"),
    new ZelviewSceneDesc('ganontika_scene', "Ganon's Castle"),
    new ZelviewSceneDesc('ganon_sonogo_scene', "Ganon's Castle Tower (Crumbling)"),
    new ZelviewSceneDesc('ganontikasonogo_scene', "Ganon's Castle (Crumbling)"),
    new ZelviewSceneDesc('takaraya_scene', 'Treasure Chest Contest'),
    new ZelviewSceneDesc('ydan_boss_scene', 'Inside the Deku Tree (Boss)'),
    new ZelviewSceneDesc('ddan_boss_scene', "Dodongo's Cavern (Boss)"),
    new ZelviewSceneDesc('bdan_boss_scene', "Inside Jabu-Jabu's Belly (Boss)"),
    new ZelviewSceneDesc('moribossroom_scene', 'Forest Temple (Boss)'),
    new ZelviewSceneDesc('FIRE_bs_scene', 'Fire Temple (Boss)'),
    new ZelviewSceneDesc('MIZUsin_bs_scene', 'Water Temple (Boss)'),
    new ZelviewSceneDesc('jyasinboss_scene', 'Spirit Temple (Mid-Boss)'),
    new ZelviewSceneDesc('HAKAdan_bs_scene', 'Shadow Temple (Boss)'),
    new ZelviewSceneDesc('ganon_boss_scene', 'Second-To-Last Boss Ganondorf'),
    new ZelviewSceneDesc('ganon_final_scene', 'Ganondorf, Death Scene'),
    new ZelviewSceneDesc('entra_scene', 'Market Entrance (Day)'),
    new ZelviewSceneDesc('entra_n_scene', 'Market Entrance (Night)'),
    new ZelviewSceneDesc('enrui_scene', 'Market Entrance (Adult)'),
    new ZelviewSceneDesc('market_alley_scene', 'Back Alley (Day)'),
    new ZelviewSceneDesc('market_alley_n_scene', 'Back Alley (Night)'),
    new ZelviewSceneDesc('market_day_scene', 'Market (Day)'),
    new ZelviewSceneDesc('market_night_scene', 'Market (Night)'),
    new ZelviewSceneDesc('market_ruins_scene', 'Market (Adult)'),
    new ZelviewSceneDesc('shrine_scene', 'Temple of Time (Outside, Day)'),
    new ZelviewSceneDesc('shrine_n_scene', 'Temple of Time (Outside, Night)'),
    new ZelviewSceneDesc('shrine_r_scene', 'Temple of Time (Outside, Adult)'),
    new ZelviewSceneDesc('kokiri_home_scene', 'Know-it-all Brothers'),
    new ZelviewSceneDesc('kokiri_home3_scene', 'House of Twins'),
    new ZelviewSceneDesc('kokiri_home4_scene', "Mido's House"),
    new ZelviewSceneDesc('kokiri_home5_scene', "Saria's House"),
    new ZelviewSceneDesc('kakariko_scene', 'Kakariko Village House'),
    new ZelviewSceneDesc('kakariko3_scene', 'Back Alley Village House'),
    new ZelviewSceneDesc('shop1_scene', 'Kakariko Bazaar'),
    new ZelviewSceneDesc('kokiri_shop_scene', 'Kokiri Shop'),
    new ZelviewSceneDesc('golon_scene', 'Goron Shop'),
    new ZelviewSceneDesc('zoora_scene', 'Zora Shop'),
    new ZelviewSceneDesc('drag_scene', 'Kakariko Potion Shop'),
    new ZelviewSceneDesc('alley_shop_scene', 'Market Potion Shop'),
    new ZelviewSceneDesc('night_shop_scene', 'Bombchu Shop'),
    new ZelviewSceneDesc('face_shop_scene', 'Happy Mask Shop'),
    new ZelviewSceneDesc('link_home_scene', "Link's House"),
    new ZelviewSceneDesc('impa_scene', "Puppy Woman's House"),
    new ZelviewSceneDesc('malon_stable_scene', 'Stables'),
    new ZelviewSceneDesc('labo_scene', "Impa's House"),
    new ZelviewSceneDesc('hylia_labo_scene', 'Lakeside Laboratory'),
    new ZelviewSceneDesc('tent_scene', "Carpenter's Tent"),
    new ZelviewSceneDesc('hut_scene', "Dampé's Hut"),
    new ZelviewSceneDesc('daiyousei_izumi_scene', 'Great Fairy Fountain'),
    new ZelviewSceneDesc('yousei_izumi_tate_scene', 'Small Fairy Fountain'),
    new ZelviewSceneDesc('yousei_izumi_yoko_scene', 'Magic Fairy Fountain'),
    new ZelviewSceneDesc('kakusiana_scene', 'Grottos'),
    new ZelviewSceneDesc('hakaana_scene', 'Grave (1)'),
    new ZelviewSceneDesc('hakaana2_scene', 'Grave (2)'),
    new ZelviewSceneDesc('hakaana_ouke_scene', "Royal Family's Tomb"),
    new ZelviewSceneDesc('syatekijyou_scene', 'Shooting Gallery'),
    new ZelviewSceneDesc('tokinoma_scene', 'Temple of Time Inside'),
    new ZelviewSceneDesc('kenjyanoma_scene', 'Chamber of Sages'),
    new ZelviewSceneDesc('hairal_niwa_scene', 'Castle Courtyard (Day)'),
    new ZelviewSceneDesc('hairal_niwa_n_scene', 'Castle Courtyard (Night)'),
    new ZelviewSceneDesc('hiral_demo_scene', 'Cutscene Map'),
    new ZelviewSceneDesc('hakasitarelay_scene', "Dampé's Grave & Kakariko Windmill"),
    new ZelviewSceneDesc('turibori_scene', 'Fishing Pond'),
    new ZelviewSceneDesc('nakaniwa_scene', "Zelda's Courtyard"),
    new ZelviewSceneDesc('bowling_scene', 'Bombchu Bowling Alley'),
    new ZelviewSceneDesc('souko_scene', "Talon's House"),
    new ZelviewSceneDesc('miharigoya_scene', "Lots'o Pots"),
    new ZelviewSceneDesc('mahouya_scene', "Granny's Potion Shop"),
    new ZelviewSceneDesc('ganon_demo_scene', 'Final Battle against Ganon'),
    new ZelviewSceneDesc('kinsuta_scene', 'Skulltula House'),
    new ZelviewSceneDesc('spot00_scene', 'Hyrule Field'),
    new ZelviewSceneDesc('spot01_scene', 'Kakariko Village'),
    new ZelviewSceneDesc('spot02_scene', 'Kakariko Graveyard'),
    new ZelviewSceneDesc('spot03_scene', "Zora's River"),
    new ZelviewSceneDesc('spot04_scene', 'Kokiri Forest'),
    new ZelviewSceneDesc('spot05_scene', 'Sacred Forest Meadow'),
    new ZelviewSceneDesc('spot06_scene', 'Lake Hylia'),
    new ZelviewSceneDesc('spot07_scene', "Zora's Domain"),
    new ZelviewSceneDesc('spot08_scene', "Zora's Fountain"),
    new ZelviewSceneDesc('spot09_scene', 'Gerudo Valley'),
    new ZelviewSceneDesc('spot10_scene', 'Lost Woods'),
    new ZelviewSceneDesc('spot11_scene', 'Desert Colossus'),
    new ZelviewSceneDesc('spot12_scene', "Gerudo's Fortress"),
    new ZelviewSceneDesc('spot13_scene', 'Haunted Wasteland'),
    new ZelviewSceneDesc('spot15_scene', 'Hyrule Castle'),
    new ZelviewSceneDesc('spot16_scene', 'Death Mountain'),
    new ZelviewSceneDesc('spot17_scene', 'Death Mountain Crater'),
    new ZelviewSceneDesc('spot18_scene', 'Goron City'),
    new ZelviewSceneDesc('spot20_scene', 'Lon Lon Ranch'),
    new ZelviewSceneDesc('ganon_tou_scene', "Ganon's Tower (Outside)"),
    new ZelviewSceneDesc('test01_scene', 'Collision Testing Area'),
    new ZelviewSceneDesc('besitu_scene', 'Besitu / Treasure Chest Warp'),
    new ZelviewSceneDesc('depth_test_scene', 'Depth Test'),
    new ZelviewSceneDesc('syotes_scene', 'Stalfos Middle Room'),
    new ZelviewSceneDesc('syotes2_scene', 'Stalfos Boss Room'),
    new ZelviewSceneDesc('sutaru_scene', 'Dark Link Testing Area'),
    new ZelviewSceneDesc('hairal_niwa2_scene', 'Beta Castle Courtyard'),
    new ZelviewSceneDesc('sasatest_scene', 'Action Testing Room'),
    new ZelviewSceneDesc('testroom_scene', 'Item Testing Room'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
