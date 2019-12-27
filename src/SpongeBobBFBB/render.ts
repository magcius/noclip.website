
// @ts-ignore
import program_glsl from './program.glsl';
import * as rw from 'librw';
import * as Viewer from '../viewer';
import * as Assets from './assets';
import { GfxDevice, GfxRenderPass, GfxBuffer, GfxInputLayout, GfxInputState, GfxMegaStateDescriptor, GfxProgram, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxTexture, GfxSampler, makeTextureDescriptor2D, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxCompareMode, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform';
import { MeshFragData, TextureArray, Texture, rwTexture } from '../GrandTheftAuto3/render';
import { vec3, vec2, mat4, quat } from 'gl-matrix';
import { colorNewCopy, White, colorNew, Color, colorCopy, TransparentBlack } from '../Color';
import { filterDegenerateTriangleIndexBuffer, convertToTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { DeviceProgram } from '../Program';
import { GfxRenderInstManager, GfxRenderInst, setSortKeyDepth, GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderer';
import { AABB, squaredDistanceFromPointToAABB } from '../Geometry';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { assert, nArray } from '../util';
import { GraphObjBase } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { computeViewSpaceDepthFromWorldSpaceAABB, FPSCameraController } from '../Camera';
import { fillColor, fillMatrix4x4, fillMatrix4x3, fillVec4, fillVec3v } from '../gfx/helpers/UniformBufferHelpers';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { BasicRenderTarget, transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, makeClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { TextureMapping } from '../TextureHolder';
import { mat4FromYPR, RWAtomicStruct, RWChunk, parseRWAtomic, createRWStreamFromChunk, RWAtomicFlags, quatFromYPR } from './util';
import { EventID } from './events';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';
import { computeEulerAngleRotationFromSRTMatrix } from '../MathHelpers';

const DRAW_DISTANCE = 1000.0;

interface BFBBProgramDef {
    ENT?: string;
    SKY?: string;
    SKY_DEPTH?: string;
    USE_TEXTURE?: string;
}

class BFBBProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public both = program_glsl;

    constructor(def: BFBBProgramDef = {}) {
        super();
        if (def.ENT)
            this.defines.set('ENT', def.ENT);
        if (def.SKY)
            this.defines.set('SKY', def.SKY);
        if (def.SKY_DEPTH)
            this.defines.set('SKY_DEPTH', def.SKY_DEPTH);
        if (def.USE_TEXTURE)
            this.defines.set('USE_TEXTURE', def.USE_TEXTURE);
    }
}

class RWMeshFragData implements MeshFragData {
    public indices: Uint16Array;
    public texName?: string;
    public transparent: boolean;

    private baseColor = colorNewCopy(White);
    private indexMap: number[];

    constructor(mesh: rw.Mesh, tristrip: boolean, txdName: string, private positions: Float32Array,
        private normals: Float32Array | null, private texCoords: Float32Array | null, private colors: Uint8Array | null) {

        this.transparent = false;

        const { texture, color } = mesh.material;

        if (color && color[3] < 0xFF) {
            this.transparent = true;
        } else if (this.colors) {
            for (let i = 0; i < this.colors.length; i += 4) {
                if (this.colors[i+3] < 0xFF) {
                    this.transparent = true;
                    break;
                }
            }
        }

        if (texture)
            // this.texName = txdName + '/' + texture.name.toLowerCase();
            this.texName = txdName;
        if (color)
            this.baseColor = colorNew(color[0] / 0xFF, color[1] / 0xFF, color[2] / 0xFF, color[3] / 0xFF);

        this.indexMap = Array.from(new Set(mesh.indices)).sort();

        this.indices = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(
            tristrip ? GfxTopology.TRISTRIP : GfxTopology.TRIANGLES,
            mesh.indices!.map(index => this.indexMap.indexOf(index))));
    }

    public get vertices() {
        return this.indexMap.length;
    }

    public distanceToCamera(modelMatrix: mat4, cameraPosition: vec3): number {
        let minDist = Infinity;
        const m = modelMatrix;
        for (let i = 0; i < this.positions.length; i += 3) {
            const vx = this.positions[i+0];
            const vy = this.positions[i+1];
            const vz = this.positions[i+2];
            const x = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
            const y = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
            const z = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
            const dx = cameraPosition[0] - x;
            const dy = cameraPosition[1] - y;
            const dz = cameraPosition[2] - z;
            const dist = dx*dx + dy*dy + dz*dz;
            minDist = Math.min(dist, minDist);
        }
        return Math.sqrt(minDist);
    }

    public fillPosition(dst: vec3, index: number): void {
        const i = this.indexMap[index];
        dst[0] = this.positions[3*i+0];
        dst[1] = this.positions[3*i+1];
        dst[2] = this.positions[3*i+2];
    }

    public fillNormal(dst: vec3, index: number): void {
        const i = this.indexMap[index];
        if (this.normals !== null) {
            dst[0] = this.normals[3*i+0];
            dst[1] = this.normals[3*i+1];
            dst[2] = this.normals[3*i+2];
        }
    }

    public fillColor(dst: Color, index: number): void {
        const i = this.indexMap[index];
        colorCopy(dst, this.baseColor);
        if (this.colors !== null) {
            const r = this.colors[4*i+0]/0xFF;
            const g = this.colors[4*i+1]/0xFF;
            const b = this.colors[4*i+2]/0xFF;
            const a = this.colors[4*i+3]/0xFF;
            dst.r *= r;
            dst.g *= g;
            dst.b *= b;
            dst.a *= a;
        }
    }

    public fillTexCoord(dst: vec2, index: number): void {
        const i = this.indexMap[index];
        if (this.texCoords !== null) {
            dst[0] = this.texCoords[2*i+0];
            dst[1] = this.texCoords[2*i+1];
        }
    }
}

export interface MeshData {
    frags: RWMeshFragData[];
    atomicStruct: RWAtomicStruct;
}

export interface ModelData {
    meshes: MeshData[];
    pipeInfo?: Assets.PipeInfo;
}

export class ModelCache {
    public models = new Map<string, ModelData>();

    private addAtomic(atomic: rw.Atomic, atomicStruct: RWAtomicStruct, name: string) {
        const geom = atomic.geometry;
        const positions = geom.morphTarget(0).vertices!.slice();
        const normals = (geom.morphTarget(0).normals) ? geom.morphTarget(0).normals!.slice() : null;
        const texCoords = (geom.numTexCoordSets) ? geom.texCoords(0)!.slice() : null;
        const colors = (geom.colors) ? geom.colors.slice() : null;
        const h = geom.meshHeader;

        if (!this.models.get(name))
            this.models.set(name, { meshes: [] });

        const model = this.models.get(name)!;
        const frags: RWMeshFragData[] = [];

        for (let i = 0; i < h.numMeshes; i++) {
            const mesh = h.mesh(i);
            const texture = mesh.material.texture;
            const txdName = texture ? `${texture.name}.RW3` : '';
            const frag = new RWMeshFragData(h.mesh(i), h.tristrip, txdName, positions, normals, texCoords, colors);
            frags.push(frag);
        }

        model.meshes.push({ frags, atomicStruct });
    }

    public addClump(chunk: RWChunk, name: string) {
        const stream = createRWStreamFromChunk(chunk);
        const clump = rw.Clump.streamRead(stream);

        const atomics: rw.Atomic[] = [];
        const atomicStructs: RWAtomicStruct[] = [];

        for (let lnk = clump.atomics.begin; !lnk.is(clump.atomics.end); lnk = lnk.next) {
            atomics.push(rw.Atomic.fromClump(lnk));
        }

        for (const child of chunk.children) {
            if (child.header.type === rw.PluginID.ID_ATOMIC) {
                const structChunk = child.children[0];
                assert(structChunk.header.type === rw.PluginID.ID_STRUCT);
                const atomicStruct = parseRWAtomic(structChunk);
                atomicStructs.push(atomicStruct);
            }
        }

        assert(atomics.length === atomicStructs.length);

        for (let i = 0; i < atomics.length; i++)
            this.addAtomic(atomics[i], atomicStructs[i], name);
        
        stream.delete();
        clump.delete();

        for (const atomic of atomics)
            atomic.delete();
    }
}

export class TextureData {
    private gfxTexture: GfxTexture | null = null;
    private gfxSampler: GfxSampler | null = null;

    public textureMapping = nArray(1, () => new TextureMapping());

    constructor(public texture: Texture, public name: string, public filter: GfxTexFilterMode, public wrapS: GfxWrapMode, public wrapT: GfxWrapMode) {}

    public setup(device: GfxDevice, cache: GfxRenderCache) {
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(this.texture.pixelFormat, this.texture.width, this.texture.height, 1));
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(this.gfxTexture, 0, [this.texture.levels[0]]);
        device.submitPass(hostAccessPass);

        this.gfxSampler = cache.createSampler(device, {
            magFilter: this.filter,
            minFilter: this.filter,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 1000,
            wrapS: this.wrapS,
            wrapT: this.wrapT,
        });

        const mapping = this.textureMapping[0];
        mapping.width = this.texture.width;
        mapping.height = this.texture.height;
        mapping.flipY = false;
        mapping.gfxTexture = this.gfxTexture;
        mapping.gfxSampler = this.gfxSampler;
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null)
            device.destroyTexture(this.gfxTexture);
        if (this.gfxSampler !== null)
            device.destroySampler(this.gfxSampler);
    }
}

