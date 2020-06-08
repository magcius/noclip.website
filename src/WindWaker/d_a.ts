
import { fopAc_ac_c, cPhs__Status, fGlobals, fpcPf__Register, fpc__ProcessName, fpc_bs__Constructor } from "./framework";
import { dGlobals } from "./zww_scenes";
import { vec3, mat4, quat } from "gl-matrix";
import { dComIfG_resLoad, ResType } from "./d_resorce";
import { J3DModelInstance, J3DModelData, buildEnvMtx } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { settingTevStruct, LightType, setLightTevColorType, LIGHT_INFLUENCE, dKy_plight_set, dKy_plight_cut, dKy_tevstr_c, dKy_tevstr_init, dKy_checkEventNightStop, dKy_change_colpat, dKy_setLight__OnModelInstance, WAVE_INFLUENCE, dKy__waveinfl_cut, dKy__waveinfl_set } from "./d_kankyo";
import { mDoExt_modelUpdateDL, mDoExt_btkAnm, mDoExt_brkAnm, mDoExt_bckAnm } from "./m_do_ext";
import { JPABaseEmitter } from "../Common/JSYSTEM/JPA";
import { cLib_addCalc2, cLib_addCalc, cLib_addCalcAngleRad2, cM_rndFX, cM_rndF } from "./SComponent";
import { dStage_Multi_c } from "./d_stage";
import { nArray, assertExists, assert } from "../util";
import { TTK1, LoopMode, TRK1, TexMtx } from "../Common/JSYSTEM/J3D/J3DLoader";
import { colorCopy, colorNewCopy, TransparentBlack, colorNewFromRGBA8 } from "../Color";
import { dKyw_rain_set, ThunderMode, dKyw_get_wind_vec, dKyw_get_wind_pow, dKyr_get_vectle_calc } from "./d_kankyo_wether";
import { ColorKind, GXMaterialHelperGfx, ub_PacketParams, ub_PacketParamsBufferSize, MaterialParams, PacketParams, fillPacketParamsData } from "../gx/gx_render";
import { d_a_sea } from "./d_a_sea";
import { saturate, Vec3UnitY, Vec3Zero, computeModelMatrixS, computeMatrixWithoutTranslation, clamp } from "../MathHelpers";
import { dBgW, cBgW_Flags } from "./d_bg";
import { TSDraw } from "../SuperMarioGalaxy/DDraw";
import { BTIData } from "../Common/JSYSTEM/JUTTexture";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX from '../gx/gx_enum';
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GlobalSaveManager } from "../SaveManager";

// Framework'd actors

const kUshortTo2PI = Math.PI / 0x7FFF;

export function mDoMtx_XrotM(dst: mat4, n: number): void {
    mat4.rotateX(dst, dst, n * kUshortTo2PI);
}

export function mDoMtx_YrotS(dst: mat4, n: number): void {
    mat4.identity(dst);
    mat4.rotateY(dst, dst, n * kUshortTo2PI);
}

export function mDoMtx_YrotM(dst: mat4, n: number): void {
    mat4.rotateY(dst, dst, n * kUshortTo2PI);
}

export function mDoMtx_ZrotM(dst: mat4, n: number): void {
    mat4.rotateZ(dst, dst, n * kUshortTo2PI);
}

export function mDoMtx_ZYXrotM(dst: mat4, v: vec3): void {
    mat4.rotateZ(dst, dst, v[2] * kUshortTo2PI);
    mat4.rotateY(dst, dst, v[1] * kUshortTo2PI);
    mat4.rotateX(dst, dst, v[0] * kUshortTo2PI);
}

export function mDoMtx_XYZrotM(dst: mat4, v: vec3): void {
    mat4.rotateX(dst, dst, v[0] * kUshortTo2PI);
    mat4.rotateY(dst, dst, v[1] * kUshortTo2PI);
    mat4.rotateZ(dst, dst, v[2] * kUshortTo2PI);
}

export const calc_mtx = mat4.create();

export function MtxTrans(pos: vec3, concat: boolean, m: mat4 = calc_mtx): void {
    if (concat) {
        mat4.translate(m, m, pos);
    } else {
        mat4.fromTranslation(m, pos);
    }
}

export function MtxPosition(dst: vec3, src: vec3 = dst, m: mat4 = calc_mtx): void {
    vec3.transformMat4(dst, src, m);
}

