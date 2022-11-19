
import { mat4, vec3, ReadonlyVec3 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists, fallback, spliceBisectRight } from '../util';
import { DataFetcher, AbortedCallback } from '../DataFetcher';
import { MathConstants, computeModelMatrixSRT, clamp, projectionMatrixForCuboid } from '../MathHelpers';
import { texProjCameraSceneTex } from '../Camera';
import { SceneContext } from '../SceneBase';
import * as Viewer from '../viewer';
import * as UI from '../ui';

import { TextureMapping } from '../TextureHolder';
import { TransparentBlack } from '../Color';
import { GfxDevice, GfxRenderPass, GfxTexture, GfxFormat, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxClipSpaceNearZ } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxrRenderTargetDescription, GfxrAttachmentSlot, GfxrTemporalTexture, GfxrGraphBuilder, GfxrRenderTargetID } from '../gfx/render/GfxRenderGraph';
import { pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { gfxDeviceNeedsFlipY } from '../gfx/helpers/GfxDeviceHelpers';
import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers';

import { SceneParams, fillSceneParams, ub_SceneParamsBufferSize, fillSceneParamsData } from '../gx/gx_render';
import { EFB_WIDTH, EFB_HEIGHT, GX_Program } from '../gx/gx_material';
import { GXRenderHelperGfx } from '../gx/gx_render';

import * as Yaz0 from '../Common/Compression/Yaz0';
import * as RARC from '../Common/JSYSTEM/JKRArchive';

import { JMapInfoIter, createCsvParser, JMapLinkInfo } from './JMapInfo';
import { LightDataHolder, LightDirector, LightAreaHolder } from './LightData';
import { DrawCameraType } from './DrawBuffer';
import { SceneNameObjListExecutor, DrawBufferType, DrawType, NameObjHolder, NameObj, GameBits } from './NameObj';
import { getNameObjFactoryTableEntry, PlanetMapCreator, NameObjFactoryTableEntry } from './NameObjFactory';
import { ZoneAndLayer, LayerId, LiveActorGroupArray, getJMapInfoTrans, getJMapInfoRotate, ResourceHolder } from './LiveActor';
import { EffectSystem, ParticleResourceHolder } from './EffectSystem';
import { WaterAreaHolder, WaterAreaMgr, HazeCube, SwitchArea, MercatorTransformCube, DeathArea } from './MiscMap';
import { SensorHitChecker } from './HitSensor';
import { PlanetGravityManager } from './Gravity';
import { AreaObjMgr, AreaObj } from './AreaObj';
import { CollisionDirector } from './Collision';
import { ShadowControllerHolder } from './Shadow';
import { BaseMatrixFollowTargetHolder } from './Follow';
import { MessageArea, TalkDirector } from './Talk';
import { DemoDirector } from './Demo';
import { FurDrawManager } from './Fur';
import { GameSystemFontHolder, LayoutHolder } from './Layout';
import { getLayoutMessageDirect, MessageHolder } from './MessageData';
import { ImageEffectSystemHolder, BloomEffect, BloomEffectSimple, DepthOfFieldBlur, ImageEffectAreaMgr } from './ImageEffect';
import { ClipAreaDropHolder, ClipAreaHolder, FallOutFieldDraw } from './ClipArea';
import { StageSwitchContainer, SleepControllerHolder, initSyncSleepController, SwitchWatcherHolder } from './Switch';
import { AirBubbleHolder, WaterPlantDrawInit, TrapezeRopeDrawInit, SwingRopeGroup, ElectricRailHolder, PriorDrawAirHolder, CoinRotater, GalaxyNameSortTable, MiniatureGalaxyHolder, HeatHazeDirector, CoinHolder, SpinDriverPathDrawInit, GalaxyCometScreenFilter } from './Actors/MiscActor';
import { NoclipLegacyActorSpawner } from './Actors/LegacyActor';
import { StarPieceDirector, WaterPressureBulletHolder } from './Actors/MapObj';
import { MapPartsRailGuideHolder } from './MapParts';
import { LensFlareDirector, DrawSyncManager } from './Actors/LensFlare';
import { NPCDirector } from './Actors/NPC';
import { GalaxyMapController } from './Actors/GalaxyMap';
import { KameckBeamHolder, KameckBeamTurtleHolder, KameckFireBallHolder, TakoHeiInkHolder } from './Actors/Enemy';
import { dfLabel, dfShow } from '../DebugFloaters';
import { makeSolidColorTexture2D } from '../gfx/helpers/TextureHelpers';

// Galaxy ticks at 60fps.
export const FPS = 60;
const FPS_RATE = FPS/1000;

function getDeltaTimeFrames(viewerInput: Viewer.ViewerRenderInput): number {
    // Clamp to reasonable values.
    return clamp(viewerInput.deltaTime * FPS_RATE, 0.0, 1.5);
}

function isExistPriorDrawAir(sceneObjHolder: SceneObjHolder): boolean {
    if (sceneObjHolder.priorDrawAirHolder !== null)
        return sceneObjHolder.priorDrawAirHolder.isExistValidDrawAir();
    else
        return false;
}

export const enum SpecialTextureType {
    OpaqueSceneTexture = 'opaque-scene-texture',
    AstroMapBoard = 'astro-map-board',
    MarioShadowTexture = `mario-shadow-texture`,
}

class SpecialTextureBinder {
    private clampSampler: GfxSampler;
    private textureMapping = new Map<SpecialTextureType, TextureMapping>();
    private needsFlipY = false;
    private transparentTexture: GfxTexture;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.clampSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            maxLOD: 100,
            minLOD: 0,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.registerSpecialTextureType(SpecialTextureType.OpaqueSceneTexture, this.clampSampler);
        this.registerSpecialTextureType(SpecialTextureType.AstroMapBoard, this.clampSampler);
        this.registerSpecialTextureType(SpecialTextureType.MarioShadowTexture, this.clampSampler);

        this.transparentTexture = makeSolidColorTexture2D(device, TransparentBlack);
        this.lateBindTexture(SpecialTextureType.MarioShadowTexture, this.transparentTexture);

        this.needsFlipY = gfxDeviceNeedsFlipY(device);
    }

    private registerSpecialTextureType(textureType: SpecialTextureType, gfxSampler: GfxSampler): void {
        const m = new TextureMapping();
        m.gfxSampler = gfxSampler;
        this.textureMapping.set(textureType, m);
    }

    public registerTextureMapping(m: TextureMapping, textureType: SpecialTextureType): void {
        m.width = EFB_WIDTH;
        m.height = EFB_HEIGHT;
        m.flipY = this.needsFlipY;
        m.lateBinding = textureType;
    }

    public lateBindTexture(textureType: SpecialTextureType, gfxTexture: GfxTexture | null): void {
        this.textureMapping.get(textureType)!.gfxTexture = gfxTexture;
    }

    public resolveLateBindTexture(list: GfxRenderInstList): void {
        for (const [textureType, textureMapping] of this.textureMapping.entries())
            list.resolveLateSamplerBinding(textureType, textureMapping);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.transparentTexture);
    }
}

class RenderParams {
    public sceneParamsOffs2D: number = -1;
    public sceneParamsOffs3D: number = -1;
}

const sceneParams = new SceneParams();
const scratchMatrix = mat4.create();
export class SMGRenderer implements Viewer.SceneGfx {
    private currentScenarioIndex: number = -1;
    private scenarioSelect: UI.SingleSelect | null = null;

    private scenarioNoToIndex: number[] = [];

    public onstatechanged!: () => void;
    public textureHolder: TextureListHolder;

