
import { dScnKy_env_light_c, dKy_efplight_set, dKy_efplight_cut, dKy_actor_addcol_amb_set, dKy_bg_addcol_amb_set, dKy_bg1_addcol_amb_set, dKy_vrbox_addcol_sky0_set, dKy_vrbox_addcol_kasumi_set, dKy_addcol_fog_set, dKy_set_actcol_ratio, dKy_set_bgcol_ratio, dKy_set_fogcol_ratio, dKy_set_vrboxcol_ratio, dKy_get_dayofweek, dKy_checkEventNightStop, dKy_darkworld_check } from "./d_kankyo.js";
import { dGlobals } from "./ztp_scenes.js";
import { cM_rndF, cLib_addCalc, cM_rndFX, cLib_addCalcAngleRad } from "../WindWaker/SComponent.js";
import { vec3, mat4, vec4, vec2, ReadonlyVec3, ReadonlyVec2 } from "gl-matrix";
import { Color, colorFromRGBA, colorFromRGBA8, colorLerp, colorCopy, colorNewCopy, colorNewFromRGBA8, White, TransparentBlack } from "../Color.js";
import { computeMatrixWithoutTranslation, MathConstants, saturate, invlerp } from "../MathHelpers.js";
import { fGlobals, fpcPf__Register, fpc__ProcessName, fpc_bs__Constructor, kankyo_class, cPhs__Status, fopKyM_Delete, fopKyM_create } from "./framework.js";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { mDoExt_btkAnm, mDoExt_brkAnm, mDoExt_modelUpdateDL } from "./m_do_ext.js";
import { ResType } from "./d_resorce.js";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader.js";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { MtxTrans, mDoMtx_ZrotM, mDoMtx_XrotM, calc_mtx, uShortTo2PI } from "../WindWaker/m_do_mtx.js";
import { BTIData, BTI_Texture } from "../Common/JSYSTEM/JUTTexture.js";
import { Camera, divideByW } from "../Camera.js";
import { TDDraw } from "../SuperMarioGalaxy/DDraw.js";
import * as GX from '../gx/gx_enum.js';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder.js";
import { GXMaterialHelperGfx, MaterialParams, DrawParams, ColorKind } from "../gx/gx_render.js";
import { GfxDevice, GfxCompareMode, GfxClipSpaceNearZ } from "../gfx/platform/GfxPlatform.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { nArray, assertExists, assert } from "../util.js";
import { JPABaseEmitter } from "../Common/JSYSTEM/JPA.js";
import { PeekZResult, PeekZManager } from "../WindWaker/d_dlst_peekZ.js";
import { compareDepthValues } from "../gfx/helpers/ReversedDepthHelpers.js";
import { dfRange, dfShow } from "../DebugFloaters.js";
import { _T } from "../gfx/platform/GfxPlatformImpl.js";
import { dKy_undwater_filter_draw, dKy_daynight_check } from "./d_kankyo.js"
import { TevDefaultSwapTables } from "../gx/gx_material.js";

export function dKyw_wether_init(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    if (globals.stageName === "F_SP113" && globals.mStayNo === 1) {
        globals.particleCtrl.set(globals, 0, 0x878F, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8790, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8791, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8792, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8793, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8794, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8795, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8796, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8797, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8798, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x8799, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x879A, [0,0,0]);
        globals.particleCtrl.set(globals, 0, 0x879B, [0,0,0]);
    }
}

export function dKyw_wether_delete(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    const device = globals.modelCache.device;

    if (envLight.sunPacket !== null)
        envLight.sunPacket.destroy(device);
    if (envLight.rainPacket !== null)
        envLight.rainPacket.destroy(device);
    if (envLight.starPacket !== null)
        envLight.starPacket.destroy(device);
    if (envLight.housiPacket !== null)
        envLight.housiPacket.destroy(device);
}

export function dKyw_wether_draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    // Normally this just pushes packets which draw at the right time. We can just draw now.

    const envLight = globals.g_env_light;

    if (globals.stageName !== 'Name') {
        if (envLight.sunPacket !== null)
            envLight.sunPacket.draw(globals, renderInstManager, viewerInput);
    }

    if (envLight.starPacket !== null && !envLight.vrboxInvisible)
        envLight.starPacket.draw(globals, renderInstManager, viewerInput);

    if (envLight.housiPacket !== null)
        envLight.housiPacket.draw(globals, renderInstManager, viewerInput);

    /*if (globals.stageName !== 'Name') {
        if (envLight.rainPacket !== null)
            envLight.rainPacket.draw(globals, renderInstManager, viewerInput);
    } */

    dKy_undwater_filter_draw(globals, globals.g_env_light, renderInstManager, viewerInput);
}

export function dKyw_wether_move(globals: dGlobals, deltaTimeInFrames: number): void {
    wether_move_thunder(globals);
}

export function dKyw_wether_move_draw(globals: dGlobals, deltaTimeInFrames: number): void {
    if (globals.stageName !== 'Name') {
        wether_move_sun(globals);
        wether_move_rain(globals, deltaTimeInFrames);
        wether_move_snow(globals);
    }

    wether_move_star(globals, deltaTimeInFrames);

    if (globals.stageName !== 'Name') {
        wether_move_housi(globals, deltaTimeInFrames);
        wether_move_moya(globals);
    }
}

export function dKyw_wether_init2(globals: dGlobals): void {
    
}

export function dKyw_wether_delete2(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    const device = globals.modelCache.device;

    if (envLight.vrkumoPacket !== null)
        envLight.vrkumoPacket.destroy(device);
}



export function dKyr__sun_arrival_check(envLight: dScnKy_env_light_c): boolean {
    return envLight.curTime > 77.5 && envLight.curTime < 285.0;
}

export function dKyr_moon_arrival_check(envLight: dScnKy_env_light_c): boolean {
    return envLight.curTime > 277.5 || envLight.curTime < 112.5;
}

export function dKyw_rain_set(envLight: dScnKy_env_light_c, count: number): void {
    envLight.rainCount = count;
    envLight.rainCountOrig = count;
}

export const enum ThunderMode {
    Off     = 0,
    On      = 1,
    Two     = 2,
    FarOnly = 10,
}

export const enum ThunderState {
    Clear      = 0,
    FlashNear  = 1,
    FlashFar   = 11,
    FadeNear   = 2,
    FadeFar    = 12,
    NearThresh = 10,
}

function dKyr_thunder_move(globals: dGlobals, envLight: dScnKy_env_light_c, cameraPos: vec3): void {
    const isNear = (envLight.thunderState < ThunderState.NearThresh);

    if (envLight.thunderState === ThunderState.Clear) {
        envLight.thunderFlashTimer = 0;
        if (cM_rndF(1.0) > 0.007) {
            if ((envLight.thunderMode < ThunderMode.FarOnly) && cM_rndF(1.0) < 0.005) {
                vec3.copy(envLight.thunderLightInfluence.pos, cameraPos);
                colorFromRGBA(envLight.thunderLightInfluence.color, 0, 0, 0);
                envLight.thunderLightInfluence.power = 90000.0;
                envLight.thunderLightInfluence.fluctuation = 150.0;
                dKy_efplight_set(envLight, envLight.thunderLightInfluence);
                envLight.thunderState = ThunderState.FlashNear;
            }
        } else {
            envLight.thunderState = ThunderState.FlashFar;
        }
    } else if (envLight.thunderState === ThunderState.FlashNear || envLight.thunderState === ThunderState.FlashFar) {
        envLight.thunderFlashTimer = cLib_addCalc(envLight.thunderFlashTimer, 1.0, 0.3, 0.2, 0.001);
        if (envLight.thunderFlashTimer >= 1.0) {
            if (isNear) {
                // seStart()
            }
            envLight.thunderState++;
        }

        if (cM_rndF(1.0) < 0.18) {
            // Spawn lighting bolt
            fopKyM_create(globals.frameworkGlobals, fpc__ProcessName.d_thunder, -1, null, null);
        }
    } else if (envLight.thunderState === ThunderState.FadeNear || envLight.thunderState === ThunderState.FadeFar) {
        envLight.thunderFlashTimer = cLib_addCalc(envLight.thunderFlashTimer, 0.0, 0.1, 0.05, 0.001);
        if (envLight.thunderFlashTimer <= 0.0) {
            if (isNear) {
                dKy_efplight_cut(envLight, envLight.thunderLightInfluence);
            }
            envLight.thunderState = ThunderState.Clear;
            if (envLight.thunderMode === ThunderMode.Off)
                envLight.thunderActive = false;
        }
    }

    if (envLight.thunderState !== ThunderState.Clear) {
        const flash = envLight.thunderFlashTimer;
        if (isNear) {
            const ef = envLight.thunderLightInfluence;
            ef.pos[0] = cameraPos[0];
            ef.pos[1] = cameraPos[1] + 150;
            ef.pos[2] = cameraPos[2];

            const brightness = (0.2 * flash) / 0xFF;
            ef.color.r = saturate(0xB4 * brightness);
            ef.color.g = saturate(0xEB * brightness);
            ef.color.b = saturate(0xFF * brightness);

            // This field is written to by dKy_Itemgetcol_chg_move, I think it's true
            // when we're in some sort of a getitem cutscene...
            const isInItemget = false;
            if (!isInItemget) {
                dKy_actor_addcol_amb_set(envLight, 0.5 * flash, 0x5A, 0xA0, 0xF5);
                dKy_bg_addcol_amb_set(envLight, 0.7 * flash, 0x32, 0x78, 0xFF);
                dKy_bg1_addcol_amb_set(envLight, 0.35 * flash, 0x5A, 0xA0, 0xF5);
                dKy_vrbox_addcol_sky0_set(envLight, 0.4 * flash, 0x5A, 0xA0, 0xF5);
                dKy_vrbox_addcol_kasumi_set(envLight, 0.5 * flash, 0x5A, 0xA0, 0xF5);
                dKy_addcol_fog_set(envLight, 0.3 * flash, 0x5A, 0xA0, 0xF5);
            }
        } else {
            dKy_vrbox_addcol_sky0_set(envLight, 0.15 * flash, 0x5A, 0xA0, 0xF5);
            dKy_vrbox_addcol_kasumi_set(envLight, 0.35 * flash, 0x5A, 0xA0, 0xF5);
            dKy_addcol_fog_set(envLight, 0.12 * flash, 0x5A, 0xA0, 0xF5);
        }
    }
}

