
// Source Engine BSP.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assertExists, assert, nArray, hexdump } from "../util";
import { vec4, vec3, vec2 } from "gl-matrix";
import { getTriangleIndexCountForTopologyIndexCount, GfxTopology, convertToTrianglesRange } from "../gfx/helpers/TopologyHelpers";
import { parseZipFile, ZipFile } from "../ZipFile";
import { parseEntitiesLump, Entity } from "./VMT";
import { Plane, AABB } from "../Geometry";

const enum LumpType {
    ENTITIES             = 0,
    PLANES               = 1,
    TEXDATA              = 2,
    VERTEXES             = 3,
    NODES                = 5,
    TEXINFO              = 6,
    FACES                = 7,
    LIGHTING             = 8,
    LEAFS                = 10,
    EDGES                = 12,
    SURFEDGES            = 13,
    MODELS               = 14,
    LEAFFACES            = 16,
    VERTNORMALS          = 30,
    VERTNORMALINDICES    = 31,
    PRIMITIVES           = 37,
    PRIMINDICES          = 39,
    PAKFILE              = 40,
    TEXDATA_STRING_DATA  = 43,
    TEXDATA_STRING_TABLE = 44,
    FACES_HDR            = 58,
}

export interface SurfaceLighting {
    width: number;
    height: number;
    mins: number[];
    styles: number[];
    lightmapSize: number;
    samples: Uint8Array | null;
    hasBumpmapSamples: boolean;
}

export interface Surface {
    texinfo: number;
    startIndex: number;
    indexCount: number;
    center: vec3;
    lighting: SurfaceLighting;
}

interface TexinfoMapping {
    s: vec4;
    t: vec4;
}

const enum TexinfoFlags {
    SKY2D     = 0x0002,
    SKY       = 0x0004,
    NODRAW    = 0x0080,
    NOLIGHT   = 0x0400,
    BUMPLIGHT = 0x0800,
}

export interface Texinfo {
    textureMapping: TexinfoMapping;
    lightmapMapping: TexinfoMapping;
    flags: TexinfoFlags;

    // texdata
    texName: string;
    width: number;
    height: number;
}

function calcTexCoord(dst: vec2, v: vec3, m: TexinfoMapping): void {
    dst[0] = v[0]*m.s[0] + v[1]*m.s[1] + v[2]*m.s[2] + m.s[3];
    dst[1] = v[0]*m.t[0] + v[1]*m.t[1] + v[2]*m.t[2] + m.t[3];
}

export interface BSPNode {
    plane: Plane;
    child0: number;
    child1: number;
    bbox: AABB;
    area: number;
    surfaceStart: number;
    surfaceCount: number;
}

export interface BSPLeaf {
    bbox: AABB;
    leaffaceStart: number;
    leaffaceCount: number;
}

export interface Model {
    bbox: AABB;
    headnode: number;
    surfaceStart: number;
    surfaceCount: number;
}

export class BSPFile {
    public entities: Entity[] = [];
    public texinfo: Texinfo[] = [];
    public surfaces: Surface[] = [];
    public models: Model[] = [];
    public pakfile: ZipFile | null = null;

    public indexData: Uint16Array;
    public vertexData: Float32Array;

    public nodelist: BSPNode[] = [];
    public leaflist: BSPLeaf[] = [];
    public leaffacelist: Uint16Array;

