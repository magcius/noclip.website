import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";
import { TRIANGLE_LIST, TRIANGLE_STRIP } from "./EGP2.js";

const VERTEX_SIZE = 32;
const MATERIAL_SIZE = 0x34;
const ITEM_SIZE = 20;
const SECTION_START_AT = 0x0C;
const STRING_OFFSET_AT = 0x08;
const SECTION_SIZE_AT = 0x0C;
const MATERIAL_COUNT_AT = 0x3E;
const ITEM_COUNT_AT = 0x40;
const MATERIAL_TABLE_AT = 0x50;
const ITEM_TABLE_AT = 0x54;
const ITEM_SIZE_AT = 0x08;
const ITEM_GEOMETRY_AT = 0x0C;
const COMMAND_SIZE = 16;
const COMMAND_LIST_AT = 0x10;
const COMMAND_COUNT_AT = 0x0C;
const SET_MATERIAL = 1;
const END_GROUP = [7, 8, 0x1007, 0x1008];
const MATERIAL_SLOTS = 3;
const SLOT_SIZE = 16;
const SLOTS_AT = 4;
const QUADWORD = 16;
const CHUNK_HEADER_SIZE = 16;
const MIN_LIBRARY_SIZE = 0x10;
const NLOOP_MASK = 0x7FFF;
const MAX_NLOOP = 4096;
const COORDINATE_LIMIT = 1e5;
const NAME_LIMIT = 120;

export interface PropSection {
    name: string;
    offset: number;
    size: number;
}

export interface PropGroup {
    material: number;
    positions: Float32Array;
    texcoords: Float32Array;
    indices: Uint32Array;
}

export interface PropItem {
    name: string;
    groups: PropGroup[];
}

/**
 * Walk a `.SGP2` library's chain of object sections.
 * @param data The whole `.SGP2` file.
 * @returns One entry per object, in file order.
 */
export function readSections(data: ArrayBufferSlice): PropSection[] {
    if (data.byteLength < MIN_LIBRARY_SIZE) {
        return [];
    }
    const view = data.createDataView();
    const sections: PropSection[] = [];
    let at = view.getUint32(SECTION_START_AT, true);
    while (at + CHUNK_HEADER_SIZE <= data.byteLength) {
        const size = view.getUint32(at + SECTION_SIZE_AT, true);
        const strings = view.getUint32(at + STRING_OFFSET_AT, true);
        if (size === 0 || at + size > data.byteLength) {
            break;
        }
        const nameAt = at + strings;
        if (nameAt >= data.byteLength) {
            break;
        }
        const name = readString(data, nameAt);
        if (name.length === 0) {
            break;
        }
        sections.push({ name, offset: at, size });
        at += size;
    }
    return sections;
}

function name(section: ArrayBufferSlice, at: number): string {
    if (at <= 0 || at >= section.byteLength) {
        return '';
    }
    const found = readString(section, at, NAME_LIMIT + 1);
    return found.length > 0 && found.length <= NAME_LIMIT ? found : '';
}

/**
 * Report whether an item is one of several interchangeable pieces.
 * @param itemName The item's name.
 * @returns `true` when the item is one of an interchangeable set.
 */
export function isAlternate(itemName: string): boolean {
    return itemName.startsWith('*');
}

const HEADWEAR = ['hat', 'beanie', 'bandana', 'visor', 'helmet', 'durag', 'skullcap'];
const EYEWEAR = ['glasses', 'shades', 'goggle', 'monocle'];
const HAIR = ['hair', 'bun', 'ponytail', 'braid', 'afro', 'dread', 'pigtail'];
const FOOTWEAR = ['shoe', 'boot', 'sniker', 'sneaker', 'sandal', 'slipper', 'loafer'];
const NOT_A_HEAD = ['headphone', 'bandage'];
const COLOR = /black|blonde|blond|brown|white|grey|gray|ginger|brunette|auburn/gi;

/**
 * Give the set an interchangeable item belongs to.
 * @param itemName The item's name.
 * @returns A key shared by the alternatives for one piece.
 */
export function wardrobeKey(itemName: string): string {
    const bare = itemName.replace(/^\*+/, '');
    const low = bare.toLowerCase();
    if (HEADWEAR.some((word) => low.includes(word))) {
        return 'headwear';
    }
    if (EYEWEAR.some((word) => low.includes(word))) {
        return 'eyewear';
    }
    if (!low.includes('hairpick') && HAIR.some((word) => low.includes(word))) {
        return 'hairpiece';
    }
    if (FOOTWEAR.some((word) => low.includes(word))) {
        return 'footwear';
    }
    if (low.includes('head') && !NOT_A_HEAD.some((word) => low.includes(word))) {
        return 'head';
    }
    return bare.replace(/_s\d+/gi, '').replace(/_face_?\d*/gi, '').replace(/\d+/g, '')
        .replace(COLOR, '');
}

