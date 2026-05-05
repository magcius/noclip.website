import { decodeTexture, TextureFormat } from "../Common/CTR/pica_texture";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { DreamDropCTRT } from "./bin";
import { LuxTexture } from "./lux";

export enum CTRTFormat {
    RGBA_8888,
    RGB_888,
    RGBA_5551,
    RGB_565,
    RGBA_4444, // unused
    LA8,
    HILO8, // unused
    L8,
    A8,
    LA4, // unused
    L4, // unused
    A4, // unused
    ETC1,
    ETC1A4
}

export class CTRTexture extends LuxTexture {
    constructor(device: GfxDevice, name: string, width: number, height: number, data: Uint8Array, public format: CTRTFormat) {
        super(device, name, width, height, data);
    }
}

/**
 * Decodes CTR texture for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export function decodeDreamDropCTRT(ctrt: DreamDropCTRT): Uint8Array {
    switch (ctrt.format) {
        case CTRTFormat.RGBA_8888:
            return decodeTexture(TextureFormat.RGBA8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.RGB_888:
            return decodeTexture(TextureFormat.RGB8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.RGBA_5551:
            return decodeTexture(TextureFormat.RGBA5551, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.RGB_565:
            return decodeTexture(TextureFormat.RGB565, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.LA8:
            return decodeTexture(TextureFormat.LA8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.L8:
            return decodeTexture(TextureFormat.L8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.A8:
            return decodeTexture(TextureFormat.A8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.ETC1:
            return decodeTexture(TextureFormat.ETC1, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.ETC1A4:
            return decodeTexture(TextureFormat.ETC1A4, ctrt.width, ctrt.height, ctrt.data);
        default:
            console.warn("Unimplemented texture format", ctrt.format);
            return new Uint8Array(0);
    }
}

