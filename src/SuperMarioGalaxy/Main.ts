
import { mat4, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists, align, nArray, fallback, nullify } from '../util';
import { DataFetcher, DataFetcherFlags, AbortedCallback } from '../DataFetcher';
import { MathConstants, computeModelMatrixSRT, computeNormalMatrix, clamp } from '../MathHelpers';
import { Camera, texProjCameraSceneTex } from '../Camera';
import { SceneContext } from '../SceneBase';
import * as Viewer from '../viewer';
import * as UI from '../ui';

import { TextureMapping } from '../TextureHolder';
import { GfxDevice, GfxRenderPass, GfxTexture, GfxFormat } from '../gfx/platform/GfxPlatform';
import { executeOnPass } from '../gfx/render/GfxRenderer';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor, depthClearRenderPassDescriptor, NormalizedViewportCoords } from '../gfx/helpers/RenderTargetHelpers';

import * as GX from '../gx/gx_enum';
import * as Yaz0 from '../Common/Compression/Yaz0';
import * as RARC from '../Common/JSYSTEM/JKRArchive';

import { MaterialParams, PacketParams, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { LoadedVertexData, LoadedVertexLayout, VertexAttributeInput } from '../gx/gx_displaylist';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { BMD, JSystemFileReaderHelper, ShapeDisplayFlags, TexMtxMapMode, ANK1, TTK1, TPT1, TRK1, VAF1, BCK, BTK, BPK, BTP, BRK, BVA } from '../Common/JSYSTEM/J3D/J3DLoader';
import { J3DModelData, MaterialInstance } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { JMapInfoIter, createCsvParser, getJMapInfoTransLocal, getJMapInfoRotateLocal, getJMapInfoScale } from './JMapInfo';
import { BloomPostFXParameters, BloomPostFXRenderer } from './Bloom';
import { LightDataHolder, LightDirector, LightAreaHolder } from './LightData';
import { SceneNameObjListExecutor, DrawBufferType, createFilterKeyForDrawBufferType, OpaXlu, DrawType, createFilterKeyForDrawType, NameObjHolder, NameObj } from './NameObj';
import { EffectSystem } from './EffectSystem';

import { NPCDirector, AirBubbleHolder, WaterPlantDrawInit, TrapezeRopeDrawInit, SwingRopeGroup, ElectricRailHolder, PriorDrawAirHolder, CoinRotater } from './MiscActor';
import { getNameObjFactoryTableEntry, PlanetMapCreator, NameObjFactoryTableEntry, GameBits } from './NameObjFactory';
import { setTextureMappingIndirect, ZoneAndLayer, LayerId } from './LiveActor';
import { ObjInfo, NoclipLegacyActorSpawner } from './LegacyActor';
import { BckCtrl } from './Animation';
import { WaterAreaHolder, WaterAreaMgr } from './MiscMap';
import { SensorHitChecker } from './HitSensor';
import { PlanetGravityManager } from './Gravity';
import { AreaObjMgr, AreaObj } from './AreaObj';
import { CollisionDirector } from './Collision';
import { StageSwitchContainer, SleepControllerHolder, initSyncSleepController, SwitchWatcherHolder } from './Switch';
import { MapPartsRailGuideHolder } from './MapParts';

// Galaxy ticks at 60fps.
export const FPS = 60;
const FPS_RATE = FPS/1000;

export function getDeltaTimeFramesRaw(viewerInput: Viewer.ViewerRenderInput): number {
    return viewerInput.deltaTime * FPS_RATE;
}

export function getDeltaTimeFrames(viewerInput: Viewer.ViewerRenderInput): number {
    // Clamp to reasonable values.
    return clamp(getDeltaTimeFramesRaw(viewerInput), 0.0, 1.5);
}

export function getTimeFrames(viewerInput: Viewer.ViewerRenderInput): number {
    return viewerInput.time * FPS_RATE;
}

function isExistPriorDrawAir(sceneObjHolder: SceneObjHolder): boolean {
    if (sceneObjHolder.priorDrawAirHolder !== null)
        return sceneObjHolder.priorDrawAirHolder.isExistValidDrawAir();
    else
        return false;
}

export class SMGRenderer implements Viewer.SceneGfx {
    private bloomRenderer: BloomPostFXRenderer;
    private bloomParameters = new BloomPostFXParameters();

    private mainRenderTarget = new BasicRenderTarget();
    private sceneTexture = new ColorTexture();
    private currentScenarioIndex: number = -1;
    private scenarioSelect: UI.SingleSelect;

    private scenarioNoToIndex: number[] = [];

    public onstatechanged!: () => void;

    public isInteractive = true;

    constructor(device: GfxDevice, private renderHelper: GXRenderHelperGfx, private spawner: SMGSpawner, private sceneObjHolder: SceneObjHolder) {
        this.bloomRenderer = new BloomPostFXRenderer(device, this.renderHelper.renderInstManager.gfxRenderCache, this.mainRenderTarget);

        this.applyCurrentScenario();
    }

    private applyCurrentScenario(): void {
        const scenarioData = this.sceneObjHolder.scenarioData.scenarioDataIter;
        if (this.currentScenarioIndex < 0 || this.currentScenarioIndex >= scenarioData.getNumRecords())
            this.currentScenarioIndex = 0;
        scenarioData.setRecord(this.currentScenarioIndex);

        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zoneNode = this.spawner.zones[i];
            if (zoneNode === undefined)
                continue;
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
        this.scenarioSelect.setHighlighted(strIndex);
        this.onstatechanged();
    }

    public createPanels(): UI.Panel[] {
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
            if (name === null && this.sceneObjHolder.messageDataHolder !== null)
                name = this.sceneObjHolder.messageDataHolder.getStringById(`ScenarioName_${galaxyName}${i}`);

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

        return [scenarioPanel];
    }

    private prepareBloomParameters(bloomParameters: BloomPostFXParameters): void {
        // TODO(jstpierre): Dynamically adjust based on Area.
        if (this.spawner.zones[0].name === 'PeachCastleGardenGalaxy') {
            bloomParameters.intensity1 = 40/256;
            bloomParameters.intensity2 = 60/256;
            bloomParameters.bloomIntensity = 110/256;
        } else {
            bloomParameters.intensity1 = 25/256;
            bloomParameters.intensity2 = 25/256;
            bloomParameters.bloomIntensity = 50/256;
        }
    }

    private drawAllEffects(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.sceneObjHolder.effectSystem === null)
            return;

        const effectSystem = this.sceneObjHolder.effectSystem;

        for (let drawType = DrawType.EFFECT_DRAW_3D; drawType <= DrawType.EFFECT_DRAW_AFTER_IMAGE_EFFECT; drawType++) {
            const template = this.renderHelper.renderInstManager.pushTemplateRenderInst();
            template.filterKey = createFilterKeyForDrawType(drawType);

            let texPrjMtx: mat4 | null = null;
            if (drawType === DrawType.EFFECT_DRAW_INDIRECT) {
                texPrjMtx = scratchMatrix;
                texProjCameraSceneTex(texPrjMtx, viewerInput.camera, viewerInput.viewport, 1);
            }

            effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, texPrjMtx);
            effectSystem.draw(this.sceneObjHolder.modelCache.device, this.renderHelper.renderInstManager, drawType);

            this.renderHelper.renderInstManager.popTemplateRenderInst();
        }
    }

    private drawOpa(passRenderer: GfxRenderPass, drawBufferType: DrawBufferType): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForDrawBufferType(OpaXlu.OPA, drawBufferType));
    }

    private drawXlu(passRenderer: GfxRenderPass, drawBufferType: DrawBufferType): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForDrawBufferType(OpaXlu.XLU, drawBufferType));
    }

    private execute(passRenderer: GfxRenderPass, drawType: DrawType): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForDrawType(drawType));
    }

    private isNormalBloomOn(): boolean {
        if (this.sceneObjHolder.sceneNameObjListExecutor.drawBufferHasVisible(DrawBufferType.BLOOM_MODEL))
            return true;
        return false;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        this.sceneObjHolder.viewerInput = viewerInput;

        const executor = this.sceneObjHolder.sceneNameObjListExecutor;
        const camera = viewerInput.camera;

        camera.setClipPlanes(100, 800000);

        executor.executeMovement(this.sceneObjHolder, viewerInput);
        executor.executeCalcAnim(this.sceneObjHolder, viewerInput);

        this.mainRenderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.sceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        this.sceneObjHolder.captureSceneDirector.opaqueSceneTexture = this.sceneTexture.gfxTexture!;

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);

        const effectSystem = this.sceneObjHolder.effectSystem;
        if (effectSystem !== null) {
            const deltaTime = getDeltaTimeFrames(viewerInput);
            effectSystem.calc(deltaTime);

            const indDummy = effectSystem.particleResourceHolder.getTextureMappingReference('IndDummy');
            if (indDummy !== null)
                this.sceneObjHolder.captureSceneDirector.fillTextureMappingOpaqueSceneTexture(indDummy);
        }

        // Prepare all of our NameObjs.
        executor.setIndirectTextureOverride(this.sceneTexture.gfxTexture!);
        executor.executeDrawAll(this.sceneObjHolder, this.renderHelper.renderInstManager, viewerInput);

        // Push to the renderinst.
        executor.drawAllBuffers(this.sceneObjHolder.modelCache.device, this.renderHelper.renderInstManager, camera, viewerInput.viewport);
        this.drawAllEffects(viewerInput);

        let bloomParameterBufferOffs = -1;
        if (this.isNormalBloomOn()) {
            this.prepareBloomParameters(this.bloomParameters);
            bloomParameterBufferOffs = this.bloomRenderer.allocateParameterBuffer(this.renderHelper.renderInstManager, this.bloomParameters);
        }

        // Now that we've completed our UBOs, upload.
        const hostAccessPass = device.createHostAccessPass();
        this.renderHelper.prepareToRender(device, hostAccessPass);
        device.submitPass(hostAccessPass);

        let passRenderer;

        passRenderer = this.mainRenderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);

        // GameScene::draw3D()
        // drawOpa(0);

        // SceneFunction::executeDrawBufferListNormalBeforeVolumeShadow()
        // drawOpa(0x21); drawXlu(0x21);
        // XXX(jstpierre): Crystal is here? It seems like it uses last frame's indirect texture, which makes sense...
        // but are we sure crystals draw before everything else?
        // XXX(jstpierre): This doesn't jive with the cleared depth buffer, so I'm moving it to right after we draw the prior airs...
        // are prior airs just incompatible with crystals?
        // drawOpa(0x20); drawXlu(0x20);
        // drawOpa(0x23); drawXlu(0x23);

        if (isExistPriorDrawAir(this.sceneObjHolder)) {
            this.drawOpa(passRenderer, DrawBufferType.SKY);
            this.drawOpa(passRenderer, DrawBufferType.AIR);
            this.drawOpa(passRenderer, DrawBufferType.SUN);
            this.drawXlu(passRenderer, DrawBufferType.SKY);
            this.drawXlu(passRenderer, DrawBufferType.AIR);
            this.drawXlu(passRenderer, DrawBufferType.SUN);
        }

        // if (isDrawSpinDriverPathAtOpa())
        //     execute(0x12);

        // Clear depth buffer.
        device.submitPass(passRenderer);
        passRenderer = this.mainRenderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor, this.sceneTexture.gfxTexture);

        this.drawOpa(passRenderer, DrawBufferType.CRYSTAL);
        this.drawXlu(passRenderer, DrawBufferType.CRYSTAL);

        this.drawOpa(passRenderer, DrawBufferType.PLANET);
        this.drawOpa(passRenderer, 0x05); // planet strong light?
        // execute(0x19);
        this.drawOpa(passRenderer, DrawBufferType.ENVIRONMENT);
        this.drawOpa(passRenderer, DrawBufferType.MAP_OBJ);
        this.drawOpa(passRenderer, DrawBufferType.MAP_OBJ_STRONG_LIGHT);
        this.drawOpa(passRenderer, DrawBufferType.MAP_OBJ_WEAK_LIGHT);
        this.drawOpa(passRenderer, 0x1F); // player light?

        // execute(0x27);

        // executeDrawBufferListNormalOpaBeforeSilhouette()
        this.drawOpa(passRenderer, DrawBufferType.NO_SHADOWED_MAP_OBJ);
        this.drawOpa(passRenderer, DrawBufferType.NO_SHADOWED_MAP_OBJ_STRONG_LIGHT);

        // execute(0x28);
        // executeDrawSilhouetteAndFillShadow();
        // executeDrawAlphaShadow();
        // execute(0x39);
        // setLensFlareDrawSyncToken();

        // executeDrawBufferListBeforeOpa()
        this.drawOpa(passRenderer, DrawBufferType.NO_SILHOUETTED_MAP_OBJ);
        this.drawOpa(passRenderer, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_WEAK_LIGHT);
        this.drawOpa(passRenderer, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_STRONG_LIGHT);
        this.drawOpa(passRenderer, DrawBufferType.NPC);
        this.drawOpa(passRenderer, DrawBufferType.RIDE);
        this.drawOpa(passRenderer, DrawBufferType.ENEMY);
        this.drawOpa(passRenderer, DrawBufferType.ENEMY_DECORATION);
        this.drawOpa(passRenderer, 0x15);
        if (!isExistPriorDrawAir(this.sceneObjHolder)) {
            this.drawOpa(passRenderer, DrawBufferType.SKY);
            this.drawOpa(passRenderer, DrawBufferType.AIR);
            this.drawOpa(passRenderer, DrawBufferType.SUN);
            this.drawXlu(passRenderer, DrawBufferType.SKY);
            this.drawXlu(passRenderer, DrawBufferType.AIR);
            this.drawXlu(passRenderer, DrawBufferType.SUN);
        }

        // executeDrawListOpa();
        this.execute(passRenderer, DrawType.OCEAN_RING_OUTSIDE);
        this.execute(passRenderer, DrawType.SWING_ROPE);
        this.execute(passRenderer, DrawType.TRAPEZE);
        this.execute(passRenderer, DrawType.WARP_POD_PATH);
        this.execute(passRenderer, DrawType.WATER_PLANT);
        this.execute(passRenderer, DrawType.FLAG);

        this.drawOpa(passRenderer, 0x18);

        // executeDrawBufferListNormalXlu()
        this.drawXlu(passRenderer, DrawBufferType.PLANET);
        this.drawXlu(passRenderer, 0x05);
        this.drawXlu(passRenderer, DrawBufferType.ENVIRONMENT);
        this.drawXlu(passRenderer, DrawBufferType.ENVIRONMENT_STRONG_LIGHT);
        this.drawXlu(passRenderer, DrawBufferType.MAP_OBJ);
        this.drawXlu(passRenderer, DrawBufferType.MAP_OBJ_WEAK_LIGHT);
        this.drawXlu(passRenderer, 0x1F);
        this.drawXlu(passRenderer, DrawBufferType.MAP_OBJ_STRONG_LIGHT);
        this.drawXlu(passRenderer, DrawBufferType.NO_SHADOWED_MAP_OBJ);
        this.drawXlu(passRenderer, DrawBufferType.NO_SHADOWED_MAP_OBJ_STRONG_LIGHT);
        this.drawXlu(passRenderer, DrawBufferType.NO_SILHOUETTED_MAP_OBJ);
        this.drawXlu(passRenderer, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_WEAK_LIGHT);
        this.drawXlu(passRenderer, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_STRONG_LIGHT);
        this.drawXlu(passRenderer, DrawBufferType.NPC);
        this.drawXlu(passRenderer, DrawBufferType.RIDE);
        this.drawXlu(passRenderer, DrawBufferType.ENEMY);
        this.drawXlu(passRenderer, DrawBufferType.ENEMY_DECORATION);
        this.drawXlu(passRenderer, 0x15);
        // executeDrawListXlu()
        this.drawXlu(passRenderer, 0x18);

        // execute(0x26);
        this.execute(passRenderer, DrawType.EFFECT_DRAW_3D);
        this.execute(passRenderer, DrawType.EFFECT_DRAW_FOR_BLOOM_EFFECT);
        // execute(0x2f);

        // This execute directs to CaptureScreenActor, which ends up taking the indirect screen capture.
        // So, end our pass here and do indirect.
        // execute(0x2d);
        device.submitPass(passRenderer);

        passRenderer = this.mainRenderTarget.createRenderPass(device, viewerInput.viewport, noClearRenderPassDescriptor);

        // executeDrawAfterIndirect()
        this.drawOpa(passRenderer, DrawBufferType.INDIRECT_PLANET);
        this.drawOpa(passRenderer, DrawBufferType.INDIRECT_MAP_OBJ);
        this.drawOpa(passRenderer, DrawBufferType.INDIRECT_MAP_OBJ_STRONG_LIGHT);
        this.drawOpa(passRenderer, DrawBufferType.INDIRECT_NPC);
        this.drawOpa(passRenderer, DrawBufferType.INDIRECT_ENEMY);
        this.drawOpa(passRenderer, 0x22);
        this.drawOpa(passRenderer, 0x17);
        this.drawOpa(passRenderer, 0x16);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_PLANET);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_MAP_OBJ);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_MAP_OBJ_STRONG_LIGHT);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_NPC);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_ENEMY);
        this.drawXlu(passRenderer, 0x22);
        this.drawXlu(passRenderer, 0x17);
        this.drawXlu(passRenderer, 0x16);
        this.execute(passRenderer, DrawType.ELECTRIC_RAIL_HOLDER);
        this.execute(passRenderer, DrawType.OCEAN_RING);
        this.execute(passRenderer, DrawType.OCEAN_BOWL);
        this.execute(passRenderer, DrawType.EFFECT_DRAW_INDIRECT);
        this.execute(passRenderer, DrawType.EFFECT_DRAW_AFTER_INDIRECT);

        // executeDrawImageEffect()
        if (this.isNormalBloomOn() && this.bloomRenderer.pipelinesReady(device)) {
            device.submitPass(passRenderer);

            const objPassRenderer = this.bloomRenderer.renderBeginObjects(device, viewerInput);
            this.drawOpa(objPassRenderer, DrawBufferType.BLOOM_MODEL);
            this.drawXlu(objPassRenderer, DrawBufferType.BLOOM_MODEL);
            this.execute(objPassRenderer, DrawType.EFFECT_DRAW_FOR_BLOOM_EFFECT);
            passRenderer = this.bloomRenderer.renderEndObjects(device, objPassRenderer, this.renderHelper.renderInstManager, this.mainRenderTarget, viewerInput, template, bloomParameterBufferOffs);
        }

        this.execute(passRenderer, DrawType.EFFECT_DRAW_AFTER_IMAGE_EFFECT);
        this.execute(passRenderer, DrawType.GRAVITY_EXPLAINER);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.renderInstManager.resetRenderInsts();
        return passRenderer;
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
        this.mainRenderTarget.destroy(device);
        this.sceneTexture.destroy(device);
        this.bloomRenderer.destroy(device);
    }
}

