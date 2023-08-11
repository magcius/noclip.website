
import { fopAc_ac_c, cPhs__Status, fGlobals, fpcPf__Register, fpc__ProcessName, fpc_bs__Constructor, fopAcM_create, fopAcIt_JudgeByID } from "./framework.js";
import { dGlobals, /* dDlst_alphaModel__Type */ } from "./ztp_scenes.js";
import { vec3, mat4, quat, ReadonlyVec3, vec2, vec4 } from "gl-matrix";
import { dComIfG_resLoad, ResType } from "./d_resorce.js";
import { J3DModelInstance, J3DModelData, buildEnvMtx } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { settingTevStruct, LightType, setLightTevColorType, LIGHT_INFLUENCE, dKy_plight_set, dKy_plight_cut, dKy_tevstr_c, dKy_tevstr_init, dKy_checkEventNightStop, dKy_change_colpat, dKy_setLight__OnModelInstance, dKy_setLight__OnMaterialParams, dKy_GxFog_set } from "./d_kankyo.js";
import { mDoExt_modelUpdateDL, mDoExt_btkAnm, mDoExt_brkAnm, mDoExt_bckAnm, mDoExt_McaMorf, mDoExt_modelEntryDL } from "./m_do_ext.js";
import { cLib_chaseF, cLib_addCalc2, cLib_addCalc, cLib_addCalcAngleRad2, cM_rndFX, cM_rndF, cLib_addCalcAngleS2, cM_atan2s, cLib_addCalcPosXZ2, cLib_addCalcAngleS, cLib_chasePosXZ, cLib_targetAngleY, cM__Short2Rad, cM__Rad2Short, cLib_distanceXZ, cLib_distanceSqXZ, cLib_targetAngleX } from "../WindWaker/SComponent.js";
import { dPath_GetRoomPath, dStage_stagInfo_GetArg0, dStage_Multi_c, dPath, dPath__Point } from "./d_stage.js";
import { nArray, assertExists, assert, hexzero0x, leftPad, readString } from "../util.js";
import { TTK1, LoopMode, TRK1, TexMtx } from "../Common/JSYSTEM/J3D/J3DLoader.js";
import { colorCopy, colorNewCopy, TransparentBlack, colorNewFromRGBA8, colorFromRGBA8, White, Green } from "../Color.js";
import { dKyw_rain_set, ThunderMode, dKyw_get_wind_vec, dKyw_get_wind_pow, dKyr_get_vectle_calc, loadRawTexture, dKyw_get_AllWind_vecpow } from "./d_kankyo_wether.js";
import { ColorKind, GXMaterialHelperGfx, MaterialParams, DrawParams } from "../gx/gx_render.js";
import { saturate, Vec3UnitY, Vec3Zero, computeModelMatrixS, computeMatrixWithoutTranslation, clamp, transformVec3Mat4w0, Vec3One, Vec3UnitZ, computeModelMatrixR, transformVec3Mat4w1, scaleMatrix, lerp } from "../MathHelpers.js";
import { dBgW, cBgW_Flags } from "../WindWaker/d_bg.js";
import { TSDraw, TDDraw } from "../SuperMarioGalaxy/DDraw.js";
import { BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder.js";
import * as GX from '../gx/gx_enum.js';
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GlobalSaveManager } from "../SaveManager.js";
import { TevDefaultSwapTables } from "../gx/gx_material.js";
import { Endianness } from "../endian.js";
import { JPABaseEmitter, JPASetRMtxSTVecFromMtx } from "../Common/JSYSTEM/JPA.js";
import { drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { EFB_HEIGHT, EFB_WIDTH } from "../gx/gx_material.js";
import { gfxDeviceNeedsFlipY } from "../gfx/helpers/GfxDeviceHelpers.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { NamedArrayBufferSlice } from "../DataFetcher.js";
import { calc_mtx, scratchMat4a, scratchVec3a, scratchVec3b, scratchVec3c, kUshortTo2PI, mDoMtx_XrotS, mDoMtx_XrotM, mDoMtx_YrotS, mDoMtx_YrotM, mDoMtx_ZrotS, mDoMtx_ZrotM, mDoMtx_ZXYrotM, mDoMtx_XYZrotM, MtxTrans, MtxPosition, quatM } from "../WindWaker/m_do_mtx.js"

// Framework'd actors

export function dComIfGp_getMapTrans(globals: dGlobals, roomNo: number): dStage_Multi_c | null {
    for (let i = 0; i < globals.dStage_dt.mult.length; i++)
        if (globals.dStage_dt.mult[i].roomNo === roomNo)
            return globals.dStage_dt.mult[i];
    return null;
}

class daBg_btkAnm_c {
    public anm = new mDoExt_btkAnm();
    private isSC_01: boolean = false;

    constructor(modelData: J3DModelData, anmData: TTK1) {
        this.anm.init(modelData, anmData, true, LoopMode.Repeat);
    }

    public entry(modelInstance: J3DModelInstance): void {
        this.anm.entry(modelInstance);
        // this.isSC_01 = modelData.bmd.mat3.materialEntries[0].name.startsWith('SC_01');
    }

    public play(deltaTimeInFrames: number): void {
        if (this.isSC_01) {
            // Sync to SE timer.
            this.anm.play(deltaTimeInFrames);
        } else {
            this.anm.play(deltaTimeInFrames);
        }
    }
}

class daBg_brkAnm_c {
    public anm = new mDoExt_brkAnm();

    constructor(modelData: J3DModelData, anmData: TRK1) {
        this.anm.init(modelData, anmData, true, LoopMode.Repeat);
    }

    public entry(modelInstance: J3DModelInstance): void {
        this.anm.entry(modelInstance);
    }

    public play(deltaTimeInFrames: number): void {
        this.anm.play(deltaTimeInFrames);
    }
}

class d_a_bg extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_bg;

    private numBg = 6;
    private bgModel: (J3DModelInstance | null)[] = nArray(this.numBg, () => null);
    private bgBtkAnm: (daBg_btkAnm_c | null)[] = nArray(this.numBg, () => null);
    private bgBrkAnm: (daBg_brkAnm_c | null)[] = nArray(this.numBg, () => null);
    private bgTevStr: (dKy_tevstr_c | null)[] = nArray(this.numBg, () => null);
    private bgW = new dBgW();

    public override subload(globals: dGlobals): cPhs__Status {
        const resCtrl = globals.resCtrl;
        const renderer = globals.renderer;

        const roomNo = this.parameters;
        const arcName = `R${leftPad(''+roomNo, 2)}_00`;

        const modelName  = ['model.bmd', 'model1.bmd', 'model2.bmd', 'model3.bmd', 'model4.bmd', 'model5.bmd'];
        const modelName2 = ['model.bdl', 'model1.bdl', 'model2.bdl', 'model3.bdl', 'model4.bdl', 'model5.bdl'];
        const btkName    = ['model.btk', 'model1.btk', 'model2.btk', 'model3.btk', 'model4.btk', 'model5.btk'];
        const brkName    = ['model.brk', 'model1.brk', 'model2.brk', 'model3.brk', 'model4.brk', 'model5.brk'];

        // createHeap
        for (let i = 0; i < this.numBg; i++) {
            let modelData = resCtrl.getStageResByName(ResType.Model, arcName, modelName[i]);
            if (modelData === null)
                modelData = resCtrl.getStageResByName(ResType.Model, arcName, modelName2[i]);
            if (modelData === null)
                continue;
            const modelInstance = new J3DModelInstance(modelData);

            for (let i = 0; i < modelData.modelMaterialData.tex1Data!.tex1.samplers.length; i++) {
                // Look for any unbound textures and set them.
                const sampler = modelData.modelMaterialData.tex1Data!.tex1.samplers[i];
                const m = modelInstance.materialInstanceState.textureMappings[i];
                if (m.gfxTexture === null) {
                    const resname = `${sampler.name.toLowerCase()}.bti`;

                    let bti = resCtrl.getStageResByName(ResType.Bti, "STG_00", resname);
                    if (bti !== null) {
                        renderer.extraTextures.addTex(bti);
                    }

                    renderer.extraTextures.fillTextureMapping(m, sampler.name);
                }
            }

            const m2 = modelInstance.getTextureMappingReference('fbtex_dummy');
            if (m2 !== null) {
                m2.lateBinding = 'opaque-scene-texture';
                m2.width = EFB_WIDTH;
                m2.height = EFB_HEIGHT;
                m2.flipY = gfxDeviceNeedsFlipY(renderer.renderCache.device);
            }

            this.bgModel[i] = modelInstance;
            
            const btk = globals.resCtrl.getStageResByName(ResType.Btk, arcName, btkName[i]);
            if (btk !== null)
                this.bgBtkAnm[i] = new daBg_btkAnm_c(modelData, btk);

            const brk = globals.resCtrl.getStageResByName(ResType.Brk, arcName, brkName[i]);
            if (brk !== null)
                this.bgBrkAnm[i] = new daBg_brkAnm_c(modelData, brk);

            const tevStr = new dKy_tevstr_c();
            this.bgTevStr[i] = tevStr;
            dKy_tevstr_init(tevStr, roomNo, -1);
        }

        // create
        for (let i = 0; i < this.numBg; i++) {
            if (this.bgBtkAnm[i] !== null)
                this.bgBtkAnm[i]!.entry(this.bgModel[i]!);
            if (this.bgBrkAnm[i] !== null)
                this.bgBrkAnm[i]!.entry(this.bgModel[i]!);
        }

        const mult = dComIfGp_getMapTrans(globals, roomNo);
        if (mult !== null) {
            MtxTrans(vec3.set(scratchVec3a, mult.transX, 0, mult.transZ), false);
            mDoMtx_YrotM(calc_mtx, mult.rotY);
            for (let i = 0; i < this.numBg; i++)
                if (this.bgModel[i] !== null)
                    mat4.copy(this.bgModel[i]!.modelMatrix, calc_mtx);
        }

        dKy_tevstr_init(globals.roomStatus[roomNo].tevStr, roomNo, -1);

        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        for (let i = 0; i < this.numBg; i++) {
            if (this.bgBtkAnm[i] !== null)
                this.bgBtkAnm[i]!.play(deltaTimeInFrames);
            if (this.bgBrkAnm[i] !== null)
                this.bgBrkAnm[i]!.play(deltaTimeInFrames);
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // TODO(jstpierre): Proper culling check
        // if (!this.cullingCheck(viewerInput.camera))
        //     return;

        // force far plane to 100000.0 ?

        for (let i = 0; i < this.numBg; i++) {
            if (this.bgModel[i] === null)
                continue;

            settingTevStruct(globals, LightType.BG0 + i, null, this.bgTevStr[i]!);
            setLightTevColorType(globals, this.bgModel[i]!, this.bgTevStr[i]!, viewerInput.camera);
            // this is actually mDoExt_modelEntryDL

            const m2 = this.bgModel[i]!.getTextureMappingReference('fbtex_dummy');
            if (m2 !== null) {
                mDoExt_modelUpdateDL(globals, this.bgModel[i]!, renderInstManager, viewerInput, globals.dlst.indirect);
            } else {
                mDoExt_modelUpdateDL(globals, this.bgModel[i]!, renderInstManager, viewerInput);
            }
        }

        const roomNo = this.parameters;
        settingTevStruct(globals, LightType.UNK_16, null, globals.roomStatus[roomNo].tevStr);
    }

    public override delete(globals: dGlobals): void {
    }
}

class d_a_vrbox extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_vrbox;
    private model: J3DModelInstance;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        const res = assertExists(globals.resCtrl.getStageResByName(ResType.Model, `STG_00`, `vrbox_sora.bmd`));
        this.model = new J3DModelInstance(res);

        globals.scnPlay.vrboxLoaded = true;
        envLight.vrboxInvisible = false;

        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
    }

    private daVrbox_color_set(globals: dGlobals): void {
        const envLight = globals.g_env_light;

        let sum = 0;
        sum += envLight.vrKasumiMaeCol.r + envLight.vrKasumiMaeCol.g + envLight.vrKasumiMaeCol.b;
        sum += envLight.vrSkyCol.r + envLight.vrSkyCol.g + envLight.vrSkyCol.b;
        sum += envLight.vrKumoCol.r + envLight.vrKumoCol.g + envLight.vrKumoCol.b;
        if (sum === 0) {
            envLight.vrboxInvisible = true;
        } else {
            envLight.vrboxInvisible = false;

            // Can't use overrides because it's per-material.
            const m0 = this.model.modelMaterialData.materialData![0].material;
            colorCopy(m0.colorRegisters[0], envLight.vrSkyCol);

            const m1 = this.model.modelMaterialData.materialData![1].material;
            colorCopy(m1.colorRegisters[0], envLight.unk_vrboxCol3);
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        this.daVrbox_color_set(globals);

        if (envLight.vrboxInvisible)
            return;

        let skyboxOffsY = 0;
        const fili = globals.roomStatus[globals.mStayNo].fili;
        if (fili !== null)
            skyboxOffsY = fili.skyboxY;

        MtxTrans(globals.cameraPosition, false);
        calc_mtx[13] -= 0.09 * (globals.cameraPosition[1] - skyboxOffsY);
        mat4.copy(this.model.modelMatrix, calc_mtx);

        dKy_GxFog_set(envLight, materialParams.u_FogBlock, viewerInput.camera);

        dKy_setLight__OnModelInstance(envLight, this.model, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput, globals.dlst.sky);
    }
}

