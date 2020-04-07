
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, nArray, hexdump } from "../../util";
import * as Pako from 'pako';
import * as BYML from "../../byml";
import { TextDecoder, print } from "util";

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
    const buffer = (fs.files[index].flags & 0x10) ? decompress(fileBuffer) : fileBuffer;
    return { FileID: index, Data: buffer };
}

function hasExternalTextures(fileTable: CRG1File[], index: number): boolean {
    if (index === -1)
        return false;
    const file = fileTable[index];
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
    fileTable.push({FileID: -1, Data: new ArrayBufferSlice(buffer)});
    return fileTable.length - 1;
}

function appendModelWithTextures(fileTable: CRG1File[], fs: FS, id: number): number {
    const modelIndex = extractFileAndAppend(fileTable, fs, id);
    if (hasExternalTextures(fileTable, modelIndex))
        return extractAndAppendTextures(fileTable, fs, modelIndex);
    return -1;
}

function extractMap(fs: FS, name: string, sceneID: number, opaID: number, xluID = -1, opaSky = -1, xluSky = -1): void {
    const fileTable: CRG1File[] = [];

    const crg1 = {
        Name: name,
        SceneID: sceneID,
        SetupFileId: -1,
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

    crg1.OpaGeoTextures = appendModelWithTextures(fileTable, fs, opaID)
    crg1.XluGeoTextures = appendModelWithTextures(fileTable, fs, xluID)
    crg1.OpaSkyboxTextures = appendModelWithTextures(fileTable, fs, opaSky)
    crg1.XluSkyboxTextures = appendModelWithTextures(fileTable, fs, xluSky)

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${hexzero(sceneID, 2).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

function dumpNames(fs: FS, rom: ArrayBufferSlice): Map<number, string> {
    const stringTables = new Map<number, ArrayBufferSlice>();
    const names = new Map<number,string>();
    const dec = new TextDecoder();

    const introText = extractDLL(rom, 0x29E);
    const view = introText.createDataView(0x2D0); // jump to table
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

const DLLStart = 0x1e899b0;
function extractDLL(rom: ArrayBufferSlice, index: number): ArrayBufferSlice {
    const view = rom.createDataView();
    const start = view.getUint32(DLLStart + index * 4);
    const end = view.getUint32(DLLStart + index * 4 + 4);
    const raw = rom.subarray(DLLStart + start + 0x10, end - start - 0x10);
    return decompress(raw);
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

    const gcmapDLL = extractDLL(romData, 0x29F);
    const mapView = gcmapDLL.createDataView(0x10C0);
    const gcskyDLL = extractDLL(romData, 0x29A);
    const skyView = gcskyDLL.createDataView();

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
}

main();