function convertFilterMode(filter: number): GfxTexFilterMode {
    return GfxTexFilterMode.BILINEAR;
}

function convertWrapMode(addressing: number): GfxWrapMode {
    switch (addressing) {
        case rw.Texture.Addressing.MIRROR:
            return GfxWrapMode.MIRROR;
        case rw.Texture.Addressing.WRAP:
            return GfxWrapMode.REPEAT;
        case rw.Texture.Addressing.CLAMP:
        case rw.Texture.Addressing.BORDER:
        default:
            return GfxWrapMode.CLAMP;
    }
}

export class TextureCache {
    public textureData = new Map<string, TextureData[]>();

    public addTexDictionary(texdic: rw.TexDictionary, name: string) {
        if (!this.textureData.get(name))
            this.textureData.set(name, []);

        const textures = this.textureData.get(name)!;

        for (let lnk = texdic.textures.begin; !lnk.is(texdic.textures.end); lnk = lnk.next) {
            const rwtx = rw.Texture.fromDict(lnk);
            const filter = convertFilterMode(rwtx.filter);
            const wrapS = convertWrapMode(rwtx.addressU);
            const wrapT = convertWrapMode(rwtx.addressV);

            const texture = rwTexture(rw.Texture.fromDict(lnk), name, false);
            textures.push(new TextureData(texture, name, filter, wrapS, wrapT));
        }
    }
}

