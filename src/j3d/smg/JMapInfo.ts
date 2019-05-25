
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

export function getMapInfoArg0(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg0', fallback); }
export function getMapInfoArg1(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg1', fallback); }
export function getMapInfoArg2(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg2', fallback); }
export function getMapInfoArg3(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg3', fallback); }
export function getMapInfoArg4(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg4', fallback); }
export function getMapInfoArg5(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg5', fallback); }
export function getMapInfoArg6(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg6', fallback); }
export function getMapInfoArg7(infoIter: JMapInfoIter, fallback: number = null): number | null { return infoIter.getValueNumber('Obj_arg7', fallback); }

export class JMapInfoIter {
    constructor(public bcsv: BCSV.Bcsv, public record: BCSV.BcsvRecord) {
    }

    public getNumRecords(): number {
        return this.bcsv.records.length;
    }

    public setRecord(i: number): void {
        this.record = this.bcsv.records[i];
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
