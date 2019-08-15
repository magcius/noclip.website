
// Implements Retro's CMDL format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, align } from "../util";

import { ResourceSystem } from "./resource";
import { Geometry, MaterialSet, parseGeometry, parseMaterialSet } from "./mrea";
import { AABB } from "../Geometry";
import { InputStream } from "./stream";

export interface CMDL {
    bbox: AABB;
    assetID: string;
    materialSets: MaterialSet[];
    geometry: Geometry;
}

enum Flags {
    SKINNED = 0x01,
    NRM_SHORT = 0x02,
    UV_SHORT = 0x04,
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): CMDL {
    assert(stream.readUint32() === 0xDEADBABE);
    const version = stream.readUint32();
    assert(version === 0x02 || version === 0x04, `Unsupported CMDL version: ${version}`);

    const flags: Flags = stream.readUint32();
    const minX = stream.readFloat32();
    const minY = stream.readFloat32();
    const minZ = stream.readFloat32();
    const maxX = stream.readFloat32();
    const maxY = stream.readFloat32();
    const maxZ = stream.readFloat32();
    const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

    const dataSectionCount = stream.readUint32();
    const materialSetCount = stream.readUint32();

    const dataSectionSizeTable: number[] = [];
    for (let i = 0; i < dataSectionCount; i++) {
        const size = stream.readUint32();
        dataSectionSizeTable.push(size);
    }
    stream.align(32);

    const firstDataSectionOffs = stream.tell();
    const dataSectionOffsTable: number[] = [firstDataSectionOffs];
    for (let i = 1; i < dataSectionCount; i++) {
        const prevOffs = dataSectionOffsTable[i - 1];
        const prevSize = dataSectionSizeTable[i - 1];
        dataSectionOffsTable.push(align(prevOffs + prevSize, 32));
    }

    let dataSectionIndex = 0;

    const materialSets: MaterialSet[] = [];
    for (let i = 0; i < materialSetCount; i++) {
        stream.goTo(dataSectionOffsTable[dataSectionIndex++]);
        const materialSet = parseMaterialSet(stream, resourceSystem, version === 0x04);
        materialSets.push(materialSet);
    }

    const hasUVShort = !!(flags & Flags.UV_SHORT);
    let geometry;
    [geometry, dataSectionIndex] = parseGeometry(stream, materialSets[0], dataSectionOffsTable, hasUVShort, version === 0x04, dataSectionIndex, -1);

    return { bbox, assetID, materialSets, geometry };
}
