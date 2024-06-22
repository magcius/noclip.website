
import { White, OpaqueBlack, TransparentBlack } from "../../Color.js";
import { makeStaticDataBuffer } from "../../gfx/helpers/BufferHelpers.js";
import { gfxDeviceNeedsFlipY } from "../../gfx/helpers/GfxDeviceHelpers.js";
import { makeSolidColorTexture2D } from "../../gfx/helpers/TextureHelpers.js";
import { GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxDevice, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxBufferUsage, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxCompareMode } from "../../gfx/platform/GfxPlatform.js";
import { GfxFormat } from "../../gfx/platform/GfxPlatformFormat.js";
import { GfxBuffer, GfxInputLayout, GfxTexture, GfxSampler } from "../../gfx/platform/GfxPlatformImpl.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { GfxRenderInst } from "../../gfx/render/GfxRenderInstManager.js";
import { Cubemap } from "../BSPFile.js";
import { SourceFileSystem } from "../Main.js";
import { ParticleSystemCache } from "../ParticleSystem.js";
import { VMT, parseVMT } from "../VMT.js";
import { VTF } from "../VTF.js";
import { MaterialShaderTemplateBase, LateBindingTexture, BaseMaterial } from "./MaterialBase.js";
import { Material_Generic, ShaderTemplate_Generic } from "./Material_Generic.js";
import { Material_Modulate, ShaderTemplate_Modulate } from "./Material_Modulate.js";
import { Material_Refract, ShaderTemplate_Refract } from "./Material_Refract.js";
import { Material_Sky, ShaderTemplate_Sky, ShaderTemplate_SkyHDRCompressed } from "./Material_Sky.js";
import { Material_SolidEnergy, ShaderTemplate_SolidEnergy } from "./Material_SolidEnergy.js";
import { Material_SpriteCard, ShaderTemplate_SpriteCard } from "./Material_SpriteCard.js";
import { Material_UnlitTwoTexture, ShaderTemplate_UnlitTwoTexture } from "./Material_UnlitTwoTexture.js";
import { Material_Water, ShaderTemplate_Water } from "./Material_Water.js";

//#region Material Cache
class StaticQuad {
    private vertexBufferQuad: GfxBuffer;
    private indexBufferQuad: GfxBuffer;
    private vertexBufferDescriptorsQuad: GfxVertexBufferDescriptor[];
    private indexBufferDescriptorQuad: GfxIndexBufferDescriptor;
    public zeroVertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialShaderTemplateBase.a_Position,   bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialShaderTemplateBase.a_TexCoord01, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
            { location: MaterialShaderTemplateBase.a_Color,      bufferIndex: 0, bufferByteOffset: 5*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_Normal,     bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_TangentS,   bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2+4)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 0, frequency: GfxVertexBufferFrequency.Constant, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        const n0 = 1, n1 = -1;
        this.vertexBufferQuad = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Float32Array([
            0, n0, n0, 1, 0, 1, 1, 1, 1,
            0, n0, n1, 1, 1, 1, 1, 1, 1,
            0, n1, n0, 0, 0, 1, 1, 1, 1,
            0, n1, n1, 0, 1, 1, 1, 1, 1,
        ]).buffer);
        this.indexBufferQuad = makeStaticDataBuffer(device, GfxBufferUsage.Index, new Uint16Array([
            0, 1, 2, 2, 1, 3,
        ]).buffer);

        this.zeroVertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new ArrayBuffer(16));

        this.vertexBufferDescriptorsQuad = [
            { buffer: this.vertexBufferQuad, byteOffset: 0 },
            { buffer: this.zeroVertexBuffer, byteOffset: 0, },
        ];
        this.indexBufferDescriptorQuad = { buffer: this.indexBufferQuad, byteOffset: 0 };
    }

    public setQuadOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptorsQuad, this.indexBufferDescriptorQuad);
        renderInst.setDrawCount(6);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBufferQuad);
        device.destroyBuffer(this.indexBufferQuad);
        device.destroyBuffer(this.zeroVertexBuffer);
    }
}