export function quatM(q: quat, dst = calc_mtx, scratch = scratchMat4a): void {
    mat4.fromQuat(scratch, q);
    mat4.mul(dst, dst, scratch);
}

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

class d_a_grass extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_grass;

    static kSpawnPatterns = [
        { group: 0, count: 1 },
        { group: 0, count: 7 },
        { group: 1, count: 15 },
        { group: 2, count: 3 },
        { group: 3, count: 7 },
        { group: 4, count: 11 },
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
            [-18, 0, -65],
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

    public subload(globals: dGlobals): cPhs__Status {
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

// TODO(jstpierre): Bad hack
export function createEmitter(globals: dGlobals, resourceId: number): JPABaseEmitter {
    const renderer = globals.renderer;
    const emitter = renderer.effectSystem!.createBaseEmitter(renderer.device, renderer.renderCache, resourceId);
    return emitter;
}

export function setModelAlphaUpdate(model: J3DModelInstance, alphaUpdate: boolean): void {
    for (let i = 0; i < model.materialInstances.length; i++)
        model.materialInstances[i].setAlphaWriteEnabled(alphaUpdate);
}

export function initModelForZelda(model: J3DModelInstance): void {
    setModelAlphaUpdate(model, false);
}

// -------------------------------------------------------
// Generic Torch
// -------------------------------------------------------
class d_a_ep extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_ep;

    private type: number;
    private hasGa: boolean;
    private hasObm: boolean;
    private model: J3DModelInstance;
    private posTop = vec3.create();
    private light = new LIGHT_INFLUENCE();
    private state: number = 0;
    private lightPower: number = 0.0;
    private lightPowerTarget: number = 0.0;

    public subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, `Ep`);
        if (status !== cPhs__Status.Complete)
            return status;

        this.hasGa = !!((this.parameters >>> 6) & 0x01);
        this.hasObm = !!((this.parameters >>> 7) & 0x01);
        this.type = (this.parameters & 0x3F);
        if (this.type === 0x3F)
            this.type = 0;

        if (this.type === 0 || this.type === 3) {
            this.model = new J3DModelInstance(globals.resCtrl.getObjectRes(ResType.Model, `Ep`, this.hasObm ? 0x04 : 0x05));
            initModelForZelda(this.model);
        }

        this.CreateInit();

        dKy_plight_set(globals.g_env_light, this.light);

        // Create particle systems.

        // TODO(jstpierre): Implement the real thing.
        const pa = createEmitter(globals, 0x0001);
        vec3.copy(pa.globalTranslation, this.posTop);
        pa.globalTranslation[1] += -240 + 235 + 15;
        if (this.type !== 2) {
            const pb = createEmitter(globals, 0x4004);
            vec3.copy(pb.globalTranslation, pa.globalTranslation);
            pb.globalTranslation[1] += 20;
        }
        const pc = createEmitter(globals, 0x01EA);
        vec3.copy(pc.globalTranslation, this.posTop);
        pc.globalTranslation[1] += -240 + 235 + 8;
        // TODO(jstpierre): ga

        return cPhs__Status.Next;
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.type === 0 || this.type === 3) {
            settingTevStruct(globals, LightType.BG0, this.pos, this.tevStr);
            setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
            mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
        }
    }

    public execute(globals: dGlobals): void {
        if (this.type === 0 || this.type === 3) {
            if (this.hasGa)
                this.ga_move();
        }

        this.ep_move();
    }

    public delete(globals: dGlobals): void {
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
        this.anm.init(modelData, anmData, true, LoopMode.REPEAT);
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
        this.anm.init(modelData, anmData, true, LoopMode.REPEAT);
    }

    public entry(modelInstance: J3DModelInstance): void {
        this.anm.entry(modelInstance);
    }

    public play(deltaTimeFrames: number): void {
        this.anm.play(deltaTimeFrames);
    }
}

