
import { mat4, vec3, quat, ReadonlyMat4 } from "gl-matrix";
import { Green, Magenta, Red } from "../Color";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { AABB } from "../Geometry";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { angleDist, clamp, computeMatrixWithoutTranslation, computeModelMatrixR, float32AsBits, getMatrixAxisY, getMatrixAxisZ, MathConstants, normToLength, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1, Vec3NegY, Vec3UnitY, getMatrixTranslation } from "../MathHelpers";
import { computeModelMatrixPosRot } from "../SourceEngine/Main";
import { assert, hexzero, nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { CollisionList, MissionSetupObjectSpawn, MotionActionID, MotionID, MotionParameters, ObjectDefinition, ObjectModel, SkinningMatrix } from "./bin";
import { BINModelInstance, BINModelSectorData } from "./render";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { ObjectAnimationList, applyCurve } from "./animation";
import { AdjustableAnimationController } from "../BanjoKazooie/render";

const scratchVec3 = vec3.create();

function mat4Lerp(dst: mat4, a: mat4, b: mat4, t: number): void {
    for (let i = 0; i < dst.length; i++)
        dst[i] = a[i] + (b[i] - a[i]) * t;
}

// computes the inverse of an affine transform, assuming the linear part is a rotation
function invertOrthoMatrix(dst: mat4, src: ReadonlyMat4): void {
    mat4.transpose(dst, src);
    dst[3] = dst[7] = dst[11] = 0; // zero where the translation ended up
    getMatrixTranslation(scratchVec3, src);
    transformVec3Mat4w0(scratchVec3, dst, scratchVec3);
    vec3.scale(scratchVec3, scratchVec3, -1);
    setMatrixTranslation(dst, scratchVec3);
}

type AnimFunc = (objectRenderer: ObjectRenderer, deltaTimeInFrames: number) => void;

// this is a combination of fields in the object struct, which are common for all objects,
// and some from the motion struct, which differs depending on motion logic
interface MotionState {
    parameters: MotionParameters;
    useAltMotion: boolean;
    pos: vec3;
    target: vec3;
    velocity: vec3; // not actually in the game

    adjustPitch: boolean;
    isTall: boolean;
    composeEuler: boolean;
    pathIndex: number;
    speed: number;
    size: number;

    eulerStep: vec3;
    eulerTarget: vec3;
    euler2: vec3;

    angle: number;
    angleStep: number;
    angleTarget: number;

    reference: mat4;
    axis: vec3;

    timer: number;
    state: number;

    supporter?: ObjectRenderer;
    g: number;
    radius: number;
    zone: number,
}

interface ParentState {
    parent: ObjectRenderer;
    parentOffset: vec3;
    inheritedEuler: vec3;
}

function reduceAngle(t: number): number {
    t = t % MathConstants.TAU;
    if (t > MathConstants.TAU / 2)
        t -= MathConstants.TAU;
    else if (t < - MathConstants.TAU / 2)
        t += MathConstants.TAU;
    return t;
}

const speedTable: number[] = [0.3, 1, 2, 4, 6, 8, 10, 15, 20, 40, 200, 0];

const enum AnimationType {
    IDLE = 0,
    MOVING = 1,
    WRIGGLE = 2,
    PANIC_A = 3,
    PANIC_B = 4,
}

const scratchMatrix = mat4.create();
const animationQuat = quat.create();
const animationPos = vec3.create();
const animationMatrix = mat4.create();
const animationStack = nArray(15, () => mat4.create());
export class ObjectRenderer {
    public visible = true;
    public modelInstances: BINModelInstance[] = [];

    private animFunc: AnimFunc | null = null;
    public motionState: MotionState | null = null;

    private parentState: ParentState | null = null;
    public modelMatrix = mat4.create();
    public baseMatrix = mat4.create();
    public prevPosition = vec3.create();
    public euler = vec3.create();
    public bbox: AABB;
    public partBBox: AABB;

    private dummyParent = false;

    public altObject: ObjectRenderer | null = null;
    public useAltObject = false;

    private animations: ObjectAnimationList | null = null;
    private animationIndex = -1;
    private animationController = new AdjustableAnimationController(30);
    private skinningInfo: SkinningMatrix[][] = [];

    constructor(device: GfxDevice, gfxCache: GfxRenderCache, objectModel: ObjectModel, binModelSectorData: BINModelSectorData, public objectSpawn: MissionSetupObjectSpawn) {
        for (let j = 0; j < binModelSectorData.modelData.length; j++) {
            let transformCount = 0;
            if (objectModel.skinning.length > 0)
                transformCount = objectModel.skinning[j].length;
            const binModelInstance = new BINModelInstance(device, gfxCache, binModelSectorData.modelData[j], transformCount);
            mat4.copy(binModelInstance.modelMatrix, objectSpawn.modelMatrix);
            if (objectModel.transforms.length > 0) {
                mat4.mul(binModelInstance.modelMatrix, binModelInstance.modelMatrix, objectModel.transforms[j].matrix);
                vec3.copy(binModelInstance.euler, objectModel.transforms[j].rotation);
                vec3.copy(binModelInstance.translation, objectModel.transforms[j].translation);
            }

            this.modelInstances.push(binModelInstance);
        }

        this.animFunc = animFuncSelect(this.objectSpawn.objectId);

        this.bbox = objectModel.bbox;
        this.partBBox = this.modelInstances[0].binModelData.binModel.bbox;
        this.skinningInfo = objectModel.skinning;
        mat4.copy(this.modelMatrix, objectSpawn.modelMatrix);
        mat4.copy(this.baseMatrix, this.modelMatrix);
        mat4.getTranslation(this.prevPosition, this.modelMatrix);
    }

    public setParent(parent: ObjectRenderer): void {
        const parentOffset = vec3.create();
        vec3.sub(parentOffset, this.prevPosition, parent.prevPosition);
        mat4.transpose(scratchMatrix, parent.modelMatrix);
        transformVec3Mat4w0(parentOffset, scratchMatrix, parentOffset);
        this.parentState = {
            parent,
            parentOffset,
            inheritedEuler: vec3.create(),
        };
    }

    private static animPermutation = [3, 0, 2, 1, 4, 5];

    public setAnimation(anim: AnimationType): void {
        const oldIndex = this.animationIndex;
        this.animationIndex = ObjectRenderer.animPermutation[anim];

        if (this.animations !== null && this.animationIndex !== oldIndex)
            this.animationController.init(this.animations!.animations[this.animationIndex].fps);

        if (this.altObject)
            this.altObject.setAnimation(anim);
    }

    public initMotion(def: ObjectDefinition, motion: MotionParameters | null, zones: CollisionList[], levelCollision: CollisionList[][], allObjects: ObjectRenderer[]): void {
        const objectSpawn = this.objectSpawn;
        this.dummyParent = def.dummyParent;

        if (motion === null || stationaryObjects.has(objectSpawn.objectId))
            return;
        // common speed logic, there may be others
        let speed = motion.speed; // from the path
        if (speed < 0) {
            if (def.speedIndex >= 0)
                speed = speedTable[def.speedIndex];
            else
                speed = 0;
        }

        const size = Math.max(def.size, 0); // TODO: negative indices?

        const pos = vec3.create();
        mat4.getTranslation(pos, objectSpawn.modelMatrix);
        const isTall = motion.motionID === MotionID.PathRoll && this.modelInstances.length > 0 &&
            (this.partBBox.maxY > this.partBBox.maxX);
        this.motionState = {
            parameters: motion,
            useAltMotion: false,
            speed,
            size,
            pathIndex: -1,
            adjustPitch: !def.stayLevel,
            isTall,
            composeEuler: true, // inverted from game

            pos,
            target: vec3.create(),
            velocity: vec3.create(),

            eulerStep: vec3.create(),
            eulerTarget: vec3.create(),
            euler2: vec3.create(),

            angle: 0,
            angleStep: 0,
            angleTarget: 0,

            reference: mat4.clone(objectSpawn.modelMatrix),
            axis: vec3.create(),

            timer: -1,
            state: -1,
            g: 0,
            radius: 0,
            zone: -1,
        };

        // motion-specific setup
        if (this.motionState.parameters.motionID === MotionID.Hop)
            motion_MiscHop_Init(this, this.motionState, allObjects);
        if (this.motionState.parameters.motionActionID === MotionActionID.WaitForPlayer)
            setZone(this, this.motionState, zones);
        }

    private runMotion(deltaTimeInFrames: number, viewerInput: ViewerRenderInput, zones: CollisionList[], levelCollision: CollisionList[][]): boolean {
        const motionState = this.motionState!;
        const motionID = (motionState.useAltMotion && motionState.parameters.altMotionActionID !== 0) ? motionState.parameters.altMotionActionID : motionState.parameters.motionActionID;
        return runMotionFunc(this, motionState, motionID, deltaTimeInFrames, viewerInput, zones, levelCollision);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, toNoclip: mat4, currentPalette: number, zones: CollisionList[] | null, levelCollision: CollisionList[][] | null): void {
        if (!this.visible)
            return;

        // Game runs at 30fps.
        const deltaTimeInFrames = clamp(viewerInput.deltaTime / 33.0, 0.0, 2.0);

        let hasMotionImplementation = false;
        if (this.motionState !== null) {
            hasMotionImplementation = this.runMotion(deltaTimeInFrames, viewerInput, zones!, levelCollision!);
            vec3.copy(this.prevPosition, this.motionState.pos);
        }
            computeKatamariRotation(scratchMatrix, this.euler);
        mat4.mul(this.modelMatrix, this.baseMatrix, scratchMatrix);

        if (this.parentState) {
            const parent = this.parentState.parent;
            let ancestor = parent;
            while (ancestor.parentState)
                ancestor = ancestor.parentState.parent;
            const ignoreParent = this.objectSpawn.linkAction === 4 || this.objectSpawn.linkAction === 6;
            if (!ignoreParent) {
                // overwrite position entirely?
                vec3.transformMat4(this.prevPosition, this.parentState.parentOffset, parent.modelMatrix);

                if (ancestor.motionState === null || ancestor.motionState.composeEuler) {
                    // nonsense euler angle transformation
                    const parentEuler = parent.parentState ? parent.parentState.inheritedEuler : parent.euler;
                    transformVec3Mat4w0(this.parentState.inheritedEuler, parent.modelMatrix, parentEuler);
                    for (let i = 0; i < 3; i++)
                        this.parentState.inheritedEuler[i] = reduceAngle(this.parentState.inheritedEuler[i]);
                    computeKatamariRotation(scratchMatrix, this.parentState.inheritedEuler);
                    mat4.mul(this.modelMatrix, scratchMatrix, this.modelMatrix);
                    // add on our own rotation
                    vec3.add(this.parentState.inheritedEuler, this.parentState.inheritedEuler, this.euler);
                } else {
                    // the game stores the base and euler separately for each, but doesn't modify it in this case
                    computeKatamariRotation(scratchMatrix, ancestor.euler);
                    mat4.mul(this.modelMatrix, scratchMatrix, this.modelMatrix);
                    mat4.mul(this.modelMatrix, ancestor.baseMatrix, this.modelMatrix);
                }
            }
        }

        setMatrixTranslation(this.modelMatrix, this.prevPosition);

        if (this.animFunc !== null)
            this.animFunc(this, deltaTimeInFrames);

        if (!this.useAltObject) {
            if (this.animations !== null && this.animationIndex >= 0) {
                this.animationController.setTimeFromViewerInput(viewerInput);
                this.animate();
            } else
                for (let i = 0; i < this.modelInstances.length; i++)
                    computeModelMatrixPosRot(this.modelInstances[i].modelMatrix, this.modelInstances[i].translation, this.modelInstances[i].euler);

            // pass in a single transform from object space to (noclip) world space
            mat4.mul(scratchMatrix, toNoclip, this.modelMatrix);
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].prepareToRender(renderInstManager, viewerInput, scratchMatrix, currentPalette);
        } else if (this.altObject) {
            vec3.copy(this.altObject.prevPosition, this.prevPosition);
            mat4.copy(this.altObject.baseMatrix, this.baseMatrix);
            vec3.copy(this.altObject.euler, this.euler);
            this.altObject.prepareToRender(renderInstManager, viewerInput, toNoclip, currentPalette, zones, levelCollision);
        }


        const debugMotion = false;
        if (debugMotion) {
            mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, toNoclip);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, `Object ${hexzero(this.objectSpawn.objectId, 4)}`, 25, Magenta, { outline: 2, shadowBlur: 2 });

            if (hasMotionImplementation && this.motionState !== null) {
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, Green, 4);
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.target, Green, 4);

                const m = mat4.create();

                // mat4.fromYRotation(m, this.motionState.euler[1]);
                // transformVec3Mat4w0(swayScratch, m, Vec3UnitZ);
                // drawWorldSpaceVector(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.pos, swayScratch, 100, Red);

                // mat4.fromYRotation(m, this.motionState.eulerTarget[1]);
                // transformVec3Mat4w0(swayScratch, m, Vec3UnitZ);
                // drawWorldSpaceVector(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.pos, swayScratch, 100, Green);
            } else {
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, Red, 4);
                if (this.motionState !== null) {
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, `Motion 1 ${hexzero(this.motionState.parameters.motionActionID, 2)}`, 45, Magenta, { outline: 2, shadowBlur: 2 });
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, `Motion 2 ${hexzero(this.motionState.parameters.altMotionActionID, 2)}`, 65, Magenta, { outline: 2, shadowBlur: 2 });
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, `Motion ID ${hexzero(this.motionState.parameters.motionID, 2)}`, 85, Magenta, { outline: 2, shadowBlur: 2 });
                }
            }
            if (this.parentState) {
                drawWorldSpaceLine(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, this.parentState.parent.prevPosition, Magenta);
                drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, this.objectSpawn.linkAction.toString(10), 25);
            }
        }
    }

    public setActiveAreaNo(areaNo: number): void {
        const visible = areaNo >= this.objectSpawn.dispOnAreaNo && ((areaNo < this.objectSpawn.dispOffAreaNo) || this.objectSpawn.dispOffAreaNo === -1);
        this.visible = visible;
        // not 100% on this logic
        if (this.parentState) {
            const parent = this.parentState.parent;
            const parentVisible = areaNo >= parent.objectSpawn.dispOnAreaNo && ((areaNo < parent.objectSpawn.dispOffAreaNo) || parent.objectSpawn.dispOffAreaNo === -1);
            if (!parentVisible && (this.objectSpawn.linkAction === 2 || parent.dummyParent))
                this.visible = false;
        }
    }

    public altModelID(): number {
        if (this.motionState && this.motionState.parameters.motionID === MotionID.ScaredBird) {
            // the game actually finds a match at runtime. if there isn't a model of the corresponding ID,
            // the bird doesn't take off. This might be a reason for the random objects underneath the level.

            // this motion is also assigned to a dog and a cat,
            // though checking in game made it seem like they don't use the motion at all
            const id = this.objectSpawn.objectId;
            if (id === ObjectId.BIRD01_C)
                return ObjectId.BIRD02_B;
            if (id === ObjectId.BIRD07_C)
                return ObjectId.BIRD09_D;
            if (id === ObjectId.BIRD08_B)
                return ObjectId.BIRD10_C;
        }
        return -1;
    }

    public initAnimation(animations: ObjectAnimationList): void {
        this.animations = animations;
        assert(animationStack.length >= animations.bindPose.length);
        this.partBBox = this.bbox; // first "part" is actually the whole model for animated objects
        this.setAnimation(AnimationType.IDLE);
    }

    private animate(): void {
        const bind = this.animations!.bindPose;
        const animation = this.animations!.animations[this.animationIndex];
        let curveIndex = 0;
        const frame = this.animationController.getTimeInFrames() % (animation.frameInterval * (animation.segmentCount - 1));
        for (let i = 0; i < bind.length; i++) {
            if (animation.isRelative) {
                vec3.zero(animationPos);
                quat.identity(animationQuat);
            } else {
                vec3.copy(animationPos, bind[i].pos);
                quat.copy(animationQuat, bind[i].rot);
            }

            for (; curveIndex < animation.curves.length; curveIndex++) {
                if (animation.curves[curveIndex].part !== i)
                    break;
                applyCurve(animation, animation.curves[curveIndex], frame, animationPos, animationQuat);
            }
            const dst = animationStack[i];
            mat4.fromRotationTranslation(dst, animationQuat, animationPos);
            if (animation.isRelative) {
                mat4.fromRotationTranslation(animationMatrix, bind[i].rot, bind[i].pos);
                mat4.mul(dst, animationMatrix, dst);
            }
            if (bind[i].parent >= 0)
                mat4.mul(dst, animationStack[bind[i].parent], dst);
        }
        for (let i = 0; i < this.modelInstances.length; i++) {
            const joint = this.modelInstances[i].binModelData.binModel.animationIndex;
            const base = this.modelInstances[i].modelMatrix;
            mat4.copy(base, animationStack[joint]);
            for (let j = 0; j < this.modelInstances[i].skinningMatrices.length; j++) {
                const dst = this.modelInstances[i].skinningMatrices[j];
                const info = this.skinningInfo[i][j];
                // first compute the transform between the two joints' spaces
                invertOrthoMatrix(dst, bind[info.index].reference);
                mat4.mul(dst, dst, bind[joint].reference);

                mat4.mul(dst, animationStack[info.index], dst);
                mat4Lerp(dst, base, dst, info.weight);
            }
        }
    }
}