export interface Ent {
    asset: Assets.EntAsset;
    model?: ModelData;
    textures?: TextureData[];
}

export interface Button {
    ent: Ent;
    asset: Assets.ButtonAsset;
}

export interface Platform {
    ent: Ent;
    asset: Assets.PlatformAsset;
}

export interface Player {
    ent: Ent;
    asset: Assets.PlayerAsset;
}

export interface SimpleObj {
    ent: Ent;
    asset: Assets.SimpleObjAsset;
}

export interface Fog {
    asset: Assets.FogAsset;
    bkgndColor: Color;
    fogColor: Color;
}

const enum BFBBPass {
    MAIN,
    SKYDOME,
}

function convertPipeCullMode(cull: Assets.PipeCullMode): GfxCullMode {
    switch (cull) {
        case Assets.PipeCullMode.Back:
            return GfxCullMode.BACK;
        case Assets.PipeCullMode.Unknown3:
            return GfxCullMode.FRONT;
        case Assets.PipeCullMode.None:
        default:
            return GfxCullMode.NONE;
    }
}

function convertPipeZWriteMode(zwrite: Assets.PipeZWriteMode): boolean {
    switch (zwrite) {
        case Assets.PipeZWriteMode.Disable:
        default:
            return false;
        case Assets.PipeZWriteMode.Enable:
            return true;
    }
}

