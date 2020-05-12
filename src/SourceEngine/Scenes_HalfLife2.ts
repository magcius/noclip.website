
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import { GfxDevice, GfxRenderPass, GfxCullMode, GfxHostAccessPass, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxVertexBufferFrequency, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxInputState, GfxTexture } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput, SceneGfx } from "../viewer";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from "../gfx/helpers/RenderTargetHelpers";
import { fillMatrix4x4, fillVec4, fillVec3v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { BSPFile, Surface, Model } from "./BSPFile";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3 } from "gl-matrix";
import { VPKMount, createVPKMount } from "./VPK";
import { ZipFile } from "../ZipFile";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { BaseMaterialProgram, BaseMaterial, MaterialCache, LightmapManager, SurfaceLightingInstance, WorldLightingState, MaterialProxySystem } from "./Materials";
import { clamp, computeMatrixWithoutTranslation, computeModelMatrixSRT, MathConstants, getMatrixTranslation } from "../MathHelpers";
import { assert } from "../util";
import { Entity, vmtParseNumbers } from "./VMT";
import { computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from "../Camera";

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

    public destroy(device: GfxDevice): void {
    }
}

const zup = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

const scratchMatrix = mat4.create();
class SkyboxRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private materialInstances: BaseMaterial[] = [];
    private modelMatrix = mat4.create();

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

        this.bindMaterial(renderContext);
    }

    private async bindMaterial(renderContext: SourceRenderContext) {
        const materialCache = renderContext.materialCache;
        this.materialInstances = await Promise.all([
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}rt`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}lf`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}bk`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}ft`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}up`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}dn`),
        ]);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // Wait until we're ready.
        if (this.materialInstances.length === 0)
            return;

        for (let i = 0; i < this.materialInstances.length; i++)
            if (!this.materialInstances[i].isMaterialLoaded())
                return;

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.viewMatrix);
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        let offs = template.allocateUniformBuffer(BaseMaterialProgram.ub_SceneParams, 32);
        const d = template.mapUniformBufferF32(BaseMaterialProgram.ub_SceneParams);
        mat4.mul(scratchMatrix, viewerInput.camera.projectionMatrix, scratchMatrix);
        mat4.mul(scratchMatrix, scratchMatrix, zup);
        offs += fillMatrix4x4(d, offs, scratchMatrix);
        offs += fillVec3v(d, offs, renderContext.cameraPos);

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.viewMatrix);

        for (let i = 0; i < 6; i++) {
            const renderInst = renderInstManager.newRenderInst();
            this.materialInstances[i].setOnRenderInst(renderContext, renderInst, this.modelMatrix);
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

class BSPSurfaceRenderer {
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

    public movement(renderContext: SourceRenderContext, modelMatrix: mat4): void {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.visible || !this.materialInstance.isMaterialLoaded())
            return;

        getMatrixTranslation(this.materialInstance.entityParams.position, modelMatrix);
        this.materialInstance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewMatrixForDepthSort: mat4, modelMatrix: mat4) {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.visible || !this.materialInstance.isMaterialLoaded())
            return;

        if (this.surfaceLighting !== null && this.surfaceLighting.lightmapDirty) {
            this.surfaceLighting.buildLightmap(renderContext.worldLightingState);
            this.surfaceLighting.uploadLightmap(renderContext.device);
        }

        const renderInst = renderInstManager.newRenderInst();
        this.materialInstance.setOnRenderInst(renderContext, renderInst, modelMatrix);
        renderInst.drawIndexes(this.surface.indexCount, this.surface.startIndex);
        const depth = computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(viewMatrixForDepthSort, this.surface.center);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        renderInstManager.submitRenderInst(renderInst);
    }
}

class BSPModelRenderer {
    public visible: boolean = true;
    public modelMatrix = mat4.create();
    public entity: EntityInstance | null = null;

    constructor(public model: Model, public surfaces: BSPSurfaceRenderer[]) {
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].movement(renderContext, this.modelMatrix);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewMatrixForDepthSort: mat4): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].prepareToRender(renderContext, renderInstManager, viewMatrixForDepthSort, this.modelMatrix);
    }
}

class EntityInstance {
    private model: BSPModelRenderer | null = null;
    private origin = vec3.create();
    private angles = vec3.create();
    public visible = true;

    constructor(bspRenderer: BSPRenderer, private entity: Entity) {
        if (entity.model) {
            if (entity.model.startsWith('*')) {
                const index = parseInt(entity.model.slice(1), 10);
                this.model = bspRenderer.models[index];
                this.model.entity = this;
            } else {
                // External model reference.
            }
        }

        if (entity.origin) {
            const origin = vmtParseNumbers(entity.origin);
            vec3.set(this.origin, origin[0], origin[1], origin[2]);
        }

        if (entity.angles) {
            const angles = vmtParseNumbers(entity.angles);
            vec3.set(this.angles, angles[0], angles[1], angles[2]);
        }
    }

