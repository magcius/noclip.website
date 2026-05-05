import { decodeTexture, TextureFormat } from "../Common/CTR/pica_texture";
import { DreamDropCTRT } from "./bin";

/**
 * All possible texture formats for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export enum DreamDropTextureFormat {
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

/**
 * Decodes CTR texture for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export function decodeDreamDropCTRT(ctrt: DreamDropCTRT): Uint8Array {
    switch (ctrt.format) {
        case DreamDropTextureFormat.RGBA_8888:
            return decodeTexture(TextureFormat.RGBA8, ctrt.width, ctrt.height, ctrt.data);
        case DreamDropTextureFormat.RGB_888:
            return decodeTexture(TextureFormat.RGB8, ctrt.width, ctrt.height, ctrt.data);
        case DreamDropTextureFormat.RGBA_5551:
            return decodeTexture(TextureFormat.RGBA5551, ctrt.width, ctrt.height, ctrt.data);
        case DreamDropTextureFormat.RGB_565:
            return decodeTexture(TextureFormat.RGB565, ctrt.width, ctrt.height, ctrt.data);
        case DreamDropTextureFormat.LA8:
            return decodeTexture(TextureFormat.LA8, ctrt.width, ctrt.height, ctrt.data);
        case DreamDropTextureFormat.L8:
            return decodeTexture(TextureFormat.L8, ctrt.width, ctrt.height, ctrt.data);
        case DreamDropTextureFormat.A8:
            return decodeTexture(TextureFormat.A8, ctrt.width, ctrt.height, ctrt.data);
        case DreamDropTextureFormat.ETC1:
            return decodeTexture(TextureFormat.ETC1, ctrt.width, ctrt.height, ctrt.data);
        case DreamDropTextureFormat.ETC1A4:
            return decodeTexture(TextureFormat.ETC1A4, ctrt.width, ctrt.height, ctrt.data);
        default:
            console.warn("Unimplemented texture format", ctrt.format);
            return new Uint8Array(0);
    }
}

