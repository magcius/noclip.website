
// Implements Nintendo's J3D formats (BMD, BDL, BTK, etc.)

import { mat4, quat, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../../../ArrayBufferSlice.js';
import { Endianness } from '../../../endian.js';
import { assert, assertExists, readString } from '../../../util.js';

import { compileVtxLoader, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, getAttributeByteSize, compileLoadedVertexLayout } from '../../../gx/gx_displaylist.js';
import * as GX from '../../../gx/gx_enum.js';
import * as GX_Material from '../../../gx/gx_material.js';
import { ColorKind } from '../../../gx/gx_render.js';
import { AABB } from '../../../Geometry.js';
import BitMap from '../../../BitMap.js';
import { autoOptimizeMaterial } from '../../../gx/gx_render.js';
import { Color, colorNewFromRGBA, colorCopy, colorNewFromRGBA8, White, TransparentBlack } from '../../../Color.js';
import { readBTI_Texture, BTI_Texture } from '../JUTTexture.js';
import { quatFromEulerRadians } from '../../../MathHelpers.js';

//#region Helpers
// ResNTAB / JUTNameTab
function readStringTable(buffer: ArrayBufferSlice, offs: number): string[] {
    const view = buffer.createDataView(offs);
    const stringCount = view.getUint16(0x00);

    let tableIdx = 0x04;
    const strings = [];
    for (let i = 0; i < stringCount; i++) {
        // const hash = view.getUint16(tableIdx + 0x00);
        const stringOffs = view.getUint16(tableIdx + 0x02);
        const str = readString(buffer, offs + stringOffs, 255);
        strings.push(str);
        tableIdx += 0x04;
    }

    return strings;
}

export class JSystemFileReaderHelper {
    public view: DataView;
    public magic: string;
    public size: number;
    public numChunks: number;
    public subversion: string;
    public offs: number = 0x20;

    constructor(public buffer: ArrayBufferSlice) {
        this.view = this.buffer.createDataView();
        this.magic = readString(this.buffer, 0, 8);
        this.size = this.view.getUint32(0x08);
        this.numChunks = this.view.getUint32(0x0C);
        this.subversion = readString(this.buffer, 0x10, 0x10);
        this.offs = 0x20;
    }

    public maybeNextChunk(maybeChunkId: string, sizeBias: number = 0): ArrayBufferSlice | null {
        const chunkStart = this.offs;
        const chunkId = readString(this.buffer, chunkStart + 0x00, 4);
        if (chunkId === maybeChunkId) {
            const chunkSize = this.view.getUint32(chunkStart + 0x04) + sizeBias;
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
//#region J3DModel
//#region INF1
export const enum J3DLoadFlags {
    // Scaling rule
    ScalingRule_Basic = 0x00000000,
    ScalingRule_XSI   = 0x00000001,
    ScalingRule_Maya  = 0x00000002,
    ScalingRule_Mask  = 0x0000000F,

    // TODO(jstpierre): Document the other bits.
}

export enum HierarchyNodeType {
    // Structure
    End      = 0x00,
    Open     = 0x01,
    Close    = 0x02,
    // Children
    Joint    = 0x10,
    Material = 0x11,
    Shape    = 0x12,
};

export interface INF1 {
    hierarchyData: ArrayBufferSlice;
    loadFlags: J3DLoadFlags;
}

function readINF1Chunk(buffer: ArrayBufferSlice): INF1 {
    const view = buffer.createDataView();
    const loadFlags = view.getUint16(0x08);
    const mtxGroupCount = view.getUint32(0x0C);
    const vertexCount = view.getUint32(0x10);
    const hierarchyOffs = view.getUint32(0x14);
    const hierarchyData = buffer.slice(hierarchyOffs);
    return { hierarchyData, loadFlags };
}
//#endregion
//#region VTX1
export interface VTX1 {
    vat: GX_VtxAttrFmt[];
    arrayData: (ArrayBufferSlice | undefined)[];
}

function readVTX1Chunk(buffer: ArrayBufferSlice): VTX1 {
    const view = buffer.createDataView();
    const formatOffs = view.getUint32(0x08);
    const dataOffsLookupTable = 0x0C;

    const arrayAttribs = [
        GX.Attr.POS,
        GX.Attr.NRM,
        GX.Attr._NBT,
        GX.Attr.CLR0,
        GX.Attr.CLR1,
        GX.Attr.TEX0,
        GX.Attr.TEX1,
        GX.Attr.TEX2,
        GX.Attr.TEX3,
        GX.Attr.TEX4,
        GX.Attr.TEX5,
        GX.Attr.TEX6,
        GX.Attr.TEX7,
    ];

    let offs = formatOffs;
    const vat: GX_VtxAttrFmt[] = [];
    while (true) {
        const vtxAttrib: GX.Attr = view.getUint32(offs + 0x00);
        if (vtxAttrib === GX.Attr.NULL)
            break;

        const compCnt: GX.CompCnt = view.getUint32(offs + 0x04);
        const compType: GX.CompType = view.getUint32(offs + 0x08);
        const compShift: number = view.getUint8(offs + 0x0C);
        offs += 0x10;

        vat[vtxAttrib] = { compType, compCnt, compShift };
    }

    function getArrayData(formatIdx: number): ArrayBufferSlice | null {
        const dataOffsLookupTableEntry: number = dataOffsLookupTable + formatIdx*0x04;
        const dataStart: number = view.getUint32(dataOffsLookupTableEntry);
        if (dataStart === 0)
            return null;
        const dataEnd: number = getDataEnd(dataOffsLookupTableEntry);
        const dataOffs: number = dataStart;
        const dataSize: number = dataEnd - dataStart;
        const vtxDataBuffer = buffer.subarray(dataOffs, dataSize);
        return vtxDataBuffer;
    }

    const dataOffsLookupTableEnd: number = dataOffsLookupTable + arrayAttribs.length*0x04;
    function getDataEnd(dataOffsLookupTableEntry: number): number {
        // BMD doesn't tell us how big each data chunk is, but we need to know to figure
        // out how much data to upload. We assume the data offset lookup table is sorted
        // in order, and can figure it out by finding the next offset above us.
        let offs = dataOffsLookupTableEntry + 0x04;
        while (offs < dataOffsLookupTableEnd) {
            const dataOffs = view.getUint32(offs);
            if (dataOffs !== 0)
                return dataOffs;
            offs += 0x04;
        }
        return buffer.byteLength;
    }

    const arrayData: (ArrayBufferSlice | undefined)[] = [];
    for (let i = 0; i < arrayAttribs.length; i++) {
        const vtxAttrib = arrayAttribs[i];
        const array = getArrayData(i);
        if (array !== null)
            arrayData[vtxAttrib] = array;
    }

    return { vat, arrayData };
}
//#endregion
//#region EVP1
interface WeightedBone {
    weight: number;
    jointIndex: number;
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
            weightedBones.push({ jointIndex: index, weight });
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
    const drawMatrixCount = view.getUint16(0x08);
    const drawMatrixTypeTableOffs = view.getUint32(0x0C);
    const dataArrayOffs = view.getUint32(0x10);

    const matrixDefinitions: DRW1Matrix[] = [];
    for (let i = 0; i < drawMatrixCount; i++) {
        const kind: DRW1MatrixKind = view.getUint8(drawMatrixTypeTableOffs + i);
        const param = view.getUint16(dataArrayOffs + i * 0x02);
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
export class JointTransformInfo {
    public scale = vec3.fromValues(1.0, 1.0, 1.0);
    public rotation = quat.create();
    public translation = vec3.create();

    public copy(o: Readonly<JointTransformInfo>): void {
        vec3.copy(this.scale, o.scale);
        vec3.copy(this.translation, o.translation);
        quat.copy(this.rotation, o.rotation);
    }

    public lerp(a: Readonly<JointTransformInfo>, b: Readonly<JointTransformInfo>, t: number): void {
        vec3.lerp(this.scale, a.scale, b.scale, t);
        vec3.lerp(this.translation, a.translation, b.translation, t);
        quat.slerp(this.rotation, a.rotation, b.rotation, t);
    }
}

export interface Joint {
    name: string;
    transform: JointTransformInfo;
    boundingSphereRadius: number;
    bbox: AABB;
    calcFlags: number;
}

export interface JNT1 {
    joints: Joint[];
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
        const flags = view.getUint16(jointDataTableIdx + 0x00) & 0x00FF;
        // Maya / SoftImage special flags.
        const calcFlags = view.getUint8(jointDataTableIdx + 0x02);
        const scaleX = view.getFloat32(jointDataTableIdx + 0x04);
        const scaleY = view.getFloat32(jointDataTableIdx + 0x08);
        const scaleZ = view.getFloat32(jointDataTableIdx + 0x0C);
        const rotationX = view.getInt16(jointDataTableIdx + 0x10) / 0x7FFF * Math.PI;
        const rotationY = view.getInt16(jointDataTableIdx + 0x12) / 0x7FFF * Math.PI;
        const rotationZ = view.getInt16(jointDataTableIdx + 0x14) / 0x7FFF * Math.PI;
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

        const transform = new JointTransformInfo();
        transform.scale[0] = scaleX;
        transform.scale[1] = scaleY;
        transform.scale[2] = scaleZ;
        quatFromEulerRadians(transform.rotation, rotationX, rotationY, rotationZ);
        transform.translation[0] = translationX;
        transform.translation[1] = translationY;
        transform.translation[2] = translationZ;

        joints.push({ name, calcFlags, transform, boundingSphereRadius, bbox });
    }

    return { joints };
}
//#endregion
//#region SHP1
// A Matrix Group is a series of draw calls that use the same matrix table.
export interface MtxGroup {
    useMtxTable: Uint16Array;
    indexOffset: number;
    indexCount: number;
    loadedVertexData: LoadedVertexData;
}

export const enum ShapeMtxType {
    Mtx = 0,
    BBoard = 1,
    YBBoard = 2,
    Multi = 3,
}

export interface Shape {
    shapeMtxType: ShapeMtxType;
    loadedVertexLayout: LoadedVertexLayout;
    mtxGroups: MtxGroup[];
    bbox: AABB;
    boundingSphereRadius: number;
    materialIndex: number;
}

export interface SHP1 {
    shapes: Shape[];
}

function readSHP1Chunk(buffer: ArrayBufferSlice, bmd: BMD): SHP1 {
    const view = buffer.createDataView();
    const shapeCount = view.getUint16(0x08);
    const shapeInitDataOffs = view.getUint32(0x0C);
    const remapTableOffs = view.getUint32(0x10);
    const nameTableOffs = view.getUint32(0x14);
    const vtxDeclTableOffs = view.getUint32(0x18);
    const matrixTableOffs = view.getUint32(0x1C);
    const displayListOffs = view.getUint32(0x20);
    const shapeMtxInitDataOffs = view.getUint32(0x24);
    const shapeDrawInitDataOffs = view.getUint32(0x28);

    // Ensure that the remap table is identity.
    for (let i = 0; i < shapeCount; i++) {
        const index = view.getUint16(remapTableOffs + i * 0x02);
        assert(index === i);
    }

    if (nameTableOffs !== 0)
        console.log('Found a SHP1 that has a name table!');

    const shapes: Shape[] = [];
    let shapeInitDataIdx = shapeInitDataOffs;
    for (let i = 0; i < shapeCount; i++) {
        const shapeMtxType = view.getUint8(shapeInitDataIdx + 0x00);
        assert(view.getUint8(shapeInitDataIdx + 0x01) === 0xFF);
        const mtxGroupCount = view.getUint16(shapeInitDataIdx + 0x02);
        const vtxDeclListIndex = view.getUint16(shapeInitDataIdx + 0x04);
        const shapeMtxInitDataIndex = view.getUint16(shapeInitDataIdx + 0x06);
        const shapeDrawInitDataIndex = view.getUint16(shapeInitDataIdx + 0x08);

        const vcd: GX_VtxDesc[] = [];
        const vat: GX_VtxAttrFmt[] = [];
        const vtxArrays: GX_Array[] = [];

        let usesNBT = false;
        let vtxDeclIdx = vtxDeclTableOffs + vtxDeclListIndex;
        while (true) {
            let vtxAttrib: GX.Attr = view.getUint32(vtxDeclIdx + 0x00);
            if (vtxAttrib === GX.Attr.NULL)
                break;

            const arrayData: ArrayBufferSlice | undefined = bmd.vtx1.arrayData[vtxAttrib];

            if (vtxAttrib === GX.Attr._NBT) {
                usesNBT = true;
                vtxAttrib = GX.Attr.NRM;
                vat[vtxAttrib] = { ... bmd.vtx1.vat[vtxAttrib], compCnt: GX.CompCnt.NRM_NBT };
            } else {
                vat[vtxAttrib] = bmd.vtx1.vat[vtxAttrib];
            }

            if (arrayData !== undefined)
                vtxArrays[vtxAttrib] = { buffer: arrayData!, offs: 0, stride: getAttributeByteSize(vat, vtxAttrib) };

            const indexDataType: GX.AttrType = view.getUint32(vtxDeclIdx + 0x04);
            vcd[vtxAttrib] = { type: indexDataType };
            vtxDeclIdx += 0x08;
        }

        // Since we patch the loadedVertexLayout in some games, we need to create a fresh one every time...
        const loadedVertexLayout = compileLoadedVertexLayout(vcd, usesNBT);
        const vtxLoader = compileVtxLoader(vat, vcd);

        let shapeDrawInitDataIdx = shapeDrawInitDataOffs + (shapeDrawInitDataIndex * 0x08);
        const mtxGroups: MtxGroup[] = [];

        let totalIndexCount = 0;
        let totalVertexCount = 0;
        for (let j = 0; j < mtxGroupCount; j++, shapeDrawInitDataIdx += 0x08) {
            const displayListSize = view.getUint32(shapeDrawInitDataIdx + 0x00);
            const displayListStart = displayListOffs + view.getUint32(shapeDrawInitDataIdx + 0x04);

            const mtxGroupDataOffs = shapeMtxInitDataOffs + (shapeMtxInitDataIndex + j) * 0x08;
            const useMtxIndex = view.getUint16(mtxGroupDataOffs + 0x00);
            const useMtxCount = view.getUint16(mtxGroupDataOffs + 0x02);
            const useMtxFirstIndex = view.getUint32(mtxGroupDataOffs + 0x04);

            const useMtxTableOffs = matrixTableOffs + useMtxFirstIndex * 0x02;
            const useMtxTableSize = useMtxCount;
            const useMtxTable = buffer.createTypedArray(Uint16Array, useMtxTableOffs, useMtxTableSize, Endianness.BIG_ENDIAN);

            if (shapeMtxType === ShapeMtxType.Mtx) {
                assert(useMtxCount === 1);
                assert(useMtxIndex === useMtxTable[0]);
            }

            const displayList = buffer.subarray(displayListStart, displayListSize);
            const loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList, { firstVertexId: totalVertexCount });

            const indexOffset = totalIndexCount;
            const indexCount = loadedVertexData.totalIndexCount;
            totalIndexCount += indexCount;
            totalVertexCount += loadedVertexData.totalVertexCount;

            mtxGroups.push({ useMtxTable, indexOffset, indexCount, loadedVertexData });
        }

        const boundingSphereRadius = view.getFloat32(shapeInitDataIdx + 0x0C);
        const bboxMinX = view.getFloat32(shapeInitDataIdx + 0x10);
        const bboxMinY = view.getFloat32(shapeInitDataIdx + 0x14);
        const bboxMinZ = view.getFloat32(shapeInitDataIdx + 0x18);
        const bboxMaxX = view.getFloat32(shapeInitDataIdx + 0x1C);
        const bboxMaxY = view.getFloat32(shapeInitDataIdx + 0x20);
        const bboxMaxZ = view.getFloat32(shapeInitDataIdx + 0x24);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

        const materialIndex = -1;

        // Now we should have a complete shape. Onto the next!
        shapes.push({ shapeMtxType, loadedVertexLayout, mtxGroups, bbox, boundingSphereRadius, materialIndex });

        shapeInitDataIdx += 0x28;
    }

    return { shapes };
}
//#endregion
//#region MAT3
export const enum TexMtxMapMode {
    None = 0x00,
    // Uses "Basic" conventions, no -1...1 remap.
    // Peach Beach uses EnvmapBasic, not sure on what yet...
    EnvmapBasic = 0x01,
    ProjmapBasic = 0x02,
    ViewProjmapBasic = 0x03,
    // Unknown: 0x04, 0x05. No known uses.
    // Uses "Old" conventions, remaps translation in fourth component
    // TODO(jstpierre): Figure out the geometric interpretation of old vs. new
    EnvmapOld = 0x06,
    // Uses "New" conventions, remaps translation in third component
    Envmap = 0x07,
    Projmap = 0x08,
    ViewProjmap = 0x09,
    // Environment map, but based on a custom effect matrix instead of the default view
    // matrix. Used by certain actors in Wind Waker, like zouK1 in Master Sword Chamber.
    EnvmapOldEffectMtx = 0x0A,
    EnvmapEffectMtx = 0x0B,
}

export const enum TexMtxProjection {
    MTX3x4 = 0,
    MTX2x4 = 1,
}

export interface TexMtx {
    info: number;
    projection: TexMtxProjection;
    effectMatrix: mat4;
    matrix: mat4;
}

export interface MaterialEntry {
    index: number;
    name: string;
    materialMode: number;
    translucent: boolean;
    textureIndexes: number[];
    gxMaterial: GX_Material.GXMaterial;
    texMatrices: (TexMtx | null)[];
    indTexMatrices: Float32Array[];
    colorMatRegs: Color[];
    colorAmbRegs: Color[];
    colorConstants: Color[];
    colorRegisters: Color[];
    fogBlock: GX_Material.FogBlock;
}

export interface MAT3 {
    materialEntries: MaterialEntry[];
}

export function calcTexMtx_Basic(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number, centerS: number, centerT: number): void {
    const theta = rotation * Math.PI;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    mat4.identity(dst);

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleS * -sinR;
    dst[12] = translationS + centerS - (dst[0] * centerS + dst[4] * centerT);

    dst[1]  = scaleT *  sinR;
    dst[5]  = scaleT *  cosR;
    dst[13] = translationT + centerT - (dst[1] * centerS + dst[5] * centerT);
}

export function calcTexMtx_Maya(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    const theta = rotation * Math.PI;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    mat4.identity(dst);

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleS *  sinR;
    dst[12] = scaleS * ((-0.5 * cosR) - (0.5 * sinR - 0.5) - translationS);

    dst[1]  = scaleT * -sinR;
    dst[5]  = scaleT *  cosR;
    dst[13] = scaleT * ((-0.5 * cosR) + (0.5 * sinR - 0.5) + translationT) + 1.0;
}

function readColorU8(view: DataView, srcOffs: number): Color {
    return colorNewFromRGBA8(view.getUint32(srcOffs + 0x00));
}

function readColorS16(view: DataView, srcOffs: number): Color {
    const r = view.getInt16(srcOffs + 0x00) / 0xFF;
    const g = view.getInt16(srcOffs + 0x02) / 0xFF;
    const b = view.getInt16(srcOffs + 0x04) / 0xFF;
    const a = view.getInt16(srcOffs + 0x06) / 0xFF;
    return colorNewFromRGBA(r, g, b, a);
}

function readColorChannel(view: DataView, colorChanOffs: number, colorChanIndex: number): GX_Material.ColorChannelControl {
    if (colorChanIndex !== 0xFFFF) {
        const colorChanIdx = colorChanOffs + colorChanIndex * 0x08;
        const lightingEnabled = !!view.getUint8(colorChanIdx + 0x00);
        assert(view.getUint8(colorChanIdx + 0x00) < 2);
        const matColorSource: GX.ColorSrc = view.getUint8(colorChanIdx + 0x01);
        const litMask = view.getUint8(colorChanIdx + 0x02);
        const diffuseFunction: GX.DiffuseFunction = view.getUint8(colorChanIdx + 0x03);
        const attnFn = view.getUint8(colorChanIdx + 0x04);
        const attenuationFunction: GX.AttenuationFunction = (
            attnFn === 0 ? GX.AttenuationFunction.SPEC :
            attnFn === 1 ? GX.AttenuationFunction.SPOT :
                           GX.AttenuationFunction.NONE
        );
        const ambColorSource: GX.ColorSrc = view.getUint8(colorChanIdx + 0x05);

        return { lightingEnabled, matColorSource, ambColorSource, litMask, diffuseFunction, attenuationFunction };
    } else {
        const lightingEnabled = false;
        const matColorSource: GX.ColorSrc = GX.ColorSrc.REG;
        const litMask = 0;
        const diffuseFunction: GX.DiffuseFunction = GX.DiffuseFunction.CLAMP;
        const attenuationFunction: GX.AttenuationFunction = GX.AttenuationFunction.NONE;
        const ambColorSource: GX.ColorSrc = GX.ColorSrc.REG;
        return { lightingEnabled, matColorSource, ambColorSource, litMask, diffuseFunction, attenuationFunction };
    }
}

function readTexMatrix(view: DataView, tableOffs: number, texMtxIndex: number): TexMtx {
    const texMtxOffs = tableOffs + texMtxIndex * 0x64;
    const projection: TexMtxProjection = view.getUint8(texMtxOffs + 0x00);
    const info = view.getUint8(texMtxOffs + 0x01);

    const matrixMode = info & 0x3F;

    // Detect uses of unlikely map modes.
    if (matrixMode === TexMtxMapMode.ProjmapBasic || matrixMode === TexMtxMapMode.ViewProjmapBasic ||
        matrixMode === 0x04 || matrixMode === 0x05) {
        console.log(`Unusual matrix map mode:`, matrixMode);
        debugger;
    }

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

    const isMaya = !!(info >>> 7);
    if (isMaya) {
        calcTexMtx_Maya(matrix, scaleS, scaleT, rotation, translationS, translationT);
    } else {
        calcTexMtx_Basic(matrix, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT);
    }

    const texMtx: TexMtx = { info, projection, effectMatrix, matrix };
    return texMtx;
}

function readMAT2Chunk(buffer: ArrayBufferSlice): MAT3 {
    const view = buffer.createDataView();
    const materialCount = view.getUint16(0x08);

    const remapTableOffs = view.getUint32(0x10);
    const remapTable: number[] = [];
    for (let i = 0; i < materialCount; i++)
        remapTable[i] = view.getUint16(remapTableOffs + i * 0x02);

    const nameTableOffs = view.getUint32(0x14);
    const nameTable = readStringTable(buffer, nameTableOffs);

    const cullModeOffs = view.getUint32(0x18);
    const matColorOffs = view.getUint32(0x1C);
    const colorChanNumOffs = view.getUint32(0x20);
    const colorChanOffs = view.getUint32(0x24);
    const texGenNumOffs = view.getUint32(0x28);
    const texCoordOffs = view.getUint32(0x2C);
    const postTexCoordOffs = view.getUint32(0x30);
    const texMtxOffs = view.getUint32(0x34);
    const postTexMtxOffs = view.getUint32(0x38);
    const texNoOffs = view.getUint32(0x3C);
    const tevOrderOffs = view.getUint32(0x40);
    const tevColorOffs = view.getUint32(0x44);
    const tevKColorOffs = view.getUint32(0x48);
    const tevStageNumOffs = view.getUint32(0x4C);
    const tevStageOffs = view.getUint32(0x50);
    const tevSwapModeOffs = view.getUint32(0x54);
    const tevSwapModeTableOffs = view.getUint32(0x58);
    const fogOffs = view.getUint32(0x5C);
    const alphaCompOffs = view.getUint32(0x60);
    const blendOffs = view.getUint32(0x64);
    const zModeOffs = view.getUint32(0x68);
    const zCompLocOffs = view.getUint32(0x6C);
    const ditherOffs = view.getUint32(0x70);
    const nbtScaleOffs = view.getUint32(0x74);

    const materialEntries: MaterialEntry[] = [];
    const materialEntryTableOffs = view.getUint32(0x0C);
    for (let i = 0; i < materialCount; i++) {
        const index = i;
        const name = nameTable[i];
        const materialEntryIdx = materialEntryTableOffs + (0x0138 * remapTable[i]);

        const materialMode = view.getUint8(materialEntryIdx + 0x00);
        const cullModeIndex = view.getUint8(materialEntryIdx + 0x01);
        const colorChanNumIndex = view.getUint8(materialEntryIdx + 0x02);
        // const texGenNumIndex = view.getUint8(materialEntryIdx + 0x03);
        // const tevStageNumIndex = view.getUint8(materialEntryIdx + 0x04);
        // const zCompLocIndex = view.getUint8(materialEntryIdx + 0x05);
        const zModeIndex = view.getUint8(materialEntryIdx + 0x06);
        // const ditherIndex = view.getUint8(materialEntryIdx + 0x07);

        const colorMatRegs: Color[] = [];
        for (let j = 0; j < 2; j++) {
            const matColorIndex = view.getUint16(materialEntryIdx + 0x08 + j * 0x02);
            if (matColorIndex !== 0xFFFF)
                colorMatRegs.push(readColorU8(view, matColorOffs + matColorIndex * 0x04));
            else
                colorMatRegs.push(White);
        }

        const colorAmbRegs: Color[] = [White, White];

        const lightChannelCount = view.getUint8(colorChanNumOffs + colorChanNumIndex);
        const lightChannels: GX_Material.LightChannelControl[] = [];
        for (let j = 0; j < lightChannelCount; j++) {
            const colorChannel = readColorChannel(view, colorChanOffs, view.getUint16(materialEntryIdx + 0x0C + (j * 2 + 0) * 0x02));
            const alphaChannel = readColorChannel(view, colorChanOffs, view.getUint16(materialEntryIdx + 0x0C + (j * 2 + 1) * 0x02));
            lightChannels.push({ colorChannel, alphaChannel });
        }

        const texMatrices: (TexMtx | null)[] = [];
        for (let j = 0; j < 10; j++) {
            const texMtxIndex = view.getInt16(materialEntryIdx + 0x34 + j * 0x02);
            if (texMtxOffs > 0 && texMtxIndex >= 0)
                texMatrices[j] = readTexMatrix(view, texMtxOffs, texMtxIndex);
            else
                texMatrices[j] = null;
        }
        // Since texture matrices are assigned to TEV stages in order, we
        // should never actually have more than 8 of these.
        assert(texMatrices[8] === null);
        assert(texMatrices[9] === null);

        const texGens: GX_Material.TexGen[] = [];
        for (let j = 0; j < 8; j++) {
            const texCoordIndex = view.getInt16(materialEntryIdx + 0x14 + j * 0x02);
            if (texCoordIndex < 0)
                continue;
            const texCoordIdx = texCoordOffs + texCoordIndex * 0x04;
            const type: GX.TexGenType = view.getUint8(texCoordIdx + 0x00);
            const source: GX.TexGenSrc = view.getUint8(texCoordIdx + 0x01);
            const texGenMatrix: GX.TexGenMatrix = view.getUint8(texCoordIdx + 0x02);
            assert(view.getUint8(texCoordIdx + 0x03) === 0xFF);

            // BTK can apply texture animations to materials that have the matrix set to IDENTITY.
            // For this reason, we always assign a texture matrix.
            //
            // If we ever find a counter-example for this, I'll have to rethink the scheme, but I
            // *believe* that texture matrices should always be paired with TexGens in order.
            const matrix: GX.TexGenMatrix = GX.TexGenMatrix.TEXMTX0 + j * 3;
            assert(texGenMatrix === GX.TexGenMatrix.IDENTITY || texGenMatrix === matrix);

            if (texGenMatrix === GX.TexGenMatrix.IDENTITY && texMatrices[j] !== null) {
                // If this is an identity matrix, then clear out the matrix in that file.
                mat4.identity(texMatrices[j]!.matrix);
            }

            const normalize = false;
            const postMatrix: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY;
            const texGen: GX_Material.TexGen = { type, source, matrix, normalize, postMatrix };
            texGens[j] = texGen;
        }

        const textureIndexes = [];
        for (let j = 0; j < 8; j++) {
            const textureTableIndex = view.getUint16(materialEntryIdx + 0x70 + j * 0x02);
            if (textureTableIndex !== 0xFFFF)
                textureIndexes.push(view.getUint16(texNoOffs + textureTableIndex * 0x02));
            else
                textureIndexes.push(-1);
        }

        const colorConstants: Color[] = [];
        for (let j = 0; j < 4; j++) {
            const colorIndex = view.getUint16(materialEntryIdx + 0x80 + j * 0x02);
            if (colorIndex !== 0xFFFF)
                colorConstants.push(readColorU8(view, tevKColorOffs + colorIndex * 0x04));
            else
                colorConstants.push(White);
        }

        const colorRegisters: Color[] = [];
        for (let j = 0; j < 4; j++) {
            const colorIndex = view.getUint16(materialEntryIdx + 0xC8 + j * 0x02);
            if (colorIndex !== 0xFFFF)
                colorRegisters.push(readColorS16(view, tevColorOffs + colorIndex * 0x08));
            else
                colorRegisters.push(TransparentBlack);
        }

        const indTexStages: GX_Material.IndTexStage[] = [];
        const indTexMatrices: Float32Array[] = [];

        const tevStages: GX_Material.TevStage[] = [];
        for (let j = 0; j < 16; j++) {
            // TevStage
            const tevStageIndex = view.getInt16(materialEntryIdx + 0xD0 + j * 0x02);
            if (tevStageIndex < 0)
                continue;

            const tevStageIdx = tevStageOffs + tevStageIndex * 0x14;

            // const tevMode = view.getUint8(tevStageOffs + 0x00);
            const colorInA: GX.CC = view.getUint8(tevStageIdx + 0x01);
            const colorInB: GX.CC = view.getUint8(tevStageIdx + 0x02);
            const colorInC: GX.CC = view.getUint8(tevStageIdx + 0x03);
            const colorInD: GX.CC = view.getUint8(tevStageIdx + 0x04);
            const colorOp: GX.TevOp = view.getUint8(tevStageIdx + 0x05);
            const colorBias: GX.TevBias = view.getUint8(tevStageIdx + 0x06);
            const colorScale: GX.TevScale = view.getUint8(tevStageIdx + 0x07);
            const colorClamp: boolean = !!view.getUint8(tevStageIdx + 0x08);
            const colorRegId: GX.Register = view.getUint8(tevStageIdx + 0x09);

            const alphaInA: GX.CA = view.getUint8(tevStageIdx + 0x0A);
            const alphaInB: GX.CA = view.getUint8(tevStageIdx + 0x0B);
            const alphaInC: GX.CA = view.getUint8(tevStageIdx + 0x0C);
            const alphaInD: GX.CA = view.getUint8(tevStageIdx + 0x0D);
            const alphaOp: GX.TevOp = view.getUint8(tevStageIdx + 0x0E);
            const alphaBias: GX.TevBias = view.getUint8(tevStageIdx + 0x0F);
            const alphaScale: GX.TevScale = view.getUint8(tevStageIdx + 0x10);
            const alphaClamp: boolean = !!view.getUint8(tevStageIdx + 0x11);
            const alphaRegId: GX.Register = view.getUint8(tevStageIdx + 0x12);

            // TevOrder
            const tevOrderIndex = view.getUint16(materialEntryIdx + 0xA8 + j * 0x02);
            const tevOrderIdx = tevOrderOffs + tevOrderIndex * 0x04;
            const texCoordId: GX.TexCoordID = view.getUint8(tevOrderIdx + 0x00);
            const texMap: number = view.getUint8(tevOrderIdx + 0x01);
            const channelId: GX.RasColorChannelID = GX_Material.getRasColorChannelID(view.getUint8(tevOrderIdx + 0x02));
            assert(view.getUint8(tevOrderIdx + 0x03) === 0xFF);

            // KonstSel
            const konstColorSel: GX.KonstColorSel = view.getUint8(materialEntryIdx + 0x88 + j);
            const konstAlphaSel: GX.KonstAlphaSel = view.getUint8(materialEntryIdx + 0x98 + j);

            // SetTevSwapMode
            const tevSwapModeIndex = view.getUint16(materialEntryIdx + 0xF0 + j * 0x02);
            let rasSwapTable: readonly [number, number, number, number] = [0, 1, 2, 3] as const;
            let texSwapTable: readonly [number, number, number, number] = [0, 1, 2, 3] as const;
            if (tevSwapModeIndex !== 0xFFFF) {
                const tevSwapModeRasSel = view.getUint8(tevSwapModeOffs + tevSwapModeIndex * 0x04 + 0x00);
                const tevSwapModeTexSel = view.getUint8(tevSwapModeOffs + tevSwapModeIndex * 0x04 + 0x01);
                const tevSwapModeTableRasIndex = view.getUint16(materialEntryIdx + 0x110 + tevSwapModeRasSel * 0x02);
                const tevSwapModeTableTexIndex = view.getUint16(materialEntryIdx + 0x110 + tevSwapModeTexSel * 0x02);
                const rasSwapA = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableRasIndex * 0x04 + 0x00);
                const rasSwapB = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableRasIndex * 0x04 + 0x01);
                const rasSwapC = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableRasIndex * 0x04 + 0x02);
                const rasSwapD = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableRasIndex * 0x04 + 0x03);
                const texSwapA = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableTexIndex * 0x04 + 0x00);
                const texSwapB = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableTexIndex * 0x04 + 0x01);
                const texSwapC = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableTexIndex * 0x04 + 0x02);
                const texSwapD = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableTexIndex * 0x04 + 0x03);

                rasSwapTable = [rasSwapA, rasSwapB, rasSwapC, rasSwapD] as const;
                texSwapTable = [texSwapA, texSwapB, texSwapC, texSwapD] as const;
            }

            const tevStage: GX_Material.TevStage = {
                colorInA, colorInB, colorInC, colorInD, colorOp, colorBias, colorScale, colorClamp, colorRegId,
                alphaInA, alphaInB, alphaInC, alphaInD, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId,
                texCoordId, texMap, channelId,
                konstColorSel, konstAlphaSel,
                rasSwapTable,
                texSwapTable,
                indTexStage: GX.IndTexStageID.STAGE0,
                indTexFormat: GX.IndTexFormat._8,
                indTexBiasSel: GX.IndTexBiasSel.NONE,
                indTexAlphaSel: GX.IndTexAlphaSel.OFF,
                indTexMatrix: GX.IndTexMtxID.OFF,
                indTexWrapS: GX.IndTexWrap.OFF,
                indTexWrapT: GX.IndTexWrap.OFF,
                indTexAddPrev: false,
                indTexUseOrigLOD: false,
            };
            tevStages.push(tevStage);
        }

        // SetAlphaCompare
        const alphaCompIndex = view.getUint16(materialEntryIdx + 0x132);
        const alphaCompIdx = alphaCompOffs + alphaCompIndex * 0x08;
        const compareA: GX.CompareType = view.getUint8(alphaCompIdx + 0x00);
        const referenceA: number = view.getUint8(alphaCompIdx + 0x01) / 0xFF;
        const op: GX.AlphaOp = view.getUint8(alphaCompIdx + 0x02);
        const compareB: GX.CompareType = view.getUint8(alphaCompIdx + 0x03);
        const referenceB: number = view.getUint8(alphaCompIdx + 0x04) / 0xFF;
        const alphaTest: GX_Material.AlphaTest = { compareA, referenceA, op, compareB, referenceB };

        // SetBlendMode
        const blendModeIndex = view.getUint16(materialEntryIdx + 0x134);
        const blendIdx = blendOffs + blendModeIndex * 0x04;
        const blendMode: GX.BlendMode = view.getUint8(blendIdx + 0x00);
        const blendSrcFactor: GX.BlendFactor = view.getUint8(blendIdx + 0x01);
        const blendDstFactor: GX.BlendFactor = view.getUint8(blendIdx + 0x02);
        const blendLogicOp: GX.LogicOp = view.getUint8(blendIdx + 0x03);

        const cullMode: GX.CullMode = view.getUint32(cullModeOffs + cullModeIndex * 0x04);
        const zModeIdx = zModeOffs + zModeIndex * 4;
        const depthTest: boolean = !!view.getUint8(zModeIdx + 0x00);
        const depthFunc: GX.CompareType = view.getUint8(zModeIdx + 0x01);
        const depthWrite: boolean = !!view.getUint8(zModeIdx + 0x02);

        const fogInfoIndex = view.getUint16(materialEntryIdx + 0x130);
        let fogType = GX.FogType.NONE;
        let fogAdjEnabled = false;
        const fogBlock = new GX_Material.FogBlock();
        if (fogInfoIndex !== 0xFFFF) {
            const fogIdx = fogOffs + fogInfoIndex * 0x2C;
            fogType = view.getUint8(fogIdx + 0x00);
            fogAdjEnabled = !!view.getUint8(fogIdx + 0x01);
            const fogAdjCenter = view.getUint16(fogIdx + 0x02);
            const fogStartZ = view.getFloat32(fogIdx + 0x04);
            const fogEndZ = view.getFloat32(fogIdx + 0x08);
            const fogNearZ = view.getFloat32(fogIdx + 0x0C);
            const fogFarZ = view.getFloat32(fogIdx + 0x10);
            const fogColor = readColorU8(view, fogIdx + 0x14);
            const fogAdjTable = buffer.createTypedArray(Uint16Array, fogIdx + 0x18, 10, Endianness.BIG_ENDIAN);

            GX_Material.fogBlockSet(fogBlock, fogType, fogStartZ, fogEndZ, fogNearZ, fogFarZ);
            colorCopy(fogBlock.Color, fogColor);
            fogBlock.AdjTable.set(fogAdjTable);
            fogBlock.AdjCenter = fogAdjCenter;
        }

        const translucent = materialMode === 0x04;
        const colorUpdate = true, alphaUpdate = false;

        const ropInfo: GX_Material.RopInfo = {
            fogType, fogAdjEnabled,
            blendMode, blendSrcFactor, blendDstFactor, blendLogicOp,
            depthTest, depthFunc, depthWrite,
            colorUpdate, alphaUpdate,
        };

        const gxMaterial: GX_Material.GXMaterial = {
            name,
            cullMode,
            lightChannels,
            texGens,
            tevStages,
            indTexStages,
            alphaTest,
            ropInfo,
        };

        autoOptimizeMaterial(gxMaterial);

        materialEntries.push({
            index, name,
            materialMode, translucent,
            textureIndexes,
            texMatrices,
            gxMaterial,
            indTexMatrices,
            colorMatRegs,
            colorAmbRegs,
            colorRegisters,
            colorConstants,
            fogBlock,
        });
    }

    return { materialEntries };
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

    const indirectOffs = view.getUint32(0x18);
    const cullModeOffs = view.getUint32(0x1C);
    const matColorOffs = view.getUint32(0x20);
    const colorChanNumOffs = view.getUint32(0x24);
    const colorChanOffs = view.getUint32(0x28);
    const ambColorOffs = view.getUint32(0x2C);
    const texGenNumOffs = view.getUint32(0x34);
    const texCoordOffs = view.getUint32(0x38);
    const postTexCoordOffs = view.getUint32(0x3C);
    const texMtxOffs = view.getUint32(0x40);
    const postTexMtxOffs = view.getUint32(0x44);
    const texNoOffs = view.getUint32(0x48);
    const tevOrderOffs = view.getUint32(0x4C);
    const tevColorOffs = view.getUint32(0x50);
    const tevKColorOffs = view.getUint32(0x54);
    const tevStageOffs = view.getUint32(0x5C);
    const tevSwapModeOffs = view.getUint32(0x60);
    const tevSwapModeTableOffs = view.getUint32(0x64);
    const fogOffs = view.getUint32(0x68);
    const alphaCompOffs = view.getUint32(0x6C);
    const blendOffs = view.getUint32(0x70);
    const zModeOffs = view.getUint32(0x74);
    const zCompOffs = view.getUint32(0x78);
    const ditherOffs = view.getUint32(0x7C);
    const nbtScaleOffs = view.getUint32(0x80);

    const materialEntries: MaterialEntry[] = [];
    const materialEntryTableOffs = view.getUint32(0x0C);
    for (let i = 0; i < materialCount; i++) {
        const index = i;
        const name = nameTable[i];
        const materialEntryIdx = materialEntryTableOffs + (0x014C * remapTable[i]);

        const materialMode = view.getUint8(materialEntryIdx + 0x00);
        // I believe this is a bitfield with three bits:
        //   0x01: OPA (Opaque)
        //   0x02: EDG (TexEdge / Masked)
        //   0x04: XLU (Translucent)
        // I haven't seen anything but OPA/XLU in the wild.
        assert(materialMode === 0x01 || materialMode === 0x04);
        const cullModeIndex = view.getUint8(materialEntryIdx + 0x01);
        const colorChanNumIndex = view.getUint8(materialEntryIdx + 0x02);
        // const texGenNumIndex = view.getUint8(materialEntryIdx + 0x03);
        // const tevStageNumIndex = view.getUint8(materialEntryIdx + 0x04);
        // const zCompLocIndex = view.getUint8(materialEntryIdx + 0x05);
        const zModeIndex = view.getUint8(materialEntryIdx + 0x06);
        // const ditherIndex = view.getUint8(materialEntryIdx + 0x07);

        const colorMatRegs: Color[] = [];
        for (let j = 0; j < 2; j++) {
            const matColorIndex = view.getUint16(materialEntryIdx + 0x08 + j * 0x02);
            if (matColorIndex !== 0xFFFF)
                colorMatRegs.push(readColorU8(view, matColorOffs + matColorIndex * 0x04));
            else
                colorMatRegs.push(White);
        }

        const colorAmbRegs: Color[] = [];
        for (let j = 0; j < 2; j++) {
            const ambColorIndex = view.getUint16(materialEntryIdx + 0x14 + j * 0x02);
            if (ambColorIndex !== 0xFFFF)
                colorAmbRegs.push(readColorU8(view, ambColorOffs + ambColorIndex * 0x04));
            else
                colorAmbRegs.push(White);
        }

        const lightChannelCount = view.getUint8(colorChanNumOffs + colorChanNumIndex);
        const lightChannels: GX_Material.LightChannelControl[] = [];
        for (let j = 0; j < lightChannelCount; j++) {
            const colorChannel = readColorChannel(view, colorChanOffs, view.getUint16(materialEntryIdx + 0x0C + (j * 2 + 0) * 0x02));
            const alphaChannel = readColorChannel(view, colorChanOffs, view.getUint16(materialEntryIdx + 0x0C + (j * 2 + 1) * 0x02));
            lightChannels.push({ colorChannel, alphaChannel });
        }

        const texMatrices: (TexMtx | null)[] = [];
        for (let j = 0; j < 10; j++) {
            const texMtxIndex = view.getInt16(materialEntryIdx + 0x48 + j * 0x02);
            if (texMtxOffs > 0 && texMtxIndex >= 0)
                texMatrices[j] = readTexMatrix(view, texMtxOffs, texMtxIndex);
            else
                texMatrices[j] = null;
        }
        // Since texture matrices are assigned to TEV stages in order, we
        // should never actually have more than 8 of these.
        assert(texMatrices[8] === null);
        assert(texMatrices[9] === null);

        const texGens: GX_Material.TexGen[] = [];
        for (let j = 0; j < 8; j++) {
            const texCoordIndex = view.getInt16(materialEntryIdx + 0x28 + j * 0x02);
            if (texCoordIndex < 0)
                continue;
            const texCoordIdx = texCoordOffs + texCoordIndex * 0x04;
            const type: GX.TexGenType = view.getUint8(texCoordIdx + 0x00);
            const source: GX.TexGenSrc = view.getUint8(texCoordIdx + 0x01);
            const texGenMatrix: GX.TexGenMatrix = view.getUint8(texCoordIdx + 0x02);
            assert(view.getUint8(texCoordIdx + 0x03) === 0xFF);

            // BTK can apply texture animations to materials that have the matrix set to IDENTITY.
            // For this reason, we always assign a texture matrix.
            //
            // If we ever find a counter-example for this, I'll have to rethink the scheme, but I
            // *believe* that texture matrices should always be paired with TexGens in order.
            const matrix: GX.TexGenMatrix = GX.TexGenMatrix.TEXMTX0 + j * 3;
            assert(texGenMatrix === GX.TexGenMatrix.IDENTITY || texGenMatrix === matrix);

            if (texGenMatrix === GX.TexGenMatrix.IDENTITY && texMatrices[j] !== null) {
                // If this is an identity matrix, then clear out the matrix in that file.
                mat4.identity(texMatrices[j]!.matrix);
            }

            const normalize = false;
            const postMatrix: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY;
            const texGen: GX_Material.TexGen = { type, source, matrix, normalize, postMatrix };
            texGens[j] = texGen;
        }

        const textureIndexes = [];
        for (let j = 0; j < 8; j++) {
            const textureTableIndex = view.getUint16(materialEntryIdx + 0x84 + j * 0x02);
            if (textureTableIndex !== 0xFFFF)
                textureIndexes.push(view.getUint16(texNoOffs + textureTableIndex * 0x02));
            else
                textureIndexes.push(-1);
        }

        const colorConstants: Color[] = [];
        for (let j = 0; j < 4; j++) {
            const colorIndex = view.getUint16(materialEntryIdx + 0x94 + j * 0x02);
            if (colorIndex !== 0xFFFF)
                colorConstants.push(readColorU8(view, tevKColorOffs + colorIndex * 0x04));
            else
                colorConstants.push(White);
        }

        const colorRegisters: Color[] = [];
        for (let j = 0; j < 4; j++) {
            const colorIndex = view.getUint16(materialEntryIdx + 0xDC + j * 0x02);
            if (colorIndex !== 0xFFFF)
                colorRegisters.push(readColorS16(view, tevColorOffs + colorIndex * 0x08));
            else
                colorRegisters.push(TransparentBlack);
        }

        const indTexStages: GX_Material.IndTexStage[] = [];
        const indTexMatrices: Float32Array[] = [];

        const indirectEntryOffs = indirectOffs + i * 0x138;
        let hasIndirect = false;

        if (indirectOffs !== nameTableOffs)
            hasIndirect = (view.getUint8(indirectEntryOffs + 0x00) === 1);

        if (hasIndirect) {
            const indTexStageNum = view.getUint8(indirectEntryOffs + 0x01);
            assert(indTexStageNum <= 4);

            for (let j = 0; j < indTexStageNum; j++) {
                // SetIndTexOrder
                const indTexOrderOffs = indirectEntryOffs + 0x04 + j * 0x04;
                const texCoordId: GX.TexCoordID = view.getUint8(indTexOrderOffs + 0x00);
                const texture: GX.TexMapID = view.getUint8(indTexOrderOffs + 0x01);
                // SetIndTexCoordScale
                const indTexScaleOffs = indirectEntryOffs + 0x04 + (0x04 * 4) + (0x1C * 3) + j * 0x04;
                const scaleS: GX.IndTexScale = view.getUint8(indTexScaleOffs + 0x00);
                const scaleT: GX.IndTexScale = view.getUint8(indTexScaleOffs + 0x01);
                indTexStages.push({ texCoordId, texture, scaleS, scaleT });
                // SetIndTexMatrix
                const indTexMatrixOffs = indirectEntryOffs + 0x04 + (0x04 * 4) + j * 0x1C;
                const p00 = view.getFloat32(indTexMatrixOffs + 0x00);
                const p01 = view.getFloat32(indTexMatrixOffs + 0x04);
                const p02 = view.getFloat32(indTexMatrixOffs + 0x08);
                const p10 = view.getFloat32(indTexMatrixOffs + 0x0C);
                const p11 = view.getFloat32(indTexMatrixOffs + 0x10);
                const p12 = view.getFloat32(indTexMatrixOffs + 0x14);
                const scale = Math.pow(2, view.getInt8(indTexMatrixOffs + 0x18));
                const m = new Float32Array([
                    p00*scale, p01*scale, p02*scale, scale,
                    p10*scale, p11*scale, p12*scale, 0.0,
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

            const tevStageIdx = tevStageOffs + tevStageIndex * 0x14;

            // const tevMode = view.getUint8(tevStageOffs + 0x00);
            const colorInA: GX.CC = view.getUint8(tevStageIdx + 0x01);
            const colorInB: GX.CC = view.getUint8(tevStageIdx + 0x02);
            const colorInC: GX.CC = view.getUint8(tevStageIdx + 0x03);
            const colorInD: GX.CC = view.getUint8(tevStageIdx + 0x04);
            const colorOp: GX.TevOp = view.getUint8(tevStageIdx + 0x05);
            const colorBias: GX.TevBias = view.getUint8(tevStageIdx + 0x06);
            const colorScale: GX.TevScale = view.getUint8(tevStageIdx + 0x07);
            const colorClamp: boolean = !!view.getUint8(tevStageIdx + 0x08);
            const colorRegId: GX.Register = view.getUint8(tevStageIdx + 0x09);

            const alphaInA: GX.CA = view.getUint8(tevStageIdx + 0x0A);
            const alphaInB: GX.CA = view.getUint8(tevStageIdx + 0x0B);
            const alphaInC: GX.CA = view.getUint8(tevStageIdx + 0x0C);
            const alphaInD: GX.CA = view.getUint8(tevStageIdx + 0x0D);
            const alphaOp: GX.TevOp = view.getUint8(tevStageIdx + 0x0E);
            const alphaBias: GX.TevBias = view.getUint8(tevStageIdx + 0x0F);
            const alphaScale: GX.TevScale = view.getUint8(tevStageIdx + 0x10);
            const alphaClamp: boolean = !!view.getUint8(tevStageIdx + 0x11);
            const alphaRegId: GX.Register = view.getUint8(tevStageIdx + 0x12);

            // TevOrder
            const tevOrderIndex = view.getUint16(materialEntryIdx + 0xBC + j * 0x02);
            const tevOrderIdx = tevOrderOffs + tevOrderIndex * 0x04;
            const texCoordId: GX.TexCoordID = view.getUint8(tevOrderIdx + 0x00);
            const texMap: number = view.getUint8(tevOrderIdx + 0x01);
            const channelId: GX.RasColorChannelID = GX_Material.getRasColorChannelID(view.getUint8(tevOrderIdx + 0x02));
            assert(view.getUint8(tevOrderIdx + 0x03) === 0xFF);

            // KonstSel
            const konstColorSel: GX.KonstColorSel = view.getUint8(materialEntryIdx + 0x9C + j);
            const konstAlphaSel: GX.KonstAlphaSel = view.getUint8(materialEntryIdx + 0xAC + j);

            // SetTevSwapMode
            const tevSwapModeIndex = view.getUint16(materialEntryIdx + 0x104 + j * 0x02);
            let rasSwapTable: readonly [number, number, number, number] = [0, 1, 2, 3] as const;
            let texSwapTable: readonly [number, number, number, number] = [0, 1, 2, 3] as const;
            if (tevSwapModeIndex !== 0xFFFF) {
                const tevSwapModeRasSel = view.getUint8(tevSwapModeOffs + tevSwapModeIndex * 0x04 + 0x00);
                const tevSwapModeTexSel = view.getUint8(tevSwapModeOffs + tevSwapModeIndex * 0x04 + 0x01);
                const tevSwapModeTableRasIndex = view.getUint16(materialEntryIdx + 0x124 + tevSwapModeRasSel * 0x02);
                const tevSwapModeTableTexIndex = view.getUint16(materialEntryIdx + 0x124 + tevSwapModeTexSel * 0x02);
                const rasSwapA = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableRasIndex * 0x04 + 0x00);
                const rasSwapB = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableRasIndex * 0x04 + 0x01);
                const rasSwapC = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableRasIndex * 0x04 + 0x02);
                const rasSwapD = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableRasIndex * 0x04 + 0x03);
                const texSwapA = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableTexIndex * 0x04 + 0x00);
                const texSwapB = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableTexIndex * 0x04 + 0x01);
                const texSwapC = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableTexIndex * 0x04 + 0x02);
                const texSwapD = view.getUint8(tevSwapModeTableOffs + tevSwapModeTableTexIndex * 0x04 + 0x03);

                rasSwapTable = [rasSwapA, rasSwapB, rasSwapC, rasSwapD] as const;
                texSwapTable = [texSwapA, texSwapB, texSwapC, texSwapD] as const;
            }

            // SetTevIndirect
            const indTexStageOffs = indirectEntryOffs + 0x04 + (0x04 * 4) + (0x1C * 3) + (0x04 * 4) + j * 0x0C;
            let indTexStage: GX.IndTexStageID = GX.IndTexStageID.STAGE0;
            let indTexFormat: GX.IndTexFormat = GX.IndTexFormat._8;
            let indTexBiasSel: GX.IndTexBiasSel = GX.IndTexBiasSel.NONE;
            let indTexAlphaSel: GX.IndTexAlphaSel = GX.IndTexAlphaSel.OFF;
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
                indTexAlphaSel = view.getUint8(indTexStageOffs + 0x08);
            }

            const tevStage: GX_Material.TevStage = {
                colorInA, colorInB, colorInC, colorInD, colorOp, colorBias, colorScale, colorClamp, colorRegId,
                alphaInA, alphaInB, alphaInC, alphaInD, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId,
                texCoordId, texMap, channelId,
                konstColorSel, konstAlphaSel,
                rasSwapTable,
                texSwapTable,
                indTexStage,
                indTexFormat,
                indTexBiasSel,
                indTexAlphaSel,
                indTexMatrix,
                indTexWrapS,
                indTexWrapT,
                indTexAddPrev,
                indTexUseOrigLOD,
            };
            tevStages.push(tevStage);
        }

        // SetAlphaCompare
        const alphaCompIndex = view.getUint16(materialEntryIdx + 0x146);
        const alphaCompIdx = alphaCompOffs + alphaCompIndex * 0x08;
        const compareA: GX.CompareType = view.getUint8(alphaCompIdx + 0x00);
        const referenceA: number = view.getUint8(alphaCompIdx + 0x01) / 0xFF;
        const op: GX.AlphaOp = view.getUint8(alphaCompIdx + 0x02);
        const compareB: GX.CompareType = view.getUint8(alphaCompIdx + 0x03);
        const referenceB: number = view.getUint8(alphaCompIdx + 0x04) / 0xFF;
        const alphaTest: GX_Material.AlphaTest = { compareA, referenceA, op, compareB, referenceB };

        // SetBlendMode
        const blendModeIndex = view.getUint16(materialEntryIdx + 0x148);
        const blendIdx = blendOffs + blendModeIndex * 0x04;
        const blendMode: GX.BlendMode = view.getUint8(blendIdx + 0x00);
        const blendSrcFactor: GX.BlendFactor = view.getUint8(blendIdx + 0x01);
        const blendDstFactor: GX.BlendFactor = view.getUint8(blendIdx + 0x02);
        const blendLogicOp: GX.LogicOp = view.getUint8(blendIdx + 0x03);

        const cullMode: GX.CullMode = view.getUint32(cullModeOffs + cullModeIndex * 0x04);
        const zModeIdx = zModeOffs + zModeIndex * 4;
        const depthTest: boolean = !!view.getUint8(zModeIdx + 0x00);
        const depthFunc: GX.CompareType = view.getUint8(zModeIdx + 0x01);
        const depthWrite: boolean = !!view.getUint8(zModeIdx + 0x02);

        const fogInfoIndex = view.getUint16(materialEntryIdx + 0x144);
        let fogType = GX.FogType.NONE;
        let fogAdjEnabled = false;
        const fogBlock = new GX_Material.FogBlock();
        if (fogInfoIndex !== 0xFFFF) {
            const fogInfoOffs = fogOffs + fogInfoIndex * 0x2C;
            fogType = view.getUint8(fogInfoOffs + 0x00);
            fogAdjEnabled = !!view.getUint8(fogInfoOffs + 0x01);
            const fogAdjCenter = view.getUint16(fogInfoOffs + 0x02);
            const fogStartZ = view.getFloat32(fogInfoOffs + 0x04);
            const fogEndZ = view.getFloat32(fogInfoOffs + 0x08);
            const fogNearZ = view.getFloat32(fogInfoOffs + 0x0C);
            const fogFarZ = view.getFloat32(fogInfoOffs + 0x10);
            const fogColor = readColorU8(view, fogInfoOffs + 0x14);
            const fogAdjTable = buffer.createTypedArray(Uint16Array, fogInfoOffs + 0x18, 10, Endianness.BIG_ENDIAN);

            GX_Material.fogBlockSet(fogBlock, fogType, fogStartZ, fogEndZ, fogNearZ, fogFarZ);
            colorCopy(fogBlock.Color, fogColor);
            fogBlock.AdjTable.set(fogAdjTable);
            fogBlock.AdjCenter = fogAdjCenter;
        }

        const translucent = materialMode === 0x04;
        const colorUpdate = true, alphaUpdate = false;

        const ropInfo: GX_Material.RopInfo = {
            fogType, fogAdjEnabled,
            blendMode, blendSrcFactor, blendDstFactor, blendLogicOp,
            depthTest, depthFunc, depthWrite,
            colorUpdate, alphaUpdate,
        };

        const gxMaterial: GX_Material.GXMaterial = {
            name,
            cullMode,
            lightChannels,
            texGens,
            tevStages,
            indTexStages,
            alphaTest,
            ropInfo,
        };

        autoOptimizeMaterial(gxMaterial);

        materialEntries.push({
            index, name,
            materialMode, translucent,
            textureIndexes,
            texMatrices,
            gxMaterial,
            indTexMatrices,
            colorMatRegs,
            colorAmbRegs,
            colorRegisters,
            colorConstants,
            fogBlock,
        });
    }

    return { materialEntries };
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
    maxAnisotropy: GX.Anisotropy;
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
        const textureData = btiTexture.data;
        if (textureData)
            textureDataIndex = textureDatas.findIndex((tex) => tex.data && tex.data.byteOffset === textureData.byteOffset);

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
            maxAnisotropy: btiTexture.maxAnisotropy,
            textureDataIndex,
        };
        samplers.push(sampler);
    }

    return { textureDatas, samplers };
}
//#endregion

