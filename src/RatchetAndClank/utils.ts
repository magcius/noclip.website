import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice } from "../gfx/platform/GfxPlatform";
import { Color } from "../Color";
import { assert, nArray } from "../util";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { ClassEntry } from "./bin-index";
import { ChunkPlane, MobyInstance, OcclusionMappings, TieInstance } from "./bin-gameplay";
import { Occlusion } from "./bin-core";
import { DataViewExt } from "./DataViewExt";

// game number shorthand
export type GN = 1 | 2 | 3 | 4;

// rotate the whole world 90 degrees
const _noclipSpaceFromRatchetSpace = mat4.create();
mat4.rotateX(_noclipSpaceFromRatchetSpace, mat4.clone(_noclipSpaceFromRatchetSpace), -Math.PI / 2);
export const noclipSpaceFromRatchetSpace = _noclipSpaceFromRatchetSpace as ReadonlyMat4;
export const ratchetSpaceFromNoclipSpace = mat4.invert(mat4.create(), _noclipSpaceFromRatchetSpace) as ReadonlyMat4;

export function matrixToNoclipSpace(matrix: ReadonlyMat4): mat4 {
    const out = mat4.clone(matrix);
    out[15] = 1;
    return mat4.mul(out, noclipSpaceFromRatchetSpace, out);
}

// make map of oClass to instances of that oClass
export function makeInstanceOClassMap<T extends { oClass: number }>(instances: (T | null)[]) {
    const map = new Map<number, T[]>();
    for (const inst of instances) {
        if (!inst) continue;
        if (!map.has(inst.oClass)) {
            map.set(inst.oClass, []);
        }
        map.get(inst.oClass)!.push(inst);
    }
    return Array.from(map.values());
}

// make map of oClass to texture indices
export function makeTextureIndicesByOClassMap(classEntries: ClassEntry[]) {
    const map = new Map<number, number[]>();
    for (const classEntry of classEntries) {
        const oClass = classEntry.oClass;
        map.set(oClass, truncateTrailing0xFF(classEntry.textures));
    }
    return map;
}

// make map of oClass to class
export function makeClassOClassMap<T>(entries: { oClass: number }[], classes: T[]): Map<number, T> {
    const map = new Map<number, T>();
    for (let i = 0; i < entries.length; i++) {
        const oClass = entries[i]!.oClass;
        if (!map.has(oClass)) {
            map.set(oClass, classes[i]);
        }
    }
    return map;
}

// return the chunk index that a position belongs to
export function ownerChunk(pos: vec3, chunkPlanes: ChunkPlane[]): number {
    if (!chunkPlanes) return 0;
    for (let j = 0; j < chunkPlanes.length; j++) {
        const plane = chunkPlanes[j];
        const v = vec3.sub(vec3.create(), pos, plane._pointInNoclipSpace);
        const dot = vec3.dot(v, plane._normalInNoclipSpace);
        if (dot >= 0) {
            return j + 1;
        }
    }
    return 0;
}

// filter tie or shrub instances matching a chunk id
export function filterInstancesByChunkPlane<T extends { _matrixPretransformed: mat4 }>(chunkNumber: number | null, instances: T[], chunkPlanes: ChunkPlane[] | undefined): (T | null)[] {
    if (!chunkPlanes) return instances;
    if (chunkNumber === null) return instances;

    const out: (T | null)[] = [];
    for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const pos = mat4.getTranslation(vec3.create(), instance._matrixPretransformed);
        if (ownerChunk(pos, chunkPlanes) === chunkNumber) {
            out.push(instance);
        } else {
            out.push(null);
        }
    }

    return out;
}

// filter moby instances matching a chunk id
export function filterMobyInstancesByChunkPlane(chunkNumber: number | null, instances: MobyInstance[], chunkPlanes: ChunkPlane[] | undefined): MobyInstance[] {
    if (!chunkPlanes) return instances;
    if (chunkNumber === null) return instances;
    const out: MobyInstance[] = [];
    for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const pos = vec3.fromValues(instance.position.x, instance.position.y, instance.position.z);
        vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
        if (ownerChunk(pos, chunkPlanes) === chunkNumber) {
            out.push(instance);
        }
    }
    return out;
}

// get bits from startBit to endBit (inclusive)
export function getBits(value: number, startBit: number, endBit: number) {
    return (value >> startBit) & ((1 << (endBit - startBit + 1)) - 1);
}

export function lineChainToLineSegments(points: { x: number, y: number, z: number }[], color: Color): { from: vec3, to: vec3, color: Color }[] {
    const lines: { from: vec3, to: vec3, color: Color }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i]!;
        const p1 = points[i + 1]!;
        const from = vec3.fromValues(p0.x, p0.y, p0.z);
        const to = vec3.fromValues(p1.x, p1.y, p1.z);
        vec3.transformMat4(from, from, noclipSpaceFromRatchetSpace);
        vec3.transformMat4(to, to, noclipSpaceFromRatchetSpace);
        lines.push({ from, to, color });
    }
    return lines;
}

