import { Filesystem, UVFile } from "../Filesystem";
import { assert, nArray } from "../../util";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { ImageFormat, ImageSize, decodeTex_RGBA16, decodeTex_I4, decodeTex_I8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, getImageFormatName, getImageSizeName, decodeTex_CI4, parseTLUT, TextureLUT } from "../../Common/N64/Image";
import { UVTS, AnimationState } from "./UVTS";
import * as F3DEX2 from "../../PokemonSnap/f3dex2";
import * as F3DEX from '../../BanjoKazooie/f3dex';
import * as RDP from '../../Common/N64/RDP';
import { vec4 } from "gl-matrix";

// I have a feeling this might be used for texture scrolling (and/or distorting/something else?)
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
    public firstUnkStruct: UnkStruct | null = null;
    public secondUnkStruct: UnkStruct | null = null;
    // pTexelData
    // pPalettes (TODO: it seems like the UVTX stores 4 copies of each palette. Why?)
    public flagsAndIndex: number; //uint
    public otherUVTX: UVTX | null = null; // originally ushort otherUVTXIndex
    // texelDataSize
    public imageWidth: number; //ushort
    public imageHeight: number; //ushort
    public animationState: AnimationState | null = null; // originally animationStateIndex
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
    public rspState: UVTXRSPState;

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
        if(otherUVTXIndex != 0xFFF) {
            //TODO: I think this is right?
            if(otherUVTXIndex === (this.flagsAndIndex & 0xFFF)) {
                this.otherUVTX = this;
            } else {
                this.otherUVTX = filesystem.getParsedFile(UVTX, "UVTX", otherUVTXIndex);
            }
        } 
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
        
        this.convertImageData(texelData, dlCommandsData, palettesData);
    }

    private convertImageData(texelData: ArrayBufferSlice, dlCommandsData: ArrayBufferSlice, palettesData: ArrayBufferSlice[]) {
        const cmdCount = dlCommandsData.byteLength / 8;
        const cmdView = dlCommandsData.createDataView();

        let settimgCount = 0;

        let rspState = new UVTXRSPState();
        this.rspState = rspState;

        // This code is a modified version of the Pokemon Snap F3DEX2 code
        for (let i = 0; i < cmdView.byteLength; i += 0x08) {
            const w0 = cmdView.getUint32(i + 0x00);
            const w1 = cmdView.getUint32(i + 0x04);
    
            const cmd: F3DEX2.F3DEX2_GBI = w0 >>> 24;
    
            // TODO: we can ignore commands for any mipmaps since we're not going to use them
            switch (cmd) {
                case F3DEX2.F3DEX2_GBI.G_SETTIMG: {
                    // When the UVTX file is loaded, it modifies the G_SETTIMG instruction(s)
                    // so that the addresses point to the location of the loaded texel data.
                    // We're going to load the texel data separately, so we can ignore this.

                    // (We get format and bitSize from the subsequent G_SETTILE call)

                    // const format = (w0 >>> 21) & 0x07;
                    // const bitSize = (w0 >>> 19) & 0x03;
                    // const width = (w0 & 0x0FFF) + 1;
                    //const address = w1;

                    // let imageState = settimgIndex === 0 ? rspState.tex1ImageState : rspState.tex2ImageState
                    // imageState.set(format, bitSize, width, NaN);
                    settimgCount++;
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETTILE: {

                    const fmt = (w0 >>> 21) & 0x07;
                    const siz = (w0 >>> 19) & 0x03;
                    const line = (w0 >>> 9) & 0x1FF;
                    const tmem = (w0 >>> 0) & 0x1FF;
                    const tile = (w1 >>> 24) & 0x07;
                    const palette = (w1 >>> 20) & 0x0F;
                    const cmt = (w1 >>> 18) & 0x03;
                    const maskt = (w1 >>> 14) & 0x0F;
                    const shiftt = (w1 >>> 10) & 0x0F;
                    const cms = (w1 >>> 8) & 0x03;
                    const masks = (w1 >>> 4) & 0x0F;
                    const shifts = (w1 >>> 0) & 0x0F;
                    rspState.tileStates[tile].set(fmt, siz, line, tmem, palette, cmt, maskt, shiftt, cms, masks, shifts);
                } break;    
                case F3DEX2.F3DEX2_GBI.G_LOADBLOCK: {
                    // We can completely ignore, we already know how long the data is
                    // and we already know where we're loading from (since we ignore mip levels)

                    // TODO: unless the game relies on this setting lrs and lrt?

                    // const uls = (w0 >>> 12) & 0x0FFF;
                    // const ult = (w0 >>> 0) & 0x0FFF;
                    // const tile = (w1 >>> 24) & 0x07;
                    // const lrs = (w1 >>> 12) & 0x0FFF;
                    // const dxt = (w1 >>> 0) & 0x0FFF;
                    // rspState.gDPLoadBlock(tile, uls, ult, lrs, dxt);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETOTHERMODE_H: {
                    // TODO: might be able to optimize this similar to PW64 code
                    const len = ((w0 >>> 0) & 0xFF) + 1;
                    const sft = 0x20 - ((w0 >>> 8) & 0xFF) - len;
                    const mask = ((1 << len) - 1) << sft;
                    rspState.otherModeH = (rspState.otherModeH & ~mask) | (w1 & mask);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETCOMBINE: {
                    rspState.combineParams = RDP.decodeCombineParams(w0, w1);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_TEXTURE: {
                    // const level = (w0 >>> 11) & 0x07;
                    let tile = (w0 >>> 8) & 0x07;
                    const on = !!((w0 >>> 0) & 0x7F);
                    assert(on);
                    const sScale = (w1 >>> 16) & 0xFFFF;
                    const tScale = (w1 >>> 0) & 0xFFFF;
                    rspState.textureState.set(true, tile, NaN, sScale / 0x10000, tScale / 0x10000);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETTILESIZE: {
                    const uls = (w0 >>> 12) & 0x0FFF;
                    const ult = (w0 >>> 0) & 0x0FFF;
                    const tile = (w1 >>> 24) & 0x07;
                    const lrs = (w1 >>> 12) & 0x0FFF;
                    const lrt = (w1 >>> 0) & 0x0FFF;
                    rspState.tileStates[tile].setSize(uls / 4, ult / 4, lrs / 4, lrt / 4);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETPRIMCOLOR: {
                    //const lod = (w0 >>> 0) & 0xFF;
                    const r = (w1 >>> 24) & 0xFF;
                    const g = (w1 >>> 16) & 0xFF;
                    const b = (w1 >>> 8) & 0xFF;
                    const a = (w1 >>> 0) & 0xFF;
                    //rspState.primitiveLODFraction = lod / 0xFF;
                    rspState.primitiveColor = vec4.fromValues(r / 0xFF, g / 0xFF, b / 0xFF, a / 0xFF);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETENVCOLOR: {
                    const r = (w1 >>> 24) & 0xFF;
                    const g = (w1 >>> 16) & 0xFF;
                    const b = (w1 >>> 8) & 0xFF;
                    const a = (w1 >>> 0) & 0xFF;
                    rspState.environmentColor = vec4.fromValues(r / 0xFF, g / 0xFF, b / 0xFF, a / 0xFF);
                } break;

                case F3DEX2.F3DEX2_GBI.G_RDPTILESYNC:
                case F3DEX2.F3DEX2_GBI.G_RDPLOADSYNC:
                case F3DEX2.F3DEX2_GBI.G_ENDDL:
                    break;
    
                default:
                    console.error(`Unknown DL opcode: ${cmd.toString(16)}`);
            }
        }

        /////
        if(this.otherUVTX === null || this.otherUVTX === this) {
            assert(settimgCount === 1);
        } else {
            assert(settimgCount === 2);
        }
        // Assumption doesn't hold
        // if(this.levelCount === 6 && this.otherUVTX !== null) {
        //     assert(rspState.textureState.tile === 0);
        // } else {
        //     assert(rspState.textureState.tile === 1);
        // }
        assert(rspState.primitiveTile.line !== 0);

        /////
        let tile = rspState.primitiveTile;

        if (tile.uls === 0 && tile.ult === 0 && tile.lrs === 0 && tile.lrt === 0) {
            console.warn("G_SETTILESIZE was never called, skipping");
            this.not_supported_yet = true;
            return;
        }

        // Decode image data
        let tileWidth = (tile.lrs - tile.uls) + 1;
        let tileHeight = (tile.lrt - tile.ult) + 1;
        assert(tileWidth === Math.round(tileWidth));
        assert(tileHeight === Math.round(tileHeight));
        assert(tileWidth === this.imageWidth);
        assert(tileHeight === this.imageHeight);

        const dest = new Uint8Array(tileWidth * tileHeight * 4);
        const texelDataView = texelData.createDataView();

        if (tile.fmt === ImageFormat.G_IM_FMT_RGBA && tile.siz === ImageSize.G_IM_SIZ_16b) decodeTex_RGBA16(dest, texelDataView, 0, tileWidth, tileHeight, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_I && tile.siz === ImageSize.G_IM_SIZ_4b) decodeTex_I4(dest, texelDataView, 0, tileWidth, tileHeight, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_I && tile.siz === ImageSize.G_IM_SIZ_8b) decodeTex_I8(dest, texelDataView, 0, tileWidth, tileHeight, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_4b) decodeTex_IA4(dest, texelDataView, 0, tileWidth, tileHeight, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_8b) decodeTex_IA8(dest, texelDataView, 0, tileWidth, tileHeight, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_16b) decodeTex_IA16(dest, texelDataView, 0, tileWidth, tileHeight, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_CI && tile.siz === ImageSize.G_IM_SIZ_4b) {
            const tlut = new Uint8Array(16 * 4);
            parseTLUT(tlut, palettesData[tile.palette].createDataView(), 0, tile.siz, TextureLUT.G_TT_RGBA16);
            decodeTex_CI4(dest, texelDataView, 0, tileWidth, tileHeight, tlut, tile.line, true);
        }
        else
            console.warn(`Unsupported texture format ${getImageFormatName(tile.fmt)} / ${getImageSizeName(tile.siz)}`);

        this.convertedTexelData = dest;
    }
}

// Class to hold state of RSP after executing a UVTX's display list
class UVTXRSPState {
    public tileStates: RDP.TileState[] = nArray(8, () => new RDP.TileState());
    public otherModeH: number = 0;
    public combineParams: RDP.CombineParams;
    public textureState: F3DEX.TextureState = new F3DEX.TextureState();
    //public primitiveLODFraction: number = 0;
    public primitiveColor: vec4 = vec4.create();
    public environmentColor: vec4 = vec4.create();

    // This seems to be the "official" name for it?
    get primitiveTile() {
        return this.tileStates[this.textureState.tile];
    }
}
