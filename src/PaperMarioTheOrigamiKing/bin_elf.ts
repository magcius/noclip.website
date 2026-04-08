import { vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";

// Credit to https://github.com/Darxoon/OrigamiWand for parsing logic

export interface OrigamiMobjInstance {
    id: string;
    type: string;
    resolvedModelName: string;
    position: vec3;
    rotation: vec3;
}

export interface OrigamiSobjInstance {
    id: string;
    position: vec3;
    rotation: vec3;
    scale: vec3;
    modelPath: string;
    modelName: string;
}

export interface OrigamiItemInstance {
    id: string;
    type: string;
    resolvedModelName: string;
    position: vec3;
}

export interface OrigamiNPCInstance {
    id: string;
    type: string;
    resolvedModelName: string;
    position: vec3;
    rotationDeg: number;
}

export interface OrigamiMobjType {
    id: string;
    modelId: string;
}

export interface OrigamiItemType {
    id: string;
    modelId: string;
}

export interface OrigamiNPCType {
    id: string;
    modelId: string;
}

interface ModelAssetGroup {
    directory: string;
    file: string;
}

export interface OrigamiModelDef {
    id: string;
    assetGroups: ModelAssetGroup[];
    assetGroupOffset: number;
    assetGroupCount: number;
}

export enum OrigamiELFType {
    DisposMobj,
    DisposSobj,
    DisposAobj,
    DisposItem,
    DisposNPC,
    MobjType,
    ItemType,
    NPCType,
    MobjModel,
    ItemModel,
    NPCModel
}

class Section {
    public static size: number = 64;
    public nameOffset: number;
    public name: string = "";
    public type: number;
    public offset: number;
    public byteLength: number;

    constructor(view: DataView, offset: number) {
        this.nameOffset = view.getInt32(offset, true);
        this.type = view.getInt32(offset + 4, true);
        this.offset = view.getInt32(offset + 24, true);
        this.byteLength = view.getInt32(offset + 32, true);
    }
}

class Relocation {
    public static size: number = 24;
    public locationOffset: number;
    public infoLow: number;
    public infoHigh: number;
    public targetOffset: number;

    constructor(view: DataView, offset: number) {
        this.locationOffset = view.getInt32(offset, true);
        this.infoLow = view.getInt32(offset + 8, true);
        this.infoHigh = view.getInt32(offset + 12, true);
        this.targetOffset = view.getInt32(offset + 16, true);
    }
}

class Symbol {
    public static size: number = 24;
    public name: string;
    public info: number;
    public visibility: number;
    public sectionHeaderIndex: number;
    public location: number;
    public byteLength: number;

    constructor(view: DataView, offset: number, stringSectionOffset: number) {
        const nameOffset = view.getInt32(offset, true);
        // not going to bother deobfuscating the name but it's easy
        this.name = getStringAt(view, stringSectionOffset + nameOffset);
        this.info = view.getUint8(offset + 4);
        this.visibility = view.getUint8(offset + 5);
        this.sectionHeaderIndex = view.getInt16(offset + 6, true);
        this.location = view.getInt32(offset + 8, true);
        this.byteLength = view.getInt32(offset + 16, true);
    }
}

const MOBJ_INSTANCE_SIZE = 376;
const SOBJ_INSTANCE_SIZE = 184;
const ITEM_INSTANCE_SIZE = 128;
const NPC_INSTANCE_SIZE = 256;
const MOBJ_TYPE_SIZE = 144;
const ITEM_TYPE_SIZE = 208;
const NPC_TYPE_SIZE = 272;
const MODEL_DEF_SIZE = 144;
const MODEL_ASSET_GROUP_SIZE = 40;
const TEXT_DECODER = new TextDecoder("utf-8");

function getStringAt(view: DataView, offset: number): string {
    // strings aren't preceded by their length, just read until 0
    const c: number[] = [];
    let end = false;
    while (!end) {
        const n = view.getUint8(offset);
        if (n !== 0) {
            c.push(n);
            offset++;
        } else {
            end = true;
        }
    }
    return TEXT_DECODER.decode(new Uint8Array(c));
}

function parseDataSection_MObjInstances(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): OrigamiMobjInstance[] {
    const instances: OrigamiMobjInstance[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation2 = relocations.get(8 + MOBJ_INSTANCE_SIZE * i)!;
        const relocation3 = relocations.get(16 + MOBJ_INSTANCE_SIZE * i)!;
        const id = getStringAt(view, dataStringOffset + relocation2.targetOffset);
        const type = getStringAt(view, dataStringOffset + relocation3.targetOffset);
        const x = view.getFloat32(pointer + 24, true);
        const y = view.getFloat32(pointer + 28, true);
        const z = view.getFloat32(pointer + 32, true);
        const rx = view.getFloat32(pointer + 36, true);
        const ry = view.getFloat32(pointer + 40, true);
        const rz = view.getFloat32(pointer + 44, true);
        instances.push({ id, type, resolvedModelName: "", position: [x, y, z], rotation: [rx, ry, rz] });
        pointer += MOBJ_INSTANCE_SIZE;
    }
    return instances;
}

function parseDataSection_SObjInstances(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): OrigamiSobjInstance[] {
    const instances: OrigamiSobjInstance[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation2 = relocations.get(8 + SOBJ_INSTANCE_SIZE * i)!;
        const relocation3 = relocations.get(64 + SOBJ_INSTANCE_SIZE * i)!;
        const relocation4 = relocations.get(72 + SOBJ_INSTANCE_SIZE * i)!;
        const id = getStringAt(view, dataStringOffset + relocation2.targetOffset);
        const modelPath = getStringAt(view, dataStringOffset + relocation3.targetOffset);
        const modelName = getStringAt(view, dataStringOffset + relocation4.targetOffset);
        const x = view.getFloat32(pointer + 16, true);
        const y = view.getFloat32(pointer + 20, true);
        const z = view.getFloat32(pointer + 24, true);
        const rx = view.getFloat32(pointer + 28, true);
        const ry = view.getFloat32(pointer + 32, true);
        const rz = view.getFloat32(pointer + 36, true);
        const sx = view.getFloat32(pointer + 40, true);
        const sy = view.getFloat32(pointer + 44, true);
        const sz = view.getFloat32(pointer + 48, true);
        instances.push({ id, position: [x, y, z], rotation: [rx, ry, rz], scale: [sx, sy, sz], modelPath, modelName });
        pointer += SOBJ_INSTANCE_SIZE;
    }
    return instances;
}

function parseDataSection_ItemInstances(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): OrigamiItemInstance[] {
    const instances: OrigamiItemInstance[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation2 = relocations.get(8 + ITEM_INSTANCE_SIZE * i)!;
        const relocation3 = relocations.get(16 + ITEM_INSTANCE_SIZE * i)!;
        const id = getStringAt(view, dataStringOffset + relocation2.targetOffset);
        const type = getStringAt(view, dataStringOffset + relocation3.targetOffset);
        const x = view.getFloat32(pointer + 24, true);
        const y = view.getFloat32(pointer + 28, true);
        const z = view.getFloat32(pointer + 32, true);
        instances.push({ id, type, resolvedModelName: "", position: [x, y, z] });
        pointer += ITEM_INSTANCE_SIZE;
    }
    return instances;
}

function parseDataSection_NPCInstances(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): OrigamiNPCInstance[] {
    const instances: OrigamiNPCInstance[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation2 = relocations.get(8 + NPC_INSTANCE_SIZE * i)!;
        const relocation3 = relocations.get(16 + NPC_INSTANCE_SIZE * i)!;
        const id = getStringAt(view, dataStringOffset + relocation2.targetOffset);
        const type = getStringAt(view, dataStringOffset + relocation3.targetOffset);
        const x = view.getFloat32(pointer + 24, true);
        const y = view.getFloat32(pointer + 28, true);
        const z = view.getFloat32(pointer + 32, true);
        const r = view.getFloat32(pointer + 36, true);
        instances.push({ id, type, resolvedModelName: "", position: [x, y, z], rotationDeg: r });
        pointer += NPC_INSTANCE_SIZE;
    }
    return instances;
}

function parseDataSection_MObjTypes(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): OrigamiMobjType[] {
    const types: OrigamiMobjType[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation1 = relocations.get(MOBJ_TYPE_SIZE * i)!;
        const relocation3 = relocations.get(16 + MOBJ_TYPE_SIZE * i)!;
        const id = getStringAt(view, dataStringOffset + relocation1.targetOffset);
        const modelId = getStringAt(view, dataStringOffset + relocation3.targetOffset);
        types.push({ id, modelId });
        pointer += MOBJ_TYPE_SIZE;
    }
    return types;
}

function parseDataSection_ItemTypes(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): OrigamiItemType[] {
    const types: OrigamiItemType[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation1 = relocations.get(ITEM_TYPE_SIZE * i)!;
        const relocation3 = relocations.get(24 + ITEM_TYPE_SIZE * i)!; // type "KP" doesn't have a model ID
        const id = relocation1 ? getStringAt(view, dataStringOffset + relocation1.targetOffset) : "";
        const modelId = relocation3 ? getStringAt(view, dataStringOffset + relocation3.targetOffset) : "";
        types.push({ id, modelId });
        pointer += ITEM_TYPE_SIZE;
    }
    return types;
}

function parseDataSection_NPCTypes(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): OrigamiNPCType[] {
    const types: OrigamiItemType[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation1 = relocations.get(NPC_TYPE_SIZE * i)!;
        const relocation2 = relocations.get(8 + NPC_TYPE_SIZE * i)!;
        const id = relocation1 ? getStringAt(view, dataStringOffset + relocation1.targetOffset) : "";
        const modelId = relocation2 ? getStringAt(view, dataStringOffset + relocation2.targetOffset) : "";
        types.push({ id, modelId });
        pointer += NPC_TYPE_SIZE;
    }
    return types;
}

function parseDataSection_ModelDefs(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): OrigamiModelDef[] {
    const models: OrigamiModelDef[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation1 = relocations.get(MODEL_DEF_SIZE * i)!;
        const relocationX = relocations.get(112 + MODEL_DEF_SIZE * i)!;
        const id = getStringAt(view, dataStringOffset + relocation1.targetOffset);
        const assetGroupOffset = relocationX.targetOffset;
        const assetGroupCount = view.getInt32(pointer + 120, true);
        models.push({ id, assetGroups: [], assetGroupOffset, assetGroupCount });
        pointer += MODEL_DEF_SIZE;
    }
    return models;
}

function parseDataSection_ModelAssetGroup(view: DataView, section: Section, count: number, offset: number, dataStringOffset: number, relocations: Map<number, Relocation>): ModelAssetGroup[] {
    const groups: ModelAssetGroup[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation1 = relocations.get(offset + MODEL_ASSET_GROUP_SIZE * i)!;
        const relocation2 = relocations.get(offset + 8 + MODEL_ASSET_GROUP_SIZE * i)!;
        const directory = getStringAt(view, dataStringOffset + relocation1.targetOffset);
        const file = getStringAt(view, dataStringOffset + relocation2.targetOffset);
        groups.push({ directory, file });
        pointer += MODEL_ASSET_GROUP_SIZE;
    }
    return groups;
}

export function parseOrigamiELF(buffer: ArrayBufferSlice, type: OrigamiELFType): any {
    const view = buffer.createDataView();
    const sectionHeaderTableOffset = view.getInt32(0x28, true);
    const sectionCount = view.getInt16(0x3C, true);
    let pointer = sectionHeaderTableOffset;

    const sections: Section[] = [];
    for (let i = 0; i < sectionCount; i++) {
        sections.push(new Section(view, pointer));
        pointer += Section.size;
    }

    const stringSectionIndex = view.getInt16(0x3E, true);
    const stringSection = sections[stringSectionIndex];

    const relocations = new Map<string, Map<number, Relocation>>();
    for (const s of sections) {
        s.name = getStringAt(view, stringSection.offset + s.nameOffset);
        if (s.name.startsWith(".rela")) {
            pointer = s.offset;
            const rel = new Map();
            while (pointer < s.offset + s.byteLength) {
                const r = new Relocation(view, pointer);
                rel.set(r.locationOffset, r);
                pointer += Relocation.size;
            }
            relocations.set(s.name.slice(5), rel);
        }
    }

    const dataSection = sections.find(s => s.name === ".data")!;
    const rodataSection = sections.find(s => s.name === ".rodata")!;
    const rodataStringSection = sections.find(s => s.name === ".rodata.str1.1")!;
    const rodataCount = view.getInt32(rodataSection.offset, true);

    if (!dataSection || !rodataStringSection) {
        // some files are "empty" but still exist
        return [];
    }

    const symbolTable: Symbol[] = [];
    if (type === OrigamiELFType.MobjModel || type === OrigamiELFType.ItemModel || type === OrigamiELFType.NPCModel) {
        // only bother to get symbols for model defs
        const symbolSection = sections.find(s => s.name === ".symtab")!;
        const start = symbolSection.offset;
        pointer = symbolSection.offset;
        while (pointer < start + symbolSection.byteLength) {
            symbolTable.push(new Symbol(view, pointer, stringSection.offset));
            pointer += Symbol.size;
        }
    }

    let data;
    switch (type) {
        case OrigamiELFType.DisposAobj:
        case OrigamiELFType.DisposMobj:
            data = parseDataSection_MObjInstances(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case OrigamiELFType.DisposSobj:
            data = parseDataSection_SObjInstances(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case OrigamiELFType.DisposItem:
            data = parseDataSection_ItemInstances(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case OrigamiELFType.DisposNPC:
            data = parseDataSection_NPCInstances(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case OrigamiELFType.MobjType:
            data = parseDataSection_MObjTypes(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case OrigamiELFType.ItemType:
            data = parseDataSection_ItemTypes(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case OrigamiELFType.NPCType:
            data = parseDataSection_NPCTypes(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case OrigamiELFType.MobjModel:
        case OrigamiELFType.ItemModel:
        case OrigamiELFType.NPCModel:
            let symbolName;
            switch (type) {
                case OrigamiELFType.MobjModel:
                    symbolName = "_ZN3wld3fld4data13modelMobj_numE";
                    break;
                case OrigamiELFType.ItemModel:
                    symbolName = "_ZN3wld3fld4data13modelItem_numE";
                    break;
                case OrigamiELFType.NPCModel:
                default:
                    symbolName = "_ZN3wld3fld4data12modelNpc_numE";
                    break;
            }
            const countSymbol = symbolTable.find(s => s.name === symbolName)!;
            const dataCount = view.getInt32(rodataSection.offset + countSymbol.location, true);
            const rawModels = parseDataSection_ModelDefs(view, dataSection, dataCount, rodataStringSection.offset, relocations.get(".data")!);
            // patch asset groups
            for (const model of rawModels) {
                const d = parseDataSection_ModelAssetGroup(view, rodataSection, model.assetGroupCount, model.assetGroupOffset, rodataStringSection.offset, relocations.get(".rodata")!);
                model.assetGroups = d;
            }
            data = rawModels;
            break;
        default:
            data = null;
            break;
    }

    return data;
}
