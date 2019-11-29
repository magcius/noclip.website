
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { DataStream } from "./DataStream";
import * as GC_PVRT from './PVRT';

export interface AFSContainer {
    name: string;
    textures: GC_PVRT.PVR_Texture[];
}

interface AFSChunkHeader {
    offset: number;
    size: number;
}

interface AFSHeader {
    datas : AFSChunkHeader[];
}

function readDataHeaderItem(stream: DataStream) : AFSChunkHeader {
    const itemOffset = stream.readUint32();
    const itemSize = stream.readUint32();

    return { offset: itemOffset, size: itemSize };
}

function readDataHeader(stream: DataStream): AFSHeader {
    
    const magic = stream.readString(4);
    assert(magic === "AFS\0");

    const headerCount = stream.readUint32();

    const headerItems: AFSChunkHeader[] = [];
    for(let i=0; i < headerCount; ++i) {
        const item = readDataHeaderItem(stream);
        headerItems.push(item);
    }

    return {datas: headerItems};
}

export function parse(buffer: ArrayBufferSlice, name: string): AFSContainer {

    const stream = new DataStream(buffer);
 
    const header = readDataHeader(stream);
    let textures: GC_PVRT.PVR_Texture[] = [];

    for(let i=0; i<header.datas.length; ++i) {

        const textureBlobOffset = header.datas[i].offset;
        const textureBlobSize = header.datas[i].size;
        const textureBlobEnd = textureBlobOffset + textureBlobSize;

        stream.offs = textureBlobOffset;
        while(stream.offs < textureBlobEnd) {
            // Align current file offset to 32-bits
            stream.offs = (stream.offs + 31) & ~31;

            if (GC_PVRT.canParse(stream) === false)
                break;

            const uniqueName = `${name}_${textures.length}`;

            console.log(`parsing ${uniqueName} at ${stream.offs}`);

            try {
            const texture = GC_PVRT.parseFromStream(stream, uniqueName);
            textures.push(texture);
            } catch (e) {
                console.warn(`File ${uniqueName} failed to parse:`, e);
            }
        }
    }

    return {name, textures};
}
