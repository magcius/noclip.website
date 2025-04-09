
import { mat4, quat, ReadonlyMat4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import BitMap from "../BitMap.js";
import { Camera, CameraController, computeViewSpaceDepthFromWorldSpacePoint } from "../Camera.js";
import { DataFetcher } from "../DataFetcher.js";
import { AABB, Frustum, Plane } from "../Geometry.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxClipSpaceNearZ, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxRenderPass, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode, GfxProgram, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRendererLayer, GfxRenderInstList, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrPass, GfxrPassScope, GfxrRenderTargetDescription, GfxrRenderTargetID, GfxrResolveTextureID } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { clamp, computeModelMatrixS, getMatrixTranslation, Vec3UnitZ } from "../MathHelpers.js";
import { DeviceProgram } from "../Program.js";
import { SceneContext } from "../SceneBase.js";
import { TextureMapping } from "../TextureHolder.js";
import { arrayRemove, assert, assertExists, nArray } from "../util.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { ZipFile, decompressZipFileEntry, parseZipFile } from "../ZipFile.js";
import { BSPFile, BSPFileVariant, Model, BSPSurface } from "./BSPFile.js";
import { BaseEntity, calcFrustumViewProjection, EntityFactoryRegistry, EntitySystem, env_projectedtexture, env_shake, point_camera, sky_camera, worldspawn } from "./EntitySystem.js";
import { DetailPropLeafRenderer, StaticPropRenderer } from "./StaticDetailObject.js";
import { StudioModelCache } from "./Studio.js";
import { createVPKMount, VPKMount } from "./VPK.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import * as UI from "../ui.js";
import { projectionMatrixConvertClipSpaceNearZ } from "../gfx/helpers/ProjectionHelpers.js";
import { projectionMatrixReverseDepth } from "../gfx/helpers/ReversedDepthHelpers.js";
import { LuminanceHistogram } from "./LuminanceHistogram.js";
import { fillColor, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { dfRange, dfShow } from "../DebugFloaters.js";
import { GMA } from "./GMA.js";
import { LightmapManager, FaceLightmapUpdater } from "./Materials/Lightmap.js";
import { BaseMaterial, MaterialShaderTemplateBase, fillSceneParamsOnRenderInst, FogParams, ToneMapParams, LateBindingTexture } from "./Materials/MaterialBase.js";
import { MaterialCache } from "./Materials/MaterialCache.js";
import { MaterialProxySystem } from "./Materials/MaterialParameters.js";
import { ProjectedLight, WorldLightingState } from "./Materials/WorldLight.js";

export class LooseMount {
    private normalizedFiles: string[];

    constructor(public path: string, private files: string[]) {
        this.normalizedFiles = this.files.map((v) => v.toLowerCase());
    }

    public hasEntry(resolvedPath: string): boolean {
        return this.normalizedFiles.includes(resolvedPath);
    }

    public fetchEntryData(dataFetcher: DataFetcher, resolvedPath: string): Promise<ArrayBufferSlice> {
        const i = this.normalizedFiles.indexOf(resolvedPath);
        assert(i >= 0);
        return dataFetcher.fetchData(`${this.path}/${this.files[i]}`);
    }
}

function normalizeZip(zip: ZipFile): void {
    for (let i = 0; i < zip.length; i++)
        zip[i].filename = zip[i].filename.toLowerCase().replace(/\\/g, '/');  
}

export class SourceFileSystem {
    public pakfiles: ZipFile[] = [];
    public zip: ZipFile[] = [];
    public vpk: VPKMount[] = [];
    public loose: LooseMount[] = [];
    public gma: GMA[] = [];

    constructor(private dataFetcher: DataFetcher) {
    }

    public async createVPKMount(path: string) {
        // This little dance here is to ensure that priorities are correctly ordered.
        const dummyMount = null!;
        const i = this.vpk.push(dummyMount) - 1;
        this.vpk[i] = await createVPKMount(this.dataFetcher, path);
    }

    public addPakFile(pakfile: ZipFile): void {
        normalizeZip(pakfile);
        this.pakfiles.push(pakfile);
    }

    public async createZipMount(path: string) {
        const data = await this.dataFetcher.fetchData(path);
        const zip = parseZipFile(data);
        normalizeZip(zip);
        this.zip.push(zip);
    }

    public async createGMAMount(path: string) {
        const data = await this.dataFetcher.fetchData(path);
        const gma = new GMA(data);
        this.gma.push(gma);
    }

    public resolvePath(path: string, ext: string): string {
        path = path.toLowerCase().replace(/\\/g, '/');
        if (!path.endsWith(ext))
            path = `${path}${ext}`;

        if (path.includes('../')) {
            // Resolve relative paths.
            const parts = path.split('/');

            while (parts.includes('..')) {
                const idx = parts.indexOf('..');
                parts.splice(idx - 1, 2);
            }

            path = parts.join('/');
        }

        path = path.replace(/\.\//g, '');

        while (path.includes('//'))
            path = path.replace(/\/\//g, '/');

        return path;
    }

    public searchPath(searchDirs: string[], path: string, ext: string): string | null {
        for (let i = 0; i < searchDirs.length; i++) {
            let searchDir = searchDirs[i];

            // Normalize path separators.
            searchDir = searchDir.replace(/\\/g, '/');
            searchDir = searchDir.replace(/\/\//g, '/');
            if (searchDir.endsWith('/'))
                searchDir = searchDir.slice(0, -1);

            // Attempt searching for a path.
            const finalPath = this.resolvePath(`${searchDir}/${path}`, ext);
            if (this.hasEntry(finalPath))
                return finalPath;
        }

        return null;
    }

    public hasEntry(resolvedPath: string): boolean {
        for (let i = 0; i < this.loose.length; i++) {
            const loose = this.loose[i];
            if (loose.hasEntry(resolvedPath))
                return true;
        }

        for (let i = 0; i < this.vpk.length; i++) {
            const entry = this.vpk[i].findEntry(resolvedPath);
            if (entry !== null)
                return true;
        }

        for (let i = 0; i < this.pakfiles.length; i++) {
            const pakfile = this.pakfiles[i];
            const entry = pakfile.find((entry) => entry.filename === resolvedPath);
            if (entry !== undefined)
                return true;
        }

        for (let i = 0; i < this.zip.length; i++) {
            const zip = this.zip[i];
            const entry = zip.find((entry) => entry.filename === resolvedPath);
            if (entry !== undefined)
                return true;
        }

        for (let i = 0; i < this.gma.length; i++) {
            const gma = this.gma[i];
            const entry = gma.files.find((entry) => entry.filename === resolvedPath);
            if (entry !== undefined)
                return true;
        }

        return false;
    }

    public async fetchFileData(resolvedPath: string): Promise<ArrayBufferSlice | null> {
        for (let i = 0; i < this.loose.length; i++) {
            const custom = this.loose[i];
            if (custom.hasEntry(resolvedPath))
                return custom.fetchEntryData(this.dataFetcher, resolvedPath);
        }

        for (let i = 0; i < this.vpk.length; i++) {
            const entry = this.vpk[i].findEntry(resolvedPath);
            if (entry !== null)
                return this.vpk[i].fetchFileData(this.dataFetcher, entry);
        }

        for (let i = 0; i < this.pakfiles.length; i++) {
            const zip = this.pakfiles[i];
            const entry = zip.find((entry) => entry.filename === resolvedPath);
            if (entry !== undefined)
                return decompressZipFileEntry(entry);
        }

        for (let i = 0; i < this.zip.length; i++) {
            const zip = this.zip[i];
            const entry = zip.find((entry) => entry.filename === resolvedPath);
            if (entry !== undefined)
                return decompressZipFileEntry(entry);
        }

        for (let i = 0; i < this.gma.length; i++) {
            const gma = this.gma[i];
            const entry = gma.files.find((entry) => entry.filename === resolvedPath);
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
const noclipSpaceFromSourceEngineSpace = mat4.fromValues(
    0,  0, -1, 0,
    -1, 0,  0, 0,
    0,  1,  0, 0,
    0,  0,  0, 1,
);

export class SkyboxRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private materialInstances: BaseMaterial[] = [];
    private modelMatrix = mat4.create();

    constructor(renderContext: SourceRenderContext, private skyname: string) {
        const device = renderContext.device, cache = renderContext.renderCache;

        const vertexData = new Float32Array(6 * 4 * 5);
        const indexData = new Uint16Array(6 * 6);

        let dstVert = 0;
        let dstIdx = 0;

        function buildPlaneVert(pb: number, s: number, t: number): void {
            const side = 1000000;
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

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialShaderTemplateBase.a_Position,   bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialShaderTemplateBase.a_TexCoord01, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
            { location: MaterialShaderTemplateBase.a_Normal,     bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_TangentS,   bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 0, frequency: GfxVertexBufferFrequency.Constant, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBufferDescriptors = [
            { buffer: this.vertexBuffer, byteOffset: 0, },
            { buffer: renderContext.materialCache.staticResources.zeroVertexBuffer, byteOffset: 0, },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0, };

        this.bindMaterial(renderContext);
    }

    private async createMaterialInstance(renderContext: SourceRenderContext, path: string): Promise<BaseMaterial> {
        const materialCache = renderContext.materialCache;
        const materialInstance = await materialCache.createMaterialInstance(path);
        materialInstance.hasVertexColorInput = false;
        await materialInstance.init(renderContext);
        return materialInstance;
    }

    private async bindMaterial(renderContext: SourceRenderContext) {
        this.materialInstances = await Promise.all([
            this.createMaterialInstance(renderContext, `skybox/${this.skyname}rt`),
            this.createMaterialInstance(renderContext, `skybox/${this.skyname}lf`),
            this.createMaterialInstance(renderContext, `skybox/${this.skyname}bk`),
            this.createMaterialInstance(renderContext, `skybox/${this.skyname}ft`),
            this.createMaterialInstance(renderContext, `skybox/${this.skyname}up`),
            this.createMaterialInstance(renderContext, `skybox/${this.skyname}dn`),
        ]);
    }

    public movement(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView): void {
        // Wait until we're ready.
        if (this.materialInstances.length === 0)
            return;

        for (let i = 0; i < this.materialInstances.length; i++)
            if (!this.materialInstances[i].isMaterialLoaded())
                return;

        const template = renderInstManager.pushTemplate();
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        fillSceneParamsOnRenderInst(template, view, renderContext.toneMapParams);

        for (let i = 0; i < 6; i++) {
            const materialInstance = this.materialInstances[i];
            if (!materialInstance.isMaterialVisible(renderContext))
                continue;
            const renderInst = renderInstManager.newRenderInst();
            materialInstance.setOnRenderInst(renderContext, renderInst);
            materialInstance.setOnRenderInstModelMatrix(renderInst, this.modelMatrix);
            // Overwrite the filter key from the material instance.
            renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
            renderInst.setDrawCount(6, i*6);
            materialInstance.getRenderInstListForView(view).submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class BSPSurfaceRenderer {
    public visible = true;
    public materialInstance: BaseMaterial | null = null;
    private lightmapManagerPage: number;

    constructor(public surface: BSPSurface) {
    }

    public bindMaterial(bspRenderer: BSPRenderer, materialInstance: BaseMaterial, startLightmapPageIndex: number): void {
        this.materialInstance = materialInstance;

        this.lightmapManagerPage = startLightmapPageIndex + this.surface.lightmapPackerPageIndex;
        for (let i = 0; i < this.surface.faceList.length; i++) {
            const faceIdx = this.surface.faceList[i];
            const lightmapUpdater = bspRenderer.lightmapUpdaters[faceIdx];

            if (lightmapUpdater !== null)
                lightmapUpdater.setMaterial(materialInstance);
        }
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible || this.materialInstance === null)
            return;

        this.materialInstance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, modelMatrix: ReadonlyMat4 | null) {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.isMaterialVisible(renderContext))
            return;

        const view = renderContext.currentView;

        const bbox = transformAABB(this.surface.bbox, modelMatrix);
        if (!view.frustum.contains(bbox))
            return;

        this.materialInstance.calcProjectedLight(renderContext, bbox);

        const renderInst = renderInstManager.newRenderInst();
        this.materialInstance.setOnRenderInst(renderContext, renderInst, this.lightmapManagerPage);
        this.materialInstance.setOnRenderInstModelMatrix(renderInst, modelMatrix);
        renderInst.setDrawCount(this.surface.indexCount, this.surface.startIndex);
        renderInst.debug = this;

        if (this.surface.center !== null) {
            const depth = computeViewSpaceDepthFromWorldSpacePoint(view.viewFromWorldMatrix, this.surface.center);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        }

        this.materialInstance.getRenderInstListForView(view).submitRenderInst(renderInst);
    }
}

const scratchAABB = new AABB();
function transformAABB(src: AABB, m: ReadonlyMat4 | null): AABB {
    if (m === null)
        return src;
    scratchAABB.transform(src, m);
    return scratchAABB;
}

export class BSPModelRenderer {
    public visible: boolean = true;
    public modelMatrix: ReadonlyMat4 | null = null;
    public entity: BaseEntity | null = null;
    public surfaces: BSPSurfaceRenderer[] = [];
    public surfacesByIdx: BSPSurfaceRenderer[] = [];

    constructor(renderContext: SourceRenderContext, public model: Model, private bspRenderer: BSPRenderer, startLightmapPageIndex: number) {
        for (let i = 0; i < model.surfaces.length; i++) {
            const surfaceIdx = model.surfaces[i];
            const surface = new BSPSurfaceRenderer(this.bspRenderer.bsp.surfaces[surfaceIdx]);
            this.surfaces.push(surface);
            this.surfacesByIdx[surfaceIdx] = surface;
        }

        this.bindMaterials(this.bspRenderer, renderContext, startLightmapPageIndex);
    }

    public setEntity(entity: BaseEntity): void {
        this.entity = entity;
        for (let i = 0; i < this.surfaces.length; i++)
            if (this.surfaces[i] !== undefined && this.surfaces[i].materialInstance !== null)
                this.surfaces[i].materialInstance!.entityParams = entity.materialParams;
    }

    public findMaterial(texName: string): BaseMaterial | null {
        for (let i = 0; i < this.surfaces.length; i++) {
            const surface = this.surfaces[i];
            if (surface.surface.texName === texName)
                return surface.materialInstance;
        }

        return null;
    }

    private async bindMaterials(bspRenderer: BSPRenderer, renderContext: SourceRenderContext, startLightmapPageIndex: number) {
        await Promise.all(this.surfaces.map(async (surfaceRenderer) => {
            const surface = surfaceRenderer.surface;

            const materialInstance = await renderContext.materialCache.createMaterialInstance(surface.texName);

            const entityParams = this.entity !== null ? this.entity.materialParams : null;
            materialInstance.entityParams = entityParams;

            // We don't have vertex colors on BSP surfaces.
            materialInstance.hasVertexColorInput = false;

            materialInstance.wantsTexCoord0Scale = surface.wantsTexCoord0Scale;

            await materialInstance.init(renderContext);
            surfaceRenderer.bindMaterial(bspRenderer, materialInstance, startLightmapPageIndex);
        }));
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].movement(renderContext);
    }

    public checkFrustum(renderContext: SourceRenderContext): boolean {
        const view = renderContext.currentView;

        if (!this.visible)
            return false;

        if (!view.frustum.contains(transformAABB(this.model.bbox, this.modelMatrix)))
            return false;

        return true;
    }

    public prepareToRenderModel(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        if (!this.checkFrustum(renderContext))
            return;

        // Submodels don't use the BSP tree, they simply render all surfaces back to back in a batch.
        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].prepareToRender(renderContext, renderInstManager, this.modelMatrix);
    }
}

export const enum SourceEngineViewType {
    MainView,
    WaterReflectView,
    ShadowMap,
};

// A "View" is effectively camera settings, but in Source engine space.
export class SourceEngineView {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();

    public clipSpaceNearZ: GfxClipSpaceNearZ;

    // The current camera position, in Source engine world space.
    public cameraPos = vec3.create();
    public aspect = 1.0;

    // Frustum is stored in Source engine world space.
    public frustum = new Frustum();

    public mainList = new GfxRenderInstList();
    public indirectList = new GfxRenderInstList(null);
    public translucentList = new GfxRenderInstList();

    public fogParams = new FogParams();
    public useExpensiveWater = false;
    public pvs = new BitMap(65536);

    public viewType: SourceEngineViewType = SourceEngineViewType.MainView;

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
        this.frustum.updateClipFrustum(this.clipFromWorldMatrix, this.clipSpaceNearZ);
    }

    public copy(other: SourceEngineView): void {
        this.clipSpaceNearZ = other.clipSpaceNearZ;
        this.aspect = other.aspect;
        mat4.copy(this.viewFromWorldMatrix, other.viewFromWorldMatrix);
        mat4.copy(this.clipFromViewMatrix, other.clipFromViewMatrix);
        vec3.copy(this.cameraPos, other.cameraPos);
    }

    public setupFromCamera(camera: Camera): void {
        this.clipSpaceNearZ = camera.clipSpaceNearZ;
        this.aspect = camera.aspect;
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
    }

    public reset(): void {
        this.mainList.reset();
        this.indirectList.reset();
        this.translucentList.reset();
    }

    public calcPVS(bsp: BSPFile, fallback: boolean, parentView: SourceEngineView | null = null): boolean {
        // Compute PVS from view.
        const leaf = bsp.queryPoint(this.cameraPos);

        const pvs = this.pvs;
        const numclusters = bsp.visibility !== null ? bsp.visibility.numclusters : this.pvs.words.length;
        if (bsp.visibility !== null && leaf !== null && leaf.cluster !== 0xFFFF) {
            const cluster = bsp.visibility.pvs[leaf.cluster];
            if (parentView !== null) {
                for (let i = 0; i < numclusters; i++)
                    pvs.words[i] = cluster.words[i] | parentView.pvs.words[i];
            } else {
                for (let i = 0; i < numclusters; i++)
                    pvs.words[i] = cluster.words[i];
            }
            return true;
        } else if (fallback) {
            for (let i = 0; i < numclusters; i++)
                pvs.words[i] = 0xFFFFFFFF;
            return true;
        } else if (parentView !== null) {
            let hasBit = false;
            for (let i = 0; i < numclusters; i++) {
                pvs.words[i] = parentView.pvs.words[i];
                if (pvs.words[i])
                    hasBit = true;
            }
            return hasBit;
        } else {
            // No need to clear.
            // for (let i = 0; i < numclusters; i++)
            //     pvs.words[i] = 0;
            return false;
        }
    }
}

export const enum RenderObjectKind {
    WorldSpawn  = 1 << 0,
    Entities    = 1 << 1,
    StaticProps = 1 << 2,
    DetailProps = 1 << 3,
}

export class BSPRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    public entitySystem: EntitySystem;
    public models: BSPModelRenderer[] = [];
    public detailPropLeafRenderers: DetailPropLeafRenderer[] = [];
    public staticPropRenderers: StaticPropRenderer[] = [];
    public liveSurfaceSet = new Set<number>();
    public liveFaceSet = new Set<number>();
    public liveLeafSet = new Set<number>();
    public lightmapUpdaters: (FaceLightmapUpdater | null)[] = [];
    private startLightmapPageIndex: number = 0;

    constructor(renderContext: SourceRenderContext, public bsp: BSPFile) {
        this.entitySystem = new EntitySystem(renderContext, this);

        renderContext.materialCache.setRenderConfig(this.bsp.usingHDR, this.bsp.version);
        this.startLightmapPageIndex = renderContext.lightmapManager.appendPackerPages(this.bsp.lightmapPacker);

        const device = renderContext.device, cache = renderContext.renderCache;
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.bsp.vertexData);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, this.bsp.indexData);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialShaderTemplateBase.a_Position,   bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialShaderTemplateBase.a_Normal,     bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_TangentS,   bufferIndex: 0, bufferByteOffset: 7*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialShaderTemplateBase.a_TexCoord01, bufferIndex: 0, bufferByteOffset: 11*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+4+4+4)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U32_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer, byteOffset: 0, }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0, };

        for (let i = 0; i < this.bsp.models.length; i++) {
            const model = this.bsp.models[i];
            const modelRenderer = new BSPModelRenderer(renderContext, model, this, this.startLightmapPageIndex);
            // Non-world-spawn models are invisible by default (they're lifted into the world by entities).
            modelRenderer.visible = (i === 0);
            this.models.push(modelRenderer);
        }

        for (let i = 0; i < this.bsp.lightmapData.length; i++) {
            const lightmapData = this.bsp.lightmapData[i];
            this.lightmapUpdaters[i] = lightmapData ? new FaceLightmapUpdater(lightmapData) : null;
        }

        // Spawn entities.
        this.entitySystem.createAndSpawnEntities(this.bsp.entities);

        // Spawn static objects.
        if (this.bsp.staticObjects !== null)
            for (const staticProp of this.bsp.staticObjects.staticProps)
                this.staticPropRenderers.push(new StaticPropRenderer(renderContext, this, staticProp));

        // Spawn detail objects.
        if (this.bsp.detailObjects !== null) {
            const detailMaterial = this.getWorldSpawn().detailMaterial;
            for (const leaf of this.bsp.detailObjects.leafDetailModels.keys())
                this.detailPropLeafRenderers.push(new DetailPropLeafRenderer(renderContext, bsp, leaf, detailMaterial));
        }
    }

    public getWorldSpawn(): worldspawn {
        return assertExists(this.entitySystem.findEntityByType(worldspawn));
    }

    public getSkyCamera(): sky_camera | null {
        return this.entitySystem.findEntityByType(sky_camera);
    }

    public movement(renderContext: SourceRenderContext): void {
        this.entitySystem.movement(renderContext);

        for (let i = 0; i < this.models.length; i++)
            this.models[i].movement(renderContext);
        for (let i = 0; i < this.detailPropLeafRenderers.length; i++)
            this.detailPropLeafRenderers[i].movement(renderContext);
        for (let i = 0; i < this.staticPropRenderers.length; i++)
            this.staticPropRenderers[i].movement(renderContext);
    }

    public gatherLiveSets(liveFaceSet: Set<number> | null, liveLeafSet: Set<number> | null, view: SourceEngineView, nodeid: number = 0, modelMatrix: ReadonlyMat4 | null = null): void {
        if (nodeid >= 0) {
            // node
            const node = this.bsp.nodelist[nodeid];

            if (!view.frustum.contains(transformAABB(node.bbox, modelMatrix)))
                return;

            this.gatherLiveSets(liveFaceSet, liveLeafSet, view, node.child0, modelMatrix);
            this.gatherLiveSets(liveFaceSet, liveLeafSet, view, node.child1, modelMatrix);

            // Node surfaces are func_detail meshes, but they appear to also be in leaves... we probably don't need them.
        } else {
            // leaf
            const leafnum = -nodeid - 1;
            const leaf = this.bsp.leaflist[leafnum];

            if (!view.pvs.getBit(leaf.cluster))
                return;

            if (!view.frustum.contains(transformAABB(leaf.bbox, modelMatrix)))
                return;

            if (liveFaceSet !== null)
                for (let i = 0; i < leaf.faces.length; i++)
                    liveFaceSet.add(leaf.faces[i]);

            if (liveLeafSet !== null)
                liveLeafSet.add(leafnum);
        }
    }

    public prepareToRenderView(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, kinds: RenderObjectKind = RenderObjectKind.WorldSpawn | RenderObjectKind.StaticProps | RenderObjectKind.DetailProps | RenderObjectKind.Entities): void {
        const template = renderInstManager.pushTemplate();
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);

        fillSceneParamsOnRenderInst(template, renderContext.currentView, renderContext.toneMapParams);

        // Render the world-spawn model.
        if (!!(kinds & RenderObjectKind.WorldSpawn)) {
            this.liveSurfaceSet.clear();
            this.liveFaceSet.clear();
            this.liveLeafSet.clear();

            const worldModel = this.models[0];
            if (worldModel.checkFrustum(renderContext)) {
                assert(worldModel.model.headnode === 0);
                assert(worldModel.modelMatrix === null);
                this.gatherLiveSets(this.liveFaceSet, this.liveLeafSet, renderContext.currentView);

                for (const faceIdx of this.liveFaceSet.values()) {
                    const lightmapUpdater = this.lightmapUpdaters[faceIdx];
                    if (lightmapUpdater !== null) {
                        lightmapUpdater.update(renderContext);
                        lightmapUpdater.buildLightmap(renderContext, this.startLightmapPageIndex);
                    }

                    const faceInfo = this.bsp.faceInfos[faceIdx];
                    if (faceInfo.surfaceIndex >= 0)
                        this.liveSurfaceSet.add(faceInfo.surfaceIndex);

                    for (let i = 0; i < faceInfo.overlaySurfaces.length; i++)
                        this.liveSurfaceSet.add(faceInfo.overlaySurfaces[i]);
                }

                for (const surfaceIdx of this.liveSurfaceSet.values())
                    worldModel.surfacesByIdx[surfaceIdx].prepareToRender(renderContext, renderInstManager, worldModel.modelMatrix);

                // Detail props.
                if (!!(kinds & RenderObjectKind.DetailProps)) {
                    for (let i = 0; i < this.detailPropLeafRenderers.length; i++) {
                        const detailPropLeafRenderer = this.detailPropLeafRenderers[i];
                        if (!this.liveLeafSet.has(detailPropLeafRenderer.leaf))
                            continue;
                        detailPropLeafRenderer.prepareToRender(renderContext, renderInstManager);
                    }
                }
            }
        }

        if (!!(kinds & RenderObjectKind.Entities)) {
            for (let i = 1; i < this.models.length; i++) {
                const bspModel = this.models[i];

                for (let j = 0; j < bspModel.surfaces.length; j++) {
                    const surface = bspModel.surfaces[j];
                    for (let k = 0; k < surface.surface.faceList.length; k++) {
                        const faceIdx = surface.surface.faceList[k];
                        
                        const lightmapUpdater = this.lightmapUpdaters[faceIdx];
                        if (lightmapUpdater !== null) {
                            lightmapUpdater.update(renderContext);
                            lightmapUpdater.buildLightmap(renderContext, this.startLightmapPageIndex);
                        }
                    }
                }

                bspModel.prepareToRenderModel(renderContext, renderInstManager);
            }

            for (let i = 0; i < this.entitySystem.entities.length; i++) {
                const entity = this.entitySystem.entities[i];
                // Checks visible flags, frustum and PVS
                if (!entity.checkVisible(renderContext))
                    continue;
                entity.prepareToRender(renderContext, renderInstManager);
            }
        }

        if (!!(kinds & RenderObjectKind.StaticProps))
            for (let i = 0; i < this.staticPropRenderers.length; i++)
                this.staticPropRenderers[i].prepareToRender(renderContext, renderInstManager);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);

        for (let i = 0; i < this.detailPropLeafRenderers.length; i++)
            this.detailPropLeafRenderers[i].destroy(device);
        for (let i = 0; i < this.staticPropRenderers.length; i++)
            this.staticPropRenderers[i].destroy(device);
        this.entitySystem.destroy(device);
    }
}

