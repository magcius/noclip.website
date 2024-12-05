
import { ReadonlyMat4, ReadonlyVec3, mat4, quat, vec2, vec3 } from "gl-matrix";
import { TransparentBlack, colorCopy, colorFromRGBA8, colorNewCopy, colorNewFromRGBA8 } from "../Color.js";
import { J3DModelData, J3DModelInstance, buildEnvMtx } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { JointTransformInfo, LoopMode, TRK1, TTK1 } from "../Common/JSYSTEM/J3D/J3DLoader.js";
import { JPABaseEmitter, JPASetRMtxSTVecFromMtx } from "../Common/JSYSTEM/JPA.js";
import { BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { Vec3One, Vec3UnitY, Vec3UnitZ, Vec3Zero, clamp, computeMatrixWithoutTranslation, computeModelMatrixR, computeModelMatrixS, lerp, saturate, scaleMatrix, transformVec3Mat4w0, transformVec3Mat4w1 } from "../MathHelpers.js";
import { GlobalSaveManager } from "../SaveManager.js";
import { TDDraw, TSDraw } from "../SuperMarioGalaxy/DDraw.js";
import { Endianness } from "../endian.js";
import { compareDepthValues } from "../gfx/helpers/ReversedDepthHelpers.js";
import { GfxClipSpaceNearZ, GfxCompareMode, GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder.js";
import * as GX from '../gx/gx_enum.js';
import { TevDefaultSwapTables } from "../gx/gx_material.js";
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams } from "../gx/gx_render.js";
import { arrayRemove, assert, assertExists, nArray } from "../util.js";
import { ViewerRenderInput } from "../viewer.js";
import { cLib_addCalc, cLib_addCalc2, cLib_addCalcAngleRad2, cLib_addCalcAngleS, cLib_addCalcAngleS2, cLib_addCalcPosXZ2, cLib_chasePosXZ, cLib_distanceSqXZ, cLib_distanceXZ, cLib_targetAngleX, cLib_targetAngleY, cM_s2rad, cM_atan2s, cM_rndF, cM_rndFX } from "./SComponent.js";
import { dLib_getWaterY, dLib_waveInit, dLib_waveRot, dLib_wave_c, d_a_sea } from "./d_a_sea.js";
import { cBgW_Flags, dBgS_GndChk, dBgW } from "./d_bg.js";
import { PeekZResult } from "./d_dlst_peekZ.js";
import { LIGHT_INFLUENCE, LightType, WAVE_INFO, dKy_change_colpat, dKy_checkEventNightStop, dKy_plight_cut, dKy_plight_set, dKy_setLight__OnMaterialParams, dKy_setLight__OnModelInstance, dKy_tevstr_c, dKy_tevstr_init, setLightTevColorType, settingTevStruct } from "./d_kankyo.js";
import { ThunderMode, dKyr_get_vectle_calc, dKyw_get_AllWind_vecpow, dKyw_get_wind_pow, dKyw_get_wind_vec, dKyw_rain_set, loadRawTexture } from "./d_kankyo_wether.js";
import { dPa_splashEcallBack, dPa_trackEcallBack, dPa_waveEcallBack } from "./d_particle.js";
import { ResType, dComIfG_resLoad } from "./d_resorce.js";
import { dPath, dPath_GetRoomPath, dPath__Point, dStage_Multi_c, dStage_stagInfo_GetSTType } from "./d_stage.js";
import { cPhs__Status, fGlobals, fpcPf__Register, fpcSCtRq_Request, fpc_bs__Constructor } from "./framework.js";
import { mDoExt_McaMorf, mDoExt_bckAnm, mDoExt_brkAnm, mDoExt_btkAnm, mDoExt_btpAnm, mDoExt_modelEntryDL, mDoExt_modelUpdateDL, mDoLib_project } from "./m_do_ext.js";
import { MtxPosition, MtxTrans, calc_mtx, mDoMtx_XYZrotM, mDoMtx_XrotM, mDoMtx_YrotM, mDoMtx_YrotS, mDoMtx_ZXYrotM, mDoMtx_ZrotM, mDoMtx_ZrotS, quatM } from "./m_do_mtx.js";
import { dGlobals } from "./Main.js";
import { dDlst_alphaModel__Type } from "./d_drawlist.js";
import { dDemo_setDemoData, EDemoActorFlags } from "./d_demo.js";
import { fopAc_ac_c, fopAcIt_JudgeByID, fopAcM_create, fopAcM_prm_class } from "./f_op_actor.js";
import { dProcName_e } from "./d_procname.js";
import { TextureMapping } from "../TextureHolder.js";
import { calcANK1JointAnimationTransform } from "../Common/JSYSTEM/J3D/J3DGraphAnimator.js";

// Framework'd actors

const scratchMat4a = mat4.create();
const scratchMat4b = mat4.create();
const scratchMat4c = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();

class d_a_grass extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_grass;

    static kSpawnPatterns = [
        { group: 0, count: 1 },
        { group: 0, count: 7 },
        { group: 1, count: 21 },
        { group: 2, count: 3 },
        { group: 3, count: 7 },
        { group: 4, count: 17 },
        { group: 5, count: 7 },
        { group: 6, count: 5 },
    ];

    static kSpawnOffsets: vec3[][] = [
        [
            [0, 0, 0],
            [3, 0, -50],
            [-2, 0, 50],
            [50, 0, 27],
            [52, 0, -25],
            [-50, 0, 22],
            [-50, 0, -29],
        ],
        [
            [-18, 0, 76],
            [-15, 0, 26],
            [133, 0, 0],
            [80, 0, 23],
            [86, 0, -83],
            [33, 0, -56],
            [83, 0, -27],
            [-120, 0, -26],
            [-18, 0, -74],
            [-20, 0, -21],
            [-73, 0, 1],
            [-67, 0, -102],
            [-21, 0, 126],
            [-120, 0, -78],
            [-70, 0, -49],
            [32, 0, 103],
            [34, 0, 51],
            [-72, 0, 98],
            [-68, 0, 47],
            [33, 0, -5],
            [135, 0, -53],
        ],
        [
            [-75, 0, -50],
            [75, 0, -25],
            [14, 0, 106],
        ],
        [
            [-24, 0, -28],
            [27, 0, -28],
            [-21, 0, 33],
            [-18, 0, -34],
            [44, 0, -4],
            [41, 0, 10],
            [24, 0, 39],
        ],
        [
            [-55, 0, -22],
            [-28, 0, -50],
            [-77, 0, 11],
            [55, 0, -44],
            [83, 0, -71],
            [11, 0, -48],
            [97, 0, -34],
            [-74, 0, -57],
            [31, 0, 58],
            [59, 0, 30],
            [13, 0, 23],
            [-12, 0, 54],
            [55, 0, 97],
            [10, 0, 92],
            [33, 0, -10],
            [-99, 0, -27],
            [40, 0, -87],
        ],
        [
            [0, 0, 3],
            [-26, 0, -29],
            [7, 0, -25],
            [31, 0, -5],
            [-7, 0, 40],
            [-35, 0, 15],
            [23, 0, 32],
        ],
        [
            [-40, 0, 0],
            [0, 0, 0],
            [80, 0, 0],
            [-80, 0, 0],
            [40, 0, 0],
        ]
    ];

    public override subload(globals: dGlobals): cPhs__Status {
        const enum FoliageType {
            Grass,
            Tree,
            WhiteFlower,
            PinkFlower
        };

        const spawnPatternId = (this.parameters & 0x00F) >> 0;
        const type: FoliageType = (this.parameters & 0x030) >> 4;
        const itemIdx = (this.parameters >> 6) & 0x3f; // Determines which item spawns when this is cut down

        const pattern = d_a_grass.kSpawnPatterns[spawnPatternId];
        const offsets = d_a_grass.kSpawnOffsets[pattern.group];
        const count = pattern.count;

        switch (type) {
            case FoliageType.Grass:
                for (let j = 0; j < count; j++) {
                    // @NOTE: Grass does not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, this.pos);
                    globals.scnPlay.grassPacket.newData(pos, this.roomNo, itemIdx);
                }
                break;

            case FoliageType.Tree:
                const rotation = mat4.fromYRotation(scratchMat4a, this.rot[1] / 0x7FFF * Math.PI);

                for (let j = 0; j < count; j++) {
                    const offset = vec3.transformMat4(scratchVec3a, offsets[j], rotation);
                    const pos = vec3.add(scratchVec3b, offset, this.pos);
                    globals.scnPlay.treePacket.newData(pos, 0, this.roomNo);
                }
                break;

            case FoliageType.WhiteFlower:
            case FoliageType.PinkFlower:
                for (let j = 0; j < count; j++) {
                    const isPink = (type === FoliageType.PinkFlower);

                    // @NOTE: Flowers do not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, this.pos);
                    globals.scnPlay.flowerPacket.newData(globals, pos, isPink, this.roomNo, itemIdx);
                }
                break;
            default:
                console.warn('Unknown grass actor type');
        }

        return cPhs__Status.Next;
    }
}

class d_a_ep extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_ep;

    private type: number;
    private hasGa: boolean;
    private hasObm: boolean;
    private model: J3DModelInstance;
    private posTop = vec3.create();
    private light = new LIGHT_INFLUENCE();
    private state: number = 0;
    private lightPower: number = 0.0;
    private lightPowerTarget: number = 0.0;

    private timers = nArray(3, () => 0);
    private alphaModelMtx = mat4.create();
    private alphaModelRotX = 0;
    private alphaModelRotY = 0;
    private alphaModelAlpha: number = 0.0;
    private alphaModelAlphaTarget: number = 0.0;
    private alphaModelScale: number = 0.0;
    private alphaModelScaleTarget: number = 0.0;

    private static arcName = `Ep`;

    public override subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, d_a_ep.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        this.hasGa = !!((this.parameters >>> 6) & 0x01);
        this.hasObm = !!((this.parameters >>> 7) & 0x01);
        this.type = (this.parameters & 0x3F);
        if (this.type === 0x3F)
            this.type = 0;

        if (this.type === 0 || this.type === 3)
            this.model = new J3DModelInstance(globals.resCtrl.getObjectRes(ResType.Model, d_a_ep.arcName, this.hasObm ? 0x04 : 0x05));

        this.CreateInit();

        dKy_plight_set(globals.g_env_light, this.light);

        // Create particle systems.

        // TODO(jstpierre): Implement the real thing.
        const pa = globals.particleCtrl.set(globals, 0, 0x0001, null)!;
        vec3.copy(pa.globalTranslation, this.posTop);
        pa.globalTranslation[1] += -240 + 235 + 15;
        if (this.type !== 2) {
            const pb = globals.particleCtrl.set(globals, 0, 0x4004, null)!;
            vec3.copy(pb.globalTranslation, pa.globalTranslation);
            pb.globalTranslation[1] += 20;
        }
        const pc = globals.particleCtrl.set(globals, 0, 0x01EA, null)!;
        vec3.copy(pc.globalTranslation, this.posTop);
        pc.globalTranslation[1] += -240 + 235 + 8;
        // TODO(jstpierre): ga

        return cPhs__Status.Next;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.type === 0 || this.type === 3) {
            settingTevStruct(globals, LightType.BG0, this.pos, this.tevStr);
            setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
            mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);

            // TODO(jstpierre): ga
        }

        const alphaModel0 = globals.dlst.alphaModel0;
        colorFromRGBA8(alphaModel0.color, 0xEB7D0000);
        alphaModel0.set(dDlst_alphaModel__Type.Bonbori, this.alphaModelMtx, this.alphaModelAlpha);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        super.execute(globals, deltaTimeFrames);

        if (this.type === 0 || this.type === 3) {
            if (this.hasGa)
                this.ga_move();
        }

        for (let i = 0; i < 3; i++)
            this.timers[i] = Math.max(this.timers[i] - deltaTimeFrames, 0);

        if (this.timers[0] === 0) {
            this.timers[0] = cM_rndF(5.0);
            // TODO(jstpierre): The original code suggests 8.0 but 32.0 is more accurate to the game
            // Are the HIO fields non-zero here? That would be wacky.
            // this.alphaModelAlphaTarget = 8.0 + cM_rndF(4.0);
            this.alphaModelAlphaTarget = 32.0 + cM_rndF(4.0);
        }

        if (this.timers[1] === 0) {
            if (true /* field_0x7d4 == 0 */) {
                this.timers[1] = 3.0 + cM_rndF(6.0);
                this.alphaModelScaleTarget = 0.75 + cM_rndF(0.075);
            } else {
                this.timers[1] = cM_rndF(5.0);
                this.alphaModelScaleTarget = 0.55 + cM_rndF(0.2);
            }
        }

        this.alphaModelAlpha = cLib_addCalc2(this.alphaModelAlpha, this.alphaModelAlphaTarget, 1.0, 1.0);
        this.alphaModelScale = cLib_addCalc2(this.alphaModelScale, this.alphaModelScaleTarget, 0.4, 0.04);
        MtxTrans(this.posTop, false);
        mDoMtx_YrotM(calc_mtx, this.alphaModelRotY);
        mDoMtx_XrotM(calc_mtx, this.alphaModelRotX);
        const scale = this.alphaModelScale * this.lightPower;
        vec3.set(scratchVec3a, scale, scale, scale);
        mat4.scale(calc_mtx, calc_mtx, scratchVec3a);
        mat4.copy(this.alphaModelMtx, calc_mtx);
        this.alphaModelRotY += 0xD0 * deltaTimeFrames;
        this.alphaModelRotX += 0x100 * deltaTimeFrames;

        this.ep_move();
    }

    public override delete(globals: dGlobals): void {
        dKy_plight_cut(globals.g_env_light, this.light);
    }

    private CreateInit(): void {
        this.daEp_set_mtx();
    }

    private daEp_set_mtx(): void {
        if (this.type === 0 || this.type === 3) {
            MtxTrans(this.pos, false);
            mDoMtx_YrotM(calc_mtx, this.rot[1]);
            mDoMtx_XrotM(calc_mtx, this.rot[0]);
            mDoMtx_ZrotM(calc_mtx, this.rot[2]);
            mat4.copy(this.model.modelMatrix, calc_mtx);
            vec3.set(this.posTop, 0, 140, 0);
            MtxPosition(this.posTop);
        } else {
            vec3.copy(this.posTop, this.pos);
        }
    }

    private ga_move(): void {
        // TODO(jstpierre): ga
    }

    private ep_move(): void {
        // tons of fun timers and such
        if (this.state === 0) {
            // check switches
            this.state = 3;
            this.lightPowerTarget = this.scale[0];
        } else if (this.state === 3 || this.state === 4) {
            this.lightPower = cLib_addCalc2(this.lightPower, this.lightPowerTarget, 0.5, 0.2);
            if (this.type !== 2) {
                // check a bunch of stuff, collision, etc.
                // setSimple 0x4004
            }
        }

        vec3.copy(this.light.pos, this.posTop);
        this.light.color.r = 600 / 0xFF;
        this.light.color.g = 400 / 0xFF;
        this.light.color.b = 120 / 0xFF;
        this.light.power = this.lightPower * 150.0;
        this.light.fluctuation = 250.0;

        // other emitter stuff
    }
}

function dComIfGp_getMapTrans(globals: dGlobals, roomNo: number): dStage_Multi_c | null {
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

    public play(deltaTimeFrames: number): void {
        if (this.isSC_01) {
            // Sync to SE timer.
            this.anm.play(deltaTimeFrames);
        } else {
            this.anm.play(deltaTimeFrames);
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

    public play(deltaTimeFrames: number): void {
        this.anm.play(deltaTimeFrames);
    }
}

class d_a_bg extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_bg;

    private numBg = 4;
    private bgModel: (J3DModelInstance | null)[] = nArray(this.numBg, () => null);
    private bgBtkAnm: (daBg_btkAnm_c | null)[] = nArray(this.numBg, () => null);
    private bgBrkAnm: (daBg_brkAnm_c | null)[] = nArray(this.numBg, () => null);
    private bgTevStr: (dKy_tevstr_c | null)[] = nArray(this.numBg, () => null);
    private bgW = new dBgW();

    public override subload(globals: dGlobals): cPhs__Status {
        const resCtrl = globals.resCtrl;

        const roomNo = this.parameters;
        const arcName = `Room` + roomNo;

        const modelName = ['model.bmd', 'model1.bmd', 'model2.bmd', 'model3.bmd'];
        const modelName2 = ['model.bdl', 'model1.bdl', 'model2.bdl', 'model3.bdl'];
        const btkName = ['model.btk', 'model1.btk', 'model2.btk', 'model3.btk'];
        const brkName = ['model.brk', 'model1.brk', 'model2.brk', 'model3.brk'];

        // createHeap
        for (let i = 0; i < this.numBg; i++) {
            let modelData = resCtrl.getStageResByName(ResType.Model, arcName, modelName[i]);
            if (modelData === null)
                modelData = resCtrl.getStageResByName(ResType.Model, arcName, modelName2[i]);
            if (modelData === null)
                continue;
            this.bgModel[i] = new J3DModelInstance(modelData);

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

        const bgDt = assertExists(resCtrl.getStageResByName(ResType.Dzb, arcName, 'room.dzb'));

        this.bgW.Set(bgDt, cBgW_Flags.Global, null);
        globals.scnPlay.bgS.Regist(this.bgW, this);

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

        dKy_tevstr_init(globals.roomCtrl.status[roomNo].tevStr, roomNo, -1);

        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        for (let i = 0; i < this.numBg; i++) {
            if (this.bgBtkAnm[i] !== null)
                this.bgBtkAnm[i]!.play(deltaTimeFrames);
            if (this.bgBrkAnm[i] !== null)
                this.bgBrkAnm[i]!.play(deltaTimeFrames);
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
            mDoExt_modelUpdateDL(globals, this.bgModel[i]!, renderInstManager, viewerInput);
        }

        const roomNo = this.parameters;
        settingTevStruct(globals, LightType.BG0, null, globals.roomCtrl.status[roomNo].tevStr);
    }

    public override delete(globals: dGlobals): void {
        globals.scnPlay.bgS.Release(this.bgW);
    }
}

class d_a_vrbox extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_vrbox;
    private model: J3DModelInstance;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        const res = assertExists(globals.resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_sky.bdl`));
        this.model = new J3DModelInstance(res);

        // vrboxFlags?
        globals.scnPlay.vrboxLoaded = true;
        envLight.vrboxInvisible = false;

        return cPhs__Status.Next;
    }

    private dungeon_rain_proc(globals: dGlobals): void {
        const envLight = globals.g_env_light;

        if (dKy_checkEventNightStop(globals)) {
            const stage = globals.stageName;

            let rainMode: number = -1;
            const roomNo = globals.mStayNo;
            if (stage === 'M_NewD2' && roomNo === 3)
                rainMode = 1;
            else if (stage === 'M_Dra09')
                rainMode = 1;
            else if (stage === 'kinMB')
                rainMode = 1;
            else if (stage === 'kindan') {
                if (roomNo === 2 || roomNo === 13)
                    rainMode = 1;
                else if (roomNo === 4)
                    rainMode = 2;
                else
                    rainMode = 0;
            }

            if (rainMode === 0) {
                if (envLight.thunderMode !== ThunderMode.Off) {
                    dKyw_rain_set(envLight, 0);
                    envLight.thunderMode = ThunderMode.Off;
                }
            } else if (rainMode === 1) {
                if (envLight.rainCountOrig !== 250) {
                    dKy_change_colpat(envLight, 1);
                    dKyw_rain_set(envLight, 250);
                    envLight.thunderMode = ThunderMode.On;
                }
            } else if (rainMode === 2) {
                if (envLight.thunderMode === ThunderMode.Off) {
                    dKy_change_colpat(envLight, 1);
                    envLight.thunderMode = ThunderMode.FarOnly;
                }
            }
        }
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.dungeon_rain_proc(globals);
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
            colorCopy(m0.colorConstants[0], envLight.vrKasumiMaeCol);
            const m1 = this.model.modelMaterialData.materialData![1].material;
            colorCopy(m1.colorConstants[0], envLight.vrSkyCol);
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        this.daVrbox_color_set(globals);

        if (envLight.vrboxInvisible)
            return;

        let skyboxOffsY = 0;
        const fili = globals.roomCtrl.status[globals.mStayNo].data.fili;
        if (fili !== null)
            skyboxOffsY = fili.skyboxY;

        MtxTrans(globals.cameraPosition, false);
        calc_mtx[13] -= 0.09 * (globals.cameraPosition[1] - skyboxOffsY);
        mat4.copy(this.model.modelMatrix, calc_mtx);

        dKy_setLight__OnModelInstance(envLight, this.model, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput, globals.dlst.sky);
    }
}

class d_a_vrbox2 extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_vrbox2;
    private backCloud: J3DModelInstance;
    private kasumiMae: J3DModelInstance | null = null;
    private kasumiMaeC0 = colorNewCopy(TransparentBlack);
    private kasumiMaeK0 = colorNewCopy(TransparentBlack);
    private usoUmi: J3DModelInstance | null = null;
    private scrollSpeed = 0.0005;

    public override subload(globals: dGlobals): cPhs__Status {
        const backCloudRes = assertExists(globals.resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_back_cloud.bdl`));
        this.backCloud = new J3DModelInstance(backCloudRes);

        const kasumiMaeRes = globals.resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_kasumi_mae.bdl`);
        if (kasumiMaeRes !== null)
            this.kasumiMae = new J3DModelInstance(kasumiMaeRes);

        const usoUmiRes = globals.resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_uso_umi.bdl`);
        if (usoUmiRes !== null)
            this.usoUmi = new J3DModelInstance(usoUmiRes);

        return cPhs__Status.Next;
    }

    private daVrbox2_color_set(globals: dGlobals, deltaTimeFrames: number): void {
        const envLight = globals.g_env_light;

        let sum = 0;
        sum += envLight.vrKasumiMaeCol.r + envLight.vrKasumiMaeCol.g + envLight.vrKasumiMaeCol.b;
        sum += envLight.vrSkyCol.r + envLight.vrSkyCol.g + envLight.vrSkyCol.b;
        sum += envLight.vrKumoCol.r + envLight.vrKumoCol.g + envLight.vrKumoCol.b;
        if (sum === 0)
            return;

        const windVec = dKyw_get_wind_vec(envLight);
        const windPower = dKyw_get_wind_pow(envLight);

        let windX = windVec[0];
        let windZ = windVec[2];

        const roomType = dStage_stagInfo_GetSTType(globals.dStage_dt.stag);
        if (roomType === 2) {
            // TODO(jstpierre): #TACT_WIND. Overwrite with tact wind. LinkRM / Orichh / Ojhous2 / Omasao / Onobuta
        }

        // Camera forward in XZ plane
        vec3.copy(scratchVec3a, globals.cameraFwd);
        scratchVec3a[1] = 0;
        vec3.normalize(scratchVec3a, scratchVec3a);

        const windScrollSpeed = windPower * ((-windX * scratchVec3a[2]) - (-windZ * scratchVec3a[0]));
        const scrollSpeed0 = deltaTimeFrames * this.scrollSpeed * windScrollSpeed;

        let mtx: mat4;
        const backMat0 = this.backCloud.materialInstances[0].materialData.material;

        // Even though the original code modifies MTX0, we don't, since the model data sets it to IDENTITY.
        // mtx = backMat0.texMatrices[0]!.matrix;
        // mtx[12] = (mtx[12] + scrollSpeed0) % 1.0;

        mtx = backMat0.texMatrices[1]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed0) % 1.0;

        const scrollSpeed1 = scrollSpeed0 * 0.8;

        const backMat1 = this.backCloud.materialInstances[1].materialData.material;
        mtx = backMat1.texMatrices[1]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed1) % 1.0;

        const scrollSpeed2 = scrollSpeed0 * 0.6;

        const backMat2 = this.backCloud.materialInstances[2].materialData.material;
        mtx = backMat2.texMatrices[1]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed0 + scrollSpeed2) % 1.0;

        // Overwrite colors.
        this.backCloud.setColorOverride(ColorKind.K0, envLight.vrKumoCol);

        if (this.kasumiMae !== null) {
            colorCopy(this.kasumiMaeC0, envLight.vrKasumiMaeCol, 0.0);
            this.kasumiMaeK0.r = envLight.vrKumoCol.a;
            this.kasumiMae.setColorOverride(ColorKind.C0, this.kasumiMaeC0);
            this.kasumiMae.setColorOverride(ColorKind.K0, this.kasumiMaeK0);
        }

        if (this.usoUmi !== null)
            this.usoUmi.setColorOverride(ColorKind.K0, envLight.vrUsoUmiCol);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.daVrbox2_color_set(globals, deltaTimeFrames);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        let sum = 0;
        sum += envLight.vrKasumiMaeCol.r + envLight.vrKasumiMaeCol.g + envLight.vrKasumiMaeCol.b;
        sum += envLight.vrSkyCol.r + envLight.vrSkyCol.g + envLight.vrSkyCol.b;
        sum += envLight.vrKumoCol.r + envLight.vrKumoCol.g + envLight.vrKumoCol.b;
        if (sum === 0)
            return;

        let skyboxOffsY = 0;
        const fili = globals.roomCtrl.status[globals.mStayNo].data.fili;
        if (fili !== null)
            skyboxOffsY = fili.skyboxY;

        MtxTrans(globals.cameraPosition, false);
        calc_mtx[13] -= 0.09 * (globals.cameraPosition[1] - skyboxOffsY);

        if (this.usoUmi !== null) {
            mat4.copy(this.usoUmi.modelMatrix, calc_mtx);
            mDoExt_modelUpdateDL(globals, this.usoUmi, renderInstManager, viewerInput, globals.dlst.sky);
        }

        if (this.kasumiMae !== null) {
            mat4.copy(this.kasumiMae.modelMatrix, calc_mtx);
            mDoExt_modelUpdateDL(globals, this.kasumiMae, renderInstManager, viewerInput, globals.dlst.sky);
        }

        calc_mtx[13] += 100.0;
        mat4.copy(this.backCloud.modelMatrix, calc_mtx);
        mDoExt_modelUpdateDL(globals, this.backCloud, renderInstManager, viewerInput, globals.dlst.sky);
    }
}

