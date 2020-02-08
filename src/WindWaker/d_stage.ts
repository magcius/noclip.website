
import { Color, White, colorNewCopy, colorFromRGBA8, colorNewFromRGBA8 } from "../Color";
import { DZS } from "./d_resorce";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { nArray, assert, hexdump } from "../util";
import { dKy_tevstr_c } from "./d_kankyo";
import { vec3 } from "gl-matrix";
import { Endianness } from "../endian";

export class stage_palet_info_class__DifAmb {
    public C0: Color; // Dif
    public K0: Color; // Amb

    constructor(baseColor: Color) {
        this.C0 = colorNewCopy(baseColor);
        this.K0 = colorNewCopy(baseColor);
    }
}

export class stage_palet_info_class {
    public actCol = new stage_palet_info_class__DifAmb(White);
    public bgCol = nArray(4, () => new stage_palet_info_class__DifAmb(White));
    public fogCol = colorNewCopy(White);
    public virtIdx: number;
    public fogStartZ: number;
    public fogEndZ: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        colorFromRGB8(this.actCol.C0, view.getUint32(0x00));
        colorFromRGB8(this.actCol.K0, view.getUint32(0x03));
        colorFromRGB8(this.bgCol[0].C0, view.getUint32(0x06));
        colorFromRGB8(this.bgCol[0].K0, view.getUint32(0x09));
        colorFromRGB8(this.bgCol[1].C0, view.getUint32(0x0C));
        colorFromRGB8(this.bgCol[1].K0, view.getUint32(0x0F));
        colorFromRGB8(this.bgCol[2].C0, view.getUint32(0x12));
        colorFromRGB8(this.bgCol[2].K0, view.getUint32(0x15));
        colorFromRGB8(this.bgCol[3].C0, view.getUint32(0x18));
        colorFromRGB8(this.bgCol[3].K0, view.getUint32(0x1B));
        colorFromRGB8(this.fogCol, view.getUint32(0x1E));
        this.virtIdx = view.getUint8(0x21);
        this.fogStartZ = view.getFloat32(0x24);
        this.fogEndZ = view.getFloat32(0x28);
        return 0x2C;
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
    public kumoCol = colorNewCopy(White);
    public kumoCenterCol = colorNewCopy(White);
    public skyCol = colorNewCopy(White);
    public usoUmiCol = colorNewCopy(White);
    public kasumiMaeCol = colorNewCopy(White);

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        colorFromRGBA8(this.kumoCol, view.getUint32(0x10));
        colorFromRGBA8(this.kumoCenterCol, view.getUint32(0x14));
        colorFromRGB8(this.skyCol, view.getUint32(0x18));
        colorFromRGB8(this.usoUmiCol, view.getUint32(0x1B));
        colorFromRGB8(this.kasumiMaeCol, view.getUint32(0x1E));
        return 0x24;
    }
}

export class stage_envr_info_class {
    public pselIdx: Uint8Array;

    public parse(buffer: ArrayBufferSlice): number {
        this.pselIdx = buffer.createTypedArray(Uint8Array, 0x00, 0x08);
        return 0x08;
    }
}

export class stage_stag_info_class {
    public nearPlane: number;
    public farPlane: number;
    public roomTypeAndSchBit: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        this.nearPlane = view.getFloat32(0x00);
        this.farPlane = view.getFloat32(0x04);
        this.roomTypeAndSchBit = view.getUint32(0x0C);
        return 0x1C;
    }
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
        this.waveMax = view.getUint8(0x0B);
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
        return 0x08;
    }
}

