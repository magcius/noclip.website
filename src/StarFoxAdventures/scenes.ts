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

import { SFAMapDesc } from './maps';
import { BlockRenderer, VeryOldBlockRenderer, BlockFetcher } from './blocks';
import { loadRes, getSubdir } from './resource';
import { TextureCollection, SFARenderer } from './render';

export interface GameInfo {
    pathBase: string;
    subdirs: {[key: number]: string};
    makeBlockFetcher: (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => Promise<BlockFetcher>;
}

class SFABlockFetcher implements BlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;
    isDeletedMap: boolean;

    public async create(locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) {
        const pathBase = gameInfo.pathBase;
        const subdir = getSubdir(locationNum, gameInfo);
        if (subdir == 'linklevel' || subdir == 'insidegal' || subdir == 'cloudtreasure') {
            console.log(`Holy smokes! Loading a deleted map!`);
            this.isDeletedMap = true;
        }
        this.blocksTab = (await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.tab`)).createDataView();
        if (this.isDeletedMap) {
            this.blocksBin = await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.bin`);
        } else {
            this.blocksBin = await dataFetcher.fetchData(`${pathBase}/${subdir}/mod${getModNumber(locationNum)}.zlb.bin`);
        }
    }

    public getBlock(num: number, trkblk: number, subnum: number): ArrayBufferSlice | null {
        if (this.isDeletedMap) {
            // Different handling for blocks from the demo version's deleted maps
            // Find a workable block number...
            let firstBlockNum = 0;
            for (let i = 0; i < this.blocksTab.byteLength/4; i++) {
                if (this.blocksTab.getUint32(i * 4) == 0x10000000)
                    break;
                firstBlockNum++;
            }

            const num = firstBlockNum + subnum;
            if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
                return null;
            }
            const tabValue = this.blocksTab.getUint32(num * 4);
            if (!(tabValue & 0x10000000)) {
                return null;
            }
            const blockOffset = tabValue & 0xFFFFFF;
            console.log(`Loading deleted block from offset 0x${blockOffset.toString(16)}`);
            const blocksBinPart = this.blocksBin.slice(blockOffset);
            return blocksBinPart;
        }

        if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
            return null;
        }
        const tabValue = this.blocksTab.getUint32(num * 4);
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
    pathBase: 'sfa',
    makeBlockFetcher: async (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => {
        const result = new SFABlockFetcher();
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

class SFADemoBlockFetcher implements BlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;

    public async create(locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) {
        const pathBase = gameInfo.pathBase;
        this.blocksTab = (await dataFetcher.fetchData(`${pathBase}/BLOCKS.tab`)).createDataView();
        this.blocksBin = await dataFetcher.fetchData(`${pathBase}/BLOCKS.bin`);
    }

    public getBlock(num: number): ArrayBufferSlice | null {
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
    pathBase: 'sfademo',
    makeBlockFetcher: async (locationNum: number, dataFetcher: DataFetcher, gameInfo: GameInfo) => {
        const result = new SFADemoBlockFetcher();
        await result.create(locationNum, dataFetcher, gameInfo);
        return result;
    },
    subdirs: {
        0: 'animtest',
        1: 'dragrock',
        2: 'dragrockbot',
        3: 'swapholbot',
        4: 'wallcity',
        5: 'lightfoot',
        6: 'cloudtreasure',
        7: 'clouddungeon',
        8: 'darkicemines',
        //9: 'icemountain',
        9: 'mazecave', // ????
        10: 'darkicemines2',
        11: 'bossgaldon',
        12: 'insidegal',
        //13: 'magiccave',
        13: 'swaphol', // ???
        14: 'dfshrine',
        15: 'mmshrine',
        16: 'ecshrine',
        17: 'gpshrine',
        18: 'dbshrine',
        19: 'nwshrine',
        20: 'worldmap',
        21: 'capeclaw',
        22: 'cloudrace',
        23: 'bossdrakor',
        24: 'bosstrex',
    }
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

    constructor(public subdir: string, public fileName: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO, private useCompression: boolean = true, private useVeryOldBlocks = false, private useAncientTextures = false) {
        this.id = `${subdir}blocks`;
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = this.gameInfo.pathBase;
        const directory = `${pathBase}${this.subdir != '' ? '/' : ''}${this.subdir}`;
        const dataFetcher = context.dataFetcher;
        console.log(`Creating block exhibit for ${directory}/${this.fileName} ...`);

        if (this.useAncientTextures) {
            const texTab = await dataFetcher.fetchData(`${directory}/TEX.tab`);
            const texBin = await dataFetcher.fetchData(`${directory}/TEX.bin`);
            const textable = await dataFetcher.fetchData(`${directory}/TEXTABLE.bin`);
            this.texColl = new TextureCollection(texTab, texBin, true, textable.createDataView());
        } else {
            const tex1Tab = await dataFetcher.fetchData(`${directory}/TEX1.tab`);
            const tex1Bin = await dataFetcher.fetchData(`${directory}/TEX1.bin`);
            this.texColl = new TextureCollection(tex1Tab, tex1Bin, false);
        }
        const blockFetcher = new BlockExhibitFetcher(this.useCompression);
        await blockFetcher.create(dataFetcher, directory, `${this.fileName}.tab`, `${this.fileName}${this.useCompression ? '.zlb' : ''}.bin`);

        const sfaRenderer = new SFARenderer(device);
        const X_BLOCKS = 10;
        const Y_BLOCKS = 10;
        const FIRST_BLOCK = 300;
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
                    if (this.useVeryOldBlocks) {
                        blockRenderer = new VeryOldBlockRenderer(device, blockData, this.texColl);
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
    new SFAMapDesc(1, 'loc1', 'Location 1'),
    new SFAMapDesc(2, 'loc2', 'Location'),
    new SFAMapDesc(3, 'loc3', 'Location'),
    new SFAMapDesc(4, 'loc4', 'Location'),
    new SFAMapDesc(5, 'loc5', 'Location'),
    new SFAMapDesc(6, 'loc6', 'Location'),
    new SFAMapDesc(7, 'loc7', 'Location'),
    new SFAMapDesc(8, 'loc8', 'Location'),
    new SFAMapDesc(9, 'loc9', 'Location'),
    new SFAMapDesc(10, 'loc10', 'Location 10'),
    new SFAMapDesc(11, 'loc11', 'Location'),
    new SFAMapDesc(12, 'loc12', 'Location'),
    new SFAMapDesc(13, 'loc13', 'Location'),
    new SFAMapDesc(14, 'loc14', 'Location'),
    new SFAMapDesc(15, 'loc15', 'Location'),
    new SFAMapDesc(16, 'loc16', 'Location'),
    new SFAMapDesc(17, 'loc17', 'Location'),
    new SFAMapDesc(18, 'loc18', 'Location'),
    new SFAMapDesc(19, 'loc19', 'Location'),
    new SFAMapDesc(20, 'loc20', 'Location 20'),
    new SFAMapDesc(21, 'loc21', 'Location'),
    new SFAMapDesc(22, 'loc22', 'Location'),
    new SFAMapDesc(23, 'loc23', 'Location'),
    new SFAMapDesc(24, 'loc24', 'Location'),
    new SFAMapDesc(25, 'loc25', 'Location'),
    new SFAMapDesc(26, 'loc26', 'Location'),
    new SFAMapDesc(27, 'loc27', 'Location'),
    new SFAMapDesc(28, 'loc28', 'Location'),
    new SFAMapDesc(29, 'loc29', 'Location'),
    new SFAMapDesc(30, 'loc30', 'Location 30'),
    new SFAMapDesc(31, 'loc31', 'Location'),
    new SFAMapDesc(32, 'loc32', 'Location'),
    new SFAMapDesc(33, 'loc33', 'Location'),
    new SFAMapDesc(34, 'loc34', 'Location'),
    new SFAMapDesc(35, 'loc35', 'Location'),
    new SFAMapDesc(36, 'loc36', 'Location'),
    new SFAMapDesc(37, 'loc37', 'Location'),
    new SFAMapDesc(38, 'loc38', 'Location'),
    new SFAMapDesc(39, 'loc39', 'Location'),
    new SFAMapDesc(40, 'loc40', 'Location 40'),
    new SFAMapDesc(41, 'loc41', 'Location'),
    new SFAMapDesc(42, 'loc42', 'Location'),
    new SFAMapDesc(43, 'loc43', 'Location'),
    new SFAMapDesc(44, 'loc44', 'Location'),
    new SFAMapDesc(45, 'loc45', 'Location'),
    new SFAMapDesc(46, 'loc46', 'Location'),
    new SFAMapDesc(47, 'loc47', 'Location'),
    new SFAMapDesc(48, 'loc48', 'Location'),
    new SFAMapDesc(49, 'loc49', 'Location'),
    new SFAMapDesc(50, 'loc50', 'Location 50'),
    new SFAMapDesc(51, 'loc51', 'Location'),
    new SFAMapDesc(52, 'loc52', 'Location'),
    new SFAMapDesc(53, 'loc53', 'Location'),
    new SFAMapDesc(54, 'loc54', 'Location'),
    new SFAMapDesc(55, 'loc55', 'Location'),
    new SFAMapDesc(56, 'loc56', 'Location'),
    new SFAMapDesc(57, 'loc57', 'Location'),
    new SFAMapDesc(58, 'loc58', 'Location'),
    new SFAMapDesc(59, 'loc59', 'Location'),
    // new SFAMapDesc(60, 'loc60', 'Location 60'),
    new SFAMapDesc(61, 'loc61', 'Location'),
    new SFAMapDesc(62, 'loc62', 'Location'),
    new SFAMapDesc(63, 'loc63', 'Location'),
    new SFAMapDesc(64, 'loc64', 'Location'),
    new SFAMapDesc(65, 'loc65', 'Location'),
    new SFAMapDesc(66, 'loc66', 'Location'),
    new SFAMapDesc(67, 'loc67', 'Location'),
    new SFAMapDesc(68, 'loc68', 'Location'),
    new SFAMapDesc(69, 'loc69', 'Location'),
    new SFAMapDesc(70, 'loc70', 'Location 70'),
    new SFAMapDesc(71, 'loc71', 'Location'),
    new SFAMapDesc(72, 'loc72', 'Location'),
    new SFAMapDesc(73, 'loc73', 'Location'),
    new SFAMapDesc(74, 'loc74', 'Location'),
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
    // ... (Many maps contain empty or broken data) ...
    // new SFAMapDesc(110, 'loc110', 'Location 110'),
    // ...
    // new SFAMapDesc(115, 'loc115', 'Location 115'),
    // new SFAMapDesc(116, 'loc116', 'Location 116'), 
    // (end)

    'Block Exhibits',
    new SFABlockExhibitDesc('animtest', 'mod6', 'Animation Test Blocks'),
    new SFABlockExhibitDesc('arwing', 'mod3', 'Arwing Blocks'),
    new SFABlockExhibitDesc('arwingcity', 'mod60', 'Arwing To City Blocks'),
    new SFABlockExhibitDesc('arwingcloud', 'mod59', 'Arwing To Cloud Blocks'),
    new SFABlockExhibitDesc('arwingdarkice', 'mod58', 'Arwing To Dark Ice Blocks'),
    new SFABlockExhibitDesc('arwingdragon', 'mod61', 'Arwing To Dragon Blocks'),
    new SFABlockExhibitDesc('arwingtoplanet', 'mod57', 'Arwing To Planet Blocks'),
    new SFABlockExhibitDesc('bossdrakor', 'mod52', 'Boss Drakor Blocks'),
    new SFABlockExhibitDesc('bossgaldon', 'mod36', 'Boss Galdon Blocks'),
    new SFABlockExhibitDesc('bosstrex', 'mod54', 'Boss T-rex Blocks'),
    new SFABlockExhibitDesc('capeclaw', 'mod48', 'Cape Claw Blocks'),
    new SFABlockExhibitDesc('cloudrace', 'mod51', 'Cloud Race Blocks'),
    new SFABlockExhibitDesc('clouddungeon', 'mod25', 'Cloud Dungeon Blocks'),
    new SFABlockExhibitDesc('crfort', 'mod19', 'Cloudrunner Fort Blocks'),
    new SFABlockExhibitDesc('darkicemines', 'mod27', 'Dark Ice Mines Blocks'),
    new SFABlockExhibitDesc('darkicemines2', 'mod35', 'Dark Ice Mines 2 Blocks'),
    new SFABlockExhibitDesc('dbshrine', 'mod44', 'DB Shrine Blocks'),
    new SFABlockExhibitDesc('desert', 'mod29', 'Desert Blocks'),
    new SFABlockExhibitDesc('dfptop', 'mod7', 'DFP Top Blocks'),
    new SFABlockExhibitDesc('dfshrine', 'mod40', 'DF Shrine Blocks'),
    new SFABlockExhibitDesc('dragrock', 'mod4', 'Drag Rock Blocks'),
    new SFABlockExhibitDesc('dragrockbot', 'mod11', 'Drag Rock Bottom Blocks'),
    new SFABlockExhibitDesc('greatfox', 'mod64', 'Great Fox Blocks'),
    new SFABlockExhibitDesc('icemountain', 'mod31', 'Ice Mountain Blocks'),
    new SFABlockExhibitDesc('lightfoot', 'mod22', 'Lightfoot Blocks'),
    new SFABlockExhibitDesc('linka', 'mod65', 'Link A Blocks'),
    new SFABlockExhibitDesc('linkb', 'mod55', 'Link B Blocks'),
    new SFABlockExhibitDesc('linkc', 'mod66', 'Link C Blocks'),
    new SFABlockExhibitDesc('linkd', 'mod67', 'Link D Blocks'),
    new SFABlockExhibitDesc('linke', 'mod68', 'Link E Blocks'),
    new SFABlockExhibitDesc('linkf', 'mod69', 'Link F Blocks'),
    new SFABlockExhibitDesc('linkg', 'mod70', 'Link G Blocks'),
    new SFABlockExhibitDesc('linkh', 'mod71', 'Link H Blocks'),
    new SFABlockExhibitDesc('linki', 'mod73', 'Link I Blocks'),
    new SFABlockExhibitDesc('linkj', 'mod72', 'Link J Blocks'),
    new SFABlockExhibitDesc('worldmap', 'mod46', 'World Map Blocks'),
    new SFABlockExhibitDesc('nwshrine', 'mod45', 'NW Shrine Blocks'),
    new SFABlockExhibitDesc('magiccave', 'mod39', 'Magic Cave Blocks'),
    new SFABlockExhibitDesc('mazecave', 'mod10', 'Maze Cave Blocks'),
    new SFABlockExhibitDesc('mmpass', 'mod26', 'MM Pass Blocks'),
    new SFABlockExhibitDesc('nwastes', 'mod15', 'N Wastes Blocks'),
    new SFABlockExhibitDesc('shipbattle', 'mod14', 'Ship Battle Blocks'),
    new SFABlockExhibitDesc('shop', 'mod17', 'Shop Blocks'),
    new SFABlockExhibitDesc('swaphol', 'mod13', 'Swaphol Blocks'),
    new SFABlockExhibitDesc('swapholbot', 'mod20', 'Swaphol Bottom Blocks'),
    new SFABlockExhibitDesc('volcano', 'mod8', 'Volcano Blocks'),
    new SFABlockExhibitDesc('wallcity', 'mod21', 'Wall City Blocks'),
    new SFABlockExhibitDesc('warlock', 'mod16', 'Warlock Blocks'),

    'Demo',
    new SFAMapDesc(5, 'demo5', 'Location 5', SFADEMO_GAME_INFO),

    'Demo Block Exhibits',
    new SFABlockExhibitDesc('', 'BLOCKS', 'Demo Blocks', SFADEMO_GAME_INFO, false, true, true),
];

const id = 'sfa';
const name = 'Star Fox Adventures';
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
