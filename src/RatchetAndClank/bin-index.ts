import { DataViewExt } from "./DataViewExt";
import { truncateTrailing0xFF } from "./utils";

export interface LevelCoreHeader {
    titleLevelData_Rac1: {
        gsRam: number,
        coreData: number,
        coreDataSize: number,
        scene: number,
        logo: number,
    } | null,
    gsRam: { count: number, offset: number },
    tfrags: number,
    occlusion: number,
    sky: number,
    collision: number,
    mobyClasses: { count: number, offset: number },
    tieClasses: { count: number, offset: number },
    shrubClasses: { count: number, offset: number },
    tfragTextures: { count: number, offset: number },
    mobyTextures: { count: number, offset: number },
    tieTextures: { count: number, offset: number },
    shrubTextures: { count: number, offset: number },
    partTextures: { count: number, offset: number },
    fxTextures: { count: number, offset: number },
    texturesBaseOffset: number,
    partBankOffset: number,
    fxBankOffset: number,
    partDefsOffset: number,
    soundRemapOffset: number,
    ratchetSequencesOrLightCuboidOffset: number,
    sceneViewSize: number,
    gadgetCountOrUnknown: number,
    gadgetOffsetOrMobyStashCount: number,
    assetsCompressedSize: number,
    assetsDecompressedSize: number,
    chromeMapTexture: number,
    chromeMapPalette: number,
    glassMapTexture: number,
    glassMapPalette: number,
    heightmapOffset: number,
    occlusionOctOffset: number,
    mobyGsStashList: number,
    occlusionRadOffset: number,
    mobySoundRemapOffset: number,
    occlusionRad2Offset: number,
}
export const SIZEOF_LEVEL_CORE_HEADER = 0xbc;
export function readLevelCoreHeader(view: DataViewExt): LevelCoreHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_core.h#L27
    */

    return {
        titleLevelData_Rac1: null,
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
        ratchetSequencesOrLightCuboidOffset: view.getInt32(0x74), // rac1: ratchet sequences, rac234: light cuboids
        sceneViewSize: view.getInt32(0x7c),
        gadgetCountOrUnknown: view.getInt32(0x80), // rac1: gadget count, rac234: unknown
        gadgetOffsetOrMobyStashCount: view.getInt32(0x84), // rac1: gadget offset, rac234: moby stash count
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

export function readTitleHeader(view: DataViewExt): LevelCoreHeader {
    return {
        titleLevelData_Rac1: {
            gsRam: view.getInt32(0x0),
            coreData: view.getInt32(0x4),
            coreDataSize: view.getInt32(0x7c),
            scene: view.getInt32(0x80),
            logo: view.getInt32(0x84),
        },
        gsRam: view.getInt32PairAs(0x8, "count", "offset"),
        tfrags: view.getInt32(0x10),
        occlusion: 0,
        sky: view.getInt32(0x14),
        collision: 0,
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
        soundRemapOffset: 0,
        ratchetSequencesOrLightCuboidOffset: 0,
        sceneViewSize: 0,
        gadgetCountOrUnknown: 0,
        gadgetOffsetOrMobyStashCount: 0,
        assetsCompressedSize: 0,
        assetsDecompressedSize: 0,
        chromeMapTexture: view.getInt32(0x70),
        chromeMapPalette: view.getInt32(0x74),
        glassMapTexture: 0,
        glassMapPalette: 0,
        heightmapOffset: 0,
        occlusionOctOffset: 0,
        mobyGsStashList: 0,
        occlusionRadOffset: 0,
        mobySoundRemapOffset: 0,
        occlusionRad2Offset: 0,
    };
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

export interface FxTextureEntry {
    palette: number,
    dataOffsetInFxBank: number,
    width: number,
    height: number,
}
export const SIZEOF_FX_TEXTURE_ENTRY = 0x10;
export function readFxTextureEntry(view: DataViewExt): FxTextureEntry {
    return {
        palette: view.getInt32(0x0),
        dataOffsetInFxBank: view.getInt32(0x4),
        width: view.getInt32(0x8),
        height: view.getInt32(0xc),
    };
}
