
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readString, assert } from "../../util";
import { vec3 } from "gl-matrix";
import { AABB } from "../../Geometry";

const utf16Decoder = new TextDecoder('utf-16le')!;

function readStringUTF16(buffer: ArrayBufferSlice, offs: number): string {
    const arr = buffer.createTypedArray(Uint8Array, offs, Math.min(buffer.byteLength - offs, 0x100));
    const raw = utf16Decoder.decode(arr);
    const nul = raw.indexOf('\u0000');
    let str: string;
    if (nul >= 0)
        str = raw.slice(0, nul);
    else
        str = raw;
    return str;
}

export interface MaterialParameter {
    name: string;
    value: string;
}

export interface Material {
    name: string;
    mtdName: string;
    parameters: MaterialParameter[];
    paramStart: number;
    paramCount: number;
    flags: number;
}

export interface Joint {
    name: string;
    translation: vec3;
    rotation: vec3;
    scale: vec3;
}

export interface Primitive {
    flags: number;
    topology: number;
    cullMode: number;
    indexData: ArrayBufferSlice;
    indexCount: number;
}

export interface InputState {
    inputLayoutIndex: number;
    vertexSize: number;
    vertexData: ArrayBufferSlice;
}

export const enum VertexInputSemantic {
    Position    = 0,
    JointIndex  = 1,
    JointWeight = 2,
    Normal      = 3,
    UV          = 5,
    Tangent     = 6,
    Bitangent   = 7,
    Color       = 10,
}

export interface VertexAttribute {
    offset: number;
    dataType: number;
    semantic: VertexInputSemantic;
    index: number;
}

export interface InputLayout {
    vertexAttributes: VertexAttribute[];
}

export interface Batch {
    materialIndex: number;
    jointIndexes: number[];
    primitiveIndexes: number[];
    inputStateIndex: number;
}

export interface FLVER {
    bbox: AABB;
    materials: Material[];
    joints: Joint[];
    primitives: Primitive[];
    inputLayouts: InputLayout[];
    inputStates: InputState[];
    batches: Batch[];
}

