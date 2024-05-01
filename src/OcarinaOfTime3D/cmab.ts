
import AnimationController from "../AnimationController.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString, assert } from "../util.js";
import { mat4 } from "gl-matrix";
import { Color, colorFromRGBA } from "../Color.js";
import { Texture, TextureLevel, Version, calcTexMtx } from "./cmb.js";
import { decodeTexture, computeTextureByteSize, getTextureFormatFromGLFormat } from "./pica_texture.js";
import { getPointHermite } from "../Spline.js";
import { TextureMapping } from "../TextureHolder.js";
import { CtrTextureHolder } from "./render.js";
import { lerp } from "../MathHelpers.js";

// CMAB (CTR Material Animation Binary)
// Seems to be inspired by the .cmata file format. Perhaps an earlier version of NW4C used it?

const enum AnimationTrackType {
    LINEAR = 0x01,
    HERMITE = 0x02,
    INTEGER = 0x03,
};

interface AnimationKeyframeLinear {
    time: number;
    value: number;
}

interface AnimationKeyframeHermite {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
}

interface AnimationTrackLinear {
    timeStart: number;
    timeEnd: number;
    type: AnimationTrackType.LINEAR;
    frames: AnimationKeyframeLinear[];
}

interface AnimationTrackHermite {
    timeStart: number;
    timeEnd: number;
    type: AnimationTrackType.HERMITE;
    frames: AnimationKeyframeHermite[];
}

interface AnimationTrackInteger {
    timeStart: number;
    timeEnd: number;
    type: AnimationTrackType.INTEGER;
    frames: AnimationKeyframeLinear[];
}

type AnimationTrack = AnimationTrackLinear | AnimationTrackHermite | AnimationTrackInteger;

export interface AnimationEntry {
    animationType: number;
    materialIndex: number;
    channelIndex: number;
    tracks: AnimationTrack[];
};

interface AnimationBase {
    duration: number;
    loopMode: LoopMode;
}

export interface CMAB extends AnimationBase {
    animEntries: AnimationEntry[];
    textures: Texture[];
};

export const enum AnimationType {
    TRANSLATION = 0x01,
    TEXTURE_PALETTE = 0x02,
    DIFFUSE_COLOR = 0x03,
    CONST_COLOR = 0x04,
    ROTATION = 0x05,
    SCALE = 0x06,
    AMBIENT_COLOR = 0x07,
    SPEC0_COLOR = 0x08,
    SPEC1_COLOR = 0x09,
    EMISSION_COLOR = 0x0A
}

export const enum ColorAnimType {
    Const0,
    Const1,
    Const2,
    Const3,
    Const4,
    Const5,
    Diffuse,
    Ambient,
    Specular0,
    Specular1,
    Emission,
}

const enum LoopMode {
    ONCE, REPEAT,
}

function parseTrack(version: Version, buffer: ArrayBufferSlice): AnimationTrack | null {
    const view = buffer.createDataView();

    let type: AnimationTrackType;
    let numKeyframes: number;
    let timeStart: number, timeEnd: number;
    let scale: number, bias: number;

    if (version === Version.Ocarina) {
        type = view.getUint32(0x00, true);
        numKeyframes = view.getUint32(0x04, true);
        timeStart = view.getUint32(0x08, true);
        timeEnd = view.getUint32(0x0C, true);
    } else if (version === Version.Majora || version === Version.LuigisMansion) {
        type = view.getUint16(0x00, true);
        numKeyframes = view.getUint16(0x02, true);
        timeStart = view.getUint16(0x04, true);
        timeEnd = view.getUint16(0x06, true);

        scale = view.getFloat32(0x08, true);
        bias = view.getUint32(0x0C, true);
    } else {
        throw "whoops";
    }

    let keyframeTableIdx: number = 0x10;

    // WTF does this mean?
    if (numKeyframes === 0)
        return null;

    if (type === AnimationTrackType.LINEAR) {
        const frames: AnimationKeyframeLinear[] = [];
        for (let i = 0; i < numKeyframes; i++) {
            const time = view.getUint32(keyframeTableIdx + 0x00, true);
            const value = view.getFloat32(keyframeTableIdx + 0x04, true);
            keyframeTableIdx += 0x08;
            frames.push({ time, value });
        }
        return { timeStart, timeEnd, type, frames };
    } else if (type === AnimationTrackType.HERMITE) {
        const frames: AnimationKeyframeHermite[] = [];
        for (let i = 0; i < numKeyframes; i++) {
            const time = view.getUint32(keyframeTableIdx + 0x00, true);
            const value = view.getFloat32(keyframeTableIdx + 0x04, true);
            const tangentIn = view.getFloat32(keyframeTableIdx + 0x08, true);
            const tangentOut = view.getFloat32(keyframeTableIdx + 0x0C, true);
            keyframeTableIdx += 0x10;
            frames.push({ time, value, tangentIn, tangentOut });
        }
        return { timeStart, timeEnd, type, frames };
    } else if (type === AnimationTrackType.INTEGER) {
        const frames: AnimationKeyframeLinear[] = [];
        for (let i = 0; i < numKeyframes; i++) {
            const time = view.getUint32(keyframeTableIdx + 0x00, true);
            const value = view.getFloat32(keyframeTableIdx + 0x04, true);
            keyframeTableIdx += 0x08;
            frames.push({ time, value });
        }
        return { timeStart, timeEnd, type, frames };
    } else {
        throw "whoops";
    }
}

