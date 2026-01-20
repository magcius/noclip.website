
import { ReadonlyMat4, ReadonlyVec3, mat4, vec2, vec3 } from "gl-matrix";
import { Blue, Color, Green, Red } from "../../Color.js";
import { branchlessONB } from "../../DebugJunk.js";
import { MathConstants, Vec3UnitX, Vec3UnitY, Vec3UnitZ, getMatrixAxisX, getMatrixAxisY, getMatrixAxisZ, getMatrixTranslation, scaleMatrix, setMatrixAxis, setMatrixTranslation, transformVec3Mat4w1, vec3FromBasis2 } from "../../MathHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBufferUsage, GfxColor, GfxCompareMode, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxPrimitiveTopology, GfxProgram, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTextureDimension, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../platform/GfxPlatform.js";
import { align, assert, nArray } from "../platform/GfxPlatformUtil.js";
import { GfxRenderCache } from "../render/GfxRenderCache.js";
import { GfxRenderDynamicUniformBuffer } from "../render/GfxRenderDynamicUniformBuffer.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID, GfxrResolveTextureID } from "../render/GfxRenderGraph.js";
import { GfxRenderInst } from "../render/GfxRenderInstManager.js";
import { preprocessProgram_GLSL } from "../shaderc/GfxShaderCompiler.js";
import { setAttachmentStateSimple } from "./GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "./GfxShaderLibrary.js";
import { IsDepthReversed } from "./ReversedDepthHelpers.js";
import { GfxTopology, convertToTrianglesRange } from "./TopologyHelpers.js";
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec4 } from "./UniformBufferHelpers.js";
import { FontTexture, FontTextureCache } from "./FontTexture.js";

// TODO(jstpierre):
//  - Billboard text (world-space position, always faces user)
//  - Screen printing
//  - Integrate GPU debug system (requires WGSL?)
export enum DebugDrawFlags {
    WorldSpace = 0,
    ViewSpace = 1 << 0,
    ScreenSpace = 1 << 1,

    DepthTint = 1 << 2,
    Font = 1 << 3,
    AutoFlipText = 1 << 4,

    Default = DepthTint | AutoFlipText,
};

interface DebugDrawOptions {
    flags?: DebugDrawFlags;
    fontSize?: number;
    textAlign?: 'left' | 'right' | 'center';
};

function setFlags(options: DebugDrawOptions, flags: DebugDrawFlags): DebugDrawOptions {
    if (options.flags !== undefined)
        flags |= options.flags;
    else
        flags |= DebugDrawFlags.Default;
    return { ...options, flags };
}

const defaultOptions: DebugDrawOptions = { flags: DebugDrawFlags.Default };

const SpaceMask = DebugDrawFlags.WorldSpace | DebugDrawFlags.ViewSpace | DebugDrawFlags.ScreenSpace;

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 2, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat },
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float }, // Font texture
    ] },
];

