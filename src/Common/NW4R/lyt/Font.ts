
import { assert, assertExists, readString } from "../../../util";
import * as GX from '../../../gx/gx_enum';
import { TextureInputGX } from '../../../gx/gx_texture';
import { NamedArrayBufferSlice } from "../../../DataFetcher";

const enum RFNTGlyphType {
    Glyph, Texture,
}

const enum RFNTEncoding {
    UTF8, UTF16, SJIS, CP1252,
}

const enum RFNTCMAPKind { Offset, Array, Dict }

interface RFNTCWDHEntry {
    leftSideBearing: number;
    width: number;
    advanceWidth: number;
}

interface RFNTFINF {
    encoding: RFNTEncoding;
    width: number;
    height: number;
    ascent: number;
    defaultGlyphIndex: number;
    defaultCWDH: RFNTCWDHEntry;
}

interface RFNTTGLP {
    glyphCellW: number;
    glyphCellH: number;
    glyphBaseline: number;
    textureGlyphPerRow: number;
    textureGlyphPerCol: number;
    textures: TextureInputGX[];
}

export interface RFNT extends RFNTFINF, RFNTTGLP {
    cmap: Uint16Array;
    cwdh: RFNTCWDHEntry[];
}

export function parseBRFNT(buffer: NamedArrayBufferSlice): RFNT {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RFNT');
    const littleEndianMarker = view.getUint16(0x04);
    assert(littleEndianMarker === 0xFEFF || littleEndianMarker === 0xFFFE);
    const littleEndian = (littleEndianMarker === 0xFFFE);
    assert(!littleEndian);
    const fileVersion = view.getUint16(0x06);
    assert(fileVersion === 0x0104);
    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    let tableIdx = rootSectionOffs + 0x00;

    let finf: RFNTFINF | null = null;
    let tglp: RFNTTGLP | null = null;
    const cmap = new Uint16Array(0x10000).fill(0xFFFF);
    const cwdh: RFNTCWDHEntry[] = [];

    for (let i = 0; i < numSections; i++) {
        // blockSize includes the header.
        const blockOffs = tableIdx;
        const fourcc = readString(buffer, blockOffs + 0x00, 0x04, false);
        const blockSize = view.getUint32(blockOffs + 0x04);
        const blockContentsOffs = blockOffs + 0x08;

        if (fourcc === 'FINF') {
            // Font Info
            const fontType = view.getUint8(blockContentsOffs + 0x00);
            assert(fontType === RFNTGlyphType.Texture);

            const advanceHeight = view.getUint8(blockContentsOffs + 0x01);
            const defaultGlyphIndex = view.getUint16(blockContentsOffs + 0x02);
            const defaultLeftSideBearing = view.getInt8(blockContentsOffs + 0x04);
            const defaultWidth = view.getUint8(blockContentsOffs + 0x05);
            const defaultAdvanceWidth = view.getInt8(blockContentsOffs + 0x06);
            const defaultCWDH: RFNTCWDHEntry = {
                leftSideBearing: defaultLeftSideBearing,
                width: defaultWidth,
                advanceWidth: defaultAdvanceWidth,
            };

            const encoding = view.getUint8(blockContentsOffs + 0x07);
            assert(encoding === RFNTEncoding.UTF16);

            // const tglpOffs = view.getUint32(blockContentsOffs + 0x08);
            // const cwdhOffs = view.getUint32(blockContentsOffs + 0x0C);
            // const cmapOffs = view.getUint32(blockContentsOffs + 0x10);

            const height = view.getUint8(blockContentsOffs + 0x15);
            const width = view.getUint8(blockContentsOffs + 0x14);
            const ascent = view.getUint8(blockContentsOffs + 0x16);

            finf = { encoding, width, height, ascent, defaultGlyphIndex, defaultCWDH };
        } else if (fourcc === 'TGLP') {
            const glyphCellW = view.getUint8(blockContentsOffs + 0x00);
            const glyphCellH = view.getUint8(blockContentsOffs + 0x01);
            const glyphBaseline = view.getUint8(blockContentsOffs + 0x02);
            const glyphW2 = view.getUint8(blockContentsOffs + 0x03);
            const texDataSize = view.getUint32(blockContentsOffs + 0x04);
            const texCount = view.getUint16(blockContentsOffs + 0x08);
            const texFormat: GX.TexFormat = view.getUint16(blockContentsOffs + 0x0A);
            const textureGlyphPerRow = view.getUint16(blockContentsOffs + 0x0C);
            const textureGlyphPerCol = view.getUint16(blockContentsOffs + 0x0E);
            const texWidth = view.getUint16(blockContentsOffs + 0x10);
            const texHeight = view.getUint16(blockContentsOffs + 0x12);
            const texDataOffs = view.getUint32(blockContentsOffs + 0x14);

            const textures: TextureInputGX[] = [];

            let texDataIdx = texDataOffs;
            for (let i = 0; i < texCount; i++, texDataIdx += texDataSize) {
                textures.push({
                    name: `${buffer.name} Texture ${i}`, width: texWidth, height: texHeight, format: texFormat,
                    data: buffer.subarray(texDataIdx, texDataSize), mipCount: 1,
                });
            }

            tglp = { glyphCellW, glyphCellH, glyphBaseline, textureGlyphPerRow, textureGlyphPerCol, textures };
        } else if (fourcc === 'CWDH') {
            const glyphStart = view.getUint16(blockContentsOffs + 0x00);
            const glyphEnd = view.getUint16(blockContentsOffs + 0x02);
            // const cwdhNextOffs = view.getUint32(blockContentsOffs + 0x04);

            let tableIdx = blockContentsOffs + 0x08;
            for (let i = glyphStart; i <= glyphEnd; i++, tableIdx += 0x03) {
                const leftSideBearing = view.getInt8(tableIdx + 0x00);
                const width = view.getUint8(tableIdx + 0x01);
                const advanceWidth = view.getInt8(tableIdx + 0x02);
                cwdh[i] = { leftSideBearing, width, advanceWidth };
            }
        } else if (fourcc === 'CMAP') {
            const codeStart = view.getUint16(blockContentsOffs + 0x00);
            const codeEnd = view.getUint16(blockContentsOffs + 0x02);
            const kind: RFNTCMAPKind = view.getUint16(blockContentsOffs + 0x04);
            // const cmapNextOffs = view.getUint32(blockContentsOffs + 0x08);

            if (kind === RFNTCMAPKind.Offset) {
                const offset = view.getUint16(blockContentsOffs + 0x0C);
                for (let i = codeStart; i <= codeEnd; i++)
                    cmap[i] = i - codeStart + offset;
            } else if (kind == RFNTCMAPKind.Array) {
                let tableIdx = blockContentsOffs + 0x0C;
                for (let i = codeStart; i <= codeEnd; i++, tableIdx += 0x02)
                    cmap[i] = view.getUint16(tableIdx + 0x00);
            } else if (kind === RFNTCMAPKind.Dict) {
                const entryNum = view.getUint16(blockContentsOffs + 0x0C);
                let tableIdx = blockContentsOffs + 0x0A;
                for (let i = 0; i < entryNum; i++, tableIdx += 0x04)
                    cmap[view.getUint16(tableIdx + 0x00)] = view.getUint16(tableIdx + 0x02);
            }
        } else {
            throw "whoops";
        }

        tableIdx += blockSize;
    }

    return {
        ... assertExists(finf),
        ... assertExists(tglp),
        cmap,
        cwdh,
    };
}
