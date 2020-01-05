
import { dScnKy_env_light_c, dKy_efplight_set, dKy_efplight_cut, dKy_actor_addcol_amb_set, dKy_actor_addcol_dif_set, dKy_bg_addcol_amb_set, dKy_bg_addcol_dif_set, dKy_bg1_addcol_amb_set, dKy_bg1_addcol_dif_set, dKy_vrbox_addcol_sky0_set, dKy_vrbox_addcol_kasumi_set, dKy_addcol_fog_set, dKy_set_actcol_ratio, dKy_set_bgcol_ratio, dKy_set_fogcol_ratio, dKy_set_vrboxcol_ratio, dKy_get_dayofweek } from "./d_kankyo";
import { dGlobals } from "./zww_scenes";
import { cM_rndF, cLib_addCalc, cM_rndFX } from "./SComponent";
import { vec3, mat4, vec4 } from "gl-matrix";
import { colorFromRGBA, colorFromRGBA8 } from "../Color";
import { clamp, computeMatrixWithoutTranslation, MathConstants } from "../MathHelpers";
import { fGlobals, fpcPf__Register, fpc__ProcessName, fpc_bs__Constructor, kankyo_class, cPhs__Status, fopKyM_Delete, fopKyM_create } from "./framework";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { mDoExt_btkAnm, mDoExt_brkAnm, mDoExt_modelUpdateDL } from "./m_do_ext";
import { ResType } from "./d_resorce";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { MtxTrans, mDoMtx_ZrotM, mDoMtx_XrotM, calc_mtx } from "./d_a";
import { BTIData, BTI_Texture } from "../Common/JSYSTEM/JUTTexture";
import { Camera, divideByW } from "../Camera";
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import * as GX from '../gx/gx_enum';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GXMaterialHelperGfx, MaterialParams, PacketParams, ub_PacketParams, u_PacketParamsBufferSize, fillPacketParamsData, ColorKind } from "../gx/gx_render";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from "../ArrayBufferSlice";

