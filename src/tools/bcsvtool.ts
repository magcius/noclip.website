#!/usr/bin/env ts-node-script

import { readFileSync, writeFileSync } from 'fs';

import ArrayBufferSlice from '../ArrayBufferSlice';
import * as BCSV from '../luigis_mansion/bcsv';
import { assert } from 'console';
import { inflate } from 'zlib';

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(new Uint8Array(b).buffer as ArrayBuffer);
}

class CSVWriter {
    private buffer: string = '';

    constructor(public headers: string[]) {
        this.writeRow(headers);
    }

    public writeRow(fields: string[]): void {
        assert(fields.length === this.headers.length);

        for (let i = 0; i < fields.length; i++) {
            this.buffer += this.escapeField(fields[i]);
            if (i !== fields.length - 1)
                this.buffer += ',';
        }

        this.buffer += '\n';
    }

    private escapeField(value: string): string {
        if (value.includes(','))
            value = `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}`;
        return value;
    }

    public finalize(): string {
        return this.buffer;
    }
}

function csv(bcsv: BCSV.Bcsv): string {
    const writer = new CSVWriter(bcsv.fields.map((field) => field.debugName));
    for (let i = 0; i < bcsv.records.length; i++)
        writer.writeRow(bcsv.records[i].map((value) => '' + value));
    return writer.finalize();
}

function main(inFilename: string, outFilename?: string): void {
    const data = fetchDataSync(inFilename);
    const bcsv = BCSV.parse(data);
    const buf = csv(bcsv);

    if (outFilename) {
        console.log(inFilename);
        writeFileSync(outFilename, buf);
    } else {
        console.log(buf);
    }
}

/*
for (let i = 2; i < process.argv.length; i++)
    main(process.argv[i], `${process.argv[i]}.csv`);
*/

main(process.argv[2], process.argv[3]);
