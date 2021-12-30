#!/usr/bin/env ts-node-script

import { readFileSync } from 'fs';
import ArrayBufferSlice from '../ArrayBufferSlice';
import * as BYML from '../byml';

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(new Uint8Array(b).buffer);
}

function main(inFilename: string): void {
    const data = fetchDataSync(inFilename);
    const byml = BYML.parse(data, BYML.FileType.CRG1);
    console.log(JSON.stringify(byml, null, 2));
}

main(process.argv[2]);
