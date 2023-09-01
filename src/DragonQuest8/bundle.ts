import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";

export interface BundleResourceInfo {
    magic: number;
    offset: number;
    size: number;
}

export function parseBundle(buffer: ArrayBufferSlice, globalOffset: number = 0): Map<String, BundleResourceInfo> {
    const view = buffer.createDataView();
    let offs = 0;
    let offsetToNext = 1;
    const rNameToInfo: Map<String, BundleResourceInfo> = new Map<String, BundleResourceInfo>();

    while (offsetToNext > 0) {
        const rName: String = readString(buffer, offs);
        const rSize: number = view.getInt32(offs + 0x44, true);
        offsetToNext = view.getInt32(offs + 0x48, true);
        if (offsetToNext > 0) {
            const rMagic = view.getUint32(offs + 0x50, true);
            rNameToInfo.set(rName, { magic: rMagic, offset: offs + 0x50 + globalOffset, size: rSize });
        }
        offs += offsetToNext;
    }
    return rNameToInfo;
}