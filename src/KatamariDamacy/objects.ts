
import { BINModelInstance } from "./render";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { MissionSetupObjectSpawn, MotionParameters, ObjectDefinition } from "./bin";
import { mat4, vec3 } from "gl-matrix";
import { clamp, Vec3Zero, angleDist, computeModelMatrixSRT, getMatrixAxisZ, setMatrixTranslation, MathConstants, transformVec3Mat4w0, normToLength, computeModelMatrixR } from "../MathHelpers";
import { getDebugOverlayCanvas2D, drawWorldSpacePoint, drawWorldSpaceText } from "../DebugJunk";
import { AABB } from "../Geometry";
import { Magenta } from "../Color";
import { hexzero } from "../util";

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
    pathIndex: number;
    speed: number;

    euler: vec3;
    eulerStep: vec3;
    eulerTarget: vec3;

    euler2: vec3;

    angle: number;
    angleStep: number;
    angleTarget: number;

    base: mat4;
    reference: mat4;
    final: mat4;
    axis: vec3;

    timer: number;
    state: number;
}

const speedTable: number[] = [0.3, 1, 2, 4, 6, 8, 10, 15, 20, 40, 200, 0];

const objectPosScratch = vec3.create();
const scratchMatrix = mat4.create();
export class ObjectRenderer {
    public modelInstance: BINModelInstance[] = [];
    public visible = true;

    private animFunc: AnimFunc | null = null;
    public motionState: MotionState | null = null;

    constructor(public objectSpawn: MissionSetupObjectSpawn, public bbox: AABB, def: ObjectDefinition, motion: MotionParameters | null) {
        this.animFunc = animFuncSelect(this.objectSpawn.objectId);
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
            this.motionState = {
                parameters: motion,
                useAltMotion: false,
                speed,
                pathIndex: -1,
                adjustPitch: !def.stayLevel,

                pos,
                target: vec3.create(),
                velocity: vec3.create(),

                euler: vec3.create(), // relative to base, not absolute
                eulerStep: vec3.create(),
                eulerTarget: vec3.create(),
                euler2: vec3.create(),

                angle: 0,
                angleStep: 0,
                angleTarget: 0,

                base: mat4.clone(objectSpawn.modelMatrix),
                reference: mat4.create(),
                final: mat4.create(),
                axis: vec3.create(),

                timer: -1,
                state: -1,
            };
        }
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

        if (this.motionState !== null) {
            vec3.copy(objectPosScratch, this.motionState.pos);

            // TODO(jstpierre): I think we should just be able to rebuild always -- makes things a lot easier and
            // some tiny extra ALU cost isn't where our perf is going to be hitting us hard, I think.
            const rebuild = this.runMotion(deltaTimeInFrames);

            if (rebuild) {
                // TODO(jstpierre): Instead of generic transform structs, make the motions do their own setup? That would
                // make the XYZ ordering a lot easier to manage...
                computeModelMatrixR(this.motionState.final, this.motionState.euler[0], this.motionState.euler[1], this.motionState.euler[2]);
                mat4.mul(this.motionState.final, this.motionState.base, this.motionState.final);
                computeModelMatrixR(scratchMatrix, this.motionState.euler2[0], this.motionState.euler2[1], this.motionState.euler2[2]);
                mat4.mul(this.motionState.final, this.motionState.final, scratchMatrix);
                setMatrixTranslation(this.motionState.final, this.motionState.pos);
            }

            for (let i = 0; i < this.modelInstance.length; i++) {
                const dst = this.modelInstance[i].modelMatrix;
                if (rebuild) {
                    computeModelMatrixSRT(dst,
                        1, 1, 1,
                        this.modelInstance[i].euler[0], this.modelInstance[i].euler[1], this.modelInstance[i].euler[2],
                        this.modelInstance[i].translation[0], this.modelInstance[i].translation[1], this.modelInstance[i].translation[2],
                    );
                    mat4.mul(dst, this.motionState.final, dst);
                } else {
                    dst[12] += this.motionState.pos[0] - objectPosScratch[0];
                    dst[13] += this.motionState.pos[1] - objectPosScratch[1];
                    dst[14] += this.motionState.pos[2] - objectPosScratch[2];
                }
            }
        }

