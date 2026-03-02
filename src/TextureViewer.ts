
import { fullscreenMegaState } from "./gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "./gfx/helpers/GfxShaderLibrary";
import { GfxDevice, GfxFormat, GfxPrimitiveTopology, GfxProgram, GfxSamplerFormatKind, GfxSwapChain, GfxTexture, GfxTextureDimension } from "./gfx/platform/GfxPlatform";
import { preprocessShader_GLSL } from "./gfx/shaderc/GfxShaderCompiler";
import { assert } from "./util";

function textureProgram2D(mipLevel: number, height: number): string {
    return `
uniform sampler2D u_Texture;

void main() {
    ivec2 t_FragCoord = ivec2(gl_FragCoord.xy);
#if !GFX_VIEWPORT_ORIGIN_TL()
    t_FragCoord.y = ${height >>> mipLevel} - t_FragCoord.y;
#endif
    gl_FragColor = texelFetch(TEXTURE(u_Texture), t_FragCoord.xy, ${mipLevel});
}`;
}

function textureCopyProgram(device: GfxDevice, texture: GfxTexture, mipLevel: number, zSlice: number): GfxProgram {
    const vert = preprocessShader_GLSL(device.queryVendorInfo(), "vert", GfxShaderLibrary.fullscreenVS);
    let frag: string;
    if (texture.dimension === GfxTextureDimension.n2D) {
        frag = preprocessShader_GLSL(device.queryVendorInfo(), "frag", textureProgram2D(mipLevel, texture.height));
    } else {
        assert(false); // TODO(jstpierre): Other texture types.
    }

    return device.createProgram({ preprocessedVert: vert, preprocessedFrag: frag });
}

export class TextureCanvas {
    public canvas: HTMLCanvasElement;

    constructor(private swapChain: GfxSwapChain, private texture: GfxTexture, private mipLevel: number = 0, private zSlice: number = 0) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = texture.width >>> mipLevel;
        this.canvas.height = texture.height >>> mipLevel;

        this.render();
    }

    public render(): void {
        const device = this.swapChain.getDevice();
        const srcCanvas = this.swapChain.getCanvas();

        // This is a bit ugly. In WebGL2, we can't share resources between canvases, so the only way to pull the texture out
        // is to just literally resize the texture, draw it, and then copy that over to a new canvas.
        const oldWidth = srcCanvas.width;
        const oldHeight = srcCanvas.height;

        srcCanvas.width = this.canvas.width;
        srcCanvas.height = this.canvas.height;
        this.swapChain.configureSwapChain(this.canvas.width, this.canvas.height);

        device.beginFrame();

        // Now draw the image.
        const renderTarget = device.createRenderTargetFromTexture(this.swapChain.getOnscreenTexture());
        const renderPass = device.createRenderPass({
            colorAttachments: [{
                renderTarget: renderTarget,
                view: { level: 0, z: 0 },
                clearColor: "load",
                resolveTo: null,
                resolveView: null,
                store: true,
            }],
            depthStencilAttachment: null,
            occlusionQueryPool: null,
        });

        const program = textureCopyProgram(device, this.texture, this.mipLevel, this.zSlice);
        renderPass.setViewport(0, 0, this.canvas.width, this.canvas.height);

        const bindingLayouts = [{
            numUniformBuffers: 0,
            numSamplers: 1,
            samplerEntries: [
                { dimension: this.texture.dimension, formatKind: GfxSamplerFormatKind.Float, },
            ],
        }];
        const renderPipeline = device.createRenderPipeline({
            bindingLayouts,
            colorAttachmentFormats: [GfxFormat.U8_RGBA_RT],
            depthStencilAttachmentFormat: null,
            inputLayout: null,
            megaStateDescriptor: fullscreenMegaState,
            program: program,
            sampleCount: 1,
            topology: GfxPrimitiveTopology.Triangles,
        })
        renderPass.setPipeline(renderPipeline);
        const bindings = device.createBindings({
            bindingLayout: bindingLayouts[0],
            // No sampler needed, we use texelFetch.
            samplerBindings: [{ gfxTexture: this.texture, gfxSampler: null }],
            uniformBufferBindings: [],
        })
        renderPass.setBindings(0, bindings, []);
        renderPass.draw(3, 0);
        device.submitPass(renderPass);

        device.endFrame();

        const ctx = this.canvas.getContext('2d')!;
        ctx.drawImage(srcCanvas, 0, 0);

        device.destroyBindings(bindings);
        device.destroyRenderTarget(renderTarget);
        device.destroyRenderPipeline(renderPipeline);
        device.destroyProgram(program);

        srcCanvas.width = oldWidth;
        srcCanvas.height = oldHeight;
        this.swapChain.configureSwapChain(oldWidth, oldHeight);
    }
}
