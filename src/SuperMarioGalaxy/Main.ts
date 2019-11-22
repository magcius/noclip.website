
import { mat4, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists, align, nArray, fallback, nullify } from '../util';
import { DataFetcher, DataFetcherFlags, AbortedCallback } from '../DataFetcher';
import { MathConstants, computeModelMatrixSRT, computeNormalMatrix } from '../MathHelpers';
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
import * as BCSV from '../luigis_mansion/bcsv';
import * as RARC from '../j3d/rarc';

import { MaterialParams, PacketParams, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { LoadedVertexData, LoadedVertexLayout } from '../gx/gx_displaylist';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { BMD, JSystemFileReaderHelper, ShapeDisplayFlags, TexMtxMapMode, ANK1, TTK1, TPT1, TRK1, VAF1, BCK, BTK, BPK, BTP, BRK, BVA } from '../Common/JSYSTEM/J3D/J3DLoader';
import { J3DModelData, MaterialInstance } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { JMapInfoIter, createCsvParser, getJMapInfoTransLocal, getJMapInfoRotateLocal, getJMapInfoScale } from './JMapInfo';
import { BloomPostFXParameters, BloomPostFXRenderer } from './Bloom';
import { LightDataHolder, LightDirector } from './LightData';
import { SceneNameObjListExecutor, DrawBufferType, createFilterKeyForDrawBufferType, OpaXlu, DrawType, createFilterKeyForDrawType, NameObjHolder } from './NameObj';
import { EffectSystem } from './EffectSystem';

import { NPCDirector, AirBubbleHolder } from './Actors';
import { getNameObjFactoryTableEntry, PlanetMapCreator, NameObjFactoryTableEntry } from './NameObjFactory';
import { setTextureMappingIndirect, ZoneAndLayer, LayerId } from './LiveActor';
import { ObjInfo, NoclipLegacyActorSpawner, Path } from './LegacyActor';
import { BckCtrl } from './Animation';

// Galaxy ticks at 60fps.
export const FPS = 60;
const FPS_RATE = FPS/1000;

export function getDeltaTimeFrames(viewerInput: Viewer.ViewerRenderInput): number {
    return viewerInput.deltaTime * FPS_RATE;
}

export function getTimeFrames(viewerInput: Viewer.ViewerRenderInput): number {
    return viewerInput.time * FPS_RATE;
}

class SMGRenderer implements Viewer.SceneGfx {
    private bloomRenderer: BloomPostFXRenderer;
    private bloomParameters = new BloomPostFXParameters();

    private mainRenderTarget = new BasicRenderTarget();
    private sceneTexture = new ColorTexture();
    private currentScenarioIndex: number = -1;
    private scenarioSelect: UI.SingleSelect;

    private scenarioNoToIndex: number[] = [];

    public onstatechanged!: () => void;

    constructor(device: GfxDevice, private renderHelper: GXRenderHelperGfx, private spawner: SMGSpawner, private sceneObjHolder: SceneObjHolder) {
        this.bloomRenderer = new BloomPostFXRenderer(device, this.renderHelper.renderInstManager.gfxRenderCache, this.mainRenderTarget);
    }

    private applyCurrentScenario(): void {
        const scenarioData = this.sceneObjHolder.scenarioData.scenarioDataIter;
        if (this.currentScenarioIndex >= scenarioData.getNumRecords())
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

            if (name === null)
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

    private findBloomArea(): ObjInfo | null {
        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zone = this.spawner.zones[i];
            if (zone === undefined)
                continue;

            for (let j = 0; j < zone.areaObjInfo.length; j++) {
                const area = zone.areaObjInfo[j];
                if (area.objName === 'BloomCube' && area.objArg0 != -1)
                    return area;
            }
        }

        return null;
    }

    private prepareBloomParameters(bloomParameters: BloomPostFXParameters): void {
        // TODO(jstpierre): Dynamically adjust based on Area.
        const bloomArea = this.findBloomArea();
        if (bloomArea !== null) {
            // TODO(jstpierre): What is arg1
            bloomParameters.blurStrength = bloomArea.objArg2 / 256;
            bloomParameters.bokehStrength = bloomArea.objArg3 / 256;
            bloomParameters.bokehCombineStrength = bloomArea.objArg0 / 256;
        } else {
            bloomParameters.blurStrength = 25/256;
            bloomParameters.bokehStrength = 25/256;
            bloomParameters.bokehCombineStrength = 50/256;
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
                texProjCameraSceneTex(texPrjMtx, viewerInput.camera, viewerInput.viewport);
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
        executor.executeDrawAll(this.sceneObjHolder, this.renderHelper.renderInstManager, viewerInput);
        executor.setIndirectTextureOverride(this.sceneTexture.gfxTexture!);

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

        // if (isExistPriorDrawAir())
        // We assume that prior airs are drawing.
        this.drawOpa(passRenderer, DrawBufferType.SKY);
        this.drawOpa(passRenderer, DrawBufferType.AIR);
        this.drawOpa(passRenderer, DrawBufferType.SUN);
        this.drawXlu(passRenderer, DrawBufferType.SKY);
        this.drawXlu(passRenderer, DrawBufferType.AIR);
        this.drawXlu(passRenderer, DrawBufferType.SUN);
        // if (isDrawSpinDriverPathAtOpa())
        //     execute(0x12);

        // Clear depth buffer.
        passRenderer.endPass(null);
        device.submitPass(passRenderer);
        passRenderer = this.mainRenderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);

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
        // if not PriorDrawAir, they would go here...

        // executeDrawListOpa();
        this.execute(passRenderer, DrawType.WARP_POD_PATH);

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
        passRenderer.endPass(this.sceneTexture.gfxTexture);
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
        this.execute(passRenderer, DrawType.OCEAN_BOWL);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_PLANET);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_MAP_OBJ);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_MAP_OBJ_STRONG_LIGHT);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_NPC);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_ENEMY);
        this.drawXlu(passRenderer, 0x22);
        this.drawXlu(passRenderer, 0x17);
        this.drawXlu(passRenderer, 0x16);
        this.execute(passRenderer, DrawType.EFFECT_DRAW_INDIRECT);
        this.execute(passRenderer, DrawType.EFFECT_DRAW_AFTER_INDIRECT);

        // executeDrawImageEffect()
        if (this.isNormalBloomOn() && this.bloomRenderer.pipelinesReady(device)) {
            passRenderer.endPass(null);
            device.submitPass(passRenderer);

            const objPassRenderer = this.bloomRenderer.renderBeginObjects(device, viewerInput);
            this.drawOpa(objPassRenderer, DrawBufferType.BLOOM_MODEL);
            this.drawXlu(objPassRenderer, DrawBufferType.BLOOM_MODEL);
            this.execute(objPassRenderer, DrawType.EFFECT_DRAW_FOR_BLOOM_EFFECT);
            passRenderer = this.bloomRenderer.renderEndObjects(device, objPassRenderer, this.renderHelper.renderInstManager, this.mainRenderTarget, viewerInput, template, bloomParameterBufferOffs);
        }

        this.execute(passRenderer, DrawType.EFFECT_DRAW_AFTER_IMAGE_EFFECT);

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
    loadedVertexData.vertexBuffers[1] = buffer;
    loadedVertexData.vertexBufferStrides[1] = bufferStride;

    const view = new DataView(loadedVertexData.vertexBuffers[0]);
    const pnmtxidxLayout = assertExists(loadedVertexLayout.dstVertexAttributeLayouts.find((attrib) => attrib.vtxAttrib === GX.VertexAttribute.PNMTXIDX));
    let offs = pnmtxidxLayout.bufferOffset;
    const loadedStride = loadedVertexData.vertexBufferStrides[0];

    for (let i = 0; i < vertexCount; i++) {
        const p = view.getUint8(offs);
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
                const packet = shape.mtxGroups[j];
                patchInTexMtxIdxBuffer(shape.loadedVertexLayout, packet.loadedVertexData, bufferStride, texMtxIdxBaseOffsets);
            }

            if (texMtxIdxBaseOffsets[0] >= 0 || texMtxIdxBaseOffsets[1] >= 0 || texMtxIdxBaseOffsets[2] >= 0 || texMtxIdxBaseOffsets[3] >= 0)
                shape.loadedVertexLayout.dstVertexAttributeLayouts.push({ vtxAttrib: GX.VertexAttribute.TEX0MTXIDX, format: GfxFormat.U8_RGBA, bufferIndex: 1, bufferOffset: 0 });
            if (texMtxIdxBaseOffsets[4] >= 0 || texMtxIdxBaseOffsets[5] >= 0 || texMtxIdxBaseOffsets[6] >= 0 || texMtxIdxBaseOffsets[7] >= 0)
                shape.loadedVertexLayout.dstVertexAttributeLayouts.push({ vtxAttrib: GX.VertexAttribute.TEX4MTXIDX, format: GfxFormat.U8_RGBA, bufferIndex: 1, bufferOffset: 4 });
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

