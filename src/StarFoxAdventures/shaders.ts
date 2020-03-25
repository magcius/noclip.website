import { GfxDevice, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import * as GX from '../gx/gx_enum';
import { ViewerRenderInput, Viewer } from '../viewer';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GXMaterial, SwapTable } from '../gx/gx_material';
import { MaterialParams } from '../gx/gx_render';
import { GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';

import { SFATexture, TextureCollection } from './textures';
import { dataSubarray, mat4SetRow, mat4FromRowMajor, ViewState, mat4SetValue } from './util';
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
    Caustic = 0x40,
    Lava = 0x80,
    Reflective = 0x100, // Occurs in Krazoa Palace reflective floors
    AlphaCompare = 0x400,
    ShortFur = 0x4000, // 4 layers
    MediumFur = 0x8000, // 8 layers
    LongFur = 0x10000, // 16 layers
    StreamingVideo = 0x20000,
    AmbientLit = 0x40000,
    Water = 0x80000000,
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
    setupMaterialParams: (params: MaterialParams, viewState: ViewState) => void;
}

type TexMtx = ((dst: mat4, viewState: ViewState) => void) | undefined;

export class MaterialFactory {
    private rampTexture: SFAMaterialTexture = null;
    private causticTexture: SFAMaterialTexture = null;
    private wavyTexture: SFAMaterialTexture = null;
    private halfGrayTexture: SFAMaterialTexture = null;
    private furFactory: FurFactory | null = null;

    constructor(private device: GfxDevice) {
    }

    public buildMaterial(shader: Shader, texColl: TextureCollection, texIds: number[], alwaysUseTex1: boolean, isMapBlock: boolean): SFAMaterial {
        const mb = new GXMaterialBuilder('Material');
        const textures = [] as SFAMaterialTexture[];
        const texMtx: TexMtx[] = [];
        const postTexMtx: TexMtx[] = [];
        const indTexMtx: TexMtx[] = [];
        let tevStage = 0;
        let indStageId = GX.IndTexStageID.STAGE0;
        let texcoordId = GX.TexCoordID.TEXCOORD0;
        let texmapId = GX.TexMapID.TEXMAP0;
        let texGenSrc = GX.TexGenSrc.TEX0;
        let postTexMtxId = GX.PostTexGenMatrix.PTTEXMTX0;
        let postTexMtxNum = 0;
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
    
        function addTevStagesForLava() {
            const warpParam = 1.0; // TODO: is this animated?

            indTexMtx[0] = (dst: mat4, viewState: ViewState) => {
                const animSin = Math.sin(3.142 * viewState.animController.envAnimValue1);
                const scale = (0.125 * animSin + 0.75) * warpParam;
                const cs = scale * Math.cos(3.142 * viewState.animController.envAnimValue0);
                const sn = scale * Math.sin(3.142 * viewState.animController.envAnimValue0);
                const itm0 = mat4FromRowMajor(
                    cs,  sn,  0.0, 0.0,
                    -sn, cs,  0.0, 0.0,
                    0.0, 0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0, 1.0
                );
                mat4.copy(dst, itm0);
            };

            indTexMtx[1] = (dst: mat4, viewState: ViewState) => {
                const animSin = Math.sin(3.142 * viewState.animController.envAnimValue0);
                const scale = (0.125 * animSin + 0.75) * warpParam;
                const cs = scale * Math.cos(3.142 * -viewState.animController.envAnimValue1);
                const sn = scale * Math.sin(3.142 * -viewState.animController.envAnimValue1);
                const itm1 = mat4FromRowMajor(
                    cs,  sn,  0.0, 0.0,
                    -sn, cs,  0.0, 0.0,
                    0.0, 0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0, 1.0
                );
                mat4.copy(dst, itm1);
            };

            textures[2] = makeMaterialTexture(texColl.getTexture(self.device, shader.layers[0].texId!, alwaysUseTex1));
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD3, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);

            textures[0] = makeMaterialTexture(texColl.getTexture(self.device, 0x600, false));
    
            const pttexmtx2 = mat4.create();
            postTexMtx[2] = (dst: mat4) => { mat4.copy(dst, pttexmtx2); };
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, GX.PostTexGenMatrix.PTTEXMTX2);
    
            textures[1] = self.getWavyTexture();
    
