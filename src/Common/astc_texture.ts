// Adapted from https://github.com/hearhellacopters/tex-decoder/blob/main/src/astc.ts
// The library does not work with noclip's setup

class bits {
    bits = 0;
    nonbits = 0;
}

type BlockData = {
    bw: number, bh: number, width: number, height: number,
    part_num: number, dual_plane: boolean, plane_selector: number,
    weight_range: number, weight_num: number,
    cem: Int32Array, cem_range: number,
    endpoint_value_num: number, endpoints: Int32Array[],
    weights: Int32Array[], partition: Int32Array
}

type IntSeqData = {
    bits: number,
    nonbits: number
}

function clamp(n: number, l: number, h: number): number {
    return n <= l ? l : n >= h ? h : n
}

function color(r: number, g: number, b: number, a: number): number {
    return (((a & 0xFF) << 24) | ((b & 0xFF) << 16) | ((g & 0xFF) << 8) | (r & 0xFF)) >>> 0
}

function fp16_ieee_to_fp32_value(h: number): number {
    const uint16Value = h;
    const sign = (uint16Value & 0x8000) >> 15;
    const exponent = (uint16Value & 0x7C00) >> 10;
    const fraction = uint16Value & 0x03FF;

    let floatValue;

    if (exponent === 0) {
        if (fraction === 0) {
            floatValue = (sign === 0) ? 0 : -0;
        } else {
            floatValue = (sign === 0 ? 1 : -1) * Math.pow(2, -14) * (fraction / 0x0400);
        }
    } else if (exponent === 0x1F) {
        if (fraction === 0) {
            floatValue = (sign === 0) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
        } else {
            floatValue = Number.NaN;
        }
    } else {
        floatValue = (sign === 0 ? 1 : -1) * Math.pow(2, exponent - 15) * (1 + fraction / 0x0400);
    }

    return floatValue;
}

const BIT_REVERSE_TABLE = new Uint8Array([
    0x00, 0x80, 0x40, 0xC0, 0x20, 0xA0, 0x60, 0xE0, 0x10, 0x90, 0x50, 0xD0, 0x30, 0xB0, 0x70, 0xF0,
    0x08, 0x88, 0x48, 0xC8, 0x28, 0xA8, 0x68, 0xE8, 0x18, 0x98, 0x58, 0xD8, 0x38, 0xB8, 0x78, 0xF8,
    0x04, 0x84, 0x44, 0xC4, 0x24, 0xA4, 0x64, 0xE4, 0x14, 0x94, 0x54, 0xD4, 0x34, 0xB4, 0x74, 0xF4,
    0x0C, 0x8C, 0x4C, 0xCC, 0x2C, 0xAC, 0x6C, 0xEC, 0x1C, 0x9C, 0x5C, 0xDC, 0x3C, 0xBC, 0x7C, 0xFC,
    0x02, 0x82, 0x42, 0xC2, 0x22, 0xA2, 0x62, 0xE2, 0x12, 0x92, 0x52, 0xD2, 0x32, 0xB2, 0x72, 0xF2,
    0x0A, 0x8A, 0x4A, 0xCA, 0x2A, 0xAA, 0x6A, 0xEA, 0x1A, 0x9A, 0x5A, 0xDA, 0x3A, 0xBA, 0x7A, 0xFA,
    0x06, 0x86, 0x46, 0xC6, 0x26, 0xA6, 0x66, 0xE6, 0x16, 0x96, 0x56, 0xD6, 0x36, 0xB6, 0x76, 0xF6,
    0x0E, 0x8E, 0x4E, 0xCE, 0x2E, 0xAE, 0x6E, 0xEE, 0x1E, 0x9E, 0x5E, 0xDE, 0x3E, 0xBE, 0x7E, 0xFE,
    0x01, 0x81, 0x41, 0xC1, 0x21, 0xA1, 0x61, 0xE1, 0x11, 0x91, 0x51, 0xD1, 0x31, 0xB1, 0x71, 0xF1,
    0x09, 0x89, 0x49, 0xC9, 0x29, 0xA9, 0x69, 0xE9, 0x19, 0x99, 0x59, 0xD9, 0x39, 0xB9, 0x79, 0xF9,
    0x05, 0x85, 0x45, 0xC5, 0x25, 0xA5, 0x65, 0xE5, 0x15, 0x95, 0x55, 0xD5, 0x35, 0xB5, 0x75, 0xF5,
    0x0D, 0x8D, 0x4D, 0xCD, 0x2D, 0xAD, 0x6D, 0xED, 0x1D, 0x9D, 0x5D, 0xDD, 0x3D, 0xBD, 0x7D, 0xFD,
    0x03, 0x83, 0x43, 0xC3, 0x23, 0xA3, 0x63, 0xE3, 0x13, 0x93, 0x53, 0xD3, 0x33, 0xB3, 0x73, 0xF3,
    0x0B, 0x8B, 0x4B, 0xCB, 0x2B, 0xAB, 0x6B, 0xEB, 0x1B, 0x9B, 0x5B, 0xDB, 0x3B, 0xBB, 0x7B, 0xFB,
    0x07, 0x87, 0x47, 0xC7, 0x27, 0xA7, 0x67, 0xE7, 0x17, 0x97, 0x57, 0xD7, 0x37, 0xB7, 0x77, 0xF7,
    0x0F, 0x8F, 0x4F, 0xCF, 0x2F, 0xAF, 0x6F, 0xEF, 0x1F, 0x9F, 0x5F, 0xDF, 0x3F, 0xBF, 0x7F, 0xFF,
]);

const WEIGHT_PREC_TABLE_A = new Int32Array([0, 0, 0, 3, 0, 5, 3, 0, 0, 0, 5, 3, 0, 5, 3, 0]);
const WEIGHT_PREC_TABLE_B = new Int32Array([0, 0, 1, 0, 2, 0, 1, 3, 0, 0, 1, 2, 4, 2, 3, 5]);

const CEM_TABLE_A = new Int32Array([0, 3, 5, 0, 3, 5, 0, 3, 5, 0, 3, 5, 0, 3, 5, 0, 3, 0, 0]);
const CEM_TABLE_B = new Int32Array([8, 6, 5, 7, 5, 4, 6, 4, 3, 5, 3, 2, 4, 2, 1, 3, 1, 2, 1]);

function bit_reverse_u8(c: number, bits: number): number {
    const x = BIT_REVERSE_TABLE[c] >>> (8 - bits);
    if (x !== 0) {
        return x;
    } else {
        return 0;
    }
}

function bit_reverse_u64(d: bigint, bits: number): bigint {
    const ret =
        BigInt(BIT_REVERSE_TABLE[Number(d & 0xFFn)]) << 56n |
        BigInt(BIT_REVERSE_TABLE[Number((d >> 8n) & 0xFFn)]) << 48n |
        BigInt(BIT_REVERSE_TABLE[Number((d >> 16n) & 0xFFn)]) << 40n |
        BigInt(BIT_REVERSE_TABLE[Number((d >> 24n) & 0xFFn)]) << 32n |
        BigInt(BIT_REVERSE_TABLE[Number((d >> 32n) & 0xFFn)]) << 24n |
        BigInt(BIT_REVERSE_TABLE[Number((d >> 40n) & 0xFFn)]) << 16n |
        BigInt(BIT_REVERSE_TABLE[Number((d >> 48n) & 0xFFn)]) << 8n |
        BigInt(BIT_REVERSE_TABLE[Number((d >> 56n) & 0xFFn)]);
    return ret >> (64n - BigInt(bits));
}

function u8ptr_to_u16(ptr: Uint8Array): number {
    return ((ptr[1] << 8) | ptr[0]) & 0xFFFF;
}

