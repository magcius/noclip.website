
import { Color, White, colorNewCopy, colorFromRGBA8, colorNewFromRGBA8 } from "../Color.js";
import { DZS } from "./d_resorce.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { nArray, assert, readString } from "../util.js";
import { dKy_lightdir_set, dKy_tevstr_c } from "./d_kankyo.js";
import { vec3 } from "gl-matrix";
import { Endianness } from "../endian.js";
import { dGlobals } from "./ztp_scenes.js";
import { fopAcM_prm_class, fpcLy_CurrentLayer, fpcSCtRq_Request } from "./framework.js";
import * as GX from "../gx/gx_enum.js";

export class dPath__Point {
    public arg0: number;
    public arg1: number;
    public arg2: number;
    public arg3: number;
    public pos = vec3.create();

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        this.arg0 = view.getUint8(0x00);
        this.arg1 = view.getUint8(0x01);
        this.arg2 = view.getUint8(0x02);
        this.arg3 = view.getUint8(0x03);
        this.pos[0] = view.getFloat32(0x04);
        this.pos[1] = view.getFloat32(0x08);
        this.pos[2] = view.getFloat32(0x0C);
        return 0x10;
    }
}

export class dPath {
    public nextPathId: number;
    public arg0: number;
    public loopFlag: number;
    public points: dPath__Point[] = [];

    public parse(buffer: ArrayBufferSlice, points: dPath__Point[]): number {
        const view = buffer.createDataView();
        const pointCount = view.getUint16(0x00);
        this.nextPathId = view.getUint16(0x02);
        this.arg0 = view.getUint8(0x03);
        this.loopFlag = view.getUint8(0x04);
        const pointOffs = view.getUint32(0x08);
        assert((pointOffs % 0x10) === 0);
        const firstPoint = (pointOffs / 0x10) | 0;
        this.points = points.slice(firstPoint, firstPoint + pointCount);
        return 0x0C;
    }
}

class dStage_dt {
    public roomNo: number = -1;
    public rpat: dPath[] = [];
    public rppn: dPath__Point[] = [];

    public lgtv: stage_pure_lightvec_info_class[][] = [];
    public lght: stage_plight_info_class[] = [];
    public pale: stage_palet_info_class[][] = [];
    public colo: stage_pselect_info_class[][] = [];
    public virt: stage_vrbox_info_class[][] = [];
    public envr: stage_envr_info_class[][] = [];
    public elst: dStage_Elst_c[] = [];
}

export class stage_palet_info_class__DifAmb {
    public C0: Color; // Dif
    public K0: Color; // Amb

    constructor(baseColor: Color) {
        this.C0 = colorNewCopy(baseColor);
        this.K0 = colorNewCopy(baseColor);
    }
}

function colorFromRGB8(dst: Color, n: number): void {
    colorFromRGBA8(dst, (n & 0xFFFFFF00) | 0xFF);
}

export class stage_palet_info_class {
    public actorAmbCol = colorNewCopy(White);
    public bgAmbCol = nArray(4, () => colorNewCopy(White));
    public lightCol = nArray(6, () => colorNewCopy(White));
    public fogCol = colorNewCopy(White);
    public fogStartZ: number;
    public fogEndZ: number;

    public virtIdx: number;
    public terrainLightInfluence: number;
    public cloudShadowDensity: number;
    public unk_2f: number;
    public bloomTblIdx: number;
    public bgAmbColor1A: number;
    public bgAmbColor2A: number;
    public bgAmbColor3A: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        colorFromRGB8(this.actorAmbCol, view.getUint32(0x00));
        colorFromRGB8(this.bgAmbCol[0], view.getUint32(0x03));
        colorFromRGB8(this.bgAmbCol[1], view.getUint32(0x06));
        colorFromRGB8(this.bgAmbCol[2], view.getUint32(0x09));
        colorFromRGB8(this.bgAmbCol[3], view.getUint32(0x0C));
        colorFromRGB8(this.lightCol[0], view.getUint32(0x0F));
        colorFromRGB8(this.lightCol[1], view.getUint32(0x12));
        colorFromRGB8(this.lightCol[2], view.getUint32(0x15));
        colorFromRGB8(this.lightCol[3], view.getUint32(0x18));
        colorFromRGB8(this.lightCol[4], view.getUint32(0x1B));
        colorFromRGB8(this.lightCol[5], view.getUint32(0x1E));
        colorFromRGB8(this.fogCol, view.getUint32(0x21));
        this.fogStartZ = view.getFloat32(0x24);
        this.fogEndZ = view.getFloat32(0x28);
        this.virtIdx = view.getUint8(0x2C);
        this.terrainLightInfluence = view.getUint8(0x2D) / 100;
        this.cloudShadowDensity = view.getUint8(0x2E) / 255;
        this.unk_2f = view.getUint8(0x2F);
        this.bloomTblIdx = view.getUint8(0x30);
        this.bgAmbColor1A = view.getUint8(0x31) / 255;
        this.bgAmbColor2A = view.getUint8(0x32) / 255;
        this.bgAmbColor3A = view.getUint8(0x33) / 255;
        return 0x34;
    }
}

