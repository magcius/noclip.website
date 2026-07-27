
import * as Viewer from '../viewer.js';
import * as BYML from '../byml.js';
import * as UI from '../ui.js';

import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { assert, hexzero } from '../util.js';
import { mat4, vec3 } from 'gl-matrix';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { FakeTextureHolder } from '../TextureHolder.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { CameraController } from '../Camera.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import * as Deflate from '../Common/Compression/Deflate.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { AnimatedTexture, RSPSharedOutput, RSPState, runDL_F3DEX2 } from './f3dex2.js';
import { ActiveLightCache, buildDynamicLights, buildMapChunkLighting, buildObjectLighting, buildObjectLightingEnvironment } from './light.js';
import type { DynamicLight, ObjectLightingEnvironment } from './light.js';
import { ActorAnimationPose, actorModelScale, buildActorGeometry, getActorRenderDefinition } from './actors.js';
import type { ActorRenderDefinition } from './actors.js';
import { addModel2Props, buildTerrainTriangles } from './props.js';
import {
    getGeneratedSurfaceAnimatedTextureBindings,
    getSceneNodeAnimatedTextureBindings, initDL, initGeneratedSurfaceMaterial,
    initSceneNodeMaterial,
} from './material.js';
import type { AnimatedMaterialTextureBinding } from './material.js';
import { DK64Map, parseInstanceScripts, parseSetup } from './parse.js';
import type { GeneratedSurface, SetupActor } from './parse.js';
import { createBackdropRenderer } from './background.js';
import type { BackdropData, BackdropRenderer } from './background.js';
import {
    bindingLayouts, fogPositionToViewDistance, generatedSurfaceHeight, GPUTextureCache,
    GeometryData, GeometryRenderer, DK64Layer,
} from './render.js';
import type { FogParams, Geometry } from './render.js';
import { addEnvironmentalEffects } from './particles.js';
import type { EnvironmentParticleData, SpriteData } from './particles.js';

const pathBase = `DonkeyKong64`;

function resolveAnimatedMaterialTextures(bindings: readonly AnimatedMaterialTextureBinding[], textures: ArrayBufferSlice[]): AnimatedTexture[] {
    return bindings.map((binding) => ({
        segment: binding.segment,
        group: 0,
        frameDuration: binding.frameDuration,
        frames: binding.textureIDs.map((textureID) => textures[textureID]),
    }));
}

function createGeneratedSurfaceVertexBuffer(surface: GeneratedSurface): ArrayBufferSlice {
    const buffer = new ArrayBuffer(surface.columns * surface.rows * 0x10);
    const view = new DataView(buffer);
    let offs = 0;
    for (let row = 0; row < surface.rows; row++) {
        const z = Math.min(surface.minZ + row * surface.step, surface.maxZ);
        for (let column = 0; column < surface.columns; column++) {
            const x = Math.min(surface.minX + column * surface.step, surface.maxX);
            const y = generatedSurfaceHeight(surface, x, z, 0);
            const alpha = Math.max(0, Math.min(0xFF, Math.trunc(
                ((y - surface.baseY) / (surface.amplitudeS + surface.amplitudeT))
                * surface.alphaRange + surface.alphaBase,
            )));
            view.setInt16(offs + 0x00, x * 3);
            view.setInt16(offs + 0x02, Math.trunc(y * 3));
            view.setInt16(offs + 0x04, z * 3);
            view.setInt16(offs + 0x08, Math.trunc(x * surface.textureScale) % 0x7FFF);
            view.setInt16(offs + 0x0A, Math.trunc(z * surface.textureScale) % 0x7FFF);
            view.setUint8(offs + 0x0C, surface.colorR);
            view.setUint8(offs + 0x0D, surface.colorG);
            view.setUint8(offs + 0x0E, surface.colorB);
            view.setUint8(offs + 0x0F, alpha);
            offs += 0x10;
        }
    }
    return new ArrayBufferSlice(buffer);
}

