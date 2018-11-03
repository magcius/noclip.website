
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
import { TextureMapping, TextureHolder, LoadedTexture, bindGLTextureMappings } from '../TextureHolder';

import { GfxBufferCoalescer, GfxCoalescedBuffers } from '../gfx/helpers/BufferHelpers';
import { fillColor, fillMatrix4x3, fillMatrix3x2, fillVec4, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxFormat, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxDevice, GfxInputState, GfxVertexAttributeDescriptor, GfxInputLayout, GfxVertexBufferDescriptor, GfxProgram, GfxBindingLayoutDescriptor, GfxProgramReflection, GfxHostAccessPass, GfxRenderPass, GfxBufferBinding, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from '../gfx/platform/GfxPlatform';
import { getFormatTypeFlags, FormatTypeFlags } from '../gfx/platform/GfxPlatformFormat';
import { translateVertexFormat, getTransitionDeviceForWebGL2, getPlatformBuffer } from '../gfx/platform/GfxPlatformWebGL2';
import { Camera } from '../Camera';
import { GfxRenderInstBuilder, GfxRenderInst } from '../gfx/render/GfxRenderer';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { RenderFlags } from '../gfx/helpers/RenderFlagsHelpers';

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

export const ub_SceneParams = 0;
export const ub_MaterialParams = 1;
export const ub_PacketParams = 2;

export const u_SceneParamsBufferSize = 4*4 + 4;
export const u_MaterialParamsBufferSize = 4*2 + 4*2 + 4*4 + 4*4 + 4*3*10 + 4*3*20 + 4*2*3 + 4*8;
export const u_PacketParamsBufferSize = 4*3*10;

export function fillSceneParamsData(d: Float32Array, sceneParams: SceneParams, bOffs: number = 0): void {
    let offs = bOffs;

    offs += fillMatrix4x4(d, offs, sceneParams.u_Projection);
    // u_Misc0
    offs += fillVec4(d, offs, sceneParams.u_SceneTextureLODBias);

    assert(offs === bOffs + u_SceneParamsBufferSize);
    assert(d.length >= offs);
}

export function fillMaterialParamsData(d: Float32Array, materialParams: MaterialParams, bOffs: number = 0): void {
    let offs = bOffs;

    // Texture mapping requires special effort.

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

    assert(offs === bOffs + u_MaterialParamsBufferSize);
    assert(d.length >= offs);
}

export function fillPacketParamsData(d: Float32Array, packetParams: PacketParams, bOffs: number = 0): void {
    let offs = bOffs;

    for (let i = 0; i < 10; i++)
        offs += fillMatrix4x3(d, offs, packetParams.u_PosMtx[i]);

    assert(offs === bOffs + u_PacketParamsBufferSize);
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
        const gl = state.gl;
        fillSceneParamsData(this.bufferDataScratch, params);
        gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.sceneParamsBuffer));
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.bufferDataScratch, 0, u_SceneParamsBufferSize);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindMaterialParams(state: RenderState, params: MaterialParams): void {
        const gl = state.gl;
        fillMaterialParamsData(this.bufferDataScratch, params);
        gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.materialParamsBuffer));
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.bufferDataScratch, 0, u_MaterialParamsBufferSize);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindPacketParams(state: RenderState, params: PacketParams): void {
        const gl = state.gl;
        fillPacketParamsData(this.bufferDataScratch, params);
        gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.packetParamsBuffer));
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.bufferDataScratch, 0, u_PacketParamsBufferSize);
        state.renderStatisticsTracker.bufferUploadCount++;
    }

    public bindMaterialTextures(state: RenderState, materialParams: MaterialParams): void {
        bindGLTextureMappings(state, materialParams.m_TextureMapping);
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

export class GXMaterialHelperGfx {
    public templateRenderInst: GfxRenderInst;
    public gfxProgram: GfxProgram;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, material: GX_Material.GXMaterial, materialHacks?: GX_Material.GXMaterialHacks) {
        this.templateRenderInst = renderHelper.renderInstBuilder.newRenderInst();
        // TODO(jstpierre): Cache on RenderHelper?
        const program = new GX_Material.GX_Program(material, materialHacks);
        this.templateRenderInst.gfxProgram = device.createProgram(program);
        GX_Material.translateRenderFlagsGfx(this.templateRenderInst.renderFlags, material);
        this.templateRenderInst.samplerBindings = nArray(8, () => null);
        renderHelper.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, ub_MaterialParams);
    }

    public fillMaterialParams(materialParams: MaterialParams, renderHelper: GXRenderHelperGfx): void {
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderHelper.fillMaterialParams(materialParams, this.templateRenderInst.uniformBufferOffsets[ub_MaterialParams]);
    }
}

