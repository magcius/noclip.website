import { mat4, vec3 } from "gl-matrix";
import { defaultMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode, GfxTextureUsage, GfxTextureDimension, GfxCompareMode, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxChannelWriteMask } from "../gfx/platform/GfxPlatform";
import { GfxBuffer, GfxInputLayout, GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { Texture, ViewerRenderInput } from "../viewer";
import { Skybox, Level, MobyInstance, TILE_SCROLL_MAP } from "./bin";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { colorNewFromRGBA, White } from "../Color";
import { DebugDrawFlags } from "../gfx/helpers/DebugDraw";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";

class LevelProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_TimeLOD; // x = time, y = LOD flag
    vec4 u_TileFlags[${MAX_TILES}]; // x = scroll
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_UV;
varying float v_TileIndex;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_UV;
layout(location = 3) in float a_TileIndex;

void main() {
    vec3 worldPos = a_Position;
    v_Color = a_Color;
    v_UV = a_UV;
    v_TileIndex = a_TileIndex;

    if (a_Color.a < 0.5) {
        float t1 = u_TimeLOD.x;
        float t2 = u_TimeLOD.x * 0.12;
        float phase = dot(worldPos.xz, vec2(0.025, 0.03));
        float wave = sin(t1 + phase) * 3.0 + sin(t2 + phase * 1.7) * 1.5;
        worldPos.z += wave * 1.1;
    }

    if (u_TimeLOD.y < 1.0) {
        v_Color.rgb *= 1.9;
    }
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(worldPos, 1.0);
}
#endif

#ifdef FRAG
float bayer4x4(int x, int y) {
    return float(int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5)[((y & 3) << 2) | (x & 3)]) / 16.0;
}

