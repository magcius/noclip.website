import { mat4, ReadonlyVec3, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { ImageFormat, ImageSize, TexCM } from '../Common/N64/Image.js';
import { OtherModeH_CycleType, OtherModeH_Layout } from '../Common/N64/RDP.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';
import { AABB } from '../Geometry.js';
import { MathConstants, vec3SetAll } from '../MathHelpers.js';
import { nArray } from '../util.js';
import { AnimatedTexture, RSP_Geometry, RSPSharedOutput, RSPState, runDL_F3DEX2 } from './f3dex2.js';
import { buildObjectLighting } from './light.js';
import type { ObjectLightingEnvironment } from './light.js';
import { initDL } from './material.js';
import type { InstanceScript, SetupProp } from './parse.js';
import type { Geometry, GeometryRenderer } from './render.js';
import type { DK64Renderer, ROMData } from './scenes.js';

const scratchVec3a = vec3.create();

function computeBillboardBoundingBox(origin: ReadonlyVec3, rightOffsets: readonly number[], upOffsets: readonly number[], forwardOffsets: readonly number[]): AABB {
    let radius = 0;
    for (let i = 0; i < rightOffsets.length; i++)
        radius = Math.max(radius, Math.hypot(rightOffsets[i], upOffsets[i], forwardOffsets[i]));
    const boundingBox = new AABB();
    vec3SetAll(scratchVec3a, radius);
    boundingBox.setFromCenterAndHalfExtents(origin, scratchVec3a);
    return boundingBox;
}

export interface TerrainTriangle {
    vertices: [vec3, vec3, vec3];
    normal: vec3;
}

interface TerrainSurface {
    y: number;
    normal: vec3;
}

class TerrainTriangleGrid {
    private cells = new Map<string, TerrainTriangle[]>();
    private cellSize: number;

    constructor(triangles: readonly TerrainTriangle[]) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const triangle of triangles) {
            for (const vertex of triangle.vertices) {
                minX = Math.min(minX, vertex[0]);
                maxX = Math.max(maxX, vertex[0]);
                minZ = Math.min(minZ, vertex[2]);
                maxZ = Math.max(maxZ, vertex[2]);
            }
        }

        // Try to fit ~8 triangles per grid cell.
        const targetCellCount = Math.max(1, Math.ceil(triangles.length / 8));
        const terrainArea = (maxX - minX) * (maxZ - minZ);
        this.cellSize = triangles.length > 0 && terrainArea > 0
            ? Math.max(1, Math.sqrt(terrainArea / targetCellCount))
            : 1;

        for (const triangle of triangles) {
            const [a, b, c] = triangle.vertices;
            const minCellX = this.getCellCoordinate(Math.min(a[0], b[0], c[0]));
            const maxCellX = this.getCellCoordinate(Math.max(a[0], b[0], c[0]));
            const minCellZ = this.getCellCoordinate(Math.min(a[2], b[2], c[2]));
            const maxCellZ = this.getCellCoordinate(Math.max(a[2], b[2], c[2]));
            for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
                for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
                    const key = this.getCellKey(cellX, cellZ);
                    let cell = this.cells.get(key);
                    if (cell === undefined) {
                        cell = [];
                        this.cells.set(key, cell);
                    }
                    cell.push(triangle);
                }
            }
        }
    }

    private getCellCoordinate(position: number): number {
        return Math.floor(position / this.cellSize);
    }

    private getCellKey(cellX: number, cellZ: number): string {
        return `${cellX},${cellZ}`;
    }

    public getTrianglesAt(x: number, z: number): readonly TerrainTriangle[] {
        const cellX = this.getCellCoordinate(x);
        const cellZ = this.getCellCoordinate(z);
        return this.cells.get(this.getCellKey(cellX, cellZ)) ?? [];
    }

    public getTrianglesInBounds(minX: number, minZ: number, maxX: number, maxZ: number): TerrainTriangle[] {
        const triangles = new Set<TerrainTriangle>();
        const minCellX = this.getCellCoordinate(minX);
        const maxCellX = this.getCellCoordinate(maxX);
        const minCellZ = this.getCellCoordinate(minZ);
        const maxCellZ = this.getCellCoordinate(maxZ);
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++)
            for (let cellX = minCellX; cellX <= maxCellX; cellX++)
                for (const triangle of this.cells.get(this.getCellKey(cellX, cellZ)) ?? [])
                    triangles.add(triangle);
        return [...triangles];
    }
}

export function buildTerrainTriangles(sharedOutput: RSPSharedOutput): TerrainTriangle[] {
    const triangles: TerrainTriangle[] = [];
    const indices = sharedOutput.indices;
    const vertices = sharedOutput.vertices;
    for (let i = 0; i + 2 < indices.length; i += 3) {
        const va = vertices[indices[i]];
        const vb = vertices[indices[i + 1]];
        const vc = vertices[indices[i + 2]];
        const a = vec3.fromValues(va.x, va.y, va.z);
        const b = vec3.fromValues(vb.x, vb.y, vb.z);
        const c = vec3.fromValues(vc.x, vc.y, vc.z);
        const ab = vec3.subtract(vec3.create(), b, a);
        const ac = vec3.subtract(vec3.create(), c, a);
        const normal = vec3.cross(vec3.create(), ab, ac);
        if (vec3.squaredLength(normal) < 0.0001 || Math.abs(normal[1]) < 0.0001)
            continue;
        vec3.normalize(normal, normal);
        if (normal[1] < 0)
            vec3.negate(normal, normal);
        triangles.push({ vertices: [a, b, c], normal });
    }
    return triangles;
}

