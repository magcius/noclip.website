
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

    function getBufferForFileId(fileId: number): ArrayBufferSlice {
        const fileStartOffs = imgView.getUint32(fileId * 0x40 + 0x30, true);
        const fileEndOffs = imgView.getUint32(fileId * 0x40 + 0x34, true);
        return imgBuffer.slice(fileStartOffs, fileEndOffs);
    }

    const files: NitroFSEntry[] = [];
    let nameOffset = 0;
    for (let i = 0; i < fileCount; i++) {
        nameOffset = i * 0x40;
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

    return parseNitroFS(fileCount, fileSize, buffer.slice(0x20, buffer.byteLength));
}