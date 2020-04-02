import ArrayBufferSlice from "../../ArrayBufferSlice";
//import { readFileSync, writeFileSync } from "fs";
import { assertExists, hexdump, hexzero } from "../../util";
import * as Pako from 'pako';

/*
function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}
*/

export class DisplayListInfo {
    public ChunkID: number;
    public F3dexStartIndex: number;
    public VertStartIndex: number;
}

export class MapChunk {
    public x: number
    public y: number
    public z: number

    public dlOffsets: number[] = [];
    public dlSizes: number[] = [];
    public vertOffset: number
    public vertSize: number

    static readonly size = 0x34;

    constructor(bin: ArrayBufferSlice, public id: number) {
        let view = bin.createDataView();
        this.x = view.getInt32(0x00);
        this.y = view.getInt32(0x04);

        let dlTableIdx = 0x0C;
        for (let i = 0; i < 4; i++) {
            this.dlOffsets[i] = view.getInt32(dlTableIdx + 0x00);
            this.dlSizes[i] = view.getUint32(dlTableIdx + 0x04);
            dlTableIdx += 0x08;
        }

        this.vertOffset = view.getInt32(0x2C);
        this.vertSize = view.getUint32(0x30);
    }
}

export class MapSection {
    public meshID: number
    public vertOffsets: number[] = [];

    static readonly size = 0x1C;

    constructor(bin: ArrayBufferSlice) {
        let view = bin.createDataView();
        this.meshID = view.getUint16(0x02, false);
        for (let i = 0; i < 8; i++)
            this.vertOffsets[i] = view.getUint16(0x08 + i*0x02);
    }
}

export class Map {
    public bin: ArrayBufferSlice;
    public vertBin: ArrayBufferSlice;
    public f3dexBin: ArrayBufferSlice;
    public chunkCount: number;
    public chunks: MapChunk[] = [];
    public sections: MapSection[] = [];
    public displayLists: DisplayListInfo[] = [];

    // headerInfo
    private dlStart: number;
    private vertStart: number;
    private vertEnd: number;
    private sectionStart: number;
    private sectionEnd: number;
    private chunkCountOffset: number;
    private chunkStart: number;