export class GXShapeHelperGfx {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, public coalescedBuffers: GfxCoalescedBuffers, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData) {
        assert(this.loadedVertexData.indexFormat === GfxFormat.U16_R);

        // First, build the inputLayout
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < GX.VertexAttribute.MAX; vtxAttrib++) {
            const attribLocation = GX_Material.getVertexAttribLocation(vtxAttrib);

            // TODO(jstpierre): Handle TEXMTXIDX attributes.
            if (attribLocation === -1)
                continue;

            const attribGenDef = GX_Material.getVertexAttribGenDef(vtxAttrib);
            const attrib = this.loadedVertexLayout.dstVertexAttributeLayouts.find((attrib) => attrib.vtxAttrib === vtxAttrib);
            const format = attribGenDef.format;
            if (attrib !== undefined) {
                assert((attrib.offset & 3) === 0);
                const bufferWordOffset = attrib.offset / 4;
                vertexAttributeDescriptors.push({ location: attribLocation, format, bufferIndex: 0, bufferWordOffset });
            } else {
                // TODO(jstpierre): Emulate ghost buffer usage with divisor.
                vertexAttributeDescriptors.push({ location: attribLocation, format, bufferIndex: -1, bufferWordOffset: 0 });
            }
        }

        // TODO(jstpierre): Cache off input layouts? For a *lot* of shapes we're probably going to be 99% the same...
        this.inputLayout = device.createInputLayout(vertexAttributeDescriptors, this.loadedVertexData.indexFormat);
        const buffers: GfxVertexBufferDescriptor[] = [{
            buffer: coalescedBuffers.vertexBuffer.buffer,
            wordOffset: coalescedBuffers.vertexBuffer.wordOffset,
            byteStride: loadedVertexLayout.dstVertexSize,
        }];
        this.inputState = device.createInputState(this.inputLayout, buffers, coalescedBuffers.indexBuffer);
    }

    public buildRenderInst(renderInstBuilder: GfxRenderInstBuilder, baseRenderInst: GfxRenderInst = null): GfxRenderInst {
        const renderInst = renderInstBuilder.newRenderInst(baseRenderInst);
        renderInstBuilder.newUniformBufferInstance(renderInst, ub_PacketParams);
        renderInst.drawIndexes(this.loadedVertexData.totalTriangleCount * 3);
        renderInst.inputState = this.inputState;
        return renderInst;
    }

    public pushRenderInst(renderInstBuilder: GfxRenderInstBuilder, baseRenderInst: GfxRenderInst = null): GfxRenderInst {
        return renderInstBuilder.pushRenderInst(this.buildRenderInst(renderInstBuilder, baseRenderInst));
    }

    public fillPacketParams(packetParams: PacketParams, renderInst: GfxRenderInst, renderHelper: GXRenderHelperGfx): void {
        renderHelper.fillPacketParams(packetParams, renderInst.uniformBufferOffsets[ub_PacketParams]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

export class GXRenderHelperGfx {
    private sceneParams = new SceneParams();

    public sceneParamsBuffer: GfxRenderBuffer;
    public materialParamsBuffer: GfxRenderBuffer;
    public packetParamsBuffer: GfxRenderBuffer;
    public renderInstBuilder: GfxRenderInstBuilder;

    constructor(device: GfxDevice) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        this.materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        this.packetParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);

        // Standard GX binding model of three bind groups.
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0, }, // Scene
            { numUniformBuffers: 1, numSamplers: 8, }, // Material
            { numUniformBuffers: 1, numSamplers: 0, }, // Packet
        ]
        this.renderInstBuilder = new GfxRenderInstBuilder(device, GX_Material.GX_Program.programReflection, bindingLayouts, [ this.sceneParamsBuffer, this.materialParamsBuffer, this.packetParamsBuffer ]);
        // Create our scene buffer slot.
        const sceneRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(sceneRenderInst, ub_SceneParams);
    }

    public fillSceneParams(viewerInput: Viewer.ViewerRenderInput): void {
        fillSceneParams(this.sceneParams, viewerInput.camera, viewerInput.viewportWidth, viewerInput.viewportHeight);
        fillSceneParamsData(this.sceneParamsBuffer.getShadowBufferF32(), this.sceneParams);
    }

    public fillMaterialParams(materialParams: MaterialParams, dstWordOffset: number): void {
        fillMaterialParamsData(this.materialParamsBuffer.getShadowBufferF32(), materialParams, dstWordOffset);
    }

    public fillPacketParams(packetParams: PacketParams, dstWordOffset: number): void {
        fillPacketParamsData(this.packetParamsBuffer.getShadowBufferF32(), packetParams, dstWordOffset);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass): void {
        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.packetParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.packetParamsBuffer.destroy(device);
    }
}

