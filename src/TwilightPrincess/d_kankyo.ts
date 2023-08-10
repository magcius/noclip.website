
import { Color, colorNewCopy, White, colorFromRGBA, TransparentBlack, OpaqueBlack, colorScaleAndAdd, colorAdd, colorClampLDR, colorCopy } from "../Color.js";
import { Light, lightSetFromWorldLight, fogBlockSet, FogBlock } from "../gx/gx_material.js";
import { vec3 } from "gl-matrix";
import { stage_palet_info_class, stage_pselect_info_class, stage_envr_info_class, stage_vrbox_info_class, dStage_stagInfo_GetSTType } from "./d_stage.js";
import { lerp, invlerp, clamp, MathConstants } from "../MathHelpers.js";
import { nArray, assert, arrayRemove, assertExists, readString } from "../util.js";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { Camera } from "../Camera.js";
import { ColorKind, MaterialParams } from "../gx/gx_render.js";
import { dGlobals } from "./ztp_scenes.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { dKyw_wether_init, dKyw_wether_init2, dKyw_wether_delete2, dKyw_rain_set, ThunderState, ThunderMode, dKyw_wether_move, dKyw_wether_move_draw, dKankyo_sun_Packet, dKyr__sun_arrival_check, dKyw_wether_draw, dKankyo_vrkumo_Packet, dKyw_wether_move_draw2, dKyw_wether_draw2, dKankyo__CommonTextures, dKankyo_rain_Packet, dKankyo_housi_Packet, dKankyo_star_Packet, dKyw_wind_set, dKyw_wether_delete } from "./d_kankyo_wether.js";
import { cM_rndF, cLib_addCalc, cLib_addCalc2 } from "../WindWaker/SComponent.js";
import { fpc__ProcessName, fopKyM_Create, fpc_bs__Constructor, fGlobals, fpcPf__Register, kankyo_class, cPhs__Status } from "./framework.js";
import { ViewerRenderInput } from "../viewer.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { FogType } from "../gx/gx_enum.js";
import { mDoExt_modelUpdateDL, mDoExt_btkAnm, mDoExt_brkAnm } from "./m_do_ext.js";
import { dComIfG_resLoad, ResType } from "./d_resorce.js";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader.js";

export const enum LightType {
    UNK_0 = 0,
    UNK_1 = 1,
    UNK_2 = 2,
    UNK_3 = 3,
    UNK_4 = 4,
    UNK_5 = 5,
    UNK_7 = 7,
    UNK_8 = 8,
    UNK_9 = 9,
    UNK_10 = 10,
    UNK_11 = 11,
    UNK_12 = 12,
    UNK_13 = 13,
    UNK_14 = 14,
    UNK_16 = 16,
    UNK_20 = 20,
    BG0 = 32,
    BG1 = 33,
    BG2 = 34,
    BG3 = 35,
    BG4 = 35,
    BG5 = 32,
}

export class dScnKy_env_light_c {
    constructor() {
        vec3.set(this.sunPos, 1, 0, 0);
        vec3.set(this.moonPos, -1, 0, 0);

        this.nextTime = -1.0;
        this.darkTime = 120.0;
        this.pondSeason = 0;
    }

    // Stage data
    public pale: stage_palet_info_class[];
    public colo: stage_pselect_info_class[];
    public envr: stage_envr_info_class[];
    public virt: stage_vrbox_info_class[];
    public schejule: dScnKy__Schedule;

    // Lighting
    public baseLight = new LIGHT_INFLUENCE();
    public lightInfluence = nArray(30, () => new LIGHT_INFLUENCE());
    public plights = nArray(100, () => new LIGHT_INFLUENCE());
    public eflights = nArray(5, () => new LIGHT_INFLUENCE());
    public unk_72c = nArray(5, () => new LIGHT_INFLUENCE());
    public unk_740 = new LIGHT_INFLUENCE();
    public BGpartsActiveLight = nArray(2, () => new LIGHT_INFLUENCE());
    public pntWind = nArray(30, () => new WIND_INFLUENCE());
    public windInfEntity = nArray(5, () => new WIND_INF_ENTITY());
    public sndInfluence = new SND_INFLUENCE();
    public darkmist = nArray(10, () => new DALKMIST_INFLUENCE());
    public dungeonLight = nArray(8, () => new DUNGEON_LIGHT());
    public bosslight1 = nArray(8, () => new BOSS_LIGHT());
    public bosslight2 = nArray(6, () => new BOSS_LIGHT());

    public underwater_screen_ef: J3DModelInstance;
    public underwater_screen_ef_btk = new mDoExt_btkAnm();

    // Wind
    public windTactAngleX: number = 0;
    public windTactAngleY: number = 0;
    public windVec = vec3.fromValues(0.0, 0.0, 0.0);
    public windPower = 0.0;
    public customWindPower = 0.0;

    // Rain.
    public rainCount: number = 0;
    public rainCountOrig: number = 0;

    // Thunder.
    public thunderMode: ThunderMode = ThunderMode.Off;
    public thunderActive: boolean = false;
    public thunderState: ThunderState = ThunderState.Clear;
    public thunderFlashTimer: number = 0;
    public thunderLightInfluence = new LIGHT_INFLUENCE();

    // Stars.
    public starAmount = 0.0;
    public starCount = 0;

    // Housi
    public housiCount = 0;

    public eventNightStop: boolean = false;
    public forceTimePass: boolean = false;

    // Wether packets
    public sunPacket: dKankyo_sun_Packet | null = null;
    public vrkumoPacket: dKankyo_vrkumo_Packet | null = null;
    public rainPacket: dKankyo_rain_Packet | null = null;
    public starPacket: dKankyo_star_Packet | null = null;
    public housiPacket: dKankyo_housi_Packet | null = null;

    public sunPos2 = vec3.create();
    public plightNearPos = vec3.create();
    public sunPos = vec3.create();
    public moonPos = vec3.create();
    public unk_10a0 = vec3.create();

    // Color palette
    public vrSkyCol = colorNewCopy(White);
    public vrKumoCol = colorNewCopy(White);
    public unk_vrboxCol1 = colorNewCopy(TransparentBlack); // mUnderCloudColor
    public unk_vrboxCol2 = colorNewCopy(TransparentBlack); // mUnderCloudShadowColor
    public unk_vrboxCol3 = colorNewCopy(TransparentBlack); // mCloudInnerHazeColor
    public vrKumoCenterCol = colorNewCopy(White);
    public vrKasumiMaeCol = colorNewCopy(White);

    public unk_10f0 = colorNewCopy(TransparentBlack);

    public actorAmbience = colorNewCopy(TransparentBlack);
    public bgAmbience = nArray(4, () => colorNewCopy(TransparentBlack));
    public unk_1128 = nArray(6, () => colorNewCopy(TransparentBlack));
    public fogColor = colorNewCopy(White);

    public actorAddAmb = colorNewCopy(TransparentBlack);
    public bgAddAmb = nArray(4, () => colorNewCopy(TransparentBlack));
    public fogAddCol = colorNewCopy(White);
    public vrboxAddcolSky0 = colorNewCopy(White);
    public vrboxAddcolKasumi = colorNewCopy(White);

    // Dice weather system
    public diceWeatherChangeTime: number;
    public diceWeatherTime: number = 0.0;
    public diceWeatherStop: boolean = false;
    public diceWeatherMode: DiceWeatherMode = DiceWeatherMode.Sunny;
    public diceWeatherState: DiceWeatherState = DiceWeatherState.Uninitialized;
    public diceWeatherCurrPattern: number = 0;
    public diceWeatherCounter: number = 0;

    public fogNear: number;
    public fogFar: number;

    public unk_11c8: number = 1.0;
    public unk_11cc: number = 1.0;
    public unk_11d0: number = 1.0;

    public unk_11ec: number = 0;
    public unk_11f0: number = 0;
    public unk_11f4: number = 0;

    public ColAllColRatio: number = 1.0;
    public ColActColRatio: number = 0.0;  // should be 1.0, temp until lighting is fixed
    public ColBgColRatio: number = 0.0;  // should be 1.0, temp until lighting is fixed
    public ColFogColRatio: number = 1.0;
    public ColVrSoraColRatio: number = 1.0;
    public ColVrKumoColRatio: number = 1.0;
    public unk_1210: number = 1.0;

    public allColRatio: number = 1.0;
    public actColRatio: number = 1.0;
    public bgColRatio: number = 1.0;
    public fogColRatio: number = 1.0;
    public vrSoraColRatio: number = 1.0;
    public vrKumoColRatio: number = 1.0;
    public unk_122c: number = 1.0;

    // Time
    public curTime: number = 0.0;
    public nextTime: number = 0.0;
    public timeSpeed: number = 0.012;
    public darkTime: number = 0.0;
    public calendarDay: number = 0.0;

    public actorLightEffect: number = 100;
    public paletteTerrainLightEffect: number = 1.0;
    public grassLightEffectRate: number;

    // eflight/plight closest to the player
    public playerEflightIdx: number = -1;
    public playerPlightIdx: number = -1;

    public envrIdxCurr: number = 0;
    public envrIdxPrev: number = 0;
    public colpatPrev: number = 0;
    public colpatCurr: number = 0;
    public colpatPrevGather: number = -1;
    public colpatCurrGather: number = -1;

    public colpatBlend: number = 1.0;
    public colpatBlendGather: number = -1.0;

    public unk_12cc: number = 0;

    // These appear to be enums ranging from 0-2? I don't know.
    public colpatMode: number = 0;
    public colpatModeGather: number = 0;

    // Weather.
    public colpatWeather = 0;

    // Sky
    public vrboxInvisible: boolean = true;

    public shadowMode: number = 0;
    public cameraInWater: boolean = false;
    public fogDensity: number;

    public pondSeason: number = 0;

    public lightSize: number = 1;

    // The game records this in a separate struct with a bunch of extra data, but we don't need it lol.
    public lightStatus = nArray(2, () => new Light());
}

export class LIGHT_INFLUENCE {
    public pos = vec3.create();
    public color = colorNewCopy(TransparentBlack);
    public power: number = 0;
    public fluctuation: number = 0;
    public index: number = 0;
}

export class WIND_INFLUENCE {
    public pos = vec3.create();
    public direction = vec3.create();
    public radius: number = 0;
    public strength: number = 0;
}

