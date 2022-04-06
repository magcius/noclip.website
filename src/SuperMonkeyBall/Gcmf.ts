/*
 * Parses Amusement Vision GMA Format (GeoMetry Archive) files.
 * (or is it "Gamecube Model Archive"?)
 * https://craftedcart.github.io/SMBLevelWorkshop/documentation/index.html?page=gmaFormat
 * https://gitlab.com/RaphaelTetreault/fzgx_documentation/-/blob/master/asset/GMA%20Structure.md
 * AmusementVision's Texture format
 * 
 * Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)
 */

import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color, colorNewFromRGBA } from "../Color";
import { compileVtxLoaderMultiVat, getAttributeByteSize, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, VtxLoader } from "../gx/gx_displaylist";
import * as GX from "../gx/gx_enum";
import { assert, hexzero, readString } from "../util";

// GCMF Attribute
export type ModelAttrs = {
    value16Bit: boolean, // Vertices stored using 16-bit compressed floats (VTXFMT1)
    unk0x2: boolean, // Might not exist
    stitching: boolean,
    skin: boolean, // Skinned model with up to 8 bones
    effective: boolean // Physics-driven vertices
};

// GCMF Material
export type Material = {
    unk0x02: number,
    unk0x03: number,
    colors: Color[]
    translucents: number[],
    matCount: number,
    vtxRenderFlag: GX.AttrType,
    samplerIdxs: number[], // GMA can store max 3 sampler index
    vtxAttr: GX.Attr,
    unk0x14: number, // sort index?? shader index?
    unk0x15: number,
    unk0x40: number // relates "TEV"
};

// GCMF VertexControlHeader
type VertexControl = {
    count: number;
    vtxCon1: VtxConType1,
    vtxCon2: VtxConType2,
    vtxCon3: VtxConType3,
    vtxCon4: VtxConType4
};

type VtxConType1 = {
    position: vec3,
    normal: vec3,
    unk0x1C: number
};

type VtxConType2 = {
    buffer: ArrayBuffer
};

type VtxConType3 = {
    count: number,
    offs: number[]
};

type VtxConType4 = {
    offs: number[]
}

// GCMF Submesh
// todo(complexplane): GPU data probably belongs in ShapeInstance or similar
export type Shape = {
    material: Material,
    boundingSphere: vec3,
    dlistHeaders: GcmfDisplaylistHeader[],
    rawData: ArrayBufferSlice,  // todo(complexplane): Store individual dlist bufs instead
};

// GCMF DisplaylistHeader
export type GcmfDisplaylistHeader = {
    mtxIdxs: number[],
    dlistSizes: number[],
    submeshEndOffs: number
};

// GCMF Sampler
export type Sampler = {
    unk0x00: number,
    mipmapAV: number,
    uvWrap: number,
    texIdx: number, // Index of texture in TPL
    lodBias: number,
    anisotropy: number,
    unk0x0C: number, // TEV?
    samplerIdx: number, // Index of this sampler in gcmf's list
    unk0x10: number // TEV
    alphaType: number,
    colorType: number
    // Texture can be swapped at runtime, used for F-Zero GX lap-related textures apparently
    swappable: boolean,
};

export type Model = {
    attrs: ModelAttrs,
    origin: vec3,
    boundingRadius: number,
    texCount: number,
    materialCount: number,
    traslucidMaterialCount: number,
    mtxCount: number,
    matrixs: mat4[],
    samplers: Sampler[],
    shapes: Shape[]
}

export type Gma = Map<string, Model>;

function parseSampler(buffer: ArrayBufferSlice): Sampler {
    const view = buffer.createDataView();

    const unk0x00 = view.getInt16(0x00);
    const mipmapAV = view.getInt8(0x02);
    const uvWrap = view.getInt8(0x03);
    const texIdx = view.getInt16(0x04);
    const lodBias = view.getInt8(0x06);
    const anisotropy = view.getInt8(0x07);
    const unk0x0C = view.getInt8(0x0C);
    const swappable = !!view.getUint8(0x0D);
    const samplerIdx = view.getInt16(0x0E);
    const unk0x10 = view.getInt32(0x10);
    const type = view.getUint8(0x13);
    const alphaType = (type >> 4) & 0x07;
    const colorType = type & 0x0F;

    return { unk0x00, mipmapAV, uvWrap, texIdx, lodBias, anisotropy, unk0x0C, samplerIdx, unk0x10, alphaType, colorType, swappable };
}

