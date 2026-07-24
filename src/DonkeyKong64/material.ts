import { ImageFormat, ImageSize, TextFilt, TextureLUT } from '../Common/N64/Image.js';
import { OtherModeH_CycleType, OtherModeH_Layout } from '../Common/N64/RDP.js';
import { assert } from '../util.js';
import { RSP_Geometry, RSPState } from './f3dex2.js';

export enum GeneratedSurfaceMaterial {
    Water = 0,
    Lava = 1,
    Meadow = 2,
    WaterFog = 3,
    Dirt = 4,
    LavaBright = 5,
    Acid = 6,
    WaterFire = 7,
    DirtCave = 8,
}

export enum SceneNodeMaterial {
    Clouds = 1,
    Sand = 2,
    WaterStream = 3,
    Water = 4,
    AnimatedTexture = 5,
    ScrollingTexture = 6,
    GroundFog = 7,
}

export interface AnimatedMaterialTextureBinding {
    segment: number;
    textureIDs: readonly number[];
    frameDuration: number;
}

export interface GeneratedSurfaceMaterialParams {
    scrollSpeedS: number;
    scrollSpeedT: number;
    alphaBase: number;
}

export function isGeneratedSurfaceMaterial(material: number): material is GeneratedSurfaceMaterial {
    return material >= GeneratedSurfaceMaterial.Water
        && material <= GeneratedSurfaceMaterial.DirtCave;
}

export function isSceneNodeMaterial(material: number): material is SceneNodeMaterial {
    return material >= SceneNodeMaterial.Clouds
        && material <= SceneNodeMaterial.GroundFog;
}

export function getGeneratedSurfaceAnimatedTextureBindings(material: GeneratedSurfaceMaterial): readonly AnimatedMaterialTextureBinding[] {
    switch (material) {
    case GeneratedSurfaceMaterial.Water:
    case GeneratedSurfaceMaterial.WaterFog:
        return [{ segment: 0x0D, textureIDs: [0x3C5], frameDuration: 0 }];
    case GeneratedSurfaceMaterial.LavaBright:
        return [{ segment: 0x0D, textureIDs: [0x3B9], frameDuration: 0 }];
    case GeneratedSurfaceMaterial.Acid:
        return [{ segment: 0x0D, textureIDs: [0x3D2], frameDuration: 0 }];
    case GeneratedSurfaceMaterial.WaterFire:
        return [
            { segment: 0x0C, textureIDs: [0x3BA], frameDuration: 0 },
            { segment: 0x0D, textureIDs: [0x3DB], frameDuration: 0 },
        ];
    default:
        return [];
    }
}

export function getSceneNodeAnimatedTextureBindings(material: SceneNodeMaterial | null): readonly AnimatedMaterialTextureBinding[] {
    switch (material) {
    case SceneNodeMaterial.AnimatedTexture:
        // func_global_asm_8063D288 loads table-7 textures 0x3AC..0x3B6 and
        // func_global_asm_8063D468 advances one image every update.
        return [{
            segment: 0x0C,
            textureIDs: [0x3AC, 0x3AD, 0x3AE, 0x3AF, 0x3B0, 0x3B1, 0x3B2, 0x3B3, 0x3B4, 0x3B5, 0x3B6],
            frameDuration: 1,
        }];
    case SceneNodeMaterial.Water:
        return [{ segment: 0x0C, textureIDs: [0x3E0], frameDuration: 0 }];
    case SceneNodeMaterial.WaterStream:
        return [
            { segment: 0x0C, textureIDs: [0x3B7], frameDuration: 0 },
            { segment: 0x0D, textureIDs: [0x3B8], frameDuration: 0 },
        ];
    default:
        return [];
    }
}

export function initSceneNodeMaterial(rspState: RSPState, material: SceneNodeMaterial, fogEnabled: boolean, mapID: number): void {
    switch (material) {
    case SceneNodeMaterial.Clouds:
        initCloudBackground(rspState);
        break;
    case SceneNodeMaterial.Sand:
        initSandMaterial(rspState, fogEnabled);
        break;
    case SceneNodeMaterial.WaterStream:
        initWaterStreamMaterial(rspState, fogEnabled, mapID);
        break;
    case SceneNodeMaterial.Water:
        initWaterMaterial(rspState);
        break;
    case SceneNodeMaterial.AnimatedTexture:
        initAnimatedBackground(rspState);
        break;
    case SceneNodeMaterial.ScrollingTexture:
        initScrollingBackground(rspState);
        break;
    case SceneNodeMaterial.GroundFog:
        initGroundFogMaterial(rspState, mapID);
        break;
    default:
        assert(false);
    }
}