const enum Kytag00EffectMode {
    None = 0x00,
    Rain = 0x01,
    Snow = 0x02,
    Moya0 = 0x03,
    Moya1 = 0x04,
    Moya2 = 0x05,
    Housi = 0x06,
    Thunder = 0x07,
    ThunderRain = 0x08,
    ThunderRainMoya = 0x09,
    Moya3 = 0x0A,
    Moya4 = 0x0B,
};

class d_a_kytag00 extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_kytag00;

    private colpat = 0;
    private effectMode = Kytag00EffectMode.None;
    private invert = false;
    private alwaysCheckPlayerPos = false;
    private target = 0.0;
    private effectSet = false;
    private colpatSet = false;

    // Cylinder
    private innerFadeY = 0.0;
    private innerRadius = 0.0;
    private outerRadius = 0.0;

    public override subload(globals: dGlobals): cPhs__Status {
        this.colpat = this.parameters & 0xFF;
        this.effectMode = (this.parameters >>> 8) & 0xFF;
        this.invert = !!((this.rot[0] >>> 8) & 0xFF);
        this.alwaysCheckPlayerPos = !!(this.rot[2] & 0xFF);

        if (this.invert) {
            this.target = 1.0;
        } else {
            this.target = 0.0;
        }

        this.innerFadeY = ((this.parameters >> 24) & 0xFF) * 100.0;

        const innerFadeRadius = (this.parameters >>> 16) & 0xFF;
        if (this.alwaysCheckPlayerPos) {
            this.innerRadius = this.scale[0] * 500.0;
            this.outerRadius = this.innerRadius + innerFadeRadius * 10.0;
        } else {
            this.innerRadius = this.scale[0] * 5000.0;
            this.outerRadius = this.innerRadius + innerFadeRadius * 100.0;
        }

        this.wether_tag_efect_move(globals);

        return cPhs__Status.Next;
    }

    private get_check_pos(globals: dGlobals): vec3 {
        // Return the closer of the two.
        if (this.alwaysCheckPlayerPos || vec3.distance(this.pos, globals.playerPosition) < vec3.distance(this.pos, globals.cameraPosition))
            return globals.playerPosition;
        else
            return globals.cameraPosition;
    }

    private wether_tag_efect_move(globals: dGlobals): void {
        // Moved inside wether_tag_move.
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        if (this.invert) {
            this.target = cLib_addCalc(this.target, 0.0, 0.1, 0.01, 0.0001);
        } else {
            this.target = cLib_addCalc(this.target, 1.0, 0.1, 0.01, 0.0001);
        }

        this.wether_tag_move(globals);
    }

    private raincnt_set(globals: dGlobals, target: number): void {
        const envLight = globals.g_env_light;

        let newRainCount = (saturate(target * target * target) * 250.0) | 0;

        if (dKy_checkEventNightStop(globals)) {
            if (newRainCount < envLight.rainCount)
                newRainCount = envLight.rainCount;
        }

        if (newRainCount > envLight.rainCountOrig)
            envLight.rainCount = newRainCount;
    }

    private raincnt_cut(globals: dGlobals): void {
        const envLight = globals.g_env_light;

        if (!dKy_checkEventNightStop(globals))
            envLight.rainCount = envLight.rainCountOrig;
    }

    private wether_tag_move(globals: dGlobals): void {
        const envLight = globals.g_env_light;

        const checkPos = this.get_check_pos(globals);

        const distXZ = Math.hypot(checkPos[0] - this.pos[0], checkPos[2] - this.pos[2]);

        const innerBottomY = this.pos[1], outerBottomY = innerBottomY - this.innerFadeY;
        const innerTopY = this.pos[1] + (this.scale[1] * 5000.0), outerTopY = innerTopY + this.innerFadeY;

        if (distXZ < this.outerRadius && checkPos[1] > outerBottomY && checkPos[1] <= outerTopY) {
            const fadeRadius = this.outerRadius - this.innerRadius;
            const blendXZ = Math.min((this.outerRadius - distXZ) / fadeRadius, 1.0);

            let blendY = 1.0;
            if (this.innerFadeY !== 0) {
                if (checkPos[1] > innerBottomY)
                    blendY = 1.0 - saturate((checkPos[1] - outerTopY) / this.innerFadeY);
                else
                    blendY = 1.0 - saturate((innerBottomY - checkPos[1]) / this.innerFadeY);
            }

            const target = this.target * blendXZ * blendY;

            if (envLight.envrIdxPrev === envLight.envrIdxCurr && this.colpat < 4) {
                this.colpatSet = true;

                if (target > 0.5) {
                    envLight.colpatBlendGather = target;
                    envLight.colpatPrevGather = envLight.colpatWeather;
                    envLight.colpatCurrGather = this.colpat;
                    envLight.colpatModeGather = 1;
                } else {
                    envLight.colpatBlendGather = 1.0 - target;
                    envLight.colpatPrevGather = this.colpat;
                    envLight.colpatCurrGather = envLight.colpatWeather;
                    envLight.colpatModeGather = 1;
                }
            }

            // wether_tag_efect_move
            this.effectSet = true;

            if (this.effectMode === Kytag00EffectMode.Rain) {
                this.raincnt_set(globals, target);
            } else if (this.effectMode === Kytag00EffectMode.Snow) {
                envLight.snowCount = (target * 250.0) | 0;
                envLight.moyaMode = 2;
                envLight.moyaCount = (target * 100.0) | 0;
            } else if (this.effectMode === Kytag00EffectMode.Moya0) {
                envLight.moyaMode = 0;
                envLight.moyaCount = (target * 100.0) | 0;
            } else if (this.effectMode === Kytag00EffectMode.Moya1) {
                envLight.moyaMode = 1;
                envLight.moyaCount = (target * 100.0) | 0;
            } else if (this.effectMode === Kytag00EffectMode.Moya2) {
                envLight.moyaMode = 2;
                envLight.moyaCount = (target * 100.0) | 0;
            } else if (this.effectMode === Kytag00EffectMode.Housi) {
                envLight.housiCount = (target * 300.0) | 0;
            } else if (this.effectMode === Kytag00EffectMode.Thunder) {
                if (envLight.thunderMode === ThunderMode.Off)
                    envLight.thunderMode = ThunderMode.Kytag;
            } else if (this.effectMode === Kytag00EffectMode.ThunderRain) {
                if (envLight.thunderMode === ThunderMode.Off)
                    envLight.thunderMode = ThunderMode.Kytag;
                this.raincnt_set(globals, target);
            } else if (this.effectMode === Kytag00EffectMode.ThunderRainMoya) {
                envLight.moyaMode = 0;
                envLight.moyaCount = (target * 100.0) | 0;
                if (envLight.thunderMode === ThunderMode.Off)
                    envLight.thunderMode = ThunderMode.Kytag;
                this.raincnt_set(globals, target);
            } else if (this.effectMode === Kytag00EffectMode.Moya3) {
                envLight.moyaMode = 3;
                envLight.moyaCount = (target * 100.0) | 0;
            } else if (this.effectMode === Kytag00EffectMode.Moya4) {
                envLight.moyaMode = 4;
                envLight.moyaCount = (target * 100.0) | 0;
            }
        } else {
            if (this.colpatSet) {
                this.colpatSet = false;
                envLight.colpatPrevGather = envLight.colpatWeather;
                envLight.colpatCurrGather = envLight.colpatWeather;
                envLight.colpatBlendGather = 0.0;
                envLight.colpatModeGather = 1;
            }

            if (this.effectSet) {
                this.effectSet = false;

                if (this.effectMode === Kytag00EffectMode.Rain) {
                    this.raincnt_cut(globals);
                } else if (this.effectMode === Kytag00EffectMode.Snow) {
                    envLight.snowCount = 0;
                    envLight.moyaCount = 0;
                } else if (this.effectMode === Kytag00EffectMode.Housi) {
                    envLight.housiCount = 0;
                } else if (this.effectMode === Kytag00EffectMode.Thunder) {
                    if (envLight.thunderMode === ThunderMode.Kytag)
                        envLight.thunderMode = ThunderMode.Off;
                } else if (this.effectMode === Kytag00EffectMode.ThunderRain) {
                    if (envLight.thunderMode === ThunderMode.Kytag)
                        envLight.thunderMode = ThunderMode.Off;
                    this.raincnt_cut(globals);
                } else if (this.effectMode === Kytag00EffectMode.ThunderRainMoya) {
                    envLight.moyaCount = 0;
                    if (envLight.thunderMode === ThunderMode.Kytag)
                        envLight.thunderMode = ThunderMode.Off;
                    this.raincnt_cut(globals);
                } else if (this.effectMode === Kytag00EffectMode.Moya0 || this.effectMode === Kytag00EffectMode.Moya1 || this.effectMode === Kytag00EffectMode.Moya2 || this.effectMode === Kytag00EffectMode.Moya3 || this.effectMode === Kytag00EffectMode.Moya4) {
                    envLight.moyaCount = 0;
                }
            }
        }
    }
}

class d_a_kytag01 extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_kytag01;

    private info = new WAVE_INFO();

    public override subload(globals: dGlobals): cPhs__Status {
        vec3.copy(this.info.pos, this.pos);

        this.info.innerRadius = this.scale[0] * 5000.0;
        this.info.outerRadius = Math.max(this.scale[2] * 5000.0, this.info.innerRadius + 500.0);
        globals.g_env_light.waveInfo.push(this.info);

        // TODO(jstpierre): Need a Create/Destroy hook that happens on room load / unload for this to work on sea stage.
        if (globals.stageName !== 'sea')
            this.wave_make(globals);

        return cPhs__Status.Next;
    }

    private wave_make(globals: dGlobals): void {
        const envLight = globals.g_env_light;

        if (envLight.waveCount === 0) {
            envLight.waveSpawnDist = 20000.0;
            envLight.waveSpawnRadius = 22000.0;
            envLight.waveReset = false;
            envLight.waveScale = 300.0;
            envLight.waveScaleRand = 0.001;
            envLight.waveScaleBottom = 6.0;
            envLight.waveCount = 300;
            envLight.waveSpeed = 30;
            envLight.waveFlatInter = 0;

            if (globals.stageName === 'MajyuE') {
                envLight.waveSpawnDist = 25000.0;
                envLight.waveSpawnRadius = 27000.0;
                envLight.waveScaleBottom = 8.0;
            } else if (globals.stageName === 'M_NewD2') {
                envLight.waveSpawnDist = 35000.0;
                envLight.waveSpawnRadius = 37000.0;
                envLight.waveScaleBottom = 8.0;
                envLight.waveCounterSpeedScale = 1.5;
                envLight.waveScale = 500.0;
                envLight.waveSpeed = 55.0;
            }
        }
    }

    public override delete(globals: dGlobals): void {
        arrayRemove(globals.g_env_light.waveInfo, this.info);
    }
}

class d_a_obj_Ygush00 extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_obj_Ygush00;

    private type: number;
    private model: J3DModelInstance;
    private btkAnm = new mDoExt_btkAnm();
    private bckAnm = new mDoExt_bckAnm();

    private static arcName = `Ygush00`;

    public override subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, d_a_obj_Ygush00.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        this.type = this.parameters & 0x03;
        const mdl_table = [0x0A, 0x09, 0x09, 0x09];
        const btk_table = [0x0E, 0x0D, 0x0D, 0x0D];
        const bck_table = [0x06, 0x05, 0x05, 0x05];

        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_obj_Ygush00.arcName, mdl_table[this.type]));
        this.btkAnm.init(this.model.modelData, resCtrl.getObjectRes(ResType.Btk, d_a_obj_Ygush00.arcName, btk_table[this.type]), true, LoopMode.Repeat);
        this.bckAnm.init(this.model.modelData, resCtrl.getObjectRes(ResType.Bck, d_a_obj_Ygush00.arcName, bck_table[this.type]), true, LoopMode.Repeat);

        this.cullMtx = this.model.modelMatrix;
        vec3.copy(this.model.baseScale, this.scale);
        mat4.translate(this.model.modelMatrix, this.model.modelMatrix, this.pos);

        const scaleX = this.scale[0], scaleY = this.scale[1], scaleZ = this.scale[2];
        this.setCullSizeBox(scaleX * -80.0, scaleY * 0.0, scaleZ * -80.0, scaleX * 80.0, scaleY * 125.0, scaleZ * 80.0);

        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        if (this.type !== 3) {
            this.btkAnm.play(deltaTimeFrames);
            this.bckAnm.play(deltaTimeFrames);
        }

        if (this.type === 1) {
            // Judge for Gryw00 nearby
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.BG1, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);

        this.btkAnm.entry(this.model);
        this.bckAnm.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }
}

class d_a_obj_lpalm extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_obj_lpalm;

    private model: J3DModelInstance;

    private baseQuat = quat.create();
    private baseQuatTarget = quat.create();
    private animDir = nArray(2, () => 0);
    private animWave = nArray(2, () => 0);
    private animMtxQuat = nArray(2, () => quat.create());

    private static arcName = `Oyashi`;

    public override subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, d_a_obj_lpalm.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_obj_lpalm.arcName, 0x04));
        this.model.jointMatrixCalcCallback = this.nodeCallBack;

        this.cullMtx = this.model.modelMatrix;
        this.cullFarDistanceRatio = 2.37;
        this.setCullSizeBox(-350.0, -50.0, -350.0, 350.0, 1300.0, 350.0);

        mat4.translate(this.model.modelMatrix, this.model.modelMatrix, this.pos);
        mDoMtx_ZXYrotM(this.model.modelMatrix, this.rot);

        return cPhs__Status.Next;
    }

    private nodeCallBack = (dst: mat4, modelData: J3DModelData, i: number): void => {
        if (i === 2 || i === 3) {
            mDoMtx_ZrotM(dst, -0x4000);
            quatM(this.baseQuat, dst);
            if (i === 2)
                quatM(this.animMtxQuat[0], dst);
            else
                quatM(this.animMtxQuat[1], dst);
            mDoMtx_ZrotM(dst, 0x4000);
        }
    };

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        const envLight = globals.g_env_light;

        const windVec = dKyw_get_wind_vec(envLight);
        const windPow = dKyw_get_wind_pow(envLight);

        mDoMtx_YrotS(calc_mtx, -this.rot[1]);
        MtxPosition(scratchVec3a, windVec);

        vec3.set(scratchVec3b, 0, 1, 0);
        vec3.cross(scratchVec3b, scratchVec3b, scratchVec3a);

        if (vec3.length(scratchVec3b) >= 0.00000001) {
            vec3.normalize(scratchVec3b, scratchVec3b);
            quat.setAxisAngle(this.baseQuatTarget, scratchVec3b, windPow * cM_s2rad(0x600));
        } else {
            quat.identity(this.baseQuatTarget);
        }

        quat.slerp(this.baseQuat, this.baseQuat, this.baseQuatTarget, 0.25);

        for (let i = 0; i < 2; i++) {
            const animDirTarget = Math.min(windPow * 0x180, 0x100);
            this.animDir[i] = cLib_addCalcAngleRad2(this.animDir[i], cM_s2rad(animDirTarget), cM_s2rad(0x04), cM_s2rad(0x20));

            // Rock back and forth.
            this.animWave[i] += cM_s2rad((windPow * 0x800) + cM_rndFX(0x80)) * deltaTimeFrames;
            const wave = Math.sin(this.animWave[i]);

            vec3.set(scratchVec3a, wave, 0, wave);
            quat.setAxisAngle(this.animMtxQuat[i], scratchVec3a, this.animDir[i]);
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.BG0, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }
}

function vecHalfAngle(dst: vec3, a: vec3, b: vec3): void {
    vec3.negate(a, a);
    vec3.negate(b, b);
    vec3.normalize(a, a);
    vec3.normalize(b, b);
    vec3.add(dst, a, b);
    if (vec3.dot(dst, dst) > 0.0)
        vec3.normalize(dst, dst);
    else
        vec3.zero(dst);
}

function dDlst_texSpecmapST(dst: mat4, globals: dGlobals, pos: ReadonlyVec3, tevStr: dKy_tevstr_c, refl: number): void {
    const scale = 1.0 / refl;
    computeModelMatrixS(dst, scale, scale, 1.0);

    // Remap.
    buildEnvMtx(scratchMat4a, 1.0);
    mat4.mul(dst, dst, scratchMat4a);

    // Half-vector lookAt transform.
    vec3.sub(scratchVec3a, pos, globals.cameraPosition);
    dKyr_get_vectle_calc(tevStr.lightObj.Position, pos, scratchVec3b);
    vecHalfAngle(scratchVec3a, scratchVec3a, scratchVec3b);
    mat4.lookAt(scratchMat4a, Vec3Zero, scratchVec3a, Vec3UnitY);
    mat4.mul(dst, dst, scratchMat4a);

    computeMatrixWithoutTranslation(dst, dst);
}

class d_a_obj_zouK extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_obj_zouK;

    private model: J3DModelInstance;
    private bckAnm = new mDoExt_bckAnm();
    private effectMtx = mat4.create();

    private static arcName = `VzouK`;

    public override subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, d_a_obj_zouK.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_obj_zouK.arcName, 0x08));

        const anm = resCtrl.getObjectRes(ResType.Bck, d_a_obj_zouK.arcName, 0x05);
        this.bckAnm.init(this.model.modelData, anm, true, LoopMode.Once, 0.0, anm.duration);
        this.bckAnm.play(0.0);

        for (let i = 0; i < this.model.materialInstances.length; i++)
            this.model.materialInstances[i].effectMtx = this.effectMtx;

        this.cullMtx = this.model.modelMatrix;
        this.setCullSizeBox(-1000.0, 0.0, -1000.0, 1000.0, 2800.0, 1000.0);

        return cPhs__Status.Next;
    }

    private set_mtx(): void {
        vec3.copy(this.model.baseScale, this.scale);
        MtxTrans(this.pos, false, this.model.modelMatrix);
        mDoMtx_ZXYrotM(this.model.modelMatrix, this.rot);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.set_mtx();
    }

    private setEffectMtx(globals: dGlobals, pos: vec3, refl: number): void {
        dDlst_texSpecmapST(this.effectMtx, globals, pos, this.tevStr, refl);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        this.setEffectMtx(globals, this.pos, 0.5);
        this.bckAnm.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }
}