    private mainColorTemporalTexture = new GfxrTemporalTexture();
    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
    private bloomObjectsDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private maskDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);

    constructor(private renderHelper: GXRenderHelperGfx, private spawner: SMGSpawner, private sceneObjHolder: SceneObjHolder) {
        this.textureHolder = this.sceneObjHolder.modelCache.textureListHolder;

        if (this.sceneObjHolder.sceneDesc.scenarioOverride !== null)
            this.currentScenarioIndex = this.sceneObjHolder.sceneDesc.scenarioOverride;

        this.renderHelper.renderInstManager.disableSimpleMode();
        this.applyCurrentScenario();
    }

    private applyCurrentScenario(): void {
        const scenarioData = this.sceneObjHolder.scenarioData.scenarioDataIter;
        if (this.currentScenarioIndex < 0 || this.currentScenarioIndex >= scenarioData.getNumRecords())
            this.currentScenarioIndex = 0;
        scenarioData.setRecord(this.currentScenarioIndex);

        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zoneNode = this.spawner.zones[i];
            zoneNode.layerMask = assertExists(scenarioData.getValueNumber(zoneNode.name));
        }

        this.spawner.zones[0].computeZoneVisibility();

        this.sceneObjHolder.nameObjHolder.scenarioChanged(this.sceneObjHolder);
    }

    public setCurrentScenario(index: number): void {
        if (this.currentScenarioIndex === index)
            return;

        this.currentScenarioIndex = index;
        this.applyCurrentScenario();
        const strIndex = this.scenarioNoToIndex.indexOf(index) - 1;
        if (this.scenarioSelect !== null)
            this.scenarioSelect.setHighlighted(strIndex);
        this.onstatechanged();
    }

    private createScenarioPanel(): UI.Panel {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(UI.TIME_OF_DAY_ICON, 'Scenario');

        const galaxyName = this.sceneObjHolder.sceneDesc.galaxyName;
        const scenarioData = this.sceneObjHolder.scenarioData.scenarioDataIter;

        scenarioData.mapRecords((jmp, i) => {
            this.scenarioNoToIndex[assertExists(jmp.getValueNumber('ScenarioNo'))] = i;
        });

        const scenarioNames: string[] = [];
        for (let i = 1; i < this.scenarioNoToIndex.length; i++) {
            const scenarioIndex = this.scenarioNoToIndex[i];
            scenarioData.setRecord(scenarioIndex);

            let name: string | null = null;
            if (name === null && this.sceneObjHolder.messageHolder !== null)
                name = getLayoutMessageDirect(this.sceneObjHolder, `ScenarioName_${galaxyName}${i}`);

            if (name === null || name === '')
                name = assertExists(scenarioData.getValueString(`ScenarioName`));

            scenarioNames.push(name);
        }

        this.scenarioSelect = new UI.SingleSelect();
        this.scenarioSelect.setStrings(scenarioNames);
        this.scenarioSelect.onselectionchange = (strIndex: number) => {
            const scenarioIndex = this.scenarioNoToIndex[strIndex + 1];
            this.setCurrentScenario(scenarioIndex);
        };
        this.scenarioSelect.selectItem(0);

        scenarioPanel.contents.appendChild(this.scenarioSelect.elem);
        return scenarioPanel;
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        if (this.sceneObjHolder.sceneDesc.scenarioOverride === null)
            panels.push(this.createScenarioPanel());

        return panels;
    }

    private drawAllEffects(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.sceneObjHolder.effectSystem === null)
            return;

        const effectSystem = this.sceneObjHolder.effectSystem;

        const renderInstManager = this.renderHelper.renderInstManager;

        for (let drawType = DrawType.EffectDraw3D; drawType <= DrawType.EffectDrawAfterImageEffect; drawType++) {
            renderInstManager.setCurrentRenderInstList(this.sceneObjHolder.sceneNameObjListExecutor.ensureRenderInstListExecute(drawType));
            const template = this.renderHelper.renderInstManager.pushTemplateRenderInst();
            template.setUniformBufferOffset(GX_Program.ub_SceneParams, this.sceneObjHolder.renderParams.sceneParamsOffs3D, ub_SceneParamsBufferSize);

            let texPrjMtx: mat4 | null = null;
            if (drawType === DrawType.EffectDrawIndirect) {
                texPrjMtx = scratchMatrix;
                texProjCameraSceneTex(texPrjMtx, viewerInput.camera, 1);
            }

            effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, texPrjMtx, viewerInput.camera.frustum);
            effectSystem.drawEmitters(this.sceneObjHolder.modelCache.device, this.renderHelper.renderInstManager, drawType);

            this.renderHelper.renderInstManager.popTemplateRenderInst();
        }
    }

    private executeOnPass(passRenderer: GfxRenderPass, list: GfxRenderInstList | null): void {
        if (list === null)
            return;
        this.sceneObjHolder.specialTextureBinder.resolveLateBindTexture(list);
        const cache = this.renderHelper.renderInstManager.gfxRenderCache;
        list.drawOnPassRenderer(cache, passRenderer);
    }

    private drawOpa(passRenderer: GfxRenderPass, drawBufferType: DrawBufferType): void {
        this.executeOnPass(passRenderer, this.sceneObjHolder.sceneNameObjListExecutor.getRenderInstListOpa(drawBufferType));
    }

    private drawXlu(passRenderer: GfxRenderPass, drawBufferType: DrawBufferType): void {
        this.executeOnPass(passRenderer, this.sceneObjHolder.sceneNameObjListExecutor.getRenderInstListXlu(drawBufferType));
    }

    private hasAnyRenderInstList(renderInstList: GfxRenderInstList | null): boolean {
        if (renderInstList !== null)
            return renderInstList.renderInsts.length > 0;
        else
            return false;
    }

    private hasAnyDrawBuffer(drawBufferType: DrawBufferType): boolean {
        if (this.hasAnyRenderInstList(this.sceneObjHolder.sceneNameObjListExecutor.getRenderInstListOpa(drawBufferType)))
            return true;
        if (this.hasAnyRenderInstList(this.sceneObjHolder.sceneNameObjListExecutor.getRenderInstListXlu(drawBufferType)))
            return true;
        return false;
    }

    private execute(passRenderer: GfxRenderPass, drawType: DrawType): void {
        this.executeOnPass(passRenderer, this.sceneObjHolder.sceneNameObjListExecutor.getRenderInstListExecute(drawType));
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const sceneObjHolder = this.sceneObjHolder;

        sceneObjHolder.viewerInput = viewerInput;

        const executor = sceneObjHolder.sceneNameObjListExecutor;
        const camera = viewerInput.camera;

        camera.setClipPlanes(100, 800000);

        sceneObjHolder.drawSyncManager.beginFrame(device);

        sceneObjHolder.deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        executor.executeMovement(sceneObjHolder, viewerInput);
        executor.executeCalcAnim(sceneObjHolder);

        // Prepare our two scene params buffers.
        const sceneParamsOffs3D = this.renderHelper.uniformBuffer.allocateChunk(ub_SceneParamsBufferSize);
        fillSceneParams(sceneParams, viewerInput.camera.projectionMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        fillSceneParamsData(this.renderHelper.uniformBuffer.mapBufferF32(), sceneParamsOffs3D, sceneParams);
        sceneObjHolder.renderParams.sceneParamsOffs3D = sceneParamsOffs3D;

        const sceneParamsOffs2D = this.renderHelper.uniformBuffer.allocateChunk(ub_SceneParamsBufferSize);
        projectionMatrixForCuboid(scratchMatrix, 0, viewerInput.backbufferWidth, 0, viewerInput.backbufferHeight, -10000.0, 10000.0);
        projectionMatrixConvertClipSpaceNearZ(scratchMatrix, viewerInput.camera.clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);
        fillSceneParams(sceneParams, scratchMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        fillSceneParamsData(this.renderHelper.uniformBuffer.mapBufferF32(), sceneParamsOffs2D, sceneParams);
        sceneObjHolder.renderParams.sceneParamsOffs2D = sceneParamsOffs2D;

        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        const effectSystem = sceneObjHolder.effectSystem;
        if (effectSystem !== null) {
            const deltaTime = sceneObjHolder.deltaTimeFrames;
            effectSystem.calc(deltaTime);

            const indDummy = effectSystem.particleResourceHolder.getTextureMappingReference('IndDummy');
            if (indDummy !== null)
                sceneObjHolder.specialTextureBinder.registerTextureMapping(indDummy, SpecialTextureType.OpaqueSceneTexture);
        }

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        sceneObjHolder.graphBuilder = builder;

        // Prepare all of our NameObjs.
        executor.calcViewAndEntry(sceneObjHolder, DrawCameraType.DrawCameraType_3D, viewerInput);
        executor.calcViewAndEntry(sceneObjHolder, DrawCameraType.DrawCameraType_2D, viewerInput);

        executor.executeDrawAll(sceneObjHolder, renderInstManager, viewerInput);

        // Draw our render insts.
        this.drawAllEffects(viewerInput);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setUniformBufferOffset(GX_Program.ub_SceneParams, sceneParamsOffs3D, ub_SceneParamsBufferSize);
        executor.drawAllBuffers(sceneObjHolder.modelCache.device, renderInstManager, camera, DrawCameraType.DrawCameraType_3D);
        template.setUniformBufferOffset(GX_Program.ub_SceneParams, sceneParamsOffs2D, ub_SceneParamsBufferSize);
        executor.drawAllBuffers(sceneObjHolder.modelCache.device, renderInstManager, camera, DrawCameraType.DrawCameraType_2D);
        renderInstManager.popTemplateRenderInst();

        setBackbufferDescSimple(this.mainColorDesc, viewerInput);
        this.mainColorDesc.colorClearColor = TransparentBlack;

        this.mainDepthDesc.copyDimensions(this.mainColorDesc);
        this.mainDepthDesc.depthClearValue = standardFullClearRenderPassDescriptor.depthClearValue!;

        this.mainColorTemporalTexture.setDescription(device, this.mainColorDesc);

        // Start with clip area if we need it.

        const mainColorTargetID = builder.createRenderTargetID(this.mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Main Depth');

        this.maskDesc.copyDimensions(this.mainColorDesc);
        // TODO(jstpierre): Re-enable this. This would require bouncing the Opaque after Shadow
        // pass to a temp MSAA RT if the sample counts differ, and then resolving...
        // this.maskDesc.sampleCount = 1;
        this.maskDesc.colorClearColor = TransparentBlack;

        if (sceneObjHolder.fallOutFieldDraw !== null && sceneObjHolder.clipAreaHolder !== null && sceneObjHolder.clipAreaHolder.isActive && this.hasAnyDrawBuffer(DrawBufferType.ClippedMapParts)) {
            builder.pushPass((pass) => {
                pass.setDebugName('Clipped Map Parts');
    
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                pass.exec((passRenderer) => {
                    this.drawOpa(passRenderer, DrawBufferType.ClippedMapParts);
                });

                pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);
            });

            const clipAreaMaskTargetID = builder.createRenderTargetID(this.maskDesc, 'Clip Area Mask');

            builder.pushPass((pass) => {
                pass.setDebugName('Clipped Map Parts Mask');

                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, clipAreaMaskTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                pass.exec((passRenderer) => {
                    this.execute(passRenderer, DrawType.ClipArea);
                });
            });

            sceneObjHolder.fallOutFieldDraw.pushPasses(sceneObjHolder, builder, renderInstManager, mainColorTargetID, mainDepthTargetID, clipAreaMaskTargetID);
        }

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            pass.exec((passRenderer) => {
                this.drawOpa(passRenderer, DrawBufferType.AstroDomeSky);
                this.drawXlu(passRenderer, DrawBufferType.AstroDomeSky);

                if (isExistPriorDrawAir(sceneObjHolder)) {
                    this.drawOpa(passRenderer, DrawBufferType.Sky);
                    this.drawOpa(passRenderer, DrawBufferType.Air);
                    this.drawOpa(passRenderer, DrawBufferType.Sun);
                    this.drawXlu(passRenderer, DrawBufferType.Sky);
                    this.drawXlu(passRenderer, DrawBufferType.Air);
                    this.drawXlu(passRenderer, DrawBufferType.Sun);
                }
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Opaque before Shadow');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                // TODO(jstpierre): The game puts this in the Skybox pass? Verify that we're doing this correctly here...
                sceneObjHolder.specialTextureBinder.lateBindTexture(SpecialTextureType.OpaqueSceneTexture, this.mainColorTemporalTexture.getTextureForSampling());
                this.drawOpa(passRenderer, DrawBufferType.CrystalItem);
                this.drawXlu(passRenderer, DrawBufferType.CrystalItem);
                this.drawOpa(passRenderer, DrawBufferType.Crystal);
                this.drawXlu(passRenderer, DrawBufferType.Crystal);

                this.drawOpa(passRenderer, DrawBufferType.Planet);
                this.drawOpa(passRenderer, 0x05); // planet strong light?
                // execute(0x19);
                this.drawOpa(passRenderer, DrawBufferType.Environment);
                this.drawOpa(passRenderer, DrawBufferType.MapObj);
                this.drawOpa(passRenderer, DrawBufferType.MapObjStrongLight);
                this.drawOpa(passRenderer, DrawBufferType.MapObjWeakLight);
                this.drawOpa(passRenderer, 0x1F); // player light?
            });
        });

        let shadowColorTargetID: GfxrRenderTargetID;
        builder.pushPass((pass) => {
            pass.setDebugName('Shadow Volumes');

            shadowColorTargetID = builder.createRenderTargetID(this.maskDesc, 'Shadow Volume Mask');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, shadowColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            pass.exec((passRenderer) => {
                this.execute(passRenderer, DrawType.ShadowVolume);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Opaque after Shadow');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color1, shadowColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                // executeDrawBufferListNormalOpaBeforeSilhouette()
                this.drawOpa(passRenderer, DrawBufferType.NoShadowedMapObj);
                this.drawOpa(passRenderer, DrawBufferType.NoShadowedMapObjStrongLight);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Main Opaque');
            const shadowColorTextureID = builder.resolveRenderTarget(shadowColorTargetID);
            pass.attachResolveTexture(shadowColorTextureID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer, scope) => {
                const shadowTexture = scope.getResolveTextureForID(shadowColorTextureID);
                sceneObjHolder.specialTextureBinder.lateBindTexture(SpecialTextureType.OpaqueSceneTexture, shadowTexture);
                this.execute(passRenderer, DrawType.AlphaShadow);

                this.drawOpa(passRenderer, DrawBufferType.NoSilhouettedMapObj);
                this.drawOpa(passRenderer, DrawBufferType.NoSilhouettedMapObjWeakLight);
                this.drawOpa(passRenderer, DrawBufferType.NoSilhouettedMapObjStrongLight);
                this.drawOpa(passRenderer, DrawBufferType.Player);
                this.drawOpa(passRenderer, DrawBufferType.Npc);
                this.drawOpa(passRenderer, DrawBufferType.Ride);
                this.drawOpa(passRenderer, DrawBufferType.Enemy);
                this.drawOpa(passRenderer, DrawBufferType.EnemyDecoration);
                this.drawOpa(passRenderer, 0x15);
                if (!isExistPriorDrawAir(sceneObjHolder)) {
                    this.drawOpa(passRenderer, DrawBufferType.Sky);
                    this.drawOpa(passRenderer, DrawBufferType.Air);
                    this.drawOpa(passRenderer, DrawBufferType.Sun);
                    this.drawXlu(passRenderer, DrawBufferType.Sky);
                    this.drawXlu(passRenderer, DrawBufferType.Air);
                    this.drawXlu(passRenderer, DrawBufferType.Sun);
                }

                // executeDrawListOpa();
                this.execute(passRenderer, DrawType.OceanRingPipeOutside);
                this.execute(passRenderer, DrawType.SwingRope);
                this.execute(passRenderer, DrawType.Creeper);
                this.execute(passRenderer, DrawType.Trapeze);
                this.execute(passRenderer, DrawType.WarpPodPath);
                this.execute(passRenderer, DrawType.WaterPlant);
                this.execute(passRenderer, DrawType.AstroDomeOrbit);
                this.execute(passRenderer, DrawType.Fur);
                this.execute(passRenderer, DrawType.OceanSphere);
                this.execute(passRenderer, DrawType.WhirlPoolAccelerator);
                this.execute(passRenderer, DrawType.Flag);

                this.drawOpa(passRenderer, 0x18);

                // executeDrawBufferListNormalXlu()
                this.drawXlu(passRenderer, DrawBufferType.Planet);
                this.drawXlu(passRenderer, 0x05);
                this.drawXlu(passRenderer, DrawBufferType.Environment);
                this.drawXlu(passRenderer, DrawBufferType.EnvironmentStrongLight);
                this.drawXlu(passRenderer, DrawBufferType.MapObj);
                this.drawXlu(passRenderer, DrawBufferType.MapObjWeakLight);
                this.drawXlu(passRenderer, 0x1F);
                this.drawXlu(passRenderer, DrawBufferType.MapObjStrongLight);
                this.drawXlu(passRenderer, DrawBufferType.NoShadowedMapObj);
                this.drawXlu(passRenderer, DrawBufferType.NoShadowedMapObjStrongLight);
                this.drawXlu(passRenderer, DrawBufferType.NoSilhouettedMapObj);
                this.drawXlu(passRenderer, DrawBufferType.NoSilhouettedMapObjWeakLight);
                this.drawXlu(passRenderer, DrawBufferType.NoSilhouettedMapObjStrongLight);
                this.drawXlu(passRenderer, DrawBufferType.Player);
                this.drawXlu(passRenderer, DrawBufferType.Npc);
                this.drawXlu(passRenderer, DrawBufferType.Ride);
                this.drawXlu(passRenderer, DrawBufferType.Enemy);
                this.drawXlu(passRenderer, DrawBufferType.EnemyDecoration);
                this.drawXlu(passRenderer, DrawBufferType.PlayerDecoration);
                // executeDrawListXlu()
                this.execute(passRenderer, DrawType.VolumeModel);
                this.execute(passRenderer, DrawType.SpinDriverPathDrawer);
                this.execute(passRenderer, DrawType.ClipAreaDropLaser);
                this.drawXlu(passRenderer, 0x18);

                this.execute(passRenderer, DrawType.ShadowSurface);
                this.execute(passRenderer, DrawType.EffectDraw3D);
                this.execute(passRenderer, DrawType.EffectDrawForBloomEffect);
                // execute(0x2f);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Indirect');
            const indirectOpaqueColorTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(indirectOpaqueColorTextureID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer, scope) => {
                const opaqueTexture = scope.getResolveTextureForID(indirectOpaqueColorTextureID);
                sceneObjHolder.specialTextureBinder.lateBindTexture(SpecialTextureType.OpaqueSceneTexture, opaqueTexture);

                // executeDrawAfterIndirect()
                this.drawOpa(passRenderer, DrawBufferType.IndirectPlanet);
                this.drawOpa(passRenderer, DrawBufferType.IndirectMapObj);
                this.drawOpa(passRenderer, DrawBufferType.IndirectMapObjStrongLight);
                this.drawOpa(passRenderer, DrawBufferType.IndirectNpc);
                this.drawOpa(passRenderer, DrawBufferType.IndirectEnemy);
                this.drawOpa(passRenderer, DrawBufferType.GlaringLight);
                this.drawOpa(passRenderer, 0x17);
                this.drawOpa(passRenderer, 0x16);
                this.drawXlu(passRenderer, DrawBufferType.IndirectPlanet);
                this.drawXlu(passRenderer, DrawBufferType.IndirectMapObj);
                this.drawXlu(passRenderer, DrawBufferType.IndirectMapObjStrongLight);
                this.drawXlu(passRenderer, DrawBufferType.IndirectNpc);
                this.drawXlu(passRenderer, DrawBufferType.IndirectEnemy);
                this.drawXlu(passRenderer, DrawBufferType.GlaringLight);
                this.drawXlu(passRenderer, 0x17);
                this.drawXlu(passRenderer, 0x16);
                this.execute(passRenderer, DrawType.ElectricRailHolder);
                this.execute(passRenderer, DrawType.OceanRing);
                this.execute(passRenderer, DrawType.OceanBowl);
                this.execute(passRenderer, DrawType.EffectDrawIndirect);
                this.execute(passRenderer, DrawType.EffectDrawAfterIndirect);
                this.execute(passRenderer, DrawType.OceanRingPipeInside);
            });
        });

        if (this.hasAnyDrawBuffer(DrawBufferType.AstroMapBoard)) {
            const galaxyMapController = sceneObjHolder.galaxyMapController!;
            const layoutTargetID = galaxyMapController.pushPasses(sceneObjHolder, renderInstManager);

            builder.pushPass((pass) => {
                pass.setDebugName('Astro Map Board');
                const layoutResolveTextureID = builder.resolveRenderTarget(layoutTargetID);
                pass.attachResolveTexture(layoutResolveTextureID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                pass.exec((passRenderer, scope) => {
                    const layoutTexture = scope.getResolveTextureForID(layoutResolveTextureID);
                    sceneObjHolder.specialTextureBinder.lateBindTexture(SpecialTextureType.AstroMapBoard, layoutTexture);

                    this.drawOpa(passRenderer, DrawBufferType.AstroMapBoard);
                    this.drawXlu(passRenderer, DrawBufferType.AstroMapBoard);
                });
            });
        }

        const waterAreaHolder = sceneObjHolder.waterAreaHolder;
        if (waterAreaHolder !== null && waterAreaHolder.isOnWaterCameraFilter()) {
            builder.pushPass((pass) => {
                pass.setDebugName('Water Filter');
                const waterFilterOpaqueColorTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(waterFilterOpaqueColorTextureID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                pass.exec((passRenderer, scope) => {
                    const opaqueTexture = scope.getResolveTextureForID(waterFilterOpaqueColorTextureID);
                    sceneObjHolder.specialTextureBinder.lateBindTexture(SpecialTextureType.OpaqueSceneTexture, opaqueTexture);

                    this.execute(passRenderer, DrawType.WaterCameraFilter);
                });
            });
        }

        const imageEffectDirector = sceneObjHolder.imageEffectSystemHolder !== null ? sceneObjHolder.imageEffectSystemHolder.imageEffectDirector : null;
        if (imageEffectDirector !== null) {
            if (imageEffectDirector.isNormalBloomOn(sceneObjHolder)) {
                // Render Bloom Objects

                this.bloomObjectsDesc.copyDimensions(this.mainColorDesc);
                this.bloomObjectsDesc.colorClearColor = TransparentBlack;
                const bloomObjectsTargetID = builder.createRenderTargetID(this.bloomObjectsDesc, 'Bloom Objects');

                builder.pushPass((pass) => {
                    pass.setDebugName('Bloom Objects');
                    pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);
                    pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, bloomObjectsTargetID);
                    pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                    pass.exec((passRenderer) => {
                        this.drawOpa(passRenderer, DrawBufferType.BloomModel);
                        this.drawXlu(passRenderer, DrawBufferType.BloomModel);
                        this.execute(passRenderer, DrawType.BloomModel);
                        this.execute(passRenderer, DrawType.EffectDrawForBloomEffect);
                        this.execute(passRenderer, DrawType.OceanBowlBloomDrawer);
                    });
                });

                sceneObjHolder.bloomEffect!.pushPassesBloom(sceneObjHolder, builder, renderInstManager, bloomObjectsTargetID, mainColorTargetID);
            } else if (imageEffectDirector.currentEffect !== null) {
                imageEffectDirector.currentEffect.pushPasses(sceneObjHolder, builder, renderInstManager, mainColorTargetID, mainDepthTargetID, mainColorTargetID);
            }
        }

        builder.pushPass((pass) => {
            pass.setDebugName('After Image Effect');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.execute(passRenderer, DrawType.EffectDrawAfterImageEffect);

                // GameScene::draw2D()

                // exceuteDrawList2DNormal()
                this.drawOpa(passRenderer, DrawBufferType.Model3DFor2D);
                this.drawXlu(passRenderer, DrawBufferType.Model3DFor2D);
                this.execute(passRenderer, DrawType.CometScreenFilter);
                this.execute(passRenderer, DrawType.Layout);
            });
        });

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);

        // TODO(jstpierre): Make it so that we don't need an extra pass for this blit in the future?
        // Maybe have copyTextureToTexture as a native device method?
        builder.pushPass((pass) => {
            pass.setDebugName('Copy to Temporal Texture');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.mainColorTemporalTexture.getTextureForResolving());

        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorTargetID, viewerInput.mouseLocation);

        builder.pushPass((pass) => {
            pass.setDebugName('Copy to Onscreen Texture');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        sceneObjHolder.drawSyncManager.endFrame(renderInstManager, builder, mainDepthTargetID);

        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender();

        this.renderHelper.renderGraph.execute(builder);
        sceneObjHolder.sceneNameObjListExecutor.reset();
        renderInstManager.resetRenderInsts();
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        view.setUint8(offs++, this.currentScenarioIndex);
        return offs;
    }

    public deserializeSaveState(src: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(src);
        if (offs < byteLength)
            this.setCurrentScenario(view.getUint8(offs++));
        return offs;
    }

    public destroy(device: GfxDevice): void {
        this.mainColorTemporalTexture.destroy(device);
    }
}

