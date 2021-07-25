import { readTHeader } from "./archive";
import { DataStream } from "./util";

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