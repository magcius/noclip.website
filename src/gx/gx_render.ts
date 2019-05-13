
// Common helpers for GX rendering.

import { mat4, mat2d } from 'gl-matrix';

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from '../viewer';

import { assert, nArray } from '../util';
import { LoadedVertexData, LoadedVertexLayout, LoadedVertexPacket } from './gx_displaylist';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { TextureMapping, TextureHolder, LoadedTexture } from '../TextureHolder';

import { GfxBufferCoalescer, GfxCoalescedBuffers, makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { fillColor, fillMatrix4x3, fillVec4, fillMatrix4x4, fillVec3, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxFormat, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxDevice, GfxInputState, GfxVertexAttributeDescriptor, GfxInputLayout, GfxVertexBufferDescriptor, GfxProgram, GfxBindingLayoutDescriptor, GfxProgramReflection, GfxHostAccessPass, GfxRenderPass, GfxBufferBinding, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxVertexAttributeFrequency, GfxTextureDimension } from '../gfx/platform/GfxPlatform';
import { getFormatTypeFlags, FormatTypeFlags } from '../gfx/platform/GfxPlatformFormat';
import { Camera } from '../Camera';
import { GfxRenderInstBuilder, GfxRenderInst, GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

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
    public u_IndTexMtx: mat4[] = nArray(3, () => mat4.create()); // mat4x2
    public u_Lights: GX_Material.Light[] = nArray(8, () => new GX_Material.Light());
}

export class PacketParams {
    public u_PosMtx: mat4[] = nArray(10, () => mat4.create());

    public clear(): void {
        for (let i = 0; i < 8; i++)
            mat4.identity(this.u_PosMtx[i]);
    }
}

export const ub_SceneParams = 0;
export const ub_MaterialParams = 1;
export const ub_PacketParams = 2;

export const u_SceneParamsBufferSize = 4*4 + 4;
export const u_MaterialParamsBufferSize = 4*2 + 4*2 + 4*4 + 4*4 + 4*3*10 + 4*3*20 + 4*2*3 + 4*8 + 4*5*8;
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

    for (let i = 0; i < 12; i++)
        offs += fillColor(d, offs, materialParams.u_Color[i]);
    for (let i = 0; i < 10; i++)
        offs += fillMatrix4x3(d, offs, materialParams.u_TexMtx[i]);
    for (let i = 0; i < 20; i++)
        offs += fillMatrix4x3(d, offs, materialParams.u_PostTexMtx[i]);
    for (let i = 0; i < 3; i++)
        offs += fillMatrix4x2(d, offs, materialParams.u_IndTexMtx[i]);
    for (let i = 0; i < 8; i++)
        offs += fillVec4(d, offs, materialParams.m_TextureMapping[i].width, materialParams.m_TextureMapping[i].height, 0, materialParams.m_TextureMapping[i].lodBias);
    for (let i = 0; i < 8; i++) {
        const light = materialParams.u_Lights[i];
        offs += fillColor(d, offs, light.Color);
        offs += fillVec3(d, offs, light.Position);
        offs += fillVec3(d, offs, light.Direction);
        offs += fillVec3(d, offs, light.DistAtten);
        offs += fillVec3(d, offs, light.CosAtten);
    }

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

export class GXMaterialHelperGfx {
    public templateRenderInst: GfxRenderInst;
    public programKey: number;
    private materialHacks: GX_Material.GXMaterialHacks = {};

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, private material: GX_Material.GXMaterial, materialHacks?: GX_Material.GXMaterialHacks) {
        if (materialHacks)
            Object.assign(this.materialHacks, materialHacks);

        this.templateRenderInst = renderHelper.renderInstBuilder.newRenderInst();
        this.templateRenderInst.name = material.name;
        this.createProgram();
        GX_Material.translateGfxMegaState(this.templateRenderInst.setMegaStateFlags(), material);
        renderHelper.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, ub_MaterialParams);
    }

    private createProgram(): void {
        const program = new GX_Material.GX_Program(this.material, this.materialHacks);
        this.templateRenderInst.setDeviceProgram(program);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.materialHacks.disableVertexColors = !v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.materialHacks.disableTextures = !v;
        this.createProgram();
    }

    public fillMaterialParamsRaw(materialParams: MaterialParams, renderHelper: GXRenderHelperGfx): void {
        renderHelper.fillMaterialParams(materialParams, this.templateRenderInst.getUniformBufferOffset(ub_MaterialParams));
    }

    public fillMaterialParams(materialParams: MaterialParams, renderHelper: GXRenderHelperGfx): void {
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.fillMaterialParamsRaw(materialParams, renderHelper);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.templateRenderInst.gfxProgram!);
    }
}

