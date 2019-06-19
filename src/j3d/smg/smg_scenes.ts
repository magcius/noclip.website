
import { mat4, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import Progressable from '../../Progressable';
import { assert, assertExists, align, nArray } from '../../util';
import { fetchData, AbortedError } from '../../fetch';
import { MathConstants, computeModelMatrixSRT, lerp, computeNormalMatrix } from '../../MathHelpers';
import { getPointBezier } from '../../Spline';
import { Camera } from '../../Camera';
import * as Viewer from '../../viewer';
import * as UI from '../../ui';

import { TextureMapping } from '../../TextureHolder';
import { GfxDevice, GfxRenderPass, GfxTexture, GfxFormat } from '../../gfx/platform/GfxPlatform';
import { GXRenderHelperGfx } from '../../gx/gx_render_2';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, noClearRenderPassDescriptor } from '../../gfx/helpers/RenderTargetHelpers';

import * as GX from '../../gx/gx_enum';
import * as Yaz0 from '../../compression/Yaz0';
import * as BCSV from '../../luigis_mansion/bcsv';
import * as RARC from '../../j3d/rarc';
import AnimationController from '../../AnimationController';

import { EFB_WIDTH, EFB_HEIGHT } from '../../gx/gx_material';
import { MaterialParams, PacketParams } from '../../gx/gx_render';
import { LoadedVertexData, LoadedVertexLayout } from '../../gx/gx_displaylist';
import { BMD, BRK, BTK, BCK, LoopMode, BVA, BTP, BPK, JSystemFileReaderHelper, ShapeDisplayFlags } from '../../j3d/j3d';
import { BMDModel, BMDModelInstance, MaterialInstance } from '../../j3d/render';
import { JMapInfoIter, createCsvParser, getJMapInfoTransLocal, getJMapInfoRotateLocal, getJMapInfoScale } from './JMapInfo';
import { BloomPostFXParameters, BloomPostFXRenderer } from './Bloom';
import { AreaLightInfo, ActorLightInfo, LightDataHolder, ActorLightCtrl } from './LightData';
import { NameObj, SceneNameObjListExecutor, DrawBufferType, FilterKeyBase, createFilterKeyForDrawBufferType, OpaXlu, DrawType, createFilterKeyForDrawType } from './NameObj';
import { EffectSystem, EffectKeeper, DrawOrder } from './EffectSystem';
import { LightType } from './DrawBuffer';
import { Spine, Nerve } from './Spine';

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

    constructor(public path: Path, modelMatrix: mat4) {
        assert(path.points.length === 2);
        assert(path.closed === 'OPEN');
        const translation = scratchVec3;
        mat4.getTranslation(translation, modelMatrix);

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

interface ObjectBase {
    zoneAndLayer: ZoneAndLayer;
    visibleScenario: boolean;
}

function setTextureMappingIndirect(m: TextureMapping, sceneTexture: GfxTexture): void {
    m.gfxTexture = sceneTexture;
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = true;
}

function setIndirectTextureOverride(modelInstance: BMDModelInstance, sceneTexture: GfxTexture): void {
    const m = modelInstance.getTextureMappingReference("IndDummy");
    if (m !== null)
        setTextureMappingIndirect(m, sceneTexture);
}

const scratchVec3 = vec3.create();
class Node implements ObjectBase {
    public modelMatrix = mat4.create();
    public planetRecord: BCSV.BcsvRecord | null = null;
    public visibleScenario: boolean = true;

    private modelMatrixAnimator: ModelMatrixAnimator | null = null;
    private rotateSpeed = 0;
    private rotatePhase = 0;
    private rotateAxis: RotateAxis = RotateAxis.Y;
    public areaLightInfo: AreaLightInfo;
    public areaLightConfiguration: ActorLightInfo;

    constructor(public sceneGraphTag: SceneGraphTag, public name: string, public zoneAndLayer: ZoneAndLayer, public objinfo: ObjInfo, public modelInstance: BMDModelInstance, parentModelMatrix: mat4, public animationController: AnimationController) {
        mat4.mul(this.modelMatrix, parentModelMatrix, objinfo.modelMatrix);
        this.setupAnimations();
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
    }

    public setLightingEnabled(v: boolean): void {
        this.modelInstance.setLightingEnabled(v);
    }

    public setIndirectTextureOverride(sceneTexture: GfxTexture): void {
        setIndirectTextureOverride(this.modelInstance, sceneTexture);
    }

    public setupAnimations(): void {
        if (this.objinfo.moveConditionType === 0) {
            this.rotateSpeed = this.objinfo.rotateSpeed;
            this.rotateAxis = this.objinfo.rotateAxis;
        }

        const objName = this.objinfo.objName;
        if (objName.startsWith('HoleBeltConveyerParts') && this.objinfo.path) {
            this.modelMatrixAnimator = new RailAnimationMapPart(this.objinfo.path, this.modelMatrix);
        } else if (objName === 'TicoRail') {
            this.modelMatrixAnimator = new RailAnimationTico(this.objinfo.path);
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

    public updateSpecialAnimations(): void {
        const time = this.animationController.getTimeInSeconds();
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        this.updateMapPartsRotation(this.modelInstance.modelMatrix, time);
        if (this.modelMatrixAnimator !== null)
            this.modelMatrixAnimator.updateRailAnimation(this.modelInstance.modelMatrix, time);
    }

    public setAreaLightInfo(areaLightInfo: AreaLightInfo): void {
        this.areaLightInfo = areaLightInfo;

        // Which light configuration to use?
        if (this.planetRecord !== null) {
            this.areaLightConfiguration = this.areaLightInfo.Planet;
        } else {
            this.areaLightConfiguration = this.areaLightInfo.Strong;            
        }
    }

    public draw(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        this.modelInstance.visible = this.visibleScenario;

        if (!this.visibleScenario)
            return;

        this.areaLightConfiguration.setOnModelInstance(this.modelInstance, viewerInput.camera, false);
        this.updateSpecialAnimations();

        this.modelInstance.animationController.setTimeInMilliseconds(viewerInput.time);
        this.modelInstance.calcAnim(viewerInput.camera);
    }
}

class SceneGraph {
    public nodes: Node[] = [];
    public onnodeadded: (() => void) | null = null;

    public addNode(node: Node | null): void {
        if (node === null)
            return;
        this.nodes.push(node);
        const i = this.nodes.length - 1;
        if (this.onnodeadded !== null)
            this.onnodeadded();
    }
}

function createFilterKeyForLegacyNode(xlu: OpaXlu, sceneGraphTag: SceneGraphTag): number {
    if (xlu === OpaXlu.OPA)
        return FilterKeyBase.LEGACY_NODE_OPA | sceneGraphTag;
    else
        return FilterKeyBase.LEGACY_NODE_XLU | sceneGraphTag;
}

function createFilterKeyForEffectDrawOrder(drawOrder: DrawOrder): number {
    return FilterKeyBase.EFFECT | drawOrder;
}

class SMGRenderer implements Viewer.SceneGfx {
    private sceneGraph: SceneGraph;

    private bloomRenderer: BloomPostFXRenderer;
    private bloomParameters = new BloomPostFXParameters();

    private mainRenderTarget = new BasicRenderTarget();
    private sceneTexture = new ColorTexture();
    private currentScenarioIndex: number = 0;
    private scenarioSelect: UI.SingleSelect;

    private scenarioNoToIndex: number[] = [];

    public onstatechanged!: () => void;

    constructor(device: GfxDevice, private renderHelper: GXRenderHelperGfx, private spawner: SMGSpawner, private sceneObjHolder: SceneObjHolder) {
        this.sceneGraph = spawner.sceneGraph;

        this.sceneGraph.onnodeadded = () => {
            this.applyCurrentScenario();
        };

        this.bloomRenderer = new BloomPostFXRenderer(device, this.renderHelper.renderInstManager.gfxRenderCache, this.mainRenderTarget);
    }

    private zoneAndLayerVisible(zoneAndLayer: ZoneAndLayer): boolean {
        const zone = this.spawner.zones[zoneAndLayer.zoneId];
        return zone.visible && layerVisible(zoneAndLayer.layerId, zone.layerMask);
    }

    private syncObjectVisible(obj: ObjectBase): void {
        obj.visibleScenario = this.zoneAndLayerVisible(obj.zoneAndLayer);
    }

    private applyCurrentScenario(): void {
        const scenarioData = this.sceneObjHolder.scenarioData.scenarioDataIter;

        scenarioData.setRecord(this.currentScenarioIndex);

        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zoneNode = this.spawner.zones[i];
            if (zoneNode === undefined)
                continue;
            zoneNode.layerMask = scenarioData.getValueNumber(zoneNode.name);
        }

        this.spawner.zones[0].computeObjectVisibility();
        for (let i = 0; i < this.sceneGraph.nodes.length; i++)
            this.syncObjectVisible(this.sceneGraph.nodes[i]);
        for (let i = 0; i < this.sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos.length; i++)
            this.syncObjectVisible(this.sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos[i].nameObj as LiveActor);
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
            this.scenarioNoToIndex[jmp.getValueNumber('ScenarioNo')] = i;
        });

        const scenarioNames: string[] = [];
        for (let i = 1; i < this.scenarioNoToIndex.length; i++) {
            const scenarioIndex = this.scenarioNoToIndex[i];
            scenarioData.setRecord(scenarioIndex);

            let name: string = "";
            if (!name && this.sceneObjHolder.messageDataHolder !== null)
                name = this.sceneObjHolder.messageDataHolder.getStringById(`ScenarioName_${galaxyName}${i}`);

            if (!name)
                name = scenarioData.getValueString(`ScenarioName`);

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

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.sceneGraph.nodes.length; i++)
                this.sceneGraph.nodes[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.sceneGraph.nodes.length; i++)
                this.sceneGraph.nodes[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableLighting = new UI.Checkbox('Enable Lighting', true);
        enableLighting.onchanged = () => {
            for (let i = 0; i < this.sceneGraph.nodes.length; i++)
                this.sceneGraph.nodes[i].setLightingEnabled(enableLighting.checked);
        };
        renderHacksPanel.contents.appendChild(enableLighting.elem);

        return [scenarioPanel, renderHacksPanel];
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

    private drawAllLegacyNodes(camera: Camera): void {
        for (let i = 0; i < this.sceneGraph.nodes.length; i++) {
            const node = this.sceneGraph.nodes[i];
            if (!node.visibleScenario)
                continue;

            const templateOpa = this.renderHelper.renderInstManager.pushTemplateRenderInst();
            templateOpa.filterKey = createFilterKeyForLegacyNode(OpaXlu.OPA, node.sceneGraphTag);
            node.modelInstance.drawOpa(this.sceneObjHolder.modelCache.device, this.renderHelper, camera);
            this.renderHelper.renderInstManager.popTemplateRenderInst();

            const templateXlu = this.renderHelper.renderInstManager.pushTemplateRenderInst();
            templateXlu.filterKey = createFilterKeyForLegacyNode(OpaXlu.XLU, node.sceneGraphTag);
            node.modelInstance.drawXlu(this.sceneObjHolder.modelCache.device, this.renderHelper, camera);
            this.renderHelper.renderInstManager.popTemplateRenderInst();
        }
    }

    private drawAllEffects(): void {
        for (let drawOrder = 0; drawOrder < 2; drawOrder++) {
            const template = this.renderHelper.renderInstManager.pushTemplateRenderInst();
            template.filterKey = createFilterKeyForEffectDrawOrder(drawOrder);
            this.sceneObjHolder.effectSystem.draw(this.sceneObjHolder.modelCache.device, this.renderHelper, drawOrder);
            this.renderHelper.renderInstManager.popTemplateRenderInst();
        }
    }

    private drawLegacyNodeOpa(passRenderer: GfxRenderPass, sceneGraphTag: SceneGraphTag): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForLegacyNode(OpaXlu.OPA, sceneGraphTag));
    }

    private drawLegacyNodeXlu(passRenderer: GfxRenderPass, sceneGraphTag: SceneGraphTag): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForLegacyNode(OpaXlu.XLU, sceneGraphTag));
    }

    private execute(passRenderer: GfxRenderPass, drawType: DrawType): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForDrawType(drawType));
    }

    private drawEffect(passRenderer: GfxRenderPass, drawOrder: DrawOrder): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForEffectDrawOrder(drawOrder));
    }

    private drawOpa(passRenderer: GfxRenderPass, drawBufferType: DrawBufferType): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForDrawBufferType(OpaXlu.OPA, drawBufferType));
    }

    private drawXlu(passRenderer: GfxRenderPass, drawBufferType: DrawBufferType): void {
        executeOnPass(this.renderHelper.renderInstManager, this.sceneObjHolder.modelCache.device, passRenderer, createFilterKeyForDrawBufferType(OpaXlu.XLU, drawBufferType));
    }

    private isNormalBloomOn(): boolean {
        const hasBloomObjects = this.sceneObjHolder.sceneNameObjListExecutor.drawBufferHasVisible(DrawBufferType.BLOOM_MODEL);
        return hasBloomObjects;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const executor = this.sceneObjHolder.sceneNameObjListExecutor;
        const camera = viewerInput.camera;

        executor.executeMovement(this.sceneObjHolder, viewerInput);
        executor.executeCalcAnim(this.sceneObjHolder, viewerInput);

        this.mainRenderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.sceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        this.sceneObjHolder.captureSceneDirector.opaqueSceneTexture = this.sceneTexture.gfxTexture;

        // TODO(jstpierre): This is a very messy combination of the legacy render path and the new render path.
        // Anything in `sceneGraph` is legacy, the new stuff uses the drawBufferHolder.
        viewerInput.camera.setClipPlanes(100, 800000);

        // First, prepare our legacy-style nodes.
        for (let i = 0; i < this.sceneGraph.nodes.length; i++) {
            const node = this.sceneGraph.nodes[i];
            node.draw(this.sceneObjHolder, viewerInput);
            // TODO(jstpierre): Remove.
            node.setIndirectTextureOverride(this.sceneTexture.gfxTexture);
        }

        const template = this.renderHelper.pushTemplateRenderInst();
        this.renderHelper.fillSceneParams(viewerInput, template);

        const effectSystem = this.sceneObjHolder.effectSystem;
        if (effectSystem !== null) {
            const deltaTime = getDeltaTimeFrames(viewerInput);
            effectSystem.calc(deltaTime);
            effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, null);
        }

        // Prepare all of our NameObjs.
        executor.executeDrawAll(this.sceneObjHolder, this.renderHelper, viewerInput);
        executor.setIndirectTextureOverride(this.sceneTexture.gfxTexture);

        // Push to the renderinst.
        executor.drawAllBuffers(this.sceneObjHolder.modelCache.device, this.renderHelper, camera);
        this.drawAllLegacyNodes(camera);
        this.drawAllEffects();

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
        this.drawOpa(passRenderer, DrawBufferType.CRYSTAL);
        this.drawXlu(passRenderer, DrawBufferType.CRYSTAL);
        // drawOpa(0x20); drawXlu(0x20);
        // drawOpa(0x23); drawXlu(0x23);

        // if (isExistPriorDrawAir())
        // We assume that prior airs are drawing.
        this.drawOpa(passRenderer, DrawBufferType.SKY);
        this.drawXlu(passRenderer, DrawBufferType.SKY);
        this.drawOpa(passRenderer, DrawBufferType.AIR);
        this.drawOpa(passRenderer, DrawBufferType.SUN);
        this.drawLegacyNodeOpa(passRenderer, SceneGraphTag.Skybox);
        this.drawXlu(passRenderer, DrawBufferType.SKY);
        this.drawXlu(passRenderer, DrawBufferType.AIR);
        this.drawXlu(passRenderer, DrawBufferType.SUN);
        this.drawLegacyNodeXlu(passRenderer, SceneGraphTag.Skybox);
        // if (isDrawSpinDriverPathAtOpa())
        //     execute(0x12);
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
        this.drawLegacyNodeOpa(passRenderer, SceneGraphTag.Normal);
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
        this.drawLegacyNodeXlu(passRenderer, SceneGraphTag.Normal);
        // executeDrawListXlu()
        this.drawXlu(passRenderer, 0x18);

        // execute(0x26)
        // execute(0x47) -- ParticleDrawExecutor / draw3D
        this.drawEffect(passRenderer, DrawOrder.DRW_3D);
        // execute(0x4c) -- ParticleDrawExecutor / drawForBloomEffect (???)
        // execute(0x2f)

        // This execute directs to CaptureScreenActor, which ends up taking the indirect screen capture.
        // So, end our pass here and do indirect.
        // execute(0x2d)
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
        this.drawLegacyNodeOpa(passRenderer, SceneGraphTag.Indirect);
        this.execute(passRenderer, DrawType.OCEAN_BOWL);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_PLANET);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_MAP_OBJ);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_MAP_OBJ_STRONG_LIGHT);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_NPC);
        this.drawXlu(passRenderer, DrawBufferType.INDIRECT_ENEMY);
        this.drawXlu(passRenderer, 0x22);
        this.drawXlu(passRenderer, 0x17);
        this.drawXlu(passRenderer, 0x16);
        this.drawLegacyNodeXlu(passRenderer, SceneGraphTag.Indirect);
        this.drawEffect(passRenderer, DrawOrder.DRW_AFTER_INDIRECT);

        // executeDrawImageEffect()
        if (this.isNormalBloomOn()) {
            // Make bloomables visible.
            const renderInstManager = this.renderHelper.renderInstManager;
            const bloomOpa = createFilterKeyForDrawBufferType(OpaXlu.OPA, DrawBufferType.BLOOM_MODEL);
            const bloomXlu = createFilterKeyForDrawBufferType(OpaXlu.XLU, DrawBufferType.BLOOM_MODEL);

            for (let i = 0; i < renderInstManager.instPool.allocCount; i++) {
                const k = renderInstManager.instPool.pool[i];
                k.setVisible(k.filterKey === bloomOpa || k.filterKey === bloomXlu);

            }
            passRenderer = this.bloomRenderer.render(device, this.renderHelper.renderInstManager, this.mainRenderTarget, viewerInput, template, bloomParameterBufferOffs);
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        view.setUint8(offs++, this.currentScenarioIndex);
        return offs;
    }

    public deserializeSaveState(dst: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(dst);
        if (offs < byteLength)
            this.setCurrentScenario(view.getUint8(offs++));
        return offs;
    }

    public destroy(device: GfxDevice): void {
        this.spawner.destroy(device);

        this.mainRenderTarget.destroy(device);
        this.sceneTexture.destroy(device);
        this.bloomRenderer.destroy(device);
        this.renderHelper.destroy(device);
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
    isMapPart: boolean;
    objArg0: number;
    objArg1: number;
    objArg2: number;
    objArg3: number;
    moveConditionType: number;
    rotateSpeed: number;
    rotateAxis: number;
    rotateAccelType: number;
    modelMatrix: mat4;
    path: Path;
}

