
import * as Viewer from "../viewer";
import Progressable from "../Progressable";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { fetchData } from "../fetch";
import { createBasicRRESRendererFromU8Buffer } from "./scenes";

const dataPath = `MarioAndSonicAtTheOlympicGames2012`;

class BasicRRESSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(`${dataPath}/Terrain/${this.id}`, abortSignal).then((data) => {
            return createBasicRRESRendererFromU8Buffer(device, data);
        });
    }
}

const id = 'MarioAndSonicAtTheOlympicGames2012';
const name = "Mario & Sonic at the Olympic Games (2012)";

const sceneDescs = [
    new BasicRRESSceneDesc("aqu1_100m.arc"),
    new BasicRRESSceneDesc("aqu1_100m_4p.arc"),
    new BasicRRESSceneDesc("aqu1_100m_mini.arc"),
    new BasicRRESSceneDesc("aqu1_sync.arc"),
    new BasicRRESSceneDesc("d110h_cmn1.arc"),
    new BasicRRESSceneDesc("dcano_cmn1.arc"),
    new BasicRRESSceneDesc("deque_cmn1.arc"),
    new BasicRRESSceneDesc("dfenc_cmn1.arc"),
    new BasicRRESSceneDesc("dlong_cmn1.arc"),
    new BasicRRESSceneDesc("dspri_cmn1.arc"),
    new BasicRRESSceneDesc("dsync_cmn1.arc"),
    new BasicRRESSceneDesc("dthro_cmn1.arc"),
    new BasicRRESSceneDesc("dtram_cmn1.arc"),
    new BasicRRESSceneDesc("dunev_cmn1.arc"),
    new BasicRRESSceneDesc("eton_c210.arc"),
    new BasicRRESSceneDesc("exce_fenc.arc"),
    new BasicRRESSceneDesc("exce_judo.arc"),
    new BasicRRESSceneDesc("exce_tabl.arc"),
    new BasicRRESSceneDesc("exce_tabl_4p.arc"),
    new BasicRRESSceneDesc("gree_eque.arc"),
    new BasicRRESSceneDesc("hors_beac.arc"),
    new BasicRRESSceneDesc("nor1_tram.arc"),
    new BasicRRESSceneDesc("nor1_unev.arc"),
    new BasicRRESSceneDesc("nor2_badm.arc"),
    new BasicRRESSceneDesc("nor2_ryth.arc"),
    new BasicRRESSceneDesc("olym_4x1r.arc"),
    new BasicRRESSceneDesc("olym_4x1r_4p.arc"),
    new BasicRRESSceneDesc("olym_100m.arc"),
    new BasicRRESSceneDesc("olym_100m_4p.arc"),
    new BasicRRESSceneDesc("olym_110h.arc"),
    new BasicRRESSceneDesc("olym_110h_4p.arc"),
    new BasicRRESSceneDesc("olym_disc.arc"),
    new BasicRRESSceneDesc("olym_hamm.arc"),
    new BasicRRESSceneDesc("olym_jave.arc"),
    new BasicRRESSceneDesc("olym_long.arc"),
    new BasicRRESSceneDesc("pty1_cmn1.arc"),
    new BasicRRESSceneDesc("pty2_cmn1.arc"),
    new BasicRRESSceneDesc("pty3_cmn1.arc"),
    new BasicRRESSceneDesc("pty4_cmn1.arc"),
    new BasicRRESSceneDesc("pty5_cmn1.arc"),
    new BasicRRESSceneDesc("pty6_cmn1.arc"),
    new BasicRRESSceneDesc("roya_shoo.arc"),
    new BasicRRESSceneDesc("velo_spri.arc"),
    new BasicRRESSceneDesc("wemb_foot.arc"),
    new BasicRRESSceneDesc("a_test.arc"),
    new BasicRRESSceneDesc("a2_test.arc"),
    new BasicRRESSceneDesc("a3_test.arc"),
    new BasicRRESSceneDesc("a4_test.arc"),
    new BasicRRESSceneDesc("a5_test.arc"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