export class GXShapeHelperGfx {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    private zeroBuffer: GfxBuffer | null = null;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, public coalescedBuffers: GfxCoalescedBuffers, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData) {
        // First, build the inputLayout
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        let usesZeroBuffer = false;
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib <= GX.VertexAttribute.MAX; vtxAttrib++) {
            const attribLocation = GX_Material.getVertexAttribLocation(vtxAttrib);

            // TODO(jstpierre): Handle TEXMTXIDX attributes.
            if (attribLocation === -1)
                continue;

            const attribGenDef = GX_Material.getVertexAttribGenDef(vtxAttrib);
            const attrib = this.loadedVertexLayout.dstVertexAttributeLayouts.find((attrib) => attrib.vtxAttrib === vtxAttrib);
            const usesIntInShader = getFormatTypeFlags(attribGenDef.format) !== FormatTypeFlags.F32;

            if (attrib !== undefined) {
                const bufferByteOffset = attrib.offset;
                vertexAttributeDescriptors.push({ location: attribLocation, format: attrib.format, bufferIndex: 0, bufferByteOffset, frequency: GfxVertexAttributeFrequency.PER_VERTEX, usesIntInShader });
            } else {
                usesZeroBuffer = true;
                vertexAttributeDescriptors.push({ location: attribLocation, format: attribGenDef.format, bufferIndex: 1, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_INSTANCE, usesIntInShader });
            }
        }

        const indexBufferFormat = this.loadedVertexData.indexFormat;
        this.inputLayout = renderHelper.gfxRenderCache.createInputLayout(device, {
            vertexAttributeDescriptors,
            indexBufferFormat,
        });
        const buffers: GfxVertexBufferDescriptor[] = [{
            buffer: coalescedBuffers.vertexBuffer.buffer,
            byteOffset: coalescedBuffers.vertexBuffer.wordOffset * 4,
            byteStride: loadedVertexLayout.dstVertexSize,
        }];

        if (usesZeroBuffer) {
            // TODO(jstpierre): Move this to a global somewhere?
            this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(16).buffer);
            buffers.push({ buffer: this.zeroBuffer, byteOffset: 0, byteStride: 0 });
        }

        const indexBuffer: GfxVertexBufferDescriptor = {
            buffer: coalescedBuffers.indexBuffer.buffer,
            byteOffset: coalescedBuffers.indexBuffer.wordOffset * 4,
            byteStride: 0,
        }
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
    }

    public buildRenderInstPacket(renderInstBuilder: GfxRenderInstBuilder, packet: LoadedVertexPacket | null = null, baseRenderInst: GfxRenderInst | null = null): GfxRenderInst {
        const renderInst = renderInstBuilder.newRenderInst(baseRenderInst);
        renderInstBuilder.newUniformBufferInstance(renderInst, ub_PacketParams);
        if (packet !== null)
            renderInst.drawIndexes(packet.indexCount, packet.indexOffset);
        else
            renderInst.drawIndexes(this.loadedVertexData.totalIndexCount);
        renderInst.inputState = this.inputState;
        renderInst.setSamplerBindingsInherit();
        return renderInst;
    }

    public buildRenderInst(renderInstBuilder: GfxRenderInstBuilder, baseRenderInst: GfxRenderInst | null = null): GfxRenderInst {
        return this.buildRenderInstPacket(renderInstBuilder, null, baseRenderInst);
    }

    public fillPacketParams(packetParams: PacketParams, renderInst: GfxRenderInst, renderHelper: GXRenderHelperGfx): void {
        renderHelper.fillPacketParams(packetParams, renderInst.getUniformBufferOffset(ub_PacketParams));
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        if (this.zeroBuffer !== null)
            device.destroyBuffer(this.zeroBuffer);
    }
}

