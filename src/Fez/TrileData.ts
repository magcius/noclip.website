
// Code ported and subsequently butchered from https://github.com/halogenica/FezViewer
import { vec3, vec2 } from 'gl-matrix';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxBufferUsage, GfxDevice, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency, GfxInputLayout, GfxInputState, GfxBuffer, GfxTexture, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from '../gfx/platform/GfxPlatform';
import { assert } from '../util';
import { makeTextureFromImageData } from './Texture';
import { parseVector3, parseVector2 } from './DocumentHelpers';

const gc_normals = [
    vec3.fromValues(-1, 0, 0),
    vec3.fromValues(0, -1, 0),
    vec3.fromValues(0, 0, -1),
    vec3.fromValues(1, 0, 0),
    vec3.fromValues(0, 1, 0),
    vec3.fromValues(0, 0, 1),
];

export class TrileData {
    private vertexBuffer: GfxBuffer;
    private texcoordBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;
    public key: number;

    constructor(device: GfxDevice, element: Element, public texture: GfxTexture, public sampler: GfxSampler) {
        this.key = Number(element.getAttribute('key'));

        const positions: vec3[] = [];
        const normals: vec3[] = [];
        const texcoords: vec2[] = [];
        const indices: number[] = [];

        const xmlVPNTI = element.getElementsByTagName('VertexPositionNormalTextureInstance');
        for (let i = 0; i < xmlVPNTI.length; i++) {
            positions.push(parseVector3(xmlVPNTI[i].querySelector('Position Vector3')!));
            normals.push(gc_normals[Number(xmlVPNTI[i].querySelector('Normal')!.textContent)]);
            texcoords.push(parseVector2(xmlVPNTI[i].querySelector('TextureCoord Vector2')!));
        }

        const indexXmlList = element.getElementsByTagName('Indices');
        for (let i = 0; i < indexXmlList.length; i++) {
            const indicesXmlList = indexXmlList[i].getElementsByTagName('Index');
            for (let j = 0; j < indicesXmlList.length; j++)
                indices.push(Number(indicesXmlList[j].textContent));
        }
        this.indexCount = indices.length;

        const posF32A = Float32Array.from(flat(positions));
        const texcoordF32A = Float32Array.from(flat(texcoords));
        const indicesI32A = Uint32Array.from(indices);
        this.vertexBuffer = makeStaticDataBuffer(device,GfxBufferUsage.VERTEX,posF32A.buffer);
        this.texcoordBuffer = makeStaticDataBuffer(device,GfxBufferUsage.VERTEX,texcoordF32A.buffer);
        this.indexBuffer = makeStaticDataBuffer(device,GfxBufferUsage.INDEX,indicesI32A.buffer);

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
            { buffer: this.texcoordBuffer, byteOffset: 0, byteStride: 2*0x04, }
        ],
        { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x04 });
    }

    destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.texcoordBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
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

export class TrilesetData {
    public triles: TrileData[] = [];
    public texture: GfxTexture;
    public sampler: GfxSampler;

    constructor(device: GfxDevice, file: Document, texImageData: ImageData) {
        this.texture = makeTextureFromImageData(device, texImageData);

        this.sampler = device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });

        const trileList = file.getElementsByTagName('TrileEntry');
        for (let i = 0; i < trileList.length; i++)
            this.triles.push(new TrileData(device, trileList[i], this.texture, this.sampler));
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
        device.destroySampler(this.sampler);

        for (let i = 0; i < this.triles.length; i++)
            this.triles[i].destroy(device);
    }
}
