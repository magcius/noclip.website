
// Resource System

import * as Pako from 'pako';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, hexzero, readString } from "../util";

import { PAK, FileResource, CompressionMethod } from "./pak";

import * as MLVL from './mlvl';
import * as MREA from './mrea';
import * as STRG from './strg';
import * as TXTR from './txtr';
import * as CMDL from './cmdl';
import * as ANCS from './ancs';

type ParseFunc<T> = (resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice) => T;
type Resource = any;

const FourCCLoaders: { [n: string]: ParseFunc<Resource> } = {
    'MLVL': MLVL.parse,
    'MREA': MREA.parse,
    'STRG': STRG.parse,
    'TXTR': TXTR.parse,
    'CMDL': CMDL.parse,
    'ANCS': ANCS.parse,
};

interface NameDataAsset {
    Filename: string;
    Path: string;
}

interface NameDataArea {
    Name: string;
}

export interface NameData {
    Assets: { [key: string]: NameDataAsset },
    Areas: { [key: string]: NameDataArea },
}

function hexName(id: string): string {
    let S = '';
    for (let i = 0; i < id.length; i++)
        S += hexzero(id.charCodeAt(i), 2).toUpperCase();
    return S;
}

function combineBuffers(totalSize: number, buffers: Uint8Array[]): Uint8Array {
    const totalBuffer = new Uint8Array(totalSize);
    let idx = 0;
    for (let i = 0; i < buffers.length; i++) {
        totalBuffer.set(buffers[i], idx);
        idx += buffers[i].byteLength;
    }
    assert(idx === totalSize);
    return totalBuffer;
}

export class ResourceSystem {
    private _cache: Map<string, Resource>;

    constructor(public paks: PAK[], public nameData: NameData | null = null) {
        this._cache = new Map<string, Resource>();
    }

    private loadResourceBuffer_CMPD_ZLIB(buffer: ArrayBufferSlice): ArrayBufferSlice {
        const view = buffer.createDataView();
        assert(readString(buffer, 0x00, 0x04, false) === 'CMPD');
        const chunkCount = view.getUint32(0x04);

        let chunkTableIdx = 0x08;
        let chunkDataIdx = 0x08 + 0x08 * chunkCount;
        let decompressedSize = 0;
        const decompressedChunks: Uint8Array[] = [];
        for (let i = 0; i < chunkCount; i++) {
            const chunkCompressedSize = view.getUint32(chunkTableIdx + 0x00) & 0x00FFFFFF;
            const chunkDecompressedSize = view.getUint32(chunkTableIdx + 0x04);
            const chunkBuffer = buffer.subarray(chunkDataIdx, chunkCompressedSize);
            if (chunkCompressedSize === chunkDecompressedSize) {
                // Left uncompressed
                decompressedChunks.push(chunkBuffer.createTypedArray(Uint8Array));
            } else {
                const inflated = Pako.inflate(chunkBuffer.createTypedArray(Uint8Array));
                assert(inflated.byteLength === chunkDecompressedSize);
                decompressedChunks.push(inflated);
            }
            chunkTableIdx += 0x08;
            chunkDataIdx += chunkCompressedSize;
            decompressedSize += chunkDecompressedSize;
        }

        const decompressedBuffer = combineBuffers(decompressedSize, decompressedChunks);
        return new ArrayBufferSlice(decompressedBuffer.buffer);
    }

    private loadResourceBuffer(resource: FileResource): ArrayBufferSlice {
        if (resource.compressionMethod === CompressionMethod.NONE) {
            return resource.buffer;
        } else if (resource.compressionMethod === CompressionMethod.ZLIB) {
            // 0x00 is decompresedSize.
            const deflated = resource.buffer.createTypedArray(Uint8Array, 0x04);
            const inflated = Pako.inflate(deflated);
            return new ArrayBufferSlice(inflated.buffer);
        } else if (resource.compressionMethod === CompressionMethod.CMPD_ZLIB) {
            return this.loadResourceBuffer_CMPD_ZLIB(resource.buffer);
        } else {
            throw "whoops";
        }
    }

    public findResourceNameByID(assetID: string): string {
        const assetIDHex = hexName(assetID);
        assert(assetIDHex.length === 8 || assetIDHex.length === 16);
        if (this.nameData !== null) {
            const nameDataAsset = this.nameData.Assets[assetIDHex];
            if (nameDataAsset)
                return nameDataAsset.Filename;
        }

        return assetIDHex;
    }

    public findResourceByID(assetID: string): FileResource {
        assert(assetID.length === 4 || assetID.length === 8);
        for (const pak of this.paks) {
            const resource = pak.resourceTable.get(assetID);
            if (resource)
                return resource;
        }
        return null;
    }

    public loadAssetByID(assetID: string, fourCC: string): Resource {
        if (assetID === '\xFF\xFF\xFF\xFF' || assetID === '\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF')
            return null;

        const cached = this._cache.get(assetID);
        if (cached !== undefined)
            return cached;

        const loaderFunc = FourCCLoaders[fourCC];
        if (!loaderFunc)
            return null;

        const resource = this.findResourceByID(assetID);
        assert(resource.fourCC === fourCC);
        const buffer = this.loadResourceBuffer(resource);
        const inst = loaderFunc(this, assetID, buffer);
        this._cache.set(assetID, inst);
        return inst;
    }
}
