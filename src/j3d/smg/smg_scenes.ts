
import { mat4, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import Progressable from '../../Progressable';
import { assert, assertExists } from '../../util';
import { fetchData, AbortedError } from '../../fetch';
import * as Viewer from '../../viewer';
import { GfxDevice, GfxRenderPass, GfxTexture } from '../../gfx/platform/GfxPlatform';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, noClearRenderPassDescriptor } from '../../gfx/helpers/RenderTargetHelpers';
import { BMD, BRK, BTK, BCK, LoopMode, BVA, BTP, BPK } from '../../j3d/j3d';
import { BMDModel, BMDModelInstance } from '../../j3d/render';
import * as RARC from '../../j3d/rarc';
import { EFB_WIDTH, EFB_HEIGHT } from '../../gx/gx_material';
import { GXRenderHelperGfx } from '../../gx/gx_render_2';
import { getPointBezier } from '../../Spline';
import AnimationController from '../../AnimationController';
import * as Yaz0 from '../../compression/Yaz0';
import * as BCSV from '../../luigis_mansion/bcsv';
import * as UI from '../../ui';
import { colorNewFromRGBA8 } from '../../Color';
import { BloomPostFXParameters, BloomPostFXRenderer } from './Bloom';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { ColorKind } from '../../gx/gx_render';
import { JMapInfoIter, getJMapInfoArg7, getJMapInfoArg2, getJMapInfoArg1, createCsvParser } from './JMapInfo';
import { AreaLightInfo, ActorLightInfo, LightDataHolder, ActorLightCtrl } from './LightData';
import { NPCDirector, NPCActorItem } from './NPCDirector';
import { MathConstants, computeModelMatrixSRT } from '../../MathHelpers';
import { NameObj, SceneNameObjListExecutor, MovementType, CalcAnimType, DrawType, DrawBufferType } from './NameObj';

