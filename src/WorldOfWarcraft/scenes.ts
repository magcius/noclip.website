import { mat4, ReadonlyMat4, vec3, vec4 } from "gl-matrix";
import { CameraController } from "../Camera.js";
import { AABB, Frustum } from "../Geometry.js";
import { getMatrixTranslation, invlerp, lerp, projectionMatrixForFrustum, saturate, setMatrixTranslation, transformVec3Mat4w1 } from "../MathHelpers.js";
import { SceneContext } from "../SceneBase.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxClipSpaceNearZ, GfxCullMode, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxProgram } from "../gfx/platform/GfxPlatformImpl.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { rust } from "../rustlib.js";
import { assert } from "../util.js";
import * as Viewer from "../viewer.js";
import { AdtCoord, AdtData, Database, DoodadData, LazyWorldData, ModelData, ParticleEmitter, WmoData, WmoDefinition, WorldData, WowCache } from "./data.js";
import { BaseProgram, LoadingAdtProgram, ModelProgram, ParticleProgram, SkyboxProgram, TerrainProgram, WaterProgram, WmoProgram } from "./program.js";
import { LoadingAdtRenderer, ModelRenderer, SkyboxRenderer, TerrainRenderer, WaterRenderer, WmoRenderer } from "./render.js";
import { TextureCache } from "./tex.js";

export const MAP_SIZE = 17066;

export const placementSpaceFromAdtSpace: ReadonlyMat4 = mat4.fromValues(
    0, 0, -1, 0,
    -1, 0, 0, 0,
    0, 1, 0, 0,
    MAP_SIZE, 0, MAP_SIZE, 1,
);
// noclip space is placement space
const noclipSpaceFromAdtSpace = placementSpaceFromAdtSpace;

export const placementSpaceFromModelSpace: ReadonlyMat4 = mat4.fromValues(
    0, 0, 1, 0,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

export const adtSpaceFromPlacementSpace: ReadonlyMat4 = mat4.invert(mat4.create(), placementSpaceFromAdtSpace);
export const adtSpaceFromModelSpace: ReadonlyMat4 = mat4.mul(mat4.create(), adtSpaceFromPlacementSpace, placementSpaceFromModelSpace);

export const modelSpaceFromAdtSpace: ReadonlyMat4 = mat4.invert(mat4.create(), adtSpaceFromModelSpace);
export const modelSpaceFromPlacementSpace: ReadonlyMat4 = mat4.invert(mat4.create(), placementSpaceFromModelSpace);

const scratchVec3 = vec3.create();
export class View {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();
    public interiorSunDirection = vec4.fromValues(-0.30822, -0.30822, -0.9, 0);
    public exteriorDirectColorDirection = vec4.fromValues(-0.30822, -0.30822, -0.9, 0);
    public clipSpaceNearZ: GfxClipSpaceNearZ;
    public cameraPos = vec3.create();
    public time: number;
    public dayNight = 0;
    public deltaTime: number;
    public cullingNearPlane = 0.1;
    public cullingFarPlane = 1000;
    public cullingFrustum: Frustum = new Frustum();
    public timeOffset = 1440;
    public secondsPerGameDay = 90;
    public fogEnabled = true;
    public freezeTime = false;

    constructor() {}

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
    }

    private calculateSunDirection(): void {
        const theta = 3.926991;
        const phiMin = 2.2165682;
        const phiMax = 1.9198623;
        let phi;
        if (this.dayNight < 0.25) {
            phi = lerp(phiMax, phiMin, invlerp(0.0, 0.25, this.dayNight));
        } else if (this.dayNight < 0.5) {
            phi = lerp(phiMin, phiMax, invlerp(0.25, 0.5, this.dayNight));
        } else if (this.dayNight < 0.75) {
            phi = lerp(phiMax, phiMin, invlerp(0.5, 0.75, this.dayNight));
        } else {
            phi = lerp(phiMin, phiMax, invlerp(0.75, 1.0, this.dayNight));
        }
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        vec4.set(this.exteriorDirectColorDirection, sinPhi * cosTheta, sinPhi * sinTheta, cosPhi, 0);
    }

    public cameraDistanceToWorldSpaceAABB(aabb: AABB): number {
        aabb.centerPoint(scratchVec3);
        return vec3.distance(this.cameraPos, scratchVec3);
    }

    public setupFromViewerInput(viewerInput: Viewer.ViewerRenderInput): void {
        this.cullingNearPlane = viewerInput.camera.near;
        this.clipSpaceNearZ = viewerInput.camera.clipSpaceNearZ;
        mat4.mul(this.viewFromWorldMatrix, viewerInput.camera.viewMatrix, noclipSpaceFromAdtSpace);
        mat4.copy(this.clipFromViewMatrix, viewerInput.camera.projectionMatrix);

        // Culling uses different near/far planes
        const clipFromViewMatrixCull = mat4.create();
        projectionMatrixForFrustum(
            clipFromViewMatrixCull,
            viewerInput.camera.left,
            viewerInput.camera.right,
            viewerInput.camera.bottom,
            viewerInput.camera.top,
            this.cullingNearPlane,
            this.cullingFarPlane,
        );
        const clipFromWorldMatrixCull = mat4.create();
        mat4.mul(clipFromWorldMatrixCull, clipFromViewMatrixCull, this.viewFromWorldMatrix);
        this.cullingFrustum.updateClipFrustum(clipFromWorldMatrixCull, GfxClipSpaceNearZ.NegativeOne);

        if (this.freezeTime) {
            this.time = 800;
        } else {
            this.time = (viewerInput.time / this.secondsPerGameDay + this.timeOffset) % 2880;
        }
        this.dayNight = this.time / 2880.0;
        this.deltaTime = viewerInput.deltaTime;
        this.calculateSunDirection();
        this.finishSetup();
    }
}

const enum CullingState {
    Running,
    Paused,
    OneShot,
};

const enum CameraState {
    Frozen,
    Running,
};

