import { GfxDevice, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import * as GX from '../gx/gx_enum';
import { SwapTable } from '../gx/gx_material';
import { GXMaterialHelperGfx, MaterialParams } from '../gx/gx_render';
import { GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { TextureMapping } from '../TextureHolder';
import { texProjCameraSceneTex } from '../Camera';

import { SFATexture, TextureFetcher } from './textures';
import { mat4SetRow, mat4FromRowMajor, mat4SetValue, mat4SetRowMajor, mat4SetTranslation } from './util';
import { mat4, vec3 } from 'gl-matrix';
import { FurFactory } from './fur';
import { SFAAnimationController } from './animation';
import { colorFromRGBA, Color, colorCopy, White, OpaqueBlack, colorNewCopy, TransparentBlack, colorNewFromRGBA, colorLerp, Red } from '../Color';
import { SceneRenderContext } from './render';
import { ColorFunc, getGXIndTexMtxID, getGXIndTexMtxID_S, getGXIndTexMtxID_T, getGXKonstAlphaSel, getGXKonstColorSel, getGXPostTexGenMatrix, IndTexStage, SFAMaterialBuilder, TevStage, TexCoord, TexFunc, TexMap } from './MaterialBuilder';
import { clamp, lerp } from '../MathHelpers';
import { ModelRenderContext } from './models';
import { World } from './world';

export interface ShaderLayer {
    texId: number | null;
    tevMode: number;
    enableScroll: number;
    scrollSlot?: number | undefined;
}

export interface Shader {
    layers: ShaderLayer[],
    flags: number;
    attrFlags: number;

    hasHemisphericProbe: boolean;

    hasReflectiveProbe: boolean;
    reflectiveProbeMaskTexId: number | null;
    reflectiveProbeIdx: number;
    reflectiveAmbFactor: number;

    hasNBTTexture: boolean;
    nbtTexId: number | null;
    nbtParams: number;

    furRegionsTexId: number | null; // Only used in character models, not blocks (??)
    color: Color;

    // Model properties
    isAncient?: boolean;
    isBeta?: boolean;
    normalFlags: number;
    lightFlags: number;
    texMtxCount: number;
}

export enum ShaderAttrFlags {
    NRM = 0x1,
    CLR = 0x2,
}

export const enum NormalFlags {
    HasVertexColor = 0x2,
    NBT = 0x8,
    HasVertexAlpha = 0x10,
}

export const enum LightFlags {
    OverrideLighting = 0x2,
}

export enum ShaderFlags {
    DevGeometry = 0x2,
    Fog = 0x4,
    CullBackface = 0x8,
    ReflectSkyscape = 0x20, // ???
    Caustic = 0x40,
    Lava = 0x80,
    Reflective = 0x100, // Occurs on Krazoa Palace reflective floors
    AlphaCompare = 0x400,
    ShortFur = 0x4000, // 4 layers
    MediumFur = 0x8000, // 8 layers
    LongFur = 0x10000, // 16 layers
    StreamingVideo = 0x20000, // Occurs on video panels in Great Fox. Used to display preview video.
    IndoorOutdoorBlend = 0x40000, // Occurs near cave entrances and windows. Requires special handling for lighting.
    Water = 0x80000000,
}

export function makeMaterialTexture(texture: SFATexture | null): TexFunc<any> {
    if (texture !== null) {
        return (mapping: TextureMapping) => texture.setOnTextureMapping(mapping);
    } else {
        return (mapping: TextureMapping) => mapping.reset();
    }
}

export function makeOpaqueColorTextureDownscale2x(): TexFunc<any> {
    return (mapping: TextureMapping) => {
        mapping.reset();
        mapping.lateBinding = 'opaque-color-texture-downscale-2x';
        mapping.width = 320;
        mapping.height = 240;
    };
}

export function makeOpaqueDepthTextureDownscale2x(): TexFunc<any> {
    return (mapping: TextureMapping) => {
        mapping.reset();
        mapping.lateBinding = 'opaque-depth-texture-downscale-2x';
        mapping.width = 320;
        mapping.height = 240;
    };
}

export function makeTemporalTextureDownscale8x(): TexFunc<any> {
    return  (mapping: TextureMapping) => {
        mapping.reset();
        mapping.lateBinding = 'temporal-texture-downscale-8x';
        mapping.width = 80;
        mapping.height = 60;
    };
}

export function makeHemisphericProbeTexture(): TexFunc<MaterialRenderContext> {
    return  (mapping: TextureMapping, ctx: MaterialRenderContext) => {
        mapping.reset();
        mapping.lateBinding = `sphere-map-${5 - ctx.ambienceIdx}`;
        mapping.width = 32;
        mapping.height = 32;
    };
}

export function makeReflectiveProbeTexture(idx: number): TexFunc<any> {
    return  (mapping: TextureMapping) => {
        mapping.reset();
        mapping.lateBinding = `sphere-map-${idx}`;
        mapping.width = 32;
        mapping.height = 32;
    };
}

function makeFurMapMaterialTexture(factory: MaterialFactory): TexFunc<MaterialRenderContext> {
    return (mapping: TextureMapping, matCtx: MaterialRenderContext) => {
        mapping.reset();
        const furMap = factory.getFurFactory().getLayer(matCtx.furLayer);
        mapping.gfxTexture = furMap.gfxTexture;
        mapping.gfxSampler = furMap.gfxSampler;
        mapping.width = furMap.width;
        mapping.height = furMap.height;
        mapping.lodBias = 0.0;
    };
}

export interface MapLight {
    radius: number;
    color: Color;
    viewPosition: vec3;
}

export interface MaterialRenderContext {
    sceneCtx: SceneRenderContext;
    modelToViewMtx: mat4;
    viewToModelMtx: mat4;
    ambienceIdx: number;
    outdoorAmbientColor: Color;
    furLayer: number;

    // For map blocks only
    mapLights?: MapLight[];
}

export interface SFAMaterial {
    setOnMaterialParams: (params: MaterialParams, ctx: MaterialRenderContext) => void;
    getGXMaterialHelper: () => GXMaterialHelperGfx;
    rebuild: () => void;
}

interface ScrollSlot {
    x: number;
    y: number;
    dxPerFrame: number;
    dyPerFrame: number;
}

const MAX_SCROLL = 0x100000;

export abstract class MaterialBase implements SFAMaterial {
    protected mb: SFAMaterialBuilder<MaterialRenderContext>;
    private built: boolean = false;

    constructor(public factory: MaterialFactory, private name: string | null = null) {
        this.mb = new SFAMaterialBuilder(name);
    }

    public rebuild() {
        this.built = false;
        this.mb.reset();
        this.rebuildInternal();
        this.built = true;
    }

    protected abstract rebuildInternal(): void;

    public setOnMaterialParams(params: MaterialParams, ctx: MaterialRenderContext) {
        if (!this.built)
            this.rebuild();
        this.mb.setOnMaterialParams(params, ctx);
    }

    public getGXMaterialHelper() {
        return this.mb.getGXMaterialHelper();
    }
}

export type BlendOverride = ((mb: SFAMaterialBuilder<MaterialRenderContext>) => void) | undefined;

export abstract class StandardMaterial extends MaterialBase {
    private blendOverride?: BlendOverride = undefined;

    constructor(public device: GfxDevice, factory: MaterialFactory, public shader: Shader, public texFetcher: TextureFetcher) {
        super(factory);
    }

    protected abstract rebuildSpecialized(): void;

    protected rebuildInternal() {
        this.rebuildSpecialized();

        this.mb.setCullMode((this.shader.flags & ShaderFlags.CullBackface) != 0 ? GX.CullMode.BACK : GX.CullMode.NONE);

        if (this.blendOverride !== undefined) {
            this.blendOverride(this.mb);
        } else if ((this.shader.flags & 0x40000000) || (this.shader.flags & 0x20000000)) {
            this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
            this.mb.setZMode(true, GX.CompareType.LEQUAL, false);
            this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        } else {
            this.mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO, GX.LogicOp.NOOP);
            this.mb.setZMode(true, GX.CompareType.LEQUAL, true);
            if ((this.shader.flags & ShaderFlags.AlphaCompare) && !(this.shader.flags & ShaderFlags.Lava))
                this.mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
            else
                this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        }
    }

    public setBlendOverride(blendOverride?: BlendOverride) {
        this.blendOverride = blendOverride;
    }
    
    protected addMistStages() {
        const ptmtx0 = this.mb.genPostTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            if (ctx.sceneCtx.world === undefined || !ctx.sceneCtx.world.envfxMan.mistEnable)
                return; // Skip if mist is disabled

            const mistParams = [
                5.0e-4,
                0.1,
                1000.0,
                ctx.sceneCtx.world.envfxMan.mistBottom,
                ctx.sceneCtx.world.envfxMan.mistTop,
            ];

            const f = -1.0 / (mistParams[4] - mistParams[3]);
            mat4SetRowMajor(dst,
                0.0, 0.0, -1.0 / mistParams[2], mistParams[1],
                f * ctx.sceneCtx.viewToWorldMtx[4*0+1], f * ctx.sceneCtx.viewToWorldMtx[4*1+1], f * ctx.sceneCtx.viewToWorldMtx[4*2+1], f * ctx.sceneCtx.viewToWorldMtx[4*3+1] - mistParams[4] * f,
                0.0, 0.0, 0.0, 1.0,
                0.0, 0.0, 0.0, 1.0
            );
        });
        const texCoord0 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getGXPostTexGenMatrix(ptmtx0));

        const kcolor = this.mb.genKonstColor((dst: Color, ctx: MaterialRenderContext) => {
            if (ctx.sceneCtx.world?.envfxMan.mistEnable)
                ctx.sceneCtx.world.envfxMan.getFogColor(dst, ctx.ambienceIdx);
        });

        const texMap0 = this.mb.genTexMap((dst: TextureMapping, ctx: MaterialRenderContext) => {
            if (ctx.sceneCtx.world?.envfxMan.enableFog && ctx.sceneCtx.world?.envfxMan.mistEnable) {
                ctx.sceneCtx.world.envfxMan.getMistTexture().setOnTextureMapping(dst);
            } else {
                this.factory.getTransparentBlackTexture().setOnTextureMapping(dst);
            }
        });

        const enableWavyMist = false;
        if (enableWavyMist) {
            // TODO
        } else {
            const stage = this.mb.genTevStage();
            this.mb.setTevDirect(stage);
            this.mb.setTevOrder(stage, texCoord0, texMap0, GX.RasColorChannelID.COLOR_ZERO);
            this.mb.setTevColorFormula(stage, GX.CC.CPREV, GX.CC.KONST, GX.CC.TEXA, GX.CC.ZERO);
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
            this.mb.setTevKColorSel(stage, getGXKonstColorSel(kcolor));
        }
    }
}

