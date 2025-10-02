import * as Viewer from '../viewer.js';
import * as F3DEX from "../BanjoKazooie/f3dex.js";
import * as RDP from '../Common/N64/RDP.js';
import * as UI from '../ui.js';

import { vec3, mat4, vec2, vec4, ReadonlyVec3, ReadonlyVec2 } from 'gl-matrix';
import { computeModelMatrixSRT, computeModelMatrixT, scaleMatrix, Vec3UnitX, Vec3UnitY, Vec3Zero, clamp, lerp, lerpAngle } from '../MathHelpers.js';
import { Mk64SkyRenderer, BasicRspRenderer, Mk64RenderLayer } from './render.js';
import { Light1, MkRSPState } from './f3dex.js';
import { nArray } from '../gfx/platform/GfxPlatformUtil.js';
import { RSP_Geometry } from '../BanjoKazooie/f3dex.js';
import { F3DEX_Program } from '../BanjoKazooie/render.js';
import { GfxBindingLayoutDescriptor, GfxDevice, GfxTexture } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { NumberHolder } from '../MetroidPrime/particles/base_generator.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { makeMtxFrontUpPos } from '../SuperMarioGalaxy/ActorUtil.js';
import { CollisionGrid, ObjectCollision } from './collision.js';
import { Actor, ActorBowsersCastleBush, ActorCactus1, ActorCactus2, ActorCactus3, ActorCow, ActorCrossbuck, ActorFallingRock, ActorFlags, ActorItemBox, ActorJungleTree, ActorLuigiTree, ActorMarioSign, ActorMarioTree, ActorMooMooFarmTree, ActorPalmTree, ActorPeachCastleTree, ActorPiranhaPlant, ActorRoyalRacewayTree, ActorSnowTree, ActorType, ActorWarioSign, ActorWaterBanshee, ActorYoshiEgg, ActorYoshiTree, DebugActor } from './actors.js';
import { rotatePositionAroundPivot, setShadowSurfaceAngle, calcPitch, stepTowardsAngle, calcTargetAngleY, hashFromValues, kmToSpeed, random_int, random_u16, rotateVectorXY, IsTargetInRangeXZ, calcModelMatrix, crossedTime, IsTargetInRangeXYZ, lerpBinAngle, BinAngleToRad, RadToBinAngle, readActorSpawnData, readPathData, normalizeAngle } from './utils.js';
import { drawWorldSpaceLine, drawWorldSpaceLocator, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { Color, colorNewFromRGBA8, Green, Yellow } from '../Color.js';
import { assert, mod } from '../util.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxrAttachmentSlot, GfxrTemporalTexture } from '../gfx/render/GfxRenderGraph.js';
import { TextureHolder, TextureMapping } from '../TextureHolder.js';
import { Camera, CameraController, computeViewMatrix } from '../Camera.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { CourseId } from './scenes.js';
import { getTimeInFrames } from '../AnimationController.js';
import { getDerivativeBspline, getPointBspline } from '../Spline.js';
import { interpS16 } from '../StarFoxAdventures/util.js';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { Mk64Anim, Mk64AnimTrack, Mk64Point, dMapSkyColors, Mk64ActorSpawnData, Mk64Cloud, dCourseCpuMaxSeparation, dThwompSpawns150CC, dFireBreathsSpawns, dThwompLights, dDustAngleOffsets, dDustPosOffsets, dFlamePillarSpawnsA, dFlamePillarSpawnsB, dFlamePillarSpawnsC, dSnowmanSpawns, dFlagPoleSpawns, dHedgehogSpawns, dHedgehogPatrolPoints, dCrabSpawns, dDkJungleTorchSpawns, dStaticNeonSpawns, dPenguinPath, dMoleSpawns, ThwompType, dBooPaths, seagullPathList, dCourseData } from './course_data.js';

export let IS_WIREFRAME: boolean = false;
export let DELTA_TIME: number = 1.0;
let SCENE_TIME: number = 1.0;

const lastCamWorldMtx = mat4.create();
const scratchMtx1 = mat4.create();
const scratchMtx2 = mat4.create();

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec2a = vec2.create();
const Vec2Zero: ReadonlyVec2 = vec2.fromValues(0, 0);

class Mk64Bone {
    public index: number = 0;
    public parentIndex: number = -1;
    public pos: vec3 = vec3.create();
    public mesh: BasicRspRenderer | null = null;
}

class SkelAnimController {
    private curAnim: number;

    public bones: Mk64Bone[];
    private boneMatrices: mat4[] = [];
    private animations: Mk64Anim[];

    constructor(private globals: Mk64Globals, setupDL: number, skeletonOffs: number, animListOffs: number, animCount: number) {
        this.bones = this.getSkeleton(skeletonOffs, setupDL);
        this.animations = this.getAnimations(animListOffs, animCount);
        this.curAnim = 0;
    }

    // Custom skeleton format so it's easier to process
    private getSkeleton(segOffset: number, setupDL: number): Mk64Bone[] {
        const skeleton: Mk64Bone[] = [];

        const buffer = this.globals.segmentBuffers[(segOffset >>> 24)];
        const view = buffer.createDataView();

        let offs = segOffset & 0x00FFFFFF;
        const boneCount = view.getUint32(offs + 0x00);

        this.boneMatrices = nArray(boneCount, () => mat4.create());

        F3DEX.runDL_F3DEX(this.globals.rspState, setupDL);

        for (let i = 0; i < boneCount; i++) {
            const bone = new Mk64Bone();

            const index = view.getUint32(offs + 0x04);
            const parentIndex = view.getInt32(offs + 0x08);
            const posX = view.getInt32(offs + 0x0C);
            const posY = view.getInt32(offs + 0x10);
            const posZ = view.getInt32(offs + 0x14);
            const dl = view.getInt32(offs + 0x18);

            bone.index = index;
            bone.parentIndex = parentIndex;
            vec3.set(bone.pos, posX, posY, posZ);

            if (dl !== 0) {
                bone.mesh = this.globals.initRendererFromDL(dl);
            }

            offs += 0x18;
            computeModelMatrixT(this.boneMatrices[i], posX, posY, posZ);

            skeleton.push(bone);
        }

        return skeleton;
    }

    private getAnimations(animsSegOffset: number, animCount: number): Mk64Anim[] {
        const animations: Mk64Anim[] = [];
        const buffer = this.globals.segmentBuffers[(animsSegOffset >>> 24)];
        const view = buffer.createDataView();

        const animListOffs = (animsSegOffset & 0xFFFFFF);
        for (let i = 0; i < animCount; i++) {
            const animOffs = (view.getUint32(animListOffs + (i * 4)) & 0xFFFFFF);

            const type = view.getUint16(animOffs + 0x00);
            const unk02 = view.getUint16(animOffs + 0x02);
            const unk04 = view.getUint16(animOffs + 0x04);
            const unk06 = view.getUint16(animOffs + 0x06);
            const duration = view.getUint16(animOffs + 0x08);
            const boneCount = view.getUint16(animOffs + 0x0A);
            const dataOffs = view.getInt32(animOffs + 0x0C) & 0xFFFFFF;
            let prmOffs = view.getInt32(animOffs + 0x10) & 0xFFFFFF;

            const getTrack = (valueScale: number = 1.0): Mk64AnimTrack => {
                const x: number[] = [], y: number[] = [], z: number[] = [];

                for (let axis = 0; axis < 3; axis++) {
                    const frameCount = view.getUint16(prmOffs);
                    const dataIndex = view.getUint16(prmOffs + 0x02);

                    const frameDataOffs = dataOffs + (dataIndex * 2);

                    for (let f = 0; f < frameCount; f++) {
                        const value = view.getInt16(frameDataOffs + (f * 2)) * valueScale;

                        switch (axis) {
                            case 0: x.push(value); break;
                            case 1: y.push(value); break;
                            case 2: z.push(value); break;
                        }
                    }

                    prmOffs += 0x04;
                }

                return { x, y, z };
            };


            const rootTrack = getTrack();
            const rotTracks: Mk64AnimTrack[] = [];

            for (let j = 0; j < boneCount; j++) {
                rotTracks.push(getTrack(BinAngleToRad));
            }

            animations.push({
                duration,
                translationTrack: rootTrack,
                rotationTracks: rotTracks
            });
        }

        return animations;
    }

    public getAnimationDuration(animIndex: number): number {
        return this.animations[animIndex].duration - 1;
    }

    public setCurrentAnimation(animIndex: number): void {
        this.curAnim = animIndex;
    }

    public getNextFrameTime(frameTime: number): number {
        const anim = this.animations[this.curAnim];

        return (frameTime + DELTA_TIME) % anim.duration;
    }

    public setAnimFrame(pos: vec3, rot: vec3, scale: number, frameTime: number): void {
        const anim = this.animations[this.curAnim];

        function getTrackFrameValue(values: number[], isAngle: boolean = false): number {
            const frameCount = values.length;

            if (frameCount === 0) return 0;
            else if (frameCount === 1) return values[0];

            const timeInt = Math.floor(frameTime);

            const idx0 = timeInt % frameCount;
            const idx1 = (idx0 + 1) % frameCount;

            const t = frameTime - timeInt;

            const v0 = values[idx0];
            const v1 = values[idx1];

            return isAngle ? lerpAngle(v0, v1, t) : lerp(v0, v1, t);
        }

        calcModelMatrix(this.boneMatrices[0], pos, rot, scale);

        for (let i = 0; i < anim.rotationTracks.length; i++) {
            const bone = this.bones[i + 1];
            const boneMtx = this.boneMatrices[bone.index];

            let rotX = getTrackFrameValue(anim.rotationTracks[i].x, true);
            let rotY = getTrackFrameValue(anim.rotationTracks[i].y, true);
            let rotZ = getTrackFrameValue(anim.rotationTracks[i].z, true);

            computeModelMatrixSRT(boneMtx, 1, 1, 1, rotX, rotY, rotZ, bone.pos[0], bone.pos[1], bone.pos[2]);

            if (i === 0) {
                boneMtx[12] += getTrackFrameValue(anim.translationTrack.x);
                boneMtx[13] += getTrackFrameValue(anim.translationTrack.y);
                boneMtx[14] += getTrackFrameValue(anim.translationTrack.z);
            }

            const parentBoneMatrix = bone.parentIndex >= 0 ? this.boneMatrices[bone.parentIndex] : this.boneMatrices[0];
            mat4.mul(boneMtx, parentBoneMatrix, boneMtx);
        }
    }

    public renderSkeleton(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (const bone of this.bones) {
            if (bone.mesh !== null) {
                bone.mesh.prepareToRender(renderInstManager, viewerInput, this.boneMatrices[bone.index]);
            }
        }
    }
}

enum EntityType {
    TrainSmoke = 1,
    ThwompDust = 2,
    ThwompBrokenShard = 3,
    BowserStatueFire = 4,
    BowserStatueFireSmall = 5,
    FerrySmoke = 6,
    FlamePillar = 9,
    DkJungleTorch = 11,
    Bat = 13,
    Star = 255
}

enum EntityFlags {
    HasMovementStarted = 1 << 3,
    IsRenderingActive = 1 << 4,
    HasShadow = 1 << 5,
    FlipX = 1 << 7,
    unk_8 = 1 << 8,
    IsCollisionActive = 1 << 9,
    CanCollideWithGround = 1 << 10,
    HasBeenHit = 1 << 12,
    CalcSplineVelocity = 1 << 11,
    HasAnimStarted = 1 << 13,
    IsAnimReversed = 1 << 14,
    IsNearArea = 1 << 16,
    IsInArea = 1 << 17,
    IsVisible = 1 << 18,//Is visible on screen
    IsHidden = 1 << 19,
    HasLodDisplay = 1 << 20,//Used for the balloon in Luigi Raceway
    IsAnyPlayerNear = 1 << 21,
    IsCollisionCheckOn = 1 << 22,
    IsOnSurface = 1 << 23,
    Unk24 = 1 << 24,
    IsHitByStar = 1 << 25,

    // Related to time trials? 0x04000000
    unk_26 = 1 << 26
}

class Entity {
    public frameTime: number = 0;// Used for skeletal animations
    public modelInst: BasicRspRenderer;

    /**0x00*/ public scale: NumberHolder = { value: 1 };
    /**0x04*/ public pos: vec3 = vec3.create();
    /**0x10*/ public originPos: vec3 = vec3.create();
    /**0x1C*/ public targetPos: vec3 = vec3.create();
    /**0x28*/ public offset: vec3 = vec3.create();

    /**0x34*/ public speed: NumberHolder = { value: 0 };
    /**0x38*/ public velocity: vec3 = vec3.create();

    /**0x44*/ public surfaceHeight = 0;

    /**0x48*/ public userTimer: number = 0;
    /**0x4C*/ public timer: number = 0;
    /**0x50*/ public texAnimTimer: number = 0;

    /**0x54*/ public flags: number = 1;
    /**0x58*/ public eventFlags: number = 0;
    /**0x5C   public unk05C: number = 0;*/
    /**0x60*/ public activeTLUT: number = 0;
    /**0x64*/ public activeTexture: number = 0;
    /**0x68*/ public texLutListAddr: number = 0;
    /**0x6C*/ public textureListAddr: number = 0;

    /**0x70*/ public displayList: number = 0;
    /**0x74*/ public vertex: number = 0;
    /**0x7C*/ public splineIndex: number = 0;
    /**0x80*/ public splinePath: Mk64Point[];

    /**0x84*/ public historyStack: number[] = nArray(0xA, () => 0);

    /**0x98*/ public splineTime: number = 0;
    /**0x9A*/ public splineDelta: number = 0;
    /**0x9C*/ public splineTargetX: number = 0;
    /**0x9E*/ public splineTargetZ: number = 0;

    /**0xA0*/ public primAlpha: NumberHolder = { value: 0 };
    /**0xA2*/ public userValA: NumberHolder = { value: 0 };
    /**0xA4*/ public userValB: NumberHolder = { value: 0 };
    /**0xA6*/ public state: number = 0;
    /**0xA8*/ public unk0A8: number = 0;
    /**0xAA*/ public f32AnimTimer: number = 0;
    /**0xAC*/ public s16AnimTimer: number = 0;

    /**0xAE*/ public actionState: number = 0;
    /**0xB0*/ public actionTimer: number = 0;
    /**0xB2*/ public orientation: vec3 = vec3.create();
    /**0xB8*/ public shadowDir: vec3 = vec3.create();

    /**0xBE*/ public direction: vec3 = vec3.create();
    /**0xC4*/ public directionStep: number = 0;
    /**0xC6*/ public targetDirection: NumberHolder = { value: 0 };
    /**0xC8*/ public boundingBoxSize: number = 0;

    /**0xCA*/ public isInitialized: boolean = false;

    /**0xCB*/ public isTextureTimerActive: boolean = false;
    /**0xCC*/ public texAnimLoopCount: number = 0;

    /**0xCD*/ public f32AnimStatus: number = 0;
    /**0xCE*/ public f32AnimLoopCount: number = 0;

    /**0xCF*/ public s16AnimStatus: number = 0;
    /**0xD0*/ public s16AnimLoopCount: number = 0;

    /**0xD1*/ public nearestPlayerId: number = 0;

    /**0xD2*/ public texIndex: number = 0;
    /**0xD3*/ public unk0D3: number = -1;
    /**0xD4*/ public animValUnk: number = 0;

    /**0xD5*/ public objectType: number = 0;
    /**0xD6   public unk0D6: number = 0;*/
    /**0xD7*/ public historyStackIndex: number = 0;
    /**0xD8*/ public currentAnimIndex: number = 0;
    /**0xD9*/ public textureWidth: number = 0;
    /**0xDA*/ public textureHeight: number = 0;

    /**0xDB*/ public completedLoopsF: number = 0;
    /**0xDC*/ public completedLoopsS: number = 0;

    /**0xDD*/ public actionBehaviorType: number = 0;//movementType?
    /**0xDE*/ public unk0DE: number = 0;
    /**0xDF*/ public trackSectionId: number = 0;

    constructor(animationIndex: number, advanceState: boolean = true) {
        this.init(animationIndex, advanceState);
    }

    public init(animationIndex: number, advanceState: boolean = true): void {
        this.flags = 0;
        this.eventFlags = 0;
        this.f32AnimStatus = 0;
        this.isTextureTimerActive = false;
        this.currentAnimIndex = animationIndex;
        this.state = advanceState ? 1 : 0;
    }

    /**func_800722A4*/
    public setEventFlags(mask: number): void {
        this.eventFlags |= mask;
    }

    /**func_800722CC*/
    public clearEventFlags(mask: number): void {
        this.eventFlags &= ~mask;
    }

    /**func_80072320*/
    public isEventFlagActive(mask: number): boolean {
        return (this.eventFlags & mask) !== 0;
    }

    /**func_80072354*/
    public isEventFlagInactive(mask: number): boolean {
        return (this.eventFlags & mask) === 0;
    }

    /**set_object_flag_status_true*/
    public setFlags(mask: number): void {
        this.flags |= mask;
    }

    /**set_object_flag_status_false*/
    public clearFlags(mask: number): void {
        this.flags &= ~mask;
    }

    /**is_obj_flag_status_active*/
    public isFlagActive(mask: number): boolean {
        return (this.flags & mask) !== 0;
    }

    /**is_obj_index_flag_status_inactive*/
    public isFlagInactive(mask: number): boolean {
        return (this.flags & mask) === 0;
    }

    /**func_80086EF0*/
    public initActionStateAlt(): void {
        this.initActionState();
    }

    /** set_object_timer_state */
    public setTextureTimerState(isTimerActive: boolean): void {
        this.isTextureTimerActive = isTimerActive;
    }

    /** func_800726CC */
    public setState(newState: number): void {
        this.setTextureTimerState(false);
        this.clearFlags(EntityFlags.HasAnimStarted);
        this.state = newState;
    }

    /** object_next_state */
    public advanceState(): void {
        this.setTextureTimerState(false);
        this.clearFlags(EntityFlags.HasAnimStarted);
        this.state++;
    }

    /**func_80086FD4*/
    public advanceActionState(): void {
        this.clearFlags(EntityFlags.HasMovementStarted);
        this.actionState++;
    }

    /**func_80086E70*/
    public initActionState(): void {
        this.actionState = 1;
        this.clearFlags(EntityFlags.HasMovementStarted);
    }

    /**func_80086EAC*/
    public setBehaviorAndState(behaviorType: number, actionState: number): void {
        this.actionBehaviorType = behaviorType;
        this.actionState = actionState;
        this.clearFlags(EntityFlags.HasMovementStarted);
    }

    /**func_8008701C*/
    public setActionState(state: number): void {
        this.clearFlags(EntityFlags.HasMovementStarted);
        this.actionState = state;
    }

    /**
    * Set a new state, pushing the next state onto the history stack.
    * Also disables timer and move flags
    *
    * func_80072568
    * @param nextState The state to transition to.
    */
    public setStateWithHistory(nextState: number): void {
        this.setTextureTimerState(false);
        this.clearFlags(EntityFlags.HasAnimStarted);
        this.clearFlags(EntityFlags.HasMovementStarted);
        this.advanceState();
        this.historyStackPush(this.state);
        this.state = nextState;
    }

    /**
    * Set a new state, first pushing `previousState` to the history stack.
    * Also disables timer and move flags
    *
    * func_800725E8
    * @param nextState     The state to transition to.
    * @param previousState The state to push to the history stack.
    */
    public setStateAndHistory(nextState: number, previousState: number): void {
        this.setTextureTimerState(false);
        this.clearFlags(EntityFlags.HasAnimStarted);
        this.clearFlags(EntityFlags.HasMovementStarted);
        this.historyStackPush(previousState);
        this.state = nextState;
    }

    /**
    * Go back to the previous saved state from `historyStack`.
    * - Also clears animation/movement flags and disables timers.
    * 
    * func_8007266C
    */
    public restorePreviousState(): void {
        this.setTextureTimerState(false);
        this.clearFlags(EntityFlags.HasAnimStarted);
        this.clearFlags(EntityFlags.HasMovementStarted);
        this.state = this.historyStackPop();
    }

    /** func_800724F8 */
    public historyStackPush(value: number): void {
        this.historyStack[this.historyStackIndex] = value;
        this.historyStackIndex++;
    }

    /** func_80072530 */
    private historyStackPop(): number {
        this.historyStackIndex--;
        return this.historyStack[this.historyStackIndex];
    }

    /**func_800724DC*/
    public resetHistoryStack(): void {
        this.historyStackIndex = 0;
    }

    /**func_80073F90*/
    public setLoopStatusF(enabled: boolean): void {
        this.f32AnimStatus = enabled ? 1 : 0;
    }

    /**func_80073FAC*/
    public advanceLoopCounterF(): void {
        this.completedLoopsF++;
    }

    /**func_80073FD4*/
    public initLoopCounterF(): void {
        this.setLoopStatusF(false);
        this.completedLoopsF = 1;
    }

    /**func_80073800*/
    public setLoopStatusS(status: number): void {
        this.s16AnimStatus = status;
    }

    /**func_8007381C*/
    public advanceLoopCounterS(): void {
        this.completedLoopsS++;
    }

    /**func_80073844*/
    public initLoopCounterS(): void {
        this.setLoopStatusS(0);
        this.completedLoopsS = 1;
    }

    /**func_80073884*/
    public resetLoopCounterS(): void {
        this.s16AnimStatus = 0;
        this.completedLoopsS = 0;
    }

    /**func_80086FD4*/
    public advanceSplineIndex(): void {
        this.splineTime = 0;
        this.splineIndex++;
    }

    /**func_80072428*/
    public resetAllStates(): void {
        this.state = 0;
        this.currentAnimIndex = 0;
        this.setTextureTimerState(false);
        this.flags = 0;
        this.eventFlags = 0;
        this.resetAllActionStates();
    }

    /**func_80086F60*/
    public resetAllActionStates(): void {
        this.actionState = 0;
        this.actionBehaviorType = 0;
        this.unk0DE = 0;
        this.clearFlags(EntityFlags.HasMovementStarted);
    }

    public setOriginPosition(x: number, y: number, z: number): void {
        this.originPos[0] = x;
        this.originPos[1] = y;
        this.originPos[2] = z;
    }

    /**func_8008B844*/
    public setPositionOriginX(): void {
        const originX = this.originPos[0];

        this.pos[0] = this.offset[0] + originX;
        this.pos[1] = this.offset[1] + originX;
        this.pos[2] = this.offset[2] + originX;
    }

    public setOffset(x: number, y: number, z: number): void {
        this.offset[0] = x;
        this.offset[1] = y;
        this.offset[2] = z;
    }

    public setDirection(x: number, y: number, z: number): void {
        this.direction[0] = x;
        this.direction[1] = y;
        this.direction[2] = z;
    }

    public setOrientation(x: number, y: number, z: number): void {
        this.orientation[0] = x;
        this.orientation[1] = y;
        this.orientation[2] = z;
    }

    public setVelocity(x: number, y: number, z: number): void {
        this.velocity[0] = x;
        this.velocity[1] = y;
        this.velocity[2] = z;
    }

    public setScale(scale: number): void {
        this.scale.value = scale;
    }

    /**init_texture_object*/
    public setTextureList(texLutList: number, textureListAddr: number, width: number, height: number): void {
        this.texLutListAddr = texLutList;
        this.textureListAddr = textureListAddr;
        this.textureWidth = width;
        this.textureHeight = height;
        this.texIndex = 0;
        this.unk0D3 = -1;
        this.flags = 0;
    }

    /**func_80073404*/
    public setTextureVtx(width: number, height: number, vtx: number): void {
        this.vertex = vtx;
        this.textureWidth = width;
        this.textureHeight = height;
        this.texIndex = 0;
        this.unk0D3 = -1;
        this.flags = 0;
    }

    /** func_800735BC */
    public setModel(gfx: number, scale: number): void {
        this.flags = 0;
        this.displayList = gfx;
        this.setScale(scale);
        this.advanceState();
    }

    /**
    * Updates the object's final position.
    * 
    * object_calculate_new_pos_offset
    */
    public updatePosition(): void {
        this.pos[0] = this.originPos[0] + this.offset[0];
        this.pos[1] = this.originPos[1] + this.offset[1];
        this.pos[2] = this.originPos[2] + this.offset[2];
    }

    /**func_80087844*/
    public updateMovement(): void {
        this.calcDirectionalVelocity();
        this.applyVelocityToOffsetXYZ();
    }

    /**func_8008781C*/
    public updateForwardMovement(): void {
        this.calcForwardVelocity();
        this.applyVelocityToOffsetXZ();
    }

    /** func_8008757C */
    private calcDirectionalVelocity(): void {
        const pitch = this.direction[0] * BinAngleToRad;
        const yaw = this.direction[1] * BinAngleToRad;
        const cosP = Math.cos(pitch);
        const velocity = this.speed.value;

        this.velocity[0] = (velocity * cosP) * Math.sin(yaw);
        this.velocity[1] = -velocity * Math.sin(pitch);
        this.velocity[2] = (velocity * cosP) * Math.cos(yaw);
    }

    /**get_y_direction_angle*/
    private getMovementYaw(): number {
        return Math.atan2(this.velocity[0], this.velocity[2]) * RadToBinAngle;
    }

    /** func_800873F4 */
    public updateFacingDirection(): void {
        const yaw = this.getMovementYaw();
        this.direction[1] = stepTowardsAngle(this.direction[1], yaw);
    }

    /**func_8007415C*/
    public tryStepUpToTargetF(holder: NumberHolder, start: number, target: number, step: number, stepDelay: number, loopCount: number): boolean {
        if (holder.value < target) {
            return this.stepUpToTargetF(holder, start, target, step, stepDelay, loopCount);
        }
        return false;
    }

    /**func_8007401C*/
    public stepUpToTargetF(holder: NumberHolder, start: number, target: number, step: number, stepDelay: number, loopCount: number): boolean {
        if (!this.f32AnimStatus) {
            holder.value = start;
            this.f32AnimTimer = stepDelay;
            this.f32AnimLoopCount = loopCount;
            this.setLoopStatusF(true);
        } else {

            this.f32AnimTimer -= DELTA_TIME;

            if (this.f32AnimTimer <= 0) {
                this.f32AnimTimer += stepDelay;

                holder.value += step * DELTA_TIME;

                if (holder.value >= target) {
                    if (this.f32AnimLoopCount > 0) {
                        this.f32AnimLoopCount--;
                    }

                    if (this.f32AnimLoopCount === 0) {
                        holder.value = target;
                        this.setLoopStatusF(false);
                        this.advanceLoopCounterF();
                        return true;
                    } else {
                        holder.value = start;
                    }
                }
            }
        }

        return false;
    }

    /**func_80074344*/
    public oscillateLoopF(value: number, start: number, target: number, step: number, stepDelay: number, loopCount: number): number {
        if (this.f32AnimStatus === 0) {
            this.f32AnimTimer = stepDelay;
            this.f32AnimLoopCount = loopCount;
            this.setLoopStatusF(true);
            return start;
        }

        this.f32AnimTimer -= DELTA_TIME;

        if (this.f32AnimTimer < 0) {
            this.f32AnimTimer += stepDelay;

            if (this.f32AnimStatus === 1) {

                value += step * DELTA_TIME;

                if (target <= value) {
                    value = target;
                    this.f32AnimStatus = 2;
                }

            } else {
                value -= step * DELTA_TIME;

                if (value <= start) {
                    value = start;

                    if (this.f32AnimLoopCount > 0) {
                        this.f32AnimLoopCount--;
                    }

                    if (this.f32AnimLoopCount === 0) {
                        this.setLoopStatusF(false);
                        this.advanceLoopCounterF();
                    } else {
                        this.f32AnimStatus = 1;
                    }
                }
            }
        }

        return value;
    }

    /**func_80073A10*/
    public stepDownToTargetLoopS(holder: NumberHolder, start: number, target: number, step: number, stepDelay: number, loopCount: number): boolean {
        if (!this.s16AnimStatus) {
            holder.value = start;
            this.s16AnimTimer = stepDelay;
            this.s16AnimLoopCount = loopCount;
            this.setLoopStatusS(1);
        } else {

            this.s16AnimTimer -= DELTA_TIME;

            if (this.s16AnimTimer <= 0.0) {
                this.s16AnimTimer += stepDelay;

                holder.value -= (step * DELTA_TIME)

                if (holder.value <= target) {
                    if (this.s16AnimLoopCount > 0) {
                        this.s16AnimLoopCount--;
                    }

                    if (this.s16AnimLoopCount === 0) {
                        holder.value = target;
                        this.setLoopStatusS(0);
                        this.advanceLoopCounterS();
                        return true;
                    } else {
                        holder.value = start; // Restart loop
                    }
                }
            }
        }

        return false;
    }

    /**func_800738A8*/
    public stepUpToTargetLoopS(holder: NumberHolder, start: number, target: number, step: number, stepDelay: number, loopCount: number): boolean {
        if (!this.s16AnimStatus) {
            holder.value = start;
            this.s16AnimTimer = stepDelay;
            this.s16AnimLoopCount = loopCount;
            this.setLoopStatusS(1);
        } else {

            this.s16AnimTimer -= DELTA_TIME;

            if (this.s16AnimTimer <= 0) {
                this.s16AnimTimer += stepDelay;

                holder.value += (step * DELTA_TIME)

                if (holder.value >= target) {
                    if (this.s16AnimLoopCount > 0) {
                        this.s16AnimLoopCount--;
                    }

                    if (this.s16AnimLoopCount === 0) {
                        holder.value = target;
                        this.setLoopStatusS(0);
                        this.advanceLoopCounterS();
                        return true;
                    } else {
                        holder.value = start; // Restart loop
                    }
                }
            }
        }

        return false;
    }

    /**func_80073DC0*/
    public stepDownToTargetS(holder: NumberHolder, target: number, step: number): void {
        holder.value -= step * DELTA_TIME;

        if (target >= holder.value) {

            holder.value = target;
            this.setLoopStatusS(0);
            this.advanceLoopCounterS();
        }
    }

    /**
    * Will set `holder.value` to `start` on init. `oscillateLoopS` will not.
    * 
    * func_80073CB0
    */
    public oscillateLoopResetS(holder: NumberHolder, start: number, end: number, step: number, stepDelay: number, loopCount: number): boolean {
        return this.oscillateS(true, holder, start, end, step, stepDelay, loopCount);
    }

    /**func_80073D0C*/
    public oscillateLoopS(holder: NumberHolder, start: number, end: number, step: number, stepDelay: number, loopCount: number): boolean {
        return this.oscillateS(false, holder, start, end, step, stepDelay, loopCount);
    }

    /**func_80073B78*/
    private oscillateS(resetOnStart: boolean, holder: NumberHolder, start: number, target: number, step: number, stepDelay: number, loopCount: number): boolean {
        if (this.s16AnimStatus === 0) {
            this.s16AnimTimer = stepDelay;

            if (resetOnStart)
                holder.value = start;

            this.s16AnimLoopCount = loopCount;
            this.setLoopStatusS(1);
        } else {

            this.s16AnimTimer -= DELTA_TIME;

            if (this.s16AnimTimer <= 0) {
                this.s16AnimTimer += stepDelay;

                const deltaStep = step * DELTA_TIME;

                if (this.s16AnimStatus === 1) {

                    holder.value += deltaStep;

                    if (holder.value >= target) {

                        holder.value = target;
                        this.s16AnimStatus++;
                    }
                }
                else {
                    holder.value -= deltaStep;

                    if (start >= holder.value) {

                        holder.value = start;

                        if (this.s16AnimLoopCount > 0) {
                            this.s16AnimLoopCount--;
                        }

                        if (this.s16AnimLoopCount === 0) {
                            this.setLoopStatusS(0);
                            this.advanceLoopCounterS();
                            return true;
                        } else {
                            this.s16AnimStatus = 1;
                        }
                    }
                }
            }
        }
        return false;
    }

    public runTimer(duration: number): boolean {
        if (!this.isTextureTimerActive) {
            this.setTextureTimerState(true);
            this.texAnimTimer = duration;
        }

        this.texAnimTimer -= DELTA_TIME;

        if (this.texAnimTimer <= 0) {
            this.setTextureTimerState(false);
            this.advanceState();
            return true;
        }

        return false;
    }

    /**
    * func_80072AAC
    *
    * @returns `true` if the timer finished and the state advanced.
    */
    public setTextureForDuration(texIndex: number, duration: number): boolean {
        if (!this.isTextureTimerActive) {
            this.setTextureTimerState(true);
            this.texIndex = texIndex;
            this.texAnimTimer = duration;
        }

        this.texAnimTimer -= DELTA_TIME;

        if (this.texAnimTimer < 0) {
            this.setTextureTimerState(false);
            this.advanceState();
            return true;
        }

        return false;
    }

    /**func_80072C00*/
    public textureVisibilityLoop(texIndex: number, delayFrames: number, loopCount: number): void {
        if (this.isFlagInactive(EntityFlags.HasAnimStarted)) {
            this.texAnimTimer = delayFrames;
            this.texIndex = texIndex;
            this.animValUnk = 1;
            this.texAnimLoopCount = loopCount;
            this.setFlags(EntityFlags.HasAnimStarted);
        } else {

            this.texAnimTimer -= DELTA_TIME;

            if (this.texAnimTimer <= 0) {
                this.texAnimTimer += delayFrames;
                this.animValUnk--;

                if ((this.animValUnk & 1) !== 0) {
                    this.clearFlags(EntityFlags.IsHidden);
                } else {
                    this.setFlags(EntityFlags.IsHidden);
                }

                if (this.animValUnk < 0) {
                    this.animValUnk = 1;

                    if (this.texAnimLoopCount > 0) {
                        this.texAnimLoopCount--;
                    }

                    if (this.texAnimLoopCount === 0) {
                        this.clearFlags(EntityFlags.HasAnimStarted);
                        this.advanceState();
                    }
                }
            }
        }
    }

    /**func_80072F88*/
    public textureLoopBackward(startIndex: number, targetIndex: number, step: number, stepDelay: number, loopCount: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasAnimStarted)) {
            this.texIndex = startIndex;
            this.texAnimTimer = stepDelay;
            this.texAnimLoopCount = loopCount;
            this.setTextureTimerState(true);
            this.setFlags(EntityFlags.HasAnimStarted);
        } else {

            this.texAnimTimer -= DELTA_TIME;

            if (this.texAnimTimer <= 0) {
                this.texAnimTimer += stepDelay;

                this.texIndex -= step;

                if (this.texIndex < targetIndex) {
                    if (this.texAnimLoopCount > 0) {
                        this.texAnimLoopCount--;
                    }

                    if (this.texAnimLoopCount === 0) {
                        this.texIndex = targetIndex;
                        this.clearFlags(EntityFlags.HasAnimStarted);
                        this.setTextureTimerState(false);
                        this.advanceState();
                        return true;
                    } else {
                        this.texIndex = startIndex;
                    }
                }
            }
        }

        return false;
    }

    /**func_80072E54*/
    public textureLoopForward(startIndex: number, targetIndex: number, step: number, stepDelay: number, loopCount: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasAnimStarted)) {
            this.texIndex = startIndex;
            this.texAnimTimer = stepDelay;
            this.texAnimLoopCount = loopCount;
            this.setTextureTimerState(true);
            this.setFlags(EntityFlags.HasAnimStarted);
        } else {

            this.texAnimTimer -= DELTA_TIME;

            if (this.texAnimTimer <= 0) {
                this.texAnimTimer += stepDelay;
                this.texIndex += step;

                if (this.texIndex >= targetIndex) {
                    if (this.texAnimLoopCount > 0) {
                        this.texAnimLoopCount--;
                    }

                    if (this.texAnimLoopCount === 0) {
                        this.texIndex = targetIndex;
                        this.clearFlags(EntityFlags.HasAnimStarted);
                        this.setTextureTimerState(false);
                        this.advanceState();
                        return true;
                    } else {
                        this.texIndex = startIndex;
                    }
                }
            }
        }

        return false;
    }

    /**func_8007326C*/
    public textureLoopOscillate(startIndex: number, targetIndex: number, step: number, stepDelay: number, loopCount: number, forward: boolean = true): boolean {
        if (this.isFlagInactive(EntityFlags.HasAnimStarted)) {
            this.texIndex = startIndex;
            this.texAnimTimer = stepDelay;
            this.texAnimLoopCount = loopCount;
            this.setTextureTimerState(true);
            this.setFlags(EntityFlags.HasAnimStarted);
            this.clearFlags(EntityFlags.IsAnimReversed);

            if (forward)
                this.clearFlags(EntityFlags.FlipX);

        } else {
            this.texAnimTimer -= DELTA_TIME;

            if (this.texAnimTimer <= 0) {
                this.texAnimTimer += stepDelay;

                if (this.isFlagInactive(EntityFlags.IsAnimReversed)) {

                    this.texIndex += (forward ? 1 : -1) * step;

                    const reachedTarget = forward
                        ? this.texIndex >= targetIndex
                        : this.texIndex <= targetIndex;

                    if (reachedTarget) {
                        this.texIndex = targetIndex;
                        this.setFlags(EntityFlags.IsAnimReversed);
                    }

                } else {
                    // Second half of bounce
                    this.texIndex -= (forward ? 1 : -1) * step;

                    const reachedStart = forward
                        ? this.texIndex <= startIndex
                        : this.texIndex >= startIndex;

                    if (reachedStart) {
                        this.texIndex = startIndex;

                        if (this.texAnimLoopCount > 0) {
                            this.texAnimLoopCount--;
                        }

                        if (this.texAnimLoopCount === 0) {
                            this.clearFlags(EntityFlags.HasAnimStarted);
                            this.setTextureTimerState(false);
                            this.advanceState();

                            if (forward)
                                this.clearFlags(EntityFlags.FlipX);

                            return true;
                        } else {
                            this.clearFlags(EntityFlags.IsAnimReversed);

                            if (forward)
                                this.setFlags(EntityFlags.FlipX);
                        }
                    }
                }
            }
        }

        return false;
    }

    /**func_80072D3C*/
    public textureSwapLoop(texIndexA: number, texIndexB: number, swapFrameDelay: number, loopCount: number): void {
        if (this.isFlagInactive(EntityFlags.HasAnimStarted)) {
            this.animValUnk = 0;
            this.setFlags(EntityFlags.HasAnimStarted);
        }

        this.animValUnk += DELTA_TIME;

        const totalSwaps = Math.floor(this.animValUnk / swapFrameDelay);

        if (loopCount === -1) {
            this.texIndex = ((totalSwaps % 2) !== 0) ? texIndexA : texIndexB;
            return;
        }

        if (totalSwaps > (loopCount * 2)) {
            this.clearFlags(EntityFlags.HasAnimStarted);
            this.advanceState();
            return;
        }

        this.texIndex = (totalSwaps % 2) !== 0 ? texIndexA : texIndexB;
    }

    /**func_8008789C*/
    public moveForwardForDuration(duration: number, reverseDirection: boolean = false): boolean {
        if (this.isFlagInactive(EntityFlags.HasMovementStarted)) {
            this.setFlags(EntityFlags.HasMovementStarted);

            if (reverseDirection) {
                this.calcBackwardVelocity();
            }
            else {
                this.calcForwardVelocity();
            }

            this.actionTimer = duration;
        }

        this.actionTimer -= DELTA_TIME;

        if (this.actionTimer <= 0) {
            this.clearFlags(EntityFlags.HasMovementStarted);
            return true;
        } else {
            this.applyVelocityToOffsetXZ();
        }
        return false;
    }

    /**func_80087A0C*/
    public moveForwardToTarget(startX: number, endX: number, startZ: number, endZ: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasMovementStarted)) {
            this.setFlags(EntityFlags.HasMovementStarted);

            const dx = endX - startX;
            const dz = endZ - startZ;
            const dist = Math.hypot(dx, dz);

            this.originPos[1] = 0.0;
            this.direction[1] = Math.atan2(dx, dz) * RadToBinAngle;

            this.calcForwardVelocity();

            this.actionTimer = dist / this.speed.value;
        }

        this.actionTimer -= DELTA_TIME;

        if (this.actionTimer <= 0) {
            this.clearFlags(EntityFlags.HasMovementStarted);
            return true;
        } else {
            this.applyVelocityToOffsetXZ();
        }
        return false;
    }

    public stepUpToTargetV(vector: vec3, index: number, target: number, step: number): boolean {
        assert(index >= 0 && index < 3);

        if (vector[index] < target) {

            vector[index] += step * DELTA_TIME;

            if (vector[index] >= target) {
                vector[index] = target;
                return true;
            }
        }

        return false;
    }

    public stepDownToTargetV(vector: vec3, index: number, target: number, step: number): boolean {
        assert(index >= 0 && index < 3);

        if (vector[index] > target) {
            vector[index] -= step * DELTA_TIME;

            if (target >= vector[index]) {
                vector[index] = target;
                return true;
            }
        }

        return false;
    }

    public chaseV(vector: vec3, index: number, target: number, step: number): boolean {
        assert(index >= 0 && index < 3);

        const delta = target - vector[index];

        // The game doesn't do this check...
        if (delta === 0)
            return true;

        const direction = Math.sign(delta);
        const stepV = direction * Math.abs(step) * DELTA_TIME;

        vector[index] += stepV;

        if ((direction > 0 && vector[index] >= target) ||
            (direction < 0 && vector[index] <= target)) {
            vector[index] = target;
            return true;
        }

        return false;
    }

    public chaseF(holder: NumberHolder, target: number, step: number): boolean {
        const delta = target - holder.value;

        if (delta === 0)
            return true;

        const direction = Math.sign(delta);
        const stepV = direction * Math.abs(step);

        holder.value += stepV * DELTA_TIME;

        if ((direction > 0 && holder.value >= target) ||
            (direction < 0 && holder.value <= target)) {
            holder.value = target;
            return true;
        }

        return false;
    }

    /**func_80087060*/
    public runActionTimer(duration: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasMovementStarted)) {
            this.setFlags(EntityFlags.HasMovementStarted);
            this.actionTimer = duration;
        }

        this.actionTimer -= DELTA_TIME;

        if (this.actionTimer <= 0) {
            this.clearFlags(EntityFlags.HasMovementStarted);
            return true;
        }

        return false;
    }

    /**
    * Runs a timer that sets `HasMovementStarted` flag for `duration`.
    *
    * func_800871AC
    * @param duration Amount of frames for timer to run.
    * @returns True when the timer has finished and the state has advanced.
    */
    public runActionTimerAdvance(duration: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasMovementStarted)) {
            this.setFlags(EntityFlags.HasMovementStarted);
            this.actionTimer = duration;
        }

        this.actionTimer -= DELTA_TIME;

        if (this.actionTimer <= 0) {
            this.clearFlags(EntityFlags.HasMovementStarted);
            this.advanceActionState();
            return true;
        }
        return false;
    }

    /**func_80087104*/
    public runRandomTimer(maxDuration: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasMovementStarted)) {
            this.setFlags(EntityFlags.HasMovementStarted);
            this.actionTimer = random_int(maxDuration);
        }

        this.actionTimer -= DELTA_TIME;

        if (this.actionTimer < 0) {
            this.clearFlags(EntityFlags.HasMovementStarted);
            return true;
        }
        return false;
    }

    /**
    * Run a timer for `duration`. Also sets `texIndex` to 0.
    * - Once the timer expires, the object's state advances.
    * 
    * func_80072B48
    *
    * @param duration Duration in frames.
    * @returns `true` if the timer finished and the state advanced.
    */
    public runVisibilityTimer(duration: number): boolean {
        if (!this.isTextureTimerActive) {

            this.setTextureTimerState(true);
            this.setFlags(EntityFlags.IsHidden);
            this.texIndex = 0;
            this.texAnimTimer = duration;
        }

        this.texAnimTimer -= DELTA_TIME;

        if (this.texAnimTimer < 0) {
            this.clearFlags(EntityFlags.IsHidden);
            this.setTextureTimerState(false);
            this.advanceState();
            return true;
        }

        return false;
    }

    //func_8008751C
    public calcForwardVelocity(): void {
        this.velocity[0] = this.speed.value * Math.sin(this.direction[1] * BinAngleToRad);
        this.velocity[2] = this.speed.value * Math.cos(this.direction[1] * BinAngleToRad);
    }

    //func_80087620
    public calcBackwardVelocity(): void {
        this.velocity[0] = this.speed.value * Math.sin((this.direction[1] + 0x8000) * BinAngleToRad);
        this.velocity[2] = this.speed.value * Math.cos((this.direction[1] + 0x8000) * BinAngleToRad);
    }

    public applyVelocityToOffsetXYZ(): void {
        vec3.scaleAndAdd(this.offset, this.offset, this.velocity, DELTA_TIME);
    }

    public applyVelocityToOffsetXZ(): void {
        this.offset[0] += this.velocity[0] * DELTA_TIME;
        this.offset[2] += this.velocity[2] * DELTA_TIME;
    }

    public applyVelocityToOffsetY(): void {
        this.offset[1] += this.velocity[1] * DELTA_TIME;
    }

    public stepUpwardVelocityForDuration(velocityY: number, gravityStep: number, duration: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasMovementStarted)) {
            this.setFlags(EntityFlags.HasMovementStarted);

            this.velocity[1] = velocityY;
            this.actionTimer = duration;
        }

        this.actionTimer -= DELTA_TIME;

        if (this.actionTimer <= 0) {
            this.clearFlags(EntityFlags.HasMovementStarted);
            this.advanceActionState();
            return true;
        } else {
            this.velocity[1] -= gravityStep * DELTA_TIME;
            this.applyVelocityToOffsetY();
        }
        return false;
    }

    public stepUpwardVelocityToTarget(velocityY: number, gravityStep: number, targetY: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasMovementStarted)) {
            this.setFlags(EntityFlags.HasMovementStarted);
            this.velocity[1] = velocityY;
        }

        this.velocity[1] -= gravityStep * DELTA_TIME;
        this.applyVelocityToOffsetY();

        if (this.offset[1] <= targetY) {
            this.clearFlags(EntityFlags.HasMovementStarted);
            this.offset[1] = targetY;
            this.advanceActionState();
            return true;
        }

        return false;
    }

    /**
    * func_80087E08
    *
    * @returns `true` when the timer completes and `actionState` is advanced.
    */
    public applyDirectionalVelocity(velocityY: number, gravityStep: number, forwardSpeed: number, yaw: number, duration: number): boolean {
        if (this.isFlagInactive(EntityFlags.HasMovementStarted)) {
            this.setFlags(EntityFlags.HasMovementStarted);
            vec3.set(this.offset, 0, 0, 0);
            this.speed.value = forwardSpeed;
            this.velocity[1] = velocityY;
            this.direction[1] = yaw;
            this.calcForwardVelocity();
            this.actionTimer = duration;
        }

        this.actionTimer -= DELTA_TIME;

        if (this.actionTimer < 0) {
            this.clearFlags(EntityFlags.HasMovementStarted);
            this.advanceActionState();
            return true;
        } else {
            this.velocity[1] -= gravityStep * DELTA_TIME;
            this.applyVelocityToOffsetXYZ();
        }
        return false;
    }

    /**
    * Animate the vector's Y-axis until `target` is reached
    * 
    * func_80073E18
    *
    * @param vector The vector to modify.
    * @param step The amount to increment along the Y-axis per frame.
    * @param target The target Y value.
    * @returns `true` when `target` is reached.
    */
    public stepTowardsTargetYaw(vector: vec3, step: number, target: number): boolean {
        if (!this.s16AnimStatus) {
            this.setLoopStatusS(1);
            this.userTimer = target;
        }

        const scaledStep = step * DELTA_TIME;
        const remainingYOffset = this.userTimer - scaledStep;

        if (remainingYOffset <= 0) {
            vector[1] += this.userTimer;
            this.setLoopStatusS(0);
            return true;
        } else {
            vector[1] += scaledStep;
            this.userTimer = remainingYOffset;
        }

        return false;
    }

    /**func_80073514*/
    public updateActiveTexture(): void {
        this.activeTLUT = this.texLutListAddr;
        this.activeTexture = this.textureListAddr + (this.textureWidth * this.textureHeight * Math.floor(this.texIndex));
    }

    public updateActiveIndexedTexture(): void {
        this.activeTLUT = this.texLutListAddr + (Math.floor(this.texIndex) * 512);
        this.activeTexture = this.textureListAddr;
    }

    /**func_8008A6DC*/
    public updateVisibilityFlags(cameraPos: vec3, distance: number): void {

        this.clearFlags(EntityFlags.IsInArea | EntityFlags.IsVisible);

        if ((this.state !== 0) && (IsTargetInRangeXZ(this.pos, cameraPos, distance))) {
            this.setFlags(EntityFlags.IsInArea);
            this.setFlags(EntityFlags.IsVisible);
        }
    }

    /**func_8008A4CC*/
    public setNearFlagsTrue(): void {
        //Just set all true since we always render
        this.setFlags(EntityFlags.IsNearArea | EntityFlags.IsInArea | EntityFlags.IsVisible);
    }

    /**func_800886F4*/
    public setSurfaceFromCollision(col: ObjectCollision): void {

        col.checkBoundingCollision(10.0, [this.pos[0], 20, this.pos[2]]);

        if (col.hasCollisionY) {
            this.setFlags(EntityFlags.IsOnSurface);
            this.surfaceHeight = col.calculateSurfaceHeight(this.pos[0], 0.0, this.pos[2], col.nearestTriIdxY);
            setShadowSurfaceAngle(this.shadowDir, col);
            return;
        }

        this.clearFlags(EntityFlags.IsOnSurface);
    }

    /**
    * Checks whether the object is in contact with any surface.
    * 
    * - If a surface is detected, update the `surfaceHeight` and align `shadowDir` to the surface normal.
    *
    * func_80088538
    * @returns  True if a valid surface is detected below the object.
    */
    public checkSurfaceContact(col: ObjectCollision): boolean {
        let result = false;

        this.clearFlags(EntityFlags.IsOnSurface);
        if (this.isFlagActive(EntityFlags.CanCollideWithGround)) {
            col.checkBoundingCollision(10.0, [this.pos[0], 20, this.pos[2]]);
            if (col.hasCollisionY) {
                this.setFlags(EntityFlags.IsOnSurface);
                result = true;
            }

            this.surfaceHeight = col.calculateSurfaceHeight(this.pos[0], 0.0, this.pos[2], col.nearestTriIdxY);
            setShadowSurfaceAngle(this.shadowDir, col);
        }

        return result;
    }

    /**func_8008861C*/
    public checkSurfaceContactAlt(col: ObjectCollision): boolean {
        let result = false;

        this.clearFlags(EntityFlags.IsOnSurface);
        if (this.isFlagActive(EntityFlags.CanCollideWithGround)) {
            col.checkBoundingCollision(10.0, [this.pos[0], 20, this.pos[2]]);

            if (col.hasCollisionY) {
                this.setFlags(EntityFlags.IsOnSurface);
                result = true;
            }

            this.surfaceHeight = col.calculateSurfaceHeight(this.pos[0], 0.0, this.pos[2], col.nearestTriIdxY);
            vec3.copy(this.targetPos, col.normalY);
        }
        return result;
    }

    public updateAnimationFrame(startFrame: number, endFrame: number, speed: number, looping: boolean): boolean {
        if (this.isFlagInactive(EntityFlags.HasAnimStarted)) {
            this.frameTime = startFrame;
            this.setFlags(EntityFlags.HasAnimStarted);
        } else {

            this.frameTime += speed * DELTA_TIME;

            if (this.frameTime >= endFrame) {
                if (!looping) {
                    this.frameTime = endFrame;

                    this.clearFlags(EntityFlags.HasAnimStarted);
                    this.advanceState();
                    return true;
                } else {
                    this.frameTime = mod(this.frameTime, endFrame);
                }
            }
        }

        return false;
    }

    public deleteObject(): void {
        this.resetAllStates();
        this.isInitialized = false;
    }


    public updateTextures(globals: Mk64Globals, dramAddr: number, dramPalAddr: number): void {
        assert(this.modelInst !== undefined);

        for (const drawCallInst of this.modelInst.drawCallInstances) {
            const tex0 = drawCallInst.textureEntry[0];

            if (tex0 !== undefined && tex0.dramAddr === this.textureListAddr && tex0.dramPalAddr === this.texLutListAddr) {
                const texture = globals.getGfxTexture(dramAddr, dramPalAddr, tex0.tile);

                drawCallInst.textureMappings[0].gfxTexture = texture;
            }
        }
    }

    public updateTextures2D(globals: Mk64Globals, fullHeight: number, fullWidth: number, heightDivisor: number): void {
        assert(this.modelInst !== undefined);
        assert((fullHeight / heightDivisor) === this.modelInst.drawCallInstances.length);

        let dramAddr = this.activeTexture;
        const dramPalAddr = this.activeTLUT;

        for (let i = 0; i < fullHeight / heightDivisor; i++) {
            const drawCallInst = this.modelInst.drawCallInstances[i];

            const tex0 = drawCallInst.textureEntry[0];

            if (tex0 !== undefined) {
                const texture = globals.getGfxTexture(dramAddr, dramPalAddr, tex0.tile);

                drawCallInst.textureMappings[0].gfxTexture = texture;
            }

            dramAddr += fullWidth * (heightDivisor - 1);
        }
    }

    /**func_8004A870*/
    public setShadowMatrix(dst: mat4, scale: number): void {
        if (this.isFlagActive(EntityFlags.HasShadow) && this.isFlagActive(EntityFlags.IsOnSurface)) {
            const up = vec3.normalize(scratchVec3c, this.targetPos);
            const unit = Math.abs(up[1]) < 0.999 ? Vec3UnitY : Vec3UnitX;
            const right = vec3.normalize(scratchVec3a, vec3.cross(scratchVec3a, unit, up));
            const front = vec3.normalize(scratchVec3b, vec3.cross(scratchVec3b, right, up));

            makeMtxFrontUpPos(dst, front, up, [this.pos[0], this.surfaceHeight + 0.8, this.pos[2]]);
            scaleMatrix(dst, dst, scale);
        }
    }
}

