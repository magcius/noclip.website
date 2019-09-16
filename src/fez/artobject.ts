
import { GfxTexture, GfxDevice, GfxTextureDimension, GfxFormat, GfxInputLayout, GfxInputState, GfxBuffer, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform";
import { vec3, vec2 } from "gl-matrix";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { assert } from "../util";

const gc_normals = [
    vec3.fromValues(-1, 0, 0), 
    vec3.fromValues(0, -1, 0), 
    vec3.fromValues(0, 0, -1),
    vec3.fromValues(1, 0, 0), 
    vec3.fromValues(0, 1, 0), 
    vec3.fromValues(0, 0, 1),
];

function parseVec2(e: Element): vec2 {
    assert(e.tagName === 'Vector2');
    const x = Number(e.getAttribute('x'));
    const y = Number(e.getAttribute('y'));
    return vec2.fromValues(x, y);
}

function parseVec3(e: Element): vec3 {
    assert(e.tagName === 'Vector3');
    const x = Number(e.getAttribute('x'));
    const y = Number(e.getAttribute('y'));
    const z = Number(e.getAttribute('z'));
    return vec3.fromValues(x, y, z);
}

export class ArtObjectData {
    private vertexBuffer: GfxBuffer;
    private texcoordBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    public indexCount: number;
    public texture: GfxTexture;
    public sampler: GfxSampler;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public name: string, file: Document, tex: ImageData) {
        const positions: vec3[] = [];
        const normals: vec3[] = [];
        const texcoords: vec2[] = [];
        const indices: number[] = [];

        const xmlVPNTI = file.getElementsByTagName('VertexPositionNormalTextureInstance');
        for (let i = 0; i < xmlVPNTI.length; i++) {
            positions.push(parseVec3(xmlVPNTI[i].querySelector('Position Vector3')!));
            normals.push(gc_normals[Number(xmlVPNTI[i].querySelector('Normal')!.textContent)]);
            texcoords.push(parseVec2(xmlVPNTI[i].querySelector('TextureCoord Vector2')!));
        }

        const indexXmlList = file.getElementsByTagName('Indices');
        for (let i = 0; i < indexXmlList.length; i++) {
            const indicesXmlList = indexXmlList[i].getElementsByTagName('Index');
            for (let j = 0; j < indicesXmlList.length; j++)
                indices.push(Number(indicesXmlList[j].textContent));
        }
        this.indexCount = indices.length;

        const posF32A = Float32Array.from(flat(positions));
        const texcoordF32A = Float32Array.from(flat(texcoords));
        const indicesI32A = Uint32Array.from(indices);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX,posF32A.buffer);
        this.texcoordBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX,texcoordF32A.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX,indicesI32A.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, }, // Position
            { location: 1, bufferIndex: 1, format: GfxFormat.F32_RG,  bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, }, // TexCoord
        ];
        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors,
        });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: 3*0x04, },
            { buffer: this.texcoordBuffer, byteOffset: 0, byteStride: 2*0x04, }],
            { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x04 });
        const hostAccessPass = device.createHostAccessPass();
        this.texture = device.createTexture({dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: tex.width, height: tex.height, depth: 1, numLevels: 1,})
        hostAccessPass.uploadTextureData(this.texture, 0, [new Uint8Array(tex.data.buffer)]);
        device.submitPass(hostAccessPass);

        this.sampler = device.createSampler({
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
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.texcoordBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyTexture(this.texture);
        device.destroySampler(this.sampler);
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
