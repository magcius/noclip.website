
import { mat4, quat, ReadonlyMat4, ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import BitMap from "../BitMap";
import { Camera, CameraController, computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from "../Camera";
import { DataFetcher } from "../DataFetcher";
import { drawWorldSpaceAABB, getDebugOverlayCanvas2D } from "../DebugJunk";
import { AABB, Frustum, Plane } from "../Geometry";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { fillColor, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMipFilterMode, GfxRenderPass, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRendererLayer, GfxRenderInstList, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { clamp, computeModelMatrixS, getMatrixTranslation } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { SceneContext } from "../SceneBase";
import { TextureMapping } from "../TextureHolder";
import { arrayRemove, assert, assertExists, nArray } from "../util";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { ZipFile, decompressZipFileEntry, parseZipFile } from "../ZipFile";
import { AmbientCube, BSPFile, Model, Surface } from "./BSPFile";
import { BaseEntity, EntityFactoryRegistry, EntitySystem, sky_camera } from "./EntitySystem";
import { BaseMaterial, fillSceneParamsOnRenderInst, FogParams, LateBindingTexture, LightmapManager, MaterialCache, MaterialProgramBase, MaterialProxySystem, SurfaceLightmap, WorldLightingState } from "./Materials";
import { DetailPropLeafRenderer, StaticPropRenderer } from "./StaticDetailObject";
import { StudioModelCache } from "./Studio";
import { createVPKMount, VPKMount } from "./VPK";
import { GfxShaderLibrary } from "../gfx/helpers/ShaderHelpers";
import { OpaqueBlack } from "../Color";
import * as UI from "../ui";

export class CustomMount {
    constructor(public path: string, public files: string[] = []) {
    }

    public hasEntry(resolvedPath: string): boolean {
        return this.files.includes(resolvedPath);
    }

    public fetchFileData(dataFetcher: DataFetcher, resolvedPath: string): Promise<ArrayBufferSlice> {
        return dataFetcher.fetchData(`${this.path}/${resolvedPath}`);
    }
}

export class SourceFileSystem {
    public pakfiles: ZipFile[] = [];
    public zip: ZipFile[] = [];
    public vpk: VPKMount[] = [];
    public custom: CustomMount[] = [];

    constructor(private dataFetcher: DataFetcher) {
    }

    public async createVPKMount(path: string) {
        this.vpk.push(await createVPKMount(this.dataFetcher, path));
    }

    public async createZipMount(path: string) {
        const data = await this.dataFetcher.fetchData(path);
        this.zip.push(parseZipFile(data));
    }

    public resolvePath(path: string, ext: string): string {
        path = path.toLowerCase().replace(/\\/g, '/');
        path = path.replace(/\.\//g, '');
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
        for (let i = 0; i < this.custom.length; i++) {
            const custom = this.custom[i];
            if (custom.hasEntry(resolvedPath))
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

        return false;
    }

    public async fetchFileData(resolvedPath: string): Promise<ArrayBufferSlice | null> {
        for (let i = 0; i < this.custom.length; i++) {
            const custom = this.custom[i];
            if (custom.hasEntry(resolvedPath))
                return custom.fetchFileData(this.dataFetcher, resolvedPath);
        }

        for (let i = 0; i < this.vpk.length; i++) {
            const entry = this.vpk[i].findEntry(resolvedPath);
            if (entry !== null)
                return this.vpk[i].fetchFileData(entry);
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

export class SkyboxRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private materialInstances: BaseMaterial[] = [];
    private modelMatrix = mat4.create();

    constructor(renderContext: SourceRenderContext, private skyname: string) {
        const device = renderContext.device, cache = renderContext.renderCache;

        const vertexData = new Float32Array(6 * 4 * 5);
        const indexData = new Uint16Array(6 * 6);

        let dstVert = 0;
        let dstIdx = 0;

        function buildPlaneVert(pb: number, s: number, t: number): void {
            const side = 100000 * Math.sqrt(1/3);
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
            { location: MaterialProgramBase.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialProgramBase.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        this.bindMaterial(renderContext);
    }

    private async createMaterialInstance(renderContext: SourceRenderContext, path: string): Promise<BaseMaterial> {
        const materialCache = renderContext.materialCache;
        const materialInstance = await materialCache.createMaterialInstance(path);
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

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView): void {
        // Wait until we're ready.
        if (this.materialInstances.length === 0)
            return;

        for (let i = 0; i < this.materialInstances.length; i++)
            if (!this.materialInstances[i].isMaterialLoaded())
                return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.inputLayout, this.inputState);
        fillSceneParamsOnRenderInst(template, view);

        for (let i = 0; i < 6; i++) {
            const materialInstance = this.materialInstances[i];
            if (!materialInstance.isMaterialVisible(renderContext))
                continue;
            const renderInst = renderInstManager.newRenderInst();
            materialInstance.setOnRenderInst(renderContext, renderInst, this.modelMatrix);
            // Overwrite the filter key from the material instance.
            renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
            renderInst.drawIndexes(6, i*6);
            materialInstance.getRenderInstListForView(view).submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

export class BSPSurfaceRenderer {
    public visible = true;
    public materialInstance: BaseMaterial | null = null;
    public lightmaps: SurfaceLightmap[] = [];
    // displacement
    public clusterset: number[] | null = null;

    constructor(public surface: Surface) {
    }

    public bindMaterial(materialInstance: BaseMaterial, lightmapManager: LightmapManager): void {
        this.materialInstance = materialInstance;

        for (let i = 0; i < this.surface.lightmapData.length; i++) {
            const lightmapData = this.surface.lightmapData[i];
            this.lightmaps.push(new SurfaceLightmap(lightmapManager, lightmapData, this.materialInstance.wantsLightmap, this.materialInstance.wantsBumpmappedLightmap));
        }
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible || this.materialInstance === null)
            return;

        this.materialInstance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView, modelMatrix: ReadonlyMat4, pvs: BitMap | null = null) {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.isMaterialVisible(renderContext))
            return;

        if (pvs !== null) {
            // displacement check
            const clusterset = assertExists(this.clusterset);
            let visible = false;
            for (let i = 0; i < clusterset.length; i++) {
                if (pvs.getBit(clusterset[i])) {
                    visible = true;
                    break;
                }
            }

            if (!visible)
                return;
        }

        if (this.surface.bbox !== null) {
            scratchAABB.transform(this.surface.bbox, modelMatrix);
            if (!view.frustum.contains(scratchAABB))
                return;
        }

        for (let i = 0; i < this.lightmaps.length; i++)
            this.lightmaps[i].buildLightmap(renderContext.worldLightingState);

        const renderInst = renderInstManager.newRenderInst();
        this.materialInstance.setOnRenderInst(renderContext, renderInst, modelMatrix, this.surface.lightmapPageIndex);
        renderInst.drawIndexes(this.surface.indexCount, this.surface.startIndex);
        renderInst.debug = this;

        if (this.surface.center !== null) {
            const depth = computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(view.viewFromWorldMatrix, this.surface.center);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        }

        this.materialInstance.getRenderInstListForView(view).submitRenderInst(renderInst);
    }
}

const scratchAABB = new AABB();
export class BSPModelRenderer {
    public visible: boolean = true;
    public modelMatrix = mat4.create();
    public entity: BaseEntity | null = null;
    public surfaces: BSPSurfaceRenderer[] = [];
    public surfacesByIdx: BSPSurfaceRenderer[] = [];
    public displacementSurfaces: BSPSurfaceRenderer[] = [];
    public liveSurfaceSet = new Set<number>();

    constructor(renderContext: SourceRenderContext, public model: Model, public bsp: BSPFile) {
        for (let i = 0; i < model.surfaces.length; i++) {
            const surfaceIdx = model.surfaces[i];
            const surface = new BSPSurfaceRenderer(this.bsp.surfaces[surfaceIdx]);
            // TODO(jstpierre): This is ugly
            this.surfaces.push(surface);
            this.surfacesByIdx[surfaceIdx] = surface;

            if (surface.surface.isDisplacement) {
                const aabb = surface.surface.bbox!;
                this.displacementSurfaces.push(surface);
                surface.clusterset = [];
                this.bsp.markClusterSet(surface.clusterset, aabb);
            }
        }

        this.bindMaterials(renderContext);
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

    private async bindMaterials(renderContext: SourceRenderContext) {
        await Promise.all(this.surfaces.map(async (surface) => {
            const materialInstance = await renderContext.materialCache.createMaterialInstance(surface.surface.texName);

            const entityParams = this.entity !== null ? this.entity.materialParams : null;
            materialInstance.entityParams = entityParams;

            // We don't have vertex colors on BSP surfaces.
            materialInstance.hasVertexColorInput = false;

            materialInstance.wantsTexCoord0Scale = surface.surface.wantsTexCoord0Scale;

            // TODO(jstpierre): Refactor this a bit. Maybe use $decal instead?
            const isOverlay = !surface.surface.wantsTexCoord0Scale;
            materialInstance.wantsDeferredLightmap = isOverlay;

            await materialInstance.init(renderContext);
            surface.bindMaterial(materialInstance, renderContext.lightmapManager);
        }));
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].movement(renderContext);
    }

    public gatherSurfaces(liveSurfaceSet: Set<number> | null, liveLeafSet: Set<number> | null, pvs: BitMap, view: SourceEngineView, nodeid: number = this.model.headnode): void {
        if (nodeid >= 0) {
            // node
            const node = this.bsp.nodelist[nodeid];

            scratchAABB.transform(node.bbox, this.modelMatrix);
            if (!view.frustum.contains(scratchAABB))
                return;

            this.gatherSurfaces(liveSurfaceSet, liveLeafSet, pvs, view, node.child0);
            this.gatherSurfaces(liveSurfaceSet, liveLeafSet, pvs, view, node.child1);

            // Node surfaces are func_detail meshes, but they appear to also be in leaves... don't know if we need them.
            /*
            if (liveSurfaceSet !== null)
                for (let i = 0; i < node.surfaces.length; i++)
                    liveSurfaceSet.add(node.surfaces[i]);
            */
        } else {
            // leaf
            const leafnum = -nodeid - 1;
            const leaf = this.bsp.leaflist[leafnum];

            if (!pvs.getBit(leaf.cluster))
                return;

            scratchAABB.transform(leaf.bbox, this.modelMatrix);
            if (!view.frustum.contains(scratchAABB))
                return;

            if (liveLeafSet !== null)
                liveLeafSet.add(leafnum);

            if (liveSurfaceSet !== null)
                for (let i = 0; i < leaf.surfaces.length; i++)
                    liveSurfaceSet.add(leaf.surfaces[i]);
        }
    }

    private prepareToRenderCommon(view: SourceEngineView): boolean {
        if (!this.visible)
            return false;

        scratchAABB.transform(this.model.bbox, this.modelMatrix);
        if (!view.frustum.contains(scratchAABB))
            return false;

        return true;
    }

    public prepareToRenderModel(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView): void {
        if (!this.prepareToRenderCommon(view))
            return;

        // Submodels don't use the BSP tree, they simply render all surfaces back to back in a batch.
        for (let i = 0; i < this.model.surfaces.length; i++)
            this.surfacesByIdx[this.model.surfaces[i]].prepareToRender(renderContext, renderInstManager, view, this.modelMatrix);
    }

    public prepareToRenderWorld(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView, pvs: BitMap): void {
        if (!this.prepareToRenderCommon(view))
            return;

        // Render all displacement surfaces.
        // TODO(jstpierre): Move this to the BSP leaves
        for (let i = 0; i < this.displacementSurfaces.length; i++)
            this.displacementSurfaces[i].prepareToRender(renderContext, renderInstManager, view, this.modelMatrix, pvs);

        // Gather all BSP surfaces, and cull based on that.
        this.liveSurfaceSet.clear();
        this.gatherSurfaces(this.liveSurfaceSet, null, pvs, view);

        // Hacky: Always render all overlays. We should probably do it based on the origin faces...
        for (let i = 0; i < this.bsp.overlays.length; i++)
            this.liveSurfaceSet.add(this.bsp.overlays[i].surfaceIndex);

        for (const surfaceIdx of this.liveSurfaceSet.values())
            this.surfacesByIdx[surfaceIdx].prepareToRender(renderContext, renderInstManager, view, this.modelMatrix);

        /*
        for (let i = 0; i < this.bsp.overlays.length; i++) {
            const surface = this.surfacesByIdx[this.bsp.overlays[i].surfaceIndex];
            drawWorldSpaceText(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, surface.surface.center!, surface.surface.texName);
        }
        */
    }
}

// A "View" is effectively camera settings, but in Source engine space.
export class SourceEngineView {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();

    // The current camera position, in Source engine world space.
    public cameraPos = vec3.create();
    public lookAtPos = vec3.create();

    // Frustum is stored in Source engine world space.
    public frustum = new Frustum();

    public mainList = new GfxRenderInstList();
    public deferredDecalList = new GfxRenderInstList();
    public indirectList = new GfxRenderInstList(null);

    public fogParams = new FogParams();
    public clipPlaneWorld: vec4[] = [];
    public useExpensiveWater = false;

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
        this.frustum.updateClipFrustum(this.clipFromWorldMatrix);
        this.frustum.newFrame();
    }

    public copy(other: SourceEngineView): void {
        mat4.copy(this.viewFromWorldMatrix, other.viewFromWorldMatrix);
        mat4.copy(this.clipFromViewMatrix, other.clipFromViewMatrix);
        vec3.copy(this.cameraPos, other.cameraPos);
    }

    public setupFromCamera(camera: Camera): void {
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }

    public reset(): void {
        this.mainList.reset();
        this.deferredDecalList.reset();
        this.indirectList.reset();
    }
}

const enum RenderObjectKind {
    WorldSpawn  = 1 << 0,
    Entities    = 1 << 1,
    StaticProps = 1 << 2,
    DetailProps = 1 << 3,
    DebugCube   = 1 << 4,
}

class DebugCubeProgram extends DeviceProgram {
    public static ub_ObjectParams = 0;

    public vert: string = `
layout(std140) uniform ub_ObjectParams {
    Mat4x4 u_ProjectionViewModel;
    vec4 u_AmbientCube[6];
};

layout(location = ${MaterialProgramBase.a_Position}) attribute vec4 a_Position;
out vec3 v_Color;

void main() {
    gl_Position = Mul(u_ProjectionViewModel, vec4(a_Position.xyz, 1.0));
    v_Color = u_AmbientCube[int(a_Position.w)].rgb;
}
`;

    public frag: string = `
in vec3 v_Color;

void main() {
    gl_FragColor = vec4(v_Color, 1.0);
}
`;
}

export class DebugCube {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private program = new DebugCubeProgram();
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const vertData = new Float32Array([
            // left
            -1, -1, -1,  0,
            -1, -1,  1,  0,
            -1,  1, -1,  0,
            -1,  1,  1,  0,
            // right
             1, -1, -1,  1,
             1,  1, -1,  1,
             1, -1,  1,  1,
             1,  1,  1,  1,
            // top
            -1, -1, -1,  2,
             1, -1, -1,  2,
            -1, -1,  1,  2,
             1, -1,  1,  2,
            // bottom
            -1,  1, -1,  3,
            -1,  1,  1,  3,
             1,  1, -1,  3,
             1,  1,  1,  3,
            // front
            -1, -1, -1,  4,
            -1,  1, -1,  4,
             1, -1, -1,  4,
             1,  1, -1,  4,
            // bottom
            -1, -1,  1,  5,
             1, -1,  1,  5,
            -1,  1,  1,  5,
             1,  1,  1,  5,
        ]);
        const indxData = new Uint16Array([
            0, 1, 2, 1, 3, 2,
            4, 5, 6, 5, 7, 6,
            8, 9, 10, 9, 11, 10,
            12, 13, 14, 13, 15, 14,
            16, 17, 18, 17, 19, 18,
            20, 21, 22, 21, 23, 22,
        ]);

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indxData.buffer);

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [{ format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 0, location: 0, }],
            vertexBufferDescriptors: [{ byteStride: 4*4, frequency: GfxVertexBufferFrequency.PerVertex, }],
            indexBufferFormat: GfxFormat.U16_R,
        });

        this.inputState = device.createInputState(this.inputLayout,
            [{ buffer: this.vertexBuffer, byteOffset: 0 }],
            { buffer: this.indexBuffer, byteOffset: 0 },
        );
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, view: SourceEngineView, position: ReadonlyVec3, ambientCube: AmbientCube): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts([{ numSamplers: 0, numUniformBuffers: 1 }]);
        renderInst.setGfxProgram(renderInstManager.gfxRenderCache.createProgram(this.program));
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(6*6);
        view.mainList.submitRenderInst(renderInst);
        let offs = renderInst.allocateUniformBuffer(DebugCubeProgram.ub_ObjectParams, 16+4*6);
        const d = renderInst.mapUniformBufferF32(DebugCubeProgram.ub_ObjectParams);

        const scale = 15;
        mat4.fromRotationTranslationScale(scratchMatrix, quat.create(), position, [scale, scale, scale]);
        mat4.mul(scratchMatrix, view.clipFromWorldMatrix, scratchMatrix);
        offs += fillMatrix4x4(d, offs, scratchMatrix);
        for (let i = 0; i < 6; i++)
            offs += fillColor(d, offs, ambientCube[i]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class BSPRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    public entitySystem: EntitySystem;
    public models: BSPModelRenderer[] = [];
    public detailPropLeafRenderers: DetailPropLeafRenderer[] = [];
    public staticPropRenderers: StaticPropRenderer[] = [];
    public liveLeafSet = new Set<number>();
    private debugCube: DebugCube;

    constructor(renderContext: SourceRenderContext, public bsp: BSPFile) {
        this.entitySystem = new EntitySystem(renderContext.entityFactoryRegistry);

        // TODO(jtspierre): Ugly ugly ugly
        renderContext.materialCache.usingHDR = this.bsp.usingHDR;
        renderContext.lightmapManager.appendPackerManager(this.bsp.lightmapPackerManager);

        const device = renderContext.device, cache = renderContext.renderCache;
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.bsp.vertexData);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, this.bsp.indexData);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialProgramBase.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialProgramBase.a_Normal,   bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialProgramBase.a_TangentS, bufferIndex: 0, bufferByteOffset: 7*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialProgramBase.a_TexCoord, bufferIndex: 0, bufferByteOffset: 11*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+4+4+4)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U32_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        for (let i = 0; i < this.bsp.models.length; i++) {
            const model = this.bsp.models[i];
            const modelRenderer = new BSPModelRenderer(renderContext, model, bsp);
            // Non-world-spawn models are invisible by default (they're lifted into the world by entities).
            modelRenderer.visible = (i === 0);
            this.models.push(modelRenderer);
        }

        // Spawn entities.
        this.entitySystem.createEntities(renderContext, this, this.bsp.entities);

        // Spawn static objects.
        if (this.bsp.staticObjects !== null)
            for (const staticProp of this.bsp.staticObjects.staticProps)
                this.staticPropRenderers.push(new StaticPropRenderer(renderContext, this.bsp, staticProp));

        // Spawn detail objects.
        if (this.bsp.detailObjects !== null)
            for (const leaf of this.bsp.detailObjects.leafDetailModels.keys())
                this.detailPropLeafRenderers.push(new DetailPropLeafRenderer(renderContext, bsp, leaf));

        this.debugCube = new DebugCube(device, cache);
    }

    public getSkyCamera(): sky_camera | null {
        const skyCameraEntity = this.entitySystem.entities.find((entity) => entity instanceof sky_camera) as sky_camera;
        return skyCameraEntity !== undefined ? skyCameraEntity : null;
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

    public prepareToRenderView(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView, pvs: BitMap, kinds: RenderObjectKind): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        fillSceneParamsOnRenderInst(template, view);

        // Render the world-spawn model.
        if (!!(kinds & RenderObjectKind.WorldSpawn))
            this.models[0].prepareToRenderWorld(renderContext, renderInstManager, view, pvs);

        if (!!(kinds & RenderObjectKind.Entities)) {
            for (let i = 1; i < this.models.length; i++)
                this.models[i].prepareToRenderModel(renderContext, renderInstManager, view);
            for (let i = 0; i < this.entitySystem.entities.length; i++)
                this.entitySystem.entities[i].prepareToRender(renderContext, renderInstManager, view);
        }

        // Static props.
        if (!!(kinds & RenderObjectKind.StaticProps))
            for (let i = 0; i < this.staticPropRenderers.length; i++)
                this.staticPropRenderers[i].prepareToRender(renderContext, renderInstManager, this.bsp, pvs);

        // Detail props.
        if (!!(kinds & RenderObjectKind.DetailProps)) {
            this.liveLeafSet.clear();
            this.models[0].gatherSurfaces(null, this.liveLeafSet, pvs, view);

            for (let i = 0; i < this.detailPropLeafRenderers.length; i++) {
                const detailPropLeafRenderer = this.detailPropLeafRenderers[i];
                if (!this.liveLeafSet.has(detailPropLeafRenderer.leaf))
                    continue;
                detailPropLeafRenderer.prepareToRender(renderContext, renderInstManager, view);
            }
        }

        if (!!(kinds & RenderObjectKind.DebugCube)) {
            for (const leafidx of this.liveLeafSet) {
                const leaf = this.bsp.leaflist[leafidx];
                if ((leaf as any).debug) {
                    drawWorldSpaceAABB(getDebugOverlayCanvas2D(), renderContext.currentView.clipFromWorldMatrix, leaf.bbox);
                    for (const sample of leaf.ambientLightSamples)
                        this.debugCube.prepareToRender(renderContext.device, renderInstManager, view, sample.pos, sample.ambientCube);
                }
            }
        }

        /*
        for (let i = 0; i < this.bsp.worldlights.length; i++) {
            drawWorldSpaceText(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, this.bsp.worldlights[i].pos, '' + i);
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, this.bsp.worldlights[i].pos);
        }
        */

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
        this.debugCube.destroy(device);

        for (let i = 0; i < this.detailPropLeafRenderers.length; i++)
            this.detailPropLeafRenderers[i].destroy(device);
        for (let i = 0; i < this.staticPropRenderers.length; i++)
            this.staticPropRenderers[i].destroy(device);
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
            width, height, depth, numLevels: 1, usage: GfxTextureUsage.Sampled,
        });

        this.gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
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

export class SourceRenderContext {
    public entityFactoryRegistry = new EntityFactoryRegistry();
    public lightmapManager: LightmapManager;
    public studioModelCache: StudioModelCache;
    public materialCache: MaterialCache;
    public worldLightingState = new WorldLightingState();
    public globalTime: number = 0;
    public globalDeltaTime: number = 0;
    public materialProxySystem = new MaterialProxySystem();
    public cheapWaterStartDistance = 0.0;
    public cheapWaterEndDistance = 0.1;
    public currentView: SourceEngineView;
    public colorCorrection: SourceColorCorrection;
    public renderCache: GfxRenderCache;

    // Public settings
    public showToolMaterials = false;
    public showTriggerDebug = false;
    public showFog = true;
    public showExpensiveWater = true;

    constructor(public device: GfxDevice, public filesystem: SourceFileSystem) {
        this.renderCache = new GfxRenderCache(device);
        this.lightmapManager = new LightmapManager(device, this.renderCache);
        this.materialCache = new MaterialCache(device, this.renderCache, this.filesystem);
        this.studioModelCache = new StudioModelCache(this, this.filesystem);
        this.colorCorrection = new SourceColorCorrection(device, this.renderCache);
    }

    public destroy(device: GfxDevice): void {
        this.lightmapManager.destroy(device);
        this.materialCache.destroy(device);
        this.studioModelCache.destroy(device);
        this.colorCorrection.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 9 },
];

const bindingLayoutsPost: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 0, numSamplers: 2 },
];

