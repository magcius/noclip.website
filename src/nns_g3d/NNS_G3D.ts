
// Nintendo NITRO-System (DS) G3D

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import * as NITRO_TEX from "../SuperMario64DS/nitro_tex";
import { mat4, mat2d, vec2 } from "gl-matrix";
import { GfxCullMode } from "../gfx/platform/GfxPlatform";
import AnimationController from "../AnimationController";
import { lerp } from "../MathHelpers";

//#region Misc Helpers
export function fx16(n: number): number {
    return n / (1 << 12);
}

export function fx32(n: number): number {
    return n / (1 << 12);
}

interface ResDictEntry<T> {
    name: string;
    value: T;
}

export function parseResDictGeneric<T>(buffer: ArrayBufferSlice, tableOffs: number, parseT: (view: DataView, entryTableIdx: number) => T): ResDictEntry<T>[] {
    const view = buffer.createDataView();
    // Revision
    assert(view.getUint8(tableOffs + 0x00) == 0x00);
    const numEntries = view.getUint8(tableOffs + 0x01);
    const size = view.getUint16(tableOffs + 0x02, true);
    const entryOffs = tableOffs + view.getUint16(tableOffs + 0x06, true);

    const sizeUnit = view.getUint16(entryOffs + 0x00, true);
    const nameTableOffs = entryOffs + view.getUint16(entryOffs + 0x02, true);

    const entries: ResDictEntry<T>[] = [];
    let entryTableIdx = entryOffs + 0x04;
    let nameTableIdx = nameTableOffs;
    for (let i = 0; i < numEntries; i++) {
        const name = readString(buffer, nameTableIdx + 0x00, 0x10, true);
        const value = parseT(view, entryTableIdx);
        entries.push({ name, value });
        entryTableIdx += sizeUnit;
        nameTableIdx += 0x10;
    }

    return entries;
}

export function parseResDict(buffer: ArrayBufferSlice, tableOffs: number): ResDictEntry<number>[] {
    return parseResDictGeneric(buffer, tableOffs, (view, entryTableIdx) => {
        return view.getUint32(entryTableIdx + 0x00, true);
    });
}
//#endregion

//#region NSBMD

// NITRO System Binary MoDel

export interface MDL0Node {
    name: string;
    jointMatrix: mat4;
}

export interface MDL0Material {
    name: string;
    textureName: string | null;
    paletteName: string | null;
    cullMode: GfxCullMode;
    alpha: number;
    polyAttribs: number;
    texParams: number;
    texMatrix: mat2d;
    texScaleS: number;
    texScaleT: number;
}

export interface MDL0Shape {
    name: string;
    dlBuffer: ArrayBufferSlice;
}

export interface MDL0Model {
    name: string;
    nodes: MDL0Node[];
    materials: MDL0Material[];
    shapes: MDL0Shape[];
    sbcBuffer: ArrayBufferSlice;
    posScale: number;
    texMtxMode: TexMtxMode;
}

export interface BMD0 {
    models: MDL0Model[];
    tex0: TEX0 | null;
}

