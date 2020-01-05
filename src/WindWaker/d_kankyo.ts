
import { Color, colorNewCopy, White, colorFromRGBA, TransparentBlack, OpaqueBlack, colorScaleAndAdd, colorCopy } from "../Color";
import { Light, lightSetFromWorldLight } from "../gx/gx_material";
import { vec3 } from "gl-matrix";
import { stage_palet_info_class, stage_pselect_info_class, stage_envr_info_class, stage_vrbox_info_class, stage_palet_info_class__DifAmb } from "./d_stage";
import { lerp, invlerp, clamp, MathConstants } from "../MathHelpers";
import { nArray, assert, arrayRemove, assertExists } from "../util";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { Camera } from "../Camera";
import { ColorKind } from "../gx/gx_render";
import { dGlobals } from "./zww_scenes";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { dKyw_rain_set, ThunderState, ThunderMode, dKyw_wether_move, dKyw_wether_move_draw, dKankyo_sun_packet, dKyr__sun_arrival_check, dKyw_wether_draw } from "./d_kankyo_wether";
import { cM_rndF, cLib_addCalc, cLib_addCalc2 } from "./SComponent";
import { fpc__ProcessName, fopKyM_Create, fpc_bs__Constructor, fGlobals, fpcPf__Register, kankyo_class, cPhs__Status } from "./framework";
import { ViewerRenderInput } from "../viewer";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { TDDraw } from "../SuperMarioGalaxy/DDraw";

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
    Player = 9,
    ActorBaseOnly = 99,
}

export class dScnKy_env_light_c {
    // Stage data
    public pale: stage_palet_info_class[];
    public colo: stage_pselect_info_class[];
    public envr: stage_envr_info_class[];
    public virt: stage_vrbox_info_class[];

    // Time
    public curTime: number = 0.0;
    public timeAdv: number = 0.02;
    public calendarDay: number = 0.0;
    public schejule: dScnKy__Schedule;

    public sunPos = vec3.create();
    public moonPos = vec3.create();

    // Sky
    public vrboxInvisible: boolean = true;

    // Color palette
    public actCol = new stage_palet_info_class__DifAmb(White);
    public bgCol = nArray(4, () => new stage_palet_info_class__DifAmb(White));
    public vrSkyColor = colorNewCopy(White);
    public vrUsoUmiColor = colorNewCopy(White);
    public vrKumoColor = colorNewCopy(White);
    public vrKumoCenterColor = colorNewCopy(White);
    public vrKasumiMaeCol = colorNewCopy(White);
    public fogColor = colorNewCopy(White);

    public actAdd = new stage_palet_info_class__DifAmb(TransparentBlack);
    public bgAdd = nArray(4, () => new stage_palet_info_class__DifAmb(TransparentBlack));
    public vrSky0Add = colorNewCopy(TransparentBlack);
    public vrKasumiAdd = colorNewCopy(TransparentBlack);
    public fogAdd = colorNewCopy(TransparentBlack);

    public allColRatio: number = 1.0;
    public actColRatio: number = 1.0;
    public bgColRatio: number = 1.0;
    public vrSoraColRatio: number = 1.0;
    public vrKumoColRatio: number = 1.0;
    public fogColRatio: number = 1.0;

    public blendPsel: number = 1.0;
    public blendPselGather: number = -1.0;

    // Lighting
    public baseLight = new LIGHT_INFLUENCE();
    public plights: LIGHT_INFLUENCE[] = [];
    public eflights: LIGHT_INFLUENCE[] = [];
    // The game records this in a separate struct with a bunch of extra data, but we don't need it lol.
    public lightStatus = nArray(2, () => new Light());

    // eflight/plight closest to the player
    public playerEflightIdx: number = -1;
    public playerPlightIdx: number = -1;

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

    // Wind
    public windVec = vec3.fromValues(1.0, 0.0, 0.0);
    public windPower = 1.0;

