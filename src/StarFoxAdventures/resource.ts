import * as pako from 'pako';
import { hexzero } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';

import { GameInfo } from './scenes';

class ZLBHeader {
    public static readonly SIZE = 16;

    public magic: number;
    public unk4: number;
    public unk8: number;
    public size: number;

    constructor(dv: DataView) {
        this.magic = dv.getUint32(0x0);
        this.unk4 = dv.getUint32(0x4);
        this.unk8 = dv.getUint32(0x8);
        this.size = dv.getUint32(0xC);
    }
}

function stringToFourCC(s: string): number {
    return (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)
}

function loadZLB(compData: ArrayBufferSlice): ArrayBuffer {
    const dv = compData.createDataView();
    const header = new ZLBHeader(dv);

    if (header.magic != stringToFourCC('ZLB\0')) {
        throw Error(`Invalid magic identifier 0x${hexzero(header.magic, 8)}`);
    }

    return pako.inflate(new Uint8Array(compData.copyToBuffer(ZLBHeader.SIZE, header.size))).buffer;
}

function loadDIRn(data: ArrayBufferSlice): ArrayBuffer {
    const dv = data.createDataView();
    const size = dv.getUint32(8);
    return data.copyToBuffer(0x20, size);
}

// Reference: <https://www.kernel.org/doc/Documentation/lzo.txt>
// FIXME: Replace with existing LZO implementation that I didn't realize existed!
function loadLZOn(data: ArrayBufferSlice, srcOffs: number): ArrayBuffer {
    const dv = data.createDataView();
    const uncompSize = dv.getUint32(srcOffs + 0x8)
    srcOffs += 0x10
    let dstOffs = 0;
    const dst = new Uint8Array(uncompSize);

    function getLength(code: number, numBits: number): number {
        const mask = (1 << numBits) - 1;
        let length = code & mask;
        if (length == 0) {
            length = mask;
            while (dv.getUint8(srcOffs) == 0) {
                length += 255;
                srcOffs++;
            }
            length += dv.getUint8(srcOffs++);
        }
        return length;
    }

    let state = 0;
    const firstByte = dv.getUint8(srcOffs++);
    if (firstByte >= 0 && firstByte <= 16) {
        // state 0 literal
        let length = getLength(firstByte, 4) + 3;
        state = 4;
        for (let i = 0; i < length; i++) {
            dst[dstOffs++] = dv.getUint8(srcOffs++);
        }
    } else if (firstByte == 17) {
        throw Error(`RLE compression mode not implemented`);
    } else if (firstByte >= 18 && firstByte <= 21) {
        state = firstByte - 17;
        for (let i = 0; i < state; i++) {
            dst[dstOffs++] = dv.getUint8(srcOffs++);
        }
    } else {
        throw Error(`firstByte in 22..255 not handled`);
    }

    while (dstOffs < uncompSize) {
        const code = dv.getUint8(srcOffs++);
        if (code >= 128) {
            const s = code & 0x3;
            state = s;
            const d = (code >> 2) & 0x7;
            const l = (code >> 5) & 0x3;
            const length = 5 + l;
            const h = dv.getUint8(srcOffs++);
            const distance = (h << 3) + d + 1;
            let msrc = dstOffs - distance;
            for (let i = 0; i < length; i++) {
                dst[dstOffs++] = dst[msrc++];
            }
            for (let i = 0; i < s; i++) {
                dst[dstOffs++] = dv.getUint8(srcOffs++);
            }
        } else if (code >= 64) {
            const l = (code >> 5) & 0x1;
            const d = (code >> 2) & 0x7;
            const s = code & 0x3;
            state = s;
            const length = 3 + l;
            const h = dv.getUint8(srcOffs++);
            const distance = (h << 3) + d + 1;
            let msrc = dstOffs - distance;
            for (let i = 0; i < length; i++) {
                dst[dstOffs++] = dst[msrc++];
            }
            for (let i = 0; i < s; i++) {
                dst[dstOffs++] = dv.getUint8(srcOffs++);
            }
        } else if (code >= 32) {
            const length = getLength(code, 5) + 2;
            const d = dv.getUint16(srcOffs, true) >> 2;
            const s = dv.getUint16(srcOffs, true) & 0x3;
            srcOffs += 2;
            const distance = d + 1;
            state = s;
            let msrc = dstOffs - distance;
            for (let i = 0; i < length; i++) {
                dst[dstOffs++] = dst[msrc++];
            }
            for (let i = 0; i < s; i++) {
                dst[dstOffs++] = dv.getUint8(srcOffs++);
            }
        } else if (code >= 16) {
            const length = getLength(code, 3) + 2;
            const h = (code >> 3) & 0x1;
            const d = dv.getUint16(srcOffs, true) >> 2;
            const s = dv.getUint16(srcOffs, true) & 0x3;
            srcOffs += 2;
            const distance = 16384 + (h << 14) + d;
            state = s;
            if (distance == 16384) {
                // End
                return dst.buffer;
            }
            let msrc = dstOffs - distance;
            for (let i = 0; i < length; i++) {
                dst[dstOffs++] = dst[msrc++];
            }
            for (let i = 0; i < s; i++) {
                dst[dstOffs++] = dv.getUint8(srcOffs++);
            }
        } else {
            if (state == 0) {
                const length = getLength(code, 4) + 3;
                state = 4;
                for (let i = 0; i < length; i++) {
                    dst[dstOffs++] = dv.getUint8(srcOffs++);
                }
            } else if (state >= 1 && state <= 3) {
                const s = code & 0x3;
                const d = (code >> 2) & 0x3;
                const length = 2;
                state = s;
                const h = dv.getUint8(srcOffs++);
                const distance = (h << 2) + d + 1;
                let msrc = dstOffs - distance;
                for (let i = 0; i < length; i++) {
                    dst[dstOffs++] = dst[msrc++];
                }
                for (let i = 0; i < s; i++) {
                    dst[dstOffs++] = dv.getUint8(srcOffs++);
                }
            } else if (state == 4) {
                const s = code & 0x3;
                state = s;
                const length = 3;
                const d = code >> 2;
                const h = dv.getUint8(srcOffs++);
                const distance = (h << 2) + d + 2049;
                let msrc = dstOffs - distance;
                for (let i = 0; i < length; i++) {
                    dst[dstOffs++] = dst[msrc++];
                }
                for (let i = 0; i < s; i++) {
                    dst[dstOffs++] = dv.getUint8(srcOffs++);
                }
            }
        }
    }

    return dst.buffer;
}

export function loadRes(data: ArrayBufferSlice): ArrayBufferSlice {
    const dv = data.createDataView();
    const magic = dv.getUint32(0);
    switch (magic) {
    case stringToFourCC('ZLB\0'):
        return new ArrayBufferSlice(loadZLB(data));
    case stringToFourCC('DIRn'): // FIXME: actually just "DIR" is checked
        return new ArrayBufferSlice(loadDIRn(data));
    case stringToFourCC('LZOn'):
        // LZO occurs in the demo only.
        return new ArrayBufferSlice(loadLZOn(data, 0));
    default:
        console.warn(`Invalid magic identifier 0x${hexzero(magic, 8)}`);
        return data;
    }
}

export function getSubdir(locationNum: number, gameInfo: GameInfo): string {
    if (gameInfo.subdirs[locationNum] === undefined) {
        throw Error(`Subdirectory for location ${locationNum} unknown`);
    }
    return gameInfo.subdirs[locationNum];
}