function parseMatrix(buffer: ArrayBufferSlice): mat4 {
    const view = buffer.createDataView();

    const m00 = view.getFloat32(0x00);
    const m01 = view.getFloat32(0x04);
    const m02 = view.getFloat32(0x08);
    const m03 = view.getFloat32(0x0C);
    const m10 = view.getFloat32(0x10);
    const m11 = view.getFloat32(0x14);
    const m12 = view.getFloat32(0x18);
    const m13 = view.getFloat32(0x1C);
    const m20 = view.getFloat32(0x20);
    const m21 = view.getFloat32(0x24);
    const m22 = view.getFloat32(0x28);
    const m23 = view.getFloat32(0x2C);
    const matrix = mat4.fromValues(
        m00, m10, m20, 0,
        m01, m11, m21, 0,
        m02, m12, m22, 0,
        m03, m13, m23, 1,
    );

    return matrix;
}

function parseMaterial(buffer: ArrayBufferSlice, idx: number): Material {
    const view = buffer.createDataView();
    const colors: Color[] = []
    const translucents: number[] = [];
    const samplerIdxs: number[] = [];

    const unk0x02 = view.getUint8(0x02);
    const unk0x03 = view.getUint8(0x03);
    colors.push(colorNewFromRGBA(view.getUint8(0x04), view.getUint8(0x05), view.getUint8(0x06), view.getUint8(0x07)));
    colors.push(colorNewFromRGBA(view.getUint8(0x08), view.getUint8(0x09), view.getUint8(0x0A), view.getUint8(0x0B)));
    colors.push(colorNewFromRGBA(view.getUint8(0x0C), view.getUint8(0x0D), view.getUint8(0x0E), view.getUint8(0x0F)));
    for (let i = 0; i < 3; i++) {
        translucents[i] = view.getUint8(0x10 + i);
    }
    const matCount = view.getUint8(0x12);
    const vtxRenderFlag: GX.AttrType = view.getUint8(0x13);
    const unk0x14 = view.getUint8(0x14);
    const unk0x15 = view.getUint8(0x15);
    for (let i = 0; i < 3; i++) {
        let offs = 0x16 + i * 0x02;
        samplerIdxs[i] = view.getInt16(offs);
    }
    const unk0x3C = view.getInt32(0x3C);
    const unk0x40 = view.getInt32(0x40);

    const vtxAttr: GX.Attr = view.getUint32(0x1C);

    return { unk0x02, unk0x03, colors, translucents, matCount, unk0x14, unk0x15, vtxRenderFlag, samplerIdxs, vtxAttr, unk0x40 };
}

function parseExShape(buffer: ArrayBufferSlice): GcmfDisplaylistHeader {
    const view = buffer.createDataView();
    const mtxIdxs = [];
    const dlistSizes = [];
    let offs = 0x00;
    for (let i = 0; i < 8; i++) {
        let mtxIdx = view.getUint32(offs);
        mtxIdxs.push(mtxIdx);
        offs += 0x01 * i;
    }
    for (let i = 0; i < 2; i++) {
        let dlistSize = view.getUint32(offs);
        dlistSizes.push(dlistSize);
        offs += 0x04 * i;
    }
    const submesh_end_offs = view.byteOffset + 0x20;

    return { mtxIdxs, dlistSizes, submeshEndOffs: submesh_end_offs };
}

