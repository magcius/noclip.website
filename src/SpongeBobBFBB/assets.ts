
import { DataStream } from './util';
import { vec3, mat4, quat } from 'gl-matrix';
import { Color } from '../Color';

export interface LinkAsset {
    srcEvent: number;
    dstEvent: number;
    dstAssetID: number;
    param: number[];
    paramWidgetAssetID: number;
    chkAssetID: number;
}

const LinkAssetSize = 0x20;

function preLinkSize(linkCount: number, totalSize: number): number {
    return totalSize - (linkCount * LinkAssetSize);
}

function readLinks(stream: DataStream, base: BaseAsset) {
    for (let i = 0; i < base.linkCount; i++) {
        const srcEvent = stream.readUInt16();
        const dstEvent = stream.readUInt16();
        const dstAssetID = stream.readUInt32();
        const param: number[] = [];
        for (let j = 0; j < 4; j++)
            param.push(stream.readFloat());
        const paramWidgetAssetID = stream.readUInt32();
        const chkAssetID = stream.readUInt32();
        base.links.push({ srcEvent, dstEvent, dstAssetID, param, paramWidgetAssetID, chkAssetID });
    }
}

export const enum BaseFlags {
    Enabled = 0x1,
    Persistent = 0x2,
    Valid = 0x4,
    CutsceneVisible = 0x8,
    ReceiveShadows = 0x10
}

export interface BaseAsset {
    id: number;
    baseType: number;
    linkCount: number;
    baseFlags: number;
    links: LinkAsset[];
}

export function readBaseAsset(stream: DataStream): BaseAsset {
    const id = stream.readUInt32();
    const baseType = stream.readUInt8();
    const linkCount = stream.readUInt8();
    const baseFlags = stream.readUInt16();
    const links: LinkAsset[] = [];
    return { id, baseType, linkCount, baseFlags, links };
}

export interface FogAsset extends BaseAsset {
    bkgndColor: number[];
    fogColor: number[];
    fogDensity: number;
    fogStart: number;
    fogStop: number;
    transitionTime: number;
    fogType: number;
    padFog: number[];
}

export function readFogAsset(stream: DataStream): FogAsset {
    const { id, baseType, linkCount, baseFlags, links } = readBaseAsset(stream);
    const bkgndColor: number[] = [];
    bkgndColor.push(stream.readUInt8());
    bkgndColor.push(stream.readUInt8());
    bkgndColor.push(stream.readUInt8());
    bkgndColor.push(stream.readUInt8());
    const fogColor: number[] = [];
    fogColor.push(stream.readUInt8());
    fogColor.push(stream.readUInt8());
    fogColor.push(stream.readUInt8());
    fogColor.push(stream.readUInt8());
    const fogDensity = stream.readFloat();
    const fogStart = stream.readFloat();
    const fogStop = stream.readFloat();
    const transitionTime = stream.readFloat();
    const fogType = stream.readUInt8();
    const padFog: number[] = [];
    padFog.push(stream.readUInt8());
    padFog.push(stream.readUInt8());
    padFog.push(stream.readUInt8());
    const fog: FogAsset = { id, baseType, linkCount, baseFlags, links, bkgndColor,
        fogColor, fogDensity, fogStart, fogStop, transitionTime, fogType, padFog };
    readLinks(stream, fog);
    return fog;
}

export const enum EntFlags {
    Visible = 0x1,
    Stackable = 0x2
}

export interface EntAsset extends BaseAsset {
    flags: number;
    subtype: number;
    pflags: number;
    moreFlags: number;
    pad: number;
    surfaceID: number;
    ang: vec3;
    pos: vec3;
    scale: vec3;
    redMult: number;
    greenMult: number;
    blueMult: number;
    seeThru: number;
    seeThruSpeed: number;
    modelInfoID: number;
    animListID: number;
}

const EntAssetSize = 0x54;

