
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";
import * as F3DEX from "./f3dex";

// Banjo-Kazooie Geometry

export interface Geometry {
    rspOutput: F3DEX.RSPOutput;
}

export function parse(buffer: ArrayBufferSlice, initialZUpd: boolean): Geometry {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) == 0x0B);
    const f3dexOffs = view.getUint32(0x0C);
    const f3dexCount = view.getUint32(f3dexOffs + 0x00);
    const f3dexData = buffer.subarray(f3dexOffs + 0x08, f3dexCount * 0x08);

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
    segmentBuffers[0x0f] = textureData;

    const state = new F3DEX.RSPState(segmentBuffers);
    // Z_UPD
    state.gDPSetOtherModeL(5, 1, initialZUpd ? 0x20 : 0x00);
    // G_TF_BILERP
    state.gDPSetOtherModeH(12, 2, 0x2000);

    F3DEX.runDL_F3DEX(state, 0x09000000);
    const rspOutput = state.finish();
    return { rspOutput };
}
