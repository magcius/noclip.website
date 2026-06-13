#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs, { FileHandle } from "node:fs/promises";
import { ENTRY_POINTS, LEVEL_SECTOR_START_BYTES, readChunkHeader, readLevelDataHeader, readLevelDescriptor, readTableOfContents_Rac1, readTableOfContents_Rac234, SECTOR_SIZE, TableOfContents, TOC_MAX_SIZE } from "../bin-toc.ts";
import { DataViewExt } from "../DataViewExt.ts";
import { readLevelCoreHeader } from "../bin-index.ts";
import { WadDecompressor } from "../decompress.ts";
import { assert } from '../../util.ts';
import { LevelResources, load } from '../loader.ts';
import { GN } from '../utils.ts';

const encoder = new TextEncoder();

const gn = Number(process.argv[2]) as GN;

if (gn < 1 || gn > 4) {
    console.error(`Usage: pnpm build:RatchetAndClank <gameNumber>`);
    process.exit(1);
}

const baseDataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), `../../../data`);

const outputDir = path.join(baseDataDir, `RatchetAndClank${gn}`);
await fs.mkdir(outputDir, { recursive: true });

const diskFile = path.join(baseDataDir, `RatchetAndClank${gn}_raw/game.iso`);
const disk = await fs.open(diskFile);

// Read byteLength bytes starting at startSector
export async function readFromDisk(disk: FileHandle, startSector: number, byteLength: number) {
    const dest = new Uint8Array(byteLength);
    await disk.read(dest, 0, byteLength, startSector * SECTOR_SIZE);
    return dest.buffer;
}

// Read the size of the object at startSector + sizeOffset and then read that many bytes starting at startSector
export async function readFromDiskWithSizeHeader(disk: FileHandle, startSector: number, sizeOffset: number) {
    const header = await readFromDisk(disk, startSector, sizeOffset + 0x4);
    const byteLength = new DataViewExt(header, { littleEndian: true }, sizeOffset).getInt32(0);
    return readFromDisk(disk, startSector, byteLength);
}

async function isSuspiciouslyLevelShaped_Rac234(startSector: number) {
    const headerSize = await readFromDisk(disk, startSector, 4);
    const view = new DataViewExt(headerSize, { littleEndian: true });
    const size = view.getInt32(0);
    return LEVEL_SECTOR_START_BYTES.has(size);
}

function decompress(compressed: DataViewExt) {
    const arrayBuffer = (new WadDecompressor(compressed)).decompress();
    return new DataViewExt(arrayBuffer, { littleEndian: true });
}

// read table of contents
let tableOfContents: TableOfContents;
if (gn === 1) {
    const tableOfContentsBuffer = await readFromDiskWithSizeHeader(disk, ENTRY_POINTS[gn], 0x4);
    tableOfContents = await readTableOfContents_Rac1(new DataViewExt(tableOfContentsBuffer, { littleEndian: true }));
} else {
    const tableOfContentsBuffer = await readFromDisk(disk, ENTRY_POINTS[gn], TOC_MAX_SIZE);
    tableOfContents = await readTableOfContents_Rac234(gn, new DataViewExt(tableOfContentsBuffer, { littleEndian: true }), isSuspiciouslyLevelShaped_Rac234);
}
await fs.writeFile(path.join(outputDir, `global.json`), JSON.stringify(tableOfContents));