export function readEntAsset(stream: DataStream, extraSize: number): EntAsset {
    const { id, baseType, linkCount, baseFlags, links } = readBaseAsset(stream);
    const flags = stream.readUInt8();
    const subtype = stream.readUInt8();
    const pflags = stream.readUInt8();
    const moreFlags = stream.readUInt8();
    let pad = 0;
    if (preLinkSize(linkCount, stream.length) - extraSize === EntAssetSize) {
        // Beta ent assets don't have this pad field, so their pre-link size is always 0x50.
        pad = stream.readUInt8();
        stream.align(4);
    }
    const surfaceID = stream.readUInt32();
    const ang = stream.readVec3();
    const pos = stream.readVec3();
    const scale = stream.readVec3();
    const redMult = stream.readFloat();
    const greenMult = stream.readFloat();
    const blueMult = stream.readFloat();
    const seeThru = stream.readFloat();
    const seeThruSpeed = stream.readFloat();
    const modelInfoID = stream.readUInt32();
    const animListID = stream.readUInt32();
    return { id, baseType, linkCount, baseFlags, links, flags, subtype, pflags, moreFlags, pad, surfaceID,
        ang, pos, scale, redMult, greenMult, blueMult, seeThru, seeThruSpeed, modelInfoID, animListID };
}

interface MotionERData {
    ret_pos: vec3;
    ext_dpos: vec3;
    ext_tm: number;
    ext_wait_tm: number;
    ret_tm: number;
    ret_wait_tm: number;
}
interface MotionOrbitData {
    center: vec3;
    w: number;
    h: number;
    period: number;
}
interface MotionSplineData {
    unknown: number;
}
interface MotionMPData {
    flags: number;
    mp_id: number;
    speed: number;
}
interface MotionMechData {
    type: number;
    flags: number;
    sld_axis: number;
    rot_axis: number;
    sld_dist: number;
    sld_tm: number;
    sld_acc_tm: number;
    sld_dec_tm: number;
    rot_dist: number;
    rot_tm: number;
    rot_acc_tm: number;
    rot_dec_tm: number;
    ret_delay: number;
    post_ret_delay: number;
}
interface MotionPenData {
    flags: number;
    plane: number;
    pad: number[];
    len: number;
    range: number;
    period: number;
    phase: number;
}

export type MotionData = MotionERData | MotionOrbitData | MotionSplineData | MotionMPData | MotionMechData | MotionPenData;

export interface MotionAsset {
    type: number;
    use_banking: number;
    flags: number;
    data: MotionData | undefined;
}

const MotionAssetSize = 0x30;

export enum MotionType {
    ExtendRetract,
    Orbit,
    Spline,
    MovePoint,
    Mechanism,
    Pendulum,
    None
}

export function readMotionAsset(stream: DataStream): MotionAsset {
    const type = stream.readUInt8();
    const use_banking = stream.readUInt8();
    const flags = stream.readUInt16();
    let data: MotionData | undefined;

    const dataEnd = stream.offset + 0x2C;

    switch (type) {
        case MotionType.ExtendRetract: {
            const ret_pos = stream.readVec3();
            const ext_dpos = stream.readVec3();
            const ext_tm = stream.readFloat();
            const ext_wait_tm = stream.readFloat();
            const ret_tm = stream.readFloat();
            const ret_wait_tm = stream.readFloat();
            data = { ret_pos, ext_dpos, ext_tm, ext_wait_tm, ret_tm, ret_wait_tm } as MotionERData;
            break;
        }
        case MotionType.Orbit: {
            const center = stream.readVec3();
            const w = stream.readFloat();
            const h = stream.readFloat();
            const period = stream.readFloat();
            data = { center, w, h, period } as MotionOrbitData;
            break;
        }
        case MotionType.Spline: {
            const unknown = stream.readInt32();
            data = { unknown } as MotionSplineData;
            break;
        }
        case MotionType.MovePoint: {
            const flags = stream.readUInt32();
            const mp_id = stream.readUInt32();
            const speed = stream.readFloat();
            data = { flags, mp_id, speed } as MotionMPData;
            break;
        }
        case MotionType.Mechanism: {
            const type = stream.readUInt8();
            const flags = stream.readUInt8();
            const sld_axis = stream.readUInt8();
            const rot_axis = stream.readUInt8();
            const sld_dist = stream.readFloat();
            const sld_tm = stream.readFloat();
            const sld_acc_tm = stream.readFloat();
            const sld_dec_tm = stream.readFloat();
            const rot_dist = stream.readFloat();
            const rot_tm = stream.readFloat();
            const rot_acc_tm = stream.readFloat();
            const rot_dec_tm = stream.readFloat();
            const ret_delay = stream.readFloat();
            const post_ret_delay = stream.readFloat();
            data = { type, flags, sld_axis, rot_axis, sld_dist, sld_tm, sld_acc_tm, sld_dec_tm, rot_dist, rot_tm, rot_acc_tm, rot_dec_tm, ret_delay, post_ret_delay } as MotionMechData;
            break;
        }
        case MotionType.Pendulum: {
            const flags = stream.readUInt8();
            const plane = stream.readUInt8();
            const pad: number[] = [];
            pad.push(stream.readUInt8());
            pad.push(stream.readUInt8());
            const len = stream.readFloat();
            const range = stream.readFloat();
            const period = stream.readFloat();
            const phase = stream.readFloat();
            data = { flags, plane, pad, len, range, period, phase };
            break;
        }
        case MotionType.None:
            break;
        default:
            console.warn(`Unknown motion type ${type}`);
    }

    stream.offset = dataEnd;

    return { type, use_banking, flags, data };
}

