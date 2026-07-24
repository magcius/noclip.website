import { mat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { RSPSharedOutput } from '../BanjoKazooie/f3dex.js';
import { ImageFormat, ImageSize } from '../Common/N64/Image.js';
import { OtherModeH_CycleType, OtherModeH_Layout } from '../Common/N64/RDP.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';
import { AABB } from '../Geometry.js';
import { Vec3UnitY } from '../MathHelpers.js';
import { assert, hexzero, nArray } from '../util.js';
import { AnimatedTexture, RSP_Geometry, RSPState, runDL_F3DEX2 } from './f3dex2.js';
import { initDL } from './material.js';
import { buildObjectLighting } from './light.js';
import type { ObjectLightingEnvironment } from './light.js';
import type { DK64Renderer, InstanceScript, Mesh, ROMData } from './scenes.js';
import { computeBillboardBoundingBox, computeMatrixAnimationBoundingBox } from './cull.js';

export interface SetupProp {
    id: number;
    type: number;
    position: vec3;
    scale: number;
    rotation: vec3;
}

export interface TerrainTriangle {
    vertices: [vec3, vec3, vec3];
    normal: vec3;
}

interface TerrainSurface {
    y: number;
    normal: vec3;
}

export function parseSetupProps(data: ArrayBufferSlice): SetupProp[] {
    const view = data.createDataView();
    const count = view.getUint32(0, false);
    const props: SetupProp[] = [];
    for (let i = 0; i < count; i++) {
        const offs = 4 + i * 0x30;
        props.push({
            id: view.getUint16(offs + 0x2A, false),
            type: view.getUint16(offs + 0x28, false),
            position: vec3.fromValues(
                view.getFloat32(offs + 0x00, false),
                view.getFloat32(offs + 0x04, false),
                view.getFloat32(offs + 0x08, false),
            ),
            scale: view.getFloat32(offs + 0x0C, false),
            rotation: vec3.fromValues(
                view.getFloat32(offs + 0x18, false),
                view.getFloat32(offs + 0x1C, false),
                view.getFloat32(offs + 0x20, false),
            ),
        });
    }
    return props;
}

export function buildTerrainTriangles(sharedOutput: RSPSharedOutput): TerrainTriangle[] {
    const triangles: TerrainTriangle[] = [];
    const indices = sharedOutput.indices;
    const vertices = sharedOutput.vertices;
    for (let i = 0; i + 2 < indices.length; i += 3) {
        const va = vertices[indices[i]];
        const vb = vertices[indices[i + 1]];
        const vc = vertices[indices[i + 2]];
        const a = vec3.fromValues(va.x, va.y, va.z);
        const b = vec3.fromValues(vb.x, vb.y, vb.z);
        const c = vec3.fromValues(vc.x, vc.y, vc.z);
        const ab = vec3.subtract(vec3.create(), b, a);
        const ac = vec3.subtract(vec3.create(), c, a);
        const normal = vec3.cross(vec3.create(), ab, ac);
        if (vec3.squaredLength(normal) < 0.0001 || Math.abs(normal[1]) < 0.0001)
            continue;
        vec3.normalize(normal, normal);
        if (normal[1] < 0)
            vec3.negate(normal, normal);
        triangles.push({ vertices: [a, b, c], normal });
    }
    return triangles;
}

function findTerrainSurface(triangles: TerrainTriangle[], x: number, z: number, rayStartY: number): TerrainSurface | null {
    let result: TerrainSurface | null = null;
    for (const triangle of triangles) {
        const [a, b, c] = triangle.vertices;
        const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(denominator) < 0.0001)
            continue;
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -0.0001 || wb < -0.0001 || wc < -0.0001)
            continue;
        const y = wa * a[1] + wb * b[1] + wc * c[1];
        if (y > rayStartY || (result !== null && y <= result.y))
            continue;
        result = { y, normal: triangle.normal };
    }
    return result;
}

interface PropMatrixAnimationNode {
    matrixIndex: number;
    transforms: Float32Array;
    baseMatrix: mat4;
    postMatrix: mat4;
    outputMatrix: mat4;
}

interface PropMatrixAnimationTrack {
    channel: number;
    nodes: PropMatrixAnimationNode[];
    timings: Uint8Array;
    speed: number;
    triggeredPlaybackPositions: Float32Array | null;
    endpointHoldTicks: number;
    framePosition: number;
    lastTick: number;
}

export interface PropMatrixAnimation {
    firstVertex: number;
    tracks: PropMatrixAnimationTrack[];
    nodesByMatrixIndex: Map<number, PropMatrixAnimationNode>;
    vertexOffsets: Uint32Array;
    sourcePositions: Float32Array;
    vertexMatrixChains: number[][];
    initialMatrices: Map<number, mat4>;
    boundingBox: AABB;
}

const animationComponent = mat4.create();
const animationPosition = vec3.create();