const enum SceneGraphTag {
    Skybox = 'Skybox',
    Normal = 'Normal',
    Bloom = 'Bloom',
    Water = 'Water',
    Indirect = 'Indirect',
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
    layerId: LayerId;
    visible: boolean;
    setVertexColorsEnabled(v: boolean): void;
    setTexturesEnabled(v: boolean): void;
    setIndirectTextureOverride(sceneTexture: GfxTexture): void;

    // Equivalent to NameObj's draw -- calculates draw-time state (???)
    draw(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void;
}

function setIndirectTextureOverride(modelInstance: BMDModelInstance, sceneTexture: GfxTexture): void {
    const m = modelInstance.getTextureMappingReference("IndDummy");
    if (m !== null) {
        m.gfxTexture = sceneTexture;
        m.width = EFB_WIDTH;
        m.height = EFB_HEIGHT;
        m.flipY = true;
    }
}

const scratchVec3 = vec3.create();
class Node implements ObjectBase {
    public name: string = '';
    public modelMatrix = mat4.create();
    public planetRecord: BCSV.BcsvRecord | null = null;
    public visible: boolean = true;

    private modelMatrixAnimator: ModelMatrixAnimator | null = null;
    private rotateSpeed = 0;
    private rotatePhase = 0;
    private rotateAxis: RotateAxis = RotateAxis.Y;
    public areaLightInfo: AreaLightInfo;
    public areaLightConfiguration: ActorLightInfo;

    constructor(public layerId: LayerId, public objinfo: ObjInfo, private parentZone: ZoneNode, public modelInstance: BMDModelInstance, parentModelMatrix: mat4, public animationController: AnimationController) {
        this.name = modelInstance.name;
        mat4.mul(this.modelMatrix, parentModelMatrix, objinfo.modelMatrix);
        this.setupAnimations();
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
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
        } else if (objName.endsWith('Coin')) {
            this.setRotateSpeed(140);
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
        if (!this.visible)
            return;

        this.areaLightConfiguration.setOnModelInstance(this.modelInstance, viewerInput.camera);
        this.updateSpecialAnimations();

        this.modelInstance.animationController.setTimeInMilliseconds(viewerInput.time);
        this.modelInstance.calcAnim(viewerInput.camera);
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.modelInstance.drawOpa(device, renderHelper, viewerInput.camera);
        this.modelInstance.drawXlu(device, renderHelper, viewerInput.camera);
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

const enum SMGPass {
    SKYBOX = 1 << 0,
    OPAQUE = 1 << 1,
    INDIRECT = 1 << 2,
    BLOOM = 1 << 3,
}

class SMGRenderer implements Viewer.SceneGfx {
    private sceneGraph: SceneGraph;

    private bloomRenderer: BloomPostFXRenderer;
    private bloomParameters = new BloomPostFXParameters();

    private mainRenderTarget = new BasicRenderTarget();
    private opaqueSceneTexture = new ColorTexture();
    private currentScenarioIndex: number = 0;
    private scenarioSelect: UI.SingleSelect;

    public onstatechanged!: () => void;

    constructor(device: GfxDevice, private renderHelper: GXRenderHelperGfx, private spawner: SMGSpawner, private sceneObjHolder: SceneObjHolder) {
        this.sceneGraph = spawner.sceneGraph;

        this.sceneGraph.onnodeadded = () => {
            this.applyCurrentScenario();
        };

        this.bloomRenderer = new BloomPostFXRenderer(device, this.renderHelper.renderInstManager.gfxRenderCache, this.mainRenderTarget);
    }

    private applyCurrentScenario(): void {
        const scenarioData = this.sceneObjHolder.scenarioData.scenarioDataIter;

        scenarioData.setRecord(this.currentScenarioIndex);

        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zoneNode = this.spawner.zones[i];
            zoneNode.layerMask = scenarioData.getValueNumber(zoneNode.name);
        }

        this.spawner.zones[0].computeObjectVisibility();
    }

    public setCurrentScenario(index: number): void {
        if (this.currentScenarioIndex === index)
            return;

        this.currentScenarioIndex = index;
        this.scenarioSelect.setHighlighted(this.currentScenarioIndex);
        this.onstatechanged();
        this.applyCurrentScenario();
    }

    public createPanels(): UI.Panel[] {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(UI.TIME_OF_DAY_ICON, 'Scenario');

        const scenarioData = this.sceneObjHolder.scenarioData.scenarioDataIter;
        const scenarioNames = scenarioData.mapRecords((jmp) => {
            return jmp.getValueString(`ScenarioName`);
        });
        this.scenarioSelect = new UI.SingleSelect();
        this.scenarioSelect.setStrings(scenarioNames);
        this.scenarioSelect.onselectionchange = (index: number) => {
            this.setCurrentScenario(index);
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

        return [scenarioPanel, renderHacksPanel];
    }

    private findBloomArea(): ObjInfo | null {
        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zone = this.spawner.zones[i];
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

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        this.mainRenderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.opaqueSceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // TODO(jstpierre): This is a very messy combination of the legacy render path and the new render path.
        // Anything in `sceneGraph` is legacy, the new stuff uses the drawBufferHolder.
        viewerInput.camera.setClipPlanes(20, 500000);

        // First, prepare our legacy-style nodes.
        for (let i = 0; i < this.sceneGraph.nodes.length; i++) {
            const node = this.sceneGraph.nodes[i];
            node.draw(this.sceneObjHolder, viewerInput);
            // TODO(jstpierre): Remove.
            node.setIndirectTextureOverride(this.opaqueSceneTexture.gfxTexture);
        }

        // Prepare all of our NameObjs.
        this.sceneObjHolder.sceneNameObjListExecutor.executeDrawAll(this.sceneObjHolder, viewerInput);
        this.sceneObjHolder.sceneNameObjListExecutor.setIndirectTextureOverride(this.opaqueSceneTexture.gfxTexture);

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        this.renderHelper.fillSceneParams(viewerInput, template);

        // Draw our legacy nodes.
        for (let i = 0; i < this.sceneGraph.nodes.length; i++)
            this.sceneGraph.nodes[i].prepareToRender(device, this.renderHelper, viewerInput);

        // Draw our modern DrawBuffer stuff.
        this.sceneObjHolder.sceneNameObjListExecutor.drawAllBuffers(device, this.renderHelper, viewerInput.camera);

        this.prepareBloomParameters(this.bloomParameters);
        const bloomParameterBufferOffs = this.bloomRenderer.allocateParameterBuffer(renderInstManager, this.bloomParameters);
        renderInstManager.popTemplateRenderInst();

        const hostAccessPass = device.createHostAccessPass();
        this.renderHelper.prepareToRender(device, hostAccessPass);
        device.submitPass(hostAccessPass);

        const skyboxPassRenderer = this.mainRenderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.setVisibleByFilterKeyExact(SMGPass.SKYBOX);
        renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);

        const opaquePassRenderer = this.mainRenderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        opaquePassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.setVisibleByFilterKeyExact(SMGPass.OPAQUE);
        renderInstManager.drawOnPassRenderer(device, opaquePassRenderer);

        let lastPassRenderer: GfxRenderPass;

        renderInstManager.setVisibleByFilterKeyExact(SMGPass.INDIRECT);
        if (renderInstManager.hasAnyVisible()) {
            opaquePassRenderer.endPass(this.opaqueSceneTexture.gfxTexture);
            device.submitPass(opaquePassRenderer);

            const indTexPassRenderer = this.mainRenderTarget.createRenderPass(device, noClearRenderPassDescriptor);
            renderInstManager.drawOnPassRenderer(device, indTexPassRenderer);
            lastPassRenderer = indTexPassRenderer;
        } else {
            lastPassRenderer = opaquePassRenderer;
        }

        renderInstManager.setVisibleByFilterKeyExact(SMGPass.BLOOM);
        if (renderInstManager.hasAnyVisible()) {
            lastPassRenderer.endPass(null);
            device.submitPass(lastPassRenderer);

            lastPassRenderer = this.bloomRenderer.render(device, this.renderHelper.renderInstManager, this.mainRenderTarget, viewerInput, template, bloomParameterBufferOffs);
        }

        renderInstManager.resetRenderInsts();

        return lastPassRenderer;
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
        this.opaqueSceneTexture.destroy(device);
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

    // Store the original record for our new-style nodes.
    mapInfoIter: JMapInfoIter;
}

interface ZoneLayer {
    layerId: LayerId;
    objinfo: ObjInfo[];
    mappartsinfo: ObjInfo[];
    stageobjinfo: ObjInfo[];
    areaobjinfo: ObjInfo[];
}

interface Zone {
    name: string;
    layers: ZoneLayer[];
}

interface AnimOptions {
    bck?: string;
    btk?: string;
    brk?: string;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
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
        const bmdModel = new BMDModel(this.device, this.cache, bmd, null);
        this.models.push(bmdModel);
        this.modelCache.set(modelFilename, bmdModel);
        return bmdModel;
    }

    public getArchive(archivePath: string): RARC.RARC | null {
        return assertExists(this.archiveCache.get(archivePath));
    }

    public getObjectData(objectName: string): RARC.RARC | null {
        return this.getArchive(`ObjectData/${objectName}.arc`);
    }

    public requestObjectData(objectName: string): void {
        this.requestArchiveData(`ObjectData/${objectName}.arc`);
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

    public destroy(device: GfxDevice): void {
        this.destroyed = true;
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
    }
}

function bindColorChangeAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, frame: number, brkName: string = 'colorchange.brk'): void {
    const animationController = new AnimationController();
    animationController.setTimeInFrames(frame);

    const brk = BRK.parse(assertExists(arc.findFileData(brkName)));
    modelInstance.bindTRK1(brk.trk1, animationController);
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

function startBckIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): void {
    const data = arc.findFileData(`${animationName}.bck`);
    if (data !== null)
        modelInstance.bindANK1(BCK.parse(data).ank1);
}

function startBtkIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): void {
    const data = arc.findFileData(`${animationName}.btk`);
    if (data !== null)
        modelInstance.bindTTK1(BTK.parse(data).ttk1);
}

function startBrkIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): void {
    const data = arc.findFileData(`${animationName}.brk`);
    if (data !== null)
        modelInstance.bindTRK1(BRK.parse(data).trk1);
}

function startBpkIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): void {
    const data = arc.findFileData(`${animationName}.bpk`);
    if (data !== null)
        modelInstance.bindTRK1(BPK.parse(data).pak1);
}

function startBtpIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): void {
    const data = arc.findFileData(`${animationName}.btp`);
    if (data !== null)
        modelInstance.bindTPT1(BTP.parse(data).tpt1);
}

function startBvaIfExist(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): void {
    const data = arc.findFileData(`${animationName}.bva`);
    if (data !== null)
        modelInstance.bindVAF1(BVA.parse(data).vaf1);
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

    public start(modelInstance: BMDModelInstance, arc: RARC.RARC, animationName: string): boolean {
        animationName = animationName.toLowerCase();
        const keeperInfo = this.keeperInfo.find((info) => info.ActorAnimName === animationName);
        if (keeperInfo === undefined)
            return false;

        // TODO(jstpierre): Separate animation controllers for each player.
        this.setBckAnimation(modelInstance, arc, keeperInfo, keeperInfo.Bck);
        this.setBtkAnimation(modelInstance, arc, keeperInfo, keeperInfo.Btk);
        this.setBrkAnimation(modelInstance, arc, keeperInfo, keeperInfo.Brk);
        this.setBpkAnimation(modelInstance, arc, keeperInfo, keeperInfo.Bpk);
        this.setBtpAnimation(modelInstance, arc, keeperInfo, keeperInfo.Btp);
        this.setBvaAnimation(modelInstance, arc, keeperInfo, keeperInfo.Bva);
        return true;
    }

    private setBckAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBckIfExist(modelInstance, arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBtkAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBtkIfExist(modelInstance, arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBrkAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBrkIfExist(modelInstance, arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBpkAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBpkIfExist(modelInstance, arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBtpAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBtpIfExist(modelInstance, arc, getAnimName(keeperInfo, dataInfo));
    }

    private setBvaAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): void {
        startBvaIfExist(modelInstance, arc, getAnimName(keeperInfo, dataInfo));
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

export class SceneObjHolder {
    public sceneDesc: SMGSceneDescBase;
    public modelCache: ModelCache;

    public scenarioData: ScenarioData;
    public planetMapCreator: PlanetMapCreator;
    public lightDataHolder: LightDataHolder;
    public npcDirector: NPCDirector;
    public stageDataHolder: StageDataHolder;

    // This is technically stored outside the SceneObjHolder, separately
    // on the same singleton, but c'est la vie...
    public sceneNameObjListExecutor: SceneNameObjListExecutor;

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device);
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

function getObjectName(infoIter: JMapInfoIter): string {
    return infoIter.getValueString(`name`);
}

function getJMapInfoPlacementMtx(dst: mat4, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    infoIter.getSRTMatrix(dst);

    // Find the stageDataHolder for this zone...
    const stageDataHolder = sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter);
    mat4.mul(dst, stageDataHolder.placementMtx, dst);
}

export class LiveActor extends NameObj implements ObjectBase {
    public visible: boolean = true;

    public actorAnimKeeper: ActorAnimKeeper | null = null;
    public actorLightCtrl: ActorLightCtrl | null = null;

    // Technically part of ModelManager.
    public arc: RARC.RARC; // ResourceHolder
    public modelInstance: BMDModelInstance | null = null; // J3DModel

    constructor(public layerId: LayerId, public name: string) {
        super(name);
    }

    // TODO(jstpierre): Find a better solution for these.
    public setVertexColorsEnabled(v: boolean): void {
    }

    public setTexturesEnabled(v: boolean): void {
    }

    public setIndirectTextureOverride(sceneTexture: GfxTexture): void {
        setIndirectTextureOverride(this.modelInstance, sceneTexture);
    }

    public getJointMtx(jointName: string): mat4 {
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
        // TODO(jstpierre): Use connectToScene for final draw rather than passMask.
        this.modelInstance.passMask = SMGPass.OPAQUE;

        // TODO(jstpierre): RE the whole ModelManager / XanimePlayer thing.
        // Seems like it's possible to have a secondary file for BCK animations?
        this.actorAnimKeeper = ActorAnimKeeper.tryCreate(this);
    }

    public initDefaultPos(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        getJMapInfoPlacementMtx(this.modelInstance.modelMatrix, sceneObjHolder, infoIter);
    }

    public initLightCtrl(sceneObjHolder: SceneObjHolder): void {
        this.actorLightCtrl = new ActorLightCtrl(this);
        this.actorLightCtrl.initActorLightInfo(sceneObjHolder);
        const areaLightInfo = sceneObjHolder.lightDataHolder.findDefaultAreaLight(sceneObjHolder);
        this.actorLightCtrl.currentAreaLight = areaLightInfo;
    }

    public startAction(animationName: string): void {
        if (this.actorAnimKeeper === null || !this.actorAnimKeeper.start(this.modelInstance, this.arc, animationName))
            this.tryStartAllAnim(animationName);
    }

    public tryStartAllAnim(animationName: string): void {
        startBckIfExist(this.modelInstance, this.arc, animationName);
        startBtkIfExist(this.modelInstance, this.arc, animationName);
        startBrkIfExist(this.modelInstance, this.arc, animationName);
        startBpkIfExist(this.modelInstance, this.arc, animationName);
        startBtpIfExist(this.modelInstance, this.arc, animationName);
        startBvaIfExist(this.modelInstance, this.arc, animationName);
    }

    public calcAndSetBaseMtx(): void {
        // Nothing.
    }

    public draw(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.calcAndSetBaseMtx();

        if (this.actorLightCtrl !== null) {
            const lightInfo = this.actorLightCtrl.getActorLight();
            if (lightInfo !== null) {
                // Load the light.
                lightInfo.setOnModelInstance(this.modelInstance, viewerInput.camera);
            }
        }

        this.modelInstance.animationController.setTimeInMilliseconds(viewerInput.time);
        this.modelInstance.calcAnim(viewerInput.camera);
    }
}

class ModelObj extends LiveActor {
    protected modelMatrix = mat4.create();

    constructor(layerId: LayerId, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4 | null, drawBufferType: DrawBufferType, movementType: MovementType, calcAnimType: CalcAnimType) {
        super(layerId, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        if (baseMtx !== null)
            mat4.copy(this.modelMatrix, baseMtx);
        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
    }
}

function createModelObjBloomModel(layerId: LayerId, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    const bloomModel = new ModelObj(layerId, sceneObjHolder, objName, modelName, baseMtx, 0x1E, -2, -2);
    bloomModel.modelInstance.passMask = SMGPass.BLOOM;
    return bloomModel;
}

class MapObjActor extends LiveActor {
    private bloomModel: ModelObj | null = null;

    constructor(layerId: LayerId, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(layerId, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        // TODO(jstpierre): Don't depend on the modelInstance for initDefaultPos.
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.connectToScene(sceneObjHolder);
        this.initLightCtrl(sceneObjHolder);

        const bloomObjName = `${this.name}Bloom`;
        if (sceneObjHolder.modelCache.getObjectData(bloomObjName) !== null) {
            this.bloomModel = createModelObjBloomModel(layerId, sceneObjHolder, this.name, bloomObjName, this.modelInstance.modelMatrix);
        }
    }

    public connectToScene(sceneObjHolder: SceneObjHolder): void {
        // Default implementation.
    }
}

function createSubModelObjName(parentActor: LiveActor, suffix: string): string {
    return `${parentActor.name}${suffix}`;
}

function createSubModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, suffix: string, drawBufferType: DrawBufferType): PartsModel {
    const subModelObjName = createSubModelObjName(parentActor, suffix);
    const model = new PartsModel(sceneObjHolder, subModelObjName, subModelObjName, parentActor, drawBufferType);
    model.tryStartAllAnim(subModelObjName);
    return model;
}

function createIndirectPlanetModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor) {
    const model = createSubModel(sceneObjHolder, parentActor, 'Indirect', 0x1D);
    model.modelInstance.passMask = SMGPass.INDIRECT;
    return model;
}

class PeachCastleGardenPlanet extends MapObjActor {
    private indirectModel: PartsModel | null = null;

    constructor(layerId: LayerId, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(layerId, sceneObjHolder, infoIter);

        this.indirectModel = createIndirectPlanetModel(sceneObjHolder, this);
        this.tryStartAllAnim('Before');
    }

    public connectToScene(sceneObjHolder: SceneObjHolder): void {
        // won't this check always fail for PeachCastleGardenPlanet?
/*
        if (isExistIndirectTexture(this) === 0)
            registerNameObjToExecuteHolder(this, 0x1D, 0x01, 0x04, -1);
        else
            registerNameObjToExecuteHolder(this, 0x1D, 0x01, 0x1D, -1);
*/
        connectToScene(sceneObjHolder, this, 0x1D, 0x01, 0x04, -1);
    }
}

class FixedPosition {
    private localTrans = vec3.create();

    constructor(private baseMtx: mat4, localTrans: vec3 | null = null) {
        if (localTrans !== null)
            this.setLocalTrans(localTrans);
    }

    public setLocalTrans(localTrans: vec3): void {
        vec3.copy(this.localTrans, localTrans);
    }

    public calc(dst: mat4): void {
        mat4.copy(dst, this.baseMtx);
    }
}

class PartsModel extends LiveActor {
    private fixedPosition: FixedPosition | null = null;

    constructor(sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private parentActor: LiveActor, drawBufferType: DrawBufferType) {
        super(parentActor.layerId, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);

        let movementType: MovementType = 0x2B;
        let calcAnimType: CalcAnimType = 0x0B;
        if (drawBufferType >= 0x15 && drawBufferType <= 0x18) {
            movementType = 0x26;
            calcAnimType = 0x0A;
        } else if (drawBufferType === 0x10 || drawBufferType === 0x1B) {
            movementType = 0x28;
            calcAnimType = 0x06;
        }

        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
    }

    public initFixedPosition(jointName: string): void {
        this.fixedPosition = new FixedPosition(this.parentActor.getJointMtx(jointName));
    }

    public calcAndSetBaseMtx(): void {
        if (this.fixedPosition !== null)
            this.fixedPosition.calc(this.modelInstance.modelMatrix);
    }
}

function createPartsModelIndirectNpc(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.NPC_INDIRECT);
    model.modelInstance.passMask = SMGPass.INDIRECT;
    model.initFixedPosition(jointName);
    return model;
}

function createIndirectNPCGoods(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string) {
    const model = createPartsModelIndirectNpc(sceneObjHolder, parentActor, objName, jointName);
    model.initLightCtrl(sceneObjHolder);
    return model;
}

function createPartsModelNpcAndFix(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.NPC);
    model.initFixedPosition(jointName);
    return model;
}

function createNPCGoods(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string) {
    const model = createPartsModelNpcAndFix(sceneObjHolder, parentActor, objName, jointName);
    model.initLightCtrl(sceneObjHolder);
    return model;
}

function connectToScene(sceneObjHolder: SceneObjHolder, actor: LiveActor, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, movementType, calcAnimType, drawBufferType, drawType);
}

