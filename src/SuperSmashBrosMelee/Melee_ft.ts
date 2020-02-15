
import ArrayBufferSlice from "../ArrayBufferSlice";
import { HSD_LoadContext, HSD_LoadContext__ResolvePtrAutoSize, HSD_Archive, HSD_ArchiveSymbol, HSD_LoadContext__ResolvePtr, HSD_LoadContext__ResolvePtrString, HSD_ArchiveParse, HSD_FObj, HSD_FObjLoadKeyframes, HSD_AObj, HSD_AObjFlags } from "./SYSDOLPHIN";
import { readString, assert } from "../util";

// ft = Fighter

export interface ftData {
    subActionTable: ftData_SubAction[];
}

export interface ftData_SubAction {
    symbolStr: string | null;
    animJointOffs: number;
    animJointSize: number;
    subActionDataOffs: number;
    flags: number;
}

function Melee_ftData_LoadInternal(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): ftData {
    const view = buffer.createDataView();

    const subActionTableBuffer = HSD_LoadContext__ResolvePtrAutoSize(ctx, view.getUint32(0x0C));
    const subActionTable: ftData_SubAction[] = [];

    const numEntries = subActionTableBuffer.byteLength / 0x18;
    const subActionTableView = subActionTableBuffer.createDataView();
    let subActionTableIdx = 0x00;
    for (let i = 0; i < numEntries; i++) {
        const symbolStrOffs = subActionTableView.getUint32(subActionTableIdx + 0x00);
        let symbolStr: string | null = null;
        if (symbolStrOffs !== 0)
            symbolStr = HSD_LoadContext__ResolvePtrString(ctx, symbolStrOffs);
        const animJointOffs = subActionTableView.getUint32(subActionTableIdx + 0x04);
        const animJointSize = subActionTableView.getUint32(subActionTableIdx + 0x08);
        const subActionDataOffs = subActionTableView.getUint32(subActionTableIdx + 0x0C);
        const flags = subActionTableView.getUint32(subActionTableIdx + 0x10);
        // unk

        subActionTable.push({ symbolStr, animJointOffs, animJointSize, subActionDataOffs, flags });
        subActionTableIdx += 0x18;
    }

    return { subActionTable };
}

export interface figatree_Base {
    name: string;
}

export interface figatree_Anim extends figatree_Base {
    kind: 'Anim';
    endFrame: number;
    aobj: HSD_AObj[];
}

export interface figatree_MatAnim extends figatree_Base {
    kind: 'MatAnim';
}

export type figatree = figatree_Anim | figatree_MatAnim;

export function Melee_figatree_Track_Load(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): HSD_FObj {
    const view = buffer.createDataView();

    const length = view.getUint16(0x00);
    const type = view.getUint8(0x04);
    const fracValue = view.getUint8(0x05);
    const fracSlope = view.getUint8(0x06);
    const offs = view.getUint32(0x08);

    const keyframeData = HSD_LoadContext__ResolvePtr(ctx, offs, length);
    const keyframes = HSD_FObjLoadKeyframes(ctx, keyframeData, fracValue, fracSlope);

    return { type, keyframes };
}

export function Melee_figatree_Load(archive: HSD_Archive): figatree {
    assert(archive.publics.length === 1);
    const symbol = archive.publics[0];

    const ctx = new HSD_LoadContext(archive);
    const buffer = HSD_LoadContext__ResolvePtr(ctx, symbol.offset);
    const view = buffer.createDataView();

    const type = view.getInt32(0x00);
    assert(type === 0x01);

    const endFrame = view.getFloat32(0x08);

    const nodeTrackCountTableOffs = view.getUint32(0x0C);
    const nodeTrackCountTableBuffer = HSD_LoadContext__ResolvePtr(ctx, nodeTrackCountTableOffs);
    const nodeTrackCountTableView = nodeTrackCountTableBuffer.createDataView();

    const trackTableOffs = view.getUint32(0x10);
    const trackTableBuffer = HSD_LoadContext__ResolvePtr(ctx, trackTableOffs);

    const aobj: HSD_AObj[] = [];

    let trackTableIdx = 0;
    for (let i = 0; ; i++) {
        const nodeTrackCount = nodeTrackCountTableView.getUint8(i);

        // End.
        if (nodeTrackCount === 0xFF)
            break;

        const fobj: HSD_FObj[] = [];
        for (let j = 0; j < nodeTrackCount; j++) {
            fobj.push(Melee_figatree_Track_Load(ctx, trackTableBuffer.subarray(trackTableIdx, 0x0C)));
            trackTableIdx += 0x0C;
        }

        const flags = HSD_AObjFlags.ANIM_LOOP;
        aobj.push({ flags, endFrame, fobj, objID: 0 });
    }

    const name = symbol.name;
    return { kind: 'Anim', name, endFrame, aobj };
}

export function Melee_SplitDataAJ(buffer: ArrayBufferSlice, subActionTable: readonly ftData_SubAction[]): (HSD_Archive | null)[] {
    const subActionTableAJ: (HSD_Archive | null)[] = [];

    for (let i = 0; i < subActionTable.length; i++) {
        const subAction = subActionTable[i];
        if (subAction.symbolStr === null) {
            assert(subAction.animJointOffs === 0);
            assert(subAction.animJointSize === 0);
            subActionTableAJ[i] = null;
        } else {
            assert(subAction.animJointSize !== 0);
            const arc = HSD_ArchiveParse(buffer.subarray(subAction.animJointOffs, subAction.animJointSize));
            assert(arc.publics.length === 1);
            assert(arc.publics[0].name === subAction.symbolStr);
            subActionTableAJ[i] = arc;
        }
    }

    return subActionTableAJ;
}

export function Melee_ftData_Load(archive: HSD_Archive, symbol: HSD_ArchiveSymbol): ftData {
    const ctx = new HSD_LoadContext(archive);
    const buffer = HSD_LoadContext__ResolvePtr(ctx, symbol.offset);

    return Melee_ftData_LoadInternal(ctx, buffer);
}
