
import { mat4 } from "gl-matrix";
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { getImageFormatString } from "../BanjoKazooie/f3dex.js";
import { computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera.js";
import { TextFilt } from '../Common/N64/Image.js';
import { translateCM } from '../Common/N64/RDP.js';
import { calcTextureScaleForShift } from '../Common/N64/RSP.js';
import { AABB } from "../Geometry.js";
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { reverseDepthForDepthOffset } from '../gfx/helpers/ReversedDepthHelpers.js';
import { convertToCanvas } from '../gfx/helpers/TextureConversionHelpers.js';
import { fillMatrix4x2, fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRendererLayer, GfxRenderInstManager, makeSortKeyOpaque, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { TextureHolder, TextureMapping } from "../TextureHolder.js";
import { assert, assertExists, nArray, setBitFlagEnabled } from "../util.js";
import * as Viewer from '../viewer.js';
import { RSPOutput, Vertex } from "./f3dex2.js";
import { ModelTreeGroup, ModelTreeLeaf, ModelTreeNode, PropertyType } from "./map_shape.js";
import * as Tex from './tex.js';
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";

class PaperMario64Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec4 u_Misc0;
};

#define u_ScreenSize (u_Misc0.xy)
#define u_LodBias (u_Misc0.z)

layout(std140) uniform ub_DrawParams {
    Mat3x4 u_BoneMatrix[1];
    Mat2x4 u_TexMatrix[2];
};

uniform sampler2D u_Texture0;
uniform sampler2D u_Texture1;

varying vec4 v_Color;
varying vec4 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

void main() {
    vec3 t_PositionView = UnpackMatrix(u_BoneMatrix[0]) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);
    v_Color = a_Color;

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

    v_TexCoord.xy = UnpackMatrix(u_TexMatrix[0]) * vec4(a_TexCoord, 1.0, 1.0);
    v_TexCoord.zw = UnpackMatrix(u_TexMatrix[1]) * vec4(a_TexCoord, 1.0, 1.0);
}
#endif

#ifdef FRAG
vec4 Texture2D_N64_Point(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord, float t_LodLevel) {
    return textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord, t_LodLevel);
}

vec4 Texture2D_N64_Average(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord, float t_LodLevel) {
    // Unimplemented.
    return textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord, t_LodLevel);
}

// Implements N64-style "triangle bilinear filtering" with three taps.
// Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
vec4 Texture2D_N64_Bilerp(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord, float t_LodLevel) {
    vec2 t_Size = vec2(textureSize(PU_SAMPLER_2D(t_Texture), 0));
    vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord - t_Offs / t_Size, t_LodLevel);
    vec4 t_S1 = textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size, t_LodLevel);
    vec4 t_S2 = textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size, t_LodLevel);
    return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
}

vec4 Texture2D_N64(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord) {
    vec2 t_Dx = abs(dFdx(t_TexCoord)) * u_ScreenSize;
    float t_Lod = max(t_Dx.x, t_Dx.y);
    float t_LodTile = floor(log2(floor(t_Lod)));
    float t_LodFrac = fract(t_Lod/pow(2.0, t_LodTile));
    float t_LodLevel = (t_LodTile + t_LodFrac);
    // TODO(jstpierre): Figure out why we need this LOD bias. I don't believe the N64 even supports one...
    t_LodLevel += u_LodBias;

#if defined(USE_TEXTFILT_POINT)
    return Texture2D_N64_Point(PF_SAMPLER_2D(t_Texture), t_TexCoord, t_LodLevel);
#elif defined(USE_TEXTFILT_AVERAGE)
    return Texture2D_N64_Average(PF_SAMPLER_2D(t_Texture), t_TexCoord, t_LodLevel);
#elif defined(USE_TEXTFILT_BILERP)
    return Texture2D_N64_Bilerp(PF_SAMPLER_2D(t_Texture), t_TexCoord, t_LodLevel);
#endif
}

void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE

    vec4 t_Texel0 = Texture2D_N64(PP_SAMPLER_2D(u_Texture0), v_TexCoord.xy);