const NOT_CLOTHING = [
    'head', 'face', 'hair', 'bun', 'ponytail', 'hand', 'eye', 'teeth', 'tooth', 'shoe',
    'sniker', 'boot', 'glass', 'necklace', 'earing', 'earring', 'broach', 'brooch', 'tie',
    'collar', 'nametag', 'ribbon', 'hairpick', 'watch', 'belt', 'hat', 'cap',
];
const MODESTY = [
    'top', 'bra', 'bikini', 'bottom', 'brief', 'panty', 'thong', 'swim', 'dress', 'gown', 'skirt',
    'leotard',
];
// WAIST and CHEST are fractions of the model's height. SLEEVED is of its width.
const WAIST = 0.45;
const CHEST = 0.75;
const ONE_PIECE = 0.10;
const SLEEVED = 0.80;
const CELL = 0.5;
const CLEARANCE = 0.05;
const CROWN = 0.55;
const HAT_FIT = 0.04;
const MIN_COVERED = 20;

// The share of the head's crown left sticking out of the hat.
function crownFit(head: PropItem, hat: PropItem): number {
    const cell = (at: Float32Array, i: number): string =>
        `${Math.round(at[i] / CELL)},${Math.round(at[i + 2] / CELL)}`;
    const lid = new Map<string, number>();
    for (const group of hat.groups) {
        const at = group.positions;
        for (let i = 0; i < at.length; i += 3) {
            lid.set(cell(at, i), Math.max(lid.get(cell(at, i)) ?? -Infinity, at[i + 1]));
        }
    }
    const top = extent(head, 1).high;
    let covered = 0, out = 0;
    for (const group of head.groups) {
        const at = group.positions;
        for (let i = 0; i < at.length; i += 3) {
            if (at[i + 1] < CROWN * top) {
                continue;
            }
            const under = lid.get(cell(at, i));
            if (under === undefined) {
                continue;
            }
            covered++;
            if (at[i + 1] > under + CLEARANCE) {
                out++;
            }
        }
    }
    return covered < MIN_COVERED ? Infinity : out / covered;
}

// Whether a garment dresses the whole body rather than one half of it. Sleeves do not count.
function covers(where: string[]): boolean {
    return where.includes('legs') && where.includes('torso');
}

function modestyPiece(itemName: string): string | null {
    const low = itemName.replace(/^\*+/, '').toLowerCase();
    return MODESTY.find((word) => low.includes(word)) ?? null;
}

function isClothing(itemName: string): boolean {
    const low = itemName.replace(/^\*+/, '').toLowerCase();
    return !NOT_CLOTHING.some((word) => low.includes(word));
}

function extent(item: PropItem, axis: number): { low: number, high: number, values: number[] } {
    const values: number[] = [];
    for (const group of item.groups) {
        for (let i = axis; i < group.positions.length; i += 3) {
            values.push(group.positions[i]);
        }
    }
    return { low: Math.min(...values), high: Math.max(...values), values };
}

/**
 * This picks one outfit of all the possible ones.
 * @param items Every item the section holds.
 * @param materials The section's material table.
 * @returns The items to draw, in the order they were given.
 */
