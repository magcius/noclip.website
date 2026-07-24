import { mat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { RSPSharedOutput, Vertex } from '../BanjoKazooie/f3dex.js';
import { ImageFormat, ImageSize, TextFilt } from '../Common/N64/Image.js';
import { OtherModeH_CycleType, OtherModeH_Layout } from '../Common/N64/RDP.js';
import { assert } from '../util.js';
import { AnimatedTexture, RSP_Geometry, RSPOutput, RSPState, runDL_F3DEX2 } from './f3dex2.js';

export interface SetupActor {
    type: number;
    position: vec3;
    scale: number;
    rotationY: number;
    lightSpeed: number;
    lightColor: readonly [number, number, number];
    lightCone: readonly [number, number];
}

export interface ActorAnimationPose {
    boneAngles: readonly number[];
}

export interface ActorAnimation {
    playbackRate: number;
    frameCount: number;
    rotations: readonly Int16Array[];
}

export interface ActorSkeleton {
    offsets: vec3[];
    parents: number[];
}

export const actorModelScale = 0.15;

export interface SkeletalActorAnimation {
    firstVertex: number;
    vertexCount: number;
    speed: number;
    sourcePositions: Float32Array;
    matrixIndices: Uint8Array;
    boneOffsets: vec3[];
    boneParents: number[];
    sourceAnimation: ActorAnimation;
}

export interface SkeletalActorMesh {
    rspState: RSPState;
    rspOutput: RSPOutput;
    animation: SkeletalActorAnimation;
    actor: SetupActor;
}

export interface ActorRenderDefinition {
    model: number;
    animation: number | null;
    animationSpeed: number | 'setup';
    renderer: 'skeletal';
    lightBone?: number;
    rotationYSpeed?: number;
    positionYAmplitude?: number;
}

export function getActorRenderDefinition(type: number, model: number): ActorRenderDefinition | null {
    // Behavior-specific animation overrides. Actors without an override still
    // render in their neutral skeletal pose, so new setup types opt in by
    // default as soon as the extractor can resolve a nonzero model.
    if (type === 0x10)
        return { model: 0x81, animation: 0x402, animationSpeed: 'setup', renderer: 'skeletal', lightBone: 2 };
    if (type === 0x2A)
        return { model: 0x97, animation: 0x402, animationSpeed: 'setup', renderer: 'skeletal', lightBone: 2 };
    // Setup actor 0x77 becomes ACTOR_BOOMBOX (0x87) after the engine adds
    // 0x10. func_global_asm_806A1F64 selects animation 0x63F during normal
    // gameplay (0x640 in cutscenes) and passes an 8.0 speed multiplier.
    if (type === 0x77)
        return { model: 0x64, animation: 0x63F, animationSpeed: 8.0, renderer: 'skeletal' };
    // Setup actor 0x52 becomes the tag-barrel actor 0x62 after the engine's
    // +0x10 type lookup. World/Troff swap barrels 0x78 and 0x79 use thin
    // wrappers around the same behavior. func_global_asm_8068412C advances
    // their 12-bit yaw and vertical bob phase by 0x32 every update while the
    // barrel is not entered. The bob is centered on its setup Y with an
    // amplitude of five game units.
    if ((type === 0x52 || type === 0x78 || type === 0x79) && model !== 0)
        return {
            model,
            animation: null,
            animationSpeed: 0,
            renderer: 'skeletal',
            rotationYSpeed: 0x32,
            positionYAmplitude: 5,
        };
    if (model === 0)
        return null;
    return { model, animation: null, animationSpeed: 0, renderer: 'skeletal' };
}

const warnedAnimationFeatures = new Set<string>();

function warnAnimationFeatureOnce(feature: string, animationID: number, message: string): void {
    if (warnedAnimationFeatures.has(feature))
        return;
    warnedAnimationFeatures.add(feature);
    console.warn(`[DK64 actor] animation 0x${animationID.toString(16)}: ${message}`);
}

export function parseActorAnimation(data: ArrayBufferSlice, boneCount: number, animationID: number): ActorAnimation {
    const view = data.createDataView();
    const flags = view.getUint16(0x04, false);
    const frameCount = view.getUint8(0x12);
    const frameStride = view.getUint8(0x13);
    // func_global_asm_80614130 adds six to this offset after loading the
    // table-11 file. func_global_asm_80619C2C then indexes it by frameStride.
    const frameDataStart = view.getUint16(0x06, false) + 6;
    const animationBoneCount = view.getUint8(0x11) - 1;
    const decodedBoneCount = Math.min(boneCount, animationBoneCount);
    const rootChannelBits = [
        view.getUint8(0x0E),
        view.getUint8(0x0F),
        view.getUint8(0x10),
    ];
    const rootChannelBases = [
        view.getInt16(0x08, false),
        view.getInt16(0x0A, false),
        view.getInt16(0x0C, false),
    ];
    const initialBitOffset = rootChannelBits[0] + rootChannelBits[1] + rootChannelBits[2];
    const rotations: Int16Array[] = [];

    // TODO: Decode and apply the root XYZ translation channels handled at
    // 80619CB0..80619D94. Their packed bits precede the bone rotations.
    if (rootChannelBits.some((bits) => bits !== 0) || rootChannelBases.some((base) => base !== 0)) {
        warnAnimationFeatureOnce(
            'root-translation',
            animationID,
            'root translation channels are present but are not applied',
        );
    }
    // TODO: Determine and implement the remaining animation-header flags.
    // Flag 0x0002 is the only value present in the currently archived actor
    // animation; func_global_asm_80619C2C also branches on flag 0x0020.
    if ((flags & ~0x0002) !== 0) {
        warnAnimationFeatureOnce(
            'animation-flags',
            animationID,
            `unsupported header flags 0x${(flags & ~0x0002).toString(16)} are set`,
        );
    }
    // The frame stride lets us safely ignore rotations for bones absent from
    // the model, but they are not available to attachments or effects.
    // TODO: Retain extra animation bones when actor attachments require them.
    if (animationBoneCount > boneCount) {
        warnAnimationFeatureOnce(
            'extra-bones',
            animationID,
            `${animationBoneCount - boneCount} animation bone(s) are not present in the model skeleton and will be ignored`,
        );
    }

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
        const frameRotations = new Int16Array(boneCount * 3);
        let bitOffset = (frameDataStart + frame * frameStride) * 8 + initialBitOffset;
        for (let bone = 0; bone < decodedBoneCount; bone++) {
            for (let axis = 0; axis < 3; axis++) {
                const descriptor = view.getUint16(0x14 + bone * 6 + axis * 2, false);
                const bitCount = descriptor & 0x0F;
                // TODO: Preserve and apply X/Y rotations. The current actor
                // matrix path only consumes the Z channel used by 0x402.
                if (axis < 2 && descriptor !== 0) {
                    warnAnimationFeatureOnce(
                        'xy-rotation',
                        animationID,
                        'bone X/Y rotation channels are present but are not applied',
                    );
                }
                // Non-extended rotations store a signed base in the upper
                // 12 bits and a packed delta with five fractional zero bits.
                // See 80619DA8..80619E2C.
                // TODO: Decode the extra descriptor word used when bit 0x10
                // is set, following 80619E60..80619EF0.
                if ((descriptor & 0x10) !== 0) {
                    warnAnimationFeatureOnce(
                        'extended-descriptor',
                        animationID,
                        'extended rotation descriptors are not supported',
                    );
                }
                assert((descriptor & 0x10) === 0);
                const sample = readBits(bitOffset, bitCount);
                bitOffset += bitCount;
                frameRotations[bone * 3 + axis] = toS16((descriptor & 0xFFF0) + (sample << 5));
            }
        }
        assert(bitOffset <= (frameDataStart + (frame + 1) * frameStride) * 8);
        rotations.push(frameRotations);
    }

    return {
        playbackRate: view.getFloat32(0x00, false),
        frameCount,
        rotations,
    };
}

