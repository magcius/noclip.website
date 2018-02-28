
// Implements Nintendo's J3D formats (BMD, BDL, BTK, etc.)

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';

import { betoh, be16toh } from 'endian';
import { assert, readString } from 'util';
import { mat2d, mat4, mat3 as matrix3, quat } from 'gl-matrix';

function readStringTable(buffer: ArrayBuffer, offs: number): string[] {
    const view = new DataView(buffer, offs);
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

export enum HierarchyType {
    End = 0x00,
    Open = 0x01,
    Close = 0x02,
    Joint = 0x10,
    Material = 0x11,
    Shape = 0x12,
}

// Build the scene graph.
// XXX: Nintendo doesn't seem to actually use this as a tree,
// because they make some super deep stuff... we should linearize this...

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

function readINF1Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
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
    bmd.inf1 = { sceneGraph: parentStack.pop() };
}

type CompSize = 1 | 2 | 4;

function getComponentSize(dataType: GX.CompType): CompSize {
    switch (dataType) {
    case GX.CompType.U8:
    case GX.CompType.S8:
    case GX.CompType.RGBA8:
        return 1;
    case GX.CompType.U16:
    case GX.CompType.S16:
        return 2;
    case GX.CompType.F32:
        return 4;
    }
}

function getNumComponents(vtxAttrib: GX.VertexAttribute, componentCount: GX.CompCnt) {
    switch (vtxAttrib) {
    case GX.VertexAttribute.POS:
        if (componentCount === GX.CompCnt.POS_XY)
            return 2;
        else if (componentCount === GX.CompCnt.POS_XYZ)
            return 3;
    case GX.VertexAttribute.NRM:
        return 3;
    case GX.VertexAttribute.CLR0:
    case GX.VertexAttribute.CLR1:
        if (componentCount === GX.CompCnt.CLR_RGB)
            return 3;
        else if (componentCount === GX.CompCnt.CLR_RGBA)
            return 4;
    case GX.VertexAttribute.TEX0:
    case GX.VertexAttribute.TEX1:
    case GX.VertexAttribute.TEX2:
    case GX.VertexAttribute.TEX3:
    case GX.VertexAttribute.TEX4:
    case GX.VertexAttribute.TEX5:
    case GX.VertexAttribute.TEX6:
    case GX.VertexAttribute.TEX7:
        if (componentCount === GX.CompCnt.TEX_S)
            return 1;
        else if (componentCount === GX.CompCnt.TEX_ST)
            return 2;
    default:
        throw new Error(`Unknown vertex attribute ${vtxAttrib}`);
    }
}

export interface VertexArray {
    vtxAttrib: GX.VertexAttribute;
    compType: GX.CompType;
    compCount: number;
    compSize: CompSize;
    scale: number;
    buffer: ArrayBuffer;
    dataOffs: number;
    dataSize: number;
}

export interface VTX1 {
    vertexArrays: Map<GX.VertexAttribute, VertexArray>;
}

function readVTX1Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
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
        const dataStart: number = view.getUint32(dataOffsLookupTableEntry);
        const dataEnd: number = getDataEnd(dataOffsLookupTableEntry);
        const dataOffs: number = chunkStart + dataStart;
        const dataSize: number = dataEnd - dataStart;
        const compCount = getNumComponents(vtxAttrib, compCnt);
        const compSize = getComponentSize(compType);
        const vtxDataBufferRaw = buffer.slice(dataOffs, dataOffs + dataSize);
        const vtxDataBuffer = betoh(vtxDataBufferRaw, compSize);
        const vertexArray: VertexArray = { vtxAttrib, compType, compCount, compSize, scale, dataOffs, dataSize, buffer: vtxDataBuffer };
        vertexArrays.set(vtxAttrib, vertexArray);
    }

    bmd.vtx1 = { vertexArrays };

    function getDataEnd(dataOffsLookupTableEntry: number) {
        let offs = dataOffsLookupTableEntry + 0x04;
        while (offs < dataOffsLookupTableEntry) {
            const dataOffs = view.getUint32(offs);
            if (dataOffs !== 0)
                return dataOffs;
            offs += 0x04;
        }
        // If we can't find anything in the array, the chunks end at the chunk size.
        return chunkSize;
    }
}

interface WeightedJoint {
    isWeighted: boolean;
    jointIndex: number;
}

export interface DRW1 {
    weightedJoints: WeightedJoint[];
}