//#region BMD
export class BMD {
    private constructor(j3d: JSystemFileReaderHelper) {
        this.subversion = j3d.subversion;
        this.inf1 = readINF1Chunk(j3d.nextChunk('INF1'));
        this.vtx1 = readVTX1Chunk(j3d.nextChunk('VTX1'));
        this.evp1 = readEVP1Chunk(j3d.nextChunk('EVP1'));
        this.drw1 = readDRW1Chunk(j3d.nextChunk('DRW1'));
        this.jnt1 = readJNT1Chunk(j3d.nextChunk('JNT1'));
        this.shp1 = readSHP1Chunk(j3d.nextChunk('SHP1'), this);
        if (j3d.magic === 'J3D2bmd2')
            this.mat3 = readMAT2Chunk(j3d.nextChunk('MAT2'));
        else
            this.mat3 = readMAT3Chunk(j3d.nextChunk('MAT3'));
        const mdl3 = j3d.maybeNextChunk('MDL3');
        this.tex1 = readTEX1Chunk(j3d.nextChunk('TEX1'));

        this.assocHierarchy();
    }

    private assocHierarchy(): void {
        const view = this.inf1.hierarchyData.createDataView();

        let offs = 0x00;
        let currentMaterialIndex = -1;
        while (true) {
            const type: HierarchyNodeType = view.getUint16(offs + 0x00);
            const value = view.getUint16(offs + 0x02);

            if (type === HierarchyNodeType.End) {
                break;
            } else if (type === HierarchyNodeType.Material) {
                currentMaterialIndex = value;
            } else if (type === HierarchyNodeType.Shape) {
                const shape = this.shp1.shapes[value];
                assert(currentMaterialIndex !== -1);
                assert(shape.materialIndex === -1);
                shape.materialIndex = currentMaterialIndex;
            }

            offs += 0x04;
        }

        // Double-check that we have everything done.
        for (let i = 0; i < this.shp1.shapes.length; i++)
            assert(this.shp1.shapes[i].materialIndex !== -1);

        // Go through and auto-optimize materials which don't use MULTI
        for (let i = 0; i < this.mat3.materialEntries.length; i++) {
            let multiCount = 0;
            for (let j = 0; j < this.shp1.shapes.length; j++) {
                const shp1 = this.shp1.shapes[j];
                if (shp1.materialIndex !== i)
                    continue;

                if (this.shp1.shapes[j].shapeMtxType === ShapeMtxType.Multi)
                    ++multiCount;
            }

            this.mat3.materialEntries[i].gxMaterial.usePnMtxIdx = (multiCount !== 0);
        }
    }