function computeKatamariRotation(dst: mat4, euler: vec3): void {
    // game wants Z.X.Y
    if (euler[0] === 0) {
        // no X, just do Z.Y
        computeModelMatrixR(dst, 0, euler[1], euler[2]);
    } else {
        // just get Z.X from the standard order, then post multiply by Y
        computeModelMatrixR(dst, euler[0], 0, euler[2]);
        mat4.rotateY(dst, dst, euler[1]);
    }
}

// game also tracks depth, depth as a fraction of aabb radius, and the vertices
interface TriangleInfo {
    normal: vec3;
    zone: number;
    depth: number;
}

const scratchTri: TriangleInfo = { normal: vec3.create(), zone: -1, depth: 0 };
const scratchAABB = new AABB();
const groundScratch = nArray(3, () => vec3.create());
const normalScratch = nArray(4, () => vec3.create());
const groundMatrices = nArray(2, () => mat4.create());

function findGround(collision: CollisionList[], out: TriangleInfo, pos: vec3, target: vec3): boolean {
    let minDepth = vec3.dist(pos, target);
    let foundAny = false;
    mat4.identity(groundMatrices[0]);
    if (pos[0] !== target[0] || pos[2] !== target[2])
        mat4.lookAt(groundMatrices[0], pos, target, Vec3NegY);
    else if (pos[1] <= target[1]) {
        groundMatrices[0][5] = 0;
        groundMatrices[0][6] = 1;
        groundMatrices[0][9] = -1;
        groundMatrices[0][10] = 0;

        groundMatrices[0][12] = -pos[0];
        groundMatrices[0][13] = pos[2];
        groundMatrices[0][14] = -pos[1];
    } else {
        groundMatrices[0][5] = 0;
        groundMatrices[0][6] = -1;
        groundMatrices[0][9] = 1;
        groundMatrices[0][10] = 0;

        groundMatrices[0][12] = -pos[0];
        groundMatrices[0][13] = -pos[2];
        groundMatrices[0][14] = pos[1];
    }
    mat4.transpose(groundMatrices[1], groundMatrices[0]);
    vec3.min(groundScratch[0], pos, target);
    vec3.max(groundScratch[1], pos, target);
    scratchAABB.set(
        groundScratch[0][0], groundScratch[0][1], groundScratch[0][2],
        groundScratch[1][0], groundScratch[1][1], groundScratch[1][2],
    );
    // default values
    out.zone = -1;
    vec3.copy(out.normal, Vec3NegY);
    for (let i = 0; i < collision.length; i++) {
        if (!AABB.intersect(scratchAABB, collision[i].bbox))
            continue;
        for (let j = 0; j < collision[i].groups.length; j++) {
            const verts = collision[i].groups[j].vertices;
            let inOrder = true;
            for (let k = 0; k < verts.length; k += 4) {
                vec3.copy(groundScratch[0], groundScratch[1]);
                vec3.copy(groundScratch[1], groundScratch[2]);
                vec3.set(groundScratch[2], verts[k], verts[k + 1], verts[k + 2])
                transformVec3Mat4w1(groundScratch[2], groundMatrices[0], groundScratch[2]);
                if (k < 8 || (!collision[i].groups[j].isTriStrip && k % 0xC !== 0x8))
                    continue;

                if (inOrder) {
                    vec3.sub(normalScratch[0], groundScratch[0], groundScratch[2]);
                    vec3.sub(normalScratch[1], groundScratch[1], groundScratch[2]);
                } else {
                    vec3.sub(normalScratch[0], groundScratch[0], groundScratch[1]);
                    vec3.sub(normalScratch[1], groundScratch[2], groundScratch[1]);
                }
                vec3.cross(normalScratch[3], normalScratch[0], normalScratch[1]);
                vec3.normalize(normalScratch[3], normalScratch[3]); // preserve unscaled normal

                // optionally shift vertices along normal by radius
                // but so far the provided radius is 0
                for (let v = 0; v < 3; v++)
                    vec3.copy(normalScratch[v], groundScratch[v]);

                // check if translated triangle is below the origin
                let contained = true;
                for (let v = 0; v < 3; v++) {
                    const w = (v + (inOrder ? 1 : 2)) % 3;
                    if (normalScratch[v][0] * normalScratch[w][1] - normalScratch[v][1] * normalScratch[w][0] >= 0) {
                        contained = false;
                        break;
                    }
                }
                if (contained) {
                    const depth = vec3.dot(normalScratch[3], normalScratch[0]) / normalScratch[3][2];
                    if (depth > 0 && depth < minDepth) {
                        foundAny = true;
                        minDepth = depth;
                        transformVec3Mat4w0(out.normal, groundMatrices[1], normalScratch[3]);
                        out.zone = float32AsBits(verts[k + 3]);
                        out.depth = depth;
                    }
                }
                if (collision[i].groups[j].isTriStrip)
                    inOrder = !inOrder;
            }
        }
    }
    return foundAny;
}

