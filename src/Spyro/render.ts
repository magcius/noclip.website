import { mat4, vec3 } from "gl-matrix";
import { defaultMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode, GfxTextureUsage, GfxTextureDimension, GfxCompareMode, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxChannelWriteMask } from "../gfx/platform/GfxPlatform";
import { GfxBuffer, GfxInputLayout, GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { Skybox, Level, MobyInstance, scrollingTilesMap } from "./bin";
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
    vec4 u_TimeLOD; // x = time, y = LOD flag
    vec4 u_UV[${maxTiles}]; // xy = offset, zw = scale
    vec4 u_TileFlags[${maxTiles}]; // x = scroll
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

    int idx = int(v_TileIndex + 0.5);
    vec4 tile = u_UV[idx];
    vec2 offset = tile.xy;
    vec2 scale = tile.zw;

    vec2 uv = v_UV;
    if (u_TileFlags[idx].x > 0.5) {
        float y = fract((v_UV.y - offset.y) / scale.y - u_TimeLOD.x * 0.45);
        uv.y = y * scale.y + offset.y;
    }

    vec4 texColor = texture(SAMPLER_2D(u_Texture), uv);
    bool isTransparent = v_Color.a < 0.99;
    bool isBlackPixel = texColor.r < 0.001 && texColor.g < 0.001 && texColor.b < 0.001;
    bool kill = isTransparent && isBlackPixel && u_TimeLOD.y < 1.0;
    if (kill) {
        discard;
    }

    vec3 lit;
    float outAlpha;

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
const maxTiles = 144;

export class LevelRenderer {
    private vertexBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private tileBuffer: GfxBuffer;
    private indexBufferGround: GfxBuffer;
    private indexBufferTransparent: GfxBuffer;
    private indexBufferLOD: GfxBuffer;
    private indexCountGround: number;
    private indexCountTransparent: number;
    private indexCountLOD: number;
    private inputLayout: GfxInputLayout;
    private texture: GfxTexture;
    private gameNumber: number;
    private tileParams: Float32Array;
    private scrollFlags: Float32Array;
    public showMobys: boolean;
    public showLOD: boolean;
    public showTextures: boolean = true;

    constructor(cache: GfxRenderCache, level: Level, private mobys?: MobyInstance[]) {
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

        this.gameNumber = level.game;
        const expandedVertex: number[] = [];
        const expandedColor: number[] = [];
        const expandedUV: number[] = [];
        const expandedTile: number[] = [];
        const expandedIndexGround: number[] = [];
        const expandedIndexTransparent: number[] = [];
        const expandedIndexLOD: number[] = [];

        const tileCount = atlas.uvs.length;
        this.tileParams = new Float32Array(tileCount * 4);
        this.scrollFlags = new Float32Array(tileCount);
        for (let i = 0; i < tileCount; i++) {
            const t = atlas.uvs[i];
            const base = i * 4;
            this.tileParams[base + 0] = t.u0;
            this.tileParams[base + 1] = t.v0;
            this.tileParams[base + 2] = t.uScale;
            this.tileParams[base + 3] = t.vScale;
        }
        if (level.id in scrollingTilesMap[level.game]) {
            for (const ti of scrollingTilesMap[level.game][level.id]) {
                if (ti != null && ti >= 0 && ti < tileCount) {
                    this.scrollFlags[ti] = 1.0;
                }
            }
        }

        let i = 0;
        for (const face of level.faces) {
            for (let k = 0; k < face.indices.length; k++) {
                const v = level.vertices[face.indices[k]];
                expandedVertex.push(v[0], v[1], v[2]);

                let alpha = 1.0;
                if (face.isWater) {
                    alpha = 0.4;
                } else if (face.isTransparent) {
                    alpha = 0.5;
                }
                const c = face.colors ? level.colors[face.colors[k]] : [255, 255, 255];
                expandedColor.push(c[0] / 255, c[1] / 255, c[2] / 255, alpha);

                if (face.uvs) {
                    const uvVal = level.uvs[face.uvs[k]];
                    expandedUV.push(uvVal[0], uvVal[1]);
                } else {
                    expandedUV.push(0, 0);
                }

                expandedTile.push(face.tileIndex ?? 0);

                if (face.isLOD) {
                    expandedIndexLOD.push(i);
                } else if (face.isWater || face.isTransparent) {
                    expandedIndexTransparent.push(i);
                } else {
                    expandedIndexGround.push(i);
                }
                i++;
            }
        }

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedVertex).buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedColor).buffer);
        this.uvBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedUV).buffer);
        this.tileBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(expandedTile).buffer);

        const indexGround = new Uint32Array(expandedIndexGround);
        const indexTransparent = new Uint32Array(expandedIndexTransparent);
        const indexLOD = new Uint32Array(expandedIndexLOD);
        this.indexCountGround = indexGround.length;
        this.indexCountTransparent = indexTransparent.length;
        this.indexCountLOD = indexLOD.length;
        this.indexBufferGround = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexGround.buffer);
        this.indexBufferTransparent = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexTransparent.buffer);
        this.indexBufferLOD = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexLOD.buffer);

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // a_Position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 }, // a_Color
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 }, // a_AtlasUV
                { location: 3, bufferIndex: 3, format: GfxFormat.F32_R, bufferByteOffset: 0 } // a_TileIndex
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // pos (x,y,z)
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex }, // color (r,g,b,a)
                { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex }, // uv
                { byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex } // tile index
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
        template.setSamplerBindingsFromTextureMappings([{
            gfxTexture: this.texture,
            gfxSampler: renderHelper.renderCache.createSampler({
                minFilter: GfxTexFilterMode.Point,
                magFilter: GfxTexFilterMode.Point,
                mipFilter: GfxMipFilterMode.Nearest,
                wrapS: GfxWrapMode.Repeat,
                wrapT: GfxWrapMode.Repeat
            }),
            lateBinding: null
        }]);

        // ub_SceneParams
        const sceneFloats = 16 + 4;
        const tileFloats = maxTiles * 4;
        const scrollFloats = maxTiles * 4;
        const totalFloats = sceneFloats + tileFloats + scrollFloats;
        let offset = template.allocateUniformBuffer(LevelProgram.ub_SceneParams, totalFloats);
        const sceneBuffer = template.mapUniformBufferF32(LevelProgram.ub_SceneParams);
        mat4.mul(scratchMat4a, viewerInput.camera.clipFromWorldMatrix, spaceCorrection);
        offset += fillMatrix4x4(sceneBuffer, offset, scratchMat4a); // u_ProjectionView
        // u_TimeLOD
        const lod = this.showLOD && this.indexCountLOD > 0;
        sceneBuffer[offset++] = viewerInput.time * 0.001 * (this.gameNumber === 1 ? 2.6 : 2);
        sceneBuffer[offset++] = lod || !this.showTextures ? 1.0 : 0.0;
        sceneBuffer[offset++] = 0.0;
        sceneBuffer[offset++] = 0.0;
        // u_Tile
        const tileCount = this.tileParams.length / 4;
        for (let i = 0; i < maxTiles; i++) {
            const base = i * 4;
            sceneBuffer[offset++] = i < tileCount ? this.tileParams[base + 0] : 0.0; // x = u0
            sceneBuffer[offset++] = i < tileCount ? this.tileParams[base + 1] : 0.0; // y = v0
            sceneBuffer[offset++] = i < tileCount ? this.tileParams[base + 2] : 0.0; // z = uScale
            sceneBuffer[offset++] = i < tileCount ? this.tileParams[base + 3] : 0.0; // w = vScale
        }
        // u_TileFlags
        for (let i = 0; i < maxTiles; i++) {
            sceneBuffer[offset++] = i < tileCount ? this.scrollFlags[i] : 0.0; // x = scroll
            sceneBuffer[offset++] = 0.0;
            sceneBuffer[offset++] = 0.0;
            sceneBuffer[offset++] = 0.0;
        }

        {
            const renderInst = renderInstManager.newRenderInst();
            const megaState = renderInst.getMegaStateFlags();
            megaState.cullMode = GfxCullMode.None;
            setAttachmentStateSimple(megaState, {
                channelWriteMask: GfxChannelWriteMask.RGB,
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.Zero
            });
            renderInst.setMegaStateFlags(megaState);
            renderInst.setVertexInput(this.inputLayout,
                [
                    { buffer: this.vertexBuffer, byteOffset: 0 },
                    { buffer: this.colorBuffer, byteOffset: 0 },
                    { buffer: this.uvBuffer, byteOffset: 0 },
                    { buffer: this.tileBuffer, byteOffset: 0 }
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
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha
            });
            renderInst.setMegaStateFlags(megaState);
            renderInst.setVertexInput(this.inputLayout,
                [
                    { buffer: this.vertexBuffer, byteOffset: 0 },
                    { buffer: this.colorBuffer, byteOffset: 0 },
                    { buffer: this.uvBuffer, byteOffset: 0 },
                    { buffer: this.tileBuffer, byteOffset: 0 }
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
        if (!this.mobys) {
            return;
        }
        const scale = 1.0 / 16;
        for (let i = 0; i < this.mobys.length; i++) {
            const m = this.mobys[i];
            const spyroPos = vec3.fromValues(m.x * scale, m.y * scale, m.z * scale);
            const worldPos = vec3.create();
            vec3.transformMat4(worldPos, spyroPos, spaceCorrection);

            const r = ((m.classId * 97) & 255) / 255;
            const g = ((m.classId * 57) & 255) / 255;
            const b = ((m.classId * 17) & 255) / 255;
            const color = colorNewFromRGBA(r, g, b, 1);
            renderHelper.debugDraw.drawLocator(worldPos, 50, color);

            const labelPos = vec3.clone(worldPos);
            labelPos[0] -= 75;
            labelPos[1] += 50;
            renderHelper.debugDraw.drawWorldTextRU(`i=${i}, t=${m.classId}`, labelPos, White, undefined, undefined, { flags: DebugDrawFlags.WorldSpace });
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