function connectToSceneNpc(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x28, 0x06, DrawBufferType.NPC, -1);
}

function requestArchivesForNPCGoods(sceneObjHolder: SceneObjHolder, npcName: string, index: number): void {
    const modelCache = sceneObjHolder.modelCache;

    const itemGoods = sceneObjHolder.npcDirector.getNPCItemData(npcName, index);
    if (itemGoods !== null) {
        if (itemGoods.goods0)
            modelCache.requestObjectData(itemGoods.goods0);

        if (itemGoods.goods1)
            modelCache.requestObjectData(itemGoods.goods1);
    }
}

class NPCActor extends LiveActor {
    public goods0: PartsModel | null = null;
    public goods1: PartsModel | null = null;

    protected equipment(sceneObjHolder: SceneObjHolder, itemGoods: NPCActorItem, isIndirect: boolean = false): void {
        if (itemGoods === null)
            return;

        if (isIndirect) {
            if (itemGoods.goods0)
                this.goods0 = createNPCGoods(sceneObjHolder, this, itemGoods.goods0, itemGoods.goodsJoint0);
            if (itemGoods.goods1)
                this.goods1 = createNPCGoods(sceneObjHolder, this, itemGoods.goods1, itemGoods.goodsJoint1);
        } else {
            if (itemGoods.goods0)
                this.goods0 = createIndirectNPCGoods(sceneObjHolder, this, itemGoods.goods0, itemGoods.goodsJoint0);
            if (itemGoods.goods1)
                this.goods1 = createIndirectNPCGoods(sceneObjHolder, this, itemGoods.goods1, itemGoods.goodsJoint1);
        }
    }
}

