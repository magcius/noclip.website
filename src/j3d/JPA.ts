
// JParticle's JPAC2-10 resource file, as seen in Super Mario Galaxy, amongst other
// Nintendo games. JPAC1-00 is an older variant which is unsupported.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, hexzero } from "../util";
import { BTI } from "./j3d";

export interface JPAResource {
    resourceId: number;
    data: ArrayBufferSlice;
}

export interface JPAC {
    effects: JPAResource[];
    textures: BTI[];
}

export function parse(buffer: ArrayBufferSlice): JPAC {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x08) === 'JPAC2-10');

    const effectCount = view.getUint16(0x08);
    const textureCount = view.getUint16(0x0A);
    const textureTableOffs = view.getUint32(0x0C);

    const effects: JPAResource[] = [];
    let effectTableIdx = 0x10;
    for (let i = 0; i < effectCount; i++) {
        const resourceId = view.getUint16(effectTableIdx + 0x00);
        const blockCount = view.getUint16(effectTableIdx + 0x02);
        const fieldBlockCount = view.getUint8(effectTableIdx + 0x04);
        const keyBlockCount = view.getUint8(effectTableIdx + 0x05);
        // Unknown at 0x06. Seemingly unused?

        const resourceBeginOffs = effectTableIdx;

        // Parse through the blocks.
        effectTableIdx += 0x08;
        for (let j = 0; j < blockCount; j++) {
            // blockSize includes the header.
            const fourcc = readString(buffer, effectTableIdx + 0x00, 0x04, false);
            const blockSize = view.getUint32(effectTableIdx + 0x04);

            if (fourcc === 'BEM1') {
                // J3DDynamicsBlock
            } else if (fourcc === 'BSP1') {
                // J3DBaseShape
            } else if (fourcc === 'ESP1') {
                // J3DExtraShape
            } else if (fourcc === 'SSP1') {
                // J3DChildShape
            } else if (fourcc === 'ETX1') {
                // J3DExTexShape
            } else if (fourcc === 'KFA1') {
                // J3DKeyBlock
            } else if (fourcc === 'FLD1') {
                // J3DFieldBlock
            } else if (fourcc === 'TDB1') {
                // Not a block. Stores a mapping of particle texture indexes
                // to JPAC texture indices -- I assume this is "Texture Database".
            } else {
                throw "whoops";
            }

            effectTableIdx += blockSize;
        }

        const rawData = buffer.slice(resourceBeginOffs, effectTableIdx);
        effects.push({ resourceId, data: rawData });
    }

    const textures: BTI[] = [];
    let textureTableIdx = textureTableOffs;
    for (let i = 0; i < textureCount; i++) {
        assert(readString(buffer, textureTableIdx + 0x00, 0x04, false) === 'TEX1');
        const blockSize = view.getUint32(textureTableIdx + 0x04);
        const textureName = readString(buffer, textureTableIdx + 0x0C, 0x14, true);
        const texture = BTI.parse(buffer.slice(textureTableIdx + 0x20, textureTableIdx + blockSize), textureName);
        textures.push(texture);
        textureTableIdx += blockSize;
    }

    return { effects, textures };
}
