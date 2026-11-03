import { mat4, quat, vec3 } from "gl-matrix";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { fillMatrix4x4, fillVec3v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBlendFactor, GfxBlendMode, GfxChannelWriteMask, GfxCullMode, GfxDevice, GfxMipFilterMode, GfxSampler, GfxSamplerBinding, GfxTexFilterMode, GfxTexture, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInst, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as UI from "../ui";
import { FakeTextureHolder } from "../TextureHolder";
import { TieGeometry, TieProgram, TieRenderer } from "./render-tie";
import { CameraController } from "../Camera";
import { FilePromises, LevelResources, load, loadFilesFromNetwork, loadMissionFileFromNetworkOnly, load_Rac1TitleLevel, loadTitleFileFromNetwork, reloadMissionMobys } from "./loader";
import { createMegaBuffer, MegaBuffer, noclipSpaceFromRatchetSpace, lineChainToLineSegments, GN, OcclusionChecker } from "./utils";
import { TfragGeometry, TfragRenderer } from "./render-tfrag";
import { ShrubGeometry, ShrubRenderer } from "./render-shrub";
import { colorNewFromRGBA, OpaqueBlack, White } from "../Color";
import { SkyAnimationState, SkyGeometry, SkyRenderer } from "./render-sky";
import { RatchetShaderLib } from "./shader-lib";
import { createGfxTextureForPaletteTexture, createTextureAtlases, createTieNormalsTexture, createTieRgbaTexture_Rac1, createTieRgbaTexture_Rac234, TextureAtlases } from "./textures";
import { CollisionGeometry, CollisionRenderer } from "./render-collision";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { MobyGeometry, MobyRenderer } from "./render-moby";
import { nArray } from "../util";
import { AABB } from "../Geometry";
import { DebugDrawFlags } from "../gfx/helpers/DebugDraw";
import { MOBY_IMPL_REGISTRY, MobyDrawKit } from "./moby-impl/moby";
import { WaterRenderer } from "./render-water";

const pathBase = (gn: GN) => `RatchetAndClank${gn}`;

class RatchetAndClankScene implements SceneGfx {
    private renderHelper: GfxRenderHelper;

    private renderInstList = new GfxRenderInstList();

    private samplerGeneral: GfxSampler;
    private samplerWater: GfxSampler;
    private samplerSky: GfxSampler;

    private occlusionChecker: OcclusionChecker | null = null;

    public textureHolder = new FakeTextureHolder([]);

    private missionsPanel: UI.Panel | null = null;

    private resourceBasePath: string;
    private filePromises: FilePromises;
    private loadingPromise: Promise<unknown>;

    private settings = {
        lodSetting: -1, // -1 means dynamic
        lodBias: 40,
        showCollision: false,
        enableTfrag: true,
        enableTies: true,
        enableMobys: true,
        enableBangles: false, // disable bangles by default, there are two use cases for bangles - 1: bits that detach when shot, 2: damaged copy of the mesh. I'd like to have it enabled for the first but not the second but I can't tell them apart.
        enableShrubs: true,
        enableSky: true,
        enableFog: true,
        enableTextures: true,
        showObjectIds: false,
        showPaths: false,
        showOcclusionGrid: false,
        mobyMissionFlags: 0xFFFFFFFF, // bitmask to toggle mobys by mission
    };

    private levelResources: LevelResources;

    private textures: {
        textureAtlases: TextureAtlases | null,
        tieRgbaTexture: GfxTexture | null,
        tieNormalsTexture: GfxTexture | null,
        skyTextures: GfxTexture[],
        debugTextures: GfxTexture[],
        fxTextures: GfxTexture[],
    };

    private geometries: {
        tfrag: TfragGeometry | null,
        ties: Map<number, (TieGeometry | null)[]>, // 3 lods, lod 0 is always present
        mobys: Map<number, (MobyGeometry | null)[]>, // 2 lods, both may be null
        shrubs: Map<number, ShrubGeometry>,
        skyShells: Map<number, SkyGeometry>,
        collision: CollisionGeometry | null,
    };

    private animationStates: {
        sky: SkyAnimationState[]
    };

    private renderers: {
        tfrag: TfragRenderer,
        tie: TieRenderer,
        moby: MobyRenderer,
        shrub: ShrubRenderer,
        sky: SkyRenderer,
        water: WaterRenderer,
        collision: CollisionRenderer,
    };

    private instanceDataBuffer: MegaBuffer;

    public missionNumber: number | null = null;

    constructor(
        private sceneContext: SceneContext,
        public gn: GN,
        public levelNumber: number,
        public chunkNumber: number | null,
    ) {
        this.renderHelper = new GfxRenderHelper(sceneContext.device, sceneContext);
        const cache = this.renderHelper.renderCache;

        this.levelResources = {
            gn: gn,
            levelNumber: this.levelNumber,
            metadata: null,
            levelCoreHeader: null,
            gameplayHeader: null,
            missionGameplayHeader: null,
            overlaySections: null,
            gsTable: null,
            levelSettings: null,
            occlusion: null,
            occlusionMappings: null,
            paths: null,
            grindPaths: null,
            shapesCuboids: null,
            shapesSpheres: null,
            shapesCylinders: null,
            shapesPills: null,
            directionLights: null,
            pointLights: null,
            collisionGetter: null,
            tfrags: null,
            tfragTextures: null,
            tieTextures: null,
            tieOClasses: null,
            tieClasses: null,
            tieClassTextureIndices: null,
            tieInstances: null,
            tieInstancesByOClass: null,
            tieGroups: null,
            tieAmbientRgbas: null,
            mobyTextures: null,
            mobyGsStashList: null,
            mobyOClasses: null,
            mobyClasses: null,
            mobyClassTextureIndices: null,
            mobyInstances: null,
            mobyInstancesByOClass: null,
            mobyGroups: null,
            mobyUniqueMissionIds: null,
            mobyImpls: null,
            mobyImplShared: null,
            pvars: null,
            missionMobyOClasses: null,
            missionMobyInstances: null,
            missionMobyInstancesByOClass: null,
            missionMobyGroups: null,
            shrubTextures: null,
            shrubOClasses: null,
            shrubClasses: null,
            shrubClassTextureIndices: null,
            shrubInstances: null,
            shrubInstancesByOClass: null,
            shrubGroups: null,
            sky: null,
            skyTextures: null,
            fxTextures: null,
        };

        this.samplerGeneral = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.samplerWater = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        this.samplerSky = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.textures = {
            textureAtlases: null,
            tieRgbaTexture: null,
            tieNormalsTexture: null,
            skyTextures: [],
            fxTextures: [],
            debugTextures: [],
        }

        this.geometries = {
            tfrag: null,
            ties: new Map(),
            mobys: new Map(),
            shrubs: new Map(),
            skyShells: new Map(),
            collision: null,
        };

        this.animationStates = {
            sky: nArray(8, () => ({ quat: quat.create() })),
        };

        this.renderers = {
            tfrag: new TfragRenderer(this.renderHelper),
            tie: new TieRenderer(this.renderHelper, this.gn),
            moby: new MobyRenderer(this.renderHelper),
            shrub: new ShrubRenderer(this.renderHelper),
            sky: new SkyRenderer(this.renderHelper, this.gn),
            water: new WaterRenderer(this.renderHelper),
            collision: new CollisionRenderer(this.renderHelper),
        };

        this.instanceDataBuffer = createMegaBuffer(cache.device, "Instance Data", 1024 * 1024);

        this.resourceBasePath = `${pathBase(this.gn)}/level_${this.levelNumber === TITLE_SCREEN_RAC1 ? "title" : this.levelNumber}`;
        if (this.levelNumber === TITLE_SCREEN_RAC1) {
            // load special case title level for rac1
            const filePromises = loadTitleFileFromNetwork(sceneContext.dataFetcher, this.resourceBasePath);
            this.loadingPromise = load_Rac1TitleLevel(this.levelResources, filePromises.titleFilePromise);
        } else {
            // load normal level
            this.filePromises = loadFilesFromNetwork(sceneContext.dataFetcher, this.resourceBasePath, this.gn, this.chunkNumber, this.missionNumber);
            this.loadingPromise = load(this.gn, this.levelNumber, this.chunkNumber, this.levelResources, this.filePromises);
        }

        this.loadingPromise.catch((e) => {
            console.error(`Error loading title level:`, e);
        }).then(() => {
            if (IS_DEVELOPMENT) console.log(this);

            // setup missions ui
            this.populateMissionsList();

            // make moby impls
            const mobyInstances = this.levelResources.mobyInstances!;
            this.levelResources.mobyImpls = [];
            this.levelResources.mobyImplShared = {};
            for (let i = 0; i < mobyInstances!.length; i++) {
                const MobyImplConstructor = MOBY_IMPL_REGISTRY.get(mobyInstances[i].oClass)!;
                if (MobyImplConstructor) {
                    this.levelResources.mobyImpls.push(new MobyImplConstructor(mobyInstances[i], this.levelResources));
                }
            }
        });
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 400);
    }

    getOrCreateTfragGeometry(): TfragGeometry | null {
        const existing = this.geometries.tfrag;
        if (existing) return existing;

        if (!this.textures.textureAtlases) return null;

        const { tfrags, tfragTextures } = this.levelResources;
        if (!tfrags || !tfragTextures) return null;

        this.geometries.tfrag = new TfragGeometry(this.renderHelper.renderCache, tfrags, tfragTextures, this.textures.textureAtlases);
        return this.geometries.tfrag;
    }

    getOrCreateTieGeometry(oClass: number): (TieGeometry | null)[] | null {
        const existing = this.geometries.ties.get(oClass);
        if (existing) return existing;

        if (!this.textures.textureAtlases) return null;

        const tieClass = this.levelResources.tieClasses?.get(oClass);
        if (!tieClass) return null;
        const tieTextureIndices = this.levelResources.tieClassTextureIndices?.get(oClass);
        if (!tieTextureIndices) return null;

        const tieGeometry: (TieGeometry | null)[] = [null, null, null];
        for (let i = 0; i < 3; i++) {
            if (tieClass.packets[i].length === 0) continue; // no mesh for this lod
            tieGeometry[i] = new TieGeometry(this.renderHelper.renderCache, this.gn, oClass, tieClass, i, tieTextureIndices, this.textures.textureAtlases);
        }
        this.geometries.ties.set(oClass, tieGeometry);
        return tieGeometry;
    }

    getOrCreateMobyGeometry(oClass: number): (MobyGeometry | null)[] | null {
        const existing = this.geometries.mobys.get(oClass);
        if (existing) return existing;

        if (!this.textures.textureAtlases) return null;

        const mobyClass = this.levelResources.mobyClasses?.get(oClass);
        if (!mobyClass) return null;
        if (!mobyClass.mesh) return null;
        const mobyTextureIndices = this.levelResources.mobyClassTextureIndices?.get(oClass);
        if (!mobyTextureIndices) return null;

        const mobyGeometry: (MobyGeometry | null)[] = [null, null];
        for (let i = 0; i < 2; i++) {
            if (!mobyClass.mesh.packetsByLod[i].length) continue;
            mobyGeometry[i] = new MobyGeometry(this.renderHelper.renderCache, oClass, mobyClass, i, mobyTextureIndices, this.textures.textureAtlases);
        }

        this.geometries.mobys.set(oClass, mobyGeometry);
        return mobyGeometry;
    }

    getOrCreateShrubGeometry(oClass: number): ShrubGeometry | null {
        const existing = this.geometries.shrubs.get(oClass);
        if (existing) return existing;

        if (!this.textures.textureAtlases) return null;

        const shrubClass = this.levelResources.shrubClasses?.get(oClass);
        if (!shrubClass) return null;
        const shrubTextureIndices = this.levelResources.shrubClassTextureIndices?.get(oClass);
        if (!shrubTextureIndices) return null;

        const shrubGeometry = new ShrubGeometry(this.renderHelper.renderCache, shrubClass, shrubTextureIndices, this.textures.textureAtlases);
        this.geometries.shrubs.set(oClass, shrubGeometry);
        return shrubGeometry;
    }

    getOrCreateCollisionGeometry(): CollisionGeometry | null {
        const existing = this.geometries.collision;
        if (existing) return existing;

        const { collisionGetter } = this.levelResources;
        if (!collisionGetter) return null;

        this.geometries.collision = new CollisionGeometry(this.renderHelper.renderCache, collisionGetter());
        return this.geometries.collision;
    }

    getOrCreateSkyGeometry(i: number): SkyGeometry | null {
        const existing = this.geometries.skyShells.get(i);
        if (existing) return existing;

        const { sky } = this.levelResources;
        if (!sky) return null;

        const skyGeometry = new SkyGeometry(this.renderHelper.renderCache, i, sky.shells[i]);
        this.geometries.skyShells.set(i, skyGeometry);
        return skyGeometry;
    }

    private addDebugTexture = (gfxTexture: GfxTexture): void => {
        this.textures.debugTextures.push(gfxTexture);
        this.textureHolder.viewerTextures.push({ gfxTexture });
        this.textureHolder.onnewtextures();
    }

    getOrCreateSkyTextures(): GfxTexture[] | null {
        const existing = this.textures.skyTextures;
        if (existing.length > 0) return existing;

        const { skyTextures } = this.levelResources;
        if (!skyTextures) return null;

        const gfxTextures: GfxTexture[] = [];
        for (let i = 0; i < skyTextures.length; i++) {
            const skyTexture = skyTextures[i];
            const gfxTexture = createGfxTextureForPaletteTexture(this.renderHelper.device, skyTexture).pixelsTexture;
            this.textures.skyTextures.push(gfxTexture);
            this.textureHolder.viewerTextures.push({ gfxTexture: gfxTexture });
            gfxTextures.push(gfxTexture);
        }
        this.textureHolder.onnewtextures();
        this.textures.skyTextures = gfxTextures;
        return gfxTextures;
    }

    getOrCreateTieInstanceTextures() {
        const existing = this.textures.tieRgbaTexture;
        if (existing) return {
            tieRgbaTexture: this.textures.tieRgbaTexture,
            tieNormalsTexture: this.textures.tieNormalsTexture,
        };

        if (this.gn === 1) {
            const { tieInstances, tieClasses } = this.levelResources;
            if (!tieInstances) return null;
            if (!tieClasses) return null;

            this.textures.tieNormalsTexture = createTieNormalsTexture(this.gn, this.renderHelper.device, tieClasses);
            this.textures.tieRgbaTexture = createTieRgbaTexture_Rac1(this.renderHelper.device, tieInstances, this.addDebugTexture);
        } else {
            const { tieClasses, tieAmbientRgbas, tieInstances } = this.levelResources;
            if (!tieInstances) return null;
            if (!tieClasses) return null;
            if (!tieAmbientRgbas) return null;

            this.textures.tieNormalsTexture = createTieNormalsTexture(this.gn, this.renderHelper.device, tieClasses);
            this.textures.tieRgbaTexture = createTieRgbaTexture_Rac234(this.renderHelper.device, tieInstances, tieClasses, tieAmbientRgbas, this.addDebugTexture);
        }

        return {
            tieRgbaTexture: this.textures.tieRgbaTexture,
            tieNormalsTexture: this.textures.tieNormalsTexture,
        }
    }

    getOrCreateAtlasTextures(): GfxSamplerBinding[] | null {
        const { tfragTextures, tieTextures, mobyTextures, shrubTextures } = this.levelResources;
        if (!tfragTextures || !tieTextures || !mobyTextures || !shrubTextures) return null;

        if (!this.textures.textureAtlases) {
            this.textures.textureAtlases = createTextureAtlases(this.renderHelper.device, tfragTextures, tieTextures, mobyTextures, shrubTextures, this.addDebugTexture);
        }
        return [
            { gfxTexture: this.textures.textureAtlases.gfxTextures[16], gfxSampler: this.samplerGeneral },
            { gfxTexture: this.textures.textureAtlases.gfxTextures[32], gfxSampler: this.samplerGeneral },
            { gfxTexture: this.textures.textureAtlases.gfxTextures[64], gfxSampler: this.samplerGeneral },
            { gfxTexture: this.textures.textureAtlases.gfxTextures[128], gfxSampler: this.samplerGeneral },
            { gfxTexture: this.textures.textureAtlases.gfxTextures[256], gfxSampler: this.samplerGeneral },
        ];
    }

    getOrCreateFxTextures() {
        const existing = this.textures.fxTextures;
        if (existing.length > 0) return existing;

        const { fxTextures } = this.levelResources;
        if (!fxTextures) return null;

        const gfxTextures: GfxTexture[] = [];
        for (let i = 0; i < fxTextures.length; i++) {
            const fxTexture = fxTextures[i];
            const gfxTexture = createGfxTextureForPaletteTexture(this.renderHelper.device, fxTexture).pixelsTexture;
            this.textures.fxTextures.push(gfxTexture);
            this.textureHolder.viewerTextures.push({ gfxTexture: gfxTexture });
            gfxTextures.push(gfxTexture);
        }
        this.textureHolder.onnewtextures();
        this.textures.fxTextures = gfxTextures;
        return this.textures.fxTextures;
    }

    private fillSceneParams(template: GfxRenderInst, viewerInput: ViewerRenderInput, cameraPosition: vec3): void {
        const levelSettings = this.levelResources.levelSettings ?? {
            backgroundColor: OpaqueBlack,
            fogColor: OpaqueBlack,
            fogNearDistance: 0,
            fogFarDistance: 1,
            fogNearIntensity: 0,
            fogFarIntensity: 0,
        };

        const data = template.allocateUniformBufferF32(TieProgram.ub_SceneParams, RatchetShaderLib.SceneParamsSizeInFloats);
        let offs = 0;

        // camera transform (16 floats)
        const nearClip = 1 / 64;
        const farClip = 4096;
        viewerInput.camera.setClipPlanes(nearClip, farClip);
        offs += fillMatrix4x4(data, offs, viewerInput.camera.clipFromWorldMatrix);

        // camera data (12 floats)
        offs += fillVec3v(data, offs, cameraPosition, 0);
        const cameraDirection = vec3.fromValues(viewerInput.camera.viewMatrix[2], viewerInput.camera.viewMatrix[6], viewerInput.camera.viewMatrix[10]);
        offs += fillVec3v(data, offs, cameraDirection, 0);
        offs += fillVec4(data, offs, nearClip, farClip, viewerInput.camera.isOrthographic ? 1 : 0, 0);

        // scene time (4 floats)
        offs += fillVec4(data, offs, viewerInput.time, 0, 0, 0);

        // lod settings (4 floats)
        offs += fillVec4(data, offs, this.settings.lodSetting, this.settings.lodBias, 0, 0);

        // render settings (4 floats)
        offs += fillVec4(data, offs, this.settings.enableTextures ? 1 : 0, 0, 0, 0);

        // background color (4 floats)
        const backgroundColor = levelSettings.backgroundColor;
        offs += fillVec4(data, offs, backgroundColor.r / 0xFF, backgroundColor.g / 0xFF, backgroundColor.b / 0xFF, 1);

        // fog params (12 floats)
        if (this.settings.enableFog) {
            const fogColor = levelSettings.fogColor;
            offs += fillVec4(data, offs, fogColor.r / 0xFF, fogColor.g / 0xFF, fogColor.b / 0xFF, 1);
            offs += fillVec4(data, offs,
                levelSettings.fogNearDistance / 1024,
                levelSettings.fogFarDistance / 1024,
                0,
                0,
            );
            offs += fillVec4(data, offs,
                1 - (levelSettings.fogNearIntensity / 255),
                1 - (levelSettings.fogFarIntensity / 255),
                0,
                0,
            );
        } else {
            offs += fillVec4(data, offs, 0, 0, 0, 0);
            offs += fillVec4(data, offs, 0, 1, 0, 0);
            offs += fillVec4(data, offs, 0, 0, 0, 0);
        }

        // lights (16 * 16 floats)
        const directionalLights = this.levelResources.directionLights ?? [];
        for (let i = 0; i < 16; i++) {
            if (i < directionalLights.length) {
                const light = directionalLights[i];
                offs += fillVec4(data, offs, -light.directionA.x, -light.directionA.z, light.directionA.y, 0);
                offs += fillVec4(data, offs, light.colorA.r, light.colorA.g, light.colorA.b, -light.colorA.a);
                offs += fillVec4(data, offs, -light.directionB.x, -light.directionB.z, light.directionB.y, 0);
                offs += fillVec4(data, offs, light.colorB.r, light.colorB.g, light.colorB.b, -light.colorB.a);
            } else {
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
                offs += fillVec4(data, offs, 0, 0, 0, 0);
            }
        }
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const cameraPosition = vec3.create();
        mat4.getTranslation(cameraPosition, viewerInput.camera.worldMatrix);
        const cameraForward = vec3.fromValues(
            -viewerInput.camera.worldMatrix[8],
            -viewerInput.camera.worldMatrix[9],
            -viewerInput.camera.worldMatrix[10],
        );
        const isOrtho = viewerInput.camera.isOrthographic;
        const cameraFrustum = viewerInput.camera.frustum;

        const occlusion = this.levelResources.occlusion;
        const occlusionMappings = this.levelResources.occlusionMappings;
        if (occlusion && occlusionMappings) {
            if (!this.occlusionChecker) this.occlusionChecker = new OcclusionChecker(occlusion, occlusionMappings);
            this.occlusionChecker.setCameraPosition(cameraPosition);
        }

        let lodSetting = this.settings.lodSetting;
        if (isOrtho && lodSetting === -1) lodSetting = 0; // always treat dynamic lod as high lod in ortho view
        const lodBias = this.settings.lodBias;

        // setup
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({
            cullMode: GfxCullMode.None, // the game has backface culling only on objects within a specific per-object distance from the camera
            attachmentsState: [{
                channelWriteMask: GfxChannelWriteMask.AllChannels,
                rgbBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
                alphaBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.One,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
            }]
        });
        template.setBindingLayouts([
            { numSamplers: 1, numUniformBuffers: 2 },
        ]);
        this.fillSceneParams(template, viewerInput, cameraPosition);
        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // textures shared between tfrags, ties, and shrubs
        const atlasTextures = this.getOrCreateAtlasTextures();
        const fxTextures = this.getOrCreateFxTextures();

        const drawKit: MobyDrawKit = {
            renderInstList: this.renderInstList,
            renderHelper: this.renderHelper,
            instanceDataBuffer: this.instanceDataBuffer,
            dt: viewerInput.deltaTime,
            cameraPosition,
            cameraForward,
            cameraFrustum: viewerInput.camera.frustum,
            occlusionChecker: this.occlusionChecker,
            lodSetting,
            lodBias,
            renderers: {
                water: this.renderers.water,
            },
            fxTextures,
            fxSampler: this.samplerWater,
        };

        // moby update
        if (this.levelResources.mobyImpls) {
            for (let i = 0; i < this.levelResources.mobyImpls.length; i++) {
                const mobyImpl = this.levelResources.mobyImpls[i];
                mobyImpl.update(drawKit);
            }
        }

        // sky
        const skyTextures = this.getOrCreateSkyTextures();
        if (this.settings.enableSky && skyTextures && this.levelResources.sky?.shells) {
            for (let i = 0; i < this.levelResources.sky.shells.length; i++) {
                const skyShellGeometry = this.getOrCreateSkyGeometry(i);
                if (!skyShellGeometry) continue;
                if (!skyTextures) continue;
                this.renderers.sky.renderSky(this.renderInstList, cameraPosition, viewerInput.deltaTime, skyShellGeometry, skyTextures, this.samplerSky, this.animationStates.sky[i], isOrtho);
            }
        }

        // collision
        if (this.settings.showCollision) {
            const collisionGeometry = this.getOrCreateCollisionGeometry();
            if (collisionGeometry) {
                this.renderers.collision.renderCollision(this.renderInstList, cameraPosition, collisionGeometry);
            }
        }

        // tfrag
        if (this.settings.enableTfrag && atlasTextures) {
            const tfragGeometry = this.getOrCreateTfragGeometry();
            if (tfragGeometry) {
                this.renderers.tfrag.renderTfrag(this.renderInstList, tfragGeometry, lodSetting, atlasTextures);
            }
        }

        // ties
        const tieInstanceTextures = this.getOrCreateTieInstanceTextures();
        const tieInstancesByOClass = this.levelResources.tieInstancesByOClass;
        if (this.settings.enableTies && tieInstancesByOClass && atlasTextures && tieInstanceTextures) {
            const tieTextureMappings: GfxSamplerBinding[] = [
                ...atlasTextures,
                { gfxTexture: tieInstanceTextures.tieRgbaTexture, gfxSampler: this.samplerGeneral },
                { gfxTexture: tieInstanceTextures.tieNormalsTexture, gfxSampler: this.samplerGeneral }
            ];
            for (let i = 0; i < tieInstancesByOClass.length; i++) {
                const tieInstances = tieInstancesByOClass[i];
                const oClass = tieInstances[0].oClass;
                const tieClass = this.levelResources.tieClasses?.get(oClass);
                if (!tieClass) continue;
                const geometriesByLod = this.getOrCreateTieGeometry(oClass);
                if (!geometriesByLod) continue;
                this.renderers.tie.renderTie(this.renderInstList, geometriesByLod, tieClass, tieInstances, tieTextureMappings, cameraPosition, this.occlusionChecker, cameraFrustum, lodSetting, lodBias, this.instanceDataBuffer);
            }
        }

        // moby draw callback (after ties)
        if (this.settings.enableMobys && this.levelResources.mobyImpls) {
            for (let i = 0; i < this.levelResources.mobyImpls.length; i++) {
                const mobyImpl = this.levelResources.mobyImpls[i];
                mobyImpl.drawAfterTies(drawKit);
            }
        }

        // shrubs
        const shrubInstancesByOClass = this.levelResources.shrubInstancesByOClass;
        if (this.settings.enableShrubs && shrubInstancesByOClass && atlasTextures) {
            for (let i = 0; i < shrubInstancesByOClass.length; i++) {
                const shrubInstances = shrubInstancesByOClass[i];
                const oClass = shrubInstances[0].oClass;
                const geometry = this.getOrCreateShrubGeometry(oClass);
                if (!geometry) continue;
                this.renderers.shrub.renderShrub(this.renderInstList, geometry, shrubInstances, atlasTextures, cameraPosition, cameraFrustum, lodSetting, lodBias, this.instanceDataBuffer);
            }
        }

        // mobys
        const mobyInstancesByOClass = this.levelResources.mobyInstancesByOClass;
        if (this.settings.enableMobys && mobyInstancesByOClass && atlasTextures) {
            for (let i = 0; i < mobyInstancesByOClass.length; i++) {
                const mobyInstances = mobyInstancesByOClass[i];
                const oClass = mobyInstances[0].oClass;
                const mobyClass = this.levelResources.mobyClasses?.get(oClass);
                if (!mobyClass) continue;
                const mobyGeometryArr = this.getOrCreateMobyGeometry(oClass);
                if (!mobyGeometryArr) continue;
                this.renderers.moby.renderMoby(this.renderInstList, mobyGeometryArr, mobyClass, mobyInstances, atlasTextures, cameraPosition, this.occlusionChecker, cameraFrustum, lodSetting, lodBias, this.settings.enableBangles, this.settings.mobyMissionFlags, this.instanceDataBuffer);
            }
        }
        const missionMobyInstancesByOClass = this.levelResources.missionMobyInstancesByOClass;
        if (this.settings.enableMobys && missionMobyInstancesByOClass && atlasTextures) {
            for (let i = 0; i < missionMobyInstancesByOClass.length; i++) {
                const mobyInstances = missionMobyInstancesByOClass[i];
                const oClass = mobyInstances[0].oClass;
                const mobyClass = this.levelResources.mobyClasses?.get(oClass);
                if (!mobyClass) continue;
                const mobyGeometryArr = this.getOrCreateMobyGeometry(oClass);
                if (!mobyGeometryArr) continue;
                this.renderers.moby.renderMoby(this.renderInstList, mobyGeometryArr, mobyClass, mobyInstances, atlasTextures, cameraPosition, this.occlusionChecker, cameraFrustum, lodSetting, lodBias, this.settings.enableBangles, this.settings.mobyMissionFlags, this.instanceDataBuffer);
            }
        }

        // moby draw callback (after mobys)
        if (this.settings.enableMobys && this.levelResources.mobyImpls) {
            for (let i = 0; i < this.levelResources.mobyImpls.length; i++) {
                const mobyImpl = this.levelResources.mobyImpls[i];
                mobyImpl.drawAfterMobys(drawKit);
            }
        }

        // object ids
        if (this.settings.showObjectIds) {
            const renderObjectPosition = (text: string, _pos: vec3) => {
                const pos = vec3.clone(_pos);
                vec3.transformMat4(pos, pos, noclipSpaceFromRatchetSpace);
                this.renderHelper.debugDraw.drawLocator(pos, 0.3, White);
                const mat = mat4.fromTranslation(mat4.create(), pos);
                const rotation = quat.create();
                mat4.getRotation(rotation, viewerInput.camera.worldMatrix);
                mat4.fromRotationTranslationScale(mat, rotation, pos, vec3.fromValues(0.01, 0.01, 0.01));
                if (vec3.distance(pos, cameraPosition) < 40) {
                    this.renderHelper.debugDraw.drawWorldTextMtx(String(text), mat, White);
                }
            }

            if (this.settings.enableTies) {
                const tieInstances = this.levelResources.tieInstances ?? [];
                for (let i = 0; i < tieInstances.length; i++) {
                    const inst = tieInstances[i];
                    if (!inst) continue;
                    renderObjectPosition("tie" + inst.oClass, mat4.getTranslation(vec3.create(), inst.matrix));
                }
            }
            if (this.settings.enableMobys) {
                const mobyInstances = this.levelResources.mobyInstances ?? [];
                for (let i = 0; i < mobyInstances.length; i++) {
                    const inst = mobyInstances[i];
                    renderObjectPosition("moby" + inst.oClass, vec3.fromValues(inst.position.x, inst.position.y, inst.position.z));
                }
                const missionMobyInstances = this.levelResources.missionMobyInstances ?? [];
                for (let i = 0; i < missionMobyInstances.length; i++) {
                    const inst = missionMobyInstances[i];
                    renderObjectPosition("missionmoby" + inst.oClass, vec3.fromValues(inst.position.x, inst.position.y, inst.position.z));
                }
            }
            if (this.settings.enableShrubs) {
                const shrubInstances = this.levelResources.shrubInstances ?? [];
                for (let i = 0; i < shrubInstances.length; i++) {
                    const inst = shrubInstances[i];
                    if (!inst) continue;
                    renderObjectPosition("shrub" + inst.oClass, mat4.getTranslation(vec3.create(), inst.matrix));
                }
            }
        }

        // paths
        if (this.settings.showPaths) {
            const paths = this.levelResources.paths ?? [];
            const grindPaths = this.levelResources.grindPaths ?? [];
            const regularPathColor = colorNewFromRGBA(0.1, 0.3, 0.8, 1);
            const grindPathColor = colorNewFromRGBA(0.7, 0.4, 0.1, 1);
            for (const path of paths) {
                for (const line of lineChainToLineSegments(path.points, regularPathColor)) this.renderHelper.debugDraw.drawLine(line.from, line.to, line.color);
            }
            for (const path of grindPaths) {
                for (const line of lineChainToLineSegments(path.points, grindPathColor)) this.renderHelper.debugDraw.drawLine(line.from, line.to, line.color);
            }
        }

        // occlusion grid
        if (this.settings.showOcclusionGrid && this.levelResources.occlusion) {
            const color = colorNewFromRGBA(1, 1, 1, 1);
            const options = {
                flags: DebugDrawFlags.WorldSpace,
            }
            const scratchAabb = new AABB();
            const occlusionGrid = this.levelResources.occlusion;
            for (const [z, zCell] of occlusionGrid.grid.entries()) {
                for (const [y, yCell] of zCell.entries()) {
                    for (const x of yCell.keys()) {
                        vec3.set(scratchAabb.min, 4 * x, 4 * y, 4 * z);
                        vec3.set(scratchAabb.max, 4 * x + 4, 4 * y + 4, 4 * z + 4);
                        this.renderHelper.debugDraw.drawBoxLine(scratchAabb, noclipSpaceFromRatchetSpace, color, options);
                    }
                }
            }
        }

        this.instanceDataBuffer.upload();

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const backgroundColor = this.levelResources.levelSettings?.backgroundColor ?? OpaqueBlack;
        mainColorDesc.clearColor = { r: backgroundColor.r / 255, g: backgroundColor.g / 255, b: backgroundColor.b / 255, a: 1 };
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName("Main Pass");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer, scope) => {
                this.renderInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });


        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        builder.execute();
    }

    public createPanels(): UI.Panel[] {
        const renderSettingsPanel = new UI.Panel();
        renderSettingsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderSettingsPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Settings');

        const lodSetting = new UI.RadioButtons('LoD', ["Dynamic", "High", "Med", "Low"]);
        lodSetting.setSelectedIndex(this.settings.lodSetting + 1);
        lodSetting.onselectedchange = () => {
            this.settings.lodSetting = lodSetting.selectedIndex - 1;
        };
        renderSettingsPanel.contents.appendChild(lodSetting.elem);

        const lodBias = new UI.Slider('LoD Bias', this.settings.lodBias, -20, 200);
        lodBias.onvalue = (n: number) => {
            this.settings.lodBias = n;
        };
        renderSettingsPanel.contents.appendChild(lodBias.elem);

        const showCollision = new UI.Checkbox('Show Collision', this.settings.showCollision);
        showCollision.onchanged = () => {
            this.settings.showCollision = showCollision.checked;
            enableTfrag.setChecked(this.settings.enableTfrag = !showCollision.checked);
            enableTies.setChecked(this.settings.enableTies = !showCollision.checked);
            enableShrubs.setChecked(this.settings.enableShrubs = !showCollision.checked);
        };
        renderSettingsPanel.contents.appendChild(showCollision.elem);

        const enableTfrag = new UI.Checkbox('Enable Tfrag', this.settings.enableTfrag);
        enableTfrag.onchanged = () => {
            this.settings.enableTfrag = enableTfrag.checked;
        };
        renderSettingsPanel.contents.appendChild(enableTfrag.elem);

        const enableTies = new UI.Checkbox('Enable Ties', this.settings.enableTies);
        enableTies.onchanged = () => {
            this.settings.enableTies = enableTies.checked;
        };
        renderSettingsPanel.contents.appendChild(enableTies.elem);

        const enableMobys = new UI.Checkbox('Enable Mobys', this.settings.enableMobys);
        enableMobys.onchanged = () => {
            this.settings.enableMobys = enableMobys.checked;
        };
        renderSettingsPanel.contents.appendChild(enableMobys.elem);

        if (this.gn >= 2) {
            // bangles are introduced in rac2
            const enableBangles = new UI.Checkbox('Enable Bangles', this.settings.enableBangles);
            enableBangles.onchanged = () => {
                this.settings.enableBangles = enableBangles.checked;
            };
            renderSettingsPanel.contents.appendChild(enableBangles.elem);
        }

        const enableShrubs = new UI.Checkbox('Enable Shrubs', this.settings.enableShrubs);
        enableShrubs.onchanged = () => {
            this.settings.enableShrubs = enableShrubs.checked;
        };
        renderSettingsPanel.contents.appendChild(enableShrubs.elem);

        const enableFog = new UI.Checkbox('Enable Fog', this.settings.enableFog);
        enableFog.onchanged = () => {
            this.settings.enableFog = enableFog.checked;
        };
        renderSettingsPanel.contents.appendChild(enableFog.elem);

        const enableTextures = new UI.Checkbox('Enable Textures', this.settings.enableTextures);
        enableTextures.onchanged = () => {
            this.settings.enableTextures = enableTextures.checked;
        };
        renderSettingsPanel.contents.appendChild(enableTextures.elem);

        const enableSky = new UI.Checkbox('Enable Sky', this.settings.enableSky);
        enableSky.onchanged = () => {
            this.settings.enableSky = enableSky.checked;
        };
        renderSettingsPanel.contents.appendChild(enableSky.elem);

        const showObjectIds = new UI.Checkbox('View Object IDs', this.settings.showObjectIds);
        showObjectIds.onchanged = () => {
            this.settings.showObjectIds = showObjectIds.checked;
        };
        renderSettingsPanel.contents.appendChild(showObjectIds.elem);

        const showOcclusionGrid = new UI.Checkbox('View Occlusion Grid', this.settings.showOcclusionGrid);
        showOcclusionGrid.onchanged = () => {
            this.settings.showOcclusionGrid = showOcclusionGrid.checked;
        };
        renderSettingsPanel.contents.appendChild(showOcclusionGrid.elem);

        const showPaths = new UI.Checkbox('View Paths', this.settings.showPaths);
        showPaths.onchanged = () => {
            this.settings.showPaths = showPaths.checked;
        };
        renderSettingsPanel.contents.appendChild(showPaths.elem);

        const missionsPanel = new UI.Panel();
        missionsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        missionsPanel.setTitle(UI.LAYER_ICON, 'Missions');
        this.missionsPanel = missionsPanel;

        return [renderSettingsPanel, missionsPanel];
    }

    populateMissionsList() {
        if (!this.missionsPanel) return;

        if (this.gn === 4) {
            // rac4 missions - these are separate moby instance lists in an external file
            // we only load one at a time, otherwise it would be very cluttered

            const missionSelector = new UI.SingleSelect();
            if (!this.levelResources.metadata?.levelDescriptor.missions) return;
            const missionList = this.levelResources.metadata.levelDescriptor.missions.gameplay
                .map((mission, missionNumber) => ({ missionNumber, exists: !!mission.startSector }))
                .filter(mission => mission.exists);
            if (missionList.length === 0) return;
            missionSelector.setStrings(missionList.map(mission => `Mission ${mission.missionNumber}`));
            missionSelector.onselectionchange = ((index: number) => {
                const newMissionNumber = missionList[index].missionNumber;
                if (newMissionNumber !== this.missionNumber) {
                    this.missionNumber = newMissionNumber;
                    this.reloadMission();
                }
            });

            // select a mission - this will call reloadMission and load the file
            // (we can't preselect any mission because we don't know which levels have missions)
            missionSelector.selectItem(missionList[0].missionNumber);

            this.missionsPanel.contents.appendChild(missionSelector.elem);
        } else {
            // rac123 missions - each moby has a mission id property
            // enable all by default

            const missionSelector = new UI.MultiSelect();
            if (!this.levelResources.mobyUniqueMissionIds) return;
            const missionList = Array.from(this.levelResources.mobyUniqueMissionIds.keys())
                .filter(num => num != -1)
                .sort((a, b) => a - b);
            missionSelector.setStrings(missionList.map(num => `Mission ${num}`));
            for (let i = 0; i < missionList.length; i++) missionSelector.setItemSelected(i, true);
            missionSelector.onitemchanged = (index: number, v: boolean) => {
                if (v) {
                    this.settings.mobyMissionFlags |= (1 << index);
                } else {
                    this.settings.mobyMissionFlags &= ~(1 << index);
                }
            };
            this.missionsPanel.contents.appendChild(missionSelector.elem);
        }
    }

    // for rac4, replace the mission files, clear the current mission mobys, and load new ones
    private reloadMission() {
        this.loadingPromise = this.loadingPromise.then(() => {
            this.filePromises.gameplayMissionFilePromise = loadMissionFileFromNetworkOnly(this.sceneContext.dataFetcher, this.resourceBasePath, this.gn, this.missionNumber).gameplayMissionFilePromise;
            reloadMissionMobys(this.gn, this.chunkNumber, this.levelResources, this.filePromises);
        });
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

        if (this.levelResources.mobyImpls) {
            for (const mobyImpl of this.levelResources.mobyImpls) {
                mobyImpl.destroy(device);
            }
        }

        const allGeometries = [
            this.geometries.tfrag,
            ...(Array.from(this.geometries.ties.values()).flat(1)),
            ...(Array.from(this.geometries.mobys.values()).flat(1)),
            ...this.geometries.shrubs.values(),
            ...this.geometries.skyShells.values(),
            this.geometries.collision,
        ];
        for (const geometry of allGeometries) {
            geometry?.destroy(device);
        }

        const allTextures = new Set<GfxTexture | null>([
            ...(this.textures.textureAtlases ? Object.values(this.textures.textureAtlases?.gfxTextures) : []),
            this.textures.tieRgbaTexture,
            this.textures.tieNormalsTexture,
            ...this.textures.skyTextures,
            ...this.textures.fxTextures,
            ...this.textures.debugTextures,
        ]);
        allTextures.forEach((texture) => {
            if (texture) {
                device.destroyTexture(texture);
            }
        });

        // (this one holds textures)
        this.renderers.water.destroy(device);

        this.instanceDataBuffer.destroy();

        this.textureHolder.destroy(device);

        if (IS_DEVELOPMENT) {
            device.checkForLeaks();
        }
    }
}