export class StandardMapMaterial extends StandardMaterial {
    private cprevIsValid = false;
    private aprevIsValid = false;

    protected genScrollableTexCoord(texMap: TexMap, texGenSrc: GX.TexGenSrc, scrollSlot?: number): TexCoord {
        if (scrollSlot !== undefined) {
            const scroll = this.factory.scrollSlots[scrollSlot];
            const postTexMtx = this.mb.genPostTexMtx((dst: mat4) => {
                mat4.fromTranslation(dst, [scroll.x / MAX_SCROLL, scroll.y / MAX_SCROLL, 0]);
            });

            return this.mb.genTexCoord(GX.TexGenType.MTX2x4, texGenSrc, undefined, undefined, getGXPostTexGenMatrix(postTexMtx));
        } else {
            return this.mb.genTexCoord(GX.TexGenType.MTX2x4, texGenSrc);
        }
    }

    protected addTevStagesForIndoorOutdoorBlend(texMap: TexMap, texCoord: TexCoord) {
        // Stage 0: Multiply vertex color by outdoor ambient color
        const stage0 = this.mb.genTevStage();
        const kcnum = this.mb.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
            colorCopy(dst, matCtx.outdoorAmbientColor);
        });
        this.mb.setTevKColorSel(stage0, getGXKonstColorSel(kcnum));
        this.mb.setTevDirect(stage0);
        this.mb.setTevOrder(stage0, null, null, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.KONST, GX.CC.RASC, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        // Stage 1: Blend previous stage with vertex color by vertex alpha
        const stage1 = this.mb.genTevStage();
        this.mb.setTevDirect(stage1);
        this.mb.setTevOrder(stage1, null, null, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage1, GX.CC.CPREV, GX.CC.RASC, GX.CC.RASA, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        // Stage 2: Multiply by texture
        const stage2 = this.mb.genTevStage();
        this.mb.setTevDirect(stage2);
        this.mb.setTevOrder(stage2, texCoord, texMap);
        this.mb.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.TEXC, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
    }

    protected addTevStagesForTextureWithMode(mode: number, texMap: TexMap, texCoord: TexCoord) {
        const stage = this.mb.genTevStage();

        this.mb.setTevDirect(stage);
        this.mb.setTevOrder(stage, texCoord, texMap, GX.RasColorChannelID.COLOR0A0);

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

        this.mb.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.mb.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;
    }

    protected addTevStageForTexture(colorInMode: number, texMap: TexMap, texCoord: TexCoord, multiplyOutdoorAmbient: boolean = false) {
        const stage = this.mb.genTevStage();

        if (multiplyOutdoorAmbient) {
            const kcnum = this.mb.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
                colorCopy(dst, matCtx.outdoorAmbientColor);
            });
            this.mb.setTevKColorSel(stage, getGXKonstColorSel(kcnum));
        }

        this.mb.setTevDirect(stage);
        this.mb.setTevOrder(stage, texCoord, texMap, GX.RasColorChannelID.COLOR0A0);

        let cc: GX.CC[];
        switch (colorInMode) {
        case 0:
            cc = [GX.CC.ZERO, GX.CC.TEXC, multiplyOutdoorAmbient ? GX.CC.KONST : GX.CC.ONE, GX.CC.ZERO];
            break;
        default:
            console.warn(`Unhandled colorInMode ${colorInMode}`);
            cc = [GX.CC.ZERO, GX.CC.TEXC, multiplyOutdoorAmbient ? GX.CC.KONST : GX.CC.ONE, GX.CC.ZERO];
            break;
        }

        let ca: GX.CA[];
        if (!this.aprevIsValid) {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO];
            this.aprevIsValid = true;
        } else {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO];
        }
        
        this.mb.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.mb.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;
    }

    protected addTevStageForMultColor0A0() {
        // TODO: handle konst alpha. map block renderer always passes opaque white to this function.
        // object renderer might pass different values.

        const stage = this.mb.genTevStage();
        this.mb.setTevDirect(stage);
        this.mb.setTevOrder(stage, null, null, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevKAlphaSel(stage, GX.KonstAlphaSel.KASEL_1); // TODO: handle non-opaque alpha
        let cc: GX.CC[];
        let ca: GX.CA[];
        if (stage === 0 || !this.cprevIsValid) {
            cc = [GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC];
            ca = [GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST];
        } else {
            cc = [GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO];
            ca = [GX.CA.ZERO, GX.CA.APREV, GX.CA.KONST, GX.CA.ZERO];
        }

        this.mb.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.mb.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;
    }
    
    protected addTevStagesForLava() {
        const warpParam = 1.0; // TODO: is this animated?

        const indTexMtx0 = this.mb.genIndTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            const animSin = Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue1);
            const scale = (0.125 * animSin + 0.75) * warpParam;
            const cs = scale * Math.cos(3.142 * matCtx.sceneCtx.animController.envAnimValue0);
            const sn = scale * Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue0);
            mat4SetRowMajor(dst,
                cs,  sn,  0.0, 0.0,
                -sn, cs,  0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mat4.multiplyScalar(dst, dst, 1 / 4); // scale_exp -2
        });

        const indTexMtx1 = this.mb.genIndTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            const animSin = Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue0);
            const scale = (0.125 * animSin + 0.75) * warpParam;
            const cs = scale * Math.cos(3.142 * -matCtx.sceneCtx.animController.envAnimValue1);
            const sn = scale * Math.sin(3.142 * -matCtx.sceneCtx.animController.envAnimValue1);
            mat4SetRowMajor(dst,
                cs,  sn,  0.0, 0.0,
                -sn, cs,  0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mat4.multiplyScalar(dst, dst, 1 / 4); // scale_exp -2
        });

        const texMap0 = this.mb.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, 0x600, false)));
        const texMap1 = this.mb.genTexMap(this.factory.getWavyTexture());
        const texMap2 = this.mb.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));

        const texCoord3 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0);

        const pttexmtx0 = mat4.create();
        mat4.fromScaling(pttexmtx0, [0.9, 0.9, 1.0]);
        const postTexMtx0 = this.mb.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.copy(dst, pttexmtx0);
            mat4SetValue(dst, 1, 3, 0.125 * matCtx.sceneCtx.animController.envAnimValue1);
        });

        const pttexmtx1 = mat4.create();
        mat4.fromScaling(pttexmtx1, [1.2, 1.2, 1.0]);
        const rot45deg = mat4.create();
        mat4.fromZRotation(rot45deg, Math.PI / 4);
        mat4.mul(pttexmtx1, rot45deg, pttexmtx1);
        const postTexMtx1 = this.mb.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.copy(dst, pttexmtx1);
            const v = 0.0625 * matCtx.sceneCtx.animController.envAnimValue0;
            mat4SetValue(dst, 0, 3, v);
            mat4SetValue(dst, 1, 3, v);
        });

        const postTexMtx2 = this.mb.genPostTexMtx((dst: mat4) => {
            mat4.identity(dst); // TODO?
            // FIXME: this matrix is used for scrollable textures.
            // It is unknown whether scrollable textures are ever used on lava.
        });

        const texCoord0 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, undefined, undefined, getGXPostTexGenMatrix(postTexMtx2));

        const texCoord1 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, undefined, undefined, getGXPostTexGenMatrix(postTexMtx0));
        
        const indStage0 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage0, texCoord1, texMap1);
        this.mb.setIndTexScale(indStage0, GX.IndTexScale._1, GX.IndTexScale._1);

        const stage0 = this.mb.genTevStage();
        const stage1 = this.mb.genTevStage();
        const stage2 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage1, indStage0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx0), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);

        const texCoord2 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, undefined, undefined, getGXPostTexGenMatrix(postTexMtx1));

        const indStage1 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage1, texCoord2, texMap1);
        this.mb.setIndTexScale(indStage1, GX.IndTexScale._1, GX.IndTexScale._1);
        this.mb.setTevIndirect(stage2, indStage1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        const kcnum = this.mb.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
            const animSin = Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue0);
            const factor = 0.5 * animSin + 0.5;
            colorFromRGBA(dst, 64 * factor / 0xff, 0, 0, 0xc0 / 0xff);
        });

        this.mb.setTevKAlphaSel(stage0, getGXKonstAlphaSel(kcnum));

        this.mb.setTevKColorSel(stage1, getGXKonstColorSel(kcnum));

        this.mb.setTevDirect(stage0);
        this.mb.setTevOrder(stage0, texCoord0, texMap2, GX.RasColorChannelID.COLOR0A0);
        const swap3: SwapTable = [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.R];
        this.mb.setTevSwapMode(stage0, undefined, swap3);
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage0, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_4);
        this.cprevIsValid = true;

        this.mb.setTevOrder(stage1);
        this.mb.setTevColorFormula(stage1, GX.CC.KONST, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

        this.mb.setTevOrder(stage2, texCoord3, texMap0);
        this.mb.setTevColorFormula(stage2, GX.CC.CPREV, GX.CC.TEXC, GX.CC.APREV, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
    }

    protected addTevStagesForCaustic() {
        const mapOriginX = 1.0; // TODO: these values are set to ensure caustics don't exhibit seams at block boundaries.
        const mapOriginZ = 1.0; // TODO

        const pttexmtx0 = mat4.create();
        mat4.fromScaling(pttexmtx0, [0.008, 0.008, 0.008]);
        mat4SetTranslation(pttexmtx0, 0.8 * 0.01 * mapOriginX, 0.0, 0.8 * 0.01 * mapOriginZ);
        const postRotate0 = mat4.create();
        mat4.fromRotation(postRotate0, 1.0, [3, -1, 1]);
        const postTexMtx0 = this.mb.genPostTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            mat4.mul(dst, pttexmtx0, ctx.sceneCtx.viewToWorldMtx);
            mat4.mul(dst, postRotate0, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        const texCoord0 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getGXPostTexGenMatrix(postTexMtx0));
        
        const pttexmtx1 = mat4.create();
        mat4.fromScaling(pttexmtx1, [0.005, 0.005, 0.005]);
        mat4SetTranslation(pttexmtx1, 0.5 * 0.01 * mapOriginX, 0.0, 0.5 * 0.01 * mapOriginZ);
        const postRotate1 = mat4.create();
        mat4.fromRotation(postRotate1, 1.0, [1, -1, 3]);
        const postTexMtx1 = this.mb.genPostTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            mat4.mul(dst, pttexmtx1, ctx.sceneCtx.viewToWorldMtx);
            mat4.mul(dst, postRotate1, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        const texCoord1 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getGXPostTexGenMatrix(postTexMtx1));
        
        const texMap0 = this.mb.genTexMap(this.factory.getCausticTexture());
        const texMap1 = this.mb.genTexMap(this.factory.getWavyTexture());
        
        const rot67deg = mat4.create();
        mat4.fromYRotation(rot67deg, 67 * Math.PI / 180); // TODO: which axis?
        const postRotate2 = mat4.create();
        mat4.fromRotation(postRotate2, 1.0, [1, -2, 1]);
        const pttexmtx2 = mat4.create();
        const postTexMtx2 = this.mb.genPostTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            mat4.fromScaling(pttexmtx2, [0.01, 0.01, 0.01]);
            mat4SetTranslation(pttexmtx2, 0.01 * mapOriginX + ctx.sceneCtx.animController.envAnimValue0, 0.0, 0.01 * mapOriginZ);
            mat4.mul(pttexmtx2, rot67deg, pttexmtx2);
            mat4.mul(dst, pttexmtx2, ctx.sceneCtx.viewToWorldMtx);
            mat4.mul(dst, postRotate2, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        const texCoord2 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getGXPostTexGenMatrix(postTexMtx2));

        const indTexMtx1 = this.mb.genIndTexMtx((dst: mat4) => {
            mat4.fromScaling(dst, [0.5, 0.5, 0.0]);
            mat4.multiplyScalar(dst, dst, 1 / 2); // scale_exp -1
        });

        const indStage0 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage0, texCoord2, texMap1);
        this.mb.setIndTexScale(indStage0, GX.IndTexScale._1, GX.IndTexScale._1);

        const postRotate3 = mat4.create();
        mat4.fromRotation(postRotate3, 1.0, [-2, -1, 1]);
        const pttexmtx3 = mat4.create();
        const postTexMtx3 = this.mb.genPostTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            mat4.fromScaling(pttexmtx3, [0.01, 0.01, 0.01]);
            mat4SetTranslation(pttexmtx3, 0.01 * mapOriginX, 0.0, 0.01 * mapOriginZ + ctx.sceneCtx.animController.envAnimValue1);
            mat4.mul(dst, pttexmtx3, ctx.sceneCtx.viewToWorldMtx);
            mat4.mul(dst, postRotate3, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        const texCoord3 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getGXPostTexGenMatrix(postTexMtx3));

        const stage0 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage0, indStage0, GX.IndTexFormat._8, GX.IndTexBiasSel.T, getGXIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);

        const indStage1 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage1, texCoord3, texMap1);
        this.mb.setIndTexScale(indStage1, GX.IndTexScale._1, GX.IndTexScale._1);

        const stage1 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage1, indStage1, GX.IndTexFormat._8, GX.IndTexBiasSel.T, getGXIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        this.mb.setTevOrder(stage0, texCoord0, texMap0, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.RASA, GX.CC.TEXA, GX.CC.CPREV);
        this.mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        this.cprevIsValid = true;

        this.mb.setTevOrder(stage1, texCoord1, texMap0, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage1, GX.CC.ZERO, GX.CC.RASA, GX.CC.TEXA, GX.CC.CPREV);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
    }

    protected addTevStagesForReflectiveFloor() {
        // TODO: Proper planar reflections?
        const texMap0 = this.mb.genTexMap(makeTemporalTextureDownscale8x());
        const texCoord = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX2);

        const stage = this.mb.genTevStage();
        this.mb.setTevDirect(stage);
        this.mb.setTevKColorSel(stage, GX.KonstColorSel.KCSEL_2_8);
        this.mb.setTevOrder(stage, texCoord, texMap0, GX.RasColorChannelID.COLOR_ZERO);
        this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.CPREV);
        this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        this.cprevIsValid = true;
    }

    protected addTevStagesForNonLava() {
        if (this.shader.layers.length === 2 && (this.shader.layers[1].tevMode & 0x7f) === 9) {
            const texMap0 = this.mb.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));
            const texCoord0 = this.genScrollableTexCoord(texMap0, GX.TexGenSrc.TEX0, this.shader.layers[0].scrollSlot);
            const texMap1 = this.mb.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[1].texId!, true)));
            const texCoord1 = this.genScrollableTexCoord(texMap1, GX.TexGenSrc.TEX1, this.shader.layers[1].scrollSlot);

            this.addTevStageForTexture(0, texMap0, texCoord0);
            if (this.shader.flags & ShaderFlags.Reflective)
                this.addTevStagesForReflectiveFloor();
            this.addTevStagesForTextureWithMode(9, texMap1, texCoord1);
            this.addTevStageForMultColor0A0();
        } else {
            for (let i = 0; i < this.shader.layers.length; i++) {
                const layer = this.shader.layers[i];

                const texMap = this.mb.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[i].texId!, true)));
                const texCoord = this.genScrollableTexCoord(texMap, GX.TexGenSrc.TEX0 + i, layer.scrollSlot);

                if (this.shader.flags & ShaderFlags.IndoorOutdoorBlend)
                    this.addTevStagesForIndoorOutdoorBlend(texMap, texCoord);
                else
                    this.addTevStagesForTextureWithMode(layer.tevMode & 0x7f, texMap, texCoord);
            }

            if (this.shader.flags & ShaderFlags.Reflective)
                this.addTevStagesForReflectiveFloor();
        }
    }

    protected addLightStage(idx: number, lightToC1: boolean) {
        const texMtx0 = this.mb.genPostTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            if (ctx.mapLights !== undefined && idx < ctx.mapLights.length) {
                const light = ctx.mapLights[idx];
                const radius = Math.max(0.1, light.radius);
                const s = 0.5 / radius;
                mat4SetRowMajor(dst,
                    s, 0, 0, -light.viewPosition[0] * s + 0.5,
                    0, 0, s, -light.viewPosition[2] * s + 0.5,
                    0, 0, 0, 1,
                    0, 0, 0, 1
                );
            } else
                mat4.identity(dst);
        });
        const texMtx1 = this.mb.genPostTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            if (ctx.mapLights !== undefined && idx < ctx.mapLights.length) {
                const light = ctx.mapLights[idx];
                const radius = Math.max(0.1, light.radius);
                const s = 0.5 / radius;
                mat4SetRowMajor(dst,
                    0, s, 0, -light.viewPosition[1] * s + 0.5,
                    0, 0, 0, 0.5,
                    0, 0, 0, 1,
                    0, 0, 0, 1
                );
            } else
                mat4.identity(dst);
        });
        const texMap = this.mb.genTexMap(this.factory.getMapLightTexture());
        const texCoord0 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getGXPostTexGenMatrix(texMtx0));
        const texCoord1 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getGXPostTexGenMatrix(texMtx1));

        const stage0 = this.mb.genTevStage();
        this.mb.setTevDirect(stage0);
        this.mb.setTevOrder(stage0, texCoord0, texMap, GX.RasColorChannelID.COLOR_ZERO);
        const kcolor = this.mb.genKonstColor((dst: Color, ctx: MaterialRenderContext) => {
            if (ctx.mapLights !== undefined && idx < ctx.mapLights.length)
                colorCopy(dst, ctx.mapLights[idx].color);
            else
                colorCopy(dst, TransparentBlack);
        });
        this.mb.setTevKColorSel(stage0, getGXKonstColorSel(kcolor));
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.KONST, GX.CC.TEXC, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG0);
        this.mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

        const stage1 = this.mb.genTevStage();
        this.mb.setTevDirect(stage1);
        this.mb.setTevOrder(stage1, texCoord1, texMap, GX.RasColorChannelID.COLOR_ZERO);
        this.mb.setTevColorFormula(stage1, GX.CC.ZERO, GX.CC.C0, GX.CC.TEXC, lightToC1 ? GX.CC.C1 : GX.CC.CPREV, undefined, undefined, undefined, undefined, lightToC1 ? GX.Register.REG1 : GX.Register.PREV);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
    }

    protected addLightStages() {
        let tevLimit = 16;
        let lightToC1 = false;
        if ((this.shader.flags & 0x800) || (this.shader.flags & 0x1000)) {
            tevLimit = 12;
            lightToC1 = true;
        }

        let i = 0;
        while (this.mb.getTevStageCount() < tevLimit && this.mb.getTexCoordCount() < 7 && this.mb.getKonstColorCount() < 4) {
            this.addLightStage(i, lightToC1);
            i++;
        }

        if (this.shader.flags & 0x800) {
            // Multiply with C1

            // CPREV = CPREV * C1
            // APREV = APREV
            const stage = this.mb.genTevStage();
            this.mb.setTevDirect(stage);
            this.mb.setTevOrder(stage, null, null, GX.RasColorChannelID.COLOR_ZERO);
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.CPREV, GX.CC.C1, GX.CC.ZERO);
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        } else if (this.shader.flags & 0x1000) {
            // Blend C1 via RASA

            // C2 = CPREV * C1
            // APREV = APREV
            const stage0 = this.mb.genTevStage();
            this.mb.setTevDirect(stage0);
            this.mb.setTevOrder(stage0, null, null, GX.RasColorChannelID.COLOR_ZERO);
            this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.CPREV, GX.CC.C1, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG2);
            this.mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

            // CPREV = C1
            // APREV = APREV
            const stage1 = this.mb.genTevStage();
            this.mb.setTevDirect(stage1);
            this.mb.setTevOrder(stage1, null, null, GX.RasColorChannelID.COLOR_ZERO);
            this.mb.setTevColorFormula(stage1, GX.CC.C1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
            this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

            // CPREV = mix(CPREV, C2, RASA)
            // APREV = APREV
            const stage2 = this.mb.genTevStage();
            this.mb.setTevDirect(stage2);
            this.mb.setTevOrder(stage2, null, null, GX.RasColorChannelID.COLOR0A0);
            this.mb.setTevColorFormula(stage2, GX.CC.CPREV, GX.CC.C2, GX.CC.RASA, GX.CC.ZERO);
            this.mb.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

            // Overall:
            // CPREV = mix(C1, CPREV * C1, RASA)
            // APREV = APREV
        }
    }

    protected rebuildSpecialized() {
        this.cprevIsValid = false;
        this.aprevIsValid = false;

        this.mb.setTexMtx(2, (dst: mat4, matCtx: MaterialRenderContext) => {
            // Flipped
            texProjCameraSceneTex(dst, matCtx.sceneCtx.viewerInput.camera, 1);
            mat4.mul(dst, dst, matCtx.modelToViewMtx);
            return dst;
        });

        if (this.shader.flags & ShaderFlags.Lava)
            this.addTevStagesForLava();
        else
            this.addTevStagesForNonLava();

        if (this.shader.flags & ShaderFlags.ReflectSkyscape)
            console.log(`TODO: skyscape reflection?`);
        else if (this.shader.flags & ShaderFlags.Caustic)
            this.addTevStagesForCaustic();
        else {
            // TODO
            this.addMistStages();
        }

        if (this.shader.isAncient) {
            // XXX: show vertex colors in ancient maps
            this.addTevStageForMultColor0A0();
        }

        this.addLightStages();

        // FIXME: flags 0x1, 0x800 and 0x1000 are not well-understood
        if ((this.shader.flags & 0x1) || (this.shader.flags & ShaderFlags.IndoorOutdoorBlend) || (this.shader.flags & 0x800) || (this.shader.flags & 0x1000)) {
            this.mb.setAmbColor(0, undefined); // AMB0 is opaque white
            if (this.shader.flags & ShaderFlags.IndoorOutdoorBlend)
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            else
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else {
            // AMB0 is the outdoor ambient color
            this.mb.setAmbColor(0, (dst: Color, matCtx: MaterialRenderContext) => {
                colorCopy(dst, matCtx.outdoorAmbientColor);
            });
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }

        this.mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        if (this.shader.isAncient) {
            // XXX: show vertex colors in ancient maps
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }

        this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    }
}

