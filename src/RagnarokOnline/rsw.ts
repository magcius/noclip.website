import { vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { MathConstants } from "../MathHelpers.js";
import { readString } from "../util.js";

export interface RswVec3 {
    x: number;
    y: number;
    z: number;
}

export interface RswModelPlacement {
    name: string;
    modelName: string;
    nodeName: string;
    pos: RswVec3;
    rot: RswVec3;
    scale: RswVec3;
    animType: number;
    animSpeed: number;
    blockType: number;
}

export interface RswEffectSource {
    name: string;
    pos: RswVec3;
    type: number;
    emitSpeed: number;
    param: [number, number, number, number];
}

export interface RswPointLight {
    name: string;
    pos: RswVec3;
    color: [number, number, number];
    range: number;
}

export interface RswWorld {
    major: number;
    minor: number;
    iniFile: string;
    gndFile: string;
    gatFile: string;
    scrFile: string;
    waterLevel: number;
    waterType: number;
    waterAnimSpeed: number;
    waveHeight: number;
    waveSpeed: number;
    wavePitch: number;
    diffuse: RswVec3;
    ambient: RswVec3;
    longitude: number;
    latitude: number;
    models: RswModelPlacement[];
    effects: RswEffectSource[];
    lights: RswPointLight[];
}

const OT_MODEL = 1;
const OT_LIGHTSRC = 2;
const OT_SOUNDSRC = 3;
const OT_EFFECTSRC = 4;

class Reader {
    private view: DataView;
    public offs = 0;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public assertCanRead(n: number): void {
        if (this.offs + n > this.view.byteLength)
            throw new Error(`RSW: unexpected end of file (need ${n} bytes at ${this.offs})`);
    }

    public u8(): number { this.assertCanRead(1); const v = this.view.getUint8(this.offs); this.offs += 1; return v; }
    public i32(): number { this.assertCanRead(4); const v = this.view.getInt32(this.offs, true); this.offs += 4; return v; }
    public u32(): number { this.assertCanRead(4); const v = this.view.getUint32(this.offs, true); this.offs += 4; return v >>> 0; }
    public f32(): number { this.assertCanRead(4); const v = this.view.getFloat32(this.offs, true); this.offs += 4; return v; }

    public skip(n: number): void { this.assertCanRead(n); this.offs += n; }

    public vec3(): RswVec3 {
        return { x: this.f32(), y: this.f32(), z: this.f32() };
    }

    public magic(width: number): string {
        this.assertCanRead(width);
        const bytes = this.buffer.createTypedArray(Uint8Array, this.offs, width);
        this.offs += width;
        let end = bytes.indexOf(0);
        if (end < 0)
            end = width;
        return String.fromCharCode(...bytes.subarray(0, end));
    }

    public name(width: number): string {
        this.assertCanRead(width);
        const s = readString(this.buffer, this.offs, width, true, "euc-kr");
        this.offs += width;
        return s;
    }
}

export function computeSunDirections(longitudeDeg: number, latitudeDeg: number, lightDir: vec3, sunDir: vec3): void {
    const sx = Math.sin(latitudeDeg * MathConstants.DEG_TO_RAD), cx = Math.cos(latitudeDeg * MathConstants.DEG_TO_RAD);
    const sy = Math.sin(longitudeDeg * MathConstants.DEG_TO_RAD), cy = Math.cos(longitudeDeg * MathConstants.DEG_TO_RAD);
    lightDir[0] = -sx * sy;
    lightDir[1] = -cx;
    lightDir[2] = sx * cy;
    sunDir[0] = -lightDir[0];
    sunDir[1] = -lightDir[1];
    sunDir[2] = -lightDir[2];
}

export function parseRSW(buffer: ArrayBufferSlice): RswWorld {
    const r = new Reader(buffer);

    const magic = r.magic(4);
    if (magic !== "GRSW")
        throw new Error(`RSW: bad magic "${magic}"`);

    const major = r.u8();
    const minor = r.u8();

    if (major > 2 || (major === 2 && minor > 6))
        throw new Error(`RSW: unsupported version ${major}.${minor}`);

    const ge = (mj: number, mn: number): boolean =>
        (major === mj && minor >= mn) || major > mj;

    let buildNumber = 0;
    if (ge(2, 5)) {
        buildNumber = r.u32();
        r.u8();
    } else if (ge(2, 2)) {
        buildNumber = r.u8();
    }

    const iniFile = r.name(40);
    const gndFile = r.name(40);
    const gatFile = ge(1, 4) ? r.name(40) : "";
    const scrFile = r.name(40);

    let waterLevel = 0.0, waterType = 0, waveHeight = 1.0, waveSpeed = 2.0, wavePitch = 50.0;
    let waterAnimSpeed = 3;
    if (!ge(2, 6)) {
        waterLevel = ge(1, 3) ? r.f32() : 0.0;
        if (ge(1, 8)) {
            waterType = r.i32();
            waveHeight = r.f32();
            waveSpeed = r.f32();
            wavePitch = r.f32();
        }
        waterAnimSpeed = ge(1, 9) ? r.i32() : 3;
    }

    let longitude = 45, latitude = 45;
    let diffuse: RswVec3 = { x: 1, y: 1, z: 1 };
    let ambient: RswVec3 = { x: 0.3, y: 0.3, z: 0.3 };
    if (ge(1, 5)) {
        longitude = r.i32();
        latitude = r.i32();
        diffuse = r.vec3();
        ambient = r.vec3();
    }

    if (ge(1, 7)) r.f32();

    if (ge(1, 6)) {
        r.i32(); r.i32(); r.i32(); r.i32();
    }

    const count = r.i32();
    if (count < 0)
        throw new Error(`RSW: bad object count ${count}`);

    const models: RswModelPlacement[] = [];
    const effects: RswEffectSource[] = [];
    const lights: RswPointLight[] = [];
    for (let i = 0; i < count; i++) {
        const type = r.i32();
        switch (type) {
        case OT_MODEL: {
            let name = "", animType = 0, animSpeed = 1.0, blockType = 0;
            if (ge(1, 3)) {
                name = r.name(40);
                animType = r.i32();
                animSpeed = r.f32();
                blockType = r.i32();
                if (major === 2 && minor === 6 && buildNumber >= 162)
                    r.u8();
            }

            const modelName = r.name(80);
            const nodeName = r.name(80);
            const pos = r.vec3();
            const rot = r.vec3();
            const scale = r.vec3();
            models.push({ name, modelName, nodeName, pos, rot, scale, animType, animSpeed, blockType });
            break;
        }
        case OT_LIGHTSRC: {

            const lightName = r.name(80);
            const pos = r.vec3();
            const cr = r.f32(), cg = r.f32(), cb = r.f32();
            const range = r.f32();
            lights.push({ name: lightName, pos, color: [cr, cg, cb], range });
            break;
        }
        case OT_SOUNDSRC:

            if (major >= 2) r.skip(80 + 80 + 12 + 4 + 4 + 4 + 4 + 4);
            else            r.skip(80 + 80 + 12 + 4 + 4 + 4 + 4);
            break;
        case OT_EFFECTSRC: {

            const name = r.name(80);
            const pos = r.vec3();
            const type = r.i32();
            const emitSpeed = r.f32();
            const param: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
            effects.push({ name, pos, type, emitSpeed, param });
            break;
        }
        default:
            throw new Error(`RSW: unknown object type ${type} at index ${i}`);
        }
    }

    return {
        major, minor, iniFile, gndFile, gatFile, scrFile,
        waterLevel, waterType, waterAnimSpeed, waveHeight, waveSpeed, wavePitch,
        diffuse, ambient, longitude, latitude, models, effects, lights,
    };
}
