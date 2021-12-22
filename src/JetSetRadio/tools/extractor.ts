
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
const TEXTURE_ALLOCATION_ADDRESS = 0x8c800000;
const STAGE_ALLOCATION_ADDRESS = 0x8CB00000;

interface AFSRefData {
    AFSFileName: string;
    AFSFileIndex: number;
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

interface TexData extends AFSRefData {
    Offset: number;
}

interface TexlistData {
    Textures: TexData[];
    Texlists: number[][];
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

interface ModelData extends AFSRefData {
    Offset: number;
    TexlistIndex: number;
}

function extractModelTable(execBuffer: ArrayBufferSlice, texlists: Texlist[], afsFile: AFSReference, modelTableAddr: number, texlistTableAddr: number, tableCount: number): ModelData[] {
    const modelTable = execBuffer.createTypedArray(Uint32Array, modelTableAddr - EXECUTABLE_ALLOCATION_ADDRESS, tableCount);
    const texlistTable = execBuffer.createTypedArray(Uint32Array, texlistTableAddr - EXECUTABLE_ALLOCATION_ADDRESS, tableCount);

    const assets: ModelData[] = [];
    for (let i = 0; i < tableCount; i++) {
        const modelAddr = modelTable[i];
        const modelOffs = modelAddr - STAGE_ALLOCATION_ADDRESS;
        const texlistAddr = texlistTable[i];
        const texlistIndex = findTexlistIndex(texlists, texlistAddr);
        if (texlistIndex < 0)
            console.warn(`Asset ${i} (NJ addr ${hexzero0x(modelAddr)}) could not find texlist with addr: ${hexzero0x(texlistAddr)}`);
        assets.push({ ... afsFile.getRefData(), Offset: modelOffs, TexlistIndex: texlistIndex });
    }
    return assets;
}

interface StageData {
    TexListData: TexlistData;
    Models: ModelData[];
}

function packStageData(texChunk: TexChunk, models: ModelData[]): StageData {
    const TexListData = packTexListData(texChunk);
    const Models = models;
    return { TexListData, Models };
}

function saveStageData(dstFilename: string, crg1: StageData): void {
    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(dstFilename, Buffer.from(data));
}

function extractStage1(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const ASSET_TABLE_ADDRESS = 0x8c1063b4;
    const TEXTURE_TABLE_ADDRESS = 0x8c106648;
    const OBJECT_TABLE_ADDRESS = 0x8c105e98;
    // const GLOBAL_TEXLIST_TABLE_ADDRESS = 0x8c1a27c8;
    const TEXLOAD_TABLE_ADDRESS = 0x8c185b30;
    const SCENE_FILE = afsLoad('STAGE1.AFS', 0);
    const ASSET_COUNT = 165;
    const OBJECT_COUNT = 62;

    const texChunk = extractTexLoadTable(execBuffer, TEXLOAD_TABLE_ADDRESS);
    const models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);

    const crg1 = packStageData(texChunk, models);
    saveStageData(dstFilename, crg1);
}

function main() {
    const exec = fetchDataSync(`${pathBaseIn}/1ST_READ.BIN`);
    extractStage1(`${pathBaseOut}/Stage1.crg1`, exec);
}

main();