function dKyr_thunder_init(envLight: dScnKy_env_light_c): void {
    envLight.thunderState = ThunderState.Clear;
}

function vecPitch(v: vec3): number {
    return Math.atan2(v[1], Math.hypot(v[2], v[0]));
}

export function loadRawTexture(globals: dGlobals, data: ArrayBufferSlice, width: number, height: number, format: GX.TexFormat, wrapS: GX.WrapMode, wrapT: GX.WrapMode, name: string = ''): BTIData {
    const btiTexture: BTI_Texture = {
        name,
        width, height, format, wrapS, wrapT,
        minFilter: GX.TexFilter.LINEAR,
        magFilter: GX.TexFilter.LINEAR,
        data,
        lodBias: 0, minLOD: 0, maxLOD: 100, mipCount: 1,
        maxAnisotropy: GX.Anisotropy._1,
        paletteData: null,
        paletteFormat: GX.TexPalette.IA8,
    };
    const device = globals.modelCache.device, cache = globals.modelCache.cache;
    return new BTIData(device, cache, btiTexture);
}

const materialParams = new MaterialParams();
const drawParams = new DrawParams();

function submitScratchRenderInst(renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, renderInst: GfxRenderInst, viewerInput: ViewerRenderInput, materialParams_ = materialParams, drawParams_ = drawParams): void {
    materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
    renderInst.setSamplerBindingsFromTextureMappings(materialParams_.m_TextureMapping);
    materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams_);
    mat4.copy(drawParams_.u_PosMtx[0], viewerInput.camera.viewMatrix);
    materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams_);
    renderInstManager.submitRenderInst(renderInst);
}

export class dKankyo__CommonTextures {
    public snowTexture: BTIData;

    constructor(globals: dGlobals) {
        const resCtrl = globals.resCtrl;
    }

    public destroy(device: GfxDevice): void {
    }
}

const scratchMatrix = mat4.create();

const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchVec4 = vec4.create();

export class dKankyo_sun_Packet {
    // Shared
    private ddraw = new TDDraw();

    // Sun/Moon
    private moonTextures: BTIData[] = [];
    private sunTexture: BTIData;
    private materialHelperSunMoon: GXMaterialHelperGfx;
    public sunPos = vec3.create();
    public moonPos = vec3.create();
    public sunAlpha: number = 0.0;
    public moonAlpha: number = 0.0;
    public visibility: number = 0.0;

    public color = colorNewCopy(TransparentBlack);

    // Lenzflare
    private lensTexture: BTIData;
    private ringTexture: BTIData;
    private lensBallTexture: BTIData;

    private materialHelperLenzflare: GXMaterialHelperGfx;
    private materialHelperLenzflareSolid: GXMaterialHelperGfx;
    public lenzflarePos = nArray(6, () => vec3.create());
    public lenzflareAngle: number = 0.0;
    public distFalloff: number = 0.0;
    public drawLenzInSky: boolean = false;

    public chkPoints: vec2[] = [
        vec2.fromValues(  0,   0),
        vec2.fromValues(-10, -20),
        vec2.fromValues( 10,  20),
        vec2.fromValues(-20,  10),
        vec2.fromValues( 20, -10),
    ];
    public peekZResults = nArray(5, () => new PeekZResult());

