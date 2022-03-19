import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';
import { SceneContext } from '../../SceneBase';
import { downloadBlob } from '../../DownloadUtils';
import { AssetInfo, Mesh, AABB as UnityAABB, VertexFormat, StreamingInfo, ChannelInfo, Transform, GameObject, UnityClassID, FileLocation, Vec3f, Quaternion, PPtr, SubMesh, SubMeshArray, MeshRenderer } from '../../../rust/pkg/index';
import { GfxDevice, GfxBuffer, GfxBufferUsage, GfxInputState, GfxFormat, GfxInputLayout, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor } from '../../gfx/platform/GfxPlatform';
import { FormatCompFlags, setFormatCompFlags } from '../../gfx/platform/GfxPlatformFormat';
import { assert } from '../../util';
import * as Geometry from '../../Geometry';
import { mat4, vec3, quat } from 'gl-matrix';
import { setChildren } from '../../ui';
import { CoinHolder } from '../../SuperMarioGalaxy/Actors/MiscActor';

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

type Map<T> = { [pathID: number]: T };

class BatchRequest {
    public pathIDs: number[];
    public indices: number[];
    public results: [number, Uint8Array][];

    constructor(public fileIndex: number) {
        this.pathIDs = [];
        this.results = [];
        this.indices = [];
    }
}

class BatchRequestManager {
    batches: { [fileIndex: number]: BatchRequest }
    constructor() {
        this.batches = {};
    }

    add(ptr: PPtr, index: number) {
        if (!(ptr.file_index in this.batches)) {
            this.batches[ptr.file_index] = new BatchRequest(ptr.file_index);
        }
        this.batches[ptr.file_index].pathIDs.push(ptr.path_id);
        this.batches[ptr.file_index].indices.push(index);
    }
}

export class GameObjectTree {
    constructor(public meshes: Map<UnityMesh>, public nodes: Map<GameObjectTreeNode>, public rootPathIDs: number[]) {
        this.rootPathIDs.forEach(transformID => this.propagateModel(transformID));
    }

    propagateModel(transformID: number) {
        let node = this.nodes[transformID];
        node.transformChildrenPathIDs.forEach(childID => {
            let child = this.nodes[childID];
            if (child === undefined) {
                console.error(`couldn't find ${node.name}'s child (tranform ID ${childID})`)
                return;
            }
            mat4.mul(child.modelMatrix, node.modelMatrix, child.modelMatrix);
            this.propagateModel(childID);
        });
    }
}

function convertVec3f(v: Vec3f): vec3 {
    return vec3.fromValues(v.x, v.y, v.z);
}

function convertQuat(q: Quaternion): quat {
    return quat.fromValues(q.x, q.y, q.z, q.w);
}

export class GameObjectTreeNode {
    modelMatrix: mat4;
    transformPathID: number;
    gameObjectPathID: number;
    transformChildrenPathIDs: number[];
    name: string|undefined;
    layer: number|undefined;
    isActive: boolean|undefined;
    meshPathID: number|undefined;
    meshRenderer: MeshRenderer|undefined;
    gameObjectSet: boolean;
    meshSet: boolean;

    constructor(transform: Transform) {
        this.modelMatrix = mat4.create();
        let rot = convertQuat(transform.local_rotation);
        let translation = convertVec3f(transform.local_position);
        let scale = convertVec3f(transform.local_scale);
        mat4.fromRotationTranslationScale(this.modelMatrix, rot, translation, scale);
        this.transformPathID = transform.path_id!;
        this.gameObjectPathID = transform.game_object.path_id;
        this.transformChildrenPathIDs = Array.from(transform.get_children_path_ids());

        this.gameObjectSet = false;
        this.meshSet = false;
    }

    setGameObject(gameObject: GameObject) {
        this.name = gameObject.get_name();
        this.isActive = gameObject.is_active;
        this.layer = gameObject.layer;
        this.gameObjectSet = true;
    }

    setMeshRenderer(meshRenderer: MeshRenderer) {
        this.meshRenderer = meshRenderer;
    }

    setMeshPathID(meshPathID: number) {
        this.meshPathID = meshPathID;
        this.meshSet = true;
    }

    isValid(): boolean {
        return (this.meshSet && this.gameObjectSet);
    }
}

export class UnityMesh {
    public bbox: Geometry.AABB; 
    public submeshes: SubMesh[];

    constructor(public inputLayout: GfxInputLayout, public inputState: GfxInputState, public numIndices: number, bbox: UnityAABB, public buffers: GfxBuffer[], submeshes: SubMeshArray, public indexBufferFormat: GfxFormat) {
        let center = vec3.fromValues(bbox.center.x, bbox.center.y, bbox.center.z);
        let extent = vec3.fromValues(bbox.extent.x, bbox.extent.y, bbox.extent.z);
        this.bbox = new Geometry.AABB();
        this.bbox.setFromCenterAndExtents(center, extent);
        this.submeshes = [];
        for (let i=0; i<submeshes.length; i++) {
            this.submeshes.push(submeshes.get(i))
        }
    }