class StandardObjectMaterial extends StandardMaterial {
    private cprevIsValid = false;
    private aprevIsValid = false;
    private ambProbeTexCoord?: TexCoord = undefined;
    private enableHemisphericProbe = false;
    private enableReflectiveProbe = false;

    private addNBTTextureStage(): number { // Returns scale to use for nbtTexCoord
        const indStage = this.mb.genIndTexStage();
        const indTexMtx = this.mb.genIndTexMtx((dst: mat4) => {
            mat4.fromScaling(dst, [0.5, 0.5, 0.0]);
        });
        const nbtTex = this.texFetcher.getTexture(this.device, this.shader.nbtTexId!, true)!;
        const nbtTexMap = this.mb.genTexMap(makeMaterialTexture(nbtTex));
        let nbtScale = 1;
        if (this.shader.layers[0].texId !== null) {
            const layer0Tex = this.texFetcher.getTexture(this.device, this.shader.layers[0].texId, true);
            if (layer0Tex !== null) {
                nbtScale = (this.shader.nbtParams & 0xf) * 4 + 1;
                const scaleIdx = (layer0Tex.width / (nbtTex.width * nbtScale))|0;
                if (scaleIdx !== 0) {
                    // TODO: GXSetIndTexCoordScale (I can't find an example of this code being triggered)
                    console.warn(`TODO: GXSetIndTexCoordScale in addNBTTextureStage`);
                    nbtScale = 0;
                }
            }
        }
        let nbtTexCoord = 1 as TexCoord; // FIXME: verify correctness. This (probably) finds the TexCoord for the first shader layer.
        if (this.enableHemisphericProbe)
            nbtTexCoord = 2 as TexCoord;
        if (this.enableReflectiveProbe)
            nbtTexCoord = (nbtTexCoord+1) as TexCoord;
        this.mb.setIndTexOrder(indStage, nbtTexCoord, nbtTexMap);

        const pttexmtx = this.mb.genPostTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            const s = 0.5 * 3.0 * ((this.shader.nbtParams >> 4) / 7.0 - 1.0);
            mat4.fromScaling(dst, [s, s, 0.0]);
            mat4SetTranslation(dst, 0.0, 0.0, 1.0);
        });
        // Matrix comes from TEX0MTXIDX
        const binrmTexCoord = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.BINRM, GX.TexGenMatrix.TEXMTX0, false, getGXPostTexGenMatrix(pttexmtx));
        this.mb.setTexCoordUsesMtxIdx(binrmTexCoord);
        // Matrix comes from TEX1MTXIDX
        const tanTexCoord = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TANGENT, GX.TexGenMatrix.TEXMTX0, false, getGXPostTexGenMatrix(pttexmtx));
        this.mb.setTexCoordUsesMtxIdx(tanTexCoord);

        const stage0 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage0, indStage, GX.IndTexFormat._8, GX.IndTexBiasSel.ST, getGXIndTexMtxID_S(indTexMtx), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevOrder(stage0, binrmTexCoord, (nbtTexMap + 1) as TexMap, GX.RasColorChannelID.COLOR_ZERO);
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, stage0 !== 0 ? GX.CC.CPREV : GX.CC.RASC);
        this.mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, stage0 !== 0 ? GX.CA.APREV : GX.CA.RASA);

        const stage1 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage1, indStage, GX.IndTexFormat._8, GX.IndTexBiasSel.ST, getGXIndTexMtxID_T(indTexMtx), GX.IndTexWrap._0, GX.IndTexWrap._0, true, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevOrder(stage1, tanTexCoord, (nbtTexMap + 1) as TexMap, GX.RasColorChannelID.COLOR_ZERO);
        this.mb.setTevColorFormula(stage1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, stage1 !== 0 ? GX.CC.CPREV : GX.CC.RASC);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, stage1 !== 0 ? GX.CA.APREV : GX.CA.RASA);

        // Set tev indirect on the following stage
        this.mb.setTevIndirect((stage1 + 1) as TevStage, indStage, GX.IndTexFormat._8, GX.IndTexBiasSel.NONE, GX.IndTexMtxID.OFF, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        return nbtScale;
    }

    private getAmbientProbeTexCoord(): TexCoord {
        if (this.ambProbeTexCoord === undefined) {
            const ptmtx = this.mb.genPostTexMtx((dst: mat4) => {
                mat4.fromTranslation(dst, [0.5, 0.5, 1.0]);
                const flipY = -1; // XXX: the flipY situation is confusing. Is this the solution or can it be handled elsewhere?
                mat4.scale(dst, dst, [-0.5, -0.5 * flipY, 0.0]);
            });
            // Matrix comes from TEX0MTXIDX (or TEX2MTXIDX if NBT textures are used)
            this.ambProbeTexCoord = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.NRM, GX.TexGenMatrix.TEXMTX0, false, getGXPostTexGenMatrix(ptmtx));
            this.mb.setTexCoordUsesMtxIdx(this.ambProbeTexCoord);
        }

        return this.ambProbeTexCoord;
    }

    // Emits REG1 = hemispheric probe
    private setupHemisphericProbe() {
        if (!this.enableHemisphericProbe)
            return;

        const kcolor = this.mb.genKonstColor((dst: Color) => {
            colorCopy(dst, White); // TODO: intensity can be adjusted per object
            dst.a = 0.0; // FIXME: is this accurate?
        });

        const texMap = this.mb.genTexMap(makeHemisphericProbeTexture());
        // const texMap = this.mb.genTexMap(this.factory.getOpaqueWhiteTexture());
        // const texMap = this.mb.genTexMap(this.factory.getSphereMapTestTexture());

        const stage = this.mb.genTevStage();
        // Only call setTevDirect if addNBTTextureStage has not set the ind tex configuration for this stage
        if (this.mb.getIndTexStageCount() === 0)
            this.mb.setTevDirect(stage);
        this.mb.setTevKColorSel(stage, getGXKonstColorSel(kcolor));
        this.mb.setTevOrder(stage, this.getAmbientProbeTexCoord(), texMap, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.RASC, undefined, undefined, undefined, undefined, GX.Register.REG1);
        this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
    }

    // Emits REG2 = reflective probe
    private setupReflectiveProbe() {
        if (!this.enableReflectiveProbe) {
            this.mb.setTevRegColor(2, (dst: Color) => colorCopy(dst, OpaqueBlack));
            return;
        }

        const texMap = this.mb.genTexMap(makeReflectiveProbeTexture(this.shader.reflectiveProbeIdx >> 1));
        // const texMap = this.mb.genTexMap(this.factory.getGreenSphereMapTestTexture());

        this.mb.setTevRegColor(2, (dst: Color) => colorFromRGBA(dst, 1.0, 1.0, 1.0, this.shader.reflectiveAmbFactor));

        const stage = this.mb.genTevStage();
        if (this.mb.getIndTexStageCount() === 0)
            this.mb.setTevDirect(stage);
        if (this.ambProbeTexCoord === undefined) {
            this.mb.setTevOrder(stage, this.getAmbientProbeTexCoord(), texMap, GX.RasColorChannelID.COLOR0A0);
        } else {
            // Enable "addPrev" option
            this.mb.setTevIndirect(stage, 0 as IndTexStage, GX.IndTexFormat._8, GX.IndTexBiasSel.NONE, GX.IndTexMtxID.OFF, GX.IndTexWrap._0, GX.IndTexWrap._0, true, false, GX.IndTexAlphaSel.OFF);
            this.mb.setTevOrder(stage, this.getAmbientProbeTexCoord(), texMap);
        }

        if (this.enableHemisphericProbe)
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.C1, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG2);
        else
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG2);
        this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.A2, GX.CA.ZERO);

        if (this.shader.reflectiveProbeIdx & 0x1) // Use blue channel for specular
            this.mb.setTevSwapMode(stage, undefined, [GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.G]);
        else // Use red channel for specular
            this.mb.setTevSwapMode(stage, undefined, [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.G]);

        if (this.shader.reflectiveAmbFactor !== 0) {
            // Blend ambient channel into reflective channel (e.g. Arwing)
            const stage = this.mb.genTevStage();
            this.mb.setTevOrder(stage, null, null, GX.RasColorChannelID.COLOR0A0);
            if (this.enableHemisphericProbe)
                this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.APREV, GX.CC.C1, GX.CC.C2, undefined, undefined, undefined, undefined, GX.Register.REG2);
            else
                this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.APREV, GX.CC.RASC, GX.CC.C2, undefined, undefined, undefined, undefined, GX.Register.REG2);
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        }
    }

    private addColoredTextureLayerStageWithoutAmbience(texCoord: TexCoord, texMap: TexMap, colorInMode: number, colorFunc?: ColorFunc<MaterialRenderContext>) {
        const stage = this.mb.genTevStage();
        this.mb.setTevDirect(stage);
        this.mb.setTevOrder(stage, texCoord, texMap);

        if (colorFunc !== undefined) {
            const kcolor = this.mb.genKonstColor(colorFunc);
            this.mb.setTevKColorSel(stage, getGXKonstColorSel(kcolor));
            this.mb.setTevKAlphaSel(stage, getGXKonstAlphaSel(kcolor));
        } else {
            this.mb.setTevKColorSel(stage, GX.KonstColorSel.KCSEL_1);
            this.mb.setTevKAlphaSel(stage, GX.KonstAlphaSel.KASEL_1);
        }

        switch (colorInMode) {
        case 0:
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.ZERO);
            break;
        case 8:
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.C2);
            break;
        default: // Usually 1
            this.mb.setTevColorFormula(stage, GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO);
            break;
        }

        if (this.aprevIsValid)
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        else
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.KONST, GX.CA.ZERO);

        this.cprevIsValid = true;
        this.aprevIsValid = true;
    }

    private addColoredTextureLayerStageWithAmbience(texCoord: TexCoord, texMap: TexMap, colorInMode: number, colorFunc?: ColorFunc<MaterialRenderContext>) {
        const stage = this.mb.genTevStage();
        this.mb.setTevDirect(stage);
        // TODO: support swapping
        this.mb.setTevOrder(stage, texCoord, texMap);

        if (colorFunc !== undefined) {
            const kcolor = this.mb.genKonstColor(colorFunc);
            this.mb.setTevKColorSel(stage, getGXKonstColorSel(kcolor));
            this.mb.setTevKAlphaSel(stage, getGXKonstAlphaSel(kcolor));
        } else {
            this.mb.setTevKColorSel(stage, GX.KonstColorSel.KCSEL_1);
            this.mb.setTevKAlphaSel(stage, GX.KonstAlphaSel.KASEL_1);
        }

        switch (colorInMode) {
        case 0:
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.ZERO);
            break;
        case 8:
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.C1, GX.CC.C2);
            break;
        default: // Usually 1
            this.mb.setTevColorFormula(stage, GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO);
            break;
        }

        if (this.aprevIsValid)
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        else
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.KONST, GX.CA.ZERO);

        this.cprevIsValid = true;
        this.aprevIsValid = true;
    }

    private addPlainTextureLayerStage(texCoord: TexCoord, texMap: TexMap, colorInMode: number) {
        const stage = this.mb.genTevStage();
        this.mb.setTevDirect(stage);
        this.mb.setTevOrder(stage, texCoord, texMap, GX.RasColorChannelID.COLOR0A0);

        switch (colorInMode) {
        case 0:
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
            break;
        default:
            console.warn(`Unhandled colorInMode ${colorInMode} in addPlainTextureLayerStage`);
            this.mb.setTevColorFormula(stage, GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO);
            break;
        }

        if (this.aprevIsValid)
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        else
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);

        this.cprevIsValid = true;
        this.aprevIsValid = true;
    }
    
    private addAlphaedTextureLayerStage(texCoord: TexCoord, texMap: TexMap, colorInMode: number, colorFunc?: ColorFunc<MaterialRenderContext>) {
        const stage = this.mb.genTevStage();
        this.mb.setTevDirect(stage);
        this.mb.setTevOrder(stage, texCoord, texMap, GX.RasColorChannelID.COLOR0A0);

        if (colorFunc !== undefined) {
            const kcolor = this.mb.genKonstColor(colorFunc);
            this.mb.setTevKAlphaSel(stage, getGXKonstAlphaSel(kcolor));
        } else {
            this.mb.setTevKAlphaSel(stage, GX.KonstAlphaSel.KASEL_1);
        }

        switch (colorInMode) {
        case 0:
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
            break;
        case 8:
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.C2);
            break;
        default: // Usually 1
            this.mb.setTevColorFormula(stage, GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO);
            break;
        }

        if (this.aprevIsValid)
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        else
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.TEXA, GX.CA.KONST, GX.CA.ZERO);

        this.cprevIsValid = true;
        this.aprevIsValid = true;
    }

    private addMultByKonstAlphaStage(colorFunc?: ColorFunc<MaterialRenderContext>) {
        const stage = this.mb.genTevStage();
        this.mb.setTevDirect(stage);
        this.mb.setTevOrder(stage, null, null, GX.RasColorChannelID.COLOR0A0);

        if (colorFunc !== undefined) {
            const kcolor = this.mb.genKonstColor(colorFunc);
            this.mb.setTevKAlphaSel(stage, getGXKonstAlphaSel(kcolor));
        } else {
            this.mb.setTevKAlphaSel(stage, GX.KonstAlphaSel.KASEL_1);
        }

        if (this.cprevIsValid) {
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.APREV, GX.CA.KONST, GX.CA.ZERO);
        } else {
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
        }

        this.cprevIsValid = true;
    }

    private setupShaderLayers(preProbe: boolean, fooFlag: boolean /* TODO: better name */) {
        for (let i = 0; i < this.shader.layers.length; i++) {
            const layer = this.shader.layers[i];
            if (!!(layer.tevMode & 0x80) == preProbe) {
                if (layer.texId !== null) {
                    const texMap = this.mb.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, layer.texId, true)));
                    // TODO: support scrollable textures (e.g. eyeballs)
                    const texCoord = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0 + i);

                    let colorInMode: number;
                    if (i > 0)
                        colorInMode = this.shader.layers[i - 1].tevMode & 0x7f;
                    else if (this.enableHemisphericProbe)
                        colorInMode = 8;
                    else
                        colorInMode = 0;

                    if (!this.enableHemisphericProbe) {
                        if (fooFlag) {
                            if (this.shader.attrFlags & 0x10)
                                this.addColoredTextureLayerStageWithoutAmbience(texCoord, texMap, colorInMode,
                                    (dst: Color, ctx: MaterialRenderContext) => colorCopy(dst, ctx.outdoorAmbientColor));
                            else
                                this.addColoredTextureLayerStageWithAmbience(texCoord, texMap, colorInMode,
                                    (dst: Color, ctx: MaterialRenderContext) => colorCopy(dst, ctx.outdoorAmbientColor));
                        } else {
                            // TODO: special logic here if opacity is not 100%.
                            if (this.shader.attrFlags & 0x10)
                                this.addPlainTextureLayerStage(texCoord, texMap, colorInMode);
                            else
                                this.addAlphaedTextureLayerStage(texCoord, texMap, colorInMode);
                        }
                    } else {
                        this.addColoredTextureLayerStageWithAmbience(texCoord, texMap, colorInMode);
                    }
                } else {
                    if (fooFlag) {
                        if (this.shader.attrFlags & 0x10)
                            console.log(`textureless fooFlag attr0x10`);
                        else
                            console.log(`textureless fooFlag !attr0x10`);
                    } else {
                        if (this.shader.attrFlags & 0x10)
                            console.log(`textureless !fooFlag attr0x10`);
                        else
                            this.addMultByKonstAlphaStage();
                    }
                }
            }
        }
    }

    protected rebuildSpecialized() {
        this.cprevIsValid = false;
        this.aprevIsValid = false;
        this.ambProbeTexCoord = undefined;
        this.enableHemisphericProbe = this.shader.hasHemisphericProbe;
        this.enableReflectiveProbe = this.shader.hasReflectiveProbe;

        this.mb.setUsePnMtxIdx(true);

        let nbtScale = 0;
        if ((this.enableHemisphericProbe || this.enableReflectiveProbe) && this.shader.hasNBTTexture)
            nbtScale = this.addNBTTextureStage();

        this.setupHemisphericProbe();
        this.setupReflectiveProbe();

        // TODO: Add projected texture lighting stages if necessary

        if (nbtScale !== 0) {
            const ptmtx = this.mb.genPostTexMtx((dst: mat4) => {
                mat4.fromScaling(dst, [nbtScale, nbtScale, 0.0]);
            });
            this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, getGXPostTexGenMatrix(ptmtx));
        }

        // FIXME: Figure out reflective probe mask textures
        if (this.shader.reflectiveProbeMaskTexId !== null) {
            const reflectiveProbeMask = this.texFetcher.getTexture(this.device, this.shader.reflectiveProbeMaskTexId!, true)!;
            // XXX: actually the reflective probe mask texture itself seems to be ignored?
            // all it does is activate this stage when it is present...
            const stage = this.mb.genTevStage();
            this.mb.setTevDirect(stage);
            // Use the texCoord and texMap generated by the next future call to genTexCoord/genTexMap (i.e., by shader layer 0)
            this.mb.setTevOrder(stage, this.mb.getTexCoordCount() as TexCoord, this.mb.getTexMapCount() as TexMap, GX.RasColorChannelID.COLOR_ZERO);
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.C2, GX.CC.TEXC, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG2);
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        }

        if (false) {
            // XXX: for testing: show only hemispheric ambient lighting
            const fooFlag = !!((this.shader.lightFlags & LightFlags.OverrideLighting) && !(this.shader.normalFlags & NormalFlags.HasVertexColor));
            // Pre-probe layers
            this.setupShaderLayers(true, fooFlag); // Just put this here to get layer 0 setup
            const stage = this.mb.genTevStage();
            this.mb.setTevDirect(stage);
            this.mb.setTevOrder(stage, null, null, GX.RasColorChannelID.COLOR0A0);
            this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C1);
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        } else {
            const fooFlag = !!((this.shader.lightFlags & LightFlags.OverrideLighting) && !(this.shader.normalFlags & NormalFlags.HasVertexColor));

            // Pre-probe layers
            this.setupShaderLayers(true, fooFlag);
    
            // Blend ambient probes
            const stage = this.mb.genTevStage();
            this.mb.setTevDirect(stage);
            this.mb.setTevOrder(stage, null, null, GX.RasColorChannelID.COLOR0A0);
            if (this.enableHemisphericProbe)
                this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.CPREV, GX.CC.C1, GX.CC.C2);
            else
                this.mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.C2);
            this.mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
    
            // Post-probe layers
            this.setupShaderLayers(false, fooFlag);

            // TODO: Model flag can disable mist
            if (this.mb.getTevStageCount() < 8)
                // Some models use too many tev stages and thus cannot be rendered with mist.
                this.addMistStages();
        }

        if (this.shader.lightFlags & LightFlags.OverrideLighting) {
            // Override world lighting (e.g. tornadoes)
            if ((this.shader.normalFlags & NormalFlags.HasVertexColor) || (this.shader.normalFlags & NormalFlags.HasVertexAlpha)) {
                this.mb.setAmbColor(0, (dst: Color, ctx: MaterialRenderContext) => {
                    colorCopy(dst, ctx.outdoorAmbientColor);
                    dst.a = 0.0;
                });
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
                this.mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            } else {
                // No lighting
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            }
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else {
            if (this.shader.lightFlags & 0x9) {
                // Override mat color (e.g. torch sconces)
                if (this.shader.lightFlags & 0x1)
                    this.mb.setMatColor(0, (dst: Color) => { colorCopy(dst, White); });
                else
                    this.mb.setMatColor(0, (dst: Color) => { colorCopy(dst, OpaqueBlack); });
                // TODO: other stuff happens here too
            } else {
                if (this.shader.lightFlags & 0xc) {
                    // Override amb color to black
                    this.mb.setAmbColor(0, (dst: Color) => { colorCopy(dst, OpaqueBlack); });
                } else {
                    this.mb.setAmbColor(0, (dst: Color, ctx: MaterialRenderContext) => {
                        colorCopy(dst, ctx.outdoorAmbientColor);
                        dst.a = 0.0;
                    });
                }

                // Note: if no probed lights were found, the game uses MAT0=black as an optimization.
                this.mb.setMatColor(0, (dst: Color) => { colorCopy(dst, White); });

                // TODO: true on ThornTail Hollow egg-thief
                // if (this.shader.texMtxCount !== 0) {
                //     console.log(`texMtxCount != 0 detected`);
                //     this.mb.setAmbColor(0, (dst: Color, ctx: MaterialRenderContext) => {
                //         colorCopy(dst, Red);
                //         dst.a = 0.0;
                //     });
                // }
            }

            this.mb.setChanCtrl(
                (this.shader.normalFlags & NormalFlags.HasVertexAlpha) ? GX.ColorChannelID.COLOR0A0 : GX.ColorChannelID.COLOR0,
                true,
                GX.ColorSrc.REG,
                (this.shader.normalFlags & NormalFlags.HasVertexColor) ? GX.ColorSrc.VTX : GX.ColorSrc.REG,
                0xff,
                GX.DiffuseFunction.CLAMP,
                GX.AttenuationFunction.SPOT);
            // TODO: utilize channel 1
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }
    }
}