export function wornItems(items: PropItem[], materials: string[][]): PropItem[] {
    let top = 0, span = 0;
    for (const item of items) {
        const z = extent(item, 1), x = extent(item, 0);
        top = Math.max(top, z.high);
        span = Math.max(span, x.high - x.low);
    }
    const places = (item: PropItem): string[] => {
        if (/arm/i.test(item.name)) {
            return ['arms'];
        }
        const { high, values } = extent(item, 1);
        if (high < CHEST * top) {
            return ['legs'];
        }
        const below = values.filter((z) => z < WAIST * top).length / values.length;
        const where = below > ONE_PIECE ? ['legs', 'torso'] : ['torso'];
        if (extent(item, 0).high - extent(item, 0).low > SLEEVED * span) {
            where.push('arms');
        }
        return where;
    };

    const rejected = new Set<PropItem>();
    const footwear = items.filter((item) =>
        isAlternate(item.name) && wardrobeKey(item.name) === 'footwear');
    if (footwear.length > 1) {
        const tallest = footwear.reduce((a, b) => extent(b, 1).high > extent(a, 1).high ? b : a);
        for (const item of footwear) {
            if (item !== tallest) {
                rejected.add(item);
            }
        }
    }
    const headwear = items.filter((item) =>
        isAlternate(item.name) && wardrobeKey(item.name) === 'headwear');
    const heads = items.filter((item) =>
        isAlternate(item.name) && wardrobeKey(item.name) === 'head');
    if (headwear.length > 0 && heads.length > 0) {
        let best = { fit: Infinity, head: heads[0], hat: headwear[0] };
        for (const head of heads) {
            for (const hat of headwear) {
                const fit = crownFit(head, hat);
                if (fit < best.fit) {
                    best = { fit, head, hat };
                }
            }
        }
        for (const item of [...heads, ...headwear]) {
            if (item !== best.head && (item !== best.hat || best.fit > HAT_FIT)) {
                rejected.add(item);
            }
        }
    }

    const competing = items.filter((item) =>
        isAlternate(item.name) && isClothing(item.name) && modestyPiece(item.name) === null);
    const worn = new Set(competing);
    const taken = new Set<string>();
    let onePiece = false;
    for (const item of [...competing].sort((a, b) => extent(b, 1).values.length - extent(a, 1).values.length)) {
        const where = places(item);
        if (where.some((place) => taken.has(place))) {
            worn.delete(item);
        } else {
            for (const place of where) {
                taken.add(place);
            }
            onePiece ||= covers(where);
        }
    }

    const textures = (item: PropItem): string[] => {
        const out: string[] = [];
        for (const group of item.groups) {
            for (const found of materials[group.material] ?? []) {
                out.push(found.split('/').pop()!.toLowerCase());
            }
        }
        return out;
    };

    const seen = new Set<string>();
    const chosen = items.filter((item) => {
        if (!isAlternate(item.name)) {
            return true;
        }
        if (rejected.has(item)) {
            return false;
        }
        const modesty = modestyPiece(item.name);
        if (modesty === null && isClothing(item.name)) {
            return worn.has(item);
        }
        if (modesty !== null && onePiece && !covers(places(item))) {
            return false;
        }
        const key = modesty ?? wardrobeKey(item.name);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });

    const onHead = new Set<string>();
    for (const item of chosen) {
        if (/head/i.test(item.name)) {
            for (const found of textures(item)) {
                if (found.includes('hair')) {
                    onHead.add(found);
                }
            }
        }
    }
    return chosen.filter((item) => {
        if (!/hair/i.test(item.name)) {
            return true;
        }
        const own = textures(item);
        return own.length === 0 || !own.every((found) => onHead.has(found));
    });
}

/**
 * Read a section's material table.
 * @param section The section's bytes.
 * @returns Per material, the texture names it references, base colour first.
 */
export function readMaterials(section: ArrayBufferSlice): string[][] {
    if (section.byteLength < ITEM_TABLE_AT + 4) {
        return [];
    }
    const view = section.createDataView();
    const count = view.getUint16(MATERIAL_COUNT_AT, true);
    const table = view.getUint32(MATERIAL_TABLE_AT, true);
    if (table === 0 || table + count * MATERIAL_SIZE > section.byteLength) {
        return [];
    }
    const out: string[][] = [];
    for (let index = 0; index < count; index++) {
        const record = table + index * MATERIAL_SIZE;
        const names: string[] = [];
        for (let slot = 0; slot < MATERIAL_SLOTS; slot++) {
            const found = name(section, view.getUint32(record + SLOTS_AT + slot * SLOT_SIZE, true));
            if (found !== '') {
                names.push(found);
            }
        }
        out.push(names);
    }
    return out;
}