const landingAABB = new AABB();
const landingScratch = vec3.create();
function landOnObject(object: ObjectRenderer, newPos: vec3, target: ObjectRenderer, depthMultiplier = 1): boolean {
    computeMatrixWithoutTranslation(scratchMatrix, object.modelMatrix);
    landingAABB.transform(object.bbox, scratchMatrix);
    const objectBottom = landingAABB.maxY;

    // this should be a bug - the transformation of the target isn't considered
    // however, the one case where it would matter so far (knives on rocks in the beginning of MAS3) isn't affected
    if (target.prevPosition[1] + target.bbox.minY >= object.prevPosition[1] && target.prevPosition[1] + target.bbox.minY < newPos[1] + depthMultiplier * objectBottom) {
        vec3.sub(landingScratch, object.prevPosition, target.prevPosition);
        landingScratch[1] = target.bbox.minY;
        if (target.bbox.containsPoint(landingScratch)) {
            newPos[1] = target.prevPosition[1] + target.bbox.minY - objectBottom;
            return true;
        }
    }
    return false;
}

function motion_alignToGround(object: ObjectRenderer, motion: MotionState, collision: CollisionList[]): void {
    vec3.copy(landingScratch, motion.pos);
    landingScratch[1] += object.bbox.maxCornerRadius();
    if (findGround(collision, scratchTri, motion.pos, landingScratch)) {
        motion.pos[1] += scratchTri.depth;
        // seems like this shouldn't have the absolute value, but it probably never matters
        vec3.scaleAndAdd(motion.pos, motion.pos, scratchTri.normal, Math.abs(object.partBBox.maxY));
        if (motion.adjustPitch) {
            vec3.cross(landingScratch, scratchTri.normal, Vec3NegY);
            vec3.normalize(landingScratch, landingScratch);
            const angle = Math.acos(vec3.dot(landingScratch, Vec3NegY));
            mat4.fromRotation(object.baseMatrix, angle, landingScratch);
        }
    }
}