export class SourceColorCorrection {
    private lutData: Uint8Array;
    private gfxTexture: GfxTexture;
    private gfxSampler: GfxSampler;
    private dirty: boolean = true;
    private enabled: boolean = true;
    private size: number = 32;

    private layers: Uint8Array[] = [];
    private weights: number[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const width = this.size, height = this.size, depth = this.size;

        this.lutData = new Uint8Array(width * height * depth * 4);
        this.gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n3D,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width, height, depthOrArrayLayers: depth, numLevels: 1, usage: GfxTextureUsage.Sampled,
        });

        this.gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });

        this.prepareToRender(device);
    }

    public addLayer(layer: Uint8Array): void {
        assert(this.size === 32);
        assert(layer.length >= 32*32*32*3);
        this.layers.push(layer);
        this.weights.push(1.0);
        this.dirty = true;
    }

    public removeLayer(layer: Uint8Array): void {
        arrayRemove(this.layers, layer);
    }

    public setLayerWeight(layer: Uint8Array, weight: number): void {
        const idx = this.layers.indexOf(layer);
        assert(idx >= 0);

        if (this.weights[idx] === weight)
            return;

        this.weights[idx] = weight;
        this.dirty = true;
    }

    public fillTextureMapping(m: TextureMapping): void {
        m.gfxTexture = this.gfxTexture;
        m.gfxSampler = this.gfxSampler;
    }

    private computeLUTPixel(dst: Uint8Array, defaultWeight: number, weights: number[], size: number, x: number, y: number, z: number): void {
        const ratio = 0xFF / (size - 1);

        const dstPx = ((((z*size)+y)*size)+x)*4;
        const lutPx = ((((z*size)+y)*size)+x)*3;

        let r = (x * ratio) * defaultWeight;
        let g = (y * ratio) * defaultWeight;
        let b = (z * ratio) * defaultWeight;

        // Add up each LUT.
        for (let i = 0; i < weights.length; i++) {
            const lut = this.layers[i], weight = weights[i];
            r += lut[lutPx+0] * weight;
            g += lut[lutPx+1] * weight;
            b += lut[lutPx+2] * weight;
        }

        dst[dstPx+0] = r;
        dst[dstPx+1] = g;
        dst[dstPx+2] = b;
        dst[dstPx+3] = 0xFF;
    }

    public setEnabled(v: boolean): void {
        // For debugging.
        this.enabled = v;
        this.dirty = true;
    }

    public prepareToRender(device: GfxDevice): void {
        if (!this.dirty)
            return;

        // Normalize our weights.
        let weights = this.weights.slice();
        if (!this.enabled)
            weights.length = 0;
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let defaultWeight: number;
        if (totalWeight < 1.0) {
            defaultWeight = 1.0 - totalWeight;
            // weights are fine as-is
        } else {
            defaultWeight = 0.0;
            weights = weights.map((v) => v / totalWeight);
        }

        const dst = this.lutData, size = this.size;
        for (let z = 0; z < size; z++)
            for (let y = 0; y < size; y++)
                for (let x = 0; x < size; x++)
                    this.computeLUTPixel(dst, defaultWeight, weights, size, x, y, z);

        device.uploadTextureData(this.gfxTexture, 0, [this.lutData]);
        this.dirty = false;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

class DebugStatistics {
    public lightmapsBuilt = 0;

    public reset(): void {
        this.lightmapsBuilt = 0;
    }

    public addToConsole(viewerInput: ViewerRenderInput): void {
        viewerInput.debugConsole.addInfoLine(`Lightmaps Built: ${this.lightmapsBuilt}`);
    }
}

export class ProjectedLightRenderer {
    public light = new ProjectedLight();
    public debugName: string = 'ProjectedLight';
    public outputDepthTargetID: GfxrRenderTargetID | null = null;
    public outputDepthTextureID: GfxrResolveTextureID | null = null;
    public enabled = false;

    public preparePasses(renderer: SourceRenderer): void {
        if (this.enabled)
            return;

        this.enabled = true;

        const renderContext = renderer.renderContext;
        renderContext.currentView = this.light.frustumView;
        const renderInstManager = renderer.renderHelper.renderInstManager;

        for (let i = 0; i < renderer.bspRenderers.length; i++) {
            const bspRenderer = renderer.bspRenderers[i];

            if (!this.light.frustumView.calcPVS(bspRenderer.bsp, false))
                continue;

            bspRenderer.prepareToRenderView(renderContext, renderInstManager);
        }

        renderContext.currentView = null!;
    }

    public pushPasses(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder): void {
        if (this.outputDepthTargetID !== null)
            return;

        assert(this.enabled);
        const depthTargetDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
        depthTargetDesc.setDimensions(renderContext.shadowMapSize, renderContext.shadowMapSize, 1);
        depthTargetDesc.clearDepth = standardFullClearRenderPassDescriptor.clearDepth;

        const depthTargetID = builder.createRenderTargetID(depthTargetDesc, `Projected Texture Depth - ${this.debugName}`);

        builder.pushPass((pass) => {
            pass.setDebugName(`Projected Texture Depth - ${this.debugName}`);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, depthTargetID);

            pass.exec((passRenderer) => {
                this.light.frustumView.mainList.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        this.outputDepthTargetID = depthTargetID;
        this.outputDepthTextureID = builder.resolveRenderTarget(depthTargetID);
    }

    public reset(): void {
        this.enabled = false;
        this.light.frustumView.reset();
        this.outputDepthTargetID = null;
        this.outputDepthTextureID = null;
    }
}

class Flashlight {
    public projectedLightRenderer = new ProjectedLightRenderer();
    public enabled = false;
    @dfShow()
    @dfRange(30, 170)
    private fovY = 90;
    @dfShow()
    @dfRange(0, 10)
    private nearZ = 5;
    @dfShow()
    @dfRange(-100, 100)
    private offset = vec3.fromValues(0, 0, -10);
    @dfShow()
    @dfRange(0.1, 10.0)
    private aspect = 1.0;
    @dfShow()
    @dfRange(0.01, 30.0)
    private speed = 10.0;

    private currentAngle = quat.create();

    constructor(renderContext: SourceRenderContext) {
        this.fetchTexture(renderContext, 'effects/flashlight001');
        this.projectedLightRenderer.light.farZ = 1000;
    }

    public reset(renderContext: SourceRenderContext): void {
        const worldFromViewMatrix = renderContext.currentView.worldFromViewMatrix;
        mat4.getRotation(this.currentAngle, worldFromViewMatrix);
    }

    public isReady(): boolean {
        return this.projectedLightRenderer.light.texture !== null;
    }

    private async fetchTexture(renderContext: SourceRenderContext, textureName: string) {
        const materialCache = renderContext.materialCache;
        this.projectedLightRenderer.light.texture = await materialCache.fetchVTF(textureName, true);
    }

    private updateFrustumView(renderContext: SourceRenderContext): void {
        const worldFromViewMatrix = renderContext.currentView.worldFromViewMatrix;

        mat4.getTranslation(scratchVec3, worldFromViewMatrix);
        mat4.getRotation(scratchQuat, worldFromViewMatrix);
        quat.slerp(this.currentAngle, this.currentAngle, scratchQuat, renderContext.globalDeltaTime * this.speed);

        const frustumView = this.projectedLightRenderer.light.frustumView;
        mat4.fromRotationTranslation(frustumView.worldFromViewMatrix, this.currentAngle, scratchVec3);

        // Move the flashlight in front of us a bit to provide a bit of cool perspective...
        mat4.translate(frustumView.worldFromViewMatrix, frustumView.worldFromViewMatrix, this.offset);
        mat4.invert(frustumView.viewFromWorldMatrix, frustumView.worldFromViewMatrix);

        calcFrustumViewProjection(frustumView, renderContext, this.fovY, this.aspect, this.nearZ, this.projectedLightRenderer.light.farZ);
    }

    public movement(renderContext: SourceRenderContext): void {
        this.updateFrustumView(renderContext);
        this.projectedLightRenderer.reset();
    }
}

export class SourceLoadContext {
    public entityFactoryRegistry = new EntityFactoryRegistry();
    public bspFileVariant = BSPFileVariant.Default;

    constructor(public filesystem: SourceFileSystem) {
    }
}

export class SourceRenderContext {
    public entityFactoryRegistry: EntityFactoryRegistry;
    public filesystem: SourceFileSystem;
    public lightmapManager: LightmapManager;
    public studioModelCache: StudioModelCache;
    public materialCache: MaterialCache;
    public worldLightingState = new WorldLightingState();
    public globalTime: number = 0;
    public globalDeltaTime: number = 0;
    public materialProxySystem = new MaterialProxySystem();
    public cheapWaterStartDistance = 0.0;
    public cheapWaterEndDistance = 0.1;
    public currentViewRenderer: SourceWorldViewRenderer | null = null;
    public currentView: SourceEngineView;
    public colorCorrection: SourceColorCorrection;
    public toneMapParams = new ToneMapParams();
    public renderCache: GfxRenderCache;
    public currentPointCamera: point_camera | null = null;
    public currentShake: env_shake | null = null;

    // Public settings
    public enableFog = true;
    public enableBloom = true;
    public enableAutoExposure = true;
    public enableExpensiveWater = true;
    public enableCamera = true;
    public showToolMaterials = false;
    public showTriggerDebug = false;
    public showDecalMaterials = true;
    public shadowMapSize = 512;

    public debugStatistics = new DebugStatistics();

    constructor(public device: GfxDevice, loadContext: SourceLoadContext) {
        this.entityFactoryRegistry = loadContext.entityFactoryRegistry;
        this.filesystem = loadContext.filesystem;

        this.renderCache = new GfxRenderCache(device);
        this.lightmapManager = new LightmapManager(device, this.renderCache);
        this.materialCache = new MaterialCache(device, this.renderCache, this.filesystem);
        this.studioModelCache = new StudioModelCache(this, this.filesystem);
        this.colorCorrection = new SourceColorCorrection(device, this.renderCache);

        if (!this.device.queryLimits().occlusionQueriesRecommended) {
            // Disable auto-exposure system on backends where we shouldn't use occlusion queries.
            // TODO(jstpierre): We should be able to do system with compute shaders instead of
            // occlusion queries on WebGPU, once that's more widely deployed.
            this.enableAutoExposure = false;
        }
    }

    public crossedTime(time: number): boolean {
        const oldTime = this.globalTime - this.globalDeltaTime;
        return (time >= oldTime) && (time < this.globalTime);
    }

    public crossedRepeatTime(start: number, interval: number): boolean {
        if (this.globalTime <= start)
            return false;

        const base = start + (((this.globalTime - start) / interval) | 0) * interval;
        return this.crossedTime(base);
    }

    public isUsingHDR(): boolean {
        return this.materialCache.isUsingHDR();
    }

    public destroy(device: GfxDevice): void {
        this.renderCache.destroy();
        this.lightmapManager.destroy(device);
        this.materialCache.destroy(device);
        this.studioModelCache.destroy(device);
        this.colorCorrection.destroy(device);
    }
}

// Renders the entire world (2D skybox, 3D skybox, etc.) given a specific camera location.
// It's distinct from a view, which is camera settings, which there can be multiple of in a world renderer view.
export class SourceWorldViewRenderer {
    public drawSkybox2D = true;
    public drawSkybox3D = true;
    public drawIndirect = true;
    public drawWorld = true;
    public drawProjectedShadows = true;
    public renderObjectMask = RenderObjectKind.WorldSpawn | RenderObjectKind.StaticProps | RenderObjectKind.DetailProps | RenderObjectKind.Entities;
    public pvsEnabled = true;
    public pvsFallback = true;

    public mainView = new SourceEngineView();
    public skyboxView = new SourceEngineView();
    public enabled = false;

    public currentProjectedLightRenderer: ProjectedLightRenderer | null = null;
    public outputColorTargetID: GfxrRenderTargetID | null = null;
    public outputColorTextureID: GfxrResolveTextureID | null = null;

    public flashlight: Flashlight | null = null;

    constructor(public name: string, viewType: SourceEngineViewType) {
        this.mainView.viewType = viewType;
        this.skyboxView.viewType = viewType;
    }

    private calcProjectedLight(renderer: SourceRenderer): void {
        this.currentProjectedLightRenderer = null;

        if (!this.drawProjectedShadows)
            return;

        let bestDistance = Infinity;
        let bestProjectedLight: ProjectedLightRenderer | null = null;

        for (let i = 0; i < renderer.bspRenderers.length; i++) {
            const bspRenderer = renderer.bspRenderers[i];
            let projectedLight: env_projectedtexture | null = null;
            while (projectedLight = bspRenderer.entitySystem.findEntityByType<env_projectedtexture>(env_projectedtexture, projectedLight)) {
                if (!projectedLight.shouldDraw())
                    continue;

                projectedLight.getAbsOrigin(scratchVec3);
                const dist = vec3.squaredDistance(this.mainView.cameraPos, scratchVec3);
                if (dist < bestDistance) {
                    bestDistance = dist;
                    bestProjectedLight = projectedLight.projectedLightRenderer;
                }
            }
        }

        const renderContext = renderer.renderContext;
        if (bestProjectedLight === null && this.flashlight !== null && this.flashlight.enabled) {
            renderContext.currentView = this.mainView;
            this.flashlight.movement(renderContext);
            renderContext.currentView = null!;
            if (this.flashlight.isReady())
                bestProjectedLight = this.flashlight.projectedLightRenderer;
        }

        this.currentProjectedLightRenderer = bestProjectedLight;
    }

    public prepareToRender(renderer: SourceRenderer, parentViewRenderer: SourceWorldViewRenderer | null): void {
        if (this.enabled)
            return;

        this.enabled = true;
        const renderContext = renderer.renderContext, renderInstManager = renderer.renderHelper.renderInstManager;

        this.skyboxView.copy(this.mainView);

        // Position the 2D skybox around the main view.
        mat4.fromTranslation(scratchMatrix, this.mainView.cameraPos);
        mat4.mul(this.skyboxView.viewFromWorldMatrix, this.skyboxView.viewFromWorldMatrix, scratchMatrix);
        this.skyboxView.finishSetup();

        this.calcProjectedLight(renderer);

        if (this.currentProjectedLightRenderer !== null)
            this.currentProjectedLightRenderer.preparePasses(renderer);

        renderContext.currentViewRenderer = this;
        renderContext.currentView = this.skyboxView;

        if (this.drawSkybox2D && renderer.skyboxRenderer !== null)
            renderer.skyboxRenderer.prepareToRender(renderContext, renderInstManager, this.skyboxView);

        if (this.drawSkybox3D) {
            for (let i = 0; i < renderer.bspRenderers.length; i++) {
                const bspRenderer = renderer.bspRenderers[i];

                // Draw the skybox by positioning us inside the skybox area.
                const skyCamera = bspRenderer.getSkyCamera();
                if (skyCamera === null)
                    continue;

                this.skyboxView.copy(this.mainView);
                mat4.mul(this.skyboxView.viewFromWorldMatrix, this.skyboxView.viewFromWorldMatrix, skyCamera.modelMatrix);
                this.skyboxView.finishSetup();

                skyCamera.fillFogParams(this.skyboxView.fogParams);

                // If our skybox is not in a useful spot, then don't render it.
                if (!this.skyboxView.calcPVS(bspRenderer.bsp, false, parentViewRenderer !== null ? parentViewRenderer.skyboxView : null))
                    continue;

                // TODO(jstpierre): Re-enable entities inside the skybox once we know how to cull them.
                bspRenderer.prepareToRenderView(renderContext, renderInstManager, this.renderObjectMask & (RenderObjectKind.WorldSpawn | RenderObjectKind.StaticProps));
            }
        }

        if (this.drawWorld) {
            renderContext.currentView = this.mainView;

            for (let i = 0; i < renderer.bspRenderers.length; i++) {
                const bspRenderer = renderer.bspRenderers[i];

                if (!this.mainView.calcPVS(bspRenderer.bsp, this.pvsFallback, parentViewRenderer !== null ? parentViewRenderer.mainView : null))
                    continue;

                // Calculate our fog parameters from the local player's fog controller.
                const localPlayer = bspRenderer.entitySystem.getLocalPlayer();
                if (localPlayer.currentFogController !== null && renderer.renderContext.enableFog)
                    localPlayer.currentFogController.fillFogParams(this.mainView.fogParams);
                else
                    this.mainView.fogParams.maxdensity = 0.0;

                bspRenderer.prepareToRenderView(renderContext, renderInstManager, this.renderObjectMask);
            }
        }

        renderContext.currentView = null!;
    }

    private lateBindTextureAttachPass(renderContext: SourceRenderContext, builder: GfxrGraphBuilder, pass: GfxrPass): void {
        if (renderContext.currentPointCamera !== null && renderContext.currentPointCamera.viewRenderer !== this)
            pass.attachResolveTexture(renderContext.currentPointCamera.viewRenderer.resolveColorTarget(builder));
        if (this.currentProjectedLightRenderer !== null)
            pass.attachResolveTexture(this.currentProjectedLightRenderer.outputDepthTextureID!);
    }

    private lateBindTextureSetOnPassRenderer(renderer: SourceRenderer, scope: GfxrPassScope): void {
        const renderContext = renderer.renderContext, staticResources = renderContext.materialCache.staticResources;
        if (renderContext.currentPointCamera !== null && renderContext.currentPointCamera.viewRenderer !== this)
            renderer.setLateBindingTexture(LateBindingTexture.Camera, scope.getResolveTextureForID(renderContext.currentPointCamera.viewRenderer.outputColorTextureID!), staticResources.linearRepeatSampler);
        if (this.currentProjectedLightRenderer !== null)
            renderer.setLateBindingTexture(LateBindingTexture.ProjectedLightDepth, scope.getResolveTextureForID(this.currentProjectedLightRenderer.outputDepthTextureID!), staticResources.shadowSampler);
    }

    public pushPasses(renderer: SourceRenderer, builder: GfxrGraphBuilder, renderTargetDesc: GfxrRenderTargetDescription): void {
        assert(this.enabled);
        if (this.outputColorTextureID !== null)
            return;

        const renderContext = renderer.renderContext, staticResources = renderContext.materialCache.staticResources;

        if (this.currentProjectedLightRenderer !== null)
            this.currentProjectedLightRenderer.pushPasses(renderContext, renderer.renderHelper.renderInstManager, builder);

        const mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        mainColorDesc.copyDimensions(renderTargetDesc);
        mainColorDesc.clearColor = standardFullClearRenderPassDescriptor.clearColor;

        const mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
        mainDepthDesc.copyDimensions(mainColorDesc);
        mainDepthDesc.clearDepth = standardFullClearRenderPassDescriptor.clearDepth;

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, `${this.name} - Main Color (sRGB)`);

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, `${this.name} - Skybox Depth`);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);

            pass.exec((passRenderer) => {
                renderer.executeOnPass(passRenderer, this.skyboxView.mainList);
                renderer.executeOnPass(passRenderer, this.skyboxView.translucentList);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, `${this.name} - Main Depth`);

        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            this.lateBindTextureAttachPass(renderContext, builder, pass);

            pass.exec((passRenderer, scope) => {
                this.lateBindTextureSetOnPassRenderer(renderer, scope);
                renderer.executeOnPass(passRenderer, this.mainView.mainList);
            });
        });
        builder.pushDebugThumbnail(mainColorTargetID);

        if (this.drawIndirect && this.mainView.indirectList.renderInsts.length > 0) {
            builder.pushPass((pass) => {
                pass.setDebugName('Indirect');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(mainColorResolveTextureID);

                const mainDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
                pass.attachResolveTexture(mainDepthResolveTextureID);

                let reflectColorResolveTextureID: GfxrResolveTextureID | null = null;
                if (renderer.reflectViewRenderer.outputColorTargetID !== null) {
                    reflectColorResolveTextureID = builder.resolveRenderTarget(renderer.reflectViewRenderer.outputColorTargetID);
                    pass.attachResolveTexture(reflectColorResolveTextureID);
                }

                this.lateBindTextureAttachPass(renderContext, builder, pass);

                pass.exec((passRenderer, scope) => {
                    renderer.setLateBindingTexture(LateBindingTexture.FramebufferColor, scope.getResolveTextureForID(mainColorResolveTextureID), staticResources.linearClampSampler);
                    renderer.setLateBindingTexture(LateBindingTexture.FramebufferDepth, scope.getResolveTextureForID(mainDepthResolveTextureID), staticResources.pointClampSampler);

                    const reflectColorTexture = reflectColorResolveTextureID !== null ? scope.getResolveTextureForID(reflectColorResolveTextureID) : staticResources.opaqueBlackTexture2D;
                    renderer.setLateBindingTexture(LateBindingTexture.WaterReflection, reflectColorTexture, staticResources.linearClampSampler);

                    this.lateBindTextureSetOnPassRenderer(renderer, scope);

                    renderer.executeOnPass(passRenderer, this.mainView.indirectList);
                });
            });
            builder.pushDebugThumbnail(mainColorTargetID);
        }

        if (this.mainView.translucentList.renderInsts.length > 0) {
            builder.pushPass((pass) => {
                pass.setDebugName('Translucent');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                this.lateBindTextureAttachPass(renderContext, builder, pass);

                pass.exec((passRenderer, scope) => {
                    this.lateBindTextureSetOnPassRenderer(renderer, scope);
                    renderer.executeOnPass(passRenderer, this.mainView.translucentList);
                });
            });
        }
        builder.pushDebugThumbnail(mainColorTargetID, `${this.name}\nFinal Output`);

        this.outputColorTargetID = mainColorTargetID;
        this.outputColorTextureID = null;
    }

    public resolveColorTarget(builder: GfxrGraphBuilder): GfxrResolveTextureID {
        if (this.outputColorTextureID === null)
            this.outputColorTextureID = builder.resolveRenderTarget(assertExists(this.outputColorTargetID));

        return this.outputColorTextureID;
    }

    public reset(): void {
        this.mainView.reset();
        this.skyboxView.reset();
        this.enabled = false;
        this.outputColorTargetID = null;
        this.outputColorTextureID = null;
    }
}