class FullscreenPostProgram extends DeviceProgram {
    public both = `
precision mediump float; precision lowp sampler3D;
uniform sampler2D u_FramebufferColor;
uniform sampler3D u_ColorCorrectTexture;
`;
    public vert: string = GfxShaderLibrary.fullscreenVS;
    public frag: string = `
in vec2 v_TexCoord;

void main() {
    vec4 t_Color = texture(SAMPLER_2D(u_FramebufferColor), v_TexCoord);
    t_Color.rgb = pow(t_Color.rgb, vec3(1.0 / 2.2));

    vec3 t_Size = vec3(textureSize(u_ColorCorrectTexture, 0));
    vec3 t_TexCoord = t_Color.rgb * ((t_Size - 1.0) / t_Size) + (0.5 / t_Size);
    t_Color.rgb = texture(u_ColorCorrectTexture, t_TexCoord).rgb;

    gl_FragColor = t_Color;
}
`;
}

// Renders the entire world (2D skybox, 3D skybox, etc.) given a specific camera location.
// It's distinct from a view, which is camera settings, which there can be multiple of in a world renderer view.
class SourceWorldViewRenderer {
    public drawSkybox2D = true;
    public drawSkybox3D = true;
    public drawWorld = true;
    public drawIndirect = true;
    public drawDeferredDecals = true;
    public renderObjectMask = RenderObjectKind.WorldSpawn | RenderObjectKind.StaticProps | RenderObjectKind.DetailProps | RenderObjectKind.Entities | RenderObjectKind.DebugCube;
    public pvsEnabled = true;

