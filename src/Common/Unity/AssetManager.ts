import { DataFetcher } from '../../DataFetcher';
import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';
import { SceneContext } from '../../SceneBase';
import { downloadBlob } from '../../DownloadUtils';
import { AssetInfo, Mesh, VertexFormat, IndexFormat, StreamingInfo } from '../../../rust/pkg/index';
import { GfxDevice, GfxBufferUsage, GfxBuffer, GfxInputState, GfxFormat, GfxInputLayout, GfxProgram, GfxBindingLayoutDescriptor, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxCullMode } from '../../gfx/platform/GfxPlatform';
import { FormatTypeFlags } from '../../gfx/platform/GfxPlatformFormat';

let _wasm: any | null = null;

async function loadWasm() {
    return await import('../../../rust/pkg/index');
}

const MAX_HEADER_LENGTH = 4096;

function concatBufs(a: Uint8Array, b: Uint8Array): Uint8Array {
    let result = new Uint8Array(a.byteLength + b.byteLength);
    result.set(a);
    result.set(b, a.byteLength);
    return result;
}

interface Range {
    rangeStart: number;
    rangeSize: number;
}

export interface MeshMetadata {
    name: string;
    offset: number;
    size: number;
}

export const a_Position = 0;
export const a_Normal = 1;

export class UnityMesh {
    constructor(public inputLayout: GfxInputLayout, public inputState: GfxInputState, public numIndices: number) {
    }

    public destroy(device: GfxDevice) {
        device.destroyInputState(this.inputState);
        device.destroyInputLayout(this.inputLayout);
    }
}

export class UnityAssetManager {
    private assetInfo: AssetInfo;
    private fetcher: DataFetcher;

    constructor(public assetPath: string, private context: SceneContext, public device: GfxDevice) {
    }

    private async loadBytes(range: Range, path = this.assetPath): Promise<Uint8Array> {
        let res = await this.context.dataFetcher.fetchData(path, range);
        return new Uint8Array(res.arrayBuffer);
    }

    private async loadStreamingData(streamingInfo: StreamingInfo): Promise<Uint8Array> {
        let path = this.assetPath.split('/');
        path.pop();
        path.push(streamingInfo.get_path());
        return await this.loadBytes({
            rangeStart: streamingInfo.offset,
            rangeSize: streamingInfo.size,
        }, path.join('/'));
    }

    public async loadAssetInfo() {
        let wasm = await loadWasm();
        let headerBytes = await this.loadBytes({
            rangeStart: 0,
            rangeSize: MAX_HEADER_LENGTH,
        });
        let assetHeader = wasm.AssetHeader.deserialize(headerBytes);
        if (assetHeader.data_offset > headerBytes.byteLength) {
            let extraBytes = await this.loadBytes({
                rangeStart: headerBytes.byteLength,
                rangeSize: assetHeader.data_offset - headerBytes.byteLength,
            });
            headerBytes = concatBufs(headerBytes, extraBytes);
        }
        this.assetInfo = wasm.AssetInfo.deserialize(headerBytes);
    }

    public async downloadMeshMetadata() {
        let wasm = await loadWasm();
        let assetData = await this.context.dataFetcher.fetchData(this.assetPath);
        let assetBytes = new Uint8Array(assetData.arrayBuffer);
        let meshDataArray = wasm.get_mesh_metadata(this.assetInfo, assetBytes);
        let result: MeshMetadata[] = [];
        for (let i=0; i<meshDataArray.length; i++) {
            let data = meshDataArray.get(i);
            result.push({
                name: data.get_name(),
                offset: data.offset,
                size: data.size,
            })
        }

        downloadBlob('meshData.json', new Blob([JSON.stringify(result, null, 2)]));
    }