function bit_transfer_signed_alt(v: Int32Array, a: number, b: number): void {
    v[b] = (v[b] >> 1) | (v[a] & 0x80);
    v[a] = (v[a] >> 1) & 0x3f;
    if ((v[a] & 0x20) != 0) {
        v[a] -= 0x40;
    }
}

function set_endpoint(endpoint: Int32Array, r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): void {
    endpoint[0] = r1;
    endpoint[1] = g1;
    endpoint[2] = b1;
    endpoint[3] = a1;
    endpoint[4] = r2;
    endpoint[5] = g2;
    endpoint[6] = b2;
    endpoint[7] = a2;
}

function set_endpoint_clamp(endpoint: Int32Array, r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): void {
    endpoint[0] = clamp(r1, 0, 255);
    endpoint[1] = clamp(g1, 0, 255);
    endpoint[2] = clamp(b1, 0, 255);
    endpoint[3] = clamp(a1, 0, 255);
    endpoint[4] = clamp(r2, 0, 255);
    endpoint[5] = clamp(g2, 0, 255);
    endpoint[6] = clamp(b2, 0, 255);
    endpoint[7] = clamp(a2, 0, 255);
}

function set_endpoint_blue(endpoint: Int32Array, r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number,): void {
    endpoint[0] = (r1 + b1) >> 1;
    endpoint[1] = (g1 + b1) >> 1;
    endpoint[2] = b1;
    endpoint[3] = a1;
    endpoint[4] = (r2 + b2) >> 1;
    endpoint[5] = (g2 + b2) >> 1;
    endpoint[6] = b2;
    endpoint[7] = a2;
}

function set_endpoint_blue_clamp(endpoint: Int32Array, r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): void {
    endpoint[0] = clamp(((r1 + b1) >> 1), 0, 255);
    endpoint[1] = clamp(((g1 + b1) >> 1), 0, 255);
    endpoint[2] = clamp(b1, 0, 255);
    endpoint[3] = clamp(a1, 0, 255);
    endpoint[4] = clamp(((r2 + b2) >> 1), 0, 255);
    endpoint[5] = clamp(((g2 + b2) >> 1), 0, 255);
    endpoint[6] = clamp(b2, 0, 255);
    endpoint[7] = clamp(a2, 0, 255);
}

function set_endpoint_hdr(endpoint: Int32Array, r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): void {
    endpoint[0] = r1;
    endpoint[1] = g1;
    endpoint[2] = b1;
    endpoint[3] = a1;
    endpoint[4] = r2;
    endpoint[5] = g2;
    endpoint[6] = b2;
    endpoint[7] = a2;
}

function set_endpoint_hdr_clamp(endpoint: Int32Array, r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): void {
    endpoint[0] = clamp(r1, 0, 0xfff);
    endpoint[1] = clamp(g1, 0, 0xfff);
    endpoint[2] = clamp(b1, 0, 0xfff);
    endpoint[3] = clamp(a1, 0, 0xfff);
    endpoint[4] = clamp(r2, 0, 0xfff);
    endpoint[5] = clamp(g2, 0, 0xfff);
    endpoint[6] = clamp(b2, 0, 0xfff);
    endpoint[7] = clamp(a2, 0, 0xfff);
}

function select_color(v0: number, v1: number, weight: number): number {
    return Math.floor(((((v0 << 8 | v0) * (64 - weight) + (v1 << 8 | v1) * weight + 32) >> 6) * 255 + 32768) / 65536) & 0xFF
}

function select_color_hdr(v0: number, v1: number, weight: number): number {
    let c = (((v0 << 4) * (64 - weight) + (v1 << 4) * weight + 32) >> 6) & 0xFFFF;
    let m = new Uint16Array([(c & 0x7ff)]);
    if (m[0] < 512) {
        m[0] *= 3;
    } else if (m[0] < 1536) {
        m[0] = 4 * m[0] - 512;
    } else {
        m[0] = 5 * m[0] - 2048;
    }
    let f = fp16_ieee_to_fp32_value((c >> 1 & 0x7c00) | m[0] >> 3);
    if (Number.isFinite(f)) {
        return clamp(Math.round(f * 255.0), 0, 255)
    } else {
        return 255
    }
}

function f32_to_u8(f: number): number {
    return clamp(Math.round(f * 255.0), 0.0, 255.0)
}

function f16ptr_to_u8(ptr: Uint8Array): number {
    return f32_to_u8(fp16_ieee_to_fp32_value(((ptr[1] << 8) | ptr[0])) & 0xFFFF)
}

function getbits64(buf: Uint8Array, bit: number, len: number): bigint {
    var bits = len
    var off_in_bits = bit
    var value = 0n;
    for (var i = 0; i < bits;) {
        var remaining = bits - i;
        var bitOffset = off_in_bits & 7;
        var currentByte = buf[off_in_bits >> 3]
        var read = Math.min(remaining, 8 - bitOffset);

        var mask, readBits;
        mask = ~(0xFF << read);
        readBits = (currentByte >> bitOffset) & mask;
        value |= BigInt(readBits) << BigInt(i);

        off_in_bits += read;
        i += read;
    }
    return value >> BigInt(0)
}

function getbits(buf: Uint8Array, bitOffset: number, numBits: number): number {
    var bits = numBits
    var off_in_bits = bitOffset
    var value = 0;
    for (var i = 0; i < bits;) {
        var remaining = bits - i;
        var bitOffset = off_in_bits & 7;
        var currentByte = buf[off_in_bits >> 3]
        var read = Math.min(remaining, 8 - bitOffset);

        var mask: number, readBits: number;
        mask = ~(0xFF << read);
        readBits = (currentByte >> bitOffset) & mask;
        value |= readBits << i;

        off_in_bits += read;
        i += read;
    }
    return value >>> 0
}

function BlockDataDefault(): BlockData {
    return {
        bw: 0, bh: 0, width: 0, height: 0,
        part_num: 0, dual_plane: false,
        plane_selector: 0, weight_range: 0, weight_num: 0,
        cem: new Int32Array(4), cem_range: 0, endpoint_value_num: 0,
        endpoints: Array.from({ length: 4 }, () => new Int32Array(8)),
        weights: Array.from({ length: 144 }, () => new Int32Array(2)),
        partition: new Int32Array(144)
    }
}

