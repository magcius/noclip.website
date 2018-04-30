
// Implements Nintendo's J3D formats (BMD, BDL, BTK, etc.)

import { mat4, quat } from 'gl-matrix';

import ArrayBufferSlice from 'ArrayBufferSlice';
import { betoh } from 'endian';
import { assert, readString } from 'util';

import { coalesceLoadedDatas, compileVtxLoader, getComponentSize, getNumComponents, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData } from 'gx/gx_displaylist';
import * as GX from 'gx/gx_enum';
import * as GX_Material from 'gx/gx_material';

function readStringTable(buffer: ArrayBufferSlice, offs: number): string[] {
    const view = buffer.createDataView(offs);
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

//#region INF1
export enum HierarchyType {
    End = 0x00,
    Open = 0x01,
    Close = 0x02,
    Joint = 0x10,
    Material = 0x11,
    Shape = 0x12,
}

// Build the scene graph.
export interface HierarchyRootNode {
    type: HierarchyType.End;
    children: HierarchyNode[];
}
export interface HierarchyShapeNode {
    type: HierarchyType.Shape;
    children: HierarchyNode[];
    shapeIdx: number;
}
export interface HierarchyJointNode {
    type: HierarchyType.Joint;
    children: HierarchyNode[];
    jointIdx: number;
}
export interface HierarchyMaterialNode {
    type: HierarchyType.Material;
    children: HierarchyNode[];
    materialIdx: number;
}
export type HierarchyNode = HierarchyRootNode | HierarchyShapeNode | HierarchyJointNode | HierarchyMaterialNode;

export interface INF1 {
    sceneGraph: HierarchyNode;
}

function readINF1Chunk(buffer: ArrayBufferSlice): INF1 {
    const view = buffer.createDataView();
    // unk
    const packetCount = view.getUint32(0x0C);
    const vertexCount = view.getUint32(0x10);
    const hierarchyOffs = view.getUint32(0x14);

    let node: HierarchyNode = { type: HierarchyType.End, children: [] };
    const parentStack: HierarchyNode[] = [node];
    let offs = hierarchyOffs;

    outer:
    while (true) {
        const type: HierarchyType = view.getUint16(offs + 0x00);
        const value: number = view.getUint16(offs + 0x02);

        offs += 0x04;
        switch (type) {
        case HierarchyType.End:
            break outer;
        case HierarchyType.Open:
            parentStack.unshift(node);
            break;
        case HierarchyType.Close:
            node = parentStack.shift();
            break;
        case HierarchyType.Joint:
            node = { type, children: [], jointIdx: value };
            parentStack[0].children.unshift(node);
            break;
        case HierarchyType.Material:
            node = { type, children: [], materialIdx: value };
            parentStack[0].children.unshift(node);
            break;
        case HierarchyType.Shape:
            node = { type, children: [], shapeIdx: value };
            parentStack[0].children.unshift(node);
            break;
        }
    }

    assert(parentStack.length === 1);
    return { sceneGraph: parentStack.pop() };
}
//#endregion

//#region VTX1
export interface VertexArray {
    vtxAttrib: GX.VertexAttribute;
    compType: GX.CompType;
    compCnt: GX.CompCnt;
    compCount: number;
    scale: number;
    buffer: ArrayBufferSlice;
    dataOffs: number;
    dataSize: number;
}

export interface VTX1 {
    vertexArrays: Map<GX.VertexAttribute, VertexArray>;
}

function readVTX1Chunk(buffer: ArrayBufferSlice): VTX1 {
    const view = buffer.createDataView();
    const formatOffs = view.getUint32(0x08);
    const dataOffsLookupTable = 0x0C;

    // Data tables are stored in this order. Assumed to be hardcoded in a
    // struct somewhere inside JSystem.
    const dataTables = [
        GX.VertexAttribute.POS,
        GX.VertexAttribute.NRM,
        GX.VertexAttribute.NBT,
        GX.VertexAttribute.CLR0,
        GX.VertexAttribute.CLR1,
        GX.VertexAttribute.TEX0,
        GX.VertexAttribute.TEX1,
        GX.VertexAttribute.TEX2,
        GX.VertexAttribute.TEX3,
        GX.VertexAttribute.TEX4,
        GX.VertexAttribute.TEX5,
        GX.VertexAttribute.TEX6,
        GX.VertexAttribute.TEX7,
    ];

    let offs = formatOffs;
    const vertexArrays = new Map<GX.VertexAttribute, VertexArray>();
    while (true) {
        const vtxAttrib: GX.VertexAttribute = view.getUint32(offs + 0x00);
        if (vtxAttrib === GX.VertexAttribute.NULL)
            break;

        const compCnt: GX.CompCnt = view.getUint32(offs + 0x04);
        const compType: GX.CompType = view.getUint32(offs + 0x08);
        const decimalPoint: number = view.getUint8(offs + 0x0C);
        const scale = Math.pow(0.5, decimalPoint);
        offs += 0x10;

        const formatIdx = dataTables.indexOf(vtxAttrib);
        if (formatIdx < 0)
            continue;

        // Each attrib in the VTX1 chunk also has a corresponding data chunk containing
        // the data for that attribute, in the format stored above.

        // BMD doesn't tell us how big each data chunk is, but we need to know to figure
        // out how much data to upload. We assume the data offset lookup table is sorted
        // in order, and can figure it out by finding the next offset above us.
        const dataOffsLookupTableEntry: number = dataOffsLookupTable + formatIdx*0x04;
        const dataOffsLookupTableEnd: number = dataOffsLookupTable + dataTables.length*0x04;
        const dataStart: number = view.getUint32(dataOffsLookupTableEntry);
        const dataEnd: number = getDataEnd(dataOffsLookupTableEntry, dataOffsLookupTableEnd);
        const dataOffs: number = dataStart;
        const dataSize: number = dataEnd - dataStart;
        const compSize = getComponentSize(compType);
        const compCount = getNumComponents(vtxAttrib, compCnt);
        const vtxDataBuffer = betoh(buffer.subarray(dataOffs, dataSize), compSize);
        const vertexArray: VertexArray = { vtxAttrib, compType, compCount, compCnt, scale, dataOffs, dataSize, buffer: vtxDataBuffer };
        vertexArrays.set(vtxAttrib, vertexArray);
    }

    function getDataEnd(dataOffsLookupTableEntry: number, dataOffsLookupTableEnd: number): number {
        let offs = dataOffsLookupTableEntry + 0x04;
        while (offs < dataOffsLookupTableEnd) {
            const dataOffs = view.getUint32(offs);
            if (dataOffs !== 0)
                return dataOffs;
            offs += 0x04;
        }
        return buffer.byteLength;
    }

    return { vertexArrays };
}
//#endregion

//#region EVP1
interface WeightedBone {
    weight: number;
    index: number;
}

interface Envelope {
    weightedBones: WeightedBone[];
}

export interface EVP1 {
    envelopes: Envelope[];
    inverseBinds: mat4[];
}

function readEVP1Chunk(buffer: ArrayBufferSlice): EVP1 {
    const view = buffer.createDataView();

    const envelopeTableCount = view.getUint16(0x08);
    const weightedBoneCountTableOffs = view.getUint32(0x0C);
    const weightedBoneIndexTableOffs = view.getUint32(0x10);
    const weightedBoneWeightTableOffs = view.getUint32(0x14);
    const inverseBindPoseTableOffs = view.getUint32(0x18);

    let weightedBoneId = 0;
    let maxBoneIndex = -1;
    const envelopes: Envelope[] = [];
    for (let i = 0; i < envelopeTableCount; i++) {
        const numWeightedBones = view.getUint8(weightedBoneCountTableOffs + i);
        const weightedBones: WeightedBone[] = [];

        for (let j = 0; j < numWeightedBones; j++) {
            const index = view.getUint16(weightedBoneIndexTableOffs + weightedBoneId * 0x02);
            const weight = view.getFloat32(weightedBoneWeightTableOffs + weightedBoneId * 0x04);
            weightedBones.push({ index, weight });
            maxBoneIndex = Math.max(maxBoneIndex, index);
            weightedBoneId++;
        }

        envelopes.push({ weightedBones });
    }

    const inverseBinds: mat4[] = [];
    for (let i = 0; i < maxBoneIndex + 1; i++) {
        const offs = inverseBindPoseTableOffs + (i * 0x30);

        const m00 = view.getFloat32(offs + 0x00);
        const m10 = view.getFloat32(offs + 0x04);
        const m20 = view.getFloat32(offs + 0x08);
        const m30 = view.getFloat32(offs + 0x0C);
        const m01 = view.getFloat32(offs + 0x10);
        const m11 = view.getFloat32(offs + 0x14);
        const m21 = view.getFloat32(offs + 0x18);
        const m31 = view.getFloat32(offs + 0x1C);
        const m02 = view.getFloat32(offs + 0x20);
        const m12 = view.getFloat32(offs + 0x24);
        const m22 = view.getFloat32(offs + 0x28);
        const m32 = view.getFloat32(offs + 0x2C);

        inverseBinds.push(mat4.fromValues(
            m00, m01, m02, 0,
            m10, m11, m12, 0,
            m20, m21, m22, 0,
            m30, m31, m32, 1,
        ));
    }

    return { envelopes, inverseBinds };
}
//#endregion

//#region DRW1
export enum DRW1JointKind {
    NormalJoint = 0x00,
    WeightedJoint = 0x01,
}

interface DRW1NormalJoint {
    kind: DRW1JointKind.NormalJoint;
    jointIndex: number;
}

interface DRW1WeightedJoint {
    kind: DRW1JointKind.WeightedJoint;
    envelopeIndex: number;
}

type DRW1Joint = DRW1NormalJoint | DRW1WeightedJoint;

export interface DRW1 {
    drw1Joints: DRW1Joint[];
}

function readDRW1Chunk(buffer: ArrayBufferSlice): DRW1 {
    const view = buffer.createDataView();
    const weightedJointCount = view.getUint16(0x08);
    const isWeightedTableOffs = view.getUint32(0x0C);
    const jointIndexTableOffs = view.getUint32(0x10);

    const drw1Joints: DRW1Joint[] = [];
    for (let i = 0; i < weightedJointCount; i++) {
        const kind: DRW1JointKind = view.getUint8(isWeightedTableOffs + i);
        const param = view.getUint16(jointIndexTableOffs + i * 0x02);
        if (kind === DRW1JointKind.NormalJoint) {
            drw1Joints.push({ kind, jointIndex: param });
        } else if (kind === DRW1JointKind.WeightedJoint) {
            drw1Joints.push({ kind, envelopeIndex: param })
        }
    }

    return { drw1Joints };
}
//#endregion

//#region JNT1
export interface Bone {
    name: string;
    matrix: mat4;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
}

export interface JNT1 {
    remapTable: number[];
    bones: Bone[];
}

const quatScratch = quat.create();
function createJointMatrix(m: mat4, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number, tx: number, ty: number, tz: number): void {
    quat.fromEuler(quatScratch, rx, ry, rz);
    mat4.fromRotationTranslationScale(m, quatScratch, [tx, ty, tz], [sx, sy, sz]);
}

function readJNT1Chunk(buffer: ArrayBufferSlice): JNT1 {
    const view = buffer.createDataView();

    const boneDataCount = view.getUint16(0x08);
    assert(view.getUint16(0x0A) === 0xFFFF);

    const boneDataTableOffs = view.getUint32(0x0C);
    const remapTableOffs = view.getUint32(0x10);

    const remapTable: number[] = [];
    for (let i = 0; i < boneDataCount; i++)
        remapTable[i] = view.getUint16(remapTableOffs + i * 0x02);

    const nameTableOffs = view.getUint32(0x14);
    const nameTable = readStringTable(buffer, nameTableOffs);

    const bones: Bone[] = [];
    let boneDataTableIdx = boneDataTableOffs;
    for (let i = 0; i < boneDataCount; i++) {
        const name = nameTable[i];
        const scaleX = view.getFloat32(boneDataTableIdx + 0x04);
        const scaleY = view.getFloat32(boneDataTableIdx + 0x08);
        const scaleZ = view.getFloat32(boneDataTableIdx + 0x0C);
        const rotationX = view.getInt16(boneDataTableIdx + 0x10) / 0x7FFF * 180;
        const rotationY = view.getInt16(boneDataTableIdx + 0x12) / 0x7FFF * 180;
        const rotationZ = view.getInt16(boneDataTableIdx + 0x14) / 0x7FFF * 180;
        const translationX = view.getFloat32(boneDataTableIdx + 0x18);
        const translationY = view.getFloat32(boneDataTableIdx + 0x1C);
        const translationZ = view.getFloat32(boneDataTableIdx + 0x20);
        // Skipping bounding box data for now.

        const matrix = mat4.create();
        createJointMatrix(matrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        bones.push({ name, matrix, scaleX, scaleY, scaleZ });
        boneDataTableIdx += 0x40;
    }

    return { remapTable, bones };
}
//#endregion

//#region SHP1
// Describes an individual vertex attribute in the packed data.
export interface PackedVertexAttribute {
    vtxAttrib: GX.VertexAttribute;
    indexDataType: GX.AttrType;
    offset: number;
}

// A packet is a series of draw calls that use the same matrix table.
interface Packet {
    weightedJointTable: Uint16Array;
    firstTriangle: number;
    numTriangles: number;
}

export const enum ShapeDisplayFlags {
    NORMAL = 0,
    BILLBOARD = 1,
    Y_BILLBOARD = 2,
    USE_PNMTXIDX = 3,
}

export interface Shape {
    displayFlags: ShapeDisplayFlags;
    indexData: ArrayBufferSlice;
    // The vertex data. Converted to a modern-esque buffer per-shape.
    packedData: ArrayBufferSlice;
    // The size of an individual vertex.
    packedVertexSize: number;
    packedVertexAttributes: PackedVertexAttribute[];
    packets: Packet[];
}

export interface SHP1 {
    vattrs: GX_VtxAttrFmt[];
    shapes: Shape[];
}

function readIndex(view: DataView, offs: number, type: GX.AttrType) {
    switch (type) {
    case GX.AttrType.INDEX8:
        return view.getUint8(offs);
    case GX.AttrType.INDEX16:
        return view.getUint16(offs);
    default:
        throw new Error(`Unknown index data type ${type}!`);
    }
}

function readSHP1Chunk(buffer: ArrayBufferSlice, bmd: BMD): SHP1 {
    const view = buffer.createDataView();
    const shapeCount = view.getUint16(0x08);
    const shapeTableOffs = view.getUint32(0x0C);
    const attribTableOffs = view.getUint32(0x18);
    const matrixTableOffs = view.getUint32(0x1C);
    const primDataOffs = view.getUint32(0x20);
    const matrixDataOffs = view.getUint32(0x24);
    const packetTableOffs = view.getUint32(0x28);

    // We have a number of "shapes". Each shape has a number of vertex attributes
    // (e.g. pos, nrm, txc) and a list of packets. Each packet has a list of draw
    // calls, and each draw call has a list of indices into *each* of the vertex
    // arrays, one per vertex.
    //
    // Instead of one global index per draw call like OGL and some amount of packed
    // vertex data, the GX instead allows specifying separate indices per attribute.
    // So you can have POS's indexes be 0 1 2 3 and NRM's indexes be 0 0 0 0.
    //
    // What we end up doing is similar to what Dolphin does with its vertex loader
    // JIT. We construct buffers for each of the components that are shape-specific.

    // Build vattrs for VTX1.
    const vattrs: GX_VtxAttrFmt[] = [];
    const vtxArrays: GX_Array[] = [];

    // Hardcoded by the J3D engine.
    for (let i = GX.VertexAttribute.PNMTXIDX; i < GX.VertexAttribute.TEX7MTXIDX; i++) {
        vattrs[i] = { compCnt: 1, compType: GX.CompType.U8 };
    }

    for (const [attr, vertexArray] of bmd.vtx1.vertexArrays.entries()) {
        vattrs[attr] = { compCnt: vertexArray.compCnt, compType: vertexArray.compType };
        vtxArrays[attr] = { buffer: vertexArray.buffer, offs: 0 };
    }

    const shapes: Shape[] = [];
    let shapeIdx = shapeTableOffs;
    for (let i = 0; i < shapeCount; i++) {
        const displayFlags = view.getUint8(shapeIdx + 0x00);
        assert(view.getUint8(shapeIdx + 0x01) == 0xFF);
        const packetCount = view.getUint16(shapeIdx + 0x02);
        const attribOffs = view.getUint16(shapeIdx + 0x04);
        const firstMatrix = view.getUint16(shapeIdx + 0x06);
        const firstPacket = view.getUint16(shapeIdx + 0x08);

        const vtxDescs: GX_VtxDesc[] = [];

        let attribIdx = attribTableOffs + attribOffs;
        while (true) {
            const vtxAttrib: GX.VertexAttribute = view.getUint32(attribIdx + 0x00);
            if (vtxAttrib === GX.VertexAttribute.NULL)
                break;
            const indexDataType: GX.AttrType = view.getUint32(attribIdx + 0x04);
            vtxDescs[vtxAttrib] = { type: indexDataType };
            attribIdx += 0x08;
        }

        const vtxLoader = compileVtxLoader(vattrs, vtxDescs);

        const packedVertexAttributes: PackedVertexAttribute[] = [];
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < vtxLoader.vattrLayout.dstAttrOffsets.length; vtxAttrib++) {
            if (!vtxDescs[vtxAttrib])
                continue;
            const indexDataType = vtxDescs[vtxAttrib].type;
            const offset = vtxLoader.vattrLayout.dstAttrOffsets[vtxAttrib];
            packedVertexAttributes.push({ vtxAttrib, indexDataType, offset });
        }
        const packedVertexSize = vtxLoader.vattrLayout.dstVertexSize;

        // Now parse out the packets.
        let packetIdx = packetTableOffs + (firstPacket * 0x08);
        const packets: Packet[] = [];

        const loadedDatas: LoadedVertexData[] = [];

        let totalTriangleCount = 0;
        for (let j = 0; j < packetCount; j++) {
            const packetSize = view.getUint32(packetIdx + 0x00);
            const packetStart = primDataOffs + view.getUint32(packetIdx + 0x04);

            const packetMatrixDataOffs = matrixDataOffs + (firstMatrix + j) * 0x08;
            const matrixCount = view.getUint16(packetMatrixDataOffs + 0x02);
            const matrixFirstIndex = view.getUint32(packetMatrixDataOffs + 0x04);

            const packetMatrixTableOffs = matrixTableOffs + matrixFirstIndex * 0x02;
            const packetMatrixTableSize = matrixCount * 0x02;
            const weightedJointTable = betoh(buffer.subarray(packetMatrixTableOffs, packetMatrixTableSize), 2).createTypedArray(Uint16Array);

            const srcOffs = packetStart;
            const subBuffer = buffer.subarray(srcOffs, packetSize);
            const loadedSubData = vtxLoader.runVertices(vtxArrays, subBuffer);
            loadedDatas.push(loadedSubData);

            const firstTriangle = totalTriangleCount;
            const numTriangles = loadedSubData.totalTriangleCount;
            totalTriangleCount += numTriangles;

            packets.push({ weightedJointTable, firstTriangle, numTriangles });
            packetIdx += 0x08;
        }

        // Coalesce shape data.
        const loadedData = coalesceLoadedDatas(loadedDatas);
        const indexData = new ArrayBufferSlice(loadedData.indexData.buffer);
        const packedData = new ArrayBufferSlice(loadedData.packedVertexData.buffer);

        // Now we should have a complete shape. Onto the next!
        shapes.push({ displayFlags, indexData, packedData, packedVertexSize, packedVertexAttributes, packets });

        shapeIdx += 0x28;
    }

    return { vattrs, shapes };
}
//#endregion

//#region MAT3
export const enum TexMtxProjection {
    ST = 0,
    STQ = 1,
}

export interface TexMtx {
    type: number;
    projection: TexMtxProjection;
    projectionMatrix: mat4;
    matrix: mat4;
}

export interface MaterialEntry {
    index: number;
    name: string;
    translucent: boolean;
    textureIndexes: number[];
    gxMaterial: GX_Material.GXMaterial;
    texMatrices: TexMtx[];
    postTexMatrices: TexMtx[];
    indTexMatrices: Float32Array[];
    colorMatRegs: GX_Material.Color[];
    colorAmbRegs: GX_Material.Color[];
}

export interface MAT3 {
    remapTable: number[];
    materialEntries: MaterialEntry[];
}

// temp, center, center inverse
const t = mat4.create(), c = mat4.create(), ci = mat4.create();
function createTexMtx(m: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number, centerS: number, centerT: number, centerQ: number) {
    // TODO(jstpierre): Remove these.
    mat4.fromTranslation(c, [centerS, centerT, centerQ]);
    mat4.fromTranslation(ci, [-centerS, -centerT, -centerQ]);
    mat4.fromTranslation(m, [translationS, translationT, 0]);
    mat4.fromScaling(t, [scaleS, scaleT, 1]);
    mat4.rotateZ(t, t, rotation * Math.PI);
    mat4.mul(t, t, ci);
    mat4.mul(t, c, t);
    mat4.mul(m, m, t);
    return m;
}

function readColor32(view: DataView, srcOffs: number): GX_Material.Color {
    const r = view.getUint8(srcOffs + 0x00) / 255;
    const g = view.getUint8(srcOffs + 0x01) / 255;
    const b = view.getUint8(srcOffs + 0x02) / 255;
    const a = view.getUint8(srcOffs + 0x03) / 255;
    return new GX_Material.Color(r, g, b, a);
}

function readColorShort(view: DataView, srcOffs: number): GX_Material.Color {
    const r = view.getInt16(srcOffs + 0x00) / 255;
    const g = view.getInt16(srcOffs + 0x02) / 255;
    const b = view.getInt16(srcOffs + 0x04) / 255;
    const a = view.getInt16(srcOffs + 0x06) / 255;
    return new GX_Material.Color(r, g, b, a);
}

function readMAT3Chunk(buffer: ArrayBufferSlice): MAT3 {
    const view = buffer.createDataView();
    const materialCount = view.getUint16(0x08);

    const remapTableOffs = view.getUint32(0x10);
    const remapTable: number[] = [];
    for (let i = 0; i < materialCount; i++)
        remapTable[i] = view.getUint16(remapTableOffs + i * 0x02);

    const maxIndex = Math.max.apply(null, remapTable);

    const nameTableOffs = view.getUint32(0x14);
    const nameTable = readStringTable(buffer, nameTableOffs);

    const indirectTableOffset = view.getUint32(0x18);
    const cullModeTableOffs = view.getUint32(0x1C);
    const materialColorTableOffs = view.getUint32(0x20);
    const colorChanCountTableOffs = view.getUint32(0x24);
    const colorChanTableOffs = view.getUint32(0x28);
    const ambientColorTableOffs = view.getUint32(0x2C);
    const texGenTableOffs = view.getUint32(0x38);
    const postTexGenTableOffs = view.getUint32(0x3C);
    const textureTableOffs = view.getUint32(0x48);
    const texMtxTableOffs = view.getUint32(0x40);
    const postTexMtxTableOffs = view.getUint32(0x44);
    const tevOrderTableOffs = view.getUint32(0x4C);
    const colorRegisterTableOffs = view.getUint32(0x50);
    const colorConstantTableOffs = view.getUint32(0x54);
    const tevStageTableOffs = view.getUint32(0x5C);
    const alphaTestTableOffs = view.getUint32(0x6C);
    const blendModeTableOffs = view.getUint32(0x70);
    const depthModeTableOffs = view.getUint32(0x74);

    const materialEntries: MaterialEntry[] = [];
    let materialEntryIdx = view.getUint32(0x0C);
    for (let i = 0; i <= maxIndex; i++) {
        const index = i;
        const name = nameTable[i];
        const flags = view.getUint8(materialEntryIdx + 0x00);
        const cullModeIndex = view.getUint8(materialEntryIdx + 0x01);
        const colorChanCountIndex = view.getUint8(materialEntryIdx + 0x02);
        const texGenCountIndex = view.getUint8(materialEntryIdx + 0x03);
        const tevCountIndex = view.getUint8(materialEntryIdx + 0x04);
        // unk
        const depthModeIndex = view.getUint8(materialEntryIdx + 0x06);
        // unk

        const colorMatRegs: GX_Material.Color[] = [null, null];
        for (let j = 0; j < 2; j++) {
            const matColorIndex = view.getUint16(materialEntryIdx + 0x08 + j * 0x02);
            const matColorOffs = materialColorTableOffs + matColorIndex * 0x04;
            const matColorReg = readColor32(view, matColorOffs);
            colorMatRegs[j] = matColorReg;
        }

        const colorAmbRegs: GX_Material.Color[] = [null, null];
        for (let j = 0; j < 2; j++) {
            const ambColorIndex = view.getUint16(materialEntryIdx + 0x14 + j * 0x02);
            const ambColorOffs = ambientColorTableOffs + ambColorIndex * 0x04;
            const ambColorReg = readColor32(view, ambColorOffs);
            colorAmbRegs[j] = ambColorReg;
        }

        const lightChannelCount = view.getUint8(colorChanCountTableOffs + colorChanCountIndex);
        const lightChannels: GX_Material.LightChannelControl[] = [];
        for (let j = 0; j < lightChannelCount; j++) {
            const colorChannelIndex = view.getInt16(materialEntryIdx + 0x0C + ((j * 2 + 0) * 0x02));
            const colorChannel = readColorChannel(colorChanTableOffs, colorChannelIndex);
            const alphaChannelIndex = view.getInt16(materialEntryIdx + 0x0C + ((j * 2 + 1) * 0x02));
            const alphaChannel = readColorChannel(colorChanTableOffs, alphaChannelIndex);
            lightChannels.push({ colorChannel, alphaChannel });
        }

        const texGens: GX_Material.TexGen[] = [];
        for (let j = 0; j < 8; j++) {
            const texGenIndex = view.getInt16(materialEntryIdx + 0x28 + j * 0x02);
            if (texGenIndex < 0)
                continue;
            const index = j;
            const type: GX.TexGenType = view.getUint8(texGenTableOffs + texGenIndex * 0x04 + 0x00);
            const source: GX.TexGenSrc = view.getUint8(texGenTableOffs + texGenIndex * 0x04 + 0x01);
            const matrix: GX.TexGenMatrix = view.getUint8(texGenTableOffs + texGenIndex * 0x04 + 0x02);
            assert(view.getUint8(texGenTableOffs + texGenIndex * 0x04 + 0x03) === 0xFF);
            let postMatrix: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY;
            const postTexGenIndex = view.getInt16(materialEntryIdx + 0x38 + j * 0x02);
            if (postTexGenTableOffs > 0 && postTexGenIndex >= 0) {
                postMatrix = view.getUint8(postTexGenTableOffs + texGenIndex * 0x04 + 0x02);
                assert(view.getUint8(postTexGenTableOffs + postTexGenIndex * 0x04 + 0x03) === 0xFF);
            }
            const normalize = false;
            const texGen: GX_Material.TexGen = { index, type, source, matrix, normalize, postMatrix };
            texGens.push(texGen);
        }

        const texMatrices: TexMtx[] = [];
        for (let j = 0; j < 10; j++) {
            texMatrices[j] = null;
            const texMtxIndex = view.getInt16(materialEntryIdx + 0x48 + j * 0x02);
            if (texMtxIndex < 0)
                continue;
            texMatrices[j] = readTexMatrix(texMtxTableOffs, j, texMtxIndex);
        }

        const postTexMatrices: TexMtx[] = [];
        for (let j = 0; j < 20; j++) {
            postTexMatrices[j] = null;
            const postTexMtxIndex = view.getInt16(materialEntryIdx + 0x5C + j * 0x02);
            if (postTexMtxIndex < 0)
                continue;
            postTexMatrices[j] = readTexMatrix(postTexMtxTableOffs, j, postTexMtxIndex);
        }

        const colorConstants: GX_Material.Color[] = [];
        for (let j = 0; j < 4; j++) {
            const colorIndex = view.getUint16(materialEntryIdx + 0x94 + j * 0x02);
            const color = readColor32(view, colorConstantTableOffs + colorIndex * 0x04);
            colorConstants.push(color);
        }

        const colorRegisters: GX_Material.Color[] = [];
        for (let j = 0; j < 4; j++) {
            const colorIndex = view.getUint16(materialEntryIdx + 0xDC + j * 0x02);
            const color = readColorShort(view, colorRegisterTableOffs + colorIndex * 0x08);
            colorRegisters.push(color);
        }

        let textureIndexTableIdx = materialEntryIdx + 0x84;
        const textureIndexes = [];
        for (let j = 0; j < 8; j++) {
            const textureTableIndex = view.getInt16(textureIndexTableIdx);
            if (textureTableIndex >= 0) {
                const textureIndex = view.getUint16(textureTableOffs + textureTableIndex * 0x02);
                textureIndexes.push(textureIndex);
            } else {
                textureIndexes.push(-1);
            }
            textureIndexTableIdx += 0x02;
        }

        const indirectEntryOffs = indirectTableOffset + i * 0x138;
        const indirectStageCount = view.getUint8(indirectEntryOffs + 0x00);
        assert(indirectStageCount <= 4);

        const indTexStages: GX_Material.IndTexStage[] = [];
        for (let j = 0; j < indirectStageCount; j++) {
            const index = j;
            // SetIndTexOrder
            const indTexOrderOffs = indirectEntryOffs + 0x04 + j * 0x04;
            const texCoordId: GX.TexCoordID = view.getUint8(indTexOrderOffs + 0x00);
            const texture: GX.TexMapID = view.getUint8(indTexOrderOffs + 0x01);
            // SetIndTexCoordScale
            const indTexScaleOffs = indirectEntryOffs + 0x04 + (0x04 * 4) + (0x1C * 3) + j * 0x04;
            const scaleS: GX.IndTexScale = view.getUint8(indTexScaleOffs + 0x00);
            const scaleT: GX.IndTexScale = view.getUint8(indTexScaleOffs + 0x01);
            indTexStages.push({ index, texCoordId, texture, scaleS, scaleT });
        }

        // SetIndTexMatrix
        const indTexMatrices: Float32Array[] = [];
        for (let j = 0; j < 3; j++) {
            const indTexMatrixOffs = indirectEntryOffs + 0x04 + (0x04 * 4) + j * 0x1C;
            const p00 = view.getFloat32(indTexMatrixOffs + 0x00);
            const p01 = view.getFloat32(indTexMatrixOffs + 0x04);
            const p02 = view.getFloat32(indTexMatrixOffs + 0x08);
            const p10 = view.getFloat32(indTexMatrixOffs + 0x0C);
            const p11 = view.getFloat32(indTexMatrixOffs + 0x10);
            const p12 = view.getFloat32(indTexMatrixOffs + 0x14);
            const scale = Math.pow(2, view.getInt8(indTexMatrixOffs + 0x18));
            const m = new Float32Array([
                p00*scale, p01*scale, p02*scale,
                p10*scale, p11*scale, p12*scale,
            ]);
            indTexMatrices.push(m);
        }

        const tevStages: GX_Material.TevStage[] = [];
        for (let j = 0; j < 16; j++) {
            // TevStage
            const tevStageIndex = view.getInt16(materialEntryIdx + 0xE4 + j * 0x02);
            if (tevStageIndex < 0)
                continue;

            const index = j;
            const tevStageOffs = tevStageTableOffs + tevStageIndex * 0x14;

            // const unknown0 = view.getUint8(tevStageOffs + 0x00);
            const colorInA: GX.CombineColorInput = view.getUint8(tevStageOffs + 0x01);
            const colorInB: GX.CombineColorInput = view.getUint8(tevStageOffs + 0x02);
            const colorInC: GX.CombineColorInput = view.getUint8(tevStageOffs + 0x03);
            const colorInD: GX.CombineColorInput = view.getUint8(tevStageOffs + 0x04);
            const colorOp: GX.TevOp = view.getUint8(tevStageOffs + 0x05);
            const colorBias: GX.TevBias = view.getUint8(tevStageOffs + 0x06);
            const colorScale: GX.TevScale = view.getUint8(tevStageOffs + 0x07);
            const colorClamp: boolean = !!view.getUint8(tevStageOffs + 0x08);
            const colorRegId: GX.Register = view.getUint8(tevStageOffs + 0x09);

            const alphaInA: GX.CombineAlphaInput = view.getUint8(tevStageOffs + 0x0A);
            const alphaInB: GX.CombineAlphaInput = view.getUint8(tevStageOffs + 0x0B);
            const alphaInC: GX.CombineAlphaInput = view.getUint8(tevStageOffs + 0x0C);
            const alphaInD: GX.CombineAlphaInput = view.getUint8(tevStageOffs + 0x0D);
            const alphaOp: GX.TevOp = view.getUint8(tevStageOffs + 0x0E);
            const alphaBias: GX.TevBias = view.getUint8(tevStageOffs + 0x0F);
            const alphaScale: GX.TevScale = view.getUint8(tevStageOffs + 0x10);
            const alphaClamp: boolean = !!view.getUint8(tevStageOffs + 0x11);
            const alphaRegId: GX.Register = view.getUint8(tevStageOffs + 0x12);
            // const unknown1 = view.getUint8(tevStageOffs + 0x13);

            // TevOrder
            const tevOrderIndex = view.getUint16(materialEntryIdx + 0xBC + j * 0x02);
            const tevOrderOffs = tevOrderTableOffs + tevOrderIndex * 0x04;
            const texCoordId: GX.TexCoordID = view.getUint8(tevOrderOffs + 0x00);
            const texMap: number = view.getUint8(tevOrderOffs + 0x01);
            const channelId: GX.ColorChannelId = view.getUint8(tevOrderOffs + 0x02);
            assert(view.getUint8(tevOrderOffs + 0x03) === 0xFF);

            // KonstSel
            const konstColorSel: GX.KonstColorSel = view.getUint8(materialEntryIdx + 0x9C + j);
            const konstAlphaSel: GX.KonstAlphaSel = view.getUint8(materialEntryIdx + 0xAC + j);

            // SetTevIndirect
            const indTexStageOffs = indirectEntryOffs + 0x04 + (0x04 * 4) + (0x1C * 3) + (0x04 * 4) + j * 0x0C;
            const indTexStage: GX.IndTexStageID = view.getUint8(indTexStageOffs + 0x00);
            const indTexFormat: GX.IndTexFormat = view.getUint8(indTexStageOffs + 0x01);
            const indTexBiasSel: GX.IndTexBiasSel = view.getUint8(indTexStageOffs + 0x02);
            const indTexMatrix: GX.IndTexMtxID = view.getUint8(indTexStageOffs + 0x03);
            assert(indTexMatrix <= GX.IndTexMtxID.T2);
            const indTexWrapS: GX.IndTexWrap = view.getUint8(indTexStageOffs + 0x04);
            const indTexWrapT: GX.IndTexWrap = view.getUint8(indTexStageOffs + 0x05);
            const indTexAddPrev: boolean = !!view.getUint8(indTexStageOffs + 0x06);
            const indTexUseOrigLOD: boolean = !!view.getUint8(indTexStageOffs + 0x07);
            // bumpAlpha

            const tevStage: GX_Material.TevStage = {
                index,
                colorInA, colorInB, colorInC, colorInD, colorOp, colorBias, colorScale, colorClamp, colorRegId,
                alphaInA, alphaInB, alphaInC, alphaInD, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId,
                texCoordId, texMap, channelId,
                konstColorSel, konstAlphaSel,
                indTexStage,
                indTexFormat,
                indTexBiasSel,
                indTexMatrix,
                indTexWrapS,
                indTexWrapT,
                indTexAddPrev,
                indTexUseOrigLOD,
            };
            tevStages.push(tevStage);
        }

        // SetAlphaCompare
        const alphaTestIndex = view.getUint16(materialEntryIdx + 0x146);
        const blendModeIndex = view.getUint16(materialEntryIdx + 0x148);
        const alphaTestOffs = alphaTestTableOffs + alphaTestIndex * 0x08;
        const compareA: GX.CompareType = view.getUint8(alphaTestOffs + 0x00);
        const referenceA: number = view.getUint8(alphaTestOffs + 0x01) / 0xFF;
        const op: GX.AlphaOp = view.getUint8(alphaTestOffs + 0x02);
        const compareB: GX.CompareType = view.getUint8(alphaTestOffs + 0x03);
        const referenceB: number = view.getUint8(alphaTestOffs + 0x04) / 0xFF;
        const alphaTest: GX_Material.AlphaTest = { compareA, referenceA, op, compareB, referenceB };

        // SetBlendMode
        const blendModeOffs = blendModeTableOffs + blendModeIndex * 0x04;
        const blendType: GX.BlendMode = view.getUint8(blendModeOffs + 0x00);
        const blendSrc: GX.BlendFactor = view.getUint8(blendModeOffs + 0x01);
        const blendDst: GX.BlendFactor = view.getUint8(blendModeOffs + 0x02);
        const blendLogicOp: GX.LogicOp = view.getUint8(blendModeOffs + 0x03);
        const blendMode: GX_Material.BlendMode = { type: blendType, srcFactor: blendSrc, dstFactor: blendDst, logicOp: blendLogicOp };

        const cullMode: GX.CullMode = view.getUint32(cullModeTableOffs + cullModeIndex * 0x04);
        const depthModeOffs = depthModeTableOffs + depthModeIndex * 4;
        const depthTest: boolean = !!view.getUint8(depthModeOffs + 0x00);
        const depthFunc: GX.CompareType = view.getUint8(depthModeOffs + 0x01);
        const depthWrite: boolean = !!view.getUint8(depthModeOffs + 0x02);

        const ropInfo: GX_Material.RopInfo = { blendMode, depthTest, depthFunc, depthWrite };
        const translucent = !(flags & 0x03);

        const gxMaterial: GX_Material.GXMaterial = {
            index, name,
            cullMode,
            lightChannels,
            texGens,
            colorRegisters,
            colorConstants,
            tevStages,
            indTexStages,
            alphaTest,
            ropInfo,
        };

        materialEntries.push({
            index, name,
            translucent,
            textureIndexes,
            texMatrices,
            postTexMatrices,
            gxMaterial,
            colorMatRegs,
            colorAmbRegs,
            indTexMatrices,
        });
        materialEntryIdx += 0x014C;
    }

    function readColorChannel(tableOffs: number, colorChanIndex: number): GX_Material.ColorChannelControl {
        const colorChanOffs = colorChanTableOffs + colorChanIndex * 0x08;
        const lightingEnabled = !!view.getUint8(colorChanOffs + 0x00);
        assert(view.getUint8(colorChanOffs + 0x00) < 2);
        const matColorSource: GX.ColorSrc = view.getUint8(colorChanOffs + 0x01);
        const litMask = view.getUint8(colorChanOffs + 0x02);
        const diffuseFunction = view.getUint8(colorChanOffs + 0x03);
        const attenuationFunction = view.getUint8(colorChanOffs + 0x04);
        const ambColorSource: GX.ColorSrc = view.getUint8(colorChanOffs + 0x05);

        const colorChan: GX_Material.ColorChannelControl = { lightingEnabled, matColorSource, ambColorSource };
        return colorChan;
    }

    function readTexMatrix(tableOffs: number, j: number, texMtxIndex: number): TexMtx {
        if (tableOffs === 0)
            return null;
        const texMtxOffs = tableOffs + texMtxIndex * 0x64;
        const projection: TexMtxProjection = view.getUint8(texMtxOffs + 0x00);
        const type = view.getUint8(texMtxOffs + 0x01);
        assert(view.getUint16(texMtxOffs + 0x02) === 0xFFFF);
        const centerS = view.getFloat32(texMtxOffs + 0x04);
        const centerT = view.getFloat32(texMtxOffs + 0x08);
        const centerQ = view.getFloat32(texMtxOffs + 0x0C);
        const scaleS = view.getFloat32(texMtxOffs + 0x10);
        const scaleT = view.getFloat32(texMtxOffs + 0x14);
        const rotation = view.getInt16(texMtxOffs + 0x18) / 0x7FFF;
        assert(view.getUint16(texMtxOffs + 0x1A) === 0xFFFF);
        const translationS = view.getFloat32(texMtxOffs + 0x1C);
        const translationT = view.getFloat32(texMtxOffs + 0x20);

        // A second matrix?
        const p00 = view.getFloat32(texMtxOffs + 0x24);
        const p01 = view.getFloat32(texMtxOffs + 0x28);
        const p02 = view.getFloat32(texMtxOffs + 0x2C);
        const p03 = view.getFloat32(texMtxOffs + 0x30);
        const p10 = view.getFloat32(texMtxOffs + 0x34);
        const p11 = view.getFloat32(texMtxOffs + 0x38);
        const p12 = view.getFloat32(texMtxOffs + 0x3C);
        const p13 = view.getFloat32(texMtxOffs + 0x40);
        const p20 = view.getFloat32(texMtxOffs + 0x44);
        const p21 = view.getFloat32(texMtxOffs + 0x48);
        const p22 = view.getFloat32(texMtxOffs + 0x4C);
        const p23 = view.getFloat32(texMtxOffs + 0x50);
        const p30 = view.getFloat32(texMtxOffs + 0x54);
        const p31 = view.getFloat32(texMtxOffs + 0x58);
        const p32 = view.getFloat32(texMtxOffs + 0x5C);
        const p33 = view.getFloat32(texMtxOffs + 0x60);

        const projectionMatrix = mat4.fromValues(
            p00, p10, p20, p30,
            p01, p11, p21, p31,
            p02, p12, p22, p32,
            p03, p13, p23, p33,
        );

        const matrix = mat4.create();
        createTexMtx(matrix, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);

        const texMtx: TexMtx = { type, projection, projectionMatrix, matrix };
        return texMtx;
    }

    return { remapTable, materialEntries };
}
//#endregion

//#region BTI_Texture
export interface BTI_Texture {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    minLOD: number;
    maxLOD: number;
    lodBias: number;
    mipCount: number;
    data: ArrayBufferSlice;
}

function readBTI_Texture(buffer: ArrayBufferSlice, name: string): BTI_Texture {
    const view = buffer.createDataView();

    const format: GX.TexFormat = view.getUint8(0x00);
    const width = view.getUint16(0x02);
    const height = view.getUint16(0x04);
    const wrapS = view.getUint8(0x06);
    const wrapT = view.getUint8(0x07);
    const paletteFormat = view.getUint8(0x09);
    const paletteNumEntries = view.getUint16(0x0A);
    const paletteOffs = view.getUint16(0x0C);
    const minFilter = view.getUint8(0x14);
    const magFilter = view.getUint8(0x15);
    const minLOD = view.getInt8(0x16) * 1/8;
    const maxLOD = view.getInt8(0x17) * 1/8;
    const mipCount = view.getUint8(0x18);
    const lodBias = view.getInt16(0x1A) * 1/100;
    const dataOffs = view.getUint32(0x1C);

    assert(minLOD === 0);

    let data = null;
    if (dataOffs !== 0)
        data = buffer.slice(dataOffs);

    return { name, format, width, height, wrapS, wrapT, minFilter, magFilter, minLOD, maxLOD, mipCount, lodBias, data };
}
//#endregion

//#region TEX1
// The way this works is a bit complicated. Basically, textures can have different
// LOD or wrap modes but share the same literal texture data. As such, we do a bit
// of remapping here. TEX1_TextureData contains the texture data parameters, and
// TEX1_Sampler contains the "sampling" parameters like LOD or wrap mode, along with
// its associated texture data. Each texture in the TEX1 chunk is turned into a
// TEX1_Surface.

export interface TEX1_TextureData {
    // XXX(jstpierre): Required for the ZTP BTI hack
    name: string;
    width: number;
    height: number;
    format: GX.TexFormat;
    mipCount: number;
    data: ArrayBufferSlice;
}

export interface TEX1_Sampler {
    index: number;

    name: string;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    minLOD: number;
    maxLOD: number;
    lodBias: number;
    textureDataIndex: number;
}

export interface TEX1 {
    textureDatas: TEX1_TextureData[];
    samplers: TEX1_Sampler[];
}

function readTEX1Chunk(buffer: ArrayBufferSlice): TEX1 {
    const view = buffer.createDataView();
    const textureCount = view.getUint16(0x08);
    const textureHeaderOffs = view.getUint32(0x0C);
    const nameTableOffs = view.getUint32(0x10);
    const nameTable = readStringTable(buffer, nameTableOffs);

    const samplers: TEX1_Sampler[] = [];
    const textureDatas: TEX1_TextureData[] = [];
    for (let i = 0; i < textureCount; i++) {
        const textureIdx = textureHeaderOffs + i * 0x20;
        const name = nameTable[i];
        const btiTexture: BTI_Texture = readBTI_Texture(buffer.slice(textureIdx), name);

        let textureDataIndex: number = -1;

        // Try to find existing texture data.
        if (btiTexture.data !== null) {
            textureDataIndex = textureDatas.findIndex((tex) => tex.data && tex.data.byteOffset === btiTexture.data.byteOffset);
        }

        if (textureDataIndex < 0) {
            const textureData: TEX1_TextureData = {
                name: btiTexture.name,
                width: btiTexture.width,
                height: btiTexture.height,
                format: btiTexture.format,
                mipCount: btiTexture.mipCount,
                data: btiTexture.data,
            };
            textureDatas.push(textureData);
            textureDataIndex = textureDatas.length - 1;
        }

        // Sampler.
        const sampler: TEX1_Sampler = {
            index: i,
            name: btiTexture.name,
            wrapS: btiTexture.wrapS,
            wrapT: btiTexture.wrapT,
            minFilter: btiTexture.minFilter,
            magFilter: btiTexture.magFilter,
            minLOD: btiTexture.minLOD,
            maxLOD: btiTexture.maxLOD,
            lodBias: btiTexture.lodBias,
            textureDataIndex,
        };
        samplers.push(sampler);
    }

    return { textureDatas, samplers };
}

class J3DFileReaderHelper {
    public view: DataView;
    public magic: string;
    public size: number;
    public numChunks: number;
    public offs: number = 0x20;

    constructor(public buffer: ArrayBufferSlice) {
        this.view = this.buffer.createDataView();
        this.magic = readString(this.buffer, 0, 8);
        this.size = this.view.getUint32(0x08);
        this.numChunks = this.view.getUint32(0x0C);
        this.offs = 0x20;
    }

    public maybeNextChunk(maybeChunkId: string): ArrayBufferSlice {
        const chunkStart = this.offs;
        const chunkId = readString(this.buffer, chunkStart + 0x00, 4);
        const chunkSize = this.view.getUint32(chunkStart + 0x04);
        if (chunkId === maybeChunkId) {
            this.offs += chunkSize;
            return this.buffer.subarray(chunkStart, chunkSize);
        } else {
            return null;
        }
    }

    public nextChunk(expectedChunkId: string): ArrayBufferSlice {
        const chunkStart = this.offs;
        const chunkId = readString(this.buffer, chunkStart + 0x00, 4);
        const chunkSize = this.view.getUint32(chunkStart + 0x04);
        assert(chunkId === expectedChunkId);
        this.offs += chunkSize;
        return this.buffer.subarray(chunkStart, chunkSize);
    }
}
//#endregion

//#region BMD
export class BMD {
    public static parse(buffer: ArrayBufferSlice): BMD {
        const bmd = new BMD();

        const j3d = new J3DFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D2bmd3' || j3d.magic === 'J3D2bdl4');

        bmd.inf1 = readINF1Chunk(j3d.nextChunk('INF1'));
        bmd.vtx1 = readVTX1Chunk(j3d.nextChunk('VTX1'));
        bmd.evp1 = readEVP1Chunk(j3d.nextChunk('EVP1'));
        bmd.drw1 = readDRW1Chunk(j3d.nextChunk('DRW1'));
        bmd.jnt1 = readJNT1Chunk(j3d.nextChunk('JNT1'));
        bmd.shp1 = readSHP1Chunk(j3d.nextChunk('SHP1'), bmd);
        bmd.mat3 = readMAT3Chunk(j3d.nextChunk('MAT3'));
        const mdl3 = j3d.maybeNextChunk('MDL3');
        bmd.tex1 = readTEX1Chunk(j3d.nextChunk('TEX1'));

        return bmd;
    }

    public inf1: INF1;
    public vtx1: VTX1;
    public evp1: EVP1;
    public drw1: DRW1;
    public jnt1: JNT1;
    public shp1: SHP1;
    public mat3: MAT3;
    public tex1: TEX1;
}
//#endregion

//#region BMT
export class BMT {
    public static parse(buffer: ArrayBufferSlice): BMT {
        const bmt = new BMT();

        const j3d = new J3DFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D2bmt3');

        const mat3Chunk = j3d.maybeNextChunk('MAT3');
        if (mat3Chunk !== null)
            bmt.mat3 = readMAT3Chunk(mat3Chunk);
        else
            bmt.mat3 = null;
        bmt.tex1 = readTEX1Chunk(j3d.nextChunk('TEX1'));

        return bmt;
    }

    public mat3: MAT3;
    public tex1: TEX1;
}
//#endregion

//#region BTI
export class BTI {
    texture: BTI_Texture;

    public static parse(buffer: ArrayBufferSlice, name: string = null): BTI {
        const bti = new BTI();
        bti.texture = readBTI_Texture(buffer, name);
        return bti;
    }
}
//#endregion

//#region Animation
export const enum LoopMode {
    ONCE = 0,
    REPEAT = 2,
    MIRRORED_ONCE = 3,
    MIRRORED_REPEAT = 4,
}

const enum TangentType {
    IN = 0,
    IN_OUT = 1,
}

interface AnimationKeyframe {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
}

interface AnimationTrack {
    frames: AnimationKeyframe[];
}

interface AnimationBase {
    duration: number;
    loopMode: LoopMode;
}

function applyLoopMode(t: number, loopMode: LoopMode) {
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

function getAnimFrame(anim: AnimationBase, frame: number): number {
    const lastFrame = anim.duration - 1;
    const normTime = frame / lastFrame;
    const animFrame = applyLoopMode(normTime, anim.loopMode) * lastFrame;
    return animFrame;
}

function cubicEval(cf0: number, cf1: number, cf2: number, cf3: number, t: number): number {
    return (((cf0 * t + cf1) * t + cf2) * t + cf3);
}

function lerp(k0: AnimationKeyframe, k1: AnimationKeyframe, t: number) {
    return k0.value + (k1.value - k0.value) * t;
}

function hermiteInterpolate(k0: AnimationKeyframe, k1: AnimationKeyframe, t: number): number {
    const length = k1.time - k0.time;
    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangentOut * length;
    const s1 = k1.tangentIn * length;
    const cf0 = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1);
    const cf1 = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1);
    const cf2 = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0);
    const cf3 = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0);
    return cubicEval(cf0, cf1, cf2, cf3, t);
}

