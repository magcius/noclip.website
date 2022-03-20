import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';

import type { AssetInfo, Mesh, AABB as UnityAABB, VertexFormat, UnityStreamingInfo, ChannelInfo, Transform, GameObject, UnityClassID, Vec3f, Quaternion, PPtr, SubMesh, SubMeshArray, MeshRenderer, UnityObject } from '../../../rust/pkg/index';
import { GfxDevice, GfxBuffer, GfxBufferUsage, GfxInputState, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor } from '../../gfx/platform/GfxPlatform';
import { FormatCompFlags, getFormatCompByteSize, setFormatCompFlags } from '../../gfx/platform/GfxPlatformFormat';
import { assert, assertExists } from '../../util';
import * as Geometry from '../../Geometry';
import { mat4, vec3, quat } from 'gl-matrix';
import { DataFetcher } from '../../DataFetcher';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { Destroyable } from '../../SceneBase';

export type RustModule = typeof import('../../../rust/pkg/index');

interface WasmBindgenArray<T> {
    length: number;
    get(i: number): T;
    free(): void;
}

function loadWasmBindgenArray<T>(wasmArr: WasmBindgenArray<T>): T[] {
    const jsArr: T[] = Array<T>(wasmArr.length);
    for (let i = 0; i < wasmArr.length; i++)
        jsArr[i] = wasmArr.get(i);
    wasmArr.free();
    return jsArr;
}

function concatBufs(a: Uint8Array, b: Uint8Array): Uint8Array {
    let result = new Uint8Array(a.byteLength + b.byteLength);
    result.set(a);
    result.set(b, a.byteLength);
    return result;
}

interface Range {
    rangeStart: number | bigint;
    rangeSize: number;
}

// This is a ballpark estimate, it's probably much lower...
const MAX_HEADER_LENGTH = 4096;

interface FileDataFetchRequest {
    rangeStart: bigint;
    rangeSize: number;
    promise: Promise<ArrayBufferSlice>;
    resolve: (v: ArrayBufferSlice) => void;
}

function getRangeEnd(r: Range): bigint {
    return BigInt(r.rangeStart) + BigInt(r.rangeSize);
}

function getRangeSlice(buffer: ArrayBufferSlice, haystack: Range, needle: Range): ArrayBufferSlice | null {
    if (needle.rangeStart >= haystack.rangeStart && getRangeEnd(needle) <= getRangeEnd(haystack))
        return buffer.subarray(Number(BigInt(needle.rangeStart) - BigInt(haystack.rangeStart)), needle.rangeSize);
    return null;
}

class FileDataFetcher {
    public pendingRequests: FileDataFetchRequest[] = [];

    public addRequest(rangeStart: bigint, rangeSize: number) {
        let req: FileDataFetchRequest = { rangeStart, rangeSize, promise: null!, resolve: null! };
        req.promise = new Promise<ArrayBufferSlice>((resolve, reject) => {
            req.resolve = resolve;
        });
        this.pendingRequests.push(req);
        return req.promise;
    }

    public async fetch(dataFetcher: DataFetcher, path: string) {
        if (this.pendingRequests.length === 0)
            return;

        // Merge overlapping requests.
        const requests = this.pendingRequests;
        this.pendingRequests = [];
        requests.sort((a, b) => a.rangeStart > b.rangeStart ? 1 : -1);

        const ranges: Range[] = requests.map((req) => ({ rangeStart: req.rangeStart, rangeSize: req.rangeSize }));
        for (let i = 1; i < ranges.length; i++) {
            const a = ranges[i - 1], b = ranges[i];
            if (b.rangeStart <= getRangeEnd(a) + BigInt(16)) {
                a.rangeSize = Number(getRangeEnd(b) - BigInt(a.rangeStart));
                ranges.splice(i--, 1);
            }
        }

        const datas = await Promise.all(ranges.map((range) => dataFetcher.fetchData(path, range)));

        let rangeIdx = 0;
        for (let i = 0; i < requests.length; i++) {
            const req = requests[i];

            while (true) {
                const slice = getRangeSlice(datas[rangeIdx], ranges[rangeIdx], req);
                if (slice !== null) {
                    req.resolve(slice);
                    break;
                }
                rangeIdx++;
            }
        }
    }
}