    public destroy(device: GfxDevice) {
        this.buffers.forEach(buf => device.destroyBuffer(buf));
        device.destroyInputState(this.inputState);
        device.destroyInputLayout(this.inputLayout);
    }
}

export class UnityAssetManager {
    private assetInfo: AssetInfo;
    private externalAssets: { [fileIndex: number]: AssetInfo };

    constructor(public assetPath: string, private context: SceneContext, public device: GfxDevice) {
        this.externalAssets = {};
    }

    private async loadBytes(range?: Range, path = this.assetPath): Promise<Uint8Array> {
        let res = await this.context.dataFetcher.fetchData(path, range);
        return new Uint8Array(res.arrayBuffer);
    }

    private async loadMultipleData(ranges: [number, number][], path = this.assetPath): Promise<Uint8Array[]> {
        let bufs = await this.context.dataFetcher.fetchMultipleData(path, ranges);
        return bufs.map(buf => new Uint8Array(buf.arrayBuffer));
    }

    private getSiblingPath(path: string): string {
        let parts = this.assetPath.split('/');
        parts.pop();
        parts.push(path);
        return parts.join('/');
    }

    private async loadStreamingData(streamingInfo: StreamingInfo): Promise<Uint8Array> {
        return await this.loadBytes({
            rangeStart: streamingInfo.offset,
            rangeSize: streamingInfo.size,
        }, this.getSiblingPath(streamingInfo.get_path()));
    }

    public async loadAssetInfo() {
        this.assetInfo = await this._loadAssetInfo(this.assetPath);
    }

    private async _loadAssetInfo(path: string) {
        let wasm = await loadWasm();
        let headerBytes = await this.loadBytes({
            rangeStart: 0,
            rangeSize: MAX_HEADER_LENGTH,
        }, path);
        let assetHeader = wasm.AssetHeader.deserialize(headerBytes);
        if (assetHeader.data_offset > headerBytes.byteLength) {
            let extraBytes = await this.loadBytes({
                rangeStart: headerBytes.byteLength,
                rangeSize: assetHeader.data_offset - headerBytes.byteLength,
            }, path);
            headerBytes = concatBufs(headerBytes, extraBytes);
        }
        return wasm.AssetInfo.deserialize(headerBytes);
    }

    private async loadUnityObjects(classID: UnityClassID): Promise<[number, Uint8Array][]> {
        let array = this.assetInfo.get_object_locations(classID);
        let locations = [];
        for (let i=0; i<array.length; i++) {
            locations.push(array.get(i));
        }
        return this.loadUnityLocations(locations);
    }

    private async loadExternalAsset(fileIndex: number) {
        if (fileIndex === 0 || fileIndex in this.externalAssets) {
            return;
        }
        let path = this.getSiblingPath(this.assetInfo.get_external_path(fileIndex)!);
        this.externalAssets[fileIndex] = await this._loadAssetInfo(path);
    }

    private async loadUnityLocations(locations: FileLocation[], fileIndex = 0): Promise<[number, Uint8Array][]> {
        let ranges: [number, number][] = [];
        for (let i=0; i<locations.length; i++) {
            let loc = locations[i];
            ranges.push([loc.offset, loc.offset + loc.size])
        }
        let data;
        if (fileIndex !== 0) {
            let path = this.getSiblingPath(this.assetInfo.get_external_path(fileIndex)!);
            data = await this.loadMultipleData(ranges, path);
        } else {
            data = await this.loadMultipleData(ranges);
        }
        return data.map((blob, i) => [locations[i].path_id, blob]);
    }

    private readObjectLocations(pathIDs: number[], fileIndex = 0): FileLocation[] {
        let assetInfo = this.assetInfo;
        if (fileIndex !== 0) {
            assetInfo = this.externalAssets[fileIndex];
        }
        return pathIDs.map(pathID => assetInfo.get_obj_location(pathID)!);
    }