function parseNode(buffer: ArrayBufferSlice, name: string): MDL0Node {
    const view = buffer.createDataView();

    const enum NodeFlags {
        TRANS_ZERO = 0x0001,
        ROT_ZERO = 0x0002,
        SCALE_ONE = 0x0004,
        PIVOT_EXIST = 0x0008,
        PIVOT_MINUS = 0x0100,
        SIGN_REVC = 0x0200,
        SIGN_REVD = 0x0400,
    };

    const flags = view.getUint16(0x00, true);
    const _00 = fx16(view.getInt16(0x02, true));
    let idx = 0x04;

    const jointMatrix = mat4.create();
    if (!(flags & NodeFlags.TRANS_ZERO)) {
        jointMatrix[12] = fx32(view.getInt32(idx + 0x00, true));
        jointMatrix[13] = fx32(view.getInt32(idx + 0x04, true));
        jointMatrix[14] = fx32(view.getInt32(idx + 0x08, true));
        idx += 0x0C;
    }

    if (!(flags & NodeFlags.ROT_ZERO)) {
        if (flags & NodeFlags.PIVOT_EXIST) {
            // Pivot is compressed form.
            const pivotIdx = (flags >>> 4) & 0x0F;
            const pivotValue = (flags & NodeFlags.PIVOT_MINUS) ? -1 : 1;
            const A = fx16(view.getInt16(idx + 0x00, true));
            const B = fx16(view.getInt16(idx + 0x02, true));
            const C = (flags & NodeFlags.SIGN_REVC) ? -B : B;
            const D = (flags & NodeFlags.SIGN_REVD) ? -A : A;

            // The pivot determines the identity value. The row and column it contains is
            // omitted entirely.

            if (pivotIdx === 0) {
                // Top left
                jointMatrix[0] = pivotValue;
                jointMatrix[1] = 0;
                jointMatrix[2] = 0;

                jointMatrix[4] = 0;
                jointMatrix[5] = A;
                jointMatrix[6] = B;

                jointMatrix[9] = 0;
                jointMatrix[10] = C;
                jointMatrix[11] = D;
            } else if (pivotIdx === 2) {
                // Top right
                jointMatrix[0] = 0;
                jointMatrix[1] = A;
                jointMatrix[2] = B;

                jointMatrix[4] = 0;
                jointMatrix[5] = C;
                jointMatrix[6] = D;

                jointMatrix[9] = pivotValue;
                jointMatrix[10] = 0;
                jointMatrix[11] = 0;
            } else if (pivotIdx === 4) {
                // Center center
                jointMatrix[0] = A;
                jointMatrix[1] = 0;
                jointMatrix[2] = B;

                jointMatrix[4] = 0;
                jointMatrix[5] = pivotValue;
                jointMatrix[6] = 0;

                jointMatrix[8] = C;
                jointMatrix[9] = 0;
                jointMatrix[10] = D;
            } else if (pivotIdx === 8) {
                // Bottom right
                jointMatrix[0] = A;
                jointMatrix[1] = B;
                jointMatrix[2] = 0;

                jointMatrix[4] = C;
                jointMatrix[5] = D;
                jointMatrix[6] = 0;

                jointMatrix[8] = 0;
                jointMatrix[9] = 0;
                jointMatrix[10] = pivotValue;
            } else {
                console.warn(`Unsupported joint pivot ${pivotIdx}`);
            }

            idx += 0x04;
        } else {
            jointMatrix[0]  = _00;
            jointMatrix[1]  = fx16(view.getInt16(idx + 0x00, true));
            jointMatrix[2]  = fx16(view.getInt16(idx + 0x02, true));
            jointMatrix[4]  = fx16(view.getInt16(idx + 0x04, true));
            jointMatrix[5]  = fx16(view.getInt16(idx + 0x06, true));
            jointMatrix[6]  = fx16(view.getInt16(idx + 0x08, true));
            jointMatrix[8]  = fx16(view.getInt16(idx + 0x0A, true));
            jointMatrix[9]  = fx16(view.getInt16(idx + 0x0C, true));
            jointMatrix[10] = fx16(view.getInt16(idx + 0x0E, true));
            idx += 0x10;
        }
    }

    if (!(flags & NodeFlags.SCALE_ONE)) {
        idx += 0x06;
    }

    return { name, jointMatrix };
}

function expand5to8(n: number): number {
    return (n << (8 - 5)) | (n >>> (10 - 8));
}

function translateCullMode(renderWhichFaces: number): GfxCullMode {
    switch (renderWhichFaces) {
    case 0x00: // Render Nothing
        return GfxCullMode.FRONT_AND_BACK;
    case 0x01: // Render Back
        return GfxCullMode.FRONT;
    case 0x02: // Render Front
        return GfxCullMode.BACK;
    case 0x03: // Render Front and Back
        return GfxCullMode.NONE;
    default:
        throw new Error("Unknown renderWhichFaces");
    }
}

