
// Parser for Granny2 (.gr2) files, used by Ragnarok Online for a handful of 3D
// monsters (WOE guardians, the Emperium, guild flags, treasure boxes) plus the
// separate skeletal-animation files in 3dmob_bone/.
//
// Granny is a proprietary RAD format, but the on-disk container is well
// documented by the community (Blender/noesis importers, the open opengr2/
// liboodle reverse-engineering work). We parse it directly — no SDK, no native
// runtime. A .gr2 is, in order:
//
//   [magic+header (32 B)] [file info (56 B, the GrannyFileHeader)]
//   [section table (sectorCount * 44 B)] [per-section data + fixup/marshal tables]
//
// Each section may be stored uncompressed or compressed with one of Granny's
// codecs. After copying/decompressing every section into one contiguous blob, a
// pointer-fixup table rewrites stored pointers to point at the right place in
// the blob; we model that as a map from an absolute source offset (in the blob)
// to an absolute destination offset. Then a self-describing TYPE TREE is walked
// in lockstep with the ROOT data to pull out typed members (the mesh's
// vertices/normals/UVs/indices, the skeleton's bones). The type tree is the same
// generic node format the engine uses, so this walker is content-agnostic.
//
// All values are little-endian, 32-bit pointers (every RO .gr2 is LE/32-bit;
// big-endian / 64-bit variants exist but none ship with RO, so they're rejected
// rather than half-supported).
//
// IMPORTANT — RO corpus compression: the 21 RO .gr2 files store their data
// sections with Granny compression type 1 ("Oodle0"). Oodle0 is a DIFFERENT
// codec from the widely-reverse-engineered "Oodle1" (type 2) implemented below
// (and in opengr2/liboodle/nwn2mdk). Running the Oodle1 decoder on these
// sections yields garbage (verified: no Granny type strings appear, the data
// fails to parse). No open Oodle0 decoder exists at time of writing — opengr2
// stubs it out, opengr2-rs panics on it. So this parser fully handles
// UNCOMPRESSED and OODLE1 .gr2 (validated end-to-end against an uncompressed
// reference model: header → sections → fixups → type tree → mesh verts/indices),
// but the RO monster files cannot be decoded until an Oodle0 decompressor lands.
// `parseGranny` throws a clearly-labelled error for an Oodle0 section so callers
// can degrade gracefully.

import ArrayBufferSlice from "../ArrayBufferSlice.js";

// ---------------------------------------------------------------------------
// Granny element type ids (the self-describing type-tree node "type" field).
// ---------------------------------------------------------------------------
const enum GrannyType {
    None = 0,
    Inline = 1,                 // empty node, just a container with children
    Reference = 2,              // pointer to one child struct
    ReferenceToArray = 3,       // count + pointer to a tightly-packed array
    ArrayOfReferences = 4,      // count + pointer to an array of pointers
    VariantReference = 5,       // (type pointer, data pointer)
    ReferenceToVariantArray = 7,// (type pointer, count, data pointer)
    String = 8,                 // pointer to a NUL-terminated string
    Transform = 9,              // GrannyTransform (68 bytes)
    Real32 = 10,                // f32
    Int8 = 11, UInt8 = 12, BinormalInt8 = 13, NormalUInt8 = 14,
    Int16 = 15, UInt16 = 16, BinormalInt16 = 17, NormalUInt16 = 18,
    Int32 = 19, UInt32 = 20,
    Real16 = 21,                // half float
    EmptyReference = 22,
}

// Compression types in the section header.
const enum GrannyCompression {
    None = 0,
    Oodle0 = 1,
    Oodle1 = 2,
    BitKnit1 = 3,
    BitKnit2 = 4,
}

// Per-element on-disk size in 32-bit mode (only the fixed-size scalar/struct
// types; pointer-bearing types are read explicitly in the walker).
const TYPE_SCALAR_SIZE: { [k: number]: number } = {
    [GrannyType.Real32]: 4, [GrannyType.Int32]: 4, [GrannyType.UInt32]: 4,
    [GrannyType.Int16]: 2, [GrannyType.UInt16]: 2, [GrannyType.BinormalInt16]: 2, [GrannyType.NormalUInt16]: 2,
    [GrannyType.Real16]: 2,
    [GrannyType.Int8]: 1, [GrannyType.UInt8]: 1, [GrannyType.BinormalInt8]: 1, [GrannyType.NormalUInt8]: 1,
    [GrannyType.Transform]: 68,
};

// Little-endian 32-bit Granny2 v6/v7 magic, as the bytes appear on disk.
const GRANNY_MAGIC = [0xb8, 0x67, 0xb0, 0xca, 0xf8, 0x6d, 0xb1, 0x0f, 0x84, 0x72, 0x8c, 0x7e, 0x5e, 0x19, 0x00, 0x1e];

interface GrannySection {
    compression: number;
    dataOffset: number;   // offset in the FILE of this section's (compressed) bytes
    compressedSize: number;
    decompressedSize: number;
    alignment: number;
    oodleStop0: number;
    oodleStop1: number;
    fixupOffset: number;  // offset in the FILE of this section's pointer-fixup table
    fixupCount: number;
    marshalOffset: number;
    marshalCount: number;
}

// The decoded file: one contiguous data blob (all sections decompressed and
// concatenated), per-section base offsets into it, the resolved pointer-fixup
// map, and the absolute offsets of the type tree + root object.
export interface GrannyFile {
    blob: Uint8Array;
    view: DataView;
    sectionBase: number[];       // sectionBase[i] = byte offset of section i in `blob`
    fixups: Map<number, number>; // absolute src offset -> absolute dst offset
    typeAbs: number;             // absolute offset of the root type list
    rootAbs: number;             // absolute offset of the root data object
    version: number;
}

// ---------------------------------------------------------------------------
// Container: read header, section table, decompress sections, apply fixups.
// ---------------------------------------------------------------------------

