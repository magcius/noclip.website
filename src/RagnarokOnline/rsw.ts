
// Parser for Ragnarok Online's RSW world format (magic "GRSW"). Ties the .gnd
// ground and .gat attribute grid to global lighting/water plus a list of placed
// objects (models, lights, sounds, effects). All values little-endian; names are
// fixed-width CP949 (EUC-KR).

import ArrayBufferSlice from "../ArrayBufferSlice.js";

const eucKrDecoder = new TextDecoder("euc-kr");

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
    rot: RswVec3;        // Euler degrees
    scale: RswVec3;
    animType: number;
    animSpeed: number;
    blockType: number;
}

// OT_EFFECTSRC: `type` is the EF_* id, the engine re-emits every `emitSpeed`
// ticks. `param` are effect-specific (e.g. torch: param[0]=size, param[1]=anim speed).
export interface RswEffectSource {
    name: string;
    pos: RswVec3;
    type: number;
    emitSpeed: number;
    param: [number, number, number, number];
}

// OT_LIGHTSRC point light. Color is linear 0..1 RGB, range in world units.
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
        const bytes = this.buffer.createTypedArray(Uint8Array, this.offs, width);
        this.offs += width;
        let end = bytes.indexOf(0);
        if (end < 0)
            end = width;
        return eucKrDecoder.decode(bytes.subarray(0, end));
    }
}

// Builds the world's directional sun vector from the RSW longitude/latitude,
// matching the engine's row-vector composition: rotate (0,1,0) about X by
// latitude, then about Y by longitude. The terrain render frame negates Y
// (world_y = -height), so the returned vector is the render-frame direction.
export function computeLightDir(longitudeDeg: number, latitudeDeg: number): [number, number, number] {
    const deg = Math.PI / 180;
    const latRad = latitudeDeg * deg;
    const lonRad = longitudeDeg * deg;

    const cx = Math.cos(latRad), sx = Math.sin(latRad);
    let x = 0, y = cx, z = sx;

    const cy = Math.cos(lonRad), sy = Math.sin(lonRad);
    const rx = x * cy + z * sy;
    const ry = y;
    const rz = x * (-sy) + z * cy;

    return [rx, -ry, rz];
}

export function parseRSW(buffer: ArrayBufferSlice): RswWorld {
    const r = new Reader(buffer);

    const magic = r.magic(4);
    if (magic !== "GRSW")
        throw new Error(`RSW: bad magic "${magic}"`);

    const major = r.u8();
    const minor = r.u8();
    // Reference loader caps at 2.1; iRO ships through 2.6. v3+ rejected.
    if (major > 2 || (major === 2 && minor > 6))
        throw new Error(`RSW: unsupported version ${major}.${minor}`);

    const ge = (mj: number, mn: number): boolean =>
        (major === mj && minor >= mn) || major > mj;

    // 2.2 adds a u8 build number; 2.5 widens it to u32 and adds a render flag.
    let buildNumber = 0;
    if (ge(2, 5)) {
        buildNumber = r.u32();
        r.u8(); // render flag
    } else if (ge(2, 2)) {
        buildNumber = r.u8();
    }

    const iniFile = r.name(40);
    const gndFile = r.name(40);
    const gatFile = ge(1, 4) ? r.name(40) : "";
    const scrFile = r.name(40);

    // RSW 2.6 moved water-plane setup into GND 1.8/1.9. Defaults here; scenes.ts
    // prefers the GND water block when present. Decomp: World.cpp:248-273.
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

    if (ge(1, 7)) r.f32();  // shadow opacity

    if (ge(1, 6)) {
        r.i32(); r.i32(); r.i32(); r.i32();  // ground top/bottom/left/right
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
                    r.u8(); // model render/collision flag
            }
            // tmpActorInfo: modelName[80], nodeName[80], pos, rot, scale.
            const modelName = r.name(80);
            const nodeName = r.name(80);
            const pos = r.vec3();
            const rot = r.vec3();
            const scale = r.vec3();
            models.push({ name, modelName, nodeName, pos, rot, scale, animType, animSpeed, blockType });
            break;
        }
        case OT_LIGHTSRC: {
            // name[80], pos, rgb (linear 0..1), range.
            const lightName = r.name(80);
            const pos = r.vec3();
            const cr = r.f32(), cg = r.f32(), cb = r.f32();
            const range = r.f32();
            lights.push({ name: lightName, pos, color: [cr, cg, cb], range });
            break;
        }
        case OT_SOUNDSRC:
            // name[80], waveName[80], pos, vol, width, height, range, [cycle].
            // v1.x record omits the trailing cycle float.
            if (major >= 2) r.skip(80 + 80 + 12 + 4 + 4 + 4 + 4 + 4);
            else            r.skip(80 + 80 + 12 + 4 + 4 + 4 + 4);
            break;
        case OT_EFFECTSRC: {
            // name[80], pos, type, emitSpeed, param[4].
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