function setZone(object: ObjectRenderer, motion: MotionState, zones: CollisionList[]): void {
    vec3.copy(landingScratch, motion.pos);
    landingScratch[1] += 2 * object.bbox.maxCornerRadius();
    findGround(zones, scratchTri, motion.pos, landingScratch);
    motion.zone = scratchTri.zone;
    if (motion.parameters.motionID === 0x25)
        object.setAnimation(AnimationType.MOVING);
}

const enum Axis { X, Y, Z }

function rotateObject(modelInstance: BINModelInstance, deltaTimeInFrames: number, axis: Axis, value: number): void {
    const angle = (value / -60.0) * deltaTimeInFrames;
    modelInstance.euler[axis] += angle;
}

function scrollTexture(modelInstance: BINModelInstance, deltaTimeInFrames: number, axis: Axis, value: number): void {
    const offs = value * deltaTimeInFrames;

    if (axis === Axis.X)
        modelInstance.textureMatrix[12] += offs;
    else if (axis === Axis.Y)
        modelInstance.textureMatrix[13] += offs;
}

function uvWrapMin(v: number, min: number): number {
    if (v < min)
        v += 1.0 - min;
    return v;
}

function scrollTextureWrapMin(modelInstance: BINModelInstance, axis: Axis, min: number): void {
    if (axis === Axis.X)
        modelInstance.textureMatrix[12] = uvWrapMin(modelInstance.textureMatrix[12], min);
    else if (axis === Axis.Y)
        modelInstance.textureMatrix[13] = uvWrapMin(modelInstance.textureMatrix[13], min);
}

function oscillateTexture(modelInstance: BINModelInstance, deltaTimeInFrames: number, axis: Axis, value: number, min: number, max: number) {
    scrollTexture(modelInstance, deltaTimeInFrames, axis, modelInstance.uvState === 0 ? -value : value);
    const newValue = axis === Axis.X ? modelInstance.textureMatrix[12] : modelInstance.textureMatrix[13];
    if (modelInstance.uvState === 0 && newValue < min)
        modelInstance.uvState = 1;
    else if (modelInstance.uvState === 1 && newValue > max)
        modelInstance.uvState = 0;
}

const enum ObjectId {
    BARBER_D        = 0x001E,
    HUKUBIKI_C      = 0x0023,
    COMPASS_A       = 0x002F,
    OMEN05_B        = 0x003F,
    BIRD01_C        = 0x008D,
    CAR02_F         = 0x0091,
    CAR03_F         = 0x0092,
    CAR04_F         = 0x0093,
    CAR05_E         = 0x0094,
    CAR06_E         = 0x0095,
    CAR07_E         = 0x0096,
    FARMCAR02_E     = 0x0098,
    POLIHOUSE_E     = 0x00C6,
    DUSTCAR_F       = 0x0133,
    TRUCK01_F       = 0x0135,
    BUS01_F         = 0x0136,
    BIKE01_D        = 0x0156,
    BIKE02_D        = 0x0157,
    BIKE03_D        = 0x0165,
    BALANCEDOLL01_C = 0x016B,
    SHOPHUGU02_D    = 0x0189,
    CAR08_F         = 0x01A2,
    WORKCAR04_F     = 0x01A8,
    WORKCAR06_F     = 0x01AB,
    TANK01_F        = 0x01B0,
    BIKE04_E        = 0x01B2,
    BIKE05_E        = 0x01B3,
    BIRD09_D        = 0x01F1,
    BIRD10_C        = 0x01F2,
    GSWING01_B      = 0x0206,
    BIRD02_B        = 0x0207,
    BIRD03_C        = 0x0208,
    BIRD07_C        = 0x020C,
    BIRD08_B        = 0x020D,
    RADICON02_E     = 0x0220,
    BIKE06_E        = 0x02B0,
    WINDMILL01_G    = 0x02C6,
    TORNADO_G       = 0x02D6,
    SPINWAVE_G      = 0x02D7,
    KIDDYCAR01_C    = 0x02F1,
    KIDDYCAR02_C    = 0x02F2,
    PLANE02_F       = 0x0382,
    PLANE03_F       = 0x0383,
    SIGNAL01_E      = 0x03A1,
    SIGNAL02_E      = 0x03A2,
    KAPSEL01_B	    = 0x0321,
    KAPSEL02_B	    = 0x0322,
    KAPSEL03_B	    = 0x0323,
    OMEN08_B        = 0x03FB,
    ZOKUCAR_E       = 0x0405,
    MAJANPAI01_A    = 0x041B,
    MAJANPAI02_A    = 0x041C,
    MAJANPAI03_A    = 0x041D,
    MAJANPAI04_A    = 0x041E,
    BOOTH02_E       = 0x044C,
    RAIN01_G        = 0x04D2,
    SCHOOLNAME01_D  = 0x04F8,
    SCHOOLNAME02_D  = 0x04F9,
    SCHOOLNAME03_D  = 0x04FA,
    SCHOOLNAME04_D  = 0x04FB,
    SCHOOLNAME05_D  = 0x04FC,
    SCHOOLNAME06_D  = 0x04FD,
    SCHOOLNAME07_D  = 0x04FE,
    COPYKI_E        = 0x052F,
    HOTEL03_E       = 0x0556,
    HOTEL04_E       = 0x0557,
    HOTEL05_E       = 0x0558,
    HOTEL06_E       = 0x0559,
    HOTEL07_E       = 0x055A,
}

const stationaryObjects: Set<ObjectId> = new Set([ObjectId.KAPSEL01_B, ObjectId.KAPSEL02_B, ObjectId.KAPSEL03_B]);

function animFuncSelect(objectId: ObjectId): AnimFunc | null {
    switch (objectId) {
    case ObjectId.BARBER_D:     return animFunc_BARBER_D;
    case ObjectId.HUKUBIKI_C:   return animFunc_HUKUBIKI_C;
    case ObjectId.COMPASS_A:    return animFunc_COMPASS_A;
    case ObjectId.OMEN05_B:     return animFunc_OMEN05_B;
    case ObjectId.WINDMILL01_G: return animFunc_WINDMILL01_G;
    case ObjectId.POLIHOUSE_E:  return animFunc_POLIHOUSE_E;
    case ObjectId.FARMCAR02_E:  return animFunc_FARMCAR02_E;
    case ObjectId.WORKCAR04_F:  return animFunc_WORKCAR04_F;
    case ObjectId.TANK01_F:     return animFunc_TANK01_F;
    case ObjectId.GSWING01_B:   return animFunc_GSWING01_B;
    case ObjectId.TORNADO_G:    return animFunc_TORNADO_G;
    case ObjectId.SPINWAVE_G:   return animFunc_SPINWAVE_G;
    case ObjectId.SIGNAL01_E:   return animFunc_SIGNAL01_E;
    case ObjectId.SIGNAL02_E:   return animFunc_SIGNAL02_E;
    case ObjectId.BOOTH02_E:    return animFunc_BOOTH02_E;
    case ObjectId.OMEN08_B:     return animFunc_OMEN08_B;
    case ObjectId.RAIN01_G:     return animFunc_RAIN01_G;
    case ObjectId.CAR02_F:
    case ObjectId.CAR03_F:
    case ObjectId.CAR04_F:
    case ObjectId.CAR05_E:
    case ObjectId.CAR06_E:
    case ObjectId.CAR07_E:
    case ObjectId.CAR08_F:
    case ObjectId.DUSTCAR_F:
    case ObjectId.TRUCK01_F:
    case ObjectId.BUS01_F:
    case ObjectId.BIKE01_D:
    case ObjectId.BIKE02_D:
    case ObjectId.BIKE03_D:
    case ObjectId.BIKE04_E:
    case ObjectId.BIKE05_E:
    case ObjectId.BIKE06_E:
    case ObjectId.RADICON02_E:
    case ObjectId.KIDDYCAR01_C:
    case ObjectId.KIDDYCAR02_C:
    case ObjectId.ZOKUCAR_E:
        return animFunc_GenericVehicle;
    case ObjectId.PLANE02_F: return animFunc_PLANE02_F;
    case ObjectId.PLANE03_F: return animFunc_PLANE03_F;
    case ObjectId.COPYKI_E:  return animFunc_COPYKI_E;
    case ObjectId.MAJANPAI01_A:
    case ObjectId.MAJANPAI02_A:
    case ObjectId.MAJANPAI03_A:
    case ObjectId.MAJANPAI04_A:
        return animFunc_Mahjong;
    case ObjectId.SCHOOLNAME01_D:
    case ObjectId.SCHOOLNAME02_D:
    case ObjectId.SCHOOLNAME03_D:
    case ObjectId.SCHOOLNAME04_D:
    case ObjectId.SCHOOLNAME05_D:
    case ObjectId.SCHOOLNAME06_D:
    case ObjectId.SCHOOLNAME07_D:
        return animFunc_SchoolName;
    case ObjectId.HOTEL03_E:
    case ObjectId.HOTEL04_E:
    case ObjectId.HOTEL05_E:
    case ObjectId.HOTEL06_E:
    case ObjectId.HOTEL07_E:
        return animFunc_HotelSign;
    }
    return null;
}