        if (this.animFunc !== null)
            this.animFunc(this, deltaTimeInFrames);

        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].prepareToRender(renderInstManager, viewerInput, toNoclip, currentPalette);

        if (this.motionState !== null && this.motionState.useAltMotion) {
            mat4.identity(scratchMatrix);
            mat4.rotateX(scratchMatrix, scratchMatrix, Math.PI);
            mat4.mul(scratchMatrix, scratchMatrix, this.modelInstance[0].modelMatrix);
            mat4.mul(scratchMatrix, window.main.viewer.camera.clipFromWorldMatrix, scratchMatrix);
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, Vec3Zero, Magenta, 4);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, Vec3Zero, `Object ${hexzero(this.objectSpawn.objectId, 4)}`, 25, Magenta, { outline: 2, shadowBlur: 2 });
            drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, Vec3Zero, `Motion 1 ${hexzero(this.motionState.parameters.motionID, 2)}`, 45, Magenta, { outline: 2, shadowBlur: 2 });
            drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, Vec3Zero, `Motion 2 ${hexzero(this.motionState.parameters.altMotionID, 2)}`, 65, Magenta, { outline: 2, shadowBlur: 2 });
            drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, Vec3Zero, `Misc Motion ${hexzero(this.motionState.parameters.subMotionID, 2)}`, 85, Magenta, { outline: 2, shadowBlur: 2 });
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

    if (axis === Axis.X)
        mat4.rotateX(modelInstance.modelMatrix, modelInstance.modelMatrix, angle);
    else if (axis === Axis.Y)
        mat4.rotateY(modelInstance.modelMatrix, modelInstance.modelMatrix, angle);
    else if (axis === Axis.Z)
        mat4.rotateZ(modelInstance.modelMatrix, modelInstance.modelMatrix, angle);

    modelInstance.euler[axis] += angle;
}

function scrollTexture(modelInstance: BINModelInstance, deltaTimeInFrames: number, axis: Axis, value: number): void {
    const offs = value * deltaTimeInFrames;

    if (axis === Axis.X)
        modelInstance.textureMatrix[12] += offs;
    else if (axis === Axis.Y)
        modelInstance.textureMatrix[13] += offs;
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
        return vehicleAnimFunc;
    case ObjectId.PLANE02_F: return animFunc_PLANE02_F;
    case ObjectId.PLANE03_F: return animFunc_PLANE03_F;
    }
    return null;
}

function animFunc_BARBER_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    // XXX(jstpierre): 100% empirical, not from game code at all, just want to show
    // how to use scrollTexture() basically.
    scrollTexture(object.modelInstance[1], deltaTimeInFrames, Axis.X, -0.001);
}

function animFunc_HUKUBIKI_C(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstance[1], deltaTimeInFrames, Axis.Z, 1.0);
}

function animFunc_COMPASS_A(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstance[1], deltaTimeInFrames, Axis.Y, 1.0);
}

function animFunc_WINDMILL01_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstance[1], deltaTimeInFrames, Axis.Z, 12.0);
}

function animFunc_POLIHOUSE_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstance[1], deltaTimeInFrames, Axis.Z, 1.0);
}

function animFunc_PLANE02_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstance[1], deltaTimeInFrames, Axis.Y, 16.8);
    rotateObject(object.modelInstance[2], deltaTimeInFrames, Axis.X, 16.8);
}

function animFunc_PLANE03_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstance[0], deltaTimeInFrames, Axis.Z, 16.8);
    rotateObject(object.modelInstance[2], deltaTimeInFrames, Axis.Z, 16.8);
}

function vehicleAnimFunc(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return; // don't turn the wheels if we aren't moving
    // really feels like this should depend on movement speed
    rotateObject(object.modelInstance[1], deltaTimeInFrames, Axis.X, -4.0);
    rotateObject(object.modelInstance[2], deltaTimeInFrames, Axis.X, -4.0);
}

const enum MotionID {
    PATH_COLLISION = 0x02,
    PATH_ROLL      = 0x15,
    MISC           = 0x16,
    PATH_SETUP     = 0x19,
    PATH_SIMPLE    = 0x1D,
}

function runMotionFunc(object: ObjectRenderer, motion: MotionState, motionID: MotionID, deltaTimeInFrames: number): boolean {
    if (motionID === MotionID.PATH_ROLL) {
        motion.euler2[0] += 0.15 * deltaTimeInFrames;
        motionPathAngleStep(motion, deltaTimeInFrames);
        motionPathFollowBasic(object, motion, deltaTimeInFrames, true);
        return true;
    } else if (motionID === MotionID.PATH_SIMPLE || motionID === MotionID.PATH_COLLISION) {
        return followPath(object, motion, deltaTimeInFrames);
    } else if (motionID === MotionID.PATH_SETUP) {
        // TODO(jstpierre): Set up the path differently based on the submotion.
        motion.useAltMotion = true;
        return followPath(object, motion, deltaTimeInFrames);
    } else if (motionID === MotionID.MISC) {
        const subMotionID = motion.parameters.subMotionID;
        if (subMotionID === 0x15)
            return miscSpinMotionFunc(object, deltaTimeInFrames, motion);
        else if (subMotionID === 0x16)
            return miscBobMotionFunc(object, deltaTimeInFrames, motion);
        else if (subMotionID === 0x1E)
            return miscFlipMotionFunc(object, deltaTimeInFrames, motion);
        else if (subMotionID === 0x20)
            return miscSwayMotionFunc(object, deltaTimeInFrames, motion);
        else if (subMotionID === 0x22)
            return miscWhackAMoleMotionFunc(object, deltaTimeInFrames, motion);
    }

    // Nothing.
    return false;
}

function pathPoint(dst: vec3, path: Float32Array, i: number): void {
    vec3.set(dst, path[4 * i + 0], path[4 * i + 1], path[4 * i + 2]);
}