export class stage_pselect_info_class {
    public palIdx: Uint8Array;
    public changeRate: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        this.palIdx = buffer.createTypedArray(Uint8Array, 0x00, 0x08);
        this.changeRate = view.getFloat32(0x08);
        return 0x0C;
    }
}

export class stage_vrbox_info_class {
    public skyCol = colorNewCopy(White);
    public kumoCol = colorNewCopy(White);
    public shitaGumoCol = colorNewCopy(White);
    public shimoUneiCol = colorNewCopy(White);
    public kasumiCol = colorNewCopy(White);
    public okuKasumiCol = colorNewCopy(White);

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        colorFromRGB8(this.skyCol, view.getUint32(0x00));
        colorFromRGB8(this.kumoCol, view.getUint32(0x03));
        colorFromRGB8(this.shitaGumoCol, view.getUint32(0x06));
        colorFromRGB8(this.shimoUneiCol, view.getUint32(0x09));
        this.kumoCol.a = view.getUint8(0x0B) / 0xFF;
        colorFromRGBA8(this.kasumiCol, view.getUint32(0x0D));
        colorFromRGBA8(this.okuKasumiCol, view.getUint32(0x11));
        return 0x15;
    }
}

export class stage_envr_info_class {
    public pselIdx: Uint8Array;

    public parse(buffer: ArrayBufferSlice): number {
        this.pselIdx = buffer.createTypedArray(Uint8Array, 0x00, 0x41);
        return 0x41;
    }
}

export class dStage_Elst_c {
    public layers = new Array(15);

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        for (let i = 0; i < 15; i++) {
            this.layers[i] = view.getUint8(i);
        }

        return 0xF;
    }
}

export class stage_stag_info_class {
    public nearPlane: number;
    public farPlane: number;
    public cameraType: number;
    public roomTypeAndSchBit: number;

    public particleNo = new Array(16);

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        this.nearPlane = view.getFloat32(0x00);
        this.farPlane = view.getFloat32(0x04);
        this.cameraType = view.getUint8(0x8);
        this.roomTypeAndSchBit = view.getUint32(0x0C);

        for (let i = 0; i < 16; i++) {
            this.particleNo[i] = view.getUint8(0x2C + i);
        }

        return 0x3C;
    }
}

export function dStage_stagInfo_GetSTType(stagInfo: stage_stag_info_class): number {
    return (stagInfo.roomTypeAndSchBit >> 16) & 7;
}

export function dStage_stagInfo_GetArg0(stagInfo: stage_stag_info_class): number {
    return (stagInfo.roomTypeAndSchBit >> 0x14) & 0xFF;
}

export class dStage_Multi_c {
    public transX: number;
    public transZ: number;
    public rotY: number;
    public roomNo: number;
    public waveMax: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        this.transX = view.getFloat32(0x00);
        this.transZ = view.getFloat32(0x04);
        this.rotY = view.getUint16(0x08);
        this.roomNo = view.getUint8(0x0A);
        this.waveMax = view.getInt8(0x0B);
        return 0x0C;
    }
}

export class dStage_FileList_dt_c {
    public param: number;
    public skyboxY: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        this.param = view.getUint32(0x00);
        this.skyboxY = view.getFloat32(0x04);
        return 0x20;
    }
}