class d_a_vrbox2 extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_vrbox2;
    private backCloud: J3DModelInstance;
    private sun: J3DModelInstance;
    private sunBtkAnm = new mDoExt_btkAnm();
    private btkTime = 0.0;
    private kasumiMae: J3DModelInstance | null = null;
    private kasumiMaeC0 = colorNewCopy(TransparentBlack);
    private kasumiMaeK0 = colorNewCopy(TransparentBlack);
    private sunColor = colorNewCopy(TransparentBlack);
    private scrollSpeed = 0.0005;

    public override subload(globals: dGlobals): cPhs__Status {
        const backCloudRes = assertExists(globals.resCtrl.getStageResByName(ResType.Model, `STG_00`, `vrbox_kumo.bmd`));
        this.backCloud = new J3DModelInstance(backCloudRes);

        const sunRes = globals.resCtrl.getStageResByName(ResType.Model, `STG_00`, `vrbox_sun.bmd`);
        if (sunRes !== null) {
            this.sun = new J3DModelInstance(sunRes);
            
            const anm = globals.resCtrl.getStageResByName(ResType.Btk, `STG_00`, `vrbox_sun.btk`);
            if (anm !== null)
                this.sunBtkAnm.init(sunRes, anm, false, LoopMode.Repeat);

            this.btkTime = 0;
        }
        

        const kasumiMaeRes = globals.resCtrl.getStageResByName(ResType.Model, `STG_00`, `vrbox_kasumim.bmd`);
        if (kasumiMaeRes !== null)
            this.kasumiMae = new J3DModelInstance(kasumiMaeRes);

        return cPhs__Status.Next;
    }

    private daVrbox2_color_set(globals: dGlobals, deltaTimeInFrames: number): void {
        const envLight = globals.g_env_light;

        if (globals.stageName === "R_SP107" || globals.stageName === "D_MN07" || globals.stageName === "D_MN07A" || globals.stageName === "D_MN07B") {
            // hack for now to avoid error
            // fix when this actor is properly implemented for tp
            return;
        }

        let sum = 0;
        sum += envLight.vrKasumiMaeCol.r + envLight.vrKasumiMaeCol.g + envLight.vrKasumiMaeCol.b;
        sum += envLight.vrSkyCol.r + envLight.vrSkyCol.g + envLight.vrSkyCol.b;
        sum += envLight.vrKumoCol.r + envLight.vrKumoCol.g + envLight.vrKumoCol.b;
        if (sum === 0)
            return;

        const windVec = dKyw_get_wind_vec(envLight);
        let windPower = dKyw_get_wind_pow(envLight);

        let windX = windVec[0];
        let windZ = windVec[2];

        // Camera forward in XZ plane
        vec3.copy(scratchVec3a, globals.cameraFwd);
        scratchVec3a[1] = 0;
        vec3.normalize(scratchVec3a, scratchVec3a);

        let windScrollSpeed = windPower * ((-windX * scratchVec3a[2]) - (-windZ * scratchVec3a[0]));
        if (globals.stageName === "R_SP30") {
            windScrollSpeed += 0.3;
        }

        const scrollSpeed0 = deltaTimeInFrames * this.scrollSpeed * windScrollSpeed;

        let mtx: mat4;
        const backMat0 = this.backCloud.materialInstances[0].materialData.material;

        // Even though the original code modifies MTX0, we don't, since the model data sets it to IDENTITY.
        // mtx = backMat0.texMatrices[0]!.matrix;
        // mtx[12] = (mtx[12] + scrollSpeed0) % 1.0;

        mtx = backMat0.texMatrices[1]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed0 * 1.75) % 1.0;

        const backMat1 = this.backCloud.materialInstances[1].materialData.material;
        mtx = backMat1.texMatrices[1]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed0 * 4.4) % 1.0;

        /* const backMat2 = this.backCloud.materialInstances[2].materialData.material;
        mtx = backMat2.texMatrices[1]!.matrix; */
        mtx[12] = (mtx[12] + scrollSpeed0 + scrollSpeed0 * 2.2) % 1.0;

        // Overwrite colors.
        let back_color = colorNewCopy(envLight.unk_vrboxCol1);
        back_color.a = envLight.vrKumoCol.a;
        this.backCloud.setColorOverride(ColorKind.K0, back_color);

        let back_color_c = colorNewCopy(envLight.unk_vrboxCol2);
        back_color_c.a = envLight.vrKumoCol.a;
        this.backCloud.setColorOverride(ColorKind.C0, back_color_c);

        if (this.kasumiMae !== null) {
            this.kasumiMae.setColorOverride(ColorKind.C0, envLight.vrKasumiMaeCol);
        }

        if (envLight.sunPacket !== null) {
            // sun stuff here
        }
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        this.daVrbox2_color_set(globals, deltaTimeInFrames);
        
        const envLight = globals.g_env_light;
        if (envLight.curTime > 255.0)
            this.sunBtkAnm.play(deltaTimeInFrames);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        dKy_GxFog_set(envLight, materialParams.u_FogBlock, viewerInput.camera);

        let sum = 0;
        sum += envLight.vrKasumiMaeCol.r + envLight.vrKasumiMaeCol.g + envLight.vrKasumiMaeCol.b;
        sum += envLight.vrSkyCol.r + envLight.vrSkyCol.g + envLight.vrSkyCol.b;
        sum += envLight.vrKumoCol.r + envLight.vrKumoCol.g + envLight.vrKumoCol.b;
        if (sum === 0)
            return;

        this.sunBtkAnm.entry(this.sun, this.btkTime);

        let skyboxOffsY = 0;
        const fili = globals.roomStatus[globals.mStayNo].fili;
        if (fili !== null)
            skyboxOffsY = fili.skyboxY;

        MtxTrans(globals.cameraPosition, false);
        calc_mtx[13] -= 0.09 * (globals.cameraPosition[1] - skyboxOffsY);

        if (this.kasumiMae !== null) {
            mat4.copy(this.kasumiMae.modelMatrix, calc_mtx);
            mDoExt_modelUpdateDL(globals, this.kasumiMae, renderInstManager, viewerInput, globals.dlst.sky);
        }

        calc_mtx[13] += 100.0;
        mat4.copy(this.backCloud.modelMatrix, calc_mtx);
        mDoExt_modelUpdateDL(globals, this.backCloud, renderInstManager, viewerInput, globals.dlst.sky);

        if (dStage_stagInfo_GetArg0(globals.dStage_dt.stag) != 0 && this.sun !== null && envLight.sunPacket !== null) {
            mDoExt_modelUpdateDL(globals, this.sun, renderInstManager, viewerInput, globals.dlst.sky);
        }
    }
}

