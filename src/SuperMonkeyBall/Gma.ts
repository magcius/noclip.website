// Parses Amusement Vision GMA Format (GeoMetry Archive) files
// (or is it "Gamecube Model Archive"?)
//
// References (some may be largely incomplete/outdated):
// https://gitlab.com/RaphaelTetreault/fzgx_documentation/-/blob/master/asset/GMA%20Structure.md
// https://craftedcart.github.io/SMBLevelWorkshop/documentation/index.html?page=gmaFormat
// https://github.com/camthesaxman/smb-decomp/
//
// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color, colorNewFromRGBA } from "../Color";
import * as GX from "../gx/gx_enum";
import { TextureInputGX } from "../gx/gx_texture";
import { assert, assertExists, hexzero, readString } from "../util";
import { AVTpl } from "./AVTpl";

export const enum MaterialFlags {
    Unlit = 1 << 0,
    DoubleSided = 1 << 1, // Draw front and back sides of tris/quads
    NoFog = 1 << 2,
    Unk3 = 1 << 3,
    CustomBlendSrc = 1 << 5,
    CustomBlendDest = 1 << 6,
    SimpleMaterial = 1 << 7, // Only 1 tev stage that spits out color/alpha input
    VertColors = 1 << 8, // Set at runtime based on vtx attrs?
}

export const enum DlistFlags {
    HasDlist0 = 1 << 0, // Display list 0 present, cull front faces by default
    HasDlist1 = 1 << 1, // Display list 1 present, cull back faces by default
    // Extra display lists (always both present or neither?)
    HasDlist2 = 1 << 2, // Display list 2 present, cull front faces
    HasDlist3 = 1 << 3, // Display list 3 present, cull back faces
}

// GCMF Material
export type Material = {
    flags: MaterialFlags;
    colors: Color[];
    transparents: number[];
    tevLayerCount: number;
    dlistFlags: DlistFlags;
    tevLayerIdxs: number[]; // Shape materials can reference at most three tev layers stored in model
    vtxAttrs: GX.Attr;
    unk0x14: number; // sort index?? shader index?
    unk0x15: number;
};

// GCMF VertexControlHeader
type VertexControl = {
    count: number;
    vtxCon1: VtxConType1;
    vtxCon2: VtxConType2;
    vtxCon3: VtxConType3;
    vtxCon4: VtxConType4;
};

type VtxConType1 = {
    position: vec3;
    normal: vec3;
    unk0x1C: number;
};

type VtxConType2 = {
    buffer: ArrayBuffer;
};

type VtxConType3 = {
    count: number;
    offs: number[];
};

type VtxConType4 = {
    offs: number[];
};

export type Shape = {
    material: Material;
    origin: vec3; // Reference point for depth sorting
    dlistHeaders: ExtraDlists[];
    rawData: ArrayBufferSlice; // TODO(complexplane): Store individual dlist bufs instead
};

// GCMF DisplaylistHeader
export type ExtraDlists = {
    mtxIdxs: number[];
    dlistSizes: number[];
    submeshEndOffs: number;
};

export const enum TevLayerFlags {
    // A TEV layer is one of five types. If none of the "TYPE" flags are set it's the first type:
    // standard diffuse lighting (light * texture dotted with normals etc.)

    // "Specular" light layer pointing in view direction?
    // Used in Water and Master at least
    TypeViewSpecular = 1 << 0,

    Type3 = 1 << 1, // Unused/ignored?

    // Bits 2-3 for S wrap mode
    // Bits 4-5 for T wrap mode
    DoEdgeLod = 1 << 6,
    // Bits 7-10 for max LOD
    MagfiltNear = 1 << 11,

    // Alpha blend layer. Passes color through unchanged, multiplies alpha by lookup from alpha
    // texture
    TypeAlphaBlend = 1 << 13,

    // "Specular" light layer pointing in fixed direction?
    // Used for specular highlight on party ball and monkey ball
    TypeWorldSpecular = 1 << 15,

    Unk16 = 1 << 16,
}

export type TevLayer = {
    flags: TevLayerFlags;
    gxTexture: TextureInputGX;
    lodBias: number;
    maxAniso: number;
    unk0x0C: number; // TEV?
    samplerIdx: number; // Index of this sampler in gcmf's list
    unk0x10: number; // TEV
    alphaType: number;
    colorType: number;
    // Texture can be swapped at runtime, used for F-Zero GX lap-related textures apparently
    swappable: boolean;
};

