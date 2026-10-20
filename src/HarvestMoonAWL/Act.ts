// `.act` SDK ACTLayout skeleton format, used for:
// - houses
// - trees
// - crops
// - room actors 

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { mat4, quat, vec3 } from "gl-matrix";
import { readString } from "../util.js";

//#region Constants and records

export const ACT_VERSION = 0x007B7960;
export const ANM_MAGIC = 0x00AC7472;
const CTRL_SCALE = 0x01, CTRL_ROT_EULER = 0x02, CTRL_ROT_QUAT = 0x04, CTRL_TRANS = 0x08, CTRL_MTX = 0x10;
export const NO_GEOMETRY = 0xFFFF;

export const HOUSE_CATALOG = [
    "mapobj--0.act", "mapobj--1.act", "mapobj--21.act", "mapobj--3.act",
    "mapobj--4.act", "mapobj--23.act", "mapobj--6.act", "mapobj--24.act",
    "mapobj--22.act", "mapobj--7.act", "mapobj--8.act", "mapobj--9.act",
    "mapobj--10.act", "mapobj--11.act", "mapobj--12.act", "mapobj--13.act",
    "mapobj--14.act", "mapobj--15.act", "mapobj--16.act", "mapobj--17.act",
    "mapobj--18.act", "mapobj--19.act", "mapobj--20.act", "mapobj--25.act",
    "mapobj--26.act", "mapobj--27.act",
];

export interface ActPart {
    index: number;
    partId: number;
    boneId: number;
    parent: number;
    flags: number;
    local: mat4;
}

export interface Act {
    version: number;
    actorId: number;
    jointCount: number;
    gplName: string;
    geometryId: number;
    parts: ActPart[];
}

//#endregion

//#region Transform controller

const scratchQuat = quat.create();
const scratchTrans = vec3.create();
const scratchScale = vec3.create();

export function ctrlToMatrix(dst: mat4, view: DataView, off: number): mat4 {
    const typ = view.getUint8(off);

    if (typ & (CTRL_MTX | CTRL_ROT_EULER))
        throw new Error(`.act CTRLControl at 0x${off.toString(16)} has unsupported type 0x${typ.toString(16)}`);
    const f: number[] = [];
    for (let i = 0; i < 10; i++)
        f.push(view.getFloat32(off + 4 + i * 4, false));
    if (typ & CTRL_SCALE)
        vec3.set(scratchScale, f[0], f[1], f[2]);
    else
        vec3.set(scratchScale, 1, 1, 1);
    if (typ & CTRL_TRANS)
        vec3.set(scratchTrans, f[7], f[8], f[9]);
    else
        vec3.zero(scratchTrans);
    if (typ & CTRL_ROT_QUAT) {
        // Normalizes the quaternion and makes standard (x, y, z, w) rotation.
        quat.set(scratchQuat, f[3], f[4], f[5], f[6]);
        quat.normalize(scratchQuat, scratchQuat);
    } else {
        quat.identity(scratchQuat);
    }
    return mat4.fromRotationTranslationScale(dst, scratchQuat, scratchTrans, scratchScale);
}

//#endregion

//#region Parsing and part placement

export function loadAct(data: ArrayBufferSlice): Act {
    const view = data.createDataView();

    const version = view.getUint32(0, false);
    if (version !== ACT_VERSION)
        throw new Error(`not an .act (version 0x${version.toString(16)}, LoadHierarchy wants 0x${ACT_VERSION.toString(16)})`);
    const actorId = view.getUint16(4, false);
    const jointCount = view.getUint16(6, false);
    const rootOff = view.getUint32(0x0C, false);
    const gplNameOff = view.getUint32(0x10, false);
    const geometryId = view.getUint16(0x14, false);
    const gplName = gplNameOff !== 0 ? readString(data, gplNameOff) : "";

    const parts: ActPart[] = [];
    const walk = (off: number, parent: number): void => {
        while (off !== 0) {
            const index = parts.length;
            if (index >= jointCount)
                throw new Error(`.act bone tree has more than the header's ${jointCount} bones`);
            const ctrlOff = view.getUint32(off + 0x00, false);
            const local = mat4.create();
            if (ctrlOff !== 0)
                ctrlToMatrix(local, view, ctrlOff);
            parts.push({
                index,
                partId: view.getUint16(off + 0x14, false),
                boneId: view.getUint16(off + 0x16, false),
                parent,
                flags: view.getUint8(off + 0x18),
                local,
            });
            const child = view.getUint32(off + 0x10, false);
            if (child !== 0)
                walk(child, index);
            off = view.getUint32(off + 0x08, false);
        }
    };
    if (rootOff !== 0)
        walk(rootOff, -1);
    if (parts.length !== jointCount)
        throw new Error(`Incorrect number of bones in act: walked ${parts.length}, header says ${jointCount}`);

    return { version, actorId, jointCount, gplName, geometryId, parts };
}

export function partWorldMatrices(a: Act): mat4[] {
    const out: mat4[] = [];
    for (const p of a.parts) {
        const m = mat4.clone(p.local);
        if (p.flags === 1 && p.parent >= 0)
            mat4.mul(m, out[p.parent], m);
        out.push(m);
    }
    return out;
}

//#endregion