function animFunc_BARBER_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1/600.0);
}

function animFunc_HUKUBIKI_C(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Z, 1.0);
}

function animFunc_COMPASS_A(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Y, 1.0);
}

function animFunc_OMEN05_B(object: ObjectRenderer, deltaTimeInFrames: number): void {
    oscillateTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1/500.0, -3/100, 3/100);
    object.modelInstances[2].textureMatrix[12] = object.modelInstances[1].textureMatrix[12];
}

function animFunc_OMEN08_B(object: ObjectRenderer, deltaTimeInFrames: number): void {
    oscillateTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1/500.0, -3/100, 3/100);
    object.modelInstances[2].textureMatrix[12] = -object.modelInstances[1].textureMatrix[12];
}

function animFunc_WINDMILL01_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Z, 12.0);
}

function animFunc_POLIHOUSE_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Z, 1.0);
}

function animFunc_FARMCAR02_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.Y, -1/600.0);
    scrollTextureWrapMin(object.modelInstances[1], Axis.Y, 0.765);
    scrollTexture(object.modelInstances[2], deltaTimeInFrames, Axis.Y, -1/600.0);
    scrollTextureWrapMin(object.modelInstances[2], Axis.Y, 0.75);
}

function animFunc_WORKCAR04_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1/150.0);
}

function animFunc_TANK01_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1/120.0);
}

function animFunc_GSWING01_B(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.euler[1] += 0.14 * deltaTimeInFrames;
}

// these show up without motion in a test level, should probably worry about that
function animFunc_TORNADO_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    scrollTexture(object.modelInstances[0], deltaTimeInFrames, Axis.X, 1/30.0);
    object.euler[1] -= Math.PI/30.0 * deltaTimeInFrames;
}

function animFunc_SPINWAVE_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.euler[1] -= Math.PI/75.0 * deltaTimeInFrames;
}

function animFunc_BOOTH02_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.modelInstances[1].uvState += deltaTimeInFrames;
    if (object.modelInstances[1].uvState > 0x10) {
        object.modelInstances[1].textureMatrix[13] = .765 - object.modelInstances[1].textureMatrix[13];
        object.modelInstances[1].uvState = 0;
    }
}

let rainTimer = 0;
let rainCoord = 0
// in game this is only run for objects in view,
// so the animation would be slower when fewer are on screen
function animFunc_RAIN01_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.modelInstances[0].uvState += deltaTimeInFrames;
    if (object.modelInstances[0].uvState > 2) {
        object.modelInstances[0].uvState -= 2;
        if (rainTimer % 2 === 0)
            rainCoord = (rainCoord + .1) % .9;
        rainTimer++;
    }

    object.modelInstances[0].textureMatrix[12] = rainCoord;
}

function animFunc_PLANE02_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Y, 16.8);
    rotateObject(object.modelInstances[2], deltaTimeInFrames, Axis.X, 16.8);
}

function animFunc_PLANE03_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[0], deltaTimeInFrames, Axis.Z, 16.8);
    rotateObject(object.modelInstances[2], deltaTimeInFrames, Axis.Z, 16.8);
}

function animFunc_GenericVehicle(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.X, -4.0);
    rotateObject(object.modelInstances[2], deltaTimeInFrames, Axis.X, -4.0);
}

function animFunc_COPYKI_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.modelInstances[1].uvState < 0) {
        object.modelInstances[1].uvState += deltaTimeInFrames;
        if (object.modelInstances[1].uvState >= 0)
            object.modelInstances[1].uvState = object.modelInstances[1].textureMatrix[12] < 0 ? 1 : 0;
        else
            return;
    }
    const increasing = object.modelInstances[1].uvState === 1;
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, increasing ? 1 / 50.0 : -1 / 300.0);
    const newValue = object.modelInstances[1].textureMatrix[12];
    if (increasing && newValue > 0) {
        object.modelInstances[1].textureMatrix[12] = 0;
        object.modelInstances[1].uvState = -30;
    } else if (!increasing && newValue < -1 / 5.0) {
        object.modelInstances[1].textureMatrix[12] = -1 / 5.0;
        object.modelInstances[1].uvState = -5;
    }
}

function animFunc_Mahjong(object: ObjectRenderer, deltaTimeInFrames: number): void {
    let x = 0;
    let y = 0;
    switch (object.objectSpawn.objectId) {
        case ObjectId.MAJANPAI02_A:
            x = .5; y = 0; break;
        case ObjectId.MAJANPAI03_A:
            x = 0; y = .56; break;
        case ObjectId.MAJANPAI04_A:
            x = .5; y = .56; break;
    }
    object.modelInstances[0].textureMatrix[12] = x;
    object.modelInstances[0].textureMatrix[13] = y;
}

function animFunc_HotelSign(object: ObjectRenderer, deltaTimeInFrames: number): void {
    let x = 0;
    let y = 0;
    switch (object.objectSpawn.objectId) {
        case ObjectId.HOTEL03_E:
            x = 0; y = .75; break;
        case ObjectId.HOTEL04_E:
            x = 0; y = .5; break;
        case ObjectId.HOTEL05_E:
            x = .5; y = 0; break;
        case ObjectId.HOTEL06_E:
            x = .5; y = .75; break;
        case ObjectId.HOTEL07_E:
            x = .5; y = .5; break;
    }
    object.modelInstances[0].textureMatrix[12] = x;
    object.modelInstances[0].textureMatrix[13] = y;
}

function animFunc_SchoolName(object: ObjectRenderer, deltaTimeInFrames: number): void {
    let x = 0;
    let y = 0;
    switch (object.objectSpawn.objectId) {
        case ObjectId.SCHOOLNAME02_D:
            x = .25; y = 0; break;
        case ObjectId.SCHOOLNAME03_D:
            x = .5; y = 0; break;
        case ObjectId.SCHOOLNAME04_D:
            x = .75; y = 0; break;
        case ObjectId.SCHOOLNAME05_D:
            x = 0; y = .56; break;
        case ObjectId.SCHOOLNAME06_D:
            x = .25; y = .56; break;
        case ObjectId.SCHOOLNAME07_D:
            x = .5; y = .56; break;
    }
    object.modelInstances[0].textureMatrix[12] = x;
    object.modelInstances[0].textureMatrix[13] = y;
}

function animFunc_SIGNAL01_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    // in game, depends on something external (being rolled up?) to swap
    if (object.modelInstances[1].uvState < 0) {
        object.modelInstances[1].textureMatrix[12] = .24 - object.modelInstances[1].textureMatrix[12];
        object.modelInstances[1].uvState = 60 + 90 * Math.random();
    }
    object.modelInstances[1].uvState -= deltaTimeInFrames;
}