export class DK64Renderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private backdropRenderer: BackdropRenderer | null;
    private activeLightCache: ActiveLightCache;
    public gpuTextureCache = new GPUTextureCache();

    public geoDatas: GeometryData[] = [];
    public geoRenderers: GeometryRenderer[] = [];
    public fogParams: FogParams;

    public textureHolder = new FakeTextureHolder([]);

    constructor(device: GfxDevice, sceneID: number, clipNear: number, clipFar: number, backdrop: BackdropData | null, dynamicLights: readonly DynamicLight[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.backdropRenderer = createBackdropRenderer(device, this.renderHelper.renderCache, backdrop, sceneID);
        this.activeLightCache = new ActiveLightCache(dynamicLights);
        // from func_global_asm_80648C84: Aztec has custom fog pos overrides.
        const fogNearPosition = sceneID === 0x26 ? 995 : 990;
        this.fogParams = {
            // Note that fog positions are in DK64 projected-depth units.
            near: fogPositionToViewDistance(fogNearPosition, clipNear, clipFar),
            far: fogPositionToViewDistance(999, clipNear, clipFar),
            color: sceneID === 0x26
                ? [0x8A / 0xFF, 0x52 / 0xFF, 0x16 / 0xFF, 0]
                : [0, 0, 0, 0],
        };
    }

    public addGeoData(device: GfxDevice, cache: GfxRenderCache, geo: Geometry): GeometryData {
        const geoData = new GeometryData(device, cache, geo);
        this.geoDatas.push(geoData);
        return geoData;
    }

    public addPropRenderer(device: GfxDevice, cache: GfxRenderCache, geoData: GeometryData, sharedRenderer: GeometryRenderer | null = null): GeometryRenderer {
        const renderer = new GeometryRenderer(device, cache, geoData, DK64Layer.Props, this.fogParams, this.gpuTextureCache, sharedRenderer);
        this.geoRenderers.push(renderer);
        return renderer;
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const enableCullingCheckbox = new UI.Checkbox('Enable Culling', true);
        enableCullingCheckbox.onchanged = () => {
            for (const geoRenderer of this.geoRenderers)
                geoRenderer.setBackfaceCullingEnabled(enableCullingCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableCullingCheckbox.elem);

        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (const geoRenderer of this.geoRenderers)
                geoRenderer.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        const enableDynamicLightingCheckbox = new UI.Checkbox('Enable Dynamic Lighting', true);
        enableDynamicLightingCheckbox.onchanged = () => {
            for (const geoData of this.geoDatas)
                geoData.setDynamicLightingEnabled(enableDynamicLightingCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableDynamicLightingCheckbox.elem);

        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (const geoRenderer of this.geoRenderers)
                geoRenderer.setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const enableFog = new UI.Checkbox('Enable Fog', false);
        enableFog.onchanged = () => {
            for (const geoRenderer of this.geoRenderers)
                geoRenderer.setFogEnabled(enableFog.checked);
        };
        renderHacksPanel.contents.appendChild(enableFog.elem);

        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (const geoRenderer of this.geoRenderers)
                geoRenderer.setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);

        const enableAlphaVisualizer = new UI.Checkbox('Visualize Vertex Alpha', false);
        enableAlphaVisualizer.onchanged = () => {
            for (const geoRenderer of this.geoRenderers)
                geoRenderer.setAlphaVisualizerEnabled(enableAlphaVisualizer.checked);
        };
        renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        const addVisibilityCheckbox = (label: string, layer: DK64Layer): void => {
            const checkbox = new UI.Checkbox(label, true);
            checkbox.onchanged = () => {
                for (const geoRenderer of this.geoRenderers) {
                    if (geoRenderer.renderLayer === layer)
                        geoRenderer.setVisible(checkbox.checked);
                }
            };
            renderHacksPanel.contents.appendChild(checkbox.elem);
        };
        addVisibilityCheckbox('Show Map Geometry', DK64Layer.MapGeometry);
        addVisibilityCheckbox('Show Actors', DK64Layer.Actors);
        addVisibilityCheckbox('Show Props', DK64Layer.Props);
        addVisibilityCheckbox('Show Surfaces', DK64Layer.Surfaces);
        addVisibilityCheckbox('Show Effects', DK64Layer.Effects);

        return [renderHacksPanel];
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.backdropRenderer?.prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        const tick = Math.floor(viewerInput.time / (1000 / 30));
        this.activeLightCache.update(viewerInput.camera.worldMatrix, tick);
        for (let i = 0; i < this.geoRenderers.length; i++)
            this.geoRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, this.activeLightCache);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.backdropRenderer?.destroy(device);
        this.renderHelper.destroy();
        for (let i = 0; i < this.geoRenderers.length; i++)
            this.geoRenderers[i].destroy(device);
        for (let i = 0; i < this.geoDatas.length; i++)
            this.geoDatas[i].destroy(device);
        this.gpuTextureCache.destroy(device);
    }
}

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const view = buffer.createDataView();
    assert(view.getUint32(0x00) === 0x1F8B0800);
    const decompressed = Deflate.decompress_raw(buffer.slice(0x0A));
    return decompressed;
}

class TextureData {
    public TexData: ArrayBufferSlice[] = [];
    public AnimTexData: ArrayBufferSlice[] = [];

    public static fromBuffer(buffer: ArrayBufferSlice): TextureData {
        return new TextureData(BYML.parse(buffer, BYML.FileType.CRG1));
    }

    constructor(obj: any) {
        applyTextureEntries(this.TexData, obj.TexData, true);
        applyTextureEntries(this.AnimTexData, obj.AnimTexData, false);
    }

    public destroy(device: GfxDevice): void {
    }
}

class CommonData extends TextureData {
    public SpriteData: SpriteData[];
    public CustomScriptFunctionData: number[];

    constructor(buffer: ArrayBufferSlice) {
        const obj: any = BYML.parse(buffer, BYML.FileType.CRG1);
        super(obj);
        this.SpriteData = obj.SpriteData ?? [];
        this.CustomScriptFunctionData = obj.CustomScriptFunctionData ?? [];
    }
}