class WaterMaterial extends MaterialBase {
    protected rebuildInternal() {
        this.mb.setTexMtx(0, (dst: mat4, ctx: MaterialRenderContext) => {
            // Flipped
            texProjCameraSceneTex(dst, ctx.sceneCtx.viewerInput.camera, 1);
            mat4.mul(dst, dst, ctx.modelToViewMtx);
        });

        this.mb.setTexMtx(1, (dst: mat4, ctx: MaterialRenderContext) => {
            // Unflipped
            texProjCameraSceneTex(dst, ctx.sceneCtx.viewerInput.camera, -1);
            mat4.mul(dst, dst, ctx.modelToViewMtx);
        });

        this.mb.setTexMtx(3, (dst: mat4, ctx: MaterialRenderContext) => {
            mat4.identity(dst);
            mat4SetValue(dst, 1, 3, ctx.sceneCtx.animController.envAnimValue0);
        });

        const texMap0 = this.mb.genTexMap(makeOpaqueColorTextureDownscale2x());
        const texCoord0 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX0);
        const texMap1 = this.mb.genTexMap(this.factory.getWavyTexture());
        const texCoord1 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX3);

        const indStage0 = this.mb.genIndTexStage();
        const indTexMtx0 = this.mb.genIndTexMtx((dst: mat4) => {
            mat4.fromScaling(dst, [0.5, 0.5, 0.0]);
            mat4.multiplyScalar(dst, dst, 1 / 4); // scale_exp -2
            mat4SetRow(dst, 3, 0.0, 0.0, 0.0, 1.0);
        });
        this.mb.setIndTexOrder(indStage0, texCoord1, texMap1);
        this.mb.setIndTexScale(indStage0, GX.IndTexScale._1, GX.IndTexScale._1);

        const texmtx4 = mat4.create();
        mat4.fromScaling(texmtx4, [0.83, 0.83, 0.83]);
        const rot45deg = mat4.create();
        mat4.fromZRotation(rot45deg, Math.PI / 4);
        mat4.mul(texmtx4, rot45deg, texmtx4);
        this.mb.setTexMtx(4, (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.copy(dst, texmtx4);
            mat4SetValue(dst, 0, 3, matCtx.sceneCtx.animController.envAnimValue1);
            mat4SetValue(dst, 1, 3, matCtx.sceneCtx.animController.envAnimValue1);
        });

        const texCoord2 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX4);

        const itm1 = mat4FromRowMajor(
            0.3,  0.3, 0.0, 0.0,
            -0.3, 0.3, 0.0, 0.0,
            0.0,  0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 1.0
        );
        mat4.multiplyScalar(itm1, itm1, 1 / 16); // scale_exp -4
        mat4SetRow(itm1, 3, 0.0, 0.0, 0.0, 1.0);
        const indTexMtx1 = this.mb.genIndTexMtx((dst: mat4) => {
            mat4.copy(dst, itm1);
        });
        const indStage1 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage1, texCoord2, texMap1);
        this.mb.setIndTexScale(indStage1, GX.IndTexScale._1, GX.IndTexScale._1);

        const stage0 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage0, indStage0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx0), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevOrder(stage0);
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        const k0 = this.mb.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
            // FIXME: this color depends on envfx
            colorFromRGBA(dst, 1.0, 1.0, 1.0, 0x60 / 0xff);
        });

        const stage1 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage1, indStage1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevKColorSel(stage1, getGXKonstColorSel(k0));
        this.mb.setTevKAlphaSel(stage1, getGXKonstAlphaSel(k0));
        this.mb.setTevOrder(stage1, texCoord0, texMap0);
        // TODO: CS_SCALE_1 is used in some cases.
        this.mb.setTevColorFormula(stage1, GX.CC.KONST, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC,
            GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.DIVIDE_2, true, GX.Register.REG0);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST,
            GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG0);

        const itm2 = mat4FromRowMajor(
            0.0,  0.5, 0.0, 0.0,
            -0.5, 0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 1.0
        );
        mat4.multiplyScalar(itm2, itm2, 1 / 32); // scale_exp -5
        mat4SetRow(itm2, 3, 0.0, 0.0, 0.0, 1.0);
        const indTexMtx2 = this.mb.genIndTexMtx((dst: mat4) => {
            mat4.copy(dst, itm2);
        });

        const texCoord3 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX1);

        const stage2 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage2, indStage0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx1), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevOrder(stage2, null, null, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        const stage3 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage3, indStage1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx2), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevOrder(stage3, texCoord3, texMap0, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage3, GX.CC.TEXC, GX.CC.C0, GX.CC.A0, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage3, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);

        this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        this.mb.setCullMode(GX.CullMode.NONE);
        this.mb.setZMode(true, GX.CompareType.LEQUAL, false);
        this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        this.mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    }
}