    public mainView = new SourceEngineView();
    public skyboxView = new SourceEngineView();
    public enabled = false;

    public outputColorTargetID: number | null = null;

    constructor(public name: string) {
    }

    private calcPVS(bsp: BSPFile, pvs: BitMap, view: SourceEngineView): boolean {
        if (!this.pvsEnabled)
            return false;

        // Compute PVS from view.
        const leaf = bsp.findLeafForPoint(view.cameraPos);

        if (leaf !== null && leaf.cluster !== 0xFFFF) {
            // Has valid visibility.
            pvs.fill(false);
            pvs.or(bsp.visibility.pvs[leaf.cluster]);
            return true;
        }

        return false;
    }

    public prepareToRender(renderer: SourceRenderer): void {
        this.enabled = true;
        const renderContext = renderer.renderContext, renderInstManager = renderer.renderHelper.renderInstManager;

        this.skyboxView.copy(this.mainView);

        // Position the 2D skybox around the main view.
        vec3.negate(scratchVec3, this.mainView.cameraPos);
        mat4.fromTranslation(scratchMatrix, this.mainView.cameraPos);
        mat4.mul(this.skyboxView.viewFromWorldMatrix, this.skyboxView.viewFromWorldMatrix, scratchMatrix);
        this.skyboxView.finishSetup();

        renderContext.currentView = this.skyboxView;

        if (renderer.skyboxRenderer !== null && this.drawSkybox2D)
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
                if (!this.calcPVS(bspRenderer.bsp, renderer.pvsScratch, this.skyboxView))
                    continue;

                bspRenderer.prepareToRenderView(renderContext, renderInstManager, this.skyboxView, renderer.pvsScratch, this.renderObjectMask & (RenderObjectKind.WorldSpawn | RenderObjectKind.StaticProps));
            }
        }

        if (this.drawWorld) {
            renderContext.currentView = this.mainView;

            for (let i = 0; i < renderer.bspRenderers.length; i++) {
                const bspRenderer = renderer.bspRenderers[i];

                if (!this.calcPVS(bspRenderer.bsp, renderer.pvsScratch, this.mainView)) {
                    // No valid PVS, mark everything visible.
                    renderer.pvsScratch.fill(true);
                }

                // Calculate our fog parameters from the local player's fog controller.
                const localPlayer = bspRenderer.entitySystem.getLocalPlayer();
                if (localPlayer.currentFogController !== null && renderer.renderContext.showFog)
                    localPlayer.currentFogController.fillFogParams(this.mainView.fogParams);
                else
                    this.mainView.fogParams.maxdensity = 0.0;

                bspRenderer.prepareToRenderView(renderContext, renderInstManager, this.mainView, renderer.pvsScratch, this.renderObjectMask & (RenderObjectKind.WorldSpawn | RenderObjectKind.Entities | RenderObjectKind.StaticProps | RenderObjectKind.DetailProps | RenderObjectKind.DebugCube));
            }
        }

        renderContext.currentView = null!;
    }

    public pushPasses(renderer: SourceRenderer, builder: GfxrGraphBuilder, renderTargetDesc: GfxrRenderTargetDescription): void {
        assert(this.enabled);

        const mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        mainColorDesc.copyDimensions(renderTargetDesc);
        mainColorDesc.colorClearColor = standardFullClearRenderPassDescriptor.colorClearColor;

        const lightColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        lightColorDesc.copyDimensions(mainColorDesc);
        lightColorDesc.colorClearColor = OpaqueBlack;

        const mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
        mainDepthDesc.copyDimensions(mainColorDesc);
        mainDepthDesc.depthClearValue = standardFullClearRenderPassDescriptor.depthClearValue;

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, `${this.name} - Main Color (sRGB)`);
        const lightColorTargetID = builder.createRenderTargetID(lightColorDesc, `${this.name} - Light Color (sRGB)`);

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, `${this.name} - Skybox Depth`);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);

            pass.exec((passRenderer) => {
                renderer.executeOnPass(passRenderer, this.skyboxView.mainList);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, `${this.name} - Main Depth`);
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            if (this.drawDeferredDecals)
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color1, lightColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            pass.exec((passRenderer) => {
                renderer.executeOnPass(passRenderer, this.mainView.mainList);
            });

            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);
        });

        if (this.drawDeferredDecals && this.mainView.deferredDecalList.renderInsts.length > 0) {
            builder.pushPass((pass) => {
                pass.setDebugName('Deferred Decals');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const lightColorResolveTextureID = builder.resolveRenderTarget(lightColorTargetID);
                pass.attachResolveTexture(lightColorResolveTextureID);

                pass.exec((passRenderer, scope) => {
                    renderer.setLateBindingTexture(LateBindingTexture.DeferredLightmap, scope.getResolveTextureForID(lightColorResolveTextureID), renderer.linearSampler);
                    renderer.executeOnPass(passRenderer, this.mainView.deferredDecalList);
                });
            });
        }

        if (this.drawIndirect && this.mainView.indirectList.renderInsts.length > 0) {
            builder.pushPass((pass) => {
                pass.setDebugName('Indirect');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(mainColorResolveTextureID);

                const mainDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
                pass.attachResolveTexture(mainDepthResolveTextureID);

                let reflectColorResolveTextureID: number | null = null;
                if (renderer.reflectViewRenderer.outputColorTargetID !== null) {
                    reflectColorResolveTextureID = builder.resolveRenderTarget(renderer.reflectViewRenderer.outputColorTargetID);
                    pass.attachResolveTexture(reflectColorResolveTextureID);
                }

                pass.exec((passRenderer, scope) => {
                    renderer.setLateBindingTexture(LateBindingTexture.FramebufferColor, scope.getResolveTextureForID(mainColorResolveTextureID), renderer.linearSampler);
                    renderer.setLateBindingTexture(LateBindingTexture.FramebufferDepth, scope.getResolveTextureForID(mainDepthResolveTextureID), renderer.pointSampler);

                    const reflectColorTexture = reflectColorResolveTextureID !== null ? scope.getResolveTextureForID(reflectColorResolveTextureID) : renderer.renderContext.materialCache.systemTextures.opaqueBlackTexture2D;
                    renderer.setLateBindingTexture(LateBindingTexture.WaterReflection, reflectColorTexture, renderer.linearSampler);

                    renderer.executeOnPass(passRenderer, this.mainView.indirectList);
                });
            });
        }

        this.outputColorTargetID = mainColorTargetID;
    }

    public reset(): void {
        this.mainView.reset();
        this.skyboxView.reset();
        this.enabled = false;
        this.outputColorTargetID = null;
    }
}

