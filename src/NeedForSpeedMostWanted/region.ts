import { mat4, vec2 } from 'gl-matrix';
import { AABB, Frustum, IntersectionState } from '../Geometry';
import { makeStaticDataBufferFromSlice } from '../gfx/helpers/BufferHelpers';
import { GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxTexFilterMode, GfxTextureDescriptor, GfxTextureDimension, GfxTextureUsage, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import { GfxBuffer, GfxTexture } from '../gfx/platform/GfxPlatformImpl';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { TextureMapping } from '../TextureHolder';
import { assert } from '../util';
import { NfsNode, NodeType } from './datanode';
import { NfsMap, RegionConnections } from './map';
import { NfsParticleEmitterGroup } from './particles';
import { VertexInfo } from './render';

export type DataSection = {
    node?: NfsNode,
    offset: number,
    length: number
}

enum LoadStatus {
    NotLoaded,
    Loading,
    ReadyToParse,
    Loaded
}

export enum RegionType {
    Regular,
    Panorama,
    Dependency,
    Global
}

export class NfsRegion {
    public id: number;
    public regionType: RegionType;
    public rootBoundingVolumes: NfsBoundingVolume[];
    public emitterGroups: NfsParticleEmitterGroup[] = [];
    public dataSections: DataSection[] = [];
    public boundingBox?: AABB;
    public areaVertices?: vec2[];
    public dependencies?: NfsRegion[];
    public connections?: RegionConnections[];
    public loadStatus: LoadStatus = LoadStatus.NotLoaded;
    public upperPartOffset: number = 0;
    private instanceCounter: number = 0;

    // Instances marked as animation objects should be visible unless they're in one of these regions
    private static hiddenAnimObjectRegions: number[] = [ 811, 919, 1632, 2600 ];
    public static emitterTypes: number[] = [];

    constructor(id: number) {
        this.id = id;
        if(this.id >= 2400) {
            this.loadStatus = LoadStatus.Loaded;
            this.regionType = RegionType.Global;
        }
        else if(this.id >= 2200) {
            this.regionType = RegionType.Dependency;
        }
        else if(this.id % 100 >= 80) {
            this.regionType = RegionType.Panorama;
        }
        else {
            this.regionType = RegionType.Regular;
        }
    }

    public ensureReady(device: GfxDevice, renderHelper: GfxRenderHelper, map: NfsMap): boolean {
        switch(this.loadStatus) {
            case LoadStatus.Loaded:
                return true;
            case LoadStatus.ReadyToParse:
                if(this.regionType == RegionType.Regular) {
                    const depNotLoaded = this.dependencies!.filter(d => d.loadStatus == LoadStatus.NotLoaded);
                    if(depNotLoaded.length > 0) {
                        depNotLoaded.forEach(d => {d.loadStatus = LoadStatus.Loading; d.load(map).then(() => d.loadStatus = LoadStatus.ReadyToParse);});
                        return false;
                    }
                    if(this.dependencies!.filter(d => d.loadStatus == LoadStatus.Loading).length > 0)
                        return false;
                    const depsToParse = this.dependencies!.filter(d => d.loadStatus == LoadStatus.ReadyToParse);
                    depsToParse.forEach(d => d.parseTextures(device, renderHelper, map));
                    depsToParse.forEach(d => {
                        d.parseModels(device, map);
                        d.loadStatus = LoadStatus.Loaded;
                    });
                }
                this.parseTextures(device, renderHelper, map);
                this.parseModels(device, map);
                this.parseInstances(map);
                this.parseParticleEmitterGroups(map);
                this.loadStatus = LoadStatus.Loaded;
                return true;
            case LoadStatus.Loading:
                return false;
            case LoadStatus.NotLoaded:
                this.loadStatus = LoadStatus.Loading;
                this.load(map).then(() => {
                    this.loadStatus = LoadStatus.ReadyToParse;
                });
                return false;
            default:
                throw "Invalid load status";
        }
    }

    public isLoaded() {
        return this.loadStatus == LoadStatus.Loaded;;
    }

    public async load(map: NfsMap) {
        assert(this.dataSections.length > 0);
        for(let i = 0; i < this.dataSections.length; i++) {
            if(this.dataSections[i].node != undefined)
                continue;
            const dataBuffer = await map.dataFetcher.fetchData(map.streamingFilePath, { rangeStart: this.dataSections[i].offset, rangeSize: this.dataSections[i].length });
            assert(dataBuffer != undefined);
            this.dataSections[i].node = new NfsNode(dataBuffer);
            this.dataSections[i].node!.parseChildren();
        }
    }

    public parseTextures(device: GfxDevice, renderHelper: GfxRenderHelper, map: NfsMap) {
        assert(this.dataSections.filter(s => s.node === undefined).length == 0);
        const textureCollections = this.dataSections.flatMap(s => s.node!.children.filter(node => node.type == NodeType.TextureCollection));
        textureCollections.forEach(node => this.parseTextureCollection(device, renderHelper.renderCache, node, map));
        const textureAnimations = this.dataSections.flatMap(s => s.node!.children.filter(node => node.type == NodeType.TextureAnimation));
        textureAnimations.forEach(node => this.parseTextureCycleAnimation(node, map));
    }

    public parseModels(device: GfxDevice, map: NfsMap) {
        assert(this.dataSections.filter(s => s.node === undefined).length == 0);
        const modelCollections = this.dataSections.flatMap(s => s.node!.children.filter(node => node.type == NodeType.ModelCollection));
        const modelNodes = modelCollections.flatMap(collNode => collNode.children.slice(1));
        modelNodes.forEach(node => {
            const id = node.children[0].dataView.getUint32(0x10, true);
            if(!(id in map.modelCache)) {
                map.modelCache[id] = new NfsModel(device, map, node);
            }
        });
    }

    public parseInstances(map: NfsMap) {
        assert(this.dataSections.filter(s => s.node === undefined).length == 0);
        const rootBoundingVolumes = [];
        for(let i = 0; i < this.dataSections.length; i++) {
            if(i == 1)
                this.upperPartOffset = rootBoundingVolumes.length;
            const instanceListNodes = this.dataSections[i].node!.children.filter(node => node.type == NodeType.InstanceList);
            rootBoundingVolumes.push(...instanceListNodes.flatMap(node => this.parseInstanceList(node, map)));
        }
        this.rootBoundingVolumes = rootBoundingVolumes;
    }

    private parseInstanceList(instanceNode: NfsNode, map: NfsMap): NfsBoundingVolume {
        const models = this.parseModelIds(instanceNode.children[2], map);

        const dataView = instanceNode.children[1].dataView;
        const instanceCount = dataView.byteLength / 0x40;

        const instances: NfsInstance[] = [];
        for(let i = 0; i < instanceCount; i++, this.instanceCounter++) {
            const newInstance = new NfsInstance();
            newInstance.boundingBox = readBoundingBox(dataView, i * 0x40);
            // Make sure to always insert an instance, even if it doesn't get used
            instances.push(newInstance);

            // Do not use the old PS2 sky
            if(this.id == 2600 && (i == 1 || i == 2))
                continue;

            // A bit messy but I haven't found a better way to determine object type
            const flags = dataView.getUint32(i * 0x40 + 0x18, true);
            newInstance.invertedFaces = (flags & 0x400000) != 0;
            if(this.id == 2600 && i == 0)
                newInstance.type = InstanceType.Sky;
            else if(((flags >> 16) & 0xff) == 4) {
                if(((flags >> 8) & 0xff) != 0x80)
                    newInstance.type = InstanceType.Shadow;
                else
                    newInstance.type = InstanceType.Hidden;
            }
            else if((flags & 0xff0fffff) == 0x2008070)
                newInstance.type = InstanceType.TrackBarrier;
            else if((flags & 0xf) == 0x2)
                newInstance.type = InstanceType.Hidden;
            else if((flags & 0x10) == 0x10 && NfsRegion.hiddenAnimObjectRegions.includes(this.id))
                newInstance.type = InstanceType.Hidden;

            const worldMat: mat4 = mat4.create();
            worldMat[12] = dataView.getFloat32(i * 0x40 + 0x20, true);
            worldMat[13] = dataView.getFloat32(i * 0x40 + 0x24, true);
            worldMat[14] = dataView.getFloat32(i * 0x40 + 0x28, true);
            let offset = i * 0x40 + 0x2C;
            for(let j = 0; j < 9; j++) {
                worldMat[Math.floor(j / 3) * 4 + (j % 3)] = dataView.getInt16(offset, true) / 8192.0;
                offset += 2;
            }
            transformToViewerCoordinateSystem(worldMat);
            newInstance.worldMatrix = worldMat;

            const modelIndex = dataView.getUint16(offset, true);
            newInstance.model = models[modelIndex];

            if(newInstance.model !== undefined && (flags & 0x100010) != 0 && newInstance.model.isHiddenModel)
                newInstance.type = InstanceType.Hidden;
        }

        return this.parseBvhTree(instanceNode.children.filter(n => n.type == NodeType.InstanceListBvh)[0], instances);
    }

    private parseBvhTree(bvhTreeNode: NfsNode, instances: NfsInstance[]): NfsBoundingVolume {
        const bvhTreeDataView = bvhTreeNode.dataView;
        const innerNodeCount = bvhTreeNode.dataBuffer.byteLength / 0x24;
        const nodes: NfsBoundingVolumeGroup[] = [];
        for(let i = 0; i < innerNodeCount; i++) {
            nodes.push(new NfsBoundingVolumeGroup());
        }
        for(let i = 0; i < innerNodeCount; i++) {
            let offset = i * 0x24;
            const node = nodes[i];
            node.boundingBox = readBoundingBox(bvhTreeDataView, offset);
            const childCount = bvhTreeNode.dataView.getInt16(offset + 0x18, true);
            const children: NfsBoundingVolume[] = [];
            offset += 0x1A;
            for(let j = 0; j < childCount; j++) {
                const childIndex = bvhTreeNode.dataView.getInt16(offset, true);
                if(childIndex < 0)
                    children.push(nodes[-childIndex]);
                else
                    children.push(instances[childIndex]);
                offset += 2;
            }
            node.children = children;
        }
        return nodes[0];
    }

    private parseTextureCollection(device: GfxDevice, renderCache: GfxRenderCache, textureCollectionNode: NfsNode, map: NfsMap) {
        const textureInfoDataView = textureCollectionNode.children[0].children[2].dataView;
        const textureCollHeaderDataView = textureCollectionNode.children[0].children[3].dataView;
        const textureData = textureCollectionNode.children[1].children[1].dataBuffer;
        const textureCount = textureCollHeaderDataView.byteLength / 0x20;
        let offset = 0;
        for(let i = 0; i < textureCount; i++, offset += 0x7c) {
            const id = textureInfoDataView.getUint32(offset + 0x24, true);
            if(id in map.textureCache)
                continue;
            const format = this.getTextureFormat(textureCollHeaderDataView.getUint32(i * 0x20 + 0x14));
            let texDataOffset = textureInfoDataView.getUint32(offset + 0x30, true);
            let width = textureInfoDataView.getUint16(offset + 0x44, true);
            let height = textureInfoDataView.getUint16(offset + 0x46, true);
            const mipMapCount = textureInfoDataView.getUint8(offset + 0x4E);
            const wrapMode = textureInfoDataView.getUint8(offset + 0x4F);
            const transparencyInfo = textureInfoDataView.getUint16(offset + 0x55, true);
            const alphaTest = (transparencyInfo & 0xFF) == 1 || ((transparencyInfo & 0xFF) == 2 && transparencyInfo != 2);
            const transparencyType = transparencyInfo >> 8;
            const cullMode = textureInfoDataView.getUint8(offset + 0x57);
            const scrollAnimationType = textureInfoDataView.getUint16(offset + 0x52, true);

            const texDescriptor: GfxTextureDescriptor = {
                dimension: GfxTextureDimension.n2D,
                pixelFormat: format,
                width,
                height,
                depth: 1,
                numLevels: mipMapCount,
                usage: GfxTextureUsage.Sampled
            };
            const textureObject: GfxTexture = device.createTexture(texDescriptor);
            const texDataLevels = [];
            for(let j = 0; j < mipMapCount; j++) {
                const texDataSize = this.getTextureDataSize(format, width, height);
                texDataLevels.push(textureData.slice(texDataOffset, texDataOffset + texDataSize).createTypedArray(Uint8Array));
                width /= 2;
                height /= 2;
                texDataOffset += texDataSize;
            }

            device.uploadTextureData(textureObject, 0, texDataLevels);
            const sampler = renderCache.createSampler({
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Linear,
                wrapS: wrapMode & 0x01 ? GfxWrapMode.Repeat : GfxWrapMode.Clamp,
                wrapT: wrapMode & 0x02 ? GfxWrapMode.Repeat : GfxWrapMode.Clamp,
                maxAnisotropy: 16
            });

            const texture = new NfsTexture();
            texture.gfxTexture = textureObject;
            texture.gfxSampler = sampler;
            texture.alphaTest = alphaTest;
            texture.transparencyType = transparencyType;
            texture.faceCulling = cullMode < 2 && !alphaTest;
            if(scrollAnimationType != 0) {
                texture.scrollAnimation = {
                    interval: scrollAnimationType == 2 ? textureInfoDataView.getInt16(offset + 0x58, true) / 256 : -1,
                    scrollSpeed: [
                        textureInfoDataView.getInt16(offset + 0x5a, true) / 1024,
                        textureInfoDataView.getInt16(offset + 0x5c, true) / 1024,
                    ]
                };
            }
            map.textureCache[id] = texture;
        }
    }

    private getTextureDataSize(format: number, width: number, height: number): number {
        // We can assume that texture width and height are always powers of two
        switch(format) {
            case GfxFormat.BC1:
                return Math.max(1, width / 4) * Math.max(1, height / 4) * 8;
            case GfxFormat.BC2:
            case GfxFormat.BC3:
                return Math.max(1, width / 4) * Math.max(1, height / 4) * 16;
            case GfxFormat.U8_RGBA_NORM:
                return 4 * width * height;
            case GfxFormat.U8_R_NORM:
                return width * height;
            default:
                throw "Invalid texture format";
        }
    }

    private getTextureFormat(format: number): GfxFormat {
        switch(format) {
            case 0x44585431:        // "DXT1"
                return GfxFormat.BC1;
            case 0x44585433:        // "DXT3"
                return GfxFormat.BC2;
            case 0x44585435:        // "DXT5"
                return GfxFormat.BC3;
            case 0x15000000:
                return GfxFormat.U8_RGBA_NORM;
            case 0x29000000:
                return GfxFormat.U8_R_NORM;
            default:
                throw "Invalid texture format";
        }
    }

    private parseModelIds(modelListNode: NfsNode, map: NfsMap): NfsModel[] {
        const modelCount = modelListNode.dataBuffer.byteLength / 0x48;
        const models = [];
        for(let i = 0; i < modelCount; i++) {
            const modelId = modelListNode.dataView.getUint32(i * 0x48 + 0x18, true);
            const model = map.modelCache[modelId];
            models.push(model);
        }
        return models;
    }

    private parseTextureCycleAnimation(node: NfsNode, map: NfsMap) {
        const texId = node.children[1].dataView.getUint32(0x18, true);
        const texture = map.textureCache[texId];
        assert(texture != undefined);
        const frameCount = node.children[1].dataView.getUint32(0x1c, true);
        const frequency = node.children[1].dataView.getUint32(0x20, true);
        const frames = [];
        for(let i = 0; i < frameCount; i++) {
            const frameTexId = node.children[2].dataView.getUint32(0x10 * i, true);
            const frame = map.textureCache[frameTexId];
            assert(frame != undefined);
            frames.push(frame);
        }
        texture.cycleAnimation = { frequency, frames };
    }

    private parseParticleEmitterGroups(map: NfsMap) {
        const emitterCollections = this.dataSections.flatMap(s => s.node!.children.filter(node => node.type == NodeType.ParticleEmitter));
        emitterCollections.forEach(n => this.parseParticleEmitterGroup(n, map));
    }

    private parseParticleEmitterGroup(node: NfsNode, map: NfsMap) {
        const dataView = node.dataView;
        const count = dataView.getUint32(0x8, true);
        let offset = 0x10;
        for(let i = 0; i < count; i++) {
            while(dataView.getUint32(offset + 0x8, true) == 0) {
                offset += 0x30;
            }
            const type = dataView.getUint32(offset, true);
            offset += 0x10;
            const matrix: mat4 = mat4.create();
            for(let j = 0; j < 16; j++) {
                matrix[j] = dataView.getFloat32(offset, true);
                offset += 4;
            }
            transformToViewerCoordinateSystem(matrix);

            this.emitterGroups.push(new NfsParticleEmitterGroup(matrix, type, map));

            if(!NfsRegion.emitterTypes.includes(type))
                NfsRegion.emitterTypes.push(type);
        }
    }
}

export enum InstanceType {
    Regular,
    Shadow,
    TrackBarrier,
    Hidden,
    Sky
}

export interface NfsBoundingVolume {
    boundingBox: AABB;
    collectInstancesToRender: (collection: NfsInstance[], frustum: Frustum, fullyInside: boolean) => void;
}

export class NfsBoundingVolumeGroup {
    public boundingBox: AABB;
    public children: NfsBoundingVolume[];

    public collectInstancesToRender(collection: NfsInstance[], frustum: Frustum, fullyInside: boolean) {
        if(!fullyInside) {
            const state = frustum.intersect(this.boundingBox);
            if(state == IntersectionState.FULLY_OUTSIDE)
                return;
            fullyInside = state == IntersectionState.FULLY_INSIDE;
        }

        this.children.forEach(c => c.collectInstancesToRender(collection, frustum, fullyInside));
    }

}

export class NfsInstance {
    public boundingBox: AABB;
    public model: NfsModel;
    public worldMatrix: mat4;
    public type: InstanceType = InstanceType.Regular;
    public invertedFaces: boolean;

    public collectInstancesToRender(collection: NfsInstance[], frustum: Frustum, fullyInside: boolean) {
        if(!fullyInside && frustum.intersect(this.boundingBox) == IntersectionState.FULLY_OUTSIDE)
            return;

        collection.push(this);
    }
}

export class NfsModel {
    public vertInfos: VertexInfo[];
    public isHiddenModel: boolean = false;
    private vertexBuffers: GfxBuffer[] = [];
    private indexBuffer: GfxBuffer;
    private static textDecoder: TextDecoder = new TextDecoder();

    constructor(device: GfxDevice, map: NfsMap, modelNode: NfsNode) {
        this.vertInfos = [];
        assert(modelNode.type == NodeType.Model);

        const meshDataNode = modelNode.children.filter((node) => node.type == NodeType.Mesh)[0];
        const meshHeaderNode = meshDataNode.children[0];
        const dataView = meshHeaderNode.dataView;
        const submeshCount = dataView.getInt32(0x10, true);
        const indexCount = dataView.getInt32(0x2C, true);

        const nameStartBytes = modelNode.children[0].dataBuffer.subarray(0xA0, 6).createTypedArray(Uint8Array);
        const nameStart = NfsModel.textDecoder.decode(nameStartBytes).toUpperCase();
        this.isHiddenModel = nameStart == "SHADOW" || nameStart.startsWith("ANM");

        this.indexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Index, meshDataNode.children[2].dataBuffer.slice(0, indexCount * 2));

        const textureList = [];
        const textureListDataView = modelNode.children[1].dataView;
        for(let i = 0; i < textureListDataView.byteLength / 8; i++) {
            const textureId = textureListDataView.getUint32(i * 8, true);
            textureList.push(map.textureCache[textureId]);
        }

        const submeshDataView = meshDataNode.children[1].dataView;
        let currentVertexOffset = 0;
        let currentVertexListIndex = 0;
        let submeshBaseOffset = 0x18;
        for(let i = 0; i < submeshCount; i++) {
            const shaderType = submeshDataView.getInt32(submeshBaseOffset + 0x18, true);
            const vertexCount = submeshDataView.getInt32(submeshBaseOffset + 0x24, true);
            const indexCount = 3 * submeshDataView.getInt32(submeshBaseOffset + 0x28, true);
            const indexOffset = submeshDataView.getInt32(submeshBaseOffset + 0x2C, true);
            const byteStride = shaderType == 0 || shaderType == 6 || shaderType == 5 ? 0x24 : shaderType == 19 ? 0x2c : 0x3c;
            const diffuseTexture = textureList[submeshDataView.getUint8(submeshBaseOffset)];
            const normalMap = textureList[submeshDataView.getUint8(submeshBaseOffset + 1)];
            const specularMap = textureList[submeshDataView.getUint8(submeshBaseOffset + 3)];
            submeshBaseOffset += 0x68;

            const vertexOffset = currentVertexOffset;
            const vertexListIndex = currentVertexListIndex;
            if((vertexOffset + vertexCount) * byteStride == meshDataNode.children[3 + currentVertexListIndex].dataBuffer.byteLength) {
                // Reached end of vertex list
                currentVertexOffset = 0;
                currentVertexListIndex++;
            }
            else {
                currentVertexOffset += vertexCount;
            }

            if(this.vertexBuffers.length == vertexListIndex) {
                // create new buffer if the current vertex list doesn't have one yet
                this.vertexBuffers.push(makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, meshDataNode.children[3 + vertexListIndex].dataBuffer));
            }

            if(diffuseTexture == undefined)
                continue;
            const textureMappings: NfsTexture[] = [diffuseTexture];

            const vertAttDesc: GfxVertexAttributeDescriptor[] = [
                {location: 0, format: GfxFormat.F32_RGB, bufferByteOffset:0, bufferIndex:0},                            // position
                {location: 1, format: GfxFormat.F32_RG, bufferByteOffset:0x1C, bufferIndex:0},                          // uv
                {location: 2, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset:0x18, bufferIndex:0},                    // vertex colors
                {location: 3, format: GfxFormat.F32_RGB, bufferByteOffset:0xC, bufferIndex:0}                           // normals
            ];
            if(byteStride >= 0x38) {
                vertAttDesc.push({location: 4, format: GfxFormat.F32_RGB, bufferByteOffset:0x2C, bufferIndex:0});         // tangents
                textureMappings.push(normalMap, specularMap);
            }
            const vertInpLayoutBufDesc: GfxInputLayoutBufferDescriptor[] = [
                { byteStride, frequency: GfxVertexBufferFrequency.PerVertex}
            ];
            const inputLayout = device.createInputLayout({
                vertexAttributeDescriptors: vertAttDesc, vertexBufferDescriptors: vertInpLayoutBufDesc, indexBufferFormat: GfxFormat.U16_R
            });
            const vertexBufDesc: GfxVertexBufferDescriptor[] = [
                {buffer: this.vertexBuffers[vertexListIndex], byteOffset: 0}
            ];
            const inputState = device.createInputState(inputLayout, vertexBufDesc, {buffer: this.indexBuffer, byteOffset: 0});

            this.vertInfos.push({ inputLayout, inputState, drawCall: { indexOffset, indexCount }, textureMappings, shaderType });
        }

    }

    public destroy(device: GfxDevice) {
        this.vertInfos.forEach(v => {
            device.destroyInputLayout(v.inputLayout);
            device.destroyInputState(v.inputState);
        });
        this.vertexBuffers.forEach(b => device.destroyBuffer(b));
        device.destroyBuffer(this.indexBuffer);
    }
}


