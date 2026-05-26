import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assertExists, readString } from "../util.js";

const enum GrannyType {
    None = 0,
    Inline = 1,
    Reference = 2,
    ReferenceToArray = 3,
    ArrayOfReferences = 4,
    VariantReference = 5,
    ReferenceToVariantArray = 7,
    String = 8,
    Transform = 9,
    Real32 = 10,
    Int8 = 11, UInt8 = 12, BinormalInt8 = 13, NormalUInt8 = 14,
    Int16 = 15, UInt16 = 16, BinormalInt16 = 17, NormalUInt16 = 18,
    Int32 = 19, UInt32 = 20,
    Real16 = 21,
    EmptyReference = 22,
}

const enum GrannyCompression {
    None = 0,
    Oodle0 = 1,
    Oodle1 = 2,
    BitKnit1 = 3,
    BitKnit2 = 4,
}

const TYPE_SCALAR_SIZE: { [k: number]: number } = {
    [GrannyType.Real32]: 4, [GrannyType.Int32]: 4, [GrannyType.UInt32]: 4,
    [GrannyType.Int16]: 2, [GrannyType.UInt16]: 2, [GrannyType.BinormalInt16]: 2, [GrannyType.NormalUInt16]: 2,
    [GrannyType.Real16]: 2,
    [GrannyType.Int8]: 1, [GrannyType.UInt8]: 1, [GrannyType.BinormalInt8]: 1, [GrannyType.NormalUInt8]: 1,
    [GrannyType.Transform]: 68,
};

const GRANNY_MAGIC = [0xb8, 0x67, 0xb0, 0xca, 0xf8, 0x6d, 0xb1, 0x0f, 0x84, 0x72, 0x8c, 0x7e, 0x5e, 0x19, 0x00, 0x1e];

interface GrannySection {
    compression: number;
    dataOffset: number;
    compressedSize: number;
    decompressedSize: number;
    alignment: number;
    oodleStop0: number;
    oodleStop1: number;
    fixupOffset: number;
    fixupCount: number;
    marshalOffset: number;
    marshalCount: number;
}

export interface GrannyFile {
    blob: Uint8Array;
    slice: ArrayBufferSlice;
    view: DataView;
    sectionBase: number[];
    fixups: Map<number, number>;
    typeAbs: number;
    rootAbs: number;
    version: number;
}

export function parseGranny(buffer: ArrayBufferSlice): GrannyFile {
    const view = buffer.createDataView();
    const bytes = buffer.createTypedArray(Uint8Array);

    if (view.byteLength < 0x60)
        throw new Error(`Granny: file too small (${view.byteLength} bytes)`);

    for (let i = 0; i < 16; i++)
        if (bytes[i] !== GRANNY_MAGIC[i])
            throw new Error(`Granny: bad magic`);

    const headerFormat = view.getUint32(0x14, true);
    if (headerFormat !== 0)
        throw new Error(`Granny: unsupported header format ${headerFormat}`);

    const version = view.getUint32(0x20, true);
    if (version !== 6 && version !== 7)
        throw new Error(`Granny: unsupported version ${version}`);
    const totalSize = view.getUint32(0x24, true);
    if (totalSize !== view.byteLength)
        throw new Error(`Granny: size mismatch (header ${totalSize}, file ${view.byteLength})`);

    const sectionArrayOffset = 0x20 + view.getUint32(0x2c, true);
    const sectionCount = view.getUint32(0x30, true);

    const typeSection = view.getUint32(0x34, true);
    const typeOffset = view.getUint32(0x38, true);
    const rootSection = view.getUint32(0x3c, true);
    const rootOffset = view.getUint32(0x40, true);

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

    let blobSize = 0;
    for (const s of sections)
        blobSize += s.decompressedSize;
    const blob = new Uint8Array(blobSize);
    const sectionBase: number[] = [];
    let cursor = 0;
    for (const s of sections) {
        sectionBase.push(cursor);
        if (s.decompressedSize === 0) {

        } else if (s.compression === GrannyCompression.None) {
            blob.set(bytes.subarray(s.dataOffset, s.dataOffset + s.decompressedSize), cursor);
        } else if (s.compression === GrannyCompression.Oodle1) {
            throw new Error(`Granny: Oodle1 compressed section unexpected; baked .gr2 should have all sections expanded to NoCompression by tools/gr2_decompress`);
        } else if (s.compression === GrannyCompression.Oodle0) {
            throw new Error(`Granny: Oodle0 compressed section unexpected; baked .gr2 should have all sections expanded to NoCompression by tools/gr2_decompress`);
        } else {
            throw new Error(`Granny: unsupported section compression ${s.compression}`);
        }
        cursor += s.decompressedSize;
    }

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

    }

    return {
        blob,
        slice: new ArrayBufferSlice(blob.buffer, blob.byteOffset, blob.byteLength),
        view: new DataView(blob.buffer, blob.byteOffset, blob.byteLength),
        sectionBase,
        fixups,
        typeAbs: sectionBase[typeSection] + typeOffset,
        rootAbs: sectionBase[rootSection] + rootOffset,
        version,
    };
}