function samplePropMatrixAnimation(animation: PropMatrixAnimation, tick: number): void {
    for (const track of animation.tracks) {
        const frameCount = track.timings.length;
        if (track.triggeredPlaybackPositions !== null) {
            const playback = track.triggeredPlaybackPositions;
            const cycleLength = track.endpointHoldTicks * 2 + playback.length;
            let cycleTick = tick % cycleLength;
            if (cycleTick < 0)
                cycleTick += cycleLength;
            if (cycleTick < track.endpointHoldTicks) {
                track.framePosition = playback[0];
            } else if (cycleTick < track.endpointHoldTicks + playback.length) {
                track.framePosition = playback[cycleTick - track.endpointHoldTicks];
            } else {
                track.framePosition = playback[playback.length - 1];
            }
            track.lastTick = tick;
        } else {
            if (track.lastTick < 0 || tick < track.lastTick) {
                track.framePosition = 0;
                track.lastTick = tick;
            }
            for (let animationTick = track.lastTick; animationTick < tick; animationTick++) {
                const frame = Math.floor(track.framePosition);
                const t = track.framePosition - frame;
                // func_global_asm_806500E0 interpolates the adjacent timing
                // bytes, then advances by speed * timing / 300 each 30 Hz tick.
                const timing = track.timings[frame]
                    + (track.timings[frame + 1] - track.timings[frame]) * t;
                track.framePosition += track.speed * timing / 300;
                track.framePosition %= frameCount - 1;
                if (track.framePosition < 0)
                    track.framePosition += frameCount - 1;
            }
            track.lastTick = tick;
        }
        for (const node of track.nodes) {
            const frame = Math.min(Math.floor(track.framePosition), frameCount - 2);
            const t = track.framePosition - frame;
            const interpolate = (component: number): number => {
                const current = node.transforms[frame * 9 + component];
                return current + (node.transforms[(frame + 1) * 9 + component] - current) * t;
            };
            const interpolateAngle = (component: number): number => {
                const current = node.transforms[frame * 9 + component];
                let delta = node.transforms[(frame + 1) * 9 + component] - current;
                if (delta < -180)
                    delta += 360;
                else if (delta > 180)
                    delta -= 360;
                return (current + delta * t) * Math.PI / 180;
            };

            mat4.fromScaling(node.outputMatrix, [interpolate(0), interpolate(1), interpolate(2)]);
            mat4.fromZRotation(animationComponent, interpolateAngle(5));
            mat4.multiply(node.outputMatrix, animationComponent, node.outputMatrix);
            mat4.fromYRotation(animationComponent, interpolateAngle(4));
            mat4.multiply(node.outputMatrix, animationComponent, node.outputMatrix);
            mat4.fromXRotation(animationComponent, interpolateAngle(3));
            mat4.multiply(node.outputMatrix, animationComponent, node.outputMatrix);
            mat4.fromTranslation(animationComponent, [interpolate(6), interpolate(7), interpolate(8)]);
            mat4.multiply(node.outputMatrix, animationComponent, node.outputMatrix);
            // 8064FB64 concatenates the first base matrix, the interpolated
            // transform, and the following base matrix in row-vector order.
            // The matrices read below are their column-vector transposes.
            mat4.multiply(node.outputMatrix, node.outputMatrix, node.baseMatrix);
            mat4.multiply(node.outputMatrix, node.postMatrix, node.outputMatrix);
        }
    }
}

function forEachPropMatrixAnimationVertex(
    animation: PropMatrixAnimation,
    callback: (vertexIndex: number, position: vec3) => void,
): void {
    for (let i = 0; i < animation.vertexOffsets.length; i++) {
        const source = i * 3;
        vec3.set(animationPosition,
            animation.sourcePositions[source + 0],
            animation.sourcePositions[source + 1],
            animation.sourcePositions[source + 2],
        );
        for (const matrixIndex of animation.vertexMatrixChains[i]) {
            const matrix = animation.nodesByMatrixIndex.get(matrixIndex)?.outputMatrix
                ?? animation.initialMatrices.get(matrixIndex);
            if (matrix !== undefined)
                vec3.transformMat4(animationPosition, animationPosition, matrix);
        }
        callback(animation.firstVertex + animation.vertexOffsets[i], animationPosition);
    }
}

export function updatePropMatrixAnimation(animation: PropMatrixAnimation, vertexBufferData: Float32Array, tick: number): void {
    samplePropMatrixAnimation(animation, tick);
    forEachPropMatrixAnimationVertex(animation, (vertexIndex, position) => {
        const target = vertexIndex * 10;
        vertexBufferData[target + 0] = position[0];
        vertexBufferData[target + 1] = position[1];
        vertexBufferData[target + 2] = position[2];
    });
}

function findHighDetailPropDisplayList(view: DataView, mainDisplayListStart: number): number {
    let half1 = -1;
    for (let offs = mainDisplayListStart; offs < Math.min(view.byteLength, mainDisplayListStart + 0x80); offs += 8) {
        const w0 = view.getUint32(offs, false);
        const w1 = view.getUint32(offs + 4, false);
        const opcode = w0 >>> 24;
        if (opcode === 0xE1)
            half1 = w1;
        else if (opcode === 0x04 && (half1 >>> 24) === 0x0A)
            return half1 & 0x00FFFFFF;
        else if (opcode === 0xDF)
            break;
    }
    return 0;
}

function propDisplayListUsesMatrices(view: DataView, start: number, end: number): boolean {
    for (let offs = start; offs + 8 <= Math.min(view.byteLength, end); offs += 8) {
        if (view.getUint8(offs) === 0xDA)
            return true;
    }
    return false;
}

const warnedPropAnimationFeatures = new Set<string>();

function warnPropAnimationFeatureOnce(feature: string, prop: SetupProp, channel: number, message: string): void {
    const warningKey = `${feature}:${prop.type}:${channel}`;
    if (warnedPropAnimationFeatures.has(warningKey))
        return;
    warnedPropAnimationFeatures.add(warningKey);
    const position = Array.from(prop.position, (component) => component.toFixed(1)).join(',');
    console.warn(
        `[DK64 prop animation] type=0x${hexzero(prop.type, 4)} id=0x${hexzero(prop.id, 4)}`
        + ` position=(${position}) channel=${channel}: ${message}`,
    );
}

function isInitialPropScriptBlock(block: InstanceScript['blocks'][number]): boolean {
    return block.conditions.length === 1
        && block.conditions[0].opcode === 1
        && block.conditions[0].args[0] === 0;
}

