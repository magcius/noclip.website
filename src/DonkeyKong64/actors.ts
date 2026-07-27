import { mat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import type { Vertex } from '../BanjoKazooie/f3dex.js';
import { ImageFormat, ImageSize, TextFilt } from '../Common/N64/Image.js';
import { OtherModeH_CycleType, OtherModeH_Layout } from '../Common/N64/RDP.js';
import { AABB } from '../Geometry.js';
import { lerp, MathConstants } from '../MathHelpers.js';
import { AnimatedTexture, RSP_Geometry, RSPOutput, RSPSharedOutput, RSPState, runDL_F3DEX2 } from './f3dex2.js';

interface ActorAnimation {
    playbackRate: number;
    rotations: readonly Int16Array[];
}

interface ActorSkeleton {
    offsets: vec3[];
    parents: number[];
}

export const actorModelScale = 0.15;

export class ActorAnimationPose {
    public boneMatrices: mat4[];
    private skeleton: ActorSkeleton;
    private animation: ActorAnimation;
    private lastTick = -1;

    constructor(geometryBuffer: ArrayBufferSlice, animationData: ArrayBufferSlice | null, private speed: number) {
        this.skeleton = parseActorSkeleton(geometryBuffer);
        if (this.skeleton.offsets.length === 0) {
            this.skeleton.offsets.push(vec3.create());
            this.skeleton.parents.push(-1);
        }
        this.animation = animationData !== null
            ? parseActorAnimation(animationData, this.skeleton.offsets.length)
            : {
                playbackRate: 0,
                rotations: [new Int16Array(this.skeleton.offsets.length)],
            };
        this.boneMatrices = this.skeleton.offsets.map(() => mat4.create());
    }

    public update(tick: number): void {
        if (this.lastTick === tick)
            return;
        const boneAngles = sampleActorAnimation(this.animation, this.speed, tick);
        for (let i = 0; i < this.skeleton.offsets.length; i++) {
            const boneMatrix = this.boneMatrices[i];
            mat4.identity(boneMatrix);
            const parentIndex = this.skeleton.parents[i];
            if (parentIndex >= 0)
                mat4.copy(boneMatrix, this.boneMatrices[parentIndex]);
            mat4.translate(boneMatrix, boneMatrix, this.skeleton.offsets[i]);
            mat4.rotateZ(boneMatrix, boneMatrix, boneAngles[i] ?? 0);
        }
        this.lastTick = tick;
    }

    public computeBoundingBox(vertices: readonly Vertex[]): AABB {
        let radius = 0;
        for (let i = 0; i < vertices.length; i++) {
            const vertex = vertices[i];
            let vertexRadius = Math.hypot(
                vertex.x,
                vertex.y,
                vertex.z,
            );
            let boneIndex = Math.min(vertex.matrixIndex, this.skeleton.offsets.length - 1);
            for (let depth = 0; boneIndex >= 0 && depth < this.skeleton.offsets.length; depth++) {
                const offset = this.skeleton.offsets[boneIndex];
                vertexRadius += Math.hypot(offset[0], offset[1], offset[2]);
                boneIndex = this.skeleton.parents[boneIndex];
            }
            radius = Math.max(radius, vertexRadius);
        }
        return new AABB(
            -radius, -radius, -radius,
            radius, radius, radius,
        );
    }
}

export interface ActorAnimationState {
    pose: ActorAnimationPose;
    boundingBox: AABB;
}

export interface ActorGeometry {
    rspOutput: RSPOutput;
    animation: ActorAnimationState;
}

export interface ActorRenderDefinition {
    model: number;
    animation: number | null;
    animationSpeed: number | 'setup';
    lightBone?: number;
    rotationYSpeed?: number;
    positionYAmplitude?: number;
}

export function getActorRenderDefinition(type: number, model: number): ActorRenderDefinition | null {
    if (type === 0x10)
        return { model: 0x81, animation: 0x402, animationSpeed: 'setup', lightBone: 2 };
    if (type === 0x2A)
        return { model: 0x97, animation: 0x402, animationSpeed: 'setup', lightBone: 2 };
    if (model === 0)
        return null;
    // barrels yaw&bob, see func_global_asm_8068412C
    if (type === 0x52 || type === 0x78 || type === 0x79)
        return {
            model,
            animation: null,
            animationSpeed: 0,
            rotationYSpeed: 0x32,
            positionYAmplitude: 5,
        };
    return { model, animation: null, animationSpeed: 0 };
}

function parseActorAnimation(data: ArrayBufferSlice, boneCount: number): ActorAnimation {
    const view = data.createDataView();
    const frameCount = view.getUint8(0x12);
    const frameStride = view.getUint8(0x13);
    // See func_global_asm_80614130 + func_global_asm_80619C2C for reference.
    const frameDataStart = view.getUint16(0x06, false) + 6;
    const rotations: Int16Array[] = [];

    const readBits = (bitOffset: number, bitCount: number): number => {
        let value = 0;
        for (let i = 0; i < bitCount; i++) {
            const offs = bitOffset + i;
            value = (value << 1) | ((view.getUint8(offs >>> 3) >>> (7 - (offs & 7))) & 1);
        }
        return value;
    };
    const toS16 = (value: number): number => (value << 16) >> 16;

    for (let frame = 0; frame < frameCount; frame++) {
        const frameRotations = new Int16Array(boneCount);
        let bitOffset = (frameDataStart + frame * frameStride) * 8;
        for (let bone = 0; bone < boneCount; bone++) {
            for (let axis = 0; axis < 3; axis++) {
                const descriptor = view.getUint16(0x14 + bone * 6 + axis * 2, false);
                const bitCount = descriptor & 0x0F;
                const sample = readBits(bitOffset, bitCount);
                bitOffset += bitCount;
                if (axis === 2)
                    frameRotations[bone] = toS16((descriptor & 0xFFF0) + (sample << 5));
            }
        }
        rotations.push(frameRotations);
    }

    return {
        playbackRate: view.getFloat32(0x00, false),
        rotations,
    };
}

function sampleActorAnimation(animation: ActorAnimation, speed: number, tick: number): number[] {
    const frameCount = animation.rotations.length;
    const animationFrame = ((tick * speed * animation.playbackRate) % frameCount + frameCount) % frameCount;
    const frame = Math.floor(animationFrame);
    const nextFrame = (frame + 1) % frameCount;
    const t = animationFrame - frame;
    const boneCount = animation.rotations[frame].length;
    const boneAngles: number[] = [];
    for (let bone = 0; bone < boneCount; bone++) {
        const a = animation.rotations[frame][bone];
        const b = animation.rotations[nextFrame][bone];
        boneAngles.push(lerp(a, b, t) * MathConstants.TAU / 0x10000);
    }
    return boneAngles;
}

function initializeActorDL(state: RSPState): void {
    // from func_global_asm_8063A968 + func_global_asm_80630DCC
    state.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    state.gDPSetOtherModeL(0, 29, 0x0C192078);
    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    state.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
    state.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);
}