export class Mk64Globals {
    public gfxTextureCache: Map<string, GfxTexture> = new Map();
    public modelCache = new Map<number, BasicRspRenderer>();

    public renderHelper: GfxRenderHelper;
    public renderCache: GfxRenderCache;

    public rspState: MkRSPState;
    public commonShadowMdl: BasicRspRenderer;

    public isMirrorMode = false;
    public waterLevel = 0;
    public waterVelocity = -0.1;
    public nearestTrackSectionId = 0;
    public nearestPathPointIdx = 0;
    public colGrid: CollisionGrid;

    public hasCameraMoved: boolean = false;
    public cameraPos: vec3 = vec3.create();
    public cameraFwd: vec3 = vec3.create();
    public cameraYaw: number = 0.0;
    public cameraSpeed: number = 0.0;

    constructor(device: GfxDevice, public segmentBuffers: ArrayBufferSlice[], public courseId: CourseId) {
        this.rspState = new MkRSPState(segmentBuffers);
        this.rspState.initStateMk64();

        this.renderHelper = new GfxRenderHelper(device);
        this.renderCache = this.renderHelper.renderCache;

        this.commonShadowMdl = this.initRendererFromDL(0x0D007B20);
        this.commonShadowMdl.setPrimColor8(20, 20, 20, 0);

        this.colGrid = new CollisionGrid(this);
    }

    public getGfxTexture(dramAddr: number, dramPalAddr: number, tile: RDP.TileState): GfxTexture {
        const cacheKey = `${dramAddr}_${dramPalAddr}`;
        if (this.gfxTextureCache.has(cacheKey)) {
            return this.gfxTextureCache.get(cacheKey)!;
        }

        const textureCache = this.rspState.textureCache;

        const texIndex = textureCache.translateTileTexture(this.segmentBuffers, dramAddr, dramPalAddr, tile, false);
        const gfxTexture = RDP.translateToGfxTexture(this.renderCache.device, textureCache.textures[texIndex]);

        this.gfxTextureCache.set(cacheKey, gfxTexture);

        return gfxTexture;
    }