    // TODO(jstpierre): Move these weather states to their own structs?

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
    public thunderMode: ThunderMode = ThunderMode.Off;
    public thunderActive: boolean = false;
    public thunderState: ThunderState = ThunderState.Clear;
    public thunderFlashTimer: number = 0;
    public thunderLightInfluence = new LIGHT_INFLUENCE();

    // Sun/Moon
    // Also contains lenzflare
    public sunPacket: dKankyo_sun_packet | null = null;
}

export class LIGHT_INFLUENCE {
    public pos = vec3.create();
    public color = colorNewCopy(TransparentBlack);
    public power: number = 0;
    public fluctuation: number = 0;
    public priority: boolean = false;
}

const enum LightMode {
    BG,
    Actor,
    BGwithPlight,
}

export class dKy_tevstr_c {
    // Pos is in world-space.
    public lightObj = new Light();
    public colorC0: Color = colorNewCopy(White);
    public colorK0: Color = colorNewCopy(White);
    public colorK1: Color = colorNewCopy(White);
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

function dKy_light_influence_id(lights: LIGHT_INFLUENCE[], pos: vec3): number {
    let bestDistance = Infinity, bestIdx = -1;
    for (let i = 0; i < lights.length; i++) {
        const light = lights[i];
        if (light.power <= 0.0)
            continue;
        const dist = vec3.squaredDistance(light.pos, pos);
        if (dist < bestDistance) {
            bestDistance = dist;
            bestIdx = i;
        }
        if (light.priority)
            return i;
    }
    return bestIdx;
}

interface setLight_palno_pselenvr {
    envrIdxPrev: number;
    envrIdxCurr: number;
    pselIdxPrev: number;
    pselIdxCurr: number;
    blendPsel: number;
}

function setLight_palno_get(dst: setLight_palno_ret, pselenvr: setLight_palno_pselenvr, globals: dGlobals, envLight: dScnKy_env_light_c): setLight_palno_ret {
    // NOTE(jstpierre): This is not part of the original game, but it happens on some test maps.
    // I think the game will just read uninitialized data here.
    if (pselenvr.envrIdxPrev >= envLight.envr.length)
        pselenvr.envrIdxPrev = 0;
    if (pselenvr.envrIdxCurr >= envLight.envr.length)
        pselenvr.envrIdxCurr = 0;

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
                pselenvr.blendPsel += changeRateNormal / 10.0;
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
    kankyo_color_ratio_set__Color(envLight, envLight.fogColor, ret.palePrevA.fogCol, ret.palePrevB.fogCol, ret.blendPaleAB, ret.paleCurrA.fogCol, ret.paleCurrB.fogCol, envLight.blendPsel, envLight.fogAdd, envLight.fogColRatio);

    const virt0A = envLight.virt[ret.palePrevA.virtIdx];
    const virt0B = envLight.virt[ret.palePrevB.virtIdx];
    const virt1A = envLight.virt[ret.paleCurrA.virtIdx];
    const virt1B = envLight.virt[ret.paleCurrB.virtIdx];

    kankyo_color_ratio_set__Color(envLight, envLight.vrSkyColor, virt0A.skyColor, virt0B.skyColor, ret.blendPaleAB, virt1A.skyColor, virt1B.skyColor, envLight.blendPsel, envLight.vrSky0Add, envLight.vrSoraColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrUsoUmiColor, virt0A.usoUmiColor, virt0B.usoUmiColor, ret.blendPaleAB, virt1A.usoUmiColor, virt1B.usoUmiColor, envLight.blendPsel, envLight.vrSky0Add, envLight.vrSoraColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKumoColor, virt0A.kumoColor, virt0B.kumoColor, ret.blendPaleAB, virt1A.kumoColor, virt1B.kumoColor, envLight.blendPsel, envLight.vrSky0Add, envLight.vrKumoColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKumoCenterColor, virt0A.kumoCenterColor, virt0B.kumoCenterColor, ret.blendPaleAB, virt1A.kumoCenterColor, virt1B.kumoCenterColor, envLight.blendPsel, envLight.vrSky0Add, envLight.vrKumoColRatio);
    kankyo_color_ratio_set__Color(envLight, envLight.vrKasumiMaeCol, virt0A.kasumiMaeColor, virt0B.kasumiMaeColor, ret.blendPaleAB, virt1A.kasumiMaeColor, virt1B.kasumiMaeColor, envLight.blendPsel, envLight.vrKasumiAdd, envLight.vrSoraColRatio);
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

function settingTevStruct_plightcol_plus(envLight: dScnKy_env_light_c, pos: vec3, tevStr: dKy_tevstr_c, initTimer: number): void {
    const plightIdx = dKy_light_influence_id(envLight.plights, pos);

    let plight: LIGHT_INFLUENCE | null = null;
    let dist: number, power: number;
    if (plightIdx > -1) {
        const plightTest = envLight.plights[plightIdx];
        dist = vec3.distance(plightTest.pos, pos);
        power = Math.max(plightTest.power, 0.001);
        if (dist < 1000 + power)
            plight = plightTest;
    }

    let lightColor: Color, priority: boolean, fluctuation: number, lightPos: vec3;
    if (plight !== null) {
        lightPos = plight.pos;
        fluctuation = plight.fluctuation;
        lightColor = plight.color;
        priority = plight.priority;
    } else {
        dist = vec3.distance(envLight.baseLight.pos, pos);
        power = envLight.baseLight.power;
        lightPos = envLight.baseLight.pos;
        fluctuation = envLight.baseLight.fluctuation;
        lightColor = OpaqueBlack;
        priority = true;
    }

    let atten = 1.0;
    if (power! > 0.0 && initTimer === 0)
        atten = Math.min(dist! / power!, 1.0);

    const influence = 1.0 - (atten * atten);

    let target: number;
    if (fluctuation >= 1000.0) {
        target = (fluctuation - 1000.0);
    } else {
        const base = 255.0 - ((fluctuation / 3.0) * influence);
        target = lerp(base, 255, cM_rndF(1.0));
    }
    tevStr.lightObj.Color.r = clamp(target / 255.0, 0.0, 1.0);
    tevStr.lightObj.Color.g = 0.0;
    tevStr.lightObj.Color.b = 0.0;
    tevStr.lightObj.Color.a = 1.0;

    const colorInfluence = influence * 0.2;
    colorScaleAndAdd(tevStr.colorC0, tevStr.colorC0, lightColor, colorInfluence);
    colorScaleAndAdd(tevStr.colorK0, tevStr.colorK0, lightColor, colorInfluence);

    if (initTimer !== 0 || priority) {
        vec3.copy(tevStr.lightObj.Position, lightPos);
    } else {
        const distExist = Math.min(vec3.dist(pos, tevStr.lightObj.Position) / 10000.0, 1.0);
        const distExist2 = distExist * distExist;

        const distLight = 1.0 - Math.min(dist! / 10000.0, 1.0);
        const maxVel = 10.0 + (10000.0 * distExist2) + (100 * distLight * distLight * distLight);

        tevStr.lightObj.Position[0] = cLib_addCalc(tevStr.lightObj.Position[0], lightPos[0], 0.5, maxVel, 0.001);
        tevStr.lightObj.Position[1] = cLib_addCalc(tevStr.lightObj.Position[1], lightPos[1], 0.5, maxVel, 0.001);
        tevStr.lightObj.Position[2] = cLib_addCalc(tevStr.lightObj.Position[2], lightPos[2], 0.5, maxVel, 0.001);
    }

    // toon_proc_check
}

function settingTevStruct_eflightcol_plus(envLight: dScnKy_env_light_c, pos: vec3, tevStr: dKy_tevstr_c): void {
    if (envLight.playerEflightIdx < 0)
        return;

    const eflight = envLight.eflights[envLight.playerEflightIdx];
    if (eflight === undefined)
        return;

    if (eflight.power <= 0.0)
        return;

    const dist = vec3.distance(pos, eflight.pos);
    const atten = dist / eflight.power;
    if (atten > 1.0)
        return;

    tevStr.colorK1.r = clamp(eflight.color.r * atten, 0.0, 1.0);
    tevStr.colorK1.g = clamp(eflight.color.g * atten, 0.0, 1.0);
    tevStr.colorK1.b = clamp(eflight.color.b * atten, 0.0, 1.0);
    tevStr.colorK1.a = 1.0;
}

function settingTevStruct_colget_actor(globals: dGlobals, envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c): void {
    if (tevStr.envrOverride !== -1) {
        tevStr.envrIdxCurr = tevStr.envrOverride;
    } else {
        tevStr.envrIdxCurr = tevStr.roomNo;
    }

    if (tevStr.envrIdxPrev !== tevStr.envrIdxCurr && (tevStr.blendPsel >= 0.0 || tevStr.blendPsel <= 1.0))
        tevStr.blendPsel = 0.0;
    setLight_actor(globals, envLight, tevStr, tevStr.colorC0, tevStr.colorK0);
}

export function settingTevStruct(globals: dGlobals, lightType: LightType, pos: vec3 | null, tevStr: dKy_tevstr_c): void {
    const envLight = globals.g_env_light;

    colorFromRGBA(tevStr.colorK1, 0, 0, 0, 0);

    if (lightType === LightType.Actor || lightType === LightType.Player || lightType === LightType.ActorBaseOnly) {
        tevStr.lightMode = LightMode.Actor;

        if (lightType === LightType.Actor || lightType === LightType.ActorBaseOnly) {
            settingTevStruct_colget_actor(globals, envLight, tevStr);
        } else if (lightType === LightType.Player) {
            // TODO(jstpierre): Player
        }

        if (lightType !== LightType.ActorBaseOnly) {
            const initTimer = 0;
            settingTevStruct_plightcol_plus(envLight, assertExists(pos), tevStr, initTimer);
            settingTevStruct_eflightcol_plus(envLight, pos!, tevStr);
        }
    } else {
        // BG.

        tevStr.lightMode = LightMode.BG;

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

        vec3.copy(tevStr.lightObj.Position, envLight.lightStatus[0].Position);
        // Direction does not matter.
        if (fullLight)
            colorFromRGBA(tevStr.lightObj.Color, 1, 1, 1, 1);
        else
            colorFromRGBA(tevStr.lightObj.Color, 1, 0, 0, 1);
    }
}

export function dKy_tevstr_init(tevstr: dKy_tevstr_c, roomNo: number, envrOverride: number = -1): void {
    tevstr.roomNo = roomNo;
    tevstr.envrIdxCurr = tevstr.roomNo;
    tevstr.envrIdxPrev = tevstr.roomNo;
    tevstr.envrOverride = envrOverride;
}

// This is effectively the global state that dKy_setLight sets up, but since we don't
// have global state, we have to do this here.
export function dKy_setLight__OnModelInstance(envLight: dScnKy_env_light_c, modelInstance: J3DModelInstance, camera: Camera): void {
    const light0 = modelInstance.getGXLightReference(0);
    lightSetFromWorldLight(light0, envLight.lightStatus[0], camera);

    const light1 = modelInstance.getGXLightReference(1);
    lightSetFromWorldLight(light1, envLight.lightStatus[1], camera);
}

export function setLightTevColorType(globals: dGlobals, modelInstance: J3DModelInstance, tevStr: dKy_tevstr_c, camera: Camera): void {
    const envLight = globals.g_env_light;

    if (tevStr.lightMode !== LightMode.BG) {
        modelInstance.setColorOverride(ColorKind.K1, tevStr.colorK1);
    }

    const light0 = modelInstance.getGXLightReference(0);
    lightSetFromWorldLight(light0, tevStr.lightObj, camera);

    const light1 = modelInstance.getGXLightReference(1);
    lightSetFromWorldLight(light1, envLight.lightStatus[1], camera);

    // if (toon_proc_check() == 0)

    modelInstance.setColorOverride(ColorKind.C0, tevStr.colorC0);
    modelInstance.setColorOverride(ColorKind.K0, tevStr.colorK0);

    // TODO(jstpierre): Fog.
}

function SetBaseLight(envLight: dScnKy_env_light_c): void {
    // TODO(jstpierre): Stage lightVec.

    if (dKyr__sun_arrival_check(envLight)) {
        vec3.copy(envLight.baseLight.pos, envLight.sunPos);
    } else {
        vec3.copy(envLight.baseLight.pos, envLight.moonPos);
    }

    colorFromRGBA(envLight.baseLight.color, 1.0, 1.0, 1.0, 1.0);
    envLight.baseLight.power = 0.0;
    envLight.baseLight.fluctuation = 0.0;
}

function setSunpos(envLight: dScnKy_env_light_c, cameraPos: vec3): void {
    let angle: number;
    if (envLight.curTime < 15.0)
        angle = 345.0 + envLight.curTime;
    else
        angle = envLight.curTime - 15.0;

    const theta = MathConstants.DEG_TO_RAD * angle;
    const sinR = Math.sin(theta), cosR = Math.cos(theta);
    const baseX = 80000 * sinR, baseY = -80000 * cosR, baseZ = -48000 * cosR;
    vec3.set(envLight.sunPos,   baseX,  baseY,  baseZ);
    vec3.set(envLight.moonPos, -baseX, -baseY, -baseZ);

    vec3.add(envLight.sunPos, envLight.sunPos, cameraPos);
    vec3.add(envLight.moonPos, envLight.moonPos, cameraPos);
}

function drawKankyo(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    setSunpos(envLight, globals.cameraPosition);
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
    // Pattern 1: Dip into light rain
    [
        DiceWeatherMode.Overcast,
        DiceWeatherMode.LightRain,
        DiceWeatherMode.Overcast,
        DiceWeatherMode.Done,
    ],
    // Pattern 2: Dip into heavy thunder
    [
        DiceWeatherMode.LightThunder,
        DiceWeatherMode.HeavyThunder,
        DiceWeatherMode.LightThunder,
        DiceWeatherMode.Done,
    ],
    // Pattern 3: Dip into heavy rain
    [
        DiceWeatherMode.LightRain,
        DiceWeatherMode.HeavyRain,
        DiceWeatherMode.LightRain,
        DiceWeatherMode.Done,
    ],
    // Pattern 3: Light thunder for a bit.
    [
        DiceWeatherMode.LightThunder,
        DiceWeatherMode.Done,
    ],
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
                envLight.thunderMode = ThunderMode.On;
            } else {
                if (envLight.weatherPselIdx !== 0) {
                    envLight.weatherPselIdx = 0;
                    envLight.pselIdxCurrGather = 0;
                }
                if (envLight.thunderMode === ThunderMode.On)
                    envLight.thunderMode = ThunderMode.Off;
                dice_rain_minus(envLight);
            }
        } else {
            // Main weather code.
            if (dKy_pship_existence_chk(globals)) {
                envLight.thunderMode = ThunderMode.On;
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
                        if (envLight.thunderMode === ThunderMode.On)
                            envLight.thunderMode = ThunderMode.Off;
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
                        envLight.thunderMode = ThunderMode.On;
                        dice_rain_minus(envLight);
                    } else if (envLight.diceWeatherMode === DiceWeatherMode.HeavyThunder) {
                        pselIdx = 1;
                        envLight.thunderMode = ThunderMode.On;
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

function CalcTevColor(envLight: dScnKy_env_light_c, playerPos: vec3): void {
    // No clue why this is called CalcTevColor, lol
    envLight.playerEflightIdx = dKy_light_influence_id(envLight.eflights, playerPos);
    envLight.playerPlightIdx = dKy_light_influence_id(envLight.plights, playerPos);
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
    // dKyw_wether_proc();
    CalcTevColor(envLight, globals.playerPosition);
}

export function dKy_setLight(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    // Normally, this calls GXLoadLightObjImm, but we don't have that, so we initialize
    // a structure in our globals which we then set later, from settingTevStruct.

    const light0 = envLight.lightStatus[0];
    const baseLight = envLight.baseLight;
    light0.Position[0] = cLib_addCalc(light0.Position[0], baseLight.pos[0], 0.2, 50000.0, 0.00001);
    light0.Position[1] = cLib_addCalc(light0.Position[1], baseLight.pos[1], 0.2, 50000.0, 0.00001);
    light0.Position[2] = cLib_addCalc(light0.Position[2], baseLight.pos[2], 0.2, 50000.0, 0.00001);

    if (baseLight.fluctuation >= 1000.0) {
        light0.Color.r = (baseLight.fluctuation - 1000.0) / 255.0;
    } else {
        let influence: number;
        if (baseLight.power > 0.0)
            influence = Math.min(vec3.distance(baseLight.pos, globals.playerPosition) / baseLight.power, 1.0);
        else
            influence = 1.0;

        influence = Math.min(20.0 * (1.0 - influence), 1.0);
        const base = 255 - (baseLight.fluctuation / 3.0) * influence;
        const target = lerp(base, 255, cM_rndF(1.0)) / 255.0;
        light0.Color.r = cLib_addCalc2(light0.Color.r, target, 0.4, 20.0);
    }

    if (envLight.playerEflightIdx >= 0) {
        const eflight = envLight.eflights[envLight.playerEflightIdx];

        const light1 = envLight.lightStatus[1];
        vec3.copy(light1.Position, eflight.pos);

        if (eflight.fluctuation >= 1000.0) {
            light1.Color.r = eflight.fluctuation - 1000.0;
        } else {
            let influence: number;
            if (eflight.power > 0.0)
                influence = Math.min(vec3.distance(eflight.pos, globals.playerPosition) / eflight.power, 1.0);
            else
                influence = 1.0;

            influence = Math.min(20.0 * (1.0 - influence), 1.0);
            const base = 255 - (baseLight.fluctuation / 3.0) * influence;
            const target = lerp(base, 255, cM_rndF(1.0)) / 255.0;
            light1.Color.r = cLib_addCalc2(light1.Color.r, target, 0.5, 20.0);
        }
    }

    // Light loading is done in setTev
}

function dKyd_dmpalet_getp(globals: dGlobals): stage_palet_info_class[] {
    const buffer = globals.findExtraSymbolData(`d_kankyo_data.o`, `l_field_data`);
    const pale: stage_palet_info_class[] = [];

    let offs = 0x00;
    for (let i = 0; i < 16; i++) {
        const entry = new stage_palet_info_class();
        offs += entry.parse(buffer.slice(offs));
        pale.push(entry);
    }

    return pale;
}

function dKyd_dmpselect_getp(globals: dGlobals): stage_pselect_info_class[] {
    const buffer = globals.findExtraSymbolData(`d_kankyo_data.o`, `l_pselect_default`);
    const colo: stage_pselect_info_class[] = [];

    let offs = 0x00;
    for (let i = 0; i < 2; i++) {
        const entry = new stage_pselect_info_class();
        offs += entry.parse(buffer.slice(offs));
        colo.push(entry);
    }

    return colo;
}

function dKyd_dmenvr_getp(globals: dGlobals): stage_envr_info_class[] {
    const buffer = globals.findExtraSymbolData(`d_kankyo_data.o`, `l_pselect_default`);
    const envr: stage_envr_info_class[] = [];

    let offs = 0x00;
    for (let i = 0; i < 2; i++) {
        const entry = new stage_envr_info_class();
        offs += entry.parse(buffer.slice(offs));
        envr.push(entry);
    }

    return envr;
}

function dKyd_dmvrbox_getp(globals: dGlobals): stage_vrbox_info_class[] {
    const buffer = globals.findExtraSymbolData(`d_kankyo_data.o`, `l_vr_box_data`);
    const envr: stage_vrbox_info_class[] = [];

    let offs = 0x00;
    for (let i = 0; i < 8; i++) {
        const entry = new stage_vrbox_info_class();
        offs += entry.parse(buffer.slice(offs));
        envr.push(entry);
    }

    return envr;
}

export function envcolor_init(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    envLight.pale = globals.dStage_dt.pale;
    if (envLight.pale.length === 0)
        envLight.pale = dKyd_dmpalet_getp(globals);
    envLight.colo = globals.dStage_dt.colo;
    if (envLight.colo.length === 0)
        envLight.colo = dKyd_dmpselect_getp(globals);
    envLight.envr = globals.dStage_dt.envr;
    if (envLight.envr.length === 0)
        envLight.envr = dKyd_dmenvr_getp(globals);
    envLight.virt = globals.dStage_dt.virt;
    if (envLight.virt.length === 0)
        envLight.virt = dKyd_dmvrbox_getp(globals);

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

    colorCopy(envLight.lightStatus[0].Color, White);
    colorCopy(envLight.lightStatus[1].Color, White);

    envLight.diceWeatherChangeTime = (envLight.curTime + 15.0) % 360.0;
}

function colorSetRatio(color: Color, ratio: number, r: number, g: number, b: number): void {
    color.r = r * ratio * 1/255;
    color.g = g * ratio * 1/255;
    color.b = b * ratio * 1/255;
}

export function dKy_actor_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.actAdd.K0, ratio, r, g, b);
}

export function dKy_actor_addcol_dif_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.actAdd.C0, ratio, r, g, b);
}