function calcTexMtx_Maya(dst: mat2d, texScaleS: number, texScaleT: number, scaleS: number, scaleT: number, sinR: number, cosR: number, translationS: number, translationT: number): void {
    dst[0] = texScaleS * scaleS *  cosR;
    dst[1] = texScaleT * scaleT * -sinR * (texScaleS / texScaleT);
    dst[2] = texScaleS * scaleS *  sinR * (texScaleT / texScaleS);
    dst[3] = texScaleT * scaleT *  cosR;
    dst[4] = scaleS * ((-0.5 * cosR) - (0.5 * sinR - 0.5) - translationS);
    dst[5] = scaleT * ((-0.5 * cosR) + (0.5 * sinR - 0.5) + translationT) + 1;
}

function calcTexMtx_Max(dst: mat2d, texScaleS: number, texScaleT: number, scaleS: number, scaleT: number, sinR: number, cosR: number, translationS: number, translationT: number): void {
    dst[0] = texScaleS * scaleS *  cosR;
    dst[1] = texScaleT * scaleT * -sinR * (texScaleS / texScaleT);
    dst[2] = texScaleS * scaleS *  sinR * (texScaleT / texScaleS);
    dst[3] = texScaleT * scaleT *  cosR;
    dst[4] = (scaleS * -cosR * (translationS + 0.5)) + (scaleS * sinR * (translationT - 0.5)) + 0.5;
    dst[5] = (scaleT *  sinR * (translationS + 0.5)) + (scaleT * cosR * (translationT - 0.5)) + 0.5;
}

export const enum TexMtxMode {
    MAYA = 0x00, // Maya
    SI3D = 0x01, // Softimage|3D
    MAX  = 0x02, // 3D Studio Max
    XSI  = 0x03, // Softimage|XSI
}

export function calcTexMtx(dst: mat2d, texMtxMode: TexMtxMode, texScaleS: number, texScaleT: number, scaleS: number, scaleT: number, sinR: number, cosR: number, translationS: number, translationT: number): void {
    switch (texMtxMode) {
    case TexMtxMode.MAYA:
        return calcTexMtx_Maya(dst, texScaleS, texScaleT, scaleS, scaleT, sinR, cosR, translationS, translationT);
    case TexMtxMode.MAX:
        return calcTexMtx_Max(dst, texScaleS, texScaleT, scaleS, scaleT, sinR, cosR, translationS, translationT);
    default:
        throw "whoops";
    }
}

function parseMaterial(buffer: ArrayBufferSlice, name: string, texMtxMode: TexMtxMode): MDL0Material {
    const view = buffer.createDataView();

    const itemTag = view.getUint16(0x00, true);
    assert(itemTag === 0x00);

    const size = view.getUint16(0x02, true);
    const diffAmb = view.getUint32(0x04, true);
    const specEmi = view.getUint32(0x08, true);
    const polyAttribs = view.getUint32(0x0C, true);
    const polyAttribsMask = view.getUint32(0x10, true);
    const texParams = view.getUint32(0x14, true);
    const texParamsMask = view.getUint32(0x18, true);
    const texPlttBase = view.getUint16(0x1C, true);
    const flag = view.getUint16(0x1E, true);
    const origWidth = view.getUint16(0x20, true);
    const origHeight = view.getUint16(0x22, true);
    const magW = fx32(view.getInt32(0x24, true));
    const magH = fx32(view.getInt32(0x28, true));

    const texScaleS = 1 / origWidth;
    const texScaleT = 1 / origHeight;

    const enum MaterialFlags {
        USE = 0x0001,
        SCALE_ONE = 0x0002,
        ROT_ZERO = 0x0004,
        TRANS_ZERO = 0x0008,
    }

    const texMatrix = mat2d.create();

    let scaleS = 1.0, scaleT = 1.0;
    let cosR = 1.0, sinR = 0.0;
    let translationS = 0.0, translationT = 0.0;
    let idx = 0x2C;
    if (!(flag & MaterialFlags.SCALE_ONE)) {
        scaleS = fx32(view.getInt32(idx + 0x00, true));
        scaleT = fx32(view.getInt32(idx + 0x04, true));
        idx += 0x08;
    }
    if (!(flag & MaterialFlags.ROT_ZERO)) {
        sinR = fx32(view.getUint32(idx + 0x00, true));
        cosR = fx32(view.getUint32(idx + 0x04, true));
        idx += 0x08;
    }
    if (!(flag & MaterialFlags.TRANS_ZERO)) {
        translationS = fx32(view.getUint32(idx + 0x00, true));
        translationT = fx32(view.getUint32(idx + 0x04, true));
        idx += 0x08;
    }
    calcTexMtx_Maya(texMatrix, texScaleS, texScaleT, scaleS, scaleT, sinR, cosR, translationS, translationT);

    // To be filled in later.
    const textureName: string | null = null;
    const paletteName: string | null = null;

    const renderWhichFaces = (polyAttribs >> 6) & 0x03;
    const cullMode = translateCullMode(renderWhichFaces);

    const alpha = expand5to8((polyAttribs >> 16) & 0x1F);

    return { name, textureName, paletteName, cullMode, alpha, polyAttribs, texParams, texMatrix, texScaleS, texScaleT };
}

