import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxDevice, makeTextureDescriptor2D, GfxBuffer, GfxInputState, GfxProgram, GfxBindingLayoutDescriptor, GfxTexture, GfxCullMode, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage } from '../gfx/platform/GfxPlatform';
import { FormatCompFlags, FormatTypeFlags, GfxFormat, makeFormat, setFormatCompFlags } from "../gfx/platform/GfxPlatformFormat";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { BitmapFormat, HaloSceneManager, HaloBSP, HaloLightmap, HaloMaterial, HaloMaterialShader, HaloBitmap, HaloBitmapMetadata } from '../../rust/pkg/index';
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
    public static a_Pos = 0;
    public static a_Norm = 1;
    public static a_TexCoord = 2;
    public static a_LightmapTexCoord = 3;

    public override both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ModelView;
};

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_MaterialModel;
};

uniform sampler2D u_Texture;
uniform sampler2D u_Lightmap;

varying vec2 v_LightIntensity;

#ifdef VERT
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
#endif

#ifdef FRAG
varying vec2 v_UV;
varying vec2 v_lightmapUV;
void mainPS() {
    /*
    vec4 color = vec4(.4, .4, .4, 1.0);
    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.5 * t_LightIntensity;
    gl_FragColor = sqrt(color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0));
    */
   vec4 color = texture(SAMPLER_2D(u_Texture), v_UV);
   vec4 lightmapColor = texture(SAMPLER_2D(u_Lightmap), v_lightmapUV);
   gl_FragColor = vec4(color.rgb * lightmapColor.rgb, 1.0);
}
#endif
`;
}

class BSPRenderer {
    public trisBuf: GfxBuffer;
    public lightmaps: HaloLightmap[];
    public materialRenderers: MaterialRenderer[];

    constructor(public device: GfxDevice, public bsp: HaloBSP, public inputLayout: GfxInputLayout, public modelMatrix: mat4, public mgr: HaloSceneManager) {
        this.trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, mgr.get_bsp_indices(this.bsp).buffer);
        this.lightmaps = mgr.get_bsp_lightmaps(this.bsp);
        const lightmapsBitmap = this.bsp.get_lightmaps_bitmap();
        this.materialRenderers = this.lightmaps.flatMap(lightmap => {
            let lightmapTex: GfxTexture;
            if (lightmap.get_bitmap_index() === 65535) {
                lightmapTex = makeMissingTexture(this.device);
            } else {
                lightmapTex = makeTexture(this.device, lightmapsBitmap, this.mgr, lightmap.get_bitmap_index());
            }
            return mgr.get_lightmap_materials(lightmap).map(material => {
                return new MaterialRenderer(this.device, material, this.inputLayout, this.modelMatrix, this.mgr, this.bsp, this.trisBuf, lightmapTex!);
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

class MaterialRenderer {
    public vertsBuf: GfxBuffer;
    public lightmapVertsBuf: GfxBuffer;
    public inputState: GfxInputState;
    public textureMapping: TextureMapping;
    public lightmapMapping: TextureMapping;
    public shader: HaloMaterialShader | undefined;

    constructor(device: GfxDevice, public material: HaloMaterial, public inputLayout: GfxInputLayout, public modelMatrix: mat4, public mgr: HaloSceneManager, public bsp: HaloBSP, public trisBuf: GfxBuffer, lightmapTex: GfxTexture) {
        this.vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_material_vertex_data(this.material, this.bsp).buffer);
        this.lightmapVertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_material_lightmap_data(this.material, this.bsp).buffer);
        this.shader = mgr.get_material_shader(this.material);

        this.textureMapping = new TextureMapping();
        if (this.shader) {
            this.textureMapping.gfxTexture = makeTexture(device, this.shader.get_base_bitmap(), this.mgr);
        } else {
            this.textureMapping.gfxTexture = makeMissingTexture(device);
        }
        this.lightmapMapping = new TextureMapping();
        this.lightmapMapping.gfxTexture = lightmapTex;

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertsBuf, byteOffset: 0 },
            { buffer: this.lightmapVertsBuf, byteOffset: 0 },
        ], { buffer: this.trisBuf, byteOffset: 0 })
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setSamplerBindingsFromTextureMappings([this.textureMapping, this.lightmapMapping])
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
    { numUniformBuffers: 2, numSamplers: 2 }, // ub_SceneParams
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

function getBitmapByteLength(metadata: HaloBitmapMetadata): number {
    const numPixels = metadata.width * metadata.height;
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

function makeTexture(device: GfxDevice, bitmap: HaloBitmap, mgr: HaloSceneManager, level = 0): GfxTexture {
    let bitmapData = mgr.get_bitmap_data(bitmap, level);
    const bitmapMetadata = bitmap.get_metadata_for_index(level);
    const format = getBitmapTextureFormat(bitmapMetadata.format);
    const texture = device.createTexture(makeTextureDescriptor2D(format, bitmapMetadata.width, bitmapMetadata.height, 1));
    const length = getBitmapByteLength(bitmapMetadata);
    if (format === GfxFormat.U16_RGB_565) {
        const u16buf = new Uint16Array(bitmapData.buffer);
        device.uploadTextureData(texture, 0, [u16buf.slice(0, length/2)]);
    } else {
        device.uploadTextureData(texture, 0, [bitmapData.slice(0, length)]);
    }
    return texture;
}

function makeMissingTexture(device: GfxDevice): GfxTexture {
    const bitmapData = new Float32Array(new Array(3 * 4));
    bitmapData.fill(0.4);
    const format = GfxFormat.F32_RGB;
    const texture = device.createTexture(makeTextureDescriptor2D(format, 2, 2, 1));
    device.uploadTextureData(texture, 0, [bitmapData]);
    return texture;
}

class HaloScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public program: GfxProgram;
    public inputLayout: GfxInputLayout;
    public modelMatrix: mat4;
    public bspRenderers: BSPRenderer[];

    constructor(public device: GfxDevice, public mgr: HaloSceneManager) {
        this.bspRenderers = [];
        this.renderHelper = new GfxRenderHelper(device);
        this.program = this.renderHelper.renderCache.createProgram(new MaterialProgram());
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

    addBSP(bsp: HaloBSP) {
        this.bspRenderers.push(new BSPRenderer(this.device, bsp, this.inputLayout, this.modelMatrix, this.mgr));
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.program);

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

        this.bspRenderers.forEach(r => r.prepareToRender(this.renderHelper.renderInstManager, viewerInput))

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
        mapManager.get_bsps().forEach(bsp => renderer.addBSP(bsp));
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