function parseTxpt(buffer: ArrayBufferSlice, texData: ArrayBufferSlice | null, stringTable: string[], prefix: string = ''): Texture[] {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === 'txpt');

    const txptTableCount = view.getUint16(0x04, true);
    const isTexDataEmpty = view.getUint16(0x06, true);
    
    let txptTableIdx = 0x08;
    const textures: Texture[] = [];
    for (let i = 0; i < txptTableCount; i++) {
        const size = view.getUint32(txptTableIdx + 0x00, true);
        const maxLevel = view.getUint16(txptTableIdx + 0x04, true);
        const isETC1 = view.getUint8(txptTableIdx + 0x06);
        const isCubemap = !!view.getUint8(txptTableIdx + 0x07);
        const width = view.getUint16(txptTableIdx + 0x08, true);
        const height = view.getUint16(txptTableIdx + 0x0A, true);
        const glFormat = view.getUint32(txptTableIdx + 0x0C, true);
        let dataOffs = view.getUint32(txptTableIdx + 0x10, true);
        const nameStringIndex = view.getUint32(txptTableIdx + 0x14, true);
        const rawName = stringTable[nameStringIndex];
        const name = `${prefix}${rawName}`;
        const dataEnd = dataOffs + size;

        const levels: TextureLevel[] = [];

        const format = getTextureFormatFromGLFormat(glFormat);

        if (texData !== null) {
            let mipWidth = width, mipHeight = height;
            for (let i = 0; i < maxLevel; i++) {
                const pixels = decodeTexture(format, mipWidth, mipHeight, texData.slice(dataOffs, dataEnd));
                levels.push({ name, width: mipWidth, height: mipHeight, pixels });
                dataOffs += computeTextureByteSize(format, mipWidth, mipHeight);
                mipWidth /= 2;
                mipHeight /= 2;
            }
        }

        textures.push({ isCubemap, name, format, width, height, levels });

        txptTableIdx += 0x18;
    }

    return textures;
}

function parseMmad(version: Version, buffer: ArrayBufferSlice): AnimationEntry {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'mmad');

    const animationType: AnimationType = view.getUint32(0x04, true);
    const materialIndex = view.getUint32(0x08, true);
    let channelIndex = view.getUint32(0x0C, true);

    switch(animationType){
        case AnimationType.DIFFUSE_COLOR: channelIndex = ColorAnimType.Diffuse; break;
        case AnimationType.AMBIENT_COLOR: channelIndex = ColorAnimType.Ambient; break;
        case AnimationType.SPEC0_COLOR: channelIndex = ColorAnimType.Specular0; break;
        case AnimationType.SPEC1_COLOR: channelIndex = ColorAnimType.Specular0; break;
        case AnimationType.EMISSION_COLOR: channelIndex = ColorAnimType.Emission; break;
    }

    let trackOffsTableIdx = 0x10;
    if(animationType !== AnimationType.CONST_COLOR &&
        animationType !== AnimationType.TRANSLATION &&
        animationType !== AnimationType.SCALE &&
        animationType !== AnimationType.TEXTURE_PALETTE
        && animationType !== AnimationType.ROTATION) {
        trackOffsTableIdx -= 0x04;
    }

    const tracks: AnimationTrack[] = [];
    if (animationType === AnimationType.TRANSLATION || animationType === AnimationType.SCALE) {
        for (let i = 0; i < 2; i++) {
            const trackOffs = view.getUint16(trackOffsTableIdx, true);
            trackOffsTableIdx += 0x02;

            if (trackOffs === 0x00)
                continue;

            const track = parseTrack(version, buffer.slice(trackOffs));
            if (track !== null)
                tracks[i] = track;
        }
    } else if (animationType === AnimationType.TEXTURE_PALETTE) {
        for (let i = 0; i < 1; i++) {
            const trackOffs = view.getUint16(trackOffsTableIdx, true);
            trackOffsTableIdx += 0x02;

            if (trackOffs === 0x00)
                continue;

            const track = parseTrack(version, buffer.slice(trackOffs));
            if (track !== null)
                tracks[i] = track;
        }
    }
    else if (animationType === AnimationType.CONST_COLOR || animationType === AnimationType.DIFFUSE_COLOR ||
             animationType === AnimationType.SPEC0_COLOR || animationType === AnimationType.SPEC1_COLOR ||
             animationType === AnimationType.EMISSION_COLOR || animationType === AnimationType.AMBIENT_COLOR ){

        for (let i = 0; i < 4; i++) {
            const trackOffs = view.getUint16(trackOffsTableIdx, true);
            trackOffsTableIdx += 0x02;

            if (trackOffs === 0x00)
                continue;

            const track = parseTrack(version, buffer.slice(trackOffs));
            if (track !== null)
                tracks[i] = track;
        }
    } else if (animationType === AnimationType.ROTATION) {
        for (let i = 0; i < 1; i++) {
            const trackOffs = view.getUint16(trackOffsTableIdx, true);
            trackOffsTableIdx += 0x02;

            if (trackOffs === 0x00)
                continue;

            const track = parseTrack(version, buffer.slice(trackOffs));
            if (track !== null)
                tracks[i] = track;
        }
    }

    return { animationType, materialIndex, channelIndex, tracks };
}