function applyTextureEntries(target: ArrayBufferSlice[], entries: any[] | undefined, compressed: boolean): void {
    for (const entry of entries ?? [])
        target[entry.ID] = compressed ? decompress(entry.Data) : entry.Data;
}

function overlayTextureData(target: ArrayBufferSlice[], source: ArrayBufferSlice[]): void {
    for (let id = 0; id < source.length; id++) {
        if (source[id] !== undefined)
            target[id] = source[id];
    }
}

export class ROMData {
    public MapData: ArrayBufferSlice;
    public Backdrop: BackdropData | null;
    public PropGeometryData = new Map<number, ArrayBufferSlice>();
    public ActorDefinitions = new Map<number, number>();
    public ActorGeometryData = new Map<number, ArrayBufferSlice>();
    public AnimationData = new Map<number, ArrayBufferSlice>();
    public SetupData: ArrayBufferSlice;
    public ScriptData: ArrayBufferSlice;
    public CritterData: ArrayBufferSlice | null;
    public EnvironmentParticleData: EnvironmentParticleData[];

    public SpriteData: SpriteData[];
    public CustomScriptFunctionData: number[];
    public TexData: ArrayBufferSlice[];
    public AnimTexData: ArrayBufferSlice[];

    constructor(common: CommonData, level: any, commonTextureGroups: TextureData[]) {
        this.MapData = level.MapData;
        this.SetupData = level.SetupData;
        this.ScriptData = level.ScriptData;
        this.CritterData = level.CritterData;
        this.EnvironmentParticleData = level.EnvironmentParticleData ?? [];
        for (const prop of level.PropGeometry ?? [])
            this.PropGeometryData.set(prop.Type, prop.Data);
        for (const actor of level.ActorDefinitions ?? [])
            this.ActorDefinitions.set(actor.Type, actor.Model);
        for (const actor of level.ActorGeometry ?? [])
            this.ActorGeometryData.set(actor.Model, actor.Data);
        for (const animation of level.AnimationData ?? [])
            this.AnimationData.set(animation.ID, animation.Data);

        this.SpriteData = common.SpriteData;
        this.CustomScriptFunctionData = common.CustomScriptFunctionData;
        this.TexData = common.TexData.slice();
        this.AnimTexData = common.AnimTexData.slice();
        for (const group of commonTextureGroups) {
            overlayTextureData(this.TexData, group.TexData);
            overlayTextureData(this.AnimTexData, group.AnimTexData);
        }
        applyTextureEntries(this.TexData, level.TexData, true);
        applyTextureEntries(this.AnimTexData, level.AnimTexData, false);
        const backdrop = level.Backdrop ?? null;
        if (backdrop !== null) {
            const data = this.TexData[backdrop.TextureIndex];
            this.Backdrop = { TextureID: backdrop.TextureID, Data: data! };
        } else {
            this.Backdrop = null;
        }
    }

    public loadSetup(): ArrayBufferSlice {
        return decompress(this.SetupData);
    }

    public loadPropGeometry(propType: number): ArrayBufferSlice {
        const data = this.PropGeometryData.get(propType);
        return decompress(data!);
    }

    public loadActorGeometry(model: number): ArrayBufferSlice {
        const data = this.ActorGeometryData.get(model);
        return decompress(data!);
    }

    public loadAnimation(id: number): ArrayBufferSlice {
        return this.AnimationData.get(id)!;
    }

    public loadScripts(): ArrayBufferSlice {
        return decompress(this.ScriptData);
    }

    public destroy(device: GfxDevice): void {
    }
}