export function parseGranny(buffer: ArrayBufferSlice): GrannyFile {
    const view = buffer.createDataView();
    const bytes = buffer.createTypedArray(Uint8Array);

    if (view.byteLength < 0x60)
        throw new Error(`Granny: file too small (${view.byteLength} bytes)`);

    for (let i = 0; i < 16; i++)
        if (bytes[i] !== GRANNY_MAGIC[i])
            throw new Error(`Granny: bad magic`);

    // magic[16], headerSize@0x10, headerFormat@0x14 (0 = sections individually
    // (de)compressed, which is the only form RO uses), reserved[2].
    const headerFormat = view.getUint32(0x14, true);
    if (headerFormat !== 0)
        throw new Error(`Granny: unsupported header format ${headerFormat}`);

    // GrannyFileHeader at 0x20.
    const version = view.getUint32(0x20, true);
    if (version !== 6 && version !== 7)
        throw new Error(`Granny: unsupported version ${version}`);
    const totalSize = view.getUint32(0x24, true);
    if (totalSize !== view.byteLength)
        throw new Error(`Granny: size mismatch (header ${totalSize}, file ${view.byteLength})`);

    // sectionArrayOffset is relative to the start of the file header (0x20).
    const sectionArrayOffset = 0x20 + view.getUint32(0x2c, true);
    const sectionCount = view.getUint32(0x30, true);

    // Root references: (sectionIndex, offsetInSection). Type list + root data.
    const typeSection = view.getUint32(0x34, true);
    const typeOffset = view.getUint32(0x38, true);
    const rootSection = view.getUint32(0x3c, true);
    const rootOffset = view.getUint32(0x40, true);

    // Read the section table (44 bytes per entry).
    const sections: GrannySection[] = [];
    for (let i = 0; i < sectionCount; i++) {
        const o = sectionArrayOffset + i * 44;
        sections.push({
            compression: view.getUint32(o + 0, true),
            dataOffset: view.getUint32(o + 4, true),
            compressedSize: view.getUint32(o + 8, true),
            decompressedSize: view.getUint32(o + 12, true),
            alignment: view.getUint32(o + 16, true),
            oodleStop0: view.getUint32(o + 20, true),
            oodleStop1: view.getUint32(o + 24, true),
            fixupOffset: view.getUint32(o + 28, true),
            fixupCount: view.getUint32(o + 32, true),
            marshalOffset: view.getUint32(o + 36, true),
            marshalCount: view.getUint32(o + 40, true),
        });
    }

    // Decompress every section into one contiguous blob; record per-section base.
    let blobSize = 0;
    for (const s of sections)
        blobSize += s.decompressedSize;
    const blob = new Uint8Array(blobSize);
    const sectionBase: number[] = [];
    let cursor = 0;
    for (const s of sections) {
        sectionBase.push(cursor);
        if (s.decompressedSize === 0) {
            // empty section
        } else if (s.compression === GrannyCompression.None) {
            blob.set(bytes.subarray(s.dataOffset, s.dataOffset + s.decompressedSize), cursor);
        } else if (s.compression === GrannyCompression.Oodle1) {
            // Oodle1: faithful, validates on Oodle1-compressed gr2.
            const comp = new Uint8Array(s.compressedSize + 4);
            comp.set(bytes.subarray(s.dataOffset, s.dataOffset + s.compressedSize));
            const out = blob.subarray(cursor, cursor + s.decompressedSize);
            decompressOodle1(comp, s.compressedSize, out, s.decompressedSize, s.oodleStop0, s.oodleStop1);
        } else if (s.compression === GrannyCompression.Oodle0) {
            // RO's monster files land here. Oodle0 is NOT Oodle1 — see the file
            // header note. We have no faithful decoder, so fail loudly rather
            // than emit garbage.
            throw new GrannyOodle0Error(`Granny: section uses Oodle0 compression, which has no open decoder (RO monster .gr2 are blocked on this)`);
        } else {
            throw new Error(`Granny: unsupported section compression ${s.compression}`);
        }
        cursor += s.decompressedSize;
    }

    // Apply the pointer-fixup tables. Each fixup says "the pointer stored at
    // (srcSection, srcOffset) should point at (dstSection, dstOffset)". We build
    // an absolute-offset -> absolute-offset map; the walker reads pointer fields
    // through it (a field with no fixup is a null pointer).
    const fixups = new Map<number, number>();
    for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        for (let k = 0; k < s.fixupCount; k++) {
            const o = s.fixupOffset + k * 12;
            const srcOffset = view.getUint32(o + 0, true);
            const dstSection = view.getUint32(o + 4, true);
            const dstOffset = view.getUint32(o + 8, true);
            fixups.set(sectionBase[i] + srcOffset, sectionBase[dstSection] + dstOffset);
        }
        // Marshalling fixups only matter for endianness mismatches (none here).
    }

    return {
        blob,
        view: new DataView(blob.buffer, blob.byteOffset, blob.byteLength),
        sectionBase,
        fixups,
        typeAbs: sectionBase[typeSection] + typeOffset,
        rootAbs: sectionBase[rootSection] + rootOffset,
        version,
    };
}

// Thrown specifically for the (currently undecodable) Oodle0 sections so callers
// can detect and skip RO monster models without conflating it with a real parse
// failure.
class GrannyOodle0Error extends Error {}

// ---------------------------------------------------------------------------
// Type-tree walker. Reads a list of 32-byte type nodes (terminated by a node
// whose type==0) at `typeAbs`, consuming the matching data sequentially from
// `dataAbs`. Returns the typed members keyed by name.
// ---------------------------------------------------------------------------

interface GrannyMember {
    type: number;
    name: string | null;
    childTypeAbs: number | null; // type list describing the child struct/elements
    arraySize: number;
    // resolved data, depending on `type`:
    ref?: number | null;         // Reference / EmptyReference / VariantReference target (abs offset)
    variantTypeAbs?: number | null; // VariantReference / ReferenceToVariantArray element type
    count?: number;              // array element count
    arrAbs?: number | null;      // array data (abs offset)
    str?: string | null;         // String value
    scalarAbs?: number;          // start offset of inline scalar data
}

const TYPE_NODE_SIZE = 32; // 32-bit: type(4) name(4) children(4) arraySize(4) extra[12] extra4(4)

function readCString(blob: Uint8Array, off: number | null): string | null {
    if (off === null || off < 0 || off >= blob.length)
        return null;
    let e = off;
    while (e < blob.length && blob[e] !== 0)
        e++;
    let s = "";
    for (let i = off; i < e; i++)
        s += String.fromCharCode(blob[i]);
    return s;
}

// On-disk byte size a member of the given type consumes in the data stream
// (32-bit). Pointer-bearing members store fixed-width handles; an Inline member
// embeds its child struct in place, so its size is the child struct's size. Used
// to keep the data cursor in sync across inline structs (e.g. a texture's
// pixel-layout, a skeleton's inline members) — without this the walker desyncs
// for every member after an inline one.
function memberDataSize(gr: GrannyFile, type: number, childTypeAbs: number | null, arraySize: number, depth: number): number {
    const n = Math.max(1, arraySize);
    let unit: number;
    switch (type) {
    case GrannyType.Inline:
        unit = childTypeAbs !== null && depth < 16 ? computeInlineSize(gr, childTypeAbs, depth + 1) : 0;
        break;
    case GrannyType.Reference:
    case GrannyType.EmptyReference:
    case GrannyType.String:
        unit = 4; break;
    case GrannyType.ReferenceToArray:
    case GrannyType.ArrayOfReferences:
    case GrannyType.VariantReference:
        unit = 8; break;
    case GrannyType.ReferenceToVariantArray:
        unit = 12; break;
    default:
        unit = TYPE_SCALAR_SIZE[type] ?? 0; break;
    }
    return unit * n;
}

// Total data-stream size of an inline struct described by a type list.
function computeInlineSize(gr: GrannyFile, typeAbs: number, depth = 0): number {
    const { view, blob, fixups } = gr;
    let t = typeAbs;
    let size = 0;
    for (;;) {
        if (t + TYPE_NODE_SIZE > blob.length)
            break;
        const ntype = view.getUint32(t + 0, true);
        if (ntype === GrannyType.None || ntype > GrannyType.EmptyReference)
            break;
        const childP = fixups.get(t + 8);
        const arraySize = view.getInt32(t + 12, true);
        size += memberDataSize(gr, ntype, childP === undefined ? null : childP, arraySize, depth);
        t += TYPE_NODE_SIZE;
    }
    return size;
}

