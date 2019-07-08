
import * as BCSV from '../../luigis_mansion/bcsv';
import { vec3 } from 'gl-matrix';
import { MathConstants } from '../../MathHelpers';
import ArrayBufferSlice from '../../ArrayBufferSlice';

export function getJMapInfoArg0(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg0', fallback); }
export function getJMapInfoArg1(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg1', fallback); }
export function getJMapInfoArg2(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg2', fallback); }
export function getJMapInfoArg3(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg3', fallback); }
export function getJMapInfoArg4(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg4', fallback); }
export function getJMapInfoArg5(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg5', fallback); }
export function getJMapInfoArg6(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg6', fallback); }
export function getJMapInfoArg7(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg7', fallback); }

export function getJMapInfoTransLocal(dst: vec3, infoIter: JMapInfoIter): void {
    dst[0] = infoIter.getValueNumber('pos_x', 0);
    dst[1] = infoIter.getValueNumber('pos_y', 0);
    dst[2] = infoIter.getValueNumber('pos_z', 0);
}

export function getJMapInfoRotateLocal(dst: vec3, infoIter: JMapInfoIter): void {
    dst[0] = infoIter.getValueNumber('dir_x', 0) * MathConstants.DEG_TO_RAD;
    dst[1] = infoIter.getValueNumber('dir_y', 0) * MathConstants.DEG_TO_RAD;
    dst[2] = infoIter.getValueNumber('dir_z', 0) * MathConstants.DEG_TO_RAD;
}

export function getJMapInfoScale(dst: vec3, infoIter: JMapInfoIter): void {
    dst[0] = infoIter.getValueNumber('scale_x', 1);
    dst[1] = infoIter.getValueNumber('scale_y', 1);
    dst[2] = infoIter.getValueNumber('scale_z', 1);
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

    public getValueString(name: string, fallback: string | null = null): string | null {
        return BCSV.getField<string>(this.bcsv, this.record, name, fallback);
    }

    public getValueNumber(name: string, fallback: number | null = null): number | null {
        return BCSV.getField<number>(this.bcsv, this.record, name, fallback);
    }
}

export function createCsvParser(buffer: ArrayBufferSlice): JMapInfoIter {
    const bcsv = BCSV.parse(buffer);
    return new JMapInfoIter(bcsv, bcsv.records[0]);
}