function sampleAnimationData(track: AnimationTrack, frame: number) {
    const frames = track.frames;

    if (frames.length === 1)
        return frames[0].value;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    // HACK(jstpierre): Nintendo sometimes uses weird "reset" tangents
    // which aren't supposed to be visible. They are visible for us because
    // "frame" can have a non-zero fractional component. In this case, pick
    // a value completely.
    if ((k1.time - k0.time) === 1)
        return k0.value;

    const t = (frame - k0.time) / (k1.time - k0.time);
    return hermiteInterpolate(k0, k1, t);
}

function translateAnimationTrack(data: Float32Array | Int16Array, scale: number, count: number, index: number, tangent: TangentType): AnimationTrack {
    // Special exception.
    if (count === 1) {
        const value = data[index];
        const frames = [ { time: 0, value: value * scale, tangentIn: 0, tangentOut: 0 } ];
        return { frames };
    } else {
        const frames: AnimationKeyframe[] = [];

        if (tangent === TangentType.IN) {
            for (let i = index; i < index + 3 * count; i += 3) {
                const time = data[i+0], value = data[i+1] * scale, tangentIn = data[i+2] * scale, tangentOut = tangentIn;
                frames.push({ time, value, tangentIn, tangentOut });
            }
        } else if (tangent === TangentType.IN_OUT) {
            for (let i = index; i < index + 4 * count; i += 4) {
                const time = data[i+0], value = data[i+1] * scale, tangentIn = data[i+2] * scale, tangentOut = data[i+3] * scale;
                frames.push({ time, value, tangentIn, tangentOut });
            }
        }

        return { frames };
    }
}
//#endregion

