import { mat2d, mat4, vec3 } from 'gl-matrix';

import AnimationController from '../AnimationController.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { computeModelMatrixSRT, lerp, lerpAngle } from '../MathHelpers.js';
import { fx32 } from '../nns_g3d/NNS_G3D.js';
import { assert, readString } from '../util.js';
import { calcMPHTexMtx, fxAngle } from './mph_binModel.js';

interface AnimationChannel {
    interpolation: number;
    sampleCount: number;
    firstSampleIndex: number;
}

export interface MPHTexCoordAnimationEntry {
    name: string;
    scaleS: AnimationChannel;
    scaleT: AnimationChannel;
    rotation: AnimationChannel;
    translationS: AnimationChannel;
    translationT: AnimationChannel;
}

export interface MPHTexCoordAnimation {
    frameCount: number;
    scaleDataOffset: number;
    rotationDataOffset: number;
    translationDataOffset: number;
    entries: MPHTexCoordAnimationEntry[];
    buffer: ArrayBufferSlice;
}

export interface MPHAnimation {
    node: MPHNodeAnimation | null;
    texCoord: MPHTexCoordAnimation | null;
}

interface MPHNodeAnimationEntry {
    scaleX: AnimationChannel;
    scaleY: AnimationChannel;
    scaleZ: AnimationChannel;
    rotationX: AnimationChannel;
    rotationY: AnimationChannel;
    rotationZ: AnimationChannel;
    translationX: AnimationChannel;
    translationY: AnimationChannel;
    translationZ: AnimationChannel;
}

export interface MPHNodeAnimation {
    frameCount: number;
    scaleDataOffset: number;
    rotationDataOffset: number;
    translationDataOffset: number;
    entries: MPHNodeAnimationEntry[];
    buffer: ArrayBufferSlice;
}

function parseChannel(view: DataView, entryOffset: number, interpolationOffset: number, countOffset: number, indexOffset: number): AnimationChannel {
    return {
        interpolation: view.getUint8(entryOffset + interpolationOffset),
        sampleCount: view.getUint16(entryOffset + countOffset, true),
        firstSampleIndex: view.getUint16(entryOffset + indexOffset, true),
    };
}

function parseTexCoordAnimation(buffer: ArrayBufferSlice, trackOffset: number): MPHTexCoordAnimation {
    const view = buffer.createDataView();
    const entryCount = view.getUint32(trackOffset + 0x10, true);
    const entriesOffset = view.getUint32(trackOffset + 0x14, true);
    const entries: MPHTexCoordAnimationEntry[] = [];

    for (let i = 0; i < entryCount; i++) {
        const entryOffset = entriesOffset + i * 0x3C;
        entries.push({
            name: readString(buffer, entryOffset + 0x00, 0x20, true),
            scaleS: parseChannel(view, entryOffset, 0x20, 0x22, 0x26),
            scaleT: parseChannel(view, entryOffset, 0x21, 0x24, 0x28),
            rotation: parseChannel(view, entryOffset, 0x2A, 0x2C, 0x2E),
            translationS: parseChannel(view, entryOffset, 0x30, 0x32, 0x36),
            translationT: parseChannel(view, entryOffset, 0x31, 0x34, 0x38),
        });
    }

    return {
        frameCount: view.getUint32(trackOffset + 0x00, true),
        scaleDataOffset: view.getUint32(trackOffset + 0x04, true),
        rotationDataOffset: view.getUint32(trackOffset + 0x08, true),
        translationDataOffset: view.getUint32(trackOffset + 0x0C, true),
        entries,
        buffer,
    };
}

function parseNodeAnimation(buffer: ArrayBufferSlice, trackOffset: number, nodeCount: number): MPHNodeAnimation {
    const view = buffer.createDataView();
    const entriesOffset = view.getUint32(trackOffset + 0x10, true);
    const entries: MPHNodeAnimationEntry[] = [];
    for (let i = 0; i < nodeCount; i++) {
        const entryOffset = entriesOffset + i * 0x30;
        entries.push({
            scaleX: parseChannel(view, entryOffset, 0x00, 0x04, 0x0A),
            scaleY: parseChannel(view, entryOffset, 0x01, 0x06, 0x0C),
            scaleZ: parseChannel(view, entryOffset, 0x02, 0x08, 0x0E),
            rotationX: parseChannel(view, entryOffset, 0x10, 0x14, 0x1A),
            rotationY: parseChannel(view, entryOffset, 0x11, 0x16, 0x1C),
            rotationZ: parseChannel(view, entryOffset, 0x12, 0x18, 0x1E),
            translationX: parseChannel(view, entryOffset, 0x20, 0x24, 0x2A),
            translationY: parseChannel(view, entryOffset, 0x21, 0x26, 0x2C),
            translationZ: parseChannel(view, entryOffset, 0x22, 0x28, 0x2E),
        });
    }
    return {
        frameCount: view.getUint32(trackOffset + 0x00, true),
        scaleDataOffset: view.getUint32(trackOffset + 0x04, true),
        rotationDataOffset: view.getUint32(trackOffset + 0x08, true),
        translationDataOffset: view.getUint32(trackOffset + 0x0C, true),
        entries,
        buffer,
    };
}

