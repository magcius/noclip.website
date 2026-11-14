// There are four fields that grow on their own with different crops depending on season.

import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as U8 from "../rres/u8.js";
import { clamp, saturate } from "../MathHelpers.js";
import * as Act from "./Act.js";
import * as Gpl from "./Gpl.js";
import * as Season from "./Season.js";
import { wrapMod } from "./Util.js";

//#region Fields, Crops & Calendar Tables

export interface NpcField {
    index: number;
    origin: vec3;
    rows: number;
    cols: number;
    note: string;
}

export const NPC_FIELDS: NpcField[] = [
    { index: 0, origin: vec3.fromValues(171.0, 12.0, 200.0), rows: 6, cols: 6, note: `NPC farm, upper terrace` },
    { index: 1, origin: vec3.fromValues(163.0, 11.5, 200.0), rows: 6, cols: 6, note: `NPC farm, middle terrace` },
    { index: 2, origin: vec3.fromValues(155.0, 11.0, 200.0), rows: 6, cols: 6, note: `NPC farm, lower terrace` },
    { index: 3, origin: vec3.fromValues(131.0, 8.6, 96.0), rows: 4, cols: 2, note: `small fenced plot` },
];

export function cellCount(field: NpcField): number {
    return field.rows * field.cols;
}

export const CROP_YAW_DEGREES = 270.0;
export const CROP_YAW_RADIANS = CROP_YAW_DEGREES * Math.PI / 180.0;

// Crops make a checkered grid
export function cellPosition(dst: vec3, field: NpcField, i: number): vec3 {
    const row = (i / field.cols) | 0;
    const col = i % field.cols;
    return vec3.set(dst, field.origin[0] + row + 0.5, field.origin[1],
        field.origin[2] + 2.0 * col + (row & 1) + 0.5);
}

// Crop ID per field, per season.
export const FIELD_SEASON_ITEM: number[][] = [
    [347, 335, 371, 359],
    [299, 323, 335, 347],
    [287, 299, 323, 311],
    [287, 323, 359, 335],
];