function getLayerDirName(index: LayerId) {
    if (index === LayerId.Common) {
        return 'common';
    } else {
        assert(index >= 0);
        const char = String.fromCharCode('a'.charCodeAt(0) + index);
        return `layer${char}`;
    }
}

class TextureListHolder {
    public viewerTextures: Viewer.Texture[] = [];
    public onnewtextures: (() => void) | null = null;

    public addTextures(textures: Viewer.Texture[]): void {
        let changed = false;
        for (let i = 0; i < textures.length; i++) {
            if (this.viewerTextures.find((texture) => textures[i].name === texture.name) === undefined) {
                spliceBisectRight(this.viewerTextures, textures[i], (a, b) => a.name.localeCompare(b.name));
                changed = true;
            }
        }

        if (changed && this.onnewtextures !== null)
            this.onnewtextures();
    }
}

export class ModelCache {
    public archivePromiseCache = new Map<string, Promise<RARC.JKRArchive | null>>();
    public archiveCache = new Map<string, RARC.JKRArchive | null>();
    public archiveResourceHolder = new Map<string, ResourceHolder>();
    public archiveLayoutHolder = new Map<string, LayoutHolder>();
    public extraDataPromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    public extraDataCache = new Map<string, ArrayBufferSlice>();
    public cache: GfxRenderCache;
    public textureListHolder = new TextureListHolder();
    public gameSystemFontHolder: GameSystemFontHolder | null = null;
    public particleResourceHolder: ParticleResourceHolder | null = null;