export class ResourceHolder {
    public modelTable = new Map<string, J3DModelData>();
    public motionTable = new Map<string, ANK1>();
    public btkTable = new Map<string, TTK1>();
    public bpkTable = new Map<string, TRK1>();
    public btpTable = new Map<string, TPT1>();
    public brkTable = new Map<string, TRK1>();
    public bvaTable = new Map<string, VAF1>();
    public banmtTable = new Map<string, BckCtrl>();

    constructor(device: GfxDevice, cache: GfxRenderCache, public arc: RARC.RARC) {
        this.initEachResTable(device, this.modelTable, ['.bdl', '.bmd'], (ext, file) => {
            const bmd = BMD.parse(file.buffer);
            patchBMD(bmd);
            const bmdModel = new J3DModelData(device, cache, bmd);
            patchBMDModel(bmdModel);
            return bmdModel;
        });

        this.initEachResTable(device, this.motionTable, ['.bck', '.bca'], (ext, file) => {
            if (ext === '.bca')
                debugger;

            return BCK.parse(file.buffer);
        });

        // .blk
        this.initEachResTable(device, this.btkTable, ['.btk'], (ext, file) => BTK.parse(file.buffer));
        this.initEachResTable(device, this.bpkTable, ['.bpk'], (ext, file) => BPK.parse(file.buffer));
        this.initEachResTable(device, this.btpTable, ['.btp'], (ext, file) => BTP.parse(file.buffer));
        this.initEachResTable(device, this.brkTable, ['.brk'], (ext, file) => BRK.parse(file.buffer));
        // .bas
        // .bmt
        this.initEachResTable(device, this.bvaTable, ['.bva'], (ext, file) => BVA.parse(file.buffer));
        this.initEachResTable(device, this.banmtTable, ['.banmt'], (ext, file) => BckCtrl.parse(file.buffer));
    }

