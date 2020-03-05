import { GfxDevice, GfxTexture, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import * as GX from '../gx/gx_enum';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GXMaterial, SwapTable } from '../gx/gx_material';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, fillSceneParams } from '../gx/gx_render';
import { standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor, BasicRenderTarget, ColorTexture } from '../gfx/helpers/RenderTargetHelpers';
import { GfxSampler, GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';

import { SFATexture, TextureCollection } from './textures';

function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
}

interface ShaderLayer {
    texNum: number;
    tevMode: number;
}

export interface Shader {
    layers: ShaderLayer[],
    enableCull: boolean;
    flags: number;
    hasTexmtx01: boolean;
    hasTexmtx2: boolean;
    attrFlags: number;
}

function parseShaderLayer(data: DataView): ShaderLayer {
    return {
        texNum: data.getUint32(0),
        tevMode: data.getUint8(4),
    };
}

interface ShaderFields {
    size: number;
    numLayers: number;
    layers: number;
}

export const SFA_SHADER_FIELDS: ShaderFields = {
    size: 0x44,
    numLayers: 0x41,
    layers: 0x24,
};

export const EARLY_SFA_SHADER_FIELDS: ShaderFields = {
    size: 0x40,
    numLayers: 0x3b,
    layers: 0x24, // ???
};

enum ShaderFlags {
    Cull = 0x8,
}

export function parseShader(data: DataView, fields: ShaderFields): Shader {
    const shader: Shader = {
        layers: [],
        enableCull: false,
        flags: 0,
        hasTexmtx01: false,
        hasTexmtx2: false,
        attrFlags: 0,
    };

    let numLayers = data.getUint8(fields.numLayers);
    if (numLayers > 2) {
        console.warn(`Number of shader layers greater than maximum (${numLayers} / 2)`);
        numLayers = 2;
    }
    for (let i = 0; i < numLayers; i++) {
        const layer = parseShaderLayer(dataSubarray(data, fields.layers + i * 8));
        shader.layers.push(layer);
    }

    shader.flags = data.getUint32(0x3c);
    // FIXME: find this field's offset for demo files
    shader.enableCull = (shader.flags & ShaderFlags.Cull) != 0;

    // FIXME: the texmtx stuff below is broken or not present in SFA...
    // shader.hasTexmtx01 = data.getUint32(offs + 8) == 1 || data.getUint32(offs + 20) == 1;
    // shader.hasTexmtx2 = (data.getUint32(offs + 64 + 2) & 0x80) != 0;
    shader.hasTexmtx01 = data.getUint32(0x34) != 0;
    shader.hasTexmtx2 = false;

    shader.attrFlags = data.getUint8(0x40);

    return shader
}

export interface SFAMaterialTexture_Texture {
    kind: 'texture';
    texture: SFATexture;
}

export interface SFAMaterialTexture_FbColorDownscaled8x {
    kind: 'fb-color-downscaled-8x'; // FIXME: In addition to downscaling, some filtering is applied (I think)
}

export type SFAMaterialTexture =
    SFAMaterialTexture_Texture |
    SFAMaterialTexture_FbColorDownscaled8x |
    null;

export function makeMaterialTexture(texture: SFATexture | null): SFAMaterialTexture {
    if (texture) {
        return { kind: 'texture', texture };
    } else {
        return null;
    }
}

export interface SFAMaterial {
    material: GXMaterial;
    textures: SFAMaterialTexture[];
}

