
// Helpers to manage GPU buffer data...

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { GfxBuffer, GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint } from "../platform/GfxPlatform.js";
import { assert } from "../platform/GfxPlatformUtil.js";

export interface GfxCoalescedBuffer {
    buffer: GfxBuffer;
    byteOffset: number;
    byteCount: number;
}

export function coalesceBuffer(device: GfxDevice, usage: GfxBufferUsage, datas: ArrayBufferSlice[]): GfxCoalescedBuffer[] {
    let dataLength = 0;
    for (let i = 0; i < datas.length; i++)
        dataLength += datas[i].byteLength;

    const buffer = device.createBuffer(dataLength, usage, GfxBufferFrequencyHint.Static);

    const coalescedBuffers: GfxCoalescedBuffer[] = [];
    const combinedData = new Uint8Array(dataLength);
    let byteOffset: number = 0;
    for (let i = 0; i < datas.length; i++) {
        const data = datas[i];
        combinedData.set(data.createTypedArray(Uint8Array), byteOffset);
        coalescedBuffers.push({ buffer, byteOffset, byteCount: data.byteLength });
        byteOffset += data.byteLength;
    }

    device.uploadBufferData(buffer, 0, combinedData);

    return coalescedBuffers;
}

// TODO(jstpierre): Remove the buffer coalescer... it doesn't really help as much as I thought it did.

export interface GfxCoalescedBuffersCombo {
    vertexBuffers: GfxCoalescedBuffer[];
    indexBuffer: GfxCoalescedBuffer;
}

export class GfxBufferCoalescerCombo {
    public coalescedBuffers: GfxCoalescedBuffersCombo[] = [];
    public vertexBuffer: GfxBuffer | null = null;
    private indexBuffer: GfxBuffer | null = null;

    constructor(device: GfxDevice, vertexDatas: ArrayBufferSlice[][], indexDatas: ArrayBufferSlice[], name: string = '') {
        assert(vertexDatas.length === indexDatas.length);

        // Don't do anything if we have no data to care about.
        if (vertexDatas.length === 0)
            return;

        // We need to pack all of the [0] buffers together, all of the [1] buffers together, etc.
        // I call these "slices".
        const allVertexDatas: ArrayBufferSlice[] = [];
        let maxSlice = 0;
        while (true) {
            let sliceHasBuffer = false;
            for (let i = 0; i < vertexDatas.length; i++) {
                if (vertexDatas[i][maxSlice] === undefined)
                    continue;

                allVertexDatas.push(vertexDatas[i][maxSlice]);
                sliceHasBuffer = true;
            }

            if (!sliceHasBuffer)
                break;

            maxSlice++;
        }

        const vertexCoalescedBuffers = coalesceBuffer(device, GfxBufferUsage.Vertex, allVertexDatas);
        const indexCoalescedBuffers = coalesceBuffer(device, GfxBufferUsage.Index, indexDatas);

        const coalescedBuffers: GfxCoalescedBuffersCombo[] = [];

        let z = 0;
        for (let i = 0; i < vertexDatas.length; i++) {
            const vertexBuffers: GfxCoalescedBuffer[] = [vertexCoalescedBuffers[z++]];
            const indexBuffer = indexCoalescedBuffers[i];
            coalescedBuffers.push({ vertexBuffers, indexBuffer });
        }

        for (let slice = 1; slice < maxSlice; slice++) {
            for (let i = 0; i < vertexDatas.length; i++) {
                if (vertexDatas[i][slice] === undefined)
                    continue;

                coalescedBuffers[i].vertexBuffers.push(vertexCoalescedBuffers[z++]);
            }
        }

        this.coalescedBuffers = coalescedBuffers;
        this.vertexBuffer = this.coalescedBuffers[0].vertexBuffers[0].buffer;
        this.indexBuffer = this.coalescedBuffers[0].indexBuffer.buffer;

        device.setResourceName(this.vertexBuffer, name);
        device.setResourceName(this.indexBuffer, `${name} (IB)`);
    }

    public destroy(device: GfxDevice): void {
        if (this.vertexBuffer !== null)
            device.destroyBuffer(this.vertexBuffer);
        if (this.indexBuffer !== null)
            device.destroyBuffer(this.indexBuffer);
    }
}

export function createBufferFromData(device: GfxDevice, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint, data: ArrayBufferLike, srcOffset = 0, srcLength = data.byteLength): GfxBuffer {
    return device.createBuffer(data.byteLength, usage, hint, new Uint8Array(data, srcOffset, srcLength));
}

export function createBufferFromSlice(device: GfxDevice, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint, data: ArrayBufferSlice): GfxBuffer {
    return device.createBuffer(data.byteLength, usage, hint, data.createTypedArray(Uint8Array));
}
