
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, assertExists, hexzero0x, readString } from "../../util";
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
const STAGE_COMPACT_ALLOCATION_ADDRESS = 0x8C800000;

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

interface SkyboxData {
    Meshes : ModelData[];    
}

interface ObjectData {
    ModelID: number;
    Translation: [number, number, number];
    Rotation: [number, number, number];
    Scale: [number,number,number];
    Flags: number;
}

interface StageSliceData {
    Models: ModelData[];
    Objects: ObjectData[];
}

interface StageData extends StageSliceData {
    BaseAddress: number;
    TexlistData: TexlistData;
    Skybox: SkyboxData | null;
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
    // Exclude textures that don't have any uses.
    const usedTextureMap = new Map<number, number>();
    const usedTextures: number[] = [];
    const Texlists = texChunk.texlists.map((v) => v.entries.map((origIndex) => {
        if (!usedTextureMap.has(origIndex)) {
            usedTextures.push(origIndex);
            usedTextureMap.set(origIndex, usedTextures.length - 1);
        }

        return usedTextureMap.get(origIndex)!;
    }));

    const Textures = usedTextures.map((index) => {
        return texChunk.textures[index];
    });

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
        if (refTableAddr === 0x00000000 && (txpAddr === 0xFFFFFFFF || txpAddr === 0x00000000 ))
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
    while (true) {

        const texlistAddr = view.getUint32(tableOffs + 0x00, true);
        if (texlistAddr === 0x00000000)
            break;

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
            //console.log(`  ${hexzero0x(texlistAddr)} ${hexzero0x(i)} ${hexzero0x(txpAddr)}`);
            entries.push(texDataIndex);
        }
        tableOffs += 0x08;
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

function extractTexLoadTable(texChunk: TexChunk, execBuffer: ArrayBufferSlice, tableAddr: number , texLoadOverride: number = 0, textableFormatOverride : number = 0, maxDepth: number = 0): void {
    const filenames = extractFilenameTable(execBuffer);

    const view = execBuffer.createDataView();
    let depth = 0;
    let tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    while (true) {
        if (depth === maxDepth && maxDepth !== 0)
            break;

        depth++;

        const afsFileID = view.getUint32(tableOffs + 0x00, true);
        const afsIndex = view.getUint32(tableOffs + 0x04, true);
        let texLoadAddr = view.getUint32(tableOffs + 0x08, true);

        const texPackTableAddr = view.getUint32(tableOffs + 0x0C, true);
        let texListType = view.getUint32(tableOffs + 0x10, true);
        tableOffs += 0x20;
        if (texPackTableAddr === 0x00000000 && afsFileID===0 && afsIndex===0 && texListType===0 && texLoadAddr===0)
            break;
        if (texPackTableAddr === 0)
            continue;
        if (texLoadOverride > 0)
            texLoadAddr = texLoadOverride;
        // xayrga: will we ever load the segalogo?
        if (afsFileID === 0)
            continue;
        const afsFilename = filenames[afsFileID];
        if (!afsFilename)
            continue;
        const txpFile = afsLoad(afsFilename, afsIndex);
        if (texListType === 0)
            continue;
        if (textableFormatOverride > 0)
            texListType = textableFormatOverride;
        if (texListType === 0x01)
            extractTexPackTable_01(texChunk, execBuffer, txpFile, texPackTableAddr, texLoadAddr);
        else if (texListType === 0x02)
            extractTexPackTable_02(texChunk, execBuffer, txpFile, texPackTableAddr, texLoadAddr);
        else if (texListType === 0x03 || texListType === 0x04 || texListType === 0x05)
            extractTexPackTable_03(texChunk, execBuffer, txpFile, texPackTableAddr, texLoadAddr);
        else
            throw `Invalid texlist format  ${texListType}`;
    }
}

function findTexlistIndex(texlists: Texlist[], texlistAddr: number): number {
    return texlists.findIndex((v) => v.addr === texlistAddr);
}

function extractModelTable(execBuffer: ArrayBufferSlice, texlists: Texlist[], afsFile: AFSReference, modelTableAddr: number, texlistTableAddr: number | null, tableCount: number): ModelData[] {
    const modelTable = execBuffer.createTypedArray(Uint32Array, modelTableAddr - EXECUTABLE_ALLOCATION_ADDRESS, tableCount);
    const texlistTable = texlistTableAddr !== null ? execBuffer.createTypedArray(Uint32Array, texlistTableAddr - EXECUTABLE_ALLOCATION_ADDRESS, tableCount) : null;

    const models: ModelData[] = [];
    for (let i = 0; i < tableCount; i++) {
        const modelAddr = modelTable[i];
        const modelOffs = modelAddr - STAGE_ALLOCATION_ADDRESS;
        let texlistIndex = -1;
        if (texlistTable !== null) {
            const texlistAddr = texlistTable[i];
            texlistIndex = findTexlistIndex(texlists, texlistAddr);
            if (texlistIndex < 0 && texlistAddr !== 0)
                console.warn(`Model ${hexzero0x(modelTableAddr)} / ${hexzero0x(i, 2)} (NJ addr ${hexzero0x(modelAddr)}) could not find texlist with addr: ${hexzero0x(texlistAddr)}`);
        }
        models.push({ ... afsFile.getRefData(), Offset: modelOffs, TexlistIndex: texlistIndex });
    }
    return models;
}


function createModelManual(offset: number, texlist: number, texlists: Texlist[], afsFile: AFSReference, mountOffset: number): ModelData[] {

    const models: ModelData[] = [];

        const modelAddr = offset;
        const modelOffs = modelAddr - mountOffset;
        let texlistIndex = -1;
   
            const texlistAddr = texlist;
            texlistIndex = findTexlistIndex(texlists, texlist);
            if (texlistIndex < 0 && texlistAddr !== 0)
                console.warn(`Manual Model ${hexzero0x(offset)} / (NJ addr ${hexzero0x(modelAddr)}) could not find texlist with addr: ${hexzero0x(texlist)}`);
        
        models.push({ ... afsFile.getRefData(), Offset: modelOffs, TexlistIndex: texlistIndex });
    
    return models;
}


function extractModelTableIndirect(execBuffer: ArrayBufferSlice, texlists: Texlist[], afsFile: AFSReference, modelTableAddr: number, texlistTableAddr: number | null, tableCount: number): ModelData[] {
    const modelTable = execBuffer.createTypedArray(Uint32Array, modelTableAddr - EXECUTABLE_ALLOCATION_ADDRESS, tableCount);
    const texlistTable = texlistTableAddr !== null ? execBuffer.createTypedArray(Uint32Array, texlistTableAddr - EXECUTABLE_ALLOCATION_ADDRESS, tableCount) : null;
    const stageview = afsFile.buffer.createDataView();
    const execview = execBuffer.createDataView();

    const models: ModelData[] = [];
    for (let i = 0; i < tableCount; i++) {

        const indirectModelAddr = stageview.getUint32(modelTable[i] - STAGE_COMPACT_ALLOCATION_ADDRESS, true);   
        const modelAddr = indirectModelAddr - STAGE_COMPACT_ALLOCATION_ADDRESS;    
        const modelOffs = modelAddr;
    
        let texlistIndex = -1;
        if (texlistTable !== null) {
            const texlistAddr = texlistTable[i];
            texlistIndex = findTexlistIndex(texlists, texlistAddr);
            if (texlistIndex < 0 && texlistAddr !== 0)
                console.warn(`Model ${hexzero0x(modelTableAddr)} / ${hexzero0x(i, 2)} (NJ addr ${hexzero0x(modelAddr)}) could not find texlist with addr: ${hexzero0x(texlistAddr)}`);
        }
        models.push({ ... afsFile.getRefData(), Offset: modelOffs, TexlistIndex: texlistIndex });
    }
    return models;
}


const rotToRadians = Math.PI / 0x8000;

function extractObjectInstance_01(stageBuffer: ArrayBufferSlice, instanceAddr: number): ObjectData {
    const stageView = stageBuffer.createDataView();

    const instanceOffs = instanceAddr - STAGE_ALLOCATION_ADDRESS;
    const modelID = stageView.getUint32(instanceOffs + 0x00, true);

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
        Scale: [1,1,1],
        Flags: 0
    };
}