function readDRW1Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
    const weightedJointCount = view.getUint16(0x08);
    const isWeightedTableOffs = view.getUint32(0x0C);
    const jointIndexTableOffs = view.getUint32(0x10);

    const weightedJoints: WeightedJoint[] = [];
    for (let i = 0; i < weightedJointCount; i++) {
        const isWeighted = !!view.getUint8(isWeightedTableOffs + i);
        const jointIndex = view.getUint16(jointIndexTableOffs + i * 0x02);
        weightedJoints.push({ isWeighted, jointIndex });
    }

    bmd.drw1 = { weightedJoints };
}

export interface Bone {
    name: string;
    matrix: mat4;
}

export interface JNT1 {
    remapTable: number[];
    bones: Bone[];
}

function readJNT1Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);

    const boneDataCount = view.getUint16(0x08);
    assert(view.getUint16(0x0A) === 0xFFFF);

    const boneDataTableOffs = view.getUint32(0x0C);
    const remapTableOffs = view.getUint32(0x10);

    const remapTable: number[] = [];
    for (let i = 0; i < boneDataCount; i++)
        remapTable[i] = view.getUint16(remapTableOffs + i * 0x02);

    const nameTableOffs = view.getUint32(0x14);
    const nameTable = readStringTable(buffer, chunkStart + nameTableOffs);

    const q = quat.create();

    const bones: Bone[] = [];
    let boneDataTableIdx = boneDataTableOffs;
    for (let i = 0; i < boneDataCount; i++) {
        const name = nameTable[i];
        const scaleX = view.getFloat32(boneDataTableIdx + 0x04);
        const scaleY = view.getFloat32(boneDataTableIdx + 0x08);
        const scaleZ = view.getFloat32(boneDataTableIdx + 0x0C);
        const rotationX = view.getUint16(boneDataTableIdx + 0x10) / 0x7FFF;
        const rotationY = view.getUint16(boneDataTableIdx + 0x12) / 0x7FFF;
        const rotationZ = view.getUint16(boneDataTableIdx + 0x14) / 0x7FFF;
        const translationX = view.getFloat32(boneDataTableIdx + 0x18);
        const translationY = view.getFloat32(boneDataTableIdx + 0x1C);
        const translationZ = view.getFloat32(boneDataTableIdx + 0x20);
        // Skipping bounding box data for now.

        quat.fromEuler(q, rotationX * 180, rotationY * 180, rotationZ * 180);
        const matrix = mat4.create();
        mat4.fromRotationTranslationScale(matrix, q, [translationX, translationY, translationZ], [scaleX, scaleY, scaleZ]);

        bones.push({ name, matrix });
        boneDataTableIdx += 0x40;
    }

    bmd.jnt1 = { remapTable, bones };
}

// Describes an individual vertex attribute in the packed data.
export interface PackedVertexAttribute {
    vtxAttrib: GX.VertexAttribute;
    indexDataType: GX.CompType;
    offset: number;
}

// A packet is a series of draw calls that use the same matrix table.
interface Packet {
    weightedJointTable: Uint16Array;
    firstTriangle: number;
    numTriangles: number;
}

export interface Shape {
    indexData: Uint16Array;
    // The vertex data. Converted to a modern-esque buffer per-shape.
    packedData: ArrayBuffer;
    // The size of an individual vertex.
    packedVertexSize: number;
    packedVertexAttributes: PackedVertexAttribute[];
    packets: Packet[];
}

export interface SHP1 {
    shapes: Shape[];
}

function readIndex(view: DataView, offs: number, type: GX.CompType) {
    switch (type) {
    case GX.CompType.U8:
    case GX.CompType.S8:
        return view.getUint8(offs);
    case GX.CompType.U16:
    case GX.CompType.S16:
        return view.getUint16(offs);
    default:
        throw new Error(`Unknown index data type ${type}!`);
    }
}

function align(n: number, multiple: number): number {
    const mask = (multiple - 1);
    return (n + mask) & ~mask;
}