//#region TTK1
interface UVAnimationEntry {
    materialName: string;
    remapIndex: number;
    texMtxIndex: number;
    centerS: number;
    centerT: number;
    centerQ: number;
    scaleS: AnimationTrack;
    scaleT: AnimationTrack;
    scaleQ: AnimationTrack;
    rotationS: AnimationTrack;
    rotationT: AnimationTrack;
    rotationQ: AnimationTrack;
    translationS: AnimationTrack;
    translationT: AnimationTrack;
    translationQ: AnimationTrack;
}

export interface TTK1 extends AnimationBase {
    uvAnimationEntries: UVAnimationEntry[];
}

function readTTK1Chunk(buffer: ArrayBufferSlice): TTK1 {
    const view = buffer.createDataView();
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
    const sTableOffs = view.getUint32(0x28);
    const rTableOffs = view.getUint32(0x2C);
    const tTableOffs = view.getUint32(0x30);

    const rotationScale = Math.pow(2, rotationDecimal) / 32767;

    const sTable = betoh(buffer.subarray(sTableOffs, sCount * 4), 4).createTypedArray(Float32Array);
    const rTable = betoh(buffer.subarray(rTableOffs, rCount * 2), 2).createTypedArray(Int16Array);
    const tTable = betoh(buffer.subarray(tTableOffs, tCount * 4), 4).createTypedArray(Float32Array);

    const materialNameTable = readStringTable(buffer, materialNameTableOffs);

    let animationTableIdx = animationTableOffs;

    function readAnimationTrack(data: Int16Array | Float32Array, scale: number) {
        const count = view.getUint16(animationTableIdx + 0x00);
        const index = view.getUint16(animationTableIdx + 0x02);
        const tangent: TangentType = view.getUint16(animationTableIdx + 0x04);
        animationTableIdx += 0x06;
        return translateAnimationTrack(data, scale, count, index, tangent);
    }

    const uvAnimationEntries: UVAnimationEntry[] = [];
    for (let i = 0; i < animationCount; i++) {
        const materialName = materialNameTable[i];
        const remapIndex = view.getUint16(remapTableOffs + i * 0x02);
        const texMtxIndex = view.getUint8(texMtxIndexTableOffs + i);
        const centerS = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x00);
        const centerT = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x04);
        const centerQ = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x08);
        const scaleS = readAnimationTrack(sTable, 1);
        const rotationS = readAnimationTrack(rTable, rotationScale);
        const translationS = readAnimationTrack(tTable, 1);
        const scaleT = readAnimationTrack(sTable, 1);
        const rotationT = readAnimationTrack(rTable, rotationScale);
        const translationT = readAnimationTrack(tTable, 1);
        const scaleQ = readAnimationTrack(sTable, 1);
        const rotationQ = readAnimationTrack(rTable, rotationScale);
        const translationQ = readAnimationTrack(tTable, 1);
        uvAnimationEntries.push({
            materialName, remapIndex, texMtxIndex,
            centerS, centerT, centerQ,
            scaleS, rotationS, translationS,
            scaleT, rotationT, translationT,
            scaleQ, rotationQ, translationQ,
         });
    }

    return { duration, loopMode, uvAnimationEntries };
}
//#endregion