function extractObjectInstance_02(stageBuffer: ArrayBufferSlice, instanceAddr: number, dataSize:number = 0x24): ObjectData {
    const stageView = stageBuffer.createDataView();
    //console.warn(`Instance ${hexzero0x(instanceAddr)}`)
    const instanceOffs = instanceAddr - STAGE_ALLOCATION_ADDRESS;
    const modelID = stageView.getUint32(instanceOffs + 0x00, true);

    const translationX = stageView.getFloat32(instanceOffs + 0x04, true);
    const translationY = stageView.getFloat32(instanceOffs + 0x08, true);
    const translationZ = stageView.getFloat32(instanceOffs + 0x0C, true);
    const rotationX = rotToRadians * stageView.getInt16(instanceOffs + 0x10, true);
    const rotationY = rotToRadians * stageView.getInt16(instanceOffs + 0x14, true);
    const rotationZ = rotToRadians * stageView.getInt16(instanceOffs + 0x18, true);
    let scaleX = stageView.getFloat32(instanceOffs + 0x1C, true); 
    let scaleY = stageView.getFloat32(instanceOffs + 0x20, true);
    let scaleZ = stageView.getFloat32(instanceOffs + 0x24, true);
    let flags = 0;
    if (dataSize >= 0x28)
        flags = stageView.getFloat32(instanceOffs + 0x28, true);

    if ((scaleX + scaleY + scaleZ) === 0) { // some objects have an extended size but no scaling specification. Have to account for these.
        scaleX = 1;
        scaleY = 1;
        scaleZ = 1;
    }

    return {
        ModelID: modelID,
        Translation: [translationX, translationY, translationZ],
        Rotation: [rotationX, rotationY, rotationZ],
        Scale: [scaleX,scaleY,scaleZ], 
        Flags: flags // xayrga: todo, confirm if this actually functions as a flag.
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
        for (;; instanceListOffs += 0x04) {
            const instanceAddr = stageView.getUint32(instanceListOffs + 0x00, true);
            if (((instanceAddr & 0xF0000000) >>> 0) !== 0x80000000)
                break;
            const object = extractObjectInstance_01(afsFile.buffer, instanceAddr);
            if (object.ModelID === 0xFFFFFFFF)
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
        let instanceAddr = objGroupPtrs[i];
        if (instanceAddr === 0)
            continue;
        for (;; instanceAddr += 0x28) {
            const object = extractObjectInstance_01(afsFile.buffer, instanceAddr);
            if (object.ModelID === 0xFFFFFFFF) 
                continue;
            if (object.ModelID === 0xFFFFFFFE) 
                break;            
            objects.push(object);
        }
    }
    return objects;
}


function extractObjectTableSinglesSize(execBuffer: ArrayBufferSlice, afsFile: AFSReference, tableAddr: number, tableCount: number, significantDataSize: number): ObjectData[] {
    const tableOffs = tableAddr - EXECUTABLE_ALLOCATION_ADDRESS;
    const objGroupPtrs = execBuffer.createTypedArray(Uint32Array, tableOffs, tableCount);

    const objects: ObjectData[] = [];
    for (let i = 0; i < tableCount; i++) {
        let instanceAddr = objGroupPtrs[i];
        if (instanceAddr === 0)
            continue;
        for (;; instanceAddr += significantDataSize) {
            const object = extractObjectInstance_02(afsFile.buffer, instanceAddr, significantDataSize);
            if (object.ModelID === 0xFFFFFFFF) 
                continue;            
            if (object.ModelID === 0xFFFFFFFE) 
                break;
            objects.push(object);
        }
    }
    return objects;
}



function packStageData(texChunk: TexChunk, slices: StageSliceData[], BaseAddress: number, Skybox: SkyboxData | null = null): StageData {
    const usedTexlists: number[] = [];
    const usedTexlistMap = new Map<number, number>();

    const processModel = (model: ModelData): void => {
        if (model.TexlistIndex === -1)
            return;

        if (!usedTexlistMap.has(model.TexlistIndex)) {
            usedTexlists.push(model.TexlistIndex);
            usedTexlistMap.set(model.TexlistIndex, usedTexlists.length - 1);
        }

        model.TexlistIndex = usedTexlistMap.get(model.TexlistIndex)!;
    };

    for (const slice of slices)
        for (const model of slice.Models)
            processModel(model);

    if (Skybox !== null) 
       for (const skybox of Skybox.Meshes) 
            processModel(skybox);
    

    texChunk.texlists = usedTexlists.map((index) => {
        return assertExists(texChunk.texlists[index]);
    });

    const TexlistData = packTexListData(texChunk);

    const Models: ModelData[] = [];
    const Objects: ObjectData[] = [];
    for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        const modelsStart = Models.length;
        Models.push(... slice.Models);
        Objects.push(... slice.Objects.map((v) => {
            assert(v.ModelID < slice.Models.length);
            return { ...v, ModelID: v.ModelID + modelsStart };
        }));
    }

    return { TexlistData, Models, Objects, BaseAddress, Skybox };
}

