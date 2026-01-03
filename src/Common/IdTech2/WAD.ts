
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";

export enum WAD2LumpType {
    MIPTEX = 0x44,
}

export enum WAD3LumpType {
    MIPTEX = 0x43,
}

export type WADLumpType = WAD2LumpType | WAD3LumpType;

export interface WADLump {
    name: string;
    type: WADLumpType;
    data: ArrayBufferSlice;
}

export interface WAD {
    version: 2 | 3;
    lumps: WADLump[];
}

export function parseWAD(buffer: ArrayBufferSlice): WAD {
    const view = buffer.createDataView();

    const magic = readString(buffer, 0x00, 0x04);
    assert(magic === 'WAD2' || magic === 'WAD3');
    const version: 2 | 3 = magic === 'WAD2' ? 2 : 3;

    const numlumps = view.getUint32(0x04, true);
    const infotableofs = view.getUint32(0x08, true);

    const lumps: WADLump[] = [];
    let infotableidx = infotableofs;
    for (let i = 0; i < numlumps; i++, infotableidx += 0x20) {
        const filepos = view.getUint32(infotableidx + 0x00, true);
        const disksize = view.getUint32(infotableidx + 0x04, true);
        const size = view.getUint32(infotableidx + 0x08, true);
        assert(size === disksize);
        const type = view.getUint8(infotableidx + 0x0C);
        const compression = view.getUint8(infotableidx + 0x0D);
        assert(compression === 0x00);

        const name = readString(buffer, infotableidx + 0x10, 0x10);

        const data = buffer.subarray(filepos, disksize);
        lumps.push({ name, type, data });
    }

    return { version, lumps };
}
