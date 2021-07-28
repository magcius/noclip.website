import { DataStream } from "./util";

export const MaterialFlags = {
    // FLAG_00: 0x00, always 1
    // FLAG_01: 0x01,
    // FLAG_02: 0x02,
    // FLAG_03: 0x03,
    // FLAG_04: 0x04,
    // FLAG_05: 0x05,
    // FLAG_06: 0x06,
    // FLAG_07: 0x07, always 0
    // FLAG_08: 0x08,
    // FLAG_09: 0x09,
    // FLAG_0A: 0x0A,
    // FLAG_0B: 0x0B,
    // FLAG_0C: 0x0C,
    // FLAG_0D: 0x0D,
    // FLAG_0E: 0x0E,
    // FLAG_0F: 0x0F,
    // FLAG_10: 0x10,
    // FLAG_11: 0x11,
    // FLAG_12: 0x12,
    // FLAG_13: 0x13,
    // FLAG_14: 0x14,
    // FLAG_15: 0x15,
    // FLAG_16: 0x16,
    // FLAG_17: 0x17,
    // FLAG_18: 0x18,
    // FLAG_19: 0x19,
    // FLAG_1A: 0x1A,
    // FLAG_1B: 0x1B,
    // FLAG_1C: 0x1C, always 0
    // FLAG_1D: 0x1D, always 0
    // FLAG_1E: 0x1E, always 0
    // FLAG_1F: 0x1F, always 0
    FLAG_HIDDEN: 0x20,
    // FLAG_21: 0x21,
    // FLAG_22: 0x22,
    FLAG_BLENDCOLOR: 0x23,
    // FLAG_24: 0x24,
    FLAG_BLENDTEXTUREALPHA: 0x25,
    // FLAG_26: 0x26,
    FLAG_BLENDCOLORALPHA: 0x27,
    // FLAG_28: 0x28,
    // FLAG_29: 0x29,
    // FLAG_2A: 0x2A, always 0
    // FLAG_2B: 0x2B, always 0
    // FLAG_2C: 0x2C, always 0
    // FLAG_2D: 0x2D, always 0
    // FLAG_2E: 0x2E, always 0
    // FLAG_2F: 0x2F, always 0
    // FLAG_30: 0x30, always 0
    // FLAG_31: 0x31, always 0
    // FLAG_32: 0x32, always 0
    // FLAG_33: 0x33, always 0
    // FLAG_34: 0x34, always 0
    // FLAG_35: 0x35, always 0
    // FLAG_36: 0x36, always 0
    // FLAG_37: 0x37, always 0
    // FLAG_38: 0x38, always 0
    // FLAG_39: 0x39, always 0
    // FLAG_3A: 0x3A, always 0
    // FLAG_3B: 0x3B, always 0
    // FLAG_3C: 0x3C, always 0
    // FLAG_3D: 0x3D, always 0
    // FLAG_3E: 0x3E, always 0
    // FLAG_3F: 0x3F, always 0
};

export function getMaterialFlag(material: Material, flag: number): boolean {
    if (flag >= 32) {
        return (material.flags_b & (1 << (flag - 32))) != 0;
    }
    else {
        return (material.flags_a & (1 << flag)) != 0;
    }
}

export function readMaterial(data: DataStream) {
    return {
        color: data.readRGBA(),
        emission: data.readRGB(),
        unk1: data.readFloat32(),
        transform: data.readMat3(),
        rotation: data.readFloat32(),
        offset: data.readVec2(),
        scale: data.readVec2(),
        flags_a: data.readUint32(),
        flags_b: data.readUint32(),
        // unknown, but doesn't seem to matter.
        // 'unk2' is only '1' in one material
        unk2: data.readUint32(),
        unk3: data.readUint8(),
        texture_id: data.readInt32(),
        reflection_id: data.readInt32(),
    }
}

export type Material = ReturnType<typeof readMaterial>;