// A set of all doodads, ADTs, WMOs, etc to render each frame
export class FrameData {
    public wmoDefGroups = new MapArray<number, number>(); // WmoDefinition uniqueId => [WMO groupId]
    public wmoDefs = new MapArray<number, WmoDefinition>(); // WMO fileId => [WmoDefinition]
    public doodads = new MapArray<number, DoodadData>(); // Model fileId => [DoodadData]
    public liquidIndices: number[] = []; // index into either WMO or ADT liquids array
    public adtChunkIndices = new MapArray<number, number>(); // ADT fileId => [chunk index]
    public activeWmoSkybox: number | null = null;
    public adtLiquids = new MapArray<number, number>(); // ADT fileId => [liquidIndex]
    public wmoLiquids = new MapArray<number, number>(); // WmoDefinition uniqueId => [liquidIndex]

    private wmoDefToDoodadIndices = new MapArray<number, number>(); // WmoDefinition uniqueId => [doodad index]
    private adtDoodadUniqueIds = new Set<number>();

    public addWmoDef(wmo: WmoData, def: WmoDefinition) {
        this.wmoDefs.append(wmo.fileId, def);
    }

    public addWmoGroup(wmo: WmoData, def: WmoDefinition, groupId: number, justWmo = false) {
        this.wmoDefGroups.append(def.uniqueId, groupId);
        if (justWmo)
            return;
        if (def.groupIdToDoodadIndices.has(groupId)) {
            for (let index of def.groupIdToDoodadIndices.get(groupId)) {
                this.addWmoDoodad(def, index);
            }
        }
        if (def.groupIdToLiquidIndices.has(groupId)) {
            for (let index of def.groupIdToLiquidIndices.get(groupId)) {
                this.addWmoDefLiquid(def, index);
            }
        }
    }

    public addWmoDoodad(def: WmoDefinition, index: number) {
        if (this.wmoDefToDoodadIndices.get(def.uniqueId).includes(index))
            return;
        const doodad = def.doodadIndexToDoodad.get(index)!;
        this.wmoDefToDoodadIndices.append(def.uniqueId, index);
        this.doodads.append(doodad.modelId, doodad);
    }

    public addAdtDoodad(doodad: DoodadData) {
        const uniqueId = doodad.uniqueId!;
        assert(uniqueId !== undefined);
        if (this.adtDoodadUniqueIds.has(uniqueId))
            return;
        this.adtDoodadUniqueIds.add(uniqueId);
        this.doodads.append(doodad.modelId, doodad);
    }

    public addWmoDefLiquid(def: WmoDefinition, liquidIndex: number) {
        this.wmoLiquids.append(def.uniqueId, liquidIndex);
    }

    public addAdtLiquid(adt: AdtData, liquidIndex: number) {
        this.adtLiquids.append(adt.fileId, liquidIndex);
    }

    public addAdtChunk(adt: AdtData, chunkIndex: number) {
        this.adtChunkIndices.append(adt.fileId, chunkIndex);
    }
}

export class MapArray<K, V> {
    public map: Map<K, V[]> = new Map();

    public has(key: K): boolean {
        return this.map.has(key);
    }

    public get(key: K): V[] {
        const result = this.map.get(key);
        if (result === undefined) {
            return [];
        }
        return result;
    }

    public entries(): IterableIterator<[K, V[]]> {
        return this.map.entries();
    }

    public appendUnique(key: K, value: V): void {
        if (this.map.has(key)) {
            const L = this.map.get(key)!;
            if (!L.includes(value)) L.push(value);
        } else {
            this.map.set(key, [value]);
        }
    }

    public append(key: K, value: V) {
        if (this.map.has(key)) {
            this.map.get(key)!.push(value);
        } else {
            this.map.set(key, [value]);
        }
    }

    public extend(key: K, values: V[]) {
        if (this.map.has(key)) {
            this.map.set(key, this.map.get(key)!.concat(values));
        } else {
            this.map.set(key, values);
        }
    }

    public keys(): IterableIterator<K> {
        return this.map.keys();
    }

    public values(): IterableIterator<V[]> {
        return this.map.values();
    }
}

enum CullWmoResult {
    CameraInsideAndExteriorVisible,
    CameraInside,
    CameraOutside,
}

export class WdtScene implements Viewer.SceneGfx {
    private terrainRenderers = new Map<number, TerrainRenderer>();
    private adtWaterRenderers = new Map<number, WaterRenderer>();
    private wmoWaterRenderers = new Map<number, WaterRenderer>();
    private modelRenderers = new Map<number, ModelRenderer>();
    private skyboxModelRenderers = new Map<string, ModelRenderer>();
    private wmoRenderers = new Map<number, WmoRenderer>();
    private wmoSkyboxRenderers = new Map<number, ModelRenderer>();
    private skyboxRenderer: SkyboxRenderer;
    private loadingAdtRenderer: LoadingAdtRenderer;
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListSky = new GfxRenderInstList();

    public ADT_LOD0_DISTANCE = 1000;

    private terrainProgram: GfxProgram;
    private waterProgram: GfxProgram;
    private modelProgram: GfxProgram;
    private wmoProgram: GfxProgram;
    private skyboxProgram: GfxProgram;
    private loadingAdtProgram: GfxProgram;
    private particleProgram: GfxProgram;

    private modelIdToDoodads = new MapArray<number, DoodadData>();
    private wmoIdToDefs = new MapArray<number, WmoDefinition>();

    public mainView = new View();
    private textureCache: TextureCache;
    public enableProgressiveLoading = false;
    public currentAdtCoords: [number, number] = [0, 0];
    public loadingAdts: [number, number][] = [];

    public debug = false;
    public enableFog = true;
    public enableParticles = true;
    public cullingState = CullingState.Running;
    public cameraState = CameraState.Running;
    public frozenCamera = vec3.create();
    public frozenFrustum = new Frustum();
    private frozenFrameData: FrameData | null = null;
    private modelCamera = vec3.create();
    private modelFrustumRust = new rust.ConvexHull();

