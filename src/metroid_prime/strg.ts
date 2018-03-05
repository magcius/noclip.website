
// Implements Retro's STRG (string table resource group) format as seen in Metroid Prime 1.

import { ResourceSystem } from "./resource";
import { assert, readString } from "../util";

interface STRG {
    strings: string[];
}

const utf16Decoder = new TextDecoder('utf-16be');

function readUTF16String(buffer: ArrayBuffer, offs: number) {
    const arr = new Uint8Array(buffer, offs, 0xFF);
    const raw = utf16Decoder.decode(arr);
    const nul = raw.indexOf('\u0000');
    let str;
    if (nul >= 0)
        str = raw.slice(0, nul);
    else
        str = raw;
    return str;
}

export function parse(resourceSystem: ResourceSystem, buffer: ArrayBuffer): STRG {
    const view = new DataView(buffer);

    assert(view.getUint32(0x00) === 0x87654321);
    const version = view.getUint32(0x04);
    assert(version === 0x00); // Metroid Prime 1

    const languageCount = view.getUint32(0x08);
    const stringCount = view.getUint32(0x0C);

    const languageTableOffs = 0x10;
    const stringsTableOffs = languageTableOffs + languageCount * 0x08;

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

    return { strings };
}
