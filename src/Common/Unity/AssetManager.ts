
import { vec3, vec4 } from 'gl-matrix';
import { UnityVersion, UnityAssetFile, UnityAssetFileObject, UnityClassID, UnityGameObject, UnityPPtr, UnityStreamingInfo, UnityMesh, UnityMeshCompression, UnityVertexFormat, UnitySubMesh, UnityAABB } from '../../../rust/pkg/noclip_support';
import ArrayBufferSlice from '../../ArrayBufferSlice.js';
import { Color, TransparentBlack, colorNewFromRGBA } from '../../Color.js';
import { DataFetcher } from '../../DataFetcher.js';
import { downloadBlob } from '../../DownloadUtils.js';
import * as Geometry from '../../Geometry.js';
import { Destroyable, SceneContext } from '../../SceneBase.js';
import { TextureMapping } from '../../TextureHolder.js';
import { coalesceBuffer, makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers.js';
import { fillColor, fillVec4, fillVec4v } from '../../gfx/helpers/UniformBufferHelpers.js';
import { GfxBufferUsage, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxSampler, GfxSamplerDescriptor, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from '../../gfx/platform/GfxPlatform.js';
import { FormatCompFlags, getFormatCompByteSize, setFormatCompFlags } from '../../gfx/platform/GfxPlatformFormat.js';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache.js';
import { rust } from '../../rustlib.js';
import { assert, assertExists, fallbackUndefined } from '../../util.js';

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
    pathID: BigInt;
}

export interface AssetObjectData {
    location: AssetLocation;
    classID: UnityClassID;
    assetFile: UnityAssetFile;
    data: Uint8Array;
}

// An AssetFile is a single serialized asset file in the filesystem, aka sharedassets or a level file.

export const enum UnityAssetResourceType {
    Mesh,
    Texture2D,
    Material,
    Shader,
}

type ResType<T extends UnityAssetResourceType> =
    T extends UnityAssetResourceType.Mesh ? UnityMeshData :
    T extends UnityAssetResourceType.Texture2D ? UnityTexture2DData :
    T extends UnityAssetResourceType.Material ? UnityMaterialData :
    T extends UnityAssetResourceType.Shader ? UnityShaderData :
    never;

type CreateFunc<T> = (assetSystem: UnityAssetSystem, objData: AssetObjectData) => Promise<T | null>;

export class AssetFile {
    public unityObjects: UnityAssetFileObject[] = [];
    public unityObjectByFileID = new Map<BigInt, UnityAssetFileObject>();
    public assetFile: UnityAssetFile;
    public fetcher: FileDataFetcher | null = null;
    public fullData: ArrayBufferSlice | null;

    private waitForHeaderPromise: Promise<void> | null;
    private dataCache = new Map<BigInt, Destroyable | null>();
    private promiseCache = new Map<BigInt, Promise<Destroyable | null>>();

    constructor(private path: string) {
    }

    private doneLoadingHeader(buffer: Uint8Array): void {
        this.assetFile.append_metadata_chunk(buffer);
        this.unityObjects = this.assetFile.get_objects();
        for (let i = 0; i < this.unityObjects.length; i++)
            this.unityObjectByFileID.set(this.unityObjects[i].file_id, this.unityObjects[i]);
        this.waitForHeaderPromise = null;
    }

    public waitForHeader(): Promise<void> {
        return assertExists(this.waitForHeaderPromise);
    }

    private async initFullInternal(dataFetcher: DataFetcher): Promise<void> {
        this.fullData = await dataFetcher.fetchData(this.path);
        this.doneLoadingHeader(this.fullData.createTypedArray(Uint8Array));
    }

    public initFull(dataFetcher: DataFetcher): void {
        assert(this.waitForHeaderPromise === undefined);
        this.waitForHeaderPromise = this.initFullInternal(dataFetcher);
    }

    private async initPartialInternal(dataFetcher: DataFetcher): Promise<void> {
        let headerBytes = (await dataFetcher.fetchData(this.path, {
            rangeStart: 0,
            rangeSize: MAX_HEADER_LENGTH,
        })).createTypedArray(Uint8Array);

        this.assetFile = rust.UnityAssetFile.initialize_with_header_chunk(headerBytes);
        const dataOffset = this.assetFile.get_data_offset();
        if (dataOffset > headerBytes.byteLength) {
            // Oops, need to fetch extra bytes...
            const extraBytes = (await dataFetcher.fetchData(this.path, {
                rangeStart: headerBytes.byteLength,
                rangeSize: dataOffset - BigInt(headerBytes.byteLength),
            })).createTypedArray(Uint8Array);
            headerBytes = concatBufs(headerBytes, extraBytes);
        }

        this.fetcher = new FileDataFetcher();
        this.doneLoadingHeader(headerBytes);
    }

    public initPartial(dataFetcher: DataFetcher): void {
        assert(this.waitForHeaderPromise === undefined);
        this.waitForHeaderPromise = this.initPartialInternal(dataFetcher);
    }

    public hasDataToFetch(): boolean {
        if (this.fetcher !== null)
            return this.fetcher.pendingRequests.length > 0;
        return false;
    }

    public fetchData(dataFetcher: DataFetcher): Promise<void> {
        assert(this.fetcher !== null && this.hasDataToFetch());
        return this.fetcher.fetch(dataFetcher, this.path);
    }

    private createLocation(pathID: BigInt): AssetLocation {
        return { file: this, pathID };
    }

    public async fetchObject(pathID: BigInt): Promise<AssetObjectData> {
        if (this.waitForHeaderPromise !== null)
            await this.waitForHeaderPromise;

        const obj = assertExists(this.unityObjectByFileID.get(pathID));

        let buffer: ArrayBufferSlice;
        if (this.fetcher !== null)
            buffer = await this.fetcher.addRequest(obj.byte_start.valueOf(), obj.byte_size);
        else if (this.fullData !== null)
            buffer = this.fullData.subarray(Number(obj.byte_start), obj.byte_size);
        else
            throw "whoops";

        const location = this.createLocation(pathID);
        const classID = obj.class_id;
        const data = buffer.createTypedArray(Uint8Array);
        return { location, classID, assetFile: this.assetFile, data };
    }

    public getPPtrFile(assetSystem: UnityAssetSystem, pptr: UnityPPtr): AssetFile {
        if (pptr.file_index === 0) {
            return this;
        } else {
            const externalFilename = assertExists(this.assetFile.get_external_path(pptr));
            return assetSystem.fetchAssetFile(externalFilename, true);
        }
    }

    private createMeshData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityMeshData> => {
        const mesh = rust.UnityMesh.create(UnityVersion.V2019_4_39f1, objData.data);
        const streamingInfo: UnityStreamingInfo = mesh.stream_data;
        if (streamingInfo.path.length !== 0) {
            const buf = await assetSystem.fetchStreamingInfo(streamingInfo);
            const vertexData = rust.UnityVertexData.create(UnityVersion.V2019_4_39f1, buf.createTypedArray(Uint8Array));
            mesh.set_vertex_data(vertexData);
        }

        if (mesh.mesh_compression !== UnityMeshCompression.Off) {
            return loadCompressedMesh(assetSystem.device, mesh);
        } else {
            return loadMesh(assetSystem.device, mesh);
        }
    };

    private createTexture2DData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityTexture2DData | null> => {
        if (objData.classID !== rust.UnityClassID.Texture2D)
            return null;

        const header = rust.UnityTexture2D.from_bytes(objData.data, objData.assetFile);
        let data = header.image_data;
        if (data.length === 0) {
            const streaming_info = header.streaming_info;
            assert(streaming_info.size > 0);
            data = (await assetSystem.fetchStreamingInfo(streaming_info)).createTypedArray(Uint8Array);
            streaming_info.free();
        }
        return new UnityTexture2DData(assetSystem.renderCache, header, data);
    };

    private createMaterialData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityMaterialData> => {
        const header = rust.UnityMaterial.from_bytes(objData.data, objData.assetFile);
        const materialData = new UnityMaterialData(objData.location, header);
        await materialData.load(assetSystem);
        return materialData;
    };

    private createShaderData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityShaderData> => {
        const header = rust.UnityShader.from_bytes(objData.data, objData.assetFile);
        return new UnityShaderData(objData.location, header);
    };

    private fetchFromCache<T extends Destroyable>(assetSystem: UnityAssetSystem, pathID: BigInt, createFunc: CreateFunc<T>): Promise<T | null> {
        if (this.promiseCache.has(pathID))
            return this.promiseCache.get(pathID)! as Promise<T>;

        const promise = this.fetchObject(pathID).then((objData) => {
            return createFunc(assetSystem, objData).then((v) => {
                this.dataCache.set(pathID, v);
                return v;
            });
        });
        this.promiseCache.set(pathID, promise);
        return promise;
    }

    public async fetchResource<T extends UnityAssetResourceType>(assetSystem: UnityAssetSystem, type: T, pathID: number): Promise<ResType<T> | null> {
        if (pathID === 0)
            return null;

        if (type === UnityAssetResourceType.Mesh)
            return this.fetchFromCache(assetSystem, pathID, this.createMeshData) as Promise<ResType<T>>;
        else if (type === UnityAssetResourceType.Texture2D)
            return this.fetchFromCache(assetSystem, pathID, this.createTexture2DData) as Promise<ResType<T>>;
        else if (type === UnityAssetResourceType.Material)
            return this.fetchFromCache(assetSystem, pathID, this.createMaterialData) as Promise<ResType<T>>;
        else if (type === UnityAssetResourceType.Shader)
            return this.fetchFromCache(assetSystem, pathID, this.createShaderData) as Promise<ResType<T>>;
        else
            throw "whoops";
    }

    public destroy(device: GfxDevice): void {
        if (this.assetFile !== null)
            this.assetFile.free();
        for (let i = 0; i < this.unityObjects.length; i++)
            this.unityObjects[i].free();
        for (const v of this.dataCache.values())
            if (v !== null)
                v.destroy(device);
    }
}

export class UnityAssetSystem {
    private assetFiles = new Map<string, AssetFile>();
    public renderCache: GfxRenderCache;

    constructor(public device: GfxDevice, private dataFetcher: DataFetcher, private basePath: string) {
        this.renderCache = new GfxRenderCache(this.device);
    }

    public async fetchBytes(filename: string, range: Range): Promise<ArrayBufferSlice> {
        return await this.dataFetcher.fetchData(`${this.basePath}/${filename}`, range);
    }

    public async fetchStreamingInfo(streamingInfo: UnityStreamingInfo): Promise<ArrayBufferSlice> {
        assert(streamingInfo.size !== 0);
        return await this.fetchBytes(streamingInfo.path, {
            rangeStart: streamingInfo.offset,
            rangeSize: streamingInfo.size,
        });
    }

    public fetchAssetFile(filename: string, partial: boolean): AssetFile {
        if (!this.assetFiles.has(filename)) {
            const path = `${this.basePath}/${filename}`;
            const assetFile = new AssetFile(path);
            if (partial)
                assetFile.initPartial(this.dataFetcher);
            else
                assetFile.initFull(this.dataFetcher);
            this.assetFiles.set(filename, assetFile);
        }

        const assetFile = this.assetFiles.get(filename)!;
        return assetFile;
    }

    public async fetchPPtr(location: AssetLocation, pptr: UnityPPtr): Promise<AssetObjectData> {
        const assetFile = location.file.getPPtrFile(this, pptr);
        return assetFile.fetchObject(pptr.path_id);
    }

    public async fetchResource<T extends UnityAssetResourceType>(type: T, location: AssetLocation, pptr: UnityPPtr): Promise<ResType<T> | null> {
        const assetFile = location.file.getPPtrFile(this, pptr);
        return assetFile.fetchResource(this, type, pptr.path_id);
    }

    private hasDataToFetch(): boolean {
        for (const v of this.assetFiles.values())
            if (v.hasDataToFetch())
                return true;
        return false;
    }

    private fetchData(): Promise<void> {
        const promises = [];
        for (const v of this.assetFiles.values())
            if (v.hasDataToFetch())
                promises.push(v.fetchData(this.dataFetcher));
        return Promise.all(promises) as unknown as Promise<void>;
    }

    public async waitForLoad(): Promise<void> {
        while (this.hasDataToFetch())
            await this.fetchData();
    }

    public update(): void {
        for (const v of this.assetFiles.values())
            if (v.hasDataToFetch())
                v.fetchData(this.dataFetcher);
    }

    public destroy(device: GfxDevice): void {
        this.renderCache.destroy();
        for (const v of this.assetFiles.values())
            v.destroy(device);
    }
}

export enum UnityChannel {
    Vertex,
    Normal,
    Tangent,
    Color,
    TexCoord0,
    TexCoord1,
    TexCoord2,
    TexCoord3,
    TexCoord4,
    TexCoord5,
    TexCoord6,
    TexCoord7,
    BlendWeight,
    BlendIndices,
    Max,
}

export class UnityMeshData {
    public bbox = new Geometry.AABB();
    public submeshes: UnitySubMesh[];
    public indexBufferStride: number;

    constructor(public inputLayout: GfxInputLayout, public vertexBuffers: GfxVertexBufferDescriptor[], public indexBuffer: GfxIndexBufferDescriptor, bbox: UnityAABB, submeshes: UnitySubMesh[], public indexBufferFormat: GfxFormat) {
        const center = vec3.fromValues(bbox.center.x, bbox.center.y, bbox.center.z);
        const extent = vec3.fromValues(bbox.extent.x, bbox.extent.y, bbox.extent.z);
        this.bbox.setFromCenterAndExtents(center, extent);
        this.submeshes = submeshes;
        this.indexBufferStride = getFormatCompByteSize(this.indexBufferFormat);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffers[0].buffer);
        device.destroyBuffer(this.indexBuffer.buffer);
        device.destroyInputLayout(this.inputLayout);
    }
}