function animFunc_SIGNAL02_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.modelInstances[1].uvState -= deltaTimeInFrames;
    object.modelInstances[2].uvState -= deltaTimeInFrames;

    // in game, depends on something external (being rolled up?) to swap
    if (object.modelInstances[1].uvState < 0) {
        object.modelInstances[1].textureMatrix[12] = .25 - object.modelInstances[1].textureMatrix[12];
        object.modelInstances[1].uvState = 60 + 90 * Math.random();
    }
    if (object.modelInstances[1].textureMatrix[12] === 0) {
        if (object.modelInstances[2].uvState < 0) {
            object.modelInstances[2].uvState = 10;
            object.modelInstances[2].textureMatrix[12] = .25 - object.modelInstances[2].textureMatrix[12];
        }
    } else {
        object.modelInstances[2].textureMatrix[12] = .25;
    }
}

function runMotionFunc(object: ObjectRenderer, motion: MotionState, motionActionID: MotionActionID, deltaTimeInFrames: number, viewerInput: ViewerRenderInput, zones: CollisionList[], levelCollision: CollisionList[][]): boolean {
    if (motionActionID === MotionActionID.PathSpin) {
        motion_PathSpin_Update(object, motion, deltaTimeInFrames);
    } else if (motionActionID === MotionActionID.PathRoll) {
        motion_PathRoll_Update(object, motion, deltaTimeInFrames);
    } else if (motionActionID === MotionActionID.PathSimple || motionActionID === MotionActionID.PathCollision) {
        motion_PathSimple_Update(object, motion, deltaTimeInFrames, levelCollision[0]);
    } else if (motionActionID === MotionActionID.PathSetup) {
        if (motion.isTall) {
            // Submotion 0x14 seems to suggest we'll transition to PathRoll after.
            assert(motion.parameters.altMotionActionID === MotionActionID.PathRoll);

            // If it's taller than it is wide, roll it on its side. Normally, this is implemented
            // by setting a bitflag, and the setup code for PathRoll does the rotation. But since
            // we don't have setup funcs for the states (yet), just do it here in the PathSetup.
            motion.euler2[2] = MathConstants.TAU / 4;
        }

        // TODO(jstpierre): Implement PathSetup properly.
        motion.useAltMotion = true;
        motion_PathSimple_Update(object, motion, deltaTimeInFrames, levelCollision[0]);
    } else if (motionActionID === MotionActionID.Misc) {
        const motionID = motion.parameters.motionID;
        if (motionID === MotionID.Spin)
            motion_MiscSpin_Update(object, deltaTimeInFrames, motion);
        else if (motionID === MotionID.Bob)
            motion_MiscBob_Update(object, deltaTimeInFrames, motion);
        else if (motionID === MotionID.Hop)
            motion_MiscHop_Update(object, deltaTimeInFrames, motion, levelCollision[0]);
        else if (motionID === MotionID.Flip)
            motion_MiscFlip_Update(object, deltaTimeInFrames, motion);
        else if (motionID === MotionID.Sway)
            motion_MiscSway_Update(object, deltaTimeInFrames, motion);
        else if (motionID === MotionID.WhackAMole)
            motion_MiscWhackAMole_Update(object, deltaTimeInFrames, motion);
    } else if (motionActionID === MotionActionID.WaitForPlayer) {
        motion_WaitForPlayer_Update(object, motion, viewerInput);
    } else if (motionActionID === MotionActionID.FlyInCircles) {
        motion_FlyInCircles_Update(object, deltaTimeInFrames, motion, viewerInput, levelCollision[0]);
    } else {
        return false;
    }

    return true;
}

function pathGetPoint(dst: vec3, path: Float32Array, i: number): void {
    vec3.set(dst, path[4 * i + 0], path[4 * i + 1], path[4 * i + 2]);
}

const pathScratch = vec3.create();
function pathFindStartIndex(pos: vec3, path: Float32Array): number {
    let minPoint = 0;
    let secPoint = -1;
    let secDist = 0;

    pathGetPoint(pathScratch, path, 0);
    let minDist = vec3.dist(pos, pathScratch);

    for (let i = 1; 4 * i < path.length; i++) {
        pathGetPoint(pathScratch, path, i);
        const d = vec3.dist(pos, pathScratch);
        if (d < minDist) {
            secDist = minDist;
            secPoint = minPoint;
            minDist = d;
            minPoint = i;
        } else if (secPoint < 0 || d < secDist) {
            secDist = d;
            secPoint = i;
        }
    }
    if (minPoint === 0 && secPoint !== 1)
        return 0;
    if (secPoint === 0 && minPoint !== 1)
        return 0;
    return Math.max(minPoint, secPoint);
}

function motionPathHasReachedTarget(motion: MotionState, deltaTimeInFrames: number): boolean {
    return vec3.dist(motion.target, motion.pos) <= motion.speed * deltaTimeInFrames;
}

const pitchTransformScratch = mat4.create();
function pathSimpleAdjustBasePitch(dst: mat4, motion: MotionState, deltaTimeInFrames: number): void {
    if (motion.angleStep * deltaTimeInFrames === 0)
        return;
    motion.angle += motion.angleStep * deltaTimeInFrames;
    const delta = (motion.angleTarget - motion.angle) * motion.angleStep;
    if (delta < 0) {
        motion.angleStep = 0;
        motion.angle = motion.angleTarget;
        const pitch = -Math.atan2(motion.velocity[1], Math.hypot(motion.velocity[0], motion.velocity[2]));
        mat4.fromRotation(dst, pitch, motion.axis);
    } else {
        mat4.fromRotation(pitchTransformScratch, motion.angle, motion.axis);
        mat4.mul(dst, motion.reference, pitchTransformScratch);
    }
}

function motionAngleStep(dst: vec3, motion: MotionState, deltaTimeInFrames: number): number {
    dst[1] += motion.eulerStep[1] * deltaTimeInFrames;
    if (Math.sign(motion.eulerStep[1]) !== Math.sign(angleDist(dst[1], motion.eulerTarget[1]))) {
        dst[1] = motion.eulerTarget[1];
        motion.eulerStep[1] = 0;
    }
    return dst[1];
}

function motionPathAdvancePoint(motion: MotionState, bbox: AABB): void {
    vec3.copy(motion.pos, motion.target);
    motion.pathIndex++;
    if (motion.pathIndex * 4 === motion.parameters.pathPoints.length)
        motion.pathIndex = 0;
    pathGetPoint(motion.target, motion.parameters.pathPoints, motion.pathIndex);
    motion.target[1] -= motion.isTall ? bbox.maxX : bbox.maxY;
}

function motion_PathSpin_Follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        vec3.copy(motion.pos, motion.target);

        motionPathAdvancePoint(motion, object.bbox);
    }

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);

    vec3.sub(motion.velocity, motion.target, motion.pos);
    normToLength(motion.velocity, motion.speed);
}

function motion_PathSpin_Update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    object.euler[1] += 0.05 * deltaTimeInFrames;
    motion_PathSpin_Follow(object, motion, deltaTimeInFrames);
}

function motion_PathRoll_Follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        // Compute angles based on velocity before the point switch
        vec3.normalize(pathScratch, motion.velocity);
        motion.euler2[1] = Math.PI + Math.atan2(pathScratch[0], pathScratch[2]);

        motionPathAdvancePoint(motion, object.bbox);

        // Compute new velocity based on new target.
        vec3.sub(motion.velocity, motion.target, motion.pos);
        const distToTarget = vec3.length(motion.velocity);

        motion.eulerTarget[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
        const framesUntilYaw = distToTarget / (motion.speed === 0 ? 30 : motion.speed);
        motion.eulerStep[1] = angleDist(motion.euler2[1], motion.eulerTarget[1]) / framesUntilYaw;

        normToLength(motion.velocity, motion.speed);
    }

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
}

function motion_PathRoll_Update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    motion.euler2[0] += 0.15 * deltaTimeInFrames;
    motionAngleStep(motion.euler2, motion, deltaTimeInFrames);
    motion_PathRoll_Follow(object, motion, deltaTimeInFrames);
    if (motion.isTall) {
        // reassign euler angles to the corresponding axes after the Z rotation
        vec3.set(pathScratch, motion.euler2[1], -motion.euler2[0], motion.euler2[2]);
        computeKatamariRotation(scratchMatrix, pathScratch);
    } else // this case is Y.X
        computeModelMatrixR(scratchMatrix, motion.euler2[0], motion.euler2[1], 0);
    mat4.mul(object.baseMatrix, scratchMatrix, motion.reference);
}

