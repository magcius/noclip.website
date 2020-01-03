
import { Color, colorNewCopy, White, colorFromRGBA, TransparentBlack } from "../Color";
import { Light, lightSetFromWorldLight } from "../gx/gx_material";
import { vec3 } from "gl-matrix";
import { stage_palet_info_class, stage_pselect_info_class, stage_envr_info_class, stage_vrbox_info_class, stage_palet_info_class__DifAmb } from "./d_stage";
import { lerp, invlerp, clamp } from "../MathHelpers";
import { nArray, assert } from "../util";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { Camera } from "../Camera";
import { ColorKind } from "../gx/gx_render";
import { dGlobals } from "./zww_scenes";
import ArrayBufferSlice from "../ArrayBufferSlice";

const enum LightMode {
    BG,
    Actor,
    BGwithPlight,
}

export class dKy_tevstr_c {
    // Pos/Dir are in world-space.
    public lightObj = new Light();
    public colorC0: Color = colorNewCopy(White);
    public colorK0: Color = colorNewCopy(White);
    // colorK1 (eflight)
    // fogColor, fogStartZ, fogEndZ
    public blendPsel: number = 0.0;
    // someAnimTimer
    public envrSelCurr: number;
    public envrSelPrev: number;
    public pselIdxCurr: number;
    public pselIdxPrev: number;
    public roomNo: number;
    public envrOverride: number;
    public lightMode: LightMode;
}

// Global environment light.
export class dScnKy_env_light_c {
    public pale: stage_palet_info_class[];
    public colo: stage_pselect_info_class[];
    public envr: stage_envr_info_class[];
    public virt: stage_vrbox_info_class[];

    public curTime: number = 0.0;
    public schejule: dScnKy__Schedule;
    public envrSelCurr: number = 0;
    public envrSelPrev: number = 0;

    public actCol = new stage_palet_info_class__DifAmb(White);
    public bgCol = nArray(4, () => new stage_palet_info_class__DifAmb(White));
    public vrSkyColor = colorNewCopy(White);
    public vrUsoUmiColor = colorNewCopy(White);
    public vrKumoColor = colorNewCopy(White);
    public vrKumoCenterColor = colorNewCopy(White);
    public vrKasumiMaeCol = colorNewCopy(White);

    public actAdd = new stage_palet_info_class__DifAmb(TransparentBlack);
    public bgAdd = nArray(4, () => new stage_palet_info_class__DifAmb(TransparentBlack));
    public vrSky0AddCol = colorNewCopy(TransparentBlack);
    public vrKasumiAddCol = colorNewCopy(TransparentBlack);

    public blendPal: number = 0.0;

    public allColRatio: number = 1.0;
    public actColRatio: number = 1.0;
    public bgColRatio: number = 1.0;
    public vrSoraColRatio: number = 1.0;
    public vrKumoColRatio: number = 1.0;

    public lightPosWorld = vec3.create();
    public lightDirWorld = vec3.create();
}

export const enum LightType {
    Actor = 0,
    BG0 = 1,
    BG1 = 2,
    BG2 = 3,
    BG3 = 4,
    BG0_Full = 5,
    BG1_Full = 6,
    BG2_Full = 7,
    BG3_Full = 8,
    Player = 99,
    ActorBaseOnly = 999,
}

class setLight_palno_ret {
    public envrSelCurr: number = 0;
    public envrSelPrev: number = 0;
    public pselIdxCurr: number = 0;
    public pselIdxPrev: number = 0;

    public palePrevA: stage_palet_info_class;
    public palePrevB: stage_palet_info_class;
    public paleCurrA: stage_palet_info_class;
    public paleCurrB: stage_palet_info_class;
    public blendPaleAB: number;
}

interface dScnKy__ScheduleEntry {
    timeBegin: number;
    timeEnd: number;
    palIdxA: number;
    palIdxB: number;
}

class dScnKy__Schedule {
    public entries: dScnKy__ScheduleEntry[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();
        let offs = 0x00;
        for (let i = 0; i < 11; i++) {
            const timeBegin = view.getFloat32(offs + 0x00);
            const timeEnd = view.getFloat32(offs + 0x04);
            const palIdx0 = view.getUint8(offs + 0x08);
            const palIdx1 = view.getUint8(offs + 0x09);
            this.entries.push({ timeBegin, timeEnd, palIdxA: palIdx0, palIdxB: palIdx1 });
            offs += 0x0C;
        }
    }
}