function readSHP1Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
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

    const shapes: Shape[] = [];
    let shapeIdx = shapeTableOffs;
    for (let i = 0; i < shapeCount; i++) {
        const matrixType = view.getUint8(shapeIdx + 0x00);
        const packetCount = view.getUint16(shapeIdx + 0x02);
        const attribOffs = view.getUint16(shapeIdx + 0x04);
        const firstMatrix = view.getUint16(shapeIdx + 0x06);
        const firstPacket = view.getUint16(shapeIdx + 0x08);

        // Go parse out what attributes are required for this shape.
        const packedVertexAttributes: PackedVertexAttribute[] = [];
        let attribIdx = attribTableOffs + attribOffs;
        let vertexIndexSize = 0;
        let packedVertexSize = 0;
        while (true) {
            const vtxAttrib: GX.VertexAttribute = view.getUint32(attribIdx + 0x00);
            if (vtxAttrib === GX.VertexAttribute.NULL)
                break;
            const vertexArray: VertexArray = bmd.vtx1.vertexArrays.get(vtxAttrib);
            packedVertexSize = align(packedVertexSize, vertexArray.compSize);

            const indexDataType: GX.CompType = view.getUint32(attribIdx + 0x04);
            const indexDataSize = getComponentSize(indexDataType);
            const offset = packedVertexSize;
            packedVertexAttributes.push({ vtxAttrib, indexDataType, offset });
            attribIdx += 0x08;

            vertexIndexSize += indexDataSize;
            packedVertexSize += vertexArray.compSize * vertexArray.compCount;
        }
        // Align to the first item.
        const firstAlign = bmd.vtx1.vertexArrays.get(packedVertexAttributes[0].vtxAttrib).compSize;
        packedVertexSize = align(packedVertexSize, firstAlign);

        // Now parse out the packets.
        let packetIdx = packetTableOffs + (firstPacket * 0x08);
        const packets: Packet[] = [];

        interface DrawCall {
            primType: number;
            srcOffs: number;
            vertexCount: number;
        }

        let totalTriangleCount = 0;
        let totalVertexCount = 0;
        const drawCalls: DrawCall[] = [];
        for (let j = 0; j < packetCount; j++) {
            const packetSize = view.getUint32(packetIdx + 0x00);
            const packetStart = primDataOffs + view.getUint32(packetIdx + 0x04);

            const packetMatrixDataOffs = matrixDataOffs + (firstMatrix + j) * 0x08;
            const matrixCount = view.getUint16(packetMatrixDataOffs + 0x02);
            const matrixFirstIndex = view.getUint32(packetMatrixDataOffs + 0x04);

            const packetMatrixTableOffs = chunkStart + matrixTableOffs + matrixFirstIndex * 0x02;
            const packetMatrixTableEnd = packetMatrixTableOffs + matrixCount * 0x02;
            const weightedJointTable = new Uint16Array(be16toh(buffer.slice(packetMatrixTableOffs, packetMatrixTableEnd)));

            const drawCallEnd = packetStart + packetSize;
            let drawCallIdx = packetStart;

            const firstTriangle = totalTriangleCount;

            while (true) {
                if (drawCallIdx > drawCallEnd)
                    break;
                const primType: GX.PrimitiveType = view.getUint8(drawCallIdx);
                if (primType === 0)
                    break;
                const vertexCount = view.getUint16(drawCallIdx + 0x01);
                drawCallIdx += 0x03;
                const srcOffs = drawCallIdx;
                const first = totalVertexCount;
                totalVertexCount += vertexCount;

                switch (primType) {
                case GX.PrimitiveType.TRIANGLEFAN:
                case GX.PrimitiveType.TRIANGLESTRIP:
                    totalTriangleCount += (vertexCount - 2);
                    break;
                default:
                    throw "whoops";
                }

                drawCalls.push({ primType, srcOffs, vertexCount });

                // Skip over the index data.
                drawCallIdx += vertexIndexSize * vertexCount;
            }

            const numTriangles = totalTriangleCount - firstTriangle;
            packets.push({ weightedJointTable, firstTriangle, numTriangles });

            packetIdx += 0x08;
        }

        // Make sure the whole thing fits in 16 bits.
        assert(totalVertexCount <= 0xFFFF);

        // Now make the data.
        let indexDataIdx = 0;
        const indexData = new Uint16Array(totalTriangleCount * 3);
        let vertexId = 0;

        const packedDataSize = packedVertexSize * totalVertexCount;
        const packedDataView = new Uint8Array(packedDataSize);
        let packedDataOffs = 0;
        for (const drawCall of drawCalls) {
            // Convert topology to triangles.
            const firstVertex = vertexId;

            // First triangle is the same for all topo.
            for (let i = 0; i < 3; i++)
                indexData[indexDataIdx++] = vertexId++;

            switch (drawCall.primType) {
            case GX.PrimitiveType.TRIANGLESTRIP:
                for (let i = 3; i < drawCall.vertexCount; i++) {
                    indexData[indexDataIdx++] = vertexId - ((i & 1) ? 1 : 2);
                    indexData[indexDataIdx++] = vertexId - ((i & 1) ? 2 : 1);
                    indexData[indexDataIdx++] = vertexId++;
                }
                break;
            case GX.PrimitiveType.TRIANGLEFAN:
                for (let i = 3; i < drawCall.vertexCount; i++) {
                    indexData[indexDataIdx++] = firstVertex;
                    indexData[indexDataIdx++] = vertexId - 1;
                    indexData[indexDataIdx++] = vertexId++;
                }
                break;
            }
            assert((vertexId - firstVertex) === drawCall.vertexCount);

            let drawCallIdx = drawCall.srcOffs;
            for (let j = 0; j < drawCall.vertexCount; j++) {
                // Copy attribute data.
                const packedDataOffs_ = packedDataOffs;
                for (const attrib of packedVertexAttributes) {
                    const index = readIndex(view, drawCallIdx, attrib.indexDataType);
                    const indexDataSize = getComponentSize(attrib.indexDataType);
                    drawCallIdx += indexDataSize;
                    const vertexArray: VertexArray = bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);
                    packedDataOffs = align(packedDataOffs, vertexArray.compSize);
                    const attribDataSize = vertexArray.compSize * vertexArray.compCount;
                    const vertexData = new Uint8Array(vertexArray.buffer, attribDataSize * index, attribDataSize);
                    packedDataView.set(vertexData, packedDataOffs);
                    packedDataOffs += attribDataSize;
                }
                packedDataOffs = align(packedDataOffs, firstAlign);
                assert((packedDataOffs - packedDataOffs_) === packedVertexSize);
            }
        }
        assert(indexDataIdx === totalTriangleCount * 3);
        assert((packedVertexSize * totalVertexCount) === packedDataOffs);
        const packedData = packedDataView.buffer;

        // Now we should have a complete shape. Onto the next!
        shapes.push({ indexData, packedData, packedVertexSize, packedVertexAttributes, packets });

        shapeIdx += 0x28;
    }

    const shp1 = { shapes };
    bmd.shp1 = shp1;
}