const scratchVec3 = vec3.create();
const scratchVec4a = vec4.create(), scratchVec4b = vec4.create();
const scratchQuat = quat.create();
const scratchMatrix = mat4.create();
const scratchPlane = new Plane();

// http://www.terathon.com/code/oblique.html
// Plane here needs to be in view-space.
function modifyProjectionMatrixForObliqueClipping(m: mat4, plane: Plane, clipSpaceNearZ: GfxClipSpaceNearZ): void {
    // Convert back to "standard OpenGL" clip space.
    projectionMatrixConvertClipSpaceNearZ(m, GfxClipSpaceNearZ.NegativeOne, clipSpaceNearZ);
    projectionMatrixReverseDepth(m);

    vec4.set(scratchVec4a, Math.sign(plane.n[0]), Math.sign(plane.n[1]), 1.0, 1.0);
    mat4.invert(scratchMatrix, m);
    vec4.transformMat4(scratchVec4a, scratchVec4a, scratchMatrix);

    plane.getVec4v(scratchVec4b);
    vec4.scale(scratchVec4b, scratchVec4b, 2.0 / vec4.dot(scratchVec4b, scratchVec4a));
    m[2]  = scratchVec4b[0] - m[3];
    m[6]  = scratchVec4b[1] - m[7];
    m[10] = scratchVec4b[2] - m[11];
    m[14] = scratchVec4b[3] - m[15];

    // Convert back to "device space"
    projectionMatrixReverseDepth(m);
    projectionMatrixConvertClipSpaceNearZ(m, clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);
}

