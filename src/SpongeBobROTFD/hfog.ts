import { readTHeader } from "./archive";
import { DataStream } from "./util";

export function readHFog(data: DataStream) {
    return {
        header: readTHeader(data),
        color: data.readRGB(),
        unk0: data.readJunk(4),
        translation: data.readVec3(),
        scale: data.readVec3(),
        rotation: data.readQuat(),
        transform1: data.readMat4(),
        transform2: data.readMat4(),
    }
}

export type TotemHFog = ReturnType<typeof readHFog>;