export interface MAT3 {
    remapTable: number[];
    materialEntries: GX_Material.GXMaterial[];
}

// temp, center, center inverse
const t = matrix3.create(), c = matrix3.create(), ci = matrix3.create();
function createTexMtx(m: matrix3, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number, centerS: number, centerT: number, centerQ: number) {
    // TODO(jstpierre): Remove these.
    matrix3.fromTranslation(c, [centerS, centerT, centerQ]);
    matrix3.fromTranslation(ci, [-centerS, -centerT, -centerQ]);
    matrix3.fromTranslation(m, [translationS, translationT, 0]);
    matrix3.fromRotation(t, rotation);
    matrix3.mul(t, t, ci);
    matrix3.mul(t, c, t);
    matrix3.mul(m, m, t);
    matrix3.fromScaling(t, [scaleS, scaleT, 1]);
    matrix3.mul(t, t, ci);
    matrix3.mul(t, c, t);
    matrix3.mul(m, m, t);
    return m;
}

function readColor32(view: DataView, srcOffs: number): GX_Material.Color {
    const r = view.getUint8(srcOffs + 0x00) / 255;
    const g = view.getUint8(srcOffs + 0x01) / 255;
    const b = view.getUint8(srcOffs + 0x02) / 255;
    const a = view.getUint8(srcOffs + 0x03) / 255;
    return { r, g, b, a };
}

function readColorShort(view: DataView, srcOffs: number): GX_Material.Color {
    const r = view.getUint16(srcOffs + 0x00) / 255;
    const g = view.getUint16(srcOffs + 0x02) / 255;
    const b = view.getUint16(srcOffs + 0x04) / 255;
    const a = view.getUint16(srcOffs + 0x06) / 255;
    return { r, g, b, a };
}

