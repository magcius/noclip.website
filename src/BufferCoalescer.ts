
// Helper utility to combine buffers together for performance reasons.

import ArrayBufferSlice from "./ArrayBufferSlice";
import { assert, align } from "./util";

export interface CoalescedBuffer {
    buffer: WebGLBuffer;
    offset: number;
}

export interface CoalescedBuffers {
    vertexBuffer: CoalescedBuffer;
    indexBuffer: CoalescedBuffer;
}

export function coalesceBuffer(gl: WebGL2RenderingContext, target: number, datas: ArrayBufferSlice[]): CoalescedBuffer[] {
    let dataLength = 0;
    for (const data of datas) {
        dataLength += data.byteLength;
        dataLength = align(dataLength, 4);
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, dataLength, gl.STATIC_DRAW);

    const coalescedBuffers: CoalescedBuffer[] = [];

    let offset = 0;
    for (const data of datas) {
        const size = data.byteLength;
        coalescedBuffers.push({ buffer, offset });
        gl.bufferSubData(target, offset, data.createTypedArray(Uint8Array));
        offset += size;
        offset = align(offset, 4);
    }

    return coalescedBuffers;
}

// For debugging. Should be identical to just using the original buffers.
export class FakeBufferCoalescer {
    public coalescedBuffers: CoalescedBuffers[];
    private vertexBuffers: WebGLBuffer[] = [];
    private indexBuffers: WebGLBuffer[] = [];

    constructor(gl: WebGL2RenderingContext, vertexDatas: ArrayBufferSlice[], indexDatas: ArrayBufferSlice[]) {
        assert(vertexDatas.length === indexDatas.length);

        const coalescedBuffers = [];
        for (let i = 0; i < vertexDatas.length; i++) {
            const vertexCoalescedBuffers = coalesceBuffer(gl, gl.ARRAY_BUFFER, [vertexDatas[i]]);
            const indexCoalescedBuffers = coalesceBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, [indexDatas[i]]);

            const vertexBuffer = vertexCoalescedBuffers[0];
            const indexBuffer = indexCoalescedBuffers[0];

            this.vertexBuffers.push(vertexBuffer.buffer);
            this.indexBuffers.push(indexBuffer.buffer);

            coalescedBuffers.push({ vertexBuffer, indexBuffer });
        }

        this.coalescedBuffers = coalescedBuffers;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        for (const vertexBuffer of this.vertexBuffers)
            gl.deleteBuffer(vertexBuffer);
        for (const indexBuffer of this.indexBuffers)
            gl.deleteBuffer(indexBuffer);
    }
}

export default class BufferCoalescer {
    public coalescedBuffers: CoalescedBuffers[];
    private vertexBuffer: WebGLBuffer | null = null;
    private indexBuffer: WebGLBuffer | null = null;

    constructor(gl: WebGL2RenderingContext, vertexDatas: ArrayBufferSlice[], indexDatas: ArrayBufferSlice[]) {
        assert(vertexDatas.length === indexDatas.length);

        // Don't do anything if we have no data to care about.
        if (vertexDatas.length === 0)
            return;

        const vertexCoalescedBuffers = coalesceBuffer(gl, gl.ARRAY_BUFFER, vertexDatas);
        const indexCoalescedBuffers = coalesceBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indexDatas);

        const coalescedBuffers = [];
        for (let i = 0; i < vertexCoalescedBuffers.length; i++) {
            const vertexBuffer = vertexCoalescedBuffers[i];
            const indexBuffer = indexCoalescedBuffers[i];
            coalescedBuffers.push({ vertexBuffer, indexBuffer });
        }

        this.coalescedBuffers = coalescedBuffers;
        this.vertexBuffer = this.coalescedBuffers[0].vertexBuffer.buffer;
        this.indexBuffer = this.coalescedBuffers[0].indexBuffer.buffer;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        if (this.vertexBuffer !== null)
            gl.deleteBuffer(this.vertexBuffer);
        if (this.indexBuffer !== null)
            gl.deleteBuffer(this.indexBuffer);
    }
}