export function sampleActorAnimationPose(animation: ActorAnimation, speed: number, tick: number): ActorAnimationPose {
    const animationFrame = ((tick * speed * animation.playbackRate) % animation.frameCount + animation.frameCount) % animation.frameCount;
    const frame = Math.floor(animationFrame);
    const nextFrame = (frame + 1) % animation.frameCount;
    const t = animationFrame - frame;
    const boneCount = animation.rotations[frame].length / 3;
    const boneAngles: number[] = [];
    for (let bone = 0; bone < boneCount; bone++) {
        const a = animation.rotations[frame][bone * 3 + 2];
        const b = animation.rotations[nextFrame][bone * 3 + 2];
        boneAngles.push((a + (b - a) * t) * Math.PI * 2 / 0x10000);
    }
    return { boneAngles };
}

export function parseSetupActors(data: ArrayBufferSlice): SetupActor[] {
    const view = data.createDataView();
    let offs = 4 + view.getUint32(0, false) * 0x30;
    const mysteryCount = view.getUint32(offs, false);
    offs += 4 + mysteryCount * 0x24;
    const actorCount = view.getUint32(offs, false);
    offs += 4;
    const actors: SetupActor[] = [];
    for (let i = 0; i < actorCount; i++, offs += 0x38) {
        actors.push({
            type: view.getUint16(offs + 0x32, false),
            position: vec3.fromValues(
                view.getFloat32(offs + 0x00, false),
                view.getFloat32(offs + 0x04, false),
                view.getFloat32(offs + 0x08, false),
            ),
            scale: view.getFloat32(offs + 0x0C, false),
            rotationY: view.getInt16(offs + 0x30, false),
            lightSpeed: view.getFloat32(offs + 0x10, false),
            // The behavior passes these s32 fields through u16 temporaries,
            // and createLight finally truncates them to u8.
            lightColor: [
                view.getInt32(offs + 0x14, false) & 0xFF,
                view.getInt32(offs + 0x18, false) & 0xFF,
                view.getInt32(offs + 0x1C, false) & 0xFF,
            ],
            lightCone: [
                view.getFloat32(offs + 0x20, false),
                view.getFloat32(offs + 0x24, false),
            ],
        });
    }
    return actors;
}