function findTerrainSurface(grid: TerrainTriangleGrid, x: number, z: number, rayStartY: number): TerrainSurface | null {
    let result: TerrainSurface | null = null;
    for (const triangle of grid.getTrianglesAt(x, z)) {
        const [a, b, c] = triangle.vertices;
        const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(denominator) < 0.0001)
            continue;
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -0.0001 || wb < -0.0001 || wc < -0.0001)
            continue;
        const y = wa * a[1] + wb * b[1] + wc * c[1];
        if (y > rayStartY || (result !== null && y <= result.y))
            continue;
        result = { y, normal: triangle.normal };
    }
    return result;
}

interface PropAnimationNode {
    matrixIndex: number;
    transforms: Float32Array;
    baseMatrix: mat4;
    postMatrix: mat4;
    outputMatrix: mat4;
}

interface PropAnimationTrack {
    nodes: PropAnimationNode[];
    timings: Uint8Array;
    speed: number;
    triggeredPlaybackPositions: Float32Array | null;
    endpointHoldTicks: number;
    framePosition: number;
    lastTick: number;
}

export class PropAnimationState {
    private animationComponent = mat4.create();
    private animationPosition = vec3.create();

    constructor(
        public firstVertex: number,
        private tracks: PropAnimationTrack[],
        private nodesByMatrixIndex: Map<number, PropAnimationNode>,
        public vertexOffsets: Uint32Array,
        private sourcePositions: Float32Array,
        private vertexModelViewMatrixIndices: number[][],
        private initialMatrices: Map<number, mat4>,
        public translationBounds: AABB,
    ) {
    }

    private sample(tick: number): void {
        for (const track of this.tracks) {
            const frameCount = track.timings.length;
            if (track.triggeredPlaybackPositions !== null) {
                const playback = track.triggeredPlaybackPositions;
                const cycleLength = track.endpointHoldTicks * 2 + playback.length;
                let cycleTick = tick % cycleLength;
                if (cycleTick < 0)
                    cycleTick += cycleLength;
                if (cycleTick < track.endpointHoldTicks) {
                    track.framePosition = playback[0];
                } else if (cycleTick < track.endpointHoldTicks + playback.length) {
                    track.framePosition = playback[cycleTick - track.endpointHoldTicks];
                } else {
                    track.framePosition = playback[playback.length - 1];
                }
                track.lastTick = tick;
            } else {
                if (track.lastTick < 0 || tick < track.lastTick) {
                    track.framePosition = 0;
                    track.lastTick = tick;
                }
                for (let animationTick = track.lastTick; animationTick < tick; animationTick++) {
                    const frame = Math.floor(track.framePosition);
                    const t = track.framePosition - frame;
                    // from func_global_asm_806500E0
                    const timing = track.timings[frame]
                        + (track.timings[frame + 1] - track.timings[frame]) * t;
                    track.framePosition += track.speed * timing / 300;
                    track.framePosition %= frameCount - 1;
                    if (track.framePosition < 0)
                        track.framePosition += frameCount - 1;
                }
                track.lastTick = tick;
            }
            for (const node of track.nodes) {
                const frame = Math.min(Math.floor(track.framePosition), frameCount - 2);
                const t = track.framePosition - frame;
                const interpolate = (component: number): number => {
                    const current = node.transforms[frame * 9 + component];
                    return current + (node.transforms[(frame + 1) * 9 + component] - current) * t;
                };
                const interpolateAngle = (component: number): number => {
                    const current = node.transforms[frame * 9 + component];
                    let delta = node.transforms[(frame + 1) * 9 + component] - current;
                    if (delta < -180)
                        delta += 360;
                    else if (delta > 180)
                        delta -= 360;
                    return (current + delta * t) * MathConstants.DEG_TO_RAD;
                };

                mat4.fromScaling(node.outputMatrix, [interpolate(0), interpolate(1), interpolate(2)]);
                mat4.fromZRotation(this.animationComponent, interpolateAngle(5));
                mat4.multiply(node.outputMatrix, this.animationComponent, node.outputMatrix);
                mat4.fromYRotation(this.animationComponent, interpolateAngle(4));
                mat4.multiply(node.outputMatrix, this.animationComponent, node.outputMatrix);
                mat4.fromXRotation(this.animationComponent, interpolateAngle(3));
                mat4.multiply(node.outputMatrix, this.animationComponent, node.outputMatrix);
                mat4.fromTranslation(this.animationComponent, [interpolate(6), interpolate(7), interpolate(8)]);
                mat4.multiply(node.outputMatrix, this.animationComponent, node.outputMatrix);
                // from 8064FB64
                mat4.multiply(node.outputMatrix, node.outputMatrix, node.baseMatrix);
                mat4.multiply(node.outputMatrix, node.postMatrix, node.outputMatrix);
            }
        }
    }

    public update(vertexBufferData: Float32Array, vertexBufferFirstVertex: number, tick: number): void {
        this.sample(tick);
        for (let i = 0; i < this.vertexOffsets.length; i++) {
            const source = i * 3;
            vec3.set(this.animationPosition,
                this.sourcePositions[source + 0],
                this.sourcePositions[source + 1],
                this.sourcePositions[source + 2],
            );
            for (const matrixIndex of this.vertexModelViewMatrixIndices[i]) {
                const matrix = this.nodesByMatrixIndex.get(matrixIndex)?.outputMatrix
                    ?? this.initialMatrices.get(matrixIndex);
                if (matrix !== undefined)
                    vec3.transformMat4(this.animationPosition, this.animationPosition, matrix);
            }
            const vertexIndex = this.firstVertex + this.vertexOffsets[i];
            const target = (vertexIndex - vertexBufferFirstVertex) * 10;
            vertexBufferData[target + 0] = this.animationPosition[0];
            vertexBufferData[target + 1] = this.animationPosition[1];
            vertexBufferData[target + 2] = this.animationPosition[2];
        }
    }
}

