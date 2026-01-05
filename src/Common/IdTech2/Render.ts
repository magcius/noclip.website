import { GfxDevice, GfxTexture, GfxFormat, makeTextureDescriptor2D, GfxInputLayout, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxBuffer, GfxBufferUsage, GfxProgram, GfxCullMode, GfxFrontFaceMode, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxBufferFrequencyHint } from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { assert, assertExists, nArray, readString } from "../../util.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { convertToCanvas } from "../../gfx/helpers/TextureConversionHelpers.js";
import { SceneGfx, Texture, ViewerRenderInput } from "../../viewer.js";
import { DeviceProgram } from "../../Program.js";
import { BSPFile, Surface, SurfaceLightmapData } from "./BSPFile.js";
import { GfxRenderInstList, GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import { TextureMapping } from "../../TextureHolder.js";
import { mat4 } from "gl-matrix";
import { Camera, CameraController } from "../../Camera.js";
import { fillMatrix4x4, fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { WAD, WAD2LumpType, WAD3LumpType } from "./WAD.js";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentSlot } from "../../gfx/render/GfxRenderGraph.js";
import { LightmapPackerPage } from "../../SourceEngine/BSPFile.js";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary.js";
import { createBufferFromData } from "../../gfx/helpers/BufferHelpers.js";
import { TextureListHolder } from "../../ui.js";
import { WorldLightingState } from "./WorldLightingState.js";

function getMipTexName(buffer: ArrayBufferSlice): string {
    return readString(buffer, 0x00, 0x10, true);
}

export class MIPTEXData {
    public gfxTexture: GfxTexture;
    public viewerTexture: Texture;

    public name: string;
    public width: number;
    public height: number;

    constructor(device: GfxDevice, buffer: ArrayBufferSlice, externalPalette: Uint8Array | null = null) {
        const view = buffer.createDataView();
        this.name = getMipTexName(buffer);
        this.width = view.getUint32(0x10, true);
        this.height = view.getUint32(0x14, true);

        const isDecal = this.name.charAt(0) === '{';

        const numLevels = 4;

        const mipOffsets = nArray(numLevels, (i) => view.getUint32(0x18 + i * 4, true));

        let pal: Uint8Array;
        if (externalPalette !== null) {
            // Quake uses a global shared palette
            pal = externalPalette;
        } else {
            // Half-Life has per-texture embedded palettes
            const palOffs = mipOffsets[3] + ((this.width * this.height) >>> 6);
            const palSize = view.getUint16(palOffs + 0x00, true);
            assert(palSize === 0x100);
            pal = buffer.createTypedArray(Uint8Array, palOffs + 0x02);
        }

        const surfaces: HTMLCanvasElement[] = [];

        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.width, this.height, numLevels));
        device.setResourceName(this.gfxTexture, this.name);
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

enum TextureCacheType {
    MIPTEX,
}

interface TextureCacheData {
    name: string;
    type: TextureCacheType;
    data: ArrayBufferSlice;
}

export class TextureCache implements TextureListHolder {
    public mipTex: MIPTEXData[] = [];
    public data: TextureCacheData[] = [];
    public onnewtextures: (() => void) | null = null;
    public palette: Uint8Array | null = null;

    constructor(public cache: GfxRenderCache) {
    }

    public setPalette(palette: Uint8Array): void {
        this.palette = palette;
    }

    public get textureNames(): string[] {
        return this.mipTex.map((tex) => tex.name);
    }

    public async getViewerTexture(i: number): Promise<Texture> {
        return this.mipTex[i].viewerTexture;
    }

    public addWAD(wad: WAD): void {
        const miptexType = wad.version === 2 ? WAD2LumpType.MIPTEX : WAD3LumpType.MIPTEX;
        for (let i = 0; i < wad.lumps.length; i++) {
            const lump = wad.lumps[i];
            if (lump.type === miptexType) {
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
            mipTex = new MIPTEXData(this.cache.device, entry.data, this.palette);
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
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_Params[1];
};

#define u_Time (u_Params[0].x)

uniform sampler2D u_TextureDiffuse;
uniform sampler2D u_TextureLightmap;
`;

    public override vert = `
layout(location = ${GoldSrcProgram.a_Position}) in vec3 a_Position;
layout(location = ${GoldSrcProgram.a_TexCoord}) in vec4 a_TexCoord;

out vec4 v_TexCoord;

void main() {
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
in vec4 v_TexCoord;

void main() {
    vec2 t_TexCoordDiffuse = v_TexCoord.xy;

#if defined USE_WATER
    #if defined GAME_QUAKE
        const float M_PI = 3.14159265;
        const float TIME_SCALE = 128.0 / M_PI;

        float angleS = mod(t_TexCoordDiffuse.y * 2.0 + u_Time * TIME_SCALE, 256.0);
        float angleT = mod(t_TexCoordDiffuse.x * 2.0 + u_Time * TIME_SCALE, 256.0);

        float warpS = 8.0 * sin(angleS * (M_PI / 128.0));
        float warpT = 8.0 * sin(angleT * (M_PI / 128.0));

        t_TexCoordDiffuse.x += warpS;
        t_TexCoordDiffuse.y += warpT;
    #else
        // scale HL1 water to better match original engine,
        // this 2.75 isn't a perfect value, but its close enough
        t_TexCoordDiffuse *= 2.75;

        float warpS = 10.0 * sin(t_TexCoordDiffuse.y * 0.03 + u_Time * 0.5);
        float warpT = 10.0 * sin(t_TexCoordDiffuse.x * 0.03 + u_Time * 0.5);

        t_TexCoordDiffuse.x += warpS;
        t_TexCoordDiffuse.y += warpT;
    #endif
#endif

    t_TexCoordDiffuse.xy /= vec2(textureSize(TEXTURE(u_TextureDiffuse), 0));
    vec4 t_DiffuseSample = texture(SAMPLER_2D(u_TextureDiffuse), t_TexCoordDiffuse.xy);

    if (t_DiffuseSample.a < 0.1)
        discard;

    vec2 t_TexCoordLightmap = v_TexCoord.zw / vec2(textureSize(TEXTURE(u_TextureLightmap), 0));
    vec4 t_Color = t_DiffuseSample;

#if defined USE_LIGHTMAP
    vec4 t_LightmapSample = texture(SAMPLER_2D(u_TextureLightmap), t_TexCoordLightmap.xy);

    t_Color.rgb *= t_LightmapSample.rgb * 2.0;
#endif

#if defined GAME_QUAKE
    t_Color.rgb = t_Color.rgb * 1.4;  // Contrast
    t_Color.rgb = pow(t_Color.rgb, vec3(0.9));  // Gamma
#endif

    gl_FragColor = t_Color;
}
`;
}

class BSPSurfaceRenderer {
    private textureMapping = nArray(2, () => new TextureMapping());
    private visible = true;
    private gfxProgram: GfxProgram;
    private sky = false;
    private water = false;

    constructor(cache: GfxRenderCache, textureCache: TextureCache, private surface: Surface, bspVersion: number) {
        const miptex = textureCache.findMipTex(this.surface.texName);
        this.textureMapping[0].gfxTexture = miptex.gfxTexture;

        const isGameQuake = bspVersion === 29;
        const isGameHL1 = bspVersion === 30;

        const texName = this.surface.texName;
        if (texName.startsWith('sky'))
            this.sky = true;
        if ((texName.startsWith('*') && texName !== "*default") || texName.startsWith('!'))
            this.water = true;
        if (isGameHL1 && texName.startsWith('water'))
            this.water = true;

        const program = new GoldSrcProgram();
        program.setDefineBool('USE_LIGHTMAP', !this.sky && !this.water);
        program.setDefineBool('USE_WATER', this.water);
        program.setDefineBool('GAME_QUAKE', isGameQuake);
        program.setDefineBool('GAME_HL1', isGameHL1);
        this.gfxProgram = cache.createProgram(program);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, lightmapManager: LightmapManager, view: View): void {
        if (!this.visible)
            return;

        this.textureMapping[1].gfxTexture = lightmapManager.gfxTexture;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setDrawCount(this.surface.indexCount, this.surface.startIndex);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        const list = this.sky ? view.skyList : view.mainList;
        list.submitRenderInst(renderInst);
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

    public time = 0;

    public mainList = new GfxRenderInstList();
    public skyList = new GfxRenderInstList();

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
    }

    public setupFromCamera(camera: Camera): void {
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }

    public reset(): void {
        this.mainList.reset();
        this.skyList.reset();
    }
}

class LightmapManager {
    public gfxTexture: GfxTexture;
    public lightmapData: SurfaceLightmapData[] = [];
    private lightmapPixelData: Uint8ClampedArray;

    constructor(device: GfxDevice, private packerPage: LightmapPackerPage, private bytesPerTexel: number) {
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, packerPage.width, packerPage.height, 1));
        const numPixels = packerPage.width * packerPage.height;
        this.lightmapPixelData = new Uint8ClampedArray(numPixels * 4);
    }

    public addSurface(lightmapData: SurfaceLightmapData): void {
        this.lightmapData.push(lightmapData);
    }

    public prepareToRender(device: GfxDevice, worldLightingState: WorldLightingState): void {
        const dst = this.lightmapPixelData;
        dst.fill(0);

        for (let i = 0; i < this.lightmapData.length; i++) {
            const lightmapData = this.lightmapData[i];

            if (lightmapData.samples === null)
                continue;

            const src = lightmapData.samples;
            const numStyles = lightmapData.styles.length;
            const styleSize = lightmapData.width * lightmapData.height * this.bytesPerTexel;

            for (let y = 0; y < lightmapData.height; y++) {
                let dstOffs = (this.packerPage.width * (lightmapData.pagePosY + y) + lightmapData.pagePosX) * 4;
                for (let x = 0; x < lightmapData.width; x++) {
                    let r = 0, g = 0, b = 0;
                    for (let styleIdx = 0; styleIdx < numStyles; styleIdx++) {
                        const styleNum = lightmapData.styles[styleIdx];
                        const styleValue = worldLightingState.getValue(styleNum);
                        const styleOffset = styleIdx * styleSize;

                        if (this.bytesPerTexel === 1) {
                            const pixelOffset = styleOffset + y * lightmapData.width + x;
                            const gray = src[pixelOffset] * styleValue;
                            r += gray;
                            g += gray;
                            b += gray;
                        } else {
                            const pixelOffset = styleOffset + (y * lightmapData.width + x) * 3;
                            r += src[pixelOffset + 0] * styleValue;
                            g += src[pixelOffset + 1] * styleValue;
                            b += src[pixelOffset + 2] * styleValue;
                        }
                    }
                    dst[dstOffs++] = Math.min(255, r);
                    dst[dstOffs++] = Math.min(255, g);
                    dst[dstOffs++] = Math.min(255, b);
                    dst[dstOffs++] = 0xFF;
                }
            }
        }
        device.uploadTextureData(this.gfxTexture, 0, [dst]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}
export class BSPRenderer {
    public surfaceRenderers: BSPSurfaceRenderer[] = [];

    private inputLayout: GfxInputLayout;
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;

    private lightmapManager: LightmapManager;

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

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, this.bsp.vertexData);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, this.bsp.indexData);

        this.vertexBufferDescriptors = [
            { buffer: this.vertexBuffer },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        const lightmapBytesPerTexel = this.bsp.version === 29 ? 1 : 3;
        this.lightmapManager = new LightmapManager(device, this.bsp.lightmapPackerPage, lightmapBytesPerTexel);

        // TODO(jstpierre): Other models.
        const model = this.bsp.models[0]!;
        for (let i = 0; i < model.surfaces.length; i++) {
            const surface = this.bsp.surfaces[model.surfaces[i]];
            this.surfaceRenderers.push(new BSPSurfaceRenderer(cache, textureCache, surface, this.bsp.version));

            for (let j = 0; j < surface.lightmapData.length; j++)
                this.lightmapManager.addSurface(surface.lightmapData[j]);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: View, worldLightingState: WorldLightingState): void {
        this.lightmapManager.prepareToRender(renderInstManager.gfxRenderCache.device, worldLightingState);

        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts([{ numSamplers: 2, numUniformBuffers: 1 }]);
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW });

        let offs = template.allocateUniformBuffer(GoldSrcProgram.ub_SceneParams, 16+4);
        const d = template.mapUniformBufferF32(GoldSrcProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, view.clipFromWorldMatrix);
        offs += fillVec4(d, offs, view.time);

        for (let i = 0; i < this.surfaceRenderers.length; i++)
            this.surfaceRenderers[i].prepareToRender(renderInstManager, this.lightmapManager, view);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        this.lightmapManager.destroy(device);
    }
}

export class IdTech2Renderer implements SceneGfx {
    public textureCache: TextureCache;
    public textureHolder: TextureCache;
    public bspRenderers: BSPRenderer[] = [];
    public renderHelper: GfxRenderHelper;
    public worldLightingState: WorldLightingState;

    public mainView = new View();

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
        this.textureCache = new TextureCache(this.renderHelper.renderCache);
        this.textureHolder = this.textureCache;
        this.worldLightingState = new WorldLightingState();
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(4/60);
    }

    private prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.mainView.time += viewerInput.deltaTime / 1000;
        this.mainView.setupFromCamera(viewerInput.camera);

        this.worldLightingState.update(this.mainView.time);

        this.renderHelper.pushTemplateRenderInst();

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].prepareToRender(renderInstManager, this.mainView, this.worldLightingState);

        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.mainView.skyList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.mainView.mainList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(renderInstManager, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.mainView.reset();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
        this.renderHelper.destroy();
        this.textureCache.destroy(device);
    }
}
