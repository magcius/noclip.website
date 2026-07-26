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

export class MeshBounds {
    private localBoundingBox: AABB | null | undefined;

    constructor(
        private sharedOutput: RSPSharedOutput,
        private output: RSPOutput | null,
        private animationBoundingBox: AABB | undefined,
        private animationTranslationBounds: AABB | undefined,
        private paddingRatio: number,
    ) {
    }

    public getLocal(): AABB | null {
        if (this.localBoundingBox === undefined) {
            this.localBoundingBox = this.output === null
                ? null
                : computeDisplayListBoundingBox(this.sharedOutput, this.output);
            if (this.localBoundingBox !== null) {
                if (this.animationBoundingBox !== undefined)
                    this.localBoundingBox.union(this.localBoundingBox, this.animationBoundingBox);
                if (this.animationTranslationBounds !== undefined) {
                    for (let axis = 0; axis < 3; axis++) {
                        this.localBoundingBox.min[axis] += this.animationTranslationBounds.min[axis];
                        this.localBoundingBox.max[axis] += this.animationTranslationBounds.max[axis];
                    }
                }
                const padding = Math.max(
                    this.localBoundingBox.max[0] - this.localBoundingBox.min[0],
                    this.localBoundingBox.max[1] - this.localBoundingBox.min[1],
                    this.localBoundingBox.max[2] - this.localBoundingBox.min[2],
                ) * this.paddingRatio;
                for (let axis = 0; axis < 3; axis++) {
                    this.localBoundingBox.min[axis] -= padding;
                    this.localBoundingBox.max[axis] += padding;
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