export class AssetLocation {
    file: AssetFile;
    pathID: number;
}

export interface AssetObjectData {
    location: AssetLocation;
    classID: UnityClassID;
    assetInfo: AssetInfo;
    data: Uint8Array;
}

abstract class PromiseCache<T extends Destroyable> {
    protected promiseCache = new Map<number, Promise<T>>();
    protected cache = new Map<number, T>();

    protected abstract fetchInternal(assetSystem: UnityAssetSystem, assetFile: AssetFile, key: number): Promise<T>;

    public fetch(assetSystem: UnityAssetSystem, assetFile: AssetFile, key: number): Promise<T> {
        if (this.promiseCache.has(key))
            return this.promiseCache.get(key)!;

        const promise = this.fetchInternal(assetSystem, assetFile, key);
        this.promiseCache.set(key, promise);
        return promise.then((v) => {
            this.cache.set(key, v);
            return v;
        });
    }

    public destroy(device: GfxDevice): void {
        for (const v of this.cache.values())
            v.destroy(device);
    }
}

class MeshCache extends PromiseCache<UnityMesh> {
    protected async fetchInternal(assetSystem: UnityAssetSystem, assetFile: AssetFile, key: number): Promise<UnityMesh> {
        const objData = await assetFile.fetchObject(key);

        const mesh = assetSystem.wasm.Mesh.from_bytes(objData.data, objData.assetInfo, objData.location.pathID);
        const streamingInfo: UnityStreamingInfo | undefined = mesh.get_streaming_info();
        if (streamingInfo !== undefined)
            mesh.set_vertex_data(await assetSystem.fetchStreamingInfo(streamingInfo));

        if (mesh.is_compressed()) {
            return loadCompressedMesh(assetSystem.device, mesh);
        } else {
            return loadMesh(assetSystem.wasm, assetSystem.device, mesh);
        }
    }
}

// An AssetFile is a single serialized asset file in the filesystem, aka sharedassets or a level file.

class AssetFile {
    public unityObject: UnityObject[] = [];
    public unityObjectByPathID = new Map<number, UnityObject>();
    public assetInfo: AssetInfo;
    public finishLoadingPromise: Promise<void>;
    public fetcher = new FileDataFetcher();

    private meshCache = new MeshCache();

    constructor(wasm: RustModule, dataFetcher: DataFetcher, private path: string, private filename: string) {
        this.finishLoadingPromise = new Promise(async (resolve, reject) => {
            let headerBytes = (await dataFetcher.fetchData(path, {
                rangeStart: 0,
                rangeSize: MAX_HEADER_LENGTH,
            })).createTypedArray(Uint8Array);

            const assetHeader = wasm.AssetHeader.deserialize(headerBytes);
            if (assetHeader.data_offset > headerBytes.byteLength) {
                // Oops, need to fetch extra bytes...
                const extraBytes = (await dataFetcher.fetchData(path, {
                    rangeStart: headerBytes.byteLength,
                    rangeSize: assetHeader.data_offset - headerBytes.byteLength,
                })).createTypedArray(Uint8Array);
                headerBytes = concatBufs(headerBytes, extraBytes);
            }

            assetHeader.free();
            this.assetInfo = wasm.AssetInfo.deserialize(headerBytes);
            this.unityObject = loadWasmBindgenArray(this.assetInfo.get_objects());
            for (let i = 0; i < this.unityObject.length; i++)
                this.unityObjectByPathID.set(this.unityObject[i].path_id, this.unityObject[i]);
            resolve(null!);
        });
    }

    public fetchData(dataFetcher: DataFetcher): Promise<void> {
        return this.fetcher.fetch(dataFetcher, this.path);
    }

    private createLocation(pathID: number): AssetLocation {
        return { file: this, pathID };
    }

    public async fetchObject(pathID: number): Promise<AssetObjectData> {
        const obj = assertExists(this.unityObjectByPathID.get(pathID));
        const buffer = await this.fetcher.addRequest(obj.byte_start.valueOf(), obj.byte_size);

        const location = this.createLocation(pathID);
        const classID = obj.class_id;
        const assetInfo = this.assetInfo;
        const data = buffer.createTypedArray(Uint8Array);
        return { location, classID, assetInfo, data };
    }

