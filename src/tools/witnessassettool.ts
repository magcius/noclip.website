#!/usr/bin/env ts-node-script

import { readFileSync, writeFileSync } from "fs";
import ArrayBufferSlice from "../ArrayBufferSlice";
import * as LZ4 from "../Common/Compression/LZ4";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer, b.byteOffset, b.byteLength);
}

function main() {
    const filename = process.argv[2];
    const data = fetchDataSync(filename);
    const view = data.createDataView();
    const uncompressedSize = view.getUint32(0x08, true);
    const uncompressed = LZ4.decompress(data.slice(0x0C), uncompressedSize);
    console.log(uncompressedSize.toString(16));
    writeFileSync(`${filename}.dec`, Buffer.from(uncompressed.arrayBuffer, 0, uncompressedSize));
}

main();
