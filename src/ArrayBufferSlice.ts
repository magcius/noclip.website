
// This implements a "saner" ArrayBuffer, since the JS one is absurd.
//
// The biggest issue is that ArrayBuffer.prototype.slice does not make a read-only view, but instead
// a copy, and most browsers do not implement it as a COW buffer but instead a separate buffer backed
// by a separate memcpy. There is no way to create a read-only or ArrayBufferView, since that goal is
// mostly relegated to the typed arrays or DataViews, which have unmatching and different APIs.
//
// ArrayBufferSlice's are designed to be read-only, however, JavaScript has no way of enforcing this
// currently...

import { assert } from "./util";
import { getSystemEndianness, Endianness } from "./endian";

// Install our dummy ArrayBuffer.prototype.slice to catch any rogue offenders.
export const ArrayBuffer_slice = ArrayBuffer.prototype.slice;
ArrayBuffer.prototype.slice = (begin: number, end?: number): ArrayBuffer => {
    throw new Error("Do not use ArrayBuffer.prototype.slice");
};

interface _TypedArrayConstructor<T extends ArrayBufferView> {
    readonly BYTES_PER_ELEMENT: number;
    new(buffer: ArrayBufferLike, byteOffset: number, length?: number): T;
}

function isAligned(n: number, m: number) {
    return (n & (m - 1)) === 0;
}

export default class ArrayBufferSlice {
    constructor(
        // The name arrayBuffer is chosen so that someone can't easily mistake an ArrayBufferSlice
        // for an ArrayBuffer or ArrayBufferView, which is important for native APIs like OpenGL that
        // will silently choke on something like this. TypeScript has no way to explicitly mark our
        // class as incompatible with the ArrayBuffer interface.
        public readonly arrayBuffer: ArrayBuffer,
        public readonly byteOffset: number = 0,
        public readonly byteLength: number = arrayBuffer.byteLength
    ) {
        assert(byteOffset >= 0 && byteLength >= 0 && (byteOffset + byteLength) <= this.arrayBuffer.byteLength);
    }

    public slice(begin: number, end: number = 0): ArrayBufferSlice {
        const absBegin = this.byteOffset + begin;
        const absEnd = this.byteOffset + (end !== 0 ? end : this.byteLength);
        return new ArrayBufferSlice(this.arrayBuffer, absBegin, absEnd - absBegin);
    }

    public subarray(begin: number, byteLength?: number): ArrayBufferSlice {
        const absBegin = this.byteOffset + begin;
        if (byteLength === undefined)
            byteLength = this.byteLength - begin;
        assert(byteLength >= 0 && byteLength <= this.byteLength);
        return new ArrayBufferSlice(this.arrayBuffer, absBegin, byteLength);
    }

    public copyToBuffer(offs: number = 0, length?: number): ArrayBuffer {
        const start = this.byteOffset + offs;
        const end = length !== undefined ? start + length : this.byteOffset + this.byteLength;
        return ArrayBuffer_slice.call(this.arrayBuffer, start, end);
    }

    public copyToSlice(offs: number = 0, length?: number): ArrayBufferSlice {
        return new ArrayBufferSlice(this.copyToBuffer(offs, length));
    }

    public castToBuffer(): ArrayBuffer {
        if (this.byteOffset === 0 && this.byteLength === this.arrayBuffer.byteLength) {
            return this.arrayBuffer;
        } else {
            return this.copyToBuffer();
        }
    }

    public createDataView(offs: number = 0, length?: number): DataView {
        if (offs === 0 && length === undefined) {
            return new DataView(this.arrayBuffer, this.byteOffset, this.byteLength);
        } else {
            return this.subarray(offs, length).createDataView();
        }
    }

    private bswap16(): ArrayBufferSlice {
        assert(this.byteLength % 2 === 0);
        const a = this.createTypedArray(Uint8Array);
        const o = new Uint8Array(this.byteLength);
        for (let i = 0; i < a.byteLength; i += 2) {
            o[i+0] = a[i+1];
            o[i+1] = a[i+0];
        }
        return new ArrayBufferSlice(o.buffer as ArrayBuffer);
    }

    private bswap32(): ArrayBufferSlice {
        assert(this.byteLength % 4 === 0);
        const a = this.createTypedArray(Uint8Array);
        const o = new Uint8Array(a.byteLength);
        for (let i = 0; i < a.byteLength; i += 4) {
            o[i+0] = a[i+3];
            o[i+1] = a[i+2];
            o[i+2] = a[i+1];
            o[i+3] = a[i+0];
        }
        return new ArrayBufferSlice(o.buffer as ArrayBuffer);
    }

    private bswap(componentSize: 2 | 4): ArrayBufferSlice {
        if (componentSize === 2) {
            return this.bswap16();
        } else if (componentSize === 4) {
            return this.bswap32();
        } else {
            throw new Error("Invalid componentSize");
        }
    }

    public convertFromEndianness(endianness: Endianness, componentSize: 1 | 2 | 4): ArrayBufferSlice {
        if (componentSize !== 1 && endianness !== getSystemEndianness())
            return this.bswap(componentSize);
        else
            return this;
    }

    public createTypedArray<T extends ArrayBufferView>(clazz: _TypedArrayConstructor<T>, offs: number = 0, count?: number, endianness: Endianness = Endianness.LITTLE_ENDIAN, forceCopy: boolean = false): T {
        const begin = this.byteOffset + offs;

        let byteLength;
        if (count !== undefined) {
            byteLength = clazz.BYTES_PER_ELEMENT * count;
        } else {
            byteLength = this.byteLength - offs;
            count = byteLength / clazz.BYTES_PER_ELEMENT;
            assert((count | 0) === count);
        }

        const componentSize = clazz.BYTES_PER_ELEMENT as (1 | 2 | 4);
        const needsEndianSwap = (componentSize > 1) && (endianness !== getSystemEndianness());

        // Typed arrays require alignment.
        if (needsEndianSwap) {
            const componentSize_ = componentSize as (2 | 4);
            const copy = this.subarray(offs, byteLength).bswap(componentSize_);
            return copy.createTypedArray(clazz);
        } else if (!forceCopy && isAligned(begin, componentSize)) {
            return new clazz(this.arrayBuffer, begin, count);
        } else {
            return new clazz(this.copyToBuffer(offs, byteLength), 0);
        }
    }
}