    private fetchExternalFile(assetSystem: UnityAssetSystem, pptr: PPtr): Promise<AssetFile> {
        const externalFilename = assertExists(this.assetInfo.get_external_path(pptr.file_index));
        return assetSystem.fetchAssetFile(externalFilename);
    }

    public async fetchPPtr(assetSystem: UnityAssetSystem, pptr: PPtr): Promise<AssetObjectData> {
        if (pptr.file_index === 0) {
            return this.fetchObject(pptr.path_id);
        } else {
            const externalFile = await this.fetchExternalFile(assetSystem, pptr);
            return externalFile.fetchObject(pptr.path_id);
        }
    }

    private fetchMeshDataInternal(assetSystem: UnityAssetSystem, pathID: number): Promise<UnityMesh> {
        return this.meshCache.fetch(assetSystem, this, pathID);
    }

    public async fetchMeshData(assetSystem: UnityAssetSystem, pptr: PPtr): Promise<UnityMesh | null> {
        if (pptr.path_id === 0)
            return null;

        if (pptr.file_index === 0) {
            return this.fetchMeshDataInternal(assetSystem, pptr.path_id);
        } else {
            const externalFile = await this.fetchExternalFile(assetSystem, pptr);
            return externalFile.fetchMeshDataInternal(assetSystem, pptr.path_id);
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.assetInfo !== null)
            this.assetInfo.free();
        for (let i = 0; i < this.unityObject.length; i++)
            this.unityObject[i].free();
        this.meshCache.destroy(device);
    }
}

export class UnityAssetSystem {
    private assetFiles = new Map<string, AssetFile>();

    constructor(public wasm: RustModule, public device: GfxDevice, private dataFetcher: DataFetcher, private basePath: string) {
    }

    public async fetchBytes(filename: string, range: Range): Promise<Uint8Array> {
        let res = await this.dataFetcher.fetchData(`${this.basePath}/${filename}`, range);
        return new Uint8Array(res.arrayBuffer);
    }

    public async fetchStreamingInfo(streamingInfo: UnityStreamingInfo): Promise<Uint8Array> {
        return await this.fetchBytes(streamingInfo.path, {
            rangeStart: streamingInfo.offset,
            rangeSize: streamingInfo.size,
        });
    }

    public fetchAssetFile(filename: string): Promise<AssetFile> {
        if (!this.assetFiles.has(filename)) {
            const path = `${this.basePath}/${filename}`;
            const assetFile = new AssetFile(this.wasm, this.dataFetcher, path, filename);
            this.assetFiles.set(filename, assetFile);
        }

        const assetFile = this.assetFiles.get(filename)!;
        return this.assetFiles.get(filename)!.finishLoadingPromise.then(() => assetFile);
    }

    private hasDataToFetch(): boolean {
        for (const v of this.assetFiles.values())
            if (v.fetcher.pendingRequests.length > 0)
                return true;
        return false;
    }

    private fetchData(): Promise<void> {
        const assetFiles = [...this.assetFiles.values()];
        return Promise.all(assetFiles.map((v) => v.fetchData(this.dataFetcher))) as unknown as Promise<void>;
    }

    public async waitForLoad(): Promise<void> {
        while (this.hasDataToFetch())
            await this.fetchData();
    }

    public update(): void {
        for (const v of this.assetFiles.values())
            v.fetchData(this.dataFetcher);
    }

    public destroy(device: GfxDevice): void {
        for (const v of this.assetFiles.values())
            v.destroy(device);
    }
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
    public submeshes: SubMesh[];
    public indexBufferStride: number;

    constructor(public inputLayout: GfxInputLayout, public inputState: GfxInputState, public numIndices: number, bbox: UnityAABB, public buffers: GfxBuffer[], submeshes: SubMeshArray, public indexBufferFormat: GfxFormat) {
        let center = vec3.fromValues(bbox.center.x, bbox.center.y, bbox.center.z);
        let extent = vec3.fromValues(bbox.extent.x, bbox.extent.y, bbox.extent.z);
        this.bbox = new Geometry.AABB();
        this.bbox.setFromCenterAndExtents(center, extent);
        this.submeshes = [];
        for (let i=0; i<submeshes.length; i++) {
            this.submeshes.push(submeshes.get(i))
        }

        this.indexBufferStride = getFormatCompByteSize(this.indexBufferFormat);
    }