function convertPipeBlendFunction(blend: Assets.PipeBlendFunction): GfxBlendFactor {
    switch (blend) {
        case Assets.PipeBlendFunction.Zero:
            return GfxBlendFactor.ZERO;
        case Assets.PipeBlendFunction.One:
            return GfxBlendFactor.ONE;
        case Assets.PipeBlendFunction.SrcColor:
            return GfxBlendFactor.SRC_COLOR;
        case Assets.PipeBlendFunction.InvSrcColor:
            return GfxBlendFactor.ONE_MINUS_SRC_COLOR;
        case Assets.PipeBlendFunction.SrcAlpha:
            return GfxBlendFactor.SRC_ALPHA;
        case Assets.PipeBlendFunction.InvSrcAlpha:
            return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
        case Assets.PipeBlendFunction.DestAlpha:
            return GfxBlendFactor.DST_ALPHA;
        case Assets.PipeBlendFunction.InvDestAlpha:
            return GfxBlendFactor.ONE_MINUS_DST_ALPHA;
        case Assets.PipeBlendFunction.DestColor:
            return GfxBlendFactor.DST_COLOR;
        case Assets.PipeBlendFunction.InvDestColor:
            return GfxBlendFactor.ONE_MINUS_DST_COLOR;
        case Assets.PipeBlendFunction.SrcAlphaSat:
        case Assets.PipeBlendFunction.NA:
        default:
            return -1;
    }
}

interface SceneRenderer extends GraphObjBase {
    modelMatrix: mat4;
    transparent: boolean;
    distanceToCamera(cameraPosition: vec3): number;
}

