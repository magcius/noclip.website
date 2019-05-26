
import * as BCSV from '../../luigis_mansion/bcsv';
import { mat4 } from 'gl-matrix';
import { computeModelMatrixSRT, MathConstants } from '../../MathHelpers';
import ArrayBufferSlice from '../../ArrayBufferSlice';

function computeModelMatrixFromRecord(dst: mat4, infoIter: JMapInfoIter): void {
    const pos_x = infoIter.getValueNumber('pos_x', 0);
    const pos_y = infoIter.getValueNumber('pos_y', 0);
    const pos_z = infoIter.getValueNumber('pos_z', 0);
    const dir_x = infoIter.getValueNumber('dir_x', 0) * MathConstants.DEG_TO_RAD;
    const dir_y = infoIter.getValueNumber('dir_y', 0) * MathConstants.DEG_TO_RAD;
    const dir_z = infoIter.getValueNumber('dir_z', 0) * MathConstants.DEG_TO_RAD;
    const scale_x = infoIter.getValueNumber('scale_x', 1);
    const scale_y = infoIter.getValueNumber('scale_y', 1);
    const scale_z = infoIter.getValueNumber('scale_z', 1);
    computeModelMatrixSRT(dst, scale_x, scale_y, scale_z, dir_x, dir_y, dir_z, pos_x, pos_y, pos_z);
}

export function getJMapInfoArg0(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg0', fallback); }
export function getJMapInfoArg1(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg1', fallback); }
export function getJMapInfoArg2(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg2', fallback); }
export function getJMapInfoArg3(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg3', fallback); }
export function getJMapInfoArg4(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg4', fallback); }
export function getJMapInfoArg5(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg5', fallback); }
export function getJMapInfoArg6(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg6', fallback); }
export function getJMapInfoArg7(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg7', fallback); }

type Callback<T> = (jmp: JMapInfoIter, i: number) => T;

export class JMapInfoIter {
    constructor(public bcsv: BCSV.Bcsv, public record: BCSV.BcsvRecord) {
    }

    public copy(): JMapInfoIter {
        return new JMapInfoIter(this.bcsv, this.record);
    }

    public getNumRecords(): number {
        return this.bcsv.records.length;
    }

    public setRecord(i: number): void {
        this.record = this.bcsv.records[i];
    }

    public mapRecords<T>(callback: Callback<T>): T[] {
        const results: T[] = [];
        for (let i = 0; i < this.bcsv.records.length; i++) {
            this.setRecord(i);
            results.push(callback(this, i));
        }
        return results;
    }

    public getSRTMatrix(m: mat4): void {
        computeModelMatrixFromRecord(m, this);
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