export interface WorldmapPointInfo {
    pointId: number;
    miniatureName: string | null;
    miniatureScale: number;
    miniatureOffset: vec3;
    miniatureType: string;
    isPink: boolean;
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
    let offs = loadedVertexLayout.dstVertexAttributeLayouts.find((attrib) => attrib.vtxAttrib === GX.VertexAttribute.PNMTXIDX).bufferOffset;
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
    public archiveProgressableCache = new Map<string, Progressable<RARC.RARC | null>>();
    public archiveCache = new Map<string, RARC.RARC | null>();
    public modelCache = new Map<string, BMDModel | null>();
    private models: BMDModel[] = [];
    private destroyed: boolean = false;

    constructor(public device: GfxDevice, public cache: GfxRenderCache, private pathBase: string, private abortSignal: AbortSignal) {
    }

    public waitForLoad(): Progressable<any> {
        const v: Progressable<any>[] = [... this.archiveProgressableCache.values()];
        return Progressable.all(v);
    }

    public getModel(archivePath: string, modelFilename: string): Progressable<BMDModel | null> {
        if (this.modelCache.has(modelFilename))
            return Progressable.resolve(this.modelCache.get(modelFilename));

        const p = this.requestArchiveData(archivePath).then((rarc: RARC.RARC) => {
            if (rarc === null)
                return null;
            if (this.destroyed)
                throw new AbortedError();
            return this.getModel2(rarc, modelFilename);
        });

        return p;
    }