export function dKyr__sun_arrival_check(envLight: dScnKy_env_light_c): boolean {
    return envLight.curTime > 97.5 && envLight.curTime < 292.5;
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
            ef.color.r = clamp(0xB4 * brightness, 0.0, 1.0);
            ef.color.g = clamp(0xEB * brightness, 0.0, 1.0);
            ef.color.b = clamp(0xFF * brightness, 0.0, 1.0);

            // This field is written to by dKy_Itemgetcol_chg_move, I think it's true
            // when we're in some sort of a getitem cutscene...
            const isInItemget = false;
            if (!isInItemget) {
                dKy_actor_addcol_amb_set(envLight, 0.5 * flash, 0x5A, 0xA0, 0xF5);
                dKy_actor_addcol_dif_set(envLight, 0.5 * flash, 0x5A, 0xA0, 0xF5);
                dKy_bg_addcol_amb_set(envLight, 0.7 * flash, 0x32, 0x78, 0xFF);
                dKy_bg_addcol_dif_set(envLight, 0.7 * flash, 0x32, 0x78, 0xFF);
                dKy_bg1_addcol_amb_set(envLight, 0.35 * flash, 0x5A, 0xA0, 0xF5);
                dKy_bg1_addcol_dif_set(envLight, 0.35 * flash, 0x5A, 0xA0, 0xF5);
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

function loadRawTexture(globals: dGlobals, data: ArrayBufferSlice, width: number, height: number, format: GX.TexFormat, wrapS: GX.WrapMode, wrapT: GX.WrapMode, name: string = ''): BTIData {
    const btiTexture: BTI_Texture = {
        name,
        width, height, format, wrapS, wrapT,
        minFilter: GX.TexFilter.LINEAR,
        magFilter: GX.TexFilter.LINEAR,
        data,
        lodBias: 0, minLOD: 0, maxLOD: 100, mipCount: 1,
        paletteData: null,
        paletteFormat: GX.TexPalette.IA8,
    };
    const device = globals.modelCache.device, cache = globals.modelCache.cache;
    return new BTIData(device, cache, btiTexture);
}

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

const scratchMatrix = mat4.create();
export class dKankyo_sun_packet {
    public moonTextures: BTIData[] = [];
    public sunTexture: BTIData;
    public snowTexture: BTIData;
    public sunAlpha: number = 0.0;
    public moonAlpha: number = 0.0;
    public visibility: number = 1.0;
    public sunPos = vec3.create();
    public distFalloff: number;
    private moonPos = vec3.create();
    private materialHelperSunMoon: GXMaterialHelperGfx;
    private materialHelperLenzflare: GXMaterialHelperGfx;
    private ddrawSunMoon = new TDDraw();
    private ddrawLenzflare = new TDDraw();

    constructor(globals: dGlobals) {
        const resCtrl = globals.resCtrl;

        // Moon textures
        this.moonTextures.push(resCtrl.getObjectRes(ResType.Bti, `Always`, 0x87));
        this.moonTextures.push(resCtrl.getObjectRes(ResType.Bti, `Always`, 0x88));
        this.moonTextures.push(resCtrl.getObjectRes(ResType.Bti, `Always`, 0x89));
        this.moonTextures.push(resCtrl.getObjectRes(ResType.Bti, `Always`, 0x8A));
        // Sun texture
        this.sunTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x86);

        const snowData = resCtrl.getObjectRes(ResType.Raw, `Always`, 0x81);
        this.snowTexture = loadRawTexture(globals, snowData, 0x40, 0x40, GX.TexFormat.I8, GX.WrapMode.CLAMP, GX.WrapMode.CLAMP);

        this.ddrawSunMoon.setVtxDesc(GX.Attr.POS, true);
        this.ddrawSunMoon.setVtxDesc(GX.Attr.TEX0, true);
        this.ddrawSunMoon.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddrawSunMoon.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        {
            const mb = new GXMaterialBuilder('dKankyo_sun_packet');
            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
            mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
            mb.setTevColorIn(0, GX.CombineColorInput.C1, GX.CombineColorInput.C0, GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO);
            mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.A0, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO);
            mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
            mb.setZMode(true, GX.CompareType.LEQUAL, false);
            mb.setUsePnMtxIdx(false);
            this.materialHelperSunMoon = new GXMaterialHelperGfx(mb.finish());
        }
    }

    private drawSquare(ddraw: TDDraw, mtx: mat4, basePos: vec3, size: number, scaleX: number): void {
        ddraw.begin(GX.Command.DRAW_QUADS);

        vec3.set(scratchVec3, scaleX * -size,  size, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

        vec3.set(scratchVec3, scaleX *  size,  size, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);

        vec3.set(scratchVec3, scaleX *  size, -size, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);

        vec3.set(scratchVec3, scaleX * -size, -size, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);

        ddraw.end();
    }

    public drawSunMoon(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;

        /*
        const ctx = getDebugOverlayCanvas2D();
        drawWorldSpacePoint(ctx, viewerInput.camera, this.pos, Magenta, 100);
        */

        const envLight = globals.g_env_light;

        let drawSun = this.sunAlpha > 0.0;
        let drawMoon = this.moonAlpha > 0.0;

        const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
        if (envLight.baseLight.color.r === 0.0 && roomType !== 2) {
            if (envLight.curTime > 285 || envLight.curTime < 105)
                drawMoon = false;
        }

        if (!drawSun && !drawMoon)
            return;

        const camPitch = vecPitch(globals.cameraFwd)

        this.ddrawSunMoon.beginDraw();

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
            computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);
            mat4.rotateZ(scratchMatrix, scratchMatrix, MathConstants.DEG_TO_RAD * (-50 + (360.0 * ((moonPitch - camPitch) / -8.0))));

            for (let i = 1; i >= 0; i--) {
                let moonSize = 700.0;
                if (i === 1)
                    moonSize *= 1.7;

                this.ddrawSunMoon.begin(GX.Command.DRAW_QUADS);
                this.drawSquare(this.ddrawSunMoon, scratchMatrix, moonPos, moonSize, scaleX);
                this.ddrawSunMoon.end();

                const renderInst = this.ddrawSunMoon.makeRenderInst(device, renderInstManager);

                if (i === 0) {
                    this.moonTextures[textureIdx].fillTextureMapping(materialParams.m_TextureMapping[0]);

                    colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xF3FF94FF);
                    materialParams.u_Color[ColorKind.C0].a *= this.moonAlpha;
                    colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0x000000FF);
                } else {
                    this.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);

                    colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFCF4C);
                    materialParams.u_Color[ColorKind.C0].a *= this.moonAlpha;
                    colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xC56923FF);
                    materialParams.u_Color[ColorKind.C1].a *= this.moonAlpha;
                }

                this.materialHelperSunMoon.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

                renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

                const offs = this.materialHelperSunMoon.allocateMaterialParams(renderInst);
                this.materialHelperSunMoon.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);

                renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
                mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
                fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams);
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

                this.ddrawSunMoon.begin(GX.Command.DRAW_QUADS);
                this.drawSquare(this.ddrawSunMoon, scratchMatrix, sunPos, sunSize, 1.0);
                this.ddrawSunMoon.end();

                const renderInst = this.ddrawSunMoon.makeRenderInst(device, renderInstManager);

                if (i === 0) {
                    this.sunTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
                } else {
                    this.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
                }

                colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFF1FF);
                materialParams.u_Color[ColorKind.C0].a = this.sunAlpha;
                colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xFF9100FF);

                this.materialHelperSunMoon.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

                renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

                const offs = this.materialHelperSunMoon.allocateMaterialParams(renderInst);
                this.materialHelperSunMoon.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);

                renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
                mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
                fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams);
            }
        }

        this.ddrawSunMoon.endAndUpload(device, renderInstManager);
    }

    public drawLenzflare(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    }

    public destroy(device: GfxDevice): void {
        this.snowTexture.destroy(device);
    }
}

