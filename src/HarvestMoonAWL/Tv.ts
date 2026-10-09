// TV Easter egg - Press F on the TV in the player's house

import { ReadonlyMat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as Gpl from "./Gpl.js";
import { cameraRay } from "./Util.js";
import type { ModelInstance } from "./Render.js";

//#region .agc format

const AGC_MAGIC = 0xC1C7C3C6;

export interface TvQuad {
    textureIndex: number;
    x0: number; y0: number; x1: number; y1: number;
    u0: number; v0: number; u1: number; v1: number;
}

export interface TvCel {
    quads: TvQuad[];
    dx: number; dy: number;
}

export interface TvStep {
    cels: TvCel[];
    durationMs: number;
}

export interface TvAnimation {
    index: number;
    steps: TvStep[];
    totalMs: number;
}

export function parseAgc(data: ArrayBufferSlice): TvAnimation[] {
    const view = data.createDataView();
    const magic = view.getUint32(0x00);
    if (magic !== AGC_MAGIC)
        throw new Error(`not an AGC file (magic was 0x${magic.toString(16)})`);
    const numAnimations = view.getUint32(0x04);
    const animTableOffset = view.getUint32(0x08);

    const animations: TvAnimation[] = [];
    for (let i = 0; i < numAnimations; i++) {
        const numSteps = view.getUint32(animTableOffset + i * 0x08 + 0x00);
        const stepsOffset = view.getUint32(animTableOffset + i * 0x08 + 0x04);

        const steps: TvStep[] = [];
        let totalMs = 0;
        for (let j = 0; j < numSteps; j++) {
            const stepOffset = stepsOffset + j * 0x14;
            const numCels = view.getUint32(stepOffset + 0x00);
            const celOffset = view.getUint32(stepOffset + 0x04);
            const durationMs = view.getUint32(stepOffset + 0x0C);

            const cels: TvCel[] = [];
            for (let k = 0; k < numCels; k++) {
                const o = celOffset + k * 0x0C;
                const numQuads = view.getUint32(o + 0x00);
                const quadsOffset = view.getUint32(o + 0x04);
                const dx = view.getInt16(o + 0x08);
                const dy = view.getInt16(o + 0x0A);

                const quads: TvQuad[] = [];
                for (let q = 0; q < numQuads; q++) {
                    const p = quadsOffset + q * 0x2C;
                    quads.push({
                        textureIndex: view.getUint32(p + 0x00),
                        x0: view.getInt16(p + 0x04), y0: view.getInt16(p + 0x06),
                        x1: view.getInt16(p + 0x08), y1: view.getInt16(p + 0x0A),
                        u0: view.getFloat32(p + 0x1C), v0: view.getFloat32(p + 0x20),
                        u1: view.getFloat32(p + 0x24), v1: view.getFloat32(p + 0x28),
                    });
                }
                cels.push({ quads, dx, dy });
            }
            steps.push({ cels, durationMs });
            totalMs += durationMs;
        }
        animations.push({ index: i, steps, totalMs });
    }
    return animations;
}

//#endregion

//#region TV Channels

export interface TvChannel {
    name: string;
    layers: number[];
}

// There are many weather combinations for forecast/time, choosing one of them
export const WEATHER_BACKDROP = 23;
export const WEATHER_ANNOUNCER = 0;
export const WEATHER_FORECAST = 4;

export const CHANNELS: TvChannel[] = [
    { name: `Weather`, layers: [WEATHER_BACKDROP, WEATHER_ANNOUNCER, WEATHER_FORECAST] },
    { name: `News`, layers: [19] },
    { name: `Pop culture`, layers: [20] },
    { name: `Horoscope`, layers: [21] },
    { name: `Drama`, layers: [25] },
];

export const CANVAS_W = 192;
export const CANVAS_H = 144;

//#endregion

//#region Placing Screen Quad

export const SCREEN_BLOCK_INDEX = 4;

const SCREEN_X0 = -0.40625, SCREEN_X1 = 0.40625;
const SCREEN_Y0 = 0.0, SCREEN_Y1 = 0.609375;
const SCREEN_U0 = 0.012195, SCREEN_U1 = 0.987805;
const SCREEN_V_TOP = 0.015575, SCREEN_V_BOTTOM = 0.985615;

const Z_BASE = 0.004;
const Z_PER_LAYER = 0.004;
const Z_PER_QUAD = 0.00006;

function canvasToLocalX(px: number): number {
    const u = px / CANVAS_W;
    return SCREEN_X0 + ((u - SCREEN_U0) / (SCREEN_U1 - SCREEN_U0)) * (SCREEN_X1 - SCREEN_X0);
}

function canvasToLocalY(py: number): number {
    const v = py / CANVAS_H;
    return SCREEN_Y1 - ((v - SCREEN_V_TOP) / (SCREEN_V_BOTTOM - SCREEN_V_TOP)) * (SCREEN_Y1 - SCREEN_Y0);
}

export interface TvStepMesh {
    mesh: Gpl.DecodedMesh;
    imageIndexByTriangle: number[];
}

export function buildStepMesh(step: TvStep, layerSlot: number): TvStepMesh {
    const positions: [number, number, number][] = [];
    const uvs: [number, number][] = [];
    const triangles: [Gpl.GxVertex, Gpl.GxVertex, Gpl.GxVertex][] = [];
    const triangleOffsets: number[] = [];
    const imageIndexByTriangle: number[] = [];

    let drawIndex = 0;
    for (const cel of step.cels) {
        for (const quad of cel.quads) {
            const z = Z_BASE + layerSlot * Z_PER_LAYER + drawIndex * Z_PER_QUAD;
            drawIndex++;

            const x0 = canvasToLocalX(quad.x0 + cel.dx), x1 = canvasToLocalX(quad.x1 + cel.dx);
            const yTop = canvasToLocalY(quad.y0 + cel.dy), yBottom = canvasToLocalY(quad.y1 + cel.dy);

            const halfTexelU = quad.x1 !== quad.x0 ? 0.5 * (quad.u1 - quad.u0) / (quad.x1 - quad.x0) : 0;
            const halfTexelV = quad.y1 !== quad.y0 ? 0.5 * (quad.v1 - quad.v0) / (quad.y1 - quad.y0) : 0;
            const u0 = quad.u0 + halfTexelU, u1 = quad.u1 - halfTexelU;
            const v0 = quad.v0 + halfTexelV, v1 = quad.v1 - halfTexelV;

            const base = positions.length;
            positions.push([x0, yTop, z], [x1, yTop, z], [x1, yBottom, z], [x0, yBottom, z]);
            uvs.push([u0, v0], [u1, v0], [u1, v1], [u0, v1]);

            const gv = (i: number): Gpl.GxVertex => ({ positionIndex: base + i, normalIndex: 0, uvIndex: base + i, color0Index: null });
            triangles.push([gv(0), gv(1), gv(2)], [gv(0), gv(2), gv(3)]);
            triangleOffsets.push(0, 0);
            imageIndexByTriangle.push(quad.textureIndex, quad.textureIndex);
        }
    }

    return { mesh: { positions, uvs, triangles, triangleOffsets }, imageIndexByTriangle };
}

//#endregion

//#region Live Screen

interface TvLayer {
    animation: TvAnimation;
    instances: ModelInstance[];
    elapsedMs: number;
}

export class TvScreen {
    public channel = -1;
    public enabled = true;
    public corners: [number, number, number][] = [];

    private layersByChannel: TvLayer[][] = [];

    constructor(channelLayers: TvLayer[][]) {
        this.layersByChannel = channelLayers;
    }

    public advance(): void {
        this.channel = this.channel + 1 >= CHANNELS.length ? -1 : this.channel + 1;
        if (this.channel >= 0)
            for (const layer of this.layersByChannel[this.channel])
                layer.elapsedMs = 0;
    }

    public turnOff(): void {
        this.channel = -1;
    }

    public get isOn(): boolean {
        return this.enabled && this.channel >= 0;
    }

    public update(deltaMs: number): void {
        for (let c = 0; c < this.layersByChannel.length; c++) {
            const active = this.enabled && c === this.channel;
            for (const layer of this.layersByChannel[c]) {
                if (!active) {
                    for (const inst of layer.instances)
                        inst.visible = false;
                    continue;
                }
                if (layer.animation.totalMs > 0)
                    layer.elapsedMs = (layer.elapsedMs + deltaMs) % layer.animation.totalMs;
                let acc = 0, current = 0;
                for (let s = 0; s < layer.animation.steps.length; s++) {
                    acc += layer.animation.steps[s].durationMs;
                    if (layer.elapsedMs < acc) {
                        current = s;
                        break;
                    }
                }
                for (let s = 0; s < layer.instances.length; s++)
                    layer.instances[s].visible = s === current;
            }
        }
    }
}

export function buildScreenLayers(
    animations: TvAnimation[],
    makeInstance: (animIndex: number, stepIndex: number, layerSlot: number, step: TvStep) => ModelInstance,
): TvScreen {
    const channelLayers: TvLayer[][] = CHANNELS.map((channel) => channel.layers.map((animIndex, layerSlot): TvLayer => {
        const animation = animations[animIndex];
        const instances = animation.steps.map((step, stepIndex) => {
            const inst = makeInstance(animIndex, stepIndex, layerSlot, step);
            inst.visible = false;
            return inst;
        });
        return { animation, instances, elapsedMs: 0 };
    }));
    return new TvScreen(channelLayers);
}

//#endregion

//#region Aiming at Screen

const scratchEye = vec3.create();
const scratchForward = vec3.create();
const scratchEdgeU = vec3.create();
const scratchEdgeV = vec3.create();
const scratchNormal = vec3.create();
const scratchToPlane = vec3.create();
const scratchHit = vec3.create();

const AIM_MAX_DISTANCE = 6.0;
const AIM_MARGIN = 0.25;

export function isAimedAtScreen(cameraWorldMatrix: ReadonlyMat4, corners: [number, number, number][]): boolean {
    if (corners.length !== 4)
        return false;
    cameraRay(scratchEye, scratchForward, cameraWorldMatrix);

    const [tl, tr, , bl] = corners;
    vec3.set(scratchEdgeU, tr[0] - tl[0], tr[1] - tl[1], tr[2] - tl[2]);
    vec3.set(scratchEdgeV, bl[0] - tl[0], bl[1] - tl[1], bl[2] - tl[2]);
    vec3.cross(scratchNormal, scratchEdgeU, scratchEdgeV);
    const normalLength = vec3.length(scratchNormal);
    if (normalLength === 0)
        return false;
    vec3.scale(scratchNormal, scratchNormal, 1 / normalLength);

    const denom = vec3.dot(scratchForward, scratchNormal);
    if (Math.abs(denom) < 1e-6)
        return false;
    vec3.set(scratchToPlane, tl[0] - scratchEye[0], tl[1] - scratchEye[1], tl[2] - scratchEye[2]);
    const t = vec3.dot(scratchToPlane, scratchNormal) / denom;
    if (t <= 0 || t > AIM_MAX_DISTANCE)
        return false;

    vec3.scaleAndAdd(scratchHit, scratchEye, scratchForward, t);
    vec3.sub(scratchHit, scratchHit, tl);
    const lenU = vec3.length(scratchEdgeU), lenV = vec3.length(scratchEdgeV);
    const u = vec3.dot(scratchHit, scratchEdgeU) / lenU;
    const v = vec3.dot(scratchHit, scratchEdgeV) / lenV;
    return u >= -AIM_MARGIN && u <= lenU + AIM_MARGIN && v >= -AIM_MARGIN && v <= lenV + AIM_MARGIN;
}

export function screenCornersWorld(worldMatrix: ReadonlyMat4): [number, number, number][] {
    const local: [number, number, number][] = [
        [SCREEN_X0, SCREEN_Y1, 0], [SCREEN_X1, SCREEN_Y1, 0],
        [SCREEN_X1, SCREEN_Y0, 0], [SCREEN_X0, SCREEN_Y0, 0],
    ];
    return local.map((p) => {
        const v = vec3.fromValues(p[0], p[1], p[2]);
        vec3.transformMat4(v, v, worldMatrix);
        return [v[0], v[1], v[2]] as [number, number, number];
    });
}

//#endregion
