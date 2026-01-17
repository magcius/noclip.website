import { mat4, vec3 } from "gl-matrix";
import { defaultMegaState, makeMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode, GfxTextureUsage, GfxTextureDimension, GfxCompareMode, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { GfxBuffer, GfxInputLayout, GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { SkyboxData, LevelData } from "./bin";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";

export class LevelProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_LevelCenter;
};

uniform sampler2D u_Texture;

varying vec3 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;
layout(location = 2) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_TexCoord = a_UV;

    vec3 worldPos = a_Position - u_LevelCenter.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(worldPos, 1.0);
}
#endif

#ifdef FRAG
void main() {
    vec4 texColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);

    vec3 tex5 = floor(texColor.rgb * 31.0) / 31.0;
    vec3 col5 = floor(v_Color * 31.0) / 31.0;

    vec3 lit = tex5 * col5;

    float bayer4x4[16] = float[16](
        0.0, 8.0, 2.0, 10.0,
        12.0, 4.0, 14.0, 6.0,
        3.0, 11.0, 1.0, 9.0,
        15.0, 7.0, 13.0, 5.0
    );
    int xi = int(mod(gl_FragCoord.x, 4.0));
    int yi = int(mod(gl_FragCoord.y, 4.0));
    float threshold = (bayer4x4[yi * 4 + xi] / 16.0) * 0.03;

    vec3 dithered = lit + threshold;
    vec3 final5 = floor(dithered * 31.0) / 31.0;

    gl_FragColor = vec4(final5 * 1.6, texColor.a);
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
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

const scratchMat4a = mat4.create();
export class LevelRenderer {
    private vertexBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private indexCount: number;
    private inputLayout: GfxInputLayout;
    private texture: GfxTexture;
    private levelMin: vec3;
    private levelMax: vec3;
    private levelCenter: vec3;

    constructor(cache: GfxRenderCache, levelData: LevelData) {
        const device = cache.device;
        const atlas = levelData.atlas;
        this.texture = device.createTexture({
            width: atlas.atlasWidth,
            height: atlas.atlasHeight,
            numLevels: 1,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
            dimension: GfxTextureDimension.n2D,
            depthOrArrayLayers: 1
        });
        device.uploadTextureData(this.texture, 0, [atlas.atlasData]);

        const { vertices, colors, faces, uvs } = levelData;
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
        const expandedCol: number[] = [];
        const expandedUV: number[] = [];
        const expandedIdx: number[] = [];

        let runningIndex = 0;
        for (const face of faces) {
            const { indices, uvIndices, colorIndices } = face;
            for (let k = 0; k < indices.length; k++) {
                const vertIndex = indices[k];
                const v = vertices[vertIndex];
                expandedPos.push(v[0], v[1], v[2]);
                let c: number[];
                if (colorIndices) {
                    const colorIndex = colorIndices[k];
                    c = colors[colorIndex] ?? [255, 255, 255];
                } else {
                    c = [255, 255, 255];
                }
                expandedCol.push(c[0] / 255, c[1] / 255, c[2] / 255);
                if (uvIndices) {
                    const uvIndex = uvIndices[k];
                    const uvVal = uvs[uvIndex];
                    expandedUV.push(uvVal[0], uvVal[1]);
                } else {
                    expandedUV.push(0, 0);
                }
                expandedIdx.push(runningIndex++);
            }
        }

        const pos = new Float32Array(expandedPos);
        const col = new Float32Array(expandedCol);
        const uv  = new Float32Array(expandedUV);
        const idx = new Uint32Array(expandedIdx);

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, pos.buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, col.buffer);
        this.uvBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, uv.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, idx.buffer);
        this.indexCount = idx.length;
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },  // a_Position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },  // a_Color
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG,  bufferByteOffset: 0 },  // a_UV
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // pos
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // color
                { byteStride: 8,  frequency: GfxVertexBufferFrequency.PerVertex }, // uv
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

        let offs = template.allocateUniformBuffer(LevelProgram.ub_SceneParams, 20);
        const buf = template.mapUniformBufferF32(LevelProgram.ub_SceneParams);
        mat4.mul(scratchMat4a, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromSpyroSpace);
        offs += fillMatrix4x4(buf, offs, scratchMat4a);
        offs += fillVec4(buf, offs, this.levelCenter[0], this.levelCenter[1], this.levelCenter[2], 0);

        template.setVertexInput(
            this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer, byteOffset: 0 },
                { buffer: this.uvBuffer, byteOffset: 0 }
            ],
            { buffer: this.indexBuffer, byteOffset: 0 },
        );
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(this.indexCount);
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyTexture(this.texture);
    }
}

export class SkyboxProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPos;
};

varying vec3 v_Color;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;

void main() {
    v_Color = a_Color;
    vec3 worldPos = a_Position + u_CameraPos.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(worldPos, 1.0);
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

    constructor(cache: GfxRenderCache, sky: SkyboxData) {
        const device = cache.device;
        const { vertices, colors, faces } = sky;
        const expandedPos: number[] = [];
        const expandedCol: number[] = [];
        const expandedIdx: number[] = [];
        let runningIndex = 0;
        for (const face of faces) {
            const { indices, colorIndices } = face;
            for (let k = 0; k < 3; k++) {
                const vi = indices[k];
                const ci = colorIndices[k];
                const v = vertices[vi];
                const c = colors[ci];
                expandedPos.push(v[0], v[1], v[2]);
                expandedCol.push(c[0] / 255, c[1] / 255, c[2] / 255);
                expandedIdx.push(runningIndex++);
            }
        }
        const pos = new Float32Array(expandedPos);
        const col = new Float32Array(expandedCol);
        const idx = new Uint32Array(expandedIdx);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, pos.buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, col.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, idx.buffer);
        this.indexCount = idx.length;
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U32_R,
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
        mat4.mul(scratchMat4a, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromSpyroSpace);
        offs += fillMatrix4x4(buf, offs, scratchMat4a);
        offs += fillVec4(buf, offs,
            viewerInput.camera.worldMatrix[12],
            viewerInput.camera.worldMatrix[14],
            viewerInput.camera.worldMatrix[13],
            0
        );
        template.setVertexInput(
            this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer,  byteOffset: 0 },
            ],
            { buffer: this.indexBuffer, byteOffset: 0 },
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
