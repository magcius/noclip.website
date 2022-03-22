
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { PPAK_Texture, TextureFormat, getTextureFormatName } from "./ppf";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxTextureDimension, GfxRenderPass, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { decompressBC, DecodedSurfaceSW, surfaceToCanvas } from "../Common/bc_texture";
import { EMeshFrag, EMesh, EScene, EDomain, MaterialFlags } from "./plb";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { convertToTriangleIndexBuffer, filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, ReadonlyMat4 } from "gl-matrix";
import { Camera, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { nArray, assertExists } from "../util";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { AABB } from '../Geometry';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

function decodeTextureData(format: TextureFormat, width: number, height: number, pixels: Uint8Array): DecodedSurfaceSW {
    switch (format) {
    case TextureFormat.B8G8R8A8:
        return { type: 'RGBA', flag: 'SRGB', width, height, depth: 1, pixels };
    case TextureFormat.DXT1:
        return decompressBC({ type: 'BC1', flag: 'SRGB', width, height, pixels, depth: 1 });
    case TextureFormat.DXT3:
        // who the hell uses BC2 when you also have BC3? just return black for now.
        return decompressBC({ type: 'BC2', flag: 'SRGB', width, height, pixels, depth: 1 });
    case TextureFormat.DXT5:
        return decompressBC({ type: 'BC3', flag: 'SRGB', width, height, pixels, depth: 1 });
    default:
        console.error("Unknown texture format", format);
        return { type: 'RGBA', flag: 'SRGB', width, height, depth: 1, pixels: new Uint8Array(width * height * 4) };
    }
}

export class PsychonautsTextureHolder extends TextureHolder<PPAK_Texture> {
    private ppakTextures: PPAK_Texture[] = [];

    public findPPAKTexture(name: string): PPAK_Texture {
        return assertExists(this.ppakTextures.find((t) => t.name === name));
    }

    public loadTexture(device: GfxDevice, texture: PPAK_Texture): LoadedTexture | null {
        if (texture.mipData.length === 0)
            return null;

        const levelDatas: Uint8Array[] = [];
        const surfaces: HTMLCanvasElement[] = [];

        let mipWidth = texture.width, mipHeight = texture.height;
        for (let i = 0; i < texture.mipData.length; i++) {
            const pixels = texture.mipData[i].createTypedArray(Uint8Array);
            const decodedSurface = decodeTextureData(texture.format, mipWidth, mipHeight, pixels);
            levelDatas.push(decodedSurface.pixels as Uint8Array);

            const canvas = document.createElement('canvas');
            surfaceToCanvas(canvas, decodedSurface);
            surfaces.push(canvas);

            if (mipWidth > 1) mipWidth >>>= 1;
            if (mipHeight > 1) mipHeight >>>= 1;
        }

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, texture.mipData.length));
        device.uploadTextureData(gfxTexture, 0, levelDatas);

        const extraInfo = new Map<string, string>();
        extraInfo.set('Format', getTextureFormatName(texture.format));
        const displayName = texture.name.split('/').pop()!;
        const viewerTexture: Viewer.Texture = { name: displayName, surfaces, extraInfo };
        device.setResourceName(gfxTexture, displayName);

        this.ppakTextures.push(texture);

        return { gfxTexture, viewerTexture };
    }
}

class PsychonautsProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord0 = 2;
    public static a_TexCoord1 = 3;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    public override both = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_MeshFragParams {
    Mat4x3 u_BoneMatrix[1];
    vec4 u_MaterialColor;
    vec4 u_TexCoordOffs;
};

uniform sampler2D u_Texture;
uniform sampler2D u_TextureDetail;
uniform sampler2D u_TextureLightmap;

varying vec4 v_Color;
varying vec4 v_TexCoord;

#ifdef VERT
layout(location = ${PsychonautsProgram.a_Position}) in vec3 a_Position;
layout(location = ${PsychonautsProgram.a_Color}) in vec4 a_Color;
layout(location = ${PsychonautsProgram.a_TexCoord0}) in vec2 a_TexCoord0;
layout(location = ${PsychonautsProgram.a_TexCoord1}) in vec2 a_TexCoord1;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Color = a_Color;
    v_TexCoord.xy = a_TexCoord0 + u_TexCoordOffs.xy;
    v_TexCoord.zw = a_TexCoord1;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE
    t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord.xy);
