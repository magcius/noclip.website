
import { vec3 } from 'gl-matrix';

import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { RSPState } from './f3dex2.js';
import { AnimatedTexture, RSPSharedOutput } from './f3dex2.js';
import { GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { initDL, initSpriteMaterial } from './material.js';
import { DK64Map } from './parse.js';
import type { InstanceScript, ScriptBlock, SetupProp } from './parse.js';
import { MeshData, RootMeshRenderer, SceneRenderLayer, SpriteBillboard } from './render.js';
import type { Mesh } from './render.js';
import type { DK64Renderer, ROMData } from './scenes.js';

function createSpriteVertexBuffer(sprite: SpriteData, quadCount = 1): ArrayBufferSlice {
    const buffer = new ArrayBuffer(quadCount * 4 * 0x10);
    const view = new DataView(buffer);
    const textureCoordinates = [
        0, 0,
        sprite.width << 5, 0,
        sprite.width << 5, sprite.height << 5,
        0, sprite.height << 5,
    ];
    for (let quad = 0; quad < quadCount; quad++) {
        for (let i = 0; i < 4; i++) {
            const offs = (quad * 4 + i) * 0x10;
            view.setInt16(offs + 0x08, textureCoordinates[i * 2]);
            view.setInt16(offs + 0x0A, textureCoordinates[i * 2 + 1]);
            view.setUint8(offs + 0x0C, 0xFF);
            view.setUint8(offs + 0x0D, 0xFF);
            view.setUint8(offs + 0x0E, 0xFF);
            view.setUint8(offs + 0x0F, 0xFF);
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

function addSpriteParticleEvents(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, definition: SpriteData, events: SpriteParticleEvent[], scale: number, loopTicks: number, frameDuration = 1, lifetime: number | undefined = definition.images.length * frameDuration, color: readonly number[] = definition.params.slice(0, 4), maxDistance?: number, fadeStartDistance?: number): void {
    const sourceTable = definition.table !== 0 ? romData.TexData : romData.AnimTexData;
    const sourceFrames = definition.images.map((image) => sourceTable[image]);
    const frames = sourceFrames.flatMap((frame) => new Array(frameDuration).fill(frame));
    const animationTickCount = frames.length;

    for (let phase = 0; phase < animationTickCount; phase++) {
        const phaseEvents = events.filter((event) => {
            const requestedTick = (event.frameOffset ?? 0) * frameDuration;
            const animationOffset = ((requestedTick - event.spawnTick) % animationTickCount + animationTickCount) % animationTickCount;
            return animationOffset === phase;
        });
        for (let eventBase = 0; eventBase < phaseEvents.length; eventBase += 8) {
            const batch = phaseEvents.slice(eventBase, eventBase + 8);
            const segment = 0x0E;
            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x08] = createSpriteVertexBuffer(definition, batch.length);
            const animation: AnimatedTexture[] = [{
                segment,
                // Ensure sprites on the same segment+phase don't overlap in the texture cache.
                group: definition.id,
                frameDuration: 1,
                frameOffset: phase,
                frames,
            }];
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, animation);
            initDL(state, false);
            initSpriteMaterial(state, definition, segment, color);
            const firstVertex = sharedOutput.vertices.length;
            for (let quad = 0; quad < batch.length; quad++) {
                state.gSPVertex(0x08000000 + quad * 4 * 0x10, 4, 0);
                state.gSPTri(0, 1, 2);
                state.gSPTri(0, 2, 3);
            }
            const output = state.finish()!;

            const width = definition.width * scale * 3;
            const height = definition.height * scale * 3;
            const mesh: Mesh = {
                sharedOutput,
                rspState: state,
                rspOutput: output,
                spriteBillboards: batch.map((event, index) => new SpriteBillboard(
                    firstVertex + index * 4,
                    event.origin,
                    width / 2,
                    height / 2,
                    {
                        spawnTick: lifetime === undefined ? undefined : event.spawnTick,
                        lifetime,
                        loopTicks: lifetime === undefined ? undefined : loopTicks,
                        velocityY: event.velocityY,
                        maxDistance,
                        fadeStartDistance,
                    },
                )),
            };
            const meshData = new MeshData(device, cache, mesh);
            sceneRenderer.meshDatas.push(meshData);
            const renderer = new RootMeshRenderer(device, cache, meshData, SceneRenderLayer.Effects, sceneRenderer.fogParams, sceneRenderer.gpuTextureCache);
            renderer.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            renderer.setBackfaceCullingEnabled(false);
            sceneRenderer.meshRenderers.push(renderer);
        }
    }
}

function isAlwaysRunningInitialBlock(block: ScriptBlock): boolean {
    return block.conditions.length === 1
        && block.conditions[0].opcode === 1
        && block.conditions[0].args[0] === 0
        && !block.executions.some((command) => command.opcode === 1);
}

function nextEffectRandom(state: { value: number }): number {
    // The game uses its own RNG, this isolated RNG is simpler.
    state.value = (Math.imul(state.value, 0x41C64E6D) + 0x3039) >>> 0;
    return state.value >>> 16;
}

function interpolateEnvironmentParticle(entry: EnvironmentParticleData, offset: number): vec3 {
    return vec3.fromValues(
        (entry.start[0] + (entry.end[0] - entry.start[0]) * offset) * 3,
        (entry.start[1] + (entry.end[1] - entry.start[1]) * offset) * 3,
        (entry.start[2] + (entry.end[2] - entry.start[2]) * offset) * 3,
    );
}

export function addEnvironmentalEffects(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, map: DK64Map, mapID: number, props: readonly SetupProp[], scripts: InstanceScript[]): void {
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
                        origin: interpolateEnvironmentParticle(entry, ((nextEffectRandom(random) % 10000) % 1000) / 1000),
                        spawnTick: tick,
                        velocityY: 1.7 * 3,
                    });
                }
            }
            const drawDistance = entry.distance * 3;
            // from func_global_asm_80717B64: particle spawn alpha control
            addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, baseSpray, baseEvents, entry.baseScale, loopTicks, 3, 18, [0xFF, 0xFF, 0xFF, 0x96], drawDistance, drawDistance * 3 / 4);
            addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, risingSpray, risingEvents, entry.risingScale, loopTicks, 3, 30, [0xFF, 0xFF, 0xFF, 0x96], entry.distance * 3);
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
                if (functionAddress === 0x80644EC8) {
                    const definition = spriteByAddress.get(0x80720A7C)!;
                    const frequency = command.args[1];
                    const requestedPointCount = command.args[2];
                    const random = { value: (mapID << 16) ^ script.id ^ 0x44EC8 };
                    const events: SpriteParticleEvent[] = [];
                    for (let tick = 0; tick < loopTicks; tick++) {
                        for (let set = 0; set < 2; set++) {
                            if ((nextEffectRandom(random) % frequency) !== 0)
                                continue;
                            const points = map.effectPointSets[set]!;
                            const pointCount = Math.min(requestedPointCount, points.length);
                            const point = points[nextEffectRandom(random) % pointCount];
                            events.push({
                                origin: vec3.fromValues(point[0] * 3, point[1] * 3, point[2] * 3),
                                spawnTick: tick,
                            });
                        }
                    }
                    addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, definition, events, 1.2, loopTicks);
                }
            }
        }
    }
}
