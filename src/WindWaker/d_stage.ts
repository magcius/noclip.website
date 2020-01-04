
import { Color, White, colorNewCopy, colorFromRGBA8 } from "../Color";
import { DZS } from "./d_resorce";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { nArray } from "../util";
import { dKy_tevstr_c } from "./d_kankyo";

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
    // fogColor
    public virtIdx: number;
    // fogStartZ / fogEndZ

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
        // fogColor
        this.virtIdx = view.getUint8(0x21);
        // fogStartZ, fogEndZ
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
    public kumoColor = colorNewCopy(White);
    public kumoCenterColor = colorNewCopy(White);
    public skyColor = colorNewCopy(White);
    public usoUmiColor = colorNewCopy(White);
    public kasumiMaeColor = colorNewCopy(White);

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        colorFromRGBA8(this.kumoColor, view.getUint32(0x10));
        colorFromRGBA8(this.kumoCenterColor, view.getUint32(0x14));
        colorFromRGB8(this.skyColor, view.getUint32(0x18));
        colorFromRGB8(this.usoUmiColor, view.getUint32(0x1B));
        colorFromRGB8(this.kasumiMaeColor, view.getUint32(0x1E));
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

type dStage_dt_decode_handlerCB<T> = (dt: T, buffer: ArrayBufferSlice, count: number) => void;
type dStage_dt_decode_handler<T> = { [k: string]: dStage_dt_decode_handlerCB<T> };

export function dStage_dt_decode<T>(dt: T, dzs: DZS, handlers: dStage_dt_decode_handler<T>): void {
    for (const h of dzs.headers.values()) {
        const cb = handlers[h.type];
        if (cb !== undefined)
            cb(dt, dzs.buffer.slice(h.offs), h.count);
    }
}

//#region DZS
export class dStage_stageDt_c {
    public pale: stage_palet_info_class[] = [];
    public colo: stage_pselect_info_class[] = [];
    public virt: stage_vrbox_info_class[] = [];
    public envr: stage_envr_info_class[] = [];
    public mult: dStage_Multi_c[] = [];
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

export function dStage_dt_c_initStageLoader(dt: dStage_stageDt_c, dzs: DZS): void {
    dStage_dt_decode(dt, dzs, {
        'Pale': dStage_paletInfoInit,
        'Colo': dStage_pselectInfoInit,
        'Virt': dStage_virtInfoInit,
        'EnvR': dStage_envrInfoInit,
        'MULT': dStage_multInfoInit,
    });
}
//#endregion

//#region DZR
export class dStage_roomStatus_c {
    public tevStr = new dKy_tevstr_c();
}
//#endregion