const bindingLayoutsPost: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 0, numSamplers: 3, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n3D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
    ] },
];

class FullscreenPostProgram extends DeviceProgram {
    public override both = `
precision mediump float;
precision lowp sampler3D;

uniform sampler2D u_FramebufferColor;
uniform sampler3D u_ColorCorrectTexture;
uniform sampler2D u_BloomColor;
`;
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = `
in vec2 v_TexCoord;

void main() {
    vec4 t_Color = texture(SAMPLER_2D(u_FramebufferColor), v_TexCoord);
    t_Color.rgb = pow(t_Color.rgb, vec3(1.0 / 2.2));

#ifdef USE_BLOOM
    t_Color.rgb += texture(SAMPLER_2D(u_BloomColor), v_TexCoord).rgb;
#endif

    vec3 t_Size = vec3(textureSize(TEXTURE(u_ColorCorrectTexture), 0));
    vec3 t_TexCoord = t_Color.rgb * ((t_Size - 1.0) / t_Size) + (0.5 / t_Size);
    t_Color.rgb = texture(SAMPLER_3D(u_ColorCorrectTexture), t_TexCoord).rgb;

    gl_FragColor = t_Color;
}
`;

    constructor(useBloom: boolean) {
        super();
        this.setDefineBool('USE_BLOOM', useBloom);
    }
}

