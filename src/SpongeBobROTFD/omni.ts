import { DataStream } from "./util";
import { readTHeader } from "./archive";

export function readOmni(data: DataStream) {
    return {
        header: readTHeader(data),
        color: data.readRGB(),
        junk: data.readFloat32(),
        attenuation: data.readVec2(),
    };
}

export type TotemOmni = ReturnType<typeof readOmni>;