import { GfxDevice, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import * as GX from '../gx/gx_enum';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GXMaterial, SwapTable } from '../gx/gx_material';
import { MaterialParams, ColorKind } from '../gx/gx_render';
import { GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';

import { SFATexture, TextureFetcher } from './textures';
import { dataSubarray, mat4SetRow, mat4FromRowMajor, ViewState, mat4SetValue } from './util';
import { mat4 } from 'gl-matrix';
import { texProjCameraSceneTex } from '../Camera';
import { FurFactory } from './fur';
import { SFAAnimationController } from './animation';
import { colorFromRGBA, Color, colorCopy, colorNewFromRGBA } from '../Color';
import { nArray } from '../util';
import { EnvfxManager } from './envfx';

interface ShaderLayer {
    texId: number | null;
    tevMode: number;
    enableTexChainStuff: number;
    scrollingTexMtx: number | undefined;
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
    const scrollingTexMtx = data.getUint8(0x6);
    return {
        texId: parseTexId(data, 0x0, texIds),
        tevMode: data.getUint8(0x4),
        enableTexChainStuff: data.getUint8(0x5),
        scrollingTexMtx: scrollingTexMtx || undefined,
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
    DisableChan0 = 0x40000,
    StreamingVideo = 0x20000,
    IndoorOutdoorBlend = 0x40000, // Occurs near cave entrances and windows. Requires special handling for lighting.
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
    shader: Shader;
    gxMaterial: GXMaterial;
    setupMaterialParams: (params: MaterialParams, viewState: ViewState) => void;
    rebuild: () => void;
    getTexture: (num: number) => SFAMaterialTexture;
}

type TexMtxFunc = ((dst: mat4, viewState: ViewState) => void) | undefined;
type ColorFunc = ((dst: Color, viewState: ViewState) => void) | undefined;

interface ScrollingTexMtx {
    x: number;
    y: number;
    dxPerFrame: number;
    dyPerFrame: number;
}

const MAX_SCROLL = 0x100000;

interface TevStage {
    id: number;
}

interface TexMap {
    id: number;
}

function getTexMapID(texMap: TexMap): GX.TexMapID {
    return GX.TexMapID.TEXMAP0 + texMap.id;
}

interface PostTexMtx {
    id: number;
}

function getPostTexGenMatrix(postTexMtx: PostTexMtx): GX.PostTexGenMatrix {
    return GX.PostTexGenMatrix.PTTEXMTX0 + 3 * postTexMtx.id;
}

interface IndTexMtx {
    id: number;
}

interface KonstColor {
    id: number;
}

function getKonstColorSel(kcolor: KonstColor): GX.KonstColorSel {
    return GX.KonstColorSel.KCSEL_K0 + kcolor.id;
}

class StandardMaterial implements SFAMaterial {
    public gxMaterial: GXMaterial;
    private mb: GXMaterialBuilder;
    private texMtx: TexMtxFunc[] = [];
    private indStageId = GX.IndTexStageID.STAGE0;
    private texcoordId = GX.TexCoordID.TEXCOORD0;
    private texGenSrc = GX.TexGenSrc.TEX0;
    private ambColors: ColorFunc[] = [];
    private cprevIsValid = false;
    private aprevIsValid = false;

    constructor(public device: GfxDevice, public factory: MaterialFactory, public shader: Shader, public texFetcher: TextureFetcher, private isMapBlock: boolean) {
        this.rebuild();
    }

    public rebuild() {
        this.mb = new GXMaterialBuilder();
        this.tevStageNum = 0;
        this.texMaps = [];
        this.texMtx = [];
        this.postTexMtxs = [];
        this.indTexMtxs = [];
        this.indStageId = GX.IndTexStageID.STAGE0;
        this.texcoordId = GX.TexCoordID.TEXCOORD0;
        this.texMaps = [];
        this.texGenSrc = GX.TexGenSrc.TEX0;
        this.konstColors = [];
        this.cprevIsValid = false;
        this.aprevIsValid = false;
        
        if (!this.isMapBlock) {
            // Not a map block. Just do basic texturing.
            this.mb.setUsePnMtxIdx(true);
            const texMap = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));
            this.addTevStageForTextureWithWhiteKonst(0, texMap, true);
        } else {
            this.texMtx[2] = (dst: mat4, viewState: ViewState) => {
                // Flipped
                texProjCameraSceneTex(dst, viewState.viewerInput.camera, viewState.viewerInput.viewport, 1);
                mat4.mul(dst, dst, viewState.modelViewMtx);
                return dst;
            }
    
            if ((this.shader.flags & ShaderFlags.Lava) != 0) {
                this.addTevStagesForLava();
            } else {
                this.addTevStagesForNonLava();
            }
    
            if ((this.shader.flags & ShaderFlags.ReflectSkyscape) != 0) {
                console.log(`TODO: skyscape reflection?`);
            } else if ((this.shader.flags & ShaderFlags.Caustic) != 0) {
                this.addTevStagesForCaustic();
            } else {
                // TODO
            }
        }
        
        if ((this.shader.flags & 0x40000000) || (this.shader.flags & 0x20000000)) {
            this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
            this.mb.setZMode(true, GX.CompareType.LEQUAL, false);
            this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        } else {
            this.mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO, GX.LogicOp.NOOP);
            this.mb.setZMode(true, GX.CompareType.LEQUAL, true);
            if (((this.shader.flags & ShaderFlags.AlphaCompare) != 0) && ((this.shader.flags & ShaderFlags.Lava) == 0)) {
                this.mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
            } else {
                this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
            }
        }

        if (this.shader.flags & ShaderFlags.DisableChan0) {
            this.ambColors[0] = undefined; // AMB0 is solid white
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else if ((this.shader.flags & 1) || (this.shader.flags & 0x800) || (this.shader.flags & 0x1000)) {
            this.ambColors[0] = undefined; // AMB0 is solid white
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else {
            this.ambColors[0] = (dst: Color, viewState: ViewState) => {
                colorCopy(dst, viewState.outdoorAmbientColor);
            };
            // this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 0xff, GX.DiffuseFunction.NONE, GX.AttenuationFunction.SPOT);
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }
        // FIXME: Objects have different rules for color-channels than map blocks
        if (this.isMapBlock) {
            this.mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }
        this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        this.mb.setCullMode((this.shader.flags & ShaderFlags.CullBackface) != 0 ? GX.CullMode.BACK : GX.CullMode.NONE);

        this.gxMaterial = this.mb.finish();
    }

    public setupMaterialParams(params: MaterialParams, viewState: ViewState) {
        for (let i = 0; i < 10; i++) {
            if (this.texMtx[i] !== undefined) {
                this.texMtx[i]!(params.u_TexMtx[i], viewState);
            }
        }
        
        for (let i = 0; i < 3; i++) {
            if (this.indTexMtxs[i] !== undefined) {
                this.indTexMtxs[i]!(params.u_IndTexMtx[i], viewState);
            }
        }

        for (let i = 0; i < 20; i++) {
            if (this.postTexMtxs[i] !== undefined) {
                this.postTexMtxs[i]!(params.u_PostTexMtx[i], viewState);
            }
        }

        for (let i = 0; i < 2; i++) {
            if (this.ambColors[i] !== undefined) {
                this.ambColors[i]!(params.u_Color[ColorKind.AMB0 + i], viewState);
            } else {
                colorFromRGBA(params.u_Color[ColorKind.AMB0 + i], 1.0, 1.0, 1.0, 1.0);
            }
        }

        for (let i = 0; i < 4; i++) {
            if (this.konstColors[i] !== undefined) {
                this.konstColors[i]!(params.u_Color[ColorKind.K0 + i], viewState);
            } else {
                colorFromRGBA(params.u_Color[ColorKind.K0 + i], 1.0, 1.0, 1.0, 1.0);
            }
        }
    }

    public getTexture(num: number): SFAMaterialTexture {
        return this.texMaps[num];
    }

    private tevStageNum = 0;

    private genTevStage(): TevStage {
        const id = this.tevStageNum;
        this.tevStageNum++;
        return { id };
    }

    private texMaps: SFAMaterialTexture[] = [];

    private genTexMap(texture: SFAMaterialTexture) {
        const id = this.texMaps.length;
        this.texMaps.push(texture);
        return { id };
    }

    private postTexMtxs: TexMtxFunc[] = [];

    private genPostTexMtx(func: TexMtxFunc): PostTexMtx {
        const id = this.postTexMtxs.length;
        this.postTexMtxs.push(func);
        return { id };
    }

    private indTexMtxs: TexMtxFunc[] = [];

    private genIndTexMtx(func: TexMtxFunc): IndTexMtx {
        const id = this.indTexMtxs.length;
        this.indTexMtxs.push(func);
        return { id };
    }

    private konstColors: ColorFunc[] = [];

    private genKonstColor(func: ColorFunc): KonstColor {
        const id = this.konstColors.length;
        this.konstColors.push(func);
        return { id };
    }

    private setTevColorFormula(stage: TevStage, a: GX.CC, b: GX.CC, c: GX.CC, d: GX.CC, op: GX.TevOp = GX.TevOp.ADD, bias: GX.TevBias = GX.TevBias.ZERO, scale: GX.TevScale = GX.TevScale.SCALE_1, clamp: boolean = true, reg: GX.Register = GX.Register.PREV) {
        this.mb.setTevColorIn(stage.id, a, b, c, d);
        this.mb.setTevColorOp(stage.id, op, bias, scale, clamp, reg);
    }
    
    private setTevAlphaFormula(stage: TevStage, a: GX.CA, b: GX.CA, c: GX.CA, d: GX.CA, op: GX.TevOp = GX.TevOp.ADD, bias: GX.TevBias = GX.TevBias.ZERO, scale: GX.TevScale = GX.TevScale.SCALE_1, clamp: boolean = true, reg: GX.Register = GX.Register.PREV) {
        this.mb.setTevAlphaIn(stage.id, a, b, c, d);
        this.mb.setTevAlphaOp(stage.id, op, bias, scale, clamp, reg);
    }
    
    private addTevStagesForIndoorOutdoorBlend(texMap: TexMap, scrollingTexMtx?: number) {
        if (scrollingTexMtx !== undefined) {
            const scroll = this.factory.scrollingTexMtxs[scrollingTexMtx];
            const postTexMtx = this.genPostTexMtx((dst: mat4) => {
                mat4.fromTranslation(dst, [scroll.x / MAX_SCROLL, scroll.y / MAX_SCROLL, 0]);
            });

            this.mb.setTexCoordGen(this.texcoordId, GX.TexGenType.MTX2x4, this.texGenSrc, GX.TexGenMatrix.IDENTITY, false, getPostTexGenMatrix(postTexMtx));
        } else {
            this.mb.setTexCoordGen(this.texcoordId, GX.TexGenType.MTX2x4, this.texGenSrc, GX.TexGenMatrix.IDENTITY);
        }

        // Stage 0: Multiply vertex color by outdoor ambient color
        const stage0 = this.genTevStage();
        const kcnum = this.genKonstColor((dst: Color, viewState: ViewState) => {
            colorCopy(dst, viewState.outdoorAmbientColor);
        });
        this.mb.setTevKColorSel(stage0.id, getKonstColorSel(kcnum));
        this.mb.setTevDirect(stage0.id);
        this.mb.setTevOrder(stage0.id, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.KONST, GX.CC.RASC, GX.CC.ZERO);
        this.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        // Stage 1: Blend previous stage with vertex color by vertex alpha
        const stage1 = this.genTevStage();
        this.mb.setTevDirect(stage1.id);
        this.mb.setTevOrder(stage1.id, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage1, GX.CC.CPREV, GX.CC.RASC, GX.CC.RASA, GX.CC.ZERO);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        // Stage 2: Multiply by texture
        const stage2 = this.genTevStage();
        this.mb.setTevDirect(stage2.id);
        this.mb.setTevOrder(stage2.id, this.texcoordId, getTexMapID(texMap), GX.RasColorChannelID.COLOR_ZERO);
        this.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.TEXC, GX.CC.ZERO);
        this.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);

        this.texcoordId++;
        this.texGenSrc++;
    }

    private addTevStagesForTextureWithMode(mode: number, texMap: TexMap, scrollingTexMtx?: number) {
        if (scrollingTexMtx !== undefined) {
            const scroll = this.factory.scrollingTexMtxs[scrollingTexMtx];
            const postTexMtx = this.genPostTexMtx((dst: mat4) => {
                mat4.fromTranslation(dst, [scroll.x / MAX_SCROLL, scroll.y / MAX_SCROLL, 0]);
            });

            this.mb.setTexCoordGen(this.texcoordId, GX.TexGenType.MTX2x4, this.texGenSrc, GX.TexGenMatrix.IDENTITY, false, getPostTexGenMatrix(postTexMtx));
        } else {
            this.mb.setTexCoordGen(this.texcoordId, GX.TexGenType.MTX2x4, this.texGenSrc, GX.TexGenMatrix.IDENTITY);
        }

        const stage = this.genTevStage();

        this.mb.setTevDirect(stage.id);
        this.mb.setTevOrder(stage.id, this.texcoordId, getTexMapID(texMap), GX.RasColorChannelID.COLOR0A0);
        // Only modes 0 and 9 occur in map blocks. Other modes
        // occur in object and character models.
        let cc: GX.CC[];
        switch (mode) {
        case 0:
            cc = [GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO];
            break;
        case 1: // Default case in original executable
            // FIXME: double-check
            cc = [GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO];
            break;
        case 9:
            cc = [GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO];
            break;
        default:
            console.warn(`Unhandled tev color-in mode ${mode}`);
            cc = [GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO];
            break;
        }

        let ca: GX.CA[];
        if (!this.aprevIsValid) {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO];
            this.aprevIsValid = true;
        } else {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO];
        }

        this.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;

        this.texcoordId++;
        this.texGenSrc++;
    }

    private addTevStageForTextureWithWhiteKonst(colorInMode: number, texMap: TexMap, kcolor?: boolean, scrollingTexMtx?: number) {
        if (scrollingTexMtx !== undefined) {
            const scroll = this.factory.scrollingTexMtxs[scrollingTexMtx];
            const postTexMtx = this.genPostTexMtx((dst: mat4) => {
                mat4.fromTranslation(dst, [scroll.x / MAX_SCROLL, scroll.y / MAX_SCROLL, 0]);
            });

            this.mb.setTexCoordGen(this.texcoordId, GX.TexGenType.MTX2x4, this.texGenSrc, GX.TexGenMatrix.IDENTITY, false, getPostTexGenMatrix(postTexMtx));
        } else {
            this.mb.setTexCoordGen(this.texcoordId, GX.TexGenType.MTX2x4, this.texGenSrc, GX.TexGenMatrix.IDENTITY);
        }

        const stage = this.genTevStage();

        if (kcolor) {
            const kcnum = this.genKonstColor((dst: Color, viewState: ViewState) => {
                colorCopy(dst, viewState.outdoorAmbientColor);
            });
            this.mb.setTevKColorSel(stage.id, getKonstColorSel(kcnum));
        }

        this.mb.setTevDirect(stage.id);
        this.mb.setTevOrder(stage.id, this.texcoordId, getTexMapID(texMap), GX.RasColorChannelID.COLOR0A0);

        let cc: GX.CC[];
        switch (colorInMode) {
        case 0:
            cc = [GX.CC.ZERO, GX.CC.TEXC, kcolor ? GX.CC.KONST : GX.CC.ONE, GX.CC.ZERO];
            break;
        default:
            console.warn(`Unhandled colorInMode ${colorInMode}`);
            cc = [GX.CC.ZERO, GX.CC.TEXC, kcolor ? GX.CC.KONST : GX.CC.ONE, GX.CC.ZERO];
            break;
        }

        let ca: GX.CA[];
        if (!this.aprevIsValid) {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO];
            this.aprevIsValid = true;
        } else {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO];
        }
        
        this.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;

        this.texcoordId++;
        this.texGenSrc++;
    }

    private addTevStageForMultVtxColor() {
        // TODO: handle konst alpha. map block renderer always passes opaque white to this function.

        const stage = this.genTevStage();
        this.mb.setTevDirect(stage.id);
        this.mb.setTevOrder(stage.id, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevKAlphaSel(stage.id, GX.KonstAlphaSel.KASEL_1); // TODO: handle non-opaque alpha
        let cc: GX.CC[];
        let ca: GX.CA[];
        if (stage.id === 0 || !this.cprevIsValid) {
            cc = [GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC];
            ca = [GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST];
        } else {
            cc = [GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO];
            ca = [GX.CA.ZERO, GX.CA.APREV, GX.CA.KONST, GX.CA.ZERO];
        }

        this.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;
    }
    
    private addTevStagesForLava() {
        const warpParam = 1.0; // TODO: is this animated?

        const indTexMtx0 = this.genIndTexMtx((dst: mat4, viewState: ViewState) => {
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
        });

        const indTexMtx1 = this.genIndTexMtx((dst: mat4, viewState: ViewState) => {
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
        });

        const texMap0 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, 0x600, false)));
        const texMap1 = this.genTexMap(this.factory.getWavyTexture());
        const texMap2 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));

        this.mb.setTexCoordGen(GX.TexCoordID.TEXCOORD3, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);

        const pttexmtx0 = mat4.create();
        mat4.fromScaling(pttexmtx0, [0.9, 0.9, 1.0]);
        const postTexMtx0 = this.genPostTexMtx((dst: mat4, viewState: ViewState) => {
            mat4.copy(dst, pttexmtx0);
            mat4SetValue(dst, 1, 3, 0.125 * viewState.animController.envAnimValue1);
        });

        const pttexmtx1 = mat4.create();
        mat4.fromScaling(pttexmtx1, [1.2, 1.2, 1.0]);
        const rot45deg = mat4.create();
        mat4.fromZRotation(rot45deg, Math.PI / 4);
        mat4.mul(pttexmtx1, rot45deg, pttexmtx1);
        const postTexMtx1 = this.genPostTexMtx((dst: mat4, viewState: ViewState) => {
            mat4.copy(dst, pttexmtx1);
            const v = 0.0625 * viewState.animController.envAnimValue0;
            mat4SetValue(dst, 0, 3, v);
            mat4SetValue(dst, 1, 3, v);
        });

        const pttexmtx2 = mat4.create();
        const postTexMtx2 = this.genPostTexMtx((dst: mat4) => {
            mat4.copy(dst, pttexmtx2);
        });
        this.mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, getPostTexGenMatrix(postTexMtx2));

        this.mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, getPostTexGenMatrix(postTexMtx0));
        
        this.mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD1, getTexMapID(texMap1));
        this.mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);

        this.mb.setTevIndirect(1, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);

        this.mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, getPostTexGenMatrix(postTexMtx1));

        this.mb.setIndTexOrder(GX.IndTexStageID.STAGE1, GX.TexCoordID.TEXCOORD2, getTexMapID(texMap1));
        this.mb.setIndTexScale(GX.IndTexStageID.STAGE1, GX.IndTexScale._1, GX.IndTexScale._1);
        this.mb.setTevIndirect(2, GX.IndTexStageID.STAGE1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        const stage0 = this.genTevStage();
        const stage1 = this.genTevStage();

        // TODO: set and use tev kcolor
        this.mb.setTevKAlphaSel(stage0.id, GX.KonstAlphaSel.KASEL_4_8); // TODO
        this.mb.setTevKColorSel(stage1.id, GX.KonstColorSel.KCSEL_4_8); // TODO

        this.mb.setTevDirect(stage0.id);
        const swap3: SwapTable = [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.R];
        this.mb.setTevOrder(stage0.id, GX.TexCoordID.TEXCOORD0, getTexMapID(texMap2), GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevSwapMode(stage0.id, undefined, swap3);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        this.setTevAlphaFormula(stage0, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_4);
        this.cprevIsValid = true;

        this.mb.setTevOrder(stage1.id, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        this.setTevColorFormula(stage1, GX.CC.KONST, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

        const stage2 = this.genTevStage();
        this.mb.setTevOrder(stage2.id, GX.TexCoordID.TEXCOORD3, getTexMapID(texMap0), GX.RasColorChannelID.COLOR_ZERO);
        this.setTevColorFormula(stage2, GX.CC.CPREV, GX.CC.TEXC, GX.CC.APREV, GX.CC.ZERO);
        this.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        this.mb.setTevSwapMode(stage2.id, undefined, undefined);

        this.texGenSrc = 4;
        this.texcoordId = 4;
        this.indStageId = 2;
    }
    
    private addTevStagesForCaustic() {
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
        const postTexMtx0 = this.genPostTexMtx((dst: mat4, viewState: ViewState) => {
            mat4.mul(dst, pttexmtx0, viewState.invModelViewMtx);
            mat4.mul(dst, postRotate0, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        this.mb.setTexCoordGen(this.texcoordId, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getPostTexGenMatrix(postTexMtx0));
        
        const pttexmtx1 = mat4FromRowMajor(
            0.005, 0.0,   0.0,   0.5 * 0.01 * mapOriginX,
            0.0,   0.005, 0.0,   0.0,
            0.0,   0.0,   0.005, 0.5 * 0.01 * mapOriginZ,
            0.0,   0.0,   0.0,   0.1
        );
        const postRotate1 = mat4.create();
        mat4.fromRotation(postRotate1, 1.0, [1, -1, 3]);
        const postTexMtx1 = this.genPostTexMtx((dst: mat4, viewState: ViewState) => {
            mat4.mul(dst, pttexmtx1, viewState.invModelViewMtx);
            mat4.mul(dst, postRotate1, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        this.mb.setTexCoordGen(this.texcoordId + 1, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getPostTexGenMatrix(postTexMtx1));
        
        const texMap0 = this.genTexMap(this.factory.getCausticTexture());
        const texMap1 = this.genTexMap(this.factory.getWavyTexture());

        const itm1 = mat4FromRowMajor(
            0.5, 0.0, 0.0, 0.0,
            0.0, 0.5, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        );
        this.indTexMtxs[1] = (dst: mat4) => { mat4.copy(dst, itm1); };

        this.mb.setIndTexOrder(this.indStageId, this.texcoordId + 2, getTexMapID(texMap1));
        this.mb.setIndTexScale(this.indStageId, GX.IndTexScale._1, GX.IndTexScale._1);

        const rot67deg = mat4.create();
        mat4.fromYRotation(rot67deg, 67 * Math.PI / 180); // TODO: which axis?
        const postRotate2 = mat4.create();
        mat4.fromRotation(postRotate2, 1.0, [1, -2, 1]);
        const postTexMtx2 = this.genPostTexMtx((dst: mat4, viewState: ViewState) => {
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
        });
        this.mb.setTexCoordGen(this.texcoordId + 2, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getPostTexGenMatrix(postTexMtx2));

        const stage0 = this.genTevStage();
        this.mb.setTevIndirect(stage0.id, this.indStageId, GX.IndTexFormat._8, GX.IndTexBiasSel.T, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);

        this.mb.setIndTexOrder(this.indStageId + 1, this.texcoordId + 3, getTexMapID(texMap1));
        this.mb.setIndTexScale(this.indStageId + 1, GX.IndTexScale._1, GX.IndTexScale._1);

        const postRotate3 = mat4.create();
        mat4.fromRotation(postRotate3, 1.0, [-2, -1, 1]);
        const postTexMtx3 = this.genPostTexMtx((dst: mat4, viewState: ViewState) => {
            const pttexmtx3 = mat4FromRowMajor(
                0.01, 0.0,  0.0,  0.01 * mapOriginX,
                0.0,  0.01, 0.0,  0.0,
                0.0,  0.0,  0.01, 0.01 * mapOriginZ + viewState.animController.envAnimValue1,
                0.0,  0.0,  0.0,  1.0
            );
            mat4.mul(dst, pttexmtx3, viewState.invModelViewMtx);
            mat4.mul(dst, postRotate3, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        this.mb.setTexCoordGen(this.texcoordId + 3, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getPostTexGenMatrix(postTexMtx3));

        const stage1 = this.genTevStage();
        this.mb.setTevIndirect(stage1.id, this.indStageId + 1, GX.IndTexFormat._8, GX.IndTexBiasSel.T, GX.IndTexMtxID._1, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        this.mb.setTevOrder(stage0.id, this.texcoordId, getTexMapID(texMap0), GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.RASA, GX.CC.TEXA, GX.CC.CPREV);
        this.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        this.cprevIsValid = true;

        this.mb.setTevOrder(stage1.id, this.texcoordId + 1, getTexMapID(texMap0), GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage1, GX.CC.ZERO, GX.CC.RASA, GX.CC.TEXA, GX.CC.CPREV);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

        this.indStageId += 2;
        this.texcoordId += 4;
    }

    private addTevStagesForReflectiveFloor() {
        const texMap0 = this.genTexMap({ kind: 'fb-color-downscaled-8x' });
        this.mb.setTexCoordGen(this.texcoordId, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX2);

        const stage = this.genTevStage();
        this.mb.setTevDirect(stage.id);
        this.mb.setTevKColorSel(stage.id, GX.KonstColorSel.KCSEL_2_8);
        this.mb.setTevOrder(stage.id, this.texcoordId, getTexMapID(texMap0), GX.RasColorChannelID.COLOR_ZERO);
        this.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.CPREV);
        this.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        this.cprevIsValid = true;

        this.texcoordId++;
    }

    private addTevStagesForNonLava() {
        if (this.shader.layers.length === 2 && (this.shader.layers[1].tevMode & 0x7f) === 9) {
            const texMap0 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));
            const texMap1 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[1].texId!, true)));

            this.addTevStageForTextureWithWhiteKonst(0, texMap0, undefined, this.shader.layers[0].scrollingTexMtx);
            if (this.shader.flags & ShaderFlags.Reflective) {
                this.addTevStagesForReflectiveFloor();
            }
            this.addTevStagesForTextureWithMode(9, texMap1, this.shader.layers[1].scrollingTexMtx);
            this.addTevStageForMultVtxColor();
        } else {
            for (let i = 0; i < this.shader.layers.length; i++) {
                const texMap = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[i].texId!, true)));

                const layer = this.shader.layers[i];
                if (this.shader.flags & ShaderFlags.IndoorOutdoorBlend) {
                    this.addTevStagesForIndoorOutdoorBlend(texMap, layer.scrollingTexMtx);
                } else {
                    this.addTevStagesForTextureWithMode(layer.tevMode & 0x7f, texMap, layer.scrollingTexMtx);
                }
            }

            if (this.shader.flags & ShaderFlags.Reflective) {
                this.addTevStagesForReflectiveFloor();
            }
        }
    }
}

export class MaterialFactory {
    private rampTexture: SFAMaterialTexture = null;
    private causticTexture: SFAMaterialTexture = null;
    private wavyTexture: SFAMaterialTexture = null;
    private halfGrayTexture: SFAMaterialTexture = null;
    private furFactory: FurFactory | null = null;
    public scrollingTexMtxs: ScrollingTexMtx[] = [];

    constructor(private device: GfxDevice, private envfxMan?: EnvfxManager) {
    }

    public getAmbientColor(ambienceNum: number): Color {
        if (this.envfxMan !== undefined) {
            return this.envfxMan.getAmbientColor(ambienceNum);
        } else {
            return colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);
        }
    }

    public update(animController: SFAAnimationController) {
        for (let i = 0; i < this.scrollingTexMtxs.length; i++) {
            const scrollingTexMtx = this.scrollingTexMtxs[i];
            scrollingTexMtx.x = (animController.animController.getTimeInFrames() * scrollingTexMtx.dxPerFrame) % MAX_SCROLL;
            scrollingTexMtx.y = (animController.animController.getTimeInFrames() * scrollingTexMtx.dyPerFrame) % MAX_SCROLL;
        }
    }

    public setupScrollingTexMtx(dxPerFrame: number, dyPerFrame: number): number {
        this.scrollingTexMtxs.push({
            x: 0, y: 0, dxPerFrame, dyPerFrame
        });
        return this.scrollingTexMtxs.length - 1;
    }

    public buildMaterial(shader: Shader, texFetcher: TextureFetcher, isMapBlock: boolean): SFAMaterial {
        return new StandardMaterial(this.device, this, shader, texFetcher, isMapBlock);
    }
    
    public buildWaterMaterial(shader: Shader, texFetcher: TextureFetcher, isMapBlock: boolean): SFAMaterial {
        const mb = new GXMaterialBuilder('WaterMaterial');
        const textures = [] as SFAMaterialTexture[];
        const texMtx: TexMtxFunc[] = [];
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
            shader,
            gxMaterial: mb.finish(),
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

                // TODO: color register C0 controls underwater visibility and water color
            },
            rebuild: () => {
                throw Error(`rebuild not implemented for water shader`);
            },
            getTexture: (num: number) => {
                return textures[num];
            },
        };
    }

    public buildFurMaterial(shader: Shader, texFetcher: TextureFetcher, alwaysUseTex1: boolean, isMapBlock: boolean): SFAMaterial {
        const mb = new GXMaterialBuilder('FurMaterial');
        const textures = [] as SFAMaterialTexture[];
        const texMtx: TexMtxFunc[] = [];
        const postTexMtx: (mat4 | undefined)[] = [];
        const indTexMtx: (mat4 | undefined)[] = [];
        const ambColors: ColorFunc[] = [];
    
        // FIXME: ??? fade ramp in texmap 0? followed by lighting-related textures...
        // but then it replaces texmap 0 with shader layer 0 before drawing...
        textures[0] = makeMaterialTexture(texFetcher.getTexture(this.device, shader.layers[0].texId!, alwaysUseTex1));
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevDirect(0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    
        // Ind Stage 0: Waviness
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

        // This texture matrix, when combined with a POS tex-gen, creates
        // texture coordinates that increase linearly on the model's XZ plane.
        const texmtx0 = mat4FromRowMajor(
            0.1, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.1, 0.0,
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
    
        if (shader.flags & ShaderFlags.DisableChan0) {
            ambColors[0] = undefined; // AMB0 is solid white
            mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else if ((shader.flags & 1) || (shader.flags & 0x800) || (shader.flags & 0x1000)) {
            ambColors[0] = undefined; // AMB0 is solid white
            mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else {
            ambColors[0] = (dst: Color, viewState: ViewState) => {
                colorCopy(dst, viewState.outdoorAmbientColor);
            };
            mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }
        // FIXME: Objects have different rules for color-channels than map blocks
        if (isMapBlock) {
            mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }
        mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        mb.setCullMode(GX.CullMode.BACK);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    
        return {
            factory: this,
            shader,
            gxMaterial: mb.finish(),
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
                
                for (let i = 0; i < 2; i++) {
                    if (ambColors[i] !== undefined) {
                        ambColors[i]!(params.u_Color[ColorKind.AMB0 + i], viewState);
                    } else {
                        colorFromRGBA(params.u_Color[ColorKind.AMB0 + i], 1.0, 1.0, 1.0, 1.0);
                    }
                }
            },
            rebuild: () => {
                throw Error(`rebuild not implemented for fur shader`);
            },
            getTexture: (num: number) => {
                return textures[num];
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

    public getHalfGrayTexture(): SFAMaterialTexture {
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
    
    public getRampTexture(): SFAMaterialTexture {
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
    
    public getCausticTexture(): SFAMaterialTexture {
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
    
    public getWavyTexture(): SFAMaterialTexture {
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