function findHighestDetailDisplayListOffset(view: DataView, mainDisplayListStart: number): number {
    let pendingHalf1 = -1;
    for (let offs = mainDisplayListStart; offs < Math.min(view.byteLength, mainDisplayListStart + 0x80); offs += 8) {
        const w0 = view.getUint32(offs, false);
        const w1 = view.getUint32(offs + 4, false);
        const opcode = w0 >>> 24;
        if (opcode === 0xE1)
            pendingHalf1 = w1;
        else if (opcode === 0x04 && (pendingHalf1 >>> 24) === 0x0A)
            return pendingHalf1 & 0x00FFFFFF;
        else if (opcode === 0xDF)
            break;
    }
    return 0;
}

function propDisplayListUsesMatrices(view: DataView, start: number, end: number): boolean {
    for (let offs = start; offs + 8 <= Math.min(view.byteLength, end); offs += 8) {
        if (view.getUint8(offs) === 0xDA)
            return true;
    }
    return false;
}

function isInitialPropScriptBlock(block: InstanceScript['blocks'][number]): boolean {
    return block.conditions.length === 1
        && block.conditions[0].opcode === 1
        && block.conditions[0].args[0] === 0;
}

interface PropAnimationTrackDefinition {
    channel: number;
    speed: number;
    holdEndpoints: boolean;
}

function findPropAnimationTrackDefinitions(scripts: InstanceScript[], propID: number): PropAnimationTrackDefinition[] {
    const script = scripts.find((entry) => entry.id === propID);
    if (script === undefined)
        return [];
    const channelSpeeds = new Map<number, number>();
    const selectedByChannel = new Map<number, PropAnimationTrackDefinition>();
    for (const block of script.blocks) {
        for (const command of block.executions) {
            if (command.opcode === 0x14) {
                channelSpeeds.set(command.args[0], command.args[1]);
            } else if (command.opcode === 0x11) {
                const channel = command.args[0];
                const candidate = {
                    channel,
                    speed: channelSpeeds.get(channel) ?? 1,
                    holdEndpoints: !isInitialPropScriptBlock(block),
                };
                const selected = selectedByChannel.get(channel);
                // from func_global_asm_8064F450 + func_global_asm_80650A04
                // Prefer moving animations, then the slowest magnitude. On a
                // tie, endpoint-holding playback looks closest to the game.
                if (selected === undefined
                    || (selected.speed === 0 && candidate.speed !== 0)
                    || ((selected.speed === 0) === (candidate.speed === 0)
                        && (Math.abs(candidate.speed) < Math.abs(selected.speed)
                            || (Math.abs(candidate.speed) === Math.abs(selected.speed)
                                && candidate.holdEndpoints && !selected.holdEndpoints)))) {
                    selectedByChannel.set(channel, candidate);
                }
            }
        }
    }
    return [...selectedByChannel.values()];
}

function buildTriggeredPlaybackPositions(timings: Uint8Array, speed: number): Float32Array {
    const lastFrame = timings.length - 1;
    if (speed === 0)
        return new Float32Array([0]);
    const forwards = speed >= 0;
    let framePosition = forwards ? 0 : lastFrame;
    const target = forwards ? lastFrame : 0;
    const positions = [framePosition];
    for (let tick = 0; tick < 30 * 60 && (forwards ? framePosition < target : framePosition > target); tick++) {
        const frame = Math.min(Math.floor(framePosition), lastFrame - 1);
        const t = framePosition - frame;
        const timing = timings[frame] + (timings[frame + 1] - timings[frame]) * t;
        const nextFramePosition = framePosition + speed * timing / 300;
        if (forwards ? nextFramePosition <= framePosition : nextFramePosition >= framePosition)
            break;
        framePosition = forwards
            ? Math.min(nextFramePosition, target)
            : Math.max(nextFramePosition, target);
        positions.push(framePosition);
    }
    if (positions[positions.length - 1] !== target)
        positions.push(target);
    return new Float32Array(positions);
}

function applyPropBindPose(
    view: DataView,
    state: RSPState,
    sharedOutput: RSPSharedOutput,
    firstVertex: number,
    vertexCount: number,
): void {
    const matrixData = view.getUint32(0x68, false);
    const matrixBuffer = matrixData + 8;
    const initialMatrixDataSize = view.getUint32(matrixData + 4, false);
    const matrices = new Map<number, mat4>();
    const animationPosition = vec3.create();
    for (let i = 0; i < vertexCount; i++) {
        const vertex = sharedOutput.vertices[firstVertex + i];
        vec3.set(animationPosition, vertex.x, vertex.y, vertex.z);
        // An empty chain does not imply a load of matrix zero.
        const modelViewMatrixIndices = state.vertexModelViewMatrixIndices[firstVertex + i]!;
        for (const matrixIndex of modelViewMatrixIndices) {
            const matrixOffset = matrixIndex * 0x40;
            // from func_global_asm_8064F450
            if (matrixOffset + 0x40 > initialMatrixDataSize)
                continue;
            let matrix = matrices.get(matrixIndex);
            if (matrix === undefined) {
                matrix = mat4.create();
                for (let component = 0; component < 16; component++)
                    matrix[component] = view.getFloat32(matrixBuffer + matrixOffset + component * 4, false);
                matrices.set(matrixIndex, matrix);
            }
            vec3.transformMat4(animationPosition, animationPosition, matrix);
        }
        vertex.x = animationPosition[0];
        vertex.y = animationPosition[1];
        vertex.z = animationPosition[2];
    }
}