function parseShape(buffer: ArrayBufferSlice, attribute: ModelAttrs, idx: number, vtxCon2Offs: number): Shape {
    const view = buffer.createDataView();

    let mtxIdxs: number[] = [];
    const boundingSphere = vec3.create();
    let dlistSizes: number[] = [];
    const loadedVertexDatas: LoadedVertexData[] = [];
    const dlistHeaders: GcmfDisplaylistHeader[] = [];

    const material = parseMaterial(buffer.slice(0x00, 0x60), idx);
    for (let i = 0; i < 8; i++) {
        let mtxIdx = view.getInt8(0x20 + i);
        mtxIdxs.push(mtxIdx);
    }
    for (let i = 0; i < 2; i++) {
        let dlistSize = view.getInt32(0x28 + 0x04 * i);
        dlistSizes.push(dlistSize);
    }
    vec3.set(boundingSphere, view.getFloat32(0x30), view.getFloat32(0x34), view.getFloat32(0x38));
    const submesh_end_offs = view.byteOffset + 0x60;
    dlistHeaders.push({ mtxIdxs, dlistSizes, submeshEndOffs: submesh_end_offs })
    // todo(complexplane): Parse individual dlist buffers

    // todo(complexplane): These conditionals look wrong, fix/verify them
    // let vtxRenderFlag = material.vtxRenderFlag;
    // if (vtxRenderFlag & 1 >> 2 || vtxRenderFlag & 1 >> 3) {
    //     //Exsit Extra DisplayList
    //     console.log(`Decetct Extra DisplayList`);
    //     let offs = 0x60;
    //     for (let i = 0; i < 2; i++) {
    //         offs += dlistHeaders[0].dlistSizes[i];
    //     }
    //     let dlistHeader = parseExShape(buffer.slice(offs, offs + 0x20));
    //     dlistHeaders.push(dlistHeader);
    // }

    return { material, boundingSphere, dlistHeaders, rawData: buffer };
}

function parseModel(buffer: ArrayBufferSlice): Model {
    function parseModelAttrs(attrs: number): ModelAttrs {
        const value16Bit = ((attrs >> 0) & 0x01) == 1;
        const unk0x2 = ((attrs >> 1) & 0x01) == 1;
        const stitching = ((attrs >> 2) & 0x01) == 1;
        const skin = ((attrs >> 3) & 0x01) == 1;
        const effective = ((attrs >> 4) & 0x01) == 1;

        return { value16Bit, unk0x2, skin, stitching, effective };
    }
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === "GCMF");
    const samplers: Sampler[] = [];
    const matrixs: mat4[] = [];
    const shapes: Shape[] = [];
    const origin = vec3.create();

    const attribute = parseModelAttrs(view.getUint32(0x04));
    let useVtxCon = (attribute.skin || attribute.effective);
    vec3.set(origin, view.getFloat32(0x08), view.getFloat32(0x0C), view.getFloat32(0x10));
    const boundingRadius = view.getFloat32(0x14);

    const texCount = view.getInt16(0x18);
    // todo(complexplane): Are these actually opaque/translucent meshes/shapes, not materials?
    const opaqueMaterialCount = view.getInt16(0x1A);
    const translucentMaterialCount = view.getInt16(0x1C);
    const mtxCount = view.getInt8(0x1E);
    // Texture and Matrix Size
    const texMtxSize = view.getInt32(0x20);

    let allMaterialCount = opaqueMaterialCount + translucentMaterialCount;
    let offs = 0x40
    // GcmfSampler
    for (let i = 0; i < texCount; i++) {
        samplers.push(parseSampler(buffer.slice(offs)));
        offs += 0x20;
    }

    // GcnfMatrix
    for (let i = 0; i < mtxCount; i++) {
        matrixs.push(parseMatrix(buffer.slice(offs)));
        offs += 0x30;
    }

    // GcmfVertexControl
    let vtxConCount = 0x00;
    let vtxCon1Offs = 0x00;
    let vtxCon2Offs = 0x00;
    let vtxCon3Offs = 0x00;
    let vtxCon4Offs = 0x00;
    if (useVtxCon) {
        vtxConCount = view.getInt32(texMtxSize + 0x00);
        vtxCon1Offs = view.getInt32(texMtxSize + 0x04);
        vtxCon2Offs = view.getInt32(texMtxSize + 0x08);
        vtxCon3Offs = view.getInt32(texMtxSize + 0x0C);
        vtxCon4Offs = view.getInt32(texMtxSize + 0x10);

        // let vtxCon: GcmfVertexControl;
    }

    let shapeOffs = (useVtxCon ? 0x20 : 0x00);
    let shapeBuff = buffer.slice(texMtxSize);
    // GcmfShape
    for (let i = 0; i < allMaterialCount; i++) {
        let vtxAttr = view.getUint32(texMtxSize + shapeOffs + 0x1C);
        if ((vtxAttr & (1 << GX.Attr._NBT)) !== 0) {
            console.log("Not support NBT");
            continue;
        }
        const shape = parseShape(shapeBuff.slice(shapeOffs), attribute, i, vtxCon2Offs);
        if (shape.material.samplerIdxs[0] < 0) {
            console.log("GCMF shape has zero samplers, ignoring shape");
            continue;
        }
        shapes.push(shape);
        let offs = 0x60;
        let dlistHeader = shape.dlistHeaders[shape.dlistHeaders.length - 1];
        for (let j = 0; j < 2; j++) {
            offs += dlistHeader.dlistSizes[j];
        }
        shapeOffs += offs;
    }

    return { attrs: attribute, origin, boundingRadius, texCount, materialCount: opaqueMaterialCount, traslucidMaterialCount: translucentMaterialCount, mtxCount, matrixs, samplers, shapes };
}

