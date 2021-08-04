import { DataStream } from "./util";
import { readTHeader } from "./archive";

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