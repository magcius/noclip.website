
import { ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID } from "../render/GfxRenderGraph.js";
import { GfxRenderInst } from "../render/GfxRenderInstManager.js";
import { GfxRenderDynamicUniformBuffer } from "../render/GfxRenderDynamicUniformBuffer.js";
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec4 } from "./UniformBufferHelpers.js";
import { Blue, Color, Green, Red } from "../../Color.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxPrimitiveTopology, GfxProgram, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTextureDimension, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../platform/GfxPlatform.js";
import { align, nArray } from "../../util.js";
import { GfxRenderCache } from "../render/GfxRenderCache.js";
import { preprocessProgram_GLSL } from "../shaderc/GfxShaderCompiler.js";
import { GfxTopology, convertToTrianglesRange } from "./TopologyHelpers.js";
import { setAttachmentStateSimple } from "./GfxMegaStateDescriptorHelpers.js";
import { branchlessONB } from "../../DebugJunk.js";
import { MathConstants, Vec3UnitX, Vec3UnitY, Vec3UnitZ, getMatrixAxisX, getMatrixAxisY, getMatrixAxisZ, getMatrixTranslation } from "../../MathHelpers.js";
import { IsDepthReversed } from "./ReversedDepthHelpers.js";
import { assert } from "../platform/GfxPlatformUtil.js";

// TODO(jstpierre):
//  - Integrate text renderer?
//  - More primitive types
//  - Support view-space and screen-space primitives

interface DebugDrawOptions {
    flags?: DebugDrawFlags;
};

export const enum DebugDrawFlags {
    WorldSpace = 0,
    ViewSpace = 1 << 0,
    ScreenSpace = 1 << 1,

    DepthTint = 1 << 3,

    Default = DepthTint,
};

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 1, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Depth },
    ] },
];

const debugDrawVS = `
layout(std140) uniform ub_BaseData {
    Mat4x4 u_ClipFromView;
    Mat4x3 u_ViewFromWorld;
    vec4 u_Misc[1];
};

layout(location = 0) uniform sampler2D u_TextureFramebufferDepth;

#define u_ScreenSize (u_Misc[0].xy)

layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;

out vec4 v_Color;
flat out uint v_Flags;

void main() {
    uint t_Flags = uint(a_Color.a);
    gl_Position = Mul(u_ClipFromView, Mul(_Mat4x4(u_ViewFromWorld), vec4(a_Position.xyz, 1.0)));

    if (gl_InstanceID >= 1) {
        uint t_LineIndex = uint(gl_InstanceID - 1);
        vec2 t_PosOffs;
        t_PosOffs.x = (t_LineIndex & 1u) != 0u ? 1.0f : -1.0f;
        t_PosOffs.y = (t_LineIndex & 2u) != 0u ? 1.0f : -1.0f;
        t_PosOffs.xy *= float((t_LineIndex / 4u) + 1u);
        gl_Position.xy += (t_PosOffs / u_ScreenSize) * gl_Position.w;
    }

    v_Color = a_Color;
    v_Color.a = 1.0 - fract(a_Color.a);
    v_Color.rgb *= v_Color.aaa;
    v_Flags = t_Flags;
}
`;

