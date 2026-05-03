import { mat4, vec3 } from "gl-matrix";
import { defaultMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode, GfxTextureUsage, GfxTextureDimension, GfxCompareMode, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxIndexBufferDescriptor, GfxVertexBufferDescriptor, GfxMegaStateDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxInputLayout, GfxProgram, GfxSampler, GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { SpyroSkybox, SpyroLevel, SpyroMobyInstance, SPYRO_TILE_SCROLL_MAP, SpyroDrawCall } from "./bin";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { colorNewFromRGBA, White } from "../Color";
import { DebugDrawFlags } from "../gfx/helpers/DebugDraw";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { Destroyable } from "../SceneBase";
import { computeViewMatrixSkybox } from "../Camera";

class Shader extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_BatchParams = 1;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Clip;
    float u_Time;
    float u_LOD;
};

layout(std140) uniform ub_BatchParams {
    float u_Brightness;
    float u_IsWater;
    float u_Scroll;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_UV;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_UV;

void main() {
    vec3 worldPos = a_Position;
    v_Color = a_Color;
    v_UV = a_UV;

    if (u_IsWater > 0.1) {
        float t1 = u_Time;
        float t2 = u_Time * 0.12;
        float phase = dot(worldPos.xz, vec2(0.025, 0.03));
        float wave = sin(t1 + phase) * 3.0 + sin(t2 + phase * 1.7) * 1.5;
        worldPos.z += wave * 1.1;
    }

    gl_Position = UnpackMatrix(u_Clip) * vec4(worldPos, 1.0);
}
#endif

#ifdef FRAG
void main() {
    if (u_LOD == 1.0) {
        gl_FragColor = v_Color;
        return;
    }

    vec2 uv = v_UV;
    if (u_Scroll > 0.1) {
        uv.y = fract(uv.y - u_Time * 0.45);
    }
    vec4 texColor = texture(SAMPLER_2D(u_Texture), uv);

    gl_FragColor = vec4(texColor.rgb * v_Color.rgb * u_Brightness, 1.0);
}
#endif
    `;

    constructor() {
        super();
    }
}

const BRIGHTNESS_OPAQUE = 1.9;
const BRIGHTNESS_TRANSPARENT = 1.0;
const MOBY_POS_SCALE = 1.0 / 16.0;
const MOBY_ROT_COLOR = colorNewFromRGBA(1, 1, 0, 1);
const MOBY_DEBUG_FLAGS = { flags: DebugDrawFlags.WorldSpace };
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];
const BINDING_LAYOUTS_SKY: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 0 }];
const NOCLIP_SPACE_CORRECTION = mat4.fromValues(
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);
const SCRATCH_CLIP = mat4.create();
const SCRATCH_SKY_VIEW = mat4.create();
const SCRATCH_MOBY_POS = vec3.create();
const SCRATCH_MOBY_ROT = vec3.create();

export class SpyroLevelRenderer {
    public showMobys: boolean = false;
    public useLOD: boolean = false;
    public showTextures: boolean = true;
    public gfxTextures: GfxTexture[] = [];
    private gfxProgram: GfxProgram;
    private gfxSampler: GfxSampler;
    private indexBufferDescriptors: GfxIndexBufferDescriptor[];
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private batchesGround: SpyroDrawCall[] = [];
    private batchesTransparent: SpyroDrawCall[] = [];
    private batchesLOD: SpyroDrawCall[] = [];
    private inputLayout: GfxInputLayout;
    private tileCount: number;
    private gameNumber: number;
    private scrollFlags: number[];

    constructor(cache: GfxRenderCache, level: SpyroLevel, private mobyInstances: SpyroMobyInstance[]) {
        const device = cache.device;
        this.gameNumber = level.game;
        this.tileCount = level.textures.headers.length;
        this.gfxTextures = new Array(this.tileCount);
        for (let i = 0; i < this.tileCount; i++) {
            const rgba = level.textures.colors[i];
            const texture = device.createTexture({
                width: 64, height: 64,
                numLevels: 2,
                pixelFormat: GfxFormat.U8_RGBA_NORM,
                usage: GfxTextureUsage.Sampled,
                dimension: GfxTextureDimension.n2D,
                depthOrArrayLayers: 1
            });
            device.setResourceName(texture, `tile_${i}`);
            device.uploadTextureData(texture, 0, rgba);
            this.gfxTextures[i] = texture;
        }

        this.scrollFlags = Array(this.tileCount).fill(0.0);
        if (level.id in SPYRO_TILE_SCROLL_MAP[level.game]) {
            for (const ti of SPYRO_TILE_SCROLL_MAP[level.game][level.id]) {
                if (ti != null && ti >= 0 && ti < this.tileCount) {
                    this.scrollFlags[ti] = 1.0;
                }
            }
        }

        this.gfxProgram = cache.createProgram(new Shader());
        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp
        });

        this.vertexBufferDescriptors = [
            { buffer: createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, level.vertices!.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, level.colors!.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, level.uvs!.buffer), byteOffset: 0 }
        ];
        this.indexBufferDescriptors = [
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, level.indicesGround!.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, level.indicesTransparent!.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, level.indicesLOD!.buffer), byteOffset: 0 }
        ];

        this.batchesGround = level.batchesGround;
        this.batchesTransparent = level.batchesTransparent;
        this.batchesLOD = level.batchesLOD;

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 }
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex }
            ],
            indexBufferFormat: GfxFormat.U32_R
        });
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInstManager = renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplate();
        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts(BINDING_LAYOUTS);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offs = template.allocateUniformBuffer(Shader.ub_SceneParams, 18);
        const d = template.mapUniformBufferF32(Shader.ub_SceneParams);
        // u_Clip (16)
        mat4.mul(SCRATCH_CLIP, viewerInput.camera.clipFromWorldMatrix, NOCLIP_SPACE_CORRECTION);
        offs += fillMatrix4x4(d, offs, SCRATCH_CLIP);
        // u_Time (1)
        d[offs++] = viewerInput.time * 0.001 * (this.gameNumber === 1 ? 2.6 : 2); // lazy way to hardcode speed for now
        // u_LOD (1)
        d[offs++] = (this.useLOD) || !this.showTextures ? 1.0 : 0.0;

        if (this.useLOD) {
            this.drawBatches(renderInstManager, this.batchesLOD, this.indexBufferDescriptors[2], false);
        } else {
            this.drawBatches(renderInstManager, this.batchesGround, this.indexBufferDescriptors[0], false);
            this.drawBatches(renderInstManager, this.batchesTransparent, this.indexBufferDescriptors[1], true);
        }

        if (this.showMobys) {
            this.drawMobys(renderHelper);
        }

        renderInstManager.popTemplate();
    }

    private drawBatches(renderInstManager: GfxRenderInstManager, batches: SpyroDrawCall[], indexBuffer: GfxIndexBufferDescriptor, additiveBlend: boolean) {
        for (const batch of batches) {
            const renderInst = renderInstManager.newRenderInst();

            let offs = renderInst.allocateUniformBuffer(Shader.ub_BatchParams, 3);
            const d = renderInst.mapUniformBufferF32(Shader.ub_BatchParams);
            // u_Brightness (1)
            d[offs++] = additiveBlend ? BRIGHTNESS_TRANSPARENT : BRIGHTNESS_OPAQUE;
            // u_IsWater (1)
            d[offs++] = batch.isWater ? 1.0 : 0.0;
            // u_Scroll (1)
            d[offs++] = this.scrollFlags[batch.tileIndex];

            const megaState = renderInst.getMegaStateFlags();
            if (additiveBlend) {
                megaState.depthWrite = false;
                setAttachmentStateSimple(megaState, {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.One
                });
            }
            renderInst.setMegaStateFlags(megaState);
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.gfxTextures[batch.tileIndex], gfxSampler: this.gfxSampler }]);
            renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, indexBuffer);
            renderInst.setDrawCount(batch.indexCount, batch.indexOffset);

            renderInstManager.submitRenderInst(renderInst);
        }
    }

    private drawMobys(renderHelper: GfxRenderHelper): void {
        for (let i = 0; i < this.mobyInstances.length; i++) {
            const instance = this.mobyInstances[i];
            vec3.transformMat4(SCRATCH_MOBY_POS, vec3.fromValues(instance.x * MOBY_POS_SCALE, instance.y * MOBY_POS_SCALE, instance.z * MOBY_POS_SCALE), NOCLIP_SPACE_CORRECTION);

            const r = ((instance.classId * 97) & 255) / 255;
            const g = ((instance.classId * 57) & 255) / 255;
            const b = ((instance.classId * 17) & 255) / 255;
            renderHelper.debugDraw.drawLocator(SCRATCH_MOBY_POS, 20, colorNewFromRGBA(r, g, b, 1), MOBY_DEBUG_FLAGS);

            const yawRad = ((instance.yaw + 64) & 0xFF) / 256 * (Math.PI * 2);
            const forward = vec3.fromValues(Math.sin(yawRad), 0, Math.cos(yawRad));
            vec3.scale(forward, forward, 40);
            vec3.add(SCRATCH_MOBY_ROT, SCRATCH_MOBY_POS, forward);
            renderHelper.debugDraw.drawLine(SCRATCH_MOBY_POS, SCRATCH_MOBY_ROT, MOBY_ROT_COLOR, undefined, MOBY_DEBUG_FLAGS);

            const s = `${instance.classId} (${i})`;
            SCRATCH_MOBY_POS[0] -= s.length * 7; // roughly center it
            SCRATCH_MOBY_POS[1] += 50;
            renderHelper.debugDraw.drawWorldTextRU(s, SCRATCH_MOBY_POS, White, undefined, undefined, MOBY_DEBUG_FLAGS);
        }
    }

    public destroy(device: GfxDevice) {
        for (const d of this.indexBufferDescriptors) {
            device.destroyBuffer(d.buffer);
        }
        for (const d of this.vertexBufferDescriptors) {
            device.destroyBuffer(d.buffer);
        }
        for (const tex of this.gfxTextures) {
            device.destroyTexture(tex);
        }
    }
}

class SkyboxShader extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Clip;
};

varying vec3 v_Color;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;

void main() {
    v_Color = a_Color;
    gl_Position = UnpackMatrix(u_Clip) * vec4(a_Position, 1.0);
}
#endif

#ifdef FRAG
void main() {
    gl_FragColor = vec4(v_Color, 1.0);
}
#endif
    `;

    constructor() {
        super();
    }
}

