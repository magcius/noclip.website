
import { mat4, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { assert, assertExists, align, nArray, hexzero } from '../../util';
import { DataFetcher, DataFetcherFlags } from '../../DataFetcher';
import { MathConstants, computeModelMatrixSRT, lerp, computeNormalMatrix, clamp } from '../../MathHelpers';
import { getPointBezier } from '../../Spline';
import { Camera, computeClipSpacePointFromWorldSpacePoint, texProjCamera } from '../../Camera';
import { SceneContext } from '../../SceneBase';
import * as Viewer from '../../viewer';
import * as UI from '../../ui';

import { TextureMapping } from '../../TextureHolder';
import { GfxDevice, GfxRenderPass, GfxTexture, GfxFormat } from '../../gfx/platform/GfxPlatform';
import { executeOnPass } from '../../gfx/render/GfxRenderer';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../../gfx/helpers/RenderTargetHelpers';

import * as GX from '../../gx/gx_enum';
import * as Yaz0 from '../../compression/Yaz0';
import * as BCSV from '../../luigis_mansion/bcsv';
import * as RARC from '../../j3d/rarc';
import AnimationController from '../../AnimationController';

import { MaterialParams, PacketParams, fillSceneParamsDataOnTemplate } from '../../gx/gx_render';
import { LoadedVertexData, LoadedVertexLayout } from '../../gx/gx_displaylist';
import { GXRenderHelperGfx } from '../../gx/gx_render';
import { BMD, LoopMode, BVA, BTP, JSystemFileReaderHelper, ShapeDisplayFlags } from '../../j3d/j3d';
import { BMDModel, MaterialInstance } from '../../j3d/render';
import { JMapInfoIter, createCsvParser, getJMapInfoTransLocal, getJMapInfoRotateLocal, getJMapInfoScale } from './JMapInfo';
import { BloomPostFXParameters, BloomPostFXRenderer } from './Bloom';
import { LightDataHolder } from './LightData';
import { SceneNameObjListExecutor, DrawBufferType, createFilterKeyForDrawBufferType, OpaXlu, DrawType, createFilterKeyForDrawType } from './NameObj';
import { EffectSystem } from './EffectSystem';

import { NPCDirector, MiniRoutePoint, createModelObjMapObj, bindColorChangeAnimation, bindTexChangeAnimation, isExistIndirectTexture, connectToSceneIndirectMapObjStrongLight, connectToSceneMapObjStrongLight, connectToSceneSky, connectToSceneBloom, MiniRouteGalaxy, MiniRoutePart, emitEffect } from './Actors';
import { getNameObjTableEntry, PlanetMapCreator } from './ActorTable';
import { LiveActor, setTextureMappingIndirect, startBck, startBrkIfExist, startBtkIfExist, startBckIfExist, startBvaIfExist } from './LiveActor';

// Galaxy ticks at 60fps.
export const FPS = 60;
const FPS_RATE = FPS/1000;

export function getDeltaTimeFrames(viewerInput: Viewer.ViewerRenderInput): number {
    return viewerInput.deltaTime * FPS_RATE;
}

export function getTimeFrames(viewerInput: Viewer.ViewerRenderInput): number {
    return viewerInput.time * FPS_RATE;
}

const enum SceneGraphTag {
    Skybox = 0,
    Normal = 1,
    Bloom = 2,
    Indirect = 3,
};

interface ModelMatrixAnimator {
    updateRailAnimation(dst: mat4, time: number): void;
}

class RailAnimationMapPart {
    private railPhase: number = 0;

    constructor(public path: Path, translation: vec3) {
        assert(path.points.length === 2);
        assert(path.closed === 'OPEN');

        // Project translation onto our line segment to find t.
        const seg = vec3.create();
        const prj = vec3.create();
        vec3.sub(seg, path.points[1].p0, path.points[0].p0);
        vec3.sub(prj, translation, path.points[0].p0);
        const n = vec3.dot(prj, seg);
        const d = vec3.dot(seg, seg);
        const t = n / d;
        this.railPhase = t;
    }

    public updateRailAnimation(dst: mat4, time: number): void {
        // TODO(jstpierre): Figure out the path speed.
        const tS = time / 10;
        const t = (tS + this.railPhase) % 1.0;
        interpPathPoints(scratchVec3, this.path.points[0], this.path.points[1], t);
        dst[12] = scratchVec3[0];
        dst[13] = scratchVec3[1];
        dst[14] = scratchVec3[2];
    }
}

class RailAnimationTico {
    private railPhase: number = 0;

    constructor(public path: Path) {
    }

    public updateRailAnimation(dst: mat4, time: number): void {
        const path = this.path;

        // TODO(jstpierre): calculate speed. probably on the objinfo.
        const tS = time / 35;
        const t = (tS + this.railPhase) % 1.0;

        // Which point are we in?
        let numSegments = path.points.length;
        if (path.closed === 'OPEN')
            --numSegments;

        const segmentFrac = t * numSegments;
        const s0 = segmentFrac | 0;
        const sT = segmentFrac - s0;

        const s1 = (s0 >= path.points.length - 1) ? 0 : s0 + 1;
        const pt0 = assertExists(path.points[s0]);
        const pt1 = assertExists(path.points[s1]);

        const c = scratchVec3;
        interpPathPoints(c, pt0, pt1, sT);
        // mat4.identity(dst);
        dst[12] = c[0];
        dst[13] = c[1];
        dst[14] = c[2];

        // Now compute the derivative to rotate.
        interpPathPoints(c, pt0, pt1, sT + 0.05);
        c[0] -= dst[12];
        c[1] -= dst[13];
        c[2] -= dst[14];

        /*
        const cx = c[0], cy = c[1], cz = c[2];
        const yaw = Math.atan2(cz, -cx) - Math.PI / 2;
        const pitch = Math.atan2(cy, Math.sqrt(cx*cx+cz*cz));
        mat4.rotateZ(dst, dst, pitch);
        mat4.rotateY(dst, dst, yaw);
        */

        const ny = Math.atan2(c[2], -c[0]);
        mat4.rotateY(dst, dst, ny);
    }
}

const enum RotateAxis { X, Y, Z };

const scratchVec3 = vec3.create();

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

        scenarioData.setRecord(this.currentScenarioIndex);

        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zoneNode = this.spawner.zones[i];
            if (zoneNode === undefined)
                continue;
            zoneNode.layerMask = assertExists(scenarioData.getValueNumber(zoneNode.name));
        }

        this.spawner.zones[0].computeZoneVisibility();
        this.spawner.syncActorsVisible();
    }

    public setCurrentScenario(index: number): void {
        if (this.currentScenarioIndex === index)
            return;

        this.currentScenarioIndex = index;
        const strIndex = this.scenarioNoToIndex.indexOf(index) - 1;
        this.scenarioSelect.setHighlighted(strIndex);
        this.onstatechanged();
        this.applyCurrentScenario();
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
                texProjCamera(texPrjMtx, viewerInput.camera, 0.5, -0.5, 0.5, 0.5);
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

        this.mainRenderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.sceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        this.sceneObjHolder.captureSceneDirector.opaqueSceneTexture = this.sceneTexture.gfxTexture!;

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);

        const effectSystem = this.sceneObjHolder.effectSystem;
        if (effectSystem !== null) {
            const deltaTime = getDeltaTimeFrames(viewerInput);
            effectSystem.calc(deltaTime);

            const indDummy = effectSystem.particleResourceHolder.getTextureMappingReference('IndDummy');
            if (indDummy !== null)
                setTextureMappingIndirect(indDummy, this.sceneTexture.gfxTexture!);
        }

        // Prepare all of our NameObjs.
        executor.executeDrawAll(this.sceneObjHolder, this.renderHelper.renderInstManager, viewerInput);
        executor.setIndirectTextureOverride(this.sceneTexture.gfxTexture!);

        // Push to the renderinst.
        executor.drawAllBuffers(this.sceneObjHolder.modelCache.device, this.renderHelper.renderInstManager, camera);
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

        passRenderer = this.mainRenderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        passRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

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
        passRenderer = this.mainRenderTarget.createRenderPass(device, depthClearRenderPassDescriptor);

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

        passRenderer = this.mainRenderTarget.createRenderPass(device, noClearRenderPassDescriptor);
        passRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

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