function loadCompressedMesh(device: GfxDevice, mesh: UnityMesh): UnityMeshData {
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
    const layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    const indexData = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices.buffer);
    const vertexBuffers = coalesceBuffer(device, GfxBufferUsage.Vertex, [new ArrayBufferSlice(vertices.buffer), new ArrayBufferSlice(normals.buffer)]);
    const indexBuffer = { buffer: indexData, byteOffset: 0 };
    return new UnityMeshData(layout, vertexBuffers, indexBuffer, mesh.local_aabb, mesh.submeshes, indexBufferFormat);
}

function vertexFormatToGfxFormatBase(vertexFormat: UnityVertexFormat): GfxFormat {
    switch (vertexFormat) {
        case rust.UnityVertexFormat.Float: return GfxFormat.F32_R;
        case rust.UnityVertexFormat.Float16: return GfxFormat.F16_R;
        case rust.UnityVertexFormat.UNorm8: return GfxFormat.U8_R_NORM;
        case rust.UnityVertexFormat.SNorm8: return GfxFormat.S8_R_NORM;
        case rust.UnityVertexFormat.UNorm16: return GfxFormat.U16_R_NORM;
        case rust.UnityVertexFormat.SNorm16: return GfxFormat.S16_R_NORM;
        case rust.UnityVertexFormat.UInt8: return GfxFormat.U8_R;
        case rust.UnityVertexFormat.SInt8: return GfxFormat.S8_R;
        case rust.UnityVertexFormat.UInt16: return GfxFormat.U16_R;
        case rust.UnityVertexFormat.SInt16: return GfxFormat.S16_R;
        case rust.UnityVertexFormat.UInt32: return GfxFormat.U32_R;
        case rust.UnityVertexFormat.SInt32: return GfxFormat.S32_R;
        default:
            throw new Error(`didn't recognize format ${vertexFormat}`);
    }
}

