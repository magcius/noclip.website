
import * as CMAB from './cmab';
import * as CMB from './cmb';
import * as ZAR from './zar';
import * as ZSI from './zsi';
import * as LzS from '../compression/LzS';

import * as Viewer from '../viewer';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { RoomRenderer, CtrTextureHolder } from './render';
import { SceneGroup } from '../viewer';
import { assert, readString, leftPad } from '../util';
import { fetchData, NamedArrayBufferSlice } from '../fetch';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { MultiRoomScene } from './oot3d_scenes';

function maybeDecompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    if (readString(buffer, 0x00, 0x04) === 'LzS\x01')
        return LzS.decompress(buffer.createDataView());
    else
        return buffer;
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id, public disabledRooms: number[] = []) {
        this.name = name;
        this.id = id;
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        // Fetch the GAR & ZSI.
        const path_zar = `mm3d/${this.id}_info.gar`;
        const path_info_zsi = `mm3d/${this.id}_info.zsi`;
        return Progressable.all([fetchData(path_zar, abortSignal), fetchData(path_info_zsi, abortSignal)]).then(([zar, zsi]) => {
            return this._createSceneFromData(device, abortSignal, zar, zsi);
        });
    }

    private _createSceneFromData(device: GfxDevice, abortSignal: AbortSignal, zarBuffer: NamedArrayBufferSlice, zsiBuffer: NamedArrayBufferSlice): Progressable<Viewer.SceneGfx> {
        const textureHolder = new CtrTextureHolder();

        const zar = ZAR.parse(maybeDecompress(zarBuffer));

        const zsi = ZSI.parseScene(maybeDecompress(zsiBuffer));
        assert(zsi.rooms !== null);

        return Progressable.all(zsi.rooms.map((romPath, i) => {
            const filename = romPath.split('/').pop();
            return fetchData(`mm3d/${filename}`, abortSignal).then((roomResult) => {
                const roomSetups = ZSI.parseRooms(maybeDecompress(roomResult));
                // Pull out the first mesh we can find.
                const mesh = roomSetups.find((roomSetup) => roomSetup.mesh !== null).mesh;
                assert(mesh !== null);

                const roomNameBase = `ROOM${i}/${this.id}_${leftPad(`${i}`, 2, '0')}`;

                const wCmbFile = ZAR.findFile(zar, `${roomNameBase}_w.cmb`);
                let wCmb: CMB.CMB | null = null;
                if (wCmbFile !== null) {
                    // TODO(jstpierre): Add these once we figure out where to place them.
                    // wCmb = CMB.parse(wCmbFile.buffer);
                }

                const roomRenderer = new RoomRenderer(device, textureHolder, mesh, filename, wCmb);

                const cmabFile = ZAR.findFile(zar, `${roomNameBase}.cmab`);
                if (cmabFile !== null) {
                    const cmab = CMAB.parse(CMB.Version.Majora, cmabFile.buffer);
                    textureHolder.addTextures(device, cmab.textures);
                    roomRenderer.bindCMAB(cmab);
                }

                const wcmabFile = ZAR.findFile(zar, `${roomNameBase}_w.cmab`);
                if (wcmabFile !== null) {
                    const wcmab = CMAB.parse(CMB.Version.Majora, wcmabFile.buffer);
                    textureHolder.addTextures(device, wcmab.textures);
                    roomRenderer.bindWCMAB(wcmab);
                }

                if (this.disabledRooms.includes(i))
                    roomRenderer.setVisible(false);

                return roomRenderer;
            });
        })).then((scenes: RoomRenderer[]) => {
            return new MultiRoomScene(device, scenes, textureHolder);
        });
    }
}