function findTimeInSchejule(schedule: dScnKy__Schedule, time: number): dScnKy__ScheduleEntry {
    assert(time >= 0.0 && time < 360.0);

    for (let i = 0; i < schedule.entries.length; i++) {
        const entry = schedule.entries[i];
        if (time >= entry.timeBegin && time < entry.timeEnd)
            return entry;
    }

    throw "whoops";
}

function setLight_palno_get(dst: setLight_palno_ret, envLight: dScnKy_env_light_c): setLight_palno_ret {
    const envrPrev = envLight.envr[dst.envrSelPrev], envrCurr = envLight.envr[dst.envrSelCurr];
    const pselPrev = envLight.colo[envrPrev.pselIdx[dst.pselIdxCurr]], pselCurr = envLight.colo[envrCurr.pselIdx[dst.pselIdxCurr]];

    // Look up the correct time from the schedule.
    const schejuleEntry = findTimeInSchejule(envLight.schejule, envLight.curTime);

    const paleIdxPrevA = pselPrev.palIdx[schejuleEntry.palIdxA];
    const paleIdxPrevB = pselPrev.palIdx[schejuleEntry.palIdxB];
    const paleIdxCurrA = pselCurr.palIdx[schejuleEntry.palIdxA];
    const paleIdxCurrB = pselCurr.palIdx[schejuleEntry.palIdxB];

    dst.palePrevA = envLight.pale[paleIdxPrevA];
    dst.palePrevB = envLight.pale[paleIdxPrevB];
    dst.paleCurrA = envLight.pale[paleIdxCurrA];
    dst.paleCurrB = envLight.pale[paleIdxCurrB];

    // Calculate the time blend between the two palettes.
    dst.blendPaleAB = invlerp(schejuleEntry.timeBegin, schejuleEntry.timeEnd, envLight.curTime);

    return dst;
}

function kankyo_color_ratio_set(envLight: dScnKy_env_light_c, v0A: number, v0B: number, blendAB: number, v1A: number, v1B: number, blend01: number, add: number, ratio: number): number {
    const mul = ratio * envLight.allColRatio;
    const v0 = lerp(v0A, v0B, blendAB);
    const v1 = lerp(v1A, v1B, blendAB);
    return clamp((lerp(v0, v1, blend01) + add) * mul, 0.0, 1.0);
}

function kankyo_color_ratio_set__Color(envLight: dScnKy_env_light_c, dst: Color, c0A: Color, c0B: Color, blendAB: number, c1A: Color, c1B: Color, blend01: number, add: Color, ratio: number): void {
    dst.r = kankyo_color_ratio_set(envLight, c0A.r, c0B.r, blendAB, c1A.r, c1B.r, blend01, add.r, ratio);
    dst.g = kankyo_color_ratio_set(envLight, c0A.g, c0B.g, blendAB, c1A.g, c1B.g, blend01, add.g, ratio);
    dst.b = kankyo_color_ratio_set(envLight, c0A.b, c0B.b, blendAB, c1A.b, c1B.b, blend01, add.b, ratio);
    dst.a = kankyo_color_ratio_set(envLight, c0A.a, c0B.a, blendAB, c1A.a, c1B.a, blend01, add.a, ratio);
}

const setLight_palno_ret_scratch = new setLight_palno_ret();

