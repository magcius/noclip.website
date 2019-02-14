
// Parse uniform buffer definitions, and provide helpers for filling them...

import { Color } from "../../Color";
import { mat4, mat2d, vec3 } from "gl-matrix";
import { GfxBuffer, GfxHostAccessPass, GfxBufferBinding } from "../platform/GfxPlatform";
import { assert, assertExists } from "../../util";
import { GfxRenderBuffer } from "../render/GfxRenderBuffer";

function findall(haystack: string, needle: RegExp): RegExpExecArray[] {
    const results: RegExpExecArray[] = [];
    while (true) {
        const result = needle.exec(haystack);
        if (!result)
            break;
        results.push(result);
    }
    return results;
}

export interface StructField {
    name: string;
    type: string;
    arraySize: number;
    wordSize: number;
}

export interface StructLayout {
    blockName: string;
    fields: StructField[];
    totalWordSize: number;
}

const builtinTypeWordSizes = new Map<string, number>();
builtinTypeWordSizes.set('float',  1);
builtinTypeWordSizes.set('vec4',   4);
builtinTypeWordSizes.set('mat4x2', 4*2);
builtinTypeWordSizes.set('mat4x3', 4*3);
builtinTypeWordSizes.set('mat4',   4*4);

class ShaderLayoutMap {
    constructor() {
    }

    public parseShaderSource(shaderSource: string, uniformBufferLayouts: StructLayout[]): void {
    }
}

function getTypeSize(layouts: Map<string, StructLayout>, type: string): number {
    if (layouts.has(type))
        return layouts.get(type).totalWordSize;
    else
        return builtinTypeWordSizes.get(type);
}

function parseDefinition(layouts: Map<string, StructLayout>, blockName: string, contents: string): StructLayout {
    const uniformBufferVariables = findall(contents, /^\s*(\w+) (\w+)(?:\[(\d+)\])?;$/mg);
    const fields: StructField[] = [];
    let totalWordSize = 0;
    for (let i = 0; i < uniformBufferVariables.length; i++) {
        const [m, type, name, arraySizeStr] = uniformBufferVariables[i];
        let arraySize: number = 1;
        if (arraySizeStr !== undefined)
            arraySize = parseInt(arraySizeStr);
        const rawWordSize = assertExists(getTypeSize(layouts, type)) * arraySize;
        // Round up to the nearest 4, per std140 alignment rules.
        const wordSize = (rawWordSize + 3) & ~3;
        totalWordSize += wordSize;
        fields.push({ type, name, arraySize, wordSize });
    }
    return { blockName, fields, totalWordSize };
}

export function parseShaderSource(uniformBufferLayouts: StructLayout[], shaderSource: string): void {
    const layouts = new Map<string, StructLayout>();

    const structBlocks = findall(shaderSource, /struct (\w+) {([^]*?)}/g);
    for (let i = 0; i < structBlocks.length; i++) {
        const [m, blockName, contents] = structBlocks[i];
        const structLayout = parseDefinition(layouts, blockName, contents);
        layouts.set(blockName, structLayout);
    }

    const uniformBlocks = findall(shaderSource, /uniform (\w+) {([^]*?)}/g);
    for (let i = 0; i < uniformBlocks.length; i++) {
        const [m, blockName, contents] = uniformBlocks[i];
        uniformBufferLayouts.push(parseDefinition(layouts, blockName, contents));
    }
}

// TODO(jstpierre): I'm not sure I like this class.
export class BufferFillerHelper {
    private offs: number;

    constructor(public bufferLayout: StructLayout, public d: Float32Array = null, public startOffs: number = 0) {
        if (this.d === null) {
            this.d = new Float32Array(bufferLayout.totalWordSize);
        }
    }

    public reset(): void {
        this.offs = this.startOffs;
    }

    public getBufferBinding(buffer: GfxBuffer): GfxBufferBinding {
        return { buffer, wordOffset: this.startOffs, wordCount: this.bufferLayout.totalWordSize };
    }