const scratchVec3 = vec3.create();
const scratchVec4a = vec4.create(), scratchVec4b = vec4.create();
const scratchMatrix = mat4.create();
const scratchPlane = new Plane();

// http://www.terathon.com/code/oblique.html
// Plane here needs to be in view-space.
function modifyProjectionMatrixForObliqueClipping(m: mat4, plane: Plane): void {
    const x = (Math.sign(plane.x) + m[8]) / m[0];
    const y = (Math.sign(plane.y) + m[9]) / m[5];
    const z = -1;
    const w = (1 + m[10]) / m[14];

    vec4.set(scratchVec4a, x, y, z, w);
    plane.getVec4v(scratchVec4b);

    vec4.scale(scratchVec4b, scratchVec4b, 2.0 / vec4.dot(scratchVec4b, scratchVec4a));
    m[2] = scratchVec4a[0];
    m[6] = scratchVec4a[1];
    m[10] = scratchVec4a[2] + 1;
    m[14] = scratchVec4a[3];
}

export class SourceRenderer implements SceneGfx {
    private postProgram = new FullscreenPostProgram();
    public linearSampler: GfxSampler;
    public pointSampler: GfxSampler;
    public renderHelper: GfxRenderHelper;
    public skyboxRenderer: SkyboxRenderer | null = null;
    public bspRenderers: BSPRenderer[] = [];