// TODO(jstpierre): This is a hack to put it in 3D.
const materialParams = new MaterialParams();
const drawParams = new DrawParams();

// Simple quad shape & input.
export class dDlst_2DStatic_c {
    private ddraw = new TSDraw();

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);

        const size = 1;
        this.ddraw.beginDraw(cache);
        this.ddraw.begin(GX.Command.DRAW_QUADS, 4);
        this.ddraw.position3f32(-size, -size, 0);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);
        this.ddraw.position3f32(-size, size, 0);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);
        this.ddraw.position3f32(size, size, 0);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);
        this.ddraw.position3f32(size, -size, 0);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);
        this.ddraw.end();

        this.ddraw.endDraw(cache);
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        this.ddraw.setOnRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class dDlst_2DBase_c {
    public materialHelper: GXMaterialHelperGfx;
    public modelMatrix = mat4.create();

    constructor() {
        const mb = new GXMaterialBuilder('2D Object');
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }
}

class dDlst_2DObject_c extends dDlst_2DBase_c {
    public whichTex = 0;

    constructor(private tex0: BTIData, private tex1: BTIData | null = null) {
        super();
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;
        const renderInst = renderInstManager.newRenderInst();

        globals.quadStatic.setOnRenderInst(renderInst);

        const tex = this.whichTex === 0 ? this.tex0 : this.tex1!;
        tex.fillTextureMapping(materialParams.m_TextureMapping[0]);

        this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        mat4.mul(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix, this.modelMatrix);
        this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);

        renderInstManager.submitRenderInst(renderInst);
    }
}

class d_a_obj_suisya extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_obj_suisya;
    private model: J3DModelInstance;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;
        const arcName = `Obj_sui`;

        const status = dComIfG_resLoad(globals, arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        // CreateHeap
        const resCtrl = globals.resCtrl;
        const mdl_data = resCtrl.getObjectRes(ResType.Model, arcName, 3);
        this.model = new J3DModelInstance(mdl_data);

        // create
        this.cullMtx = this.model.modelMatrix;
        this.setCullSizeBox(-200, -500, -500, 200, 500, 500);

        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        super.execute(globals, deltaTimeInFrames);

        this.rot[0] += 25;
        MtxTrans(this.pos, false);
        mDoMtx_ZXYrotM(calc_mtx, this.rot);
        mat4.copy(this.model.modelMatrix, calc_mtx);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        settingTevStruct(globals, LightType.UNK_16, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput, globals.dlst.main);
    }
}

class d_a_set_bg_obj extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_set_bg_obj;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        const bg_id = this.parameters & 0xFFFF;
        const arcName = `@bg${leftPad(''+bg_id.toString(16), 4)}`;

        const status = dComIfG_resLoad(globals, arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        // CreateInit
        const l_bg_profName: number[] = [734, 734, 734, 316, 317];
        fopAcM_create(globals.frameworkGlobals, l_bg_profName[0], this.parameters, this.pos, this.roomNo, this.rot, this.scale, 0xFF, -1);

        return cPhs__Status.Next;
    }
}

