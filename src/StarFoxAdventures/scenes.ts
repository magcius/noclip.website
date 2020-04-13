import * as Viewer from '../viewer';
import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';

import { SFAMapSceneDesc, AncientMapSceneDesc } from './maps';
import { SFAModelExhibitSceneDesc } from './modelexhibit';
import { ModelVersion } from './models';
import { BlockFetcher } from './blocks';
import { loadRes, getSubdir } from './resource';
import { SFAWorldSceneDesc } from './world';

export interface GameInfo {
    pathBase: string;
    subdirs: {[key: number]: string};
    makeBlockFetcher: (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => Promise<BlockFetcher>;
}

class SFABlockFetcher implements BlockFetcher {
    public blocksTab: DataView;
    public blocksBin: ArrayBufferSlice;
    public trkblkTab: DataView;
    public locationNum: number;

    constructor(private isDeletedMap: boolean) {
    }

    public async create(locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) {
        this.locationNum = locationNum;
        const pathBase = gameInfo.pathBase;
        this.trkblkTab = (await dataFetcher.fetchData(`${pathBase}/TRKBLK.tab`)).createDataView();
        const subdir = getSubdir(locationNum, gameInfo);
        if (this.isDeletedMap) {
            console.log(`isDeletedMap; subdir ${subdir}`);
            // this.blocksTab = (await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.tab`)).createDataView();
            // this.blocksBin = await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.bin`);
            const [blocksTab, blocksBin] = await Promise.all([
                dataFetcher.fetchData(`${pathBase}/mod${getModNumber(locationNum)}.tab`),
                dataFetcher.fetchData(`${pathBase}/mod${getModNumber(locationNum)}.bin`),
            ]);
            this.blocksTab = blocksTab.createDataView();
            this.blocksBin = blocksBin;
        } else {
            const [blocksTab, blocksBin] = await Promise.all([
                dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.tab`),
                dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.zlb.bin`),
            ]);
            this.blocksTab = blocksTab.createDataView();
            this.blocksBin = blocksBin;
        }
    }

    public getBlock(mod: number, sub: number): ArrayBufferSlice | null {
        if (this.isDeletedMap) {
            // Different handling for blocks from the demo version's deleted maps
            // Find a workable block number...
            let firstBlockNum = 0;
            for (let i = 0; i < this.blocksTab.byteLength/4; i++) {
                if (this.blocksTab.getUint32(i * 4) == 0x10000000)
                    break;
                firstBlockNum++;
            }

            const num = firstBlockNum + sub;
            if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
                return null;
            }
            const tabValue = this.blocksTab.getUint32(num * 4);
            if (!(tabValue & 0x10000000)) {
                return null;
            }
            const blockOffset = tabValue & 0xFFFFFF;
            console.log(`Loading deleted block from offset 0x${blockOffset.toString(16)} (location num ${this.locationNum})`);
            const blocksBinPart = this.blocksBin.slice(blockOffset);
            return blocksBinPart;
        }

        if (mod < 0 || mod * 2 >= this.trkblkTab.byteLength) {
            return null;
        }
        const trkblk = this.trkblkTab.getUint16(mod * 2);
        const blockNum = trkblk + sub;
        if (blockNum < 0 || blockNum * 4 >= this.blocksTab.byteLength) {
            return null;
        }
        const tabValue = this.blocksTab.getUint32(blockNum * 4);
        if (!(tabValue & 0x10000000)) {
            return null;
        }
        const blockOffset = tabValue & 0xFFFFFF;
        const blocksBinPart = this.blocksBin.slice(blockOffset);
        const uncomp = loadRes(blocksBinPart);
        return uncomp;
    }
}

