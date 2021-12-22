
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero0x, readString } from "../../util";
import * as AFS from '../AFS';
import * as BYML from "../../byml";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer);
}

const pathBaseIn  = `../../../data/JetSetRadio_Raw`;
const pathBaseOut = `../../../data/JetSetRadio`;

const EXECUTABLE_ALLOCATION_ADDRESS = 0x8C010000;
const STAGE_ALLOCATION_ADDRESS = 0x8CB00000;

interface AFSRefData {
    AFSFileName: string;
    AFSFileIndex: number;
}

interface TexData extends AFSRefData {
    Offset: number;
}

interface TexlistData {
    Textures: TexData[];
    Texlists: number[][];
}

interface ModelData extends AFSRefData {
    Offset: number;
    TexlistIndex: number;
}

interface ObjectData {
    ModelID: number;
    Translation: [number, number, number];
    Rotation: [number, number, number];
}

interface StageSliceData {
    Models: ModelData[];
    Objects: ObjectData[];
}

interface StageData extends StageSliceData {
    TexlistData: TexlistData;
}

class AFSReference {
    constructor(public afsFilename: string, public afsIndex: number, public buffer: ArrayBufferSlice) {
    }

    public getRefData(): AFSRefData {
        return { AFSFileName: this.afsFilename, AFSFileIndex: this.afsIndex };
    }
}

function txpHasTexture(file: AFSReference, offset: number): boolean {
    if (offset >= file.buffer.byteLength)
        return false;

    return readString(file.buffer, offset, 0x04, false) === 'GBIX';
}

function afsLoad(afsFilename: string, afsIndex: number): AFSReference {
    const data = AFS.parse(fetchDataSync(`${pathBaseOut}/JETRADIO/${afsFilename}`));
    const buffer = data.files[afsIndex];
    return new AFSReference(afsFilename, afsIndex, buffer);
}

interface TexlistRefTableEntry {
    texlistAddr: number;
    slot: number;
}

function parseTexlistRefTable(execBuffer: ArrayBufferSlice, refTableAddr: number): TexlistRefTableEntry[] {
    const view = execBuffer.createDataView();
    
    const refTable: TexlistRefTableEntry[] = [];

    let refTableOffs = refTableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    while (true) {
        const texlistAddr = view.getUint32(refTableOffs + 0x00, true);
        const slot = view.getUint32(refTableOffs + 0x04, true);
        refTableOffs += 0x08;

        if (texlistAddr === 0x00000000 && slot === 0xFFFFFFFF)
            break;

        refTable.push({ texlistAddr, slot });
    }

    return refTable;
}

interface Texlist {
    addr: number;
    entries: number[];
}

class TexChunk {
    public textures: TexData[] = [];
    public texlists: Texlist[] = [];
}

function packTexListData(texChunk: TexChunk): TexlistData {
    const Textures = texChunk.textures;
    const Texlists = texChunk.texlists.map((v) => v.entries);
    return { Textures, Texlists };
}

function extractFilenameTable(execBuffer: ArrayBufferSlice, tableAddr: number = 0x8C19428C): string[] {
    const filenames: string[] = [];
    let tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    while (true) {
        const filename = readString(execBuffer, tableOffs);
        if (!filename.length)
            break;
        tableOffs += filename.length + 1;
        filenames.push(filename);
    }
    return filenames;
}