class MeshRenderer implements SceneRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private program: DeviceProgram;
    private gfxProgram: GfxProgram;
    private sortKey: number;
    private filterKey: number;

    private indices: number;

    public bbox = new AABB(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    private bboxModel = new AABB();

    public modelMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, defines: BFBBProgramDef, public frag: RWMeshFragData, public transparent: boolean,
            private textureData?: TextureData, private pipeInfo?: Assets.PipeInfo) {
        this.indices = frag.indices.length;
        assert(this.indices > 0);

        const attrLen = 12;
        const vbuf = new Float32Array(frag.vertices * attrLen);
        const ibuf = new Uint32Array(this.indices);
        let voffs = 0;
        let ioffs = 0;

        const posnorm = vec3.create();
        const color = colorNewCopy(White);
        const texcoord = vec2.create();

        for (let i = 0; i < frag.vertices; i++) {
            frag.fillPosition(posnorm, i);
            vbuf[voffs++] = posnorm[0];
            vbuf[voffs++] = posnorm[1];
            vbuf[voffs++] = posnorm[2];
            this.bbox.unionPoint(posnorm);
            frag.fillNormal(posnorm, i);
            vbuf[voffs++] = posnorm[0];
            vbuf[voffs++] = posnorm[1];
            vbuf[voffs++] = posnorm[2];
            frag.fillColor(color, i);
            voffs += fillColor(vbuf, voffs, color);
            frag.fillTexCoord(texcoord, i);
            vbuf[voffs++] = texcoord[0];
            vbuf[voffs++] = texcoord[1];
        }

        for (let i = 0; i < frag.indices.length; i++) {
            ibuf[ioffs++] = frag.indices[i];
        }

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vbuf.buffer);
        this.indexBuffer  = makeStaticDataBuffer(device, GfxBufferUsage.INDEX,  ibuf.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: BFBBProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset:  0  * 0x04 },
            { location: BFBBProgram.a_Normal,   bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset:  3  * 0x04 },
            { location: BFBBProgram.a_Color,    bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset:  6  * 0x04 },
            { location: BFBBProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset:  10 * 0x04 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: attrLen * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = device.createInputLayout({ indexBufferFormat: GfxFormat.U32_R, vertexAttributeDescriptors, vertexBufferDescriptors });
        const buffers: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];
        const indexBuffer: GfxIndexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);

        this.megaStateFlags = {
            cullMode: GfxCullMode.NONE,
            depthWrite: true,
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LEQUAL),
        };
        let blendMode = GfxBlendMode.ADD;
        let blendDstFactor = GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
        let blendSrcFactor = GfxBlendFactor.SRC_ALPHA;

        if (pipeInfo) {
            this.megaStateFlags.cullMode = convertPipeCullMode(Assets.extractPipeCullMode(pipeInfo.PipeFlags));
            this.megaStateFlags.depthWrite = convertPipeZWriteMode(Assets.extractPipeZWriteMode(pipeInfo.PipeFlags));
            const dstFactor = convertPipeBlendFunction(Assets.extractPipeDstBlend(pipeInfo.PipeFlags));
            const srcFactor = convertPipeBlendFunction(Assets.extractPipeSrcBlend(pipeInfo.PipeFlags));
            if (dstFactor != -1) blendDstFactor = dstFactor;
            if (srcFactor != -1) blendSrcFactor = srcFactor;
        }

        setAttachmentStateSimple(this.megaStateFlags, { blendMode, blendDstFactor, blendSrcFactor });
        
        if (textureData) {
            textureData.setup(device, cache);
            defines.USE_TEXTURE = '1';
        }

        let renderLayer = GfxRendererLayer.OPAQUE;

        if (this.transparent)
            renderLayer = GfxRendererLayer.TRANSLUCENT;
        else if (defines.SKY)
            renderLayer = GfxRendererLayer.BACKGROUND;

        this.program = new BFBBProgram(defines);
        this.gfxProgram = device.createProgram(this.program);

        this.sortKey = makeSortKey(renderLayer);
        this.filterKey = defines.SKY ? BFBBPass.SKYDOME : BFBBPass.MAIN;
    }

    public distanceToCamera(cameraPosition: vec3) {
        return this.frag.distanceToCamera(this.modelMatrix, cameraPosition);
    }

    private scratchVec3 = vec3.create();

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        this.bboxModel.transform(this.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(this.bboxModel)) return;

        const camPosition = this.scratchVec3;
        mat4.getTranslation(camPosition, viewerInput.camera.worldMatrix);
        if (Math.sqrt(squaredDistanceFromPointToAABB(camPosition, this.bboxModel)) >= DRAW_DISTANCE) return;

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indices);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        if (this.textureData !== undefined)
            renderInst.setSamplerBindingsFromTextureMappings(this.textureData.textureMapping);
        
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, this.bbox);
        renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
        renderInst.filterKey = this.filterKey;
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyProgram(this.gfxProgram);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

export class ModelRenderer implements SceneRenderer {
    public bbox = new AABB(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    private bboxModel = new AABB();

    public renderers: MeshRenderer[] = [];
    public modelMatrix = mat4.create();

    public transparent: boolean;

    constructor(device: GfxDevice, cache: GfxRenderCache, defines: BFBBProgramDef, model: ModelData, textures?: TextureData[], public color: Color = White) {
        this.transparent = color.a < 1.0;

        let pipeTransparent = false;
        if (model.pipeInfo) {
            if (Assets.extractPipeDstBlend(model.pipeInfo.PipeFlags) === Assets.PipeBlendFunction.One)
                pipeTransparent = true;
        }

        for (let i = 0; i < model.meshes.length; i++) {
            const mesh = model.meshes[i];
            const subObject = 1 << i;

            if (mesh.atomicStruct.flags & RWAtomicFlags.Render) {
                for (const frag of mesh.frags) {
                    let meshTransparent = frag.transparent || pipeTransparent;

                    let textureData: TextureData | undefined;
                    if (frag.texName && textures) {
                        textureData = textures.find((tex) => tex.name === frag.texName);

                        if (textureData && textureData.texture.transparent)
                            meshTransparent = true;
                    }

                    if (meshTransparent)
                        this.transparent = true;
                    
                    let pipeInfo = model.pipeInfo;
                    if (pipeInfo && !(pipeInfo.SubObjectBits & subObject))
                        pipeInfo = undefined;
                    
                    const renderer = new MeshRenderer(device, cache, defines, frag, meshTransparent, textureData, pipeInfo);
                    this.bbox.union(this.bbox, renderer.bbox);
                    this.renderers.push(renderer);
                }
            }
        }
    }

    public distanceToCamera(cameraPosition: vec3) {
        let distance = Infinity;
        for (const renderer of this.renderers)
            distance = Math.min(renderer.distanceToCamera(cameraPosition), distance);
        return distance;
    }

    private scratchVec3 = vec3.create();

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        this.bboxModel.transform(this.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(this.bboxModel)) return;

        const camPosition = this.scratchVec3;
        mat4.getTranslation(camPosition, viewerInput.camera.worldMatrix);
        if (Math.sqrt(squaredDistanceFromPointToAABB(camPosition, this.bboxModel)) >= DRAW_DISTANCE) return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(BFBBProgram.ub_ModelParams, 12 + 4);
        const mapped = template.mapUniformBufferF32(BFBBProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, this.modelMatrix);
        offs += fillColor(mapped, offs, this.color);

        for (const renderer of this.renderers) {
            mat4.copy(renderer.modelMatrix, this.modelMatrix);
            renderer.prepareToRender(device, renderInstManager, viewerInput);
        }
        
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (const renderer of this.renderers)
            renderer.destroy(device);
    }
}

