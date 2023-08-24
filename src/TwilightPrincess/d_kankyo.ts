
import { Color, colorNewCopy, White, colorFromRGBA, TransparentBlack, OpaqueBlack, colorCopy, colorNewFromRGBA, colorNewFromRGBA8 } from "../Color.js";
import { Light, lightSetFromWorldLight, fogBlockSet, FogBlock, lightSetSpot, lightSetDistAttn, lightSetWorldDirection } from "../gx/gx_material.js";
import { ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { stage_palet_info_class, stage_pselect_info_class, stage_envr_info_class, stage_vrbox_info_class, dStage_stagInfo_GetSTType } from "./d_stage.js";
import { lerp, invlerp, clamp, MathConstants, Vec3UnitY, texEnvMtx, projectionMatrixForFrustum, Vec3Zero, computeUnitSphericalCoordinates, saturate } from "../MathHelpers.js";
import { nArray, assert, arrayRemove, assertExists, readString } from "../util.js";
import { J3DModelInstance, MaterialData, MaterialInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { Camera } from "../Camera.js";
import { ColorKind, MaterialParams } from "../gx/gx_render.js";
import { dGlobals } from "./ztp_scenes.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { dKyw_wether_init, dKyw_wether_init2, dKyw_wether_delete2, dKyw_rain_set, ThunderState, ThunderMode, dKyw_wether_move, dKyw_wether_move_draw, dKankyo_sun_Packet, dKyw_wether_draw, dKankyo_vrkumo_Packet, dKyw_wether_move_draw2, dKyw_wether_draw2, dKankyo_rain_Packet, dKankyo_housi_Packet, dKankyo_star_Packet, dKyw_wether_delete, dKyw_wind_set } from "./d_kankyo_wether.js";
import { cLib_addCalc, cM_rndF } from "../WindWaker/SComponent.js";
import { fpc__ProcessName, fopKyM_Create, fpc_bs__Constructor, fGlobals, fpcPf__Register, kankyo_class, cPhs__Status } from "./framework.js";
import { ViewerRenderInput } from "../viewer.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import * as GX from "../gx/gx_enum.js";
import { mDoExt_modelUpdateDL, mDoExt_btkAnm } from "./m_do_ext.js";
import { ResType } from "./d_resorce.js";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader.js";

export const enum LightType {
    UNK_0 = 0,
    UNK_1 = 1,
    UNK_2 = 2,
    UNK_3 = 3,
    UNK_4 = 4,
    UNK_5 = 5,
    UNK_6 = 6,
    UNK_7 = 7,
    UNK_8 = 8,
    UNK_9 = 9,
    UNK_10 = 10,
    UNK_11 = 11,
    UNK_12 = 12,
    UNK_13 = 13,
    UNK_14 = 14,
    UNK_15 = 15,
    UNK_16 = 16,
    UNK_20 = 20,
    BG0 = 32,
    BG1 = 33,
    BG2 = 34,
    BG3 = 35,
    BG4 = 35,
    BG5 = 32,
    UNK_64 = 64,
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
    public bloomInfTbl: dkydata_bloomInfo;

    // Lighting
    public baseLight = new LIGHT_INFLUENCE();
    public lightInfluence = nArray(30, () => new LIGHT_INFLUENCE());
    public plights: LIGHT_INFLUENCE[] = [];
    public eflights: LIGHT_INFLUENCE[] = [];
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
    public windVec = vec3.fromValues(0.0, 0.0, 0.0);
    public windPower = 0.0;
    public customWindPower = 0.0;

    // Rain.
    public rainCount: number = 0;
    public rainCountOrig: number = 0;

    // Snow
    public snowCount: number = 0;

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

    public plightNearPos = vec3.create();
    public sunPos = vec3.create();
    public sunPosLocal = vec3.create();
    public moonPos = vec3.create();
    public unk_10a0 = vec3.create();

    // Color palette
    public vrSkyCol = colorNewCopy(White);
    public vrKumoCol = colorNewCopy(White);
    public vrShitaGumoCol = colorNewCopy(TransparentBlack); // mUnderCloudColor
    public vrShimoUneiCol = colorNewCopy(TransparentBlack); // mUnderCloudShadowColor
    public vrOkuKasumiCol = colorNewCopy(TransparentBlack); // mCloudInnerHazeColor
    public vrKumoCenterCol = colorNewCopy(White);
    public vrKasumiCol = colorNewCopy(White);

    public actorAmbCol = colorNewCopy(TransparentBlack);
    public bgAmbCol = nArray(4, () => colorNewCopy(TransparentBlack));
    public dungeonLightCol = nArray(6, () => colorNewCopy(TransparentBlack));
    public fogCol = colorNewCopy(White);

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

    public fogStartZ: number;
    public fogEndZ: number;

    public fogStartZGlobal: number = 0.0;
    public fogEndZGlobal: number = 0.0;
    public fogRatio: number = 0.0;

    public unk_11c8: number = 1.0;
    public unk_11cc: number = 1.0;
    public unk_11d0: number = 1.0;

    public unk_11ec: number = 0;
    public unk_11f0: number = 0;
    public unk_11f4: number = 0;

    public allColRatio: number = 1.0;
    public actAmbColRatio: number = 1.0;
    public bgAmbColRatio: number = 1.0;
    public fogColRatio: number = 1.0;
    public vrSoraColRatio: number = 1.0;
    public vrKumoColRatio: number = 1.0;
    public unk_1210: number = 1.0;

    public allColRatioGather: number = 1.0;
    public actAmbColRatioGather: number = 1.0;
    public bgAmbColRatioGather: number = 1.0;
    public fogColRatioGather: number = 1.0;
    public vrSoraColRatioGather: number = 1.0;
    public vrKumoColRatioGather: number = 1.0;
    public unk_122c: number = 1.0;

    // Time
    public curTime: number = 0.0;
    public nextTime: number = 0.0;
    public timeSpeed: number = 0.012;
    public darkTime: number = 0.0;
    public calendarDay: number = 0.0;

    public actorLightEffect: number = 100;
    public terrainLightInfluence: number = 1.0;
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
    public cloudShadowDensity: number;

    public pondSeason: number = 0;

    public lightSize: number = 1;

    public lightMaskType: number = 0;

    // The game records this in a separate struct with a bunch of extra data, but we don't need it lol.
    public lightStatus = nArray(8, () => new Light());
}

export class LIGHT_INFLUENCE {
    public pos = vec3.create();
    public color = colorNewCopy(TransparentBlack);
    public power: number = 0;
    public fluctuation: number = 0;
    public index: number = 0;

    public copy(o: LIGHT_INFLUENCE): void {
        vec3.copy(this.pos, o.pos);
        colorCopy(this.color, o.color);
        this.power = o.power;
        this.fluctuation = o.fluctuation;
        this.index = o.index;
    }
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
    public baseLight = new Light();
    public lights = nArray(6, () => new Light());

    public colorC0: Color = colorNewCopy(OpaqueBlack);
    public colorK0: Color = colorNewCopy(OpaqueBlack);
    public ambCol: Color = colorNewCopy(White);
    public fogCol: Color = colorNewCopy(White);
    public fogStartZ: number = 0;
    public fogEndZ: number = 0;
    public colpatBlend: number = 0.0;

    public unk_364: number = 0;

    public lightInfluence: number = 1.0;
    public unk_378: number = 0;
    public lightType: LightType;
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
    UNK_MODE_6 = 6,
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
            const palIdxA = view.getUint8(offs + 0x08);
            const palIdxB = view.getUint8(offs + 0x09);
            this.entries.push({ timeBegin, timeEnd, palIdxA, palIdxB });
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

export function dKy_plight_priority_set(envLight: dScnKy_env_light_c, lightInfluence: LIGHT_INFLUENCE): void {
    console.log(`dKy_plight_priority_set: checking`, envLight.plights);
    for (let i = 0; i < 50; i++) {
        if (envLight.plights[i] !== null) {
            console.log(`dKy_plight_priority_set: plight set`, i);
            envLight.plights[i] = lightInfluence;
            envLight.plights[i].index = -(i + 1);
            break;
        }
    }
}

function dKy_light_influence_id(globals: dGlobals, pos: ReadonlyVec3, which: number): number {
    let envLight = globals.g_env_light;

    let bestDistance = 1000000;
    let bestIdx1 = -1;
    let bestIdx2 = -1;
    let var_r25 = -1;

    let compDist = 800;
    if (globals.stageName === "D_MN09") {
        compDist = 250;
    }

    for (let i = 0; i <= which; i++) {
        for (let j = 0; j < envLight.plights.length; j++) {
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
    if (which === 0) {
        ret = bestIdx1;
    }

    return ret;
}

function dKy_eflight_influence_id(globals: dGlobals, pos: ReadonlyVec3, which: number): number {
    let envLight = globals.g_env_light;

    let bestDistance = 1000000;
    let bestIdx1 = -1;
    let bestIdx2 = -1;

    for (let i = 0; i <= which; i++) {
        for (let j = 0; j < envLight.eflights.length; j++) {
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
    if (which === 0) {
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

    if (prevPselIdx > envLight.colo.length) {
        console.log(`setLight_palno_get: prevPselIdx (${prevPselIdx}) out of bounds! Colo entry num: ${envLight.colo.length}`);
        prevPselIdx = 0;
    }

    if (currPselIdx > envLight.colo.length) {
        console.log(`setLight_palno_get: currPselIdx (${currPselIdx}) out of bounds! Colo entry num: ${envLight.colo.length}`);
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

interface dkydata_bloomInfo_info_class {
    mode: number;
    point: number;
    blureSize: number;
    blureRatio: number;
    blendColor: Color;
    monoColor: Color;
}

class dkydata_bloomInfo {
    public entries: dkydata_bloomInfo_info_class[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();
        let offs = 0x00;
        for (let i = 0; i < 64; i++) {
            const mode = view.getUint8(offs + 0x00);
            const point = view.getUint8(offs + 0x01) / 255;
            const blureSize = view.getUint8(offs + 0x02);
            const blureRatio = view.getUint8(offs + 0x03) / 255;
            const blendColor = colorNewFromRGBA8(view.getUint32(offs + 0x04));
            const monoColor = colorNewFromRGBA8(view.getUint32(offs + 0x08));
            this.entries.push({ mode, point, blureSize, blureRatio, blendColor, monoColor });
            offs += 0x0C;
        }
    }
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
    return (lerp(v0, v1, blend01) + add) * envLight.allColRatio * ratio;
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
        envLight.actorAmbCol.r = 1;
        envLight.actorAmbCol.g = 0;
        envLight.actorAmbCol.b = 0;
    } else {
        dKy_calc_color_set(envLight, envLight.actorAmbCol, ret.palePrevA.actorAmbCol, ret.palePrevB.actorAmbCol, ret.paleCurrA.actorAmbCol, ret.paleCurrB.actorAmbCol, ret.blendPaleAB, envLight.colpatBlend, null, envLight.unk_1210 * envLight.actAmbColRatio * envLight.actAmbColRatio);

        for (let whichBG = 0; whichBG < 4; whichBG++) {
            if (whichBG !== 3 || (globals.stageName !== "F_SP127" && globals.stageName !== "R_SP127")) {
                dKy_calc_color_set(envLight, envLight.bgAmbCol[whichBG], ret.palePrevA.bgAmbCol[whichBG], ret.palePrevB.bgAmbCol[whichBG], ret.paleCurrA.bgAmbCol[whichBG], ret.paleCurrB.bgAmbCol[whichBG], ret.blendPaleAB, envLight.colpatBlend, null, envLight.bgAmbColRatio);
            }
        }

        envLight.bgAmbCol[1].a = saturate(kankyo_color_ratio_set(envLight, ret.palePrevA.bgAmbColor1A, ret.palePrevB.bgAmbColor1A, ret.blendPaleAB, ret.paleCurrA.bgAmbColor1A, ret.paleCurrB.bgAmbColor1A, envLight.colpatBlend, 0, 1));
        envLight.bgAmbCol[2].a = saturate(kankyo_color_ratio_set(envLight, ret.palePrevA.bgAmbColor2A, ret.palePrevB.bgAmbColor2A, ret.blendPaleAB, ret.paleCurrA.bgAmbColor2A, ret.paleCurrB.bgAmbColor2A, envLight.colpatBlend, 0, 1));
        envLight.bgAmbCol[3].a = saturate(kankyo_color_ratio_set(envLight, ret.palePrevA.bgAmbColor3A, ret.palePrevB.bgAmbColor3A, ret.blendPaleAB, ret.paleCurrA.bgAmbColor3A, ret.paleCurrB.bgAmbColor3A, envLight.colpatBlend, 0, 1));

        envLight.terrainLightInfluence = saturate(kankyo_color_ratio_set(envLight, ret.palePrevA.terrainLightInfluence, ret.palePrevB.terrainLightInfluence, ret.blendPaleAB, ret.paleCurrA.terrainLightInfluence, ret.paleCurrB.terrainLightInfluence, envLight.colpatBlend, 0, 1));
        if (envLight.terrainLightInfluence > 2.0)
            envLight.terrainLightInfluence = 1.0;

        envLight.cloudShadowDensity = saturate(kankyo_color_ratio_set(envLight, ret.palePrevA.cloudShadowDensity, ret.palePrevB.cloudShadowDensity, ret.blendPaleAB, ret.paleCurrA.cloudShadowDensity, ret.paleCurrB.cloudShadowDensity, envLight.colpatBlend, 0, 1));

        for (let i = 0; i < 6; i++) {
            dKy_calc_color_set(envLight, envLight.dungeonLightCol[i], ret.palePrevA.lightCol[i], ret.palePrevB.lightCol[i], ret.paleCurrA.lightCol[i], ret.paleCurrB.lightCol[i], ret.blendPaleAB, envLight.colpatBlend, null, envLight.bgAmbColRatio);
            envLight.dungeonLight[i].color = envLight.dungeonLightCol[i];
        }

        dKy_calc_color_set(envLight, envLight.fogCol, ret.palePrevA.fogCol, ret.palePrevB.fogCol, ret.paleCurrA.fogCol, ret.paleCurrB.fogCol, ret.blendPaleAB, envLight.colpatBlend, envLight.fogAddCol, envLight.fogColRatio);
        envLight.fogStartZ = float_kankyo_color_ratio_set(ret.palePrevA.fogStartZ, ret.palePrevB.fogStartZ, ret.blendPaleAB, ret.paleCurrA.fogStartZ, ret.paleCurrB.fogStartZ, envLight.colpatBlend, envLight.unk_11ec, envLight.unk_11f4);
        envLight.fogEndZ = Math.max(envLight.fogStartZ, float_kankyo_color_ratio_set(ret.palePrevA.fogEndZ, ret.palePrevB.fogEndZ, ret.blendPaleAB, ret.paleCurrA.fogEndZ, ret.paleCurrB.fogEndZ, envLight.colpatBlend, envLight.unk_11ec, envLight.unk_11f4));

        if (!globals.bloom.freeze) {
            const bloomInf0A = envLight.bloomInfTbl.entries[ret.palePrevA.bloomTblIdx];
            const bloomInf0B = envLight.bloomInfTbl.entries[ret.palePrevB.bloomTblIdx];
            const bloomInf1A = envLight.bloomInfTbl.entries[ret.paleCurrA.bloomTblIdx];
            const bloomInf1B = envLight.bloomInfTbl.entries[ret.paleCurrB.bloomTblIdx];
            globals.bloom.point = kankyo_color_ratio_set(envLight, bloomInf0A.point, bloomInf0B.point, ret.blendPaleAB, bloomInf1A.point, bloomInf1B.point, envLight.colpatBlend, 0, 1.0);
            globals.bloom.blurSize = kankyo_color_ratio_set(envLight, bloomInf0A.blureSize, bloomInf0B.blureSize, ret.blendPaleAB, bloomInf1A.blureSize, bloomInf1B.blureSize, envLight.colpatBlend, 0, 1.0);
            globals.bloom.blurRatio = kankyo_color_ratio_set(envLight, bloomInf0A.blureRatio, bloomInf0B.blureRatio, ret.blendPaleAB, bloomInf1A.blureRatio, bloomInf1B.blureRatio, envLight.colpatBlend, 0, 1.0);
            globals.bloom.monoColor.r = kankyo_color_ratio_set(envLight, bloomInf0A.monoColor.r, bloomInf0B.monoColor.r, ret.blendPaleAB, bloomInf1A.monoColor.r, bloomInf1B.monoColor.r, envLight.colpatBlend, 0, 1.0);
            globals.bloom.monoColor.g = kankyo_color_ratio_set(envLight, bloomInf0A.monoColor.g, bloomInf0B.monoColor.g, ret.blendPaleAB, bloomInf1A.monoColor.g, bloomInf1B.monoColor.g, envLight.colpatBlend, 0, 1.0);
            globals.bloom.monoColor.b = kankyo_color_ratio_set(envLight, bloomInf0A.monoColor.b, bloomInf0B.monoColor.b, ret.blendPaleAB, bloomInf1A.monoColor.b, bloomInf1B.monoColor.b, envLight.colpatBlend, 0, 1.0);
            globals.bloom.monoColor.a = kankyo_color_ratio_set(envLight, bloomInf0A.monoColor.a, bloomInf0B.monoColor.a, ret.blendPaleAB, bloomInf1A.monoColor.a, bloomInf1B.monoColor.a, envLight.colpatBlend, 0, 1.0);
            globals.bloom.blendColor.r = kankyo_color_ratio_set(envLight, bloomInf0A.blendColor.r, bloomInf0B.blendColor.r, ret.blendPaleAB, bloomInf1A.blendColor.r, bloomInf1B.blendColor.r, envLight.colpatBlend, 0, 1.0);
            globals.bloom.blendColor.g = kankyo_color_ratio_set(envLight, bloomInf0A.blendColor.g, bloomInf0B.blendColor.g, ret.blendPaleAB, bloomInf1A.blendColor.g, bloomInf1B.blendColor.g, envLight.colpatBlend, 0, 1.0);
            globals.bloom.blendColor.b = kankyo_color_ratio_set(envLight, bloomInf0A.blendColor.b, bloomInf0B.blendColor.b, ret.blendPaleAB, bloomInf1A.blendColor.b, bloomInf1B.blendColor.b, envLight.colpatBlend, 0, 1.0);
            globals.bloom.blendColor.a = kankyo_color_ratio_set(envLight, bloomInf0A.blendColor.a, bloomInf0B.blendColor.a, ret.blendPaleAB, bloomInf1A.blendColor.a, bloomInf1B.blendColor.a, envLight.colpatBlend, 0, 1.0);
            globals.bloom.enable = globals.bloom.point > 0.0;
            globals.bloom.mode = Math.max(bloomInf0A.mode, bloomInf0B.mode, bloomInf1A.mode, bloomInf1B.mode);
        }

        const virt0A = envLight.virt[ret.palePrevA.virtIdx] || envLight.virt[0];
        const virt0B = envLight.virt[ret.palePrevB.virtIdx] || envLight.virt[0];
        const virt1A = envLight.virt[ret.paleCurrA.virtIdx] || envLight.virt[0];
        const virt1B = envLight.virt[ret.paleCurrB.virtIdx] || envLight.virt[0];

        envLight.vrSkyCol.r = saturate(kankyo_color_ratio_set(envLight, virt0A.skyCol.r, virt0B.skyCol.r, ret.blendPaleAB, virt1A.skyCol.r, virt1B.skyCol.r, envLight.colpatBlend, envLight.vrboxAddcolSky0.r, envLight.vrSoraColRatio * envLight.unk_11c8));
        envLight.vrSkyCol.g = saturate(kankyo_color_ratio_set(envLight, virt0A.skyCol.g, virt0B.skyCol.g, ret.blendPaleAB, virt1A.skyCol.g, virt1B.skyCol.g, envLight.colpatBlend, envLight.vrboxAddcolSky0.g, envLight.vrSoraColRatio * envLight.unk_11cc));
        envLight.vrSkyCol.b = saturate(kankyo_color_ratio_set(envLight, virt0A.skyCol.b, virt0B.skyCol.b, ret.blendPaleAB, virt1A.skyCol.b, virt1B.skyCol.b, envLight.colpatBlend, envLight.vrboxAddcolSky0.b, envLight.vrSoraColRatio * envLight.unk_11d0));
        envLight.vrSkyCol.a = 1;

        envLight.vrKumoCol.r = saturate(kankyo_color_ratio_set(envLight, virt0A.kumoCol.r, virt0B.kumoCol.r, ret.blendPaleAB, virt1A.kumoCol.r, virt1B.kumoCol.r, envLight.colpatBlend, envLight.vrboxAddcolSky0.r, envLight.vrKumoColRatio * envLight.unk_11c8));
        envLight.vrKumoCol.g = saturate(kankyo_color_ratio_set(envLight, virt0A.kumoCol.g, virt0B.kumoCol.g, ret.blendPaleAB, virt1A.kumoCol.g, virt1B.kumoCol.g, envLight.colpatBlend, envLight.vrboxAddcolSky0.g, envLight.vrKumoColRatio * envLight.unk_11cc));
        envLight.vrKumoCol.b = saturate(kankyo_color_ratio_set(envLight, virt0A.kumoCol.b, virt0B.kumoCol.b, ret.blendPaleAB, virt1A.kumoCol.b, virt1B.kumoCol.b, envLight.colpatBlend, envLight.vrboxAddcolSky0.b, envLight.vrKumoColRatio * envLight.unk_11d0));
        envLight.vrKumoCol.a = saturate(kankyo_color_ratio_set(envLight, virt0A.kumoCol.a, virt0B.kumoCol.a, ret.blendPaleAB, virt1A.kumoCol.a, virt1B.kumoCol.a, envLight.colpatBlend, 0, 1));

        envLight.vrShitaGumoCol.r = saturate(kankyo_color_ratio_set(envLight, virt0A.shitaGumoCol.r, virt0B.shitaGumoCol.r, ret.blendPaleAB, virt1A.shitaGumoCol.r, virt1B.shitaGumoCol.r, envLight.colpatBlend, envLight.vrboxAddcolSky0.r, envLight.vrKumoColRatio * envLight.unk_11c8));
        envLight.vrShitaGumoCol.g = saturate(kankyo_color_ratio_set(envLight, virt0A.shitaGumoCol.g, virt0B.shitaGumoCol.g, ret.blendPaleAB, virt1A.shitaGumoCol.g, virt1B.shitaGumoCol.g, envLight.colpatBlend, envLight.vrboxAddcolSky0.g, envLight.vrKumoColRatio * envLight.unk_11cc));
        envLight.vrShitaGumoCol.b = saturate(kankyo_color_ratio_set(envLight, virt0A.shitaGumoCol.b, virt0B.shitaGumoCol.b, ret.blendPaleAB, virt1A.shitaGumoCol.b, virt1B.shitaGumoCol.b, envLight.colpatBlend, envLight.vrboxAddcolSky0.b, envLight.vrKumoColRatio * envLight.unk_11d0));

        envLight.vrShimoUneiCol.r = saturate(kankyo_color_ratio_set(envLight, virt0A.shimoUneiCol.r, virt0B.shimoUneiCol.r, ret.blendPaleAB, virt1A.shimoUneiCol.r, virt1B.shimoUneiCol.r, envLight.colpatBlend, envLight.vrboxAddcolSky0.r, envLight.vrKumoColRatio * envLight.unk_11c8));
        envLight.vrShimoUneiCol.g = saturate(kankyo_color_ratio_set(envLight, virt0A.shimoUneiCol.g, virt0B.shimoUneiCol.g, ret.blendPaleAB, virt1A.shimoUneiCol.g, virt1B.shimoUneiCol.g, envLight.colpatBlend, envLight.vrboxAddcolSky0.g, envLight.vrKumoColRatio * envLight.unk_11cc));
        envLight.vrShimoUneiCol.b = saturate(kankyo_color_ratio_set(envLight, virt0A.shimoUneiCol.b, virt0B.shimoUneiCol.b, ret.blendPaleAB, virt1A.shimoUneiCol.b, virt1B.shimoUneiCol.b, envLight.colpatBlend, envLight.vrboxAddcolSky0.b, envLight.vrKumoColRatio * envLight.unk_11d0));

        envLight.vrKasumiCol.r = saturate(kankyo_color_ratio_set(envLight, virt0A.kasumiCol.r, virt0B.kasumiCol.r, ret.blendPaleAB, virt1A.kasumiCol.r, virt1B.kasumiCol.r, envLight.colpatBlend, envLight.vrboxAddcolKasumi.r, envLight.vrSoraColRatio * envLight.unk_11c8));
        envLight.vrKasumiCol.g = saturate(kankyo_color_ratio_set(envLight, virt0A.kasumiCol.g, virt0B.kasumiCol.g, ret.blendPaleAB, virt1A.kasumiCol.g, virt1B.kasumiCol.g, envLight.colpatBlend, envLight.vrboxAddcolKasumi.g, envLight.vrSoraColRatio * envLight.unk_11cc));
        envLight.vrKasumiCol.b = saturate(kankyo_color_ratio_set(envLight, virt0A.kasumiCol.b, virt0B.kasumiCol.b, ret.blendPaleAB, virt1A.kasumiCol.b, virt1B.kasumiCol.b, envLight.colpatBlend, envLight.vrboxAddcolKasumi.b, envLight.vrSoraColRatio * envLight.unk_11d0));
        envLight.vrKasumiCol.a = saturate(kankyo_color_ratio_set(envLight, virt0A.kasumiCol.a, virt0B.kasumiCol.a, ret.blendPaleAB, virt1A.kasumiCol.a, virt1B.kasumiCol.a, envLight.colpatBlend, 0, 1));

        envLight.vrOkuKasumiCol.r = saturate(kankyo_color_ratio_set(envLight, virt0A.okuKasumiCol.r, virt0B.okuKasumiCol.r, ret.blendPaleAB, virt1A.okuKasumiCol.r, virt1B.okuKasumiCol.r, envLight.colpatBlend, envLight.vrboxAddcolKasumi.r, envLight.vrSoraColRatio * envLight.unk_11c8));
        envLight.vrOkuKasumiCol.g = saturate(kankyo_color_ratio_set(envLight, virt0A.okuKasumiCol.g, virt0B.okuKasumiCol.g, ret.blendPaleAB, virt1A.okuKasumiCol.g, virt1B.okuKasumiCol.g, envLight.colpatBlend, envLight.vrboxAddcolKasumi.g, envLight.vrSoraColRatio * envLight.unk_11cc));
        envLight.vrOkuKasumiCol.b = saturate(kankyo_color_ratio_set(envLight, virt0A.okuKasumiCol.b, virt0B.okuKasumiCol.b, ret.blendPaleAB, virt1A.okuKasumiCol.b, virt1B.okuKasumiCol.b, envLight.colpatBlend, envLight.vrboxAddcolKasumi.b, envLight.vrSoraColRatio * envLight.unk_11d0));
        envLight.vrOkuKasumiCol.a = saturate(kankyo_color_ratio_set(envLight, virt0A.okuKasumiCol.a, virt0B.okuKasumiCol.a, ret.blendPaleAB, virt1A.okuKasumiCol.a, virt1B.okuKasumiCol.a, envLight.colpatBlend, 0, 1));
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
            tevStr.ambCol.r = 1.0;
            tevStr.ambCol.g = 0;
            tevStr.ambCol.b = 0;
        }
    } else {
        if (tevStr.lightType == LightType.UNK_10 || tevStr.lightType == LightType.UNK_9 || tevStr.unk_378 != 0) {
            dKy_calc_color_set(envLight, tevStr.ambCol, ret.palePrevA.actorAmbCol, ret.palePrevB.actorAmbCol, ret.paleCurrA.actorAmbCol, ret.paleCurrB.actorAmbCol, ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, tevStr.lightInfluence * envLight.actAmbColRatio * envLight.actAmbColRatio);
        } else {
            dKy_calc_color_set(envLight, tevStr.ambCol, ret.palePrevA.actorAmbCol, ret.palePrevB.actorAmbCol, ret.paleCurrA.actorAmbCol, ret.paleCurrB.actorAmbCol, ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, tevStr.lightInfluence * envLight.unk_1210 * envLight.actAmbColRatio * envLight.actAmbColRatio);
        }

        for (let i = 0; i < 6; i++) {
            if (i === 0) {
                if (tevStr.lightType === LightType.UNK_10 || tevStr.lightType === LightType.UNK_9 || tevStr.unk_378 !== 0) {
                    dKy_calc_color_set(envLight, tevStr.lights[i].Color, ret.palePrevA.lightCol[i], ret.palePrevB.lightCol[i], ret.paleCurrA.lightCol[i], ret.paleCurrB.lightCol[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, 1.0);
                    dKy_light_influence_col(tevStr.lights[i].Color, tevStr.lights[i].Color, tevStr.lightInfluence);
                } else {
                    dKy_calc_color_set(envLight, tevStr.lights[i].Color, ret.palePrevA.lightCol[i], ret.palePrevB.lightCol[i], ret.paleCurrA.lightCol[i], ret.paleCurrB.lightCol[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, envLight.unk_1210);
                    kankyo_color_ratio_calc(tevStr.lights[i].Color, tevStr.lights[i].Color, envLight.unk_1210 * tevStr.lightInfluence);
                }
            } else if (tevStr.lightType === LightType.UNK_10 || tevStr.lightType === LightType.UNK_9 || tevStr.unk_378 !== 0) {
                dKy_calc_color_set(envLight, tevStr.lights[i].Color, ret.palePrevA.lightCol[i], ret.palePrevB.lightCol[i], ret.paleCurrA.lightCol[i], ret.paleCurrB.lightCol[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, envLight.actAmbColRatio * envLight.actAmbColRatio);
                dKy_light_influence_col(tevStr.lights[i].Color, tevStr.lights[i].Color, tevStr.lightInfluence);
            } else {
                dKy_calc_color_set(envLight, tevStr.lights[i].Color, ret.palePrevA.lightCol[i], ret.palePrevB.lightCol[i], ret.paleCurrA.lightCol[i], ret.paleCurrB.lightCol[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.actorAddAmb, envLight.unk_1210 * envLight.actAmbColRatio * envLight.actAmbColRatio);
                kankyo_color_ratio_calc(tevStr.lights[i].Color, tevStr.lights[i].Color, envLight.unk_1210 * tevStr.lightInfluence);
            }
        }

        dKy_calc_color_set(envLight, envLight.fogCol, ret.palePrevA.fogCol, ret.palePrevB.fogCol, ret.paleCurrA.fogCol, ret.paleCurrB.fogCol, ret.blendPaleAB, tevStr.colpatBlend, envLight.fogAddCol, envLight.fogColRatio);
    }
}

function dKy_light_influence_col(dst: Color, c: Color, ratio: number): void {
    dst.r = Math.min(1.0, c.r * ratio);
    dst.g = Math.min(1.0, c.g * ratio);
    dst.b = Math.min(1.0, c.b * ratio);
}

function setLight_bg(globals: dGlobals, envLight: dScnKy_env_light_c, outBgAmbCol: Color[], outFog: { fogStartZ: number, fogEndZ: number, fogCol: Color }, tevStr: dKy_tevstr_c): void {
    tevStr.colpatPrev = envLight.colpatPrev;
    tevStr.colpatCurr = envLight.colpatCurr;
    if (tevStr.colpatPrev !== tevStr.colpatCurr)
        tevStr.colpatBlend = envLight.colpatBlend;

    const ret = setLight_palno_get(setLight_palno_ret_scratch, envLight, globals, envLight);

    if (ret.palePrevA === null) {
        for (let i = 0; i < 4; i++) {
            outBgAmbCol[i].r = 1.0;
            outBgAmbCol[i].g = 0.0;
            outBgAmbCol[i].b = 0.0;
        }
    } else {
        for (let i = 0; i < 4; i++)
            dKy_calc_color_set(envLight, outBgAmbCol[i], ret.palePrevA.bgAmbCol[i], ret.palePrevB.bgAmbCol[i], ret.paleCurrA.bgAmbCol[i], ret.paleCurrB.bgAmbCol[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.bgAddAmb[0], envLight.bgAmbColRatio);

        outBgAmbCol[0].a = 1.0;
        outBgAmbCol[1].a = 1.0;
        outBgAmbCol[2].a = 1.0;
        outBgAmbCol[3].a = 1.0;

        for (let i = 0; i < 6; i++) {
            dKy_calc_color_set(envLight, tevStr.lights[i].Color, ret.palePrevA.lightCol[i], ret.palePrevB.lightCol[i], ret.paleCurrA.lightCol[i], ret.paleCurrB.lightCol[i], ret.blendPaleAB, tevStr.colpatBlend, envLight.bgAddAmb[0], envLight.bgAmbColRatio);
            dKy_light_influence_col(tevStr.lights[i].Color, tevStr.lights[i].Color, tevStr.lightInfluence);
        }

        dKy_calc_color_set(envLight, outFog.fogCol, ret.palePrevA.fogCol, ret.palePrevB.fogCol, ret.paleCurrA.fogCol, ret.paleCurrB.fogCol, ret.blendPaleAB, tevStr.colpatBlend, envLight.fogAddCol, envLight.fogColRatio);
        outFog.fogStartZ = float_kankyo_color_ratio_set(ret.palePrevA.fogStartZ, ret.palePrevB.fogStartZ, ret.blendPaleAB, ret.paleCurrA.fogStartZ, ret.paleCurrB.fogStartZ, envLight.colpatBlend, envLight.fogStartZGlobal, envLight.fogRatio);
        outFog.fogEndZ = float_kankyo_color_ratio_set(ret.palePrevA.fogEndZ, ret.palePrevB.fogEndZ, ret.blendPaleAB, ret.paleCurrA.fogEndZ, ret.paleCurrB.fogEndZ, envLight.colpatBlend, envLight.fogEndZGlobal, envLight.fogRatio);
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

    tevStr.baseLight.Color.a = 1.0;

    let plightIdx = dKy_light_influence_id(globals, pos, 0);

    if (tevStr.lightType === 7 || tevStr.lightType === 1 || tevStr.lightType === 2 || tevStr.lightType === 6 || tevStr.lightType === 3 || tevStr.lightType === 4 || tevStr.lightType === 5) {
        plightIdx = -2;
    } else if (tevStr.lightType === 9 && dKy_darkworld_check(globals)) {
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
            cLib_addCalc(tevStr.lightInfluence, tevStr.envrOverride / 100, 0.25, 0.05, 0.000001);
        }
    } else {
        if (tevStr.roomNo >= 0) {
            tevStr.envrIdxCurr = tevStr.roomNo;

            if (envLight.actorLightEffect === 100) {
                cLib_addCalc(tevStr.lightInfluence, 1.0, 0.25, 0.05, 0.000001);
            }
        } else {
            tevStr.envrIdxCurr = 0;
        }
    }

    if ((tevStr.lightType !== 0 && tevStr.lightType <= LightType.UNK_7) || (tevStr.lightType === LightType.UNK_9 && dKy_darkworld_check(globals))) {
        if ((tevStr.lightType !== LightType.UNK_2 && tevStr.lightType !== LightType.UNK_3) || dKy_darkworld_check(globals)) {
            tevStr.lightInfluence = 0.0;
        }
    }

    if (tevStr.envrIdxPrev !== tevStr.envrIdxCurr && (tevStr.colpatBlend >= 0.0 || tevStr.colpatBlend <= 1.0))
        tevStr.colpatBlend = 0.0;

    if (tevStr.lightType !== LightType.UNK_8) {
        setLight_actor(globals, envLight, tevStr);
        colorCopy(envLight.actorAmbCol, tevStr.ambCol);
    } else {
        const bgAmbCol = nArray(4, () => colorNewCopy(TransparentBlack));
        setLight_bg(globals, envLight, bgAmbCol, tevStr, tevStr);
        colorCopy(envLight.actorAmbCol, bgAmbCol[0]);
    }
}

export function settingTevStruct_colget_player(envLight: dScnKy_env_light_c, tevStr: dKy_tevstr_c): void {
    if (tevStr.envrOverride !== -1) {
        if (envLight.actorLightEffect === 100)
            cLib_addCalc(tevStr.lightInfluence, tevStr.envrOverride / 100, 0.25, 0.05, 0.000001);
    } else if (tevStr.roomNo >= 0) {
        tevStr.envrIdxCurr = tevStr.roomNo;

        if (envLight.actorLightEffect === 100) {
            cLib_addCalc(tevStr.lightInfluence, tevStr.envrOverride / 100, 0.25, 0.05, 0.000001);
        }
    }
}

export function dKy_lightdir_set(dst: vec3, x: number, y: number): void {
    computeUnitSphericalCoordinates(dst, x * MathConstants.DEG_TO_RAD, y * MathConstants.DEG_TO_RAD);
}

export function settingTevStruct(globals: dGlobals, lightType: LightType, pos: vec3 | null, tevStr: dKy_tevstr_c): void {
    const envLight = globals.g_env_light;

    if (tevStr.roomNo < 0) {
        tevStr.roomNo = globals.mStayNo;
    }

    if (envLight.actorLightEffect !== 100) {
        tevStr.lightInfluence = envLight.actorLightEffect / 100;
    }

    tevStr.lightType = lightType;

    if (tevStr.initType !== 123 && tevStr.initType !== 124) {
        dKy_tevstr_init(tevStr, globals.mStayNo);
    }

    tevStr.initType = 124;
    envLight.actorAmbCol.a = 1.0;

    if (lightType === LightType.UNK_14) {
        tevStr.lightMode = LightMode.BG;
        if (tevStr.roomNo >= 128) {
            tevStr.envrIdxCurr = 0;
        } else {
            tevStr.envrIdxCurr = tevStr.roomNo;
        }

        if (!dKy_darkworld_check(globals)) {
            tevStr.ambCol.r = 24 / 255;
            tevStr.ambCol.g = 24 / 255;
            tevStr.ambCol.b = 24 / 255;
        } else {
            tevStr.ambCol.r = 55 / 255;
            tevStr.ambCol.g = 55 / 255;
            tevStr.ambCol.b = 77 / 255;
        }

        tevStr.fogCol.r = 1.0;
        tevStr.fogCol.g = 1.0;
        tevStr.fogCol.b = 1.0;

        for (let i = 0; i < tevStr.lights.length; i++) {
            const light = tevStr.lights[i];

            if (i === 0) {
                if (!dKy_darkworld_check(globals)) {
                    light.Color.r = 126 / 255;
                    light.Color.g = 110 / 255;
                    light.Color.b = 89  / 255;
                } else {
                    light.Color.r = 0;
                    light.Color.g = 0;
                    light.Color.b = 0;
                }
            } else if (i === 1) {
                if (!dKy_darkworld_check(globals)) {
                    light.Color.r = 24 / 255;
                    light.Color.g = 41 / 255;
                    light.Color.b = 50 / 255;
                } else {
                    light.Color.r = 0;
                    light.Color.g = 0;
                    light.Color.b = 0;
                }
            } else {
                light.Color.r = 0;
                light.Color.g = 0;
                light.Color.b = 0;
            }

            if (i === 0) {
                light.Position[0] = 500;
                light.Position[1] = 500;
                light.Position[2] = 500;
            } else if (i === 1) {
                light.Position[0] = -500;
                light.Position[1] = -500;
                light.Position[2] = -500;
            }

            dKy_lightdir_set(tevStr.lights[i].Direction, 0.0, 0.0);
            vec3.negate(light.Direction, light.Direction);
        }

        tevStr.baseLight.Color.r = 0;
        tevStr.baseLight.Color.g = 0;
        tevStr.baseLight.Color.b = 0;
    } else if (lightType === LightType.UNK_12 || lightType === LightType.UNK_13) {
        colorCopy(tevStr.fogCol, TransparentBlack);
        tevStr.lightMode = LightMode.BG;

        if (tevStr.roomNo >= 128) {
            tevStr.envrIdxCurr = 0;
        } else {
            tevStr.envrIdxCurr = tevStr.roomNo;
        }

        if (lightType === LightType.UNK_12) {
            tevStr.ambCol.r = 25 / 255;
            tevStr.ambCol.g = 20 / 255;
            tevStr.ambCol.b = 25 / 255;
        } else {
            tevStr.ambCol.r = 40 / 255;
            tevStr.ambCol.g = 35 / 255;
            tevStr.ambCol.b = 30 / 255;
        }

        tevStr.fogCol.r = 1.0;
        tevStr.fogCol.g = 1.0;
        tevStr.fogCol.b = 1.0;

        for (let i = 0; i < tevStr.lights.length; i++) {
            const light = tevStr.lights[i];

            if (i === 0) {
                if (lightType === LightType.UNK_12) {
                    light.Position[0] = -30000;
                    light.Position[1] = 18800;
                    light.Position[2] = 29000;
                    light.Color.r = 120 / 255;
                    light.Color.g = 110 / 255;
                    light.Color.b = 100 / 255;
                } else {
                    light.Position[0] = -37000;
                    light.Position[1] = 18800;
                    light.Position[2] = 500;
                    light.Color.r = 85 / 255;
                    light.Color.g = 90 / 255;
                    light.Color.b = 100 / 255;
                }
            } else if (i === 1) {
                if (lightType === LightType.UNK_12) {
                    light.Position[0] = 14400;
                    light.Position[1] = 7500;
                    light.Position[2] = 3900;
                    light.Color.r = 30 / 255;
                    light.Color.g = 45 / 255;
                    light.Color.b = 30 / 255;
                } else {
                    light.Position[0] = -18000;
                    light.Position[1] = -6500;
                    light.Position[2] = -10000;
                    light.Color.r = 100 / 255;
                    light.Color.g = 65 / 255;
                    light.Color.b = 40 / 255;
                }
            } else {
                light.Color.r = 0;
                light.Color.g = 0;
                light.Color.b = 0;
            }

            lightSetSpot(light, 90.0, GX.SpotFunction.OFF);
            lightSetDistAttn(light, 1000000.0, 0.99999, GX.DistAttnFunction.STEEP);
            dKy_lightdir_set(tevStr.lights[i].Direction, 0.0, 0.0);
            vec3.negate(light.Direction, light.Direction);
        }

        // lightSetWorldDirection(tevStr.baseLight, globals.camera, envLight.baseLightDir);
        tevStr.baseLight.Color.r = 0;
        tevStr.baseLight.Color.g = 0;
        tevStr.baseLight.Color.b = 0;
    } else if (!(lightType & 0xF0)) {
        tevStr.lightMode = LightMode.Actor;
        colorCopy(tevStr.ambCol, envLight.actorAmbCol);
        colorCopy(tevStr.fogCol, envLight.fogCol);

        if (lightType === LightType.UNK_0 || lightType === LightType.UNK_8 || lightType === LightType.UNK_7 || lightType === LightType.UNK_1 || lightType === LightType.UNK_2 || lightType === LightType.UNK_3 || lightType === LightType.UNK_5 || lightType === LightType.UNK_4 || lightType === LightType.UNK_11) {
            settingTevStruct_colget_actor(globals, globals.g_env_light, tevStr);
        } else if (lightType === LightType.UNK_10 || lightType === LightType.UNK_9) {
            settingTevStruct_colget_player(envLight, tevStr);
            settingTevStruct_colget_actor(globals, envLight, tevStr);
        }

        if (lightType !== LightType.UNK_11) {
            const initTimer = 0;
            settingTevStruct_plightcol_plus(globals, assertExists(pos), tevStr, initTimer);
        }

        if (lightType === LightType.UNK_10 || lightType === LightType.UNK_9) {
            // vec3.copy(envLight.plightNearPos, tevStr.);
        }
    } else {
        tevStr.lightMode = LightMode.BG;
        if (tevStr.lightType !== 20) {
            tevStr.lightInfluence = envLight.terrainLightInfluence;
        } else {
            switch (tevStr.unk_364) {
            case 0:
                tevStr.lightInfluence = 0.2;
                break;
            case 1:
                tevStr.lightInfluence = 0.3;
                break;
            case 2:
                tevStr.lightInfluence = 0.4;
                break;
            case 3:
                tevStr.lightInfluence = 0.6;
                break;
            case 4:
                tevStr.lightInfluence = 0.8;
                break;
            case 5:
                tevStr.lightInfluence = 0.9;
                break;
            case 6:
                tevStr.lightInfluence = 1.0;
                break;
            case 7:
                tevStr.lightInfluence = 1.2;
                break;
            default:
                tevStr.lightInfluence = 1.0;
                break;
            }
        }

        if (tevStr.roomNo >= 128) {
            tevStr.envrIdxCurr = 0;
        } else {
            tevStr.envrIdxCurr = tevStr.roomNo;
        }

        const bgAmbCol = nArray(4, () => colorNewCopy(TransparentBlack));
        setLight_bg(globals, envLight, bgAmbCol, tevStr, tevStr);
        colorCopy(tevStr.ambCol, bgAmbCol[lightType & 3]);

        let plightIdx = dKy_light_influence_id(globals, Vec3Zero, 0);
        /* if (plightIdx >= 0 && envLight.plights[plightIdx].priority < 0) {

        } */

        tevStr.baseLight.Color.r = 0;
        tevStr.baseLight.Color.g = 0;
        tevStr.baseLight.Color.b = 0;

        tevStr.baseLight.CosAtten = [0, 0, 0];
        tevStr.baseLight.DistAtten = [0, 0, 0];

        vec3.copy(tevStr.baseLight.Position, envLight.lightStatus[0].Position);
        // Direction does not matter.
        if (lightType >= LightType.BG0 && lightType <= LightType.BG5)
            colorFromRGBA(tevStr.baseLight.Color, 1, 1, 1, 1);
        else
            colorFromRGBA(tevStr.baseLight.Color, 1, 0, 0, 1);
    }
}

export function dKy_tevstr_init(tevstr: dKy_tevstr_c, roomNo: number, envrOverride: number = -1): void {
    tevstr.roomNo = roomNo;
    tevstr.envrIdxCurr = tevstr.roomNo;
    tevstr.envrIdxPrev = tevstr.roomNo;
    tevstr.envrOverride = envrOverride;

    tevstr.initTimer = 1;
    tevstr.initType = 0x7B;
    tevstr.lightInfluence = 1.0;

    tevstr.baseLight.Color.g = 0;
    tevstr.baseLight.Color.b = 0;
    tevstr.baseLight.Color.a = 1.0;

    for (let i = 0; i < tevstr.lights.length; i++) {
        vec3.set(tevstr.lights[i].Position, -36384.5, 29096.7, 17422.2);
        tevstr.lights[i].Color.r = 1.0;
        tevstr.lights[i].Color.g = 1.0;
        tevstr.lights[i].Color.b = 1.0;
        tevstr.lights[i].Color.a = 1.0;
    }
}

function GxFogSet_Sub(fog: FogBlock, tevStr: { fogStartZ: number, fogEndZ: number, fogCol: Color }, camera: Camera) {
    colorCopy(fog.Color, tevStr.fogCol);

    // Empirically decided.
    const fogFarPlane = Number.isFinite(camera.far) ? camera.far : 100000;

    const type = camera.isOrthographic ? GX.FogType.ORTHO_LIN : GX.FogType.PERSP_LIN;
    fogBlockSet(fog, type, tevStr.fogStartZ, tevStr.fogEndZ, camera.near, fogFarPlane);
}

export function dKy_GxFog_set(envLight: dScnKy_env_light_c, fog: FogBlock, camera: Camera): void {
    GxFogSet_Sub(fog, envLight, camera);
}

// This is effectively the global state that dKy_setLight sets up, but since we don't
// have global state, we have to do this here.
export function dKy_setLight__OnModelInstance(envLight: dScnKy_env_light_c, modelInstance: J3DModelInstance, camera: Camera): void {
    for (let i = 0; i < envLight.lightStatus.length; i++)
        lightSetFromWorldLight(modelInstance.getGXLightReference(i), envLight.lightStatus[i], camera);
}

export function dKy_setLight__OnMaterialParams(envLight: dScnKy_env_light_c, materialParams: MaterialParams, camera: Camera): void {
    for (let i = 0; i < envLight.lightStatus.length; i++)
        lightSetFromWorldLight(materialParams.u_Lights[i], envLight.lightStatus[i], camera);
}

function setLightTevColorType_MAJI_sub(globals: dGlobals, materialInstance: MaterialInstance, tevStr: dKy_tevstr_c, mode: number): void {
    const ambCol = colorNewCopy(tevStr.ambCol);

    if (((tevStr.lightType !== LightType.UNK_0 && tevStr.lightType < LightType.UNK_8) || tevStr.lightType === LightType.UNK_5 || tevStr.lightType === LightType.UNK_15 || (tevStr.lightType === LightType.UNK_9 && dKy_darkworld_check(globals))) &&
        ((tevStr.lightType !== LightType.UNK_2 && tevStr.lightType !== LightType.UNK_3) || dKy_darkworld_check(globals))) {
        colorCopy(ambCol, TransparentBlack);
    }

    if (tevStr.lightType === LightType.UNK_7) {
        ambCol.a = 4 / 255;
    } else if (tevStr.lightType === LightType.UNK_3) {
        ambCol.r = 12 / 255;
        ambCol.g = 12 / 255;
        ambCol.b = 12 / 255;
    } else if (tevStr.lightType === LightType.UNK_6) {
        const wave = (255.0 - Math.abs(Math.sin(globals.counter * 662)) * 185.0) / 255.0;
        ambCol.r = wave;
        ambCol.g = wave;
        ambCol.b = wave;
    } else if (tevStr.lightType === LightType.UNK_2) {
        ambCol.r = 18 / 255;
        ambCol.g = 18 / 255;
        ambCol.b = 18 / 255;
    } else if (tevStr.lightType === LightType.UNK_4) {
        ambCol.r = 0xFF / 255;
        ambCol.g = 0x33 / 255;
        ambCol.b = 0x0B / 255;
    } else if (tevStr.lightType === LightType.UNK_5) {
        ambCol.r = 10 / 255;
        ambCol.g = 10 / 255;
        ambCol.b = 8 / 255;
    } else if (tevStr.lightType === LightType.UNK_15) {
        ambCol.r = 25 / 255;
        ambCol.g = 30 / 255;
        ambCol.b = 35 / 255;
    }

    materialInstance.setColorOverride(ColorKind.AMB0, ambCol);

    if (mode !== 0) {
        materialInstance.setColorOverride(ColorKind.C0, tevStr.colorC0);
        materialInstance.setColorOverride(ColorKind.K0, tevStr.colorK0);
    }
}

function setLightTevColorType_MAJI_light(globals: dGlobals, modelInstance: J3DModelInstance, tevStr: dKy_tevstr_c, mode: number): void {
    // TODO(jstpierre): allow setting lights per MaterialInstance
    const envLight = globals.g_env_light;

    lightSetFromWorldLight(modelInstance.getGXLightReference(0), tevStr.baseLight, globals.camera);

    if (mode === 2) {
        for (let i = 0; i < tevStr.lights.length; i++) {
            if (i < 2) {
                // fishing pond maple color change
                modelInstance.getGXLightReference(i + 2).copy(tevStr.lights[i]);
            } else {
                modelInstance.getGXLightReference(i + 2).copy(tevStr.lights[i]);
            }
        }
    } else {
        // TODO(jstpierre): Figure out the conditions for this vs. lightStatusData lights

        // for (let i = 0; i < tevStr.lights.length; i++)
        //     modelInstance.getGXLightReference(i + 2).copy(tevStr.lights[i]);

        for (let i = 0; i < 6; i++)
            lightSetFromWorldLight(modelInstance.getGXLightReference(i + 2), envLight.lightStatus[i + 2], globals.camera);
    }
}

function dKy_cloudshadow_scroll(globals: dGlobals, modelInstance: J3DModelInstance, tevStr: dKy_tevstr_c, mode: number): void {
    for (let i = 0; i < modelInstance.materialInstances.length; i++) {
        const materialInstance = modelInstance.materialInstances[i];
        const name = materialInstance.materialData.material.name;

        setLightTevColorType_MAJI_sub(globals, materialInstance, tevStr, mode);

        const sub = name.slice(3, 7);
        if (sub === 'MA00' || sub === 'MA01' || sub === 'MA16') {
            if (sub === 'MA00' || sub === 'MA01') {
                const k1 = colorNewCopy(TransparentBlack);
                k1.r = globals.g_env_light.cloudShadowDensity;
                materialInstance.setColorOverride(ColorKind.K1, k1);
            }

            const texMtx = materialInstance.materialData.material.texMatrices[1];
            if (texMtx !== null && globals.g_env_light.vrkumoPacket !== null) {
                texMtx.matrix[12] = globals.g_env_light.vrkumoPacket.cloudScrollX;
                texMtx.matrix[13] = globals.g_env_light.vrkumoPacket.cloudScrollY;
            }
        }
    }
}

export function setLightTevColorType_MAJI(globals: dGlobals, modelInstance: J3DModelInstance, tevStr: dKy_tevstr_c, camera: Camera): void {
    const envLight = globals.g_env_light;

    const light0 = modelInstance.getGXLightReference(0);
    lightSetFromWorldLight(light0, tevStr.baseLight, camera);

    const light1 = modelInstance.getGXLightReference(1);
    lightSetFromWorldLight(light1, envLight.lightStatus[1], camera);

    modelInstance.setColorOverride(ColorKind.C0, tevStr.colorC0);
    modelInstance.setColorOverride(ColorKind.K0, tevStr.colorK0);

    for (let i = 0; i < modelInstance.materialInstances.length; i++)
        GxFogSet_Sub(modelInstance.materialInstances[i].fogBlock, tevStr, camera);

    let mode = (tevStr.lightType > 10 && tevStr.lightType !== 12 && tevStr.lightType !== 13) ? 1 : 0;
    if (tevStr.unk_378 !== 0)
        mode = 2; // fishing pond hack :/

    setLightTevColorType_MAJI_light(globals, modelInstance, tevStr, mode);

    if (!!(tevStr.lightType & 0x20)) {
        dKy_cloudshadow_scroll(globals, modelInstance, tevStr, mode);
    } else {
        for (let i = 0; i < modelInstance.materialInstances.length; i++)
            setLightTevColorType_MAJI_sub(globals, modelInstance.materialInstances[i], tevStr, mode);
    }
}

function SetBaseLight(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    vec3.copy(envLight.baseLight.pos, envLight.sunPos);
    colorFromRGBA(envLight.baseLight.color, 1.0, 1.0, 1.0, 1.0);
    envLight.baseLight.power = 0.0;
    envLight.baseLight.fluctuation = 0.0;
}

function setSunpos(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    if (globals.stageName === "F_SP200")
        return;

    function getAngle(time: number): number {
        if (time >= 360.0)
            time -= 360.0;

        let angle: number;
        if (time >= 90.0 && time <= 270.0) {
            angle = invlerp(90.0, 270.0, time) * 150.0 + 105.0;
        } else {
            if (time < 90.0)
                time += 360.0;
    
            angle = invlerp(270.0, 450.0, time) * 210.0 + 255.0;
            if (angle > 360.0)
                angle -= 360.0;
        }
        return angle;
    }

    {
        const sunAngle = getAngle(envLight.curTime);
        const theta = MathConstants.DEG_TO_RAD * sunAngle;
        const sinR = Math.sin(theta), cosR = Math.cos(theta);
        const baseX = 80000 * sinR, baseY = -80000 * cosR, baseZ = -48000 * cosR;
        vec3.set(envLight.sunPosLocal, baseX, baseY, baseZ);
        vec3.add(envLight.sunPos, globals.cameraPosition, envLight.sunPosLocal);
    }

    {
        const moonAngle = getAngle(envLight.curTime + 180.0);
        const theta = MathConstants.DEG_TO_RAD * moonAngle;
        const sinR = Math.sin(theta), cosR = Math.cos(theta);
        const baseX = 80000 * sinR, baseY = -80000 * cosR, baseZ = -48000 * cosR;
        vec3.set(envLight.moonPos, baseX, baseY, baseZ);
        vec3.add(envLight.moonPos, globals.cameraPosition, envLight.moonPos);
    }
}

function drawKankyo(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    setSunpos(globals);
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

const S_time_table = [45.0, 75.0, 120.0, 150.0, 180.0, 240.0, 270.0, 360.0];
const S_wether_table = [0, 1, 3, 2, 4, 0, 1, 2];
const S_wether_mode_pat = [
    // Pattern 1: Dip into light rain
    [
        DiceWeatherMode.Overcast,
        DiceWeatherMode.LightRain,
        DiceWeatherMode.Overcast,
        DiceWeatherMode.Done,
    ],
    // Pattern 2: Dip into light thunder
    [
        DiceWeatherMode.Overcast,
        DiceWeatherMode.LightThunder,
        DiceWeatherMode.Overcast,
        DiceWeatherMode.Done,
    ],
    // Pattern 3: Dip into heavy rain
    [
        DiceWeatherMode.Overcast,
        DiceWeatherMode.HeavyRain,
        DiceWeatherMode.Overcast,
        DiceWeatherMode.Done,
    ],
    // Pattern 4: Overcast for a bit.
    [
        DiceWeatherMode.Overcast,
        DiceWeatherMode.Done,
    ],
    // Pattern 5: Dip into heavy thunder
    [
        DiceWeatherMode.Overcast,
        DiceWeatherMode.HeavyThunder,
        DiceWeatherMode.Overcast,
        DiceWeatherMode.Done,
    ],
];

const S_wether_time_pat = [
    [7.5, 7.5, 7.5],
    [5.0, 15.0, 5.0],
    [7.5, 15.0, 7.5],
    [30],
    [3.75, 3.75, 3.75],
];

export function dice_rain_minus(envLight: dScnKy_env_light_c, deltaTimeInFrames: number): void {
    if ((deltaTimeInFrames & 3) === 0) {
        if (envLight.rainCount > 40) {
            envLight.rainCount -= 3;
        } else if (envLight.rainCount !== 0) {
            envLight.rainCount--;
        }

        dKyw_rain_set(envLight, envLight.rainCount);
    }
}

function dice_wether_init(envLight: dScnKy_env_light_c, mode: number, timeChange: number, currentTime: number): void {
    console.log(`d_kankyo: dice_wether_init`, DiceWeatherMode[mode]);

    envLight.diceWeatherMode = mode;
    envLight.diceWeatherTime = currentTime + timeChange + cM_rndF(timeChange) + cM_rndF(timeChange);

    if (envLight.diceWeatherTime >= 360.0)
        envLight.diceWeatherTime -= 360.0;
}

function dice_wether_execute(envLight: dScnKy_env_light_c, mode: number, timeChange: number, currentTime: number): void {
    console.log(`d_kankyo: dice_wether_execute`, DiceWeatherMode[mode]);

    envLight.diceWeatherMode = mode;

    if (envLight.diceWeatherMode !== DiceWeatherMode.Done) {
        envLight.diceWeatherTime = currentTime + timeChange + cM_rndF(timeChange) + cM_rndF(timeChange);
        if (envLight.diceWeatherTime >= 360.0)
            envLight.diceWeatherTime -= 360.0;

        envLight.diceWeatherCounter++;
    } else {
        envLight.diceWeatherMode = DiceWeatherMode.Sunny;
        envLight.diceWeatherState++;
    }
}

export function dKy_event_proc(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    if (envLight.cameraInWater || envLight.diceWeatherStop)
        return;

    const current_time = envLight.curTime;

    switch (envLight.diceWeatherState) {
    case DiceWeatherState.Uninitialized:
        if (current_time > envLight.diceWeatherChangeTime && current_time - envLight.diceWeatherChangeTime < 15.0) {
            envLight.diceWeatherState = DiceWeatherState.Init;
        }
        break;
    case DiceWeatherState.Init:
        const patternIdx = Math.floor(cM_rndF(12.99));
        if (patternIdx >= 8) {
            envLight.diceWeatherState = DiceWeatherState.Next;
        } else {
            envLight.diceWeatherCurrPattern = S_wether_table[patternIdx];
            envLight.diceWeatherCounter = 0;

            const pattern = envLight.diceWeatherCurrPattern;
            const idx = envLight.diceWeatherCounter;
            dice_wether_init(envLight, S_wether_mode_pat[pattern][idx], S_wether_time_pat[pattern][idx], current_time);

            envLight.diceWeatherCounter++;
            envLight.diceWeatherState++;
        }
        break;
    case DiceWeatherState.Execute:
        if (current_time > envLight.diceWeatherTime && current_time - envLight.diceWeatherTime < 180.0) {
            const pattern = envLight.diceWeatherCurrPattern;
            const idx = envLight.diceWeatherCounter;
            dice_wether_execute(envLight, S_wether_mode_pat[pattern][idx], S_wether_time_pat[pattern][idx], current_time);
        }
        break;
    case DiceWeatherState.Next:
        envLight.diceWeatherChangeTime = current_time + S_time_table[Math.floor(cM_rndF(7.99))];

        if (envLight.diceWeatherChangeTime >= 360.0) {
            envLight.diceWeatherChangeTime -= 360.0;
        }

        envLight.diceWeatherState = DiceWeatherState.Uninitialized;
        break;
    }

    if (envLight.lightMaskType === 1) {
        envLight.diceWeatherMode = DiceWeatherMode.UNK_MODE_6;
    }

    if (envLight.colpatMode === 0 && envLight.colpatModeGather === 0) {
        let colpat = 0;

        switch (envLight.diceWeatherMode) {
        case DiceWeatherMode.Sunny:
            colpat = 0;
            if (envLight.thunderMode === 1)
                envLight.thunderMode = 0;

            dice_rain_minus(envLight, deltaTimeInFrames);
            break;
        case DiceWeatherMode.Overcast:
            envLight.thunderMode = 0;
            colpat = 1;
            dice_rain_minus(envLight, deltaTimeInFrames);
            break;
        case DiceWeatherMode.LightRain:
            colpat = 1;
            if (envLight.rainCount < 40) {
                envLight.rainCount++;
                dKyw_rain_set(envLight, envLight.rainCount);
            } else {
                envLight.rainCount--;
                dKyw_rain_set(envLight, envLight.rainCount);
            }
            break;
        case DiceWeatherMode.HeavyRain:
            colpat = 2;
            if (envLight.rainCount < 250) {
                envLight.rainCount++;
                dKyw_rain_set(envLight, envLight.rainCount);
            }
            break;
        case DiceWeatherMode.LightThunder:
            colpat = 1;
            envLight.thunderMode = 1;
            dice_rain_minus(envLight, deltaTimeInFrames);
            break;
        case DiceWeatherMode.HeavyThunder:
            envLight.thunderMode = 1;
            break;
        case DiceWeatherMode.UNK_MODE_6:
            colpat = 0;
            if (envLight.thunderMode === 1)
                envLight.thunderMode = 0;

            if (envLight.rainCount > 2)
                envLight.rainCount -= 2;
            else
                envLight.rainCount = 0;

            dKyw_rain_set(envLight, envLight.rainCount);
            break;
        }

        if (envLight.colpatWeather != colpat) {
            envLight.colpatWeather = colpat;
            envLight.colpatCurrGather = colpat;
        }
    }

    if (envLight.colpatMode === 0 && envLight.colpatModeGather === 0 && envLight.colpatCurrGather !== -1 && envLight.colpatCurrGather !== envLight.colpatCurr) {
        envLight.colpatBlendGather = 0.0;
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
    // Normally, this is done in the player code / settingTevStruct_colget_player.
    const newEnvrIdxCurr = globals.mStayNo;
    if (envLight.envrIdxCurr !== newEnvrIdxCurr) {
        if (envLight.envrIdxPrev === newEnvrIdxCurr) {
            // Previous room, so resume the old fade.
            envLight.envrIdxPrev = envLight.envrIdxCurr;
            envLight.colpatBlend = 1.0 - envLight.colpatBlend;
            envLight.envrIdxCurr = newEnvrIdxCurr;
        } else if (envLight.colpatBlend === 1.0 || envLight.colpatBlend === 0.0) {
            envLight.colpatBlend = 0.0;
            envLight.envrIdxCurr = newEnvrIdxCurr;
        }
    }

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

    envLight.allColRatio = cLib_addCalc(envLight.allColRatio, envLight.allColRatioGather, 0.5, 0.25, 0.01);
    envLight.actAmbColRatio = cLib_addCalc(envLight.actAmbColRatio, envLight.actAmbColRatioGather, 0.5, 0.25, 0.01);
    envLight.bgAmbColRatio = cLib_addCalc(envLight.bgAmbColRatio, envLight.bgAmbColRatioGather * envLight.unk_1210, 0.5, 0.25, 0.01);
    envLight.fogColRatio = cLib_addCalc(envLight.fogColRatio, envLight.fogColRatioGather * envLight.unk_1210, 0.5, 0.25, 0.01);
    envLight.vrSoraColRatio = cLib_addCalc(envLight.vrSoraColRatio, envLight.vrSoraColRatioGather * envLight.unk_1210, 0.5, 0.25, 0.01);
    envLight.vrKumoColRatio = cLib_addCalc(envLight.vrKumoColRatio, envLight.vrKumoColRatioGather * envLight.unk_1210, 0.5, 0.25, 0.01);

    envLight.allColRatioGather = 1.0;
    envLight.actAmbColRatioGather = 1.0;
    envLight.bgAmbColRatioGather = 1.0;
    envLight.fogColRatioGather = 1.0;
    envLight.vrSoraColRatioGather = 1.0;
    envLight.vrKumoColRatioGather = 1.0;
    envLight.unk_122c = 1.0;

    setDaytime(globals, envLight, deltaTimeInFrames);
    // dKyw_wether_proc();
    CalcTevColor(globals, envLight, globals.playerPosition);
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
        const dungeonLight = envLight.dungeonLight[i];

        // original uses test_pos_tbl but all values are identical and readonly
        vec3.set(dungeonLight.pos, 0, -99999, 0);
        dungeonLight.refDist = 1.0;
        colorCopy(dungeonLight.color, OpaqueBlack);

        vec3.copy(dungeonLight.influence.pos, dungeonLight.pos);
        dungeonLight.influence.color = dungeonLight.color;
        dungeonLight.influence.power = dungeonLight.refDist * 100;
        dungeonLight.influence.fluctuation = 0;
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
    envLight.underwater_screen_ef_btk.init(screen_ef_mdl, screen_ef_btk, true, LoopMode.Repeat);
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
    envLight.plights.length = 0;
    envLight.eflights.length = 0;

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

function envcolor_init(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    // not sure where the original does this
    const layerNo = globals.renderer.currentLayer;
    const roomNo = globals.mStayNo;

    let envIdx = 0;
    if (globals.dStage_dt.elst.length > 0) {
        if (roomNo > globals.dStage_dt.elst.length - 1)
            console.log(`envcolor_init: roomNo (${roomNo}) out of bounds! ELST entry num: ${globals.dStage_dt.elst.length}`);
        else
            envIdx = globals.dStage_dt.elst[roomNo].layers[layerNo];
    }

    envLight.pale = globals.dStage_dt.pale[envIdx];
    if (!envLight.pale || envLight.pale.length === 0) {
        envLight.pale = dKyd_dmpalet_getp(globals);
    }

    envLight.colo = globals.dStage_dt.colo[envIdx];
    if (!envLight.colo || envLight.colo.length === 0) {
        envLight.colo = dKyd_dmpselect_getp(globals);
    }

    envLight.envr = globals.dStage_dt.envr[envIdx];
    if (!envLight.envr || envLight.envr.length === 0) {
        envLight.envr = dKyd_dmenvr_getp(globals);
    }

    envLight.virt = globals.dStage_dt.virt[envIdx];
    if (!envLight.virt || envLight.virt.length === 0) {
        envLight.virt = dKyd_dmvrbox_getp(globals);
    }

    dKy_actor_addcol_set(envLight, 0, 0, 0, 0);
    dKy_fog_startendz_set(envLight, 0.0, 0.0, 0.0);
    dKy_vrbox_addcol_set(envLight, 0, 0, 0, 0.0);

    //envLight.vrboxInvisible = true;
    envLight.cameraInWater = false;
    envLight.actorLightEffect = 100;
    envLight.terrainLightInfluence = 1.0;

    dKy_light_size_get(globals.stageName, globals);

    const schejuleName = `l_time_attribute`;
    envLight.schejule = new dScnKy__Schedule(globals.findExtraSymbolData(`d_kankyo_data.o`, schejuleName));
    envLight.bloomInfTbl = new dkydata_bloomInfo(globals.findExtraSymbolData(`d_kankyo_data.o`, `l_kydata_BloomInf_tbl`));

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
    envLight.actAmbColRatioGather = ratio;
}

export function dKy_set_bgcol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.bgAmbColRatioGather = ratio;
}

export function dKy_set_fogcol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.fogColRatioGather = ratio;
}

export function dKy_set_vrboxsoracol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.vrSoraColRatioGather = ratio;
}

export function dKy_set_vrboxkumocol_ratio(envLight: dScnKy_env_light_c, ratio: number): void {
    envLight.vrKumoColRatioGather = ratio;
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
    if (globals.g_env_light.sunPacket !== null && !dKy_darkworld_check(globals)) {
        if (!globals.stageName.startsWith("D_MN07") && !globals.stageName.startsWith("D_MN09") && globals.stageName !== "F_SP200") {
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
    if (envLight.eflights[index] !== null && envLight.eflights[index] !== undefined) {
        envLight.BGpartsActiveLight[index].copy(envLight.eflights[index]);
        envLight.BGpartsActiveLight[index].index = index + 1;
    }
}

export function dKy_bgparts_activelight_cut(envLight: dScnKy_env_light_c, index: number): void {
    envLight.BGpartsActiveLight[index].index = 0;
}

export function dKy_setLight_nowroom_common(globals: dGlobals, roomNo: number, param_2: number): void {
    const envLight = globals.g_env_light;

    const layerNo = globals.renderer.currentLayer;
    const lgtv = globals.roomStatus[roomNo].lgtv[layerNo];
    const roomTevStr = globals.roomStatus[roomNo].tevStr;

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
        const light = envLight.lightStatus[i];

        if (envLight.BGpartsActiveLight[i].index !== 0 && envLight.BGpartsActiveLight[i].power !== 0.0 && i !== 1) {
            vec3.copy(light.Position, envLight.BGpartsActiveLight[i].pos);
            light.Color.r = envLight.BGpartsActiveLight[i].color.r;
            light.Color.g = envLight.BGpartsActiveLight[i].color.g;
            light.Color.b = envLight.BGpartsActiveLight[i].color.b;
        } else {
            light.Color.r = 0;
            light.Color.g = 0;
            light.Color.b = 0;
        }
    }

    for (let i = 0; i < 6; i++) {
        const light = envLight.lightStatus[i + 2];
        if (lgtv !== undefined && lgtv[i] !== undefined) {
            vec3.copy(light.Position, lgtv[i].pos);
            vec3.copy(light.Direction, lgtv[i].dir);
            const refDist = lgtv[i].radius; // dKy_lightswitch_check(globals, roomNo, lgtv[i].switch) ? lgtv[i].radius : 0.00001;
            lightSetDistAttn(light, refDist, 0.9999, lgtv[i].distFn);
            lightSetSpot(light, lgtv[i].spotCutoff, lgtv[i].spotFn);
        } else {
            colorCopy(light.Color, TransparentBlack);
            vec3.zero(light.DistAtten);
            vec3.zero(light.CosAtten);
        }

        if (dKy_SunMoon_Light_Check(globals) && i < 2) {
            vec3.copy(light.Position, i === 0 ? globals.g_env_light.sunPos : globals.g_env_light.moonPos);
            lightSetDistAttn(light, 10000.0, 0.99999, GX.DistAttnFunction.STEEP);
            lightSetSpot(light, 0.0, GX.SpotFunction.OFF);
        }

        colorCopy(light.Color, roomTevStr.lights[i].Color);
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

function dKy_murky_set(globals: dGlobals, materialInstance: MaterialInstance): void {
    const c1 = colorNewCopy(globals.g_env_light.bgAmbCol[1]);
    c1.a = globals.g_env_light.bgAmbCol[2].a;

    const k3 = colorNewCopy(TransparentBlack);
    k3.a = globals.g_env_light.bgAmbCol[1].a;

    // other special handling, sunlenz, diababa

    materialInstance.setColorOverride(ColorKind.C1, c1);
    materialInstance.setColorOverride(ColorKind.K3, k3);
}

function projectionMatrixForLightPerspective(dst: mat4, fovY: number, aspect: number, scaleS: number, scaleT: number, transS: number, transT: number): void {
    const cot = 1.0 / Math.tan(fovY * 0.5);

    dst[0] = (cot / aspect) * scaleS;
    dst[4] = 0.0;
    dst[8] = -transS;
    dst[12] = 0.0;

    dst[1] = 0.0;
    dst[5] = cot * scaleT;
    dst[9] = -transT;
    dst[13] = 0.0;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = -1.0;
    dst[14] = 0.0;

    dst[3] = 0.0;
    dst[7] = 0.0;
    dst[11] = 0.0;
    dst[15] = 1.0;
}

export function dKy_bg_MAxx_proc(globals: dGlobals, modelInstance: J3DModelInstance): void {
    const envLight = globals.g_env_light;

    for (let i = 0; i < modelInstance.materialInstances.length; i++) {
        const materialInstance = modelInstance.materialInstances[i];
        const name = materialInstance.materialData.material.name;

        if (name.charAt(3) === 'M' && name.charAt(4) === 'A') {
            const sub = name.slice(3, 7);
            if (sub === 'MA06')
                dKy_murky_set(globals, materialInstance);

            if (sub === 'MA03' || sub === 'MA09' || sub === 'MA17' || sub === 'MA19') {
                if (sub === 'MA03' || sub === 'MA09')
                    null; // globals.dlst.dComIfGd_setListDarkBG();
                else if (sub === 'MA19')
                    globals.dlst.dComIfGd_setListInvisisble();

                if (sub === 'MA09') {
                    // patch fog block
                    // materialInstance.materialData.material.gxMaterial.ropInfo.fogType
                } else {
                    // patch fog block
                    // materialInstance.materialData.material.gxMaterial.ropInfo.fogType

                    materialInstance.setColorOverride(ColorKind.C1, envLight.bgAmbCol[2]);

                    const k3 = colorNewCopy(TransparentBlack, envLight.bgAmbCol[1].a);
                    materialInstance.setColorOverride(ColorKind.K3, k3);
                }
            }

            if (sub === 'MA07') {
                // const bright = envLight.thunderEff.field_0x08 * (100.0 / 255.0);
                // const color = colorNewFromRGBA(bright, bright, bright);
                // materialInstance.setColorOverride(ColorKind.C0, color);
            }

            if (sub === 'MA10' || sub === 'MA02') {
                globals.dlst.dComIfGd_setListInvisisble();
                // set viewproj effect mtx based on whether this is MA10 or MA02
                // TODO(jstpierre): This require some work in J3DGraphBase because ViewProj
                // assumes that the effectMtx is predetermined for us...
            }

            if (sub === 'MA00' || sub === 'MA01' || sub === 'MA04' || sub === 'MA16') {
                const color = colorNewCopy(TransparentBlack);
                color.r = envLight.cloudShadowDensity;

                if (sub === 'MA01') {
                    if (envLight.cameraInWater) {
                        color.a = 1.0;
                        // patch alpha comp / zmode
                    } else {
                        // patch alpha comp / zmode
                    }
                }

                materialInstance.setColorOverride(ColorKind.K1, color);
            }

            if (sub === 'MA11') {
                if (dKy_darkworld_check(globals)) {
                    // globals.dlst.dComIfGd_setListDarkBG();

                    const c1 = colorNewCopy(TransparentBlack);
                    c1.r = 170 / 255;
                    c1.g = 160 / 255;
                    c1.b = 255 / 255;
                    c1.a = 255 / 255;
                    materialInstance.setColorOverride(ColorKind.C1, c1);

                    const c2 = colorNewCopy(TransparentBlack);
                    c2.r = 50 / 255;
                    c2.g = 20 / 255;
                    c2.b = 90 / 255;
                    c2.a = 255 / 255;
                    materialInstance.setColorOverride(ColorKind.C2, c2);
                } else {
                    const c1 = colorNewCopy(TransparentBlack);
                    c1.r = 120 / 255;
                    c1.g = 90 / 255;
                    c1.b = 180 / 255;
                    c1.a = 255 / 255;

                    if (globals.renderer.currentLayer == 1)
                        c1.a = 0.0;

                    materialInstance.setColorOverride(ColorKind.C1, c1);

                    const c2 = colorNewCopy(TransparentBlack);
                    c2.r = 40 / 255;
                    c2.g = 30 / 255;
                    c2.b = 65 / 255;
                    c2.a = 255 / 255;
                    materialInstance.setColorOverride(ColorKind.C2, c2);

                    // kytag08 effect mtx
                }
            } else if (sub === 'MA20') {
                // patch fog block

                const c1 = colorNewCopy(envLight.bgAmbCol[3], 1.0);
                materialInstance.setColorOverride(ColorKind.C1, c1);

                const texMtx = materialInstance.materialData.material.texMatrices[2];
                if (texMtx !== null) {
                    const target = vec3.clone(globals.playerPosition);
                    target[1] = -14770;

                    const eye = vec3.clone(globals.playerPosition);
                    eye[1] = -14570;

                    projectionMatrixForLightPerspective(texMtx.effectMatrix, 170.0 * MathConstants.DEG_TO_RAD, 1.0, 1.5, 1.5, 0.0, 0.0);
                    const lookAt = mat4.create();
                    mat4.lookAt(lookAt, eye, target, Vec3UnitY);
                    mat4.mul(texMtx.effectMatrix, texMtx.effectMatrix, lookAt);
                }
            } else if (sub === 'MA13') {
                materialInstance.setColorOverride(ColorKind.C1, envLight.bgAmbCol[3]);
            } else if (sub === 'MA14') {
                materialInstance.setColorOverride(ColorKind.C1, envLight.fogCol);
                const k3 = colorNewCopy(TransparentBlack, envLight.bgAmbCol[3].a);
                materialInstance.setColorOverride(ColorKind.K3, k3);
            } else if (sub === 'MA16') {
                materialInstance.setColorOverride(ColorKind.C1, envLight.bgAmbCol[1]);
                const k3 = colorNewCopy(TransparentBlack, envLight.bgAmbCol[3].a);
                materialInstance.setColorOverride(ColorKind.K3, k3);
            }
        } else if (name.slice(3, 10) === 'Rainbow') {
            // TODO: K3
        }
    }
}

// custom for noclip
export function dKy_reinitLight(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    envcolor_init(globals);
    vec3.set(envLight.plightNearPos, 0, 0, 0);

    dKy_setLight_init();
    dKy_Sound_init(envLight);
    dungeonlight_init(envLight);
    dKy_setLight_nowroom(globals, globals.mStayNo);

    envLight.nextTime = -1.0;
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
        dKyw_wind_set(globals);
        dungeonlight_init(envLight);
        dKy_setLight_nowroom(globals, globals.mStayNo);

        envLight.nextTime = -1.0;
        return cPhs__Status.Next;
    }

    public override execute(globals: dGlobals, deltaTimeInFrames: number): void {
        // temporary until some better setup for handling twilight layers is done
        if (globals.stageName.startsWith("D_MN08")) {
            globals.world_dark = true;
        } else {
            globals.world_dark = false;
        }

        exeKankyo(globals, globals.g_env_light, deltaTimeInFrames);
        dKyw_wind_set(globals);
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