function decodePropAnimation(
    view: DataView,
    scripts: InstanceScript[],
    prop: SetupProp,
    state: RSPState,
    sharedOutput: RSPSharedOutput,
    firstVertex: number,
    vertexCount: number,
): Geometry['propAnimation'] {
    const trackDefinitions = findPropAnimationTrackDefinitions(scripts, prop.id);
    if (trackDefinitions.length === 0) {
        // Props with no animation commands are still valid, just static.
        return undefined;
    }

    const animationTable = view.getUint32(0x64, false);
    const matrixData = view.getUint32(0x68, false);
    if (animationTable === matrixData)
        return undefined;
    const matrixBuffer = matrixData + 8;
    const initialMatrixDataSize = view.getUint32(matrixData + 4, false);
    const readMatrix = (offs: number): mat4 => {
        const matrix = mat4.create();
        for (let i = 0; i < 16; i++)
            matrix[i] = view.getFloat32(offs + i * 4, false);
        return matrix;
    };

    const tracks: PropAnimationTrack[] = [];
    const nodesByMatrixIndex = new Map<number, PropAnimationNode>();
    const translationBounds = new AABB(0, 0, 0, 0, 0, 0);
    const translation = vec3.create();
    for (const trackDefinition of trackDefinitions) {
        const channelStart = animationTable + view.getUint32(animationTable + trackDefinition.channel * 4, false);

        const frameCount = view.getUint8(channelStart);
        const nodeCount = view.getUint8(channelStart + 0x39);
        if (nodeCount === 0)
            return undefined;
        const timings = new Uint8Array(frameCount);
        for (let frame = 0; frame < frameCount; frame++)
            timings[frame] = view.getUint8(channelStart + 1 + frame);

        const recordStride = 8 + frameCount * 0x24;
        const nodes: PropAnimationNode[] = [];
        for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
            const record = channelStart + 0x3C + nodeIndex * recordStride;
            const matrixOffset = view.getUint32(record, false);
            const matrixIndex = matrixOffset >>> 6;
            const parentMatrixOffset = view.getUint32(record + 4, false);
            const transforms = new Float32Array(frameCount * 9);
            for (let frame = 0; frame < frameCount; frame++) {
                const transform = record + 8 + frame * 0x24;
                for (let component = 0; component < 9; component++)
                    transforms[frame * 9 + component] = view.getFloat32(transform + component * 4, false);
            }
            const node: PropAnimationNode = {
                matrixIndex,
                transforms,
                baseMatrix: readMatrix(matrixBuffer + parentMatrixOffset),
                postMatrix: readMatrix(matrixBuffer + parentMatrixOffset + 0x40),
                outputMatrix: mat4.create(),
            };
            for (let frame = 0; frame < frameCount; frame++) {
                const i = frame * 9;
                for (let axis = 0; axis < 3; axis++) {
                    translation[axis] = node.postMatrix[axis] * transforms[i + 6]
                        + node.postMatrix[axis + 4] * transforms[i + 7]
                        + node.postMatrix[axis + 8] * transforms[i + 8];
                }
                translationBounds.unionPoint(translation);
            }
            nodes.push(node);
            nodesByMatrixIndex.set(matrixIndex, node);
        }
        const triggeredPlaybackPositions = trackDefinition.holdEndpoints
            ? buildTriggeredPlaybackPositions(timings, trackDefinition.speed)
            : null;
        const animationLengthTicks = triggeredPlaybackPositions === null
            ? 0
            : Math.max(triggeredPlaybackPositions.length - 1, 1);
        tracks.push({
            nodes,
            timings,
            speed: trackDefinition.speed,
            triggeredPlaybackPositions,
            endpointHoldTicks: Math.max(30, animationLengthTicks),
            framePosition: 0,
            lastTick: -1,
        });
    }

    const vertexOffsets: number[] = [];
    const vertexModelViewMatrixIndices: number[][] = [];
    const sourcePositions: number[] = [];
    for (let i = 0; i < vertexCount; i++) {
        const modelViewMatrixIndices = state.vertexModelViewMatrixIndices[firstVertex + i]!;
        if (!modelViewMatrixIndices.some((matrixIndex) => nodesByMatrixIndex.has(matrixIndex)))
            continue;
        const vertex = sharedOutput.vertices[firstVertex + i];
        vertexOffsets.push(i);
        vertexModelViewMatrixIndices.push(modelViewMatrixIndices);
        sourcePositions.push(vertex.x, vertex.y, vertex.z);
    }

    const initialMatrices = new Map<number, mat4>();
    for (let matrixOffset = 0; matrixOffset + 0x40 <= initialMatrixDataSize; matrixOffset += 0x40)
        initialMatrices.set(matrixOffset >>> 6, readMatrix(matrixBuffer + matrixOffset));

    applyPropBindPose(view, state, sharedOutput, firstVertex, vertexCount);
    return new PropAnimationState(
        firstVertex,
        tracks,
        nodesByMatrixIndex,
        new Uint32Array(vertexOffsets),
        new Float32Array(sourcePositions),
        vertexModelViewMatrixIndices,
        initialMatrices,
        translationBounds,
    );
}

interface ProjectedDecalVertex {
    x: number;
    y: number;
    z: number;
    u: number;
    v: number;
}

interface DecalClipVertex {
    x: number;
    z: number;
    u: number;
    v: number;
}

