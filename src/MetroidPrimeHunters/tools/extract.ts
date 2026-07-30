#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const RAM = 0x02004000, START = 0x020B8794, END = 0x020BAFD4, STRIDE = 0x70;

// The entity metadata tables live in overlays rather than in the ARM9. Overlay
// load addresses overlap, so each table names the overlay it belongs to.
const ENTITY_OVERLAY = 2, WORLD_OVERLAY = 15;
const PLATFORM_TABLE = 0x021712D0, PLATFORM_COUNT = 45, PLATFORM_STRIDE = 0x28;
const OBJECT_TABLE = 0x0217062C, OBJECT_COUNT = 54, OBJECT_STRIDE = 0x14;
const DOOR_MODEL_TABLE = 0x0211FEEC, DOOR_ANIM_TABLE = 0x0211FF0C, DOOR_COUNT = 4;
const DOOR_LOCK_PALETTES = 0x0211FE90, DOOR_LOCK_COUNT = 10;
const ITEM_TABLE = 0x02120460, ITEM_COUNT = 22;
const u16 = (b: Buffer, o: number) => b.readUInt16LE(o);
const u32 = (b: Buffer, o: number) => b.readUInt32LE(o);
const i32 = (b: Buffer, o: number) => b.readInt32LE(o);

function blz(data: Buffer): Buffer {
    const info = u32(data, data.length - 8), extra = u32(data, data.length - 4);
    const footer = info >>> 24, size = info & 0xFFFFFF;
    if (footer < 8 || footer > 11 || extra === 0)
        return data;
    const out = Buffer.concat([data, Buffer.alloc(extra)]);
    let src = data.length - footer - 1, dst = out.length - 1;
    const limit = data.length - size;
    while (src > limit) {
        let flags = out[src--];
        for (let bit = 0; bit < 8 && src > limit; bit++, flags = flags << 1 & 0xFF) {
            if (flags & 0x80) {
                const a = out[src], b = out[src - 1]; src -= 2;
                for (let n = (a >>> 4) + 3; n--;)
                    out[dst--] = out[dst + ((a & 15) << 8) + b + 4];
            } else {
                out[dst--] = out[src--];
            }
        }
    }
    return out;
}

function lz10(data: Buffer): Buffer {
    const out = Buffer.alloc(data.readUIntLE(1, 3));
    let src = 4, dst = 0;
    while (dst < out.length) {
        const flags = data[src++];
        for (let bit = 7; bit >= 0 && dst < out.length; bit--) {
            if (flags & 1 << bit) {
                const pair = data.readUInt16BE(src); src += 2;
                const distance = (pair & 0xFFF) + 1;
                for (let n = (pair >>> 12) + 3; n--;)
                    out[dst] = out[dst++ - distance];
            } else {
                out[dst++] = data[src++];
            }
        }
    }
    return out;
}

function nitroFS(rom: Buffer): Map<string, Buffer> {
    const fnt = rom.subarray(u32(rom, 0x40), u32(rom, 0x40) + u32(rom, 0x44));
    const fat = u32(rom, 0x48), files = new Map<string, Buffer>();
    function walk(dir: number, parent = ''): void {
        let cursor = u32(fnt, (dir - 0xF000) * 8), fileId = u16(fnt, (dir - 0xF000) * 8 + 4);
        while (fnt[cursor] !== 0) {
            const length = fnt[cursor++], nameLength = length & 0x7F;
            const name = fnt.toString('ascii', cursor, cursor + nameLength); cursor += nameLength;
            const filename = parent ? `${parent}/${name}` : name;
            if (length & 0x80) {
                walk(u16(fnt, cursor), filename); cursor += 2;
            } else {
                const begin = u32(rom, fat + fileId * 8), end = u32(rom, fat + fileId * 8 + 4);
                files.set(filename, rom.subarray(begin, end)); fileId++;
            }
        }
    }
    walk(0xF000);
    return files;
}

function readCString(data: Buffer, offset: number): string {
    return data.toString('ascii', offset, data.indexOf(0, offset));
}

