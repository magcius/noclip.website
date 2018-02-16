
const _test: Uint16Array = new Uint16Array([0xFEFF]);
const _testView: DataView = new DataView(_test.buffer);
const _isLittle: boolean = _testView.getUint8(0) == 0xFF;

export function isLittleEndian(): boolean {
    return _isLittle;
}

export function bswap16(m: ArrayBuffer): ArrayBuffer {
    const a = new Uint8Array(m);
    const o = new Uint8Array(a.byteLength);
    for (let i = 0; i < a.byteLength; i += 2) {
        o[i+0] = a[i+1];
        o[i+1] = a[i+0];
    }
    return o.buffer;
}

export function bswap32(m: ArrayBuffer): ArrayBuffer {
    const a = new Uint8Array(m);
    const o = new Uint8Array(a.byteLength);
    for (let i = 0; i < a.byteLength; i += 4) {
        o[i+0] = a[i+3];
        o[i+1] = a[i+2];
        o[i+2] = a[i+1];
        o[i+3] = a[i+0];
    }
    return o.buffer;
}

export function be16toh(m: ArrayBuffer): ArrayBuffer {
    if (isLittleEndian())
        return bswap16(m);
    else
        return m;
}

export function le16toh(m: ArrayBuffer): ArrayBuffer {
    if (!isLittleEndian())
        return bswap16(m);
    else
        return m;
}

export function be32toh(m: ArrayBuffer): ArrayBuffer {
    if (isLittleEndian())
        return bswap32(m);
    else
        return m;
}

export function le32toh(m: ArrayBuffer): ArrayBuffer {
    if (!isLittleEndian())
        return bswap32(m);
    else
        return m;
}