export function initGeneratedSurfaceMaterial(rspState: RSPState, material: GeneratedSurfaceMaterial, params: GeneratedSurfaceMaterialParams): void {
    switch (material) {
    case GeneratedSurfaceMaterial.Water:
        initGeneratedWaterSurfaceMaterial(rspState, params.scrollSpeedS, params.scrollSpeedT);
        break;
    case GeneratedSurfaceMaterial.Lava:
        initGeneratedLavaSurfaceMaterial(rspState, params.scrollSpeedS);
        break;
    case GeneratedSurfaceMaterial.Meadow:
        initGeneratedMeadowSurfaceMaterial(rspState);
        break;
    case GeneratedSurfaceMaterial.WaterFog:
        initGeneratedWaterFogSurfaceMaterial(rspState, params.scrollSpeedS, params.scrollSpeedT, params.alphaBase);
        break;
    case GeneratedSurfaceMaterial.Dirt:
        initGeneratedDirtSurfaceMaterial(rspState);
        break;
    case GeneratedSurfaceMaterial.LavaBright:
        initGeneratedLavaBrightSurfaceMaterial(rspState, params.scrollSpeedS);
        break;
    case GeneratedSurfaceMaterial.Acid:
        initGeneratedAcidSurfaceMaterial(rspState, params.scrollSpeedS);
        break;
    case GeneratedSurfaceMaterial.WaterFire:
        initGeneratedWaterFireSurfaceMaterial(rspState);
        break;
    case GeneratedSurfaceMaterial.DirtCave:
        initGeneratedDirtCaveSurfaceMaterial(rspState);
        break;
    default:
        assert(false);
    }
}

export function initDL(rspState: RSPState, opaque: boolean, fogEnabled = false): void {
    rspState.gSPSetGeometryMode(RSP_Geometry.G_SHADE | (fogEnabled ? RSP_Geometry.G_FOG : 0));
    if (opaque) {
        rspState.gDPSetOtherModeL(0, 29, 0x0C192078); // opaque surfaces
        rspState.gSPSetGeometryMode(RSP_Geometry.G_LIGHTING);
    } else {
        rspState.gDPSetOtherModeL(0, 29, 0x005049D8); // translucent surfaces
    }
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
}

// D_global_asm_80747D80[1], constructed by func_global_asm_8063C4C4.
// SHADE is intentionally retained: the geometry's vertex colors provide the
// smoothly interpolated background lighting while the two texture tiles add
// detail over the blue primitive/environment tint.
function initCloudBackground(rspState: RSPState): void {
    rspState.gDPSetOtherModeH(
        OtherModeH_Layout.G_MDSFT_CYCLETYPE,
        2,
        OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE,
    );
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(
        RSP_Geometry.G_SHADE
        | RSP_Geometry.G_CULL_BACK
        | RSP_Geometry.G_SHADING_SMOOTH,
    );
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 1, 3, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C192008);
    rspState.gDPSetCombine(0x001114C0, 0xFFFFFEFC);
    rspState.gSPSetEnvColor(0x00, 0x40, 0x7F, 0xFF);
    rspState.gSPSetPrimColor(0, 0x50, 0x50, 0xB4, 0x46);

    // The original context inherits the active texture-image pointer and
    // interprets the same uploaded bytes through I8 and IA8 render tiles.
    rspState.gDPSetTileSize(1, 0x0FF, 0, 0x07C, 0x07C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_I, ImageSize.G_IM_SIZ_8b, 0, 0, 7, 0, 1, 5, 0, 1, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x200);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_I, ImageSize.G_IM_SIZ_8b, 4, 0, 1, 0, 0, 5, 0, 0, 5, 15);
    rspState.gDPSetTileSize(2, 0x0FF, 0, 0x07C, 0x07C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 0, 0x100, 7, 0, 1, 5, 0, 1, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x200);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 4, 0x100, 2, 0, 0, 5, 0, 0, 5, 15);
    rspState.setTextureScrollSpeeds([1, 0.439]);
}

