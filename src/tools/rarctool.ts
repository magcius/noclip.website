#!/usr/bin/env ts-node-script

import { readFileSync, writeFileSync, mkdirSync } from 'fs';

import ArrayBufferSlice from '../ArrayBufferSlice';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import * as Yaz0 from '../WindWaker/tools/Yaz0_NoWASM';
import { readString } from '../util';

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(new Uint8Array(b).buffer as ArrayBuffer);
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
        data = Yaz0.decompress(data);
    const rarc = RARC.parse(data);
    extractDir(rarc.root, `${inFilename}.d`);
}

main(process.argv[2]);
