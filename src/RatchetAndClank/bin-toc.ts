import { assert } from "../util";
import { DataViewExt } from "./DataViewExt";
import { GN } from "./utils";

export interface DiskFns {
    readBytes(startSector: number, byteLength: number): Promise<ArrayBuffer>
    readWithSizeHeader(startSector: number, sizeOffset: number): Promise<ArrayBuffer>
}

export const SECTOR_SIZE = 0x800;

export const ENTRY_POINTS: Record<GN, number> = {
    1: 1500,
    2: 1001,
    3: 1001,
    4: 1001,
};

export const MAX_CONSECUTIVE_NULL_LEVELS: Record<GN, number> = {
    1: 3,
    2: 3,
    3: 3,
    4: 20,
};

export const TOC_MAX_SECTORS = 1024;
export const TOC_MAX_SIZE = TOC_MAX_SECTORS * SECTOR_SIZE;

export interface TableOfContents {
    title: { startSector: number, sizeInSectors: number } | null,
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
        title: view.getInt32PairAs(0x14e8, "startSector", "sizeInSectors"),
        levelSectors: view.subdivide(0x28c8, 19, 0x8).map(view => {
            return view.getInt32PairAs(0, "startSector", "sizeInSectors")
        }),
    };
}

function readPrefixUint(buf: ArrayBuffer) {
    const view = new DataViewExt(buf, { littleEndian: true });
    return view.getUint32(0);
}

const LEVEL_HEADER_PREFIX_U32S = [
    0x30,
    0x60,
    0x68,
    0xc68,
];

function isSuspiciouslyLevelShaped(data: ArrayBuffer) {
    const headerSize = readPrefixUint(data);
    if (LEVEL_HEADER_PREFIX_U32S.includes(headerSize)) {
        return true;
    }
    return false;
}

