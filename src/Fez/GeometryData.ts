
import { GfxBuffer, GfxInputLayout, GfxDevice, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { Fez_ShaderInstancedIndexedPrimitives, Fez_VertexPositionNormalTextureInstance } from './XNB_Fez';
import { AABB } from "../Geometry";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

export class GeometryData {
    private indexBuffer: GfxBuffer;
    private positionBuffer: GfxBuffer;
    private normalBuffer: GfxBuffer;
    private texcoordBuffer: GfxBuffer;
    public indexCount: number;
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public bbox = new AABB();

    constructor(device: GfxDevice, cache: GfxRenderCache, geometry: Fez_ShaderInstancedIndexedPrimitives<Fez_VertexPositionNormalTextureInstance>) {
        this.indexCount = geometry.indices.length;

        const vertices = geometry.vertices;
        const positions = vertices.map((v) => v.position);
        const normals = vertices.map((v) => v.normal);
        const texcoords = vertices.map((v) => v.texcoord);

        this.bbox.setFromPoints(positions);

        const posF32A = flat(positions as Float32Array[]);
        const normalF32A = flat(normals as Float32Array[]);
        const texcoordF32A = flat(texcoords as Float32Array[]);

        const indices = Uint32Array.from(geometry.indices);
        this.indexCount = indices.length;
        this.positionBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, posF32A.buffer);
        this.normalBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, normalF32A.buffer);
        this.texcoordBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, texcoordF32A.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0, }, // Position
            { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0, }, // Normal
            { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG,  bufferByteOffset: 0, }, // TexCoord
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 2*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });
        this.vertexBufferDescriptors = [
            { buffer: this.positionBuffer, byteOffset: 0, },
            { buffer: this.normalBuffer, byteOffset: 0, },
            { buffer: this.texcoordBuffer, byteOffset: 0, },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.positionBuffer);
        device.destroyBuffer(this.normalBuffer);
        device.destroyBuffer(this.texcoordBuffer);
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