export class stage_pure_lightvec_info_class {
    public pos = vec3.create();
    public radius: number = 0; // refDist
    public dir = vec3.create();
    public spotFn: GX.SpotFunction = GX.SpotFunction.OFF;
    public spotCutoff: number = 0;
    public distFn: GX.DistAttnFunction = GX.DistAttnFunction.OFF;
    public switch: number;
    public fluctuation: number = 0;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        const posX = view.getFloat32(0x00);
        const posY = view.getFloat32(0x04);
        const posZ = view.getFloat32(0x08);
        vec3.set(this.pos, posX, posY, posZ);
        this.radius = view.getFloat32(0x0C);
        const dirX = view.getFloat32(0x10);
        const dirY = view.getFloat32(0x14);
        dKy_lightdir_set(this.dir, dirX, dirY);
        this.spotCutoff = view.getFloat32(0x18);
        this.fluctuation = view.getUint8(0x1B);
        this.spotFn = view.getUint8(0x1C);
        this.distFn = view.getUint8(0x1D);
        this.switch = view.getUint8(0x1E);
        return 0x20;
    }
}

export class stage_plight_info_class {
    public pos = vec3.create();
    public radius: number = 0;
    public color: Color = colorNewCopy(White);
    public fluctuation: number = 0;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        const posX = view.getFloat32(0x00);
        const posY = view.getFloat32(0x04);
        const posZ = view.getFloat32(0x08);
        vec3.set(this.pos, posX, posY, posZ);
        this.radius = view.getFloat32(0x0C);
        this.color = colorNewFromRGBA8(view.getUint32(0x18));
        this.color.a = 1.0;
        this.fluctuation = view.getUint8(0x01B);
        return 0x1C;
    }
}

export class roomRead_class {
    public isTimePass: boolean = false;
    public reverb: number = 0x00;
    public table: Uint8Array;

    public parse(buffer: ArrayBufferSlice, fileData: ArrayBufferSlice): void {
        const view = buffer.createDataView();

        const tableCount = view.getUint8(0x00);
        this.reverb = view.getUint8(0x01);
        this.isTimePass = !!view.getUint8(0x02);

        const tableOffs = view.getUint32(0x04);
        this.table = fileData.createTypedArray(Uint8Array, tableOffs, tableCount, Endianness.BIG_ENDIAN);
    }
}

type dStage_dt_decode_handlerCB<T> = (globals: dGlobals, dt: T, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number) => void;
type dStage_dt_decode_handler<T> = { [k: string]: dStage_dt_decode_handlerCB<T> };

export function dStage_dt_decode<T extends dStage_dt>(globals: dGlobals, dt: T, dzs: DZS, handlers: dStage_dt_decode_handler<T>, layer: number = -1): void {
    for (const type in handlers) {
        const h = dzs.headers.get(type);
        if (h === undefined) {
            continue;
        }

        const cb = handlers[type];
        cb(globals, dt, dzs.buffer.slice(h.offs), h.count, dzs.buffer, layer);
    }
}

export function dStage_actorCreate(globals: dGlobals, processNameStr: string, actor: fopAcM_prm_class): void {
    // Attempt to find an implementation of this Actor in our table
    const objName = globals.dStage_searchName(processNameStr);

    if (objName === null) {
        // Game specified a completely bogus actor. For funsies, what was it?
        console.log(`Stage data references missing actor: ${processNameStr}`);
        return;
    }

    actor.gbaName = objName.gbaName;
    actor.subtype = objName.subtype;

    // This is supposed to be executing in the context of the room or stage, I believe.
    assert(fpcLy_CurrentLayer(globals.frameworkGlobals) === globals.scnPlay.layer);
    const pcId = fpcSCtRq_Request(globals.frameworkGlobals, null, objName.pcName, actor);
    assert(pcId !== null);
}

