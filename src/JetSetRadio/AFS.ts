
import ArrayBufferSlice from "../ArrayBufferSlice";
import type { NamedArrayBufferSlice } from "../DataFetcher";
import { assert, readString } from "../util";

export interface AFS {
    files: NamedArrayBufferSlice[];
}

export function parse(buffer: ArrayBufferSlice): AFS {
    const files: NamedArrayBufferSlice[] = [];

    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04, false) === 'AFS\0');

    const numFiles = view.getUint32(0x04, true);

    let dataTableOffs = 0x08;

    const firstDataOffs = view.getUint32(dataTableOffs + 0x00, true);
    let nameTableOffs = view.getUint32(firstDataOffs - 0x08, true);

    for (let i = 0; i < numFiles; i++, dataTableOffs += 0x08, nameTableOffs += 0x30) {
        const name = readString(buffer, nameTableOffs + 0x00, 0x20, true);

        const dataOffs = view.getUint32(dataTableOffs + 0x00, true);
        const dataSize = view.getUint32(dataTableOffs + 0x04, true);
        const data = buffer.subarray(dataOffs, dataSize) as NamedArrayBufferSlice;
        data.name = name;
        files.push(data);
    }

    return { files };
}