    public static parseReader(j3d: JSystemFileReaderHelper): BMD {
        return new BMD(j3d);
    }

    public static parse(buffer: ArrayBufferSlice): BMD {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D2bmd2' || j3d.magic === 'J3D2bmd3' || j3d.magic === 'J3D2bdl4');
        return this.parseReader(j3d);
    }

    public subversion: string;
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
//#endregion

//#region BMT
export class BMT {
    public mat3: MAT3 | null;
    public tex1: TEX1 | null;

    private constructor(j3d: JSystemFileReaderHelper) {
        assert(j3d.magic === 'J3D2bmt3');

        const mat3Chunk = j3d.maybeNextChunk('MAT3');
        this.mat3 = mat3Chunk !== null ? readMAT3Chunk(mat3Chunk) : null;
        const tex1Chunk = j3d.maybeNextChunk('TEX1');
        this.tex1 = tex1Chunk !== null ? readTEX1Chunk(tex1Chunk) : null;
    }

    public static parse(buffer: ArrayBufferSlice): BMT {
        const j3d = new JSystemFileReaderHelper(buffer);
        return new BMT(j3d);
    }
}
//#endregion

//#region Animation Core
export const enum LoopMode {
    Once = 0,
    OnceAndReset = 1,
    Repeat = 2,
    MirroredOnce = 3,
    MirroredRepeat = 4,
}

export interface AnimationKeyframe {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
}

export interface AnimationTrack {
    frames: AnimationKeyframe[];
}

export interface AnimationBase {
    duration: number;
    loopMode: LoopMode;
}

const enum TangentType {
    In = 0,
    InOut = 1,
}

function translateAnimationTrack(data: Float32Array | Int16Array, scale: number, count: number, index: number, tangent: TangentType): AnimationTrack {
    // Special exception.
    if (count === 1) {
        const value = data[index];
        const frames = [ { time: 0, value: value * scale, tangentIn: 0, tangentOut: 0 } ];
        return { frames };
    } else {
        const frames: AnimationKeyframe[] = [];

        if (tangent === TangentType.In) {
            for (let i = index; i < index + 3 * count; i += 3) {
                const time = data[i+0], value = data[i+1] * scale, tangentIn = data[i+2] * scale, tangentOut = tangentIn;
                frames.push({ time, value, tangentIn, tangentOut });
            }
        } else if (tangent === TangentType.InOut) {
            for (let i = index; i < index + 4 * count; i += 4) {
                const time = data[i+0], value = data[i+1] * scale, tangentIn = data[i+2] * scale, tangentOut = data[i+3] * scale;
                frames.push({ time, value, tangentIn, tangentOut });
            }
        }

        return { frames };
    }
}
//#endregion

//#region J3DAnmTextureSRTKey
export interface TTK1AnimationEntry {
    materialName: string;
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
    isMaya: boolean;
    uvAnimationEntries: TTK1AnimationEntry[];
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
    const isMaya = view.getUint32(0x5C) === 1;

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