    constructor(private device: GfxDevice, public world: WorldData | LazyWorldData, public renderHelper: GfxRenderHelper, private db: Database) {
        console.time("WdtScene construction");
        this.textureCache = new TextureCache(this.renderHelper.renderCache);
        this.terrainProgram = this.renderHelper.renderCache.createProgram(new TerrainProgram());
        this.waterProgram = this.renderHelper.renderCache.createProgram(new WaterProgram());
        this.modelProgram = this.renderHelper.renderCache.createProgram(new ModelProgram());
        this.particleProgram = this.renderHelper.renderCache.createProgram(new ParticleProgram());
        this.wmoProgram = this.renderHelper.renderCache.createProgram(new WmoProgram());
        this.skyboxProgram = this.renderHelper.renderCache.createProgram(new SkyboxProgram());
        this.loadingAdtProgram = this.renderHelper.renderCache.createProgram(new LoadingAdtProgram());

        this.setupSkyboxes();
        if (this.world.globalWmo) {
            this.mainView.freezeTime = true;
            this.setupWmoDef(this.world.globalWmoDef!);
            this.setupWmo(this.world.globalWmo);
        } else {
            for (let adt of this.world.adts) {
                this.setupAdt(adt);
            }
        }

        this.skyboxRenderer = new SkyboxRenderer(device, this.renderHelper);
        this.loadingAdtRenderer = new LoadingAdtRenderer(device, this.renderHelper);
        console.timeEnd("WdtScene construction");
    }

    public setupWmoDef(def: WmoDefinition) {
        this.wmoIdToDefs.appendUnique(def.wmoId, def);
        for (let doodad of def.doodadIndexToDoodad.values()) {
            this.modelIdToDoodads.appendUnique(doodad.modelId, doodad);
        }
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        if ("startAdtCoords" in this.world) {
            // if we're in a continent scene
            const [startX, startY] = this.world.startAdtCoords;
            vec3.set(scratchVec3, (32 - startY) * 533.33, (32 - startX) * 533.33, 0);
            transformVec3Mat4w1(scratchVec3, noclipSpaceFromAdtSpace, scratchVec3);
            mat4.fromTranslation(dst, scratchVec3);
        } else if (this.world.globalWmoDef) {
            mat4.getTranslation(scratchVec3, this.world.globalWmoDef!.modelMatrix);
            transformVec3Mat4w1(scratchVec3, noclipSpaceFromAdtSpace, scratchVec3);
            mat4.fromTranslation(dst, scratchVec3);
        } else {
            assert(this.world.adts.length > 0);
            this.world.adts[this.world.adts.length - 1].worldSpaceAABB.centerPoint(scratchVec3);
            transformVec3Mat4w1(scratchVec3, noclipSpaceFromAdtSpace, scratchVec3);
            mat4.fromTranslation(dst, scratchVec3);
        }
    }

    public async setupSkyboxes() {
        for (const skybox of this.world.skyboxes) {
            assert(skybox.modelData !== undefined);
            assert(skybox.modelFileId !== undefined);
            if (!this.skyboxModelRenderers.has(skybox.filename)) {
                this.skyboxModelRenderers.set(skybox.filename, new ModelRenderer(this.device, skybox.modelData, this.renderHelper, this.textureCache));
            }
        }
    }

    public setupAdt(adt: AdtData) {
        if (this.terrainRenderers.has(adt.fileId))
            return;

        this.terrainRenderers.set(adt.fileId, new TerrainRenderer(this.device, this.renderHelper, adt, this.textureCache));
        this.adtWaterRenderers.set(adt.fileId, new WaterRenderer(this.device, this.renderHelper, adt.liquids, adt.liquidTypes, this.textureCache));
        for (let lodData of adt.lodData) {
            for (let modelId of lodData.modelIds) {
                const model = adt.models.get(modelId)!;
                this.createModelRenderer(model);
            }
            for (let wmoDef of lodData.wmoDefs) {
                this.setupWmo(adt.wmos.get(wmoDef.wmoId)!);
                this.setupWmoDef(wmoDef);
            }
            for (let doodad of lodData.doodads) {
                this.modelIdToDoodads.append(doodad.modelId, doodad);
            }
        }
    }

    public setupWmo(wmo: WmoData) {
        if (this.wmoRenderers.has(wmo.fileId))
            return;

        this.wmoRenderers.set(wmo.fileId, new WmoRenderer(this.device, wmo, this.textureCache, this.renderHelper));
        this.wmoWaterRenderers.set(wmo.fileId, new WaterRenderer(this.device, this.renderHelper, wmo.liquids, wmo.liquidTypes, this.textureCache));
        for (let model of wmo.models.values()) {
            this.createModelRenderer(model);
        }
        if (wmo.skyboxModel) {
            this.wmoSkyboxRenderers.set(wmo.skyboxModel.fileId, new ModelRenderer(this.device, wmo.skyboxModel, this.renderHelper, this.textureCache));
        }
    }

    public createModelRenderer(model: ModelData) {
        if (!this.modelRenderers.has(model.fileId))
            this.modelRenderers.set(model.fileId, new ModelRenderer(this.device, model, this.renderHelper, this.textureCache));
    }

    public freezeCamera() {
        this.cameraState = CameraState.Frozen;
        vec3.copy(this.frozenCamera, this.mainView.cameraPos);
        this.frozenFrustum.copy(this.mainView.cullingFrustum);
    }

    public getCameraAndFrustum(): [vec3, Frustum] {
        if (this.cameraState === CameraState.Frozen) {
            return [this.frozenCamera, this.frozenFrustum];
        } else {
            return [this.mainView.cameraPos, this.mainView.cullingFrustum];
        }
    }

    public unfreezeCamera() {
        this.cameraState = CameraState.Running;
    }

    public freezeCulling(oneShot = false) {
        this.cullingState = oneShot ? CullingState.OneShot : CullingState.Paused;
    }

    public unfreezeCulling() {
        this.cullingState = CullingState.Running;
        this.frozenFrameData = null;
    }

