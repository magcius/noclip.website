import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4, fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxDevice, makeTextureDescriptor2D, GfxBuffer, GfxInputState, GfxProgram, GfxBindingLayoutDescriptor, GfxTexture, GfxCullMode, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage, GfxSampler, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import { FormatCompFlags, FormatTypeFlags, GfxFormat, makeFormat, setFormatCompFlags } from "../gfx/platform/GfxPlatformFormat";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInst, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { DetailBitmapFunction, BitmapFormat, HaloSceneManager, HaloBSP, HaloLightmap, HaloMaterial, HaloMaterialShader, HaloBitmap, HaloBitmapMetadata, ShaderEnvironmentType } from '../../rust/pkg/index';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { FakeTextureHolder, TextureMapping } from '../TextureHolder';
import { decompressBC } from '../Common/bc_texture';
import { preprocessProgram_GLSL } from '../gfx/shaderc/GfxShaderCompiler';
import { CameraController } from '../Camera';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary';
import { UI } from '../ui';
import { fullscreenMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { InputLayout } from '../DarkSouls/flver';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';

let _wasm: typeof import('../../rust/pkg/index') | null = null;

async function loadWasm() {
    if (_wasm === null) {
        _wasm = await import('../../rust/pkg/index');
    }
    return _wasm;
}

class MaterialProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;
    public static ub_BSPParams = 2;
    public static a_Pos = 0;
    public static a_Norm = 1;
    public static a_TexCoord = 2;
    public static a_LightmapTexCoord = 3;
    public static u_BSPIndex = 4;

    public static includes = `
${GfxShaderLibrary.saturate}
`;
    public static BindingsDefinition = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ModelView;
};

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_MaterialModel;
};

layout(std140) uniform ub_BSPParams {
    vec4 u_Misc;
};

#define u_BSPIndex (u_Misc.x)

uniform sampler2D u_Texture;
uniform sampler2D u_Lightmap;
uniform sampler2D u_Bumpmap;
uniform sampler2D u_PrimaryDetailTexture;
uniform sampler2D u_SecondaryDetailTexture;
uniform sampler2D u_MicroDetailTexture;

varying vec2 v_LightIntensity;
`;
    public override vert = `
${MaterialProgram.BindingsDefinition}
${MaterialProgram.includes}
layout(location = ${MaterialProgram.a_Pos}) attribute vec3 a_Position;
layout(location = ${MaterialProgram.a_Norm}) attribute vec3 a_Normal;
layout(location = ${MaterialProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${MaterialProgram.a_LightmapTexCoord}) in vec2 a_LightmapTexCoord;

varying vec2 v_UV;
varying vec2 v_lightmapUV;

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ModelView, Mul(u_MaterialModel, vec4(a_Position, 1.0))));
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    vec3 normal = normalize(a_Normal);
    v_UV = a_TexCoord;
    v_lightmapUV = a_LightmapTexCoord;
    float t_LightIntensityF = dot(-normal, t_LightDirection);
    float t_LightIntensityB = dot( normal, t_LightDirection);
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);
}
`;

    private fragHeader = `
