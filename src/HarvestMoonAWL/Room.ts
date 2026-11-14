
// Indoor room archives

import { mat4, vec3 } from "gl-matrix";

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color, colorFromRGBA8, colorNewFromRGBA } from "../Color.js";
import { Light } from "../gx/gx_material.js";
import { saturate } from "../MathHelpers.js";
import * as U8 from "../rres/u8.js";

import * as Act from "./Act.js";
import * as Env from "./Env.js";
import { DecodedMesh } from "./Gpl.js";
import * as Oqt from "./Oqt.js";
import { wrapMod } from "./Util.js";

//#region Archive Classification

const GPL_MAGIC = 0x005BBC61;
const TPL_MAGIC = 0x0020AF30;
const COL_MAGIC = 0xE7E3F1F4;
const LLT_MAGIC = 0xECECE7F4;
const LAM_MAGIC = 0xECE1EDE2;

export interface RoomArchive {
    gpl: ArrayBufferSlice;
    tpl: ArrayBufferSlice | null;
    oqt: ArrayBufferSlice[];
    col: ArrayBufferSlice[];
    llt: ArrayBufferSlice[];
    lam: ArrayBufferSlice | null;
    acts: ArrayBufferSlice[];
    anms: ArrayBufferSlice[];
}

function everyFile(dir: U8.U8Dir, out: U8.U8File[]): void {
    for (const node of dir.childNodes) {
        if (node.kind === 'directory')
            everyFile(node, out);
        else
            out.push(node);
    }
}

export function loadRoomArchive(data: ArrayBufferSlice): RoomArchive {
    const files: U8.U8File[] = [];
    everyFile(U8.parse(data).root, files);

    let gpl: ArrayBufferSlice | null = null;
    let tpl: ArrayBufferSlice | null = null;
    let lam: ArrayBufferSlice | null = null;
    const oqt: ArrayBufferSlice[] = [], col: ArrayBufferSlice[] = [], llt: ArrayBufferSlice[] = [];
    const acts: ArrayBufferSlice[] = [], anms: ArrayBufferSlice[] = [];
    for (const file of files) {
        const chunk = file.buffer;
        if (chunk.byteLength < 4)
            continue;
        const magic = chunk.createDataView().getUint32(0, false);
        if (magic === GPL_MAGIC)
            gpl = chunk;
        else if (magic === TPL_MAGIC)
            tpl = chunk;
        else if (magic === Oqt.MAGIC)
            oqt.push(chunk);
        else if (magic === COL_MAGIC)
            col.push(chunk);
        else if (magic === LLT_MAGIC)
            llt.push(chunk);
        else if (magic === LAM_MAGIC)
            lam = chunk;
        else if (magic === Act.ACT_VERSION)
            acts.push(chunk);
        else if (magic === Act.ANM_MAGIC)
            anms.push(chunk);
    }
    if (gpl === null)
        throw new Error("no .gpl geometry entry found in this room archive");
    return { gpl, tpl, oqt, col, llt, lam, acts, anms };
}

//#endregion

//#region Room lighting

export const MAX_ROOM_LIGHTS = 8;

const LIGHT_RECORD_SIZE = 0x4C;
const FLOAT_KEY_SIZE = 0x24;
const COLOR_KEY_SIZE = 0x08;

interface ColorKey { frame: number; rgba: number; }
interface FloatKey { frame: number; value: number; }
interface Curve<T> { endFrame: number; keys: T[]; }

function readColorCurve(view: DataView, offs: number): Curve<ColorKey> {
    const count = view.getUint32(offs, false);
    const endFrame = view.getFloat32(offs + 4, false);
    const keys: ColorKey[] = [];
    for (let i = 0; i < count; i++) {
        const k = offs + 8 + i * COLOR_KEY_SIZE;
        keys.push({ rgba: view.getUint32(k, false), frame: view.getFloat32(k + 4, false) });
    }
    return { endFrame, keys };
}

function readFloatCurve(view: DataView, offs: number): Curve<FloatKey> {
    const count = view.getUint32(offs, false);
    const endFrame = view.getFloat32(offs + 4, false);
    const keys: FloatKey[] = [];
    for (let i = 0; i < count; i++) {
        const k = offs + 8 + i * FLOAT_KEY_SIZE;
        keys.push({ value: view.getFloat32(k, false), frame: view.getFloat32(k + 4, false) });
    }
    return { endFrame, keys };
}