function vertexFormatToGfxFormat(vertexFormat: VertexFormat, dimension: number): GfxFormat {
    const baseFormat = vertexFormatToGfxFormatBase(vertexFormat);
    const compFlags = dimension as FormatCompFlags;
    return setFormatCompFlags(baseFormat, compFlags);
}

function channelInfoToVertexAttributeDescriptor(location: number, channelInfo: ChannelInfo): GfxVertexAttributeDescriptor | null {
    if (channelInfo === undefined)
        return null;

    const { stream, offset, format, dimension } = channelInfo;
    if (dimension === 0)
        return null;

    const gfxFormat = vertexFormatToGfxFormat(format, dimension);
    return { location: location, bufferIndex: stream, bufferByteOffset: offset, format: gfxFormat };
}

function loadMesh(device: GfxDevice, mesh: Mesh): UnityMeshData {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    const layoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
    const stateBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    const vertData = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mesh.get_vertex_data().buffer);
    const indexData = makeStaticDataBuffer(device, GfxBufferUsage.Index, mesh.get_index_data().buffer);

    for (let i = 0; i < mesh.get_channel_count(); i++) {
        const desc = channelInfoToVertexAttributeDescriptor(i, mesh.get_channel_info(i)!);
        if (desc !== null)
            vertexAttributeDescriptors.push(desc);
    }

    for (let i = 0; i < mesh.get_vertex_stream_count(); i++) {
        const stream = mesh.get_vertex_stream_info(i)!;
        layoutBufferDescriptors.push({
            byteStride: stream.stride,
            frequency: GfxVertexBufferFrequency.PerVertex,
        });
        stateBufferDescriptors.push({ buffer: vertData, byteOffset: stream.offset });
    }

    const indexBufferFormat = (mesh.index_format === rust.IndexFormat.UInt32) ? GfxFormat.U32_R : GfxFormat.U16_R;
    const layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: layoutBufferDescriptors, indexBufferFormat });
    const indexBuffer = { buffer: indexData, byteOffset: 0 };
    return new UnityMeshData(layout, stateBufferDescriptors, indexBuffer, mesh.local_aabb, mesh.get_submeshes(), indexBufferFormat);
}