//#region BTK
export class BTK {
    public static parse(buffer: ArrayBufferSlice): BTK {
        const btk = new BTK();

        const j3d = new J3DFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1btk1');

        btk.ttk1 = readTTK1Chunk(j3d.nextChunk('TTK1'));

        return btk;
    }

    public ttk1: TTK1;

    public calcAnimatedTexMtx(dst: mat4, materialName: string, texMtxIndex: number, frame: number): boolean {
        const animationEntry = this.findAnimationEntry(materialName, texMtxIndex);
        if (!animationEntry)
            return false;

        const animFrame = getAnimFrame(this.ttk1, frame);

        const centerS = animationEntry.centerS;
        const centerT = animationEntry.centerT;
        const centerQ = animationEntry.centerQ;
        const scaleS = sampleAnimationData(animationEntry.scaleS, animFrame);
        const scaleT = sampleAnimationData(animationEntry.scaleT, animFrame);
        const rotation = sampleAnimationData(animationEntry.rotationQ, animFrame);
        const translationS = sampleAnimationData(animationEntry.translationS, animFrame);
        const translationT = sampleAnimationData(animationEntry.translationT, animFrame);
        createTexMtx(dst, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);
        return true;
    }

    private findAnimationEntry(materialName: string, texMtxIndex: number): UVAnimationEntry {
        return this.ttk1.uvAnimationEntries.find((e) => e.materialName === materialName && e.texMtxIndex === texMtxIndex);
    }
}
//#endregion

