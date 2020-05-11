
import { DeviceProgram } from "../Program";
import { VMT, parseVMT } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyProgramKey } from "../gfx/render/GfxRenderer";
import { nArray, assert, assertExists } from "../util";
import { GfxDevice, GfxProgram, GfxMegaStateDescriptor, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxTexture, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3, vec4 } from "gl-matrix";
import { fillMatrix4x3, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { VTF } from "./VTF";
import { SourceFileSystem } from "./Scenes_HalfLife2";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from "../Camera";
import { Surface, SurfaceLighting } from "./BSPFile";

export class BaseMaterialProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelView;
#ifdef USE_LIGHTMAP
    vec4 u_LightmapScaleBias;
#endif
    vec4 u_Misc[1];
};

#define u_AlphaTestReference (u_Misc[0].x)

varying vec4 v_TexCoord;
uniform sampler2D u_Texture[2];

#ifdef VERT
layout(location = ${BaseMaterialProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${BaseMaterialProgram.a_TexCoord}) attribute vec4 a_TexCoord;

vec2 CalcScaleBias(in vec2 t_Pos, in vec4 t_SB) {
    return t_Pos.xy * t_SB.xy + t_SB.zw;
}

void mainVS() {
    gl_Position = Mul(u_Projection, vec4(Mul(u_ModelView, vec4(a_Position, 1.0)), 1.0));
    v_TexCoord.xy = a_TexCoord.xy;
#ifdef USE_LIGHTMAP
    v_TexCoord.zw = CalcScaleBias(a_TexCoord.zw, u_LightmapScaleBias);
#endif
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 t_BaseTexture = texture(SAMPLER_2D(u_Texture[0], v_TexCoord.xy)).rgba;

    vec4 t_Albedo = t_BaseTexture;
    // TODO(jstpierre): Combine.

#ifdef USE_ALPHATEST
    if (t_Albedo.a < u_AlphaTestReference)
        discard;
#endif

#ifdef USE_LIGHTMAP
    vec3 t_DiffuseLighting = texture(SAMPLER_2D(u_Texture[1], v_TexCoord.zw)).rgb;
    t_Albedo.rgb *= t_DiffuseLighting;
#endif

    gl_FragColor.rgba = t_Albedo.rgba;
}
#endif
`;
}

const zup = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

const scratchMatrix = mat4.create();
export class BaseMaterial {
    public visible = true;
    public program: BaseMaterialProgram;
    public gfxProgram: GfxProgram;
    public megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    public sortKeyBase: number = 0;

    // Texture parameters.
    private baseTexture: VTF | null = null;
    private lightmapAllocation: LightmapAllocation | null = null;

    public textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    // Material parameters.
    // TODO(jstpierre): This doesn't seem to be in the files? Not sure.
    private alphatestreference: number = 0.4;

    public wantsLightmap = false;
    public wantsBumpmap = false;

    constructor(public vmt: VMT) {
    }

    public async init(device: GfxDevice, cache: GfxRenderCache, materialCache: MaterialCache) {
        await this.fetchResources(materialCache);
        this.initSync();

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    protected async fetchResources(materialCache: MaterialCache) {
        const vmt = this.vmt;

        // Base textures.
        if (vmt.$basetexture !== undefined)
            this.baseTexture = await materialCache.fetchVTF(assertExists(vmt.$basetexture));
    }

    protected initSync() {
        const vmt = this.vmt;

        const shaderType = vmt._Root.toLowerCase();

        this.program = new BaseMaterialProgram();
        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (this.baseTexture !== null)
            this.baseTexture.fillTextureMapping(this.textureMapping[0]);

        if (shaderType === 'lightmappedgeneric') {
            // Use lightmap. We don't support bump-mapped lighting yet.
            this.program.defines.set('USE_LIGHTMAP', '1');
            this.wantsLightmap = true;
        }

        if (vmt.$alphatest) {
            this.program.defines.set('USE_ALPHATEST', '1');
            if (vmt.$alphatestreference)
                this.alphatestreference = Number(vmt.$alphatestreference);
        } else {
            // Set translucency. There's a matvar for it, but the real behavior appears to come
            // from the texture's flags.
            let isTranslucent = false;

            if (this.baseTexture !== null && this.baseTexture.isTranslucent())
                isTranslucent = true;

            if (isTranslucent && vmt.$additive) {
                // BLENDADD
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE,
                });
            } else if (isTranslucent) {
                // BLEND
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                });
            } else if (vmt.$additive) {
                // ADD
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.ONE,
                    blendDstFactor: GfxBlendFactor.ONE,
                });
            }

            let sortLayer: GfxRendererLayer;
            if (isTranslucent || vmt.$additive) {
                this.megaStateFlags.depthWrite = false;
                sortLayer = GfxRendererLayer.TRANSLUCENT;
            } else {
                sortLayer = GfxRendererLayer.OPAQUE;
            }

            this.sortKeyBase = makeSortKey(sortLayer);
        }
    }

    public isMaterialLoaded(): boolean {
        if (this.textureMapping[0].gfxTexture === null)
            return false;

        return true;
    }

    public setLightmapAllocation(lightmapAllocation: LightmapAllocation): void {
        this.lightmapAllocation = lightmapAllocation;
        const lightmapTextureMapping = this.textureMapping[1];
        lightmapTextureMapping.gfxTexture = this.lightmapAllocation.gfxTexture;
        lightmapTextureMapping.gfxSampler = this.lightmapAllocation.gfxSampler;
    }

    public setOnRenderInst(renderInst: GfxRenderInst, viewMatrix: mat4): void {
        let offs = renderInst.allocateUniformBuffer(BaseMaterialProgram.ub_ObjectParams, 4*3+4+4);
        const d = renderInst.mapUniformBufferF32(BaseMaterialProgram.ub_ObjectParams);
        mat4.mul(scratchMatrix, viewMatrix, zup);
        offs += fillMatrix4x3(d, offs, scratchMatrix);
        if (this.wantsLightmap)
            offs += fillVec4v(d, offs, this.lightmapAllocation!.scaleBiasVec);
        offs += fillVec4(d, offs, this.alphatestreference);

        assert(this.isMaterialLoaded());
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public computeViewSpaceDepth(center: vec3, viewMatrix: mat4): number {
        mat4.mul(scratchMatrix, viewMatrix, zup);
        return computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(scratchMatrix, center);
    }

    public destroy(device: GfxDevice): void {
    }
}

class HiddenMaterial extends BaseMaterial {
    protected initSync() {
        super.initSync();
        this.visible = false;
    }
}

export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        this.textureCache.set('_rt_Camera', new VTF(device, cache, null));
    }

    private resolvePath(path: string, ext: string): string {
        return this.filesystem.resolvePath(`materials/${path}${ext}`);
    }

    private async fetchMaterialDataInternal(name: string): Promise<VMT> {
        const path = this.resolvePath(name, '.vmt');
        return parseVMT(this.filesystem, path);
    }

    private fetchMaterialData(path: string): Promise<VMT> {
        if (!this.materialPromiseCache.has(path))
            this.materialPromiseCache.set(path, this.fetchMaterialDataInternal(path));
        return this.materialPromiseCache.get(path)!;
    }

    private createMaterialInstanceInternal(vmt: VMT): BaseMaterial {
        // Hacks for now. I believe these are normally hidden by not actually being in the BSP tree.
        if (vmt['%compilesky'] || vmt['%compiletrigger']) {
            return new HiddenMaterial(vmt);
        }

        // const shaderType = vmt._Root.toLowerCase();

        // Dispatch based on shader type.
        return new BaseMaterial(vmt);
    }

    public async createMaterialInstance(path: string): Promise<BaseMaterial> {
        const vmt = await this.fetchMaterialData(path);
        const materialInstance = this.createMaterialInstanceInternal(vmt);
        await materialInstance.init(this.device, this.cache, this);
        return materialInstance;
    }

    private async fetchVTFInternal(name: string): Promise<VTF> {
        const path = this.resolvePath(name, '.vtf');
        const data = assertExists(await this.filesystem.fetchFileData(path));
        const vtf = new VTF(this.device, this.cache, data);
        this.textureCache.set(name, vtf);
        return vtf;
    }

    public fetchVTF(name: string): Promise<VTF> {
        if (this.textureCache.has(name))
            return Promise.resolve(this.textureCache.get(name)!);

        if (!this.texturePromiseCache.has(name))
            this.texturePromiseCache.set(name, this.fetchVTFInternal(name));
        return this.texturePromiseCache.get(name)!;
    }

    public destroy(device: GfxDevice): void {
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}

// Lightmap / Lighting data

export class LightmapAllocation {
    public width: number;
    public height: number;
    public scaleBiasVec = vec4.create();
    public gfxTexture: GfxTexture | null = null;
    public gfxSampler: GfxSampler | null = null;
}

export class LightmapManager {
    private lightmapTextures: GfxTexture[] = [];
    public gfxSampler: GfxSampler;
    public scratchpad = new Float32Array(4 * 128 * 128 * 4);

    constructor(private device: GfxDevice, cache: GfxRenderCache) {
        this.gfxSampler = cache.createSampler(device, {
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 100,
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
        })
    }

    public allocate(allocation: LightmapAllocation): void {
        assert(allocation.gfxTexture === null);

        const gfxFormat = GfxFormat.U8_RGBA_SRGB;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(gfxFormat, allocation.width, allocation.height, 1));
        allocation.gfxTexture = gfxTexture;
        allocation.gfxSampler = this.gfxSampler;
        this.lightmapTextures.push(gfxTexture);

        const textureWidth = allocation.width;
        const textureHeight = allocation.height;

        const scaleX = 1.0 / textureWidth;
        const scaleY = 1.0 / textureHeight;
        const offsX = 0.0;
        const offsY = 0.0;
        vec4.set(allocation.scaleBiasVec, scaleX, scaleY, offsX, offsY);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapTextures.length; i++)
            device.destroyTexture(this.lightmapTextures[i]);
    }
}

// Convert from RGBM-esque storage to linear light
function lightmapUnpackTexelStorage(v: number, exp: number): number {
    // exp comes in unsigned, sign extend
    exp = (exp << 24) >> 24;
    const m = Math.pow(2.0, exp) / 255.0;
    return v * m;
}

function lightmapAccumLight(dst: Float32Array, dstOffs: number, src: Uint8Array, size: number, m: number): void {
    for (let i = 0; i < size; i += 4) {
        const sr = src[i + 0], sg = src[i + 1], sb = src[i + 2], exp = src[i + 3];
        dst[dstOffs++] = m * lightmapUnpackTexelStorage(sr, exp);
        dst[dstOffs++] = m * lightmapUnpackTexelStorage(sg, exp);
        dst[dstOffs++] = m * lightmapUnpackTexelStorage(sb, exp);
        dst[dstOffs++] = 1.0;
    }
}

// Convert from linear light to runtime lightmap storage space (currently gamma 2.2).
function lightmapPackTexelRuntime(v: number): number {
    const gamma = 2.2;
    return Math.pow(v, 1.0 / gamma);
}

function lightmapPackRuntime(dst: Uint8ClampedArray, dstOffs: number, src: Float32Array, srcOffs: number, size: number): void {
    for (let i = 0; i < size; i += 4) {
        const sr = src[srcOffs + i + 0], sg = src[srcOffs + i + 1], sb = src[srcOffs + i + 2], alpha = src[srcOffs + i + 3];
        dst[dstOffs++] = (lightmapPackTexelRuntime(sr) * 255.0) | 0;
        dst[dstOffs++] = (lightmapPackTexelRuntime(sg) * 255.0) | 0;
        dst[dstOffs++] = (lightmapPackTexelRuntime(sb) * 255.0) | 0;
        dst[dstOffs++] = (alpha * 255.0) | 0;
    }
}

export class WorldLightingState {
    public styleIntensities = new Float32Array(255);

    constructor() {
        this.styleIntensities.fill(1.0);
    }
}

function createRuntimeLightmap(width: number, height: number, wantsLightmap: boolean, wantsBumpmap: boolean): Uint8ClampedArray[] {
    if (!wantsLightmap && !wantsBumpmap) {
        return [];
    }

    let numLightmaps = 1;
    if (wantsLightmap && wantsBumpmap) {
        numLightmaps = 4;
    }

    const lightmapSize = (width * height * 4);
    return [new Uint8ClampedArray(numLightmaps * lightmapSize)];
}

export class SurfaceLightingInstance {
    public allocation = new LightmapAllocation();
    public lightmapDirty: boolean = true;

    private lighting: SurfaceLighting;
    private runtimeLightmapData: Uint8ClampedArray[];
    private scratchpad: Float32Array;

    constructor(lightmapManager: LightmapManager, surface: Surface, public wantsLightmap: boolean, public wantsBumpmap: boolean) {
        this.scratchpad = lightmapManager.scratchpad;

        this.lighting = assertExists(surface.lighting);
        this.runtimeLightmapData = createRuntimeLightmap(this.lighting.width, this.lighting.height, this.wantsLightmap, this.wantsBumpmap);

        // Allocate texture.
        if (this.wantsLightmap) {
            this.allocation.width = this.lighting.width;
            this.allocation.height = this.lighting.height;
            lightmapManager.allocate(this.allocation);
        }
    }

    public buildLightmap(worldLightingState: WorldLightingState): void {
        if (!this.lightmapDirty)
            return;

        const hasLightmap = this.lighting.samples !== null;
        if (this.wantsLightmap && hasLightmap) {
            const size = this.lighting.width * this.lighting.height * 4;

            const scratchpad = this.scratchpad;
            for (let i = 0; i < this.lighting.styles.length; i++) {
                const styleIdx = this.lighting.styles[i];
                if (styleIdx === 0xFF)
                    break;

                const intensity = worldLightingState.styleIntensities[styleIdx];
                lightmapAccumLight(scratchpad, 0, this.lighting.samples!, size, intensity);
            }

            lightmapPackRuntime(this.runtimeLightmapData[0], 0, scratchpad, 0, size);
        } else if (this.wantsLightmap && !hasLightmap) {
            // Fill with white.
            this.runtimeLightmapData[0].fill(255);
        }

        this.lightmapDirty = false;
    }

    public uploadLightmap(device: GfxDevice): void {
        if (!this.wantsLightmap)
            return;

        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(this.allocation.gfxTexture!, 0, this.runtimeLightmapData);
        device.submitPass(hostAccessPass);
    }
}
