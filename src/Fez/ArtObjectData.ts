
import { GfxTexture, GfxDevice, GfxFormat, GfxInputLayout, GfxInputState, GfxBuffer, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxInputLayoutBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { makeTextureFromXNA_Texture2D } from "./Texture";
import { AABB } from "../Geometry";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { Fez_ArtObject } from "./XNB_Fez";

export class ArtObjectData {
    private positionBuffer: GfxBuffer;
    private normalBuffer: GfxBuffer;
    private texcoordBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    public indexCount: number;
    public texture: GfxTexture;
    public sampler: GfxSampler;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public bbox = new AABB();

    constructor(device: GfxDevice, cache: GfxRenderCache, public name: string, data: Fez_ArtObject) {
        this.indexCount = data.geometry.indices.length;

        const vertices = data.geometry.vertices;
        const positions = vertices.map((v) => v.position);
        const normals = vertices.map((v) => v.normal);
        const texcoords = vertices.map((v) => v.texcoord);

        this.bbox.set(positions);

        const posF32A = flat(positions);
        const normalF32A = flat(normals);
        const texcoordF32A = flat(texcoords);

        const indices = Uint32Array.from(data.geometry.indices);
        this.indexCount = indices.length;
        this.positionBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, posF32A.buffer);
        this.normalBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, normalF32A.buffer);
        this.texcoordBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, texcoordF32A.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indices.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0, }, // Position
            { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0, }, // Normal
            { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG,  bufferByteOffset: 0, }, // TexCoord
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
            { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
            { byteStride: 2*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = cache.createInputLayout(device, {
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.positionBuffer, byteOffset: 0, },
            { buffer: this.normalBuffer, byteOffset: 0, },
            { buffer: this.texcoordBuffer, byteOffset: 0, },
        ],
        { buffer: this.indexBuffer, byteOffset: 0 });

        this.texture = makeTextureFromXNA_Texture2D(device, data.futureCubeMap);
        this.sampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.positionBuffer);
        device.destroyBuffer(this.texcoordBuffer);
        device.destroyInputState(this.inputState);
        device.destroyTexture(this.texture);
    }
}

function flat(L: Float32Array[]): Float32Array {
    let size = 0;
    for (let i = 0; i < L.length; i++)
        size += L[i].length;
    const a = new Float32Array(size);
    let d = 0;
    for (let i = 0; i < L.length; i++)
        for (let j = 0; j < L[i].length; j++)
            a[d++] = L[i][j];
    return a;
}
