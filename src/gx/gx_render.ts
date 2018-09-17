
// Common helpers for GX rendering.

import { mat4, mat2d } from 'gl-matrix';

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from '../viewer';

import { RenderState } from '../render';
import { assert, nArray } from '../util';
import { LoadedVertexData, LoadedVertexLayout } from './gx_displaylist';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { TextureMapping, TextureHolder, LoadedTexture, getGLTextureFromMapping, getGLSamplerFromMapping } from '../TextureHolder';
import { fillColor, fillMatrix4x3, fillMatrix3x2, fillVec4, fillMatrix4x4 } from '../gfx/helpers/BufferHelpers';
import { GfxFormat, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint } from '../gfx/platform/GfxPlatform';
import { getFormatTypeFlags, FormatTypeFlags } from '../gfx/platform/GfxPlatformFormat';
import { translateVertexFormat, getTransitionDeviceForWebGL2, getPlatformBuffer } from '../gfx/platform/GfxPlatformWebGL2';

export enum ColorKind {
    MAT0, MAT1, AMB0, AMB1,
    K0, K1, K2, K3,
    CPREV, C0, C1, C2,
    COUNT,
}

export class SceneParams {
    public u_Projection: mat4 = mat4.create();
    // u_Misc0[0]
    public u_SceneTextureLODBias: number = 0;
}

export class MaterialParams {
    public m_TextureMapping: TextureMapping[] = nArray(8, () => new TextureMapping());
    public u_Color: GX_Material.Color[] = nArray(ColorKind.COUNT, () => new GX_Material.Color());
    public u_TexMtx: mat4[] = nArray(10, () => mat4.create());     // mat4x3
    public u_PostTexMtx: mat4[] = nArray(20, () => mat4.create()); // mat4x3
    public u_IndTexMtx: mat2d[] = nArray(3, () => mat2d.create()); // mat4x2
}

export class PacketParams {
    public u_PosMtx: mat4[] = nArray(10, () => mat4.create());
}

export const u_PacketParamsBufferSize = 4*3*10;
export const u_MaterialParamsBufferSize = 4*2 + 4*2 + 4*4 + 4*4 + 4*3*10 + 4*3*20 + 4*2*3 + 4*8;
export const u_SceneParamsBufferSize = 4*4 + 4;

export function fillSceneParamsData(d: Float32Array, sceneParams: SceneParams): void {
    let offs = 0;

    offs += fillMatrix4x4(d, offs, sceneParams.u_Projection);
    // u_Misc0
    offs += fillVec4(d, offs, sceneParams.u_SceneTextureLODBias);

    assert(offs === u_SceneParamsBufferSize);
    assert(d.length >= offs);
}

export function fillMaterialParamsData(d: Float32Array, materialParams: MaterialParams): void {
    // Texture mapping requires special effort.
    let offs = 0;

    for (let i = 0; i < 12; i++)
        offs += fillColor(d, offs, materialParams.u_Color[i]);
    for (let i = 0; i < 10; i++)
        offs += fillMatrix4x3(d, offs, materialParams.u_TexMtx[i]);
    for (let i = 0; i < 20; i++)
        offs += fillMatrix4x3(d, offs, materialParams.u_PostTexMtx[i]);
    for (let i = 0; i < 3; i++)
        offs += fillMatrix3x2(d, offs, materialParams.u_IndTexMtx[i]);
    for (let i = 0; i < 8; i++)
        offs += fillVec4(d, offs, materialParams.m_TextureMapping[i].width, materialParams.m_TextureMapping[i].height, 0, materialParams.m_TextureMapping[i].lodBias);

    assert(offs === u_MaterialParamsBufferSize);
    assert(d.length >= offs);
}

export function fillPacketParamsData(d: Float32Array, packetParams: PacketParams): void {
    let offs = 0;

    for (let i = 0; i < 10; i++)
        offs += fillMatrix4x3(d, offs, packetParams.u_PosMtx[i]);

    assert(offs === u_PacketParamsBufferSize);
    assert(d.length >= offs);
}

const bufferDataScratchSize = Math.max(u_PacketParamsBufferSize, u_MaterialParamsBufferSize, u_SceneParamsBufferSize);

// TODO(jstpierre): Remove.
export class GXRenderHelper {
    public bufferDataScratch = new Float32Array(bufferDataScratchSize);

    private sceneParamsBuffer: GfxBuffer;
    private materialParamsBuffer: GfxBuffer;
    private packetParamsBuffer: GfxBuffer;

