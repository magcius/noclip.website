
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { DataStream } from './util';

export interface Asset {
    id: number;
    type: number;
    name: string;
    data: ArrayBufferSlice;
}

export interface Layer {
    type: number;
    assets: Asset[];
}

export interface HIP {
    assets: Asset[];
    layers: Layer[];
}

enum BlockID {
    HIPA = 0x48495041,
    PACK = 0x5041434B,
    PVER = 0x50564552,
    PFLG = 0x50464C47,
    PCNT = 0x50434E54,
    PCRT = 0x50435254,
    PMOD = 0x504D4F44,
    PLAT = 0x504C4154,
    DICT = 0x44494354,
    ATOC = 0x41544F43,
    AINF = 0x41494E46,
    AHDR = 0x41484452,
    ADBG = 0x41444247,
    LTOC = 0x4C544F43,
    LINF = 0x4C494E46,
    LHDR = 0x4C484452,
    LDBG = 0x4C444247,
    STRM = 0x5354524D,
    DHDR = 0x44484452,
    DPAK = 0x4450414B
}

export function findAssetByID(assets: Asset[], id: number): Asset | undefined {
    return assets.find((asset: Asset) => {
        return asset.id === id;
    });
}

export function filterAssetsByType(assets: Asset[], type: number): Asset[] {
    return assets.filter((asset: Asset) => {
        return asset.type === type;
    });
}

export function parseHIP(buffer: ArrayBufferSlice): HIP {
    const stream = new DataStream(buffer, false);
    const assets: Asset[] = [];
    const layers: Layer[] = [];

    function readString(): string {
        const s = stream.readString();
        stream.align(2);
        return s;
    }

    function parseBlocks(parentEnd: number, callbacks: {[id: number]: (end: number) => void}) {
        while (stream.offset < parentEnd) {
            const id = stream.readUInt32();
            const length = stream.readUInt32();
            const end = stream.offset + length;

            if (callbacks[id])
                callbacks[id](end);
            
            stream.offset = end;
        }
    }
    
    parseBlocks(stream.length, {
        [BlockID.DICT]: (end) => {
            parseBlocks(end, {
                [BlockID.ATOC]: (end) => {
                    parseBlocks(end, {
                        [BlockID.AHDR]: (end) => {
                            const id = stream.readUInt32();
                            const type = stream.readUInt32();
                            const offset = stream.readUInt32();
                            const size = stream.readUInt32();
                            const pad = stream.readUInt32();
                            const flags = stream.readUInt32();

                            const data = buffer.subarray(offset, size);

                            let name: string = '';

                            parseBlocks(end, {
                                [BlockID.ADBG]: () => {
                                    const align = stream.readUInt32();
                                    name = readString();
                                    const fileName = readString();
                                    const checksum = stream.readUInt32();
                                }
                            });

                            assets.push({ id, type, name, data });
                        }
                    });
                },
                [BlockID.LTOC]: (end) => {
                    let layerIndex = 0;
                    parseBlocks(end, {
                        [BlockID.LHDR]: (end) => {
                            const type = stream.readUInt32();
                            const assetCount = stream.readUInt32();
                            const layerAssets: Asset[] = [];

                            for (let i = 0; i < assetCount; i++) {
                                const assetID = stream.readUInt32();
                                const asset = findAssetByID(assets, assetID);

                                if (asset === undefined)
                                    console.warn(`Couldn't find asset ${assetID} in layer ${layerIndex}`);
                                else
                                    layerAssets.push(asset);
                            }

                            layers.push({ type, assets: layerAssets });
                            layerIndex++;
                        }
                    });
                }
            });
        }
    });

    return { assets, layers };
}