function motion_PathSimple_Follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, collision: CollisionList[]): void {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        motionPathAdvancePoint(motion, object.bbox);

        vec3.sub(motion.velocity, motion.target, motion.pos);
        const distToTarget = vec3.length(motion.velocity);

        getMatrixAxisZ(pathScratch, object.modelMatrix);

        // compute angles based on forward vector, not current euler angle
        object.euler[1] = Math.atan2(pathScratch[0], pathScratch[2]);

        motion.eulerTarget[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
        const framesUntilYaw = distToTarget / (motion.speed === 0 ? 30 : motion.speed);
        motion.eulerStep[1] = angleDist(object.euler[1], motion.eulerTarget[1]) / framesUntilYaw;

        if (motion.adjustPitch) {
            mat4.copy(motion.reference, object.baseMatrix);
            if (motion.parameters.motionActionID === MotionActionID.PathCollision)
                pathCollisionSetPitchTarget(object, motion, collision);
            else
                pathSimpleSetPitchTarget(object, motion);
            const framesUntilPitch = motion.speed === 0 ? 4 : (0.25 * distToTarget / motion.speed);
            // the angle will actually track how much we've rotated about the axis
            motion.angleStep = motion.angleTarget / framesUntilPitch;
            motion.angle = 0;
        }

        normToLength(motion.velocity, motion.speed);
    }

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
}

function motion_PathSimple_Update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, collision: CollisionList[]): void {
    if (motion.pathIndex < 0) {
        motion.composeEuler = false;
        mat4.identity(object.baseMatrix);
        mat4.identity(motion.reference);
        motion.pathIndex = pathFindStartIndex(motion.pos, motion.parameters.pathPoints);

        // snapping to the first point only happens for COLLISION_PATH, but it fixes some weirdness with starting simple paths
        // which might not be visible in game
        pathGetPoint(motion.pos, motion.parameters.pathPoints, motion.pathIndex);
        motion.pos[1] -= object.bbox.maxY;
        motion.pathIndex++;

        pathGetPoint(motion.target, motion.parameters.pathPoints, motion.pathIndex);
        motion.target[1] -= object.bbox.maxY; // adjust target to object center height, kind of weird because of the coordinate system
        object.euler[1] = Math.PI + Math.atan2(motion.target[0] - motion.pos[0], motion.target[2] - motion.pos[2]);

        object.setAnimation(AnimationType.MOVING);
        vec3.sub(motion.velocity, motion.target, motion.pos);
        normToLength(motion.velocity, motion.speed);
    }

    motionAngleStep(object.euler, motion, deltaTimeInFrames);
    motion_PathSimple_Follow(object, motion, deltaTimeInFrames, collision);

    if (motion.adjustPitch)
        if (motion.parameters.motionActionID === MotionActionID.PathCollision)
            pathCollisionAdjustBasePitch(object.baseMatrix, motion, deltaTimeInFrames);
        else
            pathSimpleAdjustBasePitch(object.baseMatrix, motion, deltaTimeInFrames);
}

function pathCollisionAdjustBasePitch(dst: mat4, motion: MotionState, deltaTimeInFrames: number): void {
    if (motion.angleStep * deltaTimeInFrames === 0)
        return;
    motion.angle += motion.angleStep * deltaTimeInFrames;
    const delta = (motion.angleTarget - motion.angle) * motion.angleStep;
    if (delta < 0) {
        motion.angleStep = 0;
        motion.angle = motion.angleTarget;
    }
    mat4.fromRotation(pitchTransformScratch, -motion.angle, motion.axis);
    mat4.mul(dst, motion.reference, pitchTransformScratch);
}

function pathCollisionSetPitchTarget(object: ObjectRenderer, motion: MotionState, collision: CollisionList[]): void {
    const radius = object.bbox.maxCornerRadius();
    vec3.scaleAndAdd(pathScratch, object.prevPosition, Vec3UnitY, radius);
    findGround(collision, scratchTri, object.prevPosition, pathScratch);
    getMatrixAxisY(pathScratch, object.modelMatrix);
    vec3.scale(pathScratch, pathScratch, -1);
    vec3.cross(motion.axis, scratchTri.normal, pathScratch);
    // set pitch variables
    const dot = vec3.dot(scratchTri.normal, pathScratch);
    motion.angleTarget = Math.acos(clamp(dot, -1, 1));
}

function pathSimpleSetPitchTarget(object: ObjectRenderer, motion: MotionState): void {
    // set rotation axis for pitch, perpendicular to slope
    vec3.set(motion.axis, motion.velocity[2], 0, -motion.velocity[0]);
    vec3.normalize(motion.axis, motion.axis);

    vec3.normalize(motion.velocity, motion.velocity);
    vec3.normalize(pathScratch, pathScratch);
    const dot = -motion.velocity[1] * pathScratch[1] +
        Math.hypot(motion.velocity[0], motion.velocity[2]) * Math.hypot(pathScratch[0], pathScratch[2]);
    motion.angleTarget = Math.acos(clamp(dot, -1, 1));
    if (-motion.velocity[1] < pathScratch[1])
        motion.angleTarget *= -1;
}

function motion_MiscSpin_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    object.euler[1] += .05 * deltaTimeInFrames;
}

function motion_MiscBob_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    if (motion.timer === -1)
        motion.timer = Math.random() * 60;
    if (motion.timer < deltaTimeInFrames) {
        motion.angle += deltaTimeInFrames * Math.PI / 45;
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + object.bbox.maxY * .15 * Math.sin(motion.angle);
    } else {
        motion.timer -= deltaTimeInFrames;
    }
}

const sizeGrouping: number[] = [0, 0, 0, 1, 2, 3, 3, 4, 4, 4, 4, 4];
const hopSpeeds: number[] = [4, 6, 7, 12, 15];

function motion_MiscHop_Init(object: ObjectRenderer, motion: MotionState, allObjects: ObjectRenderer[]): void {
    for (let i = 0; i < allObjects.length; i++) {
        if (allObjects[i] === object)
            continue;
        if (allObjects[i].objectSpawn.dispOnAreaNo !== object.objectSpawn.dispOnAreaNo)
            continue; // assume we only rest on objects in the same area
        if (vec3.dist(allObjects[i].prevPosition, object.prevPosition) > object.bbox.maxCornerRadius() + allObjects[i].bbox.maxCornerRadius())
            continue;
        // game has an optimization (?) to check at successive depths from 1 to 5 - should get same result
        if (landOnObject(object, motion.pos, allObjects[i], 5)) {
            motion.supporter = allObjects[i];
            break;
        }
    }
    motion.speed = hopSpeeds[sizeGrouping[motion.size]];
}

const hopScratch = vec3.create();
function motion_MiscHop_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState, level: CollisionList[]): void {
    if (motion.timer === -1) {
        motion.velocity[1] = -motion.speed;
        motion.g = 1;
        // the code looks like they wanted to make a 20-frame minimum, but doesn't actually do that
        motion.timer = 255 * Math.random();
    }
    if (motion.timer > deltaTimeInFrames) {
        motion.timer -= deltaTimeInFrames;
        return;
    }
    object.setAnimation(AnimationType.IDLE);
    motion.timer = 0;
    motion.velocity[1] += motion.g * deltaTimeInFrames;
    motion.pos[1] += motion.velocity[1] * deltaTimeInFrames;
    if (motion.supporter) {
        if (landOnObject(object, motion.pos, motion.supporter)) {
            motion.timer = -1;
            object.setAnimation(AnimationType.IDLE);
        }
    } else {
        vec3.sub(hopScratch, motion.pos, object.prevPosition);
        normToLength(hopScratch, object.bbox.maxCornerRadius());
        vec3.add(hopScratch, object.prevPosition, hopScratch);
        if (findGround(level, scratchTri, object.prevPosition, hopScratch)) {
            if (object.prevPosition[1] + scratchTri.depth < motion.pos[1] + object.partBBox.maxY) {
                motion.pos[1] = object.prevPosition[1] + scratchTri.depth - object.partBBox.maxY;
                motion.timer = -1;
                object.setAnimation(AnimationType.IDLE);
            }
        }
    }
}