// Stage is the plant, sub is the fruit/vegetable
export const GROWTH_STAGE: number[][] = [
    [0, 1, 1, 2, 3, 4, 4, 5, 5, 6],
    [0, 1, 1, 2, 3, 3, 4, 4, 5, 5],
];
export const GROWTH_SUB: number[][] = [
    [0, 0, 0, 0, 0, 0, 0, 1, 2, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

export interface BaseCrop {
    item: number;
    cropNumber: number;
    name: string;
    kind: number;
    model: string;
    seasonMask: number;
}

export const BASE_CROPS = new Map<number, BaseCrop>([
    [287, { item: 287, cropNumber: 1, name: `Tomato`, kind: 0, model: `toma`, seasonMask: 0b0111 }],
    [299, { item: 299, cropNumber: 2, name: `Watermelon`, kind: 0, model: `sui`, seasonMask: 0b0011 }],
    [311, { item: 311, cropNumber: 3, name: `Strawberry`, kind: 0, model: `ichi`, seasonMask: 0b1101 }],
    [323, { item: 323, cropNumber: 4, name: `Melon`, kind: 0, model: `mero`, seasonMask: 0b0110 }],
    [335, { item: 335, cropNumber: 32, name: `Turnip`, kind: 1, model: `kabu`, seasonMask: 0b1110 }],
    [347, { item: 347, cropNumber: 33, name: `Potato`, kind: 1, model: `jaga`, seasonMask: 0b1001 }],
    [359, { item: 359, cropNumber: 34, name: `Carrot`, kind: 1, model: `ninzi`, seasonMask: 0b1100 }],
    [371, { item: 371, cropNumber: 35, name: `Yam`, kind: 1, model: `satsuma`, seasonMask: 0b0100 }],
]);

export function cropForFieldSeason(fieldIndex: number, season: number): BaseCrop {
    return BASE_CROPS.get(FIELD_SEASON_ITEM[fieldIndex][season & 3])!;
}

function dayIndex(dayOfSeason: number): number {
    return wrapMod(dayOfSeason, Season.DAYS_PER_SEASON);
}

export function stageForDay(kind: number, dayOfSeason: number): number {
    return GROWTH_STAGE[kind === 1 ? 1 : 0][dayIndex(dayOfSeason)];
}

export function subForDay(kind: number, dayOfSeason: number): number {
    return GROWTH_SUB[kind === 1 ? 1 : 0][dayIndex(dayOfSeason)];
}

//stage -> pose, per kind
const PREV_POSE = -1;
const STAGE_POSE: number[][] = [
    // stage:   0          1  2  3  4  5
    /* kind 0 */[PREV_POSE, 0, 1, 2, 3, 4],
    /* kind 1 */[PREV_POSE, 0, 1, 2, 3, 3],
];

const RIPE_POSE: number[][] = [
    // prev:    0  1  2  3  4  5+
    /* kind 0 */[7, 7, 7, 5, 6, 7],
    /* kind 1 */[5, 5, 5, 4, 5],
];

export function poseForStage(kind: number, stage: number, prev: number = 0): number {
    const k = kind === 1 ? 1 : 0;
    const pose = STAGE_POSE[k][stage] ?? PREV_POSE;
    if (pose !== PREV_POSE)
        return pose;
    const ripe = RIPE_POSE[k];
    return ripe[clamp(prev, 0, ripe.length - 1)];
}

export const PLANT_IMAGE_EARLY = [0, 2, 4, 0];
export const PLANT_IMAGE_LATE = [1, 3, 5, 0];

export function plantImageIndex(stage: number, quality: number): number {
    return (stage === 1 || stage === 2 ? PLANT_IMAGE_EARLY : PLANT_IMAGE_LATE)[quality & 3];
}

//#endregion

//#region Fruit
// The fruit has a separate model/attachment to the plant
export type HarvestAttach = `h` | `item` | null;

export function harvestAttachment(kind: number, stage: number, sub: number): HarvestAttach {
    if (stage === 0)
        return null;
    if (stage === 4)
        return `h`;
    if (kind === 0 && sub !== 0)
        return `item`;
    return null;
}

export interface ItemModel {
    block: number;
    image0: number;
    height: number;
}

export const CROP_ITEM_MODELS = new Map<number, ItemModel>([
    [287, { block: 164, image0: 160, height: 4444 / 16384 }], // Tomato
    [299, { block: 137, image0: 130, height: 7807 / 16384 }], // Watermelon
    [311, { block: 84, image0: 80, height: 5172 / 16384 }],   // Strawberry
    [323, { block: 114, image0: 108, height: 7000 / 16384 }], // Melon
    [335, { block: 94, image0: 88, height: 6152 / 16384 }],   // Turnip
    [347, { block: 89, image0: 83, height: 5734 / 16384 }],   // Potato
    [359, { block: 120, image0: 115, height: 2716 / 16384 }], // Carrot
    [371, { block: 130, image0: 124, height: 3239 / 16384 }], // Yam
]);

export const CROP_QUALITY = 1;
export const CROP_H_IMAGE = 0;

// Unripe fruit is tinted green, then masked when ripened
export const ITEM_TINT: (readonly [number, number, number, number] | null)[] = [
    null, [0x50, 0xF0, 0x30, 0xF0], [0xFF, 0xFF, 0xFF, 0xFF], null,
];

export function usedModels(): BaseCrop[] {
    const seen = new Map<string, BaseCrop>();
    for (const field of NPC_FIELDS) for (let season = 0; season < 4; season++) {
        const crop = cropForFieldSeason(field.index, season);
        seen.set(crop.model, crop);
    }
    return [...seen.values()];
}

//#endregion

//#region 3x4 matrices

type Mat34 = Float32Array; // 12 floats, row-major

function mat34(): Mat34 {
    const m = new Float32Array(12);
    m[0] = m[5] = m[10] = 1.0;
    return m;
}

function mat34Mul(dst: Mat34, a: Mat34, b: Mat34): Mat34 {
    const o = dst === a || dst === b ? new Float32Array(12) : dst;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++)
            o[r * 4 + c] = a[r * 4 + 0] * b[0 * 4 + c] + a[r * 4 + 1] * b[1 * 4 + c] + a[r * 4 + 2] * b[2 * 4 + c];
        o[r * 4 + 3] = a[r * 4 + 0] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
    }
    if (o !== dst)
        dst.set(o);
    return dst;
}