class RatchetAndClankSceneDesc implements SceneDesc {
    id: string;

    constructor(public gn: GN, public levelNumber: number, public chunkNumber: number | null = null, public name: string) {
        if (chunkNumber === null) {
            this.id = String(levelNumber);
        } else {
            this.id = `${levelNumber}_${chunkNumber}`;
        }
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        return new RatchetAndClankScene(sceneContext, this.gn, this.levelNumber, this.chunkNumber);
    }
}

const TITLE_SCREEN_RAC1 = 9999; // just an arbitrary number that doesn't conflict with any level numbers
const SPLITSCREEN_RAC3 = 10;
const SPLITSCREEN_RAC4 = 20;

export const sceneGroup1: SceneGroup = {
    id: "RatchetAndClank1",
    name: "Ratchet & Clank",
    sceneDescs: [
        "Main Game",
        new RatchetAndClankSceneDesc(1, 0, null, "Veldin (Tutorial)"),
        new RatchetAndClankSceneDesc(1, 1, null, "Novalis"),
        new RatchetAndClankSceneDesc(1, 2, null, "Aridia"),
        new RatchetAndClankSceneDesc(1, 3, null, "Metropolis"),
        new RatchetAndClankSceneDesc(1, 4, null, "Eudora"),
        new RatchetAndClankSceneDesc(1, 5, null, "Blackwater City"),
        new RatchetAndClankSceneDesc(1, 6, null, "Nebula G34"),
        new RatchetAndClankSceneDesc(1, 7, null, "Quark's HQ"),
        new RatchetAndClankSceneDesc(1, 8, null, "Batalia"),
        new RatchetAndClankSceneDesc(1, 9, null, "Gaspar"),
        new RatchetAndClankSceneDesc(1, 10, null, "Orxon"),
        new RatchetAndClankSceneDesc(1, 11, null, "Pokitaru"),
        new RatchetAndClankSceneDesc(1, 12, null, "Hoven"),
        new RatchetAndClankSceneDesc(1, 13, null, "Oltanis Orbit"),
        new RatchetAndClankSceneDesc(1, 14, null, "Oltanis"),
        new RatchetAndClankSceneDesc(1, 15, null, "Quartu"),
        new RatchetAndClankSceneDesc(1, 16, null, "Kalebo III"),
        new RatchetAndClankSceneDesc(1, 17, null, "Veldin Orbit"),
        new RatchetAndClankSceneDesc(1, 18, null, "Veldin (Finale)"),
        "Extras",
        new RatchetAndClankSceneDesc(1, TITLE_SCREEN_RAC1, null, "Veldin (Title Screen)"),
    ],
};