    constructor(gl: WebGL2RenderingContext) {
        const device = getTransitionDeviceForWebGL2(gl);
        this.sceneParamsBuffer = device.createBuffer(u_SceneParamsBufferSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        this.materialParamsBuffer = device.createBuffer(u_MaterialParamsBufferSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        this.packetParamsBuffer = device.createBuffer(u_PacketParamsBufferSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
    }

    public bindSceneParams(state: RenderState, params: SceneParams): void {
        fillSceneParamsData(this.bufferDataScratch, params);
        const hostUploader = getTransitionDeviceForWebGL2(state.gl).createHostUploader();
        hostUploader.uploadBufferData(this.sceneParamsBuffer, 0, this.bufferDataScratch.buffer, 0, u_SceneParamsBufferSize);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindMaterialParams(state: RenderState, params: MaterialParams): void {
        // TODO(jstpierre): We can't have overlapping data like this in the newer explicit APIs.
        // We rely on the driver copying our buffer here... we're going to have to find something
        // better to do here, like preallocate a larger buffer which we can offset into...
        fillMaterialParamsData(this.bufferDataScratch, params);
        const hostUploader = getTransitionDeviceForWebGL2(state.gl).createHostUploader();
        hostUploader.uploadBufferData(this.materialParamsBuffer, 0, this.bufferDataScratch.buffer, 0, u_MaterialParamsBufferSize);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindPacketParams(state: RenderState, params: PacketParams): void {
        fillPacketParamsData(this.bufferDataScratch, params);
        const hostUploader = getTransitionDeviceForWebGL2(state.gl).createHostUploader();
        hostUploader.uploadBufferData(this.packetParamsBuffer, 0, this.bufferDataScratch.buffer, 0, u_PacketParamsBufferSize);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindMaterialTextureMapping(state: RenderState, textureMapping: TextureMapping[], prog: GX_Material.GX_Program): void {
        const gl = state.gl;
        assert(prog === state.currentProgram);
        for (let i = 0; i < 8; i++) {
            const m = textureMapping[i];
            const glTexture = getGLTextureFromMapping(m);
            if (glTexture === null)
                continue;

            const glSampler = getGLSamplerFromMapping(m);
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, glTexture);
            gl.bindSampler(i, glSampler);
            state.renderStatisticsTracker.textureBindCount++;
        }
    }

    public bindMaterialTextures(state: RenderState, materialParams: MaterialParams, prog: GX_Material.GX_Program): void {
        this.bindMaterialTextureMapping(state, materialParams.m_TextureMapping, prog);
    }

    public bindUniformBuffers(state: RenderState): void {
        const gl = state.gl;
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_SceneParams, getPlatformBuffer(this.sceneParamsBuffer));
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_MaterialParams, getPlatformBuffer(this.materialParamsBuffer));
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_PacketParams, getPlatformBuffer(this.packetParamsBuffer));
    }

    public destroy(gl: WebGL2RenderingContext): void {
        const device = getTransitionDeviceForWebGL2(gl);
        device.destroyBuffer(this.sceneParamsBuffer);
        device.destroyBuffer(this.materialParamsBuffer);
        device.destroyBuffer(this.packetParamsBuffer);
    }
}

export class GXShapeHelper {
    public vao: WebGLVertexArrayObject;

    constructor(gl: WebGL2RenderingContext, public coalescedBuffers: CoalescedBuffers, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData) {
        assert(this.loadedVertexData.indexFormat === GfxFormat.U16_R);

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, coalescedBuffers.vertexBuffer.buffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, coalescedBuffers.indexBuffer.buffer);

        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < GX.VertexAttribute.MAX; vtxAttrib++) {
            const attribLocation = GX_Material.getVertexAttribLocation(vtxAttrib);

            // TODO(jstpierre): Handle TEXMTXIDX attributes.
            if (attribLocation === -1)
                continue;

            const attribGenDef = GX_Material.getVertexAttribGenDef(vtxAttrib);
            const attrib = this.loadedVertexLayout.dstVertexAttributeLayouts.find((attrib) => attrib.vtxAttrib === vtxAttrib);
            if (attrib !== undefined) {
                const stride = this.loadedVertexLayout.dstVertexSize;
                const offset = coalescedBuffers.vertexBuffer.offset + attrib.offset;

                const { type, size, normalized } = translateVertexFormat(attribGenDef.format);

                gl.enableVertexAttribArray(attribLocation);
                if (type === gl.FLOAT) {
                    gl.vertexAttribPointer(attribLocation, size, type, normalized, stride, offset);
                } else {
                    gl.vertexAttribIPointer(attribLocation, size, type, stride, offset);
                }
            } else {
                if (getFormatTypeFlags(attribGenDef.format) !== FormatTypeFlags.F32) {
                    // TODO(jstpierre): Remove ghost buffer usage... replace with something saner.
                    gl.vertexAttribI4ui(attribLocation, 0, 0, 0, 0);
                }
            }
        }

        gl.bindVertexArray(null);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        gl.deleteVertexArray(this.vao);
    }