class FurMaterial extends MaterialBase {
    public constructor(private device: GfxDevice, factory: MaterialFactory, public shader: Shader, private texFetcher: TextureFetcher, private isMapBlock: boolean) {
        super(factory);
    }

    protected rebuildInternal() {
        // FIXME: ??? fade ramp in texmap 0? followed by lighting-related textures...
        // but then it replaces texmap 0 with shader layer 0 before drawing...
        const texMap0 = this.mb.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));
        const texCoord0 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0);

        const stage0 = this.mb.genTevStage();
        this.mb.setTevDirect(stage0);
        this.mb.setTevOrder(stage0, texCoord0, texMap0, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
    
        // Ind Stage 0: Waviness
        const texMap2 = this.mb.genTexMap(this.factory.getWavyTexture());
        this.mb.setTexMtx(1, (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.fromTranslation(dst, [0.25 * matCtx.sceneCtx.animController.envAnimValue0, 0.25 * matCtx.sceneCtx.animController.envAnimValue1, 0.0]);
            mat4SetValue(dst, 0, 0, 0.0125);
            mat4SetValue(dst, 1, 1, 0.0125);
        });

        const texCoord2 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX1);
        const indStage0 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage0, texCoord2, texMap2);
        this.mb.setIndTexScale(indStage0, GX.IndTexScale._1, GX.IndTexScale._1);
    
        // Stage 1: Fur map
        const texMap1 = this.mb.genTexMap(makeFurMapMaterialTexture(this.factory));

        // This texture matrix, when combined with a POS tex-gen, creates
        // texture coordinates that increase linearly on the world's XZ plane.
        const texmtx0 = mat4FromRowMajor(
            0.1, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.1, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        );
        this.mb.setTexMtx(0, (dst: mat4) => { mat4.copy(dst, texmtx0); });

        const stage1 = this.mb.genTevStage();
        const texCoord1 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX0);
        const indTexMtx0 = this.mb.genIndTexMtx((dst: mat4, ctx: MaterialRenderContext) => {
            const m00 = (ctx.furLayer + 1) / 16 * 0.5;
            const m11 = m00;
            mat4SetRowMajor(dst,
                m00, 0.0, 0.0, 0.0,
                0.0, m11, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mat4.multiplyScalar(dst, dst, 1 / 4); // scale_exp -2
        });
        this.mb.setTevIndirect(stage1, indStage0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx0), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevOrder(stage1, texCoord1, texMap1);
        this.mb.setTevKColorSel(stage1, GX.KonstColorSel.KCSEL_4_8);
        this.mb.setTevColorFormula(stage1, GX.CC.TEXC, GX.CC.KONST, GX.CC.CPREV, GX.CC.CPREV, GX.TevOp.SUB, GX.TevBias.ADDHALF);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        
        // Stage 2: Distance fade
        const texMap3 = this.mb.genTexMap(this.factory.getRampTexture());
        this.mb.setTexMtx(2, (dst: mat4, ctx: MaterialRenderContext) => {
            mat4SetRowMajor(dst,
                0.0, 0.0, 1/30, 25/3, // TODO: This matrix can be tweaked to adjust the draw distance. This may be desirable on high-resolution displays.
                0.0, 0.0,  0.0,  0.0,
                0.0, 0.0,  0.0,  0.0,
                0.0, 0.0,  0.0,  0.0
            );
            mat4.mul(dst, dst, ctx.modelToViewMtx);
        });
        const stage2 = this.mb.genTevStage();
        const texCoord3 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX2);
        this.mb.setTevDirect(stage2);
        this.mb.setTevOrder(stage2, texCoord3, texMap3);
        this.mb.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        this.mb.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
    
        // FIXME: flags 0x1, 0x800 and 0x1000 are not well-understood
        if ((this.shader.flags & 0x1) || (this.shader.flags & ShaderFlags.IndoorOutdoorBlend) || (this.shader.flags & 0x800) || (this.shader.flags & 0x1000)) {
            this.mb.setAmbColor(0, undefined); // AMB0 is opaque white
            if (this.shader.flags & ShaderFlags.IndoorOutdoorBlend)
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            else
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else {
            // AMB0 is the outdoor ambient color
            this.mb.setAmbColor(0, (dst: Color, matCtx: MaterialRenderContext) => {
                colorCopy(dst, matCtx.outdoorAmbientColor);
            });
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }

        // FIXME: Objects have different rules for color-channels than map blocks
        if (this.isMapBlock)
            this.mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        this.mb.setCullMode(GX.CullMode.BACK);
        this.mb.setZMode(true, GX.CompareType.LEQUAL, false);
        this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    }
}

