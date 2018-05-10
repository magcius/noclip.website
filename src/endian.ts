
import ArrayBufferSlice from "ArrayBufferSlice";

export const enum Endianness {
    LITTLE_ENDIAN,
    BIG_ENDIAN,
}

const _test: Uint16Array = new Uint16Array([0xFEFF]);
const _testView: DataView = new DataView(_test.buffer);
const _systemEndianness: Endianness = (_testView.getUint8(0) == 0xFF) ? Endianness.LITTLE_ENDIAN : Endianness.BIG_ENDIAN;

export function getSystemEndianness(): Endianness {
    return _systemEndianness;
}

function isLittleEndian(): boolean {
    return _systemEndianness === Endianness.LITTLE_ENDIAN;
}

function bswap16(m: ArrayBufferSlice): ArrayBufferSlice {
    const a = m.createTypedArray(Uint8Array);
    const o = new Uint8Array(a.byteLength);
    for (let i = 0; i < a.byteLength; i += 2) {
        o[i+0] = a[i+1];
        o[i+1] = a[i+0];
    }
    return new ArrayBufferSlice(o.buffer);
}

function bswap32(m: ArrayBufferSlice): ArrayBufferSlice {
    const a = m.createTypedArray(Uint8Array);
    const o = new Uint8Array(a.byteLength);
    for (let i = 0; i < a.byteLength; i += 4) {
        o[i+0] = a[i+3];
        o[i+1] = a[i+2];
        o[i+2] = a[i+1];
        o[i+3] = a[i+0];
    }
    return new ArrayBufferSlice(o.buffer);
}

function be16toh(m: ArrayBufferSlice): ArrayBufferSlice {
    if (isLittleEndian())
        return bswap16(m);
    else
        return m;
}

function le16toh(m: ArrayBufferSlice): ArrayBufferSlice {
    if (!isLittleEndian())
        return bswap16(m);
    else
        return m;
}

function be32toh(m: ArrayBufferSlice): ArrayBufferSlice {
    if (isLittleEndian())
        return bswap32(m);
    else
        return m;
}

function le32toh(m: ArrayBufferSlice): ArrayBufferSlice {
    if (!isLittleEndian())
        return bswap32(m);
    else
        return m;
}

type CompSize = 1 | 2 | 4;

export function betoh(m: ArrayBufferSlice, componentSize: CompSize): ArrayBufferSlice {
    switch (componentSize) {
    case 1:
        return m;
    case 2:
        return be16toh(m);
    case 4:
        return be32toh(m);
    }
}
