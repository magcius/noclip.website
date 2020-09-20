
import ArrayBufferSlice from "../../ArrayBufferSlice";

// https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md

export function decompress(buffer: ArrayBufferSlice, uncompressedSize: number): ArrayBufferSlice {
    const dst = new Uint8Array(uncompressedSize);
    const src = buffer.createTypedArray(Uint8Array);

    let i = 0, o = 0;
    while (true) {
        const token = src[i++];

        let litlength = (token >>> 4) & 0x0F;
        if (litlength === 15) {
            while (true) {
                const b = src[i++];
                litlength += b;
                if (b < 255)
                    break;
            }
        }

        for (let j = 0; j < litlength; j++)
            dst[o++] = src[i++];

        const offsetL = src[i++];
        const offsetH = src[i++];
        const offset = (offsetH << 8) | (offsetL);

        let matchlength = (token & 0x0F);
        if (matchlength === 15) {
            while (true) {
                const b = src[i++];
                matchlength += b;
                if (b < 255)
                    break;
            }
        }
        matchlength += 4;

        let copyOffs = o - offset;
        while (matchlength--)
            dst[o++] = dst[copyOffs++];

        if (o >= uncompressedSize)
            break;
    }

    return new ArrayBufferSlice(dst.buffer);
}
