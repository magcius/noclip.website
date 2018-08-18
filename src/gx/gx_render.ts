
// Common helpers for GX rendering.

import { mat4, mat2d } from 'gl-matrix';

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from '../viewer';

import { RenderState } from '../render';
import { assert, nArray } from '../util';
import { LoadedVertexData, LoadedVertexLayout, AttributeFormat } from './gx_displaylist';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { TextureMapping, TextureHolder } from '../TextureHolder';

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

function fillVec4(d: Float32Array, offs: number, v0: number, v1: number = 0, v2: number = 0, v3: number = 0): number {
    d[offs + 0] = v0;
    d[offs + 1] = v1;
    d[offs + 2] = v2;
    d[offs + 3] = v3;
    return 4;
}

function fillColor(d: Float32Array, offs: number, c: GX_Material.Color): number {
    d[offs + 0] = c.r;
    d[offs + 1] = c.g;
    d[offs + 2] = c.b;
    d[offs + 3] = c.a;
    return 4;
}

// All of our matrices are row-major.
function fillMatrix4x4(d: Float32Array, offs: number, m: mat4): number {
    d[offs +  0] = m[0];
    d[offs +  1] = m[4];
    d[offs +  2] = m[8];
    d[offs +  3] = m[12];
    d[offs +  4] = m[1];
    d[offs +  5] = m[5];
    d[offs +  6] = m[9];
    d[offs +  7] = m[13];
    d[offs +  8] = m[2];
    d[offs +  9] = m[6];
    d[offs + 10] = m[10];
    d[offs + 11] = m[14];
    d[offs + 12] = m[3];
    d[offs + 13] = m[7];
    d[offs + 14] = m[11];
    d[offs + 15] = m[15];
    return 4*4;
}

function fillMatrix4x3(d: Float32Array, offs: number, m: mat4): number {
    d[offs +  0] = m[0];
    d[offs +  1] = m[4];
    d[offs +  2] = m[8];
    d[offs +  3] = m[12];
    d[offs +  4] = m[1];
    d[offs +  5] = m[5];
    d[offs +  6] = m[9];
    d[offs +  7] = m[13];
    d[offs +  8] = m[2];
    d[offs +  9] = m[6];
    d[offs + 10] = m[10];
    d[offs + 11] = m[14];
    return 4*3;
}

function fillMatrix3x2(d: Float32Array, offs: number, m: mat2d): number {
    // 3x2 matrices are actually sent across as 4x2.
    const ma = m[0], mb = m[1];
    const mc = m[2], md = m[3];
    const mx = m[4], my = m[5];
    d[offs + 0] = ma;
    d[offs + 1] = mc;
    d[offs + 2] = mx;
    d[offs + 3] = 0;
    d[offs + 4] = mb;
    d[offs + 5] = md;
    d[offs + 6] = my;
    d[offs + 7] = 0;
    return 4*2;
}

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

export class GXRenderHelper {
    public bufferDataScratch = new Float32Array(bufferDataScratchSize);

    public sceneParamsBuffer: WebGLBuffer;
    public materialParamsBuffer: WebGLBuffer;
    public packetParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext) {
        this.sceneParamsBuffer = gl.createBuffer();
        this.materialParamsBuffer = gl.createBuffer();
        this.packetParamsBuffer = gl.createBuffer();
    }

    public bindSceneParams(state: RenderState, params: SceneParams): void {
        const gl = state.gl;
        fillSceneParamsData(this.bufferDataScratch, params);
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, this.bufferDataScratch, gl.DYNAMIC_DRAW);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindMaterialParams(state: RenderState, params: MaterialParams): void {
        const gl = state.gl;
        fillMaterialParamsData(this.bufferDataScratch, params);
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.materialParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, this.bufferDataScratch, gl.DYNAMIC_DRAW);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindPacketParams(state: RenderState, params: PacketParams): void {
        const gl = state.gl;
        fillPacketParamsData(this.bufferDataScratch, params);
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.packetParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, this.bufferDataScratch, gl.DYNAMIC_DRAW);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindMaterialTextureMapping(state: RenderState, textureMapping: TextureMapping[], prog: GX_Material.GX_Program): void {
        const gl = state.gl;
        assert(prog === state.currentProgram);
        for (let i = 0; i < 8; i++) {
            const m = textureMapping[i];
            if (m.glTexture === null)
                continue;

            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, m.glTexture);
            gl.bindSampler(i, m.glSampler);
            state.renderStatisticsTracker.textureBindCount++;
        }
        prog.bindTextureSamplerIdentities(gl);
    }

    public bindMaterialTextures(state: RenderState, materialParams: MaterialParams, prog: GX_Material.GX_Program): void {
        this.bindMaterialTextureMapping(state, materialParams.m_TextureMapping, prog);
    }

    public bindUniformBuffers(state: RenderState): void {
        const gl = state.gl;
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_SceneParams, this.sceneParamsBuffer);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_MaterialParams, this.materialParamsBuffer);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_PacketParams, this.packetParamsBuffer);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        gl.deleteBuffer(this.packetParamsBuffer);
        gl.deleteBuffer(this.materialParamsBuffer);
        gl.deleteBuffer(this.sceneParamsBuffer);
    }
}

