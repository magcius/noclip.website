
import { DeviceProgram } from "../Program";
import { VMT, parseVMT, vmtParseColor } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyProgramKey } from "../gfx/render/GfxRenderer";
import { nArray, assert, assertExists, fallback } from "../util";
import { GfxDevice, GfxProgram, GfxMegaStateDescriptor, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxTexture, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3, vec4 } from "gl-matrix";
import { fillMatrix4x3, fillVec4, fillVec4v, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { VTF } from "./VTF";
import { SourceFileSystem } from "./Scenes_HalfLife2";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from "../Camera";
import { Surface, SurfaceLighting } from "./BSPFile";
import { Color, White } from "../Color";

export class BaseMaterialProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TangentS = 2;
    public static a_TexCoord = 3;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelView;
    vec4 u_CameraPosWorld;
#ifdef USE_DETAIL
    vec4 u_DetailScaleBias;
#endif
#ifdef USE_LIGHTMAP
    vec4 u_LightmapScaleBias;
#endif
#ifdef USE_ENVMAP_MASK
    vec4 u_EnvmapMaskScaleBias;
#endif
#ifdef USE_ENVMAP
    vec4 u_EnvmapTint;
#endif
    vec4 u_Misc[1];
};

#define u_AlphaTestReference (u_Misc[0].x)
#define u_DetailBlendFactor  (u_Misc[0].y)
#define u_LightmapOffset     (u_Misc[0].z)

// Base, Detail
varying vec4 v_TexCoord0;
// Lightmap (0), Envmap Mask
varying vec4 v_TexCoord1;
// Bumpmap
varying vec4 v_TexCoord2;
varying vec3 v_PositionWorld;

#define HAS_FULL_TANGENTSPACE (USE_BUMPMAP)

#ifdef HAS_FULL_TANGENTSPACE
// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
#endif
// Just need the vertex normal component.
varying vec3 v_TangentSpaceBasis2;

// Base, Detail, Bumpmap, Lightmap, Envmap Mask
uniform sampler2D u_Texture[5];

// Cube Envmap
uniform samplerCube u_TextureCube[1];