export function parse(version: Version, buffer: ArrayBufferSlice, textureNamePrefix: string = ''): CMAB {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'cmab');
    // smh Nintendo doesn't change the version field
    const subversion = view.getUint32(0x04, true);
    assert(subversion === 0x01);

    const size = view.getUint32(0x08, true);
    assert(view.getUint32(0x0C, true) === 0x00);

    assert(view.getUint32(0x10, true) === 0x01); // num chunks?
    assert(view.getUint32(0x14, true) === 0x20); // chunk location?

    // String table.
    const strTableChunkOffs = view.getUint32(0x18, true);
    assert(readString(buffer, strTableChunkOffs, 0x04, false) === 'strt');
    const stringTable = [];
    const strTableCount = view.getUint32(strTableChunkOffs + 0x04, true);
    let strTableIndex = strTableChunkOffs + 0x08;
    const strTableDataOffs = strTableIndex + strTableCount * 0x04;
    for (let i = 0; i < strTableCount; i++) {
        const strOffs = strTableDataOffs + view.getUint32(strTableIndex, true);
        stringTable.push(readString(buffer, strOffs, 0xFF, true));
        strTableIndex += 0x04;
    }

    const texDataChunkOffs = view.getUint32(0x1C, true);

    assert(view.getUint32(0x20, true) === 0xFFFFFFFF); // chunk type?
    const duration = view.getUint32(0x24, true);
    const loopMode: LoopMode = view.getUint32(0x28, true);
    assert(view.getUint32(0x2C, true) === 0x14); // chunk location?
    const txptChunkOffs = view.getUint32(0x30, true);

    const madsChunkOffs = 0x34;
    assert(readString(buffer, madsChunkOffs + 0x00, 0x04, false) === 'mads');
    const numAnimations = view.getUint32(madsChunkOffs + 0x04, true);

    const animEntries: AnimationEntry[] = [];    
    let mmadAnimationTableIdx = madsChunkOffs + 0x08;
    for (let i = 0; i < numAnimations; i++) {
        const mmadAnimChunkOffs = madsChunkOffs + view.getUint32(mmadAnimationTableIdx + 0x00, true);
        animEntries.push(parseMmad(version, buffer.slice(mmadAnimChunkOffs)));
        mmadAnimationTableIdx += 0x04;
    }

    let textures: Texture[] = [];
    if (txptChunkOffs !== 0) {
        const texData = texDataChunkOffs !== 0 ? buffer.slice(texDataChunkOffs) : null;
        const txptChunk = buffer.slice(0x20 + txptChunkOffs);
        textures = parseTxpt(txptChunk, texData, stringTable, textureNamePrefix);
    }

    return { duration, loopMode, animEntries, textures };
}

function sampleAnimationTrackLinear(track: AnimationTrackLinear, frame: number): number {
    const frames = track.frames;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 === 0)
        return frames[0].value;
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    const t = (frame - k0.time) / (k1.time - k0.time);
    return lerp(k0.value, k1.value, t);
}

function hermiteInterpolate(k0: AnimationKeyframeHermite, k1: AnimationKeyframeHermite, t: number): number {
    const length = k1.time - k0.time;
    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangentOut * length;
    const s1 = k1.tangentIn * length;
    return getPointHermite(p0, p1, s0, s1, t);
}