    constructor(buffer: ArrayBufferSlice) {
        assertExists(readString(buffer, 0x00, 0x04) === 'VBSP');
        const view = buffer.createDataView();
        const version = view.getUint32(0x04, true);
        assert(version === 0x13);

        function getLumpDataEx(lumpType: LumpType): [ArrayBufferSlice, number] {
            const lumpsStart = 0x08;
            const idx = lumpsStart + lumpType * 0x10;
            const view = buffer.createDataView();
            const offs = view.getUint32(idx + 0x00, true);
            const size = view.getUint32(idx + 0x04, true);
            const version = view.getUint32(idx + 0x08, true);
            const uncompressedSize = view.getUint32(idx + 0x0C, true);
            assert(uncompressedSize === 0x00);
            return [buffer.subarray(offs, size), version];
        }

        function getLumpData(lumpType: LumpType, expectedVersion: number = 0): ArrayBufferSlice {
            const [buffer, version] = getLumpDataEx(lumpType);
            if (buffer.byteLength !== 0)
                assert(version === expectedVersion);
            return buffer;
        }

        // Parse out entities.
        this.entities = parseEntitiesLump(getLumpData(LumpType.ENTITIES));

        function readVec4(view: DataView, offs: number): vec4 {
            const x = view.getFloat32(offs + 0x00, true);
            const y = view.getFloat32(offs + 0x04, true);
            const z = view.getFloat32(offs + 0x08, true);
            const w = view.getFloat32(offs + 0x0C, true);
            return vec4.fromValues(x, y, z, w);
        }

        // Parse out texinfo / texdata.
        const texstrTable = getLumpData(LumpType.TEXDATA_STRING_TABLE).createTypedArray(Uint32Array);
        const texstrData = getLumpData(LumpType.TEXDATA_STRING_DATA);
        const texdata = getLumpData(LumpType.TEXDATA).createDataView();
        const texinfo = getLumpData(LumpType.TEXINFO).createDataView();
        const texinfoCount = texinfo.byteLength / 0x48;
        for (let i = 0; i < texinfoCount; i++) {
            const infoOffs = i * 0x48;
            const textureMappingS = readVec4(texinfo, infoOffs + 0x00);
            const textureMappingT = readVec4(texinfo, infoOffs + 0x10);
            const textureMapping: TexinfoMapping = { s: textureMappingS, t: textureMappingT };
            const lightmapMappingS = readVec4(texinfo, infoOffs + 0x20);
            const lightmapMappingT = readVec4(texinfo, infoOffs + 0x30);
            const lightmapMapping: TexinfoMapping = { s: lightmapMappingS, t: lightmapMappingT };
            const flags: TexinfoFlags = texinfo.getUint32(infoOffs + 0x40, true);
            const texdataIdx = texinfo.getUint32(infoOffs + 0x44, true);

            const texdataOffs = texdataIdx * 0x20;
            const reflectivityR = texdata.getFloat32(texdataOffs + 0x00, true);
            const reflectivityG = texdata.getFloat32(texdataOffs + 0x04, true);
            const reflectivityB = texdata.getFloat32(texdataOffs + 0x08, true);
            const nameTableStringID = texdata.getUint32(texdataOffs + 0x0C, true);
            const width = texdata.getUint32(texdataOffs + 0x10, true);
            const height = texdata.getUint32(texdataOffs + 0x14, true);
            const view_width = texdata.getUint32(texdataOffs + 0x18, true);
            const view_height = texdata.getUint32(texdataOffs + 0x1C, true);
            const texName = readString(texstrData, texstrTable[nameTableStringID]);

            this.texinfo.push({ textureMapping, lightmapMapping, flags, texName, width, height });
        }

        // Parse materials.
        const pakfileData = getLumpData(LumpType.PAKFILE);
        if (pakfileData !== null)
            this.pakfile = parseZipFile(pakfileData);

        // Build our mesh.

        // Parse out edges / surfedges.
        const edges = getLumpData(LumpType.EDGES).createTypedArray(Uint16Array);
        const surfedges = getLumpData(LumpType.SURFEDGES).createTypedArray(Int32Array);
        const vertindices = new Uint32Array(surfedges.length);
        for (let i = 0; i < surfedges.length; i++) {
            const surfedge = surfedges[i];
            if (surfedges[i] >= 0)
                vertindices[i] = edges[surfedge * 2 + 0];
            else
                vertindices[i] = edges[-surfedge * 2 + 1];
        }

        // Parse out surfaces.
        let faces = getLumpData(LumpType.FACES_HDR, 1).createDataView();
        if (faces.byteLength === 0)
            faces = getLumpData(LumpType.FACES, 1).createDataView();

        const faceCount = faces.byteLength / 0x38;
        const primindices = getLumpData(LumpType.PRIMINDICES).createTypedArray(Uint16Array);
        const primitives = getLumpData(LumpType.PRIMITIVES).createDataView();

        // Count up the number of vertices we need.
        let vertCount = 0;
        let indexCount = 0;
        for (let i = 0; i < faceCount; i++) {
            const idx = i * 0x38;
            const numedges = faces.getUint16(idx + 0x08, true);
            vertCount += numedges;

            const m_NumPrims = faces.getUint16(idx + 0x30, true);
            const firstPrimID = faces.getUint16(idx + 0x32, true);
            if (m_NumPrims !== 0) {
                const primOffs = firstPrimID * 0x0A;
                const primIndexCount = primitives.getUint16(primOffs + 0x04, true);
                indexCount += primIndexCount;
            } else {
                indexCount += getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRIFAN, numedges);
            }
        }

