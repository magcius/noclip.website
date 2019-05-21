
import { mat4, quat, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import Progressable from '../../Progressable';
import { assert, assertExists } from '../../util';
import { fetchData, AbortedError } from '../../fetch';
import * as Viewer from '../../viewer';
import { GfxDevice, GfxRenderPass, GfxHostAccessPass } from '../../gfx/platform/GfxPlatform';
import { GfxRenderInstViewRenderer } from '../../gfx/render/GfxRenderer';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, noClearRenderPassDescriptor } from '../../gfx/helpers/RenderTargetHelpers';
import { BMD, BRK, BTK, BCK, LoopMode, BVA, BPK, BTP } from '../../j3d/j3d';
import { BMDModel, BMDModelInstance } from '../../j3d/render';
import * as RARC from '../../j3d/rarc';
import { EFB_WIDTH, EFB_HEIGHT, Light, lightSetWorldPosition, lightSetWorldDirection } from '../../gx/gx_material';
import { GXRenderHelperGfx } from '../../gx/gx_render';
import { getPointBezier } from '../../Spline';
import AnimationController from '../../AnimationController';
import * as Yaz0 from '../../compression/Yaz0';
import * as BCSV from '../../luigis_mansion/bcsv';
import * as UI from '../../ui';
import { colorFromRGBA, Color, colorNew, colorCopy } from '../../Color';
import { BloomPostFXParameters, BloomPostFXRenderer } from './Bloom';
import { Camera } from '../../Camera';

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

class AreaLight {
    public Position = vec3.create();
    public Color = colorNew(1, 1, 1, 1);
    public FollowCamera: boolean;

    public setFromLightDataRecord(bcsv: BCSV.Bcsv, record: BCSV.BcsvRecord, prefix: string): void {
        colorSetFromCsvDataRecord(this.Color, bcsv, record, `${prefix}Color`);

        const posX = BCSV.getField(bcsv, record, `${prefix}PosX`, 0);
        const posY = BCSV.getField(bcsv, record, `${prefix}PosY`, 0);
        const posZ = BCSV.getField(bcsv, record, `${prefix}PosZ`, 0);
        vec3.set(this.Position, posX, posY, posZ);

        this.FollowCamera = BCSV.getField(bcsv, record, `${prefix}FollowCamera`) !== 0;
    }

    public setLight(dst: Light, camera: Camera): void {
        if (this.FollowCamera) {
            vec3.copy(dst.Position, this.Position);
            vec3.set(dst.Direction, 1, 0, 0);
        } else {
            lightSetWorldPosition(dst, camera, this.Position[0], this.Position[1], this.Position[2]);
            lightSetWorldDirection(dst, camera, 1, 0, 0);
        }

        colorCopy(dst.Color, this.Color);
        vec3.set(dst.CosAtten, 1, 0, 0);
        vec3.set(dst.DistAtten, 1, 0, 0);
    }
}

class AreaLightConfiguration {
    public AreaLightName: string;
    public Light0 = new AreaLight();
    public Light1 = new AreaLight();
    public Ambient = colorNew(1, 1, 1, 1);

    public setFromLightDataRecord(bcsv: BCSV.Bcsv, record: BCSV.BcsvRecord, prefix: string): void {
        this.Light0.setFromLightDataRecord(bcsv, record, `${prefix}Light0`);
        this.Light1.setFromLightDataRecord(bcsv, record, `${prefix}Light1`);
        colorSetFromCsvDataRecord(this.Ambient, bcsv, record, `${prefix}Ambient`);
    }

    public setOnModelInstance(modelInstance: BMDModelInstance, camera: Camera): void {
        this.Light0.setLight(modelInstance.getGXLightReference(0), camera);
        this.Light1.setLight(modelInstance.getGXLightReference(1), camera);
        // TODO(jstpierre): This doesn't look quite right for planets.
        // Needs investigation.
        // modelInstance.setColorOverride(ColorKind.AMB0, this.Ambient, true);
    }
}

class AreaLightInfo {
    public AreaLightName: string;
    public Interpolate: number;
    public Player = new AreaLightConfiguration();
    public Strong = new AreaLightConfiguration();
    public Weak = new AreaLightConfiguration();
    public Planet = new AreaLightConfiguration();