class daBgObj_Spec {
    public type: number;
    public particleBlockOffs: number;
    public particleNum: number;
    public soundBlockOffs: number;
    public soundNum: number;
    public texShareBlockOffs: number;
    public shareTexNum: number;
    public farInfoBlockOffs: number;

    public shareTexNames: string[] = [];
    public modelName: string;

    public initTexShareBlock(buffer: ArrayBufferSlice, offset: number): number {
        const view = buffer.createDataView();
        this.texShareBlockOffs = offset;
        this.shareTexNum = view.getUint8(offset + 4);

        offset += 8;
        
        for (let i = 0; i < this.shareTexNum; i++) {
            const name = readString(buffer, offset);
            offset += name.length + 1;

            if (view.getUint8(offset) != 0) {
                const name = readString(buffer, offset);
                offset += name.length + 1;
            } else if (view.getUint8(offset) == 0 && view.getUint8(offset + 1) == 1) {
                offset += 2;
            }
        }

        return offset;
    }

    public initSoundBlock(buffer: ArrayBufferSlice, offset: number): number {
        const view = buffer.createDataView();
        this.soundBlockOffs = offset;
        this.soundNum = (view.getUint32(offset) >> 2) & 0x3FFFFF;

        offset += (view.getUint32(offset) & 0xFFFFFF) + 4; 
        return offset;
    }

    public initParticleBlock(buffer: ArrayBufferSlice, offset: number): number {
        const view = buffer.createDataView();
        this.particleBlockOffs = offset;
        this.particleNum = (view.getUint32(offset) >> 4) & 0xFFFFF;

        offset += (view.getUint32(offset) & 0xFFFFFF) + 4; 
        return offset;
    }

    public initFarInfoBlock(buffer: ArrayBufferSlice, offset: number): number {
        const view = buffer.createDataView();
        this.farInfoBlockOffs = offset;

        offset += 8; 
        return offset;
    }

    public parse(buffer: ArrayBufferSlice): void {
        const view = buffer.createDataView();
        this.type = view.getUint16(0x00);

        if (buffer.byteLength < 8) {
            // some specs have weird lengths like only 2 bytes ??
            // only specs of at least 8 make valid sense, so only process those
            return;
        }

        switch (this.type) {
        case 0: {
            let block_type = view.getUint8(0x4);
            let offset = 4;

            while (1) {
                switch (block_type) {
                case 0:
                    break;
                case 3:
                    offset = this.initTexShareBlock(buffer, offset);
                    break;
                case 4:
                    offset = this.initFarInfoBlock(buffer, offset);
                    break;
                }

                if (block_type === 0) {
                    break;
                }

                block_type = view.getUint8(offset);
            }
            break;
        }
        case 1: {
            let block_type = view.getUint8(0x4);
            let offset = 4;

            while (1) {
                switch (block_type) {
                case 0:
                    break;
                case 3:
                    offset = this.initTexShareBlock(buffer, offset);
                    break;
                case 1:
                    offset = this.initParticleBlock(buffer, offset);
                    break;
                case 2:
                    offset = this.initSoundBlock(buffer, offset);
                    break;
                case 4:
                    offset = this.initFarInfoBlock(buffer, offset);
                    break;
                }

                if (block_type === 0) {
                    break;
                }

                block_type = view.getUint8(offset);
            }
            break;
        }
        case 2: {
            let block_type = view.getUint8(0x4);
            let offset = 4;

            while (1) {
                switch (block_type) {
                case 0:
                    break;
                case 3:
                    offset = this.initTexShareBlock(buffer, offset);
                    break;
                case 1:
                    offset = this.initParticleBlock(buffer, offset);
                    break;
                case 2:
                    offset = this.initSoundBlock(buffer, offset);
                    break;
                case 4:
                    offset = this.initFarInfoBlock(buffer, offset);
                    break;
                }

                if (block_type === 0) {
                    break;
                }

                block_type = view.getUint8(offset);
            }
            break;
        }
        }
    }
}