const bindingLayoutsBloom: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 1, },
];

class BloomDownsampleProgram extends DeviceProgram {
    public override both = `
layout(std140) uniform ub_Params {
    vec4 u_Misc[2];
};

#define u_BloomTint (u_Misc[0].rgb)
#define u_BloomExp  (u_Misc[0].a)
`;

    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = `
uniform sampler2D u_FramebufferColor;
in vec2 v_TexCoord;

vec3 LinearToGamma(in vec3 t_Sample) {
    return pow(t_Sample.rgb, vec3(1.0 / 2.2));
}

void main() {
    // 4 taps, since we're going directly to a 1/4 FB.
    //
    //   Orig        NW          NE         SW        SE
    // _________  _________  _________  _________  _________
    // |_|_|_|_|  |\|/|_|_|  |_|_|\|/|  |_|_|_|_|  |_|_|_|_|
    // |_|\|/|_|  |/|\|_|_|  |_|_|/|\|  |_|_|_|_|  |_|_|_|_|
    // |_|/|\|_|  |_|_|_|_|  |_|_|_|_|  |\|/|_|_|  |_|_|\|/|
    // |_|_|_|_|  |_|_|_|_|  |_|_|_|_|  |/|\|_|_|  |_|_|/|\|
    //
    // v_TexCoord.xy is located at the center of the first X. We want to use bilinear filtering
    // to blend the four pixels in the top left, top right, bottom left, bottom right, etc.

    vec4 nw = textureOffset(SAMPLER_2D(u_FramebufferColor), v_TexCoord.xy, ivec2(-1, -1));
    vec4 ne = textureOffset(SAMPLER_2D(u_FramebufferColor), v_TexCoord.xy, ivec2(1, -1));
    vec4 sw = textureOffset(SAMPLER_2D(u_FramebufferColor), v_TexCoord.xy, ivec2(-1, 1));
    vec4 se = textureOffset(SAMPLER_2D(u_FramebufferColor), v_TexCoord.xy, ivec2(1, 1));

    // Blend should happen in gamma space. Unfortunately, this is done before color correction / gamma,
    // so we need to undo the sRGB-to-linear conversion done by the sampler.
    nw.rgb = LinearToGamma(nw.rgb);
    ne.rgb = LinearToGamma(ne.rgb);
    sw.rgb = LinearToGamma(sw.rgb);
    se.rgb = LinearToGamma(se.rgb);
    vec3 color = (nw.rgb + ne.rgb + sw.rgb + se.rgb) / 4.0;

    // Apply tint & exp (maybe should be in cbuffer?)
    color = pow(color.rgb, vec3(u_BloomExp)) * dot(color.rgb, u_BloomTint);

    gl_FragColor.rgba = vec4(color.rgb, 1.0);
}    
`;
}