function setLight(envLight: dScnKy_env_light_c): void {
    setLight_palno_ret_scratch.envrSelCurr = envLight.envrSelCurr;
    setLight_palno_ret_scratch.envrSelPrev = envLight.envrSelPrev;
    const ret = setLight_palno_get(setLight_palno_ret_scratch, envLight);

    kankyo_color_ratio_set__Color(envLight, envLight.actCol.C0, ret.palePrevA.actCol.C0, ret.palePrevB.actCol.C0, ret.blendPaleAB, ret.paleCurrA.actCol.C0, ret.paleCurrB.actCol.C0, envLight.blendPal, envLight.actAdd.C0, envLight.actColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.actCol.K0, ret.palePrevA.actCol.K0, ret.palePrevB.actCol.K0, ret.blendPaleAB, ret.paleCurrA.actCol.K0, ret.paleCurrB.actCol.K0, envLight.blendPal, envLight.actAdd.K0, envLight.actColRatio);
    for (let whichBG = 0; whichBG < 4; whichBG++) {
        kankyo_color_ratio_set__Color(envLight, envLight.bgCol[whichBG].C0, ret.palePrevA.bgCol[whichBG].C0, ret.palePrevB.bgCol[whichBG].C0, ret.blendPaleAB, ret.paleCurrA.bgCol[whichBG].C0, ret.paleCurrB.bgCol[whichBG].C0, envLight.blendPal, envLight.bgAdd[whichBG].C0, envLight.bgColRatio);
        kankyo_color_ratio_set__Color(envLight, envLight.bgCol[whichBG].K0, ret.palePrevA.bgCol[whichBG].K0, ret.palePrevB.bgCol[whichBG].K0, ret.blendPaleAB, ret.paleCurrA.bgCol[whichBG].K0, ret.paleCurrB.bgCol[whichBG].K0, envLight.blendPal, envLight.bgAdd[whichBG].K0, envLight.bgColRatio);
    }

    const virt0A = envLight.virt[ret.palePrevA.virtIdx];
    const virt0B = envLight.virt[ret.palePrevB.virtIdx];
    const virt1A = envLight.virt[ret.paleCurrA.virtIdx];
    const virt1B = envLight.virt[ret.paleCurrB.virtIdx];

    kankyo_color_ratio_set__Color(envLight, envLight.vrSkyColor, virt0A.skyColor, virt0B.skyColor, ret.blendPaleAB, virt1A.skyColor, virt1B.skyColor, envLight.blendPal, envLight.vrSky0AddCol, envLight.vrSoraColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrUsoUmiColor, virt0A.usoUmiColor, virt0B.usoUmiColor, ret.blendPaleAB, virt1A.usoUmiColor, virt1B.usoUmiColor, envLight.blendPal, envLight.vrSky0AddCol, envLight.vrSoraColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKumoColor, virt0A.kumoColor, virt0B.kumoColor, ret.blendPaleAB, virt1A.kumoColor, virt1B.kumoColor, envLight.blendPal, envLight.vrSky0AddCol, envLight.vrKumoColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKumoCenterColor, virt0A.kumoCenterColor, virt0B.kumoCenterColor, ret.blendPaleAB, virt1A.kumoCenterColor, virt1B.kumoCenterColor, envLight.blendPal, envLight.vrSky0AddCol, envLight.vrKumoColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKasumiMaeCol, virt0A.kasumiMaeColor, virt0B.kasumiMaeColor, ret.blendPaleAB, virt1A.kasumiMaeColor, virt1B.kasumiMaeColor, envLight.blendPal, envLight.vrKasumiAddCol, envLight.vrSoraColRatio);
}

function setLight_actor(envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c, C0: Color, K0: Color): void {
    setLight_palno_ret_scratch.envrSelCurr = tevStr.roomNo;
    setLight_palno_ret_scratch.envrSelPrev = tevStr.roomNo;
    const ret = setLight_palno_get(setLight_palno_ret_scratch, envLight);

    kankyo_color_ratio_set__Color(envLight, C0, ret.palePrevA.actCol.C0, ret.palePrevB.actCol.C0, ret.blendPaleAB, ret.paleCurrA.actCol.C0, ret.paleCurrB.actCol.C0, tevStr.blendPsel, envLight.actAdd.C0, envLight.actColRatio);
    kankyo_color_ratio_set__Color(envLight, K0, ret.palePrevA.actCol.K0, ret.palePrevB.actCol.K0, ret.blendPaleAB, ret.paleCurrA.actCol.K0, ret.paleCurrB.actCol.K0, tevStr.blendPsel, envLight.actAdd.K0, envLight.actColRatio);
}

function setLight_bg(envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c, C0: Color, K0: Color, whichBG: number): void {
    setLight_palno_ret_scratch.envrSelCurr = tevStr.roomNo;
    setLight_palno_ret_scratch.envrSelPrev = tevStr.roomNo;
    const ret = setLight_palno_get(setLight_palno_ret_scratch, envLight);

    kankyo_color_ratio_set__Color(envLight, C0, ret.palePrevA.bgCol[whichBG].C0, ret.palePrevB.bgCol[whichBG].C0, ret.blendPaleAB, ret.paleCurrA.bgCol[whichBG].C0, ret.paleCurrB.bgCol[whichBG].C0, tevStr.blendPsel, envLight.bgAdd[whichBG].C0, envLight.bgColRatio);
    kankyo_color_ratio_set__Color(envLight, K0, ret.palePrevA.bgCol[whichBG].K0, ret.palePrevB.bgCol[whichBG].K0, ret.blendPaleAB, ret.paleCurrA.bgCol[whichBG].K0, ret.paleCurrB.bgCol[whichBG].K0, tevStr.blendPsel, envLight.bgAdd[whichBG].K0, envLight.bgColRatio);
}

