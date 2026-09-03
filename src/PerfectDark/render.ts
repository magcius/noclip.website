import { mat4, vec3 } from "gl-matrix";

import { DeviceProgram } from "../Program.js";
import { CameraController } from "../Camera.js";
import { calcTextureScaleForShift } from "../Common/N64/RSP.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import {
    GfxBlendFactor,
    GfxBlendMode,
    GfxBuffer,
    GfxBufferFrequencyHint,
    GfxBufferUsage,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxIndexBufferDescriptor,
    GfxInputLayout,
    GfxInputLayoutBufferDescriptor,
    GfxMegaStateDescriptor,
    GfxProgram,
    GfxSampler,
    GfxTexFilterMode,
    GfxTexture,
    GfxVertexAttributeDescriptor,
    GfxVertexBufferDescriptor,
    GfxVertexBufferFrequency,
    GfxWrapMode,
    GfxMipFilterMode,
    makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, GfxRenderInstList, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { PerfectDarkBatchFlags, PerfectDarkLevel } from "./data.js";
import { PerfectDarkTextureBank } from "./texture.js";

class PerfectDarkProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_View;
};

layout(std140) uniform ub_MaterialParams {
    vec4 u_TextureScale0;
    vec4 u_TextureScale1;
    vec4 u_MaterialMisc;
};

uniform sampler2D u_Texture0;
uniform sampler2D u_Texture1;

varying vec4 v_Color;
varying vec2 v_TexCoord0;
varying vec2 v_TexCoord1;