export function dKy_bg_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAdd[0].K0, ratio, r, g, b);
}

export function dKy_bg_addcol_dif_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAdd[0].C0, ratio, r, g, b);
}

export function dKy_bg1_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAdd[1].K0, ratio, r, g, b);
}

export function dKy_bg1_addcol_dif_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAdd[1].C0, ratio, r, g, b);
}

export function dKy_bg2_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAdd[2].K0, ratio, r, g, b);
}

export function dKy_bg2_addcol_dif_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAdd[2].C0, ratio, r, g, b);
}

export function dKy_bg3_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAdd[3].K0, ratio, r, g, b);
}

export function dKy_bg3_addcol_dif_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAdd[3].C0, ratio, r, g, b);
}

export function dKy_vrbox_addcol_sky0_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.vrSky0Add, ratio, r, g, b);
}

export function dKy_vrbox_addcol_kasumi_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.vrKasumiAdd, ratio, r, g, b);
}

export function dKy_addcol_fog_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.fogAdd, ratio, r, g, b);
}

export function dKy_set_actcol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.actColRatio = ratio;
}

export function dKy_set_bgcol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.bgColRatio = ratio;
}

export function dKy_set_fogcol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.fogColRatio = ratio;
}

export function dKy_set_vrboxsoracol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.vrSoraColRatio = ratio;
}