// D_global_asm_80747D80[5], constructed by func_global_asm_8063D2E4.
function initAnimatedBackground(rspState: RSPState): void {
    rspState.gDPSetOtherModeH(
        OtherModeH_Layout.G_MDSFT_CYCLETYPE,
        2,
        OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE,
    );
    rspState.gDPSetOtherModeH(
        OtherModeH_Layout.G_MDSFT_TEXTLOD,
        1,
        1 << OtherModeH_Layout.G_MDSFT_TEXTLOD,
    );
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(
        RSP_Geometry.G_ZBUFFER
        | RSP_Geometry.G_SHADE
        | RSP_Geometry.G_CULL_BACK
        | RSP_Geometry.G_SHADING_SMOOTH,
    );
    rspState.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C184A50);
    rspState.gDPSetCombine(0x01FFFFFF, 0xFFFCF279);
    rspState.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);

    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_16b, 1, 0x0C000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 6, 0, 0, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x100);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 8, 0, 0, 0, 0, 6, 0, 0, 5, 0);
    rspState.gDPSetTileSize(0, 0, 0, 0x0FC, 0x07C);
}

// D_global_asm_80747D80[6], constructed by func_global_asm_8063D4A4.
function initScrollingBackground(rspState: RSPState): void {
    rspState.gDPSetOtherModeH(
        OtherModeH_Layout.G_MDSFT_CYCLETYPE,
        2,
        OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE,
    );
    rspState.gDPSetOtherModeH(
        OtherModeH_Layout.G_MDSFT_TEXTLOD,
        1,
        1 << OtherModeH_Layout.G_MDSFT_TEXTLOD,
    );
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(
        RSP_Geometry.G_ZBUFFER
        | RSP_Geometry.G_SHADE
        | RSP_Geometry.G_CULL_BACK
        | RSP_Geometry.G_SHADING_SMOOTH,
    );
    rspState.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C184A50);
    rspState.gDPSetCombine(0x00121804, 0xFF1FFFFF);
    rspState.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);
    rspState.gDPSetTileSize(0, 0, 0, 0x0FC, 0x0FC);
    rspState.setTextureScrollSpeeds([0.865]);
}

// D_global_asm_80747D80[4], used by map scene nodes for water. The game
// generates this material display list at runtime, before submitting the
// geometry-only display list stored in the map file.
function initWaterMaterial(rspState: RSPState): void {
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 1, 1, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C184A50);
    rspState.gDPSetCombine(0x00FF9441, 0xFF13FFFF);

    // Handler 4 loads table-7 texture 0x3E0 once, then interprets the same
    // TMEM contents through two independently scrolling IA8 render tiles.
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_16b, 1, 0x0C000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 6, 0, 0, 6, 0);
    rspState.gDPLoadBlock(7, 0, 0, 2047, 256);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 8, 0, 0, 0, 0, 6, 0, 0, 6, 0);
    rspState.gDPSetTileSize(0, 0, 0, 0x0FC, 0x0FC);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 8, 0, 1, 0, 0, 6, 1, 0, 6, 1);
    rspState.gDPSetTileSize(1, 0, 0, 0x0FC, 0x0FC);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 8, 0, 2, 0, 0, 6, 1, 0, 6, 1);
    rspState.gDPSetTileSize(2, 0, 0, 0x0FC, 0x0FC);
    rspState.setTextureScrollSpeeds([5, 2]);
}

// D_global_asm_80747D80[SceneNodeMaterial.Sand]. func_global_asm_8063C784
// loads the complete 32x32 RGBA16 mip chain from texture 0x565, and
// func_global_asm_8063C7C4 constructs the material display list.
function initSandMaterial(rspState: RSPState, fogEnabled: boolean): void {
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(
        RSP_Geometry.G_ZBUFFER
        | RSP_Geometry.G_SHADE
        | RSP_Geometry.G_CULL_BACK
        | RSP_Geometry.G_SHADING_SMOOTH
        | (fogEnabled ? RSP_Geometry.G_FOG : 0),
    );
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 1 << OtherModeH_Layout.G_MDSFT_TEXTLOD);
    rspState.gSPTexture(true, 0, 3, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(3, 29, fogEnabled ? 0xC8112230 : 0x0C192230);
    rspState.gDPSetCombine(0x0026A004, 0x1F1093FF);

    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x565);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0);
    rspState.gDPLoadBlock(7, 0, 0, 2047, 0);
    // The renderer currently samples the base level when texture LOD is on,
    // but preserve all four runtime tile descriptors for future mipmapping.
    // The changing T origin is emulated by setTextureScrollSpeeds below.
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0, 0, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPSetTileSize(0, 2, 0, 0x07E, 0x07E);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 4, 0x100, 1, 0, 0, 4, 1, 0, 4, 1);
    rspState.gDPSetTileSize(1, 2, 0, 0x03E, 0x03E);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 2, 0x140, 2, 0, 0, 3, 2, 0, 3, 2);
    rspState.gDPSetTileSize(2, 2, 0, 0x01E, 0x01E);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x150, 3, 0, 0, 2, 3, 0, 2, 3);
    rspState.gDPSetTileSize(3, 2, 0, 0x00E, 0x00E);
    rspState.setTextureScrollSpeeds([1]);
}