function extractTexPackTable_01(dst: TexChunk, execBuffer: ArrayBufferSlice, txpFile: AFSReference, tableAddr: number, texLoadAddr: number): void {
    const view = execBuffer.createDataView();

    const getTexlist = (addr: number) => {
        let existing = dst.texlists.find((v) => v.addr === addr);
        if (existing === undefined) {
            existing = { addr, entries: [] };
            dst.texlists.push(existing);
        }
        return existing;
    };

    const insertRef = (ref: TexlistRefTableEntry, index: number) => {
        const texlist = getTexlist(ref.texlistAddr);
        // console.log(`  ${hexzero0x(ref.texlistAddr)} ${hexzero0x(ref.slot)}`);
        texlist.entries[ref.slot] = index;
    };

    let tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    // console.log(`01 ${txpFile.afsFilename} ${hexzero0x(tableAddr)} ${hexzero0x(tableOffs)}`);
    while (true) {
        const refTableAddr = view.getUint32(tableOffs + 0x00, true);
        const txpAddr = view.getUint32(tableOffs + 0x04, true);

        tableOffs += 0x08;
        if (refTableAddr === 0x00000000 && txpAddr === 0xFFFFFFFF)
            break;
        if (txpAddr === 0x00000000)
            continue;

        const txpOffs = txpAddr - texLoadAddr;
        assert(txpOffs >= 0);

        const texDataIndex = dst.textures.push({ ... txpFile.getRefData(), Offset: txpOffs }) - 1;

        const refTable = parseTexlistRefTable(execBuffer, refTableAddr);
        for (let i = 0; i < refTable.length; i++)
            insertRef(refTable[i], texDataIndex);
    }
}

function extractTexPackTable_02(dst: TexChunk, execBuffer: ArrayBufferSlice, txpFile: AFSReference, tableAddr: number, texLoadAddr: number): void {
    const view = execBuffer.createDataView();

    let tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    // console.log(`02 ${txpFile.afsFilename} ${txpFile.afsIndex} ${hexzero0x(tableAddr)} ${hexzero0x(tableOffs)}`);

    const texlistAddr = view.getUint32(tableOffs + 0x00, true);
    const texlistOffs = texlistAddr - EXECUTABLE_ALLOCATION_ADDRESS;

    const texdataAddr = view.getUint32(tableOffs + 0x04, true);
    let texdataOffs = texdataAddr - EXECUTABLE_ALLOCATION_ADDRESS;

    const texlistCount = view.getUint32(texlistOffs + 0x04, true);

    const entries: number[] = [];
    dst.texlists.push({ addr: texlistAddr, entries });

    for (let i = 0; i < texlistCount; i++) {
        const txpAddr = view.getUint32(texdataOffs + 0x00, true);
        texdataOffs += 0x04;

        const txpOffs = txpAddr - texLoadAddr;
        assert(txpOffs >= 0);

        const texDataIndex = dst.textures.push({ ... txpFile.getRefData(), Offset: txpOffs }) - 1;
        // console.log(`  ${hexzero0x(texlistAddr)} ${hexzero0x(i)} ${hexzero0x(txpAddr)}`);
        entries.push(texDataIndex);
    }
}

function extractTexPackTable_03(dst: TexChunk, execBuffer: ArrayBufferSlice, txpFile: AFSReference, tableAddr: number, texLoadAddr: number): void {
    const view = execBuffer.createDataView();

    const getTexlist = (addr: number) => {
        let existing = dst.texlists.find((v) => v.addr === addr);
        if (existing === undefined) {
            existing = { addr, entries: [] };
            dst.texlists.push(existing);
        }
        return existing;
    };

    const insertRef = (ref: TexlistRefTableEntry, index: number) => {
        const texlist = getTexlist(ref.texlistAddr);
        // console.log(`  ${hexzero0x(ref.texlistAddr)} ${hexzero0x(ref.slot)}`);
        texlist.entries[ref.slot] = index;
    };

    let tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    // console.log(`01 ${txpFile.afsFilename} ${hexzero0x(tableAddr)} ${hexzero0x(tableOffs)}`);
    while (true) {
        const refTableAddr = view.getUint32(tableOffs + 0x00, true);
        const txpAddr = view.getUint32(tableOffs + 0x04, true);

        tableOffs += 0x08;
        if (refTableAddr === 0x00000000 && txpAddr === 0x00000000)
            break;
        if (txpAddr === 0x00000000)
            continue;

        const txpOffs = txpAddr - texLoadAddr;
        assert(txpOffs >= 0);

        const texDataIndex = dst.textures.push({ ... txpFile.getRefData(), Offset: txpOffs }) - 1;

        const refTable = parseTexlistRefTable(execBuffer, refTableAddr);
        for (let i = 0; i < refTable.length; i++)
            insertRef(refTable[i], texDataIndex);
    }
}