    public getModel2(rarc: RARC.RARC, modelFilename: string): BMDModel | null {
        if (this.modelCache.has(modelFilename))
            return this.modelCache.get(modelFilename);

        const bmd = BMD.parse(assertExists(rarc.findFileData(modelFilename)));
        patchBMD(bmd);
        const bmdModel = new BMDModel(this.device, this.cache, bmd, null);
        patchBMDModel(bmdModel);
        this.models.push(bmdModel);
        this.modelCache.set(modelFilename, bmdModel);
        return bmdModel;
    }

    public requestArchiveData(archivePath: string): Progressable<RARC.RARC | null> {
        if (this.archiveProgressableCache.has(archivePath))
            return this.archiveProgressableCache.get(archivePath);

        const p = fetchData(`${this.pathBase}/${archivePath}`, this.abortSignal).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0) {
                console.warn(`Could not fetch archive ${archivePath}`);
                return null;
            }
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            const rarc = buffer !== null ? RARC.parse(buffer) : null;
            this.archiveCache.set(archivePath, rarc);
            return rarc;
        });

        this.archiveProgressableCache.set(archivePath, p);
        return p;
    }

    public isArchiveExist(archivePath: string): boolean {
        return this.archiveCache.has(archivePath) && this.archiveCache.get(archivePath) !== null;
    }

    public getArchive(archivePath: string): RARC.RARC | null {
        return assertExists(this.archiveCache.get(archivePath));
    }

    public requestObjectData(objectName: string): void {
        this.requestArchiveData(`ObjectData/${objectName}.arc`);
    }

    public isObjectDataExist(objectName: string): boolean {
        return this.isArchiveExist(`ObjectData/${objectName}.arc`);
    }

    public getObjectData(objectName: string): RARC.RARC | null {
        return this.getArchive(`ObjectData/${objectName}.arc`);
    }

    public destroy(device: GfxDevice): void {
        this.destroyed = true;
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
    }
}

class ActorAnimDataInfo {
    public Name: string;
    public StartFrame: number;
    public IsKeepAnim: boolean;

    constructor(infoIter: JMapInfoIter, animType: string) {
        this.Name = infoIter.getValueString(`${animType}Name`);
        this.StartFrame = infoIter.getValueNumber(`${animType}StartFrame`);
        this.IsKeepAnim = !!infoIter.getValueNumber(`${animType}IsKeepAnim`);
    }
}

function getAnimName(keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): string {
    if (dataInfo.Name)
        return dataInfo.Name;
    else
        return keeperInfo.ActorAnimName;
}

class ActorAnimKeeperInfo {
    public ActorAnimName: string;
    public Bck: ActorAnimDataInfo;
    public Btk: ActorAnimDataInfo;
    public Brk: ActorAnimDataInfo;
    public Bpk: ActorAnimDataInfo;
    public Btp: ActorAnimDataInfo;
    public Bva: ActorAnimDataInfo;

    constructor(infoIter: JMapInfoIter) {
        this.ActorAnimName = infoIter.getValueString('ActorAnimName').toLowerCase();
        this.Bck = new ActorAnimDataInfo(infoIter, 'Bck');
        this.Btk = new ActorAnimDataInfo(infoIter, 'Btk');
        this.Brk = new ActorAnimDataInfo(infoIter, 'Brk');
        this.Bpk = new ActorAnimDataInfo(infoIter, 'Bpk');
        this.Btp = new ActorAnimDataInfo(infoIter, 'Btp');
        this.Bva = new ActorAnimDataInfo(infoIter, 'Bva');
    }
}

export function startBckIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): boolean {
    const data = arc.findFileData(`${animationName}.bck`);
    if (data !== null) {
        const bck = BCK.parse(data);
        bck.ank1.loopMode = LoopMode.REPEAT;
        modelInstance.bindANK1(bck.ank1);
    }
    return data !== null;
}