const debugDrawFS = `
in vec4 v_Color;
flat in uint v_Flags;

layout(location = 0) uniform sampler2D u_TextureFramebufferDepth;

bool IsSomethingInFront(float t_DepthSample) {
    if (t_DepthSample ${IsDepthReversed ? `>` : `<`} gl_FragCoord.z)
        return true;

    return false;
}

void main() {
    vec4 t_Color = v_Color;

    if ((v_Flags & uint(${DebugDrawFlags.DepthTint})) != 0u) {
        float t_DepthSample = texelFetch(SAMPLER_2D(u_TextureFramebufferDepth), ivec2(gl_FragCoord.xy), 0).r;
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

const enum BehaviorType {
    Lines,
    Opaque,
    Transparent,
};

class BufferPage {
    public vertexData: Float32Array;
    public indexData: Uint16Array;
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;

    public vertexDataOffs = 0;
    public vertexStride = 3+4;
    public indexDataOffs = 0;

    public lifetime = 3;

    public renderInst = new GfxRenderInst();

    constructor(cache: GfxRenderCache, public behaviorType: BehaviorType, vertexCount: number, indexCount: number, private lineThickness: number) {
        const device = cache.device;

        this.vertexData = new Float32Array(vertexCount * this.vertexStride);
        this.vertexBuffer = device.createBuffer(this.vertexData.length, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);

        this.indexData = new Uint16Array(align(indexCount, 2));
        this.indexBuffer = device.createBuffer(this.indexData.length >>> 1, GfxBufferUsage.Index, GfxBufferFrequencyHint.Dynamic);

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

    public canAllocVertices(vertexCount: number, indexCount: number): boolean {
        return (vertexCount * this.vertexStride) <= this.remainVertex() && indexCount <= this.remainIndex();
    }

    public vertexPCF(v: ReadonlyVec3, c: Color, options: DebugDrawOptions): void {
        this.vertexDataOffs += fillVec3p(this.vertexData, this.vertexDataOffs, v);
        let flags = options.flags ?? DebugDrawFlags.Default;
        // encode flags in alpha
        const alpha = (1.0 - c.a) + flags;
        this.vertexDataOffs += fillColor(this.vertexData, this.vertexDataOffs, c, alpha);
    }

    public index(n: number): void {
        this.indexData[this.indexDataOffs++] = n;
    }

    public endFrame(device: GfxDevice, templateRenderInst: GfxRenderInst): boolean {
        if (this.vertexDataOffs === 0) {
            if (--this.lifetime === 0) {
                this.destroy(device);
                return false;
            } else {
                return true;
            }
        }

        device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexData.buffer), 0, this.vertexDataOffs * 4);
        device.uploadBufferData(this.indexBuffer, 0, new Uint8Array(this.indexData.buffer), 0, this.indexDataOffs * 2);

        this.renderInst.copyFrom(templateRenderInst);

        this.renderInst.setPrimitiveTopology(this.behaviorType === BehaviorType.Lines ? GfxPrimitiveTopology.Lines : GfxPrimitiveTopology.Triangles);
        this.renderInst.setVertexInput(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0 },
        ], { buffer: this.indexBuffer, byteOffset: 0 });

        setAttachmentStateSimple(this.renderInst.getMegaStateFlags(), { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
        if (this.behaviorType === BehaviorType.Lines) {
            this.renderInst.setMegaStateFlags({ depthCompare: GfxCompareMode.Always, depthWrite: false });
            this.renderInst.setInstanceCount(1 + (this.lineThickness - 1) * 4);
        } else if (this.behaviorType === BehaviorType.Transparent) {
            this.renderInst.setMegaStateFlags({ depthWrite: false });
        }

        this.renderInst.setDrawCount(this.indexDataOffs);

        this.vertexDataOffs = 0;
        this.indexDataOffs = 0;
        this.lifetime = 3;
        return true;
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        if (this.indexBuffer !== null)
            device.destroyBuffer(this.indexBuffer);
    }
}

export class DebugDraw {
    private pages: BufferPage[] = [];
    private templateRenderInst = new GfxRenderInst();
    private defaultPageVertexCount = 1024;
    private defaultPageIndexCount = 1024;
    private debugDrawProgram: GfxProgram;
    private depthSampler: GfxSampler;
    private currentPage: BufferPage | null = null; // for the batch system
    private lineThickness = 3;

    public static scratchVec3 = nArray(4, () => vec3.create());

    constructor(private cache: GfxRenderCache, uniformBuffer: GfxRenderDynamicUniformBuffer) {
        const device = cache.device;
        this.debugDrawProgram = cache.createProgramSimple(preprocessProgram_GLSL(device.queryVendorInfo(), debugDrawVS, debugDrawFS));

        this.depthSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.templateRenderInst.setUniformBuffer(uniformBuffer);
        this.templateRenderInst.setGfxProgram(this.debugDrawProgram);
        this.templateRenderInst.setBindingLayouts(bindingLayouts);
    }

    public beginFrame(clipFromViewMatrix: ReadonlyMat4, viewFromWorldMatrix: ReadonlyMat4, width: number, height: number): void {
        let offs = this.templateRenderInst.allocateUniformBuffer(0, 16 + 12 + 4);
        const d = this.templateRenderInst.mapUniformBufferF32(0);
        offs += fillMatrix4x4(d, offs, clipFromViewMatrix);
        offs += fillMatrix4x3(d, offs, viewFromWorldMatrix);
        offs += fillVec4(d, offs, width, height);
    }

    private beginBatch(behaviorType: BehaviorType, vertexCount: number, indexCount: number): void {
        assert(this.currentPage === null);
        this.currentPage = this.findPage(behaviorType, vertexCount, indexCount);
    }

    public beginBatchLine(numSegments: number): void {
        this.beginBatch(BehaviorType.Lines, numSegments * 2, numSegments * 2);
    }

    public endBatch(): void {
        assert(this.currentPage !== null);
        this.currentPage = null;
    }

    private findPage(behaviorType: BehaviorType, vertexCount: number, indexCount: number): BufferPage {
        if (this.currentPage !== null) {
            assert(this.currentPage.behaviorType === behaviorType);
            assert(this.currentPage.canAllocVertices(vertexCount, indexCount));
            return this.currentPage;
        }

        for (let i = 0; i < this.pages.length; i++) {
            const page = this.pages[i];
            if (page.behaviorType === behaviorType && page.canAllocVertices(vertexCount, indexCount))
                return page;
        }

        vertexCount = align(vertexCount, this.defaultPageVertexCount);
        indexCount = align(indexCount, this.defaultPageIndexCount);
        const page = new BufferPage(this.cache, behaviorType, vertexCount, indexCount, this.lineThickness);
        this.pages.push(page);
        return page;
    }

    public drawLine(p0: ReadonlyVec3, p1: ReadonlyVec3, color0: Color, color1 = color0, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        const page = this.findPage(BehaviorType.Lines, 2, 2);

        const baseVertex = page.getCurrentVertexID();
        page.vertexPCF(p0, color0, options);
        page.vertexPCF(p1, color1, options);

        for (let i = 0; i < 2; i++)
            page.index(baseVertex + i);
    }

    public drawVector(p0: ReadonlyVec3, dir: ReadonlyVec3, mag: number, color0: Color, color1 = color0, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        vec3.scaleAndAdd(DebugDraw.scratchVec3[0], p0, dir, mag);
        this.drawLine(p0, DebugDraw.scratchVec3[0], color0, color1, options);
    }

    public drawBasis(m: ReadonlyMat4, mag = 100, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        const page = this.findPage(BehaviorType.Lines, 6, 6);

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

    public drawDiscLineN(center: ReadonlyVec3, n: ReadonlyVec3, r: number, color: Color, sides = 32, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        branchlessONB(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], n);
        this.drawDiscSolidRU(center, DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], r, color, sides, options);
    }

    public drawDiscLineRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, r: number, color: Color, sides = 32, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        const page = this.findPage(BehaviorType.Lines, sides, sides * 2);

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

    public drawSphereLine(center: ReadonlyVec3, r: number, color: Color, sides = 32, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }) {
        this.drawDiscLineRU(center, Vec3UnitX, Vec3UnitY, r, color, sides, options);
        this.drawDiscLineRU(center, Vec3UnitX, Vec3UnitZ, r, color, sides, options);
        this.drawDiscLineRU(center, Vec3UnitY, Vec3UnitZ, r, color, sides, options);
    }

    public drawDiscSolidN(center: ReadonlyVec3, n: ReadonlyVec3, r: number, color: Color, sides = 32, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        branchlessONB(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], n);
        this.drawDiscSolidRU(center, DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], r, color, sides, options);
    }

    public drawDiscSolidRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, r: number, color: Color, sides = 32, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        const behaviorType = color.a < 1.0 ? BehaviorType.Transparent : BehaviorType.Opaque;
        const page = this.findPage(behaviorType, sides + 1, sides * 3);

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
            vec3.scaleAndAdd(s, center, right, signX * rightMag);
            vec3.scaleAndAdd(s, s, up, signY * upMag);
        }
    }

    public drawTriSolidP(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3, color: Color, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        const behaviorType = color.a < 1.0 ? BehaviorType.Transparent : BehaviorType.Opaque;
        const page = this.findPage(behaviorType, 3, 3);

        const baseVertex = page.getCurrentVertexID();
        page.vertexPCF(p0, color, options);
        page.vertexPCF(p1, color, options);
        page.vertexPCF(p2, color, options);

        for (let i = 0; i < 3; i++)
            page.index(baseVertex + i);
    }

    public drawRectLineP(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3, p3: ReadonlyVec3, color: Color, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        const page = this.findPage(BehaviorType.Lines, 4, 8);

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

    public drawRectLineRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, rightMag: number, upMag: number, color: Color, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        this.rectCorner(DebugDraw.scratchVec3, center, right, up, rightMag, upMag);
        this.drawRectLineP(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], DebugDraw.scratchVec3[2], DebugDraw.scratchVec3[3], color, options);
    }

    public drawRectSolidP(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3, p3: ReadonlyVec3, color: Color, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        const behaviorType = color.a < 1.0 ? BehaviorType.Transparent : BehaviorType.Opaque;
        const page = this.findPage(behaviorType, 4, 6);

        const baseVertex = page.getCurrentVertexID();
        page.vertexPCF(p0, color, options);
        page.vertexPCF(p1, color, options);
        page.vertexPCF(p3, color, options);
        page.vertexPCF(p2, color, options);

        page.indexDataOffs += convertToTrianglesRange(page.indexData, page.indexDataOffs, GfxTopology.Quads, baseVertex, 4);
    }

    public drawRectSolidRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, rightMag: number, upMag: number, color: Color, options: DebugDrawOptions = { flags: DebugDrawFlags.Default }): void {
        this.rectCorner(DebugDraw.scratchVec3, center, right, up, rightMag, upMag);
        this.drawRectSolidP(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], DebugDraw.scratchVec3[2], DebugDraw.scratchVec3[3], color, options);
    }

    private endFrame(): boolean {
        const device = this.cache.device;
        let hasAnyDraws = false;
        for (let i = 0; i < this.pages.length; i++) {
            const page = this.pages[i];
            if (!page.endFrame(device, this.templateRenderInst))
                this.pages.splice(i--, 1);
            hasAnyDraws = true;
        }
        return hasAnyDraws;
    }

    public pushPasses(builder: GfxrGraphBuilder, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID): void {
        const hasAnyDraws = this.endFrame();
        if (!hasAnyDraws)
            return;

        builder.pushPass((pass) => {
            pass.setDebugName(`DebugDraw`);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            // TODO(jstpierre): Only bother making the depth resolve texture if we have something using depth-tint (should depth-tint be the default?)
            // Also, when using WebGPU, can we use RODS here instead of resolving? (might require some finagling on sample count...)
            const depthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
            pass.attachResolveTexture(depthResolveTextureID);

            pass.exec((passRenderer, scope) => {
                for (let i = 0; i < this.pages.length; i++) {
                    const page = this.pages[i];
                    if (page.renderInst.getDrawCount() > 0) {
                        page.renderInst.setSamplerBindings(0, [{ gfxTexture: scope.getResolveTextureForID(depthResolveTextureID), gfxSampler: this.depthSampler, lateBinding: null }]);
                        page.renderInst.drawOnPass(this.cache, passRenderer);
                    }
                }
            });
        });
    }

    public destroy(): void {
        const device = this.cache.device;
        for (let i = 0; i < this.pages.length; i++)
            this.pages[i].destroy(device);
    }
}
