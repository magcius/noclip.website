import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DeviceProgram } from "../Program.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxBlendFactor,
    GfxBlendMode,
    GfxBuffer,
    GfxBufferFrequencyHint,
    GfxBufferUsage,
    GfxCompareMode,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxInputLayout,
    GfxMegaStateDescriptor,
    GfxMipFilterMode,
    GfxProgram,
    GfxSampler,
    GfxTexFilterMode,
    GfxTexture,
    GfxVertexBufferFrequency,
    GfxWrapMode,
    makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";

const SMALL_FONT_MAX_SIZE = 25;
const SMALL_FONT_CELL = 20;
const SMALL_FONT_WIDTH = 392;
const SMALL_FONT_PADDING = 4;
const LARGE_FONT_CELL = 40;
const LARGE_FONT_WIDTH = 704;
const LARGE_FONT_PADDING = 7;
const FIRST_ROW_GLYPH = 27;
const SIZE_UNITS = 40;
const SPACE_ADVANCE = 12;
const ASCENT = 30;
const GRADIENT_WIDTH = 8;
const GRADIENT_HEIGHT = 40;
const MAX_GLYPHS = 1024;
const FLOATS_PER_VERTEX = 14;

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 240;

export enum TextAlign {
    Left,
    Center,
    Right,
}

const PRIM_CODES: Record<string, number[]> = {
    r: [0xbe, 0x00, 0x00],
    o: [0xcd, 0x5f, 0x00],
    O: [0xff, 0x78, 0x00],
    y: [0xff, 0xf5, 0x00],
    Y: [0xff, 0xfa, 0x80],
    g: [0x00, 0x96, 0x00],
    b: [0x00, 0x00, 0xc8],
    p: [0xc8, 0x00, 0xc8],
    w: [0xff, 0xff, 0xff],
    "1": [0xff, 0xff, 0xff],
    "5": [0x80, 0x80, 0x80],
    "0": [0x00, 0x00, 0x00],
};

const ENV_CODES: Record<string, number[]> = {
    r: [0xc8, 0x00, 0x00],
    o: [0xcd, 0x5f, 0x00],
    O: [0xff, 0x78, 0x00],
    y: [0xd2, 0xbe, 0x00],
    Y: [0xd2, 0xc8, 0x69],
    g: [0x00, 0x96, 0x00],
    b: [0x00, 0x00, 0xc8],
    p: [0xc8, 0x00, 0xc8],
    w: [0xff, 0xff, 0xff],
    "1": [0xff, 0xff, 0xff],
    "5": [0x80, 0x80, 0x80],
    "0": [0x00, 0x00, 0x00],
};

class TextProgram extends DeviceProgram {
    public static ub_Params = 0;

    public override both = `
layout(std140) uniform ub_Params {
    vec4 u_Misc;
};

uniform sampler2D u_Font;
uniform sampler2D u_Gradient;
varying vec2 v_Glyph;
varying vec2 v_Gradient;
varying vec3 v_Prim;
varying vec3 v_Env;
varying float v_Shadow;
`;

    public override vert = `
layout(location = 0) in vec2 a_Position;
layout(location = 1) in vec4 a_TexCoord;
layout(location = 2) in vec4 a_Prim;
layout(location = 3) in vec4 a_Env;

void main() {
    v_Glyph = a_TexCoord.xy;
    v_Gradient = a_TexCoord.zw;
    v_Prim = a_Prim.rgb;
    v_Env = a_Env.rgb;
    v_Shadow = a_Prim.a;
    gl_Position = vec4(a_Position, 0.5, 1.0);
}
`;

