import { vec3 } from 'gl-matrix';

import type ArrayBufferSlice from '../ArrayBufferSlice.js';
import type { RSPSharedOutput, Vertex } from '../BanjoKazooie/f3dex.js';
import { actorModelScale, getActorRenderDefinition, parseActorAnimation, parseActorSkeleton, sampleActorBonePosition } from './actor.js';
import type { ActorAnimation, ActorSkeleton } from './actor.js';
import type { DrawTextureBinding } from './f3dex2.js';
import type { Setup } from './parse.js';

interface LightAnimationKeyframe {
    intensity: number;
    color: readonly [number, number, number];
    radius: number;
    duration: number;
}

interface DynamicPointLight {
    kind: 'point';
    origin: vec3;
    animation: readonly LightAnimationKeyframe[];
    phase: number;
    maxDistance: number;
}

interface DynamicSpotLight {
    kind: 'spot';
    origin: vec3;
    color: readonly [number, number, number];
    innerAngle: number;
    outerAngle: number;
    speed: number;
    rotationY: number;
    maxDistance: number;
    animation: ActorAnimation;
    skeleton: ActorSkeleton;
    scale: number;
    targetBone: number;
}

export type DynamicLight = DynamicPointLight | DynamicSpotLight;

export interface DynamicLighting {
    ambientColor: vec3;
    modulateVertexColors: boolean;
    vertexIndices: readonly number[];
    lights: readonly DynamicLight[];
}

export interface ObjectLighting {
    origin: vec3;
    ambientColor: vec3;
    lights: readonly DynamicLight[];
}

export interface ObjectLightingEnvironment {
    chunks: readonly {
        min: vec3;
        max: vec3;
        ambientColor: vec3;
    }[];
    lights: readonly DynamicLight[];
}

interface RelitMapChunk {
    ambientColor: vec3;
    modulateVertexColors: boolean;
    vertOffset: number;
    vertSize: number;
}

interface RelitDrawCall {
    firstIndex: number;
    indexCount: number;
    textureBindings: readonly DrawTextureBinding[];
}

export interface ActiveLight {
    origin: vec3;
    innerRadius: number;
    outerRadius: number;
    color: [number, number, number];
    direction?: vec3;
    innerConeCos?: number;
    outerConeCos?: number;
}

export class ActiveLightCache {
    private activeLights = new Map<DynamicLight, ActiveLight>();
    private bonePosition = vec3.create();
    private lastUpdateTick = -1;

    constructor(private lights: readonly DynamicLight[]) {
    }

    public update(camera: ArrayLike<number>, tick: number): void {
        if (tick === this.lastUpdateTick)
            return;
        this.lastUpdateTick = tick;
        this.activeLights.clear();

        for (const light of this.lights) {
            const activeLight = sampleActiveLight(light, camera, tick, this.bonePosition);
            if (activeLight !== null)
                this.activeLights.set(light, activeLight);
        }
    }

    public get(light: DynamicLight): ActiveLight | undefined {
        return this.activeLights.get(light);
    }
}

interface ActorLightResources {
    loadActorGeometry: (model: number) => ArrayBufferSlice | null;
    loadAnimation: (animation: number) => ArrayBufferSlice | null;
}

export function buildObjectLightingEnvironment(
    vertexData: ArrayBufferSlice,
    chunks: readonly RelitMapChunk[],
    lights: readonly DynamicLight[],
): ObjectLightingEnvironment {
    const view = vertexData.createDataView();
    return {
        chunks: chunks.map((chunk) => {
            const min = vec3.fromValues(Infinity, Infinity, Infinity);
            const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
            const end = Math.min(view.byteLength, chunk.vertOffset + chunk.vertSize);
            for (let offs = chunk.vertOffset; offs + 6 <= end; offs += 0x10) {
                for (let axis = 0; axis < 3; axis++) {
                    const value = view.getInt16(offs + axis * 2, false);
                    min[axis] = Math.min(min[axis], value);
                    max[axis] = Math.max(max[axis], value);
                }
            }
            return { min, max, ambientColor: chunk.ambientColor };
        }),
        lights,
    };
}