    public async getGameObjectTree(): Promise<GameObjectTree> {
        let wasm = await loadWasm();

        let nodesByGameObject: Map<GameObjectTreeNode> = {};

        let transformData = await this.loadUnityObjects(wasm.UnityClassID.Transform);
        let transforms: Map<Transform> = {};
        let rootTransforms: Transform[] = [];
        transformData.forEach(([pathID, data]) => {
            let transform = wasm.Transform.from_bytes(data, this.assetInfo, pathID);
            if (transform.is_root()) {
                rootTransforms.push(transform);
            }
            transforms[pathID] = transform;
            nodesByGameObject[transform.game_object.path_id] = new GameObjectTreeNode(transform);
        });
        console.log(`loaded ${transformData.length} transforms (${rootTransforms.length} roots)`)

        let gameObjectData = await this.loadUnityObjects(wasm.UnityClassID.GameObject);
        let gameObjects: Map<GameObject> = {};
        gameObjectData.forEach(([pathID, data]) => {
            gameObjects[pathID] = wasm.GameObject.from_bytes(data, this.assetInfo, pathID);
            if (!(pathID in nodesByGameObject)) {
                let name = gameObjects[pathID].get_name();
                console.log(`No transform found for ${name} (${pathID}), skipping`);
                return;
            }
            nodesByGameObject[pathID].setGameObject(gameObjects[pathID]);
        });
        console.log(`loaded ${gameObjectData.length} gameobjects`)

        let meshRendererData = await this.loadUnityObjects(wasm.UnityClassID.MeshRenderer);
        meshRendererData.forEach(([pathID, data]) => {
            let meshRenderer = wasm.MeshRenderer.from_bytes(data, this.assetInfo, pathID);
            nodesByGameObject[meshRenderer.game_object.path_id].setMeshRenderer(meshRenderer);
        });

        let meshFilterData = await this.loadUnityObjects(wasm.UnityClassID.MeshFilter);
        let meshes: Map<UnityMesh> = {};
        let meshesToGameObjects: { [combinedMeshID: string]: number[]} = {};
        let batchRequestManager = new BatchRequestManager();
        meshFilterData.forEach(([pathID, data], i) => {
            let filter = wasm.MeshFilter.from_bytes(data, this.assetInfo, pathID);

            // check for a null ptr
            if (filter.mesh_ptr.path_id === 0) {
                return;
            }

            let combinedMeshID = `${filter.mesh_ptr.file_index}-${filter.mesh_ptr.path_id}`;
            if (!(combinedMeshID in meshesToGameObjects)) {
                meshesToGameObjects[combinedMeshID] = [];
            }
            meshesToGameObjects[combinedMeshID].push(filter.game_object.path_id);
            batchRequestManager.add(filter.mesh_ptr, i);
        });
        for (let i in batchRequestManager.batches) {
            let batch = batchRequestManager.batches[i];
            await this.loadExternalAsset(batch.fileIndex);
            let locations = this.readObjectLocations(batch.pathIDs, batch.fileIndex);
            let results = await this.loadUnityLocations(locations, batch.fileIndex);
            for (let i=0; i<results.length; i++) {
                let [pathID, data] = results[i];
                if (!(pathID in meshes)) {
                    meshes[pathID] = await this.createMesh(data, pathID, batch.fileIndex);
                }
                let combinedMeshID = `${batch.fileIndex}-${pathID}`;
                meshesToGameObjects[combinedMeshID].forEach(gameObjectPathID => {
                    nodesByGameObject[gameObjectPathID].setMeshPathID(pathID);
                });
            }
        }

        let rootPathIDs = rootTransforms.map(root => root.path_id!);

        // Re-key nodes by transform ID for easier tree traversal
        let nodesByTransform: Map<GameObjectTreeNode> = {};
        for (let k in nodesByGameObject) {
            let node = nodesByGameObject[k];
            nodesByTransform[node.transformPathID] = node;
        }

        return new GameObjectTree(meshes, nodesByTransform, rootPathIDs);
    }

    public async downloadMeshMetadata() {
        let assetData = await this.context.dataFetcher.fetchData(this.assetPath);
        let assetBytes = new Uint8Array(assetData.arrayBuffer);
        let meshDataArray = this.assetInfo.get_mesh_metadata(assetBytes);
        let result: MeshMetadata[] = [];
        for (let i=0; i<meshDataArray.length; i++) {
            let data = meshDataArray.get(i);
            result.push({
                name: data.get_name(),
                offset: data.location.offset,
                size: data.location.size,
            })
        }

        downloadBlob('meshData.json', new Blob([JSON.stringify(result, null, 2)]));
    }

    public async loadMesh(meshData: MeshMetadata): Promise<UnityMesh> {
        return this.createMesh(await this.loadBytes({
            rangeStart: meshData.offset,
            rangeSize: meshData.size,
        }));
    }

    private async createMesh(data: Uint8Array, pathID?: number, fileIndex = 0): Promise<UnityMesh> {
        let wasm = await loadWasm();
        let assetInfo = this.assetInfo;
        if (fileIndex !== 0) {
            assetInfo = this.externalAssets[fileIndex];
        }
        let mesh = wasm.Mesh.from_bytes(data, assetInfo, pathID);
        let streamingInfo: StreamingInfo | undefined = mesh.get_streaming_info();
        if (streamingInfo !== undefined) {
            mesh.set_vertex_data(await this.loadStreamingData(streamingInfo));
        }

        if (mesh.is_compressed()) {
            return loadCompressedMesh(this.device, mesh);
        } else {
            return loadMesh(this.device, mesh);
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

    return new UnityMesh(layout, state, indices.length, mesh.local_aabb, buffers, mesh.get_submeshes(), indexBufferFormat);
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

    let vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mesh.get_vertex_data());
    let trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices);

    let layout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    let state = device.createInputState(layout, [
        { buffer: vertsBuf, byteOffset: 0 },
    ], { buffer: trisBuf, byteOffset: 0 });
    let buffers = [vertsBuf, trisBuf];

    return new UnityMesh(layout, state,  numIndices, mesh.local_aabb, buffers, mesh.get_submeshes(), indexBufferFormat);
}