    public override frag = `
void main() {
    vec4 t_Glyph = texture(SAMPLER_2D(u_Font), v_Glyph);
    vec2 t_GradientCoord = vec2(fract(v_Gradient.x / ${GRADIENT_WIDTH.toFixed(1)}), clamp(v_Gradient.y, 0.5, ${(GRADIENT_HEIGHT - 0.5).toFixed(1)}) / ${GRADIENT_HEIGHT.toFixed(1)});
    float t_Gradient = texture(SAMPLER_2D(u_Gradient), t_GradientCoord).r;
    vec3 t_Color = (v_Prim - v_Env) * t_Gradient + v_Env;
    t_Color = (t_Color - vec3(v_Shadow * t_Gradient)) * t_Glyph.r;
    gl_FragColor = vec4(t_Color, t_Glyph.a);
}
`;
}

interface Font {
    cell: number;
    padding: number;
    width: number;
    offsets: Int32Array;
    texture: GfxTexture;
    gradient: GfxTexture;
    shadowGradient: GfxTexture;
}

export interface TextAssets {
    large: ArrayBufferSlice;
    small: ArrayBufferSlice;
    tables: ArrayBufferSlice;
    gradients: ArrayBufferSlice;
}

export class TGRText {
    public size = 10;
    public align = TextAlign.Left;
    public bold = false;
    public shadow = false;
    public custom: number[] | null = null;
    public highRes = true;

    private readonly charToGlyph: Uint8Array;
    private readonly large: Font;
    private readonly small: Font;
    private readonly program: GfxProgram;
    private readonly sampler: GfxSampler;
    private readonly gradientSampler: GfxSampler;
    private readonly vertexBuffer: GfxBuffer;
    private readonly indexBuffer: GfxBuffer;
    private readonly inputLayout: GfxInputLayout;
    private readonly vertexData = new Float32Array(MAX_GLYPHS * 4 * FLOATS_PER_VERTEX);
    private readonly batches: { font: Font; shadow: boolean; first: number; count: number }[] = [];
    private glyphCount = 0;
    private readonly megaState: Partial<GfxMegaStateDescriptor> = {
        depthCompare: GfxCompareMode.Always,
        depthWrite: false,
        cullMode: GfxCullMode.None,
    };

