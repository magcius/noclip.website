
// https://zeldamods.org/wiki/TSCB

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";

export interface AreaInfo {
    x: number;
    y: number;
    areaSize: number;
    filename: string;
}

export interface TSCB {
    worldScale: number;
    tileSize: number;
    altitude: number;
    areaInfos: AreaInfo[];
}

export function parse(buffer: ArrayBufferSlice): TSCB {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'TSCB');
    assert(view.getUint32(0x04, false) === 0x0A000000);
    assert(view.getUint32(0x08, false) === 0x01);
    const filenameTableOffs = view.getUint32(0x0C, false);
    const worldScale = view.getFloat32(0x10, false);
    const altitude = view.getFloat32(0x14, false);
    const materialInfoTableCount = view.getUint32(0x18, false);
    const areaTableCount = view.getUint32(0x1C, false);
    const tileSize = view.getFloat32(0x28, false);

    // Skip past material info table.
    const materialInfoTableOffs = 0x30;
    const materialInfoTableSize = view.getUint32(materialInfoTableOffs + 0x00, false);

    const areaTableOffs = materialInfoTableOffs + materialInfoTableSize;
    let areaTableIdx = areaTableOffs;
    const areaInfos: AreaInfo[] = [];
    for (let i = 0; i < areaTableCount; i++) {
        const areaInfoOffs = areaTableIdx + view.getUint32(areaTableIdx + 0x00, false);
        areaTableIdx += 0x04;

        const x = view.getFloat32(areaInfoOffs + 0x00, false);
        const y = view.getFloat32(areaInfoOffs + 0x04, false);
        const areaSize = view.getFloat32(areaInfoOffs + 0x08, false);
        const filenameOffs = view.getUint32(areaInfoOffs + 0x20, false);
        const filename = readString(buffer, areaInfoOffs + 0x20 + filenameOffs, 0xFF, true);

        // const hasExtraInfo = view.getUint32(areaInfoOffs + 0x2C, false);

        areaInfos.push({ x, y, areaSize, filename });
    }

    return { worldScale, tileSize, altitude, areaInfos };
}
