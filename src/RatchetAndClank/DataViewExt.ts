export type DataViewExtOptions = {
    /**
     * The default endianness to use when reading/writing values. This overrides the last arg on all get/set methods of the base DataView class.
     */
    littleEndian: boolean,
};

export type ArrayBufferViewConstructor = {
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): ArrayBufferView;
    BYTES_PER_ELEMENT: number;
}

// merges mapped types
type Merge<A, B> = {
    [K in keyof A]: K extends keyof B ? B[K] : A[K]
} & Omit<B, keyof A>;

// causes typescript to display more useful hover hints
type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};

const textDecoder = new TextDecoder("utf-8");

/**
 * A DataView with some additional features:
 * 
 * - You can change the default endianness
 * - You can create child views, similar to the subarray method on TypedArrays
 * - You can read more complex types, like vectors, matrices, and ranges
 * - You can subdivide the view into chunks of a given size
 */
export class DataViewExt<T extends ArrayBufferLike = ArrayBufferLike> extends DataView<T> {
    defaultLittleEndian: boolean;

    constructor(buffer: T, options: DataViewExtOptions, byteOffset?: number, byteLength?: number,) {
        super(buffer, byteOffset, byteLength);
        this.defaultLittleEndian = options.littleEndian;
    }
    override getBigInt64(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.getBigInt64(offset, littleEndian);
    }
    override getBigUint64(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.getBigUint64(offset, littleEndian);
    }
    // @ts-expect-error
    override getFloat16(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        // @ts-expect-error
        return super.getFloat16(offset, littleEndian);
    }
    override getFloat32(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.getFloat32(offset, littleEndian);
    }
    override getFloat64(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.getFloat64(offset, littleEndian);
    }
    override getInt16(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.getInt16(offset, littleEndian);
    }
    override getInt32(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.getInt32(offset, littleEndian);
    }
    override getUint16(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.getUint16(offset, littleEndian);
    }
    override getUint32(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.getUint32(offset, littleEndian);
    }
    override setBigInt64(offset: number, value: bigint, littleEndian: boolean = this.defaultLittleEndian) {
        return super.setBigInt64(offset, value, littleEndian);
    }
    override setBigUint64(offset: number, value: bigint, littleEndian: boolean = this.defaultLittleEndian) {
        return super.setBigUint64(offset, value, littleEndian);
    }
    // @ts-expect-error
    override setFloat16(offset: number, value: number, littleEndian: boolean = this.defaultLittleEndian) {
        // @ts-expect-error
        return super.setFloat16(offset, value, littleEndian);
    }
    override setFloat32(offset: number, value: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.setFloat32(offset, value, littleEndian);
    }
    override setFloat64(offset: number, value: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.setFloat64(offset, value, littleEndian);
    }
    override setInt16(offset: number, value: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.setInt16(offset, value, littleEndian);
    }
    override setInt32(offset: number, value: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.setInt32(offset, value, littleEndian);
    }
    override setUint16(offset: number, value: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.setUint16(offset, value, littleEndian);
    }
    override setUint32(offset: number, value: number, littleEndian: boolean = this.defaultLittleEndian) {
        return super.setUint32(offset, value, littleEndian);
    }

    /**
     * Return a new DataViewExt view into the same buffer, with the offset and size moved inwards.
     * 
     * Zero means to keep the bound the same as this view.
     */
    subview(offset: number = 0, byteLength: number = 0) {
        if (!byteLength) byteLength = this.byteLength - offset;
        return new DataViewExt(
            this.buffer,
            { littleEndian: this.defaultLittleEndian },
            this.byteOffset + offset,
            Math.min(byteLength, this.byteLength - offset)
        );
    }

    /**
     * Create an array of subviews. Each starts at startOffset + (index * stride).
     * 
     * Continues until maxSubviews, or until the end of the buffer.
     * 
     * If constrainSize is true, sets the size of each subview to stride. Otherwise the size is inherited from this view.
     * 
     * ```
     * // struct Vertex{ f32 x, f32 y, f32 z } verts[16];
     * const readVertex = (view: DataViewExt) => view.readFloat32_Xyz(0);
     * const vertexArray = view.subdivide(0, 16, 0xc).map(readVertex);
     * ```
     */
    subdivide(startOffset: number, maxSubviews: number, stride: number, constrainSize: boolean = false) {
        const chunks = [];
        for (let i = 0; i < maxSubviews; i++) {
            const offset = startOffset + (i * stride);
            const size = constrainSize ? stride : 0;
            if ((offset + stride) > this.byteLength) {
                break;
            }
            chunks.push(this.subview(offset, size));
        }
        return chunks;
    }

