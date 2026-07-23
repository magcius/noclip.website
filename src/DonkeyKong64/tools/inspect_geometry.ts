import { readFileSync } from 'fs';
import { inflateRawSync } from 'zlib';

const pointerTableOffset = 0x101C50;
const mapTableOffset = 0x15232C;

function parseNumber(s: string): number {
    if (s.startsWith('0x'))
        return Number.parseInt(s.slice(2), 16);
    return Number.parseInt(s, 16);
}

function hex(n: number, width = 0): string {
    return `0x${n.toString(16).padStart(width, '0')}`;
}

function getMapData(rom: Buffer, mapID: number): Buffer {
    const mapPointer = rom.readUInt32BE(mapTableOffset + mapID * 4);
    const romOffset = (mapPointer & 0x7FFFFFFF) + pointerTableOffset;
    if ((mapPointer & 0x80000000) !== 0) {
        const targetMapID = rom.readUInt16BE(romOffset);
        console.log(`Map ${hex(mapID, 2)} redirects to ${hex(targetMapID, 2)}`);
        return getMapData(rom, targetMapID);
    }

    if (rom.readUInt32BE(romOffset) !== 0x1F8B0800)
        throw new Error(`Map ${hex(mapID, 2)} does not point to a DK64 gzip stream`);
    return inflateRawSync(rom.subarray(romOffset + 0x0A));
}

const opcodeNames = new Map<number, string>([
    [0x00, 'SNOOP'],
    [0x01, 'VTX'],
    [0x02, 'MODIFYVTX'],
    [0x05, 'TRI1'],
    [0x06, 'TRI2'],
    [0xD7, 'TEXTURE'],
    [0xD9, 'GEOMETRYMODE'],
    [0xDE, 'DL'],
    [0xDF, 'ENDDL'],
    [0xE2, 'SETOTHERMODE_L'],
    [0xE3, 'SETOTHERMODE_H'],
    [0xE6, 'RDPLOADSYNC'],
    [0xE7, 'RDPPIPESYNC'],
    [0xE8, 'RDPTILESYNC'],
    [0xF0, 'LOADTLUT'],
    [0xF2, 'SETTILESIZE'],
    [0xF3, 'LOADBLOCK'],
    [0xF5, 'SETTILE'],
    [0xFA, 'SETPRIMCOLOR'],
    [0xFB, 'SETENVCOLOR'],
    [0xFC, 'SETCOMBINE'],
    [0xFD, 'SETTIMG'],
]);

function disassembleDisplayList(map: Buffer, dlStart: number, relativeOffset: number): void {
    console.log(`\nDisplay list ${hex(relativeOffset)}:`);
    for (let offs = dlStart + relativeOffset; offs + 8 <= map.length; offs += 8) {
        const w0 = map.readUInt32BE(offs);
        const w1 = map.readUInt32BE(offs + 4);
        const opcode = w0 >>> 24;
        const name = opcodeNames.get(opcode) ?? `OP_${opcode.toString(16).padStart(2, '0')}`;
        let annotation = '';
        if (opcode === 0x00)
            annotation = ` section=${hex(w1)}`;
        else if (opcode === 0xFD)
            annotation = ` segment=${hex(w1 >>> 24, 2)} address=${hex(w1 & 0x00FFFFFF, 6)}`;
        else if (opcode === 0xDE)
            annotation = ` target=${hex(w1)}`;
        console.log(`${hex(offs - dlStart, 6)}  ${name.padEnd(16)} ${hex(w0, 8)} ${hex(w1, 8)}${annotation}`);
        if (opcode === 0xDF)
            return;
    }
}