function translateAttribType(gl: WebGL2RenderingContext, attribFormat: AttributeFormat): { type: GLenum, normalized: boolean } {
    switch (attribFormat) {
    case AttributeFormat.U8:
        return { type: gl.UNSIGNED_BYTE, normalized: false };
    case AttributeFormat.U16:
        return { type: gl.UNSIGNED_SHORT, normalized: false };
    case AttributeFormat.F32:
        return { type: gl.FLOAT, normalized: false };
    default:
        throw "whoops";
    }
}

export class GXShapeHelper {
    public vao: WebGLVertexArrayObject;

    constructor(gl: WebGL2RenderingContext, public coalescedBuffers: CoalescedBuffers, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData) {
        assert(this.loadedVertexData.indexFormat === AttributeFormat.U16);

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
                const { type, normalized } = translateAttribType(gl, attrib.format);

                const stride = this.loadedVertexLayout.dstVertexSize;
                const offset = coalescedBuffers.vertexBuffer.offset + attrib.offset;

                gl.enableVertexAttribArray(attribLocation);
                switch (attribGenDef.storage) {
                case GX_Material.UniformStorage.UINT:
                    gl.vertexAttribIPointer(attribLocation, attrib.componentCount, type, stride, offset);
                    break;
                case GX_Material.UniformStorage.VEC2:
                case GX_Material.UniformStorage.VEC3:
                case GX_Material.UniformStorage.VEC4:
                    gl.vertexAttribPointer(attribLocation, attrib.componentCount, type, normalized, stride, offset);
                    break;
                }
            } else {
                // Set default.
                switch (attribGenDef.storage) {
                case GX_Material.UniformStorage.UINT:
                    gl.vertexAttribI4ui(attribLocation, 0, 0, 0, 0);
                    break;
                case GX_Material.UniformStorage.VEC2:
                case GX_Material.UniformStorage.VEC3:
                case GX_Material.UniformStorage.VEC3:
                    // Float defaults don't need to be initialized in GLES.
                    break;
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

export interface LoadedTexture {
    glTexture: WebGLTexture;
    viewerTexture: Viewer.Texture;
}

export function loadTextureFromMipChain(gl: WebGL2RenderingContext, mipChain: GX_Texture.MipChain): LoadedTexture {
    const glTexture = gl.createTexture();
    (<any> glTexture).name = mipChain.name;
    gl.bindTexture(gl.TEXTURE_2D, glTexture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, mipChain.mipLevels.length - 1);

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
            gl.bindTexture(gl.TEXTURE_2D, glTexture);
            gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA8, mipLevel.width, mipLevel.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbaTexture.pixels);

            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(mipLevel.width, mipLevel.height);
            imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
            ctx.putImageData(imgData, 0, 0);
        });
    }

    const viewerExtraInfo = new Map<string, string>();
    const firstMipLevel = mipChain.mipLevels[0];
    viewerExtraInfo.set("Format", GX_Texture.getFormatName(firstMipLevel.format, firstMipLevel.paletteFormat));

    const viewerTexture: Viewer.Texture = { name: mipChain.name, surfaces, extraInfo: viewerExtraInfo };
    return { glTexture, viewerTexture };
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