function dStage_actorInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number = -1): void {
    let offs = 0;
    const view = buffer.createDataView();
    for (let i = 0; i < count; i++) {
        const name = readString(buffer, offs + 0x00, 0x08, true);
        const parameter = view.getUint32(offs + 0x08, false);
        const posX = view.getFloat32(offs + 0x0C);
        const posY = view.getFloat32(offs + 0x10);
        const posZ = view.getFloat32(offs + 0x14);
        const angleX = view.getInt16(offs + 0x18);
        const angleY = view.getInt16(offs + 0x1A);
        const angleZ = view.getInt16(offs + 0x1C);
        const enemyNo = view.getUint16(offs + 0x1E);

        const prm: fopAcM_prm_class = {
            parameters: parameter,
            roomNo: dt.roomNo,
            pos: vec3.fromValues(posX, posY, posZ),
            rot: vec3.fromValues(angleX, angleY, angleZ),
            enemyNo,
            scale: vec3.fromValues(1, 1, 1),
            subtype: 0,
            gbaName: 0,
            parentPcId: 0xFFFFFFFF,
            layer,
        };

        dStage_actorCreate(globals, name, prm);
        offs += 0x20;
    }
}

function dStage_tgscInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number = -1): void {
    let offs = 0;
    const view = buffer.createDataView();
    for (let i = 0; i < count; i++) {
        const name = readString(buffer, offs + 0x00, 0x08, true);
        const parameter = view.getUint32(offs + 0x08, false);
        const posX = view.getFloat32(offs + 0x0C);
        const posY = view.getFloat32(offs + 0x10);
        const posZ = view.getFloat32(offs + 0x14);
        const angleX = view.getInt16(offs + 0x18);
        const angleY = view.getInt16(offs + 0x1A);
        const angleZ = view.getInt16(offs + 0x1C);
        const enemyNo = view.getUint16(offs + 0x1E);
        const scaleX = view.getUint8(offs + 0x20) / 10.0;
        const scaleY = view.getUint8(offs + 0x21) / 10.0;
        const scaleZ = view.getUint8(offs + 0x22) / 10.0;
        // const pad = view.getUint8(offs + 0x23);

        const prm: fopAcM_prm_class = {
            parameters: parameter,
            roomNo: dt.roomNo,
            pos: vec3.fromValues(posX, posY, posZ),
            rot: vec3.fromValues(angleX, angleY, angleZ),
            enemyNo,
            scale: vec3.fromValues(scaleX, scaleY, scaleZ),
            subtype: 0,
            gbaName: 0,
            parentPcId: 0xFFFFFFFF,
            layer,
        };

        dStage_actorCreate(globals, name, prm);
        offs += 0x24;
    }
}

function actorlayerLoader(globals: dGlobals, dt: dStage_dt, dzs: DZS): void {
    const actrLayer = ['ACT0', 'ACT1', 'ACT2', 'ACT3', 'ACT4', 'ACT5', 'ACT6', 'ACT7', 'ACT8', 'ACT9', 'ACTa', 'ACTb', 'ACTc', 'ACTd', 'ACTe'];
    const scobLayer = ['SCO0', 'SCO1', 'SCO2', 'SCO3', 'SCO4', 'SCO5', 'SCO6', 'SCO7', 'SCO8', 'SCO9', 'SCOa', 'SCOb', 'SCOc', 'SCOd', 'SCOe'];
    const doorLayer = ['Doo0', 'Doo1', 'Doo2', 'Doo3', 'Doo4', 'Doo5', 'Doo6', 'Doo7', 'Doo8', 'Doo9', 'Dooa', 'Doob', 'Dooc', 'Dood', 'Dooe'];

    for (let i = 0; i < 15; i++) {
        dStage_dt_decode(globals, dt, dzs, {
            [actrLayer[i]]: dStage_actorInit,
            [scobLayer[i]]: dStage_tgscInfoInit,
            [doorLayer[i]]: dStage_tgscInfoInit,
        }, i);
    }
}

