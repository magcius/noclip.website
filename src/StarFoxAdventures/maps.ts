
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { mat4 } from 'gl-matrix';
import { hexzero, nArray } from '../util';

import { SFARenderer } from './render';
import { BlockCollection } from './blocks';
import { SFA_GAME_INFO, GameInfo } from './scenes';

export interface BlockInfo {
    mod: number;
    sub: number;
}

export interface MapInfo {
    mapsBin: DataView;
    locationNum: number;
    infoOffset: number;
    blockTableOffset: number;
    blockCols: number;
    blockRows: number;
}

export function getBlockInfo(mapsBin: DataView, mapInfo: MapInfo, x: number, y: number): BlockInfo | null {
    const blockIndex = y * mapInfo.blockCols + x;
    const blockInfo = mapsBin.getUint32(mapInfo.blockTableOffset + 4 * blockIndex);
    const sub = (blockInfo >>> 17) & 0x3F;
    const mod = (blockInfo >>> 23);
    if (mod == 0xff) {
        return null;
    }
    return {mod, sub};
}

function getMapInfo(mapsTab: DataView, mapsBin: DataView, locationNum: number): MapInfo {
    const offs = locationNum * 0x1c;
    const infoOffset = mapsTab.getUint32(offs + 0x0);
    const blockTableOffset = mapsTab.getUint32(offs + 0x4);
    const blockCols = mapsBin.getUint16(infoOffset + 0x0);
    const blockRows = mapsBin.getUint16(infoOffset + 0x2);
    return { mapsBin, locationNum, infoOffset, blockTableOffset, blockCols, blockRows };
}

// Block table is addressed by blockTable[y][x].
function getBlockTable(mapInfo: MapInfo): (BlockInfo | null)[][] {
    const blockTable: (BlockInfo | null)[][] = [];
    for (let y = 0; y < mapInfo.blockRows; y++) {
        const row: (BlockInfo | null)[] = [];
        blockTable.push(row);
        for (let x = 0; x < mapInfo.blockCols; x++) {
            const blockInfo = getBlockInfo(mapInfo.mapsBin, mapInfo, x, y);
            row.push(blockInfo);
        }
    }

    return blockTable;
}

export class SFAMapDesc implements Viewer.SceneDesc {
    constructor(public locationNum: number, public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO, private isEarly: boolean = false, private isAncient: boolean = false) {
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const mapsTab = (await dataFetcher.fetchData(`${pathBase}/MAPS.tab`)).createDataView();
        const mapsBin = (await dataFetcher.fetchData(`${pathBase}/MAPS.bin`)).createDataView();
        const trkblkTab = (await dataFetcher.fetchData(`${pathBase}/TRKBLK.tab`)).createDataView();

        console.log(`Creating scene for ${this.name} (location ${this.locationNum}) ...`);

        const mapInfo = getMapInfo(mapsTab, mapsBin, this.locationNum);
        const blockTable = getBlockTable(mapInfo);

        const sfaRenderer = new SFARenderer(device);

        const self = this;
        async function reloadBlocks() {
            sfaRenderer.clearModels();
            const blockCollections: BlockCollection[] = [];
            for (let y = 0; y < mapInfo.blockRows; y++) {
                for (let x = 0; x < mapInfo.blockCols; x++) {
                    const blockInfo = blockTable[y][x];
                    if (blockInfo == null)
                        continue;
    
                    if (blockCollections[blockInfo.mod] === undefined) {
                        const blockColl = new BlockCollection(blockInfo.mod, self.isAncient);
                        try {
                            await blockColl.create(device, context, self.gameInfo);
                        } catch (e) {
                            console.error(e);
                            console.warn(`Block collection ${blockInfo.mod} could not be loaded.`);
                            continue;
                        }
                        blockCollections[blockInfo.mod] = blockColl;
                    }
    
                    const blockColl = blockCollections[blockInfo.mod];
                    try {
                        const blockRenderer = blockColl.getBlockRenderer(device, blockInfo.sub);
                        if (!blockRenderer) {
                            console.warn(`Block mod${blockInfo.mod}.${blockInfo.sub} not found`);
                            continue;
                        }
    
                        const modelMatrix: mat4 = mat4.create();
                        mat4.fromTranslation(modelMatrix, [640 * x, 0, 640 * y]);
                        blockRenderer.addToRenderer(sfaRenderer, modelMatrix);
                    } catch (e) {
                        console.warn(`Skipped block at ${x},${y} due to exception:`);
                        console.error(e);
                    }
                }
            }
            if (blockCollections.length == 0)
                console.warn(`No blocks could be rendered.`);
        }

        await reloadBlocks();

        ////////////////////////// create editor stuff
        window.main.openEditor = function() {
            const newWin = window.open('about:blank');
            if (!newWin) {
                console.warn(`Failed to open editor. Please allow pop-up windows and try again.`);
                return;
            }
            newWin.onload = function() {
                const inputs: HTMLInputElement[][] = [];
                for (let y = 0; y < mapInfo.blockRows; y++) {
                    const row: HTMLInputElement[] = [];
                    inputs.push(row);
                    for (let x = 0; x < mapInfo.blockCols; x++) {
                        const blockInfo = blockTable[y][x];
                        const inputEl = newWin.document.createElement('input');
                        inputEl.setAttribute('type', 'number');
                        inputEl.setAttribute('value', `${blockInfo != null ? blockInfo.sub : -1}`);
                        row.push(inputEl);
                    }
                }

                const tableEl = newWin.document.createElement('table');
                newWin.document.body.appendChild(tableEl);
                for (let y = 0; y < mapInfo.blockRows; y++) {
                    const trEl = newWin.document.createElement('tr');
                    tableEl.appendChild(trEl);
                    for (let x = 0 ; x < mapInfo.blockCols; x++) {
                        const tdEl = newWin.document.createElement('td');
                        trEl.appendChild(tdEl);
                        tdEl.appendChild(inputs[y][x]);
                    }
                }

                const submitEl = newWin.document.createElement('input');
                submitEl.setAttribute('type', 'submit');
                newWin.document.body.appendChild(submitEl);
                submitEl.onclick = async function() {
                    console.log(`Reloading blocks...`);
                    for (let y = 0; y < mapInfo.blockRows; y++) {
                        for (let x = 0; x < mapInfo.blockCols; x++) {
                            const newBlock = inputs[y][x].valueAsNumber;
                            blockTable[y][x] = {mod: 12345, sub: newBlock}; // TODO
                        }
                    }
                    await reloadBlocks();
                }
            }
        };
        //////////////////////////////////////////////

        return sfaRenderer;
    }
}