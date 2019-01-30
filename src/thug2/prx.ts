
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, align } from "../util";

export interface PRXFile {
    name: string;
    data: ArrayBufferSlice;
}

export interface PRX {
    files: PRXFile[];
}

// LZSS with matchlen=18, same as Majora Mask 3D's LzS. I wonder if this was published anywhere.
function decompressLZSS(buffer: ArrayBufferSlice, uncompressedSize: number): ArrayBufferSlice {
    const dstBuffer = new Uint8Array(uncompressedSize);

    let dstOffs = 0;
    let srcOffs = 0;

    const srcView = buffer.createDataView();
    const tempBuffer = new Uint8Array(4096);
    let tempBufferWP = 0xFEE;

    while (true) {
        const commandByte = srcView.getUint8(srcOffs++);
        for (let i = 0; i < 8; i++) {
            if (commandByte & (1 << i)) {
                // Literal.
                uncompressedSize--;
                tempBuffer[tempBufferWP++] = dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
                tempBufferWP %= 4096;
            } else {
                const b0 = srcView.getUint8(srcOffs++);
                const b1 = srcView.getUint8(srcOffs++);

                let tempBufferRP = b0 | ((b1 & 0xF0) << 4);
                let copyLength = (b1 & 0x0F) + 3;

                uncompressedSize -= copyLength;
                while (copyLength--) {
                    tempBuffer[tempBufferWP++] = dstBuffer[dstOffs++] = tempBuffer[tempBufferRP++];
                    tempBufferWP %= 4096;
                    tempBufferRP %= 4096;
                }
            }

            if (uncompressedSize <= 0)
                return new ArrayBufferSlice(dstBuffer.buffer);
        }
    }
}

export function parse(buffer: ArrayBufferSlice): PRX {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00, true);
    const version = view.getUint32(0x04, true);
    assert(version === 0xABCD0003);
    const numFiles = view.getUint32(0x08, true);

    let fileTableIdx = 0x0C;
    const files: PRXFile[] = [];
    for (let i = 0; i < numFiles; i++) {
        const decompressedDataSize = view.getUint32(fileTableIdx + 0x00, true);
        const compressedDataSize = view.getUint32(fileTableIdx + 0x04, true);
        const fileNameSize = view.getUint32(fileTableIdx + 0x08, true);
        const fileNameCRC = view.getUint32(fileTableIdx + 0x0C, true);
        const fileName = readString(buffer, fileTableIdx + 0x10, fileNameSize, true);

        fileTableIdx += 0x10;
        fileTableIdx += fileNameSize;
        assert((fileTableIdx & 0x03) === 0);

        let decompressedData: ArrayBufferSlice;
        if (compressedDataSize !== 0) {
            const compressedData = buffer.subarray(fileTableIdx, compressedDataSize);
            decompressedData = decompressLZSS(compressedData, decompressedDataSize);
            fileTableIdx += align(compressedDataSize, 0x04);
        } else {
            decompressedData = buffer.subarray(fileTableIdx, decompressedDataSize);
            fileTableIdx += align(decompressedDataSize, 0x04);
        }

        files.push({ name: fileName, data: decompressedData, });
    }

    return { files };
}
