
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";
import { HSD_AnimJointRoot, HSD_AObjLoadAnimJoint, HSD_AObjLoadMatAnimJoint, HSD_AObjLoadShapeAnimJoint, HSD_JObjRoot, HSD_JObjLoadJoint, HSD_LoadContext, HSD_LoadContext__ResolvePtrAutoSize, HSD_MatAnimJointRoot, HSD_ShapeAnimJointRoot } from "./SYSDOLPHIN";

export interface map_gobjData {
    jobj: HSD_JObjRoot | null;
    anim: (HSD_AnimJointRoot | null)[];
    matAnim: (HSD_MatAnimJointRoot | null)[];
    shapeAnim: (HSD_ShapeAnimJointRoot | null)[];
}

function HSD_LoadNullTerminatedPointerArray<T>(ctx: HSD_LoadContext, offset: number, loadFunc: (ctx: HSD_LoadContext, buffer: ArrayBufferSlice) => T): T[] {
    if (offset === 0 || offset === 0xFFFFFFFF)
        return [];

    const buffer = HSD_LoadContext__ResolvePtrAutoSize(ctx, offset)!;
    const view = buffer.createDataView();

    const L: T[] = [];
    let offs = 0;
    while (true) {
        const structOffs = view.getUint32(offs + 0x00);
        if (structOffs === 0x00)
            break;
        L.push(loadFunc(ctx, HSD_LoadContext__ResolvePtrAutoSize(ctx, structOffs)!));
        offs += 0x04;
    }
    return L;
}

function Melee_map_gobj_Load(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): map_gobjData {
    const view = buffer.createDataView();

    const jobj = HSD_JObjLoadJoint(ctx, HSD_LoadContext__ResolvePtrAutoSize(ctx, view.getUint32(0x00)));
    const anim = HSD_LoadNullTerminatedPointerArray(ctx, view.getUint32(0x04), HSD_AObjLoadAnimJoint);
    const matAnim = HSD_LoadNullTerminatedPointerArray(ctx, view.getUint32(0x08), HSD_AObjLoadMatAnimJoint);
    const shapeAnim = HSD_LoadNullTerminatedPointerArray(ctx, view.getUint32(0x08), HSD_AObjLoadShapeAnimJoint);

    return { jobj, anim, matAnim, shapeAnim };
}

export interface map_headData {
    gobj: map_gobjData[];
}

function HSD_LoadStructArray<T>(ctx: HSD_LoadContext, buffer: ArrayBufferSlice, offset: number, structSize: number, loadFunc: (ctx: HSD_LoadContext, buffer: ArrayBufferSlice) => T): T[] {
    const view = buffer.createDataView();

    const L: T[] = [];
    const offs = view.getUint32(offset + 0x00);
    const length = view.getUint32(offset + 0x04);
    const arrayBuffer = HSD_LoadContext__ResolvePtrAutoSize(ctx, offs)!;
    assert(arrayBuffer.byteLength / structSize === length);
    for (let i = 0; i < length; i++) {
        const buffer = arrayBuffer.subarray(i * structSize, structSize);
        L.push(loadFunc(ctx, buffer));
    }
    return L;
}

export function Melee_map_headData_Load(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): map_headData {
    const gobj: map_gobjData[] = HSD_LoadStructArray(ctx, buffer, 0x08, 0x34, Melee_map_gobj_Load);
    return { gobj };
}
