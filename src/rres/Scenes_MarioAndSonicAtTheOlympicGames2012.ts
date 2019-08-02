
import * as Viewer from "../viewer";
import Progressable from "../Progressable";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { fetchData } from "../fetch";
import { createBasicRRESRendererFromU8Buffer } from "./scenes";
import { SceneContext } from "../SceneBase";

const dataPath = `MarioAndSonicAtTheOlympicGames2012`;

class BasicRRESSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return dataFetcher.fetchData(`${dataPath}/Terrain/${this.id}`).then((data) => {
            return createBasicRRESRendererFromU8Buffer(device, data);
        });
    }
}

// Map data ripped by Tcheska @videoChess !!
// Naming and organization by Matthew @TanukiMatthew <3
const id = 'MarioAndSonicAtTheOlympicGames2012';
const name = "Mario & Sonic at the Olympic Games (2012)";

const sceneDescs = [
    "Dream Events",
    new BasicRRESSceneDesc("d110h_cmn1.arc", "Dream Hurdles: Battlerock Galaxy"),
    new BasicRRESSceneDesc("dcano_cmn1.arc", "Dream Rafting: Cheep Cheep River"),
    new BasicRRESSceneDesc("deque_cmn1.arc", "Dream Equestrian: Moo Moo Meadows"),
    new BasicRRESSceneDesc("dfenc_cmn1.arc", "Dream Fencing: Ocean Palace"),
    new BasicRRESSceneDesc("dlong_cmn1.arc", "Dream Long Jump: Yoshi's Picture Book"),
    new BasicRRESSceneDesc("dspri_cmn1.arc", "Dream Sprint: Bingo Highway"),
    new BasicRRESSceneDesc("dsync_cmn1.arc", "Dream Spacewalk: Synchro Battle Galaxy"),
    new BasicRRESSceneDesc("dthro_cmn1.arc", "Dream Discus: Windy Valley"),
    new BasicRRESSceneDesc("dtram_cmn1.arc", "Dream Trampoline: Crazy Gadget"),
    new BasicRRESSceneDesc("dunev_cmn1.arc", "Dream Uneven Bars: Grand Metropolis"),
    "Unique Mapped Olympic Events",
    new BasicRRESSceneDesc("eton_c210.arc", "Canoe Sprint 1000m: Eton Dorney"),
    new BasicRRESSceneDesc("exce_judo.arc", "Judo: 3DS Only Event"),
    new BasicRRESSceneDesc("hors_beac.arc", "Beach Volleyball: Horse Guards Parade"),
    "London Sports Arena",
    new BasicRRESSceneDesc("nor2_badm.arc", "Badminton - Doubles"),
    new BasicRRESSceneDesc("nor2_ryth.arc", "Rhythmic Ribbon"),
    "Aquatics Centre",
    new BasicRRESSceneDesc("aqu1_100m.arc", "100m Freestyle"),
    new BasicRRESSceneDesc("aqu1_100m_4p.arc", "100m Freestyle 4 Players"),
    // new BasicRRESSceneDesc("aqu1_100m_mini.arc"),
    new BasicRRESSceneDesc("aqu1_sync.arc", "Synchronised Swimming"),
    "ExCel London",
    new BasicRRESSceneDesc("exce_fenc.arc", "Fencing - Épée"),
    new BasicRRESSceneDesc("exce_tabl.arc", "Table Tennis - Singles"),
    new BasicRRESSceneDesc("exce_tabl_4p.arc", "Table Tennis 4 Players"),
    "North Greenwich Arena",
    new BasicRRESSceneDesc("nor1_tram.arc", "Trampoline"),
    new BasicRRESSceneDesc("nor1_unev.arc", "Uneven Bars"),
    new BasicRRESSceneDesc("gree_eque.arc", "Equestrian - Show Jumping: Greenwich Park"),
    "Olympic Stadium",
    new BasicRRESSceneDesc("olym_4x1r.arc", "4 x 100m Relay"),
    new BasicRRESSceneDesc("olym_4x1r_4p.arc", "4 x 100m Relay 4 Players"),
    new BasicRRESSceneDesc("olym_100m.arc", "100m Sprint"),
    new BasicRRESSceneDesc("olym_100m_4p.arc", "100m Sprint 4 Players"),
    new BasicRRESSceneDesc("olym_110h.arc", "110m Hurdles"),
    new BasicRRESSceneDesc("olym_110h_4p.arc", "110m Hurdles 4 Players"),
    new BasicRRESSceneDesc("olym_disc.arc", "Discus Throw"),
    new BasicRRESSceneDesc("olym_hamm.arc", "Hammer Throw"),
    new BasicRRESSceneDesc("olym_jave.arc", "Javelin Throw"),
    new BasicRRESSceneDesc("olym_long.arc", "Long Jump"),
    "London Party",
    new BasicRRESSceneDesc("pty5_cmn1.arc", "London (Day)"),
    new BasicRRESSceneDesc("pty6_cmn1.arc", "London (Night)"),
    new BasicRRESSceneDesc("pty1_cmn1.arc", "London (Darkened)"),
    new BasicRRESSceneDesc("pty4_cmn1.arc", "Vacant Lot Espio Search!"),
    new BasicRRESSceneDesc("pty2_cmn1.arc", "2D London Map Textures 1"),
    new BasicRRESSceneDesc("pty3_cmn1.arc", "2D London Map Textures 2"),
    new BasicRRESSceneDesc("a5_test.arc", "2D London Map Textures Text"),
    new BasicRRESSceneDesc("roya_shoo.arc", "Shooting - Pistol: The Royal Artillery Barracks"),
    new BasicRRESSceneDesc("velo_spri.arc", "Track Cycling - Team Pursuit: Velodrome"),
    new BasicRRESSceneDesc("wemb_foot.arc", "Football: Millennium Stadium"),
    "Olympic Stadium Testing",
    new BasicRRESSceneDesc("a_test.arc", "Test 1"),
    new BasicRRESSceneDesc("a2_test.arc", "Test 2"),
    new BasicRRESSceneDesc("a3_test.arc", "Test 3"),
    new BasicRRESSceneDesc("a4_test.arc", "Test 4"),
    
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