interface Point {
    p0: vec3;
    p1: vec3;
    p2: vec3;
}

interface Path {
    l_id: number;
    name: string;
    type: string;
    closed: string;
    points: Point[];
}

interface ObjInfo {
    objId: number;
    objName: string;
    objArg0: number;
    objArg1: number;
    objArg2: number;
    objArg3: number;
    moveConditionType: number;
    rotateSpeed: number;
    rotateAxis: number;
    rotateAccelType: number;
    modelMatrix: mat4;
    path: Path | null;
}

export interface WorldmapPointInfo {
    isPink: boolean;
    isSmall: boolean;
    position: vec3;
}

interface AnimOptions {
    bck?: string;
    btk?: string;
    brk?: string;
}

function getPointLinear_3(dst: vec3, p0: vec3, p1: vec3, t: number): void {
    dst[0] = lerp(p0[0], p1[0], t);
    dst[1] = lerp(p0[1], p1[1], t);
    dst[2] = lerp(p0[2], p1[2], t);
}

function getPointBezier_3(dst: vec3, p0: vec3, c0: vec3, c1: vec3, p1: vec3, t: number): void {
    dst[0] = getPointBezier(p0[0], c0[0], c1[0], p1[0], t);
    dst[1] = getPointBezier(p0[1], c0[1], c1[1], p1[1], t);
    dst[2] = getPointBezier(p0[2], c0[2], c1[2], p1[2], t);
}

