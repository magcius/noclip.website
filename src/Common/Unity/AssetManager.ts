import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';

import type { AssetInfo, Mesh, AABB as UnityAABB, VertexFormat, UnityStreamingInfo, ChannelInfo, UnityClassID, PPtr, SubMesh, SubMeshArray, UnityObject, UnityTextureFormat, UnityTextureFilterMode, UnityTextureWrapMode, UnityColorSpace, UnityTextureSettings, UnityTexture2D, UnityMaterial, UnityShader } from '../../../rust/pkg/index';
import { GfxDevice, GfxBuffer, GfxBufferUsage, GfxInputState, GfxFormat, GfxInputLayout, GfxTexture, GfxSampler, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferDescriptor, GfxWrapMode, GfxSamplerDescriptor, GfxMipFilterMode, GfxTexFilterMode, makeTextureDescriptor2D } from '../../gfx/platform/GfxPlatform';
import { FormatCompFlags, getFormatCompByteSize, setFormatCompFlags } from '../../gfx/platform/GfxPlatformFormat';
import { assert, assertExists } from '../../util';
import * as Geometry from '../../Geometry';
import { vec3 } from 'gl-matrix';
import { DataFetcher } from '../../DataFetcher';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { Destroyable } from '../../SceneBase';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';

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

type CreateFunc<T> = (assetSystem: UnityAssetSystem, objData: AssetObjectData) => Promise<T>;

class AssetFile {
    public unityObject: UnityObject[] = [];
    public unityObjectByPathID = new Map<number, UnityObject>();
    public assetInfo: AssetInfo;
    public fetcher: FileDataFetcher | null = null;
    public fullData: ArrayBufferSlice | null;

    private waitForHeaderPromise: Promise<void> | null;
    private dataCache = new Map<number, Destroyable>();
    private promiseCache = new Map<number, Promise<Destroyable>>();

    constructor(private path: string) {
    }

    private doneLoadingHeader(wasm: RustModule, buffer: Uint8Array): void {
        this.assetInfo = wasm.AssetInfo.deserialize(buffer);
        this.unityObject = loadWasmBindgenArray(this.assetInfo.get_objects());
        for (let i = 0; i < this.unityObject.length; i++)
            this.unityObjectByPathID.set(this.unityObject[i].path_id, this.unityObject[i]);
        this.waitForHeaderPromise = null;
    }

    public waitForHeader(): Promise<void> {
        return assertExists(this.waitForHeaderPromise);
    }

    private async initFullInternal(wasm: RustModule, dataFetcher: DataFetcher): Promise<void> {
        this.fullData = await dataFetcher.fetchData(this.path);
        this.doneLoadingHeader(wasm, this.fullData.createTypedArray(Uint8Array));
    }

    public initFull(wasm: RustModule, dataFetcher: DataFetcher): void {
        assert(this.waitForHeaderPromise === undefined);
        this.waitForHeaderPromise = this.initFullInternal(wasm, dataFetcher);
    }

    private async initPartialInternal(wasm: RustModule, dataFetcher: DataFetcher): Promise<void> {
        let headerBytes = (await dataFetcher.fetchData(this.path, {
            rangeStart: 0,
            rangeSize: MAX_HEADER_LENGTH,
        })).createTypedArray(Uint8Array);

        const assetHeader = wasm.AssetHeader.deserialize(headerBytes);
        if (assetHeader.data_offset > headerBytes.byteLength) {
            // Oops, need to fetch extra bytes...
            const extraBytes = (await dataFetcher.fetchData(this.path, {
                rangeStart: headerBytes.byteLength,
                rangeSize: assetHeader.data_offset - headerBytes.byteLength,
            })).createTypedArray(Uint8Array);
            headerBytes = concatBufs(headerBytes, extraBytes);
        }

        assetHeader.free();
        this.fetcher = new FileDataFetcher();
        this.doneLoadingHeader(wasm, headerBytes);
    }