function decode_intseq(buf: Uint8Array, offset: number, a: number, b: number, count: number, reverse: boolean, out: IntSeqData[]) {
    const MT = new Int32Array([0, 2, 4, 5, 7]);
    const MQ = new Int32Array([0, 3, 5]);
    const TRITS_TABLE = [
        new Int32Array([
            0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0,
            1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1,
            2, 2, 0, 1, 2, 1, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2,
            1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 0,
            0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0,
            1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1,
            2, 2, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 1, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2,
            2, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2, 1,
            0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2,
        ]),
        new Int32Array([
            0, 0, 0, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 1, 0,
            0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2,
            2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 2, 0, 0, 0, 0, 1, 1, 1, 1,
            1, 2, 2, 2, 1, 2, 2, 2, 0, 0, 0, 0, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 2, 0, 0, 0, 0, 1,
            1, 1, 1, 1, 2, 2, 2, 1, 2, 2, 2, 0, 0, 0, 0, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 2, 0, 0,
            0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2,
            2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 2, 2, 2,
            0, 2, 2, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 1, 2, 2, 2, 1, 0, 0, 0, 0, 1, 1, 1, 0,
            2, 2, 2, 0, 2, 2, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 1, 2, 2, 2, 1,
        ]),
        new Int32Array([
            0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2, 2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 0,
            0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2, 2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1,
            1, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2, 2, 2, 1, 1, 1, 2, 1, 1, 1,
            2, 1, 1, 1, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2, 2, 2, 1, 1, 1, 2,
            1, 1, 1, 2, 1, 1, 1, 2, 2, 2, 2, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2, 2, 2, 1,
            1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2,
            2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0,
            2, 2, 2, 2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 0, 0, 0, 2, 0, 0, 0, 2,
            0, 0, 0, 2, 2, 2, 2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 2, 2, 2, 2,
        ]),
        new Int32Array([
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
            2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
            2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
            2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2,
        ]),
        new Int32Array([
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
            2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
            2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
            2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
        ]),
    ];
    const QUINTS_TABLE = [
        new Int32Array([
            0, 1, 2, 3, 4, 0, 4, 4, 0, 1, 2, 3, 4, 1, 4, 4, 0, 1, 2, 3, 4, 2, 4, 4, 0, 1, 2, 3, 4,
            3, 4, 4, 0, 1, 2, 3, 4, 0, 4, 0, 0, 1, 2, 3, 4, 1, 4, 1, 0, 1, 2, 3, 4, 2, 4, 2, 0, 1,
            2, 3, 4, 3, 4, 3, 0, 1, 2, 3, 4, 0, 2, 3, 0, 1, 2, 3, 4, 1, 2, 3, 0, 1, 2, 3, 4, 2, 2,
            3, 0, 1, 2, 3, 4, 3, 2, 3, 0, 1, 2, 3, 4, 0, 0, 1, 0, 1, 2, 3, 4, 1, 0, 1, 0, 1, 2, 3,
            4, 2, 0, 1, 0, 1, 2, 3, 4, 3, 0, 1,
        ]),
        new Int32Array([
            0, 0, 0, 0, 0, 4, 4, 4, 1, 1, 1, 1, 1, 4, 4, 4, 2, 2, 2, 2, 2, 4, 4, 4, 3, 3, 3, 3, 3,
            4, 4, 4, 0, 0, 0, 0, 0, 4, 0, 4, 1, 1, 1, 1, 1, 4, 1, 4, 2, 2, 2, 2, 2, 4, 2, 4, 3, 3,
            3, 3, 3, 4, 3, 4, 0, 0, 0, 0, 0, 4, 0, 0, 1, 1, 1, 1, 1, 4, 1, 1, 2, 2, 2, 2, 2, 4, 2,
            2, 3, 3, 3, 3, 3, 4, 3, 3, 0, 0, 0, 0, 0, 4, 0, 0, 1, 1, 1, 1, 1, 4, 1, 1, 2, 2, 2, 2,
            2, 4, 2, 2, 3, 3, 3, 3, 3, 4, 3, 3,
        ]),
        new Int32Array([
            0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 1, 4, 0, 0, 0, 0, 0, 0, 2, 4, 0, 0, 0, 0, 0,
            0, 3, 4, 1, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 4, 4, 1, 1,
            1, 1, 1, 1, 4, 4, 2, 2, 2, 2, 2, 2, 4, 4, 2, 2, 2, 2, 2, 2, 4, 4, 2, 2, 2, 2, 2, 2, 4,
            4, 2, 2, 2, 2, 2, 2, 4, 4, 3, 3, 3, 3, 3, 3, 4, 4, 3, 3, 3, 3, 3, 3, 4, 4, 3, 3, 3, 3,
            3, 3, 4, 4, 3, 3, 3, 3, 3, 3, 4, 4,
        ]),
    ];

    if (count <= 0) {
        return;
    }

    var n = 0;

    if (a == 3) {
        var mask = (1 << b) - 1;
        var block_count = Math.floor((count + 4) / 5);
        var last_block_count = (count + 4) % 5 + 1;
        var block_size = 8 + 5 * b;
        var last_block_size = Math.floor((block_size * last_block_count + 4) / 5);

        if (reverse) {
            for (var i = 0, p = offset; i < block_count; i++, p -= block_size) {
                var now_size = (i < block_count - 1) ? block_size : last_block_size;
                var d = bit_reverse_u64(getbits64(buf, p - now_size, now_size), now_size);
                var x =
                    (d >> BigInt(b) & 3n) | (d >> BigInt(b) * 2n & 0xcn) | (d >> BigInt(b) * 3n & 0x10n) | (d >> BigInt(b) * 4n & 0x60n) | (d >> BigInt(b) * 5n & 0x80n);
                for (var j = 0; j < 5 && n < count; j++, n++) {
                    out[n].bits = Number(d >> BigInt(MT[j] + b * j)) & mask
                    out[n].nonbits = TRITS_TABLE[j][Number(x)]
                }
            }
        } else {
            for (var i = 0, p = offset; i < block_count; i++, p += block_size) {
                var now_size = (i < block_count - 1) ? block_size : last_block_size;
                var d = getbits64(buf, p, now_size);
                var x = (d >> BigInt(b) & 3n)
                    | (d >> BigInt(b) * 2n & 0xcn)
                    | (d >> BigInt(b) * 3n & 0x10n)
                    | (d >> BigInt(b) * 4n & 0x60n)
                    | (d >> BigInt(b) * 5n & 0x80n);
                for (var j = 0; j < 5 && n < count; j++, n++) {
                    out[n].bits = Number(d >> BigInt(MT[j] + b * j)) & mask
                    out[n].nonbits = TRITS_TABLE[j][Number(x)]
                }
            }
        }
    } else if (a == 5) {
        var mask = (1 << b) - 1;
        var block_count = Math.floor((count + 2) / 3);
        var last_block_count = (count + 2) % 3 + 1;
        var block_size = 7 + 3 * b;
        var last_block_size = Math.floor((block_size * last_block_count + 2) / 3);

        if (reverse) {
            for (var i = 0, p = offset; i < block_count; i++, p -= block_size) {
                var now_size = (i < block_count - 1) ? block_size : last_block_size;
                var d = bit_reverse_u64(getbits64(buf, p - now_size, now_size), now_size);
                var x = (d >> BigInt(b) & 7n) | (d >> BigInt(b) * 2n & 0x18n) | (d >> BigInt(b) * 3n & 0x60n);
                for (var j = 0; j < 3 && n < count; j++, n++) {
                    out[n].bits = Number(d >> BigInt(MQ[j] + b * j)) & mask
                    out[n].nonbits = QUINTS_TABLE[j][Number(x)]
                }
            }
        } else {
            for (var i = 0, p = offset; i < block_count; i++, p += block_size) {
                var d = getbits64(buf, p, (i < block_count - 1) ? block_size : last_block_size);
                var x = (d >> BigInt(b) & 7n) | (d >> BigInt(b) * 2n & 0x18n) | (d >> BigInt(b) * 3n & 0x60n);
                for (var j = 0; j < 3 && n < count; j++, n++) {
                    out[n].bits = Number(d >> BigInt(MQ[j] + b * j)) & mask
                    out[n].nonbits = QUINTS_TABLE[j][Number(x)]
                }
            }
        }
    } else {
        if (reverse) {
            for (var p = offset - b; n < count; n++, p -= b) {
                out[n].bits = bit_reverse_u8(getbits(buf, p, b), b)
                out[n].nonbits = 0
            }
        } else {
            for (var p = offset; n < count; n++, p += b) {
                out[n].bits = getbits(buf, p, b)
                out[n].nonbits = 0
            }
        }
    }
}