function getLayerDirName(index: LayerId) {
    if (index === LayerId.COMMON) {
        return 'common';
    } else {
        assert(index >= 0);
        const char = String.fromCharCode('a'.charCodeAt(0) + index);
        return `layer${char}`;
    }
}

function patchInTexMtxIdxBuffer(loadedVertexLayout: LoadedVertexLayout, loadedVertexData: LoadedVertexData, bufferStride: number, texMtxIdxBaseOffsets: number[]): void {
    const vertexCount = loadedVertexData.totalVertexCount;

    const buffer = new Uint8Array(vertexCount * bufferStride);
    loadedVertexLayout.vertexBufferStrides[1] = bufferStride;
    loadedVertexData.vertexBuffers[1] = buffer.buffer;

    const view = new DataView(loadedVertexData.vertexBuffers[0]);
    const loadedStride = loadedVertexLayout.vertexBufferStrides[0];
    let offs = loadedVertexLayout.vertexAttributeOffsets[GX.Attr.PNMTXIDX];

    for (let i = 0; i < vertexCount; i++) {
        const p = view.getFloat32(offs, true);
        for (let j = 0; j < bufferStride; j++) {
            if (texMtxIdxBaseOffsets[j] >= 0)
                buffer[i*bufferStride + j] = p + texMtxIdxBaseOffsets[j];
        }
        offs += loadedStride;
    }
}