function addSceneActors(
    device: GfxDevice,
    cache: GfxRenderCache,
    sceneRenderer: DK64Renderer,
    sharedOutput: RSPSharedOutput,
    romData: ROMData,
    setupActors: readonly SetupActor[],
    worldScale: number,
    lightingEnvironment: ObjectLightingEnvironment,
    getActorPose: (definition: ActorRenderDefinition, speed: number) => ActorAnimationPose,
): void {
    const actors: { actor: SetupActor, definition: ActorRenderDefinition }[] = [];
    for (const actor of setupActors) {
        const definition = getActorRenderDefinition(actor.type, romData.ActorDefinitions.get(actor.type) ?? 0);
        if (definition !== null)
            actors.push({ actor, definition });
    }

    const geoDataByDefinition = new Map<string, GeometryData>();
    for (const { actor, definition } of actors) {
        const animationSpeed = definition.animationSpeed === 'setup' ? actor.lightSpeed : definition.animationSpeed;
        const geometryKey = `${definition.model}:${definition.animation ?? -1}:${animationSpeed}`;
        let geoData = geoDataByDefinition.get(geometryKey);
        if (geoData === undefined) {
            const actorGeometry = buildActorGeometry(
                romData.loadActorGeometry(definition.model),
                getActorPose(definition, animationSpeed),
                actor.type,
                romData.TexData,
                sharedOutput,
            );
            const geometry: Geometry = {
                sharedOutput,
                rspState: actorGeometry.rspState,
                rspOutput: actorGeometry.rspOutput,
                actorAnimation: actorGeometry.animation,
            };
            geoData = new GeometryData(device, cache, geometry);
            sceneRenderer.geoDatas.push(geoData);
            geoDataByDefinition.set(geometryKey, geoData);
        }
        const rendererScale = actor.scale * actorModelScale * worldScale;
        const renderer = new GeometryRenderer(device, cache, geoData, DK64Layer.Actors, sceneRenderer.fogParams, sceneRenderer.gpuTextureCache);
        const origin = vec3.fromValues(
            actor.position[0] * worldScale,
            actor.position[1] * worldScale,
            actor.position[2] * worldScale,
        );
        mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [
            origin[0],
            origin[1],
            origin[2],
        ]);
        mat4.rotateY(renderer.modelMatrix, renderer.modelMatrix, actor.rotationY / 0x1000 * Math.PI * 2);
        mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [rendererScale, rendererScale, rendererScale]);
        renderer.setObjectLighting(buildObjectLighting(lightingEnvironment, origin));
        if (definition.rotationYSpeed !== undefined)
            renderer.setRotationYAnimation(definition.rotationYSpeed);
        if (definition.positionYAmplitude !== undefined)
            renderer.setPositionYAnimation(definition.positionYAmplitude * worldScale, definition.rotationYSpeed ?? 0);
        renderer.setCullBoundingBox(renderer.computeWorldBoundingBox());
        sceneRenderer.geoRenderers.push(renderer);
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const sceneID = parseInt(this.id, 16);
        const [commonData, levelBuffer] = await Promise.all([
            context.dataShare.ensureObject(`${pathBase}/CommonData`, async () => {
                return new CommonData(await dataFetcher.fetchData(`${pathBase}/common.crg1`));
            }),
            dataFetcher.fetchData(`${pathBase}/${this.id}.crg1`),
        ]);
        const levelData: any = BYML.parse(levelBuffer, BYML.FileType.CRG1);
        const commonTextureGroupIDs: number[] = levelData.CommonTextureGroups ?? [];
        const commonTextureGroups = await Promise.all(commonTextureGroupIDs.map((groupID) => {
            const suffix = hexzero(groupID, 2).toUpperCase();
            return context.dataShare.ensureObject(`${pathBase}/CommonTextureData/${suffix}`, async () => {
                return TextureData.fromBuffer(await dataFetcher.fetchData(`${pathBase}/common_${suffix}.crg1`));
            });
        }));
        const romData = new ROMData(commonData, levelData, commonTextureGroups);
        const map = new DK64Map(decompress(romData.MapData), romData.AnimTexData);
        const setup = parseSetup(romData.loadSetup());
        const scripts = parseInstanceScripts(romData.loadScripts());
        const actorPoses = new Map<string, ActorAnimationPose>();
        const getActorPose = (definition: ActorRenderDefinition, speed: number): ActorAnimationPose => {
            const key = `${definition.model}:${definition.animation ?? -1}:${speed}`;
            let pose = actorPoses.get(key);
            if (pose === undefined) {
                pose = new ActorAnimationPose(
                    romData.loadActorGeometry(definition.model),
                    definition.animation !== null ? romData.loadAnimation(definition.animation) : null,
                    speed,
                );
                actorPoses.set(key, pose);
            }
            return pose;
        };
        const dynamicLights = buildDynamicLights(
            setup,
            (type) => romData.loadPropGeometry(type).createDataView(),
            getActorPose,
        );
        const objectLightingEnvironment = buildObjectLightingEnvironment(map.vertBin, map.chunks, dynamicLights);

        const sharedOutput = new RSPSharedOutput();
        const sceneRenderer = new DK64Renderer(device, sceneID, map.clipNear, map.clipFar, romData.Backdrop, dynamicLights);
        const cache = sceneRenderer.renderHelper.renderCache;

        for (let i = 0; i < map.displayLists.length; i++) {
            const dl = map.displayLists[i];

            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x06] = map.vertBin.slice(dl.VertStartIndex * 0x10);
            segmentBuffers[0x07] = map.f3dexBin;
            // Bindings persist across material display lists. The state
            // must be maintained for proper rendering.
            const animatedTextures = dl.textureAnimationGroup !== null
                ? [
                    ...map.animatedTextures.filter((entry) => entry.group === dl.textureAnimationGroup),
                    ...map.animatedTextures.filter((entry) => entry.group !== dl.textureAnimationGroup),
                ]
                : [...map.animatedTextures];
            animatedTextures.unshift(...resolveAnimatedMaterialTextures(
                getSceneNodeAnimatedTextureBindings(dl.materialIndex),
                romData.AnimTexData,
            ));
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, animatedTextures);
            // func_global_asm_806592B4: global fog
            initDL(state, true, map.fogEnabled);
            if (dl.materialIndex !== null)
                initSceneNodeMaterial(state, dl.materialIndex, map.fogEnabled, sceneID);
            const firstVertex = sharedOutput.vertices.length;
            runDL_F3DEX2(state, 0x07000000 | dl.dlStartAddr);

            const output = state.finish();

            if (output === null) {
                // TODO(jstpierre): Warn?
                continue;
            }

            const chunk = dl.ChunkID >= 0 ? map.chunks[dl.ChunkID] ?? null : null;
            const geometry: Geometry = {
                sharedOutput,
                rspState: state,
                rspOutput: output,
                dynamicLighting: buildMapChunkLighting(
                    sharedOutput, output.drawCalls, firstVertex,
                    state.vertexSourceAddresses, dl.VertStartIndex * 0x10,
                    chunk, dynamicLights,
                ),
            };
            const geoData = new GeometryData(device, cache, geometry);
            sceneRenderer.geoDatas.push(geoData);

            const renderLayer = dl.materialIndex === null
                ? DK64Layer.MapGeometry
                : DK64Layer.Surfaces;
            const geoRenderer = new GeometryRenderer(device, cache, geoData, renderLayer, sceneRenderer.fogParams, sceneRenderer.gpuTextureCache);
            if (dl.ChunkID >= 0)
                geoRenderer.setCullBoundingBox(geoData.cullBoundingBox);
            sceneRenderer.geoRenderers.push(geoRenderer);
        }

        // Floor decals need an efficient way to find terrain triangles.
        // The game uses floor-collision data, this is approximately equivalent.
        const terrainTriangles = buildTerrainTriangles(sharedOutput);
        // Streamed maps have 3x coords, single-chunk maps (DK's House etc) do not.
        const setupWorldScale = map.chunkCount > 0 ? 3 : 1;

        for (const surface of map.generatedSurfaces) {
            const vertexBuffer = createGeneratedSurfaceVertexBuffer(surface);
            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x08] = vertexBuffer;
            const materialTextures = resolveAnimatedMaterialTextures(
                getGeneratedSurfaceAnimatedTextureBindings(surface.materialIndex),
                romData.AnimTexData,
            );
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, materialTextures);
            initDL(state, false);
            initGeneratedSurfaceMaterial(state, surface.materialIndex, surface);

            const firstVertex = sharedOutput.vertices.length;
            for (let row = 0; row < surface.rows - 1; row++) {
                for (let column = 0; column < surface.columns - 1; column += 15) {
                    const cellCount = Math.min(15, surface.columns - 1 - column);
                    const vertexCount = cellCount + 1;
                    state.gSPVertex(0x08000000 + (row * surface.columns + column) * 0x10, vertexCount, 0);
                    state.gSPVertex(0x08000000 + ((row + 1) * surface.columns + column) * 0x10, vertexCount, 16);
                    for (let cell = 0; cell < cellCount; cell++) {
                        state.gSPTri(cell + 1, cell, 16 + cell);
                        state.gSPTri(16 + cell, 16 + cell + 1, cell + 1);
                    }
                }
            }

            const output = state.finish()!;
            const geometry: Geometry = {
                sharedOutput,
                rspState: state,
                rspOutput: output,
                generatedSurfaceAnimation: {
                    surface,
                    firstVertex,
                    vertexCount: sharedOutput.vertices.length - firstVertex,
                },
            };
            const geoData = new GeometryData(device, cache, geometry);
            sceneRenderer.geoDatas.push(geoData);
            sceneRenderer.geoRenderers.push(new GeometryRenderer(device, cache, geoData, DK64Layer.Surfaces, sceneRenderer.fogParams, sceneRenderer.gpuTextureCache));
        }

        addModel2Props(device, cache, sceneRenderer, sharedOutput, romData, setup.props, scripts, terrainTriangles, setupWorldScale, map.fogEnabled, objectLightingEnvironment);
        addSceneActors(device, cache, sceneRenderer, sharedOutput, romData, setup.actors, setupWorldScale, objectLightingEnvironment, getActorPose);
        addEnvironmentalEffects(device, cache, sceneRenderer, sharedOutput, romData, map, sceneID, setup.props, scripts);
        return sceneRenderer;
    }

}