class d_a_bg_obj extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_bg_obj;
    private models0: J3DModelInstance[] = [];
    private models1: J3DModelInstance[] = [];

    private btks0 = nArray(2, () => new mDoExt_btkAnm());
    private btks1 = nArray(2, () => new mDoExt_btkAnm());

    private brks0 = nArray(2, () => new mDoExt_brkAnm());
    private brks1 = nArray(2, () => new mDoExt_brkAnm());

    private specData: daBgObj_Spec;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;
        const renderer = globals.renderer;

        const bg_id = this.parameters & 0xFFFF;
        const arcName = `@bg${leftPad(''+bg_id.toString(16), 4)}`;

        const status = dComIfG_resLoad(globals, arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        const specRes = resCtrl.getResByName(ResType.Raw, arcName, `spec.dat`, resCtrl.resObj);
        const spec = new daBgObj_Spec();
        spec.parse(specRes!);

        this.specData = spec;

        switch (this.specData.type) {
        case 0: {
            for (let i = 0; i < 2; i++) {
                let bmdName = `model0.bmd`;
                if (i === 1) {
                    bmdName = `model0_${i}.bmd`;
                }

                const mdl_data = resCtrl.getResByName(ResType.Model, arcName, bmdName, resCtrl.resObj);
                if (mdl_data !== null && mdl_data !== undefined) {
                    const modelInstance = new J3DModelInstance(mdl_data);

                    for (let i = 0; i < mdl_data.modelMaterialData.tex1Data!.tex1.samplers.length; i++) {
                        // Look for any unbound textures and set them.
                        const sampler = mdl_data.modelMaterialData.tex1Data!.tex1.samplers[i];
                        const m = modelInstance.materialInstanceState.textureMappings[i];
                        if (m.gfxTexture === null) {
                            const resname = `${sampler.name.toLowerCase()}.bti`;
        
                            let bti = resCtrl.getStageResByName(ResType.Bti, "STG_00", resname);
                            if (bti !== null) {
                                renderer.extraTextures.addTex(bti);
                            }
        
                            renderer.extraTextures.fillTextureMapping(m, sampler.name);
                        }
                    }
        
                    const m2 = modelInstance.getTextureMappingReference('fbtex_dummy');
                    if (m2 !== null) {
                        m2.lateBinding = 'opaque-scene-texture';
                        m2.width = EFB_WIDTH;
                        m2.height = EFB_HEIGHT;
                        m2.flipY = gfxDeviceNeedsFlipY(renderer.renderCache.device);
                    }

                    this.models0.push(modelInstance);

                    let btkName = `model0.btk`;
                    if (i === 1) {
                        btkName = `model0_${i}.btk`;
                    }
                    const btk_data = resCtrl.getResByName(ResType.Btk, arcName, btkName, resCtrl.resObj);
                    if (btk_data !== null && mdl_data !== null) {
                        this.btks0[i].init(mdl_data!, btk_data!, true, LoopMode.Repeat);
                    }

                    let brkName = `model0.brk`;
                    if (i === 1) {
                        brkName = `model0_${i}.brk`;
                    }
                    const brk_data = resCtrl.getResByName(ResType.Brk, arcName, brkName, resCtrl.resObj);
                    if (brk_data !== null && mdl_data !== null) {
                        this.brks0[i].init(mdl_data!, brk_data!, true, LoopMode.Repeat);
                    }
                }
            }
            break;
        }
        case 1:
        case 2:
        case 3: {
            for (let i = 0; i < 2; i++) {
                for (let j = 0; j < 2; j++) {
                    let bmdName = `model${i}.bmd`;
                    if (j === 1) {
                        bmdName = `model${i}_${j}.bmd`;
                    }

                    const mdl_data = resCtrl.getResByName(ResType.Model, arcName, bmdName, resCtrl.resObj);
                    if (mdl_data !== null && mdl_data !== undefined) {
                        const modelInstance = new J3DModelInstance(mdl_data);

                        for (let i = 0; i < mdl_data.modelMaterialData.tex1Data!.tex1.samplers.length; i++) {
                            // Look for any unbound textures and set them.
                            const sampler = mdl_data.modelMaterialData.tex1Data!.tex1.samplers[i];
                            const m = modelInstance.materialInstanceState.textureMappings[i];
                            if (m.gfxTexture === null) {
                                const resname = `${sampler.name.toLowerCase()}.bti`;
            
                                let bti = resCtrl.getStageResByName(ResType.Bti, "STG_00", resname);
                                if (bti !== null) {
                                    renderer.extraTextures.addTex(bti);
                                }
            
                                renderer.extraTextures.fillTextureMapping(m, sampler.name);
                            }
                        }
            
                        const m2 = modelInstance.getTextureMappingReference('fbtex_dummy');
                        if (m2 !== null) {
                            m2.lateBinding = 'opaque-scene-texture';
                            m2.width = EFB_WIDTH;
                            m2.height = EFB_HEIGHT;
                            m2.flipY = gfxDeviceNeedsFlipY(renderer.renderCache.device);
                        }

                        if (i === 0)
                            this.models0.push(modelInstance);
                        else
                            this.models1.push(modelInstance);

                        let btkName = `model${i}.btk`;
                        if (j === 1) {
                            btkName = `model${i}_${j}.btk`;
                        }
                        const btk_data = resCtrl.getResByName(ResType.Btk, arcName, btkName, resCtrl.resObj);
                        if (btk_data !== null && mdl_data !== null) {
                            if (i === 0)
                                this.btks0[i].init(mdl_data!, btk_data!, true, LoopMode.Repeat);
                            else
                                this.btks1[i].init(mdl_data!, btk_data!, true, LoopMode.Repeat);
                        }
    
                        let brkName = `model${i}.brk`;
                        if (j === 1) {
                            brkName = `model${i}_${j}.brk`;
                        }
                        const brk_data = resCtrl.getResByName(ResType.Brk, arcName, brkName, resCtrl.resObj);
                        if (brk_data !== null && mdl_data !== null) {
                            if (i === 0)
                                this.brks0[i].init(mdl_data!, brk_data!, true, LoopMode.Repeat);
                            else
                                this.brks1[i].init(mdl_data!, brk_data!, true, LoopMode.Repeat);
                        }     
                    }          
                }
            }
            break;
        }
        }

        for (let i = 0; i < 2; i++) {
            if (this.models0[i] !== null && this.models0[i] !== undefined) {
                if (this.brks0[i] !== null && this.brks0[i] !== undefined && this.brks0[i].anm !== undefined) {
                    this.brks0[i]!.entry(this.models0[i]!);
                }
    
                if (this.btks0[i] !== null && this.btks0[i] !== undefined && this.btks0[i].anm !== undefined) {
                    this.btks0[i]!.entry(this.models0[i]!);
                }
            }
        }
        
        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        super.execute(globals, deltaTimeInFrames);

        for (let i = 0; i < 2; i++) {
            if (this.btks0[i] !== null)
                this.btks0[i]!.play(deltaTimeInFrames);
            if (this.brks0[i] !== null)
                this.brks0[i]!.play(deltaTimeInFrames);
        }

        MtxTrans(this.pos, false);
        mDoMtx_YrotM(calc_mtx, this.rot[1]);

        for (let i = 0; i < 2; i++) {
            if (this.models0[i] !== null && this.models0[i] !== undefined) {
                mat4.copy(this.models0[i].modelMatrix, calc_mtx);
            }
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        settingTevStruct(globals, LightType.BG0, this.pos, this.tevStr);

        for (let i = 0; i < 2; i++) {
            if (this.models0[i] !== null && this.models0[i] !== undefined) {
                setLightTevColorType(globals, this.models0[i]!, this.tevStr!, viewerInput.camera);

                const m2 = this.models0[i]!.getTextureMappingReference('fbtex_dummy');
                if (m2 !== null) {
                    mDoExt_modelUpdateDL(globals, this.models0[i]!, renderInstManager, viewerInput, globals.dlst.indirect);
                } else {
                    mDoExt_modelUpdateDL(globals, this.models0[i]!, renderInstManager, viewerInput);
                }
            }
        }
    }
}

class d_a_obj_glowSphere extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_obj_glowSphere;
    private model: J3DModelInstance;
    private brk = new mDoExt_brkAnm();
    private btk = new mDoExt_btkAnm();
    private type: number;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;
        const arcName = `glwSphere`;

        this.type = this.parameters >> 0x10;
        if (this.type === -1) {
            this.type = 0;
        }

        const status = dComIfG_resLoad(globals, arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        // CreateHeap
        const resCtrl = globals.resCtrl;
        const mdl_data = resCtrl.getObjectRes(ResType.Model, arcName, 5);
        this.model = new J3DModelInstance(mdl_data);

        const brk_anm = resCtrl.getObjectRes(ResType.Brk, arcName, 8);
        this.brk.init(mdl_data, brk_anm, true, LoopMode.Repeat);

        const btk_anm = resCtrl.getObjectRes(ResType.Btk, arcName, 11);
        this.btk.init(mdl_data, btk_anm, true, LoopMode.Repeat);

        // create
        this.cullMtx = this.model.modelMatrix;
        this.setCullSizeBox(-30, -10, -30, 30, 60, 30);

        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        super.execute(globals, deltaTimeInFrames);

        this.brk.play(deltaTimeInFrames);
        this.btk.play(deltaTimeInFrames);

        const colorPrm = colorNewCopy(White);

        const l_colorEnv = [0x3C1E3CFF, 0xFF0032FF];
        const colorEnv0 = colorNewFromRGBA8(l_colorEnv[0]);
        const colorEnv1 = colorNewFromRGBA8(l_colorEnv[1]);

        globals.particleCtrl.set(globals, 0, 0x874F, this.pos, null, null, 0.5, null, -1, colorPrm, colorEnv0);
        globals.particleCtrl.set(globals, 0, 0x8750, this.pos, null, null, 0.5, null, -1, colorPrm, colorEnv1);

        MtxTrans(this.pos, false);
        mat4.copy(this.model.modelMatrix, calc_mtx);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        settingTevStruct(globals, LightType.UNK_0, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);

        this.brk.entry(this.model);
        this.btk.entry(this.model);

        const l_colorKR = [0x3C, 0x50, 0x50, 0x00];
        const l_colorKG = [0x32, 0x00, 0x23, 0x14];
        const l_colorKB = [0x3C, 0x23, 0x00, 0x50];
        const l_colorK = (l_colorKR[this.type] << 24) | (l_colorKG[this.type] << 16) | (l_colorKB[this.type] << 8) | 0xFF;

        const color_k = colorNewFromRGBA8(l_colorK);    
        const mat_k = this.model.materialInstances[0].materialData.material.colorAmbRegs;
        mat_k[1].r = color_k.r;
        mat_k[1].g = color_k.g;
        mat_k[1].b = color_k.b;


        const l_colorCR = [0x96, 0xFF, 0xFF, 0x00];
        const l_colorCG = [0x96, 0x64, 0xFF, 0x96];
        const l_colorCB = [0x96, 0x64, 0x00, 0xFF];
        const l_colorC = (l_colorCR[this.type] << 24) | (l_colorCG[this.type] << 16) | (l_colorCB[this.type] << 8) | 0xFF;

        const color_c = colorNewFromRGBA8(l_colorC);
        const mat_c = this.model.materialInstances[0].materialData.material.colorConstants;
        mat_c[1].r = color_c.r;
        mat_c[1].g = color_c.g;
        mat_c[1].b = color_c.b;

        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput, globals.dlst.main);
    }
}

