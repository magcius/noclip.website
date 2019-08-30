
import { CMDL } from "./cmdl";
import { InputStream } from "./stream";
import { ResourceSystem } from "./resource";
import { assert } from "../util";

// CHAR (DKCR)

export interface CHAR {
    name: string;
    cmdl: CMDL;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): CHAR | null {
    const magic = stream.readUint32();
    if (magic !== 0x59BE000E)
        return null;

    stream.skip(19);
    const name = stream.readString();
    const cinfID = stream.readAssetID();
    const cprmID = stream.readAssetID();
    stream.skip(4);
    const type = stream.readString();
    assert(type === 'SkinnedModel' || type === 'FrozenModel');
    const cmdlID = stream.readAssetID();
    const cskrID = stream.readAssetID();

    const cmdl = resourceSystem.loadAssetByID<CMDL>(cmdlID, 'CMDL');
    return { name, cmdl };
}
