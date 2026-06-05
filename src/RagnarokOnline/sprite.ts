import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxTopology, makeTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { DeviceProgram } from "../Program.js";
import { DecodedImage } from "./bmp.js";
import { ActModel, recalcClipXY } from "./act.js";
import { SprModel } from "./spr.js";

const DELAY_TO_SECONDS = 24.0 / 1000.0;

const MAX_ACCUM = 1.0;

const BILLBOARD_TILT = 0.5;

const SPRITE_WORLD_SCALE = 0.2;

function spriteFrameImage(spr: SprModel, clipType: number, sprIndex: number): DecodedImage | null {
    const frames = clipType === 0 ? spr.indexed : spr.rgba;
    return sprIndex >= 0 && sprIndex < frames.length ? frames[sprIndex] : null;
}

function spriteFrameVisibleBottomRow(spr: SprModel, clipType: number, sprIndex: number): number {
    const rows = clipType === 0 ? spr.indexedBottomRow : spr.rgbaBottomRow;
    return sprIndex >= 0 && sprIndex < rows.length ? rows[sprIndex] : -1;
}

function spriteFrameVisibleTopRow(spr: SprModel, clipType: number, sprIndex: number): number {
    const rows = clipType === 0 ? spr.indexedTopRow : spr.rgbaTopRow;
    return sprIndex >= 0 && sprIndex < rows.length ? rows[sprIndex] : -1;
}

export function computeActorFootPxY(act: ActModel, spr: SprModel): number {
    let minPerFrameMax = Infinity;
    const idleDirs = Math.min(8, act.actions.length);
    for (let a = 0; a < idleDirs; a++) {
        const motion = act.actions[a].motions[0];
        if (motion === undefined)
            continue;
        let frameMax = -Infinity;
        for (const c of motion.clips) {
            const img = spriteFrameImage(spr, c.clipType, c.sprIndex);
            if (img === null)
                continue;

            let cy = c.y;
            if (act.version < 0x0205) {
                const tmp = { ...c };
                recalcClipXY(tmp, img.width, img.height);
                cy = tmp.y;
            }
            const visRow = spriteFrameVisibleBottomRow(spr, c.clipType, c.sprIndex);
            if (visRow < 0)
                continue;
            const visPxY = (cy + visRow) * c.zoomY;
            if (visPxY > frameMax)
                frameMax = visPxY;
        }
        if (frameMax > -Infinity && frameMax < minPerFrameMax)
            minPerFrameMax = frameMax;
    }
    return minPerFrameMax === Infinity ? NaN : minPerFrameMax;
}

const SPRITE_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 4;
const SPRITE_FLOATS_PER_VERTEX = 6;
const VERTS_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

interface SpriteQuad {
    sheet: number;
    clipType: number;
    sprIndex: number;
    verts: Float32Array;
    colors: Uint32Array;
}

export class SpriteActor {
    private spr: SprModel;
    private act: ActModel;
    private footPxY: number;

    private state = 0;
    private worldDir = 0;
    private dir = 0;
    private motion = 0;
    private accum = 0;

    private externalMotion = false;

    constructor(spr: SprModel, act: ActModel, footPxY: number) {
        this.spr = spr;
        this.act = act;
        this.footPxY = footPxY;
    }

    public get sprModel(): SprModel {
        return this.spr;
    }

    public setState(state: number): void {
        if (state !== this.state) {
            this.state = state;
            this.motion = 0;
            this.accum = 0;
            this.externalMotion = false;
        }
    }

    public currentDelay(): number {
        const a = this.actionIndex();
        const d = a < this.act.delay.length ? this.act.delay[a] : 4.0;
        return d < 1 ? 1 : d;
    }

    public currentMotionCount(): number {
        const a = this.actionIndex();
        if (a >= this.act.actions.length)
            return 0;
        return this.act.actions[a].motions.length;
    }

    public hasState(state: number): boolean {
        return this.act.actions.length > state * 8;
    }