export class EntRenderer implements SceneRenderer {
    public modelRenderer?: ModelRenderer;
    public visible: boolean;
    public color: Color;

    public isSkydome = false;
    public skydomeLockY = false;

    public modelMatrix = mat4.create();
    public transparent = false;

    constructor(device: GfxDevice, cache: GfxRenderCache, public readonly ent: Ent) {
        this.visible = (ent.asset.flags & Assets.EntFlags.Visible) != 0;
        this.color = {
            r: ent.asset.redMult,
            g: ent.asset.greenMult,
            b: ent.asset.blueMult,
            a: ent.asset.seeThru
        };

        if (ent.model) {
            const defines: BFBBProgramDef = { ENT: '1' };

            for (const link of ent.asset.links) {
                if (link.srcEvent === EventID.SceneBegin && link.dstEvent === EventID.SetSkyDome) {
                    this.isSkydome = true;
                    defines.SKY = '1';
                    defines.SKY_DEPTH = `${link.param[0] / 8.0}`;
                    this.skydomeLockY = (link.param[1] === 1);
                }
            }

            this.modelRenderer = new ModelRenderer(device, cache, defines, ent.model, ent.textures, this.color);
            this.transparent = this.modelRenderer.transparent;

            const q = quat.create();
            quatFromYPR(q, ent.asset.ang);

            mat4.fromRotationTranslationScale(this.modelMatrix, q, ent.asset.pos, ent.asset.scale);
        }
    }

    public distanceToCamera(cameraPosition: vec3) {
        return this.modelRenderer ? this.modelRenderer.distanceToCamera(cameraPosition) : Infinity;
    }

    public update(viewerInput: Viewer.ViewerRenderInput) {
        if (this.isSkydome) {
            this.modelMatrix[12] = viewerInput.camera.worldMatrix[12];
            this.modelMatrix[14] = viewerInput.camera.worldMatrix[14];

            if (this.skydomeLockY)
                this.modelMatrix[13] = viewerInput.camera.worldMatrix[13];
        }

        if (this.modelRenderer)
            mat4.copy(this.modelRenderer.modelMatrix, this.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        this.update(viewerInput);

        if (!this.visible) return;
        if (!this.modelRenderer) return;

        this.modelRenderer.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice) {
        if (this.modelRenderer)
            this.modelRenderer.destroy(device);
    }
}

export class BFBBRenderer implements Viewer.SceneGfx {
    private opaqueRenderers: SceneRenderer[] = [];
    private transparentRenderers: SceneRenderer[] = [];

    private fog?: Fog;
    private lightKit?: Assets.LightKit;

    private lightPositionCache: vec3[] = [];
    private lightRotationCache: vec3[] = [];

