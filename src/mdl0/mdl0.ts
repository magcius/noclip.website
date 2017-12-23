
function assert(b: boolean) {
    if (!b) throw new Error("Assert fail");
}

function readString(buffer: ArrayBuffer, offs: number, length: number): string {
    const buf = new Uint8Array(buffer, offs, length);
    let S = '';
    for (let i = 0; i < length; i++)
        S += String.fromCharCode(buf[i]);
    return S;
}

export interface MDL0 {
    clrData: Uint8Array;
    idxData: Uint16Array;
    vtxData: Uint16Array;

    animCount: number;
    animSize: number;
    vertCount: number;
    vertSize: number;
}

export function parse(buffer: ArrayBuffer): MDL0 {
    const Flag = {
        HAS_NORMAL: 0x01,
        HAS_UV: 0x02,
        HAS_COLOR: 0x04,
    };

    const view = new DataView(buffer);
    assert(readString(buffer, 0, 4) === 'MDL\0');
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

    let clrData;
    if (flags & Flag.HAS_COLOR) {
        const start = offs;
        const end = start + vertCount * 4;
        clrData = new Uint8Array(buffer.slice(start, end));
        offs = end;
    } else {
        clrData = new Uint8Array(vertCount * 4);
    }

    // Read in index buffer.
    let idxCount = view.getUint16(offs, true);
    let idxData;
    {
        const start = offs + 0x02;
        const end = start + (idxCount * 0x02);
        const idxArr = new Uint16Array(buffer.slice(start, end));
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
        offs = end;
    }

    let vtxData;
    const vertSize = 4 * (3 + ((flags & Flag.HAS_NORMAL) ? 3 : 0));
    const animSize = vertCount * vertSize;
    {
        const start = offs;
        const end = start + animCount * animSize;
        vtxData = new Uint16Array(buffer.slice(start, end));
        offs = end;
    }
    assert(offs === buffer.byteLength);

    return { clrData, idxData, vtxData, animCount, animSize, vertCount, vertSize };
}