    public async loadMesh(meshData: MeshMetadata): Promise<UnityMesh> {
        let wasm = await loadWasm();
        let meshBytes = await this.loadBytes({
            rangeStart: meshData.offset,
            rangeSize: meshData.size,
        });
        let mesh = wasm.Mesh.from_bytes(meshBytes, this.assetInfo);
        let streamingInfo: StreamingInfo | undefined = mesh.get_streaming_info();
        if (streamingInfo !== undefined) {
            mesh.set_vertex_data(await this.loadStreamingData(streamingInfo));
        }

        if (mesh.is_compressed()) {
            return await compressedMeshLayout(this.device, mesh);
        } else {
            return await meshLayout(this.device, mesh);
        }
    }
}

async function compressedMeshLayout(device: GfxDevice, mesh: Mesh): Promise<UnityMesh> {
    let vertices = mesh.get_vertices()!;
    let normals = mesh.get_normals()!;
    let indices = mesh.get_indices()!;
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
        { location: a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
        { location: a_Normal, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
    ];
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
        { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
    ];
    const indexBufferFormat: GfxFormat = GfxFormat.U32_R;
    let layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    let vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertices.buffer);
    let normsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, normals.buffer);
    let trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices.buffer);

    let state = device.createInputState(layout, [
        { buffer: vertsBuf, byteOffset: 0, },
        { buffer: normsBuf, byteOffset: 0, },
    ], { buffer: trisBuf, byteOffset: 0 });

    return new UnityMesh(layout, state, indices.length);
}

// tbh not sure about many of these
function vertexFormatToGfxFormat(wasm: any, fmt: VertexFormat): GfxFormat {
    switch (fmt) {
        case wasm.VertexFormat.Float: return GfxFormat.F32_RGB;
        case wasm.VertexFormat.Float16: return GfxFormat.F16_RGB;
        case wasm.VertexFormat.UNorm8: return GfxFormat.U8_RGB_NORM;
        case wasm.VertexFormat.SNorm8: return GfxFormat.S8_RGB_NORM;
        case wasm.VertexFormat.UNorm16: return GfxFormat.U16_R_NORM;
        case wasm.VertexFormat.SNorm16: return GfxFormat.S16_RGB_NORM;
        case wasm.VertexFormat.UInt8: return GfxFormat.U8_R;
        case wasm.VertexFormat.SInt8: return GfxFormat.S8_R;
        case wasm.VertexFormat.UInt16: return GfxFormat.U16_R;
        case wasm.VertexFormat.SInt16: return GfxFormat.S16_R;
        case wasm.VertexFormat.UInt32: return GfxFormat.U32_R;
        case wasm.VertexFormat.SInt32: return GfxFormat.S32_R;
        default:
            throw new Error(`didn't recognize format ${fmt}`);
    }
}

async function meshLayout(device: GfxDevice, mesh: Mesh): Promise<UnityMesh> {
    let wasm = await loadWasm();
    let vertexInfo = mesh.get_channel_info(0)!;
    let normalInfo = mesh.get_channel_info(1)!;
    let streamInfo = mesh.get_vertex_stream_info(0)!;
    let indices = mesh.get_index_data();
    let vertBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mesh.get_vertex_data());
    let indicesBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices);

    let normOffset = vertexInfo.dimension * vertexInfo.get_format_size();

    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
        { location: a_Position, bufferIndex: 0, bufferByteOffset: 0, format: vertexFormatToGfxFormat(wasm, vertexInfo.format), },
        { location: a_Normal, bufferIndex: 0, bufferByteOffset: normOffset, format: vertexFormatToGfxFormat(wasm, normalInfo.format), },
    ];
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
        { byteStride: streamInfo.stride, frequency: GfxVertexBufferFrequency.PerVertex, },
    ];
    let indexBufferFormat: GfxFormat;
    let numIndices = 0;
    if (mesh.index_format === wasm.IndexFormat.UInt32) {
        indexBufferFormat = GfxFormat.U32_R;
        numIndices = indices.length / 4;
    } else {
        indexBufferFormat = GfxFormat.U16_R;
        numIndices = indices.length / 2;
    };

    let layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    let state = device.createInputState(layout, [
        { buffer: vertBuf, byteOffset: 0 },
    ], { buffer: indicesBuf, byteOffset: 0 });
    return new UnityMesh(layout, state,  numIndices);
}