class BloomBlurProgram extends DeviceProgram {
    public override both = `
layout(std140) uniform ub_Params {
    vec4 u_Misc[2];
};

#define u_BloomScale (u_Misc[1].x)
`;

    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = `
uniform sampler2D u_FramebufferColor;
in vec2 v_TexCoord;

vec3 Tap(float t_TapWidth) {
    vec2 t_InvResolution = 1.0 / vec2(textureSize(TEXTURE(u_FramebufferColor), 0));

    vec2 t_TapCoord0 = v_TexCoord.xy;
    vec2 t_TapCoord1 = v_TexCoord.xy;
#ifdef BLUR_Y
    t_TapCoord0.y -= t_TapWidth * t_InvResolution.y;
    t_TapCoord1.y += t_TapWidth * t_InvResolution.y;
#else
    t_TapCoord0.x -= t_TapWidth * t_InvResolution.x;
    t_TapCoord1.x += t_TapWidth * t_InvResolution.x;
#endif

    vec3 t_Sample0 = texture(SAMPLER_2D(u_FramebufferColor), t_TapCoord0.xy).rgb;
    vec3 t_Sample1 = texture(SAMPLER_2D(u_FramebufferColor), t_TapCoord1.xy).rgb;
    return (t_Sample0.rgb + t_Sample1.rgb);
}

void main() {
    vec3 t_Accum = texture(SAMPLER_2D(u_FramebufferColor), v_TexCoord).rgb * 0.2013;
    t_Accum += Tap(1.3366) * 0.2185;
    t_Accum += Tap(3.4295) * 0.0821;
    t_Accum += Tap(5.4264) * 0.0461;
    t_Accum += Tap(7.4359) * 0.0262;
    t_Accum += Tap(9.4436) * 0.0162;
    t_Accum += Tap(11.4401) * 0.0102;

#ifdef BLUR_Y
    t_Accum *= u_BloomScale;
#endif

    gl_FragColor.rgba = vec4(t_Accum.rgb, 1.0);
}
`;