class StaticResources {
    public whiteTexture2D: GfxTexture;
    public opaqueBlackTexture2D: GfxTexture;
    public transparentBlackTexture2D: GfxTexture;
    public linearClampSampler: GfxSampler;
    public linearRepeatSampler: GfxSampler;
    public pointClampSampler: GfxSampler;
    public shadowSampler: GfxSampler;
    public staticQuad: StaticQuad;
    public zeroVertexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.whiteTexture2D = makeSolidColorTexture2D(device, White);
        this.opaqueBlackTexture2D = makeSolidColorTexture2D(device, OpaqueBlack);
        this.transparentBlackTexture2D = makeSolidColorTexture2D(device, TransparentBlack);
        this.shadowSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            compareMode: GfxCompareMode.Less,
        });
        this.linearClampSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
        this.linearRepeatSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.pointClampSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Point,
            minFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
        this.staticQuad = new StaticQuad(device, cache);
        this.zeroVertexBuffer = this.staticQuad.zeroVertexBuffer;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.whiteTexture2D);
        device.destroyTexture(this.opaqueBlackTexture2D);
        device.destroyTexture(this.transparentBlackTexture2D);
        this.staticQuad.destroy(device);
    }
}

class ShaderTemplates {
    public Generic = new ShaderTemplate_Generic();
    public Modulate = new ShaderTemplate_Modulate();
    public UnlitTwoTexture = new ShaderTemplate_UnlitTwoTexture();
    public Water = new ShaderTemplate_Water();
    public Refract = new ShaderTemplate_Refract();
    public SolidEnergy = new ShaderTemplate_SolidEnergy();
    public Sky = new ShaderTemplate_Sky();
    public SkyHDRCompressed = new ShaderTemplate_SkyHDRCompressed();
    public SpriteCard = new ShaderTemplate_SpriteCard();

    public destroy(device: GfxDevice): void {
        this.Generic.destroy(device);
        this.Modulate.destroy(device);
        this.UnlitTwoTexture.destroy(device);
        this.Water.destroy(device);
        this.Refract.destroy(device);
        this.SolidEnergy.destroy(device);
        this.Sky.destroy(device);
        this.SkyHDRCompressed.destroy(device);
        this.SpriteCard.destroy(device);
    }
}