export function dKy_set_vrboxkumocol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.vrKumoColRatio = ratio;
}

export function dKy_set_vrboxcol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    dKy_set_vrboxsoracol_ratio(envLight, ratio);
    dKy_set_vrboxkumocol_ratio(envLight, ratio);
}

export function dKy_change_colpat(envLight: dScnKy_env_light_c, idx: number): void {
    envLight.pselIdxCurrGather = idx;
    if (envLight.pselIdxCurr !== idx)
        envLight.blendPselGather = 0.0;
}

export function dKy_plight_set(envLight: dScnKy_env_light_c, plight: LIGHT_INFLUENCE): void {
    envLight.plights.push(plight);
}

export function dKy_plight_cut(envLight: dScnKy_env_light_c, plight: LIGHT_INFLUENCE): void {
    const idx = arrayRemove(envLight.plights, plight);
    if (envLight.playerPlightIdx === idx)
        envLight.playerPlightIdx = -1;
}

export function dKy_efplight_set(envLight: dScnKy_env_light_c, plight: LIGHT_INFLUENCE): void {
    envLight.eflights.push(plight);
}

export function dKy_efplight_cut(envLight: dScnKy_env_light_c, plight: LIGHT_INFLUENCE): void {
    const idx = arrayRemove(envLight.eflights, plight);
    if (envLight.playerEflightIdx === idx)
        envLight.playerEflightIdx = -1;
}

