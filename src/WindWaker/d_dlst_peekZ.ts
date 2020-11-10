
import { GfxDevice, GfxFormat, GfxRenderPass, GfxSamplerBinding, GfxPrimitiveTopology, GfxLoadDisposition, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxReadback, GfxAttachment, GfxBindings, GfxRenderPipeline, GfxProgram, GfxSampler } from "../gfx/platform/GfxPlatformImpl";
import { ColorTexture, makeEmptyRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { preprocessProgram_GLSL } from "../gfx/shaderc/GfxShaderCompiler";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { assertExists } from "../util";

class ColorTextureAttachment {
    public colorTexture: ColorTexture;
    public gfxAttachment: GfxAttachment | null = null;

    constructor(format: GfxFormat = GfxFormat.U8_RGBA_NORM) {
        this.colorTexture = new ColorTexture(format);
    }

    public setParameters(device: GfxDevice, width: number, height: number): boolean {
        if (this.colorTexture.setParameters(device, width, height)) {
            this.destroyAttachment(device);
            this.gfxAttachment = device.createAttachmentFromTexture(this.colorTexture.gfxTexture!);
            return true;
        } else {
            return false;
        }
    }

    private destroyAttachment(device: GfxDevice): void {
        if (this.gfxAttachment !== null) {
            device.destroyAttachment(this.gfxAttachment);
            this.gfxAttachment = null;
        }
    }

    public destroy(device: GfxDevice): void {
        this.colorTexture.destroy(device);
        this.destroyAttachment(device);
    }
}

export class PeekZResult {
    public normalizedX: number;
    public normalizedY: number;
    public attachmentX: number;
    public attachmentY: number;
    public triviallyCulled: boolean = false;
    public value: number | null = null;
}

class PeekZFrame {
    public entries: PeekZResult[] = [];
    public readback: GfxReadback;

    constructor(device: GfxDevice, maxCount: number) {
        const byteCount = maxCount;
        this.readback = device.createReadback(byteCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroyReadback(this.readback);
    }
}

export class PeekZManager {
    private framePool: PeekZFrame[] = [];

    private submittedFrames: PeekZFrame[] = [];
    private maxSubmittedFrames: number = 10;
    private currentFrame: PeekZFrame | null = null;
    private resultBuffer: Uint32Array;

    private resolveRenderPassDescriptor = makeEmptyRenderPassDescriptor();
    private colorAttachment = new ColorTextureAttachment(GfxFormat.U32_R);
    private depthTexture = new ColorTexture(GfxFormat.D32F_S8);
    private depthSampler: GfxSampler | null = null;
    private fullscreenCopyBindings: GfxBindings | null = null;
    private fullscreenCopyPipeline: GfxRenderPipeline | null = null;
    private fullscreenCopyProgram: GfxProgram | null = null;

    constructor(public maxCount: number = 50) {
        this.resultBuffer = new Uint32Array(this.maxCount);

        this.resolveRenderPassDescriptor.depthLoadDisposition = GfxLoadDisposition.LOAD;
        this.resolveRenderPassDescriptor.stencilLoadDisposition = GfxLoadDisposition.LOAD;
    }

    private returnFrame(frame: PeekZFrame): void {
        frame.entries.length = 0;
        this.framePool.push(frame);
    }

    public newData(dst: PeekZResult, x: number, y: number): boolean {
        const frame = assertExists(this.currentFrame);

        // Check for trivial result.
        if (x < -1 || x > 1 || y < -1 || y > 1) {
            dst.triviallyCulled = true;
            return true;
        }

        dst.triviallyCulled = false;

        if (frame.entries.length >= this.maxCount)
            return false;

        dst.normalizedX = x;
        dst.normalizedY = y;
        frame.entries.push(dst);
        return true;
    }

    public setParameters(device: GfxDevice, width: number, height: number): void {
        this.colorAttachment.setParameters(device, width, height)

        if (this.depthTexture.setParameters(device, width, height)) {
            if (this.depthSampler === null) {
                // According to the GLES spec, depth textures *must* be filtered as NEAREST.
                // https://github.com/google/angle/blob/49a53d684affafc0bbaa2d4c2414113fe95329ce/src/libANGLE/Texture.cpp#L362-L383
                this.depthSampler = device.createSampler({
                    minFilter: GfxTexFilterMode.POINT,
                    magFilter: GfxTexFilterMode.POINT,
                    mipFilter: GfxMipFilterMode.NO_MIP,
                    wrapS: GfxWrapMode.CLAMP,
                    wrapT: GfxWrapMode.CLAMP,
                    minLOD: 0,
                    maxLOD: 100,
                });
            }

            const samplerBindings: GfxSamplerBinding[] = [{ gfxTexture: this.depthTexture.gfxTexture, gfxSampler: this.depthSampler, lateBinding: null }];
            this.fullscreenCopyBindings = device.createBindings({ bindingLayout: { numSamplers: 1, numUniformBuffers: 0 }, samplerBindings, uniformBufferBindings: [], });
        }

        if (this.currentFrame === null) {
            if (this.framePool.length > 0)
                this.currentFrame = this.framePool.pop()!;
            else
                this.currentFrame = new PeekZFrame(device, this.maxCount);
        }
    }

    public submitFrame(device: GfxDevice, depthStencilAttachment: GfxAttachment): void {
        if (this.currentFrame === null)
            return;

        // Kick off pipeline compilation ASAP.
        if (this.fullscreenCopyPipeline === null) {
            const fullscreenVS: string = `
out vec2 v_TexCoord;

void main() {
    v_TexCoord.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    v_TexCoord.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = v_TexCoord * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1, 1);
}
`;
            const fullscreenFS: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

out uint o_Output;

void main() {
    vec4 color = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    o_Output = uint(color.r * 4294967295.0);
}
`;
            const fullscreenProgramDescriptor = preprocessProgram_GLSL(device.queryVendorInfo(), fullscreenVS, fullscreenFS);
            this.fullscreenCopyProgram = device.createProgramSimple(fullscreenProgramDescriptor);
            this.fullscreenCopyPipeline = device.createRenderPipeline({
                bindingLayouts: [{ numSamplers: 1, numUniformBuffers: 0 }],
                inputLayout: null,
                megaStateDescriptor: fullscreenMegaState,
                program: this.fullscreenCopyProgram,
                sampleCount: 1,
                topology: GfxPrimitiveTopology.TRIANGLES,
            });
        }

        const frame = this.currentFrame;
        this.currentFrame = null;

        if (!device.queryPipelineReady(this.fullscreenCopyPipeline)) {
            // Pipeline not ready yet.
            return this.returnFrame(frame);
        }

        if (this.submittedFrames.length >= this.maxSubmittedFrames) {
            // Too many frames in flight, discard this one.
            return this.returnFrame(frame);
        }

        if (frame.entries.length === 0) {
            // No need to copy if we aren't trying to read.
            return this.returnFrame(frame);
        }

        // Quick note on strategy: GLES has a restriction on glReadPixels for GL_DEPTH_COMPONENT,
        // even when the framebuffer isn't multi-sampled. In order to go from an MSAA depth buffer
        // to something we can glReadPixels, we first have to resolve the MSAA depth buffer to a
        // single-sampled depth texture using glBlitFramebuffer. GLES spec says this resolve is
        // implementation-defined, ANGLE seems to just use a custom shader which pulls out the
        // first sample, which is good enough for our purposes.
        //
        // Unfortunately, for reasons currently unknown, this causes two full-screen passes in ANGLE,
        // rather than just one. Not great, but nothing we can really do about that right now.
        //
        // We still can't read this texture though, so we have to convert it to a color buffer
        // using a shader pass we write ourselves, and then we can finally submit a glReadPixels PBO.
        //
        // So, this is three full-screen passes for what should have been at most one. GLES...
        // isn't... good... !!

        let renderPass: GfxRenderPass;

        // Resolve MSAA depth buffer to single-sampled depth texture.
        this.resolveRenderPassDescriptor.colorAttachment = null;
        this.resolveRenderPassDescriptor.colorResolveTo = null;
        this.resolveRenderPassDescriptor.depthStencilAttachment = depthStencilAttachment;
        this.resolveRenderPassDescriptor.depthStencilResolveTo = this.depthTexture.gfxTexture;
        renderPass = device.createRenderPass(this.resolveRenderPassDescriptor);
        device.submitPass(renderPass);

        // Resolve depth texture to color texture.
        this.resolveRenderPassDescriptor.colorAttachment = this.colorAttachment.gfxAttachment!;
        this.resolveRenderPassDescriptor.colorResolveTo = null;
        this.resolveRenderPassDescriptor.depthStencilAttachment = null;
        this.resolveRenderPassDescriptor.depthStencilResolveTo = null;
        renderPass = device.createRenderPass(this.resolveRenderPassDescriptor);
        renderPass.setPipeline(this.fullscreenCopyPipeline!);
        renderPass.setBindings(0, this.fullscreenCopyBindings!, []);
        renderPass.setInputState(null);
        renderPass.draw(3, 0);
        device.submitPass(renderPass);

        // Now go through and start submitting readbacks on our texture.
        for (let i = 0; i < frame.entries.length; i++) {
            const entry = frame.entries[i];

            // User specifies coordinates in -1 to 1 normalized space. Convert to attachment space.
            entry.attachmentX = (((entry.normalizedX * 0.5) + 0.5) * this.colorAttachment.colorTexture.width + 0.5) | 0;
            entry.attachmentY = (((entry.normalizedY * 0.5) + 0.5) * this.colorAttachment.colorTexture.height + 0.5) | 0;

            device.readPixelFromTexture(frame.readback, i, this.colorAttachment.colorTexture.gfxTexture!, entry.attachmentX, entry.attachmentY);
        }

        device.submitReadback(frame.readback);
        this.submittedFrames.push(frame);
    }

    public peekData(device: GfxDevice): void {
        // Resolve the first frame we can.

        for (let i = 0; i < this.submittedFrames.length; i++) {
            const frame = this.submittedFrames[i];
            if (device.queryReadbackFinished(this.resultBuffer, 0, frame.readback)) {
                this.submittedFrames.splice(i, 1);
                // Copy results to clients.
                for (let j = 0; j < frame.entries.length; j++)
                    frame.entries[j].value = this.resultBuffer[j] / 0xFFFFFFFF;
                this.returnFrame(frame);
                break;
            }
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.currentFrame !== null)
            this.currentFrame.destroy(device);
        for (let i = 0; i < this.submittedFrames.length; i++)
            this.submittedFrames[i].destroy(device);
        for (let i = 0; i < this.framePool.length; i++)
            this.framePool[i].destroy(device);
        if (this.fullscreenCopyBindings !== null)
            device.destroyBindings(this.fullscreenCopyBindings);
        if (this.fullscreenCopyProgram !== null)
            device.destroyProgram(this.fullscreenCopyProgram);
        if (this.fullscreenCopyPipeline !== null)
            device.destroyRenderPipeline(this.fullscreenCopyPipeline);
        if (this.depthSampler !== null)
            device.destroySampler(this.depthSampler);
        this.depthTexture.destroy(device);
        this.colorAttachment.destroy(device);
    }
}
