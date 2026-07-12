
import { assert } from "../../util";

export enum VifCmd {
    NOP          = 0b0_0000000,
    STCYCL       = 0b0_0000001,
    OFFSET       = 0b0_0000010,
    BASE         = 0b0_0000011,
    ITOP         = 0b0_0000100,
    STMOD        = 0b0_0000101,
    MSKPATH3     = 0b0_0000110,
    MARK         = 0b0_0000111,
    FLUSHE       = 0b0_0010000,
    FLUSH        = 0b0_0010001,
    FLUSHA       = 0b0_0010011,
    MSCAL        = 0b0_0010100,
    MSCNT        = 0b0_0010111,
    MSCALF       = 0b0_0010101,
    STMASK       = 0b0_0100000,
    STROW        = 0b0_0110000,
    STCOL        = 0b0_0110001,
    MPG          = 0b0_1001010,
    DIRECT       = 0b0_1010000,
    DIRECTHL     = 0b0_1010001,

    UNPACK_MASK  = 0b0110_0000,
    UNPACK_PARAM = 0b0000_1111,
}

export enum VifUnpackVN {
    S  = 0x00,
    V2 = 0x01,
    V3 = 0x02,
    V4 = 0x03,
}

export enum VifUnpackVL {
    VL_32 = 0x00,
    VL_16 = 0x01,
    VL_8 = 0x02,
    VL_5 = 0x03,
}

export enum VifUnpackFormat {
    S_32  = (VifUnpackVN.S << 2 | VifUnpackVL.VL_32),
    S_16  = (VifUnpackVN.S << 2 | VifUnpackVL.VL_16),
    S_8   = (VifUnpackVN.S << 2 | VifUnpackVL.VL_8),
    V2_32 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_32),
    V2_16 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_16),
    V2_8  = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_8),
    V3_32 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_32),
    V3_16 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_16),
    V3_8  = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_8),
    V4_32 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_32),
    V4_16 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_16),
    V4_8  = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_8),
    V4_5  = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_5),
}

function getVifUnpackVNComponentCount(vn: VifUnpackVN): number {
    return vn + 1;
}

export function getVifUnpackFormatByteSize(format: number): number {
    const vn: VifUnpackVN = (format >>> 2) & 0x03;
    const vl: VifUnpackVL = (format >>> 0) & 0x03;
    const compCount = getVifUnpackVNComponentCount(vn);
    if (vl === VifUnpackVL.VL_8) {
        return 1 * compCount;
    } else if (vl === VifUnpackVL.VL_16) {
        return 2 * compCount;
    } else if (vl === VifUnpackVL.VL_32) {
        return 4 * compCount;
    } else if (vl === VifUnpackVL.VL_5) {
        // V4-5. Special case: 16 bits for the whole format.
        assert(vn === 0x03);
        return 2;
    } else {
        throw new Error("whoops");
    }
}