#endif

#ifdef USE_LIGHTMAP
    t_Color.rgb *= texture(SAMPLER_2D(u_TextureLightmap), v_TexCoord.zw).rgb;
#endif

#ifdef USE_VERTEX_COLOR
    // TODO(jstpierre): How is the vertex color buffer used?
    t_Color.rgb *= clamp(v_Color.rgb * 4.0, 0.0, 1.0);
    t_Color.a *= v_Color.a;
#endif

#ifdef USE_ALPHA_TEST
    // TODO(jstpierre): Configurable alpha ref?
    if (t_Color.a < 0.5)
        discard;
#endif

    gl_FragColor = t_Color;
}
#endif
`;
}

function decodeStreamUV(buffer: ArrayBufferSlice, iVertCount: number, streamUVCount: number, uvCoordScale: number): Float32Array {
    const view = buffer.createDataView();
    const dst = new Float32Array(2 * streamUVCount * iVertCount);
    let dstIdx = 0;
    let srcOffs = 0;
    for (let i = 0; i < iVertCount; i++) {
        for (let j = 0; j < streamUVCount; j++) {
            dst[dstIdx++] = view.getInt16(srcOffs + 0x00, true) / 0x7FFF * uvCoordScale;
            dst[dstIdx++] = view.getInt16(srcOffs + 0x02, true) / 0x7FFF * uvCoordScale;
            srcOffs += 0x04;
        }
    }
    return dst;
}

class MeshFragData {
    private posNrmBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer | null;
    private uvBuffer: GfxBuffer | null;
    private idxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(device: GfxDevice, public meshFrag: EMeshFrag) {
        this.posNrmBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, meshFrag.streamPosNrm);
        this.colorBuffer = meshFrag.streamColor ? makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, meshFrag.streamColor) : null;

        if (meshFrag.streamUVCount > 0) {
            const uvData = decodeStreamUV(meshFrag.streamUV!, meshFrag.iVertCount, meshFrag.streamUVCount, meshFrag.uvCoordScale);
            this.uvBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, uvData.buffer);
        } else {
            this.uvBuffer = null;
        }

        const numIndexes = meshFrag.streamIdx.byteLength / 2;
        const triIdxData = convertToTriangleIndexBuffer(meshFrag.topology, meshFrag.streamIdx.createTypedArray(Uint16Array, 0, numIndexes));
        const idxData = filterDegenerateTriangleIndexBuffer(triIdxData);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PsychonautsProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
            { location: PsychonautsProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
            { location: PsychonautsProgram.a_TexCoord0, bufferIndex: 2, bufferByteOffset: 0x00, format: GfxFormat.F32_RG },
            { location: PsychonautsProgram.a_TexCoord1, bufferIndex: 2, bufferByteOffset: 0x08 * (meshFrag.streamUVCount - 1), format: GfxFormat.F32_RG },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x10, frequency: GfxVertexBufferFrequency.PerVertex, },
            this.colorBuffer ? { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex } : null,
            this.uvBuffer    ? { byteStride: 0x08 * meshFrag.streamUVCount, frequency: GfxVertexBufferFrequency.PerVertex } : null,
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: (GfxVertexBufferDescriptor | null)[] = [
            { buffer: this.posNrmBuffer, byteOffset: 0 },
            this.colorBuffer ? { buffer: this.colorBuffer, byteOffset: 0, } : null,
            this.uvBuffer    ? { buffer: this.uvBuffer, byteOffset: 0, } : null,
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posNrmBuffer);
        if (this.colorBuffer !== null)
            device.destroyBuffer(this.colorBuffer);
        if (this.uvBuffer !== null)
            device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class MeshData {
    public meshFragData: MeshFragData[] = [];
    public submeshData: MeshData[] = [];

    constructor(device: GfxDevice, public mesh: EMesh) {
        for (let i = 0; i < this.mesh.meshFrag.length; i++)
            this.meshFragData[i] = new MeshFragData(device, this.mesh.meshFrag[i]);
        for (let i = 0; i < this.mesh.submesh.length; i++)
            this.submeshData[i] = new MeshData(device, this.mesh.submesh[i]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshFragData.length; i++)
            this.meshFragData[i].destroy(device);
        for (let i = 0; i < this.submeshData.length; i++)
            this.submeshData[i].destroy(device);
    }
}

class DomainData {
    public meshData: MeshData[] = [];
    public subdomainData: DomainData[] = [];

    constructor(device: GfxDevice, public domain: EDomain) {
        for (let i = 0; i < domain.meshes.length; i++)
            this.meshData[i] = new MeshData(device, domain.meshes[i]);
        for (let i = 0; i < domain.subdomains.length; i++)
            this.subdomainData[i] = new DomainData(device, domain.subdomains[i]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshData.length; i++)
            this.meshData[i].destroy(device);
        for (let i = 0; i < this.subdomainData.length; i++)
            this.subdomainData[i].destroy(device);
    }
}

const scratchMat4 = mat4.create();
const scratchAABB = new AABB();
class MeshFragInstance {
    private gfxProgram: GfxProgram | null = null;
    private program: PsychonautsProgram;
    private textureMapping = nArray(3, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor> = {};
    private sortKey: number = 0;
    private visible = true;

    constructor(cache: GfxRenderCache, scene: EScene, textureHolder: PsychonautsTextureHolder, public meshFragData: MeshFragData) {
        this.program = new PsychonautsProgram();

        const meshFrag = this.meshFragData.meshFrag;

        const gfxSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        const fillTextureReference = (dst: TextureMapping, textureId: number) => {
            const textureReference = scene.textureReferences[textureId];

            if (textureHolder.hasTexture(textureReference.textureName)) {
                textureHolder.fillTextureMapping(dst, textureReference.textureName);
            } else {
                dst.gfxTexture = null;
            }

            dst.gfxSampler = gfxSampler;
        };

        if (meshFrag.textureIds.length >= 1) {
            this.program.setDefineBool('USE_TEXTURE', true);
            fillTextureReference(this.textureMapping[0], meshFrag.textureIds[0]);
        }

        if (meshFrag.textureLightmap !== null) {
            this.program.setDefineBool('USE_LIGHTMAP', true);
            fillTextureReference(this.textureMapping[2], meshFrag.textureLightmap);
        }

        let useAlphaTest: boolean;
        if (!!(meshFrag.materialFlags & MaterialFlags.AdditiveBlended)) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            setAttachmentStateSimple(this.megaState, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.One,
            });
            useAlphaTest = false;
        } else if (!!(meshFrag.materialFlags & MaterialFlags.Alpha)) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            setAttachmentStateSimple(this.megaState, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            useAlphaTest = false;
        } else {
            this.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
            useAlphaTest = true;
        }

        if (!!(meshFrag.materialFlags & MaterialFlags.Decal))
            this.megaState.polygonOffset = true;

        this.megaState.frontFace = GfxFrontFaceMode.CW;
        if (!!(meshFrag.materialFlags & MaterialFlags.DoubleSided))
            this.megaState.cullMode = GfxCullMode.None;
        else
            this.megaState.cullMode = GfxCullMode.Back;

        if (meshFrag.streamColor !== null)
            this.program.setDefineBool('USE_VERTEX_COLOR', true);

        // TODO(jstpierre): Some way of determining whether to use alpha test?
        this.program.setDefineBool('USE_ALPHA_TEST', useAlphaTest);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: ReadonlyMat4, viewerInput: Viewer.ViewerRenderInput) {
        if (!this.visible)
            return;

        const meshFrag = this.meshFragData.meshFrag;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.meshFragData.inputLayout, this.meshFragData.inputState);
        renderInst.drawIndexes(this.meshFragData.indexCount);

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(this.megaState);

        renderInst.sortKey = this.sortKey;
        scratchAABB.transform(meshFrag.bbox, modelMatrix);
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, scratchAABB);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        let offs = renderInst.allocateUniformBuffer(PsychonautsProgram.ub_MeshFragParams, 20);
        const d = renderInst.mapUniformBufferF32(PsychonautsProgram.ub_MeshFragParams);
        mat4.mul(scratchMat4, viewerInput.camera.viewMatrix, modelMatrix);
        offs += fillMatrix4x3(d, offs, scratchMat4);

        offs += fillVec4v(d, offs, meshFrag.materialColor);
        
        const time = viewerInput.time / 4000;
        const texCoordTransVel = meshFrag.texCoordTransVel;
        const texCoordTransX = texCoordTransVel[0] * time;
        const texCoordTransY = texCoordTransVel[1] * time;
        offs += fillVec4(d, offs, texCoordTransX, texCoordTransY);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}

class MeshInstance {
    private meshFragInstance: MeshFragInstance[] = [];
    private submeshInstance: MeshInstance[] = [];
    public modelMatrix = mat4.create();
    private visible = true;

    constructor(cache: GfxRenderCache, scene: EScene, textureHolder: PsychonautsTextureHolder, public meshData: MeshData) {
        for (let i = 0; i < this.meshData.meshFragData.length; i++)
            this.meshFragInstance[i] = new MeshFragInstance(cache, scene, textureHolder, this.meshData.meshFragData[i])
        for (let i = 0; i < this.meshData.submeshData.length; i++)
            this.submeshInstance[i] = new MeshInstance(cache, scene, textureHolder, this.meshData.submeshData[i]);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.meshFragInstance.length; i++)
            this.meshFragInstance[i].prepareToRender(device, renderInstManager, this.modelMatrix, viewerInput);
        for (let i = 0; i < this.submeshInstance.length; i++)
            this.submeshInstance[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshFragInstance.length; i++)
            this.meshFragInstance[i].destroy(device);
        for (let i = 0; i < this.submeshInstance.length; i++)
            this.submeshInstance[i].destroy(device);
    }
}

class DomainInstance {
    public meshInstance: MeshInstance[] = [];
    public subdomainInstance: DomainInstance[] = [];
    private visible = true;

    constructor(cache: GfxRenderCache, scene: EScene, textureHolder: PsychonautsTextureHolder, public domainData: DomainData) {
        for (let i = 0; i < this.domainData.meshData.length; i++)
            this.meshInstance[i] = new MeshInstance(cache, scene, textureHolder, this.domainData.meshData[i]);
        for (let i = 0; i < this.domainData.subdomainData.length; i++)
            this.subdomainInstance[i] = new DomainInstance(cache, scene, textureHolder, this.domainData.subdomainData[i]);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.meshInstance.length; i++)
            this.meshInstance[i].prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.subdomainInstance.length; i++)
            this.subdomainInstance[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshInstance.length; i++)
            this.meshInstance[i].destroy(device);
        for (let i = 0; i < this.subdomainInstance.length; i++)
            this.subdomainInstance[i].destroy(device);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 3 },
];
export class SceneRenderer {
    private domainData: DomainData;
    private domainInstance: DomainInstance;

    constructor(cache: GfxRenderCache, textureHolder: PsychonautsTextureHolder, public scene: EScene) {
        this.domainData = new DomainData(cache.device, this.scene.domain);
        this.domainInstance = new DomainInstance(cache, scene, textureHolder, this.domainData);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(PsychonautsProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(PsychonautsProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        this.domainInstance.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.domainInstance.destroy(device);
        this.domainData.destroy(device);
    }
}

export class PsychonautsRenderer {
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;

    public textureHolder = new PsychonautsTextureHolder();
    public sceneRenderers: SceneRenderer[] = [];

    private renderHelper: GfxRenderHelper;

    public cache: GfxRenderCache;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
        this.cache = this.renderHelper.renderCache;
    }

    public addSceneRenderer(sceneRenderer: SceneRenderer): void {
        this.sceneRenderers.push(sceneRenderer);
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearRenderPassDescriptor);

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

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].destroy(device);
    }
}
