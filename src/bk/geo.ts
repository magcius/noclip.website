
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexdump, hexzero, align } from "../util";
import * as F3DEX from "./f3dex";

// Banjo-Kazooie Geometry

export interface Geometry {
    rspOutput: F3DEX.RSPOutput;
}

export function parse(buffer: ArrayBufferSlice, initialZUpd: boolean): Geometry {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) == 0x0B);
    const geoOffs = view.getUint32(0x04);

    const f3dexOffs = view.getUint32(0x0C);
    const f3dexCount = view.getUint32(f3dexOffs + 0x00);
    const f3dexData = buffer.subarray(f3dexOffs + 0x08, f3dexCount * 0x08);

    hexdump(buffer, 0x00, 0x40);

    const vertexDataOffs = view.getUint32(0x10);
    const vertexCount = view.getUint16(0x32);
    const vertexWordCount = view.getUint16(vertexDataOffs + 0x16);
    const vertexData = buffer.subarray(vertexDataOffs + 0x18, vertexCount * 0x10);

    const textureSetupOffs = view.getUint16(0x08);
    const textureSetupSize = view.getUint32(textureSetupOffs + 0x00);
    const textureCount = view.getUint8(textureSetupOffs + 0x05);
    const textureDataOffs = textureSetupOffs + 0x08 + (textureCount * 0x10);
    const textureData = buffer.slice(textureDataOffs, textureSetupOffs + textureSetupSize);

    // Construct a segment buffer.
    const segmentBuffers: ArrayBufferSlice[] = [];
    segmentBuffers[0x01] = vertexData;
    segmentBuffers[0x02] = textureData;
    segmentBuffers[0x09] = f3dexData;
    segmentBuffers[0x0F] = textureData;

    const state = new F3DEX.RSPState(segmentBuffers);
    // Z_UPD
    state.gDPSetOtherModeL(5, 1, initialZUpd ? 0x20 : 0x00);
    // G_TF_BILERP
    state.gDPSetOtherModeH(12, 2, 0x2000);

    let geoIdx = geoOffs;

    // It is common for the file to randomly end in the middle of geometry.
    // I'm not sure what determines it, or if the game's parser reads until the
    // end of the decompressed buffer it has...
    while (geoIdx < buffer.byteLength) {
        const cmd = view.getUint32(geoIdx + 0x00);
        // console.log(hexzero(cmd, 0x08));
        if (cmd === 0x00) {
            // NOOP?
            geoIdx += 0x04;
        } else if (cmd === 0x01) {
            // Unknown. Skip.
            geoIdx += 0x28;
        } else if (cmd === 0x02) {
            // BONE. Skip.
            geoIdx += 0x10;
        } else if (cmd === 0x03) {
            // LOAD DL.
            const unkFlag = view.getUint32(geoIdx + 0x04);

            const segmentStart = view.getUint16(geoIdx + 0x08);
            const triCount = view.getUint16(geoIdx + 0x0A);
            F3DEX.runDL_F3DEX(state, 0x09000000 + segmentStart * 0x08);
            geoIdx += 0x10;
        } else if (cmd === 0x08) {
            // Unknown. Skip.
            geoIdx += 0x20;
        } else if (cmd === 0x0A) {
            // Unknown. Skip.
            geoIdx += 0x18;
        } else if (cmd === 0x0C) {
            // Unknown. Skip.
            const dataSize = view.getUint32(geoIdx + 0x0C);
            // hexdump(buffer, geoIdx, 0x100);
            geoIdx += dataSize;
        } else if (cmd === 0x0D) {
            // DRAW DISTANCE. Skip.
            geoIdx += 0x18;
        } else if (cmd === 0x0E) {
            // Unknown. Skip.
            // hexdump(buffer, geoIdx, 0x100);
            geoIdx += 0x30;
        } else if (cmd === 0x0F) {
            const count = view.getUint8(geoIdx + 0x0A);
            // hexdump(buffer, geoIdx, 0x20);
            geoIdx += 0x0C + align(count, 4);
        } else if (cmd === 0x10) {
            // Unknown. Skip.
            const contFlag = view.getUint32(geoIdx + 0x04);
            geoIdx += 0x10;
        } else {
            throw "whoops";
        }
    }

    const rspOutput = state.finish();
    return { rspOutput };
}
