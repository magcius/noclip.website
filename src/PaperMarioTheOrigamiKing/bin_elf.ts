import { vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";

// Credit to https://github.com/Darxoon/OrigamiWand for parsing logic (albeit overly complicated for some reason)

export interface MObjInstance {
    id: string;
    type: string;
    position: vec3;
    rotation: vec3;
}

export interface ELF_Mobj {
    instances: MObjInstance[];
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

const MOBJ_INSTANCE_SIZE = 376;
const TEXT_DECODER = new TextDecoder("utf-8");

function getStringAt(view: DataView, offset: number): string {
    let endPos = offset;
    while (view.getUint8(endPos) !== 0) {
        endPos++;
    }
    return TEXT_DECODER.decode(view.buffer.slice(offset, endPos));
}

function parseDataSection_MObjInstance(view: DataView, section: Section, count: number): MObjInstance[] {
    const data: MObjInstance[] = [];
    let pointer = section.offset;
    for (let i = 0; i < count; i++) {
        const x = view.getFloat32(pointer + 24, true);
        const y = view.getFloat32(pointer + 28, true);
        const z = view.getFloat32(pointer + 32, true);
        const rx = view.getFloat32(pointer + 36, true);
        const ry = view.getFloat32(pointer + 40, true);
        const rz = view.getFloat32(pointer + 44, true);
        data.push({ id: "", type: "", position: [x, y, z], rotation: [rx, ry, rz] });
        pointer += MOBJ_INSTANCE_SIZE;
    }
    return data;
}

function resolveStrings_MObjInstance(view: DataView, stringSection: Section, relocations: Map<number, Relocation>, mobjInstances: MObjInstance[]) {
    for (let i = 0; i < mobjInstances.length; i++) {
        const instance = mobjInstances[i];
        // starts with unused "stage" string, already know what level it is
        const relocation2 = relocations.get(8 + MOBJ_INSTANCE_SIZE * i)!;
        const relocation3 = relocations.get(16 + MOBJ_INSTANCE_SIZE * i)!;
        instance.id = getStringAt(view, stringSection.offset + relocation2.targetOffset);
        instance.type = getStringAt(view, stringSection.offset + relocation3.targetOffset);
    }
}

export function parseELF_Mobj(buffer: ArrayBufferSlice): ELF_Mobj {
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
    const dataStringSection = sections.find(s => s.name == ".rodata.str1.1")!;
    const rodataSection = sections.find(s => s.name == ".rodata")!;
    const dataCount = view.getInt32(rodataSection.offset, true);

    const instances: MObjInstance[] = parseDataSection_MObjInstance(view, dataSection, dataCount);
    resolveStrings_MObjInstance(view, dataStringSection, relocations.get(".data")!, instances);

    return { instances };
}