export function dKy_get_dayofweek(envLight: dScnKy_env_light_c): number {
    return envLight.calendarDay % 7;
}

class d_kankyo extends kankyo_class {
    public static PROCESS_NAME = fpc__ProcessName.d_kankyo;

    public subload(globals: dGlobals): cPhs__Status {
        envcolor_init(globals);
        // dKy_setLight_init();
        // dKy_wave_chan_init();
        // dKy_event_init();
        // dKy_Sound_init();
        // dKyw_wind_set();
        return cPhs__Status.Next;
    }

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        dKy_event_proc(globals);
        exeKankyo(globals, globals.g_env_light, deltaTimeInFrames);
        // dKyw_wind_set(globals);
    }

    public draw(globals: dGlobals): void {
        drawKankyo(globals);
    }
}

class d_kyeff extends kankyo_class {
    public static PROCESS_NAME = fpc__ProcessName.d_kyeff;

    public subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        // dKyw_wether_init(globals);

        const stage = globals.stageName;
        if (stage === 'Name') {
            vec3.set(envLight.windVec, 1, 0, 0);
            envLight.windPower = 0.7;
            // OSTicksToCalendarTime
            const hour = new Date().getHours();
            envLight.curTime = 15 * hour;
        }

        if (dKy_checkEventNightStop(globals)) {
            const stag = globals.dStage_dt.stag;
            const roomType = (stag.roomTypeAndSchBit >>> 16) & 0x07;
            if (roomType === 0 || roomType === 7) {
                dKyw_rain_set(envLight, 250);
                envLight.thunderMode = ThunderMode.On;
            } else if (roomType === 2) {
                if (stage === 'Ocrogh' || stage === 'Omori' || stage === 'Orichh' || stage === 'Atorizk' ||
                    stage === 'LinkRM' || stage === 'Ojhous2' || stage === 'Onobuta' || stage === 'Omasao' ||
                    stage === 'Obombh' || stage === 'Opub') {
                    dKyw_rain_set(envLight, 250);
                    envLight.thunderMode = ThunderMode.FarOnly;
                }
            }
        }