function findPropAnimationScripts(scripts: InstanceScript[], propID: number): { channel: number; speed: number; holdEndpoints: boolean }[] {
    const script = scripts.find((entry) => entry.id === propID);
    if (script === undefined)
        return [];
    const channelSpeeds = new Map<number, number>();
    const starts: { channel: number; speed: number; holdEndpoints: boolean }[] = [];
    for (const block of script.blocks) {
        for (const command of block.executions) {
            if (command.opcode === 0x14) {
                channelSpeeds.set(command.args[0], command.args[1]);
            } else if (command.opcode === 0x11) {
                const channel = command.args[0];
                // func_global_asm_8064F450 initializes each channel's
                // func_global_asm_80650A04 speed field to one.
                starts.push({
                    channel,
                    speed: channelSpeeds.get(channel) ?? 1,
                    holdEndpoints: !isInitialPropScriptBlock(block),
                });
            }
        }
    }
    if (starts.length === 0)
        return [];

    const channels = [...new Set(starts.map((start) => start.channel))];
    return channels.map((channel) => {
        const channelStarts = starts.filter((start) => start.channel === channel);
        const movingStarts = channelStarts.filter((start) => start.speed !== 0);
        // Scripts commonly provide a high-speed start to restore persistent
        // state, followed by the slower start seen during live gameplay. We
        // do not simulate script conditions, so use the least-magnitude
        // moving speed for each selected channel. Fairy Island's door, for
        // example, uses 255 to snap open on reload and 1 for its visible event.
        const candidates = movingStarts.length > 0 ? movingStarts : channelStarts;
        const selected = candidates.reduce((best, candidate) => {
            const candidateMagnitude = Math.abs(candidate.speed);
            const bestMagnitude = Math.abs(best.speed);
            if (candidateMagnitude < bestMagnitude)
                return candidate;
            // If initialization and conditional starts use the same speed,
            // classify the channel as triggered so it receives endpoint holds.
            if (candidateMagnitude === bestMagnitude && candidate.holdEndpoints && !best.holdEndpoints)
                return candidate;
            return best;
        });
        return {
            channel,
            speed: selected.speed,
            holdEndpoints: selected.holdEndpoints,
        };
    });
}

function buildTriggeredPlaybackPositions(timings: Uint8Array, speed: number): Float32Array {
    const lastFrame = timings.length - 1;
    if (speed === 0)
        return new Float32Array([0]);
    const forwards = speed >= 0;
    let framePosition = forwards ? 0 : lastFrame;
    const target = forwards ? lastFrame : 0;
    const positions = [framePosition];
    // Keep malformed or extremely slow tracks from allocating unbounded data.
    for (let tick = 0; tick < 30 * 60 && (forwards ? framePosition < target : framePosition > target); tick++) {
        const frame = Math.min(Math.floor(framePosition), lastFrame - 1);
        const t = framePosition - frame;
        const timing = timings[frame] + (timings[frame + 1] - timings[frame]) * t;
        const nextFramePosition = framePosition + speed * timing / 300;
        if (forwards ? nextFramePosition <= framePosition : nextFramePosition >= framePosition)
            break;
        framePosition = forwards
            ? Math.min(nextFramePosition, target)
            : Math.max(nextFramePosition, target);
        positions.push(framePosition);
    }
    if (positions[positions.length - 1] !== target)
        positions.push(target);
    return new Float32Array(positions);
}

function applyInitialPropMatrices(
    view: DataView,
    state: RSPState,
    sharedOutput: RSPSharedOutput,
    firstVertex: number,
    vertexCount: number,
): void {
    const matrixData = view.getUint32(0x68, false);
    if (matrixData + 8 > view.byteLength)
        return;
    const matrixBuffer = matrixData + 8;
    const initialMatrixDataSize = view.getUint32(matrixData + 4, false);
    const matrices = new Map<number, mat4>();
    for (let i = 0; i < vertexCount; i++) {
        const vertex = sharedOutput.vertices[firstVertex + i];
        vec3.set(animationPosition, vertex.x, vertex.y, vertex.z);
        const storedMatrixChain = state.vertexMatrixChains[firstVertex + i];
        // An empty chain means the display list emitted this vertex before
        // selecting any segment-9 matrix. SP_MatrixIndex defaults to zero,
        // but that is not an implicit load of matrix zero.
        const matrixChain = storedMatrixChain ?? [];
        for (const matrixIndex of matrixChain) {
            if (matrixIndex === undefined)
                continue;
            const matrixOffset = matrixIndex * 0x40;
            // func_global_asm_8064F450 copies the initial matrix range, then
            // initializes the remaining runtime output matrices to identity.
            if (matrixOffset < 0 || matrixOffset + 0x40 > initialMatrixDataSize || matrixBuffer + matrixOffset + 0x40 > view.byteLength)
                continue;
            let matrix = matrices.get(matrixIndex);
            if (matrix === undefined) {
                matrix = mat4.create();
                for (let component = 0; component < 16; component++)
                    matrix[component] = view.getFloat32(matrixBuffer + matrixOffset + component * 4, false);
                matrices.set(matrixIndex, matrix);
            }
            vec3.transformMat4(animationPosition, animationPosition, matrix);
        }
        vertex.x = animationPosition[0];
        vertex.y = animationPosition[1];
        vertex.z = animationPosition[2];
    }
}