class d_a_bg extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_bg;

    private numBg = 4;
    private bgModel: (J3DModelInstance | null)[] = nArray(this.numBg, () => null);
    private bgBtkAnm: (daBg_btkAnm_c | null)[] = nArray(this.numBg, () => null);
    private bgBrkAnm: (daBg_brkAnm_c | null)[] = nArray(this.numBg, () => null);
    private bgTevStr: (dKy_tevstr_c | null)[] = nArray(this.numBg, () => null);
    private bgW = new dBgW();

    public subload(globals: dGlobals): cPhs__Status {
        const resCtrl = globals.resCtrl;

        const roomNo = this.parameters;
        const arcName = `Room` + roomNo;

        const modelName  = ['model.bmd', 'model1.bmd', 'model2.bmd', 'model3.bmd'];
        const modelName2 = ['model.bdl', 'model1.bdl', 'model2.bdl', 'model3.bdl'];
        const btkName    = ['model.btk', 'model1.btk', 'model2.btk', 'model3.btk'];
        const brkName    = ['model.brk', 'model1.brk', 'model2.brk', 'model3.brk'];

        // createHeap
        for (let i = 0; i < this.numBg; i++) {
            let modelData = resCtrl.getStageResByName(ResType.Model, arcName, modelName[i]);
            if (modelData === null)
                modelData = resCtrl.getStageResByName(ResType.Model, arcName, modelName2[i]);
            if (modelData === null)
                continue;
            this.bgModel[i] = new J3DModelInstance(modelData);
            initModelForZelda(this.bgModel[i]!);

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

        dKy_tevstr_init(globals.roomStatus[roomNo].tevStr, roomNo, -1);

        return cPhs__Status.Next;
    }

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        for (let i = 0; i < this.numBg; i++) {
            if (this.bgBtkAnm[i] !== null)
                this.bgBtkAnm[i]!.play(deltaTimeInFrames);
            if (this.bgBrkAnm[i] !== null)
                this.bgBrkAnm[i]!.play(deltaTimeInFrames);
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
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
        settingTevStruct(globals, LightType.BG0, null, globals.roomStatus[roomNo].tevStr);
    }

    public delete(globals: dGlobals): void {
        globals.scnPlay.bgS.Release(this.bgW);
    }
}