    public endAndUpload(hostAccessPass: GfxHostAccessPass, gfxBuffer: GfxRenderBuffer, dstWordOffset: number = 0): void {
        assert(this.offs === this.bufferLayout.totalWordSize);
        gfxBuffer.uploadSubData(hostAccessPass, dstWordOffset, this.d);
    }

    public fillVec4(v0: number, v1: number = 0, v2: number = 0, v3: number = 0): void {
        this.offs += fillVec4(this.d, this.offs, v0, v1, v2, v3);
    }

    public fillColor(c: Color): void {
        this.offs += fillColor(this.d, this.offs, c);
    }

    public fillMatrix4x4(m: mat4): void {
        this.offs += fillMatrix4x4(this.d, this.offs, m);
    }

    public fillMatrix4x3(m: mat4): void {
        this.offs += fillMatrix4x3(this.d, this.offs, m);
    }
}

export function fillVec3(d: Float32Array, offs: number, v: vec3, v3: number = 0): number {
    d[offs + 0] = v[0];
    d[offs + 1] = v[1];
    d[offs + 2] = v[2];
    d[offs + 3] = v3;
    return 4;
}

export function fillVec4(d: Float32Array, offs: number, v0: number, v1: number = 0, v2: number = 0, v3: number = 0): number {
    d[offs + 0] = v0;
    d[offs + 1] = v1;
    d[offs + 2] = v2;
    d[offs + 3] = v3;
    return 4;
}

export function fillColor(d: Float32Array, offs: number, c: Color): number {
    d[offs + 0] = c.r;
    d[offs + 1] = c.g;
    d[offs + 2] = c.b;
    d[offs + 3] = c.a;
    return 4;
}

// All of our matrices are row-major.
export function fillMatrix4x4(d: Float32Array, offs: number, m: mat4): number {
    d[offs +  0] = m[0];
    d[offs +  1] = m[4];
    d[offs +  2] = m[8];
    d[offs +  3] = m[12];
    d[offs +  4] = m[1];
    d[offs +  5] = m[5];
    d[offs +  6] = m[9];
    d[offs +  7] = m[13];
    d[offs +  8] = m[2];
    d[offs +  9] = m[6];
    d[offs + 10] = m[10];
    d[offs + 11] = m[14];
    d[offs + 12] = m[3];
    d[offs + 13] = m[7];
    d[offs + 14] = m[11];
    d[offs + 15] = m[15];
    return 4*4;
}

export function fillMatrix4x3(d: Float32Array, offs: number, m: mat4): number {
    d[offs +  0] = m[0];
    d[offs +  1] = m[4];
    d[offs +  2] = m[8];
    d[offs +  3] = m[12];
    d[offs +  4] = m[1];
    d[offs +  5] = m[5];
    d[offs +  6] = m[9];
    d[offs +  7] = m[13];
    d[offs +  8] = m[2];
    d[offs +  9] = m[6];
    d[offs + 10] = m[10];
    d[offs + 11] = m[14];
    return 4*3;
}

export function fillMatrix3x2(d: Float32Array, offs: number, m: mat2d): number {
    // 3x2 matrices are actually sent across as 4x2.
    const ma = m[0], mb = m[1];
    const mc = m[2], md = m[3];
    const mx = m[4], my = m[5];
    d[offs + 0] = ma;
    d[offs + 1] = mc;
    d[offs + 2] = mx;
    d[offs + 3] = 0;
    d[offs + 4] = mb;
    d[offs + 5] = md;
    d[offs + 6] = my;
    d[offs + 7] = 0;
    return 4*2;
}

export function fillMatrix4x2(d: Float32Array, offs: number, m: mat4): number {
    // The bottom two rows are basically just ignored in a 4x2.
    d[offs +  0] = m[0];
    d[offs +  1] = m[4];
    d[offs +  2] = m[8];
    d[offs +  3] = m[12];
    d[offs +  4] = m[1];
    d[offs +  5] = m[5];
    d[offs +  6] = m[9];
    d[offs +  7] = m[13];
    return 4*2;
}
