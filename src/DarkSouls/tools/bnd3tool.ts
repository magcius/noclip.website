#!/usr/bin/env tsx

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import * as BND3 from "../bnd3.js";
import { readFileSync, writeFileSync } from "fs";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer);
}

function main() {
    const filename = process.argv[2];
    const data = fetchDataSync(filename);
    const bnd3 = BND3.parse(data);

    for (let i = 0; i < bnd3.files.length; i++) {
        const file = bnd3.files[i];
        console.log(file.name);
        writeFileSync(file.name, Buffer.from(file.data.copyToBuffer()));
    }
}

main();
