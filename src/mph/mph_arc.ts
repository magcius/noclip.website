
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";

export interface NitroFSEntry {
    path: string | null;
    fileId: number;
    buffer: ArrayBufferSlice;
}

export interface NitroFS {
    files: NitroFSEntry[];
}

function parseNitroFS(fileCount: number, fileSize: number, imgBuffer: ArrayBufferSlice): NitroFS {
    const imgView = imgBuffer.createDataView();

    const secSize = 0x40;

    function getBufferForFileId(fileId: number): ArrayBufferSlice {
        const fileStartOffs = imgView.getUint32(fileId * secSize + 0x40, false);
        const fileEndOffs = imgView.getUint32(fileId * secSize + 0x48, false);
        return imgBuffer.slice(fileStartOffs, fileStartOffs+fileEndOffs);
    }

    const files: NitroFSEntry[] = [];
    let nameOffset = 0;
    for (let i = 0; i < fileCount; i++) {
        nameOffset = i * secSize + 0x20;
        const buffer = getBufferForFileId(i);
        const name = readString(imgBuffer, nameOffset, 0x20, true);
        files.push({ path: name, fileId: i, buffer });
    }

    return { files };
}

export function parse(buffer: ArrayBufferSlice): NitroFS {
const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x07) === 'SNDFILE');
    const fileCount = view.getUint32(0x08, false);
    const fileSize = view.getUint32(0x0C, false);

    return parseNitroFS(fileCount, fileSize, buffer);
}