            const pttexmtx0 = mat4.create();
            mat4.fromScaling(pttexmtx0, [0.9, 0.9, 1.0]);
            postTexMtx[0] = (dst: mat4, viewState: ViewState) => {
                mat4.copy(dst, pttexmtx0);
                mat4SetValue(dst, 1, 3, 0.125 * viewState.animController.envAnimValue1);
            };

            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, GX.PostTexGenMatrix.PTTEXMTX0);
            
            mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1);
            mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);

            mb.setTevIndirect(1, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
    
            const pttexmtx1 = mat4.create();
            mat4.fromScaling(pttexmtx1, [1.2, 1.2, 1.0]);
            const rot45deg = mat4.create();
            mat4.fromZRotation(rot45deg, Math.PI / 4);
            mat4.mul(pttexmtx1, rot45deg, pttexmtx1);
            postTexMtx[1] = (dst: mat4, viewState: ViewState) => {
                mat4.copy(dst, pttexmtx1);
                const v = 0.0625 * viewState.animController.envAnimValue0;
                mat4SetValue(dst, 0, 3, v);
                mat4SetValue(dst, 1, 3, v);
            };

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
    
        function addTevStagesForCaustic() {
            const mapOriginX = 1.0; // TODO: these values exist to ensure caustics don't exhibit seams at map boundaries.
            const mapOriginZ = 1.0; // TODO

            const pttexmtx0 = mat4FromRowMajor(
                0.008, 0.0,   0.0,   0.8 * 0.01 * mapOriginX,
                0.0,   0.008, 0.0,   0.0,
                0.0,   0.0,   0.008, 0.8 * 0.01 * mapOriginZ,
                0.0,   0.0,   0.0,   0.1
            );
            const postRotate0 = mat4.create();
            mat4.fromRotation(postRotate0, 1.0, [3, -1, 1]);
            postTexMtx[postTexMtxNum] = (dst: mat4, viewState: ViewState) => {
                mat4.mul(dst, pttexmtx0, viewState.invModelViewMtx);
                mat4.mul(dst, postRotate0, dst);
                mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
            };
            mb.setTexCoordGen(texcoordId, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, postTexMtxId);
            
            const pttexmtx1 = mat4FromRowMajor(
                0.005, 0.0,   0.0,   0.5 * 0.01 * mapOriginX,
                0.0,   0.005, 0.0,   0.0,
                0.0,   0.0,   0.005, 0.5 * 0.01 * mapOriginZ,
                0.0,   0.0,   0.0,   0.1
            );
            const postRotate1 = mat4.create();
            mat4.fromRotation(postRotate1, 1.0, [1, -1, 3]);
            postTexMtx[postTexMtxNum + 1] = (dst: mat4, viewState: ViewState) => {
                mat4.mul(dst, pttexmtx1, viewState.invModelViewMtx);
                mat4.mul(dst, postRotate1, dst);
                mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
            };
            mb.setTexCoordGen(texcoordId + 1, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, postTexMtxId + 3);
            
            textures[texmapId] = self.getCausticTexture();

            const itm1 = mat4FromRowMajor(
                0.5, 0.0, 0.0, 0.0,
                0.0, 0.5, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            indTexMtx[1] = (dst: mat4) => { mat4.copy(dst, itm1); };

            mb.setIndTexOrder(indStageId, texcoordId + 2, texmapId + 1);
            mb.setIndTexScale(indStageId, GX.IndTexScale._1, GX.IndTexScale._1);

            const rot67deg = mat4.create();
            mat4.fromYRotation(rot67deg, 67 * Math.PI / 180); // TODO: which axis?
            const postRotate2 = mat4.create();
            mat4.fromRotation(postRotate2, 1.0, [1, -2, 1]);
            postTexMtx[postTexMtxNum + 2] = (dst: mat4, viewState: ViewState) => {
                const pttexmtx2 = mat4FromRowMajor(
                    0.01, 0.0,  0.0,  0.01 * mapOriginX + viewState.animController.envAnimValue0,
                    0.0,  0.01, 0.0,  0.0,
                    0.0,  0.0,  0.01, 0.01 * mapOriginZ,
                    0.0,  0.0,  0.0,  1.0
                );
                mat4.mul(pttexmtx2, rot67deg, pttexmtx2);
                mat4.mul(dst, pttexmtx2, viewState.invModelViewMtx);
                mat4.mul(dst, postRotate2, dst);
                mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
            };
            mb.setTexCoordGen(texcoordId + 2, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, postTexMtxId + 3*2);

            mb.setTevIndirect(tevStage, indStageId, GX.IndTexFormat._8, GX.IndTexBiasSel.T, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);

            mb.setIndTexOrder(indStageId + 1, texcoordId + 3, texmapId + 1);
            mb.setIndTexScale(indStageId + 1, GX.IndTexScale._1, GX.IndTexScale._1);

            const postRotate3 = mat4.create();
            mat4.fromRotation(postRotate3, 1.0, [-2, -1, 1]);
            postTexMtx[postTexMtxNum + 3] = (dst: mat4, viewState: ViewState) => {
                const pttexmtx3 = mat4FromRowMajor(
                    0.01, 0.0,  0.0,  0.01 * mapOriginX,
                    0.0,  0.01, 0.0,  0.0,
                    0.0,  0.0,  0.01, 0.01 * mapOriginZ + viewState.animController.envAnimValue1,
                    0.0,  0.0,  0.0,  1.0
                )
                mat4.mul(dst, pttexmtx3, viewState.invModelViewMtx);
                mat4.mul(dst, postRotate3, dst);
                mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
            };
            mb.setTexCoordGen(texcoordId + 3, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, postTexMtxId + 3*3);

            mb.setTevIndirect(tevStage + 1, indStageId + 1, GX.IndTexFormat._8, GX.IndTexBiasSel.T, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);
    
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
            textures[texmapId + 1] = self.getWavyTexture();
    
            indStageId += 2;
            texcoordId += 4;
            texmapId += 2;
            tevStage += 2;
            postTexMtxId += 3 * 4;
            postTexMtxNum += 4;
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
    
        if (!isMapBlock) {
            // Not a map block. Just do basic texturing.
            mb.setUsePnMtxIdx(true);
            addTevStageForTextureWithWhiteKonst(0);
            for (let i = 0; i < shader.layers.length; i++) {
                textures.push(makeMaterialTexture(texColl.getTexture(self.device, shader.layers[i].texId!, alwaysUseTex1)));
            }
        } else {
            texMtx[2] = (dst: mat4, viewState: ViewState) => {
                // Flipped
                texProjCameraSceneTex(dst, viewState.viewerInput.camera, viewState.viewerInput.viewport, 1);
                mat4.mul(dst, dst, viewState.modelViewMtx);
                return dst;
            }
    
            if ((shader.flags & ShaderFlags.Lava) != 0) {
                addTevStagesForLava();
            } else {
                addTevStagesForNonLava();
            }
    
            if ((shader.flags & ShaderFlags.ReflectSkyscape) != 0) {
                console.log(`TODO: skyscape reflection?`);
            } else if ((shader.flags & ShaderFlags.Caustic) != 0) {
                addTevStagesForCaustic();
            } else {
                // TODO
            }
        }
        
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
    
        return {
            factory: this,
            material: mb.finish(),
            textures,
            setupMaterialParams: (params: MaterialParams, viewState: ViewState) => {
                for (let i = 0; i < 10; i++) {
                    if (texMtx[i] !== undefined) {
                        texMtx[i]!(params.u_TexMtx[i], viewState);
                    }
                }
                
                for (let i = 0; i < 3; i++) {
                    if (indTexMtx[i] !== undefined) {
                        indTexMtx[i]!(params.u_IndTexMtx[i], viewState);
                    }
                }
    
                for (let i = 0; i < 20; i++) {
                    if (postTexMtx[i] !== undefined) {
                        postTexMtx[i]!(params.u_PostTexMtx[i], viewState);
                    }
                }
            },
        };
    }
    
    public buildWaterMaterial(shader: Shader, texColl: TextureCollection, texIds: number[], alwaysUseTex1: boolean, isMapBlock: boolean): SFAMaterial {
        const mb = new GXMaterialBuilder('WaterMaterial');
        const textures = [] as SFAMaterialTexture[];
        const texMtx: TexMtx[] = [];
        const postTexMtx: (mat4 | undefined)[] = [];
        const indTexMtx: (mat4 | undefined)[] = [];
        
        texMtx[0] = (dst: mat4, viewState: ViewState) => {
            // Flipped
            texProjCameraSceneTex(dst, viewState.viewerInput.camera, viewState.viewerInput.viewport, 1);
            mat4.mul(dst, dst, viewState.modelViewMtx);
        };

        texMtx[1] = (dst: mat4, viewState: ViewState) => {
            // Unflipped
            texProjCameraSceneTex(dst, viewState.viewerInput.camera, viewState.viewerInput.viewport, -1);
            mat4.mul(dst, dst, viewState.modelViewMtx);
        };

        const texmtx3 = mat4.create();
        texMtx[3] = (dst: mat4, viewState: ViewState) => {
            mat4.copy(dst, texmtx3);
            mat4SetValue(dst, 1, 3, viewState.animController.envAnimValue0);
        }

        textures[0] = { kind: 'fb-color-downscaled-2x' };
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX0); // TODO
        textures[1] = this.getWavyTexture();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX3); // TODO

        indTexMtx[1] = mat4FromRowMajor(
            0.5, 0.0, 0.0, 0.0,
            0.0, 0.5, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        );
        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1);
        mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);
        mb.setTevIndirect(0, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);

        const texmtx4 = mat4.create();
        mat4.fromScaling(texmtx4, [0.83, 0.83, 0.83]);
        const rot45deg = mat4.create();
        mat4.fromZRotation(rot45deg, Math.PI / 4);
        mat4.mul(texmtx4, rot45deg, texmtx4);
        texMtx[4] = (dst: mat4, viewState: ViewState) => {
            mat4.copy(dst, texmtx4);
            mat4SetValue(dst, 0, 3, viewState.animController.envAnimValue1);
            mat4SetValue(dst, 1, 3, viewState.animController.envAnimValue1);
        };

        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX4);

        indTexMtx[1] = mat4FromRowMajor(
            0.3,  0.3, 0.0, 0.0,
            -0.3, 0.3, 0.0, 0.0,
            0.0,  0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 1.0
        );
        mb.setIndTexOrder(GX.IndTexStageID.STAGE1, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP1);
        mb.setTevIndirect(1, GX.IndTexStageID.STAGE1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        // TODO: GXSetTevKColor
        mb.setTevKColorSel(1, GX.KonstColorSel.KCSEL_4_8); // TODO: these values depend on the environment
        mb.setTevKAlphaSel(1, GX.KonstAlphaSel.KASEL_4_8); // TODO

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

        indTexMtx[2] = mat4FromRowMajor(
            0.0,  0.5, 0.0, 0.0,
            -0.5, 0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 1.0
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

        return {
            factory: this,
            material: mb.finish(),
            textures,
            setupMaterialParams: (params: MaterialParams, viewState: ViewState) => {
                for (let i = 0; i < 10; i++) {
                    if (texMtx[i] !== undefined) {
                        texMtx[i]!(params.u_TexMtx[i], viewState);
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
        textures[2] = this.getWavyTexture();
        texMtx[1] = (dst: mat4, viewState: ViewState) => {
            mat4.fromTranslation(dst, [0.25 * viewState.animController.envAnimValue0, 0.25 * viewState.animController.envAnimValue1, 0.0]);
            mat4SetValue(dst, 0, 0, 0.0125);
            mat4SetValue(dst, 1, 1, 0.0125);
        };

        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX1);
        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2);
        mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);
    
        // Stage 1: Fur map
        textures[1] = { kind: 'fur-map' };

        const texmtx0 = mat4FromRowMajor(
            0.1, 0.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0
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
        textures[3] = this.getRampTexture();
        texMtx[2] = (dst: mat4, viewState: ViewState) => {
            mat4.set(dst,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                1/30, 0.0, 0.0, 0.0,
                25/3, 0.0, 0.0, 0.0 // TODO: this matrix can be tweaked to extend the draw distance, which may be desirable on high-res displays 
            );
            mat4.mul(dst, dst, viewState.modelViewMtx);
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
            setupMaterialParams: (params: MaterialParams, viewState: ViewState) => {
                for (let i = 0; i < 10; i++) {
                    if (texMtx[i] !== undefined) {
                        texMtx[i]!(params.u_TexMtx[i], viewState);
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

    private getHalfGrayTexture(): SFAMaterialTexture {
        // Used to test indirect texturing
        if (this.halfGrayTexture !== null) {
            return this.halfGrayTexture;
        }

        const width = 1;
        const height = 1;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
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

        plot(0, 0, 127, 127, 127, 127);

        const hostAccessPass = this.device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        this.device.submitPass(hostAccessPass);

        this.rampTexture = makeMaterialTexture({ gfxTexture, gfxSampler, width, height });
        return this.rampTexture;
    }
    
    private getRampTexture(): SFAMaterialTexture {
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

        this.rampTexture = makeMaterialTexture({ gfxTexture, gfxSampler, width, height });
        return this.rampTexture;
    }
    
    private getCausticTexture(): SFAMaterialTexture {
        // This function generates a texture with a circular pattern used for caustics.
        // The original function to generate this texture is not customizable and
        // generates the same texture every time it is called. (?)

        if (this.causticTexture !== null) {
            return this.causticTexture;
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

        this.causticTexture = makeMaterialTexture({ gfxTexture, gfxSampler, width, height });
        return this.causticTexture;
    }
    
    private getWavyTexture(): SFAMaterialTexture {
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

        const X_MUL = 0.39275; // Approximately pi / 8
        const Y_MUL = 0.0981875; // Approximately pi / 32
        for (let y = 0; y < height; y++) {
            let yAngle = Y_MUL * y
            for (let x = 0; x < width; x++) {
                const xAngle = X_MUL * x;
                const iFactor = Math.cos(0.5 * Math.sin(xAngle) + yAngle);
                const aFactor = Math.cos(xAngle);
                const I = 127 * iFactor + 127;
                const A = 127 * iFactor * aFactor + 127;
                plot(y, x, I, I, I, A);
            }
        }

        const hostAccessPass = this.device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        this.device.submitPass(hostAccessPass);

        this.wavyTexture = makeMaterialTexture({ gfxTexture, gfxSampler, width, height });
        return this.wavyTexture;
    }
}