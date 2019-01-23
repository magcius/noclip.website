
import ArrayBufferSlice from "../../ArrayBufferSlice";
import * as BHD5 from "../bhd5";
import * as MSB from "../msb";
import * as BYML from "../../byml";
import { readFileSync, openSync, readSync, closeSync, fstat, writeFileSync } from "fs";

// Standalone tool designed for node to extract data.

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

function fetchDataFragmentSync(path: string, byteOffset: number, byteLength: number): ArrayBufferSlice {
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(byteLength);
    readSync(fd, b, 0, byteLength, byteOffset);
    closeSync(fd);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBase = `../../../data/dks`;
const pathBaseIn = `${pathBase}/raw`;
const pathBaseOut = `${pathBase}`;

function hashString(str: string): number {
    let h: number = 0;
    str = str.toLowerCase();
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h = ((37*h + c) & 0xFFFFFFFF) >>> 0;
    }
    return h;
}

class ResourceSystem {
    public hashToRecord = new Map<number, BHD5.FileRecord>();
    public hashToDataFilename = new Map<number, string>();

    public mountBHD5(bhd5: BHD5.BHD5, dataFilename: string): void {
        const records = bhd5.fileRecords;
        for (let i = 0; i < records.length; i++) {
            this.hashToRecord.set(records[i].nameHash, records[i]);
            this.hashToDataFilename.set(records[i].nameHash, dataFilename);
        }
    }

    public fileExists(filename: string): boolean {
        const nameHash = hashString(filename);
        return this.hashToRecord.has(nameHash);
    }

    public fetchDataFromFilename(filename: string): ArrayBufferSlice {
        const nameHash = hashString(filename);
        const record = this.hashToRecord.get(nameHash);
        const dataFilename = this.hashToDataFilename.get(nameHash);
        return fetchDataFragmentSync(dataFilename, record.byteOffset, record.byteSize);
    }
}

function pushFile(filenames: Set<string>, r: ResourceSystem, f: string): void {
    if (r.fileExists(f))
        filenames.add(f);
    else
        console.warn("Missing file", f);
}

function gatherMapArchive(filenames: Set<string>, r: ResourceSystem, mapID: string): void {
    const mapFilename = `/map/MapStudio/${mapID}.msb`;
    pushFile(filenames, r, mapFilename);

    // Map textures.
    const mapKey = mapID.slice(0, 3); // "m10"
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_0000.tpfbhd`);
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_0000.tpfbdt`);
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_0001.tpfbhd`);
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_0001.tpfbdt`);
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_0002.tpfbhd`);
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_0002.tpfbdt`);
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_0003.tpfbhd`);
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_0003.tpfbdt`);
    pushFile(filenames, r, `/map/${mapKey}/${mapKey}_9999.tpf.dcx`);

    const msb = MSB.parse(r.fetchDataFromFilename(mapFilename), mapID);
    for (let i = 0; i < msb.models.length; i++)
        if (msb.models[i].type === 0x00)
            pushFile(filenames, r, msb.models[i].flverPath);
}

function buildMapCRG1(r: ResourceSystem, mapID: string, mapFilenames: Set<string>): ArrayBuffer {
    const files: { [k: string]: ArrayBufferSlice } = {};

    const sortedFilenames = [...mapFilenames.keys()];

    for (let i = 0; i < sortedFilenames.length; i++)
        files[sortedFilenames[i]] = r.fetchDataFromFilename(sortedFilenames[i]);

    const arc = {
        MapID: mapID,
        Files: files,
    };

    return BYML.write(arc, BYML.FileType.CRG1);
}

function extractMap(r: ResourceSystem, mapID: string): void {
    const filenames = new Set<string>();
    console.log("Gathering");
    gatherMapArchive(filenames, r, mapID);
    console.log("Building");
    const data = buildMapCRG1(r, mapID, filenames);
    console.log("Writing");
    writeFileSync(`${pathBaseOut}/${mapID}_arc.crg1`, Buffer.from(data));
    console.log("Done", mapID);
}

function mountBHD5(r: ResourceSystem, archiveName: string): void {
    const recordsBuffer = fetchDataSync(`${pathBaseIn}/${archiveName}.bhd5`);
    const dataFilename = `${pathBaseIn}/${archiveName}.bdt`;
    const bhd5 = BHD5.parse(recordsBuffer);
    r.mountBHD5(bhd5, dataFilename);
}

function main() {
    const r = new ResourceSystem();
    mountBHD5(r, 'dvdbnd0');
    mountBHD5(r, 'dvdbnd1');

    extractMap(r, 'm10_01_00_00'); // Undead Burg / Parish
    extractMap(r, 'm10_00_00_00'); // The Depths
    extractMap(r, 'm10_02_00_00'); // Firelink Shrine
    extractMap(r, 'm11_00_00_00'); // Painted World
    extractMap(r, 'm12_00_00_00'); // Darkroot Forest
    extractMap(r, 'm12_00_00_01'); // Darkroot Basin
    extractMap(r, 'm12_01_00_00'); // Royal Wood
    extractMap(r, 'm13_00_00_00'); // The Catacombs
    extractMap(r, 'm13_01_00_00'); // Tomb of the Giants
    extractMap(r, 'm13_02_00_00'); // Ash Lake
    extractMap(r, 'm14_00_00_00'); // Blighttown
    extractMap(r, 'm14_01_00_00'); // Demon Ruins
    extractMap(r, 'm15_00_00_00'); // Sen's Fortress
    extractMap(r, 'm15_01_00_00'); // Anor Londo
    extractMap(r, 'm16_00_00_00'); // New Londo Ruins
    extractMap(r, 'm17_00_00_00'); // Duke's Archives / Crystal Caves
    extractMap(r, 'm18_00_00_00'); // Kiln of the First Flame
    extractMap(r, 'm18_01_00_00'); // Undead Asylum
}

main();
