import { vec2, vec3 } from "gl-matrix";
import { nArray } from "../../util.js";
import { DataStream, readTHeader } from "../util.js";

function readSurfaceSingle(data: DataStream) {
    return {
        texcoords: data.readArrayStatic(data.readVec2, 4),
        unk2: data.readArrayStatic(data.readFloat32, 12),
        normal_indices: data.readArrayStatic(data.readUint16, 4),
        curve_indices: data.readArrayStatic(data.readUint16, 4),
        curve_order: data.readUint32(),
        unk3: data.readJunk(32),
        index_n6: data.readUint32(),
        materialanim_id: data.readInt32(),
    }
}

function readCurve(data: DataStream) {
    return {
        p1: data.readUint16(),
        p2: data.readUint16(),
        p1_t: data.readUint16(),
        p2_t: data.readUint16(),
    }
}

export function readSurface(data: DataStream) {
    return {
        header: readTHeader(data),
        vertices: data.readArrayDynamic(data.readUint32, data.readVec3),
        unk0: data.readArrayDynamic(data.readUint32, (data) => data.readJunk(24)),
        unk1: data.readArrayDynamic(data.readUint32, (data) => data.readJunk(24)),
        surfaces: data.readArrayDynamic(data.readUint32, readSurfaceSingle),
        curves: data.readArrayDynamic(data.readUint32, readCurve),
        normals: data.readArrayDynamic(data.readUint32, data.readVec3),
        // rest doesn't matter (for now?)
    }
}

export type TotemSurfaceObject = ReturnType<typeof readSurface>;
export type TotemSurface = TotemSurfaceObject["surfaces"][0];
export type TotemCurve = TotemSurfaceObject["curves"][0];

export function eval_bezier_vec3(out: vec3, points: vec3[], t: number) {
    let b0 = (1.0 - t) * (1.0 - t) * (1.0 - t);
    let b1 = 3.0 * t * (1.0 - t) * (1.0 - t);
    let b2 = 3.0 * t * t * (1.0 - t);
    let b3 = t * t * t;
    vec3.scale(out, points[0], b0);
    vec3.scaleAndAdd(out, out, points[1], b1);
    vec3.scaleAndAdd(out, out, points[2], b2);
    vec3.scaleAndAdd(out, out, points[3], b3);
}

export function precompute_surface_vec3(points: vec3[][], usteps: number, vsteps: number): vec3[][] {
    let out = nArray(usteps+1, () => nArray(vsteps+1, () => vec3.create()))
    for (let iu = 0; iu <= usteps; iu++) {
        const u = iu / usteps;
        let pu = nArray(4, () => vec3.create());
        eval_bezier_vec3(pu[0], points[0], u);
        eval_bezier_vec3(pu[1], points[1], u);
        eval_bezier_vec3(pu[2], points[2], u);
        eval_bezier_vec3(pu[3], points[3], u);
        for (let iv = 0; iv <= vsteps; iv++) {
            const v = iv / vsteps;
            eval_bezier_vec3(out[iu][iv], pu, v);
        }
    }
    return out;
}

export function precompute_lerp_vec2(points: vec2[], usteps: number, vsteps: number): vec2[][] {
    let out = nArray(usteps+1, () => nArray(vsteps+1, () => vec2.create()))
    for (let iu = 0; iu <= usteps; iu++) {
        const u = iu / usteps;
        const a = vec2.create();
        const b = vec2.create();
        vec2.lerp(a, points[0], points[1], u);
        vec2.lerp(b, points[3], points[2], u);
        for (let iv = 0; iv <= vsteps; iv++) {
            const v = iv / vsteps;
            vec2.lerp(out[iu][iv], a, b, v);
        }
    }
    return out;
}

export function precompute_lerp_vec3(points: vec3[], usteps: number, vsteps: number): vec3[][] {
    let out = nArray(usteps+1, () => nArray(vsteps+1, () => vec3.create()))
    for (let iu = 0; iu <= usteps; iu++) {
        const u = iu / usteps;
        const a = vec3.create();
        const b = vec3.create();
        vec3.lerp(a, points[0], points[1], u);
        vec3.lerp(b, points[3], points[2], u);
        for (let iv = 0; iv <= vsteps; iv++) {
            const v = iv / vsteps;
            vec3.lerp(out[iu][iv], a, b, v);
        }
    }
    return out;
}