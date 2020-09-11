import { mat4, vec3 } from 'gl-matrix';
import { nArray } from '../../util';

import { mat4PostTranslate } from './util';

interface Joint {
    parent?: number;
    translation: vec3;
}

// Skeleton template to create instances
export class Skeleton {
    public joints: Joint[] = [];

    public addJoint(parent: number | undefined, translation: vec3) {
        if ((parent === undefined && this.joints.length > 0) ||
            (parent !== undefined && parent > this.joints.length))
        {
            throw Error(`Invalid joint hierarchy in skeleton`);
        }

        this.joints.push({parent, translation: vec3.clone(translation)});
    }
}

export class SkeletonInstance {
    private poseMatrices: mat4[] = []; // poses in joint-local space

    private jointMatrices: mat4[] = []; // joint-local space to model space
    private dirty: boolean = true;

    constructor(private skeleton: Skeleton) {
        this.poseMatrices = nArray(this.skeleton.joints.length, () => mat4.create());
        this.jointMatrices = nArray(this.skeleton.joints.length, () => mat4.create());
        this.dirty = true;
    }

    public setPoseMatrix(num: number, m: mat4) {
        mat4.copy(this.poseMatrices[num], m);
        this.dirty = true;
    }

    public getJointMatrix(num: number) {
        this.updateJointMatrices();
        return this.jointMatrices[num];
    }

    private updateJointMatrices() {
        if (!this.dirty)
            return;

        for (let i = 0; i < this.skeleton.joints.length; i++) {
            const joint = this.skeleton.joints[i];
            const dst = this.jointMatrices[i];

            mat4.copy(dst, this.poseMatrices[i]);
            mat4PostTranslate(dst, joint.translation);
            if (joint.parent !== undefined) {
                mat4.mul(dst, this.jointMatrices[joint.parent], dst);
            }
        }

        this.dirty = false;
    }
}