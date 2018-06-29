
// AssemblyScript version of Yaz0.

@inline
function get(offs: u32): u8 {
    return load<u8>(offs);
}

@inline
function set(offs: u32, b: u8): void {
    store<u8>(offs, b);
}

@inline
function get16be(offs: u32): u16 {
    return (load<u8>(offs) << 8) | load<u8>(offs + 1);
}

export function decompress(pDst: u32, pSrc: u32, dstSize: i32): void {
    let dstOffs: u32 = pDst;
    let srcOffs: u32 = pSrc;

    while (true) {
        let commandByte: u8 = get(srcOffs++);
        let i: u8 = 8;
        while (i--) {
            if (commandByte & (1 << i)) {
                // Literal.
                dstSize--;
                set(dstOffs++, get(srcOffs++));
            } else {
                let tmp: u16 = get16be(srcOffs);

                srcOffs += 2;

                let windowOffset: u16 = (tmp & 0x0FFF) + 1;
                let windowLength: u16 = ((tmp >> 12) + 2) & 0xFF;

                if (windowLength == 2) {
                    // AssemblyScript seems to need a bit of coercing to not wrap this into a u8.
                    let tmp2: u16 = get(srcOffs++);
                    windowLength += tmp2 + 0x10;
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