    public renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    private clearColor: Color;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public addRenderer(renderer: SceneRenderer) {
        if (renderer.transparent)
            this.transparentRenderers.push(renderer);
        else
            this.opaqueRenderers.push(renderer);
    }

    public setFog(fog: Fog) {
        this.fog = fog;
    }

    public getFog() {
        return this.fog;
    }

    public setLightKit(lightKit: Assets.LightKit) {
        this.lightKit = lightKit;

        this.lightPositionCache.length = 0;
        this.lightRotationCache.length = 0;

        const position = vec3.create();
        const rotation = vec3.create();

        for (const light of lightKit.lightListArray) {
            mat4.getTranslation(position, light.matrix);
            computeEulerAngleRotationFromSRTMatrix(rotation, light.matrix);
            this.lightPositionCache.push(vec3.clone(position));
            this.lightRotationCache.push(vec3.clone(rotation));
        }
    }

    public getLightKit() {
        return this.lightKit;
    }

    public createCameraController() {
        const controller = new FPSCameraController();
        controller.sceneKeySpeedMult = 0.025;
        return controller;
    }

    private scratchVec3_0 = vec3.create();
    private scratchVec3_1 = vec3.create();
    private scratchVec3_2 = vec3.create();

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(1);
        this.renderHelper.pushTemplateRenderInst();
        const template = this.renderHelper.renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        this.clearColor = this.fog ? this.fog.bkgndColor : TransparentBlack;
        const fogColor = this.fog ? this.fog.fogColor : TransparentBlack;
        const fogStart = this.fog ? this.fog.asset.fogStart : 0;
        const fogStop = this.fog ? this.fog.asset.fogStop : 0;

        const lightCount = 8;
        const lightSize = (3*4 + 4);

        let offs = template.allocateUniformBuffer(BFBBProgram.ub_SceneParams, 16 + 12 + 2*4 + lightCount*lightSize);
        const mapped = template.mapUniformBufferF32(BFBBProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        offs += fillColor(mapped, offs, fogColor);
        offs += fillVec4(mapped, offs, fogStart, fogStop);

        for (let i = 0; i < lightCount; i++) {
            if (this.lightKit && this.lightKit.lightCount > i) {
                const light = this.lightKit.lightListArray[i];
                offs += fillVec3v(mapped, offs, this.lightPositionCache[i]);
                offs += fillVec3v(mapped, offs, this.lightRotationCache[i]);
                offs += fillColor(mapped, offs, light.color);
                mapped[offs++] = light.type;
                mapped[offs++] = light.radius;
                mapped[offs++] = light.angle;
                mapped[offs++] = 0;
            } else {
                for (let j = 0; j < lightSize; j++)
                    mapped[offs++] = 0;
            }
        }

        const camPosition = this.scratchVec3_0;
        mat4.getTranslation(camPosition, viewerInput.camera.worldMatrix);

        for (const renderer of this.opaqueRenderers)
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        
        const posA = this.scratchVec3_1;
        const posB = this.scratchVec3_2;
        
        // transparency sorting... not perfect yet
        this.transparentRenderers.sort((a, b) => {
            mat4.getTranslation(posA, a.modelMatrix);
            mat4.getTranslation(posB, b.modelMatrix);
            return vec3.squaredDistance(posB, camPosition) - vec3.squaredDistance(posA, camPosition);
        });

        for (const renderer of this.transparentRenderers)
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const clearPassDescriptor = makeClearRenderPassDescriptor(true, this.clearColor);

        const skydomePassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, clearPassDescriptor);
        renderInstManager.setVisibleByFilterKeyExact(BFBBPass.SKYDOME);
        renderInstManager.drawOnPassRenderer(device, skydomePassRenderer);
        skydomePassRenderer.endPass(null);
        device.submitPass(skydomePassRenderer);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        renderInstManager.setVisibleByFilterKeyExact(BFBBPass.MAIN);
        renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        this.renderHelper.renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        for (const renderer of this.opaqueRenderers)
            renderer.destroy(device);
    }
}