function evalRoomColorCurve(dst: Color, curve: Curve<ColorKey>, dayFrac: number): void {
    Env.evalColorCurve(dst, curve.keys, dayFrac * curve.endFrame);
}

function evalRoomFloatCurve(curve: Curve<FloatKey>, dayFrac: number): number {
    const frame = dayFrac * curve.endFrame;
    const idx = Env.bracketIndex(curve.keys, frame);
    const a = curve.keys[idx], b = curve.keys[(idx + 1) % curve.keys.length];
    const span = b.frame - a.frame;
    const t = span > 0 ? (frame - a.frame) / span : 0;
    return a.value + (b.value - a.value) * t;
}

interface RoomLightRecord {
    staticColor: number;
    staticPosition: vec3;
    direction: vec3;
    colorCurve: Curve<ColorKey> | null;
    positionCurves: (Curve<FloatKey> | null)[];
}

function parseLightList(data: ArrayBufferSlice, limit: number): RoomLightRecord[] {
    const view = data.createDataView();
    const count = Math.min(view.getUint32(4, false), limit);
    const records: RoomLightRecord[] = [];
    for (let i = 0; i < count; i++) {
        const rec = 8 + i * LIGHT_RECORD_SIZE;
        const colorOffs = view.getUint32(rec + 0x2C, false);
        const positionCurves: (Curve<FloatKey> | null)[] = [];
        for (let slot = 0; slot < 3; slot++) {
            const offs = view.getUint32(rec + 0x3C + slot * 4, false);
            positionCurves.push(offs !== 0 ? readFloatCurve(view, offs) : null);
        }
        records.push({
            staticColor: view.getUint32(rec + 0x04, false),
            staticPosition: vec3.fromValues(
                view.getFloat32(rec + 0x14, false), view.getFloat32(rec + 0x18, false), view.getFloat32(rec + 0x1C, false)),
            direction: vec3.fromValues(
                view.getFloat32(rec + 0x20, false), view.getFloat32(rec + 0x24, false), view.getFloat32(rec + 0x28, false)),
            colorCurve: colorOffs !== 0 ? readColorCurve(view, colorOffs) : null,
            positionCurves,
        });
    }
    return records;
}

export class RoomLighting {
    public lights: Light[] = [];
    public ambient: Color = colorNewFromRGBA(1, 1, 1, 0);

    // Used for curated multi-rooms
    public offset: vec3 = vec3.create();

    constructor(private records: RoomLightRecord[], private ambientCurve: Curve<ColorKey>) {
        for (let i = 0; i < this.records.length; i++) {
            const light = new Light();
            vec3.negate(light.Direction, this.records[i].direction);
            this.lights.push(light);
        }
        this.evaluate(Env.DEFAULT_TIME_SECONDS);
    }

    public evaluate(timeSeconds: number): void {
        const dayFrac = Env.dayFraction(timeSeconds);
        for (let i = 0; i < this.records.length; i++) {
            const record = this.records[i], light = this.lights[i];
            if (record.colorCurve !== null)
                evalRoomColorCurve(light.Color, record.colorCurve, dayFrac);
            else
                colorFromRGBA8(light.Color, record.staticColor);
            for (let axis = 0; axis < 3; axis++) {
                const curve = record.positionCurves[axis];
                light.Position[axis] = (curve !== null ? evalRoomFloatCurve(curve, dayFrac) : record.staticPosition[axis]) + this.offset[axis];
            }
        }
        evalRoomColorCurve(this.ambient, this.ambientCurve, dayFrac);
        this.ambient.a = 0.0;
    }
}

export function loadRoomLighting(room: RoomArchive): RoomLighting | null {
    if (room.llt.length < 2 || room.lam === null)
        return null;
    const listA = parseLightList(room.llt[0], MAX_ROOM_LIGHTS);
    const listB = parseLightList(room.llt[1], MAX_ROOM_LIGHTS - listA.length);
    const lamView = room.lam.createDataView();
    const ambientCurve = readColorCurve(lamView, lamView.getUint32(4, false));
    return new RoomLighting([...listA, ...listB], ambientCurve);
}

//#endregion

//#region Room Catalog

