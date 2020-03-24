import { GfxDevice, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import * as GX from '../gx/gx_enum';
import { ViewerRenderInput } from '../viewer';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GXMaterial, SwapTable } from '../gx/gx_material';
import { MaterialParams } from '../gx/gx_render';
import { GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';

import { SFATexture, TextureCollection } from './textures';
import { dataSubarray } from './util';
import { mat4 } from 'gl-matrix';
import { texProjCameraSceneTex } from '../Camera';
import { FurFactory } from './fur';

interface ShaderLayer {
    texId: number | null;
    tevMode: number;
    enableTexChainStuff: number;
    texmtxIndex: number;
}

export interface Shader {
    layers: ShaderLayer[],
    flags: number;
    attrFlags: number;
    hasAuxTex0: boolean;
    hasAuxTex1: boolean; // It is not known what these are for, but they are important for the vertex descriptor.
                         // It is possibly related to projected lighting.
    hasAuxTex2: boolean;
    auxTex2Num: number;
    furRegionsTexId: number | null; // Only used in character models, not blocks (??)
}

function parseTexId(data: DataView, offs: number, texIds: number[]): number | null {
    const texNum = data.getUint32(offs);
    return texNum !== 0xffffffff ? texIds[texNum] : null;
}

function parseShaderLayer(data: DataView, texIds: number[], isBeta: boolean): ShaderLayer {
    return {
        texId: parseTexId(data, 0x0, texIds),
        tevMode: data.getUint8(0x4),
        enableTexChainStuff: data.getUint8(0x5),
        texmtxIndex: data.getUint8(0x6),
    };
}

interface ShaderFields {
    isBeta?: boolean;
    size: number;
    numLayers: number;
    layers: number;
}

export const SFA_SHADER_FIELDS: ShaderFields = {
    size: 0x44,
    numLayers: 0x41,
    layers: 0x24,
};

export const SFADEMO_MODEL_SHADER_FIELDS: ShaderFields = {
    size: 0x44,
    numLayers: 0x41,
    layers: 0x24, // ???
};

export const SFADEMO_MAP_SHADER_FIELDS: ShaderFields = {
    size: 0x40,
    numLayers: 0x3b,
    layers: 0x24, // ???
};

export const BETA_MODEL_SHADER_FIELDS: ShaderFields = {
    isBeta: true,
    size: 0x38,
    numLayers: 0x36,
    layers: 0x20,
};

export enum ShaderFlags {
    DevGeometry = 0x2,
    Fog = 0x4,
    CullBackface = 0x8,
    ReflectSkyscape = 0x20, // ???
    Water = 0x40,
    Lava = 0x80,
    Reflective = 0x100, // Occurs in Krazoa Palace reflective floors
    AlphaCompare = 0x400,
    ShortFur = 0x4000, // 4 layers
    MediumFur = 0x8000, // 8 layers
    LongFur = 0x10000, // 16 layers
    StreamingVideo = 0x20000,
    AmbientLit = 0x40000,
    FancyWater = 0x80000000, // ???
}

export enum ShaderAttrFlags {
    NRM = 0x1,
    CLR = 0x2,
}

export function parseShader(data: DataView, fields: ShaderFields, texIds: number[]): Shader {
    const shader: Shader = {
        layers: [],
        flags: 0,
        attrFlags: 0,
        hasAuxTex0: false,
        hasAuxTex1: false,
        hasAuxTex2: false,
        auxTex2Num: 0xffffffff,
        furRegionsTexId: null,
    };

    let numLayers = data.getUint8(fields.numLayers);
    if (numLayers > 2) {
        console.warn(`Number of shader layers greater than maximum (${numLayers} / 2)`);
        numLayers = 2;
    }
    for (let i = 0; i < numLayers; i++) {
        const layer = parseShaderLayer(dataSubarray(data, fields.layers + i * 8), texIds, !!fields.isBeta);
        shader.layers.push(layer);
    }

    if (!fields.isBeta) {
        shader.flags = data.getUint32(0x3c);
        shader.attrFlags = data.getUint8(0x40);
        shader.hasAuxTex0 = data.getUint32(0x8) !== 0;
        shader.hasAuxTex1 = data.getUint32(0x14) !== 0;
        shader.auxTex2Num = data.getUint32(0x34);
        shader.hasAuxTex2 = shader.auxTex2Num != 0xffffffff;
        shader.furRegionsTexId = parseTexId(data, 0x38, texIds);
    } else {
        shader.attrFlags = data.getUint8(0x34);
        shader.flags = 0; // TODO: where is this field?
        shader.hasAuxTex0 = data.getUint32(0x8) === 1;
        shader.hasAuxTex1 = data.getUint32(0x14) === 1;
        shader.hasAuxTex2 = !!(data.getUint8(0x37) & 0x40); // !!(data.getUint8(0x37) & 0x80);
        console.log(`beta shader @0x34: 0x${data.getUint32(0x34).toString(16)}`);
    }

    // console.log(`loaded shader: ${JSON.stringify(shader, null, '\t')}`);

    return shader;
}

export interface SFAMaterialTexture_Texture {
    kind: 'texture';
    texture: SFATexture;
}

export interface SFAMaterialTexture_FbColorDownscaled8x {
    kind: 'fb-color-downscaled-8x'; // FIXME: In addition to downscaling, some filtering is applied (I think)
}

export interface SFAMaterialTexture_FbColorDownscaled2x {
    kind: 'fb-color-downscaled-2x';
}

export interface SFAMaterialTexture_FurMap {
    kind: 'fur-map';
}

export type SFAMaterialTexture =
    SFAMaterialTexture_Texture |
    SFAMaterialTexture_FbColorDownscaled8x |
    SFAMaterialTexture_FbColorDownscaled2x |
    SFAMaterialTexture_FurMap |
    null;

export function makeMaterialTexture(texture: SFATexture | null): SFAMaterialTexture {
    if (texture) {
        return { kind: 'texture', texture };
    } else {
        return null;
    }
}

export interface SFAMaterial {
    factory: MaterialFactory;
    material: GXMaterial;
    textures: SFAMaterialTexture[];
    setupMaterialParams: (params: MaterialParams, viewerInput: ViewerRenderInput, modelMtx: mat4) => void;
}

type TexMtx = ((dst: mat4, viewerInput: ViewerRenderInput, modelMtx: mat4) => void) | undefined;

export class MaterialFactory {
    private rampTexture: SFATexture | null = null;
    private waterRelatedTexture: SFATexture | null = null;
    private wavyTexture: SFATexture | null = null;
    private furFactory: FurFactory | null = null;

    constructor(private device: GfxDevice) {
    }

    public buildMaterial(shader: Shader, texColl: TextureCollection, texIds: number[], alwaysUseTex1: boolean, isMapBlock: boolean): SFAMaterial {
        const mb = new GXMaterialBuilder('Material');
        const textures = [] as SFAMaterialTexture[];
        const texMtx: TexMtx[] = [];
        const postTexMtx: (mat4 | undefined)[] = [];
        const indTexMtx: (mat4 | undefined)[] = [];
        let tevStage = 0;
        let indStageId = GX.IndTexStageID.STAGE0;
        let texcoordId = GX.TexCoordID.TEXCOORD0;
        let texmapId = GX.TexMapID.TEXMAP0;
        let texGenSrc = GX.TexGenSrc.TEX0;
        let cprevIsValid = false;
        let aprevIsValid = false;

        const self = this;
    
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
            textures[2] = makeMaterialTexture(texColl.getTexture(self.device, shader.layers[0].texId!, alwaysUseTex1));
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD3, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
            const texture0x600 = texColl.getTexture(self.device, 0x600, false);
            textures[0] = makeMaterialTexture(texture0x600);
    
            postTexMtx[2] = mat4.create(); // TODO: shader can reference texture matrices
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, GX.PostTexGenMatrix.PTTEXMTX2);
    
            // FIXME: Don't generate a new wavy texture every time.
            // Find a place to stash one and reuse it.
            textures[1] = makeMaterialTexture(self.makeWavyTexture());
    
            postTexMtx[0] = mat4.create();
            mat4.fromScaling(postTexMtx[0], [0.9, 0.9, 1.0]);
            // TODO: animated param
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, GX.PostTexGenMatrix.PTTEXMTX0);
            
            mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1);
            mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);
            // TODO: set ind tex matrices
            mb.setTevIndirect(1, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
    
            postTexMtx[1] = mat4.create();
            mat4.fromScaling(postTexMtx[1], [1.2, 1.2, 1.0]);
            const rot45deg = mat4.create();
            mat4.fromXRotation(rot45deg, Math.PI / 4); // FIXME: which axis?
            mat4.mul(postTexMtx[1], rot45deg, postTexMtx[1]);
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, GX.PostTexGenMatrix.PTTEXMTX1);
    
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
    
        function addTevStagesForWater_OLD() {
            // TODO: set texture matrix
            mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, GX.PostTexGenMatrix.PTIDENTITY /* TODO */);
            // TODO: set texture matrix
            mb.setTexCoordGen(texcoordId + 1, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.IDENTITY);
            // TODO: don't generate a new water-related texture every time.
            // Find a place to stash one and reuse it.
            textures[texmapId] = makeMaterialTexture(self.makeWaterRelatedTexture());
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
            textures[texmapId + 1] = makeMaterialTexture(self.makeWavyTexture());
    
            indStageId += 2;
            texcoordId += 4;
            texmapId += 2;
            tevStage += 2;
        }
    
        function addTevStagesForReflectiveFloor() {
            textures[texmapId] = { kind: 'fb-color-downscaled-8x' };
            mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX2);
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
    
        function addTevStagesForNonLava() {
            if (shader.layers.length === 2 && (shader.layers[1].tevMode & 0x7f) === 9) {
                addTevStageForTextureWithWhiteKonst(0);
                if (shader.flags & ShaderFlags.Reflective) {
                    addTevStagesForReflectiveFloor();
                }
                addTevStagesForTextureWithMode(9);
                addTevStageForMultVtxColor();
    
                for (let i = 0; i < shader.layers.length; i++) {
                    textures.push(makeMaterialTexture(texColl.getTexture(self.device, shader.layers[i].texId!, alwaysUseTex1)));
                }
            } else {
                for (let i = 0; i < shader.layers.length; i++) {
                    const layer = shader.layers[i];
                    if (shader.flags & ShaderFlags.AmbientLit) {
                        addTevStagesForTextureWithSkyAmbient();
                    } else {
                        addTevStagesForTextureWithMode(layer.tevMode & 0x7f);
                    }
                }
    
                for (let i = 0; i < shader.layers.length; i++) {
                    textures.push(makeMaterialTexture(texColl.getTexture(self.device, shader.layers[i].texId!, alwaysUseTex1)));
                }
    
                if (shader.flags & ShaderFlags.Reflective) {
                    addTevStagesForReflectiveFloor();
                }
            }
        }
    
        function addTevStagesForFancyWater() {
            texMtx[0] = (dst: mat4, viewerInput: ViewerRenderInput, modelViewMtx: mat4) => {
                // Flipped
                texProjCameraSceneTex(dst, viewerInput.camera, viewerInput.viewport, 1);
                mat4.mul(dst, dst, modelViewMtx);
            };
    
            texMtx[1] = (dst: mat4, viewerInput: ViewerRenderInput, modelViewMtx: mat4) => {
                // Unflipped
                texProjCameraSceneTex(dst, viewerInput.camera, viewerInput.viewport, -1);
                mat4.mul(dst, dst, modelViewMtx);
            }
    
            textures[0] = { kind: 'fb-color-downscaled-2x' };
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX0); // TODO
            textures[1] = makeMaterialTexture(self.makeWavyTexture());
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX3); // TODO
    
            mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1);
            mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);
            indTexMtx[0] = mat4.create();
            mat4.fromScaling(indTexMtx[0], [0.5, 0.5, 1.0]);
            mb.setTevIndirect(0, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
    
            const texMtx4 = mat4.create();
            mat4.fromScaling(texMtx4, [0.83, 0.83, 0.83]);
            const rot45deg = mat4.create();
            mat4.fromXRotation(rot45deg, Math.PI / 4); // TODO: which axis?
            mat4.mul(texMtx4, rot45deg, texMtx4);
            texMtx[4] = (dst: mat4) => { mat4.copy(dst, texMtx4); };
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX4);
    
            mb.setIndTexOrder(GX.IndTexStageID.STAGE1, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP1);
            indTexMtx[1] = mat4.create();
            mat4.set(indTexMtx[1],
                0.3, -0.3, 0.0, 0.0,
                0.3, 0.3, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mb.setTevIndirect(1, GX.IndTexStageID.STAGE1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);
    
            // TODO: GXSetTevKColor
            mb.setTevKColorSel(1, GX.KonstColorSel.KCSEL_1_8); // TODO
            mb.setTevKAlphaSel(1, GX.KonstAlphaSel.KASEL_7_8); // TODO
    
            mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
            mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
            mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
            mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    
            mb.setTevOrder(1, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
            mb.setTevColorIn(1, GX.CC.KONST, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
            mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
            mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.DIVIDE_2, true, GX.Register.REG0); // TODO: CS_SCALE_1 is used in some cases
            mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG0);
    
            indTexMtx[2] = mat4.create();
            mat4.set(indTexMtx[2],
                0.0, -0.5, 0.0, 0.0,
                0.5, 0.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            
            mb.setTevIndirect(2, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._1, GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
            mb.setTevIndirect(3, GX.IndTexStageID.STAGE1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._2, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD3, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX1);
    
            mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
            mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
            mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
            mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    
            mb.setTevOrder(3, GX.TexCoordID.TEXCOORD3, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
            mb.setTevColorIn(3, GX.CC.TEXC, GX.CC.C0, GX.CC.A0, GX.CC.ZERO);
            mb.setTevAlphaIn(3, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
            mb.setTevColorOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevColorOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    
            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
            mb.setCullMode(GX.CullMode.NONE);
            mb.setZMode(true, GX.CompareType.LEQUAL, false);
            mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
            mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }
    
        if (!isMapBlock) {
            // Not a map block. Just do basic texturing.
            mb.setUsePnMtxIdx(true);
            addTevStageForTextureWithWhiteKonst(0);
            for (let i = 0; i < shader.layers.length; i++) {
                textures.push(makeMaterialTexture(texColl.getTexture(self.device, shader.layers[i].texId!, alwaysUseTex1)));
            }
        } else if (shader.flags & ShaderFlags.FancyWater) {
            addTevStagesForFancyWater();
        } else {
            texMtx[2] = (dst: mat4, viewerInput: ViewerRenderInput, modelViewMtx: mat4) => {
                // Flipped
                texProjCameraSceneTex(dst, viewerInput.camera, viewerInput.viewport, 1);
                mat4.mul(dst, dst, modelViewMtx);
                return dst;
            }
    
            if ((shader.flags & ShaderFlags.Lava) != 0) {
                addTevStagesForLava();
            } else {
                addTevStagesForNonLava();
            }
    
            if ((shader.flags & ShaderFlags.ReflectSkyscape) != 0) {
                console.log(`TODO: skyscape reflection?`);
            } else if ((shader.flags & ShaderFlags.Water) != 0) {
                addTevStagesForWater_OLD();
            } else {
                // TODO
            }
        }
        
        if (!(shader.flags & ShaderFlags.FancyWater)) {
            if ((shader.flags & 0x40000000) || (shader.flags & 0x20000000)) {
                mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
                mb.setZMode(true, GX.CompareType.LEQUAL, false);
                mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
            } else {
                mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO, GX.LogicOp.NOOP);
                mb.setZMode(true, GX.CompareType.LEQUAL, true);
                if (((shader.flags & ShaderFlags.AlphaCompare) != 0) && ((shader.flags & ShaderFlags.Lava) == 0)) {
                    mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
                } else {
                    mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
                }
            }
            mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            mb.setCullMode((shader.flags & ShaderFlags.CullBackface) != 0 ? GX.CullMode.BACK : GX.CullMode.NONE);
        }
    
        return {
            factory: this,
            material: mb.finish(),
            textures,
            setupMaterialParams: (params: MaterialParams, viewerInput: ViewerRenderInput, modelViewMtx: mat4) => {
                for (let i = 0; i < 10; i++) {
                    if (texMtx[i] !== undefined) {
                        texMtx[i]!(params.u_TexMtx[i], viewerInput, modelViewMtx);
                    }
                }
                
                for (let i = 0; i < 3; i++) {
                    if (indTexMtx[i] !== undefined) {
                        mat4.copy(params.u_IndTexMtx[i], indTexMtx[i]!);
                    }
                }
    
                for (let i = 0; i < 20; i++) {
                    if (postTexMtx[i] !== undefined) {
                        mat4.copy(params.u_PostTexMtx[i], postTexMtx[i]!);
                    }
                }
            },
        };
    }

    public buildFurMaterial(shader: Shader, texColl: TextureCollection, texIds: number[], alwaysUseTex1: boolean, isMapBlock: boolean): SFAMaterial {
        const mb = new GXMaterialBuilder('FurMaterial');
        const textures = [] as SFAMaterialTexture[];
        const texMtx: TexMtx[] = [];
        const postTexMtx: (mat4 | undefined)[] = [];
        const indTexMtx: (mat4 | undefined)[] = [];
    
        // FIXME: ??? fade ramp in texmap 0? followed by lighting-related textures...
        // but then it replaces texmap 0 with shader layer 0 before drawing...
        textures[0] = makeMaterialTexture(texColl.getTexture(this.device, shader.layers[0].texId!, alwaysUseTex1));
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevDirect(0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    
        // Ind Stage 0: Waviness
        // TODO: animate waviness to make grass sway back and forth
        textures[2] = makeMaterialTexture(this.makeWavyTexture());
        const texmtx1 = mat4.fromValues(
            0.0125/32, 0.0, 0.0, 0.0, // FIXME: divide by 32 doesn't belong here but it makes grass look neater...
            0.0, 0.0125/32, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0
        );
        texMtx[1] = (dst: mat4) => { mat4.copy(dst, texmtx1); };
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX1);
        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2);
        mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);
    
        // Stage 1: Fur map
        textures[1] = { kind: 'fur-map' };
        const texmtx0 = mat4.fromValues(
            0.1, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.1, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0
        );
        texMtx[0] = (dst: mat4) => { mat4.copy(dst, texmtx0); };
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX0);
        mb.setTevIndirect(1, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevKColorSel(1, GX.KonstColorSel.KCSEL_4_8);
        mb.setTevColorIn(1, GX.CC.TEXC, GX.CC.KONST, GX.CC.CPREV, GX.CC.CPREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        mb.setTevColorOp(1, GX.TevOp.SUB, GX.TevBias.ADDHALF, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        
        // Stage 2: Distance fade
        textures[3] = makeMaterialTexture(this.getRampTexture());
        texMtx[2] = (dst: mat4, viewerInput: ViewerRenderInput, modelViewMtx: mat4) => {
            mat4.set(dst,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                1/30, 0.0, 0.0, 0.0,
                25/3, 0.0, 0.0, 0.0 // TODO: this matrix can be tweaked to extend the draw distance, which may be desirable on high-res displays 
            );
            mat4.mul(dst, dst, modelViewMtx);
        };
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD3, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX2);
        mb.setTevDirect(2);
        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD3, GX.TexMapID.TEXMAP3, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, !!(shader.flags & ShaderFlags.AmbientLit), GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    
        return {
            factory: this,
            material: mb.finish(),
            textures,
            setupMaterialParams: (params: MaterialParams, viewerInput: ViewerRenderInput, modelViewMtx: mat4) => {
                for (let i = 0; i < 10; i++) {
                    if (texMtx[i] !== undefined) {
                        texMtx[i]!(params.u_TexMtx[i], viewerInput, modelViewMtx);
                    }
                }
                
                for (let i = 0; i < 20; i++) {
                    if (postTexMtx[i] !== undefined) {
                        mat4.copy(params.u_PostTexMtx[i], postTexMtx[i]!);
                    }
                }
    
                for (let i = 0; i < 3; i++) {
                    if (indTexMtx[i] !== undefined) {
                        mat4.copy(params.u_IndTexMtx[i], indTexMtx[i]!);
                    }
                }
            },
        };
    }

    public getFurFactory(): FurFactory {
        if (this.furFactory !== null) {
            return this.furFactory;
        }

        this.furFactory = new FurFactory(this.device);
        return this.furFactory;
    }
    
    private getRampTexture(): SFATexture {
        if (this.rampTexture !== null) {
            return this.rampTexture;
        }

        const width = 256;
        const height = 4;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
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

        for (let x = 0; x < 256; x++) {
            const I = x;
            for (let y = 0; y < 4; y++) {
                plot(x, y, I, I, I, I)
            }
        }

        const hostAccessPass = this.device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        this.device.submitPass(hostAccessPass);

        this.rampTexture = { gfxTexture, gfxSampler, width, height };
        return this.rampTexture;
    }
    
    private makeWaterRelatedTexture(): SFATexture {
        // This function generates a texture with a circular pattern used for (old) water.
        // The original function to generate this texture is not customizable and
        // generates the same texture every time it is called. (?)

        if (this.waterRelatedTexture !== null) {
            return this.waterRelatedTexture;
        }
        
        const width = 128;
        const height = 128;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
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

        for (let y = 0; y < height; y++) {
            const fy = (y - 64) / 64
            for (let x = 0; x < width; x++) {
                const fx = (x - 64) / 64
                let dist = Math.hypot(fx, fy);
                if (dist < 0.25 || 0.75 < dist) {
                    dist = 0.0
                } else {
                    let f = 2.0 * (dist - 0.25)
                    if (f <= 0.5) {
                        f = 0.5 - f
                    } else {
                        f = f - 0.5
                    }
                    dist = -(2.0 * f - 1.0)
                    if (0.0 < dist) {
                        dist = Math.sqrt(dist)
                    }
                }
                const I = 16 * dist
                plot(y, x, I, I, I, I)
            }
        }

        const hostAccessPass = this.device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        this.device.submitPass(hostAccessPass);

        this.waterRelatedTexture = { gfxTexture, gfxSampler, width, height };
        return this.waterRelatedTexture;
    }
    
    private makeWavyTexture(): SFATexture {
        // This function generates a texture with a wavy pattern used for water, lava and other materials.
        // The original function used to generate this texture is not customizable and
        // always generates the same texture every time it is called. (?)

        if (this.wavyTexture !== null) {
            return this.wavyTexture;
        }
        
        const width = 64;
        const height = 64;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
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

        const X_MUL = 0.39275 // Approximately pi / 8
        const Y_MUL = 0.0981875 // Approximately pi / 32
        for (let y = 0; y < height; y++) {
            const yAngle = Y_MUL * y
            for (let x = 0; x < width; x++) {
                const xAngle = X_MUL * x
                const iFactor = Math.cos(0.5 * Math.sin(xAngle) + yAngle)
                const aFactor = Math.cos(X_MUL * x * xAngle)
                const I = 127 * iFactor + 127
                const A = 127 * iFactor * aFactor + 127
                plot(y, x, I, I, I, A)
            }
        }

        const hostAccessPass = this.device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        this.device.submitPass(hostAccessPass);

        this.wavyTexture = { gfxTexture, gfxSampler, width, height };
        return this.wavyTexture;
    }
}