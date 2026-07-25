import { mat4 } from 'gl-matrix';
import type { ReadonlyMat4, ReadonlyVec3 } from 'gl-matrix';

import type { RSPSharedOutput } from '../BanjoKazooie/f3dex.js';
import { AABB } from '../Geometry.js';
import type { RSPOutput } from './f3dex2.js';

interface RootTransformCullAnimation {
    baseMatrix: ReadonlyMat4;
    rotationYRadiansPerTick: number;
    positionYAmplitude: number;
}

function computeDisplayListBoundingBox(sharedOutput: RSPSharedOutput, output: RSPOutput): AABB | null {
    const boundingBox = new AABB();
    let hasVertices = false;
    for (const drawCall of output.drawCalls) {
        const indexEnd = drawCall.firstIndex + drawCall.indexCount;
        for (let index = drawCall.firstIndex; index < indexEnd; index++) {
            const vertex = sharedOutput.vertices[sharedOutput.indices[index]];
            boundingBox.min[0] = Math.min(boundingBox.min[0], vertex.x);
            boundingBox.min[1] = Math.min(boundingBox.min[1], vertex.y);
            boundingBox.min[2] = Math.min(boundingBox.min[2], vertex.z);
            boundingBox.max[0] = Math.max(boundingBox.max[0], vertex.x);
            boundingBox.max[1] = Math.max(boundingBox.max[1], vertex.y);
            boundingBox.max[2] = Math.max(boundingBox.max[2], vertex.z);
            hasVertices = true;
        }
    }
    return hasVertices ? boundingBox : null;
}

export function computeBillboardBoundingBox(
    origin: ReadonlyVec3,
    rightOffsets: readonly number[],
    upOffsets: readonly number[],
    forwardOffsets: readonly number[],
): AABB {
    let radius = 0;
    for (let i = 0; i < rightOffsets.length; i++)
        radius = Math.max(radius, Math.hypot(rightOffsets[i], upOffsets[i], forwardOffsets[i]));
    return new AABB(
        origin[0] - radius,
        origin[1] - radius,
        origin[2] - radius,
        origin[0] + radius,
        origin[1] + radius,
        origin[2] + radius,
    );
}

interface MatrixAnimationCullNode {
    transforms: Float32Array;
    baseMatrix: ReadonlyMat4;
    postMatrix: ReadonlyMat4;
    outputMatrix: mat4;
}

interface MatrixAnimationCullTrack {
    nodes: readonly MatrixAnimationCullNode[];
    speed: number;
    triggeredPlaybackPositions: Float32Array | null;
    endpointHoldTicks: number;
    framePosition: number;
    lastTick: number;
}

interface MatrixAnimationCullData {
    tracks: readonly MatrixAnimationCullTrack[];
    sourcePositions: Float32Array;
    vertexMatrixChains: readonly (readonly number[])[];
    nodesByMatrixIndex: ReadonlyMap<number, MatrixAnimationCullNode>;
    initialMatrices: ReadonlyMap<number, ReadonlyMat4>;
}

function computeConservativeMatrixAnimationBoundingBox(animation: MatrixAnimationCullData): AABB {
    const boundingBox = new AABB();
    for (let i = 0; i < animation.sourcePositions.length / 3; i++) {
        const source = i * 3;
        let vertexBounds = new AABB(
            animation.sourcePositions[source + 0],
            animation.sourcePositions[source + 1],
            animation.sourcePositions[source + 2],
            animation.sourcePositions[source + 0],
            animation.sourcePositions[source + 1],
            animation.sourcePositions[source + 2],
        );
        for (const matrixIndex of animation.vertexMatrixChains[i]) {
            const node = animation.nodesByMatrixIndex.get(matrixIndex);
            if (node === undefined) {
                const matrix = animation.initialMatrices.get(matrixIndex);
                if (matrix !== undefined) {
                    const transformed = new AABB();
                    transformed.transform(vertexBounds, matrix);
                    vertexBounds = transformed;
                }
                continue;
            }

            const baseBounds = new AABB();
            baseBounds.transform(vertexBounds, node.baseMatrix);
            let radiusSquared = 0;
            for (let axis = 0; axis < 3; axis++) {
                let maxScale = 0;
                for (let frame = 0; frame < node.transforms.length / 9; frame++)
                    maxScale = Math.max(maxScale, Math.abs(node.transforms[frame * 9 + axis]));
                const maxCoordinate = Math.max(Math.abs(baseBounds.min[axis]), Math.abs(baseBounds.max[axis]));
                radiusSquared += (maxCoordinate * maxScale) ** 2;
            }
            const radius = Math.sqrt(radiusSquared);
            const translationMin = [Infinity, Infinity, Infinity];
            const translationMax = [-Infinity, -Infinity, -Infinity];
            for (let frame = 0; frame < node.transforms.length / 9; frame++) {
                for (let axis = 0; axis < 3; axis++) {
                    const translation = node.transforms[frame * 9 + 6 + axis];
                    translationMin[axis] = Math.min(translationMin[axis], translation);
                    translationMax[axis] = Math.max(translationMax[axis], translation);
                }
            }
            const animatedBounds = new AABB(
                translationMin[0] - radius,
                translationMin[1] - radius,
                translationMin[2] - radius,
                translationMax[0] + radius,
                translationMax[1] + radius,
                translationMax[2] + radius,
            );
            vertexBounds = new AABB();
            vertexBounds.transform(animatedBounds, node.postMatrix);
        }
        boundingBox.union(boundingBox, vertexBounds);
    }
    return boundingBox;
}

