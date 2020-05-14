
import { SceneContext } from "../SceneBase";
import { GfxDevice, GfxRenderPass, GfxCullMode, GfxHostAccessPass, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxVertexBufferFrequency, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxInputState, GfxTexture } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput, SceneGfx } from "../viewer";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget, depthClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { fillMatrix4x4, fillVec3v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { BSPFile, Surface, Model } from "./BSPFile";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth, executeOnPass } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3 } from "gl-matrix";
import { VPKMount } from "./VPK";
import { ZipFile } from "../ZipFile";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { BaseMaterialProgram, BaseMaterial, MaterialCache, LightmapManager, SurfaceLightingInstance, WorldLightingState, MaterialProxySystem, EntityMaterialParameters } from "./Materials";
import { clamp, computeMatrixWithoutTranslation, computeModelMatrixSRT, MathConstants, getMatrixTranslation } from "../MathHelpers";
import { assert } from "../util";
import { BSPEntity, vmtParseNumbers } from "./VMT";
import { computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from "../Camera";
import { AABB } from "../Geometry";
import { DetailSpriteLeafRenderer } from "./StaticDetailObject";

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

// In Source, the convention is +X for forward and -X for backward, +Y for left and -Y for right, and +Z for up and -Z for down.
// Converts from Source conventions to noclip ones.
export const noclipSpaceFromSourceEngineSpace = mat4.fromValues(
    0,  0, -1, 0,
    -1, 0,  0, 0,
    0,  1,  0, 0,
    0,  0,  0, 1,
);

const scratchMatrix = mat4.create();
export class SkyboxRenderer {
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
        mat4.mul(scratchMatrix, scratchMatrix, noclipSpaceFromSourceEngineSpace);
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

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.visible || !this.materialInstance.isMaterialLoaded())
            return;

        this.materialInstance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewMatrixZUp: mat4, modelMatrix: mat4) {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.visible || !this.materialInstance.isMaterialLoaded())
            return;

        if (this.surfaceLighting !== null && this.surfaceLighting.lightmapDirty) {
            this.surfaceLighting.buildLightmap(renderContext.worldLightingState);
            this.surfaceLighting.uploadLightmap(renderContext.device);
        }

        const renderInst = renderInstManager.newRenderInst();
        this.materialInstance.setOnRenderInst(renderContext, renderInst, modelMatrix);
        renderInst.drawIndexes(this.surface.indexCount, this.surface.startIndex);
        const depth = computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(viewMatrixZUp, this.surface.center);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        renderInstManager.submitRenderInst(renderInst);
    }
}

const scratchAABB = new AABB();
const scratchMatrixCull = mat4.create();
class BSPModelRenderer {
    public visible: boolean = true;
    public modelMatrix = mat4.create();
    public entity: BaseEntity | null = null;
    public surfaces: BSPSurfaceRenderer[] = [];
    public displacementSurfaces: BSPSurfaceRenderer[] = [];

    constructor(renderContext: SourceRenderContext, public model: Model, public bsp: BSPFile) {
        for (let j = 0; j < model.surfaceCount; j++) {
            const surface = new BSPSurfaceRenderer(this.bsp.surfaces[this.model.surfaceStart + j]);
            this.bindMaterial(renderContext, surface);
            this.surfaces.push(surface);

            if (surface.surface.dispinfo >= 0)
                this.displacementSurfaces.push(surface);
        }
    }

    public setEntity(entity: BaseEntity): void {
        this.entity = entity;
        for (let i = 0; i < this.surfaces.length; i++)
            if (this.surfaces[i].materialInstance !== null)
                this.surfaces[i].materialInstance!.entityParams = entity.materialParams;
    }