    // M-1: Yay! We can get away with a horrible cache method in this game
    public initRendererFromDL(dl: number, isBillboard: boolean = false, renderLayer: Mk64RenderLayer = 0): BasicRspRenderer {
        if (this.modelCache.has(dl)) {
            //Clear in case any DLs have been run
            this.rspState.clear();
            return this.modelCache.get(dl)!;
        }

        F3DEX.runDL_F3DEX(this.rspState, dl);
        const renderer = new BasicRspRenderer(this.renderCache, this.rspState.finish(), isBillboard, renderLayer);

        this.modelCache.set(dl, renderer);

        return renderer;
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

export class Mk64Renderer implements Viewer.SceneGfx {
    private renderStartBanner = true;
    private isCloudsEnabled = false;
    private isFogEnabled = false;

    // Render hacks
    private enableActors: boolean = true;
    private enableObjects: boolean = true;
    public enableUnusedGfx: boolean = false;

    public textureHolder: TextureHolder<any>;

    private skyRenderer: Mk64SkyRenderer;
    private courseInstOpa: BasicRspRenderer | null;
    private courseInstXlu: BasicRspRenderer | null;
    private flagMdl: BasicRspRenderer;

    private renderInstListSky = new GfxRenderInstList();
    private renderInstListMain = new GfxRenderInstList();

    private framebufferTextureMapping = new TextureMapping();
    private sceneTexture = new GfxrTemporalTexture();

    // Actors & Objects
    public actors: Actor[] = [];
    public cloudObjects: Entity[] = [];
    public gObjectParticle1: Entity[] = nArray(1024, () => new Entity(0));
    public gObjectParticle2: Entity[] = nArray(255, () => new Entity(0));
    public gObjectParticle3: Entity[] = nArray(150, () => new Entity(0));

    public dummyObjCol: ObjectCollision;// Obj collision to be reused for various calculations
    
    public flagPos: vec3 = vec3.create();
    public xOrientation = 1.0; //TODO (M-1): Handle mirror mode
    public trackOffsetPosition: vec3 = vec3.create();
    /**D_80165834*/ public lightDirection = vec3.create();
    /**D_80165760*/ private splineControlX = vec4.create();
    /**D_80165770*/ private splineControlY = vec4.create();
    /**D_80165770*/ private splineControlZ = vec4.create();

    public trackPath: Mk64Point[] = [];
    public trackPathLeft: Mk64Point[];
    public trackPathRight: Mk64Point[];
    public vehiclePath2D: vec2[] = [];
    public vehiclePath2DLength = 0;

    constructor(public globals: Mk64Globals) {
        this.dummyObjCol = new ObjectCollision(globals);

        const courseId = globals.courseId;
        const courseInfo = dCourseData[courseId];
        
        const topColor = colorNewFromRGBA8(dMapSkyColors[courseId].top);
        const bottomColor = colorNewFromRGBA8(dMapSkyColors[courseId].bottom);

        this.skyRenderer = new Mk64SkyRenderer(globals.renderCache, topColor, bottomColor);

        if (courseInfo.trackPath) {
            this.trackPath = readPathData(globals.segmentBuffers, courseInfo.trackPath);
            this.calculateTrackBoundaries();

            const flagPos = this.trackPath[0].pos;
            vec3.set(this.flagPos, flagPos[0], (flagPos[1] - 15), flagPos[2]);

            if (courseId === CourseId.ToadsTurnpike) {
                this.flagPos[0] = (globals.isMirrorMode) ? (flagPos[0] + 138) : (flagPos[0] - 138);
            } else if (courseId === CourseId.WarioStadium) {
                this.flagPos[0] = (globals.isMirrorMode) ? (flagPos[0] + 12) : (flagPos[0] - 12);
            }
        }

        const rspState = globals.rspState;

        //course light
        rspState.setLight1(Light1.InitLight(255, 255, 255, 175, 175, 175, 0, 0, 120));

        if (courseId === CourseId.ChocoMountain) {
            this.isFogEnabled = true;
            rspState.gSPSetGeometryMode(RSP_Geometry.G_FOG);
            rspState.gSPFogPosition(200, 1300);
            rspState.gDPSetFogColor(0xFFFFFFFF);
        }
        else if (courseId === CourseId.ToadsTurnpike) {
            this.isFogEnabled = true;
            rspState.gSPSetGeometryMode(RSP_Geometry.G_FOG);
            rspState.gSPFogPosition(100, 2300);
            rspState.gDPSetFogColor(0x2B0D04FF);
        }

        if (courseInfo.courseOpa) {
            F3DEX.runDL_F3DEX(rspState, courseInfo.courseOpa);
            const baseOutputOpa = rspState.finish();

            //HACK! Late binding flag for courses with jumbotrons
            if (baseOutputOpa && courseId === CourseId.LuigiRaceway) {
                const drawCall = baseOutputOpa.drawCalls[149];
                drawCall.textureIndices[0] |= 0x0F000000;
            }
            else if (baseOutputOpa && courseId === CourseId.WarioStadium) {
                const drawCall = baseOutputOpa.drawCalls[18];
                drawCall.textureIndices[0] |= 0x0F000000;
            }

            this.courseInstOpa = new BasicRspRenderer(globals.renderCache, baseOutputOpa);
            globals.modelCache.set(courseInfo.courseOpa, this.courseInstOpa);
        }

        if (courseInfo.courseXlu) {
            this.courseInstXlu = globals.initRendererFromDL(courseInfo.courseXlu, false, Mk64RenderLayer.Xlu);

            //HACK! Render after item boxes. The game doesn't do this, but we can look at courses from a new perspective now
            if (courseId === CourseId.WarioStadium)
                this.courseInstXlu.renderLayer = Mk64RenderLayer.Smoke;
        }

        if (courseInfo.clouds && courseInfo.cloudTex !== undefined) {
            this.isCloudsEnabled = true;
            this.initClouds(courseInfo.clouds, courseInfo.cloudTex);
        }

        //actor light
        rspState.setLight1(Light1.InitLight(255, 255, 255, 115, 115, 115, 0, 0, 120));

        if (courseInfo.foliage) {
            this.spawnFoliage(courseInfo.foliage);
        }

        if (courseInfo.piranhaPlants) {
            this.spawnActorList(courseInfo.piranhaPlants, ActorType.PiranhaPlant);
        }

        if (courseInfo.palmTrees) {
            this.spawnActorList(courseInfo.palmTrees, ActorType.PalmTree, (actor: ActorPalmTree, spawnData: Mk64ActorSpawnData) => {
                actor.treeType = spawnData.params;
                actor.collision.checkBoundingCollision(5, spawnData.pos);

                setShadowSurfaceAngle(actor.rot, actor.collision);
            });
        }

        if (courseInfo.dkJungleTrees) {
            this.spawnActorList(courseInfo.dkJungleTrees, ActorType.JungleTree, (actor: ActorJungleTree, spawnData: Mk64ActorSpawnData) => {
                actor.pos[1] = spawnData.posY;
                actor.treeType = spawnData.params & 0x0F;
                actor.rot[0] = 0x4000;
            });
        }

        if (courseInfo.cows) {
            this.spawnActorList(courseInfo.cows, ActorType.Cow, (actor: ActorCow, spawnData: Mk64ActorSpawnData) => {
                actor.cowType = spawnData.params;
            });
        }

        if (courseInfo.fallingRocks) {
            this.spawnActorList(courseInfo.fallingRocks, ActorType.FallingRock, (actor: ActorFallingRock, spawnData: Mk64ActorSpawnData) => {
                actor.pos[1] += 10;
                actor.rockIndex = spawnData.params;
                vec3.copy(actor.originalPos, actor.pos);
            });
        }

        if (courseInfo.itemBoxes) {
            this.spawnActorList(courseInfo.itemBoxes, ActorType.ItemBox, (actor: ActorItemBox, spawnData: Mk64ActorSpawnData) => {
                const height = globals.colGrid.getSurfaceHeight(spawnData.pos[0], spawnData.pos[1] + 10, spawnData.pos[2]);
                vec3.set(actor.rot, random_u16(), random_u16(), random_u16());
                actor.resetDistance = height;
                actor.origY = spawnData.pos[1];
                actor.pos[1] = height - 20;
            });
        }

        if (globals.isMirrorMode)
            this.xOrientation = -1.0;

        if (this.isFogEnabled)
            this.flagMdl = globals.initRendererFromDL(0x0D05BBA0);
        else
            this.flagMdl = globals.initRendererFromDL(0x0D05BBC0);

        if (courseId === CourseId.BigDonut || courseId === CourseId.BlockFort ||
            courseId === CourseId.Skyscraper || courseId === CourseId.DoubleDeck
        ) {
            this.renderStartBanner = false;
        }

    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const globals = this.globals;
        const isPaused = viewerInput.deltaTime === 0;
        const renderHelper = globals.renderHelper;
        const renderInstManager = renderHelper.renderInstManager;

        SCENE_TIME = viewerInput.time;
        DELTA_TIME = clamp(getTimeInFrames(viewerInput.deltaTime, 30), 0, 1.5);

        computeViewMatrix(scratchMtx1, viewerInput.camera);
        const camPos = mat4.getTranslation(globals.cameraPos, viewerInput.camera.worldMatrix);
        const cameraForward = vec3.set(globals.cameraFwd, scratchMtx1[8], scratchMtx1[9], -scratchMtx1[10]);

        globals.cameraYaw = Math.atan2(cameraForward[0], cameraForward[2]);
        globals.cameraSpeed = vec3.length(viewerInput.camera.linearVelocity) / DELTA_TIME;

        globals.nearestTrackSectionId = this.globals.colGrid.getNearestTrackSectionId(camPos);
        globals.nearestPathPointIdx = this.getNearestTrackPathPoint(camPos, globals.nearestTrackSectionId);


        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        const skyProjMtx = mat4.ortho(scratchMtx2, 0, viewerInput.backbufferWidth, viewerInput.backbufferHeight, 0, -1, 1);
        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        let mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, skyProjMtx);

        // Sky, clouds, stars
        renderInstManager.setCurrentList(this.renderInstListSky);
        this.skyRenderer.prepareToRender(renderInstManager);

        // Set wireframe after because I don't want the sky to be wireframe
        template.setMegaStateFlags({ wireframe: IS_WIREFRAME });

        if (this.isCloudsEnabled) {
            this.updateClouds(viewerInput);
            this.renderClouds(renderInstManager, viewerInput);
        }

        // Course, Actors, Objects
        offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        renderInstManager.setCurrentList(this.renderInstListMain);

        this.courseInstOpa?.prepareToRender(renderInstManager, viewerInput);
        this.courseInstXlu?.prepareToRender(renderInstManager, viewerInput);


        // actors/water update at 60fps
        const deltaTime60 = DELTA_TIME * 2;

        this.updateCourseAnims(deltaTime60);
        this.renderCourseAnimatedMdls(renderInstManager, viewerInput);

        if (this.enableActors) {

            if (this.renderStartBanner) {
                calcModelMatrix(scratchMtx1, this.flagPos);
                this.flagMdl?.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }

            for (const actor of this.actors) {
                if (!isPaused) {
                    actor.update(deltaTime60);
                }
                actor.prepareToRender(renderInstManager, viewerInput);
            }
        }

        if (this.enableObjects) {
            if (!isPaused) {
                this.updateObjects();
            }
            this.prepareToRenderObjects(renderInstManager, viewerInput);
        }

        //Collision.drawDebug(viewerInput);

        renderInstManager.popTemplate();
        renderHelper.prepareToRender();

        globals.hasCameraMoved = !mat4.equals(lastCamWorldMtx, viewerInput.camera.worldMatrix);
        mat4.copy(lastCamWorldMtx, viewerInput.camera.worldMatrix);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        this.sceneTexture.setDescription(device, mainColorDesc);

        const renderHelper = this.globals.renderHelper;
        const builder = renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.framebufferTextureMapping.gfxTexture = this.sceneTexture.getTextureForSampling();
                this.renderInstListMain.resolveLateSamplerBinding('framebuffer', this.framebufferTextureMapping);
                this.renderInstListSky.drawOnPassRenderer(this.globals.renderCache, passRenderer);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.globals.renderCache, passRenderer);
            });
        });
        renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        builder.pushPass((pass) => {
            pass.setDebugName('Copy to Temporal Texture');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.sceneTexture.getTextureForResolving());

        this.prepareToRender(device, viewerInput);
        renderHelper.renderGraph.execute(builder);
        this.renderInstListSky.reset();
        this.renderInstListMain.reset();
    }

    public renderCourseAnimatedMdls(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void { }

    public prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void { }

    public updateCourseAnims(deltaTime: number): void { }

    public updateObjects(): void { }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(20 / 60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        const globals = this.globals;

        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const enableActors = new UI.Checkbox('Enable Actors', true);
        enableActors.onchanged = () => { this.enableActors = enableActors.checked; };
        renderHacksPanel.contents.appendChild(enableActors.elem);

        const enableObjects = new UI.Checkbox('Enable Objects', true);
        enableObjects.onchanged = () => { this.enableObjects = enableObjects.checked; };
        renderHacksPanel.contents.appendChild(enableObjects.elem);

        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const checked = enableVertexColorsCheckbox.checked;

            globals.modelCache.forEach(o => o.setVertexColorsEnabled(checked));
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const checked = enableTextures.checked;

            globals.modelCache.forEach(o => o.setTexturesEnabled(checked));
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        if (globals.courseId === CourseId.ToadsTurnpike || globals.courseId === CourseId.ChocoMountain) {
            const enableFog = new UI.Checkbox('Enable Fog', true);
            enableFog.onchanged = () => {
                const checked = enableFog.checked;

                globals.modelCache.forEach(o => o.setFogEnabled(checked));
            };
            renderHacksPanel.contents.appendChild(enableFog.elem);
        }

        const enableWireframe = new UI.Checkbox('Enable wireframe', IS_WIREFRAME);
        enableWireframe.onchanged = () => {
            IS_WIREFRAME = enableWireframe.checked;
        };
        renderHacksPanel.contents.appendChild(enableWireframe.elem);

        const enableCullingCheckbox = new UI.Checkbox('Enable Culling', true);
        enableCullingCheckbox.onchanged = () => {
            globals.modelCache.forEach(o => o.setBackfaceCullingEnabled(enableCullingCheckbox.checked));

            // HACK! I want to keep this one on
            this.flagMdl.setBackfaceCullingEnabled(true);
        };
        renderHacksPanel.contents.appendChild(enableCullingCheckbox.elem);

        const enableAlphaVisualizer = new UI.Checkbox('Visualize Vertex Alpha', false);
        enableAlphaVisualizer.onchanged = () => {
            const checked = enableAlphaVisualizer.checked;
            globals.modelCache.forEach(o => o.setAlphaVisualizerEnabled(checked));
        };
        renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        if (globals.courseId === CourseId.BowserCastle ||
            globals.courseId === CourseId.KoopaBeach ||
            globals.courseId === CourseId.DkJungle
        ) {
            const enableUnusedGfx = new UI.Checkbox('Enable Unused Graphics', false);
            enableUnusedGfx.onchanged = () => { this.enableUnusedGfx = enableUnusedGfx.checked; };
            renderHacksPanel.contents.appendChild(enableUnusedGfx.elem);
        }

        return [renderHacksPanel];
    }

    public renderPathDebug(path: Mk64Point[], viewerInput: Viewer.ViewerRenderInput, color: Color = Green): void {
        for (let j = 0; j < path.length; j++) {
            const point0 = path[j + 0];
            let point1 = path[j + 1];

            if (point1 === undefined) {
                point1 = path[0];
            }

            drawWorldSpaceLine(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, point0.pos, point1.pos, color);
            drawWorldSpaceLocator(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, point0.pos, 0.5, Yellow);
        }
    }

    private calculateTrackBoundaries(): void {
        const pathWidth = dCourseCpuMaxSeparation[this.globals.courseId];
        const pointCount = this.trackPath.length;
        this.trackPathLeft = [];
        this.trackPathRight = [];

        for (let i = 0; i < pointCount; i++) {
            const curr = this.trackPath[i].pos;
            const next = this.trackPath[(i + 1) % pointCount].pos;

            const dx = next[0] - curr[0];
            const dz = next[2] - curr[2];
            const dist = Math.hypot(dx, dz) || 1;

            const avgY = (curr[1] + next[1]) * 0.5;

            const leftX = curr[0] + pathWidth * dz / dist;
            const leftZ = curr[2] - pathWidth * dx / dist;

            const rightX = curr[0] - pathWidth * dz / dist;
            const rightZ = curr[2] + pathWidth * dx / dist;

            this.trackPathLeft.push({ pos: [leftX, avgY, leftZ], param: 0 });
            this.trackPathRight.push({ pos: [rightX, avgY, rightZ], param: 0 });
        }
    }

    public spawnActor(actorType: ActorType, position: ReadonlyVec3 = Vec3Zero, rotation: ReadonlyVec3 = Vec3Zero): Actor {
        let actor: Actor;

        switch (actorType) {
            case ActorType.TreeMarioRaceway: actor = new ActorMarioTree(this.globals, actorType, position, rotation); break;
            case ActorType.HotAirBalloonItemBox:
            case ActorType.ItemBox: actor = new ActorItemBox(this.globals, actorType, position, rotation); break;
            case ActorType.MarioSign: actor = new ActorMarioSign(this.globals, actorType, position, rotation); break;
            case ActorType.TreeMooMooFarm: actor = new ActorMooMooFarmTree(this.globals, actorType, position, rotation); break;
            case ActorType.TreeLuigiRaceway: actor = new ActorLuigiTree(this.globals, actorType, position, rotation); break;
            case ActorType.PiranhaPlant: actor = new ActorPiranhaPlant(this.globals, actorType, position, rotation); break;
            case ActorType.Cow: actor = new ActorCow(this.globals, actorType, position, rotation); break;
            case ActorType.PalmTree: actor = new ActorPalmTree(this.globals, actorType, position, rotation); break;
            case ActorType.Cactus1KalamariDesert: actor = new ActorCactus1(this.globals, actorType, position, rotation); break;
            case ActorType.Cactus2KalamariDesert: actor = new ActorCactus2(this.globals, actorType, position, rotation); break;
            case ActorType.Cactus3KalamariDesert: actor = new ActorCactus3(this.globals, actorType, position, rotation); break;
            case ActorType.TreeFrappeSnowland: actor = new ActorSnowTree(this.globals, actorType, position, rotation); break;
            case ActorType.TreeRoyalRaceway: actor = new ActorRoyalRacewayTree(this.globals, actorType, position, rotation); break;
            case ActorType.TreePeachesCastle: actor = new ActorPeachCastleTree(this.globals, actorType, position, rotation); break;
            case ActorType.BushBowsersCastle: actor = new ActorBowsersCastleBush(this.globals, actorType, position, rotation); break;
            case ActorType.TreeYoshiValley: actor = new ActorYoshiTree(this.globals, actorType, position, rotation); break;
            case ActorType.YoshiEgg: actor = new ActorYoshiEgg(this.globals, actorType, position, rotation); break;
            case ActorType.RailroadCrossing: actor = new ActorCrossbuck(this.globals, actorType, position, rotation); break;
            case ActorType.WarioSign: actor = new ActorWarioSign(this.globals, actorType, position, rotation); break;
            case ActorType.FallingRock: actor = new ActorFallingRock(this.globals, actorType, position, rotation); break;

            case ActorType.JungleTree: actor = new ActorJungleTree(this.globals, actorType, position, rotation); break;
            case ActorType.WaterBansheeBoardwalk: actor = new ActorWaterBanshee(this.globals, actorType, position, rotation); break;
            default:
                console.log(`unknown actor type: ${ActorType[actorType]}`);
                actor = new DebugActor(this.globals, actorType, position, rotation);
                break;
        }

        actor.init(this.globals);

        this.actors.push(actor);
        return actor;
    }

    private spawnActorList<T extends Actor>(actorTableOffset: number, actorType: ActorType, actorSetup?: (actor: T, spawnData: Mk64ActorSpawnData) => void): void {
        let isDkJungleTrees = false;

        if (actorType === ActorType.JungleTree)
            isDkJungleTrees = true;

        const actorSpawns = readActorSpawnData(this.globals.segmentBuffers[6], actorTableOffset, isDkJungleTrees);

        for (let i = 0; i < actorSpawns.length; i++) {
            const spawnData = actorSpawns[i];
            const actor = this.spawnActor(actorType, spawnData.pos) as T;

            if (actorSetup) {
                actorSetup(actor, spawnData);
            }
        }
    }

    private spawnFoliage(actorTableOffset: number): void {
        let actorType: ActorType = ActorType.Unused0x01;

        const actorSpawns = readActorSpawnData(this.globals.segmentBuffers[6], actorTableOffset);

        for (let i = 0; i < actorSpawns.length; i++) {
            switch (this.globals.courseId) {
                case CourseId.MarioRaceway: actorType = ActorType.TreeMarioRaceway; break;
                case CourseId.BowserCastle: actorType = ActorType.BushBowsersCastle; break;
                case CourseId.YoshiValley: actorType = ActorType.TreeYoshiValley; break;
                case CourseId.FrappeSnowland: actorType = ActorType.TreeFrappeSnowland; break;
                case CourseId.RoyalRaceway:
                    switch (actorSpawns[i].params) {
                        case 6:
                            actorType = ActorType.TreePeachesCastle;
                            break;
                        case 7:
                            actorType = ActorType.TreeRoyalRaceway;
                            break;
                    }
                    break;
                case CourseId.LuigiRaceway: actorType = ActorType.TreeLuigiRaceway; break;
                case CourseId.MooMooFarm: actorType = ActorType.TreeMooMooFarm; break;
                case CourseId.KalamariDesert:
                    switch (actorSpawns[i].params) {
                        case 5:
                            actorType = ActorType.Cactus1KalamariDesert;
                            break;
                        case 6:
                            actorType = ActorType.Cactus2KalamariDesert;
                            break;
                        case 7:
                            actorType = ActorType.Cactus3KalamariDesert;
                            break;
                    }
                    break;
            }

            const actor = this.spawnActor(actorType, actorSpawns[i].pos);

            actor.collision.checkBoundingCollision(5, actor.pos);
            if (actor.collision.surfaceDistY < 0) {
                actor.pos[1] = actor.collision.calculateSurfaceHeight(actor.pos[0], actor.pos[1], actor.pos[2], actor.collision.nearestTriIdxY);
            }

            setShadowSurfaceAngle(actor.rot, actor.collision);
        }
    }

    public generate2DPath(pathSrc: Mk64Point[]): void {
        this.vehiclePath2D = [];
        const numPathPoints = pathSrc.length;

        let lastX = pathSrc[0].pos[0];
        let lastZ = pathSrc[0].pos[2];
        let distanceSum = 0.0;

        for (let i = 0; i < numPathPoints; i++) {
            const p1 = pathSrc[i];
            const p2 = pathSrc[(i + 1) % numPathPoints];
            const p3 = pathSrc[(i + 2) % numPathPoints];

            const x1 = p1.pos[0], z1 = p1.pos[2];
            const x2 = p2.pos[0], z2 = p2.pos[2];
            const x3 = p3.pos[0], z3 = p3.pos[2];

            const dist12 = Math.hypot(x2 - x1, z2 - z1);
            const dist23 = Math.hypot(x3 - x2, z3 - z2);
            const stepSize = 0.05 / (dist12 + dist23);

            for (let t = 0.0; t <= 1.0; t += stepSize) {
                const a = (1.0 - t);
                const b = t;

                const w1 = 0.5 * a * a;
                const w2 = a * b + 0.5;
                const w3 = 0.5 * b * b;

                const interpX = w1 * x1 + w2 * x2 + w3 * x3;
                const interpZ = w1 * z1 + w2 * z2 + w3 * z3;

                const dx = interpX - lastX;
                const dz = interpZ - lastZ;
                distanceSum += Math.hypot(dx, dz);

                lastX = interpX;
                lastZ = interpZ;

                const isFirstPoint = (i === 0 && t === 0.0);
                if (distanceSum > 20.0 || isFirstPoint) {
                    const finalX = this.globals.isMirrorMode ? -interpX : interpX;
                    this.vehiclePath2D.push(vec2.fromValues(finalX, interpZ));
                    distanceSum = 0.0;
                }
            }
        }

        this.vehiclePath2DLength = this.vehiclePath2D.length;
    }

    public initClouds(cloudList: Mk64Cloud[], cloudTex: number): void {
        const OG_HEIGHT = 240;

        for (let i = 0; i < cloudList.length; i++) {
            const cloudData = cloudList[i];
            const cloud: Entity = new Entity(1);

            cloud.direction[1] = cloudData.rotY * BinAngleToRad;
            cloud.splineTargetZ = cloudData.posY / OG_HEIGHT;

            cloud.setScale((cloudData.scalePercent / 100) / OG_HEIGHT);

            if (cloudTex !== 0) {
                cloud.objectType = cloudData.subType;
                cloud.activeTexture = cloudTex + (cloudData.subType * 0x400);
                cloud.setTextureVtx(64, 32, 0x0D005FB0);

                cloud.modelInst = this.globals.initRendererFromDL(0x0D05BB48);

            } else {
                cloud.objectType = EntityType.Star;
                cloud.activeTexture = 0x0D0293D8;
                cloud.setTextureVtx(16, 16, 0x0D005FB0);
                cloud.modelInst = this.globals.initRendererFromDL(0x0D05BAF0);
            }

            cloud.modelInst.isOrthographic = true;

            this.cloudObjects.push(cloud);
        }
    }

    public updateClouds(viewerInput: Viewer.ViewerRenderInput): void {
        const screenW = viewerInput.backbufferWidth;
        const screenH = viewerInput.backbufferHeight;
        const aspectRatio = screenW / screenH;
        const screenCenterX = screenW / 2;

        const fovX = 2 * Math.atan(Math.tan(viewerInput.camera.fovY / 2) * aspectRatio);

        const halfFovX = fovX / 2;

        for (let i = 0; i < this.cloudObjects.length; i++) {
            const cloudObj = this.cloudObjects[i];

            if (cloudObj.objectType === EntityType.Star) {
                switch (i % 5) {
                    case 0: cloudObj.oscillateLoopResetS(cloudObj.primAlpha, 40, 180, 255, 1, -1); break;
                    case 1: cloudObj.oscillateLoopResetS(cloudObj.primAlpha, 128, 255, 255, 1, -1); break;
                    case 2: cloudObj.oscillateLoopResetS(cloudObj.primAlpha, 80, 200, 255, 1, -1); break;
                    case 3: cloudObj.oscillateLoopResetS(cloudObj.primAlpha, 0, 155, 255, 1, -1); break;
                    case 4: cloudObj.oscillateLoopResetS(cloudObj.primAlpha, 90, 128, 255, 1, -1); break;
                }
            }

            let deltaAngle = normalizeAngle(cloudObj.direction[1] + this.globals.cameraYaw);

            if (Math.abs(deltaAngle) <= fovX) {

                cloudObj.setFlags(EntityFlags.IsRenderingActive);
                cloudObj.splineTargetX = screenCenterX + (deltaAngle / halfFovX) * screenCenterX;

            } else {
                cloudObj.clearFlags(EntityFlags.IsRenderingActive);
            }
        }
    }

    public renderClouds(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.cloudObjects.length; i++) {
            const cloudObj = this.cloudObjects[i];

            if (cloudObj.objectType !== EntityType.Star) {
                const drawCallInst = cloudObj.modelInst.drawCallInstances[0];
                const tex0 = drawCallInst.textureEntry[0];

                const texture = this.globals.getGfxTexture(cloudObj.activeTexture, 0, tex0.tile);

                drawCallInst.textureMappings[0].gfxTexture = texture;
            }

            //Default = 0.8
            //MooMoo and Yoshi = 0.7333
            //const verticalScale = 1;

            const screenH = viewerInput.backbufferHeight;
            const scale = cloudObj.scale.value * screenH;

            const x = cloudObj.splineTargetX;
            const y = (screenH / 2) - (cloudObj.splineTargetZ * screenH);

            computeModelMatrixSRT(scratchMtx1, scale, scale, 0, 0, 0, 0, x, y, 0);

            if (cloudObj.isFlagActive(EntityFlags.IsRenderingActive)) {
                cloudObj.modelInst.setPrimColor8(0xFF, 0xFF, 0xFF, cloudObj.primAlpha.value);
                cloudObj.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }
    }

    private findNearestPathPoint2D(pos: vec3, pathPointIndex: number): number {
        let minimumDistance = 250000.0;
        let minimumIndex = -1;

        const posXZ = vec2.set(scratchVec2a, pos[0], pos[2]);

        for (let i = pathPointIndex - 2; i < pathPointIndex + 7; i++) {
            const pointIdx = mod(i, this.vehiclePath2DLength);
            const distanceSq = vec2.sqrDist(this.vehiclePath2D[pointIdx], posXZ);

            if (distanceSq < minimumDistance) {
                minimumDistance = distanceSq;
                minimumIndex = pointIdx;
            }
        }

        if (minimumIndex === -1) {
            minimumIndex = pathPointIndex;
        }

        return minimumIndex;
    }

    public moveAlongPath2D(pos: vec3, pathPointIndex: NumberHolder, speed: number): number {
        const originalPos: vec3 = vec3.clone(pos);

        const nearestIndex = this.findNearestPathPoint2D(originalPos, pathPointIndex.value);
        pathPointIndex.value = nearestIndex;

        const pathPointIdx1 = mod(nearestIndex + 3, this.vehiclePath2DLength);
        const pathPointIdx2 = mod(nearestIndex + 4, this.vehiclePath2DLength);

        const pathPoint1 = this.vehiclePath2D[pathPointIdx1];
        const pathPoint2 = this.vehiclePath2D[pathPointIdx2];

        const targetX = (pathPoint1[0] + pathPoint2[0]) * 0.5;
        const targetZ = (pathPoint1[1] + pathPoint2[1]) * 0.5;

        const dx = targetX - originalPos[0];
        const dz = targetZ - originalPos[2];

        const distance = Math.hypot(dx, dz);

        if (distance > 0.01) {
            const scale = (speed * DELTA_TIME) / distance;
            pos[0] += dx * scale;
            pos[2] += dz * scale;
        }

        return this.calcPathTargetYaw(originalPos, pos);
    }

    private getNearestPathPointInRange(pos: vec3, pathPointIndex: number): number {
        const pathCount = this.trackPath.length;

        let nearestIndex = -1;
        let minDistanceSq = 400.0 * 400.0;

        for (let i = pathPointIndex - 3; i < pathPointIndex + 7; i++) {
            const index = mod(i, pathCount);
            const pointPos = this.trackPath[index].pos;
            const distanceSq = vec3.sqrDist(pointPos, pos);

            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                nearestIndex = index;
            }
        }

        return nearestIndex;
    }

    private getNearestTrackPathPoint(position: vec3, trackSectionId: number): number {
        if (trackSectionId === -1) {
            return -1;
        }

        const pathPoints = this.trackPath;
        const pointCount = pathPoints.length;

        let nearestIndex = 0;
        let minDistanceSq = 1000000;
        let foundAnyPoint = false;

        for (let i = 0; i < pointCount; i++) {
            const point = pathPoints[i];

            if ((point.param === trackSectionId)) {
                const distSq = vec3.sqrDist(point.pos, position);

                if (distSq < minDistanceSq) {
                    minDistanceSq = distSq;
                    nearestIndex = i;
                    foundAnyPoint = true;
                }
            }
        }

        // Search all points if we can't find one in one the current track section
        if (!foundAnyPoint) {
            for (let i = 0; i < pointCount; i++) {
                const point = pathPoints[i];
                const distSq = vec3.sqrDist(point.pos, position);

                if (distSq < minDistanceSq) {
                    minDistanceSq = distSq;
                    nearestIndex = i;
                }
            }
        }

        return nearestIndex;
    }

    private calcTrackOffset(pathPointIndex: number, trackOffset: number): vec3 {
        const nextPointIndex = mod(pathPointIndex + 1, this.trackPath.length);

        const left0 = this.trackPathLeft[pathPointIndex].pos;
        const right0 = this.trackPathRight[pathPointIndex].pos;

        const left1 = this.trackPathLeft[nextPointIndex].pos;
        const right1 = this.trackPathRight[nextPointIndex].pos;

        const midLeft = vec3.lerp(scratchVec3a, left0, left1, 0.5);
        const midRight = vec3.lerp(scratchVec3b, right0, right1, 0.5);

        const t = 0.5 - (trackOffset * 0.5);
        vec3.lerp(this.trackOffsetPosition, midRight, midLeft, t);

        return vec3.clone(this.trackOffsetPosition);
    }

    private handlePathLoop(pos: vec3, pathPointIndex: NumberHolder): void {
        const pathLen = this.trackPath.length;
        const firstPointZ = this.trackPath[0].pos[2];
        const lastIndex = pathLen - 1;

        let index = pathPointIndex.value;

        if (index === 0 && pos[2] > firstPointZ) {
            index = lastIndex;
        } else if (index === lastIndex && pos[2] <= firstPointZ) {
            index = 0;
        }

        pathPointIndex.value = index;
    }

    /**func_8000D24C*/
    private getPathPointFromNearestSection(pos: vec3): number {
        this.dummyObjCol.checkBoundingCollision(10.0, pos);

        return this.getNearestTrackPathPoint(pos, this.globals.colGrid.getTrackSectionId(this.dummyObjCol.nearestTriIdxY));
    }

    /**func_8000D2B4*/
    private getNearestPathPoint(pos: vec3, pathPointIndex: NumberHolder): number {
        let pathPoint = this.getNearestPathPointInRange(pos, pathPointIndex.value);

        if (pathPoint === -1) {
            pathPoint = this.getPathPointFromNearestSection(pos);
        }

        this.handlePathLoop(pos, pathPointIndex);
        return pathPoint;
    }

    /**func_8000D6D0*/
    public moveAlongPath(pos: vec3, pathPointIndex: NumberHolder, speed: number, trackOffsetX: number, arg5: number): number {
        const pathLength = this.trackPath.length;
        const oldPos = vec3.clone(pos);

        const nearestIdx = this.getNearestPathPoint(oldPos, pathPointIndex);
        pathPointIndex.value = nearestIdx;

        const targetIndex = nearestIdx + arg5;
        const pathPointIdx1 = mod(targetIndex, pathLength);
        const pathPointIdx2 = mod((targetIndex + 1), pathLength);

        const pathPoint1 = this.trackPath[pathPointIdx1];
        const pathPoint2 = this.trackPath[pathPointIdx2];

        const trackOffset1: vec3 = this.calcTrackOffset(pathPointIdx1, trackOffsetX);
        const trackOffset2: vec3 = this.calcTrackOffset(pathPointIdx2, trackOffsetX);

        scratchVec3a[0] = (trackOffset1[0] + trackOffset2[0]) * 0.5;
        scratchVec3a[1] = (pathPoint1.pos[1] + pathPoint2.pos[1]) * 0.5;
        scratchVec3a[2] = (trackOffset1[2] + trackOffset2[2]) * 0.5;

        const delta = vec3.subtract(scratchVec3a, scratchVec3a, oldPos);
        const distance = vec3.length(delta);

        if (distance > 0.01) {
            const scale = (speed * DELTA_TIME) / distance;
            vec3.scaleAndAdd(pos, pos, delta, scale);
        }

        return this.calcPathTargetYaw(oldPos, pos);
    }

    /**func_8000D940*/
    public moveAlongPathReverse(pos: vec3, pathPointIndex: NumberHolder, speed: number, arg3: number): number {
        const oldPos: vec3 = [pos[0], pos[1], pos[2]];
        const pathPointCount = this.trackPath.length;

        const nearestIndex = this.getNearestPathPoint(pos, pathPointIndex);
        pathPointIndex.value = nearestIndex;

        const pathPointIdx1 = mod(nearestIndex - 3, pathPointCount);
        const pathPointIdx2 = mod(nearestIndex - 4, pathPointCount);

        const pathPoint1 = this.trackPath[pathPointIdx1];
        const pathPoint2 = this.trackPath[pathPointIdx2];

        const trackOffset1: vec3 = this.calcTrackOffset(pathPointIdx1, arg3);
        const trackOffset2: vec3 = this.calcTrackOffset(pathPointIdx2, arg3);

        scratchVec3a[0] = (trackOffset1[0] + trackOffset2[0]) * 0.5;
        scratchVec3a[1] = (pathPoint1.pos[1] + pathPoint2.pos[1]) * 0.5;
        scratchVec3a[2] = (trackOffset1[2] + trackOffset2[2]) * 0.5;

        const delta = vec3.subtract(scratchVec3a, scratchVec3a, oldPos);
        const distance = vec3.length(delta);

        if (distance > 0.01) {
            const scale = (speed * DELTA_TIME) / distance;
            vec3.scaleAndAdd(pos, pos, delta, scale);
        }

        return this.calcPathTargetYaw(oldPos, pos);
    }

    /**func_8008B78C*/
    public tryMoveObjectAlongPath(object: Entity): void {
        switch (object.actionState) {
            case 0:
                break;
            case 1:
                this.moveObjectAlongSplinePath(object);
                break;
        }
    }

    public calcPathTargetYaw(p0: vec3, p1: vec3): number {
        const yaw = calcTargetAngleY(p0, p1);

        if (this.globals.isMirrorMode) {
            return -yaw;
        }
        return yaw;
    }

    /**func_8008AFE0*/
    private calcSplineVelocity(object: Entity, t: number): void {
        object.velocity[0] = getDerivativeBspline(this.splineControlX[0], this.splineControlX[1], this.splineControlX[2], this.splineControlX[3], t);
        object.velocity[1] = getDerivativeBspline(this.splineControlY[0], this.splineControlY[1], this.splineControlY[2], this.splineControlY[3], t);
        object.velocity[2] = getDerivativeBspline(this.splineControlZ[0], this.splineControlZ[1], this.splineControlZ[2], this.splineControlZ[3], t);
    }

    /**func_8008B17C*/
    private calcSplinePosition(object: Entity, t: number): void {
        object.offset[0] = getPointBspline(this.splineControlX[0], this.splineControlX[1], this.splineControlX[2], this.splineControlX[3], t);
        object.offset[1] = getPointBspline(this.splineControlY[0], this.splineControlY[1], this.splineControlY[2], this.splineControlY[3], t);
        object.offset[2] = getPointBspline(this.splineControlZ[0], this.splineControlZ[1], this.splineControlZ[2], this.splineControlZ[3], t);
    }

    /**func_8008B284*/
    public loadSplinePointsLooping(object: Entity): void {

        let splineIdx = object.splineIndex;

        const prevPointIndex = object.historyStack[9];
        const lastPointIndex = object.historyStack[8];

        let resetIndex = 10000;

        if ((prevPointIndex + 3) === lastPointIndex) {
            resetIndex = 2;
        } else if ((prevPointIndex + 2) === lastPointIndex) {
            resetIndex = 1;
        } else if ((prevPointIndex + 1) === lastPointIndex) {
            resetIndex = 0;
        }

        for (let i = 0; i < 4; i++) {
            this.splineControlX[i] = object.splinePath[splineIdx].pos[0];
            this.splineControlY[i] = object.splinePath[splineIdx].pos[1];
            this.splineControlZ[i] = object.splinePath[splineIdx].pos[2];

            if (resetIndex === i) {
                splineIdx = 0;
            } else {
                splineIdx++;
            }
        }
    }

    /**func_8008B1D4*/
    public loadSplinePoints(object: Entity): void {

        let splineIdx = object.splineIndex;
        for (let i = 0; i < 4; i++) {
            this.splineControlX[i] = object.splinePath[splineIdx].pos[0];
            this.splineControlY[i] = object.splinePath[splineIdx].pos[1];
            this.splineControlZ[i] = object.splinePath[splineIdx].pos[2];
            splineIdx++;
        }
    }

    /**func_8008B3E4*/
    private initSplinePath(object: Entity): void {
        if (object.isFlagInactive(EntityFlags.HasMovementStarted)) {
            object.historyStack[9] = 0;
            object.splineTime = 0;
            object.splineIndex = 0;
            object.historyStack[8] = object.splinePath.length - 1;

            object.setFlags(EntityFlags.HasMovementStarted);
        }
    }

    /**func_8008B478*/
    public updateSplineMotion(object: Entity, isLooping: boolean): void {

        this.initSplinePath(object);

        if (isLooping) {
            this.loadSplinePointsLooping(object);
        } else {
            this.loadSplinePoints(object);
        }

        const t = (object.splineTime / 10000);

        this.calcSplinePosition(object, t);

        if (object.isFlagActive(EntityFlags.CalcSplineVelocity)) {
            this.calcSplineVelocity(object, t);
        }

        const velocityA = object.splinePath[object.splineIndex + 0].param;
        const velocityB = object.splinePath[object.splineIndex + 1].param;

        object.splineDelta = 10000 / lerp(velocityA, velocityB, t);
        object.splineTime += object.splineDelta * DELTA_TIME;
    }

    /**func_8008B6A4*/
    public moveObjectAlongSplinePath(object: Entity): void {

        this.updateSplineMotion(object, true);

        if (object.splineTime >= 0x2710) {

            object.historyStack[9] += 1;

            if (object.historyStack[9] === object.historyStack[8]) {
                object.clearFlags(EntityFlags.HasMovementStarted);
            } else {
                object.advanceSplineIndex();
            }
        }
    }

    //func_8008A8B0
    public isPlayerInTrackSection(min: number, max: number): boolean {
        if (this.globals.nearestTrackSectionId >= min && this.globals.nearestTrackSectionId <= max) {
            return true;
        }

        return false
    }

    public getNextFreeParticle(particles: Entity[], searchSize: number = particles.length): Entity | null {
        for (let i = 0; i < searchSize; i++) {
            if (!particles[i].isInitialized) {
                particles[i].isInitialized = true;
                return particles[i];
            }
        }

        return null;
    }

    public IsFacingCamera(objectYaw: number, tolerance: number): boolean {
        const yawBinAngle = this.globals.cameraYaw * RadToBinAngle;
        const angleDiff = (yawBinAngle - objectYaw + (tolerance >> 1)) & 0xFFFF;

        return angleDiff <= tolerance;
    }

    public IsBehindCamera(pos: vec3): boolean {
        const globals = this.globals;

        const dx = pos[0] - globals.cameraPos[0];
        const dz = pos[2] - globals.cameraPos[2];

        return vec2.dot([globals.cameraFwd[0], globals.cameraFwd[2]], [dx, dz]) < 0;
    }

    /**func_8004A7AC*/
    public renderShadow(obj: Entity, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, scale: number): void {
        if (obj.isFlagActive(EntityFlags.HasShadow)) {
            vec3.set(scratchVec3b, obj.pos[0], obj.surfaceHeight + 0.8, obj.pos[2]);

            calcModelMatrix(scratchMtx1, scratchVec3b, [0x4000, 0, 0], scale);

            this.globals.commonShadowMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }
    }

    /**func_8004A6EC*/
    public renderShadowOnSurface(obj: Entity, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, scale: number): void {
        if (obj.isFlagActive(EntityFlags.HasShadow) && obj.isFlagActive(EntityFlags.IsOnSurface)) {
            vec3.set(scratchVec3b, obj.pos[0], obj.surfaceHeight + 0.8, obj.pos[2]);
            calcModelMatrix(scratchMtx1, scratchVec3b, obj.shadowDir, scale);
            this.globals.commonShadowMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }
    }

    public initRenderer2D(tlut: number, dramAddr: number, vertices: number, setupDL: number, fullHeight: number, fullWidth: number, heightDivisor: number, texMask: number = -1): BasicRspRenderer {
        const hash = hashFromValues([tlut, dramAddr, vertices, fullHeight, fullWidth, heightDivisor]);
        const globals = this.globals;

        if (this.globals.modelCache.has(hash)) {
            return this.globals.modelCache.get(hash)!;
        }

        F3DEX.runDL_F3DEX(globals.rspState, setupDL);

        globals.rspState.gDPLoadTLUT_pal256(tlut);
        for (let i = 0; i < fullHeight / heightDivisor; i++) {

            if (texMask >= 0) {
                globals.rspState.rsp_load_texture_mask(dramAddr, fullWidth, heightDivisor, texMask);
            }
            else {
                globals.rspState.rsp_load_texture(dramAddr, fullWidth, heightDivisor);
            }

            globals.rspState.gSPVertex(vertices, 4, 0);
            F3DEX.runDL_F3DEX(globals.rspState, 0x0D006940);

            dramAddr += fullWidth * (heightDivisor - 1);
            vertices += 4 * 0x10;
        }

        const renderer = new BasicRspRenderer(globals.renderCache, globals.rspState.finish(), true);

        this.globals.modelCache.set(hash, renderer);

        return renderer;
    }

    public destroy(device: GfxDevice): void {
        this.globals.modelCache.forEach(o => o.destroy(device));
        this.globals.gfxTextureCache.forEach(o => device.destroyTexture(o));

        this.globals.modelCache.clear();
        this.globals.gfxTextureCache.clear();

        this.sceneTexture.destroy(device);
        this.globals.renderHelper.destroy();
    }
}