function mat34Invert(dst: Mat34, m: Mat34): Mat34 {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[4], a11 = m[5], a12 = m[6];
    const a20 = m[8], a21 = m[9], a22 = m[10];
    let det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
    if (Math.abs(det) < 1e-20)
        det = det >= 0 ? 1e-20 : -1e-20;
    const i00 = (a11 * a22 - a12 * a21) / det, i01 = (a02 * a21 - a01 * a22) / det, i02 = (a01 * a12 - a02 * a11) / det;
    const i10 = (a12 * a20 - a10 * a22) / det, i11 = (a00 * a22 - a02 * a20) / det, i12 = (a02 * a10 - a00 * a12) / det;
    const i20 = (a10 * a21 - a11 * a20) / det, i21 = (a01 * a20 - a00 * a21) / det, i22 = (a00 * a11 - a01 * a10) / det;
    const tx = m[3], ty = m[7], tz = m[11];
    dst[0] = i00; dst[1] = i01; dst[2] = i02; dst[3] = -(i00 * tx + i01 * ty + i02 * tz);
    dst[4] = i10; dst[5] = i11; dst[6] = i12; dst[7] = -(i10 * tx + i11 * ty + i12 * tz);
    dst[8] = i20; dst[9] = i21; dst[10] = i22; dst[11] = -(i20 * tx + i21 * ty + i22 * tz);
    return dst;
}

function xformPoint(m: Mat34, x: number, y: number, z: number): [number, number, number] {
    return [m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11]];
}

//#endregion

//#region .anm - magic

const COMP_SIZE = [1, 1, 2, 2, 4];
const ROT_SCALE = 1.0 / 16384.0;
const ROT_CTYPE = 3;

const DESC_SCALE = 0x01;
const DESC_EULER = 0x02;
const DESC_QUAT = 0x04;
const DESC_TRANS = 0x08;

interface AnmTrack {
    endFrame: number;
    dataOff: number;
    keyCount: number;
    joint: number;
    ctype: number;
    frac: number;
    animMask: number;
    interp: number;
    constMask: number;
}

interface Transform {
    flags: number;
    scale: [number, number, number];
    quat: [number, number, number, number];
    euler: [number, number, number];
    trans: [number, number, number];
}

function newTransform(): Transform {
    return { flags: 0, scale: [1, 1, 1], quat: [0, 0, 0, 1], euler: [0, 0, 0], trans: [0, 0, 0] };
}

// How many quaternion components a track actually stores
function rotCount(animMask: number): number {
    return 1 + (animMask & 0x20 ? 0 : 1) + (animMask & 0x40 ? 0 : 1) + (animMask & 0x80 ? 0 : 1);
}

function parseAnm(view: DataView): Map<number, AnmTrack> {
    const magic = view.getUint32(0);
    if (magic !== Act.ANM_MAGIC)
        throw new Error(`not a .anm file: magic ${magic.toString(16)}`);
    const tracks = new Map<number, AnmTrack>();
    const count = view.getUint16(4);
    for (let i = 0; i < count; i++) {
        const o = 8 + i * 0x10;
        const quant = view.getUint8(o + 0x0C);
        tracks.set(view.getInt16(o + 0x0A), {
            endFrame: view.getFloat32(o), dataOff: view.getUint32(o + 4),
            keyCount: view.getUint16(o + 8), joint: view.getInt16(o + 0x0A),
            ctype: quant >> 4, frac: quant & 0x0F,
            animMask: view.getUint8(o + 0x0D), interp: view.getUint8(o + 0x0E),
            constMask: view.getUint8(o + 0x0F),
        });
    }
    return tracks;
}

function decodeComps(view: DataView, off: number, ctype: number, scale: number, n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        if (ctype === 0) out.push(view.getUint8(off + i) * scale);
        else if (ctype === 1) out.push(view.getInt8(off + i) * scale);
        else if (ctype === 2) out.push(view.getUint16(off + i * 2) * scale);
        else if (ctype === 3) out.push(view.getInt16(off + i * 2) * scale);
        else out.push(view.getFloat32(off + i * 4));
    }
    return out;
}

function expandQuat(vals: number[], animMask: number): [number, number, number, number] {
    let p = 0;
    const xyz: number[] = [];
    for (const bit of [0x20, 0x40, 0x80])
        xyz.push(animMask & bit ? 0.0 : vals[p++]);
    return [xyz[0], xyz[1], xyz[2], vals[p]];
}