    constructor(buffer: ArrayBufferSlice) {
        this.bin = buffer;

        const view = this.bin.createDataView();
        this.dlStart = view.getUint32(0x34, false);
        this.vertStart = view.getUint32(0x38, false);
        this.vertEnd = view.getUint32(0x40, false);
        this.sectionStart = view.getUint32(0x58, false);
        this.sectionEnd = view.getUint32(0x5C, false);
        this.chunkCountOffset = view.getUint32(0x64, false);
        this.chunkStart = view.getUint32(0x68, false);

        this.f3dexBin = this.bin.slice(this.dlStart, this.vertStart);
        this.vertBin = this.bin.slice(this.vertStart, this.vertEnd);

        this.chunkCount = view.getUint32(this.chunkCountOffset, false);

        if (this.chunkCount > 0) {
            for (let i = 0; i < this.chunkCount; i++) {
                const chunkBuffer = this.bin.subarray(this.chunkStart + MapChunk.size * i, MapChunk.size);
                this.chunks[i] = new MapChunk(chunkBuffer, i);
            }
        }

        for (let i = 0; (i * MapSection.size) < (this.sectionEnd - this.sectionStart); i++) {
            const sectionBuffer = this.bin.subarray(this.sectionStart + i * MapSection.size + 4, MapSection.size);
            this.sections[i] = new MapSection(sectionBuffer);
        }

        console.log(`${this.chunkCount} CHUNKS PARSED FOR MAP`);
        
        if (this.chunkCount > 0) {
            this.chunks.forEach(chunk => {
                for(let iDL = 0; iDL < 4; iDL++){
                    if (chunk.dlOffsets[iDL] != -1 && chunk.dlSizes[iDL] != 0){
                        let offst = chunk.dlOffsets[iDL];
                        let sze = chunk.dlSizes[iDL];
                        let snoopPresent = false;
                        let currf3dexCnt = sze;
                        let currf3dexOffset = this.dlStart + offst;
                        do {
                            let command = view.getUint8(currf3dexOffset);
                            if (command === 0x00) {
                                snoopPresent = true;
                                let f3DMeshID = view.getUint32(currf3dexOffset + 0x04, false);
                                var currSection = this.sections.filter((elem, indx, array) => {return (elem.meshID == f3DMeshID);});
                                if(currSection.length != 0){
                                    this.displayLists.push({
                                        ChunkID: chunk.id,
                                        F3dexStartIndex: (currf3dexOffset - this.dlStart)/8,
                                        VertStartIndex: (chunk.vertOffset/0x10 + currSection[0].vertOffsets[iDL])
                                    });
                                }
                            }
                            else if (command === 0xDE){
                                let tmpDLOff = view.getUint32(currf3dexOffset + 0x04);
                                tmpDLOff = tmpDLOff & 0x00FFFFFF;
                                this.displayLists.push({
                                    ChunkID: chunk.id,
                                    F3dexStartIndex: (tmpDLOff)/8,
                                    VertStartIndex: chunk.vertOffset/0x10
                                });
                            }
                            currf3dexOffset = currf3dexOffset + 8;
                            currf3dexCnt = currf3dexCnt - 8;
                        } while (currf3dexCnt > 0);
                        if(snoopPresent == false){
                            // More than 5 segments to chunk
                            // Include Start as DL
                            this.displayLists.push({
                                ChunkID: chunk.id,
                                F3dexStartIndex: offst/0x08, 
                                VertStartIndex: chunk.vertOffset/0x10
                            });
                        }
                    }
                }
            });
        }
        else{
            this.displayLists.push({
                ChunkID: 0,
                F3dexStartIndex: 0,
                VertStartIndex: 0
            });
        }
        console.log(`${this.displayLists.length} DISPLAY LISTS FOUND IN MAP MODEL`);
    }
}

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice | null {
    const view = buffer.createDataView();

    if (view.getUint32(0x00) === 0x1F8B0800) {
        const srcOffs = 0x0A;
        const decompressed = Pako.inflateRaw(buffer.createTypedArray(Uint8Array, srcOffs), { raw: true });
        return new ArrayBufferSlice(decompressed.buffer as ArrayBuffer);
    }

    return null;
}

export class ROMHandler {
    public ROM: ArrayBufferSlice;
    public ROMView: DataView;

    public SetupTable: ArrayBufferSlice;
    public SetupTableView: DataView;

    public ActorModels: Array<number>;

    public StructTable: ArrayBufferSlice;
    public StructTableView: DataView;

    public MapTable: ArrayBufferSlice;
    public MapTableView: DataView;

    public WallTable: ArrayBufferSlice;
    public WallTableView: DataView;

    public FloorTable: ArrayBufferSlice;
    public FloorTableView: DataView;

    public TextureTable: ArrayBufferSlice;
    public TextureTableView: DataView;

    static readonly pathBaseIn  = `../../../data/DonkeyKong64_Raw`;
    static readonly pathBaseOut = `../../../data/DonkeyKong64`;

    // USA pointer table locations
    static readonly PointerTableOffset = 0x101C50;
    static readonly MapTableOffset = 0x15232C;
    static readonly WallTableOffset = 0x43CBEC;
    static readonly FloorTableOffset = 0x63CA6C;
    static readonly SetupTableOffset = 0xD0E86C;
    static readonly StructTableOffset = 0x82A06C;
    static readonly ActorModelTableOffset = 0x8D3018;
    static readonly TextureTableOffset = 0x118B638;

