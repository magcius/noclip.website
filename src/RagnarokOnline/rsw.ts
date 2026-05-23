
// Parser for Ragnarok Online's RSW world format (magic "GRSW").
//
// An RSW ties a map together: it names the .gnd ground and .gat attribute grid,
// holds the global lighting/water parameters, and lists every object placed in
// the world. We only need the model placements for static-prop rendering, but
// the other object records (lights, sounds, effects) must still be skipped by
// the exact byte size their version uses so the cursor stays aligned.
//
// All multi-byte values are little-endian. Texture/model/node names are CP949
// (EUC-KR) byte strings, decoded with the same 'euc-kr' TextDecoder the GND uses
// so disk and fetch paths agree.

import ArrayBufferSlice from "../ArrayBufferSlice.js";

const eucKrDecoder = new TextDecoder("euc-kr");

export interface RswVec3 {
    x: number;
    y: number;
    z: number;
}

export interface RswModelPlacement {
    name: string;       // CP949 instance label
    modelName: string;  // CP949 .rsm path, relative to the model root
    nodeName: string;   // CP949 root node name
    pos: RswVec3;
    rot: RswVec3;        // Euler degrees
    scale: RswVec3;
    animType: number;
    animSpeed: number;
    blockType: number;
}

// A world-placed ambient effect source (OT_EFFECTSRC). `type` is RO's built-in
// effect id (the same EF_* enum LaunchEffect takes); the engine spawns a looping
// emitter of that effect at `pos`, re-emitting every `emitSpeed` ticks. `param`
// are effect-specific (e.g. torch passes param[0]=size, param[1]=anim speed).
export interface RswEffectSource {
    name: string;       // CP949 instance label
    pos: RswVec3;
    type: number;       // EF_* effect id
    emitSpeed: number;
    param: [number, number, number, number];
}

// A world-placed point light (OT_LIGHTSRC). Indoor maps (towns/dungeons) seed
// dozens to hundreds of these at torches, lamps, candelabras, etc. — they pair
// with the torch/firefly effect sources and make dim baked areas glow under the
// fixture. Color is linear 0..1 RGB, range is in world units.
export interface RswPointLight {
    name: string;       // CP949 instance label
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

// Object type tags from the world resource (OT_VIRTUAL = 0).
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