function readMAT3Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
    const materialCount = view.getUint16(0x08);

    const remapTableOffs = view.getUint32(0x10);
    const remapTable: number[] = [];
    for (let i = 0; i < materialCount; i++)
        remapTable[i] = view.getUint16(remapTableOffs + i * 0x02);

    const maxIndex = Math.max.apply(null, remapTable);

    const nameTableOffs = view.getUint32(0x14);
    const nameTable = readStringTable(buffer, chunkStart + nameTableOffs);

    const cullModeTableOffs = view.getUint32(0x1C);
    const materialColorTableOffs = view.getUint32(0x20);
    const colorChanTableOffs = view.getUint32(0x28);
    const texGenTableOffs = view.getUint32(0x38);
    const textureTableOffs = view.getUint32(0x48);
    const texMtxTableOffs = view.getUint32(0x40);
    const tevOrderTableOffs = view.getUint32(0x4C);
    const colorRegisterTableOffs = view.getUint32(0x50);
    const colorConstantTableOffs = view.getUint32(0x54);
    const tevStageTableOffs = view.getUint32(0x5C);
    const alphaTestTableOffs = view.getUint32(0x6C);
    const blendModeTableOffs = view.getUint32(0x70);
    const depthModeTableOffs = view.getUint32(0x74);

    const materialEntries: GX_Material.GXMaterial[] = [];
    let materialEntryIdx = view.getUint32(0x0C);
    for (let i = 0; i <= maxIndex; i++) {
        const index = i;
        const name = nameTable[i];
        const flags = view.getUint8(materialEntryIdx + 0x00);
        const cullModeIndex = view.getUint8(materialEntryIdx + 0x01);
        const numChansIndex = view.getUint8(materialEntryIdx + 0x02);
        const texGenCountIndex = view.getUint8(materialEntryIdx + 0x03);
        const tevCountIndex = view.getUint8(materialEntryIdx + 0x04);
        // unk
        const depthModeIndex = view.getUint8(materialEntryIdx + 0x06);
        // unk

        const colorChannels: GX_Material.ColorChannelControl[] = [];
        for (let j = 0; j < 2; j++) {
            const colorChanIndex = view.getInt16(materialEntryIdx + 0x0C + j * 0x02);
            if (colorChanIndex < 0)
                continue;
            const colorChanOffs = colorChanTableOffs + colorChanIndex * 0x08;
            const lightingEnabled = !!view.getUint8(colorChanOffs + 0x00);
            const matColorSource: GX.ColorSrc = view.getUint8(colorChanOffs + 0x01);
            const litMask = view.getUint8(colorChanOffs + 0x02);
            const diffuseFunction = view.getUint8(colorChanOffs + 0x03);
            const attenuationFunction = view.getUint8(colorChanOffs + 0x04);
            const ambColorSource: GX.ColorSrc = view.getUint8(colorChanOffs + 0x05);

            const matColorIndex = view.getUint16(materialEntryIdx + 0x08 + j * 0x02);
            const matColorOffs = materialColorTableOffs + matColorIndex * 0x04;
            const matColorReg = readColor32(view, matColorOffs);
            const colorChan: GX_Material.ColorChannelControl = { lightingEnabled, matColorSource, matColorReg, ambColorSource };
            colorChannels.push(colorChan);
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
            const texGen: GX_Material.TexGen = { index, type, source, matrix };
            texGens.push(texGen);
        }

        const texMatrices: GX_Material.TexMtx[] = [];
        for (let j = 0; j < 10; j++) {
            texMatrices[j] = null;

            const texMtxIndex = view.getInt16(materialEntryIdx + 0x48 + j * 0x02);
            if (texMtxIndex < 0)
                continue;

            const texMtxOffs = texMtxTableOffs + texMtxIndex * 0x64;
            const projection: GX_Material.TexMtxProjection = view.getUint8(texMtxOffs + 0x00);
            const type = view.getUint8(texMtxOffs + 0x01);
            assert(view.getUint16(texMtxOffs + 0x02) == 0xFFFF);
            const centerS = view.getFloat32(texMtxOffs + 0x04);
            const centerT = view.getFloat32(texMtxOffs + 0x08);
            const centerQ = view.getFloat32(texMtxOffs + 0x0C);
            const scaleS = view.getFloat32(texMtxOffs + 0x10);
            const scaleT = view.getFloat32(texMtxOffs + 0x14);
            const rotation = view.getInt16(texMtxOffs + 0x18) / 0x7FFF;
            assert(view.getUint16(texMtxOffs + 0x1A) == 0xFFFF);
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

            const p = mat4.fromValues(
                p00, p01, p02, p03,
                p10, p11, p12, p13,
                p20, p21, p22, p23,
                p30, p31, p32, p33,
            );

            const matrix = matrix3.create();
            createTexMtx(matrix, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);
            texMatrices[j] = { projection, matrix };
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
            const texCoordId: GX.TexCoordSlot = view.getUint8(tevOrderOffs + 0x00);
            const texMap: number = view.getUint8(tevOrderOffs + 0x01);
            const channelId: GX.ColorChannelId = view.getUint8(tevOrderOffs + 0x02);
            assert(view.getUint8(tevOrderOffs + 0x03) == 0xFF);

            // KonstSel
            const konstColorSel: GX.KonstColorSel = view.getUint8(materialEntryIdx + 0x9C + j);
            const konstAlphaSel: GX.KonstAlphaSel = view.getUint8(materialEntryIdx + 0xAC + j);

            const tevStage: GX_Material.TevStage = {
                index,
                colorInA, colorInB, colorInC, colorInD, colorOp, colorBias, colorScale, colorClamp, colorRegId,
                alphaInA, alphaInB, alphaInC, alphaInD, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId,
                texCoordId, texMap, channelId,
                konstColorSel, konstAlphaSel,
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

        materialEntries.push({
            index, name,
            translucent,
            textureIndexes,
            cullMode,
            colorChannels,
            texGens,
            colorRegisters,
            colorConstants,
            tevStages,
            alphaTest,
            ropInfo,
            texMatrices,
        });
        materialEntryIdx += 0x014C;
    }

    bmd.mat3 = { remapTable, materialEntries };
}

export interface TEX1_Texture {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    mipCount: number;
    data: ArrayBuffer;
}

export interface TEX1 {
    textures: TEX1_Texture[];
}

function readTEX1Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
    const textureCount = view.getUint16(0x08);
    const textureHeaderOffs = view.getUint32(0x0C);
    const nameTableOffs = view.getUint32(0x10);
    const nameTable = readStringTable(buffer, chunkStart + nameTableOffs);

    const textures: TEX1_Texture[] = [];
    let textureIdx = textureHeaderOffs;
    for (let i = 0; i < textureCount; i++) {
        const name = nameTable[i];
        const format: GX.TexFormat = view.getUint8(textureIdx + 0x00);
        const width = view.getUint16(textureIdx + 0x02);
        const height = view.getUint16(textureIdx + 0x04);
        const wrapS = view.getUint8(textureIdx + 0x06);
        const wrapT = view.getUint8(textureIdx + 0x07);
        const paletteFormat = view.getUint8(textureIdx + 0x09);
        const paletteNumEntries = view.getUint16(textureIdx + 0x0A);
        const paletteOffs = view.getUint16(textureIdx + 0x0C);
        const minFilter = view.getUint8(textureIdx + 0x14);
        const magFilter = view.getUint8(textureIdx + 0x15);
        const mipCount = view.getUint8(textureIdx + 0x18);
        const dataOffs = view.getUint32(textureIdx + 0x1C);
        const data = buffer.slice(chunkStart + textureIdx + dataOffs);

        textures.push({ name, format, width, height, wrapS, wrapT, minFilter, magFilter, mipCount, data });
        textureIdx += 0x20;
    }

    bmd.tex1 = { textures };
}

