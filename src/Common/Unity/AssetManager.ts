
import { vec2, vec3 } from 'gl-matrix';
import { UnityAABB, UnityAssetFile, UnityAssetFileObject, UnityChannelInfo, UnityClassID, UnityGLTextureSettings, UnityMaterial, UnityMesh, UnityMeshCompression, UnityPPtr, UnityShader, UnityStreamingInfo, UnitySubMesh, UnityTexture2D, UnityTextureColorSpace, UnityTextureFormat, UnityVersion, UnityVertexFormat, CrunchTexture } from '../../../rust/pkg/noclip_support';
import ArrayBufferSlice from '../../ArrayBufferSlice.js';
import { Color, TransparentBlack, colorNewFromRGBA } from '../../Color.js';
import { DataFetcher } from '../../DataFetcher.js';
import * as Geometry from '../../Geometry.js';
import { Destroyable, SceneContext } from '../../SceneBase.js';
import { TextureMapping } from '../../TextureHolder.js';
import { coalesceBuffer, makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers.js';
import { fillColor, fillVec4 } from '../../gfx/helpers/UniformBufferHelpers.js';
import { GfxBufferUsage, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxSampler, GfxSamplerDescriptor, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from '../../gfx/platform/GfxPlatform.js';
import { FormatCompFlags, getFormatCompByteSize, setFormatCompFlags } from '../../gfx/platform/GfxPlatformFormat.js';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache.js';
import { rust } from '../../rustlib.js';
import { assert, assertExists, fallbackUndefined } from '../../util.js';

function concatBufs(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    const origByteLength = a.byteLength;
    const newBuffer = a.buffer.transfer(a.byteLength + b.byteLength);
    const result = new Uint8Array(newBuffer);
    result.set(b, origByteLength);
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
    public dataOffset: bigint = BigInt(0);

    constructor(public path: string, public version: UnityVersion) {
    }

    private ensureAssetFile(buffer: Uint8Array): void {
        if (this.assetFile === undefined) {
            this.assetFile = rust.UnityAssetFile.initialize_with_header_chunk(buffer);
        }
    }

    private doneLoadingHeader(buffer: Uint8Array): void {
        this.ensureAssetFile(buffer);
        this.assetFile.append_metadata_chunk(buffer);
        this.unityObjects = this.assetFile.get_objects();
        for (let i = 0; i < this.unityObjects.length; i++)
            this.unityObjectByFileID.set(this.unityObjects[i].file_id, this.unityObjects[i]);
        this.waitForHeaderPromise = null;
    }

    public async waitForHeader() {
        if (this.waitForHeaderPromise !== null) {
            await this.waitForHeaderPromise;
        }
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

        this.ensureAssetFile(headerBytes);
        this.dataOffset = this.assetFile.get_data_offset();
        if (this.dataOffset > headerBytes.byteLength) {
            // Oops, need to fetch extra bytes...
            const extraBytes = (await dataFetcher.fetchData(this.path, {
                rangeStart: headerBytes.byteLength,
                rangeSize: this.dataOffset - BigInt(headerBytes.byteLength),
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

        try {
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
        } catch (e) {
            debugger;
            throw e;
        }
    }

    public getPPtrFile(assetSystem: UnityAssetSystem, pptr: UnityPPtr): AssetFile {
        if (pptr.file_index === 0) {
            return this;
        } else {
            let externalFilename = assertExists(this.assetFile.get_external_path(pptr)).toLowerCase();
            if (externalFilename.startsWith("library/"))
                externalFilename = externalFilename.replace("library/", "resources/");
            return assetSystem.fetchAssetFile(externalFilename, true);
        }
    }

    private createMeshData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityMeshData> => {
        const mesh = rust.UnityMesh.create(assetSystem.version, objData.data);

        const streamingInfo: UnityStreamingInfo = mesh.streaming_info;
        if (streamingInfo.path.length !== 0) {
            const buf = await assetSystem.fetchStreamingInfo(streamingInfo);
            mesh.set_vertex_data(buf.createTypedArray(Uint8Array));
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

        const header = rust.UnityTexture2D.create(assetSystem.version, objData.data);
        let data = header.data;
        if (data.length === 0) {
            const streaming_info = header.streaming_info;
            assert(streaming_info.size > 0);
            data = (await assetSystem.fetchStreamingInfo(streaming_info)).createTypedArray(Uint8Array);
            streaming_info.free();
        }
        return new UnityTexture2DData(assetSystem.renderCache, header, data);
    };

    private createShaderData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityShaderData> => {
        const header = rust.UnityShader.create(assetSystem.version, objData.data);
        const shaderData = new UnityShaderData(objData.location, header);
        return shaderData;
    };

    private createMaterialData = async (assetSystem: UnityAssetSystem, objData: AssetObjectData): Promise<UnityMaterialData> => {
        const header = rust.UnityMaterial.create(assetSystem.version, objData.data);
        const materialData = new UnityMaterialData(objData.location, header);
        await materialData.load(assetSystem);
        return materialData;
    };

    private fetchFromCache<T extends Destroyable>(assetSystem: UnityAssetSystem, pathID: BigInt, createFunc: CreateFunc<T>): Promise<T | null> {
        if (this.promiseCache.has(pathID))
            return this.promiseCache.get(pathID)! as Promise<T>;

        const promise = this.fetchObject(pathID).then(async objData => {
            const v = await createFunc(assetSystem, objData);
            this.dataCache.set(pathID, v);
            return v;
        });
        this.promiseCache.set(pathID, promise);
        return promise;
    }

    public async fetchResource<T extends UnityAssetResourceType>(assetSystem: UnityAssetSystem, type: T, pathID: BigInt): Promise<ResType<T> | null> {
        if (Number(pathID) === 0)
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

function pptrToKey(file: AssetFile, p: UnityPPtr): string {
    return JSON.stringify([file.path, Number(p.path_id)]);
}

export class UnityAssetSystem {
    private assetFiles = new Map<string, AssetFile>();
    private shaderPPtrToName = new Map<string, string>();
    public renderCache: GfxRenderCache;

    constructor(public device: GfxDevice, private dataFetcher: DataFetcher, private basePath: string, public version: UnityVersion) {
        this.renderCache = new GfxRenderCache(this.device);
    }

    public async init() {
        const globalGameManager = this.fetchAssetFile("globalgamemanagers", true);
        await globalGameManager.waitForHeader();
        const scriptMapperFileObj = globalGameManager.unityObjects.find(obj => obj.class_id === UnityClassID.ScriptMapper);
        if (scriptMapperFileObj === undefined) {
            console.warn('no ScriptMapper found');
            return;
        }
        const scriptMapperPromise = globalGameManager.fetchObject(scriptMapperFileObj.file_id);
        await this.fetchData();
        const scriptMapperData = await scriptMapperPromise;
        const scriptMapper = rust.UnityScriptMapper.create(this.version, scriptMapperData.data);
        const pptrs = scriptMapper.get_shader_pointers();
        const shaderNames = scriptMapper.get_shader_names();
        for (let i = 0; i < pptrs.length; i++) {
            const assetFile = globalGameManager.getPPtrFile(this, pptrs[i]);
            this.shaderPPtrToName.set(pptrToKey(assetFile, pptrs[i]), shaderNames[i]);
        }
    }

    public getShaderNameFromPPtr(location: AssetLocation, pptr: UnityPPtr): string | undefined {
        const assetFile = location.file.getPPtrFile(this, pptr);
        const key = pptrToKey(assetFile, pptr);
        return this.shaderPPtrToName.get(key);
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
            const assetFile = new AssetFile(path, this.version);
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
        this.bbox.setFromCenterAndHalfExtents(center, extent);
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
    const indexBuffer = { buffer: indexData };
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

function vertexFormatToGfxFormat(vertexFormat: UnityVertexFormat, dimension: number): GfxFormat {
    const baseFormat = vertexFormatToGfxFormatBase(vertexFormat);
    let maskedDimension = dimension & 0x0F;
    if (![1, 2, 3, 4].includes(maskedDimension)) {
        throw new Error(`invalid dimension ${maskedDimension}`);
    }
    const compFlags = maskedDimension as FormatCompFlags;
    return setFormatCompFlags(baseFormat, compFlags);
}

function channelInfoToVertexAttributeDescriptor(location: number, channelInfo: UnityChannelInfo): GfxVertexAttributeDescriptor | null {
    if (channelInfo === undefined)
        return null;

    const { stream, offset, format, dimension } = channelInfo;
    if (dimension === 0)
        return null;

    const gfxFormat = vertexFormatToGfxFormat(format, dimension);
    return { location: location, bufferIndex: stream, bufferByteOffset: offset, format: gfxFormat };
}

function loadMesh(device: GfxDevice, mesh: UnityMesh): UnityMeshData {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    const layoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
    const stateBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    const vertData = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mesh.get_vertex_data().buffer);
    const indexData = makeStaticDataBuffer(device, GfxBufferUsage.Index, mesh.get_index_data().buffer);

    const channels = mesh.get_channels();
    for (let i = 0; i < channels.length; i++) {
        const desc = channelInfoToVertexAttributeDescriptor(i, channels[i]);
        if (desc !== null)
            vertexAttributeDescriptors.push(desc);
    }

    const streams = mesh.get_streams();
    for (const stream of streams) {
        layoutBufferDescriptors.push({
            byteStride: stream.stride,
            frequency: GfxVertexBufferFrequency.PerVertex,
        });
        stateBufferDescriptors.push({ buffer: vertData, byteOffset: stream.offset });
    }

    const indexBufferFormat = (mesh.index_format === rust.UnityIndexFormat.UInt32) ? GfxFormat.U32_R : GfxFormat.U16_R;
    const layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: layoutBufferDescriptors, indexBufferFormat });
    const indexBuffer = { buffer: indexData };
    return new UnityMeshData(layout, stateBufferDescriptors, indexBuffer, mesh.local_aabb, mesh.submeshes, indexBufferFormat);
}

function translateTextureFormat(fmt: UnityTextureFormat, colorSpace: UnityTextureColorSpace): GfxFormat {
    if (fmt === rust.UnityTextureFormat.Alpha8 && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.U8_R_NORM;
    else if (fmt === rust.UnityTextureFormat.R8 && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.U8_R_NORM;
    else if (fmt === rust.UnityTextureFormat.RHalf && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.U16_R_NORM;
    else if (fmt === rust.UnityTextureFormat.RGB24 && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.U8_RGBA_NORM;
    else if (fmt === rust.UnityTextureFormat.RGB24 && colorSpace === rust.UnityTextureColorSpace.SRGB)
        return GfxFormat.U8_RGBA_SRGB;
    else if (fmt === rust.UnityTextureFormat.RGBA32 && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.U8_RGBA_NORM;
    else if (fmt === rust.UnityTextureFormat.RGBAHalf && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.U16_RGBA_NORM;
    else if (fmt === rust.UnityTextureFormat.RGBA32 && colorSpace === rust.UnityTextureColorSpace.SRGB)
        return GfxFormat.U8_RGBA_SRGB;
    else if (fmt === rust.UnityTextureFormat.ARGB32 && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.U8_RGBA_NORM;
    else if (fmt === rust.UnityTextureFormat.ARGB32 && colorSpace === rust.UnityTextureColorSpace.SRGB)
        return GfxFormat.U8_RGBA_SRGB;
    else if ((fmt === rust.UnityTextureFormat.DXT1 || fmt === rust.UnityTextureFormat.DXT1Crunched) && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.BC1;
    else if ((fmt === rust.UnityTextureFormat.DXT1 || fmt === rust.UnityTextureFormat.DXT1Crunched) && colorSpace === rust.UnityTextureColorSpace.SRGB)
        return GfxFormat.BC1_SRGB;
    else if ((fmt === rust.UnityTextureFormat.DXT5 || fmt === rust.UnityTextureFormat.DXT5Crunched) && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.BC3;
    else if ((fmt === rust.UnityTextureFormat.DXT5 || fmt === rust.UnityTextureFormat.DXT5Crunched) && colorSpace === rust.UnityTextureColorSpace.SRGB)
        return GfxFormat.BC3_SRGB;
    else if (fmt === rust.UnityTextureFormat.BC7 && colorSpace === rust.UnityTextureColorSpace.Linear)
        return GfxFormat.BC7;
    else if (fmt === rust.UnityTextureFormat.BC7 && colorSpace === rust.UnityTextureColorSpace.SRGB)
        return GfxFormat.BC7_SRGB;
    else
        throw new Error(`unknown texture format ${fmt} and colorspace ${colorSpace} combo`);
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

function translateSampler(header: UnityGLTextureSettings): GfxSamplerDescriptor {
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
    if (fmt === rust.UnityTextureFormat.BC6H || fmt === rust.UnityTextureFormat.BC7|| fmt === rust.UnityTextureFormat.DXT1 || fmt === rust.UnityTextureFormat.DXT5 || fmt === rust.UnityTextureFormat.DXT1Crunched || fmt === rust.UnityTextureFormat.DXT5Crunched) {
        w = Math.max(w, 4);
        h = Math.max(h, 4);
        const depth = 1;
        const count = ((w * h) / 16) * depth;
        if (fmt === rust.UnityTextureFormat.DXT1 || fmt === rust.UnityTextureFormat.DXT1Crunched)
            return count * 8;
        else if (fmt === rust.UnityTextureFormat.DXT5 || fmt === rust.UnityTextureFormat.DXT5Crunched)
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
    } else if (fmt === rust.UnityTextureFormat.RGBAHalf) {
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
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(pixelFormat, header.width, header.height, header.mip_count));

        this.gfxSampler = cache.createSampler(translateSampler(header.texture_settings));

        if (header.texture_format === rust.UnityTextureFormat.DXT1Crunched || header.texture_format === rust.UnityTextureFormat.DXT5Crunched) {
            const crunched = CrunchTexture.new(data);
            const levels = [];
            // FIXME: texture2ddecoder seems to be broken for higher mip levels
            // let numLevels = crunched.get_num_levels();
            let numLevels = 1;
            for (let i = 0; i < numLevels; i++) {
                levels.push(crunched.decode_level(data, i));
            }
            device.uploadTextureData(this.gfxTexture, 0, levels);
        } else {
            const oData = imageFormatConvertData(data, header.texture_format);
            const levels = calcLevels(oData, header.texture_format, header.width, header.height, header.mip_count);
            device.uploadTextureData(this.gfxTexture, 0, levels);
        }
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

export class UnityTexture {
    constructor(public name: string, public data: UnityTexture2DData | null, public scale: vec2, public offset: vec2) {
    }
}

export class UnityShaderData {
    public name: string;

    constructor(private location: AssetLocation, private header: UnityShader) {
        this.name = header.name;
    }

    public destroy(device: GfxDevice): void {}
}

export class UnityMaterialData {
    public name: string;
    public texturesByName: Map<string, UnityTexture> = new Map();
    public colorsByName: Map<string, Color> = new Map();
    public floatsByName: Map<string, number> = new Map();
    public shader: UnityShaderData | null = null;

    constructor(private location: AssetLocation, private header: UnityMaterial) {
        this.name = this.header.name;
    }

    public fillTextureMapping(dst: TextureMapping, name: string): boolean {
        const texture = this.texturesByName.get(name);
        if (texture !== undefined && texture.data !== null) {
            dst.gfxTexture = texture.data.gfxTexture;
            dst.gfxSampler = texture.data.gfxSampler;
            return true;
        } else {
            dst.reset();
            return false;
        }
    }

    public fillTexEnvScaleBias(d: Float32Array, offs: number, name: string): number {
        const texture = this.texturesByName.get(name);
        if (texture !== undefined) {
            return fillVec4(d, offs, texture.scale[0], texture.scale[1], texture.offset[0], texture.offset[1]);
        } else {
            return fillVec4(d, offs, 1, 1, 0, 0);
        }
    }

    public getColor(name: string): Color | null {
        return fallbackUndefined(this.colorsByName.get(name), null);
    }

    public fillColor(d: Float32Array, offs: number, name: string): number {
        const color = this.colorsByName.get(name);
        return fillColor(d, offs, fallbackUndefined(color, TransparentBlack));
    }

    public getFloat(name: string): number | null {
        return fallbackUndefined(this.floatsByName.get(name), null);
    }

    public async load(assetSystem: UnityAssetSystem) {
        for (const name of this.header.get_tex_env_keys()) {
            const texEnv = this.header.get_tex_env_by_key(name)!;
            const data = await assetSystem.fetchResource(UnityAssetResourceType.Texture2D, this.location, texEnv.texture);
            const scale = vec2.fromValues(texEnv.scale.x, texEnv.scale.y);
            const offset = vec2.fromValues(texEnv.offset.x, texEnv.offset.y);
            this.texturesByName.set(name, new UnityTexture(name, data, scale, offset));
            texEnv.free();
        }

        for (const name of this.header.get_color_keys()) {
            const color = this.header.get_color_by_key(name)!;
            this.colorsByName.set(name, colorNewFromRGBA(color.r, color.g, color.b, color.a));
            color.free();
        }

        for (const name of this.header.get_float_keys()) {
            this.floatsByName.set(name, this.header.get_float_by_key(name)!);
        }

        const shaderPPtr = this.header.shader;
        this.shader = await assetSystem.fetchResource(UnityAssetResourceType.Shader, this.location, shaderPPtr);
        assert(this.shader !== null);
        const shaderName = assetSystem.getShaderNameFromPPtr(this.location, shaderPPtr);
        assert(shaderName !== undefined);
        this.shader.name = shaderName;
    }

    public destroy(device: GfxDevice): void {
        this.header.free();
    }
}

export async function createUnityAssetSystem(context: SceneContext, basePath: string, version: UnityVersion): Promise<UnityAssetSystem> {
    const runtime = await context.dataShare.ensureObject(`UnityAssetSystem/${basePath}`, async () => {
        const system = new UnityAssetSystem(context.device, context.dataFetcher, basePath, version);
        await system.init();
        return system;
    });
    return runtime;
}
