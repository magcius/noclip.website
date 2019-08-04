
// Implements Retro's ANCS format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, align, readString } from "../util";

import { ResourceSystem } from "./resource";
import { CMDL } from "./cmdl"
import { AABB } from "../Geometry";

// minimal implementation of ANCS
export interface MetroidCharacter {
    name: string;
    model: CMDL;
    skinID: string;
    skelID: string;
}

export interface ANCS {
    characters: MetroidCharacter[];
}

export function parse(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): ANCS {
    const view = buffer.createDataView();

    // we aren't doing any validation checks right now - read only data we care about
    const numChars = view.getUint32(0xA);
    let readIdx = 0xE;
    
    const charSet: MetroidCharacter[] = [];

    // add loop here but we're actually just going to take the first one
    const name: string = readString(buffer, readIdx);
    readIdx += name.length + 1;
    const modelID: string = readString(buffer, readIdx+0, 4, false);
    const skinID: string = readString(buffer, readIdx+4, 4, false);
    const skelID: string = readString(buffer, readIdx+8, 4, false);
    
    const model = resourceSystem.loadAssetByID(modelID, 'CMDL');
    const char: MetroidCharacter = { name, model, skinID, skelID };
    charSet.push(char);

    return { characters: charSet };
}
