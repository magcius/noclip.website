import { vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";

// Credit to https://github.com/Darxoon/OrigamiWand for parsing logic (albeit overly complicated for some reason)

export interface MObjInstance {
    id: string;
    typeId: string;
    resolvedModelName: string;
    position: vec3;
    rotation: vec3;
}

export interface SObjInstance {
    id: string;
    position: vec3;
    rotation: vec3;
    scale: vec3;
    modelPath: string;
    modelName: string;
}

export interface MObjType {
    id: string;
    modelId: string;
}

interface ModelAssetGroup {
    directory: string;
    file: string;
}

export interface MObjModel {
    id: string;
    assetGroups: ModelAssetGroup[];
    assetGroupOffset: number;
    assetGroupCount: number;
}

export enum ELFType {
    DisposMobj,
    DisposSobj,
    DataMobj,
    DataMobjModel
}

class Section {
    public static size: number = 64;
    nameOffset: number;
	name: string;
	type: number;
	offset: number;
    byteLength: number;
	
	constructor(view: DataView, offset: number) {
		this.nameOffset = view.getInt32(offset, true);
		this.type = view.getInt32(offset + 4, true);
		this.offset = view.getInt32(offset + 24, true);
        this.byteLength = view.getInt32(offset + 32, true);
	}
}

class Relocation {
    public static size: number = 24;
    locationOffset: number;
    infoLow: number;
    infoHigh: number;
    targetOffset: number;

	constructor(view: DataView, offset: number) {
        this.locationOffset = view.getInt32(offset, true);
        this.infoLow = view.getInt32(offset + 8, true);
        this.infoHigh = view.getInt32(offset + 12, true);
        this.targetOffset = view.getInt32(offset + 16, true);
    }
}

class Symbol {
    public static size: number = 24;
    name: string;
    info: number;
    visibility: number;
    sectionHeaderIndex: number;
    location: number;
    byteLength: number;

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

const MODEL_ASSET_GROUP_SIZE = 40;
const MOBJ_INSTANCE_SIZE = 376;
const SOBJ_INSTANCE_SIZE = 184;
const MOBJ_TYPE_SIZE = 144;
const MOBJ_MODEL_SIZE = 144;
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

function parseDataSection_MObjInstances(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): MObjInstance[] {
    const instances: MObjInstance[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation2 = relocations.get(8 + MOBJ_INSTANCE_SIZE * i)!;
        const relocation3 = relocations.get(16 + MOBJ_INSTANCE_SIZE * i)!;
        const id = getStringAt(view, dataStringOffset + relocation2.targetOffset);
        const typeId = getStringAt(view, dataStringOffset + relocation3.targetOffset);
        const x = view.getFloat32(pointer + 24, true);
        const y = view.getFloat32(pointer + 28, true);
        const z = view.getFloat32(pointer + 32, true);
        const rx = view.getFloat32(pointer + 36, true);
        const ry = view.getFloat32(pointer + 40, true);
        const rz = view.getFloat32(pointer + 44, true);
        instances.push({ id, typeId, resolvedModelName: "", position: [x, y, z], rotation: [rx, ry, rz] });
        pointer += MOBJ_INSTANCE_SIZE;
    }
    return instances;
}

function parseDataSection_SObjInstances(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): SObjInstance[] {
    const instances: SObjInstance[] = [];
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

function parseDataSection_MObjTypes(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): MObjType[] {
    const types: MObjType[] = [];
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

function parseDataSection_MObjModels(view: DataView, section: Section, count: number, dataStringOffset: number, relocations: Map<number, Relocation>): MObjModel[] {
    const models: MObjModel[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const relocation1 = relocations.get(MOBJ_MODEL_SIZE * i)!;
        const relocationX = relocations.get(112 + MOBJ_MODEL_SIZE * i)!;
        const id = getStringAt(view, dataStringOffset + relocation1.targetOffset);
        const assetGroupOffset = relocationX.targetOffset; // relocated value for some reason, not directly at 112
        const assetGroupCount = view.getInt32(pointer + 120, true);
        models.push({ id, assetGroups: [], assetGroupOffset, assetGroupCount });
        pointer += MOBJ_MODEL_SIZE;
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

export function parseELF(buffer: ArrayBufferSlice, type: ELFType): any {
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

    const dataSection = sections.find(s => s.name == ".data")!;
    const rodataSection = sections.find(s => s.name == ".rodata")!;
    const rodataStringSection = sections.find(s => s.name == ".rodata.str1.1")!;
    const rodataCount = view.getInt32(rodataSection.offset, true);

    let symbolTable: Symbol[] = [];
    if (type === ELFType.DataMobjModel) {
        const symbolSection = sections.find(s => s.name == ".symtab")!;
        const start = symbolSection.offset;
        pointer = symbolSection.offset;
        while (pointer < start + symbolSection.byteLength) {
            symbolTable.push(new Symbol(view, pointer, stringSection.offset));
            pointer += Symbol.size;
        }
    }

    let data;
    switch (type) {
        case ELFType.DisposMobj:
            data = parseDataSection_MObjInstances(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case ELFType.DisposSobj:
            data = parseDataSection_SObjInstances(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case ELFType.DataMobj:
            data = parseDataSection_MObjTypes(view, dataSection, rodataCount, rodataStringSection.offset, relocations.get(".data")!);
            break;
        case ELFType.DataMobjModel:
            const countSymbol = symbolTable.find(s => s.name == "_ZN3wld3fld4data13modelMobj_numE")!;
            const dataCount = view.getInt32(rodataSection.offset + countSymbol.location, true);
            const rawModels = parseDataSection_MObjModels(view, dataSection, dataCount, rodataStringSection.offset, relocations.get(".data")!);
            for (const model of rawModels) {
                // patch asset groups
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