    constructor(globals: dGlobals) {
        const resCtrl = globals.resCtrl;

        this.moonTextures.push(resCtrl.getStageResByName(ResType.Bti, `STG_00`, `f_moon.bti`)!);
        this.moonTextures.push(resCtrl.getStageResByName(ResType.Bti, `STG_00`, `f_moon_a.bti`)!);
        this.moonTextures.push(resCtrl.getStageResByName(ResType.Bti, `STG_00`, `f_moon_a_a00.bti`)!);
        this.moonTextures.push(resCtrl.getStageResByName(ResType.Bti, `STG_00`, `f_moon_a_a01.bti`)!);
        this.moonTextures.push(resCtrl.getStageResByName(ResType.Bti, `STG_00`, `f_moon_a_a02.bti`)!);
        this.moonTextures.push(resCtrl.getStageResByName(ResType.Bti, `STG_00`, `f_moon_a_a03.bti`)!);

        this.sunTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x4A);
        this.lensTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x5C);
        this.ringTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x57);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.TEXC, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.A0, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(2, GX.CC.CPREV, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelperSunMoon = new GXMaterialHelperGfx(mb.finish('dKankyo_sun_packet'));

        mb.setZMode(false, GX.CompareType.LEQUAL, false);
        this.materialHelperLenzflare = new GXMaterialHelperGfx(mb.finish('dKankyo_lenzflare_packet textured'));

        mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A0);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        this.materialHelperLenzflareSolid = new GXMaterialHelperGfx(mb.finish('dKankyo_lenzflare_packet solid'));
    }

    private drawSquare(ddraw: TDDraw, mtx: mat4, basePos: vec3, size1: number, scaleX: number, texCoordScale: number, size2: number = size1): void {
        ddraw.begin(GX.Command.DRAW_QUADS);

        vec3.set(scratchVec3, scaleX * -size1,  size1, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, mtx);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * 0, texCoordScale * 0);

        vec3.set(scratchVec3, scaleX *  size1,  size1, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, mtx);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * 1, texCoordScale * 0);

        vec3.set(scratchVec3, scaleX *  size2, -size2, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, mtx);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * 1, texCoordScale * 1);

        vec3.set(scratchVec3, scaleX * -size1, -size1, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, mtx);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * 0, texCoordScale * 1);

        ddraw.end();
    }

    private drawSunMoon(globals: dGlobals, ddraw: TDDraw, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        if (globals.stageName === "F_SP200") {
            this.sunAlpha = 0.0;
            this.moonAlpha = 1.0;
        }

        let drawSun = this.sunAlpha > 0.0;
        let drawMoon = this.moonAlpha > 0.0;

        const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
        if (envLight.baseLight.color.r === 0.0 && roomType !== 2) {
            if (envLight.curTime > 285 || envLight.curTime < 105)
                drawMoon = false;
        }

        if (!drawSun && !drawMoon)
            return;

        const camPitch = vecPitch(globals.cameraFwd);

        renderInstManager.setCurrentRenderInstList(globals.dlst.sky[1]);

        if (drawMoon) {
            let dayOfWeek = dKy_get_dayofweek(envLight);
            if (envLight.curTime < 180)
                dayOfWeek = (dayOfWeek + 7 - 1) % 7;

            const moonPos = this.moonPos;
            if (envLight.baseLight.color.r === 0.0 && roomType !== 2) {
                vec3.copy(moonPos, this.sunPos);
            } else {
                // Mirror the sun position
                vec3.sub(moonPos, this.sunPos, globals.cameraPosition);
                vec3.scaleAndAdd(moonPos, globals.cameraPosition, moonPos, -1.0);
            }

            const scaleX = dayOfWeek < 4 ? -1 : 1;
            const textureIdx = dayOfWeek < 4 ? dayOfWeek : 7 - dayOfWeek;

            const moonPitch = vecPitch(moonPos);

            for (let i = 1; i >= 0; i--) {
                let moonSize = 8000.0;

                if (globals.stageName === "F_SP127")
                    moonSize = 11000.0;

                if (globals.stageName === "F_SP200")
                    moonSize = 10000.0;

                if (globals.stageName === "F_SP103" && dKy_daynight_check(globals))
                    moonSize = 1200.0;

                if (i === 1)
                    moonSize *= 2.3;

                computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);
                mat4.rotateZ(scratchMatrix, scratchMatrix, MathConstants.DEG_TO_RAD * (45 + (360.0 * ((moonPitch - camPitch) / -MathConstants.TAU))));

                if (i === 0) {
                    this.moonTextures[textureIdx].fillTextureMapping(materialParams.m_TextureMapping[0]);

                    colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xF3FF94FF);
                    materialParams.u_Color[ColorKind.C0].a *= this.moonAlpha;
                    colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0x000000FF);

                    this.drawSquare(ddraw, scratchMatrix, moonPos, moonSize, scaleX, 1.0);
                } else {
                    mat4.rotateZ(scratchMatrix, scratchMatrix, MathConstants.DEG_TO_RAD * 50 * scaleX);

                    // envLight.wetherCommonTextures.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);

                    colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFCF4C);
                    materialParams.u_Color[ColorKind.C0].a *= this.moonAlpha;
                    colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xC56923FF);
                    materialParams.u_Color[ColorKind.C1].a *= this.moonAlpha;

                    let moonShineSize = moonSize;
                    if (dayOfWeek === 1 || dayOfWeek === 6)
                        moonShineSize *= 0.83;
                    else if (dayOfWeek !== 0)
                        moonShineSize *= 0.6;

                    this.drawSquare(ddraw, scratchMatrix, moonPos, moonSize, scaleX, 1.0, moonShineSize);
                }

                const renderInst = ddraw.makeRenderInst(renderInstManager);
                submitScratchRenderInst(renderInstManager, this.materialHelperSunMoon, renderInst, viewerInput);
            }
        }

        if (drawSun) {
            const sunPos = this.sunPos;

            const sunPitch = vecPitch(sunPos);
            computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);
            mat4.rotateZ(scratchMatrix, scratchMatrix, MathConstants.DEG_TO_RAD * (-50 + (360.0 * ((sunPitch - camPitch) / -8.0))));

            let sunSizeBase = 575.0;
            if (this.visibility > 0)
                sunSizeBase += (500 * this.visibility) * sqr(1.0 - this.distFalloff);

            for (let i = 1; i >= 0; i--) {
                let sunSize = sunSizeBase;
                if (i === 1)
                    sunSize *= 1.6;
    
                if (i === 0) {
                    this.sunTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
                } else {
                    // envLight.wetherCommonTextures.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
                }

                colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFF1FF);
                materialParams.u_Color[ColorKind.C0].a = this.sunAlpha;
                colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xFF9100FF);

                this.drawSquare(ddraw, scratchMatrix, sunPos, sunSize, 1.0, 1.0);
                const renderInst = ddraw.makeRenderInst(renderInstManager);

                submitScratchRenderInst(renderInstManager, this.materialHelperSunMoon, renderInst, viewerInput);
            }
        }
    }

    @dfShow()
    private lensflareColor = colorNewCopy(White);
    @dfRange(0, 1600, 1)
    private lensflareBaseSize: number = 960.0;
    @dfRange(0, 32, 1)
    private lensflareCount: number = 16.0;
    @dfRange(0.0, MathConstants.TAU, 0.0001)
    private lensflareAngles: number[] = [uShortTo2PI(0xf80a), uShortTo2PI(0x416b)];
    @dfRange(0.0, 0.8, 0.0001)
    private lensflareAngleSteps: number[] = [uShortTo2PI(0x1000), uShortTo2PI(0x1C71)];
    @dfRange(-5, 5)
    private lensflareSizes: number[] = [0.1, 1.1, 0.2, 0.4];
    @dfRange(0, MathConstants.TAU, 0.0001)
    private lensflareWidth: number = uShortTo2PI(1600.0);

    private drawLenzflare(globals: dGlobals, ddraw: TDDraw, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.visibility <= 0.1)
            return;

        const envLight = globals.g_env_light;

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);

        if (this.drawLenzInSky)
            renderInstManager.setCurrentRenderInstList(globals.dlst.sky[1]);
        else
            renderInstManager.setCurrentRenderInstList(globals.dlst.wetherEffect);

        const invDist = 1.0 - this.distFalloff;
        const flareViz = (0.6 + (0.8 * this.visibility * sqr(invDist)));
        const innerRad = 300 * flareViz;
        const flareScale = this.lensflareBaseSize * flareViz * (3.0 + invDist);
        const vizSq = sqr(this.visibility);

        let angle0 = this.lensflareAngles[0];
        let angle1 = this.lensflareAngles[1];
        for (let i = 0; i < this.lensflareCount; i++) {
            ddraw.begin(GX.Command.DRAW_TRIANGLES);

            let baseAngle: number;
            if ((i & 1) !== 0) {
                baseAngle = angle0;
            } else {
                baseAngle = angle1;
            }

            const flicker = Math.abs(Math.sin(34.0 * baseAngle));
            const arcSize = this.lensflareWidth * (0.5 + flicker);

            const arcAngle0 = baseAngle + arcSize;
            vec3.set(scratchVec3, innerRad * Math.sin(arcAngle0), innerRad * Math.cos(arcAngle0), 0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, this.sunPos);
            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            const whichScale = i & 3;
            let outerRadScale = ((0.6 + (0.4 * flicker)) * flareScale) * (1.5 * this.visibility);
            if (whichScale !== 0)
                outerRadScale *= 0.2;

            const outerRadScale2: number = this.lensflareSizes[whichScale];

            const outerRad = outerRadScale * (this.visibility * (sqr(this.visibility) + outerRadScale2));
            vec3.set(scratchVec3, outerRad * Math.sin(baseAngle), outerRad * Math.cos(baseAngle), 0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, this.sunPos);
            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            angle0 += this.lensflareAngleSteps[0];
            angle1 += this.lensflareAngleSteps[1];

            const arcAngle2 = baseAngle - arcSize;
            vec3.set(scratchVec3, innerRad * Math.sin(arcAngle2), innerRad * Math.cos(arcAngle2), 0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, this.sunPos);
            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            ddraw.end();
        }
        const lensflareAlpha = (80.0 * vizSq ** 3.0) / 0xFF;
        colorCopy(materialParams.u_Color[ColorKind.C0], this.lensflareColor, lensflareAlpha);

        const renderInst = ddraw.makeRenderInst(renderInstManager);
        submitScratchRenderInst(renderInstManager, this.materialHelperLenzflareSolid, renderInst, viewerInput);

        mat4.rotateZ(scratchMatrix, scratchMatrix, this.lenzflareAngle);

        const alphaTable = [255, 80, 140, 255, 125, 140, 170, 140];
        const scaleTable = [8000, 10000, 1600, 4800, 1200, 5600, 2400, 7200];
        for (let i = 7; i >= 0; i--) {
            if (this.drawLenzInSky && i !== 0)
                continue;

            let alpha = vizSq * alphaTable[i] / 0xFF;
            if (i >= 2)
                alpha *= this.distFalloff * 0.8;

            let size: number;
            if (i >= 2) {
                size = invDist * 0.08 * this.visibility * scaleTable[i];
            } else {
                size = (
                    ((0.04 + (0.075 * this.visibility)) * scaleTable[i]) +
                    ((0.2 * this.visibility * scaleTable[i]) * sqr(invDist))
                );
            }

            let basePos: vec3;
            if (i >= 2)
                basePos = this.lenzflarePos[i - 2];
            else
                basePos = this.sunPos;

            const scaleX = 1.0;
            const texCoordScale = i === 0 ? 1.0 : 2.0;
            this.drawSquare(ddraw, scratchMatrix, basePos, size, scaleX, texCoordScale);
            const renderInst = ddraw.makeRenderInst(renderInstManager);

            if (i === 0) {
                // envLight.wetherCommonTextures.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
            } else if (i === 1) {
                this.ringTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
            } else if (i >= 2) {
                this.lensTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
            }

            colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFF1FF);
            materialParams.u_Color[ColorKind.C0].a *= alpha;
            colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xFF91491E);

            submitScratchRenderInst(renderInstManager, this.materialHelperLenzflare, renderInst, viewerInput);
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.ddraw.beginDraw(globals.modelCache.cache);
        this.ddraw.allocPrimitives(GX.Command.DRAW_TRIANGLES, 2048);
        this.drawLenzflare(globals, this.ddraw, renderInstManager, viewerInput);
        this.drawSunMoon(globals, this.ddraw, renderInstManager, viewerInput);
        this.ddraw.endDraw(renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class VRKUMO_EFF {
    public position = vec3.create();
    public distFalloff: number;
    public alpha: number;
    public speed: number;
    public height: number;

    constructor() {
        const angle = cM_rndF(MathConstants.TAU);
        let dist = cM_rndF(18000.0);
        if (dist > 15000.0)
            dist = 14000.0 + cM_rndF(1000.0);
        this.position[0] = dist * Math.sin(angle);
        this.position[2] = dist * Math.cos(angle);
        this.alpha = 0.0;
        this.speed = 0.5 + cM_rndF(4.0);
        this.height = 0.3 * cM_rndFX(0.3);
    }
}

export class dKankyo_vrkumo_Packet {
    public enabled: boolean = false;
    public count: number = 0;
    public strength: number = 0;
    public instances: VRKUMO_EFF[] = nArray(100, () => new VRKUMO_EFF());
    public bounceAnimTimer: number = 0;
    private ddraw = new TDDraw();
    private textures: BTIData[] = [];
    private materialHelper: GXMaterialHelperGfx;

    constructor(globals: dGlobals) {
        const tex01 = globals.resCtrl.getStageResByName(ResType.Bti, `STG_00`, "cloudtx_01.bti");
        if (tex01 === null)
            return;

        this.textures.push(tex01);
        this.textures.push(assertExists(globals.resCtrl.getStageResByName(ResType.Bti, `STG_00`, "cloudtx_02.bti")));
        this.textures.push(assertExists(globals.resCtrl.getStageResByName(ResType.Bti, `STG_00`, "cloudtx_03.bti")));

        this.enabled = true;

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);

        const mb = new GXMaterialBuilder();
        // noclip modification: Use VTX instead of separate draw calls for the color.
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C1, GX.CC.RASC, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('dKankyo_vrkumo_packet'));
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        assert(this.textures.length > 0);

        const envLight = globals.g_env_light;

        // Clouds are projected onto a dome that hovers around the camera.

        const domeRadius = /* globals.dStage_dt.stag.farPlane -  */10000.0;
        const ddraw = this.ddraw;

        renderInstManager.setCurrentRenderInstList(globals.dlst.sky[1]);

        ddraw.beginDraw(globals.modelCache.cache);
        ddraw.allocPrimitives(GX.Command.DRAW_QUADS, 4*3*100);

        colorFromRGBA(materialParams.u_Color[ColorKind.C1], 0, 0, 0, 0);

        for (let textureIdx = 2; textureIdx >= 0; textureIdx--) {
            this.textures[textureIdx].fillTextureMapping(materialParams.m_TextureMapping[0]);

            ddraw.begin(GX.Command.DRAW_QUADS, 4 * this.instances.length);

            for (let i = 0; i < this.instances.length; i++) {
                const kumo = this.instances[i];

                if (kumo.alpha <= 0.0000000001)
                    continue;

                let tmp = 0.6;
                let fvar9 = 0.84;
                if (dKy_darkworld_check(globals)) {
                    tmp = 0.8;
                    fvar9 = 0.8;
                }

                if (globals.stageName === "D_MN07A") {
                    fvar9 = 0.65;
                }

                const size = kumo.distFalloff * (1.0 - ((((textureIdx + i) & 0x0F) / 16.0) ** 3.0)) * (tmp + (this.strength * (fvar9 - tmp)));

                const bounceAnim = Math.sin(textureIdx + 0.0001 * this.bounceAnimTimer);
                const sizeAnim = size + (0.06 * size) * bounceAnim * kumo.distFalloff;
                const height = sizeAnim + sizeAnim * kumo.height;
                const m0 = sizeAnim * ((i / 100) * 0.2 + 0.2);
                const m1 = sizeAnim * ((i / 100) * 0.3 + 0.55);

                let polarOffs = 0, azimuthalOffs = 0;
                if (textureIdx !== 0) {
                    const cloudRep = i & 3;
                    if (cloudRep === 0) {
                        if (textureIdx === 2) {
                            polarOffs = m1;
                            azimuthalOffs = m0;
                        }
                    } else if (cloudRep === 1) {
                        if (textureIdx === 1) {
                            polarOffs = -m0;
                            azimuthalOffs = m0;
                        } else if (textureIdx === 2) {
                            polarOffs = -m1;
                            azimuthalOffs = m1;
                        }
                    } else if (cloudRep === 2) {
                        if (textureIdx === 1) {
                            polarOffs = m1;
                            azimuthalOffs = -m1;
                        } else if (textureIdx === 2) {
                            polarOffs = m0;
                            azimuthalOffs = -m1;
                        }
                    } else if (cloudRep === 3) {
                        if (textureIdx === 1) {
                            polarOffs = -m1;
                        } else if (textureIdx === 2) {
                            polarOffs = -m0;
                            azimuthalOffs = m0;
                        }
                    }
                }

                const polarY1 = Math.atan2(kumo.position[1], Math.hypot(kumo.position[0], kumo.position[2])) + polarOffs;
                const normalPitch = Math.pow(Math.min(polarY1 / 1.9, 1.0), 3);

                const azimuthal = Math.atan2(kumo.position[0], kumo.position[2]) + azimuthalOffs;
                const azimuthalOffsY0 = 0.6 * sizeAnim * (1.0 + 16.0 * normalPitch);
                const azimuthalOffsY1 = 0.6 * sizeAnim * (1.0 + 2.0 * normalPitch);

                const polarY0 = Math.min(polarY1 + 0.9 * height * (1.0 + -4.0 * normalPitch), 1.21);

                let x = 0, y = 0, z = 0;

                colorLerp(materialParams.u_Color[ColorKind.C0], envLight.vrKumoCol, envLight.unk_vrboxCol1, kumo.distFalloff);
                materialParams.u_Color[ColorKind.C0].a = kumo.alpha;

                // Project onto sphere.
                x = Math.cos(polarY0) * Math.sin(azimuthal + azimuthalOffsY0);
                y = Math.sin(polarY0);
                z = Math.cos(polarY0) * Math.cos(azimuthal + azimuthalOffsY0);
                vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                ddraw.position3vec3(scratchVec3);
                ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

                x = Math.cos(polarY0) * Math.sin(azimuthal - azimuthalOffsY0);
                y = Math.sin(polarY0);
                z = Math.cos(polarY0) * Math.cos(azimuthal - azimuthalOffsY0);
                vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                ddraw.position3vec3(scratchVec3);
                ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);

                x = Math.cos(polarY1) * Math.sin(azimuthal - azimuthalOffsY1);
                y = Math.sin(polarY1);
                z = Math.cos(polarY1) * Math.cos(azimuthal - azimuthalOffsY1);
                vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                ddraw.position3vec3(scratchVec3);
                ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);

                x = Math.cos(polarY1) * Math.sin(azimuthal + azimuthalOffsY1);
                y = Math.sin(polarY1);
                z = Math.cos(polarY1) * Math.cos(azimuthal + azimuthalOffsY1);
                vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                ddraw.position3vec3(scratchVec3);
                ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);

                const stageName = globals.stageName;
                if (stageName == "F_SP127" || stageName == "D_MN07" || stageName == "D_MN08" || stageName == "D_MN07A" || (stageName == "F_SP103" && globals.mStayNo === 0)) {
                    x = Math.cos(polarY0) * Math.sin(azimuthal + azimuthalOffsY0);
                    y = Math.sin(polarY0);
                    z = Math.cos(polarY0) * Math.cos(azimuthal + azimuthalOffsY0);
                    vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                    vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                    ddraw.position3vec3(scratchVec3);
                    ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                    ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

                    x = Math.cos(polarY0) * Math.sin(azimuthal - azimuthalOffsY0);
                    y = Math.sin(polarY0);
                    z = Math.cos(polarY0) * Math.cos(azimuthal - azimuthalOffsY0);
                    vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                    vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                    ddraw.position3vec3(scratchVec3);
                    ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                    ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);

                    x = Math.cos(polarY1) * Math.sin(azimuthal - azimuthalOffsY1);
                    y = Math.sin(polarY1);
                    z = Math.cos(polarY1) * Math.cos(azimuthal - azimuthalOffsY1);
                    vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                    vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                    ddraw.position3vec3(scratchVec3);
                    ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                    ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);

                    x = Math.cos(polarY1) * Math.sin(azimuthal + azimuthalOffsY1);
                    y = Math.sin(polarY1);
                    z = Math.cos(polarY1) * Math.cos(azimuthal + azimuthalOffsY1);
                    vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                    vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                    ddraw.position3vec3(scratchVec3);
                    ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                    ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);
                }
            }

            ddraw.end();

            if (ddraw.hasIndicesToDraw()) {
                const renderInst = ddraw.makeRenderInst(renderInstManager);
                submitScratchRenderInst(renderInstManager, this.materialHelper, renderInst, viewerInput);
            }
        }

        ddraw.endDraw(renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

export class HOUSI_EFF {
    public initialized = false;
    public status: number;
    public position = vec3.create();
    public basePos = vec3.create();
    public speed: number = 1.0;
    public scale: number = 1.0;
    public alpha: number = 1.0;
};

// the square twilight particle things
export class dKankyo_housi_Packet {
    private tex: BTIData;
    public count: number = 0;
    public instances: HOUSI_EFF[] = nArray(300, () => new HOUSI_EFF());
    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;
    public rot: number = 0.0;

    constructor(globals: dGlobals) {
        this.tex = assertExists(globals.resCtrl.getObjectRes(ResType.Bti, `Always`, 0x56));

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);

        const mb = new GXMaterialBuilder();
        // noclip modification: Use VTX instead of separate draw calls for the color.
        //mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C1, GX.CC.RASC, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('dKankyo_housi_Packet'));
    }

    public drawHousi(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;
        const ddraw = this.ddraw;

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);

        renderInstManager.setCurrentRenderInstList(globals.dlst.wetherEffect);

        let c1 = colorNewFromRGBA8(0xE5FFC800 | (120.0 & 0xFF));
        let c2 = colorNewFromRGBA8(0x43D2CAFF);

        if (dKy_darkworld_check(globals) || globals.stageName === "D_MN08") {
            c2 = colorNewFromRGBA8(0x000000FF);
        }

        colorCopy(materialParams.u_Color[ColorKind.C0], c1);
        colorCopy(materialParams.u_Color[ColorKind.C1], c2);

        this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);

        for (let i = 0; i < envLight.housiCount; i++) {
            const housi = this.instances[i];
            vec3.add(scratchVec3, housi.basePos, housi.position);

            materialParams.u_Color[ColorKind.C0].a = housi.alpha;

            // basePos
            vec3.add(scratchVec3, housi.basePos, housi.position);
            const dist = vec3.distance(scratchVec3, globals.cameraPosition);

            ddraw.begin(GX.Command.DRAW_QUADS, 4 * 5 * this.count);

            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);

            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);

            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);

            ddraw.end();
        }

        if (ddraw.hasIndicesToDraw()) {
            const renderInst = ddraw.makeRenderInst(renderInstManager);
            submitScratchRenderInst(renderInstManager, this.materialHelper, renderInst, viewerInput);
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        if (envLight.housiCount === 0)
            return;
        
        this.ddraw.beginDraw(globals.modelCache.cache);
        this.drawHousi(globals, renderInstManager, viewerInput);
        this.ddraw.endDraw(renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class RAIN_EFF {
    public initialized = false;
    public alpha: number = 0.0;
    public timer: number = 0;
    public basePos = vec3.create();
    public pos = vec3.create();
    public minY: number = 0.0;
}

export class dKankyo_rain_Packet {
    private ringTexture: BTIData;
    private ddraw = new TDDraw();
    private materialHelperRain: GXMaterialHelperGfx;
    private materialHelperSibuki: GXMaterialHelperGfx;
    private sibukiAlpha: number = 0.0;
    private offsets = [
        vec3.fromValues(150, 0, 0),
        vec3.fromValues(0, 150, 150),
        vec3.fromValues(150, 320, 150),
        vec3.fromValues(45, 480, 45),
    ];
    public instances = nArray(250, () => new RAIN_EFF());
    public rainCount: number = 0.0;

    public camEyePos = vec3.create();
    public centerDelta = vec3.create();
    public centerDeltaMul = 0.0;

    public sibukiHidden: boolean = false;

    constructor(globals: dGlobals) {
        const resCtrl = globals.resCtrl;

        this.ringTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x85);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.C1, GX.CC.C0, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.A0, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelperRain = new GXMaterialHelperGfx(mb.finish('dKankyo_rain_packet'));

        mb.setZMode(true, GX.CompareType.GEQUAL, false);
        this.materialHelperSibuki = new GXMaterialHelperGfx(mb.finish('dKankyo_rain_packet sibuki'));
    }

    private drawRain(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;
        const ddraw = this.ddraw;

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);

        renderInstManager.setCurrentRenderInstList(globals.dlst.wetherEffect);

        colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0x8080800A);
        // envLight.wetherCommonTextures.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);

        // To save on draw call count, all rain currently have the same alpha.
        const alpha = 14/0xFF;
        colorFromRGBA(materialParams.u_Color[ColorKind.C0], 1.0, 1.0, 1.0, alpha);

        for (let i = 0; i < this.rainCount; i++) {
            const rain = this.instances[i];
            vec3.add(scratchVec3, rain.basePos, rain.pos);

            if (rain.alpha <= 0.001)
                continue;

            // const alpha = rain.alpha * 14/0xFF;
            // colorFromRGBA(materialParams.u_Color[ColorKind.C0], 1.0, 1.0, 1.0, alpha);

            const size = 2.5 + (i / 250.0);
            vec3.set(scratchVec3c, -size, 0, 0);
            vec3.transformMat4(scratchVec3c, scratchVec3c, scratchMatrix);
            vec3.set(scratchVec3d, size, 0, 0);
            vec3.transformMat4(scratchVec3d, scratchVec3d, scratchMatrix);

            // basePos
            vec3.add(scratchVec3, rain.basePos, rain.pos);
            const dist = vec3.distance(scratchVec3, globals.cameraPosition);
            vec3.add(scratchVec3c, scratchVec3c, scratchVec3);
            vec3.add(scratchVec3d, scratchVec3d, scratchVec3);

            dKyw_get_wind_vecpow(scratchVec3, envLight);

            const baseSpeed = 5.0 + 70.0 * Math.min(0.1 + dist / 1500.0);

            const idx7 = i & 7;
            vec3.set(scratchVec3,
                baseSpeed * (scratchVec3[0] + 10.0 * this.centerDelta[0] * this.centerDeltaMul + (0.08 * idx7)),
                baseSpeed * (-2.0 + scratchVec3[1] + this.centerDelta[1] * this.centerDeltaMul),
                baseSpeed * (scratchVec3[2] + 10.0 * this.centerDelta[2] * this.centerDeltaMul + (0.08 * idx7)),
            );

            vec3.sub(scratchVec3a, scratchVec3d, scratchVec3);
            vec3.sub(scratchVec3b, scratchVec3c, scratchVec3);

            ddraw.begin(GX.Command.DRAW_QUADS, 4 * 5 * this.rainCount);

            for (let j = 0; j < 4; j++) {
                vec3.add(scratchVec3, scratchVec3a, this.offsets[j]);
                ddraw.position3vec3(scratchVec3);
                ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

                vec3.add(scratchVec3, scratchVec3b, this.offsets[j]);
                ddraw.position3vec3(scratchVec3);
                ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);

                vec3.add(scratchVec3, scratchVec3c, this.offsets[j]);
                ddraw.position3vec3(scratchVec3);
                ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);

                vec3.add(scratchVec3, scratchVec3d, this.offsets[j]);
                ddraw.position3vec3(scratchVec3);
                ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);
            }

            ddraw.end();
        }

        if (ddraw.hasIndicesToDraw()) {
            const renderInst = ddraw.makeRenderInst(renderInstManager);
            submitScratchRenderInst(renderInstManager, this.materialHelperRain, renderInst, viewerInput);
        }
    }

    private drawSibuki(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // Sibuki means "splash"
        const envLight = globals.g_env_light;

        const sibukiCount = envLight.rainCount >>> 1;
        if (sibukiCount < 1)
            return;
    
        const alphaTarget = this.sibukiHidden ? 0.0 : 200/255;
        this.sibukiAlpha = cLib_addCalc(this.sibukiAlpha, alphaTarget, 0.2, 3.0, 0.001);

        let additionalAlphaFade: number;
        if (globals.cameraFwd[1] > 0.0 && globals.cameraFwd[1] < 0.5)
            additionalAlphaFade = 1.0 - (globals.cameraFwd[1] / 0.5);
        else if (globals.cameraFwd[1] > 0.0)
            additionalAlphaFade = 0.0;
        else
            additionalAlphaFade = 1.0;

        const finalAlpha = this.sibukiAlpha * additionalAlphaFade;
        if (finalAlpha <= 0.001)
            return;

        const ddraw = this.ddraw;
        renderInstManager.setCurrentRenderInstList(globals.dlst.wetherEffect);

        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xB4C8C800);
        materialParams.u_Color[ColorKind.C0].a = finalAlpha;
        colorCopy(materialParams.u_Color[ColorKind.C1], materialParams.u_Color[ColorKind.C0]);
        // this.ringTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);

        dKy_set_eyevect_calc(globals, scratchVec3, 7000.0, 4000.0);

        ddraw.begin(GX.Command.DRAW_QUADS, 4 * sibukiCount);

        // TODO(jstpierre): From FoVY?
        const fovYAdj = 0.0;
        for (let i = 0; i < sibukiCount; i++) {
            const size = 20.0 + (fovYAdj * cM_rndF(25.0));

            const baseX = scratchVec3[0] + cM_rndFX(3600.0);
            const baseY = scratchVec3[1] + cM_rndFX(1500.0);
            const baseZ = scratchVec3[2] + cM_rndFX(3600.0);

            vec3.set(scratchVec3a, baseX - size, baseY, baseZ - size);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            vec3.set(scratchVec3a, baseX + size, baseY, baseZ - size);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 2, 0);

            vec3.set(scratchVec3a, baseX + size, baseY, baseZ + size);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 2, 2);

            vec3.set(scratchVec3a, baseX - size, baseY, baseZ + size);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 2);
        }

        ddraw.end();

        const renderInst = ddraw.makeRenderInst(renderInstManager);
        submitScratchRenderInst(renderInstManager, this.materialHelperSibuki, renderInst, viewerInput);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        if (envLight.rainCount === 0)
            return;

        this.ddraw.beginDraw(globals.modelCache.cache);
        this.drawRain(globals, renderInstManager, viewerInput);
        this.drawSibuki(globals, renderInstManager, viewerInput);
        this.ddraw.endDraw(renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class WIND_EFF {
    public emitter: JPABaseEmitter | null = null;
    public state: number = 0;
    public swerveAngleXZ: number = 0;
    public swerveAngleY: number = 0;
    public alpha: number = 0;
    public loopDeLoopCounter: number = 0;
    public swerveAnimCounter: number = 0;
    public doLoopDeLoop: boolean = false;
    public stateTimer: number = 0;
    public basePos = vec3.create();
    public animPos = vec3.create();
}

class STAR_EFF {
    public animCounter: number = 0;
    public animWave: number = 0.0;
}

export class dKankyo_star_Packet {
    public instances = nArray(1, () => new STAR_EFF());
    public rot: number = 0.0;

    private hokuto_pos = [
        vec3.fromValues(15283, 31005, -17919),
        vec3.fromValues(13525, 28369, -22265),
        vec3.fromValues(8300, 31884, -20507),
        vec3.fromValues(3906, 31005, -23144),
        vec3.fromValues(-439, 30127, -17919),
        vec3.fromValues(-7421, 31005, 18798),
        vec3.fromValues(-10937, 2800, 15000),
        vec3.fromValues(-10000, 24902, 18400),
        vec3.fromValues(-9400, 22500, 15900),
        vec3.fromValues(-9179, 21300, 14300),
        vec3.fromValues(-10300, 22000, 21000),
        vec3.fromValues(-16000, 25500, 20000),
        vec3.fromValues(0, 30000, 19000),
    ];

    private star_col: Color[] = [
        colorNewFromRGBA8(0xFFBEC8A0),
        colorNewFromRGBA8(0xC8FFBE78),
        colorNewFromRGBA8(0xC8BEFF50),
        colorNewFromRGBA8(0xFFFFFFC8),
    ];

    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;

    public renderInMain = false;

    constructor(globals: dGlobals) {
        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);

        const mb = new GXMaterialBuilder();
        // noclip modification: Use VTX instead of separate draw calls for the color.
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('dKankyo_star_Packet'));
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        if (envLight.starCount === 0)
            return;

        const ddraw = this.ddraw;

        if (this.renderInMain)
            renderInstManager.setCurrentRenderInstList(globals.dlst.main[1]);
        else
            renderInstManager.setCurrentRenderInstList(globals.dlst.sky[1]);

        ddraw.beginDraw(globals.modelCache.cache);
        ddraw.begin(GX.Command.DRAW_TRIANGLES, 6 * envLight.starCount);

        const star = this.instances[0];

        const fovYAdj = 0.0;

        // Compute star points.
        const starSize = (1.0 - fovYAdj) * 0.28;
        vec3.set(scratchVec3b, 0.0, starSize, 0.0);
        vec3.set(scratchVec3c, starSize, -0.5 * starSize, 0.0);
        vec3.set(scratchVec3d, -starSize, -0.5 * starSize, 0.0);

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);
        mat4.rotateZ(scratchMatrix, scratchMatrix, this.rot * MathConstants.DEG_TO_RAD);

        vec3.transformMat4(scratchVec3b, scratchVec3b, scratchMatrix);
        vec3.transformMat4(scratchVec3c, scratchVec3c, scratchMatrix);
        vec3.transformMat4(scratchVec3d, scratchVec3d, scratchMatrix);

        // Projected moon position.
        mDoLib_project(scratchVec3e, envLight.moonPos, viewerInput);

        let radius = 0.0, angle: number = -Math.PI, angleIncr = 0.0;
        for (let i = 0; i < envLight.starCount; i++) {
            let scale: number;
            if (i < this.hokuto_pos.length) {
                // Orion.
                const baseScale = (i < 5 ? 540.0 : 400.0) + star.animWave;
                scale = baseScale - (fovYAdj * 0.5 * baseScale);

                vec3.copy(scratchVec3a, this.hokuto_pos[i]);
            } else {
                scale = star.animWave + (0.03125 * (i & 0x0F) + 0.8);
                if (scale > 1.0)
                    scale = (1.0 - (scale - 1.0));

                const radiusXZ = 1.0 - (radius / 202.0);
                scratchVec3a[0] = radiusXZ * -300.0 * Math.sin(angle);
                scratchVec3a[1] = radius + 45.0;
                scratchVec3a[2] = radiusXZ * 300.0 * Math.cos(angle);

                angle += angleIncr;
                angleIncr += uShortTo2PI(0x09C4);

                radius += (1.0 + 3.0 * (radius / 200.0 ** 3.0));
                if (radius > 200.0)
                    radius = (20.0 * i) / 1000.0;
            }

            vec3.add(scratchVec3a, scratchVec3a, globals.cameraPosition);

            mDoLib_project(scratchVec3, scratchVec3a, viewerInput);
            const distToMoon = vec3.dist(scratchVec3, scratchVec3e);
            if (distToMoon < 80.0)
                continue;

            let whichColor: number;
            if (i === 6 || i === 8) {
                whichColor = 1;
            } else if ((i & 0x3F) === 0) {
                whichColor = (i >>> 4) & 0x03;
            } else {
                whichColor = 0;
            }

            const color = this.star_col[whichColor];

            // Triangle 1.
            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3b, scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3c, scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3d, scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            // Triangle 2.
            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3b, -scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3c, -scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3d, -scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);
        }

        ddraw.end();
        ddraw.endDraw(renderInstManager);

        if (ddraw.hasIndicesToDraw()) {
            const renderInst = ddraw.makeRenderInst(renderInstManager);
            submitScratchRenderInst(renderInstManager, this.materialHelper, renderInst, viewerInput);
        }
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

