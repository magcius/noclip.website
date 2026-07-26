import { mat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { Vertex } from '../BanjoKazooie/f3dex.js';
import { ImageFormat, ImageSize, TextFilt } from '../Common/N64/Image.js';
import { OtherModeH_CycleType, OtherModeH_Layout } from '../Common/N64/RDP.js';
import type { AABB } from '../Geometry.js';
import { lerp, MathConstants } from '../MathHelpers.js';
import { computeSkeletalAnimationBoundingBox } from './cull.js';
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

export interface ActorAnimationPose {
    speed: number;
    skeleton: ActorSkeleton;
    animation: ActorAnimation;
    boneMatrices: mat4[];
    lastTick: number;
}

export interface ActorAnimationState {
    firstVertex: number;
    vertexCount: number;
    sourcePositions: Float32Array;
    boneIndices: Uint8Array;
    pose: ActorAnimationPose;
    boundingBox: AABB;
}

export interface ActorMesh {
    rspState: RSPState;
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
    geometry: ArrayBufferSlice,
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
            segmentBuffers[segment] = geometry.slice(offs + 8);
    }
}

function parseActorAnimatedTextures(
    geometry: ArrayBufferSlice,
    textureBuffers: ArrayBufferSlice[],
    actorType: number,
): AnimatedTexture[] {
    const view = geometry.createDataView();
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

export function createActorAnimationPose(
    geometry: ArrayBufferSlice,
    animationData: ArrayBufferSlice | null,
    speed: number,
): ActorAnimationPose {
    const skeleton = parseActorSkeleton(geometry);
    if (skeleton.offsets.length === 0) {
        skeleton.offsets.push(vec3.create());
        skeleton.parents.push(-1);
    }
    const animation = animationData !== null
        ? parseActorAnimation(animationData, skeleton.offsets.length)
        : {
            playbackRate: 0,
            rotations: [new Int16Array(skeleton.offsets.length)],
        };
    return {
        speed,
        skeleton,
        animation,
        boneMatrices: skeleton.offsets.map(() => mat4.create()),
        lastTick: -1,
    };
}

export function buildActorMesh(
    geometry: ArrayBufferSlice,
    pose: ActorAnimationPose,
    actorType: number,
    textureBuffers: ArrayBufferSlice[],
    sharedOutput: RSPSharedOutput,
): ActorMesh {
    const view = geometry.createDataView();
    const runtimeBase = view.getUint32(0x00, false);
    const displayListCount = view.getUint8(0x21);
    const displayListTableOffs = view.getUint32(0x04, false) - runtimeBase + 0x28;
    const segmentBuffers: ArrayBufferSlice[] = [];
    segmentBuffers[0x03] = geometry.slice(0x28);
    if (displayListCount > 0) {
        const firstDisplayList = view.getUint32(displayListTableOffs, false) - runtimeBase + 0x28;
        installDefaultActorPartSegments(geometry, view, firstDisplayList, displayListTableOffs, segmentBuffers);
    }
    const animatedTextures = parseActorAnimatedTextures(geometry, textureBuffers, actorType);
    const state = new RSPState(textureBuffers, segmentBuffers, sharedOutput, animatedTextures);
    initializeActorDL(state);
    const firstVertex = sharedOutput.vertices.length;
    for (let i = 0; i < displayListCount; i++) {
        const pointer = view.getUint32(displayListTableOffs + i * 4, false);
        runDL_F3DEX2(state, 0x03000000 | (pointer - runtimeBase));
    }
    const output = state.finish()!;

    const vertexCount = sharedOutput.vertices.length - firstVertex;
    const sourcePositions = new Float32Array(vertexCount * 3);
    const boneIndices = new Uint8Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        const vertex = sharedOutput.vertices[firstVertex + i];
        sourcePositions[i * 3 + 0] = vertex.x;
        sourcePositions[i * 3 + 1] = vertex.y;
        sourcePositions[i * 3 + 2] = vertex.z;
        boneIndices[i] = vertex.matrixIndex;
    }
    return {
        rspState: state,
        rspOutput: output,
        animation: {
            firstVertex,
            vertexCount,
            sourcePositions,
            boneIndices,
            pose,
            boundingBox: computeSkeletalAnimationBoundingBox(
                sourcePositions, boneIndices, pose.skeleton.offsets, pose.skeleton.parents,
            ),
        },
    };
}

export function updateActorPose(pose: ActorAnimationPose, tick: number): void {
    if (pose.lastTick === tick)
        return;
    const boneAngles = sampleActorAnimation(pose.animation, pose.speed, tick);
    for (let i = 0; i < pose.skeleton.offsets.length; i++) {
        const matrix = pose.boneMatrices[i];
        mat4.identity(matrix);
        const parent = pose.skeleton.parents[i];
        if (parent >= 0)
            mat4.copy(matrix, pose.boneMatrices[parent]);
        mat4.translate(matrix, matrix, pose.skeleton.offsets[i]);
        mat4.rotateZ(matrix, matrix, boneAngles[i] ?? 0);
    }
    pose.lastTick = tick;
}

export function updateActorAnimation(
    state: ActorAnimationState,
    vertices: Vertex[],
    vertexBufferData: Float32Array | null,
    vertexBufferFirstVertex: number,
    tick: number,
): void {
    updateActorPose(state.pose, tick);
    const sourcePosition = vec3.create();
    const skinnedPosition = vec3.create();

    for (let i = 0; i < state.vertexCount; i++) {
        const bone = state.boneIndices[i];
        vec3.set(sourcePosition,
            state.sourcePositions[i * 3 + 0],
            state.sourcePositions[i * 3 + 1],
            state.sourcePositions[i * 3 + 2],
        );
        vec3.transformMat4(skinnedPosition, sourcePosition, state.pose.boneMatrices[bone]);
        const vertexIndex = state.firstVertex + i;
        vertices[vertexIndex].x = skinnedPosition[0];
        vertices[vertexIndex].y = skinnedPosition[1];
        vertices[vertexIndex].z = skinnedPosition[2];
        if (vertexBufferData !== null) {
            const localVertex = (vertexIndex - vertexBufferFirstVertex) * 10;
            vertexBufferData[localVertex + 0] = skinnedPosition[0];
            vertexBufferData[localVertex + 1] = skinnedPosition[1];
            vertexBufferData[localVertex + 2] = skinnedPosition[2];
        }
    }
}
