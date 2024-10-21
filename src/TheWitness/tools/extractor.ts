
// The Witness is a special challenge, because the "raw" data file is >2GB, which breaks browsers.
// We need to prune it down to a lower file size.

// It also breaks Node's ability to readFileSync, so we need to handle it in a special way.

import CRC32 from 'crc-32';
import { assert } from "console";
import { closeSync, openSync, readFileSync, readSync, statSync, writeSync } from "fs";
import { hexzero, readString } from "../../util";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { makeZipFile, parseZipFile, ZipCompressionMethod } from "../../ZipFile";

const pathBaseIn  = `../../../data/TheWitness_raw`;
const pathBaseOut = `../../../data/TheWitness`;

export function hexdump(b_: ArrayBufferSlice | ArrayBuffer, offs: number = 0, length: number = 0x100): void {
    const buffer: ArrayBufferSlice = b_ instanceof ArrayBufferSlice ? b_ : new ArrayBufferSlice(b_);
    const groupSize_ = 16;
    let S = '';
    const arr = buffer.createTypedArray(Uint8Array, offs);
    length = Math.min(length, arr.byteLength);
    for (let i = 0; i < length; i += groupSize_) {
        let groupSize = Math.min(length - i, groupSize_);
        const addr = offs + i;
        S += `${hexzero(addr, 8)}    `;
        for (let j = 0; j < groupSize; j++) {
            const b = arr[i + j];
            S += ` ${hexzero(b, 2)}`;
        }
        for (let j = groupSize; j < groupSize_; j++)
            S += `   `;

        S += '  ';
        for (let j = 0; j < groupSize; j++) {
            const b = arr[i + j];
            const c = (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
            S += `${c}`;
        }
        for (let j = groupSize; j < groupSize_; j++)
            S += ` `;

        S += '\n';
    }
    console.log(S);
}

function includeFile(filename: string): boolean {
    if (filename.endsWith('.sound'))
        return false;

    if (filename.endsWith('.catraw'))
        return false;

    return true;
}

interface FileEntry {
    filename: string;
    localDirectoryOffset: number;
    cd: ArrayBufferSlice;
}

function main() {
    const fd = openSync(`${pathBaseIn}/data-pc.zip`, 'r');
    // First, read through the central directory.
    const trailBuffer = Buffer.alloc(0x16);
    const trail = new ArrayBufferSlice(trailBuffer.buffer);

    const stat = statSync(`${pathBaseIn}/data-pc.zip`);
    readSync(fd, trailBuffer, 0, 0x16, stat.size - 0x16);
    assert(readString(trail, 0x00, 0x04) === 'PK\x05\x06');

    const numFiles = trail.createDataView().getUint16(0x08, true);
    const cdOffs = trail.createDataView().getUint32(0x10, true);

    // Now go through each CD entry and accumulate
    const files: FileEntry[] = [];
    const fdOut = openSync(`${pathBaseOut}/data-pc.zip`, 'w');

    let cdIdx = cdOffs;
    let outOffs = 0;
    for (let i = 0; i < numFiles; i++) {
        const cdBuffer = Buffer.alloc(0x100);
        const cd = new ArrayBufferSlice(cdBuffer.buffer);
    
        readSync(fd, cdBuffer, 0, 0x100, cdIdx);
        assert(readString(cd, 0x00, 0x04) === 'PK\x01\x02');
        const cdView = cd.createDataView();

        const compressionMethod = cdView.getUint16(0x0A, true);
        const dataSize = cdView.getUint32(0x14, true);
        const uncompressedSize = cdView.getUint32(0x18, true);
        const filenameSize = cdView.getUint16(0x1C, true);
        const extraSize = cdView.getUint16(0x1E, true);
        const commentSize = cdView.getUint16(0x20, true);
        const localHeaderOffset = cdView.getUint32(0x2A, true);
        const filename = readString(cd, 0x2E, filenameSize);
        cdIdx += 0x2E + filenameSize + extraSize + commentSize;

        if (!includeFile(filename))
            continue;

        assert(compressionMethod === ZipCompressionMethod.None);
        assert(dataSize === uncompressedSize);

        const dataBuffer = Buffer.alloc(0x100 + uncompressedSize);
        const data = new ArrayBufferSlice(dataBuffer.buffer);
        const dataView = data.createDataView();

        readSync(fd, dataBuffer, 0, 0x100 + uncompressedSize, localHeaderOffset);
        assert(readString(data, 0x00, 0x04) === 'PK\x03\x04');

        const filenameSize2 = dataView.getUint16(0x1A, true);
        assert(filenameSize === filenameSize2);
        const extraSize2 = dataView.getUint16(0x1C, true);
        const dataStart = 0x1E + filenameSize + extraSize2;
        assert(dataStart <= 0x100);

        const totalSize = dataStart + dataSize;

        files.push({ filename, localDirectoryOffset: outOffs, cd });

        if (filename.endsWith('.pkg')) {
            // My hope is that every nested package can be parsed in a traditional way.
            let packageZip = parseZipFile(data.subarray(dataStart, dataSize));
            packageZip = packageZip.filter((e) => {
                return includeFile(e.filename);
            });
            const newData = makeZipFile(packageZip);
            const newSize = newData.byteLength;

            const crc32 = CRC32.buf(new Uint8Array(newData));

            // Patch LFH.
            dataView.setUint32(0x0E, crc32, true);
            dataView.setUint32(0x12, newSize, true);
            dataView.setUint32(0x16, newSize, true);

            // Patch CD.
            cdView.setUint32(0x10, crc32, true);
            cdView.setUint32(0x14, newSize, true);
            cdView.setUint32(0x18, newSize, true);

            writeSync(fdOut, dataBuffer, 0, dataStart, outOffs);
            outOffs += dataStart;

            writeSync(fdOut, Buffer.from(newData), 0, newSize, outOffs);
            outOffs += newSize;

            // hexdump(new ArrayBufferSlice(newData, 0x4a0000), 0, 0x1000);
            console.log(filename, (crc32 >>> 0).toString(16));
        } else {
            // Output as-is.
            writeSync(fdOut, dataBuffer, 0, totalSize, outOffs);
            outOffs += totalSize;
        }
    }

    // Now write the CD.
    const outOffsCD = outOffs;
    for (const file of files) {
        const cd = file.cd;
        cd.createDataView().setUint32(0x2A, file.localDirectoryOffset, true);
        const size = 0x2E + file.filename.length;
        writeSync(fdOut, Buffer.from(cd.arrayBuffer), 0, size, outOffs);
        outOffs += size;
    }

    // File trailer.
    function writeString(buf: ArrayBuffer, offs: number, v: string): void {
        const a = new Uint8Array(buf, offs);
        for (let i = 0; i < v.length; i++)
            a[i] = v.charCodeAt(i);
    }

    function makeCentralDirectoryEnd(numEntries: number, cdOffset: number, cdSize: number): ArrayBufferSlice {
        const buf = new ArrayBuffer(0x16);
        const view = new DataView(buf);

        writeString(buf, 0x00, 'PK\x05\x06');
        view.setUint16(0x08, numEntries, true);
        view.setUint16(0x0A, numEntries, true);
        view.setUint32(0x0C, cdSize, true);
        view.setUint32(0x10, cdOffset, true);

        return new ArrayBufferSlice(buf);
    }

    function writeSlice(fd: number, b: ArrayBufferSlice): void {
        writeSync(fd, Buffer.from(b.arrayBuffer, b.byteOffset, b.byteLength), 0, b.byteLength, outOffs);
        outOffs += b.byteLength;
    }

    const cdSize = outOffs - outOffsCD;
    writeSlice(fdOut, makeCentralDirectoryEnd(files.length, outOffsCD, cdSize));

    closeSync(fd);
    closeSync(fdOut);
}

main();