function envLayerLoader(globals: dGlobals, dt: dStage_dt, dzs: DZS): void {
    const lgtLayer = ['LGT0', 'LGT1', 'LGT2', 'LGT3', 'LGT4', 'LGT5', 'LGT6', 'LGT7', 'LGT8', 'LGT9', 'LGTa', 'LGTb', 'LGTc', 'LGTd', 'LGTe'];
    const envrLayer = ['Env0', 'Env1', 'Env2', 'Env3', 'Env4', 'Env5', 'Env6', 'Env7', 'Env8', 'Env9', 'Enva', 'Envb', 'Envc', 'Envd', 'Enve'];
    const colLayer = ['Col0', 'Col1', 'Col2', 'Col3', 'Col4', 'Col5', 'Col6', 'Col7', 'Col8', 'Col9', 'Cola', 'Colb', 'Colc', 'Cold', 'Cole'];
    const palLayer = ['PAL0', 'PAL1', 'PAL2', 'PAL3', 'PAL4', 'PAL5', 'PAL6', 'PAL7', 'PAL8', 'PAL9', 'PALa', 'PALb', 'PALc', 'PALd', 'PALe'];
    const vrbLayer = ['VRB0', 'VRB1', 'VRB2', 'VRB3', 'VRB4', 'VRB5', 'VRB6', 'VRB7', 'VRB8', 'VRB9', 'VRBa', 'VRBb', 'VRBc', 'VRBd', 'VRBe'];

    let max = 1;
    if (dt.elst.length > 0) {
        max = 15;
    }

    for (let i = 0; i < max; i++) {
        dStage_dt_decode(globals, dt, dzs, {
            [lgtLayer[i]]: dStage_lgtvInfoInit,
            [envrLayer[i]]: dStage_envrInfoInit,
            [colLayer[i]]: dStage_pselectInfoInit,
            [palLayer[i]]: dStage_paletInfoInit,
            [vrbLayer[i]]: dStage_vrboxInfoInit,
        }, i);
    }
}

function dStage_rppnInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const pt = new dPath__Point();
        offs += pt.parse(buffer.slice(offs));
        dt.rppn.push(pt);
    }
}

function dStage_rpatInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const path = new dPath();
        offs += path.parse(buffer.slice(offs), dt.rppn);
        dt.rpat.push(path);
    }
}

//#region DZS
export class dStage_stageDt_c extends dStage_dt {
    public mult: dStage_Multi_c[] = [];
    public stag: stage_stag_info_class;
    public rtbl: roomRead_class[] = [];
}

function dStage_paletInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    dt.pale[layer] = [];

    let offs = 0;
    for (let i = 0; i < count; i++) {
        const pale = new stage_palet_info_class();
        offs += pale.parse(buffer.slice(offs));
        dt.pale[layer].push(pale);
    }
}

function dStage_pselectInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    dt.colo[layer] = [];

    let offs = 0;
    for (let i = 0; i < count; i++) {
        const colo = new stage_pselect_info_class();
        offs += colo.parse(buffer.slice(offs));
        dt.colo[layer].push(colo);
    }
}

function dStage_vrboxInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    dt.virt[layer] = [];

    let offs = 0;
    for (let i = 0; i < count; i++) {
        const virt = new stage_vrbox_info_class();
        offs += virt.parse(buffer.slice(offs));
        dt.virt[layer].push(virt);
    }
}

function dStage_envrInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    dt.envr[layer] = [];

    let offs = 0;
    for (let i = 0; i < count; i++) {
        const envr = new stage_envr_info_class();
        offs += envr.parse(buffer.slice(offs));
        dt.envr[layer].push(envr);
    }
}

function dStage_elstInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    if (count === 0)
        return;

    let offs = 0;
    for (let i = 0; i < count; i++) {
        const elst = new dStage_Elst_c();
        offs += elst.parse(buffer.slice(offs));
        dt.elst.push(elst);
    }
}

function dStage_multInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const mult = new dStage_Multi_c();
        offs += mult.parse(buffer.slice(offs));
        dt.mult.push(mult);
    }
}

function dStage_stagInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    assert(count === 1);
    dt.stag = new stage_stag_info_class();
    dt.stag.parse(buffer);
}

function dStage_plightInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const lght = new stage_plight_info_class();
        offs += lght.parse(buffer.slice(offs));
        dt.lght.push(lght);
    }
}

function dStage_roomReadInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice): void {
    let offs = 0;
    const view = buffer.createDataView();
    for (let i = 0; i < count; i++) {
        const roomRead = new roomRead_class();
        const roomReadOffs = view.getUint32(offs);
        offs += 0x04;
        roomRead.parse(fileData.slice(roomReadOffs), fileData);
        dt.rtbl.push(roomRead);
    }
}

function dStage_stageTresureInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    // dt.tres = ...;
    dStage_actorInit(globals, dt, buffer, count, fileData, layer);
}