export class GXRenderHelperGfx {
    private sceneParams = new SceneParams();
    public gfxRenderCache = new GfxRenderCache();

    public sceneParamsBuffer: GfxRenderBuffer;
    public materialParamsBuffer: GfxRenderBuffer;
    public packetParamsBuffer: GfxRenderBuffer;
    public renderInstBuilder: GfxRenderInstBuilder;
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
        this.packetParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_PacketParams`);

        // Standard GX binding model of three bind groups.
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0, }, // Scene
            { numUniformBuffers: 1, numSamplers: 8, }, // Material
            { numUniformBuffers: 1, numSamplers: 0, }, // Packet
        ]

        assert(GX_Material.GX_Program.programReflection.uniformBufferLayouts[0].totalWordSize === u_SceneParamsBufferSize);
        assert(GX_Material.GX_Program.programReflection.uniformBufferLayouts[1].totalWordSize === u_MaterialParamsBufferSize);
        assert(GX_Material.GX_Program.programReflection.uniformBufferLayouts[2].totalWordSize === u_PacketParamsBufferSize);

        this.renderInstBuilder = new GfxRenderInstBuilder(device, GX_Material.GX_Program.programReflection, bindingLayouts, [ this.sceneParamsBuffer, this.materialParamsBuffer, this.packetParamsBuffer ]);
        // Create our scene buffer slot.
        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.name = 'gx render helper';
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, ub_SceneParams);
    }

    public finishBuilder(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public fillSceneParams(viewerInput: Viewer.ViewerRenderInput): void {
        fillSceneParams(this.sceneParams, viewerInput.camera, viewerInput.viewportWidth, viewerInput.viewportHeight);
        fillSceneParamsData(this.sceneParamsBuffer.mapBufferF32(0, u_SceneParamsBufferSize), this.sceneParams);
    }

    public fillMaterialParams(materialParams: MaterialParams, dstWordOffset: number): void {
        fillMaterialParamsData(this.materialParamsBuffer.mapBufferF32(dstWordOffset, u_MaterialParamsBufferSize), materialParams, dstWordOffset);
    }

    public fillPacketParams(packetParams: PacketParams, dstWordOffset: number): void {
        fillPacketParamsData(this.packetParamsBuffer.mapBufferF32(dstWordOffset, u_PacketParamsBufferSize), packetParams, dstWordOffset);
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
        this.gfxRenderCache.destroy(device);
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

export function loadedDataCoalescerGfx(device: GfxDevice, loadedVertexDatas: LoadedVertexData[]): GfxBufferCoalescer {
    return new GfxBufferCoalescer(device,
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.packedVertexData)),
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.indexData))
    );
}

export function loadTextureFromMipChain(device: GfxDevice, mipChain: GX_Texture.MipChain): LoadedTexture {
    const firstMipLevel = mipChain.mipLevels[0];
    const gfxTexture = device.createTexture({
        pixelFormat: GfxFormat.U8_RGBA, width: firstMipLevel.width, height: firstMipLevel.height, numLevels: mipChain.mipLevels.length,
        depth: 1, dimension: GfxTextureDimension.n2D,
    });
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
            const ctx = canvas.getContext('2d')!;
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
    protected loadTexture(device: GfxDevice, texture: TextureType): LoadedTexture | null {
        // Don't add textures without data.
        if (texture.data === null)
            return null;

        const mipChain = GX_Texture.calcMipChain(texture, texture.mipCount);
        return loadTextureFromMipChain(device, mipChain);
    }
}