    public currentFrameWorldSize(): { width: number, height: number } | null {
        if (this.act.actions.length === 0)
            return null;
        const action = this.actionIndex();
        const motions = this.act.actions[action].motions;
        if (motions.length === 0)
            return null;
        const mot = motions[this.motion % motions.length];
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let any = false;
        for (const src of mot.clips) {
            const img = spriteFrameImage(this.spr, src.clipType, src.sprIndex);
            if (img === null)
                continue;
            let clipX = src.x, clipY = src.y;
            if (this.act.version < 0x0205) {
                const tmp = { ...src };
                recalcClipXY(tmp, img.width, img.height);
                clipX = tmp.x;
                clipY = tmp.y;
            }
            const x0 = clipX * src.zoomX;
            const y0 = clipY * src.zoomY;
            const x1 = (clipX + img.width - 1.0) * src.zoomX;
            const y1 = (clipY + img.height - 1.0) * src.zoomY;
            const loX = Math.min(x0, x1), hiX = Math.max(x0, x1);
            const loY = Math.min(y0, y1), hiY = Math.max(y0, y1);
            if (loX < minX) minX = loX;
            if (loY < minY) minY = loY;
            if (hiX > maxX) maxX = hiX;
            if (hiY > maxY) maxY = hiY;
            any = true;
        }
        if (!any)
            return null;
        return {
            width: (maxX - minX) * SPRITE_WORLD_SCALE,
            height: (maxY - minY) * SPRITE_WORLD_SCALE,
        };
    }

    public currentFrameTopAboveAnchor(anchor: SpriteAnchor = "feet"): number | null {
        if (this.act.actions.length === 0)
            return null;
        const action = this.actionIndex();
        const motions = this.act.actions[action].motions;
        if (motions.length === 0)
            return null;
        const mot = motions[this.motion % motions.length];

        let minVisPxY = Infinity;
        for (const c of mot.clips) {
            const img = spriteFrameImage(this.spr, c.clipType, c.sprIndex);
            if (img === null)
                continue;
            let cy = c.y;
            if (this.act.version < 0x0205) {
                const tmp = { ...c };
                recalcClipXY(tmp, img.width, img.height);
                cy = tmp.y;
            }
            const topRow = spriteFrameVisibleTopRow(this.spr, c.clipType, c.sprIndex);
            if (topRow < 0)
                continue;
            const visPxY = (cy + topRow) * c.zoomY;
            if (visPxY < minVisPxY)
                minVisPxY = visPxY;
        }
        if (minVisPxY === Infinity)
            return null;

        const anchorPxY = anchor === "center" ? 0 : (Number.isNaN(this.footPxY) ? 0 : this.footPxY);

        return (anchorPxY - minVisPxY) * SPRITE_WORLD_SCALE;
    }

    public setMotion(motion: number): void {
        const count = this.currentMotionCount();
        if (count <= 0)
            return;
        this.motion = ((motion % count) + count) % count;
        this.externalMotion = true;
    }

    public setWorldDirection(d: number): void {
        this.worldDir = ((d % 8) + 8) % 8;
        this.dir = this.worldDir;
    }

    public updateFacing(camDir: number): void {
        this.dir = ((this.worldDir - camDir) % 8 + 8) % 8;
    }

    private actionIndex(): number {
        if (this.act.actions.length === 0)
            return 0;
        const idx = this.state * 8 + this.dir;
        const last = this.act.actions.length - 1;
        return idx < 0 ? 0 : (idx > last ? last : idx);
    }

    public advance(dtSeconds: number): void {
        if (this.externalMotion)
            return;
        if (this.act.actions.length === 0)
            return;
        const action = this.actionIndex();
        const motionCount = this.act.actions[action].motions.length;
        if (motionCount <= 0)
            return;

        let d = action < this.act.delay.length ? this.act.delay[action] : 4.0;
        d *= DELAY_TO_SECONDS;
        if (d <= 0)
            return;

        this.accum += dtSeconds;
        if (this.accum > MAX_ACCUM)
            this.accum = MAX_ACCUM;
        while (this.accum >= d) {
            this.accum -= d;
            this.motion = (this.motion + 1) % motionCount;
        }
    }