export function dKyr_get_vectle_calc(p0: ReadonlyVec3, p1: ReadonlyVec3, dst: vec3): void {
    vec3.sub(dst, p1, p0);
    vec3.normalize(dst, dst);
}

function sqr(n: number): number {
    return n * n;
}

function project(dst: vec3, v: vec3, camera: Camera, v4 = scratchVec4): void {
    vec4.set(v4, v[0], v[1], v[2], 1.0);
    vec4.transformMat4(v4, v4, camera.clipFromWorldMatrix);
    divideByW(v4, v4);
    vec3.set(dst, v4[0], v4[1], v4[2]);
}

function mDoLib_project(dst: vec3, v: vec3, viewerInput: ViewerRenderInput): void {
    project(dst, v, viewerInput.camera);
    // Put in viewport framebuffer space.
    dst[0] = (dst[0] * 0.5 + 0.5) * viewerInput.backbufferWidth;
    dst[1] = (dst[1] * 0.5 + 0.5) * viewerInput.backbufferHeight;
    dst[2] = 0.0;
}

const enum SunPeekZResult {
    Visible, Obscured, Culled,
}

function dKyr_sun_move__PeekZ(dst: PeekZResult, peekZ: PeekZManager, v: ReadonlyVec3, offs: ReadonlyVec2, clipSpaceNearZ: GfxClipSpaceNearZ): SunPeekZResult {
    // Original game tests for rotated disco pattern: -10,-20, 10,20, -20,10, 20,-10
    // This was meant to be used against a 640x480 FB space, so:
    const scaleX = 1/640, scaleY = 1/480;
    peekZ.newData(dst, v[0] + offs[0] * scaleX, v[1] + offs[1] * scaleY);

    if (dst.triviallyCulled)
        return SunPeekZResult.Culled;

    // Value is not available yet; consider it obscured.
    if (dst.value === null)
        return SunPeekZResult.Obscured;

    // Test if the depth buffer is less than our projected Z coordinate.
    // Depth buffer readback should result in 0.0 for the near plane, and 1.0 for the far plane.
    // Put projected coordinate in 0-1 normalized space.
    let projectedZ = v[2];

    if (clipSpaceNearZ === GfxClipSpaceNearZ.NegativeOne)
        projectedZ = projectedZ * 0.5 + 0.5;

    // Point is visible if our projected Z is in front of the depth buffer.
    const visible = compareDepthValues(projectedZ, dst.value, GfxCompareMode.Less);

    return visible ? SunPeekZResult.Visible : SunPeekZResult.Obscured;
}