function channels(tr: AnmTrack): [string, number, number][] {
    const am = tr.animMask & 0x1F;
    const cs = COMP_SIZE[tr.ctype];
    const out: [string, number, number][] = [];
    let size = 0;
    if (am & 0x02) { out.push([`scale`, size, (tr.interp >> 2) & 3]); size += cs * 3; }
    if (am & 0x08) { out.push([`quat`, size, (tr.interp >> 4) & 7]); size += rotCount(tr.animMask) * 2; }
    else if (am & 0x04) { out.push([`euler`, size, (tr.interp >> 4) & 7]); size += cs * 3; }
    if (am & 0x01) { out.push([`trans`, size, tr.interp & 3]); size += cs * 3; }
    if (am & 0x10) { out.push([`matrix`, size, 0]); size += cs * 12; }
    return out;
}

// Bytes per keyframe (time + values + interpolation tangents).
function keyStride(tr: AnmTrack): number {
    const cs = COMP_SIZE[tr.ctype];
    const rc = rotCount(tr.animMask);
    let stride = 2;
    for (const [name, , mode] of channels(tr)) {
        if (name === `quat`) {
            stride += rc * 2;
            if (mode === 4) stride += cs * rc * 2;
            else if (mode === 5) stride += cs * rc * 2 + 4;
            else if (mode === 7) stride += cs * rc;
        } else if (name === `matrix`) {
            stride += cs * 12;
        } else {
            stride += cs * 3;
            if (mode === 2) stride += cs * 6;
            else if (mode === 3) stride += cs * 6 + 4;
        }
    }
    return stride;
}

// Hermite modes are evaluated as plain linear interpolation
function evaluateTrack(view: DataView, tr: AnmTrack, frame: number): Transform {
    const cs = COMP_SIZE[tr.ctype];
    const sc = 1.0 / (1 << tr.frac);
    const rc = rotCount(tr.animMask);
    const am = tr.animMask & 0x1F;
    const cm = tr.constMask & 0x1F;
    const out = newTransform();

    let o = tr.dataOff;
    if (cm & 0x02) {
        const v = decodeComps(view, o, tr.ctype, sc, 3); o += cs * 3;
        if (!(am & 0x02)) { out.scale = [v[0], v[1], v[2]]; out.flags |= DESC_SCALE; }
    }
    if (cm & 0x08) {
        const v = decodeComps(view, o, ROT_CTYPE, ROT_SCALE, rc); o += rc * 2;
        if (!(am & 0x08)) { out.quat = expandQuat(v, tr.animMask); out.flags |= DESC_QUAT; }
    } else if (cm & 0x04) {
        const v = decodeComps(view, o, tr.ctype, sc, 3); o += cs * 3;
        if (!(am & 0x04)) { out.euler = [v[0], v[1], v[2]]; out.flags |= DESC_EULER; }
    }
    if (cm & 0x01) {
        const v = decodeComps(view, o, tr.ctype, sc, 3); o += cs * 3;
        if (!(am & 0x01)) { out.trans = [v[0], v[1], v[2]]; out.flags |= DESC_TRANS; }
    }
    if (cm & 0x10)
        o += cs * 12;
    const keyBase = o;
    if (am === 0 || tr.keyCount === 0)
        return out;

    const chans = channels(tr);
    const stride = keyStride(tr);

    const read = (keyOff: number, name: string, off: number): number[] => {
        if (name === `quat`)
            return expandQuat(decodeComps(view, keyOff + 2 + off, ROT_CTYPE, ROT_SCALE, rc), tr.animMask);
        return decodeComps(view, keyOff + 2 + off, tr.ctype, sc, 3);
    };
    const store = (name: string, v: number[]) => {
        if (name === `scale`) { out.scale = [v[0], v[1], v[2]]; out.flags |= DESC_SCALE; }
        else if (name === `trans`) { out.trans = [v[0], v[1], v[2]]; out.flags |= DESC_TRANS; }
        else if (name === `euler`) { out.euler = [v[0], v[1], v[2]]; out.flags |= DESC_EULER; }
        else if (name === `quat`) {
            const n = Math.hypot(v[0], v[1], v[2], v[3]) || 1.0;
            out.quat = [v[0] / n, v[1] / n, v[2] / n, v[3] / n]; out.flags |= DESC_QUAT;
        }
    };

    if (tr.keyCount === 1) {
        for (const [name, off] of chans)
            store(name, read(keyBase, name, off));
        return out;
    }

    let i = 0;
    while (i < tr.keyCount - 2) {
        if (frame <= view.getInt16(keyBase + (i + 1) * stride))
            break;
        i++;
    }
    const k0 = keyBase + i * stride;
    const k1 = keyBase + (i + 1) * stride;
    const t0 = view.getInt16(k0);
    const t1 = view.getInt16(k1);
    const f = t1 <= t0 ? 0.0 : saturate((frame - t0) / (t1 - t0));
    for (const [name, off, mode] of chans) {
        const a = read(k0, name, off);
        const b = read(k1, name, off);
        store(name, mode === 0 ? a : a.map((av, j) => av + (b[j] - av) * f));
    }
    return out;
}