//#region TRK1
interface PaletteAnimationEntry {
    materialName: string;
    remapIndex: number;
    colorId: number; // register or constant index
    r: AnimationTrack;
    g: AnimationTrack;
    b: AnimationTrack;
    a: AnimationTrack;
}

export interface TRK1 extends AnimationBase {
    registerAnimationEntries: PaletteAnimationEntry[];
    konstantAnimationEntries: PaletteAnimationEntry[];
}

function readTRK1Chunk(buffer: ArrayBufferSlice): TRK1 {
    const view = buffer.createDataView();
    const loopMode: LoopMode = view.getUint8(0x08);
    const duration = view.getUint16(0x0A);
    const registerColorAnimationTableCount = view.getUint16(0x0C);
    const konstantColorAnimationTableCount = view.getUint16(0x0E);
    const registerRCount = view.getUint16(0x10);
    const registerGCount = view.getUint16(0x12);
    const registerBCount = view.getUint16(0x14);
    const registerACount = view.getUint16(0x16);
    const konstantRCount = view.getUint16(0x18);
    const konstantGCount = view.getUint16(0x1A);
    const konstantBCount = view.getUint16(0x1C);
    const konstantACount = view.getUint16(0x1E);
    const registerColorAnimationTableOffs = view.getUint32(0x20);
    const konstantColorAnimationTableOffs = view.getUint32(0x24);
    const registerRemapTableOffs = view.getUint32(0x28);
    const konstantRemapTableOffs = view.getUint32(0x2C);
    const registerNameTableOffs = view.getUint32(0x30);
    const konstantNameTableOffs = view.getUint32(0x34);
    const registerROffs = view.getUint32(0x38);
    const registerGOffs = view.getUint32(0x3C);
    const registerBOffs = view.getUint32(0x40);
    const registerAOffs = view.getUint32(0x44);
    const konstantROffs = view.getUint32(0x48);
    const konstantGOffs = view.getUint32(0x4C);
    const konstantBOffs = view.getUint32(0x50);
    const konstantAOffs = view.getUint32(0x54);
    const registerNameTable = readStringTable(buffer, registerNameTableOffs);
    const konstantNameTable = readStringTable(buffer, konstantNameTableOffs);

    let animationTableIdx: number;

    function readAnimationTrack(data: Int16Array) {
        const count = view.getUint16(animationTableIdx + 0x00);
        const index = view.getUint16(animationTableIdx + 0x02);
        const tangent: TangentType = view.getUint16(animationTableIdx + 0x04);
        animationTableIdx += 0x06;
        return translateAnimationTrack(data, 1 / 0xFF, count, index, tangent);
    }

    const registerRTable = betoh(buffer.subarray(registerROffs, registerRCount * 2), 2).createTypedArray(Int16Array);
    const registerGTable = betoh(buffer.subarray(registerGOffs, registerGCount * 2), 2).createTypedArray(Int16Array);
    const registerBTable = betoh(buffer.subarray(registerBOffs, registerBCount * 2), 2).createTypedArray(Int16Array);
    const registerATable = betoh(buffer.subarray(registerAOffs, registerACount * 2), 2).createTypedArray(Int16Array);

    const registerAnimationEntries: PaletteAnimationEntry[] = [];

    animationTableIdx = registerColorAnimationTableOffs;
    for (let i = 0; i < registerColorAnimationTableCount; i++) {
        const materialName = registerNameTable[i];
        const remapIndex = view.getUint16(registerRemapTableOffs + i * 0x02);
        const r = readAnimationTrack(registerRTable);
        const g = readAnimationTrack(registerGTable);
        const b = readAnimationTrack(registerBTable);
        const a = readAnimationTrack(registerATable);
        const colorId = view.getUint8(animationTableIdx);
        animationTableIdx += 0x04;
        registerAnimationEntries.push({ materialName, remapIndex, colorId, r, g, b, a });
    }

    const konstantRTable = betoh(buffer.subarray(konstantROffs, konstantRCount * 2), 2).createTypedArray(Int16Array);
    const konstantGTable = betoh(buffer.subarray(konstantGOffs, konstantGCount * 2), 2).createTypedArray(Int16Array);
    const konstantBTable = betoh(buffer.subarray(konstantBOffs, konstantBCount * 2), 2).createTypedArray(Int16Array);
    const konstantATable = betoh(buffer.subarray(konstantAOffs, konstantACount * 2), 2).createTypedArray(Int16Array);

    const konstantAnimationEntries: PaletteAnimationEntry[] = [];

    animationTableIdx = konstantColorAnimationTableOffs;
    for (let i = 0; i < konstantColorAnimationTableCount; i++) {
        const materialName = konstantNameTable[i];
        const remapIndex = view.getUint16(konstantRemapTableOffs + i * 0x02);
        const r = readAnimationTrack(konstantRTable);
        const g = readAnimationTrack(konstantGTable);
        const b = readAnimationTrack(konstantBTable);
        const a = readAnimationTrack(konstantATable);
        const colorId = view.getUint8(animationTableIdx);
        animationTableIdx += 0x04;
        konstantAnimationEntries.push({ materialName, remapIndex, colorId, r, g, b, a });
    }

    return { duration, loopMode, registerAnimationEntries, konstantAnimationEntries };
}
//#endregion