export function parse(buffer: ArrayBufferSlice): FLVER {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x0, 0x06, false) == 'FLVER\0');

    const dataOffs = view.getUint32(0x0C, true);
    const dataSize = view.getUint32(0x10, true);

    const hitboxCount = view.getUint32(0x14, true);
    const materialCount = view.getUint32(0x18, true);
    const jointCount = view.getUint32(0x1C, true);
    const inputStateCount = view.getUint32(0x20, true);
    const batchCount = view.getUint32(0x24, true);

    const bboxMinX = view.getFloat32(0x28, true);
    const bboxMinY = view.getFloat32(0x2C, true);
    const bboxMinZ = view.getFloat32(0x30, true);
    const bboxMaxX = view.getFloat32(0x34, true);
    const bboxMaxY = view.getFloat32(0x38, true);
    const bboxMaxZ = view.getFloat32(0x3C, true);
    const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

    const primitiveCount = view.getUint32(0x50, true);
    const inputLayoutCount = view.getUint32(0x54, true);
    const mtdParamCount = view.getUint32(0x58, true);

    let offs = 0x80;

    function readStringW() {
        var stringOffs = view.getUint32(offs + 0x00, true);
        offs += 0x04;
        return readStringUTF16(buffer, stringOffs);
    }

    for (let i = 0; i < hitboxCount; i++) {
        // I don't care.
        offs += 0x40;
    }

    const materials: Material[] = [];
    for (let i = 0; i < materialCount; i++) {
        const mo = offs;
        const nameOffs = view.getUint32(offs + 0x00, true);
        const name = readStringUTF16(buffer, nameOffs);
        const mtdNameOffs = view.getUint32(offs + 0x04, true);
        const mtdName = readStringUTF16(buffer, mtdNameOffs);
 
        const paramCount = view.getUint32(offs + 0x08, true);
        const paramStart = view.getUint32(offs + 0x0C, true);
        const flags = view.getUint32(offs + 0x10, true);
        // Unk.
 
        materials.push({ name, mtdName, parameters: [], paramCount, paramStart, flags });
        offs += 0x20;
    }
 
    const joints: Joint[] = [];
    for (let i = 0; i < jointCount; i++) {
        const translationX = view.getFloat32(offs + 0x00, true);
        const translationY = view.getFloat32(offs + 0x04, true);
        const translationZ = view.getFloat32(offs + 0x08, true);
        offs += 0x0C;

        const name = readStringW();
        const rotationX = view.getFloat32(offs + 0x00, true);
        const rotationY = view.getFloat32(offs + 0x04, true);
        const rotationZ = view.getFloat32(offs + 0x08, true);
        offs += 0x0C;

        const parentID = view.getUint16(offs, true);
        offs += 0x02;
        const firstChildID = view.getUint16(offs, true);
        offs += 0x02;

        const scaleX = view.getFloat32(offs + 0x00, true);
        const scaleY = view.getFloat32(offs + 0x04, true);
        const scaleZ = view.getFloat32(offs + 0x08, true);
        offs += 0x0C;

        const firstSiblingID = view.getUint16(offs, true);
        offs += 0x02;
        const jointID = view.getUint16(offs, true);
        offs += 0x02;
        offs += 0x50;

        const translation = vec3.fromValues(translationX, translationY, translationZ);
        const rotation = vec3.fromValues(rotationX, rotationY, rotationZ);
        const scale = vec3.fromValues(scaleX, scaleY, scaleZ);
        joints.push({ name, translation, rotation, scale });
    }

    const batches: Batch[] = [];
    for (let i = 0; i < batchCount; i++) {
        const flags = view.getUint32(offs + 0x00, true);
        const materialIndex = view.getUint32(offs + 0x04, true);
        offs += 0x08;

        // Unk.
        offs += 0x08;

        const defaultJointIndex = view.getUint32(offs + 0x00, true);
        const jointIndexTableCount = view.getUint32(offs + 0x04, true);
        // Unk.
        let jointIndexTableIdx = view.getUint32(offs + 0x0C, true);
        const jointIndexes: number[] = [];
        for (let i = 0; i < jointIndexTableCount; i++) {
            const jointIndex = view.getUint32(jointIndexTableIdx + 0x00, true);
            jointIndexes.push(jointIndex);
            jointIndexTableIdx += 0x04;
        }
        offs += 0x10;

        const primitiveIndexTableCount = view.getUint32(offs + 0x00, true);
        const primitiveIndexes: number[] = [];
        let primitiveIndexTableIdx = view.getUint32(offs + 0x04, true);
        for (let i = 0; i < primitiveIndexTableCount; i++) {
            const primitiveIndex = view.getUint32(primitiveIndexTableIdx + 0x00, true);
            primitiveIndexes.push(primitiveIndex);
            primitiveIndexTableIdx += 0x04;
        }
        offs += 0x08;

        const inputStateIndexTableCount = view.getUint32(offs + 0x00, true);
        assert(inputStateIndexTableCount === 1);
        const inputStateIndexTableOffs = view.getUint32(offs + 0x04, true);
        const inputStateIndex = view.getUint32(inputStateIndexTableOffs + 0x00, true);
        batches.push({ materialIndex, jointIndexes, primitiveIndexes, inputStateIndex });
        offs += 0x08;
    }

    const primitives: Primitive[] = [];
    for (let i = 0; i < primitiveCount; i++) {
        const flags = view.getUint32(offs + 0x00, true);
        const topology = view.getUint8(offs + 0x04);
        assert(topology === 0x01); // triangle strip
        const cullMode = view.getUint8(offs + 0x05);
        // Padding.
        const indexCount = view.getUint32(offs + 0x08, true);
        const indexBufferOffset = view.getUint32(offs + 0x0C, true);
        const indexBufferSize = view.getUint32(offs + 0x10, true);
        assert(indexBufferSize / 2 === indexCount);
        const indexData = buffer.subarray(dataOffs + indexBufferOffset, indexBufferSize);
        // Padding?
        primitives.push({ flags, topology, cullMode, indexData, indexCount });
        offs += 0x20;
    }

    const inputStates: InputState[] = [];
    for (let i = 0; i < inputStateCount; i++) {
        // Unknown
        const inputLayoutIndex = view.getUint32(offs + 0x04, true);
        const vertexSize = view.getUint32(offs + 0x08, true);
        const vertexCount = view.getUint32(offs + 0x0C, true);
        // Unknown
        // Unknown
        const vertexDataSize = view.getUint32(offs + 0x18, true);
        const vertexDataOffset = view.getUint32(offs + 0x1C, true);
        const vertexData = buffer.subarray(dataOffs + vertexDataOffset, vertexDataSize);
        inputStates.push({ inputLayoutIndex, vertexSize, vertexData });
        offs += 0x20;
    }

    const inputLayouts: InputLayout[] = [];
    for (let i = 0; i < inputLayoutCount; i++) {
        const vertexAttributeTableCount = view.getUint32(offs + 0x00, true);
        // Unknown
        // Unknown
        let vertexAttributeTableIdx = view.getUint32(offs + 0x0C, true);

        const vertexAttributes: VertexAttribute[] = [];
        for (let i = 0; i < vertexAttributeTableCount; i++) {
            // Unknown
            const offset = view.getUint32(vertexAttributeTableIdx + 0x04, true);
            const dataType = view.getUint32(vertexAttributeTableIdx + 0x08, true);
            const semantic = view.getUint32(vertexAttributeTableIdx + 0x0C, true) as VertexInputSemantic;
            const index = view.getUint32(vertexAttributeTableIdx + 0x10, true);
            vertexAttributes.push({ offset, dataType, semantic, index });
            vertexAttributeTableIdx += 0x14;
        }

        inputLayouts.push({ vertexAttributes });
        offs += 0x10;
    }

    const materialParameters: MaterialParameter[] = [];
    for (let i = 0; i < mtdParamCount; i++) {
        const valueOffs = view.getUint32(offs + 0x00, true);
        const value = readStringUTF16(buffer, valueOffs);
        const nameOffs = view.getUint32(offs + 0x04, true);
        const name = readStringUTF16(buffer, nameOffs);

        materialParameters.push({ name, value });
        offs += 0x20;
    }

    // Assign material parameters
    for (let i = 0; i < materials.length; i++) {
        const material = materials[i];
        material.parameters = materialParameters.slice(material.paramStart, material.paramStart + material.paramCount);
    }

    return { bbox, materials, joints, primitives, inputLayouts, inputStates, batches };
}