interface Image {
    ram: number;
    data: Buffer;
}

function overlays(rom: Buffer): Map<number, Image> {
    const table = u32(rom, 0x50), size = u32(rom, 0x54), fat = u32(rom, 0x48);
    const images = new Map<number, Image>();
    for (let offs = table; offs < table + size; offs += 0x20) {
        const fileId = u32(rom, offs + 0x18), compressed = (u32(rom, offs + 0x1C) >>> 24) & 1;
        const data = rom.subarray(u32(rom, fat + fileId * 8), u32(rom, fat + fileId * 8 + 4));
        images.set(u32(rom, offs), { ram: u32(rom, offs + 0x04), data: compressed ? blz(data) : data });
    }
    return images;
}

// Model and animation names are stored either bare or as a full NitroFS path.
function assetStem(name: string): string {
    return path.parse(name).name.replace(/_(model|anim)$/i, '').toLowerCase();
}

function entityMetadata(images: Map<number, Image>, hasFile: (name: string) => boolean): object {
    const read = (overlay: number, address: number) => {
        const image = images.get(overlay)!;
        const offset = address - image.ram;
        if (offset < 0 || offset >= image.data.length)
            throw new Error(`overlay ${overlay} does not cover ${address.toString(16)}`);
        return { image, offset };
    };
    const pointer = (overlay: number, address: number) => {
        const { image, offset } = read(overlay, address);
        return u32(image.data, offset);
    };
    const name = (overlay: number, address: number): string | null => {
        if (address === 0)
            return null;
        const { image, offset } = read(overlay, address);
        return assetStem(readCString(image.data, offset));
    };

    const platforms = [];
    for (let i = 0; i < PLATFORM_COUNT; i++) {
        const entry = PLATFORM_TABLE + i * PLATFORM_STRIDE;
        const animationName = name(WORLD_OVERLAY, pointer(WORLD_OVERLAY, entry + 0x04));
        // Of the four per-state animation slots, the game renders the third.
        const animationId = animationName !== null ? pointer(WORLD_OVERLAY, entry + 0x14) : 0;
        platforms.push({ modelName: name(WORLD_OVERLAY, pointer(WORLD_OVERLAY, entry)), animationName, animationId });
    }

    const objects = [];
    for (let i = 0; i < OBJECT_COUNT; i++) {
        const entry = OBJECT_TABLE + i * OBJECT_STRIDE;
        const { image, offset } = read(WORLD_OVERLAY, entry + 0x0C);
        objects.push({
            modelName: name(WORLD_OVERLAY, pointer(WORLD_OVERLAY, entry)),
            animationName: name(WORLD_OVERLAY, pointer(WORLD_OVERLAY, entry + 0x04)),
            // One signed animation ID per initial state; -1 means unanimated.
            animationIds: [0, 1, 2, 3].map((k) => image.data.readInt8(offset + k)),
        });
    }

    const doors = [];
    for (let i = 0; i < DOOR_COUNT; i++)
        doors.push({
            modelName: name(ENTITY_OVERLAY, pointer(ENTITY_OVERLAY, DOOR_MODEL_TABLE + i * 4)),
            animationName: name(ENTITY_OVERLAY, pointer(ENTITY_OVERLAY, DOOR_ANIM_TABLE + i * 4)),
        });

    const lock = read(ENTITY_OVERLAY, DOOR_LOCK_PALETTES);
    const doorLockPaletteIds = [...lock.image.data.subarray(lock.offset, lock.offset + DOOR_LOCK_COUNT)];

    const items = [];
    for (let i = 0; i < ITEM_COUNT; i++) {
        const modelName = name(ENTITY_OVERLAY, pointer(ENTITY_OVERLAY, ITEM_TABLE + i * 4));
        // The game animates exactly those pickups that ship with an anim file.
        items.push({ modelName, animated: hasFile(`models/${modelName}_anim.bin`) });
    }

    return { platforms, objects, doors, doorLockPaletteIds, items };
}