class d_a_vrbox extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_vrbox;
    private model: J3DModelInstance;

    public subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        const res = assertExists(globals.resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_sky.bdl`));
        this.model = new J3DModelInstance(res);
        initModelForZelda(this.model);

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

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
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

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
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

        dKy_setLight__OnModelInstance(envLight, this.model, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput, globals.dlst.sky);
    }
}

class d_a_vrbox2 extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_vrbox2;
    private backCloud: J3DModelInstance;
    private kasumiMae: J3DModelInstance | null = null;
    private kasumiMaeC0 = colorNewCopy(TransparentBlack);
    private kasumiMaeK0 = colorNewCopy(TransparentBlack);
    private usoUmi: J3DModelInstance | null = null;

    public subload(globals: dGlobals): cPhs__Status {
        const backCloudRes = assertExists(globals.resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_back_cloud.bdl`));
        this.backCloud = new J3DModelInstance(backCloudRes);
        initModelForZelda(this.backCloud);

        const kasumiMaeRes = globals.resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_kasumi_mae.bdl`);
        if (kasumiMaeRes !== null) {
            this.kasumiMae = new J3DModelInstance(kasumiMaeRes);
            initModelForZelda(this.kasumiMae);
        }

        const usoUmiRes = globals.resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_uso_umi.bdl`);
        if (usoUmiRes !== null) {
            this.usoUmi = new J3DModelInstance(usoUmiRes);
            initModelForZelda(this.usoUmi);
        }

        return cPhs__Status.Next;
    }

    private daVrbox2_color_set(globals: dGlobals, deltaTimeInFrames: number): void {
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

        const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
        if (roomType === 2) {
            // TODO(jstpierre): #TACT_WIND. Overwrite with tact wind. LinkRM / Orichh / Ojhous2 / Omasao / Onobuta
        }

        // Camera forward in XZ plane
        vec3.copy(scratchVec3a, globals.cameraFwd);
        scratchVec3a[1] = 0;
        vec3.normalize(scratchVec3a, scratchVec3a);

        const scrollSpeed0 = deltaTimeInFrames * windPower * 0.0005 * ((-windX * scratchVec3a[2]) - (-windZ * scratchVec3a[0]));

        let mtx: mat4;
        const backMat0 = this.backCloud.materialInstances[0].materialData.material;
        mtx = backMat0.texMatrices[0]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed0) % 1.0;

        mtx = backMat0.texMatrices[1]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed0) % 1.0;

        const scrollSpeed1 = scrollSpeed0 * 0.8;

        const backMat1 = this.backCloud.materialInstances[1].materialData.material;
        mtx = backMat1.texMatrices[0]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed1) % 1.0;

        mtx = backMat1.texMatrices[1]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed1) % 1.0;

        const scrollSpeed2 = scrollSpeed0 * 0.6;

        const backMat2 = this.backCloud.materialInstances[2].materialData.material;
        mtx = backMat2.texMatrices[0]!.matrix;
        mtx[12] = (mtx[12] + scrollSpeed2) % 1.0;

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

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        this.daVrbox2_color_set(globals, deltaTimeInFrames);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const envLight = globals.g_env_light;

        let sum = 0;
        sum += envLight.vrKasumiMaeCol.r + envLight.vrKasumiMaeCol.g + envLight.vrKasumiMaeCol.b;
        sum += envLight.vrSkyCol.r + envLight.vrSkyCol.g + envLight.vrSkyCol.b;
        sum += envLight.vrKumoCol.r + envLight.vrKumoCol.g + envLight.vrKumoCol.b;
        if (sum === 0)
            return;

        let skyboxOffsY = 0;
        const fili = globals.roomStatus[globals.mStayNo].fili;
        if (fili !== null)
            skyboxOffsY = fili.skyboxY;

        MtxTrans(globals.cameraPosition, false);
        calc_mtx[13] -= 0.09 * (globals.cameraPosition[1] - skyboxOffsY);

        if (this.usoUmi !== null) {
            mat4.copy(this.usoUmi.modelMatrix, calc_mtx);
            dKy_setLight__OnModelInstance(envLight, this.usoUmi, viewerInput.camera);
            mDoExt_modelUpdateDL(globals, this.usoUmi, renderInstManager, viewerInput, globals.dlst.sky);
        }

        if (this.kasumiMae !== null) {
            mat4.copy(this.kasumiMae.modelMatrix, calc_mtx);
            dKy_setLight__OnModelInstance(envLight, this.kasumiMae, viewerInput.camera);
            mDoExt_modelUpdateDL(globals, this.kasumiMae, renderInstManager, viewerInput, globals.dlst.sky);
        }

        calc_mtx[13] += 100.0;
        mat4.copy(this.backCloud.modelMatrix, calc_mtx);
        dKy_setLight__OnModelInstance(envLight, this.backCloud, viewerInput.camera);
        mDoExt_modelUpdateDL(globals, this.backCloud, renderInstManager, viewerInput, globals.dlst.sky);
    }
}

const enum KytagEffectMode {
    None = 0x00,
    Rain = 0x01,
    Moya2 = 0x02,
    Moya3 = 0x03,
    Moya4 = 0x04,
    Moya5 = 0x05,
    Housi = 0x06,
    Thunder = 0x07,
    ThunderAndRain = 0x08,
    Moya9 = 0x09,
    MoyaA = 0x0A,
    MoyaB = 0x0B,
};