function mtxModeIsUsingEnvMap(mode: TexMtxMapMode): boolean {
    return (mode === TexMtxMapMode.EnvmapBasic || mode === TexMtxMapMode.EnvmapOld || mode === TexMtxMapMode.Envmap);
}

function mtxModeIsUsingProjMap(mode: TexMtxMapMode): boolean {
    return (mode === TexMtxMapMode.ProjmapBasic || mode === TexMtxMapMode.ViewProjmapBasic || mode === TexMtxMapMode.Projmap || mode === TexMtxMapMode.ViewProjmap);
}

function patchBMD(bmd: BMD): void {
    for (let i = 0; i < bmd.shp1.shapes.length; i++) {
        const shape = bmd.shp1.shapes[i];
        if (shape.displayFlags !== ShapeDisplayFlags.USE_PNMTXIDX)
            continue;

        const material = bmd.mat3.materialEntries[shape.materialIndex];
        material.gxMaterial.useTexMtxIdx = nArray(8, () => false);

        let bufferStride = 0;
        let texMtxIdxBaseOffsets: number[] = nArray(8, () => -1);
        let hasAnyEnvMap = false;
        for (let j = 0; j < material.gxMaterial.texGens.length; j++) {
            const texGen = material.gxMaterial.texGens[j];
            if (texGen === null)
                continue;
            if (texGen.matrix === GX.TexGenMatrix.IDENTITY)
                continue;

            const texMtxIdx = (texGen.matrix - GX.TexGenMatrix.TEXMTX0) / 3;
            const texMtx = assertExists(material.texMatrices[texMtxIdx]);

            const matrixMode: TexMtxMapMode = texMtx.info & 0x3F;
            const isUsingEnvMap = mtxModeIsUsingEnvMap(matrixMode);
            const isUsingProjMap = mtxModeIsUsingProjMap(matrixMode);

            if (isUsingEnvMap || isUsingProjMap) {
                // Mark as requiring TexMtxIdx
                material.gxMaterial.useTexMtxIdx[j] = true;
                texGen.postMatrix = GX.PostTexGenMatrix.PTTEXMTX0 + (j * 3);

                if (isUsingEnvMap)
                    texMtxIdxBaseOffsets[j] = GX.TexGenMatrix.TEXMTX0;
                else if (isUsingProjMap)
                    texMtxIdxBaseOffsets[j] = GX.TexGenMatrix.PNMTX0;

                bufferStride = Math.max(bufferStride, j + 1);
                hasAnyEnvMap = hasAnyEnvMap || isUsingEnvMap;

                // Disable optimizations
                material.gxMaterial.hasPostTexMtxBlock = true;
            }
        }

        // If we have an environment map, then all texture matrices are IDENTITY,
        // as we're going to reuse the texture memory for normal environment matrices.
        // Done in ShapeUserPacketData::init() with the GDSetCurrentMtx().
        if (hasAnyEnvMap) {
            for (let j = 0; j < material.gxMaterial.texGens.length; j++)
                material.gxMaterial.texGens[j].matrix = GX.TexGenMatrix.IDENTITY;
        }

        if (bufferStride > 0) {
            bufferStride = align(bufferStride, 4);

            for (let j = 0; j < shape.mtxGroups.length; j++) {
                const mtxGroup = shape.mtxGroups[j];
                patchInTexMtxIdxBuffer(shape.loadedVertexLayout, mtxGroup.loadedVertexData, bufferStride, texMtxIdxBaseOffsets);
            }

            if (texMtxIdxBaseOffsets[0] >= 0 || texMtxIdxBaseOffsets[1] >= 0 || texMtxIdxBaseOffsets[2] >= 0 || texMtxIdxBaseOffsets[3] >= 0)
                shape.loadedVertexLayout.singleVertexInputLayouts.push({ attrInput: VertexAttributeInput.TEX0123MTXIDX, format: GfxFormat.U8_RGBA_NORM, bufferIndex: 1, bufferOffset: 0 });
            if (texMtxIdxBaseOffsets[4] >= 0 || texMtxIdxBaseOffsets[5] >= 0 || texMtxIdxBaseOffsets[6] >= 0 || texMtxIdxBaseOffsets[7] >= 0)
                shape.loadedVertexLayout.singleVertexInputLayouts.push({ attrInput: VertexAttributeInput.TEX4567MTXIDX, format: GfxFormat.U8_RGBA_NORM, bufferIndex: 1, bufferOffset: 4 });
        }
    }
}