    /**
     * Creates this same view as a TypedArray view using the provided constructor.
     */
    getTypedArrayView<T extends ArrayBufferViewConstructor>(ArrayBufferViewConstructor: T): InstanceType<T> {
        return new ArrayBufferViewConstructor(this.buffer, this.byteOffset, this.byteLength / ArrayBufferViewConstructor.BYTES_PER_ELEMENT) as InstanceType<T>;
    }

    /**
     * Creates a view into the buffer using the provided typed array constructor, then converts it to a regular number array.
     * Endianness is ignored.
     */
    getArrayOfNumbers<T extends ArrayBufferViewConstructor>(offset: number, count: number, TypedArrayConstructor: T): number[] {
        if (count <= 0) return [];
        const typed = this.subview(offset, count * TypedArrayConstructor.BYTES_PER_ELEMENT).getTypedArrayView(TypedArrayConstructor) as { [n: number]: number, length: number }
        const arr: number[] = [];
        for (let i = 0; i < typed.length; i++) {
            arr.push(typed[i]);
        }
        return arr;
    }

    /**
     * Reads a number of bytes and interprets them as nibbles.
     */
    getNibbleArray(offset: number, bytes: number): number[] {
        const arr: number[] = [];
        for (let i = 0; i < bytes; i++) {
            const byte = this.getUint8(offset + i);
            arr.push(byte & 0xF);
            arr.push(byte >> 4);
        }
        return arr;
    }

    /**
     * Returns a 2 element slice of the buffer at offset, as a Float32Array.
     * Endianness is ignored.
     */
    getVec2Slice(offset: number) {
        const constructor = Float32Array;
        const len = 2;
        return this.subview(offset, constructor.BYTES_PER_ELEMENT * len).getTypedArrayView(constructor)
    }

    /**
     * Returns a 3 element slice of the buffer at offset, as a Float32Array.
     * Endianness is ignored.
     */
    getVec3Slice(offset: number) {
        const constructor = Float32Array;
        const len = 3;
        return this.subview(offset, constructor.BYTES_PER_ELEMENT * len).getTypedArrayView(constructor)
    }

    /**
     * Returns a 4 element slice of the buffer at offset, as a Float32Array.
     * Endianness is ignored.
     */
    getVec4Slice(offset: number) {
        const constructor = Float32Array;
        const len = 4;
        return this.subview(offset, constructor.BYTES_PER_ELEMENT * len).getTypedArrayView(constructor)
    }

    /**
     * Returns a 16 element slice of the buffer at offset, as a Float32Array.
     * Endianness is ignored.
     */
    getMat4Slice(offset: number) {
        const constructor = Float32Array;
        const len = 16;
        return this.subview(offset, constructor.BYTES_PER_ELEMENT * len).getTypedArrayView(constructor)
    }

    /**
     * Reads two int32s and returns them as an object with keys name1 and name2.
     * 
     * ```
     * type Range = { offset: number, size: number };
     * type PointerTable = { range1: Range, range2: Range };
     * const pointerTable: Table = {
     *   range1: view.getInt32PairAs(0x0, "offset", "size"),
     *   range2: view.getInt32PairAs(0x8, "offset", "size"),
     * }
     * ```
     */
    getInt32PairAs<A extends string, B extends string>(offset: number, name1: A, name2: B, littleEndian: boolean = this.defaultLittleEndian) {
        const a = this.getInt32(offset + 0x0, littleEndian);
        const b = this.getInt32(offset + 0x4, littleEndian);
        return { [name1]: a, [name2]: b } as Prettify<Merge<{ [K in A]: number }, { [K in B]: number }>>;
    }

    getInt32_Xy(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getInt32(offset + 0x0, littleEndian);
        const y = this.getInt32(offset + 0x4, littleEndian);
        return { x, y };
    }

    getInt32_Xyz(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getInt32(offset + 0x0, littleEndian);
        const y = this.getInt32(offset + 0x4, littleEndian);
        const z = this.getInt32(offset + 0x8, littleEndian);
        return { x, y, z };
    }

    getInt32_Rgb(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const r = this.getInt32(offset + 0x0, littleEndian);
        const g = this.getInt32(offset + 0x4, littleEndian);
        const b = this.getInt32(offset + 0x8, littleEndian);
        return { r, g, b };
    }

    getFloat32_Xy(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getFloat32(offset + 0x0, littleEndian);
        const y = this.getFloat32(offset + 0x4, littleEndian);
        return { x, y };
    }

    getFloat32_Xyz(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getFloat32(offset + 0x0, littleEndian);
        const y = this.getFloat32(offset + 0x4, littleEndian);
        const z = this.getFloat32(offset + 0x8, littleEndian);
        return { x, y, z };
    }

