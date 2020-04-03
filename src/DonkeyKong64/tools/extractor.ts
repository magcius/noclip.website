
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";

import * as BYML from '../../byml';
import * as Pako from 'pako';
import { assert } from "../../util";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/DonkeyKong64_Raw`;
const pathBaseOut = `../../../data/DonkeyKong64`;

function determineSizeOfZlibStream(buffer: ArrayBufferSlice, srcOffs: number): number {
    const view = buffer.createDataView();
    assert(view.getUint32(srcOffs + 0x00) === 0x1F8B0800);

    const inflator = new Pako.Inflate({ raw: true });
    const data = buffer.createTypedArray(Uint8Array, srcOffs + 0x0A);
    inflator.push(data, true);

    // Munge internals to retrieve size
    const strm = (inflator as any).strm;
    const size = data.byteLength - strm.avail_in;

    return 0x0A + size;
}

function cutZlibBuffer(buffer: ArrayBufferSlice, srcOffs: number): ArrayBufferSlice {
    const size = determineSizeOfZlibStream(buffer, srcOffs);
    return buffer.subarray(srcOffs, size);
}

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);
    const view = romData.createDataView();

    // USA pointer table locations
    const PointerTableOffset = 0x101C50;
    const MapTableOffset = 0x15232C;
    const WallTableOffset = 0x43CBEC;
    const FloorTableOffset = 0x63CA6C;
    const SetupTableOffset = 0xD0E86C;
    const StructTableOffset = 0x82A06C;
    const ActorModelTableOffset = 0x8D3018;
    const TextureTableOffset = 0x118B638;

    // Map data table.
    const MapData: (ArrayBufferSlice | number)[] = [];
    let mapTableIdx = MapTableOffset;
    for (let i = 0; i < 0xD8; i++) {
        const mapDataPtr = view.getUint32(mapTableIdx + 0x00);

        const offs = (mapDataPtr & 0x7FFFFFFF) + PointerTableOffset;
        if (!!(mapDataPtr & 0x80000000)) {
            // Indirect reference to another map.
            const otherMap = view.getUint16(offs);
            MapData[i] = otherMap;
        } else {
            // TODO(jstpierre): Extract the proper size, and decompress on client.
            MapData[i] = cutZlibBuffer(romData, offs);
        }

        mapTableIdx += 0x04;
    }

    // Texture data table.
    const TexData: ArrayBufferSlice[] = [];
    // TODO(jstpierre): Proper count
    let texTableIdx = TextureTableOffset;
    for (let i = 0; i < 0x900; i++) {
        const texDataPtr = view.getUint32(texTableIdx + 0x00);

        const offs = (texDataPtr & 0x7FFFFFFF) + PointerTableOffset;
        TexData[i] = cutZlibBuffer(romData, offs);

        texTableIdx += 0x04;
    }

    const crg1 = {
        MapData,
        TexData,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/ROM_arc.crg1`, Buffer.from(data));
}

main();