const scratchVec3 = vec3.create();
const scratchVec4 = vec4.create();

function dKyr_get_vectle_calc(p0: vec3, p1: vec3, dst: vec3): void {
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

function shouldCull(p: vec3): boolean {
    return p[0] < -1 || p[0] > 1 || p[1] < -1 || p[1] > 1 || p[2] < -1 || p[2] > 1;
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

    let pulseDist = 0.0, staringAtSunAmount = 0.0;

    let visibilityTarget = 1.0;

    if (dKyr__sun_arrival_check(envLight)) {
        pkt.sunAlpha = cLib_addCalc(pkt.sunAlpha, 1.0, 0.5, 0.1, 0.01);
        // Do the peek-Z visibility check.

        // Original game projects the vector into viewport space, and gets distance to 320, 240.
        project(scratchVec3, pkt.sunPos, globals.camera);

        // Cull.
        if (shouldCull(scratchVec3))
            visibilityTarget = 0.0;

        scratchVec3[2] = 0.0;
        const distance = vec3.length(scratchVec3) * 320.0;

        const normalizedDist = Math.min(distance / 450.0, 1.0);
        const distFalloff = sqr(1.0 - normalizedDist);
        pkt.distFalloff = 1.0 - distFalloff;
        staringAtSunAmount = sqr(distFalloff);
    } else {
        pkt.sunAlpha = cLib_addCalc(pkt.sunAlpha, 0.0, 0.5, 0.1, 0.01);
    }

    pkt.visibility = cLib_addCalc(pkt.visibility, visibilityTarget, 0.2, 0.1, 0.001);

    if (pkt.sunPos[1] > 0.0) {
        const pulsePos = 1.0 - sqr(1.0 - clamp(pkt.sunPos[1] - globals.cameraPosition[1] / 8000.0, 0.0, 1.0));

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

function dKyr_lenzflare_move(globals: dGlobals): void {
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

function wether_move_windline(globals: dGlobals): void {
}

export function dKyw_wether_move(globals: dGlobals): void {
    wether_move_thunder(globals);
    wether_move_windline(globals);
}

function wether_move_sun(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    if (!globals.scnPlay.vrboxLoaded || envLight.vrboxInvisible)
        return;

    if (envLight.sunPacket === null)
        envLight.sunPacket = new dKankyo_sun_packet(globals);

    dKyr_sun_move(globals);
    dKyr_lenzflare_move(globals);
}

function wether_move_rain(globals: dGlobals): void {
}

function wether_move_snow(globals: dGlobals): void {
}

function wether_move_star(globals: dGlobals): void {
}

function wether_move_poison(globals: dGlobals): void {
}

function wether_move_housi(globals: dGlobals): void {
}

function wether_move_moya(globals: dGlobals): void {
}

function wether_move_wave(globals: dGlobals): void {
}

export function dKyw_wether_move_draw(globals: dGlobals): void {
    if (globals.stageName !== 'Name') {
        wether_move_sun(globals);
        wether_move_rain(globals);
        wether_move_snow(globals);
    }
    wether_move_star(globals);
    if (globals.stageName !== 'Name') {
        wether_move_poison(globals);
        wether_move_housi(globals);
        wether_move_moya(globals);
        wether_move_wave(globals);
    }
}

export function dKyw_wether_draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    // Normally this just pushes packets which draw at the right time. We can just draw now.

    const envLight = globals.g_env_light;

    if (globals.stageName !== 'Name') {
        if (envLight.sunPacket !== null) {
            envLight.sunPacket.drawSunMoon(globals, renderInstManager, viewerInput);
            envLight.sunPacket.drawLenzflare(globals, renderInstManager, viewerInput);
        }
    }
}

export function dKyw_get_wind_vec(envLight: dScnKy_env_light_c): vec3 {
    return envLight.windVec;
}

export function dKyw_get_wind_power(envLight: dScnKy_env_light_c): number {
    return envLight.windPower;
}

export class d_thunder extends kankyo_class {
    public static PROCESS_NAME = fpc__ProcessName.d_thunder;
    private model: J3DModelInstance;
    private btkAnm = new mDoExt_btkAnm();
    private btkTime = 0.0;
    private brkAnm = new mDoExt_brkAnm();
    private rotation: number = 0.0;

    public subload(globals: dGlobals): cPhs__Status {
        const modelData = globals.resCtrl.getObjectRes(ResType.Model, `Always`, 0x3E);
        this.model = new J3DModelInstance(modelData);

        const anm = globals.resCtrl.getObjectRes(ResType.Btk, `Always`, 0x60);
        this.btkAnm.init(modelData, anm, false, LoopMode.REPEAT);

        const canm = globals.resCtrl.getObjectRes(ResType.Brk, `Always`, 0x52);
        this.brkAnm.init(modelData, canm, true, LoopMode.ONCE);

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
        const theta = (cM_rndFX(1.0) < 0.0) ? a - Math.PI : a + Math.PI;
        const phi = vecPitch(fwd);
        const sinT = Math.sin(theta), cosT = Math.cos(theta);
        const cosP = Math.cos(phi);

        const rndRot = cM_rndFX(120000.0);
        this.pos[0] = globals.cameraPosition[0] + 100000.0 * fwd[0] + ((cosP * sinT) * rndRot);
        this.pos[1] = globals.cameraPosition[1] + cM_rndFX(2000.0);
        this.pos[2] = globals.cameraPosition[2] + 100000.0 * fwd[2] + ((cosP * cosT) * rndRot);
        return cPhs__Status.Next;
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        MtxTrans(this.pos, false);
        mDoMtx_ZrotM(calc_mtx, this.rotation);
        mDoMtx_XrotM(calc_mtx, this.rotation);
        mat4.copy(this.model.modelMatrix, calc_mtx);
        vec3.copy(this.model.baseScale, this.scale);

        this.btkAnm.entry(this.model, this.btkTime);
        this.brkAnm.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        const hasStopped = this.brkAnm.play(deltaTimeInFrames);
        if (hasStopped) {
            fopKyM_Delete(globals.frameworkGlobals, this);
        }
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
