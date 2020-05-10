
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import { GfxDevice, GfxRenderPass, GfxCullMode, GfxHostAccessPass, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxVertexBufferFrequency, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxInputState, GfxTexture } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput, SceneGfx } from "../viewer";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from "../gfx/helpers/RenderTargetHelpers";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { DeviceProgram } from "../Program";
import { BSPFile, Surface } from "./BSPFile";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3 } from "gl-matrix";
import { VPKMount, createVPKMount } from "./VPK";
import { ZipFile } from "../ZipFile";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { BaseMaterial, MaterialCache } from "./Materials";
import { clamp, computeMatrixWithoutTranslation, transformVec3Mat4w0 } from "../MathHelpers";
import { assert } from "../util";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";

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
};

layout(row_major, std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelView;
};

varying vec4 v_TexCoord;
uniform sampler2D u_Texture[2];

#ifdef VERT
layout(location = ${HalfLife2Program.a_Position}) attribute vec3 a_Position;
layout(location = ${HalfLife2Program.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    gl_Position = Mul(u_Projection, vec4(Mul(u_ModelView, vec4(a_Position, 1.0)), 1.0));
    v_TexCoord = a_TexCoord;
}
#endif

#ifdef FRAG
void mainPS() {
    gl_FragColor.rgb = texture(SAMPLER_2D(u_Texture[0], v_TexCoord.xy)).rgb;
}
#endif
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2 },
];

export class SourceFileSystem {
    public pakfiles: ZipFile[] = [];
    public mounts: VPKMount[] = [];

    public resolvePath(path: string): string {
        path = path.toLowerCase().replace('\\', '/');
        return path;
    }

    public async fetchFileData(path: string): Promise<ArrayBufferSlice | null> {
        for (let i = 0; i < this.mounts.length; i++) {
            const entry = this.mounts[i].findEntry(path);
            if (entry !== null)
                return this.mounts[i].fetchFileData(entry);
        }

        for (let i = 0; i < this.pakfiles.length; i++) {
            const pakfile = this.pakfiles[i];
            const entry = pakfile.find((entry) => entry.filename === path);
            if (entry !== undefined)
                return entry.data;
        }

        return null;
    }
}

const scratchMatrix = mat4.create();
class SkyboxRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private materialInstances: BaseMaterial[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, private skyname: string) {
        const vertexData = new Float32Array(6 * 4 * 5);
        const indexData = new Uint16Array(6 * 6);

        let dstVert = 0;
        let dstIdx = 0;

        function buildPlaneVert(pb: number, s: number, t: number): void {
            const side = 50000;
            const g = [-s*side, s*side, -t*side, t*side, -side, side];
            vertexData[dstVert++] = g[(pb >>> 8) & 0x0F];
            vertexData[dstVert++] = g[(pb >>> 4) & 0x0F];
            vertexData[dstVert++] = g[(pb >>> 0) & 0x0F];

            function seamClamp(v: number): number {
                return clamp(v, 1.0/512.0, 511.0/512.0);
            }

            vertexData[dstVert++] = seamClamp(s * 0.5 + 0.5);
            vertexData[dstVert++] = seamClamp(1.0 - (t * 0.5 + 0.5));
        }

        function buildPlaneData(pb: number): void {
            const base = dstVert/5;
            buildPlaneVert(pb, -1, -1);
            buildPlaneVert(pb, -1, 1);
            buildPlaneVert(pb, 1, 1);
            buildPlaneVert(pb, 1, -1);
            indexData[dstIdx++] = base+0;
            indexData[dstIdx++] = base+1;
            indexData[dstIdx++] = base+2;
            indexData[dstIdx++] = base+0;
            indexData[dstIdx++] = base+2;
            indexData[dstIdx++] = base+3;
        }

        // right, left, back, front, top, bottom
        buildPlaneData(0x503);
        buildPlaneData(0x413);
        buildPlaneData(0x153);
        buildPlaneData(0x043);
        buildPlaneData(0x205);
        buildPlaneData(0x304);

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: HalfLife2Program.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: HalfLife2Program.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // Wait until we're ready.
        if (this.materialInstances.length === 0)
            return;