function translateTextureFormat(fmt: UnityTextureFormat, colorSpace: UnityColorSpace): GfxFormat {
    if (fmt === rust.UnityTextureFormat.BC1 && colorSpace === rust.UnityColorSpace.Linear)
        return GfxFormat.BC1;
    else if (fmt === rust.UnityTextureFormat.BC1 && colorSpace === rust.UnityColorSpace.SRGB)
        return GfxFormat.BC1_SRGB;
    else if (fmt === rust.UnityTextureFormat.BC3 && colorSpace === rust.UnityColorSpace.Linear)
        return GfxFormat.BC3;
    else if (fmt === rust.UnityTextureFormat.BC3 && colorSpace === rust.UnityColorSpace.SRGB)
        return GfxFormat.BC3_SRGB;
    else if (fmt === rust.UnityTextureFormat.RGB24 && colorSpace === rust.UnityColorSpace.Linear)
        return GfxFormat.U8_RGBA_NORM;
    else if (fmt === rust.UnityTextureFormat.RGB24 && colorSpace === rust.UnityColorSpace.SRGB)
        return GfxFormat.U8_RGBA_SRGB;
    else if (fmt === rust.UnityTextureFormat.RGBA32 && colorSpace === rust.UnityColorSpace.Linear)
        return GfxFormat.U8_RGBA_NORM;
    else if (fmt === rust.UnityTextureFormat.RGBA32 && colorSpace === rust.UnityColorSpace.SRGB)
        return GfxFormat.U8_RGBA_SRGB;
    else if (fmt === rust.UnityTextureFormat.ARGB32 && colorSpace === rust.UnityColorSpace.Linear)
        return GfxFormat.U8_RGBA_NORM;
    else if (fmt === rust.UnityTextureFormat.ARGB32 && colorSpace === rust.UnityColorSpace.SRGB)
        return GfxFormat.U8_RGBA_SRGB;
    else if (fmt === rust.UnityTextureFormat.DXT1Crunched && colorSpace === rust.UnityColorSpace.Linear)
        return GfxFormat.BC1;
    else if (fmt === rust.UnityTextureFormat.DXT1Crunched && colorSpace === rust.UnityColorSpace.SRGB)
        return GfxFormat.BC1_SRGB;
    else if (fmt === rust.UnityTextureFormat.DXT5Crunched && colorSpace === rust.UnityColorSpace.Linear)
        return GfxFormat.BC3;
    else if (fmt === rust.UnityTextureFormat.DXT5Crunched && colorSpace === rust.UnityColorSpace.SRGB)
        return GfxFormat.BC3_SRGB;
    else if (fmt === rust.UnityTextureFormat.BC7 && colorSpace === rust.UnityColorSpace.Linear)
        return GfxFormat.BC7;
    else if (fmt === rust.UnityTextureFormat.BC7 && colorSpace === rust.UnityColorSpace.SRGB)
        return GfxFormat.BC7_SRGB;
    else
        throw "whoops";
}