export class MarioRacewayRenderer extends Mk64Renderer {
    constructor(globals: Mk64Globals) {
        super(globals);

        const sign0 = this.spawnActor(ActorType.MarioSign, [150, 40, -1300]);
        const sign1 = this.spawnActor(ActorType.MarioSign, [2520, 0, 1240]);

        sign1.flags |= ActorFlags.IsCollisionActive;
    }
}

export class WarioStadiumRenderer extends Mk64Renderer {
    constructor(globals: Mk64Globals) {
        super(globals);

        const warioSign0 = this.spawnActor(ActorType.WarioSign, [-131, 83, 286]);
        const warioSign1 = this.spawnActor(ActorType.WarioSign, [-2353, 72, -1608]);
        const warioSign2 = this.spawnActor(ActorType.WarioSign, [-2622, 79, 739]);
    }
}

export class RoyalRacewayRenderer extends Mk64Renderer {
    private ramps: BasicRspRenderer;
    private rampUlt = 0;

    constructor(globals: Mk64Globals) {
        super(globals);

        this.ramps = this.globals.initRendererFromDL(0x0600E0E0);
    }

    public override renderCourseAnimatedMdls(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.ramps.setTileSize(0, this.rampUlt);
        this.ramps.prepareToRender(renderInstManager, viewerInput);
    }

    public override updateCourseAnims(deltaTime: number): void {
        this.rampUlt = mod(this.rampUlt - (20 * deltaTime), 256);
    }
}

enum ThwompEventFlags {
    IsFalling = (1 << 0),
    HasCrushedPlayer = (1 << 1),
    IsTurningAround = (1 << 2),
    IsChasingPlayer = (1 << 3),
    ScreenShake = (1 << 4),
    SpawnDust = (1 << 5),
    IsKilled = (1 << 6),
    UnusedFlag7 = (1 << 7),
    UnusedFlag8 = (1 << 8),
}

enum ThwompCommonAction {
    Stomp = 0x32,
    StompOnPlayer = 0x64,
    StartRespawnTimer = 0xC8,
    TurnAround = 0x12C
}

enum FireBreathFlags {
    HasFireStarted = (1 << 0)
}

const thowmpShardMax = 50;

export class BowsersCastleRenderer extends Mk64Renderer {
    public firePillarTimer = 0;
    public shardAddDir = vec3.create();//D_8016582C

    public thwomps: Entity[] = [];
    public statueFlameS: Entity[] = [];
    public statueFlameL: Entity = new Entity(0);

    private dustMdl: BasicRspRenderer;
    private thwompShard: BasicRspRenderer;
    private fireBreathMdl: BasicRspRenderer;
    private firePillarMdl: BasicRspRenderer;

    constructor(globals: Mk64Globals) {
        super(globals);

        const thwompMdl = globals.initRendererFromDL(0x06009500);
        this.thwompShard = globals.initRendererFromDL(0x06009688);
        this.thwompShard.setLight(dThwompLights[2]);

        this.dustMdl = globals.initRendererFromDL(0x06009560, true);
        this.fireBreathMdl = globals.initRendererFromDL(0x06009600, true);
        this.firePillarMdl = globals.initRendererFromDL(0x060095B0, true);

        for (const spawnData of dThwompSpawns150CC) {
            const obj: Entity = new Entity(0);

            obj.originPos[0] = spawnData.x;
            obj.originPos[2] = spawnData.z;
            obj.objectType = spawnData.type;
            obj.primAlpha.value = spawnData.groupIndex;
            obj.modelInst = thwompMdl;

            this.thwomps.push(obj);
        }

        vec3.set(this.statueFlameL.pos, (-68 * this.xOrientation), 80, -1840);

        for (let i = 0; i < dFireBreathsSpawns.length; i++) {
            const firePos = dFireBreathsSpawns[i];
            const obj: Entity = new Entity(0);

            vec3.copy(obj.pos, firePos);
            obj.pos[0] *= this.xOrientation;

            obj.direction[1] = 0;

            if (i % 2) {
                obj.direction[1] += 0x8000;
            }

            this.statueFlameS.push(obj);
        }
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        this.calcThwompLightDir(dThwompLights[0].direction, this.lightDirection);

        for (const object of this.thwomps) {
            if ((object.state >= 2) && (object.isEventFlagInactive(ThwompEventFlags.IsKilled))) {
                this.renderShadow(object, renderInstManager, viewerInput, 1.75);

                const light = this.getThwompMaterialLight(object);

                calcModelMatrix(scratchMtx1, object.pos, object.orientation, object.scale.value);

                object.updateTextures(this.globals, object.activeTexture, object.activeTLUT);
                object.modelInst.setLight(light);
                object.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }

        for (const object of this.gObjectParticle3) {
            if ((object.state > 0) && (object.objectType === EntityType.ThwompBrokenShard)) {

                calcModelMatrix(scratchMtx1, object.pos, object.orientation, object.scale.value);
                this.thwompShard.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }

        for (const object of this.gObjectParticle2) {
            if ((object.state >= 2) && (object.objectType === EntityType.ThwompDust)) {

                calcModelMatrix(scratchMtx1, object.pos, Vec3Zero, object.scale.value);
                this.dustMdl.setPrimColor8(0xFF, 0xFF, 0xFF, object.primAlpha.value);
                this.dustMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }

        for (const object of this.gObjectParticle1) {
            if (object.isInitialized && object.state >= 3) {

                if (!this.enableUnusedGfx && object.objectType === EntityType.FlamePillar) {
                    continue;
                }

                let flameMdl: BasicRspRenderer;

                if (object.objectType === EntityType.FlamePillar) {
                    flameMdl = this.firePillarMdl;
                }
                else {
                    flameMdl = this.fireBreathMdl;
                }

                calcModelMatrix(scratchMtx1, object.pos, Vec3Zero, object.scale.value);

                flameMdl.setPrimColor8(0xFF, object.userValB.value, 0, object.primAlpha.value);
                flameMdl.setEnvColor8(object.userValA.value, 0, 0, 0xFF);
                flameMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }
    }

    private calcThwompLightDir(dest: vec3, rot: vec3): void {
        rot[0] = interpS16(rot[0]);
        rot[1] = interpS16(rot[1]);
        rotateVectorXY(dest, rot);
    }

    /**func_800534E8*/
    private getThwompMaterialLight(object: Entity): Light1 {
        if (object.userValB.value >= dThwompLights.length) {
            return dThwompLights[0];
        }
        return dThwompLights[object.userValB.value];
    }

    override updateObjects(): void {

        // Thwomps update at 60fps
        DELTA_TIME *= 2;
        let areBothChaserThwompFree = true;
        this.lightDirection[0] += 0x100 * DELTA_TIME;
        this.lightDirection[1] += 0x200 * DELTA_TIME;

        for (const thwomp of this.thwomps) {
            thwomp.clearEventFlags(ThwompEventFlags.ScreenShake);
            thwomp.setNearFlagsTrue();

            if (thwomp.objectType === ThwompType.Chaser) {
                if (!(thwomp.state >= 2 && thwomp.isEventFlagInactive(ThwompEventFlags.IsChasingPlayer))) {
                    areBothChaserThwompFree = false;
                }
            }

            if (thwomp.state !== 0) {
                switch (thwomp.objectType) {
                    case ThwompType.Crusher:
                        this.updateCrusherThwomp(thwomp);
                        break;
                    case ThwompType.Patrol:
                        this.updatePatrolThwomp(thwomp);
                        break;
                    case ThwompType.Chaser:
                        this.updateChaserThwomp(thwomp);
                        break;
                    case ThwompType.Guard:
                        this.updateGuardThwomp(thwomp);
                        break;
                    case ThwompType.Slider:
                        this.updateSliderThwomp(thwomp);
                        break;
                    case ThwompType.Caged:
                        this.updateCagedThwomp(thwomp);
                        break;
                }
            }

            if (thwomp.isFlagActive(EntityFlags.IsCollisionActive) && IsTargetInRangeXYZ(thwomp.pos, this.globals.cameraPos, 25.0)) {
                this.spawnThwompShards(thwomp.pos);
                thwomp.clearFlags(EntityFlags.IsCollisionActive);
                thwomp.setEventFlags(ThwompEventFlags.IsKilled);
                thwomp.resetAllActionStates();
                thwomp.setState(ThwompCommonAction.StartRespawnTimer);
            }
        }

        if (areBothChaserThwompFree) {
            this.setupChaserEvent();
        }

        this.updateAllThwompShards();

        for (const thwomp of this.thwomps) {
            thwomp.clearFlags(EntityFlags.IsInArea | EntityFlags.IsVisible | EntityFlags.IsNearArea);
            thwomp.clearEventFlags(ThwompEventFlags.ScreenShake | ThwompEventFlags.UnusedFlag8);

            if (thwomp.isEventFlagActive(ThwompEventFlags.IsFalling)) {

                const verticalDist = Math.abs(thwomp.pos[1] - this.globals.cameraPos[1]);

                if ((verticalDist <= 17.5) && IsTargetInRangeXZ(thwomp.pos, this.globals.cameraPos, 50.0)) {
                    thwomp.setEventFlags(ThwompEventFlags.HasCrushedPlayer);
                }
            }

            if (thwomp.isEventFlagInactive(ThwompEventFlags.SpawnDust)) {
                continue;
            }

            thwomp.clearEventFlags(ThwompEventFlags.SpawnDust);
            this.spawnDustGroup(thwomp);
        }

        for (const dustParticle of this.gObjectParticle2) {
            if (!dustParticle.isInitialized && dustParticle.state === 0) {
                continue;
            }

            this.updateDustParticle(dustParticle);

            if (dustParticle.state !== 0) {
                continue;
            }

            dustParticle.deleteObject();
        }

        DELTA_TIME /= 2;

        this.updateFlameParticles();
    }

    /**func_800750D8*/
    private initThwompShard(object: Entity, index: number, spawnPos: vec3): void {

        object.init(0);

        const randomA = random_int(500);
        const randomB = random_int(50);

        object.objectType = EntityType.ThwompBrokenShard;
        object.scale.value = (randomA * 0.0005) + 0.05;
        object.velocity[1] = (randomB * (0.05 * 1.0)) + 2.0;
        object.speed.value = ((randomB % 5) * 0.1) + 1.0;
        object.direction[1] = (index << 0x10) / thowmpShardMax;
        object.originPos[0] = (spawnPos[0] + (randomB / 2)) - 12.0;
        object.originPos[1] = (spawnPos[1] - 10.0) + random_int(10);
        object.originPos[2] = (spawnPos[2] + (randomB / 2)) - 12.0;
        object.orientation[0] = randomA << 7;
        object.orientation[1] = randomB * 0x50;
        object.orientation[2] = randomB * 0x50;
    }

    /**func_80075304*/
    private spawnThwompShards(spawnPos: vec3): void {
        for (let i = 0; i < thowmpShardMax; i++) {
            const object = this.getNextFreeParticle(this.gObjectParticle3);

            if (!object) {
                return;
            }

            this.initThwompShard(object, i, spawnPos);
        }
    }

    /**func_8007542C*/
    private updateAllThwompShards(): void {
        this.shardAddDir[0] += 0x2000 * DELTA_TIME;
        this.shardAddDir[1] += 0x1000 * DELTA_TIME;
        this.shardAddDir[2] += 0x1800 * DELTA_TIME;

        for (const object of this.gObjectParticle3) {
            if (object.state !== 0) {

                this.updateThwompShard(object);

                if (object.state === 0) {
                    object.deleteObject();
                }
            }
        }
    }

    /**func_80074FD8*/
    private updateThwompShard(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                if (object.applyDirectionalVelocity(object.velocity[1], 0.12, object.speed.value, object.direction[1], 100)) {
                    object.advanceState();
                }
                object.updatePosition();
                object.orientation[0] += this.shardAddDir[0];
                object.orientation[1] += this.shardAddDir[1];
                object.orientation[2] += this.shardAddDir[2];
                break;
            case 2:
                object.resetAllActionStates();
                object.resetAllStates();
                break;
        }
    }

    /**func_8007F75C*/
    private setupChaserEvent(): void {
        const nearestPoint = this.globals.nearestPathPointIdx;

        if ((nearestPoint >= 0xAA) && (nearestPoint < 0xB5)) {
            const zigzagTimer = random_int(0x32) + 0x32;

            for (const thwomp of this.thwomps) {
                if (thwomp.objectType === ThwompType.Chaser) {

                    thwomp.setEventFlags(ThwompEventFlags.IsChasingPlayer);
                    thwomp.initActionState();
                    thwomp.actionBehaviorType = 1;
                    thwomp.nearestPlayerId = 0;
                    thwomp.userTimer = zigzagTimer;
                }
            }
        }
        else if ((nearestPoint >= 0xD7) && (nearestPoint < 0xE2)) {
            for (const thwomp of this.thwomps) {
                if (thwomp.objectType === ThwompType.Chaser) {

                    thwomp.setEventFlags(ThwompEventFlags.IsChasingPlayer);
                    thwomp.initActionState();
                    thwomp.actionBehaviorType = 2;
                    thwomp.targetPos[0] = this.globals.cameraPos[0] - thwomp.originPos[0];
                    thwomp.nearestPlayerId = 0;
                }
            }
        }
    }

    /**func_8007E63C*/
    private updateThwompCommon(object: Entity): void {
        switch (object.state) {
            case ThwompCommonAction.Stomp:// Hop a bit before falling
                if (object.stepUpToTargetV(object.offset, 1, object.targetPos[1] + 15.0, 1.5)) {
                    object.setFlags(EntityFlags.IsCollisionActive);
                    object.setEventFlags(ThwompEventFlags.IsFalling);
                    object.clearEventFlags(ThwompEventFlags.HasCrushedPlayer);
                    object.advanceState();
                }
                break;
            case 0x33:// Slam down
                if (object.stepDownToTargetV(object.offset, 1, 0, 2)) {
                    if (object.offset[1] >= 16) {
                        object.texIndex = 0;
                    } else if (object.offset[1] >= 8) {
                        object.texIndex = 1;
                    } else {
                        object.texIndex = 2;// the above are never possible 
                    }

                    object.clearEventFlags(ThwompEventFlags.IsFalling);

                    if (object.isFlagActive(EntityFlags.IsNearArea)) {

                        object.setEventFlags(ThwompEventFlags.ScreenShake);

                        if (object.isFlagActive(EntityFlags.IsVisible)) {
                            object.setEventFlags(ThwompEventFlags.SpawnDust);
                        }
                    }

                    if (object.isEventFlagActive(ThwompEventFlags.HasCrushedPlayer)) {
                        object.setState(ThwompCommonAction.StompOnPlayer);
                    } else {
                        object.advanceState();
                    }
                }
                break;
            case 0x34:// Initial impact
                object.setTextureForDuration(3, 6);
                break;
            case 0x35:// Pause on impact
                object.setTextureForDuration(2, 50);
                break;
            case 0x36:// Going back up to start Y position
                if (object.offset[1] >= 20) {
                    object.texIndex = 0;
                } else if (object.offset[1] >= 18) {
                    object.texIndex = 1;
                }

                if (object.stepUpToTargetV(object.offset, 1, object.targetPos[1], 0.5)) {
                    object.clearFlags(EntityFlags.IsCollisionActive);
                    object.restorePreviousState();
                }
                break;

            case ThwompCommonAction.StompOnPlayer:
                // Laughing at player
                object.textureLoopForward(3, 5, 1, 8, 0);
                break;
            case 0x65:// Short pause after laughing
                object.runTimer(30);
                break;
            case 0x66:// Up a little bit
                if (object.stepUpToTargetV(object.offset, 1, 20, 1.5)) {
                    object.advanceState();
                }
                break;
            case 0x67:// Slam down again...
                if (object.stepDownToTargetV(object.offset, 1, 0, 1.5)) {
                    if (object.isFlagActive(EntityFlags.IsInArea)) {

                        object.setEventFlags(ThwompEventFlags.ScreenShake);

                        if (object.isFlagActive(EntityFlags.IsVisible)) {
                            object.setEventFlags(ThwompEventFlags.SpawnDust);
                        }
                    }
                    object.advanceState();
                }
                break;
            case 0x68:
                if (object.stepUpToTargetV(object.offset, 1, 12, 1.5)) {
                    object.advanceState();
                }
                break;
            case 0x69://Final slam
                if (object.stepDownToTargetV(object.offset, 1, 0, 1.5)) {

                    if (object.isFlagActive(EntityFlags.IsInArea)) {

                        object.setEventFlags(ThwompEventFlags.ScreenShake);

                        if (object.isFlagActive(EntityFlags.IsVisible)) {
                            object.setEventFlags(ThwompEventFlags.SpawnDust);
                        }
                    }

                    object.advanceState();
                }
                break;
            case 0x6A:
                if (object.textureLoopOscillate(5, 3, 1, 6, 3, false)) {
                    //object.func_80080DE4();
                }
                break;
            case 0x6B:// Going back up to start Y position
                if (object.offset[1] >= 22) {
                    object.texIndex = 0;
                } else if (object.offset[1] >= 20) {
                    object.texIndex = 1;
                } else if (object.offset[1] >= 18) {
                    object.texIndex = 2;
                } else if (object.offset[1] >= 16) {
                    object.texIndex = 3;
                } else if (object.offset[1] >= 14) {
                    object.texIndex = 4;
                } else {
                    object.textureLoopOscillate(3, 5, 1, 6, -1);
                }

                if (object.stepUpToTargetV(object.offset, 1, object.targetPos[1], 0.5)) {
                    object.setTextureTimerState(false);
                    object.advanceState();
                }
                break;
            case 0x6C:// reset back to previous state
                // changing the timer from 100 frames so it looks more natural
                if (object.runTimer(10)) {
                    object.clearEventFlags(ThwompEventFlags.HasCrushedPlayer);
                    object.clearFlags(EntityFlags.IsCollisionActive);
                    object.restorePreviousState();
                }
                break;
            case ThwompCommonAction.StartRespawnTimer:// has been killed by star
                if (object.runTimer(3000)) {
                    object.isEventFlagActive(ThwompEventFlags.UnusedFlag7);
                    object.resetAllStates();
                    object.setState(1);
                }
                break;

            case ThwompCommonAction.TurnAround:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x8000)) {
                    object.clearEventFlags(ThwompEventFlags.IsTurningAround);
                    object.restorePreviousState();
                }
                break;
        }
    }

    /**func_8007EC30*/
    private initCrusherThwomp(object: Entity): void {
        object.surfaceHeight = 0;
        object.originPos[1] = 0;
        object.setOffset(0, 0, 0);

        if (this.globals.isMirrorMode) {
            object.setDirection(0, 0x4000, 0);
            object.setOrientation(0, 0x4000, 0);
        } else {
            object.setDirection(0, 0xC000, 0);
            object.setOrientation(0, 0xC000, 0);
        }

        object.setTextureList(0x06006F38, 0x06007138, 16, 64);
        object.displayList = 0x06009078;
        object.boundingBoxSize = 12;
        object.setScale(1);
        object.targetPos[1] = 30;
        object.setFlags(EntityFlags.HasShadow | EntityFlags.Unk24 | EntityFlags.IsCollisionActive | EntityFlags.unk_26);
        object.userValB.value = 0;
        object.trackSectionId = 6;
        object.resetHistoryStack();
        object.advanceState();
    }

    /**func_8007ED6C*/
    private updateCrusherThwomp(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initCrusherThwomp(object);
                break;
            case 2:
                object.runTimer(60);
                break;
            case 3:
                object.setStateWithHistory(ThwompCommonAction.Stomp);
                break;
            case 4:
                if (object.isEventFlagInactive(ThwompEventFlags.IsTurningAround) &&
                    IsTargetInRangeXZ(object.pos, this.globals.cameraPos, 300.0) &&
                    !this.IsBehindCamera(object.pos) &&
                    this.IsFacingCamera(object.direction[1], 0x1555)) {
                    object.setEventFlags(ThwompEventFlags.IsTurningAround);
                    object.setStateAndHistory(ThwompCommonAction.TurnAround, 2);
                }
                else {
                    object.setState(2);
                }
                break;
        }

        this.updateThwompCommon(object);

        object.updatePosition();
        object.direction[1] = object.orientation[1];
        object.updateActiveTexture();
    }

    /**func_8007EE5C*/
    private initPatrolThwomp(object: Entity): void {
        object.setTextureList(0x06006F38, 0x06007138, 16, 64);
        object.setScale(1);
        object.displayList = 0x06009078;
        object.boundingBoxSize = 0x000C;
        object.setFlags(EntityFlags.HasShadow | EntityFlags.IsCollisionActive | EntityFlags.unk_26);
        object.userValB.value = 0;
        object.trackSectionId = 6;
        object.initActionState();
        object.surfaceHeight = 0;
        object.originPos[1] = 0;
        object.setOffset(0, 20, 0);
        object.targetPos[1] = 20;
        if (this.globals.isMirrorMode) {
            object.setDirection(0, 0x4000, 0);
            object.setOrientation(0, 0x4000, 0);
        } else {
            object.setDirection(0, 0xC000, 0);
            object.setOrientation(0, 0xC000, 0);
        }

        object.actionState = 1;
        if (object.primAlpha.value === 0) {
            object.actionBehaviorType = 1;
        }
        else {
            object.actionBehaviorType = 2;
        }
        object.advanceState();
    }

    /**func_8007F5A8*/
    private updatePatrolThwomp(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initPatrolThwomp(object);
                break;
            case 3:
                object.setStateWithHistory(ThwompCommonAction.Stomp);
                break;
            case 4:
                object.advanceActionState();
                object.advanceState();
                break;
        }
        this.updateThwompCommon(object);
        this.updatePatrolRoutine(object);