    public setFromLightDataRecord(bcsv: BCSV.Bcsv, record: BCSV.BcsvRecord): void {
        this.AreaLightName = BCSV.getField<string>(bcsv, record, 'AreaLightName');
        this.Interpolate = BCSV.getField<number>(bcsv, record, 'Interpolate');
        this.Player.setFromLightDataRecord(bcsv, record, 'Player');
        this.Strong.setFromLightDataRecord(bcsv, record, 'Strong');
        this.Weak.setFromLightDataRecord(bcsv, record, 'Weak');
        this.Planet.setFromLightDataRecord(bcsv, record, 'Planet');
    }
}

const enum RotateAxis { X, Y, Z };

const scratchVec3 = vec3.create();
class Node {
    public name: string = '';
    public modelMatrix = mat4.create();
    public layer: number = -1;
    public planetRecord: BCSV.BcsvRecord | null = null;

    private modelMatrixAnimator: ModelMatrixAnimator | null = null;
    private rotateSpeed = 0;
    private rotatePhase = 0;
    private rotateAxis: RotateAxis = RotateAxis.Y;
    public areaLightInfo: AreaLightInfo;
    public areaLightConfiguration: AreaLightConfiguration;

    constructor(public objinfo: ObjInfo, private parentZone: ZoneNode, public modelInstance: BMDModelInstance, parentModelMatrix: mat4, public animationController: AnimationController) {
        this.name = modelInstance.name;
        // BlackHole is special and doesn't inherit SR from parent.
        if (objinfo.objName === 'BlackHole') {
            mat4.copy(this.modelMatrix, objinfo.modelMatrix);
            this.modelMatrix[12] += parentModelMatrix[12];
            this.modelMatrix[13] += parentModelMatrix[13];
            this.modelMatrix[14] += parentModelMatrix[14];
        } else {
            mat4.mul(this.modelMatrix, parentModelMatrix, objinfo.modelMatrix);
        }

        this.setupAnimations();
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
        if (this.modelMatrixAnimator !== null) {
            this.modelMatrixAnimator.updateRailAnimation(this.modelInstance.modelMatrix, time);
            // Apply zone transform to path results.
            mat4.mul(this.modelInstance.modelMatrix, this.parentZone.modelMatrixBase, this.modelInstance.modelMatrix);
        }
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

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        this.areaLightConfiguration.setOnModelInstance(this.modelInstance, viewerInput.camera);
        this.updateSpecialAnimations();
        this.modelInstance.prepareToRender(renderHelper, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
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

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.nodes.length; i++)
            this.nodes[i].destroy(device);
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

    constructor(device: GfxDevice, private spawner: SMGSpawner, private viewRenderer: GfxRenderInstViewRenderer, private scenarioData: BCSV.Bcsv, private zoneNames: string[]) {
        this.sceneGraph = spawner.sceneGraph;

        this.sceneGraph.onnodeadded = () => {
            this.applyCurrentScenario();
        };

        this.bloomRenderer = new BloomPostFXRenderer(device, this.mainRenderTarget, this.viewRenderer);
    }

    private applyCurrentScenario(): void {
        const scenarioRecord = this.scenarioData.records[this.currentScenarioIndex];

        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zoneNode = this.spawner.zones[i];
            zoneNode.layerMask = BCSV.getField<number>(this.scenarioData, scenarioRecord, zoneNode.zone.name, 0);
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

        const scenarioNames = this.scenarioData.records.map((record) => {
            return BCSV.getField<string>(this.scenarioData, record, 'ScenarioName');
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
                this.sceneGraph.nodes[i].modelInstance.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.sceneGraph.nodes.length; i++)
                this.sceneGraph.nodes[i].modelInstance.setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [scenarioPanel, renderHacksPanel];
    }

    private findBloomArea(): ObjInfo | null {
        for (let i = 0; i < this.spawner.zones.length; i++) {
            const zone = this.spawner.zones[i].zone;
            for (let j = 0; j < zone.layers.length; j++) {
                for (let k = 0; k < zone.layers[j].areaobjinfo.length; k++) {
                    const area = zone.layers[j].areaobjinfo[k];
                    if (area.objName === 'BloomCube' && area.objArg0 != -1)
                        return area;
                }
            }
        }

        return null;
    }

    private prepareToRenderBloom(hostAccessPass: GfxHostAccessPass): void {
        // TODO(jstpierre): Dynamically adjust based on Area.
        const bloomArea = this.findBloomArea();
        if (bloomArea !== null) {
            // TODO(jstpierre): What is arg1
            this.bloomParameters.blurStrength = bloomArea.objArg2 / 256;
            this.bloomParameters.bokehStrength = bloomArea.objArg3 / 256;
            this.bloomParameters.bokehCombineStrength = bloomArea.objArg0 / 256;
        } else {
            this.bloomParameters.blurStrength = 25/256;
            this.bloomParameters.bokehStrength = 25/256;
            this.bloomParameters.bokehCombineStrength = 50/256;
        }

        this.bloomRenderer.prepareToRender(hostAccessPass, this.bloomParameters);
    }

    private setIndirectTextureOverride(): void {
        for (let i = 0; i < this.spawner.sceneGraph.nodes.length; i++) {
            const m = this.spawner.sceneGraph.nodes[i].modelInstance.getTextureMappingReference("IndDummy");
            if (m !== null) {
                m.gfxTexture = this.opaqueSceneTexture.gfxTexture;
                m.width = EFB_WIDTH;
                m.height = EFB_HEIGHT;
            }
        }
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();

        this.prepareToRenderBloom(hostAccessPass);

        this.spawner.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.mainRenderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.opaqueSceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        this.viewRenderer.prepareToRender(device);

        const skyboxPassRenderer = this.mainRenderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, SMGPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);

        const opaquePassRenderer = this.mainRenderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, opaquePassRenderer, SMGPass.OPAQUE);

        let lastPassRenderer: GfxRenderPass;
        if (this.viewRenderer.hasAnyVisible(SMGPass.INDIRECT)) {
            opaquePassRenderer.endPass(this.opaqueSceneTexture.gfxTexture);
            device.submitPass(opaquePassRenderer);

            // TODO(jstpierre): The game seems to have two different versions of IndDummy. One which uses last-frame's scene
            // and one which uses the scene drawn so far. This appears to be done on a per-object basis.
            this.setIndirectTextureOverride();

            const indTexPassRenderer = this.mainRenderTarget.createRenderPass(device, noClearRenderPassDescriptor);
            this.viewRenderer.executeOnPass(device, indTexPassRenderer, SMGPass.INDIRECT);
            lastPassRenderer = indTexPassRenderer;
        } else {
            lastPassRenderer = opaquePassRenderer;
        }

        if (this.viewRenderer.hasAnyVisible(SMGPass.BLOOM)) {
            lastPassRenderer.endPass(null);
            device.submitPass(lastPassRenderer);

            lastPassRenderer = this.bloomRenderer.render(device, this.viewRenderer, this.mainRenderTarget, viewerInput, SMGPass.BLOOM);
        }

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
    }
}

