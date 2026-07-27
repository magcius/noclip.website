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
        }
    }
    return boundingBox.min[0] <= boundingBox.max[0] ? boundingBox : null;
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

export class GeometryBounds {
    private localBoundingBox: AABB | null;

    constructor(
        sharedOutput: RSPSharedOutput,
        output: RSPOutput | null,
        animationBoundingBox: AABB | undefined,
        animationTranslationBounds: AABB | undefined,
        paddingRatio: number,
    ) {
        this.localBoundingBox = output === null
            ? null
            : computeDisplayListBoundingBox(sharedOutput, output);
        if (this.localBoundingBox !== null) {
            if (animationBoundingBox !== undefined)
                this.localBoundingBox.union(this.localBoundingBox, animationBoundingBox);
            if (animationTranslationBounds !== undefined) {
                for (let axis = 0; axis < 3; axis++) {
                    this.localBoundingBox.min[axis] += animationTranslationBounds.min[axis];
                    this.localBoundingBox.max[axis] += animationTranslationBounds.max[axis];
                }
            }
            const padding = Math.max(
                this.localBoundingBox.max[0] - this.localBoundingBox.min[0],
                this.localBoundingBox.max[1] - this.localBoundingBox.min[1],
                this.localBoundingBox.max[2] - this.localBoundingBox.min[2],
            ) * paddingRatio;
            for (let axis = 0; axis < 3; axis++) {
                this.localBoundingBox.min[axis] -= padding;
                this.localBoundingBox.max[axis] += padding;
            }
        }
    }

    public getLocal(): AABB | null {
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