        object.updatePosition();
        object.updateActiveTexture();
    }

    /**func_8007F544*/
    private updatePatrolRoutine(object: Entity): void {
        switch (object.actionBehaviorType) {
            case 1:
                this.PatrolPatrolForward(object);
                break;
            case 2:
                this.PatrolPatrolBackward(object);
                break;
        }
    }

    /**func_8007EFBC*/
    private PatrolPatrolForward(object: Entity): void {
        switch (object.actionState) {
            case 1:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0800, 0x8000)) {
                    object.targetPos[0] = this.xOrientation * 200;
                    object.advanceActionState();
                }
                break;
            case 2:
                if (object.chaseV(object.offset, 0, object.targetPos[0], 4)) {
                    object.advanceActionState();
                }
                break;
            case 3:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x8000)) {
                    object.setState(3);
                    object.advanceActionState();
                }
                break;
            case 5:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0xC000)) {
                    object.advanceActionState();
                }
                break;
            case 6:
                if (object.stepDownToTargetV(object.offset, 2, -100, 2)) {
                    object.advanceActionState();
                }
                break;
            case 7:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x4000)) {
                    object.advanceActionState();
                    object.setState(3);
                }
                break;
            case 9:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x10000)) {
                    object.advanceActionState();
                }
                break;
            case 10:
                if (object.chaseV(object.offset, 0, 0, 4)) {
                    object.advanceActionState();
                }
                break;
            case 11:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x10000)) {
                    object.advanceActionState();
                    object.setState(3);
                }
                break;
            case 13:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x14000)) {
                    object.advanceActionState();
                }
                break;
            case 14:
                if (object.stepUpToTargetV(object.offset, 2, 0, 2)) {
                    object.advanceActionState();
                }
                break;
            case 15:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0xC000)) {
                    object.advanceActionState();
                    object.setState(3);
                }
                break;
            case 17:
                object.setActionState(1);
                break;
            case 0:
            default:
                break;
        }
    }

    /**func_8007F280*/
    private PatrolPatrolBackward(object: Entity): void {
        switch (object.actionState) {
            case 1:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x10000)) {
                    object.targetPos[0] = this.xOrientation * -200.0;
                    object.advanceActionState();
                }
                break;
            case 2:
                if (object.chaseV(object.offset, 0, object.targetPos[0], 4)) {
                    object.advanceActionState();
                }
                break;
            case 3:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x10000)) {
                    object.setState(3);
                    object.advanceActionState();
                }
                break;
            case 5:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x4000)) {
                    object.advanceActionState();
                }
                break;
            case 6:
                if (object.stepUpToTargetV(object.offset, 2, 100, 2)) {
                    object.advanceActionState();
                }
                break;
            case 7:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0xC000)) {
                    object.advanceActionState();
                    object.setState(3);
                }
                break;
            case 9:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x8000)) {
                    object.advanceActionState();
                }
                break;
            case 10:
                if (object.chaseV(object.offset, 0, 0, 4)) {
                    object.advanceActionState();
                }
                break;
            case 11:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x8000)) {
                    object.advanceActionState();
                    object.setState(3);
                }
                break;
            case 13:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0xC000)) {
                    object.advanceActionState();
                }
                break;
            case 14:
                if (object.stepDownToTargetV(object.offset, 2, 0, 2)) {
                    object.advanceActionState();
                }
                break;
            case 15:
                if (object.stepTowardsTargetYaw(object.orientation, 0x0400, 0x14000)) {
                    object.advanceActionState();
                    object.setState(3);
                }
                break;
            case 17:
                object.setActionState(1);
                break;
            default:
                break;
        }
    }

    /**func_8007FA08*/
    private initChaserThwomp(object: Entity): void {

        object.setTextureList(0x06006F38, 0x06007138, 16, 64);
        object.displayList = 0x06009078;
        object.boundingBoxSize = 0x000C;
        object.setScale(1.0);
        object.setFlags(EntityFlags.HasShadow | EntityFlags.IsCollisionActive | EntityFlags.unk_26);
        object.userValB.value = 0;
        object.surfaceHeight = 0;
        object.originPos[1] = 0;
        object.setOffset(0, 0, 0);
        object.setDirection(0, 0, 0);
        if (this.globals.isMirrorMode) {
            object.setOrientation(0, 0xC000, 0);
        } else {
            object.setOrientation(0, 0x4000, 0);
        }
        object.velocity[0] = 0;
        object.direction[1] = object.orientation[1];
        object.actionBehaviorType = 1;
        object.trackSectionId = 8;
        object.offset[1] = 15.0;
        object.targetPos[1] = 15.0;
        object.advanceState();
    }

    /**func_8007FFC0*/
    private updateChaserThwomp(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initChaserThwomp(object);
                break;
            case 3:
                object.setStateWithHistory(ThwompCommonAction.Stomp);
                break;
            case 4://return to origin
                object.advanceState();
                object.advanceActionState();
                break;
        }

        this.updateThwompCommon(object);
        this.updateChaserRoutine(object);

        object.updatePosition();
        object.updateActiveTexture();
    }

    /**func_8007FF5C*/
    private updateChaserRoutine(object: Entity): void {
        switch (object.actionBehaviorType) {
            case 1:
                this.chaserMoveToTargetZigzag(object);
                break;
            case 2:
                this.chaserMoveToTarget(object);
                break;
        }
    }

    /**func_8007FB48*/
    private chaserMoveToTargetZigzag(object: Entity): void {
        switch (object.actionState) {
            case 1:
                object.actionTimer = 160;
                object.offset[0] = 0;
                object.offset[2] = 0;
                object.velocity[2] = 0;
                object.advanceActionState();
                break;
            case 2:

                if (IsTargetInRangeXZ(object.pos, this.globals.cameraPos, 100)) {
                    object.velocity[0] = this.globals.cameraSpeed * DELTA_TIME * (this.xOrientation * 1.25);
                }
                else {
                    object.velocity[0] = 1.25 * DELTA_TIME;
                }

                if (object.userTimer >= object.actionTimer) {
                    if (crossedTime(object.actionTimer, object.userTimer)) {
                        if (Math.floor(SCENE_TIME) % 2 === 1) {
                            object.velocity[2] = 1.5;
                        } else {
                            object.velocity[2] = -1.5;
                        }
                    }

                    if (object.velocity[2] >= 0.0) {
                        if (object.offset[2] >= 40.0) {
                            object.velocity[2] = -1.5;
                        }
                    }
                    else if (object.offset[2] <= -40.0) {
                        object.velocity[2] = 1.5;
                    }
                }

                object.applyVelocityToOffsetXZ();

                if (object.actionTimer < 101) {
                    object.orientation[1] = stepTowardsAngle(object.orientation[1], (object.direction[1] + 0x8000));

                    if (crossedTime(object.actionTimer, 100)) {
                        object.texIndex = 1;
                    }
                }

                let isOutOfBounds: boolean = false;
                if (this.globals.isMirrorMode) {
                    if (object.offset[0] <= -1000.0) {
                        isOutOfBounds = true;
                    }
                } else if (object.offset[0] >= 1000.0) {
                    isOutOfBounds = true;
                }

                object.actionTimer -= DELTA_TIME;

                if ((object.actionTimer <= 0) || isOutOfBounds) {
                    object.speed.value = 0.0;
                    object.setState(3);
                    object.advanceActionState();
                }
                break;
            case 4:
                object.chaseV(object.offset, 2, 0.0, 2.0);
                object.chaseV(object.offset, 0, 0.0, 5.0);

                if (object.offset[0] + object.offset[2] === 0.0) {
                    object.advanceActionState();
                }
                break;
            case 5:
                object.orientation[1] = stepTowardsAngle(object.orientation[1], object.direction[1]);
                if (object.orientation[1] === object.direction[1]) {
                    object.clearEventFlags(ThwompEventFlags.IsChasingPlayer);
                    object.advanceActionState();
                    object.texIndex = 0;
                }
                break;
            default:
                break;
        }
    }

    /**func_8007FEA4*/
    private chaserMoveToTarget(object: Entity): void {
        switch (object.actionState) {
            case 1:
                if (object.chaseV(object.offset, 0, object.targetPos[0], 5)) {
                    object.setState(3);
                    object.advanceActionState();
                }
                break;
            case 3:
                if (object.chaseV(object.offset, 0, 0.0, 5.0)) {
                    object.advanceActionState();
                    object.clearEventFlags(ThwompEventFlags.IsChasingPlayer);
                }
                break;
        }
    }

    /**func_80080078*/
    private initGuardThwomp(object: Entity): void {
        object.setTextureList(0x06006F38, 0x06007138, 16, 64);
        object.displayList = 0x06009078;//d_course_bowsers_castle_dl_thwomp;
        object.boundingBoxSize = 0x000C;
        object.setScale(1);
        object.setFlags(EntityFlags.HasShadow | EntityFlags.IsCollisionActive | EntityFlags.unk_26);
        object.userValB.value = 2;
        object.trackSectionId = 8;
        object.setDirection(0, 0, 0);
        object.surfaceHeight = 0;
        object.originPos[1] = 0;
        object.setOffset(0, 0, 0);
        object.targetPos[1] = 30.0;
        if (this.globals.isMirrorMode) {
            object.setOrientation(0, 0x4000, 0);
        } else {
            object.setOrientation(0, 0xC000, 0);
        }
        switch (object.primAlpha.value) {
            case 0: object.texAnimTimer = 2; break;
            case 1: object.texAnimTimer = 60; break;
            case 2: object.texAnimTimer = 120; break;
            case 3: object.texAnimTimer = 180; break;
        }
        object.resetHistoryStack();
        object.advanceState();
    }

    /**func_800801FC*/
    private updateGuardThwomp(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initGuardThwomp(object);
                break;
            case 2:
                object.runTimer(object.texAnimTimer);
                break;
            case 3:
                object.setStateWithHistory(ThwompCommonAction.Stomp);
                break;
            case 4:
                object.texAnimTimer = 60;
                object.setState(2);
                break;
        }

        this.updateThwompCommon(object);

        object.updatePosition();
        object.updateActiveTexture();
    }

    /**func_800802C0*/
    private initCagedThwomp(object: Entity): void {
        object.currentAnimIndex = 0;
        object.setTextureList(0x06006F38, 0x06007138, 16, 64);
        object.displayList = 0x06009078;
        object.texIndex = 0;
        object.boundingBoxSize = 0x000C;
        object.setScale(1.5);
        object.setFlags(EntityFlags.HasShadow | EntityFlags.IsCollisionActive | EntityFlags.Unk24 | EntityFlags.unk_26);
        object.userValB.value = 1;
        object.trackSectionId = 6;
        object.setOffset(0.0, 0.0, 0.0);
        object.setDirection(0, 0, 0);
        object.surfaceHeight = 0.0;
        object.originPos[1] = 0.0;
        object.targetPos[1] = 10.0;
        if (this.globals.isMirrorMode) {
            object.setOrientation(0, 0x4000, 0);
        } else {
            object.setOrientation(0, 0xC000, 0);
        }

        object.setOffset(0, 10, 0);
        object.resetHistoryStack();
        object.advanceState();
    }

    /**func_80080408*/
    private updateCagedThwomp(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initCagedThwomp(object);
                break;
            case 2:
                object.updateVisibilityFlags(this.globals.cameraPos, 100.0);
                if (object.isFlagActive(EntityFlags.IsVisible)) {
                    //func_800C98B8(object.pos, object.velocity, SOUND_ARG_LOAD(0x19, 0x01, 0x80, 0x45));
                    object.advanceState();
                }
                break;
            case 3:
                if (object.textureLoopOscillate(3, 5, 1, 6, 6)) {
                    object.texIndex = 0;
                }
                break;
            case 4:
                if (object.runTimer(300)) {
                    object.setState(2);
                }
                break;
        }

        object.updatePosition();
        object.updateActiveTexture();
    }

    /**func_80080524*/
    private initSliderThwomp(object: Entity): void {
        object.setTextureList(0x06006F38, 0x06007138, 16, 64);
        object.displayList = 0x06009078;
        object.boundingBoxSize = 12;
        object.texIndex = 0;
        object.setScale(1);
        object.setFlags(EntityFlags.HasShadow | EntityFlags.IsCollisionActive | EntityFlags.unk_26);
        object.userValB.value = 0;
        object.trackSectionId = 0x0A;
        object.initActionState();
        object.setOffset(0.0, 0.0, 0.0);
        object.surfaceHeight = 70;
        object.originPos[1] = 70;
        object.targetPos[1] = 0.0;
        object.setDirection(0, 0, 0);
        object.actionBehaviorType = 2;

        if (this.globals.isMirrorMode) {
            object.setOrientation(0, 0xC000, 0);
        } else {
            object.setOrientation(0, 0x4000, 0);
        }

        switch (object.primAlpha.value) {
            case 0:
                object.velocity[2] = -1.0;
                break;
            case 1:
                object.velocity[2] = -1.5;
                break;
        }
        object.setEventFlags(ThwompEventFlags.UnusedFlag7);
        object.advanceState();
    }

    /**func_800808CC*/
    private updateSliderThwomp(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initSliderThwomp(object);
                break;
            case 2:
                object.textureLoopOscillate(3, 5, 1, 6, -1);
                break;
        }

        if (object.state >= 2) {
            this.updateThwompCommon(object);
            this.updateSliderRoutine(object);
            object.updateActiveTexture();
        }
    }

    /**func_8008085C*/
    private updateSliderRoutine(object: Entity): void {
        switch (object.actionBehaviorType) {
            case 1:
                this.updateSliderMovement(object, false);
                break;
            case 2:
                this.updateSliderMovement(object, true);//func_8008078C
                break;
        }
        object.updatePosition();
    }

    /**func_800806BC*/
    private updateSliderMovement(object: Entity, reverse: boolean): void {
        const value = reverse ? -250 : 250;
        switch (object.actionState) {
            case 1:
                if (object.chaseV(object.offset, 2, value, object.velocity[2])) {
                    object.velocity[2] = -object.velocity[2];
                    object.advanceActionState();
                }
                break;
            case 2:
                if (object.chaseV(object.offset, 2, 0.0, object.velocity[2])) {
                    object.velocity[2] = -object.velocity[2];
                    object.setActionState(1);
                }
                break;
        }
    }

    /**func_80081080*/
    public initDustParticle(object: Entity): void {

        object.activeTexture = 0x0D02D158;
        object.textureListAddr = 0x0D02D158;
        object.primAlpha.value = 0xFF;
        object.direction[1] = 0;

        object.setOrientation(0, 0, 0);
        object.setOffset(0, 0, 0);
        object.setScale(0.25);
        object.advanceState();
    }

    /**func_800810F4*/
    public updateDustParticle(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initDustParticle(object);
                break;
            case 2:
                object.applyVelocityToOffsetXZ();
                object.stepUpToTargetV(object.offset, 1, 14.0, 0.5);
                object.tryStepUpToTargetF(object.scale, 0.25, 0.75, 0.025, 1, 0);

                if (object.stepDownToTargetLoopS(object.primAlpha, 255, 0, 4, 0, 0)) {
                    object.advanceState();
                }
                break;
            case 3:
                object.resetAllStates();
                break;
        }
        object.updatePosition();
    }

    /**func_80080FEC*/
    public spawnDustGroup(thwompObj: Entity): void {
        for (let i = 0; i < 6; i++) {
            const dust = this.getNextFreeParticle(this.gObjectParticle2);

            if (!dust) {
                return;
            }

            dust.init(i);

            const yaw = thwompObj.direction[1] * BinAngleToRad;
            const velocityAngle = (thwompObj.direction[1] + dDustAngleOffsets[i]) * BinAngleToRad;
            const rotated = vec2.rotate(scratchVec2a, dDustPosOffsets[i], Vec2Zero, yaw);

            dust.objectType = EntityType.ThwompDust;
            dust.originPos[0] = thwompObj.pos[0] + rotated[0];
            dust.originPos[1] = thwompObj.surfaceHeight - 9.0;
            dust.originPos[2] = thwompObj.pos[2] + rotated[1];
            dust.velocity[0] = Math.sin(velocityAngle) * 0.6;
            dust.velocity[2] = Math.cos(velocityAngle) * 0.6;

            dust.isInitialized = true;
        }
    }

    private updateFlameParticles(): void {

        this.updateStatueLarge();

        for (let i = 0; i < 4; i++) {
            this.updateStatueSmall(this.statueFlameS[i]);
        }

        if (this.firePillarTimer >= 0.4) {
            this.spawnRandomFlamePillar(0);
            this.spawnRandomFlamePillar(1);
            this.spawnRandomFlamePillar(2);
            this.firePillarTimer -= 0.4;
        }

        this.firePillarTimer += DELTA_TIME;

        for (let i = 0; i < this.gObjectParticle1.length; i++) {
            const object = this.gObjectParticle1[i];

            if (object.state !== 0) {
                if ((object.objectType === EntityType.BowserStatueFire) || (object.objectType === EntityType.BowserStatueFireSmall)) {
                    this.updateFlameColor(object);
                    this.updateFlameMovement(object);
                } else if (object.objectType === EntityType.FlamePillar) {
                    this.updateFlamePillarColor(object);
                    this.updateFlamePillarMovement(object);
                }

                if (object.state === 0) {
                    object.deleteObject();
                }
            }
        }
    }

    /**func_80076884*/
    private spawnRandomFlamePillar(groupIndex: number): void {
        // The game has this set to 15... it'll read out of bounds.
        const rndIndex = random_int(14);

        switch (groupIndex) {
            case 0:
                this.initFlamePillarParticle(dFlamePillarSpawnsA[rndIndex], 0);
                break;
            case 1:
                this.initFlamePillarParticle(dFlamePillarSpawnsB[rndIndex], 0);
                break;
            case 2:
                this.initFlamePillarParticle(dFlamePillarSpawnsC[rndIndex], 0);
                break;
        }
    }

    /**func_8007601C*/
    private updateStatueSmall(rootS: Entity): void {

        if (rootS.timer > 0) {

            rootS.timer -= DELTA_TIME;

            if (rootS.timer <= 0) {
                rootS.clearEventFlags(FireBreathFlags.HasFireStarted);
            }
        }

        // Sound timer
        // if (rootS.userVal > 0) {
        //     rootS.userVal -= DELTA_TIME;
        //     if (rootS.userVal <= 0) {
        //     }
        // }

        if (rootS.timer <= 0) {

            rootS.updateVisibilityFlags(this.globals.cameraPos, 700.0);

            if ((rootS.isFlagActive(EntityFlags.IsVisible)) && (rootS.isEventFlagInactive(FireBreathFlags.HasFireStarted))) {

                rootS.setEventFlags(FireBreathFlags.HasFireStarted);
                this.spawnFireBreathSmall(rootS.pos, rootS.direction[1], 1.0);

                if (rootS.userValB.value > 0) {
                    rootS.userValB.value--;
                    rootS.timer = 90;
                } else {
                    rootS.timer = 300;
                }

                rootS.userTimer = 60;
            }
        }

        if (!this.isPlayerInTrackSection(9, 11)) {
            rootS.userValB.value = 2;
        }
    }

    /**func_8007661C*/
    private updateStatueLarge(): void {

        const rootF = this.statueFlameL;

        if (rootF.timer > 0) {

            rootF.timer -= DELTA_TIME;

            if (rootF.timer <= 0) {
                rootF.clearEventFlags(FireBreathFlags.HasFireStarted);
            }
        }

        //sound timer
        // if (rootF.userTimer > 0) {
        //     rootF.userTimer--;
        //     if (rootF.userTimer <= 0) {
        //         //func_800C9EF4(flame.pos, SOUND_ARG_LOAD(0x51, 0x03, 0x80, 0x09));
        //     }
        // }

        if (rootF.timer <= 0) {
            rootF.updateVisibilityFlags(this.globals.cameraPos, 750);
            if ((rootF.isFlagActive(EntityFlags.IsVisible)) && rootF.isEventFlagInactive(FireBreathFlags.HasFireStarted)) {
                rootF.setEventFlags(FireBreathFlags.HasFireStarted);
                this.spawnFireBreathLarge(rootF.pos, 1.0);
                //this.func_800C9D80(flame.pos, flame.velocity, 0x51038009);

                if (rootF.userValB.value > 0) {
                    rootF.userValB.value--;
                    rootF.timer = 90;
                } else {
                    rootF.timer = 300;
                }
                rootF.userTimer = 60;
            }
        }

        // Spit fire every 90 frames (twice), then back to 300 frames
        if (!this.isPlayerInTrackSection(4, 5)) {
            rootF.userValB.value = 2;
        }
    }

    /**func_80075F98*/
    private spawnFireBreathSmall(spawnPos: vec3, yaw: number, speedMultiplier: number): void {
        for (let i = 0; i < 10; i++) {
            const object = this.getNextFreeParticle(this.gObjectParticle1);

            if (!object) {
                return;
            }

            object.init(0);
            object.setScale(0.5);
            object.objectType = EntityType.BowserStatueFireSmall;
            vec3.copy(object.originPos, spawnPos);
            object.setDirection(0x0C00, yaw, 0);
            object.userValB.value = 0x00FF;
            object.userValA.value = 0x00FF;
            object.userTimer = i * 2;
            object.speed.value = 4 * speedMultiplier;
            object.isInitialized = true;
        }
    }

    /**func_800762DC*/
    private spawnFireBreathLarge(spawnPos: vec3, speedMultiplier: number): void {
        for (let i = 0; i < 20; i++) {
            const object = this.getNextFreeParticle(this.gObjectParticle1);

            if (!object) {
                return;
            }

            object.init(0);
            object.objectType = EntityType.BowserStatueFire;
            object.setScale(1);
            vec3.copy(object.originPos, spawnPos);
            object.setDirection(0x0C00, 0x2100, 0);
            if (this.globals.isMirrorMode) {
                object.direction[1] += -0x4000;
            }
            object.userValB.value = 0x00FF;
            object.userValA.value = 0x00FF;
            object.userTimer = 2 * i;//spawn delay timer
            object.speed.value = 8.0 * speedMultiplier;

            object.isInitialized = true;
        }
    }

    /**func_8007634C*/
    private initFlameParticle(object: Entity): void {
        object.activeTexture = 0x0D05A9B0;
        object.textureListAddr = 0x0D05A9B0;
        object.primAlpha.value = 0x00FF;
        object.setOrientation(0, 0, 0);
        object.setOffset(0.0, 0.0, 0.0);
        object.advanceState();
    }

    /**func_8007675C*/
    private initFlamePillarParticle(spawnPos: vec3, delayTimer: number): void {
        const object = this.getNextFreeParticle(this.gObjectParticle1);

        if (!object) {
            return;
        }

        object.init(0);
        object.objectType = EntityType.FlamePillar;
        object.setScale(1.0);
        vec3.copy(object.originPos, spawnPos);
        object.setDirection(0x0C00, 0x2100, 0);
        object.userValB.value = 0xFF;
        object.userValA.value = 0xFF;
        object.speed.value = 8.0;
        object.velocity[1] = 8.0;
        object.userTimer = delayTimer;

        object.isInitialized = true;
    }

    /**func_80076AEC*/
    private updateFlamePillarMovement(object: Entity): void {
        const previousActionState = object.actionState;
        if (previousActionState !== 0) {
            if (previousActionState === 1) {
                if (object.runActionTimer(10)) {
                    object.advanceActionState();
                }
            } else {
                object.actionState = previousActionState;
            }
        }

        if (object.actionState > 0) {
            object.applyVelocityToOffsetY();
            object.updatePosition();
        }
    }

    /**func_800769D8*/
    private updateFlamePillarColor(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initFlameParticle(object);
                break;
            case 2:
                if (object.runTimer(object.userTimer)) {
                    object.initActionState();
                }
                break;
            case 3:
                object.chaseF(object.scale, 2.0, 0.05);
                object.chaseF(object.userValB, 0, 24);
                if ((object.actionState >= 2) && (object.stepDownToTargetLoopS(object.primAlpha, 0xFF, 80, 32, 0, 0))) {
                    object.advanceState();
                }
                break;
            case 4:
                object.resetAllStates();
                object.resetAllActionStates();
                break;
        }
    }

    /**func_80076538*/
    private updateFlameMovement(object: Entity): void {
        switch (object.actionState) {
            case 0:
                break;
            case 1:
                if (object.objectType === EntityType.BowserStatueFire) {
                    if (object.runActionTimer(14)) {
                        object.advanceActionState();
                    }
                } else if (object.runActionTimer(2)) {
                    object.advanceActionState();
                }
                break;
            case 2:
                object.stepDownToTargetV(object.direction, 0, 0, 0x400);
                break;
        }

        if (object.actionState > 0) {
            object.updateMovement();
            object.updatePosition();
        }
    }

    /**func_800763CC*/
    private updateFlameColor(object: Entity): void {
        switch (object.state) {
            case 1:
                this.initFlameParticle(object);
                break;
            case 2:
                if (object.runTimer(object.userTimer)) {
                    object.initActionState();
                }
                break;
            case 3:
                if (object.objectType === EntityType.BowserStatueFire) {
                    object.chaseF(object.scale, 4.0, 0.1);
                    object.chaseF(object.userValB, 0, 24);
                    object.chaseF(object.userValA, 128, 12);
                } else {
                    object.chaseF(object.scale, 1.0, 0.1);
                    object.chaseF(object.userValB, 0, 24);
                    object.chaseF(object.userValA, 128, 12);
                }

                if ((object.actionState >= 2) && (object.stepDownToTargetLoopS(object.primAlpha, 255, 80, 32, 0, 0))) {
                    object.advanceState();
                }
                break;
            case 4:
                object.resetAllStates();
                object.resetAllActionStates();
                break;
            default:
                break;
        }
    }
}

const snowmanTexLUT = 0x06004B20;
const snowmanHeadTex = 0x06004D20;
const snowmanBodyTex = 0x06005D20;
const snowflakeParticleMax = 500;
const snowParticleMax = 40;

enum SnowmanFlags {
    IsBroken = (1 << 1)
}

export class FrappeSnowlandRenderer extends Mk64Renderer {
    private snowmanHeadObjs: Entity[] = [];
    private snowmanBodyObjs: Entity[] = [];
    private snowflakeObjs: Entity[] = nArray(snowflakeParticleMax, () => new Entity(0));

    private snowMdl: BasicRspRenderer;
    private snowFlakeMdl: BasicRspRenderer;

    private snowmanBodyMdl: BasicRspRenderer;
    private snowmanHeadMdl: BasicRspRenderer;

    constructor(globals: Mk64Globals) {
        super(globals);

        for (const spawnData of dSnowmanSpawns) {
            const snowmanHead = new Entity(0);
            const snowmanBody = new Entity(0);

            snowmanHead.originPos[0] = spawnData.pos[0] * this.xOrientation;
            snowmanHead.originPos[1] = spawnData.pos[1] + 5.0 + 3.0;
            snowmanHead.originPos[2] = spawnData.pos[2];

            snowmanBody.originPos[0] = spawnData.pos[0] * this.xOrientation;
            snowmanBody.originPos[1] = spawnData.pos[1] + 3.0;
            snowmanBody.originPos[2] = spawnData.pos[2];
            snowmanBody.objectType = spawnData.param;

            this.snowmanBodyObjs.push(snowmanBody);
            this.snowmanHeadObjs.push(snowmanHead);
        }

        this.snowmanHeadMdl = this.initRenderer2D(snowmanTexLUT, snowmanHeadTex, 0x0D05C2B0, 0x0D007D78, 64, 64, 32);
        this.snowmanBodyMdl = this.initRenderer2D(snowmanTexLUT, snowmanBodyTex, 0x0D05C2B0, 0x0D007D78, 64, 64, 32);

        this.snowMdl = globals.initRendererFromDL(0x06007B20, true);
        this.snowFlakeMdl = globals.initRendererFromDL(0x06007BD0, true);
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < dSnowmanSpawns.length; i++) {
            const bodyObj = this.snowmanBodyObjs[i];
            const headObj = this.snowmanHeadObjs[i];

            if (bodyObj.state >= 2) {
                if (bodyObj.isFlagActive(EntityFlags.IsVisible)) {

                    if (bodyObj.isFlagActive(EntityFlags.IsRenderingActive)) {
                        calcModelMatrix(scratchMtx1, bodyObj.pos, bodyObj.orientation, bodyObj.scale.value);
                        this.snowmanBodyMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                    }

                    calcModelMatrix(scratchMtx1, headObj.pos, headObj.orientation, headObj.scale.value);
                    this.snowmanHeadMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
            }
        }

        for (const snow of this.gObjectParticle2) {
            if (snow.isInitialized) {
                if (snow.state > 0 && snow.isFlagActive(EntityFlags.IsVisible)) {
                    calcModelMatrix(scratchMtx1, snow.pos, snow.orientation, snow.scale.value);
                    this.snowMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
            }
        }

        if (this.globals.cameraPos[1] > this.globals.waterLevel) {
            for (let i = 0; i < snowflakeParticleMax; i++) {
                const snowflakeObj = this.snowflakeObjs[i];

                if (snowflakeObj.state >= 2) {
                    calcModelMatrix(scratchMtx1, snowflakeObj.pos, snowflakeObj.orientation, snowflakeObj.scale.value);
                    this.snowFlakeMdl.setPrimColor8(255, 255, 255, snowflakeObj.primAlpha.value);
                    this.snowFlakeMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
            }
        }
    }

    override updateObjects(): void {
        for (const object of this.gObjectParticle2) {
            if (!object.isInitialized || object.state === 0)
                continue;

            this.updateSnowParticle(object);

            if (object.state === 0) {
                object.deleteObject();
            }
        }

        for (let i = 0; i < this.snowmanBodyObjs.length; i++) {
            const bodyObj = this.snowmanBodyObjs[i];
            const headObj = this.snowmanHeadObjs[i];
            this.updateSnowmanHead(headObj);
            this.updateSnowmanBody(bodyObj);

            headObj.setFlags(EntityFlags.IsVisible);
            bodyObj.setFlags(EntityFlags.IsVisible);

            if (bodyObj.isFlagInactive(EntityFlags.HasBeenHit)) {

                if ((this.globals.cameraPos[1] > 0 && this.globals.cameraPos[1] < 15) && IsTargetInRangeXZ(bodyObj.pos, this.globals.cameraPos, bodyObj.boundingBoxSize)) {
                    bodyObj.setFlags(EntityFlags.HasBeenHit);
                    bodyObj.clearFlags(EntityFlags.IsRenderingActive);

                    bodyObj.setState(10);
                    headObj.setActionState(10);
                    this.spawnSnowParticles(bodyObj.pos);
                }

            }
            else if (bodyObj.isEventFlagActive(SnowmanFlags.IsBroken)) {
                bodyObj.clearEventFlags(SnowmanFlags.IsBroken);
                headObj.setActionState(20);
            }
        }

        this.updateSnowflakeParticles();
    }

    /**func_8008379C*/
    private spawnSnowParticles(rootPos: vec3): void {
        for (let i = 0; i < snowParticleMax; i++) {
            const object = this.getNextFreeParticle(this.gObjectParticle2);

            if (!object) {
                return;
            }

            this.initSnowParticle(object, rootPos, i);
        }
    }

    /**func_80078220*/
    private initSnowflake(object: Entity): void {
        object.activeTexture = 0x0D0293D8;
        object.textureListAddr = 0x0D0293D8;
        object.vertex = 0x0D005770;
        object.setScale(0.15);
        object.initActionState();
        object.advanceState();
    }

    /**func_80078288*/
    private updateSnowflakeRoutine(object: Entity): void {
        switch (object.actionState) {
            case 0:
                break;
            case 1:
                const heightOffset = random_int(200) - 100;
                const forwardOffset = random_int(200) + 0x1E;
                const yaw = this.globals.cameraYaw + Math.random() * 2 * Math.PI;

                object.originPos[0] = this.globals.cameraPos[0] + Math.sin(yaw) * forwardOffset;
                object.originPos[1] = this.globals.cameraPos[1] + heightOffset;
                object.originPos[2] = this.globals.cameraPos[2] + Math.cos(yaw) * forwardOffset;

                object.directionStep = (random_int(0x0400) + 0x100);
                object.targetPos[0] = ((random_int(0x0064) * 0.03) + 2.0);
                object.velocity[1] = (-0.3 - (random_int(0x0032) * 0.01));
                object.offset[0] = 0.0;
                object.offset[1] = 0.0;
                object.advanceActionState();

                object.primAlpha.value = this.globals.hasCameraMoved ? 50 : 0; // alpha
                object.userValA.value = this.globals.hasCameraMoved ? 50 : 20; // alpha step
                break;
            case 2:

                // Let's make snowflakes fade in to avoid popping in and give them more variety
                if (object.primAlpha.value !== 255) {
                    object.oscillateLoopResetS(object.primAlpha, object.primAlpha.value, 255, object.userValA.value, 1, 0);
                }

                object.applyVelocityToOffsetY();
                object.direction[0] += object.directionStep * DELTA_TIME;
                object.offset[0] = ((Math.sin(object.direction[0] * BinAngleToRad)) * object.targetPos[0]);

                object.updatePosition();

                if (object.pos[1] < this.globals.waterLevel || this.IsBehindCamera(object.pos) || !IsTargetInRangeXYZ(object.pos, this.globals.cameraPos, 250)) {
                    object.advanceActionState();
                }
                break;
            case 3:
                object.resetAllActionStates();
                break;
        }
    }

    /**func_800786EC*/
    private updateSnowflake(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initSnowflake(object);
                break;
            case 2:
                this.updateSnowflakeRoutine(object);
                if (object.actionState === 0) {
                    object.advanceState();
                }
                break;
            case 3:
                object.resetAllStates();
                break;
        }
    }

    /**func_80078790*/
    private updateSnowflakeParticles(): void {
        for (let i = 0; i < snowflakeParticleMax; i++) {
            if (this.snowflakeObjs[i].state === 0) {
                this.snowflakeObjs[i].init(1);
            }

            if (this.snowflakeObjs[i].state !== 0) {
                this.updateSnowflake(this.snowflakeObjs[i]);
            }
        }
    }

    /**func_80083B0C*/
    private initSnowmanBody(object: Entity): void {
        object.setTextureList(snowmanTexLUT, snowmanBodyTex, 64, 64);
        object.setScale(0.1);
        object.texIndex = 0;
        object.boundingBoxSize = 8;
        object.primAlpha.value = random_int(0x2000) - 0x1000;
        object.speed.value = 1.5;
        object.advanceState();
        object.setOffset(0.0, 0.0, 0.0);
        object.setOrientation(0, 0, 0);
        object.setFlags(EntityFlags.IsRenderingActive | EntityFlags.IsCollisionActive | EntityFlags.unk_26);
    }

    /**func_80083C04*/
    private updateSnowmanBody(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initSnowmanBody(object);
                break;
            case 2:
                object.runTimer(150);
                break;
            case 10:
                if (object.runTimer(300)) {
                    object.setEventFlags(SnowmanFlags.IsBroken);
                }
                break;
            case 11://is broken
                if (object.runTimer(10)) {
                    object.setFlags(EntityFlags.IsRenderingActive);
                    object.setScale(0.001);
                }
                break;
            case 12:
                if (object.stepUpToTargetF(object.scale, 0.001, 0.1, 0.0025, 0, 0)) {
                    object.advanceState();
                }
                break;
            case 13:
                object.setState(2);
                object.clearFlags(EntityFlags.HasBeenHit);
                break;
        }

        if (object.state >= 2) {
            object.updateActiveTexture();
        }

        object.updatePosition();
    }

    /**func_80083868*/
    private initSnowmanHead(object: Entity): void {
        object.setTextureList(snowmanTexLUT, snowmanHeadTex, 64, 64);
        object.vertex = 0x0D0061B0;
        object.setScale(0.1);
        object.texIndex = 0;
        object.primAlpha.value = random_int(0x2000) - 0x1000;
        object.speed.value = 1.5;
        object.advanceState();
        object.setOffset(0.0, 0.0, 0.0);
        object.setOrientation(0, 0, 0);
        object.initActionState();
        object.setFlags(EntityFlags.IsCollisionActive);
    }

    /**func_80083A94*/
    private updateSnowmanHead(object: Entity): void {
        switch (object.state) {
            case 1:
                this.initSnowmanHead(object);
                break;
        }

        if (object.state >= 2) {
            object.updateActiveTexture();
        }
        this.updateSnowmanHeadRoutine(object);
    }

    /**func_80083948*/
    private updateSnowmanHeadRoutine(object: Entity): void {
        switch (object.actionState) {
            case 1:
                object.advanceActionState();
                break;
            case 2:
                object.runActionTimerAdvance(20);
                break;
            case 3:
                object.setActionState(1);
                break;
            case 10:
                object.stepUpwardVelocityForDuration(10, 0.5, 10);
                break;
            case 11:
                object.stepUpwardVelocityToTarget(0.0, 0.2, -7.0);
                break;
            case 20:
                if (object.stepUpToTargetV(object.offset, 1, 0.0, 0.2)) {
                    object.setLoopStatusS(0);
                    object.setActionState(1);
                }
                break;
            default:
                break;
        }
        object.updatePosition();
        object.oscillateLoopS(object.primAlpha, -0x1000, 0x1000, 0x400, 1, -1);
        object.orientation[2] = object.primAlpha.value;
    }

    /**func_80083538*/
    private initSnowParticle(object: Entity, rootPos: vec3, index: number): void {
        object.init(0);
        object.activeTexture = 0x06006F20;
        object.textureListAddr = 0x06006F20;
        object.activeTLUT = 0x06006D20;
        object.texLutListAddr = 0x06006D20;
        object.scale.value = random_int(100);
        object.scale.value = (object.scale.value * 0.001) + 0.05;
        object.velocity[1] = random_int(0x0014);
        object.velocity[1] = (object.velocity[1] * 0.5) + 2.6;
        object.speed.value = random_int(0x000A);
        object.speed.value = (object.speed.value * 0.1) + 4.5;
        object.direction[1] = (index << 0x10) / 40;
        vec3.copy(object.originPos, rootPos);
        object.primAlpha.value = random_int(0x4000) + 0x1000;
        object.setFlags(EntityFlags.IsVisible);

        object.isInitialized = true;
    }

    /**func_8008379C*/
    private updateSnowParticle(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                if (object.applyDirectionalVelocity(object.velocity[1], 0.74, object.speed.value, object.direction[1], 100)) {
                    object.advanceState();
                }
                break;
            case 2:
                object.resetAllActionStates();
                object.resetAllStates();
                break;
        }
        object.updatePosition();
        object.orientation[2] += object.primAlpha.value;
    }
}

export class LuigiRacewayRenderer extends Mk64Renderer {
    private actor: ActorItemBox;
    private balloonObj: Entity;

    constructor(globals: Mk64Globals) {
        super(globals);

        this.actor = this.spawnActor(ActorType.HotAirBalloonItemBox) as ActorItemBox;

        const balloon = this.balloonObj = new Entity(0);
        balloon.setFlags(EntityFlags.IsVisible | EntityFlags.HasShadow | EntityFlags.HasLodDisplay);
        balloon.setScale(1);
        balloon.displayList = 0x0600F960;
        balloon.setOriginPosition(this.xOrientation * -176, 0, -2323);
        balloon.setOffset(0, 300, 0);
        balloon.setPositionOriginX();
        balloon.setSurfaceFromCollision(this.dummyObjCol);
        balloon.initActionState();
        balloon.velocity[1] = -2.0;
        balloon.advanceState();
        balloon.modelInst = globals.initRendererFromDL(0x060102B0);
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const balloon = this.balloonObj;

        if (balloon.state >= 2) {
            const yDistanceToSurface = balloon.pos[1] - balloon.surfaceHeight;
            const shadowScale = 0.5 + (20 / yDistanceToSurface);

            this.renderShadowOnSurface(balloon, renderInstManager, viewerInput, shadowScale);
            calcModelMatrix(scratchMtx1, balloon.pos, balloon.direction, balloon.scale.value);
            balloon.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }
    }

    override updateObjects(): void {
        if (this.balloonObj.state !== 0) {

            this.updateBalloon(this.balloonObj);
            this.balloonObj.updatePosition();

            if (this.balloonObj.state >= 2) {
                this.actor.pos[0] = this.balloonObj.pos[0];
                this.actor.pos[1] = this.balloonObj.pos[1] - 10.0;
                this.actor.pos[2] = this.balloonObj.pos[2];
            }
        }
    }

    /**func_80085534*/
    private updateBalloon(object: Entity): void {
        switch (object.actionState) {
            case 1:
                if (object.offset[1] <= 18.0) {
                    object.advanceActionState();
                }
                break;
            case 2:
                // M-1: The function returns a boolean... yet still doing checks after
                object.chaseV(object.velocity, 1, 0.0, 0.05);
                if (object.velocity[1] === 0.0) {
                    object.advanceActionState();
                }
                break;
            case 3:
                object.runActionTimerAdvance(1);
                break;
            case 4:
                object.chaseV(object.velocity, 1, 1.0, 0.05);
                if (object.velocity[1] === 1.0) {
                    object.advanceActionState();
                }
                break;
            case 5:
                object.runActionTimerAdvance(90);
                break;
            case 6:
                object.chaseV(object.velocity, 1, 0, 0.05);
                if (object.velocity[1] === 0.0) {
                    object.advanceActionState();
                }
                break;
            case 7:
                object.chaseV(object.velocity, 1, -1.0, 0.05);
                if (object.velocity[1] === -1.0) {
                    object.advanceActionState();
                }
                break;
            case 8:
                object.runActionTimerAdvance(90);
                break;
            case 9:
                object.chaseV(object.velocity, 1, 0.0, 0.05);
                if (object.runActionTimer(90)) {
                    object.setActionState(3);
                }
                break;
        }
        object.applyVelocityToOffsetY();
        object.direction[1] += 0x100 * DELTA_TIME;
    }
}

export class YoshiValleyRenderer extends Mk64Renderer {
    private flagAnimCtrl: SkelAnimController;
    private flagPoleObjs: Entity[] = [];

    private hedgehogObjs: Entity[] = [];
    private hedgehogShadowMdl: BasicRspRenderer;
    private hedgehogMdl: BasicRspRenderer;
    private hedgehogMdlMirrored: BasicRspRenderer;