function getLayerName(index: number) {
    if (index === -1) {
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

interface ZoneLayer {
    index: number;
    objinfo: ObjInfo[];
    mappartsinfo: ObjInfo[];
    stageobjinfo: ObjInfo[];
    areaobjinfo: ObjInfo[];
}

interface Zone {
    name: string;
    layers: ZoneLayer[];
}

function computeModelMatrixFromRecord(modelMatrix: mat4, bcsv: BCSV.Bcsv, record: BCSV.BcsvRecord): void {
    const pos_x = BCSV.getField<number>(bcsv, record, 'pos_x', 0);
    const pos_y = BCSV.getField<number>(bcsv, record, 'pos_y', 0);
    const pos_z = BCSV.getField<number>(bcsv, record, 'pos_z', 0);
    const dir_x = BCSV.getField<number>(bcsv, record, 'dir_x', 0);
    const dir_y = BCSV.getField<number>(bcsv, record, 'dir_y', 0);
    const dir_z = BCSV.getField<number>(bcsv, record, 'dir_z', 0);
    const scale_x = BCSV.getField<number>(bcsv, record, 'scale_x', 1);
    const scale_y = BCSV.getField<number>(bcsv, record, 'scale_y', 1);
    const scale_z = BCSV.getField<number>(bcsv, record, 'scale_z', 1);
    const q = quat.create();
    quat.fromEuler(q, dir_x, dir_y, dir_z);
    mat4.fromRotationTranslationScale(modelMatrix, q, [pos_x, pos_y, pos_z], [scale_x, scale_y, scale_z]);
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

class ModelCache {
    public promiseCache = new Map<string, Progressable<BMDModel>>();
    public archiveCache = new Map<string, RARC.RARC>();
    private models: BMDModel[] = [];
    private destroyed: boolean = false;

    public getModel(device: GfxDevice, abortSignal: AbortSignal, renderHelper: GXRenderHelperGfx, archivePath: string, modelFilename: string): Progressable<BMDModel | null> {
        if (this.promiseCache.has(archivePath))
            return this.promiseCache.get(archivePath);

        const p = fetchData(archivePath, abortSignal).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0) {
                console.warn(`Could not fetch archive ${archivePath}`);
                return null;
            }
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            if (buffer === null)
                return null;
            if (this.destroyed)
                throw new AbortedError();
            const rarc = RARC.parse(buffer);
            const bmd = BMD.parse(assertExists(rarc.findFileData(modelFilename)));
            const bmdModel = new BMDModel(device, renderHelper, bmd, null);
            this.archiveCache.set(archivePath, rarc);
            this.models.push(bmdModel);
            return bmdModel;
        });

        this.promiseCache.set(archivePath, p);
        return p;
    }

    public destroy(device: GfxDevice): void {
        this.destroyed = true;
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
    }
}