function clipDecalPolygon(polygon: DecalClipVertex[], coordinate: 'u' | 'v', limit: number, keepGreater: boolean): DecalClipVertex[] {
    const output: DecalClipVertex[] = [];
    for (let i = 0; i < polygon.length; i++) {
        const current = polygon[i];
        const previous = polygon[(i + polygon.length - 1) % polygon.length];
        const currentInside = keepGreater ? current[coordinate] >= limit : current[coordinate] <= limit;
        const previousInside = keepGreater ? previous[coordinate] >= limit : previous[coordinate] <= limit;
        if (currentInside !== previousInside) {
            const amount = (limit - previous[coordinate]) / (current[coordinate] - previous[coordinate]);
            output.push({
                x: previous.x + (current.x - previous.x) * amount,
                z: previous.z + (current.z - previous.z) * amount,
                u: previous.u + (current.u - previous.u) * amount,
                v: previous.v + (current.v - previous.v) * amount,
            });
        }
        if (currentInside)
            output.push(current);
    }
    return output;
}

function getTriangleHeight(triangle: TerrainTriangle, x: number, z: number): number {
    const [a] = triangle.vertices;
    return a[1] - (triangle.normal[0] * (x - a[0]) + triangle.normal[2] * (z - a[2])) / triangle.normal[1];
}

function buildProjectedDecalVertices(grid: TerrainTriangleGrid, x: number, y: number, z: number, rayStartY: number, halfWidth: number, halfHeight: number, yaw: number): ProjectedDecalVertex[] {
    const surfaceOffset = 1;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const extentX = Math.abs(cos * halfWidth) + Math.abs(sin * halfHeight);
    const extentZ = Math.abs(sin * halfWidth) + Math.abs(cos * halfHeight);
    const vertices: ProjectedDecalVertex[] = [];
    const projectedTerrain = new Set<string>();

    for (const triangle of grid.getTrianglesInBounds(x - extentX, z - extentZ, x + extentX, z + extentZ)) {
        const triangleKey = triangle.vertices
            .map((vertex) => `${vertex[0]},${vertex[1]},${vertex[2]}`)
            .sort()
            .join('/');
        if (projectedTerrain.has(triangleKey))
            continue;
        projectedTerrain.add(triangleKey);

        let polygon: DecalClipVertex[] = triangle.vertices.map((vertex) => {
            const dx = vertex[0] - x;
            const dz = vertex[2] - z;
            return {
                x: vertex[0],
                z: vertex[2],
                u: dx * cos - dz * sin,
                v: dx * sin + dz * cos,
            };
        });
        polygon = clipDecalPolygon(polygon, 'u', -halfWidth, true);
        polygon = clipDecalPolygon(polygon, 'u', halfWidth, false);
        polygon = clipDecalPolygon(polygon, 'v', -halfHeight, true);
        polygon = clipDecalPolygon(polygon, 'v', halfHeight, false);
        if (polygon.length < 3)
            continue;

        const centroidX = polygon.reduce((sum, vertex) => sum + vertex.x, 0) / polygon.length;
        const centroidZ = polygon.reduce((sum, vertex) => sum + vertex.z, 0) / polygon.length;
        const surface = findTerrainSurface(grid, centroidX, centroidZ, rayStartY);
        const triangleY = getTriangleHeight(triangle, centroidX, centroidZ);
        if (surface === null || Math.abs(surface.y - triangleY) > 0.5)
            continue;

        for (let i = 1; i + 1 < polygon.length; i++) {
            for (const vertex of [polygon[0], polygon[i], polygon[i + 1]]) {
                vertices.push({
                    x: vertex.x - x,
                    y: getTriangleHeight(triangle, vertex.x, vertex.z) + surfaceOffset - y,
                    z: vertex.z - z,
                    u: vertex.u / (halfWidth * 2) + 0.5,
                    v: vertex.v / (halfHeight * 2) + 0.5,
                });
            }
        }
    }
    return vertices;
}

function createPropDecalVertexBuffer(vertices: readonly ProjectedDecalVertex[], textureWidth: number, textureHeight: number): ArrayBufferSlice {
    const buffer = new ArrayBuffer(vertices.length * 0x10);
    const view = new DataView(buffer);
    const weldedHeights = new Map<string, number>();
    for (let i = 0; i < vertices.length; i++) {
        const vertex = vertices[i];
        const offs = i * 0x10;
        const x = Math.round(vertex.x);
        const z = Math.round(vertex.z);
        const s = Math.round(vertex.u * textureWidth * 0x20);
        const t = Math.round(vertex.v * textureHeight * 0x20);
        const weldKey = `${x},${z},${s},${t}`;
        let y = weldedHeights.get(weldKey);
        if (y === undefined) {
            y = Math.round(vertex.y);
            weldedHeights.set(weldKey, y);
        }
        view.setInt16(offs + 0x00, x);
        view.setInt16(offs + 0x02, y);
        view.setInt16(offs + 0x04, z);
        view.setInt16(offs + 0x08, s);
        view.setInt16(offs + 0x0A, t);
        view.setUint8(offs + 0x0C, 0xFF);
        view.setUint8(offs + 0x0D, 0xFF);
        view.setUint8(offs + 0x0E, 0xFF);
        view.setUint8(offs + 0x0F, 0xFF);
    }
    return new ArrayBufferSlice(buffer);
}

function parseModel2IndexedTextures(geometryView: DataView, romData: ROMData): AnimatedTexture[] {
    // from func_global_asm_806349FC + func_global_asm_80636EFC + func_global_asm_80639CD0
    const descriptorStart = geometryView.getUint32(0x6C, false);
    const descriptorCount = geometryView.getUint32(descriptorStart, false);
    const textures: AnimatedTexture[] = [];
    for (let i = 0; i < descriptorCount; i++) {
        const offs = descriptorStart + 4 + i * 0x84;
        const targetTextureID = geometryView.getUint32(offs + 0x00, false);
        const crossfade = geometryView.getUint32(offs + 0x04, false);
        const frameDuration = geometryView.getUint32(offs + 0x08, false);
        const frameCount = geometryView.getUint32(offs + 0x0C, false);
        const frames: ArrayBufferSlice[] = [];
        for (let frame = 0; frame < frameCount; frame++) {
            const textureID = frame === 0
                ? targetTextureID
                : geometryView.getUint32(offs + 0x0C + frame * 4, false);
            frames.push(romData.AnimTexData[textureID]!);
        }
        // from func_global_asm_806349FC
        textures.push({
            segment: 0,
            group: targetTextureID,
            frameDuration,
            crossfade: crossfade !== 0,
            frames,
        });
    }
    return textures;
}

