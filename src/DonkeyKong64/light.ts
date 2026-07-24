import { vec3 } from 'gl-matrix';

import type ArrayBufferSlice from '../ArrayBufferSlice.js';
import type { RSPSharedOutput, Vertex } from '../BanjoKazooie/f3dex.js';

interface LightSetupProp {
    type: number;
    position: vec3;
    lightAnimation: number;
    setupIndex: number;
}

interface SetupActor {
    type: number;
    position: vec3;
    rotationY: number;
    lightSpeed: number;
    lightColor: readonly [number, number, number];
    lightCone: readonly [number, number];
}

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
}

export type DynamicLight = DynamicPointLight | DynamicSpotLight;

export interface DynamicLighting {
    ambientColor: vec3;
    modulateVertexColors: boolean;
    vertexIndices: readonly number[];
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
    textureAnimationIndices: readonly (readonly number[])[];
}

interface ActiveLight {
    origin: vec3;
    innerRadius: number;
    outerRadius: number;
    color: [number, number, number];
    direction?: vec3;
    innerConeCos?: number;
    outerConeCos?: number;
}

// Rotation channel from actor animation 0x402.
const swingingLightAnimation = [15, 53, 108, 171, 233, 288, 325, 341, 325, 289, 234, 171, 109, 53, 15, 0] as const;
const swingingLightAnimationCenter = (Math.min(...swingingLightAnimation) + Math.max(...swingingLightAnimation)) / 2;
// func_global_asm_80613CA8 uses AnimFile::unk12 - 1 as the final frame.
// Animation 0x402 has unk12 == 0x10.
const swingingLightFrameCount = 0x10;
// AnimFile::unk0, copied to AnimationStateUnk0::unk24 by
// func_global_asm_80613CA8 and multiplied into the frame advance.
const swingingLightPlaybackRate = 0.1;

// D_global_asm_80748430, consumed by func_global_asm_8065EB10. Entry zero is
// the "no light" setup value; the remaining indices are the game's keyframes.
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