// Transform descriptor -> 3x4 matrix.
function transformToMat(dst: Mat34, t: Transform): Mat34 {
    if (t.flags & DESC_QUAT) {
        const [x, y, z, w] = t.quat;
        dst[0] = 1 - 2 * (y * y + z * z); dst[1] = 2 * (x * y - z * w); dst[2] = 2 * (x * z + y * w); dst[3] = 0;
        dst[4] = 2 * (x * y + z * w); dst[5] = 1 - 2 * (x * x + z * z); dst[6] = 2 * (y * z - x * w); dst[7] = 0;
        dst[8] = 2 * (x * z - y * w); dst[9] = 2 * (y * z + x * w); dst[10] = 1 - 2 * (x * x + y * y); dst[11] = 0;
    } else if (t.flags & DESC_EULER) {
        dst.set(mat34());
        const tmp = new Float32Array(12);
        for (let axis = 0; axis < 3; axis++) {
            const a = t.euler[axis] * Math.PI / 180.0;
            const c = Math.cos(a), s = Math.sin(a);
            tmp.fill(0);
            if (axis === 0) { tmp[0] = 1; tmp[5] = c; tmp[6] = -s; tmp[9] = s; tmp[10] = c; }
            else if (axis === 1) { tmp[0] = c; tmp[2] = s; tmp[5] = 1; tmp[8] = -s; tmp[10] = c; }
            else { tmp[0] = c; tmp[1] = -s; tmp[4] = s; tmp[5] = c; tmp[10] = 1; }
            mat34Mul(dst, dst, tmp);
        }
    } else {
        dst.set(mat34());
    }
    if (t.flags & DESC_SCALE)
        for (let c = 0; c < 3; c++)
            for (let r = 0; r < 3; r++)
                dst[r * 4 + c] *= t.scale[c];
    if (t.flags & DESC_TRANS) {
        dst[3] = t.trans[0]; dst[7] = t.trans[1]; dst[11] = t.trans[2];
    }
    return dst;
}

//#endregion

//#region .act
// .act - the animated-skeleton version, not the flat mapobjXX.act part list Act.ts reads.

interface Joint {
    index: number;
    parent: number; // -1 for a root
    // .act record +0x14: the .gpl block this joint draws as a sub-object, 0xffff for none
    geom: number;
    rest: Transform;
}

interface Skeleton {
    joints: Joint[];
    order: number[]; // parents always before children
}

function loadActSkeleton(view: DataView): Skeleton {
    const jointCount = view.getUint32(4);
    const rootPtr = view.getUint32(0x0C);
    const joints: (Joint | null)[] = new Array(jointCount).fill(null);
    const order: number[] = [];

    const readTransform = (off: number): Transform => ({
        flags: view.getUint8(off),
        scale: [view.getFloat32(off + 4), view.getFloat32(off + 8), view.getFloat32(off + 0x0C)],
        quat: [view.getFloat32(off + 0x10), view.getFloat32(off + 0x14),
               view.getFloat32(off + 0x18), view.getFloat32(off + 0x1C)],
        euler: [0, 0, 0],
        trans: [view.getFloat32(off + 0x20), view.getFloat32(off + 0x24), view.getFloat32(off + 0x28)],
    });

    // Record-tree walk: +0x08 next sibling, +0x10 first child, +0x16 joint index,
    // +0x00 the 52-byte transform block.
    const walk = (off: number, parent: number): void => {
        while (off !== 0) {
            const index = view.getUint16(off + 0x16);
            joints[index] = { index, parent, geom: view.getUint16(off + 0x14),
                              rest: readTransform(view.getUint32(off)) };
            order.push(index);
            const child = view.getUint32(off + 0x10);
            if (child !== 0)
                walk(child, index);
            off = view.getUint32(off + 8);
        }
    };
    walk(rootPtr, -1);
    if (joints.some((j) => j === null))
        throw new Error(`.act hierarchy walk did not reach every joint`);
    return { joints: joints as Joint[], order };
}