export const sceneGroup2: SceneGroup = {
    id: "RatchetAndClank2",
    name: "Ratchet & Clank: Going Commando",
    hidden: !IS_DEVELOPMENT,
    sceneDescs: [
        "Main Game",
        new RatchetAndClankSceneDesc(2, 0, null, "Aranos (Tutorial)"),
        new RatchetAndClankSceneDesc(2, 1, 0, "Oozla"),
        new RatchetAndClankSceneDesc(2, 1, 1, "Oozla (Secret boss)"),
        new RatchetAndClankSceneDesc(2, 25, null, "Wupash Nebula (Space)"),
        new RatchetAndClankSceneDesc(2, 2, 0, "Maktar Resort"),
        new RatchetAndClankSceneDesc(2, 2, 1, "Maktar Resort (Arena)"),
        new RatchetAndClankSceneDesc(2, 26, null, "Jamming Array"),
        new RatchetAndClankSceneDesc(2, 3, null, "Megapolis"),
        new RatchetAndClankSceneDesc(2, 4, 0, "Barlow"),
        new RatchetAndClankSceneDesc(2, 4, 1, "Barlow (Race)"),
        new RatchetAndClankSceneDesc(2, 5, null, "Thug Rendezvous (Space)"),
        new RatchetAndClankSceneDesc(2, 6, null, "Notak"),
        new RatchetAndClankSceneDesc(2, 24, null, "Slip Cognito's Ship Shack"),
        new RatchetAndClankSceneDesc(2, 7, 0, "Siberius"),
        new RatchetAndClankSceneDesc(2, 7, 1, "Siberius (Chase sequence)"),
        new RatchetAndClankSceneDesc(2, 8, 0, "Tabora (Tunnel)"),
        new RatchetAndClankSceneDesc(2, 8, 1, "Tabora"),
        new RatchetAndClankSceneDesc(2, 9, null, "Dobbo"),
        new RatchetAndClankSceneDesc(2, 22, null, "Dobbo Orbit (Giant Clank)"),
        new RatchetAndClankSceneDesc(2, 10, null, "Deep Space Disposal (Space)"),
        new RatchetAndClankSceneDesc(2, 11, 0, "Joba"),
        new RatchetAndClankSceneDesc(2, 11, 1, "Joba (Race & arena)"),
        new RatchetAndClankSceneDesc(2, 12, null, "Todano"),
        new RatchetAndClankSceneDesc(2, 13, null, "Boldan"),
        new RatchetAndClankSceneDesc(2, 14, null, "Aranos"),
        new RatchetAndClankSceneDesc(2, 15, null, "Thugs-4-Less Fleet (Space)"),
        new RatchetAndClankSceneDesc(2, 16, null, "Snivelak"),
        new RatchetAndClankSceneDesc(2, 17, null, "Smolg"),
        new RatchetAndClankSceneDesc(2, 18, null, "Damosel"),
        new RatchetAndClankSceneDesc(2, 23, null, "Damosel Orbit (Giant Clank)"),
        new RatchetAndClankSceneDesc(2, 19, 0, "Grelbin"),
        new RatchetAndClankSceneDesc(2, 19, 1, "Grelbin (Glider)"),
        new RatchetAndClankSceneDesc(2, 19, 2, "Grelbin (Hypnomatic)"),
        new RatchetAndClankSceneDesc(2, 20, 0, "Yeedil"),
        new RatchetAndClankSceneDesc(2, 20, 1, "Yeedil (Interior)"),
        new RatchetAndClankSceneDesc(2, 20, 2, "Yeedil (Boss)"),

        "Extras",
        new RatchetAndClankSceneDesc(2, 30, null, "Insomniac Museum"),
    ],
};

