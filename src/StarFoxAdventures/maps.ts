
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { mat4 } from 'gl-matrix';
import { hexzero, nArray } from '../util';

import { SFARenderer } from './render';
import { getBlockInfo, BlockCollection } from './blocks';
import { SFA_GAME_INFO, GameInfo } from './scenes';

export interface MapInfo {
    infoOffset: number;
    blockTableOffset: number;
    blockCols: number;
    blockRows: number;
}

function getMapInfo(mapsTab: DataView, mapsBin: DataView, locationNum: number): MapInfo {
    const offs = locationNum * 0x1c;
    const infoOffset = mapsTab.getUint32(offs + 0x0);
    const blockTableOffset = mapsTab.getUint32(offs + 0x4);
    const blockCols = mapsBin.getUint16(infoOffset + 0x0);
    const blockRows = mapsBin.getUint16(infoOffset + 0x2);
    console.log(`block table offset: 0x${hexzero(blockTableOffset, 8)}`);
    return { infoOffset, blockTableOffset, blockCols, blockRows };
}

export class SFAMapDesc implements Viewer.SceneDesc {
    constructor(public locationNum: number, public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const mapsTab = (await dataFetcher.fetchData(`${pathBase}/MAPS.tab`)).createDataView();
        const mapsBin = (await dataFetcher.fetchData(`${pathBase}/MAPS.bin`)).createDataView();
        const trkblkTab = (await dataFetcher.fetchData(`${pathBase}/TRKBLK.tab`)).createDataView();

        console.log(`Creating scene for ${this.name} (location ${this.locationNum}) ...`);

        const mapInfo = getMapInfo(mapsTab, mapsBin, this.locationNum);
        for (let y = 0; y < mapInfo.blockRows; y++) {
            let line = '';
            for (let x = 0; x < mapInfo.blockCols; x++) {
                const blockInfo = getBlockInfo(mapsBin, mapInfo, x, y, trkblkTab, this.locationNum);
                line += ` ${JSON.stringify(blockInfo)}`;
            }
            console.log(`${line}`);
        }

        const sfaRenderer = new SFARenderer(device);
        const blockCollections: BlockCollection[] = [];
        for (let y = 0; y < mapInfo.blockRows; y++) {
            for (let x = 0; x < mapInfo.blockCols; x++) {
                const blockInfo = getBlockInfo(mapsBin, mapInfo, x, y, trkblkTab, this.locationNum);
                if (blockInfo.block == -1)
                    continue;

                if (blockCollections[blockInfo.trkblk] === undefined) {
                    const blockColl = new BlockCollection();
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
                    const blockRenderer = blockColl.getBlockRenderer(device, blockInfo.block, blockInfo.trkblk, blockInfo.base);
                    if (!blockRenderer) {
                        console.warn(`Block ${blockInfo.block} (trkblk ${blockInfo.trkblk} base ${blockInfo.base}) not found`);
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