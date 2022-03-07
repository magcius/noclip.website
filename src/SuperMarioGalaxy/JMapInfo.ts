
import * as BCSV from '../luigis_mansion/bcsv';
import { vec3 } from 'gl-matrix';
import type { SceneObjHolder } from './Main';
import type { ZoneAndLayer } from './LiveActor';
import { MathConstants } from '../MathHelpers';
import { assertExists, fallback, hexzero0x } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import type { UI } from '../ui';

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
            th.textContent = guessDebugName(field.nameHash);
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

function bcsvHashSMG(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 0x1F + str.charCodeAt(i)) >>> 0;
    }
    return hash;
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

    private getValue<T extends number | string>(name: string): T | null {
        const hash = bcsvHashSMG(name);
        const index = BCSV.getFieldIndexFromHash(this.bcsv, hash);
        if (index === -1)
            return null;
        return this.record[index] as T;
    }

    public getValueString(name: string): string | null {
        return this.getValue<string>(name);
    }

    public getValueNumber(name: string): number | null {
        return this.getValue<number>(name);
    }

    public getValueNumberNoInit(name: string): number | null {
        const v = this.getValue<number>(name);
        if (v === -1)
            return null;
        return v;
    }

    public popDebug(): void {
        const ui: UI = window.main.ui;
        const debugFloater = ui.debugFloaterHolder.makeFloatingPanel(fallback(this.filename, 'BCSV'));
        debugFloater.setWidth('1000px');
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

const seenFieldNames = [
    'version', 'name', 'pos', 'dir', 'scale', 'furniture', 'room_no',

    // Super Mario Galaxy

    'type', 'no', 'l_id', 'id', 'attribute',
    // ScenarioData
    'GalaxyName', 'ZoneName', 'ScenarioNo', 'ScenarioName', 'PowerStarId', 'AppearPowerStarObj', 'Comet', 'LuigiModeTimer', 'IsHidden', 'Hidden', 'WorldNo', 'SceneNo', 'MarioNo',
    // PlanetData
    'PlanetName', 'LowFlag', 'MiddleFlag', 'BloomFlag', 'WaterFlag', 'WaterFlag', 'IndirectFlag',
    // Placement
    'Obj_arg',
    'SW_APPEAR', 'SW_DEAD', 'SW_A', 'SW_B', 'SW_SLEEP',
    'CommonPath_ID', 'FollowId', 'ClippingGroupId', 'GroupId', 'DemoGroupId', 'MapParts_ID', 'Obj_ID', 'ChildObjId',
    'RotateSpeed', 'RotateAngle', 'RotateAxis', 'RotateAccelType', 'RotateStopTime', 'RotateType',
    // Path
    'closed', 'Path_ID', 'usage', 'path_arg',
    // Gravity
    'Range', 'Distant', 'Priority', 'Inverse', 'Power', 'Gravity_type',
    // LightData
    'LightID', 'AreaLightName', 'Interpolate', 'Fix',
    'PlayerLight0Pos', 'PlayerLight0Color', 'PlayerLight0FollowCamera', 'PlayerLight1Pos', 'PlayerLight1Color', 'PlayerLight1FollowCamera', 'PlayerAmbient', 'PlayerAlpha2',
    'StrongLight0Pos', 'StrongLight0Color', 'StrongLight0FollowCamera', 'StrongLight1Pos', 'StrongLight1Color', 'StrongLight1FollowCamera', 'StrongAmbient', 'StrongAlpha2',
    'WeakLight0Pos', 'WeakLight0Color', 'WeakLight0FollowCamera', 'WeakLight1Pos', 'WeakLight1Color', 'WeakLight1FollowCamera', 'WeakAmbient', 'WeakAlpha2',
    'PlanetLight0Pos', 'PlanetLight0Color', 'PlanetLight0FollowCamera', 'PlanetLight1Pos', 'PlanetLight1Color', 'PlanetLight1FollowCamera', 'PlanetAmbient', 'PlanetAlpha2',
    // Shadow
    'Name', 'GroupName', 'Joint', 'DropOffset', 'DropStart', 'DropLength', 'SyncShow', 'FollowScale', 'Collision', 'Gravity', 'VolumeStart', 'VolumeEnd',
    'VolumeCut', 'Type', 'Radius', 'Size', 'LineStart', 'LineStartRadius', 'LineEnd', 'LineEndRadius',
    // GeneralPos
    'PosName',
    // CameraParam
    'version', 'woffset', 'loffset', 'loffsetv', 'roll', 'fovy', 'camint', 'upper', 'lower', 'gndint', 'uplay', 'lplay', 'pushdelaylow', 'pushdelay', 'udown', 'vpanuse', 'vpanaxis',
    'flag.noreset', 'flag.nofovy', 'flag.lofserpoff', 'flag.antibluroff', 'flag.collisionoff', 'flag.subjectiveoff', 'camtype', 'dist', 'axis', 'wpoint', 'up', 'angleA', 'angleB', 'num1', 'num2',
    'gflag.thru', 'gflag.enableEndErpFrame', 'gflag.camendint', 'eflag.enableErpFrame', 'eflag.enableEndErpFrame', 'camendint', 'evfrm', 'evpriority',
];

export function guessDebugName(nameHash: number): string {
    const isCorrect = (guess: string) => (bcsvHashSMG(guess) === nameHash);

    let guess: string;
    for (const name of seenFieldNames) {
        guess = name; if (isCorrect(guess)) return guess;

        for (const suffix of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'X', 'Y', 'Z', '_x', '_y', '_z', '.X', '.Y', '.Z', 'R', 'G', 'B', 'A']) {
            guess = `${name}${suffix}`; if (isCorrect(guess)) return guess;
        }
    }

    for (let i = 0; i <= 9; i++) {
        for (const suffix of ['_x', '_y', '_z']) {
            guess = `pnt${i}${suffix}`; if (isCorrect(guess)) return guess;
        }
    }

    return `${hexzero0x(nameHash, 8)}`;
}