// The endFrame cache caches the animation's endFrame off the joint-0 track
// Joint 0 carries a track in every crop archive on disc
function endFrameTrack(tracks: Map<number, AnmTrack>): AnmTrack | null {
    const joint0 = tracks.get(0);
    if (joint0 !== undefined)
        return joint0;
    let first: AnmTrack | null = null;
    for (const tr of tracks.values())
        if (first === null || tr.dataOff < first.dataOff)
            first = tr;
    return first;
}

function forwardKinematics(skel: Skeleton, locals: Mat34[]): Mat34[] {
    const world: Mat34[] = locals.map(() => mat34());
    for (const idx of skel.order) {
        const parent = skel.joints[idx].parent;
        if (parent < 0)
            world[idx].set(locals[idx]);
        else
            mat34Mul(world[idx], world[parent], locals[idx]);
    }
    return world;
}

//#endregion

//#region `.skn`

interface Sk1Group { inputOff: number; outputOff: number; joint: number; count: number; align: number; }
interface Sk2Group { inputOff: number; weightOff: number; outputOff: number; jointA: number; jointB: number; count: number; align: number; }
interface SkAccGroup { inputOff: number; indexOff: number; weightOff: number; joint: number; count: number; }

interface Skn {
    shift: number;
    sk1: Sk1Group[];
    sk2: Sk2Group[];
    skacc: SkAccGroup[];
}

const SKN_ENTRY_SIZE = 12;

function loadSkn(view: DataView): Skn {
    const n1 = view.getUint16(0), n2 = view.getUint16(2), n3 = view.getUint16(4);
    const a1 = view.getUint32(8), a2 = view.getUint32(0x0C), a3 = view.getUint32(0x10);
    const out: Skn = { shift: view.getUint8(6), sk1: [], sk2: [], skacc: [] };
    for (let i = 0; i < n1; i++) {
        const r = a1 + i * 0x40;
        out.sk1.push({ inputOff: view.getUint32(r + 0x30), outputOff: view.getUint32(r + 0x34),
            joint: view.getUint16(r + 0x38), count: view.getUint16(r + 0x3A), align: view.getUint8(r + 0x3C) });
    }
    for (let i = 0; i < n2; i++) {
        const r = a2 + i * 0x74;
        out.sk2.push({ inputOff: view.getUint32(r + 0x60), weightOff: view.getUint32(r + 0x64),
            outputOff: view.getUint32(r + 0x68), jointA: view.getUint16(r + 0x6C),
            jointB: view.getUint16(r + 0x6E), count: view.getUint16(r + 0x70), align: view.getUint8(r + 0x72) });
    }
    for (let i = 0; i < n3; i++) {
        const r = a3 + i * 0x44;
        out.skacc.push({ inputOff: view.getUint32(r + 0x30), indexOff: view.getUint32(r + 0x34),
            weightOff: view.getUint32(r + 0x3C), joint: view.getUint16(r + 0x40), count: view.getUint16(r + 0x42) });
    }
    return out;
}

//#endregion

//#region Load/Pose a Crop

export class CropModel {
    private skeleton: Skeleton;
    private skn: Skn;
    private sknView: DataView;
    private anmViews: DataView[];
    private invBind: Mat34[];

    constructor(public name: string, public body: Gpl.DecodedMesh,
                actData: ArrayBufferSlice, sknData: ArrayBufferSlice, anmArcData: ArrayBufferSlice) {
        this.skeleton = loadActSkeleton(actData.createDataView());
        this.sknView = sknData.createDataView();
        this.skn = loadSkn(this.sknView);
        // Every file in a `.anm.arc` is named "@" - they are addressed by index in the ROM
        this.anmViews = U8.parse(anmArcData).root.files.map((f) => f.buffer.createDataView());

        this.invBind = forwardKinematics(this.skeleton,
            this.skeleton.joints.map((j) => transformToMat(mat34(), j.rest)))
            .map((m) => mat34Invert(mat34(), m));
    }

    public get stageCount(): number {
        return this.anmViews.length;
    }

    public get anchorJoint(): number {
        const j = this.skeleton.joints.find((joint) => joint.geom !== 0xFFFF);
        if (j === undefined)
            throw new Error(`${this.name}.act has no joint with a geometry index`);
        return j.index;
    }

