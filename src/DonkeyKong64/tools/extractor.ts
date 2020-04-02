import ArrayBufferSlice from "../../ArrayBufferSlice";
//import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, nArray, hexdump } from "../../util";
import * as Pako from 'pako';
import * as BYML from "../../byml";
import { SceneContext } from '../../SceneBase';
import { Endianness } from "../../endian";
import { getTileHeight } from "../../Common/N64/RDP";


import * as F3DEX2 from "../f3dex2";
import * as F3DEX from '../../BanjoKazooie/f3dex';
import { TextFilt, ImageFormat, ImageSize } from "../../Common/N64/Image";

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

    public id: number = 0;

    static readonly size = 0x34;

    constructor(bin : ArrayBufferSlice, iChunk ?: number){
        if (iChunk) {
            this.id = iChunk;
        }
        let view = bin.createDataView();
        this.x = view.getInt32(0x00, false);
        this.y = view.getInt32(0x04, false);

        for (let i = 0; i < 4; i++) {
            let currOffset = view.getInt32(0x0C + i* 0x08, false);
            this.dlOffsets[i] = (currOffset);
            this.dlSizes[i] = view.getUint32(0x10 + i* 0x08, false);
        }
        
        this.vertOffset = view.getInt32(0x2C, false);
        this.vertSize = view.getInt32(0x30, false);
    }
}

export class MapSection {
    public meshID: number
    public vertOffsets: number[] = [];

    static readonly size = 0x1C;

    constructor(bin: ArrayBufferSlice){
        let view = bin.createDataView();
        this.meshID = view.getUint16(0x02, false);
        for (let i = 0; i < 8; i++) {
            this.vertOffsets[i] = view.getUint16(0x08 + i*0x02, false);
            
        }
    }
}

export class Map {
    public bin : ArrayBufferSlice
    public header_raw : ArrayBufferSlice
    public vertBin : ArrayBufferSlice
    public f3dexBin : ArrayBufferSlice
    public ChunkCount : number
    public Chunks : MapChunk[] = [];
    public Sections : MapSection[] = [];
    public DisplayLists: DisplayListInfo[] = [];

    // headerInfo
    private F3DStart : number
    private vertStart : number
    private vertEnd : number
    private sectionStart : number
    private sectionEnd : number
    private chunkCountOffset : number
    private chunkStart : number

