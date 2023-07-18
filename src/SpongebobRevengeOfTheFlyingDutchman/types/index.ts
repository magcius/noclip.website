import { DataStream, readTHeader } from "../util.js";

export * from "./bitmap.js";
export * from "./material.js";
export * from "./mesh.js";
export * from "./node.js";
export * from "./surface.js";

export function readHFog(data: DataStream) {
    return {
        header: readTHeader(data),
        color: data.readRGB(),
        unk0: data.readJunk(4),
        translation: data.readVec3(),
        scale: data.readVec3(),
        rotation: data.readQuat(),
        local_transform: data.readMat4(),
        global_transform: data.readMat4(),
    }
}

export type TotemHFog = ReturnType<typeof readHFog>;

export function readLight(data: DataStream) {
    return {
        header: readTHeader(data),
        unk1: data.readArrayStatic(data.readFloat32, 4),
        color1: data.readRGB(),
        direction: data.readVec3(),
        color2: data.readRGB(),
        junk: data.readJunk(4),
        unk2: data.readVec3(),
    }
}

export type TotemLight = ReturnType<typeof readLight>;

export function readOmni(data: DataStream) {
    return {
        header: readTHeader(data),
        color: data.readRGB(),
        junk: data.readFloat32(),
        attenuation: data.readVec2(),
    };
}

export type TotemOmni = ReturnType<typeof readOmni>;

function readFloat4(data: DataStream): Float32Array {
    return data.readFloat32Array(4);
}

function readFloat9(data: DataStream): Float32Array {
    return data.readFloat32Array(9);
}

function readLodTransform(data: DataStream) {
    return {
        transform: data.readMat4(),
        junk: data.readJunk(16),
    }
}

function readUnkStruct(data: DataStream) {
    return {
        unk1: data.readFloat32Array(4),
        unk2: data.readUint32(),
    }
}

function readNever(data: DataStream) {
    console.log("Attempt to read unknown value in LOD");
}

export function readLod(data: DataStream) {
    return {
        header: readTHeader(data),
        unk1: data.readOptional(readFloat4),
        unk2: data.readOptional(readFloat4),
        unk3: data.readOptional(readFloat9),
        unk4: data.readOptional(readLodTransform),
        unk5: data.readOptional(readFloat4),
        unk6: data.readOptional(readNever),
        unk7: data.readOptional(readLodTransform),
        unk8: data.readOptional(readFloat4),
        unk9: data.readOptional(readNever),
        unk10: data.readOptional(readLodTransform),
        unk11: data.readOptional(readFloat4),
        unk12: data.readOptional(readNever),
        unk13: data.readOptional(readNever),
        unk14: data.readOptional(readFloat4),
        unk15: data.readOptional(readUnkStruct),
        unk16: data.readOptional(readFloat4),
        unk17: data.readOptional(readFloat4),
        unk18: data.readFloat32Array(2),
        unk19: data.readUint16(),
        meshes: data.readArrayDynamic(data.readUint32, data.readInt32),
        // rest doesn't matter
        // anims: LodAnimEntry[],
        // sounds: LodSoundEntry[],
    }
}

export type TotemLod = ReturnType<typeof readLod>;

export function readRotshape(data: DataStream) {
    return {
        header: readTHeader(data),
        unk0: data.readUint32(), // 1
        offset: data.readVec3(),
        unk1: data.readUint32(), // 1
        unk1value: data.readFloat32(), // 0.0
        unk2: data.readUint32(), // 2
        size: data.readArrayStatic(data.readVec3, 2),
        unk3: data.readUint32(), // 4
        texcoords: data.readArrayStatic(data.readVec2, 4),
        unk4: data.readUint32(), // 1
        materialanim_id: data.readInt32(),
        billboard_mode: data.readUint16(),
    }
}

export enum BillboardMode {
    Y = 0,
    Full = 1,
}

export type TotemRotshape = ReturnType<typeof readRotshape>;

export function readSkin(data: DataStream) {
    return {
        header: readTHeader(data),
        meshes: data.readArrayDynamic(data.readUint32, data.readInt32),
        // rest doesn't matter (for now)
        // zero: 0
        // sections: SkinSection[] - actual skinning info
        // anim_entries?: AnimEntry[]
        // zero2?: 0
        // unknown_entries: UnknownEntry[]
    }
}

export type TotemSkin = ReturnType<typeof readSkin>;

export function readWarp(data: DataStream) {
    return {
        size: data.readFloat32(),
        material_ids: data.readArrayStatic(data.readInt32, 6),
        vertices: data.readArrayStatic(data.readVec3, 8),
        texcoords: data.readArrayStatic(data.readVec2, 4),
    }
}

export type TotemWarp = ReturnType<typeof readWarp>;

const _warp_faces = [ 
	[4, 7, 5, 6], // +Y (top)
	[1, 2, 0, 3], // -Y (bottom)
	[5, 6, 1, 2], // -Z (front)
	[4, 5, 0, 1], // -X (left)
	[6, 7, 2, 3], // +X (right)
	[7, 4, 3, 0], // +Z (back)
];

const _warp_normals = [
    [ 0, -1,  0],
    [ 0,  1,  0],
    [ 0,  0,  1],
    [ 1,  0,  0],
    [-1,  0,  0],
    [ 0,  0, -1],
];

export function *iterWarpSkybox(warp: TotemWarp) {
    for (let i = 0; i < 6; i++) {
        yield {
            normal: _warp_normals[i],
            positions: _warp_faces[i].map(j => warp.vertices[j]),
            texcoords: warp.texcoords,
            material: warp.material_ids[i],
        }
    }
}