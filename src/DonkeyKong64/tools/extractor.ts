import ArrayBufferSlice from "../../ArrayBufferSlice";
//import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, nArray, hexdump } from "../../util";
import * as Pako from 'pako';
import * as BYML from "../../byml";
import { SceneContext } from '../../SceneBase';
import { Endianness } from "../../endian";

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
            this.ROM_LittleEndian = this.ROM.convertFromEndianness(Endianness.BIG_ENDIAN, 4);
            this.ROMView = new DataView(this.ROM.arrayBuffer);

            // 215 is num maps
            for (let i = 0; i < 215; i++) {
                let walls = this.loadWalls(i);
                let floors = this.loadFloors(i);
            }
        });
    }

    public decompress(pointer : number): ArrayBufferSlice {
        //TODO: insert check to ensure compressed
        //assert(this.ROMView.getUint32(0x00) === 0x1172, `bad bytes ${view.getUint32(0).toString(16)} from ${buffer.byteOffset.toString(16)}`);
        
        let srcOffs = pointer;
        while (this.ROMView.getUint8(srcOffs) != 0x0) {
            srcOffs++;
        }
        srcOffs++;

        let fileLength = this.ROM.byteLength - srcOffs;
        let byteArray = this.ROM.createTypedArray(Uint8Array, srcOffs);
        
        const decompressed = Pako.inflateRaw(byteArray);
        console.log(decompressed);
        return new ArrayBufferSlice(decompressed.buffer as ArrayBuffer);
    }

    public loadWalls(sceneID : number) : ArrayBufferSlice {
        let wallPointer = this.ROMView.getInt32(ROMHandler.WallTableOffset + sceneID * 4, false);
        wallPointer = wallPointer & 0x7FFFFFFF;
        wallPointer = wallPointer + ROMHandler.PointerTableOffset;
        console.log("READING WALLS " + sceneID + " " + wallPointer.toString(16));
        return this.decompress(wallPointer);
    }

    public loadFloors(sceneID : number) : ArrayBufferSlice {
        let floorPointer = this.ROMView.getInt32(ROMHandler.FloorTableOffset + sceneID * 4, false);
        floorPointer = floorPointer & 0x7FFFFFFF;
        floorPointer = floorPointer + ROMHandler.PointerTableOffset;
        console.log("READING FLOORS " + sceneID + " " + floorPointer.toString(16));
        return this.decompress(floorPointer);
    }

}