    public initPartial(wasm: RustModule, dataFetcher: DataFetcher): void {
        assert(this.waitForHeaderPromise === undefined);
        this.waitForHeaderPromise = this.initPartialInternal(wasm, dataFetcher);
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

    private createLocation(pathID: number): AssetLocation {
        return { file: this, pathID };
    }

    public async fetchObject(pathID: number): Promise<AssetObjectData> {
        if (this.waitForHeaderPromise !== null)
            await this.waitForHeaderPromise;

        const obj = assertExists(this.unityObjectByPathID.get(pathID));

        let buffer: ArrayBufferSlice;
        if (this.fetcher !== null)
            buffer = await this.fetcher.addRequest(obj.byte_start.valueOf(), obj.byte_size);
        else if (this.fullData !== null)
            buffer = this.fullData.subarray(Number(obj.byte_start), obj.byte_size);
        else
            throw "whoops";

        const location = this.createLocation(pathID);
        const classID = obj.class_id;
        const assetInfo = this.assetInfo;
        const data = buffer.createTypedArray(Uint8Array);
        return { location, classID, assetInfo, data };
    }

    public getPPtrFile(assetSystem: UnityAssetSystem, pptr: PPtr): AssetFile {
        if (pptr.file_index === 0) {
            return this;
        } else {
            const externalFilename = assertExists(this.assetInfo.get_external_path(pptr.file_index));
            return assetSystem.fetchAssetFile(externalFilename, true);
        }
    }

    private createMeshData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityMeshData> => {
        const mesh = assetSystem.wasm.Mesh.from_bytes(objData.data, objData.assetInfo);
        const streamingInfo: UnityStreamingInfo | undefined = mesh.get_streaming_info();
        if (streamingInfo !== undefined)
            mesh.set_vertex_data(await assetSystem.fetchStreamingInfo(streamingInfo));

        if (mesh.is_compressed()) {
            return loadCompressedMesh(assetSystem.device, mesh);
        } else {
            return loadMesh(assetSystem.wasm, assetSystem.device, mesh);
        }
    };

    private createTexture2DData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityTexture2DData> => {
        const header = assetSystem.wasm.UnityTexture2D.from_bytes(objData.data, objData.assetInfo);
        const data = await assetSystem.fetchStreamingInfo(header.streaming_info);
        return new UnityTexture2DData(assetSystem.wasm, assetSystem.renderCache, header, data);
    };

    private createMaterialData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityMaterialData> => {
        const header = assetSystem.wasm.UnityMaterial.from_bytes(objData.data, objData.assetInfo);
        const materialData = new UnityMaterialData(objData.location, header);
        await materialData.load(assetSystem);
        return materialData;
    };

    private createShaderData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityShaderData> => {
        const header = assetSystem.wasm.UnityShader.from_bytes(objData.data, objData.assetInfo);
        return new UnityShaderData(objData.location, header);
    };

    private fetchFromCache<T extends Destroyable>(assetSystem: UnityAssetSystem, pathID: number, createFunc: CreateFunc<T>): Promise<T> {
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
        if (this.assetInfo !== null)
            this.assetInfo.free();
        for (let i = 0; i < this.unityObject.length; i++)
            this.unityObject[i].free();
        for (const v of this.dataCache.values())
            v.destroy(device);
    }
}

export class UnityAssetSystem {
    private assetFiles = new Map<string, AssetFile>();
    public renderCache: GfxRenderCache;

