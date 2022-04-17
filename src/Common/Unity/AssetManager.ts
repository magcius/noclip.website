
import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';
import { SceneContext } from '../../SceneBase';
import { downloadBlob } from '../../DownloadUtils';
import { AssetInfo, Mesh, AABB as UnityAABB, VertexFormat, StreamingInfo, ChannelInfo } from '../../../rust/pkg/index';
import { GfxDevice, GfxBuffer, GfxBufferUsage, GfxInputState, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor } from '../../gfx/platform/GfxPlatform';
import { FormatCompFlags, setFormatCompFlags } from '../../gfx/platform/GfxPlatformFormat';
import { assert } from '../../util';
import * as Geometry from '../../Geometry';
import { vec3 } from 'gl-matrix';

let _wasm: typeof import('../../../rust/pkg/index') | null = null;

async function loadWasm() {
    if (_wasm === null) {
        _wasm = await import('../../../rust/pkg/index');
    }
    return _wasm;
}

// this is a ballpark estimate, it's probably much lower
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

export enum UnityChannel {
    Vertex,
    Normal,
    Color,
    TexCoord0,
    TexCoord1,
    TexCoord2,
    TexCoord3,
    Tangent,
}

export class UnityMesh {
    public bbox: Geometry.AABB; 

    constructor(public inputLayout: GfxInputLayout, public inputState: GfxInputState, public numIndices: number, bbox: UnityAABB, public buffers: GfxBuffer[]) {
        let center = vec3.fromValues(bbox.center.x, bbox.center.y, bbox.center.z);
        let extent = vec3.fromValues(bbox.extent.x, bbox.extent.y, bbox.extent.z);
        this.bbox = new Geometry.AABB();
        this.bbox.setFromCenterAndExtents(center, extent);
    }

    public destroy(device: GfxDevice) {
        this.buffers.forEach(buf => device.destroyBuffer(buf));
        device.destroyInputState(this.inputState);
        device.destroyInputLayout(this.inputLayout);
    }
}

export class UnityAssetManager {
    private assetInfo: AssetInfo;

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
            return await loadCompressedMesh(this.device, mesh);
        } else {
            return await loadMesh(this.device, mesh);
        }
    }
}

function loadCompressedMesh(device: GfxDevice, mesh: Mesh): UnityMesh {
    let vertices = mesh.unpack_vertices()!;
    let normals = mesh.unpack_normals()!;
    let indices = mesh.unpack_indices()!;
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
        { location: UnityChannel.Vertex, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
        { location: UnityChannel.Normal, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
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

    let buffers = [vertsBuf, normsBuf, trisBuf];

    return new UnityMesh(layout, state, indices.length, mesh.local_aabb, buffers);
}

function vertexFormatToGfxFormatBase(vertexFormat: VertexFormat): GfxFormat {
    switch (vertexFormat) {
        case _wasm!.VertexFormat.Float: return GfxFormat.F32_R;
        case _wasm!.VertexFormat.Float16: return GfxFormat.F16_R;
        case _wasm!.VertexFormat.UNorm8: return GfxFormat.U8_R_NORM;
        case _wasm!.VertexFormat.SNorm8: return GfxFormat.S8_R_NORM;
        case _wasm!.VertexFormat.UNorm16: return GfxFormat.U16_R_NORM;
        case _wasm!.VertexFormat.SNorm16: return GfxFormat.S16_RG_NORM;
        case _wasm!.VertexFormat.UInt8: return GfxFormat.U8_R;
        case _wasm!.VertexFormat.SInt8: return GfxFormat.S8_R;
        case _wasm!.VertexFormat.UInt16: return GfxFormat.U16_R;
        case _wasm!.VertexFormat.SInt16: return GfxFormat.S16_R;
        case _wasm!.VertexFormat.UInt32: return GfxFormat.U32_R;
        case _wasm!.VertexFormat.SInt32: return GfxFormat.S32_R;
        default:
            throw new Error(`didn't recognize format ${vertexFormat}`);
    }
}

function vertexFormatToGfxFormat(vertexFormat: VertexFormat, dimension: number): GfxFormat {
    const baseFormat = vertexFormatToGfxFormatBase(vertexFormat);
    const compFlags = dimension as FormatCompFlags;
    return setFormatCompFlags(baseFormat, compFlags);
}

function channelInfoToVertexAttributeDescriptor(location: number, channelInfo: ChannelInfo): GfxVertexAttributeDescriptor {
    const { stream, offset, format, dimension } = channelInfo;
    const gfxFormat = vertexFormatToGfxFormat(format, dimension);
    assert(stream === 0); // TODO: Handle more than one stream
    return { location: location, bufferIndex: stream, bufferByteOffset: offset, format: gfxFormat };
}

function loadMesh(device: GfxDevice, mesh: Mesh): UnityMesh {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    vertexAttributeDescriptors.push(channelInfoToVertexAttributeDescriptor(UnityChannel.Vertex, mesh.get_channel_info(0)!));
    vertexAttributeDescriptors.push(channelInfoToVertexAttributeDescriptor(UnityChannel.Normal, mesh.get_channel_info(1)!));
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [{
        byteStride: mesh.get_vertex_stream_info(0)!.stride,
        frequency: GfxVertexBufferFrequency.PerVertex,
    }];

    let indices = mesh.get_index_data();
    let indexBufferFormat: GfxFormat;
    let numIndices = 0;
    if (mesh.index_format === _wasm!.IndexFormat.UInt32) {
        indexBufferFormat = GfxFormat.U32_R;
        numIndices = indices.length / 4;
    } else {
        indexBufferFormat = GfxFormat.U16_R;
        numIndices = indices.length / 2;
    }

    let vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mesh.get_vertex_data().buffer);
    let trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices.buffer);

    let layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    let state = device.createInputState(layout, [
        { buffer: vertsBuf, byteOffset: 0 },
    ], { buffer: trisBuf, byteOffset: 0 });
    let buffers = [vertsBuf, trisBuf];

    return new UnityMesh(layout, state,  numIndices, mesh.local_aabb, buffers);
}