    constructor(public device: GfxDevice, private pathBase: string, private dataFetcher: DataFetcher) {
        this.cache = new GfxRenderCache(device);
    }

    public waitForLoad(): Promise<void> {
        const v: Promise<any>[] = [... this.archivePromiseCache.values(), ... this.extraDataPromiseCache.values()];
        return Promise.all(v) as Promise<any>;
    }

    private async requestArchiveDataInternal(archivePath: string, abortedCallback: AbortedCallback): Promise<RARC.JKRArchive | null> {
        const buffer = await this.dataFetcher.fetchData(`${this.pathBase}/${archivePath}`, { allow404: true, abortedCallback });

        if (buffer.byteLength === 0) {
            console.warn(`Could not fetch archive ${archivePath}`);
            return null;
        }

        const decompressed = await Yaz0.decompress(buffer);
        const archiveName = archivePath.split('/').pop()!.split('.')[0];
        const rarc = RARC.parse(decompressed, archiveName);
        this.archiveCache.set(archivePath, rarc);
        return rarc;
    }

    public requestArchiveData(archivePath: string): Promise<RARC.JKRArchive | null> {
        if (this.archivePromiseCache.has(archivePath))
            return this.archivePromiseCache.get(archivePath)!;

        const p = this.requestArchiveDataInternal(archivePath, () => {
            this.archivePromiseCache.delete(archivePath);
        });
        this.archivePromiseCache.set(archivePath, p);
        return p;
    }

    public isArchiveExist(archivePath: string): boolean {
        return this.archiveCache.has(archivePath) && this.archiveCache.get(archivePath) !== null;
    }

    public getArchive(archivePath: string): RARC.JKRArchive | null {
        return assertExists(this.archiveCache.get(archivePath));
    }

    public requestObjectData(objectName: string) {
        return this.requestArchiveData(`ObjectData/${objectName}.arc`);
    }

    public requestLayoutData(layoutName: string) {
        return this.requestArchiveData(`LayoutData/${layoutName}.arc`);
    }

    public isObjectDataExist(objectName: string): boolean {
        return this.isArchiveExist(`ObjectData/${objectName}.arc`);
    }

    public getObjectData(objectName: string): RARC.JKRArchive {
        return assertExists(this.getArchive(`ObjectData/${objectName}.arc`));
    }

    public getLayoutData(layoutName: string): RARC.JKRArchive {
        return assertExists(this.getArchive(`LayoutData/${layoutName}.arc`));
    }

    private async requestExtraDataInternal(path: string, abortedCallback: AbortedCallback): Promise<ArrayBufferSlice> {
        const buffer = await this.dataFetcher.fetchData(`${this.pathBase}/${path}`, { abortedCallback });
        this.extraDataCache.set(path, buffer);
        return buffer;
    }

    public requestExtraData(path: string): Promise<ArrayBufferSlice> {
        if (this.extraDataPromiseCache.has(path))
            return this.extraDataPromiseCache.get(path)!;

        const p = this.requestExtraDataInternal(path, () => {
            this.extraDataPromiseCache.delete(path);
        });
        this.extraDataPromiseCache.set(path, p);
        return p;
    }

    public getExtraData(path: string): ArrayBufferSlice {
        return assertExists(this.extraDataCache.get(path));
    }

    public getResourceHolder(objectName: string): ResourceHolder {
        if (this.archiveResourceHolder.has(objectName))
            return this.archiveResourceHolder.get(objectName)!;

        const arc = this.getObjectData(objectName);
        const resourceHolder = new ResourceHolder(this.device, this.cache, objectName, arc);
        this.textureListHolder.addTextures(resourceHolder.viewerTextures);
        this.archiveResourceHolder.set(objectName, resourceHolder);
        return resourceHolder;
    }

    private ensureGameSystemFontHolder(): GameSystemFontHolder {
        if (this.gameSystemFontHolder === null)
            this.gameSystemFontHolder = new GameSystemFontHolder(this);
        return this.gameSystemFontHolder;
    }

    public ensureParticleResourceHolder(): ParticleResourceHolder {
        if (this.particleResourceHolder === null)
            this.particleResourceHolder = new ParticleResourceHolder(this);
        return this.particleResourceHolder;
    }

    public getLayoutHolder(layoutName: string): LayoutHolder {
        if (this.archiveLayoutHolder.has(layoutName))
            return this.archiveLayoutHolder.get(layoutName)!;

        const arc = this.getLayoutData(layoutName);
        const gameSystemFontHolder = this.ensureGameSystemFontHolder();
        const layoutHolder = new LayoutHolder(this.device, this.cache, gameSystemFontHolder, layoutName, arc);
        this.archiveLayoutHolder.set(layoutName, layoutHolder);
        return layoutHolder;
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy();
        for (const resourceHolder of this.archiveResourceHolder.values())
            resourceHolder.destroy(device);
        for (const layoutHolder of this.archiveLayoutHolder.values())
            layoutHolder.destroy(device);
        if (this.particleResourceHolder !== null)
            this.particleResourceHolder.destroy(device);
        if (this.gameSystemFontHolder !== null)
            this.gameSystemFontHolder.destroy(device);
    }
}

class ScenarioData {
    public zoneNames: string[];
    public scenarioDataIter: JMapInfoIter;
    public hasCometData: boolean;

    constructor(sceneDesc: SMGSceneDescBase, scenarioArc: RARC.JKRArchive) {
        const zoneListIter = createCsvParser(scenarioArc.findFileData('ZoneList.bcsv')!);
        this.zoneNames = zoneListIter.mapRecords((iter) => {
            return assertExists(iter.getValueString(`ZoneName`));
        });

        this.scenarioDataIter = createCsvParser(scenarioArc.findFileData('ScenarioData.bcsv')!);

        const hasCometData = sceneDesc.gameBit === GameBits.SMG1
        this.hasCometData = hasCometData && this.scenarioDataIter.findRecord((iter) => {
            return iter.getValueString('Comet') !== null;
        });
    }

    public getMasterZoneFilename(): string {
        // Master zone name is always the first record...
        return this.zoneNames[0];
    }
}

class AreaObjContainer extends NameObj {
    private managers: AreaObjMgr<AreaObj>[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'AreaObjContainer');
        this.managers.push(new LightAreaHolder(sceneObjHolder));
        this.managers.push(new WaterAreaMgr(sceneObjHolder));
        this.managers.push(new ImageEffectAreaMgr(sceneObjHolder));
        this.managers.push(new AreaObjMgr(sceneObjHolder, 'LensFlareArea'));
        this.managers.push(new AreaObjMgr<SwitchArea>(sceneObjHolder, 'SwitchArea'));
        this.managers.push(new AreaObjMgr<HazeCube>(sceneObjHolder, 'HazeCube'));
        this.managers.push(new AreaObjMgr<MercatorTransformCube>(sceneObjHolder, 'MercatorCube'));
        this.managers.push(new AreaObjMgr<DeathArea>(sceneObjHolder, 'DeathArea'));
        this.managers.push(new AreaObjMgr<MessageArea>(sceneObjHolder, 'MessageArea'));
    }

    public getManager(managerName: string): AreaObjMgr<AreaObj> {
        for (let i = 0; i < this.managers.length; i++)
            if (this.managers[i].name === managerName)
                return this.managers[i];
        throw "whoops";
    }

    public getAreaObj<T extends AreaObj>(managerName: string, position: ReadonlyVec3): T | null {
        const mgr = this.getManager(managerName);
        return mgr.find_in(position) as (T | null);
    }
}

