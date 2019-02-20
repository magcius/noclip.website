
// Implements Retro's CMDL format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, align } from "../util";

import { ResourceSystem } from "./resource";
import { Geometry, MaterialSet, parseGeometry, parseMaterialSet } from "./mrea";
import { AABB } from "../Geometry";

export interface CMDL {
    bbox: AABB;
    materialSets: MaterialSet[];
    geometry: Geometry;
}

enum Flags {
    SKINNED = 0x01,
    NRM_SHORT = 0x02,
    UV_SHORT = 0x04,
}

export function parse(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): CMDL {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0xDEADBABE);
    const version = view.getUint32(0x04);
    assert(version === 0x02);

    const flags: Flags = view.getUint32(0x08);
    const minX = view.getFloat32(0x0C);
    const minY = view.getFloat32(0x10);
    const minZ = view.getFloat32(0x14);
    const maxX = view.getFloat32(0x18);
    const maxY = view.getFloat32(0x1C);
    const maxZ = view.getFloat32(0x20);
    const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

    const dataSectionCount = view.getUint32(0x24);
    const materialSetCount = view.getUint32(0x28);

    const dataSectionSizeTable: number[] = [];
    let dataSectionSizeTableIdx = 0x2C;
    for (let i = 0; i < dataSectionCount; i++) {
        const size = view.getUint32(dataSectionSizeTableIdx + 0x00);
        dataSectionSizeTable.push(size);
        dataSectionSizeTableIdx += 0x04;
    }

    const firstDataSectionOffs = align(dataSectionSizeTableIdx, 32);
    const dataSectionOffsTable: number[] = [firstDataSectionOffs];
    for (let i = 1; i < dataSectionCount; i++) {
        const prevOffs = dataSectionOffsTable[i - 1];
        const prevSize = dataSectionSizeTable[i - 1];
        dataSectionOffsTable.push(align(prevOffs + prevSize, 32));
    }

    let dataSectionIndex = 0;

    const materialSets: MaterialSet[] = [];
    for (let i = 0; i < materialSetCount; i++) {
        const materialSet = parseMaterialSet(resourceSystem, buffer, dataSectionOffsTable[dataSectionIndex++]);
        materialSets.push(materialSet);
    }

    const hasUVShort = !!(flags & Flags.UV_SHORT);
    let geometry;
    [geometry, dataSectionIndex] = parseGeometry(buffer, materialSets[0], dataSectionOffsTable, hasUVShort, dataSectionIndex++, -1);

    return { bbox, materialSets, geometry };
}
