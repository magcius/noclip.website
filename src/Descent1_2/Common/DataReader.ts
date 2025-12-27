import { mat3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readString } from "../../util";

/**
 * Utility class for reading data from a buffer like a stream.
 */
export class DescentDataReader {
    private view: DataView;

    constructor(
        public buffer: ArrayBufferSlice,
        public offset: number = 0,
    ) {
        this.view = buffer.createDataView();
    }

    public clone(offset: number | undefined = undefined) {
        return new DescentDataReader(this.buffer, offset ?? this.offset);
    }

    /** Read next signed 8-bit int. */
    public readInt8() {
        const value = this.view.getInt8(this.offset);
        this.offset += 1;
        return value;
    }

    /** Read next unsigned 8-bit int. */
    public readUint8() {
        const value = this.view.getUint8(this.offset);
        this.offset += 1;
        return value;
    }

    /** Read next signed 16-bit int. */
    public readInt16() {
        const value = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return value;
    }

    /** Read next unsigned 16-bit int. */
    public readUint16() {
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }

    /** Read next signed 32-bit int. */
    public readInt32() {
        const value = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    /** Read next unsigned 32-bit int. */
    public readUint32() {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    /** Read string with length, strip returned string before first null terminator. */
    public readString(length: number) {
        const value = readString(this.buffer, this.offset, length, false).split(
            "\0",
        )[0];
        this.offset += length;
        return value;
    }

    /** Read string with length, remove trailing null terminators, replace others with pad. */
    public readStringWithNulls(length: number, pad: string) {
        const value = readString(this.buffer, this.offset, length, false)
            .replace(/\0+$/, "")
            .replace(/\0/g, pad);
        this.offset += length;
        return value;
    }

    /** Read string with maximum length, treat newline as end of string. */
    public readLevelString(length: number) {
        const chars = [];
        for (let i = 0; i < length; ++i) {
            let char = this.readUint8();
            if (char === 10) char = 0;
            if (char === 0) break;
            chars.push(char);
        }
        return chars.map((c) => String.fromCharCode(c)).join("");
    }

    /** Read fixed-point number (16.16). */
    public readFix() {
        return this.readInt32() / 65536.0;
    }

    /** Read three fixed-point numbers as vec3. */
    public readFixVector() {
        const x = this.readFix();
        const y = this.readFix();
        const z = this.readFix();
        return vec3.fromValues(x, y, z);
    }

    /** Read nine fixed-point numbers as mat3. */
    public readFixMatrix() {
        const m0 = this.readFixVector();
        const m1 = this.readFixVector();
        const m2 = this.readFixVector();
        return mat3.fromValues(
            m0[0],
            m0[1],
            m0[2],
            m1[0],
            m1[1],
            m1[2],
            m2[0],
            m2[1],
            m2[2],
        );
    }

    /** Return buffer to next length bytes. */
    public readBytes(length: number) {
        const result = this.buffer.slice(this.offset, this.offset + length);
        this.offset += length;
        return result;
    }

    /** Check if end of file. */
    public endOfFile() {
        return this.offset + this.buffer.byteOffset >= this.buffer.byteLength;
    }
}