class Kinopio extends NPCActor {
    constructor(layerId: LayerId, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(layerId, getObjectName(infoIter));

        const objName = this.name;
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initLightCtrl(sceneObjHolder);

        const itemGoodsIdx = getJMapInfoArg7(infoIter);
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('Kinopio', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        const arg2 = getJMapInfoArg2(infoIter);
        if (arg2 === 0) {
            this.startAction(`SpinWait1`);
        } else if (arg2 === 1) {
            this.startAction(`SpinWait2`);
        } else if (arg2 === 2) {
            this.startAction(`SpinWait3`);
        } else if (arg2 === 3) {
            this.startAction(`Wait`);
        } else if (arg2 === 4) {
            this.startAction(`Wait`);
        } else if (arg2 === 5) {
            this.startAction(`SwimWait`);
        } else if (arg2 === 6) {
            this.startAction(`Pickel`);
        } else if (arg2 === 7) {
            this.startAction(`Sleep`);
        } else if (arg2 === 8) {
            this.startAction(`Wait`);
        } else if (arg2 === 9) {
            this.startAction(`KinopioGoodsWeapon`);
        } else if (arg2 === 10) {
            this.startAction(`Joy`);
        } else if (arg2 === 11) {
            this.startAction(`Rightened`);
        } else if (arg2 === 12) {
            this.startAction(`StarPieceWait`);
        } else if (arg2 === 13) {
            this.startAction(`Getaway`);
        } else if (arg2 === -1) {
            if (itemGoodsIdx === 2) {
                this.startAction(`WaitPickel`);
            } else {
                this.startAction(`Wait`);
            }
        }

        // Bind the color change animation.
        bindColorChangeAnimation(this.modelInstance, this.arc, getJMapInfoArg1(infoIter, 0));
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const itemGoodsIdx = getJMapInfoArg7(infoIter);
        requestArchivesForNPCGoods(sceneObjHolder, 'Kinopio', itemGoodsIdx);
    }
}

class TicoComet extends NPCActor {
    constructor(layerId: LayerId, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(layerId, getObjectName(infoIter));

        const objName = this.name;
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initLightCtrl(sceneObjHolder);

        const itemGoodsIdx = 0;
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('TicoComet', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        this.goods0.startAction('LeftRotate');
        this.goods1.startAction('RightRotate');

        startBtkIfExist(this.modelInstance, this.arc, "TicoComet");
        startBvaIfExist(this.modelInstance, this.arc, "Small0");

        // TODO(jstpierre): setBrkFrameAndStop
        bindColorChangeAnimation(this.modelInstance, this.arc, 0, "Normal.brk");

        this.startAction('Wait');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const itemGoodsIdx = 0;
        requestArchivesForNPCGoods(sceneObjHolder, 'TicoComet', itemGoodsIdx);
    }
}

function layerVisible(layer: number, layerMask: number): boolean {
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
        for (let i = 0; i < this.objects.length; i++)
            this.objects[i].visible = this.visible && layerVisible(this.objects[i].layerId, this.layerMask);

        for (let i = 0; i < this.subzones.length; i++) {
            this.subzones[i].visible = this.visible && layerVisible(this.subzones[i].stageDataHolder.layer, this.layerMask);
            this.subzones[i].computeObjectVisibility();
        }
    }
}

const starPieceColorTable = [
    colorNewFromRGBA8(0x7F7F00FF),
    colorNewFromRGBA8(0x800099FF),
    colorNewFromRGBA8(0xE7A000FF),
    colorNewFromRGBA8(0x46A108FF),
    colorNewFromRGBA8(0x375AA0FF),
    colorNewFromRGBA8(0xBE330BFF),
    colorNewFromRGBA8(0x808080FF),
];

interface NameObjFactory {
    new(layer: number, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): ObjectBase;
    requestArchives?(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void;
}

class SMGSpawner {
    public sceneGraph = new SceneGraph();
    public zones: ZoneNode[] = [];
    // BackLight
    private isSMG1 = false;
    private isSMG2 = false;

