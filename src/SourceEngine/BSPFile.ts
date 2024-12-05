
// Source Engine BSP.

import { ReadonlyMat4, ReadonlyVec2, ReadonlyVec3, ReadonlyVec4, vec2, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import BitMap from "../BitMap.js";
import { IS_DEVELOPMENT } from "../BuildVersion.js";
import { Color, colorNewFromRGBA } from "../Color.js";
import { decodeLZMAProperties, decompress } from '../Common/Compression/LZMA.js';
import { AABB, Plane } from "../Geometry.js";
import { convertToTrianglesRange, getTriangleIndexCountForTopologyIndexCount, GfxTopology } from "../gfx/helpers/TopologyHelpers.js";
import { lerp, MathConstants, normToLength, saturate, vec3FromBasis2, Vec3NegZ, vec3SetAll, Vec3UnitX } from "../MathHelpers.js";
import { assert, decodeString, ensureInList, nArray, readString } from "../util.js";
import { parseZipFile, ZipFile } from "../ZipFile.js";
import { unpackColorRGBExp32 } from "./Materials/Lightmap.js";
import { deserializeGameLump_dprp, deserializeGameLump_sprp, DetailObjects, StaticObjects } from "./StaticDetailObject.js";
import { pairs2obj, ValveKeyValueParser, VKFPair } from "./VMT.js";
import { drawWorldSpaceLine, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { SourceRenderer } from "./Main.js";

//#region Data Structures
export interface FaceLightmapData {
    faceIndex: number;
    // Size of a single lightmap.
    width: number;
    height: number;
    styles: number[];
    samples: Uint8Array | null;
    hasBumpmapSamples: boolean;
    // Dynamic allocation
    pageIndex: number;
    pagePosX: number;
    pagePosY: number;
}

export interface BSPOverlay {
    surfaceIndexes: number[];
}

export interface BSPSurface {
    texName: string;
    startIndex: number;
    indexCount: number;
    center: vec3 | null;

    // Whether we want TexCoord0 to be divided by the texture size. Needed for most BSP surfaces
    // using Texinfo mapping, but *not* wanted for Overlay surfaces. This might get rearranged if
    // we move overlays out of being BSP surfaces...
    wantsTexCoord0Scale: boolean;

    // Since our surfaces are merged together from multiple BSP surfaces, we can have multiple
    // surface lightmaps, but they're guaranteed to have been packed into the same lightmap page.
    lightmapPackerPageIndex: number;

    faceList: number[];

    bbox: AABB;
}

const enum TexinfoFlags {
    SKY2D     = 0x0002,
    SKY       = 0x0004,
    TRANS     = 0x0010,
    NODRAW    = 0x0080,
    NOLIGHT   = 0x0400,
    BUMPLIGHT = 0x0800,
    NODECALS  = 0x2000,
}

interface Texinfo {
    textureMapping: TexinfoMapping;
    lightmapMapping: TexinfoMapping;
    flags: TexinfoFlags;

    // texdata
    texName: string;
}

interface TexinfoMapping {
    // 2x4 matrix for texture coordinates
    s: ReadonlyVec4;
    t: ReadonlyVec4;
}

export interface BSPNode {
    plane: Plane;
    child0: number;
    child1: number;
    bbox: AABB;
    area: number;
}

export type AmbientCube = Color[];

export interface BSPLeafAmbientSample {
    ambientCube: AmbientCube;
    pos: vec3;
}

const enum BSPLeafContents {
    Solid     = 0x001,
    Water     = 0x010,
    TestWater = 0x100,
}

export interface BSPLeaf {
    bbox: AABB;
    area: number;
    cluster: number;
    ambientLightSamples: BSPLeafAmbientSample[];
    faces: number[];
    leafwaterdata: number;
    contents: BSPLeafContents;
}

interface BSPLeafWaterData {
    surfaceZ: number;
    minZ: number;
    surfaceMaterialName: string;
}

export interface Model {
    bbox: AABB;
    headnode: number;
    surfaces: number[];
}

export const enum WorldLightType {
    Surface,
    Point,
    Spotlight,
    SkyLight,
    QuakeLight,
    SkyAmbient,
}

export const enum WorldLightFlags {
    InAmbientCube = 0x01,
}

export interface WorldLight {
    pos: vec3;
    intensity: vec3;
    normal: vec3;
    type: WorldLightType;
    radius: number;
    distAttenuation: vec3;
    exponent: number;
    stopdot: number;
    stopdot2: number;
    style: number;
    flags: WorldLightFlags;
}

export interface Cubemap {
    pos: vec3;
    filename: string;
}

//#endregion

//#region Vertex Data

// 3 pos, 4 normal, 4 tangent, 4 uv
const VERTEX_SIZE = (3+4+4+4);

class MeshVertex {
    public position = vec3.create();
    public normal = vec3.create();
    public alpha = 1.0;
    public uv = vec2.create();
    public lightmapUV = vec2.create();
}

function calcTexCoord(dst: vec2, v: ReadonlyVec3, m: TexinfoMapping): void {
    dst[0] = v[0]*m.s[0] + v[1]*m.s[1] + v[2]*m.s[2] + m.s[3];
    dst[1] = v[0]*m.t[0] + v[1]*m.t[1] + v[2]*m.t[2] + m.t[3];
}

function packVertexInBuffer(dst: Float32Array, dstOffsVertex: number, v: MeshVertex, tangentT: ReadonlyVec3, tangentW: number): number {
    // Position
    dst[dstOffsVertex++] = v.position[0];
    dst[dstOffsVertex++] = v.position[1];
    dst[dstOffsVertex++] = v.position[2];

    // Normal
    dst[dstOffsVertex++] = v.normal[0];
    dst[dstOffsVertex++] = v.normal[1];
    dst[dstOffsVertex++] = v.normal[2];
    dst[dstOffsVertex++] = v.alpha;

    // Tangent
    vec3.cross(scratchVec3a, v.normal, tangentT);
    vec3.normalize(scratchVec3a, scratchVec3a);
    dst[dstOffsVertex++] = scratchVec3a[0];
    dst[dstOffsVertex++] = scratchVec3a[1];
    dst[dstOffsVertex++] = scratchVec3a[2];
    // Tangent Sign
    dst[dstOffsVertex++] = tangentW;

    // Texture UV
    dst[dstOffsVertex++] = v.uv[0];
    dst[dstOffsVertex++] = v.uv[1];

    dst[dstOffsVertex++] = v.lightmapUV[0];
    dst[dstOffsVertex++] = v.lightmapUV[1];

    return VERTEX_SIZE;
}

function fetchVertexFromBuffer(dst: MeshVertex, vertexData: Float32Array, i: number): void {
    let offsVertex = i * VERTEX_SIZE;

    // Position
    dst.position[0] = vertexData[offsVertex++];
    dst.position[1] = vertexData[offsVertex++];
    dst.position[2] = vertexData[offsVertex++];

    // Normal
    dst.normal[0] = vertexData[offsVertex++];
    dst.normal[1] = vertexData[offsVertex++];
    dst.normal[2] = vertexData[offsVertex++];
    dst.alpha = vertexData[offsVertex++];

    // Tangent
    offsVertex += 3;
    // Tangent Sign
    offsVertex++;

    // Texture UV
    dst.uv[0] = vertexData[offsVertex++];
    dst.uv[1] = vertexData[offsVertex++];

    // Lightmap UV
    dst.lightmapUV[0] = vertexData[offsVertex++];
    dst.lightmapUV[1] = vertexData[offsVertex++];
}

//#endregion

//#region Displacement

interface DispInfo {
    startPos: vec3;
    power: number;
    dispVertStart: number;
    sideLength: number;
    vertexCount: number;
}

interface DisplacementResult {
    vertex: MeshVertex[];
    bbox: AABB;
}

function buildDisplacement(disp: DispInfo, corners: ReadonlyVec3[], disp_verts: Float32Array, texMapping: TexinfoMapping): DisplacementResult {
    const vertex = nArray(disp.vertexCount, () => new MeshVertex());
    const bbox = new AABB();

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

            const v = vertex[y * disp.sideLength + x];
            vec3.lerp(v.position, v0, v1, tx);

            // Calculate texture coordinates before displacement happens.
            calcTexCoord(v.uv, v.position, texMapping);

            v.position[0] += (dvx * dvdist);
            v.position[1] += (dvy * dvdist);
            v.position[2] += (dvz * dvdist);
            v.lightmapUV[0] = tx;
            v.lightmapUV[1] = ty;
            v.alpha = saturate(dvalpha / 0xFF);
            bbox.unionPoint(v.position);
        }
    }

    // Normals
    const w = disp.sideLength;
    for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
            const v = vertex[y * w + x];
            const x0 = x - 1, x1 = x, x2 = x + 1;
            const y0 = y - 1, y1 = y, y2 = y + 1;

            let count = 0;

            // Top left
            if (x0 >= 0 && y0 >= 0) {
                vec3.sub(v0, vertex[y1*w+x0].position, vertex[y0*w+x0].position);
                vec3.sub(v1, vertex[y0*w+x1].position, vertex[y0*w+x0].position);
                vec3.cross(v0, v1, v0);
                vec3.normalize(v0, v0);
                vec3.add(v.normal, v.normal, v0);

                vec3.sub(v0, vertex[y1*w+x0].position, vertex[y0*w+x1].position);
                vec3.sub(v1, vertex[y1*w+x1].position, vertex[y0*w+x1].position);
                vec3.cross(v0, v1, v0);
                vec3.normalize(v0, v0);
                vec3.add(v.normal, v.normal, v0);

                count += 2;
            }

            // Top right
            if (x2 < w && y0 >= 0) {
                vec3.sub(v0, vertex[y1*w+x1].position, vertex[y0*w+x1].position);
                vec3.sub(v1, vertex[y0*w+x2].position, vertex[y0*w+x1].position);
                vec3.cross(v0, v1, v0);
                vec3.normalize(v0, v0);
                vec3.add(v.normal, v.normal, v0);

                vec3.sub(v0, vertex[y1*w+x1].position, vertex[y0*w+x2].position);
                vec3.sub(v1, vertex[y1*w+x2].position, vertex[y0*w+x2].position);
                vec3.cross(v0, v1, v0);
                vec3.normalize(v0, v0);
                vec3.add(v.normal, v.normal, v0);

                count += 2;
            }

            // Bottom left
            if (x0 >= 0 && y2 < w) {
                vec3.sub(v0, vertex[y2*w+x0].position, vertex[y1*w+x0].position);
                vec3.sub(v1, vertex[y1*w+x1].position, vertex[y1*w+x0].position);
                vec3.cross(v0, v1, v0);
                vec3.normalize(v0, v0);
                vec3.add(v.normal, v.normal, v0);

                vec3.sub(v0, vertex[y2*w+x0].position, vertex[y1*w+x1].position);
                vec3.sub(v1, vertex[y2*w+x1].position, vertex[y1*w+x1].position);
                vec3.cross(v0, v1, v0);
                vec3.normalize(v0, v0);
                vec3.add(v.normal, v.normal, v0);

                count += 2;
            }

            // Bottom right
            if (x2 < w && y2 < w) {
                vec3.sub(v0, vertex[y2*w+x1].position, vertex[y1*w+x1].position);
                vec3.sub(v1, vertex[y1*w+x2].position, vertex[y1*w+x1].position);
                vec3.cross(v0, v1, v0);
                vec3.normalize(v0, v0);
                vec3.add(v.normal, v.normal, v0);

                vec3.sub(v0, vertex[y2*w+x1].position, vertex[y1*w+x2].position);
                vec3.sub(v1, vertex[y2*w+x2].position, vertex[y1*w+x2].position);
                vec3.cross(v0, v1, v0);
                vec3.normalize(v0, v0);
                vec3.add(v.normal, v.normal, v0);

                count += 2;
            }

            vec3.scale(v.normal, v.normal, 1 / count);
        }
    }

    return { vertex, bbox };
}