export const enum ModelFlags {
    // Uses VAT with compressed 16-bit vert pos/norm/texcoord instead of floats
    Vat16Bit = 0x01,
    // Skinned meshes with one bone per vertex (what GX hardware supports). Uses tristrips
    Stitching = 0x04,
    // Linear blend skin meshes (>=1 bone per vertex) to be computed on CPU? Uses indexed meshes
    Skin = 0x08,
    // Meshes where each vertex is explicitly positioned by CPU each frame?  Uses indexed meshes
    Effective = 0x10,
}

export type Model = {
    name: string;
    flags: ModelFlags;
    boundSphereCenter: vec3;
    boundSphereRadius: number;
    opaqueShapeCount: number;
    translucentShapeCount: number;
    matrices: mat4[];
    samplers: TevLayer[];
    shapes: Shape[];
};

export type Gma = Map<string, Model>;

function parseSampler(buffer: ArrayBufferSlice, tpl: AVTpl): TevLayer {
    const view = buffer.createDataView();
    const flags = view.getUint32(0x00);
    const texIdx = view.getInt16(0x04);
    const lodBias = view.getInt8(0x06);
    const anisotropy = view.getInt8(0x07);
    const unk0x0C = view.getInt8(0x0c);
    const swappable = !!view.getUint8(0x0d);
    const samplerIdx = view.getInt16(0x0e);
    const unk0x10 = view.getInt32(0x10);
    const type = view.getUint8(0x13);
    const alphaType = (type >> 4) & 0x07;
    const colorType = type & 0x0f;

    return {
        flags,
        gxTexture: assertExists(tpl.get(texIdx)),
        lodBias,
        maxAniso: anisotropy,
        unk0x0C,
        samplerIdx,
        unk0x10,
        alphaType,
        colorType,
        swappable,
    };
}

function parseMatrix(buffer: ArrayBufferSlice): mat4 {
    const view = buffer.createDataView();

    const m00 = view.getFloat32(0x00);
    const m01 = view.getFloat32(0x04);
    const m02 = view.getFloat32(0x08);
    const m03 = view.getFloat32(0x0c);
    const m10 = view.getFloat32(0x10);
    const m11 = view.getFloat32(0x14);
    const m12 = view.getFloat32(0x18);
    const m13 = view.getFloat32(0x1c);
    const m20 = view.getFloat32(0x20);
    const m21 = view.getFloat32(0x24);
    const m22 = view.getFloat32(0x28);
    const m23 = view.getFloat32(0x2c);
    // prettier-ignore
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
    const colors: Color[] = [];
    const transparents: number[] = [];
    const tevLayerIdxs: number[] = [];

    colors.push(
        colorNewFromRGBA(
            view.getUint8(0x04),
            view.getUint8(0x05),
            view.getUint8(0x06),
            view.getUint8(0x07)
        )
    );
    colors.push(
        colorNewFromRGBA(
            view.getUint8(0x08),
            view.getUint8(0x09),
            view.getUint8(0x0a),
            view.getUint8(0x0b)
        )
    );
    colors.push(
        colorNewFromRGBA(
            view.getUint8(0x0c),
            view.getUint8(0x0d),
            view.getUint8(0x0e),
            view.getUint8(0x0f)
        )
    );
    for (let i = 0; i < 3; i++) {
        transparents[i] = view.getUint8(0x10 + i);
    }
    const tevLayerCount = view.getUint8(0x12);
    const dlistFlags: DlistFlags = view.getUint8(0x13);
    const unk0x14 = view.getUint8(0x14);
    const unk0x15 = view.getUint8(0x15);
    for (let i = 0; i < 3; i++) {
        let offs = 0x16 + i * 0x02;
        tevLayerIdxs[i] = view.getInt16(offs);
    }
    const vtxAttrs = view.getUint32(0x1c);

    let flags = view.getUint32(0x00);
    if (vtxAttrs & (1 << GX.Attr.CLR0)) {
        flags |= MaterialFlags.VertColors;
    }
    if (tevLayerCount === 0) {
        flags |= MaterialFlags.SimpleMaterial;
    }

    return {
        flags,
        colors,
        transparents,
        tevLayerCount,
        unk0x14,
        unk0x15,
        dlistFlags,
        tevLayerIdxs,
        vtxAttrs,
    };
}

