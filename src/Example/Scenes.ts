
// Example of a noclip scene.
// This renders a cube with a texture:
//   * ... the cube model is created through code.
//   * ... the texture is loaded from a JPEG file loaded over the network.
//   * ... a basic post-processing effect (chromatic aberration) showing how to use the render graph.
//   * ... and an example of some custom panel UI.

import { mat4 } from "gl-matrix";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInst, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as UI from "../ui";
import { makeImageBitmapTexture2D } from "../gfx/helpers/TextureHelpers";
import { FakeTextureHolder } from "../TextureHolder";

// When we want to load files or assets at runtime, what directory are these assets in?
// We're going to be loading data/Examples/mandrill.jpg from here later; pathBase is relative to the data/ directory.
const pathBase = `Examples`;

// Our first shader program! This is GLSL code that we eventually give to the GPU to run.
// It consists of two parts, a vertex shader, and a fragment shader.
class CubeProgram extends DeviceProgram {
    // Define our vertex input data ("attributes"). By convention, we tend to use an "a_" prefix for
    // vertex attributes.
    public static a_Position = 0;
    public static a_UV = 1;

    // Define the slot index for our uniform parameters. noclip's framework just assigns sequential indices to
    // uniform blocks seen in the shader, in-order, starting with 0.
    public static ub_SceneParams = 0;
    public static ub_CubeParams = 1;

    // The GLSL code for the vertex shader.
    public override vert = `
// Now we're writing a GLSL shader. The vertex shader will be run once for every vertex in a triangle.

// Include our common declarations; this includes our uniform buffers and our textures.
${CubeProgram.Common}

// Here are our input vertex attributes. I use an "a_" prefix for vertex attributes.
layout(location = ${CubeProgram.a_Position}) in vec3 a_Position;
layout(location = ${CubeProgram.a_UV}) in vec2 a_UV;

// Here are the outputs from our vertex shader; these will be interpolated across the triangle and passed into the fragment shader.
// Position is a system output and doesn't require us to declare it.
// I use a "v_" prefix for vertex shader outputs / pixel shader inputs (so-called "varying"s).
out vec2 v_UV;

void main() {
    // Compute our world-space position from the position vertex attribute, and our uniform data.
    // I use a "t_" prefix to mean "temporary variable".
    vec3 t_PositionWorld = (UnpackMatrix(u_WorldFromLocal) * vec4(a_Position.xyz, 1.0f)).xyz;
    // Compute our output clip-space position from the, and our uniform matrix.
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0f);
    v_UV = a_UV.xy;
}
`;

    // The GLSL code for the fragment shader.
    public override frag = `
// Now we're in the fragment shader (also sometimes called a pixel shader). This shader runs once for each pixel.

${CubeProgram.Common}

// This will be filled in by the output of our vertex shader.
in vec2 v_UV;

void main() {
    // Use the UV coordinates output by the vertex shader to sample our texture.
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_UV.xy);
}
`;

    // Common declarations in both the vertex and fragment shader. This includes uniform data and textures.
    public static Common = `
// Import our helper code. In this case, we use a special matrix library as a workaround for some computers
// with incomplete WebGL implementations.
${GfxShaderLibrary.MatrixLibrary}

// Declare our uniform data. These are parameters that are constant across the entire draw call,
// and do not change per vertex or per pixel.
layout(std140) uniform ub_SceneParams {
    // Define our ViewProjection, or "ClipFromWorld" matrix, since it transforms us into clip space, from world space.
    // I use a "u_" prefix for uniform parameters.
    Mat4x4 u_ClipFromWorld;
};

// Define a second matrix for our cube's transform.
layout(std140) uniform ub_CubeParams {
    Mat3x4 u_WorldFromLocal;
};

// Declare our texture for the cube.
layout(location = 0) uniform sampler2D u_Texture;
`;

}

// Our second shader program. This one is for the post-processing "chromatic aberration" effect.
class PostProcessingProgram extends DeviceProgram {
    // Define our single uniform block.
    public static ub_PostProcessingParams = 0;

