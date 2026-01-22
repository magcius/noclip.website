import { mat4, vec3 } from "gl-matrix";
import { defaultMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode, GfxTextureUsage, GfxTextureDimension, GfxCompareMode, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxChannelWriteMask } from "../gfx/platform/GfxPlatform";
import { GfxBuffer, GfxInputLayout, GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { Skybox, Level } from "./bin";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";

class LevelProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_LevelCenter;
    float u_Time;
    float u_WaterAmp;
    float u_WaterSpeed1;
    float u_WaterSpeed2;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_TexCoord = a_UV;

    vec3 worldPos = a_Position - u_LevelCenter.xyz;
    if (a_Color.a < 0.99) {
        float phase = dot(worldPos.xz, vec2(0.03, 0.04));
        float wave = sin(u_Time * u_WaterSpeed1 + phase) * 3.0 + sin(u_Time * u_WaterSpeed2 + phase * 1.7) * 1.5;
        worldPos.z += wave * u_WaterAmp;
    }

    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(worldPos, 1.0);
}
#endif

#ifdef FRAG
void main() {
    vec4 texColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    vec3 lit = texColor.rgb * v_Color.rgb;
    bool isWater = (v_Color.a < 0.99);
    if (isWater) {
        lit = mix(lit, vec3(0.0, 0.81, 0.81), 0.25);
    }

    float brightness = isWater ? 2.0 : 1.7;
    lit *= brightness;

    float bayer4x4[16] = float[16](
         0.0,  8.0,  2.0, 10.0,
        12.0,  4.0, 14.0,  6.0,
         3.0, 11.0,  1.0,  9.0,
        15.0,  7.0, 13.0,  5.0
    );
    int xi = int(mod(gl_FragCoord.x, 4.0));
    int yi = int(mod(gl_FragCoord.y, 4.0));
    float threshold = bayer4x4[yi * 4 + xi] / 16.0;

    vec3 dithered = lit + threshold * (1.0 / 31.0);
    vec3 final5 = floor(dithered * 31.0) / 31.0;

    gl_FragColor = vec4(final5, v_Color.a);
}
#endif
    `;

    constructor() {
        super();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];
const bindingLayoutsSky: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 0 }];
const noclipSpaceFromSpyroSpace = mat4.fromValues(
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);
const scratchMat4a = mat4.create();
const scratchViewNoTransform = mat4.create();
const scratchClipFromWorldNoTransform = mat4.create();

export class LevelRenderer {
    private vertexBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private indexBufferGround: GfxBuffer;
    private indexBufferWater: GfxBuffer;
    private indexCountGround: number;
    private indexCountWater: number;
    private inputLayout: GfxInputLayout;
    private texture: GfxTexture;
    private levelMin: vec3;
    private levelMax: vec3;
    private levelCenter: vec3;

    constructor(cache: GfxRenderCache, level: Level) {
        const device = cache.device;
        const atlas = level.atlas;
        
        this.texture = device.createTexture({
            width: atlas.width,
            height: atlas.height,
            numLevels: 1,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
            dimension: GfxTextureDimension.n2D,
            depthOrArrayLayers: 1
        });
        device.uploadTextureData(this.texture, 0, [atlas.data]);

        const { vertices, colors, faces, uvs } = level;
        const xs = vertices.map(v => v[0]);
        const ys = vertices.map(v => v[1]);
        const zs = vertices.map(v => v[2]);
        this.levelMin = vec3.fromValues(Math.min(...xs), Math.min(...ys), Math.min(...zs));
        this.levelMax = vec3.fromValues(Math.max(...xs), Math.max(...ys), Math.max(...zs));
        this.levelCenter = vec3.fromValues(
            (this.levelMin[0] + this.levelMax[0]) * 0.5,
            (this.levelMin[1] + this.levelMax[1]) * 0.5,
            (this.levelMin[2] + this.levelMax[2]) * 0.5,
        );

        const expandedPos: number[] = [];
        const expandedColor: number[] = [];
        const expandedUV: number[] = [];
        const expandedIndexGround: number[] = [];
        const expandedIndexWater: number[] = [];
        let runningIndex = 0;

        for (const face of faces) {
            const { indices, uvIndices, colorIndices, texture: tex } = face;
            const isWater = (face as any).isWater === true;
            for (let k = 0; k < indices.length; k++) {
                const v = vertices[indices[k]];
                expandedPos.push(v[0], v[1], v[2]);
                let r: number, g: number, b: number;
                if (isWater) {
                    r = g = b = 1.0;
                } else {
                    const c = colorIndices ? colors[colorIndices[k]] : [255, 255, 255];
                    r = c[0] / 255;
                    g = c[1] / 255;
                    b = c[2] / 255;
                }
                expandedColor.push(r, g, b, isWater ? 0.3 : 1.0);
                if (uvIndices) {
                    const uvVal = uvs[uvIndices[k]];
                    expandedUV.push(uvVal[0], uvVal[1]);
                } else {
                    expandedUV.push(0, 0);
                }
                if (isWater) {
                    expandedIndexWater.push(runningIndex);
                } else {
                    expandedIndexGround.push(runningIndex);
                }
                runningIndex++;
            }
        }

        const indexGround = new Uint32Array(expandedIndexGround);
        const indexWater = new Uint32Array(expandedIndexWater);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedPos).buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedColor).buffer);
        this.uvBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedUV).buffer);
        this.indexBufferGround = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexGround.buffer);
        this.indexBufferWater = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexWater.buffer);
        this.indexCountGround = indexGround.length;
        this.indexCountWater = indexWater.length;
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // a_Position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 }, // a_Color
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG,  bufferByteOffset: 0 }, // a_UV
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // pos (x,y,z)
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex }, // color (r,g,b,a)
                { byteStride: 8,  frequency: GfxVertexBufferFrequency.PerVertex }, // uv (u,v)
            ],
            indexBufferFormat: GfxFormat.U32_R,
        });
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInstManager = renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplate();
        const program = renderHelper.renderCache.createProgram(new LevelProgram());
        template.setGfxProgram(program);
        template.setBindingLayouts(bindingLayouts);
        template.setUniformBuffer(renderHelper.uniformBuffer);
        template.setSamplerBindingsFromTextureMappings([
            {
                gfxTexture: this.texture,
                gfxSampler: renderHelper.renderCache.createSampler({
                    minFilter: GfxTexFilterMode.Point,
                    magFilter: GfxTexFilterMode.Point,
                    mipFilter: GfxMipFilterMode.Nearest,
                    wrapS: GfxWrapMode.Clamp,
                    wrapT: GfxWrapMode.Clamp,
                }),
                lateBinding: null,
            }
        ]);

        let offs = template.allocateUniformBuffer(LevelProgram.ub_SceneParams, 24);
        const buf = template.mapUniformBufferF32(LevelProgram.ub_SceneParams);
        mat4.mul(scratchMat4a, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromSpyroSpace);
        offs += fillMatrix4x4(buf, offs, scratchMat4a);
        offs += fillVec4(buf, offs, this.levelCenter[0], this.levelCenter[1], this.levelCenter[2], 0);
        buf[offs++] = viewerInput.time * 0.001 * 2; // u_Time
        buf[offs++] = 1.0; // u_WaterAmp
        buf[offs++] = 0.50; // u_WaterSpeed1
        buf[offs++] = 0.23; // u_WaterSpeed2
        template.setVertexInput(
            this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer, byteOffset: 0 },
                { buffer: this.uvBuffer, byteOffset: 0 }
            ],
            { buffer: this.indexBufferGround, byteOffset: 0 }
        );

        {
            const renderInst = renderInstManager.newRenderInst();
            const megaState = renderInst.getMegaStateFlags();
            megaState.cullMode = GfxCullMode.None;
            setAttachmentStateSimple(megaState, {
                channelWriteMask: GfxChannelWriteMask.RGB,
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.Zero,
            });
            renderInst.setMegaStateFlags(megaState);
            renderInst.setVertexInput(
                this.inputLayout,
                [
                    { buffer: this.vertexBuffer, byteOffset: 0 },
                    { buffer: this.colorBuffer, byteOffset: 0 },
                    { buffer: this.uvBuffer, byteOffset: 0 }
                ],
                { buffer: this.indexBufferGround, byteOffset: 0 }
            );
            renderInst.setDrawCount(this.indexCountGround);
            renderInstManager.submitRenderInst(renderInst);
        }

        if (this.indexCountWater > 0) {
            const renderInst = renderInstManager.newRenderInst();
            const megaState = renderInst.getMegaStateFlags();
            megaState.cullMode = GfxCullMode.None;
            setAttachmentStateSimple(megaState, {
                channelWriteMask: GfxChannelWriteMask.RGB,
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            renderInst.setMegaStateFlags(megaState);
            renderInst.setVertexInput(
                this.inputLayout,
                [
                    { buffer: this.vertexBuffer, byteOffset: 0 },
                    { buffer: this.colorBuffer, byteOffset: 0 },
                    { buffer: this.uvBuffer, byteOffset: 0 }
                ],
                { buffer: this.indexBufferWater, byteOffset: 0 }
            );
            renderInst.setDrawCount(this.indexCountWater);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.indexBufferGround);
        device.destroyBuffer(this.indexBufferWater);
        device.destroyTexture(this.texture);
    }
}

class SkyboxProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_Dummy;
};

varying vec3 v_Color;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;

void main() {
    v_Color = a_Color;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(a_Position, 1.0);
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

export class SkyboxRenderer {
    private vertexBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private indexCount: number;
    private inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, sky: Skybox) {
        const device = cache.device;
        const { vertices, colors, faces } = sky;
        const expandedPos: number[] = [];
        const expandedColor: number[] = [];
        const expandedIndex: number[] = [];
        let runningIndex = 0;
        for (const face of faces) {
            const { indices, colorIndices } = face;
            for (let k = 0; k < 3; k++) {
                const vertex = vertices[indices[k]];
                const color = colors[colorIndices[k]];
                expandedPos.push(vertex[0], vertex[1], vertex[2]);
                expandedColor.push(color[0] / 255, color[1] / 255, color[2] / 255);
                expandedIndex.push(runningIndex++);
            }
        }
        const idx = new Uint32Array(expandedIndex);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedPos).buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedColor).buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, idx.buffer);
        this.indexCount = idx.length;
        this.inputLayout = cache.createInputLayout({
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
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInstManager = renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplate();

        const program = renderHelper.renderCache.createProgram(new SkyboxProgram());
        template.setGfxProgram(program);
        template.setBindingLayouts(bindingLayoutsSky);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        const megaState = makeMegaState({
            cullMode: GfxCullMode.None,
            depthCompare: GfxCompareMode.Always,
            depthWrite: false,
        }, defaultMegaState);
        template.setMegaStateFlags(megaState);

        let offs = template.allocateUniformBuffer(SkyboxProgram.ub_SceneParams, 20);
        const buf = template.mapUniformBufferF32(SkyboxProgram.ub_SceneParams);
        mat4.copy(scratchViewNoTransform, viewerInput.camera.viewMatrix);
        scratchViewNoTransform[12] = 0;
        scratchViewNoTransform[13] = 0;
        scratchViewNoTransform[14] = 0;
        mat4.mul(scratchClipFromWorldNoTransform, viewerInput.camera.projectionMatrix, scratchViewNoTransform);
        mat4.mul(scratchMat4a, scratchClipFromWorldNoTransform, noclipSpaceFromSpyroSpace);
        offs += fillMatrix4x4(buf, offs, scratchMat4a);
        offs += fillVec4(buf, offs, 0, 0, 0, 0);

        template.setVertexInput(
            this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer,  byteOffset: 0 }
            ],
            { buffer: this.indexBuffer, byteOffset: 0 }
        );
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(this.indexCount);
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}