    constructor(private galaxyName: string, pathBase: string, private sceneObjHolder: SceneObjHolder) {
        this.isSMG1 = pathBase === 'j3d/smg';
        this.isSMG2 = pathBase === 'j3d/smg2';
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
        const planetFactory = this.sceneObjHolder.planetMapCreator.getNameObjFactory(objName);
        if (planetFactory !== null)
            return planetFactory;

        if (objName === 'Kinopio')         return Kinopio;
        else if (objName === 'TicoComet')  return TicoComet;
        return null;
    }

    public spawnObjectLegacy(zone: ZoneNode, layer: number, objinfo: ObjInfo): void {
        const modelMatrixBase = zone.stageDataHolder.placementMtx;
        const modelCache = this.sceneObjHolder.modelCache;

        const areaLightInfo = this.sceneObjHolder.lightDataHolder.findDefaultAreaLight(this.sceneObjHolder);

        const setLightName = (node: Node, lightName: string): void => {
            const areaLightInfo = this.sceneObjHolder.lightDataHolder.findAreaLight(lightName);
            node.setAreaLightInfo(areaLightInfo);
        };

        const connectObject = (node: Node): void => {
            zone.objects.push(node);
            this.sceneGraph.addNode(node);
        };

        const spawnGraph = (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined, planetRecord: BCSV.BcsvRecord | null = null) => {
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
                modelInstance.name = `${objinfo.objName} ${objinfo.objId}`;

                if (tag === SceneGraphTag.Skybox) {
                    mat4.scale(objinfo.modelMatrix, objinfo.modelMatrix, [.5, .5, .5]);

                    // Kill translation. Need to figure out how the game does skyboxes.
                    objinfo.modelMatrix[12] = 0;
                    objinfo.modelMatrix[13] = 0;
                    objinfo.modelMatrix[14] = 0;

                    modelInstance.isSkybox = true;
                    modelInstance.passMask = SMGPass.SKYBOX;
                } else if (tag === SceneGraphTag.Indirect) {
                    modelInstance.passMask = SMGPass.INDIRECT;
                } else if (tag === SceneGraphTag.Bloom) {
                    modelInstance.passMask = SMGPass.BLOOM;
                } else {
                    modelInstance.passMask = SMGPass.OPAQUE;
                }

                const node = new Node(layer, objinfo, zone, modelInstance, modelMatrixBase, modelInstance.animationController);
                node.planetRecord = planetRecord;

                // TODO(jstpierre): Parse out the proper area info.
                node.setAreaLightInfo(areaLightInfo);

                this.applyAnimations(node, rarc, animOptions);

                connectObject(node);

                return [node, rarc];
            });
        };

