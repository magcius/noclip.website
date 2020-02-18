import * as pako from 'pako';
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import * as GX_Material from '../gx/gx_material';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX_Texture from '../gx/gx_texture';

import { DataFetcher } from '../DataFetcher';
import { hexzero, nArray } from '../util';
import * as GX from '../gx/gx_enum';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, loadTextureFromMipChain, translateWrapModeGfx, translateTexFilterGfx } from '../gx/gx_render';
import { GX_VtxDesc, GX_VtxAttrFmt, compileLoadedVertexLayout, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array, getAttributeByteSize } from '../gx/gx_displaylist';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Camera, computeViewMatrix } from '../Camera';
import { mat4 } from 'gl-matrix';

import { SFAMapDesc, SFASandboxDesc } from './maps';
import { BlockRenderer, AncientBlockRenderer, BlockFetcher } from './blocks';
import { loadRes, getSubdir } from './resource';
import { SFARenderer } from './render';
import { TextureCollection, SFATextureCollection, FalseTextureCollection } from './textures';

export interface GameInfo {
    pathBase: string;
    subdirs: {[key: number]: string};
    makeBlockFetcher: (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => Promise<BlockFetcher>;
}

class SFABlockFetcher implements BlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;
    trkblkTab: DataView;
    locationNum: number;

    constructor(private isDeletedMap: boolean) {
    }