function decodePropMatrixAnimation(
    view: DataView,
    scripts: InstanceScript[],
    prop: SetupProp,
    state: RSPState,
    sharedOutput: RSPSharedOutput,
    firstVertex: number,
    vertexCount: number,
): Mesh['propMatrixAnimation'] {
    const setups = findPropAnimationScripts(scripts, prop.id);
    if (setups.length === 0) {
        // Matrix-capable geometry starts from its initial matrix buffer and
        // remains static until behavior code or an instance script activates
        // a channel. A prop with no animation commands is therefore valid.
        return undefined;
    }

    const animationTable = view.getUint32(0x64, false);
    const matrixData = view.getUint32(0x68, false);
    if (animationTable === matrixData)
        return undefined;
    const matrixBuffer = matrixData + 8;
    const initialMatrixDataSize = view.getUint32(matrixData + 4, false);
    const readMatrix = (offs: number): mat4 => {
        const matrix = mat4.create();
        for (let i = 0; i < 16; i++)
            matrix[i] = view.getFloat32(offs + i * 4, false);
        return matrix;
    };

    const tracks: PropMatrixAnimationTrack[] = [];
    const nodesByMatrixIndex = new Map<number, PropMatrixAnimationNode>();
    for (const setup of setups) {
        if (setup.channel < 0 || setup.channel >= 10)
            return undefined;
        const channelStart = animationTable + view.getUint32(animationTable + setup.channel * 4, false);
        if (channelStart < animationTable || channelStart + 0x3C > matrixData)
            return undefined;

        const frameCount = view.getUint8(channelStart);
        const nodeCount = view.getUint8(channelStart + 0x39);
        if (frameCount < 2 || nodeCount === 0)
            return undefined;
        const timings = new Uint8Array(frameCount);
        for (let frame = 0; frame < frameCount; frame++)
            timings[frame] = view.getUint8(channelStart + 1 + frame);

        const recordStride = 8 + frameCount * 0x24;
        const nodes: PropMatrixAnimationNode[] = [];
        for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
            const record = channelStart + 0x3C + nodeIndex * recordStride;
            const matrixOffset = view.getUint32(record, false);
            const matrixIndex = matrixOffset >>> 6;
            const parentMatrixOffset = view.getUint32(record + 4, false);
            if (parentMatrixOffset + 0x80 > initialMatrixDataSize) {
                // TODO: Resolve animated parents whose matrices are generated
                // by another active model2 channel.
                warnPropAnimationFeatureOnce(
                    'animated-parent',
                    prop,
                    setup.channel,
                    `node=${nodeIndex} outputMatrix=0x${hexzero(matrixOffset, 4)}`
                    + ` parentMatrix=0x${hexzero(parentMatrixOffset, 4)}`
                    + ` exceeds initialMatrixDataSize=0x${hexzero(initialMatrixDataSize, 4)}`
                    + ` frames=${frameCount} nodes=${nodeCount}`,
                );
                return undefined;
            }
            const transforms = new Float32Array(frameCount * 9);
            for (let frame = 0; frame < frameCount; frame++) {
                const transform = record + 8 + frame * 0x24;
                for (let component = 0; component < 9; component++)
                    transforms[frame * 9 + component] = view.getFloat32(transform + component * 4, false);
            }
            const node: PropMatrixAnimationNode = {
                matrixIndex,
                transforms,
                baseMatrix: readMatrix(matrixBuffer + parentMatrixOffset),
                postMatrix: readMatrix(matrixBuffer + parentMatrixOffset + 0x40),
                outputMatrix: mat4.create(),
            };
            nodes.push(node);
            nodesByMatrixIndex.set(matrixIndex, node);
        }
        const triggeredPlaybackPositions = setup.holdEndpoints
            ? buildTriggeredPlaybackPositions(timings, setup.speed)
            : null;
        const animationLengthTicks = triggeredPlaybackPositions === null
            ? 0
            : Math.max(triggeredPlaybackPositions.length - 1, 1);
        tracks.push({
            channel: setup.channel,
            nodes,
            timings,
            speed: setup.speed,
            triggeredPlaybackPositions,
            endpointHoldTicks: Math.max(30, animationLengthTicks),
            framePosition: 0,
            lastTick: -1,
        });
    }

    const vertexOffsets: number[] = [];
    const vertexMatrixChains: number[][] = [];
    const sourcePositions: number[] = [];
    const boundMatrixIndices = new Set<number>();
    for (let i = 0; i < vertexCount; i++) {
        const storedMatrixChain = state.vertexMatrixChains[firstVertex + i];
        const matrixChain = storedMatrixChain ?? [];
        if (!matrixChain.some((matrixIndex) => matrixIndex !== undefined && nodesByMatrixIndex.has(matrixIndex)))
            continue;
        const definedMatrixChain = matrixChain.filter((matrixIndex): matrixIndex is number => matrixIndex !== undefined);
        for (const matrixIndex of definedMatrixChain) {
            if (nodesByMatrixIndex.has(matrixIndex))
                boundMatrixIndices.add(matrixIndex);
        }
        const vertex = sharedOutput.vertices[firstVertex + i];
        vertexOffsets.push(i);
        vertexMatrixChains.push(definedMatrixChain);
        sourcePositions.push(vertex.x, vertex.y, vertex.z);
    }
    for (const track of tracks) {
        for (let nodeIndex = 0; nodeIndex < track.nodes.length; nodeIndex++) {
            const node = track.nodes[nodeIndex];
            if (boundMatrixIndices.has(node.matrixIndex))
                continue;
            warnPropAnimationFeatureOnce(
                'missing-matrix-binding',
                prop,
                track.channel,
                `node=${nodeIndex} outputMatrix=0x${hexzero(node.matrixIndex * 0x40, 4)} has no emitted vertices`
                + ` frames=${track.timings.length} nodes=${track.nodes.length}`,
            );
        }
    }
    if (vertexOffsets.length === 0)
        return undefined;

    const initialMatrices = new Map<number, mat4>();
    for (let matrixOffset = 0; matrixOffset + 0x40 <= initialMatrixDataSize; matrixOffset += 0x40)
        initialMatrices.set(matrixOffset >>> 6, readMatrix(matrixBuffer + matrixOffset));

    // Keep the static initial pose in the shared buffer. Animated vertices
    // are overwritten from their raw source positions every update, walking
    // the same load/multiply matrix chain that the display list selected.
    applyInitialPropMatrices(view, state, sharedOutput, firstVertex, vertexCount);
    const animation: PropMatrixAnimation = {
        firstVertex,
        tracks,
        nodesByMatrixIndex,
        vertexOffsets: new Uint32Array(vertexOffsets),
        sourcePositions: new Float32Array(sourcePositions),
        vertexMatrixChains,
        initialMatrices,
        boundingBox: new AABB(),
    };
    animation.boundingBox = computeMatrixAnimationBoundingBox(
        animation,
        (tick) => samplePropMatrixAnimation(animation, tick),
        (callback) => forEachPropMatrixAnimationVertex(animation, (_vertexIndex, position) => callback(position)),
    );
    return animation;
}