    private flagFrameTime: number = 0;

    constructor(globals: Mk64Globals) {
        super(globals);

        const egg = this.spawnActor(ActorType.YoshiEgg, [-2300, 0, 634]);

        this.flagAnimCtrl = new SkelAnimController(globals, 0x0D0077A0, 0x060185E0, 0x06014794, 1);

        for (let i = 0; i < dFlagPoleSpawns.length; i++) {
            const flagSpawn = dFlagPoleSpawns[i];
            const object = new Entity(0);

            object.displayList = 0x06014798;
            object.vertex = 0x06014794;
            object.setScale(0.027);
            object.setFlags(EntityFlags.IsVisible);
            object.advanceState();
            object.setOriginPosition(flagSpawn.pos[0] * this.xOrientation, flagSpawn.pos[1], flagSpawn.pos[2]);
            object.setOffset(0.0, 0.0, 0.0);
            object.setDirection(0, flagSpawn.param, 0);
            object.updatePosition();

            object.userValB.value = this.flagAnimCtrl.getAnimationDuration(0);

            this.flagPoleObjs.push(object);
        }

        this.hedgehogMdl = this.initRenderer2D(0x06014908, 0x06014B08, 0x0D0060B0, 0x0D007D78, 64, 64, 32);
        this.hedgehogMdlMirrored = this.initRenderer2D(0x06014908, 0x06014B08, 0x0D006130, 0x0D007D78, 64, 64, 32);

        this.hedgehogShadowMdl = globals.initRendererFromDL(0x0D007B98);
        this.hedgehogShadowMdl.setPrimColor8(20, 20, 20, 0);

        for (let i = 0; i < dHedgehogSpawns.length; i++) {
            const hedgehog = new Entity(0);
            const spawnData = dHedgehogSpawns[i];

            hedgehog.pos[0] = hedgehog.originPos[0] = spawnData.pos[0] * this.xOrientation;
            hedgehog.pos[1] = hedgehog.surfaceHeight = spawnData.pos[1] + 6.0;
            hedgehog.pos[2] = hedgehog.originPos[2] = spawnData.pos[2];
            hedgehog.objectType = spawnData.param;
            hedgehog.splineTargetX = dHedgehogPatrolPoints[i][0] * this.xOrientation;
            hedgehog.splineTargetZ = dHedgehogPatrolPoints[i][2];
            hedgehog.modelInst = this.hedgehogMdl;

            this.hedgehogObjs.push(hedgehog);
        }
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        for (const hedgehog of this.hedgehogObjs) {
            if (hedgehog.isFlagActive(EntityFlags.IsVisible)) {

                hedgehog.setShadowMatrix(scratchMtx1, 0.7);
                this.hedgehogShadowMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

                calcModelMatrix(scratchMtx1, hedgehog.pos, hedgehog.orientation, hedgehog.scale.value);

                if (hedgehog.texIndex !== 0) {
                    this.hedgehogMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
                else {
                    this.hedgehogMdlMirrored.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
            }
        }

        for (const flagPole of this.flagPoleObjs) {
            this.flagAnimCtrl.setAnimFrame(flagPole.pos, flagPole.direction, flagPole.scale.value, this.flagFrameTime);
            this.flagAnimCtrl.renderSkeleton(renderInstManager, viewerInput);
        }
    }

    override updateObjects(): void {
        this.flagFrameTime = this.flagAnimCtrl.getNextFrameTime(this.flagFrameTime);

        for (let i = 0; i < this.hedgehogObjs.length; i++) {
            const hedgehog = this.hedgehogObjs[i];

            this.updateHedgehog(hedgehog, i);
            this.updateHedgehogMovement(hedgehog);
        }
    }

    /**func_8008311C*/
    private initHedgehog(object: Entity, index: number): void {
        object.setTextureList(0x06014908, 0x06014B08, 64, 64);
        object.activeTLUT = 0x06014908;
        object.activeTexture = 0x06014B08;
        object.setScale(0.2);
        object.texIndex = 0;
        object.setOffset(0, 0, 0);
        object.setOrientation(0, 0, 0x8000);
        object.speed.value = ((index % 6) * 0.1) + 0.5;
        object.initActionState();
        object.setFlags(EntityFlags.IsCollisionActive | EntityFlags.CanCollideWithGround | EntityFlags.unk_26);
        object.setFlags(EntityFlags.IsVisible | EntityFlags.IsInArea | EntityFlags.HasShadow | EntityFlags.IsCollisionCheckOn | EntityFlags.IsAnyPlayerNear);//hack
        object.boundingBoxSize = 2;
        object.advanceState();
    }

    /**func_800833D0*/
    private updateHedgehog(object: Entity, index: number): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initHedgehog(object, index);
                break;
            case 2:
                object.textureSwapLoop(0, 1, 8, -1);
                break;
        }
    }

    /**func_80083248*/
    private updateHedgehogMovement(object: Entity): void {
        switch (object.actionState) {
            case 0:
                break;
            case 1:
                if (object.moveForwardToTarget(object.originPos[0], object.splineTargetX, object.originPos[2], object.splineTargetZ)) {
                    object.advanceActionState();
                }
                break;
            case 2:
                object.runActionTimerAdvance(60);
                break;
            case 3:
                if (object.moveForwardToTarget(object.splineTargetX, object.originPos[0], object.splineTargetZ, object.originPos[2])) {
                    object.advanceActionState();
                }
                break;
            case 4:
                if (object.runActionTimer(60)) {
                    object.setActionState(1);
                }
                break;
        }

        object.updatePosition();

        if (object.isFlagActive(EntityFlags.IsAnyPlayerNear)) {
            if (object.isFlagActive(EntityFlags.IsCollisionCheckOn)) {
                object.checkSurfaceContactAlt(this.dummyObjCol);
            }
            object.pos[1] = object.surfaceHeight + 6.0;
        }
    }
}

export class KoopaBeachRenderer extends Mk64Renderer {
    private waterMainMdl: BasicRspRenderer;
    private waterfallMdl: BasicRspRenderer;
    private waterSplashMdl: BasicRspRenderer;

    private waterfallUlt = 0;
    private waterpoolUlt = 0;
    private splashUls = 0;
    private splashUlt = 0;

    private seagullAnimCtrl: SkelAnimController;
    private crabObjs: Entity[] = [];
    private seagullObjs: Entity[] = [];

    constructor(globals: Mk64Globals) {
        super(globals);

        const itemBoxOnShell = this.spawnActor(ActorType.HotAirBalloonItemBox, [328, 70, 2541]);

        this.waterfallMdl = globals.initRendererFromDL(0x06019A1C, false, Mk64RenderLayer.Water);
        this.waterMainMdl = globals.initRendererFromDL(0x06019888, false, Mk64RenderLayer.Water);
        this.waterSplashMdl = globals.initRendererFromDL(0x06019A44, false, Mk64RenderLayer.Water);//Unused

        this.seagullAnimCtrl = new SkelAnimController(globals, 0x0D0077D0, 0x06019910, 0x06016B60, 1);

        const crabMdl = this.initRenderer2D(0x0600D628, 0x0600D828, 0x0D05C2B0, 0x0D007D78, 64, 64, 32);

        for (let i = 0; i < dCrabSpawns.length; i++) {
            const obj = new Entity(0);
            obj.pos[0] = obj.originPos[0] = (dCrabSpawns[i].startX * this.xOrientation);
            obj.pos[2] = obj.originPos[2] = dCrabSpawns[i].startZ;

            obj.targetPos[0] = dCrabSpawns[i].endX * this.xOrientation;
            obj.targetPos[2] = dCrabSpawns[i].endZ;

            obj.modelInst = crabMdl;

            this.crabObjs.push(obj);
        }

        for (let i = 0; i < 10; i++) {
            const object = new Entity(0);

            const randX = random_int(0x00C8) + -100.0;
            const randY = random_int(0x0014);
            const randZ = random_int(0x00C8) + -100.0;

            object.currentAnimIndex = 1;
            object.actionBehaviorType = 1;
            object.speed.value = 1.0;
            object.splinePath = seagullPathList[i % seagullPathList.length];

            if (!(i < (10 / 2))) {
                object.setOriginPosition((randX + 328.0) * this.xOrientation, randY + 20.0, randZ + 2541.0);
            } else {
                object.setOriginPosition((randX + -985.0) * this.xOrientation, randY + 15.0, randZ + 1200.0);
            }

            object.setScale(0.2);
            object.setDirection(0, 0, 0);
            object.initActionState();
            object.setFlags(EntityFlags.CalcSplineVelocity | EntityFlags.IsVisible);
            object.advanceState();

            //(M-1): Start animation at a random frame. The game doesn't do this, but it is virtually randomized
            // because they only start updating when within range.
            object.frameTime = random_int(this.seagullAnimCtrl.getAnimationDuration(0));

            this.seagullObjs.push(object);
        }
    }

    override renderCourseAnimatedMdls(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.waterfallMdl.drawCallInstances[0].setTileSize(0, this.waterfallUlt);//falling water
        this.waterfallMdl.drawCallInstances[1].setTileSize(0, this.waterpoolUlt);//pool of water
        this.waterSplashMdl.setTileSize(this.splashUls, this.splashUlt);// unused splashing

        this.waterfallMdl.prepareToRender(renderInstManager, viewerInput);

        if (this.enableUnusedGfx) {
            this.waterSplashMdl.prepareToRender(renderInstManager, viewerInput);
        }

        vec3.set(scratchVec3a, 0, this.globals.waterLevel, 0);
        calcModelMatrix(scratchMtx1, scratchVec3a);
        this.waterMainMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }

    override updateCourseAnims(deltaTime: number): void {
        const globals = this.globals;
        if ((globals.waterVelocity < 0 && globals.waterLevel <= -20) ||
            (globals.waterVelocity > 0 && globals.waterLevel >= 0)) {
            globals.waterVelocity *= -1;
        }

        globals.waterLevel += globals.waterVelocity * deltaTime;
        globals.waterLevel = clamp(globals.waterLevel, -20, 0.01);

        this.waterfallUlt = mod(this.waterfallUlt + (9 * deltaTime), 256);
        this.waterpoolUlt = mod(this.waterpoolUlt + (3 * deltaTime), 256);

        this.splashUlt = random_int(300) / 40;

        if (this.splashUls < 0) {
            this.splashUls = random_int(300) / 40;
        } else {
            this.splashUls = -(random_int(300) / 40);
        }
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        let numCrabs = this.enableUnusedGfx ? this.crabObjs.length : 10;

        for (let i = 0; i < numCrabs; i++) {
            const crab = this.crabObjs[i];

            if (crab.state >= 2) {
                this.renderShadowOnSurface(crab, renderInstManager, viewerInput, 0.5);
                crab.updateTextures2D(this.globals, 64, 64, 32);

                calcModelMatrix(scratchMtx1, crab.pos, crab.orientation, crab.scale.value);
                crab.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }

        for (const bird of this.seagullObjs) {
            if (bird.isFlagActive(EntityFlags.IsVisible) && bird.state >= 2) {
                this.seagullAnimCtrl.setAnimFrame(bird.pos, bird.direction, bird.scale.value, bird.frameTime);
                this.seagullAnimCtrl.renderSkeleton(renderInstManager, viewerInput);
            }
        }
    }

    override updateObjects(): void {
        for (let i = 0; i < this.crabObjs.length; i++) {
            const crab = this.crabObjs[i];
            if (crab.state !== 0) {
                this.updateCrab(crab);
                this.updateCrabMovement(crab);
                //crab.updateVisibilityFlags(this.cameraPos, 500);
            }
        }

        for (let i = 0; i < this.seagullObjs.length; i++) {
            const seagull = this.seagullObjs[i];

            seagull.frameTime = this.seagullAnimCtrl.getNextFrameTime(seagull.frameTime);

            this.updateSeagull(seagull);
        }
    }

    /**func_8008275C*/
    private updateSeagull(object: Entity): void {
        switch (object.actionBehaviorType) {
            case 1:
                this.tryMoveObjectAlongPath(object);
                object.updatePosition();
                break;
            case 2:
                // Unused behavior
                this.tryMoveObjectAlongPath(object);
                vec3.copy(object.targetPos, object.pos);
                this.moveAlongPathReverse(object.originPos, object.targetDirection, object.speed.value, 0.0);

                object.offset[0] *= 2.0;
                object.offset[1] *= 2.5;
                object.offset[2] *= 2.0;

                object.updatePosition();
                object.direction[1] = calcTargetAngleY(object.targetPos, object.pos);
                break;
        }
        object.updateFacingDirection();
    }

    private initCrab(object: Entity): void {
        object.setTextureList(0x0600D628, 0x0600D828, 64, 64);
        object.setScale(0.15);
        object.setOffset(0.0, 0.0, 0.0);
        object.setOrientation(0, 0, 0);

        object.boundingBoxSize = 1;
        object.speed.value = 1.5;
        object.texIndex = 0;

        object.setFlags(EntityFlags.HasShadow | EntityFlags.CanCollideWithGround | EntityFlags.unk_26);
        object.setFlags(EntityFlags.IsCollisionActive);

        object.advanceState();
        object.setBehaviorAndState(0, 1);
    }

    /**func_80082B34*/
    private updateCrab(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initCrab(object);
                break;
            case 2:
                object.textureLoopForward(0, 3, 1, 2, -1);
                break;
            case 3:
                object.textureLoopForward(4, 6, 1, 2, -1);
                break;
        }

        if (object.state >= 2) {
            object.updateActiveTexture();
        }
    }

    /**func_80082C30*/
    private updateCrabMovement(object: Entity): void {
        switch (object.actionState) {
            case 1:
                if (object.moveForwardToTarget(object.originPos[0], object.targetPos[0], object.originPos[2], object.targetPos[2])) {
                    object.setState(3);
                    object.advanceActionState();
                }
                break;
            case 2:
                if (object.runRandomTimer(60)) {
                    object.speed.value = 0.8;
                    object.setState(2);
                    object.advanceActionState();
                }
                break;
            case 3:
                if (object.moveForwardForDuration(60, true)) {
                    object.advanceActionState();
                    object.setState(3);
                }
                break;
            case 4:
                if (object.runRandomTimer(60)) {
                    object.setState(2);
                    object.advanceActionState();
                }
                break;
            case 5:
                if (object.moveForwardForDuration(60)) {
                    object.setState(3);
                    object.setActionState(2);
                }
                break;
        }

        object.updatePosition();

        //if (object.isFlagActive(ObjectFlags.IsVisible)) {
        object.checkSurfaceContact(this.dummyObjCol);
        object.pos[1] = (object.surfaceHeight + 2.5);
        //}
    }
}

const coffinMaxBats = 40;
const fireplaceMaxBats = 30;

enum BatType {
    Coffin = 1,
    Fireplace = 2
}

enum CoffinEventFlags {
    IsBatsSpawning = (1 << 0)
}

export class BansheeBoardwalkRenderer extends Mk64Renderer {
    private batObj: Entity;
    private coffinObj: Entity;
    private fireplaceObj: Entity;
    private cheepCheepObj: Entity;

    private booObjs: Entity[] = nArray(10, () => new Entity(0, false));
    private booMdlA: BasicRspRenderer;
    private booMdlB: BasicRspRenderer;
    private booShadowMdl: BasicRspRenderer;

    private coffinBatTimer = 0;// D_8018CFC8
    private coffinIsBatsSpawned: boolean = false;//D_8018CFB0
    private coffinNumBatsSpawned = 0;

    private fireplaceBatTimer = 0;// D_8018D000
    private fireplaceIsBatsSpawned: boolean = false;//D_8018CFE8
    private fireplaceNumBatsSpawned = 0;//D_8018D010
    private IsBooGroupASpawned: boolean = false;//D_8018CFF0
    private IsBooGroupBSpawned: boolean = false;//D_8018D048

    constructor(globals: Mk64Globals) {
        super(globals);

        const bat = this.batObj = new Entity(0);
        this.coffinObj = new Entity(0);
        this.fireplaceObj = new Entity(0);
        this.cheepCheepObj = new Entity(0, false);

        // Boo is at 0x03009000 + (0x0780 * i)

        this.coffinObj.modelInst = globals.initRendererFromDL(0x0600B840);

        bat.setTextureList(0x06007BB8, 0x06007DB8, 32, 64);
        bat.setOrientation(0, 0, 0x8000);
        bat.updateActiveTexture();
        bat.modelInst = globals.initRendererFromDL(0x0600B7D8, true);

        this.booMdlA = this.initRenderer2D(0x06005C80, 0x03009000, 0x0D005D70, 0x0600B858, 40, 48, 40);//D_800E44B0
        this.booMdlB = this.initRenderer2D(0x06005C80, 0x03009000, 0x0D005D30, 0x0600B858, 40, 48, 40);//D_800E4470
        this.booShadowMdl = globals.initRendererFromDL(0x0D007B98);
        this.booShadowMdl.setPrimColor8(20, 20, 20, 0);

        this.cheepCheepObj.modelInst = globals.initRendererFromDL(0x0600B768);
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const coffin = this.coffinObj;

        if (coffin.state >= 2) {
            calcModelMatrix(scratchMtx1, coffin.pos, coffin.orientation, coffin.scale.value);
            coffin.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }

        const batObj = this.batObj;
        batObj.updateTextures(this.globals, batObj.activeTexture, batObj.activeTLUT);

        const renderBats = (particles: Entity[], count: number): void => {
            for (let i = 0; i < count; i++) {
                const object = particles[i];

                if (object.state >= 2 && object.isInitialized) {

                    calcModelMatrix(scratchMtx1, object.pos, batObj.orientation, object.scale.value);
                    batObj.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
            }
        };

        if (this.coffinIsBatsSpawned || this.coffinBatTimer !== 0) {
            renderBats(this.gObjectParticle2, coffinMaxBats);
        }

        if (this.fireplaceIsBatsSpawned || this.fireplaceBatTimer !== 0) {
            renderBats(this.gObjectParticle3, fireplaceMaxBats);
        }

        // Render shadows first. The game doesn't do this, but this looks better
        for (const boo of this.booObjs) {
            if (boo.state >= 2) {
                if (boo.isFlagActive(EntityFlags.HasShadow) && this.dummyObjCol.isSurfaceUnderneath(boo.pos)) {
                    scratchVec3a[0] = boo.pos[0];
                    scratchVec3a[1] = 0.8 + this.dummyObjCol.calculateSurfaceHeight(boo.pos[0], 0, boo.pos[2], this.dummyObjCol.nearestTriIdxY);
                    scratchVec3a[2] = boo.pos[2];

                    calcModelMatrix(scratchMtx1, scratchVec3a, this.dummyObjCol.normalY, 0.4);
                    this.booShadowMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
            }
        }

        for (const boo of this.booObjs) {
            if (boo.state >= 2) {

                calcModelMatrix(scratchMtx1, boo.pos, boo.orientation, boo.scale.value);

                boo.updateTextures2D(this.globals, 40, 48, 40);
                boo.modelInst.setPrimColor8(0xFF, 0xFF, 0xFF, boo.primAlpha.value);
                boo.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }

        const cheepCheep = this.cheepCheepObj;
        if (cheepCheep.isFlagActive(EntityFlags.IsRenderingActive) && cheepCheep.state >= 2) {
            calcModelMatrix(scratchMtx1, cheepCheep.pos, cheepCheep.direction, cheepCheep.scale.value);
            cheepCheep.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }
    }

    override updateObjects(): void {
        this.updateCoffin(this.coffinObj);
        this.updateSpawnTimers(this.coffinObj, 1150);

        this.updateFireplace(this.fireplaceObj);
        this.updateSpawnTimers(this.fireplaceObj, 700);

        this.updateBatParticles(this.batObj);
        this.updateCheepCheep(this.cheepCheepObj);
        this.updateBooGroups();
    }

    private updateBooGroups(): void {

        this.checkBooSection();

        for (let i = 0; i < this.booObjs.length; i++) {

            const boo = this.booObjs[i];

            if (boo.state !== 0) {
                this.updateBoo(boo);
                this.tryMoveObjectAlongPath(boo);

                const camForwardX = this.globals.cameraFwd[0];
                const camForwardZ = this.globals.cameraFwd[2];
                const forwardOffsetX = camForwardX * 60;
                const forwardOffsetZ = camForwardZ * 60;

                const cosY = Math.cos(Math.PI - this.globals.cameraYaw);
                const sinY = Math.sin(Math.PI - this.globals.cameraYaw);

                const x = boo.originPos[0] + boo.offset[0];
                const y = boo.originPos[1] + boo.offset[1];
                const z = boo.originPos[2] + boo.offset[2];

                boo.pos[0] = this.globals.cameraPos[0] + ((cosY * x) - (sinY * z)) + forwardOffsetX;
                boo.pos[1] = -10.4 + this.globals.cameraPos[1] + y;
                boo.pos[2] = this.globals.cameraPos[2] + ((sinY * x) + (cosY * z)) + forwardOffsetZ;

                this.updateBooYaw(boo);

                if (boo.isFlagActive(EntityFlags.FlipX)) {
                    boo.modelInst = this.booMdlB;
                } else {
                    boo.modelInst = this.booMdlA;
                }
            }
        }
    }

    /**func_8007C7B4*/
    private spawnBooGroup(groupStartIdx: number, playerId: number): void {
        for (let i = 0; i < 5; i++) {
            const boo = this.booObjs[groupStartIdx + i];
            boo.init(1);

            boo.nearestPlayerId = playerId;
            boo.splinePath = dBooPaths[i];
            boo.originPos[0] = random_int(0x003C) - 0x1E;
            boo.originPos[1] = random_int(0x0014) - 0xA;
            boo.originPos[2] = random_int(0x0050) - 0x28;
        }

        if (groupStartIdx === 0) {
            this.IsBooGroupASpawned = true;
        } else {
            this.IsBooGroupBSpawned = true;
        }
    }

    /**func_8007C91C*/
    private despawnBooGroup(groupStartIdx: number): void {
        for (let i = 0; i < 5; i++) {
            const boo = this.booObjs[groupStartIdx + i];
            boo.completedLoopsS++;
        }

        if (groupStartIdx === 0) {
            this.IsBooGroupASpawned = false;
        } else {
            this.IsBooGroupBSpawned = false;
        }
    }

    /**func_8007CA70*/
    private checkBooSection(): void {
        const pathPoint = this.globals.nearestPathPointIdx;

        if (!this.IsBooGroupASpawned) {
            if ((pathPoint >= 0xC9) && (pathPoint < 0xD2)) {
                this.spawnBooGroup(0, 0);
            }
        }

        if (this.IsBooGroupASpawned) {
            if ((pathPoint >= 0xB5) && (pathPoint < 0xBE)) {
                this.despawnBooGroup(0);
            }

            if ((pathPoint >= 0x119) && (pathPoint < 0x122)) {
                this.despawnBooGroup(0);
            }
        }

        if (!this.IsBooGroupBSpawned) {
            if ((pathPoint >= 0x1FF) && (pathPoint < 0x208)) {
                this.spawnBooGroup(5, 0);
            }
        }

        if (this.IsBooGroupBSpawned) {
            if ((pathPoint >= 0x1EB) && (pathPoint < 0x1F4)) {
                this.despawnBooGroup(5);
            }
            if ((pathPoint >= 0x26D) && (pathPoint < 0x276)) {
                this.despawnBooGroup(5);
            }
        }
    }

    /**func_8007C5B4*/
    private initBoo(object: Entity): void {

        object.setTextureList(0x06005C80, 0x03009000, 48, 40);
        vec3.zero(object.pos);
        object.setFlags(EntityFlags.HasShadow);
        object.advanceState();
        object.primAlpha.value = 0;
        object.initLoopCounterS();
        object.scale.value = 0.15;
        object.speed.value = 1.0;
        object.initLoopCounterF();
        object.initActionStateAlt();
        object.setFlags(EntityFlags.CalcSplineVelocity);
        object.setOrientation(0, 0, 0x8000);
    }

    /**func_8007C684*/
    private updateBoo(object: Entity): void {
        if (object.state === 1) {
            this.initBoo(object);
        }

        if (object.state >= 2) {
            switch (object.completedLoopsS) {
                case 1:// Fade in when spawing
                    object.stepUpToTargetLoopS(object.primAlpha, 0, 80, 2, 1, 0);
                    break;
                case 2:// Idle. (-1 Means to loop forever)
                    object.oscillateLoopResetS(object.primAlpha, 80, 120, 1, 0, -1);
                    break;
                case 3:// Fade out when despawning
                    object.stepDownToTargetS(object.primAlpha, 0, 2);
                    break;
                case 4:
                    object.resetAllStates();
                    object.resetAllActionStates();
                    object.resetLoopCounterS();
                    break;
            }

            object.updateActiveTexture();
        }
    }

    /**func_8007C4A4*/
    private updateBooImpostorTex(object: Entity): void {

        // There's actually 28 textures. The others are an unused "shy" animation
        const degressMax = 360 / 10;
        const texIndex = Math.floor(object.direction[1] * degressMax / 0x10000) & 0xFFFF;

        // This is clever! Flip model(UVs) so you only need half the texture
        if (texIndex <= (degressMax / 2)) {
            object.clearFlags(EntityFlags.FlipX);
            object.texIndex = texIndex;
        } else {
            object.setFlags(EntityFlags.FlipX);
            object.texIndex = degressMax - texIndex;
        }
    }

    /**func_8007C550*/
    private updateBooYaw(object: Entity): void {
        const yaw = Math.atan2(object.velocity[0], object.velocity[2]) * RadToBinAngle;

        object.direction[1] = stepTowardsAngle(object.direction[1], yaw) & 0xFFFF;
        this.updateBooImpostorTex(object);
    }

    /**func_8007E358*/
    private initFireplace(object: Entity): void {
        vec3.set(object.pos, -1371.0 * this.xOrientation, 31, -217);
        vec3.set(object.velocity, 0, 0, 0);
        object.userValB.value = 0;
        object.timer = 0;
        object.historyStack[7] = 0;
    }

    /**func_8007E3EC*/
    private updateFireplace(object: Entity): void {

        switch (object.state) {
            case 1:
                this.initFireplace(object);
                break;
            case 3:
                this.fireplaceIsBatsSpawned = true;
                object.advanceState();
                break;
            case 4:
                object.runTimer(210);
                this.trySpawnBat(BatType.Fireplace);
                this.trySpawnBat(BatType.Fireplace);
                break;
            case 5:
                this.fireplaceIsBatsSpawned = false;
                object.advanceState();
                break;
            case 0:
            case 2:
            default:
                break;
        }
    }

    private updateBatParticles(objectBat: Entity): void {
        if (this.coffinBatTimer > 0) {
            this.coffinBatTimer -= DELTA_TIME;
        }

        if (this.fireplaceBatTimer > 0) {
            this.fireplaceBatTimer -= DELTA_TIME;
        }

        objectBat.textureLoopForward(0, 3, 1, 1, -1);
        objectBat.updateActiveTexture();

        objectBat.oscillateLoopResetS(objectBat.primAlpha, -4096, 4096, 1024, 0, -1);
        objectBat.orientation[2] = objectBat.primAlpha.value + 0x8000;

        if (this.coffinIsBatsSpawned || (this.coffinBatTimer !== 0)) {

            this.coffinNumBatsSpawned = 0;

            for (let i = 0; i < coffinMaxBats; i++) {
                const object = this.gObjectParticle2[i];

                if (object.state === 0) {
                    continue;
                }

                this.updateBatBoundsCheck(object, BatType.Coffin);
                this.updateBatByType(object, BatType.Coffin);
                //func_8007D794(object);

                if (object.state === 0) {
                    object.deleteObject();
                }

                this.coffinNumBatsSpawned += 1;
            }

            if (this.coffinNumBatsSpawned !== 0) {
                this.coffinBatTimer = 300;
            }
        }

        if ((this.fireplaceIsBatsSpawned) || (this.fireplaceBatTimer !== 0)) {
            this.fireplaceNumBatsSpawned = 0;
            for (let i = 0; i < fireplaceMaxBats; i++) {
                const object = this.gObjectParticle3[i];

                if (object.state === 0) {
                    continue;
                }

                this.updateBatBoundsCheck(object, BatType.Fireplace);
                this.updateBatByType(object, BatType.Fireplace);
                //func_8007D794(temp_s0);
                if (object.state === 0) {
                    object.deleteObject();
                }
                this.fireplaceNumBatsSpawned += 1;
            }

            if (this.fireplaceNumBatsSpawned !== 0) {
                this.fireplaceBatTimer = 300;
            }
        }
    }

    /**func_8007DAF8*/
    private updateBatByType(object: Entity, batType: BatType): void {
        switch (batType) {
            case BatType.Coffin:
                this.updateBatCoffin(object);
                return;
            case BatType.Fireplace:
                this.updateBatFireplace(object);
                return;
        }
    }

    /**func_8007DA74*/
    private updateBatCoffin(object: Entity): void {
        if ((object.actionState !== 0) && (object.actionState === 1)) {
            // How long to move to target pitch (Initialized to point downward)
            if (object.runActionTimer(30)) {
                object.targetDirection.value = 0;
            }
        }

        object.direction[0] = stepTowardsAngle(object.direction[0], object.targetDirection.value);
        object.updateMovement();
        object.updatePosition();
    }

    /**func_8007DA4C*/
    private updateBatFireplace(object: Entity): void {
        object.updateForwardMovement();
        object.updatePosition();
    }

    /**func_8007D8D4*/
    private updateBatBoundsCheck(object: Entity, batType: BatType): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                object.advanceState();
                object.initActionState();
                break;
            case 2:
                // if (this.IsBehindCamera(object.pos)) {
                //     object.resetAllStates();
                // }

                if (batType === BatType.Coffin) {
                    if (this.globals.isMirrorMode) {
                        if (object.pos[0] >= 2540.0) {
                            object.resetAllStates();
                        }
                    } else if (object.pos[0] <= -2540.0) {
                        object.resetAllStates();
                    }
                }
                else if (this.globals.isMirrorMode) {
                    if (object.pos[0] >= 2150.0) {
                        object.resetAllStates();
                    }
                } else {
                    if (object.pos[0] <= -2150.0) {
                        object.resetAllStates();
                    }
                }
                break;
        }
    }

    /**func_8007D6A8*/
    private initBat(object: Entity, batType: BatType): void {
        object.objectType = EntityType.Bat;

        if (batType === BatType.Coffin) {
            object.originPos[0] = ((-1775.0 - random_int(0x001E)) * this.xOrientation);
            object.originPos[1] = (random_int(0x0019) + 25.0);
            object.originPos[2] = (random_int(0x001E) + 130.0);

            object.targetPos[0] = (-2500 * this.xOrientation);
            object.targetPos[1] = 0.0;
            object.targetPos[2] = (220.0 - random_int(0x0096));

            object.direction[0] = 0xDC00;
            object.targetDirection.value = 0x0800;
        }

        if (batType === BatType.Fireplace) {
            object.originPos[0] = (-0x55B - random_int(0x001E)) * this.xOrientation;
            object.originPos[1] = (random_int(0x0019) + 0xF);
            object.originPos[2] = (random_int(0x001E) - 0xE8);

            object.targetPos[0] = (-2100.0 * this.xOrientation);
            object.targetPos[1] = 0.0;
            object.targetPos[2] = (random_int(0x00C8) + -290.0);

            object.direction[0] = 0;
            object.targetDirection.value = 0;
        }

        object.direction[1] = calcTargetAngleY(object.originPos, object.targetPos);
        object.direction[2] = 0;

        object.setOffset(0.0, 0.0, 0.0);
        object.actionTimer = 0;
        object.speed.value = (random_int(4) + 4.0);
        object.setScale(0.1);
        object.setFlags(EntityFlags.IsCollisionActive);
        object.boundingBoxSize = 3;
        object.isInitialized = true;
    }

    /**func_8007D714*/
    private trySpawnBat(batType: BatType): void {
        let object: Entity | null;

        if (batType === BatType.Coffin) {
            object = this.getNextFreeParticle(this.gObjectParticle2);
        } else {
            object = this.getNextFreeParticle(this.gObjectParticle3);
        }

        if (!object) {
            return;
        }

        if (object) {
            object.init(0);
            this.initBat(object, batType);
        }
    }

    private initCoffin(object: Entity): void {
        object.setScale(1.0);
        object.displayList = 0x0600A9B0;
        object.timer = 0;
        object.historyStack[7] = 0;
        object.setOrientation(0, 0, 0);
        if (this.globals.isMirrorMode) {
            object.pos[0] = 1765;
            object.pos[2] = 195;
            object.orientation[1] = 0x8000;
        } else {
            object.pos[0] = -1765;
            object.pos[2] = 70;
        }
        object.pos[1] = 45;
        object.setVelocity(0.0, 0.0, 0.0);
        object.userValB.value = 0;
        object.advanceState();
    }

    /**func_8007E00C*/
    private updateCoffin(object: Entity): void {
        switch (object.state) {
            case 0:
            case 2:
                break;
            case 1:
                this.initCoffin(object);
                break;
            case 3:
                this.coffinIsBatsSpawned = true;
                object.advanceState();
                break;
            case 4:
                object.runTimer(210);

                if ((SCENE_TIME & 7) === 0) {
                    this.trySpawnBat(BatType.Coffin);
                    this.trySpawnBat(BatType.Coffin);
                    this.trySpawnBat(BatType.Coffin);
                    this.trySpawnBat(BatType.Coffin);
                }

                object.oscillateLoopResetS(object.primAlpha, -0x2000, 0, 0x0400, 0, -1);
                object.orientation[2] = object.primAlpha.value;
                if (object.historyStack[7] <= 0) {
                    object.historyStack[7] = 20;
                } else {
                    object.historyStack[7] -= DELTA_TIME;
                }
                break;
            case 5:
                object.orientation[2] = stepTowardsAngle(object.orientation[2], 0);
                if (object.orientation[2] === 0) {
                    object.advanceState();
                }
                break;
            case 6:
                object.orientation[2] = 0;
                object.historyStack[7] = 0;
                object.advanceState();
                this.coffinIsBatsSpawned = false;
                break;
            default:
                break;
        }
    }

    /**func_8007DDC0*/
    private updateSpawnTimers(object: Entity, distance: number): void {

        if (object.timer > 0) {
            object.timer -= DELTA_TIME;

            if (object.timer <= 0) {
                object.clearEventFlags(CoffinEventFlags.IsBatsSpawning);
            }
        }

        if (object.userTimer > 0) {
            object.userTimer -= DELTA_TIME;
        }

        if (object.timer <= 0) {

            object.updateVisibilityFlags(this.globals.cameraPos, distance);

            if ((object.isFlagActive(EntityFlags.IsVisible)) && (object.isEventFlagInactive(CoffinEventFlags.IsBatsSpawning))) {

                object.setEventFlags(CoffinEventFlags.IsBatsSpawning);
                object.setState(3);

                if (object.userValB.value > 0) {
                    object.userValB.value--;
                    object.timer = 360;
                } else {
                    object.timer = 360;
                }

                object.userTimer = 300;
            }
        }
    }

    private updateCheepCheep(object: Entity): void {
        this.trySpawnCheepCheep(object);
        this.updateCheepCheepRoutine(object);
        object.updatePosition();
    }

    /**func_8007BD04*/
    private trySpawnCheepCheep(object: Entity): void {
        if (object.state === 0 && this.globals.nearestPathPointIdx >= 0xA0 && this.globals.nearestPathPointIdx < 0xAB) {
            object.setOriginPosition(-1650.0 * this.xOrientation, -200.0, -1650.0);
            object.init(1);
        }
    }

    /**func_8007BBBC*/
    private updateCheepCheepRoutine(object: Entity): void {
        switch (object.state) {
            case 1:
                object.setModel(0x06007B78, 2.0);
                object.setFlags(EntityFlags.IsRenderingActive);
                object.objectType = 0;
                break;
            case 2:
                if (this.globals.isMirrorMode) {
                    object.applyDirectionalVelocity(18.0, 0.7, 25.0, -0x5800, 300);
                } else {
                    object.applyDirectionalVelocity(18.0, 0.7, 25.0, 0x5800, 300);
                }

                const velocityZ = Math.abs(object.velocity[2]);
                object.direction[0] = calcPitch(object.velocity[1], velocityZ);
                object.runTimer(70);
                break;
            case 3:
                object.resetAllStates();
                break;
            case 0:
                break;
        }
    }
}

class PaddleBoat {
    public position: vec3 = vec3.create();
    public boatRot: vec3 = vec3.create();
    public velocity: vec3 = vec3.create();
    public pathPointIndex: NumberHolder = { value: 0 };
    public speed: number = 0;
    public rotY: number = 0;
    public wheelRot: number = 0;
}

export class DkJungleRenderer extends Mk64Renderer {
    public torchObjHandler: Entity = new Entity(0);
    public torchParticles: Entity[] = [];
    public ferryPath: Mk64Point[] = [];