function walkType(gr: GrannyFile, typeAbs: number, dataAbs: number): Map<string, GrannyMember> {
    const { view, blob, fixups } = gr;
    const out = new Map<string, GrannyMember>();

    let t = typeAbs;
    let d = dataAbs;
    // Resolve a pointer field at absolute offset `o` via the fixup map.
    const ptr = (o: number): number | null => {
        const v = fixups.get(o);
        return v === undefined ? null : v;
    };

    for (;;) {
        if (t + TYPE_NODE_SIZE > blob.length)
            break;
        const ntype = view.getUint32(t + 0, true);
        if (ntype === GrannyType.None || ntype > GrannyType.EmptyReference)
            break;

        const nameP = ptr(t + 4);
        const childP = ptr(t + 8);
        const arraySize = view.getInt32(t + 12, true);
        const name = readCString(blob, nameP);

        const m: GrannyMember = { type: ntype, name, childTypeAbs: childP, arraySize };

        switch (ntype) {
        case GrannyType.Reference:
        case GrannyType.EmptyReference:
            m.ref = ptr(d); d += 4;
            break;
        case GrannyType.String:
            m.str = readCString(blob, ptr(d)); d += 4;
            break;
        case GrannyType.ReferenceToArray:
            m.count = view.getUint32(d, true); d += 4;
            m.arrAbs = ptr(d); d += 4;
            break;
        case GrannyType.ArrayOfReferences:
            m.count = view.getUint32(d, true); d += 4;
            m.arrAbs = ptr(d); d += 4;
            break;
        case GrannyType.VariantReference:
            m.variantTypeAbs = ptr(d); d += 4;
            m.ref = ptr(d); d += 4;
            break;
        case GrannyType.ReferenceToVariantArray:
            m.variantTypeAbs = ptr(d); d += 4;
            m.count = view.getUint32(d, true); d += 4;
            m.arrAbs = ptr(d); d += 4;
            break;
        case GrannyType.Inline:
            // An inline struct lives in place in the data stream. Record its
            // start so callers can walk it, and advance past its full size so
            // following members stay aligned.
            m.scalarAbs = d;
            d += memberDataSize(gr, ntype, childP, arraySize, 0);
            break;
        default: {
            const sz = TYPE_SCALAR_SIZE[ntype] ?? 0;
            const n = Math.max(1, arraySize);
            m.scalarAbs = d;
            d += sz * n;
            break;
        }
        }

        if (name !== null)
            out.set(name, m);
        t += TYPE_NODE_SIZE;
    }

    return out;
}