function layerVisible(layer: number, layerMask: number): boolean {
    if (layer >= 0)
        return !!(layerMask & (1 << layer));
    else
        return true;
}

class ZoneNode {
    public objects: Node[] = [];

    // The current layer mask for objects and sub-zones in this zone.
    public layerMask: number = 0xFFFFFFFF;
    // Whether the layer of our parent zone is visible.
    public visible: boolean = true;
    public subzones: ZoneNode[] = [];

    constructor(public zone: Zone, private layer: number = -1, public modelMatrixBase: mat4) {
    }

    public computeObjectVisibility(): void {
        for (let i = 0; i < this.objects.length; i++)
            this.objects[i].modelInstance.visible = this.visible && layerVisible(this.objects[i].layer, this.layerMask);

        for (let i = 0; i < this.subzones.length; i++) {
            this.subzones[i].visible = this.visible && layerVisible(this.subzones[i].layer, this.layerMask);
            this.subzones[i].computeObjectVisibility();
        }
    }
}

function colorSetFromCsvDataRecord(color: Color, bcsv: BCSV.Bcsv, record: BCSV.BcsvRecord, prefix: string): void {
    const colorR = BCSV.getField(bcsv, record, `${prefix}R`, 0) / 0xFF;
    const colorG = BCSV.getField(bcsv, record, `${prefix}G`, 0) / 0xFF;
    const colorB = BCSV.getField(bcsv, record, `${prefix}B`, 0) / 0xFF;
    const colorA = BCSV.getField(bcsv, record, `${prefix}A`, 0) / 0xFF;
    colorFromRGBA(color, colorR, colorG, colorB, colorA);
}

class SMGSpawner {
    public sceneGraph = new SceneGraph();
    public zones: ZoneNode[] = [];
    private modelCache = new ModelCache();
    // BackLight
    private backlight = new Light();
    private isSMG1 = false;
    private isSMG2 = false;
    private areaLightInfos: AreaLightInfo[] = [];

