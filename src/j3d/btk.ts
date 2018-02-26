
import { mat3 } from 'gl-matrix';

import { createTexMtx } from './bmd';

import { betoh } from '../endian';
import { assert, readString } from '../util';

function readStringTable(buffer: ArrayBuffer, offs: number): string[] {
    const view = new DataView(buffer, offs);
    const stringCount = view.getUint16(0x00);

    let tableIdx = 0x06;
    const strings = [];
    for (let i = 0; i < stringCount; i++) {
        const stringOffs = view.getUint16(tableIdx);
        const str = readString(buffer, offs + stringOffs, 255);
        strings.push(str);
        tableIdx += 0x04;
    }

    return strings;
}

export const enum LoopMode {
    ONCE = 0,
    REPEAT = 2,
    MIRRORED_ONCE = 3,
    MIRRORED_REPEAT = 4,
}

export const enum TangentType {
    IN = 0,
    IN_OUT = 1,
}

export interface AnimationKeyframe {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
}

export interface AnimationTrack {
    frames: AnimationKeyframe[];
}

export interface AnimationComponent {
    scale: AnimationTrack;
    rotation: AnimationTrack;
    translation: AnimationTrack;
}

export interface MaterialAnimationEntry {
    materialName: string;
    remapIndex: number;
    texMtxIndex: number;
    centerS: number;
    centerT: number;
    centerQ: number;
    s: AnimationComponent;
    t: AnimationComponent;
    q: AnimationComponent;
}

export interface TTK1 {
    duration: number;
    loopMode: LoopMode;
    rotationScale: number;
    materialAnimationEntries: MaterialAnimationEntry[];
}

function readTTK1Chunk(btk: BTK, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
    const loopMode: LoopMode = view.getUint8(0x08);
    const rotationDecimal = view.getUint8(0x09);
    const duration = view.getUint16(0x0A);
    const animationCount = view.getUint16(0x0C) / 3;
    const sCount = view.getUint16(0x0E);
    const rCount = view.getUint16(0x10);
    const tCount = view.getUint16(0x12);
    const animationTableOffs = view.getUint32(0x14);
    const remapTableOffs = view.getUint32(0x18);
    const materialNameTableOffs = view.getUint32(0x1C);
    const texMtxIndexTableOffs = view.getUint32(0x20);
    const textureCenterTableOffs = view.getUint32(0x24);
    const sTableOffs = chunkStart + view.getUint32(0x28);
    const rTableOffs = chunkStart + view.getUint32(0x2C);
    const tTableOffs = chunkStart + view.getUint32(0x30);

    const sTable = new Float32Array(betoh(buffer.slice(sTableOffs, sTableOffs + sCount * 4), 4));
    const rTable = new Int16Array(betoh(buffer.slice(rTableOffs, rTableOffs + rCount * 2), 2));
    const tTable = new Float32Array(betoh(buffer.slice(tTableOffs, tTableOffs + tCount * 4), 4));

    const rotationScale = Math.pow(2, rotationDecimal);
    const materialNameTable = readStringTable(buffer, chunkStart + materialNameTableOffs);

    let animationTableIdx = animationTableOffs;

    function readAnimationTrack(data: Float32Array | Int16Array): AnimationTrack {
        const count = view.getUint16(animationTableIdx + 0x00);
        const index = view.getUint16(animationTableIdx + 0x02);
        const tangent: TangentType = view.getUint16(animationTableIdx + 0x04);
        animationTableIdx += 0x06;

        // Special exception.
        if (count === 1) {
            const value = data[index];
            const frames = [ { time: 0, value: value, tangentIn: 0, tangentOut: 0 } ];
            return { frames };
        } else {
            let frames: AnimationKeyframe[] = [];

            if (tangent === TangentType.IN) {
                for (let i = index; i < index + 3 * count; i += 3) {
                    const time = data[i+0], value = data[i+1], tangentIn = data[i+2], tangentOut = tangentIn;
                    frames.push({ time, value, tangentIn, tangentOut });
                }
            } else if (tangent === TangentType.IN_OUT) {
                for (let i = index; i < index + 4 * count; i += 4) {
                    const time = data[i+0], value = data[i+1], tangentIn = data[i+2], tangentOut = data[i+3];
                    frames.push({ time, value, tangentIn, tangentOut });
                }
            }

            return { frames };
        }
    }

    function readAnimationComponent(): AnimationComponent {
        const scale = readAnimationTrack(sTable);
        const rotation = readAnimationTrack(rTable);
        const translation = readAnimationTrack(tTable);
        return { scale, rotation, translation };
    }

    const materialAnimationEntries: MaterialAnimationEntry[] = [];
    for (let i = 0; i < animationCount; i++) {
        const materialName = materialNameTable[i];
        const remapIndex = view.getUint16(remapTableOffs + i * 0x02);
        const texMtxIndex = view.getUint8(texMtxIndexTableOffs + i);
        const centerS = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x00);
        const centerT = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x04);
        const centerQ = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x08);
        const s = readAnimationComponent();
        const t = readAnimationComponent();
        const q = readAnimationComponent();
        materialAnimationEntries.push({ materialName, remapIndex, texMtxIndex, centerS, centerT, centerQ, s, t, q });
    }

    btk.ttk1 = { duration, loopMode, rotationScale, materialAnimationEntries };
}

