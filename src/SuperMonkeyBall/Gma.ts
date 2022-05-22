// Parses Amusement Vision GMA Format (GeoMetry Archive) files
// (or is it "Gamecube Model Archive"?)
//
// References (some may be largely incomplete/outdated):
// https://github.com/camthesaxman/smb-decomp/
// https://gitlab.com/RaphaelTetreault/fzgx_documentation/-/blob/master/asset/GMA%20Structure.md
// https://craftedcart.github.io/SMBLevelWorkshop/documentation/index.html?page=gmaFormat
//
// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color, colorNewFromRGBA8 } from "../Color";
import * as GX from "../gx/gx_enum";
import { TextureInputGX } from "../gx/gx_texture";
import { assert, assertExists, hexzero, readString } from "../util";
import { AVTpl } from "./AVTpl";

const SHAPE_BASE_SIZE = 0x60;

export const enum MaterialFlags {
    Unlit = 1 << 0,
    DoubleSided = 1 << 1, // Draw front and back sides of tris/quads
    NoFog = 1 << 2,
    CustomMatAmbColors = 1 << 3,
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
    materialColor: Color;
    ambientColor: Color;
    specularColor: Color;
    alpha: number;
    tevLayerCount: number;
    tevLayerIdxs: number[]; // Shape materials can reference at most three tev layers stored in model
    vtxAttrs: GX.Attr;
    unk0x14: number; // sort index?? shader index?
    unk0x15: number;
    blendFactors: number;
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

export type Dlist = {
    data: ArrayBufferSlice;
    cullMode: GX.CullMode;
};

export type Shape = {
    material: Material;
    origin: vec3; // Reference point for depth sorting
    dlists: Dlist[];
    size: number; // Total size of shape in bytes
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
    // Meshes where each vertex is explicitly positioned by CPU each frame? Uses indexed meshes
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
    tevLayers: TevLayer[];
    shapes: Shape[];
};

export type Gma = {
    nameMap: Map<string, Model>;
    idMap: Map<number, Model>; // Not every ID will be filled
};

function parseTevLayer(buffer: ArrayBufferSlice, tpl: AVTpl): TevLayer {
    const view = buffer.createDataView();
    const flags = view.getUint32(0x00);
    const texIdx = view.getInt16(0x04);
    const lodBias = view.getInt8(0x06);
    const anisotropy = view.getInt8(0x07);
    const unk0x0C = view.getInt8(0x0c);
    const swappable = !!view.getUint8(0x0d);
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
    const tevLayerIdxs: number[] = [];

    const materialColor = colorNewFromRGBA8(view.getUint32(0x04));
    const ambientColor = colorNewFromRGBA8(view.getUint32(0x08));
    const specularColor = colorNewFromRGBA8(view.getUint32(0x0c));
    const alpha = view.getUint8(0x11) / 0xff;
    const tevLayerCount = view.getUint8(0x12);
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

    const blendFactors = view.getUint32(0x40);

    return {
        flags,
        materialColor,
        ambientColor,
        specularColor,
        alpha,
        tevLayerCount,
        unk0x14,
        unk0x15,
        tevLayerIdxs,
        vtxAttrs,
        blendFactors,
    };
}

// Returns parsed shape and offset of end of this parsed shape
function parseShape(buffer: ArrayBufferSlice, idx: number): Shape {
    const view = buffer.createDataView();

    const material = parseMaterial(buffer.slice(0x00, SHAPE_BASE_SIZE), idx);
    const origin = vec3.create();
    const dlistFlags: DlistFlags = view.getUint8(0x13);
    const frontCulledDlistSize = view.getInt32(0x28);
    const backCulledDlistSize = view.getInt32(0x2c);
    vec3.set(origin, view.getFloat32(0x30), view.getFloat32(0x34), view.getFloat32(0x38));

    const dlists: Dlist[] = [];
    let dlistOffs = SHAPE_BASE_SIZE;

    if (dlistFlags & DlistFlags.HasDlist0) {
        const frontCulledDlist = buffer.slice(dlistOffs, dlistOffs + frontCulledDlistSize);
        dlists.push({
            data: frontCulledDlist,
            cullMode: material.flags & MaterialFlags.DoubleSided ? GX.CullMode.NONE : GX.CullMode.FRONT,
        });
        dlistOffs += frontCulledDlistSize;
    }

    if (dlistFlags & DlistFlags.HasDlist1) {
        const backCulledDlist = buffer.slice(dlistOffs, dlistOffs + backCulledDlistSize);
        dlists.push({
            data: backCulledDlist,
            cullMode: material.flags & MaterialFlags.DoubleSided ? GX.CullMode.NONE : GX.CullMode.BACK,
        });
        dlistOffs += backCulledDlistSize;
    }

    if (dlistFlags & (DlistFlags.HasDlist2 | DlistFlags.HasDlist3)) {
        // Parse extra dlists header
        const extraFrontCulledDlistSize = view.getInt32(dlistOffs + 0x8);
        const extraBackCulledDlistSize = view.getInt32(dlistOffs + 0xc);
        dlistOffs += 0x20;

        const extraFrontCulledDlist = buffer.slice(dlistOffs, dlistOffs + extraFrontCulledDlistSize);
        dlists.push({ data: extraFrontCulledDlist, cullMode: GX.CullMode.FRONT });
        dlistOffs += extraFrontCulledDlistSize;

        const extraBackCulledDlist = buffer.slice(dlistOffs, dlistOffs + extraBackCulledDlistSize);
        dlists.push({ data: extraBackCulledDlist, cullMode: GX.CullMode.BACK });
        dlistOffs += extraBackCulledDlistSize;
    }

    return {
        material,
        origin,
        dlists,
        size: dlistOffs,
    };
}

function parseModel(buffer: ArrayBufferSlice, name: string, tpl: AVTpl): Model {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === "GCMF");
    const tevLayers: TevLayer[] = [];
    const matrices: mat4[] = [];
    const shapes: Shape[] = [];
    const boundSphereCenter = vec3.create();

    const modelFlags = view.getUint32(0x04) as ModelFlags;
    let useVtxCon = modelFlags & (ModelFlags.Skin | ModelFlags.Effective);
    vec3.set(boundSphereCenter, view.getFloat32(0x08), view.getFloat32(0x0c), view.getFloat32(0x10));
    const boundSphereRadius = view.getFloat32(0x14);

    const tevLayerCount = view.getInt16(0x18);
    const opaqueShapeCount = view.getInt16(0x1a);
    const translucentShapeCount = view.getInt16(0x1c);
    const mtxCount = view.getInt8(0x1e);
    // Texture and Matrix Size
    const texMtxSize = view.getInt32(0x20);

    let allMaterialCount = opaqueShapeCount + translucentShapeCount;
    let offs = 0x40;

    // TEV layers
    for (let i = 0; i < tevLayerCount; i++) {
        tevLayers.push(parseTevLayer(buffer.slice(offs), tpl));
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

    // Parse shapes
    for (let i = 0; i < allMaterialCount; i++) {
        const shape = parseShape(shapeBuff.slice(shapeOffs), i);
        shapeOffs += shape.size;
        if (shape.material.vtxAttrs & (1 << GX.Attr._NBT)) {
            // TODO: support this?
            continue;
        }
        shapes.push(shape);
    }

    return {
        name,
        flags: modelFlags,
        boundSphereCenter,
        boundSphereRadius,
        opaqueShapeCount,
        translucentShapeCount,
        matrices,
        tevLayers,
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

    const modelNameMap = new Map<string, Model>();
    const modelIdMap = new Map<number, Model>();
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
        const modelFlags = view.getUint32(gcmfBaseOffs + modelOffs + 0x04) as ModelFlags;
        const unsupported = modelFlags & (ModelFlags.Stitching | ModelFlags.Skin | ModelFlags.Effective);
        if (unsupported) {
            // TODO: Support these types of models
            continue;
        }
        const model = parseModel(modelBuf.slice(modelOffs), name, tpl);
        if (model.opaqueShapeCount + model.translucentShapeCount < 1) {
            // Ignore invalid zero shape models
            continue;
        }

        modelNameMap.set(name, model);
        modelIdMap.set(i, model);
    }

    return { nameMap: modelNameMap, idMap: modelIdMap };
}