    private async bindMaterial(renderContext: SourceRenderContext, surface: BSPSurfaceRenderer) {
        const materialCache = renderContext.materialCache;
        const texinfo = this.bsp.texinfo[surface.surface.texinfo];
        const materialInstance = await materialCache.createMaterialInstance(renderContext, texinfo.texName);
        if (this.entity !== null)
            materialInstance.entityParams = this.entity.materialParams;
        surface.bindMaterial(materialInstance, renderContext.lightmapManager);
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].movement(renderContext);
    }

    private prepareToRenderBSP(nodeid: number, renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, viewMatrixZUp: mat4, modelMatrixCull: mat4, area: number | null): void {
        if (nodeid >= 0) {
            // node
            const node = this.bsp.nodelist[nodeid];

            if (node.area > 0 && area !== null && node.area !== area)
                return;

            if (area === null) {
                mat4.mul(scratchMatrixCull, noclipSpaceFromSourceEngineSpace, this.modelMatrix);
                scratchAABB.transform(node.bbox, scratchMatrixCull);
                if (!viewerInput.camera.frustum.contains(scratchAABB))
                    return;
            }

            this.prepareToRenderBSP(node.child0, renderContext, renderInstManager, viewerInput, viewMatrixZUp, modelMatrixCull, area);
            this.prepareToRenderBSP(node.child1, renderContext, renderInstManager, viewerInput, viewMatrixZUp, modelMatrixCull, area);

            if (area !== null && node.area !== area)
                return;

            for (let i = node.surfaceStart - this.model.surfaceStart; i < node.surfaceCount; i++)
                this.surfaces[i].prepareToRender(renderContext, renderInstManager, viewMatrixZUp, this.modelMatrix);
        } else {
            // leaf
            const leafnum = -nodeid - 1;
            const leaf = this.bsp.leaflist[leafnum];

            if (area !== null && leaf.area !== area)
                return;

            if (area === null) {
                mat4.mul(scratchMatrixCull, noclipSpaceFromSourceEngineSpace, this.modelMatrix);
                scratchAABB.transform(leaf.bbox, scratchMatrixCull);
                if (!viewerInput.camera.frustum.contains(scratchAABB))
                    return;
            }

            for (let i = 0; i < leaf.leaffaceCount; i++) {
                const surfaceIdx = this.bsp.leaffacelist[leaf.leaffaceStart + i] - this.model.surfaceStart;
                assert(surfaceIdx >= 0);
                this.surfaces[surfaceIdx].prepareToRender(renderContext, renderInstManager, viewMatrixZUp, this.modelMatrix);
            }
        }
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, viewMatrixZUp: mat4, area: number | null): void {
        if (!this.visible)
            return;

        if (area === null) {
            mat4.mul(scratchMatrixCull, noclipSpaceFromSourceEngineSpace, this.modelMatrix);
            scratchAABB.transform(this.model.bbox, scratchMatrixCull);
            if (!viewerInput.camera.frustum.contains(scratchAABB))
                return;
        }

        // Render all displacement surfaces.
        // TODO(jstpierre): Move this to the BSP leaves
        for (let i = 0; i < this.displacementSurfaces.length; i++)
            this.displacementSurfaces[i].prepareToRender(renderContext, renderInstManager, viewMatrixZUp, this.modelMatrix);

        this.prepareToRenderBSP(this.model.headnode, renderContext, renderInstManager, viewerInput, viewMatrixZUp, scratchMatrixCull, area);
    }
}

class BaseEntity {
    public model: BSPModelRenderer | null = null;
    public origin = vec3.create();
    public angles = vec3.create();
    public visible = true;
    public materialParams = new EntityMaterialParameters();

    constructor(bspRenderer: BSPRenderer, private entity: BSPEntity) {
        if (entity.model) {
            if (entity.model.startsWith('*')) {
                const index = parseInt(entity.model.slice(1), 10);
                this.model = bspRenderer.models[index];
                this.model.setEntity(this);
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

            vec3.copy(this.materialParams.position, this.origin);
        }
    }
}

class sky_camera extends BaseEntity {
    public static classname = 'sky_camera';
    public area: number = -1;
    public scale: number = 1;
    public modelMatrix = mat4.create();

    constructor(bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(bspRenderer, entity);
        const leafnum = bspRenderer.bsp.findLeafForPoint(this.origin);
        this.area = bspRenderer.bsp.leaflist[leafnum].area;
        this.scale = Number(entity.scale);
        computeModelMatrixSRT(this.modelMatrix, this.scale, this.scale, this.scale, 0, 0, 0,
            this.scale * -this.origin[0],
            this.scale * -this.origin[1],
            this.scale * -this.origin[2]);
    }
}

interface EntityFactory {
    new(bspRenderer: BSPRenderer, entity: BSPEntity): BaseEntity;
    classname: string;
}

class EntitySystem {
    public classname = new Map<string, EntityFactory>();

    constructor() {
        this.registerDefaultFactories();
    }

    private registerDefaultFactories(): void {
        this.registerFactory(sky_camera);
    }

    public registerFactory(factory: EntityFactory): void {
        this.classname.set(factory.classname, factory);
    }

    public createEntity(renderer: BSPRenderer, entity: BSPEntity): BaseEntity {
        if (this.classname.has(entity.classname))
            return new (this.classname.get(entity.classname)!)(renderer, entity);
        else
            return new BaseEntity(renderer, entity);
    }
}

const enum FilterKey { Skybox, Main }

export class BSPRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private entities: BaseEntity[] = [];
    public models: BSPModelRenderer[] = [];
    public detailSpriteLeafRenderers: DetailSpriteLeafRenderer[] = [];

