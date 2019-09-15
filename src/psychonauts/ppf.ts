
import ArrayBufferSlice from "../ArrayBufferSlice";
import * as PLB from './plb';
import { assert } from "../util";
import { DataStream } from "./DataStream";

export function normalizeTextureName(textureName: string): string {
    textureName = textureName.toLowerCase().replace(/\\/g, '/');
    textureName = textureName.replace(/^c:\/psychonauts\/resource\//, '');
    textureName = textureName.replace(/^workresource\//, '');
    textureName = textureName.replace(/\.(tga|dds)$/, '');
    return textureName;
}

export interface PPAK_Texture {
    name: string;
    type: TextureType;
    format: TextureFormat;
    width: number;
    height: number;
    mipData: ArrayBufferSlice[];
}

export interface PPAK {
    textures: PPAK_Texture[];
    mainScene: PLB.EScene | null;
}

/*
 * Texture formats:
 * fmt | format  internalformat  type   | format          internalformat      type
 * ----|--------------------------------|--------------------------------------------------------------
 *  00 | 0x80E1  0x8058          0x8367 | BGRA            RGBA8               UNSIGNED_INT_8_8_8_8_REV
 *  01 | 0x80E1  0x8051          0x8367 | BGRA            RGB8                UNSIGNED_INT_8_8_8_8_REV
 *  02 | 0x1908  0x8056          0x8033 | RGBA            RGBA4               UNSIGNED_SHORT_4_4_4_4
 *  03 | 0x1908  0x8057          0x8034 | RGBA            RGB5A1              UNSIGNED_SHORT_5_5_5_1
 *  04 | 0x1907  0x8050          0x8034 | RGB             RGB5                UNSIGNED_SHORT_5_5_5_1
 *  05 | 0x1907  0x8050          0x8363 | RGB             RGB5                UNSIGNED_SHORT_5_6_5
 *  06 | 0x1906  0x803C          0x1401 | ALPHA           ALPHA8              UNSIGNED_BYTE
 *  07 | 0x1909  0x8040          0x1401 | LUMINANCE       LUMINANCE8          UNSIGNED_BYTE
 *  08 | 0x1909  0x8040          0x1401 | LUMINANCE       LUMINANCE8          UNSIGNED_BYTE
 *  09 | 0x83F1  0x83F1          0x1401 | DXT1            DXT1                UNSIGNED_BYTE
 *  10 | 0x83F2  0x83F2          0x1401 | DXT3            DXT3                UNSIGNED_BYTE
 *  11 | 0x83F3  0x83F3          0x1401 | DXT5            DXT5                UNSIGNED_BYTE
 *  12 | 0x190A  0x8045          0x1401 | LUMINANCE_ALPHA LUMINANCE8_ALPHA8   UNSIGNED_BYTE
 *  13 | 0x190A  0x8048          0x1403 | LUMINANCE_ALPHA LUMINANCE16_ALPHA16 UNSIGNED_SHORT
*/

export const enum TextureFormat {
    B8G8R8A8,
    B8G8R8X8,
    R4G4B4A4,
    R5G5B5A1,
    R5G5B5X1,
    R5G6B5,
    A8,
    L8,
    L8_2, // Why twice?
    DXT1,
    DXT3,
    DXT5,
    L8A8,
    L16A16,
}

export function getTextureFormatName(fmt: TextureFormat): string {
    switch (fmt) {
    case TextureFormat.B8G8R8A8: return "B8G8R8A8";
    case TextureFormat.B8G8R8X8: return "B8G8R8X8";
    case TextureFormat.R4G4B4A4: return "R4G4B4A4";
    case TextureFormat.R5G5B5A1: return "R5G5B5A1";
    case TextureFormat.R5G5B5X1: return "R5G5B5X1";
    case TextureFormat.R5G6B5: return "R5G6B5";
    case TextureFormat.A8: return "A8";
    case TextureFormat.L8: return "L8";
    case TextureFormat.L8_2: return "L8_2";
    case TextureFormat.DXT1: return "DXT1";
    case TextureFormat.DXT3: return "DXT3";
    case TextureFormat.DXT5: return "DXT5";
    case TextureFormat.L8A8: return "L8A8";
    case TextureFormat.L16A16: return "L16A16";
    }
}

function getTextureFormatGetBytesPerPixel(fmt: TextureFormat): number {
    switch (fmt) {
    case TextureFormat.B8G8R8A8:
    case TextureFormat.B8G8R8X8:
    case TextureFormat.L16A16:
        return 4;
    case TextureFormat.R4G4B4A4:
    case TextureFormat.R5G5B5A1:
    case TextureFormat.R5G5B5X1:
    case TextureFormat.R5G6B5:
    case TextureFormat.L8A8:
        return 2;
    case TextureFormat.A8:
    case TextureFormat.L8:
        return 1;
    default:
        throw "whoops";
    }
}

function calcTextureByteSize(fmt: TextureFormat, width: number, height: number): number {
    height = Math.max(height, 4);
    width = Math.max(width, 4);
    switch (fmt) {
    case TextureFormat.DXT1:
        return (width * height) >>> 1;
    case TextureFormat.DXT3:
    case TextureFormat.DXT5:
        return width * height;
    default:
        return getTextureFormatGetBytesPerPixel(fmt) * width * height;
    }
}

export const enum TextureType {
    NORMAL       = 0,
    CUBEMAP      = 1,
    VOLUME_MAP   = 2,
    DEPTH_BUFFER = 3,
}

export function parsePPAKTexture(buffer: ArrayBufferSlice): PPAK_Texture {
    const stream = new DataStream(buffer);
    stream.offs = 0x28;

    const namePtr = stream.view.getUint32(0x0C, true);
    let name: string = '';
    if (namePtr) {
        name = stream.readStringStream_2b();
    }
    name = normalizeTextureName(name);

    const texAnimInfoPtr = stream.view.getUint32(0x10, true);
    let numFrames: number = 1;
    if (texAnimInfoPtr) {
        numFrames = stream.readUint32();
        stream.offs += 0x18;
    }

    const a0 = stream.readUint32();
    const format: TextureFormat = stream.readUint32();
    const type: TextureType = stream.readUint32();
    const v30 = stream.readUint32();
    const width = stream.readUint32();
    const height = stream.readUint32();
    const numMips = stream.readUint32();
    stream.offs += 0x10;

    const mipData: ArrayBufferSlice[] = [];
    let mipWidth = width, mipHeight = height;
    for (let i = 0; i < numMips; i++) {
        const mipByteSize = calcTextureByteSize(format, mipWidth, mipHeight);
        mipData.push(stream.readSlice(mipByteSize));
        if (mipWidth > 1) mipWidth >>>= 1;
        if (mipHeight > 1) mipHeight >>>= 1;
    }

    return { name, type, format, width, height, mipData };
}

function EGameTextureManager_ReadPackFileTextures(stream: DataStream, textures: PPAK_Texture[], textureCount: number) {
    for (let i = 0; i < textureCount; i++) {
        const magic = stream.readString(0x04);
        assert(magic === ' XT1');

        const size = stream.readUint32();
        textures.push(parsePPAKTexture(stream.readSlice(size)));
    }
}

function EGameTextureManager_ReadPackFile(stream: DataStream): PPAK_Texture[] {
    let marker = stream.readUint16();
    let v9 = 0;

    if (marker === 0xFDFD) {
        v9 = stream.readUint16();
        marker = stream.readUint16();
    }

    const textures: PPAK_Texture[] = [];
    assert(v9 === 0x01);

    while (marker === 0xFFFF) {
        const language = stream.readUint16();
        const size = stream.readUint32();

        // English, I believe.
        if (language === 0x00) {
            const textureCount = stream.readUint16();
            EGameTextureManager_ReadPackFileTextures(stream, textures, textureCount);
        } else {
            stream.offs += size;
        }

        marker = stream.readUint16();
    }

    assert(marker != 0xFFFF);
    const textureCount = marker;
    EGameTextureManager_ReadPackFileTextures(stream, textures, textureCount);
    return textures;
}

function EScriptVM_ReadPackFile(stream: DataStream): void {
    let scriptCount = stream.readUint16();
    let v22 = 0;

    if (scriptCount === 0xFCFC) {
        v22 = stream.readUint16();
        scriptCount = stream.readUint16();
    }

    for (let i = 0; i < scriptCount; i++) {
        const name = stream.readStringStream_2b();
        const scriptSize = stream.readUint32();
        stream.offs += scriptSize;
    }

    const scriptCount2 = stream.readUint16();
    for (let i = 0; i < scriptCount2; i++) {
        if (v22) {
            const name = stream.readStringStream_2b();
        }

        const scriptSize = stream.readUint32();
        stream.offs += scriptSize;
    }
}

export function parse(buffer: ArrayBufferSlice, hasScene: boolean): PPAK {
    const stream = new DataStream(buffer);

    assert(stream.readString(0x04) === 'PPAK');
    const textures = EGameTextureManager_ReadPackFile(stream);
    assert(stream.readString(0x04) === 'MPAK');
    const meshCount = stream.readUint16();

    for (let i = 0; i < meshCount; i++) {
        const name = stream.readStringStream_2b();
        const v9 = stream.readUint16();
        const size = stream.readUint32();
        const slice = stream.readSlice(size);
        // mesh.push(PLB.parse(slice, name));
    }

    let mainScene: PLB.EScene | null = null;
    if (hasScene) {
        EScriptVM_ReadPackFile(stream);

        // Rest of the stream is the main level file
        const mainSceneSlice = stream.buffer.slice(stream.offs);
        mainScene = PLB.parse(mainSceneSlice, 'MainScene');
    }

    return { textures, mainScene };
}
