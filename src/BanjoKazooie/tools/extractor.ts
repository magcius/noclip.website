
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, nArray, hexdump } from "../../util";
import * as Pako from 'pako';
import * as BYML from "../../byml";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/BanjoKazooie_Raw`;
const pathBaseOut = `../../../data/BanjoKazooie`;

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

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const view = buffer.createDataView();

    assert(view.getUint16(0x00) === 0x1172, `bad bytes ${view.getUint32(0).toString(16)} from ${buffer.byteOffset.toString(16)}`);

    let srcOffs = 0x06;
    const decompressed = Pako.inflateRaw(buffer.createTypedArray(Uint8Array, srcOffs), { raw: true });
    return new ArrayBufferSlice(decompressed.buffer as ArrayBuffer);
}

// the second file table at 3ffe10 in RAM has a list of start and end addresses of compressed files
// each block actually has two compressed files, the first with code, the second with data
function decompressPairedFiles(buffer: ArrayBufferSlice, ram: number): RAMRegion[] {
    const view = buffer.createDataView();
    const out: RAMRegion[] = [];

    assert(view.getUint16(0x00) === 0x1172, `bad bytes ${view.getUint32(0).toString(16)} from ${buffer.byteOffset.toString(16)}`);
    const decompressedCodeSize = view.getUint32(0x02);
    let srcOffs = 0x06;

    const inflator = new Pako.Inflate({ raw: true });
    inflator.push(buffer.createTypedArray(Uint8Array, srcOffs), true);
    out.push({ data: new ArrayBufferSlice((inflator.result as Uint8Array).buffer as ArrayBuffer), start: ram });

    const startPoint = srcOffs + ((inflator as any).strm.next_in as number); // read internal zlib stream state to find the next file
    const dataFile = decompress(buffer.slice(startPoint));
    out.push({ data: dataFile, start: ram + decompressedCodeSize }); // files are placed consecutively
    return out;
}

interface CRG1File {
    FileID: number;
    Data: ArrayBufferSlice;
}

function extractFileAndAppend(fileTable: CRG1File[], fs: FS, fileID: number): number {
    const file = fs.files[fileID];
    if (file === undefined)
        return -1;

    if (!fileTable.find((file) => file.FileID === fileID))
        fileTable.push(extractFile(fs, file));
    return fileID;
}

function extractFile(fs: FS, file: FSFile): CRG1File {
    const fileIndex = fs.files.indexOf(file);
    const fileBuffer = getFileBuffer(fs, file);
    const buffer = (file.flags & 0x00010000) ? decompress(fileBuffer) : fileBuffer;
    return { FileID: fileIndex, Data: buffer };
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

    crg1.SetupFileId = extractFileAndAppend(fileTable, fs, sceneID + 0x71C);

    const f9cae0 = decompress(fs.buffer.slice(0xF9CAE0));
    const f9cae0View = f9cae0.createDataView();

    for (let i = 0x7650; i < 0x8250; i += 0x18) {
        const sceneTableID  = f9cae0View.getUint16(i + 0x00);
        if (sceneTableID === sceneID) {
            const opaId = f9cae0View.getUint16(i + 0x02);
            const xluId = f9cae0View.getUint16(i + 0x04);

            crg1.OpaGeoFileId = opaId > 0 ? extractFileAndAppend(fileTable, fs, opaId) : -1;
            crg1.XluGeoFileId = xluId > 0 ? extractFileAndAppend(fileTable, fs, xluId) : -1;
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

            crg1.OpaSkyboxFileId = opaSkyboxId > 0 ? extractFileAndAppend(fileTable, fs, opaSkyboxId) : -1;
            crg1.OpaSkyboxScale = opaSkyboxScale;
            crg1.XluSkyboxFileId = xluSkyboxId > 0 ? extractFileAndAppend(fileTable, fs, xluSkyboxId) : -1;
            crg1.XluSkyboxScale = xluSkyboxScale;
            break;
        }
    }

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${hexzero(sceneID, 2).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

interface AnimationEntry {
    FileID: number;
    Duration: number;
}

interface ObjectLoadEntry {
    OtherID: number; // Not sure what this is...
    SpawnID: number;
    GeoFileID: number;
    AnimationTable: AnimationEntry[];
    AnimationStartIndex: number;
    Flags: number;
    Scale: number;
}

function parseObjectLoadEntry(map: RAMMapper, startAddress: number, flags: number): ObjectLoadEntry {
    const view = map.lookup(startAddress);
    let offs = 0;

    const otherID = view.getUint16(offs + 0x00);
    const spawnID = view.getUint16(offs + 0x02);
    const fileIndex = view.getUint16(offs + 0x04);
    const animationStartIndex = view.getUint16(offs + 0x06);
    const animationTableAddress = view.getUint32(offs + 0x08);
    const scale = view.getFloat32(offs + 0x1C);

    const animationTable: AnimationEntry[] = [];
    if (animationTableAddress !== 0) {
        const animView = map.lookup(animationTableAddress);
        offs = 0;

        while (true) {
            const fileID = animView.getUint32(offs + 0x00);

            const duration = animView.getFloat32(offs + 0x04);
            if (fileID === 0 && animationTable.length > 0)
                break; // the first entry can be (and often is) zero

            // TODO(jstpierre): Figure out where the table stops
            if (fileID > 0x0400) {
                // console.log(animationStartIndex, offs.toString(16), animationTable);
                // hexdump(animView.buffer, animView.byteOffset, 0x100);
                // hexdump(view.buffer, view.byteOffset, 0x100);
                break;
            }

            animationTable.push({ FileID: fileID, Duration: duration });
            offs += 0x08;
        }
    }

    return {
        OtherID: otherID,
        SpawnID: spawnID,
        GeoFileID: fileIndex,
        AnimationTable: animationTable,
        AnimationStartIndex: animationStartIndex,
        Flags: flags,
        Scale: scale,
    };
}

interface RAMRegion {
    data: ArrayBufferSlice;
    start: number;
}

class RAMMapper {
    public regions: RAMRegion[] = [];

    public lookup(address: number): DataView {
        for (let i = 0; i < this.regions.length; i++) {
            const delta = address - this.regions[i].start
            if (delta >= 0 && delta < this.regions[i].data.byteLength) {
                return this.regions[i].data.createDataView(delta);
            }
        }
        throw `couldn't find region for ${address}`;
    }
}

