
import { BINModelInstance } from "./render";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { MissionSetupObjectSpawn, MotionParameters, ObjectDefinition } from "./bin";
import { mat4, vec3 } from "gl-matrix";
import { clamp, angleDist, getMatrixAxisZ, setMatrixTranslation, MathConstants, transformVec3Mat4w0, normToLength, computeModelMatrixR, Vec3UnitZ } from "../MathHelpers";
import { getDebugOverlayCanvas2D, drawWorldSpacePoint, drawWorldSpaceVector, drawWorldSpaceText, drawWorldSpaceLine } from "../DebugJunk";
import { AABB } from "../Geometry";
import { Red, Green, Magenta } from "../Color";
import { computeModelMatrixPosRot } from "../SourceEngine/Main";
import { hexzero, assert } from "../util";

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

    euler: vec3;
    eulerStep: vec3;
    eulerTarget: vec3;
    euler2: vec3;
    euler3: vec3;

    angle: number;
    angleStep: number;
    angleTarget: number;

    base: mat4;
    reference: mat4;
    axis: vec3;

    timer: number;
    state: number;
}

interface ParentState {
    parent: ObjectRenderer;
    parentOffset: vec3;
    inheritedEuler: vec3;
}

const speedTable: number[] = [0.3, 1, 2, 4, 6, 8, 10, 15, 20, 40, 200, 0];

const scratchMatrix = mat4.create();
export class ObjectRenderer {
    public visible = true;

    private animFunc: AnimFunc | null = null;
    public motionState: MotionState | null = null;

    private parentState: ParentState | null = null;
    public modelMatrix = mat4.create();
    public position = vec3.create();

    constructor(public objectSpawn: MissionSetupObjectSpawn, public bbox: AABB, def: ObjectDefinition, public modelInstances: BINModelInstance[], motion: MotionParameters | null) {
        this.animFunc = animFuncSelect(this.objectSpawn.objectId);
        mat4.copy(this.modelMatrix, objectSpawn.modelMatrix);
        mat4.getTranslation(this.position, this.modelMatrix);
        if (motion !== null) {
            // common speed logic, there may be others
            let speed = motion.speed; // from the path
            if (speed < 0) {
                if (def.speedIndex >= 0)
                    speed = speedTable[def.speedIndex];
                else
                    speed = 0;
            }

            const pos = vec3.create();
            mat4.getTranslation(pos, objectSpawn.modelMatrix);
            const isTall = motion.subMotionID === 0x14 && modelInstances.length > 0 &&
                (modelInstances[0].binModelData.binModel.bbox.maxY > modelInstances[0].binModelData.binModel.bbox.maxX);
            this.motionState = {
                parameters: motion,
                useAltMotion: false,
                speed,
                pathIndex: -1,
                adjustPitch: !def.stayLevel,
                isTall,
                composeEuler: true, // inverted from game

                pos,
                target: vec3.create(),
                velocity: vec3.create(),

                euler: vec3.create(), // relative to base, not absolute
                eulerStep: vec3.create(),
                eulerTarget: vec3.create(),
                euler2: vec3.create(),
                euler3: vec3.create(),

                angle: 0,
                angleStep: 0,
                angleTarget: 0,

                base: mat4.clone(objectSpawn.modelMatrix),
                reference: mat4.create(),
                axis: vec3.create(),

                timer: -1,
                state: -1,
            };
        }
    }

    public setParent(parent: ObjectRenderer): void {
        const parentOffset = vec3.create();
        vec3.sub(parentOffset, this.position, parent.position);
        mat4.transpose(scratchMatrix, parent.modelMatrix);
        transformVec3Mat4w0(parentOffset, scratchMatrix, parentOffset);
        this.parentState = {
            parent,
            parentOffset,
            inheritedEuler: vec3.create(),
        };
    }

