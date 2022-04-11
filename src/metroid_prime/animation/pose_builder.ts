import { CINF } from '../cinf';
import { ReadonlyMat4, mat4, quat, ReadonlyQuat, ReadonlyVec3, vec3 } from 'gl-matrix';
import { AnimTreeNode } from './tree_nodes';
import { getMatrixTranslation, setMatrixTranslation } from '../../MathHelpers';

const scratchVec3 = vec3.create();
const scratchMat4 = mat4.create();

const zeroVec3: ReadonlyVec3 = vec3.create();
const oneVec3: ReadonlyVec3 = vec3.fromValues(1.0, 1.0, 1.0);
const identityQuat: ReadonlyQuat = quat.create();
const identityMat4: ReadonlyMat4 = mat4.create();

class ReentrantScratchData {
    rotationFromRoot: quat = quat.create();
    rotationFromRootMat: mat4 = mat4.create();
    offsetFromRoot: vec3 = vec3.create();
}

class ReentrantScratchStack {
    data: ReentrantScratchData[] = [];
    ptr: number = 0;

    public push(): ReentrantScratchData {
        if (this.ptr === this.data.length)
            this.data.push(new ReentrantScratchData());
        return this.data[this.ptr++];
    }

    public pop() {
        this.ptr--;
    }
}

const reentrantScratchStack = new ReentrantScratchStack();

class PoseTransform {
    originToAccum: mat4 = mat4.create();
    restPoseToAccum: mat4 = mat4.create();
}

export class PoseAsTransforms extends Map<number, PoseTransform> {
    public getOrCreateBoneXf(boneId: number): PoseTransform {
        let boneXf = this.get(boneId);
        if (boneXf === undefined) {
            boneXf = new PoseTransform();
            this.set(boneId, boneXf);
        }
        return boneXf;
    }
    public containsDataFor(boneId: number): boolean {
        return this.has(boneId);
    }
    public getOffset(outOff: vec3, boneId: number) {
        const boneXf = this.get(boneId)!;
        getMatrixTranslation(outOff, boneXf.originToAccum);
    }
    public getRotation(outMat: mat4, boneId: number) {
        const boneXf = this.get(boneId)!;
        mat4.copy(outMat, boneXf.originToAccum);
        outMat[12] = 0;
        outMat[13] = 0;
        outMat[14] = 0;
    }
}

interface TreeNode {
    child: number;
    sibling: number;
    rotation: ReadonlyQuat;
    offset: ReadonlyVec3;
    scale: ReadonlyVec3;
}

export class HierarchyPoseBuilder {
    rootId: number = 0;
    treeMap: Map<number, TreeNode> = new Map<number, TreeNode>();

    constructor(private cinf: CINF) {
        for (const boneId of cinf.buildOrder) {
            this.BuildIntoHierarchy(boneId);
        }
    }

    private BuildIntoHierarchy(boneId: number) {
        if (!this.treeMap.has(boneId)) {
            const bone = this.cinf.bones.get(boneId);
            if (bone!.parentBoneId === this.cinf.nullId) {
                this.rootId = boneId;
                const origin = this.cinf.getFromParentUnrotated(boneId);
                this.treeMap.set(boneId, {
                    child: 0,
                    sibling: 0,
                    rotation: identityQuat,
                    offset: origin,
                    scale: oneVec3
                });
            } else {
                this.BuildIntoHierarchy(bone!.parentBoneId);
                const origin = this.cinf.getFromParentUnrotated(boneId);
                const parentNode = this.treeMap.get(bone!.parentBoneId);
                this.treeMap.set(boneId,
                    {
                        child: 0,
                        sibling: parentNode!.child,
                        rotation: identityQuat,
                        offset: origin,
                        scale: oneVec3
                    });
                parentNode!.child = boneId;
            }
        }
    }