export class BMD {
    public inf1: INF1;
    public vtx1: VTX1;
    public drw1: DRW1;
    public jnt1: JNT1;
    public shp1: SHP1;
    public mat3: MAT3;
    public tex1: TEX1;

    static parse(buffer: ArrayBuffer) {
        const bmd = new BMD();
    
        const view = new DataView(buffer);
        const magic = readString(buffer, 0, 8);
        assert(magic === 'J3D2bmd3' || magic === 'J3D2bdl4');
    
        const size = view.getUint32(0x08);
        const numChunks = view.getUint32(0x0C);
        let offs = 0x20;

        type ParseFunc = (bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) => void;
        const parseFuncs: { [name: string]: ParseFunc } = {
            INF1: readINF1Chunk,
            VTX1: readVTX1Chunk,
            EVP1: null,
            DRW1: readDRW1Chunk,
            JNT1: readJNT1Chunk,
            SHP1: readSHP1Chunk,
            MAT3: readMAT3Chunk,
            TEX1: readTEX1Chunk,
            MDL3: null,
        };
    
        for (let i = 0; i < numChunks; i++) {
            const chunkStart = offs;
            const chunkId = readString(buffer, chunkStart + 0x00, 4);
            const chunkSize = view.getUint32(chunkStart + 0x04);
    
            const parseFunc = parseFuncs[chunkId];
            if (parseFunc === undefined)
                throw new Error(`Unknown chunk ${chunkId}!`);
    
            if (parseFunc !== null)
                parseFunc(bmd, buffer, chunkStart, chunkSize);
    
            offs += chunkSize;
        }
    
        return bmd;
    }
}

export const enum LoopMode {
    ONCE = 0,
    REPEAT = 2,
    MIRRORED_ONCE = 3,
    MIRRORED_REPEAT = 4,
}