#ifdef VERT
layout(location = ${BaseMaterialProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${BaseMaterialProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${BaseMaterialProgram.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${BaseMaterialProgram.a_TexCoord}) attribute vec4 a_TexCoord;

vec2 CalcScaleBias(in vec2 t_Pos, in vec4 t_SB) {
    return t_Pos.xy * t_SB.xy + t_SB.zw;
}

void mainVS() {
    gl_Position = Mul(u_Projection, vec4(Mul(u_ModelView, vec4(a_Position, 1.0)), 1.0));

    // TODO(jstpierre): MV/P split.
    v_PositionWorld = a_Position;
    vec3 t_NormalWorld = a_Normal;

#ifdef HAS_FULL_TANGENTSPACE
    vec3 t_TangentSWorld = a_TangentS.xyz;
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
#endif
    v_TangentSpaceBasis2 = t_NormalWorld;

    // TODO(jstpierre): BaseScale
    v_TexCoord0.xy = a_TexCoord.xy;
#ifdef USE_DETAIL
    v_TexCoord0.zw = CalcScaleBias(a_TexCoord.xy, u_DetailScaleBias);
#endif
#ifdef USE_LIGHTMAP
    v_TexCoord1.xy = CalcScaleBias(a_TexCoord.zw, u_LightmapScaleBias);
#endif
#ifdef USE_ENVMAP_MASK
    v_TexCoord1.zw = CalcScaleBias(a_TexCoord.xy, u_EnvmapMaskScaleBias);
#endif
#ifdef USE_BUMPMAP
    // TODO(jstpierre): BumpmapScale
    v_TexCoord2.xy = a_TexCoord.xy;
#endif
}
#endif

#ifdef FRAG

#define COMBINE_MODE_MUL_DETAIL2        (0)
vec4 TextureCombine(in vec4 t_BaseTexture, in vec4 t_DetailTexture, in int t_CombineMode, in float t_BlendFactor) {
    if (t_CombineMode == COMBINE_MODE_MUL_DETAIL2) {
        return t_BaseTexture * mix(vec4(1.0), t_DetailTexture * 2.0, t_BlendFactor);
    } else {
        // Unknown.
        return t_BaseTexture + vec4(1.0, 0.0, 1.0, 0.0);
    }
}

vec3 CalcReflection(in vec3 t_NormalWorld, in vec3 t_PositionToEye) {
    return (2.0 * (dot(t_NormalWorld, t_PositionToEye)) * t_NormalWorld) - (dot(t_NormalWorld, t_NormalWorld) * t_PositionToEye);
}

// https://steamcdn-a.akamaihd.net/apps/valve/2004/GDC2004_Half-Life2_Shading.pdf#page=10
const vec3 g_RNBasis0 = vec3( 1.2247448713915890,  0.0000000000000000, 0.5773502691896258); //  sqrt3/2, 0,        sqrt1/3
const vec3 g_RNBasis1 = vec3(-0.4082482904638631,  0.7071067811865475, 0.5773502691896258); // -sqrt1/6, sqrt1/2,  sqrt1/3
const vec3 g_RNBasis2 = vec3(-0.4082482904638631, -0.7071067811865475, 0.5773502691896258); // -sqrt1/6, -sqrt1/2, sqrt1/3

void mainPS() {
    vec4 t_BaseTexture = texture(SAMPLER_2D(u_Texture[0], v_TexCoord0.xy)).rgba;

    vec4 t_Albedo;
#ifdef USE_DETAIL
    vec4 t_DetailTexture = texture(SAMPLER_2D(u_Texture[1], v_TexCoord0.zw)).rgba;
    t_Albedo = TextureCombine(t_BaseTexture, t_DetailTexture, DETAIL_COMBINE_MODE, u_DetailBlendFactor);
#else
    t_Albedo = t_BaseTexture;
#endif

#ifdef USE_ALPHATEST
    if (t_Albedo.a < u_AlphaTestReference)
        discard;
#endif

    vec4 t_FinalColor;

    vec3 t_NormalWorld;
#ifdef USE_BUMPMAP
    vec4 t_BumpmapSample = texture(SAMPLER_2D(u_Texture[2], v_TexCoord2.xy));
    vec3 t_BumpmapNormal = t_BumpmapSample.rgb * 2.0 - 1.0;

    t_NormalWorld.x = dot(vec3(v_TangentSpaceBasis0.x, v_TangentSpaceBasis1.x, v_TangentSpaceBasis2.x), t_BumpmapNormal);
    t_NormalWorld.y = dot(vec3(v_TangentSpaceBasis0.y, v_TangentSpaceBasis1.y, v_TangentSpaceBasis2.y), t_BumpmapNormal);
    t_NormalWorld.z = dot(vec3(v_TangentSpaceBasis0.z, v_TangentSpaceBasis1.z, v_TangentSpaceBasis2.z), t_BumpmapNormal);
#else
    t_NormalWorld = v_TangentSpaceBasis2;
#endif

vec3 t_DiffuseLighting;
#ifdef USE_LIGHTMAP
#ifdef USE_DIFFUSE_BUMPMAP
    vec3 t_LightmapColor1 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 1.0))).rgb;
    vec3 t_LightmapColor2 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 2.0))).rgb;
    vec3 t_LightmapColor3 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 3.0))).rgb;
    vec3 t_Influence;
    t_Influence.x = clamp(dot(t_NormalWorld, g_RNBasis0), 0.0, 1.0);
    t_Influence.y = clamp(dot(t_NormalWorld, g_RNBasis1), 0.0, 1.0);
    t_Influence.z = clamp(dot(t_NormalWorld, g_RNBasis2), 0.0, 1.0);

    t_DiffuseLighting = vec3(0.0);
    t_DiffuseLighting += t_LightmapColor1 * t_Influence.x;
    t_DiffuseLighting += t_LightmapColor2 * t_Influence.y;
    t_DiffuseLighting += t_LightmapColor3 * t_Influence.z;
#else
    t_DiffuseLighting = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy)).rgb;
#endif
#else
    t_DiffuseLighting = vec3(1.0);
#endif
    t_FinalColor.rgb += t_DiffuseLighting * t_Albedo.rgb;

#ifdef USE_ENVMAP
    vec3 t_SpecularFactor = vec3(u_EnvmapTint);

#ifdef USE_ENVMAP_MASK
    t_SpecularFactor *= texture(SAMPLER_2D(u_Texture[4], v_TexCoord1.zw)).rgb;
#endif

#ifdef USE_NORMALMAP_ALPHA_ENVMAP_MASK
    t_SpecularFactor *= t_BumpmapSample.a;
#endif

    vec3 t_SpecularLighting = vec3(0.0);
    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);
    t_SpecularLighting += texture(u_TextureCube[0], t_Reflection).rgb;
    t_SpecularLighting *= t_SpecularFactor;

    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
    float t_Fresnel = pow(1.0 - dot(t_NormalWorld, t_WorldDirectionToEye), 5.0);
    t_SpecularLighting *= t_Fresnel;

    t_FinalColor.rgb += t_SpecularLighting.rgb;
