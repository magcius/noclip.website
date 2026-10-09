// global normal table. Extracted from main.dol, encoded into base64

//#region Normal Table

const NORMAL_TABLE_BASE64 =
    "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";

export const NORMAL_COUNT = 243;

function decodeNormalTable(): Float32Array {
    const bin = atob(NORMAL_TABLE_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        bytes[i] = bin.charCodeAt(i);
    const decoded = new Float32Array(bytes.buffer);
    const out = new Float32Array(NORMAL_COUNT * 3); // last entry 242 stays (0, 0, 0)
    out.set(decoded);
    return out;
}

export const NORMAL_TABLE: Float32Array = decodeNormalTable();

//#endregion

//#region Lookup

export function getNormal(dst: number[] | Float32Array, index: number): void {
    const i = (index >= 0 && index < NORMAL_COUNT) ? index : 0;
    dst[0] = NORMAL_TABLE[i * 3 + 0];
    dst[1] = NORMAL_TABLE[i * 3 + 1];
    dst[2] = NORMAL_TABLE[i * 3 + 2];
}

//#endregion