function applyInitialModel2TextureScripts(textures: AnimatedTexture[], scripts: InstanceScript[], propID: number): AnimatedTexture[] {
    const script = scripts.find((entry) => entry.id === propID);
    if (script === undefined || textures.length === 0)
        return textures;

    // from func_global_asm_806349FC
    const playbackModes = textures.map(() => 1);
    const selectedFrames = textures.map(() => 0);
    for (const block of script.blocks) {
        // These are init scripts. Blocks that set new states are transitions.
        if (block.conditions.length !== 1
            || block.conditions[0].opcode !== 1
            || block.conditions[0].args[0] !== 0
            || block.executions.some((command) => command.opcode === 1))
            continue;

        for (const command of block.executions) {
            const textureIndex = command.args[0] - 1;
            if (command.opcode === 0x27) {
                // from func_global_asm_80634EA4
                playbackModes[textureIndex] = command.args[1];
            } else if (command.opcode === 0x28) {
                // from func_global_asm_80635018
                selectedFrames[textureIndex] = command.args[1];
            }
        }
    }

    return textures.map((texture, index) => {
        if (playbackModes[index] !== 0 || texture.crossfade)
            return texture;
        const selectedFrame = selectedFrames[index];
        return {
            ...texture,
            frameDuration: 0,
            frameOffset: 0,
            frames: [texture.frames[selectedFrame]],
        };
    });
}

function addModel2PropDecals(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, geometryView: DataView, instances: SetupProp[], terrainGrid: TerrainTriangleGrid, worldScale: number): void {
    const textureID = geometryView.getUint16(0x28, false);
    if (textureID === 0xFFFF)
        return;

    const halfWidth = geometryView.getInt16(0x2E, false);
    const halfHeight = geometryView.getInt16(0x30, false);
    const textureWidth = geometryView.getUint8(0x32) || 0x100;
    const textureHeight = geometryView.getUint8(0x33) || 0x100;
    const format = geometryView.getUint8(0x34) & 0x07;
    const size = geometryView.getUint8(0x35);
    const alpha = geometryView.getUint8(0x38);
    const fadeStartDistance = geometryView.getUint8(0x36) * 10 * worldScale;
    const fadeEndDistance = geometryView.getUint8(0x37) * 10 * worldScale;
    if (halfWidth <= 0 || halfHeight <= 0 || size > ImageSize.G_IM_SIZ_32b || romData.TexData[textureID] === undefined)
        return;

    const bitsPerPixel = 4 << size;
    const loadCount = Math.min(0x07FF, Math.ceil(textureWidth * textureHeight * bitsPerPixel / 16) - 1);
    const line = Math.max(1, Math.ceil(textureWidth * bitsPerPixel / 64));
    const dxt = Math.max(1, Math.ceil(0x0800 / line));
    const maskS = Math.ceil(Math.log2(textureWidth));
    const maskT = Math.ceil(Math.log2(textureHeight));
    const decalTexture: AnimatedTexture[] = [{
        segment: 0x0E,
        group: textureID,
        frameDuration: 0,
        frames: [romData.TexData[textureID]],
    }];
    const loadSize = size === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;
    for (const prop of instances) {
        const worldX = prop.position[0] * worldScale;
        const worldY = prop.position[1] * worldScale;
        const worldZ = prop.position[2] * worldScale;
        const yaw = prop.rotation[1] * MathConstants.DEG_TO_RAD;
        const projectedVertices = buildProjectedDecalVertices(
            terrainGrid,
            worldX,
            worldY,
            worldZ,
            worldY + 20 * worldScale,
            halfWidth * prop.scale * worldScale,
            halfHeight * prop.scale * worldScale,
            yaw,
        );
        if (projectedVertices.length === 0)
            continue;

        const segmentBuffers: ArrayBufferSlice[] = [];
        segmentBuffers[0x08] = createPropDecalVertexBuffer(projectedVertices, textureWidth, textureHeight);
        const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, decalTexture);
        initDL(state, false);
        state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
        state.gSPClearGeometryMode(0xFFFFFFFF);
        state.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
        state.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
        state.gDPSetOtherModeL(0, 29, 0x00504DD8);
        state.gDPSetCombine(0x00119623, 0xFF2FFFFF);
        state.gSPSetPrimColor(0, 0x00, 0x00, 0x00, alpha);
        state.gDPSetTextureImage(format, loadSize, 1, 0x0E000000);
        state.gDPSetTile(format, loadSize, 0, 0, 7, 0, 0, maskT, 0, 0, maskS, 0);
        state.gDPLoadBlock(7, 0, 0, loadCount, dxt);
        state.gDPSetTile(format, size, line, 0, 0, 0, 0, maskT, 0, 0, maskS, 0);
        state.gDPSetTileSize(0, 0, 0, (textureWidth - 1) << 2, (textureHeight - 1) << 2);
        for (let vertexBase = 0; vertexBase < projectedVertices.length; vertexBase += 30) {
            const vertexCount = Math.min(30, projectedVertices.length - vertexBase);
            state.gSPVertex(0x08000000 + vertexBase * 0x10, vertexCount, 0);
            for (let vertex = 0; vertex + 2 < vertexCount; vertex += 3)
                state.gSPTri(vertex, vertex + 1, vertex + 2);
        }
        const output = state.finish()!;

        const geo: Geometry = { sharedOutput, rspOutput: output };
        const geoData = sceneRenderer.addGeoData(device, cache, geo);
        const renderer = sceneRenderer.addPropRenderer(device, cache, geoData);
        renderer.modelMatrix[12] = worldX;
        renderer.modelMatrix[13] = worldY;
        renderer.modelMatrix[14] = worldZ;
        renderer.setCullBoundingBox(renderer.computeWorldBoundingBox());
        if (fadeEndDistance > fadeStartDistance) {
            renderer.distanceFade = {
                origin: vec3.fromValues(worldX, worldY, worldZ),
                startDistance: fadeStartDistance,
                endDistance: fadeEndDistance,
            };
        }
    }
}

