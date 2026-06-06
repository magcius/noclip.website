import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice } from "../gfx/platform/GfxPlatform";
import { Color } from "../Color";
import { assert, nArray } from "../util";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { ClassEntry } from "./bin-index";

// rotate the whole world 90 degrees
const _noclipSpaceFromRatchetSpace = mat4.create();
mat4.rotateX(_noclipSpaceFromRatchetSpace, mat4.clone(_noclipSpaceFromRatchetSpace), -Math.PI / 2);
export const noclipSpaceFromRatchetSpace = _noclipSpaceFromRatchetSpace as ReadonlyMat4;

export function matrixToNoclipSpace(matrix: ReadonlyMat4): mat4 {
    const out = mat4.clone(matrix);
    out[15] = 1;
    return mat4.mul(out, noclipSpaceFromRatchetSpace, out);
}

// make map of oClass to instances of that oClass
export function makeInstanceOClassMap<T extends { oClass: number }>(instances: T[]) {
    const map = new Map<number, T[]>();
    for (const inst of instances) {
        if (!map.has(inst.oClass)) {
            map.set(inst.oClass, []);
        }
        map.get(inst.oClass)!.push(inst);
    }
    return map;
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

export function readRGB5A1(rgba: number): Color {
    const r = (rgba & 0x1F) << 3;
    const g = ((rgba >> 5) & 0x1F) << 3;
    const b = ((rgba >> 10) & 0x1F) << 3;
    const a = (rgba >> 15) === 1 ? 0xFF : 0x00;
    return { r, g, b, a };
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