export function buildObjectLighting(environment: ObjectLightingEnvironment, origin: vec3): ObjectLighting {
    let bestChunk = environment.chunks[0];
    let bestDistanceSquared = Infinity;
    for (const chunk of environment.chunks) {
        let distanceSquared = 0;
        for (let axis = 0; axis < 3; axis++) {
            const delta = origin[axis] < chunk.min[axis]
                ? chunk.min[axis] - origin[axis]
                : origin[axis] > chunk.max[axis] ? origin[axis] - chunk.max[axis] : 0;
            distanceSquared += delta * delta;
        }
        if (distanceSquared < bestDistanceSquared) {
            bestChunk = chunk;
            bestDistanceSquared = distanceSquared;
        }
    }
    return {
        origin,
        ambientColor: bestChunk?.ambientColor ?? vec3.fromValues(1, 1, 1),
        lights: environment.lights,
    };
}

// From func_global_asm_8065EB10 + D_global_asm_80748430
const lightAnimations: readonly (readonly LightAnimationKeyframe[])[] = [
    [],
    [{ intensity: .4, color: [255, 0, 255], radius: 150, duration: 15 }, { intensity: 1, color: [255, 0, 255], radius: 150, duration: 15 }],
    [{ intensity: .4, color: [255, 255, 255], radius: 150, duration: 15 }, { intensity: 1, color: [255, 255, 255], radius: 150, duration: 15 }],
    [{ intensity: .4, color: [0, 0, 255], radius: 150, duration: 15 }, { intensity: 1, color: [0, 0, 255], radius: 150, duration: 15 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 150, duration: 15 }, { intensity: 1, color: [255, 0, 0], radius: 150, duration: 15 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 150, duration: 15 }, { intensity: 1, color: [255, 100, 100], radius: 110, duration: 15 }],
    [{ intensity: .4, color: [255, 255, 255], radius: 300, duration: 25 }, { intensity: 1, color: [255, 255, 255], radius: 300, duration: 25 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 150, duration: 15 }, { intensity: 1, color: [255, 0, 0], radius: 110, duration: 15 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 500, duration: 8 }, { intensity: 1, color: [255, 100, 100], radius: 470, duration: 2 }],
    [{ intensity: 1, color: [200, 200, 200], radius: 500, duration: 4 }, { intensity: 1, color: [150, 50, 50], radius: 350, duration: 2 }],
    [{ intensity: 1, color: [0, 100, 255], radius: 150, duration: 15 }, { intensity: 1, color: [0, 250, 255], radius: 150, duration: 15 }],
    [{ intensity: .4, color: [255, 255, 255], radius: 150, duration: 8 }, { intensity: 1, color: [255, 255, 255], radius: 150, duration: 8 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 20, duration: 15 }, { intensity: 1, color: [255, 0, 0], radius: 110, duration: 15 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 150, duration: 1 }, { intensity: 1, color: [0, 0, 0], radius: 150, duration: 14 }, { intensity: 1, color: [255, 255, 255], radius: 150, duration: 1 }, { intensity: 1, color: [0, 0, 0], radius: 150, duration: 14 }],
    [{ intensity: .4, color: [255, 255, 255], radius: 100, duration: 15 }, { intensity: 1, color: [255, 255, 255], radius: 100, duration: 15 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 150, duration: 15 }, { intensity: 1, color: [120, 255, 255], radius: 120, duration: 15 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 100, duration: 5 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 120, duration: 25 }, { intensity: 1, color: [255, 255, 255], radius: 300, duration: 25 }],
    [{ intensity: .4, color: [255, 255, 255], radius: 150, duration: 25 }, { intensity: 1, color: [255, 255, 255], radius: 150, duration: 25 }],
    [{ intensity: 1, color: [255, 255, 255], radius: 150, duration: 25 }, { intensity: 1, color: [255, 0, 0], radius: 150, duration: 25 }],
    [{ intensity: 1, color: [0, 150, 255], radius: 300, duration: 25 }, { intensity: 1, color: [0, 150, 255], radius: 120, duration: 25 }],
    [{ intensity: .4, color: [255, 100, 100], radius: 180, duration: 15 }, { intensity: 1, color: [255, 100, 100], radius: 225, duration: 15 }],
    [{ intensity: .4, color: [100, 170, 100], radius: 180, duration: 15 }, { intensity: 1, color: [100, 170, 100], radius: 225, duration: 15 }],
    [{ intensity: .4, color: [255, 200, 120], radius: 180, duration: 15 }, { intensity: 1, color: [255, 200, 120], radius: 225, duration: 15 }],
    [{ intensity: .4, color: [130, 70, 255], radius: 180, duration: 15 }, { intensity: 1, color: [130, 70, 255], radius: 225, duration: 15 }],
    [{ intensity: .4, color: [0, 80, 255], radius: 180, duration: 15 }, { intensity: 1, color: [0, 80, 255], radius: 225, duration: 15 }],
    [{ intensity: .4, color: [255, 255, 255], radius: 180, duration: 15 }, { intensity: 1, color: [255, 255, 255], radius: 225, duration: 15 }],
    [{ intensity: .4, color: [255, 255, 255], radius: 250, duration: 20 }, { intensity: 1, color: [255, 255, 255], radius: 300, duration: 20 }],
];