function createPropDecalVertexBuffer(halfWidth: number, halfHeight: number, textureWidth: number, textureHeight: number): ArrayBufferSlice {
    const buffer = new ArrayBuffer(4 * 0x10);
    const view = new DataView(buffer);
    const positions = [
        -halfWidth, 0, -halfHeight,
         halfWidth, 0, -halfHeight,
         halfWidth, 0,  halfHeight,
        -halfWidth, 0,  halfHeight,
    ];
    const textureCoordinates = [
        0, 0,
        textureWidth << 5, 0,
        textureWidth << 5, textureHeight << 5,
        0, textureHeight << 5,
    ];
    for (let i = 0; i < 4; i++) {
        const offs = i * 0x10;
        view.setInt16(offs + 0x00, positions[i * 3]);
        view.setInt16(offs + 0x02, positions[i * 3 + 1]);
        view.setInt16(offs + 0x04, positions[i * 3 + 2]);
        view.setInt16(offs + 0x08, textureCoordinates[i * 2]);
        view.setInt16(offs + 0x0A, textureCoordinates[i * 2 + 1]);
        view.setUint8(offs + 0x0C, 0xFF);
        view.setUint8(offs + 0x0D, 0xFF);
        view.setUint8(offs + 0x0E, 0xFF);
        view.setUint8(offs + 0x0F, 0xFF);
    }
    return new ArrayBufferSlice(buffer);
}

function parseModel2IndexedTextures(geometryView: DataView, romData: ROMData): AnimatedTexture[] {
    // func_global_asm_806349FC registers the target G_SETTIMG IDs from this
    // descriptor list. func_global_asm_80636EFC then deliberately leaves
    // those IDs unresolved while loading every other model texture from table
    // 25; func_global_asm_80639CD0 supplies the selected frames from table 7.
    const descriptorStart = geometryView.getUint32(0x6C, false);
    if (descriptorStart + 4 > geometryView.byteLength)
        return [];
    const descriptorCount = geometryView.getUint32(descriptorStart, false);
    const textures: AnimatedTexture[] = [];
    for (let i = 0; i < descriptorCount; i++) {
        const offs = descriptorStart + 4 + i * 0x84;
        if (offs + 0x84 > geometryView.byteLength)
            break;
        const targetTextureID = geometryView.getUint32(offs + 0x00, false);
        const crossfade = geometryView.getUint32(offs + 0x04, false);
        const frameDuration = geometryView.getUint32(offs + 0x08, false);
        const frameCount = geometryView.getUint32(offs + 0x0C, false);
        if (frameCount === 0 || frameCount > 0x1E)
            continue;
        const frames: ArrayBufferSlice[] = [];
        for (let frame = 0; frame < frameCount; frame++) {
            const textureID = frame === 0
                ? targetTextureID
                : geometryView.getUint32(offs + 0x0C + frame * 4, false);
            const texture = romData.AnimTexData[textureID];
            if (texture === undefined)
                break;
            frames.push(texture);
        }
        if (frames.length !== frameCount)
            continue;
        // func_global_asm_806349FC initializes playback mode to 1, which
        // advances these frames automatically. Descriptor +0x04 is instead
        // unk4A: 80639CD0 supplies the current and next frames together, and
        // uses unk50 / unk4C as their blend fraction.
        textures.push({
            segment: 0,
            group: targetTextureID,
            frameDuration,
            crossfade: crossfade !== 0,
            frames,
        });
    }
    return textures;
}

function applyInitialModel2TextureScripts(textures: AnimatedTexture[], scripts: InstanceScript[], propID: number): AnimatedTexture[] {
    const script = scripts.find((entry) => entry.id === propID);
    if (script === undefined || textures.length === 0)
        return textures;

    // Texture tracks are one-based in prop scripts. func_global_asm_806349FC
    // initializes them in automatic playback mode at frame zero.
    const playbackModes = textures.map(() => 1);
    const selectedFrames = textures.map(() => 0);
    for (const block of script.blocks) {
        // These state-zero blocks run once while the prop is initialized.
        // Blocks which assign a new script state are runtime transitions.
        if (block.conditions.length !== 1
            || block.conditions[0].opcode !== 1
            || block.conditions[0].args[0] !== 0
            || block.executions.some((command) => command.opcode === 1))
            continue;

        for (const command of block.executions) {
            const textureIndex = command.args[0] - 1;
            if (textureIndex < 0 || textureIndex >= textures.length)
                continue;
            if (command.opcode === 0x27) {
                // func_global_asm_80634EA4: select automatic/manual playback.
                playbackModes[textureIndex] = command.args[1];
            } else if (command.opcode === 0x28) {
                // func_global_asm_80635018: select frame and frame counter.
                selectedFrames[textureIndex] = command.args[1];
            }
        }
    }

    return textures.map((texture, index) => {
        if (playbackModes[index] !== 0 || texture.crossfade)
            return texture;
        const selectedFrame = selectedFrames[index];
        if (selectedFrame < 0 || selectedFrame >= texture.frames.length)
            return texture;
        return {
            ...texture,
            frameDuration: 0,
            frameOffset: 0,
            frames: [texture.frames[selectedFrame]],
        };
    });
}