function parseSetupActors(data: ArrayBufferSlice): SetupActor[] {
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
            rotationY: view.getInt16(offs + 0x30, false),
            lightSpeed: view.getFloat32(offs + 0x10, false),
            // The actor behavior loads these s32 fields through u16
            // temporaries and createLight finally truncates them to u8.
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

function parseSetupProps(data: ArrayBufferSlice): LightSetupProp[] {
    const view = data.createDataView();
    const count = view.getUint32(0, false);
    const props: LightSetupProp[] = [];
    for (let i = 0; i < count; i++) {
        const offs = 4 + i * 0x30;
        props.push({
            type: view.getUint16(offs + 0x28, false),
            position: vec3.fromValues(
                view.getFloat32(offs + 0x00, false),
                view.getFloat32(offs + 0x04, false),
                view.getFloat32(offs + 0x08, false),
            ),
            lightAnimation: view.getUint8(offs + 0x2E),
            setupIndex: i,
        });
    }
    return props;
}

export function buildDynamicLights(setup: ArrayBufferSlice, loadPropGeometry: (type: number) => DataView): DynamicLight[] {
    const lights: DynamicLight[] = [];
    for (const prop of parseSetupProps(setup)) {
        // Every model-two setup entry can select one of
        // D_global_asm_80748430's light animations through byte 0x2E.
        // func_global_asm_80663FCC's smaller flame/torch type list belongs to
        // the nearby particle-effect system and is not a light eligibility
        // test. In particular, B0's invisible "torches" markers (0x241) use
        // animations 0x0A and 0x17.
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
            // func_global_asm_8065EB10 adds the model instance index to
            // object_timer so nearby flames do not pulse in lockstep.
            phase: prop.setupIndex,
            maxDistance: maxDistance > 0 ? maxDistance : 700,
        });
    }
    for (const actor of parseSetupActors(setup)) {
        // Setup actor types are the runtime Actors enum minus 0x10.
        // 0x10 is ACTOR_SWINGING_LIGHT and 0x2A is the otherwise easy to
        // miss ACTOR_SWINGING_LIGHT_2 ("Cave light", model 0x97). Both use
        // func_global_asm_8069AB74 and animation 0x402.
        // TODO: Extract and render the swinging-light actor geometry (models
        // 0x81 and 0x97), including its animated bone matrices.
        if (actor.type !== 0x10 && actor.type !== 0x2A)
            continue;
        lights.push({
            kind: 'spot',
            // The original uses x_position + 0.3 as the cone source.
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
            // createLight's default visibility distance; this behavior does
            // not override it.
            maxDistance: 700,
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
        if (!drawCall.textureAnimationIndices.some((indices) => indices.length > 0))
            continue;
        const indexEnd = drawCall.firstIndex + drawCall.indexCount;
        for (let index = drawCall.firstIndex; index < indexEnd; index++)
            animatedMaterialVertices.add(sharedOutput.indices[index]);
    }

    const vertexIndices: number[] = [];
    const chunkVertexEnd = chunk.vertOffset + chunk.vertSize;
    for (let vertexIndex = firstVertex; vertexIndex < sharedOutput.vertices.length; vertexIndex++) {
        // B0's animated torch material uses the authored vertex-color path
        // rather than the chunk's CPU-relit copy.
        if (animatedMaterialVertices.has(vertexIndex))
            continue;
        const sourceAddress = vertexSourceAddresses[vertexIndex];
        if ((sourceAddress >>> 24) !== 0x06)
            continue;
        // Segment 6 is rebound to this display list's section vertex base.
        // Convert the address back into the complete map vertex buffer.
        const sourceOffset = sectionVertexOffset + (sourceAddress & 0x00FFFFFF);
        if (sourceOffset >= chunk.vertOffset && sourceOffset < chunkVertexEnd)
            vertexIndices.push(vertexIndex);
    }
    if (vertexIndices.length === 0)
        return undefined;

    // func_global_asm_80655410 only copies and relights map chunks whose
    // header flag is set. Ambient still applies when no light reaches them.
    return {
        ambientColor: chunk.ambientColor,
        modulateVertexColors: chunk.modulateVertexColors,
        vertexIndices,
        lights: filterDynamicLightsForVertices(sharedOutput, vertexIndices, lights),
    };
}

function sampleActiveLights(lights: readonly DynamicLight[], camera: ArrayLike<number>, tick: number): ActiveLight[] {
    const activeLights: ActiveLight[] = [];
    for (const light of lights) {
        const cameraDistance = Math.hypot(
            camera[12] - light.origin[0],
            camera[13] - light.origin[1],
            camera[14] - light.origin[2],
        ) / 3;
        const distanceRatio = cameraDistance / light.maxDistance;
        const cameraFade = distanceRatio < .8 ? 1 : Math.max(0, 1 - (distanceRatio - .8) / .2);
        if (cameraFade === 0)
            continue;
        if (light.kind === 'spot') {
            // Animation 0x402 is a 16-frame pendulum curve.
            // func_global_asm_8061421C advances the animation by the actor
            // multiplier times the animation file's own rate.
            const animationFrame = ((tick * light.speed * swingingLightPlaybackRate) % swingingLightFrameCount + swingingLightFrameCount) % swingingLightFrameCount;
            const samplePosition = animationFrame / swingingLightFrameCount * swingingLightAnimation.length;
            const sampleIndex = Math.floor(samplePosition);
            const nextSampleIndex = (sampleIndex + 1) % swingingLightAnimation.length;
            const sampleT = samplePosition - sampleIndex;
            const sample = swingingLightAnimation[sampleIndex]
                + (swingingLightAnimation[nextSampleIndex] - swingingLightAnimation[sampleIndex]) * sampleT;
            const swing = (sample - swingingLightAnimationCenter) * 0.1 * Math.PI / 180;
            const localX = Math.sin(swing);
            const direction = vec3.fromValues(
                Math.cos(light.rotationY) * localX,
                -Math.cos(swing),
                -Math.sin(light.rotationY) * localX,
            );
            vec3.normalize(direction, direction);
            activeLights.push({
                origin: light.origin,
                // func_global_asm_8065C990 uses these literal distances
                // against the map's three-times-scale vertex coordinates.
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
            });
            continue;
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
        activeLights.push({
            origin: light.origin,
            // func_global_asm_8065BAA0 converts createLight's radius R into
            // an inner radius of R and an outer radius of 3R for the raw map
            // vertices consumed by func_global_asm_8065C990.
            innerRadius: radius,
            outerRadius: radius * 3,
            color: [
                (current.color[0] + (next.color[0] - current.color[0]) * t) / 0xFF * intensity,
                (current.color[1] + (next.color[1] - current.color[1]) * t) / 0xFF * intensity,
                (current.color[2] + (next.color[2] - current.color[2]) * t) / 0xFF * intensity,
            ],
        });
    }
    return activeLights;
}

export function updateDynamicLighting(lighting: DynamicLighting, vertices: readonly Vertex[], vertexBufferData: Float32Array, camera: ArrayLike<number>, tick: number, enabled: boolean): void {
    if (!enabled) {
        for (const vertexIndex of lighting.vertexIndices) {
            const vertex = vertices[vertexIndex];
            const dst = vertexIndex * 10 + 6;
            vertexBufferData[dst + 0] = vertex.c0;
            vertexBufferData[dst + 1] = vertex.c1;
            vertexBufferData[dst + 2] = vertex.c2;
        }
        return;
    }

    const activeLights = sampleActiveLights(lighting.lights, camera, tick);
    for (const vertexIndex of lighting.vertexIndices) {
        const vertex = vertices[vertexIndex];
        let red = lighting.ambientColor[0];
        let green = lighting.ambientColor[1];
        let blue = lighting.ambientColor[2];
        for (const light of activeLights) {
            const dx = vertex.x - light.origin[0];
            const dy = vertex.y - light.origin[1];
            const dz = vertex.z - light.origin[2];
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance >= light.outerRadius)
                continue;
            let falloff = distance < light.innerRadius ? 1 : 1 - (distance - light.innerRadius) / (light.outerRadius - light.innerRadius);
            if (light.direction !== undefined) {
                if (distance === 0)
                    continue;
                const coneDot = (dx * light.direction[0] + dy * light.direction[1] + dz * light.direction[2]) / distance;
                if (coneDot < light.outerConeCos!)
                    continue;
                if (coneDot < light.innerConeCos!)
                    falloff *= (coneDot - light.outerConeCos!) / (light.innerConeCos! - light.outerConeCos!);
            }
            if (falloff <= 0)
                continue;
            red += light.color[0] * falloff;
            green += light.color[1] * falloff;
            blue += light.color[2] * falloff;
        }
        // func_global_asm_80655410 relights the complete copied vertex
        // buffer of each flagged map chunk. Props and actors are separate
        // buffers and are not affected by this pass.
        const dst = vertexIndex * 10 + 6;
        const baseRed = lighting.modulateVertexColors ? vertex.c0 : 1;
        const baseGreen = lighting.modulateVertexColors ? vertex.c1 : 1;
        const baseBlue = lighting.modulateVertexColors ? vertex.c2 : 1;
        // func_global_asm_8065C990 applies the vertex tint before clamping.
        vertexBufferData[dst + 0] = Math.min(1, red * baseRed);
        vertexBufferData[dst + 1] = Math.min(1, green * baseGreen);
        vertexBufferData[dst + 2] = Math.min(1, blue * baseBlue);
    }
}