export const enum TangentType {
    IN = 0,
    IN_OUT = 1,
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

export interface AnimationComponent {
    scale: AnimationTrack;
    rotation: AnimationTrack;
    translation: AnimationTrack;
}

export interface MaterialAnimationEntry {
    materialName: string;
    remapIndex: number;
    texMtxIndex: number;
    centerS: number;
    centerT: number;
    centerQ: number;
    s: AnimationComponent;
    t: AnimationComponent;
    q: AnimationComponent;
}

export interface TTK1 {
    duration: number;
    loopMode: LoopMode;
    rotationScale: number;
    materialAnimationEntries: MaterialAnimationEntry[];
}

function readTTK1Chunk(btk: BTK, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
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
    const sTableOffs = chunkStart + view.getUint32(0x28);
    const rTableOffs = chunkStart + view.getUint32(0x2C);
    const tTableOffs = chunkStart + view.getUint32(0x30);

    const sTable = new Float32Array(betoh(buffer.slice(sTableOffs, sTableOffs + sCount * 4), 4));
    const rTable = new Int16Array(betoh(buffer.slice(rTableOffs, rTableOffs + rCount * 2), 2));
    const tTable = new Float32Array(betoh(buffer.slice(tTableOffs, tTableOffs + tCount * 4), 4));

    const rotationScale = Math.pow(2, rotationDecimal);
    const materialNameTable = readStringTable(buffer, chunkStart + materialNameTableOffs);

    let animationTableIdx = animationTableOffs;

    function readAnimationTrack(data: Float32Array | Int16Array): AnimationTrack {
        const count = view.getUint16(animationTableIdx + 0x00);
        const index = view.getUint16(animationTableIdx + 0x02);
        const tangent: TangentType = view.getUint16(animationTableIdx + 0x04);
        animationTableIdx += 0x06;

        // Special exception.
        if (count === 1) {
            const value = data[index];
            const frames = [ { time: 0, value: value, tangentIn: 0, tangentOut: 0 } ];
            return { frames };
        } else {
            let frames: AnimationKeyframe[] = [];

            if (tangent === TangentType.IN) {
                for (let i = index; i < index + 3 * count; i += 3) {
                    const time = data[i+0], value = data[i+1], tangentIn = data[i+2], tangentOut = tangentIn;
                    frames.push({ time, value, tangentIn, tangentOut });
                }
            } else if (tangent === TangentType.IN_OUT) {
                for (let i = index; i < index + 4 * count; i += 4) {
                    const time = data[i+0], value = data[i+1], tangentIn = data[i+2], tangentOut = data[i+3];
                    frames.push({ time, value, tangentIn, tangentOut });
                }
            }

            return { frames };
        }
    }

    function readAnimationComponent(): AnimationComponent {
        const scale = readAnimationTrack(sTable);
        const rotation = readAnimationTrack(rTable);
        const translation = readAnimationTrack(tTable);
        return { scale, rotation, translation };
    }

    const materialAnimationEntries: MaterialAnimationEntry[] = [];
    for (let i = 0; i < animationCount; i++) {
        const materialName = materialNameTable[i];
        const remapIndex = view.getUint16(remapTableOffs + i * 0x02);
        const texMtxIndex = view.getUint8(texMtxIndexTableOffs + i);
        const centerS = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x00);
        const centerT = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x04);
        const centerQ = view.getFloat32(textureCenterTableOffs + i * 0x0C + 0x08);
        const s = readAnimationComponent();
        const t = readAnimationComponent();
        const q = readAnimationComponent();
        materialAnimationEntries.push({ materialName, remapIndex, texMtxIndex, centerS, centerT, centerQ, s, t, q });
    }

    btk.ttk1 = { duration, loopMode, rotationScale, materialAnimationEntries };
}

export class BTK {
    ttk1: TTK1;

    public findAnimationEntry(materialName: string, texMtxIndex: number) {
        return this.ttk1.materialAnimationEntries.find((e) => e.materialName === materialName && e.texMtxIndex === texMtxIndex);
    }