function addModel2PropDecals(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, geometryView: DataView, instances: SetupProp[], terrainTriangles: TerrainTriangle[], worldScale: number): void {
    const textureID = geometryView.getUint16(0x28, false);
    if (textureID === 0xFFFF)
        return;

    const halfWidth = geometryView.getInt16(0x2E, false);
    const halfHeight = geometryView.getInt16(0x30, false);
    const textureWidth = geometryView.getUint8(0x32) || 0x100;
    const textureHeight = geometryView.getUint8(0x33) || 0x100;
    const format = geometryView.getUint8(0x34) & 0x07;
    const size = geometryView.getUint8(0x35);
    const alpha = geometryView.getUint8(0x38);
    const fadeStartDistance = geometryView.getUint8(0x36) * 10 * worldScale;
    const fadeEndDistance = geometryView.getUint8(0x37) * 10 * worldScale;
    if (halfWidth <= 0 || halfHeight <= 0 || size > ImageSize.G_IM_SIZ_32b || romData.TexData[textureID] === undefined)
        return;

    const bitsPerPixel = 4 << size;
    const loadCount = Math.min(0x07FF, Math.ceil(textureWidth * textureHeight * bitsPerPixel / 16) - 1);
    const line = Math.max(1, Math.ceil(textureWidth * bitsPerPixel / 64));
    const dxt = Math.max(1, Math.ceil(0x0800 / line));
    const maskS = Math.ceil(Math.log2(textureWidth));
    const maskT = Math.ceil(Math.log2(textureHeight));
    const segmentBuffers: ArrayBufferSlice[] = [];
    segmentBuffers[0x08] = createPropDecalVertexBuffer(halfWidth, halfHeight, textureWidth, textureHeight);
    const decalTexture: AnimatedTexture[] = [{
        segment: 0x0E,
        group: textureID,
        frameDuration: 0,
        frames: [romData.TexData[textureID]],
    }];
    const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, decalTexture);
    initDL(state, false);
    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    state.gSPClearGeometryMode(0xFFFFFFFF);
    state.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    state.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    state.gDPSetOtherModeL(0, 29, 0x00504DD8);
    state.gDPSetCombine(0x00119623, 0xFF2FFFFF);
    state.gSPSetPrimColor(0, 0x00, 0x00, 0x00, alpha);
    const loadSize = size === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;
    state.gDPSetTextureImage(format, loadSize, 1, 0x0E000000);
    state.gDPSetTile(format, loadSize, 0, 0, 7, 0, 0, maskT, 0, 0, maskS, 0);
    state.gDPLoadBlock(7, 0, 0, loadCount, dxt);
    state.gDPSetTile(format, size, line, 0, 0, 0, 0, maskT, 0, 0, maskS, 0);
    state.gDPSetTileSize(0, 0, 0, (textureWidth - 1) << 2, (textureHeight - 1) << 2);
    state.gSPVertex(0x08000000, 4, 0);
    state.gSPTri(0, 1, 2);
    state.gSPTri(0, 2, 3);
    const output = state.finish();
    if (output === null)
        return;

    const mesh: Mesh = { sharedOutput, rspState: state, rspOutput: output };
    const meshData = sceneRenderer.addMeshData(device, cache, mesh);
    for (const prop of instances) {
        const renderer = sceneRenderer.addPropMeshRenderer(device, cache, meshData);
        const worldX = prop.position[0] * worldScale;
        const worldY = prop.position[1] * worldScale;
        const worldZ = prop.position[2] * worldScale;
        // func_global_asm_80632FCC performs the same floor query with a ray
        // beginning 20 game units above the prop, then 8063A968 rotates the
        // generated quad to the returned ground angles. ZMODE_DEC supplies
        // polygon offset, so the decal can remain coplanar with the floor.
        const surface = findTerrainSurface(terrainTriangles, worldX, worldZ, worldY + 20 * worldScale);
        const normal = surface?.normal ?? Vec3UnitY;
        const yaw = prop.rotation[1] * Math.PI / 180;
        const tangentZ = vec3.fromValues(Math.sin(yaw), 0, Math.cos(yaw));
        vec3.scaleAndAdd(tangentZ, tangentZ, normal, -vec3.dot(tangentZ, normal));
        if (vec3.squaredLength(tangentZ) < 0.0001)
            vec3.set(tangentZ, Math.cos(yaw), 0, -Math.sin(yaw));
        vec3.normalize(tangentZ, tangentZ);
        const tangentX = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), normal, tangentZ));
        const modelMatrix = renderer.modelMatrix;
        modelMatrix[0] = tangentX[0];
        modelMatrix[1] = tangentX[1];
        modelMatrix[2] = tangentX[2];
        modelMatrix[4] = normal[0];
        modelMatrix[5] = normal[1];
        modelMatrix[6] = normal[2];
        modelMatrix[8] = tangentZ[0];
        modelMatrix[9] = tangentZ[1];
        modelMatrix[10] = tangentZ[2];
        modelMatrix[12] = worldX;
        modelMatrix[13] = surface?.y ?? worldY;
        modelMatrix[14] = worldZ;
        mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [
            prop.scale * worldScale,
            prop.scale * worldScale,
            prop.scale * worldScale,
        ]);
        sceneRenderer.setObjectCullBoundingBox(renderer, renderer.computeWorldBoundingBox());
        if (fadeEndDistance > fadeStartDistance) {
            renderer.distanceFade = {
                origin: vec3.fromValues(worldX, worldY, worldZ),
                startDistance: fadeStartDistance,
                endDistance: fadeEndDistance,
            };
        }
    }
}

interface RuntimePropQuad {
    textureID: number;
    paletteID: number;
    x: number[];
    y: number[];
    z: number[];
    s: number[];
    t: number[];
    width: number;
    height: number;
    size: ImageSize;
    format: ImageFormat;
}