export class HeatShimmerMaterial extends MaterialBase {
    protected rebuildInternal() {
        const texMap0 = this.mb.genTexMap(makeOpaqueColorTextureDownscale2x());
        const texMap1 = this.mb.genTexMap(makeOpaqueDepthTextureDownscale2x());
        const texMap2 = this.mb.genTexMap(this.factory.getWavyTexture());

        const texCoord0 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0);

        const pttexmtx0 = this.mb.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.fromScaling(dst, [7.0, 7.0, 1.0]);
            mat4SetValue(dst, 0, 3, matCtx.sceneCtx.animController.envAnimValue0 * 10.0);
            mat4SetValue(dst, 1, 3, -matCtx.sceneCtx.animController.envAnimValue1 * 10.0);
        });
        const texCoord1 = this.mb.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, undefined, undefined, getGXPostTexGenMatrix(pttexmtx0));

        const k0 = this.mb.genKonstColor((dst: Color) => {
            colorFromRGBA(dst, 1.0, 1.0, 1.0, 0xfc/0xff);
        });

        const stage0 = this.mb.genTevStage();
        this.mb.setTevDirect(stage0);
        this.mb.setTevOrder(stage0, texCoord0, texMap1);
        // Sample depth texture as if it were I8 (i.e. copy R to all channels)
        const swap3: SwapTable = [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R];
        this.mb.setTevSwapMode(stage0, undefined, swap3);
        this.mb.setTevKAlphaSel(stage0, getGXKonstAlphaSel(k0));
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage0, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA, GX.TevOp.SUB, undefined, GX.TevScale.SCALE_4);

        const indTexMtx0 = this.mb.genIndTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            let s = 0.5 * Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue0 * 10.0);
            let c = 0.5 * Math.cos(3.142 * matCtx.sceneCtx.animController.envAnimValue0 * 10.0);
            mat4SetRowMajor(dst,
                c,   s,   0.0, 0.0,
                -s,  c,   0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mat4.multiplyScalar(dst, dst, 1 / 64); // scale_exp -6
        });

        const indStage0 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage0, texCoord1, texMap2);
        this.mb.setIndTexScale(indStage0, GX.IndTexScale._1, GX.IndTexScale._1);

        const stage1 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage1, indStage0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx0), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevOrder(stage1, texCoord0, texMap0);
        this.mb.setTevColorFormula(stage1, GX.CC.TEXC, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV, undefined, undefined, GX.TevScale.SCALE_4);

        const stage2 = this.mb.genTevStage();
        this.mb.setTevDirect(stage2);
        this.mb.setTevOrder(stage2, undefined, undefined, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        this.mb.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO, undefined, undefined, GX.TevScale.SCALE_4);

        this.mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        this.mb.setZMode(true, GX.CompareType.LESS, false);
        this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    }
}