function installDefaultActorPartSegments(
    geometryBuffer: ArrayBufferSlice,
    view: DataView,
    displayListStart: number,
    displayListEnd: number,
    segmentBuffers: ArrayBufferSlice[],
): void {
    const markers = new Set<number>();
    for (let offs = displayListStart; offs + 8 <= displayListEnd; offs += 8) {
        if (view.getUint32(offs, false) === 0)
            markers.add(view.getUint32(offs + 4, false));
    }
    for (let offs = displayListStart; offs + 8 <= displayListEnd; offs += 8) {
        const w0 = view.getUint32(offs, false);
        const w1 = view.getUint32(offs + 4, false);
        // from func_global_asm_8061324C + func_global_asm_80614C38
        if ((w0 >>> 24) !== 0xDE || ((w0 >>> 16) & 0xFF) !== 1)
            continue;
        const segment = w1 >>> 24;
        if (markers.has(segment) && segmentBuffers[segment] === undefined)
            segmentBuffers[segment] = geometryBuffer.slice(offs + 8);
    }
}

function parseActorAnimatedTextures(
    geometryBuffer: ArrayBufferSlice,
    textureBuffers: ArrayBufferSlice[],
    actorType: number,
): AnimatedTexture[] {
    const view = geometryBuffer.createDataView();
    const runtimeBase = view.getUint32(0x00, false);
    const descriptorPointer = view.getUint32(0x10, false);
    if (descriptorPointer === 0)
        return [];
    let offs = descriptorPointer - runtimeBase + 0x28;
    const descriptorCount = view.getUint16(offs, false);
    offs += 2;
    const animatedTextures: AnimatedTexture[] = [];
    // func_global_asm_8067E784 modifies barrel animations
    const activeFrameCount = actorType === 0x18 || actorType === 0x09 ? 9 : 1;
    for (let descriptor = 0; descriptor < descriptorCount; descriptor++) {
        const frameCount = view.getUint16(offs, false);
        const segment = view.getUint16(offs + 2, false);
        offs += 6;
        const frameIDs: number[] = [];
        for (let frame = 0; frame < frameCount; frame++, offs += 2) {
            if (frame < activeFrameCount)
                frameIDs.push(view.getUint16(offs, false));
        }
        const frames = frameIDs.map((textureID) => textureBuffers[textureID]!);
        animatedTextures.push({
            segment,
            group: descriptor,
            frames,
            frameDuration: activeFrameCount > 1 ? 2 : 0,
        });
    }
    return animatedTextures;
}