const debugDrawVS = `
precision highp float;
precision highp sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_BaseData {
    Mat4x4 u_ClipFromView;
    Mat3x4 u_ViewFromWorld;
    vec4 u_Misc[1];
};

layout(location = 0) uniform sampler2D u_TextureFramebufferDepth;
layout(location = 1) uniform sampler2DArray u_TextureFont;

#define u_ScreenSize (u_Misc[0].xy)

layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;

out vec4 v_Color;
out vec3 v_TexCoord;
flat out uint v_Flags;

uint UnpackFloatExtraData(float t_Value) {
    // We do a bit of a dumb trick to pack other data into the color channels.
    // Since we want the whole [0.0f, 1.0f] range to be available for the colors, we pack flags
    // into the power of two above. e.g.
    //   0.0f - 1.99f means Flags = 0,
    //   2.0f - 3.99f means Flags = 1, etc.
    return uint(t_Value) / 2u;
}

void main() {
    vec4 t_Color = a_Color;
    uint t_Flags = UnpackFloatExtraData(t_Color.a);
    t_Color.a -= float(t_Flags) * 2.0;

    v_TexCoord = vec3(0);

    if ((t_Flags & uint(${DebugDrawFlags.Font})) != 0u) {
        uint t_CharIndex = UnpackFloatExtraData(t_Color.r);
        t_Color.r -= float(t_CharIndex) * 2.0;
        int t_QuadVertex = int(gl_VertexID & 3);
        v_TexCoord.x = (t_QuadVertex == 1 || t_QuadVertex == 2) ? 1.0 : 0.0;
        v_TexCoord.y = (t_QuadVertex == 2 || t_QuadVertex == 3) ? 1.0 : 0.0;
        v_TexCoord.z = float(t_CharIndex);
    }

    int t_Space = int(t_Flags & ${SpaceMask}u);
    if (t_Space == ${DebugDrawFlags.WorldSpace}) {
        gl_Position = UnpackMatrix(u_ClipFromView) * vec4(UnpackMatrix(u_ViewFromWorld) * vec4(a_Position.xyz, 1.0), 1.0);
    } else if (t_Space == ${DebugDrawFlags.ViewSpace}) {
        gl_Position = UnpackMatrix(u_ClipFromView) * vec4(a_Position.xyz, 1.0);
    } else if (t_Space == ${DebugDrawFlags.ScreenSpace}) {
        vec2 t_ClipPos = (a_Position.xy / u_ScreenSize.xy) * 2.0 - 1.0;
        t_ClipPos.y *= -1.0;
        v_TexCoord.y = 1.0 - v_TexCoord.y;
        gl_Position = vec4(t_ClipPos, 1.0, 1.0);
    }

    if (gl_InstanceID >= 1) {
        uint t_LineIndex = uint(gl_InstanceID - 1);
        vec2 t_PosOffs;
        t_PosOffs.x = (t_LineIndex & 1u) != 0u ? 1.0 : -1.0;
        t_PosOffs.y = (t_LineIndex & 2u) != 0u ? 1.0 : -1.0;
        t_PosOffs.xy *= float((t_LineIndex / 4u) + 1u);
        gl_Position.xy += (t_PosOffs / u_ScreenSize) * gl_Position.w;
    }

    v_Color = t_Color;
    v_Color.rgb *= v_Color.aaa;
    v_Flags = t_Flags;
}
`;

const debugDrawFS = `
precision highp float;
precision highp sampler2DArray;

in vec4 v_Color;
in vec3 v_TexCoord;
flat in uint v_Flags;

layout(location = 0) uniform sampler2D u_TextureFramebufferDepth;
layout(location = 1) uniform sampler2DArray u_TextureFont;

bool IsSomethingInFront(float t_DepthSample) {
    if (t_DepthSample ${IsDepthReversed ? `>` : `<`} gl_FragCoord.z)
        return true;

    return false;
}

void main() {
    vec4 t_Color = v_Color;

    // Work around naga bug https://github.com/gfx-rs/wgpu/issues/6596
    vec3 t_TexCoord = v_TexCoord;
    t_TexCoord.z = round(t_TexCoord.z);
    float t_Coverage = texture(SAMPLER_2DArray(u_TextureFont), t_TexCoord).r;
    if ((v_Flags & uint(${DebugDrawFlags.Font})) != 0u) {
        // Map range 0.0f - 0.5f to outline color, and 0.5f - 1.0f to fill color.
        vec4 t_OutlineColor = vec4(0, 0, 0, 1);
        if (t_Coverage >= 0.5f) {
            t_Color = mix(t_OutlineColor, t_Color, (t_Coverage - 0.5f) * 2.0f);
        } else {
            t_Color = mix(vec4(0.0f), t_OutlineColor, t_Coverage * 2.0f);
        }
        t_Color.rgb *= t_Color.a;
    }

    if ((v_Flags & uint(${DebugDrawFlags.DepthTint})) != 0u) {
        float t_DepthSample = texelFetch(TEXTURE(u_TextureFramebufferDepth), ivec2(gl_FragCoord.xy), 0).r;
        if (IsSomethingInFront(t_DepthSample))
            t_Color.rgba *= 0.15;
    }

    gl_FragColor = t_Color;
}
`;

function fillVec3p(d: Float32Array, offs: number, v: ReadonlyVec3): number {
    d[offs + 0] = v[0];
    d[offs + 1] = v[1];
    d[offs + 2] = v[2];
    return 3;
}