export class FaultyTVMaterial extends MaterialBase {
    protected rebuildInternal() {
        const texMap0 = this.mb.genTexMap(makeOpaqueColorTextureDownscale2x());
        const texMap1 = this.mb.genTexMap(this.factory.getWavyTexture());
        
        const k0 = this.mb.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
            const alpha = matCtx.sceneCtx.animController.envAnimValue1 * 0xff; // TODO: adjusts strength of shimmer
            // const alpha = 0xff;
            colorFromRGBA(dst, 0, 0, 0x80/0xff, alpha/0xff);
        });
        const k1 = this.mb.genKonstColor((dst: Color) => {
            colorFromRGBA(dst, 0x80/0xff, 0x80/0xff, 0, 0);
        });
        const k2 = this.mb.genKonstColor((dst: Color) => {
            colorFromRGBA(dst, 0, 0x80/0xff, 0, 0);
        });
        const k3 = this.mb.genKonstColor((dst: Color) => {
            colorFromRGBA(dst, 0x80/0xff, 0, 0x80/0xff, 0);
        });

        // Stage 0 is blank because ALPHA_BUMP_N cannot be used until later stages.
        const stage0 = this.mb.genTevStage();
        this.mb.setTevDirect(stage0);
        this.mb.setTevOrder(stage0);
        this.mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        const texCoord0 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0);

        this.mb.setTexMtx(0, (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.fromScaling(dst, [0.2, 0.2, 1.0]);
            mat4SetValue(dst, 1, 3, -matCtx.sceneCtx.animController.envAnimValue0);
        });
        const texCoord1 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);

        const rot45 = mat4.create();
        mat4.fromZRotation(rot45, Math.PI / 4);
        this.mb.setTexMtx(1, (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.fromScaling(dst, [0.25, 0.25, 1.0]);
            mat4.mul(dst, rot45, dst);
            mat4SetValue(dst, 0, 3, matCtx.sceneCtx.animController.envAnimValue1);
            mat4SetValue(dst, 1, 3, matCtx.sceneCtx.animController.envAnimValue1);
        });
        const texCoord2 = this.mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX1);

        const indStage0 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage0, texCoord1, texMap1);
        this.mb.setIndTexScale(indStage0, GX.IndTexScale._1, GX.IndTexScale._1);

        const indTexMtx0 = this.mb.genIndTexMtx((dst: mat4) => {
            mat4SetRowMajor(dst, 
                0.5, 0.0, 0.0, 0.0,
                0.0, 0.5, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mat4.multiplyScalar(dst, dst, 1 / 8); // scale_exp -3
        });

        const stage1 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage1, indStage0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx0), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.S);
        this.mb.setTevOrder(stage1, undefined, undefined, GX.RasColorChannelID.ALPHA_BUMP_N);
        this.mb.setTevColorFormula(stage1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);

        const indStage1 = this.mb.genIndTexStage();
        this.mb.setIndTexOrder(indStage1, texCoord2, texMap1);
        this.mb.setIndTexScale(indStage1, GX.IndTexScale._1, GX.IndTexScale._1);
        
        const indTexMtx1 = this.mb.genIndTexMtx((dst: mat4) => {
            mat4SetRowMajor(dst, 
                0.5, 0.0, 0.0, 0.0,
                0.0, 0.5, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mat4.multiplyScalar(dst, dst, 1 / 8); // scale_exp -3
        });

        const stage2 = this.mb.genTevStage();
        this.mb.setTevIndirect(stage2, indStage1, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getGXIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.S);
        this.mb.setTevOrder(stage2, texCoord0, texMap0, GX.RasColorChannelID.ALPHA_BUMP_N);
        this.mb.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        this.mb.setTevAlphaFormula(stage2, GX.CA.APREV, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA, undefined, undefined, GX.TevScale.DIVIDE_2);

        const stage3 = this.mb.genTevStage();
        this.mb.setTevDirect(stage3);
        this.mb.setTevOrder(stage3);
        this.mb.setTevKColorSel(stage3, getGXKonstColorSel(k0));
        this.mb.setTevKAlphaSel(stage3, GX.KonstAlphaSel.KASEL_4_8);
        this.mb.setTevColorFormula(stage3, GX.CC.ZERO, GX.CC.KONST, GX.CC.CPREV, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG0);
        this.mb.setTevAlphaFormula(stage3, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV, GX.TevOp.SUB, undefined, GX.TevScale.SCALE_2, undefined, GX.Register.REG0);

        const stage4 = this.mb.genTevStage();
        this.mb.setTevDirect(stage4);
        this.mb.setTevOrder(stage4);
        this.mb.setTevKColorSel(stage4, getGXKonstColorSel(k1));
        this.mb.setTevKAlphaSel(stage4, GX.KonstAlphaSel.KASEL_4_8);
        this.mb.setTevColorFormula(stage4, GX.CC.KONST, GX.CC.ZERO, GX.CC.CPREV, GX.CC.C0, undefined, undefined, undefined, undefined, GX.Register.REG0);
        this.mb.setTevAlphaFormula(stage4, GX.CA.APREV, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST, GX.TevOp.SUB, undefined, GX.TevScale.SCALE_2, undefined, GX.Register.REG1);

        const stage5 = this.mb.genTevStage();
        this.mb.setTevDirect(stage5);
        this.mb.setTevOrder(stage5);
        this.mb.setTevKColorSel(stage5, getGXKonstColorSel(k2));
        this.mb.setTevColorFormula(stage5, GX.CC.ZERO, GX.CC.KONST, GX.CC.CPREV, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG1);
        this.mb.setTevAlphaFormula(stage5, GX.CA.A0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A1);

        const stage6 = this.mb.genTevStage();
        this.mb.setTevDirect(stage6);
        this.mb.setTevKColorSel(stage6, getGXKonstColorSel(k3));
        this.mb.setTevKAlphaSel(stage6, GX.KonstAlphaSel.KASEL_4_8);
        this.mb.setTevOrder(stage6);
        this.mb.setTevColorFormula(stage6, GX.CC.KONST, GX.CC.ZERO, GX.CC.CPREV, GX.CC.C1, undefined, undefined, undefined, undefined, GX.Register.REG1);
        this.mb.setTevAlphaFormula(stage6, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

        const stage7 = this.mb.genTevStage();
        this.mb.setTevDirect(stage7);
        this.mb.setTevKAlphaSel(stage7, getGXKonstAlphaSel(k0));
        this.mb.setTevOrder(stage7);
        this.mb.setTevColorFormula(stage7, GX.CC.C1, GX.CC.C0, GX.CC.APREV, GX.CC.ZERO);
        this.mb.setTevAlphaFormula(stage7, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);

        this.mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        this.mb.setCullMode(GX.CullMode.NONE);
        this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        this.mb.setZMode(false, GX.CompareType.ALWAYS, false);
    }
}

export class MaterialFactory {
    private rampGfxTexture: SFATexture | null = null;
    private rampTexture: TexFunc<MaterialRenderContext>;
    private mapLightGfxTexture: SFATexture | null = null;
    private mapLightTexture: TexFunc<MaterialRenderContext>;
    private causticGfxTexture: SFATexture | null = null;
    private causticTexture: TexFunc<MaterialRenderContext>;
    private wavyGfxTexture: SFATexture | null = null;
    private wavyTexture: TexFunc<MaterialRenderContext>;
    private halfGrayGfxTexture: SFATexture | null = null;
    private halfGrayTexture: TexFunc<MaterialRenderContext>;
    private furFactory: FurFactory | null = null;
    public scrollSlots: ScrollSlot[] = [];

