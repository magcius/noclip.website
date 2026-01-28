import { mat4, vec3 } from "gl-matrix";
import { defaultMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode, GfxTextureUsage, GfxTextureDimension, GfxCompareMode, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxChannelWriteMask } from "../gfx/platform/GfxPlatform";
import { GfxBuffer, GfxInputLayout, GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { Skybox, Level, Moby } from "./bin";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { colorNewFromRGBA, White } from "../Color";
import { DebugDrawFlags } from "../gfx/helpers/DebugDraw";

class LevelProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    float u_Time;
    float u_LOD;
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

    vec3 worldPos = a_Position;
    if (a_Color.a < 0.5) {
        float waterAmp = 1.1;
        float waterSpeed1 = 1.0;
        float waterSpeed2 = 0.12;
        float phase = dot(worldPos.xz, vec2(0.025, 0.03));
        float wave = sin(u_Time * waterSpeed1 + phase) * 3.0 + sin(u_Time * waterSpeed2 + phase * 1.7) * 1.5;
        worldPos.z += wave * waterAmp;
    }

    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(worldPos, 1.0);
}
#endif

#ifdef FRAG
void main() {
    vec4 texColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    bool isTransparent = v_Color.a < 0.99;
    bool isBlackPixel = texColor.r < 0.001 && texColor.g < 0.001 && texColor.b < 0.001;
    vec3 lit;
    float outAlpha;
    float brightness = 1.7;

    if (isTransparent) {
        if (isBlackPixel && u_LOD < 1.0) {
            discard;
        }
        float mask = max(texColor.r, max(texColor.g, texColor.b));
        lit = v_Color.rgb * brightness;
        outAlpha = mask;
    } else {
        lit = texColor.rgb * v_Color.rgb * brightness;
        outAlpha = v_Color.a;
    }

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

    if (isTransparent) {
        final5 *= 1.4;
    }

    gl_FragColor = u_LOD == 1.0 ? v_Color : vec4(final5, outAlpha);
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
    private indexBufferTransparent: GfxBuffer;
    private indexBufferLOD: GfxBuffer;
    private indexCountGround: number;
    private indexCountTransparent: number;
    private indexCountLOD: number;
    private inputLayout: GfxInputLayout;
    private texture: GfxTexture;
    public showMobys: boolean;
    public showLOD: boolean;
    public showTextures: boolean = true;

    constructor(cache: GfxRenderCache, level: Level, private mobys?: Moby[]) {
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
        const expandedPos: number[] = [];
        const expandedColor: number[] = [];
        const expandedUV: number[] = [];
        const expandedIndexGround: number[] = [];
        const expandedIndexTransparent: number[] = [];
        const expandedIndexLOD: number[] = [];
        let runningIndex = 0;

        for (const face of faces) {
            const { indices, uvIndices, colorIndices, isWater, isTransparent, isLOD } = face;
            for (let k = 0; k < indices.length; k++) {
                const v = vertices[indices[k]];
                expandedPos.push(v[0], v[1], v[2]);
                const c = colorIndices ? colors[colorIndices[k]] : [255, 255, 255];
                const r = c[0] / 255;
                const g = c[1] / 255;
                const b = c[2] / 255;
                let alpha = 1.0;
                if (isWater) {
                    alpha = 0.4;
                } else if (isTransparent) {
                    alpha = 0.5;
                }
                expandedColor.push(r, g, b, alpha);
                if (uvIndices) {
                    const uvVal = uvs[uvIndices[k]];
                    expandedUV.push(uvVal[0], uvVal[1]);
                } else {
                    expandedUV.push(0, 0);
                }
                if (isLOD) {
                    expandedIndexLOD.push(runningIndex);
                } else if (isWater || isTransparent) {
                    expandedIndexTransparent.push(runningIndex);
                } else {
                    expandedIndexGround.push(runningIndex);
                }
                runningIndex++;
            }
        }

        const indexGround = new Uint32Array(expandedIndexGround);
        const indexTransparent = new Uint32Array(expandedIndexTransparent);
        const indexLOD = new Uint32Array(expandedIndexLOD);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedPos).buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedColor).buffer);
        this.uvBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedUV).buffer);
        this.indexBufferGround = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexGround.buffer);
        this.indexBufferTransparent = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexTransparent.buffer);
        this.indexBufferLOD = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexLOD.buffer);
        this.indexCountGround = indexGround.length;
        this.indexCountTransparent = indexTransparent.length;
        this.indexCountLOD = indexLOD.length;
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
        buf[offs++] = viewerInput.time * 0.001 * 2; // u_Time
        const lod = this.showLOD && this.indexCountLOD > 0
        buf[offs++] = lod || !this.showTextures ? 1.0 : 0.0;
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
                { buffer: lod ? this.indexBufferLOD : this.indexBufferGround, byteOffset: 0 }
            );
            renderInst.setDrawCount(lod ? this.indexCountLOD : this.indexCountGround);
            renderInstManager.submitRenderInst(renderInst);
        }

        if (this.indexCountTransparent > 0 && !this.showLOD) {
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
                { buffer: this.indexBufferTransparent, byteOffset: 0 }
            );
            renderInst.setDrawCount(this.indexCountTransparent);
            renderInstManager.submitRenderInst(renderInst);
        }
        if (this.showMobys && this.mobys !== undefined) {
            this.drawMobys(renderHelper);
        }

        renderInstManager.popTemplate();
    }

    private drawMobys(renderHelper: GfxRenderHelper): void {
        if (!this.mobys)
            return;
        const scale = 1.0 / 16;
        for (let i = 0; i < this.mobys.length; i++) {
            const m = this.mobys[i];
            const spyroPos = vec3.fromValues(
                m.x * scale, 
                m.y * scale, 
                m.z * scale
            );
            const worldPos = vec3.create();
            vec3.transformMat4(worldPos, spyroPos, noclipSpaceFromSpyroSpace);

            const r = ((m.classId * 97) & 0xFF) / 255;
            const g = ((m.classId * 57) & 0xFF) / 255;
            const b = ((m.classId * 17) & 0xFF) / 255;
            const color = colorNewFromRGBA(r, g, b, 1);
            renderHelper.debugDraw.drawLocator(worldPos, 50, color);

            const labelPos = vec3.clone(worldPos);
            labelPos[0] -= 75;
            labelPos[1] += 50;
            renderHelper.debugDraw.drawWorldTextRU(`i=${i}, t=${m.classId}`, labelPos, White, undefined, undefined, {flags: DebugDrawFlags.WorldSpace});
        }
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.indexBufferGround);
        device.destroyBuffer(this.indexBufferTransparent);
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
