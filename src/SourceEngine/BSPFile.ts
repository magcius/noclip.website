
// Source Engine BSP.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assertExists, assert, nArray } from "../util";
import { vec4, vec3, vec2 } from "gl-matrix";
import { getTriangleIndexCountForTopologyIndexCount, GfxTopology, convertToTrianglesRange } from "../gfx/helpers/TopologyHelpers";
import { parseZipFile, ZipFile } from "../ZipFile";
import { parseEntitiesLump, BSPEntity } from "./VMT";
import { Plane, AABB } from "../Geometry";
import { deserializeGameLump_dprp, DetailObjects, deserializeGameLump_sprp, StaticObjects } from "./StaticDetailObject";
import BitMap from "../BitMap";

const enum LumpType {
    ENTITIES             = 0,
    PLANES               = 1,
    TEXDATA              = 2,
    VERTEXES             = 3,
    VISIBILITY           = 4,
    NODES                = 5,
    TEXINFO              = 6,
    FACES                = 7,
    LIGHTING             = 8,
    LEAFS                = 10,
    EDGES                = 12,
    SURFEDGES            = 13,
    MODELS               = 14,
    LEAFFACES            = 16,
    DISPINFO             = 26,
    VERTNORMALS          = 30,
    VERTNORMALINDICES    = 31,
    DISP_VERTS           = 33,
    GAME_LUMP            = 35,
    PRIMITIVES           = 37,
    PRIMINDICES          = 39,
    PAKFILE              = 40,
    CUBEMAPS             = 42,
    TEXDATA_STRING_DATA  = 43,
    TEXDATA_STRING_TABLE = 44,
    OVERLAYS             = 45,
    LIGHTING_HDR         = 53,
    FACES_HDR            = 58,
}

export interface SurfaceLighting {
    width: number;
    height: number;
    styles: number[];
    lightmapSize: number;
    samples: Uint8Array | null;
    hasBumpmapSamples: boolean;
    // Dynamic allocation
    pageWidth: number;
    pageHeight: number;
    pageIndex: number;
    pagePosX: number;
    pagePosY: number;
    lightmapDirty: boolean;
}

export interface Surface {
    texinfo: number;
    startIndex: number;
    indexCount: number;
    center: vec3;
    lighting: SurfaceLighting;

    // displacement info
    isDisplacement: boolean;
    bbox: AABB | null;
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
    area: number;
    cluster: number;
    leaffaceStart: number;
    leaffaceCount: number;
}

export interface Model {
    bbox: AABB;
    headnode: number;
    surfaceStart: number;
    surfaceCount: number;
}

interface BSPDispInfo {
    startPos: vec3;
    power: number;
    dispVertStart: number;
    sideLength: number;
    vertexCount: number;
}

class DisplacementMeshVertex {
    public position = vec3.create();
    public normal = vec3.create();
    public alpha = 1.0;
    public uv = vec3.create();
}

class DisplacementBuilder {
    public vertex: DisplacementMeshVertex[];
    public aabb = new AABB();