    // Reads a fixed-width CP949 name field, trimmed at the first NUL.
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
// exactly as the engine does: take the up vector (0,1,0), rotate it about X by
// the latitude, then about Y by the longitude (row-vector composition, so the X
// rotation is applied first). The result is the direction light travels toward
// the surface; the shader dots it against the surface normal.
//
// The terrain renderer's world is RO's frame with Y negated (height -> -height),
// so the returned vector is the render-frame direction (Y flipped) ready to dot
// against the render-frame normals the meshes carry.
export function computeLightDir(longitudeDeg: number, latitudeDeg: number): [number, number, number] {
    const deg = Math.PI / 180;
    const latRad = latitudeDeg * deg;
    const lonRad = longitudeDeg * deg;

    // Row-vector v' = v * (Xrot * Yrot), v = (0,1,0).
    // After X rotation about latitude: (0, cos(lat), sin(lat)) in the engine's
    // row-vector X-rotation (matches matrix::MakeXRotation).
    const cx = Math.cos(latRad), sx = Math.sin(latRad);
    // X-rotation row-vector form used by the engine:
    //   y' = y*cx + z*(-sx? ) ...  We replicate matrix::MakeXRotation directly:
    //   [1   0    0 ]
    //   [0   cx   sx]
    //   [0  -sx   cx]
    // v=(0,1,0) -> (0, cx, sx).
    let x = 0, y = cx, z = sx;

    // Y-rotation appended (AppendYRotation), row-vector matrix::MakeYRotation:
    //   [ cy  0  -sy]
    //   [ 0   1   0 ]
    //   [ sy  0   cy]
    const cy = Math.cos(lonRad), sy = Math.sin(lonRad);
    const rx = x * cy + z * sy;
    const ry = y;
    const rz = x * (-sy) + z * cy;

    // RO frame -> render frame: negate Y (the terrain uses world_y = -height).
    return [rx, -ry, rz];
}

export function parseRSW(buffer: ArrayBufferSlice): RswWorld {
    const r = new Reader(buffer);

    const magic = r.magic(4);
    if (magic !== "GRSW")
        throw new Error(`RSW: bad magic "${magic}"`);

    const major = r.u8();
    const minor = r.u8();
    // Version gate: the reference loader caps at 2.1; iRO's modern content ships
    // RSWs through 2.6. We consume the 2.2/2.5 header changes, the 2.6 water
    // relocation, and the 2.6.162+ model-record byte below. v3+ is still
    // hard-rejected until its layout is known.
    if (major > 2 || (major === 2 && minor > 6))
        throw new Error(`RSW: unsupported version ${major}.${minor}`);

    const ge = (mj: number, mn: number): boolean =>
        (major === mj && minor >= mn) || major > mj;

    // 2.2 adds a build byte after the major/minor pair. 2.5 widens that build
    // number to uint32 and follows it with a one-byte render flag.
    let buildNumber = 0;
    if (ge(2, 5)) {
        // u32: a build number with bit 31 set would otherwise go negative and
        // silently bypass the >= 162 gate on the 2.6 model record below.
        buildNumber = r.u32();
        r.u8(); // unknown render flag
    } else if (ge(2, 2)) {
        buildNumber = r.u8();
    }

    const iniFile = r.name(40);
    const gndFile = r.name(40);
    const gatFile = ge(1, 4) ? r.name(40) : "";  // .gat name, v1.4+
    const scrFile = r.name(40);

    // RSW 2.6 moved water-plane setup into GND 1.8/1.9. Keep sane defaults
    // here; scenes.ts prefers the GND water block when present. Empirical:
    // all 67 v2.6 RSWs in the corpus parse aligned with the skip; keeping the
    // legacy bytes misaligns 63/67. Decomp: World.cpp:248-273.
    let waterLevel = 0.0, waterType = 0, waveHeight = 1.0, waveSpeed = 2.0, wavePitch = 50.0;
    let waterAnimSpeed = 3;
    if (!ge(2, 6)) {
        waterLevel = ge(1, 3) ? r.f32() : 0.0;
        // World.cpp:252 only reads waterType (and the wave triplet) for verMinor>=8.
        // v1.3-1.7 keeps the defaults; no extra i32 is on disk.
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
                    r.u8(); // unknown model render/collision flag
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
            // name[80], pos, rgb (3 floats, linear 0..1), range (float).
            const lightName = r.name(80);
            const pos = r.vec3();
            const cr = r.f32(), cg = r.f32(), cb = r.f32();
            const range = r.f32();
            lights.push({ name: lightName, pos, color: [cr, cg, cb], range });
            break;
        }
        case OT_SOUNDSRC:
            // name[80], waveName[80], pos, vol, width, height, range, [cycle].
            // The v1.x record omits the trailing cycle float (4 bytes shorter).
            if (major >= 2) r.skip(80 + 80 + 12 + 4 + 4 + 4 + 4 + 4);
            else            r.skip(80 + 80 + 12 + 4 + 4 + 4 + 4);
            break;
        case OT_EFFECTSRC: {
            // name[80], pos, type (int), emitSpeed (float), param[4] (float).
            const name = r.name(80);
            const pos = r.vec3();
            const type = r.i32();
            const emitSpeed = r.f32();
            const param: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
            effects.push({ name, pos, type, emitSpeed, param });
            break;
        }
        default:
            // Unknown object tag: its size is unknown, so the cursor would
            // desync. Stop here rather than misalign.
            throw new Error(`RSW: unknown object type ${type} at index ${i}`);
        }
    }

    return {
        major, minor, iniFile, gndFile, gatFile, scrFile,
        waterLevel, waterType, waterAnimSpeed, waveHeight, waveSpeed, wavePitch,
        diffuse, ambient, longitude, latitude, models, effects, lights,
    };
}