    // Definitions and code that will be in both the vertex and fragment shader.
    public static Common = `
layout(std140) uniform ub_PostProcessingParams {
    // For complex GPU reasons, it's best to keep parameters in vec4's or other groups of 4. Look up
    // the rules around std140 packing if you want more information about why. The convention I use
    // is to have a field called "u_Misc" and then use #define's to give more names to individual members.
    vec4 u_Misc[1];
};

layout(location = 0) uniform sampler2D u_TextureColor;

// Aberration Strength
#define u_AberrationStrength (u_Misc[0].x)

`;

    public override vert = `
${PostProcessingProgram.Common}

// Use a standard "fullscreenVS" shader which outputs a full-screen triangle,
// and gives us some texture coordinates to work with in "vec2 v_TexCoord".
// This automatically puts a main() for us.
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${PostProcessingProgram.Common}

in vec2 v_TexCoord;

void main() {
    // A simple Chromatic abberation effect.
    gl_FragColor = texture(SAMPLER_2D(u_TextureColor), v_TexCoord.xy);

    // Shift the red and blue texture coordinates by different amounts depending on the strength.
    // mix() is a lerp function; when u_AberrationStrength is 0, the mix() function will return 1.0f,
    // aka no shifting. When it's 1, it will shift by the full 1.1f or 0.9f.
    gl_FragColor.r = texture(SAMPLER_2D(u_TextureColor), v_TexCoord.xy * mix(1.0f, 1.1f, u_AberrationStrength)).r;
    gl_FragColor.b = texture(SAMPLER_2D(u_TextureColor), v_TexCoord.xy * mix(1.0f, 0.9f, u_AberrationStrength)).b;
}
`;
}

// Our example will consist of a cube with a texture on it.
class CubeGeometry {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public indexCount: number;
    public inputLayout: GfxInputLayout;
    public gfxProgram: GfxProgram;