        // 3 pos, 3 normal, 4 tangent, 4 uv
        const vertexSize = (3 + 3 + 4 + 4);
        const vertexData = new Float32Array(vertCount * vertexSize);
        assert(vertCount < 0xFFFF);
        const indexData = new Uint16Array(indexCount);

        const planes = getLumpData(LumpType.PLANES).createDataView();
        const vertexes = getLumpData(LumpType.VERTEXES).createTypedArray(Float32Array);
        const vertnormals = getLumpData(LumpType.VERTNORMALS).createTypedArray(Float32Array);
        const vertnormalindices = getLumpData(LumpType.VERTNORMALINDICES).createTypedArray(Uint16Array);
        const lighting = getLumpData(LumpType.LIGHTING, 1);

        const scratchVec2 = vec2.create();
        const scratchPosition = vec3.create();
        const scratchNormal = vec3.create();
        const scratchTangentT = vec3.create();
        const scratchTangentS = vec3.create();

        let dstOffs = 0;
        let dstOffsIndex = 0;
        let dstIndexBase = 0;
        let vertnormalIdx = 0;
        for (let i = 0; i < faceCount; i++) {
            const idx = i * 0x38;
            const planenum = faces.getUint16(idx + 0x00, true);
            const side = faces.getUint8(idx + 0x02);
            const onNode = faces.getUint8(idx + 0x03);
            const firstedge = faces.getUint32(idx + 0x04, true);
            const numedges = faces.getUint16(idx + 0x08, true);
            const texinfo = faces.getUint16(idx + 0x0A, true);
            const dispinfo = faces.getInt16(idx + 0x0C, true);
            const surfaceFogVolumeID = faces.getUint16(idx + 0x0E, true);
            // lighting info
            const styles: number[] = [];
            for (let j = 0; j < 4; j++) {
                const style = faces.getUint8(idx + 0x10 + j);
                if (style === 0xFF)
                    break;
                styles.push(style);
            }

            const lightofs = faces.getInt32(idx + 0x14, true);
            const area = faces.getFloat32(idx + 0x18, true);
            const m_LightmapTextureMinsInLuxels = nArray(2, (i) => faces.getInt32(idx + 0x1C + i * 4, true));
            const m_LightmapTextureSizeInLuxels = nArray(2, (i) => faces.getUint32(idx + 0x24 + i * 4, true));
            const origFace = faces.getUint32(idx + 0x2C, true);
            const m_NumPrims = faces.getUint16(idx + 0x30, true);
            const firstPrimID = faces.getUint16(idx + 0x32, true);
            const smoothingGroups = faces.getUint32(idx + 0x34, true);

            const vertnormBase = vertnormalIdx;
            vertnormalIdx += numedges;

            const tex = this.texinfo[texinfo];
            if (!!(tex.flags & TexinfoFlags.NODRAW)) {
                continue;
            }

            // surface lighting info
            const mins = m_LightmapTextureMinsInLuxels;
            const width = m_LightmapTextureSizeInLuxels[0] + 1, height = m_LightmapTextureSizeInLuxels[1] + 1;

            const hasBumpmapSamples = !!(tex.flags & TexinfoFlags.BUMPLIGHT);
            const numlightmaps = hasBumpmapSamples ? 4 : 1;
            const lightmapSize = styles.length * numlightmaps * (width * height * 4);
            let samples: Uint8Array | null = null;
            if (lightofs !== -1)
                samples = lighting.subarray(lightofs, lightmapSize).createTypedArray(Uint8Array);
            const surfaceLighting: SurfaceLighting = { mins, width, height, styles, lightmapSize, samples, hasBumpmapSamples };

            // Tangent space setup.
            const planeX = planes.getFloat32(planenum * 0x14 + 0x00, true);
            const planeY = planes.getFloat32(planenum * 0x14 + 0x04, true);
            const planeZ = planes.getFloat32(planenum * 0x14 + 0x08, true);
            vec3.set(scratchPosition, planeX, planeY, planeZ);

            vec3.set(scratchTangentS, tex.textureMapping.s[0], tex.textureMapping.s[1], tex.textureMapping.s[2]);
            vec3.normalize(scratchTangentS, scratchTangentS);
            vec3.set(scratchTangentT, tex.textureMapping.t[0], tex.textureMapping.t[1], tex.textureMapping.t[2]);
            vec3.normalize(scratchTangentT, scratchTangentT);
            vec3.cross(scratchNormal, scratchTangentS, scratchTangentT);
            // Detect if we need to flip tangents.
            const tangentSSign = vec3.dot(scratchPosition, scratchNormal) > 0.0 ? -1.0 : 1.0;

            const center = vec3.create();

            for (let j = 0; j < numedges; j++) {
                const idx = firstedge + j;

                // Position
                const vertIndex = vertindices[idx];
                vertexData[dstOffs++] = scratchPosition[0] = vertexes[vertIndex * 3 + 0];
                vertexData[dstOffs++] = scratchPosition[1] = vertexes[vertIndex * 3 + 1];
                vertexData[dstOffs++] = scratchPosition[2] = vertexes[vertIndex * 3 + 2];
                vec3.scaleAndAdd(center, center, scratchPosition, 1/numedges);

                // Normal
                const normIndex = vertnormalindices[vertnormBase + j];
                vertexData[dstOffs++] = scratchNormal[0] = vertnormals[normIndex * 3 + 0];
                vertexData[dstOffs++] = scratchNormal[1] = vertnormals[normIndex * 3 + 1];
                vertexData[dstOffs++] = scratchNormal[2] = vertnormals[normIndex * 3 + 2];

                // Compute Tangent S vector
                // Tangent S = Normal x Texture T Mapping
                vec3.cross(scratchTangentS, scratchNormal, scratchTangentT);
                vertexData[dstOffs++] = scratchTangentS[0];
                vertexData[dstOffs++] = scratchTangentS[1];
                vertexData[dstOffs++] = scratchTangentS[2];
                vertexData[dstOffs++] = tangentSSign;
                // Tangent T = Tangent S x Normal. Done in shader.

                // Texture UV
                calcTexCoord(scratchVec2, scratchPosition, tex.textureMapping);
                scratchVec2[0] /= tex.width;
                scratchVec2[1] /= tex.height;
                vertexData[dstOffs++] = scratchVec2[0];
                vertexData[dstOffs++] = scratchVec2[1];

                // Lightmap UV
                if (tex.flags & TexinfoFlags.NOLIGHT) {
                    vec2.set(scratchVec2, 0.5, 0.5);
                } else {
                    calcTexCoord(scratchVec2, scratchPosition, tex.lightmapMapping);
                    scratchVec2[0] += 0.5 - m_LightmapTextureMinsInLuxels[0];
                    scratchVec2[1] += 0.5 - m_LightmapTextureMinsInLuxels[1];

                    // TODO(jstpierre): Context scale?
                }

                vertexData[dstOffs++] = scratchVec2[0];
                vertexData[dstOffs++] = scratchVec2[1];
            }

            const count = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRIFAN, numedges);
            if (m_NumPrims !== 0) {
                const primOffs = firstPrimID * 0x0A;
                const primType = primitives.getUint8(primOffs + 0x00);
                const primFirstIndex = primitives.getUint16(primOffs + 0x02, true);
                const primIndexCount = primitives.getUint16(primOffs + 0x04, true);
                const primFirstVert = primitives.getUint16(primOffs + 0x06, true);
                const primVertCount = primitives.getUint16(primOffs + 0x08, true);
                if (primVertCount !== 0) {
                    // Dynamic mesh. Skip for now.
                    continue;
                }

                // We should be in static mode, so we should have 1 prim maximum.
                assert(m_NumPrims === 1);
                assert(primIndexCount === count);
                assert(primType === 0x00 /* PRIM_TRILIST */);

                for (let k = 0; k < count; k++)
                    indexData[dstOffsIndex + k] = dstIndexBase + primindices[primFirstIndex + k];
            } else {
                convertToTrianglesRange(indexData, dstOffsIndex, GfxTopology.TRIFAN, dstIndexBase, numedges);
            }