export class stage_lightvec_info_class {
    public pos = vec3.create();
    public radius: number = 0;
    public fluctuation: number = 0;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        const posX = view.getFloat32(0x00);
        const posY = view.getFloat32(0x04);
        const posZ = view.getFloat32(0x08);
        vec3.set(this.pos, posX, posY, posZ);
        this.radius = view.getFloat32(0x0C);
        this.fluctuation = view.getUint8(0x01B);
        return 0x1C;
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

type dStage_dt_decode_handlerCB<T> = (dt: T, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice) => void;
type dStage_dt_decode_handler<T> = { [k: string]: dStage_dt_decode_handlerCB<T> };

export function dStage_dt_decode<T>(dt: T, dzs: DZS, handlers: dStage_dt_decode_handler<T>): void {
    for (const h of dzs.headers.values()) {
        const cb = handlers[h.type];
        if (cb !== undefined)
            cb(dt, dzs.buffer.slice(h.offs), h.count, dzs.buffer);
    }
}

//#region DZS
export class dStage_stageDt_c {
    public pale: stage_palet_info_class[] = [];
    public colo: stage_pselect_info_class[] = [];
    public virt: stage_vrbox_info_class[] = [];
    public envr: stage_envr_info_class[] = [];
    public mult: dStage_Multi_c[] = [];
    public stag: stage_stag_info_class;
    public lght: stage_plight_info_class[] = [];
    public rtbl: roomRead_class[] = [];
}

function colorFromRGB8(dst: Color, n: number): void {
    colorFromRGBA8(dst, (n & 0xFFFFFF00) | 0xFF);
}

function dStage_paletInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const pale = new stage_palet_info_class();
        offs += pale.parse(buffer.slice(offs));
        dt.pale.push(pale);
    }
}

function dStage_pselectInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const colo = new stage_pselect_info_class();
        offs += colo.parse(buffer.slice(offs));
        dt.colo.push(colo);
    }
}

function dStage_virtInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const virt = new stage_vrbox_info_class();
        offs += virt.parse(buffer.slice(offs));
        dt.virt.push(virt);
    }
}

function dStage_envrInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const envr = new stage_envr_info_class();
        offs += envr.parse(buffer.slice(offs));
        dt.envr.push(envr);
    }
}

function dStage_multInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const mult = new dStage_Multi_c();
        offs += mult.parse(buffer.slice(offs));
        dt.mult.push(mult);
    }
}

function dStage_stagInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    assert(count === 1);
    dt.stag = new stage_stag_info_class();
    dt.stag.parse(buffer);
}

function dStage_plightInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const lght = new stage_plight_info_class();
        offs += lght.parse(buffer.slice(offs));
        dt.lght.push(lght);
    }
}

function dStage_roomReadInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice): void {
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

export function dStage_dt_c_initStageLoader(dt: dStage_stageDt_c, dzs: DZS): void {
    dStage_dt_decode(dt, dzs, {
        'Pale': dStage_paletInfoInit,
        'Colo': dStage_pselectInfoInit,
        'Virt': dStage_virtInfoInit,
        'EnvR': dStage_envrInfoInit,
        'MULT': dStage_multInfoInit,
        'STAG': dStage_stagInfoInit,
        'LGHT': dStage_plightInfoInit,
        'RTBL': dStage_roomReadInit,
    });
}
//#endregion

//#region DZR
export class dStage_roomDt_c {
    public fili: dStage_FileList_dt_c | null = null;
    public lgtv: stage_lightvec_info_class | null = null;
}

export class dStage_roomStatus_c extends dStage_roomDt_c {
    public tevStr = new dKy_tevstr_c();
}

function dStage_filiInfoInit(dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number): void {
    if (count !== 0) {
        assert(count === 1);
        dt.fili = new dStage_FileList_dt_c();
        dt.fili.parse(buffer);
    } else {
        dt.fili = null;
    }
}

function dStage_lgtvInfoInit(dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number): void {
    if (count !== 0) {
        // TODO(jstpierre): TotG has a room with two light vectors? Is that even a thing?
        // assert(count === 1);
        dt.lgtv = new stage_lightvec_info_class();
        dt.lgtv.parse(buffer);
    } else {
        dt.lgtv = null;
    }
}

export function dStage_dt_c_roomLoader(dt: dStage_roomDt_c, dzs: DZS): void {
    dStage_dt_decode(dt, dzs, {
        'FILI': dStage_filiInfoInit,
        'LGTV': dStage_lgtvInfoInit,
    });
}
//#endregion
