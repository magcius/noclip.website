
export const enum Endianness {
    LITTLE_ENDIAN,
    BIG_ENDIAN,
}

const test: Uint16Array = new Uint16Array([0xFEFF]);
const testView: DataView = new DataView(test.buffer);
const systemEndianness: Endianness = (testView.getUint8(0) == 0xFF) ? Endianness.LITTLE_ENDIAN : Endianness.BIG_ENDIAN;

export function getSystemEndianness(): Endianness {
    return systemEndianness;
}
