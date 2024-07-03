
import { ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID } from "../render/GfxRenderGraph.js";
import { GfxRenderInst } from "../render/GfxRenderInstManager.js";
import { GfxRenderDynamicUniformBuffer } from "../render/GfxRenderDynamicUniformBuffer.js";
import { fillColor, fillMatrix4x3, fillMatrix4x4 } from "./UniformBufferHelpers.js";
import { Color } from "../../Color.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxPrimitiveTopology, GfxProgram, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency } from "../platform/GfxPlatform.js";
import { align, nArray } from "../../util.js";
import { GfxRenderCache } from "../render/GfxRenderCache.js";
import { preprocessProgram_GLSL } from "../shaderc/GfxShaderCompiler.js";
import { GfxTopology, convertToTrianglesRange } from "./TopologyHelpers.js";
import { setAttachmentStateSimple } from "./GfxMegaStateDescriptorHelpers.js";
import { branchlessONB } from "../../DebugJunk.js";
import { MathConstants } from "../../MathHelpers.js";

// TODO(jstpierre):
//  - Don't split pages based on behavior
//  - Instantiate in GfxRenderHelper, like we do for thumbnails/text?
//  - Integrate text renderer?
//  - More primitive types
//  - Support view-space and screen-space primitives
//  - Line width emulation?
//  - Depth fade?
//  - Drop indexless draws, both for code simplification, and to merge draws

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 0 },
];

const debugDrawVS = `
layout(std140) uniform ub_BaseData {
    Mat4x4 u_ClipFromView;
    Mat4x3 u_ViewFromWorld;
};

in vec3 a_Position;
in vec4 a_Color;

out vec4 v_Color;

void main() {
    gl_Position = Mul(u_ClipFromView, Mul(_Mat4x4(u_ViewFromWorld), vec4(a_Position.xyz, 1.0)));
    v_Color = a_Color;
    v_Color.rgb *= v_Color.aaa;
}
`;

