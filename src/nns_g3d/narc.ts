
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, hexdump } from "../util";

export interface NitroFSEntry {
    path: string | null;
    fileId: number;
    buffer: ArrayBufferSlice;
}

export interface NitroFS {
    files: NitroFSEntry[];
}

function parseNitroFS(fatBuffer: ArrayBufferSlice, fntBuffer: ArrayBufferSlice, imgBuffer: ArrayBufferSlice): NitroFS {
    const fatView = fatBuffer.createDataView();
    const fntView = fntBuffer.createDataView();

    const files: NitroFSEntry[] = [];

    function getBufferForFileId(fileId: number): ArrayBufferSlice {
        const fatTableOffs = 0x04;
        const fatTableEntryOffs = fatTableOffs + (fileId * 0x08);
        const fileStartOffs = fatView.getUint32(fatTableEntryOffs + 0x00, true);
        const fileEndOffs = fatView.getUint32(fatTableEntryOffs + 0x04, true);
        return imgBuffer.slice(fileStartOffs, fileEndOffs);
    }

    function parseDirectory(fntTableOffs: number, parentPath: string): void {
        const dirEntryOffs = fntView.getUint32(fntTableOffs + 0x00, true);
        const firstFileId = fntView.getUint16(fntTableOffs + 0x04, true);

        let dirEntryIdx = dirEntryOffs;
        let fileId = firstFileId;
        while (true) {
            const type = fntView.getUint8(dirEntryIdx + 0x00);
            dirEntryIdx += 0x01;

            // End of table.
            if (type === 0)
                break;

            const isDirectory = !!(type & 0x80);
            const nameLength = type & 0x7F;
            const name = readString(fntBuffer, dirEntryIdx, nameLength, false);
            const fullPath = `${parentPath}/${name}`;
            dirEntryIdx += nameLength;

            if (isDirectory) {
                const directoryId = fntView.getUint16(dirEntryIdx, true);
                dirEntryIdx += 0x02;
                const subdirFntTableOffs = (directoryId & 0x0FFF) * 0x08;
                parseDirectory(subdirFntTableOffs, fullPath);
            } else {
                const buffer = getBufferForFileId(fileId);
                files.push({ path: fullPath, fileId, buffer });
                fileId++;
            }
        }
    }

    if (fntBuffer.byteLength > 0) {
        parseDirectory(0, '');
    }

    if (files.length === 0) {
        // Fallback case: We don't have a real FNT, so fill in files one by one.
        const fileCount = fatView.getUint32(0x00, true);
        for (let i = 0; i < fileCount - 1; i++) {
            const buffer = getBufferForFileId(i);
            files.push({ path: null, fileId: i, buffer });
        }
    }

    return { files };
}

export function parse(buffer: ArrayBufferSlice): NitroFS {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x06) === 'NARC\xFE\xFF');
    assert(view.getUint16(0x06, true) === 0x0100);
    const fileSize = view.getUint32(0x08, true);
    assert(view.getUint16(0x0C, true) === 0x10);
    assert(view.getUint16(0x0E, true) === 0x03);

    // FATB
    const fatbBlockOffs = 0x10;
    assert(readString(buffer, fatbBlockOffs + 0x00, 0x04) === 'BTAF');
    const fatbBlockSize = view.getUint32(fatbBlockOffs + 0x04, true);
    const fatBuffer = buffer.subarray(fatbBlockOffs + 0x08, fatbBlockSize - 0x08);

    const fntbBlockOffs = fatbBlockOffs + fatbBlockSize;
    assert(readString(buffer, fntbBlockOffs + 0x00, 0x04) === 'BTNF');
    const fntbBlockSize = view.getUint32(fntbBlockOffs + 0x04, true);
    const fntBuffer = buffer.subarray(fntbBlockOffs + 0x08, fntbBlockSize - 0x08);

    const fimgBlockOffs = fntbBlockOffs + fntbBlockSize;
    assert(readString(buffer, fimgBlockOffs + 0x00, 0x04) === 'GMIF');
    const fimgBlockSize = view.getUint32(fimgBlockOffs + 0x04, true);
    const imgBuffer = buffer.subarray(fimgBlockOffs + 0x08, fimgBlockSize - 0x08);
    hexdump(fntBuffer);

    return parseNitroFS(fatBuffer, fntBuffer, imgBuffer);
}