function decode_block_params(buf: Uint8Array, block_data: BlockData) {
    block_data.dual_plane = (buf[1] & 4) != 0;
    block_data.weight_range = ((buf[0] >> 4 & 1) | (buf[1] << 2 & 8));

    if ((buf[0] & 3) != 0) {
        block_data.weight_range |= buf[0] << 1 & 6;
        switch (buf[0] & 0xc) {
            case 0:
                block_data.width = (u8ptr_to_u16(buf) >> 7 & 3) + 4;
                block_data.height = (buf[0] >> 5 & 3) + 2;
                break;
            case 4:
                block_data.width = (u8ptr_to_u16(buf) >> 7 & 3) + 8;
                block_data.height = (buf[0] >> 5 & 3) + 2;
                break;
            case 8:
                block_data.width = (buf[0] >> 5 & 3) + 2;
                block_data.height = (u8ptr_to_u16(buf) >> 7 & 3) + 8;
                break;
            case 12:
                if ((buf[1] & 1) != 0) {
                    block_data.width = (buf[0] >> 7 & 1) + 2;
                    block_data.height = (buf[0] >> 5 & 3) + 2;
                } else {
                    block_data.width = (buf[0] >> 5 & 3) + 2;
                    block_data.height = (buf[0] >> 7 & 1) + 6;
                }
                break;
            default:
                break;
        }
    } else {
        block_data.weight_range |= buf[0] >> 1 & 6;
        switch (u8ptr_to_u16(buf) & 0x180) {
            case 0:
                block_data.width = 12;
                block_data.height = (buf[0] >> 5 & 3) + 2;
                break;
            case 0x80:
                block_data.width = (buf[0] >> 5 & 3) + 2;
                block_data.height = 12;
                break;
            case 0x100:
                block_data.width = (buf[0] >> 5 & 3) + 6;
                block_data.height = (buf[1] >> 1 & 3) + 6;
                block_data.dual_plane = false;
                block_data.weight_range &= 7;
                break;
            case 0x180:
                block_data.width = (buf[0] & 0x20) != 0 ? 10 : 6;
                block_data.height = (buf[0] & 0x20) != 0 ? 6 : 10;
                break;
            default:
                break;
        }
    }

    block_data.part_num = (buf[1] >> 3 & 3) + 1;

    block_data.weight_num = block_data.width * block_data.height;
    if (block_data.dual_plane) {
        block_data.weight_num *= 2;
    }

    let config_bits: number;
    let cem_base = 0;
    let weight_bits: number;
    switch (WEIGHT_PREC_TABLE_A[block_data.weight_range]) {
        case 3:
            weight_bits = Math.floor(block_data.weight_num * WEIGHT_PREC_TABLE_B[block_data.weight_range]
                + (block_data.weight_num * 8 + 4) / 5)
            break;
        case 5:
            weight_bits = Math.floor(block_data.weight_num * WEIGHT_PREC_TABLE_B[block_data.weight_range]
                + (block_data.weight_num * 7 + 2) / 3)
            break;
        default:
            weight_bits = block_data.weight_num * WEIGHT_PREC_TABLE_B[block_data.weight_range]
            break;
    }

    if (block_data.part_num == 1) {
        block_data.cem[0] = u8ptr_to_u16(buf.subarray(1)) >> 5 & 0xf;
        config_bits = 17;
    } else {
        cem_base = u8ptr_to_u16(buf.subarray(2)) >> 7 & 3;
        if (cem_base == 0) {
            let cem = buf[3] >> 1 & 0xf;
            for (let dd = 0; dd < block_data.part_num; dd++) {
                block_data.cem[dd] = cem
            }
            config_bits = 29;
        } else {
            for (let i = 0; i < Number(block_data.part_num); i++) {
                block_data.cem[i] = (buf[3] >> (i + 1) & 1) + cem_base - 1 << 2
            }
            switch (block_data.part_num) {
                case 2:
                    block_data.cem[0] |= buf[3] >> 3 & 3;
                    block_data.cem[1] |= getbits(buf, 126 - weight_bits, 2);
                    break;
                case 3:
                    block_data.cem[0] |= buf[3] >> 4 & 1;
                    block_data.cem[0] |= getbits(buf, 122 - weight_bits, 2) & 2;
                    block_data.cem[1] |= getbits(buf, 124 - weight_bits, 2);
                    block_data.cem[2] |= getbits(buf, 126 - weight_bits, 2);
                    break;
                case 4:
                    for (let xx = 0; xx < 4; xx++) {
                        block_data.cem[xx] |=
                            getbits(buf, 120 + xx * 2 - weight_bits, 2);
                    }
                    break;
                default:
                    break;
            }
            config_bits = 25 + block_data.part_num * 3;
        }
    }

    if (block_data.dual_plane) {
        config_bits += 2;
        block_data.plane_selector = getbits(
            buf,
            cem_base != 0 ?
                130 - weight_bits - block_data.part_num * 3
                :
                126 - weight_bits
            ,
            2,
        );
    }

    let remain_bits = 128 - config_bits - weight_bits;

    block_data.endpoint_value_num = 0;

    for (let i = 0; i < block_data.part_num; i++) {
        block_data.endpoint_value_num += (block_data.cem[i] >> 1 & 6) + 2;
    }

    let endpoint_bits: number;
    for (let i = 0; i < CEM_TABLE_A.length; i++) {
        switch (CEM_TABLE_A[i]) {
            case 3:
                endpoint_bits = Math.floor(block_data.endpoint_value_num * CEM_TABLE_B[i]
                    + (block_data.endpoint_value_num * 8 + 4) / 5);
                break;
            case 5:
                endpoint_bits = Math.floor(block_data.endpoint_value_num * CEM_TABLE_B[i]
                    + (block_data.endpoint_value_num * 7 + 2) / 3);
                break;
            default:
                endpoint_bits = block_data.endpoint_value_num * CEM_TABLE_B[i];
        }
        if (endpoint_bits <= remain_bits) {
            block_data.cem_range = i;
            break;
        }
    }
}

function decode_endpoints_hdr7(endpoints: Int32Array, v: Int32Array) {
    let modeval = (v[2] >> 4 & 0x8) | (v[1] >> 5 & 0x4) | (v[0] >> 6);
    let major_component = (modeval & 0xc) != 0xc ? modeval >> 2 : (modeval != 0xf) ? modeval & 3 : 0
    let mode = (modeval & 0xc) != 0xc ? modeval & 3 : (modeval != 0xf) ? 4 : 5
    let c = new Int32Array([v[0] & 0x3f, v[1] & 0x1f, v[2] & 0x1f, v[3] & 0x1f]);

    switch (mode) {
        case 0:
            c[3] |= v[3] & 0x60;
            c[0] |= v[3] >> 1 & 0x40;
            c[0] |= v[2] << 1 & 0x80;
            c[0] |= v[1] << 3 & 0x300;
            c[0] |= v[2] << 5 & 0x400;
            c[0] <<= 1;
            c[1] <<= 1;
            c[2] <<= 1;
            c[3] <<= 1;
            break;
        case 1:
            c[1] |= v[1] & 0x20;
            c[2] |= v[2] & 0x20;
            c[0] |= v[3] >> 1 & 0x40;
            c[0] |= v[2] << 1 & 0x80;
            c[0] |= v[1] << 2 & 0x100;
            c[0] |= v[3] << 4 & 0x600;
            c[0] <<= 1;
            c[1] <<= 1;
            c[2] <<= 1;
            c[3] <<= 1;
            break;
        case 2:
            c[3] |= v[3] & 0xe0;
            c[0] |= v[2] << 1 & 0xc0;
            c[0] |= v[1] << 3 & 0x300;
            c[0] <<= 2;
            c[1] <<= 2;
            c[2] <<= 2;
            c[3] <<= 2;
            break;
        case 3:
            c[1] |= v[1] & 0x20;
            c[2] |= v[2] & 0x20;
            c[3] |= v[3] & 0x60;
            c[0] |= v[3] >> 1 & 0x40;
            c[0] |= v[2] << 1 & 0x80;
            c[0] |= v[1] << 2 & 0x100;
            c[0] <<= 3;
            c[1] <<= 3;
            c[2] <<= 3;
            c[3] <<= 3;
            break;
        case 4:
            c[1] |= v[1] & 0x60;
            c[2] |= v[2] & 0x60;
            c[3] |= v[3] & 0x20;
            c[0] |= v[3] >> 1 & 0x40;
            c[0] |= v[3] << 1 & 0x80;
            c[0] <<= 4;
            c[1] <<= 4;
            c[2] <<= 4;
            c[3] <<= 4;
            break;
        case 5:
            c[1] |= v[1] & 0x60;
            c[2] |= v[2] & 0x60;
            c[3] |= v[3] & 0x60;
            c[0] |= v[3] >> 1 & 0x40;
            c[0] <<= 5;
            c[1] <<= 5;
            c[2] <<= 5;
            c[3] <<= 5;
            break;
        default:
            break;
    }

    if (mode != 5) {
        c[1] = c[0] - c[1];
        c[2] = c[0] - c[2];
    }

    switch (major_component) {
        case 1:
            set_endpoint_hdr_clamp(
                endpoints,
                c[1] - c[3],
                c[0] - c[3],
                c[2] - c[3],
                0x780,
                c[1],
                c[0],
                c[2],
                0x780,
            );
            break;
        case 2:
            set_endpoint_hdr_clamp(
                endpoints,
                c[2] - c[3],
                c[1] - c[3],
                c[0] - c[3],
                0x780,
                c[2],
                c[1],
                c[0],
                0x780,
            );
            break;
        default:
            set_endpoint_hdr_clamp(
                endpoints,
                c[0] - c[3],
                c[1] - c[3],
                c[2] - c[3],
                0x780,
                c[0],
                c[1],
                c[2],
                0x780,
            );
            break;
    }
}

