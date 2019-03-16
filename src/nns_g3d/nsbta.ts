
// NITRO System Binary Texture Animation

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { parseResDictGeneric, parseResDict, fx16, fx32, calcTexMtx, TexMtxMode } from "./nsbmd";
import { mat2d, vec2 } from "gl-matrix";
import AnimationController from "../AnimationController";

export interface BTA0 {
    srt0: SRT0;
}

export interface SRT0 {
    duration: number;
    entries: SRT0_TexData[];
}

interface SRT0_TexData {
    name: string;
    scaleS: AnimationTrack;
    scaleT: AnimationTrack;
    rot: AnimationTrack;
    transS: AnimationTrack;
    transT: AnimationTrack;
}

interface AnimationKeyframe {
    frame: number;
    value: number;
}

interface AnimationTrack {
    frames: AnimationKeyframe[];
}

function parseSRT0(buffer: ArrayBufferSlice): SRT0 {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04, false) === 'M\x00AT');
    const duration = view.getUint16(0x04, true);
    const flag = view.getUint8(0x06);
    // Seems to be completely junk.
    const texMtxMode = view.getUint8(0x07);

    const enum ComponentFlag {
        FX16   = 0x10000000,
        CONST  = 0x20000000,
        STEP_2 = 0x40000000,
        STEP_4 = 0x80000000,
    }

    function parseTrack(flag: ComponentFlag, valueOrOffs: number): AnimationTrack {
        const frames: AnimationKeyframe[] = [];

        if (flag & ComponentFlag.CONST) {
            // Constant track.
            frames.push({ frame: 0, value: fx32(valueOrOffs) });
        } else {
            const frameStep = (flag & ComponentFlag.STEP_4) ? 4 : (flag & ComponentFlag.STEP_2) ? 2 : 1;
            if (flag & ComponentFlag.FX16) {
                let idx = valueOrOffs;
                for (let frame = 0; frame < duration; frame += frameStep) {
                    const value = fx16(view.getInt16(idx, true));
                    frames.push({ frame, value });
                    idx += 0x02;
                }
            } else {
                let idx = valueOrOffs;
                for (let frame = 0; frame < duration; frame += frameStep) {
                    const value = fx32(view.getInt32(idx, true));
                    frames.push({ frame, value });
                    idx += 0x04;
                }
            }
        }

        return { frames };
    }

    const animationEntries = parseResDictGeneric(buffer, 0x08, (view, entryTableIdx) => {
        const scaleSFlag: ComponentFlag = view.getUint32(entryTableIdx + 0x00, true);
        const scaleSEx: number = view.getUint32(entryTableIdx + 0x04, true);
        const scaleTFlag: ComponentFlag = view.getUint32(entryTableIdx + 0x08, true);
        const scaleTEx: number = view.getUint32(entryTableIdx + 0x0C, true);
        const rotFlag: ComponentFlag = view.getUint32(entryTableIdx + 0x10, true);
        const rotEx: number = view.getUint32(entryTableIdx + 0x14, true);
        const transSFlag: ComponentFlag = view.getUint32(entryTableIdx + 0x18, true);
        const transSEx: number = view.getUint32(entryTableIdx + 0x1C, true);
        const transTFlag: ComponentFlag = view.getUint32(entryTableIdx + 0x20, true);
        const transTEx: number = view.getUint32(entryTableIdx + 0x24, true);

        const scaleS = parseTrack(scaleSFlag, scaleSEx);
        const scaleT = parseTrack(scaleTFlag, scaleTEx);
        const rot = parseTrack(rotFlag, rotEx);
        const transS = parseTrack(transSFlag, transSEx);
        const transT = parseTrack(transTFlag, transTEx);

        return { scaleS, scaleT, rot, transS, transT };
    });

    let entries: SRT0_TexData[] = [];
    for (let i = 0; i < animationEntries.length; i++) {
        const t = animationEntries[i];
        entries.push({ name: t.name, ...t.value });
    }

    return { duration, entries };
}