const id = "mm3d";
const name = "Majora's Mask 3D";
// Names graciously provided by James Knight on Twitter, and organized by Starschulz. Thanks!
const sceneDescs = [
    "Intro",
    new SceneDesc("z2_lost_woods", "The Lost Woods"),
    new SceneDesc("z2_openingdan", "Road to Termina"),

    "Termina",
    new SceneDesc("z2_00keikoku", "Termina Field"),
    new SceneDesc("z2_01keikoku", "Termina Field (Telescope)"),
    new SceneDesc("z2_02keikoku", "Termina Field (?)"),
    new SceneDesc("z2_kyojinnoma", "Giant's Realm"),
    new SceneDesc("z2_yousei_izumi", "Fairy Fountains"),
    new SceneDesc("kakusiana", "Underground Caves"),

    "Clock Town",
    new SceneDesc("z2_backtown", "North Clock Town"),
    new SceneDesc("z2_town", "East Clock Town"),
    new SceneDesc("z2_clocktower", "South Clock Town"),
    new SceneDesc("z2_ichiba", "West Clock Town"),
    new SceneDesc("z2_tenmon_dai", "Clock Town Sewers"),
    new SceneDesc("z2_alley", "Laundry Pool"),
    new SceneDesc("z2_8itemshop", "Trading Post"),
    new SceneDesc("z2_ayashiishop", "Kafei's Hideout"),
    new SceneDesc("z2_bomya", "Bomb Shop"),
    new SceneDesc("z2_bowling", "Honey & Darling's Shop"),
    new SceneDesc("z2_doujou", "Swordsman's School"),
    new SceneDesc("z2_insidetower", "Clock Tower"),
    new SceneDesc("z2_milk_bar", "Milk Bar"),
    new SceneDesc("z2_okujou", "Top of Clock Tower"),
    new SceneDesc("z2_posthouse", "Postman's Office"),
    new SceneDesc("z2_sonchonoie", "Mayor's Office"),
    new SceneDesc("z2_syateki_mizu", "Town Shooting Gallery"),
    new SceneDesc("z2_takarakuji", "Lottery Shop"),
    new SceneDesc("z2_takaraya", "Treasure Chest Minigame"),
    new SceneDesc("z2_yadoya", "Stock Pot Inn"),

    "Milk Road",
    new SceneDesc("z2_romanymae", "Milk Road"),
    new SceneDesc("z2_f01", "Romani Ranch"),
    new SceneDesc("z2_omoya", "Romani's House & Barn"),
    new SceneDesc("z2_koeponarace", "Gorman Track"),
    new SceneDesc("z2_f01_b", "Doggy Racetrack"),
    new SceneDesc("z2_f01c", "Cucco Shack"),

    "Southern Swamp",
    new SceneDesc("z2_20sichitai", "Southern Swamp"),
    new SceneDesc("z2_20sichitai2", "Southern Swamp (Clear)"),
    new SceneDesc("z2_24kemonomiti", "Southern Swamp Trail"),
    new SceneDesc("z2_26sarunomori", "Woods of Mystery"),
    new SceneDesc("z2_21miturinmae", "Woodfall"),
    new SceneDesc("z2_22dekucity", "Deku Palace"),
    new SceneDesc("z2_danpei", "Deku Shrine"),
    new SceneDesc("z2_deku_king", "Deku King's Chamber"),
    new SceneDesc("z2_dekutes", "Deku Scrub Playground"),
    new SceneDesc("z2_kinsta1", "Swamp Spider House"),
    new SceneDesc("z2_map_shop", "Tourist Information"),
    new SceneDesc("z2_syateki_mori", "Swamp Shooting Gallery"),
    new SceneDesc("z2_turibori", "Swamp Fishing Hole"),
    new SceneDesc("z2_witch_shop", "Magic Hags' Potion Shop"),
    new SceneDesc("z2_miturin", "Woodfall Temple"),
    new SceneDesc("z2_miturin_bs", "Woodfall Temple (Boss)"),

    "Snowhead",
    new SceneDesc("z2_10yukiyamanomura", "Mountain Village"),
    new SceneDesc("z2_10yukiyamanomura2", "Mountain Village (Spring)"),
    new SceneDesc("z2_11goronnosato", "Goron Village"),
    new SceneDesc("z2_11goronnosato2", "Goron Village (Spring)"),
    new SceneDesc("z2_12hakuginmae", "Snowhead"),
    new SceneDesc("z2_13hubukinomiti", "Mountain Village Trail"),
    new SceneDesc("z2_14yukidamanomiti", "Snowhead Trail"),
    new SceneDesc("z2_16goron_house", "Goron Shrine"),
    new SceneDesc("z2_17setugen", "Mountain Pond"),
    new SceneDesc("z2_17setugen2", "Mountain Pond (Spring)"),
    new SceneDesc("z2_goron_haka", "Goron Graveyard"),
    new SceneDesc("z2_goronrace", "Goron Racetrack"),
    new SceneDesc("z2_goronshop", "Goron Shop"),
    new SceneDesc("z2_kajiya", "Mountain Smithy"),
    new SceneDesc("z2_hakugin", "Snowhead Temple"),
    new SceneDesc("z2_hakugin_bs", "Snowhead Temple (Boss)"),

    "Great Bay",
    new SceneDesc("z2_30gyoson", "Great Bay Coast"),
    new SceneDesc("z2_35taki", "Waterfall Rapids"),
    new SceneDesc("z2_31misaki", "Zora Cape"),
    new SceneDesc("z2_33zoracity", "Zora Hall"),
    new SceneDesc("z2_bandroom", "Zora Band Rooms"),
    new SceneDesc("z2_fisherman", "Fisherman's Hut"),
    new SceneDesc("z2_labo", "Marine Research Lab"),
    new SceneDesc("z2_kaizoku", "Pirates' Fortress (Central)"),
    new SceneDesc("z2_pirate", "Pirates' Fortress (Inside)"),
    new SceneDesc("z2_toride", "Pirates' Fortress Entrance"),
    new SceneDesc("z2_sinkai", "Pinnacle Rock"),
    new SceneDesc("z2_kindan2", "Oceanside Spider House"),
    new SceneDesc("z2_turibori2", "Ocean Fishing Hole"),
    new SceneDesc("z2_konpeki_ent", "Great Bay Temple (Outside)"),
    new SceneDesc("z2_sea", "Great Bay Temple"),
    new SceneDesc("z2_sea_bs", "Great Bay Temple (Boss)"),

    "Ikana Canyon",
    new SceneDesc("z2_ikanamae", "Ikana Trail"),
    new SceneDesc("z2_ikana", "Ikana Canyon"),
    new SceneDesc("z2_boti", "Ikana Graveyard"),
    new SceneDesc("z2_castle", "Ancient Castle of Ikana"),
    new SceneDesc("z2_hakashita", "Ikana Grave (Night One & Two)"),
    new SceneDesc("z2_danpei2test", "Ikana Grave (Night Three)"),
    new SceneDesc("z2_ikninside", "Ancient Castle of Ikana Throne Room"),
    new SceneDesc("z2_tougites", "Poe Battle Arena"),
    new SceneDesc("z2_musichouse", "Music Box House"),
    new SceneDesc("z2_random", "Secret Shrine"),
    new SceneDesc("z2_redead", "Beneath the Well"),
    new SceneDesc("z2_secom", "Sakon's Hideout"),
    new SceneDesc("z2_f40", "Stone Tower"),
    new SceneDesc("z2_f41", "Stone Tower (Upside Down)"),
    new SceneDesc("z2_inisie_n", "Stone Tower Temple", [5, 6, 11]),
    new SceneDesc("z2_inisie_r", "Stone Tower Temple (Upside Down)", [7, 9]),

    "The Moon",
    new SceneDesc("z2_sougen", "The Moon"),
    new SceneDesc("z2_last_link", "Link's Trial"),
    new SceneDesc("z2_last_deku", "Deku Link's Trial"),
    new SceneDesc("z2_last_goron", "Goron Link's Trial"),
    new SceneDesc("z2_last_zora", "Zora Link's Trial"),
    new SceneDesc("z2_last_bs", "Majora's Mask (Boss)"),

    "Test Maps",
    new SceneDesc("test01", "Test Map 1"),
    new SceneDesc("test02", "Test Map 2"),
    new SceneDesc("spot00"),
    new SceneDesc("z2_32kamejimamae"),
    new SceneDesc("z2_inisie_bs"),
    new SceneDesc("z2_meganeana"),
    new SceneDesc("z2_zolashop"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