    public constructor(
        private readonly device: GfxDevice,
        cache: GfxRenderCache,
        assets: TextAssets,
    ) {
        setAttachmentStateSimple(this.megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        const tables = assets.tables.createDataView();
        this.charToGlyph = assets.tables.createTypedArray(Uint8Array, 0, 0x60);
        const readOffsets = (start: number, count: number): Int32Array => {
            const out = new Int32Array(count);
            for (let i = 0; i < count; i++) {
                out[i] = tables.getInt32(start + i * 4);
            }
            return out;
        };
        const gradients = assets.gradients.createTypedArray(Uint8Array);
        const gradient = (index: number): GfxTexture => this.createGradient(gradients.subarray(index * 0x140, (index + 1) * 0x140));
        this.large = {
            cell: LARGE_FONT_CELL,
            padding: LARGE_FONT_PADDING,
            width: LARGE_FONT_WIDTH,
            offsets: readOffsets(0x60, 0xdc / 4),
            texture: this.createFont(assets.large.createTypedArray(Uint8Array), LARGE_FONT_WIDTH, LARGE_FONT_CELL * 2),
            gradient: gradient(0),
            shadowGradient: gradient(1),
        };
        this.small = {
            cell: SMALL_FONT_CELL,
            padding: SMALL_FONT_PADDING,
            width: SMALL_FONT_WIDTH,
            offsets: readOffsets(0x60 + 0xdc, 0xec / 4),
            texture: this.createFont(assets.small.createTypedArray(Uint8Array), SMALL_FONT_WIDTH, SMALL_FONT_CELL * 2),
            gradient: gradient(2),
            shadowGradient: gradient(3),
        };
        this.program = cache.createProgram(new TextProgram());
        const samplerDesc = {
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 0,
        };
        this.sampler = cache.createSampler(samplerDesc);
        this.gradientSampler = cache.createSampler({ ...samplerDesc, wrapS: GfxWrapMode.Repeat });
        this.vertexBuffer = device.createBuffer(this.vertexData.byteLength, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
        const indices = new Uint16Array(MAX_GLYPHS * 6);
        for (let i = 0; i < MAX_GLYPHS; i++) {
            indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
        }
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexBufferDescriptors: [{ byteStride: FLOATS_PER_VERTEX * 4, frequency: GfxVertexBufferFrequency.PerVertex }],
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 2 * 4 },
                { location: 2, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6 * 4 },
                { location: 3, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 10 * 4 },
            ],
        });
    }

    public reset(): void {
        this.glyphCount = 0;
        this.batches.length = 0;
    }

    public measure(text: string, size: number): number {
        let scaled = size;
        if (this.highRes) {
            scaled *= 2;
        }
        const font = scaled < SMALL_FONT_MAX_SIZE ? this.small : this.large;
        let width = 0;
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            if (c < 0x21 || c >= 0x80) {
                width += Math.trunc((scaled * SPACE_ADVANCE) / SIZE_UNITS);
                continue;
            }
            if (text[i] === "%" && i + 1 < text.length) {
                if (text[i + 1] === "%") {
                    i++;
                } else if (text[i + 1] === "i" || text[i + 1] === "n") {
                    i++;
                    continue;
                } else if (i + 2 < text.length) {
                    i += 2;
                    continue;
                }
            }
            const glyph = this.charToGlyph[text.charCodeAt(i) - 0x21];
            width += Math.trunc(((font.offsets[glyph + 1] - font.offsets[glyph] - font.padding + 1) * scaled) / font.cell);
        }
        return this.highRes ? width >> 1 : width;
    }

    public draw(text: string, x: number, y: number, box: number[]): void {
        if (this.align === TextAlign.Center) {
            x -= this.measure(text, this.size) >> 1;
        } else if (this.align === TextAlign.Right) {
            x -= this.measure(text, this.size);
        }
        const scale = this.highRes ? 2 : 1;
        let size = this.size;
        y -= Math.trunc((size * ASCENT) / SIZE_UNITS);
        x *= scale;
        y *= scale;
        size *= scale;
        const font = size < SMALL_FONT_MAX_SIZE ? this.small : this.large;
        let prim: number[];
        let env: number[];
        if (this.custom !== null) {
            env = this.custom.slice(0, 3);
            prim = this.custom.slice(3, 6);
        } else if (this.bold) {
            env = [0xff, 0x7f, 0x00];
            prim = [0xff, 0xff, 0x7f];
        } else {
            env = [0xc8, 0x00, 0x00];
            prim = [0xe6, 0xe6, 0x00];
        }
        const first = this.glyphCount;
        const screenW = SCREEN_WIDTH * scale;
        const screenH = SCREEN_HEIGHT * scale;
        for (let i = 0; i < text.length; i++) {
            let c = text[i];
            if (c === " ") {
                x += Math.trunc((size * SPACE_ADVANCE) / SIZE_UNITS) + 1;
                continue;
            }
            if (c === "%" && i + 1 < text.length) {
                if (text[i + 1] === "%") {
                    i++;
                    c = text[i];
                } else if (text[i + 1] === "i" || text[i + 1] === "n") {
                    i++;
                    continue;
                } else if (i + 2 < text.length) {
                    prim = PRIM_CODES[text[i + 1]] ?? prim;
                    env = ENV_CODES[text[i + 2]] ?? env;
                    i += 2;
                    continue;
                }
            }
            const code = c.charCodeAt(0);
            if (code < 0x21 || code >= 0x80 || this.glyphCount >= MAX_GLYPHS) {
                continue;
            }
            const glyph = this.charToGlyph[code - 0x21];
            const row = glyph < FIRST_ROW_GLYPH ? font.cell : 0;
            const left = font.offsets[glyph];
            const columns = font.offsets[glyph + 1] - left + 1;
            const width = Math.trunc((columns * size) / font.cell);
            const s0 = 0.5;
            const s1 = 0.5 + columns;
            const t0 = font.cell - 1 + 0.5;
            const t1 = t0 - ((font.cell - 1) * size) / size;
            const corners = [
                [x, y, s0, t0],
                [x + width, y, s1, t0],
                [x, y + size, s0, t1],
                [x + width, y + size, s1, t1],
            ];
            corners.forEach(([px, py, s, t], k) => {
                const nx = box[0] + (px / screenW) * box[2];
                const ny = box[1] + (py / screenH) * box[3];
                this.vertexData.set(
                    [
                        nx * 2 - 1,
                        1 - ny * 2,
                        (left + s) / font.width,
                        (row + t) / (font.cell * 2),
                        s - 0.5,
                        t - 0.5,
                        prim[0] / 0xff,
                        prim[1] / 0xff,
                        prim[2] / 0xff,
                        this.shadow ? 1 : 0,
                        env[0] / 0xff,
                        env[1] / 0xff,
                        env[2] / 0xff,
                        1,
                    ],
                    (this.glyphCount * 4 + k) * FLOATS_PER_VERTEX,
                );
            });
            this.glyphCount++;
            x += Math.trunc(((columns - font.padding) * size) / font.cell);
        }
        if (this.glyphCount > first) {
            this.batches.push({ font, shadow: this.shadow, first, count: this.glyphCount - first });
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        if (this.glyphCount === 0) {
            return;
        }
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexData.buffer, 0, this.glyphCount * 4 * FLOATS_PER_VERTEX * 4));
        for (const batch of this.batches) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 2 }]);
            renderInst.setGfxProgram(this.program);
            renderInst.setMegaStateFlags(this.megaState);
            renderInst.setVertexInput(this.inputLayout, [{ buffer: this.vertexBuffer }], { buffer: this.indexBuffer });
            renderInst.setSamplerBindingsFromTextureMappings([
                { gfxTexture: batch.font.texture, gfxSampler: this.sampler },
                { gfxTexture: batch.shadow ? batch.font.shadowGradient : batch.font.gradient, gfxSampler: this.gradientSampler },
            ]);
            const offs = renderInst.allocateUniformBuffer(TextProgram.ub_Params, 4);
            fillVec4(renderInst.mapUniformBufferF32(TextProgram.ub_Params), offs, 0, 0, 0, 0);
            renderInst.setDrawCount(batch.count * 6, batch.first * 6);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice): void {
        for (const font of [this.large, this.small]) {
            device.destroyTexture(font.texture);
            device.destroyTexture(font.gradient);
            device.destroyTexture(font.shadowGradient);
        }
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }

    private createFont(ia8: Uint8Array, width: number, height: number): GfxTexture {
        const pixels = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const intensity = (ia8[i] >>> 4) * 0x11;
            pixels.set([intensity, intensity, intensity, (ia8[i] & 0x0f) * 0x11], i * 4);
        }
        const texture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        this.device.uploadTextureData(texture, 0, [pixels]);
        return texture;
    }

    private createGradient(data: Uint8Array): GfxTexture {
        const pixels = new Uint8Array(GRADIENT_WIDTH * GRADIENT_HEIGHT * 4);
        for (let y = 0; y < GRADIENT_HEIGHT; y++) {
            for (let x = 0; x < GRADIENT_WIDTH; x++) {
                const source = y * GRADIENT_WIDTH + ((y & 1) !== 0 ? x ^ 4 : x);
                const intensity = (data[source] >>> 4) * 0x11;
                pixels.set([intensity, intensity, intensity, (data[source] & 0x0f) * 0x11], (y * GRADIENT_WIDTH + x) * 4);
            }
        }
        const texture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, GRADIENT_WIDTH, GRADIENT_HEIGHT, 1));
        this.device.uploadTextureData(texture, 0, [pixels]);
        return texture;
    }
}
