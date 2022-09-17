
// Valve Packfile. Only handles newest VPK version.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, leftPad, nullify } from "../util";
import { DataFetcher, AbortedCallback } from "../DataFetcher";

interface VPKFileEntryChunk {
    packFileIdx: number;
    chunkOffset: number;
    chunkSize: number;
}

interface VPKFileEntry {
    path: string;
    crc: number;
    chunks: VPKFileEntryChunk[];
    metadataChunk: ArrayBufferSlice | null;
}

interface VPKDirectory {
    entries: Map<string, VPKFileEntry>;
    maxPackFile: number;
}

export function parseVPKDirectory(buffer: ArrayBufferSlice): VPKDirectory {
    const view = buffer.createDataView();
    assert(view.getUint32(0x00, true) === 0x55AA1234);
    const version = view.getUint32(0x04, true);
    const directorySize = view.getUint32(0x08, true);

    let idx: number;
    if (version === 0x01) {
        idx = 0x0C;
    } else if (version === 0x02) {
        const embeddedChunkSize = view.getUint32(0x0C, true);
        assert(embeddedChunkSize === 0);
        const chunkHashesSize = view.getUint32(0x10, true);
        const selfHashesSize = view.getUint32(0x14, true);
        const signatureSize = view.getUint32(0x18, true);
        idx = 0x1C;
    } else {
        throw "whoops";
    }

    // Parse directory.

    let maxPackFile = 0;

    const entries = new Map<string, VPKFileEntry>();
    while (true) {
        const ext = readString(buffer, idx);
        idx += ext.length + 1;
        if (ext.length === 0)
            break;

        while (true) {
            const dir = readString(buffer, idx);
            idx += dir.length + 1;
            if (dir.length === 0)
                break;

            while (true) {
                const filename = readString(buffer, idx);
                idx += filename.length + 1;
                if (filename.length === 0)
                    break;

                const dirPrefix = (dir === '' || dir === ' ') ? '' : `${dir}/`;

                const path = `${dirPrefix}${filename}.${ext}`;
                const crc = view.getUint32(idx, true);
                idx += 0x04;
                const metadataSize = view.getUint16(idx, true);
                idx += 0x02;

                // Parse file chunks.
                const chunks: VPKFileEntryChunk[] = [];
                while (true) {
                    const packFileIdx = view.getUint16(idx + 0x00, true);
                    idx += 0x02;
                    if (packFileIdx === 0xFFFF)
                        break;

                    if (packFileIdx !== 0x07FF)
                        maxPackFile = Math.max(maxPackFile, packFileIdx);

                    const chunkOffset = view.getUint32(idx + 0x00, true);
                    const chunkSize = view.getUint32(idx + 0x04, true);
                    idx += 0x08;

                    if (chunkSize === 0)
                        continue;

                    chunks.push({ packFileIdx, chunkOffset, chunkSize });
                }

                // Read metadata.
                const metadataChunk = metadataSize !== 0 ? buffer.subarray(idx, metadataSize) : null;
                idx += metadataSize;

                entries.set(path, { crc, path, chunks, metadataChunk });
            }
        }
    }

    return { entries, maxPackFile };
}

export class VPKMount {
    private fileDataPromise = new Map<string, Promise<ArrayBufferSlice>>();

    constructor(private basePath: string, private dir: VPKDirectory) {
    }

    private fetchChunk(dataFetcher: DataFetcher, chunk: VPKFileEntryChunk, abortedCallback: AbortedCallback, debugName: string): Promise<ArrayBufferSlice> {
        const packFileIdx = chunk.packFileIdx, rangeStart = chunk.chunkOffset, rangeSize = chunk.chunkSize;
        return dataFetcher.fetchData(`${this.basePath}_${leftPad('' + packFileIdx, 3, '0')}.vpk`, { debugName, rangeStart, rangeSize, abortedCallback });
    }

    public findEntry(path: string): VPKFileEntry | null {
        return nullify(this.dir.entries.get(path));
    }

    private async fetchFileDataInternal(dataFetcher: DataFetcher, entry: VPKFileEntry, abortedCallback: AbortedCallback): Promise<ArrayBufferSlice> {
        const promises = [];
        let size = 0;

        const metadataSize = entry.metadataChunk !== null ? entry.metadataChunk.byteLength : 0;
        size += metadataSize;

        for (let i = 0; i < entry.chunks.length; i++) {
            const chunk = entry.chunks[i];
            promises.push(this.fetchChunk(dataFetcher, chunk, abortedCallback, entry.path));
            size += chunk.chunkSize;
        }

        if (promises.length === 0) {
            assert(entry.metadataChunk !== null);
            return entry.metadataChunk;
        }

        const chunks = await Promise.all(promises);
        if (chunks.length === 1 && entry.metadataChunk === null)
            return chunks[0];

        const buf = new Uint8Array(metadataSize + size);

        let offs = 0;

        // Metadata comes first.
        if (entry.metadataChunk !== null) {
            buf.set(entry.metadataChunk.createTypedArray(Uint8Array), offs);
            offs += entry.metadataChunk.byteLength;
        }

        for (let i = 0; i < chunks.length; i++) {
            buf.set(chunks[i].createTypedArray(Uint8Array), offs);
            offs += chunks[i].byteLength;
        }

        return new ArrayBufferSlice(buf.buffer);
    }

    public fetchFileData(dataFetcher: DataFetcher, entry: VPKFileEntry): Promise<ArrayBufferSlice> {
        if (!this.fileDataPromise.has(entry.path)) {
            this.fileDataPromise.set(entry.path, this.fetchFileDataInternal(dataFetcher, entry, () => {
                this.fileDataPromise.delete(entry.path);
            }));
        }
        return this.fileDataPromise.get(entry.path)!;
    }
}

export async function createVPKMount(dataFetcher: DataFetcher, basePath: string) {
    const dir = parseVPKDirectory(await dataFetcher.fetchData(`${basePath}_dir.vpk`));
    return new VPKMount(basePath, dir);
}