    private runMotion(deltaTimeInFrames: number): boolean {
        const motionState = this.motionState!;
        const motionID = (motionState.useAltMotion && motionState.parameters.altMotionID !== 0) ? motionState.parameters.altMotionID : motionState.parameters.motionID;
        return runMotionFunc(this, motionState, motionID, deltaTimeInFrames);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, toNoclip: mat4, currentPalette: number): void {
        if (!this.visible)
            return;

        // Game runs at 30fps.
        const deltaTimeInFrames = clamp(viewerInput.deltaTime / 33.0, 0.0, 2.0);

        let updateInstances = false;
        let hasMotionImplementation = false;
        if (this.motionState !== null) {
            hasMotionImplementation = this.runMotion(deltaTimeInFrames);
            vec3.copy(this.position, this.motionState.pos);
            updateInstances = true;

            // TODO(jstpierre): Instead of generic transform structs, make the motions do their own matrix math? That would
            // make the XYZ ordering a lot easier to manage...
            computeModelMatrixR(this.modelMatrix, this.motionState.euler[0], this.motionState.euler[1], this.motionState.euler[2]);
            mat4.mul(this.modelMatrix, this.motionState.base, this.modelMatrix);

            computeModelMatrixR(scratchMatrix, this.motionState.euler2[0], this.motionState.euler2[1], this.motionState.euler2[2]);
            mat4.mul(this.modelMatrix, this.modelMatrix, scratchMatrix);
            computeModelMatrixR(scratchMatrix, this.motionState.euler3[0], this.motionState.euler3[1], this.motionState.euler3[2]);
            mat4.mul(this.modelMatrix, this.modelMatrix, scratchMatrix);
        } else if (this.parentState) {
            // in the game, the parent composition uses the base matrix, which only exists in our motionState
            // instead, make sure the model matrix stays at the initial "base" value before parent transform
            mat4.copy(this.modelMatrix, this.objectSpawn.modelMatrix);
        }

        if (this.parentState) {
            const parent = this.parentState.parent;
            let ancestor = parent;
            while (ancestor.parentState)
                ancestor = ancestor.parentState.parent;
            const ignoreParent = this.objectSpawn.linkAction === 4 || this.objectSpawn.linkAction === 6;
            if (!ignoreParent) {
                updateInstances = true;
                // overwrite position entirely?
                vec3.transformMat4(this.position, this.parentState!.parentOffset, parent.modelMatrix);

                if (ancestor.motionState === null || ancestor.motionState.composeEuler) {
                    // nonsense euler angle transformation
                    let parentEuler: vec3 | null = null;
                    if (parent.parentState)
                        parentEuler = parent.parentState.inheritedEuler;
                    else if (parent.motionState)
                        parentEuler = parent.motionState.euler;
                    if (parentEuler) {
                        transformVec3Mat4w0(this.parentState.inheritedEuler, parent.modelMatrix, parentEuler);
                        computeModelMatrixR(scratchMatrix, this.parentState.inheritedEuler[0], this.parentState.inheritedEuler[1], this.parentState.inheritedEuler[2]);
                        mat4.mul(this.modelMatrix, scratchMatrix, this.modelMatrix);
                    }
                    // add on our own rotation, if any
                    if (this.motionState)
                        vec3.add(this.parentState.inheritedEuler, this.parentState.inheritedEuler, this.motionState.euler);
                } else {
                    // the game stores the base and euler separately for each, but doesn't modify it in this case
                    computeModelMatrixR(scratchMatrix, ancestor.motionState.euler[0], ancestor.motionState.euler[1], ancestor.motionState.euler[2]);
                    mat4.mul(this.modelMatrix, scratchMatrix, this.modelMatrix);
                    mat4.mul(this.modelMatrix, ancestor.motionState.base, this.modelMatrix);
                }
            }
        }

        setMatrixTranslation(this.modelMatrix, this.position);

        // Position model instances correctly.
        if (updateInstances) {
            for (let i = 0; i < this.modelInstances.length; i++) {
                const dst = this.modelInstances[i].modelMatrix;
                computeModelMatrixPosRot(dst, this.modelInstances[i].translation, this.modelInstances[i].euler);
                mat4.mul(dst, this.modelMatrix, dst);
            }
        }

        if (this.animFunc !== null)
            this.animFunc(this, deltaTimeInFrames);

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(renderInstManager, viewerInput, toNoclip, currentPalette);

        const debugMotion = false;
        if (debugMotion) {
            mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, toNoclip);

            if (hasMotionImplementation && this.motionState !== null) {
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.position, Green, 4);
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.target, Green, 4);