function initializeActorDL(state: RSPState): void {
    // func_global_asm_80630DCC emits D9FFFFFF 00200001 before the actor:
    // Z-buffer and smooth shading are enabled, but G_SHADE/G_LIGHTING are not.
    // The lantern's TEXEL0 * SHADE combiner consequently receives white SHADE,
    // which is what makes the texture appear self-lit.
    state.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADING_SMOOTH);
    state.gDPSetOtherModeL(0, 29, 0x0C192078);
    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    state.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
    // func_global_asm_80630DCC emits an opaque primitive color before the
    // actor's display list. Without it this combiner starts from black.
    state.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);
}

function installActorVisibilitySegments(
    geometry: ArrayBufferSlice,
    view: DataView,
    displayListStart: number,
    displayListEnd: number,
    segmentBuffers: ArrayBufferSlice[],
): void {
    for (let offs = displayListStart; offs + 8 <= displayListEnd; offs += 8) {
        const w0 = view.getUint32(offs, false);
        const w1 = view.getUint32(offs + 4, false);
        // func_global_asm_8061324C recognizes no-push display-list branches
        // paired with a G_SNOOP marker. func_global_asm_80614C38 then points
        // the target segment either just past this branch (visible) or at the
        // marker (hidden), according to the actor's hand-state bits.
        if ((w0 >>> 24) !== 0xDE || ((w0 >>> 16) & 0xFF) !== 1)
            continue;
        const segment = w1 >>> 24;
        let hasMarker = false;
        for (let marker = displayListStart; marker + 8 <= displayListEnd; marker += 8) {
            if (view.getUint32(marker, false) === 0 && view.getUint32(marker + 4, false) === segment) {
                hasMarker = true;
                break;
            }
        }
        if (hasMarker && segmentBuffers[segment] === undefined)
            segmentBuffers[segment] = geometry.slice(offs + 8);
    }
}