    public buildQuads(camRight: vec3, camUp: vec3, worldPos: vec3, anchor: SpriteAnchor = "feet"): SpriteQuad[] {
        const out: SpriteQuad[] = [];
        if (this.act.actions.length === 0)
            return out;

        const action = this.actionIndex();
        const motions = this.act.actions[action].motions;
        if (motions.length === 0)
            return out;
        const mot = motions[this.motion % motions.length];

        const ax = worldPos[0], ay = worldPos[1], az = worldPos[2];

        interface ClipCorners {
            clipType: number;
            sprIndex: number;
            color: number;
            cx: number[];
            cy: number[];
        }
        const clips: ClipCorners[] = [];

        for (const src of mot.clips) {
            const img = spriteFrameImage(this.spr, src.clipType, src.sprIndex);
            if (img === null)
                continue;

            let clipX = src.x, clipY = src.y;
            if (this.act.version < 0x0205) {
                const tmp = { ...src };
                recalcClipXY(tmp, img.width, img.height);
                clipX = tmp.x;
                clipY = tmp.y;
            }

            const x1 = clipX * src.zoomX;
            const y1 = clipY * src.zoomY;
            const x2 = (clipX + img.width - 1.0) * src.zoomX;
            const y2 = (clipY + img.height - 1.0) * src.zoomY;

            const color = ((src.r | (src.g << 8) | (src.b << 16) | (src.a << 24)) >>> 0);

            const cx: number[] = [0, 0, 0, 0];
            const cy: number[] = [0, 0, 0, 0];
            if (src.angle !== 0) {
                const rad = src.angle * Math.PI / 180.0;
                const cs = Math.cos(rad), sn = Math.sin(rad);
                cx[0] = x1 * cs - y1 * sn; cy[0] = x1 * sn + y1 * cs;
                cx[1] = x2 * cs - y1 * sn; cy[1] = x2 * sn + y1 * cs;
                cx[2] = x1 * cs - y2 * sn; cy[2] = x1 * sn + y2 * cs;
                cx[3] = x2 * cs - y2 * sn; cy[3] = x2 * sn + y2 * cs;
            } else {
                const xl = src.mirror ? x2 : x1;
                const xr = src.mirror ? x1 : x2;
                cx[0] = xl; cy[0] = y1;
                cx[1] = xr; cy[1] = y1;
                cx[2] = xl; cy[2] = y2;
                cx[3] = xr; cy[3] = y2;
            }

            clips.push({ clipType: src.clipType, sprIndex: src.sprIndex, color, cx, cy });
        }

        if (clips.length === 0)
            return out;

        const anchorPxY = anchor === "center" ? 0 : (Number.isNaN(this.footPxY) ? 0 : this.footPxY);

        const emit = (verts: Float32Array, colors: Uint32Array, vi: number, pxX: number, pxY: number, u: number, v: number, color: number): void => {
            const offH = pxX * SPRITE_WORLD_SCALE;
            const offV = (anchorPxY - pxY) * SPRITE_WORLD_SCALE;
            const o = vi * SPRITE_FLOATS_PER_VERTEX;
            verts[o + 0] = ax + camRight[0] * offH + camUp[0] * offV;
            verts[o + 1] = ay + camRight[1] * offH + camUp[1] * offV;
            verts[o + 2] = az + camRight[2] * offH + camUp[2] * offV;
            verts[o + 3] = u;
            verts[o + 4] = v;
            colors[vi] = color;
        };

        for (const c of clips) {
            const verts = new Float32Array(VERTS_PER_QUAD * SPRITE_FLOATS_PER_VERTEX);
            const colors = new Uint32Array(VERTS_PER_QUAD);
            emit(verts, colors, 0, c.cx[0], c.cy[0], 0.0, 0.0, c.color);
            emit(verts, colors, 1, c.cx[1], c.cy[1], 1.0, 0.0, c.color);
            emit(verts, colors, 2, c.cx[3], c.cy[3], 1.0, 1.0, c.color);
            emit(verts, colors, 3, c.cx[2], c.cy[2], 0.0, 1.0, c.color);

            out.push({ sheet: 0, clipType: c.clipType, sprIndex: c.sprIndex, verts, colors });
        }

        return out;
    }
}

class SpriteProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Color = 2;

    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

uniform sampler2D u_FrameTexture;

varying vec2 v_TexCoord;
varying vec4 v_Color;
`;

    public override vert = `
layout(location = ${SpriteProgram.a_Position}) in vec3 a_Position;
layout(location = ${SpriteProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${SpriteProgram.a_Color}) in vec4 a_Color;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
    v_Color = a_Color;
}
`;

    public override frag = `
void main() {
    vec4 t_Texel = texture(SAMPLER_2D(u_FrameTexture), v_TexCoord);
    vec4 t_Color = t_Texel * v_Color;
    if (t_Color.a < 0.5)
        discard;
    gl_FragColor = t_Color;
}
`;
}

function createRGBATexture(device: GfxDevice, img: DecodedImage): GfxTexture {
    const texture = device.createTexture({
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: img.width,
        height: img.height,
        depthOrArrayLayers: 1,
        numLevels: 1,
        dimension: GfxTextureDimension.n2D,
        usage: GfxTextureUsage.Sampled,
    });
    device.uploadTextureData(texture, 0, [img.rgba]);
    return texture;
}

export type SpriteAnchor = "feet" | "center";

export type SpriteKind = "npc" | "mob" | "effect";

export interface SpriteInstance {
    sheet: number;
    actor: SpriteActor;
    worldPos: vec3;
    anchor?: SpriteAnchor;
    kind: SpriteKind;
}

interface SpriteSheet {
    tex: (GfxTexture | null)[];
    rgbaBase: number;
}

export class SpriteRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;

    private sheets: SpriteSheet[] = [];
    private device: GfxDevice;

    private instances: SpriteInstance[] = [];
    private kindEnabled: Record<SpriteKind, boolean> = { npc: true, mob: true, effect: true };
    private scratchRight = vec3.create();
    private scratchUp = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.device = device;
        this.program = cache.createProgram(new SpriteProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: SpriteProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: SpriteProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: SpriteProgram.a_Color, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset: 5 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: SPRITE_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U16_R,
        });

        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
    }

    public addSheet(spr: SprModel): number {
        const tex: (GfxTexture | null)[] = [];
        for (const img of spr.indexed)
            tex.push((img.width > 0 && img.height > 0) ? createRGBATexture(this.device, img) : null);
        const rgbaBase = tex.length;
        for (const img of spr.rgba)
            tex.push((img.width > 0 && img.height > 0) ? createRGBATexture(this.device, img) : null);
        this.sheets.push({ tex, rgbaBase });
        return this.sheets.length - 1;
    }

    public addInstance(inst: SpriteInstance): void {
        this.instances.push(inst);
    }

    public setKindEnabled(kind: SpriteKind, enabled: boolean): void {
        this.kindEnabled[kind] = enabled;
    }

    public isKindEnabled(kind: SpriteKind): boolean {
        return this.kindEnabled[kind];
    }

    public hasKind(kind: SpriteKind): boolean {
        for (const i of this.instances)
            if (i.kind === kind)
                return true;
        return false;
    }

    private frameTexture(sheet: number, clipType: number, sprIndex: number): GfxTexture | null {
        if (sprIndex < 0 || sheet < 0 || sheet >= this.sheets.length)
            return null;
        const s = this.sheets[sheet];
        const base = clipType === 0 ? 0 : s.rgbaBase;
        const limit = clipType === 0 ? s.rgbaBase : s.tex.length;
        const idx = base + sprIndex;
        return idx < limit ? s.tex[idx] : null;
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, cameraWorldMatrix: mat4, dtSeconds: number): void {
        if (this.instances.length === 0)
            return;
        const renderInstManager = renderHelper.renderInstManager;

        vec3.set(this.scratchRight, cameraWorldMatrix[0], 0, cameraWorldMatrix[2]);
        if (vec3.len(this.scratchRight) < 1e-5)
            vec3.set(this.scratchRight, 1, 0, 0);
        else
            vec3.normalize(this.scratchRight, this.scratchRight);

        const t = BILLBOARD_TILT;
        vec3.set(this.scratchUp, t * cameraWorldMatrix[4], (1 - t) + t * cameraWorldMatrix[5], t * cameraWorldMatrix[6]);
        if (vec3.len(this.scratchUp) < 1e-5)
            vec3.set(this.scratchUp, 0, 1, 0);
        else
            vec3.normalize(this.scratchUp, this.scratchUp);

        const fwdX = -cameraWorldMatrix[8], fwdZ = -cameraWorldMatrix[10];
        const yawDeg = Math.atan2(fwdX, -fwdZ) * 180 / Math.PI;
        const camDir = ((Math.round(yawDeg / 45) % 8) + 8) % 8;

        const camX = cameraWorldMatrix[12], camY = cameraWorldMatrix[13], camZ = cameraWorldMatrix[14];
        this.instances.sort((a, b) => {
            const ax = a.worldPos[0] - camX, ay = a.worldPos[1] - camY, az = a.worldPos[2] - camZ;
            const bx = b.worldPos[0] - camX, by = b.worldPos[1] - camY, bz = b.worldPos[2] - camZ;
            return (bx * bx + by * by + bz * bz) - (ax * ax + ay * ay + az * az);
        });

        const drawQuads: { tex: GfxTexture, verts: Float32Array, colors: Uint32Array }[] = [];

        for (const inst of this.instances) {
            inst.actor.updateFacing(camDir);
            inst.actor.advance(dtSeconds);
            if (!this.kindEnabled[inst.kind])
                continue;
            const built = inst.actor.buildQuads(this.scratchRight, this.scratchUp, inst.worldPos, inst.anchor ?? "feet");
            for (const q of built) {
                const tex = this.frameTexture(inst.sheet, q.clipType, q.sprIndex);
                if (tex === null)
                    continue;
                drawQuads.push({ tex, verts: q.verts, colors: q.colors });
            }
        }
        if (drawQuads.length === 0)
            return;

        const vertexCount = drawQuads.length * VERTS_PER_QUAD;
        const data = new ArrayBuffer(vertexCount * SPRITE_VERTEX_STRIDE_BYTES);
        const f = new Float32Array(data);
        const u = new Uint32Array(data);

        const ranges: { tex: GfxTexture, start: number, count: number }[] = [];
        for (let qi = 0; qi < drawQuads.length; qi++) {
            const quad = drawQuads[qi];
            for (let vi = 0; vi < VERTS_PER_QUAD; vi++) {
                const dst = (qi * VERTS_PER_QUAD + vi) * SPRITE_FLOATS_PER_VERTEX;
                const src = vi * SPRITE_FLOATS_PER_VERTEX;
                f[dst + 0] = quad.verts[src + 0];
                f[dst + 1] = quad.verts[src + 1];
                f[dst + 2] = quad.verts[src + 2];
                f[dst + 3] = quad.verts[src + 3];
                f[dst + 4] = quad.verts[src + 4];
                u[dst + 5] = quad.colors[vi];
            }
            const last = ranges.length > 0 ? ranges[ranges.length - 1] : null;
            if (last !== null && last.tex === quad.tex)
                last.count += INDICES_PER_QUAD;
            else
                ranges.push({ tex: quad.tex, start: qi * INDICES_PER_QUAD, count: INDICES_PER_QUAD });
        }

        const cache = renderHelper.renderCache;
        const vertexBufferDescriptors = [cache.dynamicBufferCache.allocateData(GfxBufferUsage.Vertex, new Uint8Array(data))];
        const indexData = makeTriangleIndexBuffer(GfxTopology.Quads, 0, vertexCount);
        const indexBufferDescriptor = cache.dynamicBufferCache.allocateData(GfxBufferUsage.Index, new Uint8Array(indexData.buffer));

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, indexBufferDescriptor);

        let offs = template.allocateUniformBuffer(SpriteProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(SpriteProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);

        const megaState = template.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: true });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        for (const r of ranges) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: r.tex, gfxSampler: this.sampler }]);
            renderInst.setDrawCount(r.count, r.start);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        for (const sheet of this.sheets)
            for (const t of sheet.tex)
                if (t !== null)
                    device.destroyTexture(t);
    }
}
