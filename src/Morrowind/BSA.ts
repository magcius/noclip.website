
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { NamedArrayBufferSlice } from "../DataFetcher.js";
import { assert, readString } from "../util.js";

export class BSA {
    public files: NamedArrayBufferSlice[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        assert(view.getUint32(0x00, true) === 0x00000100);

        const hashTableOffs = 0x0C + view.getUint32(0x04, true);
        const fileCount = view.getUint32(0x08, true);

        let fileTableIdx = 0x0C;
        let fileNameOffsetIdx = fileTableIdx + fileCount * 0x08;
        const fileNameTableOffs = fileNameOffsetIdx + fileCount * 0x04;
        const fileDataOffs = hashTableOffs + fileCount * 0x08;
        for (let i = 0; i < fileCount; i++) {
            const size = view.getUint32(fileTableIdx + 0x00, true);
            const dataOffs = fileDataOffs + view.getUint32(fileTableIdx + 0x04, true);
            const data = buffer.subarray(dataOffs, size) as NamedArrayBufferSlice;

            const nameOffs = fileNameTableOffs + view.getUint32(fileNameOffsetIdx + 0x00, true);
            const name = readString(buffer, nameOffs);
            data.name = name;
            this.files.push(data);

            fileTableIdx += 0x08;
            fileNameOffsetIdx += 0x04;
        }
    }

    public findFileData(path: string): NamedArrayBufferSlice | null {
        for (let i = 0; i < this.files.length; i++)
            if (this.files[i].name === path)
                return this.files[i];
        return null;
    }
}
