
// Resource System

import pako from 'pako';

import { PAK, FileResource } from "./pak";

import * as MLVL from './mlvl';
import * as MREA from './mrea';
import * as STRG from './strg';
import * as TXTR from './txtr';
import * as CMDL from './cmdl';

import { assert, hexzero } from "../util";
import ArrayBufferSlice from 'ArrayBufferSlice';

type ParseFunc<T> = (resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice) => T;
type Resource = any;

const FourCCLoaders: { [n: string]: ParseFunc<Resource> } = {
    'MLVL': MLVL.parse,
    'MREA': MREA.parse,
    'STRG': STRG.parse,
    'TXTR': TXTR.parse,
    'CMDL': CMDL.parse,
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

export class ResourceSystem {
    private _cache: Map<string, Resource>;

    constructor(public paks: PAK[], public nameData: NameData) {
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

    public findResourceNameByID(assetID: string): string {
        const assetIDHex = hexName(assetID);
        assert(assetIDHex.length === 8);
        const nameDataAsset = this.nameData.Assets[assetIDHex];
        if (nameDataAsset)
            return nameDataAsset.Filename;
        else
            return assetIDHex;
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
        const inst = loaderFunc(this, assetID, buffer);
        this._cache.set(assetID, inst);
        return inst;
    }
}