function dStage_stageDrtgInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    // dt.drtg = ...;
    dStage_tgscInfoInit(globals, dt, buffer, count, fileData, layer);
}

export function dStage_dt_c_stageInitLoader(globals: dGlobals, dt: dStage_stageDt_c, dzs: DZS): void {
    dStage_dt_decode(globals, dt, dzs, {
        'STAG': dStage_stagInfoInit,
    });
}

export function dStage_dt_c_stageLoader(globals: dGlobals, dt: dStage_stageDt_c, dzs: DZS): void {
    dStage_dt_decode(globals, dt, dzs, {
        // MEMA
        // MECO
        'MULT': dStage_multInfoInit,
        // PLYR
        // CAMR
        // RCAM
        'ACTR': dStage_actorInit,
        'TGOB': dStage_actorInit,
        'TRES': dStage_stageTresureInit,
        'RTBL': dStage_roomReadInit,
        // AROB
        // RARO
        // 2Dma
        // 2DMA
        'PAL0': dStage_paletInfoInit,
        'Col0': dStage_pselectInfoInit,
        'Virt': dStage_vrboxInfoInit,
        // SCLS
        // TGSC
        'TGSC': dStage_tgscInfoInit,
        'LGHT': dStage_plightInfoInit,
        // PPNT
        // PATH
        'RPPN': dStage_rppnInfoInit,
        'RPAT': dStage_rpatInfoInit,
        // SOND
        'SCOB': dStage_tgscInfoInit,
        // EVNT
        'Env0': dStage_envrInfoInit,
        // FILI (??)
        'Door': dStage_tgscInfoInit,
        // FLOR
        'TGDR': dStage_stageDrtgInfoInit,
        'EVLY': dStage_elstInfoInit,
    });

    actorlayerLoader(globals, dt, dzs);
    envLayerLoader(globals, dt, dzs);
}
//#endregion

//#region DZR
export class dStage_roomDt_c extends dStage_dt {
    public fili: dStage_FileList_dt_c | null = null;
}

export class dStage_roomStatus_c extends dStage_roomDt_c {
    public tevStr = new dKy_tevstr_c();
}

function dStage_filiInfoInit(globals: dGlobals, dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number): void {
    if (count !== 0) {
        assert(count === 1);
        dt.fili = new dStage_FileList_dt_c();
        dt.fili.parse(buffer);
    } else {
        dt.fili = null;
    }
}

function dStage_lgtvInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    dt.lgtv[layer] = [];
    for (let i = 0; i < count; i++) {
        const data = new stage_pure_lightvec_info_class();
        data.parse(buffer);
        dt.lgtv[layer].push(data);
    }
}

function dStage_roomTresureInit(globals: dGlobals, dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    // dt.tres = ...;
    dStage_actorInit(globals, dt, buffer, count, fileData, layer);
}

function dStage_roomDrtgInfoInit(globals: dGlobals, dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    // dt.drtg = ...;
    dStage_tgscInfoInit(globals, dt, buffer, count, fileData, layer);
}

export function dStage_dt_c_roomLoader(globals: dGlobals, dt: dStage_roomDt_c, dzs: DZS): void {
    dStage_dt_decode(globals, dt, dzs, {
        'FILI': dStage_filiInfoInit,
        'RPPN': dStage_rppnInfoInit,
        'RPAT': dStage_rpatInfoInit,
    });
}

export function dStage_dt_c_roomReLoader(globals: dGlobals, dt: dStage_roomDt_c, dzs: DZS): void {
    dStage_dt_decode(globals, dt, dzs, {
        'ACTR': dStage_actorInit,
        'TGOB': dStage_actorInit,
        'TRES': dStage_roomTresureInit,
        'TGSC': dStage_tgscInfoInit,
        'SCOB': dStage_tgscInfoInit,
        'Door': dStage_tgscInfoInit,
        'TGDR': dStage_roomDrtgInfoInit,
    });

    actorlayerLoader(globals, dt, dzs);
    envLayerLoader(globals, dt, dzs);
}
//#endregion

export function dPath_GetRoomPath(globals: dGlobals, idx: number, roomNo: number): dPath {
    return globals.roomStatus[roomNo].rpat[idx];
}