export const SFA_GAME_INFO: GameInfo = {
    pathBase: 'StarFoxAdventures',
    makeBlockFetcher: async (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => {
        const result = new SFABlockFetcher(false);
        await result.create(locationNum, dataFetcher, gameInfo);
        return result;
    },
    subdirs: {
        0: 'animtest',
        1: 'animtest',
        2: 'animtest',
        3: 'arwing',
        4: 'dragrock',
        5: 'animtest',
        6: 'dfptop',
        7: 'volcano',
        8: 'animtest',
        9: 'mazecave',
        10: 'dragrockbot',
        11: 'dfalls',
        12: 'swaphol',
        13: 'shipbattle',
        14: 'nwastes',
        15: 'warlock',
        16: 'shop',
        17: 'animtest',
        18: 'crfort',
        19: 'swapholbot',
        20: 'wallcity',
        21: 'lightfoot',
        22: 'cloudtreasure',
        23: 'animtest',
        24: 'clouddungeon',
        25: 'mmpass',
        26: 'darkicemines',
        27: 'animtest',
        28: 'desert',
        29: 'animtest',
        30: 'icemountain',
        31: 'animtest',
        32: 'animtest',
        33: 'animtest',
        34: 'darkicemines2',
        35: 'bossgaldon',
        36: 'animtest',
        37: 'insidegal',
        38: 'magiccave',
        39: 'dfshrine',
        40: 'mmshrine',
        41: 'ecshrine',
        42: 'gpshrine',
        43: 'dbshrine',
        44: 'nwshrine',
        45: 'worldmap',
        46: 'animtest',
        47: 'capeclaw',
        48: 'dbay',
        49: 'animtest',
        50: 'cloudrace',
        51: 'bossdrakor',
        52: 'animtest',
        53: 'bosstrex',
        54: 'linkb',
        55: 'cloudjoin',
        56: 'arwingtoplanet',
        57: 'arwingdarkice',
        58: 'arwingcloud',
        59: 'arwingcity',
        60: 'arwingdragon',
        61: 'gamefront',
        62: 'linklevel',
        63: 'greatfox',
        64: 'linka',
        65: 'linkc',
        66: 'linkd',
        67: 'linke',
        68: 'linkf',
        69: 'linkg',
        70: 'linkh',
        71: 'linkj',
        72: 'linki',
    },
}

// Maps mod numbers to block numbers. Values are hand-crafted. 
const ANCIENT_TRKBLK: {[key: number]: number} = {
    1: 0x16, // mod1.0..12
    2: 0x23, // mod2.0..21
    3: 0x39, // mod3.0..29
    4: 0x57, // mod4.0..54
    5: 0x0, // mod5.0..21
    6: 0x8e, // mod6.0..21
    7: 0xa4, // mod7.0..21
    8: 0xba, // mod8.0..21
    9: 0xd0, // mod9.0..21
    10: 0xe6, // mod10.0..21
    11: 0xfc, // mod11.0..22
    12: 0x113, // mod12.0..21
    13: 0x129, // mod13.0..25
    14: 0x143, // mod14.0..21
    15: 0x159, // mod15.0..38
    16: 0x180, // mod16.0..63
    17: 0x1c0, // mod17.0..4
    18: 0x1c5, // mod18.0..21
    19: 0x1db, // mod19.0..34
    20: 0x1fe, // mod20.0..21
    21: 0x214, // mod21.0..21
    22: 0x22a, // mod22.0..21
    23: 0x240, // mod23.0..21
    24: 0x256, // mod24.0..21
    25: 0x26c, // mod25.0..21
    26: 0x282, // mod26.0..21
    27: 0x298, // mod27.0..43
    28: 0x2c4, // mod28.0..21
    29: 0x2da, // mod29.0..21
    30: 0x2f0, // mod30.0..21
    31: 0x306, // mod31.0..13
    32: 0x314, // mod32.0..16
    33: 0x325, // mod33.0..15
    34: 0x335, // mod34.0..21
    35: 0x34b, // mod35.0..23
    36: 0x363, // mod36.0..4
    37: 0x368, // mod37.0..21
    38: 0x37e, // mod38.0..21
    39: 0x394, // mod39.0..21
    40: 0x3aa, // mod40.0..21
    41: 0x3c0, // mod41.0..21
    42: 0x3d6, // mod42.0..21
    43: 0x3ec, // mod43.0..21
    44: 0x402, // mod44.0..21
    45: 0x418, // mod45.0..21
    46: 0x42e, // mod46.0
    47: 0x42f, // mod47.0..21
    48: 0x445, // mod48.0..21
    49: 0x45b, // mod49.0..21
    50: 0x471, // mod50.0..21
    51: 0x487, // mod51.0..23
    52: 0x49f, // mod52.0..21
    53: 0x4b5, // mod53.0..21
    54: 0x4cb, // mod54.0..15
    55: 0x4db, // mod55.0..21
};

class AncientBlockFetcher implements BlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;

    public async create(dataFetcher: DataFetcher, gameInfo: GameInfo) {
        const pathBase = gameInfo.pathBase;
        this.blocksTab = (await dataFetcher.fetchData(`${pathBase}/BLOCKS.tab`)).createDataView();
        this.blocksBin = await dataFetcher.fetchData(`${pathBase}/BLOCKS.bin`);
    }

    public getBlock(mod: number, sub: number): ArrayBufferSlice | null {
        const num = ANCIENT_TRKBLK[mod] + sub;
        if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
            return null;
        }
        const blockOffset = this.blocksTab.getUint32(num * 4);
        console.log(`Loading block ${num} from BLOCKS.bin offset 0x${blockOffset.toString(16)}`);
        const blocksBinPart = this.blocksBin.slice(blockOffset);
        return blocksBinPart;
    }
}

