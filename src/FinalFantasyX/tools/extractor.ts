
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { openSync, readSync, closeSync, writeFileSync, mkdirSync } from "fs";
import { hexzero } from "../../util";
import { assert } from "console";

function decompressFile(data: ArrayBufferSlice, format: number, length: number): ArrayBufferSlice {
    const out = new Uint8Array(length);
    const view = data.createDataView();

    const shift = format === 1 ? 11 : 12;
    const mask = (1 << shift) - 1;

    let readOffs = 0;
    let writeOffs = 0;
    while (true) {
        const value = view.getUint8(readOffs++);
        if (value === 0)
            break;
        if (value < 0x7E) {
            for (let i = 0; i < value; i++)
                out[writeOffs++] = view.getUint8(readOffs++);
        } else if (value === 0x7E) {
            const count = view.getUint8(readOffs++) + 4;
            const repeated = view.getUint8(readOffs++);
            for (let i = 0; i < count; i++)
                out[writeOffs++] = repeated;
        } else if (value === 0x7F) {
            const count = view.getUint16(readOffs, true);
            const repeated = view.getUint8(readOffs + 2);
            readOffs += 3;
            for (let i = 0; i < count; i++)
                out[writeOffs++] = repeated;
        } else {
            const windowInfo = view.getUint8(readOffs++) | ((value & 0x7F) << 8);
            const count = (windowInfo >>> shift) + 3;
            const offset = (windowInfo & mask) + 1;

            let copyReadOffs = writeOffs - offset;
            for (let i = 0; i < count; i++) {
                const prev = copyReadOffs < 0 ? 0 : out[copyReadOffs];
                out[writeOffs++] = prev;
                copyReadOffs++;
            }
        }
    }
    assert(writeOffs === length, `length mismatch ${hexzero(writeOffs, 8)} ${hexzero(length, 8)}`);
    return new ArrayBufferSlice(out.buffer as ArrayBuffer);
}


function fetchDataFragmentSync(path: string, byteOffset: number, byteLength: number): ArrayBufferSlice {
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(byteLength);
    readSync(fd, b, 0, byteLength, byteOffset);
    closeSync(fd);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

const pathBaseIn  = `../../../data/ffx_raw`;
const pathBaseOut = `../../../data/ffx`;

function writeBufferSync(path: string, buffer: ArrayBufferSlice): void {
    writeFileSync(path, Buffer.from(buffer.copyToBuffer()));
}

const sectorSize = 0x800;
const lsnMask = 0x003FFFFF;

function main() {
    const isoPath = `${pathBaseIn}/FFX.iso`;
    
    const lsnTable = fetchDataFragmentSync(isoPath, 0x118 * sectorSize, 0x10000);
    const lsnView = lsnTable.createDataView();
    const folderTable = fetchDataFragmentSync(isoPath, 0x158 * sectorSize, 0x82);
    const folderView = folderTable.createDataView();

    for (let folderIndex = 1; folderIndex < 0x40; folderIndex++) {
        const folderStart = folderView.getInt16(2*folderIndex, true);
        if (folderStart < 0)
            continue;
        let folderEnd = 0x3F0C;
        // folder indices aren't in order, I'm assuming they represent disjoint ranges
        for (let j = 1; j < 0x40; j++) {
            const otherStart = folderView.getInt16(2*j, true);
            if (otherStart > folderStart && otherStart < folderEnd)
                folderEnd = otherStart;
        }
        console.log(`extracting folder ${hexzero(folderIndex, 2)}: ${hexzero(folderStart, 4)} to ${hexzero(folderEnd, 4)}`);
        mkdirSync(`${pathBaseOut}/${hexzero(folderIndex, 2)}`, { recursive: true });

        for (let i = folderStart; i < folderEnd; i++) {
            const fileInfo = lsnView.getUint32(4 * i, true);
            if (fileInfo & 0x00800000)
                continue;
            const lsn = fileInfo & lsnMask;
            const extraDWs = fileInfo >>> 24;
            const nextLSN = lsnView.getUint32(4 * i + 4, true) & lsnMask;
            const length = (nextLSN - lsn) * sectorSize - extraDWs * 8;

            const fileData = fetchDataFragmentSync(isoPath, lsn * sectorSize, length);
            const filePath = `${pathBaseOut}/${hexzero(folderIndex, 2)}/${hexzero(i - folderStart, 4)}.bin`;
            if ((fileInfo & 0x00400000) === 0) {
                writeBufferSync(filePath, fileData);
            } else {
                const view = fileData.createDataView();
                const format = view.getUint8(0);
                const expectedLength = view.getUint32(1, true);
                if (format === 0) {
                    assert(nextLSN - lsn <= 0x3); // only small files
                    writeBufferSync(filePath, fileData.slice(5, 5 + expectedLength)); // no compression, just skip header
                } else {
                    assert(format === 1 || format === 2);
                    const finalData = decompressFile(fileData.slice(5), format, expectedLength);
                    writeBufferSync(filePath, finalData);
                }
            }
        }
    }
}

main();