    public getModel(name: string): J3DModelData {
        return assertExists(this.modelTable.get(name.toLowerCase()));
    }

    public getRes<T>(table: Map<string, T>, name: string): T | null {
        return nullify(table.get(name.toLowerCase()));
    }

    private initEachResTable<T>(device: GfxDevice, table: Map<string, T>, extensions: string[], constructor: (ext: string, file: RARC.RARCFile) => T): void {
        for (let i = 0; i < this.arc.files.length; i++) {
            const file = this.arc.files[i];

            for (let j = 0; j < extensions.length; j++) {
                const ext = extensions[j];
                if (file.name.endsWith(ext)) {
                    const filenameWithoutExtension = file.name.slice(0, -ext.length);
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
    public archivePromiseCache = new Map<string, Promise<RARC.RARC | null>>();
    public archiveCache = new Map<string, RARC.RARC | null>();
    public archiveResourceHolder = new Map<string, ResourceHolder>();
    public cache = new GfxRenderCache(true);

    constructor(public device: GfxDevice, private pathBase: string, private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<void> {
        const v: Promise<any>[] = [... this.archivePromiseCache.values()];
        return Promise.all(v) as Promise<any>;
    }

    private async requestArchiveDataInternal(archivePath: string, abortedCallback: AbortedCallback): Promise<RARC.RARC | null> {
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

    public async requestArchiveData(archivePath: string): Promise<RARC.RARC | null> {
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

    public getArchive(archivePath: string): RARC.RARC | null {
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

    public getObjectData(objectName: string): RARC.RARC {
        return assertExists(this.getArchive(`ObjectData/${objectName}.arc`));
    }

    public destroy(device: GfxDevice): void {
        for (const resourceHolder of this.archiveResourceHolder.values())
            resourceHolder.destroy(device);
    }
}

class ScenarioData {
    public zoneNames: string[];
    public scenarioDataIter: JMapInfoIter;

    constructor(private scenarioArc: RARC.RARC) {
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

export const enum SceneObj {
    AIR_BUBBLE_HOLDER = 0x39,
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
    public airBubbleHolder: AirBubbleHolder | null = null;
    public captureSceneDirector = new CaptureSceneDirector();

    // This is technically stored outside the SceneObjHolder, separately
    // on the same singleton, but c'est la vie...
    public sceneNameObjListExecutor = new SceneNameObjListExecutor();
    public nameObjHolder = new NameObjHolder();

    public create(sceneObj: SceneObj): void {
        if (this.getObj(sceneObj) === null)
            this.newEachObj(sceneObj);
    }

    public getObj(sceneObj: SceneObj): any | null {
        if (sceneObj === SceneObj.AIR_BUBBLE_HOLDER)
            return this.airBubbleHolder;
        return null;
    }

    public newEachObj(sceneObj: SceneObj): void {
        if (sceneObj === SceneObj.AIR_BUBBLE_HOLDER)
            this.airBubbleHolder = new AirBubbleHolder(this);
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

    public areaObjInfo: ObjInfo[] = [];

    constructor(public stageDataHolder: StageDataHolder) {
        this.name = stageDataHolder.zoneName;

        stageDataHolder.iterAreas((infoIter, layerId) => {
            this.areaObjInfo.push(stageDataHolder.legacyCreateObjinfo(infoIter, []));
        });
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
        const actorTableEntry = getNameObjFactoryTableEntry(objName);
        if (actorTableEntry !== null)
            return actorTableEntry;

        const planetTableEntry = this.sceneObjHolder.planetMapCreator.getActorTableEntry(objName);
        if (planetTableEntry !== null)
            return planetTableEntry;

        return null;
    }

    private placeStageData(stageDataHolder: StageDataHolder): ZoneNode {
        const zoneNode = new ZoneNode(stageDataHolder);
        assert(this.zones[stageDataHolder.zoneId] === undefined);
        this.zones[stageDataHolder.zoneId] = zoneNode;

        const legacyPaths = stageDataHolder.legacyParsePaths();

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
                const objInfoLegacy = stageDataHolder.legacyCreateObjinfo(infoIter, legacyPaths);
                const infoIterCopy = copyInfoIter(infoIter);
                this.legacySpawner.spawnObjectLegacy(zoneAndLayer, infoIterCopy, objInfoLegacy);
            }
        });

        for (let i = 0; i < stageDataHolder.localStageDataHolders.length; i++) {
            const subzone = this.placeStageData(stageDataHolder.localStageDataHolders[i]);
            zoneNode.subzones.push(subzone);
        }

        return zoneNode;
    }

    public place(): void {
        this.placeStageData(this.sceneObjHolder.stageDataHolder);

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

        const zone = this.zones[zoneAndLayer.zoneId];
        return zone.visible && zone.layerVisible && layerVisible(zoneAndLayer.layerId, zone.layerMask);
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
    private zoneArchive: RARC.RARC;
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

    public legacyCreateObjinfo(infoIter: JMapInfoIter, paths: Path[]): ObjInfo {
        const objId = fallback(infoIter.getValueNumberNoInit('l_id'), -1);
        const objName = fallback(infoIter.getValueString('name'), 'Unknown');
        const objArg0 = fallback(infoIter.getValueNumberNoInit('Obj_arg0'), -1);
        const objArg1 = fallback(infoIter.getValueNumberNoInit('Obj_arg1'), -1);
        const objArg2 = fallback(infoIter.getValueNumberNoInit('Obj_arg2'), -1);
        const objArg3 = fallback(infoIter.getValueNumberNoInit('Obj_arg3'), -1);
        const pathId: number = fallback(infoIter.getValueNumberNoInit('CommonPath_ID'), -1);
        const path = paths.find((path) => path.l_id === pathId) || null;
        const modelMatrix = mat4.create();

        const translation = vec3.create(), rotation = vec3.create(), scale = vec3.create();
        getJMapInfoScale(scale, infoIter);
        getJMapInfoRotateLocal(rotation, infoIter);
        getJMapInfoTransLocal(translation, infoIter);
        computeModelMatrixSRT(modelMatrix,
            scale[0], scale[1], scale[2],
            rotation[0], rotation[1], rotation[2],
            translation[0], translation[1], translation[2]);

        return { objId, objName, objArg0, objArg1, objArg2, objArg3, modelMatrix, path };
    }

    public legacyParsePaths(): Path[] {
        const pathDir = assertExists(this.zoneArchive.findDir('jmp/path'));

        const commonPathInfo = BCSV.parse(RARC.findFileDataInDir(pathDir, 'commonpathinfo')!);
        return commonPathInfo.records.map((record, i): Path => {
            const l_id = assertExists(BCSV.getField<number>(commonPathInfo, record, 'l_id'));
            const no = assertExists(BCSV.getField<number>(commonPathInfo, record, 'no'));
            assert(no === i);
            const name = assertExists(BCSV.getField<string>(commonPathInfo, record, 'name'));
            const type = assertExists(BCSV.getField<string>(commonPathInfo, record, 'type'));
            const closed = BCSV.getField<string>(commonPathInfo, record, 'closed', 'OPEN');
            const pointinfo = BCSV.parse(RARC.findFileDataInDir(pathDir, `commonpathpointinfo.${i}`)!);
            const points = pointinfo.records.map((record, i) => {
                const id = BCSV.getField<number>(pointinfo, record, 'id');
                assert(id === i);
                const pnt0_x = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt0_x'));
                const pnt0_y = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt0_y'));
                const pnt0_z = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt0_z'));
                const pnt1_x = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt1_x'));
                const pnt1_y = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt1_y'));
                const pnt1_z = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt1_z'));
                const pnt2_x = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt2_x'));
                const pnt2_y = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt2_y'));
                const pnt2_z = assertExists(BCSV.getField<number>(pointinfo, record, 'pnt2_z'));
                const p0 = vec3.fromValues(pnt0_x, pnt0_y, pnt0_z);
                const p1 = vec3.fromValues(pnt1_x, pnt1_y, pnt1_z);
                const p2 = vec3.fromValues(pnt2_x, pnt2_y, pnt2_z);
                return { p0, p1, p2 };
            });
            return { l_id, name, type, closed, points };
        });
    }

    private iterLayer(layerId: LayerId, callback: LayerObjInfoCallback, buffer: ArrayBufferSlice): void {
        const iter = this.createCsvParser(buffer);

        for (let i = 0; i < iter.getNumRecords(); i++) {
            iter.setRecord(i);
            callback(iter, layerId);
        }
    }

    private iterPlacementDir(layerId: LayerId, callback: LayerObjInfoCallback, dir: RARC.RARCDir): void {
        for (let i = 0; i < dir.files.length; i++)
            this.iterLayer(layerId, callback, dir.files[i].buffer);
    }

    public iterPlacement(callback: LayerObjInfoCallback): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);

            const placementDir = this.zoneArchive.findDir(`jmp/Placement/${layerDirName}`);
            if (placementDir !== null)
                this.iterPlacementDir(i, callback, placementDir);

            const mapPartsDir = this.zoneArchive.findDir(`jmp/MapPartsDir/${layerDirName}`);
            if (mapPartsDir !== null)
                this.iterPlacementDir(i, callback, mapPartsDir);
        }
    }

    public iterAreas(callback: LayerObjInfoCallback): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);

            const areaObjInfo = this.zoneArchive.findFileData(`jmp/Placement/${layerDirName}/AreaObjInfo`);
            if (areaObjInfo !== null)
                this.iterLayer(i, callback, areaObjInfo);
        }
    }

    public createLocalStageDataHolders(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, scenarioData: ScenarioData): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);
            const stageObjInfo = this.zoneArchive.findFileData(`jmp/placement/${layerDirName}/StageObjInfo`);

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

    constructor(messageArc: RARC.RARC) {
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

    constructor(public name: string, public galaxyName: string, public forceScenario: number | null = null, public id: string = galaxyName) {
    }

    public abstract getLightData(modelCache: ModelCache): JMapInfoIter;
    public abstract getZoneLightData(modelCache: ModelCache, zoneName: string): JMapInfoIter;
    public abstract getZoneMapArchive(modelCache: ModelCache, zoneName: string): RARC.RARC;
    public abstract requestGlobalArchives(modelCache: ModelCache): void;
    public abstract requestZoneArchives(modelCache: ModelCache, zoneName: string): void;

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

        spawner.place();
        return new SMGRenderer(device, renderHelper, spawner, sceneObjHolder);
    }
}
