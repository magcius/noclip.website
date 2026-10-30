#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from "node:fs/promises";
import { DiskFns, ENTRY_POINTS, readChunkHeader, readLevelDataHeader, readLevelDescriptor, readTableOfContents_Rac1, readTableOfContents_Rac234, SECTOR_SIZE, TableOfContents, TOC_MAX_SIZE } from "../bin-toc.ts";
import { DataViewExt } from "../DataViewExt.ts";
import { readLevelCoreHeader } from "../bin-index.ts";
import { WadDecompressor } from "../decompress.ts";
import { assert } from '../../util.ts';
import { LevelResources, load } from '../loader.ts';
import { GN } from '../utils.ts';

const encoder = new TextEncoder();

const gn = Number(process.argv[2]) as GN;

if (isNaN(gn) || gn < 1 || gn > 4) {
    console.error(`Usage: pnpm build:RatchetAndClank <gameNumber>`);
    process.exit(1);
}

const baseDataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), `../../../data`);

const outputDir = path.join(baseDataDir, `RatchetAndClank${gn}`);
await fs.mkdir(outputDir, { recursive: true });

const diskFile = path.join(baseDataDir, `RatchetAndClank${gn}_raw/game.iso`);
const disk = await fs.open(diskFile);

const diskFns: DiskFns = {
    async readBytes(startSector: number, byteLength: number) {
        const dest = new Uint8Array(byteLength);
        await disk.read(dest, 0, byteLength, startSector * SECTOR_SIZE);
        return dest.buffer;
    },
    async readWithSizeHeader(startSector: number, sizeOffset: number) {
        const header = await this.readBytes(startSector, sizeOffset + 0x4);
        const byteLength = new DataViewExt(header, { littleEndian: true }, sizeOffset).getInt32(0);
        return this.readBytes(startSector, byteLength);
    }
};

function decompress(compressed: DataViewExt) {
    const arrayBuffer = (new WadDecompressor(compressed)).decompress();
    return new DataViewExt(arrayBuffer, { littleEndian: true });
}

// read table of contents
let tableOfContents: TableOfContents;
if (gn === 1) {
    const tableOfContentsBuffer = await diskFns.readWithSizeHeader(ENTRY_POINTS[gn], 0x4);
    tableOfContents = await readTableOfContents_Rac1(new DataViewExt(tableOfContentsBuffer, { littleEndian: true }));
} else {
    const tableOfContentsBuffer = await diskFns.readBytes(ENTRY_POINTS[gn], TOC_MAX_SIZE);
    tableOfContents = await readTableOfContents_Rac234(gn, diskFns, new DataViewExt(tableOfContentsBuffer, { littleEndian: true }));
}
await fs.writeFile(path.join(outputDir, `global.json`), JSON.stringify(tableOfContents));

// rac1 title scene
if (tableOfContents.title) {
    const titleBuffer = await diskFns.readBytes(tableOfContents.title.startSector, tableOfContents.title.sizeInSectors * SECTOR_SIZE);
    const titleFile = new DataViewExt(titleBuffer, { littleEndian: true });
    const compressedSize = WadDecompressor.compressedSize(titleFile);
    const compressedTitleFile = titleFile.subview(0, compressedSize);
    decompress(compressedTitleFile);
    await fs.writeFile(path.join(outputDir, `level_title.wad`), new Uint8Array(titleBuffer, 0, compressedSize));
}

