import { DataStream } from "./util";

export function readMaterial(data: DataStream) {
    return {
        color: data.readRGBA(),
        emission: data.readRGB(),
        unk2: data.readFloat32(),
        transform: data.readMat3(),
        rotation: data.readFloat32(),
        offset: data.readVec2(),
        scale: data.readVec2(),
        unk4: data.readJunk(13),
        texture_id: data.readInt32(),
        reflection_id: data.readInt32(),
    }
}

export type Material = ReturnType<typeof readMaterial>;