export function truncateTrailing0xFF(arr: number[]): number[] {
    const copy = arr.slice();
    while (copy.length > 0 && copy[copy.length - 1] === 0xFF) {
        copy.pop();
    }
    return copy;
}

export function readA1BGR5(view: DataViewExt): { a: number, r: number, g: number, b: number } {
    const value = view.getUint16(0x0);
    const a = ((value >> 15) & 0x1) << 7;
    const b = ((value >> 10) & 0x1F) << 3;
    const g = ((value >> 5) & 0x1F) << 3;
    const r = (value & 0x1F) << 3;
    return { a, r, g, b };
}

// I call this one "The Headless Chicken"
export function populateMobyOcclusionBits(instances: MobyInstance[], mappings: OcclusionMappings | null) {
    if (!mappings) return;

    // you think the list would be empty if there are no occludable mobys?
    // wrong. you get garbage data.
    if (!instances.find(inst => inst.skipOcclusionCheck === 0)) return;

    function findMapping(uid: number) {
        for (let i = 0; i < mappings!.mobyMappings.length; i += 2) {
            if (mappings!.mobyMappings[i + 1] === uid) {
                return i;
            }
        }
        return null;
    }

    let ptr = 0;
    for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        if (!inst.skipOcclusionCheck) {
            const mobyUid = inst.uid;
            const occlusionUid = mappings.mobyMappings[ptr + 1];
            if (mobyUid !== occlusionUid) {
                // it doesn't match, try jumping to wherever that uid appears
                const guess = findMapping(mobyUid);
                if (guess !== null) {
                    // ok, seek to that uid
                    ptr = guess;
                } else {
                    // it's not here? i guess I'll just disable occlusion on this moby...
                    inst.skipOcclusionCheck = 1;
                    continue;
                }
            }

            // yay
            inst._occlusionBit = mappings.mobyMappings[ptr];
            assert(inst._occlusionBit < 1024);
            ptr += 2;
        }
    }
}

// And I call this one "Two Headless Chickens"
export function populateTieOcclusionBits(instances: TieInstance[], mappings: OcclusionMappings | null) {
    if (!mappings) return;

    let mappingPtr = 0;
    outer: do {
        let instancePtr = 0;
        let prevMappingPtr = mappingPtr;

        while (instancePtr < instances.length) {
            if (mappingPtr >= mappings.tieMappings.length) break outer;
            const occlusionUid = mappings.tieMappings[mappingPtr + 1];
            if (occlusionUid === -1) break;

            const inst = instances[instancePtr];
            const tieUid = inst.occlusionIndex;
            if (tieUid !== occlusionUid) {
                // if it doesn't match we skip over the INSTANCE array
                // (for each instance we skip here there will be one trailing -1 at the end of the array) (usually)
                instancePtr++;
                continue;
            }

            // yay
            inst._occlusionBit = mappings.tieMappings[mappingPtr];
            assert(inst._occlusionBit < 1024);
            mappingPtr += 2;
            instancePtr++;
        }

        while (mappingPtr !== mappings.tieMappings.length && mappings.tieMappings[mappingPtr] === -1) {
            // consume all the -1s until the end of the list or a non -1
            mappingPtr += 2;
        }

        if (mappingPtr === prevMappingPtr) {
            // on rac4 dreadzone station, there are wierd mappings where the uid is set to -1 instead of the bit
            mappingPtr += 2;
        }

        // go back to the start of the instance list and loop over the remaining mappings
    } while (mappingPtr < mappings.tieMappings.length);
}

export class OcclusionChecker {

    // 128 byte buffer
    public mask: Uint8Array | null = null;
    private maskId: number | null = null;

    /**
     * To check visibility:
     * ```
     * if (occlusionChecker.mask) {
     *   const bit = inst._occlusionBit;
     *   isVisible = (occlusionChecker.mask[bit >> 3] & (1 << (bit % 8))) === 0;
     * }
     * ```
     */
    public tfragMappings: Int32Array;
    public tieMappings: Int32Array;
    public mobyMappings: Int32Array;

    constructor(private occlusionGrid: Occlusion, private occlusionMappings: OcclusionMappings) {
        this.tfragMappings = occlusionMappings.tfragMappings;
        this.tieMappings = occlusionMappings.tieMappings;
        this.mobyMappings = occlusionMappings.mobyMappings;
    }

    setCameraPosition(pos: vec3) {
        const x = Math.floor(pos[0] / 4);
        const y = Math.floor(-pos[2] / 4);
        const z = Math.floor(pos[1] / 4);

        const nextMaskId = this.occlusionGrid.grid.get(z)?.get(y)?.get(x) ?? null;
        if (nextMaskId === this.maskId) return;

        if (nextMaskId === null) {
            this.maskId = null;
            this.mask = null;
        } else {
            this.maskId = nextMaskId;
            this.mask = this.occlusionGrid.masks.subview(nextMaskId * 128, 128).getTypedArrayView(Uint8Array);
        }
    }
}

