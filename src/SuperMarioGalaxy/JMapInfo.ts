
import * as BCSV from '../luigis_mansion/bcsv';
import { vec3 } from 'gl-matrix';
import { MathConstants } from '../MathHelpers';
import { assertExists, fallback } from '../util';
import type { SceneObjHolder } from './Main';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { ZoneAndLayer } from './LiveActor';
import { UI } from '../ui';

export function getJMapInfoArg0(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg0'); }
export function getJMapInfoArg1(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg1'); }
export function getJMapInfoArg2(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg2'); }
export function getJMapInfoArg3(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg3'); }
export function getJMapInfoArg4(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg4'); }
export function getJMapInfoArg5(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg5'); }
export function getJMapInfoArg6(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg6'); }
export function getJMapInfoArg7(infoIter: JMapInfoIter) { return infoIter.getValueNumberNoInit('Obj_arg7'); }

export function getJMapInfoBool(v: number): boolean {
    return v !== -1;
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

function makeTable(bcsv: BCSV.Bcsv): HTMLTableElement {
    const table = document.createElement('table');
    table.border = '1';

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    {
        const tr = document.createElement('tr');
        tbody.appendChild(tr);
        bcsv.fields.forEach((field) => {
            const th = document.createElement('th');
            th.textContent = field.debugName;
            tr.appendChild(th);
        });
    }

    bcsv.records.forEach((record) => {
        const tr = document.createElement('tr');
        tbody.appendChild(tr);
        record.forEach((record) => {
            const td = document.createElement('td');
            td.textContent = record.toString();
            tr.appendChild(td);
        });
    });

    return table;
}

export class JMapInfoIter {
    constructor(public filename: string | null, public bcsv: BCSV.Bcsv, public record: BCSV.BcsvRecord) {
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

    public popDebug(): void {
        const ui: UI = window.main.ui;
        const debugFloater = ui.debugFloaterHolder.makeFloatingPanel(fallback(this.filename, 'BCSV'));
        debugFloater.contents.style.overflow = 'auto';

        const table = makeTable(this.bcsv);
        debugFloater.contents.appendChild(table);
    }
}

export function createCsvParser(buffer: ArrayBufferSlice, filename: string | null = null): JMapInfoIter {
    const bcsv = BCSV.parse(buffer);
    return new JMapInfoIter(filename, bcsv, bcsv.records[0]);
}

export class JMapIdInfo {
    constructor(public readonly zoneId: number, public readonly infoId: number) {
    }

    public equals(other: Readonly<JMapIdInfo>): boolean {
        return this.zoneId === other.zoneId && this.infoId === other.infoId;
    }
}

function getPlacedZoneId(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): number {
    return sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter)!.zoneId;
}

function getJMapInfoLinkID(infoIter: JMapInfoIter) {
    return assertExists(infoIter.getValueNumber('l_id'));
}

export function iterChildObj(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, callback: (childInfoIter: JMapInfoIter, zoneAndLayer: ZoneAndLayer) => void): void {
    const linkID = getJMapInfoLinkID(infoIter);
    const stageDataHolder = sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter)!;
    stageDataHolder.iterChildObjInternal(linkID, callback);
}

export function createJMapIdInfoFromIter(sceneObjHolder: SceneObjHolder, infoId: number, infoIter: JMapInfoIter): JMapIdInfo {
    const zoneId = getPlacedZoneId(sceneObjHolder, infoIter);
    return new JMapIdInfo(zoneId, infoId);
}

const enum LinkTagType { None = -1, MapParts, Obj, ChildObj }
export class JMapLinkInfo {
    private constructor(public readonly zoneId: number, public readonly objId: number, public readonly linkTagType: LinkTagType) {
    }

    public equals(other: Readonly<JMapLinkInfo>): boolean {
        return this.zoneId === other.zoneId && this.objId === other.objId && this.linkTagType === other.linkTagType;
    }

    public static createLinkInfo(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): JMapLinkInfo | null {
        const zoneId = getPlacedZoneId(sceneObjHolder, infoIter);

        let objId: number | null;

        objId = infoIter.getValueNumber('MapParts_ID');
        if (objId !== null)
            return new JMapLinkInfo(zoneId, objId, LinkTagType.MapParts);

        objId = infoIter.getValueNumber('Obj_ID');
        if (objId !== null)
            return new JMapLinkInfo(zoneId, objId, LinkTagType.Obj);

        objId = infoIter.getValueNumber('ChildObjId');
        if (objId !== null)
            return new JMapLinkInfo(zoneId, objId, LinkTagType.ChildObj);

        return null;
    }

    public static createLinkedInfo(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): JMapLinkInfo | null {
        const zoneId = getPlacedZoneId(sceneObjHolder, infoIter);

        const objId = infoIter.getValueNumber('l_id');
        if (objId === null)
            return null;

        if (infoIter.filename === 'mappartsinfo')
            return new JMapLinkInfo(zoneId, objId, LinkTagType.MapParts);
        else if (infoIter.filename === 'objinfo')
            return new JMapLinkInfo(zoneId, objId, LinkTagType.Obj);
        else if (infoIter.filename === 'childobjinfo')
            return new JMapLinkInfo(zoneId, objId, LinkTagType.ChildObj);

        return null;
    }
}
