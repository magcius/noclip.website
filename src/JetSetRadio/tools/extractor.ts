
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, hexzero0x, nArray, readString } from "../../util";
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

interface StageData {
    TexlistData: TexlistData;
    Models: ModelData[];
    Objects: ObjectData[];
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

function txpSearch(files: AFSReference[], offs: number): AFSReference | null {
    let candidate: AFSReference | null = null;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (txpHasTexture(file, offs)) {
            if (candidate !== null)
                throw "whoops";

            candidate = file;
        }
    }

    return candidate;
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

interface TexChunk {
    textures: TexData[];
    texlists: Texlist[];
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

function extractTexLoadTable(execBuffer: ArrayBufferSlice, tableAddr: number): TexChunk {
    const filenames = extractFilenameTable(execBuffer);

    const view = execBuffer.createDataView();

    const texChunk: TexChunk = { textures: [], texlists: [] };
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
        else
            throw "whoops";
    }

    return texChunk;
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
            console.warn(`Model ${i} (NJ addr ${hexzero0x(modelAddr)}) could not find texlist with addr: ${hexzero0x(texlistAddr)}`);
        models.push({ ... afsFile.getRefData(), Offset: modelOffs, TexlistIndex: texlistIndex });
    }
    return models;
}

function extractObjectTable(execBuffer: ArrayBufferSlice, afsFile: AFSReference, tableAddr: number, tableCount: number): ObjectData[] {
    const tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    const objGroupPtrs = execBuffer.createTypedArray(Uint32Array, tableOffs, tableCount);

    const stageView = afsFile.buffer.createDataView();
    const objects: ObjectData[] = [];
    for (let i = 0; i < tableCount; i++) {
        const instanceListAddr = objGroupPtrs[i];
        if (instanceListAddr === 0)
            continue;
        let instanceListOffs = instanceListAddr - STAGE_ALLOCATION_ADDRESS;
        const instanceAddr = stageView.getUint32(instanceListOffs + 0x00, true);
        if (((instanceAddr & 0xF0000000) >>> 0) !== 0x80000000) { 
            const instanceOffs = instanceListOffs;
            const modelID = stageView.getUint32(instanceOffs + 0x00, true);
            if (modelID === 0xFFFFFFFF) {
                // TODO(jstpierre): what does it mean??????
                continue;
            }
            const translationX = stageView.getFloat32(instanceOffs + 0x04, true);
            const translationY = stageView.getFloat32(instanceOffs + 0x08, true);
            const translationZ = stageView.getFloat32(instanceOffs + 0x0C, true);
            const rotationP = stageView.getInt16(instanceOffs + 0x10, true);
            const rotationY = stageView.getInt16(instanceOffs + 0x14, true);
            const rotationR = stageView.getInt16(instanceOffs + 0x18, true);
            objects.push({
                ModelID: modelID,
                Translation: [translationX, translationY, translationZ],
                Rotation: [rotationP, rotationY, rotationR],
            });
            continue;
        }

        while (true) {
            const instanceAddr = stageView.getUint32(instanceListOffs + 0x00, true);
            if (((instanceAddr & 0xF0000000) >>> 0) !== 0x80000000)
                break;
            instanceListOffs += 0x04;

            const instanceOffs = instanceAddr - STAGE_ALLOCATION_ADDRESS;
            const modelID = stageView.getUint32(instanceOffs + 0x00, true);
            if (modelID === 0xFFFFFFFF) {
                // TODO(jstpierre): what does it mean??????
                continue;
            }
            const translationX = stageView.getFloat32(instanceOffs + 0x04, true);
            const translationY = stageView.getFloat32(instanceOffs + 0x08, true);
            const translationZ = stageView.getFloat32(instanceOffs + 0x0C, true);
            const rotationP = stageView.getInt16(instanceOffs + 0x10, true);
            const rotationY = stageView.getInt16(instanceOffs + 0x14, true);
            const rotationR = stageView.getInt16(instanceOffs + 0x18, true);
            objects.push({
                ModelID: modelID,
                Translation: [translationX, translationY, translationZ],
                Rotation: [rotationP, rotationY, rotationR],
            });
        }
    }
    return objects;
}

function mergeStageSlide(stageDat1 : StageData, stageDat2 : StageData) {
    const ofMod = stageDat1.Models.length;
    const ofTex = stageDat1.TexlistData.Texlists.length;

    for (let i = 0; i < stageDat2.Models.length; i++)  {
        const instModel = stageDat2.Models[i];
        instModel.TexlistIndex+=ofTex; // Offset texlist index by new merged stage index. 
        stageDat1.Models.push(instModel);
    }

    for (let i = 0; i < stageDat2.Objects.length; i++) {
        const instObj = stageDat2.Objects[i];
        instObj.ModelID+=ofMod; // Offset model list by previous data 
        stageDat1.Objects.push(instObj);
    }

    for (let i = 0; i < stageDat2.TexlistData.Texlists.length; i++) {
        stageDat1.TexlistData.Texlists.push(stageDat2.TexlistData.Texlists[i]);
    }
}

function packStageData(texChunk: TexChunk, models: ModelData[], objects: ObjectData[]): StageData {
    const TexlistData = packTexListData(texChunk);
    const Models = models;
    const Objects = objects;
    return { TexlistData, Models, Objects };
}

function saveStageData(dstFilename: string, crg1: StageData): void {
    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(dstFilename, Buffer.from(data));
}

function extractStage1(dstFilename: string, execBuffer: ArrayBufferSlice): void {

    let TEXLOAD_TABLE_ADDRESS = 0x8c185b30;
    let SCENE_FILE = afsLoad('STAGE1.AFS', 0);
    let texChunk = extractTexLoadTable(execBuffer, TEXLOAD_TABLE_ADDRESS);

    let ASSET_TABLE_ADDRESS = 0x8c106f9c;
    let TEXTURE_TABLE_ADDRESS = 0x8c107064;
    let OBJECT_TABLE_ADDRESS = 0x8c105f94;
    let ASSET_COUNT = 50;
    let OBJECT_COUNT = 62;

    let models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
    let objects = extractObjectTable(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
    let crg1 = packStageData(texChunk, models, objects);


    ASSET_TABLE_ADDRESS = 0x8c1063b4;
    TEXTURE_TABLE_ADDRESS = 0x8c106648;
    OBJECT_TABLE_ADDRESS = 0x8c105e98;
    ASSET_COUNT = 165;
    OBJECT_COUNT = 62;


    models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
    objects = extractObjectTable(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
    let crg2 = packStageData(texChunk, models, objects);

    mergeStageSlide(crg1,crg2);


    
    ASSET_TABLE_ADDRESS = 0x8c10712c;
    TEXTURE_TABLE_ADDRESS = 0x8c107204;
    OBJECT_TABLE_ADDRESS = 0x8c106090
    ASSET_COUNT = 56;
    OBJECT_COUNT = 51;


    models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
    objects = extractObjectTable(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
    let crg3 = packStageData(texChunk, models, objects);

    mergeStageSlide(crg1,crg3);



    saveStageData(dstFilename, crg1);
}

function main() {
    const exec = fetchDataSync(`${pathBaseIn}/1ST_READ.BIN`);
    extractStage1(`${pathBaseOut}/Stage1.crg1`, exec);
}

main();