function interpPathPoints(dst: vec3, pt0: Point, pt1: Point, t: number): void {
    const p0 = pt0.p0;
    const c0 = pt0.p2;
    const c1 = pt1.p1;
    const p1 = pt1.p0;
    if (vec3.equals(p0, c0) && vec3.equals(c1, p1))
        getPointLinear_3(dst, p0, p1, t);
    else
        getPointBezier_3(dst, p0, c0, c1, p1, t);
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

            const matrixMode = texMtx.info & 0x3F;
            const isUsingEnvMap = (matrixMode === 0x01 || matrixMode === 0x06 || matrixMode === 0x07);
            const isUsingProjMap = (matrixMode === 0x02 || matrixMode === 0x03 || matrixMode === 0x08 || matrixMode === 0x09);

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

            for (let j = 0; j < shape.packets.length; j++) {
                const packet = shape.packets[j];
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
function fillMaterialParamsCallback(materialParams: MaterialParams, materialInstance: MaterialInstance, viewMatrix: mat4, modelMatrix: mat4, camera: Camera, packetParams: PacketParams): void {
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
        materialInstance.calcTexMtx(dst, texMtx, texSRT, modelMatrix, camera, flipY);
    }

    if (hasAnyEnvMap) {
        // Fill texture memory with normal matrices.
        for (let i = 0; i < 10; i++) {
            const m = materialParams.u_TexMtx[i];
            computeNormalMatrix(m, packetParams.u_PosMtx[i], true);
        }
    }
}

function patchBMDModel(bmdModel: BMDModel): void {
    // Kill off the sort-key bias; the game doesn't use the typical J3D rendering algorithm in favor
    // of its own sort, which needs to be RE'd.
    for (let i = 0; i < bmdModel.shapeData.length; i++)
        bmdModel.shapeData[i].sortKeyBias = 0;

    for (let i = 0; i < bmdModel.materialData.length; i++) {
        const materialData = bmdModel.materialData[i];

        const gxMaterial = materialData.material.gxMaterial;
        if (gxMaterial.useTexMtxIdx !== undefined && gxMaterial.useTexMtxIdx.some((v) => v)) {
            // Requires a callback.
            materialData.fillMaterialParamsCallback = fillMaterialParamsCallback;
        }
    }
}

export class ModelCache {
    public archivePromiseCache = new Map<string, Promise<RARC.RARC | null>>();
    public archiveCache = new Map<string, RARC.RARC | null>();
    public modelCache = new Map<string, BMDModel | null>();
    private models: BMDModel[] = [];

    constructor(public device: GfxDevice, public cache: GfxRenderCache, private pathBase: string, private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<void> {
        const v: Promise<any>[] = [... this.archivePromiseCache.values()];
        return Promise.all(v) as Promise<any>;
    }

    public getModel(rarc: RARC.RARC, modelFilename: string): BMDModel | null {
        if (this.modelCache.has(modelFilename))
            return this.modelCache.get(modelFilename)!;

        const bmd = BMD.parse(assertExists(rarc.findFileData(modelFilename)));
        patchBMD(bmd);
        const bmdModel = new BMDModel(this.device, this.cache, bmd, null);
        patchBMDModel(bmdModel);
        this.models.push(bmdModel);
        this.modelCache.set(modelFilename, bmdModel);
        return bmdModel;
    }

    
    private async requestArchiveDataInternal(archivePath: string): Promise<RARC.RARC | null> {
        const buffer = await this.dataFetcher.fetchData(`${this.pathBase}/${archivePath}`, DataFetcherFlags.ALLOW_404);

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

        const p = this.requestArchiveDataInternal(archivePath);
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

    public getObjectData(objectName: string): RARC.RARC | null {
        return this.getArchive(`ObjectData/${objectName}.arc`);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
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

export class Dot {
    public elem: HTMLElement;

    private x: number = 0;
    private y: number = 0;
    private radius: number = 0;

    public minRadius = 4;
    public maxRadius = 50;

    constructor(private uiSystem: UISystem) {
        this.elem = document.createElement('div');
        this.elem.style.position = 'absolute';
        this.elem.style.borderRadius = '100%';
        this.elem.style.backgroundColor = '#ff00ff';
        this.elem.style.pointerEvents = 'auto';
        this.elem.style.cursor = 'pointer';
        this.elem.style.transition = 'background-color .15s ease-out';
        this.elem.style.boxShadow = '0px 0px 10px rgba(0, 0, 0, 0.6)';
        this.elem.onmouseover = () => {
            this.elem.style.backgroundColor = 'white';
        };
        this.elem.onmouseout = () => {
            this.elem.style.backgroundColor = '#ff00ff';
        };

        this.uiSystem.uiContainer.appendChild(this.elem);
    }

    public setWorldPosition(camera: Camera, translation: vec3): void {
        computeClipSpacePointFromWorldSpacePoint(scratchVec3, camera, translation);

        const screenX = this.uiSystem.convertViewToScreenX(scratchVec3[0]);
        const screenY = this.uiSystem.convertViewToScreenY(scratchVec3[1]);
        const radiusRamp = (1.0 - scratchVec3[2]);
        const radius = clamp(this.maxRadius * radiusRamp, this.minRadius, this.maxRadius);
        const visible = scratchVec3[2] <= 1.0;
        this.setScreenPosition(screenX, screenY, radius, visible);
    }

    private setScreenPosition(x: number, y: number, radius: number, visible: boolean): void {
        if (visible) {
            if (x === this.x && y === this.y && radius === this.radius)
                return;

            this.x = x;
            this.y = y;
            this.radius = radius;

            // Clip.
            const padLeft = radius;
            const padRight = -radius;
            const padTop = radius;
            const padBottom = -radius;
            visible = (((this.x + padLeft) > 0) && ((this.x + padRight) < this.uiSystem.convertViewToScreenX(1.0)) &&
                       ((this.y + padTop) > 0) && ((this.y + padBottom) < this.uiSystem.convertViewToScreenY(-1.0)));
        }

        if (visible) {
            this.elem.style.left = `${x - radius}px`;
            this.elem.style.top = `${y - radius}px`;
            this.elem.style.width = `${radius * 2}px`;
            this.elem.style.height = `${radius * 2}px`;
            this.elem.style.display = 'block';
        } else {
            this.elem.style.display = 'none';
        }
    }
}

export class UISystem {
    constructor(public uiContainer: HTMLElement) {
    }

    public convertViewToScreenX(v: number) {
        const w = window.innerWidth;
        return (v * 0.5 + 0.5) * w;
    }

    public convertViewToScreenY(v: number) {
        const h = window.innerHeight;
        return (-v * 0.5 + 0.5) * h;
    }

    public createDot(): Dot {
        return new Dot(this);
    }
}

export class SceneObjHolder {
    public sceneDesc: SMGSceneDescBase;
    public modelCache: ModelCache;

    public scenarioData: ScenarioData;
    public planetMapCreator: PlanetMapCreator;
    public lightDataHolder: LightDataHolder;
    public npcDirector: NPCDirector;
    public stageDataHolder: StageDataHolder;
    public effectSystem: EffectSystem | null = null;
    public messageDataHolder: MessageDataHolder | null = null;
    public captureSceneDirector = new CaptureSceneDirector();

    // This is technically stored outside the SceneObjHolder, separately
    // on the same singleton, but c'est la vie...
    public sceneNameObjListExecutor = new SceneNameObjListExecutor();

    public uiSystem: UISystem;

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device);
        this.sceneNameObjListExecutor.destroy(device);

        if (this.effectSystem !== null)
            this.effectSystem.destroy(device);
    }
}

const enum LayerId {
    COMMON = -1,
    LAYER_A = 0,
    LAYER_B,
    LAYER_C,
    LAYER_D,
    LAYER_E,
    LAYER_F,
    LAYER_G,
    LAYER_H,
    LAYER_I,
    LAYER_J,
    LAYER_K,
    LAYER_L,
    LAYER_M,
    LAYER_N,
    LAYER_O,
    LAYER_P,
    LAYER_MAX = LAYER_P,
}

export function getObjectName(infoIter: JMapInfoIter): string {
    return assertExists(infoIter.getValueString(`name`));
}

// Random actor for other things that otherwise do not have their own actors.
class NoclipLegacyActor extends LiveActor {
    private modelMatrixAnimator: ModelMatrixAnimator | null = null;
    private rotateSpeed = 0;
    private rotatePhase = 0;
    private rotateAxis: RotateAxis = RotateAxis.Y;

    constructor(zoneAndLayer: ZoneAndLayer, arcName: string, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, tag: SceneGraphTag, public objinfo: ObjInfo) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, arcName);

        if (isExistIndirectTexture(this))
            tag = SceneGraphTag.Indirect;

        if (tag === SceneGraphTag.Normal)
            connectToSceneMapObjStrongLight(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Skybox)
            connectToSceneSky(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Indirect)
            connectToSceneIndirectMapObjStrongLight(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Bloom)
            connectToSceneBloom(sceneObjHolder, this);

        if (tag === SceneGraphTag.Skybox) {
            mat4.scale(objinfo.modelMatrix, objinfo.modelMatrix, [.5, .5, .5]);

            // Kill translation. Need to figure out how the game does skyboxes.
            objinfo.modelMatrix[12] = 0;
            objinfo.modelMatrix[13] = 0;
            objinfo.modelMatrix[14] = 0;

            this.modelInstance!.isSkybox = true;
        }

        this.initEffectKeeper(sceneObjHolder, null);

        this.setupAnimations();
    }

    public setupAnimations(): void {
        if (this.objinfo.moveConditionType === 0) {
            this.rotateSpeed = this.objinfo.rotateSpeed;
            this.rotateAxis = this.objinfo.rotateAxis;
        }

        const objName = this.objinfo.objName;
        if (objName.startsWith('HoleBeltConveyerParts') && this.objinfo.path) {
            this.modelMatrixAnimator = new RailAnimationMapPart(this.objinfo.path, this.translation);
        } else if (objName === 'TicoRail') {
            this.modelMatrixAnimator = new RailAnimationTico(assertExists(this.objinfo.path));
        }
    }

    public setRotateSpeed(speed: number, axis = RotateAxis.Y): void {
        this.rotatePhase = (this.objinfo.modelMatrix[12] + this.objinfo.modelMatrix[13] + this.objinfo.modelMatrix[14]);
        this.rotateSpeed = speed;
        this.rotateAxis = axis;
    }

    public updateMapPartsRotation(dst: mat4, time: number): void {
        if (this.rotateSpeed !== 0) {
            const speed = this.rotateSpeed * Math.PI / 100;
            if (this.rotateAxis === RotateAxis.X)
                mat4.rotateX(dst, dst, (time + this.rotatePhase) * speed);
            else if (this.rotateAxis === RotateAxis.Y)
                mat4.rotateY(dst, dst, (time + this.rotatePhase) * speed);
            else if (this.rotateAxis === RotateAxis.Z)
                mat4.rotateZ(dst, dst, (time + this.rotatePhase) * speed);
        }
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        const time = viewerInput.time / 1000;
        super.calcAndSetBaseMtx(viewerInput);
        this.updateMapPartsRotation(this.modelInstance!.modelMatrix, time);
        if (this.modelMatrixAnimator !== null)
            this.modelMatrixAnimator.updateRailAnimation(this.modelInstance!.modelMatrix, time);
    }
}

function layerVisible(layer: LayerId, layerMask: number): boolean {
    if (layer >= 0)
        return !!(layerMask & (1 << layer));
    else
        return true;
}

class ZoneNode {
    public name: string;

    public objects: LiveActor[] = [];

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

export interface NameObjFactory {
    new(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): LiveActor;
    requestArchives?(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void;
}

export interface ZoneAndLayer {
    zoneId: number;
    layerId: LayerId;
}

// TODO(jstpierre): Remove
class SMGSpawner {
    public zones: ZoneNode[] = [];
    private isSMG1 = false;
    private isSMG2 = false;
    private isWorldMap = false;

    constructor(private galaxyName: string, pathBase: string, private sceneObjHolder: SceneObjHolder) {
        this.isSMG1 = pathBase === 'j3d/smg';
        this.isSMG2 = pathBase === 'j3d/smg2';
        this.isWorldMap = this.isSMG2 && galaxyName.startsWith('WorldMap');
    }

    private zoneAndLayerVisible(zoneAndLayer: ZoneAndLayer): boolean {
        const zone = this.zones[zoneAndLayer.zoneId];
        return zone.visible && zone.layerVisible && layerVisible(zoneAndLayer.layerId, zone.layerMask);
    }

    public syncActorVisible(obj: LiveActor): void {
        obj.visibleScenario = this.zoneAndLayerVisible(obj.zoneAndLayer);
    }

    public syncActorsVisible(): void {
        for (let i = 0; i < this.sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos.length; i++)
            this.syncActorVisible(this.sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos[i].nameObj as LiveActor);
    }

    private getNameObjFactory(objName: string): NameObjFactory | null {
        const actorFactory = getNameObjTableEntry(objName);
        if (actorFactory !== null)
            return actorFactory.factory;

        const planetFactory = this.sceneObjHolder.planetMapCreator.getNameObjFactory(objName);
        if (planetFactory !== null)
            return planetFactory;

        return null;
    }

    public spawnObjectLegacy(zoneAndLayer: ZoneAndLayer, infoIter: JMapInfoIter, objinfo: ObjInfo): void {
        const modelCache = this.sceneObjHolder.modelCache;

        const applyAnimations = (actor: LiveActor, animOptions: AnimOptions | null | undefined) => {
            if (animOptions !== null) {
                if (animOptions !== undefined) {
                    if (animOptions.bck !== undefined)
                        startBck(actor, animOptions.bck.slice(0, -4));
                    if (animOptions.brk !== undefined)
                        startBrkIfExist(actor.modelInstance!, actor.arc, animOptions.brk.slice(0, -4));
                    if (animOptions.btk !== undefined)
                        startBtkIfExist(actor.modelInstance!, actor.arc, animOptions.btk.slice(0, -4));
                } else {
                    // Look for "Wait" animation first, then fall back to the first animation.
                    let hasAnim = false;
                    hasAnim = startBck(actor, 'Wait') || hasAnim;
                    hasAnim = startBrkIfExist(actor.modelInstance!, actor.arc, 'Wait') || hasAnim;
                    hasAnim = startBtkIfExist(actor.modelInstance!, actor.arc, 'Wait') || hasAnim;
                    if (!hasAnim) {
                        // If there's no "Wait" animation, then play the first animations that we can...
                        const bckFile = actor.arc.files.find((file) => file.name.endsWith('.bck')) || null;
                        if (bckFile !== null) {
                            const bckFilename = bckFile.name.slice(0, -4);
                            startBck(actor, bckFilename);
                        }

                        const brkFile = actor.arc.files.find((file) => file.name.endsWith('.brk') && file.name.toLowerCase() !== 'colorchange.brk') || null;
                        if (brkFile !== null) {
                            const brkFilename = brkFile.name.slice(0, -4);
                            startBckIfExist(actor.modelInstance!, actor.arc, brkFilename);
                        }

                        const btkFile = actor.arc.files.find((file) => file.name.endsWith('.btk') && file.name.toLowerCase() !== 'texchange.btk') || null;
                        if (btkFile !== null) {
                            const btkFilename = btkFile.name.slice(0, -4);
                            startBtkIfExist(actor.modelInstance!, actor.arc, btkFilename);
                        }            
                    }
                }
            }

            // Apply a random phase to the animation.
            if (actor.modelInstance!.ank1Animator !== null && actor.modelInstance!.ank1Animator.ank1.loopMode === LoopMode.REPEAT)
                actor.modelInstance!.animationController.phaseFrames += Math.random() * actor.modelInstance!.ank1Animator.ank1.duration;
        }

        const bindChangeAnimation = (actor: NoclipLegacyActor, rarc: RARC.RARC, frame: number) => {
            bindColorChangeAnimation(actor.modelInstance!, rarc, frame);
            bindTexChangeAnimation(actor.modelInstance!, rarc, frame);
        };

        const spawnGraphNullable = (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined) => {
            return modelCache.requestObjectData(arcName).then((data): [NoclipLegacyActor, RARC.RARC] | null => {
                if (data === null)
                    return null;

                const actor = new NoclipLegacyActor(zoneAndLayer, arcName, this.sceneObjHolder, infoIter, tag, objinfo);
                applyAnimations(actor, animOptions);

                this.addActor(actor);
                this.syncActorVisible(actor);

                return [actor, actor.arc];
            });
        };

        const spawnGraph = async (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined) => {
            return assertExists(await spawnGraphNullable(arcName, tag, animOptions));
        };

        const name = objinfo.objName;
        switch (name) {
        case 'PeachCastleTownAfterAttack':
            // Don't show. We want the pristine town state.
            return;

        case 'ElectricRail':
            // Covers the path with the rail -- will require special spawn logic.
            return;

        case 'ShootingStar':
            // Actor implementation in the works, but it requires stripe particles to look good...
            return;

        case 'MeteorCannon':
        case 'Plant':
        case 'WaterPlant':
        case 'SwingRope':
        case 'Creeper':
        case 'TrampleStar':
        case 'Flag':
        case 'FlagPeachCastleA':
        case 'FlagPeachCastleB':
        case 'FlagPeachCastleC':
        case 'FlagKoopaA':
        case 'FlagKoopaB':
        case 'FlagKoopaC':
        case 'FlagKoopaCastle':
        case 'FlagRaceA':
        case 'FlagRaceB':
        case 'FlagRaceC':
        case 'FlagTamakoro':
        case 'OceanRing':
        case 'WoodLogBridge':
        case 'SandBird':
        case 'RingBeamerAreaObj':
        case 'StatusFloor':
            // Archives just contain the textures. Mesh geometry appears to be generated at runtime by the game.
            return;

        case 'InvisibleWall10x10':
        case 'InvisibleWall10x20':
        case 'InvisibleWallJump10x20':
        case 'InvisibleWallGCapture10x20':
        case 'InvisibleWaterfallTwinFallLake':
        case 'GhostShipCavePipeCollision':
            // Invisible / Collision only.
            return;

        case 'TimerSwitch':
        case 'ClipFieldSwitch':
        case 'SoundSyncSwitch':
        case 'ExterminationSwitch':
        case 'SwitchSynchronizerReverse':
        case 'PrologueDirector':
        case 'MovieStarter':
        case 'ScenarioStarter':
        case 'LuigiEvent':
        case 'MameMuimuiScorer':
        case 'MameMuimuiScorerLv2':
        case 'ScoreAttackCounter':
        case 'RepeartTimerSwitch':
        case 'FlipPanelObserver':
            // Logic objects.
            return;

        case 'OpeningDemoObj':
        case 'NormalEndingDemoObj':
        case 'MeetKoopaDemoObj':
            // Cutscenes.
            return;

        case 'StarPieceFollowGroup':
        case 'StarPieceGroup':
        case 'StarPieceSpot':
        case 'StarPieceFlow':
        case 'WingBlockStarPiece':
        case 'YellowChipGroup':
        case 'RailCoin':
        case 'PurpleRailCoin':
        case 'CircleCoinGroup':
        case 'CirclePurpleCoinGroup':
        case 'PurpleCoinCompleteWatcher':
        case 'CoinAppearSpot':
        case 'GroupSwitchWatcher':
        case 'ExterminationPowerStar':
        case 'LuigiIntrusively':
        case 'MameMuimuiAttackMan':
        case 'CutBushGroup':
        case 'SuperDreamer':
        case 'PetitPorterWarpPoint':
        case 'SimpleDemoExecutor':
        case 'TimerCoinBlock':
        case 'CoinLinkGroup':
        case 'CollectTico':
        case 'BrightSun':
        case 'LavaSparksS':
        case 'InstantInferno':
        case 'FireRing':
        case 'FireBar':
        case 'JumpBeamer':
        case 'WaterFortressRain':
        case 'BringEnemy':
        case 'IceLayerBreak':
        case 'HeadLight':
        case 'TereboGroup':
        case 'NoteFairy':
        case 'Tongari2D':
        case 'Grapyon':
        case 'ExterminationCheckerWoodBox':
        case 'GliderShooter':
        case 'CaveInCube':
        case 'RaceRail':
        case 'GliBirdNpc':
        case 'SecretGateCounter':
        case 'PhantomTorch':
        case 'HammerHeadPackun':
        case 'Hanachan':
        case 'MarinePlant':
        case 'ForestWaterfallS':
        case 'Nyoropon':
        case 'WaterStream':
        case 'BallRail':
        case 'SphereRailDash':
        case 'HammerHeadPackunSpike':
            // No archives. Needs R&D for what to display.
            return;

        case 'SplashCoinBlock':
        case 'TimerCoinBlock':
        case 'SplashPieceBlock':
        case 'TimerPieceBlock':
        case 'ItemBlockSwitch':
            spawnGraph("CoinBlock", SceneGraphTag.Normal);
            break;

        case 'SurfingRaceSubGate':
            spawnGraph(name).then(([node, rarc]) => {
                bindChangeAnimation(node, rarc, objinfo.objArg1);
            });
            return;

        // Bloomables.
        // The actual engine will search for a file suffixed "Bloom" and spawn it if so.
        // Here, we don't want to trigger that many HTTP requests, so we just list all
        // models with bloom variants explicitly.
        case 'AssemblyBlockPartsTimerA':
        case 'AstroDomeComet':
        case 'FlipPanel':
        case 'FlipPanelReverse':
        case 'HeavensDoorInsidePlanetPartsA':
        case 'LavaProminence':
        case 'LavaProminenceEnvironment':
        case 'LavaProminenceTriple':
        case 'PeachCastleTownBeforeAttack':
            spawnGraph(name, SceneGraphTag.Normal);
            spawnGraph(`${name}Bloom`, SceneGraphTag.Bloom);
            break;

        // SMG1.
        case 'AstroCore':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'revival4.bck', brk: 'revival4.brk', btk: 'astrocore.btk' });
            break;
        case 'SignBoard':
            // SignBoard has a single animation for falling over which we don't want to play.
            spawnGraph('SignBoard', SceneGraphTag.Normal, null);
            break;
        case 'Rabbit':
            spawnGraph('TrickRabbit');
            break;
        case 'TicoRail':
            spawnGraph('Tico').then(([node, rarc]) => {
                bindChangeAnimation(node, rarc, objinfo.objArg0);
            });
            break;
        case 'TicoShop':
            spawnGraph(`TicoShop`).then(([node, rarc]) => {
                startBvaIfExist(node.modelInstance!, rarc, 'Small0');
            });
            break;

        case 'SweetsDecoratePartsFork':
        case 'SweetsDecoratePartsSpoon':
            spawnGraph(name, SceneGraphTag.Normal, null).then(([node, rarc]) => {
                bindChangeAnimation(node, rarc, objinfo.objArg1);
            });
            break;

        case 'OtaKing':
            spawnGraph('OtaKing');
            spawnGraph('OtaKingMagma');
            spawnGraph('OtaKingMagmaBloom', SceneGraphTag.Bloom);
            break;

        case 'UFOKinoko':
            spawnGraph(name, SceneGraphTag.Normal, null).then(([node, rarc]) => {
                bindChangeAnimation(node, rarc, objinfo.objArg0);
            });
            break;
        case 'PlantA':
            spawnGraph(`PlantA${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
            break;
        case 'PlantB':
            spawnGraph(`PlantB${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
            break;
        case 'PlantC':
            spawnGraph(`PlantC${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
            break;
        case 'PlantD':
            spawnGraph(`PlantD${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
            break;
        case 'BenefitItemOneUp':
            spawnGraph(`KinokoOneUp`);
            break;
        case 'BenefitItemLifeUp':
            spawnGraph(`KinokoLifeUp`);
            break;
        case 'BenefitItemInvincible':
            spawnGraph(`PowerUpInvincible`);
            break;
        case 'MorphItemNeoHopper':
            spawnGraph(`PowerUpHopper`);
            break;
        case 'MorphItemNeoBee':
            spawnGraph(`PowerUpBee`);
            break;
        case 'MorphItemNeoFire':
            spawnGraph(`PowerUpFire`);
            break;
        case 'MorphItemNeoFoo':
            spawnGraph(`PowerUpFoo`);
            break;
        case 'MorphItemNeoIce':
            spawnGraph(`PowerUpIce`);
            break;
        case 'MorphItemNeoTeresa':
            spawnGraph(`PowerUpTeresa`);
            break;
        case 'SpinCloudItem':
            spawnGraph(`PowerUpCloud`);
            break;
        case 'PukupukuWaterSurface':
            spawnGraph(`Pukupuku`);
            break;
        case 'TreasureBoxEmpty':
        case 'TreasureBoxKinokoOneUp':
            spawnGraph(`TreasureBox`);
            break;
        case 'SuperSpinDriverPink':
            // TODO(jstpierre): Adjust color override.
            spawnGraph(`SuperSpinDriver`);
            break;
        case 'JetTurtle':
            // spawnGraph(`Koura`);
            break;

        // TODO(jstpierre): Group spawn logic?
        case 'FlowerGroup':
            spawnGraph(`Flower`);
            return;
        case 'FlowerBlueGroup':
            spawnGraph(`FlowerBlue`);
            return;
        case 'FishGroupA':
            spawnGraph(`FishA`);
            break;
        case 'FishGroupB':
            spawnGraph(`FishB`);
            break;
        case 'FishGroupC':
            spawnGraph(`FishC`);
            break;
        case 'SeaGullGroup':
            spawnGraph(`SeaGull`);
            break;

        case 'HeavensDoorAppearStepA':
            // This is the transition effect version of the steps that appear after you chase the bunnies in Gateway Galaxy.
            // "HeavensDoorAppearStepAAfter" is the non-transition version of the same, and it's also spawned, so don't
            // bother spawning this one.
            return;

        case 'GreenStar':
        case 'PowerStar':
            spawnGraph(`PowerStar`, SceneGraphTag.Normal, { }).then(([node, rarc]) => {
                if (this.isSMG1) {
                    // This appears to be hardcoded in the DOL itself, inside "GameEventFlagTable".
                    const isRedStar = this.galaxyName === 'HeavensDoorGalaxy' && node.objinfo.objArg0 === 2;
                    // This is also hardcoded, but the designers left us a clue.
                    const isGreenStar = name === 'GreenStar';
                    const frame = isRedStar ? 5 : isGreenStar ? 2 : 0;

                    const animationController = new AnimationController();
                    animationController.setTimeInFrames(frame);

                    const btp = BTP.parse(rarc.findFileData(`powerstar.btp`)!);
                    node.modelInstance!.bindTPT1(btp.tpt1, animationController);
                } else {
                    const frame = name === 'GreenStar' ? 2 : 0;

                    const animationController = new AnimationController();
                    animationController.setTimeInFrames(frame);

                    const btp = BTP.parse(rarc.findFileData(`PowerStarColor.btp`)!);
                    node.modelInstance!.bindTPT1(btp.tpt1, animationController);
                }

                node.modelInstance!.setMaterialVisible('Empty', false);

                node.setRotateSpeed(140);
            });
            return;

        case 'GrandStar':
            spawnGraph(name).then(([node, rarc]) => {
                // Stars in cages are rotated by BreakableCage at a hardcoded '3.0'.
                // See BreakableCage::exeWait.
                node.modelInstance!.setMaterialVisible('GrandStarEmpty', false);
                node.setRotateSpeed(3);
            });
            return;

        // SMG2
        case 'Moc':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'turn.bck' }).then(([node, rarc]) => {
                const bva = BVA.parse(rarc.findFileData(`FaceA.bva`)!);
                node.modelInstance!.bindVAF1(bva.vaf1);
            });
            break;
        case 'CareTakerHunter':
            spawnGraph(`CaretakerHunter`);
            break;
        case 'WorldMapSyncSky':
            // Presumably this uses the "current world map". I chose 03, because I like it.
            spawnGraph(`WorldMap03Sky`, SceneGraphTag.Skybox);
            break;

        case 'DinoPackunVs1':
        case 'DinoPackunVs2':
            spawnGraph(`DinoPackun`);
            break;

        case 'Mogucchi':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'walk.bck' });
            return;

        case 'Dodoryu':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'swoon.bck' });
            break;
        case 'Karikari':
            spawnGraph('Karipon');
            break;
        case 'YoshiCapture':
            spawnGraph(`YCaptureTarget`);
            break;
        case 'Patakuri':
            // TODO(jstpierre): Parent the wing to the kurib.
            spawnGraph(`Kuribo`, SceneGraphTag.Normal, { bck: 'patakuriwait.bck' });
            spawnGraph(`PatakuriWing`);
            break;
        case 'ShellfishCoin':
            spawnGraph(`Shellfish`);
            break;
        case 'TogeBegomanLauncher':
        case 'BegomanBabyLauncher':
            spawnGraph(`BegomanLauncher`);
            break;

        case 'MarioFacePlanetPrevious':
            // The "old" face planet that Lubba discovers. We don't want it in sight, just looks ugly.
            return;

        case 'RedBlueTurnBlock':
            spawnGraph(`RedBlueTurnBlock`);
            spawnGraph(`RedBlueTurnBlockBase`);
            break;

        case 'TicoCoin':
            spawnGraph(name).then(([node, rarc]) => {
                node.modelInstance!.setMaterialVisible('TicoCoinEmpty_v', false);
            });
            break;
        case 'WanwanRolling':
            spawnGraph(name, SceneGraphTag.Normal, { });
            break;
        case 'PhantomCandlestand':
            spawnGraph(name).then(([node, rarc]) => {
                emitEffect(this.sceneObjHolder, node, 'Fire');
            });
        default:
            spawnGraphNullable(name);
            break;
        }
    }

    private addActor(object: LiveActor): void {
        this.zones[object.zoneAndLayer.zoneId].objects.push(object);
    }

    private placeStageData(stageDataHolder: StageDataHolder): ZoneNode {
        const zoneNode = new ZoneNode(stageDataHolder);
        assert(this.zones[stageDataHolder.zoneId] === undefined);
        this.zones[stageDataHolder.zoneId] = zoneNode;

        const legacyPaths = stageDataHolder.legacyParsePaths();

        stageDataHolder.iterPlacement((infoIter, layerId) => {
            const factory = this.getNameObjFactory(getObjectName(infoIter));
            const zoneAndLayer: ZoneAndLayer = { zoneId: stageDataHolder.zoneId, layerId };
            if (factory !== null) {
                const actor = new factory(zoneAndLayer, this.sceneObjHolder, infoIter);
                this.addActor(actor);
            } else {
                const objInfoLegacy = stageDataHolder.legacyCreateObjinfo(infoIter, legacyPaths);
                const infoIterCopy = copyInfoIter(infoIter);
                this.spawnObjectLegacy(zoneAndLayer, infoIterCopy, objInfoLegacy);
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

        if (this.isWorldMap) {
            this.placeWorldMap();
            // This zone appears to be toggled at runtime? Not sure how the WorldMap system is implemented...
            this.zones[1].visible = false;
            this.syncActorsVisible();
        }
    }

    private requestArchivesForObj(infoIter: JMapInfoIter): void {
        const objName = getObjectName(infoIter);

        if (this.sceneObjHolder.planetMapCreator.isRegisteredObj(objName)) {
            this.sceneObjHolder.planetMapCreator.requestArchive(this.sceneObjHolder, objName);
            return;
        }

        const factory = this.getNameObjFactory(objName);
        if (factory !== null && factory.requestArchives !== undefined)
            factory.requestArchives(this.sceneObjHolder, infoIter);

        const entry = getNameObjTableEntry(objName);
        if (entry !== null && entry.extraObjectDataArchiveNames.length) {
            for (let i = 0; i < entry.extraObjectDataArchiveNames.length; i++)
                this.sceneObjHolder.modelCache.requestObjectData(entry.extraObjectDataArchiveNames[i]);
        }
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
        if (this.isWorldMap)
            this.requestArchivesWorldMap();
    }

    // SMG2 World Map
    private requestArchivesWorldMap(): void {
        const modelCache = this.sceneObjHolder.modelCache;
        modelCache.requestObjectData('MiniRoutePoint');
        modelCache.requestObjectData('MiniRouteLine');
        modelCache.requestObjectData('MiniWorldWarpPoint');
        modelCache.requestObjectData('MiniEarthenPipe');
        modelCache.requestObjectData('MiniStarPieceMine');
        modelCache.requestObjectData('MiniTicoMasterMark');
        modelCache.requestObjectData('MiniStarCheckPointMark');

        const worldMapRarc = this.sceneObjHolder.modelCache.getObjectData(this.galaxyName.substr(0, 10))!;
        const worldMapGalaxyData = createCsvParser(worldMapRarc.findFileData('ActorInfo/Galaxy.bcsv')!);
        worldMapGalaxyData.mapRecords((jmp) => {
            modelCache.requestObjectData(assertExists(jmp.getValueString('MiniatureName')));
        })
    }

    public placeWorldMap(): void {
        const points: WorldmapPointInfo[] = [];
        const worldMapRarc = this.sceneObjHolder.modelCache.getObjectData(this.galaxyName.substr(0, 10))!;
        const worldMapPointData = createCsvParser(worldMapRarc.findFileData('ActorInfo/PointPos.bcsv')!);

        // Spawn everything in Zone 0.
        const zoneAndLayer: ZoneAndLayer = { zoneId: 0, layerId: LayerId.COMMON };

        worldMapPointData.mapRecords((infoIter) => {
            const position = vec3.fromValues(
                assertExists(infoIter.getValueNumber('PointPosX')),
                assertExists(infoIter.getValueNumber('PointPosY')),
                assertExists(infoIter.getValueNumber('PointPosZ')),
            );

            const isPink = infoIter.getValueString('ColorChange') == 'o';
            const isSmall = true;
            const pointInfo: WorldmapPointInfo = {
                position, isPink, isSmall,
            };
            points.push(pointInfo);
        });

        const worldMapGalaxyData = createCsvParser(worldMapRarc.findFileData('ActorInfo/Galaxy.bcsv')!);
        worldMapGalaxyData.mapRecords((infoIter) => {
            const pointIndex = assertExists(infoIter.getValueNumber('PointPosIndex'));
            points[pointIndex].isSmall = false;
            const galaxy = new MiniRouteGalaxy(zoneAndLayer, this.sceneObjHolder, infoIter, points[pointIndex]);
            this.addActor(galaxy);
        });

        // Sometimes it's in the ActorInfo directory, sometimes its not... WTF?
        const worldMapPointParts = createCsvParser(worldMapRarc.files.find((file) => file.name.toLowerCase() === 'pointparts.bcsv')!.buffer);
        worldMapPointParts.mapRecords((infoIter) => {
            const pointIndex = assertExists(infoIter.getValueNumber('PointIndex'));
            points[pointIndex].isSmall = false;
            const pointPart = new MiniRoutePart(zoneAndLayer, this.sceneObjHolder, infoIter, points[pointIndex]);
            this.addActor(pointPart);
        });

        // Spawn our points
        worldMapPointData.mapRecords((infoIter, i) => {
            const isValid = infoIter.getValueString('Valid') === 'o';
            if (isValid) {
                const point = new MiniRoutePoint(zoneAndLayer, this.sceneObjHolder, points[i]);
                this.addActor(point);
            }
        });

        const worldMapLinkData = createCsvParser(worldMapRarc.findFileData('ActorInfo/PointLink.bcsv')!);
        worldMapLinkData.mapRecords((jmp) => {
            const isColorChange = jmp.getValueString('IsColorChange') === 'o';
            const pointA = points[assertExists(jmp.getValueNumber('PointIndexA'))];
            const pointB = points[assertExists(jmp.getValueNumber('PointIndexB'))];
            this.spawnWorldMapLine(zoneAndLayer, pointA, pointB, isColorChange);
        });
    }

    public spawnWorldMapLine(zoneAndLayer: ZoneAndLayer, point1Info: WorldmapPointInfo, point2Info: WorldmapPointInfo, isPink: Boolean): void {
        // TODO(jstpierre): Move to a LiveActor for the lines as well?

        const modelMatrix = mat4.create();
        mat4.fromTranslation(modelMatrix, point1Info.position);

        const r = vec3.create();
        vec3.sub(r,point2Info.position,point1Info.position);
        modelMatrix[0]  = r[0]/1000;
        modelMatrix[1]  = r[1]/1000;
        modelMatrix[2]  = r[2]/1000;

        vec3.normalize(r, r);
        const u = vec3.fromValues(0,1,0);
        modelMatrix[4]  = 0;
        modelMatrix[5]  = 1;
        modelMatrix[6]  = 0;

        const f = vec3.create();
        vec3.cross(f, r, u);
        modelMatrix[8]  = f[0]*2;
        modelMatrix[9]  = f[1];
        modelMatrix[10] = f[2]*2;

        const obj = createModelObjMapObj(zoneAndLayer, this.sceneObjHolder, `MiniRouteLine`, 'MiniRouteLine', modelMatrix);
        startBvaIfExist(obj.modelInstance!, obj.arc, 'Open');
        if (isPink)
            startBrkIfExist(obj.modelInstance!, obj.arc, 'TicoBuild');
        else
            startBrkIfExist(obj.modelInstance!, obj.arc, 'Normal');

        this.addActor(obj);
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

    public legacyCreateObjinfo(infoIter: JMapInfoIter, paths: Path[]): ObjInfo {
        const objId = infoIter.getValueNumber('l_id', -1);
        const objName = infoIter.getValueString('name', 'Unknown');
        const objArg0 = infoIter.getValueNumber('Obj_arg0', -1);
        const objArg1 = infoIter.getValueNumber('Obj_arg1', -1);
        const objArg2 = infoIter.getValueNumber('Obj_arg2', -1);
        const objArg3 = infoIter.getValueNumber('Obj_arg3', -1);
        const moveConditionType = infoIter.getValueNumber('MoveConditionType', 0);
        const rotateSpeed = infoIter.getValueNumber('RotateSpeed', 0);
        const rotateAccelType = infoIter.getValueNumber('RotateAccelType', 0);
        const rotateAxis = infoIter.getValueNumber('RotateAxis', 0);
        const pathId: number = infoIter.getValueNumber('CommonPath_ID', -1);
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

        return { objId, objName, objArg0, objArg1, objArg2, objArg3, moveConditionType, rotateSpeed, rotateAccelType, rotateAxis, modelMatrix, path };
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
            const path_arg0 = assertExists(BCSV.getField<string>(commonPathInfo, record, 'path_arg0'));
            const path_arg1 = assertExists(BCSV.getField<string>(commonPathInfo, record, 'path_arg1'));
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

    public iterPlacement(callback: LayerObjInfoCallback): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);

            const objInfo = this.zoneArchive.findFileData(`jmp/Placement/${layerDirName}/ObjInfo`);
            if (objInfo !== null)
                this.iterLayer(i, callback, objInfo);

            const mapPartsInfo = this.zoneArchive.findFileData(`jmp/MapParts/${layerDirName}/MapPartsInfo`);
            if (mapPartsInfo !== null)
                this.iterLayer(i, callback, mapPartsInfo);
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

    private iterLayer(layerId: LayerId, callback: LayerObjInfoCallback, buffer: ArrayBufferSlice): void {
        const iter = this.createCsvParser(buffer);

        for (let i = 0; i < iter.getNumRecords(); i++) {
            iter.setRecord(i);
            callback(iter, layerId);
        }
    }

    public createLocalStageDataHolders(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, scenarioData: ScenarioData): void {
        let currentZoneId = this.zoneId + 1;

        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);
            const stageObjInfo = this.zoneArchive.findFileData(`jmp/placement/${layerDirName}/StageObjInfo`);

            if (stageObjInfo === null)
                continue;

            const mapInfoIter = createCsvParser(stageObjInfo);

            for (let j = 0; j < mapInfoIter.getNumRecords(); j++) {
                mapInfoIter.setRecord(j);
                const zoneName = getObjectName(mapInfoIter);
                const zoneId = currentZoneId++;
                const localStage = new StageDataHolder(sceneDesc, modelCache, scenarioData, zoneName, zoneId, i);
                currentZoneId += localStage.localStageDataHolders.length;
                localStage.calcPlacementMtx(mapInfoIter);
                this.localStageDataHolders.push(localStage);
            }
        }
    }

    private calcPlacementMtx(infoIter: JMapInfoIter): void {
        const pos_x = infoIter.getValueNumber('pos_x', 0);
        const pos_y = infoIter.getValueNumber('pos_y', 0);
        const pos_z = infoIter.getValueNumber('pos_z', 0);
        const dir_x = infoIter.getValueNumber('dir_x', 0) * MathConstants.DEG_TO_RAD;
        const dir_y = infoIter.getValueNumber('dir_y', 0) * MathConstants.DEG_TO_RAD;
        const dir_z = infoIter.getValueNumber('dir_z', 0) * MathConstants.DEG_TO_RAD;
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
    protected pathBase: string;

    constructor(public name: string, public galaxyName: string, public forceScenario: number | null = null, public id: string = galaxyName) {
    }

    public abstract getLightData(modelCache: ModelCache): JMapInfoIter;
    public abstract getZoneLightData(modelCache: ModelCache, zoneName: string): JMapInfoIter;
    public abstract getZoneMapArchive(modelCache: ModelCache, zoneName: string): RARC.RARC;
    public abstract requestGlobalArchives(modelCache: ModelCache): void;
    public abstract requestZoneArchives(modelCache: ModelCache, zoneName: string): void;

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const renderHelper = new GXRenderHelperGfx(device);
        context.destroyablePool.push(renderHelper);

        const gfxRenderCache = renderHelper.renderInstManager.gfxRenderCache;
        const modelCache = new ModelCache(device, gfxRenderCache, this.pathBase, context.dataFetcher);

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
        sceneObjHolder.uiSystem = new UISystem(context.uiContainer);
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
        sceneObjHolder.lightDataHolder = new LightDataHolder(this.getLightData(modelCache));
        sceneObjHolder.stageDataHolder = new StageDataHolder(this, modelCache, sceneObjHolder.scenarioData, sceneObjHolder.scenarioData.getMasterZoneFilename(), 0);

        if (modelCache.isArchiveExist(`ParticleData/Effect.arc`))
            sceneObjHolder.effectSystem = new EffectSystem(device, modelCache.getArchive(`ParticleData/Effect.arc`)!);

        if (modelCache.isArchiveExist(`UsEnglish/MessageData/Message.arc`))
            sceneObjHolder.messageDataHolder = new MessageDataHolder(modelCache.getArchive(`UsEnglish/MessageData/Message.arc`)!);

        const spawner = new SMGSpawner(galaxyName, this.pathBase, sceneObjHolder);
        spawner.requestArchives();

        await modelCache.waitForLoad();

        spawner.place();
        return new SMGRenderer(device, renderHelper, spawner, sceneObjHolder);
    }
}