export const NAMED_ID_RANGE_BY_ARCHIVE: ReadonlyMap<string, [number, number]> = new Map([
    ["jitaku-living.arc", [0, 10]], ["jitaku-kitchen_poor.arc", [11, 17]],
    ["jitaku-childsroom_poor.arc", [18, 40]], ["jitaku-shinshitsu_poor.arc", [41, 50]],
    ["doubutsugoya.arc", [51, 125]], ["sakunyushitsu.arc", [126, 133]],
    ["torigoya.arc", [134, 140]], ["syokumotsuko.arc", [141, 157]],
    ["kakoushitsu.arc", [158, 162]], ["dougugoya.arc", [163, 199]],
    ["takakura.arc", [200, 201]], ["hanabi.arc", [202, 204]],
    ["geizyutsuka.arc", [205, 206]], ["kagakusya.arc", [207, 210]],
    ["shizin.arc", [211, 213]], ["sakaba-mise.arc", [214, 220]],
    ["sakaba-living.arc", [221, 223]], ["yadoya-entrance.arc", [224, 227]],
    ["yadoya-huuhu.arc", [228, 229]], ["yadoya-kitchen.arc", [230, 233]],
    ["yadoya-room1.arc", [234, 244]], ["yadoya-room2.arc", [245, 251]],
    ["yadoya-corridor.arc", [252, 255]], ["hakamori.arc", [256, 257]],
    ["yashiki-room1.arc", [258, 262]], ["yashiki-room2.arc", [263, 264]],
    ["yashiki-room3.arc", [265, 266]], ["yashiki-room4.arc", [267, 268]],
    ["yashiki-entrance.arc", [269, 274]], ["yashiki-corridor.arc", [275, 277]],
    ["minka1-1.arc", [278, 279]], ["minka1-2.arc", [280, 281]],
    ["minka2-1.arc", [282, 283]], ["minka2-2.arc", [284, 285]],
    ["minka3-1.arc", [286, 287]], ["minka3-2.arc", [288, 289]],
    ["tent.arc", [290, 297]], ["hakkutsu1.arc", [298, 299]],
    ["koro.arc", [310, 311]], ["nouka1a.arc", [312, 313]],
    ["nouka1b-1.arc", [314, 315]], ["nouka1b-2.arc", [316, 317]],
    ["jitaku-living1_poor.arc", [0, 10]], ["jitaku-living2_poor.arc", [0, 10]],
    ["jitaku-living3_poor.arc", [0, 10]], ["jitaku-kitchen1_poor.arc", [11, 17]],
    ["jitaku-childsroom1_poor.arc", [18, 40]], ["doubutsugoya1.arc", [51, 125]],
    ["syokumotsuko1.arc", [141, 157]], ["takakura1.arc", [200, 201]],
    ["jitaku-living1_mumu.arc", [0, 10]], ["jitaku-living1_nami.arc", [0, 10]],
    ["jitaku-living1_sepiria.arc", [0, 10]], ["jitaku-living2_mumu.arc", [0, 10]],
    ["jitaku-living2_nami.arc", [0, 10]], ["jitaku-living2_sepiria.arc", [0, 10]],
    ["jitaku-living3_mumu.arc", [0, 10]], ["jitaku-living3_nami.arc", [0, 10]],
    ["jitaku-living3_sepiria.arc", [0, 10]], ["jitaku-kitchen_mumu.arc", [11, 17]],
    ["jitaku-kitchen_nami.arc", [11, 17]], ["jitaku-kitchen_sepiria.arc", [11, 17]],
    ["jitaku-kitchen1_mumu.arc", [11, 17]], ["jitaku-kitchen1_nami.arc", [11, 17]],
    ["jitaku-kitchen1_sepiria.arc", [11, 17]], ["jitaku-childsroom_mumu.arc", [18, 40]],
    ["jitaku-childsroom_nami.arc", [18, 40]], ["jitaku-childsroom_sepiria.arc", [18, 40]],
    ["jitaku-childsroom1_mumu.arc", [18, 40]], ["jitaku-childsroom1_nami.arc", [18, 40]],
    ["jitaku-childsroom1_sepiria.arc", [18, 40]], ["jitaku-shinshitsu_mumu.arc", [41, 50]],
    ["jitaku-shinshitsu_nami.arc", [41, 50]], ["jitaku-shinshitsu_sepiria.arc", [41, 50]],
    ["hakkutsu2.arc", [300, 301]], ["hakkutsu3.arc", [302, 303]],
    ["hakkutsu4.arc", [304, 305]], ["hakkutsu5.arc", [306, 307]],
    ["hakkutsu6.arc", [308, 309]],
] as [string, [number, number]][]);

