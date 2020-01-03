
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
import { dKyw_rain_set } from "./d_kankyo_wether";
import { cM_rndF } from "./SComponent";

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
    public envrIdxCurr: number;
    public envrIdxPrev: number;
    public pselIdxCurr: number;
    public pselIdxPrev: number;
    public roomNo: number;
    public envrOverride: number;
    public lightMode: LightMode;
}

enum DiceWeatherMode {
    Sunny = 0,
    Overcast = 1,
    LightRain = 2,
    HeavyRain = 3,
    LightThunder = 4,
    HeavyThunder = 5,
    Done = 0xFF,
}

const enum DiceWeatherState {
    Uninitialized = 0,
    Init,
    Execute,
    Next,
}

// Global environment light.
export class dScnKy_env_light_c {
    public pale: stage_palet_info_class[];
    public colo: stage_pselect_info_class[];
    public envr: stage_envr_info_class[];
    public virt: stage_vrbox_info_class[];

    public curTime: number = 0.0;
    public timeAdv: number = 0.02;
    public calendarDay: number = 0.0;
    public schejule: dScnKy__Schedule;

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

    public blendPsel: number = 1.0;
    public blendPselGather: number = -1.0;

    public allColRatio: number = 1.0;
    public actColRatio: number = 1.0;
    public bgColRatio: number = 1.0;
    public vrSoraColRatio: number = 1.0;
    public vrKumoColRatio: number = 1.0;

    public lightPosWorld = vec3.create();
    public lightDirWorld = vec3.create();

    public envrIdxCurr: number = 0;
    public envrIdxPrev: number = 0;
    public pselIdxPrev: number = 0;
    public pselIdxCurr: number = 0;
    public pselIdxPrevGather: number = -1;
    public pselIdxCurrGather: number = -1;

    // These appear to be enums ranging from 0-2? I don't know.
    public colSetMode: number = 0;
    public colSetModeGather: number = 0;

    // Weather.
    public weatherPselIdx = 0;

    // Dice weather system
    public diceWeatherMode: DiceWeatherMode = DiceWeatherMode.Sunny;
    public diceWeatherChangeTime: number;
    public diceWeatherState: DiceWeatherState = DiceWeatherState.Uninitialized;
    public diceWeatherCurrPattern: number = 0;
    public diceWeatherCounter: number = 0;
    public diceWeatherTime: number = 0.0;

    // Rain.
    public rainCount: number = 0;
    public rainCountOrig: number = 0;