//#endregion

//#region Overlays/Decals

// Stores information for each origin face to the final, packed surface data.
class BSPFaceInfo {
    public texinfo: Texinfo | null = null;
    public surfaceIndex: number = -1;
    public startIndex: number = 0;
    public endIndex: number = 0;
    public plane: Readonly<Plane>;
    public bbox: AABB | null = null; // If null, it's a displacement surface and has a resulting bbox.
    public overlaySurfaces: number[] = [];
}

class OverlayInfo {
    public faces: number[];
    public origin = vec3.create();
    public normal = vec3.create();
    public basis = nArray(2, () => vec3.create());
    public planePoints = nArray(4, () => vec2.create());
    public u0 = 0.0;
    public u1 = 0.0;
    public v0 = 0.0;
    public v1 = 0.0;
}

export interface DecalSurface {
    startIndex: number;
    indexCount: number;
    lightmapPackerPageIndex: number;
}

interface DecalResult {
    vertexData: ArrayBuffer;
    indexData: ArrayBuffer;
    surfaces: DecalSurface[];
    faces: number[];
    overlayResult: OverlayResult;
}

interface OverlaySurface {
    vertex: MeshVertex[];
    indices: number[];
    lightmapPackerPageIndex: number;
    originFaceList: number[];
    bbox: AABB;
}

interface OverlayResult {
    surfaces: OverlaySurface[];
}

export interface DecalSurface {
    startIndex: number;
    indexCount: number;
    lightmapPackerPageIndex: number;
    bbox: AABB;
}

interface DecalResult {
    vertexData: ArrayBuffer;
    indexData: ArrayBuffer;
    surfaces: DecalSurface[];
}

function buildOverlayPoints(dst: MeshVertex[], overlayInfo: OverlayInfo): void {
    assert(dst.length === 4);

    vec2.set(dst[0].uv, overlayInfo.u0, overlayInfo.v0);
    vec2.set(dst[1].uv, overlayInfo.u0, overlayInfo.v1);
    vec2.set(dst[2].uv, overlayInfo.u1, overlayInfo.v1);
    vec2.set(dst[3].uv, overlayInfo.u1, overlayInfo.v0);

    for (let i = 0; i < dst.length; i++) {
        const v = dst[i];
        const p = overlayInfo.planePoints[i];
        vec3FromBasis2(v.position, overlayInfo.origin, overlayInfo.basis[0], p[0], overlayInfo.basis[1], p[1]);
    }
}

function projectToOverlayPlane(dst: MeshVertex[], overlayInfo: OverlayInfo): void {
    assert(dst.length === 3);

    for (let i = 0; i < dst.length; i++) {
        const v = dst[i];

        // Project onto overlay plane.
        vec3.sub(scratchVec3a, v.position, overlayInfo.origin);
        const m = vec3.dot(overlayInfo.normal, scratchVec3a);
        vec3.scaleAndAdd(v.position, v.position, overlayInfo.normal, -m);
    }
}

function clipOverlayPlane(dst: MeshVertex[], surfaceNormal: ReadonlyVec3, p0: MeshVertex, p1: MeshVertex, p2: MeshVertex): void {
    const plane = new Plane();
    // First compute our clip plane.
    vec3.sub(p0.normal, p1.position, p0.position);
    vec3.normalize(p0.normal, p0.normal);
    vec3.cross(p0.normal, surfaceNormal, p0.normal);
    plane.set(p0.normal, -vec3.dot(p0.normal, p0.position));

    if (plane.distanceVec3(p2.position) > 0.0)
        plane.negate();

    const distance: number[] = [];

    const vertex = dst.slice();
    dst.length = 0;

    for (let i = 0; i < vertex.length; i++) {
        const v = vertex[i];
        distance[i] = plane.distanceVec3(v.position);
    }

    for (let i = 0; i < vertex.length; i++) {
        const i0 = i, i1 = (i + 1) % vertex.length;
        const d0 = distance[i0], d1 = distance[i1];
        const v0 = vertex[i0], v1 = vertex[i1];

        if (d0 <= 0.0)
            dst.push(v0);

        // Not crossing plane; no need to split.
        if (Math.sign(d0) === Math.sign(d1) || d0 === 0.0 || d1 === 0.0)
            continue;

        // Crossing plane, need to split.
        const t = d0 / (d0 - d1);

        const newVertex = new MeshVertex();
        vec3.lerp(newVertex.position, v0.position, v1.position, t);
        vec2.lerp(newVertex.uv, v0.uv, v1.uv, t);

        // Don't care about alpha / normal / lightmapUV.
        dst.push(newVertex);
    }
}

function calcWedgeArea2(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3): number {
    // Compute the wedge p0..p1 / p1..p2
    vec3.sub(scratchVec3a, p1, p0);
    vec3.sub(scratchVec3b, p2, p0);
    vec3.cross(scratchVec3c, scratchVec3a, scratchVec3b);
    return vec3.len(scratchVec3c);
}

function calcBarycentricsFromTri(dst: vec2, p: ReadonlyVec3, p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3, outerTriArea2: number): void {
    dst[0] = calcWedgeArea2(p1, p2, p) / outerTriArea2;
    dst[1] = calcWedgeArea2(p2, p0, p) / outerTriArea2;
}

function calcLightmapUVFromBarycentrics(v: MeshVertex, surfacePoints: MeshVertex[], surfaceTriArea2: number): void {
    // Assign lightmapUV from triangle barycentrics.
    calcBarycentricsFromTri(v.lightmapUV, v.position, surfacePoints[0].position, surfacePoints[1].position, surfacePoints[2].position, surfaceTriArea2);
    const baryU = v.lightmapUV[0], baryV = v.lightmapUV[1], baryW = (1 - baryU - baryV);
    vec2.scale(v.lightmapUV, surfacePoints[0].lightmapUV, baryU);
    vec2.scaleAndAdd(v.lightmapUV, v.lightmapUV, surfacePoints[1].lightmapUV, baryV);
    vec2.scaleAndAdd(v.lightmapUV, v.lightmapUV, surfacePoints[2].lightmapUV, baryW);
}

function mergeOverlaySurfaces(surfaces: OverlaySurface[]): void {
    // Sort surface and merge them together.
    surfaces.sort((a, b) => b.lightmapPackerPageIndex - a.lightmapPackerPageIndex);

    for (let i = 1; i < surfaces.length; i++) {
        const i0 = i - 1, i1 = i;
        const s0 = surfaces[i0], s1 = surfaces[i1];

        if (s0.lightmapPackerPageIndex !== s1.lightmapPackerPageIndex)
            continue;

        // Merge s1 into s0, then delete s0.
        let baseVertex = s0.vertex.length;
        s0.vertex.push(...s1.vertex);
        for (let j = 0; j < s1.indices.length; j++)
            s0.indices.push(baseVertex + s1.indices[j]);
        for (let j = 0; j < s1.originFaceList.length; j++)
            ensureInList(s0.originFaceList, s1.originFaceList[j]);
        s0.bbox.union(s0.bbox, s1.bbox);
        surfaces.splice(i1, 1);
        i--;
    }
}

