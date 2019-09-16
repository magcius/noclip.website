//Code ported and subsequently butchered from https://github.com/halogenica/FezViewer
import { vec3, vec2 } from 'gl-matrix';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxBufferUsage, GfxDevice, GfxVertexAttributeDescriptor,GfxFormat,GfxVertexAttributeFrequency, GfxInputLayout, GfxInputState, GfxBuffer, GfxTexture, GfxTextureDimension, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode   } from '../gfx/platform/GfxPlatform';

const gc_normals = [vec3.fromValues(-1, 0, 0), 
                    vec3.fromValues(0, -1, 0), 
                    vec3.fromValues(0, 0, -1),
                    vec3.fromValues(1, 0, 0), 
                    vec3.fromValues(0, 1, 0), 
                    vec3.fromValues(0, 0, 1)];  

export class TrileData {
    inputLayout: GfxInputLayout;
    inputState: GfxInputState;
    vertexBuffer: GfxBuffer;
    texcoordBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    indexCount: number;
    key: number;

    constructor(device: GfxDevice, element: Element, public texture: GfxTexture, public sampler: GfxSampler) {
        let positions: vec3[] = [];
        let normals: vec3[] = [];
        let texcoords: vec2[] = [];
        let indices: number[] = [];

        this.key = Number(element.getAttribute('key'));

        let xmlVPNTI = element.getElementsByTagName('VertexPositionNormalTextureInstance');
        for(var i = 0; i < xmlVPNTI.length; i++) {
            let posXmlList = xmlVPNTI[i].getElementsByTagName('Vector3');
            let pos = vec3.fromValues(Number(posXmlList[0].getAttribute('x')),Number(posXmlList[0].getAttribute('y')),Number(posXmlList[0].getAttribute('z')));
            positions.push(pos);

            let normXmlList = xmlVPNTI[i].getElementsByTagName('Normal');
            normals.push(gc_normals[parseInt(normXmlList[0].innerHTML)]);

            let coordXmlList = xmlVPNTI[i].getElementsByTagName('Vector2');
            texcoords.push(vec2.fromValues(Number(coordXmlList[0].getAttribute('x')),Number(coordXmlList[0].getAttribute('y'))));
        }

        let indexXmlList = element.getElementsByTagName('Indices')
        for(var i = 0; i < indexXmlList.length; i++) {
            let indicesXmlList = indexXmlList[i].getElementsByTagName('Index')
            for(var j = 0; j < indicesXmlList.length; j++) {
                indices.push(Number(indicesXmlList[j].innerHTML));
            }
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
            { buffer: this.texcoordBuffer, byteOffset: 0, byteStride: 2*0x04, }],
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
    fez_parser: DOMParser;
    trilesetArray: TrileData[];
    public trileTex: GfxTexture;
    public sampler: GfxSampler;

    constructor(device: GfxDevice, file: Document, tex: ImageData) {
        this.fez_parser = new DOMParser();
        this.trilesetArray = [];
        let trileList = file.getElementsByTagName('TrileEntry');

        this.trileTex = device.createTexture({dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: tex.width, height: tex.height, depth: 1, numLevels: 1,});
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(this.trileTex, 0, [new Uint8Array(tex.data.buffer)]);
        device.submitPass(hostAccessPass);

        this.sampler = device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });

        for (var a = 0; a < trileList.length; a++) {
            this.trilesetArray.push(new TrileData(device, trileList[a], this.trileTex, this.sampler));
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.trileTex);
        device.destroySampler(this.sampler);

        for (let i = 0; i < this.trilesetArray.length; i++)
            this.trilesetArray[i].destroy(device);
    }
}