export function startBtkIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): boolean {
    const data = arc.findFileData(`${animationName}.btk`);
    if (data !== null)
        modelInstance.bindTTK1(BTK.parse(data).ttk1);
    return data !== null;
}

export function startBrkIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): boolean {
    const data = arc.findFileData(`${animationName}.brk`);
    if (data !== null)
        modelInstance.bindTRK1(BRK.parse(data).trk1);
    return data !== null;
}

export function startBpkIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): boolean {
    const data = arc.findFileData(`${animationName}.bpk`);
    if (data !== null)
        modelInstance.bindTRK1(BPK.parse(data).pak1);
    return data !== null;
}

export function startBtpIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): boolean {
    const data = arc.findFileData(`${animationName}.btp`);
    if (data !== null)
        modelInstance.bindTPT1(BTP.parse(data).tpt1);
    return data !== null;
}

export function startBvaIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): boolean {
    const data = arc.findFileData(`${animationName}.bva`);
    if (data !== null)
        modelInstance.bindVAF1(BVA.parse(data).vaf1);
    return data !== null;
}

export function startBck(actor: LiveActor, animName: string): boolean {
    const played = startBckIfExist(actor.modelInstance, actor.arc, animName);
    if (played && actor.effectKeeper !== null)
        actor.effectKeeper.changeBck(animName);
    return played;
}

class ActorAnimKeeper {
    public keeperInfo: ActorAnimKeeperInfo[] = [];

    constructor(infoIter: JMapInfoIter) {
        for (let i = 0; i < infoIter.getNumRecords(); i++) {
            infoIter.setRecord(i);
            this.keeperInfo.push(new ActorAnimKeeperInfo(infoIter));
        }
    }

    public static tryCreate(actor: LiveActor): ActorAnimKeeper | null {
        let bcsv = actor.arc.findFileData('ActorAnimCtrl.bcsv');

        // Super Mario Galaxy 2 puts these assets in a subfolder.
        if (bcsv === null)
            bcsv = actor.arc.findFileData('ActorInfo/ActorAnimCtrl.bcsv');

        if (bcsv === null)
            return null;

        const infoIter = createCsvParser(bcsv);
        return new ActorAnimKeeper(infoIter);
    }

    public start(actor: LiveActor, animationName: string): boolean {
        animationName = animationName.toLowerCase();
        const keeperInfo = this.keeperInfo.find((info) => info.ActorAnimName === animationName);
        if (keeperInfo === undefined)
            return false;

        // TODO(jstpierre): Separate animation controllers for each player.
        this.setBckAnimation(actor, keeperInfo, keeperInfo.Bck);
        this.setBtkAnimation(actor, keeperInfo, keeperInfo.Btk);
        this.setBrkAnimation(actor, keeperInfo, keeperInfo.Brk);
        this.setBpkAnimation(actor, keeperInfo, keeperInfo.Bpk);
        this.setBtpAnimation(actor, keeperInfo, keeperInfo.Btp);
        this.setBvaAnimation(actor, keeperInfo, keeperInfo.Bva);
        return true;
    }

    private setBckAnimation(actor: LiveActor, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBck(actor, getAnimName(keeperInfo, dataInfo));
    }