const scratchMatrix = mat4.create();

// This is roughly ShapePacketUserData::callDL().
function fillMaterialParamsCallback(materialParams: MaterialParams, materialInstance: MaterialInstance, viewMatrix: mat4, modelMatrix: mat4, camera: Camera, viewport: NormalizedViewportCoords, packetParams: PacketParams): void {
    const material = materialInstance.materialData.material;
    let hasAnyEnvMap = false;

    for (let i = 0; i < material.texMatrices.length; i++) {
        const texMtx = material.texMatrices[i];
        if (texMtx === null)
            continue;

        const matrixMode = texMtx.info & 0x3F;
        const isUsingEnvMap = (matrixMode === 0x01 || matrixMode === 0x06 || matrixMode === 0x07);

        if (isUsingEnvMap)
            hasAnyEnvMap = true;

        const dst = materialParams.u_PostTexMtx[i];
        const flipY = materialParams.m_TextureMapping[i].flipY;

        materialInstance.calcPostTexMtxInput(dst, texMtx, viewMatrix);
        const texSRT = scratchMatrix;
        materialInstance.calcTexSRT(texSRT, i);
        materialInstance.calcTexMtx(dst, texMtx, texSRT, modelMatrix, camera, viewport, flipY);
    }

    if (hasAnyEnvMap) {
        // Fill texture memory with normal matrices.
        for (let i = 0; i < 10; i++) {
            const m = materialParams.u_TexMtx[i];
            computeNormalMatrix(m, packetParams.u_PosMtx[i], true);
        }
    }
}