export class WIND_INF_ENTITY {
    public inUse: boolean = false;
    public minRadius: number = 0;
    public speed: number = 0;
    public maxStrength: number = 0;
    public influence = new WIND_INFLUENCE();
}

export class EFLIGHT_PROC {
    public state: number = 0;
    public frame: number = 0;
    public lightType: number = 0;
    public influence = new LIGHT_INFLUENCE();
}

export class DUNGEON_LIGHT {
    public pos = vec3.create();
    public color = colorNewCopy(TransparentBlack);
    public refDist: number = 1.0;
    public angleX: number = 0;
    public angleY: number = 0;
    public influence = new LIGHT_INFLUENCE();
}

export class BOSS_LIGHT {
    public pos = vec3.create();
    public color = colorNewCopy(TransparentBlack);
}

export class SND_INFLUENCE {
    public pos = vec3.create();
}

export class DALKMIST_INFLUENCE {
    public pos = vec3.create();
    public index: number;
}

export class EF_THUNDER {
    public status: number;
    public stateTimer: number;
    public mode: number;

    public influence = new LIGHT_INFLUENCE();
}

const enum LightMode {
    BG,
    Actor,
    BGwithPlight,
}

export class dKy_tevstr_c {
    // Pos is in world-space.
    public lightObj = new Light();
    public lights = nArray(6, () => new Light());

    public colorC0: Color = colorNewCopy(OpaqueBlack);
    public colorK0: Color = colorNewCopy(OpaqueBlack);
    public fogCol: Color = colorNewCopy(White);
    public fogStartZ: number = 0;
    public fogEndZ: number = 0;
    public colpatBlend: number = 0.0;

    public unk_364: number = 0;
    
    public unk_374: number = 1.0;
    public unk_378: number = 0;
    public unk_37a: number;
    public initTimer: number = 1;

    // someAnimTimer
    public envrIdxCurr: number;
    public envrIdxPrev: number;
    public colpatCurr: number;
    public colpatPrev: number;
    public roomNo: number;
    public envrOverride: number;
    public lightMode: LightMode;