interface RuntimePropQuad {
    textureID: number;
    paletteID: number;
    x: number[];
    y: number[];
    z: number[];
    s: number[];
    t: number[];
    width: number;
    height: number;
    size: ImageSize;
    format: ImageFormat;
}

function parseRuntimePropQuads(view: DataView): RuntimePropQuad[] {
    const tableStart = view.getUint32(0x70, false);
    const count = view.getUint32(tableStart, false);

    const quads: RuntimePropQuad[] = [];
    for (let i = 0; i < count; i++) {
        const offs = tableStart + 4 + i * 0x30;
        quads.push({
            textureID: view.getUint16(offs + 0x00, false),
            paletteID: view.getUint16(offs + 0x02, false),
            x: nArray(4, (j) => view.getInt16(offs + 0x04 + j * 2, false)),
            y: nArray(4, (j) => view.getInt16(offs + 0x0C + j * 2, false)),
            z: nArray(4, (j) => view.getInt16(offs + 0x14 + j * 2, false)),
            s: nArray(4, (j) => view.getInt16(offs + 0x1C + j * 4, false)),
            t: nArray(4, (j) => view.getInt16(offs + 0x1E + j * 4, false)),
            width: view.getUint8(offs + 0x2C),
            height: view.getUint8(offs + 0x2D),
            size: view.getUint8(offs + 0x2E) as ImageSize,
            format: view.getUint8(offs + 0x2F) as ImageFormat,
        });
    }
    return quads;
}

function createRuntimePropVertexBuffer(quad: RuntimePropQuad): ArrayBufferSlice {
    const buffer = new ArrayBuffer(4 * 0x10);
    const view = new DataView(buffer);
    for (let i = 0; i < 4; i++) {
        const offs = i * 0x10;
        view.setInt16(offs + 0x00, quad.x[i]);
        view.setInt16(offs + 0x02, quad.y[i]);
        view.setInt16(offs + 0x04, quad.z[i]);
        view.setInt16(offs + 0x08, quad.s[i]);
        view.setInt16(offs + 0x0A, quad.t[i]);
        view.setUint8(offs + 0x0C, 0xFF);
        view.setUint8(offs + 0x0D, 0xFF);
        view.setUint8(offs + 0x0E, 0xFF);
        view.setUint8(offs + 0x0F, 0xFF);
    }
    return new ArrayBufferSlice(buffer);
}

function initRuntimePropMaterial(state: RSPState, quad: RuntimePropQuad): void {
    const bitsPerPixel = 4 << quad.size;
    const loadCount = Math.min(0x07FF, Math.ceil(quad.width * quad.height * bitsPerPixel / 16) - 1);
    const line = Math.max(1, Math.ceil(quad.width * bitsPerPixel / 64));
    const dxt = Math.max(1, Math.ceil(0x0800 / line));
    const maskS = Math.ceil(Math.log2(quad.width));
    const maskT = Math.ceil(Math.log2(quad.height));

    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    state.gSPClearGeometryMode(0xFFFFFFFF);
    state.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    state.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    // from func_global_asm_80637B6C
    state.gDPSetOtherModeL(0, 29, 0x0C184A50);
    state.gDPSetCombine(0x00119623, 0xFF2FFFFF); // G_CC_MODULATEIA_PRIM
    state.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);

    const indexed = quad.format === ImageFormat.G_IM_FMT_CI;
    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLUT, 2, indexed ? 0x8000 : 0);
    if (indexed) {
        state.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, quad.paletteID);
        state.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 7, 0, 0, 0, 0, 0, 0, 0);
        state.gDPLoadTLUT(7, quad.size === ImageSize.G_IM_SIZ_4b ? 15 : 255);
    }

    const loadSize = quad.size === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;
    state.gDPSetTextureImage(quad.format, loadSize, 1, quad.textureID);
    state.gDPSetTile(quad.format, loadSize, 0, 0, 7, 0, 0, maskT, 0, 0, maskS, 0);
    state.gDPLoadBlock(7, 0, 0, loadCount, dxt);
    state.gDPSetTile(quad.format, quad.size, line, 0, 0, 0, TexCM.CLAMP, maskT, 0, TexCM.CLAMP, maskS, 0);
    state.gDPSetTileSize(0, 0, 0, (quad.width - 1) << 2, (quad.height - 1) << 2);
}

