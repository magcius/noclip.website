import { readTHeader } from "./archive";
import { DataStream } from "./util";

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