export const sceneGroup3: SceneGroup = {
    id: "RatchetAndClank3",
    name: "Ratchet & Clank: Up Your Arsenal",
    hidden: !IS_DEVELOPMENT,
    sceneDescs: [
        "Main Game",
        new RatchetAndClankSceneDesc(3, 1, null, "Veldin"),
        new RatchetAndClankSceneDesc(3, 2, null, "Florana"),
        new RatchetAndClankSceneDesc(3, 3, null, "Starship Pheonix"),
        new RatchetAndClankSceneDesc(3, 6, null, "Starship Pheonix (Under attack)"),
        new RatchetAndClankSceneDesc(3, 4, 0, "Marcadia"),
        new RatchetAndClankSceneDesc(3, 4, 1, "Marcadia (Refractor)"),
        new RatchetAndClankSceneDesc(3, 4, 2, "Marcadia (Ranger missions)"),
        new RatchetAndClankSceneDesc(3, 7, 0, "Annihilation Nation (Gauntlet)"),
        new RatchetAndClankSceneDesc(3, 7, 1, "Annihilation Nation (Mission select & arena)"),
        new RatchetAndClankSceneDesc(3, 8, null, "Aquatos"),
        new RatchetAndClankSceneDesc(3, 27, null, "Aquatos (Tyhrra-Guise / Clank)"),
        new RatchetAndClankSceneDesc(3, 28, null, "Aquatos (Sewer Crystals)"),
        new RatchetAndClankSceneDesc(3, 9, 0, "Tyhrranosis (First visit)"),
        new RatchetAndClankSceneDesc(3, 9, 2, "Tyhrranosis"),
        new RatchetAndClankSceneDesc(3, 9, 1, "Tyhrranosis (Boss)"),
        new RatchetAndClankSceneDesc(3, 29, null, "Tyhrranosis (Ranger Missions)"),
        new RatchetAndClankSceneDesc(3, 5, null, "Daxx"),
        new RatchetAndClankSceneDesc(3, 11, null, "Obani Gemini"),
        new RatchetAndClankSceneDesc(3, 23, null, "Holostar Studios (Clank)"),
        new RatchetAndClankSceneDesc(3, 13, null, "Holostar Studios (Ratchet)"),
        new RatchetAndClankSceneDesc(3, 12, null, "Blackwater City (Ranger missions)"),
        new RatchetAndClankSceneDesc(3, 21, null, "Obani Draco"),
        new RatchetAndClankSceneDesc(3, 10, 0, "Zeldrin Starport"),
        new RatchetAndClankSceneDesc(3, 10, 1, "Zeldrin Starport (The Leviathan)"),
        new RatchetAndClankSceneDesc(3, 10, 2, "Zeldrin Starport (Cutscene)"),
        new RatchetAndClankSceneDesc(3, 16, null, "Metropolis"),
        new RatchetAndClankSceneDesc(3, 26, null, "Metropolis (Ranger missions)"),
        new RatchetAndClankSceneDesc(3, 17, null, "Zeldrin"),
        new RatchetAndClankSceneDesc(3, 18, null, "Aridia"),
        new RatchetAndClankSceneDesc(3, 19, 0, "Quark's Hideout"),
        new RatchetAndClankSceneDesc(3, 19, 1, "Quark's Hideout (Clank)"),
        new RatchetAndClankSceneDesc(3, 14, null, "Koros"),
        new RatchetAndClankSceneDesc(3, 22, null, "Mylon"),
        new RatchetAndClankSceneDesc(3, 20, null, "Mylon (Boss)"),

        "Vid-Comics",
        new RatchetAndClankSceneDesc(3, 31, null, "Vid-Comic 1: Booty is in the Eye of the Beholder"),
        new RatchetAndClankSceneDesc(3, 33, null, "Vid-Comic 2: Arriba Amoeba!"),
        new RatchetAndClankSceneDesc(3, 34, null, "Vid-Comic 3: Shadow of the Robot"),
        new RatchetAndClankSceneDesc(3, 32, null, "Vid-Comic 4: Deja Q All Over Again"),
        new RatchetAndClankSceneDesc(3, 35, null, "Vid-Comic 5: The Shaming of the Q"),

        "Multiplayer",
        new RatchetAndClankSceneDesc(3, 40, null, "MP Bakisi Isles"),
        new RatchetAndClankSceneDesc(3, 41, null, "MP Hoven Gorge"),
        new RatchetAndClankSceneDesc(3, 42, null, "MP Outpost X12"),
        new RatchetAndClankSceneDesc(3, 43, null, "MP Korgon Outpost"),
        new RatchetAndClankSceneDesc(3, 44, null, "MP Metropolis"),
        new RatchetAndClankSceneDesc(3, 45, null, "MP Blackwater City"),
        new RatchetAndClankSceneDesc(3, 46, null, "MP Command Center"),
        new RatchetAndClankSceneDesc(3, 47, null, "MP Blackwater Docks"),
        new RatchetAndClankSceneDesc(3, 48, null, "MP Aquatos Sewers"),
        new RatchetAndClankSceneDesc(3, 49, null, "MP Marcadia Palace"),

        "Multiplayer (Splitscreen)",
        new RatchetAndClankSceneDesc(3, SPLITSCREEN_RAC3 + 40, null, "Splitscreen MP Bakisi Isles"),
        new RatchetAndClankSceneDesc(3, SPLITSCREEN_RAC3 + 41, null, "Splitscreen MP Hoven Gorge"),
        new RatchetAndClankSceneDesc(3, SPLITSCREEN_RAC3 + 42, null, "Splitscreen MP Outpost X12"),
        new RatchetAndClankSceneDesc(3, SPLITSCREEN_RAC3 + 43, null, "Splitscreen MP Korgon Outpost"),
        new RatchetAndClankSceneDesc(3, SPLITSCREEN_RAC3 + 44, null, "Splitscreen MP Metropolis"),
        new RatchetAndClankSceneDesc(3, SPLITSCREEN_RAC3 + 45, null, "Splitscreen MP Blackwater City"),

        "Extras",
        new RatchetAndClankSceneDesc(3, 24, 0, "Insomniac Museum"),
        new RatchetAndClankSceneDesc(3, 24, 1, "Insomniac Museum (Florana Race)"),
        new RatchetAndClankSceneDesc(3, 30, null, "Vid-Comic 0: Unnamed Prototype"),
        new RatchetAndClankSceneDesc(3, 36, null, "Vid-Comic 1: Special Edition"),

        // broken levels:
        // 39: a menu?
        // 8_1 and 8_2: misconfigured chunks with nothing in them
    ],
};