function makeWavyTexture(device: GfxDevice): SFATexture {
    // This function generates a texture with a wavy pattern used for water and lava.
    // Strangely, the original function to generate this function is not customizable and
    // generates the same texture every time. (?)
    
    const width = 64;
    const height = 64;
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
    const gfxSampler = device.createSampler({
        wrapS: GfxWrapMode.REPEAT,
        wrapT: GfxWrapMode.REPEAT,
        minFilter: GfxTexFilterMode.BILINEAR,
        magFilter: GfxTexFilterMode.BILINEAR,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0,
        maxLOD: 100,
    });

    const pixels = new Uint8Array(4 * width * height);

    function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
        const idx = 4 * (y * width + x)
        pixels[idx] = r
        pixels[idx + 1] = g
        pixels[idx + 2] = b
        pixels[idx + 3] = a
    }

    let X_MUL = 0.39275 // Approximately pi / 8
    let Y_MUL = 0.0981875 // Approximately pi / 32
    for (let y = 0; y < height; y++) {
        let yAngle = Y_MUL * y
        for (let x = 0; x < width; x++) {
            let xAngle = X_MUL * x
            let iFactor = Math.cos(0.5 * Math.sin(xAngle) + yAngle)
            let aFactor = Math.cos(X_MUL * x * xAngle)
            let I = 127 * iFactor + 127
            let A = 127 * iFactor * aFactor + 127
            plot(y, x, I, I, I, A)
        }
    }

    const hostAccessPass = device.createHostAccessPass();
    hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
    device.submitPass(hostAccessPass);

    return { gfxTexture, gfxSampler, width, height }
}

