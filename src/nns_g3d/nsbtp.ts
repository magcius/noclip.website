
import { assert, readString } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { parseResDict, parseResDictGeneric, fx16 } from "./nsbmd";
import AnimationController from "../AnimationController";
import { LoopMode, getAnimFrame } from "./nsbta";

// NITRO System Binary Texture Palette Animation

export interface BTP0 {
    pat0: PAT0[];
}

interface PAT0_TexFrameData {
    frame: number;
    texName: string;
    plttName: string;
    fullTextureName: string;
}

interface PAT0_MatData {
    name: string;
    animationTrack: PAT0_TexFrameData[];
}

export interface PAT0 {
    name: string;
    duration: number;
    entries: PAT0_MatData[];
}

function parsePAT0(buffer: ArrayBufferSlice, name: string): PAT0 {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04, false) === 'M\x00PT');
    const duration = view.getUint16(0x04, true);
    const texCount = view.getUint8(0x06);
    const plttCount = view.getUint8(0x07);
    let texNameTableIdx = view.getUint16(0x08, true);
    let plttNameTableIdx = view.getUint16(0x0A, true);

    const texNames: string[] = [];
    for (let i = 0; i < texCount; i++) {
        texNames.push(readString(buffer, texNameTableIdx, 0x10, true));
        texNameTableIdx += 0x10;
    }

    const plttNames: string[] = [];
    for (let i = 0; i < plttCount; i++) {
        plttNames.push(readString(buffer, plttNameTableIdx, 0x10, true));
        plttNameTableIdx += 0x10;
    }

    const animationEntries = parseResDictGeneric(buffer, 0x0C, (view, entryTableIdx) => {
        const numFV = view.getUint16(entryTableIdx + 0x00, true);
        const flag = view.getUint16(entryTableIdx + 0x02, true);
        const ratioDataFrame = fx16(view.getUint16(entryTableIdx + 0x04, true));
        let fvTableIdx = view.getUint16(entryTableIdx + 0x06, true);
        const animationTrack: PAT0_TexFrameData[] = [];
        for (let i = 0; i < numFV; i++) {
            const frame = view.getUint16(fvTableIdx + 0x00, true);
            const texIdx = view.getUint8(fvTableIdx + 0x02);
            const plttIdx = view.getUint8(fvTableIdx + 0x03);
            const texName = texNames[texIdx];
            const plttName = plttNames[plttIdx];
            const fullTextureName = `${texName}/${plttName}`;
            animationTrack.push({ frame, texName, plttName, fullTextureName });
            fvTableIdx += 0x04;
        }
        return { animationTrack };
    });

    let entries: PAT0_MatData[] = [];
    for (let i = 0; i < animationEntries.length; i++) {
        const t = animationEntries[i];
        entries.push({ name: t.name, ...t.value });
    }

    return { name, duration, entries };
}

export function parse(buffer: ArrayBufferSlice): BTP0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x06) === 'BTP0\xFF\xFE');
    const version = view.getUint16(0x06, true);
    assert(version === 0x01);
    const fileSize = view.getUint32(0x08, true);
    assert(view.getUint16(0x0C, true) === 0x10);
    const dataBlocks = view.getUint16(0x0E, true);
    assert(dataBlocks === 1);
    assert(view.getUint32(0x10, true) === 0x14);
    assert(readString(buffer, 0x14, 0x04) === 'PAT0');

    const entries = parseResDict(buffer, 0x1C);
    assert(entries.length >= 1);
    const pat0: PAT0[] = [];
    for (let i = 0; i < entries.length; i++) {
        const pat0_ = parsePAT0(buffer.slice(0x14 + entries[i].value), entries[i].name);
        pat0.push(pat0_);
    }
    return { pat0 };
}

function findFrameData<T extends { frame: number }>(frames: T[], frame: number): T {
    if (frames.length === 1)
        return frames[0];

    // Find the left-hand frame.
    let idx0 = frames.length;
    while (idx0-- > 0) {
        if (frame > frames[idx0].frame)
            break;
    }

    return frames[idx0];
}

export class PAT0TexAnimator {
    constructor(public animationController: AnimationController, public pat0: PAT0, public matData: PAT0_MatData) {
    }

    public calcFullTextureName(loopMode = LoopMode.REPEAT): string {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.pat0, frame, loopMode);

        const frameData = findFrameData(this.matData.animationTrack, animFrame);
        return frameData.fullTextureName;
    }
}

export function bindPAT0(animationController: AnimationController, pat0: PAT0, materialName: string): PAT0TexAnimator | null {
    const texData = pat0.entries.find((entry) => entry.name === materialName);
    if (texData === undefined)
        return null;
    return new PAT0TexAnimator(animationController, pat0, texData);
}