    constructor(y: boolean) {
        super();
        this.setDefineBool('BLUR_Y', y);
    }
}

export class SourceRenderer implements SceneGfx {
    private luminanceHistogram: LuminanceHistogram;
    public renderHelper: GfxRenderHelper;
    public skyboxRenderer: SkyboxRenderer | null = null;
    public bspRenderers: BSPRenderer[] = [];

    private textureMapping = nArray(5, () => new TextureMapping());
    private bindingMapping: string[] = [LateBindingTexture.Camera, LateBindingTexture.FramebufferColor, LateBindingTexture.FramebufferDepth, LateBindingTexture.WaterReflection, LateBindingTexture.ProjectedLightDepth];

    public mainViewRenderer = new SourceWorldViewRenderer(`Main View`, SourceEngineViewType.MainView);
    public reflectViewRenderer = new SourceWorldViewRenderer(`Reflection View`, SourceEngineViewType.WaterReflectView);

    private bloomDownsampleProgram: GfxProgram;
    private bloomBlurXProgram: GfxProgram;
    private bloomBlurYProgram: GfxProgram;
    private fullscreenPostProgram: GfxProgram;
    private fullscreenPostProgramBloom: GfxProgram;

    constructor(private sceneContext: SceneContext, public renderContext: SourceRenderContext) {
        // Make the reflection view a bit cheaper.
        this.reflectViewRenderer.drawProjectedShadows = false;
        this.reflectViewRenderer.pvsFallback = false;
        this.reflectViewRenderer.renderObjectMask &= ~(RenderObjectKind.DetailProps);

        this.renderHelper = new GfxRenderHelper(renderContext.device, sceneContext, renderContext.renderCache);

        this.luminanceHistogram = new LuminanceHistogram(this.renderContext.renderCache);

        const cache = renderContext.renderCache;
        this.bloomDownsampleProgram = cache.createProgram(new BloomDownsampleProgram());
        this.bloomBlurXProgram = cache.createProgram(new BloomBlurProgram(false));
        this.bloomBlurYProgram = cache.createProgram(new BloomBlurProgram(true));
        this.fullscreenPostProgram = cache.createProgram(new FullscreenPostProgram(false));
        this.fullscreenPostProgramBloom = cache.createProgram(new FullscreenPostProgram(true));
    }

    private resetTextureMappings(): void {
        for (let i = 0; i < this.textureMapping.length; i++)
            this.textureMapping[i].reset();
    }

    public setLateBindingTexture(binding: LateBindingTexture, texture: GfxTexture, sampler: GfxSampler): void {
        const m = assertExists(this.textureMapping[this.bindingMapping.indexOf(binding)]);
        m.gfxTexture = texture;
        m.gfxSampler = sampler;
    }

    public executeOnPass(passRenderer: GfxRenderPass, list: GfxRenderInstList): void {
        const cache = this.renderContext.renderCache;
        for (let i = 0; i < this.bindingMapping.length; i++)
            list.resolveLateSamplerBinding(this.bindingMapping[i], this.textureMapping[i]);
        list.drawOnPassRenderer(cache, passRenderer);
    }

    private processInput(): void {
        if (this.sceneContext.inputManager.isKeyDownEventTriggered('KeyF')) {
            // happy birthday shigeru miyamoto
            if (this.mainViewRenderer.flashlight === null)
                this.mainViewRenderer.flashlight = new Flashlight(this.renderContext);

            const flashlight = this.mainViewRenderer.flashlight;
            flashlight.enabled = !flashlight.enabled;
            if (flashlight.enabled)
                flashlight.reset(this.renderContext);
        }
    }

    private movement(): void {
        // Update render context.

        // TODO(jstpierre): The world lighting state should probably be moved to the BSP? Or maybe SourceRenderContext is moved to the BSP...
        this.renderContext.worldLightingState.update(this.renderContext.globalTime);

        // Update BSP (includes entities).
        this.renderContext.currentView = this.mainViewRenderer.mainView;

        this.processInput();

        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.movement(this.renderContext);

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].movement(this.renderContext);