    public cull() {
        const frame = new FrameData();
        if (this.world.globalWmo) {
            this.cullWmoDef(frame, this.world.globalWmoDef!, this.world.globalWmo);
        } else {
            const [worldCamera, worldFrustum] = this.getCameraAndFrustum();

            // Do a first pass and get candidate WMOs the camera's inside of,
            // disable WMOs not in the frustum, and determine if any ADTs are
            // visible based on where the camera is
            const wmosToCull: Map<number, [WmoData, WmoDefinition]> = new Map();
            for (let adt of this.world.adts) {
                adt.worldSpaceAABB.centerPoint(scratchVec3);
                const distance = vec3.distance(worldCamera, scratchVec3);
                adt.setLodLevel(distance < this.ADT_LOD0_DISTANCE ? 0 : 1);
                adt.setupWmoCandidates(worldCamera, worldFrustum);

                for (let def of adt.insideWmoCandidates) {
                    const wmo = adt.wmos.get(def.wmoId)!;
                    wmosToCull.set(def.uniqueId, [wmo, def]);
                }
            }

            let exteriorVisible = true;
            for (let [wmo, def] of wmosToCull.values()) {
                const cullResult = this.cullWmoDef(frame, def, wmo);
                if (cullResult === CullWmoResult.CameraInside) {
                    exteriorVisible = false;
                }
            }

            const wmosAlreadyCulled = Array.from(wmosToCull.keys());
            wmosToCull.clear();
            for (let adt of this.world.adts) {
                if (exteriorVisible) {
                    if (worldFrustum.contains(adt.worldSpaceAABB)) {
                        for (let i = 0; i < adt.chunkData.length; i++) {
                            const chunk = adt.chunkData[i];
                            if (worldFrustum.contains(chunk.worldSpaceAABB)) {
                                frame.addAdtChunk(adt, i);
                            }
                        }
                        for (let i = 0; i < adt.liquids.length; i++) {
                            const liquid = adt.liquids[i];
                            if (worldFrustum.contains(liquid.worldSpaceAABB)) {
                                frame.addAdtLiquid(adt, i);
                            }
                        }
                        for (let doodad of adt.lodDoodads()) {
                            if (worldFrustum.contains(doodad.worldAABB)) {
                                frame.addAdtDoodad(doodad);
                            }
                        }
                    }
                    for (let def of adt.visibleWmoCandidates) {
                        const wmo = adt.wmos.get(def.wmoId)!;
                        if (!wmosAlreadyCulled.includes(def.uniqueId)) {
                            wmosToCull.set(def.uniqueId, [wmo, def]);
                        }
                    }
                }
            }

            for (let [wmo, def] of wmosToCull.values()) {
                this.cullWmoDef(frame, def, wmo);
            }
        }
        return frame;
    }

    public cullWmoDef(frame: FrameData, def: WmoDefinition, wmo: WmoData): CullWmoResult {
        const [worldCamera, worldFrustum] = this.getCameraAndFrustum();

        // Check if we're looking at this particular world-space WMO, then do the
        // rest of culling in model space
        if (!worldFrustum.contains(def.worldAABB)) {
            return CullWmoResult.CameraOutside;
        }

        frame.addWmoDef(wmo, def);

        vec3.transformMat4(this.modelCamera, worldCamera, def.invPlacementMatrix);
        worldFrustum.copyToRust(this.modelFrustumRust);
        this.modelFrustumRust.transform_js(def.invPlacementMatrix as Float32Array);

        // Categorize groups by interior/exterior, and whether
        // the camera is present in them
        let startedInInteriorGroup = false;
        let frustumGroups: number[] = [];
        let memberGroups: number[] = [];
        for (let group of wmo.groups) {
            if (wmo.wmo.group_contains_modelspace_point(group.group, this.modelCamera as Float32Array)) {
                if (group.flags.show_skybox && wmo.skyboxModel) {
                    frame.activeWmoSkybox = wmo.skyboxModel.fileId;
                }
                if (!group.flags.exterior) {
                    startedInInteriorGroup = true;
                }
                memberGroups.push(group.fileId);
            }
            if (group.flags.exterior && wmo.wmo.group_in_modelspace_frustum(group.group, this.modelFrustumRust)) {
                frustumGroups.push(group.fileId);
            }
        }

        let rootGroups: number[];
        if (memberGroups.length > 0) {
            if (startedInInteriorGroup) {
                rootGroups = memberGroups;
            } else {
                rootGroups = memberGroups.concat(frustumGroups);
            }
        } else {
            rootGroups = frustumGroups;
        }

        // If we still don't have any groups, the user might be flying out of
        // bounds, just render the WMO geometry without doodads/liquids
        if (rootGroups.length === 0) {
            for (let group of wmo.groups) {
                frame.addWmoGroup(wmo, def, group.fileId, true);
            }
            return CullWmoResult.CameraOutside;
        }

        // do portal culling on the root groups
        let visibleGroups: number[] = [];
        for (let groupId of rootGroups) {
            wmo.portalCull(this.modelCamera, this.modelFrustumRust, groupId, visibleGroups, []);
        }

        let hasExternalGroup = false;
        for (let groupId of visibleGroups) {
            const group = wmo.getGroup(groupId)!;
            if (group.flags.exterior) {
                hasExternalGroup = true;
            }
            frame.addWmoGroup(wmo, def, groupId);
        }

        if (hasExternalGroup) {
            for (let groupId of frustumGroups) {
                frame.addWmoGroup(wmo, def, groupId);
            }
        }

        if (startedInInteriorGroup) {
            if (hasExternalGroup) {
                return CullWmoResult.CameraInsideAndExteriorVisible;
            } else {
                return CullWmoResult.CameraInside;
            }
        } else {
            return CullWmoResult.CameraOutside;
        }
    }