    public movement(): void {
        if (this.model !== null) {
            const rotX = MathConstants.DEG_TO_RAD * this.angles[0];
            const rotY = MathConstants.DEG_TO_RAD * this.angles[1];
            const rotZ = MathConstants.DEG_TO_RAD * this.angles[2];
            const transX = this.origin[0];
            const transY = this.origin[1];
            const transZ = this.origin[2];
            computeModelMatrixSRT(this.model.modelMatrix, 1, 1, 1, rotX, rotY, rotZ, transX, transY, transZ);
            this.model.visible = this.visible;
        }
    }
}

class BSPRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private entities: EntityInstance[] = [];
    public models: BSPModelRenderer[] = [];

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

        for (let i = 0; i < this.bsp.models.length; i++) {
            const model = this.bsp.models[i];

            const surfaces: BSPSurfaceRenderer[] = [];
            for (let j = 0; j < model.surfaceCount; j++) {
                const surface = new BSPSurfaceRenderer(this.bsp.surfaces[model.surfaceStart + j]);
                this.bindMaterial(renderContext, surface);
                surfaces.push(surface);
            }

            const modelRenderer = new BSPModelRenderer(model, surfaces);
            // Submodels are invisible by default.
            modelRenderer.visible = (i === 0);
            this.models.push(modelRenderer);
        }

        this.spawnEntities();
    }

    private async bindMaterial(renderContext: SourceRenderContext, surface: BSPSurfaceRenderer) {
        const materialCache = renderContext.materialCache;
        const texinfo = this.bsp.texinfo[surface.surface.texinfo];
        const materialInstance = await materialCache.createMaterialInstance(renderContext, texinfo.texName);
        surface.bindMaterial(materialInstance, renderContext.lightmapManager);
    }

    private spawnEntities(): void {
        for (let i = 0; i < this.bsp.entities.length; i++)
            this.entities.push(new EntityInstance(this, this.bsp.entities[i]));
    }

    public movement(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.entities.length; i++)
            this.entities[i].movement();
        for (let i = 0; i < this.models.length; i++)
            this.models[i].movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        let offs = template.allocateUniformBuffer(BaseMaterialProgram.ub_SceneParams, 32);
        const d = template.mapUniformBufferF32(BaseMaterialProgram.ub_SceneParams);
        mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, zup);
        offs += fillMatrix4x4(d, offs, scratchMatrix);
        offs += fillVec3v(d, offs, renderContext.cameraPos);

        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, zup);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].prepareToRender(renderContext, renderInstManager, scratchMatrix);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

export class SourceRenderContext {
    public lightmapManager: LightmapManager;
    public materialCache: MaterialCache;
    public worldLightingState = new WorldLightingState();
    public globalTime: number = 0;
    public cameraPos = vec3.create();
    public materialProxySystem = new MaterialProxySystem();

    constructor(public device: GfxDevice, public cache: GfxRenderCache, public filesystem: SourceFileSystem) {
        this.lightmapManager = new LightmapManager(device, cache);
        this.materialCache = new MaterialCache(device, cache, this.filesystem);
    }

    public destroy(device: GfxDevice): void {
        this.lightmapManager.destroy(device);
        this.materialCache.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 7 },
];

export class SourceRenderer implements SceneGfx {
    private renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public skyboxRenderer: SkyboxRenderer | null = null;
    public bspRenderers: BSPRenderer[] = [];
    public renderContext: SourceRenderContext;

    constructor(context: SceneContext, filesystem: SourceFileSystem) {
        const device = context.device;
        this.renderHelper = new GfxRenderHelper(device);
        this.renderContext = new SourceRenderContext(device, this.renderHelper.getCache(), filesystem);
    }

    private movement(): void {
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].movement(this.renderContext);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        // globalTime is in seconds.
        this.renderContext.globalTime = viewerInput.time / 1000.0;

        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, zup);
        mat4.invert(scratchMatrix, scratchMatrix);
        getMatrixTranslation(this.renderContext.cameraPos, scratchMatrix);

        this.movement();

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });
        template.setBindingLayouts(bindingLayouts);

        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(this.renderContext, renderInstManager, viewerInput);

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
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem();
            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/hl2_textures`));
            filesystem.mounts.push(await createVPKMount(context.dataFetcher, `${pathBase}/hl2_misc`));
            return filesystem;
        });

        // Clear out old filesystem pakfile.
        filesystem.pakfiles.length = 0;

        const renderer = new SourceRenderer(context, filesystem);
        const renderContext = renderer.renderContext;

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
