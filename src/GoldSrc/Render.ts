
import { GfxDevice, GfxTexture, GfxFormat, makeTextureDescriptor2D, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxBuffer, GfxBufferUsage, GfxProgram, GfxCullMode, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { assert, assertExists, nArray, readString } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers";
import { Texture, ViewerRenderInput } from "../viewer";
import { DeviceProgram } from "../Program";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { BSPFile, Surface, SurfaceLightmapData } from "./BSPFile";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { TextureMapping } from "../TextureHolder";
import { mat4 } from "gl-matrix";
import { Camera } from "../Camera";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { WAD, WADLumpType } from "./WAD";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { LightmapPackerPage } from "../SourceEngine/BSPFile";

function getMipTexName(buffer: ArrayBufferSlice): string {
    return readString(buffer, 0x00, 0x10, true);
}

export class MIPTEXData {
    public gfxTexture: GfxTexture;
    public viewerTexture: Texture;

    public name: string;
    public width: number;
    public height: number;

    constructor(device: GfxDevice, buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();
        this.name = getMipTexName(buffer);
        this.width = view.getUint32(0x10, true);
        this.height = view.getUint32(0x14, true);

        const isDecal = this.name.charAt(0) === '{';

        const numLevels = 4;

        const mipOffsets = nArray(numLevels, (i) => view.getUint32(0x18 + i * 4, true));

        // Find the palette offset.
        const palOffs = mipOffsets[3] + ((this.width * this.height) >>> 6);
        const palSize = view.getUint16(palOffs + 0x00, true);
        assert(palSize === 0x100);

        const pal = buffer.createTypedArray(Uint8Array, palOffs + 0x02);

        const surfaces: HTMLCanvasElement[] = [];

        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.width, this.height, numLevels));
        let mipW = this.width, mipH = this.height;
        for (let i = 0; i < numLevels; i++) {
            const mipData = new Uint8Array(mipW * mipH * 4);

            let dataOffs = mipOffsets[i];
            const numPixels = mipW * mipH;
            for (let j = 0; j < numPixels; j++) {
                const palIdx = view.getUint8(dataOffs++);

                if (isDecal && palIdx === 255) {
                    mipData[j * 4 + 0] = 0x00;
                    mipData[j * 4 + 1] = 0x00;
                    mipData[j * 4 + 2] = 0x00;
                    mipData[j * 4 + 3] = 0x00;
                } else {
                    mipData[j * 4 + 0] = pal[palIdx * 3 + 0];
                    mipData[j * 4 + 1] = pal[palIdx * 3 + 1];
                    mipData[j * 4 + 2] = pal[palIdx * 3 + 2];
                    mipData[j * 4 + 3] = 0xFF;
                }
            }

            device.uploadTextureData(this.gfxTexture, i, [mipData]);
            surfaces.push(convertToCanvas(new ArrayBufferSlice(mipData.buffer), mipW, mipH, GfxFormat.U8_RGBA_NORM));

            mipW >>= 1;
            mipH >>= 1;
        }

        this.viewerTexture = { name: this.name, surfaces };
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

const enum TextureCacheType {
    MIPTEX,
}

interface TextureCacheData {
    name: string;
    type: TextureCacheType;
    data: ArrayBufferSlice;
}

export class TextureCache {
    public mipTex: MIPTEXData[] = [];
    public data: TextureCacheData[] = [];

    constructor(public cache: GfxRenderCache) {
    }

    public addWAD(wad: WAD): void {
        for (let i = 0; i < wad.lumps.length; i++) {
            const lump = wad.lumps[i];
            if (lump.type === WADLumpType.MIPTEX) {
                const name = getMipTexName(lump.data);
                this.data.push({ name, type: TextureCacheType.MIPTEX, data: lump.data });
            }
        }
    }

    public addBSP(bsp: BSPFile): void {
        for (let i = 0; i < bsp.extraTexData.length; i++) {
            const data = bsp.extraTexData[i];
            const name = getMipTexName(data);
            this.data.push({ name, type: TextureCacheType.MIPTEX, data });
        }
    }

    public findMipTex(texName: string): MIPTEXData {
        let mipTex = this.mipTex.find((texture) => texture.name === texName);
        if (mipTex === undefined) {
            const entry = assertExists(this.data.find((data) => data.name === texName));
            mipTex = new MIPTEXData(this.cache.device, entry.data);
            this.mipTex.push(mipTex);
        }
        return mipTex;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.mipTex.length; i++)
            this.mipTex[i].destroy(device);
    }
}

class GoldSrcProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

    public static a_Position = 0;
    public static a_TexCoord = 1;

    public override both = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ViewProjection;
};

uniform sampler2D u_TextureDiffuse;
uniform sampler2D u_TextureLightmap;
`;

    public override vert = `
layout(location = ${GoldSrcProgram.a_Position}) in vec3 a_Position;
layout(location = ${GoldSrcProgram.a_TexCoord}) in vec4 a_TexCoord;

out vec4 v_TexCoord;