    const uvAnimationEntries: TTK1AnimationEntry[] = [];
    for (let i = 0; i < animationCount; i++) {
        const materialName = materialNameTable[i];
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
            materialName, texGenIndex,
            centerS, centerT, centerQ,
            scaleS, rotationS, translationS,
            scaleT, rotationT, translationT,
            scaleQ, rotationQ, translationQ,
         });
    }

    return { duration, loopMode, isMaya, uvAnimationEntries };
}

export class BTK {
    public static parse(buffer: ArrayBufferSlice): TTK1 {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1btk1');

        // For some reason, TTK1 chunks have an invalid size chunk with 0x04 extra bytes.
        return readTTK1Chunk(j3d.nextChunk('TTK1', -0x04));
    }
}
//#endregion

//#region J3DAnmTevRegKey
export interface TRK1AnimationEntry {
    materialName: string;
    colorKind: ColorKind;
    r: AnimationTrack;
    g: AnimationTrack;
    b: AnimationTrack;
    a: AnimationTrack;
}

export interface TRK1 extends AnimationBase {
    animationEntries: TRK1AnimationEntry[];
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

    const animationEntries: TRK1AnimationEntry[] = [];

    const registerRTable = buffer.createTypedArray(Int16Array, registerROffs, registerRCount, Endianness.BIG_ENDIAN);
    const registerGTable = buffer.createTypedArray(Int16Array, registerGOffs, registerGCount, Endianness.BIG_ENDIAN);
    const registerBTable = buffer.createTypedArray(Int16Array, registerBOffs, registerBCount, Endianness.BIG_ENDIAN);
    const registerATable = buffer.createTypedArray(Int16Array, registerAOffs, registerACount, Endianness.BIG_ENDIAN);