// Names taken from ScriptHawk
const id = `dk64`;
const name = "Donkey Kong 64";
const sceneDescs = [

    "DK Isles",
    new SceneDesc(`22`, "DK Isles Overworld"),
    new SceneDesc(`B0`, "Training Grounds"),
    new SceneDesc(`AB`, "DK's House"),
    new SceneDesc(`BD`, "Fairy Island"),
    new SceneDesc(`61`, "K. Lumsy"),
    new SceneDesc(`A9`, "Jungle Japes Lobby"),
    new SceneDesc(`AD`, "Angry Aztec Lobby"),
    new SceneDesc(`AF`, "Frantic Factory Lobby"),
    new SceneDesc(`AE`, "Gloomy Galleon Lobby"),
    new SceneDesc(`C2`, "Crystal Caves Lobby"),
    new SceneDesc(`B2`, "Fungi Forest Lobby"),
    new SceneDesc(`C1`, "Creepy Castle Lobby"),
    new SceneDesc(`AA`, "Hideout Helm Lobby"),
    new SceneDesc(`B1`, "Dive Barrel"),
    new SceneDesc(`B4`, "Orange Barrel"),
    new SceneDesc(`B5`, "Barrel Barrel"),
    new SceneDesc(`B6`, "Vine Barrel"),
    new SceneDesc(`C3`, "DK Isles: Snide's Room"),

    "Jungle Japes",
    new SceneDesc(`07`, "Jungle Japes"),
    new SceneDesc(`04`, "Mountain"),
    new SceneDesc(`06`, "Minecart"),
    new SceneDesc(`08`, "Army Dillo"),
    new SceneDesc(`0C`, "Shell"),
    new SceneDesc(`0D`, "Lanky's Cave"),
    new SceneDesc(`21`, "Chunky's Cave"),
    new SceneDesc(`25`, "Barrel Blast"),

    "Angry Aztec",
    new SceneDesc(`26`, "Angry Aztec"),
    new SceneDesc(`0E`, "Beetle Race"),
    new SceneDesc(`10`, "Tiny's Temple"),
    new SceneDesc(`13`, "Five Door Temple (DK)"),
    new SceneDesc(`14`, "Llama Temple"),
    new SceneDesc(`15`, "Five Door Temple (Diddy)"),
    new SceneDesc(`16`, "Five Door Temple (Tiny)"),
    new SceneDesc(`17`, "Five Door Temple (Lanky)"),
    new SceneDesc(`18`, "Five Door Temple (Chunky)"),
    new SceneDesc(`29`, "Barrel Blast"),
    new SceneDesc(`C5`, "Dogadon"),

    "Frantic Factory",
    new SceneDesc(`1A`, "Frantic Factory"),
    new SceneDesc(`1B`, "Car Race"),
    new SceneDesc(`1D`, "Power Shed"),
    new SceneDesc(`24`, "Crusher Room"),
    new SceneDesc(`6E`, "Barrel Blast"),
    new SceneDesc(`9A`, "Mad Jack"),

    "Gloomy Galleon",
    new SceneDesc(`1E`, "Gloomy Galleon"),
    new SceneDesc(`1F`, "K. Rool's Ship"),
    new SceneDesc(`27`, "Seal Race"),
    new SceneDesc(`2B`, "Shipwreck (Diddy, Lanky, Chunky)"),
    new SceneDesc(`2C`, "Treasure Chest"),
    new SceneDesc(`2D`, "Mermaid"),
    new SceneDesc(`2E`, "Shipwreck (DK, Tiny)"),
    new SceneDesc(`2F`, "Shipwreck (Lanky, Tiny)"),
    new SceneDesc(`31`, "Lighthouse"),
    new SceneDesc(`33`, "Mechanical Fish"),
    new SceneDesc(`36`, "Barrel Blast"),
    new SceneDesc(`6F`, "Pufftoss"),
    new SceneDesc(`B3`, "Submarine"),

    "Fungi Forest",
    new SceneDesc(`30`, "Fungi Forest"),
    new SceneDesc(`34`, "Ant Hill"),
    new SceneDesc(`37`, "Minecart"),
    new SceneDesc(`38`, "Diddy's Barn"),
    new SceneDesc(`39`, "Diddy's Attic"),
    new SceneDesc(`3A`, "Lanky's Attic"),
    new SceneDesc(`3B`, "DK's Barn"),
    new SceneDesc(`3C`, "Spider"),
    new SceneDesc(`3D`, "Front Part of Mill"),
    new SceneDesc(`3E`, "Rear Part of Mill"),
    new SceneDesc(`3F`, "Mushroom Puzzle"),
    new SceneDesc(`40`, "Giant Mushroom"),
    new SceneDesc(`46`, "Mushroom Leap"),
    new SceneDesc(`47`, "Shooting Game"),
    new SceneDesc(`53`, "Dogadon"),
    new SceneDesc(`BC`, "Barrel Blast"),

    "Crystal Caves",
    new SceneDesc(`48`, "Crystal Caves"),
    new SceneDesc(`52`, "Beetle Race"),
    new SceneDesc(`54`, "Igloo (Tiny)"),
    new SceneDesc(`55`, "Igloo (Lanky)"),
    new SceneDesc(`56`, "Igloo (DK)"),
    new SceneDesc(`59`, "Rotating Room"),
    new SceneDesc(`5A`, "Shack (Chunky)"),
    new SceneDesc(`5B`, "Shack (DK)"),
    new SceneDesc(`5C`, "Shack (Diddy, middle part)"),
    new SceneDesc(`5D`, "Shack (Tiny)"),
    new SceneDesc(`5E`, "Lanky's Hut"),
    new SceneDesc(`5F`, "Igloo (Chunky)"),
    new SceneDesc(`62`, "Ice Castle"),
    new SceneDesc(`64`, "Igloo (Diddy)"),
    new SceneDesc(`BA`, "Barrel Blast"),
    new SceneDesc(`C4`, "Army Dillo"),
    new SceneDesc(`C8`, "Shack (Diddy, upper part)"),

    "Creepy Castle",
    new SceneDesc(`57`, "Creepy Castle"),
    new SceneDesc(`58`, "Ballroom"),
    new SceneDesc(`69`, "Tower"),
    new SceneDesc(`6A`, "Minecart"),
    new SceneDesc(`6C`, "Crypt (Lanky, Tiny)"),
    new SceneDesc(`70`, "Crypt (DK, Diddy, Chunky)"),
    new SceneDesc(`71`, "Museum"),
    new SceneDesc(`72`, "Library"),
    new SceneDesc(`97`, "Dungeon"),
    new SceneDesc(`A3`, "Basement"),
    new SceneDesc(`A4`, "Tree"),
    new SceneDesc(`A6`, "Chunky's Toolshed"),
    new SceneDesc(`A7`, "Trash Can"),
    new SceneDesc(`A8`, "Greenhouse"),
    new SceneDesc(`B7`, "Crypt"),
    new SceneDesc(`B9`, "Car Race"),
    new SceneDesc(`BB`, "Barrel Blast"),
    new SceneDesc(`C7`, "King Kut Out"),

    "Hideout Helm",
    new SceneDesc(`11`, "Hideout Helm"),
    new SceneDesc(`03`, "K. Rool Barrel: Lanky's Maze"),
    new SceneDesc(`23`, "K. Rool Barrel: DK's Target Game"),
    new SceneDesc(`32`, "K. Rool Barrel: Tiny's Mushroom Game"),
    new SceneDesc(`A5`, "K. Rool Barrel: Diddy's Kremling Game"),
    new SceneDesc(`C9`, "K. Rool Barrel: Diddy's Rocketbarrel Game"),
    new SceneDesc(`CA`, "K. Rool Barrel: Lanky's Shooting Game"),
    new SceneDesc(`D1`, "K. Rool Barrel: Chunky's Hidden Kremling Game"),
    new SceneDesc(`D2`, "K. Rool Barrel: Tiny's Pony Tail Twirl Game"),
    new SceneDesc(`D3`, "K. Rool Barrel: Chunky's Shooting Game"),
    new SceneDesc(`D4`, "K. Rool Barrel: DK's Rambi Game"),

    "K. Rool",
    new SceneDesc(`CB`, "DK Phase"),
    new SceneDesc(`CC`, "Diddy Phase"),
    new SceneDesc(`CD`, "Lanky Phase"),
    new SceneDesc(`CE`, "Tiny Phase"),
    new SceneDesc(`CF`, "Chunky Phase"),
    new SceneDesc(`D6`, "K. Rool's Shoe"),
    new SceneDesc(`D7`, "K. Rool's Arena"),

    "Cutscene",
    new SceneDesc(`1C`, "Hideout Helm (Level Intros, Game Over)"),
    new SceneDesc(`28`, "Nintendo Logo"),
    new SceneDesc(`4C`, "DK Rap"),
    new SceneDesc(`51`, "Title Screen (Not For Resale Version)"),
    new SceneDesc(`98`, "Hideout Helm (Intro Story)"),
    new SceneDesc(`99`, "DK Isles (DK Theatre)"),
    new SceneDesc(`AC`, "Rock (Intro Story)"),
    new SceneDesc(`C6`, "Training Grounds (End Sequence)"),
    new SceneDesc(`D0`, "Bloopers Ending"),
    new SceneDesc(`D5`, "K. Lumsy Ending"),

    "Bonus Barrels",
    new SceneDesc(`0A`, "Kremling Kosh! (very easy)"),
    new SceneDesc(`0B`, "Stealthy Snoop! (normal, no logo)"),
    new SceneDesc(`12`, "Teetering Turtle Trouble! (very easy)"),
    new SceneDesc(`20`, "Batty Barrel Bandit! (easy)"),
    new SceneDesc(`41`, "Stealthy Snoop! (normal)"),
    new SceneDesc(`42`, "Mad Maze Maul! (hard)"),
    new SceneDesc(`43`, "Stash Snatch! (normal)"),
    new SceneDesc(`44`, "Mad Maze Maul! (easy)"),
    new SceneDesc(`45`, "Mad Maze Maul! (normal)"),
    new SceneDesc(`4A`, "Stash Snatch! (easy)"),
    new SceneDesc(`4B`, "Stash Snatch! (hard)"),
    new SceneDesc(`4D`, "Minecart Mayhem! (easy)"),
    new SceneDesc(`4E`, "Busy Barrel Barrage! (easy)"),
    new SceneDesc(`4F`, "Busy Barrel Barrage! (normal)"),
    new SceneDesc(`60`, "Splish-Splash Salvage! (normal)"),
    new SceneDesc(`63`, "Speedy Swing Sortie! (easy)"),
    new SceneDesc(`65`, "Krazy Kong Klamour! (easy)"),
    new SceneDesc(`66`, "Big Bug Bash! (very easy)"),
    new SceneDesc(`67`, "Searchlight Seek! (very easy)"),
    new SceneDesc(`68`, "Beaver Bother! (easy)"),
    new SceneDesc(`73`, "Kremling Kosh! (easy)"),
    new SceneDesc(`74`, "Kremling Kosh! (normal)"),
    new SceneDesc(`75`, "Kremling Kosh! (hard)"),
    new SceneDesc(`76`, "Teetering Turtle Trouble! (easy)"),
    new SceneDesc(`77`, "Teetering Turtle Trouble! (normal)"),
    new SceneDesc(`78`, "Teetering Turtle Trouble! (hard)"),
    new SceneDesc(`79`, "Batty Barrel Bandit! (easy)"),
    new SceneDesc(`7A`, "Batty Barrel Bandit! (normal)"),
    new SceneDesc(`7B`, "Batty Barrel Bandit! (hard)"),
    new SceneDesc(`7C`, "Mad Maze Maul! (insane)"),
    new SceneDesc(`7D`, "Stash Snatch! (insane)"),
    new SceneDesc(`7E`, "Stealthy Snoop! (very easy)"),
    new SceneDesc(`7F`, "Stealthy Snoop! (easy)"),
    new SceneDesc(`80`, "Stealthy Snoop! (hard)"),
    new SceneDesc(`81`, "Minecart Mayhem! (normal)"),
    new SceneDesc(`82`, "Minecart Mayhem! (hard)"),
    new SceneDesc(`83`, "Busy Barrel Barrage! (hard)"),
    new SceneDesc(`84`, "Splish-Splash Salvage! (hard)"),
    new SceneDesc(`85`, "Splish-Splash Salvage! (easy)"),
    new SceneDesc(`86`, "Speedy Swing Sortie! (normal)"),
    new SceneDesc(`87`, "Speedy Swing Sortie! (hard)"),
    new SceneDesc(`88`, "Beaver Bother! (normal)"),
    new SceneDesc(`89`, "Beaver Bother! (hard)"),
    new SceneDesc(`8A`, "Searchlight Seek! (easy)"),
    new SceneDesc(`8B`, "Searchlight Seek! (normal)"),
    new SceneDesc(`8C`, "Searchlight Seek! (hard)"),
    new SceneDesc(`8D`, "Krazy Kong Klamour! (normal)"),
    new SceneDesc(`8E`, "Krazy Kong Klamour! (hard)"),
    new SceneDesc(`8F`, "Krazy Kong Klamour! (insane)"),
    new SceneDesc(`90`, "Peril Path Panic! (very easy)"),
    new SceneDesc(`91`, "Peril Path Panic! (easy)"),
    new SceneDesc(`92`, "Peril Path Panic! (normal)"),
    new SceneDesc(`93`, "Peril Path Panic! (hard)"),
    new SceneDesc(`94`, "Big Bug Bash! (easy)"),
    new SceneDesc(`95`, "Big Bug Bash! (normal)"),
    new SceneDesc(`96`, "Big Bug Bash! (hard)"),

    "Battle Arenas",
    new SceneDesc(`35`, "Beaver Brawl!"),
    new SceneDesc(`49`, "Kritter Karnage!"),
    new SceneDesc(`9B`, "Arena Ambush!"),
    new SceneDesc(`9C`, "More Kritter Karnage!"),
    new SceneDesc(`9D`, "Forest Fracas!"),
    new SceneDesc(`9E`, "Bish Bash Brawl!"),
    new SceneDesc(`9F`, "Kamikaze Kremlings!"),
    new SceneDesc(`A0`, "Plinth Panic!"),
    new SceneDesc(`A1`, "Pinnacle Palaver!"),
    new SceneDesc(`A2`, "Shockwave Showdown!"),

    "Kong Battle",
    new SceneDesc(`6B`, "Battle Arena"),
    new SceneDesc(`6D`, "Arena 1"),
    new SceneDesc(`BE`, "Arena 2"),
    new SceneDesc(`C0`, "Arena 3"),

    "Other",
    new SceneDesc(`00`, "Test Map"),
    new SceneDesc(`01`, "Funky's Store"),
    new SceneDesc(`02`, "DK Arcade"),
    new SceneDesc(`05`, "Cranky's Lab"),
    new SceneDesc(`09`, "Jetpac"),
    new SceneDesc(`0F`, "Snide's H.Q."),
    new SceneDesc(`19`, "Candy's Music Shop"),
    new SceneDesc(`2A`, "Troff 'n' Scoff"),
    new SceneDesc(`50`, "Main Menu"),
    new SceneDesc(`B8`, "Enguarde Arena"),
    new SceneDesc(`BF`, "Rambi Arena"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "dk64" };
