import { vec3 } from 'gl-matrix';

import type { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import type { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { AnimatedTexture, RSPState } from './f3dex2.js';
import type { RSPSharedOutput } from './f3dex2.js';
import { initDL, initSpriteMaterial } from './material.js';
import type { DK64Map, InstanceScript, ScriptBlock, SetupProp } from './parse.js';
import { DK64Layer, SpriteBillboard } from './render.js';
import type { MeshInput } from './render.js';
import type { DK64Renderer, ROMData } from './scenes.js';

const verticesPerSprite = 4;
const spriteVertexStride = 16;
const maxSpritesPerBatch = 8;
const worldScale = 3;
const spriteVertexSegment = 0x08;
const spriteTextureSegment = 0x0E;

function createSpriteVertexBuffer(sprite: SpriteData, spriteCount = 1): ArrayBufferSlice {
    const textureCoordinateOffset = 8;
    const colorOffset = 12;
    const buffer = new ArrayBuffer(spriteCount * verticesPerSprite * spriteVertexStride);
    const view = new DataView(buffer);
    const maxS = sprite.width << 5;
    const maxT = sprite.height << 5;
    const positions = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    const textureCoordinates = [[0, 0], [maxS, 0], [maxS, maxT], [0, maxT]];
    for (let spriteIndex = 0; spriteIndex < spriteCount; spriteIndex++) {
        for (let vertex = 0; vertex < verticesPerSprite; vertex++) {
            const offs = (spriteIndex * verticesPerSprite + vertex) * spriteVertexStride;
            view.setInt16(offs + 0, positions[vertex][0]);
            view.setInt16(offs + 2, positions[vertex][1]);
            view.setInt16(offs + textureCoordinateOffset, textureCoordinates[vertex][0]);
            view.setInt16(offs + textureCoordinateOffset + 2, textureCoordinates[vertex][1]);
            for (let channel = 0; channel < 4; channel++)
                view.setUint8(offs + colorOffset + channel, 255);
        }
    }
    return new ArrayBufferSlice(buffer);
}

export interface SpriteData {
    address: number;
    id: number;
    imagesPerFrameHorizontal: number;
    imagesPerFrameVertical: number;
    flags: number;
    codec: number;
    params: number[];
    table: number;
    width: number;
    height: number;
    images: number[];
}

export interface EnvironmentParticleData {
    map: number;
    start: [number, number, number];
    end: [number, number, number];
    gap: number;
    distance: number;
    baseScale: number;
    risingScale: number;
}

interface SpriteParticleEvent {
    origin: vec3;
    spawnTick: number;
    frameOffset?: number;
    velocityY?: number;
}

function addSpriteParticleEvents(
    device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer,
    sharedOutput: RSPSharedOutput, romData: ROMData, definition: SpriteData,
    events: readonly SpriteParticleEvent[], scale: number, loopTicks: number,
    frameDuration = 1, lifetime: number | undefined = definition.images.length * frameDuration,
    color: readonly number[] = definition.params.slice(0, 4),
    maxDistance?: number, fadeStartDistance?: number,
): void {
    const sourceTable = definition.table !== 0 ? romData.TexData : romData.AnimTexData;
    const frames: ArrayBufferSlice[] = definition.images.flatMap((image) =>
        new Array(frameDuration).fill(sourceTable[image]));
    const animationTickCount = frames.length;
    const halfWidth = definition.width * scale * worldScale / 2;
    const halfHeight = definition.height * scale * worldScale / 2;
    const hasLifetime = lifetime !== undefined;

    for (let phase = 0; phase < animationTickCount; phase++) {
        const phaseEvents = events.filter((event) => {
            const requestedTick = (event.frameOffset ?? 0) * frameDuration;
            const animationOffset = ((requestedTick - event.spawnTick) % animationTickCount + animationTickCount) % animationTickCount;
            return animationOffset === phase;
        });
        for (let eventBase = 0; eventBase < phaseEvents.length; eventBase += maxSpritesPerBatch) {
            const batch = phaseEvents.slice(eventBase, eventBase + maxSpritesPerBatch);
            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[spriteVertexSegment] = createSpriteVertexBuffer(definition, batch.length);
            // Ensure sprites on the same segment+phase don't overlap in the texture cache.
            const animatedTextures = [new AnimatedTexture({
                segment: spriteTextureSegment,
                group: definition.id,
                frameDuration: 1,
                frames,
                frameOffset: phase,
            })];
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, animatedTextures);
            initDL(state, false);
            initSpriteMaterial(state, definition, spriteTextureSegment, color);
            for (let quad = 0; quad < batch.length; quad++) {
                const vertexAddress = (spriteVertexSegment << 24) + quad * verticesPerSprite * spriteVertexStride;
                state.gSPVertex(vertexAddress, verticesPerSprite, 0);
                state.gSPTri(0, 1, 2);
                state.gSPTri(0, 2, 3);
            }
            const output = state.finish()!;

            const geo: MeshInput = {
                sharedOutput,
                rspOutput: output,
                spriteBillboards: batch.map((event) => new SpriteBillboard(
                    event.origin,
                    halfWidth,
                    halfHeight,
                    {
                        spawnTick: hasLifetime ? event.spawnTick : undefined,
                        lifetime,
                        loopTicks: hasLifetime ? loopTicks : undefined,
                        velocityY: event.velocityY,
                        maxDistance,
                        fadeStartDistance,
                    },
                )),
            };
            const geoData = sceneRenderer.addGeoData(device, cache, geo);
            const renderer = sceneRenderer.addGeometryRenderer(device, cache, geoData, DK64Layer.Effects);
            renderer.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            renderer.setBackfaceCullingEnabled(false);
        }
    }
}

function isAlwaysRunningInitialBlock(block: ScriptBlock): boolean {
    if (block.conditions.length !== 1)
        return false;
    const condition = block.conditions[0];
    return condition.opcode === 1
        && condition.args[0] === 0
        && !block.executions.some((command) => command.opcode === 1);
}

function nextEffectRandom(state: { value: number }): number {
    // The game uses its own RNG, this isolated RNG is simpler.
    state.value = (Math.imul(state.value, 0x41C64E6D) + 0x3039) >>> 0;
    return state.value >>> 16;
}

function interpolateEnvironmentParticle(entry: EnvironmentParticleData, offset: number): vec3 {
    const position = vec3.lerp(vec3.create(), entry.start, entry.end, offset);
    return vec3.scale(position, position, worldScale);
}

export function addEnvironmentalEffects(
    device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer,
    sharedOutput: RSPSharedOutput, romData: ROMData, map: DK64Map, mapID: number,
    props: readonly SetupProp[], scripts: readonly InstanceScript[],
): void {
    const propsByID = new Map(props.map((prop) => [prop.id, prop]));
    const spriteByAddress = new Map(romData.SpriteData.map((sprite) => [sprite.address, sprite]));
    const loopTicks = 900;

    // from func_global_asm_80664CB0 + func_global_asm_80664D20:
    // ambient waterfall emitters.
    const baseSpray = spriteByAddress.get(0x8072140C);
    const risingSpray = spriteByAddress.get(0x8071FF18);
    if (baseSpray !== undefined && risingSpray !== undefined) {
        for (const [entryIndex, entry] of romData.EnvironmentParticleData.entries()) {
            if (entry.map !== mapID)
                continue;
            const random = { value: (mapID << 16) ^ entryIndex ^ 0x664D20 };
            const baseEvents: SpriteParticleEvent[] = [];
            const risingEvents: SpriteParticleEvent[] = [];
            for (let tick = 0; tick < loopTicks; tick++) {
                if (tick % 18 === 0) {
                    for (let offset = 0; offset <= 1.00001; offset += entry.gap) {
                        baseEvents.push({
                            origin: interpolateEnvironmentParticle(entry, Math.min(offset, 1)),
                            spawnTick: tick,
                            frameOffset: (nextEffectRandom(random) % 10000) % 6,
                        });
                    }
                }
                if (tick % 10 === 0) {
                    risingEvents.push({
                        origin: interpolateEnvironmentParticle(entry, (nextEffectRandom(random) % 1000) / 1000),
                        spawnTick: tick,
                        velocityY: 1.7 * worldScale,
                    });
                }
            }
            const sprayColor = [255, 255, 255, 150];
            const drawDistance = entry.distance * worldScale;
            const fadeStartDistance = drawDistance * 0.75;
            // from func_global_asm_80717B64: particle spawn alpha control
            addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, baseSpray, baseEvents, entry.baseScale, loopTicks, 3, 18, sprayColor, drawDistance, fadeStartDistance);
            addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, risingSpray, risingEvents, entry.risingScale, loopTicks, 3, 30, sprayColor, drawDistance);
        }
    }

    for (const script of scripts) {
        const prop = propsByID.get(script.id);
        if (prop === undefined)
            continue;
        for (const block of script.blocks) {
            if (!isAlwaysRunningInitialBlock(block))
                continue;
            for (const command of block.executions) {
                if (command.opcode !== 7)
                    continue;
                const functionAddress = romData.CustomScriptFunctionData[command.args[0]];

                // from func_global_asm_80644EC8: 2 sprites (D_global_asm_80720A7C) per tick
                if (functionAddress !== 0x80644EC8)
                    continue;

                const definition = spriteByAddress.get(0x80720A7C)!;
                const frequency = command.args[1];
                const requestedPointCount = command.args[2];
                const random = { value: (mapID << 16) ^ script.id ^ 0x44EC8 };
                const events: SpriteParticleEvent[] = [];
                for (let tick = 0; tick < loopTicks; tick++) {
                    for (let i = 0; i < 2; i++) {
                        if ((nextEffectRandom(random) % frequency) !== 0)
                            continue;
                        const points = map.effectPointSets[i]!;
                        const pointCount = Math.min(requestedPointCount, points.length);
                        const point = points[nextEffectRandom(random) % pointCount];
                        events.push({
                            origin: vec3.scale(vec3.create(), point, worldScale),
                            spawnTick: tick,
                        });
                    }
                }
                addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, definition, events, 1.2, loopTicks);
            }
        }
    }
}