interface GrannyMember {
    type: number;
    name: string | null;
    childTypeAbs: number | null;
    arraySize: number;
    ref?: number | null;
    variantTypeAbs?: number | null;
    count?: number;
    arrAbs?: number | null;
    str?: string | null;
    scalarAbs?: number;
}

const TYPE_NODE_SIZE = 32;

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
        const name = nameP === null ? null : readString(gr.slice, nameP);

        const m: GrannyMember = { type: ntype, name, childTypeAbs: childP, arraySize };

        switch (ntype) {
        case GrannyType.Reference:
        case GrannyType.EmptyReference:
            m.ref = ptr(d); d += 4;
            break;
        case GrannyType.String: {
            const sp = ptr(d);
            m.str = sp === null ? null : readString(gr.slice, sp);
            d += 4;
            break;
        }
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

interface GrannyVertexFormatField {
    name: string | null;
    type: number;
    count: number;
    byteSize: number;
    byteOffset: number;
}

export interface GrannyMesh {
    name: string | null;
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    boneWeights: Float32Array;
    boneIndices: Uint8Array;
    indices: Uint32Array;
    vertexCount: number;
    boneBindingNames: string[];
    textureIndex: number;
}

interface GrannyTextureImage {
    width: number;
    height: number;
    rgba: Uint8Array;
}

export interface GrannyBone {
    name: string | null;
    parentIndex: number;
    translation: [number, number, number];
    rotation: [number, number, number, number];
    scaleShear: Float32Array;
    inverseBindPose: Float32Array;
}

export interface GrannySkeleton {
    name: string | null;
    bones: GrannyBone[];
}

export interface GrannyCurve {
    degree: number;
    dimension: number;
    knots: Float32Array;
    controls: Float32Array;
}

export interface GrannyTransformTrack {
    boneName: string | null;
    position: GrannyCurve | null;
    orientation: GrannyCurve | null;
    scaleShear: GrannyCurve | null;
}

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
    textures: (GrannyTextureImage | null)[];
}

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
        const name = nameP === undefined ? null : readString(gr.slice, nameP);
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