function extract(rom: Buffer): [object[], object, Record<string, string>, Record<string, string>, Map<string, Buffer>] {
    if (rom.toString('ascii', 0x0C, 0x10) !== 'AMHE')
        throw new Error('expected the US Metroid Prime Hunters ROM (AMHE)');
    if (u32(rom, 0x28) !== RAM)
        throw new Error('unexpected ARM9 load address');
    const armOffset = u32(rom, 0x20), arm = blz(rom.subarray(armOffset, armOffset + u32(rom, 0x2C)));
    const str = (pointer: number) => readCString(arm, pointer - RAM);
    const files = nitroFS(rom);
    const output = new Map([...files].filter(([p]) => /^(archives|models|levels\/(textures|entities|nodedata))\//i.test(p))
        .map(([p, data]) => [p.toLowerCase(), data]));
    const textureNames = new Set([...output.keys()].filter((p) => p.startsWith('levels/textures/')).map((p) => path.basename(p)));
    const archiveTextures = Object.fromEntries([...output.keys()].filter((p) => p.startsWith('archives/'))
        .map((p) => path.parse(p).name).filter((stem) => textureNames.has(`${stem}_tex.bin`))
        .map((stem) => [stem, `${stem}_tex.bin`]));
    const modelArchives: Record<string, string> = {};
    for (const [filename, data] of output) {
        if (!filename.startsWith('archives/')) continue;
        const archive = lz10(data), count = archive.readUInt32BE(8), stem = path.parse(filename).name;
        for (let i = 0; i < count; i++) {
            const name = readCString(archive, 0x20 + i * 0x40).toLowerCase();
            if (name.endsWith('_model.bin')) modelArchives[name] = stem;
        }
    }
    const areas: object[] = [];

    for (let address = START; address <= END; address += STRIDE) {
        const row = arm.subarray(address - RAM, address - RAM + STRIDE);
        const geometrySet = u16(row, 0x2A), light0 = u32(row, 0x40), light1 = u32(row, 0x50);
        const area: Record<string, unknown> = {
            sourceAddress: address,
            fog: { enabled: u32(row, 0x30) !== 0, color: u32(row, 0x34), depthShift: u32(row, 0x38), offset: u32(row, 0x3C) & 0x7FFF },
            lightColor0: [light0 & 31, light0 >>> 8 & 31, light0 >>> 16 & 31],
            lightVector0: [i32(row, 0x44), i32(row, 0x48), i32(row, 0x4C)],
            lightColor1: [light1 & 31, light1 >>> 8 & 31, light1 >>> 16 & 31],
            lightVector1: [i32(row, 0x54), i32(row, 0x58), i32(row, 0x5C)],
            name: str(u32(row, 0x00)),
            modelFilename: str(u32(row, 0x04)).toLowerCase(),
            animationFilename: str(u32(row, 0x08)).toLowerCase(),
            textureFilename: str(u32(row, 0x0C)).toLowerCase(),
            collisionFilename: str(u32(row, 0x10)).toLowerCase(),
            entityFilename: str(u32(row, 0x14)).toLowerCase(),
            nodeFilename: str(u32(row, 0x18)).toLowerCase(),
        };
        if (geometrySet !== 1) area.geometrySet = geometrySet;

        areas.push(area);
    }
    const entities = entityMetadata(overlays(rom), (name) => output.has(name));
    return [areas, entities, archiveTextures, modelArchives, output];
}

const [romName, outDir] = process.argv.slice(2);
if (romName === undefined || outDir === undefined)
    throw new Error(`usage: ${path.basename(process.argv[1])} ROM OUT`);
const [areas, entities, archiveTextures, modelArchives, files] = extract(fs.readFileSync(romName));
for (const [filename, data] of files) {
    const target = path.join(outDir, filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
}
fs.writeFileSync(path.join(outDir, 'area_metadata.json'), `${JSON.stringify(areas, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'entity_metadata.json'), `${JSON.stringify(entities, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'archive_textures.json'), `${JSON.stringify(archiveTextures, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'model_archives.json'), `${JSON.stringify(modelArchives, null, 2)}\n`);
console.log(`wrote ${areas.length} areas and ${files.size} files to ${outDir}`);
