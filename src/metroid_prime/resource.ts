
// Resource System

import pako from 'pako';

import { PAK, FileResource } from "./pak";

import * as MLVL from './mlvl';
import * as MREA from './mrea';
import * as STRG from './strg';
import * as TXTR from './txtr';

import { assert } from "../util";
import ArrayBufferSlice from 'ArrayBufferSlice';

type ParseFunc<T> = (resourceSystem: ResourceSystem, buffer: ArrayBufferSlice) => T;
type Resource = any;

const FourCCLoaders: { [n: string]: ParseFunc<Resource> } = {
    'MLVL': MLVL.parse,
    'MREA': MREA.parse,
    'STRG': STRG.parse,
    'TXTR': TXTR.parse,
};

export class ResourceSystem {
    private _cache: Map<string, Resource>;

    constructor(public paks: PAK[]) {
        this._cache = new Map<string, Resource>();
    }

    private loadResourceBuffer(resource: FileResource): ArrayBufferSlice {
        if (resource.isCompressed) {
            const deflated = resource.buffer.createTypedArray(Uint8Array);
            const inflated = pako.inflate(deflated);
            return new ArrayBufferSlice(inflated.buffer);
        } else {
            return resource.buffer;
        }
    }

    public findResourceByID(assetID: string): FileResource {
        assert(assetID.length === 4);
        for (const pak of this.paks) {
            const resource = pak.resourceTable.get(assetID);
            if (resource)
                return resource;
        }
        return null;
    }

    public loadAssetByID(assetID: string, fourCC: string): Resource {
        const cached = this._cache.get(assetID);
        if (cached !== undefined)
            return cached;

        const loaderFunc = FourCCLoaders[fourCC];
        if (!loaderFunc)
            return null;

        const resource = this.findResourceByID(assetID);
        assert(resource.fourCC === fourCC);
        const buffer = this.loadResourceBuffer(resource);
        const inst = loaderFunc(this, buffer);
        this._cache.set(assetID, inst);
        return inst;
    }
}