#ifdef VERT
layout(location = ${PerfectDarkProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${PerfectDarkProgram.a_Color}) attribute vec4 a_Color;
layout(location = ${PerfectDarkProgram.a_TexCoord}) attribute vec2 a_TexCoord;

void mainVS() {
    vec3 t_PositionView = UnpackMatrix(u_View) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);
    v_Color = a_Color;
    v_TexCoord0 = a_TexCoord * u_TextureScale0.xy + u_TextureScale0.zw;
    v_TexCoord1 = a_TexCoord * u_TextureScale1.xy + u_TextureScale1.zw;
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 t_Texture = texture(SAMPLER_2D(u_Texture0), v_TexCoord0);
    if (u_MaterialMisc.x > 0.5)
        t_Texture *= texture(SAMPLER_2D(u_Texture1), v_TexCoord1) * 2.0;
    vec4 t_Color = t_Texture * v_Color;
    if (t_Color.a < 0.03125)
        discard;
    gl_FragColor = t_Color;
}
#endif
`;
}

const bindingLayouts = [{ numUniformBuffers: 2, numSamplers: 2 }];

interface RuntimeTexture {
    texture: GfxTexture;
    width: number;
    height: number;
}

export interface PerfectDarkCameraStart {
    position: [number, number, number];
    look: [number, number, number];
    eyeHeight?: number;
}

export class PerfectDarkRenderer implements SceneGfx {
    private readonly renderHelper: GfxRenderHelper;
    private readonly renderInstListMain = new GfxRenderInstList();
    private readonly program: GfxProgram;
    private readonly inputLayout: GfxInputLayout;
    private readonly vertexBuffer: GfxBuffer;
    private readonly indexBuffer: GfxBuffer;
    private readonly vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private readonly indexBufferDescriptor: GfxIndexBufferDescriptor;
    private readonly textures = new Map<number, RuntimeTexture>();
    private readonly fallbackTexture: RuntimeTexture;
    private readonly samplers = new Map<number, GfxSampler>();

    public constructor(device: GfxDevice, private readonly level: PerfectDarkLevel, textureBank: PerfectDarkTextureBank, private readonly cameraStart: PerfectDarkCameraStart | null) {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = this.renderHelper.renderCache.createProgram(new PerfectDarkProgram());
        this.vertexBuffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, level.vertexData);
        this.indexBuffer = createBufferFromSlice(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, level.indexData);
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PerfectDarkProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0x00, format: GfxFormat.F32_RGB },
            { location: PerfectDarkProgram.a_Color, bufferIndex: 0, bufferByteOffset: 0x14, format: GfxFormat.U8_RGBA_NORM },
            { location: PerfectDarkProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 0x0c, format: GfxFormat.F32_RG },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 0x18, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.inputLayout = this.renderHelper.renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U32_R,
        });

        this.fallbackTexture = this.createTexture(device, 0xffff, 1, 1, new Uint8Array([0xff, 0xff, 0xff, 0xff]));
        const referencedTextureIds = new Set(level.batches.flatMap((batch) => [batch.textureId, batch.secondaryTextureId]).filter((id) => id !== 0xffff));
        for (const textureId of referencedTextureIds) {
            const texture = textureBank.get(textureId);
            if (texture === undefined)
                throw new Error(`Perfect Dark level references missing texture ${textureId}`);
            this.textures.set(textureId, this.createTexture(device, textureId, texture.width, texture.height, texture.pixels.createTypedArray(Uint8Array)));
        }
    }

    private createTexture(device: GfxDevice, id: number, width: number, height: number, pixels: Uint8Array): RuntimeTexture {
        const texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        device.setResourceName(texture, `Perfect Dark Texture ${id.toString(16).padStart(4, "0")}`);
        device.uploadTextureData(texture, 0, [pixels]);
        return { texture, width, height };
    }

    private getSampler(wrapS: number, wrapT: number): GfxSampler {
        const key = wrapS | (wrapT << 2);
        let sampler = this.samplers.get(key);
        if (sampler === undefined) {
            const translateWrap = (wrap: number): GfxWrapMode => {
                if (wrap === 0)
                    return GfxWrapMode.Repeat;
                if (wrap === 2)
                    return GfxWrapMode.Mirror;
                return GfxWrapMode.Clamp;
            };
            sampler = this.renderHelper.renderCache.createSampler({
                wrapS: translateWrap(wrapS),
                wrapT: translateWrap(wrapT),
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Nearest,
                minLOD: 0,
                maxLOD: 0,
            });
            this.samplers.set(key, sampler);
        }
        return sampler;
    }

    public adjustCameraController(controller: CameraController): void {
        const extent = Math.max(
            this.level.boundsMax[0] - this.level.boundsMin[0],
            this.level.boundsMax[1] - this.level.boundsMin[1],
            this.level.boundsMax[2] - this.level.boundsMin[2],
        );
        controller.setSceneMoveSpeedMult(Math.max(30, extent / 100) / 60);
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        if (this.cameraStart !== null) {
            const eye = vec3.fromValues(
                this.cameraStart.position[0],
                this.cameraStart.position[1] + (this.cameraStart.eyeHeight ?? 159),
                this.cameraStart.position[2],
            );
            const center = vec3.add(vec3.create(), eye, this.cameraStart.look);
            mat4.lookAt(dst, eye, center, [0, 1, 0]);
            mat4.invert(dst, dst);
            return;
        }

        const centerX = (this.level.boundsMin[0] + this.level.boundsMax[0]) * 0.5;
        const centerY = (this.level.boundsMin[1] + this.level.boundsMax[1]) * 0.5;
        const centerZ = (this.level.boundsMin[2] + this.level.boundsMax[2]) * 0.5;
        const radius = Math.max(
            this.level.boundsMax[0] - this.level.boundsMin[0],
            this.level.boundsMax[1] - this.level.boundsMin[1],
            this.level.boundsMax[2] - this.level.boundsMin[2],
            100,
        );

        mat4.identity(dst);
        dst[12] = centerX;
        dst[13] = centerY + radius * 0.15;
        dst[14] = centerZ + radius * 1.1;
    }

    private prepareToRender(viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstListMain);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);

        let offs = template.allocateUniformBuffer(PerfectDarkProgram.ub_SceneParams, 28);
        const mapped = template.mapUniformBufferF32(PerfectDarkProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);

        for (const batch of this.level.batches) {
            if (batch.indexCount === 0)
                continue;

            const renderInst = renderInstManager.newRenderInst();
            const translucent = (batch.flags & PerfectDarkBatchFlags.Translucent) !== 0;
            const wrapS = (batch.flags >>> 1) & 0x03;
            const wrapT = (batch.flags >>> 3) & 0x03;
            const shiftS = (batch.flags >>> 5) & 0x0f;
            const shiftT = (batch.flags >>> 9) & 0x0f;
            const runtimeTexture = this.textures.get(batch.textureId) ?? this.fallbackTexture;
            const secondaryTexture = this.textures.get(batch.secondaryTextureId) ?? this.fallbackTexture;
            const hasSecondaryTexture = batch.secondaryTextureId !== 0xffff;
            const megaStateFlags: Partial<GfxMegaStateDescriptor> = {
                cullMode: GfxCullMode.None,
                depthWrite: !translucent,
            };

            if (translucent) {
                setAttachmentStateSimple(megaStateFlags, {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                });
                renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            }

            renderInst.setMegaStateFlags(megaStateFlags);
            renderInst.setSamplerBindingsFromTextureMappings([
                { gfxTexture: runtimeTexture.texture, gfxSampler: this.getSampler(wrapS, wrapT) },
                { gfxTexture: secondaryTexture.texture, gfxSampler: this.getSampler(0, 0) },
            ]);
            let materialOffs = renderInst.allocateUniformBuffer(PerfectDarkProgram.ub_MaterialParams, 12);
            const materialMapped = renderInst.mapUniformBufferF32(PerfectDarkProgram.ub_MaterialParams);
            const textureScaleS = calcTextureScaleForShift(hasSecondaryTexture ? 0 : shiftS) / runtimeTexture.width;
            const textureScaleT = calcTextureScaleForShift(hasSecondaryTexture ? 0 : shiftT) / runtimeTexture.height;
            materialOffs += fillVec4(materialMapped, materialOffs,
                textureScaleS / 32, textureScaleT / 32,
                textureScaleS * 0.5, textureScaleT * 0.5);
            const secondaryScaleS = calcTextureScaleForShift(shiftS) / secondaryTexture.width;
            const secondaryScaleT = calcTextureScaleForShift(shiftT) / secondaryTexture.height;
            materialOffs += fillVec4(materialMapped, materialOffs,
                secondaryScaleS / 32, secondaryScaleT / 32,
                secondaryScaleS * 0.5, secondaryScaleT * 0.5);
            fillVec4(materialMapped, materialOffs, hasSecondaryTexture ? 1 : 0);
            renderInst.setDrawCount(batch.indexCount, batch.firstIndex);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const colorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const depthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const colorTargetID = builder.createRenderTargetID(colorDesc, "Main Color");
        const depthTargetID = builder.createRenderTargetID(depthDesc, "Main Depth");

        builder.pushPass((pass) => {
            pass.setDebugName("Perfect Dark");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, colorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, depthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, colorTargetID);
        builder.resolveRenderTargetToExternalTexture(colorTargetID, viewerInput.onscreenTexture);
        this.prepareToRender(viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyTexture(this.fallbackTexture.texture);
        for (const texture of this.textures.values())
            device.destroyTexture(texture.texture);
        this.renderHelper.destroy();
    }
}
