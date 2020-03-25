import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, nArray, hexdump } from "../../util";
import * as Pako from 'pako';
import * as BYML from "../../byml";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/DonkeyKong64_Raw`;
const pathBaseOut = `../../../data/DonkeyKong64`;

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const view = buffer.createDataView();

    //TODO: insert check to ensure compressed
    //assert(view.getUint32(0x00) === 0x1172, `bad bytes ${view.getUint32(0).toString(16)} from ${buffer.byteOffset.toString(16)}`);
    
    let srcOffs = 0x0;
    while (view.getUint8(srcOffs) != 0x0) {
        srcOffs++;
    }
    srcOffs++;


    const decompressed = Pako.inflateRaw(buffer.createTypedArray(Uint8Array, srcOffs), { raw: true });
    return new ArrayBufferSlice(decompressed.buffer as ArrayBuffer);
}