export function buildDynamicLights(
    setup: Setup,
    loadPropGeometry: (type: number) => DataView,
    actorResources: ActorLightResources,
): DynamicLight[] {
    const lights: DynamicLight[] = [];
    for (const prop of setup.props) {
        // Model2 selects from lightAnimations with 0x2E.
        // func_global_asm_80663FCC handles flames and torches through
        // the particle-effect system.
        if (prop.lightAnimation === 0)
            continue;
        const animation = lightAnimations[prop.lightAnimation];
        if (animation === undefined || animation.length === 0)
            continue;
        const maxDistance = loadPropGeometry(prop.type).getUint16(0x1E, false);
        lights.push({
            kind: 'point',
            origin: vec3.fromValues(prop.position[0] * 3, prop.position[1] * 3, prop.position[2] * 3),
            animation,
            // func_global_asm_8065EB10: vary light animation phase to avoid synchronization.
            phase: prop.setupIndex,
            maxDistance: maxDistance > 0 ? maxDistance : 700,
        });
    }
    for (const actor of setup.actors) {
        const definition = getActorRenderDefinition(actor.type, 0);
        if (definition === null || definition.lightBone === undefined || definition.animation === null)
            continue;
        const actorGeometry = actorResources.loadActorGeometry(definition.model);
        const animationData = actorResources.loadAnimation(definition.animation);
        if (actorGeometry === null || animationData === null)
            continue;
        const skeleton = parseActorSkeleton(actorGeometry);
        lights.push({
            kind: 'spot',
            origin: vec3.fromValues((actor.position[0] + 0.3) * 3, actor.position[1] * 3, actor.position[2] * 3),
            color: [
                actor.lightColor[0] / 0xFF,
                actor.lightColor[1] / 0xFF,
                actor.lightColor[2] / 0xFF,
            ],
            innerAngle: actor.lightCone[0] !== 0 ? actor.lightCone[0] : 25,
            outerAngle: actor.lightCone[1] !== 0 ? actor.lightCone[1] : 65,
            speed: actor.lightSpeed,
            rotationY: actor.rotationY / 0x1000 * Math.PI * 2,
            maxDistance: 700,
            animation: parseActorAnimation(animationData, skeleton.offsets.length, definition.animation),
            skeleton,
            scale: actor.scale * actorModelScale,
            targetBone: definition.lightBone,
        });
    }
    return lights;
}

function filterDynamicLightsForVertices(sharedOutput: RSPSharedOutput, vertexIndices: readonly number[], lights: readonly DynamicLight[]): DynamicLight[] {
    if (vertexIndices.length === 0)
        return [];
    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    for (const vertexIndex of vertexIndices) {
        const vertex = sharedOutput.vertices[vertexIndex];
        min[0] = Math.min(min[0], vertex.x);
        min[1] = Math.min(min[1], vertex.y);
        min[2] = Math.min(min[2], vertex.z);
        max[0] = Math.max(max[0], vertex.x);
        max[1] = Math.max(max[1], vertex.y);
        max[2] = Math.max(max[2], vertex.z);
    }
    return lights.filter((light) => {
        const radius = light.kind === 'point'
            ? Math.max(...light.animation.map((keyframe) => keyframe.radius)) * 3
            : 1100;
        let distanceSquared = 0;
        for (let axis = 0; axis < 3; axis++) {
            const delta = light.origin[axis] < min[axis]
                ? min[axis] - light.origin[axis]
                : light.origin[axis] > max[axis] ? light.origin[axis] - max[axis] : 0;
            distanceSquared += delta * delta;
        }
        return distanceSquared < radius * radius;
    });
}