// read levels
for (const levelSectors of tableOfContents.levelSectors) {
    if (!levelSectors) continue;

    const levelDescriptorSizeOffset = gn === 1 ? 0x4 : 0x0;
    const levelDescriptorBuffer = await readFromDiskWithSizeHeader(disk, levelSectors.startSector, levelDescriptorSizeOffset);
    const levelDescriptor = readLevelDescriptor(gn, new DataViewExt(levelDescriptorBuffer, { littleEndian: true }));
    if (!levelDescriptor) continue;

    const levelNum = levelDescriptor.id;
    console.log(`Start level ${levelNum}`);

    const files: { name: string, compressed: boolean, size: number, decompressedSize: number }[] = [];
    async function extractLevelFile(name: string, buf: DataViewExt) {
        const filename = name.replace(/\{\}/g, String(levelNum));
        await fs.writeFile(path.join(outputDir, filename), buf);
        console.log(`Writing file ${filename}`);
        const compressed = name.endsWith('.wad');
        const decompressedSize = compressed ? decompress(buf).byteLength : 0;
        files.push({ name: filename, compressed, size: buf.byteLength, decompressedSize });
    }

    // level
    const levelDataSector = levelDescriptor.data;
    const levelDataBuffer = await readFromDisk(disk, levelDescriptor.sector + levelDataSector.startSector, levelDataSector.sizeInSectors * SECTOR_SIZE);
    const levelData = new DataViewExt(levelDataBuffer, { littleEndian: true });
    const levelDataHeader = readLevelDataHeader(gn, levelData);

    // level/gs
    const gsRam = levelData.subview(levelDataHeader.gsRam.offset, levelDataHeader.gsRam.size);

    // level/gameplay
    const gameplaySector = levelDescriptor.gameplay;
    const gameplayFile = new DataViewExt(await readFromDiskWithSizeHeader(disk, levelDescriptor.sector + gameplaySector.startSector, 0x3), { littleEndian: true });

    // level/index
    const levelCoreIndex = levelData.subview(levelDataHeader.coreIndex.offset, levelDataHeader.coreIndex.size);
    const levelCoreHeader = await readLevelCoreHeader(levelCoreIndex);

    // level/core
    const levelCoreDataWad = levelData.subview(levelDataHeader.coreData.offset, levelDataHeader.coreData.size);
    assert(levelCoreDataWad.byteLength === levelCoreHeader.assetsCompressedSize);

    // level/chunk_n
    const chunkFiles: { tfragFile: DataViewExt, collisionFile: DataViewExt }[] = [];
    for (let chunkNum = 0; chunkNum < levelDescriptor.chunks.chunks.length; chunkNum++) {
        const chunkSector = levelDescriptor.chunks.chunks[chunkNum];
        if (chunkSector.startSector === 0) continue;
        const chunkBuffer = await readFromDisk(disk, levelDescriptor.sector + chunkSector.startSector, chunkSector.sizeInSectors * SECTOR_SIZE)
        const chunkFile = new DataViewExt(chunkBuffer, { littleEndian: true });
        const chunkHeader = readChunkHeader(chunkFile);
        const tfragFile = chunkFile.subview(chunkHeader.tfrags, WadDecompressor.compressedSize(chunkFile, chunkHeader.tfrags));
        const collisionFile = chunkFile.subview(chunkHeader.collision, WadDecompressor.compressedSize(chunkFile, chunkHeader.collision));
        chunkFiles.push({
            tfragFile,
            collisionFile,
        })
    }

    // write files
    await extractLevelFile(`level_{}_gameplay.wad`, gameplayFile);
    await extractLevelFile(`level_{}_core.wad`, levelCoreDataWad);
    await extractLevelFile(`level_{}_index.bin`, levelCoreIndex);
    await extractLevelFile(`level_{}_gs.bin`, gsRam);
    for (let i = 0; i < chunkFiles.length; i++) {
        await extractLevelFile(`level_{}_${i}_tfrag.wad`, chunkFiles[i].tfragFile);
        await extractLevelFile(`level_{}_${i}_collision.wad`, chunkFiles[i].collisionFile);
    }
    const metaFile = { files, levelDataHeader, levelDescriptor };
    await extractLevelFile(`level_{}.json`, new DataViewExt(encoder.encode(JSON.stringify(metaFile)).buffer, { littleEndian: true }));

    // test parsing everything
    const resources: LevelResources = {
        levelCoreHeader: null,
        gameplayHeader: null,
        gsTable: null,
        levelSettings: null,
        paths: null,
        grindPaths: null,
        directionLights: null,
        pointLights: null,
        collisionGetter: null,
        tfrags: null,
        tfragTextures: null,
        tieTextures: null,
        tieOClasses: null,
        tieClasses: null,
        tieClassTextureIndices: null,
        tieInstances: null,
        tieInstancesByOClass: null,
        tieAmbientRgbas: null,
        mobyTextures: null,
        mobyGsStashList: null,
        mobyOClasses: null,
        mobyClasses: null,
        mobyClassTextureIndices: null,
        mobyInstances: null,
        mobyInstancesByOClass: null,
        shrubTextures: null,
        shrubOClasses: null,
        shrubClasses: null,
        shrubClassTextureIndices: null,
        shrubInstances: null,
        shrubInstancesByOClass: null,
        sky: null,
        skyTextures: null,
    };
    const requiredProperties = Object.fromEntries(Object.entries(resources).map(kv => {
        if (["tieAmbientRgbas"].includes(kv[0])) return [kv[0], false];
        else return [kv[0],true]
    }))
    if (chunkFiles.length) {
        for (let i = 0; i < chunkFiles.length; i++) {
            await load(gn, i, resources, {
                coreDataFilePromise: Promise.resolve(decompress(levelCoreDataWad)),
                gameplayFilePromise: Promise.resolve(decompress(gameplayFile)),
                coreIndexFilePromise: Promise.resolve(levelCoreIndex),
                gsRamFilePromise: Promise.resolve(gsRam),
                chunkTfragFilePromise: Promise.resolve(decompress(chunkFiles[i].tfragFile)),
                chunkCollisionFilePromise: Promise.resolve(decompress(chunkFiles[i].collisionFile))
            });
        }
    } else {
        await load(gn, null, resources, {
            coreDataFilePromise: Promise.resolve(decompress(levelCoreDataWad)),
            gameplayFilePromise: Promise.resolve(decompress(gameplayFile)),
            coreIndexFilePromise: Promise.resolve(levelCoreIndex),
            gsRamFilePromise: Promise.resolve(gsRam),
            chunkTfragFilePromise: null,
            chunkCollisionFilePromise: null
        });
    }

    // assert every key is populated
    for (const [key, required] of Object.entries(requiredProperties)) {
        if (required && !resources[key as keyof typeof resources]) {
            throw new Error(`Level ${levelNum}: ${key} was not populated`);
        }
    }
}

await disk.close();
