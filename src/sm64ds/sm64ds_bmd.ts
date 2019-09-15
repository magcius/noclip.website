
import { mat2d, mat4 } from 'gl-matrix';

import * as NITRO_GX from './nitro_gx';
import * as NITRO_Tex from './nitro_tex';

import { readString, assert } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxCullMode } from '../gfx/platform/GfxPlatform';
import { Endianness } from '../endian';
import { computeModelMatrixSRT } from '../MathHelpers';

// Super Mario 64 DS .bmd format

export class Material {
    public name: string;
    public isTranslucent: boolean;
    public depthWrite: boolean;
    public cullMode: GfxCullMode;
    public diffuse: NITRO_GX.Color;
    public alpha: number;
    public texCoordMat: mat2d;
    public texture: Texture | null;
    public texParams: number;
}

export interface Batch {
    materialIdx: number;
    matrixTable: Uint8Array;
    vertexData: NITRO_GX.VertexData;
}

export class Joint {
    public name: string;
    public parentJointIdx: number;
    public batches: Batch[];
    public billboard: boolean;
    public modelMatrix: mat4;
}

export const enum TexCoordMode { NONE, TEXCOORD, NORMAL, POSITION }

function parseJoint(bmd: BMD, buffer: ArrayBufferSlice, idx: number) {
    const offs = bmd.modelOffsBase + idx * 0x40;
    const view = buffer.createDataView();

    const joint = new Joint();
    const id = view.getUint32(offs + 0x00, true);
    assert(idx === id);
    joint.name = readString(buffer, view.getUint32(offs + 0x04, true), 0xFF);
    const parentJointRel = view.getInt16(offs + 0x08, true);

    if (parentJointRel < 0)
        joint.parentJointIdx = idx + parentJointRel;
    else
        joint.parentJointIdx = -1;

    // Local transform.
    const scaleX = view.getInt32(offs + 0x10, true) / 0x1000;
    const scaleY = view.getInt32(offs + 0x14, true) / 0x1000;
    const scaleZ = view.getInt32(offs + 0x18, true) / 0x1000;
    const rotationX = view.getInt16(offs + 0x1C, true) / 0x0800 * Math.PI;
    const rotationY = view.getInt16(offs + 0x1E, true) / 0x0800 * Math.PI;
    const rotationZ = view.getInt16(offs + 0x20, true) / 0x0800 * Math.PI;
    const translationX = view.getInt16(offs + 0x24, true) / 0x1000;
    const translationY = view.getInt16(offs + 0x28, true) / 0x1000;
    const translationZ = view.getInt16(offs + 0x2C, true) / 0x1000;

    joint.modelMatrix = mat4.create();
    computeModelMatrixSRT(joint.modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

    // A "batch" is a combination of a material and a poly.
    const batchCount = view.getUint32(offs + 0x30, true);
    const batchMaterialOffs = view.getUint32(offs + 0x34, true);
    const batchPolyOffs = view.getUint32(offs + 0x38, true);

    const flags = view.getUint32(offs + 0x3C, true);
    joint.billboard = !!(flags & 0x01);

    joint.batches = [];

    // Batches should only be in root joints.
    // if (batchCount !== 0)
    //     assert(joint.parentJointIdx === -1);

    for (let i = 0; i < batchCount; i++) {
        const materialIdx = view.getUint8(batchMaterialOffs + i);
        const material = bmd.materials[materialIdx];
        const baseCtx = { color: material.diffuse, alpha: material.alpha };

        const polyIdx = view.getUint8(batchPolyOffs + i);
        const polyOffs = view.getUint32((bmd.polyOffsBase + polyIdx * 0x08) + 0x04, true);

        const matrixTableCount = view.getUint32(polyOffs + 0x00, true);
        const matrixTableOffs = view.getUint32(polyOffs + 0x04, true);
        const matrixTable = buffer.createTypedArray(Uint8Array, matrixTableOffs, matrixTableCount);

        const gxCmdSize = view.getUint32(polyOffs + 0x08, true);
        const gxCmdOffs = view.getUint32(polyOffs + 0x0C, true);

        const gxCmdBuf = buffer.slice(gxCmdOffs, gxCmdOffs + gxCmdSize);

        const vertexData = NITRO_GX.readCmds(gxCmdBuf, baseCtx, bmd.scaleFactor);

        joint.batches.push({ materialIdx, matrixTable, vertexData });
    }

    return joint;
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

function parseMaterial(bmd: BMD, buffer: ArrayBufferSlice, idx: number): Material {
    const view = buffer.createDataView();
    const offs = bmd.materialOffsBase + idx * 0x30;

    const material = new Material();
    material.name = readString(buffer, view.getUint32(offs + 0x00, true), 0xFF);
    material.texCoordMat = mat2d.create();

    const textureIdx = view.getUint32(offs + 0x04, true);
    if (textureIdx !== 0xFFFFFFFF) {
        const paletteIdx = view.getUint32(offs + 0x08, true);
        const textureKey = new TextureKey(textureIdx, paletteIdx);
        material.texture = parseTexture(bmd, buffer, textureKey);
        material.texParams = material.texture.params | view.getUint32(offs + 0x20, true);

        const scaleS = view.getInt32(offs + 0x0C, true) / 4096.0;
        const scaleT = view.getInt32(offs + 0x10, true) / 4096.0;
        // 0x14 = rotation maybe?
        const transS = view.getInt32(offs + 0x18, true) / 4096.0;
        const transT = view.getInt32(offs + 0x1C, true) / 4096.0;
        const texScaleS = 1 / material.texture.width;
        const texScaleT = 1 / material.texture.height;

        mat2d.set(material.texCoordMat,
            scaleS * texScaleS, 0.0,
            0.0, scaleT * texScaleT,
            transS * texScaleS,
            transT * texScaleT,
        );
    } else {
        material.texture = null;
        material.texParams = 0;
    }

    const polyAttribs = view.getUint32(offs + 0x24, true);

    const renderWhichFaces = (polyAttribs >> 6) & 0x03;
    material.cullMode = translateCullMode(renderWhichFaces);

    material.alpha = expand5to8((polyAttribs >> 16) & 0x1F);

    // NITRO's Rendering Engine uses two passes. Opaque, then Transparent.
    // A transparent polygon is one that has an alpha of < 0xFF, or uses
    // A5I3 / A3I5 textures.

    material.isTranslucent = (material.alpha < 0xFF) || !!(material.texture && material.texture.isTranslucent);

    // Do transparent polys write to the depth buffer?
    const xl = (polyAttribs >>> 11) & 0x01;
    if (xl)
        material.depthWrite = true;
    else
        material.depthWrite = !material.isTranslucent;

    const difAmb = view.getUint32(offs + 0x28, true);
    if (difAmb & 0x8000)
        material.diffuse = NITRO_GX.bgr5(difAmb);
    else
        material.diffuse = { r: 0xFF, g: 0xFF, b: 0xFF };

    return material;
}

class TextureKey {
    public texIdx: number;
    public palIdx: number;

    constructor(texIdx: number, palIdx: number) {
        this.texIdx = texIdx;
        this.palIdx = palIdx;
    }

    public toString() {
        return `TextureKey ${this.texIdx} ${this.palIdx}`;
    }
}

export class Texture {
    public id: number;
    public name: string;

    public params: number;
    public format: NITRO_Tex.Format;
    public width: number;
    public height: number;

    public paletteName: string;
    public pixels: Uint8Array;
    public isTranslucent: boolean;
}

function parseTexture(bmd: BMD, buffer: ArrayBufferSlice, key: TextureKey): Texture {
    if (bmd.textureCache.has(key.toString()))
        return bmd.textureCache.get(key.toString())!;

    const view = buffer.createDataView();
    const texOffs = bmd.textureOffsBase + key.texIdx * 0x14;

    const texture = new Texture();
    texture.id = key.texIdx;
    texture.name = readString(buffer, view.getUint32(texOffs + 0x00, true), 0xFF);

    const texDataOffs = view.getUint32(texOffs + 0x04, true);
    const texDataSize = view.getUint32(texOffs + 0x08, true);
    const texData = buffer.slice(texDataOffs);

    texture.params = view.getUint32(texOffs + 0x10, true);
    const texImageParams = NITRO_Tex.parseTexImageParam(texture.params);
    texture.format = texImageParams.format;
    texture.width = texImageParams.width;
    texture.height = texImageParams.height;
    const color0 = texImageParams.color0;

    let palData: ArrayBufferSlice | null = null;
    if (key.palIdx !== 0xFFFFFFFF) {
        const palOffs = bmd.paletteOffsBase + key.palIdx * 0x10;
        texture.paletteName = readString(buffer, view.getUint32(palOffs + 0x00, true), 0xFF);
        const palDataOffs = view.getUint32(palOffs + 0x04, true);
        const palDataSize = view.getUint32(palOffs + 0x08, true);
        palData = buffer.slice(palDataOffs, palDataOffs + palDataSize);
    }

    let palIdxData: ArrayBufferSlice | null = null;
    if (texture.format === NITRO_Tex.Format.Tex_CMPR_4x4) {
        palIdxData = texData.slice((texture.width * texture.height) / 4);
    }

    const inTexture = {
        format: texture.format, width: texture.width, height: texture.height,
        texData, palData, palIdxData, color0,
    };
    texture.pixels = NITRO_Tex.readTexture(inTexture as NITRO_Tex.Texture);

    texture.isTranslucent = NITRO_Tex.textureFormatIsTranslucent(texture.format);

    bmd.textures.push(texture);
    bmd.textureCache.set(key.toString(), texture);

    return texture;
}

export class BMD {
    public scaleFactor: number;
    public materials: Material[];
    public joints: Joint[];
    public matrixToJointTable: Uint16Array;
    public textures: Texture[];
    public textureCache: Map<string, Texture>;

    public modelOffsBase: number;
    public polyOffsBase: number;
    public textureOffsBase: number;
    public paletteOffsBase: number;
    public materialOffsBase: number;
}

export function parse(buffer: ArrayBufferSlice): BMD {
    const view = buffer.createDataView();

    const bmd = new BMD();

    bmd.scaleFactor = (1 << view.getUint32(0x00, true));

    const jointCount = view.getUint32(0x04, true);
    bmd.modelOffsBase = view.getUint32(0x08, true);
    const polyCount = view.getUint32(0x0C, true);
    bmd.polyOffsBase = view.getUint32(0x10, true);
    const textureCount = view.getUint32(0x14, true);
    bmd.textureOffsBase = view.getUint32(0x18, true);
    const paletteCount = view.getUint32(0x1C, true);
    bmd.paletteOffsBase = view.getUint32(0x20, true);
    const materialCount = view.getUint32(0x24, true);
    bmd.materialOffsBase = view.getUint32(0x28, true);
    const matrixToJointTableOffs = view.getUint32(0x2C, true);
    bmd.matrixToJointTable = buffer.createTypedArray(Uint16Array, matrixToJointTableOffs, jointCount, Endianness.LITTLE_ENDIAN);

    bmd.textureCache = new Map<string, Texture>();
    bmd.textures = [];
    bmd.materials = [];
    bmd.joints = [];

    for (let i = 0; i < materialCount; i++)
        bmd.materials.push(parseMaterial(bmd, buffer, i));

    for (let i = 0; i < jointCount; i++)
        bmd.joints.push(parseJoint(bmd, buffer, i));

    return bmd;
}