    public destroy(device: GfxDevice) {
        this.buffers.forEach(buf => device.destroyBuffer(buf));
        device.destroyInputState(this.inputState);
        device.destroyInputLayout(this.inputLayout);
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

    return new UnityMesh(layout, state, indices.length, mesh.local_aabb, buffers, mesh.get_submeshes(), indexBufferFormat);
}

function vertexFormatToGfxFormatBase(wasm: RustModule, vertexFormat: VertexFormat): GfxFormat {
    switch (vertexFormat) {
        case wasm!.VertexFormat.Float: return GfxFormat.F32_R;
        case wasm!.VertexFormat.Float16: return GfxFormat.F16_R;
        case wasm!.VertexFormat.UNorm8: return GfxFormat.U8_R_NORM;
        case wasm!.VertexFormat.SNorm8: return GfxFormat.S8_R_NORM;
        case wasm!.VertexFormat.UNorm16: return GfxFormat.U16_R_NORM;
        case wasm!.VertexFormat.SNorm16: return GfxFormat.S16_R_NORM;
        case wasm!.VertexFormat.UInt8: return GfxFormat.U8_R;
        case wasm!.VertexFormat.SInt8: return GfxFormat.S8_R;
        case wasm!.VertexFormat.UInt16: return GfxFormat.U16_R;
        case wasm!.VertexFormat.SInt16: return GfxFormat.S16_R;
        case wasm!.VertexFormat.UInt32: return GfxFormat.U32_R;
        case wasm!.VertexFormat.SInt32: return GfxFormat.S32_R;
        default:
            throw new Error(`didn't recognize format ${vertexFormat}`);
    }
}

function vertexFormatToGfxFormat(wasm: RustModule, vertexFormat: VertexFormat, dimension: number): GfxFormat {
    const baseFormat = vertexFormatToGfxFormatBase(wasm, vertexFormat);
    const compFlags = dimension as FormatCompFlags;
    return setFormatCompFlags(baseFormat, compFlags);
}

function channelInfoToVertexAttributeDescriptor(wasm: RustModule, location: number, channelInfo: ChannelInfo): GfxVertexAttributeDescriptor {
    const { stream, offset, format, dimension } = channelInfo;
    const gfxFormat = vertexFormatToGfxFormat(wasm, format, dimension);
    assert(stream === 0); // TODO: Handle more than one stream
    return { location: location, bufferIndex: stream, bufferByteOffset: offset, format: gfxFormat };
}

function loadMesh(wasm: RustModule, device: GfxDevice, mesh: Mesh): UnityMesh {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    vertexAttributeDescriptors.push(channelInfoToVertexAttributeDescriptor(wasm, UnityChannel.Vertex, mesh.get_channel_info(0)!));
    vertexAttributeDescriptors.push(channelInfoToVertexAttributeDescriptor(wasm, UnityChannel.Normal, mesh.get_channel_info(1)!));
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [{
        byteStride: mesh.get_vertex_stream_info(0)!.stride,
        frequency: GfxVertexBufferFrequency.PerVertex,
    }];

    let indices = mesh.get_index_data();
    let indexBufferFormat: GfxFormat;
    let numIndices = 0;
    if (mesh.index_format === wasm.IndexFormat.UInt32) {
        indexBufferFormat = GfxFormat.U32_R;
        numIndices = indices.length / 4;
    } else {
        indexBufferFormat = GfxFormat.U16_R;
        numIndices = indices.length / 2;
    }

    let vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mesh.get_vertex_data());
    let trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices);

    let layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    let state = device.createInputState(layout, [
        { buffer: vertsBuf, byteOffset: 0 },
    ], { buffer: trisBuf, byteOffset: 0 });
    let buffers = [vertsBuf, trisBuf];

    return new UnityMesh(layout, state,  numIndices, mesh.local_aabb, buffers, mesh.get_submeshes(), indexBufferFormat);
}