    private prepareToRender(): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back });
        template.setGfxProgram(this.skyboxProgram);
        template.setBindingLayouts(SkyboxProgram.bindingLayouts);

        const lightingData = this.db.getGlobalLightingData(this.world.lightdbMapId, this.mainView.cameraPos, this.mainView.time);
        BaseProgram.layoutUniformBufs(template, this.mainView, lightingData);
        renderInstManager.setCurrentRenderInstList(this.renderInstListSky);
        this.skyboxRenderer.prepareToRenderSkybox(renderInstManager);

        template.setGfxProgram(this.loadingAdtProgram);
        template.setBindingLayouts(LoadingAdtProgram.bindingLayouts);
        renderInstManager.setCurrentRenderInstList(this.renderInstListMain);
        this.loadingAdtRenderer.update(this.mainView);
        this.loadingAdtRenderer.prepareToRenderLoadingBox(renderInstManager, this.loadingAdts);

        const frame = this.frozenFrameData !== null ? this.frozenFrameData : this.cull();
            
        template.setGfxProgram(this.terrainProgram);
        template.setBindingLayouts(TerrainProgram.bindingLayouts);
        for (let renderer of this.terrainRenderers.values()) {
            renderer.prepareToRenderTerrain(renderInstManager, frame);
        }

        template.setGfxProgram(this.wmoProgram);
        template.setBindingLayouts(WmoProgram.bindingLayouts);
        for (let renderer of this.wmoRenderers.values()) {
            renderer.prepareToRenderWmo(renderInstManager, frame);
        }

        template.setGfxProgram(this.waterProgram);
        template.setBindingLayouts(WaterProgram.bindingLayouts);
        for (let [adtFileId, renderer] of this.adtWaterRenderers.entries()) {
            renderer.update(this.mainView);
            renderer.prepareToRenderAdtWater(renderInstManager, frame, adtFileId);
        }
        for (let [wmoId, renderer] of this.wmoWaterRenderers.entries()) {
            renderer.update(this.mainView);
            renderer.prepareToRenderWmoWater(renderInstManager, frame, wmoId);
        }

        template.setBindingLayouts(ModelProgram.bindingLayouts);
        template.setGfxProgram(this.modelProgram);
        renderInstManager.setCurrentRenderInstList(this.renderInstListSky);
        if (frame.activeWmoSkybox !== null) {
            const renderer = this.wmoSkyboxRenderers.get(frame.activeWmoSkybox);
            if (!renderer) {
                console.warn(
                    `couldn't find WMO skybox renderer for ${frame.activeWmoSkybox}`,
                );
            } else {
                renderer.update(this.mainView);
                renderer.prepareToRenderSkybox(renderInstManager, 1.0);
            }
        } else {
            const skyboxes = lightingData.get_skyboxes();
            for (let skybox of skyboxes) {
                const name = skybox.name;
                const renderer = this.skyboxModelRenderers.get(name);
                if (!renderer) {
                    console.warn(`couldn't find skybox renderer for "${name}"`);
                    continue;
                }
                renderer.update(this.mainView);
                renderer.prepareToRenderSkybox(renderInstManager, skybox.weight);

                skybox.free();
            }
        }
        renderInstManager.setCurrentRenderInstList(this.renderInstListMain);

        for (let [modelId, renderer] of this.modelRenderers.entries()) {
            let minDistance = Infinity;
            const doodads = frame.doodads
                .get(modelId)!
                .filter((doodad) => doodad.visible)
                .filter((doodad) => {
                    const dist = this.mainView.cameraDistanceToWorldSpaceAABB(doodad.worldAABB);
                    if (dist < minDistance) {
                        minDistance = dist;
                    }
                    return dist < this.mainView.cullingFarPlane;
                });
            if (doodads.length === 0) continue;

            template.setBindingLayouts(ModelProgram.bindingLayouts);
            template.setGfxProgram(this.modelProgram);
            renderer.update(this.mainView);
            renderer.prepareToRenderModel(renderInstManager, doodads);

            if (this.enableParticles && renderer.model.particleEmitters.length > 0) {
                template.setBindingLayouts(ParticleProgram.bindingLayouts);
                template.setGfxProgram(this.particleProgram);

                // LOD scales linearly w/ distance after 100 units
                let lod = ParticleEmitter.MAX_LOD;
                if (minDistance > 100.0) {
                    lod *= 1.0 - saturate(minDistance / this.mainView.cullingFarPlane);
                    lod = Math.floor(lod);
                }
                renderer.model.particleEmitters.forEach((emitter) => {
                    emitter.lod = lod;
                });
                renderer.prepareToRenderParticles(renderInstManager, doodads);
            }
        }

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();

        if (this.cullingState === CullingState.OneShot) {
            this.cullingState = CullingState.Paused;
        }

        if (this.cullingState === CullingState.Paused && this.frozenFrameData === null) {
            this.frozenFrameData = frame;
        }

        lightingData.free();
    }

    private updateCurrentAdt() {
        const adtCoords = this.getCurrentAdtCoords();
        if (adtCoords) {
            if (this.currentAdtCoords[0] !== adtCoords[0] || this.currentAdtCoords[1] !== adtCoords[1]) {
                this.currentAdtCoords = adtCoords;
                if (this.enableProgressiveLoading && "onEnterAdt" in this.world) {
                    const newCoords = this.world.onEnterAdt(
                        this.currentAdtCoords,
                        (coord: AdtCoord, maybeAdt: AdtData | undefined) => {
                            this.loadingAdts = this.loadingAdts.filter(([x, y]) => !(x === coord[0] && y === coord[1]));
                            if (maybeAdt) {
                                this.setupAdt(maybeAdt);
                            }
                        },
                    );
                    for (let coord of newCoords) {
                        this.loadingAdts.push(coord);
                    }
                }
            }
        }
    }

    public getCurrentAdtCoords(): [number, number] | undefined {
        const [worldY, worldX, _] = this.mainView.cameraPos;
        const adt_dimension = 533.33;
        const x_coord = Math.floor(32 - worldX / adt_dimension);
        const y_coord = Math.floor(32 - worldY / adt_dimension);
        if (x_coord >= 0 && x_coord < 64 && y_coord >= 0 && y_coord < 64) {
            return [x_coord, y_coord];
        }
        return undefined;
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.01);
    }

    public dbgTeleportWorldSpaceCoord(pos: vec3) {
        vec3.transformMat4(pos, pos, noclipSpaceFromAdtSpace);
        const wmtx = window.main.viewer.camera.worldMatrix;
        setMatrixTranslation(wmtx, pos);
        console.log(`Teleported to: ${pos}`);
    }

    public debugTeleport() {
        const worldPos = vec3.create();
        if (this.world.globalWmoDef) {
            this.world.globalWmoDef!.worldAABB.centerPoint(worldPos);
        } else {
            this.world.adts[this.world.adts.length - 1].worldSpaceAABB.centerPoint(worldPos);
        }
        this.dbgTeleportWorldSpaceCoord(worldPos);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1);
        this.mainView.setupFromViewerInput(viewerInput);
        this.updateCurrentAdt();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");
        builder.pushPass((pass) => {
            const skyDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Sky Depth");
            pass.setDebugName("Sky");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
        this.renderInstListSky.reset();
    }

    public destroy(device: GfxDevice): void {
        for (let renderer of this.terrainRenderers.values()) {
            renderer.destroy(device);
        }
        for (let renderer of this.modelRenderers.values()) {
            renderer.destroy(device);
        }
        for (let renderer of this.wmoRenderers.values()) {
            renderer.destroy(device);
        }
        for (let renderer of this.adtWaterRenderers.values()) {
            renderer.destroy(device);
        }
        for (let renderer of this.wmoWaterRenderers.values()) {
            renderer.destroy(device);
        }
        this.loadingAdtRenderer.destroy(device);
        this.skyboxRenderer.destroy(device);
        this.textureCache.destroy(device);
        this.renderHelper.destroy();
    }
}

class WdtSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public name: string, public fileId: number, public lightdbMapId: number) {
        this.id = `${name}-${fileId}`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const cache = await context.dataShare.ensureObject(
            `${vanillaSceneGroup.id}/WowCache`,
            async () => {
                const db = new Database();
                const cache = new WowCache(dataFetcher, db);
                await cache.load();
                return cache;
            },
        );
        const renderHelper = new GfxRenderHelper(device);
        rust.init_panic_hook();
        const wdt = new WorldData(this.fileId, cache, this.lightdbMapId);
        console.time("loading wdt");
        await wdt.load(cache);
        console.timeEnd("loading wdt");
        return new WdtScene(device, wdt, renderHelper, cache.db);
    }
}

class ContinentSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public name: string, public fileId: number, public startX: number, public startY: number, public lightdbMapId: number) {
        this.id = `${name}-${fileId}`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const cache = await context.dataShare.ensureObject(
            `${vanillaSceneGroup.id}/WowCache`,
            async () => {
                const db = new Database();
                const cache = new WowCache(dataFetcher, db);
                await cache.load();
                return cache;
            },
        );
        const renderHelper = new GfxRenderHelper(device);
        rust.init_panic_hook();
        const wdt = new LazyWorldData(this.fileId, [this.startX, this.startY], cache, this.lightdbMapId);
        console.time("loading wdt");
        await wdt.load();
        console.timeEnd("loading wdt");
        const scene = new WdtScene(device, wdt, renderHelper, cache.db);
        scene.enableProgressiveLoading = true;
        return scene;
    }
}