function parseShape(buffer: ArrayBufferSlice, name: string): MDL0Shape {
    const view = buffer.createDataView();

    const itemTag = view.getUint16(0x00, true);
    assert(itemTag === 0x00);
    const size = view.getUint16(0x02, true);
    const flag = view.getUint32(0x04, true);
    const dlOffs = view.getUint32(0x08, true);
    const dlSize = view.getUint32(0x0C, true);

    const dlBuffer = buffer.subarray(dlOffs, dlSize);
    return { name, dlBuffer };
}

function parseModel(buffer: ArrayBufferSlice, name: string): MDL0Model {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00, true);
    const sbcOffs = view.getUint32(0x04, true);
    const materialSectionOffs = view.getUint32(0x08, true);
    const shapeSectionOffs = view.getUint32(0x0C, true);
    const envelopeSectionOffs = view.getUint32(0x10, true);

    // ModelInfo
    const sbcType = view.getUint8(0x14);
    const scalingRule = view.getUint8(0x15);
    const texMtxMode = view.getUint8(0x16);
    const nodeTableCount = view.getUint8(0x17);
    const materialTableCount = view.getUint8(0x18);
    const shapeTableCount = view.getUint8(0x19);
    const firstUnusedMtxStackID = view.getUint8(0x1A);
    // Unused.
    const posScale = fx32(view.getInt32(0x1C, true));
    const invPosScale = fx32(view.getInt32(0x20, true));
    const numVertices = view.getUint16(0x24, true);
    const numPolygons = view.getUint16(0x26, true);
    const numTriangles = view.getUint16(0x28, true);
    const numQuads = view.getUint16(0x2A, true);

    const bboxMinX = view.getInt16(0x2C, true);
    const bboxMinY = view.getInt16(0x2E, true);
    const bboxMinZ = view.getInt16(0x30, true);
    const bboxMaxX = bboxMinX + view.getInt16(0x32, true);
    const bboxMaxY = bboxMinY + view.getInt16(0x34, true);
    const bboxMaxZ = bboxMinZ + view.getInt16(0x36, true);

    const bboxPosScale = fx32(view.getInt32(0x38, true));
    const bboxInvPosScale = fx32(view.getInt32(0x3C, true));

    // Node table
    const nodeSectionOffs = 0x40;
    const nodeTableDict = parseResDict(buffer, nodeSectionOffs + 0x00);
    assert(nodeTableDict.length === nodeTableCount);
    const nodes: MDL0Node[] = [];
    for (let i = 0; i < nodeTableDict.length; i++)
        nodes.push(parseNode(buffer.slice(nodeSectionOffs + nodeTableDict[i].value), nodeTableDict[i].name));

    // Material table
    function parseMaterialDictEntry(view: DataView, entryTableIdx: number) {
        const indexOffs = view.getUint16(entryTableIdx + 0x00, true);
        const numMaterials = view.getUint8(entryTableIdx + 0x02);
        const isBound = !!view.getUint8(entryTableIdx + 0x03);
        return { isBound, numMaterials, indexOffs };
    }

    const materialTextureDict = parseResDictGeneric(buffer, materialSectionOffs + view.getUint16(materialSectionOffs + 0x00, true), parseMaterialDictEntry);
    const materialPaletteDict = parseResDictGeneric(buffer, materialSectionOffs + view.getUint16(materialSectionOffs + 0x02, true), parseMaterialDictEntry);
    const materialTableDict = parseResDict(buffer, materialSectionOffs + 0x04);
    assert(materialTableDict.length === materialTableCount);
    const materials: MDL0Material[] = [];
    for (let i = 0; i < materialTableDict.length; i++)
        materials.push(parseMaterial(buffer.slice(materialSectionOffs + materialTableDict[i].value), materialTableDict[i].name, texMtxMode));

    function getMaterialsFromIndexDictEntry(v: ReturnType<typeof parseMaterialDictEntry>): MDL0Material[] {
        const localMaterials: MDL0Material[] = [];
        for (let i = 0; i < v.numMaterials; i++)
            localMaterials.push(materials[view.getUint8(materialSectionOffs + v.indexOffs + i)]);
        return localMaterials;
    }

    // Set material texture/palette names.
    for (const { name, value } of materialTextureDict)
        for (const material of getMaterialsFromIndexDictEntry(value))
            material.textureName = name;

    for (const { name, value } of materialPaletteDict)
        for (const material of getMaterialsFromIndexDictEntry(value))
            material.paletteName = name;

    // Shape table
    const shapeTableDict = parseResDict(buffer, shapeSectionOffs + 0x00);
    assert(shapeTableDict.length === shapeTableCount);
    const shapes: MDL0Shape[] = [];
    for (let i = 0; i < shapeTableDict.length; i++)
        shapes.push(parseShape(buffer.slice(shapeSectionOffs + shapeTableDict[i].value), shapeTableDict[i].name));

    // SBC
    const sbcBuffer = buffer.slice(sbcOffs, materialSectionOffs);

    return { name, nodes, materials, shapes, sbcBuffer, posScale, texMtxMode };
}

