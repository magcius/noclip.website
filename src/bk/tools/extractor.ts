
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, hexdump } from "../../util";
import * as Pako from 'pako';
import * as BYML from "../../byml";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/bk_raw`;
const pathBaseOut = `../../../data/bk`;

interface FSFile {
    fileTableOffs: number;
    dataOffs: number;
    flags: number;
}

interface FS {
    buffer: ArrayBufferSlice;
    files: FSFile[];
}

function getFileSize(fs: FS, file: FSFile): number {
    const fileIndex = fs.files.indexOf(file);
    for (let i = fileIndex; i < fs.files.length; i++)
        if (fs.files[i].dataOffs > file.dataOffs)
            return fs.files[i].dataOffs - file.dataOffs;
    return -1;
}

function getFileBuffer(fs: FS, file: FSFile): ArrayBufferSlice {
    const fileSize = getFileSize(fs, file);
    if (fileSize >= 0)
        return fs.buffer.subarray(file.dataOffs, fileSize);
    else
        return fs.buffer.subarray(file.dataOffs);
}

function getFileOffsetIndex(fs: FS, offset: number): FSFile | null {
    return fs.files.find((f) => f.fileTableOffs === offset) || null;
}

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const view = buffer.createDataView();

    assert(view.getUint16(0x00) === 0x1172);
    const decompressedFileSize = view.getUint32(0x02);

    let srcOffs = 0x06;
    const decompressed = Pako.inflateRaw(buffer.createTypedArray(Uint8Array, srcOffs, decompressedFileSize), { raw: true });
    return new ArrayBufferSlice(decompressed.buffer as ArrayBuffer);
}

interface CRG1File {
    Data: ArrayBufferSlice;
}

function extractFile(fileTable: CRG1File[], fs: FS, fsfile: FSFile): number {
    if (fsfile === null)
        return -1;

    const index = fileTable.length;
    const buffer = decompress(getFileBuffer(fs, fsfile));
    fileTable.push({ Data: buffer });
    return index;
}

function extractMap(fs: FS, name: string, sceneID: number): void {
    const fileTable: CRG1File[] = [];

    const crg1 = {
        Name: name,
        SceneID: sceneID,
        SetupFileId: -1,
        Files: fileTable,

        // Geometry
        OpaGeoFileId: -1,
        XluGeoFileId: -1,

        // Skybox
        OpaSkyboxFileId: -1,
        OpaSkyboxScale: 1,
        XluSkyboxFileId: -1,
        XluSkyboxScale: 1,
    };

    crg1.SetupFileId = extractFile(fileTable, fs, fs.files[sceneID + 0x71c]);

    const f9cae0 = decompress(fs.buffer.slice(0xF9CAE0));
    const f9cae0View = f9cae0.createDataView();

    for (let i = 0x7650; i < 0x8250; i += 0x18) {
        const sceneTableID  = f9cae0View.getUint16(i + 0x00);
        if (sceneTableID === sceneID) {
            const opaId = f9cae0View.getUint16(i + 0x02);
            const xluId = f9cae0View.getUint16(i + 0x04);

            crg1.OpaGeoFileId = extractFile(fileTable, fs, opaId > 0 ? fs.files[opaId] : null);
            crg1.XluGeoFileId = extractFile(fileTable, fs, xluId > 0 ? fs.files[xluId] : null);
            break;
        }
    }

    for (let i = 0x87B0; i < 0x8BA0; i += 0x28) {
        const skyboxTableSceneID  = f9cae0View.getUint16(i + 0x00);
        if (skyboxTableSceneID === sceneID) {
            const opaSkyboxId    = f9cae0View.getUint16(i + 0x04);
            const opaSkyboxScale = f9cae0View.getFloat32(i + 0x08);
            const xluSkyboxId    = f9cae0View.getUint16(i + 0x10);
            const xluSkyboxScale = f9cae0View.getFloat32(i + 0x14);

            crg1.OpaSkyboxFileId = extractFile(fileTable, fs, opaSkyboxId > 0 ? fs.files[opaSkyboxId] : null);
            crg1.OpaSkyboxScale = opaSkyboxScale;
            crg1.XluSkyboxFileId = extractFile(fileTable, fs, xluSkyboxId > 0 ? fs.files[xluSkyboxId] : null);
            crg1.XluSkyboxScale = xluSkyboxScale;
            break;
        }
    }

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${hexzero(sceneID, 2).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);
    const view = romData.createDataView();

    const files: FSFile[] = [];
    for (let fsTableIdx = 0x5E98; fsTableIdx < 0x10CD0; fsTableIdx += 0x08) {
        const ptr = view.getUint32(fsTableIdx + 0x00);
        const flags = view.getUint32(fsTableIdx + 0x04);
        const dataOffs = 0x10CD0 + ptr;
        files.push({ fileTableOffs: fsTableIdx, dataOffs, flags });
    }
    const fs = { buffer: romData, files };

    // Names taken from Banjo's Backpack.
    extractMap(fs, "SM - Spiral Mountain",                0x01);
    extractMap(fs, "SM - Banjo's House",                  0x8C);
    extractMap(fs, "MM - Mumbo's Mountain",               0x02);
    extractMap(fs, "MM - Ticker's Tower",                 0x0C);
    extractMap(fs, "MM - Mumbo's Skull",                  0x0E);
    extractMap(fs, "TTC - Treasure Trove Cove",           0x07);
    extractMap(fs, "TTC - Blubber's Ship",                0x05);
    extractMap(fs, "TTC - Nipper's Shell",                0x06);
    extractMap(fs, "TTC - Sandcastle",                    0x0A);
    extractMap(fs, "TTC - Sharkfood Island",              0x8F);
    extractMap(fs, "CC - Clanker's Cavern",               0x0B);
    extractMap(fs, "CC - Inside Clanker",                 0x22);
    extractMap(fs, "CC - Inside Clanker - Witch Switch",  0x21);
    extractMap(fs, "CC - Inside Clanker - Gold Feathers", 0x23);
    extractMap(fs, "BGS - Bubblegloop Swamp",             0x0D);
    extractMap(fs, "BGS - Mr. Vile",                      0x10);
    extractMap(fs, "BGS - TipTup Chior",                  0x11);
    extractMap(fs, "BGS - Mumbo's Skull",                 0x47);
    extractMap(fs, "FP - Freezeezy Peak",                 0x27);
    extractMap(fs, "FP - Boggy's Igloo",                  0x41);
    extractMap(fs, "FP - Mumbo's Skull",                  0x48);
    extractMap(fs, "FP - Christmas Tree",                 0x53);
    extractMap(fs, "FP - Wozza's Cave",                   0x7F);
    extractMap(fs, "GV - Gobi's Valley",                  0x12);
    extractMap(fs, "GV - Puzzle Room",                    0x13);
    extractMap(fs, "GV - King Sandybutt's Tomb",          0x14);
    extractMap(fs, "GV - Water Room",                     0x15);
    extractMap(fs, "GV - Rupee",                          0x16);
    extractMap(fs, "GV - Jinxy",                          0x1A);
    extractMap(fs, "GV - Secret Blue Egg",                0x92);
    extractMap(fs, "MMM - Mad Monster Mansion",           0x1B);
    extractMap(fs, "MMM - Septic Tank",                   0x8D);
    extractMap(fs, "MMM - Church",                        0x1C);
    extractMap(fs, "MMM - Cellar",                        0x1D);
    extractMap(fs, "MMM - Tumblar's Shed",                0x24);
    extractMap(fs, "MMM - Well",                          0x25);
    extractMap(fs, "MMM - Dining Room",                   0x26);
    extractMap(fs, "MMM - Egg Room",                      0x28);
    extractMap(fs, "MMM - Note Room",                     0x29);
    extractMap(fs, "MMM - Feather Room",                  0x2A);
    extractMap(fs, "MMM - Secret Church Room",            0x2B);
    extractMap(fs, "MMM - Bathroom",                      0x2C);
    extractMap(fs, "MMM - Bedroom",                       0x2D);
    extractMap(fs, "MMM - Gold Feather Room",             0x2E);
    extractMap(fs, "MMM - Drainpipe",                     0x2F);
    extractMap(fs, "MMM - Mumbo's Hut",                   0x30);
    extractMap(fs, "RBB - Rusty Bucket Bay",              0x31);
    extractMap(fs, "RBB - Anchor Room",                   0x8B);
    extractMap(fs, "RBB - Machine Room",                  0x34);
    extractMap(fs, "RBB - Big Fish Warehouse",            0x35);
    extractMap(fs, "RBB - Boat Room",                     0x36);
    extractMap(fs, "RBB - First Blue Container",          0x37);
    extractMap(fs, "RBB - Third Blue Container",          0x38);
    extractMap(fs, "RBB - Sea-Grublin's Cabin",           0x39);
    extractMap(fs, "RBB - Kaboom's Room",                 0x3A);
    extractMap(fs, "RBB - Mini Kaboom's Room",            0x3B);
    extractMap(fs, "RBB - Kitchen",                       0x3C);
    extractMap(fs, "RBB - Navigation Room",               0x3D);
    extractMap(fs, "RBB - Second Blue Container",         0x3E);
    extractMap(fs, "RBB - Captain's Room",                0x3F);
    extractMap(fs, "CCW - Click Clock Wood",              0x40);
    extractMap(fs, "CCW - Spring",                        0x43);
    extractMap(fs, "CCW - Summer",                        0x44);
    extractMap(fs, "CCW - Fall",                          0x45);
    extractMap(fs, "CCW - Winter",                        0x46);
    extractMap(fs, "CCW - Mumbo - Spring",                0x4A);
    extractMap(fs, "CCW - Mumbo - Summer",                0x4B);
    extractMap(fs, "CCW - Mumbo - Fall",                  0x4C);
    extractMap(fs, "CCW - Mumbo - Winter",                0x4D);
    extractMap(fs, "CCW - Beehive - Summer",              0x5A);
    extractMap(fs, "CCW - Beehive - Spring",              0x5B);
    extractMap(fs, "CCW - Beehive - Fall",                0x5C);
    extractMap(fs, "CCW - Nabnuts House - Spring",        0x5E);
    extractMap(fs, "CCW - Nabnuts House - Summer",        0x5F);
    extractMap(fs, "CCW - Nabnuts House - Fall",          0x60);
    extractMap(fs, "CCW - Nabnuts House - Winter",        0x61);
    extractMap(fs, "CCW - Nabnut's Attic - Winter",       0x62);
    extractMap(fs, "CCW - Nabnut's Attic - Fall",         0x63);
    extractMap(fs, "CCW - Nabnut's Attic 2 - Winter",     0x64);
    extractMap(fs, "CCW - Whipcrack Room - Spring",       0x65);
    extractMap(fs, "CCW - Whipcrack Room - Summer",       0x66);
    extractMap(fs, "CCW - Whipcrack Room - Fall",         0x67);
    extractMap(fs, "CCW - Whipcrack Room - Winter",       0x68);
    extractMap(fs, "GL - Floor 1",                        0x69);
    extractMap(fs, "GL - Floor 2",                        0x6A);
    extractMap(fs, "GL - Floor 3",                        0x6B);
    extractMap(fs, "GL - Floor 4",                        0x71);
    extractMap(fs, "GL - Floor 5",                        0x6E);
    extractMap(fs, "GL - Floor 6 FP Entrance",            0x6F);
    extractMap(fs, "GL - Floor 7",                        0x79);
    extractMap(fs, "GL - Floor 8",                        0x93);
    extractMap(fs, "GL - Pipe Room",                      0x6C);
    extractMap(fs, "GL - TTC Entrance",                   0x6D);
    extractMap(fs, "GL - CC Entrance",                    0x70);
    extractMap(fs, "GL - BGS Entrance",                   0x72);
    extractMap(fs, "GL - Lava Room",                      0x74);
    extractMap(fs, "GL - MMM Entrance",                   0x75);
    extractMap(fs, "GL - Floor 6 Water Switch Area",      0x76);
    extractMap(fs, "GL - RBB Entrance",                   0x77);
    extractMap(fs, "GL - MMM Puzzle",                     0x78);
    extractMap(fs, "GL - Coffin Room",                    0x7A);
    extractMap(fs, "GL - Path to Quiz show",              0x80);
    extractMap(fs, "GL - Furnace Fun",                    0x8E);
    extractMap(fs, "GL - Boss",                           0x90);
}

main();