        const spawnDefault = (name: string): void => {
            // Spawn planets.
            const planetMapCreator = this.sceneObjHolder.planetMapCreator;
            if (planetMapCreator.isRegisteredObj(name)) {
                const iterInfo = planetMapCreator.planetMapDataTable;
                const planetRecord = iterInfo.record;

                spawnGraph(name, SceneGraphTag.Normal, undefined, planetRecord);

                if (iterInfo.getValueNumber('BloomFlag') !== 0)
                    spawnGraph(`${name}Bloom`, SceneGraphTag.Bloom, undefined, planetRecord);
                if (iterInfo.getValueNumber('WaterFlag') !== 0)
                    spawnGraph(`${name}Water`, SceneGraphTag.Water, undefined, planetRecord);
                if (iterInfo.getValueNumber('IndirectFlag') !== 0)
                    spawnGraph(`${name}Indirect`, SceneGraphTag.Indirect, undefined, planetRecord);
            } else {
                spawnGraph(name, SceneGraphTag.Normal);
            }
        };

        const name = objinfo.objName;
        switch (objinfo.objName) {

            // Skyboxen.
        case 'AuroraSky':
        case 'BeyondGalaxySky':
        case 'BeyondHellValleySky':
        case 'BeyondHorizonSky':
        case 'BeyondOrbitSky':
        case 'BeyondPhantomSky':
        case 'BeyondSandSky':
        case 'BeyondSandNightSky':
        case 'BeyondSummerSky':
        case 'BeyondTitleSky':
        case 'BigFallSky':
        case 'Blue2DSky':
        case 'BrightGalaxySky':
        case 'ChildRoomSky':
        case 'CloudSky':
        case 'DarkSpaceStormSky':
        case 'DesertSky':
        case 'DotPatternSky':
        case 'FamicomMarioSky':
        case 'GalaxySky':
        case 'GoodWeatherSky':
        case 'GreenPlanetOrbitSky':
        case 'HalfGalaxySky':
        case 'HolePlanetInsideSky':
        case 'KoopaVS1Sky':
        case 'KoopaVS2Sky':
        case 'KoopaJrLv3Sky':
        case 'MagmaMonsterSky':
        case 'MemoryRoadSky':
        case 'MilkyWaySky':
        case 'OmoteuLandSky':
        case 'PhantomSky':
        case 'RockPlanetOrbitSky':
        case 'SummerSky':
        case 'VRDarkSpace':
        case 'VROrbit':
        case 'VRSandwichSun':
        case 'VsKoopaLv3Sky':
            spawnGraph(name, SceneGraphTag.Skybox);
            break;

        case 'PeachCastleTownAfterAttack':
            // Don't show. We want the pristine town state.
            return;

        case 'ElectricRail':
            // Covers the path with the rail -- will require special spawn logic.
            return;

        case 'ShootingStar':
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
        case 'BlackHoleCube':
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

        case 'StarPiece':
            spawnGraph(name, SceneGraphTag.Normal, { btk: 'normal.btk', bck: 'land.bck' }).then(([node, rarc]) => {
                const animationController = new AnimationController();
                animationController.setTimeInFrames(objinfo.objArg3);

                // The colors in starpiececc do not match the final colors.
                // const bpk = BPK.parse(assertExists(rarc.findFileData(`starpiececc.bpk`)));

                let idx = objinfo.objArg3;
                if (idx < 0 || idx > 5)
                    idx = ((Math.random() * 6.0) | 0) + 1;

                node.modelInstance.setColorOverride(ColorKind.MAT0, starPieceColorTable[idx]);
            });
            return;

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
        case 'AstroDomeEntrance': {
            switch (objinfo.objArg0) {
            case 1: spawnGraph('AstroDomeEntranceObservatory'); break;
            case 2: spawnGraph('AstroDomeEntranceWell'); break;
            case 3: spawnGraph('AstroDomeEntranceKitchen'); break;
            case 4: spawnGraph('AstroDomeEntranceBedRoom'); break;
            case 5: spawnGraph('AstroDomeEntranceMachine'); break;
            case 6: spawnGraph('AstroDomeEntranceTower'); break;
            default: assert(false);
            }
            break;
        }
        case 'AstroStarPlate': {
            switch (objinfo.objArg0) {
            case 1: spawnGraph('AstroStarPlateObservatory'); break;
            case 2: spawnGraph('AstroStarPlateWell'); break;
            case 3: spawnGraph('AstroStarPlateKitchen'); break;
            case 4: spawnGraph('AstroStarPlateBedRoom'); break;
            case 5: spawnGraph('AstroStarPlateMachine'); break;
            case 6: spawnGraph('AstroStarPlateTower'); break;
            default: assert(false);
            }
            break;
        }
        case 'SignBoard':
            // SignBoard has a single animation for falling over which we don't want to play.
            spawnGraph('SignBoard', SceneGraphTag.Normal, null);
            break;
        case 'Rabbit':
            spawnGraph('TrickRabbit');
            break;
        case 'Rosetta':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'waita.bck' }).then(([node, rarc]) => {
                // "Rosetta Encounter"
                setLightName(node, `ロゼッタ出会い`);
            });
            break;
        case 'Tico':
        case 'TicoAstro':
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
        case 'BlackHole':
        case 'BlackHoleCube':
            spawnGraph(`BlackHole`);
            spawnGraph(`BlackHoleRange`).then(([node, rarc]) => {
                const scale = node.objinfo.objArg0 >= 0 ? (node.objinfo.objArg0 / 1000) : 1;
                mat4.scale(node.modelMatrix, node.modelMatrix, [scale, scale, scale]);
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
            spawnGraph(`Koura`);
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
        this.zones.push(zoneNode);

        const legacyPaths = stageDataHolder.legacyParsePaths();

        stageDataHolder.iterPlacement((infoIter, layerId, isMapPart) => {
            const factory = this.getNameObjFactory(getObjectName(infoIter));
            if (factory !== null) {
                const nameObj = new factory(layerId, this.sceneObjHolder, infoIter);
                zoneNode.objects.push(nameObj);
            } else {
                const objInfoLegacy = stageDataHolder.legacyCreateObjinfo(infoIter, legacyPaths, isMapPart);
                // Fall back to legacy spawn.
                this.spawnObjectLegacy(zoneNode, layerId, objInfoLegacy);
            }
        });

        for (let i = 0; i < stageDataHolder.localStageDataHolders.length; i++) {
            const subzone = this.placeStageData(stageDataHolder.localStageDataHolders[i]);
            zoneNode.subzones.push(subzone);
        }

        return zoneNode;
    }

    public placeZones(): void {
        this.placeStageData(this.sceneObjHolder.stageDataHolder);
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

    constructor(sceneDesc: SMGSceneDescBase, modelCache: ModelCache, public zoneName: string, public layer: number = -1) {
        this.zoneArchive = sceneDesc.getZoneMapArchive(modelCache, zoneName);
        this.createLocalStageDataHolder(sceneDesc, modelCache);
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
        infoIter.getSRTMatrix(modelMatrix);
        const mapInfoIter = infoIter.copy();
        (mapInfoIter as JMapInfoIter_StageDataHolder).originalStageDataHolder = this;
        return { objId, objName, isMapPart, objArg0, objArg1, objArg2, objArg3, moveConditionType, rotateSpeed, rotateAccelType, rotateAxis, modelMatrix, path, mapInfoIter };
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

            const objInfo = this.zoneArchive.findFileData(`jmp/placement/${layerDirName}/ObjInfo`);
            if (objInfo !== null)
                this.iterLayer(i, callback, objInfo, false);

            const mapPartsInfo = this.zoneArchive.findFileData(`jmp/placement/${layerDirName}/MapPartsInfo`);
            if (mapPartsInfo !== null)
                this.iterLayer(i, callback, mapPartsInfo, true);
        }
    }

    public iterAreas(callback: LayerObjInfoCallback): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);