        for (let i = 0; i < this.materialInstances.length; i++)
            if (!this.materialInstances[i].isMaterialLoaded())
                return;

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.viewMatrix);
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        for (let i = 0; i < 6; i++) {
            const renderInst = renderInstManager.newRenderInst();
            this.materialInstances[i].setOnRenderInst(renderInst, scratchMatrix);
            renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
            renderInst.drawIndexes(6, i*6);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public async bindMaterial(materialCache: MaterialCache) {
        this.materialInstances = await Promise.all([
            materialCache.createMaterialInstance(`skybox/${this.skyname}rt`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}lf`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}bk`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}ft`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}up`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}dn`),
        ]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

class BSPSurface {
    public materialInstance: BaseMaterial | null = null;

    constructor(public surface: Surface) {
    }

    public bindMaterial(materialInstance: BaseMaterial): void {
        this.materialInstance = materialInstance;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        if (this.materialInstance === null || !this.materialInstance.visible || !this.materialInstance.isMaterialLoaded())
            return;

        const renderInst = renderInstManager.newRenderInst();
        this.materialInstance.setOnRenderInst(renderInst, viewerInput.camera.viewMatrix);
        renderInst.drawIndexes(this.surface.indexCount, this.surface.startIndex);
        const depth = this.materialInstance.computeViewSpaceDepth(this.surface.center, viewerInput.camera.viewMatrix);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        renderInstManager.submitRenderInst(renderInst);
    }
}

class BSPRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
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

    private async bindMaterial(materialCache: MaterialCache, surface: BSPSurface) {
        const texinfo = this.bsp.texinfo[surface.surface.texinfo];
        const materialInstance = await materialCache.createMaterialInstance(texinfo.texName);
        surface.bindMaterial(materialInstance);
    }

    public bindMaterials(materialCache: MaterialCache) {
        for (let i = 0; i < this.surfaces.length; i++) {
            const surface = this.surfaces[i];
            this.bindMaterial(materialCache, surface);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].prepareToRender(renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class SourceRenderer implements SceneGfx {
    private program: GfxProgram;
    private renderTarget = new BasicRenderTarget();
    public materialCache: MaterialCache | null = null;
    public renderHelper: GfxRenderHelper;
    public skyboxRenderer: SkyboxRenderer | null = null;
    public bspRenderers: BSPRenderer[] = [];

    constructor(context: SceneContext) {
        const device = context.device;
        this.program = device.createProgram(new HalfLife2Program());
        this.renderHelper = new GfxRenderHelper(device);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.program);
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });

        let offs = template.allocateUniformBuffer(HalfLife2Program.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(offs);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);

        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(renderInstManager, viewerInput);

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].prepareToRender(renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
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
        if (this.materialCache !== null)
            this.materialCache.destroy(device);

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
    }
}

class HalfLife2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = new SourceFileSystem();

        filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/hl2_textures`));
        filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/hl2_misc`));

        const renderer = new SourceRenderer(context);
        const cache = renderer.renderHelper.getCache();

        renderer.materialCache = new MaterialCache(device, cache, filesystem);

        const bsp = await context.dataFetcher.fetchData(`${pathBase}/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bsp);
        if (bspFile.pakfile !== null)
            filesystem.pakfiles.push(bspFile.pakfile);

        // Build skybox from worldname.
        const worldspawn = bspFile.entities[0];
        assert(worldspawn.classname === 'worldspawn');
        if (worldspawn.skyname) {
            renderer.skyboxRenderer = new SkyboxRenderer(device, cache, worldspawn.skyname);
            renderer.skyboxRenderer.bindMaterial(renderer.materialCache);
        }

        const bspRenderer = new BSPRenderer(device, cache, bspFile);
        bspRenderer.bindMaterials(renderer.materialCache);
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
    new HalfLife2SceneDesc('d1_trainstation_06'),

    new HalfLife2SceneDesc('d1_canals_01'),
    new HalfLife2SceneDesc('d1_canals_01a'),
    new HalfLife2SceneDesc('d1_canals_02'),
    new HalfLife2SceneDesc('d1_canals_03'),
    new HalfLife2SceneDesc('d1_canals_05'),
    new HalfLife2SceneDesc('d1_canals_06'),
    new HalfLife2SceneDesc('d1_canals_07'),
    new HalfLife2SceneDesc('d1_canals_08'),
    new HalfLife2SceneDesc('d1_canals_09'),
    new HalfLife2SceneDesc('d1_canals_10'),
    new HalfLife2SceneDesc('d1_canals_11'),
    new HalfLife2SceneDesc('d1_canals_12'),
    new HalfLife2SceneDesc('d1_canals_13'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