    constructor(renderContext: SourceRenderContext, public bsp: BSPFile) {
        const device = renderContext.device, cache = renderContext.cache;
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.bsp.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.bsp.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: BaseMaterialProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: BaseMaterialProgram.a_Normal,   bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGBA, },
            { location: BaseMaterialProgram.a_TangentS, bufferIndex: 0, bufferByteOffset: 7*0x04, format: GfxFormat.F32_RGBA, },
            { location: BaseMaterialProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 11*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+4+4+4)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        for (let i = 0; i < this.bsp.models.length; i++) {
            const model = this.bsp.models[i];
            const modelRenderer = new BSPModelRenderer(renderContext, model, bsp);
            // Submodels are invisible by default.
            modelRenderer.visible = (i === 0);
            this.models.push(modelRenderer);
        }

        this.spawnEntities(renderContext);

        if (this.bsp.detailObjects !== null)
            for (const leaf of this.bsp.detailObjects.leafDetailModels.keys())
                this.detailSpriteLeafRenderers.push(new DetailSpriteLeafRenderer(renderContext, this.bsp.detailObjects, leaf));
    }

    private spawnEntities(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.bsp.entities.length; i++)
            this.entities.push(renderContext.entitySystem.createEntity(this, this.bsp.entities[i]));
    }

    public movement(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.entities.length; i++)
            this.entities[i].movement();
        for (let i = 0; i < this.models.length; i++)
            this.models[i].movement(renderContext);
    }

    private prepareToRenderInternal(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelMatrix: mat4 | null, area: number | null): void {
        const template = renderInstManager.pushTemplateRenderInst();

        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        let offs = template.allocateUniformBuffer(BaseMaterialProgram.ub_SceneParams, 32);
        const d = template.mapUniformBufferF32(BaseMaterialProgram.ub_SceneParams);
        mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromSourceEngineSpace);
        if (modelMatrix !== null)
            mat4.mul(scratchMatrix, scratchMatrix, modelMatrix);
        offs += fillMatrix4x4(d, offs, scratchMatrix);
        offs += fillVec3v(d, offs, renderContext.cameraPos);

        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].prepareToRender(renderContext, renderInstManager, viewerInput, scratchMatrix, area);

        renderInstManager.popTemplateRenderInst();
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const skybox = this.entities.find((entity) => entity instanceof sky_camera) as sky_camera | undefined;
        if (skybox !== undefined) {
            const template = renderInstManager.pushTemplateRenderInst();
            template.filterKey = FilterKey.Skybox;
            this.prepareToRenderInternal(renderContext, renderInstManager, viewerInput, skybox.modelMatrix, skybox.area);
            renderInstManager.popTemplateRenderInst();
        }

        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        for (let i = 0; i < this.detailSpriteLeafRenderers.length; i++) {
            // TODO(jstpierre): Compute leaf visibility (ain't that the joke.......)
            this.detailSpriteLeafRenderers[i].prepareToRender(renderContext, renderInstManager, viewerInput, scratchMatrix);
        }

        this.prepareToRenderInternal(renderContext, renderInstManager, viewerInput, null, null);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);

        for (let i = 0; i < this.detailSpriteLeafRenderers.length; i++) {
            this.detailSpriteLeafRenderers[i].destroy(device);
        }
    }
}

export class SourceRenderContext {
    public lightmapManager: LightmapManager;
    public materialCache: MaterialCache;
    public worldLightingState = new WorldLightingState();
    public globalTime: number = 0;
    public cameraPos = vec3.create();
    public materialProxySystem = new MaterialProxySystem();
    public entitySystem = new EntitySystem();

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

        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        mat4.invert(scratchMatrix, scratchMatrix);
        getMatrixTranslation(this.renderContext.cameraPos, scratchMatrix);

        this.movement();

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });
        template.setBindingLayouts(bindingLayouts);

        template.filterKey = FilterKey.Skybox;
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(this.renderContext, renderInstManager, viewerInput);

        template.filterKey = FilterKey.Main;
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

        let passRenderer: GfxRenderPass;
        passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        executeOnPass(this.renderHelper.renderInstManager, device, passRenderer, FilterKey.Skybox);
        device.submitPass(passRenderer);

        passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        executeOnPass(this.renderHelper.renderInstManager, device, passRenderer, FilterKey.Main);
        device.submitPass(passRenderer);

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