#ifdef USE_2CYCLE_MODE

    vec4 t_Texel1 = Texture2D_N64(PP_SAMPLER_2D(u_Texture1), v_TexCoord.zw);
#if defined(USE_COMBINE_MODULATE)
    t_Color = t_Texel0 * t_Texel1 * v_Color;
#elif defined(USE_COMBINE_DIFFERENCE)
    t_Color.rgb = v_Color.rgb;
    t_Color.a = (t_Texel0.a - t_Texel1.a) * v_Color.a;
#elif defined(USE_COMBINE_INTERP)
    t_Color.rgb = mix(t_Texel0.rgb, t_Texel1.rgb, v_Color.a);
    t_Color.a = t_Texel0.a;
#endif

#else /* USE_2CYCLE_MODE */
    t_Color = t_Texel0 * v_Color;
#endif /* USE_2CYCLE_MODE */

#else /* USE_TEXTURE */
    t_Color = v_Color;
#endif /* USE_TEXTURE */

#ifdef USE_ALPHA_MASK
    if (t_Color.a < 0.0125)
        discard;
#endif

    gl_FragColor = t_Color;
}
#endif
    `;
}

function makeVertexBufferData(v: Vertex[]): ArrayBufferLike {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = 0;

        buf[j++] = v[i].tx;
        buf[j++] = v[i].ty;

        buf[j++] = v[i].c0;
        buf[j++] = v[i].c1;
        buf[j++] = v[i].c2;
        buf[j++] = v[i].a;
    }
    return buf.buffer;
}

export class N64Data {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    constructor(device: GfxDevice, cache: GfxRenderCache, public rspOutput: RSPOutput) {
        const vertexBufferData = makeVertexBufferData(this.rspOutput.vertices);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexBufferData);
        assert(this.rspOutput.vertices.length <= 0xFFFF);
        const indexBufferData = new Uint16Array(this.rspOutput.indices);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PaperMario64Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04, },
            { location: PaperMario64Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: PaperMario64Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.vertexBufferDescriptors = [
            { buffer: this.vertexBuffer },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
    }
}

function textureToCanvas(texture: Tex.Image): Viewer.Texture {
    const surfaces: HTMLCanvasElement[] = [];

    for (let i = 0; i < texture.levels.length; i++) {
        const width = texture.width >>> i;
        const height = texture.height >>> i;
        const canvas = convertToCanvas(ArrayBufferSlice.fromView(texture.levels[i]), width, height);
        surfaces.push(canvas);
    }

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getImageFormatString(texture.format, texture.siz));

    return { name: texture.name, extraInfo, surfaces };
}

export class PaperMario64TextureHolder extends TextureHolder {
    public addTextureArchive(device: GfxDevice, texArc: Tex.TextureArchive): void {
        for (let i = 0; i < texArc.textureEnvironments.length; i++) {
            const env = texArc.textureEnvironments[i];
            for (let j = 0; j < env.images.length; j++)
                this.addTexture(device, env.images[j]);
        }
    }

    public addTexture(device: GfxDevice, texture: Tex.Image): void {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, texture.levels.length));
        device.setResourceName(gfxTexture, texture.name);

        device.uploadTextureData(gfxTexture, 0, texture.levels);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        this.gfxTextures.push(gfxTexture);
        this.viewerTextures.push(viewerTexture);
        this.textureNames.push(texture.name);
    }
}

class BackgroundBillboardProgram extends DeviceProgram {
    public static ub_Params = 0;

    public override both: string = `
layout(std140) uniform ub_Params {
    vec4 u_ScaleOffset;
};

uniform sampler2D u_Texture;
`;

    public override vert: string = `
out vec2 v_TexCoord;

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(${reverseDepthForDepthOffset(1)}, 1);
    v_TexCoord = p * u_ScaleOffset.xy + u_ScaleOffset.zw;

#if GFX_CLIPSPACE_NEAR_ZERO()
    gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;
#endif
}
`;

    public override frag: string = `
in vec2 v_TexCoord;