export function parseMPHAnimation(buffer: ArrayBufferSlice, animationIndex: number = 0, nodeCount: number = 0): MPHAnimation {
    const view = buffer.createDataView();
    const animationCount = view.getUint16(0x14, true);
    if (animationCount === 0)
        return { node: null, texCoord: null };
    if (animationIndex >= animationCount)
        animationIndex = 0;

    // SetModelAnimation @ 0x02044CDC indexes five parallel pointer tables.
    // Tables 0 and 3 contain node and texture-coordinate animation.
    const nodeTableOffset = view.getUint32(0x00, true);
    const texCoordTableOffset = view.getUint32(0x0C, true);
    const nodeTrackOffset = nodeTableOffset !== 0 ? view.getUint32(nodeTableOffset + animationIndex * 4, true) : 0;
    const texCoordTrackOffset = texCoordTableOffset !== 0 ? view.getUint32(texCoordTableOffset + animationIndex * 4, true) : 0;
    return {
        node: nodeTrackOffset !== 0 && nodeCount !== 0 ? parseNodeAnimation(buffer, nodeTrackOffset, nodeCount) : null,
        texCoord: texCoordTrackOffset !== 0 ? parseTexCoordAnimation(buffer, texCoordTrackOffset) : null,
    };
}

export class MPHNodeAnimator {
    constructor(private animationController: AnimationController, private animation: MPHNodeAnimation) {
    }

    public calcNodeMatrix(dst: mat4, nodeIndex: number): void {
        const entry = this.animation.entries[nodeIndex];
        if (entry === undefined) {
            mat4.identity(dst);
            return;
        }
        const view = this.animation.buffer.createDataView();
        const frame = this.animationController.getTimeInFrames() % this.animation.frameCount;
        sampleVec3Smooth(scratchScale, view, this.animation.scaleDataOffset, [entry.scaleX, entry.scaleY, entry.scaleZ], frame, this.animation.frameCount, 4, true);
        sampleVec3Smooth(scratchRotation, view, this.animation.rotationDataOffset, [entry.rotationX, entry.rotationY, entry.rotationZ], frame, this.animation.frameCount, 2, false, 0x10000);
        sampleVec3Smooth(scratchTranslation, view, this.animation.translationDataOffset, [entry.translationX, entry.translationY, entry.translationZ], frame, this.animation.frameCount, 4, true);
        computeModelMatrixSRT(dst,
            fx32(scratchScale[0]), fx32(scratchScale[1]), fx32(scratchScale[2]),
            fxAngle(scratchRotation[0]), fxAngle(scratchRotation[1]), fxAngle(scratchRotation[2]),
            fx32(scratchTranslation[0]), fx32(scratchTranslation[1]), fx32(scratchTranslation[2]));
    }
}

const scratchScale = vec3.create();
const scratchRotation = vec3.create();
const scratchTranslation = vec3.create();