class kytag10_class extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.kytag10;
    
    private emitter1: JPABaseEmitter | null;
    private emitter2: JPABaseEmitter | null;
    private volSize: number;
    private lifetime: number;
    private path: dPath | null = null;
    private pathPnt: number = 0;
    private ptclScale = vec3.create();
    private rate: number;
    private unk_594: number = 0.0;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        let prm0 = this.parameters & 0xFF;
        if (prm0 === -1) {
            prm0 = 10;
        }

        let scale_factor = prm0 * 0.1;
        vec3.set(this.ptclScale, scale_factor, scale_factor, scale_factor);

        let prm1 = (this.parameters >> 8) & 0xFF;
        if (prm1 === -1) {
            prm1 = 0;
        }

        this.volSize = prm1 * 10;

        let prm2 = (this.parameters >> 0x18) & 0xFF;
        if (prm2 === -1) {
            prm2 = 15;
        }

        this.lifetime = prm2 * 10;
        this.rate = this.rot[0] & 0xFF;
        this.path = this.set_path_info(globals);
        this.pathPnt = 0;
        this.unk_594 = 0;
        this.emitter1 = globals.particleCtrl.set(globals, 0, 0x852B, this.pos);
        this.emitter2 = globals.particleCtrl.set(globals, 0, 0x852C, this.pos);

        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        super.execute(globals, deltaTimeInFrames);
        this.sparks_move(globals, deltaTimeInFrames);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    }

    public sparks_move(globals: dGlobals, deltaTimeInFrames: number): void {
        const path = this.path;
        
        if (path === null || this.emitter1 === null || this.emitter2 === null)
            return;

        let start_idx = 0;
        let end_idx = this.path!.points.length - 1;
        let spD6 = 0;
        let spD8 = 0;
        
        this.get_rail_ratio_pos(path, 0, 0.0, spD6, spD8);
        this.get_rail_ratio_pos(path, end_idx - 1, 1.0, spD6, spD8);
        const ratio1 = this.get_rail_ratio_pos(path, this.pathPnt, 0.0, spD6, spD8);
        const ratio2 = this.get_rail_ratio_pos(path, this.pathPnt, 1.0, spD6, spD8);

        const tempf = 250.0 / vec3.distance(ratio1, ratio2);

        const ratio3 = this.get_rail_ratio_pos(path, this.pathPnt, this.unk_594, spD6, spD8);

        this.emitter1?.setGlobalTranslation(ratio3);
        this.emitter2?.setGlobalTranslation(ratio3);

        this.emitter1.lifeTime = this.lifetime;
        this.emitter2.lifeTime = this.lifetime;

        this.emitter1.setVolumeSize(this.volSize);
        this.emitter2.setVolumeSize(this.volSize);

        this.emitter1.setGlobalScale(this.ptclScale);
        this.emitter2.setGlobalScale(this.ptclScale);

        if (this.rate !== -1) {
            const rate = this.rate / 100.0 * deltaTimeInFrames;
            this.emitter1.setRate(rate);
            this.emitter2.setRate(rate);
        }

        if (this.unk_594 <= 1.0 - (250.0 - tempf)) {
            this.unk_594 += tempf * deltaTimeInFrames;
            return;
        } else if (this.pathPnt >= end_idx - 1) {
            this.pathPnt = start_idx;
        } else {
            this.pathPnt++;
        }

        this.unk_594 = 0.0;
    }

    public set_path_info(globals: dGlobals): dPath | null {
        let ret = null;
        const path_id = (this.parameters >> 0x10) & 0xFF;

        if (path_id !== -1) {
            ret = dPath_GetRoomPath(globals, path_id, this.roomNo);
        }

        return ret;
    }

    public get_rail_ratio_pos(path: dPath, pointIdx: number, param2: number, o_param3: number, o_param4: number): vec3 {
        let ret = vec3.create();

        const point_a = path.points[pointIdx].pos;
        const point_b = path.points[pointIdx + 1].pos;

        vec3.set(ret, point_a[0] + param2 * (point_b[0] - point_a[0]),
                      point_a[1] + param2 * (point_b[1] - point_a[1]),
                      point_a[2] + param2 * (point_b[2] - point_a[2]));

        let calc_vec = vec3.create();
        dKyr_get_vectle_calc(point_a, point_b, calc_vec);
        
        o_param3 = cM_atan2s(Math.sqrt(calc_vec[0] * calc_vec[0] + calc_vec[2] * calc_vec[2]), calc_vec[1]);
        o_param4 = cM_atan2s(calc_vec[0], calc_vec[2]);

        return ret;
    }

    public destroy(device: GfxDevice): void {
        if (this.emitter1 !== null) {
            this.emitter1.deleteAllParticle();
            this.emitter1.becomeInvalidEmitter();
            this.emitter1 = null;
        }

        if (this.emitter2 !== null) {
            this.emitter2.deleteAllParticle();
            this.emitter2.becomeInvalidEmitter();
            this.emitter2 = null;
        }
    }
}