    constructor (buffer : ArrayBufferSlice) {
        this.bin = buffer;
        let view = this.bin.createDataView();
        this.header_raw = new ArrayBufferSlice(this.bin.arrayBuffer, 0, 0x6C);
        this.ParseHeader();
        this.vertBin = new ArrayBufferSlice(this.bin.arrayBuffer, this.vertStart, (this.vertEnd - this.vertStart));
        this.f3dexBin = new ArrayBufferSlice(this.bin.arrayBuffer, this.F3DStart, (this.vertStart - this.F3DStart));
        this.ChunkCount = view.getUint32(this.chunkCountOffset, false);
        if (this.ChunkCount > 0){
            for (let i = 0; i < this.ChunkCount; i++) {
                this.Chunks[i] = new MapChunk( new ArrayBufferSlice( this.bin.arrayBuffer, this.chunkStart + MapChunk.size * i, MapChunk.size), i );
            }
        }
        for (let i = 0; (i * MapSection.size) < (this.sectionEnd - this.sectionStart); i++) {
            this.Sections[i] = new MapSection( new ArrayBufferSlice( this.bin.arrayBuffer, this.sectionStart + i * MapSection.size + 4, MapSection.size ) );
        }
        console.log(`${this.ChunkCount} CHUNKS PARSED FOR MAP`);
        
        if(this.ChunkCount > 0){
            this.Chunks.forEach(chunk => {
                for(let iDL = 0; iDL < 4; iDL++){
                    if (chunk.dlOffsets[iDL] != -1 && chunk.dlSizes[iDL] != 0){
                        let offst = chunk.dlOffsets[iDL];
                        let sze = chunk.dlSizes[iDL];
                        let snoopPresent = false;
                        let currf3dexCnt = sze;
                        let currf3dexOffset = this.F3DStart + offst;
                        do {
                            let command = view.getUint8(currf3dexOffset);
                            if (command === 0x00){
                                snoopPresent = true;
                                let f3DMeshID = view.getUint32(currf3dexOffset + 0x04, false);
                                var currSection = this.Sections.filter((elem, indx, array) => {return (elem.meshID == f3DMeshID);});
                                if(currSection.length != 0){
                                    this.DisplayLists.push({
                                        ChunkID: chunk.id,
                                        F3dexStartIndex: (currf3dexOffset - this.F3DStart)/8,
                                        VertStartIndex: (chunk.vertOffset/0x10 + currSection[0].vertOffsets[iDL])
                                    });
                                }
                            }
                            currf3dexOffset = currf3dexOffset +8;
                            currf3dexCnt = currf3dexCnt - 8;
                        } while (currf3dexCnt > 0);
                        if(snoopPresent == false){
                            // More than 5 segments to chunk
                            // Include Start as DL
                            this.DisplayLists.push({
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
            this.DisplayLists.push({
                ChunkID: 0,
                F3dexStartIndex: 0,
                VertStartIndex: 0
            });
        }
        console.log(`${this.DisplayLists.length} DISPLAY LISTS FOUND IN MAP MODEL`);
    }

    private ParseHeader(): void{
        let view = this.header_raw.createDataView();
        this.F3DStart = view.getUint32(0x34, false);
        this.vertStart = view.getUint32(0x38, false);
        this.vertEnd = view.getUint32(0x40, false);
        this.sectionStart = view.getUint32(0x58, false);
        this.sectionEnd = view.getUint32(0x5C, false);
        this.chunkCountOffset =view.getUint32(0x64, false);
        this.chunkStart = view.getUint32(0x68, false);
    }
}

function initDL(rspState: F3DEX2.RSPState, opaque: boolean): void {
    rspState.gSPSetGeometryMode(F3DEX2.RSP_Geometry.G_SHADE);
    if (opaque) {
        rspState.gDPSetOtherModeL(0, 29, 0x0C192078); // opaque surfaces
        rspState.gSPSetGeometryMode(F3DEX2.RSP_Geometry.G_LIGHTING);
    } else
        rspState.gDPSetOtherModeL(0, 29, 0x005049D8); // translucent surfaces
    rspState.gDPSetOtherModeH(F3DEX.OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << F3DEX.OtherModeH_Layout.G_MDSFT_TEXTFILT);
    // initially 2-cycle, though this can change
    rspState.gDPSetOtherModeH(F3DEX.OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, F3DEX.OtherModeH_CycleType.G_CYC_2CYCLE << F3DEX.OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    // some objects seem to assume this gets set, might rely on stage rendering first
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
}

function runRoomDL(displayList: number, states: F3DEX2.RSPState): any {
    const rspState = states;
    F3DEX2.runDL_F3DEX2(rspState, displayList);
    const rspOutput = rspState.finish();
    return { sharedOutput: rspState.sharedOutput, rspState, rspOutput };
}

export class ROMHandler {
    public ROM : ArrayBufferSlice
    public ROMView : DataView

    public MapTable : ArrayBufferSlice
    public MapTableView : DataView

    public WallTable : ArrayBufferSlice
    public WallTableView : DataView

    public FloorTable : ArrayBufferSlice
    public FloorTableView : DataView

    public TextureTable : ArrayBufferSlice
    public TextureTableView : DataView

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

            this.WallTable = this.ROM.slice(ROMHandler.WallTableOffset);
            this.WallTableView = this.WallTable.createDataView();
            
            this.FloorTable = this.ROM.slice(ROMHandler.FloorTableOffset);
            this.FloorTableView = this.FloorTable.createDataView();
            
            this.TextureTable = this.ROM.slice(ROMHandler.TextureTableOffset);
            this.TextureTableView = this.TextureTable.createDataView();

            this.MapTable = this.ROM.slice(ROMHandler.MapTableOffset);
            this.MapTableView = this.MapTable.createDataView();
    }

    public decompress(buffer : ArrayBufferSlice): ArrayBufferSlice | null {
        //TODO: insert check to ensure compressed
        let view = buffer.createDataView();
        if(!(view.getUint16(0) === 0x1172    || view.getUint16(0) === 0x1173 
         ||view.getUint16(0) === 0x789C    ||view.getUint16(0) ===0x78DA
         ||view.getUint32(0) ===0x1F8B0800 ||view.getUint32(0) ===0x1F8B0808)){
             return null;
         }

        let srcOffs = 0x0A;

        if (view.getUint32(0) === 0x1F8B0808){
            while (view.getUint8(srcOffs) != 0x0) {
                srcOffs++;
            }
            srcOffs++;
        }

        const decompressed = Pako.inflateRaw(buffer.createTypedArray(Uint8Array, srcOffs), { raw: true });
        return new ArrayBufferSlice(decompressed.buffer as ArrayBuffer);
    }

    public loadWalls(sceneID : number) : ArrayBufferSlice | null {
        let wallPointer = this.WallTableView.getUint32(sceneID * 4, false);
        wallPointer = wallPointer & 0x7FFFFFFF;
        wallPointer = wallPointer + ROMHandler.PointerTableOffset;
        return this.decompress(this.ROM.slice(wallPointer));
    }

    public loadFloors(sceneID : number) : ArrayBufferSlice | null {
        let floorPointer = this.FloorTableView.getInt32(sceneID * 4, false);
        floorPointer = floorPointer & 0x7FFFFFFF;
        floorPointer = floorPointer + ROMHandler.PointerTableOffset;
        return this.decompress(this.ROM.slice(floorPointer));
    }

    public getMap(sceneID : number) : any {
        let map = this.loadMap(sceneID);
        if (map) {
            let currMap = new Map(map);
            
            currMap.DisplayLists.forEach(DL => {
                const sharedOutput = new F3DEX.RSPSharedOutput();
                const state = new F3DEX2.RSPState(sharedOutput, 
                    currMap.vertBin.slice(DL.VertStartIndex * 0x10),
                    currMap.f3dexBin.slice(DL.F3dexStartIndex * 0x08));
                initDL(state, true);

                return runRoomDL(0, state);
            });
            return currMap;
        }
    }

    public loadMap(sceneID : number) : ArrayBufferSlice | null {
        let mapPtr = this.MapTableView.getUint32(sceneID * 4, false);
        mapPtr = mapPtr & 0x7FFFFFFF;
        mapPtr = mapPtr + ROMHandler.PointerTableOffset;
        return this.decompress(this.ROM.slice(mapPtr)); 
    }

    public loadTexture(textureID : number) : ArrayBufferSlice | null {
        let mapPtr = this.TextureTableView.getUint32(textureID * 4, false);
        mapPtr = mapPtr & 0x7FFFFFFF;
        mapPtr = mapPtr + ROMHandler.PointerTableOffset;
        return this.decompress(this.ROM.slice(mapPtr)); 
    }

}