export class SpyroSkyboxRenderer implements Destroyable {
    private drawCount: number;
    private gfxInputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;
    private megaStateFlags: GfxMegaStateDescriptor;
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(cache: GfxRenderCache, sky: SpyroSkybox) {
        const expandedPos: number[] = [];
        const expandedColor: number[] = [];
        const expandedIndex: number[] = [];
        let i = 0;
        for (const face of sky.faces) {
            for (let k = 0; k < 3; k++) {
                const vertex = sky.vertices[face.indices[k]];
                const color = sky.colors[face.colors[k]];
                expandedPos.push(vertex[0], vertex[1], vertex[2]);
                expandedColor.push(color[0] / 255, color[1] / 255, color[2] / 255);
                expandedIndex.push(i++);
            }
        }
        this.gfxProgram = cache.createProgram(new SkyboxShader());
        this.megaStateFlags = makeMegaState({ cullMode: GfxCullMode.None, depthCompare: GfxCompareMode.Always, depthWrite: false }, defaultMegaState);
        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }
            ],
            indexBufferFormat: GfxFormat.U32_R
        });
        this.drawCount = expandedIndex.length;
        this.indexBufferDescriptor = { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, new Uint32Array(expandedIndex).buffer), byteOffset: 0 };
        this.vertexBufferDescriptors = [
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedPos).buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedColor).buffer), byteOffset: 0 }
        ];
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInstManager = renderHelper.renderInstManager;
        const renderInst = renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setBindingLayouts(BINDING_LAYOUTS_SKY);
        renderInst.setUniformBuffer(renderHelper.uniformBuffer);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(SkyboxShader.ub_SceneParams, 16);
        const d = renderInst.mapUniformBufferF32(SkyboxShader.ub_SceneParams);
        // u_Clip (16)
        computeViewMatrixSkybox(SCRATCH_SKY_VIEW, viewerInput.camera);
        mat4.mul(SCRATCH_CLIP, viewerInput.camera.projectionMatrix, SCRATCH_SKY_VIEW);
        mat4.mul(SCRATCH_CLIP, SCRATCH_CLIP, NOCLIP_SPACE_CORRECTION);
        offs += fillMatrix4x4(d, offs, SCRATCH_CLIP);

        renderInst.setVertexInput(this.gfxInputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        renderInst.setDrawCount(this.drawCount);

        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.indexBufferDescriptor.buffer);
        for (const d of this.vertexBufferDescriptors) {
            device.destroyBuffer(d.buffer);
        }
    }
}