        this.renderContext.currentView = null!;
    }

    private resetViews(): void {
        this.mainViewRenderer.reset();
        this.reflectViewRenderer.reset();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1/20);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableFog = new UI.Checkbox('Enable Fog', true);
        enableFog.onchanged = () => {
            const v = enableFog.checked;
            this.renderContext.enableFog = v;
        };
        renderHacksPanel.contents.appendChild(enableFog.elem);
        const enableBloom = new UI.Checkbox('Enable Bloom', true);
        enableBloom.onchanged = () => {
            const v = enableBloom.checked;
            this.renderContext.enableBloom = v;
        };
        renderHacksPanel.contents.appendChild(enableBloom.elem);
        const enableAutoExposure = new UI.Checkbox('Enable Auto-Exposure', true);
        enableAutoExposure.onchanged = () => {
            const v = enableAutoExposure.checked;
            this.renderContext.enableAutoExposure = v;
            if (!v)
                this.renderContext.toneMapParams.toneMapScale = 1.0;
        };
        renderHacksPanel.contents.appendChild(enableAutoExposure.elem);
        const enableColorCorrection = new UI.Checkbox('Enable Color Correction', true);
        enableColorCorrection.onchanged = () => {
            const v = enableColorCorrection.checked;
            this.renderContext.colorCorrection.setEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableColorCorrection.elem);
        const enableExtensiveWater = new UI.Checkbox('Use Expensive Water', true);
        enableExtensiveWater.onchanged = () => {
            const v = enableExtensiveWater.checked;
            this.renderContext.enableExpensiveWater = v;
        };
        renderHacksPanel.contents.appendChild(enableExtensiveWater.elem);
        const showToolMaterials = new UI.Checkbox('Show Tool-only Materials', false);
        showToolMaterials.onchanged = () => {
            const v = showToolMaterials.checked;
            this.renderContext.showToolMaterials = v;
        };
        renderHacksPanel.contents.appendChild(showToolMaterials.elem);
        const showDecalMaterials = new UI.Checkbox('Show Decals', true);
        showDecalMaterials.onchanged = () => {
            const v = showDecalMaterials.checked;
            this.renderContext.showDecalMaterials = v;
        };
        renderHacksPanel.contents.appendChild(showDecalMaterials.elem);
        const showTriggerDebug = new UI.Checkbox('Show Trigger Debug', false);
        showTriggerDebug.onchanged = () => {
            const v = showTriggerDebug.checked;
            this.renderContext.showTriggerDebug = v;
        };
        renderHacksPanel.contents.appendChild(showTriggerDebug.elem);
        const showEntityDebug = new UI.Checkbox('Show Entity Debug', false);
        showEntityDebug.onchanged = () => {
            const v = showEntityDebug.checked;
            for (let i = 0; i < this.bspRenderers.length; i++) {
                const entityDebugger = this.bspRenderers[i].entitySystem.debugger;
                entityDebugger.capture = v;
                entityDebugger.draw = v;
            }
        };
        renderHacksPanel.contents.appendChild(showEntityDebug.elem);
        const showDebugThumbnails = new UI.Checkbox('Show Debug Thumbnails', false);
        showDebugThumbnails.onchanged = () => {
            const v = showDebugThumbnails.checked;
            this.renderHelper.debugThumbnails.enabled = v;
        };
        renderHacksPanel.contents.appendChild(showDebugThumbnails.elem);

        return [renderHacksPanel];
    }

    public prepareToRender(viewerInput: ViewerRenderInput): void {
        const renderContext = this.renderContext, device = renderContext.device;

        // globalTime is in seconds.
        renderContext.globalTime = viewerInput.time / 1000.0;
        renderContext.globalDeltaTime = viewerInput.deltaTime / 1000.0;
        renderContext.debugStatistics.reset();

        // Update the main view early, since that's what movement/entities will use
        this.mainViewRenderer.mainView.setupFromCamera(viewerInput.camera);
        if (renderContext.currentShake !== null)
            renderContext.currentShake.adjustView(this.mainViewRenderer.mainView);
        this.mainViewRenderer.mainView.finishSetup();

        renderContext.currentPointCamera = null;

        this.movement();

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back });
        template.setBindingLayouts(MaterialShaderTemplateBase.BindingLayouts);

        if (renderContext.currentPointCamera !== null)
            (renderContext.currentPointCamera as point_camera).preparePasses(this);

        this.mainViewRenderer.prepareToRender(this, null);

        // Reflection is only supported on the first BSP renderer (maybe we should just kill the concept of having multiple...)
        if (this.renderContext.enableExpensiveWater && this.mainViewRenderer.drawWorld) {
            const bspRenderer = this.bspRenderers[0], bsp = bspRenderer.bsp;
            bspRenderer.gatherLiveSets(null, bspRenderer.liveLeafSet, this.mainViewRenderer.mainView);
            const leafwater = bsp.findLeafWaterForPoint(this.mainViewRenderer.mainView.cameraPos, bspRenderer.liveLeafSet);
            if (leafwater !== null) {
                const waterZ = leafwater.surfaceZ;

                // Reflect around waterZ
                const cameraZ = this.mainViewRenderer.mainView.cameraPos[2];
                if (cameraZ > waterZ) {
                    // There's probably a much cleaner way to do this, tbh.
                    const reflectView = this.reflectViewRenderer.mainView;
                    reflectView.copy(this.mainViewRenderer.mainView);

                    // Flip the camera around the reflection plane.

                    // This is in Source space
                    computeModelMatrixS(scratchMatrix, 1, 1, -1);
                    mat4.mul(reflectView.worldFromViewMatrix, scratchMatrix, this.mainViewRenderer.mainView.worldFromViewMatrix);

                    // Flip the view upside-down so that when we invert later, the winding order comes out correct.
                    // This will mean we'll have to flip the texture in the shader though. Intentionally adding a Y-flip for once!

                    // This is in noclip space
                    computeModelMatrixS(scratchMatrix, 1, -1, 1);
                    mat4.mul(reflectView.worldFromViewMatrix, reflectView.worldFromViewMatrix, scratchMatrix);

                    const reflectionCameraZ = cameraZ - 2 * (cameraZ - waterZ);
                    reflectView.worldFromViewMatrix[14] = reflectionCameraZ;
                    mat4.invert(reflectView.viewFromWorldMatrix, reflectView.worldFromViewMatrix);

                    scratchPlane.set(Vec3UnitZ, -waterZ);
                    scratchPlane.transform(reflectView.viewFromWorldMatrix);
                    modifyProjectionMatrixForObliqueClipping(reflectView.clipFromViewMatrix, scratchPlane, viewerInput.camera.clipSpaceNearZ);

                    this.reflectViewRenderer.mainView.finishSetup();
                    this.reflectViewRenderer.prepareToRender(this, this.mainViewRenderer);
                }
            }
        }

        this.mainViewRenderer.mainView.useExpensiveWater = this.reflectViewRenderer.enabled;
        renderInstManager.popTemplate();

        // Update our lightmaps right before rendering.
        renderContext.lightmapManager.prepareToRender(device);
        renderContext.colorCorrection.prepareToRender(device);
    }

    private pushBloomPasses(builder: GfxrGraphBuilder, mainColorTargetID: GfxrRenderTargetID): GfxrRenderTargetID | null {
        if (!this.renderContext.enableBloom)
            return null;

        if (!this.renderContext.isUsingHDR())
            return null;

        const toneMapParams = this.renderContext.toneMapParams;
        let bloomScale = toneMapParams.bloomScale;
        if (bloomScale <= 0.0)
            return null;

        const renderInstManager = this.renderHelper.renderInstManager;
        const cache = this.renderContext.renderCache;
        const staticResources = this.renderContext.materialCache.staticResources;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts(bindingLayoutsBloom);
        renderInst.setVertexInput(null, null, null);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setDrawCount(3);

        let offs = renderInst.allocateUniformBuffer(0, 8);
        const d = renderInst.mapUniformBufferF32(0);
        offs += fillColor(d, offs, toneMapParams.bloomTint, toneMapParams.bloomExp);
        offs += fillVec4(d, offs, bloomScale);

        const mainColorTargetDesc = builder.getRenderTargetDescription(mainColorTargetID);

        const downsampleColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
        downsampleColorDesc.setDimensions(mainColorTargetDesc.width >>> 2, mainColorTargetDesc.height >>> 2, 1);
        const downsampleColorTargetID = builder.createRenderTargetID(downsampleColorDesc, 'Bloom Buffer');

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsampleColorTargetID);

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                this.resetTextureMappings();

                renderInst.setGfxProgram(this.bloomDownsampleProgram);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                this.textureMapping[0].gfxSampler = staticResources.linearClampSampler;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(downsampleColorTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur X');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsampleColorTargetID);

            const downsampleResolveTextureID = builder.resolveRenderTarget(downsampleColorTargetID);
            pass.attachResolveTexture(downsampleResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.bloomBlurXProgram);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsampleResolveTextureID);
                this.textureMapping[0].gfxSampler = staticResources.linearClampSampler;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(downsampleColorTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur Y');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsampleColorTargetID);

            const downsampleResolveTextureID = builder.resolveRenderTarget(downsampleColorTargetID);
            pass.attachResolveTexture(downsampleResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.bloomBlurYProgram);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsampleResolveTextureID);
                this.textureMapping[0].gfxSampler = staticResources.linearClampSampler;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(downsampleColorTargetID);

        return downsampleColorTargetID;
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const renderContext = this.renderContext, cache = renderContext.renderCache;
        const staticResources = renderContext.materialCache.staticResources;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.resetTextureMappings();

        this.prepareToRender(viewerInput);

        const mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        setBackbufferDescSimple(mainColorDesc, viewerInput);

        // Render the camera
        if (renderContext.currentPointCamera !== null)
            renderContext.currentPointCamera.pushPasses(this, builder, mainColorDesc);

        // Render reflection view first.
        if (this.reflectViewRenderer.enabled)
            this.reflectViewRenderer.pushPasses(this, builder, mainColorDesc);

        this.mainViewRenderer.pushPasses(this, builder, mainColorDesc);
        const mainColorTargetID = assertExists(this.mainViewRenderer.outputColorTargetID);

        this.renderHelper.pushTemplateRenderInst();

        if (this.renderContext.enableAutoExposure && this.renderContext.isUsingHDR()) {
            this.luminanceHistogram.pushPasses(renderInstManager, builder, mainColorTargetID);
            this.luminanceHistogram.updateToneMapParams(this.renderContext.toneMapParams, this.renderContext.globalDeltaTime);
            this.luminanceHistogram.debugDraw(this.renderContext, this.renderContext.toneMapParams);
        }

        const bloomColorTargetID = this.pushBloomPasses(builder, mainColorTargetID);
        renderInstManager.popTemplate();

        const mainColorGammaDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
        mainColorGammaDesc.copyDimensions(mainColorDesc);
        const mainColorGammaTargetID = builder.createRenderTargetID(mainColorGammaDesc, 'Main Color (Gamma)');

        builder.pushPass((pass) => {
            // Now do a fullscreen color-correction pass to output to our UNORM backbuffer.
            pass.setDebugName('Color Correction & Gamma Correction');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorGammaTargetID);

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            let postProgram = this.fullscreenPostProgram;
            let bloomResolveTextureID: GfxrResolveTextureID | null = null;
            if (bloomColorTargetID !== null) {
                bloomResolveTextureID = builder.resolveRenderTarget(bloomColorTargetID);
                pass.attachResolveTexture(bloomResolveTextureID);
                postProgram = this.fullscreenPostProgramBloom;
            }

            const postRenderInst = renderInstManager.newRenderInst();
            postRenderInst.setBindingLayouts(bindingLayoutsPost);
            postRenderInst.setVertexInput(null, null, null);
            postRenderInst.setGfxProgram(postProgram);
            postRenderInst.setMegaStateFlags(fullscreenMegaState);
            postRenderInst.setDrawCount(3);

            pass.exec((passRenderer, scope) => {
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                this.textureMapping[0].gfxSampler = staticResources.linearClampSampler;
                this.renderContext.colorCorrection.fillTextureMapping(this.textureMapping[1]);
                this.textureMapping[2].gfxTexture = bloomResolveTextureID !== null ? scope.getResolveTextureForID(bloomResolveTextureID) : null;
                this.textureMapping[2].gfxSampler = staticResources.linearClampSampler;
                postRenderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                postRenderInst.drawOnPass(cache, passRenderer);
            });
        });
        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorGammaTargetID, viewerInput.mouseLocation);

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorGammaTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorGammaTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);
        this.resetViews();

        this.renderContext.debugStatistics.addToConsole(viewerInput);
        const camPositionX = this.mainViewRenderer.mainView.cameraPos[0].toFixed(2), camPositionY = this.mainViewRenderer.mainView.cameraPos[1].toFixed(2), camPositionZ = this.mainViewRenderer.mainView.cameraPos[2].toFixed(2);
        viewerInput.debugConsole.addInfoLine(`Source Camera Pos: ${camPositionX} ${camPositionY} ${camPositionZ}`);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.renderContext.destroy(device);
        this.luminanceHistogram.destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
    }
}