function readVertexFloats(view: DataView, base: number, field: GrannyVertexFormatField, out: Float32Array, outOff: number, n: number): void {
    for (let i = 0; i < n; i++) {
        if (i < field.count && field.type === GrannyType.Real32)
            out[outOff + i] = view.getFloat32(base + field.byteOffset + i * 4, true);
        else
            out[outOff + i] = 0;
    }
}

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

    const fPos = assertExists(fields.find((f) => f.name === "Position"), "Position field on mesh vertex layout");
    const fNrm = fields.find((f) => f.name === "Normal");
    const fUV = fields.find((f) => f.name === "TextureCoordinates0" || f.name === "TextureCoordinates");
    const fBoneW = fields.find((f) => f.name === "BoneWeights");
    const fBoneI = fields.find((f) => f.name === "BoneIndices");

    for (let v = 0; v < vertexCount; v++) {
        const base = arr + v * stride;
        readVertexFloats(view, base, fPos, positions, v * 3, 3);
        if (fNrm !== undefined) readVertexFloats(view, base, fNrm, normals, v * 3, 3);
        if (fUV !== undefined) readVertexFloats(view, base, fUV, uvs, v * 2, 2);
        if (fBoneW !== undefined) {
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

function extractTexture(gr: GrannyFile, texTypeAbs: number, texDataAbs: number): GrannyTextureImage | null {
    const { view } = gr;
    const tw = walkType(gr, texTypeAbs, texDataAbs);
    const scI = (m: GrannyMember | undefined): number | undefined =>
        m?.scalarAbs !== undefined ? view.getInt32(m.scalarAbs, true) : undefined;
    const width = scI(tw.get("Width"));
    const height = scI(tw.get("Height"));
    if (width === undefined || height === undefined || width <= 0 || height <= 0)
        return null;

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

    const images = tw.get("Images");
    if (images === undefined || images.arrAbs === null || images.arrAbs === undefined || !images.count || images.childTypeAbs === null)
        return null;
    const iw = walkType(gr, images.childTypeAbs, images.arrAbs);
    const mips = iw.get("MIPLevels");
    if (mips === undefined || mips.arrAbs === null || mips.arrAbs === undefined || !mips.count || mips.childTypeAbs === null)
        return null;
    const mw = walkType(gr, mips.childTypeAbs, mips.arrAbs);
    const pixels = mw.get("Pixels") ?? mw.get("PixelBytes");
    if (pixels === undefined || pixels.arrAbs === null || pixels.arrAbs === undefined || !pixels.count)
        return null;
    const strideField = scI(mw.get("Stride"));
    const rowStride = strideField && strideField > 0 ? strideField : width * bytesPerPixel;

    if (pixels.count < width * height * bytesPerPixel)
        return null;

    const src = gr.blob;
    const srcBase = pixels.arrAbs;
    const rgba = new Uint8Array(width * height * 4);
    const direct = bytesPerPixel === 4 && bits[0] === 8 && bits[1] === 8 && bits[2] === 8 &&
        shifts[0] === 0 && shifts[1] === 8 && shifts[2] === 16;
    for (let y = 0; y < height; y++) {
        const rowOff = srcBase + y * rowStride;
        if (direct) {
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

export function extractGrannyModel(gr: GrannyFile): GrannyModelData {
    const top = walkType(gr, gr.typeAbs, gr.rootAbs);

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

                const o = tr.scalarAbs;
                translation = [view.getFloat32(o + 4, true), view.getFloat32(o + 8, true), view.getFloat32(o + 12, true)];
                rotation = [view.getFloat32(o + 16, true), view.getFloat32(o + 20, true), view.getFloat32(o + 24, true), view.getFloat32(o + 28, true)];
                for (let k = 0; k < 9; k++)
                    scaleShear[k] = view.getFloat32(o + 32 + k * 4, true);
            }

            const inverseBindPose = new Float32Array(16);
            const iw = bw.get("InverseWorldTransform");
            if (iw !== undefined && iw.scalarAbs !== undefined) {
                for (let j = 0; j < 16; j++)
                    inverseBindPose[j] = view.getFloat32(iw.scalarAbs + j * 4, true);
            } else {
                inverseBindPose[0] = inverseBindPose[5] = inverseBindPose[10] = inverseBindPose[15] = 1;
            }
            bones.push({ name: bn, parentIndex, translation, rotation, scaleShear, inverseBindPose });
        }
    }
    return { name, bones };
}

function extractCurve(gr: GrannyFile, curveTypeAbs: number, curveDataAbs: number, dimension: number): GrannyCurve | null {
    const { view } = gr;
    const cw = walkType(gr, curveTypeAbs, curveDataAbs);
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