function parseRuntimePropQuads(view: DataView): RuntimePropQuad[] {
    const tableStart = view.getUint32(0x70, false);
    if (tableStart + 4 > view.byteLength)
        return [];
    const count = view.getUint32(tableStart, false);
    if (count > 0x100 || tableStart + 4 + count * 0x30 > view.byteLength)
        return [];

    const quads: RuntimePropQuad[] = [];
    for (let i = 0; i < count; i++) {
        const offs = tableStart + 4 + i * 0x30;
        quads.push({
            textureID: view.getUint16(offs + 0x00, false),
            paletteID: view.getUint16(offs + 0x02, false),
            x: nArray(4, (j) => view.getInt16(offs + 0x04 + j * 2, false)),
            y: nArray(4, (j) => view.getInt16(offs + 0x0C + j * 2, false)),
            z: nArray(4, (j) => view.getInt16(offs + 0x14 + j * 2, false)),
            s: nArray(4, (j) => view.getInt16(offs + 0x1C + j * 4, false)),
            t: nArray(4, (j) => view.getInt16(offs + 0x1E + j * 4, false)),
            width: view.getUint8(offs + 0x2C),
            height: view.getUint8(offs + 0x2D),
            size: view.getUint8(offs + 0x2E) as ImageSize,
            format: view.getUint8(offs + 0x2F) as ImageFormat,
        });
    }
    return quads;
}

function createRuntimePropVertexBuffer(quad: RuntimePropQuad, instanceCount: number): ArrayBufferSlice {
    const buffer = new ArrayBuffer(instanceCount * 4 * 0x10);
    const view = new DataView(buffer);
    for (let instance = 0; instance < instanceCount; instance++) {
        for (let i = 0; i < 4; i++) {
            const offs = (instance * 4 + i) * 0x10;
            view.setInt16(offs + 0x08, quad.s[i]);
            view.setInt16(offs + 0x0A, quad.t[i]);
            view.setUint8(offs + 0x0C, 0xFF);
            view.setUint8(offs + 0x0D, 0xFF);
            view.setUint8(offs + 0x0E, 0xFF);
            view.setUint8(offs + 0x0F, 0xFF);
        }
    }
    return new ArrayBufferSlice(buffer);
}

function initRuntimePropMaterial(state: RSPState, quad: RuntimePropQuad): void {
    const bitsPerPixel = 4 << quad.size;
    const loadCount = Math.min(0x07FF, Math.ceil(quad.width * quad.height * bitsPerPixel / 16) - 1);
    const line = Math.max(1, Math.ceil(quad.width * bitsPerPixel / 64));
    const dxt = Math.max(1, Math.ceil(0x0800 / line));
    const maskS = Math.ceil(Math.log2(quad.width));
    const maskT = Math.ceil(Math.log2(quad.height));

    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    state.gSPClearGeometryMode(0xFFFFFFFF);
    state.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    state.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    // Layout-2 props with setup flag 1 are placed in the game's translucent
    // object list. func_global_asm_80637B6C selects this depth-tested,
    // non-depth-writing render mode for them.
    state.gDPSetOtherModeL(0, 29, 0x0C184A50);
    state.gDPSetCombine(0x00119623, 0xFF2FFFFF); // G_CC_MODULATEIA_PRIM
    state.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);

    const indexed = quad.format === ImageFormat.G_IM_FMT_CI;
    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLUT, 2, indexed ? 0x8000 : 0);
    if (indexed) {
        assert(quad.paletteID !== 0xFFFF);
        state.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, quad.paletteID);
        state.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 7, 0, 0, 0, 0, 0, 0, 0);
        state.gDPLoadTLUT(7, quad.size === ImageSize.G_IM_SIZ_4b ? 15 : 255);
    }

    const loadSize = quad.size === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;
    state.gDPSetTextureImage(quad.format, loadSize, 1, quad.textureID);
    state.gDPSetTile(quad.format, loadSize, 0, 0, 7, 0, 0, maskT, 0, 0, maskS, 0);
    state.gDPLoadBlock(7, 0, 0, loadCount, dxt);
    state.gDPSetTile(quad.format, quad.size, line, 0, 0, 0, 0, maskT, 0, 0, maskS, 0);
    state.gDPSetTileSize(0, 0, 0, (quad.width - 1) << 2, (quad.height - 1) << 2);
}

function addRuntimeModel2Props(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, view: DataView, instances: SetupProp[], worldScale: number, lightingEnvironment: ObjectLightingEnvironment): void {
    for (const quad of parseRuntimePropQuads(view)) {
        if (quad.width === 0 || quad.height === 0 || quad.size > ImageSize.G_IM_SIZ_32b)
            continue;
        for (const prop of instances) {
            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x08] = createRuntimePropVertexBuffer(quad, 1);
            // Pickup-style layout-2 props use the same segment-zero
            // placeholder IDs and table-7 animation descriptors as regular
            // model2 geometry.
            const indexedTextures = parseModel2IndexedTextures(view, romData);
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, [], indexedTextures);
            initRuntimePropMaterial(state, quad);
            const firstVertex = sharedOutput.vertices.length;
            state.gSPVertex(0x08000000, 4, 0);
            state.gSPTri(0, 1, 2);
            state.gSPTri(0, 2, 3);
            const scale = prop.scale * worldScale;
            const origin = vec3.fromValues(
                prop.position[0] * worldScale,
                prop.position[1] * worldScale,
                prop.position[2] * worldScale,
            );
            const billboards: NonNullable<Mesh['spriteBillboards']> = [{
                firstVertex,
                origin,
                centerX: 0,
                centerY: 0,
                halfWidth: 0,
                halfHeight: 0,
                rightOffsets: quad.x.map((x) => x * scale),
                upOffsets: quad.y.map((y) => y * scale),
                forwardOffsets: quad.z.map((z) => z * scale),
            }];
            const output = state.finish();
            if (output === null)
                continue;
            const mesh: Mesh = { sharedOutput, rspState: state, rspOutput: output, spriteBillboards: billboards };
            const meshData = sceneRenderer.addMeshData(device, cache, mesh);
            const renderer = sceneRenderer.addPropMeshRenderer(device, cache, meshData);
            sceneRenderer.setObjectCullBoundingBox(renderer, computeBillboardBoundingBox(
                origin,
                billboards[0].rightOffsets!,
                billboards[0].upOffsets!,
                billboards[0].forwardOffsets!,
            ));
            if (view.getUint8(0x1D) === 0)
                renderer.setObjectLighting(buildObjectLighting(lightingEnvironment, origin));
            // The game sorts this object list far-to-near. At minimum these
            // must follow translucent map surfaces; leaving the default opaque
            // sort key lets water submitted later blend over the plants.
            renderer.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            renderer.setBackfaceCullingEnabled(false);
        }
    }
}