        return cPhs__Status.Next;
    }

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        if (globals.stageName === 'Name') {
            // menu_vrbox_set();
        } else {
            dKyw_wether_move(globals);
        }
        dKyw_wether_move_draw(globals);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        dKyw_wether_draw(globals, renderInstManager, viewerInput);
    }

    public delete(globals: dGlobals): void {
        const envLight = globals.g_env_light;
        const device = globals.modelCache.device;

        if (envLight.sunPacket !== null)
            envLight.sunPacket.destroy(device);
    }
}

export function dKankyo_create(globals: dGlobals): void {
    fopKyM_Create(globals.frameworkGlobals, fpc__ProcessName.d_kankyo, null);
    fopKyM_Create(globals.frameworkGlobals, fpc__ProcessName.d_kyeff, null);
    fopKyM_Create(globals.frameworkGlobals, fpc__ProcessName.d_kyeff2, null);
    fopKyM_Create(globals.frameworkGlobals, fpc__ProcessName.d_envse, null);
}

interface constructor extends fpc_bs__Constructor {
    PROCESS_NAME: fpc__ProcessName;
}

export function dKy__RegisterConstructors(globals: fGlobals): void {
    function R(constructor: constructor): void {
        fpcPf__Register(globals, constructor.PROCESS_NAME, constructor);
    }

    R(d_kankyo);
    R(d_kyeff);
}
