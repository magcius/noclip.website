#!/usr/bin/env ts-node-script

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import ArrayBufferSlice from "../ArrayBufferSlice";
import * as LZ4 from "../Common/Compression/LZ4";
import * as ZIP from "../ZipFile";
import { hexzero0x } from "../util";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer, b.byteOffset, b.byteLength);
}

function doFile(path: string, filename: string, data: ArrayBufferSlice) {
    const view = data.createDataView();
    const assetType = view.getUint32(0x00, true);
    const uncompressedSize = view.getUint32(0x08, true);
    const uncompressed = LZ4.decompress(data.slice(0x0C), uncompressedSize);
    writeFileSync(`${path}${filename}.dec`, Buffer.from(uncompressed.arrayBuffer, 0, uncompressedSize));

    if (assetType === 3) {
        // Shader
        const uview = uncompressed.createDataView();
        const optionsHash = uview.getUint32(0x00, true);

        const depthStencilState = uview.getUint32(0x04, true);
        const blendState = uview.getUint32(0x08, true);
        const rasterState = uview.getUint32(0x0C, true);

        const dumpDepthStencilState = (depthStencilState: number) => {
            const depthWrite = !!((depthStencilState >>> 0) & 0x01);
            const depthEnable = !!((depthStencilState >>> 1) & 0x01);
            const depthFuncIdx = (depthStencilState >>> 2) & 0x07;
            const depthFunc = ['<=', '<', '==', '>', 'ALWAYS'][depthFuncIdx];
            const stencilModeIdx = (depthStencilState >>> 5) & 0x03;
            const stencilMask = (depthStencilState >>> 7) & 0x03;
            return `ds: en ${depthEnable}, wr ${depthWrite}, func ${depthFunc}, stencil mode ${stencilModeIdx}, mask ${hexzero0x(stencilMask, 2)}`;
        };

        const dumpBlendState = (blendState: number) => {
            const blendModeIdx = (blendState >>> 0) & 0x07;
            const blendMode = [`ONE/ZERO`, `SRC_ALPHA/INV_SRC_ALPHA`, 'ONE/ONE', `ONE/INV`, `ZERO/SRC_COLOR`, `DST/SRC_COLOR`, `ONE/SRC_COLOR`, `unk7`][blendModeIdx];
            const colorWrite = !!((blendState >>> 3) & 0x01);
            const alphaWrite = !!((blendState >>> 4) & 0x01);
            const alphaTest = !!((blendState >>> 5) & 0x01);
            const alphaRef = ((blendState >>> 6) & 0xFF);
            return `bl: mode ${blendMode}, color ${colorWrite}, alpha ${alphaWrite}, test ${alphaTest}, ref ${hexzero0x(alphaRef, 2)}`;
        };

        const dumpRasterState = (rasterState: number) => {
            const cullModeIdx = (rasterState >>> 0) & 0x03;
            const cullMode = ['NONE', 'BACK', 'FRONT'][cullModeIdx];
            const fillMode = (rasterState >>> 2) & 0x01;
            const msaaEn = !!((rasterState >>> 3) & 0x01);
            const polygonOffs = !!((rasterState >>> 4) & 0x01);
            const depthClamp = !!((rasterState >>> 5) & 0x01);
            return `rs: cull ${cullMode}, fill ${fillMode}, msaa ${msaaEn}, depth offs ${polygonOffs}, clamp ${depthClamp}`;
        };

        console.log(`${filename}:\n  ${dumpDepthStencilState(depthStencilState)}\n  ${dumpBlendState(blendState)}\n  ${dumpRasterState(rasterState)}\n`);
    }
}

function main() {
    const path = `out/`;
    mkdirSync(path, { recursive: true });
    const filename = process.argv[2];
    const fileData = fetchDataSync(filename);
    if (filename.endsWith('.pkg')) {
        const zip = ZIP.parseZipFile(fileData);
        for (const entry of zip.values())
            doFile(path, entry.filename, entry.data);
    } else {
        doFile(path, filename, fileData);
    }
}

main();