export function parseNSBMD(buffer: ArrayBufferSlice): BMD0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x06) === 'BMD0\xFF\xFE');
    const version = view.getUint16(0x06, true);
    assert(version === 0x02);
    const fileSize = view.getUint32(0x08, true);
    assert(view.getUint16(0x0C, true) === 0x10);
    const dataBlocks = view.getUint16(0x0E, true);
    assert(dataBlocks === 1 || dataBlocks === 2);

    const modelSetOffs = view.getUint32(0x10, true);
    assert(readString(buffer, modelSetOffs + 0x00, 0x04) === 'MDL0');
    const modelSetSize = view.getUint32(modelSetOffs + 0x04, true);
    const modelEntries = parseResDict(buffer, modelSetOffs + 0x08);

    const models: MDL0Model[] = [];
    for (let i = 0; i < modelEntries.length; i++)
        models.push(parseModel(buffer.slice(modelSetOffs + modelEntries[i].value), modelEntries[i].name));

    let tex0: TEX0 | null = null;
    if (dataBlocks > 1) {
        // Textures.
        // TODO(jstpierre): Finish
        const tex0Offs = view.getUint32(0x14, true);
        tex0 = parseTex0Block(buffer.slice(tex0Offs));
    }

    return { models, tex0 };
}
//#endregion

//#region NSBTA

// NITRO System Binary Texture Animation

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