function translateWrapMode(v: number): GfxWrapMode {
    if (v === rust.UnityTextureWrapMode.Repeat)
        return GfxWrapMode.Repeat;
    else if (v === rust.UnityTextureWrapMode.Clamp)
        return GfxWrapMode.Clamp;
    else if (v === rust.UnityTextureWrapMode.Mirror)
        return GfxWrapMode.Mirror;
    else if (v === rust.UnityTextureWrapMode.MirrorOnce)
        return GfxWrapMode.Mirror; // TODO(jstpierre): what to do here?
    else
        throw "whoops";
}

function translateSampler(header: UnityTextureSettings): GfxSamplerDescriptor {
    const mipFilterMode = (header.filter_mode === rust.UnityTextureFilterMode.Trilinear) ? GfxMipFilterMode.Linear : GfxMipFilterMode.Nearest;
    const texFilterMode = (header.filter_mode >= rust.UnityTextureFilterMode.Bilinear) ? GfxTexFilterMode.Bilinear : GfxTexFilterMode.Point;

    // Mip bias needs to be handled in shader...

    return {
        magFilter: texFilterMode,
        minFilter: texFilterMode,
        mipFilter: mipFilterMode,
        wrapS: translateWrapMode(header.wrap_u),
        wrapT: translateWrapMode(header.wrap_v),
        wrapQ: translateWrapMode(header.wrap_w),
        maxAnisotropy: header.filter_mode === rust.UnityTextureFilterMode.Trilinear ? header.aniso : 1,
    };
}

