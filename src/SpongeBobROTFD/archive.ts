import ArrayBufferSlice from "../ArrayBufferSlice";
import { DataFetcher } from "../DataFetcher";
import { DataStream } from "./util";
import * as CRC32 from "crc-32";
import { mat4 } from "gl-matrix";

export const ResourceType = {
    SURFACE: 1,
    SPLINE: 2,
    SKIN: 3,
    ROTSHAPE: 4,
    LOD: 5,
    MESH: 6,
    CAMERA: 7,
    OCCLUDER: 10,
    CAMERAZONE: 11,
    LIGHT: 12,
    HFOG: 13,
    COLLISIONVOL: 14,
    OMNI: 16,
    PARTICLES: 18
}

export const FileType = {
    ANIMATION: CRC32.bstr("ANIMATION"),
    BITMAP: CRC32.bstr("BITMAP"),
    CAMERA: CRC32.bstr("CAMERA"),
    CAMERAZONE: CRC32.bstr("CAMERAZONE"),
    COLLISIONVOL: CRC32.bstr("COLLISIONVOL"),
    GAMEOBJ: CRC32.bstr("GAMEOBJ"),
    HFOG: CRC32.bstr("HFOG"),
    LIGHT: CRC32.bstr("LIGHT"),
    LOD: CRC32.bstr("LOD"),
    MATERIAL: CRC32.bstr("MATERIAL"),
    MATERIALANIM: CRC32.bstr("MATERIALANIM"),
    MATERIALOBJ: CRC32.bstr("MATERIALOBJ"),
    MESH: CRC32.bstr("MESH"),
    NODE: CRC32.bstr("NODE"),
    OCCLUDER: CRC32.bstr("OCCLUDER"),
    OMNI: CRC32.bstr("OMNI"),
    PARTICLES: CRC32.bstr("PARTICLES"),
    ROTSHAPE: CRC32.bstr("ROTSHAPE"),
    RTC: CRC32.bstr("RTC"),
    SKIN: CRC32.bstr("SKIN"),
    SOUND: CRC32.bstr("SOUND"),
    SPLINE: CRC32.bstr("SPLINE"),
    SURFACE: CRC32.bstr("SURFACE"),
    TXT: CRC32.bstr("TXT"),
    USERDEFINE: CRC32.bstr("USERDEFINE"),
    WARP: CRC32.bstr("WARP"),
    WORLD: CRC32.bstr("WORLD"),
}

/******************\
|* READ UTILITIES *|
\******************/

export type THeader = {
    floats_unk: number[];
    transform: mat4;
    junk: void;
    type: number;
    flags: number;
}

export function readTHeader(data: DataStream): THeader {
    return {
        floats_unk: data.readArrayStatic(data.readFloat32, 4),
        transform: data.readMat4(),
        junk: data.readJunk(16),
        type: data.readUint16(),
        flags: data.readUint16(),
    }
}

/****************\
|* READ ARCHIVE *|
\****************/

export class TotemFile {
    constructor(
        public readonly data: ArrayBufferSlice,
        public readonly nameHash: number,
        public readonly typeHash: number,
        public readonly flags: number,
    ) { }
}

export class TotemArchive {
    private data = new Map<number, TotemFile>();

    addFile(fileNameHash: number, file: TotemFile) {
        this.data.set(fileNameHash, file);
    }

    getFile(fileNameHash: number): TotemFile | undefined {
        return this.data.get(fileNameHash);
    }
    
    *iterFilesOfType(typeHash: number) {
        for (const [key, file] of this.data.entries()) {
            if (file.typeHash === typeHash) {
                yield file;
            }
        }
    }
}

export async function loadArchive(dataFetcher: DataFetcher, path: string): Promise<TotemArchive> {
    const dgc = await dataFetcher.fetchData(`${path}.DGC`);
    // const ngc = await dataFetcher.fetchData(`${path}.NGC`);
    const dstream = new DataStream(dgc, 256, false);
    const chunkSize = dstream.readUint32();
    dstream.offs = 2048;
    let archive = new TotemArchive();
    while (dstream.offs < dstream.buffer.byteLength) {
        const nextpos = dstream.offs + chunkSize;
        const numFiles = dstream.readUint32();
        for (let i = 0; i < numFiles; i++) {
            const fileSize = dstream.readUint32();
            const fileTypeHash = dstream.readInt32();
            const fileNameHash = dstream.readInt32();
            const fileFlags = dstream.readUint32();
            const data = dstream.readSlice(fileSize - 16);
            archive.addFile(fileNameHash, new TotemFile(data, fileNameHash, fileTypeHash, fileFlags));
        }
        dstream.offs = nextpos;
    }
    return archive;
}