export function addModel2Props(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, props: SetupProp[], scripts: InstanceScript[], terrainTriangles: TerrainTriangle[], worldScale: number, fogEnabled: boolean, lightingEnvironment: ObjectLightingEnvironment): void {
    if (props.length === 0 || romData.PropGeometryData.size === 0)
        return;

    const propsByType = new Map<number, SetupProp[]>();
    for (const prop of props) {
        if (!propsByType.has(prop.type))
            propsByType.set(prop.type, []);
        propsByType.get(prop.type)!.push(prop);
    }

    for (const [propType, instances] of propsByType) {
        // func_global_asm_80636FFC explicitly returns without submitting
        // these object types; they are handled outside the static model path.
        if (propType === 0x0000 || propType === 0x0241)
            continue;
        const geometry = romData.loadPropGeometry(propType);
        const view = geometry.createDataView();
        const assetFamily = geometry.createTypedArray(Uint8Array, 0x0C, 0x10);
        const assetFamilyEnd = assetFamily.indexOf(0);
        const assetFamilyName = String.fromCharCode(...assetFamily.subarray(0, assetFamilyEnd >= 0 ? assetFamilyEnd : assetFamily.length));
        // Keep this decoded for diagnostics and future family-specific
        // behavior, but do not use it to restrict generic prop rendering.
        void assetFamilyName;
        addModel2PropDecals(device, cache, sceneRenderer, sharedOutput, romData, view, instances, terrainTriangles, worldScale);
        if (view.getUint8(0x1C) === 2) {
            addRuntimeModel2Props(device, cache, sceneRenderer, sharedOutput, romData, view, instances, worldScale, lightingEnvironment);
            continue;
        }
        // Header layout 1 stores an F3DEX2 display-list range followed by its
        // segment-8 vertices.
        if (view.getUint8(0x1C) !== 1)
            continue;

        const mainDisplayListStart = view.getUint32(0x40, false);
        const secondaryDisplayListStart = view.getUint32(0x44, false);
        const vertexStart = view.getUint32(0x48, false);
        // Some props have a hierarchy driven by segment-9 matrices generated
        // at runtime. Supported tracks are decoded below; other matrix
        // features opt out with a one-time warning.
        const usesRuntimeMatrices = propDisplayListUsesMatrices(view, mainDisplayListStart, secondaryDisplayListStart);
        // Matrix-driven props are accepted by capability, not type. The
        // decoder below opts out when a track uses channels we do not yet
        // support.
        const segmentBuffers: ArrayBufferSlice[] = [];
        segmentBuffers[0x08] = geometry.slice(vertexStart);
        segmentBuffers[0x0A] = geometry.slice(mainDisplayListStart);
        // The game submits the secondary range by physical address while it
        // retains segment 0x0A for branches into the primary range. Give the
        // secondary entry point an otherwise unused local segment.
        segmentBuffers[0x0F] = geometry;

        const indexedTextures = applyInitialModel2TextureScripts(
            parseModel2IndexedTextures(view, romData),
            scripts,
            instances[0].id,
        );
        const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, [], indexedTextures);
        initDL(state, true, fogEnabled);
        // func_global_asm_80636FFC installs this inherited state immediately
        // before submitting both prop display lists. Tree materials use
        // primitive color but do not set it inside their own lists.
        state.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);
        // LOD wrappers select their first (highest-detail) target with
        // G_RDPHALF_1 + G_BRANCH_Z. Direct display lists simply begin at zero.
        // TODO: implement G_BRANCH_Z and submit the wrapper itself so props
        // can switch LOD based on the projected Z value.
        const displayListOffset = findHighDetailPropDisplayList(view, mainDisplayListStart);
        const firstVertex = sharedOutput.vertices.length;
        runDL_F3DEX2(state, 0x0A000000 | displayListOffset);
        runDL_F3DEX2(state, 0x0F000000 | secondaryDisplayListStart);
        const output = state.finish();
        if (output === null)
            continue;

        const vertexCount = sharedOutput.vertices.length - firstVertex;
        const propMatrixAnimation = usesRuntimeMatrices
            ? decodePropMatrixAnimation(view, scripts, instances[0], state, sharedOutput, firstVertex, vertexCount)
            : undefined;
        if (usesRuntimeMatrices && propMatrixAnimation === undefined)
            applyInitialPropMatrices(view, state, sharedOutput, firstVertex, vertexCount);
        const mesh: Mesh = { sharedOutput, rspState: state, rspOutput: output, propMatrixAnimation };
        const meshData = sceneRenderer.addMeshData(device, cache, mesh);
        for (const prop of instances) {
            const renderer = sceneRenderer.addPropMeshRenderer(device, cache, meshData);
            const origin = vec3.fromValues(
                prop.position[0] * worldScale,
                prop.position[1] * worldScale,
                prop.position[2] * worldScale,
            );
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [
                origin[0],
                origin[1],
                origin[2],
            ]);
            mat4.rotateX(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[0] * Math.PI / 180);
            mat4.rotateY(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[1] * Math.PI / 180);
            mat4.rotateZ(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[2] * Math.PI / 180);
            mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [
                prop.scale * worldScale,
                prop.scale * worldScale,
                prop.scale * worldScale,
            ]);
            // func_global_asm_80636FFC samples one light color for the whole
            // model2 object. Header byte 0x1D becomes runtime unkC2; nonzero
            // values deliberately bypass the sample (self-lit torches are a
            // visible example).
            if (view.getUint8(0x1D) === 0)
                renderer.setObjectLighting(buildObjectLighting(lightingEnvironment, origin));
            sceneRenderer.setObjectCullBoundingBox(renderer, renderer.computeWorldBoundingBox());
        }
    }
}