    public applyLoopMode(t: number, loopMode: LoopMode) {
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

    public cubicEval(cf0, cf1, cf2, cf3, t) {
        return (((cf0 * t + cf1) * t + cf2) * t + cf3);
    }

    public lerp(k0: AnimationKeyframe, k1: AnimationKeyframe, t: number) {
        return k0.value + (k1.value - k0.value) * t;
    }

    public hermiteInterpolate(k0: AnimationKeyframe, k1: AnimationKeyframe, t: number): number {
        const length = k1.time - k0.time;
        const p0 = k0.value;
        const p1 = k1.value;
        const s0 = k0.tangentOut * length;
        const s1 = k1.tangentIn * length;
		const cf0 = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1);
		const cf1 = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1);
		const cf2 = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0);
		const cf3 = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0);
        return this.cubicEval(cf0, cf1, cf2, cf3, t);
    }

    public sampleAnimationData(track: AnimationTrack, frame: number) {
        const frames = track.frames;

        if (frames.length === 1)
            return frames[0].value;

        // Find the first frame.
        const idx1 = frames.findIndex((key) => (frame < key.time));
        const idx0 = idx1 - 1;
        if (idx1 >= frames.length)
            return frames[idx0].value;

        const k0 = frames[idx0];
        const k1 = frames[idx1];
        const t = (frame - k0.time) / (k1.time - k0.time);
        // return this.lerp(k0, k1, t);
        return this.hermiteInterpolate(k0, k1, t);
    }

    public applyAnimation(dst: matrix3, materialName: string, texMtxIndex: number, time: number): boolean {
        const FPS = 30;

        const animationEntry = this.findAnimationEntry(materialName, texMtxIndex);
        if (!animationEntry)
            return false;

        const duration = this.ttk1.duration;
        const frame = time / FPS;
        const normTime = frame / duration;
        const animFrame = this.applyLoopMode(normTime, this.ttk1.loopMode) * duration;

        const centerS = animationEntry.centerS, centerT = animationEntry.centerT, centerQ = animationEntry.centerQ;
        const scaleS = this.sampleAnimationData(animationEntry.s.scale, animFrame);
        const scaleT = this.sampleAnimationData(animationEntry.t.scale, animFrame);
        const rotation = this.sampleAnimationData(animationEntry.s.rotation, animFrame) * this.ttk1.rotationScale;
        const translationS = this.sampleAnimationData(animationEntry.s.translation, animFrame);
        const translationT = this.sampleAnimationData(animationEntry.t.translation, animFrame);

        createTexMtx(dst, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);
        return true;
    }

    static parse(buffer: ArrayBuffer) {
        const btk = new BTK();

        const view = new DataView(buffer);
        const magic = readString(buffer, 0, 8);
        assert(magic === 'J3D1btk1');

        const size = view.getUint32(0x08);
        const numChunks = view.getUint32(0x0C);
        let offs = 0x20;

        type ParseFunc = (btk: BTK, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) => void;
        const parseFuncs: { [name: string]: ParseFunc } = {
            TTK1: readTTK1Chunk,
        };

        for (let i = 0; i < numChunks; i++) {
            const chunkStart = offs;
            const chunkId = readString(buffer, chunkStart + 0x00, 4);
            const chunkSize = view.getUint32(chunkStart + 0x04);

            const parseFunc = parseFuncs[chunkId];
            if (parseFunc === undefined)
                throw new Error(`Unknown chunk ${chunkId}!`);

            if (parseFunc !== null)
                parseFunc(btk, buffer, chunkStart, chunkSize - 0x04);

            offs += chunkSize;
        }

        return btk;
    }
}

export class BMT {
    public mat3: MAT3;
    public tex1: TEX1;

    static parse(buffer: ArrayBuffer) {
        const bmt = new BMT();
    
        const view = new DataView(buffer);
        const magic = readString(buffer, 0, 8);
        assert(magic === 'J3D2bmt3');
    
        const size = view.getUint32(0x08);
        const numChunks = view.getUint32(0x0C);
        let offs = 0x20;
    
        // XXX(jstpierre): Type system abuse.
        type ParseFunc = (bmt: any, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) => void;
        const parseFuncs: { [name: string]: ParseFunc } = {
            MAT3: readMAT3Chunk,
            TEX1: readTEX1Chunk,
            MDL3: null,
        };
    
        for (let i = 0; i < numChunks; i++) {
            const chunkStart = offs;
            const chunkId = readString(buffer, chunkStart + 0x00, 4);
            const chunkSize = view.getUint32(chunkStart + 0x04);
    
            const parseFunc = parseFuncs[chunkId];
            if (parseFunc === undefined)
                throw new Error(`Unknown chunk ${chunkId}!`);
    
            if (parseFunc !== null)
                parseFunc(bmt, buffer, chunkStart, chunkSize);
    
            offs += chunkSize;
        }
    
        return bmt;
    }
}