    public initType: number = 0x7B;
    public unk_384: number = 0;
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

function dKy_light_influence_id(globals: dGlobals, pos: vec3, param_1: number): number {
    let envLight = globals.g_env_light;

    let bestDistance = 1000000;
    let bestIdx1 = -1;
    let bestIdx2 = -1;
    let var_r25 = -1;

    let compDist = 800;
    if (globals.stageName === "D_MN09") {
        compDist = 250;
    }

    for (let i = 0; i <= param_1; i++) {
        for (let j = 0; j < 100; j++) {
            const light = envLight.plights[j];

            if (light !== null && (i === 0 || j !== bestIdx1) && light.power > 0.01) {
                if (bestDistance > vec3.squaredDistance(pos, light.pos)) {
                    if (light.index & 0x8000) {
                        if (bestDistance > compDist) {
                            if (i === 0)
                                bestIdx1 = j;
                            else
                                bestIdx2 = j;

                            bestDistance = compDist;
                        }
                    } else {
                        bestDistance = vec3.squaredDistance(pos, light.pos);

                        if (bestDistance < light.power) {
                            if (globals.stageName === "D_MN05" && globals.mStayNo === 0) {
                                if (bestDistance < light.power * 0.5) {
                                    var_r25 = 99;
                                }
                            } else {
                                var_r25 = 99;
                            }
                        }

                        if (var_r25 !== -2) {
                            if (i === 0)
                                bestIdx1 = j;
                            else
                                bestIdx2 = j;
                        }
                    }
                }

                if (light.index < 0 && var_r25 != 99) {
                    if (i === 0)
                        bestIdx1 = j;

                    var_r25 = -2;
                }
            }
        }

        bestDistance = 1000000;
    }

    let ret = bestIdx2;
    if (param_1 === 0) {
        ret = bestIdx1;
    }

    return ret;
}

function dKy_eflight_influence_id(globals: dGlobals, pos: vec3, param_1: number): number {
    let envLight = globals.g_env_light;

    let bestDistance = 1000000;
    let bestIdx1 = -1;
    let bestIdx2 = -1;

    for (let i = 0; i <= param_1; i++) {
        for (let j = 0; j < 5; j++) {
            const light = envLight.eflights[j];

            if (light !== null && (i === 0 || j !== bestIdx1)) {
                if (bestDistance > vec3.squaredDistance(pos, light.pos) && light.power > 0.01) {
                    bestDistance = vec3.squaredDistance(pos, light.pos);

                    if (i === 0)
                        bestIdx1 = j;
                    else
                        bestIdx2 = j;
                }
            }
        }

        bestDistance = 1000000;
    }

    let ret = bestIdx2;
    if (param_1 === 0) {
        ret = bestIdx1;
    }

    return ret;
}

interface setLight_palno_pselenvr {
    envrIdxPrev: number;
    envrIdxCurr: number;
    colpatPrev: number;
    colpatCurr: number;
    colpatBlend: number;
}


class setLight_palno_ret {
    public palePrevA: stage_palet_info_class;
    public palePrevB: stage_palet_info_class;
    public paleCurrA: stage_palet_info_class;
    public paleCurrB: stage_palet_info_class;
    public blendPaleAB: number = 0;
}

function setLight_palno_get(dst: setLight_palno_ret, pselenvr: setLight_palno_pselenvr, globals: dGlobals, envLight: dScnKy_env_light_c): setLight_palno_ret {
    // NOTE(jstpierre): This is not part of the original game, but it happens on some test maps.
    // I think the game will just read uninitialized data here.
    if (pselenvr.envrIdxPrev >= envLight.envr.length)
        pselenvr.envrIdxPrev = 0;
    if (pselenvr.envrIdxCurr >= envLight.envr.length)
        pselenvr.envrIdxCurr = 0;
    // NOTE(jstpierre): The original game does this check when initializing the tevstr. Not sure
    // what will happen, but most actors that spawn on the stage have an override set up anyway...
    if (pselenvr.envrIdxPrev < 0)
        pselenvr.envrIdxPrev = globals.mStayNo;
    if (pselenvr.envrIdxCurr < 0)
        pselenvr.envrIdxCurr = globals.mStayNo;

    const envrPrev = envLight.envr[pselenvr.envrIdxPrev], envrCurr = envLight.envr[pselenvr.envrIdxCurr];

    let prevPselIdx = envrPrev.pselIdx[pselenvr.colpatPrev];
    if (prevPselIdx > 250) {
        prevPselIdx = 0;
    }

    let currPselIdx = envrCurr.pselIdx[pselenvr.colpatCurr];
    if (currPselIdx > 250) {
        currPselIdx = 0;
    }

    const pselPrev = envLight.colo[prevPselIdx], pselCurr = envLight.colo[currPselIdx];

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

    if (pselenvr.envrIdxPrev !== pselenvr.envrIdxCurr || pselenvr.colpatPrev !== pselenvr.colpatCurr) {
        const changeRateNormal = 1/30;
        if (pselCurr.changeRate < changeRateNormal) {
            pselCurr.changeRate = changeRateNormal;
        }

        if (envLight.colpatMode === 0) {
            if (pselCurr.changeRate > 0) {
                pselenvr.colpatBlend += changeRateNormal / pselCurr.changeRate;
            }

            if (globals.stageName === "F_SP121" && pselenvr.colpatPrev !== pselenvr.colpatCurr) {
                pselenvr.colpatBlend += changeRateNormal / 15.0;
            }

            if (pselenvr.colpatBlend >= 1.0) {
                pselenvr.envrIdxPrev = pselenvr.envrIdxCurr;
                pselenvr.colpatPrev = pselenvr.colpatCurr;
            }
        }
    }

    return dst;
}

function kankyo_color_ratio_calc_common(color: number, ratio: number): number {
    let ret = color * ratio * 1/255;

    if (ret < 0)
        return 0;
    else if (ret > 1)
        return 1;

    return ret;
}

function kankyo_color_ratio_calc(outColor: Color, inColor: Color, ratio: number): void {
    outColor.r = kankyo_color_ratio_calc_common(inColor.r, ratio);
    outColor.g = kankyo_color_ratio_calc_common(inColor.g, ratio);
    outColor.b = kankyo_color_ratio_calc_common(inColor.b, ratio);
}

function float_kankyo_color_ratio_set(v0A: number, v0B: number, blendAB: number, v1A: number, v1B: number, blend01: number, global: number, ratio: number): number {
    const v0 = lerp(v0A, v0B, blendAB);
    const v1 = lerp(v1A, v1B, blendAB);
    const v = lerp(v0, v1, blend01);
    return Math.max(0.0, lerp(v, global, ratio));
}

function kankyo_color_ratio_set(envLight: dScnKy_env_light_c, v0A: number, v0B: number, blendAB: number, v1A: number, v1B: number, blend01: number, add: number, ratio: number): number {
    const v0 = lerp(v0A, v0B, blendAB);
    const v1 = lerp(v1A, v1B, blendAB);

    return clamp((lerp(v0, v1, blend01) + add) * envLight.ColAllColRatio * ratio, 0.0, 1.0);
}

function dKy_calc_color_set(envLight: dScnKy_env_light_c, dst: Color, c0A: Color, c0B: Color, c1A: Color, c1B: Color, blendAB: number, blend01: number, add: Color | null, ratio: number): void {
    dst.r = kankyo_color_ratio_set(envLight, c0A.r, c0B.r, blendAB, c1A.r, c1B.r, blend01, add !== null ? add.r : 0, ratio);
    dst.g = kankyo_color_ratio_set(envLight, c0A.g, c0B.g, blendAB, c1A.g, c1B.g, blend01, add !== null ? add.g : 0, ratio);
    dst.b = kankyo_color_ratio_set(envLight, c0A.b, c0B.b, blendAB, c1A.b, c1B.b, blend01, add !== null ? add.b : 0, ratio);
}

const setLight_palno_ret_scratch = new setLight_palno_ret();

function setLight(globals: dGlobals, envLight: dScnKy_env_light_c): void {
    const ret = setLight_palno_get(setLight_palno_ret_scratch, envLight, globals, envLight);

    if (ret.palePrevA === null) {
        envLight.actorAmbience.r = 1;
        envLight.actorAmbience.g = 0;
        envLight.actorAmbience.b = 0;
    } else {
        dKy_calc_color_set(envLight, envLight.actorAmbience, ret.palePrevA.actCol, ret.palePrevB.actCol, ret.paleCurrA.actCol, ret.paleCurrB.actCol, ret.blendPaleAB, envLight.colpatBlend, null, envLight.unk_1210 * envLight.ColActColRatio * envLight.ColActColRatio);

        for (let whichBG = 0; whichBG < 4; whichBG++) {
            if (whichBG !== 3 || (globals.stageName !== "F_SP127" && globals.stageName !== "R_SP127")) {
                dKy_calc_color_set(envLight, envLight.bgAmbience[whichBG], ret.palePrevA.unkCol[whichBG], ret.palePrevB.unkCol[whichBG], ret.paleCurrA.unkCol[whichBG], ret.paleCurrB.unkCol[whichBG], ret.blendPaleAB, envLight.colpatBlend, null, envLight.ColBgColRatio);
            }
        }

        envLight.bgAmbience[1].a = kankyo_color_ratio_set(envLight, ret.palePrevA.unk_31, ret.palePrevB.unk_31, ret.paleCurrA.unk_31, ret.paleCurrB.unk_31, ret.blendPaleAB, envLight.colpatBlend, 0, 1);
        envLight.bgAmbience[2].a = kankyo_color_ratio_set(envLight, ret.palePrevA.unk_32, ret.palePrevB.unk_32, ret.paleCurrA.unk_32, ret.paleCurrB.unk_32, ret.blendPaleAB, envLight.colpatBlend, 0, 1);
        envLight.bgAmbience[3].a = kankyo_color_ratio_set(envLight, ret.palePrevA.unk_33, ret.palePrevB.unk_33, ret.paleCurrA.unk_33, ret.paleCurrB.unk_33, ret.blendPaleAB, envLight.colpatBlend, 0, 1);

        envLight.paletteTerrainLightEffect = kankyo_color_ratio_set(envLight, ret.palePrevA.unk_2d, ret.palePrevB.unk_2d, ret.paleCurrA.unk_2d, ret.paleCurrB.unk_2d, ret.blendPaleAB, envLight.colpatBlend, 0, 1) * (0.01 / 0xFF);
        if (envLight.paletteTerrainLightEffect > (2.0 / 0xFF)) {
            envLight.paletteTerrainLightEffect = (1.0 / 0xFF);
        }

        envLight.fogDensity = kankyo_color_ratio_set(envLight, ret.palePrevA.unk_2e, ret.palePrevB.unk_2e, ret.paleCurrA.unk_2e, ret.paleCurrB.unk_2e, ret.blendPaleAB, envLight.colpatBlend, 0, 1);

        for (let i = 0; i < 6; i++) {
            dKy_calc_color_set(envLight, envLight.unk_1128[i], ret.palePrevA.unkCol2[i], ret.palePrevB.unkCol2[i], ret.paleCurrA.unkCol2[i], ret.paleCurrB.unkCol2[i], ret.blendPaleAB, envLight.colpatBlend, null, envLight.ColBgColRatio);
            envLight.dungeonLight[i].color = envLight.unk_1128[i];
        }

        dKy_calc_color_set(envLight, envLight.fogColor, ret.palePrevA.unkCol3, ret.palePrevB.unkCol3, ret.paleCurrA.unkCol3, ret.paleCurrB.unkCol3, ret.blendPaleAB, envLight.colpatBlend, envLight.fogAddCol, envLight.ColFogColRatio);
        envLight.fogNear = float_kankyo_color_ratio_set(ret.palePrevA.fogStartZ, ret.palePrevB.fogStartZ, ret.blendPaleAB, ret.paleCurrA.fogStartZ, ret.paleCurrB.fogStartZ, envLight.colpatBlend, envLight.unk_11ec, envLight.unk_11f4);
        envLight.fogFar = Math.max(envLight.fogNear, float_kankyo_color_ratio_set(ret.palePrevA.fogEndZ, ret.palePrevB.fogEndZ, ret.blendPaleAB, ret.paleCurrA.fogEndZ, ret.paleCurrB.fogEndZ, envLight.colpatBlend, envLight.unk_11ec, envLight.unk_11f4));

        const virt0A = envLight.virt[ret.palePrevA.virtIdx] || envLight.virt[0];
        const virt0B = envLight.virt[ret.palePrevB.virtIdx] || envLight.virt[0];
        const virt1A = envLight.virt[ret.paleCurrA.virtIdx] || envLight.virt[0];
        const virt1B = envLight.virt[ret.paleCurrB.virtIdx] || envLight.virt[0];
        
        envLight.vrSkyCol.r = kankyo_color_ratio_set(envLight, virt0A.unkCol_0.r, virt0B.unkCol_0.r, ret.blendPaleAB, virt1A.unkCol_0.r, virt1B.unkCol_0.r, envLight.colpatBlend, envLight.vrboxAddcolSky0.r, envLight.ColVrSoraColRatio * envLight.unk_11c8);
        envLight.vrSkyCol.g = kankyo_color_ratio_set(envLight, virt0A.unkCol_0.g, virt0B.unkCol_0.g, ret.blendPaleAB, virt1A.unkCol_0.g, virt1B.unkCol_0.g, envLight.colpatBlend, envLight.vrboxAddcolSky0.g, envLight.ColVrSoraColRatio * envLight.unk_11cc);
        envLight.vrSkyCol.b = kankyo_color_ratio_set(envLight, virt0A.unkCol_0.b, virt0B.unkCol_0.b, ret.blendPaleAB, virt1A.unkCol_0.b, virt1B.unkCol_0.b, envLight.colpatBlend, envLight.vrboxAddcolSky0.b, envLight.ColVrSoraColRatio * envLight.unk_11d0);
        envLight.vrSkyCol.a = 1;

        envLight.vrKumoCol.r = kankyo_color_ratio_set(envLight, virt0A.unkCol_0.a, virt0B.unkCol_0.a, ret.blendPaleAB, virt1A.unkCol_0.a, virt1B.unkCol_0.a, envLight.colpatBlend, envLight.vrboxAddcolSky0.r, envLight.ColVrKumoColRatio * envLight.unk_11c8);
        envLight.vrKumoCol.g = kankyo_color_ratio_set(envLight, virt0A.unkCol_4.r, virt0B.unkCol_4.r, ret.blendPaleAB, virt1A.unkCol_4.r, virt1B.unkCol_4.r, envLight.colpatBlend, envLight.vrboxAddcolSky0.g, envLight.ColVrKumoColRatio * envLight.unk_11cc);
        envLight.vrKumoCol.b = kankyo_color_ratio_set(envLight, virt0A.unkCol_4.g, virt0B.unkCol_4.g, ret.blendPaleAB, virt1A.unkCol_4.g, virt1B.unkCol_4.g, envLight.colpatBlend, envLight.vrboxAddcolSky0.b, envLight.ColVrKumoColRatio * envLight.unk_11d0);
        envLight.vrKumoCol.a = kankyo_color_ratio_set(envLight, virt0A.kumoCenterCol.g, virt0B.kumoCenterCol.g, ret.blendPaleAB, virt1A.kumoCenterCol.g, virt1B.kumoCenterCol.g, envLight.colpatBlend, 0, 1);
    
        envLight.unk_vrboxCol1.r = kankyo_color_ratio_set(envLight, virt0A.unkCol_4.b, virt0B.unkCol_4.b, ret.blendPaleAB, virt1A.unkCol_4.b, virt1B.unkCol_4.b, envLight.colpatBlend, envLight.vrboxAddcolSky0.r, envLight.ColVrKumoColRatio * envLight.unk_11c8);
        envLight.unk_vrboxCol1.g = kankyo_color_ratio_set(envLight, virt0A.unkCol_4.a, virt0B.unkCol_4.a, ret.blendPaleAB, virt1A.unkCol_4.a, virt1B.unkCol_4.a, envLight.colpatBlend, envLight.vrboxAddcolSky0.g, envLight.ColVrKumoColRatio * envLight.unk_11cc);
        envLight.unk_vrboxCol1.b = kankyo_color_ratio_set(envLight, virt0A.kumoCol.r, virt0B.kumoCol.r, ret.blendPaleAB, virt1A.kumoCol.r, virt1B.kumoCol.r, envLight.colpatBlend, envLight.vrboxAddcolSky0.b, envLight.ColVrKumoColRatio * envLight.unk_11d0);
    
        envLight.unk_vrboxCol2.r = kankyo_color_ratio_set(envLight, virt0A.kumoCol.g, virt0B.kumoCol.g, ret.blendPaleAB, virt1A.kumoCol.g, virt1B.kumoCol.g, envLight.colpatBlend, envLight.vrboxAddcolSky0.r, envLight.ColVrKumoColRatio * envLight.unk_11c8);
        envLight.unk_vrboxCol2.g = kankyo_color_ratio_set(envLight, virt0A.kumoCol.b, virt0B.kumoCol.b, ret.blendPaleAB, virt1A.kumoCol.b, virt1B.kumoCol.b, envLight.colpatBlend, envLight.vrboxAddcolSky0.g, envLight.ColVrKumoColRatio * envLight.unk_11cc);
        envLight.unk_vrboxCol2.b = kankyo_color_ratio_set(envLight, virt0A.kumoCenterCol.r, virt0B.kumoCenterCol.r, ret.blendPaleAB, virt1A.kumoCenterCol.r, virt1B.kumoCenterCol.r, envLight.colpatBlend, envLight.vrboxAddcolSky0.b, envLight.ColVrKumoColRatio * envLight.unk_11d0);
    
        envLight.vrKasumiMaeCol.r = kankyo_color_ratio_set(envLight, virt0A.kumoCenterCol.b, virt0B.kumoCenterCol.b, ret.blendPaleAB, virt1A.kumoCenterCol.b, virt1B.kumoCenterCol.b, envLight.colpatBlend, envLight.vrboxAddcolKasumi.r, envLight.ColVrSoraColRatio * envLight.unk_11c8);
        envLight.vrKasumiMaeCol.g = kankyo_color_ratio_set(envLight, virt0A.skyCol.r, virt0B.skyCol.r, ret.blendPaleAB, virt1A.skyCol.r, virt1B.skyCol.r, envLight.colpatBlend, envLight.vrboxAddcolKasumi.g, envLight.ColVrSoraColRatio * envLight.unk_11cc);
        envLight.vrKasumiMaeCol.b = kankyo_color_ratio_set(envLight, virt0A.skyCol.g, virt0B.skyCol.g, ret.blendPaleAB, virt1A.skyCol.g, virt1B.skyCol.g, envLight.colpatBlend, envLight.vrboxAddcolKasumi.b, envLight.ColVrSoraColRatio * envLight.unk_11d0);
        envLight.vrKasumiMaeCol.a = kankyo_color_ratio_set(envLight, virt0A.skyCol.b, virt0B.skyCol.b, ret.blendPaleAB, virt1A.skyCol.b, virt1B.skyCol.b, envLight.colpatBlend, 0, 1);
    
        envLight.unk_vrboxCol3.r = kankyo_color_ratio_set(envLight, virt0A.kasumiMaeCol.r, virt0B.kasumiMaeCol.r, ret.blendPaleAB, virt1A.kasumiMaeCol.r, virt1B.kasumiMaeCol.r, envLight.colpatBlend, envLight.vrboxAddcolKasumi.r, envLight.ColVrSoraColRatio * envLight.unk_11c8);
        envLight.unk_vrboxCol3.g = kankyo_color_ratio_set(envLight, virt0A.kasumiMaeCol.g, virt0B.kasumiMaeCol.g, ret.blendPaleAB, virt1A.kasumiMaeCol.g, virt1B.kasumiMaeCol.g, envLight.colpatBlend, envLight.vrboxAddcolKasumi.g, envLight.ColVrSoraColRatio * envLight.unk_11cc);
        envLight.unk_vrboxCol3.b = kankyo_color_ratio_set(envLight, virt0A.kasumiMaeCol.b, virt0B.kasumiMaeCol.b, ret.blendPaleAB, virt1A.kasumiMaeCol.b, virt1B.kasumiMaeCol.b, envLight.colpatBlend, envLight.vrboxAddcolKasumi.b, envLight.ColVrSoraColRatio * envLight.unk_11d0);
        envLight.unk_vrboxCol3.a = kankyo_color_ratio_set(envLight, virt0A.unk_14, virt0B.unk_14, ret.blendPaleAB, virt1A.unk_14, virt1B.unk_14, envLight.colpatBlend, 0, 1);
    
    }
}

function setLight_actor(globals: dGlobals, envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c): void {
    tevStr.colpatPrev = envLight.colpatPrev;
    tevStr.colpatCurr = envLight.colpatCurr;
    if (tevStr.colpatPrev !== tevStr.colpatCurr)
        tevStr.colpatBlend = envLight.colpatBlend;
    else if (tevStr.envrIdxPrev === tevStr.envrIdxCurr)
        tevStr.colpatBlend = 0.0;

    const ret = setLight_palno_get(setLight_palno_ret_scratch, tevStr, globals, envLight)

    if (ret.palePrevA === null) {
        for (let i = 0; i < 4; i++) {
            tevStr.colorC0.r = 1.0;
            tevStr.colorC0.g = 0;
            tevStr.colorC0.b = 0;
        }
    } else {
        if (tevStr.unk_37a == LightType.UNK_10 || tevStr.unk_37a == LightType.UNK_9 || tevStr.unk_378 != 0) {
            dKy_calc_color_set(envLight, tevStr.colorC0, ret.palePrevA.actCol, ret.palePrevB.actCol, ret.paleCurrA.actCol, ret.paleCurrB.actCol, ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, tevStr.unk_374 * envLight.ColActColRatio * envLight.ColActColRatio);
        } else {
            dKy_calc_color_set(envLight, tevStr.colorC0, ret.palePrevA.actCol, ret.palePrevB.actCol, ret.paleCurrA.actCol, ret.paleCurrB.actCol, ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, tevStr.unk_374 * envLight.unk_1210 * envLight.ColActColRatio * envLight.ColActColRatio);
        }

        const sp50 = nArray(6, () => colorNewCopy(OpaqueBlack));
        for (let i = 0; i < 6; i++) {
            if (i === 0) {
                if (tevStr.unk_37a === LightType.UNK_10 || tevStr.unk_37a === LightType.UNK_9 || tevStr.unk_378 !== 0) {
                    dKy_calc_color_set(envLight, sp50[i], ret.palePrevA.unkCol2[i], ret.palePrevB.unkCol2[i], ret.paleCurrA.unkCol2[i], ret.paleCurrB.unkCol2[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, 1.0);
    
                    tevStr.lights[i].Color = dKy_light_influence_col(sp50[i], tevStr.unk_374);
                } else {
                    dKy_calc_color_set(envLight, sp50[i], ret.palePrevA.unkCol2[i], ret.palePrevB.unkCol2[i], ret.paleCurrA.unkCol2[i], ret.paleCurrB.unkCol2[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, envLight.unk_1210);
                
                    kankyo_color_ratio_calc(tevStr.lights[i].Color, sp50[i], envLight.unk_1210 * tevStr.unk_374);
                }
            } else if (tevStr.unk_37a === LightType.UNK_10 || tevStr.unk_37a === LightType.UNK_9 || tevStr.unk_378 !== 0) {
                dKy_calc_color_set(envLight, sp50[i], ret.palePrevA.unkCol2[i], ret.palePrevB.unkCol2[i], ret.paleCurrA.unkCol2[i], ret.paleCurrB.unkCol2[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, envLight.ColActColRatio * envLight.ColActColRatio);
    
                tevStr.lights[i].Color = dKy_light_influence_col(sp50[i], tevStr.unk_374);
            } else {
                dKy_calc_color_set(envLight, sp50[i], ret.palePrevA.unkCol2[i], ret.palePrevB.unkCol2[i], ret.paleCurrA.unkCol2[i], ret.paleCurrB.unkCol2[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, envLight.unk_1210 * envLight.ColActColRatio * envLight.ColActColRatio);
                
                kankyo_color_ratio_calc(tevStr.lights[i].Color, sp50[i], envLight.unk_1210 * tevStr.unk_374);
            }
        }

        dKy_calc_color_set(envLight, envLight.fogColor, ret.palePrevA.unkCol3, ret.palePrevB.unkCol3, ret.paleCurrA.unkCol3, ret.paleCurrB.unkCol3, ret.blendPaleAB, tevStr.colpatBlend, envLight.fogAddCol, envLight.ColFogColRatio);
    }
}

function dKy_light_influence_col(inColor:Color, ratio:number): Color {
    let retColor = colorNewCopy(White);

    let r = inColor.r * ratio * 1/255;
    if (r > 1) {
        retColor.r = 1;
    } else {
        retColor.r = r;
    }

    let g = inColor.g * ratio * 1/255;
    if (g > 1) {
        retColor.g = 1;
    } else {
        retColor.g = g;
    }

    let b = inColor.b * ratio * 1/255;
    if (b > 1) {
        retColor.b = 1;
    } else {
        retColor.b = b;
    }

    return retColor;    
}

function setLight_bg(globals: dGlobals, envLight: dScnKy_env_light_c, outColor: Color[], outColor2: Color, tevStr: dKy_tevstr_c): void {
    tevStr.colpatPrev = envLight.colpatPrev;
    tevStr.colpatCurr = envLight.colpatCurr;
    if (tevStr.colpatPrev !== tevStr.colpatCurr)
        tevStr.colpatBlend = envLight.colpatBlend;

    const ret = setLight_palno_get(setLight_palno_ret_scratch, envLight, globals, envLight)

    if (ret.palePrevA === null) {
        for (let i = 0; i < 4; i++) {
            outColor[i].r = 1.0;
            outColor[i].g = 0;
            outColor[i].b = 0;
        }
    } else {

        for (let i = 0; i < 4; i++) {
            dKy_calc_color_set(envLight, outColor[i], ret.palePrevA.unkCol[i], ret.palePrevB.unkCol[i], ret.paleCurrA.unkCol[i], ret.paleCurrB.unkCol[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.bgAddAmb[0], envLight.ColBgColRatio);
        }

        outColor[3].a = 1.0;
        outColor[2].a = 1.0;
        outColor[1].a = 1.0;
        outColor[0].a = 1.0;

        const sp50 = nArray(6, () => colorNewCopy(OpaqueBlack));
        for (let i = 0; i < 6; i++) {
            dKy_calc_color_set(envLight, sp50[i], ret.palePrevA.unkCol2[i], ret.palePrevB.unkCol2[i], ret.paleCurrA.unkCol2[i], ret.paleCurrB.unkCol2[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.bgAddAmb[0], envLight.ColBgColRatio);
            
            tevStr.lights[i].Color = dKy_light_influence_col(sp50[i], tevStr.unk_374);
        }

        dKy_calc_color_set(envLight, outColor2, ret.palePrevA.unkCol3, ret.palePrevB.unkCol3, ret.paleCurrA.unkCol3, ret.paleCurrB.unkCol3, ret.blendPaleAB, tevStr.colpatBlend, envLight.fogAddCol, envLight.ColFogColRatio);
    }
}

export function dKy_light_influence_distance(envLight: dScnKy_env_light_c, pos: vec3, index: number): number {
    if (index < 0) {
        index = 0;
    }

    return vec3.squaredDistance(pos, envLight.plights[index].pos);
}

export function dKy_light_influence_power(envLight: dScnKy_env_light_c, index: number): number {
    if (index < 0) {
        index = 0;
    }

    return envLight.plights[index].power;
}

function settingTevStruct_plightcol_plus(globals: dGlobals, pos: vec3, tevStr: dKy_tevstr_c, initTimer: number): void {
    const envLight = globals.g_env_light;
    assertExists(pos);

    tevStr.lightObj.Color.a = 1.0;

    let plightIdx = dKy_light_influence_id(globals, pos, 0);

    if (tevStr.unk_37a === 7 || tevStr.unk_37a === 1 || tevStr.unk_37a === 2 || tevStr.unk_37a === 6 || tevStr.unk_37a === 3 || tevStr.unk_37a === 4 || tevStr.unk_37a === 5) {
        plightIdx = -2;
    } else if (tevStr.unk_37a === 9 && dKy_darkworld_check(globals)) {
        plightIdx = -2;
    }

    let bvar = false;
    if (plightIdx >= 0) {
        let influence_dist = dKy_light_influence_distance(envLight, pos, plightIdx);
        let influence_power = dKy_light_influence_power(envLight, plightIdx);

        if (influence_power < 0.001) {
            influence_power = 0.001;
        }

        if (influence_dist < influence_power + 1000) {
            bvar = true;
        }
    }

    if (!bvar) {
        // envLight.unk_10f8 = dKy_light_influence_col()
    } else {
        // yuragi stuff
    }
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
}

function settingTevStruct_colget_actor(globals: dGlobals, envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c): void {
    if (tevStr.envrOverride !== -1) {
        if (envLight.actorLightEffect === 100) {
            cLib_addCalc(tevStr.unk_374, tevStr.envrOverride / 100, 0.25, 0.05, 0.000001);
        }
    } else {
        if (tevStr.roomNo >= 0) {
            tevStr.envrIdxCurr = tevStr.roomNo;

            if (envLight.actorLightEffect === 100) {
                cLib_addCalc(tevStr.unk_374, 1.0, 0.25, 0.05, 0.000001);
            }
        } else {
            tevStr.envrIdxCurr = 0;
        }
    }

    if ((tevStr.unk_37a !== 0 && tevStr.unk_37a <= LightType.UNK_7) || (tevStr.unk_37a === LightType.UNK_9 && dKy_darkworld_check(globals))) {
        if ((tevStr.unk_37a !== LightType.UNK_2 && tevStr.unk_37a !== LightType.UNK_3) || dKy_darkworld_check(globals)) {
            tevStr.unk_374 = 0.0;
        }
    }

    if (tevStr.envrIdxPrev !== tevStr.envrIdxCurr && (tevStr.colpatBlend >= 0.0 || tevStr.colpatBlend <= 1.0))
        tevStr.colpatBlend = 0.0;

    if (tevStr.unk_37a !== 8) {
        setLight_actor(globals, envLight, tevStr);

        envLight.actorAmbience.r = tevStr.colorC0.r;
        envLight.actorAmbience.g = tevStr.colorC0.g;
        envLight.actorAmbience.b = tevStr.colorC0.b;
        envLight.actorAmbience.a = tevStr.colorC0.a;
    } else {
        let calcColor = nArray(4, () => colorNewCopy(TransparentBlack));
        setLight_bg(globals, envLight, calcColor, envLight.fogColor, tevStr);

        envLight.actorAmbience.r = calcColor[0].r;
        envLight.actorAmbience.g = calcColor[0].g;
        envLight.actorAmbience.b = calcColor[0].b;
        envLight.actorAmbience.a = calcColor[0].a;
    }
}

export function settingTevStruct_colget_player(envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c): void {
    if (tevStr.envrOverride !== -1) {
        if (envLight.actorLightEffect === 100)
            cLib_addCalc(tevStr.unk_374, tevStr.envrOverride / 100, 0.25, 0.05, 0.000001);
    } else if (tevStr.roomNo >= 0) {
        tevStr.envrIdxCurr = tevStr.roomNo;

        if (envLight.actorLightEffect === 100) {
            cLib_addCalc(tevStr.unk_374, tevStr.envrOverride / 100, 0.25, 0.05, 0.000001);
        }
    }
}

export function settingTevStruct(globals: dGlobals, lightType: LightType, pos: vec3 | null, tevStr: dKy_tevstr_c): void {
    const envLight = globals.g_env_light;

    let sp30 = colorNewCopy(TransparentBlack);
    let k0_color = colorNewCopy(TransparentBlack);

    if (tevStr.roomNo < 0) {
        tevStr.roomNo = globals.mStayNo;
    }

    if (envLight.actorLightEffect !== 100) {
        tevStr.unk_374 = envLight.actorLightEffect / 100;
    }

    tevStr.unk_37a = lightType;

    if (tevStr.initType !== 123 && tevStr.initType !== 124) {
        dKy_tevstr_init(tevStr, globals.mStayNo);
    }

    tevStr.initType = 124;
    envLight.actorAmbience.a = 1.0;

    if (lightType === LightType.UNK_14) {
        tevStr.lightMode = LightMode.BG;
        if (tevStr.roomNo >= 128) {
            tevStr.envrIdxCurr = 0;
        } else {
            tevStr.envrIdxCurr = tevStr.roomNo;
        }

        if (!dKy_darkworld_check(globals)) {
            envLight.unk_10f0.r = 24 * (1/255);
            envLight.unk_10f0.g = 24 * (1/255);
            envLight.unk_10f0.b = 24 * (1/255);
            envLight.unk_10f0.a = 1.0;
        } else {
            envLight.unk_10f0.r = 55 * (1/255);
            envLight.unk_10f0.g = 55 * (1/255);
            envLight.unk_10f0.b = 77 * (1/255);
        }

        k0_color.r = 1.0;
        k0_color.g = 1.0;
        k0_color.b = 1.0;

        for (let i = 0; i < 6; i++) {
            if (i === 0) {
                if (!dKy_darkworld_check(globals)) {
                    tevStr.lights[i].Color.r = 126 * (1/255);
                    tevStr.lights[i].Color.g = 110 * (1/255);
                    tevStr.lights[i].Color.b = 89 * (1/255);
                } else {
                    tevStr.lights[i].Color.r = 0;
                    tevStr.lights[i].Color.g = 0;
                    tevStr.lights[i].Color.b = 0;
                }
            } else if (i === 1) {
                if (!dKy_darkworld_check(globals)) {
                    tevStr.lights[i].Color.r = 24 * (1/255);
                    tevStr.lights[i].Color.g = 41 * (1/255);
                    tevStr.lights[i].Color.b = 50 * (1/255);
                } else {
                    tevStr.lights[i].Color.r = 0;
                    tevStr.lights[i].Color.g = 0;
                    tevStr.lights[i].Color.b = 0;
                }
            } else {
                tevStr.lights[i].Color.r = 0;
                tevStr.lights[i].Color.g = 0;
                tevStr.lights[i].Color.b = 0;
            }

            if (i === 0) {
                tevStr.lights[i].Position[0] = 500;
                tevStr.lights[i].Position[1] = 500;
                tevStr.lights[i].Position[2] = 500;
            } else if (i === 1) {
                tevStr.lights[i].Position[0] = -500;
                tevStr.lights[i].Position[1] = -500;
                tevStr.lights[i].Position[2] = -500;
            }

            tevStr.lights[i].Direction[0] = -tevStr.lights[i].Direction[0];
            tevStr.lights[i].Direction[1] = -tevStr.lights[i].Direction[1];
            tevStr.lights[i].Direction[2] = -tevStr.lights[i].Direction[2];
        }

        tevStr.lightObj.Color.r = 0;
        tevStr.lightObj.Color.g = 0;
        tevStr.lightObj.Color.b = 0;

        tevStr.lightObj.CosAtten = [1, 0, 0];
        tevStr.lightObj.DistAtten = [1, 0, 0];
    } else if (lightType === LightType.UNK_12 || lightType === LightType.UNK_13) {
        tevStr.fogCol.r = 0;
        tevStr.fogCol.g = 0;
        tevStr.fogCol.b = 0;
        tevStr.fogCol.a = 0;

        tevStr.lightMode = LightMode.BG;

        if (tevStr.roomNo >= 128) {
            tevStr.envrIdxCurr = 0;
        } else {
            tevStr.envrIdxCurr = tevStr.roomNo;
        }

        if (lightType === LightType.UNK_12) {
            envLight.unk_10f0.r = 25 * (1/255);
            envLight.unk_10f0.g = 20 * (1/255);
            envLight.unk_10f0.b = 25 * (1/255);
        } else {
            envLight.unk_10f0.r = 40 * (1/255);
            envLight.unk_10f0.g = 35 * (1/255);
            envLight.unk_10f0.b = 30 * (1/255);
        }

        envLight.unk_10f0.a = 1.0;

        k0_color.r = 1.0;
        k0_color.g = 1.0;
        k0_color.b = 1.0;

        for (let i = 0; i < 6; i++) {
            if (i === 0) {
                if (lightType === LightType.UNK_12) {
                    tevStr.lights[i].Position[0] = -30000;
                    tevStr.lights[i].Position[1] = 18800;
                    tevStr.lights[i].Position[2] = 29000;
                    tevStr.lights[i].Color.r = 120 * (1/255);
                    tevStr.lights[i].Color.g = 110 * (1/255);
                    tevStr.lights[i].Color.b = 100 * (1/255);
                } else {
                    tevStr.lights[i].Position[0] = -37000;
                    tevStr.lights[i].Position[1] = 18800;
                    tevStr.lights[i].Position[2] = 500;
                    tevStr.lights[i].Color.r = 85 * (1/255);
                    tevStr.lights[i].Color.g = 90 * (1/255);
                    tevStr.lights[i].Color.b = 100 * (1/255);
                }
            } else if (i === 1) {
                if (lightType === LightType.UNK_12) {
                    tevStr.lights[i].Position[0] = 14400;
                    tevStr.lights[i].Position[1] = 7500;
                    tevStr.lights[i].Position[2] = 3900;
                    tevStr.lights[i].Color.r = 30 * (1/255);
                    tevStr.lights[i].Color.g = 45 * (1/255);
                    tevStr.lights[i].Color.b = 30 * (1/255);
                } else {
                    tevStr.lights[i].Position[0] = -18000;
                    tevStr.lights[i].Position[1] = -6500;
                    tevStr.lights[i].Position[2] = -10000;
                    tevStr.lights[i].Color.r = 100 * (1/255);
                    tevStr.lights[i].Color.g = 65 * (1/255);
                    tevStr.lights[i].Color.b = 40 * (1/255);
                }
            } else {
                tevStr.lights[i].Color.r = 0;
                tevStr.lights[i].Color.g = 0;
                tevStr.lights[i].Color.b = 0;
            }

            tevStr.lights[i].Direction[0] = -tevStr.lights[i].Direction[0];
            tevStr.lights[i].Direction[1] = -tevStr.lights[i].Direction[1];
            tevStr.lights[i].Direction[2] = -tevStr.lights[i].Direction[2];
        }

        tevStr.lightObj.Color.r = 0;
        tevStr.lightObj.Color.g = 0;
        tevStr.lightObj.Color.b = 0;

        tevStr.lightObj.CosAtten = [1, 0, 0];
        tevStr.lightObj.DistAtten = [1, 0, 0];
    } else if (!(lightType & 0xF0)) {
        tevStr.lightMode = LightMode.Actor;
        sp30 = envLight.actorAmbience;
        k0_color = envLight.fogColor;

        if (lightType === LightType.UNK_0 || lightType === LightType.UNK_8 || lightType === LightType.UNK_7 || lightType === LightType.UNK_1 || lightType === LightType.UNK_2 || lightType === LightType.UNK_3 || lightType === LightType.UNK_5 || lightType === LightType.UNK_4 || lightType === LightType.UNK_11) {
            settingTevStruct_colget_actor(globals, globals.g_env_light, tevStr);
        } else if (lightType === LightType.UNK_10 || lightType === LightType.UNK_9) {
            settingTevStruct_colget_player(envLight, tevStr);
            settingTevStruct_colget_actor(globals, globals.g_env_light, tevStr);
        }

        envLight.unk_10f0.r = sp30.r;
        envLight.unk_10f0.g = sp30.g;
        envLight.unk_10f0.b = sp30.b;
        envLight.unk_10f0.a = 1.0;

        if (lightType !== LightType.UNK_11) {
            const initTimer = 0;
            settingTevStruct_plightcol_plus(globals, assertExists(pos), tevStr, initTimer);
        }

        if (lightType === LightType.UNK_10 || lightType === LightType.UNK_9) {
            // vec3.copy(envLight.plightNearPos, tevStr.);
        }
    } else {
        tevStr.lightMode = LightMode.BG;
        if (tevStr.unk_37a !== 20) {
            tevStr.unk_374 = globals.g_env_light.paletteTerrainLightEffect;
        } else {
            switch (tevStr.unk_364) {
            case 0:
                tevStr.unk_374 = 0.2;
                break;
            case 1:
                tevStr.unk_374 = 0.3;
                break;
            case 2:
                tevStr.unk_374 = 0.4;
                break;
            case 3:
                tevStr.unk_374 = 0.6;
                break;
            case 4:
                tevStr.unk_374 = 0.8;
                break;
            case 5:
                tevStr.unk_374 = 0.9;
                break;
            case 6:
                tevStr.unk_374 = 1.0;
                break;
            case 7:
                tevStr.unk_374 = 1.2;
                break;
            default:
                tevStr.unk_374 = 1.0;
                break;
            }
        }

        if (tevStr.roomNo >= 128) {
            tevStr.envrIdxCurr = 0;
        } else {
            tevStr.envrIdxCurr = tevStr.roomNo;
        }

        let spB0 = nArray(4, () => colorNewCopy(TransparentBlack));
        setLight_bg(globals, globals.g_env_light, spB0, k0_color, tevStr);

        globals.g_env_light.unk_10f0 = spB0[lightType & 3];

        const pos = vec3.create();
        vec3.set(pos, 0, 0, 0);
        let plightIdx = dKy_light_influence_id(globals, pos, 0);
        /* if (plightIdx >= 0 && envLight.plights[plightIdx].priority < 0) {

        } */

        tevStr.lightObj.Color.r = 0;
        tevStr.lightObj.Color.g = 0;
        tevStr.lightObj.Color.b = 0;

        tevStr.lightObj.CosAtten = [0, 0, 0];
        tevStr.lightObj.DistAtten = [0, 0, 0];

        globals.g_env_light.unk_10f0.a = 1.0;
        tevStr.colorC0 = globals.g_env_light.unk_10f0;
        tevStr.colorK0 = sp30;

        vec3.copy(tevStr.lightObj.Position, envLight.lightStatus[0].Position);
        // Direction does not matter.
        if (lightType >= LightType.BG0 && lightType <= LightType.BG5)
            colorFromRGBA(tevStr.lightObj.Color, 1, 1, 1, 1);
        else
            colorFromRGBA(tevStr.lightObj.Color, 1, 0, 0, 1);
    }

    globals.g_env_light.unk_10f0.a = 1.0;
    tevStr.colorC0 = globals.g_env_light.unk_10f0;
    tevStr.colorK0 = sp30;
}

export function dKy_tevstr_init(tevstr: dKy_tevstr_c, roomNo: number, envrOverride: number = -1): void {
    tevstr.roomNo = roomNo;
    tevstr.envrIdxCurr = tevstr.roomNo;
    tevstr.envrIdxPrev = tevstr.roomNo;
    tevstr.envrOverride = envrOverride;

    tevstr.initTimer = 1;
    tevstr.initType = 0x7B;
    tevstr.unk_374 = 1.0;
    
    tevstr.lightObj.Color.g = 0;
    tevstr.lightObj.Color.b = 0;
    tevstr.lightObj.Color.a = 1.0;

    for (let i = 0; i < tevstr.lights.length; i++) {
        vec3.set(tevstr.lights[i].Position, -36384.5, 29096.7, 17422.2);
        tevstr.lights[i].Color.r = 1.0;
        tevstr.lights[i].Color.g = 1.0;
        tevstr.lights[i].Color.b = 1.0;
        tevstr.lights[i].Color.a = 1.0;
    }
}

function GxFogSet_Sub(fog: FogBlock, tevStr: { fogStartZ: number, fogEndZ: number, fogCol: Color }, camera: Camera, fogColor = tevStr.fogCol) {
    colorCopy(fog.Color, fogColor);

    // Empirically decided.
    const fogFarPlane = Number.isFinite(camera.far) ? camera.far : 100000;

    const type = camera.isOrthographic ? FogType.ORTHO_LIN : FogType.PERSP_LIN;
    fogBlockSet(fog, type, tevStr.fogStartZ, tevStr.fogEndZ, camera.near, fogFarPlane);
}

export function dKy_GxFog_set(envLight: dScnKy_env_light_c, fog: FogBlock, camera: Camera): void {
    //GxFogSet_Sub(fog, envLight, camera);
}

// This is effectively the global state that dKy_setLight sets up, but since we don't
// have global state, we have to do this here.
export function dKy_setLight__OnModelInstance(envLight: dScnKy_env_light_c, modelInstance: J3DModelInstance, camera: Camera): void {
    const light0 = modelInstance.getGXLightReference(0);
    lightSetFromWorldLight(light0, envLight.lightStatus[0], camera);

    const light1 = modelInstance.getGXLightReference(1);
    lightSetFromWorldLight(light1, envLight.lightStatus[1], camera);
}

export function dKy_setLight__OnMaterialParams(envLight: dScnKy_env_light_c, materialParams: MaterialParams, camera: Camera): void {
    lightSetFromWorldLight(materialParams.u_Lights[0], envLight.lightStatus[0], camera);
    lightSetFromWorldLight(materialParams.u_Lights[1], envLight.lightStatus[1], camera);
}

export function setLightTevColorType(globals: dGlobals, modelInstance: J3DModelInstance, tevStr: dKy_tevstr_c, camera: Camera): void {
    const envLight = globals.g_env_light;

    const light0 = modelInstance.getGXLightReference(0);
    lightSetFromWorldLight(light0, tevStr.lightObj, camera);

    const light1 = modelInstance.getGXLightReference(1);
    lightSetFromWorldLight(light1, envLight.lightStatus[1], camera);

    modelInstance.setColorOverride(ColorKind.C0, tevStr.colorC0);
    modelInstance.setColorOverride(ColorKind.K0, tevStr.colorK0);

    for (let i = 0; i < modelInstance.materialInstances.length; i++)
        GxFogSet_Sub(modelInstance.materialInstances[i].fogBlock, tevStr, camera);
}

function SetBaseLight(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    if (dKy_SunMoon_Light_Check(globals)) {
        if (envLight.curTime > 67.5 && envLight.curTime < 292.5) {
            vec3.copy(envLight.baseLight.pos, envLight.sunPos2);
        } else {
            let calc_pos = vec3.create();
            vec3.add(calc_pos, globals.cameraPosition, envLight.moonPos);
            vec3.copy(envLight.baseLight.pos, calc_pos);
        }
    }

    colorFromRGBA(envLight.baseLight.color, 1.0, 1.0, 1.0, 1.0);
    envLight.baseLight.power = 0.0;
    envLight.baseLight.fluctuation = 0.0;
}

function setSunpos(globals: dGlobals, cameraPos: vec3): void {
    const envLight = globals.g_env_light;
    if (globals.stageName === "F_SP200")
        return;

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

    setSunpos(globals, globals.cameraPosition);
    SetBaseLight(globals);
    setLight(globals, envLight);
    dKy_setLight_nowroom(globals, globals.mStayNo);

    if (globals.stageName === "D_MN08") {
        envLight.housiCount = 200;
    }
}

export function dKy_checkEventNightStop(globals: dGlobals): boolean {
    return globals.g_env_light.eventNightStop;
}

function GetTimePass(globals: dGlobals): boolean {
    return globals.g_env_light.forceTimePass || globals.dStage_dt.rtbl[globals.mStayNo].isTimePass;
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

function dKankyo_DayProc(globals: dGlobals): void {
    // Called once a day.
}

function dKy_getdaytime_hour(globals: dGlobals): number {
    return globals.g_env_light.curTime / 15.0;
}

export function dKy_daynight_check(globals: dGlobals): boolean {
    const hour = dKy_getdaytime_hour(globals);
    return hour < 6 || hour > 19;
}

function setDaytime(globals: dGlobals, envLight: dScnKy_env_light_c, deltaTimeInFrames: number): void {
    let timePass = GetTimePass(globals);

    if (!timePass) {
        // Even if we're in a no time pass zone, advance time until the current

        if (dKy_daynight_check(globals)) {
            if (envLight.curTime >= 270.0 && envLight.curTime < 345.0)
                timePass = true;
        } else {
            if (envLight.curTime < 165.0)
                timePass = true;
        }
    }

    if (dKy_darkworld_check(globals)) {
        envLight.darkTime += envLight.timeSpeed * deltaTimeInFrames;
        if (envLight.darkTime >= 360.0) {
            envLight.darkTime = 0.0;
        }

        envLight.curTime = 0.0;
    }

    if (timePass) {
        if (globals.stageName === "F_SP127" || globals.stageName === "R_SP127") {
            if (envLight.curTime >= 300 || envLight.curTime <= 60) {
                // increase the time multiple times on these stages
                envLight.curTime += envLight.timeSpeed * deltaTimeInFrames;
                envLight.curTime += envLight.timeSpeed * deltaTimeInFrames;
            } else if (envLight.curTime >= 150 && envLight.curTime <= 195) {
                envLight.curTime += envLight.timeSpeed * deltaTimeInFrames;
            }
        }

        envLight.curTime += envLight.timeSpeed * deltaTimeInFrames;
        if (envLight.curTime >= 360.0) {
            envLight.curTime = 0.0;
            envLight.calendarDay += 1;
            dKankyo_DayProc(globals);
        }
    }

    if (envLight.curTime >= 360.0) {
        envLight.curTime = 0.0;
    }
}

function CalcTevColor(globals: dGlobals, envLight: dScnKy_env_light_c, playerPos: vec3): void {
    envLight.playerEflightIdx = dKy_eflight_influence_id(globals, playerPos, 0);
    envLight.playerPlightIdx = dKy_light_influence_id(globals, playerPos, 0);
}

function exeKankyo(globals: dGlobals, envLight: dScnKy_env_light_c, deltaTimeInFrames: number): void {
    const colSetModeGather = envLight.colpatModeGather;

    envLight.colpatMode = envLight.colpatModeGather;

    if (envLight.colpatModeGather !== 0) {
        if (envLight.colpatModeGather >= 3) {
            envLight.colpatModeGather = 0;
        } else {
            envLight.colpatModeGather++;
        }
    }

    if (envLight.colpatMode !== 0) {
        if (envLight.colpatPrevGather !== -1) {
            envLight.colpatPrev = envLight.colpatPrevGather;

            if (envLight.colpatModeGather === 0) {
                envLight.colpatPrevGather = -1;
            }
        }

        if (envLight.colpatCurrGather !== -1) {
            envLight.colpatCurr = envLight.colpatCurrGather;

            if (envLight.colpatModeGather === 0) {
                envLight.colpatCurrGather = -1;
            }
        }

        if (envLight.colpatBlendGather >= 0) {
            envLight.colpatBlend = envLight.colpatBlendGather;

            if (envLight.colpatModeGather === 0) {
                envLight.colpatBlendGather = -1.0;
            }
        }
    } else if (envLight.colpatPrev === envLight.colpatCurr) {
        if (envLight.colpatPrevGather !== -1) {
            envLight.colpatPrev = envLight.colpatPrevGather;
            envLight.colpatPrevGather = -1;
        }

        if (envLight.colpatCurrGather !== -1) {
            envLight.colpatCurr = envLight.colpatCurrGather;
            envLight.colpatCurrGather = -1;
            envLight.colpatWeather = envLight.colpatCurrGather;
        }

        if (envLight.colpatBlendGather >= 0.0) {
            envLight.colpatBlend = envLight.colpatBlendGather;
            envLight.colpatBlendGather = -1.0;
        }
    }

    envLight.unk_1210 = envLight.unk_122c;

    cLib_addCalc(envLight.ColAllColRatio, envLight.allColRatio, 0.5, 0.25, 0.01);
    cLib_addCalc(envLight.ColActColRatio, envLight.actColRatio, 0.5, 0.25, 0.01);
    cLib_addCalc(envLight.ColBgColRatio, envLight.bgColRatio * envLight.unk_1210, 0.5, 0.25, 0.01);
    cLib_addCalc(envLight.ColFogColRatio, envLight.fogColRatio * envLight.unk_1210, 0.5, 0.25, 0.01);
    cLib_addCalc(envLight.ColVrSoraColRatio, envLight.vrSoraColRatio * envLight.unk_1210, 0.5, 0.25, 0.01);
    cLib_addCalc(envLight.ColVrKumoColRatio, envLight.vrKumoColRatio * envLight.unk_1210, 0.5, 0.25, 0.01);

    envLight.allColRatio = 1.0;
    envLight.actColRatio = 1.0;
    envLight.bgColRatio = 1.0;
    envLight.fogColRatio = 1.0;
    envLight.vrSoraColRatio = 1.0;
    envLight.vrKumoColRatio = 1.0;
    envLight.unk_122c = 1.0;

    setDaytime(globals, envLight, deltaTimeInFrames);
    // dKyw_wether_proc();
    CalcTevColor(globals, envLight, globals.playerPosition);
}

export function dKy_setLight(globals: dGlobals): void {
    const envLight = globals.g_env_light;

}

export class dKydata_lightsizeInfo_c {
    public stageName: string;
    public size: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        this.stageName = readString(buffer, 0x0, 8);
        this.size = view.getUint8(0x4);
        return 0x8;
    }
}

function dKyd_light_size_tbl_getp(globals: dGlobals): dKydata_lightsizeInfo_c[] {
    const buffer = globals.findExtraSymbolData(`d_kankyo_data.o`, `l_light_size_tbl`);
    const info: dKydata_lightsizeInfo_c[] = [];

    let offs = 0x00;
    for (let i = 0; i < 36; i++) {
        const entry = new dKydata_lightsizeInfo_c();
        offs += entry.parse(buffer.slice(offs));
        info.push(entry);
    }

    return info;
}

function dKyd_light_tw_size_tbl_getp(globals: dGlobals): dKydata_lightsizeInfo_c[] {
    const buffer = globals.findExtraSymbolData(`d_kankyo_data.o`, `l_light_size_tbl`);
    const info: dKydata_lightsizeInfo_c[] = [];

    let offs = 0x00;
    for (let i = 0; i < 9; i++) {
        const entry = new dKydata_lightsizeInfo_c();
        offs += entry.parse(buffer.slice(offs));
        info.push(entry);
    }

    return info;
}

function dKy_light_size_get(stageName: string, globals: dGlobals): void {
    const lightTbl = dKyd_light_size_tbl_getp(globals);
    const lightTwTbl = dKyd_light_tw_size_tbl_getp(globals);

    if (!dKy_darkworld_check(globals)) {
        for (let i = 0; i < 36; i++) {
            if (stageName === lightTbl[i].stageName) {
                globals.g_env_light.lightSize = lightTbl[i].size;
                return;
            }
        }
    } else {
        for (let i = 0; i < 9; i++) {
            if (stageName === lightTwTbl[i].stageName) {
                globals.g_env_light.lightSize = lightTwTbl[i].size;
                return;
            }
        }
    }
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
    const buffer = globals.findExtraSymbolData(`d_kankyo_data.o`, `l_envr_default`);
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
    for (let i = 0; i < 18; i++) {
        const entry = new stage_vrbox_info_class();
        offs += entry.parse(buffer.slice(offs));
        envr.push(entry);
    }

    return envr;
}

export function dKy_setLight_init(): void {
}

export function dKy_Sound_init(envLight: dScnKy_env_light_c): void {
    vec3.set(envLight.sndInfluence.pos, 999999.875, 999999.875, 999999.875);
}

export function dungeonlight_init(envLight: dScnKy_env_light_c): void {
    for (let i = 0; i < 8; i++) {
        // original uses test_pos_tbl but all values are identical and readonly
        vec3.set(envLight.dungeonLight[i].pos, 0, -99999, 0);
        envLight.dungeonLight[i].refDist = 1.0;
        envLight.dungeonLight[i].color.r = 0;
        envLight.dungeonLight[i].color.g = 0;
        envLight.dungeonLight[i].color.b = 0;
        envLight.dungeonLight[i].color.a = 1.0;

        vec3.copy(envLight.dungeonLight[i].influence.pos, envLight.dungeonLight[i].pos);
        envLight.dungeonLight[i].influence.color = envLight.dungeonLight[i].color;
        envLight.dungeonLight[i].influence.power = envLight.dungeonLight[i].refDist * 100;
        envLight.dungeonLight[i].influence.fluctuation = 0;
    }
}

export function undwater_init(globals: dGlobals, envLight: dScnKy_env_light_c): void {
    const resCtrl = globals.resCtrl;

    const screen_ef_mdl = resCtrl.getObjectRes(ResType.Model, `Always`, 0x1D);
    if (screen_ef_mdl === null)
        return;
    const modelInstance = new J3DModelInstance(screen_ef_mdl);
    envLight.underwater_screen_ef = modelInstance;

    const screen_ef_btk = resCtrl.getObjectRes(ResType.Btk, `Always`, 0x3C);
    if (screen_ef_btk === null)
        return;
    envLight.underwater_screen_ef_btk.init(screen_ef_mdl, screen_ef_btk, true, LoopMode.REPEAT);
}

export function dKy_undwater_filter_draw(globals: dGlobals, envLight: dScnKy_env_light_c, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    if (envLight.cameraInWater) {
        if (envLight.underwater_screen_ef !== null) {
            envLight.underwater_screen_ef.baseScale = [0.00524, 0.00524, 0.00524];
            
            if (envLight.underwater_screen_ef_btk !== null) {
                envLight.underwater_screen_ef_btk.entry(envLight.underwater_screen_ef);
                mDoExt_modelUpdateDL(globals, envLight.underwater_screen_ef, renderInstManager, viewerInput, globals.dlst.ui);
            }
        }
    }
}

export function bgparts_activelight_init(envLight: dScnKy_env_light_c): void {
    envLight.BGpartsActiveLight[0].index = 0;
}

export function darkmist_init(envLight: dScnKy_env_light_c): void {
    envLight.darkmist.length = 0;
}

export function plight_init(envLight: dScnKy_env_light_c): void {
    envLight.lightInfluence[0].power = 99999.9;
    //envLight.plights.length = 0;
    //envLight.eflights.length = 0;

    envLight.playerPlightIdx = -1;
    envLight.playerEflightIdx = -1;
}

export function plight_set(globals: dGlobals, envLight: dScnKy_env_light_c): void {
    if (globals.dStage_dt.lght.length === 0)
        return;

    for (let i = 0; i < globals.dStage_dt.lght.length; i++) {
        const lgt = globals.dStage_dt.lght[i];
        if (i < 30) {
            vec3.copy(envLight.lightInfluence[i].pos, lgt.pos);
            colorCopy(envLight.lightInfluence[i].color, lgt.color);
            envLight.lightInfluence[i].power = lgt.radius;
            envLight.lightInfluence[i].fluctuation = lgt.fluctuation;

            dKy_plight_set(envLight, envLight.lightInfluence[i]);
        }
    }
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

    dKy_actor_addcol_set(envLight, 0, 0, 0, 0);
    dKy_fog_startendz_set(envLight, 0.0, 0.0, 0.0);
    dKy_vrbox_addcol_set(envLight, 0, 0, 0, 0.0);

    //envLight.vrboxInvisible = true;
    envLight.cameraInWater = false;
    envLight.actorLightEffect = 100;
    envLight.paletteTerrainLightEffect = 1.0;

    dKy_light_size_get(globals.stageName, globals);

    const schejuleName = `l_time_attribute`;
    envLight.schejule = new dScnKy__Schedule(globals.findExtraSymbolData(`d_kankyo_data.o`, schejuleName));

    envLight.colpatWeather = 0;

    if (globals.stageName === "F_SP127" || globals.stageName === "R_SP127") {
        if (envLight.unk_12cc >= 7) {
            envLight.colpatWeather = 2;
        } else if (envLight.unk_12cc !== 0) {
            envLight.colpatWeather = 1;
        }
    } else if (globals.stageName === "D_MN07A") {
        if (envLight.unk_12cc === 1) {
            envLight.colpatWeather = 1;
        } else if (envLight.unk_12cc === 2) {
            envLight.colpatWeather = 2;
        }
    } else {
        envLight.unk_12cc = 0;
    }

    envLight.colpatPrev = envLight.colpatWeather;
    envLight.colpatCurr = envLight.colpatWeather;

    plight_init(envLight);
    plight_set(globals, envLight);
    darkmist_init(envLight);
    bgparts_activelight_init(envLight);

    undwater_init(globals, envLight);

    // For funsies, set the time/date to something fun :)
    const today = new Date();
    envLight.calendarDay = today.getDay();
    envLight.curTime = 15 * today.getHours();

    envLight.timeSpeed = 0.012;

    colorFromRGBA(envLight.lightStatus[0].Color, 1.0, 0.0, 0.0, 0.0);
    colorFromRGBA(envLight.lightStatus[1].Color, 0.0, 0.0, 0.0, 0.0);

    envLight.diceWeatherChangeTime = (envLight.curTime + 15.0) % 360.0;
}

function colorSetRatio(color: Color, ratio: number, r: number, g: number, b: number): void {
    color.r = r * ratio * 1/255;
    color.g = g * ratio * 1/255;
    color.b = b * ratio * 1/255;
}

export function dKy_fog_startendz_set(envLight: dScnKy_env_light_c, param_0: number, param_1: number, ratio: number): void {
    if (ratio < 0 || ratio > 1) {
        ratio = 0;
    }

    if (ratio < 0.0001) {
        ratio = 0;
    }

    envLight.unk_11ec = param_0;
    envLight.unk_11f0 = param_1;
    envLight.unk_11f4 = ratio;
}

export function dKy_actor_addcol_set(envLight: dScnKy_env_light_c, r: number, g: number, b: number, ratio: number): void {
    dKy_actor_addcol_amb_set(envLight, r, g, b, ratio);
    dKy_bg_addcol_amb_set(envLight, r, g, b, ratio);
    dKy_bg1_addcol_amb_set(envLight, r, g, b, ratio);
    dKy_bg2_addcol_amb_set(envLight, r, g, b, ratio);
    dKy_bg3_addcol_amb_set(envLight, r, g, b, ratio);
}

export function dKy_vrbox_addcol_set(envLight: dScnKy_env_light_c, r: number, g: number, b: number, ratio: number): void {
    dKy_vrbox_addcol_sky0_set(envLight, r, g, b, ratio);
    dKy_vrbox_addcol_kasumi_set(envLight, r, g, b, ratio);
    dKy_addcol_fog_set(envLight, r, g, b, ratio);
}

export function dKy_actor_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.actorAddAmb, ratio, r, g, b);
}

export function dKy_bg_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAddAmb[0], ratio, r, g, b);
}

export function dKy_bg1_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAddAmb[1], ratio, r, g, b);
}

export function dKy_bg2_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAddAmb[2], ratio, r, g, b);
}

