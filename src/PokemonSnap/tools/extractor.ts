
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { hexzero } from "../../util";
import * as BYML from "../../byml";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/PokemonSnap_Raw`;
const pathBaseOut = `../../../data/PokemonSnap`;

function extractMap(romData: ArrayBufferSlice, sceneID: number, photo: OverlaySpec, header = 0, objectStart = 0, collisionStart = 0) {
    const view = romData.createDataView(0x57580 + sceneID * 0x24);

    const romStart = view.getUint32(0x00);
    const romEnd = view.getUint32(0x04);
    const StartAddress = view.getUint32(0x08);

    const codeRomStart = view.getUint32(0x24);
    const codeRomEnd = view.getUint32(0x28);
    const CodeStartAddress = view.getUint32(0x2C);

    const particleStart = particleAddresses[(sceneID - 14) >>> 1];
    const particleEnd = particleAddresses[((sceneID - 14) >>> 1) + 1];

    const crg1 = {
        Name: sceneID,
        Data: romData.slice(romStart, romEnd),
        Code: romData.slice(codeRomStart, codeRomEnd),
        StartAddress,
        CodeStartAddress,
        Photo: romData.slice(photo.rom, photo.rom + photo.len),
        PhotoStartAddress: photo.ram,
        Header: header,
        Objects: objectStart,
        Collision: collisionStart,
        ParticleData: romData.slice(particleStart, particleEnd),
    };
    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${hexzero(sceneID, 2).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

function extractPokemon(romData: ArrayBufferSlice, name: string, data: OverlaySpec, code: OverlaySpec, photo: OverlaySpec): void {
    const crg1 = {
        Data: romData.slice(data.rom, data.rom + data.len),
        StartAddress: data.ram,
        Code: romData.slice(code.rom, code.rom + code.len),
        CodeStartAddress: code.ram,
        Photo: romData.slice(photo.rom, photo.rom + photo.len),
        PhotoStartAddress: photo.ram,
    };
    const pokeData = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${name}_arc.crg1`, Buffer.from(pokeData));
}

interface OverlaySpec {
    rom: number;
    ram: number;
    len: number;
}

const particleAddresses: number[] = [
    0xAB5860,
    0xAB85E0,
    0xABE7A0,
    0xAC6890,
    0xAC8510,
    0xACF6F0,
    0xAD0E00,
    0xADD310,
    0xADEC60,
];

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);

    extractMap(romData, 14, { rom: 0x5959C, ram: 0x800ADBEC, len: 83 * 0x14 }); // common data
    extractMap(romData, 16, { rom: 0x13C780, ram: 0x801B0310, len: 0x26530 }, 0x8011B914, 0x802CBEE4, 0x80318F00); // beach
    extractMap(romData, 18, { rom: 0x1D1D90, ram: 0x8018BC50, len: 0x240E0 }, 0x8011E6CC, 0x802EDFAC, 0x80326EE0); // tunnel
    extractMap(romData, 24, { rom: 0x3D0560, ram: 0x801A9900, len: 0x25E70 }, 0x800FFFB8, 0X802E0D44, 0x8031D4D0); // volcano
    extractMap(romData, 22, { rom: 0x30AF90, ram: 0x8019AEE0, len: 0x1BC80 }, 0x8012AC90, 0x802E271C, 0x80321560); // river
    extractMap(romData, 20, { rom: 0x27AB80, ram: 0x801AEDF0, len: 0x1F610 }, 0x8012A0E8, 0x802C6234, 0x80317610); // cave
    extractMap(romData, 26, { rom: 0x47CF30, ram: 0x80186B10, len: 0x2B230 }, 0x80100720, 0x802D282C, 0x8031F9C0); // valley
    extractMap(romData, 28, { rom: 0x4EC000, ram: 0x80139C50, len: 0x04610 }, 0x800F5DA0, 0x8034AB34); // rainbow cloud

    // pokemon shared across levels are loaded separately
    extractPokemon(romData, 'magikarp',
        { rom: 0x731B0, ram: 0x800F5D90, len: 0xA200 },
        { rom: 0x54B5D0, ram: 0x8034E130, len: 0x20D0 },
        { rom: 0x82F8E0, ram: 0x803B1F80, len: 0x3080 }
    );

    extractPokemon(romData, 'pikachu',
        { rom: 0x7D3B0, ram: 0x800FFF90, len: 0x1B0C0 },
        { rom: 0x54D6A0, ram: 0x803476A0, len: 0x6A90 },
        { rom: 0x832960, ram: 0x803AD580, len: 0x4A00 }
    );

    extractPokemon(romData, 'bulbasaur',
        { rom: 0x99F70, ram: 0x8011CB50, len: 0xD570 },
        { rom: 0x557050, ram: 0x8033F6C0, len: 0x50C0 },
        { rom: 0x83A1E0, ram: 0x803A71B0, len: 0x3550 },
    );

    extractPokemon(romData, 'zubat',
        { rom: 0x98470, ram: 0x8011B050, len: 0x1B00 },
        { rom: 0x554130, ram: 0x80344780, len: 0x2F20 },
        { rom: 0x837360, ram: 0x803AA700, len: 0x2E80 },
    );
}

main();
