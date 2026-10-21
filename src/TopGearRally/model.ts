import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { loadVertexFromView } from "../Common/N64/RSP.js";
import { GfxBufferFrequencyHint, GfxCullMode, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { nArray } from "../util.js";
import { DrawCall, RSP_Geometry, RSPSharedOutput, RSPState, runDL_F3DEX } from "./f3dex.js";
import {
    GeometryBuffers,
    LightState,
    TGRDrawCallInstance,
    TRACK_COMBINE,
    TRACK_OTHER_MODE_H,
    TextureHandle,
    createGeometryBuffers,
    createTextureHandle,
    fillVertexData,
} from "./render.js";

export const MODEL_PART_LIGHT_RAMP = 0x0003;
export const MODEL_PART_TWO_SIDED = 0x0004;
export const MODEL_PART_TRANSLUCENT = 0x0008;
export const MODEL_PART_RAMPED = 0x0400;

const MODEL_ANIMATION_REPEAT = 0x1;
const MODEL_ANIMATION_BOUNCE = 0x2;
const MODEL_ANIMATION_REVERSING = 0x4;
const BLEND_ONE = 4096;
const BLEND_SHIFT = 12;
const MODEL_RENDER_MODE_Z = 0x0c192038;
const MODEL_RENDER_MODE_NO_Z = 0x0c192008;
const MODEL_GEOMETRY_MODE =
    RSP_Geometry.G_CULL_BACK | RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_LIGHTING | RSP_Geometry.G_SHADING_SMOOTH;

export const MODEL_SHADE_COLORS: [number, number, number][] = [
    [0x40, 0x40, 0x40],
    [0x80, 0x80, 0x80],
    [0xc0, 0xc0, 0xc0],
    [0xff, 0xff, 0xff],
];

interface ModelPart {
    displayList: number;
    flags: number;
    position: vec3;
}

interface ModelAnimation {
    offset: number;
    vertexCount: number;
    vertices: number;
    keys: number[];
}

interface PartDraw {
    part: ModelPart;
    drawCalls: TGRDrawCallInstance[];
}

export class TGRModel {
    public readonly parts: ModelPart[] = [];
    private readonly animations: ModelAnimation[] = [];
    private readonly view: DataView;
    private readonly segmentBuffers: ArrayBufferSlice[];
    private sharedOutput: RSPSharedOutput | null = null;
    private buffers: GeometryBuffers | null = null;
    private readonly handles: TextureHandle[] = [];
    private readonly draws: PartDraw[] = [];
    private animated = false;

    public constructor(buffer: ArrayBufferSlice) {
        const bytes = buffer.copyToBuffer();
        this.view = new DataView(bytes);
        const slice = new ArrayBufferSlice(bytes);
        this.segmentBuffers = nArray(256, () => slice);
        const partCount = this.view.getUint32(0x00);
        for (let i = 0; i < partCount; i++) {
            const o = 0x08 + i * 0x14;
            this.parts.push({
                displayList: this.view.getUint32(o),
                flags: this.view.getUint16(o + 0x04),
                position: vec3.fromValues(this.view.getFloat32(o + 0x08), this.view.getFloat32(o + 0x0c), this.view.getFloat32(o + 0x10)),
            });
        }
        const list = this.view.getUint32(0x04);
        if (list !== 0) {
            const count = this.view.getInt32(list);
            for (let i = 0; i < count; i++) {
                const offset = this.view.getUint32(list + 4 + i * 4);
                const keyCount = this.view.getInt32(offset + 0x0c);
                const keys: number[] = [];
                for (let k = 0; k < keyCount; k++) {
                    keys.push(this.view.getUint32(offset + 0x20 + k * 4));
                }
                this.animations.push({
                    offset,
                    vertexCount: this.view.getInt32(offset),
                    vertices: this.view.getUint32(offset + 0x04),
                    keys,
                });
            }
        }
    }

    public setAnimationFlags(set: number, clear: number): void {
        for (const a of this.animations) {
            const flags = this.view.getUint16(a.offset + 0x10);
            this.view.setUint16(a.offset + 0x10, (flags | set) & ~clear);
        }
    }

    public loopAnimations(): void {
        this.setAnimationFlags(MODEL_ANIMATION_REPEAT, MODEL_ANIMATION_BOUNCE);
    }

    public advanceAnimations(deltaSeconds: number): void {
        for (const a of this.animations) {
            if (this.flags(a) & MODEL_ANIMATION_REVERSING) {
                this.advanceReversing(a, deltaSeconds);
            } else {
                this.advanceForward(a, deltaSeconds);
            }
        }
        this.animated = this.animations.length > 0;
    }

    public build(device: GfxDevice, cache: GfxRenderCache, noZBuffer: boolean): void {
        const sharedOutput = new RSPSharedOutput();
        const rsp = new RSPState(this.segmentBuffers, sharedOutput);
        rsp.gSPClearGeometryMode(0xffffffff);
        rsp.gSPSetGeometryMode(MODEL_GEOMETRY_MODE);
        rsp.gDPSetOtherModeH(0, 32, TRACK_OTHER_MODE_H);
        rsp.gDPSetOtherModeL(0, 32, noZBuffer ? MODEL_RENDER_MODE_NO_Z : MODEL_RENDER_MODE_Z);
        rsp.gDPSetCombine(TRACK_COMBINE[0], TRACK_COMBINE[1]);
        rsp.gDPSetTile(0, 2, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0);
        rsp.gDPSetTile(0, 0, 0, 0x1f0, 6, 0, 0, 0, 0, 0, 0, 0);
        rsp.gDPSetTile(0, 0, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
        const ranges: [ModelPart, number, number][] = [];
        for (const pass of [0, 1]) {
            for (const part of this.parts) {
                if (((part.flags & MODEL_PART_TRANSLUCENT) === 0) !== (pass === 0) || part.displayList === 0) {
                    continue;
                }
                rsp.gSPTexture(true, 0, 0, 0xffff, 0xffff);
                rsp.markStateChanged();
                const start = rsp.drawCalls.length;
                runDL_F3DEX(rsp, part.displayList);
                ranges.push([part, start, rsp.drawCalls.length]);
            }
        }
        this.sharedOutput = sharedOutput;
        this.buffers = createGeometryBuffers(device, cache, sharedOutput, GfxBufferFrequencyHint.Dynamic);
        const handleMap = new Map<string, TextureHandle>();
        const instanceFor = (dc: DrawCall): TGRDrawCallInstance =>
            new TGRDrawCallInstance(
                dc,
                dc.textures.map((levels, slot) => createTextureHandle(device, cache, sharedOutput, handleMap, levels, dc.tiles[slot])),
                sharedOutput,
                false,
            );
        for (const [part, start, end] of ranges) {
            const drawCalls: TGRDrawCallInstance[] = [];
            for (let i = start; i < end; i++) {
                if (rsp.drawCalls[i].indexCount > 0) {
                    drawCalls.push(instanceFor(rsp.drawCalls[i]));
                }
            }
            this.draws.push({ part, drawCalls });
        }
        this.handles.push(...handleMap.values());
    }

    public prepareToRender(
        device: GfxDevice,
        renderInstManager: GfxRenderInstManager,
        viewerInput: ViewerRenderInput,
        view: mat4 | undefined,
        model: mat4,
        lights: LightState,
    ): void {
        const buffers = this.buffers;
        const sharedOutput = this.sharedOutput;
        if (buffers === null || sharedOutput === null) {
            return;
        }
        if (this.animated) {
            this.refreshVertices(sharedOutput);
            fillVertexData(buffers.vertexData, sharedOutput.vertices);
            device.uploadBufferData(buffers.vertexBuffer, 0, new Uint8Array(buffers.vertexData.buffer));
            this.animated = false;
        }
        const template = renderInstManager.pushTemplate();
        template.setVertexInput(buffers.inputLayout, [{ buffer: buffers.vertexBuffer }], { buffer: buffers.indexBuffer });
        const partModel = mat4.create();
        for (const { part, drawCalls } of this.draws) {
            mat4.translate(partModel, model, part.position);
            const ramped = (part.flags & MODEL_PART_RAMPED) !== 0;
            for (const dci of drawCalls) {
                dci.prepareToRender(renderInstManager, viewerInput, {
                    view,
                    model: partModel,
                    cullMode: part.flags & MODEL_PART_TWO_SIDED ? GfxCullMode.None : GfxCullMode.Back,
                    lights,
                    ramp: ramped ? part.flags & MODEL_PART_LIGHT_RAMP : -1,
                    nightLit: false,
                    fog: null,
                    env: null,
                });
            }
        }
        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        if (this.buffers !== null) {
            device.destroyBuffer(this.buffers.vertexBuffer);
            device.destroyBuffer(this.buffers.indexBuffer);
        }
        for (const handle of this.handles) {
            device.destroyTexture(handle.gfxTexture);
        }
    }

    private refreshVertices(sharedOutput: RSPSharedOutput): void {
        sharedOutput.vertices.forEach((v, i) => {
            loadVertexFromView(v, this.view, sharedOutput.vertexSources[i]);
        });
    }

    private flags(a: ModelAnimation): number {
        return this.view.getUint16(a.offset + 0x10);
    }

    private setFlags(a: ModelAnimation, flags: number): void {
        this.view.setUint16(a.offset + 0x10, flags);
    }

    private startTime(a: ModelAnimation): number {
        return this.view.getFloat32(a.offset + 0x14);
    }

    private endTime(a: ModelAnimation): number {
        return this.view.getFloat32(a.offset + 0x18);
    }

    private time(a: ModelAnimation): number {
        return this.view.getFloat32(a.offset + 0x1c);
    }

    private setTime(a: ModelAnimation, time: number): void {
        this.view.setFloat32(a.offset + 0x1c, time);
    }

    private setStartKey(a: ModelAnimation, key: number): void {
        this.view.setUint16(a.offset + 0x12, key);
    }

    private keyTime(key: number): number {
        return this.view.getFloat32(key);
    }

    private blendKeys(a: ModelAnimation, from: number, to: number, share: number): void {
        const blend = Math.trunc(share * BLEND_ONE);
        const count = a.vertexCount;
        for (let j = 0; j < count; j++) {
            const vertex = a.vertices + j * 0x10;
            for (let c = 0; c < 3; c++) {
                const p0 = this.view.getInt16(from + 4 + j * 6 + c * 2);
                const p1 = this.view.getInt16(to + 4 + j * 6 + c * 2);
                this.view.setInt16(vertex + c * 2, p0 + (((p1 - p0) * blend) >> BLEND_SHIFT));
            }
            for (let c = 0; c < 3; c++) {
                const n0 = this.view.getInt8(from + 4 + count * 6 + j * 3 + c);
                const n1 = this.view.getInt8(to + 4 + count * 6 + j * 3 + c);
                this.view.setInt8(vertex + 0x0c + c, n0 + (((n1 - n0) * blend) >> BLEND_SHIFT));
            }
        }
    }

    private blendAt(a: ModelAnimation, time: number): void {
        let k = this.view.getUint16(a.offset + 0x12);
        for (; k < a.keys.length; k++) {
            if (time < this.keyTime(a.keys[k])) {
                break;
            }
        }
        const to = a.keys[Math.min(k, a.keys.length - 1)];
        const from = a.keys[Math.max(Math.min(k, a.keys.length - 1) - 1, 0)];
        const span = this.keyTime(to) - this.keyTime(from);
        this.blendKeys(a, from, to, span !== 0 ? (time - this.keyTime(from)) / span : 0);
    }

    private advanceReversing(a: ModelAnimation, deltaSeconds: number): void {
        let time = this.time(a) - deltaSeconds;
        this.setTime(a, time);
        if (this.startTime(a) <= time) {
            if (time < this.endTime(a)) {
                this.blendAt(a, time);
            }
            return;
        }
        if (!(this.flags(a) & MODEL_ANIMATION_REPEAT)) {
            return;
        }
        this.setFlags(a, this.flags(a) & ~MODEL_ANIMATION_REVERSING);
        this.setStartKey(a, 0);
        time = this.startTime(a) * 2 - time;
        this.setTime(a, time);
        this.blendAt(a, time);
    }

    private advanceForward(a: ModelAnimation, deltaSeconds: number): void {
        let time = this.time(a) + deltaSeconds;
        this.setTime(a, time);
        const start = this.startTime(a);
        const end = this.endTime(a);
        if (time < start) {
            this.blendKeys(a, a.keys[0], a.keys[0], 0);
            return;
        }
        if (time < end) {
            this.blendAt(a, time);
            return;
        }
        const flags = this.flags(a);
        if (!(flags & MODEL_ANIMATION_REPEAT)) {
            const last = a.keys[a.keys.length - 1];
            this.blendKeys(a, last, last, 0);
            return;
        }
        const length = end - start;
        let span = length;
        let limit: number;
        if (flags & MODEL_ANIMATION_BOUNCE) {
            span = length * 2;
            limit = end + span;
            while (limit < time) {
                time -= span;
            }
            span *= 0.5;
            limit -= span;
            if (!(limit < time)) {
                this.setFlags(a, flags | MODEL_ANIMATION_REVERSING);
                time = end * 2 - time;
                this.setTime(a, time);
                this.setStartKey(a, 0);
                this.blendAt(a, time);
                return;
            }
        } else {
            limit = end + span;
        }
        while (limit < time) {
            time -= span;
        }
        time -= length;
        this.setTime(a, time);
        this.setStartKey(a, 0);
        this.blendAt(a, time);
    }
}
