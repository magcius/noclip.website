
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { PPAK_Texture, TextureFormat, getTextureFormatName } from "./ppf";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxProgram, GfxHostAccessPass, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { decompressBC, DecodedSurfaceSW, surfaceToCanvas } from "../fres/bc_texture";
import { EMeshFrag, EMesh, EScene, EDomain } from "./plb";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram, DeviceProgramReflection } from "../Program";

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
        return this.ppakTextures.find((t) => t.name === name);
    }

    public addTextureGfx(device: GfxDevice, texture: PPAK_Texture): LoadedTexture | null {
        if (texture.mipData.length === 0)
            return null;

        const levelDatas: Uint8Array[] = [];
        const surfaces: HTMLCanvasElement[] = [];

        let mipWidth = texture.width, mipHeight = texture.height;
        for (let i = 0; i < texture.mipData.length; i++) {
            const pixels = texture.mipData[i].copyToSlice().createTypedArray(Uint8Array);
            const decodedSurface = decodeTextureData(texture.format, mipWidth, mipHeight, pixels);
            levelDatas.push(decodedSurface.pixels as Uint8Array);

            const canvas = document.createElement('canvas');
            surfaceToCanvas(canvas, decodedSurface, 0);
            surfaces.push(canvas);

            if (mipWidth > 1) mipWidth >>>= 1;
            if (mipHeight > 1) mipHeight >>>= 1;
        }

        const gfxTexture = device.createTexture(GfxFormat.U8_RGBA, texture.width, texture.height, texture.mipData.length);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, levelDatas);
        device.submitPass(hostAccessPass);

        const extraInfo = new Map<string, string>();
        extraInfo.set('Format', getTextureFormatName(texture.format));
        const displayName = texture.name.split('/').pop();
        const viewerTexture: Viewer.Texture = { name: displayName, surfaces, extraInfo };

        this.ppakTextures.push(texture);

        return { gfxTexture, viewerTexture };
    }
}

// @ts-ignore
import { readFileSync } from 'fs';
import { convertToTriangleIndexBuffer, filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { GfxRenderInstBuilder, GfxRenderInst, GfxRenderInstViewRenderer } from "../gfx/render/GfxRenderer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4 } from "gl-matrix";
import { computeViewMatrix, Camera } from "../Camera";
import { BasicRendererHelper } from "../oot3d/render";
import ArrayBufferSlice from "../ArrayBufferSlice";

class PsychonautsProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    private static program = readFileSync('src/psychonauts/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(PsychonautsProgram.program);
    public both = PsychonautsProgram.program;
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
    private inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(device: GfxDevice, public meshFrag: EMeshFrag) {
        this.posNrmBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, meshFrag.streamPosNrm.castToBuffer());
        this.colorBuffer = meshFrag.streamColor ? makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, meshFrag.streamColor.castToBuffer()) : null;

        if (meshFrag.streamUVCount > 0) {
            const uvData = decodeStreamUV(meshFrag.streamUV, meshFrag.iVertCount, meshFrag.streamUVCount, meshFrag.uvCoordScale);
            this.uvBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, uvData.buffer);
        } else {
            this.uvBuffer = null;
        }

        const numIndexes = meshFrag.streamIdx.byteLength / 2;
        const triIdxData = convertToTriangleIndexBuffer(meshFrag.topology, meshFrag.streamIdx.createTypedArray(Uint16Array, 0, numIndexes));
        const idxData = filterDegenerateTriangleIndexBuffer(triIdxData);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PsychonautsProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: PsychonautsProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: PsychonautsProgram.a_TexCoord, bufferIndex: 2, bufferByteOffset: 0, format: GfxFormat.F32_RG, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.posNrmBuffer, byteStride: 0x10, byteOffset: 0 },
            this.colorBuffer ? { buffer: this.colorBuffer, byteStride: 0x04, byteOffset: 0 } : null,
            this.uvBuffer    ? { buffer: this.uvBuffer, byteStride: 0x08 * meshFrag.streamUVCount, byteOffset: 0 } : null,
        ];
        const idxBuffer: GfxVertexBufferDescriptor = { buffer: this.idxBuffer, byteStride: 0, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posNrmBuffer);
        device.destroyBuffer(this.colorBuffer);
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
class MeshFragInstance {
    public renderInst: GfxRenderInst;
    private gfxSamplers: GfxSampler[] = [];

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, scene: EScene, textureHolder: PsychonautsTextureHolder, public meshFragData: MeshFragData) {
        this.renderInst = renderInstBuilder.pushRenderInst();
        this.renderInst.inputState = this.meshFragData.inputState;
        // TODO(jstpierre): Which render flags to use?
        renderInstBuilder.newUniformBufferInstance(this.renderInst, PsychonautsProgram.ub_MeshFragParams);
        this.renderInst.drawIndexes(this.meshFragData.indexCount, 0);

        const textureMapping = new TextureMapping();

        const program = new PsychonautsProgram();

        if (meshFragData.meshFrag.textureIds.length >= 1) {
            program.defines.set('USE_TEXTURE', '1');

            const textureId = meshFragData.meshFrag.textureIds[0];
            const textureReference = scene.textureReferences[textureId];
            textureHolder.fillTextureMapping(textureMapping, textureReference.textureName);
            const ppakTexture = textureHolder.findPPAKTexture(textureReference.textureName);

            const gfxSampler = device.createSampler({
                magFilter: GfxTexFilterMode.BILINEAR,
                minFilter: GfxTexFilterMode.BILINEAR,
                mipFilter: GfxMipFilterMode.LINEAR,
                minLOD: 0,
                maxLOD: ppakTexture.mipData.length,
                wrapS: GfxWrapMode.REPEAT,
                wrapT: GfxWrapMode.REPEAT,
            });
            this.gfxSamplers.push(gfxSampler);

            textureMapping.gfxSampler = gfxSampler;
        }

        if (this.meshFragData.meshFrag.streamColor !== null) {
            program.defines.set('USE_VERTEX_COLOR', '1');
        }

        this.renderInst.gfxProgram = device.createProgram(program);

        this.renderInst.setSamplerBindingsFromTextureMappings([textureMapping]);
    }

    private computeModelMatrix(camera: Camera, modelMatrix: mat4): mat4 {
        computeViewMatrix(scratchMat4, camera);
        mat4.mul(scratchMat4, scratchMat4, modelMatrix);
        return scratchMat4;
    }

    public prepareToRender(meshFragParamsBuffer: GfxRenderBuffer, modelMatrix: mat4, visible: boolean, viewRenderer: Viewer.ViewerRenderInput) {
        this.renderInst.visible = visible;

        if (this.renderInst.visible) {
            let offs = this.renderInst.getUniformBufferOffset(PsychonautsProgram.ub_MeshFragParams);
            const mapped = meshFragParamsBuffer.mapBufferF32(offs, 12);
            fillMatrix4x3(mapped, offs, this.computeModelMatrix(viewRenderer.camera, modelMatrix));
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.renderInst.gfxProgram);
        for (let i = 0; i < this.gfxSamplers.length; i++)
            device.destroySampler(this.gfxSamplers[i]);
    }
}