// read levels
for (const levelSectors of tableOfContents.levelSectors) {
    if (!levelSectors) continue;

    const levelDescriptorSizeOffset = gn === 1 ? 0x4 : 0x0;
    const levelDescriptorBuffer = await diskFns.readWithSizeHeader(levelSectors.startSector, levelDescriptorSizeOffset);
    const levelDescriptor = readLevelDescriptor(gn, new DataViewExt(levelDescriptorBuffer, { littleEndian: true }));
    if (!levelDescriptor) continue;

    const levelNum = levelDescriptor.id;

    const files: { name: string, compressed: boolean, size: number, decompressedSize: number }[] = [];
    async function extractLevelFile(name: string, buf: DataViewExt) {
        const filename = name.replace(/\{\}/g, String(levelNum));
        await fs.writeFile(path.join(outputDir, filename), buf);
        console.log(`Writing file ${filename}`);
        const compressed = name.endsWith('.wad');
        const decompressedSize = compressed ? decompress(buf).byteLength : 0;
        files.push({ name: filename, compressed, size: buf.byteLength, decompressedSize });
    }

    // entire level range
    const levelDataSector = levelDescriptor.data;
    const levelDataBuffer = await diskFns.readBytes(levelDescriptor.sector + levelDataSector.startSector, levelDataSector.sizeInSectors * SECTOR_SIZE);
    const levelData = new DataViewExt(levelDataBuffer, { littleEndian: true });
    const levelDataHeader = readLevelDataHeader(gn, levelData);

    // level_n_gs
    const gsRam = levelData.subview(levelDataHeader.gsRam.offset, levelDataHeader.gsRam.size);

    // level_n_gameplay
    const gameplaySector = levelDescriptor.gameplay;
    const gameplayFile = new DataViewExt(await diskFns.readWithSizeHeader(levelDescriptor.sector + gameplaySector.startSector, 0x3), { littleEndian: true });

    // level_n_gameplay_art
    const artSector = levelDescriptor.art
    let artInstancesFile: DataViewExt | null = null;
    if (artSector) {
        artInstancesFile = new DataViewExt(await diskFns.readWithSizeHeader(levelDescriptor.sector + artSector.startSector, 0x3), { littleEndian: true });
    }

    // level_n_gameplay_mission_n
    const missions: { missionNumber: number, missionGameplayFile: DataViewExt, missionDataFile: DataViewExt }[] = [];
    if (levelDescriptor.missions) {
        for (let i = 0; i < 128; i++) {
            if (levelDescriptor.missions.gameplay[i].startSector) {
                // we only care about the gameplay file
                // the data file seems to be a compressed copy of the gameplay file (???), and audio is not used
                const missionGameplaySectors = levelDescriptor.missions.gameplay[i];
                const missionGameplayFile = new DataViewExt(await diskFns.readBytes(levelDescriptor.sector + missionGameplaySectors.startSector, missionGameplaySectors.sizeInSectors * SECTOR_SIZE), { littleEndian: true });
                const missionDataSectors = levelDescriptor.missions.data[i];
                const missionDataFile = new DataViewExt(await diskFns.readBytes(levelDescriptor.sector + missionDataSectors.startSector, missionDataSectors.sizeInSectors * SECTOR_SIZE), { littleEndian: true });
                missions.push({ missionNumber: i, missionGameplayFile, missionDataFile });
            }
        }
    }

    // level_n_index
    const levelCoreIndex = levelData.subview(levelDataHeader.coreIndex.offset, levelDataHeader.coreIndex.size);
    const levelCoreHeader = await readLevelCoreHeader(levelCoreIndex);

    // level_n_core
    const levelCoreDataWad = levelData.subview(levelDataHeader.coreData.offset, levelDataHeader.coreData.size);
    assert(levelCoreDataWad.byteLength === levelCoreHeader.assetsCompressedSize);

    // level_n_overlay
    const levelOverlayFile = levelData.subview(levelDataHeader.overlay.offset, levelDataHeader.overlay.size);

    // level_n_n_tfrag and level_n_n_collision
    const chunkFiles: { tfragFile: DataViewExt, collisionFile: DataViewExt }[] = [];
    for (let chunkNum = 0; chunkNum < levelDescriptor.chunks.chunks.length; chunkNum++) {
        const chunkSector = levelDescriptor.chunks.chunks[chunkNum];
        if (chunkSector.startSector === 0) continue;
        const chunkBuffer = await diskFns.readBytes(levelDescriptor.sector + chunkSector.startSector, chunkSector.sizeInSectors * SECTOR_SIZE)
        const chunkFile = new DataViewExt(chunkBuffer, { littleEndian: true });
        const chunkHeader = readChunkHeader(chunkFile);
        const tfragFile = chunkFile.subview(chunkHeader.tfrags, WadDecompressor.compressedSize(chunkFile, chunkHeader.tfrags));
        const collisionFile = chunkFile.subview(chunkHeader.collision, WadDecompressor.compressedSize(chunkFile, chunkHeader.collision));
        chunkFiles.push({
            tfragFile,
            collisionFile,
        });
    }

    // write files
    await extractLevelFile(`level_{}_gameplay.wad`, gameplayFile);
    if (artInstancesFile) await extractLevelFile(`level_{}_gameplay_art.wad`, artInstancesFile);
    for (let i = 0; i < missions.length; i++) {
        await extractLevelFile(`level_{}_mission_${missions[i].missionNumber}_gameplay.bin`, missions[i].missionGameplayFile);
        await extractLevelFile(`level_{}_mission_${missions[i].missionNumber}_data.bin`, missions[i].missionDataFile);
    }
    await extractLevelFile(`level_{}_core.wad`, levelCoreDataWad);
    await extractLevelFile(`level_{}_index.bin`, levelCoreIndex);
    await extractLevelFile(`level_{}_gs.bin`, gsRam);
    await extractLevelFile(`level_{}_overlay.bin`, levelOverlayFile);
    for (let i = 0; i < chunkFiles.length; i++) {
        await extractLevelFile(`level_{}_${i}_tfrag.wad`, chunkFiles[i].tfragFile);
        await extractLevelFile(`level_{}_${i}_collision.wad`, chunkFiles[i].collisionFile);
    }
    const metaFile = { files, levelDataHeader, levelDescriptor };
    await extractLevelFile(`level_{}.json`, new DataViewExt(encoder.encode(JSON.stringify(metaFile)).buffer, { littleEndian: true }));

    async function test(chunkNumber: number | null, missionNumber: number | null) {
        // test parsing everything
        const resources: LevelResources = {
            metadata: null,
            levelCoreHeader: null,
            gameplayHeader: null,
            missionGameplayHeader: null,
            overlaySections: null,
            gsTable: null,
            levelSettings: null,
            occlusion: null,
            occlusionMappings: null,
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
            tieGroups: null,
            tieAmbientRgbas: null,
            mobyTextures: null,
            mobyGsStashList: null,
            mobyOClasses: null,
            mobyClasses: null,
            mobyClassTextureIndices: null,
            mobyInstances: null,
            mobyInstancesByOClass: null,
            mobyGroups: null,
            mobyUniqueMissionIds: null,
            pvars: null,
            missionMobyOClasses: null,
            missionMobyInstances: null,
            missionMobyInstancesByOClass: null,
            missionMobyGroups: null,
            shrubTextures: null,
            shrubOClasses: null,
            shrubClasses: null,
            shrubClassTextureIndices: null,
            shrubInstances: null,
            shrubInstancesByOClass: null,
            shrubGroups: null,
            sky: null,
            skyTextures: null,
            fxTextures: null,
        };

        const testMission = missions.find(m => m.missionNumber === missionNumber) ?? null;
        await load(gn, levelNum, chunkNumber, resources, {
            metadataFilePromise: Promise.resolve(metaFile),
            coreDataFilePromise: Promise.resolve(decompress(levelCoreDataWad)),
            gameplayFilePromise: Promise.resolve(decompress(gameplayFile)),
            gameplayArtFilePromise: artInstancesFile ? Promise.resolve(decompress(artInstancesFile)) : null,
            gameplayMissionFilePromise: testMission ? Promise.resolve(testMission.missionGameplayFile) : null,
            coreIndexFilePromise: Promise.resolve(levelCoreIndex),
            overlayFilePromise: Promise.resolve(levelOverlayFile),
            gsRamFilePromise: Promise.resolve(gsRam),
            chunkTfragFilePromise: chunkNumber !== null ? Promise.resolve(decompress(chunkFiles[chunkNumber].tfragFile)) : null,
            chunkCollisionFilePromise: chunkNumber !== null ? Promise.resolve(decompress(chunkFiles[chunkNumber].collisionFile)) : null
        });
        console.log("validated level", levelNum, "chunk", chunkNumber, "mission", missionNumber);

        // assert every key is populated
        for (const key of Object.keys(resources)) {
            if (gn === 1 && key === "tieAmbientRgbas") continue; // not in rac1
            if (gn === 1 && (key === "tieGroups" || key === "shrubGroups")) continue; // not in rac1
            if (missionNumber === null && key.startsWith("mission")) continue; // no mission
            if (key === "occlusion" || key === "occlusionMappings") continue; // occlusion is optional
            if (!resources[key as keyof typeof resources]) {
                throw new Error(`Level ${levelNum}: ${key} was not populated`);
            }
        }
    }

    const testChunks = chunkFiles.length ? chunkFiles.map((chunk, i) => i) : [null];
    const testMissions = missions.length ? missions.map(mission => mission.missionNumber) : [null];
    for (let i = 0; i < testChunks.length; i++) {
        for (let j = 0; j < testMissions.length; j++) {
            await test(testChunks[i], testMissions[j]);
        }
    }
}

await disk.close();