    constructor(ROM : ArrayBufferSlice) {
        this.ROM = ROM;
        this.ROMView = new DataView(this.ROM.arrayBuffer);

        this.SetupTable = this.ROM.slice(ROMHandler.SetupTableOffset);
        this.SetupTableView = this.SetupTable.createDataView();

        this.WallTable = this.ROM.slice(ROMHandler.WallTableOffset);
        this.WallTableView = this.WallTable.createDataView();
        
        this.FloorTable = this.ROM.slice(ROMHandler.FloorTableOffset);
        this.FloorTableView = this.FloorTable.createDataView();
        
        this.TextureTable = this.ROM.slice(ROMHandler.TextureTableOffset);
        this.TextureTableView = this.TextureTable.createDataView();

        this.MapTable = this.ROM.slice(ROMHandler.MapTableOffset);
        this.MapTableView = this.MapTable.createDataView();

        this.StructTable = this.ROM.slice(ROMHandler.StructTableOffset);
        this.StructTableView = this.StructTable.createDataView();

        // Hook up Actor behaviour indexes to Actor model indexes
        let bigDataBlobContents = decompress(this.ROM.slice(0xC29D4));
        if (bigDataBlobContents !== null) {
            let bigDataBlobView = bigDataBlobContents.createDataView();

            this.ActorModels = [];
            for (let i = 0; i < 127; i++) {
                let modelBase = 0xA450 + i * 0x30;
                let behavior = bigDataBlobView.getInt16(modelBase);
                let modelIndex = bigDataBlobView.getInt16(modelBase + 0x02);
                this.ActorModels[behavior] = modelIndex;
            }
    
            let actorModelPointerTable = this.ROM.slice(ROMHandler.ActorModelTableOffset);
            let actorModelPointerTableView = actorModelPointerTable.createDataView();
            for (let i = 0; i < 237; i++) {
                let modelPointer = actorModelPointerTableView.getInt32(i * 4, false) + ROMHandler.PointerTableOffset;
                for (let j = 0; j < this.ActorModels.length; j++) {
                    if (i + 1 == this.ActorModels[j]) {
                        this.ActorModels[j] = modelPointer;
                    }
                }
            }
        }
    }

    private decompressAsset(addr: number): ArrayBufferSlice {
        const offs = (addr & 0x7FFFFFFF) + ROMHandler.PointerTableOffset;

        const decompressed = decompress(this.ROM.slice(offs));
        if (decompressed !== null)
            return decompressed;

        // TODO(jstpierre): Figure out what this means... indirection into the asset table, perhaps?
        throw "whoops";
    }

    public loadSetup(sceneID: number) : ArrayBufferSlice {
        let pointer = this.SetupTableView.getUint32(sceneID * 4, false);
        if (pointer & 0x80000000) {
            pointer = pointer & 0x7FFFFFFF;
            return this.loadSetup(this.ROMView.getUint16(pointer + ROMHandler.PointerTableOffset, false));
        }
        return this.decompressAsset(this.SetupTableView.getUint32(sceneID * 4, false));
    }

    public loadWalls(sceneID: number) : ArrayBufferSlice {
        let pointer = this.WallTableView.getUint32(sceneID * 4, false);
        if (pointer & 0x80000000) {
            pointer = pointer & 0x7FFFFFFF;
            return this.loadWalls(this.ROMView.getUint16(pointer + ROMHandler.PointerTableOffset, false));
        }
        return this.decompressAsset(this.WallTableView.getUint32(sceneID * 4, false));
    }

    public loadFloors(sceneID: number): ArrayBufferSlice {
        let pointer = this.FloorTableView.getUint32(sceneID * 4, false);
        if (pointer & 0x80000000) {
            pointer = pointer & 0x7FFFFFFF;
            return this.loadFloors(this.ROMView.getUint16(pointer + ROMHandler.PointerTableOffset, false));
        }
        return this.decompressAsset(this.FloorTableView.getInt32(sceneID * 4, false));
    }

    public loadMap(sceneID: number): ArrayBufferSlice {
        let pointer = this.MapTableView.getUint32(sceneID * 4, false);
        if (pointer & 0x80000000) {
            pointer = pointer & 0x7FFFFFFF;
            return this.loadMap(this.ROMView.getUint16(pointer + ROMHandler.PointerTableOffset, false));
        }
        return this.decompressAsset(this.MapTableView.getUint32(sceneID * 4, false));
    }

    public loadTexture(textureID: number): ArrayBufferSlice {
        return this.decompressAsset(this.TextureTableView.getUint32(textureID * 4, false));
    }

    public getMap(sceneID: number): Map {
        const mapData = assertExists(this.loadMap(sceneID));
        return new Map(mapData);
    }

    public getActorModel(behaviorID: number): ArrayBufferSlice {
        // Note: Some actors don't have models, not sure exactly what to do there
        return this.decompressAsset(this.ActorModels[behaviorID]);
    }

    public getStructModel(behaviorID: number): ArrayBufferSlice {
        return this.decompressAsset(this.StructTableView.getUint32(behaviorID * 4, false));
    }
}