    private textureMapping = nArray(4, () => new TextureMapping());
    private bindingMapping: string[] = [LateBindingTexture.FramebufferColor, LateBindingTexture.FramebufferDepth, LateBindingTexture.WaterReflection, LateBindingTexture.DeferredLightmap];

    public mainViewRenderer = new SourceWorldViewRenderer(`Main View`);
    public reflectViewRenderer = new SourceWorldViewRenderer(`Reflection View`);

    // Debug & Settings
    public pvsScratch = new BitMap(65536);

    constructor(context: SceneContext, public renderContext: SourceRenderContext) {
        // Make the reflection view a bit cheaper.
        this.reflectViewRenderer.drawIndirect = false;
        this.reflectViewRenderer.drawDeferredDecals = false;
        this.reflectViewRenderer.renderObjectMask &= ~(RenderObjectKind.Entities | RenderObjectKind.DetailProps | RenderObjectKind.DebugCube);
        this.reflectViewRenderer.mainView.clipPlaneWorld.push(vec4.create());

        this.renderHelper = new GfxRenderHelper(renderContext.device, context, renderContext.renderCache);
        this.renderHelper.renderInstManager.disableSimpleMode();

        this.linearSampler = this.renderContext.renderCache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.pointSampler = this.renderContext.renderCache.createSampler({
            magFilter: GfxTexFilterMode.Point,
            minFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
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

    private movement(): void {
        // Update render context.

        // TODO(jstpierre): The world lighting state should probably be moved to the BSP? Or maybe SourceRenderContext is moved to the BSP...
        this.renderContext.worldLightingState.update(this.renderContext.globalTime);

        // Update BSP (includes entities).
        this.renderContext.currentView = this.mainViewRenderer.mainView;

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
        const enableDecals = new UI.Checkbox('Enable Decals', true);
        enableDecals.onchanged = () => {
            const v = enableDecals.checked;
            this.mainViewRenderer.drawDeferredDecals = v;
        };
        renderHacksPanel.contents.appendChild(enableDecals.elem);
        const enableFog = new UI.Checkbox('Enable Fog', true);
        enableFog.onchanged = () => {
            const v = enableFog.checked;
            this.renderContext.showFog = v;
        };
        renderHacksPanel.contents.appendChild(enableFog.elem);
        const enableColorCorrection = new UI.Checkbox('Enable Color Correction', true);
        enableColorCorrection.onchanged = () => {
            const v = enableColorCorrection.checked;
            this.renderContext.colorCorrection.setEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableColorCorrection.elem);
        const useExpensiveWater = new UI.Checkbox('Use Expensive Water', true);
        useExpensiveWater.onchanged = () => {
            const v = useExpensiveWater.checked;
            this.renderContext.showExpensiveWater = v;
        };
        renderHacksPanel.contents.appendChild(useExpensiveWater.elem);
        const showToolMaterials = new UI.Checkbox('Show Tool-only Materials', false);
        showToolMaterials.onchanged = () => {
            const v = showToolMaterials.checked;
            this.renderContext.showToolMaterials = v;
        };
        renderHacksPanel.contents.appendChild(showToolMaterials.elem);
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
        const renderContext = this.renderContext, device = this.renderContext.device;

        // globalTime is in seconds.
        renderContext.globalTime = viewerInput.time / 1000.0;
        renderContext.globalDeltaTime = viewerInput.deltaTime / 1000.0;

        // Update the main view early, since that's what movement/entities will use
        this.mainViewRenderer.mainView.setupFromCamera(viewerInput.camera);

        this.movement();

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back });
        template.setBindingLayouts(bindingLayouts);

        this.mainViewRenderer.prepareToRender(this);

        // Reflection is only supported on the first BSP renderer (maybe we should just kill the concept of having multiple...)
        if (this.renderContext.showExpensiveWater) {
            const bsp = this.bspRenderers[0].bsp;
            const leafwater = bsp.findLeafWaterForPoint(this.mainViewRenderer.mainView.cameraPos);
            if (leafwater !== null) {
                const waterZ = leafwater.surfaceZ;

                // Reflect around waterZ
                const cameraZ = this.mainViewRenderer.mainView.cameraPos[2];
                if (cameraZ > waterZ) {
                    // Reflection plane
                    scratchPlane.set4(0, 0, 1, -waterZ);
                    scratchPlane.getVec4v(this.reflectViewRenderer.mainView.clipPlaneWorld[0]);

                    const reflectionCameraZ = cameraZ - 2 * (cameraZ - waterZ);

                    // There's probably a much cleaner way to do this, tbh.
                    const reflectView = this.reflectViewRenderer.mainView;
                    reflectView.copy(this.mainViewRenderer.mainView);

                    // Flip the view upside-down so that when we invert later, the winding order comes out correct.
                    // This will mean we'll have to flip the texture in the shader though. Intentionally adding a Y-flip for once!

                    // This is in noclip space
                    computeModelMatrixS(scratchMatrix, 1, -1, 1);
                    mat4.mul(reflectView.worldFromViewMatrix, this.mainViewRenderer.mainView.worldFromViewMatrix, scratchMatrix);

                    // Now flip it over the reflection plane.

                    // This is in Source space
                    computeModelMatrixS(scratchMatrix, 1, 1, -1);
                    mat4.mul(reflectView.worldFromViewMatrix, scratchMatrix, reflectView.worldFromViewMatrix);
                    reflectView.worldFromViewMatrix[14] = reflectionCameraZ;
                    mat4.invert(reflectView.viewFromWorldMatrix, reflectView.worldFromViewMatrix);

                    // TODO(jstpierre): This isn't quite working yet.
                    /*
                    scratchPlane.transform(reflectView.viewFromWorldMatrix);
                    modifyProjectionMatrixForObliqueClipping(reflectView.clipFromViewMatrix, scratchPlane);
                    */

                    this.reflectViewRenderer.mainView.finishSetup();
                    this.reflectViewRenderer.prepareToRender(this);
                }
            }
        }

        this.mainViewRenderer.mainView.useExpensiveWater = this.reflectViewRenderer.enabled;
        renderInstManager.popTemplateRenderInst();

        // Update our lightmaps right before rendering.
        renderContext.lightmapManager.prepareToRender(device);
        renderContext.colorCorrection.prepareToRender(device);

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        for (let i = 0; i < this.textureMapping.length; i++)
            this.textureMapping[i].reset();

        this.prepareToRender(viewerInput);

        const mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        setBackbufferDescSimple(mainColorDesc, viewerInput);

        // Render reflection view first.
        if (this.reflectViewRenderer.enabled)
            this.reflectViewRenderer.pushPasses(this, builder, mainColorDesc);

        this.mainViewRenderer.pushPasses(this, builder, mainColorDesc);
        const mainColorTargetID = assertExists(this.mainViewRenderer.outputColorTargetID);

        const mainColorGammaDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
        mainColorGammaDesc.copyDimensions(mainColorDesc);
        const mainColorGammaTargetID = builder.createRenderTargetID(mainColorGammaDesc, 'Main Color (Gamma)');

        const cache = this.renderContext.renderCache;

        builder.pushPass((pass) => {
            // Now do a fullscreen color-correction pass to output to our UNORM backbuffer.
            pass.setDebugName('Color Correction & Gamma Correction');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorGammaTargetID);

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            const postRenderInst = this.renderHelper.renderInstManager.newRenderInst();
            postRenderInst.setBindingLayouts(bindingLayoutsPost);
            postRenderInst.setInputLayoutAndState(null, null);
            const postProgram = cache.createProgram(this.postProgram);
            postRenderInst.setGfxProgram(postProgram);
            postRenderInst.setMegaStateFlags(fullscreenMegaState);
            postRenderInst.drawPrimitives(3);

            pass.exec((passRenderer, scope) => {
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                this.renderContext.colorCorrection.fillTextureMapping(this.textureMapping[1]);
                postRenderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                postRenderInst.drawOnPass(cache, passRenderer);
            });
        });
        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorGammaTargetID, viewerInput.mouseLocation);

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorGammaTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorGammaTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderGraph.execute(builder);
        this.resetViews();
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.renderContext.destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
    }
}