function addRuntimeModel2Props(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, view: DataView, instances: SetupProp[], worldScale: number, lightingEnvironment: ObjectLightingEnvironment): void {
    const indexedTextures = parseModel2IndexedTextures(view, romData);
    for (const quad of parseRuntimePropQuads(view)) {
        if (quad.width === 0 || quad.height === 0 || quad.size > ImageSize.G_IM_SIZ_32b)
            continue;

        const segmentBuffers: ArrayBufferSlice[] = [];
        segmentBuffers[0x08] = createRuntimePropVertexBuffer(quad);
        const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, indexedTextures);
        initRuntimePropMaterial(state, quad);
        state.gSPVertex(0x08000000, 4, 0);
        state.gSPTri(0, 1, 2);
        state.gSPTri(0, 2, 3);
        const output = state.finish()!;

        // Share draw resources between instances of props.
        const geo: Geometry = { sharedOutput, rspOutput: output };
        const geoData = sceneRenderer.addGeoData(device, cache, geo);
        let sharedRenderer: GeometryRenderer | null = null;
        for (const prop of instances) {
            const scale = prop.scale * worldScale;
            const origin = vec3.fromValues(
                prop.position[0] * worldScale,
                prop.position[1] * worldScale,
                prop.position[2] * worldScale,
            );
            const renderer = sceneRenderer.addPropRenderer(device, cache, geoData, sharedRenderer);
            if (sharedRenderer === null)
                sharedRenderer = renderer;
            renderer.setCameraBillboard(origin, scale);
            renderer.setCullBoundingBox(computeBillboardBoundingBox(
                origin,
                quad.x.map((x) => x * scale),
                quad.y.map((y) => y * scale),
                quad.z.map((z) => z * scale),
            ));
            if (view.getUint8(0x1D) === 0)
                renderer.setObjectLighting(buildObjectLighting(lightingEnvironment, origin));
            renderer.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            renderer.setBackfaceCullingEnabled(false);
        }
    }
}

export function addModel2Props(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, props: readonly SetupProp[], scripts: InstanceScript[], terrainTriangles: TerrainTriangle[], worldScale: number, fogEnabled: boolean, lightingEnvironment: ObjectLightingEnvironment): void {
    if (props.length === 0 || romData.PropGeometryData.size === 0)
        return;

    const propsByType = new Map<number, SetupProp[]>();
    const terrainGrid = new TerrainTriangleGrid(terrainTriangles);
    for (const prop of props) {
        if (!propsByType.has(prop.type))
            propsByType.set(prop.type, []);
        propsByType.get(prop.type)!.push(prop);
    }

    for (const [propType, instances] of propsByType) {
        // from func_global_asm_80636FFC: ignore these object types
        if (propType === 0x0000 || propType === 0x0241)
            continue;
        const geometryBuffer = romData.loadPropGeometry(propType);
        const view = geometryBuffer.createDataView();
        addModel2PropDecals(device, cache, sceneRenderer, sharedOutput, romData, view, instances, terrainGrid, worldScale);
        if (view.getUint8(0x1C) === 2) {
            addRuntimeModel2Props(device, cache, sceneRenderer, sharedOutput, romData, view, instances, worldScale, lightingEnvironment);
            continue;
        }
        if (view.getUint8(0x1C) !== 1)
            continue;

        // Layout 1: F3DEX2 displaylist + segment8 verts.
        const mainDisplayListStart = view.getUint32(0x40, false);
        const secondaryDisplayListStart = view.getUint32(0x44, false);
        const vertexStart = view.getUint32(0x48, false);
        const usesRuntimeMatrices = propDisplayListUsesMatrices(view, mainDisplayListStart, secondaryDisplayListStart);
        const segmentBuffers: ArrayBufferSlice[] = [];
        segmentBuffers[0x08] = geometryBuffer.slice(vertexStart);
        segmentBuffers[0x0A] = geometryBuffer.slice(mainDisplayListStart);
        segmentBuffers[0x0F] = geometryBuffer;

        const indexedTextures = applyInitialModel2TextureScripts(
            parseModel2IndexedTextures(view, romData),
            scripts,
            instances[0].id,
        );
        const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, indexedTextures);
        initDL(state, true, fogEnabled);
        // from func_global_asm_80636FFC -- basic inheritd state for props.
        state.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);
        // TODO: maybe handle LODs with G_BRANCH_Z instead of always using highest?
        const displayListOffset = findHighestDetailDisplayListOffset(view, mainDisplayListStart);
        const firstVertex = sharedOutput.vertices.length;
        runDL_F3DEX2(state, 0x0A000000 | displayListOffset);
        runDL_F3DEX2(state, 0x0F000000 | secondaryDisplayListStart);
        const output = state.finish()!;

        const vertexCount = sharedOutput.vertices.length - firstVertex;
        const propAnimation = usesRuntimeMatrices
            ? decodePropAnimation(view, scripts, instances[0], state, sharedOutput, firstVertex, vertexCount)
            : undefined;
        if (usesRuntimeMatrices && propAnimation === undefined)
            applyPropBindPose(view, state, sharedOutput, firstVertex, vertexCount);
        const geo: Geometry = { sharedOutput, rspOutput: output, propAnimation };
        const geoData = sceneRenderer.addGeoData(device, cache, geo);
        for (const prop of instances) {
            const renderer = sceneRenderer.addPropRenderer(device, cache, geoData);
            const origin = vec3.fromValues(
                prop.position[0] * worldScale,
                prop.position[1] * worldScale,
                prop.position[2] * worldScale,
            );
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [
                origin[0],
                origin[1],
                origin[2],
            ]);
            mat4.rotateX(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[0] * MathConstants.DEG_TO_RAD);
            mat4.rotateY(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[1] * MathConstants.DEG_TO_RAD);
            mat4.rotateZ(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[2] * MathConstants.DEG_TO_RAD);
            mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [
                prop.scale * worldScale,
                prop.scale * worldScale,
                prop.scale * worldScale,
            ]);
            // from func_global_asm_80636FFC: self-lit objects have a flag to opt out of dynamic lighting.
            if (view.getUint8(0x1D) === 0)
                renderer.setObjectLighting(buildObjectLighting(lightingEnvironment, origin));
            renderer.setCullBoundingBox(renderer.computeWorldBoundingBox());
        }
    }
}