export function settingTevStruct(envLight: dScnKy_env_light_c, lightType: LightType, pos: vec3 | null, tevStr: dKy_tevstr_c): void {
    if (lightType === LightType.Actor || lightType === LightType.Player || lightType === LightType.ActorBaseOnly) {
        // settingTevStruct_colget_actor();
        setLight_actor(envLight, tevStr, tevStr.colorC0, tevStr.colorK0);

        tevStr.lightMode = LightMode.Actor;

        // TODO(jstpierre): Respect base lighting

        vec3.copy(tevStr.lightObj.Position, envLight.lightPosWorld);
        vec3.copy(tevStr.lightObj.Direction, envLight.lightDirWorld);
        colorFromRGBA(tevStr.lightObj.Color, 1, 0, 0, 1);
        vec3.set(tevStr.lightObj.CosAtten, 1, 0, 0);
        vec3.set(tevStr.lightObj.DistAtten, 1, 0, 0);
    } else {
        // BG.
        let whichBG: number;
        let fullLight: boolean;
        if (lightType >= LightType.BG0_Full && lightType <= LightType.BG3_Full) {
            whichBG = lightType - LightType.BG0_Full;
            fullLight = true;
        } else {
            whichBG = lightType - LightType.BG0;
            fullLight = false;
        }

        setLight_bg(envLight, tevStr, tevStr.colorC0, tevStr.colorK0, whichBG);

        vec3.copy(tevStr.lightObj.Position, envLight.lightPosWorld);
        vec3.copy(tevStr.lightObj.Direction, envLight.lightDirWorld);
        if (fullLight)
            colorFromRGBA(tevStr.lightObj.Color, 1, 1, 1, 1);
        else
            colorFromRGBA(tevStr.lightObj.Color, 1, 0, 0, 1);
        vec3.set(tevStr.lightObj.CosAtten, 1, 0, 0);
        vec3.set(tevStr.lightObj.DistAtten, 1, 0, 0);

        tevStr.lightMode = LightMode.BG;
    }
}

export function dKy_tevstr_init(tevstr: dKy_tevstr_c, roomNo: number, envrOverride: number = -1): void {
    tevstr.roomNo = roomNo;
    tevstr.envrSelCurr = tevstr.roomNo;
    tevstr.envrSelPrev = tevstr.roomNo;
    tevstr.envrOverride = envrOverride;
}

export function setLightTevColorType(envLight: dScnKy_env_light_c, modelInstance: J3DModelInstance, tevStr: dKy_tevstr_c, camera: Camera): void {
    if (tevStr.lightMode !== LightMode.BG) {
        // TODO(jstpierre): Eflight
    }

    const light0 = modelInstance.getGXLightReference(0);
    lightSetFromWorldLight(light0, tevStr.lightObj, camera);

    // if (toon_proc_check() == 0)

    modelInstance.setColorOverride(ColorKind.C0, tevStr.colorC0, false);
    modelInstance.setColorOverride(ColorKind.K0, tevStr.colorK0, false);

    // TODO(jstpierre): Fog.
}

function SetBaseLight(envLight: dScnKy_env_light_c): void {
    vec3.set(envLight.lightPosWorld, 250, 250, 250);
    vec3.set(envLight.lightDirWorld, -1, -1, -1);
}

export function drawKankyo(envLight: dScnKy_env_light_c): void {
    // setSunpos(envLight);
    SetBaseLight(envLight);
    setLight(envLight);
}

export function envcolor_init(globals: dGlobals, envLight: dScnKy_env_light_c): void {
    envLight.pale = globals.dStage_dt.pale;
    envLight.colo = globals.dStage_dt.colo;
    envLight.envr = globals.dStage_dt.envr;
    envLight.virt = globals.dStage_dt.virt;

    const schejuleName = `l_time_attribute`;
    envLight.schejule = new dScnKy__Schedule(globals.findExtraSymbolData(`d_kankyo_data.o`, schejuleName));
}
