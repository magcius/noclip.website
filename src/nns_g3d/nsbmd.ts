
// NITRO System Binary MoDel

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import { mat4, mat2d } from "gl-matrix";
import { GfxCullMode } from "../gfx/platform/GfxPlatform";
import { TEX0, parseTex0Block } from "./nsbtx";

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
}

export interface BMD0 {
    models: MDL0Model[];
    tex0: TEX0;
}

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

function parseNode(buffer: ArrayBufferSlice, name: string): MDL0Node {
    const view = buffer.createDataView();

    const enum NodeFlags {
        TRANS_ZERO = 0x0001,
        ROT_ZERO = 0x0002,
        SCALE_ONE = 0x0004,
        PIVOT_EXIST = 0x0008,
        PIVOT_MASK  = 0x00F0,
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
            const A = fx16(view.getInt16(idx + 0x00, true));
            const B = fx16(view.getInt16(idx + 0x02, true));
            const C = (flags & NodeFlags.SIGN_REVC) ? -B : B;
            const D = (flags & NodeFlags.SIGN_REVD) ? -A : A;
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

export function calcTexMtx_Maya(dst: mat2d, texScaleS: number, texScaleT: number, scaleS: number, scaleT: number, sinR: number, cosR: number, translationS: number, translationT: number): void {
    dst[0] = texScaleS * scaleS *  cosR;
    dst[1] = texScaleS * scaleS * -sinR;
    dst[2] = texScaleT * scaleT *  sinR;
    dst[3] = texScaleT * scaleT *  cosR;
    // TODO(jstpierre): Bring back rotation.
    dst[4] = (scaleS * translationS) * -1;
    dst[5] = (scaleT * translationT);

    /*
    dst[4] = (-sinR*scaleS - cosR*scaleS + scaleS)     - (scaleS * translationS);
    dst[5] = ( sinR*scaleT + cosR*scaleT + 1) + (scaleT * translationT);
    dst[5] = ( sinR*scaleT - cosR*scaleT - scaleT + 2) + (scaleT * translationT);
    */
}

function parseMaterial(buffer: ArrayBufferSlice, name: string): MDL0Material {
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
    assert(texMtxMode === 0);
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
        materials.push(parseMaterial(buffer.slice(materialSectionOffs + materialTableDict[i].value), materialTableDict[i].name));

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

    return { name, nodes, materials, shapes, sbcBuffer, posScale };
}

export function parse(buffer: ArrayBufferSlice): BMD0 {
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