    private worldMatrices(pose: number): Mat34[] {
        const view = this.anmViews[pose];
        const tracks = parseAnm(view);
        // The endFrame cache caches it off the first track. A negative play rate then seeks to
        // endFrame - 1e-4, the animation's last frame.
        const first = endFrameTrack(tracks);
        const frame = first !== null ? first.endFrame - 1e-4 : 0.0;
        const locals = this.skeleton.joints.map((j) => {
            const tr = tracks.get(j.index);
            return transformToMat(mat34(), tr !== undefined ? evaluateTrack(view, tr, frame) : j.rest);
        });
        return forwardKinematics(this.skeleton, locals);
    }

    public anchorMatrix(pose: number): mat4 {
        const m = this.worldMatrices(pose)[this.anchorJoint];
        const out = mat4.create();
        for (let r = 0; r < 3; r++)
            for (let c = 0; c < 4; c++)
                out[c * 4 + r] = m[r * 4 + c];
        return out;
    }

    private skinMatrices(stage: number): Mat34[] {
        return this.worldMatrices(stage).map((w, i) => mat34Mul(mat34(), w, this.invBind[i]));
    }

    public stageMesh(stage: number): Gpl.DecodedMesh {
        const mats = this.skinMatrices(stage);
        const scale = 1.0 / (1 << this.skn.shift);
        const positions: [number, number, number][] = this.body.positions.map((p) => [p[0], p[1], p[2]]);
        const n = positions.length;
        const put = (slot: number, p: [number, number, number]) => {
            if (slot >= 0 && slot < n)
                positions[slot] = p;
        };
        const readPos = (off: number): [number, number, number] => [
            this.sknView.getInt16(off) * scale,
            this.sknView.getInt16(off + 2) * scale,
            this.sknView.getInt16(off + 4) * scale,
        ];

        for (const g of this.skn.sk1) {
            const m = mats[g.joint];
            const base = ((g.outputOff + g.align) / SKN_ENTRY_SIZE) | 0;
            for (let i = 0; i < g.count; i++) {
                const p = readPos(g.inputOff + g.align + i * SKN_ENTRY_SIZE);
                put(base + i, xformPoint(m, p[0], p[1], p[2]));
            }
        }
        for (const g of this.skn.sk2) {
            const ma = mats[g.jointA], mb = mats[g.jointB];
            const base = ((g.outputOff + g.align) / SKN_ENTRY_SIZE) | 0;
            for (let i = 0; i < g.count; i++) {
                const p = readPos(g.inputOff + g.align + i * SKN_ENTRY_SIZE);
                const w = this.sknView.getUint16(g.weightOff + i * 2) / 65536.0;
                const pa = xformPoint(ma, p[0], p[1], p[2]);
                const pb = xformPoint(mb, p[0], p[1], p[2]);
                put(base + i, [pb[0] + (pa[0] - pb[0]) * w, pb[1] + (pa[1] - pb[1]) * w,
                               pb[2] + (pa[2] - pb[2]) * w]);
            }
        }

        if (this.skn.skacc.length > 0) {
            const accPos = new Map<number, [number, number, number]>();
            for (const g of this.skn.skacc) {
                const m = mats[g.joint];
                for (let i = 0; i < g.count; i++) {
                    const w = this.sknView.getUint8(g.weightOff + i) / 256.0;
                    if (w === 0.0)
                        continue;
                    const slot = this.sknView.getUint16(g.indexOff + i * 2);
                    const p = readPos(g.inputOff + i * SKN_ENTRY_SIZE);
                    const t = xformPoint(m, p[0], p[1], p[2]);
                    const a = accPos.get(slot) ?? [0, 0, 0];
                    a[0] += t[0] * w; a[1] += t[1] * w; a[2] += t[2] * w;
                    accPos.set(slot, a);
                }
            }
            for (const [slot, a] of accPos)
                put(slot, a);
        }

        return { ...this.body, positions };
    }
}

export function cropFileNames(model: string): { gpl: string, act: string, skn: string, anm: string, tpl: string, hGpl: string, hTpl: string } {
    return { gpl: `${model}.gpl`, act: `${model}.act`, skn: `${model}.skn`,
             anm: `${model}.anm.arc`, tpl: `${model}.tpl`,
             hGpl: `${model}_h.gpl`, hTpl: `${model}_h.tpl` };
}

export const SYMBOL_GPL = `symbol.gpl`;
export const SYMBOL_TPL = `symbol.tpl`;

export const CROP_BODY_BLOCK = 0;
export const CROP_H_BLOCK = 0;

//#endregion
