#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs, { FileHandle } from "node:fs/promises";
import { readLevelDataHeader, readLevelDescriptor, readTableOfContents } from "../bin-toc.ts";
import { DataViewExt } from "../DataViewExt.ts";
import { readLevelCoreHeader } from "../bin-index.ts";
import { WadDecompressor } from "../decompress.ts";
import { assert } from '../../util.ts';
import { LevelResources, load } from '../loader.ts';

const encoder = new TextEncoder();

const gameNumber = Number(process.argv[2]);

if (gameNumber !== 1) {
    console.error(`Usage: pnpm build:RatchetAndClank <gameNumber>`);
    process.exit(1);
}

const baseDataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), `./data`);

const outputDir = path.join(baseDataDir, `RatchetAndClank${gameNumber}`);
await fs.mkdir(outputDir, { recursive: true });

const diskFile = path.join(baseDataDir, `RatchetAndClank${gameNumber}_raw/game.iso`);
const disk = await fs.open(diskFile);

export const SECTOR_SIZE = 0x800;

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

function decompress(compressed: DataViewExt) {
    const arrayBuffer = (new WadDecompressor(compressed)).decompress();
    return new DataViewExt(arrayBuffer, { littleEndian: true });
}

const ENTRY_POINTS = {
    1: 1500,
};

// read table of contents
const tableOfContentsBuffer = await readFromDiskWithSizeHeader(disk, ENTRY_POINTS[gameNumber], 0x4);
const tableOfContents = await readTableOfContents(new DataViewExt(tableOfContentsBuffer, { littleEndian: true }));
await fs.writeFile(path.join(outputDir, `global.json`), JSON.stringify(tableOfContents));

// read levels
for (const levelSectors of tableOfContents.levelSectors) {
    if (!levelSectors) continue;

    const levelDescriptorBuffer = await readFromDiskWithSizeHeader(disk, levelSectors.startSector, 0x4);
    const levelDescriptor = await readLevelDescriptor(new DataViewExt(levelDescriptorBuffer, { littleEndian: true }));
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
    const levelDataBuffer = await readFromDisk(disk, levelDataSector.startSector, levelDataSector.sizeInSectors * SECTOR_SIZE);
    const levelData = new DataViewExt(levelDataBuffer, { littleEndian: true });
    const levelDataHeader = await readLevelDataHeader(levelData);

    // level/gs
    const gsRam = levelData.subview(levelDataHeader.gsRam.offset, levelDataHeader.gsRam.size);

    // level/gameplay
    const gameplaySector = levelDescriptor.gameplayNtsc;
    const gameplayFile = new DataViewExt(await readFromDiskWithSizeHeader(disk, gameplaySector.startSector, 0x3), { littleEndian: true });

    // level/index
    const levelCoreIndex = levelData.subview(levelDataHeader.coreIndex.offset, levelDataHeader.coreIndex.size);
    const levelCoreHeader = await readLevelCoreHeader(levelCoreIndex);

    // level/core
    const levelCoreDataWad = levelData.subview(levelDataHeader.coreData.offset, levelDataHeader.coreData.size);
    assert(levelCoreDataWad.byteLength === levelCoreHeader.assetsCompressedSize);

    // write files
    await extractLevelFile(`level_{}_gameplay.wad`, gameplayFile);
    await extractLevelFile(`level_{}_core.wad`, levelCoreDataWad);
    await extractLevelFile(`level_{}_index.bin`, levelCoreIndex);
    await extractLevelFile(`level_{}_gs.bin`, gsRam);
    const metaFile = { files, levelDataHeader, levelDescriptor };
    await extractLevelFile(`level_{}.json`, new DataViewExt(encoder.encode(JSON.stringify(metaFile)).buffer, { littleEndian: true }));

    // test parsing everything
    const resources: LevelResources = {
        levelCoreHeader: null,
        gameplayHeader: null,
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
        shrubTextures: null,
        shrubOClasses: null,
        shrubClasses: null,
        shrubClassTextureIndices: null,
        shrubInstances: null,
        shrubInstancesByOClass: null,
        sky: null,
        skyTextures: null,
        mobyInstances: null,
    };
    await load(resources, {
        coreDataFilePromise: Promise.resolve(decompress(levelCoreDataWad)),
        gameplayFilePromise: Promise.resolve(decompress(gameplayFile)),
        coreIndexFilePromise: Promise.resolve(levelCoreIndex),
        gsRamFilePromise: Promise.resolve(gsRam),
    });

    // assert every key is populated
    for (const [key, value] of Object.entries(resources)) {
        if (value === null) {
            throw new Error(`Level ${levelNum}: ${key} was not populated`);
        }
    }
}

await disk.close();