const vanillaSceneDescs = [
    "Eastern Kingdoms",
    new ContinentSceneDesc("Ironforge, Dun Morogh", 775971, 33, 40, 0),
    new ContinentSceneDesc("Stormwind, Elwynn Forest", 775971, 31, 48, 0),
    new ContinentSceneDesc("Undercity, Tirisfal Glades", 775971, 31, 28, 0),
    new ContinentSceneDesc("Lakeshire, Redridge Mountains", 775971, 36, 49, 0),
    new ContinentSceneDesc("Blackrock Mountain, Burning Steppes", 775971, 34, 45, 0),
    new ContinentSceneDesc("Booty Bay, Stranglethorn Vale", 775971, 31, 58, 0),
    new ContinentSceneDesc("Light's Hope Chapel, Eastern Plaguelands", 775971, 41, 27, 0),
    new ContinentSceneDesc("Aerie Peak, Hinterlands", 775971, 35, 31, 0),
    new ContinentSceneDesc("Tarren Mill, Hillsbrad Foothills", 775971, 33, 32, 0),
    new ContinentSceneDesc("Stonewrought Dam, Loch Modan", 775971, 38, 40, 0),
    new ContinentSceneDesc("Kargath, Badlands", 775971, 36, 44, 0),
    new ContinentSceneDesc("Thorium Point, Searing Gorge", 775971, 34, 44, 0),
    new ContinentSceneDesc("Stonard, Swamp of Sorrows", 775971, 38, 51, 0),
    new ContinentSceneDesc("Nethergarde Keep, Blasted Lands", 775971, 38, 52, 0),
    new ContinentSceneDesc("The Dark Portal, Blasted Lands", 775971, 38, 54, 0),
    new ContinentSceneDesc("Darkshire, Duskwood", 775971, 34, 51, 0),
    new ContinentSceneDesc("Grom'gol Base Camp, Stranglethorn Vale", 775971, 31, 55, 0),
    new ContinentSceneDesc("Gurubashi Arena, Stranglethorn Vale", 775971, 31, 56, 0),
    new ContinentSceneDesc("Sentinel Hill, Westfall", 775971, 30, 51, 0),
    new ContinentSceneDesc("Karazhan, Deadwind Pass", 775971, 35, 52, 0),
    new ContinentSceneDesc("Southshore, Hillsbrad Foothills", 775971, 33, 33, 0),

    "Kalimdor",
    new ContinentSceneDesc("Thunder Bluff, Mulgore", 782779, 31, 34, 1),
    new ContinentSceneDesc("Darnassus, Teldrassil", 782779, 27, 13, 1),
    new ContinentSceneDesc("GM Island", 782779, 1, 1, 1),
    new ContinentSceneDesc("Archimonde's Bones, Hyjal", 782779, 38, 22, 1),
    new ContinentSceneDesc("Everlook, Winterspring", 782779, 40, 19, 1),
    new ContinentSceneDesc("Auberdine, Darkshore", 782779, 31, 19, 1),
    new ContinentSceneDesc("Astranaar, Ashenvale", 782779, 32, 26, 1),
    new ContinentSceneDesc("Mor'shan Rampart, Barrens", 782779, 36, 29, 1),
    new ContinentSceneDesc("Splintertree Post, Ashenvale", 782779, 36, 27, 1),
    new ContinentSceneDesc("Bloodvenom Post, Felwood", 782779, 32, 22, 1),
    new ContinentSceneDesc("Talonbranch Glade, Felwood", 782779, 34, 24, 1),
    new ContinentSceneDesc("The Crossroads, Barrens", 782779, 36, 32, 1),
    new ContinentSceneDesc("Orgrimmar, Durotar", 782779, 40, 29, 1),
    new ContinentSceneDesc("Ratchet, Barrens", 782779, 39, 33, 1),
    new ContinentSceneDesc("Sun Rock Retreat, Stonetalon Mountains", 782779, 30, 30, 1),
    new ContinentSceneDesc("Nijel's Point, Desolace", 782779, 29, 31, 1),
    new ContinentSceneDesc("Shadowprey Village, Desolace", 782779, 25, 35, 1),
    new ContinentSceneDesc("Dire Maul Arena, Feralas", 782779, 29, 38, 1),
    new ContinentSceneDesc("Thalanaar, Feralas", 782779, 33, 40, 1),
    new ContinentSceneDesc("Camp Mojache, Feralas", 782779, 31, 40, 1),
    new ContinentSceneDesc("Feathermoon Stronghold, Feralas", 782779, 25, 40, 1),
    new ContinentSceneDesc("Cenarion Hold, Silithus", 782779, 30, 44, 1),
    new ContinentSceneDesc("Marshal's Refuge, Un'Goro Crater", 782779, 34, 43, 1),
    new ContinentSceneDesc("Gadgetzan, Tanaris", 782779, 39, 45, 1),
    new ContinentSceneDesc("Mirage Raceway, Thousand Needles", 782779, 39, 43, 1),
    new ContinentSceneDesc("Freewind Post, Thousand Needles", 782779, 35, 41, 1),
    new ContinentSceneDesc("Theramore Isle, Dustwallow Marsh", 782779, 40, 39, 1),
    new ContinentSceneDesc("Alcaz Island, Dustwallow Marsh", 782779, 41, 37, 1),

    "Instances",
    new WdtSceneDesc("Zul-Farak", 791169, 209),
    new WdtSceneDesc("Blackrock Depths", 780172, 230),
    new WdtSceneDesc("Scholomance", 790713, 289),
    new WdtSceneDesc("Deeprun Tram", 780788, 369),
    new WdtSceneDesc("Deadmines", 780605, 36),
    new WdtSceneDesc("Shadowfang Keep", 790796, 33),
    new WdtSceneDesc("Blackrock Spire", 780175, 229),
    new WdtSceneDesc("Stratholme", 791063, 329),
    new WdtSceneDesc("Mauradon", 788656, 349),
    new WdtSceneDesc("Wailing Caverns", 791429, 43),
    new WdtSceneDesc("Razorfen Kraul", 790640, 47),
    new WdtSceneDesc("Razorfen Downs", 790517, 129),
    new WdtSceneDesc("Blackfathom Deeps", 780169, 48),
    new WdtSceneDesc("Uldaman", 791372, 70),
    new WdtSceneDesc("Gnomeregon", 782773, 90),
    new WdtSceneDesc("Sunken Temple", 791166, 109),
    new WdtSceneDesc("Scarlet Monastery - Graveyard", 788662, 189),
    new WdtSceneDesc("Scarlet Monastery - Cathedral", 788662, 189),
    new WdtSceneDesc("Scarlet Monastery - Library", 788662, 189),
    new WdtSceneDesc("Scarlet Monastery - Armory", 788662, 189),
    new WdtSceneDesc("Ragefire Chasm", 789981, 389),
    new WdtSceneDesc("Dire Maul", 780814, 429),

    "Raids",
    new WdtSceneDesc("Onyxia's Lair", 789922, 249),
    new WdtSceneDesc("Molten Core", 788659, 409),
    new WdtSceneDesc("Blackwing Lair", 780178, 469),
    new WdtSceneDesc("Zul'gurub", 791432, 309),
    new WdtSceneDesc("Naxxramas", 827115, 533),
    new WdtSceneDesc("Ahn'Qiraj Temple", 775840, 531),
    new WdtSceneDesc("Ruins of Ahn'qiraj", 775637, 509),

    "PvP",
    new WdtSceneDesc("Alterac Valley", 790112, 30), // AKA pvpzone01
    new WdtSceneDesc("Warsong Gulch", 790291, 489), // AKA pvpzone03
    new WdtSceneDesc("Arathi Basin", 790377, 529), // AKA pvpzone04

    "Unreleased",
    new WdtSceneDesc('PvP Zone 02 ("Azshara Crater")', 861092, 0),
    new WdtSceneDesc("Dragon Isles, Developer Island", 857684, 0),
    new WdtSceneDesc("Swamp of Sorrows Prototype, Developer Island", 857684, 0),
    new WdtSceneDesc("Water test, Developer Island", 857684, 0),
    new WdtSceneDesc("Verdant Fields, Emerald Dream", 780817, 0),
    new WdtSceneDesc("Emerald Forest, Emerald Dream", 780817, 0),
    new WdtSceneDesc("Untextured canyon, Emerald Dream", 780817, 0),
    new WdtSceneDesc("Test 01", 2323096, 0),
    new WdtSceneDesc("Scott Test", 863335, 0),
    new WdtSceneDesc("Collin Test", 863984, 0),
    new WdtSceneDesc("Scarlet Monastery Prototype", 865519, 189),
];