    animationTableIdx = registerColorAnimationTableOffs;
    for (let i = 0; i < registerColorAnimationTableCount; i++) {
        const materialName = registerNameTable[i];
        const r = readAnimationTrack(registerRTable);
        const g = readAnimationTrack(registerGTable);
        const b = readAnimationTrack(registerBTable);
        const a = readAnimationTrack(registerATable);
        const colorId = view.getUint8(animationTableIdx);
        const colorKind = ColorKind.C0 + colorId;
        animationTableIdx += 0x04;
        animationEntries.push({ materialName, colorKind, r, g, b, a });
    }

    const konstantRTable = buffer.createTypedArray(Int16Array, konstantROffs, konstantRCount, Endianness.BIG_ENDIAN);
    const konstantGTable = buffer.createTypedArray(Int16Array, konstantGOffs, konstantGCount, Endianness.BIG_ENDIAN);
    const konstantBTable = buffer.createTypedArray(Int16Array, konstantBOffs, konstantBCount, Endianness.BIG_ENDIAN);
    const konstantATable = buffer.createTypedArray(Int16Array, konstantAOffs, konstantACount, Endianness.BIG_ENDIAN);

    animationTableIdx = konstantColorAnimationTableOffs;
    for (let i = 0; i < konstantColorAnimationTableCount; i++) {
        const materialName = konstantNameTable[i];
        const r = readAnimationTrack(konstantRTable);
        const g = readAnimationTrack(konstantGTable);
        const b = readAnimationTrack(konstantBTable);
        const a = readAnimationTrack(konstantATable);
        const colorId = view.getUint8(animationTableIdx);
        const colorKind = ColorKind.K0 + colorId;
        animationTableIdx += 0x04;
        animationEntries.push({ materialName, colorKind, r, g, b, a });
    }