export function buildMapChunkLighting(
    sharedOutput: RSPSharedOutput,
    drawCalls: readonly RelitDrawCall[],
    firstVertex: number,
    vertexSourceAddresses: readonly number[],
    sectionVertexOffset: number,
    chunk: RelitMapChunk | null,
    lights: readonly DynamicLight[],
): DynamicLighting | undefined {
    if (chunk === null || !chunk.modulateVertexColors)
        return undefined;

    const animatedMaterialVertices = new Set<number>();
    for (const drawCall of drawCalls) {
        if (!drawCall.textureBindings.some((binding) => binding.animation !== undefined))
            continue;
        const indexEnd = drawCall.firstIndex + drawCall.indexCount;
        for (let index = drawCall.firstIndex; index < indexEnd; index++)
            animatedMaterialVertices.add(sharedOutput.indices[index]);
    }

    const vertexIndices: number[] = [];
    const chunkVertexEnd = chunk.vertOffset + chunk.vertSize;
    for (let vertexIndex = firstVertex; vertexIndex < sharedOutput.vertices.length; vertexIndex++) {
        // Animated torches are self-lit.
        if (animatedMaterialVertices.has(vertexIndex))
            continue;
        const sourceAddress = vertexSourceAddresses[vertexIndex];
        if ((sourceAddress >>> 24) !== 0x06)
            continue;
        // Convert from segment 6 to the map vertex buffer.
        const sourceOffset = sectionVertexOffset + (sourceAddress & 0x00FFFFFF);
        if (sourceOffset >= chunk.vertOffset && sourceOffset < chunkVertexEnd)
            vertexIndices.push(vertexIndex);
    }
    if (vertexIndices.length === 0)
        return undefined;

    // func_global_asm_80655410: only flagged chunks are relit by dynamic lights.
    return {
        ambientColor: chunk.ambientColor,
        modulateVertexColors: chunk.modulateVertexColors,
        vertexIndices,
        lights: filterDynamicLightsForVertices(sharedOutput, vertexIndices, lights),
    };
}

function sampleActiveLight(light: DynamicLight, camera: ArrayLike<number>, tick: number, bonePosition: vec3): ActiveLight | null {
    const cameraDistance = Math.hypot(
        camera[12] - light.origin[0],
        camera[13] - light.origin[1],
        camera[14] - light.origin[2],
    ) / 3;
    const distanceRatio = cameraDistance / light.maxDistance;
    const cameraFade = distanceRatio < .8 ? 1 : Math.max(0, 1 - (distanceRatio - .8) / .2);
    if (cameraFade === 0)
        return null;
    if (light.kind === 'spot') {
        // func_global_asm_8069AB74: the light is hanging off the 3rd bone
        sampleActorBonePosition(bonePosition, light.skeleton, light.animation, light.speed, tick, light.targetBone);
        vec3.scale(bonePosition, bonePosition, light.scale);
        const sinY = Math.sin(light.rotationY);
        const cosY = Math.cos(light.rotationY);
        const direction = vec3.fromValues(
            cosY * bonePosition[0] + sinY * bonePosition[2] - 0.3,
            bonePosition[1],
            -sinY * bonePosition[0] + cosY * bonePosition[2],
        );
        vec3.normalize(direction, direction);
        return {
            origin: light.origin,
            // from func_global_asm_8065C990
            innerRadius: 300,
            outerRadius: 1100,
            color: [
                light.color[0] * cameraFade,
                light.color[1] * cameraFade,
                light.color[2] * cameraFade,
            ],
            direction,
            innerConeCos: Math.cos(light.innerAngle * Math.PI / 180),
            outerConeCos: Math.cos(light.outerAngle * Math.PI / 180),
        };
    }
    const keyframes = light.animation;
    const totalDuration = keyframes.reduce((sum, keyframe) => sum + keyframe.duration, 0);
    let animationTick = (tick + light.phase) % totalDuration;
    let keyframeIndex = 0;
    while (animationTick >= keyframes[keyframeIndex].duration) {
        animationTick -= keyframes[keyframeIndex].duration;
        keyframeIndex++;
    }
    const current = keyframes[keyframeIndex];
    const next = keyframes[(keyframeIndex + 1) % keyframes.length];
    const t = animationTick / current.duration;
    const radius = current.radius + (next.radius - current.radius) * t;
    const intensity = (current.intensity + (next.intensity - current.intensity) * t) * cameraFade;
    return {
        origin: light.origin,

        innerRadius: radius,
        outerRadius: radius * 3,  // from func_global_asm_8065BAA0
        color: [
            (current.color[0] + (next.color[0] - current.color[0]) * t) / 0xFF * intensity,
            (current.color[1] + (next.color[1] - current.color[1]) * t) / 0xFF * intensity,
            (current.color[2] + (next.color[2] - current.color[2]) * t) / 0xFF * intensity,
        ],
    };
}