export function fillSceneParams(sceneParams: SceneParams, camera: Camera, viewportWidth: number, viewportHeight: number): void {
    mat4.copy(sceneParams.u_Projection, camera.projectionMatrix);
    // Mip levels in GX are assumed to be relative to the GameCube's embedded framebuffer (EFB) size,
    // which is hardcoded to be 640x528. We need to bias our mipmap LOD selection by this amount to
    // make sure textures are sampled correctly...
    const textureLODBias = Math.log2(Math.min(viewportWidth / GX_Material.EFB_WIDTH, viewportHeight / GX_Material.EFB_HEIGHT));
    sceneParams.u_SceneTextureLODBias = textureLODBias;
}

export function fillSceneParamsFromRenderState(sceneParams: SceneParams, state: RenderState): void {
    fillSceneParams(sceneParams, state.camera, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
}

export function loadedDataCoalescer(gl: WebGL2RenderingContext, loadedVertexDatas: LoadedVertexData[]): BufferCoalescer {
    return new BufferCoalescer(gl,
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.packedVertexData)),
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.indexData))
    );
}

export function loadedDataCoalescerGfx(device: GfxDevice, loadedVertexDatas: LoadedVertexData[]): GfxBufferCoalescer {
    return new GfxBufferCoalescer(device,
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.packedVertexData)),
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.indexData))
    );
}

export function loadTextureFromMipChain(device: GfxDevice, mipChain: GX_Texture.MipChain): LoadedTexture {
    const firstMipLevel = mipChain.mipLevels[0];
    const gfxTexture = device.createTexture(GfxFormat.U8_RGBA, firstMipLevel.width, firstMipLevel.height, mipChain.mipLevels.length);
    device.setResourceName(gfxTexture, mipChain.name);

    const hostAccessPass = device.createHostAccessPass();
    const surfaces: HTMLCanvasElement[] = [];
    const promises: Promise<void>[] = [];
    for (let i = 0; i < mipChain.mipLevels.length; i++) {
        const level = i;
        const mipLevel = mipChain.mipLevels[i];

        const canvas = document.createElement('canvas');
        canvas.width = mipLevel.width;
        canvas.height = mipLevel.height;
        canvas.title = mipLevel.name;
        surfaces.push(canvas);

        promises.push(GX_Texture.decodeTexture(mipLevel).then((rgbaTexture) => {
            hostAccessPass.uploadTextureData(gfxTexture, level, [rgbaTexture.pixels]);
            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(mipLevel.width, mipLevel.height);
            imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
            ctx.putImageData(imgData, 0, 0);
        }));
    }

    Promise.all(promises).then(() => {
        device.submitPass(hostAccessPass);
    });

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

export function translateWrapModeGfx(wrapMode: GX.WrapMode): GfxWrapMode {
    switch (wrapMode) {
    case GX.WrapMode.CLAMP:
        return GfxWrapMode.CLAMP;
    case GX.WrapMode.MIRROR:
        return GfxWrapMode.MIRROR;
    case GX.WrapMode.REPEAT:
        return GfxWrapMode.REPEAT;
    }
}

export function translateTexFilterGfx(texFilter: GX.TexFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (texFilter) {
    case GX.TexFilter.LINEAR:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP ];
    case GX.TexFilter.NEAR:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.NO_MIP ];
    case GX.TexFilter.LIN_MIP_LIN:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR ];
    case GX.TexFilter.NEAR_MIP_LIN:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR ];
    case GX.TexFilter.LIN_MIP_NEAR:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST ];
    case GX.TexFilter.NEAR_MIP_NEAR:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST ];
    }
}

export class GXTextureHolder<TextureType extends GX_Texture.Texture = GX_Texture.Texture> extends TextureHolder<TextureType> {
    protected addTextureGfx(device: GfxDevice, texture: TextureType): LoadedTexture | null {
        // Don't add textures without data.
        if (texture.data === null)
            return null;

        const mipChain = GX_Texture.calcMipChain(texture, texture.mipCount);
        return loadTextureFromMipChain(device, mipChain);
    }

    protected addTexture(gl: WebGL2RenderingContext, texture: TextureType): LoadedTexture | null {
        return this.addTextureGfx(getTransitionDeviceForWebGL2(gl), texture);
    }
}