function combineAnimationCycleTicks(trackCycles: readonly (number | null)[], maxCycleTicks: number): number | null {
    let cycleTicks = 1;
    for (const trackCycleTicks of trackCycles) {
        if (trackCycleTicks === null)
            return null;
        let a = cycleTicks, b = trackCycleTicks;
        while (b !== 0)
            [a, b] = [b, a % b];
        cycleTicks = cycleTicks / a * trackCycleTicks;
        if (cycleTicks > maxCycleTicks)
            return null;
    }
    return cycleTicks;
}

export function computeMatrixAnimationBoundingBox(
    animation: MatrixAnimationCullData,
    sampleAnimation: (tick: number) => void,
    forEachVertexPosition: (callback: (position: ReadonlyVec3) => void) => void,
): AABB {
    const cycleTicks = combineAnimationCycleTicks(animation.tracks.map((track) => {
        if (track.triggeredPlaybackPositions !== null)
            return track.endpointHoldTicks * 2 + track.triggeredPlaybackPositions.length;
        return track.speed === 0 ? 1 : null;
    }), 30 * 60 * 2);
    if (cycleTicks === null)
        return computeConservativeMatrixAnimationBoundingBox(animation);

    const savedTrackStates = animation.tracks.map((track) => ({
        framePosition: track.framePosition,
        lastTick: track.lastTick,
    }));
    const savedNodeMatrices = animation.tracks.flatMap((track) =>
        track.nodes.map((node) => mat4.clone(node.outputMatrix)),
    );
    const boundingBox = new AABB();
    for (let tick = 0; tick < cycleTicks; tick++) {
        sampleAnimation(tick);
        forEachVertexPosition((position) => boundingBox.unionPoint(position));
    }

    let matrixIndex = 0;
    for (let trackIndex = 0; trackIndex < animation.tracks.length; trackIndex++) {
        const track = animation.tracks[trackIndex];
        track.framePosition = savedTrackStates[trackIndex].framePosition;
        track.lastTick = savedTrackStates[trackIndex].lastTick;
        for (const node of track.nodes)
            mat4.copy(node.outputMatrix, savedNodeMatrices[matrixIndex++]);
    }
    return boundingBox;
}

export class MeshBounds {
    private localBoundingBox: AABB | null | undefined;

    constructor(
        private sharedOutput: RSPSharedOutput,
        private output: RSPOutput | null,
        private animationBoundingBoxes: readonly (AABB | undefined)[],
    ) {
    }

    public getLocal(): AABB | null {
        if (this.localBoundingBox === undefined) {
            this.localBoundingBox = this.output === null
                ? null
                : computeDisplayListBoundingBox(this.sharedOutput, this.output);
            if (this.localBoundingBox !== null) {
                for (const boundingBox of this.animationBoundingBoxes) {
                    if (boundingBox !== undefined)
                        this.localBoundingBox.union(this.localBoundingBox, boundingBox);
                }
            }
        }
        return this.localBoundingBox;
    }

    public computeWorld(modelMatrix: ReadonlyMat4, rootAnimation: RootTransformCullAnimation | null): AABB | null {
        const sourceBoundingBox = this.getLocal();
        if (sourceBoundingBox === null)
            return null;
        const localBoundingBox = sourceBoundingBox.clone();
        const worldBoundingBox = new AABB();
        if (rootAnimation === null) {
            worldBoundingBox.transform(localBoundingBox, modelMatrix);
        } else {
            if (rootAnimation.rotationYRadiansPerTick !== 0) {
                const radiusXZ = Math.hypot(
                    Math.max(Math.abs(localBoundingBox.min[0]), Math.abs(localBoundingBox.max[0])),
                    Math.max(Math.abs(localBoundingBox.min[2]), Math.abs(localBoundingBox.max[2])),
                );
                localBoundingBox.set(
                    -radiusXZ, localBoundingBox.min[1], -radiusXZ,
                    radiusXZ, localBoundingBox.max[1], radiusXZ,
                );
            }
            worldBoundingBox.transform(localBoundingBox, rootAnimation.baseMatrix);
            worldBoundingBox.min[1] -= Math.abs(rootAnimation.positionYAmplitude);
            worldBoundingBox.max[1] += Math.abs(rootAnimation.positionYAmplitude);
        }
        return worldBoundingBox;
    }
}

export function computeSkeletalAnimationBoundingBox(
    sourcePositions: Float32Array,
    boneIndices: Uint8Array,
    boneOffsets: readonly ReadonlyVec3[],
    boneParents: readonly number[],
): AABB {
    let boundingRadius = 0;
    for (let i = 0; i < sourcePositions.length / 3; i++) {
        let radius = Math.hypot(
            sourcePositions[i * 3 + 0],
            sourcePositions[i * 3 + 1],
            sourcePositions[i * 3 + 2],
        );
        let bone = Math.min(boneIndices[i], boneOffsets.length - 1);
        for (let depth = 0; bone >= 0 && depth < boneOffsets.length; depth++) {
            const offset = boneOffsets[bone];
            radius += Math.hypot(offset[0], offset[1], offset[2]);
            bone = boneParents[bone];
        }
        boundingRadius = Math.max(boundingRadius, radius);
    }
    return new AABB(
        -boundingRadius, -boundingRadius, -boundingRadius,
        boundingRadius, boundingRadius, boundingRadius,
    );
}
