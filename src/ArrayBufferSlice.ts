
import { assert } from "./util";

// This implements a "saner" ArrayBuffer, since the JS one is absurd.
//
// The biggest issue is that ArrayBuffer.prototype.slice does not make a read-only view, but instead
// a copy, and most browsers do not implement it as a COW buffer but instead a separate buffer backed
// by a separate memcpy. There is no way to create a read-only or ArrayBufferView, since that goal is
// mostly relegated to the typed arrays or DataViews, which have unmatching and different APIs.
//
// ArrayBufferSlice's are designed to be read-only, however, JavaScript has no way of enforcing this
// currently...

// Install our dummy ArrayBuffer.prototype.slice to catch any rogue offenders.
const ArrayBuffer_slice = ArrayBuffer.prototype.slice;
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

    public slice(begin: number, end?: number): ArrayBufferSlice {
        const absBegin = this.byteOffset + begin;
        const absEnd = this.byteOffset + (end !== undefined ? end : this.byteLength);
        return new ArrayBufferSlice(this.arrayBuffer, absBegin, absEnd - absBegin);
    }

    public subarray(begin: number, byteLength?: number): ArrayBufferSlice {
        const absBegin = this.byteOffset + begin;
        if (byteLength === undefined)
            byteLength = this.byteLength - begin;
        assert(byteLength >= 0 && byteLength < this.byteLength);
        return new ArrayBufferSlice(this.arrayBuffer, absBegin, byteLength);
    }

    public copyToBuffer(offs: number = 0, length?: number): ArrayBuffer {
        const start = this.byteOffset + offs;
        const end = length !== undefined ? start + length : this.byteOffset + this.byteLength;
        return ArrayBuffer_slice.call(this.arrayBuffer, start, end);
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

    public createTypedArray<T extends ArrayBufferView>(clazz: _TypedArrayConstructor<T>, offs: number = 0, count?: number): T {
        const begin = this.byteOffset + offs;

        let byteLength;
        if (count !== undefined) {
            byteLength = clazz.BYTES_PER_ELEMENT * count;
        } else {
            byteLength = this.byteLength - offs;
            // Ensure it's aligned if we're relying on implicit length as a safety net
            // so we don't try to silently copy the rest of the ArrayBuffer.
            const end = begin + byteLength;
            assert(isAligned(end, clazz.BYTES_PER_ELEMENT));
            count = byteLength / clazz.BYTES_PER_ELEMENT;
        }

        // Typed arrays require 
        if (isAligned(begin, clazz.BYTES_PER_ELEMENT))
            return new clazz(this.arrayBuffer, begin, count);
        else
            return new clazz(this.copyToBuffer(offs, byteLength), 0);
    }
}