type ModelEntryOffset = {
    gcmfOffs: number,
    nameOffs: number,
};

export function parseGma(gmaBuffer: ArrayBufferSlice): Gma {
    const view = gmaBuffer.createDataView();
    const count = view.getInt32(0x00);
    const gcmfEntryOffs: ModelEntryOffset[] = [];

    const gcmfBaseOffs = view.getUint32(0x04);

    // Gcmf Entry Offset
    const entry = gmaBuffer.slice(0x08);
    const entryView = entry.createDataView();
    let offs = 0x00
    for (let i = 0; i < count; i++) {
        const gcmfOffs = entryView.getInt32(offs);
        const nameOffs = entryView.getInt32(offs + 0x04);
        gcmfEntryOffs.push({ gcmfOffs, nameOffs });
        offs += 0x08;
    }

    const models = new Map<string, Model>();
    const nameBuf = entry.slice(0x08 * count, gcmfBaseOffs);
    const modelBuf = gmaBuffer.slice(gcmfBaseOffs);
    for (let i = 0; i < gcmfEntryOffs.length; i++) {
        let nameOffs = gcmfEntryOffs[i].nameOffs;
        let modelOffs = gcmfEntryOffs[i].gcmfOffs;
        if (modelOffs < 0 && nameOffs <= 0) {
            // Ignore invalid model
            continue;
        }
        const name = readString(nameBuf, nameOffs);

        // TODO parse attribute into nicer type first
        let attr = view.getUint32(gcmfBaseOffs + modelOffs + 0x04);
        let notSupport = (attr & (1 << 3)) !== 0 || (attr & (1 << 4)) !== 0 || (attr & (1 << 5)) !== 0;
        if (notSupport) {
            // ignore "Stiching Model", "Skin Model" and "Effective Model".
            // TODO: Support those model.
            console.log(`not support this model ${hexzero(gcmfBaseOffs + modelOffs, 8)}`);
            console.log(`Stiching Model:${(attr & (1 << 3)) !== 0} Skin Model:${(attr & (1 << 4)) !== 0} Effective Model:${(attr & (1 << 5)) !== 0}`);
            continue;
        }
        const model = parseModel(modelBuf.slice(modelOffs));
        if (model.materialCount + model.traslucidMaterialCount < 1) {
            // ignore invaild gcmf
            continue;
        }

        models.set(name, model);
    }

    return models;
}
