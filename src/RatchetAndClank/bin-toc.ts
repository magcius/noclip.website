import { assert } from "../util";
import { DataViewExt } from "./DataViewExt";

export interface TableOfContents {
    version: number,
    size: number,
    levelSectors: { startSector: number, sizeInSectors: number }[],
};
export const SIZEOF_TABLE_OF_CONTENTS = 0x2960;
export async function readTableOfContents(view: DataViewExt): Promise<TableOfContents> {
    /*
    Aka "RacWadInfo" or "global wad"
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/iso/table_of_contents.h#L64
    */

    const version = view.getInt32(0x0);
    const size = view.getInt32(0x4);

    assert(version === 1);
    assert(size === SIZEOF_TABLE_OF_CONTENTS);

    return {
        version,
        size,
        levelSectors: view.subdivide(0x28c8, 19, 0x8).map(view => {
            return view.getInt32PairAs(0, "startSector", "sizeInSectors");
        }),
    };
}

export interface LevelDescriptor {
    id: number,
    headerSize: number,
    data: { startSector: number, sizeInSectors: number },
    gameplayNtsc: { startSector: number, sizeInSectors: number },
    gameplayPal: { startSector: number, sizeInSectors: number },
    occlusion: { startSector: number, sizeInSectors: number },
    bindata: { startSector: number, sizeInBytes: number }[],
    music: number[],
    scenes: { sounds: number[], wads: number[] }[],
};
export const SIZEOF_LEVEL_DESCRIPTOR_HEADER = 0x2434;
export async function readLevelDescriptor(view: DataViewExt) {
    /*
      Aka "Rac1AmalgamatedWadHeader"
      https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/iso/table_of_contents.h#L142
      
      Scene header:
      https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/iso/table_of_contents.h#L134
    */

    const headerSize = view.getInt32(0x4);
    assert(headerSize === SIZEOF_LEVEL_DESCRIPTOR_HEADER);

    const tocItem = {
        id: view.getInt32(0),
        headerSize,
        data: view.getInt32PairAs(0x8, "startSector", "sizeInSectors"), // points to LevelDataHeader
        gameplayNtsc: view.getInt32PairAs(0x10, "startSector", "sizeInSectors"), // points to GameplayHeader
        gameplayPal: view.getInt32PairAs(0x18, "startSector", "sizeInSectors"),
        occlusion: view.getInt32PairAs(0x20, "startSector", "sizeInSectors"),
        bindata: view.subdivide(0x28, 36, 0x8).map(view => {
            return view.getInt32PairAs(0, "startSector", "sizeInBytes");
        }),
        music: view.subdivide(0x148, 15, 0x4).map(view => {
            return view.getInt32(0);
        }),
        scenes: view.subdivide(0x184, 30, 0x128).map(view => {
            return {
                sounds: view.getArrayOfNumbers(0, 6, Int32Array),
                wads: view.getArrayOfNumbers(0x18, 68, Int32Array),
            };
        }),
    };

    return tocItem;
}

export interface LevelDataHeader {
    overlay: { offset: number, size: number },
    soundBank: { offset: number, size: number },
    coreIndex: { offset: number, size: number },
    gsRam: { offset: number, size: number },
    hudHeader: { offset: number, size: number },
    hudBanks: { offset: number, size: number }[],
    coreData: { offset: number, size: number },
};
export const SIZEOF_LEVEL_DATA_HEADER = 0x58;
export async function readLevelDataHeader(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_data_wad.cpp#L26
    */

    return {
        overlay: view.getInt32PairAs(0x0, "offset", "size"),
        soundBank: view.getInt32PairAs(0x8, "offset", "size"),
        coreIndex: view.getInt32PairAs(0x10, "offset", "size"),
        gsRam: view.getInt32PairAs(0x18, "offset", "size"),
        hudHeader: view.getInt32PairAs(0x20, "offset", "size"),
        hudBanks: view.subdivide(0x28, 5, 0x8).map(view => view.getInt32PairAs(0, "offset", "size")),
        coreData: view.getInt32PairAs(0x50, "offset", "size")
    };
}