    constructor(private pathBase: string, private renderHelper: GXRenderHelperGfx, private viewRenderer: GfxRenderInstViewRenderer, private planetTable: BCSV.Bcsv, private lightData: BCSV.Bcsv) {
        this.isSMG1 = this.pathBase === 'j3d/smg';
        this.isSMG2 = this.pathBase === 'j3d/smg2';

        // "Rim" backlight settings.
        colorFromRGBA(this.backlight.Color, 0, 0, 0, 0.5);
        vec3.set(this.backlight.CosAtten, 1, 0, 0);
        vec3.set(this.backlight.DistAtten, 1, 0, 0);
        vec3.set(this.backlight.Position, 0, 0, 0);
        vec3.set(this.backlight.Direction, 0, -1, 0);

        for (let i = 0; i < lightData.records.length; i++) {
            const areaLightInfo = new AreaLightInfo();
            areaLightInfo.setFromLightDataRecord(lightData, lightData.records[i]);
            this.areaLightInfos.push(areaLightInfo);
        }
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.sceneGraph.nodes.length; i++)
            this.sceneGraph.nodes[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
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

    private nodeSetLightName(node: Node, lightName: string): void {
        const areaLightInfo = this.areaLightInfos.find((areaLightInfo) => areaLightInfo.AreaLightName === lightName)!;
        node.setAreaLightInfo(areaLightInfo);
    }

    public spawnObject(device: GfxDevice, abortSignal: AbortSignal, zone: ZoneNode, layer: number, objinfo: ObjInfo, modelMatrixBase: mat4): void {
        const spawnGraph = (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined, planetRecord: BCSV.BcsvRecord | null = null) => {
            const arcPath = `${this.pathBase}/ObjectData/${arcName}.arc`;
            const modelFilename = `${arcName}.bdl`;
            return this.modelCache.getModel(device, abortSignal, this.renderHelper, arcPath, modelFilename).then((bmdModel): [Node, RARC.RARC] => {
                // If this is a 404, then return null.
                if (bmdModel === null)
                    return null;

                if (this.hasIndirectTexture(bmdModel))
                    tag = SceneGraphTag.Indirect;

                // Trickery.
                const rarc = this.modelCache.archiveCache.get(arcPath);

                const modelInstance = new BMDModelInstance(this.renderHelper, bmdModel);
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

                const node = new Node(objinfo, zone, modelInstance, modelMatrixBase, modelInstance.animationController);
                node.planetRecord = planetRecord;
                node.layer = layer;
                zone.objects.push(node);

                // TODO(jstpierre): Parse out the proper area info.
                const lightName = '[共通]昼（どら焼き）';
                this.nodeSetLightName(node, lightName);
                modelInstance.getGXLightReference(2).copy(this.backlight);

                this.applyAnimations(node, rarc, animOptions);

                this.sceneGraph.addNode(node);

                this.renderHelper.renderInstBuilder.constructRenderInsts(device, this.viewRenderer);
                return [node, rarc];
            });
        };

        const spawnDefault = (name: string): void => {
            // Spawn planets.
            const planetRecord = this.planetTable.records.find((record) => BCSV.getField(this.planetTable, record, 'PlanetName') === name);
            if (planetRecord) {
                spawnGraph(name, SceneGraphTag.Normal, undefined, planetRecord);

                const bloomFlag = BCSV.getField(this.planetTable, planetRecord, 'BloomFlag');
                const waterFlag = BCSV.getField(this.planetTable, planetRecord, 'WaterFlag');
                const indirectFlag = BCSV.getField(this.planetTable, planetRecord, 'IndirectFlag');
                if (bloomFlag)
                    spawnGraph(`${name}Bloom`, SceneGraphTag.Bloom, undefined, planetRecord);
                if (waterFlag)
                    spawnGraph(`${name}Water`, SceneGraphTag.Water, undefined, planetRecord);
                if (indirectFlag)
                    spawnGraph(`${name}Indirect`, SceneGraphTag.Indirect, undefined, planetRecord);
            } else {
                spawnGraph(name, SceneGraphTag.Normal);
            }
        };

        function animFrame(frame: number) {
            const animationController = new AnimationController();
            animationController.setTimeInFrames(frame);
            return animationController;
        }

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
        case 'SplashPieceBlock':
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

        case 'StarPiece':
            spawnGraph(name, SceneGraphTag.Normal, { btk: 'normal.btk', bck: 'land.bck' }).then(([node, rarc]) => {
                const animationController = new AnimationController();
                animationController.setTimeInFrames(objinfo.objArg3);

                const bpk = BPK.parse(assertExists(rarc.findFileData(`starpiececc.bpk`)));
                node.modelInstance.bindTRK1(bpk.pak1, animationController);
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
        case 'Kinopio':
            spawnGraph('Kinopio', SceneGraphTag.Normal, { bck: 'wait.bck' });
            break;
        case 'Rosetta':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'waita.bck' }).then(([node, rarc]) => {
                // "Rosetta Encounter"
                this.nodeSetLightName(node, `ロゼッタ出会い`);
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
                // TODO(jstpierre): Figure out what the deal is with the BVA not quite working...
                const bva = BVA.parse(rarc.findFileData(`Big1.bva`));
                node.modelInstance.bindVAF1(bva.vaf1, animFrame(0));
            });
            break;
        case 'BlackHole':
        case 'BlackHoleCube':
            spawnGraph(`BlackHole`);
            spawnGraph(`BlackHoleRange`).then(([node, rarc]) => {
                const scale = node.objinfo.objArg0 / 1000;
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
                    const isRedStar = node.objinfo.objArg0 === 2;
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

    public spawnZone(device: GfxDevice, abortSignal: AbortSignal, zone: Zone, zones: Zone[], modelMatrixBase: mat4, parentLayer: number = -1): ZoneNode {
        // Spawn all layers. We'll hide them later when masking out the others.
        const zoneNode = new ZoneNode(zone, parentLayer, modelMatrixBase);
        this.zones.push(zoneNode);

        for (const layer of zone.layers) {
            for (const objinfo of layer.objinfo)
                this.spawnObject(device, abortSignal, zoneNode, layer.index, objinfo, modelMatrixBase);

            for (const objinfo of layer.mappartsinfo)
                this.spawnObject(device, abortSignal, zoneNode, layer.index, objinfo, modelMatrixBase);

            for (const zoneinfo of layer.stageobjinfo) {
                const subzone = zones.find((zone) => zone.name === zoneinfo.objName);
                const subzoneModelMatrix = mat4.create();
                mat4.mul(subzoneModelMatrix, modelMatrixBase, zoneinfo.modelMatrix);
                const subzoneNode = this.spawnZone(device, abortSignal, subzone, zones, subzoneModelMatrix, layer.index);
                zoneNode.subzones.push(subzoneNode);
            }
        }

        return zoneNode;
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device);
        this.sceneGraph.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderHelper.destroy(device);
    }
}

export abstract class SMGSceneDescBase implements Viewer.SceneDesc {
    protected pathBase: string;

    constructor(public name: string, public galaxyName: string, public id: string = galaxyName) {
    }

    protected abstract getZoneMapFilename(zoneName: string): string;
    protected abstract getLightDataFilename(): string;

    public parsePlacement(bcsv: BCSV.Bcsv, paths: Path[], isMapPart: boolean): ObjInfo[] {
        return bcsv.records.map((record): ObjInfo => {
            const objId = BCSV.getField<number>(bcsv, record, 'l_id', -1);
            const objName = BCSV.getField<string>(bcsv, record, 'name', 'Unknown');
            const objArg0 = BCSV.getField<number>(bcsv, record, 'Obj_arg0', -1);
            const objArg1 = BCSV.getField<number>(bcsv, record, 'Obj_arg1', -1);
            const objArg2 = BCSV.getField<number>(bcsv, record, 'Obj_arg2', -1);
            const objArg3 = BCSV.getField<number>(bcsv, record, 'Obj_arg3', -1);
            const moveConditionType = BCSV.getField<number>(bcsv, record, 'MoveConditionType', 0);
            const rotateSpeed = BCSV.getField<number>(bcsv, record, 'RotateSpeed', 0);
            const rotateAccelType = BCSV.getField<number>(bcsv, record, 'RotateAccelType', 0);
            const rotateAxis = BCSV.getField<number>(bcsv, record, 'RotateAxis', 0);
            const pathId: number = BCSV.getField<number>(bcsv, record, 'CommonPath_ID', -1);
            const path = paths.find((path) => path.l_id === pathId) || null;
            const modelMatrix = mat4.create();
            computeModelMatrixFromRecord(modelMatrix, bcsv, record);
            return { objId, objName, isMapPart, objArg0, objArg1, objArg2, objArg3, moveConditionType, rotateSpeed, rotateAccelType, rotateAxis, modelMatrix, path };
        });
    }

    public parsePaths(pathDir: RARC.RARCDir): Path[] {
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

    public parseZone(name: string, buffer: ArrayBufferSlice): Zone {
        const rarc = RARC.parse(buffer);
        const layers: ZoneLayer[] = [];
        for (let i = -1; i < 26; i++) {
            const layerName = getLayerName(i);
            const placementDir = `jmp/placement/${layerName}`;
            const pathDir = `jmp/path`;
            const mappartsDir = `jmp/mapparts/${layerName}`;
            if (!rarc.findDir(placementDir))
                continue;
            const paths = this.parsePaths(rarc.findDir(pathDir));
            const objinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/objinfo`)), paths, false);
            const mappartsinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${mappartsDir}/mappartsinfo`)), paths, true);
            const stageobjinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/stageobjinfo`)), paths, false);
            const areaobjinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/areaobjinfo`)), paths, false);
            layers.push({ index: i, objinfo, mappartsinfo, stageobjinfo, areaobjinfo });
        }
        return { name, layers };
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const galaxyName = this.galaxyName;
        return Progressable.all([
            fetchData(`${this.pathBase}/ObjectData/PlanetMapDataTable.arc`, abortSignal),
            fetchData(this.getLightDataFilename(), abortSignal),
            fetchData(`${this.pathBase}/StageData/${galaxyName}/${galaxyName}Scenario.arc`, abortSignal),
        ]).then((buffers: ArrayBufferSlice[]) => {
            return Promise.all(buffers.map((buffer) => Yaz0.decompress(buffer)));
        }).then((buffers: ArrayBufferSlice[]) => {
            const [planetTableBuffer, lightDataBuffer, scenarioBuffer] = buffers;

            // Load planet table.
            const planetTableRarc = RARC.parse(planetTableBuffer);
            const planetTable = BCSV.parse(planetTableRarc.findFileData('planetmapdatatable.bcsv'));

            // Load light data.
            const lightDataRarc = RARC.parse(lightDataBuffer);
            const lightData = BCSV.parse(lightDataRarc.findFileData('lightdata.bcsv'));

            // Load all the subzones.
            const scenarioRarc = RARC.parse(scenarioBuffer);
            const zonelist = BCSV.parse(scenarioRarc.findFileData('zonelist.bcsv'));
            const scenariodata = BCSV.parse(scenarioRarc.findFileData('scenariodata.bcsv'));

            // zonelist contains one field, ZoneName, a string
            assert(zonelist.fields.length === 1);
            assert(zonelist.fields[0].nameHash === BCSV.bcsvHashSMG('ZoneName'));
            const zoneNames = zonelist.records.map(([zoneName]) => zoneName as string);

            // The master zone is the first one.
            const masterZoneName = zoneNames[0];
            assert(masterZoneName === galaxyName);

            const renderHelper = new GXRenderHelperGfx(device);
            const viewRenderer = new GfxRenderInstViewRenderer();

            // Construct initial state.
            renderHelper.renderInstBuilder.constructRenderInsts(device, viewRenderer);

            return Progressable.all(zoneNames.map((zoneName) => fetchData(this.getZoneMapFilename(zoneName), abortSignal))).then((buffers: ArrayBufferSlice[]) => {
                return Promise.all(buffers.map((buffer) => Yaz0.decompress(buffer)));
            }).then((zoneBuffers: ArrayBufferSlice[]): Viewer.SceneGfx => {
                const zones = zoneBuffers.map((zoneBuffer, i) => this.parseZone(zoneNames[i], zoneBuffer));
                const spawner = new SMGSpawner(this.pathBase, renderHelper, viewRenderer, planetTable, lightData);
                const modelMatrixBase = mat4.create();
                spawner.spawnZone(device, abortSignal, zones[0], zones, modelMatrixBase);
                return new SMGRenderer(device, spawner, viewRenderer, scenariodata, zoneNames);
            });
        });
    }
}