function inspectMap(map: Buffer, mapID: number): void {
    const headerFields = [
        ['treeStart', 0x30],
        ['dlStart', 0x34],
        ['vertStart', 0x38],
        ['vertEnd', 0x40],
        ['animatedTextureStart', 0x48],
        ['sectionStart', 0x58],
        ['sectionEnd', 0x5C],
        ['chunkCountOffset', 0x64],
        ['chunkStart', 0x68],
        ['chunkEnd', 0x6C],
        ['dlExpansionStart', 0x70],
    ] as const;

    console.log(`Map ${hex(mapID, 2)}, decompressed size ${hex(map.length)}`);
    for (const [name, offs] of headerFields)
        console.log(`${name.padEnd(24)} ${hex(map.readUInt32BE(offs))}`);

    const treeStart = map.readUInt32BE(0x30);
    console.log(`rootNodeType             ${map.readUInt8(treeStart + 0xB8)}`);
    console.log(`rootExtraListCount       ${map.readUInt8(treeStart + 0xC5)}`);

    const animatedTextureStart = map.readUInt32BE(0x48);
    const animatedTextureCount = map.readUInt32BE(animatedTextureStart);
    console.log(`\nAnimated textures (${animatedTextureCount}):`);
    for (let i = 0; i < animatedTextureCount; i++) {
        const offs = animatedTextureStart + 4 + i * 0x7C;
        const frameCount = map.readUInt8(offs + 3);
        const frames: string[] = [];
        for (let j = 0; j < frameCount; j++)
            frames.push(hex(map.readUInt32BE(offs + 0x0C + j * 4)));
        console.log(`${i}: segment=${hex(map.readUInt8(offs), 2)} group=${map.readUInt8(offs + 1)} delay=${map.readUInt8(offs + 2)} frames=[${frames.join(', ')}]`);
    }

    const sectionStart = map.readUInt32BE(0x58);
    const sectionEnd = map.readUInt32BE(0x5C);
    const sections = new Map<number, number>();
    for (let offs = sectionStart + 4; offs < sectionEnd; offs += 0x1C)
        sections.set(map.readUInt16BE(offs + 2), map.readUInt16BE(offs));

    const chunkCount = map.readUInt32BE(map.readUInt32BE(0x64));
    const chunkStart = map.readUInt32BE(0x68);
    const dlStart = map.readUInt32BE(0x34);
    console.log(`\nChunks (${chunkCount}):`);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const chunkOffs = chunkStart + chunkIndex * 0x34;
        const vertOffset = map.readInt32BE(chunkOffs + 0x2C);
        console.log(`chunk ${chunkIndex}: vertOffset=${hex(vertOffset)}`);
        for (let slot = 0; slot < 4; slot++) {
            const relativeOffset = map.readInt32BE(chunkOffs + 0x0C + slot * 8);
            const size = map.readUInt32BE(chunkOffs + 0x10 + slot * 8);
            if (relativeOffset < 0 || size === 0)
                continue;
            const snoops: string[] = [];
            for (let offs = dlStart + relativeOffset; offs < dlStart + relativeOffset + size; offs += 8) {
                if (map.readUInt8(offs) === 0x00) {
                    const sectionID = map.readUInt32BE(offs + 4);
                    snoops.push(`${hex(sectionID)}(group ${sections.get(sectionID) ?? '?'})@${hex(offs - dlStart)}`);
                }
            }
            console.log(`  slot ${slot}: dl=${hex(relativeOffset)} size=${hex(size)} snoops=[${snoops.join(', ')}]`);
        }
    }

    const expansionStart = map.readUInt32BE(0x70);
    console.log(`\nDisplay-list expansions: ${map.readUInt32BE(expansionStart)}`);
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: npm run inspect:DonkeyKong64 -- <map-id-hex> [--dl=<relative-offset-hex>] [--rom=<path>]');
        console.error('Example: npm run inspect:DonkeyKong64 -- B0 --dl=9778');
        process.exit(1);
    }

    const mapID = parseNumber(args[0]);
    const romPath = args.find((arg) => arg.startsWith('--rom='))?.slice('--rom='.length) ?? 'data/DonkeyKong64_Raw/rom.z64';
    const dlArg = args.find((arg) => arg.startsWith('--dl='));
    const rom = readFileSync(romPath);
    const map = getMapData(rom, mapID);
    inspectMap(map, mapID);
    if (dlArg !== undefined)
        disassembleDisplayList(map, map.readUInt32BE(0x34), parseNumber(dlArg.slice('--dl='.length)));
}

main();