                const m = mat4.create();

                mat4.fromYRotation(m, this.motionState.euler[1]);
                transformVec3Mat4w0(swayScratch, m, Vec3UnitZ);
                drawWorldSpaceVector(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.pos, swayScratch, 100, Red);

                mat4.fromYRotation(m, this.motionState.eulerTarget[1]);
                transformVec3Mat4w0(swayScratch, m, Vec3UnitZ);
                drawWorldSpaceVector(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.pos, swayScratch, 100, Green);
            } else {
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.position, Red, 4);
                drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.position, `Object ${hexzero(this.objectSpawn.objectId, 4)}`, 25, Magenta, { outline: 2, shadowBlur: 2 });
                if (this.motionState !== null) {
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.position, `Motion 1 ${hexzero(this.motionState.parameters.motionID, 2)}`, 45, Magenta, { outline: 2, shadowBlur: 2 });
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.position, `Motion 2 ${hexzero(this.motionState.parameters.altMotionID, 2)}`, 65, Magenta, { outline: 2, shadowBlur: 2 });
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.position, `Misc Motion ${hexzero(this.motionState.parameters.subMotionID, 2)}`, 85, Magenta, { outline: 2, shadowBlur: 2 });
                }
            }
            if (this.parentState)
                drawWorldSpaceLine(getDebugOverlayCanvas2D(), scratchMatrix, this.position, this.parentState.parent.position, Magenta);
        }
    }

    public setActiveAreaNo(areaNo: number): void {
        const visible = areaNo >= this.objectSpawn.dispOnAreaNo && ((areaNo < this.objectSpawn.dispOffAreaNo) || this.objectSpawn.dispOffAreaNo === -1);
        this.visible = visible;
    }
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

const enum ObjectId {
    BARBER_D        = 0x001E,
    HUKUBIKI_C      = 0x0023,
    COMPASS_A       = 0x002F,
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
    BIKE04_E        = 0x01B2,
    BIKE05_E        = 0x01B3,
    RADICON02_E     = 0x0220,
    BIKE06_E        = 0x02B0,
    WINDMILL01_G    = 0x02C6,
    KIDDYCAR01_C    = 0x02F1,
    KIDDYCAR02_C    = 0x02F2,
    PLANE02_F       = 0x0382,
    PLANE03_F       = 0x0383,
    ZOKUCAR_E       = 0x0405,
}