function decode_endpoints_hdr11(endpoints: Int32Array, v: Int32Array, alpha1: number, alpha2: number) {
    let major_component = (v[4] >> 7) | (v[5] >> 6 & 2);
    if (major_component == 3) {
        set_endpoint_hdr(endpoints, v[0] << 4, v[2] << 4, v[4] << 5 & 0xfe0, alpha1, v[1] << 4, v[3] << 4, v[5] << 5 & 0xfe0, alpha2);
        return;
    }
    let mode = (v[1] >> 7) | (v[2] >> 6 & 2) | (v[3] >> 5 & 4);
    let va = v[0] | (v[1] << 2 & 0x100);
    let vb0 = v[2] & 0x3f;
    let vb1 = v[3] & 0x3f;
    let vc = v[1] & 0x3f;
    let vd0: number;
    let vd1: number;

    switch (mode) {
        case 0:
        case 2:
            vd0 = v[4] & 0x7f;
            if ((vd0 & 0x40) != 0) {
                vd0 |= 0xff80;
            }
            vd1 = v[5] & 0x7f;
            if ((vd1 & 0x40) != 0) {
                vd1 |= 0xff80;
            }
            break;
        case 1:
        case 3:
        case 5:
        case 7:
            vd0 = v[4] & 0x3f;
            if ((vd0 & 0x20) != 0) {
                vd0 |= 0xffc0;
            }
            vd1 = v[5] & 0x3f;
            if ((vd1 & 0x20) != 0) {
                vd1 |= 0xffc0;
            }
            break;
        default:
            vd0 = v[4] & 0x1f;
            if ((vd0 & 0x10) != 0) {
                vd0 |= 0xffe0;
            }
            vd1 = v[5] & 0x1f;
            if ((vd1 & 0x10) != 0) {
                vd1 |= 0xffe0;
            }
            break;
    }

    switch (mode) {
        case 0:
            vb0 |= v[2] & 0x40;
            vb1 |= v[3] & 0x40;
            break;
        case 1:
            vb0 |= v[2] & 0x40;
            vb1 |= v[3] & 0x40;
            vb0 |= v[4] << 1 & 0x80;
            vb1 |= v[5] << 1 & 0x80;
            break;
        case 2:
            va |= v[2] << 3 & 0x200;
            vc |= v[3] & 0x40;
            break;
        case 3:
            va |= v[4] << 3 & 0x200;
            vc |= v[5] & 0x40;
            vb0 |= v[2] & 0x40;
            vb1 |= v[3] & 0x40;
            break;
        case 4:
            va |= v[4] << 4 & 0x200;
            va |= v[5] << 5 & 0x400;
            vb0 |= v[2] & 0x40;
            vb1 |= v[3] & 0x40;
            vb0 |= v[4] << 1 & 0x80;
            vb1 |= v[5] << 1 & 0x80;
            break;
        case 5:
            va |= v[2] << 3 & 0x200;
            va |= v[3] << 4 & 0x400;
            vc |= v[5] & 0x40;
            vc |= v[4] << 1 & 0x80;
            break;
        case 6:
            va |= v[4] << 4 & 0x200;
            va |= v[5] << 5 & 0x400;
            va |= v[4] << 5 & 0x800;
            vc |= v[5] & 0x40;
            vb0 |= v[2] & 0x40;
            vb1 |= v[3] & 0x40;
            break;
        case 7:
            va |= v[2] << 3 & 0x200;
            va |= v[3] << 4 & 0x400;
            va |= v[4] << 5 & 0x800;
            vc |= v[5] & 0x40;
            break;
        default:
            break;
    }

    let shamt = (mode >> 1) ^ 3;
    va <<= shamt;
    vb0 <<= shamt;
    vb1 <<= shamt;
    vc <<= shamt;
    let mult = 1 << shamt;
    vd0 *= mult;
    vd1 *= mult;

    switch (major_component) {
        case 1:
            set_endpoint_hdr_clamp(
                endpoints,
                va - vb0 - vc - vd0,
                va - vc,
                va - vb1 - vc - vd1,
                alpha1,
                va - vb0,
                va,
                va - vb1,
                alpha2,
            );
            break;
        case 2:
            set_endpoint_hdr_clamp(
                endpoints,
                va - vb1 - vc - vd1,
                va - vb0 - vc - vd0,
                va - vc,
                alpha1,
                va - vb1,
                va - vb0,
                va,
                alpha2,
            );
            break;
        default:
            set_endpoint_hdr_clamp(
                endpoints,
                va - vc,
                va - vb0 - vc - vd0,
                va - vb1 - vc - vd1,
                alpha1,
                va,
                va - vb0,
                va - vb1,
                alpha2,
            );
            break;
    }
}