    return { duration, loopMode, animationEntries };
}

export class BRK {
    public static parse(buffer: ArrayBufferSlice): TRK1 {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1brk1');

        return readTRK1Chunk(j3d.nextChunk('TRK1'));
    }
}
//#endregion

//#region J3DAnmColorKey
function readPAK1Chunk(buffer: ArrayBufferSlice): TRK1 {
    const view = buffer.createDataView();
    const loopMode: LoopMode = view.getUint8(0x08);
    const duration = view.getUint16(0x0C);
    const colorAnimationTableCount = view.getUint16(0x0E);
    const rCount = view.getUint16(0x10);
    const gCount = view.getUint16(0x12);
    const bCount = view.getUint16(0x14);
    const aCount = view.getUint16(0x16);
    const colorAnimationTableOffs = view.getUint32(0x18);
    const remapTableOffs = view.getUint32(0x1C);
    const nameTableOffs = view.getUint32(0x20);
    const rOffs = view.getUint32(0x24);
    const gOffs = view.getUint32(0x28);
    const bOffs = view.getUint32(0x2C);
    const aOffs = view.getUint32(0x30);
    const nameTable = readStringTable(buffer, nameTableOffs);

    let animationTableIdx: number;

    function readAnimationTrack(data: Int16Array) {
        const count = view.getUint16(animationTableIdx + 0x00);
        const index = view.getUint16(animationTableIdx + 0x02);
        const tangent: TangentType = view.getUint16(animationTableIdx + 0x04);
        animationTableIdx += 0x06;
        return translateAnimationTrack(data, 1 / 0xFF, count, index, tangent);
    }

    const animationEntries: TRK1AnimationEntry[] = [];

    const registerRTable = buffer.createTypedArray(Int16Array, rOffs, rCount, Endianness.BIG_ENDIAN);
    const registerGTable = buffer.createTypedArray(Int16Array, gOffs, gCount, Endianness.BIG_ENDIAN);
    const registerBTable = buffer.createTypedArray(Int16Array, bOffs, bCount, Endianness.BIG_ENDIAN);
    const registerATable = buffer.createTypedArray(Int16Array, aOffs, aCount, Endianness.BIG_ENDIAN);

    animationTableIdx = colorAnimationTableOffs;
    for (let i = 0; i < colorAnimationTableCount; i++) {
        const materialName = nameTable[i];
        const r = readAnimationTrack(registerRTable);
        const g = readAnimationTrack(registerGTable);
        const b = readAnimationTrack(registerBTable);
        const a = readAnimationTrack(registerATable);
        const colorKind = ColorKind.MAT0;
        animationEntries.push({ materialName, colorKind, r, g, b, a });
    }

    return { duration, loopMode, animationEntries };
}