function extractTexLoadTable(texChunk: TexChunk, execBuffer: ArrayBufferSlice, tableAddr: number): void {
    const filenames = extractFilenameTable(execBuffer);

    const view = execBuffer.createDataView();

    let tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    while (true) {
        const afsFileID = view.getUint32(tableOffs + 0x00, true);
        const afsIndex = view.getUint32(tableOffs + 0x04, true);
        const texLoadAddr = view.getUint32(tableOffs + 0x08, true);
        const texPackTableAddr = view.getUint32(tableOffs + 0x0C, true);
        const texListType = view.getUint32(tableOffs + 0x10, true);
        tableOffs += 0x20;

        if (texPackTableAddr == 0x00000000)
            break;

        const afsFilename = filenames[afsFileID];
        const txpFile = afsLoad(afsFilename, afsIndex);

        if (texListType === 0x01)
            extractTexPackTable_01(texChunk, execBuffer, txpFile, texPackTableAddr, texLoadAddr);
        else if (texListType === 0x02)
            extractTexPackTable_02(texChunk, execBuffer, txpFile, texPackTableAddr, texLoadAddr);
        else if (texListType === 0x03 || texListType === 0x04 || texListType === 0x05)
            extractTexPackTable_03(texChunk, execBuffer, txpFile, texPackTableAddr, 0x8CDA0000);
        else
            throw "whoops";
    }
}

function findTexlistIndex(texlists: Texlist[], texlistAddr: number): number {
    return texlists.findIndex((v) => v.addr === texlistAddr);
}

function extractModelTable(execBuffer: ArrayBufferSlice, texlists: Texlist[], afsFile: AFSReference, modelTableAddr: number, texlistTableAddr: number, tableCount: number): ModelData[] {
    const modelTable = execBuffer.createTypedArray(Uint32Array, modelTableAddr - EXECUTABLE_ALLOCATION_ADDRESS, tableCount);
    const texlistTable = execBuffer.createTypedArray(Uint32Array, texlistTableAddr - EXECUTABLE_ALLOCATION_ADDRESS, tableCount);

    const models: ModelData[] = [];
    for (let i = 0; i < tableCount; i++) {
        const modelAddr = modelTable[i];
        const modelOffs = modelAddr - STAGE_ALLOCATION_ADDRESS;
        const texlistAddr = texlistTable[i];
        const texlistIndex = findTexlistIndex(texlists, texlistAddr);
        if (texlistIndex < 0)
            console.warn(`Model ${hexzero0x(modelTableAddr)} / ${hexzero0x(i, 2)} (NJ addr ${hexzero0x(modelAddr)}) could not find texlist with addr: ${hexzero0x(texlistAddr)}`);
        models.push({ ... afsFile.getRefData(), Offset: modelOffs, TexlistIndex: texlistIndex });
    }
    return models;
}

const rotToRadians = Math.PI / 0x8000;

function extractObjectInstance(stageBuffer: ArrayBufferSlice, instanceAddr: number): ObjectData | null {
    const stageView = stageBuffer.createDataView();

    const instanceOffs = instanceAddr - STAGE_ALLOCATION_ADDRESS;
    const modelID = stageView.getUint32(instanceOffs + 0x00, true);
    if (modelID === 0xFFFFFFFF) {
        // TODO(jstpierre): what does it mean??????
        return null;
    }

    const translationX = stageView.getFloat32(instanceOffs + 0x04, true);
    const translationY = stageView.getFloat32(instanceOffs + 0x08, true);
    const translationZ = stageView.getFloat32(instanceOffs + 0x0C, true);
    const rotationX = rotToRadians * stageView.getInt16(instanceOffs + 0x10, true);
    const rotationY = rotToRadians * stageView.getInt16(instanceOffs + 0x14, true);
    const rotationZ = rotToRadians * stageView.getInt16(instanceOffs + 0x18, true);
    return {
        ModelID: modelID,
        Translation: [translationX, translationY, translationZ],
        Rotation: [rotationX, rotationY, rotationZ],
    };
}

