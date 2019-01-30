
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";
import { AABB } from "../Geometry";

export interface SCN {
    materials: Material[];
    sectors: Sector[];
}

export const enum MatFlag {
    UV_WIBBLE                = 0x00000001,
    VC_WIBBLE                = 0x00000002,
    TEXTURED                 = 0x00000004,
    ENVIRONMENT              = 0x00000008,
    DECAL                    = 0x00000010,
    SMOOTH                   = 0x00000020,
    TRANSPARENT              = 0x00000040,
    PASS_COLOR_LOCKED        = 0x00000080,
    SPECULAR                 = 0x00000100,
    BUMP_SIGNED_TEXTURE      = 0x00000200,
    BUMP_LOAD_MATRIX         = 0x00000400,
    PASS_TEXTURE_ANIMATES    = 0x00000800,
    PASS_IGNORE_VERTEX_ALPHA = 0x00001000,
    EXPLICIT_UV_WIBBLE       = 0x00004000,
    WATER_EFFECT             = 0x08000000,
    NO_MAT_COL_MOD           = 0x10000000,
}

export const enum SectorFlag {
    HAS_TEXCOORDS            = 0x00000001,
    HAS_VERTEX_COLORS        = 0x00000002,
    HAS_VERTEX_NORMALS       = 0x00000004,
    HAS_VERTEX_WEIGHTS       = 0x00000010,
    HAS_VERTEX_COLOR_WIBBLES = 0x00000800,
    SHADOW_VOLUME            = 0x00200000,
    BILLBOARD_PRESENT        = 0x00800000,
}

export const enum BlendMode {
    DIFFUSE,
    ADD,
    ADD_FIXED,
    SUBTRACT,
    SUBTRACT_FIXED,
    BLEND,
    BLEND_FIXED,
    MODULATE,
    MODULATE_FIXED,
    BRIGHTEN,
    BRIGHTEN_FIXED,
    GLOSS_MAP,
    BLEND_PREVIOUS_MAP,
    BLEND_INVERSE_PREVIOUS_MAP,
}

export interface MaterialPass {
    textureChecksum: number;
    flags: MatFlag;
    blendMode: BlendMode;
}

export interface Material {
    materialChecksum: number;
    materialNameChecksum: number;
    alphaCutoff: number;
    drawOrder: number;
    zBias: number;
    sorted: boolean;
    singleSided: boolean;
    noBackfaceCulling: boolean;
    passes: MaterialPass[];
}

export interface MeshLodLevel {
    indexData: ArrayBufferSlice;
    packedVertexData: ArrayBufferSlice;
    vertexShader: number;
    vertexShader2: number;
    vertexNormalOffset: number;
    vertexColorOffset: number;
    vertexTexCoordOffset: number;
    vertexStride: number;
}

export interface Mesh {
    bbox: AABB;
    materialChecksum: number;
    lodLevels: MeshLodLevel[];
}

export interface Sector {
    sectorChecksum: number;
    flags: number;
    bbox: AABB;
    meshes: Mesh[];
}