export class BPK {
    public static parse(buffer: ArrayBufferSlice): TRK1 {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1bpk1');

        return readPAK1Chunk(j3d.nextChunk('PAK1'));
    }
}
//#endregion

//#region J3DAnmTransformKey
export interface ANK1JointAnimationEntry {
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
    jointAnimationEntries: ANK1JointAnimationEntry[];
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

    const rotationScale = Math.pow(2, rotationDecimal) / 0x7FFF * Math.PI;

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

    const jointAnimationEntries: ANK1JointAnimationEntry[] = [];
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
            scaleX, rotationX, translationX,
            scaleY, rotationY, translationY,
            scaleZ, rotationZ, translationZ,
        });
    }

    return { loopMode, duration, jointAnimationEntries };
}

export class BCK {
    public static parse(buffer: ArrayBufferSlice): ANK1 {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1bck1');

        return readANK1Chunk(j3d.nextChunk('ANK1'));
    }
}
//#endregion

//#region J3DAnmTransformFull
export interface ANF1JointAnimationEntry {
    scaleX: number[];
    rotationX: number[];
    translationX: number[];
    scaleY: number[];
    rotationY: number[];
    translationY: number[];
    scaleZ: number[];
    rotationZ: number[];
    translationZ: number[];
}

export interface ANF1 extends AnimationBase {
    jointAnimationEntries: ANF1JointAnimationEntry[];
}