function calcLevelSize(fmt: UnityTextureFormat, w: number, h: number): number {
    if (fmt === rust.UnityTextureFormat.BC1 || fmt === rust.UnityTextureFormat.BC2 || fmt === rust.UnityTextureFormat.BC3 || fmt === rust.UnityTextureFormat.BC6H || fmt === rust.UnityTextureFormat.BC7|| fmt === rust.UnityTextureFormat.DXT1Crunched || fmt === rust.UnityTextureFormat.DXT5Crunched) {
        w = Math.max(w, 4);
        h = Math.max(h, 4);
        const depth = 1;
        const count = ((w * h) / 16) * depth;
        if (fmt === rust.UnityTextureFormat.BC1 || fmt === rust.UnityTextureFormat.DXT1Crunched)
            return count * 8;
        else if (fmt === rust.UnityTextureFormat.BC2)
            return count * 16;
        else if (fmt === rust.UnityTextureFormat.BC3 || fmt === rust.UnityTextureFormat.DXT5Crunched)
            return count * 16;
        else if (fmt === rust.UnityTextureFormat.BC6H)
            return count * 16;
        else if (fmt === rust.UnityTextureFormat.BC7)
            return count * 16;
        else
            throw "whoops";
    } else if (fmt === rust.UnityTextureFormat.Alpha8) {
        return w * h;
    } else if (fmt === rust.UnityTextureFormat.RGB24) {
        return w * h * 4;
    } else if (fmt === rust.UnityTextureFormat.RGBA32) {
        return w * h * 4;
    } else if (fmt === rust.UnityTextureFormat.ARGB32) {
        return w * h * 4;
    } else {
        throw "whoops";
    }
}

