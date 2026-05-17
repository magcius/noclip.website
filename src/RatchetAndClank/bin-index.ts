import { DataViewExt } from "./DataViewExt";
import { truncateTrailing0xFF } from "./utils";

export type LevelCoreHeader = ReturnType<typeof readLevelCoreHeader>;
export const SIZEOF_LEVEL_CORE_HEADER = 0xbc;
export function readLevelCoreHeader(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_core.h#L27
    */

    return {
        gsRam: view.getInt32PairAs(0, "count", "offset"),
        tfrags: view.getInt32(0x8),
        occlusion: view.getInt32(0xc),
        sky: view.getInt32(0x10),
        collision: view.getInt32(0x14),
        mobyClasses: view.getInt32PairAs(0x18, "count", "offset"),
        tieClasses: view.getInt32PairAs(0x20, "count", "offset"),
        shrubClasses: view.getInt32PairAs(0x28, "count", "offset"),
        tfragTextures: view.getInt32PairAs(0x30, "count", "offset"),
        mobyTextures: view.getInt32PairAs(0x38, "count", "offset"),
        tieTextures: view.getInt32PairAs(0x40, "count", "offset"),
        shrubTextures: view.getInt32PairAs(0x48, "count", "offset"),
        partTextures: view.getInt32PairAs(0x50, "count", "offset"),
        fxTextures: view.getInt32PairAs(0x58, "count", "offset"),
        texturesBaseOffset: view.getInt32(0x60),
        partBankOffset: view.getInt32(0x64),
        fxBankOffset: view.getInt32(0x68),
        partDefsOffset: view.getInt32(0x6c),
        soundRemapOffset: view.getInt32(0x70),
        sceneViewSize: view.getInt32(0x7c),
        assetsCompressedSize: view.getInt32(0x88),
        assetsDecompressedSize: view.getInt32(0x8c),
        chromeMapTexture: view.getInt32(0x90),
        chromeMapPalette: view.getInt32(0x94),
        glassMapTexture: view.getInt32(0x98),
        glassMapPalette: view.getInt32(0x9c),
        heightmapOffset: view.getInt32(0xa4),
        occlusionOctOffset: view.getInt32(0xa8),
        mobyGsStashList: view.getInt32(0xac),
        occlusionRadOffset: view.getInt32(0xb0),
        mobySoundRemapOffset: view.getInt32(0xb4),
        occlusionRad2Offset: view.getInt32(0xb8),
    }
}

// for ties, mobys, and shrubs
export interface ClassEntry {
    offsetInCoreData: number,
    oClass: number,
    textures: number[],
}
export const SIZEOF_TIE_CLASS_ENTRY = 0x20;
export const SIZEOF_MOBY_CLASS_ENTRY = 0x20;
export const SIZEOF_SHRUB_CLASS_ENTRY = 0x30;
export function readClassEntry(view: DataViewExt): ClassEntry {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_core.h#L81-L104
    Tie and moby class entries are the same. Shrubs have an extra field for billboard info that we don't need.
    */

    return {
        offsetInCoreData: view.getInt32(0x0),
        oClass: view.getInt32(0x4),
        textures: truncateTrailing0xFF(view.getArrayOfNumbers(0x10, 16, Uint8Array)),
    };
}

export interface TextureEntry {
    dataOffset: number,
    width: number,
    height: number,
    type: number,
    palette: number,
    mipmap: number,
    pad: number,
}
export const SIZEOF_TEXTURE_ENTRY = 0x10;
export function readTextureEntry(view: DataViewExt): TextureEntry {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_textures.h#L37
    */

    return {
        dataOffset: view.getInt32(0x0),
        width: view.getInt16(0x4),
        height: view.getInt16(0x6),
        type: view.getInt16(0x8),
        palette: view.getInt16(0xa),
        mipmap: view.getInt16(0xc),
        pad: view.getInt16(0xe),
    };
}
