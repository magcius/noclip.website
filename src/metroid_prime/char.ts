
import { CMDL } from "./cmdl";
import { InputStream } from "./stream";
import { ResourceSystem } from "./resource";
import { assert, assertExists } from "../util";

// CHAR (DKCR)

export interface CHAR {
    name: string;
    cmdl: CMDL;
}

function parseDKCR(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): CHAR | null {
    stream.skip(21);
    const name = stream.readString();
    const cinfID = stream.readAssetID();
    const cprmID = stream.readAssetID();
    stream.skip(4);
    const type = stream.readString();
    assert(type === 'SkinnedModel' || type === 'FrozenModel');
    const cmdlID = stream.readAssetID();
    const cskrID = stream.readAssetID();

    const cmdl = assertExists(resourceSystem.loadAssetByID<CMDL>(cmdlID, 'CMDL'));
    return { name, cmdl };
}

function parseMP3(stream: InputStream, resource: ResourceSystem, assetID: string): CHAR | null {
    const name = stream.readString();
    const cmdlID = stream.readAssetID();    
    const cmdl = assertExists(resource.loadAssetByID<CMDL>(cmdlID, 'CMDL'));
    return { name, cmdl };
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): CHAR | null {
    const magic = stream.readUint16();
     
    if (magic !== 0x59BE)
    {
        const char = parseMP3(stream, resourceSystem, assetID);
        return char;
    } 
    else 
    {
        const char = parseDKCR(stream, resourceSystem, assetID);
        return char;
    }
    return null;
}
