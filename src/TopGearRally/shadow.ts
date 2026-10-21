import { mat4 } from "gl-matrix";
import { DeviceProgram } from "../Program.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxBlendFactor,
    GfxBlendMode,
    GfxCompareMode,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxMegaStateDescriptor,
    GfxMipFilterMode,
    GfxProgram,
    GfxSampler,
    GfxTexFilterMode,
    GfxTexture,
    GfxWrapMode,
    makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { TextureMapping } from "../TextureHolder.js";

const SHADOW_LENGTH_SCALE = 235.52;
const SHADOW_WIDTH_SCALE = 161.28;
const SHADOW_CENTER = 512;
const TEXCOORD_TO_UV = 1 / 1024;
const ALPHA_THRESHOLD = 8 / 255;
const TEXTURE_SIDE = 64;

class ShadowProgram extends DeviceProgram {
    public static ub_Params = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_ClipFromLocal;
    Mat4x4 u_TexGen;
    vec4 u_Color;
};

uniform sampler2D u_Texture;
varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = 0) in vec4 a_Position;

void main() {
    vec4 t_Local = vec4(a_Position.xyz, 1.0);
    gl_Position = UnpackMatrix(u_ClipFromLocal) * t_Local;
    vec4 t_Tc = UnpackMatrix(u_TexGen) * t_Local;
    v_TexCoord = trunc(t_Tc.xy) * ${TEXCOORD_TO_UV};
}
`;

    public override frag = `
void main() {
    float t_Alpha = texture(SAMPLER_2D(u_Texture), clamp(v_TexCoord, vec2(0.0), vec2(1.0))).r;
    if (t_Alpha < ${ALPHA_THRESHOLD})
        discard;
    gl_FragColor = vec4(u_Color.rgb, t_Alpha);
}
`;
}

export interface ShadowCaster {
    position: number[];
    forward: number[];
    up: number[];
    side: number[];
    wheelX: number;
    wheelY: number;
    fogFactor: number;
}

export interface ShadowSurface {
    clipFromLocal: mat4;
    instanceMatrix: Float32Array;
    ranges: [number, number][];
}

type Row = [number, number, number, number];

function multiply(a: Row[], b: Row[]): Row[] {
    return a.map((row) => [0, 1, 2, 3].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j] + row[3] * b[3][j]) as Row);
}

export class TGRShadows {
    private readonly program: GfxProgram;
    private readonly texture: GfxTexture;
    private readonly sampler: GfxSampler;
    private readonly mapping = [new TextureMapping()];
    private readonly megaState: Partial<GfxMegaStateDescriptor> = {
        depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual),
        depthWrite: false,
        polygonOffset: true,
    };

    public constructor(device: GfxDevice, cache: GfxRenderCache, particle: Uint8Array) {
        setAttachmentStateSimple(this.megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        this.program = cache.createProgram(new ShadowProgram());
        this.texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, TEXTURE_SIDE, TEXTURE_SIDE, 1));
        const pixels = new Uint8Array(TEXTURE_SIDE * TEXTURE_SIDE * 4);
        for (let i = 0; i < TEXTURE_SIDE * TEXTURE_SIDE; i++) {
            pixels.fill(particle[i], i * 4, i * 4 + 4);
        }
        device.uploadTextureData(this.texture, 0, [pixels]);
        this.sampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
        });
        this.mapping[0].gfxTexture = this.texture;
        this.mapping[0].gfxSampler = this.sampler;
    }

    public prepareToRender(
        renderInstManager: GfxRenderInstManager,
        caster: ShadowCaster,
        surfaces: ShadowSurface[],
        fogColor: number[],
        cullMode: GfxCullMode,
    ): void {
        const forward = [caster.forward[0], caster.forward[1]];
        if (forward[0] === 0 && forward[1] === 0) {
            forward[0] = caster.up[0];
            forward[1] = caster.up[1];
        }
        let lengthScale = Math.max(Math.hypot(forward[0], forward[1]), 0.5);
        let widthScale = Math.max(Math.hypot(caster.side[0], caster.side[1]), 0.5);
        lengthScale = SHADOW_LENGTH_SCALE / caster.wheelX / lengthScale;
        widthScale = SHADOW_WIDTH_SCALE / caster.wheelY / widthScale;
        const length = Math.hypot(forward[0], forward[1]);
        const fx = forward[0] / length;
        const fy = forward[1] / length;
        const alongX = fx * lengthScale;
        const alongY = -fy * lengthScale;
        const acrossX = fx * widthScale;
        const acrossY = -fy * widthScale;
        const scratch: Row[] = [
            [alongX, acrossY, 0, 0],
            [-alongY, acrossX, 0, 0],
            [0, 0, 1, 0],
            [SHADOW_CENTER, SHADOW_CENTER, 0, 1],
        ];
        const envAlpha = Math.max(0, Math.min(255, Math.trunc(caster.fogFactor * 255)));
        const color = fogColor.map((c) => (c * envAlpha) / 255 / 255);
        for (const surface of surfaces) {
            const m = surface.instanceMatrix;
            const instance: Row[] = [
                [m[0], m[1], m[2], m[3]],
                [m[4], m[5], m[6], m[7]],
                [m[8], m[9], m[10], m[11]],
                [m[12] - caster.position[0], m[13] - caster.position[1], m[14], m[15]],
            ];
            const t = multiply(instance, scratch);
            const sum = t[3][3] + (t[0][3] + t[1][3] + t[2][3]);
            const scale = sum === 0 ? 1 : 1 / sum;
            for (const row of t) {
                row[0] *= scale;
                row[1] *= scale;
            }
            const texGen = mat4.fromValues(...t[0], ...t[1], ...t[2], ...t[3]);
            for (const [first, count] of surface.ranges) {
                const renderInst = renderInstManager.newRenderInst();
                renderInst.setGfxProgram(this.program);
                renderInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
                renderInst.setSamplerBindingsFromTextureMappings(this.mapping);
                renderInst.setMegaStateFlags(this.megaState);
                renderInst.setMegaStateFlags({ cullMode });
                let offs = renderInst.allocateUniformBuffer(ShadowProgram.ub_Params, 16 + 16 + 4);
                const d = renderInst.mapUniformBufferF32(ShadowProgram.ub_Params);
                offs += fillMatrix4x4(d, offs, surface.clipFromLocal);
                offs += fillMatrix4x4(d, offs, texGen);
                fillVec4(d, offs, color[0], color[1], color[2], 1);
                renderInst.setDrawCount(count, first);
                renderInstManager.submitRenderInst(renderInst);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}
