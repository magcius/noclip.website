import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { mat4 } from 'gl-matrix';
import { nArray } from '../util';

import { SFARenderer } from './render';
import { BlockCollection, BlockRendererBase } from './blocks';
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

export interface IBlockCollection {
    getBlock(mod: number, sub: number): BlockRendererBase | null;
}

interface MapSceneInfo {
    getNumCols(): number;
    getNumRows(): number;
    getBlockCollection(mod: number): Promise<IBlockCollection>;
    getBlockInfoAt(col: number, row: number): BlockInfo | null;
}

class MapRenderer extends SFARenderer {
    private numRows: number;
    private numCols: number;
    private blockTable: (BlockInfo | null)[][] = [];
    private blockCollections: IBlockCollection[] = [];

    constructor(device: GfxDevice, public info: MapSceneInfo) {
        super(device);

        this.numRows = info.getNumRows();
        this.numCols = info.getNumCols();

        for (let y = 0; y < this.numRows; y++) {
            const row: (BlockInfo | null)[] = [];
            this.blockTable.push(row);
            for (let x = 0; x < this.numCols; x++) {
                const blockInfo = info.getBlockInfoAt(x, y);
                row.push(blockInfo);
            }
        }
    }

    public async reloadBlocks() {
        this.clearModels();
        for (let y = 0; y < this.numRows; y++) {
            for (let x = 0; x < this.numCols; x++) {
                const blockInfo = this.blockTable[y][x];
                if (blockInfo == null)
                    continue;

                try {
                    if (this.blockCollections[blockInfo.mod] == undefined) {
                        this.blockCollections[blockInfo.mod] = await this.info.getBlockCollection(blockInfo.mod);
                    }
                    const blockColl = this.blockCollections[blockInfo.mod];

                    const blockRenderer = blockColl.getBlock(blockInfo.mod, blockInfo.sub);
                    if (blockRenderer) {
                        const modelMatrix: mat4 = mat4.create();
                        mat4.fromTranslation(modelMatrix, [640 * x, 0, 640 * y]);
                        blockRenderer.addToRenderer(this, modelMatrix);
                    }
                } catch (e) {
                    console.warn(`Skipping block at ${x},${y} due to exception:`);
                    console.error(e);
                }
            }
        }
    }

    public openEditor(): void {
        const newWin = window.open('about:blank');
        if (!newWin) {
            console.warn(`Failed to open editor. Please allow pop-up windows and try again.`);
            return;
        }
        newWin.onload = () => {
            const inputs: HTMLInputElement[][] = [];
            for (let y = 0; y < this.numRows; y++) {
                const row: HTMLInputElement[] = [];
                inputs.push(row);
                for (let x = 0; x < this.numCols; x++) {
                    const blockInfo = this.blockTable[y][x];
                    const inputEl = newWin.document.createElement('input');
                    inputEl.setAttribute('type', 'text');
                    inputEl.setAttribute('value', `${blockInfo != null ? `${blockInfo.mod}.${blockInfo.sub}` : -1}`);
                    row.push(inputEl);
                }
            }

            const tableEl = newWin.document.createElement('table');
            newWin.document.body.appendChild(tableEl);
            for (let y = 0; y < this.numRows; y++) {
                const trEl = newWin.document.createElement('tr');
                tableEl.appendChild(trEl);
                for (let x = 0 ; x < this.numCols; x++) {
                    const tdEl = newWin.document.createElement('td');
                    trEl.appendChild(tdEl);
                    tdEl.appendChild(inputs[y][x]);
                }
            }

            const jsonEl = newWin.document.createElement('textarea');
            jsonEl.setAttribute('rows', '60');
            jsonEl.setAttribute('cols', '100');
            const updateJson = () => {
                let topRow = -1
                let leftCol = -1
                let rightCol = -1
                let bottomRow = -1
                for (let row = 0; row < this.numRows; row++) {
                    for (let col = 0; col < this.numCols; col++) {
                        const info = this.blockTable[row][col];
                        if (info != null) {
                            if (topRow == -1) {
                                topRow = row;
                            }
                            bottomRow = row;
                            if (leftCol == -1) {
                                leftCol = col;
                            } else if (col < leftCol) {
                                leftCol = col;
                            }
                            if (rightCol == -1) {
                                rightCol = col;
                            } else if (col > rightCol) {
                                rightCol = col;
                            }
                        }
                    }
                }

                if (topRow == -1) {
                    // No blocks found
                    jsonEl.textContent = '[]';
                    return;
                }

                let json = '[';
                for (let row = topRow; row <= bottomRow; row++) {
                    json += row != topRow ? ',\n' : '\n';
                    json += JSON.stringify(this.blockTable[row].slice(leftCol, rightCol + 1),
                        (key, value) => {
                            if (Array.isArray(value)) {
                                return value;
                            } else if (value === null) {
                                return null;
                            } else if (typeof value != 'object') {
                                return null;
                            } else {
                                return `${value.mod}.${value.sub}`;
                            }                
                        });
                }
                json += '\n]';
                jsonEl.textContent = json;
            };

            const submitEl = newWin.document.createElement('input');
            submitEl.setAttribute('type', 'submit');
            newWin.document.body.appendChild(submitEl);
            submitEl.onclick = async() => {
                console.log(`Reloading blocks...`);
                for (let y = 0; y < this.numRows; y++) {
                    for (let x = 0; x < this.numCols; x++) {
                        const newValue = inputs[y][x].value.split('.', 2);
                        if (newValue.length == 2) {
                            const newMod = Number.parseInt(newValue[0]);
                            const newSub = Number.parseInt(newValue[1]);
                            this.blockTable[y][x] = {mod: newMod, sub: newSub}; // TODO: handle failures
                        } else {
                            this.blockTable[y][x] = null;
                        }
                    }
                }
                updateJson();
                await this.reloadBlocks();
            };

            const divEl = newWin.document.createElement('div');
            newWin.document.body.appendChild(divEl);
            divEl.appendChild(jsonEl);
        };
    }
}