export class BTK {
    ttk1: TTK1;

    public findAnimationEntry(materialName: string, texMtxIndex: number) {
        return this.ttk1.materialAnimationEntries.find((e) => e.materialName === materialName && e.texMtxIndex === texMtxIndex);
    }

    public applyLoopMode(t: number, loopMode: LoopMode) {
        switch (loopMode) {
        case LoopMode.ONCE:
            return Math.min(t, 1);
        case LoopMode.REPEAT:
            return t % 1;
        case LoopMode.MIRRORED_ONCE:
            return 1 - Math.abs((Math.min(t, 2) - 1));
        case LoopMode.MIRRORED_REPEAT:
            return 1 - Math.abs((t % 2) - 1);
        }
    }

    public cubicEval(cf0, cf1, cf2, cf3, t) {
        return (((cf0 * t + cf1) * t + cf2) * t + cf3);
    }

    public lerp(k0: AnimationKeyframe, k1: AnimationKeyframe, t: number) {
        return k0.value + (k1.value - k0.value) * t;
    }

    public hermiteInterpolate(k0: AnimationKeyframe, k1: AnimationKeyframe, t: number): number {
        const length = k1.time - k0.time;
        const p0 = k0.value;
        const p1 = k1.value;
        const s0 = k0.tangentOut * length;
        const s1 = k1.tangentIn * length;
		const cf0 = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1);
		const cf1 = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1);
		const cf2 = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0);
		const cf3 = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0);
        return this.cubicEval(cf0, cf1, cf2, cf3, t);
    }

    public sampleAnimationData(track: AnimationTrack, frame: number) {
        const frames = track.frames;

        if (frames.length === 1)
            return frames[0].value;

        // Find the first frame.
        const idx1 = frames.findIndex((key) => (frame < key.time));
        const idx0 = idx1 - 1;
        if (idx1 >= frames.length)
            return frames[idx0].value;

        const k0 = frames[idx0];
        const k1 = frames[idx1];
        const t = (frame - k0.time) / (k1.time - k0.time);
        // return this.lerp(k0, k1, t);
        return this.hermiteInterpolate(k0, k1, t);
    }

    public applyAnimation(dst: mat3, materialName: string, texMtxIndex: number, time: number): boolean {
        const animationEntry = this.findAnimationEntry(materialName, texMtxIndex);
        if (!animationEntry)
            return false;

        const duration = this.ttk1.duration;
        const frame = time / FPS;
        const normTime = frame / duration;
        const animFrame = this.applyLoopMode(normTime, this.ttk1.loopMode) * duration;

        const centerS = animationEntry.centerS, centerT = animationEntry.centerT, centerQ = animationEntry.centerQ;
        const scaleS = this.sampleAnimationData(animationEntry.s.scale, animFrame);
        const scaleT = this.sampleAnimationData(animationEntry.t.scale, animFrame);
        const rotation = this.sampleAnimationData(animationEntry.s.rotation, animFrame) * this.ttk1.rotationScale;
        const translationS = this.sampleAnimationData(animationEntry.s.translation, animFrame);
        const translationT = this.sampleAnimationData(animationEntry.t.translation, animFrame);

        createTexMtx(dst, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);

        return true;
    }
}

const FPS = 30;

export function parse(buffer: ArrayBuffer) {
    const btk = new BTK();

    const view = new DataView(buffer);
    const magic = readString(buffer, 0, 8);
    assert(magic === 'J3D1btk1');

    const size = view.getUint32(0x08);
    const numChunks = view.getUint32(0x0C);
    let offs = 0x20;

    type ParseFunc = (btk: BTK, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) => void;
    const parseFuncs: { [name: string]: ParseFunc } = {
        TTK1: readTTK1Chunk,
    };

    for (let i = 0; i < numChunks; i++) {
        const chunkStart = offs;
        const chunkId = readString(buffer, chunkStart + 0x00, 4);
        const chunkSize = view.getUint32(chunkStart + 0x04);

        const parseFunc = parseFuncs[chunkId];
        if (parseFunc === undefined)
            throw new Error(`Unknown chunk ${chunkId}!`);

        if (parseFunc !== null)
            parseFunc(btk, buffer, chunkStart, chunkSize);

        offs += chunkSize;
    }

    return btk;
}