export type MegaBuffer = {
    /**
     * Pointer in floats.
     */
    ptr: number,
    buffer: ArrayBuffer,
    f32View: Float32Array,
    u8View: Uint8Array,
    gfxBuffer: GfxBuffer,

    /**
     * Uploads the used portion of the buffer and resets the pointer to 0.
     */
    upload: () => void,

    destroy: () => void,
};

/**
 * Create a shared buffer for uploading instance data.
 */
export function createMegaBuffer(device: GfxDevice, name: string, initialSizeInBytes: number): MegaBuffer {
    let byteSize = initialSizeInBytes;
    const gfxBuffer = device.createBuffer(byteSize, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
    device.setResourceName(gfxBuffer, name);

    const arrayBuffer = new ArrayBuffer(byteSize);
    const f32View = new Float32Array(arrayBuffer);
    const u8View = new Uint8Array(arrayBuffer);

    const megaBuffer: MegaBuffer = {
        ptr: 0,
        buffer: arrayBuffer,
        f32View,
        u8View,
        gfxBuffer,

        upload() {
            if (this.ptr === 0) return;
            if (this.ptr * 4 > byteSize) {
                throw new Error(`Buffer overflow`);
            }
            device.uploadBufferData(this.gfxBuffer, 0, this.u8View, 0, this.ptr * 4);
            this.ptr = 0;
        },

        destroy() {
            device.destroyBuffer(this.gfxBuffer);
        }
    };
    return megaBuffer;
}

export enum ImaginaryGsCommandType {
    PRIMITIVE_RESET = 1,
    SET_MATERIAL = 2,
    VERTEX = 3,
}

export type ImaginaryGsCommand<PrimitiveType, MaterialType, VertexType> =
    | {
        type: ImaginaryGsCommandType.PRIMITIVE_RESET,
        size: number,
        value: PrimitiveType,
    }
    | {
        type: ImaginaryGsCommandType.SET_MATERIAL,
        size: number,
        value: MaterialType,
    }
    | {
        type: ImaginaryGsCommandType.VERTEX,
        size: number,
        value: VertexType,
    }

export class ImaginaryGsCommandBuffer<PrimitiveType, MaterialType, VertexType> {
    public slots: (ImaginaryGsCommand<PrimitiveType, MaterialType, VertexType> | null)[] = nArray(0x100, () => null);
    maxSlotUsed = 0;

    writePrimitiveReset(address: number, size: number, primitive: PrimitiveType, allowOverwrite: boolean = false) {
        this.write(address, { type: ImaginaryGsCommandType.PRIMITIVE_RESET, size, value: primitive }, allowOverwrite);
    }

    writeSetMaterial(address: number, size: number, material: MaterialType, allowOverwrite: boolean = false) {
        this.write(address, { type: ImaginaryGsCommandType.SET_MATERIAL, size, value: material }, allowOverwrite);
    }

    writeVertex(address: number, size: number, vertex: VertexType, allowOverwrite: boolean = false) {
        this.write(address, { type: ImaginaryGsCommandType.VERTEX, size, value: vertex }, allowOverwrite);
    }

    private write(address: number, command: any, allowOverwrite: boolean): void {
        assert(address >= 0 && address < 0x100);
        if (!allowOverwrite) {
            assert(this.slots[address] === null);
        }
        this.slots[address] = command;
        this.maxSlotUsed = Math.max(this.maxSlotUsed, address);
    }

    finish() {
        if (IS_DEVELOPMENT) {
            // validation
            let expectedEmptySlots = 0;
            let expectPrimitiveRestart = true;
            for (let i = 0; i < this.maxSlotUsed; i++) {
                const command = this.slots[i];
                if (command) {
                    if (expectedEmptySlots !== 0) {
                        throw new Error(`Unexpected write to GS command buffer`);
                    }
                    if (command.type === ImaginaryGsCommandType.VERTEX && expectPrimitiveRestart) {
                        throw new Error(`Expected a primitive restart command before first vertex`);
                    }
                    if (command.type === ImaginaryGsCommandType.PRIMITIVE_RESET) {
                        expectPrimitiveRestart = false;
                    }
                    if (command.type === ImaginaryGsCommandType.SET_MATERIAL) {
                        expectPrimitiveRestart = true;
                    }
                    expectedEmptySlots += command.size;
                } else {
                    if (expectedEmptySlots === 0) {
                        throw new Error(`Expected a write to GS command buffer`);
                    }
                }
                expectedEmptySlots--;
            }
        }
        return this.slots.filter(cmd => cmd !== null);
    }
}
