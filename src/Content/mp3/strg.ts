
// Implements Retro's STRG (string table resource group) format as seen in Metroid Prime 1.

import { ResourceSystem } from "./resource";
import { assert, readString } from "../../util";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { InputStream } from "./stream";

export interface STRG {
    strings: string[];
    nameTable: Map<string, number> | null;
}

const utf16Decoder = new TextDecoder('utf-16be')!;

function readUTF16String(buffer: ArrayBufferSlice, offs: number): string {
    const arr = buffer.createTypedArray(Uint8Array, offs, 0xFF);
    const raw = utf16Decoder.decode(arr);
    const nul = raw.indexOf('\u0000');
    let str: string;
    if (nul >= 0)
        str = raw.slice(0, nul);
    else
        str = raw;
    return str;
}

function readNameTable(stream: InputStream) : Map<string, number> {
    const nameTableCount = stream.readUint32();
    const nameTableSize = stream.readUint32();
    const nameTableOffs = stream.tell();
    stream.skip(nameTableSize);

    const view = stream.getBuffer().createDataView(nameTableOffs, nameTableSize);
    let nameTable = new Map<string, number>();

    for (let i = 0; i < nameTableCount; i++) {
        const entryOffset = i*8;
        const offset = view.getUint32(entryOffset+0);
        const index = view.getUint32(entryOffset+4);
        const name = readString(stream.getBuffer(), view.byteOffset + offset);
        nameTable.set(name, index);
    }

    return nameTable;
}

function parse_MP1(stream: InputStream): STRG {
    assert(stream.readUint32() === 0x87654321);
    const version = stream.readUint32();
    const languageCount = stream.readUint32();
    const stringCount = stream.readUint32();

    // Language table
    let languageTable = new Map<string, number>();
    for (let i = 0; i < languageCount; i++) {
        const languageID = stream.readFourCC();
        const languageOffset = stream.readUint32();
        languageTable.set(languageID, languageOffset);
        if (version === 0x1) stream.skip(4);
    }

    // Name table
    let nameTable: Map<string, number> | null = null;
    if (version === 0x1) {
        readNameTable(stream);
    }

    const strings: string[] = [];

    // Load English for now because I am a dirty American.
    if (languageTable.has('ENGL')) {
        // Language offsets are relative to the start of the string table, which is where we are, so we can just skip from here
        const englishOffs = languageTable.get('ENGL')!;
        stream.skip(englishOffs);

        if (version === 0x00) {
            stream.skip(4);
        }
        const stringDataOffs = stream.tell();

        for (let i = 0; i < stringCount; i++) {
            const stringOffs = stringDataOffs + stream.readUint32();
            const string = readUTF16String(stream.getBuffer(), stringOffs);
            strings.push(string);
        }
    }

    return { strings, nameTable };
}

const utf8Decoder = new TextDecoder('utf8')!;

function parse_MP3(stream: InputStream): STRG {
    assert(stream.readUint32() === 0x87654321);
    assert(stream.readUint32() === 0x3);
    const languageCount = stream.readUint32();
    const stringCount = stream.readUint32();
    const nameTable = readNameTable(stream);

    const languageIDTableOffs = stream.tell();
    const languageInfoOffs = languageIDTableOffs + 4*languageCount;
    const languageInfoSize = 4 + (4*stringCount);
    const stringDataOffs = languageInfoOffs + languageCount * languageInfoSize;
    
    const strings: string[] = [];
    const view = stream.getBuffer().createDataView();

    for (let i = 0; i < languageCount; i++) {
        const languageID = stream.readFourCC();

        // Load English for now because I am a dirty American.
        if (languageID === 'ENGL') {
            stream.goTo(languageInfoOffs + languageInfoSize*i);
            stream.skip(4);

            for (let j = 0; j < stringCount; j++) {
                const stringOffs = stringDataOffs + stream.readUint32();
                const stringSize = view.getUint32(stringOffs);
                const string = utf8Decoder.decode(stream.getBuffer().createTypedArray(Uint8Array, stringOffs + 4, stringSize-1));
                strings.push(string);
            }

            break;
        }
    }

    return { strings, nameTable };
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): STRG {
    assert(stream.readUint32() == 0x87654321);
    const version = stream.readUint32();
    stream.skip(-8);

    if (version === 0x00 || version == 0x01)
        return parse_MP1(stream);

    if (version === 0x03)
        return parse_MP3(stream);

    throw new Error(`Unrecognized STRG version: ${version}`);
}