function readANF1Chunk(buffer: ArrayBufferSlice): ANF1 {
    const view = buffer.createDataView();
    const loopMode: LoopMode = view.getUint8(0x08);
    //const rotationDecimal = view.getInt8(0x09);
    const duration = view.getUint16(0x0A);
    const jointAnimationTableCount = view.getUint16(0x0C);
    const sCount = view.getUint16(0x0E);
    const rCount = view.getUint16(0x10);
    const tCount = view.getUint16(0x12);
    const jointAnimationTableOffs = view.getUint32(0x14);
    const sTableOffs = view.getUint32(0x18);
    const rTableOffs = view.getUint32(0x1C);
    const tTableOffs = view.getUint32(0x20);

    const rotationScale = Math.PI / 0x7FFF;

    const sTable = buffer.createTypedArray(Float32Array, sTableOffs, sCount, Endianness.BIG_ENDIAN);
    const rTable = buffer.createTypedArray(Int16Array, rTableOffs, rCount, Endianness.BIG_ENDIAN);
    const tTable = buffer.createTypedArray(Float32Array, tTableOffs, tCount, Endianness.BIG_ENDIAN);

    let animationTableIdx = jointAnimationTableOffs;

    function readAnimationTrack(data: Int16Array | Float32Array, scale: number): number[] {
        const count = view.getUint16(animationTableIdx + 0x00);
        const index = view.getUint16(animationTableIdx + 0x02);
        animationTableIdx += 0x04;

        const frames: number[] = [];

        for (let i = 0; i < count; i++) {
            frames.push(data[index + i] * scale);
        }

        return frames;
    }

    const jointAnimationEntries: ANF1JointAnimationEntry[] = [];

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
            scaleX, rotationX, translationX,
            scaleY, rotationY, translationY,
            scaleZ, rotationZ, translationZ,
        });
    }

    return { loopMode, duration, jointAnimationEntries };
}

export class BCA {
    public static parse(buffer: ArrayBufferSlice): ANF1 {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1bca1');

        return readANF1Chunk(j3d.nextChunk('ANF1'));
    }
}
//#endregion

//#region J3DAnmTexPattern
export interface TPT1AnimationEntry {
    materialName: string;
    texMapIndex: number;
    textureIndices: number[];
}

export interface TPT1 extends AnimationBase {
    animationEntries: TPT1AnimationEntry[];
}

function readTPT1Chunk(buffer: ArrayBufferSlice): TPT1 {
    const view = buffer.createDataView();
    const loopMode: LoopMode = view.getUint8(0x08);
    const duration = view.getUint16(0x0A);
    const materialAnimationTableCount = view.getUint16(0x0C);
    const textureIndexTableCount = view.getUint16(0x0E);
    const materialAnimationTableOffs = view.getUint32(0x10);
    const textureIndexTableOffs = view.getUint32(0x14);
    const remapTableOffs = view.getUint32(0x18);
    const nameTableOffs = view.getUint32(0x1C);
    const nameTable = readStringTable(buffer, nameTableOffs);

    let animationTableIdx: number;

    const animationEntries: TPT1AnimationEntry[] = [];

    animationTableIdx = materialAnimationTableOffs;
    for (let i = 0; i < materialAnimationTableCount; i++) {
        const materialName = nameTable[i];

        const textureCount = view.getUint16(animationTableIdx + 0x00);
        const textureFirstIndex = view.getUint16(animationTableIdx + 0x02);
        const texMapIndex = view.getUint8(animationTableIdx + 0x04);

        const textureIndices: number[] = [];
        for (let j = 0; j < textureCount; j++) {
            const textureIndex = view.getUint16(textureIndexTableOffs + (textureFirstIndex + j) * 0x02);
            textureIndices.push(textureIndex);
        }

        animationEntries.push({ materialName, texMapIndex, textureIndices });
        animationTableIdx += 0x08;
    }

    return { duration, loopMode, animationEntries };
}

export class BTP {
    public static parse(buffer: ArrayBufferSlice): TPT1 {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1btp1');

        return readTPT1Chunk(j3d.nextChunk('TPT1'));
    }
}
//#endregion

//#region J3DAnmVisibilityFull
export interface VAF1 extends AnimationBase {
    shapeVisibility: BitMap[];
}

function readVAF1Chunk(buffer: ArrayBufferSlice): VAF1 {
    const view = buffer.createDataView();
    const loopMode: LoopMode = view.getUint8(0x08);
    const duration = view.getUint16(0x0A);
    const visibilityAnimationTableCount = view.getUint16(0x0C);
    const showTableCount = view.getUint16(0x0E);
    const visibilityAnimationTableOffs = view.getUint32(0x10);
    const showTableOffs = view.getUint32(0x14);

    let animationTableIdx = visibilityAnimationTableOffs;

    const shapeVisibility: BitMap[] = [];
    for (let i = 0; i < visibilityAnimationTableCount; i++) {
        const showCount = view.getUint16(animationTableIdx + 0x00);
        const showFirstIndex = view.getUint16(animationTableIdx + 0x02);

        assert(showCount > 0);
        const bitmap = new BitMap(showCount);
        for (let j = 0; j < showCount; j++) {
            const show = !!view.getUint8(showTableOffs + showFirstIndex + j);
            bitmap.setBit(j, show);
        }

        shapeVisibility.push(bitmap);
        animationTableIdx += 0x04;
    }

    return { loopMode, duration, shapeVisibility };
}

export class BVA {
    public static parse(buffer: ArrayBufferSlice): VAF1 {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D1bva1');

        return readVAF1Chunk(j3d.nextChunk('VAF1'));
    }
}
//#endregion
