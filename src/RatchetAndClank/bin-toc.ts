import { assert } from "../util";
import { DataViewExt } from "./DataViewExt";
import { GN } from "./utils";

export const SECTOR_SIZE = 0x800;

export const ENTRY_POINTS: Record<GN, number> = {
    1: 1500,
    2: 1001,
    3: 1001,
    4: 1001,
};

export const TOC_MAX_SECTORS = 1024;
export const TOC_MAX_SIZE = TOC_MAX_SECTORS * SECTOR_SIZE;

// used as hints as to whether the file is a level or not (in rac234)
// these are int32
export const LEVEL_SECTOR_START_BYTES = new Set([
    0x0030,
    0x0164,
    0x22b8,
    0x0060,
    0x1018,
    0x137c,
    0x1818,
    0x26f0,
    0x0068,
    0x0c68,
    0x02a0,
    0x1000,
    0x2420,
])

export interface TableOfContents {
    levelSectors: { startSector: number, sizeInSectors: number }[],
};

export const SIZEOF_TABLE_OF_CONTENTS_RAC1 = 0x2960;
export async function readTableOfContents_Rac1(view: DataViewExt): Promise<TableOfContents> {
    const version = view.getInt32(0x0);
    const size = view.getInt32(0x4);
    view = view.subview(0, size);

    assert(version === 1);
    assert(size === SIZEOF_TABLE_OF_CONTENTS_RAC1);

    /*
    Aka "RacWadInfo" or "global wad"
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/iso/table_of_contents.h#L64
    */

    return {
        levelSectors: view.subdivide(0x28c8, 19, 0x8).map(view => {
            return view.getInt32PairAs(0, "startSector", "sizeInSectors");
        }),
    };
}

export async function readTableOfContents_Rac234(gn: GN, view: DataViewExt, isSuspiciouslyLevelShaped: (sector: number) => Promise<boolean>): Promise<TableOfContents> {
    assert(gn >= 2);

    // search the TOC for a sequence of 6 pointers that point to something that looks like a level
    let levelTableStart = 0;
    for (let i = 0; i < view.byteLength / 4 - 12; i++) {
        let parts = 0;
        for (let j = 0; j < 6; j++) {
            const lsn = view.getInt32((i + j * 2) * 4);
            if (lsn === 0 || lsn > TOC_MAX_SECTORS) {
                break;
            }
            const sus = await isSuspiciouslyLevelShaped(lsn);
            if (sus) parts++;
        }
        if (parts === 6) {
            levelTableStart = i * 4;
            break;
        }
    }

    const levelSectorViews = view.subdivide(levelTableStart, 100, 0x8 * 3);
    const levelSectors = [];
    for (let i = 0; i < levelSectorViews.length; i++) {
        const levelSector = levelSectorViews[i].getInt32PairAs(0, "startSector", "sizeInSectors"); // FIXME: different offset for rac3+
        if (levelSector.startSector === 0) break;
        levelSectors.push(levelSector);
    }

    return {
        levelSectors,
    };
}

export interface LevelDescriptor {
    id: number,
    headerSize: number,
    sector: number,
    data: { startSector: number, sizeInSectors: number },
    gameplay: { startSector: number, sizeInSectors: number },
    chunks: {
        chunks: { startSector: number, sizeInSectors: number }[],
        [unknown: string]: unknown,
    },
    [unknown: string]: unknown,
};
export function readLevelDescriptor(gn: GN, view: DataViewExt): LevelDescriptor {
    switch (gn) {
        case 1: {
            /*
            Aka "Rac1AmalgamatedWadHeader"
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/iso/table_of_contents.h#L142
            
            Scene header:
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/iso/table_of_contents.h#L134
            */

            const headerSize = view.getInt32(0x4);
            assert(headerSize === 0x2434);

            return {
                id: view.getInt32(0),
                headerSize,
                sector: 0, // sector pointers are absolute in rac1
                data: view.getInt32PairAs(0x8, "startSector", "sizeInSectors"), // points to LevelDataHeader
                gameplay: view.getInt32PairAs(0x10, "startSector", "sizeInSectors"), // points to GameplayHeader
                gameplayPal: view.getInt32PairAs(0x18, "startSector", "sizeInSectors"),
                occlusion: view.getInt32PairAs(0x20, "startSector", "sizeInSectors"),
                bindata: view.subdivide(0x28, 36, 0x8).map(view => {
                    return view.getInt32PairAs(0, "startSector", "sizeInBytes");
                }),
                music: view.subdivide(0x148, 15, 0x4).map(view => {
                    return view.getInt32(0);
                }),
                scenes: view.subdivide(0x184, 30, 0x128).map(view => {
                    /*
                    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/iso/table_of_contents.h#L134
                    */
                    return {
                        sounds: view.getArrayOfNumbers(0, 6, Int32Array),
                        wads: view.getArrayOfNumbers(0x18, 68, Int32Array),
                    };
                }),
                chunks: {
                    chunks: [],
                },
            };
        }
        case 2: {
            /*
            Aka GcUyaLevelWadHeader
            */
            const headerSize = view.getInt32(0);
            assert(headerSize === 0x60);

            return {
                headerSize,
                sector: view.getUint32(0x4), // other sector pointers are relative to this sector
                id: view.getInt32(0x8),
                reverb: view.getInt32(0xc),
                data: view.getInt32PairAs(0x10, "startSector", "sizeInSectors"), // points to LevelDataHeader
                soundBank: view.getInt32PairAs(0x18, "startSector", "sizeInSectors"),
                gameplay: view.getInt32PairAs(0x20, "startSector", "sizeInSectors"), // points to GameplayHeader
                occlusion: view.getInt32PairAs(0x28, "startSector", "sizeInSectors"),
                chunks: readChunksList(view.subview(0x30)),
            };
        }
        default: {
            throw new Error("not implemented");
        }
    }

}

export function readChunksList(view: DataViewExt) {
    const chunks = view.subdivide(0, 3, 0x8).map(view => {
        return view.getInt32PairAs(0, "startSector", "sizeInSectors");
    });
    const soundBanks = view.subdivide(0x18, 3, 0x8).map(view => {
        return view.getInt32PairAs(0, "startSector", "sizeInSectors");
    });
    return {
        chunks,
        soundBanks,
    };
}

export interface LevelDataHeader {
    coreIndex: { offset: number, size: number },
    coreData: { offset: number, size: number },
    gsRam: { offset: number, size: number },
    [unknown: string]: unknown,
};
export const SIZEOF_LEVEL_DATA_HEADER = 0x58;
export function readLevelDataHeader(gn: GN, view: DataViewExt): LevelDataHeader {
    switch (gn) {
        case 1: {
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
        case 2:
        case 3: {
            return {
                overlay: view.getInt32PairAs(0x0, "offset", "size"),
                coreIndex: view.getInt32PairAs(0x8, "offset", "size"),
                gsRam: view.getInt32PairAs(0x10, "offset", "size"),
                hudHeader: view.getInt32PairAs(0x18, "offset", "size"),
                hudBanks: view.subdivide(0x20, 5, 0x8).map(view => view.getInt32PairAs(0, "offset", "size")),
                coreData: view.getInt32PairAs(0x48, "offset", "size"),
                transitionTextures: view.getInt32PairAs(0x50, "offset", "size"),
            };
        }
        default: {
            throw new Error("not implemented");
        }
    }
}

export type ChunkHeader = {
    tfrags: number,
    collision: number,
};
export function readChunkHeader(view: DataViewExt) {
    return {
        tfrags: view.getUint32(0x0),
        collision: view.getUint32(0x4),
    };
}