function animFuncSelect(objectId: ObjectId): AnimFunc | null {
    switch (objectId) {
    case ObjectId.BARBER_D:     return animFunc_BARBER_D;
    case ObjectId.HUKUBIKI_C:   return animFunc_HUKUBIKI_C;
    case ObjectId.COMPASS_A:    return animFunc_COMPASS_A;
    case ObjectId.WINDMILL01_G: return animFunc_WINDMILL01_G;
    case ObjectId.POLIHOUSE_E:  return animFunc_POLIHOUSE_E;
    case ObjectId.FARMCAR02_E:  return animFunc_FARMCAR02_E;
    case ObjectId.WORKCAR04_F:  return animFunc_WORKCAR04_F;
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

const enum MotionID {
    PathCollision = 0x02,
    PathSpin      = 0x14,
    PathRoll      = 0x15,
    Misc          = 0x16,
    PathSetup     = 0x19,
    PathSimple    = 0x1D,
}

function runMotionFunc(object: ObjectRenderer, motion: MotionState, motionID: MotionID, deltaTimeInFrames: number): boolean {
    if (motionID === MotionID.PathSpin) {
        motion_PathSpin_Update(object, motion, deltaTimeInFrames);
    } else if (motionID === MotionID.PathRoll) {
        motion_PathRoll_Update(object, motion, deltaTimeInFrames);
    } else if (motionID === MotionID.PathSimple || motionID === MotionID.PathCollision) {
        motion_PathSimple_Update(object, motion, deltaTimeInFrames);
    } else if (motionID === MotionID.PathSetup) {
        if (motion.isTall) {
            // Submotion 0x14 seems to suggest we'll transition to PathRoll after.
            assert(motion.parameters.altMotionID === MotionID.PathRoll);

            // If it's taller than it is wide, roll it on its side. Normally, this is implemented
            // by setting a bitflag, and the setup code for PathRoll does the rotation. But since
            // we don't have setup funcs for the states (yet), just do it here in the PathSetup.
            motion.euler3[2] = MathConstants.TAU / 4;
        }

        // TODO(jstpierre): Implement PathSetup properly.
        motion.useAltMotion = true;
        motion_PathSimple_Update(object, motion, deltaTimeInFrames);
    } else if (motionID === MotionID.Misc) {
        const subMotionID = motion.parameters.subMotionID;
        if (subMotionID === 0x15)
            motion_MiscSpin_Update(object, deltaTimeInFrames, motion);
        else if (subMotionID === 0x16)
            motion_MiscBob_Update(object, deltaTimeInFrames, motion);
        else if (subMotionID === 0x1E)
            motion_MiscFlip_Update(object, deltaTimeInFrames, motion);
        else if (subMotionID === 0x20)
            motion_MiscSway_Update(object, deltaTimeInFrames, motion);
        else if (subMotionID === 0x22)
            motion_MiscWhackAMole_Update(object, deltaTimeInFrames, motion);
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
function motionPathAdjustBasePitch(motion: MotionState, deltaTimeInFrames: number): void {
    if (motion.angleStep * deltaTimeInFrames === 0)
        return;
    motion.angle += motion.angleStep * deltaTimeInFrames;
    const delta = (motion.angleTarget - motion.angle) * motion.angleStep;
    if (delta < 0) {
        motion.angleStep = 0;
        motion.angle = motion.angleTarget;
        const pitch = -Math.atan2(motion.velocity[1], Math.hypot(motion.velocity[0], motion.velocity[2]));
        mat4.fromRotation(motion.base, pitch, motion.axis);
    } else {
        mat4.fromRotation(pitchTransformScratch, motion.angle, motion.axis);
        mat4.mul(motion.base, motion.reference, pitchTransformScratch);
    }
}

function motionPathAngleStep(motion: MotionState, deltaTimeInFrames: number): number {
    motion.euler[1] += motion.eulerStep[1] * deltaTimeInFrames;
    if (Math.sign(motion.eulerStep[1]) !== Math.sign(angleDist(motion.euler[1], motion.eulerTarget[1]))) {
        motion.euler[1] = motion.eulerTarget[1];
        motion.eulerStep[1] = 0;
    }
    return motion.euler[1];
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
    motion.euler2[1] += 0.05 * deltaTimeInFrames;
    motion_PathSpin_Follow(object, motion, deltaTimeInFrames);
}

function motion_PathRoll_Follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        // Compute angles based on velocity before the point switch
        vec3.normalize(pathScratch, motion.velocity);
        motion.euler[1] = Math.PI + Math.atan2(pathScratch[0], pathScratch[2]);

        motionPathAdvancePoint(motion, object.bbox);

        // Compute new velocity based on new target.
        vec3.sub(motion.velocity, motion.target, motion.pos);
        const distToTarget = vec3.length(motion.velocity);

        motion.eulerTarget[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
        const framesUntilYaw = distToTarget / (motion.speed === 0 ? 30 : motion.speed);
        motion.eulerStep[1] = angleDist(motion.euler[1], motion.eulerTarget[1]) / framesUntilYaw;

        // TODO(jstpierre): Verify, but I don't believe that adjustPitch support exists in the PathRoll code.

        normToLength(motion.velocity, motion.speed);
    }

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
}

function motion_PathRoll_Update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    motion.euler2[0] += 0.15 * deltaTimeInFrames;
    motionPathAngleStep(motion, deltaTimeInFrames);
    motion_PathRoll_Follow(object, motion, deltaTimeInFrames);
}

function motion_PathSimple_Follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        motionPathAdvancePoint(motion, object.bbox);

        vec3.sub(motion.velocity, motion.target, motion.pos);
        const distToTarget = vec3.length(motion.velocity);

        getMatrixAxisZ(pathScratch, object.modelMatrix);

        // compute angles based on forward vector, not current euler angle
        motion.euler[1] = Math.atan2(pathScratch[0], pathScratch[2]);

        motion.eulerTarget[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
        const framesUntilYaw = distToTarget / (motion.speed === 0 ? 30 : motion.speed);
        motion.eulerStep[1] = angleDist(motion.euler[1], motion.eulerTarget[1]) / framesUntilYaw;

        // TODO: figure out what's going on with the collision check for COLLISION_PATH
        if (motion.adjustPitch) {
            mat4.copy(motion.reference, motion.base);
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
            const framesUntilPitch = motion.speed === 0 ? 4 : (0.25 * distToTarget / motion.speed);
            // pitch will actual track how much we've rotated about the axis
            motion.angleStep = motion.angleTarget / framesUntilPitch;
            motion.angle = 0;
        }

        normToLength(motion.velocity, motion.speed);
    }

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
}

function motion_PathSimple_Update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    if (motion.pathIndex < 0) {
        mat4.identity(motion.base);
        motion.composeEuler = false;
        motion.pathIndex = pathFindStartIndex(motion.pos, motion.parameters.pathPoints);

        // snapping to the first point only happens for COLLISION_PATH, but it fixes some weirdness with starting simple paths
        // which might not be visible in game
        pathGetPoint(motion.pos, motion.parameters.pathPoints, motion.pathIndex);
        motion.pos[1] -= object.bbox.maxY;
        motion.pathIndex++;

        pathGetPoint(motion.target, motion.parameters.pathPoints, motion.pathIndex);
        motion.target[1] -= object.bbox.maxY; // adjust target to object center height, kind of weird because of the coordinate system
        motion.euler[1] = Math.PI + Math.atan2(motion.target[0] - motion.pos[0], motion.target[2] - motion.pos[2]);

        vec3.sub(motion.velocity, motion.target, motion.pos);
        normToLength(motion.velocity, motion.speed);
    }

    motionPathAngleStep(motion, deltaTimeInFrames);
    motion_PathSimple_Follow(object, motion, deltaTimeInFrames);

    if (motion.adjustPitch)
        motionPathAdjustBasePitch(motion, deltaTimeInFrames);
}

function motion_MiscSpin_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    motion.euler[1] += .05 * deltaTimeInFrames;
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

function motion_MiscFlip_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    motion.euler[0] -= .05 * deltaTimeInFrames;
}

const swayScratch = vec3.create();
function motion_MiscSway_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    motion.angle += deltaTimeInFrames * Math.PI / 45;
    motion.euler[2] = Math.sin(motion.angle) * MathConstants.TAU / 36;

    // translate by new up vector
    if (object.objectSpawn.objectId !== ObjectId.BALANCEDOLL01_C) {
        vec3.set(swayScratch, Math.sin(motion.euler[2]), -Math.cos(motion.euler[2]), 0);
        transformVec3Mat4w0(swayScratch, object.modelMatrix, swayScratch);
        const bottomOffset = object.modelInstances[0].binModelData.binModel.bbox.maxY;
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
        const firstBBox = object.modelInstances[0].binModelData.binModel.bbox;
        const buriedDepth = firstBBox.maxY + (firstBBox.maxY - firstBBox.minY);
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + buriedDepth * (motion.state === 0 ? (1 - Math.sin(motion.angle)) : Math.sin(motion.angle));
    } else {
        motion.timer -= deltaTimeInFrames;
    }
}
