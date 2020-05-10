
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import { GfxDevice, GfxRenderPass, GfxCullMode, GfxHostAccessPass, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxVertexBufferFrequency, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxInputState, GfxTexture } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput, SceneGfx } from "../viewer";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from "../gfx/helpers/RenderTargetHelpers";
import { fillMatrix4x4, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { DeviceProgram } from "../Program";
import { BSPFile, Surface } from "./BSPFile";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { colorNewFromRGBA } from "../Color";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4 } from "gl-matrix";
import { VPKMount, createVPKMount } from "./VPK";
import { TextureMapping } from "../TextureHolder";
import { nArray } from "../util";
import { VTF } from "./VTF";

const pathBase = `HalfLife2`;

class HalfLife2Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ModelView;
};

layout(row_major, std140) uniform ub_ObjectParams {
    vec4 u_Color;
};

varying vec3 v_Normal;
varying vec4 v_TexCoord;
varying vec2 v_LightIntensity;
uniform sampler2D u_Texture[2];

#ifdef VERT
layout(location = ${HalfLife2Program.a_Position}) attribute vec3 a_Position;
layout(location = ${HalfLife2Program.a_Normal}) attribute vec3 a_Normal;
layout(location = ${HalfLife2Program.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ModelView, vec4(a_Position, 1.0)));
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    float t_LightIntensityF = dot(-a_Normal, t_LightDirection);
    float t_LightIntensityB = dot( a_Normal, t_LightDirection);
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);
    v_Normal = a_Normal;
    v_TexCoord = a_TexCoord;
}
#endif

#ifdef FRAG
void mainPS() {
    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.3 * t_LightIntensity;
    gl_FragColor = u_Color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0);

    // gl_FragColor.rgb = v_Normal.xyz * vec3(0.5) + vec3(0.5);
    gl_FragColor.rgb = texture(SAMPLER_2D(u_Texture[0], v_TexCoord.xy)).rgb;
}
#endif
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2 },
];

class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private promiseCache = new Map<string, Promise<VTF>>();

    constructor(private device: GfxDevice, private mount: VPKMount) {
    }

    private async fetchTextureInternal(path: string): Promise<VTF> {
        const data = await this.mount.fetchFileData(path);
        return new VTF(this.device, data);
    }

    public fillTextureMapping(m: TextureMapping, path: string): void {
        if (this.textureCache.has(path)) {
            this.textureCache.get(path)!.fillTextureMapping(m);
            return;
        }

        if (!this.promiseCache.has(path))
            this.promiseCache.set(path, this.fetchTextureInternal(path));

        this.promiseCache.get(path)!.then((vtf) => { vtf.fillTextureMapping(m); });
    }

    public destroy(device: GfxDevice): void {
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}

class BSPSurface {
    public textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    constructor(public surface: Surface) {
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager) {
        if (this.textureMapping[0].gfxTexture === null)
            return;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.drawIndexes(this.surface.indexCount, this.surface.startIndex);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInstManager.submitRenderInst(renderInst);
    }
}

class BSPRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private color = colorNewFromRGBA(0.8, 0.6, 0.7);
    private surfaces: BSPSurface[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, private bsp: BSPFile) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.bsp.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.bsp.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: HalfLife2Program.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: HalfLife2Program.a_Normal,   bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGB, },
            { location: HalfLife2Program.a_TexCoord, bufferIndex: 0, bufferByteOffset: 6*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+3+4)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        for (let i = 0; i < this.bsp.surfaces.length; i++)
            this.surfaces.push(new BSPSurface(this.bsp.surfaces[i]));
    }

    public bindMaterials(textureCache: MaterialCache): void {
        for (let i = 0; i < this.surfaces.length; i++) {
            const surface = this.surfaces[i];
            const texinfo = this.bsp.texinfo[surface.surface.texinfo];
            // TODO(jstpierre): Do this until materials are implemented.
            const textureFilename = `materials/${texinfo.texName}.vtf`;
            textureCache.fillTextureMapping(surface.textureMapping[0], textureFilename);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        const templateRenderInst = renderInstManager.pushTemplateRenderInst();

        let offs = templateRenderInst.allocateUniformBuffer(HalfLife2Program.ub_ObjectParams, 4);
        const d = templateRenderInst.mapUniformBufferF32(HalfLife2Program.ub_ObjectParams);
        offs += fillColor(d, offs, this.color);

        templateRenderInst.setInputLayoutAndState(this.inputLayout, this.inputState);

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].prepareToRender(renderInstManager);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

const zup = mat4.fromValues(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

const scratchMatrix = mat4.create();
export class SourceRenderer implements SceneGfx {
    private program: GfxProgram;
    private renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public bspRenderers: BSPRenderer[] = [];

    constructor(context: SceneContext, public materialCache: MaterialCache) {
        const device = context.device;
        this.program = device.createProgram(new HalfLife2Program());
        this.renderHelper = new GfxRenderHelper(device);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.program);
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });

        let offs = template.allocateUniformBuffer(HalfLife2Program.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(offs);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, zup);
        offs += fillMatrix4x4(mapped, offs, scratchMatrix);

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].prepareToRender(this.renderHelper.renderInstManager);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        this.renderHelper.renderInstManager.drawOnPassRenderer(device, passRenderer);
        this.renderHelper.renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
        this.materialCache.destroy(device);

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
    }
}

class HalfLife2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const textureMount = await createVPKMount(context.dataFetcher, `${pathBase}/hl2_textures`);
        const textureCache = new MaterialCache(device, textureMount);

        const renderer = new SourceRenderer(context, textureCache);
        const cache = renderer.renderHelper.getCache();

        const bsp = await context.dataFetcher.fetchData(`${pathBase}/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(device, bsp);
        const bspRenderer = new BSPRenderer(device, cache, bspFile);
        bspRenderer.bindMaterials(textureCache);
        renderer.bspRenderers.push(bspRenderer);

        return renderer;
    }
}

const id = 'HalfLife2';
const name = 'Half-Life 2';
const sceneDescs = [
    new HalfLife2SceneDesc('background01'),
    new HalfLife2SceneDesc('background02'),
    new HalfLife2SceneDesc('background03'),
    new HalfLife2SceneDesc('background04'),
    new HalfLife2SceneDesc('background05'),
    new HalfLife2SceneDesc('d1_trainstation_01'),
    new HalfLife2SceneDesc('d1_trainstation_02'),
    new HalfLife2SceneDesc('d1_trainstation_03'),
    new HalfLife2SceneDesc('d1_trainstation_04'),
    new HalfLife2SceneDesc('d1_trainstation_05'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