function patchBMDModel(bmdModel: J3DModelData): void {
    // Kill off the sort-key bias; the game doesn't use the typical J3D rendering algorithm in favor
    // of its own sort, which needs to be RE'd.
    for (let i = 0; i < bmdModel.shapeData.length; i++)
        bmdModel.shapeData[i].sortKeyBias = 0;

    const modelMaterialData = bmdModel.modelMaterialData.materialData!;
    for (let i = 0; i < modelMaterialData.length; i++) {
        const materialData = modelMaterialData[i];

        const gxMaterial = materialData.material.gxMaterial;
        if (gxMaterial.useTexMtxIdx !== undefined && gxMaterial.useTexMtxIdx.some((v) => v)) {
            // Requires a callback.
            materialData.fillMaterialParamsCallback = fillMaterialParamsCallback;
        }
    }
}

export type ResTable<T> = Map<string, T>;

export class ResourceHolder {
    public modelTable = new Map<string, J3DModelData>();
    public motionTable = new Map<string, ANK1>();
    public btkTable = new Map<string, TTK1>();
    public bpkTable = new Map<string, TRK1>();
    public btpTable = new Map<string, TPT1>();
    public brkTable = new Map<string, TRK1>();
    public bvaTable = new Map<string, VAF1>();
    public banmtTable = new Map<string, BckCtrl>();

    constructor(device: GfxDevice, cache: GfxRenderCache, public arc: RARC.JKRArchive) {
        this.initEachResTable(this.modelTable, ['.bdl', '.bmd'], (ext, file) => {
            const bmd = BMD.parse(file.buffer);
            patchBMD(bmd);
            const bmdModel = new J3DModelData(device, cache, bmd);
            patchBMDModel(bmdModel);
            return bmdModel;
        });

        this.initEachResTable(this.motionTable, ['.bck', '.bca'], (ext, file) => {
            if (ext === '.bca')
                debugger;

            return BCK.parse(file.buffer);
        });

        // .blk
        this.initEachResTable(this.btkTable, ['.btk'], (ext, file) => BTK.parse(file.buffer));
        this.initEachResTable(this.bpkTable, ['.bpk'], (ext, file) => BPK.parse(file.buffer));
        this.initEachResTable(this.btpTable, ['.btp'], (ext, file) => BTP.parse(file.buffer));
        this.initEachResTable(this.brkTable, ['.brk'], (ext, file) => BRK.parse(file.buffer));
        // .bas
        // .bmt
        this.initEachResTable(this.bvaTable, ['.bva'], (ext, file) => BVA.parse(file.buffer));
        this.initEachResTable(this.banmtTable, ['.banmt'], (ext, file) => BckCtrl.parse(file.buffer));
    }

    public getModel(name: string): J3DModelData {
        return assertExists(this.modelTable.get(name.toLowerCase()));
    }

    public getRes<T>(table: ResTable<T>, name: string): T | null {
        return nullify(table.get(name.toLowerCase()));
    }