function sampleLightAtPosition(light: ActiveLight, x: number, y: number, z: number): number {
    const dx = x - light.origin[0];
    const dy = y - light.origin[1];
    const dz = z - light.origin[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance >= light.outerRadius)
        return 0;
    let falloff = distance < light.innerRadius ? 1 : 1 - (distance - light.innerRadius) / (light.outerRadius - light.innerRadius);
    if (light.direction !== undefined) {
        if (distance === 0)
            return 0;
        const coneDot = (dx * light.direction[0] + dy * light.direction[1] + dz * light.direction[2]) / distance;
        if (coneDot < light.outerConeCos!)
            return 0;
        if (coneDot < light.innerConeCos!)
            falloff *= (coneDot - light.outerConeCos!) / (light.innerConeCos! - light.outerConeCos!);
    }
    return falloff;
}

export function sampleObjectLighting(dst: vec3, lighting: ObjectLighting, activeLightCache: ActiveLightCache, enabled: boolean): vec3 {
    if (!enabled)
        return vec3.set(dst, 1, 1, 1);

    vec3.copy(dst, lighting.ambientColor);
    for (const dynamicLight of lighting.lights) {
        const light = activeLightCache.get(dynamicLight);
        if (light === undefined)
            continue;
        const falloff = sampleLightAtPosition(light, lighting.origin[0], lighting.origin[1], lighting.origin[2]);
        dst[0] += light.color[0] * falloff;
        dst[1] += light.color[1] * falloff;
        dst[2] += light.color[2] * falloff;
    }
    dst[0] = Math.min(1, dst[0]);
    dst[1] = Math.min(1, dst[1]);
    dst[2] = Math.min(1, dst[2]);
    return dst;
}

export function updateDynamicLighting(lighting: DynamicLighting, vertices: readonly Vertex[], vertexBufferData: Float32Array, vertexBufferFirstVertex: number, activeLightCache: ActiveLightCache, enabled: boolean): void {
    if (!enabled) {
        for (const vertexIndex of lighting.vertexIndices) {
            const vertex = vertices[vertexIndex];
            const dst = (vertexIndex - vertexBufferFirstVertex) * 10 + 6;
            vertexBufferData[dst + 0] = vertex.c0;
            vertexBufferData[dst + 1] = vertex.c1;
            vertexBufferData[dst + 2] = vertex.c2;
        }
        return;
    }

    // func_global_asm_80655410: relight flagged map chunks.
    // props/actors use sampleObjectLighting instead.
    for (const vertexIndex of lighting.vertexIndices) {
        const vertex = vertices[vertexIndex];
        let red = lighting.ambientColor[0];
        let green = lighting.ambientColor[1];
        let blue = lighting.ambientColor[2];
        for (const dynamicLight of lighting.lights) {
            const light = activeLightCache.get(dynamicLight);
            if (light === undefined)
                continue;
            const falloff = sampleLightAtPosition(light, vertex.x, vertex.y, vertex.z);
            if (falloff <= 0)
                continue;
            red += light.color[0] * falloff;
            green += light.color[1] * falloff;
            blue += light.color[2] * falloff;
        }
        const dst = (vertexIndex - vertexBufferFirstVertex) * 10 + 6;
        const baseRed = lighting.modulateVertexColors ? vertex.c0 : 1;
        const baseGreen = lighting.modulateVertexColors ? vertex.c1 : 1;
        const baseBlue = lighting.modulateVertexColors ? vertex.c2 : 1;
        // func_global_asm_8065C990: tint before clamping.
        vertexBufferData[dst + 0] = Math.min(1, red * baseRed);
        vertexBufferData[dst + 1] = Math.min(1, green * baseGreen);
        vertexBufferData[dst + 2] = Math.min(1, blue * baseBlue);
    }
}
