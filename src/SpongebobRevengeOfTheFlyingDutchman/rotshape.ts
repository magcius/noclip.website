import { readTHeader } from "./archive";
import { DataStream } from "./util";

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