    private initEachResTable<T>(table: ResTable<T>, extensions: string[], constructor: (ext: string, file: RARC.RARCFile) => T): void {
        for (let i = 0; i < this.arc.files.length; i++) {
            const file = this.arc.files[i];

            for (let j = 0; j < extensions.length; j++) {
                const ext = extensions[j];
                if (file.name.endsWith(ext)) {
                    const filenameWithoutExtension = file.name.slice(0, -ext.length).toLowerCase();
                    table.set(filenameWithoutExtension, constructor(ext, file));
                }
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (const [, v] of this.modelTable)
            v.destroy(device);
    }
}

export class ModelCache {
    public archivePromiseCache = new Map<string, Promise<RARC.JKRArchive | null>>();
    public archiveCache = new Map<string, RARC.JKRArchive | null>();
    public archiveResourceHolder = new Map<string, ResourceHolder>();
    public cache = new GfxRenderCache();

    constructor(public device: GfxDevice, private pathBase: string, private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<void> {
        const v: Promise<any>[] = [... this.archivePromiseCache.values()];
        return Promise.all(v) as Promise<any>;
    }

    private async requestArchiveDataInternal(archivePath: string, abortedCallback: AbortedCallback): Promise<RARC.JKRArchive | null> {
        const buffer = await this.dataFetcher.fetchData(`${this.pathBase}/${archivePath}`, DataFetcherFlags.ALLOW_404, abortedCallback);

        if (buffer.byteLength === 0) {
            console.warn(`Could not fetch archive ${archivePath}`);
            return null;
        }

        const decompressed = await Yaz0.decompress(buffer);
        const rarc = RARC.parse(decompressed);
        this.archiveCache.set(archivePath, rarc);
        return rarc;
    }

    public async requestArchiveData(archivePath: string): Promise<RARC.JKRArchive | null> {
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

    public isObjectDataExist(objectName: string): boolean {
        return this.isArchiveExist(`ObjectData/${objectName}.arc`);
    }

    public getResourceHolder(objectName: string): ResourceHolder {
        if (this.archiveResourceHolder.has(objectName))
            return this.archiveResourceHolder.get(objectName)!;

        const arc = this.getObjectData(objectName);
        const resourceHolder = new ResourceHolder(this.device, this.cache, arc);
        this.archiveResourceHolder.set(objectName, resourceHolder);
        return resourceHolder;
    }

    public getObjectData(objectName: string): RARC.JKRArchive {
        return assertExists(this.getArchive(`ObjectData/${objectName}.arc`));
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy(device);
        for (const resourceHolder of this.archiveResourceHolder.values())
            resourceHolder.destroy(device);
    }
}

class ScenarioData {
    public zoneNames: string[];
    public scenarioDataIter: JMapInfoIter;

    constructor(private scenarioArc: RARC.JKRArchive) {
        const zoneListIter = createCsvParser(scenarioArc.findFileData('ZoneList.bcsv')!);
        this.zoneNames = zoneListIter.mapRecords((iter) => {
            return assertExists(iter.getValueString(`ZoneName`));
        });

        this.scenarioDataIter = createCsvParser(scenarioArc.findFileData('ScenarioData.bcsv')!);
    }

    public getMasterZoneFilename(): string {
        // Master zone name is always the first record...
        return this.zoneNames[0];
    }
}

class CaptureSceneDirector {
    public opaqueSceneTexture: GfxTexture;

    public fillTextureMappingOpaqueSceneTexture(m: TextureMapping): void {
        setTextureMappingIndirect(m, this.opaqueSceneTexture);
    }
}

class AreaObjContainer extends NameObj {
    private managers: AreaObjMgr<AreaObj>[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'AreaObjContainer');
        this.managers.push(new LightAreaHolder(sceneObjHolder));
        this.managers.push(new WaterAreaMgr(sceneObjHolder));
    }

    public getManager(managerName: string): AreaObjMgr<AreaObj> {
        for (let i = 0; i < this.managers.length; i++)
            if (this.managers[i].name === managerName)
                return this.managers[i];
        throw "whoops";
    }

    public getAreaObj<T extends AreaObj>(managerName: string, position: vec3): T | null {
        const mgr = this.getManager(managerName);
        return mgr.find_in(position) as (T | null);
    }
}

export const enum SceneObj {
    SensorHitChecker        = 0x00,
    CollisionDirector       = 0x01,
    LightDirector           = 0x06,
    StageSwitchContainer    = 0x0A,
    SwitchWatcherHolder     = 0x0B,
    SleepControllerHolder   = 0x0C,
    AreaObjContainer        = 0x0D,
    PlanetGravityManager    = 0x32,
    CoinRotater             = 0x38,
    AirBubbleHolder         = 0x39,
    SwingRopeGroup          = 0x47,
    TrapezeRopeDrawInit     = 0x4A,
    MapPartsRailGuideHolder = 0x56,
    ElectricRailHolder      = 0x59,
    WaterAreaHolder         = 0x62,
    WaterPlantDrawInit      = 0x63,
    PriorDrawAirHolder      = 0x75,
}

export class SceneObjHolder {
    public sceneDesc: SMGSceneDescBase;
    public modelCache: ModelCache;
    public spawner: SMGSpawner;

    public scenarioData: ScenarioData;
    public planetMapCreator: PlanetMapCreator;
    public lightDirector: LightDirector;
    public npcDirector: NPCDirector;
    public stageDataHolder: StageDataHolder;
    public effectSystem: EffectSystem | null = null;
    public messageDataHolder: MessageDataHolder | null = null;

    public sensorHitChecker: SensorHitChecker | null = null;
    public collisionDirector: CollisionDirector | null = null;
    public stageSwitchContainer: StageSwitchContainer | null = null;
    public switchWatcherHolder: SwitchWatcherHolder | null = null;
    public sleepControllerHolder: SleepControllerHolder | null = null;
    public areaObjContainer: AreaObjContainer | null = null;
    public planetGravityManager: PlanetGravityManager | null = null;
    public coinRotater: CoinRotater | null = null;
    public airBubbleHolder: AirBubbleHolder | null = null;
    public swingRopeGroup: SwingRopeGroup | null = null;
    public trapezeRopeDrawInit: TrapezeRopeDrawInit | null = null;
    public mapPartsRailGuideHolder: MapPartsRailGuideHolder | null = null;
    public waterAreaHolder: WaterAreaHolder | null = null;
    public waterPlantDrawInit: WaterPlantDrawInit | null = null;
    public electricRailHolder: ElectricRailHolder | null = null;
    public priorDrawAirHolder: PriorDrawAirHolder | null = null;

    public captureSceneDirector = new CaptureSceneDirector();

    // This is technically stored outside the SceneObjHolder, separately
    // on the same singleton, but c'est la vie...
    public sceneNameObjListExecutor = new SceneNameObjListExecutor();
    public nameObjHolder = new NameObjHolder();

    public viewerInput: Viewer.ViewerRenderInput;

    public create(sceneObj: SceneObj): void {
        if (this.getObj(sceneObj) === null)
            this.newEachObj(sceneObj);
    }

    public getObj(sceneObj: SceneObj): NameObj | null {
        if (sceneObj === SceneObj.SensorHitChecker)
            return this.sensorHitChecker;
        else if (sceneObj === SceneObj.CollisionDirector)
            return this.collisionDirector;
        else if (sceneObj === SceneObj.StageSwitchContainer)
            return this.stageSwitchContainer;
        else if (sceneObj === SceneObj.SwitchWatcherHolder)
            return this.switchWatcherHolder;
        else if (sceneObj === SceneObj.SleepControllerHolder)
            return this.sleepControllerHolder;
        else if (sceneObj === SceneObj.AreaObjContainer)
            return this.areaObjContainer;
        else if (sceneObj === SceneObj.PlanetGravityManager)
            return this.planetGravityManager;
        else if (sceneObj === SceneObj.CoinRotater)
            return this.coinRotater;
        else if (sceneObj === SceneObj.AirBubbleHolder)
            return this.airBubbleHolder;
        else if (sceneObj === SceneObj.SwingRopeGroup)
            return this.swingRopeGroup;
        else if (sceneObj === SceneObj.TrapezeRopeDrawInit)
            return this.trapezeRopeDrawInit;
        else if (sceneObj === SceneObj.MapPartsRailGuideHolder)
            return this.mapPartsRailGuideHolder;
        else if (sceneObj === SceneObj.WaterAreaHolder)
            return this.waterAreaHolder;
        else if (sceneObj === SceneObj.WaterPlantDrawInit)
            return this.waterPlantDrawInit;
        else if (sceneObj === SceneObj.ElectricRailHolder)
            return this.electricRailHolder;
        else if (sceneObj === SceneObj.PriorDrawAirHolder)
            return this.priorDrawAirHolder;
        return null;
    }

    private newEachObj(sceneObj: SceneObj): void {
        if (sceneObj === SceneObj.SensorHitChecker)
            this.sensorHitChecker = new SensorHitChecker(this);
        else if (sceneObj === SceneObj.CollisionDirector)
            this.collisionDirector = new CollisionDirector(this);
        else if (sceneObj === SceneObj.StageSwitchContainer)
            this.stageSwitchContainer = new StageSwitchContainer(this);
        else if (sceneObj === SceneObj.SwitchWatcherHolder)
            this.switchWatcherHolder = new SwitchWatcherHolder(this);
        else if (sceneObj === SceneObj.SleepControllerHolder)
            this.sleepControllerHolder = new SleepControllerHolder(this);
        else if (sceneObj === SceneObj.AreaObjContainer)
            this.areaObjContainer = new AreaObjContainer(this);
        else if (sceneObj === SceneObj.PlanetGravityManager)
            this.planetGravityManager = new PlanetGravityManager(this);
        else if (sceneObj === SceneObj.CoinRotater)
            this.coinRotater = new CoinRotater(this);
        else if (sceneObj === SceneObj.AirBubbleHolder)
            this.airBubbleHolder = new AirBubbleHolder(this);
        else if (sceneObj === SceneObj.SwingRopeGroup)
            this.swingRopeGroup = new SwingRopeGroup(this);
        else if (sceneObj === SceneObj.TrapezeRopeDrawInit)
            this.trapezeRopeDrawInit = new TrapezeRopeDrawInit(this);
        else if (sceneObj === SceneObj.MapPartsRailGuideHolder)
            this.mapPartsRailGuideHolder = new MapPartsRailGuideHolder(this);
        else if (sceneObj === SceneObj.WaterAreaHolder)
            this.waterAreaHolder = new WaterAreaHolder(this);
        else if (sceneObj === SceneObj.WaterPlantDrawInit)
            this.waterPlantDrawInit = new WaterPlantDrawInit(this);
        else if (sceneObj === SceneObj.ElectricRailHolder)
            this.electricRailHolder = new ElectricRailHolder(this);
        else if (sceneObj === SceneObj.PriorDrawAirHolder)
            this.priorDrawAirHolder = new PriorDrawAirHolder(this);
    }

    public destroy(device: GfxDevice): void {
        this.nameObjHolder.destroy(device);

        if (this.effectSystem !== null)
            this.effectSystem.destroy(device);
    }
}

export function createSceneObj(sceneObjHolder: SceneObjHolder, sceneObj: SceneObj): void {
    sceneObjHolder.create(sceneObj);
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
    private gameBit: GameBits;

    constructor(private sceneObjHolder: SceneObjHolder) {
        this.legacySpawner = new NoclipLegacyActorSpawner(this.sceneObjHolder);

        if (this.sceneObjHolder.sceneDesc.pathBase === 'SuperMarioGalaxy')
            this.gameBit = GameBits.SMG1;
        else if (this.sceneObjHolder.sceneDesc.pathBase === 'SuperMarioGalaxy2')
            this.gameBit = GameBits.SMG2;
        else
            throw "whoops";
    }

    private getActorTableEntry(objName: string): NameObjFactoryTableEntry | null {
        const actorTableEntry = getNameObjFactoryTableEntry(objName, this.gameBit);
        if (actorTableEntry !== null)
            return actorTableEntry;

        const planetTableEntry = this.sceneObjHolder.planetMapCreator.getActorTableEntry(objName, this.gameBit);
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
        stageDataHolder.iterPlacement((infoIter, layerId) => {
            const actorTableEntry = this.getActorTableEntry(getObjectName(infoIter));

            const zoneAndLayer: ZoneAndLayer = { zoneId: stageDataHolder.zoneId, layerId };
            if (actorTableEntry !== null) {
                // Explicitly null, don't spawn anything.
                if (actorTableEntry.factoryFunc === null)
                    return;

                actorTableEntry.factoryFunc(zoneAndLayer, this.sceneObjHolder, infoIter);
            } else {
                // Spawn legacy.
                const objInfoLegacy = stageDataHolder.legacyCreateObjinfo(infoIter);
                const infoIterCopy = copyInfoIter(infoIter);
                this.legacySpawner.spawnObjectLegacy(zoneAndLayer, infoIterCopy, objInfoLegacy);
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

        // const grav = new GravityExplainer(dynamicSpawnZoneAndLayer, this.sceneObjHolder);
        // console.log(grav);

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

interface JMapInfoIter_StageDataHolder extends JMapInfoIter {
    originalStageDataHolder: StageDataHolder;
}

function copyInfoIter(infoIter: JMapInfoIter): JMapInfoIter {
    const iter = new JMapInfoIter(infoIter.bcsv, infoIter.record);
    (iter as JMapInfoIter_StageDataHolder).originalStageDataHolder = (infoIter as JMapInfoIter_StageDataHolder).originalStageDataHolder;
    return iter;
}

type LayerObjInfoCallback = (infoIter: JMapInfoIter, layerId: LayerId) => void;

class StageDataHolder {
    private zoneArchive: RARC.JKRArchive;
    public localStageDataHolders: StageDataHolder[] = [];
    public placementMtx = mat4.create();

    constructor(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, scenarioData: ScenarioData, public zoneName: string, public zoneId: number, public layerId: LayerId = -1) {
        this.zoneArchive = sceneDesc.getZoneMapArchive(modelCache, zoneName);
        this.createLocalStageDataHolders(sceneDesc, modelCache, scenarioData);
    }

    private createCsvParser(buffer: ArrayBufferSlice): JMapInfoIter {
        const iter = createCsvParser(buffer);
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

    public legacyCreateObjinfo(infoIter: JMapInfoIter): ObjInfo {
        const objId = fallback(infoIter.getValueNumberNoInit('l_id'), -1);
        const objName = fallback(infoIter.getValueString('name'), 'Unknown');
        const objArg0 = fallback(infoIter.getValueNumberNoInit('Obj_arg0'), -1);
        const modelMatrix = mat4.create();

        const translation = vec3.create(), rotation = vec3.create(), scale = vec3.create();
        getJMapInfoScale(scale, infoIter);
        getJMapInfoRotateLocal(rotation, infoIter);
        getJMapInfoTransLocal(translation, infoIter);
        computeModelMatrixSRT(modelMatrix,
            scale[0], scale[1], scale[2],
            rotation[0], rotation[1], rotation[2],
            translation[0], translation[1], translation[2]);

        return { objId, objName, objArg0, modelMatrix };
    }

    private iterLayer(layerId: LayerId, callback: LayerObjInfoCallback, buffer: ArrayBufferSlice): void {
        const iter = this.createCsvParser(buffer);

        for (let i = 0; i < iter.getNumRecords(); i++) {
            iter.setRecord(i);
            callback(iter, layerId);
        }
    }

    private isPrioPlacementObjInfo(filename: string): boolean {
        return (filename === 'areaobjinfo' || filename === 'planetobjinfo' || filename === 'demoobjinfo' || filename === 'cameracubeinfo');
    }

    private iterPlacementDir(priority: boolean | null, layerId: LayerId, callback: LayerObjInfoCallback, dir: RARC.RARCDir): void {
        for (let i = 0; i < dir.files.length; i++) {
            const file = dir.files[i];

            const filename = file.name.toLowerCase();

            // The game skips any actors it doesn't recognize, and includes the sub-zones in the list.
            // We can't easily do that because we have legacy actors, so just skip StageObjInfo for now...
            if (filename === 'stageobjinfo')
                continue;

            if (priority !== null && (this.isPrioPlacementObjInfo(filename) !== priority))
                continue;

            this.iterLayer(layerId, callback, file.buffer);
        }
    }

    public iterPlacement(callback: LayerObjInfoCallback, priority: boolean | null = null): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);

            const placementDir = this.zoneArchive.findDir(`jmp/Placement/${layerDirName}`);
            if (placementDir !== null)
                this.iterPlacementDir(priority, i, callback, placementDir);

            const mapPartsDir = this.zoneArchive.findDir(`jmp/MapParts/${layerDirName}`);
            if (mapPartsDir !== null)
                this.iterPlacementDir(priority, i, callback, mapPartsDir);
        }
    }

    public createLocalStageDataHolders(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, scenarioData: ScenarioData): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
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

class BMG {
    private inf1: ArrayBufferSlice;
    private dat1: ArrayBufferSlice;
    private numStrings: number;
    private inf1ItemSize: number;

    constructor(private mesgData: ArrayBufferSlice) {
        const readerHelper = new JSystemFileReaderHelper(this.mesgData);
        assert(readerHelper.magic === 'MESGbmg1');

        this.inf1 = readerHelper.nextChunk('INF1');
        this.dat1 = readerHelper.nextChunk('DAT1');

        const view = this.inf1.createDataView();
        this.numStrings = view.getUint16(0x08);
        this.inf1ItemSize = view.getUint16(0x0A);
    }

    public getStringByIndex(i: number): string {
        const inf1View = this.inf1.createDataView();
        const dat1Offs = 0x08 + inf1View.getUint32(0x10 + (i * this.inf1ItemSize) + 0x00);

        const view = this.dat1.createDataView();
        let idx = dat1Offs;
        let S = '';
        while (true) {
            const c = view.getUint16(idx + 0x00);
            if (c === 0)
                break;
            if (c === 0x001A) {
                // Escape sequence.
                const size = view.getUint8(idx + 0x02);
                const escapeKind = view.getUint8(idx + 0x03);

                if (escapeKind === 0x05) {
                    // Current character name -- 'Mario' or 'Luigi'. We use 'Mario'
                    S += "Mario";
                } else {
                    console.warn(`Unknown escape kind ${escapeKind}`);
                }

                idx += size;
            } else {
                S += String.fromCharCode(c);
                idx += 0x02;
            }
        }

        return S;
    }
}

class MessageDataHolder {
    private mesg: BMG;
    private messageIds: string[];

    constructor(messageArc: RARC.JKRArchive) {
        const messageIds = createCsvParser(messageArc.findFileData(`MessageId.tbl`)!);
        this.messageIds = messageIds.mapRecords((iter) => {
            return assertExists(iter.getValueString('MessageId'));
        });

        this.mesg = new BMG(messageArc.findFileData(`Message.bmg`)!);
    }

    public getStringById(id: string): string | null {
        const index = this.messageIds.indexOf(id);
        if (index < 0)
            return null;
        return this.mesg.getStringByIndex(index);
    }
}

export abstract class SMGSceneDescBase implements Viewer.SceneDesc {
    public pathBase: string;

    constructor(public name: string, public galaxyName: string, public id: string = galaxyName) {
    }

    public abstract getLightData(modelCache: ModelCache): JMapInfoIter;
    public abstract getZoneLightData(modelCache: ModelCache, zoneName: string): JMapInfoIter;
    public abstract getZoneMapArchive(modelCache: ModelCache, zoneName: string): RARC.JKRArchive;
    public abstract requestGlobalArchives(modelCache: ModelCache): void;
    public abstract requestZoneArchives(modelCache: ModelCache, zoneName: string): void;

    public placeExtra(sceneObjHolder: SceneObjHolder): void {
    }

    public patchRenderer(renderer: SMGRenderer): void {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = await context.dataShare.ensureObject<ModelCache>(`${this.pathBase}/ModelCache`, async () => {
            return new ModelCache(device, this.pathBase, context.dataFetcher);
        });

        const renderHelper = new GXRenderHelperGfx(device);
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
        context.destroyablePool.push(sceneObjHolder);

        await modelCache.waitForLoad();

        const scenarioData = new ScenarioData(modelCache.getArchive(scenarioDataFilename)!);

        for (let i = 0; i < scenarioData.zoneNames.length; i++) {
            const zoneName = scenarioData.zoneNames[i];
            this.requestZoneArchives(modelCache, zoneName);
        }

        sceneObjHolder.scenarioData = scenarioData;

        await modelCache.waitForLoad();

        sceneObjHolder.planetMapCreator = new PlanetMapCreator(modelCache.getObjectData(`PlanetMapDataTable`)!);
        sceneObjHolder.npcDirector = new NPCDirector(modelCache.getObjectData(`NPCData`)!);
        const lightDataHolder = new LightDataHolder(this.getLightData(modelCache));
        sceneObjHolder.lightDirector = new LightDirector(sceneObjHolder, lightDataHolder);
        sceneObjHolder.stageDataHolder = new StageDataHolder(this, modelCache, sceneObjHolder.scenarioData, sceneObjHolder.scenarioData.getMasterZoneFilename(), 0);

        if (modelCache.isArchiveExist(`ParticleData/Effect.arc`))
            sceneObjHolder.effectSystem = new EffectSystem(device, modelCache.getArchive(`ParticleData/Effect.arc`)!);

        if (modelCache.isArchiveExist(`UsEnglish/MessageData/Message.arc`))
            sceneObjHolder.messageDataHolder = new MessageDataHolder(modelCache.getArchive(`UsEnglish/MessageData/Message.arc`)!);

        const spawner = new SMGSpawner(sceneObjHolder);
        sceneObjHolder.spawner = spawner;
        spawner.requestArchives();

        await modelCache.waitForLoad();

        this.placeExtra(sceneObjHolder);

        spawner.place();

        // GameScene::init()
        initSyncSleepController(sceneObjHolder);

        const renderer = new SMGRenderer(device, renderHelper, spawner, sceneObjHolder);
        this.patchRenderer(renderer);
        return renderer;
    }
}