            this.surfaces.push({ texinfo, startIndex: dstOffsIndex, indexCount: count, center, lighting: surfaceLighting });
            dstOffsIndex += count;
            dstIndexBase += numedges;
        }

        this.vertexData = vertexData;
        this.indexData = indexData;

        // Parse out BSP tree.
        const nodes = getLumpData(LumpType.NODES).createDataView();

        for (let idx = 0x00; idx < nodes.byteLength; idx += 0x20) {
            const planenum = nodes.getUint32(idx + 0x00, true);

            // Read plane.
            const planeX = planes.getFloat32(planenum * 0x14 + 0x00, true);
            const planeY = planes.getFloat32(planenum * 0x14 + 0x04, true);
            const planeZ = planes.getFloat32(planenum * 0x14 + 0x08, true);
            const planeDist = planes.getFloat32(planenum * 0x14 + 0x0C, true);

            const plane = new Plane(planeX, planeY, planeZ, planeDist);

            const child0 = nodes.getInt32(idx + 0x04, true);
            const child1 = nodes.getInt32(idx + 0x08, true);
            const bboxMinX = nodes.getInt16(idx + 0x0C, true);
            const bboxMinY = nodes.getInt16(idx + 0x0E, true);
            const bboxMinZ = nodes.getInt16(idx + 0x10, true);
            const bboxMaxX = nodes.getInt16(idx + 0x12, true);
            const bboxMaxY = nodes.getInt16(idx + 0x14, true);
            const bboxMaxZ = nodes.getInt16(idx + 0x16, true);
            const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
            const firstface = nodes.getUint16(idx + 0x18, true);
            const numfaces = nodes.getUint16(idx + 0x1A, true);
            const area = nodes.getInt16(idx + 0x1C, true);
            this.nodelist.push({ plane, child0, child1, bbox, area, surfaceStart: firstface, surfaceCount: numfaces });
        }

        const [leafsLump, leafsVersion] = getLumpDataEx(LumpType.LEAFS);
        const leafs = leafsLump.createDataView();

        this.leaffacelist = getLumpData(LumpType.LEAFFACES).createTypedArray(Uint16Array);
        for (let idx = 0x00; idx < leafs.byteLength; idx += 0x20) {
            const contents = leafs.getUint32(idx + 0x00, true);
            const cluster = leafs.getUint16(idx + 0x04, true);
            const areaAndFlags = leafs.getUint16(idx + 0x06, true);
            const bboxMinX = leafs.getInt16(idx + 0x08, true);
            const bboxMinY = leafs.getInt16(idx + 0x0A, true);
            const bboxMinZ = leafs.getInt16(idx + 0x0C, true);
            const bboxMaxX = leafs.getInt16(idx + 0x0E, true);
            const bboxMaxY = leafs.getInt16(idx + 0x10, true);
            const bboxMaxZ = leafs.getInt16(idx + 0x12, true);
            const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
            const firstleafface = leafs.getUint16(idx + 0x14, true);
            const numleaffaces = leafs.getUint16(idx + 0x16, true);
            const firstleafbrush = leafs.getUint16(idx + 0x18, true);
            const numleafbrushes = leafs.getUint16(idx + 0x1A, true);
            const leafwaterdata = leafs.getInt16(idx + 0x1C, true);

            // AmbientLighting info in version 0 is here.
            if (leafsVersion === 0) {
                idx += 0x18;
            }

            this.leaflist.push({ bbox, leaffaceStart: firstleafface, leaffaceCount: numleaffaces });
        }

        const models = getLumpData(LumpType.MODELS).createDataView();
        for (let idx = 0x00; idx < models.byteLength; idx += 0x30) {
            const minX = models.getFloat32(idx + 0x00, true);
            const minY = models.getFloat32(idx + 0x04, true);
            const minZ = models.getFloat32(idx + 0x08, true);
            const maxX = models.getFloat32(idx + 0x0C, true);
            const maxY = models.getFloat32(idx + 0x10, true);
            const maxZ = models.getFloat32(idx + 0x14, true);
            const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

            const originX = models.getFloat32(idx + 0x18, true);
            const originY = models.getFloat32(idx + 0x1C, true);
            const originZ = models.getFloat32(idx + 0x20, true);

            const headnode = models.getUint32(idx + 0x24, true);
            const firstface = models.getUint32(idx + 0x28, true);
            const numfaces = models.getUint32(idx + 0x2C, true);

            this.models.push({ bbox, headnode, surfaceStart: firstface, surfaceCount: numfaces });
        }
    }
}