function parseActorAnimatedTextures(
    geometry: ArrayBufferSlice,
    textureBuffers: ArrayBufferSlice[],
    actor: SetupActor,
): AnimatedTexture[] {
    const view = geometry.createDataView();
    const runtimeBase = view.getUint32(0x00, false);
    const descriptorPointer = view.getUint32(0x10, false);
    if (descriptorPointer === 0)
        return [];
    let offs = descriptorPointer - runtimeBase + 0x28;
    if (offs < 0 || offs + 2 > view.byteLength)
        return [];
    const descriptorCount = view.getUint16(offs, false);
    offs += 2;
    const animatedTextures: AnimatedTexture[] = [];
    for (let descriptor = 0; descriptor < descriptorCount; descriptor++) {
        if (offs + 6 > view.byteLength)
            break;
        const frameCount = view.getUint16(offs, false);
        const segment = view.getUint16(offs + 2, false);
        const enabled = view.getUint16(offs + 4, false) !== 0;
        offs += 6;
        const frameIDs: number[] = [];
        for (let frame = 0; frame < frameCount && offs + 2 <= view.byteLength; frame++, offs += 2)
            frameIDs.push(view.getUint16(offs, false));
        if (!enabled)
            continue;
        // func_global_asm_8067E784 starts the Tiny and Chunky size-barrel
        // sequence at 0.5 frames per tick and restricts it to frames 0..8.
        const isSizeBarrel = actor.type === 0x18 || actor.type === 0x09;
        const activeFrameIDs = isSizeBarrel ? frameIDs.slice(0, 9) : frameIDs.slice(0, 1);
        const frames = activeFrameIDs
            .map((textureID) => textureBuffers[textureID])
            .filter((frame): frame is ArrayBufferSlice => frame !== undefined);
        if (frames.length > 0) {
            animatedTextures.push({
                segment,
                group: descriptor,
                frames,
                frameDuration: isSizeBarrel ? 2 : 0,
            });
        }
    }
    return animatedTextures;
}

export function parseActorSkeleton(data: ArrayBufferSlice): ActorSkeleton {
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

export function buildSkeletalActorMesh(
    geometry: ArrayBufferSlice,
    animationData: ArrayBufferSlice | null,
    animationID: number | null,
    animationSpeed: number,
    actor: SetupActor,
    textureBuffers: ArrayBufferSlice[],
    sharedOutput: RSPSharedOutput,
): SkeletalActorMesh | null {
    const view = geometry.createDataView();
    const runtimeBase = view.getUint32(0x00, false);
    const displayListCount = view.getUint8(0x21);
    const displayListTable = view.getUint32(0x04, false) - runtimeBase + 0x28;
    const segmentBuffers: ArrayBufferSlice[] = [];
    segmentBuffers[0x03] = geometry.slice(0x28);
    if (displayListCount > 0) {
        const firstDisplayList = view.getUint32(displayListTable, false) - runtimeBase + 0x28;
        installActorVisibilitySegments(geometry, view, firstDisplayList, displayListTable, segmentBuffers);
    }
    const animatedTextures = parseActorAnimatedTextures(geometry, textureBuffers, actor);
    const state = new RSPState(textureBuffers, segmentBuffers, sharedOutput, animatedTextures);
    initializeActorDL(state);
    const firstVertex = sharedOutput.vertices.length;
    for (let i = 0; i < displayListCount; i++) {
        const pointer = view.getUint32(displayListTable + i * 4, false);
        runDL_F3DEX2(state, 0x03000000 | (pointer - runtimeBase));
    }
    const output = state.finish();
    if (output === null) {
        console.warn(`[DK64 actor] skeletal model produced no draw calls`);
        return null;
    }
    for (const drawCall of output.drawCalls)
        drawCall.useVertexColors = false;

    const vertexCount = sharedOutput.vertices.length - firstVertex;
    const sourcePositions = new Float32Array(vertexCount * 3);
    const matrixIndices = new Uint8Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        const vertex = sharedOutput.vertices[firstVertex + i];
        sourcePositions[i * 3 + 0] = vertex.x;
        sourcePositions[i * 3 + 1] = vertex.y;
        sourcePositions[i * 3 + 2] = vertex.z;
        matrixIndices[i] = state.vertexMatrixIndices[firstVertex + i] ?? 0;
    }
    const skeleton = parseActorSkeleton(geometry);
    if (skeleton.offsets.length === 0) {
        // Static actor models still select segment-4 matrix zero in their
        // display lists. The engine supplies the actor's identity/root matrix
        // there; use a synthetic root so the shared CPU skinning path applies
        // the same no-op local transform.
        skeleton.offsets.push(vec3.create());
        skeleton.parents.push(-1);
    }
    const sourceAnimation = animationData !== null && animationID !== null
        ? parseActorAnimation(animationData, skeleton.offsets.length, animationID)
        : {
            playbackRate: 0,
            frameCount: 1,
            rotations: [new Int16Array(skeleton.offsets.length * 3)],
        };
    return {
        rspState: state,
        rspOutput: output,
        actor,
        animation: {
            firstVertex,
            vertexCount,
            speed: animationSpeed,
            sourcePositions,
            matrixIndices,
            boneOffsets: skeleton.offsets,
            boneParents: skeleton.parents,
            sourceAnimation,
        },
    };
}

