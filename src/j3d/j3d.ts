
// Implements Nintendo's J3D formats (BMD, BDL, BTK, etc.)

import { mat4, quat, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { Endianness } from '../endian';
import { assert, readString } from '../util';

import { compileVtxLoader, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout } from '../gx/gx_displaylist';
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import AnimationController from '../AnimationController';
import { ColorKind } from '../gx/gx_render';
import { AABB } from '../Geometry';
import { getPointHermite } from '../Spline';

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
    compShift: number;
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
        const compShift: number = view.getUint8(offs + 0x0C);
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
        const vtxDataBuffer = buffer.subarray(dataOffs, dataSize);
        const vertexArray: VertexArray = { vtxAttrib, compType, compCnt, compShift, dataOffs, dataSize, buffer: vtxDataBuffer };
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
export enum DRW1MatrixKind {
    Joint = 0x00,
    Envelope = 0x01,
}

interface DRW1JointMatrix {
    kind: DRW1MatrixKind.Joint;
    jointIndex: number;
}

interface DRW1EnvelopeMatrix {
    kind: DRW1MatrixKind.Envelope;
    envelopeIndex: number;
}

type DRW1Matrix = DRW1JointMatrix | DRW1EnvelopeMatrix;

export interface DRW1 {
    matrixDefinitions: DRW1Matrix[];
}

function readDRW1Chunk(buffer: ArrayBufferSlice): DRW1 {
    const view = buffer.createDataView();
    const matrixCount = view.getUint16(0x08);
    const isWeightedTableOffs = view.getUint32(0x0C);
    const matrixIndexTableOffs = view.getUint32(0x10);

    const matrixDefinitions: DRW1Matrix[] = [];
    for (let i = 0; i < matrixCount; i++) {
        const kind: DRW1MatrixKind = view.getUint8(isWeightedTableOffs + i);
        const param = view.getUint16(matrixIndexTableOffs + i * 0x02);
        if (kind === DRW1MatrixKind.Joint) {
            matrixDefinitions.push({ kind, jointIndex: param });
        } else if (kind === DRW1MatrixKind.Envelope) {
            matrixDefinitions.push({ kind, envelopeIndex: param })
        }
    }

    return { matrixDefinitions };
}
//#endregion

//#region JNT1
export interface Joint {
    name: string;
    matrix: mat4;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    boundingSphereRadius: number;
    bbox: AABB;
}

export interface JNT1 {
    joints: Joint[];
}

function calcModelMtx(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number, translationX: number, translationY: number, translationZ: number): void {
    const rX = Math.PI / 180 * rotationX;
    const rY = Math.PI / 180 * rotationY;
    const rZ = Math.PI / 180 * rotationZ;

    const sinX = Math.sin(rX), cosX = Math.cos(rX);
    const sinY = Math.sin(rY), cosY = Math.cos(rY);
    const sinZ = Math.sin(rZ), cosZ = Math.cos(rZ);

    dst[0] =  scaleX * (cosY * cosZ);
    dst[1] =  scaleX * (sinZ * cosY);
    dst[2] =  scaleX * (-sinY);
    dst[3] =  0.0;

    dst[4] =  scaleY * (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  scaleY * (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  scaleY * (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  scaleZ * (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  scaleZ * (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = scaleZ * (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = translationX;
    dst[13] = translationY;
    dst[14] = translationZ;
    dst[15] = 1.0;
}

function readJNT1Chunk(buffer: ArrayBufferSlice): JNT1 {
    const view = buffer.createDataView();

    const jointDataCount = view.getUint16(0x08);
    assert(view.getUint16(0x0A) === 0xFFFF);

    const jointDataTableOffs = view.getUint32(0x0C);
    const remapTableOffs = view.getUint32(0x10);

    const remapTable: number[] = [];
    for (let i = 0; i < jointDataCount; i++)
        remapTable[i] = view.getUint16(remapTableOffs + i * 0x02);

    const nameTableOffs = view.getUint32(0x14);
    const nameTable = readStringTable(buffer, nameTableOffs);

    const joints: Joint[] = [];
    for (let i = 0; i < jointDataCount; i++) {
        const name = nameTable[i];
        const jointDataTableIdx = jointDataTableOffs + (remapTable[i] * 0x40);
        const scaleX = view.getFloat32(jointDataTableIdx + 0x04);
        const scaleY = view.getFloat32(jointDataTableIdx + 0x08);
        const scaleZ = view.getFloat32(jointDataTableIdx + 0x0C);
        const rotationX = view.getInt16(jointDataTableIdx + 0x10) / 0x7FFF * 180;
        const rotationY = view.getInt16(jointDataTableIdx + 0x12) / 0x7FFF * 180;
        const rotationZ = view.getInt16(jointDataTableIdx + 0x14) / 0x7FFF * 180;
        const translationX = view.getFloat32(jointDataTableIdx + 0x18);
        const translationY = view.getFloat32(jointDataTableIdx + 0x1C);
        const translationZ = view.getFloat32(jointDataTableIdx + 0x20);
        const boundingSphereRadius = view.getFloat32(jointDataTableIdx + 0x24);
        const bboxMinX = view.getFloat32(jointDataTableIdx + 0x28);
        const bboxMinY = view.getFloat32(jointDataTableIdx + 0x2C);
        const bboxMinZ = view.getFloat32(jointDataTableIdx + 0x30);
        const bboxMaxX = view.getFloat32(jointDataTableIdx + 0x34);
        const bboxMaxY = view.getFloat32(jointDataTableIdx + 0x38);
        const bboxMaxZ = view.getFloat32(jointDataTableIdx + 0x3C);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
        const matrix = mat4.create();
        calcModelMtx(matrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        joints.push({ name, matrix, scaleX, scaleY, scaleZ, boundingSphereRadius, bbox });
    }

    return { joints };
}
//#endregion

//#region SHP1
// A packet is a series of draw calls that use the same matrix table.
interface Packet {
    matrixTable: Uint16Array;
    firstTriangle: number;
    numTriangles: number;
    loadedVertexData: LoadedVertexData;
}

export const enum ShapeDisplayFlags {
    NORMAL = 0,
    BILLBOARD = 1,
    Y_BILLBOARD = 2,
    USE_PNMTXIDX = 3,
}

export interface Shape {
    displayFlags: ShapeDisplayFlags;
    loadedVertexLayout: LoadedVertexLayout;
    packets: Packet[];
    bbox: AABB;
    boundingSphereRadius: number;
}

export interface SHP1 {
    vat: GX_VtxAttrFmt[];
    shapes: Shape[];
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
    const vat: GX_VtxAttrFmt[] = [];
    const vtxArrays: GX_Array[] = [];

    // J3D only uses VTXFMT0.
    for (const [attr, vertexArray] of bmd.vtx1.vertexArrays.entries()) {
        vat[attr] = { compCnt: vertexArray.compCnt, compType: vertexArray.compType, compShift: vertexArray.compShift };
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

        const vcd: GX_VtxDesc[] = [];

        let attribIdx = attribTableOffs + attribOffs;
        while (true) {
            const vtxAttrib: GX.VertexAttribute = view.getUint32(attribIdx + 0x00);
            if (vtxAttrib === GX.VertexAttribute.NULL)
                break;
            const indexDataType: GX.AttrType = view.getUint32(attribIdx + 0x04);
            vcd[vtxAttrib] = { type: indexDataType };
            attribIdx += 0x08;
        }

        const vtxLoader = compileVtxLoader(vat, vcd);
        const loadedVertexLayout = vtxLoader.loadedVertexLayout;

        // Now parse out the packets.
        let packetIdx = packetTableOffs + (firstPacket * 0x08);
        const packets: Packet[] = [];

        let totalTriangleCount = 0;
        for (let j = 0; j < packetCount; j++) {
            const packetSize = view.getUint32(packetIdx + 0x00);
            const packetStart = primDataOffs + view.getUint32(packetIdx + 0x04);

            const packetMatrixDataOffs = matrixDataOffs + (firstMatrix + j) * 0x08;
            const matrixCount = view.getUint16(packetMatrixDataOffs + 0x02);
            const matrixFirstIndex = view.getUint32(packetMatrixDataOffs + 0x04);

            const packetMatrixTableOffs = matrixTableOffs + matrixFirstIndex * 0x02;
            const packetMatrixTableSize = matrixCount;
            const matrixTable = buffer.createTypedArray(Uint16Array, packetMatrixTableOffs, packetMatrixTableSize, Endianness.BIG_ENDIAN);

            const srcOffs = packetStart;
            const subBuffer = buffer.subarray(srcOffs, packetSize);
            const loadedVertexData = vtxLoader.runVertices(vtxArrays, subBuffer);

            const firstTriangle = totalTriangleCount;
            const numTriangles = loadedVertexData.totalTriangleCount;
            totalTriangleCount += numTriangles;

            packets.push({ matrixTable, firstTriangle, numTriangles, loadedVertexData });
            packetIdx += 0x08;
        }

        const boundingSphereRadius = view.getFloat32(shapeIdx + 0x0C);
        const bboxMinX = view.getFloat32(shapeIdx + 0x10);
        const bboxMinY = view.getFloat32(shapeIdx + 0x14);
        const bboxMinZ = view.getFloat32(shapeIdx + 0x18);
        const bboxMaxX = view.getFloat32(shapeIdx + 0x1C);
        const bboxMaxY = view.getFloat32(shapeIdx + 0x20);
        const bboxMaxZ = view.getFloat32(shapeIdx + 0x24);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

        // Now we should have a complete shape. Onto the next!
        shapes.push({ displayFlags, loadedVertexLayout, packets, bbox, boundingSphereRadius });

        shapeIdx += 0x28;
    }

    return { vat, shapes };
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
    effectMatrix: mat4;
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
    colorConstants: GX_Material.Color[];
    colorRegisters: GX_Material.Color[];
}

export interface MAT3 {
    materialEntries: MaterialEntry[];
}

// temp, center, center inverse
const t = mat4.create(), c = mat4.create(), ci = mat4.create(), tt = vec3.create();
function calcTexMtx(m: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number, centerS: number, centerT: number, centerQ: number) {
    mat4.fromTranslation(c, vec3.set(tt, centerS, centerT, centerQ));
    mat4.fromTranslation(ci, vec3.set(tt, -centerS, -centerT, -centerQ));
    mat4.fromTranslation(m, vec3.set(tt, translationS, translationT, 0));
    mat4.fromScaling(t, vec3.set(tt, scaleS, scaleT, 1));
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
    const tevSwapModeInfoOffs = view.getUint32(0x60);
    const tevSwapModeTableInfoOffset = view.getUint32(0x64);
    const alphaTestTableOffs = view.getUint32(0x6C);
    const blendModeTableOffs = view.getUint32(0x70);
    const depthModeTableOffs = view.getUint32(0x74);

    const materialEntries: MaterialEntry[] = [];
    const materialEntryTableOffs = view.getUint32(0x0C);
    for (let i = 0; i < materialCount; i++) {
        const index = i;
        const name = nameTable[i];
        const materialEntryIdx = materialEntryTableOffs + (0x014C * remapTable[i]);
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
            const matrixCheck: GX.TexGenMatrix = view.getUint8(texGenTableOffs + texGenIndex * 0x04 + 0x02);
            assert(view.getUint8(texGenTableOffs + texGenIndex * 0x04 + 0x03) === 0xFF);
            let postMatrix: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY;
            const postTexGenIndex = view.getInt16(materialEntryIdx + 0x38 + j * 0x02);
            if (postTexGenTableOffs > 0 && postTexGenIndex >= 0) {
                postMatrix = view.getUint8(postTexGenTableOffs + texGenIndex * 0x04 + 0x02);
                assert(view.getUint8(postTexGenTableOffs + postTexGenIndex * 0x04 + 0x03) === 0xFF);
            }

            // BTK can apply texture animations to materials that have the matrix set to IDENTITY.
            // For this reason, we always assign a texture matrix. In theory, the file should
            // have an identity texture matrix in the texMatrices section, so it should render correctly.
            const matrix: GX.TexGenMatrix = GX.TexGenMatrix.TEXMTX0 + j * 3;
            // If we ever find a counter-example for this, I'll have to rethink the scheme, but I
            // *believe* that texture matrices should always be paired with TexGens in order.
            assert(matrixCheck === GX.TexGenMatrix.IDENTITY || matrixCheck === matrix);

            const normalize = false;
            const texGen: GX_Material.TexGen = { index, type, source, matrix, normalize, postMatrix };
            texGens[j] = texGen;
        }

        const texMatrices: TexMtx[] = [];
        for (let j = 0; j < 10; j++) {
            texMatrices[j] = null;
            const texMtxIndex = view.getInt16(materialEntryIdx + 0x48 + j * 0x02);
            if (texMtxIndex < 0)
                continue;
            texMatrices[j] = readTexMatrix(texMtxTableOffs, j, texMtxIndex);
        }
        // Since texture matrices are assigned in order, we should never actually have more than 8 of these.
        assert(texMatrices[8] === null);
        assert(texMatrices[9] === null);

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

        const indTexStages: GX_Material.IndTexStage[] = [];
        const indTexMatrices: Float32Array[] = [];

        const indirectEntryOffs = indirectTableOffset + i * 0x138;
        const hasIndirect = indirectTableOffset !== nameTableOffs;
        if (hasIndirect) {
            const indirectStageCount = view.getUint8(indirectEntryOffs + 0x00);
            assert(indirectStageCount <= 4);

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
            const channelId: GX.RasColorChannelID = GX_Material.getRasColorChannelID(view.getUint8(tevOrderOffs + 0x02));
            assert(view.getUint8(tevOrderOffs + 0x03) === 0xFF);

            // KonstSel
            const konstColorSel: GX.KonstColorSel = view.getUint8(materialEntryIdx + 0x9C + j);
            const konstAlphaSel: GX.KonstAlphaSel = view.getUint8(materialEntryIdx + 0xAC + j);

            // SetTevSwapMode
            const tevSwapModeIndex = view.getUint16(materialEntryIdx + 0x104 + j * 0x02);
            const tevSwapModeRasSel = view.getUint8(tevSwapModeInfoOffs + tevSwapModeIndex * 0x04 + 0x00);
            const tevSwapModeTexSel = view.getUint8(tevSwapModeInfoOffs + tevSwapModeIndex * 0x04 + 0x01);
            const tevSwapModeTableRasIndex = view.getUint16(materialEntryIdx + 0x124 + tevSwapModeRasSel * 0x02);
            const tevSwapModeTableTexIndex = view.getUint16(materialEntryIdx + 0x124 + tevSwapModeTexSel * 0x02);
            const rasSwapTable: GX.TevColorChan[] = [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.A];
            rasSwapTable[0] = view.getUint8(tevSwapModeTableInfoOffset + tevSwapModeTableRasIndex * 0x04 + 0x00);
            rasSwapTable[1] = view.getUint8(tevSwapModeTableInfoOffset + tevSwapModeTableRasIndex * 0x04 + 0x01);
            rasSwapTable[2] = view.getUint8(tevSwapModeTableInfoOffset + tevSwapModeTableRasIndex * 0x04 + 0x02);
            rasSwapTable[3] = view.getUint8(tevSwapModeTableInfoOffset + tevSwapModeTableRasIndex * 0x04 + 0x03);
            const texSwapTable: GX.TevColorChan[] = [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.A];
            texSwapTable[0] = view.getUint8(tevSwapModeTableInfoOffset + tevSwapModeTableTexIndex * 0x04 + 0x00);
            texSwapTable[1] = view.getUint8(tevSwapModeTableInfoOffset + tevSwapModeTableTexIndex * 0x04 + 0x01);
            texSwapTable[2] = view.getUint8(tevSwapModeTableInfoOffset + tevSwapModeTableTexIndex * 0x04 + 0x02);
            texSwapTable[3] = view.getUint8(tevSwapModeTableInfoOffset + tevSwapModeTableTexIndex * 0x04 + 0x03);

            // SetTevIndirect
            const indTexStageOffs = indirectEntryOffs + 0x04 + (0x04 * 4) + (0x1C * 3) + (0x04 * 4) + j * 0x0C;
            let indTexStage: GX.IndTexStageID = GX.IndTexStageID.STAGE0;
            let indTexFormat: GX.IndTexFormat = GX.IndTexFormat._8;
            let indTexBiasSel: GX.IndTexBiasSel = GX.IndTexBiasSel.NONE;
            let indTexMatrix: GX.IndTexMtxID = GX.IndTexMtxID.OFF;
            let indTexWrapS: GX.IndTexWrap = GX.IndTexWrap.OFF;
            let indTexWrapT: GX.IndTexWrap = GX.IndTexWrap.OFF;
            let indTexAddPrev: boolean = false;
            let indTexUseOrigLOD: boolean = false;

            if (hasIndirect) {
                indTexStage = view.getUint8(indTexStageOffs + 0x00);
                indTexFormat = view.getUint8(indTexStageOffs + 0x01);
                indTexBiasSel = view.getUint8(indTexStageOffs + 0x02);
                indTexMatrix = view.getUint8(indTexStageOffs + 0x03);
                assert(indTexMatrix <= GX.IndTexMtxID.T2);
                indTexWrapS = view.getUint8(indTexStageOffs + 0x04);
                indTexWrapT = view.getUint8(indTexStageOffs + 0x05);
                indTexAddPrev = !!view.getUint8(indTexStageOffs + 0x06);
                indTexUseOrigLOD = !!view.getUint8(indTexStageOffs + 0x07);
                // bumpAlpha
            }

            const tevStage: GX_Material.TevStage = {
                index,
                colorInA, colorInB, colorInC, colorInD, colorOp, colorBias, colorScale, colorClamp, colorRegId,
                alphaInA, alphaInB, alphaInC, alphaInD, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId,
                texCoordId, texMap, channelId,
                konstColorSel, konstAlphaSel,
                rasSwapTable,
                texSwapTable,
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
            indTexMatrices,
            colorMatRegs,
            colorAmbRegs,
            colorRegisters,
            colorConstants,
        });
    }

    function readColorChannel(tableOffs: number, colorChanIndex: number): GX_Material.ColorChannelControl {
        const colorChanOffs = colorChanTableOffs + colorChanIndex * 0x08;
        const lightingEnabled = !!view.getUint8(colorChanOffs + 0x00);
        assert(view.getUint8(colorChanOffs + 0x00) < 2);
        const matColorSource: GX.ColorSrc = view.getUint8(colorChanOffs + 0x01);
        const litMask = view.getUint8(colorChanOffs + 0x02);
        const diffuseFunction: GX.DiffuseFunction = view.getUint8(colorChanOffs + 0x03);
        const attenuationFunction: GX.AttenuationFunction = view.getUint8(colorChanOffs + 0x04);
        const ambColorSource: GX.ColorSrc = view.getUint8(colorChanOffs + 0x05);

        const colorChan: GX_Material.ColorChannelControl = { lightingEnabled, matColorSource, ambColorSource, litMask, diffuseFunction, attenuationFunction };
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

        const effectMatrix = mat4.fromValues(
            p00, p10, p20, p30,
            p01, p11, p21, p31,
            p02, p12, p22, p32,
            p03, p13, p23, p33,
        );

        const matrix = mat4.create();
        calcTexMtx(matrix, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);

        const texMtx: TexMtx = { type, projection, effectMatrix, matrix };
        return texMtx;
    }

    return { materialEntries };
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
    data: ArrayBufferSlice | null;

    // Palette data
    paletteFormat: GX.TexPalette;
    paletteData: ArrayBufferSlice | null;
}

function readBTI_Texture(buffer: ArrayBufferSlice, name: string): BTI_Texture {
    const view = buffer.createDataView();

    const format: GX.TexFormat = view.getUint8(0x00);
    const width = view.getUint16(0x02);
    const height = view.getUint16(0x04);
    const wrapS = view.getUint8(0x06);
    const wrapT = view.getUint8(0x07);
    const paletteFormat = view.getUint8(0x09);
    const paletteCount = view.getUint16(0x0A);
    const paletteOffs = view.getUint32(0x0C);
    const minFilter = view.getUint8(0x14);
    const magFilter = view.getUint8(0x15);
    const minLOD = view.getInt8(0x16) * 1/8;
    const maxLOD = view.getInt8(0x17) * 1/8;
    const mipCount = view.getUint8(0x18);
    const lodBias = view.getInt16(0x1A) * 1/100;
    const dataOffs = view.getUint32(0x1C);

    assert(minLOD === 0);

    let data: ArrayBufferSlice | null = null;
    if (dataOffs !== 0)
        data = buffer.slice(dataOffs);

    let paletteData: ArrayBufferSlice | null = null;
    if (paletteOffs !== 0)
        paletteData = buffer.subarray(paletteOffs, paletteCount * 2);

    return { name, format, width, height, wrapS, wrapT, minFilter, magFilter, minLOD, maxLOD, mipCount, lodBias, data, paletteFormat, paletteData };
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
    // The name can be used for external lookups and is required.
    name: string;
    width: number;
    height: number;
    format: GX.TexFormat;
    mipCount: number;
    data: ArrayBufferSlice | null;
    paletteFormat: GX.TexPalette;
    paletteData: ArrayBufferSlice | null;
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
                paletteFormat: btiTexture.paletteFormat,
                paletteData: btiTexture.paletteData,
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

    public maybeNextChunk(maybeChunkId: string, sizeBias: number = 0): ArrayBufferSlice {
        const chunkStart = this.offs;
        const chunkId = readString(this.buffer, chunkStart + 0x00, 4);
        const chunkSize = this.view.getUint32(chunkStart + 0x04) + sizeBias;
        if (chunkId === maybeChunkId) {
            this.offs += chunkSize;
            return this.buffer.subarray(chunkStart, chunkSize);
        } else {
            return null;
        }
    }

    public nextChunk(expectedChunkId: string, sizeBias: number = 0): ArrayBufferSlice {
        const chunkStart = this.offs;
        const chunkId = readString(this.buffer, chunkStart + 0x00, 4);
        const chunkSize = this.view.getUint32(chunkStart + 0x04) + sizeBias;
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

//#region Animation Core
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

function getAnimFrame(anim: AnimationBase, frame: number, loopMode: LoopMode = anim.loopMode): number {
    const lastFrame = anim.duration;
    const normTime = frame / lastFrame;
    const animFrame = applyLoopMode(normTime, loopMode) * lastFrame;
    return animFrame;
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
    return getPointHermite(p0, p1, s0, s1, t);
}

function findKeyframe(frames: AnimationKeyframe[], time: number): number {
    for (let i = 0; i < frames.length; i++)
        if (time < frames[i].time)
            return i;
    return -1;
}

function sampleAnimationData(track: AnimationTrack, frame: number) {
    const frames = track.frames;

    // Find the first frame.
    const idx1 = findKeyframe(frames, frame);
    if (idx1 === 0)
        return frames[0].value;
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
    texGenIndex: number;
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

    const rotationScale = Math.pow(2, rotationDecimal) / 0x7FFF;

    const sTable = buffer.createTypedArray(Float32Array, sTableOffs, sCount, Endianness.BIG_ENDIAN);
    const rTable = buffer.createTypedArray(Int16Array, rTableOffs, rCount, Endianness.BIG_ENDIAN);
    const tTable = buffer.createTypedArray(Float32Array, tTableOffs, tCount, Endianness.BIG_ENDIAN);

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
        const texGenIndex = view.getUint8(texMtxIndexTableOffs + i);
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
            materialName, remapIndex, texGenIndex,
            centerS, centerT, centerQ,
            scaleS, rotationS, translationS,
            scaleT, rotationT, translationT,
            scaleQ, rotationQ, translationQ,
         });
    }

    return { duration, loopMode, uvAnimationEntries };
}

export class TTK1Animator {
    constructor(public animationController: AnimationController, private ttk1: TTK1, private animationEntry: UVAnimationEntry) {}

    public calcTexMtx(dst: mat4): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.ttk1, frame);

        const centerS = this.animationEntry.centerS;
        const centerT = this.animationEntry.centerT;
        const centerQ = this.animationEntry.centerQ;
        const scaleS = sampleAnimationData(this.animationEntry.scaleS, animFrame);
        const scaleT = sampleAnimationData(this.animationEntry.scaleT, animFrame);
        const rotation = sampleAnimationData(this.animationEntry.rotationQ, animFrame);
        const translationS = sampleAnimationData(this.animationEntry.translationS, animFrame);
        const translationT = sampleAnimationData(this.animationEntry.translationT, animFrame);

        calcTexMtx(dst, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);
    }
}

export function bindTTK1Animator(animationController: AnimationController, ttk1: TTK1, materialName: string, texGenIndex: number): TTK1Animator | null {
    const animationEntry = ttk1.uvAnimationEntries.find((entry) => entry.materialName === materialName && entry.texGenIndex === texGenIndex);
    if (animationEntry === undefined)
        return null;

    return new TTK1Animator(animationController, ttk1, animationEntry);
}
//#endregion

//#region BTK
export class BTK {
    public static parse(buffer: ArrayBufferSlice): BTK {
        const btk = new BTK();

        const j3d = new J3DFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1btk1');

        // For some reason, TTK1 chunks have an invalid size chunk with 0x04 extra bytes.
        btk.ttk1 = readTTK1Chunk(j3d.nextChunk('TTK1', -0x04));

        return btk;
    }

    public ttk1: TTK1;
}
//#endregion

//#region TRK1
interface PaletteAnimationEntry {
    materialName: string;
    remapIndex: number;
    colorKind: ColorKind;
    r: AnimationTrack;
    g: AnimationTrack;
    b: AnimationTrack;
    a: AnimationTrack;
}

export interface TRK1 extends AnimationBase {
    animationEntries: PaletteAnimationEntry[];
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

    const animationEntries: PaletteAnimationEntry[] = [];

    const registerRTable = buffer.createTypedArray(Int16Array, registerROffs, registerRCount, Endianness.BIG_ENDIAN);
    const registerGTable = buffer.createTypedArray(Int16Array, registerGOffs, registerGCount, Endianness.BIG_ENDIAN);
    const registerBTable = buffer.createTypedArray(Int16Array, registerBOffs, registerBCount, Endianness.BIG_ENDIAN);
    const registerATable = buffer.createTypedArray(Int16Array, registerAOffs, registerACount, Endianness.BIG_ENDIAN);

    animationTableIdx = registerColorAnimationTableOffs;
    for (let i = 0; i < registerColorAnimationTableCount; i++) {
        const materialName = registerNameTable[i];
        const remapIndex = view.getUint16(registerRemapTableOffs + i * 0x02);
        const r = readAnimationTrack(registerRTable);
        const g = readAnimationTrack(registerGTable);
        const b = readAnimationTrack(registerBTable);
        const a = readAnimationTrack(registerATable);
        const colorId = view.getUint8(animationTableIdx);
        const colorKind = ColorKind.C0 + colorId;
        animationTableIdx += 0x04;
        animationEntries.push({ materialName, remapIndex, colorKind, r, g, b, a });
    }

    const konstantRTable = buffer.createTypedArray(Int16Array, konstantROffs, konstantRCount, Endianness.BIG_ENDIAN);
    const konstantGTable = buffer.createTypedArray(Int16Array, konstantGOffs, konstantGCount, Endianness.BIG_ENDIAN);
    const konstantBTable = buffer.createTypedArray(Int16Array, konstantBOffs, konstantBCount, Endianness.BIG_ENDIAN);
    const konstantATable = buffer.createTypedArray(Int16Array, konstantAOffs, konstantACount, Endianness.BIG_ENDIAN);

    animationTableIdx = konstantColorAnimationTableOffs;
    for (let i = 0; i < konstantColorAnimationTableCount; i++) {
        const materialName = konstantNameTable[i];
        const remapIndex = view.getUint16(konstantRemapTableOffs + i * 0x02);
        const r = readAnimationTrack(konstantRTable);
        const g = readAnimationTrack(konstantGTable);
        const b = readAnimationTrack(konstantBTable);
        const a = readAnimationTrack(konstantATable);
        const colorId = view.getUint8(animationTableIdx);
        const colorKind = ColorKind.K0 + colorId;
        animationTableIdx += 0x04;
        animationEntries.push({ materialName, remapIndex, colorKind, r, g, b, a });
    }

    return { duration, loopMode, animationEntries };
}

export class TRK1Animator {
    constructor(public animationController: AnimationController, private trk1: TRK1, private animationEntry: PaletteAnimationEntry) {}

    public calcColor(dst: GX_Material.Color): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.trk1, frame);

        dst.r = sampleAnimationData(this.animationEntry.r, animFrame);
        dst.g = sampleAnimationData(this.animationEntry.g, animFrame);
        dst.b = sampleAnimationData(this.animationEntry.b, animFrame);
        dst.a = sampleAnimationData(this.animationEntry.a, animFrame);
    }
}

export function bindTRK1Animator(animationController: AnimationController, trk1: TRK1, materialName: string, colorKind: ColorKind): TRK1Animator | null {
    const animationEntry = trk1.animationEntries.find((entry) => entry.materialName === materialName && entry.colorKind === colorKind);
    if (animationEntry === undefined)
        return null;

    return new TRK1Animator(animationController, trk1, animationEntry);
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

export interface ANK1 extends AnimationBase {
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

    const sTable = buffer.createTypedArray(Float32Array, sTableOffs, sCount, Endianness.BIG_ENDIAN);
    const rTable = buffer.createTypedArray(Int16Array, rTableOffs, rCount, Endianness.BIG_ENDIAN);
    const tTable = buffer.createTypedArray(Float32Array, tTableOffs, tCount, Endianness.BIG_ENDIAN);

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

export class ANK1Animator { 
    constructor(public animationController: AnimationController, public ank1: ANK1) {}

    public calcJointMatrix(dst: mat4, jointIndex: number): boolean {
        const entry = this.ank1.jointAnimationEntries[jointIndex];
        if (!entry)
            return false;

        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.ank1, frame);

        const scaleX = sampleAnimationData(entry.scaleX, animFrame);
        const scaleY = sampleAnimationData(entry.scaleY, animFrame);
        const scaleZ = sampleAnimationData(entry.scaleZ, animFrame);
        const rotationX = sampleAnimationData(entry.rotationX, animFrame) * 180;
        const rotationY = sampleAnimationData(entry.rotationY, animFrame) * 180;
        const rotationZ = sampleAnimationData(entry.rotationZ, animFrame) * 180;
        const translationX = sampleAnimationData(entry.translationX, animFrame);
        const translationY = sampleAnimationData(entry.translationY, animFrame);
        const translationZ = sampleAnimationData(entry.translationZ, animFrame);
        calcModelMtx(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        return true;
    }
}

export function bindANK1Animator(animationController: AnimationController, ank1: ANK1): ANK1Animator {
    return new ANK1Animator(animationController, ank1);
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

    public ank1: ANK1;
}
//#endregion
