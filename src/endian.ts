
const _test: Uint16Array = new Uint16Array([0xFEFF]);
const _testView: DataView = new DataView(_test.buffer);
const _isLittle: boolean = _testView.getUint8(0) == 0xFF;

export function isLittleEndian(): boolean {
    return _isLittle;
}

function bswap16(m: ArrayBuffer, byteOffset: number, byteLength: number): ArrayBuffer {
    const a = new Uint8Array(m, byteOffset, byteLength);
    const o = new Uint8Array(a.byteLength);
    for (let i = 0; i < a.byteLength; i += 2) {
        o[i+0] = a[i+1];
        o[i+1] = a[i+0];
    }
    return o.buffer;
}

function bswap32(m: ArrayBuffer, byteOffset: number, byteLength: number): ArrayBuffer {
    const a = new Uint8Array(m, byteOffset, byteLength);
    const o = new Uint8Array(a.byteLength);
    for (let i = 0; i < a.byteLength; i += 4) {
        o[i+0] = a[i+3];
        o[i+1] = a[i+2];
        o[i+2] = a[i+1];
        o[i+3] = a[i+0];
    }
    return o.buffer;
}

function be16toh(m: ArrayBuffer, byteOffset: number, byteLength: number): ArrayBuffer {
    if (isLittleEndian())
        return bswap16(m, byteOffset, byteLength);
    else
        return m.slice(byteOffset, byteLength);
}

function le16toh(m: ArrayBuffer, byteOffset: number, byteLength: number): ArrayBuffer {
    if (!isLittleEndian())
        return bswap16(m, byteOffset, byteLength);
    else
        return m.slice(byteOffset, byteLength);
}

function be32toh(m: ArrayBuffer, byteOffset: number, byteLength: number): ArrayBuffer {
    if (isLittleEndian())
        return bswap32(m, byteOffset, byteLength);
    else
        return m.slice(byteOffset, byteLength);
}

function le32toh(m: ArrayBuffer, byteOffset: number, byteLength: number): ArrayBuffer {
    if (!isLittleEndian())
        return bswap32(m, byteOffset, byteLength);
    else
        return m.slice(byteOffset, byteLength);
}

type CompSize = 1 | 2 | 4;

export function betoh(m: ArrayBuffer, componentSize: CompSize, byteOffset: number = 0, byteLength: number = m.byteLength): ArrayBuffer {
    switch (componentSize) {
    case 1:
        // XXX(jstpierre): Zero-copy.
        return m.slice(byteOffset, byteOffset + byteLength);
    case 2:
        return be16toh(m, byteOffset, byteLength);
    case 4:
        return be32toh(m, byteOffset, byteLength);
    }
}