export const enum SceneObj {
    SensorHitChecker               = 0x00,
    CollisionDirector              = 0x01,
    ClippingDirector               = 0x02,
    DemoDirector                   = 0x03,
    EventDirector                  = 0x04,
    EffectSystem                   = 0x05,
    LightDirector                  = 0x06,
    SceneDataInitializer           = 0x07,
    StageDataHolder                = 0x08,
    MessageSensorHolder            = 0x09,
    StageSwitchContainer           = 0x0A,
    SwitchWatcherHolder            = 0x0B,
    SleepControllerHolder          = 0x0C,
    AreaObjContainer               = 0x0D,
    LiveActorGroupArray            = 0x0E,
    MovementOnOffGroupHolder       = 0x0F,
    CaptureScreenActor             = 0x10,
    AudCameraWatcher               = 0x11,
    AudEffectDirector              = 0x12,
    AudBgmConductor                = 0x13,
    MarioHolder                    = 0x14,
    // Removed                     = 0x15,
    MirrorCamera                   = 0x16,
    CameraContext                  = 0x17,
    IgnorePauseNameObj             = 0x18,
    TalkDirector                   = 0x19,
    EventSequencer                 = 0x1A,
    StopSceneController            = 0x1B,
    SceneNameObjMovementController = 0x1C,
    ImageEffectSystemHolder        = 0x1D,
    BloomEffect                    = 0x1E,
    BloomEffectSimple              = 0x1F,
    ScreenBlurEffect               = 0x20,
    DepthOfFieldBlur               = 0x21,
    SceneWipeHolder                = 0x22,
    PlayerActionGuidance           = 0x23,
    ScenePlayingResult             = 0x24,
    LensFlareDirector              = 0x25,
    FurDrawManager                 = 0x26,
    PlacementStateChecker          = 0x27,
    NamePosHolder                  = 0x28,
    NPCDirector                    = 0x29,
    ResourceShare                  = 0x2A,
    MoviePlayerSimple              = 0x2B,
    WarpPodMgr                     = 0x2C,
    CenterScreenBlur               = 0x2D,
    OdhConverter                   = 0x2E,
    CometRetryButton               = 0x2F,
    AllLiveActorGroup              = 0x30,
    CameraDirector                 = 0x31,
    PlanetGravityManager           = 0x32,
    BaseMatrixFollowTargetHolder   = 0x33,
    GameSceneLayoutHolder          = 0x34,
    // Removed                     = 0x35
    CoinHolder                     = 0x36,
    PurpleCoinHolder               = 0x37,
    CoinRotater                    = 0x38,
    AirBubbleHolder                = 0x39,
    BigFanHolder                   = 0x3A,
    KarikariDirector               = 0x3B,
    StarPieceDirector              = 0x3C,
    BegomanAttackPermitter         = 0x3D,
    TripodBossAccesser             = 0x3E,
    KameckBeamHolder               = 0x3F,
    KameckFireBallHolder           = 0x40,
    KameckBeamTurtleHolder         = 0x41,
    KabokuriFireHolder             = 0x42,
    TakoHeiInkHolder               = 0x43,
    ShadowControllerHolder         = 0x44,
    ShadowVolumeDrawInit           = 0x45,
    ShadowSurfaceDrawInit          = 0x46,
    SwingRopeGroup                 = 0x47,
    PlantStalkDrawInit             = 0x48,
    PlantLeafDrawInit              = 0x49,
    TrapezeRopeDrawInit            = 0x4A,
    // Removed                     = 0x4B,
    VolumeModelDrawInit            = 0x4C,
    SpinDriverPathDrawInit         = 0x4D,
    NoteGroup                      = 0x4E,
    ClipAreaDropHolder             = 0x4F,
    FallOutFieldDraw               = 0x50,
    ClipFieldFillDraw              = 0x51,
    // Removed                     = 0x52,
    ClipAreaHolder                 = 0x53,
    ArrowSwitchMultiHolder         = 0x54,
    ScreenAlphaCapture             = 0x55,
    MapPartsRailGuideHolder        = 0x56,
    GCapture                       = 0x57,
    NameObjExecuteHolder           = 0x58,
    ElectricRailHolder             = 0x59,
    SpiderThread                   = 0x5A,
    QuakeEffectGenerator           = 0x5B,
    // Removed                     = 0x5C,
    HeatHazeDirector               = 0x5D,
    ChipHolderYellow               = 0x5E,
    ChipHolderBlue                 = 0x5F,
    BigBubbleHolder                = 0x60,
    EarthenPipeMediator            = 0x61,
    WaterAreaHolder                = 0x62,
    WaterPlantDrawInit             = 0x63,
    OceanHomeMapCtrl               = 0x64,
    RaceManager                    = 0x65,
    GroupCheckManager              = 0x66,
    SkeletalFishBabyRailHolder     = 0x67,
    SkeletalFishBossRailHolder     = 0x68,
    WaterPressureBulletHolder      = 0x69,
    FirePressureBulletHolder       = 0x6A,
    SunshadeMapHolder              = 0x6B,
    MiiFacePartsHolder             = 0x6C,
    MiiFaceIconHolder              = 0x6D,
    FluffWindHolder                = 0x6E,
    SphereSelector                 = 0x6F,
    GalaxyNamePlateDrawer          = 0x70,
    CinemaFrame                    = 0x71,
    BossAccessor                   = 0x72,
    MiniatureGalaxyHolder          = 0x73,
    PlanetMapCreator               = 0x74,
    PriorDrawAirHolder             = 0x75,
    InformationObserver            = 0x76,
    GalaxyMapController            = 0x77,
    MoviePlayingSequenceHolder     = 0x78,
    PrologueHolder                 = 0x79,
    StaffRoll                      = 0x7A,

    // Noclip additions
    GalaxyNameSortTable            = 0xA0,
    GalaxyCometScreenFilter        = 0xA1, // technically part of EventDirector, punting on that for now
}

class DebugUtils {
    public createCsvParser(buffer: ArrayBufferSlice): JMapInfoIter {
        return createCsvParser(buffer);
    }
}

export class SceneObjHolder {
    public sceneDesc: SMGSceneDescBase;
    public modelCache: ModelCache;
    public spawner: SMGSpawner;

    // Some of these should totally be SceneObj's... oops.
    public scenarioData: ScenarioData;
    public planetMapCreator: PlanetMapCreator;
    public lightDirector: LightDirector;
    public npcDirector: NPCDirector;
    public stageDataHolder: StageDataHolder;
    public messageHolder: MessageHolder;

    public sensorHitChecker: SensorHitChecker | null = null;
    public collisionDirector: CollisionDirector | null = null;
    public demoDirector: DemoDirector | null = null;
    public effectSystem: EffectSystem | null = null;
    public stageSwitchContainer: StageSwitchContainer | null = null;
    public switchWatcherHolder: SwitchWatcherHolder | null = null;
    public sleepControllerHolder: SleepControllerHolder | null = null;
    public areaObjContainer: AreaObjContainer | null = null;
    public liveActorGroupArray: LiveActorGroupArray | null = null;
    public talkDirector: TalkDirector | null = null;
    public imageEffectSystemHolder: ImageEffectSystemHolder | null = null;
    public bloomEffect: BloomEffect | null = null;
    public bloomEffectSimple: BloomEffectSimple | null = null;
    public depthOfFieldBlur: DepthOfFieldBlur | null = null;
    public lensFlareDirector: LensFlareDirector | null = null;
    public furDrawManager: FurDrawManager | null = null;
    public namePosHolder: NamePosHolder | null = null;
    public planetGravityManager: PlanetGravityManager | null = null;
    public baseMatrixFollowTargetHolder: BaseMatrixFollowTargetHolder | null = null;
    public coinHolder: CoinHolder | null = null;
    public coinRotater: CoinRotater | null = null;
    public airBubbleHolder: AirBubbleHolder | null = null;
    public starPieceDirector: StarPieceDirector | null = null;
    public kameckBeamHolder: KameckBeamHolder | null = null;
    public kameckFireBallHolder: KameckFireBallHolder | null = null;
    public kameckBeamTurtleHolder: KameckBeamTurtleHolder | null = null;
    public takoHeiInkHolder: TakoHeiInkHolder | null = null;
    public shadowControllerHolder: ShadowControllerHolder | null = null;
    public swingRopeGroup: SwingRopeGroup | null = null;
    public trapezeRopeDrawInit: TrapezeRopeDrawInit | null = null;
    public spinDriverPathDrawInit: SpinDriverPathDrawInit | null = null;
    public clipAreaDropHolder: ClipAreaDropHolder | null = null;
    public fallOutFieldDraw: FallOutFieldDraw | null = null;
    public clipAreaHolder: ClipAreaHolder | null = null;
    public mapPartsRailGuideHolder: MapPartsRailGuideHolder | null = null;
    public electricRailHolder: ElectricRailHolder | null = null;
    public heatHazeDirector: HeatHazeDirector | null = null;
    public waterAreaHolder: WaterAreaHolder | null = null;
    public waterPlantDrawInit: WaterPlantDrawInit | null = null;
    public waterPressureBulletHolder: WaterPressureBulletHolder | null = null;
    public miniatureGalaxyHolder: MiniatureGalaxyHolder | null = null;
    public priorDrawAirHolder: PriorDrawAirHolder | null = null;
    public galaxyMapController: GalaxyMapController | null = null;

    // noclip additions -- some of these are singletons in the original game.
    public galaxyNameSortTable: GalaxyNameSortTable | null = null;
    public galaxyCometScreenFilter: GalaxyCometScreenFilter | null = null;

    // Other singletons that are not SceneObjHolder.
    public drawSyncManager = new DrawSyncManager();
    public sceneNameObjListExecutor = new SceneNameObjListExecutor();
    public nameObjHolder = new NameObjHolder();

    // Technically should be on the StageDataHolder, but since that has children, I think that's ugly.
    public objNameTable: JMapInfoIter;

    // Noclip-specific stuff.
    public deltaTimeFrames: number;
    public specialTextureBinder: SpecialTextureBinder;
    public renderParams = new RenderParams();
    public graphBuilder: GfxrGraphBuilder;
    public viewerInput: Viewer.ViewerRenderInput;
    public uiContainer: HTMLElement;
    public debugUtils = new DebugUtils();