function extractObjectLoad(fs: FS) {
    const map = new RAMMapper();
    // first load the shared data and common objects
    map.regions.push(...decompressPairedFiles(fs.buffer.slice(0xF37F90, 0xFA3FD0), 0x80286F90));
    const setupTable = extractObjectLoadFromAssembly(map, 0x802c2c08);

    // then the level-specific object sets
    // rom addresses are from the file table at 3ffe10
    // function addresses are from a switch statement starting at 2c3824
    extractAdditionalObjects(fs.buffer, setupTable, map, 0xFA3FD0, 0XFA5F50, 0x80387DA0);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0xFA5F50, 0XFA9150, 0x803890E0);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFA9150, 0XFAE860, 0x8038F154);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFAE860, 0XFB24A0, 0x80388AC0);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFB24A0, 0XFB44E0, 0x803888B0);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFB44E0, 0XFB9A30, 0x8038F1E0);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFB9A30, 0XFBEBE0, 0x80386C48);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFBEBE0, 0XFC4810, 0x80391324);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFC4810, 0XFC6F20, 0x80386810);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0xFC6F20, 0XFC9150, 0x8038C4E0);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFC9150, 0XFD0420, 0x8038A0C4);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFD0420, 0XFD6190, 0x803863F0);
    extractAdditionalObjects(fs.buffer, setupTable, map, 0XFD6190, 0XFDAA10, 0X8038DB6C);

    const fileTable: CRG1File[] = [];
    for (let i = 0; i < setupTable.length; i++) {
        const setup = setupTable[i];
        extractFileAndAppend(fileTable, fs, setup.GeoFileID);

        for (let i = 0; i < setup.AnimationTable.length; i++)
            extractFileAndAppend(fileTable, fs, setup.AnimationTable[i].FileID);
    }

    // endpoints are pretty arbitrary
    for (let i = 0x2d1; i <= 0x36e; i++ ) {
        extractFileAndAppend(fileTable, fs, i);
    }

    // flipbooks
    extractFileAndAppend(fileTable, fs, 0x41a);
    extractFileAndAppend(fileTable, fs, 0x580);
    extractFileAndAppend(fileTable, fs, 0x5b7);
    extractFileAndAppend(fileTable, fs, 0x5b8);
    extractFileAndAppend(fileTable, fs, 0x5b9);
    extractFileAndAppend(fileTable, fs, 0x5c2);
    extractFileAndAppend(fileTable, fs, 0x5d7);
    extractFileAndAppend(fileTable, fs, 0x5d8);
    extractFileAndAppend(fileTable, fs, 0x648);
    extractFileAndAppend(fileTable, fs, 0x68c);
    extractFileAndAppend(fileTable, fs, 0x693);
    extractFileAndAppend(fileTable, fs, 0x6b1);
    extractFileAndAppend(fileTable, fs, 0x6b2);
    extractFileAndAppend(fileTable, fs, 0x6b3);
    extractFileAndAppend(fileTable, fs, 0x6b7);
    extractFileAndAppend(fileTable, fs, 0x6d1);
    extractFileAndAppend(fileTable, fs, 0x6d2);
    extractFileAndAppend(fileTable, fs, 0x6d3);
    extractFileAndAppend(fileTable, fs, 0x6d4);
    extractFileAndAppend(fileTable, fs, 0x6d5);
    extractFileAndAppend(fileTable, fs, 0x6d6);
    extractFileAndAppend(fileTable, fs, 0x6d7);
    extractFileAndAppend(fileTable, fs, 0x6d8);

    const data = BYML.write({ ObjectSetupTable: setupTable, Files: fileTable }, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/objectSetup_arc.crg1`, Buffer.from(data));
}

function extractAdditionalObjects(rom: ArrayBufferSlice, setupTable: ObjectLoadEntry[], map: RAMMapper, start: number, end: number, entryAddress: number) {
    const commonFileLoadAddress = 0x803863F0;
    map.regions.push(...decompressPairedFiles(rom.slice(start, end), commonFileLoadAddress));
    const newObjects = extractObjectLoadFromAssembly(map, entryAddress);
    setupTable.push(...newObjects);
    // remove our temporary files
    map.regions.pop();
    map.regions.pop();
}

const enum MIPSOpcode {
    regBlock = 0x0,
    JAL = 0x3,
    ADDIU = 0x9,
    ORI = 0xd,
    LUI = 0xf,
}

function extractObjectLoadFromAssembly(map: RAMMapper, entryAddress: number): ObjectLoadEntry[] {
    const view = map.lookup(entryAddress);

    // skip the first bit of the function, setting stack and s0 register
    // TODO: make sure these functions actually all look the same
    let offs = 0x14;
    // RAM address of function that appends an entry to the object load table
    // divide by four to match MIPS function call
    const appendEntry = 0x3053e8 / 4;
    // address of a function that appends an entry if a particular bit is set
    const conditionalAppendEntry = 0x3054a4 / 4;

    const setupTable: ObjectLoadEntry[] = [];

    // registers to keep track of
    // only a0-a3 (4-7) change, though r0 is read
    const regs = nArray(8, () => 0);
    let delay = false;
    while (true) {
        const instr = view.getUint32(offs);
        const rs = (instr >>> 21) & 0x1f;
        const rt = (instr >>> 16) & 0x1f;
        const rd = (instr >>> 11) & 0x1f;
        const imm = instr & 0xffff;
        offs += 4;
        switch (instr >>> 26) {
            case MIPSOpcode.regBlock:
                assert((instr & 0x3f) === 0x25, "non-OR register instruction found");
                assert(rt === 0); // really just a MOV
                if (rs === 16) // from reg s0
                    regs[rd] = 0x803272f8;
                else
                    regs[rd] = regs[rs];
                break;
            case MIPSOpcode.JAL:
                const funcAddr = instr & 0x00ffffff;
                assert(funcAddr == appendEntry || funcAddr == conditionalAppendEntry, "unknown function found");
                delay = true;
                break;
            case MIPSOpcode.ADDIU:
                assert(rs < 8 && rt < 8);
                regs[rt] = regs[rs] + imm - ((imm >= 0x8000) ? 0x10000 : 0); // sign extend
                break;
            case MIPSOpcode.ORI:
                assert(rs < 8 && rt < 8);
                regs[rt] = regs[rs] | imm;
                break;
            case MIPSOpcode.LUI:
                assert(rt < 8);
                regs[rt] = (imm << 16) >>> 0;
                break;
            default:
                // done with the setup portion
                return setupTable;
        }
        if (delay && (instr >>> 26) !== MIPSOpcode.JAL) {
            delay = false;
            const loadData = regs[4];
            const loadFlags = regs[6];
            // TODO: figure out whether we need a1 (the init function)
            setupTable.push(parseObjectLoadEntry(map, loadData, loadFlags));
        }
    }
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

    extractObjectLoad(fs);
}

main();
