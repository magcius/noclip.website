import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { DataFetcher } from "../DataFetcher";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import * as MIO0 from "../Common/Compression/MIO0";
import { pathBase } from "./Scenes";

export async function loadFilesystem(dataFetcher: DataFetcher, device: GfxDevice): Promise<Filesystem> {
    const fsbin = await dataFetcher.fetchData(`${pathBase}/filesystem.bin`);
    return await new Filesystem(fsbin);
}

class UVFileChunk {
    tag: string;
    buffer: ArrayBufferSlice;
}

export class UVFile {
    chunks: UVFileChunk[];
}

// Everything is set up to be lazy for now
export class Filesystem {
    //TODO: use magicstr()

    private fileTypeToFileLocations: Map<string, number[]> = new Map();
    private filesBuffer: ArrayBufferSlice;
    private filesDataView: DataView;

    private parsedFilesCache: Map<string, any> = new Map();

    constructor(filesystemBuffer: ArrayBufferSlice) {
        const filesystemView = filesystemBuffer.createDataView();

        // Read length of file table + figure out where file data begins
        const tableLengthBytes = filesystemView.getUint32(4);
        let startOfFiles = 8 + tableLengthBytes;

        // Need to align to 16-byte address
        if ((startOfFiles & 0xF) !== 0) {
            startOfFiles = startOfFiles - (startOfFiles & 0xF) + 0x10;
        }

        this.filesBuffer = filesystemBuffer.slice(startOfFiles);
        this.filesDataView = this.filesBuffer.createDataView();

        // Read file table entries
        let curPos = 12;
        while (curPos < 8 + tableLengthBytes) {
            // Read file type & length
            const fileType = readString(filesystemBuffer, curPos, 4);
            const entryCount = filesystemView.getUint32(curPos + 4) / 4;
            curPos += 8;

            const fileLocations: number[] = [];
            this.fileTypeToFileLocations.set(fileType, fileLocations);

            for (let i = 0; i < entryCount; i++) {
                // Read as Int32 b/c some entries are -1.
                // We can't skip these because it would affect the indices of files
                fileLocations.push(filesystemView.getInt32(curPos));
                curPos += 4;
            }
        }
    }

    // what's the point of a powerful type system if you can't have a little fun with it
    public getOrLoadFile<T>(returnClass: new(uvFile: UVFile, filesystem: Filesystem) => T, type: string, index: number): T {
        let key: string = type + index.toString();
        
        if(this.parsedFilesCache.has(key)) {
            return this.parsedFilesCache.get(key);
        } else {
            let parsedFile = new returnClass(this.getFile(type, index), this);
            this.parsedFilesCache.set(key, parsedFile);
            return parsedFile;
        }
    }

    public getRawFile(index: number): ArrayBufferSlice {
        const fileBegin = this.getFileLocation('UVRW', index);

        //TODO: removeme
        if (readString(this.filesBuffer, fileBegin, 4) === 'FORM') {
            throw new Error(`File at index ${index} is not a raw file!`);
        }

        // File locations are always in order, so the beginning of the next file
        // is the end of this one. (Also the last UVRW is not raw so no risk of OOBE)
        const fileEnd = this.getFileLocation('UVRW', index + 1);
        return this.filesBuffer.slice(fileBegin, fileEnd);
    }


    public getFile(type: string, index: number): UVFile {
        const formBegin = this.getFileLocation(type, index);
        assert(readString(this.filesBuffer, formBegin, 4) === 'FORM', `${type} file at ${index} has no FORM header.`);
        const fileLen = this.filesDataView.getUint32(formBegin + 4);
        return { chunks: this.parseChunks(this.filesBuffer.subarray(formBegin + 8, fileLen)) };
    }

    private getFileLocation(type: string, index: number): number {
        const fileLocs = this.fileTypeToFileLocations.get(type);
        assert(fileLocs !== undefined, `Unrecognized file type ${type}`);
        const fileLocation = fileLocs[index];
        assert(fileLocation !== -1, `File table entry for ${type} file at ${index} is -1`);
        return fileLocation;
    }

    public getFileTypeCount(type: string): number {
        return this.fileTypeToFileLocations.get(type)!.length;
    }

    public getAllLoadedFilesOfType<T>(type: string): T[] {
        const files = [];
        for(let [key, val] of this.parsedFilesCache) {
            if(key.startsWith(type)) {
                files.push(val);
            }
        }
        return files;
    }


    private parseChunks(fileBuffer: ArrayBufferSlice): UVFileChunk[] {
        const fileDataView = fileBuffer.createDataView();
        const chunks: UVFileChunk[] = [];
        let curPos = 4; // skip over magic word, we don't care
        while (curPos < fileBuffer.byteLength) {
            const chunkTag = readString(fileBuffer, curPos, 4);
            const chunkLength = fileDataView.getUint32(curPos + 4);

            // "GZIP" sections are actually compressed using MIO0
            if (chunkTag === 'GZIP') {
                // chunk tag of the compressed data
                const realChunkTag = readString(fileBuffer, curPos + 8, 4);
                const decompressedLength = fileDataView.getUint32(curPos + 12);
                const decompressed = MIO0.decompress(fileBuffer.subarray(curPos + 16, chunkLength - 8));
                assert(decompressed.byteLength === decompressedLength);
                chunks.push({ tag: realChunkTag, buffer: decompressed });
            }
            else if (chunkTag !== 'PAD ') { // PAD sections are always just 0x00000000, no need to parse
                chunks.push({ tag: chunkTag, buffer: fileBuffer.subarray(curPos + 8, chunkLength) });
            }

            curPos += 8 + chunkLength;
        }
        return chunks;
    }

    public destroy(device: GfxDevice): void {
    }
}
