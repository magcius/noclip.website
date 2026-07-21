// Eighting decompression (is it made by them?, no idea if its used in any other games)
export function decompressBuffer(src: Uint8Array, compressedSize: number, uncompressedSize: number): Uint8Array {
    //not compressed
    if (compressedSize === uncompressedSize) {
        return src;
    }

    let srcOff = 0;
    let dstOff = 0;

    const dst = new Uint8Array(uncompressedSize);

    let flagByte = 0x8000;

    function readBit() {
        //read flag bit
        if (flagByte === 0x8000) {
            flagByte = (src[srcOff++] << 8) | 0x80;
        }
        const flagBit = (flagByte & 0x8000) > 0 ? 1 : 0;
        flagByte = (flagByte & 0x7fff) << 1;

        return flagBit;
    }

    //main loop
    while (true) {
        const flagBit = readBit();

        if (flagBit === 1) { //literal copy
            dst[dstOff++] = src[srcOff++];
        } else if (flagBit === 0) { //offset copy
            let byteCount = 0;
            let byteOffset = 0;

            const controlBit = readBit();

            if (controlBit === 0) { //short copy
                byteCount = readBit() * 2 + readBit() + 2;
                byteOffset = src[srcOff++] - 256;
            } else if (controlBit === 1) { //long copy
                const controlWord = (src[srcOff++] << 8) | src[srcOff++];
                byteOffset = (controlWord >> 3) - 0x2000;
                const count = (controlWord & 7);

                if (count === 0) {
                    byteCount = src[srcOff++] + 1;

                    if (byteCount === 1) { //end of stream
                        return dst;
                    }
                } else {
                    byteCount = count + 2;
                }
            }

            //do the copy
            for (let i = 0; i < byteCount; i++) {
                dst[dstOff + i] = dst[dstOff + byteOffset + i];
            }
            dstOff += byteCount;
        }
    }
}