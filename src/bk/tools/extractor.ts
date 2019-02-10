
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

function extractMap(fs: FS, name: string, sceneID: number, pointer: number, fileOpaque: number, fileAlpha: number): void {
    const fileTable: CRG1File[] = [];

    const crg1 = {
        Name: name,
        SceneID: sceneID,
        Pointer: pointer,
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

    crg1.OpaGeoFileId = extractFile(fileTable, fs, getFileOffsetIndex(fs, fileOpaque));
    crg1.XluGeoFileId = extractFile(fileTable, fs, getFileOffsetIndex(fs, fileAlpha));

    const f9cae0 = decompress(fs.buffer.slice(0xF9CAE0));
    const f9cae0View = f9cae0.createDataView();
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
    extractMap(fs, "SM - Spiral Mountain",                0x01, 0x9780, 0x010510, 0x010518);
    extractMap(fs, "SM - Banjo's House",                  0x8C, 0x9BD8, 0x0103A8, 0x0103B8);
    extractMap(fs, "MM - Mumbo's Mountain",               0x02, 0x9788, 0x0103E8, 0x0103F0);
    extractMap(fs, "MM - Ticker's Tower",                 0x0C, 0x97D8, 0x0103F8, 0x010400);
    extractMap(fs, "MM - Mumbo's Skull",                  0x0E, 0x97E8, 0x010408, 0x00);
    extractMap(fs, "TTC - Treasure Trove Cove",           0x07, 0x97B0, 0x0101F0, 0x0101F8);
    extractMap(fs, "TTC - Blubber's Ship",                0x05, 0x97A0, 0x010210, 0x010218);
    extractMap(fs, "TTC - Nipper's Shell",                0x06, 0x97A8, 0x010200, 0x010208);
    extractMap(fs, "TTC - Sandcastle",                    0x0A, 0x97C8, 0x010220, 0x010228);
    extractMap(fs, "TTC - Sharkfood Island",              0x8F, 0x9BF0, 0x010230, 0x00);
    extractMap(fs, "CC - Clanker's Cavern",               0x0B, 0x97D0, 0x010600, 0x010608);
    extractMap(fs, "CC - Inside Clanker",                 0x22, 0x9888, 0x010618, 0x010620);
    extractMap(fs, "CC - Inside Clanker - Witch Switch",  0x21, 0x9880, 0x010610, 0x00);
    extractMap(fs, "CC - Inside Clanker - Gold Feathers", 0x23, 0x9890, 0x010628, 0x00);
    extractMap(fs, "BGS - Bubblegloop Swamp",             0x0D, 0x97E0, 0x010520, 0x010528);
    extractMap(fs, "BGS - Mr. Vile",                      0x10, 0x97F8, 0x010530, 0x00);
    extractMap(fs, "BGS - TipTup Chior",                  0x11, 0x9800, 0x010538, 0x010540);
    extractMap(fs, "BGS - Mumbo's Skull",                 0x47, 0x99B0, 0x010408, 0x00);
    extractMap(fs, "FP - Freezeezy Peak",                 0x27, 0x98B0, 0x0104D8, 0x0104E0);
    extractMap(fs, "FP - Boggy's Igloo",                  0x41, 0x9980, 0x0104E8, 0x010508);
    extractMap(fs, "FP - Mumbo's Skull",                  0x48, 0x99B8, 0x010408, 0x00);
    extractMap(fs, "FP - Christmas Tree",                 0x53, 0x9A10, 0x0104F0, 0x00);
    extractMap(fs, "FP - Wozza's Cave",                   0x7F, 0x9B70, 0x0104F8, 0x010500);
    extractMap(fs, "GV - Gobi's Valley",                  0x12, 0x9808, 0x010238, 0x010240);
    extractMap(fs, "GV - Puzzle Room",                    0x13, 0x9810, 0x010248, 0x00);
    extractMap(fs, "GV - King Sandybutt's Tomb",          0x14, 0x9818, 0x010258, 0x010260);
    extractMap(fs, "GV - Water Room",                     0x15, 0x9820, 0x010268, 0x010270);
    extractMap(fs, "GV - Rupee",                          0x16, 0x9828, 0x010278, 0x00);
    extractMap(fs, "GV - Jinxy",                          0x1A, 0x9848, 0x010280, 0x00);
    extractMap(fs, "GV - Secret Blue Egg",                0x92, 0x9C08, 0x010288, 0x00);
    extractMap(fs, "MMM - Mad Monster Mansion",           0x1B, 0x9850, 0x010290, 0x010298);
    extractMap(fs, "MMM - Septic Tank",                   0x8D, 0x9BE0, 0x010358, 0x010360);
    extractMap(fs, "MMM - Church",                        0x1C, 0x9858, 0x0102C8, 0x0102D0);
    extractMap(fs, "MMM - Cellar",                        0x1D, 0x9860, 0x0102A8, 0x010370);
    extractMap(fs, "MMM - Tumblar's Shed",                0x24, 0x9898, 0x0102D8, 0x00);
    extractMap(fs, "MMM - Well",                          0x25, 0x98A0, 0x010340, 0x010348);
    extractMap(fs, "MMM - Dining Room",                   0x26, 0x98A8, 0x0102C0, 0x010368);
    extractMap(fs, "MMM - Egg Room",                      0x28, 0x98B8, 0x0102E0, 0x0102E8);
    extractMap(fs, "MMM - Note Room",                     0x29, 0x98C0, 0x0102F0, 0x0102F8);
    extractMap(fs, "MMM - Feather Room",                  0x2A, 0x98C8, 0x010300, 0x010308);
    extractMap(fs, "MMM - Secret Church Room",            0x2B, 0x98D0, 0x0102B0, 0x0102B8);
    extractMap(fs, "MMM - Bathroom",                      0x2C, 0x98D8, 0x010310, 0x010318);
    extractMap(fs, "MMM - Bedroom",                       0x2D, 0x98E0, 0x010320, 0x010328);
    extractMap(fs, "MMM - Gold Feather Room",             0x2E, 0x98E8, 0x010330, 0x010338);
    extractMap(fs, "MMM - Drainpipe",                     0x2F, 0x98F0, 0x0102A0, 0x010350);
    extractMap(fs, "MMM - Mumbo's Hut",                   0x30, 0x98F8, 0x010408, 0x00);
    extractMap(fs, "RBB - Rusty Bucket Bay",              0x31, 0x9900, 0x010418, 0x010420);
    extractMap(fs, "RBB - Anchor Room",                   0x8B, 0x9BD0, 0x0104C0, 0x0104C8);
    extractMap(fs, "RBB - Machine Room",                  0x34, 0x9918, 0x010428, 0x010430);
    extractMap(fs, "RBB - Big Fish Warehouse",            0x35, 0x9920, 0x010438, 0x010440);
    extractMap(fs, "RBB - Boat Room",                     0x36, 0x9928, 0x010448, 0x010450);
    extractMap(fs, "RBB - First Blue Container",          0x37, 0x9930, 0x010458, 0x00);
    extractMap(fs, "RBB - Third Blue Container",          0x38, 0x9938, 0x010468, 0x00);
    extractMap(fs, "RBB - Sea-Grublin's Cabin",           0x39, 0x9940, 0x010480, 0x00);
    extractMap(fs, "RBB - Kaboom's Room",                 0x3A, 0x9948, 0x010488, 0x010490);
    extractMap(fs, "RBB - Mini Kaboom's Room",            0x3B, 0x9950, 0x0104A0, 0x0104A8);
    extractMap(fs, "RBB - Kitchen",                       0x3C, 0x9958, 0x0104B0, 0x0104B8);
    extractMap(fs, "RBB - Navigation Room",               0x3D, 0x9960, 0x010498, 0x0104D0);
    extractMap(fs, "RBB - Second Blue Container",         0x3E, 0x9968, 0x010460, 0x00);
    extractMap(fs, "RBB - Captain's Room",                0x3F, 0x9970, 0x010470, 0x010478);
    extractMap(fs, "CCW - Click Clock Wood",              0x40, 0x9978, 0x010558, 0x0105B0);
    extractMap(fs, "CCW - Spring",                        0x43, 0x9990, 0x010560, 0x0105B8);
    extractMap(fs, "CCW - Summer",                        0x44, 0x9998, 0x010568, 0x0105C0);
    extractMap(fs, "CCW - Fall",                          0x45, 0x99A0, 0x010570, 0x0105C8);
    extractMap(fs, "CCW - Winter",                        0x46, 0x99A8, 0x010578, 0x0105D0);
    extractMap(fs, "CCW - Mumbo - Spring",                0x4A, 0x99C8, 0x010408, 0x00);
    extractMap(fs, "CCW - Mumbo - Summer",                0x4B, 0x99D0, 0x010408, 0x00);
    extractMap(fs, "CCW - Mumbo - Fall",                  0x4C, 0x99D8, 0x010408, 0x00);
    extractMap(fs, "CCW - Mumbo - Winter",                0x4D, 0x99E0, 0x010408, 0x00);
    extractMap(fs, "CCW - Beehive - Summer",              0x5A, 0x9A48, 0x010580, 0x00);
    extractMap(fs, "CCW - Beehive - Spring",              0x5B, 0x9A50, 0x010580, 0x00);
    extractMap(fs, "CCW - Beehive - Fall",                0x5C, 0x9A58, 0x010580, 0x00);
    extractMap(fs, "CCW - Nabnuts House - Spring",        0x5E, 0x9A68, 0x010588, 0x00);
    extractMap(fs, "CCW - Nabnuts House - Summer",        0x5F, 0x9A70, 0x010588, 0x00);
    extractMap(fs, "CCW - Nabnuts House - Fall",          0x60, 0x9A78, 0x010588, 0x00);
    extractMap(fs, "CCW - Nabnuts House - Winter",        0x61, 0x9A80, 0x010588, 0x00);
    extractMap(fs, "CCW - Nabnut's Attic - Winter",       0x62, 0x9A88, 0x010598, 0x00);
    extractMap(fs, "CCW - Nabnut's Attic - Fall",         0x63, 0x9A90, 0x010598, 0x00);
    extractMap(fs, "CCW - Nabnut's Attic 2 - Winter",     0x64, 0x9A98, 0x0105A0, 0x0105A8);
    extractMap(fs, "CCW - Whipcrack Room - Spring",       0x65, 0x9AA0, 0x010590, 0x00);
    extractMap(fs, "CCW - Whipcrack Room - Summer",       0x66, 0x9AA8, 0x010590, 0x00);
    extractMap(fs, "CCW - Whipcrack Room - Fall",         0x67, 0x9AB0, 0x010590, 0x00);
    extractMap(fs, "CCW - Whipcrack Room - Winter",       0x68, 0x9AB8, 0x010590, 0x00);
    extractMap(fs, "GL - Floor 1",                        0x69, 0x9AC0, 0x010630, 0x0106F0);
    extractMap(fs, "GL - Floor 2",                        0x6A, 0x9AC8, 0x010638, 0x0106F8);
    extractMap(fs, "GL - Floor 3",                        0x6B, 0x9AD0, 0x010640, 0x010718);
    extractMap(fs, "GL - Floor 4",                        0x71, 0x9B00, 0x010698, 0x010708);
    extractMap(fs, "GL - Floor 5",                        0x6E, 0x9AE8, 0x010658, 0x00);
    extractMap(fs, "GL - Floor 6 FP Entrance",            0x6F, 0x9AF0, 0x010660, 0x010668);
    extractMap(fs, "GL - Floor 7",                        0x79, 0x9B40, 0x0106C0, 0x00);
    extractMap(fs, "GL - Floor 8",                        0x93, 0x9C10, 0x010710, 0x00);
    extractMap(fs, "GL - Pipe Room",                      0x6C, 0x9AD8, 0x010648, 0x010700);
    extractMap(fs, "GL - TTC Entrance",                   0x6D, 0x9AE0, 0x010650, 0x010728);
    extractMap(fs, "GL - CC Entrance",                    0x70, 0x9AF8, 0x010670, 0x0106D0);
    extractMap(fs, "GL - BGS Entrance",                   0x72, 0x9B08, 0x0106A0, 0x010720);
    extractMap(fs, "GL - Lava Room",                      0x74, 0x9B18, 0x010680, 0x00);
    extractMap(fs, "GL - MMM Entrance",                   0x75, 0x9B20, 0x010688, 0x00);
    extractMap(fs, "GL - Floor 6 Water Switch Area",      0x76, 0x9B28, 0x0106A8, 0x0106D8);
    extractMap(fs, "GL - RBB Entrance",                   0x77, 0x9B30, 0x0106B0, 0x0106E0);
    extractMap(fs, "GL - MMM Puzzle",                     0x78, 0x9B38, 0x0106B8, 0x0106E8);
    extractMap(fs, "GL - Coffin Room",                    0x7A, 0x9B48, 0x010690, 0x00);
    extractMap(fs, "GL - Path to Quiz show",              0x80, 0x9B78, 0x0106C8, 0x010738);
    extractMap(fs, "GL - Furnace Fun",                    0x8E, 0x9BE8, 0x0105D8, 0x00);
    extractMap(fs, "GL - Boss",                           0x90, 0x9BF8, 0x010678, 0x010740);
}

main();
