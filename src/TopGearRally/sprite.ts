import { DeviceProgram } from "../Program.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
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
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./text.js";

export enum TexRectBlend {
    Texture = 0,
    ColorThroughTexture = 1,
    Texture2 = 2,
    Shaded = 3,
    ShadedOpaque = 4,
}

export enum SpriteFormat {
    RGBA16,
    IA16,
    I4,
}

const MAX_RECTS = 64;
const FLOATS_PER_VERTEX = 13;

class SpriteProgram extends DeviceProgram {
    public override both = `
uniform sampler2D u_Texture;
varying vec2 v_TexCoord;
varying vec4 v_Prim;
varying vec4 v_Env;
varying float v_Mode;
`;

    public override vert = `
layout(location = 0) in vec4 a_Position;
layout(location = 1) in vec4 a_Prim;
layout(location = 2) in vec4 a_Env;
layout(location = 3) in float a_Mode;

void main() {
    v_TexCoord = a_Position.zw;
    v_Prim = a_Prim;
    v_Env = a_Env;
    v_Mode = a_Mode;
    gl_Position = vec4(a_Position.xy, 0.5, 1.0);
}
`;

    public override frag = `
void main() {
    vec4 t_Tex = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    vec4 t_Color = t_Tex;
    if (v_Mode == 1.0) {
        t_Color = vec4(v_Prim.rgb, t_Tex.a);
    } else if (v_Mode == 3.0) {
        t_Color = vec4((v_Env.rgb - v_Prim.rgb) * t_Tex.rgb + v_Prim.rgb, t_Tex.a);
    } else if (v_Mode == 4.0) {
        t_Color = vec4((v_Env.rgb - v_Prim.rgb) * t_Tex.rgb + v_Prim.rgb, 1.0);
    }
    gl_FragColor = t_Color;
}
`;
}

export class SpriteTexture {
    public readonly gfxTexture: GfxTexture;

    public constructor(
        device: GfxDevice,
        data: Uint8Array,
        public readonly width: number,
        public readonly height: number,
        format: SpriteFormat,
    ) {
        const pixels = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            let r: number;
            let g: number;
            let b: number;
            let a: number;
            if (format === SpriteFormat.RGBA16) {
                const v = (data[i * 2] << 8) | data[i * 2 + 1];
                r = ((v >>> 11) & 0x1f) * 255 / 31;
                g = ((v >>> 6) & 0x1f) * 255 / 31;
                b = ((v >>> 1) & 0x1f) * 255 / 31;
                a = v & 1 ? 0xff : 0;
            } else if (format === SpriteFormat.IA16) {
                r = g = b = data[i * 2];
                a = data[i * 2 + 1];
            } else {
                const nibble = i & 1 ? data[i >>> 1] & 0x0f : data[i >>> 1] >>> 4;
                r = g = b = a = nibble * 0x11;
            }
            pixels.set([r, g, b, a], i * 4);
        }
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        device.uploadTextureData(this.gfxTexture, 0, [pixels]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class TGRSprites {
    private readonly program: GfxProgram;
    private readonly sampler: GfxSampler;
    private readonly vertexBuffer: GfxBuffer;
    private readonly indexBuffer: GfxBuffer;
    private readonly inputLayout: GfxInputLayout;
    private readonly vertexData = new Float32Array(MAX_RECTS * 4 * FLOATS_PER_VERTEX);
    private readonly rects: { texture: SpriteTexture; opaque: boolean }[] = [];
    private readonly opaqueState: Partial<GfxMegaStateDescriptor> = {
        depthCompare: GfxCompareMode.Always,
        depthWrite: false,
        cullMode: GfxCullMode.None,
    };
    private readonly blendState: Partial<GfxMegaStateDescriptor> = {
        depthCompare: GfxCompareMode.Always,
        depthWrite: false,
        cullMode: GfxCullMode.None,
    };

    public constructor(
        private readonly device: GfxDevice,
        cache: GfxRenderCache,
    ) {
        setAttachmentStateSimple(this.blendState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        this.program = cache.createProgram(new SpriteProgram());
        this.sampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 0,
        });
        this.vertexBuffer = device.createBuffer(this.vertexData.byteLength, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
        const indices = new Uint16Array(MAX_RECTS * 6);
        for (let i = 0; i < MAX_RECTS; i++) {
            indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
        }
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexBufferDescriptors: [{ byteStride: FLOATS_PER_VERTEX * 4, frequency: GfxVertexBufferFrequency.PerVertex }],
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4 },
                { location: 2, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4 },
                { location: 3, bufferIndex: 0, format: GfxFormat.F32_R, bufferByteOffset: 12 * 4 },
            ],
        });
    }

    public reset(): void {
        this.rects.length = 0;
    }

    public draw(
        texture: SpriteTexture,
        x: number,
        y: number,
        width: number,
        height: number,
        prim: number[],
        env: number[],
        blend: TexRectBlend,
        box: number[],
    ): void {
        if (this.rects.length >= MAX_RECTS) {
            return;
        }
        width = Math.abs(width);
        const corners = [
            [x, y, 0, 1],
            [x + width, y, 1, 1],
            [x, y + height, 0, 0],
            [x + width, y + height, 1, 0],
        ];
        const index = this.rects.length;
        corners.forEach(([px, py, u, v], k) => {
            const nx = box[0] + (px / SCREEN_WIDTH) * box[2];
            const ny = box[1] + (py / SCREEN_HEIGHT) * box[3];
            this.vertexData.set(
                [
                    nx * 2 - 1,
                    1 - ny * 2,
                    u,
                    v,
                    prim[0] / 0xff,
                    prim[1] / 0xff,
                    prim[2] / 0xff,
                    prim[3] / 0xff,
                    env[0] / 0xff,
                    env[1] / 0xff,
                    env[2] / 0xff,
                    env[3] / 0xff,
                    blend === TexRectBlend.Texture2 ? 0 : blend,
                ],
                (index * 4 + k) * FLOATS_PER_VERTEX,
            );
        });
        this.rects.push({ texture, opaque: blend === TexRectBlend.ShadedOpaque });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        if (this.rects.length === 0) {
            return;
        }
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexData.buffer, 0, this.rects.length * 4 * FLOATS_PER_VERTEX * 4));
        this.rects.forEach((rect, i) => {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
            renderInst.setGfxProgram(this.program);
            renderInst.setMegaStateFlags(rect.opaque ? this.opaqueState : this.blendState);
            renderInst.setVertexInput(this.inputLayout, [{ buffer: this.vertexBuffer }], { buffer: this.indexBuffer });
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: rect.texture.gfxTexture, gfxSampler: this.sampler }]);
            renderInst.setDrawCount(6, i * 6);
            renderInstManager.submitRenderInst(renderInst);
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}