${MaterialProgram.BindingsDefinition}
${MaterialProgram.includes}
varying vec2 v_UV;
varying vec2 v_lightmapUV;
`;

    constructor(public shader: HaloMaterialShader | undefined, public has_lightmap: boolean) {
        super();
        this.generateFragmentShader();
    }

    private getDetailSection(fragBody: String[]): void {
        fragBody.push(`vec2 primaryUV = v_UV * ${this.shader!.primary_detail_bitmap_scale.toFixed(2)};`)
        fragBody.push(`vec4 primaryDetail = texture(SAMPLER_2D(u_PrimaryDetailTexture), primaryUV);`)
        fragBody.push(`vec2 secondaryUV = v_UV * ${this.shader!.secondary_detail_bitmap_scale.toFixed(2)};`)
        fragBody.push(`vec4 secondaryDetail = texture(SAMPLER_2D(u_SecondaryDetailTexture), secondaryUV);`)

        switch (this.shader!.shader_environment_type) {
            case _wasm!.ShaderEnvironmentType.Normal:
                fragBody.push(`vec3 detail = mix(secondaryDetail.rgb, primaryDetail.rgb, secondaryDetail.a);`)
                break;
            case _wasm!.ShaderEnvironmentType.Blended:
            case _wasm!.ShaderEnvironmentType.BlendedBaseSpecular:
                fragBody.push(`vec3 detail = mix(secondaryDetail.rgb, primaryDetail.rgb, color.a);`);
                break;
            default:
                throw new Error(`don't recognize ShaderEnvironmentType ${this.shader!.shader_environment_type}`);
        }
        
        switch (this.shader!.detail_bitmap_function) {
            case _wasm!.DetailBitmapFunction.DoubleBiasedMultiply:
                fragBody.push(`color.rgb = saturate(2.0 * color.rgb * detail);`);
                break;
            case _wasm!.DetailBitmapFunction.Multiply:
                fragBody.push(`color.rgb = saturate(color.rgb * detail);`);
                break;
            case _wasm!.DetailBitmapFunction.DoubleBiasedAdd:
                fragBody.push(`color.rgb = saturate(color.rgb + 2.0 * detail - 1.0);`);
                break;
            default:
                throw new Error(`don't recognize DetailBitmapFunction ${this.shader!.detail_bitmap_function}`)
        }

        fragBody.push(`vec2 microUV = v_UV * ${this.shader!.micro_detail_bitmap_scale.toFixed(2)};`)
        fragBody.push(`detail = texture(SAMPLER_2D(u_MicroDetailTexture), microUV).rgb;`)
        
        switch (this.shader!.detail_bitmap_function) {
            case _wasm!.DetailBitmapFunction.DoubleBiasedMultiply:
                fragBody.push(`color.rgb = saturate(2.0 * color.rgb  * detail);`)
                break;
            case _wasm!.DetailBitmapFunction.Multiply:
                fragBody.push(`color.rgb = saturate(color.rgb * detail);`)
                break;
            case _wasm!.DetailBitmapFunction.DoubleBiasedAdd:
                fragBody.push(`color.rgb = saturate(color.rgb + 2.0 * detail - 1.0);`)
                break;
            default:
                throw new Error(`don't recognize DetailBitmapFunction ${this.shader!.detail_bitmap_function}`)
        }
    }

    private generateFragmentShader(): void {
        let fragBody = [];
        if (this.shader) {
            fragBody.push(`vec4 color = texture(SAMPLER_2D(u_Texture), v_UV);`);
        } else {
            fragBody.push(`vec4 color = vec4(1.0, 0.0, 1.0, 1.0);`);
        }
        if (this.has_lightmap) {
            fragBody.push(`color.rgb *= texture(SAMPLER_2D(u_Lightmap), v_lightmapUV).rgb;`)
        }
        const enableDetail = true;
        if (enableDetail && this.shader && this.shader!.has_primary_detail_bitmap && this.shader!.has_secondary_detail_bitmap && this.shader!.has_micro_detail_bitmap) {
            this.getDetailSection(fragBody);
        }
        fragBody.push(`gl_FragDepth = gl_FragCoord.z + 1e-6 * u_BSPIndex;`);
        fragBody.push(`gl_FragColor = vec4(color.rgb, 1.0);`);
        this.frag = `
${this.fragHeader}
void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

class BSPRenderer {
    public trisBuf: GfxBuffer;
    public lightmaps: HaloLightmap[];
    public materialRenderers: MaterialRenderer[];

    constructor(public device: GfxDevice, public gfxSampler: GfxSampler, public bsp: HaloBSP, public inputLayout: GfxInputLayout, public modelMatrix: mat4, public mgr: HaloSceneManager, public bspIndex: number) {
        this.trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, mgr.get_bsp_indices(this.bsp).buffer);
        this.lightmaps = mgr.get_bsp_lightmaps(this.bsp);
        const lightmapsBitmap = this.bsp.get_lightmaps_bitmap();
        this.materialRenderers = this.lightmaps.flatMap(lightmap => {
            let lightmapTex: TextureMapping;
            if (lightmapsBitmap && lightmap.get_bitmap_index() !== 65535) {
                lightmapTex = makeTexture(this.device, this.gfxSampler, lightmapsBitmap!, this.mgr, lightmap.get_bitmap_index(), false);
            }
            return mgr.get_lightmap_materials(lightmap).map(material => {
                return new MaterialRenderer(this.device, this.gfxSampler, material, this.inputLayout, this.modelMatrix, this.mgr, this.bsp, this.trisBuf, lightmapTex!);
            });
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.materialRenderers.forEach(m => m.prepareToRender(renderInstManager, viewerInput));
    }

    public destroy(device: GfxDevice) {
        this.materialRenderers.forEach(m => m.destroy(device));
        device.destroyBuffer(this.trisBuf);
    }
}

interface MaterialProgramProperties {
    hasLightmap: boolean,
    hasTexture: boolean,
    hasBumpmap: boolean,
    hasPrimaryDetailMap: boolean,
    hasSecondaryDetailMap: boolean,
}

class MaterialRenderer {
    public vertsBuf: GfxBuffer;
    public lightmapVertsBuf: GfxBuffer;
    public inputState: GfxInputState;
    public textureMapping: TextureMapping | null;
    public bumpMapping: TextureMapping | null;
    public primaryDetailMapping: TextureMapping | null;
    public secondaryDetailMapping: TextureMapping | null;
    public microDetailMapping: TextureMapping | null;
    public program: GfxProgram,
    public shader: HaloMaterialShader | undefined;

    constructor(device: GfxDevice, public gfxSampler: GfxSampler, public material: HaloMaterial, public inputLayout: GfxInputLayout, public modelMatrix: mat4, public mgr: HaloSceneManager, public bsp: HaloBSP, public trisBuf: GfxBuffer, public lightmapMapping: TextureMapping | null) {
        this.vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_material_vertex_data(this.material, this.bsp).buffer);
        this.lightmapVertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_material_lightmap_data(this.material, this.bsp).buffer);
        this.shader = mgr.get_material_shader(this.material);
        if (this.shader) {
            this.textureMapping = makeTexture(device, this.gfxSampler, this.shader.get_base_bitmap(), this.mgr);
            /*
            const bumpmap = this.shader.get_bump_map();
            if (bumpmap) {
                this.bumpMapping = new TextureMapping();
                this.bumpMapping.gfxTexture = makeTexture(device, bumpmap, this.mgr);
            }
            */
            const primaryDetailBitmap = this.shader.get_primary_detail_bitmap();
            if (primaryDetailBitmap) {
                this.primaryDetailMapping = makeTexture(device, this.gfxSampler, primaryDetailBitmap, this.mgr);
            }
            const secondaryDetailBitmap = this.shader.get_secondary_detail_bitmap();
            if (secondaryDetailBitmap) {
                this.secondaryDetailMapping = makeTexture(device, this.gfxSampler, secondaryDetailBitmap, this.mgr);
            }
            const microDetailBitmap = this.shader.get_micro_detail_bitmap();
            if (microDetailBitmap) {
                this.microDetailMapping = makeTexture(device, this.gfxSampler, microDetailBitmap, this.mgr);
            }
        }
        const renderHelper = new GfxRenderHelper(device);
        this.program = renderHelper.renderCache.createProgram(new MaterialProgram(this.shader, !!this.lightmapMapping));

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertsBuf, byteOffset: 0 },
            { buffer: this.lightmapVertsBuf, byteOffset: 0 },
        ], { buffer: this.trisBuf, byteOffset: 0 })
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.program);
        renderInst.setSamplerBindingsFromTextureMappings([
            this.textureMapping,
            this.lightmapMapping,
            this.bumpMapping,
            this.primaryDetailMapping,
            this.secondaryDetailMapping,
            this.microDetailMapping,
        ])
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.material.get_num_indices(), this.material.get_index_offset());
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertsBuf);
        device.destroyInputState(this.inputState);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 6 },
];

function getBitmapTextureFormat(format: BitmapFormat): GfxFormat {
    switch (format) {
        case _wasm!.BitmapFormat.Dxt1: return GfxFormat.BC1;
        case _wasm!.BitmapFormat.Dxt3: return GfxFormat.BC2;
        case _wasm!.BitmapFormat.Dxt5: return GfxFormat.BC3;
        case _wasm!.BitmapFormat.X8r8g8b8: return GfxFormat.U8_RGBA_NORM;
        case _wasm!.BitmapFormat.A8r8g8b8: return GfxFormat.U8_RGBA_NORM;
        case _wasm!.BitmapFormat.R5g6b5: return GfxFormat.U16_RGB_565;
        default:
            throw new Error(`couldn't recognize bitmap format ${format}`);
    }
}