function dKyr_sun_move(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    const pkt = envLight.sunPacket!;

    const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
    if (envLight.baseLight.color.r === 0.0 && roomType !== 2) {
        dKyr_get_vectle_calc(globals.cameraPosition, envLight.baseLight.pos, scratchVec3);
    } else {
        dKyr_get_vectle_calc(globals.cameraPosition, envLight.sunPos, scratchVec3);
    }
    vec3.scaleAndAdd(pkt.sunPos, globals.cameraPosition, scratchVec3, 8000.0);

    let sunCanGlare = true;
    if (envLight.colpatWeather !== 0 || (envLight.colpatCurr !== 0 && envLight.colpatBlend > 0.5)) {
        // Sun should not glare during non-sunny weather.
        sunCanGlare = false;
    } else if (roomType === 2) {
        // Sun should not glare indoors.
        sunCanGlare = false;
    } else if (envLight.curTime < 120.0 || envLight.curTime > 270.0) {
        // Sun should not glare during strange hours of night.
        sunCanGlare = false;
    }

    let numCenterPointsVisible = 0, numPointsVisible = 0, numCulledPoints = 0;

    const clipSpaceNearZ = globals.modelCache.device.queryVendorInfo().clipSpaceNearZ;

    let staringAtSunAmount = 0.0;
    if (dKyr__sun_arrival_check(envLight)) {
        pkt.sunAlpha = cLib_addCalc(pkt.sunAlpha, 1.0, 0.5, 0.1, 0.01);

        if (sunCanGlare) {
            // Original game projects the vector into viewport space, and gets distance to 320, 240.
            project(scratchVec3, pkt.sunPos, globals.camera);

            const peekZ = globals.dlst.peekZ;

            for (let i = 0; i < pkt.chkPoints.length; i++) {
                const res = dKyr_sun_move__PeekZ(pkt.peekZResults[i], peekZ, scratchVec3, pkt.chkPoints[i], clipSpaceNearZ);

                if (res === SunPeekZResult.Culled) {
                    numCulledPoints++;
                } else if (res === SunPeekZResult.Visible) {
                    numPointsVisible++;

                    if (i === 0)
                        numCenterPointsVisible++;
                }
            }

            if (numCulledPoints !== 0 && numPointsVisible !== 0 && numCenterPointsVisible !== 0) {
                numCenterPointsVisible = 1;
                numPointsVisible = 5;
            }
        }

        scratchVec3[2] = 0.0;
        const distance = vec3.length(scratchVec3) * 320.0;

        const normalizedDist = Math.min(distance / 450.0, 1.0);
        const distFalloff = sqr(1.0 - normalizedDist);
        pkt.distFalloff = 1.0 - distFalloff;
        staringAtSunAmount = sqr(distFalloff);
    } else {
        if (globals.stageName === "F_SP200" ||globals.stageName === "D_MN09B") {
            pkt.sunAlpha = cLib_addCalc(pkt.sunAlpha, 0.0, 0.1, 0.05, 0.001);
        }
    }

    if (numCenterPointsVisible === 0) {
        if (numPointsVisible === 0)
            pkt.visibility = cLib_addCalc(pkt.visibility, 0.0, 0.5, 0.5, 0.001);
        else
            pkt.visibility = cLib_addCalc(pkt.visibility, 0.0, 0.2, 0.3, 0.001);
    } else {
        if (numPointsVisible === 4)
            pkt.visibility = cLib_addCalc(pkt.visibility, 1.0, 0.5, 0.5, 0.01);
        else
            pkt.visibility = cLib_addCalc(pkt.visibility, 1.0, 0.2, 0.3, 0.001);
    }

    if (pkt.visibility > 0.0) {
        pkt.drawLenzInSky = false;
    } else {
        pkt.drawLenzInSky = true;
    }

    if (pkt.sunPos[1] > 0.0) {
        const pulsePos = 1.0 - sqr(1.0 - saturate(pkt.sunPos[1] - globals.cameraPosition[1] / 8000.0));

        dKy_set_actcol_ratio(envLight, 1.0 - (staringAtSunAmount * pkt.visibility));
        dKy_set_bgcol_ratio(envLight, 1.0 - (staringAtSunAmount * pkt.visibility));
        dKy_set_fogcol_ratio(envLight, 1.0 + 0.5 * (pulsePos * staringAtSunAmount * pkt.visibility));
        dKy_set_vrboxcol_ratio(envLight, 1.0 + 0.5 * (pulsePos * staringAtSunAmount * pkt.visibility));
    }

    if (dKyr_moon_arrival_check(envLight)) {
        const diffY = (pkt.sunPos[1] - globals.cameraPosition[1]) / -8000.0;
        const target = Math.min(diffY * diffY * 6.0, 1.0);
        pkt.moonAlpha = cLib_addCalc(pkt.moonAlpha, target, 0.2, 0.01, 0.001);
    } else {
        pkt.moonAlpha = cLib_addCalc(pkt.moonAlpha, 0.0, 0.2, 0.01, 0.001);
    }
}