//#region BRK
export class BRK {
    public static parse(buffer: ArrayBufferSlice): BRK {
        const brk = new BRK();

        const j3d = new J3DFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1brk1');

        brk.trk1 = readTRK1Chunk(j3d.nextChunk('TRK1'));

        return brk;
    }

    public calcColorOverrides(dst: Float32Array, offs: number, materialName: string, frame: number): void {
        const animFrame = getAnimFrame(this.trk1, frame);

        for (let i = 0; i < 4; i++) {
            const animationEntry = this.trk1.konstantAnimationEntries.find((e) => e.materialName === materialName && e.colorId === i);
            if (!animationEntry)
                continue;

            dst[offs + i*4 + 0] = sampleAnimationData(animationEntry.r, animFrame);
            dst[offs + i*4 + 1] = sampleAnimationData(animationEntry.g, animFrame);
            dst[offs + i*4 + 2] = sampleAnimationData(animationEntry.b, animFrame);
            dst[offs + i*4 + 3] = sampleAnimationData(animationEntry.a, animFrame);
        }
        offs += 4*4;

        for (let i = 0; i < 4; i++) {
            const animationEntry = this.trk1.registerAnimationEntries.find((e) => e.materialName === materialName && e.colorId === i);
            if (!animationEntry)
                continue;

            dst[offs + i*4 + 0] = sampleAnimationData(animationEntry.r, animFrame);
            dst[offs + i*4 + 1] = sampleAnimationData(animationEntry.g, animFrame);
            dst[offs + i*4 + 2] = sampleAnimationData(animationEntry.b, animFrame);
            dst[offs + i*4 + 3] = sampleAnimationData(animationEntry.a, animFrame);
        }
        offs += 4*4;
    }

