
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
}

export class stage_pselect_info_class {
    constructor(public palIdx: Uint8Array) {
    }
}

export class stage_vrbox_info_class {
    public kumoColor = colorNewCopy(White);
    public kumoCenterColor = colorNewCopy(White);
    public skyColor = colorNewCopy(White);
    public usoUmiColor = colorNewCopy(White);
    public kasumiMaeColor = colorNewCopy(White);
}

export class stage_envr_info_class {
    constructor(public pselIdx: Uint8Array) {
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
}

function colorFromRGB8(dst: Color, n: number): void {
    colorFromRGBA8(dst, (n & 0xFFFFFF00) | 0xFF);
}

function dStage_paletInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    const view = buffer.createDataView();
    for (let i = 0; i < count; i++) {
        const pale = new stage_palet_info_class();
        colorFromRGB8(pale.actCol.C0, view.getUint32(offs + 0x00));
        colorFromRGB8(pale.actCol.K0, view.getUint32(offs + 0x03));
        colorFromRGB8(pale.bgCol[0].C0, view.getUint32(offs + 0x06));
        colorFromRGB8(pale.bgCol[0].K0, view.getUint32(offs + 0x09));
        colorFromRGB8(pale.bgCol[1].C0, view.getUint32(offs + 0x0C));
        colorFromRGB8(pale.bgCol[1].K0, view.getUint32(offs + 0x0F));
        colorFromRGB8(pale.bgCol[2].C0, view.getUint32(offs + 0x12));
        colorFromRGB8(pale.bgCol[2].K0, view.getUint32(offs + 0x15));
        colorFromRGB8(pale.bgCol[3].C0, view.getUint32(offs + 0x18));
        colorFromRGB8(pale.bgCol[3].K0, view.getUint32(offs + 0x1B));
        // fogColor
        pale.virtIdx = view.getUint8(offs + 0x21);
        // fogStartZ, fogEndZ
        dt.pale.push(pale);
        offs += 0x2C;
    }
}

function dStage_pselectInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        dt.colo.push(new stage_pselect_info_class(buffer.createTypedArray(Uint8Array, offs, 0x0C)));
        offs += 0x0C;
    }
}

function dStage_virtInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    const view = buffer.createDataView();
    for (let i = 0; i < count; i++) {
        const virt = new stage_vrbox_info_class();
        colorFromRGBA8(virt.kumoColor, view.getUint32(offs + 0x10));
        colorFromRGBA8(virt.kumoCenterColor, view.getUint32(offs + 0x14));
        colorFromRGB8(virt.skyColor, view.getUint32(offs + 0x18));
        colorFromRGB8(virt.usoUmiColor, view.getUint32(offs + 0x1B));
        colorFromRGB8(virt.kasumiMaeColor, view.getUint32(offs + 0x1E));
        dt.virt.push(virt);
        offs += 0x24;
    }
}

function dStage_envrInfoInit(dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        dt.envr.push(new stage_envr_info_class(buffer.createTypedArray(Uint8Array, offs, 0x08)));
        offs += 0x08;
    }
}

export function dStage_dt_c_initStageLoader(dt: dStage_stageDt_c, dzs: DZS): void {
    dStage_dt_decode(dt, dzs, {
        'Pale': dStage_paletInfoInit,
        'Colo': dStage_pselectInfoInit,
        'Virt': dStage_virtInfoInit,
        'EnvR': dStage_envrInfoInit,
    });
}
//#endregion

//#region DZR
export class dStage_roomStatus_c {
    public tevStr = new dKy_tevstr_c();
}
//#endregion