export interface ButtonAsset {
    ent: EntAsset;
    modelPressedInfoID: number;
    actMethod: number;
    initButtonState: number;
    isReset: number;
    resetDelay: number;
    buttonActFlags: number;
    motion: MotionAsset;
}

export function readButtonAsset(stream: DataStream): ButtonAsset {
    const ent = readEntAsset(stream, 0x18 + MotionAssetSize);
    const modelPressedInfoID = stream.readUInt32();
    const actMethod = stream.readUInt32();
    const initButtonState = stream.readInt32();
    const isReset = stream.readInt32();
    const resetDelay = stream.readFloat();
    const buttonActFlags = stream.readUInt32();
    const motion = readMotionAsset(stream);
    readLinks(stream, ent);
    return { ent, modelPressedInfoID, actMethod, initButtonState, isReset, resetDelay, buttonActFlags, motion };
}

interface PlatformERData { nodata: number;}
interface PlatformOrbitData { nodata: number; }
interface PlatformSplineData { nodata: number; }
interface PlatformMPData { nodata: number; }
interface PlatformMechData { nodata: number; }
interface PlatformPenData { nodata: number; }
interface PlatformConvBeltData {
    speed: number;
}
interface PlatformFallingData {
    speed: number;
    bustModelID: number;
}
interface PlatformFRData {
    fspeed: number;
    rspeed: number;
    ret_delay: number;
    post_ret_delay: number;
}
interface PlatformBreakawayData {
    ba_delay: number;
    bustModelID: number;
    reset_delay: number;
    breakflags: number;
}
interface PlatformSpringboardData {
    jmph: number[];
    jmpbounce: number;
    animID: number[];
    jmpdir: vec3;
    springflags: number;
}
interface PlatformTeeterData {
    itilt: number;
    maxtilt: number;
    invmass: number;
}
interface PlatformPaddleData {
    startOrient: number;
    countOrient: number;
    orientLoop: number;
    orient: number[];
    paddleFlags: number;
    rotateSpeed: number;
    accelTime: number;
    decelTime: number;
    hubRadius: number;
}
interface PlatformFMData { nothingyet: number; }

export type PlatformData = PlatformERData | PlatformOrbitData | PlatformSplineData | PlatformMPData |
    PlatformMechData | PlatformPenData | PlatformConvBeltData | PlatformFallingData | PlatformFRData |
    PlatformBreakawayData | PlatformSpringboardData | PlatformTeeterData | PlatformPaddleData | PlatformFMData;

export enum PlatformType {
    Platform = 0,
    ExtendRetract = 0,
    Orbit,
    Spline,
    MovePoint,
    Mechanism,
    Pendulum,
    ConveyorBelt,
    Falling,
    ForwardReverse,
    Breakaway,
    Springboard,
    TeeterTotter,
    Paddle,
    FullyManipulable
}