function decode_endpoints(buf: Uint8Array, data: BlockData) {
    const TRITS_TABLE = new Int32Array([0, 204, 93, 44, 22, 11, 5]);
    const QUINTS_TABLE = new Int32Array([0, 113, 54, 26, 13, 6]);
    let seq = Array.from({ length: 32 }, () => new bits()) as IntSeqData[]
    let ev = new Int32Array(32);
    decode_intseq(buf, data.part_num == 1 ? 17 : 29, CEM_TABLE_A[data.cem_range], CEM_TABLE_B[data.cem_range], data.endpoint_value_num, false, seq);

    switch (CEM_TABLE_A[data.cem_range]) {
        case 3:
            for (var i = 0, b = 0, c = TRITS_TABLE[CEM_TABLE_B[data.cem_range]]; i < data.endpoint_value_num; i++) {
                var a = (seq[i].bits & 1) * 0x1ff;
                var x = seq[i].bits >> 1;
                switch (CEM_TABLE_B[data.cem_range]) {
                    case 1:
                        b = 0;
                        break;
                    case 2:
                        b = 0b100010110 * x;
                        break;
                    case 3:
                        b = x << 7 | x << 2 | x;
                        break;
                    case 4:
                        b = x << 6 | x;
                        break;
                    case 5:
                        b = x << 5 | x >> 2;
                        break;
                    case 6:
                        b = x << 4 | x >> 4;
                        break;
                }
                ev[i] = (a & 0x80) | ((seq[i].nonbits * c + b) ^ a) >> 2;
            }
            break;
        case 5:
            for (var i = 0, b = 0, c = QUINTS_TABLE[CEM_TABLE_B[data.cem_range]]; i < data.endpoint_value_num; i++) {
                var a = (seq[i].bits & 1) * 0x1ff;
                var x = seq[i].bits >> 1;
                switch (CEM_TABLE_B[data.cem_range]) {
                    case 1:
                        b = 0;
                        break;
                    case 2:
                        b = 0b100001100 * x;
                        break;
                    case 3:
                        b = x << 7 | x << 1 | x >> 1;
                        break;
                    case 4:
                        b = x << 6 | x >> 1;
                        break;
                    case 5:
                        b = x << 5 | x >> 3;
                        break;
                }
                ev[i] = (a & 0x80) | ((seq[i].nonbits * c + b) ^ a) >> 2;
            }
            break;
        default:
            switch (CEM_TABLE_B[data.cem_range]) {
                case 1:
                    for (var i = 0; i < data.endpoint_value_num; i++)
                        ev[i] = seq[i].bits * 0xff;
                    break;
                case 2:
                    for (var i = 0; i < data.endpoint_value_num; i++)
                        ev[i] = seq[i].bits * 0x55;
                    break;
                case 3:
                    for (var i = 0; i < data.endpoint_value_num; i++)
                        ev[i] = seq[i].bits << 5 | seq[i].bits << 2 | seq[i].bits >> 1;
                    break;
                case 4:
                    for (var i = 0; i < data.endpoint_value_num; i++)
                        ev[i] = seq[i].bits << 4 | seq[i].bits;
                    break;
                case 5:
                    for (var i = 0; i < data.endpoint_value_num; i++)
                        ev[i] = seq[i].bits << 3 | seq[i].bits >> 2;
                    break;
                case 6:
                    for (var i = 0; i < data.endpoint_value_num; i++)
                        ev[i] = seq[i].bits << 2 | seq[i].bits >> 4;
                    break;
                case 7:
                    for (var i = 0; i < data.endpoint_value_num; i++)
                        ev[i] = seq[i].bits << 1 | seq[i].bits >> 6;
                    break;
                case 8:
                    for (var i = 0; i < data.endpoint_value_num; i++)
                        ev[i] = seq[i].bits;
                    break;
            }
    }

    var v = ev;
    for (var cem = 0; cem < data.part_num; v = v.subarray((Math.floor(data.cem[cem] / 4) + 1) * 2), cem++) {
        switch (data.cem[cem]) {
            case 0:
                set_endpoint(data.endpoints[cem], v[0], v[0], v[0], 255, v[1], v[1], v[1], 255);
                break;
            case 1: {
                var l0 = (v[0] >> 2) | (v[1] & 0xc0);
                var l1 = clamp(l0 + (v[1] & 0x3f), 0, 255);
                set_endpoint(data.endpoints[cem], l0, l0, l0, 255, l1, l1, l1, 255);
            } break;
            case 2: {
                var y0: number, y1: number;
                if (v[0] <= v[1]) {
                    y0 = v[0] << 4;
                    y1 = v[1] << 4;
                } else {
                    y0 = (v[1] << 4) + 8;
                    y1 = (v[0] << 4) - 8;
                }
                set_endpoint_hdr(data.endpoints[cem], y0, y0, y0, 0x780, y1, y1, y1, 0x780);
            } break;
            case 3: {
                var y0: number, d: number;
                if (v[0] & 0x80) {
                    y0 = (v[1] & 0xe0) << 4 | (v[0] & 0x7f) << 2;
                    d = (v[1] & 0x1f) << 2;
                } else {
                    y0 = (v[1] & 0xf0) << 4 | (v[0] & 0x7f) << 1;
                    d = (v[1] & 0x0f) << 1;
                }
                var y1 = clamp(y0 + d, 0, 0xfff);
                set_endpoint_hdr(data.endpoints[cem], y0, y0, y0, 0x780, y1, y1, y1, 0x780);
            } break;
            case 4:
                set_endpoint(data.endpoints[cem], v[0], v[0], v[0], v[2], v[1], v[1], v[1], v[3]);
                break;
            case 5:
                bit_transfer_signed_alt(v, 1, 0);
                bit_transfer_signed_alt(v, 3, 2);
                v[1] += v[0];
                set_endpoint_clamp(data.endpoints[cem], v[0], v[0], v[0], v[2], v[1], v[1], v[1], v[2] + v[3]);
                break;
            case 6:
                set_endpoint(data.endpoints[cem], v[0] * v[3] >> 8, v[1] * v[3] >> 8, v[2] * v[3] >> 8, 255, v[0], v[1],
                    v[2], 255);
                break;
            case 7:
                decode_endpoints_hdr7(data.endpoints[cem], v);
                break;
            case 8:
                if (v[0] + v[2] + v[4] <= v[1] + v[3] + v[5])
                    set_endpoint(data.endpoints[cem], v[0], v[2], v[4], 255, v[1], v[3], v[5], 255);
                else
                    set_endpoint_blue(data.endpoints[cem], v[1], v[3], v[5], 255, v[0], v[2], v[4], 255);
                break;
            case 9:
                bit_transfer_signed_alt(v, 1, 0);
                bit_transfer_signed_alt(v, 3, 2);
                bit_transfer_signed_alt(v, 5, 4);
                if (v[1] + v[3] + v[5] >= 0)
                    set_endpoint_clamp(data.endpoints[cem], v[0], v[2], v[4], 255, v[0] + v[1], v[2] + v[3], v[4] + v[5],
                        255);
                else
                    set_endpoint_blue_clamp(data.endpoints[cem], v[0] + v[1], v[2] + v[3], v[4] + v[5], 255, v[0], v[2],
                        v[4], 255);
                break;
            case 10:
                set_endpoint(data.endpoints[cem], v[0] * v[3] >> 8, v[1] * v[3] >> 8, v[2] * v[3] >> 8, v[4], v[0], v[1],
                    v[2], v[5]);
                break;
            case 11:
                decode_endpoints_hdr11(data.endpoints[cem], v, 0x780, 0x780);
                break;
            case 12:
                if (v[0] + v[2] + v[4] <= v[1] + v[3] + v[5])
                    set_endpoint(data.endpoints[cem], v[0], v[2], v[4], v[6], v[1], v[3], v[5], v[7]);
                else
                    set_endpoint_blue(data.endpoints[cem], v[1], v[3], v[5], v[7], v[0], v[2], v[4], v[6]);
                break;
            case 13:
                bit_transfer_signed_alt(v, 1, 0);
                bit_transfer_signed_alt(v, 3, 2);
                bit_transfer_signed_alt(v, 5, 4);
                bit_transfer_signed_alt(v, 7, 6);
                if (v[1] + v[3] + v[5] >= 0)
                    set_endpoint_clamp(data.endpoints[cem], v[0], v[2], v[4], v[6], v[0] + v[1], v[2] + v[3], v[4] + v[5],
                        v[6] + v[7]);
                else
                    set_endpoint_blue_clamp(data.endpoints[cem], v[0] + v[1], v[2] + v[3], v[4] + v[5], v[6] + v[7], v[0],
                        v[2], v[4], v[6]);
                break;
            case 14:
                decode_endpoints_hdr11(data.endpoints[cem], v, v[6], v[7]);
                break;
            case 15: {
                var mode = ((v[6] >> 7) & 1) | ((v[7] >> 6) & 2);
                v[6] &= 0x7f;
                v[7] &= 0x7f;
                if (mode == 3) {
                    decode_endpoints_hdr11(data.endpoints[cem], v, v[6] << 5, v[7] << 5);
                } else {
                    v[6] |= (v[7] << (mode + 1)) & 0x780;
                    v[7] = ((v[7] & (0x3f >> mode)) ^ (0x20 >> mode)) - (0x20 >> mode);
                    v[6] <<= 4 - mode;
                    v[7] <<= 4 - mode;
                    decode_endpoints_hdr11(data.endpoints[cem], v, v[6], clamp(v[6] + v[7], 0, 0xfff));
                }
            } break;
            default:
                throw new Error("Unsupported ASTC format");
        }
    }
}

