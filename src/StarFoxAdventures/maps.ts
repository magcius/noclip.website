
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { mat4 } from 'gl-matrix';
import { hexzero, nArray } from '../util';

import { SFARenderer } from './render';
import { BlockCollection } from './blocks';
import { SFA_GAME_INFO, GameInfo } from './scenes';

export interface BlockInfo {
    trkblk: number;
    sub: number;
    block: number;
}

export interface MapInfo {
    mapsBin: DataView;
    locationNum: number;
    infoOffset: number;
    blockTableOffset: number;
    blockCols: number;
    blockRows: number;
}

export function getBlockInfo(mapsBin: DataView, mapInfo: MapInfo, x: number, y: number, trkblkTab: DataView, locationNum: number): BlockInfo {
    const blockIndex = y * mapInfo.blockCols + x;
    const blockInfo = mapsBin.getUint32(mapInfo.blockTableOffset + 4 * blockIndex);
    const sub = (blockInfo >>> 17) & 0x3F;
    const trkblk = (blockInfo >>> 23);
    let block;
    if (trkblk == 0xff) {
        block = -1;
    } else {
        try {
            block = sub + trkblkTab.getUint16(trkblk * 2);
        } catch (e) {
            block = -1
        }
    }
    return {trkblk, sub, block};
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
function getBlockTable(mapInfo: MapInfo, trkblkTab: DataView): BlockInfo[][] {
    const blockTable: BlockInfo[][] = [];
    for (let y = 0; y < mapInfo.blockRows; y++) {
        const row: BlockInfo[] = [];
        blockTable.push(row);
        for (let x = 0; x < mapInfo.blockCols; x++) {
            const blockInfo = getBlockInfo(mapInfo.mapsBin, mapInfo, x, y, trkblkTab, mapInfo.locationNum);
            row.push(blockInfo);
        }
    }

    return blockTable;
}

export class SFAMapDesc implements Viewer.SceneDesc {
    constructor(public locationNum: number, public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO, private isAncient: boolean = false) {
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const mapsTab = (await dataFetcher.fetchData(`${pathBase}/MAPS.tab`)).createDataView();
        const mapsBin = (await dataFetcher.fetchData(`${pathBase}/MAPS.bin`)).createDataView();
        const trkblkTab = (await dataFetcher.fetchData(`${pathBase}/TRKBLK.tab`)).createDataView();

        console.log(`Creating scene for ${this.name} (location ${this.locationNum}) ...`);

        const mapInfo = getMapInfo(mapsTab, mapsBin, this.locationNum);
        const blockTable = getBlockTable(mapInfo, trkblkTab);

        ////////////////////////// create editor stuff
        const self = this;
        window.main.openEditor = function() {
            const newWin = window.open('about:blank');
            if (!newWin) {
                console.warn(`Failed to open editor. Please allow pop-up windows and try again.`);
                return;
            }
            newWin.onload = function() {
                const tableEl = newWin.document.createElement('table');
                newWin.document.body.appendChild(tableEl);
                for (let y = 0; y < mapInfo.blockRows; y++) {
                    const trEl = newWin.document.createElement('tr');
                    tableEl.appendChild(trEl);
                    for (let x = 0 ; x < mapInfo.blockCols; x++) {
                        const blockInfo = blockTable[y][x];
                        const tdEl = newWin.document.createElement('td');
                        tdEl.append(`${blockInfo.block}`);
                        trEl.appendChild(tdEl);
                    }
                }

                const submitEl = newWin.document.createElement('input');
                submitEl.setAttribute('type', 'submit');
                newWin.document.body.appendChild(submitEl);
                submitEl.onclick = function() {
                    console.warn(`Not implemented`);
                }
            }
        };
        //////////////////////////////////////////////

        const sfaRenderer = new SFARenderer(device);
        const blockCollections: BlockCollection[] = [];
        for (let y = 0; y < mapInfo.blockRows; y++) {
            for (let x = 0; x < mapInfo.blockCols; x++) {
                const blockInfo = blockTable[y][x];
                if (blockInfo.block == -1)
                    continue;

                if (blockCollections[blockInfo.trkblk] === undefined) {
                    const blockColl = new BlockCollection(this.isAncient);
                    try {
                        await blockColl.create(device, context, blockInfo.trkblk, this.gameInfo);
                    } catch (e) {
                        console.error(e);
                        console.warn(`Block collection ${blockInfo.trkblk} could not be loaded.`);
                        continue;
                    }
                    blockCollections[blockInfo.trkblk] = blockColl;
                }

                const blockColl = blockCollections[blockInfo.trkblk];
                try {
                    const blockRenderer = blockColl.getBlockRenderer(device, blockInfo.block, blockInfo.trkblk, blockInfo.sub);
                    if (!blockRenderer) {
                        console.warn(`Block ${blockInfo.block} (trkblk ${blockInfo.trkblk} sub ${blockInfo.sub}) not found`);
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

        return sfaRenderer;
    }
}