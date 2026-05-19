import { assert } from "../util";
import { DataViewExt } from "./DataViewExt";

/*
https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/compression.cpp#L65
*/

/*
uint8 magic[3];
uint32 compressedSize;
uint8 pad[9];
while( !eof ) {

    uint8 flag;
    
    if (flag == 0) {
        struct {
            uint8 literal_size;
            uint8 literal[literal_size];
        } big_literal;
    }
    
    else if (flag < 0x10) {
        struct {
            local int literal_size = flag + 3;
            uint8 literal[literal_size];
        } medium_literal;
    }
    
    else if (flag < 0x20) {
        struct {
            if (flag & 7) {
                uint8 match_size;
            }
            uint8 b0;
            uint8 b1;
            uint8 little_literal[b0 & 3];
            // something complicated happens here
        } far_match;
    }
    
    else if (flag < 0x40) {
        struct {
            if (flag & 7) {
                uint8 match_size;
            }
            uint8 b0;
            uint8 b1;
            uint8 little_literal[b0 & 3];
        } medium_match;
    }
    
    else {
        struct {
            uint8 b1;
            uint8 little_literal[flag & 3];
        } little_match;
    }
}

The max match size is 286
The max literal size is 273


*/

const BEGIN_PTR = 0x10;

/**
 * Decompresses WAD files from Ratchet & Clank.
 * This is not the same as the doom WAD format.
 */
export class WadDecompressor {
    private srcBuf: Uint8Array;
    private srcPtr: number;
    private destBuf: Uint8Array
    private destPtr: number;

    constructor(private srcView: DataViewExt) {
        this.srcBuf = new Uint8Array(srcView.buffer, srcView.byteOffset, srcView.byteLength);
        this.srcPtr = BEGIN_PTR;
        this.destBuf = new Uint8Array(0x10000);
        this.destPtr = 0;

        if (srcView.byteLength < BEGIN_PTR) {
            throw new Error("WAD file is too small");
        }

        const compressedSize = srcView.getUint32(0x3);
        if (compressedSize !== srcView.byteLength) {
            throw new Error(`Buffer size doesn't match file header (expected ${compressedSize}, actual ${srcView.byteLength})`)
        }

        if (srcView.getFixedLengthString(0, 3) !== "WAD") {
            throw new Error("Not a WAD file")
        }
    }

    public decompress() {
        while (this.srcPtr < this.srcBuf.byteLength) {
            this.resizeDest();
            this.nextPacket();
        }

        // ensure we output a real ArrayBuffer not a view
        const correctlySizedBuffer = new ArrayBuffer(this.destPtr);
        new Uint8Array(correctlySizedBuffer).set(this.destBuf.subarray(0, this.destPtr));
        return correctlySizedBuffer;
    }

    private resizeDest() {
        if (this.destPtr >= this.destBuf.length - 0x1000) {
            // resize if there's less than 4kb free
            // the most that can be written in one packet is a 262 byte match + 3 byte literal
            const newBuf = new Uint8Array(this.destBuf.byteLength * 2);
            newBuf.set(this.destBuf);
            this.destBuf = newBuf;
        }
    }

    private eof() {
        return this.srcPtr === this.srcBuf.byteLength;
    }

    private alignToNext4Kb() {
        while ((this.srcPtr - BEGIN_PTR) % 0x1000 !== 0) {
            this.srcPtr++;
        }
    }

    writeLiteral(bytes: number) {
        if (this.srcPtr + bytes > this.srcBuf.byteLength) {
            throw new Error("Out of bounds read in decompression")
        }
        this.destBuf.set(new Uint8Array(this.srcBuf.buffer, this.srcBuf.byteOffset + this.srcPtr, bytes), this.destPtr);
        this.srcPtr += bytes;
        this.destPtr += bytes;
    }

    writeMatch(lookbackPtr: number, bytes: number) {
        if (lookbackPtr < 0 || lookbackPtr >= this.destPtr) {
            throw new Error("Out of bounds read in decompression")
        }
        // this must be one byte at a time because matches can overlap
        for (let i = 0; i < bytes; i++) {
            this.destBuf[this.destPtr] = this.destBuf[lookbackPtr];
            lookbackPtr++;
            this.destPtr++;
        }
    }

    private nextPacket(): number {
        const flag = this.srcBuf[this.srcPtr++];

        if (flag < 0x10) {
            // medium or big literal
            let literalSize = 0;
            if (flag !== 0) {
                literalSize = flag + 3;
            } else {
                literalSize = this.srcBuf[this.srcPtr++] + 18;
            }

            this.writeLiteral(literalSize);

            if (!this.eof()) {
                // next flag must not be a literal
                if (this.srcBuf[this.srcPtr] < 0x10) {
                    throw new Error("Unexpected double literal")
                }
            }
        } else {
            let lookback = 0;
            let matchSize = 0;

            if (flag < 0x20) {
                // far match
                matchSize = flag & 7;
                if (matchSize === 0) {
                    matchSize = this.srcBuf[this.srcPtr++] + 7;
                }

                const b0 = this.srcBuf[this.srcPtr++];
                const b1 = this.srcBuf[this.srcPtr++]
                lookback = this.destPtr - ((flag & 8) * 0x800) - (b1 * 0x40) - (b0 >> 2);

                // not sure what this does
                if (lookback !== this.destPtr) {
                    matchSize += 2;
                    lookback -= 0x4000;
                } else if (matchSize !== 1) {
                    this.alignToNext4Kb();
                    return flag;
                }
            } else if (flag < 0x40) {
                // medium match
                matchSize = flag & 0x1f;
                if (matchSize == 0) {
                    matchSize = this.srcBuf[this.srcPtr++] + 0x1f;
                }
                matchSize += 2;

                const b1 = this.srcBuf[this.srcPtr++];
                const b2 = this.srcBuf[this.srcPtr++];
                lookback = this.destPtr - (b2 * 0x40) - (b1 >> 2) - 1;
            } else {
                // little match
                const b1 = this.srcBuf[this.srcPtr++];
                lookback = this.destPtr - (b1 * 8) - ((flag >> 2) & 7) - 1;
                matchSize = (flag >> 5) + 1;
            }

            if (matchSize !== 1) { // not sure why not if match size is 1
                // write match
                this.writeMatch(lookback, matchSize);
            }

            // little literal always follows match
            const littleLiteralSize = this.srcBuf[this.srcPtr - 2] & 3;
            this.writeLiteral(littleLiteralSize);
        }

        return flag;
    }
}
