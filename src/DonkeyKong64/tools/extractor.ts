import ArrayBufferSlice from "../../ArrayBufferSlice";
//import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, nArray, hexdump } from "../../util";
import * as Pako from 'pako';
import * as BYML from "../../byml";
import { SceneContext } from '../../SceneBase';
import { Endianness } from "../../endian";
import { getTileHeight } from "../../Common/N64/RDP";

/*
function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}
*/

const pathBaseIn  = `../../../data/DonkeyKong64_Raw`;
const pathBaseOut = `../../../data/DonkeyKong64`;

export class ROMHandler {
    public ROM : ArrayBufferSlice
    public ROM_LittleEndian : ArrayBufferSlice
    public ROMView : DataView

    public MapTable : ArrayBufferSlice
    public MapTableView : DataView

    public WallTable : ArrayBufferSlice
    public WallTableView : DataView

    public FloorTable : ArrayBufferSlice
    public FloorTableView : DataView

    // USA pointer table locations
    static readonly PointerTableOffset = 0x101C50;
    static readonly MapTableOffset = 0x15232C;
    static readonly WallTableOffset = 0x43CBEC;
    static readonly FloorTableOffset = 0x63CA6C;
    static readonly SetupTableOffset = 0xD0E86C;
    static readonly StructTableOffset = 0x82A06C;
    static readonly ActorModelTableOffset = 0x8D3018;
    static readonly TextureTableOffset = 0x118B638;

    constructor(context: SceneContext) {
        const dataFetcher = context.dataFetcher;
        dataFetcher.fetchData(`${pathBaseIn}/dk64.z64`).then((buffer) => {
            this.ROM = buffer;
            //this.ROM_LittleEndian = this.ROM.convertFromEndianness(Endianness.BIG_ENDIAN, 4);
            this.ROMView = new DataView(this.ROM.arrayBuffer);

            this.WallTable = new ArrayBufferSlice(this.ROM.arrayBuffer, ROMHandler.WallTableOffset, 215*4);
            this.WallTableView = this.WallTable.createDataView();
            
            this.FloorTable = new ArrayBufferSlice(this.ROM.arrayBuffer, ROMHandler.FloorTableOffset, 215*4);
            this.FloorTableView = this.FloorTable.createDataView();
            
            this.MapTable = new ArrayBufferSlice(this.ROM.arrayBuffer, ROMHandler.MapTableOffset, 215*4);
            this.MapTableView = this.MapTable.createDataView();

            //ToDo don't unpack all at once, pull when scene/object is needed
            // 215 is num maps
            for (let i = 0; i < 215; i++) {
                let maps = this.loadMaps(i);
                if(maps){console.log(`map for scene ${i} decompressed`);}

                let walls = this.loadWalls(i);
                if(walls){console.log(`walls for scene ${i} decompressed`);}
                
                let floors = this.loadFloors(i);
                if(floors){console.log(`floors for scene ${i} decompressed`);}
            }
        });
    }

    public decompress(buffer : ArrayBufferSlice): ArrayBufferSlice | null {
        //TODO: insert check to ensure compressed
        //assert(this.ROMView.getUint32(0x00) === 0x1172, `bad bytes ${view.getUint32(0).toString(16)} from ${buffer.byteOffset.toString(16)}`);
        let view = buffer.createDataView();
        /*assert((view.getUint16(0) === 0x1172 
                || view.getUint16(0) === 0x1173 
                ||view.getUint16(0) === 0x789C 
                ||view.getUint16(0) ===0x78DA
                ||view.getUint32(0) ===0x1F8B0800
                ||view.getUint32(0) ===0x1F8B0808
            ), `bad bytes ${view.getUint32(0).toString(16)} from ${buffer.byteOffset.toString(16)}`);*/
        if(!(view.getUint16(0) === 0x1172    || view.getUint16(0) === 0x1173 
         ||view.getUint16(0) === 0x789C    ||view.getUint16(0) ===0x78DA
         ||view.getUint32(0) ===0x1F8B0800 ||view.getUint32(0) ===0x1F8B0808)){
             //console.log(`bad bytes ${view.getUint32(0).toString(16)} from ${buffer.byteOffset.toString(16)}`);
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
        //console.log(decompressed);
        return new ArrayBufferSlice(decompressed.buffer as ArrayBuffer);
    }

    public loadWalls(sceneID : number) : ArrayBufferSlice | null {
        let wallPointer = this.WallTableView.getUint32(sceneID * 4, false);
        wallPointer = wallPointer & 0x7FFFFFFF;
        wallPointer = wallPointer + ROMHandler.PointerTableOffset;
        console.log("READING WALLS " + sceneID + " " + wallPointer.toString(16));
        return this.decompress(this.ROM.slice(wallPointer));
    }

    public loadFloors(sceneID : number) : ArrayBufferSlice | null {
        let floorPointer = this.ROMView.getInt32(ROMHandler.FloorTableOffset + sceneID * 4, false);
        floorPointer = floorPointer & 0x7FFFFFFF;
        floorPointer = floorPointer + ROMHandler.PointerTableOffset;
        console.log("READING FLOORS " + sceneID + " " + floorPointer.toString(16));
        return this.decompress(this.ROM.slice(floorPointer));
    }

    public loadMaps(sceneID : number) : ArrayBufferSlice | null {
        let mapPtr = this.MapTableView.getUint32(sceneID * 4, false);
        mapPtr = mapPtr & 0x7FFFFFFF;
        mapPtr = mapPtr + ROMHandler.PointerTableOffset;
        console.log("READING MODEL " + sceneID + " " + mapPtr.toString(16));
        return this.decompress(this.ROM.slice(mapPtr)); 
    }

}