function buildOverlay(overlayInfo: OverlayInfo, faceInfos: BSPFaceInfo[], bspSurfaces: BSPSurface[], indexData: Uint32Array, vertexData: Float32Array): OverlayResult {
    const surfaces: OverlaySurface[] = [];
    const surfacePoints = nArray(3, () => new MeshVertex());
    const surfacePlane = new Plane();

    for (let i = 0; i < overlayInfo.faces.length; i++) {
        const face = overlayInfo.faces[i];
        const faceInfo = faceInfos[face];

        const vertex: MeshVertex[] = [];
        const indices: number[] = [];
        const originFaceList: number[] = [];

        const bbox = new AABB();

        for (let index = faceInfo.startIndex; index < faceInfo.endIndex; index += 3) {
            const overlayPoints = nArray(4, () => new MeshVertex());
            buildOverlayPoints(overlayPoints, overlayInfo);

            fetchVertexFromBuffer(surfacePoints[0], vertexData, indexData[index + 0]);
            fetchVertexFromBuffer(surfacePoints[1], vertexData, indexData[index + 1]);
            fetchVertexFromBuffer(surfacePoints[2], vertexData, indexData[index + 2]);

            // Store our surface plane for later, so we can re-project back to it...
            surfacePlane.setTri(surfacePoints[0].position, surfacePoints[2].position, surfacePoints[1].position);

            // Project surface down to the overlay plane.
            projectToOverlayPlane(surfacePoints, overlayInfo);

            const surfaceTriArea2 = calcWedgeArea2(surfacePoints[0].position, surfacePoints[1].position, surfacePoints[2].position);

            // Clip the overlay plane to the surface.
            for (let j0 = 0; j0 < surfacePoints.length; j0++) {
                const j1 = (j0 + 1) % surfacePoints.length, j2 = (j0 + 2) % surfacePoints.length;
                const p0 = surfacePoints[j0], p1 = surfacePoints[j1], p2 = surfacePoints[j2];
                clipOverlayPlane(overlayPoints, overlayInfo.normal, p0, p1, p2);
            }

            if (overlayPoints.length < 3) {
                // Not enough to make a triangle. Just skip.
                continue;
            }

            for (let j = 0; j < overlayPoints.length; j++) {
                const v = overlayPoints[j];

                // Set the decal's normal to be the face normal...
                vec3.copy(v.normal, surfacePlane.n);

                calcLightmapUVFromBarycentrics(v, surfacePoints, surfaceTriArea2);

                // Project back down to the surface plane.
                const distance = surfacePlane.distanceVec3(v.position);
                const m = distance / Math.min(1.0, vec3.dot(v.normal, overlayInfo.normal));
                vec3.scaleAndAdd(v.position, v.position, overlayInfo.normal, -m);

                // Offset the normal just a smidgen...
                vec3.scaleAndAdd(v.position, v.position, v.normal, 0.1);
                bbox.unionPoint(v.position);
            }

            // We're done! Append the overlay plane to the list.
            const baseVertex = vertex.length;
            vertex.push(...overlayPoints);
            const dstIndexOffs = indices.length;
            indices.length = indices.length + getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriFans, overlayPoints.length);
            convertToTrianglesRange(indices, dstIndexOffs, GfxTopology.TriFans, baseVertex, overlayPoints.length);
        }

        if (vertex.length === 0)
            continue;

        originFaceList.push(face);

        const lightmapPackerPageIndex = bspSurfaces[faceInfo.surfaceIndex].lightmapPackerPageIndex;
        surfaces.push({ vertex, indices, lightmapPackerPageIndex, originFaceList, bbox });
    }

    mergeOverlaySurfaces(surfaces);

    return { surfaces };
}

function buildDecal(pt: ReadonlyVec3, halfWidth: number, halfHeight: number, queryAABB: Readonly<AABB>, faces: Iterable<number>, faceInfos: BSPFaceInfo[], bspSurfaces: BSPSurface[], indexData: Uint32Array, vertexData: Float32Array): OverlayResult {
    const surfaces: OverlaySurface[] = [];
    const surfacePlane = new Plane();
    const textureSpaceBasis = nArray(3, () => vec3.create());
    const dpt = vec3.create();

    const renderer = window.main.scene as SourceRenderer;

    for (const face of faces) {
        const faceInfo = faceInfos[face];

        if (faceInfo.bbox !== null) {
            if (!AABB.intersect(faceInfo.bbox, queryAABB))
                continue;
        } else {
            const maxDecalDistance = 4;
            if (Math.abs(faceInfo.plane.distanceVec3(pt)) >= maxDecalDistance)
                continue;
        }

        const vertex: MeshVertex[] = [];
        const indices: number[] = [];
        const originFaceList: number[] = [];

        const bbox = new AABB();

        for (let index = faceInfo.startIndex; index < faceInfo.endIndex; index += 3) {
            const surfacePoints = nArray(3, () => new MeshVertex());
            for (let i = 0; i < 3; i++)
                fetchVertexFromBuffer(surfacePoints[i], vertexData, indexData[index + i]);

            // Build the surface plane.
            surfacePlane.setTri(surfacePoints[0].position, surfacePoints[2].position, surfacePoints[1].position);

            vec3.copy(textureSpaceBasis[2], surfacePlane.n);

            if (Math.abs(surfacePlane.n[2]) >= Math.sin(MathConstants.TAU * 0.25)) {
                // Floor/Ceiling
                vec3.copy(textureSpaceBasis[0], Vec3UnitX);
                vec3.cross(textureSpaceBasis[1], textureSpaceBasis[0], textureSpaceBasis[2]);
                vec3.cross(textureSpaceBasis[0], textureSpaceBasis[2], textureSpaceBasis[1]);
            } else {
                // Wall
                vec3.copy(textureSpaceBasis[1], Vec3NegZ);
                vec3.cross(textureSpaceBasis[0], textureSpaceBasis[2], textureSpaceBasis[1]);
                vec3.cross(textureSpaceBasis[1], textureSpaceBasis[0], textureSpaceBasis[2]);
            }
            normToLength(textureSpaceBasis[0], halfWidth);
            normToLength(textureSpaceBasis[1], halfHeight);

            // Project our origin point down to the plane.
            surfacePlane.projectToPlane(dpt, pt);

            // Compute the four corners of the decal.
            const overlayPoints = nArray(4, () => new MeshVertex());
            for (let i = 0; i < 4; i++) {
                const p = overlayPoints[i];
                const sx = (0b0110 >>> i) & 1;
                const sy = (0b1100 >>> i) & 1;
                vec3FromBasis2(p.position, dpt, textureSpaceBasis[0], sx * 2 - 1, textureSpaceBasis[1], sy * 2 - 1);
                vec2.set(p.uv, sx, sy);
            }

            const surfaceTriArea2 = calcWedgeArea2(surfacePoints[0].position, surfacePoints[1].position, surfacePoints[2].position);

            // Clip the overlay plane to the surface.
            for (let j0 = 0; j0 < surfacePoints.length; j0++) {
                const j1 = (j0 + 1) % surfacePoints.length, j2 = (j0 + 2) % surfacePoints.length;
                const p0 = surfacePoints[j0], p1 = surfacePoints[j1], p2 = surfacePoints[j2];
                clipOverlayPlane(overlayPoints, surfacePlane.n, p0, p1, p2);
            }

            if (overlayPoints.length < 3) {
                // Not enough to make a triangle. Just skip.
                continue;
            }

            for (let j = 0; j < overlayPoints.length; j++) {
                const v = overlayPoints[j];

                calcLightmapUVFromBarycentrics(v, surfacePoints, surfaceTriArea2);

                // Set the decal's normal to be the face normal...
                vec3.copy(v.normal, surfacePlane.n);

                // Offset the normal just a smidgen...
                vec3.scaleAndAdd(v.position, v.position, v.normal, 0.1);
                bbox.unionPoint(v.position);
            }

            // We're done! Append the overlay plane to the list.
            const baseVertex = vertex.length;
            vertex.push(...overlayPoints);
            const dstIndexOffs = indices.length;
            indices.length = indices.length + getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriFans, overlayPoints.length);
            convertToTrianglesRange(indices, dstIndexOffs, GfxTopology.TriFans, baseVertex, overlayPoints.length);
        }

        if (vertex.length === 0)
            continue;

        originFaceList.push(face);

        const lightmapPackerPageIndex = bspSurfaces[faceInfo.surfaceIndex].lightmapPackerPageIndex;
        surfaces.push({ vertex, indices, lightmapPackerPageIndex, originFaceList, bbox });
    }

    mergeOverlaySurfaces(surfaces);

    return { surfaces };
}

//#endregion

//#region Visibility

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

//#endregion

//#region Lightmap

// Place into the lightmap page.
function calcLightmapTexcoords(dst: vec2, uv: ReadonlyVec2, lightmapData: FaceLightmapData, lightmapPage: LightmapPackerPage): void {
    dst[0] = (uv[0] + lightmapData.pagePosX) / lightmapPage.width;
    dst[1] = (uv[1] + lightmapData.pagePosY) / lightmapPage.height;
}

interface LightmapAlloc {
    readonly width: number;
    readonly height: number;
    pagePosX: number;
    pagePosY: number;
}

export class LightmapPackerPage {
    public skyline: Uint16Array;

    public width: number = 0;
    public height: number = 0;

    constructor(public maxWidth: number, public maxHeight: number) {
        // Initialize our skyline. Note that our skyline goes horizontal, not vertical.
        assert(this.maxWidth <= 0xFFFF);
        this.skyline = new Uint16Array(this.maxHeight);
    }