export const sceneGroup4: SceneGroup = {
    id: "RatchetAndClank4",
    name: "Ratchet: Deadlocked",
    hidden: !IS_DEVELOPMENT,
    sceneDescs: [
        "Main Game",
        new RatchetAndClankSceneDesc(4, 1, 0, "DreadZone Station (Tutorial & Hub)"),
        new RatchetAndClankSceneDesc(4, 1, 1, "DreadZone Station (Arenas)"),
        new RatchetAndClankSceneDesc(4, 2, null, "Catacrom Graveyard"),
        new RatchetAndClankSceneDesc(4, 4, null, "Sarathos Swamp"),
        new RatchetAndClankSceneDesc(4, 5, 0, "Dark Cathedral"),
        new RatchetAndClankSceneDesc(4, 5, 1, "Dark Cathedral (Interior)"),
        new RatchetAndClankSceneDesc(4, 6, null, "Temple of Shaar"),
        new RatchetAndClankSceneDesc(4, 7, null, "Valix Lighthouse"),
        new RatchetAndClankSceneDesc(4, 8, null, "Mining Facility"),
        new RatchetAndClankSceneDesc(4, 10, null, "Torval Ruins"),
        new RatchetAndClankSceneDesc(4, 11, null, "Tempus Station"),
        new RatchetAndClankSceneDesc(4, 13, null, "Maraxus Prison"),
        new RatchetAndClankSceneDesc(4, 14, 0, "Ghost Station"),
        new RatchetAndClankSceneDesc(4, 14, 1, "Ghost Station (Interior)"),
        new RatchetAndClankSceneDesc(4, 15, 0, "DreadZone Station (Finale)"),
        new RatchetAndClankSceneDesc(4, 15, 1, "DreadZone Station (Boss)"),

        "Main Game (Splitscreen)",
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 1, 0, "Splitscreen DreadZone Station (Tutorial & Hub)"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 1, 1, "Splitscreen DreadZone Station (Arenas)"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 2, null, "Splitscreen Catacrom Graveyard"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 4, null, "Splitscreen Sarathos Swamp"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 5, 0, "Splitscreen Dark Cathedral"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 5, 1, "Splitscreen Dark Cathedral (Interior)"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 6, null, "Splitscreen Temple of Shaar"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 7, null, "Splitscreen Valix Lighthouse"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 8, null, "Splitscreen Mining Facility"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 10, null, "Splitscreen Torval Ruins"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 11, null, "Splitscreen Tempus Station"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 13, null, "Splitscreen Maraxus Prison"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 14, 0, "Splitscreen Ghost Station"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 14, 1, "Splitscreen Ghost Station (Interior)"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 15, 0, "Splitscreen DreadZone Station (Finale)"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 15, 1, "Splitscreen DreadZone Station (Boss)"),

        "Multiplayer",
        new RatchetAndClankSceneDesc(4, 41, 1, "MP Battledome Tower"),
        new RatchetAndClankSceneDesc(4, 42, null, "MP Catacrom Graveyard"),
        new RatchetAndClankSceneDesc(4, 44, null, "MP Sarathos Swamp"),
        new RatchetAndClankSceneDesc(4, 45, 0, "MP Dark Cathedral"),
        new RatchetAndClankSceneDesc(4, 46, null, "MP Temple of Shaar"),
        new RatchetAndClankSceneDesc(4, 47, null, "MP Valix Lighthouse"),
        new RatchetAndClankSceneDesc(4, 48, null, "MP Mining Facility"),
        new RatchetAndClankSceneDesc(4, 50, null, "MP Torval Ruins"),
        new RatchetAndClankSceneDesc(4, 51, null, "MP Tempus Station"),
        new RatchetAndClankSceneDesc(4, 53, null, "MP Maraxus Prison"),
        new RatchetAndClankSceneDesc(4, 54, 0, "MP Ghost Station"),

        "Multiplayer (Splitscreen)",
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 41, 1, "Splitscreen MP Battledome Tower"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 42, null, "Splitscreen MP Catacrom Graveyard"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 44, null, "Splitscreen MP Sarathos Swamp"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 45, 0, "Splitscreen MP Dark Cathedral"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 46, null, "Splitscreen MP Temple of Shaar"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 47, null, "Splitscreen MP Valix Lighthouse"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 48, null, "Splitscreen MP Mining Facility"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 50, null, "Splitscreen MP Torval Ruins"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 51, null, "Splitscreen MP Tempus Station"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 53, null, "Splitscreen MP Maraxus Prison"),
        new RatchetAndClankSceneDesc(4, SPLITSCREEN_RAC4 + 54, 0, "Splitscreen MP Ghost Station"),

        // broken levels:
        // 0: a menu?
        // 45_1, 54_1, 65_1, 74_1: misconfigured chunks
    ],
};