enum BehaviorType {
    Lines,
    LinesDepthWrite,
    LinesDepthTint,
    Solid,
    SolidDepthWrite,
    SolidDepthTint,
    Font,
    FontDepthTint,
    Count,
};

class BufferPage {
    public vertexData: Float32Array;
    public indexData: Uint16Array;
    public inputLayout: GfxInputLayout;

    public vertexDataOffs = 0;
    public vertexStride = 3+4;
    public indexDataOffs = 0;

    public renderInst = new GfxRenderInst();
    public fontTexture: FontTexture | null = null;

    constructor(cache: GfxRenderCache, public behaviorType: BehaviorType, vertexCount: number, indexCount: number, private lineThickness: number) {
        this.vertexData = new Float32Array(vertexCount * this.vertexStride);
        this.indexData = new Uint16Array(align(indexCount, 2));

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0 },
            { location: 1, format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 3*4 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: this.vertexStride*4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });
    }

    public getCurrentVertexID() { return (this.vertexDataOffs / this.vertexStride) >>> 0; }
    private remainVertex() { return this.vertexData.length - this.vertexDataOffs; }
    private remainIndex() { return this.indexData.length - this.indexDataOffs; }
    public getDrawCount() { return this.indexDataOffs; }

    public canAllocVertices(vertexCount: number, indexCount: number): boolean {
        return (vertexCount * this.vertexStride) <= this.remainVertex() && indexCount <= this.remainIndex();
    }

    public vertexPCF(v: ReadonlyVec3, c: Readonly<Color>, options: DebugDrawOptions): void {
        this.vertexDataOffs += fillVec3p(this.vertexData, this.vertexDataOffs, v);
        const flags = options.flags ?? DebugDrawFlags.Default;
        const a = c.a + (flags * 2);
        this.vertexDataOffs += fillColor(this.vertexData, this.vertexDataOffs, c, a);
    }

    public vertexFont(modelMatrix: ReadonlyMat4, cx: number, cy: number, c: Readonly<Color>, options: DebugDrawOptions, charIdx: number): void {
        vec3.set(DebugDraw.scratchVec3[0], cx, cy, 0);
        transformVec3Mat4w1(DebugDraw.scratchVec3[0], modelMatrix, DebugDraw.scratchVec3[0]);
        this.vertexDataOffs += fillVec3p(this.vertexData, this.vertexDataOffs, DebugDraw.scratchVec3[0]);
        const flags = options.flags ?? DebugDrawFlags.Default;
        const r = c.r + (charIdx * 2);
        const a = c.a + (flags * 2);
        this.vertexDataOffs += fillVec4(this.vertexData, this.vertexDataOffs, r, c.g, c.b, a);
    }

    public index(n: number): void {
        this.indexData[this.indexDataOffs++] = n;
    }

    public endFrame(cache: GfxRenderCache, templateRenderInst: GfxRenderInst): void {
        const vertexBuffer = cache.dynamicBufferCache.allocateData(GfxBufferUsage.Vertex, new Uint8Array(this.vertexData.buffer, 0, this.vertexDataOffs * 4));
        const indexBuffer = cache.dynamicBufferCache.allocateData(GfxBufferUsage.Index, new Uint8Array(this.indexData.buffer, 0, this.indexDataOffs * 2));

        this.renderInst.copyFrom(templateRenderInst);

        this.renderInst.setVertexInput(this.inputLayout, [vertexBuffer], indexBuffer);

        const isLines = this.behaviorType === BehaviorType.LinesDepthWrite || this.behaviorType === BehaviorType.LinesDepthTint;
        const isDepthWrite = this.behaviorType === BehaviorType.LinesDepthWrite || this.behaviorType === BehaviorType.SolidDepthWrite;
        const isDepthTint = this.behaviorType === BehaviorType.LinesDepthTint || this.behaviorType === BehaviorType.SolidDepthTint || this.behaviorType === BehaviorType.FontDepthTint;

        this.renderInst.setPrimitiveTopology(isLines ? GfxPrimitiveTopology.Lines : GfxPrimitiveTopology.Triangles);

        setAttachmentStateSimple(this.renderInst.getMegaStateFlags(), { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
        if (isLines)
            this.renderInst.setInstanceCount(1 + (this.lineThickness - 1) * 4);

        this.renderInst.setMegaStateFlags({ depthWrite: isDepthWrite });
        if (isDepthTint)
            this.renderInst.setMegaStateFlags({ depthCompare: GfxCompareMode.Always });

        this.renderInst.setDrawCount(this.indexDataOffs);

        this.vertexDataOffs = 0;
        this.indexDataOffs = 0;
    }
}

export class DebugDraw {
    public fontTextureCache = new FontTextureCache();
    private pages: BufferPage[] = [];
    private templateRenderInst = new GfxRenderInst();
    private defaultPageVertexCount = 1024;
    private defaultPageIndexCount = 1024;
    private debugDrawProgram: GfxProgram;
    private depthSampler: GfxSampler;
    private fontSampler: GfxSampler;
    private currentPage: BufferPage | null = null; // for the batch system
    private lineThickness = 3;
    private viewFromWorldMatrix = mat4.create();
    private screenTextPosition = vec2.create();
    private screenTextOrigin = vec2.fromValues(128, 32);

    public static scratchVec3 = nArray(4, () => vec3.create());
    public static scratchMat4 = mat4.create();

    constructor(private renderCache: GfxRenderCache, uniformBuffer: GfxRenderDynamicUniformBuffer) {
        const device = renderCache.device;
        this.debugDrawProgram = renderCache.createProgramSimple(preprocessProgram_GLSL(device.queryVendorInfo(), debugDrawVS, debugDrawFS));

        this.depthSampler = renderCache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.fontSampler = renderCache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            wrapQ: GfxWrapMode.Clamp,
        });

        this.templateRenderInst.setUniformBuffer(uniformBuffer);
        this.templateRenderInst.setGfxProgram(this.debugDrawProgram);
        this.templateRenderInst.setBindingLayouts(bindingLayouts);
    }

    private getBehaviorType(isLines: boolean, isOpaque: boolean, options: DebugDrawOptions) {
        const isDepthTint = (options.flags ?? DebugDrawFlags.Default) & DebugDrawFlags.DepthTint;
        if (isLines)
            return isDepthTint ? BehaviorType.LinesDepthTint : isOpaque ? BehaviorType.LinesDepthWrite : BehaviorType.Lines;
        else
            return isDepthTint ? BehaviorType.SolidDepthTint : isOpaque ? BehaviorType.SolidDepthWrite : BehaviorType.Lines;
    }

    public beginFrame(clipFromViewMatrix: ReadonlyMat4, viewFromWorldMatrix: ReadonlyMat4, width: number, height: number): void {
        let offs = this.templateRenderInst.allocateUniformBuffer(0, 16 + 12 + 4);
        const d = this.templateRenderInst.mapUniformBufferF32(0);
        mat4.copy(this.viewFromWorldMatrix, viewFromWorldMatrix);
        offs += fillMatrix4x4(d, offs, clipFromViewMatrix);
        offs += fillMatrix4x3(d, offs, viewFromWorldMatrix);
        offs += fillVec4(d, offs, width, height);
    }

    private beginBatch(behaviorType: BehaviorType, vertexCount: number, indexCount: number): void {
        assert(this.currentPage === null);
        this.currentPage = this.findPage(behaviorType, vertexCount, indexCount);
    }

    public beginBatchLine(numSegments: number, opaque: boolean = true, options: DebugDrawOptions = defaultOptions): void {
        const behaviorType = this.getBehaviorType(true, opaque, options);
        this.beginBatch(behaviorType, numSegments * 2, numSegments * 2);
    }

    public endBatch(): void {
        assert(this.currentPage !== null);
        this.currentPage = null;
    }

    private findPage(behaviorType: BehaviorType, vertexCount: number, indexCount: number, fontTexture: FontTexture | null = null): BufferPage {
        if (this.currentPage !== null) {
            assert(this.currentPage.behaviorType === behaviorType);
            assert(this.currentPage.canAllocVertices(vertexCount, indexCount));
            return this.currentPage;
        }

        for (let i = 0; i < this.pages.length; i++) {
            const page = this.pages[i];
            if (!page.canAllocVertices(vertexCount, indexCount))
                continue;

            if (page.indexDataOffs === 0) {
                page.behaviorType = behaviorType;
                page.fontTexture = fontTexture;
                return page;
            }

            if (page.behaviorType === behaviorType && page.fontTexture === fontTexture)
                return page;
        }

        vertexCount = align(vertexCount, this.defaultPageVertexCount);
        indexCount = align(indexCount, this.defaultPageIndexCount);
        const page = new BufferPage(this.renderCache, behaviorType, vertexCount, indexCount, this.lineThickness);
        page.fontTexture = fontTexture;
        this.pages.push(page);
        return page;
    }

    public drawLine(p0: ReadonlyVec3, p1: ReadonlyVec3, color0: Readonly<Color>, color1 = color0, options: DebugDrawOptions = defaultOptions): void {
        const page = this.findPage(this.getBehaviorType(true, color0.a >= 1.0 && color1.a >= 1.0, options), 2, 2);

        const baseVertex = page.getCurrentVertexID();
        page.vertexPCF(p0, color0, options);
        page.vertexPCF(p1, color1, options);

        for (let i = 0; i < 2; i++)
            page.index(baseVertex + i);
    }

    public drawVector(p0: ReadonlyVec3, dir: ReadonlyVec3, mag: number, color0: Readonly<Color>, color1 = color0, options: DebugDrawOptions = defaultOptions): void {
        vec3.scaleAndAdd(DebugDraw.scratchVec3[0], p0, dir, mag);
        this.drawLine(p0, DebugDraw.scratchVec3[0], color0, color1, options);
    }

    public drawBasis(m: ReadonlyMat4, mag = 100, options: DebugDrawOptions = defaultOptions): void {
        const page = this.findPage(this.getBehaviorType(true, true, options), 6, 6);

        const baseVertex = page.getCurrentVertexID();
        getMatrixTranslation(DebugDraw.scratchVec3[0], m);

        // X
        getMatrixAxisX(DebugDraw.scratchVec3[1], m);
        vec3.scaleAndAdd(DebugDraw.scratchVec3[1], DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], mag);
        page.vertexPCF(DebugDraw.scratchVec3[0], Red, options);
        page.vertexPCF(DebugDraw.scratchVec3[1], Red, options);

        // Y
        getMatrixAxisY(DebugDraw.scratchVec3[1], m);
        vec3.scaleAndAdd(DebugDraw.scratchVec3[1], DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], mag);
        page.vertexPCF(DebugDraw.scratchVec3[0], Green, options);
        page.vertexPCF(DebugDraw.scratchVec3[1], Green, options);

        // Z
        getMatrixAxisZ(DebugDraw.scratchVec3[1], m);
        vec3.scaleAndAdd(DebugDraw.scratchVec3[1], DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], mag);
        page.vertexPCF(DebugDraw.scratchVec3[0], Blue, options);
        page.vertexPCF(DebugDraw.scratchVec3[1], Blue, options);

        for (let i = 0; i < 6; i++)
            page.index(baseVertex + i);
    }

    public drawLocator(center: ReadonlyVec3, mag: number, color: GfxColor, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        const page = this.findPage(this.getBehaviorType(true, color.a >= 1.0, options), 6, 6);

        const baseVertex = page.getCurrentVertexID();
        for (let i = 0; i < 3; i++) {
            vec3.copy(DebugDraw.scratchVec3[0], center);
            vec3.copy(DebugDraw.scratchVec3[1], center);
            DebugDraw.scratchVec3[0][i] -= mag;
            DebugDraw.scratchVec3[1][i] += mag;

            page.vertexPCF(DebugDraw.scratchVec3[0], color, options);
            page.vertexPCF(DebugDraw.scratchVec3[1], color, options);
        }

        for (let i = 0; i < 6; i++)
            page.index(baseVertex + i);
    }

    public drawDiscLineN(center: ReadonlyVec3, n: ReadonlyVec3, r: number, color: Readonly<Color>, sides = 32, options: DebugDrawOptions = defaultOptions): void {
        branchlessONB(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], n);
        this.drawDiscLineRU(center, DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], r, color, sides, options);
    }

    public drawDiscLineRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, r: number, color: Readonly<Color>, sides = 32, options: DebugDrawOptions = defaultOptions): void {
        const page = this.findPage(this.getBehaviorType(true, color.a >= 1.0, options), sides, sides * 2);

        const baseVertex = page.getCurrentVertexID();
        const s = DebugDraw.scratchVec3[2];
        for (let i = 0; i < sides; i++) {
            const theta = i / sides * MathConstants.TAU;
            const sin = Math.sin(theta) * r, cos = Math.cos(theta) * r;
            s[0] = center[0] + right[0] * cos + up[0] * sin;
            s[1] = center[1] + right[1] * cos + up[1] * sin;
            s[2] = center[2] + right[2] * cos + up[2] * sin;
            page.vertexPCF(s, color, options);

            page.index(baseVertex + i);
            page.index(baseVertex + ((i === sides - 1) ? 0 : i + 1));
        }
    }

    public drawSphereLine(center: ReadonlyVec3, r: number, color: Readonly<Color>, sides = 32, options: DebugDrawOptions = defaultOptions) {
        this.drawDiscLineRU(center, Vec3UnitX, Vec3UnitY, r, color, sides, options);
        this.drawDiscLineRU(center, Vec3UnitX, Vec3UnitZ, r, color, sides, options);
        this.drawDiscLineRU(center, Vec3UnitY, Vec3UnitZ, r, color, sides, options);
    }

    public drawDiscSolidN(center: ReadonlyVec3, n: ReadonlyVec3, r: number, color: Readonly<Color>, sides = 32, options: DebugDrawOptions = defaultOptions): void {
        branchlessONB(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], n);
        this.drawDiscSolidRU(center, DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], r, color, sides, options);
    }

    public drawDiscSolidRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, r: number, color: Readonly<Color>, sides = 32, options: DebugDrawOptions = defaultOptions): void {
        const page = this.findPage(this.getBehaviorType(false, color.a >= 1.0, options), sides + 1, sides * 3);

        const baseVertex = page.getCurrentVertexID();
        page.vertexPCF(center, color, options);
        const s = DebugDraw.scratchVec3[2];
        for (let i = 0; i < sides - 1; i++) {
            const theta = i / sides * MathConstants.TAU;
            const sin = Math.sin(theta) * r, cos = Math.cos(theta) * r;
            s[0] = center[0] + right[0] * cos + up[0] * sin;
            s[1] = center[1] + right[1] * cos + up[1] * sin;
            s[2] = center[2] + right[2] * cos + up[2] * sin;
            page.vertexPCF(s, color, options);
        }

        // construct trifans by hand
        for (let i = 0; i < sides - 2; i++) {
            page.index(baseVertex);
            page.index(baseVertex + 1 + i);
            page.index(baseVertex + 2 + i);
        }

        page.index(baseVertex);
        page.index(baseVertex + sides - 1);
        page.index(baseVertex + 1);
    }

    private rectCorner(dst: vec3[], center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, rightMag: number, upMag: number): void {
        // TL, TR, BL, BR
        for (let i = 0; i < 4; i++) {
            const signX = i & 1 ? -1 : 1;
            const signY = i & 2 ? -1 : 1;
            const s = dst[i];
            vec3FromBasis2(s, center, right, signX * rightMag, up, signY * upMag);
        }
    }

    public drawTriSolidP(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        const page = this.findPage(this.getBehaviorType(false, color.a >= 1.0, options), 3, 3);

        const baseVertex = page.getCurrentVertexID();
        page.vertexPCF(p0, color, options);
        page.vertexPCF(p1, color, options);
        page.vertexPCF(p2, color, options);

        for (let i = 0; i < 3; i++)
            page.index(baseVertex + i);
    }

    public drawRectLineP(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3, p3: ReadonlyVec3, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        const page = this.findPage(this.getBehaviorType(true, color.a >= 1.0, options), 4, 8);

        const baseVertex = page.getCurrentVertexID();
        page.vertexPCF(p0, color, options);
        page.vertexPCF(p1, color, options);
        page.vertexPCF(p3, color, options);
        page.vertexPCF(p2, color, options);

        for (let i = 0; i < 4; i++) {
            page.index(baseVertex + i);
            page.index(baseVertex + ((i + 1) & 3));
        }
    }

    public drawRectLineRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, rightMag: number, upMag: number, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        this.rectCorner(DebugDraw.scratchVec3, center, right, up, rightMag, upMag);
        this.drawRectLineP(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], DebugDraw.scratchVec3[2], DebugDraw.scratchVec3[3], color, options);
    }

    public drawRectSolidP(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3, p3: ReadonlyVec3, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        const page = this.findPage(this.getBehaviorType(false, color.a >= 1.0, options), 4, 6);

        const baseVertex = page.getCurrentVertexID();
        page.vertexPCF(p0, color, options);
        page.vertexPCF(p1, color, options);
        page.vertexPCF(p3, color, options);
        page.vertexPCF(p2, color, options);

        page.indexDataOffs += convertToTrianglesRange(page.indexData, page.indexDataOffs, GfxTopology.Quads, baseVertex, 4);
    }

    public drawRectSolidRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, rightMag: number, upMag: number, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        this.rectCorner(DebugDraw.scratchVec3, center, right, up, rightMag, upMag);
        this.drawRectSolidP(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], DebugDraw.scratchVec3[2], DebugDraw.scratchVec3[3], color, options);
    }

    private getFontTexture(options: DebugDrawOptions): [FontTexture, number] {
        const device = this.renderCache.device;
        const fontSize = options.fontSize ?? 32;
        const fontTexture = this.fontTextureCache.getFont(device, fontSize);
        const fontScale = fontTexture.getFontScale(fontSize);
        return [fontTexture, fontScale];
    }

    public drawTextMtx(modelMatrix: ReadonlyMat4, str: string, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        const [fontTexture, fontScale] = this.getFontTexture(options);

        const iterString = (cb: (charIdx: number, x: number, y: number, advanceX: number) => void) => {
            let x = 0, y = 0;
            for (let i = 0; i < str.length; i++) {
                const c = str.charAt(i);
                let charIdx = fontTexture.getCharacterIndex(c);
                if (charIdx < 0)
                    continue;

                const advanceX = fontTexture.getCharacterAdvanceX(charIdx) * fontScale;
                cb(charIdx, x, y, advanceX);
                x += advanceX;
            }
        };

        // Calculate the width of the string.
        let strWidth = 0;
        let charCount = 0;
        iterString((charIdx, cx, cy, advanceX) => {
            strWidth = Math.max(strWidth, cx + advanceX);
            charCount++;
        });

        const behaviorType = ((options.flags ?? DebugDrawFlags.Default) & DebugDrawFlags.DepthTint) ? BehaviorType.FontDepthTint : BehaviorType.Font;
        const page = this.findPage(behaviorType, charCount * 4, charCount * 6);
        page.fontTexture = fontTexture;

        // Center align
        let baseX = 0;
        if (options.textAlign === 'center')
            baseX = -strWidth / 2;
        else if (options.textAlign === 'right')
            baseX = -strWidth;

        const baseVertex = page.getCurrentVertexID();
        options = setFlags(options, DebugDrawFlags.Font);

        let sy = 100;
        iterString((charIdx, cx, cy, advanceX) => {
            // TL, TR, BL, BR
            cx += baseX;

            const x0 = cx, x1 = cx + fontTexture.cellWidth * fontScale;
            const y0 = cy + fontTexture.cellHeight * fontScale, y1 = cy;

            page.vertexFont(modelMatrix, x0, y0, color, options, charIdx);
            page.vertexFont(modelMatrix, x1, y0, color, options, charIdx);
            page.vertexFont(modelMatrix, x1, y1, color, options, charIdx);
            page.vertexFont(modelMatrix, x0, y1, color, options, charIdx);
        });

        page.indexDataOffs += convertToTrianglesRange(page.indexData, page.indexDataOffs, GfxTopology.Quads, baseVertex, charCount * 4);
    }

    public drawScreenText(str: string, x: number, y: number, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        const mtx = DebugDraw.scratchMat4;
        mat4.identity(mtx);
        mtx[12] = x;
        mtx[13] = y;
        options = setFlags(options, DebugDrawFlags.ScreenSpace);
        this.drawTextMtx(mtx, str, color, options);
    }

    public screenPrintText(str: string, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        str.split('\n').forEach((line) => {
            const x = this.screenTextOrigin[0] + this.screenTextPosition[0];
            const y = this.screenTextOrigin[1] + this.screenTextPosition[1];

            this.drawScreenText(line, x, y, color, options);

            const [fontTexture, fontScale] = this.getFontTexture(options);
            this.screenTextPosition[1] += fontScale * fontTexture.cellHeight;
        });
    }

    public drawWorldTextMtx(str: string, mtx: mat4, color: Readonly<Color>, options: DebugDrawOptions = defaultOptions): void {
        options = setFlags(options, DebugDrawFlags.WorldSpace);
        const flags = options.flags!;
        const space = flags & SpaceMask;
        if (!!(flags & DebugDrawFlags.AutoFlipText) && space === DebugDrawFlags.WorldSpace) {
            const a = this.viewFromWorldMatrix;
            const m10 = a[8] * mtx[2] + a[9] * mtx[6] + a[10] * mtx[10];
            if (m10 < 0.0) {
                // Reverse the front/right axes, but keep up the same.
                mtx[0] *= -1;
                mtx[1] *= -1;
                mtx[2] *= -1;

                mtx[8] *= -1;
                mtx[9] *= -1;
                mtx[10] *= -1;
            }
        }
        this.drawTextMtx(mtx, str, color, options);
    }

    public drawWorldTextRU(str: string, p: ReadonlyVec3, color: Readonly<Color>, right: ReadonlyVec3 = Vec3UnitX, up: ReadonlyVec3 = Vec3UnitY, options: DebugDrawOptions = defaultOptions): void {
        const mtx = DebugDraw.scratchMat4;
        vec3.cross(DebugDraw.scratchVec3[0], up, right);
        setMatrixAxis(mtx, right, up, DebugDraw.scratchVec3[0]);
        setMatrixTranslation(mtx, p);
        this.drawWorldTextMtx(str, mtx, color, options);
    }

    private endFrame(): number {
        vec2.zero(this.screenTextPosition);

        let behaviorTypesMask = 0;
        for (let i = 0; i < this.pages.length; i++) {
            const page = this.pages[i];
            page.endFrame(this.renderCache, this.templateRenderInst);
            behaviorTypesMask |= 1 << page.behaviorType;
        }
        return behaviorTypesMask;
    }

    public pushPasses(builder: GfxrGraphBuilder, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID): void {
        const behaviorTypes = this.endFrame();
        if (behaviorTypes === 0)
            return;

        builder.pushPass((pass) => {
            pass.setDebugName(`DebugDraw`);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            // TODO: When using WebGPU, can we use RODS here instead of resolving? (if the sample count matches...)
            let depthResolveTextureID: GfxrResolveTextureID | null = null;
            const isDepthTint = behaviorTypes & ((1 << BehaviorType.LinesDepthTint) | (1 << BehaviorType.SolidDepthTint) | (1 << BehaviorType.FontDepthTint));
            if (isDepthTint) {
                depthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
                pass.attachResolveTexture(depthResolveTextureID);
            }

            pass.exec((passRenderer, scope) => {
                for (let i = 0; i < this.pages.length; i++) {
                    const page = this.pages[i];
                    if (page.renderInst.getDrawCount() <= 0)
                        continue;

                    const depthTexture = depthResolveTextureID !== null ? scope.getResolveTextureForID(depthResolveTextureID) : null;
                    const fontTexture = page.fontTexture !== null ? page.fontTexture.gfxTexture : null;
                    page.renderInst.setSamplerBindings(0, [
                        { gfxTexture: depthTexture, gfxSampler: this.depthSampler, lateBinding: null },
                        { gfxTexture: fontTexture, gfxSampler: this.fontSampler, lateBinding: null },
                    ]);
                    page.renderInst.drawOnPass(this.renderCache, passRenderer);
                }
            });
        });
    }

    public destroy(): void {
        this.fontTextureCache.destroy(this.renderCache.device);
    }
}