    constructor(public device: GfxDevice) {
    }

    public update(animController: SFAAnimationController) {
        for (let i = 0; i < this.scrollSlots.length; i++) {
            const scroll = this.scrollSlots[i];
            scroll.x = (animController.animController.getTimeInFrames() * scroll.dxPerFrame) % MAX_SCROLL;
            scroll.y = (animController.animController.getTimeInFrames() * scroll.dyPerFrame) % MAX_SCROLL;
        }
    }

    public addScrollSlot(dxPerFrame: number, dyPerFrame: number): number {
        this.scrollSlots.push({
            x: 0, y: 0, dxPerFrame, dyPerFrame
        });
        return this.scrollSlots.length - 1;
    }

    public buildObjectMaterial(shader: Shader, texFetcher: TextureFetcher): SFAMaterial {
        return new StandardObjectMaterial(this.device, this, shader, texFetcher);
    }

    public buildMapMaterial(shader: Shader, texFetcher: TextureFetcher): SFAMaterial {
        return new StandardMapMaterial(this.device, this, shader, texFetcher);
    }
    
    public buildWaterMaterial(shader: Shader): SFAMaterial {
        return new WaterMaterial(this);
    }

    public buildFurMaterial(shader: Shader, texFetcher: TextureFetcher, texIds: number[], isMapBlock: boolean): SFAMaterial {
        return new FurMaterial(this.device, this, shader, texFetcher, isMapBlock);
    }

    public getFurFactory(): FurFactory {
        if (this.furFactory !== null)
            return this.furFactory;

        this.furFactory = new FurFactory(this.device);
        return this.furFactory;
    }

    private genColorTexture(r: number, g: number, b: number, a: number): SFATexture {
        const width = 1;
        const height = 1;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x);
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
        }

        plot(0, 0, r, g, b, a);

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        return new SFATexture(gfxTexture, gfxSampler, width, height);
    }

    public getHalfGrayTexture(): TexFunc<MaterialRenderContext> {
        // Used to test indirect texturing
        if (this.halfGrayTexture === undefined)
            this.halfGrayTexture = makeMaterialTexture(this.genColorTexture(127, 127, 127, 255));

        return this.halfGrayTexture;
    }

    private opaqueWhiteTexture?: TexFunc<any>;

    public getOpaqueWhiteTexture(): TexFunc<any> {
        if (this.opaqueWhiteTexture === undefined)
            this.opaqueWhiteTexture = makeMaterialTexture(this.genColorTexture(255, 255, 255, 255));
        return this.opaqueWhiteTexture;
    }

    private transparentBlackTexture?: SFATexture;

    public getTransparentBlackTexture(): SFATexture {
        if (this.transparentBlackTexture === undefined)
            this.transparentBlackTexture = this.genColorTexture(0, 0, 0, 0);
        return this.transparentBlackTexture;
    }

    private sphereMapTestTexture?: TexFunc<MaterialRenderContext>;
    private greenSphereMapTestTexture?: TexFunc<MaterialRenderContext>;

    // Generate a sphere map with black in the center (where N points toward camera)
    // and white around the edges (where N points perpendicular to camera).
    // Useful for testing.
    public getGreenSphereMapTestTexture(): TexFunc<MaterialRenderContext> {
        if (this.greenSphereMapTestTexture === undefined) {
            const width = 1024;
            const height = 1024;
            const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
            const gfxSampler = this.device.createSampler({
                wrapS: GfxWrapMode.Clamp,
                wrapT: GfxWrapMode.Clamp,
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Nearest,
                minLOD: 0,
                maxLOD: 100,
            });

            const pixels = new Uint8Array(4 * width * height);

            function plot(x: number, y: number, color: Color) {
                const idx = 4 * (y * width + x);
                pixels[idx] = color.r * 255;
                pixels[idx + 1] = color.g * 255;
                pixels[idx + 2] = color.b * 255;
                pixels[idx + 3] = color.a * 255;
            }
            
            const color = colorNewCopy(TransparentBlack);
            for (let y = 0; y < height; y++) {
                const fy = 2*y/(height-1) - 1;
                for (let x = 0; x < width; x++) {
                    const fx = 2*x/(width-1) - 1;
                    const d2 = clamp(fx*fx + fy*fy, 0.0, 1.0);
                    const fz = 1.0 - Math.sqrt(1.0 - d2);
                    colorFromRGBA(color, 0.0, fz, 0.0, 1.0);
                    plot(x, y, color);
                }
            }

            this.device.uploadTextureData(gfxTexture, 0, [pixels]);

            this.greenSphereMapTestTexture = makeMaterialTexture(new SFATexture(gfxTexture, gfxSampler, width, height));
        }

        return this.greenSphereMapTestTexture;
    }

    // Generate a sphere map with black in the center (where N points toward camera)
    // and white around the edges (where N points perpendicular to camera).
    // Useful for testing.
    public getSphereMapTestTexture(): TexFunc<MaterialRenderContext> {
        if (this.sphereMapTestTexture === undefined) {
            const width = 1024;
            const height = 1024;
            const gridWidth = 32;
            const gridHeight = 32;
            const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
            const gfxSampler = this.device.createSampler({
                wrapS: GfxWrapMode.Clamp,
                wrapT: GfxWrapMode.Clamp,
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Nearest,
                minLOD: 0,
                maxLOD: 100,
            });

            const pixels = new Uint8Array(4 * width * height);

            function plot(x: number, y: number, color: Color) {
                const idx = 4 * (y * width + x);
                pixels[idx] = color.r * 255;
                pixels[idx + 1] = color.g * 255;
                pixels[idx + 2] = color.b * 255;
                pixels[idx + 3] = color.a * 255;
            }
            
            const color = colorNewCopy(TransparentBlack);
            for (let y = 0; y < height; y++) {
                const fy = 2*y/(height-1) - 1;
                for (let x = 0; x < width; x++) {
                    const fx = 2*x/(width-1) - 1;
                    const d2 = clamp(fx*fx + fy*fy, 0.0, 1.0);
                    const fz = 1.0 - Math.sqrt(1.0 - d2);
                    colorFromRGBA(color, fz, fz, fz, 1.0);
                    plot(x, y, color);
                }
            }

            this.device.uploadTextureData(gfxTexture, 0, [pixels]);

            this.sphereMapTestTexture = makeMaterialTexture(new SFATexture(gfxTexture, gfxSampler, width, height));
        }

        return this.sphereMapTestTexture;
    }
    
    public getRampTexture(): TexFunc<MaterialRenderContext> {
        if (this.rampTexture !== undefined)
            return this.rampTexture;

        const width = 256;
        const height = 4;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x);
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
        }

        for (let x = 0; x < 256; x++) {
            const I = x;
            for (let y = 0; y < 4; y++)
                plot(x, y, I, I, I, I);
        }

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.rampGfxTexture = new SFATexture(gfxTexture, gfxSampler, width, height);
        this.rampTexture = makeMaterialTexture(this.rampGfxTexture);
        return this.rampTexture;
    }
    
    public getCausticTexture(): TexFunc<MaterialRenderContext> {
        // This function generates a texture with a circular pattern used for caustics.
        // The original function to generate this texture is not customizable and
        // generates the same texture every time it is called. (?)

        if (this.causticTexture !== undefined)
            return this.causticTexture;
        
        const width = 128;
        const height = 128;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x);
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
        }

        for (let y = 0; y < height; y++) {
            const fy = (y - 64) / 64;
            for (let x = 0; x < width; x++) {
                const fx = (x - 64) / 64;
                let dist = Math.hypot(fx, fy);
                if (dist < 0.25 || 0.75 < dist) {
                    dist = 0.0;
                } else {
                    let f = 2.0 * (dist - 0.25);
                    if (f <= 0.5)
                        f = 0.5 - f;
                    else
                        f = f - 0.5;
                    dist = -(2.0 * f - 1.0);
                    if (0.0 < dist)
                        dist = Math.sqrt(dist);
                }
                const I = 16 * dist;
                plot(y, x, I, I, I, I);
            }
        }

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.causticGfxTexture = new SFATexture(gfxTexture, gfxSampler, width, height);
        this.causticTexture = makeMaterialTexture(this.causticGfxTexture);
        return this.causticTexture;
    }

    public getMapLightTexture(): TexFunc<MaterialRenderContext> {
        if (this.mapLightTexture !== undefined)
            return this.mapLightTexture;

        const width = 128;
        const height = 128;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, color: Color) {
            const idx = 4 * (y * width + x);
            pixels[idx] = color.r * 255;
            pixels[idx + 1] = color.g * 255;
            pixels[idx + 2] = color.b * 255;
            pixels[idx + 3] = color.a * 255;
        }
        
        const color = colorNewCopy(TransparentBlack);
        for (let y = 0; y < height; y++) {
            const fy = (y - 64) / 64.0;
            for (let x = 0; x < width; x++) {
                const fx = (x - 64) / 64.0;
                const dist = Math.hypot(fx, fy);
                let factor = 1.0 - dist;
                if (factor < 0.0)
                    factor = 0.0;
                const I = factor;
                colorFromRGBA(color, I, I, I, I);
                plot(x, y, color);
            }
        }

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.mapLightGfxTexture = new SFATexture(gfxTexture, gfxSampler, width, height);
        this.mapLightTexture = makeMaterialTexture(this.mapLightGfxTexture);
        return this.mapLightTexture;
    }
    
    public getWavyTexture(): TexFunc<MaterialRenderContext> {
        // This function generates a texture with a wavy pattern used for water, lava and other materials.
        // The original function used to generate this texture is not customizable and
        // always generates the same texture every time it is called. (?)

        if (this.wavyTexture !== undefined)
            return this.wavyTexture;
        
        const width = 64;
        const height = 64;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x)
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
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

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.wavyGfxTexture = new SFATexture(gfxTexture, gfxSampler, width, height);
        this.wavyTexture = makeMaterialTexture(this.wavyGfxTexture);
        return this.wavyTexture;
    }

    public destroy(device: GfxDevice) {
        if (this.halfGrayGfxTexture !== null)
            this.halfGrayGfxTexture.destroy(device);
        if (this.rampGfxTexture !== null)
            this.rampGfxTexture.destroy(device);
        if (this.causticGfxTexture !== null)
            this.causticGfxTexture.destroy(device);
        if (this.mapLightGfxTexture !== null)
            this.mapLightGfxTexture.destroy(device);
        if (this.wavyGfxTexture !== null)
            this.wavyGfxTexture.destroy(device);
        this.furFactory?.destroy(device);
    }
}