export const SFADEMO_GAME_INFO: GameInfo = {
    pathBase: 'StarFoxAdventuresDemo',
    makeBlockFetcher: async (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => {
        const result = new SFABlockFetcher(true); // Change to true if you want to see earlier prototype blocks!
        await result.create(locationNum, dataFetcher, gameInfo);
        return result;
    },
    subdirs: {
        0: 'animtest',
        1: 'animtest',
        2: 'animtest',
        3: 'arwing',
        4: 'dragrock',
        5: 'animtest',
        6: 'dfptop',
        7: 'volcano',
        8: 'animtest',
        9: 'mazecave', // 9: 'animtest',
        10: 'dragrockbot',
        11: 'dfalls',
        12: 'swaphol',
        13: 'shipbattle', // 13: 'animtest',
        14: 'nwastes',
        15: 'warlock',
        16: 'shop',
        17: 'animtest',
        18: 'crfort',
        19: 'swapholbot',
        20: 'wallcity',
        21: 'lightfoot',
        22: 'cloudtreasure',
        23: 'animtest',
        24: 'clouddungeon',
        25: 'mmpass',
        26: 'darkicemines',
        27: 'dfptop', // 27: 'animtest',
        28: 'desert',
        29: 'frontend', // 29: 'animtest',
        30: 'icemountain',
        31: 'mmshrine', // 31: 'animtest',
        32: 'animtest',
        33: 'animtest',
        34: 'darkicemines2',
        35: 'bossgaldon',
        36: 'animtest',
        37: 'insidegal',
        38: 'magiccave',
        39: 'dfshrine',
        40: 'mmshrine',
        41: 'ecshrine',
        42: 'gpshrine',
        43: 'dbshrine',
        44: 'nwshrine',
        45: 'worldmap',
        46: 'animtest',
        47: 'capeclaw',
        48: 'dbay',
        49: 'animtest',
        50: 'cloudrace',
        51: 'bossdrakor',
        52: 'animtest',
        53: 'bosstrex',
        54: 'linkb', // 54: 'animtest',
        // The following entries are missing from the demo executable.
        57: 'arwingdarkice',
        58: 'arwingcloud',
        59: 'arwingcity',
        60: 'arwingdragon',
        61: 'gamefront',
        62: 'linklevel',
        63: 'greatfox',
        64: 'linka',
        65: 'linkc',
        66: 'linkd',
        67: 'linke',
        68: 'linkf',
        69: 'linkg',
        70: 'linkh',
        71: 'linkj',
        72: 'linki',
    }
}

const ANCIENT_DP_GAME_INFO: GameInfo = {
    pathBase: 'StarFoxAdventuresDemo',
    makeBlockFetcher: async (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => {
        const result = new AncientBlockFetcher();
        await result.create(dataFetcher, gameInfo);
        return result;
    },
    subdirs: [], // N/A
}

function getModNumber(locationNum: number): number {
    if (locationNum < 5) // This is strange, but it matches the decompilation.
        return locationNum
    else
        return locationNum + 1
}

class BlockExhibitFetcher implements BlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;
    public blockOffsets: number[] = [];

    constructor(public useCompression: boolean) {
    }

    public async create(dataFetcher: DataFetcher, directory: string, blocksTabName: string, blocksBinName: string) {
        this.blocksTab = (await dataFetcher.fetchData(`${directory}/${blocksTabName}`)).createDataView();
        this.blocksBin = await dataFetcher.fetchData(`${directory}/${blocksBinName}`);
        let offs = 0;
        while (offs < this.blocksTab.byteLength) {
            const tabValue = this.blocksTab.getUint32(offs);
            if (tabValue == 0xFFFFFFFF) {
                break;
            }
            if (this.useCompression) {
                if ((tabValue >> 24) == 0x10) {
                    this.blockOffsets.push(tabValue & 0xFFFFFF);
                }
            } else {
                this.blockOffsets.push(tabValue);
            }
            offs += 4;
        }
        console.log(`Loaded ${this.blockOffsets.length} blocks`)
    }

    public getBlock(num: number): ArrayBufferSlice | null {
        if (num < 0 || num >= this.blockOffsets.length) {
            return null;
        }
        const blockOffset = this.blockOffsets[num];
        // console.log(`Loading block from offset 0x${blockOffset.toString(16)}`);
        const blocksBinPart = this.blocksBin.slice(blockOffset);
        if (this.useCompression) {
            const uncomp = loadRes(blocksBinPart);
            return uncomp;
        } else {
            return blocksBinPart;
        }
    }
}

const sceneDescs = [
    'Maps',
    // Dinosaur Planet contains many maps. During the transition to the GameCube
    // when the game became Star Fox Adventures, many of these locations were
    // dropped. Their data remains, but it references missing and/or broken data
    // and thus cannot be loaded.
    // new SFAMapDesc(1, 'loc1', 'Location 1'),
    new SFAMapSceneDesc(2, 'loc2', 'Dragon Rock'),
    // new SFAMapDesc(3, 'loc3', 'Location'),
    new SFAMapSceneDesc(4, 'loc4', 'Volcano Force Point Temple'),
    // new SFAMapDesc(5, 'loc5', 'Location'),
    // new SFAMapDesc(6, 'loc6', 'Location'), // dfalls
    new SFAMapSceneDesc(7, 'loc7', 'ThornTail Hollow'),
    new SFAMapSceneDesc(8, 'loc8', 'ThornTail Hollow Well'),
    new SFAMapSceneDesc(9, 'loc9', 'Cheat Token Maze'),
    new SFAMapSceneDesc(10, 'loc10', 'SnowHorn Wastes'),
    new SFAMapSceneDesc(11, 'loc11', 'Krazoa Palace'),
    new SFAMapSceneDesc(12, 'loc12', 'CloudRunner Fortress'),
    new SFAMapSceneDesc(13, 'loc13', 'Walled City'),
    new SFAMapSceneDesc(14, 'loc14', 'LightFoot Village'),
    // new SFAMapDesc(15, 'loc15', 'Location'),
    new SFAMapSceneDesc(16, 'loc16', 'CloudRunner Fortress Dungeon'),
    // new SFAMapDesc(17, 'loc17', 'Location'),
    new SFAMapSceneDesc(18, 'loc18', 'Moon Mountain Pass'),
    new SFAMapSceneDesc(19, 'loc19', 'DarkIce Mines Exterior'),
    // new SFAMapDesc(20, 'loc20', 'Location 20'),
    new SFAMapSceneDesc(21, 'loc21', 'Ocean Force Point Temple Interior'),
    // new SFAMapDesc(22, 'loc22', 'Location'),
    new SFAMapSceneDesc(23, 'loc23', 'Ice Mountain'),
    // new SFAMapDesc(24, 'loc24', 'Location'),
    // new SFAMapDesc(25, 'loc25', 'Location'),
    new SFAMapSceneDesc(26, 'loc26', 'Test Map (animtest)'),
    new SFAMapSceneDesc(27, 'loc27', 'DarkIce Mines Interior'),
    new SFAMapSceneDesc(28, 'loc28', 'DarkIce Mines Boss (Galdon)'),
    new SFAMapSceneDesc(29, 'loc29', 'Cape Claw'),
    // new SFAMapDesc(30, 'loc30', 'Location 30'),
    new SFAMapSceneDesc(31, 'loc31', 'Krazoa Shrine (Test of Combat)'),
    new SFAMapSceneDesc(32, 'loc32', 'Krazoa Shrine (Test of Fear)'),
    new SFAMapSceneDesc(33, 'loc33', 'Krazoa Shrine (Test of Observation)'),
    new SFAMapSceneDesc(34, 'loc34', 'Krazoa Shrine (Test of Knowledge)'),
    // new SFAMapDesc(35, 'loc35', 'Location'),
    // new SFAMapDesc(36, 'loc36', 'Location'),
    // new SFAMapDesc(37, 'loc37', 'Location'),
    // new SFAMapDesc(38, 'loc38', 'Location'),
    new SFAMapSceneDesc(39, 'loc39', 'Krazoa Shrine (Test of Strength)'),
    new SFAMapSceneDesc(40, 'loc40', 'Krazoa Shrine (Scales Encounter)'),
    // new SFAMapDesc(41, 'loc41', 'Location'),
    // new SFAMapDesc(42, 'loc42', 'Location'),
    new SFAMapSceneDesc(43, 'loc43', 'CloudRunner Fortress Race'),
    new SFAMapSceneDesc(44, 'loc44', 'Dragon Rock Boss (Drakor)'),
    new SFAMapSceneDesc(45, 'loc45', 'SnowHorn Wastes Area'),
    // new SFAMapDesc(46, 'loc46', 'Location'),
    // new SFAMapDesc(47, 'loc47', 'Location'),
    new SFAMapSceneDesc(48, 'loc48', 'Walled City Boss (RedEye King)'),
    // new SFAMapDesc(49, 'loc49', 'Location'),
    new SFAMapSceneDesc(50, 'loc50', 'Ocean Force Point Temple Exterior'),
    new SFAMapSceneDesc(51, 'loc51', 'ThornTail Shop'),
    // new SFAMapDesc(52, 'loc52', 'Location'),
    // new SFAMapDesc(53, 'loc53', 'Location'),
    new SFAMapSceneDesc(54, 'loc54', 'Magic Cave'),
    new SFAMapSceneDesc(55, 'loc55', 'Ice Mountain Link'),
    new SFAMapSceneDesc(56, 'loc56', 'Ice Mountain Link 2'),
    // new SFAMapDesc(57, 'loc57', 'Location'),
    new SFAMapSceneDesc(58, 'loc58', 'Arwing Flight (Main Planet)'),
    new SFAMapSceneDesc(59, 'loc59', 'Arwing Flight (DarkIce Mines)'),
    new SFAMapSceneDesc(60, 'loc60', 'Arwing Flight (CloudRunner Fortress)'),
    new SFAMapSceneDesc(61, 'loc61', 'Arwing Flight (Walled City)'),
    new SFAMapSceneDesc(62, 'loc62', 'Arwing Flight (Dragon Rock)'),
    new SFAMapSceneDesc(63, 'loc63', 'Great Fox'),
    // new SFAMapDesc(64, 'loc64', 'Location'),
    new SFAMapSceneDesc(65, 'loc65', 'Great Fox 2'),
    // new SFAMapDesc(66, 'loc66', 'Location'), // Black space
    new SFAMapSceneDesc(67, 'loc67', 'SnowHorn Wastes Link'),
    new SFAMapSceneDesc(68, 'loc68', 'DarkIce Mines Mineshaft'),
    new SFAMapSceneDesc(69, 'loc69', 'Moon Mountain Pass Link'),
    new SFAMapSceneDesc(70, 'loc70', 'Volcano Force Point Link'),
    new SFAMapSceneDesc(71, 'loc71', 'LightFoot Village Link'),
    new SFAMapSceneDesc(72, 'loc72', 'Cape Claw Link'),
    new SFAMapSceneDesc(73, 'loc73', 'Ocean Force Point Link'),
    new SFAMapSceneDesc(74, 'loc74', 'CloudRunner Fortress 2?'),
    // new SFAMapDesc(75, 'loc75', 'Location'),
    // new SFAMapDesc(76, 'loc76', 'Location'),
    // new SFAMapDesc(77, 'loc77', 'Location'),
    // new SFAMapDesc(78, 'loc78', 'Location'),
    // new SFAMapDesc(79, 'loc79', 'Location'),
    // new SFAMapDesc(80, 'loc80', 'Location 80'),
    // new SFAMapDesc(81, 'loc81', 'Location'),
    // new SFAMapDesc(82, 'loc82', 'Location'),
    // new SFAMapDesc(83, 'loc83', 'Location'),
    // new SFAMapDesc(84, 'loc84', 'Location'),
    // new SFAMapDesc(85, 'loc85', 'Location'),
    // new SFAMapDesc(86, 'loc86', 'Location'),
    // new SFAMapDesc(87, 'loc87', 'Location'),
    // new SFAMapDesc(88, 'loc88', 'Location'),
    // new SFAMapDesc(89, 'loc89', 'Location'),
    // new SFAMapDesc(90, 'loc90', 'Location 90'),
    // new SFAMapDesc(91, 'loc91', 'Location'),
    // new SFAMapDesc(92, 'loc92', 'Location'),
    // new SFAMapDesc(93, 'loc93', 'Location'),
    // new SFAMapDesc(94, 'loc94', 'Location'),
    // new SFAMapDesc(95, 'loc95', 'Location'),
    // new SFAMapDesc(96, 'loc96', 'Location'),
    // new SFAMapDesc(97, 'loc97', 'Location'),
    // new SFAMapDesc(98, 'loc98', 'Location'),
    // new SFAMapDesc(99, 'loc99', 'Location'),
    // new SFAMapDesc(100, 'loc100', 'Location 100'),
    // new SFAMapDesc(101, 'loc101', 'Location'),
    // new SFAMapDesc(102, 'loc102', 'Location'),
    // new SFAMapDesc(103, 'loc103', 'Location'),
    // new SFAMapDesc(104, 'loc104', 'Location'),
    // new SFAMapDesc(105, 'loc105', 'Location'),
    // new SFAMapDesc(106, 'loc106', 'Location'),
    // new SFAMapDesc(107, 'loc107', 'Location'),
    // new SFAMapDesc(108, 'loc108', 'Location'),
    // new SFAMapDesc(109, 'loc109', 'Location'),
    // new SFAMapDesc(110, 'loc110', 'Location 110'),
    // new SFAMapDesc(111, 'loc111', 'Location'),
    // new SFAMapDesc(112, 'loc112', 'Location'),
    // new SFAMapDesc(113, 'loc113', 'Location'),
    // new SFAMapDesc(114, 'loc114', 'Location'),
    // new SFAMapDesc(115, 'loc115', 'Location'),
    // new SFAMapDesc(115, 'loc115', 'Location'),
    // new SFAMapDesc(116, 'loc116', 'Location'), 
    // (end)

    'Full Scenes (HIGHLY EXPERIMENTAL)',
    // new SFAWorldSceneDesc('arwing', 'arwing', 58, 'Arwing'),
    // new SFAWorldSceneDesc('arwingtoplanet', 'arwingtoplanet', 58, 'Arwing Flight (Main Planet)'),
    // new SFAWorldSceneDesc('galleonship', 'shipbattle', null, "General Scales' Galleon"),
    // new SFAWorldSceneDesc('dragrock', 'dragrock', 2, 'Dragon Rock'),
    // new SFAWorldSceneDesc('swapstore', 'shop', 51, 'ThornTail Shop'),
    // new SFAWorldSceneDesc('gamefront', 'gamefront', 63, 'Great Fox'),
    new SFAWorldSceneDesc('warlock', 'warlock', 11, 'Krazoa Palace'),
    new SFAWorldSceneDesc('hollow', 'swaphol', 7, 'ThornTail Hollow'),
    // new SFAWorldSceneDesc('hollow2', 'swapholbot', 8, 'ThornTail Hollow Well'),
    // new SFAWorldSceneDesc('wastes', 'nwastes', 10, 'SnowHorn Wastes'),
    new SFAWorldSceneDesc('moonpass', 'mmpass', 18, 'Moon Mountain Pass'),
    // new SFAWorldSceneDesc('newicemount', 'icemountain', 23, 'Ice Mountain'),
    new SFAWorldSceneDesc('capeclaw', 'capeclaw', 29, 'Cape Claw'),
    new SFAWorldSceneDesc('swapcircle', 'lightfoot', 14, 'LightFoot Village'),
    new SFAWorldSceneDesc('fortress', 'crfort', 12, 'CloudRunner Fortress'),
    // new SFAWorldSceneDesc('clouddungeon', 'clouddungeon', 16, 'CloudRunner Fortress Dungeon'),
    // new SFAWorldSceneDesc('linki', 'linki', 74, 'CloudRunner Fortress 2?'),
    // new SFAWorldSceneDesc('animtest', 'animtest', 26, 'Test Map (animtest)'),
    new SFAWorldSceneDesc('snowmines', 'darkicemines', 19, 'DarkIce Mines Exterior'),
    // new SFAWorldSceneDesc('snowmines2', 'darkicemines2', 27, 'DarkIce Mines Interior'),
    // new SFAWorldSceneDesc('bossdrakorflatr', 'bossdrakor', 44, 'Boss Drakor'),
    new SFAWorldSceneDesc('wallcity', 'wallcity', 13, 'Walled City'),

    'Miscellaneous',
    new SFAModelExhibitSceneDesc('modelexhibit', 'Model Exhibit', 'swaphol', ModelVersion.Final),
    new SFAModelExhibitSceneDesc('betamodelexhibit', 'Beta Model Exhibit', 'swapcircle', ModelVersion.Beta, SFADEMO_GAME_INFO),

    // 'Demo Maps',
    // new SFAMapDesc(1, 'demo1', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(2, 'demo2', 'Early Dragon Rock', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(3, 'demo3', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(4, 'demo4', 'Early Volcano Force Point Temple', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(5, 'demo5', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(6, 'demo6', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(7, 'demo7', 'Early ThornTail Hollow', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(8, 'demo8', 'Early ThornTail Hollow Cave', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(9, 'demo9', 'Early Maze Cave', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(10, 'demo10', 'Early Ice Mountain', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(11, 'demo11', 'Early Krazoa Palace', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(12, 'demo12', 'Early CloudRunner Fortress', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(13, 'demo13', 'Early Walled City', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(14, 'demo14', 'Early LightFoot Village', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(15, 'demo15', 'Early CloudRunner Treasure Vault', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(16, 'demo16', 'Early CloudRunner Dungeon', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(17, 'demo17', 'Location 17', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(18, 'demo18', 'Early Moon Mountain Pass', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(19, 'demo19', 'Early Ice Mountain', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(20, 'demo20', 'Location 20', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(21, 'demo21', 'Early Volcano Force Point Temple 2?', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(22, 'demo22', 'Location', SFADEMO_GAME_INFO, false), // frontend
    // new SFAMapDesc(23, 'demo23', 'Early Ice Mountain Race', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(24, 'demo24', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(25, 'demo25', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(26, 'demo26', 'Early Test Map', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(27, 'demo27', 'Early DarkIce Mines', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(28, 'demo28', 'Early Volcano Boss', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(29, 'demo29', 'Early Cape Claw', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(30, 'demo30', 'Unused Galleon Interior?', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(31, 'demo31', 'Early Blue Shrine Trial', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(32, 'demo32', 'Early Green Shrine Trial', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(33, 'demo33', 'Early Yellow Shrine Trial', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(34, 'demo34', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(35, 'demo35', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(36, 'demo36', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(37, 'demo37', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(38, 'demo38', 'Early Arwing Arena', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(39, 'demo39', 'Early Purple Shrine Trial', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(40, 'demo40', 'Early Purple Shrine Arena', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(41, 'demo41', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(42, 'demo42', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(43, 'demo43', 'Early CloudRunner Race', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(44, 'demo44', 'Early Volcano Boss', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(45, 'demo45', 'Early Ice Mountain Arena', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(46, 'demo46', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(47, 'demo47', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(48, 'demo48', 'Early Boss T-rex', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(49, 'demo49', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(50, 'demo50', 'Early Ocean Force Temple', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(51, 'demo51', 'Early Shop', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(52, 'demo52', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(53, 'demo53', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(54, 'demo54', 'Early Magic Cave', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(55, 'demo55', 'Early Ice Mountain Link', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(56, 'demo56', 'Early Ice Volcano Link', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(57, 'demo57', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(58, 'demo58', 'Early Arwing 1', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(59, 'demo59', 'Early Arwing 2', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(60, 'demo60', 'Early Arwing 3', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(61, 'demo61', 'Early Arwing 4', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(62, 'demo62', 'Early Arwing 5', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(63, 'demo63', 'Early Great Fox', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(64, 'demo64', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(65, 'demo65', 'Early Great Fox 2', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(66, 'demo66', 'Early Space Area', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(67, 'demo67', 'Early Grates Link', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(68, 'demo68', 'Early Race Link', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(69, 'demo69', 'Early Dragon Link', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(70, 'demo70', 'Early Volcano Plant 2', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(71, 'demo71', 'Early Grassy Link', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(72, 'demo72', 'Early Pit Link', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(73, 'demo73', 'Early Temple Link', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(74, 'demo74', 'Early Box Cage', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(75, 'demo75', 'Early Map', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(76, 'demo76', 'Early Map', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(77, 'demo77', 'Early Map', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(78, 'demo78', 'Early Map', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(79, 'demo79', 'Early Map', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(80, 'demo80', 'Early Map', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(81, 'demo81', 'Early Map', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(82, 'demo82', 'Early Map', SFADEMO_GAME_INFO, false),
    // ...
    // new SFAMapDesc(100, 'demo100', 'Early Map', SFADEMO_GAME_INFO, false),
    // ...
    // new SFAMapDesc(105, 'demo105', 'Early Map', SFADEMO_GAME_INFO, false),
    // ...
    // new SFAMapDesc(109, 'demo109', 'Early Map', SFADEMO_GAME_INFO, false),
    // (end)

    // 'Ancient Block Exhibits',
    // new SFABlockExhibitDesc('', 'BLOCKS', 'Ancient Blocks', SFADEMO_GAME_INFO, false, true, true),

    'Ancient Maps',
    new AncientMapSceneDesc('ancient0', "Ancient Unknown Pit Room", ANCIENT_DP_GAME_INFO, 0),
    new AncientMapSceneDesc('ancient1', "Ancient Dragon Rock", ANCIENT_DP_GAME_INFO, 1),
    new AncientMapSceneDesc('ancient2', "Ancient Unknown Mine Room", ANCIENT_DP_GAME_INFO, 2),
    new AncientMapSceneDesc('ancient3', "Ancient ThornTail Hollow", ANCIENT_DP_GAME_INFO, 3),
    new AncientMapSceneDesc('ancient4', "Ancient Northern Wastes", ANCIENT_DP_GAME_INFO, 4),
    new AncientMapSceneDesc('ancient5', "Ancient Warlock Mountain", ANCIENT_DP_GAME_INFO, 5),
    new AncientMapSceneDesc('ancient6', "Ancient Shop", ANCIENT_DP_GAME_INFO, 6),
    new AncientMapSceneDesc('ancient7', "Ancient CloudRunner Fortress", ANCIENT_DP_GAME_INFO, 7),
    new AncientMapSceneDesc('ancient8', "Ancient DarkIce Mines Exterior", ANCIENT_DP_GAME_INFO, 8),
    new AncientMapSceneDesc('ancient9', "Ancient Ice Mountain Track 1", ANCIENT_DP_GAME_INFO, 9),
    new AncientMapSceneDesc('ancient10', "Ancient Ice Mountain Track 2", ANCIENT_DP_GAME_INFO, 10),
    new AncientMapSceneDesc('ancient11', "Ancient Ice Mountain Track 3", ANCIENT_DP_GAME_INFO, 11),
    new AncientMapSceneDesc('ancient12', "Ancient DarkIce Mines Interior", ANCIENT_DP_GAME_INFO, 12),
    new AncientMapSceneDesc('ancient13', "Ancient DarkIce Mines Boss Room", ANCIENT_DP_GAME_INFO, 13),
    new AncientMapSceneDesc('ancient14', "Ancient CloudRunner Fortress Race", ANCIENT_DP_GAME_INFO, 14),
    new AncientMapSceneDesc('ancient15', "Ancient Boss T-rex", ANCIENT_DP_GAME_INFO, 15),
    // new SFASandboxDesc('ancientdp', 'Ancient Map Sandbox', ANCIENT_DP_GAME_INFO, true),
];

const id = 'sfa';
const name = 'Star Fox Adventures';
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
