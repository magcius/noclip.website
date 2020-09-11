
import * as BCSV from '../Content/luigis_mansion/bcsv';
import { vec3 } from 'gl-matrix';
import { MathConstants } from '../MathHelpers';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { fallback } from '../util';

export function getJMapInfoArg0(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg0'); }
export function getJMapInfoArg1(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg1'); }
export function getJMapInfoArg2(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg2'); }
export function getJMapInfoArg3(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg3'); }
export function getJMapInfoArg4(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg4'); }
export function getJMapInfoArg5(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg5'); }
export function getJMapInfoArg6(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg6'); }
export function getJMapInfoArg7(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg7'); }

export function getJMapInfoBool(v: number): boolean {
    return v !== -1 && v !== 0;
}

export function getJMapInfoTransLocal(dst: vec3, infoIter: JMapInfoIter): void {
    dst[0] = fallback(infoIter.getValueNumber('pos_x'), 0);
    dst[1] = fallback(infoIter.getValueNumber('pos_y'), 0);
    dst[2] = fallback(infoIter.getValueNumber('pos_z'), 0);
}

export function getJMapInfoRotateLocal(dst: vec3, infoIter: JMapInfoIter): void {
    dst[0] = fallback(infoIter.getValueNumber('dir_x'), 0) * MathConstants.DEG_TO_RAD;
    dst[1] = fallback(infoIter.getValueNumber('dir_y'), 0) * MathConstants.DEG_TO_RAD;
    dst[2] = fallback(infoIter.getValueNumber('dir_z'), 0) * MathConstants.DEG_TO_RAD;
}

export function getJMapInfoScale(dst: vec3, infoIter: JMapInfoIter): void {
    dst[0] = fallback(infoIter.getValueNumber('scale_x'), 1);
    dst[1] = fallback(infoIter.getValueNumber('scale_y'), 1);
    dst[2] = fallback(infoIter.getValueNumber('scale_z'), 1);
}

export function getJMapInfoGroupId(infoIter: JMapInfoIter): number | null {
    const groupId = infoIter.getValueNumber('GroupId');
    if (groupId !== null)
        return groupId;

    return infoIter.getValueNumber('ClippingGroupId');
}

type Callback<T> = (jmp: JMapInfoIter, i: number) => T;

export class JMapInfoIter {
    constructor(public bcsv: BCSV.Bcsv, public record: BCSV.BcsvRecord) {
    }

    public getNumRecords(): number {
        return this.bcsv.records.length;
    }

    public setRecord(i: number): void {
        this.record = this.bcsv.records[i];
    }

    public findRecord(callback: Callback<boolean>): boolean {
        for (let i = 0; i < this.bcsv.records.length; i++) {
            this.setRecord(i);
            if (callback(this, i))
                return true;
        }
        return false;
    }

    public mapRecords<T>(callback: Callback<T>): T[] {
        const results: T[] = [];
        for (let i = 0; i < this.bcsv.records.length; i++) {
            this.setRecord(i);
            results.push(callback(this, i));
        }
        return results;
    }

    public getValueString(name: string): string | null {
        return BCSV.getField<string>(this.bcsv, this.record, name);
    }

    public getValueNumber(name: string): number | null {
        return BCSV.getField<number>(this.bcsv, this.record, name);
    }

    public getValueNumberNoInit(name: string): number | null {
        const v = BCSV.getField<number>(this.bcsv, this.record, name);
        if (v === -1)
            return null;
        return v;
    }
}

export function createCsvParser(buffer: ArrayBufferSlice): JMapInfoIter {
    const bcsv = BCSV.parse(buffer);
    return new JMapInfoIter(bcsv, bcsv.records[0]);
}