class d_a_kytag00 extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_kytag00;

    private pselIdx = 0;
    private effectMode = KytagEffectMode.None;
    private invert = false;
    private alwaysCheckPlayerPos = false;
    private target = 0.0;
    private effectSet = false;
    private pselSet = false;

    // Cylinder
    private innerFadeY = 0.0;
    private innerRadius = 0.0;
    private outerRadius = 0.0;

    public subload(globals: dGlobals): cPhs__Status {
        this.pselIdx = this.parameters & 0xFF;
        this.effectMode = (this.parameters >>> 8) & 0xFF;
        this.invert = !!((this.rot[0] >>> 8) & 0xFF);
        this.alwaysCheckPlayerPos = !!(this.rot[2] & 0xFF);

        if (this.invert) {
            this.target = 1.0;
        } else {
            this.target = 0.0;
        }

        this.innerFadeY = ((this.parameters >> 24) & 0xFF) * 100.0;

        const paramRadius = (this.parameters >>> 16) & 0xFF;
        if (this.alwaysCheckPlayerPos) {
            this.innerRadius = this.scale[0] * 500.0;
            this.outerRadius = this.innerRadius + paramRadius * 10.0;
        } else {
            this.innerRadius = this.scale[0] * 5000.0;
            this.outerRadius = this.innerRadius + paramRadius * 100.0;
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

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
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

            if (envLight.envrIdxPrev === envLight.envrIdxCurr && this.pselIdx < 4) {
                this.pselSet = true;

                if (target > 0.5) {
                    envLight.blendPselGather = target;
                    envLight.pselIdxPrevGather = envLight.weatherPselIdx;
                    envLight.pselIdxCurrGather = this.pselIdx;
                    envLight.colSetModeGather = 1;
                } else {
                    envLight.blendPselGather = 1.0 - target;
                    envLight.pselIdxPrevGather = this.pselIdx;
                    envLight.pselIdxCurrGather = envLight.weatherPselIdx;
                    envLight.colSetModeGather = 1;
                }
            }

            // wether_tag_efect_move
            this.effectSet = true;

            if (this.effectMode === KytagEffectMode.Rain) {
                this.raincnt_set(globals, target);
            } else if (this.effectMode === KytagEffectMode.Thunder) {
                if (envLight.thunderMode === 0)
                    envLight.thunderMode = 2;
            } else if (this.effectMode === KytagEffectMode.ThunderAndRain) {
                if (envLight.thunderMode === 0)
                    envLight.thunderMode = 2;
                this.raincnt_set(globals, target);
            } else if (this.effectMode === KytagEffectMode.Moya9) {
                // TODO(jstpierre): moya
                if (envLight.thunderMode === 0)
                    envLight.thunderMode = 2;
                this.raincnt_set(globals, target);
            } else {
                // TODO(jstpierre): The rest of the modes.
            }
        } else {
            if (this.pselSet) {
                this.pselSet = false;
                envLight.pselIdxPrevGather = envLight.weatherPselIdx;
                envLight.pselIdxCurrGather = envLight.weatherPselIdx;
                envLight.blendPselGather = 0.0;
                envLight.colSetModeGather = 1;
            }

            if (this.effectSet) {
                this.effectSet = false;

                if (this.effectMode === KytagEffectMode.Rain) {
                    this.raincnt_cut(globals);
                } else if (this.effectMode === KytagEffectMode.Thunder) {
                    if (envLight.thunderMode === 2)
                        envLight.thunderMode = 0;
                } else if (this.effectMode === KytagEffectMode.ThunderAndRain) {
                    if (envLight.thunderMode === 2)
                        envLight.thunderMode = 0;
                    this.raincnt_cut(globals);
                } else if (this.effectMode === KytagEffectMode.Moya9) {
                    // TODO(jstpierre): moya
                    if (envLight.thunderMode === 2)
                        envLight.thunderMode = 0;
                    this.raincnt_cut(globals);
                }
            }
        }
    }
}

class d_a_kytag01 extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_kytag01;

    private influence = new WAVE_INFLUENCE();

    public subload(globals: dGlobals): cPhs__Status {
        vec3.copy(this.influence.pos, this.pos);

        this.influence.innerRadius = this.scale[0] * 5000.0;
        this.influence.outerRadius = Math.max(this.scale[2] * 5000.0, this.influence.innerRadius + 500.0);
        dKy__waveinfl_set(globals.g_env_light, this.influence);

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
            envLight.waveSpawnRadius = 30;
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

    public delete(globals: dGlobals): void {
        dKy__waveinfl_cut(globals.g_env_light, this.influence);
    }
}