            const areaObjInfo = this.zoneArchive.findFileData(`jmp/placement/${layerDirName}/AreaObjInfo`);
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

    public createLocalStageDataHolder(sceneDesc: SMGSceneDescBase, modelCache: ModelCache): void {
        for (let i = LayerId.COMMON; i <= LayerId.LAYER_MAX; i++) {
            const layerDirName = getLayerDirName(i);
            const stageObjInfo = this.zoneArchive.findFileData(`jmp/placement/${layerDirName}/StageObjInfo`);

            if (stageObjInfo === null)
                continue;

            const mapInfoIter = createCsvParser(stageObjInfo);

            for (let j = 0; j < mapInfoIter.getNumRecords(); j++) {
                mapInfoIter.setRecord(j);
                const zoneName = getObjectName(mapInfoIter);
                const localStage = new StageDataHolder(sceneDesc, modelCache, zoneName, i);
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
        if (objName === 'PeachCastleGardenPlanet')
            return PeachCastleGardenPlanet;
        else
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

export abstract class SMGSceneDescBase implements Viewer.SceneDesc {
    protected pathBase: string;

    constructor(public name: string, public galaxyName: string, public id: string = galaxyName) {
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
            sceneObjHolder.stageDataHolder = new StageDataHolder(this, modelCache, sceneObjHolder.scenarioData.getMasterZoneFilename());
            sceneObjHolder.sceneNameObjListExecutor = new SceneNameObjListExecutor();

            const spawner = new SMGSpawner(galaxyName, this.pathBase, sceneObjHolder);
            spawner.requestArchives();

            return modelCache.waitForLoad().then(() => {
                spawner.placeZones();
                return new SMGRenderer(device, renderHelper, spawner, sceneObjHolder);
            });
        });
    }
}