export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();
    private usingHDR: boolean = false;
    public readonly particleSystemCache: ParticleSystemCache;
    public ssbumpNormalize = false;
    public staticResources: StaticResources;
    public materialDefines: string[] = [];
    public deviceNeedsFlipY: boolean;
    public shaderTemplates = new ShaderTemplates();

    constructor(public device: GfxDevice, public cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        // Install render targets
        const _rt_Camera = new VTF(device, cache, null, '_rt_Camera', false, LateBindingTexture.Camera);
        _rt_Camera.width = 256;
        _rt_Camera.height = 256;
        this.textureCache.set('_rt_Camera', _rt_Camera);
        this.textureCache.set('_rt_RefractTexture', new VTF(device, cache, null, '_rt_RefractTexture', false, LateBindingTexture.FramebufferColor));
        this.textureCache.set('_rt_WaterRefraction', new VTF(device, cache, null, '_rt_WaterRefraction', false, LateBindingTexture.FramebufferColor));
        this.textureCache.set('_rt_WaterReflection', new VTF(device, cache, null, '_rt_WaterReflection', false, LateBindingTexture.WaterReflection));
        this.textureCache.set('_rt_Depth', new VTF(device, cache, null, '_rt_Depth', false, LateBindingTexture.FramebufferDepth));
        this.staticResources = new StaticResources(device, cache);

        this.particleSystemCache = new ParticleSystemCache(this.filesystem);

        this.deviceNeedsFlipY = gfxDeviceNeedsFlipY(device);
    }

    public isInitialized(): boolean {
        if (!this.particleSystemCache.isLoaded)
            return false;

        return true;
    }

    public setRenderConfig(hdr: boolean, bspVersion: number): void {
        this.setUsingHDR(hdr);

        // Portal 2 has a fix for ssbump materials being too bright.
        this.ssbumpNormalize = (bspVersion >= 21);
    }

    private setUsingHDR(hdr: boolean): void {
        this.usingHDR = hdr;

        this.materialDefines = [`gpu>=1`, `gpu>=2`, `gpu>=3`, `>=dx90_20b`, `>=dx90`, `>dx90`, `srgb`, `srgb_pc`, `dx9`];
        this.materialDefines.push(this.usingHDR ? `hdr` : `ldr`);
    }

    public isUsingHDR(): boolean {
        return this.usingHDR;
    }

    public async bindLocalCubemap(cubemap: Cubemap) {
        const vtf = await this.fetchVTF(cubemap.filename, true);
        this.textureCache.set('env_cubemap', vtf);
    }

    private resolvePath(path: string): string {
        if (!path.startsWith(`materials/`))
            path = `materials/${path}`;
        return path;
    }

    private async fetchMaterialDataInternal(name: string): Promise<VMT> {
        return parseVMT(this.filesystem, this.resolvePath(name));
    }

    private fetchMaterialData(path: string): Promise<VMT> {
        if (!this.materialPromiseCache.has(path))
            this.materialPromiseCache.set(path, this.fetchMaterialDataInternal(path));
        return this.materialPromiseCache.get(path)!;
    }

    private createMaterialInstanceInternal(vmt: VMT): BaseMaterial {
        // Dispatch based on shader type.
        const shaderType = vmt._Root.toLowerCase();
        if (shaderType === 'water')
            return new Material_Water(vmt);
        else if (shaderType === 'modulate')
            return new Material_Modulate(vmt);
        else if (shaderType === 'unlittwotexture' || shaderType === 'monitorscreen')
            return new Material_UnlitTwoTexture(vmt);
        else if (shaderType === 'refract')
            return new Material_Refract(vmt);
        else if (shaderType === 'solidenergy')
            return new Material_SolidEnergy(vmt);
        else if (shaderType === 'sky')
            return new Material_Sky(vmt);
        else if (shaderType === 'spritecard')
            return new Material_SpriteCard(vmt);
        else
            return new Material_Generic(vmt);
    }

    public async createMaterialInstance(path: string): Promise<BaseMaterial> {
        const vmt = await this.fetchMaterialData(path);
        const materialInstance = this.createMaterialInstanceInternal(vmt);
        if (vmt['%compiletrigger'])
            materialInstance.isToolMaterial = true;
        return materialInstance;
    }

    public checkVTFExists(name: string): boolean {
        const path = this.filesystem.resolvePath(this.resolvePath(name), '.vtf');
        return this.filesystem.hasEntry(path);
    }

    private async fetchVTFInternal(name: string, srgb: boolean, cacheKey: string): Promise<VTF> {
        const path = this.filesystem.resolvePath(this.resolvePath(name), '.vtf');
        const data = await this.filesystem.fetchFileData(path);
        const vtf = new VTF(this.device, this.cache, data, path, srgb);
        this.textureCache.set(cacheKey, vtf);
        return vtf;
    }

    private getCacheKey(name: string, srgb: boolean): string {
        // Special runtime render target
        if (name.startsWith('_rt_'))
            return name;

        return srgb ? `${name}_srgb` : name;
    }

    public fetchVTF(name: string, srgb: boolean): Promise<VTF> {
        const cacheKey = this.getCacheKey(name, srgb);

        if (this.textureCache.has(cacheKey))
            return Promise.resolve(this.textureCache.get(cacheKey)!);

        if (!this.texturePromiseCache.has(cacheKey))
            this.texturePromiseCache.set(cacheKey, this.fetchVTFInternal(name, srgb, cacheKey));
        return this.texturePromiseCache.get(cacheKey)!;
    }

    public destroy(device: GfxDevice): void {
        this.staticResources.destroy(device);
        this.shaderTemplates.destroy(device);
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}
//#endregion
