
// Implements Retro's STRG (string table resource group) format as seen in Metroid Prime 1.

import { ResourceSystem } from "./resource";
import { assert, readString, makeTextDecoder } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";

export interface STRG {
    strings: string[];
    nameTable: Map<string, number> | null;
}

const utf16Decoder = makeTextDecoder('utf-16be');

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

function parse_MP1(buffer: ArrayBufferSlice): STRG {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0x87654321);
    const version = view.getUint32(0x04);
    const hasNameTable = (version === 0x01);

    const languageCount = view.getUint32(0x08);
    const stringCount = view.getUint32(0x0C);

    const languageTableOffs = 0x10;

    let stringsTableOffs: number;
    let nameTable: Map<string, number> | null;
    if (hasNameTable) {
        const nameTableOffs = languageTableOffs + languageCount * 0x08;
        const nameTableCount = view.getUint32(nameTableOffs + 0x00);
        const nameTableSize = view.getUint32(nameTableOffs + 0x04);

        nameTable = new Map<string, number>();

        const nameTableEntriesOffs = nameTableOffs + 0x08;
        let nameTableEntriesIdx = nameTableEntriesOffs;
        for (let i = 0; i < nameTableCount; i++) {
            const nameOffset = view.getUint32(nameTableEntriesIdx + 0x00);
            const stringIndex = view.getUint32(nameTableEntriesIdx + 0x04);
            const name = readString(buffer, nameTableEntriesOffs + nameOffset, 0xFF, true);
            nameTable.set(name, stringIndex);
            nameTableEntriesIdx += 0x08;
        }

        stringsTableOffs = nameTableEntriesIdx;
    } else {
        stringsTableOffs = languageTableOffs + languageCount * 0x08;
        nameTable = null;
    }

    let languageTableIdx = languageTableOffs;
    const strings: string[] = [];

    for (let i = 0; i < languageCount; i++) {
        const languageID = readString(buffer, languageTableIdx + 0x00, 4, false);
        const languageStringsOffs = view.getUint32(languageTableIdx + 0x04);
        languageTableIdx += 0x08;

        // Load English for now because I am a dirty American.
        if (languageID === 'ENGL') {
            let stringTableIdx = stringsTableOffs + languageStringsOffs;

            const stringTableSize = view.getUint32(stringTableIdx + 0x00);
            stringTableIdx += 0x04;
            const stringTableDataOffs = stringTableIdx;

            for (let j = 0; j < stringCount; j++) {
                const stringOffs = view.getUint32(stringTableIdx);
                const string = readUTF16String(buffer, stringTableDataOffs + stringOffs);
                strings.push(string);
                stringTableIdx += 0x04;
            }
        }
    }

    return { strings, nameTable };
}

const utf8Decoder = makeTextDecoder('utf8');

function parse_DKCR(buffer: ArrayBufferSlice): STRG {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0x87654321);
    const version = view.getUint32(0x04);
    assert(version === 0x03);

    const languageCount = view.getUint32(0x08);
    const stringCount = view.getUint32(0x0C);

    const nameTableOffs = 0x10;
    const nameTableCount = view.getUint32(nameTableOffs + 0x00);
    const nameTableSize = view.getUint32(nameTableOffs + 0x04);

    const nameTable = new Map<string, number>();

    const nameTableEntriesOffs = nameTableOffs + 0x08;
    let nameTableEntriesIdx = nameTableEntriesOffs;
    for (let i = 0; i < nameTableCount; i++) {
        const nameOffset = view.getUint32(nameTableEntriesIdx + 0x00);
        const stringIndex = view.getUint32(nameTableEntriesIdx + 0x04);
        const name = readString(buffer, nameTableEntriesOffs + nameOffset, 0xFF, true);
        nameTable.set(name, stringIndex);
        nameTableEntriesIdx += 0x08;
    }

    let languageIDTableIdx = nameTableEntriesIdx;
    let languageTableIdx = languageIDTableIdx + 0x04 * languageCount;
    const stringsTableDataOffs = languageTableIdx + (0x04 + 0x04 * stringCount) * languageCount;

    const strings: string[] = [];
    for (let i = 0; i < languageCount; i++) {
        const languageID = readString(buffer, languageIDTableIdx + 0x00, 0x04, false);
        languageIDTableIdx += 0x04;

        const stringsSize = view.getUint32(languageTableIdx + 0x00);
        languageTableIdx += 0x04;

        // Load English for now because I am a dirty American.
        if (languageID === 'ENGL') {
            for (let i = 0; i < stringCount; i++) {
                const stringOffs = stringsTableDataOffs + view.getUint32(languageTableIdx + 0x00);
                const stringSize = view.getUint32(stringOffs + 0x00);
                const string = utf8Decoder.decode(buffer.createTypedArray(Uint8Array, stringOffs + 0x04, stringSize - 1));
                strings.push(string);
                languageTableIdx += 0x04;
            }
        } else {
            // Skip over strings.
            languageTableIdx += 0x04 * stringCount;
        }
    }

    return { strings, nameTable };
}

export function parse(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): STRG {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0x87654321);
    const version = view.getUint32(0x04);

    if (version === 0x00)
        return parse_MP1(buffer);

    if (version === 0x03)
        return parse_DKCR(buffer);

    throw "whoops";
}