function imageFormatConvertData(d: Uint8Array, fmt: UnityTextureFormat): Uint8Array {
    if (fmt === rust.UnityTextureFormat.ARGB32) {
        for (let i = 0; i < d.length; i += 4) {
            const a = d[i+0], r = d[i+1], g = d[i+2], b = d[i+3];
            d[i+0] = r; d[i+1] = g; d[i+2] = b; d[i+3] = a;
        }
        return d;
    } else if (fmt === rust.UnityTextureFormat.RGB24) {
        const o = new Uint8Array((d.length * 4) / 3);
        for (let di = 0, oi = 0; di < d.length;) {
            o[oi++] = d[di++];
            o[oi++] = d[di++];
            o[oi++] = d[di++];
            o[oi++] = 0xFF;
        }
        return o;
    } else {
        return d;
    }
}

function calcLevels(buffer: Uint8Array, fmt: UnityTextureFormat, w: number, h: number, numLevels: number): ArrayBufferView[] {
    let offset = 0;
    const views: ArrayBufferView[] = [];
    for (let i = 0; i < numLevels; i++) {
        const levelSize = calcLevelSize(fmt, w, h);
        views.push(buffer.subarray(offset, offset + levelSize));
        offset += levelSize;
        w = Math.max(w >>> 1, 1);
        h = Math.max(h >>> 1, 1);
    }
    return views;
}

export class UnityTexture2DData {
    public gfxTexture: GfxTexture;
    public gfxSampler: GfxSampler;

    constructor(cache: GfxRenderCache, private header: UnityTexture2D, data: Uint8Array) {
        const device = cache.device;
        const pixelFormat = translateTextureFormat(header.texture_format, header.color_space);
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(pixelFormat, header.width, header.height, header.mipmap_count));

        this.gfxSampler = cache.createSampler(translateSampler(header.texture_settings));

        // TODO(jstpierre): Support crunched formats
        if (header.texture_format === rust.UnityTextureFormat.DXT1Crunched) {
            console.warn(`DXT1Crunched ${this.header.name}`);
            return;
        }
        if (header.texture_format === rust.UnityTextureFormat.DXT5Crunched) {
            console.warn(`DXT5Crunched ${this.header.name}`);
            return;
        }

        const oData = imageFormatConvertData(data, header.texture_format);
        const levels = calcLevels(oData, header.texture_format, header.width, header.height, header.mipmap_count);
        device.uploadTextureData(this.gfxTexture, 0, levels);
    }

    public fillTextureMapping(dst: TextureMapping): void {
        dst.gfxTexture = this.gfxTexture;
        dst.gfxSampler = this.gfxSampler;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
        this.header.free();
    }
}