class d_a_obj_firepillar2 extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_obj_firepillar2;
    
    private emitter1: JPABaseEmitter | null;
    private emitter2: JPABaseEmitter | null;
    private model: J3DModelInstance | null;
    private btk: mDoExt_btkAnm | null;
    private bck: mDoExt_bckAnm | null;
    
    private flags0: number;
    private type: number;
    private actionID: number;
    private unk_948: number = 0.0;
    private timer: number;
    private particleScale = vec3.create();
    private initialized: boolean = false;
    private type1Emitters: JPABaseEmitter[] = [];
    private type0Emitters: JPABaseEmitter[] = [];

    private ptclRate: number;
    private ptclLifetime: number;
    private ptclDirSpeed: number;
    private ptclScale: number;
    private type0Timer: number;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        if (!this.initialized) {
            this.flags0 = this.rot[0];
            this.type = (this.rot[0] >> 4) & 0xF;

            this.rot = [0,0,0];
            this.initialized = true;
        }        

        const status = dComIfG_resLoad(globals, "Obj_yogan");
        if (status !== cPhs__Status.Complete)
            return status;
        
        // CreateHeap
        const resCtrl = globals.resCtrl;
        const mdl_data = resCtrl.getObjectRes(ResType.Model, "Obj_yogan", 8);
        this.model = new J3DModelInstance(mdl_data);

        const btk_anm = resCtrl.getObjectRes(ResType.Btk, "Obj_yogan", 11);
        this.btk = new mDoExt_btkAnm();
        this.btk.init(mdl_data, btk_anm, true, LoopMode.Repeat);

        const bck_anm = resCtrl.getObjectRes(ResType.Bck, "Obj_yogan", 5);
        this.bck = new mDoExt_bckAnm();
        this.bck.init(mdl_data, bck_anm, true, LoopMode.Repeat);

        // Create
        if (this.type === 1) {
            switch (this.flags0 & 0xF) {
            case 0:
                this.scale[0] = 0.8;
                this.scale[2] = 0.8;
                break;
            case 1:
                this.scale[0] = 1.0;
                this.scale[2] = 1.0;
                break;
            case 2:
                this.scale[0] = 1.5;
                this.scale[2] = 1.5;
                break;
            }

            this.scale[1] = 7.5;
            this.pos[1] -= 50.0;
        } else {
            this.scale[0] = 2.0;
            this.scale[1] = 11.0;
            this.scale[2] = 2.0;
        }

        vec3.set(this.particleScale, this.scale[0], 1.0, this.scale[2]);

        // initBaseMtx
        if (this.type === 1) {
            MtxTrans(this.pos, false);
            mDoMtx_ZXYrotM(calc_mtx, this.rot);
        } else {
            MtxTrans(this.pos, false);
            mDoMtx_ZXYrotM(calc_mtx, [0x4000, this.rot[1], this.rot[2]]);
        }
        
        this.setBaseMtx();
        this.setCullSizeBox(-150.0, -10.0, -150.0, 150.0, 1200.0, 150.0);

        if (this.type === 0) {
            this.emitter1 = globals.particleCtrl.set(globals, 0, 0x84DF, this.pos, this.rot);
            this.emitter2 = globals.particleCtrl.set(globals, 0, 0x84E0, this.pos, this.rot);
        }

        this.actionOffInit();

        return cPhs__Status.Next;
    }

    public setBaseMtx(): void {
        MtxTrans(this.pos, false);
        mDoMtx_ZXYrotM(calc_mtx, this.rot);

        if (this.model !== null && this.type === 1) {
            this.model.setBaseScale([this.scale[0], 1.0, this.scale[2]]);
            mat4.copy(this.model!.modelMatrix, calc_mtx);
        }
    }

    public actionOffInit(): void {
        let timer = (this.parameters >> 8) & 0xFF;
        if (timer === 0xFF) {
            timer = 1;
        }

        this.timer = timer * 15;

        if (this.type === 1) {
            this.bck!.frameCtrl.speedInFrames = 0;
        }

        this.actionID = 0;
    }

    public actionOff(globals: dGlobals, deltaTimeInFrames: number): void {
        cLib_chaseF(this.unk_948, 0.0, this.scale[1] * 0.1 * deltaTimeInFrames);

        if (this.timer <= 0) {
            this.actionOnWaitInit(globals, deltaTimeInFrames);
        } else if ((this.parameters & 0xFF) === 0xFF) {
            this.timer -= deltaTimeInFrames;
        } else {
            this.timer = 0;
        }
    }

    public actionOnWaitInit(globals: dGlobals, deltaTimeInFrames: number): void {
        const particleCtrl = globals.particleCtrl;

        const l_pipe_fire_id = [0x84E1, 0x84E2, 0x84E3];
        const l_yogan_foot_id = [0x816F, 0x8170, 0x8171];

        if (this.type === 0) {
            for (let i = 0; i < 3; i++) {
                this.type0Emitters[i] = particleCtrl.set(globals, 0, l_pipe_fire_id[i], this.pos, this.rot)!;
            }
        } else if (this.type === 1) {
            for (let i = 0; i < 3; i++) {
                particleCtrl.set(globals, 0, l_yogan_foot_id[i], this.pos, this.rot, this.particleScale);
            }
        }

        this.timer = 75;
        this.actionID = 1;
    }

    public actionOnWait(globals: dGlobals, deltaTimeInFrames: number): void {
        cLib_chaseF(this.unk_948, this.scale[1] * 0.1, this.scale[1] * 0.02 * deltaTimeInFrames);

        if (this.timer <= 0) {
            this.actionOnInit(globals, deltaTimeInFrames);
        } else if ((this.parameters & 0xFF) === 0xFF) {
            this.timer -= deltaTimeInFrames;
        } else {
            this.timer = 0;
        }
    }

    public actionOnInit(globals: dGlobals, deltaTimeInFrames: number): void {
        const particleCtrl = globals.particleCtrl;

        const l_yogan_headS_id = [0x816F, 0x8170, 0x8171];
        const l_yogan_headM_id = [0x816F, 0x8170, 0x8171];
        const l_yogan_headL_id = [0x816F, 0x8170, 0x8171];
        const l_yogan_head = [l_yogan_headS_id, l_yogan_headM_id, l_yogan_headL_id];

        if (this.type === 0) {
            this.timer = 75;
            this.ptclRate = 1.0;
            this.ptclLifetime = 30.0;
            this.ptclDirSpeed = 80.0;
            this.ptclScale = 1.0;
            this.type0Timer = 50;
        } else if (this.type === 1) {
            for (let i = 0; i < 3; i++) {
                this.type1Emitters[i] = particleCtrl.set(globals, 0, l_yogan_head[this.flags0 & 0xF][i], this.pos, this.rot)!;

                if (this.type1Emitters[i] !== null) {
                    this.type1Emitters[i].becomeImmortalEmitter();
                    this.type1Emitters[i].setGlobalRTMatrix(this.model!.modelMatrix);
                }
            }

            this.bck!.frameCtrl.currentTimeInFrames = 0.0;
            this.bck!.frameCtrl.speedInFrames = 1.0;
            this.timer = 125;
        }

        this.actionID = 2;
    }

    public actionOn(globals: dGlobals, deltaTimeInFrames: number): void {
        let tmp = this.scale[1];

        if (this.timer <= 0) {
            tmp = 0.0;
        } else if ((this.parameters & 0xFF) === 0xFF) {
            this.timer -= deltaTimeInFrames;
        }

        if (tmp === 0.0) {
            if (this.type === 1) {
                
                if (cLib_chaseF(this.unk_948, tmp, this.scale[1] * 0.04 * deltaTimeInFrames)) {
                    for (let i = 0; i < 3; i++) {
                        if (this.type1Emitters[i] !== undefined && this.type1Emitters[i] !== null) {
                            this.type1Emitters[i].becomeInvalidEmitter();
                            delete this.type1Emitters[i];
                        }
                    }
                    this.actionOffInit();
                }
            } else {
                cLib_chaseF(this.unk_948, tmp, this.scale[1] * 0.02 * deltaTimeInFrames);
                cLib_chaseF(this.ptclRate, 0.2, 0.016 * deltaTimeInFrames);
                cLib_chaseF(this.ptclLifetime, 15.0, 0.3 * deltaTimeInFrames);
                cLib_chaseF(this.ptclDirSpeed, 0.0, 1.6 * deltaTimeInFrames);
                cLib_chaseF(this.ptclScale, 0.8, 0.004 * deltaTimeInFrames);

                if (this.type0Timer !== 0) {
                    this.type0Timer -= deltaTimeInFrames;
                }

                if (this.type0Timer === 0) {
                    for (let i = 0; i < 3; i++) {
                        if (this.type0Emitters[i] !== undefined && this.type0Emitters[i] !== null) {
                            this.type0Emitters[i].becomeInvalidEmitter();
                            delete this.type0Emitters[i];
                        }
                    }
                    this.actionOffInit();
                }
            }
        } else {
            cLib_chaseF(this.unk_948, tmp, this.scale[1] * 0.1 * deltaTimeInFrames);
        }

        if (this.model !== null) {
            for (let i = 0; i < 3; i++) {
                if (this.type1Emitters[i] !== null && this.type1Emitters[i] !== undefined) {
                    this.type1Emitters[i].setGlobalRTMatrix(this.model.modelMatrix);
                }
            }
        }

        for (let i = 1; i < 3; i++) {
            if (this.type0Emitters[i] !== null && this.type0Emitters[i] !== undefined) {
                this.type0Emitters[i].setRate(this.ptclRate);
                this.type0Emitters[i].lifeTime = this.ptclLifetime;
                this.type0Emitters[i].directionalSpeed = this.ptclDirSpeed;
                this.type0Emitters[i].setGlobalScale([this.ptclScale, this.ptclScale, 0]);
            }
        }
    }

    public action(globals: dGlobals, deltaTimeInFrames: number): void {
        switch (this.actionID) {
        case 0:
            this.actionOff(globals, deltaTimeInFrames);
            break;
        case 1:
            this.actionOnWait(globals, deltaTimeInFrames);
            break;
        case 2:
            this.actionOn(globals, deltaTimeInFrames);
            break;
        }

        if (this.bck !== null) {
            this.bck.play(deltaTimeInFrames);
        }

        if (this.btk !== null) {
            this.btk.play(deltaTimeInFrames);
        }
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        super.execute(globals, deltaTimeInFrames);

        this.action(globals, deltaTimeInFrames);

        let vec = vec3.create();
        if (this.type === 1) {
            vec3.set(vec, 0, 1 * this.unk_948 * 100, 0);
        } else if (this.type === 0) {
            vec3.set(vec, 0, 0, 1 * this.unk_948 * 100);
        }
    
        mDoMtx_YrotS(calc_mtx, this.rot[1]);
        //MtxPosition(scratchVec3a, vec);

        this.setBaseMtx();
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.type === 1) {
            settingTevStruct(globals, LightType.UNK_0, this.pos, this.tevStr);
            setLightTevColorType(globals, this.model!, this.tevStr, viewerInput.camera);

            this.btk!.entry(this.model!);
            this.bck!.entry(this.model!);

            mDoExt_modelUpdateDL(globals, this.model!, renderInstManager, viewerInput, globals.dlst.main);
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.emitter1 !== null) {
            this.emitter1.deleteAllParticle();
            this.emitter1.becomeInvalidEmitter();
            this.emitter1 = null;
        }

        if (this.emitter2 !== null) {
            this.emitter2.deleteAllParticle();
            this.emitter2.becomeInvalidEmitter();
            this.emitter2 = null;
        }
    }
}