class MapScene {
    public async create(device: GfxDevice, info: MapSceneInfo): Promise<Viewer.SceneGfx> {
        const sfaRenderer = new MapRenderer(device, info);
        await sfaRenderer.reloadBlocks();
        return sfaRenderer;
    }
}

export class SFAMapDesc implements Viewer.SceneDesc {
    constructor(public locationNum: number, public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO, private isEarly: boolean = false, private isAncient: boolean = false) {
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const mapsTab = (await dataFetcher.fetchData(`${pathBase}/MAPS.tab`)).createDataView();
        const mapsBin = (await dataFetcher.fetchData(`${pathBase}/MAPS.bin`)).createDataView();

        console.log(`Creating scene for ${this.name} (location ${this.locationNum}) ...`);

        const mapInfo = getMapInfo(mapsTab, mapsBin, this.locationNum);
        const blockTable = getBlockTable(mapInfo);

        const self = this;
        const mapSceneInfo: MapSceneInfo = {
            getNumCols() { return mapInfo.blockCols; },
            getNumRows() { return mapInfo.blockRows; },
            async getBlockCollection(mod: number): Promise<IBlockCollection> {
                const blockColl = new BlockCollection(mod, self.isAncient);
                await blockColl.create(device, context, self.gameInfo);
                return blockColl;
            },
            getBlockInfoAt(col: number, row: number): BlockInfo | null {
                return blockTable[row][col];
            }
        };

        const mapScene = new MapScene();
        return mapScene.create(device, mapSceneInfo);
    }
}

export class AncientMapDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, private gameInfo: GameInfo, private mapKey: any) {
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const mapsJsonBuffer = await dataFetcher.fetchData(`${pathBase}/AncientMaps.json`);

        console.log(`Creating scene for ${this.name} ...`);

        const mapsJsonString = new TextDecoder('utf-8').decode(mapsJsonBuffer.arrayBuffer);
        const mapsJson = JSON.parse(mapsJsonString);
        const map = mapsJson[this.mapKey];

        const numRows = map.blocks.length;
        const numCols = map.blocks[0].length;
        const blockTable: (BlockInfo | null)[][] = nArray(numRows, () => nArray(numCols, () => null));

        for (let row = 0; row < numRows; row++) {
            for (let col = 0; col < numCols; col++) {
                const b = map.blocks[row][col];
                if (b == null) {
                    blockTable[row][col] = null;
                } else {
                    const newValue = b.split('.', 2);
                    const newMod = Number.parseInt(newValue[0]);
                    const newSub = Number.parseInt(newValue[1]);
                    blockTable[row][col] = {mod: newMod, sub: newSub};
                }
            }
        }

        const self = this;
        const mapSceneInfo: MapSceneInfo = {
            getNumCols() { return numCols; },
            getNumRows() { return numRows; },
            async getBlockCollection(mod: number): Promise<IBlockCollection> {
                const blockColl = new BlockCollection(mod, true);
                await blockColl.create(device, context, self.gameInfo);
                return blockColl;
            },
            getBlockInfoAt(col: number, row: number): BlockInfo | null {
                return blockTable[row][col];
            }
        };

        const mapScene = new MapScene();
        return mapScene.create(device, mapSceneInfo);
    }
}

export class SFASandboxDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, private gameInfo: GameInfo, private isAncient = false) {
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for ${this.name} ...`);

        const COLS = 20;
        const ROWS = 20;
        const blockTable: (BlockInfo | null)[][] = nArray(ROWS, () => nArray(COLS, () => null));

        const self = this;
        const mapSceneInfo: MapSceneInfo = {
            getNumCols() { return COLS; },
            getNumRows() { return ROWS; },
            async getBlockCollection(mod: number): Promise<IBlockCollection> {
                const blockColl = new BlockCollection(mod, self.isAncient);
                await blockColl.create(device, context, self.gameInfo);
                return blockColl;
            },
            getBlockInfoAt(col: number, row: number): BlockInfo | null {
                return blockTable[row][col];
            }
        };

        console.log(`Welcome to the sandbox. Type main.scene.openEditor() to open the map editor.`);

        const mapScene = new MapScene();
        return mapScene.create(device, mapSceneInfo);
    }
}
