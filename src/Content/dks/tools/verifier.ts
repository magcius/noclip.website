
import * as BYML from '../../../byml';
import { readFileSync } from 'fs';
import ArrayBufferSlice from '../../../ArrayBufferSlice';

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

function main(): void {
    const buffer = fetchDataSync(`../../../data/dks/m10_01_00_00_arc.crg1`);
    const byml = BYML.parse(buffer, BYML.FileType.CRG1);
    console.log(byml);
}

main();
