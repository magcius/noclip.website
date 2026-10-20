// mapobj.lod - distance LOD for the placed map objects

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { ReadonlyMat4, ReadonlyVec3 } from "gl-matrix";

//#region .lod table

const MAGIC = 0xEDEFECE4;
const HEADER_SIZE = 8;
const SLOT_SIZE = 4;

export const SWITCH_DISTANCE = 60.0;

export class LodTable {
    constructor(private farBlockByType: ReadonlyMap<number, number>) {
    }

    public resolve(typeId: number, far: boolean): number {
        if (!far)
            return typeId;
        return this.farBlockByType.get(typeId) ?? typeId;
    }
}

export function parse(buffer: ArrayBufferSlice): LodTable {
    const view = buffer.createDataView();
    if (view.getUint32(0x00, false) !== MAGIC)
        throw new Error(`not a .lod file (magic ${view.getUint32(0x00, false).toString(16)})`);
    const farBlockByType = new Map<number, number>();
    const slotCount = ((buffer.byteLength - HEADER_SIZE) / SLOT_SIZE) | 0;
    for (let typeId = 0; typeId < slotCount; typeId++) {
        const offs = HEADER_SIZE + typeId * SLOT_SIZE;

        if (view.getUint8(offs) >= 0x80)
            farBlockByType.set(typeId, view.getUint8(offs + 1));
    }
    return new LodTable(farBlockByType);
}

//#endregion

//#region Distance Test

export function isFar(worldMatrix: ReadonlyMat4, cameraPos: ReadonlyVec3): boolean {
    const dx = worldMatrix[12] - cameraPos[0];
    const dy = worldMatrix[13] - cameraPos[1];
    const dz = worldMatrix[14] - cameraPos[2];
    return dx * dx + dy * dy + dz * dz >= SWITCH_DISTANCE * SWITCH_DISTANCE;
}

//#endregion