function idSet(...ranges: (number | [number, number])[]): ReadonlySet<number> {
    const out = new Set<number>();
    for (const r of ranges) {
        if (typeof r === 'number') {
            out.add(r);
        } else {
            for (let i = r[0]; i <= r[1]; i++)
                out.add(i);
        }
    }
    return out;
}

// Empty IDs
export const NAMED_NEVER_SHOWN = idSet(117, 118, 127, 128, 131, 135, 235, 237, [291, 296]);

// IDs that we want to toggle on/off
export const NAMED_CONDITIONAL = idSet(
    [1, 6], 19, [20, 35], [42, 47], [52, 116], 119, 129, 132, [136, 139], [145, 147],
    [151, 156], 164, 167, [168, 198], [215, 218], [246, 249], 259,
);

export type RoomDrawKind = 'opaque' | 'opaque-late' | 'additive' | 'water';

export const WATER_SLOT = 3;

export const WATER_ID_MOD = 10000;

const DRAW_KIND_BY_SLOT: RoomDrawKind[] = ['opaque', 'opaque-late', 'additive', 'water'];

// Light shafts attached to windows
// fade in 06:00-07:00, fade out 17:00-18:00
export function lightShaftIntensity(timeSeconds: number, weatherLightFactor: number): number {
    const t = wrapMod(timeSeconds, Env.DAY_SEC);
    const hour = Math.floor(t / 3600) % 24;
    let day: number;
    if (hour < 6 || hour > 17)
        day = 0.0;
    else {
        const s = (Math.floor(t) % 3600) / 3600.0;
        day = hour === 17 ? 1.0 - s : hour === 6 ? s : 1.0;
    }
    return day * saturate(weatherLightFactor);
}

// For the disks of light in Daryl's house
export const PULSE_GLOW_OBJECT_IDS: ReadonlySet<number> = new Set([208, 209]);
export const PULSE_GLOW_PERIOD_MS = 2000;

export function pulseGlowAlpha(ms: number): number {
    let t = ms % PULSE_GLOW_PERIOD_MS;
    if (t > 999)
        t = PULSE_GLOW_PERIOD_MS - t;
    return (Math.floor((t * 0xe0) / 1000) + 0x1f) / 0xff;
}

export function isPulseGlow(objectId: number | null): boolean {
    return objectId !== null && PULSE_GLOW_OBJECT_IDS.has(objectId);
}

export const GLASS_PANE_OBJECT_IDS: ReadonlySet<number> = new Set([149]);

export const GLASS_PANE_MAT_COLOR: Color = colorNewFromRGBA(1, 1, 1, 0x80 / 0xff);

export function isGlassPane(objectId: number | null): boolean {
    return objectId !== null && GLASS_PANE_OBJECT_IDS.has(objectId);
}

// Food in the storage room fridge
export const NAMED_VARIANT_GROUPS: readonly (readonly number[])[] = [
    [151, 152, 153, 154, 155, 156],
];

const NAMED_VARIANT_UNSELECTED: ReadonlySet<number> = new Set(NAMED_VARIANT_GROUPS.flatMap((g) => g.slice(1)));

export function isUnselectedVariant(objectId: number | null): boolean {
    return objectId !== null && NAMED_VARIANT_UNSELECTED.has(objectId);
}

export type NamedVisibility = 'always' | 'cond' | 'never';

export function namedObjectVisibility(objectId: number | null): NamedVisibility {
    if (objectId === null)
        return 'always';
    if (NAMED_NEVER_SHOWN.has(objectId))
        return 'never';
    if (NAMED_CONDITIONAL.has(objectId))
        return 'cond';
    return 'always';
}

//#endregion


//#region Instantiator

const GEOMETRY_SLOTS = [0, 1, 2, WATER_SLOT];
const ACTOR_ID_BASE = 200;
const ACTOR_ID_BASE_ANIMATED = 400;

export interface RoomInstance {
    blockIndex: number;
    matrix: mat4;
    slot: number;
    recordIndex: number;
    typeId: number;
    objectId: number | null;
    visibility: NamedVisibility;
    drawKind: RoomDrawKind;
    actorIndex: number | null;
    boneIndex: number | null;
    parked: boolean;
    position: [number, number, number];
}

// Any object that we're unable to place is parked
const PARKED_MARGIN = 3.0;

