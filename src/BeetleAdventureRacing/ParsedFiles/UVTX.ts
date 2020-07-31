import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { ImageFormat, ImageSize, decodeTex_RGBA16, decodeTex_I4, decodeTex_I8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, getImageFormatName, getImageSizeName, decodeTex_CI4, parseTLUT, TextureLUT } from "../../Common/N64/Image";
import { UVTS, AnimationState } from "./UVTS";

// only the limited number of commands UVTX actually uses.
enum F3DEX2_GBI {
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

class UnkStruct {
    public f1: number;
    public f2: number;
    public f3: number;
    public f4: number;
    public f5: number;
    public f6: number;
    public byte1: number;
    public byte2: number;
    public byte3: number;
}

// UVTX aka "texture"
// Most of these just represent a single texture, possibly with mipmaps along with some extra info.
// However, a UVTX can also have two textures (using otherUVTX) and/or be an animated texture (using animationState)
export class UVTX {
    // pCommands
    public firstUnkStruct: UnkStruct | null;
    public secondUnkStruct: UnkStruct | null;
    // pTexelData
    // pPalettes (TODO: it seems like the UVTX stores 4 copies of each palette. Why?)
    public flagsAndIndex: number; //uint
    public otherUVTX: UVTX | null; // originally ushort otherUVTXIndex
    // texelDataSize
    public imageWidth: number; //ushort
    public imageHeight: number; //ushort
    public animationState: AnimationState | null; // originally animationStateIndex
    public unkByte1: number;
    public levelCount: number; // 1 if no mipmapping, +1 for each mipmap level, etc.
    public alpha: number;
    public unkByte3: number;
    public unkByte4: number;
    public unkByte5: number;
    public unkByte6: number;




    // below stuff is not in the original UVTX struct




    public not_supported_yet = false;
    public convertedTexelData: Uint8Array;
    public tile_sLo: number;
    public tile_tLo: number;
    public tile_sHi: number;
    public tile_tHi: number;

    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const buffer = uvFile.chunks[0].buffer;
        const view = buffer.createDataView();
        let curPos = 0;

        const texelDataSize = view.getUint16(0);
        const dlCommandCount = view.getUint16(2);
        curPos += 4;

        let f1 = view.getFloat32(curPos + 0);
        let f2 = view.getFloat32(curPos + 4);
        if(f1 === 0 && f2 === 0) {
            this.firstUnkStruct = null;
        } else {
            this.firstUnkStruct = {
                f1: 1,
                f2: 1,
                f3: f1,
                byte1: 0,
                byte2: 0,
                byte3: 1,
                f4: 0,
                f5: 0,
                f6: f2,
            }
        }
        curPos += 8;

        let f3 = view.getFloat32(curPos + 0);
        let f4 = view.getFloat32(curPos + 4);
        let f5 = view.getFloat32(curPos + 8);
        let f6 = view.getFloat32(curPos + 12);
        if(f3 === 0 && f4 === 0 && f5 === 0 && f6 === 0) {
            this.secondUnkStruct = null;
        } else {
            this.secondUnkStruct = {
                f1: 1,
                f2: 1,
                f3: f3,
                f4: f4,
                f5: f5,
                f6: f6,
                byte1: 0,
                byte2: 0,
                byte3: 1,
            }
        }
        curPos += 16;

        const texelData = buffer.subarray(curPos, texelDataSize);
        curPos += texelDataSize;
        const dlCommandsData = buffer.subarray(curPos, dlCommandCount * 8);
        curPos += dlCommandCount * 8;

        // TODO: what are all these?
        this.imageWidth = view.getUint16(curPos + 0);
        this.imageHeight = view.getUint16(curPos + 2);
        this.unkByte3 = view.getUint8(curPos + 4);
        this.unkByte4 = view.getUint8(curPos + 5);
        this.unkByte5 = view.getUint8(curPos + 6);
        // bottom half of this is just this uvtx's index
        // (so it can be compared to otherUVTXIndex, maybe other things?)
        this.flagsAndIndex = view.getUint32(curPos + 7);
        let otherUVTXIndex = view.getUint16(curPos + 11);
        const unk6 = view.getUint16(curPos + 13); // 2
        this.unkByte6 = unk6 & 0xFF; // TODO: Other half doesn't seem to be used?
        this.unkByte1 = view.getUint8(curPos + 15);
        //These all seem to be completely ignored, they're not even stored in the UVTX object
        const unk8 = view.getUint8(curPos + 16);
        const unk9 = view.getUint8(curPos + 17);
        const unk10 = view.getUint8(curPos + 18);
        const unk11 = view.getUint8(curPos + 19);
        const unk12 = view.getUint32(curPos + 20);
        //TODO: this is used to set BLEND alpha
        this.alpha = view.getUint8(curPos + 24);
        this.levelCount = view.getUint8(curPos + 25);
        curPos += 26;


        if((this.flagsAndIndex & 0x00080000) !== 0) {
            let uvtsCt = filesystem.getFileTypeCount("UVTS");
            // I checked, there are no null UVTSs
            let foundMatch = false;
            for(let i = 0; i < uvtsCt; i++) {
                //TODO: this is going to cause infinite recursion.
                // idea: instead of getparsedfile, get chunks and pass to other fn?
                let uvts = filesystem.getParsedFile(UVTS, "UVTS", i);               
                if(uvts.frames[0].uvtxIndex === (this.flagsAndIndex & 0xFFF)) {
                    // init entry

                    let startFrame = (uvts.playAnimationInReverse ? (uvts.frames.length - 1) : 0);
                    this.animationState = {
                        thisSlotIsAllocated: true,
                        enabled: true,
                        currentFrame: startFrame,
                        unitsUntilFrameEnds: uvts.frames[startFrame].frameLengthUnits,
                        uvts,
                    };
                    foundMatch = true;
                    break;
                }
            }

            // if this is ever false, some assumptions go out the window.
            // would need to expand the code
            assert(foundMatch);
        } else {
            this.animationState = null;
        }

        // TODO: for some reason BAR makes 4 copies of each palette... why?

        // then read palettes if there are any to read
        // TODO: this.unkByte1 is not just a bool - what is it
        const palettesData: ArrayBufferSlice[] = [];
        if (this.unkByte1 == 0) {
            for (let i = 0; i < this.levelCount; i++) {
                //TODO(?)
                // i+1 because 0 palette is reserved or something
                palettesData[i + 1] = buffer.subarray(curPos, 32);
                curPos += 32;
            }
        }

        // TODO: load second texture if necessary,
        // and include it in the fake command execution.

        



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
        assert(tileWidth === this.imageWidth);
        assert(tileHeight === this.imageHeight);


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
    }
}
