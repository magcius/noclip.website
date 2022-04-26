
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, assertExists, hexzero0x, readString } from "../../util";
import * as TRB from '../TRB';
import * as BYML from "../../byml";
import { Console } from "console";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer);
}

const pathBaseIn  = `../../../data/Deblob_Raw`;
const pathBaseOut = `../../../data/Deblob`;

const data = TRB.parse(fetchDataSync(`${pathBaseOut}/LEVELS/PRODUCTION_BLOB2/Singleplayer/01_SP_PARADISE_ISLAND/terrain.trb`));

for (let i=0; i < data.partitions.length;i++) {
    let par = data.partitions[i];
    if (i==2) {
        const asset = data.assets;
        for (let b = 0; b < asset.length; b++) {
            
            console.log("\t" + asset[b].name + " " );
        }
    }

    console.log(par.name);
}