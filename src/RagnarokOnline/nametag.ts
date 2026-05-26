import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";

export interface LabelStyle {
    font: string;
    outlinePx: number;
    fillStyle: string;
    strokeStyle: string;
    wrapPx: number;
    worldScale: number;
    marginAboveSprite: number;
}

export const NPC_LABEL_STYLE: LabelStyle = {
    font: "bold 22px sans-serif",
    outlinePx: 4,
    fillStyle: "rgba(255, 244, 196, 1.0)",
    strokeStyle: "rgba(0, 0, 0, 0.85)",
    wrapPx: 160,
    worldScale: 0.09,
    marginAboveSprite: 1.5,
};

export const MOB_LABEL_STYLE: LabelStyle = {
    font: "16px sans-serif",
    outlinePx: 3,
    fillStyle: "rgba(235, 235, 235, 1.0)",
    strokeStyle: "rgba(0, 0, 0, 0.80)",
    wrapPx: 130,
    worldScale: 0.09,
    marginAboveSprite: 1.0,
};

const LINE_HEIGHT_FACTOR = 1.1;
const LABEL_PADDING = 4;

export interface LabelInstance {
    text: string;
    worldPos: vec3;
    heightAbove: number;
}

interface LabelTexture {
    texture: GfxTexture;
    width: number;
    height: number;
}

const LABEL_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4;
const LABEL_FLOATS_PER_VERTEX = 5;

class LabelProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;

    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

uniform sampler2D u_LabelTexture;

varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = ${LabelProgram.a_Position}) in vec3 a_Position;
layout(location = ${LabelProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
void main() {
    vec4 t_Color = texture(SAMPLER_2D(u_LabelTexture), v_TexCoord);
    if (t_Color.a < 0.02)
        discard;
    gl_FragColor = t_Color;
}
`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, wrapPx: number): string[] {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= 1)
        return [text];
    const singleWidth = ctx.measureText(text).width;
    if (singleWidth <= wrapPx)
        return [text];

    let bestIdx = 1;
    let bestMax = Infinity;
    for (let i = 1; i < words.length; i++) {
        const left = words.slice(0, i).join(" ");
        const right = words.slice(i).join(" ");
        const lw = ctx.measureText(left).width;
        const rw = ctx.measureText(right).width;
        const m = Math.max(lw, rw);
        if (m < bestMax) {
            bestMax = m;
            bestIdx = i;
        }
    }
    return [words.slice(0, bestIdx).join(" "), words.slice(bestIdx).join(" ")];
}

function rasterizeLabel(text: string, style: LabelStyle): { canvas: HTMLCanvasElement, width: number, height: number } | null {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx === null)
        return null;

    ctx.font = style.font;
    const lines = wrapLines(ctx, text, style.wrapPx);

    let maxLineW = 0;
    for (const line of lines) {
        const w = ctx.measureText(line).width;
        if (w > maxLineW) maxLineW = w;
    }

    const fontPx = parseFloat(style.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
    const lineHeight = fontPx * LINE_HEIGHT_FACTOR;
    const textBlockH = Math.ceil(lineHeight * lines.length);
    const textBlockW = Math.ceil(maxLineW);

    const pad = LABEL_PADDING + style.outlinePx;
    const width = textBlockW + pad * 2;
    const height = textBlockH + pad * 2;
    if (width <= 0 || height <= 0)
        return null;
    canvas.width = width;
    canvas.height = height;

    ctx.font = style.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = style.outlinePx;
    ctx.strokeStyle = style.strokeStyle;
    ctx.fillStyle = style.fillStyle;

    const cx = width / 2;
    const blockTop = pad;
    for (let i = 0; i < lines.length; i++) {
        const cy = blockTop + lineHeight * (i + 0.5);
        if (style.outlinePx > 0)
            ctx.strokeText(lines[i], cx, cy);
        ctx.fillText(lines[i], cx, cy);
    }

    return { canvas, width, height };
}

export class NameLabelRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private device: GfxDevice;
    private style: LabelStyle;

    private textureCache = new Map<string, LabelTexture | null>();
    private labels: LabelInstance[] = [];

    private vertexBuffer: GfxIndexBufferDescriptor["buffer"] | null = null;
    private vertexCapacityVerts = 0;

    private scratchRight = vec3.create();
    private scratchUp = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"], style: LabelStyle) {
        this.device = device;
        this.style = style;
        this.program = cache.createProgram(new LabelProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: LabelProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: LabelProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: LABEL_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: null,
        });

        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
    }

    public addLabel(label: LabelInstance): void {
        if (label.text.length === 0)
            return;
        if (!this.textureCache.has(label.text))
            this.textureCache.set(label.text, this.buildTexture(label.text));
        this.labels.push(label);
    }

    private buildTexture(text: string): LabelTexture | null {
        const r = rasterizeLabel(text, this.style);
        if (r === null)
            return null;
        const texture = this.device.createTexture({
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: r.width,
            height: r.height,
            depthOrArrayLayers: 1,
            numLevels: 1,
            dimension: GfxTextureDimension.n2D,
            usage: GfxTextureUsage.Sampled,
        });
        this.device.copyExternalImageToTexture(texture, 0, r.canvas);
        return { texture, width: r.width, height: r.height };
    }

    public get hasLabels(): boolean {
        return this.labels.length > 0;
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, cameraWorldMatrix: mat4): void {
        if (this.labels.length === 0)
            return;
        const renderInstManager = renderHelper.renderInstManager;
        const worldScale = this.style.worldScale;
        const margin = this.style.marginAboveSprite;

        vec3.set(this.scratchRight, cameraWorldMatrix[0], cameraWorldMatrix[1], cameraWorldMatrix[2]);
        vec3.set(this.scratchUp, cameraWorldMatrix[4], cameraWorldMatrix[5], cameraWorldMatrix[6]);

        const byTexture = new Map<LabelTexture, LabelInstance[]>();
        for (const l of this.labels) {
            const tex = this.textureCache.get(l.text);
            if (tex === undefined || tex === null)
                continue;
            let list = byTexture.get(tex);
            if (list === undefined) {
                list = [];
                byTexture.set(tex, list);
            }
            list.push(l);
        }
        if (byTexture.size === 0)
            return;

        let totalQuads = 0;
        for (const list of byTexture.values())
            totalQuads += list.length;

        const vertexCount = totalQuads * 6;
        const data = new ArrayBuffer(vertexCount * LABEL_VERTEX_STRIDE_BYTES);
        const f = new Float32Array(data);

        const rx = this.scratchRight, uy = this.scratchUp;
        let vi = 0;
        const ranges: { tex: LabelTexture, start: number, count: number }[] = [];

        const emit = (px: number, py: number, pz: number, u: number, v: number): void => {
            const o = vi * LABEL_FLOATS_PER_VERTEX;
            f[o + 0] = px; f[o + 1] = py; f[o + 2] = pz;
            f[o + 3] = u; f[o + 4] = v;
            vi++;
        };

        for (const [tex, list] of byTexture) {
            const start = vi;
            const halfW = tex.width * 0.5 * worldScale;
            const fullH = tex.height * worldScale;
            for (const l of list) {

                const baseX = l.worldPos[0];
                const baseY = l.worldPos[1] + l.heightAbove + margin;
                const baseZ = l.worldPos[2];

                const tlx = baseX - rx[0] * halfW + uy[0] * fullH;
                const tly = baseY - rx[1] * halfW + uy[1] * fullH;
                const tlz = baseZ - rx[2] * halfW + uy[2] * fullH;
                const trx = baseX + rx[0] * halfW + uy[0] * fullH;
                const try_ = baseY + rx[1] * halfW + uy[1] * fullH;
                const trz = baseZ + rx[2] * halfW + uy[2] * fullH;
                const blx = baseX - rx[0] * halfW;
                const bly = baseY - rx[1] * halfW;
                const blz = baseZ - rx[2] * halfW;
                const brx = baseX + rx[0] * halfW;
                const bry = baseY + rx[1] * halfW;
                const brz = baseZ + rx[2] * halfW;

                emit(tlx, tly, tlz, 0, 0);
                emit(trx, try_, trz, 1, 0);
                emit(blx, bly, blz, 0, 1);
                emit(trx, try_, trz, 1, 0);
                emit(brx, bry, brz, 1, 1);
                emit(blx, bly, blz, 0, 1);
            }
            ranges.push({ tex, start, count: vi - start });
        }

        if (vertexCount > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(vertexCount * LABEL_VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
            this.vertexCapacityVerts = vertexCount;
        }
        if (this.vertexBuffer === null)
            return;
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(data));

        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, null);

        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 1);

        let offs = template.allocateUniformBuffer(LabelProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(LabelProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);

        const megaState = template.setMegaStateFlags({
            cullMode: GfxCullMode.None,
            depthWrite: false,
        });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        for (const r of ranges) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: r.tex.texture, gfxSampler: this.sampler }]);
            renderInst.setDrawCount(r.count, r.start);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        for (const t of this.textureCache.values())
            if (t !== null)
                device.destroyTexture(t.texture);
        if (this.vertexBuffer !== null)
            device.destroyBuffer(this.vertexBuffer);
    }
}