    public async create(locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) {
        this.locationNum = locationNum;
        const pathBase = gameInfo.pathBase;
        this.trkblkTab = (await dataFetcher.fetchData(`${pathBase}/TRKBLK.tab`)).createDataView();
        const subdir = getSubdir(locationNum, gameInfo);
        if (this.isDeletedMap) {
            console.log(`isDeletedMap; subdir ${subdir}`);
            this.blocksTab = (await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.tab`)).createDataView();
            this.blocksBin = await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.bin`);
        } else {
            this.blocksTab = (await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.tab`)).createDataView();
            this.blocksBin = await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.zlb.bin`);
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

const SFADEMO_GAME_INFO: GameInfo = {
    pathBase: 'StarFoxAdventuresDemo',
    makeBlockFetcher: async (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => {
        const result = new SFABlockFetcher(false); // Change to true if you want to see earlier prototype blocks!
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
        9: 'animtest',
        10: 'dragrockbot',
        11: 'dfalls',
        12: 'swaphol',
        13: 'animtest',
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
        54: 'animtest',
        // The following entries are erased from the executable...
        63: 'greatfox',
    }
}

const ANCIENT_DP_GAME_INFO: GameInfo = {
    pathBase: 'sfademo',
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

class SFABlockExhibitDesc implements Viewer.SceneDesc {
    public id: string;
    texColl: TextureCollection;

    constructor(public subdir: string, public fileName: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO, private useCompression: boolean = true, private useAncientBlocks = false, private useAncientTextures = false) {
        this.id = `${subdir}blocks`;
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = this.gameInfo.pathBase;
        const directory = `${pathBase}${this.subdir != '' ? '/' : ''}${this.subdir}`;
        const dataFetcher = context.dataFetcher;
        console.log(`Creating block exhibit for ${directory}/${this.fileName} ...`);

        if (this.useAncientTextures) {
            // TODO: get rid of this
            // const texTab = await dataFetcher.fetchData(`${directory}/TEX.tab`);
            // const texBin = await dataFetcher.fetchData(`${directory}/TEX.bin`);
            // this.texColl = new SFATextureCollection(texTab, texBin, true);
            this.texColl = new FalseTextureCollection(device);
        } else {
            const tex1Tab = await dataFetcher.fetchData(`${directory}/TEX1.tab`);
            const tex1Bin = await dataFetcher.fetchData(`${directory}/TEX1.bin`);
            this.texColl = new SFATextureCollection(tex1Tab, tex1Bin, false);
        }
        const blockFetcher = new BlockExhibitFetcher(this.useCompression);
        await blockFetcher.create(dataFetcher, directory, `${this.fileName}.tab`, `${this.fileName}${this.useCompression ? '.zlb' : ''}.bin`);

        const sfaRenderer = new SFARenderer(device);
        const X_BLOCKS = 10;
        const Y_BLOCKS = 10;
        const FIRST_BLOCK = 0;
        let done = false;
        for (let y = 0; y < Y_BLOCKS && !done; y++) {
            for (let x = 0; x < X_BLOCKS && !done; x++) {
                const blockNum = FIRST_BLOCK + y * X_BLOCKS + x;
                if (blockNum >= blockFetcher.blockOffsets.length) {
                    done = true;
                    continue;
                }
                try {
                    const blockData = blockFetcher.getBlock(blockNum);
                    if (!blockData) {
                        console.warn(`Failed to load data for block ${blockNum}`);
                        continue;
                    }
                    let blockRenderer;
                    if (this.useAncientBlocks) {
                        blockRenderer = new AncientBlockRenderer(device, blockData, this.texColl);
                    } else {
                        blockRenderer = new BlockRenderer(device, blockData, this.texColl);
                    }
                    if (!blockRenderer) {
                        console.warn(`Block ${blockNum} not found`);
                        continue;
                    }

                    const modelMatrix: mat4 = mat4.create();
                    mat4.fromTranslation(modelMatrix, [960 * x, 0, 960 * y]);
                    blockRenderer.addToRenderer(sfaRenderer, modelMatrix);
                } catch (e) {
                    console.warn(`Skipped block at ${x},${y} due to exception:`);
                    console.error(e);
                }
            }
        }

        return sfaRenderer;
    }
}

const sceneDescs = [
    'Maps',
    // Dinosaur Planet contains many maps. During the transition to the GameCube
    // when the game became Star Fox Adventures, many of these locations were
    // dropped. Their data remains, but it references missing and/or broken data
    // and thus cannot be loaded.
    // new SFAMapDesc(1, 'loc1', 'Location 1'),
    new SFAMapDesc(2, 'loc2', 'Dragon Rock'),
    // new SFAMapDesc(3, 'loc3', 'Location'),
    new SFAMapDesc(4, 'loc4', 'Volcano Force Point Temple'),
    // new SFAMapDesc(5, 'loc5', 'Location'),
    // new SFAMapDesc(6, 'loc6', 'Location'), // dfalls
    new SFAMapDesc(7, 'loc7', 'ThornTail Hollow'),
    new SFAMapDesc(8, 'loc8', 'ThornTail Hollow Well'),
    new SFAMapDesc(9, 'loc9', 'Cheat Token Maze'),
    new SFAMapDesc(10, 'loc10', 'SnowHorn Wastes'),
    new SFAMapDesc(11, 'loc11', 'Krazoa Palace'),
    new SFAMapDesc(12, 'loc12', 'CloudRunner Fortress'),
    new SFAMapDesc(13, 'loc13', 'Walled City'),
    new SFAMapDesc(14, 'loc14', 'LightFoot Village'),
    // new SFAMapDesc(15, 'loc15', 'Location'),
    new SFAMapDesc(16, 'loc16', 'CloudRunner Fortress Dungeon'),
    // new SFAMapDesc(17, 'loc17', 'Location'),
    new SFAMapDesc(18, 'loc18', 'Moon Mountain Pass'),
    new SFAMapDesc(19, 'loc19', 'DarkIce Mines Exterior'),
    // new SFAMapDesc(20, 'loc20', 'Location 20'),
    new SFAMapDesc(21, 'loc21', 'Ocean Force Point Temple Interior'),
    // new SFAMapDesc(22, 'loc22', 'Location'),
    new SFAMapDesc(23, 'loc23', 'Ice Mountain'),
    // new SFAMapDesc(24, 'loc24', 'Location'),
    // new SFAMapDesc(25, 'loc25', 'Location'),
    new SFAMapDesc(26, 'loc26', 'Test Map (animtest)'),
    new SFAMapDesc(27, 'loc27', 'DarkIce Mines Interior'),
    new SFAMapDesc(28, 'loc28', 'DarkIce Mines Boss (Galdon)'),
    new SFAMapDesc(29, 'loc29', 'Cape Claw'),
    // new SFAMapDesc(30, 'loc30', 'Location 30'),
    new SFAMapDesc(31, 'loc31', 'Krazoa Shrine (Test of Combat)'),
    new SFAMapDesc(32, 'loc32', 'Krazoa Shrine (Test of Fear)'),
    new SFAMapDesc(33, 'loc33', 'Krazoa Shrine (Test of Observation)'),
    new SFAMapDesc(34, 'loc34', 'Krazoa Shrine (Test of Knowledge)'),
    // new SFAMapDesc(35, 'loc35', 'Location'),
    // new SFAMapDesc(36, 'loc36', 'Location'),
    // new SFAMapDesc(37, 'loc37', 'Location'),
    // new SFAMapDesc(38, 'loc38', 'Location'),
    new SFAMapDesc(39, 'loc39', 'Krazoa Shrine (Test of Strength)'),
    new SFAMapDesc(40, 'loc40', 'Krazoa Shrine (Scales Encounter)'),
    // new SFAMapDesc(41, 'loc41', 'Location'),
    // new SFAMapDesc(42, 'loc42', 'Location'),
    new SFAMapDesc(43, 'loc43', 'CloudRunner Fortress Race'),
    new SFAMapDesc(44, 'loc44', 'Dragon Rock Boss (Drakor)'),
    new SFAMapDesc(45, 'loc45', 'SnowHorn Wastes Area'),
    // new SFAMapDesc(46, 'loc46', 'Location'),
    // new SFAMapDesc(47, 'loc47', 'Location'),
    new SFAMapDesc(48, 'loc48', 'Walled City Boss (RedEye King)'),
    // new SFAMapDesc(49, 'loc49', 'Location'),
    new SFAMapDesc(50, 'loc50', 'Ocean Force Point Temple Exterior'),
    new SFAMapDesc(51, 'loc51', 'Thorntail Shop'),
    // new SFAMapDesc(52, 'loc52', 'Location'),
    // new SFAMapDesc(53, 'loc53', 'Location'),
    new SFAMapDesc(54, 'loc54', 'Magic Cave'),
    new SFAMapDesc(55, 'loc55', 'Ice Mountain Link'),
    new SFAMapDesc(56, 'loc56', 'Ice Mountain Link 2'),
    // new SFAMapDesc(57, 'loc57', 'Location'),
    new SFAMapDesc(58, 'loc58', 'Arwing Flight (Main Planet)'),
    new SFAMapDesc(59, 'loc59', 'Arwing Flight (DarkIce Mines)'),
    new SFAMapDesc(60, 'loc60', 'Arwing Flight (CloudRunner Fortress)'),
    new SFAMapDesc(61, 'loc61', 'Arwing Flight (Walled City)'),
    new SFAMapDesc(62, 'loc62', 'Arwing Flight (Dragon Rock)'),
    new SFAMapDesc(63, 'loc63', 'Great Fox'),
    // new SFAMapDesc(64, 'loc64', 'Location'),
    new SFAMapDesc(65, 'loc65', 'Great Fox 2'),
    // new SFAMapDesc(66, 'loc66', 'Location'), // Black space
    new SFAMapDesc(67, 'loc67', 'SnowHorn Wastes Link'),
    new SFAMapDesc(68, 'loc68', 'DarkIce Mines Mineshaft'),
    new SFAMapDesc(69, 'loc69', 'Moon Mountain Pass Link'),
    new SFAMapDesc(70, 'loc70', 'Volcano Force Point Link'),
    new SFAMapDesc(71, 'loc71', 'LightFoot Village Link'),
    new SFAMapDesc(72, 'loc72', 'Cape Claw Link'),
    new SFAMapDesc(73, 'loc73', 'Ocean Force Point Link'),
    new SFAMapDesc(74, 'loc74', 'CloudRunner Fortress 2?'),
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

    // 'Block Exhibits',
    // new SFABlockExhibitDesc('animtest', 'mod6', 'Animation Test Blocks'),
    // new SFABlockExhibitDesc('arwing', 'mod3', 'Arwing Blocks'),
    // new SFABlockExhibitDesc('arwingcity', 'mod60', 'Arwing To City Blocks'),
    // new SFABlockExhibitDesc('arwingcloud', 'mod59', 'Arwing To Cloud Blocks'),
    // new SFABlockExhibitDesc('arwingdarkice', 'mod58', 'Arwing To Dark Ice Blocks'),
    // new SFABlockExhibitDesc('arwingdragon', 'mod61', 'Arwing To Dragon Blocks'),
    // new SFABlockExhibitDesc('arwingtoplanet', 'mod57', 'Arwing To Planet Blocks'),
    // new SFABlockExhibitDesc('bossdrakor', 'mod52', 'Boss Drakor Blocks'),
    // new SFABlockExhibitDesc('bossgaldon', 'mod36', 'Boss Galdon Blocks'),
    // new SFABlockExhibitDesc('bosstrex', 'mod54', 'Boss T-rex Blocks'),
    // new SFABlockExhibitDesc('capeclaw', 'mod48', 'Cape Claw Blocks'),
    // new SFABlockExhibitDesc('cloudrace', 'mod51', 'Cloud Race Blocks'),
    // new SFABlockExhibitDesc('clouddungeon', 'mod25', 'Cloud Dungeon Blocks'),
    // new SFABlockExhibitDesc('crfort', 'mod19', 'Cloudrunner Fort Blocks'),
    // new SFABlockExhibitDesc('darkicemines', 'mod27', 'Dark Ice Mines Blocks'),
    // new SFABlockExhibitDesc('darkicemines2', 'mod35', 'Dark Ice Mines 2 Blocks'),
    // new SFABlockExhibitDesc('dbshrine', 'mod44', 'DB Shrine Blocks'),
    // new SFABlockExhibitDesc('desert', 'mod29', 'Desert Blocks'),
    // new SFABlockExhibitDesc('dfptop', 'mod7', 'DFP Top Blocks'),
    // new SFABlockExhibitDesc('dfshrine', 'mod40', 'DF Shrine Blocks'),
    // new SFABlockExhibitDesc('dragrock', 'mod4', 'Drag Rock Blocks'),
    // new SFABlockExhibitDesc('dragrockbot', 'mod11', 'Drag Rock Bottom Blocks'),
    // new SFABlockExhibitDesc('greatfox', 'mod64', 'Great Fox Blocks'),
    // new SFABlockExhibitDesc('icemountain', 'mod31', 'Ice Mountain Blocks'),
    // new SFABlockExhibitDesc('lightfoot', 'mod22', 'Lightfoot Blocks'),
    // new SFABlockExhibitDesc('linka', 'mod65', 'Link A Blocks'),
    // new SFABlockExhibitDesc('linkb', 'mod55', 'Link B Blocks'),
    // new SFABlockExhibitDesc('linkc', 'mod66', 'Link C Blocks'),
    // new SFABlockExhibitDesc('linkd', 'mod67', 'Link D Blocks'),
    // new SFABlockExhibitDesc('linke', 'mod68', 'Link E Blocks'),
    // new SFABlockExhibitDesc('linkf', 'mod69', 'Link F Blocks'),
    // new SFABlockExhibitDesc('linkg', 'mod70', 'Link G Blocks'),
    // new SFABlockExhibitDesc('linkh', 'mod71', 'Link H Blocks'),
    // new SFABlockExhibitDesc('linki', 'mod73', 'Link I Blocks'),
    // new SFABlockExhibitDesc('linkj', 'mod72', 'Link J Blocks'),
    // new SFABlockExhibitDesc('worldmap', 'mod46', 'World Map Blocks'),
    // new SFABlockExhibitDesc('nwshrine', 'mod45', 'NW Shrine Blocks'),
    // new SFABlockExhibitDesc('magiccave', 'mod39', 'Magic Cave Blocks'),
    // new SFABlockExhibitDesc('mazecave', 'mod10', 'Maze Cave Blocks'),
    // new SFABlockExhibitDesc('mmpass', 'mod26', 'MM Pass Blocks'),
    // new SFABlockExhibitDesc('nwastes', 'mod15', 'N Wastes Blocks'),
    // new SFABlockExhibitDesc('shipbattle', 'mod14', 'Ship Battle Blocks'),
    // new SFABlockExhibitDesc('shop', 'mod17', 'Shop Blocks'),
    // new SFABlockExhibitDesc('swaphol', 'mod13', 'Swaphol Blocks'),
    // new SFABlockExhibitDesc('swapholbot', 'mod20', 'Swaphol Bottom Blocks'),
    // new SFABlockExhibitDesc('volcano', 'mod8', 'Volcano Blocks'),
    // new SFABlockExhibitDesc('wallcity', 'mod21', 'Wall City Blocks'),
    // new SFABlockExhibitDesc('warlock', 'mod16', 'Warlock Blocks'),

    // 'Demo',
    // new SFAMapDesc(5, 'demo5', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(6, 'demo6', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(7, 'demo7', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(8, 'demo8', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(9, 'demo9', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(10, 'demo10', 'Location 10', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(11, 'demo11', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(12, 'demo12', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(13, 'demo13', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(14, 'demo14', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(15, 'demo15', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(16, 'demo16', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(17, 'demo17', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(18, 'demo18', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(19, 'demo19', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(20, 'demo20', 'Location 20', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(21, 'demo21', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(22, 'demo22', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(23, 'demo23', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(24, 'demo24', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(25, 'demo25', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(26, 'demo26', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(27, 'demo27', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(28, 'demo28', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(29, 'demo29', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(30, 'demo30', 'Location 30', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(31, 'demo31', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(32, 'demo32', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(33, 'demo33', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(34, 'demo34', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(35, 'demo35', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(36, 'demo36', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(37, 'demo37', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(38, 'demo38', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(39, 'demo39', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(40, 'demo40', 'Location 40', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(41, 'demo41', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(42, 'demo42', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(43, 'demo43', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(44, 'demo44', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(45, 'demo45', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(46, 'demo46', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(47, 'demo47', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(48, 'demo48', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(49, 'demo49', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(50, 'demo50', 'Location 50', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(51, 'demo51', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(52, 'demo52', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(53, 'demo53', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(54, 'demo54', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(55, 'demo55', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(56, 'demo56', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(57, 'demo57', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(58, 'demo58', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(59, 'demo59', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(60, 'demo60', 'Location 60', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(61, 'demo61', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(62, 'demo62', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(63, 'demo63', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(64, 'demo64', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(65, 'demo65', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(66, 'demo66', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(67, 'demo67', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(68, 'demo68', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(69, 'demo69', 'Location', SFADEMO_GAME_INFO, false),
    // new SFAMapDesc(70, 'demo70', 'Location 70', SFADEMO_GAME_INFO, false),

    // 'Ancient Block Exhibits',
    // new SFABlockExhibitDesc('', 'BLOCKS', 'Ancient Blocks', SFADEMO_GAME_INFO, false, true, true),

    // 'Ancient',
    // new SFASandboxDesc('ancientdp', 'Ancient Map Sandbox', ANCIENT_DP_GAME_INFO),
];

const id = 'sfa';
const name = 'Star Fox Adventures';
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