export function dKy_bg3_addcol_amb_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.bgAddAmb[3], ratio, r, g, b);
}

export function dKy_vrbox_addcol_sky0_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.vrboxAddcolSky0, ratio, r, g, b);
}

export function dKy_vrbox_addcol_kasumi_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.vrboxAddcolKasumi, ratio, r, g, b);
}

export function dKy_addcol_fog_set(envLight: dScnKy_env_light_c, ratio: number, r: number, g: number, b: number): void {
    colorSetRatio(envLight.fogAddCol, ratio, r, g, b);
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
    envLight.colpatCurrGather = idx;
    if (envLight.colpatCurr !== idx)
        envLight.colpatBlendGather = 0.0;
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

export function dKy_SunMoon_Light_Check(globals: dGlobals): boolean {
    if (globals.g_env_light.sunPacket !== null && dKy_darkworld_check(globals)) {
        if (globals.stageName !== "D_MN07" && globals.stageName !== "D_MN09" && globals.stageName !== "F_SP200") {
            return true;
        }
    }

    return false;
}

export function dKy_Indoor_check(globals: dGlobals): boolean {
    if (dStage_stagInfo_GetSTType(globals.dStage_dt.stag) != 0) {
        return true;
    }

    return false;
}

export function dKy_bgparts_activelight_set(envLight: dScnKy_env_light_c, index: number): void {
    if (envLight.eflights[index] !== null) {
        envLight.BGpartsActiveLight[index] = envLight.eflights[index];
        envLight.BGpartsActiveLight[index].index = index + 1;
    }
}

export function dKy_bgparts_activelight_cut(envLight: dScnKy_env_light_c, index: number): void {
    envLight.BGpartsActiveLight[index].index = 0;
}

let lightMask: number = 0;
export function dKy_setLight_nowroom_common(globals: dGlobals, roomNo: number, param_2: number): void {
    const envLight = globals.g_env_light;
    lightMask = 0;
    
    let lightvec_num = globals.roomStatus[roomNo].lgtv.length;
    if (lightvec_num > 6) {
        lightvec_num = 6;
    }

    if (lightvec_num > 0) {
        for (let i = 0; i < lightvec_num; i++) {
            if (globals.roomStatus[roomNo].lgtv[i] !== null) {
                lightMask |= (1 << i + 2);
            }
        }
    }

    if (dKy_SunMoon_Light_Check(globals) && lightvec_num === 0) {
        lightMask |= (1 << 2) | (1 << 3);
    }

    if (envLight.BGpartsActiveLight[0].index !== 0) {
        lightMask |= 1;
    }

    if (envLight.BGpartsActiveLight[1].index !== 0) {
        lightMask |= 2;
    }

    let eflight_idx = dKy_eflight_influence_id(globals, globals.cameraPosition, 0);
    if (eflight_idx >= 0) {
        dKy_bgparts_activelight_set(envLight, 1);

        if (dKy_Indoor_check(globals)) {
            vec3.copy(envLight.unk_10a0, envLight.eflights[eflight_idx].pos);
        }
    } else {
        dKy_bgparts_activelight_cut(envLight, 1);
    }

    for (let i = 0; i < 2; i++) {
        if (envLight.BGpartsActiveLight[i].index !== 0 && envLight.BGpartsActiveLight[i].power !== 0.0 && i !== 1) {
            vec3.copy(envLight.lightStatus[i].Position, envLight.BGpartsActiveLight[i].pos);
            envLight.lightStatus[i].Color.r = envLight.BGpartsActiveLight[i].color.r;
            envLight.lightStatus[i].Color.g = envLight.BGpartsActiveLight[i].color.g;
            envLight.lightStatus[i].Color.b = envLight.BGpartsActiveLight[i].color.b;
        } else {
            envLight.lightStatus[i].Color.r = 0;
            envLight.lightStatus[i].Color.g = 0;
            envLight.lightStatus[i].Color.b = 0;
        }
    }
}

export function dKy_setLight_nowroom(globals: dGlobals, roomNo: number): void {
    dKy_setLight_nowroom_common(globals, roomNo, 1.0);
}

export function dKy_get_dayofweek(envLight: dScnKy_env_light_c): number {
    return envLight.calendarDay % 7;
}

export function dKy_darkworld_check(globals: dGlobals): boolean {
    if (globals.world_dark) {
        return true;
    }

    return false;
}

class d_kankyo extends kankyo_class {
    public static PROCESS_NAME = fpc__ProcessName.d_kankyo;

    // dKy_Create
    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        envcolor_init(globals);
        vec3.set(envLight.plightNearPos, 0, 0, 0);

        dKy_setLight_init();
        dKy_Sound_init(envLight);
        // dKyw_wind_set(globals);
        dungeonlight_init(envLight);
        dKy_setLight_nowroom(globals, globals.mStayNo);

        envLight.nextTime = -1.0;
        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        // temporary until some better setup for handling twilight layers is done
        if (globals.stageName === "D_MN08" || globals.stageName === "D_MN08A" || globals.stageName === "D_MN08B" || globals.stageName === "D_MN08C" || globals.stageName === "D_MN08D") {
            globals.world_dark = true;
        } else {
            globals.world_dark = false;
        }

        exeKankyo(globals, globals.g_env_light, deltaTimeInFrames);
        // dKyw_wind_set(globals);
        drawKankyo(globals);
        globals.g_env_light.underwater_screen_ef_btk.play(deltaTimeInFrames);
    }

    public override draw(globals: dGlobals): void {
        // Moved to execute to fix a few ordering bugs... :/
        // drawKankyo(globals);
    }
}