    public ferrySmokeTimer: number = 0;
    public boatSmokeMdl: BasicRspRenderer;

    public paddleBoats: PaddleBoat[] = [];
    public paddleBoatMdl: BasicRspRenderer;
    public paddleWheelMdl: BasicRspRenderer;

    private water: BasicRspRenderer;
    private ramp: BasicRspRenderer;
    private waterUlt = 0;
    private rampUlt = 0;

    constructor(globals: Mk64Globals) {
        super(globals);

        this.water = globals.initRendererFromDL(0x06014878);
        this.ramp = globals.initRendererFromDL(0x060147A0);

        this.paddleBoatMdl = globals.initRendererFromDL(0x060148A0);
        this.paddleWheelMdl = globals.initRendererFromDL(0x060148C0);

        this.ferryPath = readPathData(this.globals.segmentBuffers, 0x06007520);
        this.generate2DPath(this.ferryPath);

        for (let i = 0; i < 2; i++) {
            const boat = new PaddleBoat();

            const pathIndex = (0xB4 * i);

            boat.position[0] = this.vehiclePath2D[pathIndex][0];
            boat.position[1] = -40;
            boat.position[2] = this.vehiclePath2D[pathIndex][1];
            boat.pathPointIndex.value = pathIndex;

            vec3.set(boat.velocity, 0, 0, 0);
            boat.speed = (5 / 3);

            boat.rotY = this.moveAlongPath2D(boat.position, boat.pathPointIndex, boat.speed);

            boat.velocity[0] = boat.position[0] - boat.position[0];
            boat.velocity[2] = boat.position[2] - boat.position[2];
            vec3.set(boat.boatRot, 0, boat.rotY, 0);

            this.paddleBoats.push(boat);
        }

        for (let i = 0; i < dDkJungleTorchSpawns.length; i++) {
            const torchSpawnPos = dDkJungleTorchSpawns[i];
            const object = new Entity(3);

            object.objectType = EntityType.DkJungleTorch;
            object.setScale(0.8);

            vec3.copy(object.originPos, torchSpawnPos);
            object.originPos[0] *= this.xOrientation;

            object.speed.value = 0;
            object.userValB.value = 0xFF;
            object.userValA.value = 0xFF;
            object.primAlpha.value = 0xFF;
            object.setOrientation(0, 0, 0);
            object.setOffset(0, 0, 0);
            //object.actionState = 1;

            object.setOrientation(0, 0, 0x8000);

            this.torchParticles.push(object);
        }

        this.torchObjHandler.setTextureList(0, 0x0D02BC58, 32, 32);
        this.torchObjHandler.modelInst = globals.initRendererFromDL(0x060147C8, true);
        this.torchObjHandler.updateActiveTexture();

        this.boatSmokeMdl = globals.initRendererFromDL(0x06014820, true, Mk64RenderLayer.Smoke);
    }

    override renderCourseAnimatedMdls(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.water.setTileSize(0, this.waterUlt);
        this.ramp.setTileSize(0, this.rampUlt);

        this.water.prepareToRender(renderInstManager, viewerInput);
        this.ramp.prepareToRender(renderInstManager, viewerInput);
    }

    override updateCourseAnims(deltaTime: number): void {
        this.waterUlt = mod(this.waterUlt + (2 * deltaTime), 256);
        this.rampUlt = mod(this.rampUlt - (20 * deltaTime), 256);
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        const renderSmokeParticles = (object: Entity) => {
            if (object.state >= 2 && object.objectType === EntityType.FerrySmoke) {

                const primColor = object.userValB.value;
                const envColor = object.userValA.value;

                this.boatSmokeMdl.setPrimColor8(primColor, primColor, primColor, object.primAlpha.value);
                this.boatSmokeMdl.setEnvColor8(envColor, envColor, envColor, 0xFF);

                calcModelMatrix(scratchMtx1, object.pos, [0, 0, 0x8000], object.scale.value);
                this.boatSmokeMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }

        for (const torchPtcl of this.torchParticles) {
            const torchObj = this.torchObjHandler;
            const torchMdl = torchObj.modelInst;

            if (torchPtcl.state >= 2) {
                this.torchObjHandler.updateTextures(this.globals, torchObj.activeTexture, torchObj.activeTLUT);

                calcModelMatrix(scratchMtx1, torchPtcl.pos, torchPtcl.orientation, torchPtcl.scale.value);

                torchMdl.setPrimColor8(0xFF, 0xFF, 0x1E, torchPtcl.primAlpha.value);
                torchMdl.setEnvColor8(0xFF, 0, 0);
                torchMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }

        let boatCount = this.enableUnusedGfx ? this.paddleBoats.length : 1;

        for (let i = 0; i < boatCount; i++) {
            const boat = this.paddleBoats[i];

            calcModelMatrix(scratchMtx1, boat.position, [0, boat.rotY, 0]);
            this.paddleBoatMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

            computeModelMatrixT(scratchMtx2, 0, 16.0, -255.0);
            mat4.rotateX(scratchMtx2, scratchMtx2, boat.wheelRot * BinAngleToRad);
            mat4.multiply(scratchMtx1, scratchMtx1, scratchMtx2);

            this.paddleWheelMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }

        for (const object of this.gObjectParticle2) {
            renderSmokeParticles(object);
        }

        if (this.enableUnusedGfx) {
            for (const object of this.gObjectParticle3) {
                renderSmokeParticles(object);
            }
        }
    }

    override updateObjects(): void {
        this.torchObjHandler.texIndex = Math.floor(SCENE_TIME / (1000 / 30)) % 4;
        this.torchObjHandler.updateActiveTexture();

        for (const object of this.torchParticles) {
            if (object.state !== 0) {

                this.updateFlameParticle(object);

                if ((object.actionState !== 0) && (object.actionState === 1)) {
                    object.advanceActionState();
                }

                object.updatePosition();
            }
        }

        this.updateVehiclePaddleBoats();
        this.updateAllSmokeParticles();
    }

    private updateAllSmokeParticles(): void {
        for (let i = 0; i < 128; i++) {
            const object = this.gObjectParticle2[i];
            if (object.state !== 0 && object.isInitialized) {
                this.updateSmokeParticle(object);
                if (object.state === 0) {
                    object.deleteObject();
                }
            }
        }
        for (let i = 0; i < 128; i++) {
            const object = this.gObjectParticle3[i];
            if (object.state !== 0 && object.isInitialized) {
                this.updateSmokeParticle(object);
                if (object.state === 0) {
                    object.deleteObject();
                }
            }
        }
    }

    /**init_ferry_smoke*/
    private initFerrySmoke(object: Entity, pos: vec3, velocity: number): void {
        object.init(0);
        vec3.copy(object.originPos, pos);
        object.velocity[1] = velocity;
        object.userValB.value = 0x00FF;
        object.userValA.value = 0x0096;
        object.isInitialized = true;
    }

    /**func_80075B08*/
    private setupFerrySmoke(object: Entity): void {
        object.objectType = EntityType.FerrySmoke;
        object.activeTexture = 0x0D02D158;
        object.textureListAddr = 0x0D02D158;
        object.primAlpha.value = 0xFF;
        object.direction[1] = 0;
        object.orientation[0] = 0;
        object.orientation[2] = 0;
        object.setOffset(0, 0, 0);
        object.setScale(0.5);
        object.advanceState();
    }

    /**func_80075B84*/
    private updateSmokeParticle(object: Entity): void {
        switch (object.state) {
            case 1:
                this.setupFerrySmoke(object);
                break;
            case 2:
                object.velocity[1] -= 0.03 * DELTA_TIME;
                object.stepUpToTargetV(object.offset, 1, 100.0, object.velocity[1]);
                object.tryStepUpToTargetF(object.scale, 0.55, 1.0, 0.1, 1, 0);
                if (object.stepDownToTargetLoopS(object.primAlpha, 0xFF, 0x1E, 7, 0, 0)) {
                    object.advanceState();
                }
                break;
            case 3:
                object.resetAllStates();
                break;
        }

        object.updatePosition();
    }

    private updateVehiclePaddleBoats(): void {
        this.ferrySmokeTimer += DELTA_TIME;

        for (let i = 0; i < this.paddleBoats.length; i++) {
            const paddleBoat = this.paddleBoats[i];

            const prevPosition = vec3.copy(scratchVec3a, paddleBoat.position);

            this.moveAlongPath2D(paddleBoat.position, paddleBoat.pathPointIndex, paddleBoat.speed);

            if ((this.ferrySmokeTimer >= 10)) {
                for (const xOffset of [-30.0, 30.0]) {
                    vec3.set(prevPosition,
                        paddleBoat.position[0] + xOffset,
                        paddleBoat.position[1] + 180.0,
                        paddleBoat.position[2] + 45.0
                    );
                    rotatePositionAroundPivot(prevPosition, paddleBoat.position, paddleBoat.rotY, this.globals.isMirrorMode);
                    this.trySpawnFerrySmoke(prevPosition, 1.1, i);
                }
            }

            const targetPoint = this.vehiclePath2D[mod(paddleBoat.pathPointIndex.value + 5, this.vehiclePath2DLength)];
            const targetPathPos: vec3 = [targetPoint[0], -40, targetPoint[1]];
            const targetYaw = this.calcPathTargetYaw(prevPosition, targetPathPos);

            const yawDelta = targetYaw - paddleBoat.rotY;
            let yawChange = Math.abs(yawDelta);

            if (yawChange >= 0x1771) {

                if (paddleBoat.speed > 0.2)
                    paddleBoat.speed -= 0.04 * DELTA_TIME;

                yawChange = Math.min(yawChange, 0x3C);
            } else {

                if (paddleBoat.speed < 2.0)
                    paddleBoat.speed += 0.02 * DELTA_TIME;

                yawChange = Math.min(yawChange, 0x1E);
            }

            if (yawDelta >= 0x8000 || (yawDelta < 0 && yawDelta >= -0x7FFF)) {
                paddleBoat.rotY -= yawChange * DELTA_TIME;
            } else {
                paddleBoat.rotY += yawChange * DELTA_TIME;
            }

            paddleBoat.rotY = interpS16(paddleBoat.rotY);
            paddleBoat.wheelRot += 0x38E * DELTA_TIME;
            vec3.sub(paddleBoat.velocity, paddleBoat.position, prevPosition);

            if (this.globals.isMirrorMode) {
                paddleBoat.rotY = -paddleBoat.rotY;
            }
        }

        if (this.ferrySmokeTimer >= 10) {
            this.ferrySmokeTimer -= 10;
        }
    }

    private trySpawnFerrySmoke(pos: vec3, velocity: number, ferryIndex: number): void {
        if (ferryIndex === 0) {
            const object = this.getNextFreeParticle(this.gObjectParticle2);
            if (object) {
                this.initFerrySmoke(object, pos, velocity);
            }
        } else {
            const object = this.getNextFreeParticle(this.gObjectParticle3);
            if (object) {
                this.initFerrySmoke(object, pos, velocity);
            }
        }
    }

    /**func_80076E14*/
    private updateFlameParticle(object: Entity): void {
        switch (object.state) {
            case 1:
                object.advanceState();
                if (object.objectType !== EntityType.DkJungleTorch) {
                    object.initActionState();
                }
                break;
            case 2:
                if (object.actionState >= 2 && (object.stepDownToTargetLoopS(object.primAlpha, 255, 80, 32, 0, 0))) {
                    object.advanceState();
                }
                break;
            case 3:
                object.resetAllStates();
                object.resetAllActionStates();
                break;
        }
    }
}

export class RainbowRoadRenderer extends Mk64Renderer {
    public neonSignsObjs: Entity[] = nArray(10, () => new Entity(0));
    public chainChompsObjs: Entity[] = nArray(3, () => new Entity(0));

    private chainChompAnimCtrl: SkelAnimController;
    private chainChompPathIndex: NumberHolder = { value: 0 };

    constructor(globals: Mk64Globals) {
        super(globals);

        this.chainChompAnimCtrl = new SkelAnimController(globals, 0x0D0077D0, 0x06016578, 0x0601610C, 1);
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.neonSignsObjs.length; i++) {
            const object = this.neonSignsObjs[i];
            if (object.state >= 2 && object.isFlagInactive(EntityFlags.IsHidden)) {
                if (!object.modelInst) {
                    object.modelInst = this.initRenderer2D(object.activeTLUT, object.activeTexture, 0x0D05C2B0, 0x0D007D78, 64, 64, 32);
                }

                object.updateTextures2D(this.globals, 64, 64, 32);

                calcModelMatrix(scratchMtx1, object.pos, object.orientation, object.scale.value);
                object.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }

        for (const chainChomp of this.chainChompsObjs) {
            if (chainChomp.state >= 2) {

                this.chainChompAnimCtrl.setAnimFrame(chainChomp.pos, chainChomp.direction, chainChomp.scale.value, chainChomp.frameTime);
                this.chainChompAnimCtrl.renderSkeleton(renderInstManager, viewerInput);
            }
        }
    }

    override updateObjects(): void {
        for (let i = 0; i < this.neonSignsObjs.length; i++) {

            const object = this.neonSignsObjs[i];

            if (object.state !== 0) {

                switch (i) {
                    case 0: this.updateNeonMushroom(object); break;
                    case 1: this.updateNeonMario(object); break;
                    case 2: this.updateNeonBoo(object); break;
                }

                if (i >= 3 && object.state === 1) {
                    this.initStaticNeon(object, i - 3);
                }

                if (object.state >= 2) {
                    object.updateActiveIndexedTexture();
                    object.updatePosition();
                }
            }
        }

        for (let i = 0; i < this.chainChompsObjs.length; i++) {
            const object = this.chainChompsObjs[i];
            if (object.state !== 0) {
                this.updateChainChomp(object, i);
                vec3.copy(object.targetPos, object.pos);

                this.chainChompPathIndex.value = object.historyStack[8];
                this.moveAlongPathReverse(object.offset, this.chainChompPathIndex, object.speed.value, object.surfaceHeight);
                object.historyStack[8] = this.chainChompPathIndex.value;

                object.direction[1] = calcTargetAngleY(object.targetPos, object.offset);
                object.updatePosition();
            }
        }
    }

    /**func_80085878*/
    private initChainChomp(object: Entity, index: number): void {
        const pathIndex = (index * 0x12C) + 0x1F4;

        object.currentAnimIndex = 1;
        object.boundingBoxSize = 10;
        object.setScale(0.03);
        object.setOriginPosition(0.0, -15.0, 0.0);
        object.setFlags(EntityFlags.IsCollisionActive | EntityFlags.unk_26);

        object.historyStack[8] = pathIndex;

        vec3.copy(object.offset, this.trackPath[pathIndex].pos);
        object.setDirection(0, 0, 0);
        object.speed.value = 4.0;
        object.userValB.value = this.chainChompAnimCtrl.getAnimationDuration(0);
        object.advanceState();
        object.updatePosition();
    }

    /**func_800859C8*/
    private updateChainChomp(object: Entity, arg1: number): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initChainChomp(object, arg1);
                break;
            case 2:
                object.updateAnimationFrame(0, object.userValB.value, 1, true);
                break;
        }

        //horizontal movement
        object.surfaceHeight = object.oscillateLoopF(object.surfaceHeight, -0.8, 0.8, 0.03, 0, -1);
    }

    /**func_80085BB4*/
    private initNeonCommon(object: Entity): void {
        object.setScale(8.0);
        object.setOffset(0.0, 0.0, 0.0);
        object.setOrientation(0, 0, 0);
        object.advanceState();
    }

    /**func_80086074*/
    private initStaticNeon(object: Entity, index: number): void {
        vec3.copy(object.originPos, dStaticNeonSpawns[index]);
        object.originPos[0] *= this.xOrientation;
        object.setTextureList(0x06007200 + (index * 0x200), 0x0600B000 + (index * 0x1000), 64, 64);
        this.initNeonCommon(object);
    }

    /**func_80085EF8*/
    private initNeonBoo(object: Entity): void {
        object.setOriginPosition(this.xOrientation * -2013.0, 555.0, 0.0);
        object.setTextureList(0x06006800, 0x0600A000, 64, 64);
        this.initNeonCommon(object);
    }

    /**func_80085F74*/
    private updateNeonBoo(object: Entity): void {
        switch (object.state) {
            case 1:
                this.initNeonBoo(object);
                break;
            case 2:
                object.textureLoopForward(0, 4, 1, 5, 1);
                break;
            case 3:
                object.runTimer(30);
                break;
            case 4:
                object.textureVisibilityLoop(4, 1, 7);
                break;
            case 5:
                object.runTimer(30);
                break;
            case 6:
                object.textureLoopBackward(3, 0, 1, 5, 1);
                break;
            case 7:
                object.runVisibilityTimer(15);
                break;
            case 8:
                object.setState(2);
                break;
            case 0:
            default:
                break;
        }
    }

    /**func_80085DB8*/
    private initNeonMario(object: Entity): void {
        object.setOriginPosition(this.xOrientation * 799.0, 1193.0, -5891.0);
        object.setTextureList(0x06005E00, 0x06009000, 64, 64);
        this.initNeonCommon(object);
    }

    /**func_80085E38*/
    private updateNeonMario(object: Entity): void {
        switch (object.state) {
            case 1:
                this.initNeonMario(object);
                break;
            case 2:
                object.textureLoopForward(0, 4, 1, 12, 1);
                break;
            case 3:
                object.textureSwapLoop(3, 4, 12, 1);
                break;
            case 4:
                object.runVisibilityTimer(12);
                break;
            case 5:
                object.setState(2);
                break;
            default:
                break;
        }
    }

    private initNeonMushroom(object: Entity): void {
        object.setOriginPosition(this.xOrientation * -1431.0, 827.0, -2957.0);
        object.setTextureList(0x06005400, 0x06008000, 64, 64);
        this.initNeonCommon(object);
    }

    /**func_80085CA0*/
    private updateNeonMushroom(object: Entity): void {
        switch (object.state) {
            case 1:
                this.initNeonMushroom(object);
                break;
            case 2:
                object.textureLoopForward(0, 4, 1, 12, 5);
                break;
            case 3:
                object.textureSwapLoop(3, 4, 4, 10);
                break;
            case 4:
                object.runTimer(20);
                break;
            case 5:
                object.textureLoopForward(0, 4, 1, 12, 5);
                break;
            case 6:
                object.runTimer(20);
                break;
            case 7:
                object.textureSwapLoop(3, 4, 1, 20);
                break;
            case 8:
                object.setState(2);
                break;
            case 0:
            default:
                break;
        }
    }

}

class Vehicle {
    public position: vec3 = vec3.create();
    public rotation: vec3 = vec3.create();
    public velocity: vec3 = vec3.create();
    public pathPointIndex: NumberHolder = { value: 0 };
    public speed: number = 0;
    public trackOffsetX: number = 0;
    public laneIndex: number = 0;
    public type: number = 0;
}

export class ToadsTurnpikeRenderer extends Mk64Renderer {
    private boxTruckMdl0: BasicRspRenderer;
    private boxTruckMdl1: BasicRspRenderer;
    private boxTruckMdl2: BasicRspRenderer;
    private schoolBusMdl: BasicRspRenderer;
    private tankerMdl: BasicRspRenderer;
    private carMdl: BasicRspRenderer;
    public gBoxTruckList: Vehicle[] = [];
    public gSchoolBusList: Vehicle[] = [];
    public gTankerTruckList: Vehicle[] = [];
    public gCarList: Vehicle[] = [];

    constructor(globals: Mk64Globals) {
        super(globals);

        const speed150cc = kmToSpeed(10);
        const speedA = speed150cc + kmToSpeed(55);
        const speedB = speed150cc + kmToSpeed(35);

        let truckType = 0;

        const initVehicles = (numVehicles: number, pathStartIndex: number): Vehicle[] => {
            const vehicleList: Vehicle[] = [];
            const numPathPoints = this.trackPath.length;
            for (let i = 0; i < numVehicles; i++) {
                const veh = new Vehicle();
                const pointIdx = mod(Math.floor(((i * numPathPoints) / numVehicles) + pathStartIndex), numPathPoints);

                vec3.copy(veh.position, this.trackPath[pointIdx].pos);

                veh.pathPointIndex.value = pointIdx;
                veh.laneIndex = random_int(3);
                veh.trackOffsetX = (veh.laneIndex - 1) * 0.6;
                veh.type = truckType++;

                if (veh.laneIndex === 2) {
                    veh.speed = speedA;
                } else {
                    veh.speed = speedB;
                }

                const ogPosX = veh.position[0];
                const ogPosz = veh.position[2];

                if (this.globals.isMirrorMode) {
                    veh.rotation[1] = this.moveAlongPathReverse(veh.position, veh.pathPointIndex, veh.speed, veh.trackOffsetX);
                } else {
                    veh.rotation[1] = this.moveAlongPath(veh.position, veh.pathPointIndex, veh.speed, veh.trackOffsetX, 3);
                }

                veh.velocity[0] = veh.position[0] - ogPosX;
                veh.velocity[2] = veh.position[2] - ogPosz;

                truckType %= 3;

                vehicleList.push(veh);
            }

            return vehicleList;
        }

        this.boxTruckMdl0 = globals.initRendererFromDL(0x06023CC0);
        this.boxTruckMdl1 = globals.initRendererFromDL(0x06023D20);
        this.boxTruckMdl2 = globals.initRendererFromDL(0x06023D78);
        this.carMdl = globals.initRendererFromDL(0x06023DD0);
        this.schoolBusMdl = globals.initRendererFromDL(0x06023E18);
        this.tankerMdl = globals.initRendererFromDL(0x06023E58);

        this.gBoxTruckList = initVehicles(7, 0);
        this.gCarList = initVehicles(7, 25);
        this.gTankerTruckList = initVehicles(7, 50);
        this.gSchoolBusList = initVehicles(7, 75);
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (const truck of this.gBoxTruckList) {

            calcModelMatrix(scratchMtx1, truck.position, truck.rotation);

            switch (truck.type) {
                case 0: this.boxTruckMdl0.prepareToRender(renderInstManager, viewerInput, scratchMtx1); break;
                case 1: this.boxTruckMdl1.prepareToRender(renderInstManager, viewerInput, scratchMtx1); break;
                case 2: this.boxTruckMdl2.prepareToRender(renderInstManager, viewerInput, scratchMtx1); break;
            }

        }

        for (const truck of this.gSchoolBusList) {
            calcModelMatrix(scratchMtx1, truck.position, truck.rotation);
            this.schoolBusMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }

        for (const truck of this.gTankerTruckList) {
            calcModelMatrix(scratchMtx1, truck.position, truck.rotation);
            this.tankerMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }

        for (const truck of this.gCarList) {
            calcModelMatrix(scratchMtx1, truck.position, truck.rotation, 0.1);
            this.carMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }
    }

    override updateObjects(): void {
        for (const truck of this.gBoxTruckList) {
            this.updateVehicleFollowPath(truck);
        }

        for (const bus of this.gSchoolBusList) {
            this.updateVehicleFollowPath(bus);
        }

        for (const bus of this.gTankerTruckList) {
            this.updateVehicleFollowPath(bus);
        }

        for (const bus of this.gCarList) {
            this.updateVehicleFollowPath(bus);
        }
    }

    /**func_80013C74*/
    private getVehicleOffsetX(lane: number, pathPointIndex: number): number {
        if (pathPointIndex < 0x28A) {
            if (lane === 0) return -0.7;
            if (lane === 2) return 0.7;
            return 0.0;
        } else {
            if (lane <= 1) return -0.5;
            if (lane === 2) return 0.5;
            return 0.0;
        }
    }

    private updateVehicleFollowPath(vehicle: Vehicle): void {
        const previousPos = vec3.clone(vehicle.position);
        const pitchOrigin = vec3.fromValues(vehicle.position[1], 0, 0);
        const targetOffsetX = this.getVehicleOffsetX(vehicle.laneIndex, vehicle.pathPointIndex.value);
        const zOffsetDelta = targetOffsetX - vehicle.trackOffsetX;

        if (Math.abs(zOffsetDelta) <= 0.06) {
            vehicle.trackOffsetX = targetOffsetX;
        } else {
            vehicle.trackOffsetX += Math.sign(zOffsetDelta) * 0.06;
        }

        let angleToTarget;

        if (this.globals.isMirrorMode) {
            angleToTarget = this.moveAlongPathReverse(vehicle.position, vehicle.pathPointIndex, vehicle.speed, vehicle.trackOffsetX);
        }
        else {
            angleToTarget = this.moveAlongPath(vehicle.position, vehicle.pathPointIndex, vehicle.speed, vehicle.trackOffsetX, 3);
        }

        lerpBinAngle(vehicle.rotation, 1, angleToTarget, 100);

        const dx = vehicle.position[0] - previousPos[0];
        const dz = vehicle.position[2] - previousPos[2];

        const horizontalSpeed = Math.hypot(dx, dz);
        const pitchAngle = -calcTargetAngleY(pitchOrigin, [vehicle.position[1], 0, horizontalSpeed]);

        lerpBinAngle(vehicle.rotation, 0, pitchAngle, 100);

        vec3.subtract(vehicle.velocity, vehicle.position, previousPos);

        if (this.globals.isMirrorMode) {
            vehicle.rotation[1] = -vehicle.rotation[1];
        }
    }
}

class TrainCar {
    public isActive: boolean = false;
    public position: vec3 = vec3.create();
    public rotation: vec3 = vec3.create();
    public velocity: vec3 = vec3.create();
    public pathPointIndex: NumberHolder = { value: 0 };
    public wheelRot: number = 0;
}

class Train {
    public locomotive: TrainCar = new TrainCar();
    public tender: TrainCar = new TrainCar();
    public railcars: TrainCar[] = nArray(5, () => new TrainCar());
    public speed: number = 5.0;
    public someFlags: number = 0;
    public numCars: number = 0;
}

export class KalamariDesertRenderer extends Mk64Renderer {
    public trains: Train[] = [];
    private crossbucks: ActorCrossbuck[] = [];
    private trainSmokeTimer: number = 0;

    private trainEngineMdl: BasicRspRenderer;
    private trainTenderMdl: BasicRspRenderer;
    private trainCarMdl: BasicRspRenderer;
    private smokeMdl: BasicRspRenderer;

    private smallWheelMdl: BasicRspRenderer;
    private bigWheelMdl: BasicRspRenderer;

    constructor(globals: Mk64Globals) {
        super(globals);

        this.crossbucks.push(this.spawnActor(ActorType.RailroadCrossing, [-1680, 2, 35]) as ActorCrossbuck);
        this.crossbucks.push(this.spawnActor(ActorType.RailroadCrossing, [-1600, 2, 35]) as ActorCrossbuck);

        vec3.set(scratchVec3a, 0, -0x2000, 0);
        this.crossbucks.push(this.spawnActor(ActorType.RailroadCrossing, [-2459, 2, 2263], scratchVec3a) as ActorCrossbuck);
        this.crossbucks.push(this.spawnActor(ActorType.RailroadCrossing, [-2467, 2, 2375], scratchVec3a) as ActorCrossbuck);

        this.trainTenderMdl = globals.initRendererFromDL(0x060233A0);
        this.trainCarMdl = globals.initRendererFromDL(0x060233B8);
        this.trainEngineMdl = globals.initRendererFromDL(0x060233D0);

        this.smallWheelMdl = globals.initRendererFromDL(0x060233E8);
        this.bigWheelMdl = globals.initRendererFromDL(0x06023408);
        this.smokeMdl = globals.initRendererFromDL(0x06023420, true, Mk64RenderLayer.Smoke);

        const path = readPathData(this.globals.segmentBuffers, 0x06006C60);
        this.generate2DPath(path);

        const firstPathPoint = this.vehiclePath2D[0];
        const trainSurfaceheight = this.globals.colGrid.getSurfaceHeight(firstPathPoint[0], 2000.0, firstPathPoint[1]);

        for (let i = 0; i < 2; i++) {
            const train = new Train();
            let pathPointOffset = Math.floor((((i * this.vehiclePath2DLength) / 2) + 160) % this.vehiclePath2DLength);

            const setVehiclePathPoint = (railcar: TrainCar) => {
                const pos = this.vehiclePath2D[pathPointOffset];

                railcar.pathPointIndex.value = pathPointOffset;
                vec3.set(railcar.position, pos[0], trainSurfaceheight, pos[1]);
            };

            for (let j = 0; j < train.railcars.length; j++) {
                pathPointOffset += 4;
                train.railcars[j].isActive = true;
                setVehiclePathPoint(train.railcars[j]);
            }

            pathPointOffset += 3;
            setVehiclePathPoint(train.tender);

            pathPointOffset += 4;
            setVehiclePathPoint(train.locomotive);

            train.tender.isActive = true;
            train.numCars = 6;

            this.trains.push(train);
        }

        for (let i = 0; i < this.trains.length; i++) {
            const train = this.trains[i];

            this.updateTrainPos(train.locomotive, train.speed);

            if (train.tender.isActive) {
                this.updateTrainPos(train.tender, train.speed);
            }

            for (const car of train.railcars) {
                if (car.isActive) {
                    this.updateTrainPos(car, train.speed);
                }
            }
        }
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        for (let i = 0; i < this.trains.length; i++) {
            const train = this.trains[i];

            calcModelMatrix(scratchMtx1, train.locomotive.position, train.locomotive.rotation);
            this.trainEngineMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

            const renderWheel = (x: number, y: number, z: number, wheelRot: number, isSmallWheel: boolean = true) => {
                computeModelMatrixT(scratchMtx2, x, y, z);
                mat4.rotateX(scratchMtx2, scratchMtx2, wheelRot * BinAngleToRad);
                mat4.multiply(scratchMtx2, scratchMtx1, scratchMtx2);

                if (isSmallWheel) {
                    this.smallWheelMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx2);
                }
                else {
                    this.bigWheelMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx2);
                }
            };