#endif

    t_FinalColor.a = t_Albedo.a;

    // Gamma correction.
    t_FinalColor.rgb = pow(t_FinalColor.rgb, vec3(1.0 / 2.2));

    gl_FragColor = t_FinalColor;
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

function scaleBiasSet(dst: vec4, scale: number, x: number = 0.0, y: number = 0.0): void {
    vec4.set(dst, scale, scale, x, y);
}

const scratchMatrix = mat4.create();
export class BaseMaterial {
    public visible = true;
    public program: BaseMaterialProgram;
    public gfxProgram: GfxProgram;
    public megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    public sortKeyBase: number = 0;

    // Texture parameters.
    private baseTexture: VTF | null = null;
    private detailTexture: VTF | null = null;
    private envmapMaskTexture: VTF | null = null;
    private envmapTexture: VTF | null = null;
    private bumpmapTexture: VTF | null = null;
    private lightmapAllocation: LightmapAllocation | null = null;

    public textureMapping: TextureMapping[] = nArray(6, () => new TextureMapping());

    // Material parameters.
    public wantsLightmap = false;
    public wantsBumpmap = false;
    public wantsBumpmappedLightmap = false;
    public wantsDetail = false;
    public wantsEnvmap = false;
    public wantsEnvmapMask = false;