function dKy_set_eyevect_calc(globals: dGlobals, dst: vec3, scaleXZ: number, scaleY: number = scaleXZ): void {
    dst[0] = globals.cameraPosition[0] + globals.cameraFwd[0] * scaleXZ;
    dst[1] = (globals.cameraPosition[1] + globals.cameraFwd[1] * scaleY) - 200.0;
    dst[2] = globals.cameraPosition[2] + globals.cameraFwd[2] * scaleXZ;
}

function dKy_set_eyevect_calc2(globals: dGlobals, dst: vec3, scaleXZ: number, scaleY: number = scaleXZ): void {
    vec3.copy(dst, globals.cameraFwd);
    if (scaleY === 0.0)
        dst[1] = 0.0;
    vec3.normalize(dst, dst);
    dst[0] = globals.cameraPosition[0] + dst[0] * scaleXZ;
    dst[1] = globals.cameraPosition[1] + dst[1] * scaleXZ;
    dst[2] = globals.cameraPosition[2] + dst[2] * scaleXZ;
}

function dKyr_lenzflare_move(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    const pkt = envLight.sunPacket!;

    dKy_set_eyevect_calc(globals, scratchVec3, 7200);
    dKyr_get_vectle_calc(scratchVec3, pkt.sunPos, scratchVec3);

    const dist = vec3.distance(scratchVec3, globals.cameraFwd);
    const intensity = 250.0 + (350.0 * dist);
    for (let i = 0; i < 6; i++) {
        const whichLenz = i + 2;
        vec3.scaleAndAdd(pkt.lenzflarePos[i], pkt.sunPos, scratchVec3, -intensity * whichLenz);
    }

    project(scratchVec3, pkt.sunPos, globals.camera);
    pkt.lenzflareAngle = Math.atan2(scratchVec3[1], scratchVec3[0]) + Math.PI / 2;
}

function wether_move_thunder(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    if (envLight.thunderActive) {
        dKyr_thunder_move(globals, envLight, globals.cameraPosition);
    } else if (envLight.thunderMode !== ThunderMode.Off) {
        dKyr_thunder_init(envLight);
        envLight.thunderActive = true;
    }
}

function wether_move_sun(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    if (!globals.scnPlay.vrboxLoaded || envLight.vrboxInvisible)
        return;

    if (envLight.sunPacket === null)
        envLight.sunPacket = new dKankyo_sun_Packet(globals);

    dKyr_sun_move(globals);
    dKyr_lenzflare_move(globals);
}