    constructor(public wasm: RustModule, public device: GfxDevice, private dataFetcher: DataFetcher, private basePath: string) {
        this.renderCache = new GfxRenderCache(this.device);
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

    public fetchAssetFile(filename: string, partial: boolean): AssetFile {
        if (!this.assetFiles.has(filename)) {
            const path = `${this.basePath}/${filename}`;
            const assetFile = new AssetFile(path);
            if (partial)
                assetFile.initPartial(this.wasm, this.dataFetcher);
            else
                assetFile.initFull(this.wasm, this.dataFetcher);
            this.assetFiles.set(filename, assetFile);
        }

        const assetFile = this.assetFiles.get(filename)!;
        return assetFile;
    }

    public async fetchPPtr(location: AssetLocation, pptr: PPtr): Promise<AssetObjectData> {
        const assetFile = location.file.getPPtrFile(this, pptr);
        return assetFile.fetchObject(pptr.path_id);
    }

    public async fetchResource<T extends UnityAssetResourceType>(type: T, location: AssetLocation, pptr: PPtr): Promise<ResType<T> | null> {
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
    public submeshes: SubMesh[];
    public indexBufferStride: number;

    constructor(public inputLayout: GfxInputLayout, public inputState: GfxInputState, bbox: UnityAABB, public buffers: GfxBuffer[], submeshes: SubMeshArray, public indexBufferFormat: GfxFormat) {
        const center = vec3.fromValues(bbox.center.x, bbox.center.y, bbox.center.z);
        const extent = vec3.fromValues(bbox.extent.x, bbox.extent.y, bbox.extent.z);
        this.bbox.setFromCenterAndExtents(center, extent);
        this.submeshes = loadWasmBindgenArray(submeshes);
        this.indexBufferStride = getFormatCompByteSize(this.indexBufferFormat);
    }

    public destroy(device: GfxDevice) {
        this.buffers.forEach(buf => device.destroyBuffer(buf));
        device.destroyInputState(this.inputState);
        device.destroyInputLayout(this.inputLayout);
    }
}

function loadCompressedMesh(device: GfxDevice, mesh: Mesh): UnityMeshData {
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

    return new UnityMeshData(layout, state, mesh.local_aabb, buffers, mesh.get_submeshes(), indexBufferFormat);
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

function channelInfoToVertexAttributeDescriptor(wasm: RustModule, location: number, channelInfo: ChannelInfo): GfxVertexAttributeDescriptor | null {
    if (channelInfo === undefined)
        return null;

    const { stream, offset, format, dimension } = channelInfo;
    if (dimension === 0)
        return null;

    const gfxFormat = vertexFormatToGfxFormat(wasm, format, dimension);
    return { location: location, bufferIndex: stream, bufferByteOffset: offset, format: gfxFormat };
}

function loadMesh(wasm: RustModule, device: GfxDevice, mesh: Mesh): UnityMeshData {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    const layoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
    const stateBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    const vertData = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mesh.get_vertex_data());
    const indexData = makeStaticDataBuffer(device, GfxBufferUsage.Index, mesh.get_index_data());

    for (let i = 0; i < mesh.get_channel_count(); i++) {
        const desc = channelInfoToVertexAttributeDescriptor(wasm, i, mesh.get_channel_info(i)!);
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

    const indexBufferFormat = (mesh.index_format === wasm.IndexFormat.UInt32) ? GfxFormat.U32_R : GfxFormat.U16_R;
    const layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: layoutBufferDescriptors, indexBufferFormat });
    const state = device.createInputState(layout, stateBufferDescriptors, { buffer: indexData, byteOffset: 0 });
    const buffers = [vertData, indexData];
    return new UnityMeshData(layout, state, mesh.local_aabb, buffers, mesh.get_submeshes(), indexBufferFormat);
}

function translateTextureFormat(wasm: RustModule, fmt: UnityTextureFormat, colorSpace: UnityColorSpace): GfxFormat {
    if (fmt === wasm.UnityTextureFormat.BC1 && colorSpace === wasm.UnityColorSpace.Linear)
        return GfxFormat.BC1;
    else if (fmt === wasm.UnityTextureFormat.BC1 && colorSpace === wasm.UnityColorSpace.SRGB)
        return GfxFormat.BC1_SRGB;
    else
        throw "whoops";
}

function translateWrapMode(wasm: RustModule, v: number): GfxWrapMode {
    if (v === wasm.UnityTextureWrapMode.Repeat)
        return GfxWrapMode.Repeat;
    else if (v === wasm.UnityTextureWrapMode.Clamp)
        return GfxWrapMode.Clamp;
    else if (v === wasm.UnityTextureWrapMode.Mirror)
        return GfxWrapMode.Mirror;
    else if (v === wasm.UnityTextureWrapMode.MirrorOnce)
        return GfxWrapMode.Mirror; // TODO(jstpierre): what to do here?
    else
        throw "whoops";
}

function translateSampler(wasm: RustModule, header: UnityTextureSettings): GfxSamplerDescriptor {
    const mipFilterMode = (header.filter_mode === wasm.UnityTextureFilterMode.Trilinear) ? GfxMipFilterMode.Linear : GfxMipFilterMode.Nearest;
    const texFilterMode = (header.filter_mode >= wasm.UnityTextureFilterMode.Bilinear) ? GfxTexFilterMode.Bilinear : GfxTexFilterMode.Point;

    // Mip bias needs to be handled in shader...

    return {
        magFilter: texFilterMode,
        minFilter: texFilterMode,
        mipFilter: mipFilterMode,
        wrapS: translateWrapMode(wasm, header.wrap_u),
        wrapT: translateWrapMode(wasm, header.wrap_v),
        wrapQ: translateWrapMode(wasm, header.wrap_w),
        maxAnisotropy: header.aniso,
    };
}

export class UnityTexture2DData {
    public gfxTexture: GfxTexture;
    public gfxSampler: GfxSampler;

    // public viewerTexture: Viewer.Texture;

    constructor(wasm: RustModule, cache: GfxRenderCache, private header: UnityTexture2D, data: Uint8Array) {
        const device = cache.device;
        const pixelFormat = translateTextureFormat(wasm, header.texture_format, header.color_space);
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(pixelFormat, header.width, header.height, header.mipmap_count));

        this.gfxSampler = cache.createSampler(translateSampler(wasm, header.texture_settings));

        // Load in the actual streaming texture data... limited to first mip for now
        // TODO(jstpierre): Full mip chain
        device.uploadTextureData(this.gfxTexture, 0, [data]);

        // const canvas = document.createElement('canvas');
        // const rgbaTexture = decompressBC({ type: 'BC1', flag: (pixelFormat & FormatFlags.sRGB) ? 'SRGB' : 'UNORM', width: header.width, height: header.height, depth: 1, pixels: data });
        // surfaceToCanvas(canvas, rgbaTexture);
        // this.viewerTexture = { name: header.name, surfaces: [canvas] };
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
        this.header.free();
    }
}

export class UnityMaterialData {
    public name: string;
    public shaderName: string;

    constructor(private location: AssetLocation, private header: UnityMaterial) {
        this.name = this.header.name;
    }

    public async load(assetSystem: UnityAssetSystem) {
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
