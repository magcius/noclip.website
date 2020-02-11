
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, nArray, hexdump } from "../../util";
import * as BYML from "../../byml";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/PokemonSnap_Raw`;
const pathBaseOut = `../../../data/PokemonSnap`;

function extractMap(romData: ArrayBufferSlice, sceneID: number, roomStart = 0, objectStart = 0, collisionStart = 0) {
    const view = romData.createDataView(0x57580 + sceneID * 0x24);

    const romStart = view.getUint32(0x00);
    const romEnd = view.getUint32(0x04);
    const StartAddress = view.getUint32(0x08);

    const codeRomStart = view.getUint32(0x24);
    const codeRomEnd = view.getUint32(0x28);
    const CodeStartAddress = view.getUint32(0x2C);

    const crg1 = {
        Name: sceneID,
        Data: romData.slice(romStart, romEnd),
        Code: romData.slice(codeRomStart, codeRomEnd),
        StartAddress,
        CodeStartAddress,
        Rooms: roomStart,
        Objects: objectStart,
        Collision: collisionStart,
    };
    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${hexzero(sceneID, 2).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

function extractPokemon(romData: ArrayBufferSlice, name: string, data: OverlaySpec, code: OverlaySpec): void {
    const crg1 = {
        Data: romData.slice(data.rom, data.rom + data.len),
        StartAddress: data.ram,
        Code: romData.slice(code.rom, code.rom + code.len),
        CodeStartAddress: code.ram,
    };
    const pokeData = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${name}_arc.crg1`, Buffer.from(pokeData));
}

interface OverlaySpec {
    rom: number;
    ram: number;
    len: number;
}

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);

    extractMap(romData, 14); // common data
    extractMap(romData, 16, 0X80135DBC, 0x802CBEE4, 0x80318F00); // beach
    extractMap(romData, 18, 0X8012FE80, 0x802EDFAC, 0x80326EE0); // tunnel
    extractMap(romData, 24, 0X80113624, 0X802E0D44, 0x8031D4D0); // volcano
    extractMap(romData, 22, 0x80143AE8, 0x802E271C, 0x80321560); // river
    extractMap(romData, 20, 0x80141500, 0x802C6234, 0x80317610); // cave
    extractMap(romData, 26, 0x8011850C, 0x802D282C, 0x8031F9C0); // valley
    extractMap(romData, 28, 0x80116A50, 0x8034AB34); // rainbow cloud

    // pokemon shared across levels are loaded separately
    extractPokemon(romData, 'magikarp',
        { rom: 0x731B0, ram: 0x800F5D90, len: 0xA200 },
        { rom: 0x54B5D0, ram: 0x8034E130, len: 0x20D0 }
    );

    extractPokemon(romData, 'pikachu',
        { rom: 0x7D3B0, ram: 0x800FFF90, len: 0x1B0C0 },
        { rom: 0x54D6A0, ram: 0x803476A0, len: 0x6A90 }
    );

    extractPokemon(romData, 'bulbasaur',
        { rom: 0x99F70, ram: 0x8011CB50, len: 0xD570 },
        { rom: 0x557050, ram: 0x8033F6C0, len: 0x50C0 }
    );

    extractPokemon(romData, 'zubat',
        { rom: 0x98470, ram: 0x8011B050, len: 0x1B00 },
        { rom: 0x554130, ram: 0x80344780, len: 0x2F20 }
    );
}

main();