export interface PlatformAsset {
    ent: EntAsset;
    type: number;
    pad: number;
    flags: number;
    data: PlatformData | undefined;
    motion: MotionAsset;
}

export function readPlatformAsset(stream: DataStream): PlatformAsset {
    const ent = readEntAsset(stream, 0x3C + MotionAssetSize);
    const type = stream.readUInt8();
    const pad = stream.readUInt8();
    const flags = stream.readUInt16();
    let data: PlatformData | undefined;

    const dataEnd = stream.offset + 0x38;

    switch (type) {
        case PlatformType.ExtendRetract: {
            const nodata = stream.readInt32();
            data = { nodata } as PlatformERData;
            break;
        }
        case PlatformType.Orbit: {
            const nodata = stream.readInt32();
            data = { nodata } as PlatformOrbitData;
            break;
        }
        case PlatformType.Spline: {
            const nodata = stream.readInt32();
            data = { nodata } as PlatformSplineData;
            break;
        }
        case PlatformType.MovePoint: {
            const nodata = stream.readInt32();
            data = { nodata } as PlatformMPData;
            break;
        }
        case PlatformType.Mechanism: {
            const nodata = stream.readInt32();
            data = { nodata } as PlatformMechData;
            break;
        }
        case PlatformType.Pendulum: {
            const nodata = stream.readInt32();
            data = { nodata } as PlatformPenData;
            break;
        }
        case PlatformType.ConveyorBelt: {
            const speed = stream.readFloat();
            data = { speed } as PlatformConvBeltData;
            break;
        }
        case PlatformType.Falling: {
            const speed = stream.readFloat();
            const bustModelID = stream.readUInt32();
            data = { speed, bustModelID } as PlatformFallingData;
            break;
        }
        case PlatformType.ForwardReverse: {
            const fspeed = stream.readFloat();
            const rspeed = stream.readFloat();
            const ret_delay = stream.readFloat();
            const post_ret_delay = stream.readFloat();
            data = { fspeed, rspeed, ret_delay, post_ret_delay } as PlatformFRData;
            break;
        }
        case PlatformType.Breakaway: {
            const ba_delay = stream.readFloat();
            const bustModelID = stream.readUInt32();
            const reset_delay = stream.readFloat();
            const breakflags = stream.readUInt32();
            data = { ba_delay, bustModelID, reset_delay, breakflags } as PlatformBreakawayData;
            break;
        }
        case PlatformType.Springboard: {
            const jmph: number[] = [];
            jmph.push(stream.readFloat());
            jmph.push(stream.readFloat());
            jmph.push(stream.readFloat());
            const jmpbounce = stream.readFloat();
            const animID: number[] = [];
            animID.push(stream.readUInt32());
            animID.push(stream.readUInt32());
            animID.push(stream.readUInt32());
            const jmpdir = stream.readVec3();
            const springflags = stream.readUInt32();
            data = { jmph, jmpbounce, animID, jmpdir, springflags } as PlatformSpringboardData;
            break;
        }
        case PlatformType.TeeterTotter: {
            const itilt = stream.readFloat();
            const maxtilt = stream.readFloat();
            const invmass = stream.readFloat();
            data = { itilt, maxtilt, invmass };
            break;
        }
        case PlatformType.Paddle: {
            const startOrient = stream.readInt32();
            const countOrient = stream.readInt32();
            const orientLoop = stream.readFloat();
            const orient: number[] = [];
            orient.push(stream.readFloat());
            orient.push(stream.readFloat());
            orient.push(stream.readFloat());
            orient.push(stream.readFloat());
            orient.push(stream.readFloat());
            orient.push(stream.readFloat());
            const paddleFlags = stream.readUInt32();
            const rotateSpeed = stream.readFloat();
            const accelTime = stream.readFloat();
            const decelTime = stream.readFloat();
            const hubRadius = stream.readFloat();
            data = { startOrient, countOrient, orientLoop, orient, paddleFlags, rotateSpeed, accelTime, decelTime, hubRadius } as PlatformPaddleData;
            break;
        }
        case PlatformType.FullyManipulable: {
            const nothingyet = stream.readInt32();
            data = { nothingyet } as PlatformFMData;
            break;
        }
        default:
            console.warn(`Unknown platform type ${type}`);
    }

    stream.offset = dataEnd;

    const motion = readMotionAsset(stream);
    readLinks(stream, ent);

    return { ent, type, pad, flags, data, motion };
}