function decode_weights(buf: Uint8Array, data: BlockData) {
    let seq = Array.from({ length: 128 }, () => new bits()) as IntSeqData[]
    let wv = new Int32Array(128)
    decode_intseq(buf, 128, WEIGHT_PREC_TABLE_A[data.weight_range], WEIGHT_PREC_TABLE_B[data.weight_range], data.weight_num, true, seq);

    if (WEIGHT_PREC_TABLE_A[data.weight_range] == 0) {
        switch (WEIGHT_PREC_TABLE_B[data.weight_range]) {
            case 1:
                for (let i = 0; i < data.weight_num; i++) {
                    wv[i] = seq[i].bits != 0 ? 63 : 0;
                }
                break;
            case 2:
                for (let i = 0; i < data.weight_num; i++) {
                    wv[i] = seq[i].bits << 4 | seq[i].bits << 2 | seq[i].bits;
                }
                break;
            case 3:
                for (let i = 0; i < data.weight_num; i++) {
                    wv[i] = seq[i].bits << 3 | seq[i].bits;
                }
                break;
            case 4:
                for (let i = 0; i < data.weight_num; i++) {
                    wv[i] = seq[i].bits << 2 | seq[i].bits >> 2;
                }
                break;
            case 5:
                for (let i = 0; i < data.weight_num; i++) {
                    wv[i] = seq[i].bits << 1 | seq[i].bits >> 4;
                }
                break;
            default:
                throw new Error("Unsupported ASTC format: " + WEIGHT_PREC_TABLE_B[data.weight_range]);
        }
        for (let i = 0; i < data.weight_num; i++) {
            if (wv[i] > 32) {
                wv[i] += 1;
            }
        }
    } else if (WEIGHT_PREC_TABLE_B[data.weight_range] == 0) {
        let s = WEIGHT_PREC_TABLE_A[data.weight_range] == 3 ? 32 : 16;
        for (let i = 0; i < data.weight_num; i++) {
            wv[i] = seq[i].nonbits * s;
        }
    } else {
        if (WEIGHT_PREC_TABLE_A[data.weight_range] == 3) {
            switch (WEIGHT_PREC_TABLE_B[data.weight_range]) {
                case 1:
                    for (let i = 0; i < data.weight_num; i++) {
                        wv[i] = seq[i].nonbits * 50;
                    }
                    break;
                case 2:
                    for (let i = 0; i < data.weight_num; i++) {
                        wv[i] = seq[i].nonbits * 23;
                        if ((seq[i].bits & 2) != 0) {
                            wv[i] += 0b1000101;
                        }
                    }
                    break;
                case 3:
                    for (let i = 0; i < data.weight_num; i++) {
                        wv[i] = seq[i].nonbits * 11 + ((seq[i].bits << 4 | seq[i].bits >> 1) & 0b1100011)
                    }
                    break;
                default:
                    throw new Error("Unsupported ASTC format: " + WEIGHT_PREC_TABLE_B[data.weight_range]);
            }
        } else if (WEIGHT_PREC_TABLE_A[data.weight_range] == 5) {
            switch (WEIGHT_PREC_TABLE_B[data.weight_range]) {
                case 1:
                    for (let i = 0; i < data.weight_num; i++) {
                        wv[i] = seq[i].nonbits * 28;
                    }
                    break;
                case 2:
                    for (let i = 0; i < data.weight_num; i++) {
                        wv[i] = seq[i].nonbits * 13;
                        if ((seq[i].bits & 2) != 0) {
                            wv[i] += 0b1000010;
                        }
                    }
                    break;
                default:
                    throw new Error("Unsupported ASTC format: " + WEIGHT_PREC_TABLE_B[data.weight_range]);
            }
        }
        for (let i = 0; i < data.weight_num; i++) {
            let a = (seq[i].bits & 1) * 0x7f;
            wv[i] = (a & 0x20) | ((wv[i] ^ a) >> 2);
            if (wv[i] > 32) {
                wv[i] += 1;
            }
        };
    }

    let ds = Math.floor((1024 + data.bw / 2) / (data.bw - 1));
    let dt = Math.floor((1024 + data.bh / 2) / (data.bh - 1));
    let pn = data.dual_plane ? 2 : 1;

    var i = 0;
    for (var t = 0; t < data.bh; t++) {
        for (var s = 0; s < data.bw; s++) {
            let gs = (ds * s * (data.width - 1) + 32) >> 6;
            let gt = (dt * t * (data.height - 1) + 32) >> 6;
            let fs = gs & 0xf;
            let ft = gt & 0xf;
            let v = (gs >> 4) + (gt >> 4) * data.width;
            let w11 = ((fs * ft + 8) >> 4);
            let w10 = ft - w11;
            let w01 = fs - w11;
            let w00 = 16 - fs - ft + w11;
            for (let p = 0; p < pn; p++) {
                let p00 = wv[v * pn + p];
                let p01 = wv[(v + 1) * pn + p];
                let p10 = wv[(v + data.width) * pn + p];
                let p11 = wv[(v + data.width + 1) * pn + p];
                data.weights[i][p] = (p00 * w00 + p01 * w01 + p10 * w10 + p11 * w11 + 8) >> 4;
            }
            i += 1;
        }
    }
}

function select_partition(buf: Uint8Array, data: BlockData, block_num?: number) {
    let small_block = data.bw * data.bh < 31;

    let seed = (((buf[3] & 0xFF) << 24) | ((buf[2] & 0xFF) << 16) | ((buf[1] & 0xFF) << 8) | (buf[0] & 0xFF))
    seed = (seed >> 13 & 0x3ff) | (data.part_num - 1) << 10;

    let rnum1 = new Uint32Array([seed]);
    rnum1[0] ^= rnum1[0] >>> 15;
    rnum1[0] -= rnum1[0] << 17;
    rnum1[0] += rnum1[0] << 7;
    rnum1[0] += rnum1[0] << 4;
    rnum1[0] ^= rnum1[0] >>> 5;
    rnum1[0] += rnum1[0] << 16;
    rnum1[0] ^= rnum1[0] >>> 7;
    rnum1[0] ^= rnum1[0] >>> 3;
    rnum1[0] ^= rnum1[0] << 6;
    rnum1[0] ^= rnum1[0] >>> 17;
    let rnum = rnum1[0]

    let seeds = new Int32Array(8);
    for (let i = 0; i < 8; i++) {
        let v = rnum >> (i * 4) & 0xF;
        seeds[i] = (v * v) as number;
    }
    let sh = new Int32Array([
        (seed & 2) != 0 ? 4 : 5,
        data.part_num == 3 ? 6 : 5
    ]);

    if ((seed & 1) != 0) {
        for (let i = 0; i < 8; i++) {
            seeds[i] >>= sh[i % 2]
        }
    } else {
        for (let i = 0; i < 8; i++) {
            seeds[i] >>= sh[1 - i % 2]
        }
    }

    if (small_block) {
        for (var t = 0, i = 0; t < data.bh; t++) {
            for (var s = 0; s < data.bw; s++, i++) {
                var x = s << 1;
                var y = t << 1;
                var a = (seeds[0] * x + seeds[1] * y + (rnum >> 14)) & 0x3f;
                var b = (seeds[2] * x + seeds[3] * y + (rnum >> 10)) & 0x3f;
                var c = data.part_num < 3 ? 0 : (seeds[4] * x + seeds[5] * y + (rnum >> 6)) & 0x3f;
                var d = data.part_num < 4 ? 0 : (seeds[6] * x + seeds[7] * y + (rnum >> 2)) & 0x3f;
                data.partition[i] = (a >= b && a >= c && a >= d) ? 0 : (b >= c && b >= d) ? 1 : (c >= d) ? 2 : 3;
            }
        }
    } else {
        for (var y = 0, i = 0; y < data.bh; y++) {
            for (var x = 0; x < data.bw; x++, i++) {
                var a = (seeds[0] * x + seeds[1] * y + (rnum >> 14)) & 0x3f;
                var b = (seeds[2] * x + seeds[3] * y + (rnum >> 10)) & 0x3f;
                var c = data.part_num < 3 ? 0 : (seeds[4] * x + seeds[5] * y + (rnum >> 6)) & 0x3f;
                var d = data.part_num < 4 ? 0 : (seeds[6] * x + seeds[7] * y + (rnum >> 2)) & 0x3f;
                data.partition[i] = (a >= b && a >= c && a >= d) ? 0 : (b >= c && b >= d) ? 1 : (c >= d) ? 2 : 3;
            }
        }
    }
}