    public trk1: TRK1;
}
//#endregion

//#region ANK1
interface JointAnimationEntry {
    index: number;
    scaleX: AnimationTrack;
    rotationX: AnimationTrack;
    translationX: AnimationTrack;
    scaleY: AnimationTrack;
    rotationY: AnimationTrack;
    translationY: AnimationTrack;
    scaleZ: AnimationTrack;
    rotationZ: AnimationTrack;
    translationZ: AnimationTrack;
}

interface ANK1 extends AnimationBase {
    jointAnimationEntries: JointAnimationEntry[];
}

function readANK1Chunk(buffer: ArrayBufferSlice): ANK1 {
    const view = buffer.createDataView();
    const loopMode: LoopMode = view.getUint8(0x08);
    const rotationDecimal = view.getUint8(0x09);
    const duration = view.getUint16(0x0A);
    const jointAnimationTableCount = view.getUint16(0x0C);
    const sCount = view.getUint16(0x0E);
    const rCount = view.getUint16(0x10);
    const tCount = view.getUint16(0x12);
    const jointAnimationTableOffs = view.getUint32(0x14);
    const sTableOffs = view.getUint32(0x18);
    const rTableOffs = view.getUint32(0x1C);
    const tTableOffs = view.getUint32(0x20);

    const rotationScale = Math.pow(2, rotationDecimal) / 32767;

    const sTable = betoh(buffer.subarray(sTableOffs, sCount * 4), 4).createTypedArray(Float32Array);
    const rTable = betoh(buffer.subarray(rTableOffs, rCount * 2), 2).createTypedArray(Int16Array);
    const tTable = betoh(buffer.subarray(tTableOffs, tCount * 4), 4).createTypedArray(Float32Array);

    let animationTableIdx = jointAnimationTableOffs;
    function readAnimationTrack(data: Int16Array | Float32Array, scale: number) {
        const count = view.getUint16(animationTableIdx + 0x00);
        const index = view.getUint16(animationTableIdx + 0x02);
        const tangent: TangentType = view.getUint16(animationTableIdx + 0x04);
        animationTableIdx += 0x06;
        return translateAnimationTrack(data, scale, count, index, tangent);
    }

    const jointAnimationEntries: JointAnimationEntry[] = [];
    for (let i = 0; i < jointAnimationTableCount; i++) {
        const scaleX = readAnimationTrack(sTable, 1);
        const rotationX = readAnimationTrack(rTable, rotationScale);
        const translationX = readAnimationTrack(tTable, 1);
        const scaleY = readAnimationTrack(sTable, 1);
        const rotationY = readAnimationTrack(rTable, rotationScale);
        const translationY = readAnimationTrack(tTable, 1);
        const scaleZ = readAnimationTrack(sTable, 1);
        const rotationZ = readAnimationTrack(rTable, rotationScale);
        const translationZ = readAnimationTrack(tTable, 1);
        jointAnimationEntries.push({ 
            index: i,
            scaleX, rotationX, translationX,
            scaleY, rotationY, translationY,
            scaleZ, rotationZ, translationZ,
        });
    }

    return { loopMode, duration, jointAnimationEntries };
}
//#endregion

