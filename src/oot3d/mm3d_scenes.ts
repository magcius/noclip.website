
import * as CMAB from './cmab';
import * as ZAR from './zar';
import * as ZSI from './zsi';
import * as LzS from '../compression/LzS';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { RoomRenderer } from './render';
import { SceneGroup } from '../viewer';
import { RenderState } from '../render';
import { assert, readString } from '../util';
import { fetchData, downloadBuffer, NamedArrayBufferSlice } from '../fetch';

function maybeDecompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    if (readString(buffer, 0x00, 0x04) === 'LzS\x01')
        return LzS.decompress(buffer.createDataView());
    else
        return buffer;
}

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
        // Fetch the GAR & ZSI.
        const path_zar = `data/mm3d/${this.id}_info.gar`;
        const path_info_zsi = `data/mm3d/${this.id}_info.zsi`;
        return Progressable.all([fetchData(path_zar), fetchData(path_info_zsi)]).then(([zar, zsi]) => {
            return this._createSceneFromData(gl, zar, zsi);
        });
    }

    private _createSceneFromData(gl: WebGL2RenderingContext, zarBuffer: NamedArrayBufferSlice, zsiBuffer: NamedArrayBufferSlice): Progressable<Viewer.MainScene> {
        const zar = ZAR.parse(maybeDecompress(zarBuffer));

        const zsi = ZSI.parse(maybeDecompress(zsiBuffer));
        assert(zsi.rooms !== null);
        const roomFilenames = zsi.rooms.map((romPath) => {
            const filename = romPath.split('/').pop();
            return `data/mm3d/${filename}`;
        });

        return Progressable.all(roomFilenames.map((filename, i) => {
            return fetchData(filename).then((roomResult) => {
                const zsi = ZSI.parse(maybeDecompress(roomResult));
                assert(zsi.mesh !== null);
                const roomRenderer = new RoomRenderer(gl, zsi, filename);
                // TODO(jstpierre): Figure out what changed wrt. CMAB.
                /*
                const cmabFile = zar.files.find((file) => file.name.startsWith(`ROOM${i}`) && file.name.endsWith('.cmab'));
                if (cmabFile) {
                    const cmab = CMAB.parse(cmabFile.buffer);
                    roomRenderer.bindCMAB(cmab);
                }
                */
                return new Progressable(Promise.resolve(roomRenderer));
            });
        })).then((scenes: RoomRenderer[]) => {
            return new MultiScene(scenes);
        });
    }
}

const id = "mm3d";
const name = "Majora's Mask 3D";
const sceneDescs: SceneDesc[] = [
    { id: "z2_00keikoku" },
    { id: "z2_01keikoku" },
    { id: "z2_02keikoku" },
    { id: "z2_10yukiyamanomura" },
    { id: "z2_10yukiyamanomura2" },
    { id: "z2_11goronnosato" },
    { id: "z2_11goronnosato2" },
    { id: "z2_12hakuginmae" },
    { id: "z2_13hubukinomiti" },
    { id: "z2_14yukidamanomiti" },
    { id: "z2_16goron_house" },
    { id: "z2_17setugen" },
    { id: "z2_17setugen2" },
    { id: "z2_20sichitai" },
    { id: "z2_20sichitai2" },
    { id: "z2_21miturinmae" },
    { id: "z2_22dekucity" },
    { id: "z2_24kemonomiti" },
    { id: "z2_26sarunomori" },
    { id: "z2_30gyoson" },
    { id: "z2_31misaki" },
    { id: "z2_32kamejimamae" },
    { id: "z2_33zoracity" },
    { id: "z2_35taki" },
    { id: "z2_8itemshop" },
    { id: "z2_alley" },
    { id: "z2_ayashiishop" },
    { id: "z2_backtown" },
    { id: "z2_bandroom" },
    { id: "z2_bomya" },
    { id: "z2_boti" },
    { id: "z2_bowling" },
    { id: "z2_castle" },
    { id: "z2_clocktower" },
    { id: "z2_danpei" },
    { id: "z2_danpei2test" },
    { id: "z2_deku_king" },
    { id: "z2_dekutes" },
    { id: "z2_doujou" },
    { id: "z2_f01" },
    { id: "z2_f01_b" },
    { id: "z2_f01c" },
    { id: "z2_f40" },
    { id: "z2_f41" },
    { id: "z2_fisherman" },
    { id: "z2_goron_haka" },
    { id: "z2_goronrace" },
    { id: "z2_goronshop" },
    { id: "z2_hakashita" },
    { id: "z2_hakugin" },
    { id: "z2_hakugin_bs" },
    { id: "z2_ichiba" },
    { id: "z2_ikana" },
    { id: "z2_ikanamae" },
    { id: "z2_ikninside" },
    { id: "z2_inisie_bs" },
    { id: "z2_inisie_n" },
    { id: "z2_inisie_r" },
    { id: "z2_insidetower" },
    { id: "z2_kaizoku" },
    { id: "z2_kajiya" },
    { id: "z2_kindan2" },
    { id: "z2_kinsta1" },
    { id: "z2_koeponarace" },
    { id: "z2_konpeki_ent" },
    { id: "z2_kyojinnoma" },
    { id: "z2_labo" },
    { id: "z2_last_bs" },
    { id: "z2_last_deku" },
    { id: "z2_last_goron" },
    { id: "z2_last_link" },
    { id: "z2_last_zora" },
    { id: "z2_lost_woods" },
    { id: "z2_map_shop" },
    { id: "z2_meganeana" },
    { id: "z2_milk_bar" },
    { id: "z2_miturin" },
    { id: "z2_miturin_bs" },
    { id: "z2_musichouse" },
    { id: "z2_okujou" },
    { id: "z2_omoya" },
    { id: "z2_openingdan" },
    { id: "z2_pirate" },
    { id: "z2_posthouse" },
    { id: "z2_random" },
    { id: "z2_redead" },
    { id: "z2_romanymae" },
    { id: "z2_sea" },
    { id: "z2_sea_bs" },
    { id: "z2_secom" },
    { id: "z2_sinkai" },
    { id: "z2_sonchonoie" },
    { id: "z2_sougen" },
    { id: "z2_syateki_mizu" },
    { id: "z2_syateki_mori" },
    { id: "z2_takarakuji" },
    { id: "z2_takaraya" },
    { id: "z2_tenmon_dai" },
    { id: "z2_toride" },
    { id: "z2_tougites" },
    { id: "z2_town" },
    { id: "z2_turibori" },
    { id: "z2_turibori2" },
    { id: "z2_witch_shop" },
    { id: "z2_yadoya" },
    { id: "z2_yousei_izumi" },
    { id: "z2_zolashop" },
    { id: "test01" },
    { id: "test02" },
    { id: "kakusiana" },
    { id: "spot00" },
].map((entry): SceneDesc => {
    const name = entry.id;
    return new SceneDesc(name, entry.id);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