    public create(sceneObj: SceneObj): void {
        if (this.getObj(sceneObj) === null)
            this.newEachObj(sceneObj);
    }

    public getObj(sceneObj: SceneObj): NameObj | null {
        if (sceneObj === SceneObj.SensorHitChecker)
            return this.sensorHitChecker;
        else if (sceneObj === SceneObj.CollisionDirector)
            return this.collisionDirector;
        else if (sceneObj === SceneObj.DemoDirector)
            return this.demoDirector;
        else if (sceneObj === SceneObj.StageSwitchContainer)
            return this.stageSwitchContainer;
        else if (sceneObj === SceneObj.EffectSystem)
            return this.effectSystem;
        else if (sceneObj === SceneObj.SwitchWatcherHolder)
            return this.switchWatcherHolder;
        else if (sceneObj === SceneObj.SleepControllerHolder)
            return this.sleepControllerHolder;
        else if (sceneObj === SceneObj.AreaObjContainer)
            return this.areaObjContainer;
        else if (sceneObj === SceneObj.LiveActorGroupArray)
            return this.liveActorGroupArray;
        else if (sceneObj === SceneObj.TalkDirector)
            return this.talkDirector;
        else if (sceneObj === SceneObj.ImageEffectSystemHolder)
            return this.imageEffectSystemHolder;
        else if (sceneObj === SceneObj.BloomEffect)
            return this.bloomEffect;
        else if (sceneObj === SceneObj.BloomEffectSimple)
            return this.bloomEffectSimple;
        else if (sceneObj === SceneObj.DepthOfFieldBlur)
            return this.depthOfFieldBlur;
        else if (sceneObj === SceneObj.LensFlareDirector)
            return this.lensFlareDirector;
        else if (sceneObj === SceneObj.FurDrawManager)
            return this.furDrawManager;
        else if (sceneObj === SceneObj.NamePosHolder)
            return this.namePosHolder;
        else if (sceneObj === SceneObj.PlanetGravityManager)
            return this.planetGravityManager;
        else if (sceneObj === SceneObj.BaseMatrixFollowTargetHolder)
            return this.baseMatrixFollowTargetHolder;
        else if (sceneObj === SceneObj.CoinHolder)
            return this.coinHolder;
        else if (sceneObj === SceneObj.CoinRotater)
            return this.coinRotater;
        else if (sceneObj === SceneObj.AirBubbleHolder)
            return this.airBubbleHolder;
        else if (sceneObj === SceneObj.StarPieceDirector)
            return this.starPieceDirector;
        else if (sceneObj === SceneObj.KameckBeamHolder)
            return this.kameckBeamHolder;
        else if (sceneObj === SceneObj.KameckFireBallHolder)
            return this.kameckFireBallHolder;
        else if (sceneObj === SceneObj.KameckBeamTurtleHolder)
            return this.kameckBeamTurtleHolder;
        else if (sceneObj === SceneObj.TakoHeiInkHolder)
            return this.takoHeiInkHolder;
        else if (sceneObj === SceneObj.ShadowControllerHolder)
            return this.shadowControllerHolder;
        else if (sceneObj === SceneObj.SwingRopeGroup)
            return this.swingRopeGroup;
        else if (sceneObj === SceneObj.TrapezeRopeDrawInit)
            return this.trapezeRopeDrawInit;
        else if (sceneObj === SceneObj.SpinDriverPathDrawInit)
            return this.spinDriverPathDrawInit;
        else if (sceneObj === SceneObj.ClipAreaDropHolder)
            return this.clipAreaDropHolder;
        else if (sceneObj === SceneObj.FallOutFieldDraw)
            return this.fallOutFieldDraw;
        else if (sceneObj === SceneObj.ClipAreaHolder)
            return this.clipAreaHolder;
        else if (sceneObj === SceneObj.MapPartsRailGuideHolder)
            return this.mapPartsRailGuideHolder;
        else if (sceneObj === SceneObj.ElectricRailHolder)
            return this.electricRailHolder;
        else if (sceneObj === SceneObj.HeatHazeDirector)
            return this.heatHazeDirector;
        else if (sceneObj === SceneObj.WaterAreaHolder)
            return this.waterAreaHolder;
        else if (sceneObj === SceneObj.WaterPlantDrawInit)
            return this.waterPlantDrawInit;
        else if (sceneObj === SceneObj.WaterPressureBulletHolder)
            return this.waterPressureBulletHolder;
        else if (sceneObj === SceneObj.MiniatureGalaxyHolder)
            return this.miniatureGalaxyHolder;
        else if (sceneObj === SceneObj.PriorDrawAirHolder)
            return this.priorDrawAirHolder;
        else if (sceneObj === SceneObj.GalaxyMapController)
            return this.galaxyMapController;
        else if (sceneObj === SceneObj.GalaxyNameSortTable)
            return this.galaxyNameSortTable;
        else if (sceneObj === SceneObj.GalaxyCometScreenFilter)
            return this.galaxyCometScreenFilter;
        return null;
    }

    private newEachObj(sceneObj: SceneObj): void {
        if (sceneObj === SceneObj.SensorHitChecker)
            this.sensorHitChecker = new SensorHitChecker(this);
        else if (sceneObj === SceneObj.CollisionDirector)
            this.collisionDirector = new CollisionDirector(this);
        else if (sceneObj === SceneObj.DemoDirector)
            this.demoDirector = new DemoDirector(this);
        else if (sceneObj === SceneObj.EffectSystem)
            this.effectSystem = new EffectSystem(this);
        else if (sceneObj === SceneObj.StageSwitchContainer)
            this.stageSwitchContainer = new StageSwitchContainer(this);
        else if (sceneObj === SceneObj.SwitchWatcherHolder)
            this.switchWatcherHolder = new SwitchWatcherHolder(this);
        else if (sceneObj === SceneObj.SleepControllerHolder)
            this.sleepControllerHolder = new SleepControllerHolder(this);
        else if (sceneObj === SceneObj.AreaObjContainer)
            this.areaObjContainer = new AreaObjContainer(this);
        else if (sceneObj === SceneObj.LiveActorGroupArray)
            this.liveActorGroupArray = new LiveActorGroupArray(this);
        else if (sceneObj === SceneObj.TalkDirector)
            this.talkDirector = new TalkDirector(this);
        else if (sceneObj === SceneObj.ImageEffectSystemHolder)
            this.imageEffectSystemHolder = new ImageEffectSystemHolder(this);
        else if (sceneObj === SceneObj.BloomEffect)
            this.bloomEffect = new BloomEffect(this);
        else if (sceneObj === SceneObj.BloomEffectSimple)
            this.bloomEffectSimple = new BloomEffectSimple(this);
        else if (sceneObj === SceneObj.DepthOfFieldBlur)
            this.depthOfFieldBlur = new DepthOfFieldBlur(this);
        else if (sceneObj === SceneObj.LensFlareDirector)
            this.lensFlareDirector = new LensFlareDirector(this);
        else if (sceneObj === SceneObj.FurDrawManager)
            this.furDrawManager = new FurDrawManager(this);
        else if (sceneObj === SceneObj.NamePosHolder)
            this.namePosHolder = new NamePosHolder(this);
        else if (sceneObj === SceneObj.PlanetGravityManager)
            this.planetGravityManager = new PlanetGravityManager(this);
        else if (sceneObj === SceneObj.BaseMatrixFollowTargetHolder)
            this.baseMatrixFollowTargetHolder = new BaseMatrixFollowTargetHolder(this);
        else if (sceneObj === SceneObj.CoinHolder)
            this.coinHolder = new CoinHolder(this);
        else if (sceneObj === SceneObj.CoinRotater)
            this.coinRotater = new CoinRotater(this);
        else if (sceneObj === SceneObj.AirBubbleHolder)
            this.airBubbleHolder = new AirBubbleHolder(this);
        else if (sceneObj === SceneObj.StarPieceDirector)
            this.starPieceDirector = new StarPieceDirector(this);
        else if (sceneObj === SceneObj.KameckBeamHolder)
            this.kameckBeamHolder = new KameckBeamHolder(this);
        else if (sceneObj === SceneObj.KameckFireBallHolder)
            this.kameckFireBallHolder = new KameckFireBallHolder(this);
        else if (sceneObj === SceneObj.KameckBeamTurtleHolder)
            this.kameckBeamTurtleHolder = new KameckBeamTurtleHolder(this);
        else if (sceneObj === SceneObj.TakoHeiInkHolder)
            this.takoHeiInkHolder = new TakoHeiInkHolder(this);
        else if (sceneObj === SceneObj.ShadowControllerHolder)
            this.shadowControllerHolder = new ShadowControllerHolder(this);
        else if (sceneObj === SceneObj.SwingRopeGroup)
            this.swingRopeGroup = new SwingRopeGroup(this);
        else if (sceneObj === SceneObj.TrapezeRopeDrawInit)
            this.trapezeRopeDrawInit = new TrapezeRopeDrawInit(this);
        else if (sceneObj === SceneObj.SpinDriverPathDrawInit)
            this.spinDriverPathDrawInit = new SpinDriverPathDrawInit(this);
        else if (sceneObj === SceneObj.ClipAreaDropHolder)
            this.clipAreaDropHolder = new ClipAreaDropHolder(this);
        else if (sceneObj === SceneObj.FallOutFieldDraw)
            assert(false); // Handled by createFallOutFieldDraw
        else if (sceneObj === SceneObj.ClipAreaHolder)
            this.clipAreaHolder = new ClipAreaHolder(this);
        else if (sceneObj === SceneObj.MapPartsRailGuideHolder)
            this.mapPartsRailGuideHolder = new MapPartsRailGuideHolder(this);
        else if (sceneObj === SceneObj.ElectricRailHolder)
            this.electricRailHolder = new ElectricRailHolder(this);
        else if (sceneObj === SceneObj.HeatHazeDirector)
            this.heatHazeDirector = new HeatHazeDirector(this);
        else if (sceneObj === SceneObj.WaterAreaHolder)
            this.waterAreaHolder = new WaterAreaHolder(this);
        else if (sceneObj === SceneObj.WaterPlantDrawInit)
            this.waterPlantDrawInit = new WaterPlantDrawInit(this);
        else if (sceneObj === SceneObj.WaterPressureBulletHolder)
            this.waterPressureBulletHolder = new WaterPressureBulletHolder(this);
        else if (sceneObj === SceneObj.MiniatureGalaxyHolder)
            this.miniatureGalaxyHolder = new MiniatureGalaxyHolder(this);
        else if (sceneObj === SceneObj.PriorDrawAirHolder)
            this.priorDrawAirHolder = new PriorDrawAirHolder(this);
        else if (sceneObj === SceneObj.GalaxyMapController)
            this.galaxyMapController = new GalaxyMapController(this);
        else if (sceneObj === SceneObj.GalaxyNameSortTable)
            this.galaxyNameSortTable = new GalaxyNameSortTable(this);
        else if (sceneObj === SceneObj.GalaxyCometScreenFilter)
            this.galaxyCometScreenFilter = new GalaxyCometScreenFilter(this);
    }