function wether_move_rain(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    if (envLight.rainCount === 0)
        return;

    if (envLight.rainPacket === null)
        envLight.rainPacket = new dKankyo_rain_Packet(globals);

    const pkt = envLight.rainPacket;

    dKyw_get_wind_vecpow(scratchVec3a, envLight);
    if (envLight.rainCount > pkt.rainCount)
        pkt.rainCount = envLight.rainCount;

    if (pkt.rainCount === 0)
        return;

    let fadeMaxXZDist = 0;
    let fadeMaxY = 0;

    const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
    if (roomType === 2 && globals.stageName !== 'Ocrogh' && globals.stageName !== 'Omori') {
        if (globals.stageName === 'Orichh')
            fadeMaxXZDist = 2300.0;
        else
            fadeMaxXZDist = 1200.0;

        if (globals.stageName === 'Atorizk')
            fadeMaxY = 1300.0;
    }

    // TODO(jstpierre): Center delta
    // dKyr_get_vectle_calc(pkt.camEyePos)

    dKy_set_eyevect_calc2(globals, scratchVec3, 700.0, 600.0);

    for (let i = 0; i < pkt.rainCount; i++) {
        const rain = pkt.instances[i];

        if (rain.initialized) {
            rain.pos[0] += deltaTimeInFrames * 20.0 * (scratchVec3a[0] + (10.0 * pkt.centerDelta[0] * pkt.centerDeltaMul) + 0.08 * (i & 0x07));
            rain.pos[1] += deltaTimeInFrames * 20.0 * ((-2.0 + scratchVec3a[1] + (10.0 * pkt.centerDelta[1] + pkt.centerDeltaMul)));
            rain.pos[2] += deltaTimeInFrames * 20.0 * (scratchVec3a[2] + (10.0 * pkt.centerDelta[2] * pkt.centerDeltaMul) + 0.08 * (i & 0x03));

            vec3.set(scratchVec3c, rain.basePos[0] + rain.pos[0], scratchVec3[1], rain.basePos[2] + rain.pos[2]);
            const distXZ = vec3.distance(scratchVec3c, scratchVec3);
            if (rain.timer <= 0) {
                if (distXZ > 800) {
                    rain.timer = 10;
                    vec3.copy(rain.basePos, scratchVec3);
                    if (distXZ <= 850) {
                        dKyr_get_vectle_calc(scratchVec3c, scratchVec3, scratchVec3b);
                        vec3.scale(rain.pos, scratchVec3b, 800.0 + cM_rndFX(40.0));
                    } else {
                        vec3.set(rain.pos, cM_rndFX(800), cM_rndFX(800), cM_rndFX(800));
                    }
                    rain.minY = -800 + globals.cameraPosition[1];
                }

                const posY = rain.basePos[1] + rain.pos[1];
                if (posY < 20.0 + rain.minY) {
                    vec3.copy(rain.basePos, scratchVec3);
                    vec3.set(rain.pos, cM_rndFX(800.0), 200.0, cM_rndFX(800.0));
                    rain.minY = -800 + globals.cameraPosition[1];
                    rain.timer = 10;
                }
            } else {
                rain.timer -= deltaTimeInFrames;
            }
        } else {
            vec3.copy(rain.basePos, scratchVec3);
            vec3.set(rain.pos, cM_rndFX(800.0), cM_rndFX(600.0), cM_rndFX(800.0));
            rain.alpha = 1.0;
            rain.timer = 0;
            rain.minY = -800 + globals.cameraPosition[1];
            rain.initialized = true;
        }

        let alpha = 1.0;

        if (fadeMaxXZDist > 0.0) {
            vec3.add(scratchVec3c, rain.basePos, rain.pos);

            const distXZ = Math.hypot(scratchVec3c[0], scratchVec3c[2]);
            if (distXZ < fadeMaxXZDist)
                alpha = 0.0;
            if (scratchVec3c[1] < fadeMaxY)
                alpha = 0.0;
        }

        rain.alpha = alpha;
    }

    if (envLight.rainCount < pkt.rainCount)
        pkt.rainCount = envLight.rainCount;
}

function wether_move_snow(globals: dGlobals): void {
}

function wether_move_star(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    const stageName = globals.stageName;
    if (envLight.vrboxInvisible || stageName === 'D_MN09' || stageName === 'D_MN09A' || stageName === 'F_SP200')
        return;

    if (dKy_darkworld_check(globals)) {
        return;
    }

    let starAmount = 1.0;

    const curTime = envLight.curTime;
    
    if (curTime >= 330.0 && curTime < 45.0)
        starAmount = 1.0;
    else if (curTime >= 75.0 && curTime < 285.0)
        starAmount = 0.0;
    else if (curTime >= 285.0 && curTime < 330.0)
        starAmount = invlerp(285.0, 330.0, curTime);
    else
        starAmount = invlerp(285.0, 330.0, curTime)

    if (envLight.colpatWeather !== 0)
        starAmount = 0.0;
    else if (envLight.colpatCurr !== 0 && envLight.colpatBlend > 0.5)
        starAmount = 0.0;

    envLight.starAmount = cLib_addCalc(envLight.starAmount, starAmount, 0.1, 0.01, 0.000001);
    envLight.starCount = (envLight.starAmount * 500.0) | 0;

    if (envLight.starCount === 0)
        return;

    if (envLight.starPacket === null)
        envLight.starPacket = new dKankyo_star_Packet(globals);

    const pkt = envLight.starPacket;

    const star = pkt.instances[0];
    star.animCounter += 0.01 * deltaTimeInFrames;
    star.animWave = Math.sin(star.animCounter);

    // cLib_addCalc here for no reason?

    pkt.rot += deltaTimeInFrames;
}

function wether_move_housi(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    const stageName = globals.stageName;
    if (!dKy_darkworld_check(globals) || stageName !== "D_MN08") {
        envLight.housiCount = 0;
        return;
    }

    if (envLight.housiCount === 0)
        return;

    if (envLight.housiPacket === null)
        envLight.housiPacket = new dKankyo_housi_Packet(globals);

    const pkt = envLight.housiPacket;

    if (envLight.housiCount > pkt.count)
        pkt.count = envLight.housiCount;

    if (pkt.count === 0)
        return;

    for (let i = 0; i < pkt.count; i++) {
        const housi = pkt.instances[i];

        // testing...
        if (housi.initialized) {
            housi.position[0] += deltaTimeInFrames * 20.0;
            housi.position[1] += deltaTimeInFrames * 20.0;
            housi.position[2] += deltaTimeInFrames * 20.0;
        } else {
            vec3.copy(housi.basePos, scratchVec3);
            vec3.set(housi.position, cM_rndFX(800.0), cM_rndFX(600.0), cM_rndFX(800.0));
            housi.alpha = 1.0;
            housi.initialized = true;
        }

        let alpha = 1.0;

        housi.alpha = alpha;
    }

    if (envLight.housiCount < pkt.count)
        pkt.count = envLight.housiCount;

    pkt.rot += deltaTimeInFrames;
}

function wether_move_moya(globals: dGlobals): void {
}

function vrkumo_move(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    dKyw_get_wind_vecpow(scratchVec3, envLight);

    const pkt = envLight.vrkumoPacket!;

    let skyboxOffsY: number;
    skyboxOffsY = 1000.0 + pkt.strength * -500.0;
    

    {
        const fili = globals.roomStatus[globals.mStayNo].fili;
        let skyboxY = 0.0;
        if (fili !== null)
            skyboxY = fili.skyboxY;
        // TODO(jstpierre): Re-enable this?
        // skyboxOffsY -= 0.09 * (globals.cameraPosition[1] - skyboxY);
    }

    for (let i = 0; i < 100; i++) {
        const kumo = pkt.instances[i];

        let distFromCenterXZ = Math.hypot(kumo.position[0], kumo.position[2]);

        if (distFromCenterXZ > 15000.0) {
            if (distFromCenterXZ <= 15100.0) {
                kumo.position[0] *= -1;
                kumo.position[2] *= -1;
            } else {
                let rnd_0 = cM_rndF(65535.0);

                let rnd_1 = cM_rndF(18000.0);
                if (rnd_1 > 15000.0) {
                    rnd_1 = cM_rndF(1000.0) + 14000;
                }
                
                let x = Math.sin(rnd_0);
                if (Math.abs(rnd_1 * x) != 0.0) {
                    if (x <= 0.0) {
                        x -= 5000;
                    } else {
                        x += 5000;
                    }
                }

                let z = Math.cos(rnd_0);
                if (Math.abs(rnd_1 * z) != 0.0) {
                    if (z <= 0.0) {
                        z -= 5000;
                    } else {
                        z += 5000;
                    }
                }

                kumo.position[0] = x;
                kumo.position[1] = 0;
                kumo.position[2] = z;                

                distFromCenterXZ = Math.hypot(kumo.position[0], kumo.position[2]);
            }
            kumo.alpha = 0.0;
        }


        const strengthVelocity = 4.0 + pkt.strength * 4.3;
        if (kumo.alpha > 0) {
            const velocity = strengthVelocity * kumo.distFalloff * kumo.speed * deltaTimeInFrames;
            vec3.scaleAndAdd(kumo.position, kumo.position, scratchVec3, velocity);
        } else {
            const velocity = strengthVelocity + (i / 1000.0) * strengthVelocity * deltaTimeInFrames;
            vec3.scaleAndAdd(kumo.position, kumo.position, scratchVec3, velocity);
        }

        // Normalized distance from the center. 0 = at center, 1 = at edge
        const distFromCenterXZ01 = Math.min(distFromCenterXZ / 15000.0, 1.0);

        const strengthY = 3000.0 + pkt.strength * -1000.0;
        const centerAmtCubic = 1.0 - (distFromCenterXZ01 ** 3.0);
        kumo.position[1] = (500.0 * (i / 100.0)) + skyboxOffsY + (strengthY * centerAmtCubic);

        kumo.distFalloff = 1.0 - (distFromCenterXZ01 ** 6.0);

        let alphaTarget: number;
        let alphaMaxVel = 1.0;
        
        if (i < pkt.count) {
            alphaMaxVel = 0.1;
            if (kumo.distFalloff >= 0.05 && kumo.distFalloff < 0.2)
                alphaTarget = (kumo.distFalloff - 0.05) / 0.15;
            else if (kumo.distFalloff < 0.2)
                alphaTarget = 0.0;
            else
                alphaTarget = 1.0 + pkt.strength * -0.55;
        } else {
            alphaTarget = 0.0;
            alphaMaxVel = 0.005;
        }

        // When the clouds start getting too close to the center, fade them out so that you can't
        // see the sphere projection which breaks the illusion...
        const overheadFade = saturate(invlerp(0.98, 0.88, centerAmtCubic));
        alphaTarget *= overheadFade;

        kumo.alpha = cLib_addCalc(kumo.alpha, alphaTarget, 0.2 * deltaTimeInFrames, alphaMaxVel, 0.01);
    }

    pkt.bounceAnimTimer += 200.0 * deltaTimeInFrames;
}

