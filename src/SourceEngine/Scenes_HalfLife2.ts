
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import { GfxDevice, GfxRenderPass, GfxCullMode, GfxHostAccessPass, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxVertexBufferFrequency, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxInputState, GfxTexture } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput, SceneGfx } from "../viewer";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from "../gfx/helpers/RenderTargetHelpers";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { BSPFile, Surface } from "./BSPFile";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4 } from "gl-matrix";
import { VPKMount, createVPKMount } from "./VPK";
import { ZipFile } from "../ZipFile";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { BaseMaterialProgram, BaseMaterial, MaterialCache, LightmapManager, SurfaceLightingInstance, WorldLightingState } from "./Materials";
import { clamp, computeMatrixWithoutTranslation } from "../MathHelpers";
import { assert } from "../util";
import { interactiveVizSliderSelect } from "../DebugJunk";

const pathBase = `HalfLife2`;

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

    constructor(renderContext: SourceRenderContext, private skyname: string) {
        const device = renderContext.device, cache = renderContext.cache;

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
            { location: BaseMaterialProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: BaseMaterialProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        this.bindMaterial(renderContext.materialCache);
    }

    private async bindMaterial(materialCache: MaterialCache) {
        this.materialInstances = await Promise.all([
            materialCache.createMaterialInstance(`skybox/${this.skyname}rt`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}lf`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}bk`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}ft`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}up`),
            materialCache.createMaterialInstance(`skybox/${this.skyname}dn`),
        ]);
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

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

class BSPSurface {
    public materialInstance: BaseMaterial | null = null;
    public surfaceLighting: SurfaceLightingInstance;
    public visible = true;

    constructor(public surface: Surface) {
    }

    public bindMaterial(materialInstance: BaseMaterial, lightmapManager: LightmapManager): void {
        this.materialInstance = materialInstance;

        this.surfaceLighting = new SurfaceLightingInstance(lightmapManager, this.surface, this.materialInstance.wantsLightmap, this.materialInstance.wantsBumpmappedLightmap);
        this.materialInstance.setLightmapAllocation(this.surfaceLighting.allocation);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.visible || !this.materialInstance.isMaterialLoaded())
            return;

        if (this.surfaceLighting !== null && this.surfaceLighting.lightmapDirty) {
            this.surfaceLighting.buildLightmap(renderContext.worldLightingState);
            this.surfaceLighting.uploadLightmap(renderContext.device);
        }

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

    constructor(renderContext: SourceRenderContext, private bsp: BSPFile) {
        const device = renderContext.device, cache = renderContext.cache;
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.bsp.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.bsp.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: BaseMaterialProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: BaseMaterialProgram.a_Normal,   bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGB, },
            { location: BaseMaterialProgram.a_TangentS, bufferIndex: 0, bufferByteOffset: 6*0x04, format: GfxFormat.F32_RGBA, },
            { location: BaseMaterialProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 10*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+3+4+4)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        for (let i = 0; i < this.bsp.surfaces.length; i++)
            this.surfaces.push(new BSPSurface(this.bsp.surfaces[i]));

        this.bindMaterials(renderContext);
    }

    private async bindMaterial(renderContext: SourceRenderContext, surface: BSPSurface) {
        const materialCache = renderContext.materialCache, lightmapManager = renderContext.lightmapManager;
        const texinfo = this.bsp.texinfo[surface.surface.texinfo];
        const materialInstance = await materialCache.createMaterialInstance(texinfo.texName);
        surface.bindMaterial(materialInstance, lightmapManager);
    }

    private bindMaterials(renderContext: SourceRenderContext) {
        for (let i = 0; i < this.surfaces.length; i++) {
            const surface = this.surfaces[i];
            this.bindMaterial(renderContext, surface);
        }
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].prepareToRender(renderContext, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }

    public surfaceSelect(): void {
        interactiveVizSliderSelect(this.surfaces, (item) => {
            console.log(item);
        });
    }
}

class SourceRenderContext {
    public lightmapManager: LightmapManager;
    public materialCache: MaterialCache;
    public worldLightingState = new WorldLightingState();
    public filesystem = new SourceFileSystem();

    constructor(public device: GfxDevice, public cache: GfxRenderCache) {
        this.lightmapManager = new LightmapManager(device, cache);
        this.materialCache = new MaterialCache(device, cache, this.filesystem);
    }

    public destroy(device: GfxDevice): void {
        this.lightmapManager.destroy(device);
        this.materialCache.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 6 },
];

export class SourceRenderer implements SceneGfx {
    private renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public skyboxRenderer: SkyboxRenderer | null = null;
    public bspRenderers: BSPRenderer[] = [];
    public renderContext: SourceRenderContext;

    constructor(context: SceneContext) {
        const device = context.device;
        this.renderHelper = new GfxRenderHelper(device);
        this.renderContext = new SourceRenderContext(device, this.renderHelper.getCache());
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(BaseMaterialProgram.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(offs);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);

        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(renderInstManager, viewerInput);

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].prepareToRender(this.renderContext, renderInstManager, viewerInput);

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
        this.renderContext.destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
    }
}

class HalfLife2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const renderer = new SourceRenderer(context);
        const renderContext = renderer.renderContext;

        const filesystem = renderContext.filesystem;
        filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/hl2_textures`));
        filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/hl2_misc`));

        const bsp = await context.dataFetcher.fetchData(`${pathBase}/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bsp);
        if (bspFile.pakfile !== null)
            filesystem.pakfiles.push(bspFile.pakfile);

        // Build skybox from worldname.
        const worldspawn = bspFile.entities[0];
        assert(worldspawn.classname === 'worldspawn');
        if (worldspawn.skyname)
            renderer.skyboxRenderer = new SkyboxRenderer(renderContext, worldspawn.skyname);

        const bspRenderer = new BSPRenderer(renderContext, bspFile);
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