export interface PlayerAsset {
    ent: EntAsset;
    lightKitID: number;
}

export function readPlayerAsset(stream: DataStream): PlayerAsset {
    const ent = readEntAsset(stream, 0x4);
    readLinks(stream, ent);
    const lightKitID = stream.readUInt32();

    return { ent, lightKitID };
}

export interface SimpleObjAsset {
    ent: EntAsset;
    animSpeed: number;
    initAnimState: number;
    collType: number;
    flags: number;
}

export function readSimpleObjAsset(stream: DataStream): SimpleObjAsset {
    const ent = readEntAsset(stream, 0xC);
    const animSpeed = stream.readFloat();
    const initAnimState = stream.readUInt32();
    const collType = stream.readUInt8();
    const flags = stream.readUInt8();
    stream.align(4);
    readLinks(stream, ent);
    return { ent, animSpeed, initAnimState, collType, flags };
}

export interface LightKitLight {
    type: number;
    color: Color;
    matrix: mat4;
    radius: number;
    angle: number;
    platLight: number; // RpLight*
}

export interface LightKit {
    tagID: number;
    groupID: number;
    lightCount: number;
    lightList: number; // xLightKitLight*
    lightListArray: LightKitLight[];
}

export function readLightKit(stream: DataStream): LightKit {
    const tagID = stream.readUInt32();
    const groupID = stream.readUInt32();
    const lightCount = stream.readUInt32();
    const lightList = stream.readUInt32();
    const lightListArray: LightKitLight[] = [];
    for (let i = 0; i < lightCount; i++) {
        const type = stream.readUInt32();
        const color = stream.readColor();
        const matrix = stream.readRwMatrix();
        const radius = stream.readFloat();
        const angle = stream.readFloat();
        const platLight = stream.readUInt32();
        lightListArray.push({ type, color, matrix, radius, angle, platLight });
    }
    return { tagID, groupID, lightCount, lightList, lightListArray };
}

export const enum PipeCullMode {
    Unknown0,
    None,
    Back,
    Unknown3 // front+back?
}

// RwBlendFunction
export const enum PipeBlendFunction {
    NA,
    Zero,
    One,
    SrcColor,
    InvSrcColor,
    SrcAlpha,
    InvSrcAlpha,
    DestAlpha,
    InvDestAlpha,
    DestColor,
    InvDestColor,
    SrcAlphaSat
}

export class PipeInfoFlags {
    constructor(public flags: number) {}

    public get noZWrite(): boolean {
        return ((this.flags & 0xC) >>> 2) === 1;
    }

    public get cullMode(): PipeCullMode {
        return (this.flags & 0x30) >>> 4;
    }

    public get noLighting(): boolean {
        return ((this.flags & 0xC0) >>> 6) == 1;
    }

    public get srcBlend(): PipeBlendFunction {
        return (this.flags & 0xF00) >>> 8;
    }

    public get dstBlend(): PipeBlendFunction {
        return (this.flags & 0xF000) >>> 12;
    }

    public get noFog(): boolean {
        return ((this.flags & 0x10000) >>> 16) === 1;
    }

    public get unknownF00000(): number {
        return (this.flags & 0xF00000) >>> 20;
    }

    public get alphaCompare(): number {
        return (this.flags & 0xFF000000) >>> 24;
    }
}

export interface PipeInfo {
    ModelHashID: number;
    SubObjectBits: number;
    PipeFlags: PipeInfoFlags;
}

export function readPipeInfoTable(stream: DataStream): PipeInfo[] {
    const entryCount = stream.readUInt32();
    const entries: PipeInfo[] = [];
    for (let i = 0; i < entryCount; i++) {
        const ModelHashID = stream.readUInt32();
        const SubObjectBits = stream.readUInt32();
        const PipeFlags = new PipeInfoFlags(stream.readUInt32());
        entries.push({ ModelHashID, SubObjectBits, PipeFlags });
    }
    return entries;
}