// GIFtags have to be found within the packets.
function readPackets(section: ArrayBufferSlice, view: DataView, start: number, end: number): { primitive: number, positions: number[], texcoords: number[] }[] {
    const limit = Math.min(end, section.byteLength);
    const packets: { primitive: number, positions: number[], texcoords: number[] }[] = [];
    let at = Math.max(start, 0);
    while (at + CHUNK_HEADER_SIZE <= limit) {
        const low = view.getUint32(at, true);
        const high = view.getUint32(at + 4, true);
        const count = low & NLOOP_MASK;
        const primitive = (high >>> 15) & 7;
        const nreg = (high >>> 28) & 0xF;
        const finish = at + CHUNK_HEADER_SIZE + count * VERTEX_SIZE;
        if (((low >>> 15) & 1) === 0 || count === 0 || count >= MAX_NLOOP ||
            (primitive !== TRIANGLE_LIST && primitive !== TRIANGLE_STRIP) ||
            (nreg !== 3 && nreg !== 4) || finish > section.byteLength) {
            at += 4;
            continue;
        }
        const positions: number[] = [];
        const texcoords: number[] = [];
        let ok = true;
        for (let i = 0; i < count; i++) {
            const row = at + CHUNK_HEADER_SIZE + i * VERTEX_SIZE;
            const x = view.getFloat32(row + 0, true);
            const y = view.getFloat32(row + 4, true);
            const z = view.getFloat32(row + 8, true);
            const u = view.getFloat32(row + 16, true);
            const v = view.getFloat32(row + 20, true);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(u) || !Number.isFinite(v) ||
                Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > COORDINATE_LIMIT) {
                ok = false;
                break;
            }
            positions.push(x, z, -y);
            texcoords.push(u, 1.0 - v);
        }
        if (!ok) {
            at += 4;
            continue;
        }
        packets.push({ primitive, positions, texcoords });
        at = finish;
    }
    return packets;
}

function pushTriangles(indices: number[], positions: number[], base: number, count: number, primitive: number): void {
    const same = (a: number, b: number): boolean => {
        const ia = (base + a) * 3, ib = (base + b) * 3;
        return positions[ia] === positions[ib] && positions[ia + 1] === positions[ib + 1] && positions[ia + 2] === positions[ib + 2];
    };
    const emit = (a: number, b: number, c: number): void => {
        if (!same(a, b) && !same(b, c) && !same(a, c)) {
            indices.push(base + a, base + b, base + c);
        }
    };
    if (primitive === TRIANGLE_LIST) {
        for (let i = 0; i + 2 < count; i += 3) {
            emit(i, i + 1, i + 2);
        }
        return;
    }
    for (let i = 0; i + 2 < count; i++) {
        if (i % 2) {
            emit(i, i + 2, i + 1);
        } else {
            emit(i, i + 1, i + 2);
        }
    }
}

/**
 * Read a section's items and the material each of their draw groups uses.
 * @param section The section's bytes.
 * @returns One entry per item that draws anything, in file order.
 */
export function readItems(section: ArrayBufferSlice): PropItem[] {
    if (section.byteLength < ITEM_TABLE_AT + 4) {
        return [];
    }
    const view = section.createDataView();
    const count = view.getUint16(ITEM_COUNT_AT, true);
    const table = view.getUint32(ITEM_TABLE_AT, true);
    if (table === 0 || table + count * ITEM_SIZE > section.byteLength) {
        return [];
    }
    const items: PropItem[] = [];
    for (let index = 0; index < count; index++) {
        const record = table + index * ITEM_SIZE;
        if (view.getUint32(record + ITEM_SIZE_AT, true) === 0) {
            continue;
        }
        const geometry = record + view.getInt32(record + ITEM_GEOMETRY_AT, true);
        if (geometry < 0 || geometry >= section.byteLength - COMMAND_LIST_AT) {
            continue;
        }
        const commands = geometry + COMMAND_LIST_AT + view.getUint32(geometry, true);
        const total = view.getUint32(geometry + COMMAND_COUNT_AT, true);
        if (total > MAX_NLOOP || commands + total * COMMAND_SIZE > section.byteLength) {
            continue;
        }
        const itemName = name(section, record + view.getInt32(record, true));
        let material = 0;
        const groups: PropGroup[] = [];
        for (let step = 0; step < total; step++) {
            const at = commands + step * COMMAND_SIZE;
            const opcode = view.getUint16(at, true);
            if (opcode === SET_MATERIAL) {
                material = view.getUint32(at + 4, true);
            } else if (END_GROUP.includes(opcode)) {
                const start = view.getUint32(at + 4, true);
                const length = view.getUint32(at + 8, true);
                const packets = readPackets(section, view, geometry + start, geometry + start + length * QUADWORD);
                if (packets.length === 0) {
                    continue;
                }
                const positions: number[] = [];
                const texcoords: number[] = [];
                const indices: number[] = [];
                for (const packet of packets) {
                    const base = positions.length / 3;
                    positions.push(...packet.positions);
                    texcoords.push(...packet.texcoords);
                    pushTriangles(indices, positions, base, packet.positions.length / 3, packet.primitive);
                }
                if (indices.length === 0) {
                    continue;
                }
                groups.push({
                    material,
                    positions: new Float32Array(positions),
                    texcoords: new Float32Array(texcoords),
                    indices: new Uint32Array(indices),
                });
            }
        }
        if (groups.length > 0) {
            items.push({ name: itemName, groups });
        }
    }
    return items;
}
