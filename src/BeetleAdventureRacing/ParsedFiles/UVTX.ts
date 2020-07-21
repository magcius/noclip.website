import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { ImageFormat, ImageSize, decodeTex_RGBA16, decodeTex_I4, decodeTex_I8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, getImageFormatName, getImageSizeName, decodeTex_CI4, parseTLUT, TextureLUT } from "../../Common/N64/Image";

// only the limited number of commands UVTX actually uses.
export enum F3DEX2_GBI {
    G_TEXTURE = 0xD7,
    G_ENDDL = 0xDF,

    // RDP
    G_SETTIMG = 0xFD,
    G_SETCOMBINE = 0xFC,
    G_SETENVCOLOR = 0xFB,
    G_SETPRIMCOLOR = 0xFA,
    G_SETTILE = 0xF5,
    G_LOADTILE = 0xF4,
    G_LOADBLOCK = 0xF3,
    G_SETTILESIZE = 0xF2,
    G_RDPTILESYNC = 0xE8,
    G_RDPLOADSYNC = 0xE6,
    G_SETOTHERMODE_H = 0xE3
}

export class UVTX {
    public not_supported_yet = false;
    public convertedTexelData: Uint8Array;
    public tile_sLo: number;
    public tile_tLo: number;
    public tile_sHi: number;
    public tile_tHi: number;
    public width: number;
    public height: number;

    // TODO: i've barely done any reverse engineering here,
    // mostly just educated guesses based on looking at the
    // files themselves
    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const buffer = uvFile.chunks[0].buffer;
        const view = buffer.createDataView();
        let curPos = 0;

        const dataSize = view.getUint16(0);
        const dlCommandCount = view.getUint16(2);
        curPos += 4;

        const unknownFloats = [
            view.getFloat32(curPos + 0),
            view.getFloat32(curPos + 4),
            view.getFloat32(curPos + 8),
            view.getFloat32(curPos + 12),
            view.getFloat32(curPos + 16),
            view.getFloat32(curPos + 20)
        ];
        curPos += 24;

        const texelData = buffer.subarray(curPos, dataSize);
        curPos += dataSize;
        const dlCommandsData = buffer.subarray(curPos, dlCommandCount * 8);
        curPos += dlCommandCount * 8;

        // TODO: what are all these? also double check image width and height
        const imageWidth = view.getUint16(curPos + 0);
        const imageHeight = view.getUint16(curPos + 2);
        const unk1 = view.getUint8(curPos + 4); // 1
        const unk2 = view.getUint8(curPos + 5); // 1
        const unk3 = view.getUint8(curPos + 6); // 1
        const unk4 = view.getUint32(curPos + 7); // 4
        const unk5 = view.getUint16(curPos + 11); // 2
        const unk6 = view.getUint16(curPos + 13); // 2
        const unk7 = view.getUint8(curPos + 15); // 1
        const unk8 = view.getUint8(curPos + 16); // 1
        const unk9 = view.getUint8(curPos + 17); // 1
        const unk10 = view.getUint8(curPos + 18); // 1
        const unk11 = view.getUint8(curPos + 19); // 1
        const unk12 = view.getUint32(curPos + 20); // 4
        const unk13 = view.getUint8(curPos + 24); // 1


        // includes full size texture, so minimum is 1.
        // TODO: not a good name
        const mipMapCount = view.getUint8(curPos + 25);
        curPos += 26;

        // then read palettes if there are any to read
        // TODO: unk7 is not just a bool - what is it
        const palettesData: ArrayBufferSlice[] = [];
        if (unk7 == 0) {
            for (let i = 0; i < mipMapCount; i++) {
                //TODO(?)
                // i+1 because 0 palette is reserved or something
                palettesData[i + 1] = buffer.subarray(curPos, 32);
                curPos += 32;
            }
        }






        // Now that we have read the full file data, let's turn it into something
        // we can use in noclip
        // TODO: maybe use runDL_F3DEX2?
        const cmdCount = dlCommandsData.byteLength / 8;
        const cmdView = dlCommandsData.createDataView();

        let indexOfTileToUseWhenTexturing = -1;
        // all in 10.2 fixed point
        let tile_sLo = Number.NaN;
        let tile_tLo = Number.NaN;
        let tile_sHi = Number.NaN;
        let tile_tHi = Number.NaN;

        let tile_format = Number.NaN;
        let tile_bitSize = Number.NaN;
        let tile_wordsPerLine = Number.NaN;
        let tile_paletteIndex = Number.NaN;