class d_a_obj_lv3water extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_obj_lv3water;
    private model: J3DModelInstance;
    private modelIndirect: J3DModelInstance;
    private btk = new mDoExt_btkAnm();
    private btkIndirect = new mDoExt_btkAnm();
    private type: number;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        this.type = (this.rot![0] >> 8) & 0xFF;

        const arcNames = ["Kr10water", "Kr10wat01", "Kr02wat00", "Kr03wat00", "Kr03wat01", "Kr03wat02", "Kr03wat03",
                          "Kr03wat04", "Kr07wat00", "Kr08wat00", "Kr08wat01", "Kr02wat01", "Kr02wat02", "Kr02wat03",
                          "Kr11wat00", "Kr12wat00", "Kr13wat00", "Kr13wat01", "Kr13wat02", "Kr03wat05", "Kr03wat06"];

        const btkIds = [9, 9, 9, 9, 9, 9, 9,
                        9, 9, 9, 9, 9, 9, 9,
                        9, 9, 9, 9, 9, 8, 8];

        const bmdIdrIds = [6, 6, 6, 6, 6, 6, 6,
                           6, 6, 6, 6, 6, 6, 6,
                           6, 6, 6, 6, 6, -1, -1];
        
        const btkIdrIds = [10, 10, 10, 10, 10, 10, 10,
                           10, 10, 10, 10, 10, 10, 10,
                           10, 10, 10, 10, 10, -1, -1];

        const status = dComIfG_resLoad(globals, arcNames[this.type]);
        if (status !== cPhs__Status.Complete)
            return status;

        // CreateHeap
        const resCtrl = globals.resCtrl;
        const mdl_data = resCtrl.getObjectRes(ResType.Model, arcNames[this.type], 5);
        this.model = new J3DModelInstance(mdl_data);

        const anm0 = resCtrl.getObjectRes(ResType.Btk, arcNames[this.type], btkIds[this.type]);
        this.btk.init(mdl_data, anm0, true, LoopMode.Repeat);

        if (bmdIdrIds[this.type] !== -1) {
            const mdl_data_idr = resCtrl.getObjectRes(ResType.Model, arcNames[this.type], bmdIdrIds[this.type]);
            this.modelIndirect = new J3DModelInstance(mdl_data_idr);

            const anm1 = resCtrl.getObjectRes(ResType.Btk, arcNames[this.type], btkIdrIds[this.type]);
            this.btkIndirect.init(mdl_data_idr, anm1, true, LoopMode.Repeat);
        }

        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        super.execute(globals, deltaTimeInFrames);

        this.btk.play(deltaTimeInFrames);

        if (this.btkIndirect !== undefined) {
            this.btkIndirect.play(deltaTimeInFrames);
        }

        MtxTrans(this.pos, false);
        mDoMtx_YrotM(calc_mtx, this.rot[1]);
        mat4.copy(this.model.modelMatrix, calc_mtx);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        settingTevStruct(globals, LightType.UNK_16, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        this.btk.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput, globals.dlst.main);

        if (this.modelIndirect !== null && this.modelIndirect !== undefined) {
            setLightTevColorType(globals, this.modelIndirect, this.tevStr, viewerInput.camera);
            this.btkIndirect.entry(this.modelIndirect);

            const m2 = this.modelIndirect.getTextureMappingReference('fbtex_dummy');
            if (m2 !== null) {
                m2.lateBinding = 'opaque-scene-texture';
                m2.width = EFB_WIDTH;
                m2.height = EFB_HEIGHT;
                m2.flipY = gfxDeviceNeedsFlipY(globals.renderer.renderCache.device);
            }

            mDoExt_modelUpdateDL(globals, this.modelIndirect, renderInstManager, viewerInput, globals.dlst.indirect);
        }
    }
}

type ModeFunc = (globals: dGlobals, deltaTimeInFrames: number) => void;
interface ModeFuncExec<T extends number> {
    curMode: T;
}

function modeProcExec<T extends number>(globals: dGlobals, actor: ModeFuncExec<T>, mode_tbl: ModeFunc[], deltaTimeInFrames: number): void {
    const func = mode_tbl[actor.curMode * 2 + 1];
    func.call(actor, globals, deltaTimeInFrames);
}

function modeProcInit<T extends number>(globals: dGlobals, actor: ModeFuncExec<T>, mode_tbl: ModeFunc[], mode: T): void {
    actor.curMode = mode;
    const func = mode_tbl[actor.curMode * 2 + 0];
    func.call(actor, globals, 0);
}

type dPathMoveCB = (dst: vec3, curr: dPath__Point, next: dPath__Point, speed: number) => boolean;
function dLib_pathMove(dst: vec3, pointIdxCurr: number, path: dPath, speed: number, callBack: dPathMoveCB | null = null): number {
    const pointIdxNext = (pointIdxCurr + 1) % path.points.length;
    const pointCurr = path.points[pointIdxCurr];
    const pointNext = path.points[pointIdxNext];

    if (callBack !== null) {
        if (callBack(dst, pointCurr, pointNext, speed))
            pointIdxCurr = pointIdxNext;
    } else {
        vec3.sub(scratchVec3a, pointNext.pos, pointCurr.pos);
        vec3.normalize(scratchVec3a, scratchVec3a);

        // todo
        throw "whoops";
    }

    return pointIdxCurr;
}

interface constructor extends fpc_bs__Constructor {
    PROCESS_NAME: fpc__ProcessName;
}

export function d_a__RegisterConstructors(globals: fGlobals): void {
    function R(constructor: constructor): void {
        fpcPf__Register(globals, constructor.PROCESS_NAME, constructor);
    }

    R(d_a_bg);
    R(d_a_vrbox);
    R(d_a_vrbox2);
    R(d_a_set_bg_obj);
    R(d_a_bg_obj);
    R(d_a_obj_suisya);
    R(d_a_obj_glowSphere);
    R(kytag10_class);
    R(d_a_obj_firepillar2);
    R(d_a_obj_lv3water);
}