export class UnityMaterialData {
    public name: string;
    public shaderName: string;

    public texEnvName: string[] = [];
    public texture: (UnityTexture2DData | null)[] = [];
    public textureST: vec4[] = [];

    public colorName: string[] = [];
    public color: Color[] = [];

    public floatName: string[] = [];
    public float: number[] = [];

    constructor(private location: AssetLocation, private header: UnityMaterial) {
        this.name = this.header.name;
    }

    public findTexEnv(name: string): number {
        return this.texEnvName.indexOf(name);
    }

    public fillTextureMapping(dst: TextureMapping, name: string): boolean {
        const idx = this.findTexEnv(name);
        if (idx >= 0 && this.texture[idx] !== null) {
            dst.gfxTexture = this.texture[idx]!.gfxTexture;
            dst.gfxSampler = this.texture[idx]!.gfxSampler;
            return true;
        } else {
            dst.reset();
            return false;
        }
    }

    public fillTexEnvScaleBias(d: Float32Array, offs: number, name: string): number {
        const idx = this.findTexEnv(name);
        if (idx >= 0) {
            return fillVec4v(d, offs, this.textureST[idx]);
        } else {
            return fillVec4(d, offs, 1, 1, 0, 0);
        }
    }

    public getColor(name: string): Color | null {
        const idx = this.colorName.indexOf(name);
        return fallbackUndefined(this.color[idx], null);
    }

    public fillColor(d: Float32Array, offs: number, name: string): number {
        const idx = this.colorName.indexOf(name);
        if (idx >= 0) {
            return fillColor(d, offs, this.color[idx]);
        } else {
            return fillColor(d, offs, TransparentBlack);
        }
    }

    public getFloat(name: string): number | null {
        const idx = this.floatName.indexOf(name);
        return fallbackUndefined(this.float[idx], null);
    }

    public async load(assetSystem: UnityAssetSystem) {
        const saved_properties = this.header.saved_properties;

        const texEnvCount = saved_properties.get_tex_env_count();
        for (let i = 0; i < texEnvCount; i++) {
            const texEnvName = saved_properties.get_tex_env_name(i);
            this.texEnvName[i] = texEnvName;

            const texEnv = saved_properties.get_tex_env(i)!;
            this.texture[i] = await assetSystem.fetchResource(UnityAssetResourceType.Texture2D, this.location, texEnv.texture);
            this.textureST[i] = vec4.fromValues(texEnv.scale.x, texEnv.scale.y, texEnv.offset.x, texEnv.offset.y);
            texEnv.free();
        }

        for (let i = 0; i < saved_properties.get_color_count(); i++) {
            const colorName = saved_properties.get_color_name(i);
            this.colorName[i] = colorName;

            const color = saved_properties.get_color(i);
            this.color[i] = colorNewFromRGBA(color.r, color.g, color.b, color.a);
            color.free();
        }

        for (let i = 0; i < saved_properties.get_float_count(); i++) {
            const floatName = saved_properties.get_float_name(i);
            this.floatName[i] = floatName;

            this.float[i] = saved_properties.get_float(i);
        }

        saved_properties.free();

        const shader = (await assetSystem.fetchResource(UnityAssetResourceType.Shader, this.location, this.header.shader))!;
        this.shaderName = shader.name;
    }

    public destroy(device: GfxDevice): void {
        this.header.free();
    }
}

export class UnityShaderData {
    public name: string;

    constructor(private location: AssetLocation, header: UnityShader) {
        this.name = header.name;
        header.free();
    }

    public destroy(device: GfxDevice): void {
    }
}

export async function createUnityAssetSystem(context: SceneContext, basePath: string): Promise<UnityAssetSystem> {
    const runtime = await context.dataShare.ensureObject(`UnityAssetSystem/${basePath}`, async () => {
        return new UnityAssetSystem(context.device, context.dataFetcher, basePath);
    });
    return runtime;
}
