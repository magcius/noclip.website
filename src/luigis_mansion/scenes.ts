
import * as Viewer from '../viewer';
import { DataFetcher } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';
import * as RARC from '../j3d/rarc';
import * as BIN from './bin';
import { LuigisMansionRenderer } from './render';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';

function fetchBin(path: string, dataFetcher: DataFetcher): Promise<BIN.BIN> {
    return dataFetcher.fetchData(`luigis_mansion/${path}`).then((buffer: ArrayBufferSlice) => {
        let binBuffer;
        if (path.endsWith('.bin')) {
            binBuffer = buffer;
        } else if (path.endsWith('.arc')) {
            const rarc = RARC.parse(buffer);
            const roomBinFile = rarc.findFile('room.bin');
            binBuffer = roomBinFile.buffer;
        }

        const name = path.split('/').pop();
        return BIN.parse(binBuffer, name);
    });
}

class LuigisMansionBinSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public paths: string[]) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const promises: Promise<BIN.BIN>[] = this.paths.map((path) => fetchBin(path, dataFetcher));

        // TODO(jstpierre): J3D format in VRB has a different version with a different MAT3 chunk.
        // promises.unshift(fetchVRBScene(gl, `vrball_B.szp`));

        return Promise.all(promises).then((bins: BIN.BIN[]) => {
            return new LuigisMansionRenderer(device, bins);
        });
    }
}

// Main mansion
const map2RoomsPaths: string[] = [
    `map2/room_00.arc`,
    `map2/room_01.arc`,
    `map2/room_02.arc`,
    `map2/room_03.arc`,
    `map2/room_04.arc`,
    `map2/room_05.arc`,
    `map2/room_06.arc`,
    `map2/room_07.arc`,
    `map2/room_08.arc`,
    `map2/room_09.arc`,
    `map2/room_10.arc`,
    `map2/room_11.arc`,
    `map2/room_12.arc`,
    `map2/room_13.arc`,
    `map2/room_14.arc`,
    `map2/room_15.arc`,
    `map2/room_16.arc`,
    `map2/room_17.arc`,
    `map2/room_18.arc`,
    `map2/room_19.arc`,
    `map2/room_20.arc`,
    `map2/room_21.arc`,
    `map2/room_22.arc`,
    `map2/room_23.arc`,
    `map2/room_24.arc`,
    `map2/room_25.arc`,
    `map2/room_26.arc`,
    `map2/room_27.arc`,
    `map2/room_28.arc`,
    `map2/room_28A.arc`, // Flipped room 28
    `map2/room_29.arc`,
    `map2/room_30.arc`,
    `map2/room_31.arc`,
    `map2/room_32.arc`,
    `map2/room_33.arc`,
    `map2/room_34.arc`,
    `map2/room_35.arc`,
    `map2/room_36.arc`,
    `map2/room_37.arc`,
    `map2/room_38.arc`,
    `map2/room_39.arc`,
    `map2/room_40.arc`,
    `map2/room_41.arc`,
    `map2/room_42.arc`,
    `map2/room_43.arc`,
    `map2/room_44.arc`,
    `map2/room_45.arc`,
    `map2/room_46.arc`,
    `map2/room_47.arc`,
    `map2/room_48.arc`,
    `map2/room_49.arc`,
    `map2/room_50.arc`,
    `map2/room_51.arc`,
    `map2/room_52.arc`,
    `map2/room_53.arc`,
    `map2/room_54.arc`,
    `map2/room_55.arc`,
    `map2/room_56.arc`,
    `map2/room_57.arc`,
    `map2/room_58.arc`,
    `map2/room_59.arc`,
    `map2/room_60.arc`,
    `map2/room_61.arc`,
    `map2/room_62.arc`,
    `map2/room_63.arc`,
    `map2/room_64.arc`,
    `map2/room_65.arc`,
    `map2/room_66.arc`,
    `map2/room_67.arc`,
    `map2/room_68.arc`,
    `map2/room_69.arc`,
    `map2/room_70.arc`,
    `map2/room_71.arc`,
    `map2/room_72.arc`,
    `map2/room_73.arc`,

    // `map2/room01A.bin`, // Unused.
];

const id = "luigis_mansion";
const name = "Luigi's Mansion";
const sceneDescs: Viewer.SceneDesc[] = [
    new LuigisMansionBinSceneDesc('map2', "Main Mansion", map2RoomsPaths),
    // h_01.bin is a duplicate of the room.bin found in hakase.arc
    new LuigisMansionBinSceneDesc('map1', "E Gadd's Garage", ['map1/h_02.bin', 'map1/hakase.arc']),
    new LuigisMansionBinSceneDesc('map3', "Training Room", ['map3/h_07_00.arc']),
    new LuigisMansionBinSceneDesc('map4', "Ghost Portrificationizer", ['map4/h_02.bin']),
    new LuigisMansionBinSceneDesc('map6', "Gallery", ['map6/gyara_00.arc', 'map6/gyara_01.arc', 'map6/gyara_02.arc', 'map6/gyara_03.arc']),
    new LuigisMansionBinSceneDesc('map5', "Gallery (Unused)", ['map5/h_03_00.bin', 'map5/h_03_01.bin', 'map5/h_03_02.bin', 'map5/h_03_03.bin']),
    new LuigisMansionBinSceneDesc('map7', "Gallery (Unused 2)", ['map7/h_05_00.bin', 'map7/h_05_01.bin', 'map7/h_05_02.bin', 'map7/h_05_03.bin']),
    new LuigisMansionBinSceneDesc('map8', "Gallery (Unused 3)", ['map8/h_06_00.bin', 'map8/h_06_01.bin', 'map8/h_06_02.bin', 'map8/h_06_03.bin']),
    new LuigisMansionBinSceneDesc('map9', "King Boo Boss Arena", ['map9/lastroof.arc']),
    new LuigisMansionBinSceneDesc('map10', "Chauncey Boss Arena", ['map10/roombed.arc']),
    new LuigisMansionBinSceneDesc('map11', "Boolossus Boss Arena", ['map11/beranda.arc']),
    new LuigisMansionBinSceneDesc('map13', "Bogmire Boss Arena", ['map13/tombboss.arc']),
    new LuigisMansionBinSceneDesc('map12', "Ghost Portrificationizer (End Credits)", ['map12/h_02.bin']),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