    getFloat32_Xyzw(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getFloat32(offset + 0x0, littleEndian);
        const y = this.getFloat32(offset + 0x4, littleEndian);
        const z = this.getFloat32(offset + 0x8, littleEndian);
        const w = this.getFloat32(offset + 0xc, littleEndian);
        return { x, y, z, w };
    }

    getFloat32_Rgb(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const r = this.getFloat32(offset + 0x0, littleEndian);
        const g = this.getFloat32(offset + 0x4, littleEndian);
        const b = this.getFloat32(offset + 0x8, littleEndian);
        return { r, g, b };
    }

    getFloat32_Rgba(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const r = this.getFloat32(offset + 0x0, littleEndian);
        const g = this.getFloat32(offset + 0x4, littleEndian);
        const b = this.getFloat32(offset + 0x8, littleEndian);
        const a = this.getFloat32(offset + 0xc, littleEndian);
        return { r, g, b, a };
    }

    getInt16_Xy(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getInt16(offset + 0x0, littleEndian);
        const y = this.getInt16(offset + 0x2, littleEndian);
        return { x, y };
    }

    getInt16_Xyz(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getInt16(offset + 0x0, littleEndian);
        const y = this.getInt16(offset + 0x2, littleEndian);
        const z = this.getInt16(offset + 0x4, littleEndian);
        return { x, y, z };
    }

    getInt16_Xyzw(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getInt16(offset + 0x0, littleEndian);
        const y = this.getInt16(offset + 0x2, littleEndian);
        const z = this.getInt16(offset + 0x4, littleEndian);
        const w = this.getInt16(offset + 0x6, littleEndian);
        return { x, y, z, w };
    }

    getUint16_Xyz(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getUint16(offset + 0x0, littleEndian);
        const y = this.getUint16(offset + 0x2, littleEndian);
        const z = this.getUint16(offset + 0x4, littleEndian);
        return { x, y, z };
    }

    getUint16_Xyzw(offset: number, littleEndian: boolean = this.defaultLittleEndian) {
        const x = this.getUint16(offset + 0x0, littleEndian);
        const y = this.getUint16(offset + 0x2, littleEndian);
        const z = this.getUint16(offset + 0x4, littleEndian);
        const w = this.getUint16(offset + 0x6, littleEndian);
        return { x, y, z, w };
    }

    getUint8_Xy(offset: number) {
        const x = this.getUint8(offset + 0x0);
        const y = this.getUint8(offset + 0x1);
        return { x, y };
    }

    getUint8_Xyz(offset: number) {
        const x = this.getUint8(offset + 0x0);
        const y = this.getUint8(offset + 0x1);
        const z = this.getUint8(offset + 0x2);
        return { x, y, z };
    }

    getUint8_Xyzw(offset: number) {
        const x = this.getUint8(offset + 0x0);
        const y = this.getUint8(offset + 0x1);
        const z = this.getUint8(offset + 0x2);
        const w = this.getUint8(offset + 0x3);
        return { x, y, z, w };
    }

    getUint8_Rgb(offset: number) {
        const r = this.getUint8(offset + 0x0);
        const g = this.getUint8(offset + 0x1);
        const b = this.getUint8(offset + 0x2);
        return { r, g, b };
    }

    getUint8_Rgba(offset: number) {
        const r = this.getUint8(offset + 0x0);
        const g = this.getUint8(offset + 0x1);
        const b = this.getUint8(offset + 0x2);
        const a = this.getUint8(offset + 0x3);
        return { r, g, b, a };
    }

    /**
     * Decodes length bytes at offset as a UTF-8 string without a null terminator.
     */
    getFixedLengthString(offset: number, length: number) {
        const bytes = new Uint8Array(this.buffer, this.byteOffset + offset, length);
        return textDecoder.decode(bytes);
    }

    /**
     * Decodes the bytes at offset as a c-string if a null terminator can be found within maxLength bytes, otherwise throws an error.
     */
    getCString(offset: number, maxLength?: number) {
        if (maxLength === undefined) maxLength = this.byteLength - offset;
        const bytes = new Uint8Array(this.buffer, this.byteOffset + offset, maxLength);
        const nullTerminatorIndex = bytes.indexOf(0);
        if (nullTerminatorIndex === -1) {
            throw new Error("Null terminator not found in c-string");
        }
        return textDecoder.decode(bytes.subarray(0, nullTerminatorIndex));
    }

    downloadAsFile(filename: string) {
        const clone = new ArrayBuffer(this.byteLength);
        new Uint8Array(clone).set(this.getTypedArrayView(Uint8Array));
        const blob = new Blob([clone], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}
