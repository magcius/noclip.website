
import { assert, readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';

export interface MDL0 {
    clrData: Uint8Array;
    idxData: Uint16Array;
    vtxData: Float32Array;

    animCount: number;
    animSize: number;
    vertCount: number;
    vertSize: number;
}

export function parse(buffer: ArrayBufferSlice): MDL0 {
    const enum Flag {
        HAS_NORMAL = 0x01,
        HAS_UV = 0x02,
        HAS_COLOR = 0x04,
    };

    const view = buffer.createDataView();
    assert(readString(buffer, 0, 4, false) === 'MDL\0');
    const flags = view.getUint8(0x04);
    const primType = view.getUint8(0x05);
    const vertCount = view.getUint16(0x06, true);
    const animCount = view.getUint16(0x08, true);

    let offs = 0x0A;

    if (flags & Flag.HAS_UV) {
        // XXX: How to parse UV?
        const start = offs;
        const end = start + vertCount * 8;
        offs = end;
    }

    let clrData: Uint8Array;
    if (flags & Flag.HAS_COLOR) {
        clrData = buffer.createTypedArrayCopy(Uint8Array, offs, vertCount * 4);
        offs += clrData.byteLength;
    } else {
        clrData = new Uint8Array(vertCount * 4);
    }

    // Read in index buffer.
    let idxCount = view.getUint16(offs, true);
    offs += 0x02;
    let idxData;
    {
        const idxArr = buffer.createTypedArrayCopy(Uint16Array, offs, idxCount);
        if (primType === 3) {
            idxData = idxArr;
        } else if (primType === 4) {
            idxCount = (idxCount / 4 * 6);
            idxData = new Uint16Array(idxCount);
            for (let i = 0, j = 0; i < idxCount; i += 6) {
                idxData[i + 0] = idxArr[j + 0];
                idxData[i + 1] = idxArr[j + 1];
                idxData[i + 2] = idxArr[j + 2];
                idxData[i + 3] = idxArr[j + 2];
                idxData[i + 4] = idxArr[j + 3];
                idxData[i + 5] = idxArr[j + 0];
                j += 4;
            }
        }
        offs += idxArr.byteLength;
    }

    let vtxData: Float32Array;
    const vertSize = 4 * (3 + ((flags & Flag.HAS_NORMAL) ? 3 : 0));
    const animSize = vertCount * vertSize;
    {
        vtxData = buffer.createTypedArrayCopy(Float32Array, offs, (animCount * animSize) / 4);
        offs += vtxData.byteLength;
    }
    assert(offs === buffer.byteLength);

    return { clrData, idxData, vtxData, animCount, animSize, vertCount, vertSize };
}