function sampleAnimationTrackHermite(track: AnimationTrackHermite, frame: number) {
    const frames = track.frames;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 === 0)
        return frames[0].value;
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    // HACK(jstpierre): Nintendo sometimes uses weird "reset" tangents
    // which aren't supposed to be visible. They are visible for us because
    // "frame" can have a non-zero fractional component. In this case, pick
    // a value completely.
    if ((k1.time - k0.time) === 1)
        return k0.value;

    const t = (frame - k0.time) / (k1.time - k0.time);
    return hermiteInterpolate(k0, k1, t);
}

function sampleAnimationTrackInteger(track: AnimationTrackInteger, frame: number): number {
    const frames = track.frames;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 === 0)
        return frames[0].value;
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    return k0.value;
}

function sampleAnimationTrack(track: AnimationTrack, frame: number): number {
    if (track.type === AnimationTrackType.LINEAR)
        return sampleAnimationTrackLinear(track, frame);
    else if (track.type === AnimationTrackType.HERMITE)
        return sampleAnimationTrackHermite(track, frame);
    else if (track.type === AnimationTrackType.INTEGER)
        return sampleAnimationTrackInteger(track, frame);
    else
        throw "whoops";
}

function getAnimFrame(anim: AnimationBase, frame: number): number {
    // Be careful of floating point precision.
    const lastFrame = anim.duration;
    if (anim.loopMode === LoopMode.ONCE) {
        if (frame > lastFrame)
            frame = lastFrame;
        return frame;
    } else if (anim.loopMode === LoopMode.REPEAT) {
        while (frame > lastFrame)
            frame -= lastFrame;
        return frame;
    } else {
        throw "whoops";
    }
}

export class TextureSRTAnimator {
    constructor(public animationController: AnimationController, public cmab: CMAB, public animEntry: AnimationEntry) {
        assert(animEntry.animationType === AnimationType.TRANSLATION || animEntry.animationType === AnimationType.ROTATION || animEntry.animationType === AnimationType.SCALE);
    }

    public calcTexMtx(dst: mat4): void {
        const animFrame = getAnimFrame(this.cmab, this.animationController.getTimeInFrames());
        mat4.identity(dst);

        if (this.animEntry.animationType === AnimationType.TRANSLATION) {
            const tx = this.animEntry.tracks[0] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[0], animFrame) : 0;
            const ty = this.animEntry.tracks[1] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[1], animFrame) : 0;
            calcTexMtx(dst, 1, 1, 0, tx, ty);
        } else if (this.animEntry.animationType === AnimationType.ROTATION) {
            const r = this.animEntry.tracks[0] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[0], animFrame) : 0;
            calcTexMtx(dst, 1, 1, r, 0, 0);
        } else if (this.animEntry.animationType === AnimationType.SCALE) {
            const sx = this.animEntry.tracks[0] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[0], animFrame) : 1;
            const sy = this.animEntry.tracks[1] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[1], animFrame) : 1;
            calcTexMtx(dst, sx, sy, 0, 0, 0);
        } else {
            throw "whoops";
        }
    }
}

export class ColorAnimator {
    constructor(public animationController: AnimationController, public cmab: CMAB, public animEntry: AnimationEntry) {
        assert(animEntry.animationType === AnimationType.CONST_COLOR    || animEntry.animationType === AnimationType.DIFFUSE_COLOR ||
               animEntry.animationType === AnimationType.SPEC0_COLOR    || animEntry.animationType === AnimationType.SPEC1_COLOR ||
               animEntry.animationType === AnimationType.EMISSION_COLOR || animEntry.animationType === AnimationType.AMBIENT_COLOR);
    }

    public calcColor(dst: Color, srcColor: Color): void {
        const animFrame = getAnimFrame(this.cmab, this.animationController.getTimeInFrames());
        const r = this.animEntry.tracks[0] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[0], animFrame) : srcColor.r;
        const g = this.animEntry.tracks[1] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[1], animFrame) : srcColor.g;
        const b = this.animEntry.tracks[2] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[2], animFrame) : srcColor.b;
        const a = this.animEntry.tracks[3] !== undefined ? sampleAnimationTrack(this.animEntry.tracks[3], animFrame) : srcColor.a;
        colorFromRGBA(dst, r, g, b, a);
    }
}

export class TexturePaletteAnimator {
    constructor(public animationController: AnimationController, public cmab: CMAB, public animEntry: AnimationEntry) {
        assert(animEntry.animationType === AnimationType.TEXTURE_PALETTE);
    }

    public fillTextureMapping(textureHolder: CtrTextureHolder, textureMapping: TextureMapping): void {
        const animFrame = getAnimFrame(this.cmab, this.animationController.getTimeInFrames());
        const textureIndex = sampleAnimationTrack(this.animEntry.tracks[0], animFrame);
        textureHolder.fillTextureMapping(textureMapping, this.cmab.textures[textureIndex].name);
    }
}
