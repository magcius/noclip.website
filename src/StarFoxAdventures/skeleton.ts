import { mat4, vec3 } from 'gl-matrix';
import { nArray } from '../util';

import { mat4PostTranslate } from './util';

export interface Joint {
    parent?: number;
    translation: vec3;
}

export class Skeleton {
    private poseMatrices: mat4[] = []; // poses in joint-local space

    private jointMatrices: mat4[] = []; // joint-local space to model space
    private dirty: boolean = true;

    // The joints array will never be modified. It is intended to be shared between
    // skeleton instances.
    constructor(private joints: Joint[]) {
        this.poseMatrices = nArray(this.joints.length, () => mat4.create());
        this.jointMatrices = nArray(this.joints.length, () => mat4.create());
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

        for (let i = 0; i < this.joints.length; i++) {
            const joint = this.joints[i];
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