// Dereferences an ArrayOfReferences member into its element pointers (abs offs).
function derefArrayOfReferences(gr: GrannyFile, m: GrannyMember): (number | null)[] {
    const out: (number | null)[] = [];
    if (m.arrAbs === null || m.arrAbs === undefined || m.count === undefined)
        return out;
    for (let i = 0; i < m.count; i++) {
        const p = gr.fixups.get(m.arrAbs + i * 4);
        out.push(p === undefined ? null : p);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Mesh extraction. Pulls Position / Normal / TextureCoordinates0 + index buffer
// from each mesh, plus optional per-vertex bone weights/indices for skinning.
// ---------------------------------------------------------------------------

interface GrannyVertexFormatField {
    name: string | null;
    type: number;
    count: number;     // element count (e.g. 3 for a float3)
    byteSize: number;  // total bytes for this field
    byteOffset: number;// offset of this field within the vertex
}

export interface GrannyMesh {
    name: string | null;
    // Interleaved decoded attributes (one per vertex):
    positions: Float32Array; // vertexCount * 3
    normals: Float32Array;   // vertexCount * 3 (zeroed if absent)
    uvs: Float32Array;       // vertexCount * 2 (zeroed if absent)
    boneWeights: Float32Array; // vertexCount * 4 (zeroed if absent)
    boneIndices: Uint8Array;   // vertexCount * 4 (zeroed if absent)
    indices: Uint32Array;
    vertexCount: number;
    boneBindingNames: string[]; // names referenced by per-mesh bone bindings (skin)
    textureIndex: number;       // index into GrannyModelData.textures (-1 if none)
}

// A decoded embedded texture image (level 0), expanded to tightly-packed RGBA.
interface GrannyTextureImage {
    width: number;
    height: number;
    rgba: Uint8Array; // width * height * 4
}

export interface GrannyBone {
    name: string | null;
    parentIndex: number;
    // Local rest transform (decomposed): translation, rotation quat, 3x3 scale-shear.
    translation: [number, number, number];
    rotation: [number, number, number, number];
    scaleShear: Float32Array; // 9 (row-major 3x3)
    // The bone's inverse-bind (inverse world-rest) 4x4, column-major as gl-matrix
    // wants it. Skinning multiplies the animated bone-world by this to take a
    // rest-space vertex into the bone's animated frame.
    inverseWorld: Float32Array; // 16
}

export interface GrannySkeleton {
    name: string | null;
    bones: GrannyBone[];
}

// One keyframed curve: degree, knot times (seconds), and a flat control array of
// `dimension` floats per knot (3 = position xyz, 4 = orientation quat xyzw,
// 9 = scale-shear 3x3). Empty (zero knots) means "use the bone's rest value".
export interface GrannyCurve {
    degree: number;
    dimension: number;
    knots: Float32Array;    // knotCount
    controls: Float32Array; // knotCount * dimension
}

// Per-bone animation: optional position / orientation / scale-shear curves.
export interface GrannyTransformTrack {
    boneName: string | null;
    position: GrannyCurve | null;
    orientation: GrannyCurve | null;
    scaleShear: GrannyCurve | null;
}

// A clip: total duration (seconds) and per-bone transform tracks. RO's WoE
// models carry exactly one animation with one track group whose tracks map
// 1:1 (by name) onto the skeleton's bones.
export interface GrannyAnimation {
    name: string | null;
    duration: number;
    tracks: GrannyTransformTrack[];
}

export interface GrannyModelData {
    meshes: GrannyMesh[];
    skeletons: GrannySkeleton[];
    animations: GrannyAnimation[];
    textureNames: string[];
    textures: (GrannyTextureImage | null)[]; // index-aligned with textureNames
}

// Reads a vertex-format type list (the variant type of a Vertices array) into a
// field layout with byte offsets and a total stride.
function readVertexFormat(gr: GrannyFile, typeAbs: number): { fields: GrannyVertexFormatField[], stride: number } {
    const { view, blob, fixups } = gr;
    const fields: GrannyVertexFormatField[] = [];
    let t = typeAbs;
    let stride = 0;
    for (;;) {
        if (t + TYPE_NODE_SIZE > blob.length)
            break;
        const ntype = view.getUint32(t + 0, true);
        if (ntype === GrannyType.None || ntype > GrannyType.EmptyReference)
            break;
        const nameP = fixups.get(t + 4);
        const name = readCString(blob, nameP === undefined ? null : nameP);
        const arraySize = view.getInt32(t + 12, true);
        const elemSize = TYPE_SCALAR_SIZE[ntype] ?? 0;
        const count = Math.max(1, arraySize);
        const byteSize = elemSize * count;
        fields.push({ name, type: ntype, count, byteSize, byteOffset: stride });
        stride += byteSize;
        t += TYPE_NODE_SIZE;
    }
    return { fields, stride };
}

// Reads a fixed-count scalar field from a vertex at `base`.
function readVertexFloats(view: DataView, base: number, field: GrannyVertexFormatField, out: Float32Array, outOff: number, n: number): void {
    for (let i = 0; i < n; i++) {
        if (i < field.count && field.type === GrannyType.Real32)
            out[outOff + i] = view.getFloat32(base + field.byteOffset + i * 4, true);
        else
            out[outOff + i] = 0;
    }
}

// Extracts a single mesh from its data struct.
function extractMesh(gr: GrannyFile, meshTypeAbs: number, meshDataAbs: number): GrannyMesh | null {
    const { view } = gr;
    const mw = walkType(gr, meshTypeAbs, meshDataAbs);

    const nameM = mw.get("Name");
    const name = nameM?.str ?? null;

    const pvd = mw.get("PrimaryVertexData");
    const topo = mw.get("PrimaryTopology");
    if (pvd === undefined || pvd.ref === null || pvd.ref === undefined || pvd.childTypeAbs === null)
        return null;
    if (topo === undefined || topo.ref === null || topo.ref === undefined || topo.childTypeAbs === null)
        return null;

    // Vertices: a ReferenceToVariantArray whose variant type is the vertex format.
    const vw = walkType(gr, pvd.childTypeAbs, pvd.ref);
    const verts = vw.get("Vertices");
    if (verts === undefined || verts.arrAbs === null || verts.arrAbs === undefined || verts.variantTypeAbs === null || verts.variantTypeAbs === undefined || verts.count === undefined)
        return null;

    const { fields, stride } = readVertexFormat(gr, verts.variantTypeAbs);
    const vertexCount = verts.count;
    const arr = verts.arrAbs;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const boneWeights = new Float32Array(vertexCount * 4);
    const boneIndices = new Uint8Array(vertexCount * 4);

    // Identify the relevant fields by Granny's standard component names.
    const fPos = fields.find((f) => f.name === "Position");
    const fNrm = fields.find((f) => f.name === "Normal");
    const fUV = fields.find((f) => f.name === "TextureCoordinates0" || f.name === "TextureCoordinates");
    const fBoneW = fields.find((f) => f.name === "BoneWeights");
    const fBoneI = fields.find((f) => f.name === "BoneIndices");

    for (let v = 0; v < vertexCount; v++) {
        const base = arr + v * stride;
        if (fPos !== undefined) readVertexFloats(view, base, fPos, positions, v * 3, 3);
        if (fNrm !== undefined) readVertexFloats(view, base, fNrm, normals, v * 3, 3);
        if (fUV !== undefined) readVertexFloats(view, base, fUV, uvs, v * 2, 2);
        if (fBoneW !== undefined) {
            // Bone weights are NormalUInt8[4] (0..255 -> 0..1) on most exports.
            for (let i = 0; i < 4; i++) {
                if (i < fBoneW.count) {
                    if (fBoneW.type === GrannyType.NormalUInt8 || fBoneW.type === GrannyType.UInt8)
                        boneWeights[v * 4 + i] = gr.blob[base + fBoneW.byteOffset + i] / 255;
                    else if (fBoneW.type === GrannyType.Real32)
                        boneWeights[v * 4 + i] = view.getFloat32(base + fBoneW.byteOffset + i * 4, true);
                }
            }
        }
        if (fBoneI !== undefined) {
            for (let i = 0; i < 4 && i < fBoneI.count; i++)
                boneIndices[v * 4 + i] = gr.blob[base + fBoneI.byteOffset + i];
        }
    }

    // Indices: Indices (u32) or Indices16 (u16). Topology may also carry groups.
    const tw = walkType(gr, topo.childTypeAbs, topo.ref);
    let indices = new Uint32Array(0);
    const ind32 = tw.get("Indices");
    const ind16 = tw.get("Indices16");
    if (ind32 !== undefined && ind32.arrAbs !== null && ind32.arrAbs !== undefined && ind32.count !== undefined) {
        indices = new Uint32Array(ind32.count);
        for (let i = 0; i < ind32.count; i++)
            indices[i] = view.getUint32(ind32.arrAbs + i * 4, true);
    } else if (ind16 !== undefined && ind16.arrAbs !== null && ind16.arrAbs !== undefined && ind16.count !== undefined) {
        indices = new Uint32Array(ind16.count);
        for (let i = 0; i < ind16.count; i++)
            indices[i] = view.getUint16(ind16.arrAbs + i * 2, true);
    }

    // Bone bindings: the bones this mesh's vertices are skinned to. A vertex's
    // BoneIndices are LOCAL indices into THIS list (0..bindingCount-1); each
    // binding's BoneName resolves to a skeleton bone. The struct is a String
    // (BoneName) + OBBMin[3] + OBBMax[3] + TriangleCount(int) + TriangleIndices
    // pointer; computeInlineSize gives the correct stride across the String/
    // pointer fields (the earlier scalar-only stride undercounted).
    const boneBindingNames: string[] = [];
    const bb = mw.get("BoneBindings");
    if (bb !== undefined && bb.arrAbs !== null && bb.arrAbs !== undefined && bb.count !== undefined && bb.childTypeAbs !== null) {
        const bStride = computeInlineSize(gr, bb.childTypeAbs);
        if (bStride === 0)
            throw new Error(`Granny: BoneBindings element stride is 0 (mesh '${name ?? "<unnamed>"}'); type tree is empty or malformed`);
        for (let i = 0; i < bb.count; i++) {
            const bw = walkType(gr, bb.childTypeAbs, bb.arrAbs + i * bStride);
            boneBindingNames.push(bw.get("BoneName")?.str ?? "");
        }
    }

    return { name, positions, normals, uvs, boneWeights, boneIndices, indices, vertexCount, boneBindingNames, textureIndex: -1 };
}

// Decodes one embedded texture's level-0 image to tightly-packed RGBA. RO's
// Granny textures are stored raw, 4 bytes/pixel, with a component layout
// (shift/bits per channel). The common case is RGBA8888 (shifts 0/8/16/24, all
// 8-bit) — a direct copy; we honour the layout generally so a BGRA/other order
// still decodes. A null return means no usable image data.
function extractTexture(gr: GrannyFile, texTypeAbs: number, texDataAbs: number): GrannyTextureImage | null {
    const { view } = gr;
    const tw = walkType(gr, texTypeAbs, texDataAbs);
    const scI = (m: GrannyMember | undefined): number | undefined =>
        m?.scalarAbs !== undefined ? view.getInt32(m.scalarAbs, true) : undefined;
    const width = scI(tw.get("Width"));
    const height = scI(tw.get("Height"));
    if (width === undefined || height === undefined || width <= 0 || height <= 0)
        return null;

    // Pixel layout (inline struct): BytesPerPixel + per-component shift/bit count.
    let bytesPerPixel = 4;
    const shifts = [0, 8, 16, 24];
    const bits = [8, 8, 8, 8];
    const layout = tw.get("Layout");
    if (layout !== undefined && layout.childTypeAbs !== null && layout.scalarAbs !== undefined) {
        const lw = walkType(gr, layout.childTypeAbs, layout.scalarAbs);
        bytesPerPixel = scI(lw.get("BytesPerPixel")) ?? 4;
        const sh = lw.get("ShiftForComponent"), bi = lw.get("BitsForComponent");
        if (sh?.scalarAbs !== undefined)
            for (let i = 0; i < 4; i++) shifts[i] = view.getInt32(sh.scalarAbs + i * 4, true);
        if (bi?.scalarAbs !== undefined)
            for (let i = 0; i < 4; i++) bits[i] = view.getInt32(bi.scalarAbs + i * 4, true);
    }

    // Images[0].MIPLevels[0].Pixels — both arrays are ReferenceToArray of packed
    // structs; the level-0 pixel bytes are a ReferenceToArray of UInt8.
    const images = tw.get("Images");
    if (images === undefined || images.arrAbs === null || images.arrAbs === undefined || !images.count || images.childTypeAbs === null)
        return null;
    const iw = walkType(gr, images.childTypeAbs, images.arrAbs); // image[0]
    const mips = iw.get("MIPLevels");
    if (mips === undefined || mips.arrAbs === null || mips.arrAbs === undefined || !mips.count || mips.childTypeAbs === null)
        return null;
    const mw = walkType(gr, mips.childTypeAbs, mips.arrAbs); // mip[0]
    const pixels = mw.get("Pixels") ?? mw.get("PixelBytes");
    if (pixels === undefined || pixels.arrAbs === null || pixels.arrAbs === undefined || !pixels.count)
        return null;
    const strideField = scI(mw.get("Stride"));
    const rowStride = strideField && strideField > 0 ? strideField : width * bytesPerPixel;

    // RO's textures use a proprietary RAD compressed encoding (Encoding != raw):
    // the stored pixel bytes are far smaller than a raw image and only granny2's
    // own codec expands them. We don't decode that here — those textures are
    // expanded offline (the .tex bake) and loaded separately. Only decode when
    // the data is genuinely raw (full size present).
    if (pixels.count < width * height * bytesPerPixel)
        return null;

    const src = gr.blob;
    const srcBase = pixels.arrAbs;
    const rgba = new Uint8Array(width * height * 4);
    // Fast path: 4 bytes/pixel, 8 bits each, shift order R,G,B,A -> a direct copy.
    const direct = bytesPerPixel === 4 && bits[0] === 8 && bits[1] === 8 && bits[2] === 8 &&
        shifts[0] === 0 && shifts[1] === 8 && shifts[2] === 16;
    for (let y = 0; y < height; y++) {
        const rowOff = srcBase + y * rowStride;
        if (direct) {
            // copy R,G,B then alpha (or 255 if no alpha channel / 0-bit alpha).
            for (let x = 0; x < width; x++) {
                const s = rowOff + x * 4, d = (y * width + x) * 4;
                if (s + 4 > src.length) break;
                rgba[d + 0] = src[s + 0];
                rgba[d + 1] = src[s + 1];
                rgba[d + 2] = src[s + 2];
                rgba[d + 3] = bits[3] > 0 ? src[s + 3] : 255;
            }
        } else {
            for (let x = 0; x < width; x++) {
                const s = rowOff + x * bytesPerPixel, d = (y * width + x) * 4;
                if (s + bytesPerPixel > src.length) break;
                let px = 0;
                for (let b = 0; b < bytesPerPixel && b < 4; b++) px |= src[s + b] << (b * 8);
                for (let c = 0; c < 4; c++) {
                    const nb = bits[c];
                    if (nb <= 0) { rgba[d + c] = c === 3 ? 255 : 0; continue; }
                    const mask = (1 << nb) - 1;
                    const v = (px >>> shifts[c]) & mask;
                    rgba[d + c] = nb >= 8 ? (v >>> (nb - 8)) : (v << (8 - nb));
                }
            }
        }
    }
    return { width, height, rgba };
}

// Follows a material to its diffuse texture's data offset, recursing through the
// material's Maps (mirrors GrannyGetMaterialTextureByType). Returns the absolute
// offset of the granny_texture struct, or null.
function resolveMaterialTexture(gr: GrannyFile, matTypeAbs: number, matDataAbs: number, depth = 0): number | null {
    if (depth > 8)
        return null;
    const mw = walkType(gr, matTypeAbs, matDataAbs);
    const tex = mw.get("Texture");
    if (tex !== undefined && tex.ref !== null && tex.ref !== undefined)
        return tex.ref;
    const maps = mw.get("Maps");
    if (maps !== undefined && maps.arrAbs !== null && maps.arrAbs !== undefined && maps.count && maps.childTypeAbs !== null) {
        const mapStride = computeInlineSize(gr, maps.childTypeAbs);
        if (mapStride === 0)
            throw new Error(`Granny: material Maps element stride is 0; type tree is empty or malformed`);
        for (let i = 0; i < maps.count; i++) {
            // granny_material_map = { Usage: String, Map: granny_material* }.
            const mapw = walkType(gr, maps.childTypeAbs, maps.arrAbs + i * mapStride);
            const subMat = mapw.get("Map");
            if (subMat !== undefined && subMat.ref !== null && subMat.ref !== undefined && subMat.childTypeAbs !== null) {
                const t = resolveMaterialTexture(gr, subMat.childTypeAbs, subMat.ref, depth + 1);
                if (t !== null)
                    return t;
            }
        }
    }
    return null;
}

// Resolves a mesh's first material binding to a model-texture index.
function resolveMeshTextureIndex(gr: GrannyFile, meshTypeAbs: number, meshDataAbs: number, texAbsToIndex: Map<number, number>): number {
    const mw = walkType(gr, meshTypeAbs, meshDataAbs);
    const mb = mw.get("MaterialBindings");
    if (mb === undefined || mb.arrAbs === null || mb.arrAbs === undefined || !mb.count || mb.childTypeAbs === null)
        return -1;
    const bindStride = computeInlineSize(gr, mb.childTypeAbs);
    if (bindStride === 0)
        throw new Error(`Granny: MaterialBindings element stride is 0; type tree is empty or malformed`);
    for (let i = 0; i < mb.count; i++) {
        const bw = walkType(gr, mb.childTypeAbs, mb.arrAbs + i * bindStride);
        const mat = bw.get("Material");
        if (mat !== undefined && mat.ref !== null && mat.ref !== undefined && mat.childTypeAbs !== null) {
            const texAbs = resolveMaterialTexture(gr, mat.childTypeAbs, mat.ref);
            if (texAbs !== null && texAbsToIndex.has(texAbs))
                return texAbsToIndex.get(texAbs)!;
        }
    }
    return -1;
}

// Extracts the model's meshes + skeletons + texture names from a parsed file.
export function extractGrannyModel(gr: GrannyFile): GrannyModelData {
    const top = walkType(gr, gr.typeAbs, gr.rootAbs);

    // Model textures first: their data offsets index the per-mesh material lookup,
    // and their embedded images decode to RGBA. textureNames / textures stay
    // index-aligned. (Textures is an ArrayOfReferences.)
    const textureNames: string[] = [];
    const textures: (GrannyTextureImage | null)[] = [];
    const texAbsToIndex = new Map<number, number>();
    const texM = top.get("Textures");
    if (texM !== undefined && texM.childTypeAbs !== null) {
        const ptrs = derefArrayOfReferences(gr, texM);
        for (const p of ptrs) {
            if (p === null) continue;
            texAbsToIndex.set(p, textureNames.length);
            const tw = walkType(gr, texM.childTypeAbs, p);
            textureNames.push(tw.get("FromFileName")?.str ?? "");
            textures.push(extractTexture(gr, texM.childTypeAbs, p));
        }
    }

    const meshes: GrannyMesh[] = [];
    const meshesM = top.get("Meshes");
    if (meshesM !== undefined && meshesM.childTypeAbs !== null) {
        const ptrs = derefArrayOfReferences(gr, meshesM);
        for (const p of ptrs) {
            if (p === null) continue;
            const m = extractMesh(gr, meshesM.childTypeAbs, p);
            if (m !== null && m.vertexCount > 0 && m.indices.length > 0) {
                m.textureIndex = resolveMeshTextureIndex(gr, meshesM.childTypeAbs, p, texAbsToIndex);
                meshes.push(m);
            }
        }
    }

    const skeletons: GrannySkeleton[] = [];
    const skM = top.get("Skeletons");
    if (skM !== undefined && skM.childTypeAbs !== null) {
        const ptrs = derefArrayOfReferences(gr, skM);
        for (const p of ptrs) {
            if (p === null) continue;
            const sk = extractSkeleton(gr, skM.childTypeAbs, p);
            if (sk !== null)
                skeletons.push(sk);
        }
    }

    const animations: GrannyAnimation[] = [];
    const aM = top.get("Animations");
    if (aM !== undefined && aM.childTypeAbs !== null) {
        const ptrs = derefArrayOfReferences(gr, aM);
        for (const p of ptrs) {
            if (p === null) continue;
            const a = extractAnimation(gr, aM.childTypeAbs, p);
            if (a !== null)
                animations.push(a);
        }
    }

    return { meshes, skeletons, animations, textureNames, textures };
}

function extractSkeleton(gr: GrannyFile, skTypeAbs: number, skDataAbs: number): GrannySkeleton | null {
    const { view } = gr;
    const sw = walkType(gr, skTypeAbs, skDataAbs);
    const name = sw.get("Name")?.str ?? null;
    const bonesM = sw.get("Bones");
    const bones: GrannyBone[] = [];
    // Bones is a ReferenceToArray (type 3): a tightly-packed array of bone
    // structs reached through `childTypeAbs` (NOT a variant array). Each bone:
    // Name(String), ParentIndex(Int32), Transform(GrannyTransform 68B),
    // InverseWorldTransform(Real32[16]), then pointers we ignore. We derive the
    // element stride from the bone type list (computeInlineSize handles the
    // inline 68B Transform), and read the named fields per element.
    if (bonesM !== undefined && bonesM.arrAbs !== null && bonesM.arrAbs !== undefined && bonesM.childTypeAbs !== null && bonesM.count !== undefined) {
        const stride = computeInlineSize(gr, bonesM.childTypeAbs);
        for (let i = 0; i < bonesM.count; i++) {
            const base = bonesM.arrAbs + i * stride;
            const bw = walkType(gr, bonesM.childTypeAbs, base);
            const bn = bw.get("Name")?.str ?? null;
            const parentIndex = bw.get("ParentIndex")?.scalarAbs !== undefined ? view.getInt32(bw.get("ParentIndex")!.scalarAbs!, true) : -1;
            const tr = bw.get("Transform");
            let translation: [number, number, number] = [0, 0, 0];
            let rotation: [number, number, number, number] = [0, 0, 0, 1];
            const scaleShear = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
            if (tr !== undefined && tr.scalarAbs !== undefined) {
                // GrannyTransform: Flags(u32), Position f32[3], Orientation f32[4], ScaleShear f32[3][3].
                const o = tr.scalarAbs;
                translation = [view.getFloat32(o + 4, true), view.getFloat32(o + 8, true), view.getFloat32(o + 12, true)];
                rotation = [view.getFloat32(o + 16, true), view.getFloat32(o + 20, true), view.getFloat32(o + 24, true), view.getFloat32(o + 28, true)];
                for (let k = 0; k < 9; k++)
                    scaleShear[k] = view.getFloat32(o + 32 + k * 4, true);
            }
            // InverseWorldTransform is the inverse world-rest matrix. Granny lays
            // it out so that the 16 floats, read in order, are already a
            // column-major matrix (verified: worldRest * inverseWorld == I when
            // read straight). So copy verbatim — no transpose.
            const inverseWorld = new Float32Array(16);
            const iw = bw.get("InverseWorldTransform");
            if (iw !== undefined && iw.scalarAbs !== undefined) {
                for (let j = 0; j < 16; j++)
                    inverseWorld[j] = view.getFloat32(iw.scalarAbs + j * 4, true);
            } else {
                inverseWorld[0] = inverseWorld[5] = inverseWorld[10] = inverseWorld[15] = 1;
            }
            bones.push({ name: bn, parentIndex, translation, rotation, scaleShear, inverseWorld });
        }
    }
    return { name, bones };
}

// Reads one granny_curve from an inline curve struct in a transform track.
// Granny stores curves in two equivalent shapes; we accept either:
//   (a) direct `granny_curve_data_da_keyframes_32f` inline:
//         { Degree(int), Knots[](float), Controls[](float) }
//       — the form every RO baked .gr2 uses.
//   (b) standard `granny_curve2 { ..., CurveData: VariantReference -> X }`
//       where X is the keyframes struct above. SDK-generated files use this.
// `dimension` is the per-knot control width (3/4/9). Returns null when the curve
// has no usable keys (so the caller falls back to the bone's rest value).
function extractCurve(gr: GrannyFile, curveTypeAbs: number, curveDataAbs: number, dimension: number): GrannyCurve | null {
    const { view } = gr;
    let cw = walkType(gr, curveTypeAbs, curveDataAbs);
    // Form (b): follow the inner CurveData VariantReference if Knots/Controls
    // aren't direct members of this curve struct.
    if (!cw.has("Knots") || !cw.has("Controls")) {
        const cd = cw.get("CurveData");
        if (cd === undefined || cd.ref === null || cd.ref === undefined || cd.variantTypeAbs === null || cd.variantTypeAbs === undefined)
            return null;
        cw = walkType(gr, cd.variantTypeAbs, cd.ref);
    }
    const degree = cw.get("Degree")?.scalarAbs !== undefined ? view.getInt32(cw.get("Degree")!.scalarAbs!, true) : 0;
    const knotsM = cw.get("Knots");
    const controlsM = cw.get("Controls");
    if (knotsM === undefined || knotsM.arrAbs === null || knotsM.arrAbs === undefined || !knotsM.count)
        return null;
    if (controlsM === undefined || controlsM.arrAbs === null || controlsM.arrAbs === undefined || !controlsM.count)
        return null;
    const knotCount = knotsM.count;
    const knots = new Float32Array(knotCount);
    for (let i = 0; i < knotCount; i++)
        knots[i] = view.getFloat32(knotsM.arrAbs + i * 4, true);
    const controls = new Float32Array(controlsM.count);
    for (let i = 0; i < controlsM.count; i++)
        controls[i] = view.getFloat32(controlsM.arrAbs + i * 4, true);
    return { degree, dimension, knots, controls };
}

function extractTransformTrack(gr: GrannyFile, trackTypeAbs: number, trackDataAbs: number): GrannyTransformTrack {
    const tw = walkType(gr, trackTypeAbs, trackDataAbs);
    const boneName = tw.get("Name")?.str ?? null;
    const curve = (memberName: string, dim: number): GrannyCurve | null => {
        const m = tw.get(memberName);
        if (m === undefined || m.childTypeAbs === null || m.scalarAbs === undefined)
            return null;
        return extractCurve(gr, m.childTypeAbs, m.scalarAbs, dim);
    };
    return {
        boneName,
        position: curve("PositionCurve", 3),
        orientation: curve("OrientationCurve", 4),
        scaleShear: curve("ScaleShearCurve", 9),
    };
}

function extractAnimation(gr: GrannyFile, animTypeAbs: number, animDataAbs: number): GrannyAnimation | null {
    const { view } = gr;
    const aw = walkType(gr, animTypeAbs, animDataAbs);
    const name = aw.get("Name")?.str ?? null;
    const duration = aw.get("Duration")?.scalarAbs !== undefined ? view.getFloat32(aw.get("Duration")!.scalarAbs!, true) : 0;

    const tracks: GrannyTransformTrack[] = [];
    const tgM = aw.get("TrackGroups");
    if (tgM !== undefined && tgM.childTypeAbs !== null) {
        const tgPtrs = derefArrayOfReferences(gr, tgM);
        for (const tgp of tgPtrs) {
            if (tgp === null) continue;
            const tw = walkType(gr, tgM.childTypeAbs, tgp);
            const ttM = tw.get("TransformTracks");
            if (ttM === undefined || ttM.arrAbs === null || ttM.arrAbs === undefined || ttM.childTypeAbs === null || ttM.count === undefined)
                continue;
            const stride = computeInlineSize(gr, ttM.childTypeAbs);
            for (let i = 0; i < ttM.count; i++)
                tracks.push(extractTransformTrack(gr, ttM.childTypeAbs, ttM.arrAbs + i * stride));
        }
    }
    return { name, duration, tracks };
}

// ---------------------------------------------------------------------------
// Oodle1 decompressor (Granny compression type 2).
//
// Faithful port of the open Oodle1 spec (LunaticInAHat/liboodle; cross-checked
// against nwn2mdk/opengr2, which validate byte-for-byte vs granny32.dll). The
// scheme is a three-layer codec: a bitstream layer (an arithmetic-coder-style
// fixed-point reader), an adaptive multi-symbol coder, and an LZSS dictionary.
//
// A compressed section holds three 12-byte parameter headers, then one bitstream
// that is decoded in up to three passes (the "stop" offsets split the output);
// each pass uses its own parameter set + a fresh dictionary.
//
// NOTE: this does NOT decode the RO monster files — those use Oodle0 (type 1),
// a different codec (see the file header). This is here so the parser is
// complete for uncompressed + Oodle1 .gr2, and ready the moment Oodle0 is added.
// ---------------------------------------------------------------------------

interface OodleParams {
    decodedValueMax: number; // literal alphabet absolute size
    backrefValueMax: number; // LZ window size
    decodedCount: number;    // unique literal count
    highbitCount: number;
    sizesCount: number[];    // 4 bytes
}

// Bitstream + arithmetic decoder. R/M are the shift register + modulus; L is the
// out-of-line LSB flag.
class OodleDecoder {
    private R: number;
    private M = 0x80;
    private L: number;
    private p: number;
    private sScale = 1;

    constructor(private s: Uint8Array, pos: number) {
        this.R = s[pos] >>> 1;
        this.L = s[pos] & 1;
        this.p = pos + 1;
    }

    private ingest(): void {
        while (this.M <= 0x800000) {
            this.R = (((this.R << 1) | this.L) >>> 0);
            this.R = (((this.R << 7) | (this.s[this.p] >>> 1)) >>> 0);
            this.L = this.s[this.p] & 1;
            this.M = (this.M * 256) % 0x1000000000000;
            this.p++;
        }
    }

    public decode(max: number): number {
        this.ingest();
        this.sScale = Math.floor(this.M / max);
        const z = Math.floor(this.R / this.sScale);
        return z < max - 1 ? z : max - 1;
    }

    // Consume a decoded symbol: lower-bound `val` spanning `err`.
    public commit(max: number, val: number, err: number): number {
        const sz = val * this.sScale;
        this.R = this.R - sz;
        if (this.R < 0) this.R = (this.R >>> 0);
        if (val + err < max)
            this.M = err * this.sScale;
        else
            this.M = this.M - sz;
        return val;
    }

    public decodeCommit(max: number): number {
        return this.commit(max, this.decode(max), 1);
    }
}

// Adaptive multi-symbol weight window.
class WeighWindow {
    private countCap: number;
    private ranges: number[] = [0, 0x4000];
    private values: number[] = [0];
    private weights: number[] = [4];
    private weightTotal = 4;
    private threshIncrease = 4;
    private threshIncreaseCap: number;
    private threshRangeRebuild = 8;
    private threshWeightRebuild: number;

    constructor(maxValue: number, countCap: number) {
        this.countCap = countCap + 1;
        this.threshWeightRebuild = Math.max(256, Math.min(32 * maxValue, 15160));
        if (maxValue > 64)
            this.threshIncreaseCap = Math.min(2 * maxValue, Math.floor(this.threshWeightRebuild / 2) - 32);
        else
            this.threshIncreaseCap = 128;
    }

    private rebuildRanges(): void {
        const n = this.weights.length;
        this.ranges.length = n;
        const rangeWeight = Math.floor((8 * 0x4000) / this.weightTotal);
        let rangeStart = 0;
        for (let i = 0; i < n; i++) {
            this.ranges[i] = rangeStart & 0xFFFF;
            rangeStart += Math.floor((this.weights[i] * rangeWeight) / 8);
        }
        this.ranges.push(0x4000);
        if (this.threshIncrease > Math.floor(this.threshIncreaseCap / 2)) {
            this.threshRangeRebuild = this.weightTotal + this.threshIncreaseCap;
        } else {
            this.threshIncrease *= 2;
            this.threshRangeRebuild = this.weightTotal + this.threshIncrease;
        }
    }

    private rebuildWeights(): void {
        let wt = 0;
        for (let i = 0; i < this.weights.length; i++) {
            this.weights[i] = Math.floor(this.weights[i] / 2);
            wt += this.weights[i];
        }
        this.weightTotal = wt & 0xFFFF;
        for (let i = 1; i < this.weights.length; i++) {
            while (i < this.weights.length && this.weights[i] === 0) {
                this.weights[i] = this.weights[this.weights.length - 1];
                this.values[i] = this.values[this.values.length - 1];
                this.weights.pop();
                this.values.pop();
            }
        }
        let it = 1, mx = 0;
        for (let i = 1; i < this.weights.length; i++)
            if (this.weights[i] > mx) { mx = this.weights[i]; it = i; }
        if (it < this.weights.length) {
            const tw = this.weights[it]; this.weights[it] = this.weights[this.weights.length - 1]; this.weights[this.weights.length - 1] = tw;
            const tv = this.values[it]; this.values[it] = this.values[this.values.length - 1]; this.values[this.values.length - 1] = tv;
        }
        if (this.weights.length < this.countCap && this.weights[0] === 0) {
            this.weights[0] = 1;
            this.weightTotal = (this.weightTotal + 1) & 0xFFFF;
        }
    }

    // Returns [newSlotIndex, value]. newSlotIndex >= 0 means a fresh slot whose
    // value the caller must decode and store; -1 means use the returned value.
    public tryDecode(dec: OodleDecoder): [number, number] {
        if (this.weightTotal >= this.threshRangeRebuild) {
            if (this.threshRangeRebuild >= this.threshWeightRebuild)
                this.rebuildWeights();
            this.rebuildRanges();
        }
        const value = dec.decode(0x4000);
        let rangeit = this.ranges.length - 1;
        for (let i = 0; i < this.ranges.length; i++) {
            if (this.ranges[i] > value) { rangeit = i; break; }
        }
        rangeit -= 1;
        if (rangeit < 0) rangeit = 0;
        dec.commit(0x4000, this.ranges[rangeit], this.ranges[rangeit + 1] - this.ranges[rangeit]);
        const index = rangeit;
        this.weights[index] = (this.weights[index] + 1) & 0xFFFF;
        this.weightTotal = (this.weightTotal + 1) & 0xFFFF;
        if (index > 0)
            return [-1, this.values[index]];
        if (this.weights.length >= this.ranges.length && dec.decodeCommit(2) === 1) {
            const idx = this.ranges.length + dec.decodeCommit(this.weights.length - this.ranges.length + 1) - 1;
            this.weights[idx] = (this.weights[idx] + 2) & 0xFFFF;
            this.weightTotal = (this.weightTotal + 2) & 0xFFFF;
            return [-1, this.values[idx]];
        }
        this.values.push(0);
        this.weights.push(2);
        this.weightTotal = (this.weightTotal + 2) & 0xFFFF;
        if (this.weights.length === this.countCap) {
            this.weightTotal = (this.weightTotal - this.weights[0]) & 0xFFFF;
            this.weights[0] = 0;
        }
        return [this.values.length - 1, 0];
    }

    public setValue(index: number, v: number): void {
        this.values[index] = v;
    }
}

// LZ dictionary for one decompression pass.
class OodleDictionary {
    private static readonly SIZES = [128, 192, 256, 512];
    private decodedSize = 0;
    private backrefSize = 0;
    private decodedValueMax: number;
    private backrefValueMax: number;
    private lowbitValueMax: number;
    private midbitValueMax: number;
    private highbitValueMax: number;
    private lowbit: WeighWindow;
    private highbit: WeighWindow;
    private midbit: WeighWindow[];
    private decoded: WeighWindow[];
    private sizeWindows: WeighWindow[];

    constructor(p: OodleParams) {
        this.decodedValueMax = p.decodedValueMax;
        this.backrefValueMax = p.backrefValueMax;
        this.lowbitValueMax = Math.min(this.backrefValueMax + 1, 4);
        this.midbitValueMax = Math.min(Math.floor(this.backrefValueMax / 4) + 1, 256);
        this.highbitValueMax = Math.floor(this.backrefValueMax / 1024) + 1;
        this.lowbit = new WeighWindow(this.lowbitValueMax - 1, this.lowbitValueMax);
        this.highbit = new WeighWindow(this.highbitValueMax - 1, p.highbitCount + 1);
        this.midbit = [];
        for (let i = 0; i < this.highbitValueMax; i++)
            this.midbit.push(new WeighWindow(this.midbitValueMax - 1, this.midbitValueMax));
        this.decoded = [];
        for (let i = 0; i < 4; i++)
            this.decoded.push(new WeighWindow(this.decodedValueMax - 1, p.decodedCount));
        this.sizeWindows = [];
        for (let i = 0; i < 4; i++)
            for (let j = 0; j < 16; j++)
                this.sizeWindows.push(new WeighWindow(64, p.sizesCount[3 - i]));
        this.sizeWindows.push(new WeighWindow(64, p.sizesCount[0]));
    }

    // Decodes one block into `out` at `outpos`; returns bytes written.
    public block(dec: OodleDecoder, out: Uint8Array, outpos: number): number {
        const sw = this.sizeWindows[this.backrefSize];
        let [d1i, d1v] = sw.tryDecode(dec);
        if (d1i >= 0) { d1v = dec.decodeCommit(65); sw.setValue(d1i, d1v); }
        this.backrefSize = d1v;

        if (this.backrefSize > 0) {
            const br = this.backrefSize < 61 ? this.backrefSize + 1 : OodleDictionary.SIZES[this.backrefSize - 61];
            const range = Math.min(this.backrefValueMax, this.decodedSize);

            let [d3i, d3v] = this.lowbit.tryDecode(dec);
            if (d3i >= 0) { d3v = dec.decodeCommit(this.lowbitValueMax); this.lowbit.setValue(d3i, d3v); }
            let [d4i, d4v] = this.highbit.tryDecode(dec);
            if (d4i >= 0) { d4v = dec.decodeCommit(Math.floor(range / 1024) + 1); this.highbit.setValue(d4i, d4v); }
            const mw = this.midbit[d4v];
            let [d5i, d5v] = mw.tryDecode(dec);
            if (d5i >= 0) { d5v = dec.decodeCommit(Math.min(Math.floor(range / 4) + 1, 256)); mw.setValue(d5i, d5v); }

            const backrefOffset = (d4v << 10) + (d5v << 2) + d3v + 1;
            this.decodedSize += br;
            const n = Math.min(br, out.length - outpos);
            for (let i = 0; i < n; i++)
                out[outpos + i] = out[outpos - backrefOffset + (i % backrefOffset)];
            return br;
        } else {
            const i = outpos % 4;
            const dw = this.decoded[i];
            let [d2i, d2v] = dw.tryDecode(dec);
            if (d2i >= 0) { d2v = dec.decodeCommit(this.decodedValueMax); dw.setValue(d2i, d2v); }
            out[outpos] = d2v & 0xff;
            this.decodedSize++;
            return 1;
        }
    }
}

function decompressOodle1(comp: Uint8Array, compLen: number, out: Uint8Array, outLen: number, stop0: number, stop1: number): void {
    if (compLen === 0)
        return;
    const cv = new DataView(comp.buffer, comp.byteOffset, comp.byteLength);
    const params: OodleParams[] = [];
    for (let i = 0; i < 3; i++) {
        const w0 = cv.getUint32(i * 12 + 0, true);
        const w1 = cv.getUint32(i * 12 + 4, true);
        params.push({
            decodedValueMax: w0 & 0x1FF,
            backrefValueMax: (w0 >>> 9) & 0x7FFFFF,
            decodedCount: w1 & 0x1FF,
            highbitCount: (w1 >>> 19) & 0x1FFF,
            sizesCount: [comp[i * 12 + 8], comp[i * 12 + 9], comp[i * 12 + 10], comp[i * 12 + 11]],
        });
    }
    const dec = new OodleDecoder(comp, 36);
    const steps = [stop0, stop1, outLen];
    let pos = 0;
    for (let i = 0; i < 3; i++) {
        const dict = new OodleDictionary(params[i]);
        while (pos < steps[i])
            pos += dict.block(dec, out, pos);
    }
}