void main() {
    vec4 color = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = vec4(color.rgb, 1.0);
}
`;
}

function translateCullMode(m: number): GfxCullMode {
    const cullFront = !!(m & 0x200);
    const cullBack = !!(m & 0x400);
    if (cullFront && cullBack)
        throw "whoops";
    else if (cullFront)
        return GfxCullMode.Front;
    else if (cullBack)
        return GfxCullMode.Back;
    else
        return GfxCullMode.None;
}

const backgroundBillboardBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

export class BackgroundBillboardRenderer {
    private program = new BackgroundBillboardProgram();
    private gfxProgram: GfxProgram;
    private textureMappings = nArray(1, () => new TextureMapping());

    constructor(cache: GfxRenderCache, public textureHolder: PaperMario64TextureHolder, public textureName: string) {
        this.gfxProgram = cache.createProgram(this.program);
        // Fill texture mapping.
        this.textureHolder.fillTextureMapping(this.textureMappings[0], this.textureName);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(3);
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND, this.gfxProgram.ResourceUniqueId);
        renderInst.setVertexInput(null, null, null);
        renderInst.setBindingLayouts(backgroundBillboardBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);

        // Set our texture bindings.
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);

        const d = renderInst.allocateUniformBufferF32(BackgroundBillboardProgram.ub_Params, 4);
        let offs = 0;

        // Extract yaw
        const view = viewerInput.camera.viewMatrix;
        const o = Math.atan2(-view[2], view[0]) / (Math.PI * 2) * 4;
        const aspect = viewerInput.backbufferWidth / viewerInput.backbufferHeight;

        offs += fillVec4(d, offs, aspect, -1, o, 0);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}

enum RenderMode {
    OPA, XLU, DEC
}

const scratchMatrix = mat4.create();
const texMatrixScratch = mat4.create();
const bboxScratch = new AABB();
class ModelTreeLeafInstance {
    private n64Data: N64Data;
    private gfxSampler: GfxSampler[] = [];
    private textureEnvironment: Tex.TextureEnvironment | null = null;
    private renderModeProperty: number;
    private renderMode: RenderMode;
    private visible = true;
    private texAnimGroup: number = -1;
    private secondaryTileOffsetS: number = 0;
    private secondaryTileOffsetT: number = 0;
    private secondaryTileShiftS: number = 0;
    private secondaryTileShiftT: number = 0;
    private texAnimEnabled: boolean = false;
    private textureMapping = nArray(2, () => new TextureMapping());
    private program: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private sortKey: number;
    public modelMatrix = mat4.create();
    private flags: number = 0;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureArchive: Tex.TextureArchive, textureHolder: PaperMario64TextureHolder, private modelTreeLeaf: ModelTreeLeaf) {
        this.n64Data = new N64Data(device, cache, modelTreeLeaf.rspOutput);

        const renderModeProp = this.modelTreeLeaf.properties.find((prop) => prop.id === 0x5C);
        if (renderModeProp !== undefined && renderModeProp.type === PropertyType.INT)
            this.renderModeProperty = renderModeProp.value1;

        const texSettingsProp = this.modelTreeLeaf.properties.find((prop) => prop.id === 0x5F);
        if (texSettingsProp !== undefined && texSettingsProp.type === PropertyType.INT) {
            this.texAnimGroup = (texSettingsProp.value1 >>> 0) & 0x0F;
            this.secondaryTileShiftS = (texSettingsProp.value1 >>> 12) & 0x0F;
            this.secondaryTileShiftT = (texSettingsProp.value1 >>> 16) & 0x0F;
            this.secondaryTileOffsetS = (texSettingsProp.value0 >>> 0) & 0x0FF;
            this.secondaryTileOffsetT = (texSettingsProp.value0 >>> 12) & 0x0FF;
        }

        if (this.renderModeProperty === 0x01 || this.renderModeProperty === 0x04) {
            this.renderMode = RenderMode.OPA;
        } else if (this.renderModeProperty === 0x05 || this.renderModeProperty === 0x07 || this.renderModeProperty === 0x0D || this.renderModeProperty === 0x10) {
            this.renderMode = RenderMode.DEC;
        } else {
            this.renderMode = RenderMode.XLU;
        }

        if (this.renderMode === RenderMode.OPA || this.renderMode === RenderMode.DEC) {
            this.sortKey = makeSortKeyOpaque(GfxRendererLayer.OPAQUE, 0);
            this.megaStateFlags = {};
            if (this.renderMode === RenderMode.DEC)
                this.megaStateFlags.polygonOffset = true;
        } else if (this.renderMode === RenderMode.XLU) {
            this.sortKey = makeSortKeyOpaque(GfxRendererLayer.TRANSLUCENT, 0);
            this.megaStateFlags = {
                depthWrite: false,
            };
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
        }

        // Find the texture environment settings.
        if (this.modelTreeLeaf.texEnvName !== null) {
            this.textureEnvironment = assertExists(textureArchive.textureEnvironments.find((texEnv) => texEnv.name === this.modelTreeLeaf.texEnvName));

            for (let i = 0; i < this.textureEnvironment.images.length; i++) {
                const image = this.textureEnvironment.images[i];
                textureHolder.fillTextureMapping(this.textureMapping[i], image.name);

                this.gfxSampler[i] = cache.createSampler({
                    wrapS: translateCM(image.cms),
                    wrapT: translateCM(image.cmt),
                    minFilter: GfxTexFilterMode.Point,
                    magFilter: GfxTexFilterMode.Point,
                    mipFilter: GfxMipFilterMode.Linear,
                    minLOD: 0, maxLOD: 100,
                });

                this.textureMapping[i].gfxSampler = this.gfxSampler[i];
            }
        }

        this.createProgram();
    }

    private computeTextureMatrix(dst: mat4, texAnimGroups: TexAnimGroup[], tileId: 0 | 1): void {
        const image = this.textureEnvironment!.images[tileId];

        mat4.identity(dst);

        // tileMatrix[tileId] is specified in pixel units, so we need to convert to abstract space.
        if (this.texAnimEnabled && texAnimGroups[this.texAnimGroup] !== undefined)
            mat4.mul(dst, dst, texAnimGroups[this.texAnimGroup].tileMatrix[tileId]);

        // Apply the shift scale.
        let scaleS, scaleT, offsetS, offsetT;
        if (tileId === 0) {
            // Tile 0's shift seems to always be 0x00.
            scaleS = calcTextureScaleForShift(0x00);
            scaleT = calcTextureScaleForShift(0x00);
            offsetS = 0;
            offsetT = 0;
        } else if (tileId === 1) {
            scaleS = calcTextureScaleForShift(this.secondaryTileShiftS);
            scaleT = calcTextureScaleForShift(this.secondaryTileShiftT);
            // Offset is in 10.2 coordinates (e.g. G_SETTILESIZE).
            offsetS = this.secondaryTileOffsetS / 0x04;
            offsetT = this.secondaryTileOffsetT / 0x04;
        } else {
            throw "whoops";
        }

        dst[0] *= scaleS;
        dst[5] *= scaleT;
        dst[12] -= offsetS;
        dst[13] -= offsetT;

        dst[0] *= 1 / image.width;
        dst[5] *= 1 / image.height;
        dst[12] *= 1 / image.width;
        dst[13] *= 1 / image.height;
    }

    public setTexAnimEnabled(enabled: boolean): void {
        this.texAnimEnabled = enabled;
    }

    public setTexAnimGroup(groupId: number): void {
        this.texAnimGroup = groupId;
    }

    public findModelLeafInstance(modelId: number): ModelTreeLeafInstance | null {
        if (this.modelTreeLeaf.id === modelId)
            return this;
        return null;
    }

    public findModelNodeInstance(modelId: number): ModelTreeLeafInstance | null {
        return this.findModelLeafInstance(modelId);
    }

    public resetModelMatrix(): void {
        if (!!(this.flags & 0x01)) {
            this.flags = setBitFlagEnabled(this.flags, 0x01, false);
            mat4.identity(this.modelMatrix);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, texAnimGroups: TexAnimGroup[], parentMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        let depth = -1;
        mat4.mul(scratchMatrix, parentMatrix, this.modelMatrix);
        bboxScratch.transform(this.modelTreeLeaf.bbox, scratchMatrix);
        this.flags |= 0x01;

        if (viewerInput.camera.frustum.contains(bboxScratch))
            depth = Math.max(0, computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, bboxScratch));
        else
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const template = renderInstManager.pushTemplate();
        template.setGfxProgram(this.gfxProgram);
        template.setVertexInput(this.n64Data.inputLayout, this.n64Data.vertexBufferDescriptors, this.n64Data.indexBufferDescriptor);
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setMegaStateFlags(this.megaStateFlags);
        template.sortKey = this.sortKey;

        let offs = template.allocateUniformBuffer(PaperMario64Program.ub_DrawParams, 12 + 8*2);
        const mappedF32 = template.mapUniformBufferF32(PaperMario64Program.ub_DrawParams);

        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, scratchMatrix);
        offs += fillMatrix4x3(mappedF32, offs, scratchMatrix);

        if (this.textureEnvironment !== null) {
            this.computeTextureMatrix(texMatrixScratch, texAnimGroups, 0);
            offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

            if (this.textureEnvironment.hasSecondImage) {
                this.computeTextureMatrix(texMatrixScratch, texAnimGroups, 1);
                offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);
            }
        }

        for (let i = 0; i < this.n64Data.rspOutput.drawCalls.length; i++) {
            const drawCall = this.n64Data.rspOutput.drawCalls[i];
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setDrawCount(drawCall.indexCount, drawCall.firstIndex);
            const megaStateFlags = renderInst.getMegaStateFlags();
            megaStateFlags.cullMode = translateCullMode(drawCall.SP_GeometryMode);

            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    private createProgram(): void {
        const program = new PaperMario64Program();

        if (this.textureEnvironment !== null) {
            program.defines.set('USE_TEXTURE', '1');

            const textFilt = this.textureEnvironment.texFilter;
            if (textFilt === TextFilt.G_TF_POINT)
                program.defines.set(`USE_TEXTFILT_POINT`, '1');
            else if (textFilt === TextFilt.G_TF_AVERAGE)
                program.defines.set(`USE_TEXTFILT_AVERAGE`, '1');
            else if (textFilt === TextFilt.G_TF_BILERP)
                program.defines.set(`USE_TEXTFILT_BILERP`, '1');

            if (this.textureEnvironment.hasSecondImage) {
                program.defines.set(`USE_2CYCLE_MODE`, '1');
                const combineMode = this.textureEnvironment.combineMode;
                if (combineMode === 0x00 || combineMode === 0x08) {
                    program.defines.set(`USE_COMBINE_MODULATE`, '1');
                } else if (combineMode === 0x0D) {
                    program.defines.set(`USE_COMBINE_DIFFERENCE`, '1');
                } else if (combineMode === 0x10) {
                    program.defines.set(`USE_COMBINE_INTERP`, '1');
                }
            }
        } else {
            program.defines.set(`USE_TEXTFILT_POINT`, '1');
        }

        if (this.renderMode === RenderMode.DEC)
            program.defines.set(`USE_ALPHA_MASK`, '1');

        this.gfxProgram = null;
        this.program = program;
    }

    public destroy(device: GfxDevice): void {
        this.n64Data.destroy(device);
    }
}

class ModelTreeGroupInstance {
    public modelMatrix = mat4.create();
    private worldMatrix = mat4.create();

    constructor(private group: ModelTreeGroup, private children: ModelTreeNodeInstance[], private name = group.name) {
        mat4.copy(this.modelMatrix, this.group.modelMatrix);
    }

    public resetModelMatrix(): void {
    }

    public findModelLeafInstance(modelId: number): ModelTreeLeafInstance | null {
        for (let i = 0; i < this.children.length; i++) {
            const m = this.children[i].findModelLeafInstance(modelId);
            if (m !== null)
                return m;
        }

        return null;
    }

    public findModelNodeInstance(modelId: number): ModelTreeNodeInstance | null {
        if (this.group.id === modelId)
            return this;

        for (let i = 0; i < this.children.length; i++) {
            const m = this.children[i].findModelNodeInstance(modelId);
            if (m !== null)
                return m;
        }

        return null;
    }

    public setVisible(v: boolean): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setVisible(v);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, texAnimGroups: TexAnimGroup[], parentMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        mat4.mul(this.worldMatrix, parentMatrix, this.modelMatrix);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(device, renderInstManager, texAnimGroups, this.worldMatrix, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].destroy(device);
    }
}

type ModelTreeNodeInstance = ModelTreeGroupInstance | ModelTreeLeafInstance;

class TexAnimGroup {
    public tileMatrix = nArray(2, () => mat4.create());
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2, },
];

export class PaperMario64ModelTreeRenderer {
    private modelTreeRootInstance: ModelTreeNodeInstance;
    public modelMatrix = mat4.create();
    public texAnimGroup: TexAnimGroup[] = [];

    constructor(device: GfxDevice, private cache: GfxRenderCache, private textureArchive: Tex.TextureArchive, private textureHolder: PaperMario64TextureHolder, private modelTreeRoot: ModelTreeNode) {
        this.modelTreeRootInstance = this.translateModelTreeNode(device, modelTreeRoot);
    }

    private translateModelTreeNode(device: GfxDevice, modelTreeNode: ModelTreeNode): ModelTreeNodeInstance {
        if (modelTreeNode.type === 'group') {
            const children: ModelTreeNodeInstance[] = [];
            for (let i = 0; i < modelTreeNode.children.length; i++)
                children.push(this.translateModelTreeNode(device, modelTreeNode.children[i]));
            return new ModelTreeGroupInstance(modelTreeNode, children);
        } else if (modelTreeNode.type === 'leaf') {
            return new ModelTreeLeafInstance(device, this.cache, this.textureArchive, this.textureHolder, modelTreeNode);
        } else {
            throw "whoops";
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(bindingLayouts);
        let offs = template.allocateUniformBuffer(PaperMario64Program.ub_SceneParams, 16 + 4);
        const mappedF32 = template.mapUniformBufferF32(PaperMario64Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        // XXX(jstpierre): Empirically matched to the @SupperMarioBroth screenshot. No clue why it's necessary.
        const lodBias = -1.5;
        offs += fillVec4(mappedF32, offs, viewerInput.backbufferWidth, viewerInput.backbufferHeight, lodBias);

        this.modelTreeRootInstance.prepareToRender(device, renderInstManager, this.texAnimGroup, this.modelMatrix, viewerInput);

        renderInstManager.popTemplate();
    }

    public findModelLeafInstance(modelId: number): ModelTreeLeafInstance {
        return assertExists(this.modelTreeRootInstance.findModelLeafInstance(modelId));
    }

    public findModelInstance(modelId: number): ModelTreeNodeInstance | null {
        return this.modelTreeRootInstance.findModelNodeInstance(modelId);
    }

    public setModelTexAnimGroupEnabled(modelId: number, enabled: boolean): void {
        this.findModelLeafInstance(modelId).setTexAnimEnabled(enabled);
    }

    public setModelTexAnimGroup(modelId: number, groupId: number): void {
        if (!this.texAnimGroup[groupId])
            this.texAnimGroup[groupId] = new TexAnimGroup();

        const modelInstance = this.findModelLeafInstance(modelId);
        modelInstance.setTexAnimGroup(groupId);
        modelInstance.setTexAnimEnabled(true);
    }

    public setTexAnimGroup(groupId: number, tileId: number, transS: number, transT: number): void {
        if (!this.texAnimGroup[groupId])
            this.texAnimGroup[groupId] = new TexAnimGroup();

        const m = this.texAnimGroup[groupId].tileMatrix[tileId];
        m[12] = transS / 0x400;
        m[13] = transT / -0x400;
    }

    public destroy(device: GfxDevice): void {
        this.modelTreeRootInstance.destroy(device);
    }
}
