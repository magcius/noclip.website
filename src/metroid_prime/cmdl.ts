
// Implements Retro's CMDL format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, align } from "../util";

import { ResourceSystem } from "./resource";
import { Geometry, MaterialSet, parseGeometry, parseMaterialSet, parseMaterialSet_MP3 } from "./mrea";
import { AABB } from "../Geometry";
import { InputStream } from "./stream";

export interface CMDL {
    bbox: AABB;
    assetID: string;
    materialSets: MaterialSet[];
    geometry: Geometry;
}

enum ModelVersion {
    MP1 = 0x2,
    MP2 = 0x4,
    MP3 = 0x5,
    DKCR = 0xA
}

enum Flags {
    SKINNED = 0x01,
    NRM_SHORT = 0x02,
    UV_SHORT = 0x04,
    VIS_GROUPS = 0x10, // DKCR only
    POS_SHORT = 0x20, // DKCR only
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): CMDL {
    const magic = stream.readUint32();
    let version: number;
    
    if (magic === 0x9381000A) {
        version = ModelVersion.DKCR;
    }
    else {
        assert(magic === 0xDEADBABE);
        version = stream.readUint32();
        assert(version === ModelVersion.MP1 || version === ModelVersion.MP2 || version === ModelVersion.MP3, `Unsupported CMDL version: ${version}`);
    }

    stream.assetIdLength = (version >= ModelVersion.MP3 ? 8 : 4);

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

    if (version === ModelVersion.DKCR) {
        if (flags & Flags.VIS_GROUPS) {
            stream.skip(4);
            const groupCount = stream.readUint32();

            for (let i = 0; i < groupCount; i++) {
                const nameLen = stream.readUint32();
                const name = stream.readString(nameLen, false);
            }
            stream.skip(0x14);
        }
    }

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
    stream.goTo(dataSectionOffsTable[dataSectionIndex++]);
    for (let i = 0; i < materialSetCount; i++) {
        const materialSet = (version <= ModelVersion.MP2 ?
            parseMaterialSet(stream, resourceSystem, version === ModelVersion.MP2) :
            parseMaterialSet_MP3(stream, resourceSystem));
        
        materialSets.push(materialSet);

        if (version <= ModelVersion.MP2 && i+1 < materialSetCount) {
            stream.goTo(dataSectionOffsTable[dataSectionIndex++]);
        }
    }

    const hasUVShort = ( !!(flags & Flags.UV_SHORT) || version === ModelVersion.DKCR );
    let geometry;
    [geometry, dataSectionIndex] = parseGeometry(stream, materialSets[0], dataSectionOffsTable, hasUVShort, version >= ModelVersion.MP2, version >= ModelVersion.DKCR, dataSectionIndex, -1);

    return { bbox, assetID, materialSets, geometry };
}