void main() {
    gl_Position = Mul(u_ViewProjection, vec4(a_Position, 1.0));
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
in vec4 v_TexCoord;

void main() {
    vec2 t_TexCoordDiffuse = v_TexCoord.xy / vec2(textureSize(TEXTURE(u_TextureDiffuse), 0));
    vec4 t_DiffuseSample = texture(u_TextureDiffuse, t_TexCoordDiffuse.xy);

    if (t_DiffuseSample.a < 0.1)
        discard;

    vec2 t_TexCoordLightmap = v_TexCoord.zw / vec2(textureSize(TEXTURE(u_TextureLightmap), 0));
    vec4 t_LightmapSample = texture(u_TextureLightmap, t_TexCoordLightmap.xy);

    gl_FragColor = t_DiffuseSample.rgba * t_LightmapSample.rgba;
}
`;
}

class BSPSurfaceRenderer {
    private textureMapping = nArray(2, () => new TextureMapping());

    constructor(textureCache: TextureCache, private surface: Surface) {
        const miptex = textureCache.findMipTex(this.surface.texName);
        this.textureMapping[0].gfxTexture = miptex.gfxTexture;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, lightmapManager: LightmapManager): void {
        this.textureMapping[1].gfxTexture = lightmapManager.gfxTexture;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.drawIndexes(this.surface.indexCount, this.surface.startIndex);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInstManager.submitRenderInst(renderInst);
    }
}

// In Source, the convention is +X for forward and -X for backward, +Y for left and -Y for right, and +Z for up and -Z for down.
// Converts from Source conventions to noclip ones.
const noclipSpaceFromSourceEngineSpace = mat4.fromValues(
    0,  0, -1, 0,
    -1, 0,  0, 0,
    0,  1,  0, 0,
    0,  0,  0, 1,
);

// A "View" is effectively camera settings, but in Source engine space.
class View {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
    }

    public setupFromCamera(camera: Camera): void {
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }
}

class LightmapManager {
    public gfxTexture: GfxTexture;
    public lightmapData: SurfaceLightmapData[] = [];
    private lightmapDirty = false;

    constructor(device: GfxDevice, private packerPage: LightmapPackerPage) {
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, packerPage.width, packerPage.height, 1));
    }

    public addSurface(lightmapData: SurfaceLightmapData): void {
        this.lightmapData.push(lightmapData);
        this.lightmapDirty = true;
    }

    public prepareToRender(device: GfxDevice): void {
        if (!this.lightmapDirty)
            return;

        // Construct a new lightmap
        const numPixels = this.packerPage.width * this.packerPage.height;
        const dst = new Uint8ClampedArray(numPixels * 4);
        for (let i = 0; i < this.lightmapData.length; i++) {
            const lightmapData = this.lightmapData[i];

            if (lightmapData.samples === null)
                continue;

            // TODO(jstpierre): Add up light styles
            const src = lightmapData.samples;
            let srcOffs = 0;
            for (let y = 0; y < lightmapData.height; y++) {
                let dstOffs = (this.packerPage.width * (lightmapData.pagePosY + y) + lightmapData.pagePosX) * 4;
                for (let x = 0; x < lightmapData.width; x++) {
                    dst[dstOffs++] = src[srcOffs++];
                    dst[dstOffs++] = src[srcOffs++];
                    dst[dstOffs++] = src[srcOffs++];
                    dst[dstOffs++] = 0xFF;
                }
            }
        }
        device.uploadTextureData(this.gfxTexture, 0, [dst]);

        this.lightmapDirty = false;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class BSPRenderer {
    public surfaceRenderers: BSPSurfaceRenderer[] = [];

    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    private lightmapManager: LightmapManager;

    private gfxProgram: GfxProgram;
    private mainView = new View();

    constructor(cache: GfxRenderCache, textureCache: TextureCache, private bsp: BSPFile) {
        const device = cache.device;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GoldSrcProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: GoldSrcProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+4)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.bsp.vertexData);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, this.bsp.indexData);

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        this.lightmapManager = new LightmapManager(device, this.bsp.lightmapPackerPage);

        const program = new GoldSrcProgram();
        this.gfxProgram = cache.createProgram(program);

        for (let i = 0; i < this.bsp.surfaces.length; i++) {
            const surface = this.bsp.surfaces[i];
            this.surfaceRenderers.push(new BSPSurfaceRenderer(textureCache, surface));

            for (let j = 0; j < surface.lightmapData.length; j++)
                this.lightmapManager.addSurface(surface.lightmapData[j]);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.lightmapManager.prepareToRender(renderInstManager.gfxRenderCache.device);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts([{ numSamplers: 2, numUniformBuffers: 1 }]);
        template.setInputLayoutAndState(this.inputLayout, this.inputState);
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW });

        this.mainView.setupFromCamera(viewerInput.camera);

        let offs = template.allocateUniformBuffer(GoldSrcProgram.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(GoldSrcProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, this.mainView.clipFromWorldMatrix);

        for (let i = 0; i < this.surfaceRenderers.length; i++)
            this.surfaceRenderers[i].prepareToRender(renderInstManager, this.lightmapManager);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        this.lightmapManager.destroy(device);
    }
}

export class GoldSrcRenderer {
    public textureCache: TextureCache;
    public bspRenderers: BSPRenderer[] = [];
    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
        this.textureCache = new TextureCache(this.renderHelper.renderCache);
    }

    private prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].prepareToRender(renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(renderInstManager, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
        this.renderHelper.destroy();
        this.textureCache.destroy(device);
    }
}