    // Thunder.
    public thunderMode: number = 0;
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
    public palePrevA: stage_palet_info_class;
    public palePrevB: stage_palet_info_class;
    public paleCurrA: stage_palet_info_class;
    public paleCurrB: stage_palet_info_class;
    public blendPaleAB: number = 0;
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

interface setLight_palno_pselenvr {
    envrIdxPrev: number;
    envrIdxCurr: number;
    pselIdxPrev: number;
    pselIdxCurr: number;
    blendPsel: number;
}

function setLight_palno_get(dst: setLight_palno_ret, pselenvr: setLight_palno_pselenvr, globals: dGlobals, envLight: dScnKy_env_light_c): setLight_palno_ret {
    const envrPrev = envLight.envr[pselenvr.envrIdxPrev], envrCurr = envLight.envr[pselenvr.envrIdxCurr];
    const pselPrev = envLight.colo[envrPrev.pselIdx[pselenvr.pselIdxPrev]], pselCurr = envLight.colo[envrCurr.pselIdx[pselenvr.pselIdxCurr]];

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

    if (pselenvr.envrIdxPrev !== pselenvr.envrIdxCurr || pselenvr.pselIdxPrev !== pselenvr.pselIdxCurr) {
        const changeRateNormal = 1/30;
        if (pselCurr.changeRate < changeRateNormal) {
            pselCurr.changeRate = changeRateNormal;
        }

        if (envLight.colSetMode === 0) {
            if (globals.stageName === 'sea' && pselenvr.pselIdxPrev !== pselenvr.pselIdxCurr) {
                pselenvr.blendPsel += changeRateNormal;
            } else if (pselCurr.changeRate > 0) {
                pselenvr.blendPsel += changeRateNormal / pselCurr.changeRate;
            }

            if (pselenvr.blendPsel >= 1.0) {
                pselenvr.envrIdxPrev = pselenvr.envrIdxCurr;
                pselenvr.pselIdxPrev = pselenvr.pselIdxCurr;
            }
        }
    }

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

function setLight(globals: dGlobals, envLight: dScnKy_env_light_c): void {
    const ret = setLight_palno_get(setLight_palno_ret_scratch, envLight, globals, envLight);

    kankyo_color_ratio_set__Color(envLight, envLight.actCol.C0, ret.palePrevA.actCol.C0, ret.palePrevB.actCol.C0, ret.blendPaleAB, ret.paleCurrA.actCol.C0, ret.paleCurrB.actCol.C0, envLight.blendPsel, envLight.actAdd.C0, envLight.actColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.actCol.K0, ret.palePrevA.actCol.K0, ret.palePrevB.actCol.K0, ret.blendPaleAB, ret.paleCurrA.actCol.K0, ret.paleCurrB.actCol.K0, envLight.blendPsel, envLight.actAdd.K0, envLight.actColRatio);
    for (let whichBG = 0; whichBG < 4; whichBG++) {
        kankyo_color_ratio_set__Color(envLight, envLight.bgCol[whichBG].C0, ret.palePrevA.bgCol[whichBG].C0, ret.palePrevB.bgCol[whichBG].C0, ret.blendPaleAB, ret.paleCurrA.bgCol[whichBG].C0, ret.paleCurrB.bgCol[whichBG].C0, envLight.blendPsel, envLight.bgAdd[whichBG].C0, envLight.bgColRatio);
        kankyo_color_ratio_set__Color(envLight, envLight.bgCol[whichBG].K0, ret.palePrevA.bgCol[whichBG].K0, ret.palePrevB.bgCol[whichBG].K0, ret.blendPaleAB, ret.paleCurrA.bgCol[whichBG].K0, ret.paleCurrB.bgCol[whichBG].K0, envLight.blendPsel, envLight.bgAdd[whichBG].K0, envLight.bgColRatio);
    }

    const virt0A = envLight.virt[ret.palePrevA.virtIdx];
    const virt0B = envLight.virt[ret.palePrevB.virtIdx];
    const virt1A = envLight.virt[ret.paleCurrA.virtIdx];
    const virt1B = envLight.virt[ret.paleCurrB.virtIdx];

    kankyo_color_ratio_set__Color(envLight, envLight.vrSkyColor, virt0A.skyColor, virt0B.skyColor, ret.blendPaleAB, virt1A.skyColor, virt1B.skyColor, envLight.blendPsel, envLight.vrSky0AddCol, envLight.vrSoraColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrUsoUmiColor, virt0A.usoUmiColor, virt0B.usoUmiColor, ret.blendPaleAB, virt1A.usoUmiColor, virt1B.usoUmiColor, envLight.blendPsel, envLight.vrSky0AddCol, envLight.vrSoraColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKumoColor, virt0A.kumoColor, virt0B.kumoColor, ret.blendPaleAB, virt1A.kumoColor, virt1B.kumoColor, envLight.blendPsel, envLight.vrSky0AddCol, envLight.vrKumoColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKumoCenterColor, virt0A.kumoCenterColor, virt0B.kumoCenterColor, ret.blendPaleAB, virt1A.kumoCenterColor, virt1B.kumoCenterColor, envLight.blendPsel, envLight.vrSky0AddCol, envLight.vrKumoColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKasumiMaeCol, virt0A.kasumiMaeColor, virt0B.kasumiMaeColor, ret.blendPaleAB, virt1A.kasumiMaeColor, virt1B.kasumiMaeColor, envLight.blendPsel, envLight.vrKasumiAddCol, envLight.vrSoraColRatio);
}

function setLight_actor(globals: dGlobals, envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c, C0: Color, K0: Color): void {
    tevStr.pselIdxPrev = envLight.pselIdxPrev;
    tevStr.pselIdxCurr = envLight.pselIdxCurr;
    if (tevStr.pselIdxPrev !== tevStr.pselIdxCurr)
        tevStr.blendPsel = envLight.blendPsel;

    const ret = setLight_palno_get(setLight_palno_ret_scratch, tevStr, globals, envLight);

    kankyo_color_ratio_set__Color(envLight, C0, ret.palePrevA.actCol.C0, ret.palePrevB.actCol.C0, ret.blendPaleAB, ret.paleCurrA.actCol.C0, ret.paleCurrB.actCol.C0, tevStr.blendPsel, envLight.actAdd.C0, envLight.actColRatio);
    kankyo_color_ratio_set__Color(envLight, K0, ret.palePrevA.actCol.K0, ret.palePrevB.actCol.K0, ret.blendPaleAB, ret.paleCurrA.actCol.K0, ret.paleCurrB.actCol.K0, tevStr.blendPsel, envLight.actAdd.K0, envLight.actColRatio);
}

function setLight_bg(globals: dGlobals, envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c, C0: Color, K0: Color, whichBG: number): void {
    tevStr.pselIdxPrev = envLight.pselIdxPrev;
    tevStr.pselIdxCurr = envLight.pselIdxCurr;
    if (tevStr.pselIdxPrev !== tevStr.pselIdxCurr)
        tevStr.blendPsel = envLight.blendPsel;

    const ret = setLight_palno_get(setLight_palno_ret_scratch, tevStr, globals, envLight);

    kankyo_color_ratio_set__Color(envLight, C0, ret.palePrevA.bgCol[whichBG].C0, ret.palePrevB.bgCol[whichBG].C0, ret.blendPaleAB, ret.paleCurrA.bgCol[whichBG].C0, ret.paleCurrB.bgCol[whichBG].C0, tevStr.blendPsel, envLight.bgAdd[whichBG].C0, envLight.bgColRatio);
    kankyo_color_ratio_set__Color(envLight, K0, ret.palePrevA.bgCol[whichBG].K0, ret.palePrevB.bgCol[whichBG].K0, ret.blendPaleAB, ret.paleCurrA.bgCol[whichBG].K0, ret.paleCurrB.bgCol[whichBG].K0, tevStr.blendPsel, envLight.bgAdd[whichBG].K0, envLight.bgColRatio);
}

export function settingTevStruct(globals: dGlobals, lightType: LightType, pos: vec3 | null, tevStr: dKy_tevstr_c): void {
    const envLight = globals.g_env_light;

    if (lightType === LightType.Actor || lightType === LightType.Player || lightType === LightType.ActorBaseOnly) {
        // settingTevStruct_colget_actor();
        setLight_actor(globals, envLight, tevStr, tevStr.colorC0, tevStr.colorK0);

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

        setLight_bg(globals, envLight, tevStr, tevStr.colorC0, tevStr.colorK0, whichBG);

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
    tevstr.envrIdxCurr = tevstr.roomNo;
    tevstr.envrIdxPrev = tevstr.roomNo;
    tevstr.envrOverride = envrOverride;
}

export function setLightTevColorType(globals: dGlobals, modelInstance: J3DModelInstance, tevStr: dKy_tevstr_c, camera: Camera): void {
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
    vec3.set(envLight.lightPosWorld, 1e6, 1e6, 1e6);
    vec3.set(envLight.lightDirWorld, -1, -1, -1);
}

export function drawKankyo(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    // setSunpos(envLight);
    SetBaseLight(envLight);
    setLight(globals, envLight);
}

export function dKy_checkEventNightStop(globals: dGlobals): boolean {
    return false;
}

export function dKy_pship_existence_chk(globals: dGlobals): boolean {
    return false;
}

function GetTimePass(globals: dGlobals): boolean {
    return true;
}

function dice_rain_minus(envLight: dScnKy_env_light_c): void {
    if (envLight.rainCount > 0) {
        if (envLight.rainCount < 41)
            dKyw_rain_set(envLight, envLight.rainCount - 1);
        else
            dKyw_rain_set(envLight, envLight.rainCount - 3);
    }
}

const S_wether_table = [0, 1, 3, 2, 0, 1, 3, 2];
const S_wether_time_table = [120, 150, 90, 120, 120, 150, 150, 120];
const S_wether_mode_pat = [
    [DiceWeatherMode.Overcast, 2, DiceWeatherMode.Overcast, DiceWeatherMode.Done],
    [4, 5, 4, 0xFF],
    [2, 3, 2, 0xFF],
    [4, 0xFF],
];
const S_wether_time_pat = [
    [5, 10, 5],
    [7, 15, 5],
    [5, 12.5, 5],
    [10],
];

function dice_wether_init(envLight: dScnKy_env_light_c, mode: DiceWeatherMode, timeChange: number, time: number): void {
    console.log(`d_kankyo: dice_wether_init`, DiceWeatherMode[mode]);

    envLight.diceWeatherMode = mode;
    envLight.diceWeatherTime = (time + timeChange) % 360.0;
}

function dice_wether_execute(envLight: dScnKy_env_light_c, mode: DiceWeatherMode, timeChange: number, time: number): void {
    console.log(`d_kankyo: dice_wether_execute`, DiceWeatherMode[mode]);

    if (mode === DiceWeatherMode.Done) {
        envLight.diceWeatherMode = DiceWeatherMode.Sunny;
        envLight.diceWeatherState = DiceWeatherState.Next;
    } else {
        envLight.diceWeatherMode = mode;
        envLight.diceWeatherTime = (time + timeChange) % 360.0;
        envLight.diceWeatherCounter++;
    }
}

function dKy_event_proc(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    if (globals.stageName !== 'sea')
        return;

    if (dKy_checkEventNightStop(globals)) {
        // Special case: Cursed Great Sea.

        if (envLight.weatherPselIdx !== 1) {
            envLight.weatherPselIdx = 1;
            envLight.pselIdxCurrGather = 1;
        }

        if (envLight.rainCount < 250)
            dKyw_rain_set(envLight, envLight.rainCount + 1);
    } else {
        // Normal weather.

        // Game also checks whether the player has collected the Wind Waker.
        const timePass = GetTimePass(globals);

        if (!timePass) {
            // Time stopped weather code.

            if (dKy_pship_existence_chk(globals)) {
                if (envLight.weatherPselIdx !== 1) {
                    envLight.weatherPselIdx = 1;
                    envLight.pselIdxCurrGather = 1;
                }
                envLight.thunderMode = 1;
            } else {
                if (envLight.weatherPselIdx !== 0) {
                    envLight.weatherPselIdx = 0;
                    envLight.pselIdxCurrGather = 0;
                }
                if (envLight.thunderMode === 1)
                    envLight.thunderMode = 0;
                dice_rain_minus(envLight);
            }
        } else {
            // Main weather code.
            if (dKy_pship_existence_chk(globals)) {
                envLight.thunderMode = 1;
                dice_rain_minus(envLight);
                if (envLight.weatherPselIdx !== 1) {
                    envLight.weatherPselIdx = 1;
                    envLight.pselIdxCurrGather = 1;
                }
            } else {
                // Here be the dragons!
                const curTime = envLight.curTime;

                // State machine for selecting the new weather.
                if (envLight.diceWeatherState === DiceWeatherState.Uninitialized) {
                    if (curTime > envLight.diceWeatherChangeTime && curTime < envLight.diceWeatherChangeTime + 180) {
                        envLight.diceWeatherState = DiceWeatherState.Init;
                    }
                }

                if (envLight.diceWeatherState === DiceWeatherState.Init) {
                    const patternIdx = cM_rndF(7.99) | 0;
                    const pat = S_wether_table[patternIdx];
                    envLight.diceWeatherCurrPattern = pat;
                    envLight.diceWeatherCounter = 0;
                    dice_wether_init(envLight, S_wether_mode_pat[pat][0], S_wether_time_pat[pat][0], curTime);
                    envLight.diceWeatherCounter++;
                    envLight.diceWeatherState = DiceWeatherState.Execute;
                } else if (envLight.diceWeatherState === DiceWeatherState.Execute) {
                    if (curTime > envLight.diceWeatherTime && curTime < envLight.diceWeatherTime + 180) {
                        const pat = envLight.diceWeatherCurrPattern;
                        const cnt = envLight.diceWeatherCounter;
                        dice_wether_execute(envLight, S_wether_mode_pat[pat][cnt], S_wether_time_pat[pat][cnt], curTime);
                    }
                } else if (envLight.diceWeatherState === DiceWeatherState.Next) {
                    const timeIdx = cM_rndF(7.99) | 0;
                    envLight.diceWeatherChangeTime = (curTime + S_wether_time_table[timeIdx]) % 360.0;
                    envLight.diceWeatherState = DiceWeatherState.Uninitialized;
                }

                if (envLight.colSetMode === 0 && envLight.colSetModeGather === 0) {
                    let pselIdx: number;

                    if (envLight.diceWeatherMode === DiceWeatherMode.Sunny) {
                        pselIdx = 0;
                        if (envLight.thunderMode === 1)
                            envLight.thunderMode = 0;
                        dice_rain_minus(envLight);
                    } else if (envLight.diceWeatherMode === DiceWeatherMode.Overcast) {
                        pselIdx = 1;
                        dice_rain_minus(envLight);
                    } else if (envLight.diceWeatherMode === DiceWeatherMode.LightRain) {
                        pselIdx = 1;
                        if (envLight.rainCount < 40)
                            dKyw_rain_set(envLight, envLight.rainCount + 1);
                        else
                            dKyw_rain_set(envLight, envLight.rainCount - 1);
                    } else if (envLight.diceWeatherMode === DiceWeatherMode.HeavyRain) {
                        pselIdx = 1;

                        if (envLight.rainCount < 250)
                            dKyw_rain_set(envLight, envLight.rainCount + 1);
                    } else if (envLight.diceWeatherMode === DiceWeatherMode.LightThunder) {
                        pselIdx = 1;
                        envLight.thunderMode = 1;
                        dice_rain_minus(envLight);
                    } else if (envLight.diceWeatherMode === DiceWeatherMode.HeavyThunder) {
                        pselIdx = 1;
                        envLight.thunderMode = 1;
                        if (envLight.rainCount < 250)
                            dKyw_rain_set(envLight, envLight.rainCount + 1);
                    } else {
                        throw "whoops";
                    }

                    if (envLight.weatherPselIdx !== pselIdx) {
                        envLight.pselIdxCurrGather = pselIdx;
                        envLight.weatherPselIdx = pselIdx;
                    }
                }
            }
        }
    }

    if (envLight.colSetMode === 0 && envLight.colSetModeGather === 0 && envLight.pselIdxCurrGather !== -1 && envLight.pselIdxCurrGather !== envLight.pselIdxCurr) {
        envLight.blendPselGather = 0.0;
    }
}

function dKankyo_DayProc(globals: dGlobals): void {
    // Called once a day.
}

function setDaytime(globals: dGlobals, envLight: dScnKy_env_light_c, deltaTimeInFrames: number): void {
    // Game also checks whether the player has collected the Wind Waker, and Flight Control Platform Minigame (?)
    const timePass = GetTimePass(globals);

    if (timePass) {
        envLight.curTime += envLight.timeAdv * deltaTimeInFrames;
        if (envLight.curTime >= 360.0) {
            envLight.curTime = 0.0;
            envLight.calendarDay += 1;
            dKankyo_DayProc(globals);
        }
    }
}

function exeKankyo(globals: dGlobals, envLight: dScnKy_env_light_c, deltaTimeInFrames: number): void {
    const colSetModeGather = envLight.colSetModeGather;

    envLight.colSetMode = envLight.colSetModeGather;
    if (envLight.colSetModeGather !== 0) {
        if (envLight.colSetModeGather < 3)
            envLight.colSetModeGather++;
        else
            envLight.colSetModeGather = 0;
    }

    if (colSetModeGather === 0) {
        if (envLight.pselIdxPrev === envLight.pselIdxCurr) {
            if (envLight.pselIdxPrevGather !== -1) {
                envLight.pselIdxPrev = envLight.pselIdxPrevGather;
                envLight.pselIdxPrevGather = -1;
            }

            if (envLight.pselIdxCurrGather !== -1) {
                envLight.pselIdxCurr = envLight.pselIdxCurrGather;
                envLight.weatherPselIdx = envLight.pselIdxCurr;
                envLight.pselIdxCurrGather = -1;
            }

            if (envLight.blendPselGather >= 0.0) {
                envLight.blendPsel = envLight.blendPselGather;
                envLight.blendPselGather = -1.0;
            }
        }
    } else {
        if (envLight.pselIdxPrevGather !== -1) {
            envLight.pselIdxPrev = envLight.pselIdxPrevGather;
            if (envLight.colSetModeGather === 0)
                envLight.pselIdxPrevGather = -1;
        }

        if (envLight.pselIdxCurrGather !== -1) {
            envLight.pselIdxCurr = envLight.pselIdxCurrGather;
            if (envLight.colSetModeGather === 0)
                envLight.pselIdxCurrGather = -1;
        }

        if (envLight.blendPselGather >= 0.0) {
            envLight.blendPsel = envLight.blendPselGather;
            if (envLight.colSetModeGather === 0)
                envLight.blendPselGather = -1;
        }
    }

    // TODO(jstpierre): Gather colors.

    setDaytime(globals, envLight, deltaTimeInFrames);
}

export function dKy_Execute(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    dKy_event_proc(globals);
    exeKankyo(globals, envLight, deltaTimeInFrames);
    // dKyw_wind_set(globals);
}

export function envcolor_init(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    envLight.pale = globals.dStage_dt.pale;
    envLight.colo = globals.dStage_dt.colo;
    envLight.envr = globals.dStage_dt.envr;
    envLight.virt = globals.dStage_dt.virt;

    const schejuleName = `l_time_attribute`;
    envLight.schejule = new dScnKy__Schedule(globals.findExtraSymbolData(`d_kankyo_data.o`, schejuleName));

    if (dKy_checkEventNightStop(globals)) {
        // Something vrkumo
        envLight.weatherPselIdx = 1;
    } else {
        // Something vrkumo
        envLight.weatherPselIdx = 0;
    }

    envLight.pselIdxPrev = envLight.weatherPselIdx;
    envLight.pselIdxCurr = envLight.weatherPselIdx;
    envLight.curTime = 180.0;
    envLight.timeAdv = 0.02;

    envLight.diceWeatherChangeTime = (envLight.curTime + 15.0) % 360.0;
}