function getBitmapByteLength(metadata: HaloBitmapMetadata, mipLevel = 0): number {
    const numPixels = metadata.width * metadata.height / (2 ** (2 * mipLevel));
    const format = getBitmapTextureFormat(metadata.format);
    switch (format) {
        case GfxFormat.BC1: return numPixels/2;
        case GfxFormat.BC2: return numPixels;
        case GfxFormat.BC3: return numPixels;
        case GfxFormat.U8_RGBA_NORM: return numPixels * 4;
        case GfxFormat.U16_RGB_565: return numPixels * 2;
        default:
            throw new Error(`couldn't recognize gfx format ${format}`);
    }
}

function makeTexture(device: GfxDevice, gfxSampler: GfxSampler, bitmap: HaloBitmap, mgr: HaloSceneManager, submap = 0, mipmapped = true): TextureMapping {
    const bitmapMetadata = bitmap.get_metadata_for_index(submap);
    const format = getBitmapTextureFormat(bitmapMetadata.format);
    const mipmapCount = Math.min(Math.max(bitmapMetadata.mipmap_count, 1), 6);
    const texture = device.createTexture(makeTextureDescriptor2D(format, bitmapMetadata.width, bitmapMetadata.height, mipmapCount));
    const mips = [];
    let offset = 0;
    const bitmapData = mgr.get_bitmap_data(bitmap, submap);
    for (let i=0; i<mipmapCount; i++) {
        let length = getBitmapByteLength(bitmapMetadata, i);
        if (format === GfxFormat.U16_RGB_565) {
            const u16buf = new Uint16Array(bitmapData.buffer);
            mips.push(u16buf.subarray(offset, offset + length/2));
            offset += length/2;
        } else {
            mips.push(bitmapData.subarray(offset, offset + length));
            offset += length;
        }
    }
    device.uploadTextureData(texture, 0, mips);
    const mapping = new TextureMapping();
    mapping.gfxSampler = gfxSampler;
    mapping.gfxTexture = texture;
    return mapping
}

class HaloScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public inputLayout: GfxInputLayout;
    public modelMatrix: mat4;
    public gfxSampler: GfxSampler;
    public bspRenderers: BSPRenderer[];

    constructor(public device: GfxDevice, public mgr: HaloSceneManager) {
        this.bspRenderers = [];
        this.renderHelper = new GfxRenderHelper(device);
        const cache = new GfxRenderCache(this.device);
        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.modelMatrix = mat4.create();
        const scaling = 200;
        mat4.rotate(this.modelMatrix, this.modelMatrix, -Math.PI / 2, vec3.fromValues(1, 0, 0));
        mat4.scale(this.modelMatrix, this.modelMatrix, vec3.fromValues(scaling, scaling, scaling));
        mat4.translate(this.modelMatrix, this.modelMatrix, vec3.fromValues(-50, 150, -20));

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        const vec3fSize = 3 * 4;
        const vec2fSize = 2 * 4;
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_Pos, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_Norm, bufferIndex: 0, bufferByteOffset: 1 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 4 * vec3fSize, format: GfxFormat.F32_RG});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_LightmapTexCoord, bufferIndex: 1, bufferByteOffset: 1 * vec3fSize, format: GfxFormat.F32_RG});
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4 * vec3fSize + vec2fSize, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: vec3fSize + vec2fSize, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        let indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    }

    addBSP(bsp: HaloBSP, bspIndex: number) {
        this.bspRenderers.push(new BSPRenderer(this.device, this.gfxSampler, bsp, this.inputLayout, this.modelMatrix, this.mgr, bspIndex));
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        {
            let offs = template.allocateUniformBuffer(MaterialProgram.ub_SceneParams, 32);
            const mapped = template.mapUniformBufferF32(MaterialProgram.ub_SceneParams);
            offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
            offs += fillMatrix4x4(mapped, offs, viewerInput.camera.viewMatrix);
        }
        {
            let offs = template.allocateUniformBuffer(MaterialProgram.ub_ShapeParams, 16);
            const mapped = template.mapUniformBufferF32(MaterialProgram.ub_ShapeParams);
            offs += fillMatrix4x4(mapped, offs, this.modelMatrix);
        }

        this.bspRenderers.forEach((r, i) => {
            let offs = template.allocateUniformBuffer(MaterialProgram.ub_BSPParams, 16);
            const mapped = template.mapUniformBufferF32(MaterialProgram.ub_BSPParams);
            offs += fillVec4(mapped, offs, i, i, i, i);
            r.prepareToRender(this.renderHelper.renderInstManager, viewerInput)
        })

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        device.destroyInputLayout(this.inputLayout);
        this.bspRenderers.forEach(r => r.destroy(device));
        this.renderHelper.destroy();
    }
}

class HaloSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const wasm = await loadWasm();
        wasm.init_panic_hook();
        const dataFetcher = context.dataFetcher;
        const resourceMapData = await dataFetcher.fetchData("halo/bitmaps.map");
        const mapData = await dataFetcher.fetchData(`halo/${this.id}.map`);
        const mapManager = wasm.HaloSceneManager.new(mapData.createTypedArray(Uint8Array), resourceMapData.createTypedArray(Uint8Array));
        const renderer = new HaloScene(device, mapManager);
        mapManager.get_bsps().forEach((bsp, i) => renderer.addBSP(bsp, i));
        return renderer;
    }

}

const id = 'Halo';
const name = 'Halo';

const sceneDescs = [
    new HaloSceneDesc("bloodgulch", "Blood Gulch"),
    new HaloSceneDesc("beavercreek", "beavercreek"),
    new HaloSceneDesc("boardingaction", "boardingaction"),
    new HaloSceneDesc("carousel", "carousel"),
    new HaloSceneDesc("chillout", "chillout"),
    new HaloSceneDesc("damnation", "damnation"),
    new HaloSceneDesc("dangercanyon", "dangercanyon"),
    new HaloSceneDesc("deathisland", "deathisland"),
    new HaloSceneDesc("gephyrophobia", "gephyrophobia"),
    new HaloSceneDesc("hangemhigh", "hangemhigh"),
    new HaloSceneDesc("icefields", "icefields"),
    new HaloSceneDesc("infinity", "infinity"),
    new HaloSceneDesc("longest", "longest"),
    new HaloSceneDesc("prisoner", "prisoner"),
    new HaloSceneDesc("putput", "putput"),
    new HaloSceneDesc("ratrace", "ratrace"),
    new HaloSceneDesc("sidewinder", "sidewinder"),
    new HaloSceneDesc("timberland", "timberland"),
    new HaloSceneDesc("wizard", "wizard"),
    new HaloSceneDesc("a10", "a10"),
    new HaloSceneDesc("a30", "a30"),
    new HaloSceneDesc("a50", "a50"),
    new HaloSceneDesc("b30", "b30"),
    new HaloSceneDesc("b40", "b40"),
    new HaloSceneDesc("c10", "c10"),
    new HaloSceneDesc("c20", "c20"),
    new HaloSceneDesc("c40", "c40"),
    new HaloSceneDesc("d20", "d20"),
    new HaloSceneDesc("d40", "d40"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: false };