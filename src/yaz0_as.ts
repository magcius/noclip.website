
// AssemblyScript version of Yaz0.

function get(offs: u32): u8 {
    return load<u8>(offs);
}

function set(offs: u32, b: u8): void {
    store<u8>(offs, b);
}

function get16be(offs: u32): u16 {
    return (load<u8>(offs) << 8) | load<u8>(offs + 1);
}

export function decompress(pDst: u32, pSrc: u32, dstSize: u32): void {
    let srcOffs: u32 = pSrc;
    let dstOffs: u32 = pDst;

    while (true) {
        const commandByte: u8 = get(srcOffs++);
        let i: u8 = 8;
        while (i--) {
            if (commandByte & (1 << i)) {
                // Literal.
                dstSize--;
                set(dstOffs++, get(srcOffs++));
            } else {
                const tmp: u16 = get16be(srcOffs);
                srcOffs += 2;

                const windowOffset: u16 = (tmp & 0x0FFF) + 1;
                let windowLength: u8 = (tmp >> 12) + 2;
                if (windowLength == 2) {
                    windowLength += get(srcOffs++) + 0x10;
                }

                let copyOffs: u32 = dstOffs - windowOffset;

                dstSize -= windowLength;
                while (windowLength--)
                    set(dstOffs++, get(copyOffs++));
            }

            if (dstSize <= 0)
                return;
        }
    }
}