class MeshInstance {
    private meshFragInstance: MeshFragInstance[] = [];
    private submeshInstance: MeshInstance[] = [];
    public modelMatrix = mat4.create();

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, scene: EScene, textureHolder: PsychonautsTextureHolder, public meshData: MeshData) {
        for (let i = 0; i < this.meshData.meshFragData.length; i++)
            this.meshFragInstance[i] = new MeshFragInstance(device, renderInstBuilder, scene, textureHolder, this.meshData.meshFragData[i])
        for (let i = 0; i < this.meshData.submeshData.length; i++)
            this.submeshInstance[i] = new MeshInstance(device, renderInstBuilder, scene, textureHolder, this.meshData.submeshData[i]);
    }

    public prepareToRender(meshFragParamsBuffer: GfxRenderBuffer, visible: boolean, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.meshFragInstance.length; i++)
            this.meshFragInstance[i].prepareToRender(meshFragParamsBuffer, this.modelMatrix, visible, viewerInput);
        for (let i = 0; i < this.submeshInstance.length; i++)
            this.submeshInstance[i].prepareToRender(meshFragParamsBuffer, visible, viewerInput);
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

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, scene: EScene, textureHolder: PsychonautsTextureHolder, public domainData: DomainData) {
        for (let i = 0; i < this.domainData.meshData.length; i++)
            this.meshInstance[i] = new MeshInstance(device, renderInstBuilder, scene, textureHolder, this.domainData.meshData[i]);
        for (let i = 0; i < this.domainData.subdomainData.length; i++)
            this.subdomainInstance[i] = new DomainInstance(device, renderInstBuilder, scene, textureHolder, this.domainData.subdomainData[i]);
    }

    public prepareToRender(meshFragParamsBuffer: GfxRenderBuffer, visible: boolean, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.meshInstance.length; i++)
            this.meshInstance[i].prepareToRender(meshFragParamsBuffer, visible, viewerInput);
        for (let i = 0; i < this.subdomainInstance.length; i++)
            this.subdomainInstance[i].prepareToRender(meshFragParamsBuffer, visible, viewerInput);
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

export class SceneRenderer {
    private sceneParamsBuffer: GfxRenderBuffer;
    private meshFragParamsBuffer: GfxRenderBuffer;
    private renderInstBuilder: GfxRenderInstBuilder;
    private templateRenderInst: GfxRenderInst;
    private domainData: DomainData;
    private domainInstance: DomainInstance;

    constructor(device: GfxDevice, textureHolder: PsychonautsTextureHolder, public scene: EScene) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.meshFragParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MeshFragParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 1 }, // Shape
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.meshFragParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, PsychonautsProgram.programReflection, bindingLayouts, uniformBuffers);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, PsychonautsProgram.ub_SceneParams);

        this.domainData = new DomainData(device, this.scene.domain);
        this.domainInstance = new DomainInstance(device, this.renderInstBuilder, scene, textureHolder, this.domainData);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(this.templateRenderInst.uniformBufferOffsets[PsychonautsProgram.ub_SceneParams], 16);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, this.templateRenderInst.uniformBufferOffsets[PsychonautsProgram.ub_SceneParams]);

        this.domainInstance.prepareToRender(this.meshFragParamsBuffer, true, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.meshFragParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.meshFragParamsBuffer.destroy(device);
        this.domainInstance.destroy(device);
        this.domainData.destroy(device);
    }
}

export class PsychonautsRenderer extends BasicRendererHelper implements Viewer.SceneGfx {
    public textureHolder = new PsychonautsTextureHolder();
    private sceneRenderers: SceneRenderer[] = [];

    public addSceneRenderer(device: GfxDevice, sceneRenderer: SceneRenderer): void {
        this.sceneRenderers.push(sceneRenderer);
        sceneRenderer.addToViewRenderer(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroyGfx(device);
    }
}