//#region BCK
export class BCK {
    public static parse(buffer: ArrayBufferSlice): BCK {
        const bck = new BCK();

        const j3d = new J3DFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1bck1');

        bck.ank1 = readANK1Chunk(j3d.nextChunk('ANK1'));

        return bck;
    }

    public calcJointMatrix(dst: mat4, jointIndex: number, frame: number): void {
        const animFrame = getAnimFrame(this.ank1, frame);

        const entry = this.ank1.jointAnimationEntries[jointIndex];
        const scaleX = sampleAnimationData(entry.scaleX, animFrame);
        const rotationX = sampleAnimationData(entry.rotationX, animFrame) * 180;
        const translationX = sampleAnimationData(entry.translationX, animFrame);
        const scaleY = sampleAnimationData(entry.scaleY, animFrame);
        const rotationY = sampleAnimationData(entry.rotationY, animFrame) * 180;
        const translationY = sampleAnimationData(entry.translationY, animFrame);
        const scaleZ = sampleAnimationData(entry.scaleZ, animFrame);
        const rotationZ = sampleAnimationData(entry.rotationZ, animFrame) * 180;
        const translationZ = sampleAnimationData(entry.translationZ, animFrame);
        createJointMatrix(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
    }

    public ank1: ANK1;
}
//#endregion
