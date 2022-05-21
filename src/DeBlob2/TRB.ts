
import ArrayBufferSlice from "../ArrayBufferSlice";
import type { NamedArrayBufferSlice } from "../DataFetcher";
import { assert, readString } from "../util";


const TRB_HEADER_SIZE = 0x80;

export interface TRB {
    namebuffer: ArrayBufferSlice;
    partitions: TRBPartition[];
    assets: TRBAssetInfo[];
}

export interface TRBPartition {
    data: NamedArrayBufferSlice;
    name: string;
    type: number;
    nameOffset: number;
    references: TRBAssetReference[];
}

export interface TRBAssetInfo {
    type: number;
    offset: number; 
    partitionId: number;
    nameOffset: number;
    name: string;     
}

export interface TRBAssetReference {
    offset: number; 
    name: string;
    nameOffset: number; 
    assetid: number; 
    type: number;
}


function parseReferenceInfo(buffer: ArrayBufferSlice, dataOffs:number ): TRBAssetReference {
    const view = buffer.createDataView();
    const name = "NO NAME";
    const offset = view.getUint32(dataOffs + 0x00, true);
    const nameOffset = view.getUint32(dataOffs + 0x04, true);
    const assetid = view.getUint32(dataOffs + 0x08, true);
    const type = view.getUint32(dataOffs + 0x0C, true);
    return {offset,name,nameOffset,assetid,type}
}

function parsePartitionInfo(buffer: ArrayBufferSlice, dataOffs:number ): TRBPartition {

    const view = buffer.createDataView();
    
    const references : TRBAssetReference[] = [];
    const name = "NO NAME";
    const unk0 = view.getUint32(dataOffs + 0x00, true);
    const nameOffset = view.getUint32(dataOffs + 0x04, true);
    const unk1 = view.getUint32(dataOffs + 0x08, true);
    const type = view.getUint32(dataOffs + 0x0C, true);
    const compressedSize = view.getUint32(dataOffs + 0x10, true);
    const uncompressedSize = view.getUint32(dataOffs + 0x14, true);
    const offset = view.getUint32(dataOffs+ 0x18, true);
    const unk2 = view.getUint32(dataOffs + 0x1C, true);
    const unk3 = view.getUint32(dataOffs + 0x20, true);
    // + 0x24: 0x04 bytes always 0 
    const assetCount = view.getUint32(dataOffs + 0x28, true);
    let assetOffset = view.getUint32(dataOffs + 0x2C, true);

    const data =  buffer.subarray(offset, uncompressedSize) as NamedArrayBufferSlice;  

    if (assetCount!==0) {
        assetOffset+=TRB_HEADER_SIZE; // This is relative to after the header. 
        for (let ai = 0; ai < assetCount; ai++, assetOffset+=0x10) {
            let refAsset = parseReferenceInfo(buffer,assetOffset);
            references.push(refAsset);
        }
    }
    return {data,name,type,nameOffset,references}
}


function parseAssetInfo(buffer: ArrayBufferSlice, dataOffs: number) : TRBAssetInfo {
    const view = buffer.createDataView();
    const name = "NO NAME";
    const type = view.getUint32(dataOffs + 0x00, true);
    const offset =  view.getUint32(dataOffs + 0x04, true);
    const partitionId = view.getUint32(dataOffs + 0x00, true);
    const nameOffset = view.getUint32(dataOffs + 0x0C, true);

    return {type, offset, partitionId, nameOffset, name}
}


export function parse(buffer: ArrayBufferSlice): TRB {

    const partitions : TRBPartition[] = [];
    const assets : TRBAssetInfo[] = [];

    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04, false) === 'TRB\0');

    const version = view.getUint32(0x04, true);
    const partitionId = view.getUint32(0x08, true);
    const numPartitions = view.getUint32(0x0C, true);
    const sizePartitions = view.getUint32(0x10, true);
    const numAssets = view.getUint32(0x14, true);
    const sizeAssets = view.getUint32(0x18, true);
    const relocTableOffset = view.getUint32(0x1C, true);
    const relocTableSize = view.getUint32(0x20, true);

    // Start loading partitions 
    let partitionTableOfs = TRB_HEADER_SIZE; 
    for (let i = 0; i < numPartitions; i++, partitionTableOfs += 0x30) {
        partitions.push(parsePartitionInfo(buffer,partitionTableOfs))
    }
    // Load assets
    let assetTableOffs = TRB_HEADER_SIZE + sizePartitions;
    for (let i = 0; i < numAssets; i++, assetTableOffs += 0x10) {
        assets.push(parseAssetInfo(buffer, assetTableOffs));
    }

    const namebuffer = partitions[0].data; // xayrga: Looks like the first section is always the .TEXT section?

    // Load the names for the partitions and references. 
    for (let i = 0; i < numPartitions; i++) {
        let part = partitions[i]
        part.name = readString(namebuffer,part.nameOffset, 0x80,true);
        for (let rI = 0; rI < part.references.length; rI++) {
            let ref = part.references[rI];
            ref.name = readString(namebuffer,ref.nameOffset, 0x80,true);
        }        
    }

    // Load names for assets
    for (let i = 0; i < numAssets; i++) {
        let asset = assets[i];
        asset.name = readString(namebuffer,asset.nameOffset, 0x80,true);
    }

    return { namebuffer, partitions,assets };
}