export class NfsTexture extends TextureMapping {
    public alphaTest: boolean;
    public transparencyType: number;        // 0 = Opaque, 1 = Translucent, 2 = Additive, 3 = Subtractive
    public faceCulling: boolean;
    public cycleAnimation?: {
        frequency: number,
        frames: NfsTexture[]
    }
    public scrollAnimation?: {
        interval: number,                   // -1 for continuous scrolling
        scrollSpeed: vec2
    }

    public destroy(device: GfxDevice) {
        if(this.gfxTexture)
            device.destroyTexture(this.gfxTexture);
        // Don't need to destroy animation frames here since they're in NfsMap.textureCache as well
    }
}

function readBoundingBox(dataView: DataView, offset: number): AABB {
    // Convert bounding box to viewer coordinate system
    return new AABB(
        -dataView.getFloat32(offset + 12, true),
        dataView.getFloat32(offset + 8, true),
        dataView.getFloat32(offset + 4, true),
        -dataView.getFloat32(offset, true),
        dataView.getFloat32(offset + 20, true),
        dataView.getFloat32(offset + 16, true)
    );
}

function transformToViewerCoordinateSystem(m: mat4) {
    const temp = [m[1], m[5], m[9], m[13]];
    m[0] = -m[0];
    m[4] = -m[4];
    m[8] = -m[8];
    m[12] = -m[12];

    m[1] = m[2];
    m[5] = m[6];
    m[9] = m[10];
    m[13] = m[14];

    m[2] = temp[0];
    m[6] = temp[1];
    m[10] = temp[2];
    m[14] = temp[3];
}