function sampleChannelFrame(view: DataView, dataOffset: number, channel: AnimationChannel, frame: number, frameCount: number, stride: number, signed: boolean): number {
    assert(stride !== 4 || signed);

    const getSample = (index: number): number => {
        const offset = dataOffset + index * stride;
        if (stride === 4)
            return view.getInt32(offset, true);
        return signed ? view.getInt16(offset, true) : view.getUint16(offset, true);
    };

    if (channel.sampleCount === 1)
        return getSample(channel.firstSampleIndex);
    if (channel.interpolation === 1)
        return getSample(channel.firstSampleIndex + frame);

    // From arm9.bin SampleFx32AnimationTrack @ 0x02058428 + SampleAngleAnimationTrack @ 0x02058344.
    // The interpolation value stores the sample rate as a power-of-two shift:
    // shift 1 has samples every two frames, shift 2 every four frames, and so on.
    // Regular subsampled tracks are followed by full-rate samples for the tail.
    // For example, an 18-frame track with shift 2 has regular samples at frames
    // 0, 4, 8, 12, and 16, followed by tail samples at frames 17 and 18.
    const sampleShift = channel.interpolation >>> 1;
    const frameSampleIndex = frame >> sampleShift;
    const lastKeyframe = ((frameCount - 1) >> sampleShift) << sampleShift;
    if (frame >= lastKeyframe) {
        assert(frameSampleIndex === (lastKeyframe >> sampleShift));
        return getSample(channel.firstSampleIndex + frameSampleIndex + (frame - lastKeyframe));
    }

    const sampleIndex = frameSampleIndex;
    const nextSampleIndex = sampleIndex + 1;
    assert(nextSampleIndex < channel.sampleCount);
    const subFrame = frame & ((1 << sampleShift) - 1);
    if (subFrame === 0)
        return getSample(channel.firstSampleIndex + sampleIndex);

    const t = subFrame / (1 << sampleShift);
    const a = getSample(channel.firstSampleIndex + sampleIndex);
    let b = getSample(channel.firstSampleIndex + nextSampleIndex);
    if (!signed) {
        if (a - b > 0x8000)
            b += 0x10000;
        else if (a - b < -0x8000)
            return lerp(a + 0x10000, b, t) & 0xFFFF;
    }
    const value = lerp(a, b, t);
    return signed ? value : value & 0xFFFF;
}

function sampleChannelSmooth(view: DataView, dataOffset: number, channel: AnimationChannel, frame: number, frameCount: number, stride: number, signed: boolean, wrap = 0): number {
    const frame0 = Math.floor(frame);
    const t = frame - frame0;
    const value0 = sampleChannelFrame(view, dataOffset, channel, frame0, frameCount, stride, signed);
    if (t === 0)
        return value0;

    const frame1 = (frame0 + 1) % frameCount;
    const value1 = sampleChannelFrame(view, dataOffset, channel, frame1, frameCount, stride, signed);
    return wrap !== 0 ? lerpAngle(value0, value1, t, wrap) : lerp(value0, value1, t);
}

function sampleVec3Smooth(dst: vec3, view: DataView, dataOffset: number, channels: readonly AnimationChannel[], frame: number, frameCount: number, stride: number, signed: boolean, wrap = 0): void {
    for (let i = 0; i < 3; i++)
        dst[i] = sampleChannelSmooth(view, dataOffset, channels[i], frame, frameCount, stride, signed, wrap);
}

export class MPHTexCoordAnimator {
    constructor(private animationController: AnimationController, private animation: MPHTexCoordAnimation, private entry: MPHTexCoordAnimationEntry) {
    }

    public calcTexMtx(dst: mat2d, texScaleS: number, texScaleT: number): void {
        const view = this.animation.buffer.createDataView();
        const frame = this.animationController.getTimeInFrames() % this.animation.frameCount;
        const scaleS = fx32(sampleChannelSmooth(view, this.animation.scaleDataOffset, this.entry.scaleS, frame, this.animation.frameCount, 4, true));
        const scaleT = fx32(sampleChannelSmooth(view, this.animation.scaleDataOffset, this.entry.scaleT, frame, this.animation.frameCount, 4, true));
        const rotation = fxAngle(sampleChannelSmooth(view, this.animation.rotationDataOffset, this.entry.rotation, frame, this.animation.frameCount, 2, false, 0x10000));
        const translationS = fx32(sampleChannelSmooth(view, this.animation.translationDataOffset, this.entry.translationS, frame, this.animation.frameCount, 4, true, 0x1000));
        const translationT = fx32(sampleChannelSmooth(view, this.animation.translationDataOffset, this.entry.translationT, frame, this.animation.frameCount, 4, true, 0x1000));

        calcMPHTexMtx(dst, texScaleS, texScaleT, scaleS, scaleT, rotation, translationS, translationT);
    }
}

export function bindMPHT(animationController: AnimationController, animation: MPHTexCoordAnimation, materialName: string): MPHTexCoordAnimator | null {
    const entry = animation.entries.find((entry) => entry.name === materialName);
    if (entry === undefined)
        return null;
    return new MPHTexCoordAnimator(animationController, animation, entry);
}
