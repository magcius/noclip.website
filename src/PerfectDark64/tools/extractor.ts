import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { inflateRawSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { stages, StageID } from "../stages";

import ROM from "../rom";
import type { Inflater }  from "../rom";
import { BGSegment } from "../bg";
import { inflateTexture, InflatedTexture } from "../tex";

const pathROM = `./data/PerfectDark64/pd.ntsc-final.z64`;
const pathBaseOut = `./data/PerfectDark64/`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unique(input: Array<any>): Array<any> {
    return input.filter((v, i, a) => {
        return a.indexOf(v) === i;
    });
}

function writeBGSegments(rom: ROM) {
    const bgSegmentPaths = unique(stages.map(stage => stage.bgPath));
    let size = 0;
    bgSegmentPaths.forEach((path) => {
        const seg = new BGSegment(rom.openFile(path), decompress);
        const outPath = [pathBaseOut, path, ".json"].join("");
        const buf = Buffer.from(JSON.stringify(seg));
        writeFileSync(outPath, buf);

        size += buf.byteLength
    });

    console.info(
        "Wrote", bgSegmentPaths.length, "BG segments,",
        toMiB(size), "MiB",
    );
}

function writePads(rom: ROM) {
    let count = 0;
    let size = 0;

    stages.forEach(v => {
        if (v.padsPath === "") {
            console.warn(`stage ${StageID[v.id]} has no pads path`);
            return;
        }

        const data = decompress(rom.openFile(v.padsPath));
        const outPath = [pathBaseOut, v.padsPath].join("");
        writeFileSync(outPath, data.createTypedArray(Uint8Array));

        count++;
        size += data.byteLength;
    })

    console.info("Wrote", count, "pads,", toMiB(size), "MiB");
}

function writeSetups(rom: ROM) {
    const outBase = pathBaseOut + "setups/";

    let count = 0;
    let size = 0;

    stages.forEach(v => {
        if (v.setupPath === "") {
            console.warn(`stage ${StageID[v.id]} has no setup path`);
            return;
        }

        const data = decompress(rom.openFile(v.setupPath));
        const outPath = [outBase, v.setupPath].join("");
        writeFileSync(outPath, data.createTypedArray(Uint8Array));

        count++;
        size += data.byteLength;
    });

    console.info("Wrote", count, "setups,", toMiB(size), "MiB");
}

function toMiB(v:number): string {
    return (v / 1024 / 1024).toFixed(2);
}

// Write all textures in a big blob and a .json file containing offsets.
// We cannot decompress textures client-side because of the zlib requirement
// and we cannot have the client make 3000+ requests to fetch textures, this is
// the compromise.
function writeTextureData(rom: ROM) {
    const outBase = pathBaseOut + "textures/";
    mkdirSync(outBase, {recursive: true});

    let inflatedSize = 0;
    const meta: tex.InflatedTexture[] = [];

    // Arbitrary, must be able to contain all decompressed textures.
    let bigBin = new Uint8Array(5 << 20);

    rom.textureData.forEach((data, i) => {
        const texture: InflatedTexture = {index: i};
        const [decompressed, palette] = inflateTexture(texture, data, decompress);
        if (decompressed.byteLength <= 0) {
            // FIXME: Silence until we implement other decompression methods.
            // console.warn(`unable to inflate texture #${i}`);
            return;
        }

        texture.size = decompressed.byteLength;
        texture.offset = inflatedSize;
        texture.addr = rom.textureList[i].dataOffset;

        const view = decompressed.createDataView();
        for (let i = 0; i < decompressed.byteLength; i++) {
            bigBin[texture.offset + i] = view.getUint8(i);
        }

        inflatedSize += decompressed.byteLength;

        if (palette === null) {
            meta.push(texture);
            return;
        }

        assert(texture.numColors > 0, "texture has a palette but no colors");
        const palView = palette.createDataView();
        texture.palOffset = inflatedSize;
        texture.palSize = palette.byteLength;

        for (let i = 0; i < palView.byteLength; i++) {
            bigBin[texture.palOffset + i] = palView.getUint8(i);
        }

        inflatedSize += palette.byteLength;

        meta.push(texture);
    });

    bigBin = bigBin.subarray(0, inflatedSize);
    const binPath = pathBaseOut + "textures.bin";
    writeFileSync(binPath, bigBin);

    console.info(
        "Wrote texture data:", binPath,
        meta.length, "/", rom.textureData.length, "textures,",
        toMiB(bigBin.byteLength), "MiB",
    );

    const metaPath = pathBaseOut + "textures.json";
    const buf = Buffer.from(JSON.stringify(meta));
    writeFileSync(metaPath, buf);
    console.info("Wrote texture index:", metaPath+",", toMiB(buf.byteLength), "MiB");
}

function main() {
    const rom = new ROM(pathROM, decompress);

    mkdirSync(pathBaseOut + "bgdata", {recursive: true});
    mkdirSync(pathBaseOut + "setups", {recursive: true});

    writeBGSegments(rom);
    writePads(rom);
    writeSetups(rom);
    writeTextureData(rom);
}

const compressedMagicHeader = 0x1173;

// pd64 uses zlib-compressed data with a custom header:
//   uint16 magic string
//   uint24 decompressed size
//   []byte zlib-compressed data
// There's no compressed data size, only zlib knows when to stop.
// The decompression routine in pd64 also works on uncompressed data so every
// file should be automatically and _optionally_ decompressed when read.
// Despite this behaviour, compressed files larger than their uncompressed data
// can be found.
// HACK: This is kept here and injected into the ROM/BGSegment DI-style to
// avoid importing zlib into files imported by client-side code.
const decompress: Inflater = function(buf: ArrayBufferSlice): ArrayBufferSlice {
    const view = buf.createDataView();

    // Uncompressed file, return as-is.
    if (view.getUint16(0) !== compressedMagicHeader) {
        return buf;
    }

    const expectedDecompressedSize = view.getUint32(2) >>> 8;
    const decompressed = inflateRawSync(buf.createTypedArray(Uint8Array, 5));
    if (expectedDecompressedSize !== decompressed.length) {
        throw new Error("decompressed data size doesn't match header");
    }

    return ArrayBufferSlice.fromView(decompressed);
}

main();