function wether_move_vrkumo(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    if (envLight.vrkumoPacket === null) {
        envLight.vrkumoPacket = new dKankyo_vrkumo_Packet(globals);
    }

    const pkt = envLight.vrkumoPacket;

    if (!pkt.enabled)
        return;

    if (!globals.scnPlay.vrboxLoaded || envLight.vrboxInvisible) {
        pkt.count = 0;
    } else {
        pkt.count = 6;

        if (globals.stageName === 'D_MN07' || globals.stageName === 'D_MN07A' || globals.stageName === 'D_MN07B' || globals.stageName === 'F_SP114' || globals.stageName === 'D_MN09B') {
            cLib_addCalc(pkt.strength, 1.0, 0.1, 0.003, 0.0000007);
        } else if (globals.stageName === 'F_SP104') {
            if (envLight.colpatCurr < 4) {
                pkt.strength = cLib_addCalc(pkt.strength, 0.0, 0.08, 0.002, 0.00000007);
            } else {
                pkt.strength = cLib_addCalc(pkt.strength, 1.0, 0.1, 0.003, 0.0000007);
            }
        } else if (((envLight.colpatCurr === 1 || envLight.colpatCurr === 2) && envLight.colpatBlend > 0.0) || ((envLight.colpatPrev === 1 || envLight.colpatPrev === 2) && envLight.colpatBlend < 1.0)) {
            pkt.strength = cLib_addCalc(pkt.strength, 1.0, 0.1, 0.003, 0.0000007);
        } else {
            pkt.strength = cLib_addCalc(pkt.strength, 0.0, 0.08, 0.002, 0.00000007);
        }

        pkt.count = 6 + (56 * pkt.strength);
    }

    if (dKy_darkworld_check(globals))
        pkt.count = 30;

    if (globals.stageName === 'F_SP200') {
        pkt.count = 30;
    }

    vrkumo_move(globals, deltaTimeInFrames);
}

export function dKyw_wether_move_draw2(globals: dGlobals, deltaTimeInFrames: number): void {
    wether_move_vrkumo(globals, deltaTimeInFrames);
}

export function dKyw_wether_draw2(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    const envLight = globals.g_env_light;

    if (envLight.vrkumoPacket !== null && envLight.vrkumoPacket.enabled)
        envLight.vrkumoPacket.draw(globals, renderInstManager, viewerInput);
}



export function dKyw_wind_set(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    const targetWindVecX = Math.cos(envLight.windTactAngleY) * Math.cos(envLight.windTactAngleX);
    const targetWindVecY = Math.sin(envLight.windTactAngleY);
    const targetWindVecZ = Math.cos(envLight.windTactAngleY) * Math.sin(envLight.windTactAngleX);
    envLight.windVec[0] = cLib_addCalc(envLight.windVec[0], targetWindVecX, 0.1, 2.0, 0.001);
    envLight.windVec[1] = cLib_addCalc(envLight.windVec[1], targetWindVecY, 0.1, 2.0, 0.001);
    envLight.windVec[2] = cLib_addCalc(envLight.windVec[2], targetWindVecZ, 0.1, 2.0, 0.001);

    let targetWindPower = 0;
    if (envLight.customWindPower > 0.0) {
        targetWindPower = envLight.customWindPower;
    } else {
        let windPowerFlag = 0;
        const fili = globals.roomStatus[globals.mStayNo].fili;
        if (fili !== null)
            windPowerFlag = (fili.param >>> 18) & 0x03;

        if (windPowerFlag === 0)
            targetWindPower = 0.3;
        else if (windPowerFlag === 1)
            targetWindPower = 0.6;
        else if (windPowerFlag === 2)
            targetWindPower = 0.9;
    }
    envLight.windPower = cLib_addCalc(envLight.windPower, targetWindPower, 0.1, 1.0, 0.005);
}

export function dKyw_get_wind_vec(envLight: dScnKy_env_light_c): ReadonlyVec3 {
    return envLight.windVec;
}

export function dKyw_get_wind_pow(envLight: dScnKy_env_light_c): number {
    return envLight.windPower;
}

export function dKyw_get_wind_vecpow(dst: vec3, envLight: dScnKy_env_light_c): void {
    vec3.scale(dst, envLight.windVec, envLight.windPower);
}

export function dKyw_get_AllWind_vecpow(dst: vec3, envLight: dScnKy_env_light_c, pos: ReadonlyVec3): void {
    // dKyw_pntwind_get_info()
    dKyw_get_wind_vecpow(dst, envLight);
}

export class d_thunder extends kankyo_class {
    public static PROCESS_NAME = fpc__ProcessName.d_thunder;
    private model: J3DModelInstance;
    private btkAnm = new mDoExt_btkAnm();
    private btkTime = 0.0;
    private brkAnm = new mDoExt_brkAnm();
    private rotation: number = 0.0;

    public override subload(globals: dGlobals): cPhs__Status {
        const modelData = globals.resCtrl.getObjectRes(ResType.Model, `Always`, 0x3E);
        this.model = new J3DModelInstance(modelData);

        const anm = globals.resCtrl.getObjectRes(ResType.Btk, `Always`, 0x60);
        this.btkAnm.init(modelData, anm, false, LoopMode.Repeat);

        const canm = globals.resCtrl.getObjectRes(ResType.Brk, `Always`, 0x52);
        this.brkAnm.init(modelData, canm, true, LoopMode.Once);

        this.btkTime = cM_rndF(1.0);

        const nearMul = ((globals.g_env_light.thunderState < ThunderState.NearThresh) ? 1.0 : 0.5);
        this.rotation = cM_rndFX(4000) * nearMul;
        this.scale[0] = nearMul * (5.0 + cM_rndF(15.0));
        if (cM_rndFX(1.0) >= 0.5)
            this.scale[0] *= -1.0;
        this.scale[1] = nearMul * (20.0 + cM_rndF(60.0));
        this.scale[2] = 1.0;

        const fwd = globals.cameraFwd;
        const a = Math.atan2(fwd[0], fwd[2]);
        const theta = (cM_rndFX(1.0) < 0.0) ? a - Math.PI / 2 : a + Math.PI / 2;
        const phi = vecPitch(fwd);
        const sinT = Math.sin(theta), cosT = Math.cos(theta);
        const cosP = Math.cos(phi);

        const rndRot = cM_rndFX(120000.0);
        this.pos[0] = globals.cameraPosition[0] + 100000.0 * fwd[0] + ((cosP * sinT) * rndRot);
        this.pos[1] = globals.cameraPosition[1] + cM_rndFX(2000.0);
        this.pos[2] = globals.cameraPosition[2] + 100000.0 * fwd[2] + ((cosP * cosT) * rndRot);
        return cPhs__Status.Next;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        MtxTrans(this.pos, false);
        mDoMtx_ZrotM(calc_mtx, this.rotation);
        mDoMtx_XrotM(calc_mtx, this.rotation);
        mat4.copy(this.model.modelMatrix, calc_mtx);
        vec3.copy(this.model.baseScale, this.scale);

        this.btkAnm.entry(this.model, this.btkTime);
        this.brkAnm.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        const hasStopped = this.brkAnm.play(deltaTimeInFrames);
        if (hasStopped) {
            fopKyM_Delete(globals.frameworkGlobals, this);
        }
    }
}

export class mDoGph_bloom_c {
    public blendColor;
    public monoColor = colorNewCopy(TransparentBlack);
    public enable: boolean;
    public mode: number;
    public point: number;
    public blurSize: number;
    public blurRatio: number;

    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;

    constructor() {
        this.enable = false;
        this.mode = 0;
        this.point = 128;
        this.blurSize = 64;
        this.blurRatio = 128;
        this.blendColor = colorNewCopy(White);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.C2, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A2);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevSwapMode(0, TevDefaultSwapTables[1], TevDefaultSwapTables[1]);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.monoColor);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('Bloom Mono'));
    }

    public drawFilterQuad(ddraw: TDDraw, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, p0: number, p1: number): void {
        ddraw.begin(GX.Command.DRAW_QUADS);

        ddraw.position3f32(0, 0, 0);
        ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

        ddraw.position3f32(p0, 0, 0);
        ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);

        ddraw.position3f32(p0, p1, 0);
        ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);

        ddraw.position3f32(0, p1, 0);
        ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);

        ddraw.end();

        if (ddraw.hasIndicesToDraw()) {
            const renderInst = ddraw.makeRenderInst(renderInstManager);
            submitScratchRenderInst(renderInstManager, this.materialHelper, renderInst, viewerInput);
        }
    }

    public drawMono(renderInstManager: GfxRenderInstManager, ddraw: TDDraw, viewerInput: ViewerRenderInput) {
        if (this.enable || this.monoColor.a !== 0) {
            const ddraw = this.ddraw;
            this.drawFilterQuad(ddraw, renderInstManager, viewerInput, 4, 4);
            const renderInst = ddraw.makeRenderInst(renderInstManager);
            this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        renderInstManager.setCurrentRenderInstList(globals.dlst.ui[1]);
        
        const ddraw = this.ddraw;
        ddraw.beginDraw(globals.modelCache.cache);
        ddraw.allocPrimitives(GX.Command.DRAW_QUADS, 4);
        this.drawMono(renderInstManager, ddraw, viewerInput);
        ddraw.endDraw(renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.monoColor.a = 0;
        this.ddraw.destroy(device);
    }
}

interface constructor extends fpc_bs__Constructor {
    PROCESS_NAME: fpc__ProcessName;
}

export function dKyw__RegisterConstructors(globals: fGlobals): void {
    function R(constructor: constructor): void {
        fpcPf__Register(globals, constructor.PROCESS_NAME, constructor);
    }

    R(d_thunder);
}
