import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxDevice, makeTextureDescriptor2D, GfxBuffer, GfxInputState, GfxProgram, GfxBindingLayoutDescriptor, GfxTexture, GfxCullMode, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage } from '../gfx/platform/GfxPlatform';
import { GfxFormat, setFormatCompFlags } from "../gfx/platform/GfxPlatformFormat";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { UnityAssetManager, MeshMetadata, UnityMesh, UnityChannel } from '../Common/Unity/AssetManager';
import { AABB } from '../Geometry';
import { Material, BitmapMetadata, BitmapFormat } from '../../rust/pkg/index';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { EmptyScene } from '../Scenes_Test';
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
type Wasm = typeof _wasm!;

async function loadWasm() {
    if (_wasm === null) {
        _wasm = await import('../../rust/pkg/index');
    }
    return _wasm;
}

class MaterialProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

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

varying vec2 v_LightIntensity;

#ifdef VERT
layout(location = 0) attribute vec3 a_Position;
layout(location = 1) attribute vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;

varying vec2 v_uv;

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ModelView, Mul(u_MaterialModel, vec4(a_Position, 1.0))));
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    vec3 normal = normalize(a_Normal);
    v_uv = a_TexCoord;
    float t_LightIntensityF = dot(-normal, t_LightDirection);
    float t_LightIntensityB = dot( normal, t_LightDirection);
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);
}
#endif

#ifdef FRAG
varying vec2 v_uv;
void mainPS() {
    /*
    vec4 color = vec4(.4, .4, .4, 1.0);
    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.5 * t_LightIntensity;
    gl_FragColor = sqrt(color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0));
    */
   vec4 color = texture(SAMPLER_2D(u_Texture), v_uv);
   gl_FragColor = vec4(color.rgb, 1.0);
}
#endif
`;
}

class MaterialRenderer {
    public normsBuf: GfxBuffer;
    public vertsBuf: GfxBuffer;
    public trisBuf: GfxBuffer;
    public uvBuf: GfxBuffer;
    public inputState: GfxInputState;
    public textureMapping: TextureMapping;

    constructor(device: GfxDevice, public material: Material, public inputLayout: GfxInputLayout, public modelMatrix: mat4, public tex: GfxTexture) {
        this.vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, material.get_vertices().buffer);
        this.normsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, material.get_normals().buffer);
        this.uvBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, material.get_uvs().buffer);
        this.trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, material.get_indices().buffer);
        this.textureMapping = new TextureMapping();
        this.textureMapping.gfxTexture = this.tex;

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertsBuf, byteOffset: 0 },
            { buffer: this.normsBuf, byteOffset: 0 },
            { buffer: this.uvBuf, byteOffset: 0 },
        ], { buffer: this.trisBuf, byteOffset: 0 })
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setSamplerBindingsFromTextureMappings([this.textureMapping])
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.material.num_indices * 3);
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.trisBuf);
        device.destroyBuffer(this.vertsBuf);
        device.destroyBuffer(this.normsBuf);
        device.destroyInputState(this.inputState);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 }, // ub_SceneParams
];

function getBitmapTextureFormat(format: BitmapFormat): GfxFormat {
    switch (format) {
        case _wasm!.BitmapFormat.Dxt1: return GfxFormat.BC1;
        case _wasm!.BitmapFormat.Dxt3: return GfxFormat.BC2;
        case _wasm!.BitmapFormat.Dxt5: return GfxFormat.BC3;
        default:
            throw new Error(`couldn't recognize bitmap format ${format}`);
    }
}

function makeTexture(device: GfxDevice, material: Material): GfxTexture {
    const bitmapData = material.get_bitmap_data();
    const bitmapMetadata = material.bitmap_metadata!;
    const format = getBitmapTextureFormat(bitmapMetadata.format);
    const texture = device.createTexture(makeTextureDescriptor2D(format, bitmapMetadata.width, bitmapMetadata.height, 1));
    const numPixels = bitmapMetadata.width * bitmapMetadata.height;
    const length = format === GfxFormat.BC1 ? numPixels/2 : numPixels;
    device.uploadTextureData(texture, 0, [bitmapData.slice(0, length)]);
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
    private materialRenderers: MaterialRenderer[];
    private renderHelper: GfxRenderHelper;
    public program: GfxProgram;
    public inputLayout: GfxInputLayout;
    public modelMatrix: mat4;

    constructor(public device: GfxDevice) {
        this.materialRenderers = [];
        this.renderHelper = new GfxRenderHelper(device);
        this.program = this.renderHelper.renderCache.createProgram(new MaterialProgram());
        this.modelMatrix = mat4.create();
        const scaling = 200;
        mat4.rotate(this.modelMatrix, this.modelMatrix, -Math.PI / 2, vec3.fromValues(1, 0, 0));
        mat4.scale(this.modelMatrix, this.modelMatrix, vec3.fromValues(scaling, scaling, scaling));
        mat4.translate(this.modelMatrix, this.modelMatrix, vec3.fromValues(-50, 150, -20));

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        vertexAttributeDescriptors.push({ location: 0, bufferIndex: 0, bufferByteOffset: 0, format: setFormatCompFlags(GfxFormat.F32_RGB, 3)});
        vertexAttributeDescriptors.push({ location: 1, bufferIndex: 1, bufferByteOffset: 0, format: setFormatCompFlags(GfxFormat.F32_RGB, 3)});
        vertexAttributeDescriptors.push({ location: 2, bufferIndex: 2, bufferByteOffset: 0, format: setFormatCompFlags(GfxFormat.F32_RG, 2)});
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 3 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 2 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        let indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    }

    addMaterial(material: Material) {
        let tex;
        if (material.has_bitmap()) {
            tex = makeTexture(this.device, material);
        } else {
            tex = makeMissingTexture(this.device);
        }
        this.materialRenderers.push(new MaterialRenderer(this.device, material, this.inputLayout, this.modelMatrix, tex));
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

        for (let i = 0; i < this.materialRenderers.length; i++)
            this.materialRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput);

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
        this.materialRenderers.forEach((r) => r.destroy(device));
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
        const mapManager = wasm.HaloSceneManager.new(mapData.createTypedArray(Uint8Array), resourceMapData.createTypedArray(Uint8Array);
        const renderer = new HaloScene(device);
        mapManager.get_materials()
            .forEach(material => renderer.addMaterial(material));
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