export function parseNSBTA(buffer: ArrayBufferSlice): BTA0 {
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
//#endregion

//#region NSBTP

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

export function parseNSBTP(buffer: ArrayBufferSlice): BTP0 {
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
        if (frame >= frames[idx0].frame)
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
//#endregion

//#region NSBCA

// NITRO System Binary Character Animation

// TODO(jstpierre): Implement this

//#endregion

//#region NSBTX

// Nitro System Binary TeXture

export interface TEX0Texture {
    name: string;
    format: NITRO_TEX.Format;
    width: number;
    height: number;
    color0: boolean;
    texData: ArrayBufferSlice;
    palIdxData: ArrayBufferSlice | null;
}

export interface TEX0Palette {
    name: string;
    data: ArrayBufferSlice;
}

export interface TEX0 {
    textures: TEX0Texture[];
    palettes: TEX0Palette[];
}

export function parseTex0Block(buffer: ArrayBufferSlice): TEX0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) == 'TEX0');
    const size = view.getUint32(0x04, true);

    const textureSize = view.getUint16(0x0C, true);
    const textureDictOffs = view.getUint16(0x0E, true);
    const textureDataOffs = view.getUint32(0x14, true);

    const tex4x4Size = view.getUint16(0x1C, true);
    const tex4x4DataOffs = view.getUint32(0x24, true);
    const tex4x4PalIdxDataOffs = view.getUint32(0x28, true);

    const textureDict = parseResDictGeneric(buffer, textureDictOffs, (view, entryTableIdx) => {
        const texImageParamW0 = view.getUint32(entryTableIdx + 0x00, true);
        const texImageParam = NITRO_TEX.parseTexImageParam(texImageParamW0);
        let texData: ArrayBufferSlice;
        let palIdxData: ArrayBufferSlice | null = null;

        const imageOffs = (texImageParamW0 & 0xFFFF) << 3;
        if (texImageParam.format === NITRO_TEX.Format.Tex_CMPR_4x4) {
            const texDataStart = tex4x4DataOffs + imageOffs;
            const palIdxDataStart = tex4x4PalIdxDataOffs + (imageOffs >>> 1);
            texData = buffer.slice(texDataStart);
            palIdxData = buffer.slice(palIdxDataStart);
        } else {
            const texDataStart = textureDataOffs + imageOffs;
            texData = buffer.slice(texDataStart);
        }

        return { texData, palIdxData, texImageParam };
    });

    const paletteDictOffs = view.getUint16(0x34, true);
    const paletteDataOffs = view.getUint32(0x38, true);
    const paletteDict = parseResDictGeneric(buffer, paletteDictOffs, (view, entryTableIdx) => {
        const dataStart = paletteDataOffs + (view.getUint16(entryTableIdx + 0x00, true) << 3);
        const data = buffer.slice(dataStart);
        return { data };
    });

    const textures: TEX0Texture[] = [];
    for (const textureDictEntry of textureDict) {
        const name = textureDictEntry.name;
        const { format, width, height, color0 } = textureDictEntry.value.texImageParam;
        const { texData, palIdxData } = textureDictEntry.value;
        textures.push({ name, format, width, height, color0, texData, palIdxData });
    }

    const palettes: TEX0Palette[] = [];
    for (const paletteDictEntry of paletteDict) {
        const name = paletteDictEntry.name;
        const data = paletteDictEntry.value.data;
        palettes.push({ name, data });
    }

    return { textures, palettes };
}

export interface BTX0 {
    tex0: TEX0;
}

export function parseNSBTX(buffer: ArrayBufferSlice): BTX0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x06) === 'BTX0\xFF\xFE');
    const version = view.getUint16(0x06, true);
    assert(version === 0x01);
    const fileSize = view.getUint32(0x08, true);
    assert(view.getUint16(0x0C, true) === 0x10);
    const dataBlocks = view.getUint16(0x0E, true);
    assert(dataBlocks === 1);
    
    const tex0Offs = view.getUint32(0x10, true);
    const tex0 = parseTex0Block(buffer.slice(tex0Offs));

    return { tex0 };
}
//#endregion