function flagParked(instances: RoomInstance[], worldBBoxes: ([vec3, vec3] | null)[]): void {
    let best: [vec3, vec3] | null = null;
    let bestArea = -1;
    for (const bb of worldBBoxes) {
        if (bb === null)
            continue;
        const area = (bb[1][0] - bb[0][0]) * (bb[1][2] - bb[0][2]);
        if (area > bestArea) {
            bestArea = area;
            best = bb;
        }
    }
    if (best === null)
        return;
    const [min, max] = best;
    for (const inst of instances) {
        const [px, , pz] = inst.position;
        inst.parked = !(min[0] - PARKED_MARGIN <= px && px <= max[0] + PARKED_MARGIN
            && min[2] - PARKED_MARGIN <= pz && pz <= max[2] + PARKED_MARGIN);
    }
}

function worldBBox(mesh: DecodedMesh, m: mat4): [vec3, vec3] | null {
    if (mesh.positions.length === 0)
        return null;
    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    const p = vec3.create();
    for (const pos of mesh.positions) {
        vec3.set(p, pos[0], pos[1], pos[2]);
        vec3.transformMat4(p, p, m);
        vec3.min(min, min, p);
        vec3.max(max, max, p);
    }
    return [min, max];
}

export interface LoadRoomOptions {
    includeParked?: boolean;
    includeNeverShown?: boolean;
    includeUnselectedVariants?: boolean;
}

export function loadRoomInstances(room: RoomArchive, archiveName: string | null, meshes: Map<number, DecodedMesh>, options: LoadRoomOptions = {}): RoomInstance[] {
    const actors = room.acts.map((a) => Act.loadAct(a));
    const named = archiveName !== null ? NAMED_ID_RANGE_BY_ARCHIVE.get(archiveName) ?? null : null;

    const instances: RoomInstance[] = [];
    const worldBBoxes: ([vec3, vec3] | null)[] = [];

    const pushInstance = (blockIndex: number, matrix: mat4, common: Omit<RoomInstance, 'blockIndex' | 'matrix' | 'actorIndex' | 'boneIndex' | 'parked' | 'position'>, actorIndex: number | null, boneIndex: number | null): void => {
        const mesh = meshes.get(blockIndex);
        if (mesh === undefined)
            return;
        instances.push({
            ...common, blockIndex, matrix, actorIndex, boneIndex, parked: false,
            position: [matrix[12], matrix[13], matrix[14]],
        });
        worldBBoxes.push(worldBBox(mesh, matrix));
    };

    for (const slot of GEOMETRY_SLOTS) {
        if (slot >= room.oqt.length)
            break;
        let records: Oqt.OqtInstance[];
        try {
            records = Oqt.allInstances(room.oqt[slot]);
        } catch (e) {
            continue;
        }
        for (let ri = 0; ri < records.length; ri++) {
            const rec = records[ri];
            const objectId = (slot === 0 && named !== null && ri < named[1] - named[0]) ? named[0] + ri : null;
            const typeId = Oqt.oqtTypeId(rec);
            const common = {
                slot, recordIndex: ri, typeId, objectId, visibility: namedObjectVisibility(objectId),
                drawKind: (isPulseGlow(objectId) || isGlassPane(objectId)) ? 'additive' as RoomDrawKind : DRAW_KIND_BY_SLOT[slot],
            };
            const m = Oqt.oqtRecordMatrix(mat4.create(), rec);

            if (slot === WATER_SLOT) {
                pushInstance(typeId % WATER_ID_MOD, m, common, null, null);
                continue;
            }

            if (typeId < ACTOR_ID_BASE) {
                pushInstance(typeId, m, common, null, null);
                continue;
            }
            const k = typeId < ACTOR_ID_BASE_ANIMATED ? typeId - ACTOR_ID_BASE : typeId - ACTOR_ID_BASE_ANIMATED;
            if (k >= actors.length)
                continue;
            const actor = actors[k];
            const boneMatrices = Act.partWorldMatrices(actor).map((w) => mat4.mul(w, m, w));
            for (let j = 0; j < actor.parts.length; j++)
                pushInstance(actor.parts[j].partId, boneMatrices[j], common, k, j);
        }
    }

    flagParked(instances, worldBBoxes);

    const includeParked = options.includeParked ?? false;
    const includeNeverShown = options.includeNeverShown ?? false;
    const includeUnselectedVariants = options.includeUnselectedVariants ?? false;
    return instances.filter((inst) =>
        (includeParked || !inst.parked) && (includeNeverShown || inst.visibility !== 'never')
        && (includeUnselectedVariants || !isUnselectedVariant(inst.objectId)));
}

//#endregion