// D_global_asm_80747D80[SceneNodeMaterial.WaterStream]. This is the complete
// material generated by func_global_asm_8063CB40.
function initWaterStreamMaterial(rspState: RSPState, fogEnabled: boolean, mapID: number): void {
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(
        RSP_Geometry.G_ZBUFFER
        | RSP_Geometry.G_SHADE
        | RSP_Geometry.G_SHADING_SMOOTH
        | (fogEnabled ? RSP_Geometry.G_FOG : 0),
    );
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 1, 1, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(3, 29, fogEnabled ? 0xC8104A50 : 0x0C184A50);
    rspState.gDPSetCombine(0x00FFFE41, 0xFFFFFFD3);

    // Four early maps select different translucency values. All other maps,
    // including Castle Dungeon and Fairy Island, use the default 0x50.
    let alpha = 0x50;
    if (mapID === 0x01)
        alpha = 0xB4;
    else if (mapID === 0x0C)
        alpha = 0x96;
    else if (mapID === 0x10)
        alpha = 0x3C;
    rspState.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, alpha);

    // func_global_asm_8063CADC loads table-7 textures 0x3B7 and 0x3B8.
    // Bindings 0x0C and 0x0D are supplied by the scene loader.
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x0C000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x200);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0, 1, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPSetTileSize(1, 0, 0, 0x07C, 0x07C);

    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x0D000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 7, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x200);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0x100, 2, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPSetTileSize(2, 0, 0, 0x07C, 0x07C);
    rspState.setTextureScrollSpeeds([1.234, 0.45]);
}

// D_global_asm_80747D80[SceneNodeMaterial.GroundFog].
// func_global_asm_8063D608 loads texture 0x1765 and
// func_global_asm_8063D638 constructs this material.
function initGroundFogMaterial(rspState: RSPState, mapID: number): void {
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 1 << OtherModeH_Layout.G_MDSFT_TEXTLOD);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(
        RSP_Geometry.G_ZBUFFER
        | RSP_Geometry.G_SHADE
        | RSP_Geometry.G_CULL_BACK
        | RSP_Geometry.G_SHADING_SMOOTH,
    );
    rspState.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(3, 29, 0x0C184A50);
    rspState.gDPSetCombine(0x00121803, 0xFF0FFFFF);

    let alpha = 0x50;
    if (mapID === 0x22 || mapID === 0xBB)
        alpha = 0xFF;
    else if (mapID === 0x36 || mapID === 0xBC)
        alpha = 0x96;
    rspState.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, alpha);

    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x1765);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x100);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0, 0, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPSetTileSize(0, 0, 0, 0x07C, 0x07C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0, 1, 0, 0, 5, 0, 0, 5, 0);
    rspState.setTextureScrollSpeeds([mapID === 0xBB ? 2 : 1]);
}

function initGeneratedWaterSurfaceMaterial(rspState: RSPState, scrollS: number, scrollT: number): void {
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 1, 0x0D000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 0, 0, 7, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 128);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 0, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPSetTileSize(0, 0, 0, 0x07C, 0x07C);
    rspState.gDPSetCombine(0x0020FE04, 0xFF13F3FF);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 1, 1, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C184A50);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 1, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPSetTileSize(1, 0, 0, 0x07C, 0x07C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 2, 0, 0, 5, 13, 0, 5, 13);
    rspState.gDPSetTileSize(2, 0, 0, 0x07C, 0x07C);
    rspState.setTextureScrollSpeeds([scrollS, scrollT]);
}

