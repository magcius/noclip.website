#!/usr/bin/env ts-node-script

import { readFileSync, writeFileSync, mkdirSync } from 'fs';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import * as RARC from '../Common/JSYSTEM/JKRArchive.js';
import * as Yaz0 from '../Common/Compression/Yaz0.js';
import { readString } from '../util.js';

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(new Uint8Array(b).buffer);
}

function extractFile(file: RARC.RARCFile, parentPath: string): void {
    writeFileSync(`${parentPath}/${file.name}`, Buffer.from(file.buffer.copyToBuffer()));
}

function extractDir(dir: RARC.RARCDir, parentPath: string): void {
    const path = `${parentPath}/${dir.name}`;
    mkdirSync(path, { recursive: true });

    for (let i = 0; i < dir.subdirs.length; i++)
        extractDir(dir.subdirs[i], path);
    for (let i = 0; i < dir.files.length; i++)
        extractFile(dir.files[i], path);
}

function main(inFilename: string): void {
    let data = fetchDataSync(inFilename);
    if (readString(data, 0x00, 0x04) === 'Yaz0')
        data = Yaz0.decompressSW(data);
    const rarc = RARC.parse(data);
    extractDir(rarc.root, `${inFilename}.d`);
}

main(process.argv[2]);