    private RecursivelyBuildNoScale(boneId: number, node: TreeNode, pose: PoseAsTransforms, parentRot: ReadonlyQuat,
                                    parentXf: ReadonlyMat4, parentOffset: ReadonlyVec3) {
        const scratch = reentrantScratchStack.push();

        const boneXf = pose.getOrCreateBoneXf(boneId);
        const bindOffset = this.cinf.getFromRootUnrotated(boneId);

        const rotationFromRoot = quat.mul(scratch.rotationFromRoot, parentRot, node.rotation);
        const rotationFromRootMat = mat4.fromQuat(scratch.rotationFromRootMat, rotationFromRoot);

        const offsetFromRoot = vec3.transformMat4(scratch.offsetFromRoot, node.offset, parentXf);
        vec3.add(offsetFromRoot, offsetFromRoot, parentOffset);

        setMatrixTranslation(mat4.copy(boneXf.originToAccum, rotationFromRootMat), offsetFromRoot);
        const inverseBind = mat4.fromTranslation(scratchMat4, vec3.negate(scratchVec3, boneId !== this.cinf.rootId ? bindOffset : zeroVec3));
        mat4.mul(boneXf.restPoseToAccum, boneXf.originToAccum, inverseBind);

        for (let bone = node.child; bone;) {
            const node = this.treeMap.get(bone);
            this.RecursivelyBuild(bone, node!, pose, rotationFromRoot, rotationFromRootMat, offsetFromRoot);
            bone = node!.sibling;
        }

        reentrantScratchStack.pop();
    }

    private RecursivelyBuild(boneId: number, node: TreeNode, pose: PoseAsTransforms, parentRot: ReadonlyQuat,
                             parentXf: ReadonlyMat4, parentOffset: ReadonlyVec3) {
        const scratch = reentrantScratchStack.push();

        const boneXf = pose.getOrCreateBoneXf(boneId);
        const bindOffset = this.cinf.getFromRootUnrotated(boneId);

        const rotationFromRoot = quat.mul(scratch.rotationFromRoot, parentRot, node.rotation);
        const rotationFromRootMat = mat4.fromQuat(scratch.rotationFromRootMat, rotationFromRoot);
        const rotationScale = mat4.scale(scratchMat4, rotationFromRootMat, node.scale);

        const offsetFromRoot = vec3.transformMat4(scratch.offsetFromRoot, node.offset, parentXf);
        vec3.add(offsetFromRoot, offsetFromRoot, parentOffset);

        setMatrixTranslation(mat4.copy(boneXf.originToAccum, rotationScale), offsetFromRoot);
        const inverseBind = mat4.fromTranslation(scratchMat4, vec3.negate(scratchVec3, boneId !== this.cinf.rootId ? bindOffset : zeroVec3));
        mat4.mul(boneXf.restPoseToAccum, boneXf.originToAccum, inverseBind);

        for (let bone = node.child; bone;) {
            const node = this.treeMap.get(bone);
            this.RecursivelyBuild(bone, node!, pose, rotationFromRoot, rotationFromRootMat, offsetFromRoot);
            bone = node!.sibling;
        }

        reentrantScratchStack.pop();
    }

    private BuildNoScale(pose: PoseAsTransforms) {
        const root = this.treeMap.get(this.rootId);
        this.RecursivelyBuildNoScale(this.rootId, root!, pose, identityQuat, identityMat4, zeroVec3);
    }

    public BuildFromAnimRoot(animRoot: AnimTreeNode, pose: PoseAsTransforms) {
        const data = animRoot.GetPerSegmentData(this.cinf.buildOrder);

        for (let i = 0; i < this.cinf.buildOrder.length; ++i) {
            const boneId = this.cinf.buildOrder[i];
            if (boneId === this.cinf.rootId)
                continue;
            const node = this.treeMap.get(boneId);
            const { rotation, scale, translation } = data[i];
            node!.rotation = rotation ? rotation : identityQuat;
            node!.offset = translation ? translation : this.cinf.getFromParentUnrotated(boneId);
            node!.scale = scale ? scale : oneVec3;
        }

        this.BuildNoScale(pose);
    }
}
