
import { readFileSync, writeFileSync } from "fs";
import ArrayBufferSlice from "../ArrayBufferSlice";
import * as Yay0 from "../Common/Compression/Yay0";
import { StringDecoder } from 'string_decoder'
import { hexdump } from "../util";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

function main() {
    const filename = process.argv[2];
    const data = fetchDataSync(filename);
    const g = new StringDecoder('ascii').write(Buffer.from(data.arrayBuffer));

    let idx = g.indexOf('Yay0'), i = 0;
    while (true) {
        const nextIdx = g.indexOf('Yay0', idx + 1);

        console.log(i, idx, nextIdx);
        const slice = data.slice(idx, nextIdx < 0 ? 0 : nextIdx);
        const buf = Yay0.decompress(slice);
        if (nextIdx < 0)
            break;

        writeFileSync(`${filename}.Chunk${i++}.bin`, Buffer.from(buf.arrayBuffer));
        idx = nextIdx;
    }
}

main();