    constructor(public disp: BSPDispInfo, public corners: vec3[], public disp_verts: Float32Array) {
        this.vertex = nArray(disp.vertexCount, () => new DisplacementMeshVertex());

        const v0 = vec3.create(), v1 = vec3.create();

        // Positions
        for (let y = 0; y < disp.sideLength; y++) {
            const ty = y / (disp.sideLength - 1);
            vec3.lerp(v0, corners[0], corners[1], ty);
            vec3.lerp(v1, corners[3], corners[2], ty);

            for (let x = 0; x < disp.sideLength; x++) {
                const tx = x / (disp.sideLength - 1);

                // Displacement normal vertex.
                const dvidx = disp.dispVertStart + (y * disp.sideLength) + x;
                const dvx = disp_verts[dvidx * 5 + 0];
                const dvy = disp_verts[dvidx * 5 + 1];
                const dvz = disp_verts[dvidx * 5 + 2];
                const dvdist = disp_verts[dvidx * 5 + 3];
                const dvalpha = disp_verts[dvidx * 5 + 4];

                const vertex = this.vertex[y * disp.sideLength + x];
                vec3.lerp(vertex.position, v0, v1, tx);

                vertex.position[0] += (dvx * dvdist);
                vertex.position[1] += (dvy * dvdist);
                vertex.position[2] += (dvz * dvdist);
                vertex.uv[0] = tx;
                vertex.uv[1] = ty;
                vertex.alpha = dvalpha / 0xFF;
                this.aabb.unionPoint(vertex.position);
            }
        }

        // Normals
        const w = disp.sideLength;
        for (let y = 0; y < w; y++) {
            for (let x = 0; x < w; x++) {
                const vertex = this.vertex[y * w + x];
                const x0 = x - 1, x1 = x, x2 = x + 1;
                const y0 = y - 1, y1 = y, y2 = y + 1;

                let count = 0;

                // Top left
                if (x0 >= 0 && y0 >= 0) {
                    vec3.sub(v0, this.vertex[y1*w+x0].position, this.vertex[y0*w+x0].position);
                    vec3.sub(v1, this.vertex[y0*w+x1].position, this.vertex[y0*w+x0].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    vec3.sub(v0, this.vertex[y1*w+x0].position, this.vertex[y0*w+x1].position);
                    vec3.sub(v1, this.vertex[y1*w+x1].position, this.vertex[y0*w+x1].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    count += 2;
                }

                // Top right
                if (x2 < w && y0 >= 0) {
                    vec3.sub(v0, this.vertex[y1*w+x1].position, this.vertex[y0*w+x1].position);
                    vec3.sub(v1, this.vertex[y0*w+x2].position, this.vertex[y0*w+x1].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    vec3.sub(v0, this.vertex[y1*w+x1].position, this.vertex[y0*w+x2].position);
                    vec3.sub(v1, this.vertex[y1*w+x2].position, this.vertex[y0*w+x2].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    count += 2;
                }

                // Bottom left
                if (x0 >= 0 && y2 < w) {
                    vec3.sub(v0, this.vertex[y2*w+x0].position, this.vertex[y1*w+x0].position);
                    vec3.sub(v1, this.vertex[y1*w+x1].position, this.vertex[y1*w+x0].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    vec3.sub(v0, this.vertex[y2*w+x0].position, this.vertex[y1*w+x1].position);
                    vec3.sub(v1, this.vertex[y2*w+x1].position, this.vertex[y1*w+x1].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    count += 2;
                }

                // Bottom right
                if (x2 < w && y2 < w) {
                    vec3.sub(v0, this.vertex[y2*w+x1].position, this.vertex[y1*w+x1].position);
                    vec3.sub(v1, this.vertex[y1*w+x2].position, this.vertex[y1*w+x1].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    vec3.sub(v0, this.vertex[y2*w+x1].position, this.vertex[y1*w+x2].position);
                    vec3.sub(v1, this.vertex[y2*w+x2].position, this.vertex[y1*w+x2].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    count += 2;
                }

                vec3.scale(vertex.normal, vertex.normal, 1 / count);
            }
        }
    }
}

function magicint(S: string): number {
    const n0 = S.charCodeAt(0);
    const n1 = S.charCodeAt(1);
    const n2 = S.charCodeAt(2);
    const n3 = S.charCodeAt(3);
    return (n0 << 24) | (n1 << 16) | (n2 << 8) | n3;
}

class BSPVisibility {
    public pvs: BitMap[];
    public numclusters: number;

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        this.numclusters = view.getUint32(0x00, true);
        this.pvs = nArray(this.numclusters, () => new BitMap(this.numclusters));

        for (let i = 0; i < this.numclusters; i++) {
            const pvsofs = view.getUint32(0x04 + i * 0x08 + 0x00, true);
            const pasofs = view.getUint32(0x04 + i * 0x08 + 0x04, true);
            this.decodeClusterTable(this.pvs[i], view, pvsofs);
        }
    }

    private decodeClusterTable(dst: BitMap, view: DataView, offs: number): void {
        if (offs === 0x00) {
            // No visibility info; mark everything visible.
            dst.fill(true);
            return;
        }

        // Initialize with all 0s.
        dst.fill(false);

        let clusteridx = 0;
        while (clusteridx < this.numclusters) {
            const b = view.getUint8(offs++);

            if (b) {
                // Transfer to bitmap. Need to reverse bits (unfortunately).
                for (let i = 0; i < 8; i++)
                    dst.setBit(clusteridx++, !!(b & (1 << i)));
            } else {
                // RLE.
                const c = view.getUint8(offs++);
                clusteridx += c * 8;
            }
        }
    }
}

export class LightmapPackerPage {
    public skyline: Uint16Array;

    constructor(public width: number, public height: number) {
        // Initialize our skyline. Note that our skyline goes horizontal, not vertical.
        assert(this.width <= 0xFFFF);
        this.skyline = new Uint16Array(this.height);
    }

    public allocate(allocation: SurfaceLighting): boolean {
        const w = allocation.width, h = allocation.height;

        // March downwards until we find a span of skyline that will fit.
        let bestY = -1, minX = this.width;
        for (let y = 0; y < this.height - h;) {
            const searchY = this.searchSkyline(y, h);
            if (this.skyline[searchY] < minX) {
                minX = this.skyline[searchY];
                bestY = y;
            }
            y = searchY + 1;
        }

        if (bestY < 0) {
            // Could not pack.
            return false;
        }

        // Found a position!
        allocation.pagePosX = minX;
        allocation.pagePosY = bestY;
        allocation.pageWidth = this.width;
        allocation.pageHeight = this.height;
        // pageIndex filled in by caller.

        // Update our skyline.
        for (let y = bestY; y < bestY + h; y++)
            this.skyline[y] = minX + w;

        return true;
    }

    private searchSkyline(startY: number, h: number): number {
        let winnerY = -1, maxX = -1;
        for (let y = startY; y < startY + h; y++) {
            if (this.skyline[y] >= maxX) {
                winnerY = y;
                maxX = this.skyline[y];
            }
        }
        return winnerY;
    }
}

export class LightmapPackerManager {
    public pages: LightmapPackerPage[] = [];

    constructor(public pageWidth: number = 2048, public pageHeight: number = 2048) {
    }

    public allocate(allocation: SurfaceLighting): void {
        for (let i = 0; i < this.pages.length; i++) {
            if (this.pages[i].allocate(allocation)) {
                allocation.pageIndex = i;
                return;
            }
        }

        // Make a new page.
        const page = new LightmapPackerPage(this.pageWidth, this.pageHeight);
        this.pages.push(page);
        assert(page.allocate(allocation));
        allocation.pageIndex = this.pages.length - 1;
    }
}

const scratchVec3 = vec3.create();
export class BSPFile {
    public version: number;

    public entities: BSPEntity[] = [];
    public texinfo: Texinfo[] = [];
    public surfaces: Surface[] = [];
    public models: Model[] = [];
    public pakfile: ZipFile | null = null;
    public nodelist: BSPNode[] = [];
    public leaflist: BSPLeaf[] = [];
    public cubemaps: string[] = [];
    public leaffacelist: Uint16Array;
    public detailObjects: DetailObjects | null = null;
    public staticObjects: StaticObjects | null = null;
    public visibility: BSPVisibility;
    public lightmapPackerManager = new LightmapPackerManager();

    public indexData: Uint16Array;
    public vertexData: Float32Array;

    constructor(buffer: ArrayBufferSlice, mapname: string) {
        assertExists(readString(buffer, 0x00, 0x04) === 'VBSP');
        const view = buffer.createDataView();
        this.version = view.getUint32(0x04, true);
        assert(this.version === 0x13 || this.version === 0x14);

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

        const game_lump = getLumpData(LumpType.GAME_LUMP).createDataView();
        function getGameLumpData(magic: string): [ArrayBufferSlice, number] | null {
            const lumpCount = game_lump.getUint32(0x00, true);
            const needle = magicint(magic);
            let idx = 0x04;
            for (let i = 0; i < lumpCount; i++) {
                const lumpmagic = game_lump.getUint32(idx + 0x00, true);
                if (lumpmagic === needle) {
                    const flags = game_lump.getUint16(idx + 0x04, true);
                    const version = game_lump.getUint16(idx + 0x06, true);
                    const fileofs = game_lump.getUint32(idx + 0x08, true);
                    const filelen = game_lump.getUint32(idx + 0x0C, true);
                    assert(flags === 0);
                    const lump = buffer.subarray(fileofs, filelen);
                    return [lump, version];
                }
                idx += 0x10;
            }
            return null;
        }

        // Parse out visibility.
        this.visibility = new BSPVisibility(getLumpData(LumpType.VISIBILITY));

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

        const dispinfo = getLumpData(LumpType.DISPINFO).createDataView();
        const dispinfolist: BSPDispInfo[] = [];
        for (let idx = 0x00; idx < dispinfo.byteLength; idx += 0xB0) {
            const startPosX = dispinfo.getFloat32(idx + 0x00, true);
            const startPosY = dispinfo.getFloat32(idx + 0x04, true);
            const startPosZ = dispinfo.getFloat32(idx + 0x08, true);
            const startPos = vec3.fromValues(startPosX, startPosY, startPosZ);

            const m_iDispVertStart = dispinfo.getUint32(idx + 0x0C, true);
            const m_iDispTriStart = dispinfo.getUint32(idx + 0x10, true);
            const power = dispinfo.getUint32(idx + 0x14, true);
            const minTess = dispinfo.getUint32(idx + 0x18, true);
            const smoothingAngle = dispinfo.getFloat32(idx + 0x1C, true);
            const contents = dispinfo.getUint32(idx + 0x20, true);
            const mapFace = dispinfo.getUint16(idx + 0x24, true);
            const m_iLightmapAlphaStart = dispinfo.getUint32(idx + 0x26, true);
            const m_iLightmapSamplePositionStart = dispinfo.getUint32(idx + 0x2A, true);

            // neighbor rules
            // allowed verts

            // compute for easy access
            const sideLength = (1 << power) + 1;
            const vertexCount = sideLength * sideLength;

            dispinfolist.push({ startPos, dispVertStart: m_iDispVertStart, power, sideLength, vertexCount });
        }

        const faceCount = faces.byteLength / 0x38;
        const primindices = getLumpData(LumpType.PRIMINDICES).createTypedArray(Uint16Array);
        const primitives = getLumpData(LumpType.PRIMITIVES).createDataView();

        // Count up the number of vertices we need.
        let vertCount = 0;
        let indexCount = 0;
        for (let i = 0; i < faceCount; i++) {
            const idx = i * 0x38;
            const numedges = faces.getUint16(idx + 0x08, true);
            const dispinfo = faces.getInt16(idx + 0x0C, true);

            if (dispinfo >= 0) {
                const disp = dispinfolist[dispinfo];
                vertCount += disp.vertexCount;

                indexCount += ((disp.sideLength - 1) ** 2) * 6;
            } else {
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
        }

        // 3 pos, 4 normal, 4 tangent, 4 uv
        const vertexSize = (3+4+4+4);
        const vertexData = new Float32Array(vertCount * vertexSize);
        assert(vertCount < 0xFFFF);
        const indexData = new Uint16Array(indexCount);

        const planes = getLumpData(LumpType.PLANES).createDataView();
        const vertexes = getLumpData(LumpType.VERTEXES).createTypedArray(Float32Array);
        const vertnormals = getLumpData(LumpType.VERTNORMALS).createTypedArray(Float32Array);
        const vertnormalindices = getLumpData(LumpType.VERTNORMALINDICES).createTypedArray(Uint16Array);
        const disp_verts = getLumpData(LumpType.DISP_VERTS).createTypedArray(Float32Array);

        let lighting = getLumpData(LumpType.LIGHTING_HDR, 1);
        if (lighting.byteLength === 0)
            lighting = getLumpData(LumpType.LIGHTING, 1);

        const scratchVec2 = vec2.create();
        const scratchPosition = vec3.create();
        const scratchNormal = vec3.create();
        const scratchTangentT = vec3.create();
        const scratchTangentS = vec3.create();

        // now build buffers
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
            const mapWidth = m_LightmapTextureSizeInLuxels[0] + 1, mapHeight = m_LightmapTextureSizeInLuxels[1] + 1;
            const hasBumpmapSamples = !!(tex.flags & TexinfoFlags.BUMPLIGHT);
            const numlightmaps = hasBumpmapSamples ? 4 : 1;
            const width = mapWidth, height = mapHeight * numlightmaps;
            const lightmapSize = styles.length * (width * height * 4);

            let samples: Uint8Array | null = null;
            if (lightofs !== -1)
                samples = lighting.subarray(lightofs, lightmapSize).createTypedArray(Uint8Array);

            const surfaceLighting: SurfaceLighting = {
                width, height, styles, lightmapSize, samples, hasBumpmapSamples,
                pageWidth: -1, pageHeight: -1, pageIndex: -1, pagePosX: -1, pagePosY: -1, lightmapDirty: true,
            };

            // Allocate ourselves a page.
            this.lightmapPackerManager.allocate(surfaceLighting);

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

            // vertex data
            if (dispinfo >= 0) {
                // Build displacement data.
                const disp = dispinfolist[dispinfo];

                assert(numedges === 4);

                // Load the four corner vertices.
                let corners: vec3[] = [];
                let startIndex = -1;
                for (let j = 0; j < 4; j++) {
                    const vertIndex = vertindices[firstedge + j];
                    const corner = vec3.fromValues(vertexes[vertIndex * 3 + 0], vertexes[vertIndex * 3 + 1], vertexes[vertIndex * 3 + 2]);
                    corners.push(corner);
                    if (vec3.dist(corner, disp.startPos) < 1.0)
                        startIndex = j;
                }
                assert(startIndex >= 0);

                // Rotate vectors so start pos corner is first
                if (startIndex !== 0)
                    corners = corners.slice(startIndex).concat(corners.slice(0, startIndex));

                const builder = new DisplacementBuilder(disp, corners, disp_verts);
                for (let y = 0; y < disp.sideLength; y++) {
                    for (let x = 0; x < disp.sideLength; x++) {
                        const vertex = builder.vertex[y * disp.sideLength + x];

                        // Position
                        vertexData[dstOffs++] = vertex.position[0];
                        vertexData[dstOffs++] = vertex.position[1];
                        vertexData[dstOffs++] = vertex.position[2];

                        // Normal
                        vertexData[dstOffs++] = scratchNormal[0] = vertex.normal[0];
                        vertexData[dstOffs++] = scratchNormal[1] = vertex.normal[1];
                        vertexData[dstOffs++] = scratchNormal[2] = vertex.normal[2];
                        vertexData[dstOffs++] = vertex.alpha;

                        // Tangent
                        vec3.cross(scratchTangentS, scratchNormal, scratchTangentT);
                        vertexData[dstOffs++] = scratchTangentS[0];
                        vertexData[dstOffs++] = scratchTangentS[1];
                        vertexData[dstOffs++] = scratchTangentS[2];
                        vertexData[dstOffs++] = tangentSSign;

                        // Texture UV
                        calcTexCoord(scratchVec2, vertex.position, tex.textureMapping);
                        scratchVec2[0] /= tex.width;
                        scratchVec2[1] /= tex.height;
                        vertexData[dstOffs++] = scratchVec2[0];
                        vertexData[dstOffs++] = scratchVec2[1];

                        // Lightmap UV
                        // Source seems to just have lightmaps in surface space, and ignore the mapping. (!!!)
                        vertexData[dstOffs++] = (vertex.uv[0] * m_LightmapTextureSizeInLuxels[0]) + 0.5;
                        vertexData[dstOffs++] = (vertex.uv[1] * m_LightmapTextureSizeInLuxels[1]) + 0.5;
                    }
                }

                // Build grid index buffer.
                let m = 0;
                for (let y = 0; y < disp.sideLength - 1; y++) {
                    for (let x = 0; x < disp.sideLength - 1; x++) {
                        const base = dstIndexBase + y * disp.sideLength + x;
                        indexData[dstOffsIndex + m++] = base;
                        indexData[dstOffsIndex + m++] = base + disp.sideLength;
                        indexData[dstOffsIndex + m++] = base + disp.sideLength + 1;
                        indexData[dstOffsIndex + m++] = base;
                        indexData[dstOffsIndex + m++] = base + disp.sideLength + 1;
                        indexData[dstOffsIndex + m++] = base + 1;
                    }
                }

                assert(m === ((disp.sideLength - 1) ** 2) * 6);
                this.surfaces.push({ texinfo, startIndex: dstOffsIndex, indexCount: m, center, lighting: surfaceLighting, isDisplacement: true, bbox: builder.aabb });
                dstOffsIndex += m;
                dstIndexBase += disp.vertexCount;
            } else {
                for (let j = 0; j < numedges; j++) {
                    // Position
                    const vertIndex = vertindices[firstedge + j];
                    vertexData[dstOffs++] = scratchPosition[0] = vertexes[vertIndex * 3 + 0];
                    vertexData[dstOffs++] = scratchPosition[1] = vertexes[vertIndex * 3 + 1];
                    vertexData[dstOffs++] = scratchPosition[2] = vertexes[vertIndex * 3 + 2];
                    vec3.scaleAndAdd(center, center, scratchPosition, 1/numedges);

                    // Normal
                    const normIndex = vertnormalindices[vertnormBase + j];
                    vertexData[dstOffs++] = scratchNormal[0] = vertnormals[normIndex * 3 + 0];
                    vertexData[dstOffs++] = scratchNormal[1] = vertnormals[normIndex * 3 + 1];
                    vertexData[dstOffs++] = scratchNormal[2] = vertnormals[normIndex * 3 + 2];
                    vertexData[dstOffs++] = 1.0; // Vertex Alpha (Unused)

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

                        // Place into page.
                        scratchVec2[0] = (scratchVec2[0] + surfaceLighting.pagePosX) / surfaceLighting.pageWidth;
                        scratchVec2[1] = (scratchVec2[1] + surfaceLighting.pagePosY) / surfaceLighting.pageHeight;
                    }

                    vertexData[dstOffs++] = scratchVec2[0];
                    vertexData[dstOffs++] = scratchVec2[1];
                }

                // index buffer
                const indexCount = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRIFAN, numedges);
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
                    assert(primIndexCount === indexCount);
                    assert(primType === 0x00 /* PRIM_TRILIST */);

                    for (let k = 0; k < indexCount; k++)
                        indexData[dstOffsIndex + k] = dstIndexBase + primindices[primFirstIndex + k];
                } else {
                    convertToTrianglesRange(indexData, dstOffsIndex, GfxTopology.TRIFAN, dstIndexBase, numedges);
                }

                this.surfaces.push({ texinfo, startIndex: dstOffsIndex, indexCount: indexCount, center, lighting: surfaceLighting, isDisplacement: false, bbox: null });
                dstOffsIndex += indexCount;
                dstIndexBase += numedges;
            }
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

            const plane = new Plane(planeX, planeY, planeZ, -planeDist);

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
            const area = areaAndFlags & 0x01FF;
            const flags = (areaAndFlags >>> 9) & 0x007F;
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

            this.leaflist.push({ bbox, cluster, area, leaffaceStart: firstleafface, leaffaceCount: numleaffaces });
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

        const cubemaps = getLumpData(LumpType.CUBEMAPS).createDataView();
        for (let idx = 0x00; idx < cubemaps.byteLength; idx += 0x10) {
            const posX = cubemaps.getInt32(idx + 0x00, true);
            const posY = cubemaps.getInt32(idx + 0x04, true);
            const posZ = cubemaps.getInt32(idx + 0x08, true);
            const cubemapSample = `maps/${mapname}/c${posX}_${posY}_${posZ}`;
            this.cubemaps.push(cubemapSample);
        }

        const dprp = getGameLumpData('dprp');
        if (dprp !== null)
            this.detailObjects = deserializeGameLump_dprp(dprp[0], dprp[1]);

        const sprp = getGameLumpData('sprp');
        if (sprp !== null)
            this.staticObjects = deserializeGameLump_sprp(sprp[0], sprp[1]);
    }

    public findLeafForPoint(p: vec3, nodeid: number = 0): number {
        if (nodeid < 0) {
            return -nodeid - 1;
        } else {
            const node = this.nodelist[nodeid];
            const dot = node.plane.distance(p[0], p[1], p[2]);
            return this.findLeafForPoint(p, dot >= 0.0 ? node.child0 : node.child1);
        }
    }

    public markClusterSet(dst: number[], aabb: AABB, nodeid: number = 0): void {
        if (nodeid < 0) {
            const leaf = this.leaflist[-nodeid - 1];
            if (leaf.cluster !== 0xFFFF && !dst.includes(leaf.cluster))
                dst.push(leaf.cluster);
        } else {
            const node = this.nodelist[nodeid];
            let signs = 0;
            for (let i = 0; i < 8; i++) {
                aabb.cornerPoint(scratchVec3, i);
                const dot = node.plane.distance(scratchVec3[0], scratchVec3[1], scratchVec3[2]);
                signs |= (dot >= 0 ? 1 : 2);
            }

            if (!!(signs & 1))
                this.markClusterSet(dst, aabb, node.child0);
            if (!!(signs & 2))
                this.markClusterSet(dst, aabb, node.child1);
        }
    }
}