const bcSceneDescs = [
    "Instances",
    new WdtSceneDesc("Hellfire Citadel: The Shattered Halls", 831277, 540),
    new WdtSceneDesc("Hellfire Citadel: The Blood Furnace", 830642, 542),
    new WdtSceneDesc("Hellfire Citadel: Ramparts", 832154, 543),
    new WdtSceneDesc("Coilfang: The Steamvault", 828422, 545),
    new WdtSceneDesc("Coilfang: The Underbog", 831262, 546),
    new WdtSceneDesc("Coilfang: The Slave Pens", 830731, 547),
    new WdtSceneDesc("Caverns of Time: The Escape from Durnholde", 833998, 560),
    new WdtSceneDesc("Tempest Keep: The Arcatraz", 832070, 552),
    new WdtSceneDesc("Tempest Keep: The Botanica", 833950, 553),
    new WdtSceneDesc("Tempest Keep: The Mechanar", 831974, 554),
    new WdtSceneDesc("Auchindoun: Shadow Labyrinth", 828331, 555),
    new WdtSceneDesc("Auchindoun: Sethekk Halls", 828811, 556),
    new WdtSceneDesc("Auchindoun: Mana-Tombs", 830899, 557),
    new WdtSceneDesc("Auchindoun: Auchenai Crypts", 830415, 558),
    new WdtSceneDesc("The Sunwell: Magister's Terrace", 834223, 585),

    "Raids",
    new WdtSceneDesc("Tempest Keep", 832484, 550),
    new WdtSceneDesc("Karazhan", 834192, 532),
    new WdtSceneDesc("Caverns of Time: Hyjal", 831824, 534),
    new WdtSceneDesc("Black Temple", 829630, 565),
    new WdtSceneDesc("Gruul's Lair", 833180, 565),
    new WdtSceneDesc("Zul'Aman", 815727, 568),
    new WdtSceneDesc("The Sunwell: Plateau", 832953, 580),
    new WdtSceneDesc("Magtheridon's Lair", 833183, 544),
    new WdtSceneDesc("Coilfang: Serpentshrine Cavern", 829900, 548),

    "PvP",
    new WdtSceneDesc("Eye of the Storm", 788893, 566),
    new WdtSceneDesc("Arena: Nagrand", 790469, 559),
    new WdtSceneDesc("Arena: Blade's Edge", 780261, 562),

    "Outland",
    new ContinentSceneDesc("The Dark Portal", 828395, 29, 32, 530),
    new ContinentSceneDesc("Shattrath", 828395, 22, 35, 530),
    new ContinentSceneDesc("Silvermoon City, Eversong Woods", 828395, 45, 14, 530),
    new ContinentSceneDesc("Exodar, Azuremist Isle", 828395, 54, 39, 530),
];

const wotlkSceneDescs = [
    "Instances",
    new WdtSceneDesc("Ebon Hold", 818210, 609),
    new WdtSceneDesc("Utgarde Keep", 825743, 574),
    new WdtSceneDesc("Utgarde Pinnacle", 827661, 575),
    new WdtSceneDesc("Drak'Theron Keep", 820968, 600),
    new WdtSceneDesc("Violet Hold", 818205, 608),
    new WdtSceneDesc("Gundrak", 818626, 604),
    new WdtSceneDesc("Ahn'kahet: The Old Kingdom", 818056, 619),
    new WdtSceneDesc("Azjol'Nerub", 818693, 601),
    new WdtSceneDesc("Halls of Stone", 824642, 599),
    new WdtSceneDesc("Halls of Lightning", 824768, 602),
    new WdtSceneDesc("The Oculus", 819814, 578),
    new WdtSceneDesc("The Nexus", 821331, 576),
    new WdtSceneDesc("The Culling of Stratholme", 826005, 0), // map is actually 595
    new WdtSceneDesc("Trial of the Champion", 817987, 650),
    new WdtSceneDesc("The Forge of Souls", 818965, 632),
    new WdtSceneDesc("Pit of Saron", 827056, 0), // map id is actually 658
    new WdtSceneDesc("Halls of Reflection", 818690, 668),

    "Raids",
    new WdtSceneDesc("Icecrown Citadel", 820428, 0), // map id is actually 631
    new WdtSceneDesc("Ulduar", 825015, 603),
    new WdtSceneDesc("The Obsidian Sanctum", 820448, 615),
    new WdtSceneDesc("The Ruby Sanctum", 821024, 724),
    new WdtSceneDesc("Vault of Archavon", 826589, 624),
    new WdtSceneDesc("Trial of the Crusader", 818173, 649),
    new WdtSceneDesc("The Eye of Eternity", 822560, 616),

    "PvP",
    new WdtSceneDesc("Strand of the Ancients", 789579, 607),
    new WdtSceneDesc("Isle of Conquest", 821811, 0), // map id is actually 628
    new WdtSceneDesc("Arena: Dalaran Sewers", 780309, 617),
    new WdtSceneDesc("Arena: The Ring of Valor", 789925, 618),

    "Northrend",
    new ContinentSceneDesc("Icecrown Citadel, Icecrown", 822688, 27, 20, 571),
    new ContinentSceneDesc("Dalaran, Crystalsong Forest", 822688, 30, 20, 571),
    new ContinentSceneDesc("Wyrmrest Temple, Dragonblight", 822688, 31, 24, 571),
];

export const vanillaSceneGroup: Viewer.SceneGroup = {
    id: "WorldOfWarcraft",
    name: "World of Warcraft",
    sceneDescs: vanillaSceneDescs,
    hidden: false,
};

export const bcSceneGroup: Viewer.SceneGroup = {
    id: "WorldOfWarcraftBC",
    name: "World of Warcraft: The Burning Crusade",
    sceneDescs: bcSceneDescs,
    hidden: true,
};

export const wotlkSceneGroup: Viewer.SceneGroup = {
    id: "WorldOfWarcraftWOTLK",
    name: "World of Warcraft: Wrath of the Lich King",
    sceneDescs: wotlkSceneDescs,
    hidden: true,
};