export function buildMaterialFromShader(device: GfxDevice, shader: Shader, texColl: TextureCollection, texIds: number[]): SFAMaterial {
    const mb = new GXMaterialBuilder('Material');
    const textures = [] as SFAMaterialTexture[];
    let tevStage = 0;
    let indStageId = GX.IndTexStageID.STAGE0;
    let texcoordId = GX.TexCoordID.TEXCOORD0;
    let texmapId = GX.TexMapID.TEXMAP0;
    let texGenSrc = GX.TexGenSrc.TEX0;
    let cprevIsValid = false;
    let aprevIsValid = false;

    if ((shader.flags & 0x40000000) || (shader.flags & 0x20000000)) {
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    } else {
        mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO, GX.LogicOp.NOOP);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        if (((shader.flags & 0x400) == 0) || ((shader.flags & 0x80) != 0)) {
            mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        } else {
            mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
        }
    }
    mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setCullMode(shader.enableCull ? GX.CullMode.BACK : GX.CullMode.NONE);

    function addTevStagesForTextureWithSkyAmbient() {
        // TODO: set texture matrix
        mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX2x4, texGenSrc, GX.TexGenMatrix.IDENTITY);

        // mb.setTevKColor (does not exist)
        // TODO: The game multiplies by a sky-related ambient color
        // mb.setTevKColorSel(tevStage, GX.KonstColorSel.KCSEL_K0);
        // Stage 1: Multiply vertex color by ambient sky color
        mb.setTevDirect(tevStage);
        mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.ONE /*GX.CombineColorInput.KONST*/, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // Stage 2: Blend previous stage with vertex color by vertex alpha
        mb.setTevDirect(tevStage + 1);
        mb.setTevOrder(tevStage + 1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(tevStage + 1, GX.CC.CPREV, GX.CC.RASC, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevAlphaIn(tevStage + 1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevColorOp(tevStage + 1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage + 1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // Stage 3: Multiply by texture
        mb.setTevDirect(tevStage + 2);
        mb.setTevOrder(tevStage + 2, texcoordId, texmapId, GX.RasColorChannelID.COLOR_ZERO /* GX_COLOR_NULL */);
        mb.setTevColorIn(tevStage + 2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevAlphaIn(tevStage + 2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(tevStage + 2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage + 2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        tevStage += 3;
        texcoordId++;
        texmapId++;
        texGenSrc++;
    }

    function addTevStagesForTextureWithMode(mode: number) {
        // TODO: set texture matrix
        mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX2x4, texGenSrc, GX.TexGenMatrix.IDENTITY);

        mb.setTevDirect(tevStage);
        mb.setTevOrder(tevStage, texcoordId, texmapId, GX.RasColorChannelID.COLOR0A0);
        // Only modes 0 and 9 occur in map blocks. Other modes
        // occur in object and character models.
        switch (mode) {
        case 0:
            mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
            break;
        case 1: // Default case in original executable
            mb.setTevColorIn(tevStage, GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO);
            break;
        case 9:
            mb.setTevColorIn(tevStage, GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO);
            break;
        default:
            console.warn(`Unhandled tev color-in mode ${mode}`);
            break;
        }

        if (!aprevIsValid) {
            mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
            aprevIsValid = true;
        } else {
            mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        }
        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        cprevIsValid = true;

        tevStage++;
        texcoordId++;
        texmapId++;
        texGenSrc++;
    }

    function addTevStageForTextureWithWhiteKonst(colorInMode: number) {
        // TODO: handle color. map block renderer always passes opaque white to this function.
        
        // TODO: set texture matrix
        mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX2x4, texGenSrc, GX.TexGenMatrix.IDENTITY);

        mb.setTevDirect(tevStage);
        mb.setTevOrder(tevStage, texcoordId, texmapId, GX.RasColorChannelID.COLOR0A0);
        switch (colorInMode) {
        case 0:
            mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.ONE /* GX.CC.KONST */, GX.CC.ZERO);
            break;
        default:
            console.warn(`Unhandled colorInMode ${colorInMode}`);
            break;
        }

        if (!aprevIsValid) {
            mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
            aprevIsValid = true;
        } else {
            mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        }
        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        cprevIsValid = true;

        tevStage++;
        texcoordId++;
        texmapId++;
        texGenSrc++;
    }

    function addTevStageForMultVtxColor() {
        // TODO: handle konst alpha. map block renderer always passes opaque white to this function.

        mb.setTevDirect(tevStage);
        mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevKAlphaSel(tevStage, GX.KonstAlphaSel.KASEL_1); // TODO: handle non-opaque alpha
        if (tevStage === 0 || !cprevIsValid) {
            mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
            mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
        } else {
            mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
            mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.APREV, GX.CA.KONST, GX.CA.ZERO);
        }
        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        cprevIsValid = true;
        tevStage++;
    }

    function addTevStagesForLava() { // and other similar effects?
        // Occurs for lava
        textures[2] = makeMaterialTexture(texColl.getTexture(device, texIds[shader.layers[0].texNum], true));
        // TODO: set texture matrix
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD3, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        const texture0x600 = texColl.getTexture(device, 0x600);
        textures[0] = makeMaterialTexture(texture0x600);
        // TODO: set texture matrix
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        // FIXME: Don't generate a new wavy texture every time.
        // Find a place to stash one and reuse it.
        textures[1] = makeMaterialTexture(makeWavyTexture(device));
        // TODO: set texture matrix
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        
        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1);
        mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);
        // TODO: set ind tex matrices
        mb.setTevIndirect(1, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
        // TODO: set texture matrix
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setIndTexOrder(GX.IndTexStageID.STAGE1, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP1);
        mb.setIndTexScale(GX.IndTexStageID.STAGE1, GX.IndTexScale._1, GX.IndTexScale._1);
        mb.setTevIndirect(2, GX.IndTexStageID.STAGE1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);
        // TODO: set and use tev kcolor
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_4_8); // TODO
        mb.setTevKColorSel(1, GX.KonstColorSel.KCSEL_4_8); // TODO
        mb.setTevDirect(0);
        const swap3: SwapTable = [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.R];
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP2, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(0, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevSwapMode(0, undefined, swap3);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_4, true, GX.Register.PREV);
        cprevIsValid = true;

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.KONST, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        mb.setTevSwapMode(1, undefined, undefined);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD3, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(2, GX.CC.CPREV, GX.CC.TEXC, GX.CC.APREV, GX.CC.ZERO);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevSwapMode(2, undefined, undefined);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        tevStage = 3;
        texGenSrc = 4;
        texcoordId = 4;
        texmapId = 3;
        indStageId = 2;
    }

    function addTevStagesForWater() {
        // TODO: set texture matrix
        mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, GX.PostTexGenMatrix.PTIDENTITY /* TODO */);
        // TODO: set texture matrix
        mb.setTexCoordGen(texcoordId + 1, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.IDENTITY);
        // TODO: create special 128x128 texture
        const tex = texColl.getTexture(device, 0);
        textures[texmapId] = makeMaterialTexture(tex);
        // TODO: GXSetIndTexMtx
        mb.setIndTexOrder(indStageId, texcoordId + 2, texmapId + 1);
        // TODO: set texture matrix
        mb.setTexCoordGen(texcoordId + 2, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.IDENTITY);
        mb.setTevIndirect(tevStage, indStageId, GX.IndTexFormat._8, GX.IndTexBiasSel.T, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
        mb.setIndTexScale(indStageId, GX.IndTexScale._1, GX.IndTexScale._1);
        mb.setIndTexOrder(indStageId + 1, texcoordId + 3, texmapId + 1);
        // TODO: set texture matrix
        mb.setTexCoordGen(texcoordId + 3, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.IDENTITY);
        mb.setTevIndirect(tevStage + 1, indStageId + 1, GX.IndTexFormat._8, GX.IndTexBiasSel.T, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);
        mb.setIndTexScale(indStageId + 1, GX.IndTexScale._1, GX.IndTexScale._1);

        mb.setTevOrder(tevStage, texcoordId, texmapId, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.RASA, GX.CC.TEXA, GX.CC.CPREV);
        mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        mb.setTevSwapMode(tevStage, undefined, undefined);
        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        cprevIsValid = true;

        mb.setTevOrder(tevStage + 1, texcoordId + 1, texmapId, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(tevStage + 1, GX.CC.ZERO, GX.CC.RASA, GX.CC.TEXA, GX.CC.CPREV);
        mb.setTevAlphaIn(tevStage + 1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        mb.setTevSwapMode(tevStage + 1, undefined, undefined);
        mb.setTevColorOp(tevStage + 1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage + 1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        textures[texmapId + 1] = makeMaterialTexture(makeWavyTexture(device));

        indStageId += 2;
        texcoordId += 4;
        texmapId += 2;
        tevStage += 2;
    }

    function blendWithTinyFramebufferTexture() {
        // Used in reflective floors

        // TODO: set texture matrix
        // TODO: load tiny framebuffer texture
        // GXSetTexCoordGen2(gTexCoordID,GX_TG_MTX3x4,GX_TG_POS,0x24,0,0x7d);
        // mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.IDENTITY);
        mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        textures[texmapId] = { kind: 'fb-color-downscaled-8x' };
        mb.setTevDirect(tevStage);
        mb.setTevKColorSel(tevStage, GX.KonstColorSel.KCSEL_2_8);
        mb.setTevOrder(tevStage, texcoordId, texmapId, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.CPREV);
        mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        mb.setTevSwapMode(tevStage, undefined, undefined);
        mb.setTevColorOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(tevStage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        cprevIsValid = true;

        texcoordId++;
        texmapId++;
        tevStage++;
    }

    if ((shader.flags & 0x80) != 0) {
        addTevStagesForLava();
    } else if ((shader.flags & 0x40) != 0) {
        addTevStagesForWater();
    } else {
        if (shader.layers.length === 2 && (shader.layers[1].tevMode & 0x7f) === 9) {
            addTevStageForTextureWithWhiteKonst(0);
            if (shader.flags & 0x100) {
                blendWithTinyFramebufferTexture();
            }
            addTevStagesForTextureWithMode(9);
            addTevStageForMultVtxColor();
        } else {
            for (let i = 0; i < shader.layers.length; i++) {
                const layer = shader.layers[i];
                if (shader.flags & 0x40000) {
                    addTevStagesForTextureWithSkyAmbient();
                } else {
                    addTevStagesForTextureWithMode(layer.tevMode & 0x7f);
                }
            }

            if (shader.flags & 0x100) {
                // Occurs in Krazoa Palace's reflective floors
                blendWithTinyFramebufferTexture();
            }
        }

        for (let i = 0; i < shader.layers.length; i++) {
            textures.push(makeMaterialTexture(texColl.getTexture(device, texIds[shader.layers[i].texNum], true)));
        }
    }

    return {
        material: mb.finish(),
        textures
    };
}