const debugDrawFS = `
in vec4 v_Color;

void main() {
    gl_FragColor = v_Color;
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
    Opaque,
    Transparent,
}

class BufferPage {
    public vertexData: Float32Array;
    public indexData: Uint16Array | null = null;
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer | null = null;
    public inputLayout: GfxInputLayout;

    public vertexBufferOffs = 0;
    public vertexStride = 3+4;
    public indexBufferOffs = 0;

    public lifetime = 3;

    public renderInst = new GfxRenderInst();

    constructor(cache: GfxRenderCache, public behaviorType: BehaviorType, vertexCount: number, indexCount: number) {
        const device = cache.device;

        this.vertexData = new Float32Array(vertexCount * this.vertexStride);
        this.vertexBuffer = device.createBuffer(this.vertexData.length, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);

        if (indexCount > 0) {
            this.indexData = new Uint16Array(align(indexCount, 2));
            this.indexBuffer = device.createBuffer(this.indexData.length >>> 1, GfxBufferUsage.Index, GfxBufferFrequencyHint.Dynamic);
        }

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0 },
            { location: 1, format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 3*4 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: this.vertexStride*4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: indexCount > 0 ? GfxFormat.U16_R : null,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });
    }

    public getCurrentVertexID() { return (this.vertexBufferOffs / this.vertexStride) >>> 0; }
    private remainVertex() { return this.vertexData.length - this.vertexBufferOffs; }
    private remainIndex() { return this.indexData!.length - this.indexBufferOffs; }

    public canAllocVertices(vertexCount: number, indexCount: number | null): boolean {
        if ((vertexCount * this.vertexStride) > this.remainVertex())
            return false;
        if (indexCount !== null)
            return this.indexData !== null && indexCount <= this.remainIndex();
        else
            return this.indexData === null;
    }

    public endFrame(device: GfxDevice, templateRenderInst: GfxRenderInst): boolean {
        if (this.vertexBufferOffs === 0) {
            if (--this.lifetime === 0) {
                this.destroy(device);
                return false;
            } else {
                return true;
            }
        }

        device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexData.buffer), 0, this.vertexBufferOffs * 4);
        if (this.indexData !== null)
            device.uploadBufferData(this.indexBuffer!, 0, new Uint8Array(this.indexData.buffer), 0, this.indexBufferOffs * 2);

        this.renderInst.copyFrom(templateRenderInst);

        this.renderInst.setPrimitiveTopology(this.behaviorType === BehaviorType.Lines ? GfxPrimitiveTopology.Lines : GfxPrimitiveTopology.Triangles);
        this.renderInst.setVertexInput(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0 },
        ], this.indexBuffer !== null ? { buffer: this.indexBuffer, byteOffset: 0 } : null);

        setAttachmentStateSimple(this.renderInst.getMegaStateFlags(), { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
        if (this.behaviorType === BehaviorType.Transparent)
            this.renderInst.setMegaStateFlags({ depthWrite: false });

        const drawCount = this.indexBuffer !== null ? this.indexBufferOffs : this.getCurrentVertexID();
        this.renderInst.setDrawCount(drawCount);

        this.vertexBufferOffs = 0;
        this.indexBufferOffs = 0;
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

    public static scratchVec3 = nArray(4, () => vec3.create());

    constructor(private cache: GfxRenderCache) {
        const device = cache.device;
        this.debugDrawProgram = cache.createProgramSimple(preprocessProgram_GLSL(device.queryVendorInfo(), debugDrawVS, debugDrawFS));

        this.templateRenderInst.setGfxProgram(this.debugDrawProgram);
        this.templateRenderInst.setBindingLayouts(bindingLayouts);
    }

    public beginFrame(uniformBuffer: GfxRenderDynamicUniformBuffer, clipFromViewMatrix: ReadonlyMat4, viewFromWorldMatrix: ReadonlyMat4): void {
        this.templateRenderInst.setUniformBuffer(uniformBuffer);
        let offs = this.templateRenderInst.allocateUniformBuffer(0, 16 + 12);
        const d = uniformBuffer.mapBufferF32();
        offs += fillMatrix4x4(d, offs, clipFromViewMatrix);
        offs += fillMatrix4x3(d, offs, viewFromWorldMatrix);
    }

    private findPage(behaviorType: BehaviorType, vertexCount: number, indexCount: number | null = null): BufferPage {
        for (let i = 0; i < this.pages.length; i++)
            if (this.pages[i].behaviorType === behaviorType && this.pages[i].canAllocVertices(vertexCount, indexCount))
                return this.pages[i];

        vertexCount = align(vertexCount, this.defaultPageVertexCount);
        indexCount = indexCount !== null ? align(indexCount, this.defaultPageIndexCount) : 0;
        const page = new BufferPage(this.cache, behaviorType, vertexCount, indexCount);
        this.pages.push(page);
        return page;
    }

    public drawWorldLine(p0: ReadonlyVec3, p1: ReadonlyVec3, color0: Color, color1 = color0): void {
        const page = this.findPage(BehaviorType.Lines, 2);

        page.vertexBufferOffs += fillVec3p(page.vertexData, page.vertexBufferOffs, p0);
        page.vertexBufferOffs += fillColor(page.vertexData, page.vertexBufferOffs, color0);
        page.vertexBufferOffs += fillVec3p(page.vertexData, page.vertexBufferOffs, p1);
        page.vertexBufferOffs += fillColor(page.vertexData, page.vertexBufferOffs, color1);
    }

    public drawWorldDiscSolidN(center: ReadonlyVec3, n: ReadonlyVec3, r: number, color: Color, sides = 32): void {
        branchlessONB(DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], n);
        this.drawWorldDiscSolidRU(center, DebugDraw.scratchVec3[0], DebugDraw.scratchVec3[1], r, color, sides);
    }

    public drawWorldDiscSolidRU(center: ReadonlyVec3, right: ReadonlyVec3, up: ReadonlyVec3, r: number, color: Color, sides = 32): void {
        const behaviorType = color.a < 1.0 ? BehaviorType.Transparent : BehaviorType.Opaque;
        const page = this.findPage(behaviorType, sides + 1, sides * 3);

        const baseVertex = page.getCurrentVertexID();
        page.vertexBufferOffs += fillVec3p(page.vertexData, page.vertexBufferOffs, center);
        page.vertexBufferOffs += fillColor(page.vertexData, page.vertexBufferOffs, color);
        const s = DebugDraw.scratchVec3[2];
        for (let i = 0; i < sides - 1; i++) {
            const theta = i / sides * MathConstants.TAU;
            const sin = Math.sin(theta) * r, cos = Math.cos(theta) * r;
            s[0] = center[0] + right[0] * cos + up[0] * sin;
            s[1] = center[1] + right[1] * cos + up[1] * sin;
            s[2] = center[2] + right[2] * cos + up[2] * sin;
            page.vertexBufferOffs += fillVec3p(page.vertexData, page.vertexBufferOffs, s);
            page.vertexBufferOffs += fillColor(page.vertexData, page.vertexBufferOffs, color);
        }

        // construct trifans by hand
        for (let i = 0; i < sides - 2; i++) {
            page.indexData![page.indexBufferOffs++] = baseVertex;
            page.indexData![page.indexBufferOffs++] = baseVertex + 1 + i;
            page.indexData![page.indexBufferOffs++] = baseVertex + 2 + i;
        }

        page.indexData![page.indexBufferOffs++] = baseVertex;
        page.indexData![page.indexBufferOffs++] = baseVertex + sides - 1;
        page.indexData![page.indexBufferOffs++] = baseVertex + 1;
    }

    public drawWorldRectSolid(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3, p3: ReadonlyVec3, color: Color): void {
        const behaviorType = color.a < 1.0 ? BehaviorType.Transparent : BehaviorType.Opaque;
        const page = this.findPage(behaviorType, 4, 6);

        const baseVertex = page.getCurrentVertexID();

        page.vertexBufferOffs += fillVec3p(page.vertexData, page.vertexBufferOffs, p0);
        page.vertexBufferOffs += fillColor(page.vertexData, page.vertexBufferOffs, color);
        page.vertexBufferOffs += fillVec3p(page.vertexData, page.vertexBufferOffs, p1);
        page.vertexBufferOffs += fillColor(page.vertexData, page.vertexBufferOffs, color);
        page.vertexBufferOffs += fillVec3p(page.vertexData, page.vertexBufferOffs, p2);
        page.vertexBufferOffs += fillColor(page.vertexData, page.vertexBufferOffs, color);
        page.vertexBufferOffs += fillVec3p(page.vertexData, page.vertexBufferOffs, p3);
        page.vertexBufferOffs += fillColor(page.vertexData, page.vertexBufferOffs, color);

        page.indexBufferOffs += convertToTrianglesRange(page.indexData!, page.indexBufferOffs, GfxTopology.Quads, baseVertex, 4);
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

            pass.exec((passRenderer) => {
                for (let i = 0; i < this.pages.length; i++)
                    if (this.pages[i].renderInst.getDrawCount() > 0)
                        this.pages[i].renderInst.drawOnPass(this.cache, passRenderer);
            });
        });
    }

    public destroy(): void {
        const device = this.cache.device;
        for (let i = 0; i < this.pages.length; i++)
            this.pages[i].destroy(device);
    }
}