    public draw(state: RenderState, firstTriangle: number = 0, numTriangles: number = this.loadedVertexData.totalTriangleCount): void {
        const gl = state.gl;
        gl.bindVertexArray(this.vao);
        const firstVertex = firstTriangle * 3;
        const numVertices = numTriangles * 3;
        const indexType = gl.UNSIGNED_SHORT, indexByteSize = 2;
        const indexBufferOffset = this.coalescedBuffers.indexBuffer.offset + (firstVertex * indexByteSize);
        gl.drawElements(gl.TRIANGLES, numVertices, indexType, indexBufferOffset);
        gl.bindVertexArray(null);
        state.renderStatisticsTracker.drawCallCount++;
    }
}

// Mip levels in GX are assumed to be relative to the GameCube's embedded framebuffer (EFB) size,
// which is hardcoded to be 640x528. We need to bias our mipmap LOD selection by this amount to
// make sure textures are sampled correctly...
export function getTextureLODBias(state: RenderState): number {
    const viewportWidth = state.onscreenColorTarget.width;
    const viewportHeight = state.onscreenColorTarget.height;
    const textureLODBias = Math.log2(Math.min(viewportWidth / GX_Material.EFB_WIDTH, viewportHeight / GX_Material.EFB_HEIGHT));
    return textureLODBias;
}

export function fillSceneParamsFromRenderState(sceneParams: SceneParams, state: RenderState): void {
    mat4.copy(sceneParams.u_Projection, state.camera.projectionMatrix);
    sceneParams.u_SceneTextureLODBias = getTextureLODBias(state);
}

export function loadedDataCoalescer(gl: WebGL2RenderingContext, loadedVertexDatas: LoadedVertexData[]): BufferCoalescer {
    return new BufferCoalescer(gl,
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.packedVertexData)),
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.indexData))
    );
}

export function loadTextureFromMipChain(gl: WebGL2RenderingContext, mipChain: GX_Texture.MipChain): LoadedTexture {
    const device = getTransitionDeviceForWebGL2(gl);
    const firstMipLevel = mipChain.mipLevels[0];
    const gfxTexture = device.createTexture(GfxFormat.U8_RGBA, firstMipLevel.width, firstMipLevel.height, mipChain.mipLevels.length > 1, 1);
    device.setResourceName(gfxTexture, mipChain.name);

    const hostUploader = device.createHostUploader();
    const surfaces = [];
    for (let i = 0; i < mipChain.mipLevels.length; i++) {
        const level = i;
        const mipLevel = mipChain.mipLevels[i];

        const canvas = document.createElement('canvas');
        canvas.width = mipLevel.width;
        canvas.height = mipLevel.height;
        canvas.title = mipLevel.name;
        surfaces.push(canvas);

        GX_Texture.decodeTexture(mipLevel).then((rgbaTexture) => {
            hostUploader.uploadTextureData(gfxTexture, level, [rgbaTexture.pixels]);

            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(mipLevel.width, mipLevel.height);
            imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
            ctx.putImageData(imgData, 0, 0);
        });
    }
    device.destroyHostUploader(hostUploader);

    const viewerExtraInfo = new Map<string, string>();
    viewerExtraInfo.set("Format", GX_Texture.getFormatName(firstMipLevel.format, firstMipLevel.paletteFormat));

    const viewerTexture: Viewer.Texture = { name: mipChain.name, surfaces, extraInfo: viewerExtraInfo };
    return { gfxTexture, viewerTexture };
}

export function translateTexFilter(gl: WebGL2RenderingContext, texFilter: GX.TexFilter): GLenum {
    switch (texFilter) {
    case GX.TexFilter.LIN_MIP_NEAR:
        return gl.LINEAR_MIPMAP_NEAREST;
    case GX.TexFilter.LIN_MIP_LIN:
        return gl.LINEAR_MIPMAP_LINEAR;
    case GX.TexFilter.LINEAR:
        return gl.LINEAR;
    case GX.TexFilter.NEAR_MIP_NEAR:
        return gl.NEAREST_MIPMAP_NEAREST;
    case GX.TexFilter.NEAR_MIP_LIN:
        return gl.NEAREST_MIPMAP_LINEAR;
    case GX.TexFilter.NEAR:
        return gl.NEAREST;
    }
}

export function translateWrapMode(gl: WebGL2RenderingContext, wrapMode: GX.WrapMode): GLenum {
    switch (wrapMode) {
    case GX.WrapMode.CLAMP:
        return gl.CLAMP_TO_EDGE;
    case GX.WrapMode.MIRROR:
        return gl.MIRRORED_REPEAT;
    case GX.WrapMode.REPEAT:
        return gl.REPEAT;
    }
}

export class GXTextureHolder<TextureType extends GX_Texture.Texture = GX_Texture.Texture> extends TextureHolder<TextureType> {
    protected addTexture(gl: WebGL2RenderingContext, texture: TextureType): LoadedTexture | null {
        // Don't add textures without data.
        if (texture.data === null)
            return null;

        const mipChain = GX_Texture.calcMipChain(texture, texture.mipCount);
        return loadTextureFromMipChain(gl, mipChain);
    }
}