function parseActorSkeleton(data: ArrayBufferSlice): ActorSkeleton {
    const view = data.createDataView();
    const runtimeBase = view.getUint32(0x00, false);
    const boneCount = view.getUint8(0x20);
    const skeletonStart = view.getUint32(0x08, false) - runtimeBase + 0x28;
    const offsets: vec3[] = [];
    const parents: number[] = [];
    for (let i = 0; i < boneCount; i++) {
        const offs = skeletonStart + i * 0x10;
        parents.push(view.getUint8(offs) === 0xFF ? -1 : view.getUint8(offs));
        offsets.push(vec3.fromValues(
            view.getFloat32(offs + 0x04, false),
            view.getFloat32(offs + 0x08, false),
            view.getFloat32(offs + 0x0C, false),
        ));
    }
    return { offsets, parents };
}

export function buildActorGeometry(
    geometryBuffer: ArrayBufferSlice,
    pose: ActorAnimationPose,
    actorType: number,
    textureBuffers: ArrayBufferSlice[],
    sharedOutput: RSPSharedOutput,
): ActorGeometry {
    const view = geometryBuffer.createDataView();
    const runtimeBase = view.getUint32(0x00, false);
    const displayListCount = view.getUint8(0x21);
    const displayListTableOffs = view.getUint32(0x04, false) - runtimeBase + 0x28;
    const segmentBuffers: ArrayBufferSlice[] = [];
    segmentBuffers[0x03] = geometryBuffer.slice(0x28);
    if (displayListCount > 0) {
        const firstDisplayList = view.getUint32(displayListTableOffs, false) - runtimeBase + 0x28;
        installDefaultActorPartSegments(geometryBuffer, view, firstDisplayList, displayListTableOffs, segmentBuffers);
    }
    const animatedTextures = parseActorAnimatedTextures(geometryBuffer, textureBuffers, actorType);
    const state = new RSPState(textureBuffers, segmentBuffers, sharedOutput, animatedTextures);
    initializeActorDL(state);
    const firstVertex = sharedOutput.vertices.length;
    for (let i = 0; i < displayListCount; i++) {
        const pointer = view.getUint32(displayListTableOffs + i * 4, false);
        runDL_F3DEX2(state, 0x03000000 | (pointer - runtimeBase));
    }
    const output = state.finish()!;

    return {
        rspOutput: output,
        animation: {
            pose,
            boundingBox: pose.computeBoundingBox(sharedOutput.vertices.slice(firstVertex)),
        },
    };
}