function motion_MiscFlip_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    object.euler[0] -= .05 * deltaTimeInFrames;
}

const swayScratch = vec3.create();
function motion_MiscSway_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    motion.angle += deltaTimeInFrames * Math.PI / 45;
    object.euler[2] = Math.sin(motion.angle) * MathConstants.TAU / 36;

    // translate by new up vector
    if (object.objectSpawn.objectId !== ObjectId.BALANCEDOLL01_C) {
        vec3.set(swayScratch, Math.sin(object.euler[2]), -Math.cos(object.euler[2]), 0);
        transformVec3Mat4w0(swayScratch, object.modelMatrix, swayScratch);
        const bottomOffset = object.partBBox.maxY;
        vec3.scale(swayScratch, swayScratch, bottomOffset);
        motion.pos[0] = object.objectSpawn.modelMatrix[12] + swayScratch[0];
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + swayScratch[1] + bottomOffset;
        motion.pos[2] = object.objectSpawn.modelMatrix[14] + swayScratch[2];
    }
}

function motion_MiscWhackAMole_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    if (motion.timer === -1) {
        motion.timer = Math.random() * 150 + 60;
        motion.angle = Math.PI / 2;
        motion.state = (motion.state + 1) % 2
        motion.angleStep = Math.PI / 45;
    }
    if (motion.timer < deltaTimeInFrames) {
        motion.angle += motion.angleStep * deltaTimeInFrames;
        if (motion.angle > Math.PI) {
            motion.angle = 0;
            motion.timer = -1;
        }
        const buriedDepth = object.partBBox.maxY + (object.partBBox.maxY - object.partBBox.minY);
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + buriedDepth * (motion.state === 0 ? (1 - Math.sin(motion.angle)) : Math.sin(motion.angle));
    } else {
        motion.timer -= deltaTimeInFrames;
    }
}

const cameraScratch = vec3.create();
function toCamera(dst: vec3, pos: vec3, viewerInput: ViewerRenderInput): void {
    getMatrixTranslation(dst, viewerInput.camera.worldMatrix);
    // correct for rotation
    dst[1] *= -1;
    dst[2] *= -1;
    vec3.sub(dst, dst, pos);
}

// there are actually four values per size, with some mapping logic
const panicRadii = [200, 300, 500, 700, 900];

// this logic is more complicated in game, and can include what zone the player is in, as well as their size
function motion_shouldPanic(motion: MotionState, position: vec3, viewerInput: ViewerRenderInput): boolean {
    toCamera(cameraScratch, position, viewerInput);
    const sizeIndex = sizeGrouping[motion.size];
    return vec3.len(cameraScratch) < panicRadii[sizeIndex];
}

function motion_WaitForPlayer_Update(object: ObjectRenderer, motion: MotionState, viewerInput: ViewerRenderInput): void {
    motion.useAltMotion = motion.zone >= 0 && motion_shouldPanic(motion, object.prevPosition, viewerInput);
}

const enum FlyInCirclesState {
    WAITING,
    TURNING,
    TAKEOFF,
    CIRCLING,
    MORE_CIRCLING,
    LANDING,
}

function motion_FlyInCircles_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState, viewerInput: ViewerRenderInput, collision: CollisionList[]): void {
    if (motion.state === -1) {
        motion.state = FlyInCirclesState.WAITING;

        getMatrixAxisZ(cameraScratch, object.modelMatrix);
        object.euler[1] = Math.atan2(cameraScratch[0], cameraScratch[2]);
        mat4.identity(object.baseMatrix);
        motion_alignToGround(object, motion, collision);
        motion.timer = 5 + Math.random() * 15;
    } else if (motion.state === FlyInCirclesState.WAITING) {
        motion.timer -= deltaTimeInFrames;
        if (motion.timer < 0) {
            motion.state = FlyInCirclesState.TURNING;
            toCamera(cameraScratch, object.prevPosition, viewerInput);
            motion.eulerTarget[1] = Math.atan2(cameraScratch[0], cameraScratch[2]);
            motion.eulerStep[1] = angleDist(object.euler[1], motion.eulerTarget[1]) / 6;
        }
    } else if (motion.state === FlyInCirclesState.TURNING) {
        motionAngleStep(object.euler, motion, deltaTimeInFrames);
        if (motion.eulerStep[1] === 0) {
            // combining two states into one
            if (object.altObject) {
                motion.state = FlyInCirclesState.TAKEOFF;
                object.useAltObject = true;
                object.setAnimation(AnimationType.IDLE);

                vec3.set(motion.velocity, Math.sin(object.euler[1]), 0, Math.cos(object.euler[1]));
                vec3.scale(motion.velocity, motion.velocity, -8);
                motion.speed = -30;
                vec3.scaleAndAdd(motion.target, motion.pos, Vec3NegY, 600);
                motion.angle = 0;
                motion.angleStep = .015;
            } else {
                // in game, a bunch of the object struct gets overwritten, including its ID, model part data, and update functions
                motion.useAltMotion = false;
                motion.state = -1;
            }
        }
    } else if (motion.state === FlyInCirclesState.TAKEOFF) {
        motion.angle += motion.angleStep * deltaTimeInFrames;
        if (motion.angle > MathConstants.TAU / 4)
            motion.angle = MathConstants.TAU / 4;
        vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
        motion.pos[1] += Math.sin(motion.angle) * motion.speed;
        if (motion.pos[1] < motion.target[1]) {
            motion.state = FlyInCirclesState.CIRCLING;
            motion.pos[1] = motion.target[1];
            motion.radius = vec3.dist(motion.pos, motion.target);
            motion.timer = 150;
            motion.angle = Math.PI + object.euler[1];
            motion.angleStep = .02;
            // store original position again
            getMatrixTranslation(motion.target, object.objectSpawn.modelMatrix);
        }
    } else if (motion.state === FlyInCirclesState.CIRCLING || motion.state === FlyInCirclesState.MORE_CIRCLING) {
        motion.angle += motion.angleStep * deltaTimeInFrames;
        motion.pos[0] = motion.target[0] + Math.sin(motion.angle) * motion.radius;
        motion.pos[2] = motion.target[2] + Math.cos(motion.angle) * motion.radius;
        object.euler[1] = motion.angle - MathConstants.TAU / 4;

        motion.timer -= deltaTimeInFrames;
        if (motion.timer < 0) {
            if (motion.state === FlyInCirclesState.MORE_CIRCLING) {
                motion.state = FlyInCirclesState.LANDING;
                vec3.sub(motion.velocity, motion.target, motion.pos);
                motion.velocity[1] = 0;
                object.euler[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
                // set speed based on constant descent followed by 60 frames of landing
                const descentHeight = motion.target[1] - 120 - motion.pos[1];
                vec3.scale(motion.velocity, motion.velocity, 1 / (60 + descentHeight / 4));
                motion.angle = 0;
                motion.angleStep = MathConstants.TAU / 240;
                motion.radius = 120;
            } else if (motion_shouldPanic(motion, motion.target, viewerInput)) {
                motion.timer = 150;
            } else {
                motion.timer = 5 + Math.random() * 15;
                motion.state = FlyInCirclesState.MORE_CIRCLING;
            }
        }
    } else if (motion.state === FlyInCirclesState.LANDING) {
        vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
        const decelY = motion.target[1] - motion.radius;
        if (motion.pos[1] < decelY) {
            motion.pos[1] = Math.min(motion.pos[1] + 4 * deltaTimeInFrames, decelY);
        } else {
            motion.angle += motion.angleStep * deltaTimeInFrames;
            if (motion.angle > MathConstants.TAU / 4) {
                motion.angle = MathConstants.TAU / 4;
                motion.state = -1;
                object.useAltObject = false;
                motion.useAltMotion = false;
                object.setAnimation(AnimationType.IDLE);
            }
            motion.pos[1] = decelY + Math.sin(motion.angle) * motion.radius;
        }
    }
}