export async function readTableOfContents_Rac234(gn: GN, diskFns: DiskFns, view: DataViewExt): Promise<TableOfContents> {
    assert(gn >= 2);

    /**
    struct {
        struct {
            u32 startSector;
            u32 sizeInSectors;
        }[3];
    }[unknown]

    The start offset and the length are guessed.
    The inner array contains [level, audio, cutscenes], but the order is different across games.
    We're looking for at least 3 consecutive pointers, 0x8*3 bytes apart, that point to one of the known level header prefixes.
    (2 consecutive pointers doesn't work, there's a false positive)
    */

    const stride = 0x8 * 3;

    let ptr = 0;
    for (; ptr < view.byteLength; ptr += 0x4) {
        const a = await diskFns.readBytes(view.getUint32(ptr), 4);
        const b = await diskFns.readBytes(view.getUint32(ptr + stride), 4);
        const c = await diskFns.readBytes(view.getUint32(ptr + stride * 2), 4);
        if (isSuspiciouslyLevelShaped(a) && isSuspiciouslyLevelShaped(b) && isSuspiciouslyLevelShaped(c)) {
            break;
        }
        if (ptr > 0x20 * SECTOR_SIZE) {
            throw new Error("Level table not found");
        }
    }

    console.log("Found level table at: " + ptr.toString(16));

    const levelSectorViews = view.subdivide(ptr, 100, stride);
    const levelSectorRanges = levelSectorViews.map(view => {
        return {
            a: view.getInt32PairAs(0, "startSector", "sizeInSectors"),
            b: view.getInt32PairAs(0, "startSector", "sizeInSectors"),
            c: view.getInt32PairAs(0, "startSector", "sizeInSectors"),
        }
    });

    let zeroes = 0;
    const levelSectors = [];
    for (let i = 0; i < levelSectorRanges.length; i++) {
        const range = levelSectorRanges[i].a;

        if (range.startSector === 0 || range.startSector === 0xcdcdcdcd) {
            zeroes += 1;
            if (zeroes >= MAX_CONSECUTIVE_NULL_LEVELS[gn]) break; // several null levels in a row? must be the end of the array, I guess...
        } else {
            zeroes = 0;
            levelSectors.push(range);
        }
    }

    return {
        title: null,
        levelSectors,
    }
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
    art?: { startSector: number, sizeInSectors: number },
    maxMissionInstancesSize?: number,
    maxMissionClassesSize?: number,
    missions?: LevelMissionDescriptor,
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
        case 2:
        case 3: {
            /*
            Aka GcUyaLevelWadHeader
            */
            const headerSize = view.getInt32(0);

            switch (headerSize) {
                case 0x60: {
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
                case 0x68: {
                    return {
                        headerSize,
                        sector: view.getUint32(0x4),
                        id: view.getInt32(0x8),
                        data: view.getInt32PairAs(0xc, "startSector", "sizeInSectors"),
                        soundBank: view.getInt32PairAs(0x14, "startSector", "sizeInSectors"),
                        gameplay: view.getInt32PairAs(0x1c, "startSector", "sizeInSectors"),
                        gameplayPal: view.getInt32PairAs(0x24, "startSector", "sizeInSectors"),
                        occlusion: view.getInt32PairAs(0x2c, "startSector", "sizeInSectors"),
                        chunks: readChunksList(view.subview(0x34)),
                        reverb: view.getInt32(0x4c),
                        chunkBanks: view.subdivide(0x50, 3, 0x8).map(view => {
                            return view.getInt32PairAs(0, "startSector", "sizeInSectors");
                        }),
                    };
                }
                default: {
                    assert(false);
                }
            }
        }
        case 4: {
            /**
            Aka DlLevelWadHeader
             */
            const headerSize = view.getInt32(0);
            assert(headerSize === 0xc68);

            return {
                headerSize,
                sector: view.getUint32(0x4),
                id: view.getInt32(0x8),
                reverb: view.getInt32(0xc),
                maxMissionInstancesSize: view.getInt32(0x10),
                maxMissionClassesSize: view.getInt32(0x14),
                data: view.getInt32PairAs(0x18, "startSector", "sizeInSectors"),
                soundBank: view.getInt32PairAs(0x20, "startSector", "sizeInSectors"),
                chunks: readChunksList(view.subview(0x28)),
                gameplay: view.getInt32PairAs(0x58, "startSector", "sizeInSectors"),
                missions: readLevelMissionDescriptor_Rac4(view.subview(0x60)),
                art: view.getInt32PairAs(0xc60, "startSector", "sizeInSectors"),
            }
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

export interface LevelMissionDescriptor {
    gameplay: { startSector: number, sizeInSectors: number }[],
    data: { startSector: number, sizeInSectors: number }[],
    sound: { startSector: number, sizeInSectors: number }[],
}
export function readLevelMissionDescriptor_Rac4(view: DataViewExt): LevelMissionDescriptor {
    let ptr = 0;
    const gameplay = view.subdivide(ptr, 128, 0x8).map(view => {
        return view.getInt32PairAs(0, "startSector", "sizeInSectors");
    });
    ptr += 128 * 0x8;
    const data = view.subdivide(ptr, 128, 0x8).map(view => {
        return view.getInt32PairAs(0, "startSector", "sizeInSectors");
    });
    ptr += 128 * 0x8;
    const sound = view.subdivide(ptr, 128, 0x8).map(view => {
        return view.getInt32PairAs(0, "startSector", "sizeInSectors");
    });

    return {
        gameplay,
        data,
        sound,
    };
}

export interface LevelDataHeader {
    overlay: { offset: number, size: number },
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
        case 4: {
            return {
                unknown: view.getInt32PairAs(0x0, "offset", "size"), // "moby8355_pvars", apparently?
                overlay: view.getInt32PairAs(0x8, "offset", "size"),
                coreIndex: view.getInt32PairAs(0x10, "offset", "size"),
                gsRam: view.getInt32PairAs(0x18, "offset", "size"),
                hudHeader: view.getInt32PairAs(0x20, "offset", "size"),
                hudBanks: view.subdivide(0x28, 5, 0x8).map(view => view.getInt32PairAs(0, "offset", "size")),
                coreData: view.getInt32PairAs(0x50, "offset", "size"),
                artInstances: view.getInt32PairAs(0x58, "offset", "size"),
                gameplayCore: view.getInt32PairAs(0x60, "offset", "size"),
                globalNavData: view.getInt32PairAs(0x68, "offset", "size"),
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