    private setBtkAnimation(actor: LiveActor, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBtkIfExist(actor.modelInstance, actor.arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBrkAnimation(actor: LiveActor, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBrkIfExist(actor.modelInstance, actor.arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBpkAnimation(actor: LiveActor, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBpkIfExist(actor.modelInstance, actor.arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBtpAnimation(actor: LiveActor, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBtpIfExist(actor.modelInstance, actor.arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBvaAnimation(actor: LiveActor, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBvaIfExist(actor.modelInstance, actor.arc, getAnimName(keeperInfo, dataInfo));
    }
}

class ScenarioData {
    public zoneNames: string[];
    public scenarioDataIter: JMapInfoIter;

    constructor(private scenarioArc: RARC.RARC) {
        const zoneListIter = createCsvParser(scenarioArc.findFileData('ZoneList.bcsv'));
        this.zoneNames = zoneListIter.mapRecords((iter) => {
            return iter.getValueString(`ZoneName`);
        });

        this.scenarioDataIter = createCsvParser(scenarioArc.findFileData('ScenarioData.bcsv'));
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

export class SceneObjHolder {
    public sceneDesc: SMGSceneDescBase;
    public modelCache: ModelCache;

    public scenarioData: ScenarioData;
    public planetMapCreator: PlanetMapCreator;
    public lightDataHolder: LightDataHolder;
    public npcDirector: NPCDirector;
    public stageDataHolder: StageDataHolder;
    public effectSystem: EffectSystem | null;
    public messageDataHolder: MessageDataHolder | null;
    public captureSceneDirector: CaptureSceneDirector;

    // This is technically stored outside the SceneObjHolder, separately
    // on the same singleton, but c'est la vie...
    public sceneNameObjListExecutor: SceneNameObjListExecutor;

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device);

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
    return infoIter.getValueString(`name`);
}

export function getJMapInfoTrans(dst: vec3, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    getJMapInfoTransLocal(dst, infoIter);
    const stageDataHolder = sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter);
    vec3.transformMat4(dst, dst, stageDataHolder.placementMtx);
}

function matrixExtractEulerAngleRotation(dst: vec3, m: mat4): void {
    // In SMG, this appears inline in getJMapInfoRotate. It appears to be a simplified form of
    // "Euler Angle Conversion", Ken Shoemake, Graphics Gems IV. http://www.gregslabaugh.net/publications/euler.pdf

    if (m[2] - 1.0 < -0.0001) {
        if (m[2] + 1.0 > 0.0001) {
            dst[0] = Math.atan2(m[6], m[10]);
            dst[1] = -Math.asin(m[2]);
            dst[2] = Math.atan2(m[1], m[0]);
        } else {
            dst[0] = Math.atan2(m[4], m[8]);
            dst[1] = Math.PI / 2;
            dst[2] = 0.0;
        }
    } else {
        dst[0] = -Math.atan2(-m[4], -m[8]);
        dst[1] = -Math.PI / 2;
        dst[2] = 0.0;
    }
}

const scratchMatrix = mat4.create();
function getJMapInfoRotate(dst: vec3, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, scratch: mat4 = scratchMatrix): void {
    getJMapInfoRotateLocal(dst, infoIter);

    // Compute local rotation matrix, combine with stage placement, and extract new rotation.
    computeModelMatrixSRT(scratch, 1, 1, 1, dst[0], dst[1], dst[2], 0, 0, 0);
    const stageDataHolder = sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter);
    mat4.mul(scratch, stageDataHolder.placementMtx, scratch);

    matrixExtractEulerAngleRotation(dst, scratch);
}

export class LiveActor extends NameObj implements ObjectBase {
    public visibleScenario: boolean = true;
    public visibleAlive: boolean = true;
    public visibleModel: boolean = true;
    public boundingSphereRadius: number | null = null;

    public actorAnimKeeper: ActorAnimKeeper | null = null;
    public actorLightCtrl: ActorLightCtrl | null = null;
    public effectKeeper: EffectKeeper | null = null;
    public spine: Spine | null = null;

    // Technically part of ModelManager.
    public arc: RARC.RARC; // ResourceHolder
    public modelInstance: BMDModelInstance | null = null; // J3DModel

    public translation = vec3.create();
    public rotation = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);
    public velocity = vec3.create();

    constructor(public zoneAndLayer: ZoneAndLayer, public name: string) {
        super(name);
    }

    public makeActorAppeared(): void {
        this.visibleAlive = true;
    }

    public makeActorDead(): void {
        this.visibleAlive = false;
    }

    public setIndirectTextureOverride(sceneTexture: GfxTexture): void {
        setIndirectTextureOverride(this.modelInstance, sceneTexture);
    }

    public getBaseMtx(): mat4 | null {
        if (this.modelInstance === null)
            return null;
        return this.modelInstance.modelMatrix;
    }

    public getJointMtx(jointName: string): mat4 | null {
        if (this.modelInstance === null)
            return null;
        return this.modelInstance.getJointToWorldMatrixReference(jointName);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const modelCache = sceneObjHolder.modelCache;

        // By default, we request the object's name.
        const objName = getObjectName(infoIter);
        modelCache.requestObjectData(objName);
    }

    public initModelManagerWithAnm(sceneObjHolder: SceneObjHolder, objName: string): void {
        const modelCache = sceneObjHolder.modelCache;

        this.arc = modelCache.getObjectData(objName);

        const bmdModel = modelCache.getModel2(this.arc, `${objName}.bdl`);
        this.modelInstance = new BMDModelInstance(bmdModel);
        this.modelInstance.name = objName;
        this.modelInstance.animationController.fps = FPS;
        this.modelInstance.animationController.phaseFrames = Math.random() * 1500;

        // Compute the joint matrices an initial time in case anything wants to rely on them...
        this.modelInstance.calcJointToWorld();

        // TODO(jstpierre): RE the whole ModelManager / XanimePlayer thing.
        // Seems like it's possible to have a secondary file for BCK animations?
        this.actorAnimKeeper = ActorAnimKeeper.tryCreate(this);
    }

    public initDefaultPos(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        getJMapInfoTrans(this.translation, sceneObjHolder, infoIter);
        getJMapInfoRotate(this.rotation, sceneObjHolder, infoIter);
        getJMapInfoScale(this.scale, infoIter);

        if (this.modelInstance !== null) {
            computeModelMatrixSRT(this.modelInstance.modelMatrix,
                1, 1, 1,
                this.rotation[0], this.rotation[1], this.rotation[2],
                this.translation[0], this.translation[1], this.translation[2]);

            vec3.copy(this.modelInstance.baseScale, this.scale);
        }
    }

    public initLightCtrl(sceneObjHolder: SceneObjHolder): void {
        this.actorLightCtrl = new ActorLightCtrl(this);
        this.actorLightCtrl.initActorLightInfo(sceneObjHolder);
        this.actorLightCtrl.setDefaultAreaLight(sceneObjHolder);
    }

    public initEffectKeeper(sceneObjHolder: SceneObjHolder, groupName: string | null): void {
        if (groupName === null && this.modelInstance !== null)
            groupName = this.modelInstance.name;
        this.effectKeeper = new EffectKeeper(sceneObjHolder, this, groupName);
    }

    public initNerve(nerve: Nerve): void {
        this.spine = new Spine();
        this.spine.setNerve(nerve);
    }

    public setNerve(nerve: Nerve): void {
        this.spine.setNerve(nerve);
    }

    public getCurrentNerve(): Nerve {
        return this.spine.getCurrentNerve();
    }

    public getNerveStep(): number {
        return this.spine.getNerveStep();
    }

    public startAction(animationName: string): void {
        if (this.actorAnimKeeper === null || !this.actorAnimKeeper.start(this, animationName))
            this.tryStartAllAnim(animationName);
    }

    public tryStartAllAnim(animationName: string): boolean {
        let anyPlayed = false;
        anyPlayed = startBck(this, animationName) || anyPlayed;
        anyPlayed = startBtkIfExist(this.modelInstance, this.arc, animationName) || anyPlayed;
        anyPlayed = startBrkIfExist(this.modelInstance, this.arc, animationName) || anyPlayed;
        anyPlayed = startBpkIfExist(this.modelInstance, this.arc, animationName) || anyPlayed;
        anyPlayed = startBtpIfExist(this.modelInstance, this.arc, animationName) || anyPlayed;
        anyPlayed = startBvaIfExist(this.modelInstance, this.arc, animationName) || anyPlayed;
        return anyPlayed;
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        computeModelMatrixSRT(this.modelInstance.modelMatrix,
            1, 1, 1,
            this.rotation[0], this.rotation[1], this.rotation[2],
            this.translation[0], this.translation[1], this.translation[2]);
    }

    protected getActorVisible(camera: Camera): boolean {
        if (this.visibleScenario && this.visibleAlive) {
            if (this.boundingSphereRadius !== null)
                return camera.frustum.containsSphere(this.translation, this.boundingSphereRadius);
            else
                return true;
        } else {
            return false;
        }
    }

    public draw(sceneObjHolder: SceneObjHolder, renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.modelInstance === null)
            return;

        // calcAnmMtx
        vec3.copy(this.modelInstance.baseScale, this.scale);
        this.calcAndSetBaseMtx(viewerInput);

        this.modelInstance.animationController.setTimeFromViewerInput(viewerInput);
        this.modelInstance.calcAnim(viewerInput.camera);

        const visible = this.getActorVisible(viewerInput.camera) && this.visibleModel;
        this.modelInstance.visible = visible;
        if (!visible)
            return;

        if (this.actorLightCtrl !== null) {
            const lightInfo = this.actorLightCtrl.getActorLight();
            if (lightInfo !== null) {
                // Load the light.
                lightInfo.setOnModelInstance(this.modelInstance, viewerInput.camera, true);
            }
        } else {
            // TODO(jstpierre): Move this to the LightDirector?
            const areaLightInfo = sceneObjHolder.lightDataHolder.findDefaultAreaLight(sceneObjHolder);
            const lightType = sceneObjHolder.sceneNameObjListExecutor.findLightType(this);
            if (lightType !== LightType.None) {
                const lightInfo = areaLightInfo.getActorLightInfo(lightType);

                // The reason we don't setAmbient here is a bit funky -- normally how this works
                // is that the J3DModel's DLs will set up the ambient, but when an actor has its
                // own ActorLightCtrl, through a long series of convoluted of actions, the
                // DrawBufferExecutor associated with that actor will stomp on the actor's ambient light
                // configuration. Without this, we're left with the DrawBufferGroup's light configuration,
                // and the actor's DL will override the ambient light there...
                // Rather than emulate the whole DrawBufferGroup system, quirks and all, just hardcode
                // this logic.
                lightInfo.setOnModelInstance(this.modelInstance, viewerInput.camera, false);
            }
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.spine !== null) {
            this.spine.update(getDeltaTimeFrames(viewerInput));
        }

        // updateBinder
        vec3.scaleAndAdd(this.translation, this.translation, this.velocity, getDeltaTimeFrames(viewerInput));

        if (this.effectKeeper !== null) {
            this.effectKeeper.updateSyncBckEffect(sceneObjHolder.effectSystem);
            this.effectKeeper.followSRT();
            this.effectKeeper.setVisibleScenario(this.visibleAlive && this.visibleScenario);
        }
    }
}

import { NPCDirector, MiniRoutePoint, createModelObjMapObj, PeachCastleGardenPlanet, PlanetMap } from './Actors';
import { getActorNameObjFactory } from './ActorTable';
import { executeOnPass } from '../../gfx/render/GfxRenderer2';

function layerVisible(layer: LayerId, layerMask: number): boolean {
    if (layer >= 0)
        return !!(layerMask & (1 << layer));
    else
        return true;
}

class ZoneNode {
    public name: string;

    public objects: ObjectBase[] = [];

    // The current layer mask for objects and sub-zones in this zone.
    public layerMask: number = 0xFFFFFFFF;
    // Whether the layer of our parent zone is visible.
    public visible: boolean = true;
    public subzones: ZoneNode[] = [];

    public areaObjInfo: ObjInfo[] = [];

    constructor(public stageDataHolder: StageDataHolder) {
        this.name = stageDataHolder.zoneName;

        stageDataHolder.iterAreas((infoIter, layerId) => {
            this.areaObjInfo.push(stageDataHolder.legacyCreateObjinfo(infoIter, [], false));
        });
    }

    public computeObjectVisibility(): void {
        for (let i = 0; i < this.subzones.length; i++)
            this.subzones[i].visible = this.visible && layerVisible(this.subzones[i].stageDataHolder.layerId, this.layerMask);
    }
}

export interface NameObjFactory {
    new(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): ObjectBase;
    requestArchives?(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void;
}

export interface ZoneAndLayer {
    zoneId: number;
    layerId: LayerId;
}

class SMGSpawner {
    public sceneGraph = new SceneGraph();
    public zones: ZoneNode[] = [];
    // BackLight
    private isSMG1 = false;
    private isSMG2 = false;
    private isWorldMap = false;

    constructor(private galaxyName: string, pathBase: string, private sceneObjHolder: SceneObjHolder) {
        this.isSMG1 = pathBase === 'j3d/smg';
        this.isSMG2 = pathBase === 'j3d/smg2';
        this.isWorldMap = this.isSMG2 && galaxyName.startsWith('WorldMap');
    }

    public applyAnimations(node: Node, rarc: RARC.RARC, animOptions?: AnimOptions): void {
        const modelInstance = node.modelInstance;

        let bckFile: RARC.RARCFile | null = null;
        let brkFile: RARC.RARCFile | null = null;
        let btkFile: RARC.RARCFile | null = null;

        if (animOptions !== null) {
            if (animOptions !== undefined) {
                bckFile = animOptions.bck ? rarc.findFile(animOptions.bck) : null;
                brkFile = animOptions.brk ? rarc.findFile(animOptions.brk) : null;
                btkFile = animOptions.btk ? rarc.findFile(animOptions.btk) : null;
            } else {
                // Look for "wait" animation first, then fall back to the first animation.
                bckFile = rarc.findFile('wait.bck');
                brkFile = rarc.findFile('wait.brk');
                btkFile = rarc.findFile('wait.btk');
                if (!(bckFile || brkFile || btkFile)) {
                    bckFile = rarc.files.find((file) => file.name.endsWith('.bck')) || null;
                    brkFile = rarc.files.find((file) => file.name.endsWith('.brk') && file.name.toLowerCase() !== 'colorchange.brk') || null;
                    btkFile = rarc.files.find((file) => file.name.endsWith('.btk') && file.name.toLowerCase() !== 'texchange.btk') || null;
                }
            }
        }

        if (btkFile !== null) {
            const btk = BTK.parse(btkFile.buffer);
            modelInstance.bindTTK1(btk.ttk1);
        }

        if (brkFile !== null) {
            const brk = BRK.parse(brkFile.buffer);
            modelInstance.bindTRK1(brk.trk1);
        }

        if (bckFile !== null) {
            const bck = BCK.parse(bckFile.buffer);
            // XXX(jstpierre): Some wait.bck animations are set to ONCE instead of REPEAT (e.g. Kinopio/Toad in SMG2)
            if (bckFile.name === 'wait.bck')
                bck.ank1.loopMode = LoopMode.REPEAT;
            modelInstance.bindANK1(bck.ank1);

            // Apply a random phase to the animation.
            modelInstance.animationController.phaseFrames += Math.random() * bck.ank1.duration;
        }
    }

    public bindChangeAnimation(node: Node, rarc: RARC.RARC, frame: number): void {
        const brkFile = rarc.findFile('colorchange.brk');
        const btkFile = rarc.findFile('texchange.btk');

        const animationController = new AnimationController();
        animationController.setTimeInFrames(frame);

        if (brkFile) {
            const brk = BRK.parse(brkFile.buffer);
            node.modelInstance.bindTRK1(brk.trk1, animationController);
        }

        if (btkFile) {
            const btk = BTK.parse(btkFile.buffer);
            node.modelInstance.bindTTK1(btk.ttk1, animationController);
        }
    }

    private hasIndirectTexture(bmdModel: BMDModel): boolean {
        const tex1Samplers = bmdModel.bmd.tex1.samplers;
        for (let i = 0; i < tex1Samplers.length; i++)
            if (tex1Samplers[i].name === 'IndDummy')
                return true;
        return false;
    }

    private getNameObjFactory(objName: string): NameObjFactory | null {
        const actorFactory = getActorNameObjFactory(objName);
        if (actorFactory !== null)
            return actorFactory;

        const planetFactory = this.sceneObjHolder.planetMapCreator.getNameObjFactory(objName);
        if (planetFactory !== null)
            return planetFactory;

        return null;
    }

    public spawnObjectLegacy(zone: ZoneNode, zoneAndLayer: ZoneAndLayer, objinfo: ObjInfo): void {
        const modelMatrixBase = zone.stageDataHolder.placementMtx;
        const modelCache = this.sceneObjHolder.modelCache;

        const areaLightInfo = this.sceneObjHolder.lightDataHolder.findDefaultAreaLight(this.sceneObjHolder);

        const connectObject = (node: Node): void => {
            zone.objects.push(node);
            this.sceneGraph.addNode(node);
        };

        const spawnGraph = (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined) => {
            const arcPath = `ObjectData/${arcName}.arc`;
            const modelFilename = `${arcName}.bdl`;

            return modelCache.getModel(arcPath, modelFilename).then((bmdModel): [Node, RARC.RARC] => {
                // If this is a 404, then return null.
                if (bmdModel === null)
                    return null;

                if (this.hasIndirectTexture(bmdModel))
                    tag = SceneGraphTag.Indirect;

                // Trickery.
                const rarc = modelCache.archiveCache.get(arcPath);

                const modelInstance = new BMDModelInstance(bmdModel);
                modelInstance.animationController.fps = FPS;
                modelInstance.name = `${objinfo.objName} ${objinfo.objId}`;

                if (tag === SceneGraphTag.Skybox) {
                    mat4.scale(objinfo.modelMatrix, objinfo.modelMatrix, [.5, .5, .5]);

                    // Kill translation. Need to figure out how the game does skyboxes.
                    objinfo.modelMatrix[12] = 0;
                    objinfo.modelMatrix[13] = 0;
                    objinfo.modelMatrix[14] = 0;

                    modelInstance.isSkybox = true;
                }

                const node = new Node(tag, arcName, zoneAndLayer, objinfo, modelInstance, modelMatrixBase, modelInstance.animationController);

                // TODO(jstpierre): Parse out the proper area info.
                node.setAreaLightInfo(areaLightInfo);

                this.applyAnimations(node, rarc, animOptions);

                connectObject(node);

                return [node, rarc];
            });
        };

        const spawnDefault = (name: string): void => {
            spawnGraph(name, SceneGraphTag.Normal);
        };

        const name = objinfo.objName;
        switch (objinfo.objName) {
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
                this.bindChangeAnimation(node, rarc, objinfo.objArg1);
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
                this.bindChangeAnimation(node, rarc, objinfo.objArg0);
            });
            break;
        case 'TicoShop':
            spawnGraph(`TicoShop`).then(([node, rarc]) => {
                startBvaIfExist(node.modelInstance, rarc, 'Small0');
            });
            break;

        case 'SweetsDecoratePartsFork':
        case 'SweetsDecoratePartsSpoon':
            spawnGraph(name, SceneGraphTag.Normal, null).then(([node, rarc]) => {
                this.bindChangeAnimation(node, rarc, objinfo.objArg1);
            });
            break;

        case 'OtaKing':
            spawnGraph('OtaKing');
            spawnGraph('OtaKingMagma');
            spawnGraph('OtaKingMagmaBloom', SceneGraphTag.Bloom);
            break;

        case 'UFOKinoko':
            spawnGraph(name, SceneGraphTag.Normal, null).then(([node, rarc]) => {
                this.bindChangeAnimation(node, rarc, objinfo.objArg0);
            });
            break;
        case 'PlantA':
            spawnGraph(`PlantA00`);
            break;
        case 'PlantB':
            spawnGraph(`PlantB00`);
            break;
        case 'PlantC':
            spawnGraph(`PlantC00`);
            break;
        case 'PlantD':
            spawnGraph(`PlantD01`);
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
            spawnGraph(`PowerStar`, SceneGraphTag.Normal, { bck: null }).then(([node, rarc]) => {
                if (this.isSMG1) {
                    // This appears to be hardcoded in the DOL itself, inside "GameEventFlagTable".
                    const isRedStar = this.galaxyName === 'HeavensDoorGalaxy' && node.objinfo.objArg0 === 2;
                    // This is also hardcoded, but the designers left us a clue.
                    const isGreenStar = name === 'GreenStar';
                    const frame = isRedStar ? 5 : isGreenStar ? 2 : 0;

                    const animationController = new AnimationController();
                    animationController.setTimeInFrames(frame);

                    const btp = BTP.parse(rarc.findFileData(`powerstar.btp`));
                    node.modelInstance.bindTPT1(btp.tpt1, animationController);
                }else{
                    const frame = name === 'GreenStar' ? 2 : 0;

                    const animationController = new AnimationController();
                    animationController.setTimeInFrames(frame);

                    const btp = BTP.parse(rarc.findFileData(`PowerStarColor.btp`));
                    node.modelInstance.bindTPT1(btp.tpt1, animationController);
                }

                node.modelInstance.setMaterialVisible('Empty', false);

                node.setRotateSpeed(140);
            });
            return;

        case 'GrandStar':
            spawnGraph(name).then(([node, rarc]) => {
                // Stars in cages are rotated by BreakableCage at a hardcoded '3.0'.
                // See BreakableCage::exeWait.
                node.modelInstance.setMaterialVisible('GrandStarEmpty', false);
                node.setRotateSpeed(3);
            });
            return;

        // SMG2
        case 'Moc':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'turn.bck' }).then(([node, rarc]) => {
                const bva = BVA.parse(rarc.findFileData(`FaceA.bva`));
                node.modelInstance.bindVAF1(bva.vaf1);
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
                node.modelInstance.setMaterialVisible('TicoCoinEmpty_v', false);
            });
            break;
        case 'WanwanRolling':
            spawnGraph(name, SceneGraphTag.Normal, { bck: null });
            break;
        default:
            spawnDefault(name);
            break;
        }
    }

    private placeStageData(stageDataHolder: StageDataHolder): ZoneNode {
        const zoneNode = new ZoneNode(stageDataHolder);
        this.zones[stageDataHolder.zoneId] = zoneNode;

        const legacyPaths = stageDataHolder.legacyParsePaths();

        stageDataHolder.iterPlacement((infoIter, layerId, isMapPart) => {
            const factory = this.getNameObjFactory(getObjectName(infoIter));
            const zoneAndLayer: ZoneAndLayer = { zoneId: stageDataHolder.zoneId, layerId };
            if (factory !== null) {
                const nameObj = new factory(zoneAndLayer, this.sceneObjHolder, infoIter);
                zoneNode.objects.push(nameObj);
            } else {
                const objInfoLegacy = stageDataHolder.legacyCreateObjinfo(infoIter, legacyPaths, isMapPart);
                // Fall back to legacy spawn.
                this.spawnObjectLegacy(zoneNode, zoneAndLayer, objInfoLegacy);
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

        if (this.isWorldMap)
            this.placeWorldMap();
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

        const worldMapRarc = this.sceneObjHolder.modelCache.getObjectData(this.galaxyName.substr(0, 10));
        const worldMapGalaxyData = createCsvParser(worldMapRarc.findFileData('ActorInfo/Galaxy.bcsv'));
        worldMapGalaxyData.mapRecords((jmp) => {
            modelCache.requestObjectData(jmp.getValueString('MiniatureName'));
        })
    }

    public placeWorldMap(): void {
        const points : WorldmapPointInfo[] = [];
        const worldMapRarc = this.sceneObjHolder.modelCache.getObjectData(this.galaxyName.substr(0, 10));
        const worldMapPointData = createCsvParser(worldMapRarc.findFileData('ActorInfo/PointPos.bcsv'));
        const worldMapLinkData = createCsvParser(worldMapRarc.findFileData('ActorInfo/PointLink.bcsv'));

        worldMapPointData.mapRecords((jmp) => {
            const position = vec3.fromValues(
                jmp.getValueNumber('PointPosX'),
                jmp.getValueNumber('PointPosY'),
                jmp.getValueNumber('PointPosZ'));

            points.push({
                miniatureName: null,
                miniatureScale: 1,
                miniatureOffset: vec3.create(),
                miniatureType: '',
                pointId: jmp.getValueNumber('Index'),
                isPink: jmp.getValueString('ColorChange') == 'o',
                position: position
            });
        });

        const worldMapGalaxyData = createCsvParser(worldMapRarc.findFileData('ActorInfo/Galaxy.bcsv'));

        worldMapGalaxyData.mapRecords((jmp) => {
            const index = jmp.getValueNumber('PointPosIndex');
            points[index].miniatureName = jmp.getValueString('MiniatureName');
            points[index].miniatureType = jmp.getValueString('StageType');
            points[index].miniatureScale = jmp.getValueNumber('ScaleMin');
            points[index].miniatureOffset = vec3.fromValues(
                jmp.getValueNumber('PosOffsetX'),
                jmp.getValueNumber('PosOffsetY'),
                jmp.getValueNumber('PosOffsetZ'));
        });

        // Spawn everything in Zone 0.
        // TODO(jstpierre): Maybe not have a Zone for these objects? Not sure...
        const zoneAndLayer: ZoneAndLayer = { zoneId: 0, layerId: LayerId.COMMON };

        worldMapPointData.mapRecords((jmp, i) => {
            if (jmp.getValueString('Valid') !== 'o')
                return;

            this.spawnWorldMapObject(zoneAndLayer, points[i]);
        });

        worldMapLinkData.mapRecords((jmp) => {
            const isColorChange = jmp.getValueString('IsColorChange') === 'o';
            const pointA = points[jmp.getValueNumber('PointIndexA')];
            const pointB = points[jmp.getValueNumber('PointIndexB')];
            this.spawnWorldMapLine(zoneAndLayer, pointA, pointB, isColorChange);
        });
    }

    public spawnWorldMapObject(zoneAndLayer: ZoneAndLayer, pointInfo: WorldmapPointInfo): void {
        const zoneNode = this.zones[zoneAndLayer.zoneId];
        const nameObj = new MiniRoutePoint(zoneAndLayer, this.sceneObjHolder, pointInfo);
        zoneNode.objects.push(nameObj);
    }

    public spawnWorldMapLine(zoneAndLayer: ZoneAndLayer, point1Info: WorldmapPointInfo, point2Info: WorldmapPointInfo, isPink: Boolean): void {
        // TODO(jstpierre): Move to a LiveActor for the lines as well?

        const zoneNode = this.zones[zoneAndLayer.zoneId];

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

        const obj = createModelObjMapObj(zoneAndLayer, this.sceneObjHolder, `Link ${point1Info.pointId} to ${point2Info.pointId}`, 'MiniRouteLine', modelMatrix);
        startBvaIfExist(obj.modelInstance, obj.arc, 'Open');
        if (isPink)
            startBrkIfExist(obj.modelInstance, obj.arc, 'TicoBuild');
        else
            startBrkIfExist(obj.modelInstance, obj.arc, 'Normal');

        zoneNode.objects.push(obj);
    }

    public destroy(device: GfxDevice): void {
        this.sceneObjHolder.destroy(device);
    }
}

interface JMapInfoIter_StageDataHolder extends JMapInfoIter {
    originalStageDataHolder: StageDataHolder;
}

type LayerObjInfoCallback = (infoIter: JMapInfoIter, layerId: LayerId, isMapPart: boolean) => void;

class StageDataHolder {
    private zoneArchive: RARC.RARC;
    public localStageDataHolders: StageDataHolder[] = [];
    public placementMtx = mat4.create();

    constructor(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, scenarioData: ScenarioData, public zoneName: string, public zoneId: number, public layerId: LayerId = -1) {
        this.zoneArchive = sceneDesc.getZoneMapArchive(modelCache, zoneName);
        this.createLocalStageDataHolder(sceneDesc, modelCache, scenarioData);
    }

    private createCsvParser(buffer: ArrayBufferSlice): JMapInfoIter {
        const iter = createCsvParser(buffer);
        (iter as JMapInfoIter_StageDataHolder).originalStageDataHolder = this;
        return iter;
    }

    public legacyCreateObjinfo(infoIter: JMapInfoIter, paths: Path[], isMapPart: boolean): ObjInfo {
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

        return { objId, objName, isMapPart, objArg0, objArg1, objArg2, objArg3, moveConditionType, rotateSpeed, rotateAccelType, rotateAxis, modelMatrix, path };
    }

    public legacyParsePaths(): Path[] {
        const pathDir = this.zoneArchive.findDir('jmp/path');

        const commonPathInfo = BCSV.parse(RARC.findFileDataInDir(pathDir, 'commonpathinfo'));
        return commonPathInfo.records.map((record, i): Path => {
            const l_id = BCSV.getField<number>(commonPathInfo, record, 'l_id');
            const no = BCSV.getField<number>(commonPathInfo, record, 'no');
            assert(no === i);
            const name = BCSV.getField<string>(commonPathInfo, record, 'name');
            const type = BCSV.getField<string>(commonPathInfo, record, 'type');
            const closed = BCSV.getField<string>(commonPathInfo, record, 'closed', 'OPEN');
            const path_arg0 = BCSV.getField<string>(commonPathInfo, record, 'path_arg0');
            const path_arg1 = BCSV.getField<string>(commonPathInfo, record, 'path_arg1');
            const pointinfo = BCSV.parse(RARC.findFileDataInDir(pathDir, `commonpathpointinfo.${i}`));
            const points = pointinfo.records.map((record, i) => {
                const id = BCSV.getField<number>(pointinfo, record, 'id');
                assert(id === i);
                const pnt0_x = BCSV.getField<number>(pointinfo, record, 'pnt0_x');
                const pnt0_y = BCSV.getField<number>(pointinfo, record, 'pnt0_y');
                const pnt0_z = BCSV.getField<number>(pointinfo, record, 'pnt0_z');
                const pnt1_x = BCSV.getField<number>(pointinfo, record, 'pnt1_x');
                const pnt1_y = BCSV.getField<number>(pointinfo, record, 'pnt1_y');
                const pnt1_z = BCSV.getField<number>(pointinfo, record, 'pnt1_z');
                const pnt2_x = BCSV.getField<number>(pointinfo, record, 'pnt2_x');
                const pnt2_y = BCSV.getField<number>(pointinfo, record, 'pnt2_y');
                const pnt2_z = BCSV.getField<number>(pointinfo, record, 'pnt2_z');
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
                this.iterLayer(i, callback, objInfo, false);

            const mapPartsInfo = this.zoneArchive.findFileData(`jmp/MapParts/${layerDirName}/MapPartsInfo`);
            if (mapPartsInfo !== null)
                this.iterLayer(i, callback, mapPartsInfo, true);
        }
    }

    public iterAreas(callback: LayerObjInfoCallback): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);

            const areaObjInfo = this.zoneArchive.findFileData(`jmp/Placement/${layerDirName}/AreaObjInfo`);
            if (areaObjInfo !== null)
                this.iterLayer(i, callback, areaObjInfo, false);
        }
    }

    private iterLayer(layerId: LayerId, callback: LayerObjInfoCallback, buffer: ArrayBufferSlice, isMapPart: boolean): void {
        const iter = this.createCsvParser(buffer);

        for (let i = 0; i < iter.getNumRecords(); i++) {
            iter.setRecord(i);
            callback(iter, layerId, isMapPart);
        }
    }

    public createLocalStageDataHolder(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, scenarioData: ScenarioData): void {
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
                const localStage = new StageDataHolder(sceneDesc, modelCache, scenarioData, zoneName, zoneId, i);
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

class PlanetMapCreator {
    public planetMapDataTable: JMapInfoIter;

    constructor(arc: RARC.RARC) {
        this.planetMapDataTable = createCsvParser(arc.findFileData('PlanetMapDataTable.bcsv'));
    }

    private setPlanetRecordFromName(objName: string): boolean {
        for (let i = 0; i < this.planetMapDataTable.getNumRecords(); i++) {
            this.planetMapDataTable.setRecord(i);
            if (this.planetMapDataTable.getValueString('PlanetName') === objName)
                return true;
        }

        return false;
    }

    public isRegisteredObj(objName: string): boolean {
        return this.setPlanetRecordFromName(objName);
    }

    public getNameObjFactory(objName: string): NameObjFactory | null {
        // Special cases.

        if (objName === 'PeachCastleGardenPlanet')
            return PeachCastleGardenPlanet;

        if (this.isRegisteredObj(objName))
            return PlanetMap;

        return null;
    }

    public requestArchive(sceneObjHolder: SceneObjHolder, objName: string): void {
        const modelCache = sceneObjHolder.modelCache;

        this.setPlanetRecordFromName(objName);

        modelCache.requestObjectData(objName);
        if (this.planetMapDataTable.getValueNumber('BloomFlag') !== 0)
            modelCache.requestObjectData(`${objName}Bloom`);
        if (this.planetMapDataTable.getValueNumber('IndirectFlag') !== 0)
            modelCache.requestObjectData(`${objName}Indirect`);
        if (this.planetMapDataTable.getValueNumber('WaterFlag') !== 0)
            modelCache.requestObjectData(`${objName}Water`);
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
        const messageIds = createCsvParser(messageArc.findFileData(`MessageId.tbl`));
        this.messageIds = messageIds.mapRecords((iter) => {
            return iter.getValueString('MessageId');
        });

        this.mesg = new BMG(messageArc.findFileData(`Message.bmg`));
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

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const renderHelper = new GXRenderHelperGfx(device);
        const gfxRenderCache = renderHelper.renderInstManager.gfxRenderCache;
        const modelCache = new ModelCache(device, gfxRenderCache, this.pathBase, abortSignal);

        const galaxyName = this.galaxyName;

        const scenarioDataFilename = `StageData/${galaxyName}/${galaxyName}Scenario.arc`;

        this.requestGlobalArchives(modelCache);
        modelCache.requestArchiveData(scenarioDataFilename);
        modelCache.requestArchiveData(`ParticleData/Effect.arc`);
        modelCache.requestArchiveData(`UsEnglish/MessageData/Message.arc`);
        modelCache.requestObjectData('PlanetMapDataTable');
        modelCache.requestObjectData('NPCData');

        const sceneObjHolder = new SceneObjHolder();

        return modelCache.waitForLoad().then(() => {
            const scenarioData = new ScenarioData(modelCache.getArchive(scenarioDataFilename));

            for (let i = 0; i < scenarioData.zoneNames.length; i++) {
                const zoneName = scenarioData.zoneNames[i];
                this.requestZoneArchives(modelCache, zoneName);
            }

            sceneObjHolder.scenarioData = scenarioData;
            return modelCache.waitForLoad();
        }).then(() => {
            sceneObjHolder.sceneDesc = this;
            sceneObjHolder.modelCache = modelCache;

            sceneObjHolder.planetMapCreator = new PlanetMapCreator(modelCache.getObjectData(`PlanetMapDataTable`));
            sceneObjHolder.npcDirector = new NPCDirector(modelCache.getObjectData(`NPCData`));
            sceneObjHolder.lightDataHolder = new LightDataHolder(this.getLightData(modelCache));
            sceneObjHolder.stageDataHolder = new StageDataHolder(this, modelCache, sceneObjHolder.scenarioData, sceneObjHolder.scenarioData.getMasterZoneFilename(), 0);
            sceneObjHolder.sceneNameObjListExecutor = new SceneNameObjListExecutor();
            sceneObjHolder.captureSceneDirector = new CaptureSceneDirector();

            if (modelCache.isArchiveExist(`ParticleData/Effect.arc`))
                sceneObjHolder.effectSystem = new EffectSystem(device, modelCache.getArchive(`ParticleData/Effect.arc`));
            else
                sceneObjHolder.effectSystem = null;

            if (modelCache.isArchiveExist(`UsEnglish/MessageData/Message.arc`))
                sceneObjHolder.messageDataHolder = new MessageDataHolder(modelCache.getArchive(`UsEnglish/MessageData/Message.arc`));
            else
                sceneObjHolder.messageDataHolder = null;

            const spawner = new SMGSpawner(galaxyName, this.pathBase, sceneObjHolder);
            spawner.requestArchives();

            return modelCache.waitForLoad().then(() => {
                spawner.place();
                return new SMGRenderer(device, renderHelper, spawner, sceneObjHolder);
            });
        });
    }
}