    public allocate(allocation: LightmapAlloc): boolean {
        const w = allocation.width, h = allocation.height;

        // March downwards until we find a span of skyline that will fit.
        let bestY = -1, minX = this.maxWidth - w + 1;
        for (let y = 0; y < this.maxHeight - h;) {
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
        // pageIndex filled in by caller.

        // Update our skyline.
        for (let y = bestY; y < bestY + h; y++)
            this.skyline[y] = minX + w;

        // Update our bounds.
        this.width = Math.max(this.width, minX + w);
        this.height = Math.max(this.height, bestY + h);

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

export class LightmapPacker {
    public pages: LightmapPackerPage[] = [];

    constructor(public pageWidth: number = 2048, public pageHeight: number = 2048) {
    }

    public allocate(allocation: FaceLightmapData): void {
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

//#endregion

//#region Parsing and Misc. Utils

const enum LumpType {
    ENTITIES                  = 0,
    PLANES                    = 1,
    TEXDATA                   = 2,
    VERTEXES                  = 3,
    VISIBILITY                = 4,
    NODES                     = 5,
    TEXINFO                   = 6,
    FACES                     = 7,
    LIGHTING                  = 8,
    LEAFS                     = 10,
    EDGES                     = 12,
    SURFEDGES                 = 13,
    MODELS                    = 14,
    WORLDLIGHTS               = 15,
    LEAFFACES                 = 16,
    DISPINFO                  = 26,
    VERTNORMALS               = 30,
    VERTNORMALINDICES         = 31,
    DISP_VERTS                = 33,
    GAME_LUMP                 = 35,
    LEAFWATERDATA             = 36,
    PRIMITIVES                = 37,
    PRIMINDICES               = 39,
    PAKFILE                   = 40,
    CUBEMAPS                  = 42,
    TEXDATA_STRING_DATA       = 43,
    TEXDATA_STRING_TABLE      = 44,
    OVERLAYS                  = 45,
    LEAF_AMBIENT_INDEX_HDR    = 51,
    LEAF_AMBIENT_INDEX        = 52,
    LIGHTING_HDR              = 53,
    WORLDLIGHTS_HDR           = 54,
    LEAF_AMBIENT_LIGHTING_HDR = 55,
    LEAF_AMBIENT_LIGHTING     = 56,
    FACES_HDR                 = 58,
}

function magicint(S: string): number {
    const n0 = S.charCodeAt(0);
    const n1 = S.charCodeAt(1);
    const n2 = S.charCodeAt(2);
    const n3 = S.charCodeAt(3);
    return (n0 << 24) | (n1 << 16) | (n2 << 8) | n3;
}

function decompressLZMA(compressedData: ArrayBufferSlice, uncompressedSize: number): ArrayBufferSlice {
    const compressedView = compressedData.createDataView();

    // Parse Valve's lzma_header_t.
    assert(readString(compressedData, 0x00, 0x04) === 'LZMA');
    const actualSize = compressedView.getUint32(0x04, true);
    assert(actualSize === uncompressedSize);
    const lzmaSize = compressedView.getUint32(0x08, true);
    assert(lzmaSize + 0x11 <= compressedData.byteLength);
    const lzmaProperties = decodeLZMAProperties(compressedData.slice(0x0C));

    return decompress(compressedData.slice(0x11), lzmaProperties, actualSize);
}

class ResizableArrayBuffer {
    private buffer: ArrayBuffer;
    private byteSize: number;
    private byteCapacity: number;

    constructor(initialSize: number = 0x400) {
        this.byteSize = 0;
        this.byteCapacity = initialSize;
        this.buffer = new ArrayBuffer(initialSize);
    }

    public ensureSize(byteSize: number): void {
        this.byteSize = byteSize;

        if (byteSize > this.byteCapacity) {
            this.byteCapacity = Math.max(byteSize, this.byteCapacity * 2);
            const oldBuffer = this.buffer;
            const newBuffer = new ArrayBuffer(this.byteCapacity);
            new Uint8Array(newBuffer).set(new Uint8Array(oldBuffer));
            this.buffer = newBuffer;
        }
    }

    public addByteSize(byteSize: number): void {
        this.ensureSize(this.byteSize + byteSize);
    }

    public addUint32(count: number): Uint32Array {
        this.addByteSize(count << 2);
        return new Uint32Array(this.buffer);
    }

    public addFloat32(count: number): Float32Array {
        const offs = this.byteSize;
        this.addByteSize(count << 2);
        return new Float32Array(this.buffer, offs, count);
    }

    public getAsUint32Array(): Uint32Array {
        return new Uint32Array(this.buffer, 0, this.byteSize >>> 2);
    }

    public getAsFloat32Array(): Float32Array {
        return new Float32Array(this.buffer, 0, this.byteSize >>> 2);
    }

    public finalize(): ArrayBuffer {
        return this.buffer.slice(0, this.byteSize);
    }
}

function readVec3(view: DataView, offs: number): vec3 {
    const x = view.getFloat32(offs + 0x00, true);
    const y = view.getFloat32(offs + 0x04, true);
    const z = view.getFloat32(offs + 0x08, true);
    return vec3.fromValues(x, y, z);
}

function readVec4(view: DataView, offs: number): vec4 {
    const x = view.getFloat32(offs + 0x00, true);
    const y = view.getFloat32(offs + 0x04, true);
    const z = view.getFloat32(offs + 0x08, true);
    const w = view.getFloat32(offs + 0x0C, true);
    return vec4.fromValues(x, y, z, w);
}

function readPlane(view: DataView, offs: number): Plane {
    const x = view.getFloat32(offs + 0x00, true);
    const y = view.getFloat32(offs + 0x04, true);
    const z = view.getFloat32(offs + 0x08, true);
    const d = view.getFloat32(offs + 0x0C, true);
    return new Plane(x, y, z, -d);
}

//#endregion

export enum BSPFileVariant {
    Default,
    Left4Dead2, // https://developer.valvesoftware.com/wiki/.bsp_(Source)/Game-Specific#Left_4_Dead_2_.2F_Contagion
}

type QueryLeafCallback = (leaf: BSPLeaf, leafIdx: number) => boolean; // Whether to continue

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
export class BSPFile {
    public version: number;
    public usingHDR: boolean;

    private entitiesStr: string; // For debugging.
    public entities: BSPEntity[] = [];
    public surfaces: BSPSurface[] = [];
    public faceInfos: BSPFaceInfo[];
    public overlays: BSPOverlay[] = [];
    public models: Model[] = [];
    public pakfile: ZipFile | null = null;
    public nodelist: BSPNode[] = [];
    public leaflist: BSPLeaf[] = [];
    public cubemaps: Cubemap[] = [];
    public worldlights: WorldLight[] = [];
    public leafwaterdata: BSPLeafWaterData[] = [];
    public detailObjects: DetailObjects | null = null;
    public staticObjects: StaticObjects | null = null;
    public visibility: BSPVisibility | null = null;
    public lightmapData: FaceLightmapData[] = [];
    public lightmapPacker = new LightmapPacker();

    public indexData: ArrayBuffer;
    public vertexData: ArrayBuffer;

    constructor(buffer: ArrayBufferSlice, mapname: string, private variant: BSPFileVariant = BSPFileVariant.Default) {
        assert(readString(buffer, 0x00, 0x04) === 'VBSP');
        const view = buffer.createDataView();
        this.version = view.getUint32(0x04, true);
        assert(this.version === 19 || this.version === 20 || this.version === 21  || this.version === 22);

        //#region Utils
        function getLumpDataEx(lumpType: LumpType): [ArrayBufferSlice, number] {
            const lumpsStart = 0x08;
            const idx = lumpsStart + lumpType * 0x10;

            let offs, size, version, uncompressedSize;
            if (variant === BSPFileVariant.Default) {
                offs = view.getUint32(idx + 0x00, true);
                size = view.getUint32(idx + 0x04, true);
                version = view.getUint32(idx + 0x08, true);
                uncompressedSize = view.getUint32(idx + 0x0C, true);
            } else if (variant === BSPFileVariant.Left4Dead2) {
                version = view.getUint32(idx + 0x00, true);
                offs = view.getUint32(idx + 0x04, true);
                size = view.getUint32(idx + 0x08, true);
                uncompressedSize = view.getUint32(idx + 0x0C, true);
            } else {
                throw "whoops";
            }

            if (uncompressedSize !== 0) {
                // LZMA compression.
                const compressedData = buffer.subarray(offs, size);
                const decompressed = decompressLZMA(compressedData, uncompressedSize);
                return [decompressed, version];
            } else {
                return [buffer.subarray(offs, size), version];
            }
        }

        function getLumpData(lumpType: LumpType, expectedVersion: number = 0): ArrayBufferSlice {
            const [buffer, version] = getLumpDataEx(lumpType);
            if (buffer.byteLength !== 0)
                assert(version === expectedVersion);
            return buffer;
        }
        //#endregion

        //#region HDR determination
        let lighting: ArrayBufferSlice | null = null;

        const preferHDR = true;
        if (preferHDR) {
            lighting = getLumpData(LumpType.LIGHTING_HDR, 1);
            this.usingHDR = true;

            if (lighting === null || lighting.byteLength === 0) {
                lighting = getLumpData(LumpType.LIGHTING, 1);
                this.usingHDR = false;
            }
        } else {
            lighting = getLumpData(LumpType.LIGHTING, 1);
            this.usingHDR = false;

            if (lighting === null || lighting.byteLength === 0) {
                lighting = getLumpData(LumpType.LIGHTING_HDR, 1);
                this.usingHDR = true;
            }
        }
        //#endregion

        //#region Basic Lump Parsing
        const visibilityData = getLumpData(LumpType.VISIBILITY);
        if (visibilityData.byteLength > 0)
            this.visibility = new BSPVisibility(visibilityData);

        const entitiesStr = decodeString(getLumpData(LumpType.ENTITIES));
        this.entities = parseEntitiesLump(entitiesStr);
        if (IS_DEVELOPMENT)
            this.entitiesStr = entitiesStr;

        const pakfileData = getLumpData(LumpType.PAKFILE);
        this.pakfile = parseZipFile(pakfileData);
        const nodes = getLumpData(LumpType.NODES).createDataView();

        const primindices = getLumpData(LumpType.PRIMINDICES).createTypedArray(Uint16Array);
        const primitives = getLumpData(LumpType.PRIMITIVES).createDataView();

        const vertexes = getLumpData(LumpType.VERTEXES).createTypedArray(Float32Array);
        const vertnormals = getLumpData(LumpType.VERTNORMALS).createTypedArray(Float32Array);
        const vertnormalindices = getLumpData(LumpType.VERTNORMALINDICES).createTypedArray(Uint16Array);
        const disp_verts = getLumpData(LumpType.DISP_VERTS).createTypedArray(Float32Array);
        //#endregion

        //#region Game Lump Parsing
        const game_lump = getLumpData(LumpType.GAME_LUMP).createDataView();
        function getGameLumpData(magic: string): [ArrayBufferSlice, number] | null {
            const lumpCount = game_lump.getUint32(0x00, true);
            const needle = magicint(magic);
            let idx = 0x04;
            for (let i = 0; i < lumpCount; i++) {
                const lumpmagic = game_lump.getUint32(idx + 0x00, true);
                if (lumpmagic === needle) {
                    const enum GameLumpFlags { COMPRESSED = 0x01, }
                    const flags: GameLumpFlags = game_lump.getUint16(idx + 0x04, true);
                    const version = game_lump.getUint16(idx + 0x06, true);
                    const fileofs = game_lump.getUint32(idx + 0x08, true);
                    const filelen = game_lump.getUint32(idx + 0x0C, true);

                    if (!!(flags & GameLumpFlags.COMPRESSED)) {
                        // Find next offset to find compressed size length.
                        let compressedEnd: number;
                        if (i + 1 < lumpCount)
                            compressedEnd = game_lump.getUint32(idx + 0x10 + 0x08, true);
                        else
                            compressedEnd = game_lump.byteOffset + game_lump.byteLength;
                        const compressed = buffer.slice(fileofs, compressedEnd);
                        const lump = decompressLZMA(compressed, filelen);
                        return [lump, version];
                    } else {
                        const lump = buffer.subarray(fileofs, filelen);
                        return [lump, version];
                    }
                }
                idx += 0x10;
            }
            return null;
        }

        const dprp = getGameLumpData('dprp');
        if (dprp !== null)
            this.detailObjects = deserializeGameLump_dprp(dprp[0], dprp[1]);

        const sprp = getGameLumpData('sprp');
        if (sprp !== null)
            this.staticObjects = deserializeGameLump_sprp(sprp[0], sprp[1], this.version);
        //#endregion

        //#region CUBEMAPS Parsing
        const cubemaps = getLumpData(LumpType.CUBEMAPS).createDataView();
        const cubemapHDRSuffix = this.usingHDR ? `.hdr` : ``;
        for (let idx = 0x00; idx < cubemaps.byteLength; idx += 0x10) {
            const posX = cubemaps.getInt32(idx + 0x00, true);
            const posY = cubemaps.getInt32(idx + 0x04, true);
            const posZ = cubemaps.getInt32(idx + 0x08, true);
            const pos = vec3.fromValues(posX, posY, posZ);
            const filename = `maps/${mapname}/c${posX}_${posY}_${posZ}${cubemapHDRSuffix}`;
            this.cubemaps.push({ pos, filename });
        }
        //#endregion

        //#region WORLDLIGHTS Parsing
        let worldlightsLump: ArrayBufferSlice | null = null;
        let worldlightsVersion = 0;
        let worldlightsIsHDR = false;

        if (this.usingHDR) {
            [worldlightsLump, worldlightsVersion] = getLumpDataEx(LumpType.WORLDLIGHTS_HDR);
            worldlightsIsHDR = true;
        }
        if (worldlightsLump === null || worldlightsLump.byteLength === 0) {
            [worldlightsLump, worldlightsVersion] = getLumpDataEx(LumpType.WORLDLIGHTS);
            worldlightsIsHDR = false;
        }
        const worldlights = worldlightsLump.createDataView();

        for (let i = 0, idx = 0x00; idx < worldlights.byteLength; i++, idx += 0x58) {
            const posX = worldlights.getFloat32(idx + 0x00, true);
            const posY = worldlights.getFloat32(idx + 0x04, true);
            const posZ = worldlights.getFloat32(idx + 0x08, true);
            const intensityX = worldlights.getFloat32(idx + 0x0C, true);
            const intensityY = worldlights.getFloat32(idx + 0x10, true);
            const intensityZ = worldlights.getFloat32(idx + 0x14, true);
            const normalX = worldlights.getFloat32(idx + 0x18, true);
            const normalY = worldlights.getFloat32(idx + 0x1C, true);
            const normalZ = worldlights.getFloat32(idx + 0x20, true);
            let shadow_cast_offsetX = 0;
            let shadow_cast_offsetY = 0;
            let shadow_cast_offsetZ = 0;
            if (worldlightsVersion === 1) {
                shadow_cast_offsetX = worldlights.getFloat32(idx + 0x24, true);
                shadow_cast_offsetY = worldlights.getFloat32(idx + 0x28, true);
                shadow_cast_offsetZ = worldlights.getFloat32(idx + 0x2C, true);
                idx += 0x0C;
            }
            const cluster = worldlights.getUint32(idx + 0x24, true);
            const type: WorldLightType = worldlights.getUint32(idx + 0x28, true);
            const style = worldlights.getUint32(idx + 0x2C, true);
            // cone angles for spotlights
            const stopdot = worldlights.getFloat32(idx + 0x30, true);
            const stopdot2 = worldlights.getFloat32(idx + 0x34, true);
            let exponent = worldlights.getFloat32(idx + 0x38, true);
            let radius = worldlights.getFloat32(idx + 0x3C, true);
            let constant_attn = worldlights.getFloat32(idx + 0x40, true);
            let linear_attn = worldlights.getFloat32(idx + 0x44, true);
            let quadratic_attn = worldlights.getFloat32(idx + 0x48, true);
            const flags: WorldLightFlags = worldlights.getUint32(idx + 0x4C, true);
            const texinfo = worldlights.getUint32(idx + 0x50, true);
            const owner = worldlights.getUint32(idx + 0x54, true);

            // Fixups for old data.
            if (quadratic_attn === 0.0 && linear_attn === 0.0 && constant_attn === 0.0 && (type === WorldLightType.Point || type === WorldLightType.Spotlight))
                quadratic_attn = 1.0;

            if (exponent === 0.0 && type === WorldLightType.Point)
                exponent = 1.0;

            const pos = vec3.fromValues(posX, posY, posZ);
            const intensity = vec3.fromValues(intensityX, intensityY, intensityZ);
            const normal = vec3.fromValues(normalX, normalY, normalZ);
            const shadow_cast_offset = vec3.fromValues(shadow_cast_offsetX, shadow_cast_offsetY, shadow_cast_offsetZ);

            if (radius === 0.0) {
                // Compute a proper radius from our attenuation factors.
                if (quadratic_attn === 0.0 && linear_attn === 0.0) {
                    // Constant light with no distance falloff. Pick a radius.
                    radius = 2000.0;
                } else if (quadratic_attn === 0.0) {
                    // Linear falloff.
                    const intensityScalar = vec3.length(intensity);
                    const minLightValue = worldlightsIsHDR ? 0.015 : 0.03;
                    radius = ((intensityScalar / minLightValue) - constant_attn) / linear_attn;
                } else {
                    // Solve quadratic equation.
                    const intensityScalar = vec3.length(intensity);
                    const minLightValue = worldlightsIsHDR ? 0.015 : 0.03;
                    const a = quadratic_attn, b = linear_attn, c = (constant_attn - intensityScalar / minLightValue);
                    const rad = (b ** 2) - 4 * a * c;
                    if (rad > 0.0)
                        radius = (-b + Math.sqrt(rad)) / (2.0 * a);
                    else
                        radius = 2000.0;
                }
            }

            const distAttenuation = vec3.fromValues(constant_attn, linear_attn, quadratic_attn);

            this.worldlights.push({ pos, intensity, normal, type, radius, distAttenuation, exponent, stopdot, stopdot2, style, flags });
        }
        //#endregion

        //#region TEXINFO Parsing
        const texinfos: Texinfo[] = [];
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
            const texName = readString(texstrData, texstrTable[nameTableStringID]).toLowerCase();
            texinfos.push({ textureMapping, lightmapMapping, flags, texName });
        }
        //#endregion

        //#region NODES Parsing
        const planes = getLumpData(LumpType.PLANES).createDataView();
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

            this.nodelist.push({ plane, child0, child1, bbox, area });
        }
        //#endregion

        //#region EDGES/SURFEDGES Parsing
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
        //#endregion

        //#region FACES Parsing
        let facelist: DataView | null = null;
        if (this.usingHDR)
            facelist = getLumpData(LumpType.FACES_HDR, 1).createDataView();
        if (facelist === null || facelist.byteLength === 0)
            facelist = getLumpData(LumpType.FACES, 1).createDataView();
        //#endregion

        //#region DISPINFO Parsing
        const dispinfo = getLumpData(LumpType.DISPINFO).createDataView();
        const dispinfolist: DispInfo[] = [];
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

            // TODO(jstpierre): neighbor rules
            // TODO(jstpierre): allowed verts

            // Precompute for easy access
            const sideLength = (1 << power) + 1;
            const vertexCount = sideLength ** 2;

            dispinfolist.push({ startPos, dispVertStart: m_iDispVertStart, power, sideLength, vertexCount });
        }
        //#endregion

        //#region LEAFWATERDATA Parsing
        const leafwaterdata = getLumpData(LumpType.LEAFWATERDATA).createDataView();
        for (let idx = 0; idx < leafwaterdata.byteLength; idx += 0x0C) {
            const surfaceZ = leafwaterdata.getFloat32(idx + 0x00, true);
            const minZ = leafwaterdata.getFloat32(idx + 0x04, true);
            const surfaceTexInfoID = leafwaterdata.getUint16(idx + 0x08, true);
            const surfaceMaterialName = texinfos[surfaceTexInfoID].texName;
            this.leafwaterdata.push({ surfaceZ, minZ, surfaceMaterialName });
        }
        //#endregion

        //#region MODELS Parsing
        const models = getLumpData(LumpType.MODELS).createDataView();
        const faceToModelIdx: number[] = [];
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

            const modelIndex = this.models.length;
            for (let i = firstface; i < firstface + numfaces; i++)
                faceToModelIdx[i] = modelIndex;
            this.models.push({ bbox, headnode, surfaces: [] });
        }
        //#endregion

        //#region Mesh Building
        interface Face {
            index: number;
            texinfo: number;
            vertnormalBase: number;
        }

        const faces: Face[] = [];
        let numfaces = 0;

        // Normals are packed in surface order (???), so we need to unpack these before the initial sort.
        let vertnormalIdx = 0;

        // Do some initial surface parsing, pack lightmaps.
        for (let i = 0, idx = 0x00; idx < facelist.byteLength; i++, idx += 0x38, numfaces++) {
            const numedges = facelist.getUint16(idx + 0x08, true);
            const texinfo = facelist.getUint16(idx + 0x0A, true);
            const tex = texinfos[texinfo];

            // Normals are stored in the data for all surfaces, even for displacements.
            const vertnormalBase = vertnormalIdx;
            vertnormalIdx += numedges;

            if (!!(tex.flags & (TexinfoFlags.SKY | TexinfoFlags.SKY2D)))
                continue;

            const lightofs = facelist.getInt32(idx + 0x14, true);
            const m_LightmapTextureSizeInLuxels = nArray(2, (i) => facelist!.getUint32(idx + 0x24 + i * 4, true));

            // Lighting styles
            const styles: number[] = [];
            for (let j = 0; j < 4; j++) {
                const style = facelist.getUint8(idx + 0x10 + j);
                if (style === 0xFF)
                    break;
                styles.push(style);
            }

            // Surface lighting info
            const width = m_LightmapTextureSizeInLuxels[0] + 1, height = m_LightmapTextureSizeInLuxels[1] + 1;
            const hasBumpmapSamples = !!(tex.flags & TexinfoFlags.BUMPLIGHT);
            const srcNumLightmaps = hasBumpmapSamples ? 4 : 1;
            const srcLightmapSize = styles.length * (width * height * srcNumLightmaps * 4);

            let samples: Uint8Array | null = null;
            if (lightofs !== -1)
                samples = lighting.subarray(lightofs, srcLightmapSize).createTypedArray(Uint8Array);

            const lightmapData: FaceLightmapData = {
                faceIndex: i,
                width, height, styles, samples, hasBumpmapSamples,
                pageIndex: -1, pagePosX: -1, pagePosY: -1,
            };

            // Allocate ourselves a lightmap page.
            this.lightmapPacker.allocate(lightmapData);
            this.lightmapData[i] = lightmapData;

            faces.push({ index: i, texinfo, vertnormalBase });
        }

        const [leafsLump, leafsVersion] = getLumpDataEx(LumpType.LEAFS);
        const leafs = leafsLump.createDataView();

        let leafambientindex: DataView | null = null;
        if (this.usingHDR)
            leafambientindex = getLumpData(LumpType.LEAF_AMBIENT_INDEX_HDR).createDataView();
        if (leafambientindex === null || leafambientindex.byteLength === 0)
            leafambientindex = getLumpData(LumpType.LEAF_AMBIENT_INDEX).createDataView();

        let leafambientlightingLump: ArrayBufferSlice | null = null;
        let leafambientlightingVersion: number = 0;
        if (this.usingHDR)
            [leafambientlightingLump, leafambientlightingVersion] = getLumpDataEx(LumpType.LEAF_AMBIENT_LIGHTING_HDR);
        if (leafambientlightingLump === null || leafambientlightingLump.byteLength === 0)
            [leafambientlightingLump, leafambientlightingVersion] = getLumpDataEx(LumpType.LEAF_AMBIENT_LIGHTING);
        const leafambientlighting = leafambientlightingLump.createDataView();

        const leaffacelist = getLumpData(LumpType.LEAFFACES).createTypedArray(Uint16Array);
        for (let i = 0, idx = 0x00; idx < leafs.byteLength; i++) {
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
            const leafindex = this.leaflist.length;

            idx += 0x1E;

            const ambientLightSamples: BSPLeafAmbientSample[] = [];
            if (leafsVersion === 0) {
                // We only have one ambient cube sample, in the middle of the leaf.
                const ambientCube: Color[] = [];

                for (let j = 0; j < 6; j++) {
                    const exp = leafs.getUint8(idx + 0x03);
                    // Game seems to accidentally include an extra factor of 255.0.
                    const r = unpackColorRGBExp32(leafs.getUint8(idx + 0x00), exp) * 255.0;
                    const g = unpackColorRGBExp32(leafs.getUint8(idx + 0x01), exp) * 255.0;
                    const b = unpackColorRGBExp32(leafs.getUint8(idx + 0x02), exp) * 255.0;
                    ambientCube.push(colorNewFromRGBA(r, g, b));
                    idx += 0x04;
                }

                const x = lerp(bboxMinX, bboxMaxX, 0.5);
                const y = lerp(bboxMinY, bboxMaxY, 0.5);
                const z = lerp(bboxMinZ, bboxMaxZ, 0.5);
                const pos = vec3.fromValues(x, y, z);

                ambientLightSamples.push({ ambientCube, pos });

                // Padding.
                idx += 0x02;
            } else if (leafambientindex.byteLength === 0) {
                // Intermediate leafambient version.
                assert(leafambientlighting.byteLength !== 0);
                assert(leafambientlightingVersion !== 1);

                // We only have one ambient cube sample, in the middle of the leaf.
                const ambientCube: Color[] = [];

                for (let j = 0; j < 6; j++) {
                    const ambientSampleColorIdx = (i * 6 + j) * 0x04;
                    const exp = leafambientlighting.getUint8(ambientSampleColorIdx + 0x03);
                    const r = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x00), exp) * 255.0;
                    const g = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x01), exp) * 255.0;
                    const b = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x02), exp) * 255.0;
                    ambientCube.push(colorNewFromRGBA(r, g, b));
                }

                const x = lerp(bboxMinX, bboxMaxX, 0.5);
                const y = lerp(bboxMinY, bboxMaxY, 0.5);
                const z = lerp(bboxMinZ, bboxMaxZ, 0.5);
                const pos = vec3.fromValues(x, y, z);

                ambientLightSamples.push({ ambientCube, pos });

                // Padding.
                idx += 0x02;
            } else {
                assert(leafambientlightingVersion === 1);
                const ambientSampleCount = leafambientindex.getUint16(leafindex * 0x04 + 0x00, true);
                const firstAmbientSample = leafambientindex.getUint16(leafindex * 0x04 + 0x02, true);
                for (let i = 0; i < ambientSampleCount; i++) {
                    const ambientSampleOffs = (firstAmbientSample + i) * 0x1C;

                    // Ambient cube samples
                    const ambientCube: Color[] = [];
                    let ambientSampleColorIdx = ambientSampleOffs;
                    for (let j = 0; j < 6; j++) {
                        const exp = leafambientlighting.getUint8(ambientSampleColorIdx + 0x03);
                        const r = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x00), exp) * 255.0;
                        const g = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x01), exp) * 255.0;
                        const b = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x02), exp) * 255.0;
                        ambientCube.push(colorNewFromRGBA(r, g, b));
                        ambientSampleColorIdx += 0x04;
                    }

                    // Fraction of bbox.
                    const xf = leafambientlighting.getUint8(ambientSampleOffs + 0x18) / 0xFF;
                    const yf = leafambientlighting.getUint8(ambientSampleOffs + 0x19) / 0xFF;
                    const zf = leafambientlighting.getUint8(ambientSampleOffs + 0x1A) / 0xFF;

                    const x = lerp(bboxMinX, bboxMaxX, xf);
                    const y = lerp(bboxMinY, bboxMaxY, yf);
                    const z = lerp(bboxMinZ, bboxMaxZ, zf);
                    const pos = vec3.fromValues(x, y, z);

                    ambientLightSamples.push({ ambientCube, pos });
                }

                // Padding.
                idx += 0x02;
            }

            const leafFaces = leaffacelist.subarray(firstleafface, firstleafface + numleaffaces);
            this.leaflist.push({
                bbox, cluster, area, ambientLightSamples,
                faces: Array.from(leafFaces),
                leafwaterdata, contents,
            });
        }

        // Sort faces by texinfo to prepare for splitting into surfaces.
        faces.sort((a, b) => texinfos[a.texinfo].texName.localeCompare(texinfos[b.texinfo].texName));

        this.faceInfos = nArray(numfaces, () => new BSPFaceInfo());

        const vertexBuffer = new ResizableArrayBuffer();
        const indexBuffer = new ResizableArrayBuffer();

        const scratchTangentS = vec3.create();
        const scratchTangentT = vec3.create();

        const addVertexDataToBuffer = (vertex: MeshVertex[], tex: Texinfo, center: vec3 | null, tangentW: number) => {
            const vertexData = vertexBuffer.addFloat32(vertex.length * VERTEX_SIZE);

            let dstOffsVertex = 0;
            for (let j = 0; j < vertex.length; j++) {
                const v = vertex[j];

                if (center !== null)
                    vec3.scaleAndAdd(center, center, v.position, 1 / vertex.length);

                if (!!(tex.flags & TexinfoFlags.NOLIGHT)) {
                    v.lightmapUV[0] = 0.5;
                    v.lightmapUV[1] = 0.5;
                }

                dstOffsVertex += packVertexInBuffer(vertexData, dstOffsVertex, v, scratchTangentT, tangentW);
            }
        };

        // Merge faces into surfaces, build meshes.
        let dstOffsIndex = 0;
        let dstIndexBase = 0;
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];

            const tex = texinfos[face.texinfo];
            const texName = tex.texName;

            const isTranslucent = !!(tex.flags & TexinfoFlags.TRANS);
            const center = isTranslucent ? vec3.create() : null;

            // Determine if we can merge with the previous surface for output.
            let mergeSurface: BSPSurface | null = null;
            if (i > 0) {
                const prevFace = faces[i - 1];
                let canMerge = true;

                // Translucent surfaces require a sort, so they can't be merged.
                if (isTranslucent)
                    canMerge = false;
                else if (texinfos[prevFace.texinfo].texName !== texName)
                    canMerge = false;
                else if (this.lightmapData[prevFace.index].pageIndex !== this.lightmapData[face.index].pageIndex)
                    canMerge = false;
                else if (faceToModelIdx[prevFace.index] !== faceToModelIdx[face.index])
                    canMerge = false;

                if (canMerge)
                    mergeSurface = this.surfaces[this.surfaces.length - 1];
            }

            const idx = face.index * 0x38;
            const planenum = facelist.getUint16(idx + 0x00, true);
            const side = facelist.getUint8(idx + 0x02);
            const onNode = !!facelist.getUint8(idx + 0x03);
            const firstedge = facelist.getUint32(idx + 0x04, true);
            const numedges = facelist.getUint16(idx + 0x08, true);
            const dispinfo = facelist.getInt16(idx + 0x0C, true);
            const surfaceFogVolumeID = facelist.getUint16(idx + 0x0E, true);

            const area = facelist.getFloat32(idx + 0x18, true);
            const m_LightmapTextureMinsInLuxels = nArray(2, (i) => facelist!.getInt32(idx + 0x1C + i * 4, true));
            const m_LightmapTextureSizeInLuxels = nArray(2, (i) => facelist!.getUint32(idx + 0x24 + i * 4, true));
            const origFace = facelist.getUint32(idx + 0x2C, true);
            const m_NumPrimsRaw = facelist.getUint16(idx + 0x30, true);
            const m_NumPrims = m_NumPrimsRaw & 0x7FFF;
            const firstPrimID = facelist.getUint16(idx + 0x32, true);
            const smoothingGroups = facelist.getUint32(idx + 0x34, true);

            // Tangent space setup.
            vec3.set(scratchTangentS, tex.textureMapping.s[0], tex.textureMapping.s[1], tex.textureMapping.s[2]);
            vec3.normalize(scratchTangentS, scratchTangentS);
            vec3.set(scratchTangentT, tex.textureMapping.t[0], tex.textureMapping.t[1], tex.textureMapping.t[2]);
            vec3.normalize(scratchTangentT, scratchTangentT);

            const scratchNormal = scratchTangentS; // reuse
            vec3.cross(scratchNormal, scratchTangentS, scratchTangentT);

            // Detect if we need to flip tangents.
            const plane = readPlane(planes, planenum * 0x14);
            const tangentSSign = vec3.dot(plane.n, scratchNormal) > 0.0 ? -1.0 : 1.0;

            const lightmapData = this.lightmapData[face.index];
            const lightmapPackerPageIndex = lightmapData.pageIndex;
            const lightmapPage = this.lightmapPacker.pages[lightmapData.pageIndex];

            const tangentW = tangentSSign;

            // World surfaces always want the texcoord0 scale.
            const wantsTexCoord0Scale = true;

            const faceInfo = this.faceInfos[face.index];
            faceInfo.texinfo = texinfos[face.texinfo];
            faceInfo.startIndex = dstOffsIndex;
            faceInfo.plane = plane;

            let indexCount = 0;
            let vertexCount = 0;
            let bbox: AABB;

            // vertex data
            if (dispinfo >= 0) {
                // Build displacement data.
                const disp = dispinfolist[dispinfo];

                assert(numedges === 4);

                // Load the four corner vertices.
                let corners: vec3[] = [];
                let startDist = Infinity;
                let startCorner = -1;
                for (let j = 0; j < 4; j++) {
                    const vertIndex = vertindices[firstedge + j];
                    const corner = vec3.fromValues(vertexes[vertIndex * 3 + 0], vertexes[vertIndex * 3 + 1], vertexes[vertIndex * 3 + 2]);
                    corners.push(corner);
                    const dist = vec3.dist(corner, disp.startPos);
                    if (dist < startDist) {
                        startCorner = j;
                        startDist = dist;
                    }
                }
                assert(startCorner >= 0);

                // Rotate vectors so start pos corner is first
                if (startCorner !== 0)
                    corners = corners.slice(startCorner).concat(corners.slice(0, startCorner));

                const result = buildDisplacement(disp, corners, disp_verts, tex.textureMapping);
                bbox = result.bbox;
                faceInfo.bbox = result.bbox;

                for (let j = 0; j < result.vertex.length; j++) {
                    const v = result.vertex[j];

                    // Put lightmap UVs in luxel space.
                    v.lightmapUV[0] = v.lightmapUV[0] * m_LightmapTextureSizeInLuxels[0] + 0.5;
                    v.lightmapUV[1] = v.lightmapUV[1] * m_LightmapTextureSizeInLuxels[1] + 0.5;

                    calcLightmapTexcoords(v.lightmapUV, v.lightmapUV, lightmapData, lightmapPage);
                }

                addVertexDataToBuffer(result.vertex, tex, center, tangentW);

                // Build grid index buffer.
                const indexData = indexBuffer.addUint32(((disp.sideLength - 1) ** 2) * 6);
                for (let y = 0; y < disp.sideLength - 1; y++) {
                    for (let x = 0; x < disp.sideLength - 1; x++) {
                        const base = dstIndexBase + y * disp.sideLength + x;
                        indexData[dstOffsIndex + indexCount++] = base;
                        indexData[dstOffsIndex + indexCount++] = base + disp.sideLength;
                        indexData[dstOffsIndex + indexCount++] = base + disp.sideLength + 1;
                        indexData[dstOffsIndex + indexCount++] = base;
                        indexData[dstOffsIndex + indexCount++] = base + disp.sideLength + 1;
                        indexData[dstOffsIndex + indexCount++] = base + 1;
                    }
                }
                assert(indexCount === ((disp.sideLength - 1) ** 2) * 6);

                vertexCount = disp.vertexCount;
            } else {
                bbox = new AABB();

                const vertex = nArray(numedges, () => new MeshVertex());
                for (let j = 0; j < numedges; j++) {
                    const v = vertex[j];

                    // Position
                    const vertIndex = vertindices[firstedge + j];
                    v.position[0] = vertexes[vertIndex * 3 + 0];
                    v.position[1] = vertexes[vertIndex * 3 + 1];
                    v.position[2] = vertexes[vertIndex * 3 + 2];
                    bbox.unionPoint(v.position);

                    // Normal
                    const vertnormalBase = face.vertnormalBase;
                    const normIndex = vertnormalindices[vertnormalBase + j];
                    v.normal[0] = vertnormals[normIndex * 3 + 0];
                    v.normal[1] = vertnormals[normIndex * 3 + 1];
                    v.normal[2] = vertnormals[normIndex * 3 + 2];

                    // Alpha
                    v.alpha = 0.0;

                    // Texture Coordinates
                    calcTexCoord(v.uv, v.position, tex.textureMapping);

                    // Lightmap coordinates from the lightmap mapping
                    calcTexCoord(v.lightmapUV, v.position, tex.lightmapMapping);
                    v.lightmapUV[0] += 0.5 - m_LightmapTextureMinsInLuxels[0];
                    v.lightmapUV[1] += 0.5 - m_LightmapTextureMinsInLuxels[1];

                    calcLightmapTexcoords(v.lightmapUV, v.lightmapUV, lightmapData, lightmapPage);
                }

                addVertexDataToBuffer(vertex, tex, center, tangentW);

                indexCount = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriFans, numedges);
                const indexData = indexBuffer.addUint32(indexCount);
                if (m_NumPrims !== 0) {
                    let primType, primFirstIndex, primIndexCount, primFirstVert, primVertCount;
                    if (this.version === 22) {
                        const primOffs = firstPrimID * 0x10;
                        primType = primitives.getUint8(primOffs + 0x00);
                        primFirstIndex = primitives.getUint32(primOffs + 0x04, true);
                        primIndexCount = primitives.getUint32(primOffs + 0x08, true);
                        primFirstVert = primitives.getUint16(primOffs + 0x0C, true);
                        primVertCount = primitives.getUint16(primOffs + 0x0E, true);
                    } else {
                        const primOffs = firstPrimID * 0x0A;
                        primType = primitives.getUint8(primOffs + 0x00);
                        primFirstIndex = primitives.getUint16(primOffs + 0x02, true);
                        primIndexCount = primitives.getUint16(primOffs + 0x04, true);
                        primFirstVert = primitives.getUint16(primOffs + 0x06, true);
                        primVertCount = primitives.getUint16(primOffs + 0x08, true);
                    }
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
                    convertToTrianglesRange(indexData, dstOffsIndex, GfxTopology.TriFans, dstIndexBase, numedges);
                }

                vertexCount = numedges;
            }

            let surface = mergeSurface;

            if (surface === null) {
                surface = { texName, startIndex: dstOffsIndex, indexCount: 0, center, wantsTexCoord0Scale, lightmapPackerPageIndex, faceList: [], bbox };
                this.surfaces.push(surface);
            } else {
                surface.bbox.union(surface.bbox, bbox);
            }

            surface.indexCount += indexCount;
            surface.faceList.push(face.index);

            dstOffsIndex += indexCount;
            dstIndexBase += vertexCount;

            faceInfo.endIndex = dstOffsIndex;

            // Associate surface with the right face and model.
            const surfaceIndex = this.surfaces.length - 1;
            faceInfo.surfaceIndex = surfaceIndex;

            const model = this.models[faceToModelIdx[face.index]];
            ensureInList(model.surfaces, surfaceIndex);

            if (dispinfo >= 0) {
                // Displacements don't come with surface leaf information.
                // Use the bbox to mark ourselves in the proper leaves...
                this.queryAABB(surface.bbox, (leaf) => {
                    ensureInList(leaf.faces, face.index);
                    return true;
                });
            }
        }
        //#endregion

        //#region Overlays
        const overlays = getLumpData(LumpType.OVERLAYS).createDataView();
        for (let i = 0, idx = 0; idx < overlays.byteLength; i++) {
            const nId = overlays.getUint32(idx + 0x00, true);
            const nTexinfo = overlays.getUint16(idx + 0x04, true);
            const m_nFaceCountAndRenderOrder = overlays.getUint16(idx + 0x06, true);
            const m_nFaceCount = m_nFaceCountAndRenderOrder & 0x3FFF;
            const m_nRenderOrder = m_nFaceCountAndRenderOrder >>> 14;
            idx += 0x08;

            const overlayInfo = new OverlayInfo();
            overlayInfo.faces = nArray(m_nFaceCount, (i) => overlays.getInt32(idx + 0x04 * i, true));
            idx += 0x100;

            overlayInfo.u0 = overlays.getFloat32(idx + 0x00, true);
            overlayInfo.u1 = overlays.getFloat32(idx + 0x04, true);
            overlayInfo.v0 = overlays.getFloat32(idx + 0x08, true);
            overlayInfo.v1 = overlays.getFloat32(idx + 0x0C, true);

            const vecUVPoint0X = overlays.getFloat32(idx + 0x10, true);
            const vecUVPoint0Y = overlays.getFloat32(idx + 0x14, true);
            const vecUVPoint0Z = overlays.getFloat32(idx + 0x18, true);
            const vecUVPoint1X = overlays.getFloat32(idx + 0x1C, true);
            const vecUVPoint1Y = overlays.getFloat32(idx + 0x20, true);
            const vecUVPoint1Z = overlays.getFloat32(idx + 0x24, true);
            const vecUVPoint2X = overlays.getFloat32(idx + 0x28, true);
            const vecUVPoint2Y = overlays.getFloat32(idx + 0x2C, true);
            const vecUVPoint2Z = overlays.getFloat32(idx + 0x30, true);
            const vecUVPoint3X = overlays.getFloat32(idx + 0x34, true);
            const vecUVPoint3Y = overlays.getFloat32(idx + 0x38, true);
            const vecUVPoint3Z = overlays.getFloat32(idx + 0x3C, true);
            idx += 0x40;

            overlayInfo.origin[0] = overlays.getFloat32(idx + 0x00, true);
            overlayInfo.origin[1] = overlays.getFloat32(idx + 0x04, true);
            overlayInfo.origin[2] = overlays.getFloat32(idx + 0x08, true);
            idx += 0x0C;

            overlayInfo.normal[0] = overlays.getFloat32(idx + 0x00, true);
            overlayInfo.normal[1] = overlays.getFloat32(idx + 0x04, true);
            overlayInfo.normal[2] = overlays.getFloat32(idx + 0x08, true);
            idx += 0x0C;

            // Basis normal 0 is encoded in Z of vecUVPoint data.
            vec3.set(overlayInfo.basis[0], vecUVPoint0Z, vecUVPoint1Z, vecUVPoint2Z);
            vec3.cross(overlayInfo.basis[1], overlayInfo.normal, overlayInfo.basis[0]);

            if (vecUVPoint3Z == 1.0)
                vec3.negate(overlayInfo.basis[1], overlayInfo.basis[1]);

            vec2.set(overlayInfo.planePoints[0], vecUVPoint0X, vecUVPoint0Y);
            vec2.set(overlayInfo.planePoints[1], vecUVPoint1X, vecUVPoint1Y);
            vec2.set(overlayInfo.planePoints[2], vecUVPoint2X, vecUVPoint2Y);
            vec2.set(overlayInfo.planePoints[3], vecUVPoint3X, vecUVPoint3Y);

            const center = vec3.create();
            const tex = texinfos[nTexinfo];

            const surfaceIndexes: number[] = [];

            const overlayResult = buildOverlay(overlayInfo, this.faceInfos, this.surfaces, indexBuffer.getAsUint32Array(), vertexBuffer.getAsFloat32Array());
            for (let j = 0; j < overlayResult.surfaces.length; j++) {
                const overlaySurface = overlayResult.surfaces[j];

                // Don't care about tangentS of decals right now...
                const tangentW = 1.0;

                addVertexDataToBuffer(overlaySurface.vertex, tex, center, tangentW);

                const vertexCount = overlaySurface.vertex.length;
                const indexCount = overlaySurface.indices.length;

                const startIndex = dstOffsIndex;
                const indexData = indexBuffer.addUint32(overlaySurface.indices.length);
                for (let n = 0; n < overlaySurface.indices.length; n++)
                    indexData[dstOffsIndex++] = dstIndexBase + overlaySurface.indices[n];
                dstIndexBase += vertexCount;

                const texName = tex.texName;
                const surface: BSPSurface = { texName, startIndex, indexCount, center, wantsTexCoord0Scale: false, lightmapPackerPageIndex: 0, faceList: [], bbox: overlaySurface.bbox };

                const surfaceIndex = this.surfaces.push(surface) - 1;

                // Currently, overlays are part of the world model. We need to track origin surfaces / models if this differs...
                this.models[0].surfaces.push(surfaceIndex);
                surfaceIndexes.push(surfaceIndex);

                for (let k = 0; k < overlaySurface.originFaceList.length; k++) {
                    const faceInfo = this.faceInfos[overlaySurface.originFaceList[k]];
                    faceInfo.overlaySurfaces.push(surfaceIndex);
                }
            }

            this.overlays.push({ surfaceIndexes });
        }
        //#endregion

        this.vertexData = vertexBuffer.finalize();
        this.indexData = indexBuffer.finalize();
    }

    private findLeafWaterForPointR(p: ReadonlyVec3, liveLeafSet: Set<number>, nodeid: number): BSPLeafWaterData | null {
        if (nodeid < 0) {
            const leafidx = -nodeid - 1;
            if (liveLeafSet.has(leafidx)) {
                const leaf = this.leaflist[leafidx];
                if (leaf.leafwaterdata !== -1)
                    return this.leafwaterdata[leaf.leafwaterdata];
            }
            return null;
        }

        const node = this.nodelist[nodeid];
        const dot = node.plane.distanceVec3(p);

        const check1 = dot >= 0.0 ? node.child0 : node.child1;
        const check2 = dot >= 0.0 ? node.child1 : node.child0;

        const w1 = this.findLeafWaterForPointR(p, liveLeafSet, check1);
        if (w1 !== null)
            return w1;
        const w2 = this.findLeafWaterForPointR(p, liveLeafSet, check2);
        if (w2 !== null)
            return w2;

        return null;
    }

    public findLeafWaterForPoint(p: ReadonlyVec3, liveLeafSet: Set<number>): BSPLeafWaterData | null {
        if (this.leafwaterdata.length === 0)
            return null;

        return this.findLeafWaterForPointR(p, liveLeafSet, 0);
    }

    public queryPoint(p: ReadonlyVec3, nodeid: number = 0): BSPLeaf | null {
        if (nodeid < 0) {
            return this.leaflist[-nodeid - 1];
        } else {
            const node = this.nodelist[nodeid];
            const dot = node.plane.distanceVec3(p);
            return this.queryPoint(p, dot >= 0.0 ? node.child0 : node.child1);
        }
    }

    public queryAABB(aabb: AABB, callback: QueryLeafCallback, nodeid = 0): boolean {
        if (nodeid < 0) {
            const leafidx = -nodeid - 1;
            return callback(this.leaflist[leafidx], leafidx);
        } else {
            const node = this.nodelist[nodeid];

            if (!AABB.intersect(node.bbox, aabb))
                return true;

            const plane = node.plane;

            // Find min and max corners.
            const aabbMin = scratchVec3a;
            const aabbMax = scratchVec3b;
            for (let i = 0; i < 3; i++) {
                if (plane.n[i] >= 0) {
                    aabbMin[i] = aabb.min[i];
                    aabbMax[i] = aabb.max[i];
                } else {
                    aabbMin[i] = aabb.max[i];
                    aabbMax[i] = aabb.min[i];
                }
            }

            if (plane.distanceVec3(aabbMax) < 0) { // if (aabbMax[plane.type] <= plane.d)
                // Box is on the outside of child0; traverse child1.
                return this.queryAABB(aabb, callback, node.child1);
            } else if (plane.distanceVec3(aabbMin) > 0) { // if (aabbMin[plane.type] >= plane.d)
                // Box is on the outside of child1; traverse child0.
                return this.queryAABB(aabb, callback, node.child0);
            } else {
                // Traverse both.
                return this.queryAABB(aabb, callback, node.child0) && this.queryAABB(aabb, callback, node.child1);
            }
        }
    }

    public buildDecal(pt: ReadonlyVec3, halfWidth: number, halfHeight: number): DecalResult {
        const aabb = new AABB();
        const size = Math.max(halfWidth, halfHeight);
        vec3SetAll(scratchVec3a, size);
        aabb.setFromCenterAndHalfExtents(pt, scratchVec3a);

        const faces = new Set<number>();
        this.queryAABB(aabb, (leaf) => {
            for (let i = 0; i < leaf.faces.length; i++) {
                const face = leaf.faces[i];
                const faceInfo = this.faceInfos[face];
                if (faceInfo.texinfo === null || faceInfo.texinfo.flags & TexinfoFlags.NODECALS)
                    continue;
                faces.add(face);
            }
            return true;
        });

        const overlayResult = buildDecal(pt, halfWidth, halfHeight, aabb, faces, this.faceInfos, this.surfaces, new Uint32Array(this.indexData), new Float32Array(this.vertexData));

        const vertexDataArray = new ResizableArrayBuffer();
        const indexDataArray = new ResizableArrayBuffer();

        const surfaces: DecalSurface[] = [];

        let dstOffsIndex = 0;
        for (let i = 0; i < overlayResult.surfaces.length; i++) {
            const surface = overlayResult.surfaces[i];

            const dstVertex = vertexDataArray.addFloat32(surface.vertex.length * VERTEX_SIZE);
            let dstOffsVertex = 0;
            for (let j = 0; j < surface.vertex.length; j++)
                dstOffsVertex += packVertexInBuffer(dstVertex, dstOffsVertex, surface.vertex[j], Vec3UnitX, 1.0);

            const startIndex = dstOffsIndex, indexCount = surface.indices.length;
            const lightmapPackerPageIndex = surface.lightmapPackerPageIndex;
            const bbox = surface.bbox;
            const dstIndex = indexDataArray.addUint32(indexCount);
            dstIndex.set(surface.indices, dstOffsIndex);
            dstOffsIndex += indexCount;

            surfaces.push({ startIndex, indexCount, lightmapPackerPageIndex, bbox });
        }

        return { vertexData: vertexDataArray.finalize(), indexData: indexDataArray.finalize(), surfaces, faces: [... faces], overlayResult };
    }

    public debugDrawFace(clipFromWorldMatrix: ReadonlyMat4, idx: number): void {
        const faceInfo = this.faceInfos[idx];
        const p = nArray(3, () => new MeshVertex());
        const vertexData = new Float32Array(this.vertexData);
        const indexData = new Uint32Array(this.indexData);
        for (let i = faceInfo.startIndex; i < faceInfo.endIndex; i += 3) {
            for (let j = 0; j < 3; j++)
                fetchVertexFromBuffer(p[j], vertexData, indexData[i+j]);

            const c = vec3.create();
            for (let j = 0; j < 3; j++) {
                const p0 = p[j], p1 = p[(j + 1) % 3];
                vec3.scaleAndAdd(c, c, p0.position, 1/3);
                drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, p0.position, p1.position);
            }

            drawWorldSpaceText(getDebugOverlayCanvas2D(), clipFromWorldMatrix, c, `${idx}/${i-faceInfo.startIndex}`);
        }
    }

    public destroy(): void {
        // Nothing to do...
    }
}

//#region Entities

export interface BSPEntity {
    classname: string;
    [k: string]: string;
}

function parseEntitiesLump(str: string): BSPEntity[] {
    const p = new ValveKeyValueParser(str);
    const entities: BSPEntity[] = [];
    while (p.hastok()) {
        entities.push(pairs2obj(p.unit() as VKFPair[]) as BSPEntity);
        p.skipwhite();
    }
    return entities;
}

//#endregion
