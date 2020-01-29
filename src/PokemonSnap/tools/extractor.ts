
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, hexzero, nArray, hexdump } from "../../util";
import * as BYML from "../../byml";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/PokemonSnap_Raw`;
const pathBaseOut = `../../../data/PokemonSnap`;

function extractMap(romData: ArrayBufferSlice, sceneID: number, roomStart: number) {
    const view = romData.createDataView(0x57580 + sceneID * 0x24);

    const romStart = view.getUint32(0x00);
    const romEnd = view.getUint32(0x04);
    const StartAddress = view.getUint32(0x08);

    const Data = romData.slice(romStart, romEnd);
    const crg1 = {
        Name: sceneID,
        Data,
        StartAddress,
        Rooms: roomStart,
    };
    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${hexzero(sceneID, 2).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);

    extractMap(romData, 16, 0X80135DBC); // beach
    extractMap(romData, 18, 0X8012FE80); // tunnel
    extractMap(romData, 24, 0X80113624); // volcano
    extractMap(romData, 22, 0x80143AE8); // river
    extractMap(romData, 20, 0x80141500); // cave
    extractMap(romData, 26, 0x8011850C); // valley
    extractMap(romData, 28, 0x80116A50); // rainbow cloud
}

main();