class d_a_swhit0 extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_swhit0;

    private model: J3DModelInstance;
    private bckAnm = new mDoExt_bckAnm();
    private btkAnm = new mDoExt_btkAnm();
    private static color1Normal = colorNewFromRGBA8(0xF0F5FF6E);
    private static color2Normal = colorNewFromRGBA8(0x6E786432);
    private static color1Hit = colorNewFromRGBA8(0xE6C8006E);
    private static color2Hit = colorNewFromRGBA8(0x78643264);

    public override subload(globals: dGlobals): cPhs__Status {
        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Always`, 0x35));

        const bckAnm = resCtrl.getObjectRes(ResType.Bck, `Always`, 0x0D);
        this.bckAnm.init(this.model.modelData, bckAnm, true, LoopMode.Repeat, 1.0, 0);

        const btkAnm = resCtrl.getObjectRes(ResType.Btk, `Always`, 0x58);
        this.btkAnm.init(this.model.modelData, btkAnm, true, LoopMode.Repeat, 1.0, 0);

        this.rot[2] = 0.0;
        this.setDrawMtx();
        this.cullMtx = this.model.modelMatrix;

        return cPhs__Status.Next;
    }

    private setDrawMtx(): void {
        vec3.copy(this.model.baseScale, this.scale);
        MtxTrans(this.pos, false, this.model.modelMatrix);
        mDoMtx_XYZrotM(this.model.modelMatrix, this.rot);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.bckAnm.play(deltaTimeFrames);
        this.btkAnm.play(deltaTimeFrames);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.BG0, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);

        this.model.setColorOverride(ColorKind.C1, d_a_swhit0.color1Normal);
        this.model.setColorOverride(ColorKind.C2, d_a_swhit0.color2Normal);
        this.bckAnm.entry(this.model);
        this.btkAnm.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }
}

interface daSeaFightGame__Ship {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    direction: 'right' | 'down';
    numTotalParts: number;
    numAliveParts: number;
}

class daSeaFightGame_info_c {
    // Grid details: 0 = empty, 1 = shot fired, missed, 2 = shot fired, hit, 100+ = hidden ship part
    public gridWidth = 8;
    public gridHeight = 8;
    public grid: number[] = nArray(this.gridWidth * this.gridHeight, () => 0);
    public ships: daSeaFightGame__Ship[] = [];
    public aliveShipNum = 0;
    public deadShipNum = 0;
    public bulletNum = 0;
    public bulletFiredNum = 0;

    public index(y: number, x: number): number {
        return y * this.gridWidth + x;
    }

    public init(bulletNum: number, scenario: number): void {
        this.bulletNum = bulletNum;
        this.bulletFiredNum = 0;

        // Reset grid.
        for (let i = 0; i < this.grid.length; i++)
            this.grid[i] = 0;

        if (scenario === 3) {
            this.aliveShipNum = 3;
            this.put_ship(0, 2);
            this.put_ship(1, 3);
            this.put_ship(2, 4);
        } else {
            // Could do other scenarios if wanted.
        }

        this.deadShipNum = 0;
    }

    private useBullet(): void {
        this.bulletNum--;
        this.bulletFiredNum++;
    }

    public attack(y: number, x: number): number {
        assert(this.bulletNum > 0);

        const index = y * this.gridWidth + x;

        if (this.grid[index] === 0) {
            // Miss.
            this.grid[index] = 1;
            this.useBullet();
            return -1;
        } else if (this.grid[index] >= 100) {
            const shipIndex = this.grid[index] - 100;
            const ship = assertExists(this.ships[shipIndex]);

            ship.numAliveParts--;
            if (ship.numAliveParts === 0) {
                this.aliveShipNum--;
                this.deadShipNum++;
            }

            this.grid[index] = 2;
            this.useBullet();
            return shipIndex;
        } else {
            // No effect.
            return -2;
        }
    }

    private put_ship(shipIndex: number, numParts: number): void {
        const ship: daSeaFightGame__Ship = {
            x1: -1, y1: -1,
            x2: -1, y2: -1,
            numAliveParts: numParts,
            numTotalParts: numParts,
            direction: null!,
        };

        while (true) {
            // Find a place to put the ship.
            ship.y1 = Math.floor(cM_rndF(this.gridHeight));
            ship.x1 = Math.floor(cM_rndF(this.gridWidth));

            if (cM_rndF(1) < 0.5) {
                ship.direction = 'right';
                ship.x2 = ship.x1 + numParts;
                ship.y2 = ship.y1 + 1;
            } else {
                ship.direction = 'down';
                ship.x2 = ship.x1 + 1;
                ship.y2 = ship.y1 + numParts;
            }

            if (this.checkPutShip(ship))
                break;
        }

        // Stamp ship down.

        for (let y = ship.y1; y < ship.y2; y++)
            for (let x = ship.x1; x < ship.x2; x++)
                this.grid[this.index(y, x)] = 100 + shipIndex;
        this.ships[shipIndex] = ship;
    }

    private checkPutShip(ship: daSeaFightGame__Ship): boolean {
        if (ship.x2 >= this.gridWidth)
            return false;
        if (ship.y2 >= this.gridHeight)
            return false;

        for (let y = ship.y1; y < ship.y2; y++)
            for (let x = ship.x1; x < ship.x2; x++)
                if (this.grid[this.index(y, x)] !== 0)
                    return false;

        return true;
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

class dDlst_2DNumber_c extends dDlst_2DBase_c {
    private texData: BTIData[] = [];
    public spacing: number = 1;
    public value: number = 0;

    constructor(private numDigits: number) {
        super();
    }

    public subload(globals: dGlobals): cPhs__Status {
        const status = globals.modelCache.requestMsgData(`menures`);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        for (let i = 0; i <= 9; i++)
            this.texData[i] = assertExists(globals.resCtrl.getResByName(ResType.Bti, `menures`, `rupy_num_0${i}.bti`, resCtrl.resSystem));

        return cPhs__Status.Complete;
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;
        const template = renderInstManager.pushTemplate();

        globals.quadStatic.setOnRenderInst(template);

        this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, template);
        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);

        let value = this.value;

        let x = 0;
        for (let i = 0; i < this.numDigits; i++) {
            const digit = value % 10;
            value = (value / 10) | 0;

            const renderInst = renderInstManager.newRenderInst();
            this.texData[digit].fillTextureMapping(materialParams.m_TextureMapping[0]);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

            vec3.set(scratchVec3a, x, 0, 0);
            mat4.translate(scratchMat4a, this.modelMatrix, scratchVec3a);
            mat4.mul(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchMat4a);
            x -= this.spacing * 2;

            this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
            renderInstManager.submitRenderInst(renderInst);

            // No more digits.
            if (value === 0)
                break;
        }

        renderInstManager.popTemplate();
    }
}

class mgameboard_sectx {
    public ctx: AudioContext;

    constructor() {
        this.ctx = new AudioContext();
    }

    public destroy(): void {
        this.ctx.close();
    }

    public playRes(res: mgameboard_seres): void {
        this.ctx.resume();

        assert(res.buffer !== null);
        const node = this.ctx.createBufferSource();
        node.buffer = res.buffer;
        node.connect(this.ctx.destination);
        node.start();
    }
}

class mgameboard_seres {
    public buffer: AudioBuffer | null = null;
    private decodeState: cPhs__Status = cPhs__Status.Started;

    constructor(private filename: string) {
    }

    public subload(globals: dGlobals, ctx: mgameboard_sectx): cPhs__Status {
        let status = globals.modelCache.requestFileData(this.filename);

        if (status !== cPhs__Status.Complete)
            return status;

        if (this.decodeState === cPhs__Status.Started) {
            // Unfortunately, because the WebAudio API, in its infinite wisdom, detaches the original audio buffer,
            // we have to make a copy here. Amazing stuff.
            // https://github.com/WebAudio/web-audio-api/issues/1175
            const buffer = globals.modelCache.getFileData(this.filename).copyToBuffer();
            ctx.ctx.decodeAudioData(buffer).then((buffer) => {
                this.buffer = buffer;
                this.decodeState = cPhs__Status.Complete;
            });

            this.decodeState = cPhs__Status.Loading;
        }

        if (this.decodeState === cPhs__Status.Complete)
            assert(this.buffer !== null);

        return this.decodeState;
    }
}

class d_a_mgameboard extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_mgameboard;

    private boardModel: J3DModelInstance;
    private cursorX = 0;
    private cursorY = 0;
    private cursorModel: J3DModelInstance;
    private missModels: J3DModelInstance[] = [];
    private hitModels: J3DModelInstance[] = [];
    private missModelCount: number = 0;
    private hitModelCount: number = 0;
    private shipModels: J3DModelInstance[] = [];
    private minigame = new daSeaFightGame_info_c();
    private bullet: dDlst_2DObject_c[] = [];
    private squid: dDlst_2DObject_c[] = [];
    private scoreNum = new dDlst_2DNumber_c(2);
    private highscoreLabel: dDlst_2DObject_c;
    private highscorePad: dDlst_2DObject_c;
    private highscoreNum = new dDlst_2DNumber_c(2);
    private highscore = 23;
    private minigameResetTimer = -1;
    private minigameActive = false;

    private sectx = new mgameboard_sectx();
    private seres_kbm = new mgameboard_seres('Extra/shop_0.aw_0000000d.wav');
    private seres_spl = new mgameboard_seres('Extra/shop_0.aw_0000000e.wav');

    private static arcName = `Kaisen_e`;

    public override subload(globals: dGlobals): cPhs__Status {
        let status: cPhs__Status;

        status = dComIfG_resLoad(globals, d_a_mgameboard.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        status = this.scoreNum.subload(globals);
        if (status !== cPhs__Status.Complete)
            return status;

        status = this.highscoreNum.subload(globals);
        if (status !== cPhs__Status.Complete)
            return status;

        status = this.seres_kbm.subload(globals, this.sectx);
        if (status !== cPhs__Status.Complete)
            return status;

        status = this.seres_spl.subload(globals, this.sectx);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;

        this.boardModel = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_mgameboard.arcName, 0x08));
        this.cursorModel = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_mgameboard.arcName, 0x09));
        this.highscorePad = new dDlst_2DObject_c(resCtrl.getObjectRes(ResType.Bti, d_a_mgameboard.arcName, 0x11));
        this.highscoreLabel = new dDlst_2DObject_c(resCtrl.getObjectRes(ResType.Bti, d_a_mgameboard.arcName, 0x0E));

        this.cullMtx = this.boardModel.modelMatrix;
        this.setCullSizeBox(-600.0, -300.0, -500.0, 600.0, 300.0, 100.0);

        this.loadHighscore();
        this.MiniGameInit(globals);

        this.setDrawMtx();

        return cPhs__Status.Next;
    }

    private highscoreSetting = 'WindWaker/Kaisen_e_HighScore';
    private loadHighscore(): void {
        this.highscore = GlobalSaveManager.loadSetting(this.highscoreSetting, this.highscore);
    }

    private saveHighscore(newScore: number): void {
        if (newScore < this.highscore) {
            this.highscore = newScore;
            GlobalSaveManager.saveSetting(this.highscoreSetting, this.highscore);
        }
    }

    private MiniGameInit(globals: dGlobals): void {
        const resCtrl = globals.resCtrl;

        this.minigame.init(24, 3);

        for (let i = this.missModels.length; i < this.minigame.bulletNum; i++)
            this.missModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_mgameboard.arcName, 0x0A)));

        for (let i = this.hitModels.length; i < this.minigame.bulletNum; i++)
            this.hitModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_mgameboard.arcName, 0x07)));

        const bulletData0 = resCtrl.getObjectRes(ResType.Bti, d_a_mgameboard.arcName, 0x0F);
        const bulletData1 = resCtrl.getObjectRes(ResType.Bti, d_a_mgameboard.arcName, 0x10);
        for (let i = this.bullet.length; i < this.minigame.bulletNum; i++)
            this.bullet.push(new dDlst_2DObject_c(bulletData0, bulletData1));

        const squidData0 = resCtrl.getObjectRes(ResType.Bti, d_a_mgameboard.arcName, 0x12);
        const squidData1 = resCtrl.getObjectRes(ResType.Bti, d_a_mgameboard.arcName, 0x13);
        for (let i = this.squid.length; i < this.minigame.ships.length; i++)
            this.squid.push(new dDlst_2DObject_c(squidData0, squidData1));

        this.shipModels.length = 0;
        for (let i = 0; i < this.minigame.ships.length; i++) {
            const ship = this.minigame.ships[i];
            const size = ship.numTotalParts;
            if (size === 2)
                this.shipModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_mgameboard.arcName, 0x04)));
            else if (size === 3)
                this.shipModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_mgameboard.arcName, 0x05)));
            else if (size === 4)
                this.shipModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_mgameboard.arcName, 0x06)));
            else
                throw "whoops";
        }

        this.cursorX = 0;
        this.cursorY = this.minigame.gridHeight - 1;
    }

    public move(y: number, x: number): void {
        this.cursorX = clamp(this.cursorX + x, 0, this.minigame.gridWidth - 1);
        this.cursorY = clamp(this.cursorY + y, 0, this.minigame.gridHeight - 1);
    }

    public up(): void {
        this.move(1, 0);
    }

    public down(): void {
        this.move(-1, 0);
    }

    public right(): void {
        this.move(0, 1);
    }

    public left(): void {
        this.move(0, -1);
    }

    public fire(): void {
        if (this.minigame.bulletNum === 0)
            return;

        const ret = this.minigame.attack(this.cursorY, this.cursorX);

        if (ret === -2) {
            // No effect.
            return;
        }

        if (ret === -1) {
            // Miss.
            this.sectx.playRes(this.seres_spl);
        } else {
            // Hit ship.
            this.sectx.playRes(this.seres_kbm);
        }
    }

    private positionM(dst: mat4, xw: number, yw: number, zw: number, scaleX: number = 1, scaleY: number = scaleX): void {
        vec3.copy(scratchVec3a, this.pos);
        scratchVec3a[0] += xw;
        scratchVec3a[1] += yw;
        scratchVec3a[2] += zw;
        MtxTrans(scratchVec3a, false, dst);
        mDoMtx_YrotM(dst, this.rot[1]);
        vec3.set(scratchVec3a, scaleX, scaleY, 1.0);
        mat4.scale(dst, dst, scratchVec3a);
    }

    private positionGrid(dst: mat4, y: number, x: number): void {
        const xw = -87.5 + x * 25.0;
        const yw = -87.5 + y * 25.0;
        return this.positionM(dst, xw, yw, 0.0);
    }

    private positionBullet(dst: mat4, i: number): void {
        // Original game uses 2D ortho view for this. We don't have that, so this was matched by hand.

        // Three columns of 8.
        const xc = (i / 8) | 0;
        const yc = (i % 8);

        const xw = -220 + xc * 26;
        const yw = 100 - yc * 26;
        return this.positionM(dst, xw, yw, 0.0, 12);
    }

    private positionSquid(dst: mat4, i: number): void {
        // Original game uses 2D ortho view for this. We don't have that, so this was matched by hand.

        const xw = 180;
        const yw = 100 - i * 40;
        return this.positionM(dst, xw, yw, 0.0, 24);
    }

    private setDrawMtx(): void {
        vec3.copy(this.boardModel.baseScale, this.scale);
        MtxTrans(this.pos, false, this.boardModel.modelMatrix);
        mDoMtx_YrotM(this.boardModel.modelMatrix, this.rot[1]);

        this.positionGrid(this.cursorModel.modelMatrix, this.cursorY, this.cursorX);

        this.hitModelCount = 0;
        this.missModelCount = 0;

        for (let y = 0; y < this.minigame.gridHeight; y++) {
            for (let x = 0; x < this.minigame.gridWidth; x++) {
                const grid = this.minigame.grid[this.minigame.index(y, x)];

                let model: J3DModelInstance | null = null;
                if (grid === 1) {
                    // Miss
                    model = this.missModels[this.missModelCount++];
                } else if (grid === 2) {
                    // Hit
                    model = this.hitModels[this.hitModelCount++];
                }

                if (model === null)
                    continue;

                this.positionGrid(model.modelMatrix, y, x);
            }
        }

        for (let i = 0; i < this.minigame.ships.length; i++) {
            const ship = this.minigame.ships[i];
            const model = this.shipModels[i];

            // Place ship model.
            this.positionGrid(model.modelMatrix, ship.y1, ship.x1);
            if (ship.direction === 'right')
                mDoMtx_ZrotM(model.modelMatrix, 0x4000);
            else if (ship.direction === 'down')
                mDoMtx_ZrotM(model.modelMatrix, -0x8000);
        }

        for (let i = 0; i < this.bullet.length; i++) {
            const bullet = this.bullet[i];
            bullet.whichTex = (i < this.minigame.bulletFiredNum) ? 1 : 0;
            this.positionBullet(bullet.modelMatrix, i);
        }

        for (let i = 0; i < this.squid.length; i++) {
            const squid = this.squid[i];
            squid.whichTex = (i < this.minigame.deadShipNum) ? 1 : 0;
            this.positionSquid(squid.modelMatrix, i);
        }

        this.scoreNum.spacing = 0.8;
        this.scoreNum.value = this.minigame.bulletFiredNum;
        this.positionM(this.scoreNum.modelMatrix, -168, 130, 0, 8);

        this.highscoreNum.spacing = 0.8;
        this.highscoreNum.value = this.highscore;
        this.positionM(this.highscoreNum.modelMatrix, 111, 128, 12, 8);

        this.positionM(this.highscoreLabel.modelMatrix, 28, 128, 5, 55, 11);
        this.positionM(this.highscorePad.modelMatrix, 105, 128, 10, 20);
    }

    private MinigameMain(globals: dGlobals): void {
        const inputManager = globals.context.inputManager;
        if (inputManager.isKeyDownEventTriggered('ArrowDown'))
            this.down();
        if (inputManager.isKeyDownEventTriggered('ArrowUp'))
            this.up();
        if (inputManager.isKeyDownEventTriggered('ArrowLeft'))
            this.left();
        if (inputManager.isKeyDownEventTriggered('ArrowRight'))
            this.right();

        if (inputManager.isKeyDownEventTriggered('KeyF'))
            this.fire();

        this.setDrawMtx();
    }

    private minigameDeactivate(globals: dGlobals): void {
        // Generate a new board for next time.
        this.MiniGameInit(globals);
        this.minigameResetTimer = -1;
        this.minigameActive = false;
    }

    private minigameActivate(globals: dGlobals): void {
        this.minigameActive = true;
        this.setDrawMtx();
    }

    private minigameDone(globals: dGlobals): void {
        this.saveHighscore(this.minigame.bulletFiredNum);
        this.setDrawMtx();
        this.minigameResetTimer = 30;
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        const inputManager = globals.context.inputManager;
        if (this.minigameResetTimer >= 0) {
            this.minigameResetTimer -= deltaTimeFrames;
            if (this.minigameResetTimer <= 0 || inputManager.isKeyDownEventTriggered('KeyF'))
                this.minigameDeactivate(globals);
        } else if (this.minigame.bulletNum === 0 || this.minigame.aliveShipNum === 0) {
            this.minigameDone(globals);
        } else if (this.minigameActive) {
            this.MinigameMain(globals);
        } else {
            // happy easter!!!!!!!!!!!!!!!!!!!!!!!!!
            if (inputManager.isKeyDownEventTriggered('KeyF'))
                this.minigameActivate(globals);
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        setLightTevColorType(globals, this.boardModel, this.tevStr, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.boardModel, renderInstManager, viewerInput);

        if (!this.minigameActive)
            return;

        setLightTevColorType(globals, this.cursorModel, this.tevStr, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.cursorModel, renderInstManager, viewerInput, globals.dlst.ui);

        for (let i = 0; i < this.hitModelCount; i++) {
            const model = this.hitModels[i];
            setLightTevColorType(globals, model, this.tevStr, viewerInput.camera);
            mDoExt_modelUpdateDL(globals, model, renderInstManager, viewerInput, globals.dlst.ui);
        }

        for (let i = 0; i < this.missModelCount; i++) {
            const model = this.missModels[i];
            setLightTevColorType(globals, model, this.tevStr, viewerInput.camera);
            mDoExt_modelUpdateDL(globals, model, renderInstManager, viewerInput, globals.dlst.ui);
        }

        // Show ships after the game ends.
        if (this.minigame.bulletNum === 0) {
            for (let i = 0; i < this.minigame.ships.length; i++) {
                const model = this.shipModels[i];
                setLightTevColorType(globals, model, this.tevStr, viewerInput.camera);
                mDoExt_modelUpdateDL(globals, model, renderInstManager, viewerInput, globals.dlst.ui);
            }
        }

        renderInstManager.setCurrentList(globals.dlst.ui[1]);
        for (let i = 0; i < this.bullet.length; i++)
            this.bullet[i].draw(globals, renderInstManager, viewerInput);
        for (let i = 0; i < this.squid.length; i++)
            this.squid[i].draw(globals, renderInstManager, viewerInput);
        this.scoreNum.draw(globals, renderInstManager, viewerInput);
        this.highscoreNum.draw(globals, renderInstManager, viewerInput);
        this.highscoreLabel.draw(globals, renderInstManager, viewerInput);
        this.highscorePad.draw(globals, renderInstManager, viewerInput);
    }
}

function get_cloth_anim_sub_factor(dst: vec3, pos: vec3, other: vec3, distIdeal: number, spring: number, scratch = scratchVec3b): void {
    vec3.sub(scratch, other, pos);
    const distActual = vec3.length(scratch);
    const distTarget = (distActual - distIdeal) * spring;
    vec3.scaleAndAdd(dst, dst, scratch, distTarget / distActual);
}

class dCloth_packet_c {
    private posArr: vec3[][];
    private nrmArr: vec3[];
    private speedArr: vec3[];
    private curArr: number = 0;

    private mtx = mat4.create();
    private globalWind = vec3.clone(Vec3UnitZ);
    private scale = vec3.clone(Vec3One);
    private wave = 0;
    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;
    private materialHelperBack: GXMaterialHelperGfx;

    // Settings.
    public gravity = 0;
    public spring = 1;
    public waveSpeed = 0x0400;
    public windSpeed = 10;
    public windSpeedWave = 5;
    public flyFlex = 1;
    public hoistFlex = 1;
    public drag = 1;
    public rotateY = 0;
    public ripple = 0;

    constructor(private toonTex: BTIData, private flagTex: BTIData, private flyGridSize: number, private hoistGridSize: number, private flyLength: number, private hoistLength: number, private tevStr: dKy_tevstr_c) {
        const gridSize = this.flyGridSize * this.hoistGridSize;
        this.posArr = nArray(2, () => nArray(gridSize, () => vec3.create()));
        this.nrmArr = nArray(gridSize, () => vec3.create());
        this.speedArr = nArray(gridSize, () => vec3.create());

        for (let hoist = 0; hoist < this.hoistGridSize; hoist++) {
            for (let fly = 0; fly < this.flyGridSize; fly++) {
                const idx = this.getIndex(fly, hoist);
                vec3.set(this.posArr[0][idx], 0, -this.hoistLength * (hoist / (this.hoistGridSize - 1)), this.flyLength * (fly / (this.flyGridSize - 1)));
                vec3.copy(this.posArr[1][idx], this.posArr[0][idx]);
            }
        }

        this.setNrm();

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);

        const mb = new GXMaterialBuilder();
        mb.setUsePnMtxIdx(false);

        mb.setChanCtrl(0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 0x03, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.SRTG, GX.TexGenSrc.COLOR0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR0A0);
        mb.setTevSwapMode(0, TevDefaultSwapTables[0], TevDefaultSwapTables[1]);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevSwapMode(1, TevDefaultSwapTables[0], TevDefaultSwapTables[0]);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.TEXC, GX.CC.CPREV, GX.CC.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevSwapMode(2, TevDefaultSwapTables[0], TevDefaultSwapTables[2]);
        mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.C2, GX.CC.TEXC, GX.CC.CPREV);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // d_cloth_packet::matDL has these settings
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);

        mb.setCullMode(GX.CullMode.BACK);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('Flag Front'));

        mb.setCullMode(GX.CullMode.FRONT);
        this.materialHelperBack = new GXMaterialHelperGfx(mb.finish('Flag Back'));

        // We reuse the same material data for both sides. We should totally be able to do that.
        assert(this.materialHelper.materialParamsBufferSize === this.materialHelperBack.materialParamsBufferSize);

        // noclip modification: randomly stagger wave
        this.wave = Math.random() * 0xFFFF;
    }

    protected factorCheck(fly: number, hoist: number): boolean {
        if (fly === 0 && (hoist === 0 || hoist === this.hoistGridSize - 1))
            return true;

        return false;
    }

    private getIndex(fly: number, hoist: number): number {
        return hoist * this.flyGridSize + fly;
    }

    private setNrm(): void {
        const posArr = this.posArr[this.curArr];
        const nrmArr = this.nrmArr;

        for (let hoist = 0; hoist < this.hoistGridSize; hoist++) {
            for (let fly = 0; fly < this.flyGridSize; fly++) {
                const pos = posArr[this.getIndex(fly, hoist)];
                const dst = nrmArr[this.getIndex(fly, hoist)];

                vec3.zero(dst);

                const flyM1 = clamp(fly - 1, 0, this.flyGridSize - 1);
                const flyP1 = clamp(fly + 1, 0, this.flyGridSize - 1);
                const hoistM1 = clamp(hoist - 1, 0, this.hoistGridSize - 1);
                const hoistP1 = clamp(hoist + 1, 0, this.hoistGridSize - 1);

                if (flyM1 !== fly) {
                    vec3.sub(scratchVec3a, posArr[this.getIndex(flyM1, hoist)], pos);

                    if (hoistM1 !== hoist) {
                        vec3.sub(scratchVec3b, posArr[this.getIndex(fly, hoistM1)], pos);
                        vec3.cross(scratchVec3c, scratchVec3b, scratchVec3a);
                        vec3.normalize(scratchVec3c, scratchVec3c);
                        vec3.add(dst, dst, scratchVec3c);
                    }

                    if (hoistP1 !== hoist) {
                        vec3.sub(scratchVec3b, posArr[this.getIndex(fly, hoistP1)], pos);
                        vec3.cross(scratchVec3c, scratchVec3a, scratchVec3b);
                        vec3.normalize(scratchVec3c, scratchVec3c);
                        vec3.add(dst, dst, scratchVec3c);
                    }
                }

                if (flyP1 !== fly) {
                    vec3.sub(scratchVec3a, posArr[this.getIndex(flyP1, hoist)], pos);

                    if (hoistM1 !== hoist) {
                        vec3.sub(scratchVec3b, posArr[this.getIndex(fly, hoistM1)], pos);
                        vec3.cross(scratchVec3c, scratchVec3a, scratchVec3b);
                        vec3.normalize(scratchVec3c, scratchVec3c);
                        vec3.add(dst, dst, scratchVec3c);
                    }

                    if (hoistP1 !== hoist) {
                        vec3.sub(scratchVec3b, posArr[this.getIndex(fly, hoistP1)], pos);
                        vec3.cross(scratchVec3c, scratchVec3b, scratchVec3a);
                        vec3.normalize(scratchVec3c, scratchVec3c);
                        vec3.add(dst, dst, scratchVec3c);
                    }
                }

                vec3.normalize(dst, dst);

                const theta = cM_s2rad(this.rotateY) * Math.sin(cM_s2rad((this.wave + this.ripple * (fly + hoist))));
                computeModelMatrixR(scratchMat4a, 0, theta, 0);
                transformVec3Mat4w0(dst, scratchMat4a, dst);
            }
        }
    }

    private getFactor(dst: vec3, posArr: vec3[], nrmArr: vec3[], speed: vec3, distFly: number, distHoist: number, distBoth: number, fly: number, hoist: number, deltaTimeFrames: number): void {
        if (this.factorCheck(fly, hoist)) {
            vec3.zero(dst);
            return;
        }

        const idx = this.getIndex(fly, hoist);

        const pos = posArr[idx];
        vec3.scale(dst, nrmArr[idx], vec3.dot(speed, nrmArr[idx]));
        dst[1] += this.gravity * deltaTimeFrames;

        const flyM1 = clamp(fly - 1, 0, this.flyGridSize - 1);
        const flyP1 = clamp(fly + 1, 0, this.flyGridSize - 1);
        const hoistM1 = clamp(hoist - 1, 0, this.hoistGridSize - 1);
        const hoistP1 = clamp(hoist + 1, 0, this.hoistGridSize - 1);

        // Apply constraints to our connected neighbors.

        if (flyM1 !== fly)
            get_cloth_anim_sub_factor(dst, pos, posArr[this.getIndex(flyM1, hoist)], distFly, this.spring);
        if (flyP1 !== fly)
            get_cloth_anim_sub_factor(dst, pos, posArr[this.getIndex(flyP1, hoist)], distFly, this.spring);
        if (hoistM1 !== hoist)
            get_cloth_anim_sub_factor(dst, pos, posArr[this.getIndex(fly, hoistM1)], distHoist, this.spring);
        if (hoistP1 !== hoist)
            get_cloth_anim_sub_factor(dst, pos, posArr[this.getIndex(fly, hoistP1)], distHoist, this.spring);
        if (flyM1 !== fly && hoistM1 !== hoist)
            get_cloth_anim_sub_factor(dst, pos, posArr[this.getIndex(flyM1, hoistM1)], distBoth, this.spring);
        if (flyM1 !== fly && hoistP1 !== hoist)
            get_cloth_anim_sub_factor(dst, pos, posArr[this.getIndex(flyM1, hoistP1)], distBoth, this.spring);
        if (flyP1 !== fly && hoistM1 !== hoist)
            get_cloth_anim_sub_factor(dst, pos, posArr[this.getIndex(flyP1, hoistM1)], distBoth, this.spring);
        if (flyP1 !== fly && hoistP1 !== hoist)
            get_cloth_anim_sub_factor(dst, pos, posArr[this.getIndex(flyP1, hoistP1)], distBoth, this.spring);
    }

    public cloth_move(deltaTimeFrames: number): void {
        // Compute global wind vector.
        vec3.scale(scratchVec3a, this.globalWind, this.windSpeed + this.windSpeedWave * Math.sin(cM_s2rad(this.wave)));

        const distFly = (this.flyLength / (this.flyGridSize - 1)) * this.flyFlex;
        const distHoist = (this.hoistLength / (this.hoistGridSize - 1)) * this.hoistFlex;
        const distBoth = Math.hypot(distFly, distHoist);

        const posArrOld = this.posArr[this.curArr];
        this.curArr ^= 1;
        const posArrNew = this.posArr[this.curArr];

        for (let hoist = 0; hoist < this.hoistGridSize; hoist++) {
            for (let fly = 0; fly < this.flyGridSize; fly++) {
                const idx = this.getIndex(fly, hoist);
                this.getFactor(scratchVec3c, posArrOld, this.nrmArr, scratchVec3a, distFly, distHoist, distBoth, fly, hoist, deltaTimeFrames);
                vec3.add(this.speedArr[idx], this.speedArr[idx], scratchVec3c);
                vec3.scale(this.speedArr[idx], this.speedArr[idx], this.drag);
                vec3.scaleAndAdd(posArrNew[idx], posArrOld[idx], this.speedArr[idx], clamp(deltaTimeFrames, 0, 1));
            }
        }

        this.wave += this.waveSpeed * deltaTimeFrames;
        this.setNrm();
    }

    private plotPoint(ddraw: TDDraw, fly: number, hoist: number, front: boolean): void {
        const posArr = this.posArr[this.curArr];
        const nrmArr = this.nrmArr;

        const tx = (fly + 0) / (this.flyGridSize - 1);
        const ty = (hoist / (this.hoistGridSize - 1));
        const idx = this.getIndex(fly, hoist);

        ddraw.position3vec3(posArr[idx]);
        if (front) {
            ddraw.normal3vec3(nrmArr[idx]);
        } else {
            const x = nrmArr[idx][0], y = nrmArr[idx][1], z = nrmArr[idx][2];
            ddraw.normal3f32(-x, -y, -z);
        }
        ddraw.texCoord2f32(GX.Attr.TEX0, tx, ty);
    }

    private plot(ddraw: TDDraw, front: boolean): void {
        for (let fly = 0; fly < this.flyGridSize - 1; fly++) {
            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

            for (let hoist = 0; hoist < this.hoistGridSize; hoist++) {
                this.plotPoint(ddraw, fly + 0, hoist, front);
                this.plotPoint(ddraw, fly + 1, hoist, front);
            }

            ddraw.end();
        }
    }

    private drawSide(renderInstManager: GfxRenderInstManager, ddraw: TDDraw, front: boolean): void {
        this.plot(ddraw, front);
        const renderInst = ddraw.makeRenderInst(renderInstManager);
        const materialHelper = front ? this.materialHelper : this.materialHelperBack;
        materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public cloth_draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        /*
        const ctx = getDebugOverlayCanvas2D();

        for (let hoist = 0; hoist < this.hoistGridSize; hoist++) {
            for (let fly = 0; fly < this.flyGridSize; fly++) {
                transformVec3Mat4w1(scratchVec3a, this.mtx, this.posArr[this.curArr][this.getIndex(fly, hoist)]);
                transformVec3Mat4w0(scratchVec3b, this.mtx, this.nrmArr[this.getIndex(fly, hoist)]);
                drawWorldSpaceVector(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b, 50);
            }
        }
        */

        const template = renderInstManager.pushTemplate();

        dKy_setLight__OnMaterialParams(globals.g_env_light, materialParams, viewerInput.camera);
        this.flagTex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        this.toonTex.fillTextureMapping(materialParams.m_TextureMapping[1]);
        template.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);
        colorCopy(materialParams.u_Color[ColorKind.C0], this.tevStr.colorC0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.tevStr.colorK0);
        colorCopy(materialParams.u_Color[ColorKind.C2], this.tevStr.colorK1);
        mat4.mul(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix, this.mtx);
        this.materialHelper.allocateDrawParamsDataOnInst(template, drawParams);

        const ddraw = this.ddraw;
        ddraw.beginDraw(globals.modelCache.cache);
        ddraw.allocPrimitives(GX.Command.DRAW_TRIANGLE_STRIP, ((this.flyGridSize - 1) * this.hoistGridSize) * 2 * 2);
        this.drawSide(renderInstManager, ddraw, true);
        this.drawSide(renderInstManager, ddraw, false);
        ddraw.endDraw(renderInstManager);

        renderInstManager.popTemplate();
    }

    public setGlobalWind(v: vec3): void {
        computeMatrixWithoutTranslation(scratchMat4a, this.mtx);
        mat4.invert(scratchMat4a, scratchMat4a);
        transformVec3Mat4w0(this.globalWind, scratchMat4a, v);
    }

    public setScale(v: vec3): void {
        vec3.copy(this.scale, v);
    }

    public setMtx(m: mat4): void {
        mat4.copy(this.mtx, m);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class d_a_sie_flag extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_sie_flag;

    private model: J3DModelInstance;
    private cloth: dCloth_packet_c;
    private windvec = vec3.create();
    private flagOffset = vec3.fromValues(0, 900, 0);

    public clothTevStr = new dKy_tevstr_c();

    private static arcName = `Eshata`;
    private static arcNameCloth = `Cloth`;

    public override subload(globals: dGlobals): cPhs__Status {
        let status: cPhs__Status;

        status = dComIfG_resLoad(globals, d_a_sie_flag.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        status = dComIfG_resLoad(globals, d_a_sie_flag.arcNameCloth);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_sie_flag.arcName, 0x04));

        dKy_tevstr_init(this.clothTevStr, this.roomNo);
        const toonTex = resCtrl.getObjectRes(ResType.Bti, d_a_sie_flag.arcNameCloth, 0x03);
        const flagTex = resCtrl.getObjectRes(ResType.Bti, d_a_sie_flag.arcName, 0x07);
        this.cloth = new dCloth_packet_c(toonTex, flagTex, 5, 5, 700.0, 360.0, this.clothTevStr);

        vec3.copy(this.windvec, dKyw_get_wind_vec(globals.g_env_light));
        this.set_mtx();
        this.cullMtx = this.model.modelMatrix;
        this.setCullSizeBox(-700.0, 0.0, -700.0, 700.0, 1100.0, 700.0);

        return cPhs__Status.Next;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.BG0, this.pos, this.tevStr);
        settingTevStruct(globals, LightType.Actor, this.pos, this.clothTevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
        this.cloth.cloth_draw(globals, renderInstManager, viewerInput);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        super.execute(globals, deltaTimeFrames);

        this.set_mtx();

        // TODO(jstpierre): addCalcPos2 windvec
        vec3.add(scratchVec3a, this.pos, this.flagOffset);
        dKyw_get_AllWind_vecpow(this.windvec, globals.g_env_light, scratchVec3a);

        this.cloth.spring = 0.4;
        this.cloth.gravity = -0.75;
        this.cloth.drag = 0.899;
        this.cloth.waveSpeed = 0x0400;
        this.cloth.ripple = 900;
        this.cloth.rotateY = -800;
        this.cloth.windSpeed = 13.0;
        this.cloth.windSpeedWave = 8.0;
        this.cloth.setGlobalWind(this.windvec);
        this.cloth.cloth_move(deltaTimeFrames);
    }

    private set_mtx(): void {
        vec3.copy(this.model.baseScale, this.scale);
        MtxTrans(this.pos, false);
        mDoMtx_ZXYrotM(calc_mtx, this.rot);
        mat4.copy(this.model.modelMatrix, calc_mtx);
        MtxTrans(this.flagOffset, true);
        this.cloth.setMtx(calc_mtx);
    }

    public override delete(globals: dGlobals): void {
        this.cloth.destroy(globals.modelCache.device);
    }
}

class d_a_tori_flag extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_tori_flag;

    private model: J3DModelInstance;
    private cloth: dCloth_packet_c;
    private windvec = vec3.create();
    private flagOffset = vec3.fromValues(0, 350, 0);

    public clothTevStr = new dKy_tevstr_c();

    private static arcName = `Trflag`;
    private static arcNameCloth = `Cloth`;

    public override subload(globals: dGlobals): cPhs__Status {
        let status: cPhs__Status;

        status = dComIfG_resLoad(globals, d_a_tori_flag.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        status = dComIfG_resLoad(globals, d_a_tori_flag.arcNameCloth);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, d_a_tori_flag.arcName, 0x04));

        dKy_tevstr_init(this.clothTevStr, this.roomNo);
        const toonTex = resCtrl.getObjectRes(ResType.Bti, d_a_tori_flag.arcNameCloth, 0x03);
        const flagTex = resCtrl.getObjectRes(ResType.Bti, d_a_tori_flag.arcName, 0x07);
        this.cloth = new dCloth_packet_c(toonTex, flagTex, 5, 5, 210.0, 105.0, this.clothTevStr);

        vec3.copy(this.windvec, dKyw_get_wind_vec(globals.g_env_light));

        this.set_mtx();
        this.cullMtx = this.model.modelMatrix;

        return cPhs__Status.Next;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.BG0, this.pos, this.tevStr);
        settingTevStruct(globals, LightType.Actor, this.pos, this.clothTevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
        this.cloth.cloth_draw(globals, renderInstManager, viewerInput);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        super.execute(globals, deltaTimeFrames);

        this.set_mtx();

        vec3.add(scratchVec3a, this.pos, this.flagOffset);
        dKyw_get_AllWind_vecpow(this.windvec, globals.g_env_light, scratchVec3a);

        this.cloth.spring = 0.4;
        this.cloth.gravity = -1.5;
        this.cloth.drag = 0.75;
        this.cloth.flyFlex = 0.9;
        this.cloth.hoistFlex = 0.9;
        this.cloth.waveSpeed = 0x0400;
        this.cloth.ripple = 900;
        this.cloth.rotateY = -800;
        this.cloth.windSpeed = 8.0;
        this.cloth.windSpeedWave = 8.0;
        this.cloth.setGlobalWind(this.windvec);
        this.cloth.cloth_move(deltaTimeFrames);
    }

    private set_mtx(): void {
        vec3.copy(this.model.baseScale, this.scale);
        MtxTrans(this.pos, false);
        mDoMtx_ZXYrotM(calc_mtx, this.rot);
        mat4.copy(this.model.modelMatrix, calc_mtx);
        MtxTrans(this.flagOffset, true);
        this.cloth.setMtx(calc_mtx);
    }

    public override delete(globals: dGlobals): void {
        this.cloth.destroy(globals.modelCache.device);
    }
}

class d_a_majuu_flag extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_majuu_flag;

    // Public data.
    public parentMtx: mat4 | null = null;
    public parentPos: vec3 | null = null;

    // d_a_majuu_flag has custom cloth simulation because its shape (and connectivity) are different.
    // Rather than a 2D grid, it takes the shape of a triangle, with points that are roughly laid
    // out like this:
    //
    //                   9
    //             5      
    //       2           8
    //  0          4      
    //       1           7
    //             3      
    //                   6
    //
    // This is abbreviated in the diagram above for space reasons; the triangular pattern continues
    // until 21 points are reached (so, 6 columns, for those familiar with the number sequence).

    private pointCount = 21;
    private posArr: vec3[][] = nArray(2, () => nArray(21, () => vec3.create()));
    private nrmArr: vec3[] = nArray(this.pointCount, () => vec3.create());
    private speedArr: vec3[] = nArray(this.pointCount, () => vec3.create());
    private curArr: number = 0;
    private mtx = mat4.create();

    private flagTex: BTIData;
    private toonTex: BTIData;
    private rawTex: BTIData | null = null;

    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;
    private materialHelperBack: GXMaterialHelperGfx;

    private flagType: number = 0;
    private texType: number = 0;
    private flagScale: number = 1;
    private usePlayerTevStr: boolean = false;

    // Internal state.
    private wave = 0;

    // Static data.
    private adjTableConstraint: Int32Array;
    private adjTableNormal: Int32Array;
    private texCoordTable: Float32Array;
    private displayList: DataView;

    // HIO data.
    private spring = 0.45;
    private gravity = -1.25;
    private waveSpeed = 0x0400;
    private windSpeed1 = 20.0;
    private windSpeed2 = 10.0;
    private drag = 0.85;

    private static arcNames = [null, `Matif`, `Vsvfg`, `Xhcf`];
    private static arcNameCloth = `Cloth`;

    public override subload(globals: dGlobals): cPhs__Status {
        this.flagType = this.parameters & 0xFF;
        this.texType = (this.parameters >>> 24) & 0xFF;

        let status: cPhs__Status;

        const arcName = d_a_majuu_flag.arcNames[this.texType];
        if (arcName !== null) {
            status = dComIfG_resLoad(globals, arcName);
            if (status !== cPhs__Status.Complete)
                return status;
        }

        status = dComIfG_resLoad(globals, d_a_majuu_flag.arcNameCloth);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;

        // Adjacency information for constraints.
        this.adjTableConstraint = globals.findExtraSymbolData(`d_a_majuu_flag.o`, `rel_pos_idx_tbl$4282`).createTypedArray(Int32Array, 0, undefined, Endianness.BIG_ENDIAN);
        // Adjacency information for normal calculation (can be circular)
        this.adjTableNormal = globals.findExtraSymbolData(`d_a_majuu_flag.o`, `rel_pos_idx_tbl$4099`).createTypedArray(Int32Array, 0, undefined, Endianness.BIG_ENDIAN);

        this.texCoordTable = globals.findExtraSymbolData(`d_a_majuu_flag.o`, `l_texCoord`).createTypedArray(Float32Array, 0, undefined, Endianness.BIG_ENDIAN);
        this.displayList = globals.findExtraSymbolData(`d_a_majuu_flag.o`, `l_majuu_flagDL`).createDataView();

        const posData = globals.findExtraSymbolData(`d_a_majuu_flag.o`, `l_majuu_flag_pos`).createTypedArray(Float32Array, 0, undefined, Endianness.BIG_ENDIAN);

        for (let i = 0; i < this.pointCount; i++) {
            const dst = this.posArr[0][i];

            const x = posData[i * 3 + 0];
            const y = posData[i * 3 + 1];
            const z = posData[i * 3 + 2];
            vec3.set(dst, x, y, z);

            if (!this.isPointFixed(i)) {
                dst[0] += cM_rndFX(10.0);
                dst[1] += cM_rndFX(10.0);
                dst[2] += cM_rndFX(10.0);
            }

            vec3.set(this.nrmArr[i], 1.0, 0.0, 0.0);
        }

        this.toonTex = resCtrl.getObjectRes(ResType.Bti, 'Cloth', 0x03);

        // Load textures.
        if (this.texType === 0) {
            const rawTexData = globals.findExtraSymbolData(`d_a_majuu_flag.o`, `l_flag02TEX`);
            this.rawTex = loadRawTexture(globals, rawTexData, 0x40, 0x40, GX.TexFormat.CMPR, GX.WrapMode.CLAMP, GX.WrapMode.CLAMP);
            this.flagTex = this.rawTex;
        } else if (this.texType === 1) {
            this.flagTex = resCtrl.getObjectRes(ResType.Bti, arcName!, 0x03);
        } else if (this.texType === 2) {
            this.flagTex = resCtrl.getObjectRes(ResType.Bti, arcName!, 0x03);
        } else if (this.texType === 3) {
            this.flagTex = resCtrl.getObjectRes(ResType.Bti, arcName!, 0x03);
        }

        if (this.texType === 0) {
            if (this.flagType === 2) {
                this.flagScale = 2.0;
            } else if (this.flagType === 3) {
                this.flagScale = 1.27;
                this.usePlayerTevStr = true;
            } else if (this.flagType === 4) {
                this.flagScale = 0.3;
            } else {
                this.flagScale = 1.0;
            }
        } else {
            this.flagScale = 0.3;

            if (this.flagType !== 0xFF) {
                // In this case, flagType is a scale parameter.
                this.flagScale += (this.flagType * 0.05);
            }
        }

        this.set_mtx();
        this.cullMtx = this.mtx;
        this.setCullSizeBox(-300.0, -1500.0, -100.0, 300.0, 100.0, 1200.0);

        if (this.texType === 3) {
            // Spin for a bit
            for (let i = 0; i < 20; i++)
                this.majuu_flag_move(globals, 1);
        }

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);

        const mb = new GXMaterialBuilder();
        mb.setUsePnMtxIdx(false);

        mb.setChanCtrl(0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 0x03, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.SRTG, GX.TexGenSrc.COLOR0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR0A0);
        mb.setTevSwapMode(0, TevDefaultSwapTables[0], TevDefaultSwapTables[1]);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevSwapMode(1, TevDefaultSwapTables[0], TevDefaultSwapTables[0]);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.TEXC, GX.CC.CPREV, GX.CC.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevSwapMode(2, TevDefaultSwapTables[0], TevDefaultSwapTables[2]);
        mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.C2, GX.CC.TEXC, GX.CC.CPREV);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // d_cloth_packet::matDL has these settings
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);

        mb.setCullMode(GX.CullMode.BACK);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('Flag Front'));

        mb.setCullMode(GX.CullMode.FRONT);
        this.materialHelperBack = new GXMaterialHelperGfx(mb.finish('Flag Back'));

        // noclip modification: randomly stagger wave
        this.wave = Math.random() * 0xFFFF;

        return cPhs__Status.Next;
    }

    private plotPoint(ddraw: TDDraw, posIdx: number, texIdx: number, front: boolean): void {
        const posArr = this.posArr[this.curArr];
        const nrmArr = this.nrmArr;

        ddraw.position3vec3(posArr[posIdx]);
        if (front) {
            ddraw.normal3vec3(nrmArr[posIdx]);
        } else {
            const x = nrmArr[posIdx][0], y = nrmArr[posIdx][1], z = nrmArr[posIdx][2];
            ddraw.normal3f32(-x, -y, -z);
        }

        const tx = this.texCoordTable[texIdx * 2 + 0];
        const ty = this.texCoordTable[texIdx * 2 + 1];
        ddraw.texCoord2f32(GX.Attr.TEX0, tx, ty);
    }

    private plot(ddraw: TDDraw, front: boolean): void {
        const dlView = this.displayList;

        let idx = 0x00;
        while (true) {
            const cmd = dlView.getUint8(idx + 0x00);
            if (cmd === 0)
                break;

            assert(cmd === GX.Command.DRAW_TRIANGLE_STRIP);

            const vertexCount = dlView.getUint16(idx + 0x01);
            idx += 0x03;

            ddraw.begin(cmd, vertexCount);
            for (let i = 0; i < vertexCount; i++) {
                const posIdx = dlView.getUint8(idx++);
                const nrmIdx = dlView.getUint8(idx++);
                const texIdx = dlView.getUint8(idx++);

                assert(posIdx === nrmIdx);
                this.plotPoint(ddraw, posIdx, texIdx, front);
            }
            ddraw.end();
        }
    }

    private drawSide(renderInstManager: GfxRenderInstManager, ddraw: TDDraw, front: boolean): void {
        this.plot(ddraw, front);
        const renderInst = ddraw.makeRenderInst(renderInstManager);
        const materialHelper = front ? this.materialHelper : this.materialHelperBack;
        materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        // For reference.
        /*
        for (let i = 0; i < this.pointCount; i++) {
            transformVec3Mat4w1(scratchVec3a, this.mtx, this.posArr[0][i]);
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, scratchVec3a);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, scratchVec3a, '' + i);
        }
        */

        if (this.usePlayerTevStr) {
            // TODO(jstpierre)
            settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        } else {
            settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        }

        const template = renderInstManager.pushTemplate();

        dKy_setLight__OnMaterialParams(globals.g_env_light, materialParams, viewerInput.camera);
        this.flagTex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        this.toonTex.fillTextureMapping(materialParams.m_TextureMapping[1]);
        template.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);
        colorCopy(materialParams.u_Color[ColorKind.C0], this.tevStr.colorC0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.tevStr.colorK0);
        colorCopy(materialParams.u_Color[ColorKind.C2], this.tevStr.colorK1);
        mat4.mul(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix, this.mtx);
        this.materialHelper.allocateDrawParamsDataOnInst(template, drawParams);

        const ddraw = this.ddraw;
        ddraw.beginDraw(globals.modelCache.cache);
        ddraw.allocPrimitives(GX.Command.DRAW_TRIANGLE_STRIP, (11 + 9 + 7 + 5 + 3 + 1) * 2);
        this.drawSide(renderInstManager, ddraw, true);
        this.drawSide(renderInstManager, ddraw, false);
        ddraw.endDraw(renderInstManager);

        renderInstManager.popTemplate();
    }

    private isPointFixed(idx: number): boolean {
        // Points 15 and 20 are fixed in place.
        return idx === 15 || idx === 20;
    }

    private get_cloth_anim_factor(dst: vec3, posArr: vec3[], nrmArr: vec3[], speed: vec3, idx: number, deltaTimeFrames: number): void {
        if (this.isPointFixed(idx)) {
            vec3.zero(dst);
            return;
        }

        vec3.scale(dst, nrmArr[idx], vec3.dot(speed, nrmArr[idx]));
        dst[1] += this.gravity * deltaTimeFrames;

        for (let i = 0; i < 5; i++) {
            const connectedIdx = this.adjTableConstraint[(idx * 6) + i];
            if (connectedIdx === -1)
                break;

            assert(connectedIdx !== idx);

            // Compute our ideal distance. Points are separated vertically in the latice by 51, and horizontally by 260.
            // This gives a horizontal distance of hypot(51, 260) ~= 264.95471311150516. For points in the same tile,
            // they are spaced 2*51, or 102, apart.

            // Points are vertically adjacent if their indexes differ by one, except for the 0..1 pair, since 0 has no
            // vertical neighbors.
            const isVertical = Math.abs(idx - connectedIdx) === 1 && !(idx === 0 || connectedIdx === 0);
            const distIdeal = isVertical ? 102 : 264.95;
            get_cloth_anim_sub_factor(dst, posArr[idx], posArr[connectedIdx], distIdeal, this.spring);
        }
    }

    private setNrmVtx(dst: vec3, idx: number): void {
        const posArr = this.posArr[this.curArr];

        vec3.zero(dst);

        // Compute normals from connectivity
        for (let i = 0; i < 5; i++) {
            const connectedIdx0 = this.adjTableNormal[(idx * 7) + i + 0];
            const connectedIdx1 = this.adjTableNormal[(idx * 7) + i + 1];
            if (connectedIdx1 === -1)
                break;

            vec3.sub(scratchVec3a, posArr[connectedIdx0], posArr[idx]);
            vec3.sub(scratchVec3b, posArr[connectedIdx1], posArr[idx]);
            vec3.cross(scratchVec3a, scratchVec3b, scratchVec3a);
            vec3.normalize(scratchVec3a, scratchVec3a);
            vec3.add(dst, dst, scratchVec3a);
        }
        vec3.normalize(dst, dst);

        // Add in a twist to make the flag curl near the edges.
        let curlRotY = 0;
        if (idx < 1)
            curlRotY = 0;
        else if (idx < 3)
            curlRotY = (1 + (idx - 1));
        else if (idx < 6)
            curlRotY = (2 + (idx - 3));
        else if (idx < 10)
            curlRotY = (3 + (idx - 6));
        else if (idx < 15)
            curlRotY = (4 + (idx - 10));
        else
            curlRotY = (5 + (idx - 15));

        const rotY = this.rot[1] + (Math.sin(curlRotY * -0x320) * 900.0);
        mDoMtx_YrotS(calc_mtx, rotY);

        MtxPosition(dst, dst);
        vec3.normalize(dst, dst);
    }

    private majuu_flag_move(globals: dGlobals, deltaTimeFrames: number): void {
        this.wave += this.waveSpeed * deltaTimeFrames;
        const windSpeed = lerp(this.windSpeed1, this.windSpeed2, Math.sin(cM_s2rad(this.wave)) * 0.5 + 0.5);
        const windpow = dKyw_get_wind_pow(globals.g_env_light);
        vec3.set(scratchVec3a, 0, 0, windSpeed * windpow * 2.0);
        mDoMtx_ZrotS(calc_mtx, -this.rot[2]);
        mDoMtx_XrotM(calc_mtx, -this.rot[0]);
        MtxPosition(scratchVec3a, scratchVec3a);

        const posArrOld = this.posArr[this.curArr];
        this.curArr ^= 1;
        const posArrNew = this.posArr[this.curArr];

        for (let idx = 0; idx < this.pointCount; idx++) {
            this.get_cloth_anim_factor(scratchVec3c, posArrOld, this.nrmArr, scratchVec3a, idx, deltaTimeFrames);
            vec3.add(this.speedArr[idx], this.speedArr[idx], scratchVec3c);
            vec3.scale(this.speedArr[idx], this.speedArr[idx], this.drag);
            vec3.scaleAndAdd(posArrNew[idx], posArrOld[idx], this.speedArr[idx], clamp(deltaTimeFrames, 0, 1));
        }

        for (let i = 0; i < this.pointCount; i++)
            this.setNrmVtx(this.nrmArr[i], i);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        super.execute(globals, deltaTimeFrames);

        const mMonotone = false;
        if (!mMonotone) {
            const windvec = dKyw_get_wind_vec(globals.g_env_light);
            let targetAngle = cM_atan2s(windvec[0], windvec[2]);
            if (this.parentMtx !== null && this.parentPos !== null) {
                transformVec3Mat4w1(scratchVec3a, this.parentMtx, Vec3UnitZ);
                targetAngle -= cM_atan2s(scratchVec3a[0], scratchVec3a[2]);
            }

            this.rot[1] = cLib_addCalcAngleS2(this.rot[1], targetAngle, 0x0008, 0x0400);
            this.majuu_flag_move(globals, deltaTimeFrames);
            this.set_mtx();
        }
    }

    private set_mtx(): void {
        if (this.parentMtx !== null && this.parentPos !== null) {
            mat4.copy(calc_mtx, this.parentMtx);
            MtxTrans(this.parentPos, true);

            mDoMtx_YrotM(calc_mtx, this.rot[1]);
            calc_mtx[14] += 6.0;
        } else {
            MtxTrans(this.pos, false);
            mDoMtx_ZXYrotM(calc_mtx, this.rot);

            if (this.flagType === 4 || this.texType !== 0) {
                calc_mtx[14] += 5.0;
            } else {
                mDoMtx_XrotM(calc_mtx, -0x05DC);
                calc_mtx[14] += 50.0;
            }
        }

        scaleMatrix(calc_mtx, calc_mtx, this.flagScale);

        mat4.copy(this.mtx, calc_mtx);
    }

    public override delete(globals: dGlobals): void {
        const device = globals.modelCache.device;
        if (this.rawTex !== null)
            this.rawTex.destroy(device);
        this.ddraw.destroy(device);
    }
}

class d_a_kamome extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_kamome;

    private type: number;
    private ko_count: number;
    private path_arg: number;
    private path_id: number = 0;
    private use_path_move: boolean = false;
    private switch_arg: number;
    private switch_id: number = 0;
    private size: number;
    private morf: mDoExt_McaMorf;
    private noDraw: boolean = false;
    private origPos = vec3.create();

    private animState: number = 0;
    private moveState: number = 0;
    private globalTimer: number = 0;
    private timer0: number = 0;
    private timer1: number = 0;
    private riseTimer: number = 0;
    private velocityFwd = 0.0;
    private velocityFwdTarget = 0.0;
    private velocityFwdTargetMaxVel = 0.0;
    private targetPos = vec3.create();

    private rotX: number = 0;
    private rotY: number = 0;
    private headRotY: number = 0;
    private headRotZ: number = 0;
    private headRotYTarget: number = 0;
    private headRotZTarget: number = 0;
    private rotVel: number = 0;
    private rotVelFade: number = 0;

    private static arcName = 'Kamome';

    public override subload(globals: dGlobals): cPhs__Status {

        let status: cPhs__Status;

        status = dComIfG_resLoad(globals, d_a_kamome.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        this.type = (this.parameters >>> 0x00) & 0xFF;
        this.ko_count = (this.parameters >>> 0x08) & 0xFF;
        this.path_arg = (this.parameters >>> 0x10) & 0xFF;
        this.switch_arg = (this.parameters >>> 0x18) & 0xFF;

        // createHeap
        const modelData = globals.resCtrl.getObjectRes(ResType.Model, d_a_kamome.arcName, 0x17);
        const anmRes = globals.resCtrl.getObjectRes(ResType.Bck, d_a_kamome.arcName, 0x12);
        this.morf = new mDoExt_McaMorf(modelData, null, null, anmRes, LoopMode.Repeat);

        if (this.path_arg !== 0xFF) {
            // dPath_GetRoomPath
        }

        if (this.switch_arg !== 0xFF)
            this.switch_id = this.switch_arg + 1;

        this.cullMtx = this.morf.model.modelMatrix;
        this.size = 1.0 + cM_rndF(1.0);
        vec3.set(this.morf.model.baseScale, this.size, this.size, this.size);
        this.daKamome_setMtx();
        vec3.copy(this.origPos, this.pos);

        return cPhs__Status.Next;
    }

    private heisou_control(globals: dGlobals): void {
        this.noDraw = true;
    }

    private kamome_imuoto_move(globals: dGlobals, deltaTimeFrames: number): void {
        this.noDraw = true;
    }

    private kamome_imuoto2_move(globals: dGlobals, deltaTimeFrames: number): void {
        this.noDraw = true;
    }

    private kamome_path_move(globals: dGlobals, deltaTimeFrames: number): void {
        // todo
    }

    private kamome_heisou_move(globals: dGlobals, deltaTimeFrames: number): void {
        // todo
    }

    private anm_init(globals: dGlobals, anmResIdx: number, morf: number, loopMode: LoopMode = LoopMode.Repeat, speedInFrames: number = 1.0): void {
        const anmRes = globals.resCtrl.getObjectRes(ResType.Bck, d_a_kamome.arcName, anmResIdx);
        this.morf.setAnm(anmRes, loopMode, morf, speedInFrames);
    }

    private kamome_pos_move(globals: dGlobals, deltaTimeFrames: number): void {
        const dx = this.targetPos[0] - this.pos[0];
        const dy = this.targetPos[1] - this.pos[1];
        const dz = this.targetPos[2] - this.pos[2];
        const rotTargetY = cM_atan2s(dx, dz);

        let rotTargetZ = this.rot[1];
        this.rot[1] = cLib_addCalcAngleS2(this.rot[1], rotTargetY, 10.0, this.rotVel * this.rotVelFade);
        rotTargetZ = (rotTargetZ - this.rot[1]) * 0x20;
        rotTargetZ = clamp(rotTargetZ, -0x157c, 0x157c);
        this.rot[2] = cLib_addCalcAngleS2(this.rot[2], rotTargetZ, 10.0, this.rotVel * this.rotVelFade * 0.5);

        const rotTargetX = -cM_atan2s(dy, Math.hypot(dx, dz));
        this.rot[0] = cLib_addCalcAngleS2(this.rot[0], rotTargetX, 10.0, this.rotVel * this.rotVelFade);

        this.rotVelFade = cLib_addCalc2(this.rotVelFade, 1.0, 1.0 * deltaTimeFrames, 0.04);
        this.velocityFwd = cLib_addCalc2(this.velocityFwd, this.velocityFwdTarget, 1.0 * deltaTimeFrames, this.velocityFwdTargetMaxVel);

        vec3.set(scratchVec3a, 0.0, 0.0, this.velocityFwd);
        mDoMtx_YrotS(calc_mtx, this.rot[1]);
        mDoMtx_XrotM(calc_mtx, this.rot[0]);
        MtxPosition(scratchVec3a, scratchVec3a);
        vec3.scaleAndAdd(this.pos, this.pos, scratchVec3a, deltaTimeFrames);

        if (this.riseTimer >= 0) {
            this.riseTimer -= deltaTimeFrames;
            this.pos[1] += 5.0 * deltaTimeFrames;
        }
    }

    private kamome_auto_move(globals: dGlobals, deltaTimeFrames: number): void {
        const animFrame = this.morf.frameCtrl.currentTimeInFrames;

        // anim
        if (this.animState === 0) {
            if (this.timer0 <= 0 && animFrame >= 9) {
                this.animState = 1;
                this.anm_init(globals, 0x12, 12.0, LoopMode.Repeat);
            }
        } else if (this.animState === 1) {
            const globalFrame = this.globalTimer | 0;
            if (((globalFrame & 0x3F) !== 0) || cM_rndF(1.0) >= 0.5) {
                if (this.timer0 <= 0.0 && this.pos[1] < this.targetPos[1]) {
                    this.animState = 0;
                    this.timer0 = cM_rndF(60.0) + 20.0;
                    this.anm_init(globals, 0x13, 5.0);
                }
            } else {
                this.globalTimer = cM_rndF(10000.0);
                this.animState = 2;
                this.anm_init(globals, 0x10, 5.0, LoopMode.Once);
            }
        } else if (this.animState === 2) {
            if (this.morf.frameCtrl.hasStopped()) {
                this.animState = 1;
                this.anm_init(globals, 0x12, 5.0, LoopMode.Repeat);
            }
        } else if (this.animState === 20) {
            if (this.morf.frameCtrl.hasStopped()) {
                this.animState = 0;
                this.timer0 = cM_rndF(60.0) + 20.0;
                this.anm_init(globals, 0x13, 5.0);
            }
        }

        // movement
        if (this.moveState === 0) {
            if (this.timer1 <= 0) {
                const dx = cM_rndFX(1000.0);
                const dz = cM_rndFX(1000.0);
                // check new random pos distance?

                this.timer1 = cM_rndF(150.0) + 50.0;
                this.targetPos[0] = this.origPos[0] + dx;
                this.targetPos[1] = this.origPos[1] + cM_rndF(500.0);
                this.targetPos[2] = this.origPos[2] + dz;

                this.rotVelFade = 0.0;
                this.rotVel = cM_rndF(300.0) + 200.0;

                if (this.targetPos[1] <= this.pos[1]) {
                    this.velocityFwdTarget = 36.0;
                    this.velocityFwdTargetMaxVel = 0.5;
                } else {
                    this.velocityFwdTarget = 20.0;
                    this.velocityFwdTargetMaxVel = 0.2;
                }

                // search_esa
            }
        }

        this.kamome_pos_move(globals, deltaTimeFrames);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.noDraw = false;

        if (this.type === 6) {
            this.heisou_control(globals);
            return;
        }

        if (this.switch_id !== 0) {
            // test switch
        }

        // update timers
        this.globalTimer += deltaTimeFrames;
        this.timer0 = Math.max(this.timer0 - deltaTimeFrames, 0);
        this.timer1 = Math.max(this.timer1 - deltaTimeFrames, 0);

        if (this.use_path_move) {
            this.kamome_path_move(globals, deltaTimeFrames);
        } if (this.type === 4) {
            this.kamome_imuoto_move(globals, deltaTimeFrames);
        } else if (this.type === 5) {
            this.kamome_imuoto2_move(globals, deltaTimeFrames);
        } else if (this.type === 7) {
            this.kamome_heisou_move(globals, deltaTimeFrames);
        } else {
            this.kamome_auto_move(globals, deltaTimeFrames);
        }

        this.morf.play(deltaTimeFrames);
        this.headRotY = cLib_addCalcAngleS2(this.headRotY, this.headRotYTarget, 4, 0x800);
        this.headRotZ = cLib_addCalcAngleS2(this.headRotZ, this.headRotZTarget, 4, 0x800);
        this.daKamome_setMtx();
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.noDraw || this.switch_id !== 0)
            return;

        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        setLightTevColorType(globals, this.morf.model, this.tevStr, viewerInput.camera);
        this.morf.entryDL(globals, renderInstManager, viewerInput);

        // drawWorldSpaceLine(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, this.targetPos, Green, 2);
        // drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, Magenta, 8);
        // drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.targetPos, Yellow, 6);

        // shadow
    }

    private nodeCallBack = (dst: mat4, modelData: J3DModelData, i: number) => {
        if (i === 8) {
            mDoMtx_YrotM(dst, this.headRotY);
            mDoMtx_ZrotM(dst, this.headRotZ);
        }
    };

    private daKamome_setMtx(): void {
        MtxTrans(this.pos, false);
        mDoMtx_YrotM(calc_mtx, this.rot[1] + this.rotY);
        mDoMtx_XrotM(calc_mtx, this.rot[0] + this.rotX);
        mDoMtx_ZrotM(calc_mtx, this.rot[2]);
        mat4.copy(this.morf.model.modelMatrix, calc_mtx);
        this.morf.model.jointMatrixCalcCallback = this.nodeCallBack;
        this.morf.calc();
    }
}

type ModeFunc = (globals: dGlobals, deltaTimeFrames: number) => void;
interface ModeFuncExec<T extends number> {
    curMode: T;
}

function modeProcExec<T extends number>(globals: dGlobals, actor: ModeFuncExec<T>, mode_tbl: ModeFunc[], deltaTimeFrames: number): void {
    const func = mode_tbl[actor.curMode * 2 + 1];
    func.call(actor, globals, deltaTimeFrames);
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

const enum d_a_obj_ikada_mode { wait, stopTerry, pathMoveTerry }
class d_a_obj_ikada extends fopAc_ac_c implements ModeFuncExec<d_a_obj_ikada_mode> {
    public static PROCESS_NAME = dProcName_e.d_a_obj_ikada;

    private type: number;
    private path_id: number;
    private model: J3DModelInstance;
    private flagPcId: number | null = null;
    private bckAnm = new mDoExt_bckAnm();
    private path: dPath | null = null;
    private waveAnim1Timer = 0;
    private linkRideRockTimer = 0;
    private linkRideRockAmpl = 0;
    private wave = new dLib_wave_c();

    private craneMode: boolean = false;
    private velocityFwd: number = 0.0;
    private velocityFwdTarget: number = 0.0;
    private pathMovePos = vec3.create();
    private curPathPointIdx: number = 0;
    private curPathP0 = vec3.create();
    private curPathP1 = vec3.create();
    private pathRotY: number;

    public curMode = d_a_obj_ikada_mode.wait;

    private splash: dPa_splashEcallBack | null = null;
    private waveL: dPa_waveEcallBack | null = null;
    private waveR: dPa_waveEcallBack | null = null;
    private wavePos = vec3.create();
    private waveRot = vec3.create();
    private track: dPa_trackEcallBack | null = null;
    private trackPos = vec3.create();

    private static arcName = `IkadaH`;

    public override subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, d_a_obj_ikada.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        this.type = this.parameters & 0x0F;

        if (this.type === 4) {
            this.path_id = (this.type >>> 16) & 0xFF;
        } else {
            const rx = this.rot[0];
            this.path_id = (rx >>> 8) & 0xFF;
        }

        // _createHeap
        const bdl = [0x08, 0x0B, 0x09, 0x0C, 0x0A];
        const modelData = resCtrl.getObjectRes(ResType.Model, d_a_obj_ikada.arcName, bdl[this.type]);
        this.model = new J3DModelInstance(modelData);

        if (this.type === 4) {
            const bckRes = resCtrl.getObjectRes(ResType.Bck, d_a_obj_ikada.arcName, 0x05);
            this.bckAnm.init(modelData, bckRes, true, LoopMode.Repeat);

            this.model.jointMatrixCalcCallback = this.nodeControl_CB;
        }

        this.setMtx(globals, 0.0);

        // initialize BgW

        // createInit
        vec3.copy(this.pathMovePos, this.pos);
        this.pathRotY = this.rot[1];

        if (this.isShip() && this.path_id !== 0xFF) {
            this.path = assertExists(dPath_GetRoomPath(globals, this.path_id, this.roomNo));
        }

        if (this.isTerry())
            modeProcInit(globals, this, this.mode_tbl, d_a_obj_ikada_mode.stopTerry);

        if (this.isShip()) {
            this.splash = new dPa_splashEcallBack(globals);
            this.waveL = new dPa_waveEcallBack(globals);
            this.waveR = new dPa_waveEcallBack(globals);
            this.track = new dPa_trackEcallBack(globals);
            this.createWave(globals);
        }

        this.cullMtx = this.model.modelMatrix;
        const scaleX = this.scale[0];
        this.setCullSizeBox(scaleX * -1000.0, scaleX * -50.0, scaleX * -1000.0, scaleX * 1000.0, scaleX * 1000.0, scaleX * 1000.0);
        this.cullFarDistanceRatio = 10.0;

        if (this.type === 0 || this.type === 4) {
            const flagParam = this.type === 0 ? 0x00000004 : 0x02000000;
            this.flagPcId = fopAcM_create(globals.frameworkGlobals, dProcName_e.d_a_majuu_flag, flagParam, this.pos, this.roomNo, this.rot, null, 0xFF, this.processId);
        }

        dLib_waveInit(globals, this.wave, this.pos);

        // initialize rope / ropeEnd

        return cPhs__Status.Next;
    }

    private nodeControl_CB(): void {
    }

    private isSv(): boolean {
        return this.type === 4;
    }

    private isTerry(): boolean {
        return this.type === 1 || this.type === 4;
    }

    private isShip(): boolean {
        return this.isSv() || this.isTerry();
    }

    private setMtx(globals: dGlobals, deltaTimeFrames: number): void {
        dLib_waveRot(globals, this.wave, this.pos, 0.0, deltaTimeFrames);
        vec3.copy(this.model.baseScale, this.scale);

        const waveAnim1 = Math.sin(cM_s2rad(this.waveAnim1Timer));
        const waveAnim1X = 0xC8 * waveAnim1;
        const waveAnim1Z = 0x3C * waveAnim1;

        const rockAnimAmpl = Math.sin(this.linkRideRockTimer) * this.linkRideRockAmpl;
        const rockAnimTheta = Math.cos(cM_s2rad(this.rot[1]));
        const rockAnimX = rockAnimAmpl * Math.cos(rockAnimTheta);
        const rockAnimZ = rockAnimAmpl * Math.sin(rockAnimTheta);

        this.rot[0] = this.wave.rotX + waveAnim1X + rockAnimX;
        this.rot[2] = this.wave.rotZ + waveAnim1Z + rockAnimZ;

        MtxTrans(this.pos, false);
        mDoMtx_XrotM(calc_mtx, this.rot[0]);
        mDoMtx_ZrotM(calc_mtx, this.rot[2]);
        mDoMtx_YrotM(calc_mtx, this.rot[1]);

        if (this.isSv()) {
            calc_mtx[13] += 30.0;
            calc_mtx[14] += -260.0;
        }

        mat4.copy(this.model.modelMatrix, calc_mtx);

        if (this.isSv()) {
            // TODO(jstpierre): Sv

            /*
            MtxTrans(this.pos, false);
            mDoMtx_XrotM(calc_mtx, this.rot[0]);
            mDoMtx_ZrotM(calc_mtx, this.rot[2]);
            mDoMtx_YrotM(calc_mtx, this.rot[1]);
            mDoMtx_YrotM(calc_mtx, 0x4000);

            for (let i = 0; i < 4; i++) {
            }
            */
        }

        if (this.isTerry()) {
            // Light
        }

        if (this.isShip()) {
            MtxTrans(this.pos, false);
            mDoMtx_XrotM(calc_mtx, this.rot[0]);
            mDoMtx_ZrotM(calc_mtx, this.rot[2]);
            mDoMtx_YrotM(calc_mtx, this.rot[1]);
            // attn/eye

            if (this.isTerry()) {
                const waveOffsZ = 660.0 + (this.curMode === d_a_obj_ikada_mode.pathMoveTerry ? 20.0 : 5.0);
                const waveOffsY = 20.0;
                vec3.set(this.wavePos, 0.0, waveOffsY, waveOffsZ);
                MtxPosition(this.wavePos);

                const trackOffsZ = -180.0;
                vec3.set(this.trackPos, 0.0, 0.0, trackOffsZ);
                MtxPosition(this.trackPos);
            }
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);

        if (this.isSv()) {
            // update bck
        }

        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);

        if (this.isSv()) {
            // rope, rope end
        }
    }

    private modeWaitInit(globals: dGlobals): void {
    }

    private modeWait(globals: dGlobals, deltaTimeFrames: number): void {
    }

    private modeStopTerryInit(globals: dGlobals): void {
        // this.timer = 210;
    }

    private modeStopTerry(globals: dGlobals, deltaTimeFrames: number): void {
        // stop for player, check tg hit
        modeProcInit(globals, this, this.mode_tbl, d_a_obj_ikada_mode.pathMoveTerry);
    }

    private modePathMoveTerryInit(globals: dGlobals): void {
        // this.timer = 10;
    }

    private modePathMoveTerry(globals: dGlobals, deltaTimeFrames: number): void {
        // setCollision()
        // checkTgHit()
        if (this.type === 1)
            this.velocityFwdTarget = 12.0;
        else if (this.type === 3)
            this.velocityFwdTarget = 15.0;

        this.linkRideRockTimer = this.linkRideRockTimer + 0x1830 * deltaTimeFrames;
        this.linkRideRockAmpl = cLib_addCalcAngleS2(this.linkRideRockAmpl, 0, 10, 10 * deltaTimeFrames);
        if (this.linkRideRockAmpl <= 10)
            this.linkRideRockAmpl = 0;

        // check distance to player, stop if they get near
        if (this.path !== null)
            this.pathMove(globals, deltaTimeFrames);
    }

    private pathMove_CB = (dst: vec3, curr: dPath__Point, next: dPath__Point, deltaTimeFrames: number): boolean => {
        this.craneMode = (next.arg3 !== 0xFF);

        vec3.copy(this.curPathP0, curr.pos);
        this.curPathP0[1] = this.pos[1];
        vec3.copy(this.curPathP1, next.pos);
        this.curPathP1[1] = this.pos[1];

        vec3.sub(scratchVec3a, this.curPathP1, this.curPathP0);
        vec3.normalize(scratchVec3a, scratchVec3a);

        const rotTargetY = cM_atan2s(scratchVec3a[0], scratchVec3a[2]);
        this.pathRotY = cLib_addCalcAngleS(this.pathRotY, rotTargetY, 8, 0x200 * deltaTimeFrames, 8);
        const fwdSpeed = this.velocityFwd * deltaTimeFrames * Math.cos(cM_s2rad(rotTargetY - this.pathRotY));
        cLib_chasePosXZ(dst, this.curPathP1, fwdSpeed);

        return cLib_distanceSqXZ(dst, this.curPathP1) < fwdSpeed ** 2.0;
    };

    private pathMove(globals: dGlobals, deltaTimeFrames: number): void {
        this.velocityFwd = cLib_addCalc2(this.velocityFwd, this.velocityFwdTarget, 0.1, 2.0 * deltaTimeFrames);
        this.curPathPointIdx = dLib_pathMove(this.pathMovePos, this.curPathPointIdx, this.path!, deltaTimeFrames, this.pathMove_CB);

        cLib_addCalcPosXZ2(this.pos, this.pathMovePos, 0.01, this.velocityFwd * deltaTimeFrames);
        if (this.velocityFwd !== 0 && this.velocityFwdTarget !== 0) {
            const rotTargetY = cLib_targetAngleY(this.pos, this.pathMovePos);
            this.rot[1] = cLib_addCalcAngleS2(this.rot[1], rotTargetY, 8, 0x100 * deltaTimeFrames);
        }
    }

    private mode_tbl = [
        this.modeWaitInit, this.modeWait,
        this.modeStopTerryInit, this.modeStopTerry,
        this.modePathMoveTerryInit, this.modePathMoveTerry,
    ];

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        super.execute(globals, deltaTimeFrames);

        this.waveAnim1Timer += 0x200 * deltaTimeFrames;

        modeProcExec(globals, this, this.mode_tbl, deltaTimeFrames);
        this.pos[1] = dLib_getWaterY(globals, this.pos, null);

        this.setMtx(globals, deltaTimeFrames);
        this.model.calcAnim();

        if (this.isShip()) {
            if (this.velocityFwd > 2.0 && this.cullingCheck(globals.camera)) {
                this.setWave(globals, deltaTimeFrames);
            } else {
                this.waveL!.remove();
                this.waveR!.remove();
                this.splash!.remove();
                this.track!.state = 1;
            }
        }

        if (this.flagPcId !== null) {
            const flag = fopAcIt_JudgeByID<d_a_majuu_flag>(globals.frameworkGlobals, this.flagPcId);
            if (flag !== null && flag.parentMtx === null) {
                flag.parentMtx = this.model.modelMatrix;
                if (this.type === 0)
                    flag.parentPos = vec3.fromValues(0.0, 700.0, 0.0);
                else if (this.type === 4)
                    flag.parentPos = vec3.fromValues(100.0, 530.0, 0.0);
            }
        }
    }

    private createWave(globals: dGlobals): void {
        if (this.waveL !== null && this.waveL.emitter === null) {
            const emitter = globals.particleCtrl.set(globals, 0, 0x0037, this.wavePos, this.waveRot, null, 1.0, this.waveL);
            if (emitter !== null)
                vec3.set(emitter.localDirection, 0.5, 1.0, -0.3);
        }

        if (this.waveR !== null && this.waveR.emitter === null) {
            const emitter = globals.particleCtrl.set(globals, 0, 0x0037, this.wavePos, this.waveRot, null, 1.0, this.waveR);
            if (emitter !== null)
                vec3.set(emitter.localDirection, -0.5, 1.0, -0.3);
        }

        if (this.splash !== null && this.splash.emitter === null)
            globals.particleCtrl.set(globals, 0, 0x0035, this.wavePos, this.waveRot, null, 1.0, this.splash);

        if (this.track !== null && this.track.emitter === null) {
            const emitter = globals.particleCtrl.set(globals, 5, 0x0036, this.trackPos, this.rot, null, 0.0, this.track);
            if (emitter !== null) {
                vec3.set(emitter.globalDynamicsScale, 1.0, 1.0, 1.0);
                vec2.set(emitter.globalParticleScale, 1.0, 1.0);
            }
        }
    }

    private static waveCollapsePos = [
        vec3.fromValues(-80.0, -50.0, -150.0),
        vec3.fromValues(-40.0, -100.0, -350.0),
    ];

    private setWave(globals: dGlobals, deltaTimeFrames: number): void {
        let splashScaleTarget = 200.0;
        let waveVelFade = 2.0;

        if (this.velocityFwd > 2.0) {
            this.createWave(globals);
        } else {
            splashScaleTarget = 0.0;
            waveVelFade = 0.0;
            if (this.track !== null)
                this.track.state = 1;
        }

        this.wavePos[1] = dLib_getWaterY(globals, this.wavePos, null);
        this.waveRot[1] = this.rot[1];

        if (this.track !== null && this.track.emitter !== null) {
            this.track.indTransY = -0.04;
            this.track.indScaleY = 4.0;
            this.track.vel = 300.0;
            this.track.baseY = this.wavePos[1];
            // mObjAcch
            this.track.minVel = 3.0;
        }

        if (this.waveL !== null) {
            this.waveL.velFade1 = waveVelFade;
            this.waveL.velFade2 = 1.0;
            this.waveL.velSpeed = 2.0;
            this.waveL.maxParticleVelocity = 15.0;
            vec3.copy(this.waveL.collapsePos[0], d_a_obj_ikada.waveCollapsePos[0]);
            vec3.copy(this.waveL.collapsePos[1], d_a_obj_ikada.waveCollapsePos[1]);
        }

        if (this.waveR !== null) {
            this.waveR.velFade1 = waveVelFade;
            this.waveR.velFade2 = 1.0;
            this.waveR.velSpeed = 2.0;
            this.waveR.maxParticleVelocity = 15.0;
            vec3.copy(this.waveR.collapsePos[0], d_a_obj_ikada.waveCollapsePos[0]);
            vec3.copy(this.waveR.collapsePos[1], d_a_obj_ikada.waveCollapsePos[1]);
            this.waveR.collapsePos[0][0] *= -1.0;
            this.waveR.collapsePos[1][0] *= -1.0;
        }

        if (this.splash !== null) {
            this.splash.scaleTimer = cLib_addCalc2(this.splash.scaleTimer, splashScaleTarget, 0.1, 10.0 * deltaTimeFrames);
            this.splash.maxScaleTimer = 300.0;
        }
    }

    public override delete(globals: dGlobals): void {
        super.delete(globals);

        if (this.splash !== null)
            this.splash.remove();
        if (this.waveL !== null)
            this.waveL.remove();
        if (this.waveR !== null)
            this.waveR.remove();
        if (this.track !== null)
            this.track.remove();
    }
}

const enum d_a_oship_mode { wait, attack, damage, delete, rangeA, rangeB, rangeC, rangeD }
class d_a_oship extends fopAc_ac_c implements ModeFuncExec<d_a_oship_mode> {
    public static PROCESS_NAME = dProcName_e.d_a_oship;

    private subMode: number;
    private model: J3DModelInstance;
    private path: dPath | null = null;
    private effectMtx = mat4.create();
    private flagPcId: number | null = null;
    private wave = new dLib_wave_c();
    private splash: dPa_splashEcallBack;
    private waveL: dPa_waveEcallBack;
    private waveR: dPa_waveEcallBack;
    private track: dPa_trackEcallBack;
    private wavePos = vec3.create();
    private waveRot = vec3.create();
    private trackPos = vec3.create();

    private attackSwayAmount = 0;
    private attackSwayTimer = 0;
    private attackTimer = 0;
    private attackBadAimCounter = 0;
    private targetPos = vec3.create();
    private aimRotXTarget = 0;
    private aimRotYTarget = 0;
    private aimRotX = 0;
    private aimRotY = 0;

    private velocityFwd = 0.0;
    private velocityFwdTarget = 0.0;
    private pathMovePos = vec3.create();
    private pathRotY = 0;
    private curPathPointIdx = 0;
    private curPathP0 = vec3.create();
    private curPathP1 = vec3.create();

    public curMode: d_a_oship_mode = d_a_oship_mode.wait;

    public override subload(globals: dGlobals): cPhs__Status {
        const arcName = `Oship`;

        const status = dComIfG_resLoad(globals, arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        this.subMode = this.parameters & 0xFF;
        const triforce = (this.parameters >>> 8) & 0x0F;
        const fmapIdx = (this.parameters >>> 12) & 0x0F;
        const pathId = (this.parameters >>> 16) & 0xFF;
        const switchA = (this.parameters >>> 24) & 0xFF;
        const switchB = (this.rot[0] >>> 0) & 0xFF;
        const modelType = (this.rot[0] >>> 8) & 0xFF;
        this.rot[0] = 0;

        let bdl = 3;
        if (modelType !== 0xFF)
            bdl = 4;

        const resCtrl = globals.resCtrl;
        const modelData = resCtrl.getObjectRes(ResType.Model, arcName, bdl);
        this.model = new J3DModelInstance(modelData);
        this.model.jointMatrixCalcCallback = this.nodeControl;

        for (let i = 0; i < this.model.materialInstances.length; i++)
            this.model.materialInstances[i].effectMtx = this.effectMtx;

        if (modelType === 0xFF)
            this.flagPcId = fopAcM_create(globals.frameworkGlobals, dProcName_e.d_a_majuu_flag, 0x04, this.pos, this.roomNo, this.rot, null, 0xFF, this.processId);

        if (pathId !== 0xFF)
            this.path = assertExists(dPath_GetRoomPath(globals, pathId, this.roomNo));

        this.changeModeByRange(globals);
        dLib_waveInit(globals, this.wave, this.pos);
        this.setMtx(globals, 0.0);
        this.cullMtx = this.model.modelMatrix;
        this.setCullSizeBox(-300.0, -100.0, -650.0, 300.0, 700.0, 800.0);
        this.cullFarDistanceRatio = 10.0;

        this.splash = new dPa_splashEcallBack(globals);
        this.waveL = new dPa_waveEcallBack(globals);
        this.waveR = new dPa_waveEcallBack(globals);
        this.track = new dPa_trackEcallBack(globals);

        return cPhs__Status.Next;
    }

    private mode_tbl = [
        this.modeWaitInit, this.modeWait,
        this.modeAttackInit, this.modeAttack,
        this.modeDamageInit, this.modeDamage,
        this.modeDeleteInit, this.modeDelete,
        this.modeRangeAInit, this.modeRangeA,
        this.modeRangeBInit, this.modeRangeB,
        this.modeRangeCInit, this.modeRangeC,
        this.modeRangeDInit, this.modeRangeD,
    ];

    private changeModeByRange(globals: dGlobals): void {
        const dist = cLib_distanceXZ(this.pos, globals.cameraPosition);
        let mode = this.curMode;
        if (dist < 2500.0)
            mode = d_a_oship_mode.rangeA;
        else if (dist < 6000.0)
            mode = d_a_oship_mode.rangeB;
        else if (dist < 12000.0)
            mode = d_a_oship_mode.rangeC;
        else
            mode = d_a_oship_mode.rangeD;

        if (mode !== this.curMode)
            modeProcInit(globals, this, this.mode_tbl, mode);
    }

    private checkTgHit(globals: dGlobals): boolean {
        return false;
    }

    private pathMove_CB = (dst: vec3, curr: dPath__Point, next: dPath__Point, deltaTimeFrames: number): boolean => {
        vec3.copy(this.curPathP0, curr.pos);
        this.curPathP0[1] = this.pos[1];
        vec3.copy(this.curPathP1, next.pos);
        this.curPathP1[1] = this.pos[1];

        vec3.sub(scratchVec3a, this.curPathP1, this.curPathP0);
        vec3.normalize(scratchVec3a, scratchVec3a);

        const rotTargetY = cM_atan2s(scratchVec3a[0], scratchVec3a[2]);
        this.pathRotY = cLib_addCalcAngleS(this.pathRotY, rotTargetY, 8, 0x200 * deltaTimeFrames, 8);
        const fwdSpeed = this.velocityFwd * deltaTimeFrames * Math.cos(cM_s2rad(rotTargetY - this.pathRotY));
        cLib_chasePosXZ(dst, this.curPathP1, fwdSpeed);

        return cLib_distanceSqXZ(dst, this.curPathP1) < fwdSpeed ** 2.0;
    };

    private pathMove(globals: dGlobals, deltaTimeFrames: number): void {
        this.velocityFwd = cLib_addCalc2(this.velocityFwd, this.velocityFwdTarget, 0.1, 2.0 * deltaTimeFrames);
        this.curPathPointIdx = dLib_pathMove(this.pathMovePos, this.curPathPointIdx, this.path!, deltaTimeFrames, this.pathMove_CB);

        cLib_addCalcPosXZ2(this.pos, this.pathMovePos, 0.01, this.velocityFwd * deltaTimeFrames);
        if (this.velocityFwd !== 0 && this.velocityFwdTarget !== 0) {
            const rotTargetY = cLib_targetAngleY(this.pos, this.pathMovePos);
            this.rot[1] = cLib_addCalcAngleS2(this.rot[1], rotTargetY, 8, 0x100 * deltaTimeFrames);
        }
    }

    private calcY(globals: dGlobals): void {
        // TODO(jstpierre): Acch
        this.pos[1] = dLib_getWaterY(globals, this.pos, null);
    }

    private rangePathMove(globals: dGlobals, deltaTimeFrames: number): void {
        if (this.path !== null) {
            this.velocityFwdTarget = 20.0;
            this.pathMove(globals, deltaTimeFrames);
        }
    }

    private plFireRepeat(globals: dGlobals): boolean {
        return false;
    }

    private modeWaitInit(globals: dGlobals): void {
        this.changeModeByRange(globals);
    }

    private modeWait(globals: dGlobals, deltaTimeFrames: number): void {
        this.changeModeByRange(globals);
    }

    private modeAttackInit(globals: dGlobals): void {
        this.attackTimer = -1;

        vec3.copy(this.targetPos, globals.cameraPosition);

        // Aim at our target.

        const distXZ = cLib_distanceXZ(this.targetPos, this.pos);
        const badAimStart = 3500.0;
        let badAimRadius = 300.0 + Math.max((distXZ - badAimStart) * 0.5, 0.0);

        if (cM_rndF(100.0) < 10.0) {
            // 10% change of perfect aim.
            badAimRadius = 0.0;
        }

        if (this.attackBadAimCounter < 6) {
            // With each bullet the player fires, the aim gets better.
            badAimRadius += (6 - this.attackBadAimCounter) * 500;
        }

        const angleY = cLib_targetAngleY(this.pos, this.targetPos);
        // TODO(jstpierre): Figure out the bad aim system.
        // this.targetPos[0] -= badAimRadius * Math.sin(cM_s2rad(angleY));
        // this.targetPos[2] -= badAimRadius * Math.cos(cM_s2rad(angleY));
    }

    private attackCannon(globals: dGlobals): boolean {
        // TODO(jstpierre): spawn bomb
        return true;
    }

    private modeAttack(globals: dGlobals, deltaTimeFrames: number): void {
        if (this.path !== null) {
            this.velocityFwdTarget = 0.0;
            this.pathMove(globals, deltaTimeFrames);
        }

        if (this.checkTgHit(globals))
            return;

        this.calcY(globals);

        if (this.attackTimer >= 0.0) {
            this.attackTimer -= deltaTimeFrames;
            if (this.attackTimer <= 0.0) {
                this.changeModeByRange(globals);
            } else {
                this.attackSwayTimer += 0x1830 * deltaTimeFrames;
                this.attackSwayAmount = cLib_addCalcAngleS2(this.attackSwayAmount, 0, 10, 10 * deltaTimeFrames);
            }
        } else {
            this.attackTimer = -1;

            // lineCheck
            if (this.velocityFwd <= 2.0) {
                if (this.attackCannon(globals)) {
                    this.attackTimer = 15;
                    this.attackSwayAmount = 100;
                }
            }
        }
    }

    private modeDamageInit(globals: dGlobals): void {
    }

    private modeDamage(globals: dGlobals, deltaTimeFrames: number): void {
    }

    private modeDeleteInit(globals: dGlobals): void {
    }

    private modeDelete(globals: dGlobals, deltaTimeFrames: number): void {
    }

    private modeRangeAInit(globals: dGlobals): void {
        this.attackTimer = 30;
    }

    private rangeTargetCommon(globals: dGlobals, deltaTimeFrames: number): void {
        vec3.copy(this.targetPos, globals.cameraPosition);
        this.calcY(globals);

        if (this.checkTgHit(globals))
            return;
        if (this.plFireRepeat(globals))
            return;

        this.attackTimer -= deltaTimeFrames;
        if (this.attackTimer <= 0.0)
            modeProcInit(globals, this, this.mode_tbl, d_a_oship_mode.attack);
        else
            this.changeModeByRange(globals);
    }

    private modeRangeA(globals: dGlobals, deltaTimeFrames: number): void {
        if (this.subMode === 1 || this.subMode === 2)
            this.rangePathMove(globals, deltaTimeFrames);

        this.rangeTargetCommon(globals, deltaTimeFrames);
    }

    private modeRangeBInit(globals: dGlobals): void {
        this.attackTimer = this.subMode === 0 ? 30 : 200;
    }

    private modeRangeB(globals: dGlobals, deltaTimeFrames: number): void {
        this.modeRangeA(globals, deltaTimeFrames);
    }

    private modeRangeCInit(globals: dGlobals): void {
        this.attackTimer = 200;
    }

    private modeRangeC(globals: dGlobals, deltaTimeFrames: number): void {
        if (this.subMode === 2)
            this.rangePathMove(globals, deltaTimeFrames);

        this.rangeTargetCommon(globals, deltaTimeFrames);
    }

    private modeRangeDInit(globals: dGlobals): void {
    }

    private modeRangeD(globals: dGlobals, deltaTimeFrames: number): void {
        if (!this.checkTgHit(globals)) {
            if (this.subMode === 2)
                this.rangePathMove(globals, deltaTimeFrames);
            this.calcY(globals);
            this.changeModeByRange(globals);
        }
    }

    private nodeControl = (dst: mat4, modelData: J3DModelData, i: number): void => {
        if (i === 1)
            mDoMtx_XrotM(dst, this.aimRotY);
        else if (i === 2)
            mDoMtx_ZrotM(dst, -this.aimRotX + 0x2800);
    };

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.cullingCheck(viewerInput.camera))
            return;

        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        const specScale = 0.75;
        dDlst_texSpecmapST(this.effectMtx, globals, this.pos, this.tevStr, specScale);
        mDoExt_modelEntryDL(globals, this.model, renderInstManager, viewerInput);

        /*
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, `PId: ${this.processId}`, 0, White, { outline: 2 });
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, `Mode: ${d_a_oship_mode[this.curMode]}`, 14, White, { outline: 2 });
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, `Aim  : ${hexzero0x(this.aimRotX, 4)} ${hexzero0x(this.aimRotY, 4)}`, 14*2, White, { outline: 2 });
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, `Aim T: ${hexzero0x(this.aimRotXTarget, 4)} ${hexzero0x(this.aimRotYTarget, 4)}`, 14*3, White, { outline: 2 });
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, `Tgt  : ${this.targetPos[0].toFixed(2)} ${this.targetPos[1].toFixed(2)} ${this.targetPos[2].toFixed(2)}`, 14*4, White, { outline: 2 });
        drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.targetPos, Green, 10);
        */
    }

    private setMtx(globals: dGlobals, deltaTimeFrames: number): void {
        dLib_waveRot(globals, this.wave, this.pos, this.attackSwayAmount, deltaTimeFrames);

        const angleY = this.rot[1] + cLib_targetAngleY(this.pos, globals.cameraPosition);
        const swayAmount = Math.sin(cM_s2rad(this.attackSwayTimer)) * (this.attackSwayAmount * 10);

        if (this.curMode !== d_a_oship_mode.delete) {
            this.rot[0] = this.wave.rotX + Math.cos(angleY) * swayAmount;
            this.rot[2] = this.wave.rotZ + Math.sin(angleY) * swayAmount;
        }

        vec3.copy(this.model.baseScale, this.scale);
        MtxTrans(this.pos, false);
        mDoMtx_XrotM(calc_mtx, this.rot[0]);
        mDoMtx_ZrotM(calc_mtx, this.rot[2]);
        mDoMtx_YrotM(calc_mtx, this.rot[1]);
        mat4.copy(this.model.modelMatrix, calc_mtx);

        const waveOffsZ = 380.0;
        vec3.set(this.wavePos, 0.0, 0.0, waveOffsZ);
        MtxPosition(this.wavePos);

        const trackOffsZ = 0.0;
        vec3.set(this.trackPos, 0.0, 0.0, trackOffsZ);
        MtxPosition(this.trackPos);
    }

    private createWave(globals: dGlobals): void {
        if (this.waveL.emitter === null) {
            const emitter = globals.particleCtrl.set(globals, 0, 0x0037, this.wavePos, this.waveRot, null, 1.0, this.waveL);
            if (emitter !== null)
                vec3.set(emitter.localDirection, 0.5, 1.0, -0.3);
        }

        if (this.waveR.emitter === null) {
            const emitter = globals.particleCtrl.set(globals, 0, 0x0037, this.wavePos, this.waveRot, null, 1.0, this.waveR);
            if (emitter !== null)
                vec3.set(emitter.localDirection, -0.5, 1.0, -0.3);
        }

        if (this.splash.emitter === null)
            globals.particleCtrl.set(globals, 0, 0x0035, this.wavePos, this.waveRot, null, 1.0, this.splash);

        if (this.track.emitter === null) {
            const emitter = globals.particleCtrl.set(globals, 5, 0x0036, this.trackPos, this.rot, null, 0.0, this.track);
            if (emitter !== null) {
                vec3.set(emitter.globalDynamicsScale, 3.0, 3.0, 3.0);
                vec2.set(emitter.globalParticleScale, 3.0, 3.0);
            }
        }
    }

    private static waveCollapsePos = [
        vec3.fromValues(-80.0, -50.0, -150.0),
        vec3.fromValues(-40.0, -100.0, -350.0),
    ];

    private setWave(globals: dGlobals, deltaTimeFrames: number): void {
        let splashScaleTarget = 200.0;
        let waveVelFade = 2.0;

        if (this.velocityFwd > 2.0 && this.curMode !== d_a_oship_mode.delete) {
            this.createWave(globals);
        } else {
            splashScaleTarget = 0.0;
            waveVelFade = 0.0;
            if (this.track !== null)
                this.track.state = 1;
        }

        this.wavePos[1] = dLib_getWaterY(globals, this.wavePos, null);
        this.waveRot[1] = this.rot[1];

        if (this.track.emitter !== null) {
            this.track.indTransY = -0.04;
            this.track.indScaleY = 4.0;
            this.track.vel = 300.0;
            this.track.baseY = this.wavePos[1];
            // mObjAcch
            this.track.minVel = 3.0;
        }

        this.waveL.velFade1 = waveVelFade;
        this.waveL.velFade2 = 1.0;
        this.waveL.velSpeed = 2.0;
        this.waveL.maxParticleVelocity = 15.0;
        vec3.copy(this.waveL.collapsePos[0], d_a_oship.waveCollapsePos[0]);
        vec3.copy(this.waveL.collapsePos[1], d_a_oship.waveCollapsePos[1]);

        this.waveR.velFade1 = waveVelFade;
        this.waveR.velFade2 = 1.0;
        this.waveR.velSpeed = 2.0;
        this.waveR.maxParticleVelocity = 15.0;
        vec3.copy(this.waveR.collapsePos[0], d_a_oship.waveCollapsePos[0]);
        vec3.copy(this.waveR.collapsePos[1], d_a_oship.waveCollapsePos[1]);
        this.waveR.collapsePos[0][0] *= -1.0;
        this.waveR.collapsePos[1][0] *= -1.0;

        this.splash.scaleTimer = cLib_addCalc2(this.splash.scaleTimer, splashScaleTarget, 0.1, 10.0 * deltaTimeFrames);
        this.splash.maxScaleTimer = 300.0;
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        // TODO(jstpierre): smoke
        // TODO(jstpierre): bomb

        this.aimRotYTarget = cLib_targetAngleY(this.pos, this.targetPos) - this.rot[1];
        this.aimRotXTarget = cLib_targetAngleX(this.pos, this.targetPos);
        // TODO(jstpierre): Add on bad aim rot

        this.aimRotX = cLib_addCalcAngleS2(this.aimRotX, this.aimRotXTarget, 6, 0x300 * deltaTimeFrames);
        this.aimRotY = cLib_addCalcAngleS2(this.aimRotY, this.aimRotYTarget, 6, 0x300 * deltaTimeFrames);
        modeProcExec(globals, this, this.mode_tbl, deltaTimeFrames);

        this.model.calcAnim();
        this.setMtx(globals, deltaTimeFrames);

        this.visible
        if (this.velocityFwd > 2.0 && this.cullingCheck(globals.camera)) {
            this.setWave(globals, deltaTimeFrames);
        } else {
            this.waveL.remove();
            this.waveR.remove();
            this.splash.remove();
            this.track.state = 1;
        }

        if (this.flagPcId !== null) {
            const flag = fopAcIt_JudgeByID<d_a_majuu_flag>(globals.frameworkGlobals, this.flagPcId);
            if (flag !== null && flag.parentMtx === null) {
                flag.parentMtx = this.model.modelMatrix;
                flag.parentPos = vec3.fromValues(0.0, 800.0, 0.0);
            }
        }
    }
}

class d_a_obj_wood extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_obj_wood;

    public override subload(globals: dGlobals): cPhs__Status {
        globals.scnPlay.woodPacket.put_unit(globals, this.pos, this.roomNo);
        // globals.scnPlay.treePacket.newData(this.pos, 0, this.roomNo);
        return cPhs__Status.Next;
    }
}

const enum d_a_obj_flame_mode { wait, wait2, l_before, l_u, u, u_l, l_after }
const enum d_a_obj_em_state { Off, TurnOn, On, TurnOff }
class d_a_obj_flame extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_obj_flame;

    private type: number;
    private model: J3DModelInstance;
    private btkAnm = new mDoExt_btkAnm();
    private brkAnm: mDoExt_brkAnm | null = null;
    private timerAdv: number;
    private useSimpleEm: boolean;
    private scaleY: number;
    private eyePosY: number;
    private extraScaleY: number;
    private bubblesParticleID: number;

    private rotY = 0;
    private timer = 0;
    private hasEmitter = false;
    private height = 0.0;

    private em0State = d_a_obj_em_state.Off;
    private em1State = d_a_obj_em_state.Off;
    private em2State = d_a_obj_em_state.Off;
    private em0: JPABaseEmitter | null = null;
    private em1: JPABaseEmitter | null = null;
    private em2: JPABaseEmitter | null = null;
    private em01Scale: vec3 | null = null;
    private em2Scale: vec3 | null = null;

    private eyePos = vec3.create();

    private mode = d_a_obj_flame_mode.wait;

    public override subload(globals: dGlobals): cPhs__Status {
        const arcName = `Yfire_00`;

        const status = dComIfG_resLoad(globals, arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        this.type = (this.parameters >>> 28) & 0x03;

        // create_heap
        const resCtrl = globals.resCtrl;
        const bmd_res_idx = [0x06, 0x05, 0x05, 0x06][this.type];

        const mdl_data = resCtrl.getObjectRes(ResType.Model, arcName, bmd_res_idx);
        this.model = new J3DModelInstance(mdl_data);

        const btk_res_idx = [0x0D, 0x0C, 0x0C, 0x0D][this.type];
        const btk_res = resCtrl.getObjectRes(ResType.Btk, arcName, btk_res_idx);

        const anim_speed = 1.0; // [1.0, 1.0, 1.0, 1.0][this.type];
        this.btkAnm.init(this.model.modelData, btk_res, true, LoopMode.Repeat, anim_speed);

        const brk_res_idx = [0x09, -1, -1, 0x09][this.type];
        if (brk_res_idx >= 0) {
            const brk_res = resCtrl.getObjectRes(ResType.Brk, arcName, brk_res_idx);
            this.brkAnm = new mDoExt_brkAnm();
            this.brkAnm.init(this.model.modelData, brk_res, true, LoopMode.Repeat, anim_speed);
        }

        if (this.type === 1)
            this.extraScaleY = 1.000442;
        else
            this.extraScaleY = 1.0;

        const scale_xz = [1.0, 1.0, 1.0, 0.5][this.type];
        this.scaleY = [1.0, 0.815, 1.0, 0.5][this.type];
        this.scale[0] *= scale_xz;
        this.scale[1] *= this.extraScaleY * this.scaleY;
        this.scale[2] *= scale_xz;

        this.timerAdv = [1.0, 0.5, 0.5, 1.0][this.type];
        this.useSimpleEm = [true, false, false, false][this.type];

        if (!this.useSimpleEm) {
            const em01ScaleXZ = [-1, 13.0 / 3.0, 7.5, 0.5][this.type];
            const em01ScaleY = [-1, 2.716, 7.5, 0.5][this.type];
            assert(em01ScaleXZ >= 0.0 && em01ScaleY >= 0.0);
            this.em01Scale = vec3.fromValues(em01ScaleXZ, this.extraScaleY * em01ScaleY, em01ScaleXZ);

            const em2Scale = [-1, 0.866666, 1.0, 0.5][this.type];
            assert(em2Scale >= 0.0);
            this.em2Scale = vec3.fromValues(em2Scale, em2Scale, em2Scale);
        }

        this.eyePosY = [1.0, 10.0 / 3.0, 7.5, 0.5][this.type];
        this.bubblesParticleID = [0x805C, 0x808A, 0x808A, 0x805C][this.type];

        // create_mode_init
        //   setups up timers based on global schBit

        // this.set_switch(globals);

        this.cullMtx = this.model.modelMatrix;
        this.set_mtx(globals);

        // dCcD_Stts / dCcD_Cps

        // em_position
        //   positions our particle emitter

        return cPhs__Status.Next;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);

        this.btkAnm.entry(this.model);
        if (this.brkAnm !== null)
            this.brkAnm.entry(this.model);

        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput, globals.dlst.wetherEffectSet);
    }

    private mode_wait(globals: dGlobals): void {
        const sch = this.parameters & 0xFF;
        // TODO(jstpierre): sch

        let shouldFire = false;

        if (this.timer <= 0.0) {
            shouldFire = true;
        }

        if (shouldFire) {
            if (this.type === 1) {
                this.to_l_before(globals);
            } else {
                this.mode = d_a_obj_flame_mode.wait2;
                this.timer = 127.0;
            }

            this.em0State = d_a_obj_em_state.TurnOn;
            this.em1State = d_a_obj_em_state.TurnOn;
            this.em2State = d_a_obj_em_state.TurnOn;
            this.hasEmitter = true;
        }
    }

    private to_l_before(globals: dGlobals): void {
        this.btkAnm.frameCtrl.currentTimeInFrames = 0.0;
        if (this.brkAnm !== null)
            this.brkAnm.frameCtrl.currentTimeInFrames = 0.0;

        this.mode = d_a_obj_flame_mode.l_before;
        this.timer += 23.0;
        // this.ki_init();
    }

    private mode_wait2(globals: dGlobals): void {
        // this.se_fireblast_omen();

        if (this.timer <= 0.0) {
            this.to_l_before(globals);
        }
    }

    private mode_l_before(globals: dGlobals): void {
        this.hasEmitter = false;

        if (this.timer <= 0.0) {
            this.mode = d_a_obj_flame_mode.l_u;
            this.timer += 22.0;
        }
    }

    private mode_l_u(globals: dGlobals): void {
        this.height = (22.0 - this.timer) / 22.0;
        this.hasEmitter = true;

        if (this.timer <= 0.0) {
            this.mode = d_a_obj_flame_mode.u;
            this.timer += 90.0;
        }
    }

    private mode_u(globals: dGlobals): void {
        if (this.timer <= 0.0) {
            this.mode = d_a_obj_flame_mode.u_l;
            this.timer += 25.0;
            this.em0State = d_a_obj_em_state.TurnOff;
        }
    }

    private mode_u_l(globals: dGlobals): void {
        this.height = this.timer / 25.0;
        this.hasEmitter = true;

        if (this.timer <= 0.0) {
            this.mode = d_a_obj_flame_mode.l_after;
            this.timer += 20.0;
            this.em1State = d_a_obj_em_state.TurnOff;
            this.em2State = d_a_obj_em_state.TurnOff;
        }
    }

    private mode_l_after(globals: dGlobals): void {
        if (this.timer <= 0.0) {
            this.mode = d_a_obj_flame_mode.wait;

            const sch = this.parameters & 0xFF;
            if (sch === 0)
                this.timer += 120.0;
            else
                this.timer = 0.0;
        }
    }

    private mode_proc_tbl = [
        this.mode_wait,
        this.mode_wait2,
        this.mode_l_before,
        this.mode_l_u,
        this.mode_u,
        this.mode_u_l,
        this.mode_l_after,
    ];

    private isWaiting(): boolean {
        return (this.mode === d_a_obj_flame_mode.wait || this.mode === d_a_obj_flame_mode.wait2);
    }

    private em_position(globals: dGlobals): void {
        if (!this.hasEmitter)
            return;

        MtxTrans(this.pos, false);
        mDoMtx_ZXYrotM(calc_mtx, this.rot);

        if (!this.useSimpleEm) {
            if (this.em0 !== null) {
                vec3.zero(scratchVec3a);
                const scaleY = this.extraScaleY * this.scaleY;
                scratchVec3a[1] = (this.height * 1500.0 - 300.0) * scaleY;
                mat4.translate(scratchMat4a, calc_mtx, scratchVec3a);
                JPASetRMtxSTVecFromMtx(null, this.em0.globalRotation, this.em0.globalTranslation, scratchMat4a);
            }

            if (this.em1 !== null)
                JPASetRMtxSTVecFromMtx(null, this.em1.globalRotation, this.em1.globalTranslation, calc_mtx);
        }

        vec3.zero(scratchVec3a);
        scratchVec3a[1] = this.height * 1500.0 * this.eyePosY;
        MtxTrans(scratchVec3a, true);
        transformVec3Mat4w1(this.eyePos, calc_mtx, Vec3Zero);
    }

    private em_manual_set(globals: dGlobals): void {
        if (this.em0State === d_a_obj_em_state.TurnOn && this.type !== 1) {
            this.em0 = globals.particleCtrl.set(globals, 0, 0x805A, this.pos, this.rot, this.em01Scale);
            this.em0State = d_a_obj_em_state.On;
        }

        if (this.em1State === d_a_obj_em_state.TurnOn) {
            this.em1 = globals.particleCtrl.set(globals, 0, 0x805B, this.pos, this.rot, this.em01Scale);
            this.em1State = d_a_obj_em_state.On;
        }

        if (this.em2State === d_a_obj_em_state.TurnOn) {
            this.em2 = globals.particleCtrl.set(globals, 0, this.bubblesParticleID, this.pos, this.rot, this.em2Scale);
            this.em2State = d_a_obj_em_state.On;
        }
    }

    private em_manual_inv(globals: dGlobals): void {
        const forceKillEm = false;
        if (forceKillEm) {
            if (this.em0State === d_a_obj_em_state.On)
                this.em0State = d_a_obj_em_state.TurnOff;
            if (this.em2State === d_a_obj_em_state.On)
                this.em2State = d_a_obj_em_state.TurnOff;
        }

        if (this.em0State === d_a_obj_em_state.TurnOff && this.em0 !== null) {
            this.em0.becomeInvalidEmitterImmediate();
            this.em0 = null;
        }

        if (this.em1State === d_a_obj_em_state.TurnOff && this.em1 !== null) {
            this.em1.becomeInvalidEmitterImmediate();
            this.em1 = null;
        }

        if (this.em2State === d_a_obj_em_state.TurnOff && this.em2 !== null) {
            this.em2.becomeInvalidEmitterImmediate();
            this.em2 = null;
        }
    }

    private em_simple_set(globals: dGlobals): void {
        /*
        if (this.em0State === d_a_obj_em_state.TurnOn) {
            vec3.copy(scratchVec3a, this.eyePos);
            scratchVec3a[1] += this.extraScaleY * this.eyePosY * -300.0;
            globals.particleCtrl.setSimple(globals, 0x805A, scratchVec3a, 1.0, White, White, false);
        }

        if (this.em1State === d_a_obj_em_state.TurnOn)
            globals.particleCtrl.setSimple(globals, 0x805B, this.eyePos, 1.0, White, White, false);

        if (this.em2State === d_a_obj_em_state.TurnOn)
            globals.particleCtrl.setSimple(globals, this.bubblesParticleID, this.eyePos, 1.0, White, White, false);
        */
    }

    private mode_proc_call(globals: dGlobals, deltaTimeFrames: number): void {
        const timerAdv = this.isWaiting() ? 1.0 : this.timerAdv;

        this.timer -= deltaTimeFrames * timerAdv;

        this.mode_proc_tbl[this.mode].call(this, globals);

        // TODO(jstpierre): Simple particle system
        if (false && this.useSimpleEm) {
            this.em_position(globals);
            this.em_simple_set(globals);
            // this.em_simple_inv(globals);
        } else {
            this.em_manual_set(globals);
            this.em_manual_inv(globals);
            this.em_position(globals);
        }

        if (!this.isWaiting()) {
            this.btkAnm.play(deltaTimeFrames);
            if (this.brkAnm !== null)
                this.brkAnm.play(deltaTimeFrames);
        }

        // hitbox
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        super.execute(globals, deltaTimeFrames);

        this.mode_proc_call(globals, deltaTimeFrames);

        this.rotY += 400 * deltaTimeFrames;

        // this.set_switch(globals);
        this.set_mtx(globals);
    }

    private set_mtx(globals: dGlobals): void {
        vec3.copy(this.model.baseScale, this.scale);
        MtxTrans(this.pos, false);
        mDoMtx_ZXYrotM(calc_mtx, this.rot);
        mDoMtx_YrotM(calc_mtx, this.rotY);
        mat4.copy(this.model.modelMatrix, calc_mtx);

        // TODO(jstpierre): this.setCullSizeBox();
    }
}

export class d_a_ff extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_ff;
    private model: J3DModelInstance[] = [];
    private brkAnm: mDoExt_brkAnm[] = [];
    private peekZResult = new PeekZResult();
    private state = 0;
    private isVisibleZ = false;
    private glowScale = 0.0;
    private glowScaleY = 1.0;
    private flyScale = 0.0;
    private flickerTimer = 0;
    private flickerTimerTimer = 0;
    private scatterTimer = 0;
    private scatterMoveTimer = 0;
    private liveTimer = 0;
    private noFollowGround = false;
    private groundY = 0.0;
    private homePos = vec3.create();
    private scatterPos = vec3.create();
    private speed = vec3.create();
    private speedFwd = 0.0;
    private speedFwdTarget = 0.0;
    private speedRotMax = 0.0;
    private rotTargetX = 0;
    private rotTargetY = 0;

    public override subload(globals: dGlobals): cPhs__Status {
        const arcName = `Ff`;

        const status = dComIfG_resLoad(globals, arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        const ho_bmd = [0x05, 0x06];
        const ho_brk = [0x0C, 0x0D];
        for (let i = 0; i < 2; i++) {
            const modelData = globals.resCtrl.getObjectRes(ResType.Model, arcName, ho_bmd[i]);
            this.model.push(new J3DModelInstance(modelData));

            const brkAnm = new mDoExt_brkAnm();
            const anm = globals.resCtrl.getObjectRes(ResType.Brk, arcName, ho_brk[i]);
            brkAnm.init(modelData, anm, true, LoopMode.Repeat, 0.9 + cM_rndF(0.15));
            this.brkAnm.push(brkAnm);
        }

        const count = this.parameters & 0x00FF;
        for (let i = 0; i < count; i++) {
            const pos = vec3.clone(this.pos);
            pos[0] += cM_rndFX(500);
            pos[2] += cM_rndFX(500);

            const prm: fopAcM_prm_class = {
                parameters: this.parameters & 0xFF00,
                roomNo: this.roomNo,
                pos,
                rot: Vec3Zero,
                enemyNo: -1,
                scale: Vec3One,
                subtype: 0,
                gbaName: 0,
                parentPcId: 0xFFFFFFFF,
                layer: this.roomLayer,
            };

            fpcSCtRq_Request(globals.frameworkGlobals, null, dProcName_e.d_a_ff, prm);
        }

        this.noFollowGround = !!((this.parameters >>> 8) & 0xFF);
        this.liveTimer = cM_rndF(0x8000);
        this.flickerTimerTimer = cM_rndF(100.0);
        this.cullMtx = this.model[0].modelMatrix;
        vec3.copy(this.homePos, this.pos);

        return cPhs__Status.Next;
    }

    private z_check(globals: dGlobals): void {
        const peekZ = globals.dlst.peekZ;
        const dst = this.peekZResult;

        mDoLib_project(scratchVec3a, this.pos, globals.camera);
        if (globals.camera.clipSpaceNearZ === GfxClipSpaceNearZ.NegativeOne)
            scratchVec3a[2] = scratchVec3a[2] * 0.5 + 0.5;

        if (!peekZ.newData(dst, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]))
            return;

        if (dst.triviallyCulled) {
            this.isVisibleZ = false;
            return;
        }

        if (dst.value === null) {
            this.isVisibleZ = false;
            return;
        }

        let projectedZ = dst.userData as number;

        // Point is visible if our projected Z is in front of the depth buffer.
        this.isVisibleZ = compareDepthValues(projectedZ, dst.value, GfxCompareMode.Less);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.flickerTimer -= deltaTimeFrames;
        this.flickerTimerTimer -= deltaTimeFrames;
        this.scatterTimer -= deltaTimeFrames;

        this.z_check(globals);
        this.glowScale = cLib_addCalc2(this.glowScale, this.isVisibleZ ? 1.0 : 0.0, 1.0 * deltaTimeFrames, 0.333);
        this.brkAnm[0].play(deltaTimeFrames);
        this.brkAnm[1].play(deltaTimeFrames);
        this.liveTimer += deltaTimeFrames;

        if (this.flickerTimerTimer <= 0.0) {
            this.flickerTimer = 40.0 + cM_rndF(50.0);
            this.flickerTimerTimer = 200.0 + cM_rndF(100.0);
        }

        const scaleTarget = (this.flickerTimer <= 0.0) ? Math.sin(cM_s2rad(this.liveTimer * 1000)) * 0.15 * 0.25 + 0.225 : 0.0;
        this.flyScale = cLib_addCalc2(this.flyScale, scaleTarget, 0.1 * deltaTimeFrames, 0.05);

        let motion = false;

        if (this.state === 0) {
            const chk = new dBgS_GndChk();
            vec3.scaleAndAdd(chk.pos, this.pos, Vec3UnitY, 250.0);
            this.groundY = globals.scnPlay.bgS.GroundCross(chk) + 12.5;
            if (!this.noFollowGround)
                this.pos[1] = this.groundY;
            vec3.copy(this.homePos, this.pos);
            this.state = 1;
        }

        if (this.state === 0 || this.state === 1) {
            this.pos[0] = cLib_addCalc2(this.pos[0], this.homePos[0], 0.1 * deltaTimeFrames, this.speed[0]);
            this.pos[1] = cLib_addCalc2(this.pos[1], this.homePos[1], 0.1 * deltaTimeFrames, this.speed[1]);
            this.pos[2] = cLib_addCalc2(this.pos[2], this.homePos[2], 0.1 * deltaTimeFrames, this.speed[2]);

            if (vec3.squaredDistance(this.pos, globals.playerPosition) < 250.0 ** 2) {
                this.state = 2;
                this.scatterMoveTimer = 1000.0 + cM_rndF(100.0);
                this.rot[0] = -0x3000;
                this.speedFwd = 10.0;
            }
        }

        if (this.state === 2) {
            motion = true;

            if (this.scatterTimer <= 0.0) {
                this.scatterPos[0] = this.pos[0] + cM_rndFX(750.0);
                this.scatterPos[1] = this.pos[1] + cM_rndFX(750.0) + 137.5;
                this.scatterPos[2] = this.pos[2] + cM_rndFX(750.0);

                this.speedRotMax = 0.0;
                this.speedFwdTarget = 10.0 + cM_rndF(20.0);

                const time = vec3.distance(this.scatterPos, this.pos) / this.speedFwdTarget;
                this.scatterTimer = time;
                this.rotTargetY = cLib_targetAngleY(this.scatterPos, this.pos);
                this.rotTargetX = -cLib_targetAngleX(this.scatterPos, this.pos);
            }

            if (this.scatterMoveTimer <= 0.0) {
                this.state = 3;
                vec3.copy(this.scatterPos, this.homePos);
                this.speedRotMax = 0.0;
            }
        }

        if (this.state === 3) {
            motion = true;

            this.rotTargetY = cLib_targetAngleY(this.scatterPos, this.pos);
            this.rotTargetX = -cLib_targetAngleX(this.scatterPos, this.pos);

            if (vec3.squaredDistance(this.scatterPos, this.homePos) < 2500.0)
                this.state = 1;

            this.speedRotMax = cLib_addCalc2(this.speedRotMax, 10.0, 1.0 * deltaTimeFrames, 0.15);
        }

        if (motion) {
            this.rot[0] = cLib_addCalcAngleS2(this.rot[0], this.rotTargetX, 10.0 * deltaTimeFrames, this.speedRotMax * 500.0);
            this.rot[1] = cLib_addCalcAngleS2(this.rot[1], this.rotTargetY, 10.0 * deltaTimeFrames, this.speedRotMax * 500.0);
            this.speedRotMax = cLib_addCalc2(this.speedRotMax, 1.0, deltaTimeFrames, 0.1);
            this.speedFwd = cLib_addCalc2(this.speedFwd, this.speedFwdTarget, 1.0 * deltaTimeFrames, 3.0);

            vec3.set(scratchVec3a, 0, 0, this.speedFwd * 0.25);
            mDoMtx_YrotS(calc_mtx, this.rot[1]);
            mDoMtx_XrotM(calc_mtx, this.rot[0]);
            MtxPosition(this.speed, scratchVec3a);
            vec3.scaleAndAdd(this.pos, this.pos, this.speed, deltaTimeFrames);
        }

        if (this.pos[1] >= this.groundY + 12.5) {
            this.glowScaleY = cLib_addCalc2(this.glowScaleY, 1.0, 0.2 * deltaTimeFrames, 0.1);
        } else {
            if (this.pos[1] < this.groundY)
                this.pos[1] = this.groundY;
            this.glowScaleY = cLib_addCalc2(this.glowScaleY, 0.5, 0.2 * deltaTimeFrames, 0.1);
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        if (this.flyScale > 0.01) {
            MtxTrans(this.pos, false);
            scaleMatrix(calc_mtx, calc_mtx, this.flyScale);
            mat4.copy(this.model[0].modelMatrix, calc_mtx);
            mDoExt_modelUpdateDL(globals, this.model[0], renderInstManager, viewerInput, globals.dlst.effect);

            if (this.glowScale > 0.01) {
                mDoMtx_YrotM(calc_mtx, this.liveTimer * 0x0100);
                scaleMatrix(calc_mtx, calc_mtx, this.glowScale, this.glowScale * this.glowScaleY, this.glowScale);
                mat4.copy(this.model[1].modelMatrix, calc_mtx);
                mDoExt_modelUpdateDL(globals, this.model[1], renderInstManager, viewerInput, globals.dlst.effect);
            }
        }
    }
}

class fopNpc_npc_c extends fopAc_ac_c {
    protected morf: mDoExt_McaMorf;
};
interface anm_prm_c {
    anmIdx: number;
    nextPrmIdx: number;
    morf: number;
    playSpeed: number;
    loopMode: number;
};

function dNpc_setAnmIDRes(globals: dGlobals, pMorf: mDoExt_McaMorf, loopMode: number, morf: number, speed: number, animResId: number, arcName: string): boolean {
    if (pMorf) {
        const pAnimRes = globals.resCtrl.getObjectIDRes(ResType.Bck, arcName, animResId);
        pMorf.setAnm(pAnimRes, loopMode, morf, speed, 0.0, -1.0);
        return true;
    }
    return false;
}

class d_a_npc_ls1 extends fopNpc_npc_c {
    public static PROCESS_NAME = dProcName_e.d_a_npc_ls1;
    private type: number;
    private state = 0;
    private animIdx = -1;
    private animStopped: boolean;
    private animTime: number;
    private idleCountdown: number;
    private arcName = 'Ls';

    private itemPosType: number = 1;
    private itemScale: number = 1.0;
    private itemModel: J3DModelInstance;
    private handModel: J3DModelInstance;
    private jointMtxHandL: ReadonlyMat4;
    private jointMtxHandR: ReadonlyMat4;

    private btkAnim = new mDoExt_btkAnm();
    private btpAnim = new mDoExt_btpAnm();
    private btkFrame: number;
    private btpFrame: number;

    private static bckIdxTable = [5, 6, 7, 8, 9, 10, 11, 2, 4, 3, 1, 1, 1, 0]
    private static animParamsTable: anm_prm_c[] = [
        { anmIdx: 0xFF, nextPrmIdx: 0xFF, morf: 0.0, playSpeed: 0.0, loopMode: 0xFFFFFFFF, },
        { anmIdx: 0, nextPrmIdx: 1, morf: 8.0, playSpeed: 1.0, loopMode: 2, },
        { anmIdx: 5, nextPrmIdx: 1, morf: 8.0, playSpeed: 1.0, loopMode: 2, },
        { anmIdx: 10, nextPrmIdx: 2, morf: 8.0, playSpeed: 1.0, loopMode: 2, },
        { anmIdx: 5, nextPrmIdx: 1, morf: 8.0, playSpeed: 1.0, loopMode: 2, }];

    public override subload(globals: dGlobals): cPhs__Status {
        const success = this.decideType(this.parameters);
        if (!success) { return cPhs__Status.Error; }

        let status = dComIfG_resLoad(globals, this.arcName);
        if (status !== cPhs__Status.Complete)
            return status;

        // noclip modification: Aryll's telescope comes from the Link arc. Load it now
        status = dComIfG_resLoad(globals, "Link");
        if (status !== cPhs__Status.Complete)
            return status;

        this.createModels(globals);

        this.cullMtx = this.morf.model.modelMatrix;
        this.setCullSizeBox(-50.0, -20.0, -50.0, 50.0, 140.0, 50.0);

        this.createInit(globals);

        return cPhs__Status.Next;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        setLightTevColorType(globals, this.morf.model, this.tevStr, viewerInput.camera);
        setLightTevColorType(globals, this.handModel, this.tevStr, viewerInput.camera);

        // this.btkAnim.entry(this.morf.model, this.btkFrame);
        // this.btpAnim.entry(this.morf.model, this.btpFrame);

        this.morf.entryDL(globals, renderInstManager, viewerInput);

        mDoExt_modelEntryDL(globals, this.handModel, renderInstManager, viewerInput);

        if (this.itemModel) {
            setLightTevColorType(globals, this.itemModel, this.tevStr, viewerInput.camera);
            mDoExt_modelEntryDL(globals, this.itemModel, renderInstManager, viewerInput);
        }

        this.drawShadow();
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        if (true || this.demoActorID >= 0) {
            const isDemo = this.demo(globals, deltaTimeFrames);
            if (!isDemo) {
                this.play_animation(deltaTimeFrames);
            }
        }

        // TODO: Shadowing based on the triangle that the NPC is standing on
        // this.tevStr.roomNo = this.roomNo;
        // bVar2 = dBgS::GetPolyColor(&d_com_inf_game::g_dComIfG_gameInfo.play.mBgS,
        //             &(this->parent).mObjAcch.parent.mGndChk.parent.mPolyInfo);
        // (this->parent).parent.tevStr.mEnvrIdxOverride = bVar2;

        this.setMtx(false);
    }

    private decideType(pcParam: number) {
        const isEventBit0x2A80Set = false;

        this.type = 0xFF;

        // Outset Island has two Ls1 actors in layer 0. One is type 0, the other is type 3. Based on the status of 
        // dSv_event_c::isEventBit(&d_com_inf_game::g_dComIfG_gameInfo.info.mSavedata.mEvent, 0x2a80), only one is created.
        switch (pcParam) {
            case 0: if (isEventBit0x2A80Set) this.type = 0; break;
            case 1: this.type = 1; break;
            case 2: this.type = 2; break;
            case 3: if (!isEventBit0x2A80Set) this.type = 3; break;
            case 4: this.type = 4; break;
        }

        return this.type != 0xFF;
    }

    private createInit(globals: dGlobals) {
        this.setAnim(globals, 2, false);
        this.play_animation(1.0 / 30.0);

        this.tevStr.roomNo = this.roomNo

        this.morf.setMorf(0.0);
        this.setMtx(true);
    }

    private createModels(globals: dGlobals) {
        this.createBody(globals);
        this.createHand(globals);
        this.createItem(globals);
    }

    private createBody(globals: dGlobals) {
        const modelData = globals.resCtrl.getObjectIDRes(ResType.Model, this.arcName, 0xd);
        for (let i = 0; i < modelData.modelMaterialData.materialData!.length; i++) {
            // Material anim setup
        }

        this.morf = new mDoExt_McaMorf(modelData, null, null, null, LoopMode.Once, 1.0, 0, -1);

        const jointIdxHandL = modelData.bmd.jnt1.joints.findIndex(j => j.name == 'handL');
        const jointIdxHandR = modelData.bmd.jnt1.joints.findIndex(j => j.name == 'handR');
        this.jointMtxHandL = this.morf.model.shapeInstanceState.jointToWorldMatrixArray[jointIdxHandL];
        this.jointMtxHandR = this.morf.model.shapeInstanceState.jointToWorldMatrixArray[jointIdxHandR];
    }

    private createHand(globals: dGlobals) {
        const modelData = globals.resCtrl.getObjectIDRes(ResType.Model, this.arcName, 0xc);
        this.handModel = new J3DModelInstance(modelData);

        const handJointIdxL = modelData.bmd.jnt1.joints.findIndex(j => j.name == 'ls_handL');
        const handJointIdxR = modelData.bmd.jnt1.joints.findIndex(j => j.name == 'ls_handR');

        this.handModel.jointMatrixCalcCallback = (dst: mat4, modelData: J3DModelData, i: number): void => {
            if (i == handJointIdxL) { mat4.copy(dst, this.jointMtxHandL); }
            else if (i == handJointIdxR) { mat4.copy(dst, this.jointMtxHandR); }
        }
    }

    private createItem(globals: dGlobals) {
        const modelData = globals.resCtrl.getObjectIDRes(ResType.Model, "Link", 0x2f);
        this.itemModel = new J3DModelInstance(modelData);
    }

    private setAnim(globals: dGlobals, animIdx: number, hasTexAnim: boolean) {
        if (hasTexAnim) {
            // TODO: Facial texture animations
        }

        const params = d_a_npc_ls1.animParamsTable[animIdx];

        if (params.anmIdx > -1 && this.animIdx != params.anmIdx) {
            const bckID = d_a_npc_ls1.bckIdxTable[params.anmIdx];
            dNpc_setAnmIDRes(globals, this.morf, params.loopMode, params.morf, params.playSpeed, bckID, this.arcName);
            this.animIdx = params.anmIdx;
            this.animStopped = false;
            this.animTime = 0;
        }
    }

    private play_animation(deltaTimeFrames: number) {
        // play_btp_anm(this);
        // play_btk_anm(this);

        this.animStopped = this.morf.play(deltaTimeFrames);
        if (this.morf.frameCtrl.currentTimeInFrames < this.animTime) {
            this.animStopped = true;
        }
        this.animTime = this.morf.frameCtrl.currentTimeInFrames;
    }

    private setMtx(param: boolean) {
        vec3.copy(this.morf.model.baseScale, this.scale);
        MtxTrans(this.pos, false, calc_mtx);
        mDoMtx_ZXYrotM(calc_mtx, this.rot);
        mat4.copy(this.morf.model.modelMatrix, calc_mtx);
        this.morf.calc();

        this.handModel.calcAnim();

        if (this.itemModel) {
            mat4.copy(calc_mtx, this.jointMtxHandR);
            if (this.itemPosType == 0) {
                MtxTrans([5.5, -3.0, -2.0], true);
            }
            else {
                MtxTrans([5.7, -17.5, -1.0], true);
            }
            scaleMatrix(calc_mtx, calc_mtx, this.itemScale, this.itemScale, this.itemScale);
            mDoMtx_XYZrotM(calc_mtx, [-0x1d27, 0x3b05, -0x5c71]);
            mat4.copy(this.itemModel.modelMatrix, calc_mtx);
            this.itemModel.calcAnim();
        }
    }

    private drawShadow() {
        // TODO
    }

    private demo(globals: dGlobals, deltaTimeFrames: number) {
        if (this.demoActorID < 0) { return false; }

        // TODO: Lots happening here
        dDemo_setDemoData(globals, deltaTimeFrames, this, 0x6a, this.morf, this.arcName);
        return true;
    }
}

enum LkAnim {
    WAITS = 0x00,
    WALK = 0x01,
    DASH = 0x02,
    WAITB = 0x1C,
    WAITATOB = 0x1D,
    WAITQ = 0x9D,
};

enum LinkDemoMode {
    None = 0x00,
    Wait = 0x01,
    Walk = 0x02,
    Dash = 0x03,
    SetPosRotEquip = 0x04,
    WaitTurn = 0x05,
    SetRot = 0x2B,
    SetPosRot = 0x2C,
    MAX = 0x4B,
    
    Tool = 0x200,
};

interface LkAnimData {
    underBckIdx: number;
    upperBckIdx: number;
    leftHandIdx: number;
    rightHandIdx: number;
    texAnmIdx: number;
}

interface LkFootData {
    toePos: vec3,
    heelPos: vec3,
}

const enum ItemNo {
    HerosSword = 0x38,
    MasterSwordPowerless = 0x39,
    MasterSwordHalfPower = 0x3A,
    MasterSwordFullPower = 0x3E,
    InvalidItem = 0xFF,
}

const enum LkEquipItem {
    None = 0x100,
    Sword = 0x103,
}

const enum LkHandStyle {
    Idle = 0,
    HoldSword = 3,
    HoldWindWaker = 5,
    HoldShield = 8,
}

class d_a_py_lk extends fopAc_ac_c {
    public static PROCESS_NAME = dProcName_e.d_a_py_lk;
    private static ARC_NAME = "Link";
    private static LINK_BDL_CL = 0x18;
    private static LINK_BTI_LINKTEXBCI4 = 0x71;
    private static LINK_CLOTHES_TEX_IDX = 0x22;
    private static LINK_BDL_KATSURA = 0x20;
    private static LINK_BDL_SWA = 0x25; // Hero's sword blade
    private static LINK_BDL_SWGRIPA=0x26 // Hero's sword hilt
    private static TOE_POS = vec3.fromValues(6.0, 3.25, 0.0);
    private static HEEL_POS = vec3.fromValues(-6.0, 3.25, 0.0);

    private demoProcInitFuncTable = new Map<LinkDemoMode, () => boolean>();
    private proc: (globals: dGlobals) => void;

    private model: J3DModelInstance;
    private modelSwordHilt: J3DModelInstance;
    private modelKatsura: J3DModelInstance; // Wig. To replace the hat when wearing casual clothes.

    private demoMode: number = LinkDemoMode.None;
    private demoClampToGround = true;
    private gndChk = new dBgS_GndChk()

    private isWearingCasualClothes = false;
    private texMappingClothes: TextureMapping;
    private texMappingCasualClothes: TextureMapping = new TextureMapping();
    private texMappingHeroClothes: TextureMapping = new TextureMapping();

    private anmDataTable: LkAnimData[] = [];
    private anmBck = new mDoExt_bckAnm(); // Joint animation
    private anmBtp = new mDoExt_btpAnm(); // Texture flipbook animation (e.g. facial expressions)
    private anmBtk = new mDoExt_btkAnm(); // UV animation (e.g. eyes get small when surprised)
    private anmBckId: number;

    private rawPos = vec3.create(); // The position before it is manipulated by anim root/foot motion
    private vel = vec3.create(); // TODO: This should be part of fopAc_ac_c

    private frontFoot: number = 2;
    private footData: LkFootData[] = nArray(2, i => ({ toePos: vec3.create(), heelPos: vec3.create() }));
    private anmTranslation = vec3.create();

    private handStyleLeft: LkHandStyle;
    private handStyleRight: LkHandStyle;
    private equippedItem: LkEquipItem;
    private equippedItemModel: J3DModelInstance | null = null;

    protected override subload(globals: dGlobals, prm: fopAcM_prm_class | null): cPhs__Status {
        this.loadAnmTable(globals);

        this.playerInit(globals);

        // noclip modification: The game manually draws the eye/eyebrow filter before the body. Let's do that with sorting.
        this.model.setSortKeyLayer(GfxRendererLayer.OPAQUE + 5, false);
        this.setupDam('eyeL');
        this.setupDam('eyeR');
        this.setupDam('mayuL');
        this.setupDam('mayuR');

        // noclip modification:
        this.setSingleMoveAnime(globals, LkAnim.WAITS);

        return cPhs__Status.Next;
    }

    override execute(globals: dGlobals, deltaTimeFrames: number): void {
        // Update the current proc based on demo data
        this.setDemoData(globals);
        if (this.demoMode != 5) {
            this.changeDemoProc(globals);
        }

        // Step our animations forward
        this.anmBck.play(deltaTimeFrames);
        this.anmBtp.play(deltaTimeFrames);
        this.anmBtk.play(deltaTimeFrames);

        // Run the current custom update process (Walk, Idle, Swim, etc)
        if (this.proc) this.proc(globals);

        // Apply root motion from the animation, and adjust position based on foot movement
        const rawPos = vec3.copy(this.rawPos, this.pos); 
        this.posMove(globals);

        // Evaluate for collisions, clamp to ground
        this.gndChk.Reset();
        vec3.scaleAndAdd(this.gndChk.pos, this.pos, Vec3UnitY, 30.1);
        const groundHeight = globals.scnPlay.bgS.GroundCross(this.gndChk);
        this.autoGroundHit();

        // If we're pulling position directly from the JStudio tool, ignore collisions and animation root motion
        if (this.proc == this.procTool) {
            vec3.copy(this.pos, rawPos);
            if (this.demoClampToGround && groundHeight != -Infinity) {
                this.pos[1] = groundHeight;
            }
        }

        // setWorldMatrix()
        MtxTrans(this.pos, false, this.model.modelMatrix);
        mDoMtx_ZXYrotM(this.model.modelMatrix, this.rot);

        // Update joints based on the currently playing animation
        this.anmBck.entry(this.model);
        this.model.calcAnim();
        mat4.copy(this.modelKatsura.modelMatrix, this.model.shapeInstanceState.jointToWorldMatrixArray[0x0F]);
        this.modelKatsura.calcAnim();

        // Update item transform and animations
        this.setItemModel();
    }

    override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // @TODO: This should use LightType.Player, but it's not yet implemented
        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);

        if (this.isWearingCasualClothes) {
            this.model.setShapeVisible(5, false);  // Hat
            this.model.setShapeVisible(22, false); // Sword scabbard
            this.model.setShapeVisible(23, false); // Belt buckle

            setLightTevColorType(globals, this.modelKatsura, this.tevStr, viewerInput.camera);
            mDoExt_modelEntryDL(globals, this.modelKatsura, renderInstManager, viewerInput);
        }

        if (this.equippedItem == LkEquipItem.Sword) {
            setLightTevColorType(globals, this.equippedItemModel!, this.tevStr, viewerInput.camera);
            mDoExt_modelEntryDL(globals, this.equippedItemModel!, renderInstManager, viewerInput);

            setLightTevColorType(globals, this.modelSwordHilt, this.tevStr, viewerInput.camera);
            mDoExt_modelEntryDL(globals, this.modelSwordHilt, renderInstManager, viewerInput);
        }

        // TODO:
        // if (!checkNormalSwordEquip() && dStage_stagInfo_GetSTType(dComIfGp_getStageStagInfo()) != dStageType_FF1_e ||
        //     checkCaughtShapeHide() || checkDemoShieldNoDraw()) {
        //     mpCLModelData->getJointNodePointer(0x0D)->getMesh()->getShape()->hide(); // cl_podA joint
        // } else {
        //     mpCLModelData->getJointNodePointer(0x0D)->getMesh()->getShape()->show(); // cl_podA joint
        // }

        if (this.anmBtp.anm) this.anmBtp.entry(this.model);
        if (this.anmBtk.anm) this.anmBtk.entry(this.model);

        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        mDoExt_modelEntryDL(globals, this.model, renderInstManager, viewerInput);
    }

    private playerInit(globals: dGlobals) {
        // createHeap()
        this.model = this.initModel(globals, d_a_py_lk.LINK_BDL_CL);
        this.modelKatsura = this.initModel(globals, d_a_py_lk.LINK_BDL_KATSURA);
        this.modelSwordHilt = this.initModel(globals, d_a_py_lk.LINK_BDL_SWGRIPA);

        // Fetch the casual clothes and the hero texture. They'll be be selected by the ShapeID set by a demo.
        const casualTexData = globals.resCtrl.getObjectRes(ResType.Bti, d_a_py_lk.ARC_NAME, d_a_py_lk.LINK_BTI_LINKTEXBCI4);
        casualTexData.fillTextureMapping(this.texMappingCasualClothes);

        // Find the texture mapping for link's clothes in the model. There are two, the first has alpha enabled and is never
        // used with the casual clothes. We want the second.
        this.texMappingClothes = this.model.materialInstanceState.textureMappings[d_a_py_lk.LINK_CLOTHES_TEX_IDX];
        this.texMappingHeroClothes.copy(this.texMappingClothes);

        // Set the default state based on EventBit 0x2A80, except we can't, so just hardcode to use casual clothes on the title screen
        this.isWearingCasualClothes = (globals.stageName == 'sea_T' ); // dComIfGs_isEventBit(0x2A80)
        if(this.isWearingCasualClothes) { this.texMappingClothes.copy(this.texMappingCasualClothes); }

        MtxTrans(this.pos, false, this.model.modelMatrix);
        mDoMtx_ZXYrotM(this.model.modelMatrix, this.rot);
        this.cullMtx = this.model.modelMatrix;
    }

    private setupDam(pref: string): void {
        const matInst = this.model.materialInstances.find((m) => m.name === `${pref}`)!;
        const matInstA = this.model.materialInstances.find((m) => m.name === `${pref}damA`)!;
        const matInstB = this.model.materialInstances.find((m) => m.name === `${pref}damB`)!;

        // Render an alpha mask in the shape of the eyes. Needs to render before Link so that it can depth test against
        // the scene but not against his hair. The eyes will then draw with depth testing enabled, but will mask against
        // this alpha tex. 
        matInstA.setSortKeyLayer(GfxRendererLayer.OPAQUE + 4, false);
        matInstA.setColorWriteEnabled(false);
        matInstA.setAlphaWriteEnabled(true);

        // @TODO: This material is marked as translucent in the original BMD. Noclip draws translucent shapes after all
        //        opaque shapes, meaning that this renders AFTER Link, which defeats the purpose of modifying the sort
        //        layer. Is there something wrong with noclip's translucency handling?
        matInstA.materialData.material.translucent = false;

        // Clear the alpha mask written by the *damA materials so it doesn't interfere with other translucent objects
        matInstB.setSortKeyLayer(GfxRendererLayer.OPAQUE + 6, false);
        matInstB.setColorWriteEnabled(false);
        matInstB.setAlphaWriteEnabled(true);

        // Ensure that any texture animations applied to `eyeL` or `eyeR` also apply to these two damA/B masks
        matInstA.texNoCalc = matInst.texNoCalc;
        matInstB.texNoCalc = matInst.texNoCalc;
    }

    private initModel(globals: dGlobals, fileIdx: number): J3DModelInstance {
        const modelData = globals.resCtrl.getObjectRes(ResType.Model, d_a_py_lk.ARC_NAME, fileIdx);
        const model = new J3DModelInstance(modelData);
        assert(!!model);
        return model;
    }

    private setDemoData(globals: dGlobals) {
        const demoActor = globals.scnPlay.demo.getSystem().getActor(this.demoActorID);
        if (!demoActor)
            return false;

        demoActor.actor = this;
        demoActor.model = this.model;
        demoActor.debugGetAnimName = (idx: number) => LinkDemoMode[idx].toString();

        let targetPos: ReadonlyVec3 = this.pos;
        let targetRot: number = this.rot[1];

        const enable = demoActor.checkEnable(0xFF);
        if (enable & EDemoActorFlags.HasPos) { targetPos = demoActor.translation; }
        if (enable & EDemoActorFlags.HasRot) { targetRot = demoActor.rotation[1]; }

        // The demo mode determines which 'Proc' action function will be called. It maps into the DemoProc*FuncTables.
        // These functions can start anims (by indexing into AnmDataTable), play sounds, etc.
        if (enable & EDemoActorFlags.HasAnim) {
            this.demoMode = demoActor.nextBckId;
        }

        if (enable & EDemoActorFlags.HasShape) {
            this.isWearingCasualClothes = (demoActor.shapeId == 1);
            if (this.isWearingCasualClothes)
                this.texMappingClothes.copy(this.texMappingCasualClothes);
            else
                this.texMappingClothes.copy(this.texMappingHeroClothes);
        }

        // Limit actor modifications based on the current mode. E.g. Mode 0x18 only allows rotation
        switch (this.demoMode) {
            case LinkDemoMode.SetPosRotEquip:
            case LinkDemoMode.SetPosRot:
                vec3.copy(this.pos, targetPos);
                this.rot[1] = targetRot;
                break;

            case LinkDemoMode.SetRot: {
                debugger;
                const moveVec = vec3.sub(scratchVec3a, targetPos, this.pos);
                const newRot = cM_atan2s(moveVec[0], moveVec[2]);
                this.rot[1] = newRot;
                break;
            }

            case LinkDemoMode.Walk:
            case LinkDemoMode.Dash: {
                const moveVec = vec3.sub(scratchVec3a, targetPos, this.pos);
                const newRot = cM_atan2s(moveVec[0], moveVec[2]);
                this.rot[1] = newRot;
                this.setSingleMoveAnime(globals, (this.demoMode == LinkDemoMode.Walk) ? LkAnim.WALK : LkAnim.DASH)
                break;
            }
        }

        return true;
    }

    private changeDemoProc(globals: dGlobals): boolean {
        assert(this.demoMode < LinkDemoMode.MAX || this.demoMode == LinkDemoMode.Tool)

        const pred = true;

        if (pred) {
            switch (this.demoMode) {
                case LinkDemoMode.None: return false;

                case LinkDemoMode.Tool:
                    this.proc = this.procTool;
                    break;

                case LinkDemoMode.SetPosRotEquip:
                    this.procWait_init(globals);
                    break;

                default:
                    const initFunc = this.demoProcInitFuncTable.get(this.demoMode);
                    if (initFunc) {
                        initFunc();
                    } else {
                        // console.warn('Not yet implemented demoMode', LinkDemoMode[this.demoMode]);
                        // debugger;
                    }
                    break;
            }
            return true;
        }

        return false;
    }

    private autoGroundHit() {
        const groundHeight = this.gndChk.retY;
        if(groundHeight == -Infinity) {
            return;
        }

        const groundDiff = this.pos[1] - groundHeight;

        // Our feet are near the ground, clamp to ground
        if(groundDiff > 0.0) {
            if(groundDiff <= 30.1) {
                this.pos[1] = groundHeight;
                this.vel[1] = 0.0;
                return;
            }
        }

        // TODO: Our feet are below the ground, use last frame's height
        this.pos[1] = groundHeight;
        this.vel[1] = 0.0;
    }

    private posMove(globals: dGlobals) {
        if (this.anmBck) {
            // Apply the root motion from the current animation (swaying)
            const rootTransform = new JointTransformInfo();
            calcANK1JointAnimationTransform(rootTransform, this.anmBck.anm.jointAnimationEntries[0], this.anmBck.frameCtrl.getFrame(), this.anmBck.frameCtrl.applyLoopMode(this.anmBck.frameCtrl.getFrame() + 1));

            const prevTranslation = vec3.copy(scratchVec3a, this.anmTranslation);
            vec3.scale(this.anmTranslation, rootTransform.translation, 1.0);

            const frameTranslation = vec3.sub(scratchVec3b, prevTranslation, this.anmTranslation);

            const sinTheta = Math.sin(cM_s2rad(this.rot[1]));
            const cosTheta = Math.cos(cM_s2rad(this.rot[1]));
            const worldTransX = frameTranslation[2] * sinTheta + frameTranslation[0] * cosTheta;
            const worldTransZ = frameTranslation[2] * cosTheta - frameTranslation[0] * sinTheta;

            this.pos[0] += worldTransX;
            this.pos[2] += worldTransZ;

            // Apply motion based on the movement of the feet
            this.posMoveFromFootPos(globals);
        }
    }

    private posMoveFromFootPos(globals: dGlobals) {
        if (this.frontFoot == 2) {
            vec3.zero(this.vel);
            vec3.set(this.footData[0].toePos, -14.05, 0.0, 5.02);
            vec3.set(this.footData[0].heelPos, -10.85, 0.0, -6.52);
            vec3.set(this.footData[1].toePos, 14.05, 0.0, 5.02);
            vec3.set(this.footData[1].heelPos, 10.85, 0.0, -6.52);
            this.frontFoot = 0;
            return;
        }

        const footLJointIdx = this.model.modelData.bmd.jnt1.joints.findIndex(j => j.name == 'Lfoot_jnt')
        const footRJointIdx = this.model.modelData.bmd.jnt1.joints.findIndex(j => j.name == 'Rfoot_jnt')
        const waistJointIdx = this.model.modelData.bmd.jnt1.joints.findIndex(j => j.name == 'waist_jnt')

        // Compute local -> model transforms for foot and waist joints
        const invModelMtx = mat4.invert(calc_mtx, this.model.modelMatrix);
        const footLMtx = mat4.mul(scratchMat4a, invModelMtx, this.model.shapeInstanceState.jointToWorldMatrixArray[footLJointIdx]);
        const footRMtx = mat4.mul(scratchMat4b, invModelMtx, this.model.shapeInstanceState.jointToWorldMatrixArray[footRJointIdx]);
        const waistMtx = mat4.mul(scratchMat4c, invModelMtx, this.model.shapeInstanceState.jointToWorldMatrixArray[waistJointIdx]);
        
        // Compute model space positions of the feet
        const toePos = [];
        const heelPos = [];
        toePos[0] = vec3.transformMat4(scratchVec3a, d_a_py_lk.TOE_POS, footRMtx);
        toePos[1] = vec3.transformMat4(scratchVec3b, d_a_py_lk.TOE_POS, footLMtx);
        heelPos[0] = vec3.transformMat4(scratchVec3c, d_a_py_lk.HEEL_POS, footRMtx);
        heelPos[1] = vec3.transformMat4(scratchVec3d, d_a_py_lk.HEEL_POS, footLMtx);

        // Compare the model space positions of the feet to determine which is in front
        const footZPos = []
        for (let i = 0; i < 2; i++) {
            const footCenter = vec3.scale(scratchVec3e, vec3.add(scratchVec3e, toePos[i], heelPos[i]), 0.5);
            footZPos[i] = footCenter[2];
        }
        if (footZPos[1] > footZPos[0]) { this.frontFoot = 1 }
        else { this.frontFoot = 0; }

        // Compute the horizontal distance moved by the front foot since last frame
        const moveVec = vec3.sub(scratchVec3e, toePos[this.frontFoot], this.footData[this.frontFoot].toePos);
        moveVec[1] = 0;
        let moveVel = vec3.length(moveVec);

        // Adjust speed when on slopes
        let groundAngle = 0;
        if( this.gndChk.polyInfo.bgIdx >= 0 && this.gndChk.polyInfo.triIdx >= 0) { // @TODO: Should be in cBgS::ChkPolySafe()
            groundAngle = this.getGroundAngle(globals, this.rot[1]);
        }
        moveVel *= Math.cos(cM_s2rad(groundAngle));        

        // ... Reduce velocity even more for ascending slopes
        if (groundAngle < 0) {
            moveVel = moveVel * 0.85;
        }

        // Update actor vel and position
        this.vel[0] = moveVel * Math.sin(cM_s2rad(this.rot[1]));
        this.vel[1] = moveVel * Math.cos(cM_s2rad(this.rot[1]));
        vec3.add(this.pos, this.pos, this.vel);

        for (let i = 0; i < 2; i++) {
            vec3.copy(this.footData[i].toePos, toePos[i]);
            vec3.copy(this.footData[i].heelPos, heelPos[i]);
        }
    }

    /**
     * Get the angle of the ground based when facing a specific direction
     * @param dir the s16 angle which the actor is facing
     */
    private getGroundAngle(globals: dGlobals, dir: number) {
        const gndPlane = globals.scnPlay.bgS.GetTriPla(this.gndChk.polyInfo.bgIdx, this.gndChk.polyInfo.triIdx);
        const norm = gndPlane.n;
    
        if (gndPlane && norm[1] >= 0.5) {
            const slopeDir = cM_atan2s(norm[0], norm[2]);
            const slopeGrade = Math.sqrt(norm[0] * norm[0] + norm[2] * norm[2]);
            return cM_atan2s(slopeGrade * Math.cos(cM_s2rad(slopeDir - dir)), norm[1]);
        }
        return 0;
    }

    private getAnmData(anmIdx: number): LkAnimData {
        // @TODO: Different table if sword is drawn
        return this.anmDataTable[anmIdx];
    }

    private setSingleMoveAnime(globals: dGlobals, anmIdx: number, rate?: number, start?: number, end?: number, morf: number = 0.0) {
        const anmData = this.getAnmData(anmIdx);

        const bck = globals.resCtrl.getObjectRes(ResType.Bck, "LkAnm", anmData.upperBckIdx);

        if(this.anmBck.anm != bck) {
            this.anmBck.init(this.model.modelData, bck, true, LoopMode.Repeat, rate, start, end);
        }
    }

    // Process used while a demo is telling Link to play a direct animation
    private procTool(globals: dGlobals) {
        const demoActor = globals.scnPlay.demo.getSystem().getActor(this.demoActorID);
        if (!demoActor)
            return;

        this.demoClampToGround = false;

        let anmFrame = 0.0;
        let anmBckId = 0xFFFF;
        let anmBtpId = 0xFFFF;
        let anmBtkId = 0xFFFF;

        if (demoActor.flags & EDemoActorFlags.HasPos) { vec3.copy(this.pos, demoActor.translation); }
        if (demoActor.flags & EDemoActorFlags.HasRot) { this.rot[1] = demoActor.rotation[1]; }
        if (demoActor.flags & EDemoActorFlags.HasFrame) { anmFrame = demoActor.animFrame; }

        if (demoActor.flags & EDemoActorFlags.HasData) {
            const status = demoActor.stbData.getUint8(0);
            let handIdxRight;
            let handIdxLeft;

            switch (demoActor.stbDataId) {
                case 3:
                    this.demoClampToGround = true;
                    // Fall through
                case 1:
                case 5:
                    const count = demoActor.stbData.getUint8(1);
                    assert(count == 3)
                    anmBckId = demoActor.stbData.getUint16(2);
                    anmBtpId = demoActor.stbData.getUint16(4);
                    anmBtkId = demoActor.stbData.getUint16(6);

                    handIdxRight = demoActor.stbData.getUint8(9);
                    handIdxLeft = demoActor.stbData.getUint8(10);
                    break;

                case 2:
                    this.demoClampToGround = true;
                    // Fall through
                case 0:
                case 4:
                    anmBckId = demoActor.stbData.getUint16(1);
                    break;

                default:
                    debugger;
            }

            // Set the hand model and/or equipped item based on the demo data
            let item = ItemNo.InvalidItem;
            if(handIdxLeft == 0xC8) { item = ItemNo.HerosSword; }
            else if(handIdxLeft == 0xC9) { item = ItemNo.MasterSwordPowerless; }
            else if(handIdxLeft == 0xCA) { item = ItemNo.MasterSwordHalfPower; }
            else if(handIdxLeft == 0xCB) { item = ItemNo.MasterSwordFullPower; }

            if(item == ItemNo.InvalidItem) {
                if(handIdxLeft == 0xCC) {
                    this.handStyleLeft = LkHandStyle.HoldWindWaker;
                    // Set the Wind Waker as the equipped item
                } else if (this.equippedItem != LkEquipItem.None) {
                    this.deleteEquipItem();
                    this.handStyleLeft = handIdxLeft as LkHandStyle;
                }
            } else {
                this.handStyleLeft = LkHandStyle.HoldSword;
                if (this.equippedItem != LkEquipItem.Sword) {
                    // d_com_inf_game::dComIfGs_setSelectEquip(0, item);
                    this.deleteEquipItem();
                    this.setSwordModel(globals);
                }
            }

            if(handIdxRight == 0xC8 || handIdxRight == 0xC9) {
                this.handStyleRight = LkHandStyle.HoldShield;
                if (handIdxRight == 0xC8) { /* equip HerosShield */ }
                else { /* equip MirrorShield */ }
            } else {
                if(handIdxRight != 0) {
                    this.handStyleRight = (handIdxRight as LkHandStyle) + 6;
                } else {
                    this.handStyleRight = LkHandStyle.Idle;
                }
            }
        }

        if (anmBckId == 0xFFFF || this.anmBckId == anmBckId) {
            if (demoActor.flags & EDemoActorFlags.HasFrame) {
                this.anmBck.frameCtrl.currentTimeInFrames = anmFrame;
                this.anmBtp.frameCtrl.currentTimeInFrames = anmFrame;
                demoActor.animFrameMax = this.anmBck.frameCtrl.endFrame;
            }
        } else {
            // TODO: How should LkD00 arc be loaded?
            const bck = globals.resCtrl.getObjectIDRes(ResType.Bck, 'LkD00', anmBckId);
            this.anmBck.init(this.model.modelData, bck, true, bck.loopMode, 1.0, 0, bck.duration);
            this.anmBck.frameCtrl.currentTimeInFrames = anmFrame;
            this.anmBckId = anmBckId;

            if (anmBtpId != 0xFFFF) {
                const btp = globals.resCtrl.getObjectIDRes(ResType.Btp, 'LkD00', anmBtpId);
                this.anmBtp.init(this.model.modelData, btp, true, btp.loopMode, 1.0, 0, btp.duration);
            }

            if (anmBtkId != 0xFFFF) {
                const btk = globals.resCtrl.getObjectIDRes(ResType.Btk, 'LkD00', anmBtkId);
                this.anmBtk.init(this.model.modelData, btk, true, btk.loopMode, 1.0, 0, btk.duration);
            }
        }
    }

    private setSwordModel(globals: dGlobals) {
        this.equippedItem = LkEquipItem.Sword;
        this.equippedItemModel = this.initModel(globals, d_a_py_lk.LINK_BDL_SWA);
    }

    private deleteEquipItem() {
        this.equippedItem = LkEquipItem.None;
        this.equippedItemModel = null;
    }

    private setItemModel() {
        if(!this.equippedItemModel) {
            return;
        }

        const handLJointMtx = this.model.shapeInstanceState.jointToWorldMatrixArray[0x08];
        const handRJointMtx = this.model.shapeInstanceState.jointToWorldMatrixArray[0x0D];
        
        mat4.copy(this.equippedItemModel.modelMatrix, handLJointMtx);
        this.equippedItemModel?.calcAnim();

        if(this.equippedItem == LkEquipItem.Sword) {
            mat4.copy(this.modelSwordHilt.modelMatrix, handLJointMtx);
            this.modelSwordHilt.calcAnim();
        }
    }

    private procWait_init(globals: dGlobals) {
        this.setSingleMoveAnime(globals, LkAnim.WAITS);
    }

    private loadAnmTable(globals: dGlobals) {
        const anmDataView = globals.findExtraSymbolData(`d_a_player_main.o`, `mAnmDataTable__9daPy_lk_c`).createDataView();
        let offset = 0;
        while (offset < anmDataView.byteLength) {
            this.anmDataTable.push({
                underBckIdx: anmDataView.getUint16(offset + 0),
                upperBckIdx: anmDataView.getUint16(offset + 2),
                leftHandIdx: anmDataView.getUint8(offset + 4),
                rightHandIdx: anmDataView.getUint8(offset + 5),
                texAnmIdx: anmDataView.getUint16(offset + 6),
            })
            offset += 8;
        }
    }
}

interface constructor extends fpc_bs__Constructor {
    PROCESS_NAME: dProcName_e;
}

export function d_a__RegisterConstructors(globals: fGlobals): void {
    function R(constructor: constructor): void {
        fpcPf__Register(globals, constructor.PROCESS_NAME, constructor);
    }

    R(d_a_grass);
    R(d_a_obj_wood);
    R(d_a_ep);
    R(d_a_bg);
    R(d_a_vrbox);
    R(d_a_vrbox2);
    R(d_a_sea);
    R(d_a_kytag00);
    R(d_a_kytag01);
    R(d_a_obj_Ygush00);
    R(d_a_obj_lpalm);
    R(d_a_obj_zouK);
    R(d_a_swhit0);
    R(d_a_mgameboard);
    R(d_a_sie_flag);
    R(d_a_tori_flag);
    R(d_a_majuu_flag);
    R(d_a_kamome);
    R(d_a_obj_ikada);
    R(d_a_oship);
    R(d_a_obj_flame);
    R(d_a_ff);
    R(d_a_npc_ls1);
    R(d_a_py_lk);
}