export function parse(buffer: ArrayBufferSlice): BTA0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x06) === 'BTA0\xFF\xFE');
    const version = view.getUint16(0x06, true);
    assert(version === 0x01);
    const fileSize = view.getUint32(0x08, true);
    assert(view.getUint16(0x0C, true) === 0x10);
    const dataBlocks = view.getUint16(0x0E, true);
    assert(dataBlocks === 1);
    assert(view.getUint32(0x10, true) === 0x14);
    assert(readString(buffer, 0x14, 0x04) === 'SRT0');

    const entries = parseResDict(buffer, 0x1C);
    assert(entries.length === 1);
    const srt0 = parseSRT0(buffer.slice(0x14 + entries[0].value));
    return { srt0 };
}

export const enum LoopMode {
    ONCE, REPEAT
}

export interface AnimationBase {
    duration: number;
}

export function getAnimFrame(anim: AnimationBase, frame: number, loopMode: LoopMode): number {
    // Be careful of floating point precision.
    const lastFrame = anim.duration;
    if (loopMode === LoopMode.ONCE) {
        if (frame > lastFrame)
            frame = lastFrame;
        return frame;
    } else if (loopMode === LoopMode.REPEAT) {
        while (frame > lastFrame)
            frame -= lastFrame;
        return frame;
    } else {
        throw "whoops";
    }
}

function lerp(k0: number, k1: number, t: number): number {
    return k0 + (k1 - k0) * t;
}

function sampleFloatAnimationTrack(track: AnimationTrack, frame: number): number {
    const frames = track.frames;

    if (frames.length === 1)
        return frames[0].value;

    // Find the right-hand frame.
    let idx1 = 0;
    for (; idx1 < frames.length; idx1++) {
        if (frame < frames[idx1].frame)
            break;
    }

    if (idx1 === 0)
        return frames[0].value;

    const idx0 = idx1 - 1;
    idx1 = idx1 % frames.length;
    
    const k0 = frames[idx0];
    const k1 = frames[idx1];

    const t = (frame - k0.frame) / (k1.frame - k0.frame);
    return lerp(k0.value, k1.value, t);
}

function rotationFromValue(dst: vec2, v: number): void {
    dst[0] = v & 0xFFFF;
    dst[1] = (v >>> 16) & 0xFFFF;
}

const scratchK0 = vec2.create();
const scratchK1 = vec2.create();
function sampleRotAnimationTrack(dst: vec2, track: AnimationTrack, frame: number) {
    const frames = track.frames;

    if (frames.length === 1)
        return rotationFromValue(dst, frames[0].value);

    // Find the right-hand frame.
    let idx1 = 0;
    for (; idx1 < frames.length; idx1++) {
        if (frame < frames[idx1].frame)
            break;
    }

    if (idx1 === 0)
        return rotationFromValue(dst, frames[0].value);

    const idx0 = idx1 - 1;
    idx1 = idx1 % frames.length;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    const t = (frame - idx0) / (k1.frame - k0.frame);
    rotationFromValue(scratchK0, k0.value);
    rotationFromValue(scratchK1, k1.value);
    dst[0] = lerp(scratchK0[0], scratchK1[0], t);
    dst[1] = lerp(scratchK0[1], scratchK1[1], t);
}

const scratchVec2 = vec2.create();
export class SRT0TexMtxAnimator {
    constructor(public animationController: AnimationController, public srt0: SRT0, public texData: SRT0_TexData) {
    }

    public calcTexMtx(dst: mat2d, texMtxMode: TexMtxMode, texScaleS: number, texScaleT: number, loopMode = LoopMode.REPEAT): void {
        const texData = this.texData;

        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.srt0, frame, loopMode);

        const scaleS = sampleFloatAnimationTrack(texData.scaleS, animFrame);
        const scaleT = sampleFloatAnimationTrack(texData.scaleT, animFrame);
        sampleRotAnimationTrack(scratchVec2, texData.rot, animFrame);
        const translationS = sampleFloatAnimationTrack(texData.transS, animFrame);
        const translationT = sampleFloatAnimationTrack(texData.transT, animFrame);
        calcTexMtx(dst, texMtxMode, texScaleS, texScaleT, scaleS, scaleT, scratchVec2[0], scratchVec2[1], translationS, translationT);
    }
}

export function bindSRT0(animationController: AnimationController, srt0: SRT0, materialName: string): SRT0TexMtxAnimator | null {
    const texData = srt0.entries.find((entry) => entry.name === materialName);
    if (texData === undefined)
        return null;
    return new SRT0TexMtxAnimator(animationController, srt0, texData);
}