// D_global_asm_80748A90[GeneratedSurfaceMaterial.WaterFog]. This shares
// Water's table-7 texture 0x3C5, but func_global_asm_806618A0 uses fog and
// the surface record's alpha as a primitive-alpha multiplier.
function initGeneratedWaterFogSurfaceMaterial(rspState: RSPState, scrollS: number, scrollT: number, alpha: number): void {
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 1, 0x0D000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 0, 0, 7, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 128);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 0, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPSetTileSize(0, 0, 0, 0x07C, 0x07C);
    rspState.gDPSetCombine(0x0020FE04, 0xFF0FF3FF);
    rspState.gSPSetPrimColor(0, 0, 0, 0, alpha);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_FOG | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 1, 1, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(3, 29, 0xC8104A50);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 1, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPSetTileSize(1, 0, 0, 0x07C, 0x07C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 2, 0, 0, 5, 13, 0, 5, 13);
    rspState.gDPSetTileSize(2, 0, 0, 0x07C, 0x07C);
    rspState.setTextureScrollSpeeds([scrollS, scrollT]);
}

// D_global_asm_80748A90[GeneratedSurfaceMaterial.Lava]. The game loads texture
// 0x2EE and palette 0x2EF in func_global_asm_80661B84, then constructs this
// material display list in func_global_asm_80661BF0.
function initGeneratedLavaSurfaceMaterial(rspState: RSPState, scrollSpeed: number): void {
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_16b, 1, 0x2EE);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 6, 0, 0, 6, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 512);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_4b, 4, 0, 0, 0, 0, 6, 0, 0, 6, 0);
    rspState.gDPSetTileSize(0, 0, 0, 0x0FC, 0x0FC);

    rspState.gDPSetCombine(0x00121624, 0xFF2FFFFF); // G_CC_MODULATEIA
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x00552230);

    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x2EF);
    rspState.gDPSetTile(0, 0, 0, 0x100, 7, 0, 0, 0, 0, 0, 0, 0);
    rspState.gDPLoadTLUT(7, 15);
    rspState.gDPSetOtherModeH(
        OtherModeH_Layout.G_MDSFT_TEXTLUT,
        2,
        TextureLUT.G_TT_RGBA16 << OtherModeH_Layout.G_MDSFT_TEXTLUT,
    );
    rspState.setTextureScrollSpeeds([scrollSpeed]);
}

// D_global_asm_80748A90[GeneratedSurfaceMaterial.Meadow]. The game loads
// texture 0xF0 in func_global_asm_80661EC4 and constructs this material in
// func_global_asm_80661F0C.
function initGeneratedMeadowSurfaceMaterial(rspState: RSPState): void {
    initGeneratedMipmappedSurfaceMaterial(rspState, 0xF0);
}

function initGeneratedMipmappedSurfaceMaterial(rspState: RSPState, textureID: number): void {
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, textureID);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1359, 0);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0, 0, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPSetTileSize(0, 2, 2, 0x07E, 0x07E);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 4, 0x100, 1, 0, 0, 4, 1, 0, 4, 1);
    rspState.gDPSetTileSize(1, 2, 2, 0x03E, 0x03E);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 2, 0x140, 2, 0, 0, 3, 2, 0, 3, 2);
    rspState.gDPSetTileSize(2, 2, 2, 0x01E, 0x01E);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x150, 3, 0, 0, 2, 3, 0, 2, 3);
    rspState.gDPSetTileSize(3, 2, 2, 0x00E, 0x00E);

    rspState.gDPSetCombine(0x0026A004, 0x1F1093FF);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 1 << OtherModeH_Layout.G_MDSFT_TEXTLOD);
    rspState.gSPTexture(true, 0, 3, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(3, 29, 0x0C192230);
}

// D_global_asm_80748A90[GeneratedSurfaceMaterial.Dirt]. The handler is
// func_global_asm_806621D0 and uses table-25 texture 0x75C.
function initGeneratedDirtSurfaceMaterial(rspState: RSPState): void {
    initGeneratedMipmappedSurfaceMaterial(rspState, 0x75C);
}

function initGeneratedScrollingOpaqueSurfaceMaterial(rspState: RSPState, segment: number, scrollT: number): void {
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, segment << 24);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x100);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0, 0, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPSetTileSize(0, 0, 0, 0x07C, 0x07C);
    rspState.gDPSetCombine(0x00121624, 0xFF2FFFFF); // G_CC_MODULATEIA
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C192230);
    rspState.setTextureScrollSpeeds([scrollT]);
}

// D_global_asm_80748A90[GeneratedSurfaceMaterial.LavaBright]. The handler is
// func_global_asm_8066241C and uses table-7 texture 0x3B9.
function initGeneratedLavaBrightSurfaceMaterial(rspState: RSPState, scrollT: number): void {
    initGeneratedScrollingOpaqueSurfaceMaterial(rspState, 0x0D, scrollT);
}

