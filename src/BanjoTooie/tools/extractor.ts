
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, align, readString } from "../../util";
import * as Pako from 'pako';
import * as BYML from "../../byml";
import { TextDecoder, print } from "util";
import { Endianness } from "../../endian";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/BanjoTooie_Raw`;
const pathBaseOut = `../../../data/BanjoTooie`;

interface FSFile {
    fileTableOffs: number;
    dataOffs: number;
    flags: number;
}

interface FS {
    buffer: ArrayBufferSlice;
    files: FSFile[];
}

function getFileSize(fs: FS, index: number): number {
    return fs.files[index + 1].dataOffs - fs.files[index].dataOffs;
}

function getFileBuffer(fs: FS, index: number): ArrayBufferSlice {
    const fileSize = getFileSize(fs, index);
    return fs.buffer.subarray(fs.files[index].dataOffs, fileSize);
}

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const decompressed = Pako.inflateRaw(buffer.createTypedArray(Uint8Array, 2), { raw: true });
    return new ArrayBufferSlice(decompressed.buffer as ArrayBuffer);
}

interface CRG1File {
    FileID: number;
    Data: ArrayBufferSlice;
}

function extractFileAndAppend(fileTable: CRG1File[], fs: FS, fileID: number): number {
    const file = fs.files[fileID];
    if (file === undefined)
        return -1;

    const index = fileTable.findIndex((file) => file.FileID === fileID);
    if (index >= 0)
        return index;
    fileTable.push(extractFile(fs, fileID));
    return fileTable.length - 1;
}

function extractFile(fs: FS, index: number): CRG1File | null {
    const fileBuffer = getFileBuffer(fs, index);
    if (fileBuffer.byteLength === 0)
        return null;
    if ((fs.files[index].flags & 0xF) === 0xA)
        decryptSetup(index, fileBuffer);
    const buffer = (fs.files[index].flags & 0x10) ? decompress(fileBuffer) : fileBuffer;
    return { FileID: index, Data: buffer };
}

const setupOffset = 0x955;
const keyBuffer = new Uint8Array(14);
function decryptSetup(index: number, buffer: ArrayBufferSlice): void {
    const source = (index - setupOffset) * 0x10001;
    for (let i = 0; i < 14; i += 2) {
        keyBuffer[i] = (source >>> i) & 0xFF;
        keyBuffer[i+1] = 0;
    }
    cicResponse(keyBuffer);

    const view = buffer.createDataView();
    for (let offs = 0; offs < buffer.byteLength; offs++) {
        const old = view.getUint8(offs);
        view.setUint8(offs, old ^ keyBuffer[offs % 14]);
    }
}

// cic 6105 challenge/response algorithm, adapted from mikeryan's ultraCIC
function cicResponse(buffer: Uint8Array): void {
    let acc = 5;
    let carry = true;
    for (let i = 0; i < 2*buffer.length; i++) {
        // get input nibble
        const byte = buffer[i >>> 1];
        let mem = i & 1 ? byte & 0xF : byte >>> 4;

        if (!(acc & 2))
            acc += 4;
        acc = (acc + 9*mem + 8) & 0xF;
        mem = acc;

        acc = (3*mem + (carry ? 1 : 7)) & 0xF;
        carry = carry ? acc <= mem : acc < mem;
        acc = (~acc) & 0xF;

        // store nibble
        if (i & 1)
            buffer[i >>> 1] = (byte & 0xF0) | acc;
        else
            buffer[i >>> 1] = (acc << 4) | (byte & 0x0F);
    }
}

function hasExternalTextures(file: CRG1File): boolean {
    const modelView = file.Data.createDataView();
    const texOffset = modelView.getUint16(0x08);
    return modelView.getUint8(texOffset + 0x06) === 1;
}

const textureFilesStart = 0x1EF6;

function extractAndAppendTextures(fileTable: CRG1File[], fs: FS, modelIndex: number): number {
    const model = fileTable[modelIndex];
    const modelView = model.Data.createDataView();
    const texOffset = modelView.getUint16(0x08);
    const bufferLength = modelView.getUint32(texOffset);
    const texCount = modelView.getUint16(texOffset + 0x04);

    const buffer = new ArrayBuffer(bufferLength);
    const bytes = new Uint8Array(buffer);
    let offs = 0;
    for (let i = 0; i < texCount; i++) {
        const index = modelView.getUint32(texOffset + 8*(i+1));
        const tex = extractFile(fs, index + textureFilesStart);
        const texData = tex.Data.createTypedArray(Uint8Array);
        bytes.set(texData, offs);
        offs += tex.Data.byteLength;
    }
    fileTable.push({FileID: modelIndex | 0x8000, Data: new ArrayBufferSlice(buffer)});
    return fileTable.length - 1;
}

function appendModelWithTextures(fileTable: CRG1File[], fs: FS, id: number): number {
    const modelIndex = extractFileAndAppend(fileTable, fs, id);
    if (modelIndex >= 0 && fs.files[id].flags === 0x10 && hasExternalTextures(fileTable[modelIndex]))
        return extractAndAppendTextures(fileTable, fs, modelIndex);
    return -1;
}

function extractMap(fs: FS, name: string, sceneID: number, opaID: number, xluID = -1, opaSky = -1, xluSky = -1): void {
    const fileTable: CRG1File[] = [];

    const crg1 = {
        Name: name,
        SceneID: sceneID,
        SetupFileID: sceneID + setupOffset,
        Files: fileTable,

        // Geometry
        OpaGeoFileID: opaID,
        OpaGeoTextures: -1,
        XluGeoFileID: xluID,
        XluGeoTextures: -1,

        // Skybox
        OpaSkyboxFileID: opaSky,
        OpaSkyboxTextures: -1,
        XluSkyboxFileID: xluSky,
        XluSkyboxTextures: -1,
    };

    extractFileAndAppend(fileTable, fs, crg1.SetupFileID);

    crg1.OpaGeoTextures = appendModelWithTextures(fileTable, fs, opaID)
    crg1.XluGeoTextures = appendModelWithTextures(fileTable, fs, xluID)
    crg1.OpaSkyboxTextures = appendModelWithTextures(fileTable, fs, opaSky)
    crg1.XluSkyboxTextures = appendModelWithTextures(fileTable, fs, xluSky)

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${hexzero(sceneID, 2).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

function extractActor(fs: FS, id: number, actorDLL: DLLData, chosenFunc: number): void {
    const view = actorDLL.data.createDataView();
    let actorOffs = actorDLL.offset;

    // dumb heuristic for finding first function
    while (true) {
        const instr = view.getUint32(actorOffs);
        if (instr === 0x3C020000 || instr === 0x03e00008 || (instr >>> 12) === 0x27BDF ||
            (view.getUint32(actorOffs - 4) === 0 && actorOffs > actorDLL.offset) ||
            instr >>> 8 === 0x3C0E80 || instr === 0x000470C0 || instr === 0x3C0142B4 || instr === 0xAFA40000 || instr === 0x908F0064 || instr === 0x3C010000 // specific dlls
        )
            break;
        actorOffs += 0x10;
    }
    // the function gemarker points to just returns the (DLL-relative) address of the definition
    // so ensure that this second command is a "jr ra" return statement
    const funcOffset = view.getUint32(0x28 + chosenFunc);
    assert(view.getUint32(actorOffs + funcOffset + 0x04) === 0x03E00008);
    const defStart = actorOffs + view.getUint16(actorOffs + funcOffset + 0x0A);
    const fileTable: CRG1File[] = [];
    const modelIndex = view.getInt16(defStart + 0x04);
    if (modelIndex >= 0)
        appendModelWithTextures(fileTable, fs, modelIndex);


    const actor = {
        Name: actorDLL.name,
        Definition: actorDLL.data.slice(defStart),
        Files: fileTable,
        IsFlipbook: modelIndex >= 0 && fs.files[modelIndex].flags !== 0x10,
    };
    const data = BYML.write(actor, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/actor/${hexzero(id, 3).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

function dumpNames(fs: FS, rom: ArrayBufferSlice): Map<number, string> {
    const stringTables = new Map<number, ArrayBufferSlice>();
    const names = new Map<number,string>();
    const dec = new TextDecoder();

    const introText = extractDLL(rom, 0x29E);
    const view = introText.data.createDataView(0x2D0); // jump to table
    let offs = 0;
    for (let i = 1; i < 199; i++) {
        const entry = view.getUint32(offs);
        const level = entry >>> 22;
        const tableIndex = (entry >> 6) & 0xFFFF;
        const index = entry & 0x3F;
        if (!stringTables.has(tableIndex))
            stringTables.set(tableIndex, extractFile(fs, tableIndex).Data);
        const table = stringTables.get(tableIndex);
        const txtView = table.createDataView();
        const nameCount = txtView.getUint16(0x02);
        let txtOffs = 4;
        for (let j = 0; j < nameCount; j++) {
            const x = txtView.getUint8(txtOffs + 0x00) & 0x7F;
            const length = txtView.getUint8(txtOffs + 0x01);
            if (x == index) {
                const strArray = table.createTypedArray(Uint8Array, txtOffs + 2, length - 1);
                names.set(level, dec.decode(strArray));
                break;
            } else {
                txtOffs += length + 2;
            }
        }
        offs += 4;
    }
    return names;
}

interface DLLData {
    name: string,
    index: number,
    offset: number,
    data: ArrayBufferSlice,
}

const DLLStart = 0x1e899b0;
function extractDLL(rom: ArrayBufferSlice, index: number): DLLData {
    const view = rom.createDataView();
    const start = view.getUint32(DLLStart + index * 4);
    const end = view.getUint32(DLLStart + index * 4 + 4);
    const nameLength = view.getUint8(DLLStart + start + 0x0E);
    const raw = rom.subarray(DLLStart + start + 0x10, end - start - 0x10);
    const data = decompress(raw);
    const dllView = data.createDataView();
    let offset = 0x28;
    // ideally we would just skip the functions and symbols, but the counts are XORed with a checksum
    // rather than implementing that, we just seek heuristically

    // skip function table
    while (dllView.getUint8(offset) === 0)
        offset += 4;
    const name = readString(data, offset, -1, true);
    assert(name.length === nameLength - 1, "bad name");
    offset = align(offset + name.length, 0x10);
    return {
        name,
        index,
        offset, // ideally this would be the first function
        data,
    };
}

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);
    const view = romData.createDataView();

    const files: FSFile[] = [];
    for (let fsTableIdx = 0x5188; fsTableIdx < 0x12B24; fsTableIdx += 0x04) {
        const ptr = view.getUint32(fsTableIdx + 0x00) >>> 6;
        const flags = view.getUint8(fsTableIdx + 0x03);
        const dataOffs = 0x12B24 + ptr;
        files.push({ fileTableOffs: fsTableIdx, dataOffs, flags });
    }
    const fs = { buffer: romData, files };

    // maps
    const gcmapDLL = extractDLL(romData, 0x29F);
    const mapView = gcmapDLL.data.createDataView(0x10C0);
    const gcskyDLL = extractDLL(romData, 0x29A);
    const skyView = gcskyDLL.data.createDataView();

    for (let offs = 0; offs < 0xC78; offs += 0xE) {
        const id = mapView.getUint16(offs + 0x00);
        const opa = mapView.getUint16(offs + 0x02);
        const xlu = mapView.getUint16(offs + 0x04);
        let opaSky = -1;
        let xluSky = -1;
        for (let sky = 0x570; sky < 0xB58; sky += 0x24) {
            if (skyView.getUint16(sky + 0x00) === id) {
                const skyA = skyView.getUint16(sky + 0x04);
                if (skyA > 0) {
                    assert(skyView.getFloat32(sky + 0x08) === 1);
                    opaSky = skyA;
                }
                const skyB = skyView.getUint16(sky + 0x14);
                if (skyB > 0) {
                    assert(skyView.getFloat32(sky + 0x18) === 1);
                    xluSky = skyB;
                }
            }
        }
        extractMap(fs, "", id, opa > 0 ? opa : -1, xlu > 0 ? xlu : -1, opaSky, xluSky);
    }

    // actors
    const dllBlock = decompress(romData.subarray(0x1E42550, 0x44726));
    const dllView = dllBlock.createDataView();
    const gemarkersDLL = extractDLL(romData, 0x318);
    const markerView = gemarkersDLL.data.createDataView(0xE0);
    let offs = 0;
    for (let i = 0xb6; i < 0x546; i++) {
        const marker = markerView.getUint32(offs);
        offs += 4;
        if (marker === 0 || marker >= 0x8008A980)
            continue;
        const dispatch = dllView.getUint32(marker - 0x800815C0);
        const actorDLL = extractDLL(romData, (dispatch >>> 6) - 1);
        extractActor(fs, i, actorDLL, dllView.getUint8(marker + 7 - 0x800815C0));
    }

    // static objects
    const gsproplookupDLL = extractDLL(romData, 0x2DB);
    const fileTable: CRG1File[] = [];
    const modelList = gsproplookupDLL.data.createTypedArray(Uint16Array, 0x90, 90, Endianness.BIG_ENDIAN);
    const flipbookList = gsproplookupDLL.data.createTypedArray(Uint16Array, 0x144, 48, Endianness.BIG_ENDIAN);
    for (let id of modelList)
        extractFileAndAppend(fileTable, fs, id);
    for (let id of flipbookList)
        extractFileAndAppend(fileTable, fs, id);
    const crg = {
        Models: gsproplookupDLL.data.subarray(0x90, modelList.byteLength),
        Flipbooks: gsproplookupDLL.data.subarray(0x144, flipbookList.byteLength),
        Files: fileTable,
    };
    const data = BYML.write(crg, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/static_arc.crg1`, Buffer.from(data));

}

main();