function saveStageData(dstFilename: string, crg1: StageData): void {
    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(dstFilename, Buffer.from(data));
}

function loadSkyboxMesh(execBuffer: ArrayBufferSlice, texlist: Texlist[], afsFile: AFSReference, innerOfs: number, innerTexlistOfs: number) : ModelData {
    let texlistIndex = findTexlistIndex(texlist, innerTexlistOfs);    
    if (innerTexlistOfs === 0)
        texlistIndex = -1;
    else if (texlistIndex < 0)
        console.warn(`SKYBOX: ${hexzero0x(innerOfs)} could not find texlist with addr: ${hexzero0x(innerTexlistOfs)}`);
    const In = { ... afsFile.getRefData(), Offset: innerOfs - STAGE_ALLOCATION_ADDRESS, TexlistIndex: texlistIndex };
    return In;
}

function extractStage1(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const texChunk = new TexChunk();
    const SkyboxMeshes = [] as ModelData[];

    extractTexLoadTable(texChunk, execBuffer, 0x8c185b30);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1a49c8, 0x8cda0000 );
    extractTexLoadTable(texChunk, execBuffer, 0x8c1a4a28, 0x8cda0000 );
    extractTexLoadTable(texChunk, execBuffer, 0x8c1a4a88, 0x8cda0000 );

    const SCENE_FILE = afsLoad('STAGE1.AFS', 0);
    const OBJECT_COUNT = 61;
    const INTERACTABLE_COUNT = 61;
    // 8c105e48
    function extractSlice1() {
        const ASSET_TABLE_ADDRESS = 0x8c1063b4;
        const TEXTURE_TABLE_ADDRESS = 0x8c106648;
        const OBJECT_TABLE_ADDRESS = 0x8c105e98;
        const ENVIRONMENT_TABLE_ADDRESS = 0x8c105e54;
        const ASSET_COUNT = 165;        
       
        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const MapObjects = extractObjectTableGrouped(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
        const EnvironmentObjects = extractObjectTableGrouped(execBuffer, SCENE_FILE, ENVIRONMENT_TABLE_ADDRESS, 1);
        const Objects = MapObjects.concat(EnvironmentObjects);
        return { Models, Objects };
    }

    function extractSlice2() {
        const ASSET_TABLE_ADDRESS = 0x8c106e0c;
        const TEXTURE_TABLE_ADDRESS = 0x8c106ed4;
        const OBJECT_TABLE_ADDRESS = 0x8c105f94;
        const ASSET_COUNT = 49;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableGrouped(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
        return { Models, Objects };
    }

    function extractSlice3() {
        const ASSET_TABLE_ADDRESS = 0x8c10712c;
        const TEXTURE_TABLE_ADDRESS = 0x8c107204;
        const OBJECT_TABLE_ADDRESS = 0x8c106090
        const ASSET_COUNT = 54;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSingles(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
        return { Models, Objects };
    }

    // Seems to be used for shadows, but uses CNK_VOL chunks as shadow casters for their shadow system.
    /*
    function extractSlice4() {
        const ASSET_TABLE_ADDRESS = 0x8c1076bc;
        const TEXTURE_TABLE_ADDRESS = null;
        const OBJECT_TABLE_ADDRESS = 0x8c106288;
        const ASSET_COUNT = 34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSingles(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT);
        return { Models, Objects };
    }
    */

    function extractInteractables() {
        const ASSET_TABLE_ADDRESS = 0x8c107564;
        const TEXTURE_TABLE_ADDRESS = 0x8c1075d4;
        const OBJECT_TABLE_ADDRESS = 0x8c10618c;
        const ASSET_COUNT = 28;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableGrouped(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, INTERACTABLE_COUNT);
        return { Models, Objects };
    }

    function extractSkybox() {
        SkyboxMeshes.push(loadSkyboxMesh(execBuffer, texChunk.texlists ,SCENE_FILE ,0x8cce2ebc, 0x8c19de5c));
        SkyboxMeshes.push(loadSkyboxMesh(execBuffer, texChunk.texlists ,SCENE_FILE, 0x8cce33c0, 0));
        return  { Meshes : SkyboxMeshes }
    }


    const slice1 = extractSlice1();
    const slice2 = extractSlice2();
    const slice3 = extractSlice3();
    // const slice4 = extractSlice4();
    const interactables = extractInteractables();    
    const skybox = extractSkybox();

    const crg1 = packStageData(texChunk, [slice1, slice2, slice3, interactables], STAGE_ALLOCATION_ADDRESS, skybox);
    saveStageData(dstFilename, crg1);
}

function extractStage2(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const texChunk = new TexChunk();
    const SkyboxMeshes = [] as ModelData[];

    extractTexLoadTable(texChunk, execBuffer, 0x8c1b3f28, 0x8cDA0000, 1, 2);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1b3f88, 0x8CDA0000, 1, 2);
    extractTexLoadTable(texChunk, execBuffer, 0x8c186c38);
    extractTexLoadTable(texChunk, execBuffer, 0x8c186530);

    const SCENE_FILE = afsLoad('STAGE2.AFS', 0);
    const OBJECT_COUNT = 114;
    const INTERACTABLE_COUNT = OBJECT_COUNT;

    function extractSlice1() {
        const ASSET_TABLE_ADDRESS = 0x8c1086a0;
        const TEXTURE_TABLE_ADDRESS = 0x8c108834;
        const OBJECT_TABLE_ADDRESS = 0x8c107d2c;
        const ASSET_COUNT = 101;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const MapObjects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        const EnvironmentObjects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, 0x8c107ce8, 1, OBJECTDATA_SIZE);
        const Objects = MapObjects.concat(EnvironmentObjects) ;
        return { Models, Objects };
    }

    function extractSlice2() {
        const ASSET_TABLE_ADDRESS = 0x8c108cf0;
        const TEXTURE_TABLE_ADDRESS = 0x8c10920c;
        const OBJECT_TABLE_ADDRESS = 0x8c107ef4;
        const ASSET_COUNT = 327;
        const OBJECTDATA_SIZE = 0x28;
    

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSlice3() {
        const ASSET_TABLE_ADDRESS = 0x8c109728;
        const TEXTURE_TABLE_ADDRESS = 0x8c10985c;
        const OBJECT_TABLE_ADDRESS = 0x8c1080bc;
        const ASSET_COUNT = 77;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractInteractables() {
        const ASSET_TABLE_ADDRESS = 0x8c10a004;
        const TEXTURE_TABLE_ADDRESS = 0x8c10a170;
        const OBJECT_TABLE_ADDRESS = 0x8c108288;
        const ASSET_COUNT = 91;
        const OBJECTDATA_SIZE = 0x28;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, INTERACTABLE_COUNT,OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSkybox() {
       // SkyboxMeshes.push(loadSkyboxMesh(execBuffer, texChunk.texlists ,SCENE_FILE ,0x8cc93a10, 0));
        SkyboxMeshes.push(loadSkyboxMesh(execBuffer, texChunk.texlists ,SCENE_FILE, 0x8cc93634, 0x8c1ad95c));
        SkyboxMeshes.push(loadSkyboxMesh(execBuffer, texChunk.texlists ,SCENE_FILE, 0x8cc93454, 0x8c1ad944 ));
        return  { Meshes : SkyboxMeshes }
    }

    const slice1 = extractSlice1();
    const slice2 = extractSlice2();
    const slice3 = extractSlice3();
    const interactables = extractInteractables();
    const skybox = extractSkybox();

    const crg1 = packStageData(texChunk, [slice1, slice2, slice3, interactables], STAGE_ALLOCATION_ADDRESS, skybox);
    saveStageData(dstFilename, crg1);
}


function extractStage3(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const texChunk = new TexChunk();
    const SkyboxMeshes = [] as ModelData[];

    extractTexLoadTable(texChunk, execBuffer, 0x8c1c7350,0x8cf00000, 1, 4);
    extractTexLoadTable(texChunk, execBuffer, 0x8c185db0);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1c6430, 0x8Cf00000,1,5);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1c7290, 0x8Cf00000,1);

    const SCENE_FILE = afsLoad('STAGE3.AFS', 0);
    const OBJECT_COUNT = 46;
    const INTERACTABLE_COUNT = 10;

    function extractSlice1() {
        const ASSET_TABLE_ADDRESS = 0x8c1bab40;
        const TEXTURE_TABLE_ADDRESS = 0x8c1bad0c;
        const OBJECT_TABLE_ADDRESS = 0x8c1ba6f0;
        const ASSET_COUNT = 115;
        const OBJECTDATA_SIZE = 0x28;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSlice2() {
        const ASSET_TABLE_ADDRESS = 0x8c1bb270;
        const TEXTURE_TABLE_ADDRESS = 0x8c1bb3d0;
        const OBJECT_TABLE_ADDRESS = 0x8c1ba7a8;
        const ASSET_COUNT = 88;
        const OBJECTDATA_SIZE = 0x28;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSlice3() {
        const ASSET_TABLE_ADDRESS = 0x8c1bb530;
        const TEXTURE_TABLE_ADDRESS = 0x8c1bb8ec;
        const OBJECT_TABLE_ADDRESS = 0x8c1ba860;
        const ASSET_COUNT = 239;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSlice4() {
        const ASSET_TABLE_ADDRESS = 0x8c1bc4cc;
        const TEXTURE_TABLE_ADDRESS = 0x8c1bc54c;
        const OBJECT_TABLE_ADDRESS = 0x8c1ba9d0;
        const ASSET_COUNT = 32;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }
    
    
    function extractInteractables() {
        const ASSET_TABLE_ADDRESS = 0x8c1bc3b0;
        const TEXTURE_TABLE_ADDRESS = 0x8c1bc17c;
        const OBJECT_TABLE_ADDRESS = 0x8c1ba918;
        const ASSET_COUNT = 71;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableGrouped(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, INTERACTABLE_COUNT);
        return { Models, Objects };
    }
    
    function extractSkybox() {
        SkyboxMeshes.push(loadSkyboxMesh(execBuffer, texChunk.texlists ,SCENE_FILE ,0x8ccc5af4, 0x8c1c2c54));
        SkyboxMeshes.push(loadSkyboxMesh(execBuffer, texChunk.texlists ,SCENE_FILE, 0x8ccc7b98, 0x8c1c2c54));
        return  { Meshes : SkyboxMeshes }
    }


    const slice1 = extractSlice1();
    const slice2 = extractSlice2();
    const slice3 = extractSlice3();
    const slice4 = extractSlice4();
    //const interactables = extractInteractables(); //xayrga: parser is having a hard time with one of the models here, too
    const skybox = extractSkybox();

    const crg1 = packStageData(texChunk, [slice1, slice2, slice3, slice4], STAGE_ALLOCATION_ADDRESS, skybox);
    saveStageData(dstFilename, crg1);
}

function extractStage5(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const texChunk = new TexChunk();
    const SkyboxMeshes = [] as ModelData[];

    extractTexLoadTable(texChunk, execBuffer, 0x8c1c7350,0x8cf00000, 1, 4);
    extractTexLoadTable(texChunk, execBuffer, 0x8c185db0);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1c6430, 0x8Cf00000,1,5);
    extractTexLoadTable(texChunk, execBuffer, 0x8c1c7290, 0x8Cf00000,1);
    extractTexLoadTable(texChunk, execBuffer, 0x8c185ff0, 0x8c800000, 2, 5);

    const SCENE_FILE = afsLoad('STAGE5.AFS', 0);
    const OBJECT_COUNT = 71;
    const INTERACTABLE_COUNT = 71;
    
    function extractSlice1() {
        const ASSET_TABLE_ADDRESS = 0x8c2033b4;
        const TEXTURE_TABLE_ADDRESS = 0x8c203498;
        const OBJECT_TABLE_ADDRESS = 0x8c202e28;
        const ASSET_COUNT = 56;
        const OBJECTDATA_SIZE = 0x28;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSlice2() {
        const ASSET_TABLE_ADDRESS = 0x8c203744;
        const TEXTURE_TABLE_ADDRESS = 0x8c203890;
        const OBJECT_TABLE_ADDRESS = 0x8c202f44;
        const ASSET_COUNT = 82;
        const OBJECTDATA_SIZE = 0x28;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSlice3() {
        const ASSET_TABLE_ADDRESS = 0x8c203c74;
        const TEXTURE_TABLE_ADDRESS = 0x8c203d04;
        const OBJECT_TABLE_ADDRESS = 0x8c203060;
        const ASSET_COUNT = 35;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractInteractables() {
        const ASSET_TABLE_ADDRESS = 0x8c204084;
        const TEXTURE_TABLE_ADDRESS = 0x8c204034;
        const OBJECT_TABLE_ADDRESS = 0x8c203298;
        const ASSET_COUNT = 20;
        const OBJECT_COUNT = 71;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, INTERACTABLE_COUNT,OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSkybox() {
        SkyboxMeshes.push(loadSkyboxMesh(execBuffer, texChunk.texlists ,SCENE_FILE ,0x8cc079a4, 0));

        return  { Meshes : SkyboxMeshes }
    }

    const slice1 = extractSlice1();
    const slice2 = extractSlice2();
    const slice3 = extractSlice3();
    const skybox = extractSkybox();
    //xayrga: An interactable has a vlist that the parser can't understand.
    //we need to fix that before we can have interactables on this map.
    //const interactables = extractInteractables();

    const crg1 = packStageData(texChunk, [slice1, slice2, slice3], STAGE_ALLOCATION_ADDRESS, skybox);
    saveStageData(dstFilename, crg1);
}

function extractStage6(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const texChunk = new TexChunk();

    extractTexLoadTable(texChunk, execBuffer, 0x8c186ad0);

    const SCENE_FILE = afsLoad('STAGE6.AFS', 0);
    const OBJECT_COUNT = 82;
    const INTERACTABLE_COUNT = OBJECT_COUNT;

    function extractSlice1() {
        const ASSET_TABLE_ADDRESS = 0x8c20af4c;
        const TEXTURE_TABLE_ADDRESS = 0x8c20b030;
        const OBJECT_TABLE_ADDRESS = 0x8c20a8f8;
        const ASSET_COUNT = 57;
        const OBJECTDATA_SIZE = 0x28;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSlice2() {
        const ASSET_TABLE_ADDRESS = 0x8c20b2dc;
        const TEXTURE_TABLE_ADDRESS = 0x8c20b2e4;
        const OBJECT_TABLE_ADDRESS = 0x8c20aa3c;
        const ASSET_COUNT = 1; 
        const OBJECTDATA_SIZE = 0x28;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractSlice3() {
        const ASSET_TABLE_ADDRESS = 0x8c20b2ec;
        const TEXTURE_TABLE_ADDRESS = 0x8c20b310;
        const OBJECT_TABLE_ADDRESS = 0x8c20ab80;
        const ASSET_COUNT = 9;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT, OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    function extractInteractables() {
        const ASSET_TABLE_ADDRESS = 0x8c20b49c;
        const TEXTURE_TABLE_ADDRESS = 0x8c20b52c;
        const OBJECT_TABLE_ADDRESS = 0x8c20ae08;
        const ASSET_COUNT = 36;
        const OBJECT_COUNT = 71;
        const OBJECTDATA_SIZE = 0x34;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = extractObjectTableSinglesSize(execBuffer, SCENE_FILE, OBJECT_TABLE_ADDRESS, OBJECT_COUNT,OBJECTDATA_SIZE);
        return { Models, Objects };
    }

    const slice1 = extractSlice1();
    const slice2 = extractSlice2();
    const slice3 = extractSlice3();
    // const interactables = extractInteractables(); xayrga: One of the textures in this breaks the PVR decoder.

    const crg1 = packStageData(texChunk, [slice1, slice2, slice3], STAGE_ALLOCATION_ADDRESS);
    saveStageData(dstFilename, crg1);
}

function extractStageLast(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const texChunk = new TexChunk();
	//8c1867d0
    //extractTexLoadTable(texChunk, execBuffer, 0x8c183d20, 0x8c800000, 2, 18);

    extractTexLoadTable(texChunk, execBuffer, 0x8c1867d0);
	
    const SCENE_FILE = afsLoad('STAGELAST.AFS', 1);
    const OBJECT_COUNT = 4;
    const ASSET_COUNT = 4;

    function createDummyObject(modelId: number) : ObjectData {
        return {
            ModelID: modelId,
            Translation: [0,0,0],
            Rotation: [0,0,0],
            Scale: [1,1,1], 
            Flags: 0 
        };
    }

    function extractObjects() {
        const ASSET_TABLE_ADDRESS = 0x8c1d0dc4;
        const TEXTURE_TABLE_ADDRESS = 0x8c1d0db0;

        const Models = extractModelTable(execBuffer, texChunk.texlists, SCENE_FILE, ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, ASSET_COUNT);
        const Objects = [] as ObjectData[];
        for (let i=0; i < ASSET_COUNT; i++)
            Objects[i] = createDummyObject(i);

        return { Models, Objects };
    }

    const slice1 = extractObjects();
    const crg1 = packStageData(texChunk, [slice1], STAGE_ALLOCATION_ADDRESS);
    saveStageData(dstFilename, crg1);
}



function extractGarage(dstFilename: string, execBuffer: ArrayBufferSlice): void {
    const texChunk = new TexChunk();


    // xayrga: We need to rewrite how textures are handled.
    // Textures and stages can be loaded to the same address, so we have to load the textures before we load the stage AFS. 
    // Textures are loaded first on the dreamcast, moved into the texture cache, then filled into their lists. 
    // We may need to simlate a behavior like this. 
    //extractTexLoadTable(texChunk, execBuffer, 0x8c183d20, 0x8c800000, 2, 18);

    const SCENE_FILE = afsLoad('GARAGE.AFS', 1);
    const OBJECT_COUNT = 1;
    const ASSET_COUNT = 1;

    function createDummyObject(modelId: number) : ObjectData {
        return {
            ModelID: modelId,
            Translation: [0,0,0],
            Rotation: [0,0,0],
            Scale: [1,1,1], 
            Flags: 0 
        };
    }

    function extractObjects() {
        const ASSET_TABLE_ADDRESS = 0x8c853fd8;
        const TEXTURE_TABLE_ADDRESS = 0x8c10e410;

		const Models =  createModelManual(ASSET_TABLE_ADDRESS, TEXTURE_TABLE_ADDRESS, texChunk.texlists, SCENE_FILE, STAGE_COMPACT_ALLOCATION_ADDRESS);
        //createModelManual(offset: number, texlist: number, texlists: Texlist[], afsFile: AFSReference, modelTableAddr: number, texlistTableAddr: number | null, tableCount: number): ModelData[] 
        const Objects = [] as ObjectData[];
        for (let i=0; i < ASSET_COUNT; i++)
            Objects[i] = createDummyObject(i);

        return { Models, Objects };
    }

    const slice1 = extractObjects();
    const crg1 = packStageData(texChunk, [slice1], STAGE_COMPACT_ALLOCATION_ADDRESS);
    saveStageData(dstFilename, crg1);
}

function main() {
    const exec = fetchDataSync(`${pathBaseIn}/1ST_READ.BIN`);
    extractStage1(`${pathBaseOut}/Stage1.crg1`, exec);
    extractStage2(`${pathBaseOut}/Stage2.crg1`, exec);
    extractStage3(`${pathBaseOut}/Stage3.crg1`, exec);
    extractStage5(`${pathBaseOut}/Stage5.crg1`, exec);
    extractStage6(`${pathBaseOut}/Stage6.crg1`, exec); 
    extractGarage(`${pathBaseOut}/Garage.crg1`, exec);  // xayrga: Renderer doesn't like the objects here. , disabled temporarily.
	extractStageLast(`${pathBaseOut}/StageLast.crg1`, exec)
}

main();