class d_kyeff extends kankyo_class {
    public static PROCESS_NAME = fpc__ProcessName.d_kyeff;

    public override subload(globals: dGlobals): cPhs__Status {
        const envLight = globals.g_env_light;

        dKyw_wether_init(globals);
        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        dKyw_wether_move(globals, deltaTimeInFrames);
        dKyw_wether_move_draw(globals, deltaTimeInFrames);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        dKyw_wether_draw(globals, renderInstManager, viewerInput);
    }

    public override delete(globals: dGlobals): void {
        dKyw_wether_delete(globals);
    }
}

class d_kyeff2 extends kankyo_class {
    public static PROCESS_NAME = fpc__ProcessName.d_kyeff2;

    public override subload(globals: dGlobals): cPhs__Status {
        dKyw_wether_init2(globals);
        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        dKyw_wether_move_draw2(globals, deltaTimeInFrames);
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        dKyw_wether_draw2(globals, renderInstManager, viewerInput);
    }

    public override delete(globals: dGlobals): void {
        dKyw_wether_delete2(globals);
    }
}

export function dKankyo_create(globals: dGlobals): void {
    fopKyM_Create(globals.frameworkGlobals, fpc__ProcessName.d_kankyo, null);
    fopKyM_Create(globals.frameworkGlobals, fpc__ProcessName.d_kyeff, null);
    fopKyM_Create(globals.frameworkGlobals, fpc__ProcessName.d_kyeff2, null);
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
    R(d_kyeff2);
}