    public requestArchives(): void {
        ShadowControllerHolder.requestArchives(this);
        StarPieceDirector.requestArchives(this);
        CoinHolder.requestArchives(this);
        TalkDirector.requestArchives(this);
    }

    public destroy(device: GfxDevice): void {
        this.nameObjHolder.destroy(device);
        this.drawSyncManager.destroy(device);
        this.specialTextureBinder.destroy(device);
    }
}

export function getObjectName(infoIter: JMapInfoIter): string {
    return assertExists(infoIter.getValueString(`name`));
}

function layerVisible(layer: LayerId, layerMask: number): boolean {
    if (layer >= 0)
        return !!(layerMask & (1 << layer));
    else
        return true;
}

class ZoneNode {
    public name: string;

    // The current layer mask for objects and sub-zones in this zone.
    public layerMask: number = 0xFFFFFFFF;
    // Game might be able to set the visibility of a zone at runtime in SMG2.
    public visible: boolean = true;
    // Whether the layer of our parent zone is visible.
    public layerVisible: boolean = true;
    public subzones: ZoneNode[] = [];

    constructor(public stageDataHolder: StageDataHolder) {
        this.name = stageDataHolder.zoneName;
    }

    public computeZoneVisibility(): void {
        for (let i = 0; i < this.subzones.length; i++)
            this.subzones[i].layerVisible = this.layerVisible && layerVisible(this.subzones[i].stageDataHolder.layerId, this.layerMask);
    }
}

// TODO(jstpierre): Remove
class SMGSpawner {
    public zones: ZoneNode[] = [];

    private legacySpawner: NoclipLegacyActorSpawner;

    constructor(private sceneObjHolder: SceneObjHolder) {
        this.legacySpawner = new NoclipLegacyActorSpawner(this.sceneObjHolder);
    }

    private getActorTableEntry(objName: string): NameObjFactoryTableEntry | null {
        const gameBit = this.sceneObjHolder.sceneDesc.gameBit;

        const actorTableEntry = getNameObjFactoryTableEntry(objName, gameBit);
        if (actorTableEntry !== null)
            return actorTableEntry;

        const planetTableEntry = this.sceneObjHolder.planetMapCreator.getActorTableEntry(objName, gameBit);
        if (planetTableEntry !== null)
            return planetTableEntry;

        return null;
    }

    private placeZones(stageDataHolder: StageDataHolder): ZoneNode {
        const zoneNode = new ZoneNode(stageDataHolder);
        this.zones.push(zoneNode);

        for (let i = 0; i < stageDataHolder.localStageDataHolders.length; i++) {
            const subzone = this.placeZones(stageDataHolder.localStageDataHolders[i]);
            zoneNode.subzones.push(subzone);
        }

        return zoneNode;
    }

    private placeStageData(stageDataHolder: StageDataHolder, priority: boolean): void {
        stageDataHolder.iterPlacement((infoIter, zoneAndLayer) => {
            const actorTableEntry = this.getActorTableEntry(getObjectName(infoIter));

            if (actorTableEntry !== null) {
                // Explicitly null, don't spawn anything.
                if (actorTableEntry.factoryFunc === null)
                    return;

                actorTableEntry.factoryFunc(zoneAndLayer, this.sceneObjHolder, infoIter);
            } else {
                // Spawn legacy.
                const infoIterCopy = copyInfoIter(infoIter);
                this.legacySpawner.spawnObjectLegacy(zoneAndLayer, infoIterCopy);
            }
        }, priority);

        for (let i = 0; i < stageDataHolder.localStageDataHolders.length; i++)
            this.placeStageData(stageDataHolder.localStageDataHolders[i], priority);
    }

    public place(): void {
        const stageDataHolder = this.sceneObjHolder.stageDataHolder;
        this.placeZones(stageDataHolder);
        this.placeStageData(stageDataHolder, true);
        this.placeStageData(stageDataHolder, false);

        // We trigger "after placement" here because legacy objects should not require it,
        // and nothing should depend on legacy objects being placed. Since legacy objects
        // are asynchronous, it would just be racy to place it below.
        this.sceneObjHolder.nameObjHolder.initAfterPlacement(this.sceneObjHolder);

        this.legacySpawner.place();
    }

    private requestArchivesForObj(infoIter: JMapInfoIter): void {
        const objName = getObjectName(infoIter);

        if (this.sceneObjHolder.planetMapCreator.isRegisteredObj(objName)) {
            this.sceneObjHolder.planetMapCreator.requestArchive(this.sceneObjHolder, objName);
            return;
        }

        const actorTableEntry = this.getActorTableEntry(objName);
        if (actorTableEntry !== null && actorTableEntry.requestArchivesFunc !== null)
            actorTableEntry.requestArchivesFunc(this.sceneObjHolder, infoIter);
    }

    private requestArchivesForStageDataHolder(stageDataHolder: StageDataHolder): void {
        stageDataHolder.iterPlacement((infoIter, layerId) => {
            this.requestArchivesForObj(infoIter);
        });

        for (let i = 0; i < stageDataHolder.localStageDataHolders.length; i++)
            this.requestArchivesForStageDataHolder(stageDataHolder.localStageDataHolders[i]);
    }

    public requestArchives(): void {
        this.requestArchivesForStageDataHolder(this.sceneObjHolder.stageDataHolder);
        this.legacySpawner.requestArchives(this.sceneObjHolder);
    }

    public checkAliveScenario(zoneAndLayer: ZoneAndLayer): boolean {
        // Dynamic zones are always visible.
        if (zoneAndLayer.zoneId < 0) {
            assert(zoneAndLayer.layerId < 0);
            return true;
        }

        // Check any placed zones that match the zone ID.
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];

            if (zone.stageDataHolder.zoneId !== zoneAndLayer.zoneId)
                continue;

            // If this actor is visible in *any* matching placed zones, then it's visible.
            if (zone.visible && zone.layerVisible && layerVisible(zoneAndLayer.layerId, zone.layerMask))
                return true;
        }

        return false;
    }
}

export class NamePosInfo {
    public translation = vec3.create();
    public rotation = vec3.create();
    public linkInfo: JMapLinkInfo | null = null;
    public linkObj: NameObj | null = null;

    constructor(public zoneAndLayer: ZoneAndLayer, public name: string) {
    }
}

class NamePosHolder extends NameObj {
    private namePos: NamePosInfo[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'NamePosHolder');

        sceneObjHolder.stageDataHolder.iterGeneralPos((infoIter, layerId) => {
            const name = assertExists(infoIter.getValueString('PosName'));
            const namePos = new NamePosInfo(layerId, name);
            getJMapInfoTrans(namePos.translation, sceneObjHolder, infoIter);
            getJMapInfoRotate(namePos.rotation, sceneObjHolder, infoIter);
            namePos.linkInfo = JMapLinkInfo.createLinkInfo(sceneObjHolder, infoIter);
            this.namePos.push(namePos);
        });
    }

    public find(nameObj: NameObj | null, name: string): NamePosInfo | null {
        for (let i = 0; i < this.namePos.length; i++) {
            const namePos = this.namePos[i];
            if (namePos.name === name && (nameObj === null || namePos.linkInfo === null || namePos.linkObj === nameObj))
                return namePos;
        }
        return null;
    }

    public tryRegisterLinkObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj, infoIter: JMapInfoIter): boolean {
        const link = JMapLinkInfo.createLinkedInfo(sceneObjHolder, infoIter);
        if (link === null)
            return false;

        for (let i = 0; i < this.namePos.length; i++) {
            const namePos = this.namePos[i];
            if (namePos.linkInfo !== null && namePos.linkInfo.equals(link)) {
                assert(namePos.linkObj === null);
                namePos.linkObj = nameObj;
                return true;
            }
        }

        return false;
    }
}

interface JMapInfoIter_StageDataHolder extends JMapInfoIter {
    originalStageDataHolder: StageDataHolder;
}

function copyInfoIter(infoIter: JMapInfoIter): JMapInfoIter {
    const iter = new JMapInfoIter(infoIter.filename, infoIter.bcsv, infoIter.record);
    (iter as JMapInfoIter_StageDataHolder).originalStageDataHolder = (infoIter as JMapInfoIter_StageDataHolder).originalStageDataHolder;
    return iter;
}

type LayerObjInfoCallback = (infoIter: JMapInfoIter, zoneAndLayer: ZoneAndLayer) => void;

class StageDataHolder {
    private zoneArchive: RARC.JKRArchive;
    public localStageDataHolders: StageDataHolder[] = [];
    public placementMtx = mat4.create();

    constructor(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, scenarioData: ScenarioData, public zoneName: string, public zoneId: number, public layerId: LayerId = -1) {
        this.zoneArchive = sceneDesc.getZoneMapArchive(modelCache, zoneName);
        this.createLocalStageDataHolders(sceneDesc, modelCache, scenarioData);
    }

    private createCsvParser(buffer: ArrayBufferSlice, filename: string | null = null): JMapInfoIter {
        const iter = createCsvParser(buffer, filename);
        (iter as JMapInfoIter_StageDataHolder).originalStageDataHolder = this;
        return iter;
    }

    public getCommonPathPointInfo(railId: number): [JMapInfoIter, JMapInfoIter] {
        const commonPathInfo = this.createCsvParser(this.zoneArchive.findFileData(`jmp/path/CommonPathInfo`)!);

        for (let i = 0; i < commonPathInfo.getNumRecords(); i++) {
            commonPathInfo.setRecord(i);
            if (commonPathInfo.getValueNumber(`l_id`) === railId)
                break;
        }

        const no = commonPathInfo.getValueNumber('no')!;
        const pointInfo = this.createCsvParser(this.zoneArchive.findFileData(`jmp/path/CommonPathPointInfo.${no}`)!);

        return [commonPathInfo, pointInfo];
    }