function extractObjectTableGrouped(execBuffer: ArrayBufferSlice, afsFile: AFSReference, tableAddr: number, tableCount: number): ObjectData[] {
    const tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    const objGroupPtrs = execBuffer.createTypedArray(Uint32Array, tableOffs, tableCount);

    const stageView = afsFile.buffer.createDataView();
    const objects: ObjectData[] = [];
    for (let i = 0; i < tableCount; i++) {
        const instanceListAddr = objGroupPtrs[i];
        if (instanceListAddr === 0)
            continue;
        let instanceListOffs = instanceListAddr - STAGE_ALLOCATION_ADDRESS;
        while (true) {
            const instanceAddr = stageView.getUint32(instanceListOffs + 0x00, true);
            if (((instanceAddr & 0xF0000000) >>> 0) !== 0x80000000)
                break;
            instanceListOffs += 0x04;
            const object = extractObjectInstance(afsFile.buffer, instanceAddr);
            if (object === null)
                continue;
            objects.push(object);
        }
    }
    return objects;
}

function extractObjectTableSingles(execBuffer: ArrayBufferSlice, afsFile: AFSReference, tableAddr: number, tableCount: number): ObjectData[] {
    const tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    const objGroupPtrs = execBuffer.createTypedArray(Uint32Array, tableOffs, tableCount);

    const objects: ObjectData[] = [];
    for (let i = 0; i < tableCount; i++) {
        const instanceAddr = objGroupPtrs[i];
        if (instanceAddr === 0)
            continue;
        const object = extractObjectInstance(afsFile.buffer, instanceAddr);
        if (object === null)
            continue;
        objects.push(object);
    }
    return objects;
}

function packStageData(texChunk: TexChunk, slices: StageSliceData[]): StageData {
    const TexlistData = packTexListData(texChunk);

    const Models: ModelData[] = [];
    const Objects: ObjectData[] = [];

    for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        const modelsStart = Models.length;
        Models.push(... slice.Models);
        Objects.push(... slice.Objects.map((v) => {
            return { ...v, ModelID: v.ModelID + modelsStart };
        }));
    }

    return { TexlistData, Models, Objects };
}

function saveStageData(dstFilename: string, crg1: StageData): void {
    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(dstFilename, Buffer.from(data));
}

function extractStage1(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const texChunk = new TexChunk();

    extractTexLoadTable(texChunk, execBuffer, 0x8c185b30);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1a49a8);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1a49c8);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1a4a28);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1a4a88);

    const SCENE_FILE = afsLoad('STAGE1.AFS', 0);

    function extractSlice1() {
        const ASSET_TABLE_ADDRESS = 0x8c106f9c;
        const TEXTURE_TABLE_ADDRESS = 0x8c107064;
        const OBJECT_TABLE_ADDRESS = 0x8c105f94;
        const ASSET_COUNT = 49;
        const OBJECT_COUNT = 50;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableGrouped(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
        return { Models, Objects };
    }

    function extractSlice2() {
        const ASSET_TABLE_ADDRESS = 0x8c1063b4;
        const TEXTURE_TABLE_ADDRESS = 0x8c106648;
        const OBJECT_TABLE_ADDRESS = 0x8c105e98;
        const ASSET_COUNT = 165;
        const OBJECT_COUNT = 62;
    
        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableGrouped(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
        return { Models, Objects };
    }

    function extractSlice3() {
        const ASSET_TABLE_ADDRESS = 0x8c10712c;
        const TEXTURE_TABLE_ADDRESS = 0x8c107204;
        const OBJECT_TABLE_ADDRESS = 0x8c106090
        const ASSET_COUNT = 54;
        const OBJECT_COUNT = 51;
  
        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSingles(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
        return { Models, Objects };
    }

    const slice1 = extractSlice1();
    const slice2 = extractSlice2();
    const slice3 = extractSlice3();

    const crg1 = packStageData(texChunk, [slice1, slice2, slice3]);
    saveStageData(dstFilename, crg1);
}

function main() {
    const exec = fetchDataSync(`${pathBaseIn}/1ST_READ.BIN`);
    extractStage1(`${pathBaseOut}/Stage1.crg1`, exec);
}

main();