const currentBoneMatrices: mat4[] = [];
const boneOrigin = vec3.create();
const sourcePosition = vec3.create();
const skinnedPosition = vec3.create();

function buildActorBoneMatrices(skeleton: ActorSkeleton, pose: ActorAnimationPose): void {
    currentBoneMatrices.length = skeleton.offsets.length;
    for (let i = 0; i < skeleton.offsets.length; i++) {
        const matrix = currentBoneMatrices[i] ?? mat4.create();
        currentBoneMatrices[i] = matrix;
        mat4.identity(matrix);
        const parent = skeleton.parents[i];
        if (parent >= 0)
            mat4.copy(matrix, currentBoneMatrices[parent]);
        mat4.translate(matrix, matrix, skeleton.offsets[i]);
        mat4.rotateZ(matrix, matrix, pose.boneAngles[i] ?? 0);
    }
}

export function sampleActorBonePosition(
    dst: vec3,
    skeleton: ActorSkeleton,
    sourceAnimation: ActorAnimation,
    speed: number,
    tick: number,
    boneIndex: number,
): void {
    assert(boneIndex >= 0 && boneIndex < skeleton.offsets.length);
    const pose = sampleActorAnimationPose(sourceAnimation, speed, tick);
    buildActorBoneMatrices(skeleton, pose);
    vec3.transformMat4(dst, boneOrigin, currentBoneMatrices[boneIndex]);
}

export function updateSkeletalActor(
    animation: SkeletalActorAnimation,
    vertices: Vertex[],
    vertexBufferData: Float32Array,
    tick: number,
): void {
    const pose = sampleActorAnimationPose(animation.sourceAnimation, animation.speed, tick);
    buildActorBoneMatrices({
        offsets: animation.boneOffsets,
        parents: animation.boneParents,
    }, pose);

    for (let i = 0; i < animation.vertexCount; i++) {
        const bone = Math.min(animation.matrixIndices[i], currentBoneMatrices.length - 1);
        vec3.set(sourcePosition,
            animation.sourcePositions[i * 3 + 0],
            animation.sourcePositions[i * 3 + 1],
            animation.sourcePositions[i * 3 + 2],
        );
        // Actor display lists select a segment-4 matrix before loading
        // bone-local vertices. The game's generated bone matrix is therefore
        // applied directly; there is no inverse-bind correction.
        vec3.transformMat4(skinnedPosition, sourcePosition, currentBoneMatrices[bone]);
        const vertexIndex = animation.firstVertex + i;
        vertices[vertexIndex].x = skinnedPosition[0];
        vertices[vertexIndex].y = skinnedPosition[1];
        vertices[vertexIndex].z = skinnedPosition[2];
        vertexBufferData[vertexIndex * 10 + 0] = skinnedPosition[0];
        vertexBufferData[vertexIndex * 10 + 1] = skinnedPosition[1];
        vertexBufferData[vertexIndex * 10 + 2] = skinnedPosition[2];
    }
}
