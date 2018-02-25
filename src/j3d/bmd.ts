
import * as GX from './gx_enum';
import * as GX_Material from './gx_material';

import { be16toh, be32toh } from 'endian';
import { assert } from 'util';
import { mat2d, mat4, mat3 as matrix3 } from 'gl-matrix';

function readString(buffer: ArrayBuffer, offs: number, length: number): string {
    const length2 = Math.min(length, buffer.byteLength - offs);
    const buf = new Uint8Array(buffer, offs, length2);
    let S = '';
    for (let i = 0; i < buf.byteLength; i++) {
        if (buf[i] === 0)
            break;
        S += String.fromCharCode(buf[i]);
    }
    return S;
}

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

export interface HierarchyTreeNode {
    type: HierarchyType.Open;
    children: HierarchyNode[];
}
export interface HierarchyShapeNode {
    type: HierarchyType.Shape;
    shapeIdx: number;
}
export interface HierarchyJointNode {
    type: HierarchyType.Joint;
    jointIdx: number;
}
export interface HierarchyMaterialNode {
    type: HierarchyType.Material;
    materialIdx: number;
}
export type HierarchyNode = HierarchyTreeNode | HierarchyShapeNode | HierarchyJointNode | HierarchyMaterialNode;

export interface INF1 {
    sceneGraph: HierarchyNode;
}

function readINF1Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
    const view = new DataView(buffer, chunkStart, chunkSize);
    // unk
    const packetCount = view.getUint32(0x0C);
    const vertexCount = view.getUint32(0x10);
    const hierarchyOffs = view.getUint32(0x14);

    const parentStack: HierarchyTreeNode[] = [];
    let node: HierarchyTreeNode = { type: HierarchyType.Open, children: [] };
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
            parentStack.push(node);
            node.children.push(node = { type: HierarchyType.Open, children: [] });
            break;
        case HierarchyType.Close:
            node = parentStack.pop();
            break;
        case HierarchyType.Joint:
            node.children.push({ type, jointIdx: value });
            break;
        case HierarchyType.Material:
            node.children.push({ type, materialIdx: value });
            break;
        case HierarchyType.Shape:
            node.children.push({ type, shapeIdx: value });
            break;
        }
    }

    assert(parentStack.length === 0);
    bmd.inf1 = { sceneGraph: node };
}

type CompSize = 1 | 2 | 4;

function bswapArray(m: ArrayBuffer, componentSize: CompSize): ArrayBuffer {
    switch (componentSize) {
    case 1:
        return m;
    case 2:
        return be16toh(m);
    case 4:
        return be32toh(m);
    }
}

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
        const vtxDataBuffer = bswapArray(vtxDataBufferRaw, compSize);
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

export interface Shape {
    // The vertex data. Converted to a modern-esque buffer per-shape.
    packedData: ArrayBuffer;
    // The size of an individual vertex.
    packedVertexSize: number;
    packedVertexAttributes: PackedVertexAttribute[];
    // The draw calls.
    drawCalls: DrawCall[];
}

// Describes an individual vertex attribute in the packed data.
export interface PackedVertexAttribute {
    vtxAttrib: GX.VertexAttribute;
    indexDataType: GX.CompType;
    offset: number;
}

interface DrawCall {
    primType: GX.PrimitiveType;
    vertexCount: number;
    // The "index" of the vertex into the packedData.
    first: number;
    // For internal use while building.
    srcOffs: number;
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
        const drawCalls: DrawCall[] = [];

        let totalVertexCount = 0;
        for (let j = 0; j < packetCount; j++) {
            const packetSize = view.getUint32(packetIdx + 0x00);
            const packetStart = primDataOffs + view.getUint32(packetIdx + 0x04);

            // XXX: We need an "update matrix table" command here in the draw call list.

            const drawCallEnd = packetStart + packetSize;
            let drawCallIdx = packetStart;
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
                // Skip over the index data.
                drawCallIdx += vertexIndexSize * vertexCount;
                drawCalls.push({ primType, vertexCount, first, srcOffs });
            }

            packetIdx += 0x08;
        }

        // Now copy our data into it.
        const packedDataSize = packedVertexSize * totalVertexCount;
        const packedDataView = new Uint8Array(packedDataSize);
        let packedDataOffs = 0;
        for (const drawCall of drawCalls) {
            let drawCallIdx = drawCall.srcOffs;
            for (let j = 0; j < drawCall.vertexCount; j++) {
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
        assert((packedVertexSize * totalVertexCount) === packedDataOffs);
        const packedData = packedDataView.buffer;

        // Now we should have a complete shape. Onto the next!
        shapes.push({ packedData, packedVertexSize, packedVertexAttributes, drawCalls });

        shapeIdx += 0x28;
    }

    const shp1 = { shapes };
    bmd.shp1 = shp1;
}

export interface MAT3 {
    remapTable: number[];
    materialEntries: GX_Material.GXMaterial[];
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
            const centerW = view.getFloat32(texMtxOffs + 0x0C);
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

            const S = mat2d.create();
            mat2d.fromScaling(S, [scaleS, scaleT]);
            const CI = mat2d.create();
            mat2d.fromTranslation(CI, [-centerS, -centerT, -centerW]);
            const C = mat2d.create();
            mat2d.fromTranslation(C, [centerS, centerT, centerW]);
            const T = mat2d.create();
            mat2d.fromTranslation(T, [translationS, translationT, 0]);

            const m = mat2d.create();
            mat2d.mul(m, T, CI);
            mat2d.mul(S, S, C);
            mat2d.mul(m, m, S);

            /*
            const sin = Math.sin(rotation * Math.PI);
            const cos = Math.cos(rotation * Math.PI);
            const m = mat2d.fromValues(
                scaleS * cos, scaleS * -sin,
                scaleT * sin, scaleS *  cos,
                translationS + centerS + (centerS * scaleS * -cos) + (centerT * scaleS *  sin),
                translationT + centerT + (centerS * scaleT * -sin) + (centerT * scaleS * -cos)
            );
            */

            const matrix = matrix3.create();
            matrix3.fromMat2d(matrix, m);
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

export function readTEX1Chunk(bmd: BMD, buffer: ArrayBuffer, chunkStart: number, chunkSize: number) {
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
    public shp1: SHP1;
    public mat3: MAT3;
    public tex1: TEX1;
}

export function parse(buffer: ArrayBuffer) {
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
        DRW1: null,
        JNT1: null,
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