function applicate_color(data: BlockData, outbuf: Uint32Array) {
    const FUNC_TABLE_C = [select_color, select_color, select_color_hdr, select_color_hdr,
        select_color, select_color, select_color, select_color_hdr, select_color,
        select_color, select_color, select_color_hdr, select_color, select_color,
        select_color_hdr, select_color_hdr];
    const FUNC_TABLE_A = [select_color, select_color, select_color_hdr, select_color_hdr,
        select_color, select_color, select_color, select_color_hdr, select_color,
        select_color, select_color, select_color_hdr, select_color, select_color,
        select_color, select_color_hdr];
    if (data.dual_plane) {
        let ps = [0, 0, 0, 0];
        ps[data.plane_selector] = 1;
        if (data.part_num > 1) {
            for (let i = 0; i < data.bw * data.bh; i++) {
                let p = data.partition[i];
                let pp = data.cem[p];
                let r = FUNC_TABLE_C[pp](data.endpoints[p][0], data.endpoints[p][4], data.weights[i][ps[0]]);
                let g = FUNC_TABLE_C[pp](data.endpoints[p][1], data.endpoints[p][5], data.weights[i][ps[1]]);
                let b = FUNC_TABLE_C[pp](data.endpoints[p][2], data.endpoints[p][6], data.weights[i][ps[2]]);
                let a = FUNC_TABLE_A[pp](data.endpoints[p][3], data.endpoints[p][7], data.weights[i][ps[3]]);
                outbuf[i] = color(r, g, b, a);
            };
        } else {
            for (let i = 0; i < (data.bw * data.bh); i++) {
                let pp = data.cem[0];
                let r = FUNC_TABLE_C[pp](data.endpoints[0][0], data.endpoints[0][4], data.weights[i][ps[0]]);
                let g = FUNC_TABLE_C[pp](data.endpoints[0][1], data.endpoints[0][5], data.weights[i][ps[1]]);
                let b = FUNC_TABLE_C[pp](data.endpoints[0][2], data.endpoints[0][6], data.weights[i][ps[2]]);
                let a = FUNC_TABLE_A[pp](data.endpoints[0][3], data.endpoints[0][7], data.weights[i][ps[3]]);
                outbuf[i] = color(r, g, b, a);
            };
        }
    } else if (data.part_num > 1) {
        for (let i = 0; i < (data.bw * data.bh); i++) {
            let p = data.partition[i];
            let pp = data.cem[p];
            let r = FUNC_TABLE_C[pp](data.endpoints[p][0], data.endpoints[p][4], data.weights[i][0]);
            let g = FUNC_TABLE_C[pp](data.endpoints[p][1], data.endpoints[p][5], data.weights[i][0]);
            let b = FUNC_TABLE_C[pp](data.endpoints[p][2], data.endpoints[p][6], data.weights[i][0]);
            let a = FUNC_TABLE_A[pp](data.endpoints[p][3], data.endpoints[p][7], data.weights[i][0]);
            outbuf[i] = color(r, g, b, a);
        };
    } else {
        for (let i = 0; i < (data.bw * data.bh); i++) {
            let pp = data.cem[0]
            let r = FUNC_TABLE_C[pp](data.endpoints[0][0], data.endpoints[0][4], data.weights[i][0]);
            let g = FUNC_TABLE_C[pp](data.endpoints[0][1], data.endpoints[0][5], data.weights[i][0]);
            let b = FUNC_TABLE_C[pp](data.endpoints[0][2], data.endpoints[0][6], data.weights[i][0]);
            let a = FUNC_TABLE_A[pp](data.endpoints[0][3], data.endpoints[0][7], data.weights[i][0]);
            outbuf[i] = color(r, g, b, a);
        };
    }
}

function decode_astc_block(buf: Uint8Array, block_width: number, block_height: number, outbuf: Uint32Array, block_num?: number) {
    if (buf[0] == 0xfc && (buf[1] & 1) == 1) {
        var c: number;
        if ((buf[1] & 2) != 0) {
            c = color(f16ptr_to_u8(buf.subarray(8)), f16ptr_to_u8(buf.subarray(10)), f16ptr_to_u8(buf.subarray(12)), f16ptr_to_u8(buf.subarray(14)))
        } else {
            c = color(buf[9], buf[11], buf[13], buf[15])
        };
        for (var i = 0; i < block_width * block_height; i++) {
            outbuf[i] = c;
        }
    } else if (((buf[0] & 0xc3) == 0xc0 && (buf[1] & 1) == 1) || (buf[0] & 0xf) == 0) {
        var c = color(255, 0, 255, 255);
        for (var i = 0; i < block_width * block_height; i++) {
            outbuf[i] = c;
        }
    } else {
        let block_data = BlockDataDefault();
        block_data.bw = block_width;
        block_data.bh = block_height;
        decode_block_params(buf, block_data);
        decode_endpoints(buf, block_data);
        decode_weights(buf, block_data);
        if (block_data.part_num > 1) {
            select_partition(buf, block_data);
        }
        applicate_color(block_data, outbuf);
    }
}

function copy_block_buffer(bx: number, by: number, w: number, h: number, bw: number, bh: number, buffer: Uint32Array, image: Uint32Array) {
    let x = bw * bx;
    let copy_width = bw * (bx + 1) > w ? (w - bw * bx) : bw
    let y_0 = by * bh;
    let copy_height = bh * (by + 1) > h ? h - y_0 : bh;
    let buffer_offset = 0;
    for (let y = y_0; y < y_0 + copy_height; y++) {
        let image_offset = y * w + x;
        let bufferIndex = buffer_offset;
        for (let i = 0; i < copy_width; i++) {
            image[image_offset + i] = buffer[bufferIndex];
            bufferIndex++;
        }
        buffer_offset += bw;
    }
}

function decodeASTC(src: Uint8Array, width: number, height: number, block_width: number, block_height: number) {
    const num_blocks_x = Math.floor((width + block_width - 1) / block_width);
    const num_blocks_y = Math.floor((height + block_height - 1) / block_height);
    const raw_block_size = 16;
    const buffer = new Uint32Array(144);
    var data_offset = 0;
    var image = new Uint32Array(width * height);

    for (var by = 0; by < num_blocks_y; by++) {
        for (var bx = 0; bx < num_blocks_x; bx++) {
            decode_astc_block(src.subarray(data_offset, data_offset + raw_block_size), block_width, block_height, buffer)
            copy_block_buffer(bx, by, width, height, block_width, block_height, buffer, image);
            data_offset += raw_block_size;
        }
    }

    return new Uint8Array(image.buffer)
}

export function decodeASTC_8x8(src: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
    return decodeASTC(src, width, height, 8, 8);
}