    private alphaTestReference: number = 0.0;
    private detailScaleBias = vec4.create();
    private detailTint: Color = White;
    private detailBlendFactor = 1.0;
    private envmapMaskScaleBias = vec4.create();
    private envmapTint: Color = White;

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
            this.baseTexture = await materialCache.fetchVTF(vmt.$basetexture);
        if (vmt.$detail !== undefined)
            this.detailTexture = await materialCache.fetchVTF(vmt.$detail);
        if (vmt.$bumpmap !== undefined)
            this.bumpmapTexture = await materialCache.fetchVTF(vmt.$bumpmap);
        if (vmt.$envmapmask !== undefined)
            this.envmapMaskTexture = await materialCache.fetchVTF(vmt.$envmapmask);
        if (vmt.$envmap !== undefined)
            this.envmapTexture = await materialCache.fetchVTF(vmt.$envmap);
    }

    protected initSync() {
        const vmt = this.vmt;

        const shaderType = vmt._Root.toLowerCase();

        this.program = new BaseMaterialProgram();
        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (this.baseTexture !== null)
            this.baseTexture.fillTextureMapping(this.textureMapping[0]);

        if (this.detailTexture !== null) {
            this.wantsDetail = true;
            this.program.defines.set('USE_DETAIL', '1');
            this.program.defines.set('DETAIL_COMBINE_MODE', fallback(vmt.$detailblendmode, '0'));
            this.detailTexture.fillTextureMapping(this.textureMapping[1]);
            if (vmt.$detailblendfactor)
                this.detailBlendFactor = Number(vmt.$detailblendfactor);
            if (vmt.$detailtint)
                this.detailTint = vmtParseColor(vmt.$detailtint);

            if (vmt.$detailscale)
                scaleBiasSet(this.detailScaleBias, Number(vmt.$detailscale));
        }

        if (this.bumpmapTexture !== null) {
            this.wantsBumpmap = true;
            this.program.defines.set('USE_BUMPMAP', '1');
            this.bumpmapTexture.fillTextureMapping(this.textureMapping[2]);
            const wantsDiffuseBumpmap = !vmt.$nodiffusebumplighting;
            this.program.defines.set('USE_DIFFUSE_BUMPMAP', wantsDiffuseBumpmap ? '1' : '0');
            this.wantsBumpmappedLightmap = wantsDiffuseBumpmap;
        }

        // Lightmap = 3

        if (this.envmapMaskTexture !== null) {
            this.wantsEnvmapMask = true;
            this.program.defines.set('USE_ENVMAP_MASK', '1');
            this.envmapMaskTexture.fillTextureMapping(this.textureMapping[4]);
            scaleBiasSet(this.envmapMaskScaleBias, 1.0);
        }

        if (this.envmapTexture !== null) {
            this.wantsEnvmap = true;
            this.program.defines.set('USE_ENVMAP', '1');
            if (vmt.$envmaptint)
                this.envmapTint = vmtParseColor(vmt.$envmaptint);
            this.envmapTexture.fillTextureMapping(this.textureMapping[5]);
        }

        if (shaderType === 'lightmappedgeneric') {
            // Use lightmap. We don't support bump-mapped lighting yet.
            this.program.defines.set('USE_LIGHTMAP', '1');
            this.wantsLightmap = true;
        }

        if (vmt.$normalmapalphaenvmapmask) {
            this.program.defines.set('USE_NORMALMAP_ALPHA_ENVMAP_MASK', '1');
        }

        if (vmt.$alphatest) {
            this.program.defines.set('USE_ALPHATEST', '1');
            if (vmt.$alphatestreference) {
                this.alphaTestReference = Number(vmt.$alphatestreference);
            } else {
                // TODO(jstpierre): This default was just guessed.
                this.alphaTestReference = 0.4;
            }
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
        const lightmapTextureMapping = this.textureMapping[3];
        lightmapTextureMapping.gfxTexture = this.lightmapAllocation.gfxTexture;
        lightmapTextureMapping.gfxSampler = this.lightmapAllocation.gfxSampler;
    }

    public setOnRenderInst(renderInst: GfxRenderInst, viewMatrix: mat4): void {
        let offs = renderInst.allocateUniformBuffer(BaseMaterialProgram.ub_ObjectParams, 4*3+4+4+4+4+4+4+4);
        const d = renderInst.mapUniformBufferF32(BaseMaterialProgram.ub_ObjectParams);
        mat4.mul(scratchMatrix, viewMatrix, zup);
        offs += fillMatrix4x3(d, offs, scratchMatrix);
        // Compute camera world translation.
        mat4.invert(scratchMatrix, scratchMatrix);
        offs += fillVec4(d, offs, scratchMatrix[12], scratchMatrix[13], scratchMatrix[14]);
        if (this.wantsDetail)
            offs += fillVec4v(d, offs, this.detailScaleBias);
        if (this.wantsLightmap)
            offs += fillVec4v(d, offs, this.lightmapAllocation!.scaleBias);
        if (this.wantsEnvmapMask)
            offs += fillVec4v(d, offs, this.envmapMaskScaleBias);
        if (this.wantsEnvmap)
            offs += fillColor(d, offs, this.envmapTint);
        const lightmapOffset = this.lightmapAllocation !== null ? this.lightmapAllocation.bumpPageOffset : 0.0;
        offs += fillVec4(d, offs, this.alphaTestReference, this.detailBlendFactor, lightmapOffset);

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
    public width: number = 0;
    public height: number = 0;
    public scaleBias = vec4.create();
    public bumpPageOffset: number = 0;
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
        vec4.set(allocation.scaleBias, scaleX, scaleY, offsX, offsY);

        allocation.bumpPageOffset = scaleY * (allocation.height / 4);
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

    constructor(lightmapManager: LightmapManager, surface: Surface, private wantsLightmap: boolean, private wantsBumpmap: boolean) {
        this.scratchpad = lightmapManager.scratchpad;

        this.lighting = assertExists(surface.lighting);
        this.runtimeLightmapData = createRuntimeLightmap(this.lighting.width, this.lighting.height, this.wantsLightmap, this.wantsBumpmap);

        // Allocate texture.
        if (this.wantsLightmap) {
            const numLightmaps = this.wantsBumpmap ? 4 : 1;
            this.allocation.width = this.lighting.width;
            this.allocation.height = this.lighting.height * numLightmaps;
            lightmapManager.allocate(this.allocation);
        }
    }

    public buildLightmap(worldLightingState: WorldLightingState): void {
        if (!this.lightmapDirty)
            return;

        const hasLightmap = this.lighting.samples !== null;
        if (this.wantsLightmap && hasLightmap) {
            const dstSize = this.allocation.width * this.allocation.height * 4;
            const srcNumLightmaps = (this.wantsBumpmap && this.lighting.hasBumpmapSamples) ? 4 : 1
            const srcSize = srcNumLightmaps * this.lighting.width * this.lighting.height * 4;

            const scratchpad = this.scratchpad;
            scratchpad.fill(0);
            assert(scratchpad.byteLength >= dstSize);
            for (let i = 0; i < this.lighting.styles.length; i++) {
                const styleIdx = this.lighting.styles[i];
                if (styleIdx === 0xFF)
                    break;

                const intensity = worldLightingState.styleIntensities[styleIdx];
                lightmapAccumLight(scratchpad, 0, this.lighting.samples!, srcSize, intensity);
            }

            if (this.wantsBumpmap && !this.lighting.hasBumpmapSamples) {
                // Game wants bumpmap samples but has none. Copy from primary lightsource.
                const src = new Float32Array(scratchpad.buffer, 0, srcSize * 4);
                for (let i = 1; i < 4; i++) {
                    const dst = new Float32Array(scratchpad.buffer, i * srcSize * 4, srcSize * 4);
                    dst.set(src);
                }
            }

            lightmapPackRuntime(this.runtimeLightmapData[0], 0, scratchpad, 0, dstSize);
        } else if (this.wantsLightmap && !hasLightmap) {
            // Fill with white. Handles both bump & non-bump cases.
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