            const renderSmokeParticles = (objectList: Entity[]) => {
                for (const object of objectList) {
                    if (object.state >= 2 && object.objectType === EntityType.TrainSmoke) {

                        const primCol = object.userValB.value;
                        this.smokeMdl.setPrimColor8(primCol, primCol, primCol, object.primAlpha.value);
                        this.smokeMdl.setEnvColor8(0, 0, 0, 0xFF);

                        calcModelMatrix(scratchMtx1, object.pos, Vec3Zero, object.scale.value);
                        this.smokeMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                    }
                }
            };

            //front wheels
            renderWheel(17, 6, 32, train.locomotive.wheelRot);
            renderWheel(-17, 6, 32, train.locomotive.wheelRot);
            renderWheel(17, 6, 16, train.locomotive.wheelRot + 0x16C);
            renderWheel(-17, 6, 16, train.locomotive.wheelRot + 0x16C);

            //back wheels
            renderWheel(17, 12, -12, train.locomotive.wheelRot + 0x444, false);
            renderWheel(-17, 12, -12, train.locomotive.wheelRot + 0x444, false);
            renderWheel(17, 12, -34, train.locomotive.wheelRot + 0x2D8, false);
            renderWheel(-17, 12, -34, train.locomotive.wheelRot + 0x2D8, false);

            if (train.tender.isActive) {

                calcModelMatrix(scratchMtx1, train.tender.position, train.tender.rotation);
                this.trainTenderMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

                renderWheel(17, 6, 8, train.tender.wheelRot);
                renderWheel(-17, 6, 8, train.tender.wheelRot);
                renderWheel(17, 6, -8, train.tender.wheelRot + 0x444);
                renderWheel(-17, 6, -8, train.tender.wheelRot + 0x444);
            }

            for (const car of train.railcars) {
                if (car.isActive) {
                    calcModelMatrix(scratchMtx1, car.position, car.rotation);
                    this.trainCarMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

                    renderWheel(17, 6, 28, car.wheelRot);
                    renderWheel(-17, 6, 28, car.wheelRot);

                    renderWheel(17, 6, 12, car.wheelRot + 0x222);
                    renderWheel(-17, 6, 12, car.wheelRot + 0x222);

                    renderWheel(17, 6, -8, car.wheelRot + 0x5B0);
                    renderWheel(-17, 6, -8, car.wheelRot + 0x5B0);

                    renderWheel(17, 6, -24, car.wheelRot + 0x16C);
                    renderWheel(-17, 6, -24, car.wheelRot + 0x16C);
                }
            }

            if (i) {
                renderSmokeParticles(this.gObjectParticle2);
            }
            else {
                renderSmokeParticles(this.gObjectParticle3);
            }
        }
    }

    override updateObjects(): void {

        this.trainSmokeTimer += DELTA_TIME;
        this.crossbucks.forEach(o => o.isTrainNearby = false);

        for (let i = 0; i < this.trains.length; i++) {
            const train = this.trains[i];
            const locomotive = train.locomotive;
            const tender = train.tender;

            this.updateTrainPos(locomotive, train.speed);
            locomotive.wheelRot += 0x666 * DELTA_TIME;

            if (this.trainSmokeTimer >= 5) {

                const smokePos: vec3 = [
                    locomotive.position[0],
                    locomotive.position[1] + 65.0,
                    locomotive.position[2] + 25.0
                ];

                rotatePositionAroundPivot(smokePos, locomotive.position, locomotive.rotation[1], this.globals.isMirrorMode);
                this.spawnSmokeParticle(i, smokePos, 1.1);
            }

            if (tender.isActive) {
                this.updateTrainPos(tender, train.speed);
                train.tender.wheelRot += 0x4FA * DELTA_TIME;
            }

            for (const car of train.railcars) {
                if (car.isActive) {
                    this.updateTrainPos(car, train.speed);
                    car.wheelRot += 0x666 * DELTA_TIME;
                }
            }

            const objectList = i ? this.gObjectParticle2 : this.gObjectParticle3;

            for (let j = 0; j < objectList.length; j++) {
                const object = objectList[j];
                if (object.state !== 0 && object.isInitialized) {

                    this.updateSmokeParticle(object);

                    if (object.state === 0) {
                        object.deleteObject();
                    }
                }
            }

            const isTrainInZone = (zoneCenter: number): boolean => {
                const nrmPathPos = locomotive.pathPointIndex.value / this.vehiclePath2DLength;
                const zoneStart = zoneCenter - 0.1;
                const zoneEnd = (train.numCars * 0.01) + zoneCenter + 0.01;
                return nrmPathPos > zoneStart && nrmPathPos < zoneEnd;
            };

            if (isTrainInZone(0.72017354)) {
                this.crossbucks[0].isTrainNearby = true;
                this.crossbucks[1].isTrainNearby = true;
            }

            if (isTrainInZone(0.42299348)) {
                this.crossbucks[2].isTrainNearby = true;
                this.crossbucks[3].isTrainNearby = true;
            }
        }

        if (this.trainSmokeTimer >= 5) {
            this.trainSmokeTimer -= 5;
        }
    }

    private updateTrainPos(vehicle: TrainCar, speed: number): void {
        const origXPos = vehicle.position[0];
        const origZPos = vehicle.position[2];

        const yRot = this.moveAlongPath2D(vehicle.position, vehicle.pathPointIndex, speed);

        vehicle.velocity[0] = (vehicle.position[0] - origXPos);
        vehicle.velocity[2] = (vehicle.position[2] - origZPos);

        vec3.set(vehicle.rotation, 0, yRot, 0);
    }

    /**func_80075698*/
    private initSmokeParticle(object: Entity): void {
        object.objectType = EntityType.TrainSmoke;
        object.primAlpha.value = 0xFF;
        object.direction[1] = 0;
        object.orientation[0] = 0;
        object.orientation[2] = 0;
        object.setOffset(0, 0, 0);
        object.setScale(0.5);
        object.advanceState();
        object.isInitialized = true;
    }

    private initSmokeParticlePos(object: Entity, pos: vec3, velocity: number): void {
        object.init(0);
        vec3.copy(object.originPos, pos);
        object.velocity[1] = velocity;
        object.userValB.value = random_int(0x0064) + 0x1E;
    }

    private spawnSmokeParticle(trainIndex: number, pos: vec3, velocity: number): void {
        if (trainIndex) {
            const object = this.getNextFreeParticle(this.gObjectParticle2);
            if (object) {
                this.initSmokeParticlePos(object, pos, velocity);
            }
        } else {
            const object = this.getNextFreeParticle(this.gObjectParticle3);
            if (object) {
                this.initSmokeParticlePos(object, pos, velocity);
            }
        }
    }

    /**func_80075714*/
    private updateSmokeParticle(object: Entity): void {
        switch (object.state) {
            case 1:
                this.initSmokeParticle(object);
                break;
            case 2:
                object.velocity[1] -= 0.03 * DELTA_TIME;
                object.stepUpToTargetV(object.offset, 1, 100.0, object.velocity[1]);
                object.tryStepUpToTargetF(object.scale, 0.55, 1.0, 0.1, 1, 0);
                if (object.stepDownToTargetLoopS(object.primAlpha, 0xFF, 0x1E, 7, 0, 0)) {
                    object.advanceState();
                }
                break;
            case 3:
                object.resetAllStates();
                break;
        }

        object.updatePosition();
    }
}

enum PenguinEventFlags {
    IsSliding = 1 << 0,
    HasAnimStarted = 1 << 1,
    HasReflection = 1 << 2,
    IsSpinning = 1 << 3,
    Unk4_16 = 1 << 4,// Different cry trigger?
    IsPenguinHit = 1 << 5,
    CryTriggered = 1 << 6,
    IsCrying = 1 << 7,
}

export class SherbetLandRenderer extends Mk64Renderer {
    private penguinAnimCtrl: SkelAnimController;
    private penguinObjs: Entity[] = nArray(15, () => new Entity(0));

    constructor(globals: Mk64Globals) {
        super(globals);

        this.penguinAnimCtrl = new SkelAnimController(globals, 0x0D0077D0, 0x06009DF0, 0x06009AC8, 3);
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        for (let i = 0; i < this.penguinObjs.length; i++) {
            const penguin = this.penguinObjs[i];
            if (penguin.state >= 2) {
                this.penguinAnimCtrl.setCurrentAnimation(penguin.currentAnimIndex);

                if (penguin.isFlagActive(EntityFlags.HasShadow)) {
                    if (penguin.isEventFlagActive(PenguinEventFlags.HasReflection)) {

                        penguin.pos[1] -= 1;
                        penguin.orientation[0] += 0x8000;
                        penguin.orientation[1] += 0x8000;

                        this.penguinAnimCtrl.setAnimFrame(penguin.pos, penguin.orientation, penguin.scale.value, penguin.frameTime);
                        this.penguinAnimCtrl.renderSkeleton(renderInstManager, viewerInput);

                        penguin.pos[1] += 1;
                        penguin.orientation[0] -= 0x8000;
                        penguin.orientation[1] -= 0x8000;
                    }
                    else {
                        this.renderShadow(penguin, renderInstManager, viewerInput, 1.5);
                    }
                }
                this.penguinAnimCtrl.setAnimFrame(penguin.pos, penguin.orientation, penguin.scale.value, penguin.frameTime);
                this.penguinAnimCtrl.renderSkeleton(renderInstManager, viewerInput);
            }
        }
    }

    override updateObjects(): void {
        for (let i = 0; i < this.penguinObjs.length; i++) {
            const obj = this.penguinObjs[i];

            if (obj.state !== 0) {
                if (i === 0) {
                    this.updateBigPenguin(obj);
                } else {
                    this.updateSmallPenguin(obj, i);
                }

                this.updatePenguinMovement(obj);
            }

            if (obj.isEventFlagInactive(PenguinEventFlags.IsPenguinHit)) {
                if (IsTargetInRangeXYZ(obj.pos, this.globals.cameraPos, obj.boundingBoxSize)) {
                    obj.setFlags(EntityFlags.IsHitByStar);
                }
            }

            if ((obj.isFlagActive(EntityFlags.IsHitByStar)) && obj.isEventFlagInactive(PenguinEventFlags.IsPenguinHit)) {
                obj.setEventFlags(PenguinEventFlags.IsPenguinHit | PenguinEventFlags.CryTriggered);
                obj.clearFlags(EntityFlags.IsHitByStar);
            }
        }
    }

    /**func_80084430*/
    private initBigPenguin(object: Entity): void {
        object.currentAnimIndex = 0;
        object.setScale(0.2);
        object.boundingBoxSize = 12 * 5;
        object.splineTargetX = 1;
        object.setOriginPosition(this.xOrientation * -383.0, 2.0, -690.0);
        object.setDirection(0, 0, 0);
        object.actionBehaviorType = 1;
        object.initActionState();
        object.splinePath = dPenguinPath;
        object.setFlags(EntityFlags.CalcSplineVelocity | EntityFlags.unk_26);
        object.userValB.value = this.penguinAnimCtrl.getAnimationDuration(0);
        object.advanceState();
    }

    /**func_800845C8*/
    private initSmallPenguin(object: Entity, index: number): void {
        object.currentAnimIndex = 0;
        object.boundingBoxSize = 4 * 4;
        object.splineTargetX = 2; // animation speed
        object.timer = random_int(300);
        object.setFlags(EntityFlags.HasShadow | EntityFlags.IsCollisionActive | EntityFlags.unk_26);

        if ((index > 0) && (index < 9)) {
            if ((index === 1) || (index === 2)) {
                object.setOriginPosition(this.xOrientation * -2960.0, -80.0, 1521.0);
                object.targetDirection.value = 0x0150;
                object.targetPos[1] = 100.0;
            } else if ((index === 3) || (index === 4)) {
                object.setOriginPosition(this.xOrientation * -2490.0, -80, 1612.0);
                object.targetDirection.value = 0x0100;
                object.targetPos[1] = 80.0;
            } else if ((index === 5) || (index === 6)) {
                object.setOriginPosition(this.xOrientation * -2098.0, -80.0, 1624.0);
                object.targetDirection.value = -0x0100;
                object.targetPos[1] = 80.0;
            } else if ((index === 7) || (index === 8)) {
                object.setOriginPosition(this.xOrientation * -2080.0, -80.0, 1171.0);
                object.targetDirection.value = 0x0150;
                object.targetPos[1] = 80.0;
            }
            object.directionStep = (index << this.penguinObjs.length) & 0xFFFF;
            object.actionBehaviorType = 2;
            object.surfaceHeight = -80.0;

            object.setScale(0.08);
            object.setEventFlags(PenguinEventFlags.IsSpinning);
        } else if ((index > 8) && (index < 15)) {
            switch (index) {
                case 9:
                    if (true) {
                        object.setOriginPosition(this.xOrientation * 146.0, 0.0, -380.0);
                    } else {
                        // credits pos
                        object.setOriginPosition(this.xOrientation * 380.0, 0.0, -535.0);
                        object.setScale(0.15);
                    }
                    object.targetDirection.value = 0x9000;
                    if (this.globals.isMirrorMode) {
                        object.targetDirection.value -= 0x4000;
                    }
                    object.actionBehaviorType = 3;
                    break;
                case 10:
                    object.setOriginPosition(this.xOrientation * 380.0, 0.0, -766.0);
                    object.targetDirection.value = 0x5000;
                    if (this.globals.isMirrorMode) {
                        object.targetDirection.value += 0x8000;
                    }
                    object.actionBehaviorType = 4;
                    break;
                case 11:
                    object.setOriginPosition(this.xOrientation * -2300.0, 0.0, -210.0);
                    object.targetDirection.value = 0xC000;
                    object.actionBehaviorType = 6;
                    if (this.globals.isMirrorMode) {
                        object.targetDirection.value += 0x8000;
                    }
                    break;
                case 12:
                    object.setOriginPosition(this.xOrientation * -2500.0, 0.0, -250.0);
                    object.targetDirection.value = 0x4000;
                    object.actionBehaviorType = 6;
                    if (this.globals.isMirrorMode) {
                        object.targetDirection.value += 0x8000;
                    }
                    break;
                case 13:
                    object.setOriginPosition(this.xOrientation * -535.0, 0.0, 875.0);
                    object.targetDirection.value = 0x8000;
                    object.actionBehaviorType = 6;
                    if (this.globals.isMirrorMode) {
                        object.targetDirection.value -= 0x4000;
                    }
                    break;
                case 14:
                    object.setOriginPosition(this.xOrientation * -250.0, 0.0, 953.0);
                    object.targetDirection.value = 0x9000;
                    object.actionBehaviorType = 6;
                    if (this.globals.isMirrorMode) {
                        object.targetDirection.value -= 0x4000;
                    }
                    break;
                default:
                    break;
            }
            object.setDirection(0, object.targetDirection.value + 0x8000, 0);
            object.surfaceHeight = 5.0;
            object.setScale(0.04);
            object.setEventFlags(PenguinEventFlags.HasReflection | PenguinEventFlags.Unk4_16);
        }
        object.initActionState();
        object.speed.value = 0.0;
        object.userValB.value = this.penguinAnimCtrl.getAnimationDuration(0);
        object.advanceState();
    }

    /**func_800850B0*/
    private updatePenguinMovement(object: Entity): void {
        switch (object.actionBehaviorType) {
            case 1:
                this.updateBigPenguinMovement(object);
                break;
            case 2:
                this.updateOrbitalPenguinMovement(object);
                break;
            case 3:
                this.updateSlidingPenguinMovement(object, 0);
                break;
            case 4:
                this.updateSlidingPenguinMovement(object, 1);
                break;
            case 5:
                this.updateSlidingPenguinMovement(object, 2);
                break;
            case 6:
                this.updateSlidingPenguinMovement(object, 3);
                break;
        }

        if (object.isEventFlagActive(PenguinEventFlags.IsPenguinHit)) {

            if (object.isEventFlagActive(PenguinEventFlags.CryTriggered)) {
                object.clearEventFlags(PenguinEventFlags.CryTriggered);
                object.historyStack[6] = 0;  // Cry delay timer
                object.historyStack[7] = 150;// Spinning duration
            }

            if (object.historyStack[7] <= 0) {
                object.clearEventFlags(PenguinEventFlags.IsPenguinHit);
            } else {
                object.historyStack[7] -= DELTA_TIME;
                object.orientation[0] = object.direction[0];
                object.orientation[1] += 0x2000 * DELTA_TIME;
                object.orientation[2] = object.direction[2];
            }
        } else {
            vec3.copy(object.orientation, object.direction);
        }
    }

    /**func_80084D2C*/
    private updateSlidingPenguinMovement(object: Entity, index: number): void {
        switch (object.actionState) {
            case 0:
                break;
            case 1:
                object.direction[1] = stepTowardsAngle(object.direction[1], object.targetDirection.value);

                if (object.direction[1] === (object.targetDirection.value & 0xFFFF)) {
                    object.splineTargetX = 4;//animation step amount
                    object.speed.value = 0.4;
                    object.advanceActionState();
                }
                break;
            case 2:
                object.chaseF(object.speed, 0.8, 0.02);

                if (object.runActionTimer(15)) {
                    object.setEventFlags(PenguinEventFlags.IsSliding);
                    object.setEventFlags(PenguinEventFlags.HasAnimStarted);
                    object.splineTargetX = 1;
                    object.currentAnimIndex = 1;
                    object.frameTime = 0;
                    object.userValB.value = this.penguinAnimCtrl.getAnimationDuration(object.currentAnimIndex);
                    object.setState(3);
                    object.advanceActionState();

                    if (object.isEventFlagInactive(PenguinEventFlags.IsPenguinHit)) {
                        object.setEventFlags(PenguinEventFlags.IsCrying);
                    }
                }
                break;
            case 3:
                let velocity;
                switch (index) {
                    default:
                    case 0:
                        velocity = 1.0;
                        break;
                    case 1:
                        velocity = 1.5;
                        break;
                    case 2:
                        velocity = 2.0;
                        break;
                    case 3:
                        velocity = 2.5;
                        break;
                }

                object.chaseF(object.speed, velocity, 0.15);
                if ((object.isEventFlagInactive(PenguinEventFlags.HasAnimStarted)) && (velocity === object.speed.value)) {
                    object.advanceActionState();
                }
                break;
            case 4:
                if (object.runActionTimer(30)) {//how long to slide
                    object.clearEventFlags(PenguinEventFlags.IsSliding);
                    object.advanceActionState();
                }
                break;
            case 5:
                object.chaseF(object.speed, 0.4, 0.2);
                if (object.runActionTimer(10)) {
                    object.setEventFlags(PenguinEventFlags.HasAnimStarted);
                    object.currentAnimIndex = 2;
                    object.frameTime = 0;
                    object.userValB.value = this.penguinAnimCtrl.getAnimationDuration(object.currentAnimIndex);
                    object.setState(3);
                    object.advanceActionState();
                }
                break;
            case 6:
                if (object.isEventFlagInactive(PenguinEventFlags.HasAnimStarted)) {
                    object.currentAnimIndex = 0;
                    object.frameTime = 0;
                    object.userValB.value = this.penguinAnimCtrl.getAnimationDuration(object.currentAnimIndex);
                    object.targetDirection.value += 0x8000;
                    object.setState(2);
                    object.setActionState(1);
                }
                break;
        }
        object.updateForwardMovement();
        object.updatePosition();
    }

    /**func_8008502C*/
    private updateOrbitalPenguinMovement(object: Entity): void {
        this.updatePenguinOrbitOffset(object, object.targetPos[1], object.targetDirection.value);
        object.updatePosition();
        object.updateFacingDirection();
    }

    /**func_80088038*/
    private updatePenguinOrbitOffset(object: Entity, radius: number, angleStep: number): void {
        const prevX = object.offset[0];
        const prevZ = object.offset[2];

        object.directionStep += angleStep * DELTA_TIME;

        object.offset[0] = (Math.sin(object.directionStep * BinAngleToRad) * radius);
        object.offset[2] = (Math.cos(object.directionStep * BinAngleToRad) * radius);

        object.velocity[0] = object.offset[0] - prevX;
        object.velocity[2] = object.offset[2] - prevZ;
    }

    /**func_8008453C*/
    private updateBigPenguin(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initBigPenguin(object);
                break;
            case 2:
                object.updateAnimationFrame(0, object.userValB.value, 1, true);
                break;
        }
    }

    /**func_80085080*/
    private updateBigPenguinMovement(object: Entity): void {
        if (object.actionState === 1) {
            this.moveObjectAlongSplinePath(object);
        }

        object.updatePosition();
        object.updateFacingDirection();
    }

    /**func_80084B7C*/
    private updateSmallPenguin(object: Entity, index: number): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                this.initSmallPenguin(object, index);
                break;
            case 2:
                object.updateAnimationFrame(0, object.userValB.value, object.splineTargetX, true);

                if (object.isEventFlagInactive(PenguinEventFlags.IsPenguinHit)) {

                    if (object.historyStack[6] === 0) {
                        object.historyStack[6] = random_int(90) + 90;
                        object.setEventFlags(PenguinEventFlags.IsCrying);
                    } else {
                        object.historyStack[6] -= DELTA_TIME;
                    }
                }
                break;
            case 3:
                object.updateAnimationFrame(0, object.userValB.value, 1, false);
                break;
            case 4:
                object.clearEventFlags(PenguinEventFlags.HasAnimStarted);
                object.advanceState();
                break;
        }

        if (object.isEventFlagActive(PenguinEventFlags.IsPenguinHit)) {
            if (object.historyStack[6] === 0) {
                object.setEventFlags(PenguinEventFlags.IsCrying);
                object.historyStack[6] = 16;
            } else {
                object.historyStack[6] -= DELTA_TIME;
            }
        }

        if (object.isEventFlagActive(PenguinEventFlags.IsCrying)) {
            object.clearEventFlags(PenguinEventFlags.IsCrying);
        }
    }
}

export class MooMooFarmRenderer extends Mk64Renderer {
    private molehillMdl: BasicRspRenderer;
    private dirtParticleMdl: BasicRspRenderer;

    private mGroupObjsA: Entity[] = nArray(8, () => new Entity(0, false));
    private mGroupObjsB: Entity[] = nArray(11, () => new Entity(0, false));
    private mGroupObjsC: Entity[] = nArray(12, () => new Entity(0, false));
    private molehillObjs: Entity[] = [];

    constructor(globals: Mk64Globals) {
        super(globals);

        this.molehillMdl = globals.initRendererFromDL(0x0D007C10);
        this.molehillMdl.setPrimColor8(30, 10, 0, 200);

        this.dirtParticleMdl = globals.initRendererFromDL(0x06014720, true);

        for (let i = 0; i < dMoleSpawns.length; i++) {
            const molehill = new Entity(0);
            const posX = dMoleSpawns[i][0] * this.xOrientation;
            const posZ = dMoleSpawns[i][2];

            molehill.init(0);
            molehill.pos[0] = posX * this.xOrientation;
            molehill.pos[2] = posZ;
            molehill.setScale(0.7);

            this.dummyObjCol.checkBoundingCollision(10, [posX, 20, posZ]);

            if (this.dummyObjCol.hasCollisionY) {
                molehill.setFlags(EntityFlags.IsOnSurface);
                molehill.surfaceHeight = this.dummyObjCol.calculateSurfaceHeight(posX, 0, posZ, this.dummyObjCol.nearestTriIdxY);

                vec3.copy(molehill.velocity, this.dummyObjCol.normalY);
                setShadowSurfaceAngle(molehill.velocity, this.dummyObjCol);
                molehill.velocity[0] -= 0x4000;
            }

            this.molehillObjs.push(molehill);
        }
    }

    override prepareToRenderObjects(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderMoleGroup = (objs: Entity[]): void => {
            for (const mole of objs) {
                if (mole.state >= 3) {

                    if (!mole.modelInst) {
                        mole.modelInst = this.initRenderer2D(0x0600FC70, 0x0600FE70, 0x0D0062B0, 0x0D007D78, 64, 32, 64, 5);
                    }

                    calcModelMatrix(scratchMtx1, mole.pos, mole.orientation, mole.scale.value);

                    mole.updateTextures2D(this.globals, 64, 32, 64);
                    mole.modelInst.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
            }
        };

        renderMoleGroup(this.mGroupObjsA);
        renderMoleGroup(this.mGroupObjsB);
        renderMoleGroup(this.mGroupObjsC);

        for (let i = 0; i < this.molehillObjs.length; i++) {
            const obj = this.molehillObjs[i];

            if (obj.state > 0) {
                if (obj.isFlagActive(EntityFlags.IsOnSurface)) {
                    vec3.set(scratchVec3a, obj.pos[0], obj.surfaceHeight + 0.8, obj.pos[2]);
                    vec3.set(scratchVec3b, obj.velocity[0], obj.velocity[1], obj.velocity[2]);

                    calcModelMatrix(scratchMtx1, scratchVec3a, scratchVec3b, obj.scale.value);
                    this.molehillMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                }
            }
        }

        for (let i = 0; i < this.gObjectParticle2.length; i++) {
            const obj = this.gObjectParticle2[i];
            if (obj.isInitialized && obj.state > 0) {
                calcModelMatrix(scratchMtx1, obj.pos, obj.orientation, obj.scale.value);
                this.dirtParticleMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        }
    }

    override updateObjects(): void {

        const updateGroup = (groupObjs: Entity[], spawnOffset: number): void => {
            for (const mole of groupObjs) {
                if (mole.state === 0) {
                    this.spawnRandomMole(mole, groupObjs, spawnOffset);
                }
                else {
                    this.updateMole(mole);
                }
            }
        };

        updateGroup(this.mGroupObjsA, 0);
        updateGroup(this.mGroupObjsB, 8);
        updateGroup(this.mGroupObjsC, 19);

        for (const dirtObj of this.gObjectParticle2) {
            if (dirtObj.state !== 0) {
                this.updateDirtParticle(dirtObj);

                if (dirtObj.state === 0) {
                    dirtObj.deleteObject();
                }
            }
        }
    }

    /**func_80081FF4*/
    private spawnRandomMole(object: Entity, groupObjs: Entity[], spawnOffset: number): void {
        let moleCount = groupObjs.length;

        object.init(0);
        object.timer = random_int(30) + 5;

        let index = random_int(moleCount);

        for (let i = 0; i < moleCount; i++) {
            if (!groupObjs[index].isInitialized) {
                groupObjs[index].isInitialized = true;
                break;
            }

            index = (index + 1) % moleCount;
        }

        object.originPos[0] = dMoleSpawns[spawnOffset + index][0] * this.xOrientation;
        object.originPos[1] = dMoleSpawns[spawnOffset + index][1] - 9.0;
        object.originPos[2] = dMoleSpawns[spawnOffset + index][2];
    }

    /**func_80081790*/
    private updateDirtParticle(object: Entity): void {
        switch (object.state) {
            case 0:
                break;
            case 1:
                if (object.applyDirectionalVelocity(object.velocity[1], 0.3, object.speed.value, object.orientation[1], 40)) {
                    object.advanceState();
                }
                object.updatePosition();
                break;
            case 2:
                object.resetAllStates();
                object.resetAllActionStates();
                break;
        }
    }

    /**func_8008153C*/
    private spawnDirtParticles(parentObj: Entity): void {
        for (let i = 0; i < 8; i++) {
            const obj = this.getNextFreeParticle(this.gObjectParticle2, 248);

            if (!obj) {
                return;
            }

            obj.init(0);
            obj.setScale(0.15);
            obj.velocity[1] = random_int(10);
            obj.velocity[1] = (obj.velocity[1] * 0.1) + 4.8;
            obj.speed.value = (random_int(5) * 0.01) + 0.8;
            obj.orientation[1] = (0x10000 / 8) * i;
            obj.originPos[0] = parentObj.originPos[0];
            obj.originPos[1] = parentObj.originPos[1] - 13.0;
            obj.originPos[2] = parentObj.originPos[2];
            obj.isInitialized = true;
        }
    }

    /**func_80081848*/
    private initMole(object: Entity): void {
        object.setTextureList(0x0600FC70, 0x0600FE70, 32, 64);
        object.setScale(0.15);
        object.texIndex = 0;
        object.setOffset(0, 0, 0);
        object.setDirection(0, 0, 0);
        object.setOrientation(0, 0, 0x8000);
        object.boundingBoxSize = 6 * 2;
        object.velocity[1] = 4.0;
        object.setFlags(EntityFlags.unk_26);
        object.advanceState();
    }

    /**func_800821AC*/
    private updateMole(object: Entity): void {
        if (object.state !== 0) {
            this.updateMoleStates(object);
            this.updateMoleMovement(object);

            //Collided with player
            this.checkMoleCollisionWithPlayer(object);
        }
    }

    /**func_80081AFC*/
    private updateMoleStates(object: Entity): void {
        switch (object.state) {
            case 0x1:
                this.initMole(object);
                break;
            case 0x2:
                if (object.timer <= 0) {
                    object.setBehaviorAndState(2, 1);
                    object.advanceState();
                    object.setFlags(EntityFlags.IsCollisionActive);
                } else {
                    object.timer -= DELTA_TIME;
                }
                break;
            case 0x3:
                if (object.actionState === 0) {
                    object.setBehaviorAndState(2, 4);
                    this.spawnDirtParticles(object);
                    object.advanceState();
                }
                break;
            case 0x4:
                if (object.textureLoopForward(1, 6, 1, 2, 0)) {
                    object.setState(0x64);
                }
                break;
            case 0xA:
                object.textureLoopForward(1, 6, 1, 1, -1);
                if (object.actionState === 0) {
                    object.setState(0x64);
                }
                break;
            case 0x64:
                if (object.actionState === 0) {
                    object.clearFlags(EntityFlags.IsCollisionActive);
                    object.resetAllStates();
                    object.isInitialized = false;
                }
                break;
            default:
                break;
        }

        if (object.state >= 2) {
            object.updateActiveTexture();
        }
    }

    /**func_80081D34*/
    private checkMoleCollisionWithPlayer(object: Entity): void {

        if (object.isFlagActive(EntityFlags.IsCollisionActive)) {

            const verticalDist = Math.abs(object.pos[1] - this.globals.cameraPos[1]);

            if ((verticalDist < 10) && IsTargetInRangeXZ(object.pos, this.globals.cameraPos, object.boundingBoxSize)) {
                object.direction[1] = calcTargetAngleY(this.globals.cameraPos, object.pos);
                object.velocity[1] = (this.globals.cameraSpeed / 2) + 3.0;
                object.speed.value = this.globals.cameraSpeed + 1.0;

                if (object.velocity[1] >= 5.0) {
                    object.velocity[1] = 5.0;
                }

                if (object.speed.value >= 4.0) {
                    object.velocity[1] = 4.0;
                }

                object.clearFlags(EntityFlags.IsCollisionActive);
                object.resetAllActionStates();
                object.setOriginPosition(object.pos[0], object.pos[1], object.pos[2]);
                object.setOffset(0.0, 0.0, 0.0);
                object.setBehaviorAndState(2, 10);
                object.setState(10);
            }
        }
    }

    /**func_80081A88*/
    private updateMoleMovement(object: Entity): void {
        switch (object.actionBehaviorType) {
            case 0:
                break;
            case 1:
                // Unused
                //this.func_8008B724(object);
                break;
            case 2:
                this.updateMoleJump(object);
                break;
        }
        object.updatePosition();
    }

    /**func_80081924*/
    private updateMoleJump(object: Entity): void {
        switch (object.actionState) {
            case 1:
                if (object.stepUpToTargetV(object.offset, 1, 9.0, 0.7)) {
                    object.advanceActionState();
                }
                break;
            case 2:
                object.runActionTimerAdvance(10);
                break;
            case 3:
                if (object.stepDownToTargetV(object.offset, 1, 3.0, 1.0)) {
                    object.resetAllActionStates();
                }
                break;
            case 4:
                object.stepUpwardVelocityToTarget(3.6, 0.25, 0.0);
                break;
            case 5:
                object.resetAllActionStates();
                break;
            case 10:
                object.orientation[2] += 0x1000 * DELTA_TIME;
                object.velocity[1] -= 0.184 * DELTA_TIME;

                object.calcForwardVelocity();
                object.applyVelocityToOffsetXYZ();

                if (object.pos[1] <= -10.0) {
                    object.resetAllActionStates();
                }
                break;
            default:
                break;
        }

        object.updatePosition();
    }
}