    constructor(cache: GfxRenderCache) {
        const device = cache.device;

        // Our cube consists of 6 faces, each one containing four vertices.

        // Each vertex contains three positions (X, Y, Z), and two UV coordinates (U, V).
        // That means that we have 5 floats per vertex, 5*4 = 20 floats per face, and 5*4*6 = 120 floats in the whole cube.
        const vertexData = new Float32Array(120);
        vertexData.set([
        //   Face 0 - Left
        //   X   Y   Z     U  V
            -1, -1, -1,    0, 1,
            -1, -1,  1,    1, 1,
            -1,  1,  1,    1, 0,
            -1,  1, -1,    0, 0,

        //   Face 1 - Right
        //   X   Y   Z     U  V
             1, -1,  1,    0, 1,
             1, -1, -1,    1, 1,
             1,  1, -1,    1, 0,
             1,  1,  1,    0, 0,

        //   Face 2 - Top
        //   X   Y   Z     U  V
            -1,  1, -1,    0, 0,
            -1,  1,  1,    0, 1,
             1,  1,  1,    1, 1,
             1,  1, -1,    1, 0,

        //   Face 3 - Bottom
        //   X   Y   Z     U  V
             1, -1, -1,    0, 0,
             1, -1,  1,    0, 1,
            -1, -1,  1,    1, 1,
            -1, -1, -1,    1, 0,

        //   Face 4 - Front
        //   X   Y   Z     U  V
            -1,  1,  1,    0, 0,
            -1, -1,  1,    0, 1,
             1, -1,  1,    1, 1,
             1,  1,  1,    1, 0,

        //   Face 5 - Back
        //   X   Y   Z     U  V
             1,  1, -1,    0, 0,
             1, -1, -1,    0, 1,
            -1, -1, -1,    1, 1,
            -1,  1, -1,    1, 0,
        ]);

        // Now create the index buffer. Each face contains 2 triangles, each triangle contains 3 vertices,
        // so in total we have 2*3*6 = 36 total indices.
        this.indexCount = 36;
        const indexData = new Uint16Array(this.indexCount);

        // The indices in this index buffer are indices into the vertex buffer. Specifically, each index
        // in this buffer corresponds to a single line in the above vertexData array.
        indexData.set([
            0, 1, 2,     0, 2, 3,    // Face 0
            4, 5, 6,     4, 6, 7,    // Face 1
            8, 9, 10,    8, 10, 11,  // Face 2
            12, 13, 14,  12, 14, 15, // Face 3
            16, 17, 18,  16, 18, 19, // Face 4
            20, 21, 22,  20, 22, 23, // Face 5
        ]);

        // createBufferFromData will upload the given data to the GPU, creating a GfxBuffer.
        // GfxBufferUsage.Vertex means that it's a vertex buffer, and GfxBufferFrequencyHint.Static means that we only
        // upload data to this buffer once, when creating it, and won't upload new data to this buffer at runtime.
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.buffer);
        device.setResourceName(this.vertexBuffer, "Cube (VB)");

        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexData.buffer);
        device.setResourceName(this.indexBuffer, "Cube (IB)");

        // The input layout describes how we map our vertex data into the shader.
        this.inputLayout = cache.createInputLayout({
            // We have two vertex attributes in our cube: the position and the UV coordinate.
            vertexAttributeDescriptors: [
                {
                    // This attribute will be "hooked up" to the Position attribute in our shader.
                    location: CubeProgram.a_Position,
                    // The data here is 32-bit floats (F32), and there are three of them (RGB).
                    // noclip uses R, RG, RGB, and RGBA to describe whether the format has 1, 2, 3, or 4 components,
                    // to prevent there being a confusing mix of numbers like "F32_2", but this data does not have to
                    // literally be color data.
                    format: GfxFormat.F32_RGB,
                    // The position data starts at the first byte of the provided data.
                    bufferByteOffset: 0,
                    // The position data is in the 0th buffer (we only have one!)
                    bufferIndex: 0,
                },
                {
                    // Now declare our UV attribute.
                    location: CubeProgram.a_UV,
                    format: GfxFormat.F32_RG,
                    bufferByteOffset: 3 * 4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [
                // Declare the details of our vertex buffer.
                {
                    // Each vertex in this buffer is 5 floats long, and each float is 4 bytes long.
                    byteStride: 5 * 4,
                    // The data in this buffer advances per-vertex. Other options are constant, and per-instance data.
                    frequency: GfxVertexBufferFrequency.PerVertex,
                },
            ],

            // Our index buffer is a Uint16Array. That is a single Uint16, which we describe with the U16_R format.
            indexBufferFormat: GfxFormat.U16_R,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);

        // Don't destroy the GfxInputLayout or the GfxProgram;
        // these were created with the GfxRenderCache, which does its own cleanup.
    }
}

class ExampleScene implements SceneGfx {
    private renderHelper: GfxRenderHelper;

    // The renderInstList contains all of the objects we'll draw every frame.
    private renderInstList = new GfxRenderInstList();

    // Here's our cube! This just contains the vertex data.
    private cubeGeometry: CubeGeometry;

    // The shader program for our cube object.
    private cubeProgram: GfxProgram;
    // The texture for our cube.
    private cubeTexture: GfxTexture | null = null;

    // The sampler for our cube, and for post-processing.
    private linearSampler: GfxSampler;

    // The shader program for our post-processing shader.
    private postprocessingProgram: GfxProgram;

    // Post-Processing Toggle (Render Setting)
    public enablePostProcessing = true;
    public aberrationStrength = 0.2;

    public textureHolder = new FakeTextureHolder([]);

    constructor(private sceneContext: SceneContext) {
        // The GfxRenderHelper is a helper class that contains several helpers.
        this.renderHelper = new GfxRenderHelper(sceneContext.device, sceneContext);

        // The GfxRenderCache is a helper we have on the render helper, which can detect when
        // we're creating the same of an object, and return an existing one for us. We'll use
        // the cache for input layouts, for shader programs, and for samplers.
        // Note that objects created with the GfxRenderCache don't need to be destroyed, it
        // wil get destroyed automatically later.
        const cache = this.renderHelper.renderCache;

        this.cubeGeometry = new CubeGeometry(cache);

        // Compile our shader programs to the GPU.
        this.cubeProgram = cache.createProgram(new CubeProgram());
        this.postprocessingProgram = cache.createProgram(new PostProcessingProgram());

        // Samplers define how exactly textures are sampled; in this case, we want linear filtering,
        // and we want UVs that are out of bounds to clamp rather than repeat.
        this.linearSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        // Start the texture loading (async)
        this.fetchTexture();
    }

    private async fetchTexture() {
        // Mandrill is taken from image 4.2.03 of the USC SIPI Image Database:
        // https://sipi.usc.edu/database/database.php?volume=misc

        // fetchData returns an ArrayBufferSlice containing our data.
        // ArrayBufferSlice is a wrapper around ArrayBuffer with various helper methods.
        const mandrillJPEG = await this.sceneContext.dataFetcher.fetchData(`${pathBase}/mandrill.jpg`);

        // Use the web API "createImageBitmap" to load the JPEG, by way of a Blob.
        // ImageBitmap represents a kind of image that's optimized for GPU drawing.
        // https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
        // https://developer.mozilla.org/en-US/docs/Web/API/Blob
        const mandrillBlob = new Blob([mandrillJPEG.createTypedArray(Uint8Array)]);
        const imageBitmap = await createImageBitmap(mandrillBlob);

        // Now create a GfxTexture for the image bitmap.
        const device = this.renderHelper.device;
        this.cubeTexture = makeImageBitmapTexture2D(device, imageBitmap);
        device.setResourceName(this.cubeTexture, 'mandrill.jpg');

        // Display the Mandrill texture in the Texture List on the left-hand side.
        this.textureHolder.viewerTextures.push({ gfxTexture: this.cubeTexture });
        this.textureHolder.onnewtextures();
    }

    private fillSceneParams(template: GfxRenderInst, viewerInput: ViewerRenderInput): void {
        // Set up the scene parameter uniform block. We need to manually count the size here, which is a bit annoying.
        // In this case, we know that ub_SceneParams contains a single Mat4x4, and a single Mat4x4 is 16 floats.
        const data = template.allocateUniformBufferF32(CubeProgram.ub_SceneParams, 16);
        let offs = 0;

        // Upload the camera's clipFromWorldMatrix to the uniform buffer.
        offs += fillMatrix4x4(data, offs, viewerInput.camera.clipFromWorldMatrix);
    }

    private renderCube(time: number): void {
        // If the texture is still loading, don't render yet!
        if (this.cubeTexture === null)
            return;

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.cubeProgram);
        // Set our texture and sampler parameters.
        renderInst.setSamplerBindings(0, [
            { gfxTexture: this.cubeTexture, gfxSampler: this.linearSampler }
        ]);

        // Set our vertex attributes. For each buffer in the input layout, we need to pass a buffer binding here.
        // Additionally, if we're using a buffer
        renderInst.setVertexInput(
            this.cubeGeometry.inputLayout,
            [{ buffer: this.cubeGeometry.vertexBuffer, byteOffset: 0 }],
            { buffer: this.cubeGeometry.indexBuffer, byteOffset: 0 },
        );

        // Our cube has 36 vertices. This is a separate parameter because it's actually possible to draw different
        // ranges of the same index buffer.
        renderInst.setDrawCount(this.cubeGeometry.indexCount);

        // Create a transform for our cube.
        const cubeMatrix = mat4.create();
        // Move it back a bit.
        mat4.translate(cubeMatrix, cubeMatrix, [0, 0, -400]);
        // Rotate it over time.
        mat4.rotateX(cubeMatrix, cubeMatrix, time * 0.0007);
        mat4.rotateY(cubeMatrix, cubeMatrix, time * 0.0003);
        // Scale up our cube by 50 to make it larger on the screen.
        mat4.scale(cubeMatrix, cubeMatrix, [50, 50, 50]);

        // Now upload our cube's parameter data to the GPU, which is our matrix.
        // This is a Mat3x4, which is 3 groups of 4 floats.
        const cubeParams = renderInst.allocateUniformBufferF32(CubeProgram.ub_CubeParams, 12);
        let offs = 0;
        offs += fillMatrix4x3(cubeParams, offs, cubeMatrix);

        // Turn on backface culling. This is one of the fixed-function settings available through the MegaStateFlags.
        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });

        // Now that we're done setting up our render object, we can add it to our list of objects...
        this.renderInstList.submitRenderInst(renderInst);
    }

    private pushPostProcessingPass(builder: GfxrGraphBuilder, mainColorTargetID: GfxrRenderTargetID): void {
        // In order to use post-processing, we need to copy the texture we just rendered to so we can sample
        // it in our post-processing shader. We do this with "resolve textures"; this ID is a handle we can later
        // redeem inside our pass's execute function for a GfxTexture.
        const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
        builder.pushPass((pass) => {
            pass.setDebugName("Post-Processing");

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            // We need to attach the resolve texture to the pass for it to do the accounting correctly.
            pass.attachResolveTexture(mainColorResolveTextureID);

            // Now set up a draw call where we do our post-processing.
            const renderInst = this.renderHelper.renderInstManager.newRenderInst();
            
            // We use a single texture, and no uniform buffers.
            renderInst.setBindingLayouts([
                { numSamplers: 1, numUniformBuffers: 1 },
            ]);

            renderInst.setGfxProgram(this.postprocessingProgram);

            // Fill in the data for ub_PostProcessingParams. Note that uniform buffer data must always be allocated
            // outside of the pass.exec() function.
            const data = renderInst.allocateUniformBufferF32(PostProcessingProgram.ub_PostProcessingParams, 4);
            let offs = 0;
            offs += fillVec4(data, offs, this.aberrationStrength);

            // We use a special trick where we don't need any vertex inputs,
            // we instead invent the vertices in the vertex shader.
            renderInst.setVertexInput(null, null, null);

            // We draw a single full-screen triangle, which is composed of 3 vertices.
            renderInst.setDrawCount(3);

            // The mega state flags contain all of the fixed-function state for this draw;
            // in this case there's a good default you can use for full-screen passes.
            renderInst.setMegaStateFlags(fullscreenMegaState);

            pass.exec((passRenderer, scope) => {
                // Redeem our resolve texture ID for a proper texture.
                const mainColorTexture = scope.getResolveTextureForID(mainColorResolveTextureID);

                // Note that this would become a bit more complicated if we wanted to add a uniform buffer,
                // as we can't allocate uniform data inside an exec() function; we require that all uniform
                // data is submitted early in the frame.

                // Render our triangle with the main color texture.
                renderInst.setSamplerBindings(0, [{
                    gfxTexture: mainColorTexture,
                    gfxSampler: this.linearSampler,
                }]);

                // Now submit the draw to the pass.
                renderInst.drawOnPass(this.renderHelper.renderCache, passRenderer);
            });
        });
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        // noclip's framework will call your render function once per frame. The device will always be the same
        // as the device passed in through the sceneContext in the constructor. The renderInput provided contains
        // extra details about the frame, like the delta time, window size, and mouse location.

        // Set up debug drawing (we didn't use any debug drawing in this example, but you can try looking through
        // this.renderHelper.debugDraw.* for all the different kinds of objects you can draw. These can be incredibly
        // helpful when debugging issues!)
        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // Example of debug draws:
        // this.renderHelper.debugDraw.screenPrintText('Hello', Red);

        // noclip's render framework has two important components to understand.
        //
        // The first is GfxRenderInst; this is how noclip's framework describes draw calls. A GfxRenderInst is an object
        // with a shader, some uniform parameters, some textures, some vertices, and some fixed-function flags.
        //
        // You can submit GfxRenderInst's directly, but more likely, you'll want to make a lot of draw calls for different
        // objects, so there's also a GfxRenderInstList where you can compile a lot of them together, and then draw them
        // on a single render pass.
        //
        // The GfxRenderInst framework also has a template system which makes it easier to build a lot of draw calls that
        // share parameters. Templates are very convenient for setting scene-specific parameters since you only need to
        // set them on the template, once, and all draw calls will inherit them.

        // First, set up our objects. In this case, we only have the cube to render. We need to set up a "template"
        // render inst, which contains some default setup created by our render helper. This template will contain
        // defaults for all the other render insts we'll use.
        const template = this.renderHelper.pushTemplateRenderInst();

        // The first thing we must do is tell noclip the maximum number of uniform blocks and texture samplers we need.
        template.setBindingLayouts([
            { numSamplers: 1, numUniformBuffers: 2 },
        ]);

        // Fill in the ub_SceneParams uniform block. The viewerInput contains the viewer's camera.
        this.fillSceneParams(template, viewerInput);

        // Render our cube.
        this.renderCube(viewerInput.time);

        // We could manually configure render passes using device.createRenderPass(), but we have a helper to
        // make writing render pass logic easier called the render graph; our render helper has one of them.
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        // To do post-processing, we'll need to render our objects into an intermediate texture.
        // This makeBackbufferDescSimple function tells us to create these textures to be as large as the window,
        // with default settings, and to use the default clear colors.
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');

        // Push our default pass. The function given to pushPass() is called immediately, this is just a convenient
        // way to structure our passes and code.
        builder.pushPass((pass) => {
            // Give the pass a debug name (helpful for error messages and debugging tools)
            pass.setDebugName("Opaque Objects");

            // Attach our color and depth buffer.
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            // Now configure what should happen when we render this pass; in this case, we want to render our
            // main object list, which contains our cube. This pass exec function won't be called now;
            // it will be called later during the builder.execute() below.
            pass.exec((passRenderer, scope) => {
                this.renderInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        if (this.enablePostProcessing) {
            // If post-processing is enabled, then add it as a pass to our render graph.
            this.pushPostProcessingPass(builder, mainColorTargetID);
        }

        // Remove our template that we pushed using pushTemplate() at the beginning of the function,
        // now that we've made all the render insts we need to.
        this.renderHelper.renderInstManager.popTemplate();

        // Actually draw any of our debug draws.
        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);

        // Push our standard antialiasing passes (this activates if the user has "FXAA" selected in Viewer Settings)
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);

        // Now send our main color target on the screen.
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        // Before we run, we need to tell the render helper to update some of the behind the scenes data...
        this.renderHelper.prepareToRender();

        // Execute!
        builder.execute();
    }

    // noclip has a few different hooks it calls when the scene is constructed to hook into various parts
    // of its UI or rendering framework. When the scene is loaded, `createPanels()` is called, and the returned
    // panels are placed inside the list of panels on the left.
    public createPanels(): UI.Panel[] {
        // Create our settings panel.
        const renderSettingsPanel = new UI.Panel();
        renderSettingsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderSettingsPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Settings');

        const enablePostProcessingCheckbox = new UI.Checkbox('Enable Post-Processing', this.enablePostProcessing);
        enablePostProcessingCheckbox.onchanged = () => {
            this.enablePostProcessing = enablePostProcessingCheckbox.checked;
        };
        renderSettingsPanel.contents.appendChild(enablePostProcessingCheckbox.elem);

        const aberrationStrengthSlider = new UI.Slider('Aberration Strength', this.aberrationStrength, 0.0, 1.0);
        aberrationStrengthSlider.onvalue = () => {
            this.aberrationStrength = aberrationStrengthSlider.getValue();
        };
        renderSettingsPanel.contents.appendChild(aberrationStrengthSlider.elem);

        return [renderSettingsPanel];
    }

    public destroy(device: GfxDevice): void {
        // noclip's framework will call this destroy function when the user navigates away from your scene.
        // Destroy any graphics resources or do any cleanup logic you need to here.
        this.renderHelper.destroy();
        this.cubeGeometry.destroy(device);

        if (this.cubeTexture !== null)
            device.destroyTexture(this.cubeTexture);
    }
}

// The SceneDesc needs an ID, a name, and a createScene function.
// The SceneDesc's ID is used to identify the scene by URL; keep this stable so that users can bookmark your scene!
// The SceneDesc's name is the name shown on the right side of the scene picker.
class ExampleSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        return new ExampleScene(sceneContext);
    }
}

// The SceneGroup is your entry point; it's how noclip's UI displays all of the available scenes in its menu,
// and knows to pass control to your code.
// 
// A SceneGroup usually corresponds to a single game, and the SceneDescs are the levels inside.
export const sceneGroup: SceneGroup = {
    // The SceneGroup's ID is used to identify the scene by URL. Much like the SceneDesc ID,
    // keep this stable so that users can bookmark your scene!
    id: "NoclipExamples",
    // The SceneGroup's name is shown in the UI, on the left side of the scene picker.
    name: "Examples",

    // The list of SceneDecs shows up on the right side of the scene picker.
    sceneDescs: [
        // You can add strings into the sceneDescs array in order to add grouping to your scenes.
        // "Examples",
        new ExampleSceneDesc("Example1", "Example 1"),
    ],

    // This is a development-only example, so we hide it on non-development builds.
    hidden: !IS_DEVELOPMENT,
};