    private isPrioPlacementObjInfo(filename: string): boolean {
        return (filename === 'areaobjinfo' || filename === 'planetobjinfo' || filename === 'demoobjinfo' || filename === 'cameracubeinfo');
    }

    private iterJmpInfo(layerId: LayerId, callback: LayerObjInfoCallback, filename: string, buffer: ArrayBufferSlice): void {
        const zoneAndLayer: ZoneAndLayer = { zoneId: this.zoneId, layerId };
        const iter = this.createCsvParser(buffer, filename);

        for (let i = 0; i < iter.getNumRecords(); i++) {
            iter.setRecord(i);
            callback(iter, zoneAndLayer);
        }
    }

    private iterAllLayerJmpInfo(priority: boolean | null, layerId: LayerId, callback: LayerObjInfoCallback, dir: RARC.RARCDir): void {
        for (let i = 0; i < dir.files.length; i++) {
            const file = dir.files[i];

            const filename = file.name.toLowerCase();

            // The game skips any actors it doesn't recognize, and includes the sub-zones in the list.
            // We can't easily do that because we have legacy actors, so just skip StageObjInfo for now...
            if (filename === 'stageobjinfo')
                continue;

            if (priority !== null && (this.isPrioPlacementObjInfo(filename) !== priority))
                continue;

            this.iterJmpInfo(layerId, callback, filename, file.buffer);
        }
    }

    public iterPlacement(callback: LayerObjInfoCallback, priority: boolean | null = null): void {
        for (let i = LayerId.Common; i <= LayerId.LayerMax; i++) {
            const layerDirName = getLayerDirName(i);

            const placementDir = this.zoneArchive.findDir(`jmp/Placement/${layerDirName}`);
            if (placementDir !== null)
                this.iterAllLayerJmpInfo(priority, i, callback, placementDir);

            const mapPartsDir = this.zoneArchive.findDir(`jmp/MapParts/${layerDirName}`);
            if (mapPartsDir !== null)
                this.iterAllLayerJmpInfo(priority, i, callback, mapPartsDir);
        }
    }

    public iterGeneralPos(callback: LayerObjInfoCallback): void {
        for (let i = LayerId.Common; i <= LayerId.LayerMax; i++) {
            const layerDirName = getLayerDirName(i);

            const generalPosDir = this.zoneArchive.findDir(`jmp/GeneralPos/${layerDirName}`);
            if (generalPosDir !== null)
                this.iterAllLayerJmpInfo(null, i, callback, generalPosDir);
        }

        for (let i = 0; i < this.localStageDataHolders.length; i++)
            this.localStageDataHolders[i].iterGeneralPos(callback);
    }

    public iterChildObjInternal(parentID: number, callback: LayerObjInfoCallback): void {
        for (let i = LayerId.Common; i <= LayerId.LayerMax; i++) {
            const layerDirName = getLayerDirName(i);

            const childObjDir = this.zoneArchive.findDir(`jmp/ChildObj/${layerDirName}`);
            if (childObjDir !== null) {
                this.iterAllLayerJmpInfo(null, i, (infoIter, zoneAndLayer) => {
                    const iterParentID = infoIter.getValueNumber('ParentID');
                    if (iterParentID === parentID)
                        callback(infoIter, zoneAndLayer);
                }, childObjDir);
            }
        }
    }

    public createLocalStageDataHolders(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, scenarioData: ScenarioData): void {
        for (let i = LayerId.Common; i <= LayerId.LayerMax; i++) {
            const layerDirName = getLayerDirName(i);
            const stageObjInfo = this.zoneArchive.findFileData(`jmp/Placement/${layerDirName}/StageObjInfo`);

            if (stageObjInfo === null)
                continue;

            const mapInfoIter = createCsvParser(stageObjInfo);

            for (let j = 0; j < mapInfoIter.getNumRecords(); j++) {
                mapInfoIter.setRecord(j);
                const zoneName = getObjectName(mapInfoIter);
                const zoneId = scenarioData.zoneNames.indexOf(zoneName);
                assert(zoneId >= 0);
                const localStage = new StageDataHolder(sceneDesc, modelCache, scenarioData, zoneName, zoneId, i);
                localStage.calcPlacementMtx(mapInfoIter);
                this.localStageDataHolders.push(localStage);
            }
        }
    }

    private calcPlacementMtx(infoIter: JMapInfoIter): void {
        const pos_x = fallback(infoIter.getValueNumber('pos_x'), 0);
        const pos_y = fallback(infoIter.getValueNumber('pos_y'), 0);
        const pos_z = fallback(infoIter.getValueNumber('pos_z'), 0);
        const dir_x = fallback(infoIter.getValueNumber('dir_x'), 0) * MathConstants.DEG_TO_RAD;
        const dir_y = fallback(infoIter.getValueNumber('dir_y'), 0) * MathConstants.DEG_TO_RAD;
        const dir_z = fallback(infoIter.getValueNumber('dir_z'), 0) * MathConstants.DEG_TO_RAD;
        computeModelMatrixSRT(this.placementMtx, 1, 1, 1, dir_x, dir_y, dir_z, pos_x, pos_y, pos_z);
    }

    public findPlacedStageDataHolder(infoIter: JMapInfoIter): StageDataHolder | null {
        // The original game checks the address of the JMapInfoIter.
        // We can't easily do that here (lol), so we apply our secret trick.
        const iterExpando = infoIter as JMapInfoIter_StageDataHolder;
        return iterExpando.originalStageDataHolder;
    }
}

export abstract class SMGSceneDescBase implements Viewer.SceneDesc {
    public id: string;
    public pathBase: string;
    public gameBit: GameBits;

    constructor(public name: string, public galaxyName: string, public scenarioOverride: number | null = null, id: string | null = null) {
        if (id !== null) {
            this.id = id;
        } else {
            if (this.scenarioOverride !== null)
                this.id = `${this.galaxyName}${this.scenarioOverride}`;
            else
                this.id = this.galaxyName;
        }
    }

    public abstract getLightData(modelCache: ModelCache): JMapInfoIter;
    public abstract getZoneLightData(modelCache: ModelCache, zoneName: string): JMapInfoIter;
    public abstract getZoneMapArchive(modelCache: ModelCache, zoneName: string): RARC.JKRArchive;
    public abstract getObjNameTable(modelCache: ModelCache): JMapInfoIter;
    public abstract requestGlobalArchives(modelCache: ModelCache): void;
    public abstract requestZoneArchives(modelCache: ModelCache, zoneName: string): void;

    public placeExtra(sceneObjHolder: SceneObjHolder): void {
    }

    protected setup(context: SceneContext, renderer: SMGRenderer): void {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = await context.dataShare.ensureObject<ModelCache>(`${this.pathBase}/ModelCache`, async () => {
            return new ModelCache(device, this.pathBase, context.dataFetcher);
        });

        const renderHelper = new GXRenderHelperGfx(device, context, modelCache.cache);
        context.destroyablePool.push(renderHelper);

        const galaxyName = this.galaxyName;

        const scenarioDataFilename = `StageData/${galaxyName}/${galaxyName}Scenario.arc`;

        this.requestGlobalArchives(modelCache);
        modelCache.requestArchiveData(scenarioDataFilename);
        modelCache.requestArchiveData(`ParticleData/Effect.arc`);
        modelCache.requestArchiveData(`UsEnglish/MessageData/Message.arc`);
        modelCache.requestObjectData('PlanetMapDataTable');
        modelCache.requestObjectData('NPCData');

        const sceneObjHolder = new SceneObjHolder();
        sceneObjHolder.sceneDesc = this;
        sceneObjHolder.modelCache = modelCache;
        sceneObjHolder.uiContainer = context.uiContainer;
        sceneObjHolder.viewerInput = context.viewerInput;
        sceneObjHolder.deltaTimeFrames = sceneObjHolder.deltaTimeFrames;
        sceneObjHolder.specialTextureBinder = new SpecialTextureBinder(device, renderHelper.getCache());
        sceneObjHolder.requestArchives();
        context.destroyablePool.push(sceneObjHolder);

        await modelCache.waitForLoad();

        sceneObjHolder.scenarioData = new ScenarioData(this, modelCache.getArchive(scenarioDataFilename)!);
        for (let i = 0; i < sceneObjHolder.scenarioData.zoneNames.length; i++) {
            const zoneName = sceneObjHolder.scenarioData.zoneNames[i];
            this.requestZoneArchives(modelCache, zoneName);
        }

        if (sceneObjHolder.scenarioData.hasCometData)
            GalaxyCometScreenFilter.requestArchives(sceneObjHolder);

        await modelCache.waitForLoad();

        sceneObjHolder.planetMapCreator = new PlanetMapCreator(modelCache.getObjectData(`PlanetMapDataTable`)!);
        sceneObjHolder.npcDirector = new NPCDirector(modelCache.getObjectData(`NPCData`)!);
        const lightDataHolder = new LightDataHolder(this.getLightData(modelCache));
        sceneObjHolder.lightDirector = new LightDirector(sceneObjHolder, lightDataHolder);
        sceneObjHolder.stageDataHolder = new StageDataHolder(this, modelCache, sceneObjHolder.scenarioData, sceneObjHolder.scenarioData.getMasterZoneFilename(), 0);
        sceneObjHolder.objNameTable = this.getObjNameTable(modelCache);
        sceneObjHolder.messageHolder = new MessageHolder(sceneObjHolder);

        sceneObjHolder.create(SceneObj.EffectSystem);
        sceneObjHolder.create(SceneObj.StarPieceDirector);

        if (sceneObjHolder.scenarioData.hasCometData)
            sceneObjHolder.create(SceneObj.GalaxyCometScreenFilter);

        const spawner = new SMGSpawner(sceneObjHolder);
        sceneObjHolder.spawner = spawner;
        spawner.requestArchives();

        await modelCache.waitForLoad();

        this.placeExtra(sceneObjHolder);

        spawner.place();

        // GameScene::init()
        sceneObjHolder.starPieceDirector!.createStarPiece(sceneObjHolder);
        initSyncSleepController(sceneObjHolder);

        const renderer = new SMGRenderer(renderHelper, spawner, sceneObjHolder);
        this.setup(context, renderer);
        return renderer;
    }
}