void main() {
    if (u_TimeLOD.y == 1.0) {
        gl_FragColor = v_Color;
        return;
    }

    vec2 uv = v_UV;
    int idx = int(v_TileIndex + 0.5);
    if (u_TileFlags[idx].x > 0.5) {
        uv.y = fract(uv.y - u_TimeLOD.x * 0.45);
    }
    vec4 texColor = texture(SAMPLER_2D(u_Texture), uv);

    vec3 lit;
    float outAlpha;
    bool isTransparent = v_Color.a < 0.99;
    if (isTransparent) {
        float mask = max(texColor.r, max(texColor.g, texColor.b));
        lit = v_Color.rgb;
        outAlpha = mask;
    } else {
        lit = texColor.rgb * v_Color.rgb;
        outAlpha = v_Color.a;
    }

    float threshold = bayer4x4(int(mod(gl_FragCoord.x, 4.0)), int(mod(gl_FragCoord.y, 4.0)));
    vec3 dithered = lit + threshold * (1.0 / 31.0);
    vec3 final5 = floor(dithered * 31.0) / 31.0;

    if (isTransparent) {
        final5 *= 1.4;
    }

    gl_FragColor = vec4(final5, outAlpha);
}
#endif
    `;

    constructor() {
        super();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];
const bindingLayoutsSky: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 0 }];
const spaceCorrection = mat4.fromValues(
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);
const scratchMat4a = mat4.create();
const scratchViewNoTransform = mat4.create();
const scratchClipFromWorldNoTransform = mat4.create();
const MAX_TILES = 144;

export function convertToViewerTexture(index: number, colors: Uint8Array): Texture {
    const canvas = convertToCanvas(ArrayBufferSlice.fromView(colors), 32, 32);
    const name = "tile_" + index.toString();
    canvas.title = name;
    return { name, surfaces: [canvas] };
}

export class LevelRenderer {
    public showMobys: boolean = false;
    public showLOD: boolean = false;
    public showTextures: boolean = true;
    public cullMode: GfxCullMode = GfxCullMode.None;
    private vertexBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private tileBuffer: GfxBuffer;
    private indexBufferGround: GfxBuffer;
    private indexBufferTransparent: GfxBuffer;
    private indexBufferLOD: GfxBuffer;
    private batchesGround: { tileIndex: number, indexOffset: number, indexCount: number }[] = [];
    private batchesTransparent: { tileIndex: number, indexOffset: number, indexCount: number }[] = [];
    private batchesLOD: { tileIndex: number, indexOffset: number, indexCount: number }[] = [];
    private inputLayout: GfxInputLayout;
    private textures: GfxTexture[] = [];
    private tileCount: number;
    private gameNumber: number;
    private scrollFlags: Float32Array;

    constructor(cache: GfxRenderCache, level: Level, private mobyInstances: MobyInstance[]) {
        const device = cache.device;
        this.gameNumber = level.game;
        this.tileCount = level.textures.tiles.length;
        this.textures = new Array(this.tileCount);
        for (let i = 0; i < this.tileCount; i++) {
            const rgba = level.textures.colors[i];
            const tile = level.textures.tiles[i];
            const texture = device.createTexture({
                width: tile.size, height: tile.size,
                numLevels: 1, pixelFormat: GfxFormat.U8_RGBA_NORM,
                usage: GfxTextureUsage.Sampled,
                dimension: GfxTextureDimension.n2D,
                depthOrArrayLayers: 1
            });
            device.uploadTextureData(texture, 0, [rgba]);
            this.textures[i] = texture;
        }

        this.scrollFlags = new Float32Array(this.tileCount);
        if (level.id in TILE_SCROLL_MAP[level.game]) {
            for (const ti of TILE_SCROLL_MAP[level.game][level.id]) {
                if (ti != null && ti >= 0 && ti < this.tileCount) {
                    this.scrollFlags[ti] = 1.0;
                }
            }
        }

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, level.vertices!.buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, level.colors!.buffer);
        this.uvBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, level.uvs!.buffer);
        this.tileBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, level.tileIndices!.buffer);

        this.indexBufferGround = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, level.indicesGround!.buffer);
        this.indexBufferTransparent = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, level.indicesTransparent!.buffer);
        this.indexBufferLOD = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, level.indicesLOD!.buffer);

        this.batchesGround = level.batchesGround;
        this.batchesTransparent = level.batchesTransparent;
        this.batchesLOD = level.batchesLOD;

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
                { location: 3, bufferIndex: 3, format: GfxFormat.F32_R, bufferByteOffset: 0 }
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 8,  frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 4,  frequency: GfxVertexBufferFrequency.PerVertex }
            ],
            indexBufferFormat: GfxFormat.U32_R
        });
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInstManager = renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplate();
        const program = renderHelper.renderCache.createProgram(new LevelProgram());
        template.setGfxProgram(program);
        template.setBindingLayouts(bindingLayouts);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offset = template.allocateUniformBuffer(LevelProgram.ub_SceneParams, 20 + (4 * MAX_TILES));
        const uniformBuffer = template.mapUniformBufferF32(LevelProgram.ub_SceneParams);
        mat4.mul(scratchMat4a, viewerInput.camera.clipFromWorldMatrix, spaceCorrection);
        offset += fillMatrix4x4(uniformBuffer, offset, scratchMat4a);
        // u_TimeLOD
        uniformBuffer[offset++] = viewerInput.time * 0.001 * (this.gameNumber === 1 ? 2.6 : 2);
        uniformBuffer[offset++] = (this.showLOD) || !this.showTextures ? 1.0 : 0.0;;
        uniformBuffer[offset++] = 0.0;
        uniformBuffer[offset++] = 0.0;
        // u_TileFlags
        for (let i = 0; i < MAX_TILES; i++) {
            uniformBuffer[offset++] = i < this.tileCount ? this.scrollFlags[i] : 0.0;
            uniformBuffer[offset++] = 0.0;
            uniformBuffer[offset++] = 0.0;
            uniformBuffer[offset++] = 0.0;
        }

        const gfxSampler = renderHelper.renderCache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp
        });

        const drawBatches = (batches: { tileIndex: number, indexOffset: number, indexCount: number }[], buffer: GfxBuffer, transparency: boolean) => {
            for (const batch of batches) {
                const gfxTexture = this.textures[batch.tileIndex];
                const inst = renderInstManager.newRenderInst();
                const megaState = inst.getMegaStateFlags();
                megaState.cullMode = this.cullMode;
                if (transparency) {
                    setAttachmentStateSimple(megaState, {
                        channelWriteMask: GfxChannelWriteMask.RGB,
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha
                    });
                }
                inst.setMegaStateFlags(megaState);
                inst.setSamplerBindingsFromTextureMappings([{ gfxTexture, gfxSampler, lateBinding: null }]);
                inst.setVertexInput(this.inputLayout,
                    [
                        { buffer: this.vertexBuffer, byteOffset: 0 },
                        { buffer: this.colorBuffer, byteOffset: 0 },
                        { buffer: this.uvBuffer, byteOffset: 0 },
                        { buffer: this.tileBuffer, byteOffset: 0 }
                    ], { buffer, byteOffset: 0 }
                );
                inst.setDrawCount(batch.indexCount, batch.indexOffset);
                renderInstManager.submitRenderInst(inst);
            }
        }

        if (this.showLOD) {
            drawBatches(this.batchesLOD, this.indexBufferLOD, false);
        } else {
            drawBatches(this.batchesGround, this.indexBufferGround, false);
            drawBatches(this.batchesTransparent, this.indexBufferTransparent, true);
        }

        if (this.showMobys) {
            this.drawMobys(renderHelper);
        }

        renderInstManager.popTemplate();
    }

    private drawMobys(renderHelper: GfxRenderHelper): void {
        const scale = 1.0 / 16;
        const y = colorNewFromRGBA(1, 1, 0, 1);
        for (let i = 0; i < this.mobyInstances.length; i++) {
            const m = this.mobyInstances[i];
            const spyroPos = vec3.fromValues(m.x * scale, m.y * scale, m.z * scale);
            const worldPos = vec3.create();
            vec3.transformMat4(worldPos, spyroPos, spaceCorrection);

            const r = ((m.classId * 97) & 255) / 255;
            const g = ((m.classId * 57) & 255) / 255;
            const b = ((m.classId * 17) & 255) / 255;
            const color = colorNewFromRGBA(r, g, b, 1);
            renderHelper.debugDraw.drawLocator(worldPos, 20, color, { flags: DebugDrawFlags.WorldSpace });

            const yawRad = ((m.yaw + 64) & 0xFF) / 256 * (Math.PI * 2);
            const forward = vec3.fromValues(Math.sin(yawRad), 0, Math.cos(yawRad));
            vec3.scale(forward, forward, 40);
            const arrowEnd = vec3.create();
            vec3.add(arrowEnd, worldPos, forward);
            renderHelper.debugDraw.drawLine(worldPos, arrowEnd, y, undefined, { flags: DebugDrawFlags.WorldSpace });

            const labelPos = vec3.clone(worldPos);
            const s = `${m.classId} (${i})`;
            labelPos[0] -= s.length * 7; // roughly center it
            labelPos[1] += 50;
            renderHelper.debugDraw.drawWorldTextRU(s, labelPos, White, undefined, undefined, { flags: DebugDrawFlags.WorldSpace });
        }
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.tileBuffer);
        device.destroyBuffer(this.indexBufferGround);
        device.destroyBuffer(this.indexBufferTransparent);
        device.destroyBuffer(this.indexBufferLOD);
        for (const tex of this.textures) {
            device.destroyTexture(tex);
        }
    }
}

class SkyboxProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
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
        const indices = new Uint32Array(expandedIndex);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedPos).buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedColor).buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.indexCount = indices.length;
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
        template.setMegaStateFlags(makeMegaState({ cullMode: GfxCullMode.None, depthCompare: GfxCompareMode.Always, depthWrite: false}, defaultMegaState));

        let offs = template.allocateUniformBuffer(SkyboxProgram.ub_SceneParams, 16);
        const buf = template.mapUniformBufferF32(SkyboxProgram.ub_SceneParams);
        mat4.copy(scratchViewNoTransform, viewerInput.camera.viewMatrix);
        scratchViewNoTransform[12] = 0;
        scratchViewNoTransform[13] = 0;
        scratchViewNoTransform[14] = 0;
        mat4.mul(scratchClipFromWorldNoTransform, viewerInput.camera.projectionMatrix, scratchViewNoTransform);
        mat4.mul(scratchMat4a, scratchClipFromWorldNoTransform, spaceCorrection);
        offs += fillMatrix4x4(buf, offs, scratchMat4a);

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
