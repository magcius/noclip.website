
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { DataStream } from "./DataStream";
import * as GC_PVRT from './PVRT';

export interface AFXContainer {
    name: string;
    textures: GC_PVRT.PVR_Texture[];
}

interface AFXChunkHeader {
    offset: number;
    size: number;
}

interface AFXHeader {
    datas : AFXChunkHeader[];
}

function readDataHeaderItem(stream: DataStream) : AFXChunkHeader {
    const itemOffset = stream.readUint32();
    const itemSize = stream.readUint32();

    return { offset: itemOffset, size: itemSize };
}

function readDataHeader(stream: DataStream): AFXHeader {
    
    const magic = stream.readString(4);
    assert(magic === "AFS\0");

    const headerCount = stream.readUint32();

    const headerItems: AFXChunkHeader[] = [];
    for(let i=0; i < headerCount; ++i) {
        const item = readDataHeaderItem(stream);
        headerItems.push(item);
    }

    return {datas: headerItems};
}

export function parse(buffer: ArrayBufferSlice, name: string): AFXContainer {

    const stream = new DataStream(buffer);
 
    const afxHeader = readDataHeader(stream);
    assert(afxHeader.datas.length === 2);

    // Note textures can appear in either blob

    const textureBlobOffset = afxHeader.datas[1].offset;
    const textureBlobSize = afxHeader.datas[1].size;
    const textureBlobEnd = textureBlobOffset + textureBlobSize;

    let textures: GC_PVRT.PVR_Texture[] = [];

    stream.offs = textureBlobOffset;
    while(stream.offs < textureBlobEnd) {

        // Align current file offset to 32-bits
        stream.offs = (stream.offs + 31) & ~31;

        const uniqueName = `${name}_${textures.length}`;

        console.log(`parsing ${uniqueName} at ${stream.offs}`);

        const texture = GC_PVRT.parseFromStream(stream, uniqueName);
        textures.push(texture);
    }
    
    return {name, textures};
}