export function parse(buffer: ArrayBufferSlice): SCN {
    const view = buffer.createDataView();

    const materialVersion = view.getUint32(0x00, true);
    const meshVersion = view.getUint32(0x04, true);
    const vertVersion = view.getUint32(0x08, true);

    const materialTableCount = view.getUint32(0x0C, true);
    let materialTableIdx = 0x10;
    const materials: Material[] = [];
    for (let i = 0; i < materialTableCount; i++) {
        const materialChecksum = view.getUint32(materialTableIdx + 0x00, true);
        const materialNameChecksum = view.getUint32(materialTableIdx + 0x04, true);
        const numPasses = view.getUint32(materialTableIdx + 0x08, true);
        const alphaCutoff = view.getUint32(materialTableIdx + 0x0C, true) & 0x000000FF;
        const sorted = view.getUint8(materialTableIdx + 0x10);
        assert(sorted < 0x02);
        const drawOrder = view.getFloat32(materialTableIdx + 0x11, true);
        const singleSided = view.getUint8(materialTableIdx + 0x15);
        assert(singleSided < 0x02);
        const noBackfaceCulling = view.getUint8(materialTableIdx + 0x16);
        assert(noBackfaceCulling < 0x02);
        const zBias = view.getInt32(materialTableIdx + 0x17, true);
        const grassify = view.getUint8(materialTableIdx + 0x1B);
        assert(grassify < 0x02);
        materialTableIdx += 0x1C;
        if (grassify != 0) {
            const grassHeight = view.getFloat32(materialTableIdx + 0x00, true);
            const grassLayers = view.getUint32(materialTableIdx + 0x04, true);
            materialTableIdx += 0x08;
        }
        const specPower = view.getFloat32(materialTableIdx + 0x00, true);
        materialTableIdx += 0x04;
        if (specPower > 0.0) {
            const specColorR = view.getFloat32(materialTableIdx + 0x00, true);
            const specColorG = view.getFloat32(materialTableIdx + 0x04, true);
            const specColorB = view.getFloat32(materialTableIdx + 0x08, true);
            materialTableIdx += 0x0C;
        }

        const passes: MaterialPass[] = [];
        for (let j = 0; j < numPasses; j++) {
            const textureChecksum = view.getUint32(materialTableIdx + 0x00, true);
            const flags: MatFlag = view.getUint32(materialTableIdx + 0x04, true);
            const hasColor = view.getUint8(materialTableIdx + 0x08);
            const colorR = view.getFloat32(materialTableIdx + 0x09, true);
            const colorG = view.getFloat32(materialTableIdx + 0x0D, true);
            const colorB = view.getFloat32(materialTableIdx + 0x11, true);
            const blendMode = view.getUint32(materialTableIdx + 0x15, true);
            const fixedAlpha = view.getUint32(materialTableIdx + 0x19, true);

            const uvAddressingU = view.getUint32(materialTableIdx + 0x1D, true);
            const uvAddressingV = view.getUint32(materialTableIdx + 0x21, true);
            const envMapTilingU = view.getFloat32(materialTableIdx + 0x25, true);
            const envMapTilingV = view.getFloat32(materialTableIdx + 0x29, true);
            const filteringMode = view.getUint32(materialTableIdx + 0x2D, true);

            materialTableIdx += 0x31;

            if (!!(flags & MatFlag.UV_WIBBLE)) {
                const wibbleVelocityU = view.getFloat32(materialTableIdx + 0x00, true);
                const wibbleVelocityV = view.getFloat32(materialTableIdx + 0x04, true);
                const wibbleFrequencyU = view.getFloat32(materialTableIdx + 0x08, true);
                const wibbleFrequencyV = view.getFloat32(materialTableIdx + 0x0C, true);
                const wibbleAmplitudeU = view.getFloat32(materialTableIdx + 0x10, true);
                const wibbleAmplitudeV = view.getFloat32(materialTableIdx + 0x14, true);
                const wibblePhaseU = view.getFloat32(materialTableIdx + 0x18, true);
                const wibblePhaseV = view.getFloat32(materialTableIdx + 0x1C, true);
                materialTableIdx += 0x20;
            }

            if (!!(flags & MatFlag.VC_WIBBLE)) {
                // Vertex color wibble.
                assert(j === 0);
                const numSeqs = view.getUint32(materialTableIdx + 0x00, true);
                materialTableIdx += 0x04;
                for (let k = 0; k < numSeqs; k++) {
                    const numKeys = view.getUint32(materialTableIdx + 0x00, true);
                    const phase = view.getUint32(materialTableIdx + 0x04, true);
                    for (let m = 0; m < numKeys; m++) {
                        const time = view.getUint32(materialTableIdx + 0x00, true);
                        const color = view.getUint32(materialTableIdx + 0x04, true);
                        materialTableIdx += 0x08;
                    }
                    materialTableIdx += 0x08;
                }
            }

            if (!!(flags & MatFlag.PASS_TEXTURE_ANIMATES)) {
                // Texture animation.
                const numKeyframes = view.getUint32(materialTableIdx + 0x00, true);
                const period = view.getUint32(materialTableIdx + 0x04, true);
                const iterations = view.getUint32(materialTableIdx + 0x08, true);
                const phase = view.getUint32(materialTableIdx + 0x0C, true);
                materialTableIdx += 0x10;
                for (let k = 0; k < numKeyframes; k++) {
                    const time = view.getUint32(materialTableIdx + 0x00, true);
                    const textureChecksum = view.getUint32(materialTableIdx + 0x04, true);
                    materialTableIdx += 0x08;
                }
            }

            const magFilter = view.getUint32(materialTableIdx + 0x00, true);
            const minFilter = view.getUint32(materialTableIdx + 0x04, true);
            const K = view.getUint32(materialTableIdx + 0x08, true);
            const L = view.getUint32(materialTableIdx + 0x0C, true);
            materialTableIdx += 0x10;

            passes.push({ textureChecksum, flags, blendMode });
        }

        materials.push({
            materialChecksum, materialNameChecksum,
            alphaCutoff, drawOrder, zBias,
            sorted: !!sorted,
            singleSided: !!singleSided,
            noBackfaceCulling: !!noBackfaceCulling,
            passes,
         })
    }

    let sceneIdx = materialTableIdx;

    const numSectors = view.getUint32(sceneIdx + 0x00, true);
    let sectorTableIdx = sceneIdx + 0x04;
    const sectors: Sector[] = [];
    for (let i = 0; i < numSectors; i++) {
        const sectorChecksum = view.getUint32(sectorTableIdx + 0x00, true);
        const boneIdx = view.getUint32(sectorTableIdx + 0x04, true);
        const flags = view.getUint32(sectorTableIdx + 0x08, true);
        const numMeshes = view.getUint32(sectorTableIdx + 0x0C, true);
        const bboxMinX = view.getFloat32(sectorTableIdx + 0x10, true);
        const bboxMinY = view.getFloat32(sectorTableIdx + 0x14, true);
        const bboxMinZ = view.getFloat32(sectorTableIdx + 0x18, true);
        const bboxMaxX = view.getFloat32(sectorTableIdx + 0x1C, true);
        const bboxMaxY = view.getFloat32(sectorTableIdx + 0x20, true);
        const bboxMaxZ = view.getFloat32(sectorTableIdx + 0x24, true);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

        const bsphereCenterX = view.getFloat32(sectorTableIdx + 0x28, true);
        const bsphereCenterY = view.getFloat32(sectorTableIdx + 0x2C, true);
        const bsphereCenterZ = view.getFloat32(sectorTableIdx + 0x30, true);
        const bsphereRadius = view.getFloat32(sectorTableIdx + 0x34, true);

        sectorTableIdx += 0x38;

        // Billboard.
        if (flags & 0x00800000) {
            const bbType = view.getUint32(sectorTableIdx + 0x00, true);
            const bbOriginX = view.getFloat32(sectorTableIdx + 0x04, true);
            const bbOriginY = view.getFloat32(sectorTableIdx + 0x08, true);
            const bbOriginZ = view.getFloat32(sectorTableIdx + 0x0C, true);
            const bbPivotPosX = view.getFloat32(sectorTableIdx + 0x10, true);
            const bbPivotPosY = view.getFloat32(sectorTableIdx + 0x14, true);
            const bbPivotPosZ = view.getFloat32(sectorTableIdx + 0x18, true);
            const bbPivotAxisX = view.getFloat32(sectorTableIdx + 0x1C, true);
            const bbPivotAxisY = view.getFloat32(sectorTableIdx + 0x20, true);
            const bbPivotAxisZ = view.getFloat32(sectorTableIdx + 0x24, true);
            sectorTableIdx += 0x28;
        }

        const meshes: Mesh[] = [];
        for (let j = 0; j < numMeshes; j++) {
            const bsphereCenterX = view.getFloat32(sectorTableIdx + 0x00, true);
            const bsphereCenterY = view.getFloat32(sectorTableIdx + 0x04, true);
            const bsphereCenterZ = view.getFloat32(sectorTableIdx + 0x08, true);
            const bsphereRadius = view.getFloat32(sectorTableIdx + 0x0C, true);

            const bboxMinX = view.getFloat32(sectorTableIdx + 0x10, true);
            const bboxMinY = view.getFloat32(sectorTableIdx + 0x14, true);
            const bboxMinZ = view.getFloat32(sectorTableIdx + 0x18, true);
            const bboxMaxX = view.getFloat32(sectorTableIdx + 0x1C, true);
            const bboxMaxY = view.getFloat32(sectorTableIdx + 0x20, true);
            const bboxMaxZ = view.getFloat32(sectorTableIdx + 0x24, true);
            const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

            const flags = view.getUint32(sectorTableIdx + 0x28, true);
            const materialChecksum = view.getUint32(sectorTableIdx + 0x2C, true);
            const numLodIndexLevels = view.getUint32(sectorTableIdx + 0x30, true);
            assert(numLodIndexLevels >= 1 && numLodIndexLevels <= 8);

            sectorTableIdx += 0x34;

            const lodLevels: MeshLodLevel[] = [];
            for (let k = 0; k < numLodIndexLevels; k++) {
                const numIndices = view.getUint32(sectorTableIdx + 0x00, true);
                const indexData = buffer.subarray(sectorTableIdx + 0x04, numIndices * 0x02);
                sectorTableIdx += 0x04 + indexData.byteLength;

                const numIndices2 = view.getUint16(sectorTableIdx + 0x00, true);
                const indexData2 = buffer.subarray(sectorTableIdx + 0x02, numIndices2 * 0x02);
                sectorTableIdx += 0x02 + indexData2.byteLength;

                // Padding?
                sectorTableIdx += 0x0E;

                const vertexStride = view.getUint8(sectorTableIdx + 0x00);
                const numVertices = view.getUint16(sectorTableIdx + 0x01, true);
                const numStreams = view.getUint16(sectorTableIdx + 0x03, true);
                assert(numStreams === 1);
                sectorTableIdx += 0x05;

                const packedVertexStreamSize = view.getUint32(sectorTableIdx + 0x00, true);
                assert(packedVertexStreamSize === numVertices * vertexStride);
                const packedVertexData = buffer.subarray(sectorTableIdx + 0x04, packedVertexStreamSize);
                sectorTableIdx += 0x04 + packedVertexData.byteLength;

                const vertexShader = view.getUint32(sectorTableIdx + 0x00, true);
                const vertexShader2 = view.getUint32(sectorTableIdx + 0x04, true);
                const vertexNormalOffset = view.getUint8(sectorTableIdx + 0x08);
                const vertexColorOffset = view.getUint8(sectorTableIdx + 0x09);
                const vertexTexCoordOffset = view.getUint8(sectorTableIdx + 0x0A);
                const hasColorWibbleData = view.getUint8(sectorTableIdx + 0x0B);
                sectorTableIdx += 0x0C;

                if (hasColorWibbleData) {
                    const colorWibbleStream = buffer.subarray(sectorTableIdx + 0x00, numVertices * 0x01);
                    sectorTableIdx += colorWibbleStream.byteLength;
                }

                const numIndexSets = view.getUint32(sectorTableIdx + 0x00, true);
                assert(numIndexSets === 0x01);

                const pixelShader = view.getUint32(sectorTableIdx + 0x04, true);
                sectorTableIdx += 0x08;
                if (pixelShader === 0x01) {
                    const unk1 = view.getUint32(sectorTableIdx + 0x00, true);
                    const unkStreamCount = view.getUint32(sectorTableIdx + 0x04, true);
                    const unkStream = buffer.subarray(sectorTableIdx + 0x08, unkStreamCount * 0x01);
                    sectorTableIdx += 0x08 + unkStream.byteLength;
                }

                lodLevels.push({ indexData: indexData2, packedVertexData, vertexShader, vertexShader2, vertexNormalOffset, vertexColorOffset, vertexTexCoordOffset, vertexStride });
            }

            meshes.push({ bbox, lodLevels, materialChecksum });
        }

        sectors.push({ sectorChecksum, flags, bbox, meshes });
    }

    return { materials, sectors };
}
