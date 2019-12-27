
// @ts-ignore
import program_glsl from './program.glsl';
import * as rw from 'librw';
import * as UI from "../ui";
import * as Viewer from '../viewer';
import * as Assets from './assets';
import { GfxDevice, GfxRenderPass, GfxBuffer, GfxInputLayout, GfxInputState, GfxMegaStateDescriptor, GfxProgram, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxTexture, GfxSampler, makeTextureDescriptor2D, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxCompareMode } from '../gfx/platform/GfxPlatform';
import { MeshFragData, Texture, rwTexture } from '../GrandTheftAuto3/render';
import { vec3, vec2, mat4, quat } from 'gl-matrix';
import { colorNewCopy, White, colorNew, Color, colorCopy, TransparentBlack } from '../Color';
import { filterDegenerateTriangleIndexBuffer, convertToTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { DeviceProgram } from '../Program';
import { GfxRenderInstManager, setSortKeyDepth, GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderer';
import { AABB, squaredDistanceFromPointToAABB } from '../Geometry';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { assert, nArray } from '../util';
import { GraphObjBase } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { computeViewSpaceDepthFromWorldSpaceAABB, FPSCameraController } from '../Camera';
import { fillColor, fillMatrix4x4, fillMatrix4x3, fillVec4, fillVec3v } from '../gfx/helpers/UniformBufferHelpers';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { BasicRenderTarget, depthClearRenderPassDescriptor, makeClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { TextureMapping } from '../TextureHolder';
import { RWAtomicStruct, RWChunk, parseRWAtomic, createRWStreamFromChunk, RWAtomicFlags, quatFromYPR } from './util';
import { EventID } from './events';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';
import { computeEulerAngleRotationFromSRTMatrix } from '../MathHelpers';
import { Asset } from './hip';

const DRAW_DISTANCE = 1000.0;

interface BFBBProgramDef {
    JSP?: string;
    SKY?: string;
    SKY_DEPTH?: string;
    USE_TEXTURE?: string;
    USE_LIGHTING?: string;
    USE_FOG?: string;
    ALPHA_REF?: string;
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
        if (def.SKY)
            this.defines.set('SKY', def.SKY);
        if (def.SKY_DEPTH)
            this.defines.set('SKY_DEPTH', def.SKY_DEPTH);
        if (def.USE_TEXTURE)
            this.defines.set('USE_TEXTURE', def.USE_TEXTURE);
        if (def.USE_LIGHTING)
            this.defines.set('USE_LIGHTING', def.USE_LIGHTING);
        if (def.USE_FOG)
            this.defines.set('USE_FOG', def.USE_FOG);
        if (def.ALPHA_REF)
            this.defines.set('ALPHA_REF', def.ALPHA_REF);
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

export interface JSP {
    model?: ModelData;
    textures?: TextureData[];
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

class MeshRenderer {
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
    public transparent = false;

    constructor(device: GfxDevice, cache: GfxRenderCache, defines: BFBBProgramDef, public frag: RWMeshFragData,
        private textureData?: TextureData, private pipeInfo?: Assets.PipeInfo, subObject?: number) {

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
            vbuf[voffs++] = posnorm[2]; // Normal has to be rotated for whatever reason...
            vbuf[voffs++] = posnorm[0]; // These coordinates might be wrong. They look
            vbuf[voffs++] = posnorm[1]; // the most accurate out of all combinations though
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
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LEQUAL)
        };
        let blendMode = GfxBlendMode.ADD;
        let blendDstFactor = GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
        let blendSrcFactor = GfxBlendFactor.SRC_ALPHA;

        let useFog = !defines.SKY;
        let useLighting = !defines.SKY;
        let alphaRef = 0;

        if (this.pipeInfo && (this.pipeInfo.SubObjectBits & subObject!)) {
            this.megaStateFlags.cullMode = convertPipeCullMode(this.pipeInfo.PipeFlags.cullMode);
            this.megaStateFlags.depthWrite = !this.pipeInfo.PipeFlags.noZWrite;
            const dstFactor = convertPipeBlendFunction(this.pipeInfo.PipeFlags.dstBlend);
            const srcFactor = convertPipeBlendFunction(this.pipeInfo.PipeFlags.srcBlend);
            if (dstFactor != -1) blendDstFactor = dstFactor;
            if (srcFactor != -1) blendSrcFactor = srcFactor;

            if (this.pipeInfo.PipeFlags.noFog)
                useFog = false;
            
            if (this.pipeInfo.PipeFlags.noLighting)
                useLighting = false;
            
            if (this.pipeInfo.PipeFlags.alphaCompare)
                alphaRef = this.pipeInfo.PipeFlags.alphaCompare / 255;
        }

        if (useFog && !defines.USE_FOG)
            defines.USE_FOG = '1';
        if (useLighting && !defines.USE_LIGHTING)
            defines.USE_LIGHTING = '1';
        if (alphaRef && !defines.ALPHA_REF)
            defines.ALPHA_REF = alphaRef.toString();

        setAttachmentStateSimple(this.megaStateFlags, { blendMode, blendDstFactor, blendSrcFactor });

        this.transparent = frag.transparent || (textureData ? textureData.texture.transparent : false) || !this.megaStateFlags.depthWrite;
        const renderLayer = this.transparent ? GfxRendererLayer.TRANSLUCENT : (defines.SKY ? GfxRendererLayer.BACKGROUND : GfxRendererLayer.OPAQUE);

        this.program = new BFBBProgram(defines);
        this.gfxProgram = device.createProgram(this.program);

        this.sortKey = makeSortKey(renderLayer);
        this.filterKey = defines.SKY ? BFBBPass.SKYDOME : BFBBPass.MAIN;
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
        
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, this.bboxModel);
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

export class ModelRenderer {
    public bbox = new AABB(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    private bboxModel = new AABB();

    public renderers: MeshRenderer[] = [];
    public modelMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, defines: BFBBProgramDef, model: ModelData, textures?: TextureData[], public color: Color = White) {
        let subObject = 1 << (model.meshes.length - 1);

        for (let i = 0; i < model.meshes.length; i++) {
            const mesh = model.meshes[i];

            if (mesh.atomicStruct.flags & RWAtomicFlags.Render) {
                for (const frag of mesh.frags) {
                    let textureData: TextureData | undefined;
                    if (frag.texName && textures) {
                        textureData = textures.find((tex) => tex.name === frag.texName);

                        if (textureData) {
                            textureData.setup(device, cache);
                            defines.USE_TEXTURE = '1';
                        }
                    }
                    
                    const renderer = new MeshRenderer(device, cache, defines, frag, textureData, model.pipeInfo, subObject);
                    this.bbox.union(this.bbox, renderer.bbox);
                    this.renderers.push(renderer);
                }
            }

            subObject >>>= 1;
        }
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

        for (let i = 0; i < this.renderers.length; i++) {
            mat4.copy(this.renderers[i].modelMatrix, this.modelMatrix);
            this.renderers[i].prepareToRender(device, renderInstManager, viewerInput);
        }
        
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].destroy(device);
    }
}

export class JSPRenderer {
    public modelRenderer?: ModelRenderer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public readonly jsp: JSP) {
        this.modelRenderer = new ModelRenderer(device, cache, { USE_LIGHTING: '0' }, jsp.model!, jsp.textures);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        if (this.modelRenderer)
            this.modelRenderer.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice) {
        if (this.modelRenderer)
            this.modelRenderer.destroy(device);
    }
}

export class EntRenderer {
    public modelRenderer?: ModelRenderer;
    public visible: boolean;
    public color: Color;

    public isSkydome = false;
    public skydomeLockY = false;

    public modelMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, public readonly ent: Ent) {
        this.visible = (ent.asset.flags & Assets.EntFlags.Visible) != 0;
        this.color = {
            r: ent.asset.redMult,
            g: ent.asset.greenMult,
            b: ent.asset.blueMult,
            a: ent.asset.seeThru
        };

        if (ent.model) {
            const defines: BFBBProgramDef = {};

            for (const link of ent.asset.links) {
                if (link.srcEvent === EventID.SceneBegin && link.dstEvent === EventID.SetSkyDome) {
                    this.isSkydome = true;
                    defines.SKY = '1';
                    defines.SKY_DEPTH = `${link.param[0] / 8.0}`;
                    this.skydomeLockY = (link.param[1] === 1);
                    break;
                }
            }

            this.modelRenderer = new ModelRenderer(device, cache, defines, ent.model, ent.textures, this.color);

            const q = quat.create();
            quatFromYPR(q, ent.asset.ang);

            mat4.fromRotationTranslationScale(this.modelMatrix, q, ent.asset.pos, ent.asset.scale);
        }
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
    public renderers: GraphObjBase[] = [];

    private fog?: Fog;
    private lightKit?: Assets.LightKit;

    private lightPositionCache: vec3[] = [];
    private lightDirectionCache: vec3[] = [];

    private lightingEnabled = true;

    private lightingEnabled = true;

    public renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    private clearColor: Color;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
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
        this.lightDirectionCache.length = 0;

        for (const light of lightKit.lightListArray) {
            const position = vec3.fromValues(light.matrix[12], light.matrix[13], light.matrix[14]);
            const direction = vec3.fromValues(light.matrix[8], light.matrix[9], light.matrix[10]);
            this.lightPositionCache.push(position);
            this.lightDirectionCache.push(direction);
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
            if (this.lightingEnabled && this.lightKit && this.lightKit.lightCount > i) {
                const light = this.lightKit.lightListArray[i];
                offs += fillVec3v(mapped, offs, this.lightPositionCache[i]);
                offs += fillVec3v(mapped, offs, this.lightDirectionCache[i]);
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

        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

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

    public createPanels(): UI.Panel[] {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const lightingCheckbox = new UI.Checkbox("Lighting", true);
        lightingCheckbox.onchanged = () => {
            this.lightingEnabled = lightingCheckbox.checked;
        };

        panel.contents.appendChild(lightingCheckbox.elem);
        panel.setVisible(true);
        return [panel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].destroy(device);
    }
}