        //let load_format = Number.NaN;
        //let load_bitSize = Number.NaN;
        for (let i = 0; i < cmdCount; i++) {
            const w0 = cmdView.getUint32(i * 8);
            const w1 = cmdView.getUint32((i * 8) + 4);

            const cmd: F3DEX2_GBI = w0 >>> 24;

            // TODO: this is *extremely* hacky code just to get something visible.
            // It misses a *ton* of details
            switch (cmd) {
                case F3DEX2_GBI.G_TEXTURE: {
                    const tileIndex = (w0 >>> 8) & 0x07;
                    indexOfTileToUseWhenTexturing = tileIndex;
                } break;
                case F3DEX2_GBI.G_SETTIMG: {
                    //load_format = (w0 >>> 21) & 0x07;
                    //load_bitSize = (w0 >>> 19) & 0x03;
                } break;
                case F3DEX2_GBI.G_SETTILE: {
                    const fmt = (w0 >>> 21) & 0x07;
                    const siz = (w0 >>> 19) & 0x03;
                    const line = (w0 >>> 9) & 0x1FF;
                    const tmem = (w0 >>> 0) & 0x1FF;
                    const tileIndex = (w1 >>> 24) & 0x07;
                    const palette = (w1 >>> 20) & 0x0F;

                    if (tileIndex === indexOfTileToUseWhenTexturing) {
                        tile_format = fmt;
                        tile_bitSize = siz;
                        tile_wordsPerLine = line;
                        tile_paletteIndex = palette;
                    }
                } break;
                case F3DEX2_GBI.G_SETTILESIZE: {
                    const sLo = (w0 >>> 12) & 0x0FFF;
                    const tLo = (w0 >>> 0) & 0x0FFF;
                    const tileIndex = (w1 >>> 24) & 0x07;
                    const sHi = (w1 >>> 12) & 0x0FFF;
                    const tHi = (w1 >>> 0) & 0x0FFF;
                    if (tileIndex === indexOfTileToUseWhenTexturing) {
                        tile_sLo = sLo / 4;
                        tile_tLo = tLo / 4;
                        tile_sHi = sHi / 4;
                        tile_tHi = tHi / 4;
                    }
                } break;
                case F3DEX2_GBI.G_ENDDL:
                    break;


                case F3DEX2_GBI.G_LOADBLOCK: {
                    const sLo = (w0 >>> 12) & 0x0FFF;
                    const tLo = (w0 >>> 0) & 0x0FFF;
                    const tileIndex = (w1 >>> 24) & 0x07;
                    const sHi = (w1 >>> 12) & 0x0FFF;
                    const dxt = (w1 >>> 0) & 0x0FFF;

                    assert(tileIndex === 7);
                    assert(sLo === 0 && tLo === 0);
                    assert(dxt === 0);
                } break;
                default:
                    break;
            }
        }

        /////
        if (Number.isNaN(tile_sLo) || Number.isNaN(tile_tLo) || Number.isNaN(tile_sHi) || Number.isNaN(tile_tHi) ||
            Number.isNaN(tile_wordsPerLine) || Number.isNaN(tile_format) || Number.isNaN(tile_bitSize) ||
            Number.isNaN(tile_paletteIndex)) {
            console.warn("NAN, skipping");
            this.not_supported_yet = true;
            return;
        }

        let tileWidth = (tile_sHi - tile_sLo) + 1;
        let tileHeight = (tile_tHi - tile_tLo) + 1;
        assert(tileWidth === Math.round(tileWidth));
        assert(tileHeight === Math.round(tileHeight));
        assert(tileWidth === imageWidth);
        assert(tileHeight === imageHeight);


        const dest = new Uint8Array(tileWidth * tileHeight * 4);
        const texelDataView = texelData.createDataView();

        if (tile_format === ImageFormat.G_IM_FMT_RGBA && tile_bitSize === ImageSize.G_IM_SIZ_16b) decodeTex_RGBA16(dest, texelDataView, 0, tileWidth, tileHeight, tile_wordsPerLine, true);
        else if (tile_format === ImageFormat.G_IM_FMT_I && tile_bitSize === ImageSize.G_IM_SIZ_4b) decodeTex_I4(dest, texelDataView, 0, tileWidth, tileHeight, tile_wordsPerLine, true);
        else if (tile_format === ImageFormat.G_IM_FMT_I && tile_bitSize === ImageSize.G_IM_SIZ_8b) decodeTex_I8(dest, texelDataView, 0, tileWidth, tileHeight, tile_wordsPerLine, true);
        else if (tile_format === ImageFormat.G_IM_FMT_IA && tile_bitSize === ImageSize.G_IM_SIZ_4b) decodeTex_IA4(dest, texelDataView, 0, tileWidth, tileHeight, tile_wordsPerLine, true);
        else if (tile_format === ImageFormat.G_IM_FMT_IA && tile_bitSize === ImageSize.G_IM_SIZ_8b) decodeTex_IA8(dest, texelDataView, 0, tileWidth, tileHeight, tile_wordsPerLine, true);
        else if (tile_format === ImageFormat.G_IM_FMT_IA && tile_bitSize === ImageSize.G_IM_SIZ_16b) decodeTex_IA16(dest, texelDataView, 0, tileWidth, tileHeight, tile_wordsPerLine, true);
        else if (tile_format === ImageFormat.G_IM_FMT_CI && tile_bitSize === ImageSize.G_IM_SIZ_4b) {
            const tlut = new Uint8Array(16 * 4);
            parseTLUT(tlut, palettesData[tile_paletteIndex].createDataView(), 0, tile_bitSize, TextureLUT.G_TT_RGBA16);
            decodeTex_CI4(dest, texelDataView, 0, tileWidth, tileHeight, tlut, tile_wordsPerLine, true);
        }
        else
            console.warn(`Unsupported texture format ${getImageFormatName(tile_format)} / ${getImageSizeName(tile_bitSize)}`);

        this.convertedTexelData = dest;
        this.tile_sLo = tile_sLo;
        this.tile_tLo = tile_tLo;
        this.tile_sHi = tile_sHi;
        this.tile_tHi = tile_tHi;
        this.width = imageWidth;
        this.height = imageHeight;
    }
}