function parseExShape(buffer: ArrayBufferSlice): ExtraDlists {
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

function parseShape(buffer: ArrayBufferSlice, idx: number): Shape {
    const view = buffer.createDataView();

    let mtxIdxs: number[] = [];
    const boundSphereCenter = vec3.create();
    let dlistSizes: number[] = [];
    const dlistHeaders: ExtraDlists[] = [];

    const material = parseMaterial(buffer.slice(0x00, 0x60), idx);
    for (let i = 0; i < 8; i++) {
        let mtxIdx = view.getInt8(0x20 + i);
        mtxIdxs.push(mtxIdx);
    }
    for (let i = 0; i < 2; i++) {
        let dlistSize = view.getInt32(0x28 + 0x04 * i);
        dlistSizes.push(dlistSize);
    }
    vec3.set(
        boundSphereCenter,
        view.getFloat32(0x30),
        view.getFloat32(0x34),
        view.getFloat32(0x38)
    );
    const submeshEndOffs = view.byteOffset + 0x60;
    dlistHeaders.push({ mtxIdxs, dlistSizes, submeshEndOffs });
    // TODO(complexplane): Parse individual dlist buffers

    // TODO(complexplane): These conditionals look wrong, fix/verify them
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

    return { material, origin: boundSphereCenter, dlistHeaders, rawData: buffer };
}

function parseModel(buffer: ArrayBufferSlice, name: string, tpl: AVTpl): Model {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === "GCMF");
    const samplers: TevLayer[] = [];
    const matrices: mat4[] = [];
    const shapes: Shape[] = [];
    const boundSphereCenter = vec3.create();

    const modelFlags = view.getUint32(0x04) as ModelFlags;
    let useVtxCon = modelFlags & (ModelFlags.Skin | ModelFlags.Effective);
    vec3.set(boundSphereCenter, view.getFloat32(0x08), view.getFloat32(0x0c), view.getFloat32(0x10));
    const boundSphereRadius = view.getFloat32(0x14);

    const samplerCount = view.getInt16(0x18);
    const opaqueShapeCount = view.getInt16(0x1a);
    const translucentShapeCount = view.getInt16(0x1c);
    const mtxCount = view.getInt8(0x1e);
    // Texture and Matrix Size
    const texMtxSize = view.getInt32(0x20);

    let allMaterialCount = opaqueShapeCount + translucentShapeCount;
    let offs = 0x40;
    // GcmfSampler
    for (let i = 0; i < samplerCount; i++) {
        samplers.push(parseSampler(buffer.slice(offs), tpl));
        offs += 0x20;
    }

    // GcnfMatrix
    for (let i = 0; i < mtxCount; i++) {
        matrices.push(parseMatrix(buffer.slice(offs)));
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
        vtxCon3Offs = view.getInt32(texMtxSize + 0x0c);
        vtxCon4Offs = view.getInt32(texMtxSize + 0x10);

        // let vtxCon: GcmfVertexControl;
    }

    let shapeOffs = useVtxCon ? 0x20 : 0x00;
    let shapeBuff = buffer.slice(texMtxSize);
    // GcmfShape
    for (let i = 0; i < allMaterialCount; i++) {
        let vtxAttr = view.getUint32(texMtxSize + shapeOffs + 0x1c);
        if ((vtxAttr & (1 << GX.Attr._NBT)) !== 0) {
            // NBT unsupported
            continue;
        }
        const shape = parseShape(shapeBuff.slice(shapeOffs), i);
        if (shape.material.tevLayerIdxs[0] < 0) {
            // TODO(complexplane): Support 0 sampler shapes
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

    return {
        name,
        flags: modelFlags,
        boundSphereCenter,
        boundSphereRadius,
        opaqueShapeCount,
        translucentShapeCount,
        matrices,
        samplers,
        shapes,
    };
}

type ModelEntryOffset = {
    gcmfOffs: number;
    nameOffs: number;
};

export function parseGma(gmaBuffer: ArrayBufferSlice, tpl: AVTpl): Gma {
    const view = gmaBuffer.createDataView();
    const count = view.getInt32(0x00);
    const gcmfEntryOffs: ModelEntryOffset[] = [];

    const gcmfBaseOffs = view.getUint32(0x04);

    // Gcmf Entry Offset
    const entry = gmaBuffer.slice(0x08);
    const entryView = entry.createDataView();
    let offs = 0x00;
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
        let notSupport =
            (attr & (1 << 3)) !== 0 || (attr & (1 << 4)) !== 0 || (attr & (1 << 5)) !== 0;
        if (notSupport) {
            // ignore "Stiching Model", "Skin Model" and "Effective Model".
            // TODO: Support those model.
            console.log(`not support this model ${hexzero(gcmfBaseOffs + modelOffs, 8)}`);
            console.log(
                `Stiching Model:${(attr & (1 << 3)) !== 0} Skin Model:${
                    (attr & (1 << 4)) !== 0
                } Effective Model:${(attr & (1 << 5)) !== 0}`
            );
            continue;
        }
        const model = parseModel(modelBuf.slice(modelOffs), name, tpl);
        if (model.opaqueShapeCount + model.translucentShapeCount < 1) {
            // ignore invaild gcmf
            continue;
        }

        models.set(name, model);
    }

    return models;
}