class d_a_obj_Ygush00 extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_obj_Ygush00;

    private type: number;
    private model: J3DModelInstance;
    private btkAnm = new mDoExt_btkAnm();
    private bckAnm = new mDoExt_bckAnm();

    public subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, `Ygush00`);
        if (status !== cPhs__Status.Complete)
            return status;

        this.type = this.parameters & 0x03;
        const mdl_table = [0x0A, 0x09, 0x09, 0x09];
        const btk_table = [0x0E, 0x0D, 0x0D, 0x0D];
        const bck_table = [0x06, 0x05, 0x05, 0x05];

        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Ygush00`, mdl_table[this.type]));
        initModelForZelda(this.model);
        this.btkAnm.init(this.model.modelData, resCtrl.getObjectRes(ResType.Btk, `Ygush00`, btk_table[this.type]), true, LoopMode.REPEAT);
        this.bckAnm.init(this.model.modelData, resCtrl.getObjectRes(ResType.Bck, `Ygush00`, bck_table[this.type]), true, LoopMode.REPEAT);

        vec3.copy(this.model.baseScale, this.scale);
        mat4.translate(this.model.modelMatrix, this.model.modelMatrix, this.pos);

        return cPhs__Status.Next;
    }

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        if (this.type !== 3) {
            this.btkAnm.play(deltaTimeInFrames);
            this.bckAnm.play(deltaTimeInFrames);
        }

        if (this.type === 1) {
            // Judge for Gryw00 nearby
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        settingTevStruct(globals, LightType.BG1, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);

        this.btkAnm.entry(this.model);
        this.bckAnm.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }
}

class d_a_obj_lpalm extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_obj_lpalm;

    private model: J3DModelInstance;

    private baseQuat = quat.create();
    private baseQuatTarget = quat.create();
    private animDir = nArray(2, () => 0);
    private animWave = nArray(2, () => 0);
    private animMtxQuat = nArray(2, () => quat.create());

    public subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, `Oyashi`);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Oyashi`, 0x04));
        initModelForZelda(this.model);
        this.model.jointMatrixCalcCallback = this.nodeCallBack;

        mat4.translate(this.model.modelMatrix, this.model.modelMatrix, this.pos);
        mDoMtx_ZYXrotM(this.model.modelMatrix, this.rot);

        return cPhs__Status.Next;
    }

    private nodeCallBack = (dst: mat4, i: number): void => {
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

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        const envLight = globals.g_env_light;

        const windVec = dKyw_get_wind_vec(envLight);
        const windPow = dKyw_get_wind_pow(envLight);

        mDoMtx_YrotS(calc_mtx, -this.rot[1]);
        MtxPosition(scratchVec3a, windVec);

        vec3.set(scratchVec3b, 0, 1, 0);
        vec3.cross(scratchVec3b, scratchVec3b, scratchVec3a);

        if (vec3.length(scratchVec3b) >= 0.00000001) {
            vec3.normalize(scratchVec3b, scratchVec3b);
            quat.setAxisAngle(this.baseQuatTarget, scratchVec3b, windPow * (0x600 * kUshortTo2PI));
        } else {
            quat.identity(this.baseQuatTarget);
        }

        quat.slerp(this.baseQuat, this.baseQuat, this.baseQuatTarget, 0.25);

        for (let i = 0; i < 2; i++) {
            const animDirTarget = Math.min(windPow * 0x180, 0x100);
            this.animDir[i] = cLib_addCalcAngleRad2(this.animDir[i], animDirTarget * kUshortTo2PI, 0x04 * kUshortTo2PI, 0x20 * kUshortTo2PI);

            // Rock back and forth.
            this.animWave[i] += ((windPow * 0x800) + cM_rndFX(0x80)) * kUshortTo2PI * deltaTimeInFrames;
            const wave = Math.sin(this.animWave[i]);

            vec3.set(scratchVec3a, wave, 0, wave);
            quat.setAxisAngle(this.animMtxQuat[i], scratchVec3a, this.animDir[i]);
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
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
        vec3.set(dst, 0, 0, 0);
}

class d_a_obj_zouK1 extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_obj_zouK1;

    private model: J3DModelInstance;
    private bckAnm = new mDoExt_bckAnm();
    private effectMtx = mat4.create();

    public subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, `VzouK`);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `VzouK`, 0x08));
        initModelForZelda(this.model);

        const anm = resCtrl.getObjectRes(ResType.Bck, `VzouK`, 0x05);
        this.bckAnm.init(this.model.modelData, anm, true, LoopMode.ONCE, 0.0, anm.duration);
        this.bckAnm.play(0.0);

        for (let i = 0; i < this.model.materialInstances.length; i++)
            this.model.materialInstances[i].effectMtxCallback = this.effectMtxCallback;

        return cPhs__Status.Next;
    }

    private effectMtxCallback = (dst: mat4, texMtx: TexMtx): void => {
        mat4.copy(dst, this.effectMtx);
    }

    private set_mtx(): void {
        vec3.copy(this.model.baseScale, this.scale);
        MtxTrans(this.pos, false, this.model.modelMatrix);
        mDoMtx_ZYXrotM(this.model.modelMatrix, this.rot);
    }

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        this.set_mtx();
    }

    private setEffectMtx(globals: dGlobals, pos: vec3, refl: number): void {
        const scale = 1.0 / refl;
        computeModelMatrixS(this.effectMtx, scale, scale, 1.0);

        // Remap.
        buildEnvMtx(scratchMat4a, 1.0);
        mat4.mul(this.effectMtx, this.effectMtx, scratchMat4a);

        // Half-vector lookAt transform.
        vec3.sub(scratchVec3a, pos, globals.cameraPosition);
        dKyr_get_vectle_calc(this.tevStr.lightObj.Position, pos, scratchVec3b);
        vecHalfAngle(scratchVec3a, scratchVec3a, scratchVec3b);
        mat4.lookAt(scratchMat4a, Vec3Zero, scratchVec3a, Vec3UnitY);
        mat4.mul(this.effectMtx, this.effectMtx, scratchMat4a);

        computeMatrixWithoutTranslation(this.effectMtx, this.effectMtx);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        settingTevStruct(globals, LightType.Actor, this.pos, this.tevStr);
        setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
        this.setEffectMtx(globals, this.pos, 0.5);
        this.bckAnm.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }
}