const pathScratch = vec3.create();
function pathFindStartIndex(pos: vec3, path: Float32Array): number {
    let minPoint = 0;
    let secPoint = -1;
    let secDist = 0;

    pathPoint(pathScratch, path, 0);
    let minDist = vec3.dist(pos, pathScratch);

    for (let i = 1; 4 * i < path.length; i++) {
        pathPoint(pathScratch, path, i);
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

function motionPathTargetNextPoint(motion: MotionState, yOffset: number, calcEuler: boolean): void {
    vec3.copy(motion.pos, motion.target);
    motion.pathIndex++;
    if (motion.pathIndex * 4 === motion.parameters.pathPoints.length)
        motion.pathIndex = 0;
    pathPoint(motion.target, motion.parameters.pathPoints, motion.pathIndex);
    motion.target[1] -= yOffset;

    vec3.sub(motion.velocity, motion.target, motion.pos);
    const distToTarget = vec3.length(motion.velocity);

    getMatrixAxisZ(pathScratch, motion.final);

    if (calcEuler) {
        // compute angles based on forward vector, not current euler angle
        motion.euler[1] = Math.atan2(pathScratch[0], pathScratch[2]);

        motion.eulerTarget[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
        const framesUntilYaw = distToTarget / (motion.speed === 0 ? 30 : motion.speed);
        motion.eulerStep[1] = angleDist(motion.euler[1], motion.eulerTarget[1]) / framesUntilYaw;
    }

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

function motionPathFollowBasic(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, calcEuler: boolean): void {
    if (vec3.dist(motion.target, motion.pos) <= motion.speed * deltaTimeInFrames)
        motionPathTargetNextPoint(motion, object.bbox.maxY, calcEuler);

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
}

function followPath(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): boolean {
    if (motion.pathIndex < 0) {
        mat4.identity(motion.base);
        motion.pathIndex = pathFindStartIndex(motion.pos, motion.parameters.pathPoints);

        // snapping to the first point only happens for COLLISION_PATH, but it fixes some weirdness with starting simple paths
        // which might not be visible in game
        pathPoint(motion.pos, motion.parameters.pathPoints, motion.pathIndex);
        motion.pos[1] -= object.bbox.maxY;
        motion.pathIndex++;

        pathPoint(motion.target, motion.parameters.pathPoints, motion.pathIndex);
        motion.target[1] -= object.bbox.maxY; // adjust target to object center height, kind of weird because of the coordinate system
        motion.euler[1] = Math.PI + Math.atan2(motion.target[0] - motion.pos[0], motion.target[2] - motion.pos[2]);

        vec3.sub(motion.velocity, motion.target, motion.pos);
        normToLength(motion.velocity, motion.speed);
    }

    motionPathAngleStep(motion, deltaTimeInFrames);
    motionPathFollowBasic(object, motion, deltaTimeInFrames, true);

    if (motion.adjustPitch)
        motionPathAdjustBasePitch(motion, deltaTimeInFrames);

    return true;
}

function miscSpinMotionFunc(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): boolean {
    motion.euler[1] += .05 * deltaTimeInFrames;
    return true;
}

function miscBobMotionFunc(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): boolean {
    if (motion.timer === -1)
        motion.timer = Math.random() * 60;
    if (motion.timer < deltaTimeInFrames) {
        motion.angle += deltaTimeInFrames * Math.PI / 45;
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + object.bbox.maxY * .15 * Math.sin(motion.angle);
    } else
        motion.timer -= deltaTimeInFrames;

    return false;
}

function miscFlipMotionFunc(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): boolean {
    motion.euler[0] -= .05 * deltaTimeInFrames;
    return true;
}

const swayScratch = vec3.create();
function miscSwayMotionFunc(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): boolean {
    motion.angle += deltaTimeInFrames * Math.PI / 45;
    motion.euler[2] = Math.sin(motion.angle) * MathConstants.TAU / 36;

    // translate by new up vector
    if (object.objectSpawn.objectId !== ObjectId.BALANCEDOLL01_C) {
        vec3.set(swayScratch, Math.sin(motion.euler[2]), -Math.cos(motion.euler[2]), 0);
        transformVec3Mat4w0(swayScratch, motion.final, swayScratch);
        const bottomOffset = object.modelInstance[0].binModelData.binModel.bbox.maxY;
        vec3.scale(swayScratch, swayScratch, bottomOffset);
        motion.pos[0] = object.objectSpawn.modelMatrix[12] + swayScratch[0];
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + swayScratch[1] + bottomOffset;
        motion.pos[2] = object.objectSpawn.modelMatrix[14] + swayScratch[2];
    }
    return true;
}

function miscWhackAMoleMotionFunc(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): boolean {
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
        const firstBBox = object.modelInstance[0].binModelData.binModel.bbox;
        const buriedDepth = firstBBox.maxY + (firstBBox.maxY - firstBBox.minY);
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + buriedDepth * (motion.state === 0 ? (1 - Math.sin(motion.angle)) : Math.sin(motion.angle));
    } else
        motion.timer -= deltaTimeInFrames;
    return false;
}