// D_global_asm_80748A90[GeneratedSurfaceMaterial.Acid]. The handler is
// func_global_asm_80662618 and uses table-7 texture 0x3D2.
function initGeneratedAcidSurfaceMaterial(rspState: RSPState, scrollT: number): void {
    initGeneratedScrollingOpaqueSurfaceMaterial(rspState, 0x0D, scrollT);
}

// D_global_asm_80748A90[GeneratedSurfaceMaterial.WaterFire]. The handler is
// func_global_asm_80662838 and combines table-7 textures 0x3BA and 0x3DB.
function initGeneratedWaterFireSurfaceMaterial(rspState: RSPState): void {
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x0C000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x100);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0, 0, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPSetTileSize(0, 0, 0, 0x07C, 0x07C);

    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, 0x0D000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 7, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 0x100);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0x100, 1, 0, 0, 5, 0, 0, 5, 0);
    rspState.gDPSetTileSize(1, 0, 0, 0x07C, 0x07C);

    rspState.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0x64);
    rspState.gDPSetCombine(0x00272C03, 0x1FFC93FB);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 1 << OtherModeH_Layout.G_MDSFT_TEXTLOD);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gSPTexture(true, 0, 1, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C184A50);
}

// D_global_asm_80748A90[GeneratedSurfaceMaterial.DirtCave]. The handler
// delegates to func_global_asm_80661F0C with table-25 texture 0xAF4.
function initGeneratedDirtCaveSurfaceMaterial(rspState: RSPState): void {
    initGeneratedMipmappedSurfaceMaterial(rspState, 0xAF4);
}

export interface SpriteMaterialDefinition {
    flags: number;
    codec: number;
    width: number;
    height: number;
}

function getSpriteImageFormat(sprite: SpriteMaterialDefinition): ImageFormat {
    // func_global_asm_80714778 copies SpriteData::unk6 to the runtime
    // descriptor's unkA. func_global_asm_80715E94 then uses unkA & 7 as
    // G_IM_FMT for every texture command.
    return sprite.flags & 0x07;
}

function getSpriteImageSize(sprite: SpriteMaterialDefinition): ImageSize {
    assert(sprite.codec >= 0 && sprite.codec <= 3);
    return sprite.codec as ImageSize;
}

export function initSpriteMaterial(rspState: RSPState, sprite: SpriteMaterialDefinition, segment: number, color: readonly number[]): void {
    const fmt = getSpriteImageFormat(sprite);
    const siz = getSpriteImageSize(sprite);
    const bitsPerPixel = 4 << siz;
    const texelCount = sprite.width * sprite.height;
    const loadCount = Math.min(0x07FF, Math.ceil(texelCount * bitsPerPixel / 16) - 1);
    const line = Math.max(1, Math.ceil(sprite.width * bitsPerPixel / 64));
    // G_TX_DXT_FRAC is 11: CALC_DXT rounds 2^11 / words-per-line up.
    // Using 0x07FF here is one short for exact divisors (including both
    // waterfall sprites), which shears the texture as it is loaded to TMEM.
    const dxt = Math.max(1, Math.ceil(0x0800 / line));
    const maskS = Math.ceil(Math.log2(sprite.width));
    const maskT = Math.ceil(Math.log2(sprite.height));

    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x005049D8);
    rspState.gDPSetCombine(0x00119623, 0xFF2FFFFF); // G_CC_MODULATEIA_PRIM
    rspState.gSPSetPrimColor(0, color[0], color[1], color[2], color[3]);

    // The game loads through a 16-bit tile for 4/8/16-bit sprites and a
    // 32-bit tile for RGBA32, then renders using the definition's real size.
    const loadSize = siz === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;
    rspState.gDPSetTextureImage(fmt, loadSize, 1, segment << 24);
    rspState.gDPSetTile(fmt, loadSize, 0, 0, 7, 0, 0, maskT, 0, 0, maskS, 0);
    rspState.gDPLoadBlock(7, 0, 0, loadCount, dxt);
    rspState.gDPSetTile(fmt, siz, line, 0, 0, 0, 0, maskT, 0, 0, maskS, 0);
    rspState.gDPSetTileSize(0, 0, 0, (sprite.width - 1) << 2, (sprite.height - 1) << 2);
}