class d_a_swhit0 extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_swhit0;

    private model: J3DModelInstance;
    private bckAnm = new mDoExt_bckAnm();
    private btkAnm = new mDoExt_btkAnm();
    private static color1Normal = colorNewFromRGBA8(0xF0F5FF6E);
    private static color2Normal = colorNewFromRGBA8(0x6E786432);
    private static color1Hit = colorNewFromRGBA8(0xE6C8006E);
    private static color2Hit = colorNewFromRGBA8(0x78643264);

    public subload(globals: dGlobals): cPhs__Status {
        const resCtrl = globals.resCtrl;
        this.model = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Always`, 0x35));
        initModelForZelda(this.model);

        const bckAnm = resCtrl.getObjectRes(ResType.Bck, `Always`, 0x0D);
        this.bckAnm.init(this.model.modelData, bckAnm, true, LoopMode.REPEAT, 1.0, 0);

        const btkAnm = resCtrl.getObjectRes(ResType.Btk, `Always`, 0x58);
        this.btkAnm.init(this.model.modelData, btkAnm, true, LoopMode.REPEAT, 1.0, 0);

        this.rot[2] = 0.0;
        this.setDrawMtx();

        return cPhs__Status.Next;
    }

    private setDrawMtx(): void {
        vec3.copy(this.model.baseScale, this.scale);
        MtxTrans(this.pos, false, this.model.modelMatrix);
        mDoMtx_XYZrotM(this.model.modelMatrix, this.rot);
    }

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        this.bckAnm.play(deltaTimeInFrames);
        this.btkAnm.play(deltaTimeInFrames);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
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
const packetParams = new PacketParams();

// Simple quad shape & input.
export class dDlst_2DStatic_c {
    private ddraw = new TSDraw();

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        const size = 1;
        this.ddraw.beginDraw();
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

        this.ddraw.endDraw(device, cache);
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

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        const offs = this.materialHelper.allocateMaterialParams(renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        renderInst.allocateUniformBuffer(ub_PacketParams, ub_PacketParamsBufferSize);
        mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, this.modelMatrix);
        fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams);

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
        const template = renderInstManager.pushTemplateRenderInst();

        globals.quadStatic.setOnRenderInst(template);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
        const offs = this.materialHelper.allocateMaterialParams(template);
        this.materialHelper.fillMaterialParamsDataOnInst(template, offs, materialParams);

        let value = this.value;

        let x = 0;
        for (let i = 0; i < this.numDigits; i++) {
            const digit = value % 10;
            value = (value / 10) | 0;

            const renderInst = renderInstManager.newRenderInst();
            this.texData[digit].fillTextureMapping(materialParams.m_TextureMapping[0]);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
            renderInst.allocateUniformBuffer(ub_PacketParams, ub_PacketParamsBufferSize);

            vec3.set(scratchVec3a, x, 0, 0);
            mat4.translate(scratchMat4a, this.modelMatrix, scratchVec3a);
            mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchMat4a);
            x -= this.spacing * 2;

            fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams);
            renderInstManager.submitRenderInst(renderInst);

            // No more digits.
            if (value === 0)
                break;
        }

        renderInstManager.popTemplateRenderInst();
    }
}

class d_a_mgameboard extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_mgameboard;

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

    public subload(globals: dGlobals): cPhs__Status {
        let status: cPhs__Status;

        status = dComIfG_resLoad(globals, `Kaisen_e`);
        if (status !== cPhs__Status.Complete)
            return status;

        status = this.scoreNum.subload(globals);
        if (status !== cPhs__Status.Complete)
            return status;

        status = this.highscoreNum.subload(globals);
        if (status !== cPhs__Status.Complete)
            return status;

        const resCtrl = globals.resCtrl;

        this.boardModel = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Kaisen_e`, 0x08));
        this.cursorModel = new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Kaisen_e`, 0x09));
        this.highscorePad = new dDlst_2DObject_c(resCtrl.getObjectRes(ResType.Bti, `Kaisen_e`, 0x11));
        this.highscoreLabel = new dDlst_2DObject_c(resCtrl.getObjectRes(ResType.Bti, `Kaisen_e`, 0x0E));

        this.loadHighscore();
        this.minigameInit(globals);

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

    private minigameInit(globals: dGlobals): void {
        const resCtrl = globals.resCtrl;

        this.minigame.init(24, 3);

        for (let i = this.missModels.length; i < this.minigame.bulletNum; i++)
            this.missModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Kaisen_e`, 10)));

        for (let i = this.hitModels.length; i < this.minigame.bulletNum; i++)
            this.hitModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Kaisen_e`, 7)));

        const bulletData0 = resCtrl.getObjectRes(ResType.Bti, `Kaisen_e`, 0x0F);
        const bulletData1 = resCtrl.getObjectRes(ResType.Bti, `Kaisen_e`, 0x10);
        for (let i = this.bullet.length; i < this.minigame.bulletNum; i++)
            this.bullet.push(new dDlst_2DObject_c(bulletData0, bulletData1));

        const squidData0 = resCtrl.getObjectRes(ResType.Bti, `Kaisen_e`, 0x12);
        const squidData1 = resCtrl.getObjectRes(ResType.Bti, `Kaisen_e`, 0x13);
        for (let i = this.squid.length; i < this.minigame.ships.length; i++)
            this.squid.push(new dDlst_2DObject_c(squidData0, squidData1));

        this.shipModels.length = 0;
        for (let i = 0; i < this.minigame.ships.length; i++) {
            const ship = this.minigame.ships[i];
            const size = ship.numTotalParts;
            if (size === 2)
                this.shipModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Kaisen_e`, 4)));
            else if (size === 3)
                this.shipModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Kaisen_e`, 5)));
            else if (size === 4)
                this.shipModels.push(new J3DModelInstance(resCtrl.getObjectRes(ResType.Model, `Kaisen_e`, 6)));
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
        } else {
            // Hit ship.
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

    private minigameMain(globals: dGlobals): void {
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
        this.minigameInit(globals);
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

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        const inputManager = globals.context.inputManager;
        if (this.minigameResetTimer >= 0) {
            this.minigameResetTimer -= deltaTimeInFrames;
            if (this.minigameResetTimer <= 0 || inputManager.isKeyDownEventTriggered('KeyF'))
                this.minigameDeactivate(globals);
        } else if (this.minigame.bulletNum === 0 || this.minigame.aliveShipNum === 0) {
            this.minigameDone(globals);
        } else if (this.minigameActive) {
            this.minigameMain(globals);
        } else {
            // happy easter!!!!!!!!!!!!!!!!!!!!!!!!!
            if (inputManager.isKeyDownEventTriggered('KeyF'))
                this.minigameActivate(globals);
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
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

        renderInstManager.setCurrentRenderInstList(globals.dlst.ui[1]);
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

interface constructor extends fpc_bs__Constructor {
    PROCESS_NAME: fpc__ProcessName;
}

export function d_a__RegisterConstructors(globals: fGlobals): void {
    function R(constructor: constructor): void {
        fpcPf__Register(globals, constructor.PROCESS_NAME, constructor);
    }

    R(d_a_grass);
    R(d_a_ep);
    R(d_a_bg);
    R(d_a_vrbox);
    R(d_a_vrbox2);
    R(d_a_sea);
    R(d_a_kytag00);
    R(d_a_kytag01);
    R(d_a_obj_Ygush00);
    R(d_a_obj_lpalm);
    R(d_a_obj_zouK1);
    R(d_a_swhit0);
    R(d_a_mgameboard);
}
