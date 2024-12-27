
import { mat4, vec3, vec4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { DataFetcher } from '../DataFetcher.js';
import { assert, assertExists, hexzero, nArray, readString } from '../util.js';

import * as RARC from '../Common/JSYSTEM/JKRArchive.js';
import * as BYML from '../byml.js';
import * as UI from '../ui.js';
import * as Viewer from '../viewer.js';

import { Camera, texProjCameraSceneTex } from '../Camera.js';
import { TransparentBlack } from '../Color.js';
import * as Yaz0 from '../Common/Compression/Yaz0.js';
import { J3DModelInstance } from '../Common/JSYSTEM/J3D/J3DGraphBase.js';
import * as JPA from '../Common/JSYSTEM/JPA.js';
import { BTIData } from '../Common/JSYSTEM/JUTTexture.js';
import { dfRange } from '../DebugFloaters.js';
import { MathConstants, getMatrixAxisZ, getMatrixTranslation, projectionMatrixForFrustum, range } from '../MathHelpers.js';
import { SceneContext } from '../SceneBase.js';
import { TextureMapping } from '../TextureHolder.js';
import { setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxClipSpaceNearZ, GfxDevice, GfxFormat, GfxRenderPass, GfxTexture, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { GXRenderHelperGfx, SceneParams, calcLODBias, fillSceneParamsData } from '../gx/gx_render.js';
import { FlowerPacket, GrassPacket, TreePacket } from './Grass.js';
import { LegacyActor__RegisterFallbackConstructor } from './LegacyActor.js';
import { dDlst_2DStatic_c, d_a__RegisterConstructors } from './d_a.js';
import { d_a_sea } from './d_a_sea.js';
import { dBgS } from './d_bg.js';
import { dDlst_list_Set, dDlst_list_c } from './d_drawlist.js';
import { dKankyo_create, dKy__RegisterConstructors, dKy_setLight, dScnKy_env_light_c } from './d_kankyo.js';
import { dKyw__RegisterConstructors } from './d_kankyo_wether.js';
import { dPa_control_c } from './d_particle.js';
import { dProcName_e } from './d_procname.js';
import { ResType, dRes_control_c } from './d_resorce.js';
import { dStage_dt_c_roomLoader, dStage_dt_c_roomReLoader, dStage_dt_c_stageInitLoader, dStage_dt_c_stageLoader, dStage_roomControl_c, dStage_roomStatus_c, dStage_stageDt_c } from './d_stage.js';
import { WoodPacket } from './d_wood.js';
import { fopAcM_create, fopAcM_searchFromName, fopAc_ac_c } from './f_op_actor.js';
import { cPhs__Status, fGlobals, fopDw_Draw, fopScn, fpcCt_Handler, fpcLy_SetCurrentLayer, fpcM_Management, fpcPf__Register, fpcSCtRq_Request, fpc_pc__ProfileList } from './framework.js';
import { dDemo_manager_c, EDemoCamFlags, EDemoMode } from './d_demo.js';
import { d_pn__RegisterConstructors, Placename, PlacenameState, dPn__update } from './d_place_name.js';
import { GX_Program } from '../gx/gx_material.js';
import { Frustum } from '../Geometry.js';
import { projectionMatrixReverseDepth } from '../gfx/helpers/ReversedDepthHelpers.js';
import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers.js';

type SymbolData = { Filename: string, SymbolName: string, Data: ArrayBufferSlice };
type SymbolMapData = { SymbolData: SymbolData[] };

export class SymbolMap {
    private mapData: SymbolMapData;

    constructor(data: ArrayBufferSlice) {
        this.mapData = BYML.parse<SymbolMapData>(data, BYML.FileType.CRG1);
    }

    public findSymbolData(filename: string, symname: string): ArrayBufferSlice {
        return assertExists(this.mapData.SymbolData.find((e) => e.Filename === filename && e.SymbolName === symname)).Data;
    }
}

export interface dStage__ObjectNameTableEntry {
    pcName: number;
    subtype: number;
    gbaName: number;
};
type dStage__ObjectNameTable = { [name: string]: dStage__ObjectNameTableEntry };

function createRelNameTable(symbolMap: SymbolMap) {
    const nameTableBuf = symbolMap.findSymbolData(`c_dylink.o`, `DynamicNameTable`);
    const stringsBuf = symbolMap.findSymbolData(`c_dylink.o`, `@stringBase0`);
    const textDecoder = new TextDecoder('utf8') as TextDecoder;

    const nameTableView = nameTableBuf.createDataView();
    const stringsBytes = stringsBuf.createTypedArray(Uint8Array);
    const entryCount = nameTableView.byteLength / 8;

    // The REL table maps the 2-byte ID's from the Actor table to REL names
    // E.g. ID 0x01B8 -> 'd_a_grass'
    const relTable: { [id: number]: string } = {};

    for (let i = 0; i < entryCount; i++) {
        const offset = i * 8;
        const id = nameTableView.getUint16(offset + 0x00);
        const ptr = nameTableView.getUint32(offset + 0x04);
        const strOffset = ptr - 0x8033A648;
        const endOffset = stringsBytes.indexOf(0, strOffset);
        const relName = textDecoder.decode(stringsBytes.subarray(strOffset, endOffset));
        relTable[id] = relName;
    }

    return relTable;
}

function createActorTable(symbolMap: SymbolMap): dStage__ObjectNameTable {
    const data = symbolMap.findSymbolData(`d_stage.o`, `l_objectName`);
    const view = data.createDataView();

    // The object table consists of null-terminated ASCII strings of length 12.
    // @NOTE: None are longer than 7 characters
    const kNameLength = 12;
    const actorCount = data.byteLength / kNameLength;
    const actorTable: dStage__ObjectNameTable = {};
    for (let i = 0; i < actorCount; i++) {
        const offset = i * kNameLength;
        const name = readString(data, offset + 0x00, kNameLength);
        const id = view.getUint16(offset + 0x08, false);
        const subtype = view.getUint8(offset + 0x0A);
        const gbaName = view.getUint8(offset + 0x0B);
        actorTable[name] = { pcName: id, subtype, gbaName };
    }

    return actorTable;
}

class RenderHacks {
    public vertexColorsEnabled = true;
    public texturesEnabled = true;
    public objectsVisible = true;
    public wireframe = false;

    public renderHacksChanged = false;
}

const sceneParams = new SceneParams();

export class dGlobals {
    public g_env_light = new dScnKy_env_light_c();
    public dlst: dDlst_list_c;

    // This is tucked away somewhere in dComInfoPlay
    public stageName: string;
    public dStage_dt = new dStage_stageDt_c();
    public roomCtrl = new dStage_roomControl_c();
    public particleCtrl: dPa_control_c;

    public scnPlay: d_s_play;

    // "Current" room number.
    public mStayNo: number = 0;

    // g_dComIfG_gameInfo.mPlay.mpPlayer.mPos
    public playerPosition = vec3.create();
    // g_dComIfG_gameInfo.mPlay.mCameraInfo[0].mpCamera
    public camera = new dCamera_c();

    public resCtrl: dRes_control_c;
    // TODO(jstpierre): Remove
    public renderer: WindWakerRenderer;

    public quadStatic: dDlst_2DStatic_c;

    public renderHacks = new RenderHacks();

    private relNameTable: { [id: number]: string };
    private objectNameTable: dStage__ObjectNameTable;

    public sea: d_a_sea | null = null;

    constructor(public sceneContext: SceneContext, public modelCache: ModelCache, private extraSymbolData: SymbolMap, public frameworkGlobals: fGlobals) {
        this.resCtrl = this.modelCache.resCtrl;

        this.relNameTable = createRelNameTable(extraSymbolData);
        this.objectNameTable = createActorTable(extraSymbolData);

        this.quadStatic = new dDlst_2DStatic_c(modelCache.device, modelCache.cache);

        this.dlst = new dDlst_list_c(modelCache.device, modelCache.cache, extraSymbolData);
    }

    public dStage_searchName(name: string): dStage__ObjectNameTableEntry | null {
        const objName = this.objectNameTable[name];
        if (objName !== undefined)
            return objName;
        else
            return null;
    }

    public dStage__searchNameRev(processName: dProcName_e, subtype: number): string | null {
        for (const name in this.objectNameTable) {
            const entry = this.objectNameTable[name];
            if (entry.pcName === processName && entry.subtype === subtype)
                return name;
        }
        return null;
    }

    public objNameGetDbgName(objName: dStage__ObjectNameTableEntry): string {
        const pnameStr = `0x${hexzero(objName.pcName, 0x04)}`;
        const relName = this.relNameTable[objName.pcName] || 'built-in';
        return `${relName} (${pnameStr})`;
    }

    public findExtraSymbolData(filename: string, symname: string): ArrayBufferSlice {
        return this.extraSymbolData.findSymbolData(filename, symname);
    }

    public destroy(device: GfxDevice): void {
        this.particleCtrl.destroy(device);
        this.dlst.destroy(device);
        this.quadStatic.destroy(device);
    }
}

const enum CameraMode {
    Default,
    Cinematic
}

export class dCamera_c {
    public viewFromWorldMatrix = mat4.create(); // aka viewMatrix
    public worldFromViewMatrix = mat4.create(); // aka worldMatrix
    public clipFromWorldMatrix = mat4.create();
    public clipFromViewMatrix = mat4.create(); // aka projectionMatrix

    public clipSpaceNearZ: GfxClipSpaceNearZ;

    // Frustum is stored in Wind Waker engine world space.
    public frustum = new Frustum();
    public aspect = 1.0;
    public fovY = 0.0;
    public near = 0.0;
    public far = 0.0;

    // The current camera position, in Wind Waker engine world space.
    public cameraPos = vec3.create();
    public cameraFwd = vec3.create();
    public cameraUp = vec3.fromValues(0, 1, 0);
    public roll = 0.0;

    // For people to play around with.
    public frozen = false;

    private trimHeight = 0;
    private cameraMode: CameraMode = CameraMode.Default;
    private scissor = vec4.create();

    private static trimHeightCinematic = 65.0;

    public finishSetup(): void {
        mat4.invert(this.viewFromWorldMatrix, this.worldFromViewMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
        getMatrixAxisZ(this.cameraFwd, this.worldFromViewMatrix);
        this.frustum.updateClipFrustum(this.clipFromWorldMatrix, this.clipSpaceNearZ);
    }

    public setupFromCamera(camera: Camera): void {
        this.clipSpaceNearZ = camera.clipSpaceNearZ;
        this.aspect = camera.aspect;
        this.fovY = camera.fovY;

        mat4.copy(this.worldFromViewMatrix, camera.worldMatrix);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }

    public execute(globals: dGlobals, viewerInput: Viewer.ViewerRenderInput) {
        this.setupFromCamera(viewerInput.camera);

        // Near/far planes are decided by the stage data.
        const stag = globals.dStage_dt.stag;

        // Pull in the near plane to decrease Z-fighting, some stages set it far too close...
        this.near = Math.max(stag.nearPlane, 5);
        this.far = stag.farPlane;

        // noclip modification: if this is the sea map, push our far plane out a bit.
        if (globals.stageName === 'sea')
            this.far *= 2;

        // noclip modification: if we're paused, allow noclip camera control during demos
        const isPaused = viewerInput.deltaTime === 0;

        // dCamera_c::Store() sets the camera params if the demo camera is active
        const demoCam = globals.scnPlay.demo.getSystem().getCamera();
        if (demoCam && !isPaused) {
            const targetPos = vec3.add(scratchVec3a, this.cameraPos, this.cameraFwd);

            // TODO: Blend between these camera params when switching camera modes, instead of the sudden snap.

            if (demoCam.flags & EDemoCamFlags.HasTargetPos) { vec3.copy(targetPos, demoCam.targetPosition); }
            if (demoCam.flags & EDemoCamFlags.HasEyePos) { vec3.copy(this.cameraPos, demoCam.viewPosition); }
            if (demoCam.flags & EDemoCamFlags.HasUpVec) { vec3.copy(this.cameraUp, demoCam.upVector); }
            if (demoCam.flags & EDemoCamFlags.HasFovY) { this.fovY = demoCam.fovY * MathConstants.DEG_TO_RAD; }
            if (demoCam.flags & EDemoCamFlags.HasRoll) { this.roll = demoCam.roll * MathConstants.DEG_TO_RAD; }
            if (demoCam.flags & EDemoCamFlags.HasAspect) { debugger; /* Untested. Remove once confirmed working */ }
            if (demoCam.flags & EDemoCamFlags.HasNearZ) { this.near = demoCam.projNear; }
            if (demoCam.flags & EDemoCamFlags.HasFarZ) { this.far = demoCam.projFar; }

            mat4.targetTo(this.worldFromViewMatrix, this.cameraPos, targetPos, this.cameraUp);
            mat4.rotateZ(this.worldFromViewMatrix, this.worldFromViewMatrix, this.roll);

            // Keep noclip and demo cameras in sync. Ensures that when the user pauses, the camera doesn't snap to an old location
            mat4.copy(viewerInput.camera.worldMatrix, this.worldFromViewMatrix);
            viewerInput.camera.worldMatrixUpdated();

            this.cameraMode = CameraMode.Cinematic;
            globals.sceneContext.inputManager.isMouseEnabled = false;
        } else {
            this.cameraMode = CameraMode.Default;
            globals.sceneContext.inputManager.isMouseEnabled = true;
        }

        // Compute updated projection matrix
        const nearY = Math.tan(this.fovY * 0.5) * this.near;
        const nearX = nearY * this.aspect;
        projectionMatrixForFrustum(this.clipFromViewMatrix, -nearX, nearX, -nearY, nearY, this.near, this.far);
        projectionMatrixReverseDepth(this.clipFromViewMatrix);
        projectionMatrixConvertClipSpaceNearZ(this.clipFromViewMatrix, this.clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);

        this.finishSetup();

        // From dCamera_c::CalcTrimSize()
        // Animate up to the trim size for the current mode.
        if (this.cameraMode === CameraMode.Cinematic) {
            this.trimHeight += (dCamera_c.trimHeightCinematic - this.trimHeight) * 0.25;
        } else {
            this.trimHeight += -this.trimHeight * 0.25;
        }

        const trimPx = (this.trimHeight / 480) * viewerInput.backbufferHeight;
        vec4.set(this.scissor, 0, trimPx, viewerInput.backbufferWidth, viewerInput.backbufferHeight - 2 * trimPx);

        if (!this.frozen) {
            // Update the "player position" from the camera.
            vec3.copy(globals.playerPosition, this.cameraPos);
        }
    }

    public applyScissor(pass: GfxRenderPass) {
        pass.setScissor(this.scissor[0], this.scissor[1], this.scissor[2], this.scissor[3]);
    }
}

function gain(v: number, k: number): number {
    const a = 0.5 * Math.pow(2*((v < 0.5) ? v : 1.0 - v), k);
    return v < 0.5 ? a : 1.0 - a;
}

class DynToonTex {
    public gfxTexture: GfxTexture;
    public desiredPower: number = 0;
    private texPower: number = 0;
    private textureData: Uint8Array[] = [new Uint8Array(256*1*2)];

    constructor(device: GfxDevice) {
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RG_NORM, 256, 1, 1));
        device.setResourceName(this.gfxTexture, 'DynToonTex');
    }

    private fillTextureData(k: number): void {
        let dstOffs = 0;
        const dst = this.textureData[0];
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            dst[dstOffs++] = gain(t, k) * 255;
            // TODO(jstpierre): Lantern
            dst[dstOffs++] = 0;
        }
    }

    public prepareToRender(device: GfxDevice): void {
        if (this.texPower !== this.desiredPower) {
            this.texPower = this.desiredPower;

            // Recreate toon texture.
            this.fillTextureData(this.texPower);
            device.uploadTextureData(this.gfxTexture, 0, this.textureData);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class ZWWExtraTextures {
    public textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());
    public dynToonTex: DynToonTex;

    @dfRange(1, 15, 0.01)
    public toonTexPower: number = 15;

    constructor(device: GfxDevice, ZAtoon: BTIData, ZBtoonEX: BTIData) {
        ZAtoon.fillTextureMapping(this.textureMapping[0]);
        ZBtoonEX.fillTextureMapping(this.textureMapping[1]);
        this.dynToonTex = new DynToonTex(device);
    }

    public powerPopup(): void {
        this.textureMapping[0].gfxTexture = this.dynToonTex.gfxTexture;
        this.textureMapping[1].gfxTexture = this.dynToonTex.gfxTexture;

        window.main.ui.debugFloaterHolder.bindPanel(this);
    }

    public prepareToRender(device: GfxDevice): void {
        this.dynToonTex.desiredPower = this.toonTexPower;
        this.dynToonTex.prepareToRender(device);
    }

    public fillExtraTextures(modelInstance: J3DModelInstance): void {
        const ZAtoon_map = modelInstance.getTextureMappingReference('ZAtoon');
        if (ZAtoon_map !== null)
            ZAtoon_map.copy(this.textureMapping[0]);

        const ZBtoonEX_map = modelInstance.getTextureMappingReference('ZBtoonEX');
        if (ZBtoonEX_map !== null)
            ZBtoonEX_map.copy(this.textureMapping[1]);
    }

    public destroy(device: GfxDevice): void {
        this.dynToonTex.destroy(device);
    }
}

function fpcIsObject(n: dProcName_e): boolean {
    if (n === dProcName_e.d_a_bg)
        return false;

    return true;
}

function objectLayerVisible(layerMask: number, layer: number): boolean {
    if (layer < 0)
        return true;
    else
        return !!(layerMask & (1 << layer));
}

class WindWakerRoom {
    public name: string;

    constructor(public roomNo: number, public roomStatus: dStage_roomStatus_c) {
        this.name = `Room ${roomNo}`;
    }

    public get visible() { return this.roomStatus.visible; }
    public set visible(v: boolean) { this.roomStatus.visible = v; }
    public setVisible(v: boolean) { this.visible = v; }
}

const enum EffectDrawGroup {
    Main = 0,
    Indirect = 1,
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
export class WindWakerRenderer implements Viewer.SceneGfx {
    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
    private opaqueSceneTextureMapping = new TextureMapping();

    public renderHelper: GXRenderHelperGfx;

    public rooms: WindWakerRoom[] = [];
    public extraTextures: ZWWExtraTextures;
    public renderCache: GfxRenderCache;

    public time: number; // In milliseconds, affected by pause and time scaling
    public roomLayerMask: number = 0;

    public onstatechanged!: () => void;

    constructor(public device: GfxDevice, public globals: dGlobals) {
        this.renderHelper = new GXRenderHelperGfx(device);

        this.renderCache = this.renderHelper.renderInstManager.gfxRenderCache;
    }

    private setVisibleLayerMask(m: number): void {
        this.roomLayerMask = m;
    }

    public createPanels(): UI.Panel[] {
        const getScenarioMask = () => {
            let mask: number = 0;
            for (let i = 0; i < scenarioSelect.getNumItems(); i++)
                if (scenarioSelect.itemIsOn[i])
                    mask |= (1 << i);
            return mask;
        };
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(UI.LAYER_ICON, 'Layer Select');
        const scenarioSelect = new UI.MultiSelect();
        scenarioSelect.onitemchanged = () => {
            this.setVisibleLayerMask(getScenarioMask());
        };
        scenarioSelect.setStrings(range(0, 12).map((i) => `Layer ${i}`));
        scenarioSelect.setItemsSelected(range(0, 12).map((i) => i === 0));
        this.setVisibleLayerMask(0x01);
        scenarioPanel.contents.append(scenarioSelect.elem);

        const roomsPanel = new UI.LayerPanel();
        roomsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        roomsPanel.setTitle(UI.LAYER_ICON, 'Rooms');
        roomsPanel.setLayers(this.rooms);

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            this.globals.renderHacks.vertexColorsEnabled = enableVertexColorsCheckbox.checked;
            this.globals.renderHacks.renderHacksChanged = true;
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            this.globals.renderHacks.texturesEnabled = enableTextures.checked;
            this.globals.renderHacks.renderHacksChanged = true;
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const enableObjects = new UI.Checkbox('Enable Objects', true);
        enableObjects.onchanged = () => {
            this.globals.renderHacks.objectsVisible = enableObjects.checked;
        };
        renderHacksPanel.contents.appendChild(enableObjects.elem);

        if (this.renderHelper.device.queryLimits().wireframeSupported) {
            const wireframe = new UI.Checkbox('Wireframe', false);
            wireframe.onchanged = () => {
                this.globals.renderHacks.wireframe = wireframe.checked;
            };
            renderHacksPanel.contents.appendChild(wireframe.elem);
        }

        return [roomsPanel, scenarioPanel, renderHacksPanel];
    }

    private getRoomStatus(ac: fopAc_ac_c): dStage_roomStatus_c | null {
        if (ac.roomNo === -1)
            return null;

        return this.globals.roomCtrl.status[ac.roomNo];
    }

    private getSingleRoomVisible(): number {
        let count = 0;
        for (let i = 0; i < this.rooms.length; i++)
            if (this.rooms[i].visible)
                count++;
        if (count === 1)
            for (let i = 0; i < this.rooms.length; i++)
                if (this.rooms[i].visible)
                    return this.rooms[i].roomNo;
        return -1;
    }

    private executeDrawAll(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const globals = this.globals;

        this.time = viewerInput.time;

        // noclip hack: if only one room is visible, make it the mStayNo
        const singleRoomVisibleNo = this.getSingleRoomVisible();
        if (singleRoomVisibleNo !== -1)
            globals.mStayNo = singleRoomVisibleNo;

        // Update actor visibility from settings.
        // TODO(jstpierre): Figure out a better place to put this?
        const fwGlobals = globals.frameworkGlobals;
        for (let i = 0; i < fwGlobals.dwQueue.length; i++) {
            for (let j = 0; j < fwGlobals.dwQueue[i].length; j++) {
                const ac = fwGlobals.dwQueue[i][j];
                if (ac instanceof fopAc_ac_c) {
                    const roomStatus = this.getRoomStatus(ac);
                    const roomVisible = roomStatus !== null ? roomStatus.visible : true;

                    ac.roomVisible = roomVisible && objectLayerVisible(this.roomLayerMask, ac.roomLayer);

                    if (ac.roomVisible && !globals.renderHacks.objectsVisible && fpcIsObject(ac.processName))
                        ac.roomVisible = false;
                }
            }
        }

        globals.camera.execute(globals, viewerInput);

        // Not sure exactly where this is ordered...
        dKy_setLight(globals);

        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        if (globals.renderHacks.wireframe)
            template.setMegaStateFlags({ wireframe: true });

        mat4.copy(sceneParams.u_Projection, globals.camera.clipFromViewMatrix);
        sceneParams.u_SceneTextureLODBias = calcLODBias(viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        let offs = template.getUniformBufferOffset(GX_Program.ub_SceneParams);
        const d = template.mapUniformBufferF32(GX_Program.ub_SceneParams);
        fillSceneParamsData(d, offs, sceneParams);

        this.extraTextures.prepareToRender(device);

        fpcM_Management(globals.frameworkGlobals, globals, renderInstManager, viewerInput);

        const dlst = globals.dlst;

        renderInstManager.setCurrentList(dlst.alphaModel);
        dlst.alphaModel0.draw(globals, renderInstManager, viewerInput);

        renderInstManager.setCurrentList(dlst.bg[0]);
        {
            globals.particleCtrl.calc(globals, viewerInput);

            for (let group = EffectDrawGroup.Main; group <= EffectDrawGroup.Indirect; group++) {
                let texPrjMtx: mat4 | null = null;

                if (group === EffectDrawGroup.Indirect) {
                    texPrjMtx = scratchMatrix;
                    texProjCameraSceneTex(texPrjMtx, globals.camera.clipFromViewMatrix, 1);
                }

                globals.particleCtrl.setDrawInfo(globals.camera.viewFromWorldMatrix, globals.camera.clipFromViewMatrix, texPrjMtx, globals.camera.frustum);
                renderInstManager.setCurrentList(dlst.effect[group]);
                globals.particleCtrl.draw(device, this.renderHelper.renderInstManager, group);
            }
        }

        this.renderHelper.renderInstManager.popTemplate();
        globals.renderHacks.renderHacksChanged = false;
    }

    private executeList(passRenderer: GfxRenderPass, list: GfxRenderInstList): void {
        list.drawOnPassRenderer(this.renderCache, passRenderer);
    }

    private executeListSet(passRenderer: GfxRenderPass, listSet: dDlst_list_Set): void {
        this.executeList(passRenderer, listSet[0]);
        this.executeList(passRenderer, listSet[1]);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const dlst = this.globals.dlst;
        dlst.peekZ.beginFrame(device);

        this.executeDrawAll(device, viewerInput);

        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        setBackbufferDescSimple(this.mainColorDesc, viewerInput);
        this.mainColorDesc.clearColor = TransparentBlack;

        this.mainDepthDesc.copyDimensions(this.mainColorDesc);
        this.mainDepthDesc.clearDepth = standardFullClearRenderPassDescriptor.clearDepth!;

        const mainColorTargetID = builder.createRenderTargetID(this.mainColorDesc, 'Main Color');

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.executeListSet(passRenderer, dlst.sky);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Main Depth');

        builder.pushPass((pass) => {
            pass.setDebugName('Main');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.executeList(passRenderer, dlst.sea);
                this.executeListSet(passRenderer, dlst.bg);

                // Execute our alpha model stuff.
                this.executeList(passRenderer, dlst.alphaModel);

                this.executeList(passRenderer, dlst.effect[EffectDrawGroup.Main]);
                this.executeList(passRenderer, dlst.wetherEffect);
                this.executeListSet(passRenderer, dlst.ui);
            });
        });

        dlst.peekZ.pushPasses(renderInstManager, builder, mainDepthTargetID);
        dlst.peekZ.peekData(device);

        builder.pushPass((pass) => {
            pass.setDebugName('Indirect');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(opaqueSceneTextureID);
            pass.exec((passRenderer, scope) => {
                this.opaqueSceneTextureMapping.gfxTexture = scope.getResolveTextureForID(opaqueSceneTextureID);
                dlst.effect[EffectDrawGroup.Indirect].resolveLateSamplerBinding('OpaqueSceneTexture', this.opaqueSceneTextureMapping);
                this.executeList(passRenderer, dlst.effect[EffectDrawGroup.Indirect]);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.extraTextures.destroy(device);
        this.globals.destroy(device);
        this.globals.frameworkGlobals.delete(this.globals);
    }
}

export class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private archivePromiseCache = new Map<string, Promise<RARC.JKRArchive>>();
    private archiveCache = new Map<string, RARC.JKRArchive>();
    public cache: GfxRenderCache;

    public resCtrl = new dRes_control_c();
    public currentStage: string;

    constructor(public device: GfxDevice, private dataFetcher: DataFetcher) {
        this.cache = new GfxRenderCache(device);
    }

    public waitForLoad(): Promise<any> {
        const v: Promise<any>[] = [... this.filePromiseCache.values(), ... this.archivePromiseCache.values()];
        return Promise.all(v);
    }

    private fetchFile(path: string, cacheBust: number = 0): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        let fetchPath = `${pathBase}/${path}`;
        if (cacheBust > 0)
            fetchPath = `${fetchPath}?cache_bust=${cacheBust}`;
        const p = this.dataFetcher.fetchData(fetchPath, { abortedCallback: () => {
            this.filePromiseCache.delete(path);
        } });
        this.filePromiseCache.set(path, p);
        return p;
    }

    public fetchFileData(path: string, cacheBust: number = 0): Promise<ArrayBufferSlice> {
        const p = this.filePromiseCache.get(path);
        if (p !== undefined) {
            return p.then(() => this.getFileData(path));
        } else {
            return this.fetchFile(path, cacheBust).then((data) => {
                this.fileDataCache.set(path, data);
                return data;
            });
        }
    }

    public getFileData(path: string): ArrayBufferSlice {
        return assertExists(this.fileDataCache.get(path));
    }

    private async requestArchiveDataInternal(archivePath: string): Promise<RARC.JKRArchive> {
        let fetchPath = `${pathBase}/${archivePath}`;
        let buffer: ArrayBufferSlice = await this.dataFetcher.fetchData(fetchPath, { abortedCallback: () => {
            this.archivePromiseCache.delete(archivePath);
        } });

        if (readString(buffer, 0x00, 0x04) === 'Yaz0')
            buffer = Yaz0.decompress(buffer);

        const rarc = RARC.parse(buffer, '');
        this.archiveCache.set(archivePath, rarc);
        return rarc;
    }

    public fetchArchive(archivePath: string): Promise<RARC.JKRArchive> {
        if (this.archivePromiseCache.has(archivePath))
            return this.archivePromiseCache.get(archivePath)!;

        const p = this.requestArchiveDataInternal(archivePath);
        this.archivePromiseCache.set(archivePath, p);
        return p;
    }

    public setCurrentStage(stageName: string): void {
        this.currentStage = stageName;
        this.resCtrl.destroyList(this.device, this.resCtrl.resStg);
    }

    public async fetchObjectData(arcName: string): Promise<RARC.JKRArchive> {
        const archive = await this.fetchArchive(`Object/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resObj);
        return archive;
    }

    public async fetchMsgData(arcName: string) {
        const archive = await this.fetchArchive(`Msg/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resSystem);
    }

    public requestFileData(path: string): cPhs__Status {
        if (this.fileDataCache.has(path))
            return cPhs__Status.Complete;

        if (!this.filePromiseCache.has(path))
            this.fetchFileData(path);

        return cPhs__Status.Loading;
    }

    public requestObjectData(arcName: string): cPhs__Status {
        const archivePath = `Object/${arcName}.arc`;

        if (this.archiveCache.has(archivePath))
            return cPhs__Status.Complete;

        if (!this.archivePromiseCache.has(archivePath))
            this.fetchObjectData(arcName);

        return cPhs__Status.Loading;
    }

    public requestMsgData(arcName: string): cPhs__Status {
        const archivePath = `Msg/${arcName}.arc`;

        if (this.archiveCache.has(archivePath))
            return cPhs__Status.Complete;

        if (!this.archivePromiseCache.has(archivePath))
            this.fetchMsgData(arcName);

        return cPhs__Status.Loading;
    }

    public async fetchStageData(arcName: string): Promise<void> {
        const archive = await this.fetchArchive(`Stage/${this.currentStage}/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resStg);
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy();
        this.resCtrl.destroy(device);
    }
}

export const pathBase = `ZeldaWindWaker`;

class d_s_play extends fopScn {
    public bgS = new dBgS();
    public demo: dDemo_manager_c;

    public flowerPacket: FlowerPacket;
    public treePacket: TreePacket;
    public grassPacket: GrassPacket;
    public woodPacket: WoodPacket;

    public vrboxLoaded: boolean = false;
    public placenameIndex: Placename;
    public placenameState: PlacenameState;

    public override load(globals: dGlobals, userData: any): cPhs__Status {
        super.load(globals, userData);

        this.demo = new dDemo_manager_c(globals);

        this.treePacket = new TreePacket(globals);
        this.flowerPacket = new FlowerPacket(globals);
        this.grassPacket = new GrassPacket(globals);
        this.woodPacket = new WoodPacket(globals);

        globals.scnPlay = this;

        return cPhs__Status.Complete;
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.demo.update();

        // From d_menu_window::dMs_placenameMove()
        dPn__update(globals);

        // From executeEvtManager() -> SpecialProcPackage()
        if (this.demo.getMode() === EDemoMode.Ended) {
            this.demo.remove();
        }
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        // Magma/Grass/Trees/Bushes/Flowers
        const frameCount = viewerInput.time / 1000.0 * 30;

        this.flowerPacket.calc(frameCount);
        this.treePacket.calc(frameCount);
        this.grassPacket.calc(frameCount);
        this.woodPacket.calc(globals, frameCount);

        this.flowerPacket.update(globals);
        this.treePacket.update(globals);
        this.grassPacket.update(globals);
        this.woodPacket.update(globals);

        fopDw_Draw(globals.frameworkGlobals, globals, renderInstManager, viewerInput);

        this.flowerPacket.draw(globals, renderInstManager, viewerInput);
        this.treePacket.draw(globals, renderInstManager, viewerInput);
        this.grassPacket.draw(globals, renderInstManager, viewerInput);
        this.woodPacket.draw(globals, renderInstManager, viewerInput);
    }

    public override delete(globals: dGlobals): void {
        super.delete(globals);

        const device = globals.modelCache.device;
        this.flowerPacket.destroy(device);
        this.treePacket.destroy(device);
        this.grassPacket.destroy(device);
        this.woodPacket.destroy(device);
    }
}

class SceneDesc {
    public id: string;
    protected globals: dGlobals;

    public constructor(public stageDir: string, public name: string, public roomList: number[] = [0]) {
        this.id = stageDir;

        // Garbage hack.
        if (this.stageDir === 'sea' && roomList.length === 1)
            this.id = `Room${roomList[0]}.arc`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = await context.dataShare.ensureObject<ModelCache>(`${pathBase}/ModelCache`, async () => {
            return new ModelCache(context.device, context.dataFetcher);
        });

        modelCache.setCurrentStage(this.stageDir);

        modelCache.fetchObjectData(`System`);
        modelCache.fetchObjectData(`Always`);
        modelCache.fetchStageData(`Stage`);

        modelCache.fetchFileData(`extra.crg1_arc`, 10);
        modelCache.fetchFileData(`f_pc_profiles.crg1_arc`);

        const particleArchives = [
            `Particle/common.jpc`,
            `Particle/Pscene254.jpc`,
        ];

        for (let i = 0; i < particleArchives.length; i++)
            modelCache.fetchFileData(particleArchives[i]);

        // XXX(jstpierre): This is really terrible code.
        for (let i = 0; i < this.roomList.length; i++) {
            const roomIdx = Math.abs(this.roomList[i]);
            modelCache.fetchStageData(`Room${roomIdx}`);
        }

        await modelCache.waitForLoad();

        const f_pc_profiles = BYML.parse<fpc_pc__ProfileList>(modelCache.getFileData(`f_pc_profiles.crg1_arc`), BYML.FileType.CRG1);
        const framework = new fGlobals(f_pc_profiles);

        fpcPf__Register(framework, dProcName_e.d_s_play, d_s_play);
        dKy__RegisterConstructors(framework);
        dKyw__RegisterConstructors(framework);
        d_a__RegisterConstructors(framework);
        d_pn__RegisterConstructors(framework);
        LegacyActor__RegisterFallbackConstructor(framework);

        const symbolMap = new SymbolMap(modelCache.getFileData(`extra.crg1_arc`));
        const globals = new dGlobals(context, modelCache, symbolMap, framework);
        this.globals = globals;
        globals.stageName = this.stageDir;

        const renderer = new WindWakerRenderer(device, globals);
        context.destroyablePool.push(renderer);
        globals.renderer = renderer;

        const pcId = fpcSCtRq_Request(framework, null, dProcName_e.d_s_play, null);
        assert(pcId !== null);

        fpcCt_Handler(globals.frameworkGlobals, globals);
        assert(globals.scnPlay !== undefined);

        // Set the stage as the active layer.
        // Normally, all of this would be done in d_scn_play.
        fpcLy_SetCurrentLayer(globals.frameworkGlobals, globals.scnPlay.layer);

        const resCtrl = modelCache.resCtrl;

        const sysRes = assertExists(resCtrl.findResInfo(`System`, resCtrl.resObj));
        const ZAtoon   = sysRes.getResByIndex(ResType.Bti, 0x03);
        const ZBtoonEX = sysRes.getResByIndex(ResType.Bti, 0x04);

        const dzs = assertExists(resCtrl.getStageResByName(ResType.Dzs, `Stage`, `stage.dzs`));

        dStage_dt_c_stageInitLoader(globals, globals.dStage_dt, dzs);
        dStage_dt_c_stageLoader(globals, globals.dStage_dt, dzs);

        // If this is a single-room scene, then set mStayNo.
        if (this.roomList.length === 1)
            globals.mStayNo = Math.abs(this.roomList[0]);

        renderer.extraTextures = new ZWWExtraTextures(device, ZAtoon, ZBtoonEX);

        const jpac: JPA.JPAC[] = [];
        for (let i = 0; i < particleArchives.length; i++) {
            const jpacData = modelCache.getFileData(particleArchives[i]);
            jpac.push(JPA.parse(jpacData));
        }
        globals.particleCtrl = new dPa_control_c(renderer.renderCache, jpac);

        // dStage_Create
        dKankyo_create(globals);

        // mRoomCtrl::init()
        // dStage_dt_c_stageLoader()
        // dMap_c::create()

        globals.roomCtrl.demoArcName = null;

        const vrbox = resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_sky.bdl`);
        if (vrbox !== null) {
            fpcSCtRq_Request(framework, null, dProcName_e.d_a_vrbox, null);
            fpcSCtRq_Request(framework, null, dProcName_e.d_a_vrbox2, null);
        }

        for (let i = 0; i < this.roomList.length; i++) {
            const roomNo = Math.abs(this.roomList[i]);

            const visible = this.roomList[i] >= 0;
            const roomStatus = globals.roomCtrl.status[i];
            roomStatus.visible = visible;
            renderer.rooms.push(new WindWakerRoom(roomNo, roomStatus));

            // objectSetCheck

            // noclip modification: We pass in roomNo so it's attached to the room.
            fopAcM_create(framework, dProcName_e.d_a_bg, roomNo, null, roomNo, null, null, 0xFF, -1);

            const dzr = assertExists(resCtrl.getStageResByName(ResType.Dzs, `Room${roomNo}`, `room.dzr`));
            dStage_dt_c_roomLoader(globals, globals.roomCtrl.status[roomNo].data, dzr);
            dStage_dt_c_roomReLoader(globals, globals.roomCtrl.status[roomNo].data, dzr);
        }

        return renderer;
    }
}

class DemoDesc extends SceneDesc implements Viewer.SceneDesc {
    private scene: SceneDesc;

    public constructor(
        public override stageDir: string,
        public override name: string,
        public override roomList: number[],
        public stbFilename: string, 
        public layer: number,
        public offsetPos?:vec3, 
        public rotY: number = 0,
        public startCode?: number,
        public eventFlags?: number,
        public startFrame?: number, // noclip modification for easier debugging
    ) {
        super(stageDir, name, roomList);
        assert(this.roomList.length === 1);

        // Use a distinct ID for demos so that we don't conflict with the non-demo version of this stage. 
        // Without this, going to a scene like Outset Island and reloading will select the first Outset Island demo.  
        this.id = this.stbFilename.slice(0, -4);
    }

    public override async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const res = await super.createScene(device, context);
        this.playDemo(this.globals);
        return res;
    }

    async playDemo(globals: dGlobals) {
        globals.scnPlay.demo.remove();

        // TODO: Don't render until the camera has been placed for this demo. The cuts are jarring.
    
        // noclip modification: This normally happens on room load. Do it here instead so that we don't waste time 
        //                      loading .arcs for cutscenes that aren't going to be played
        const lbnk = globals.roomCtrl.status[this.roomList[0]].data.lbnk;
        if (lbnk) {
            const bank = lbnk[this.layer];
            if (bank !== 0xFF) {
                assert(bank >= 0 && bank < 100);
                globals.roomCtrl.demoArcName = `Demo${bank.toString().padStart(2, '0')}`;
                console.debug(`Loading stage demo file: ${globals.roomCtrl.demoArcName}`);

                globals.modelCache.fetchObjectData(globals.roomCtrl.demoArcName).catch(e => {
                    // @TODO: Better error handling. This does not prevent a debugger break.
                    console.log(`Failed to load stage demo file: ${globals.roomCtrl.demoArcName}`, e);
                })
            }
        }

        await globals.modelCache.waitForLoad();

        // Most cutscenes expect the Link actor to be loaded
        if(!fopAcM_searchFromName(globals, 'Link', 0, 0)) {
            fopAcM_create(globals.frameworkGlobals, dProcName_e.d_a_py_lk, 0, null, globals.mStayNo, null, null, 0xFF, -1);
        }

        // noclip modification: ensure all the actors are created before we load the cutscene
        await new Promise(resolve => { (function waitForActors(){
            if (globals.frameworkGlobals.ctQueue.length === 0) return resolve(null);
            setTimeout(waitForActors, 30);
        })(); });

        // @TODO: Set noclip layer visiblity based on this.layer

        // From dEvDtStaff_c::specialProcPackage()
        let demoData;
        if(globals.roomCtrl.demoArcName)
            demoData = globals.modelCache.resCtrl.getObjectResByName(ResType.Stb, globals.roomCtrl.demoArcName, this.stbFilename);
        if (!demoData)
            demoData = globals.modelCache.resCtrl.getStageResByName(ResType.Stb, "Stage", this.stbFilename);
        
        if( demoData ) { globals.scnPlay.demo.create(this.id, demoData, this.offsetPos, this.rotY / 180.0 * Math.PI, this.startFrame); }
        else { console.warn('Failed to load demo data:', this.stbFilename); }

        return this.globals.renderer;
    }
}

// Move these into sceneDescs once they are complete enough to be worth viewing.
// Extracted from the game using a modified version of the excellent wwrando/wwlib/stage_searcher.py script from LagoLunatic
// Most of this data comes from the PLAY action of the PACKAGE actor in an event from a Stage's event_list.dat. This
// action has properties for the room and layer that these cutscenes are designed for. HOWEVER, this data is often missing.
// It has been reconstructed by cross-referencing each Room's lbnk section (which points to a Demo*.arc file for each layer),
// the .stb files contained in each of those Objects/Demo*.arc files, and the FileName attribute from the event action.   
const demoDescs = [
    new DemoDesc("sea", "Pirate Zelda Fly", [44], "kaizoku_zelda_fly.stb", 0, [-200000.0, 0.0, 320000.0], 180.0, 0, 0),
    new DemoDesc("sea", "Zola Awakens", [13], "awake_zola.stb", 8, [200000.0, 0.0, -200000.0], 0, 227, 0),
    new DemoDesc("sea", "Get Komori Pearl", [13], "getperl_komori.stb", 9, [200000.0, 0.0, -200000.0], 0, 0, 0),
    new DemoDesc("sea", "Meet the King of Red Lions", [11], "meetshishioh.stb", 8, [0.0, 0.0, -200000.0], 0, 128, 0),
    new DemoDesc("sea", "Fairy", [9], "fairy.stb", 8, [-180000.0, 740.0, -199937.0], 25.0, 2, 0),
    new DemoDesc("sea", "fairy_flag_on.stb", [9], "fairy_flag_on.stb", 8, [-180000.0, 740.0, -199937.0], 25.0, 2, 0),
    new DemoDesc("ADMumi", "warp_in.stb", [0], "warp_in.stb", 9, [0.0, 0.0, 0.0], 0.0, 200, 0),
    new DemoDesc("ADMumi", "warphole.stb", [0], "warphole.stb", 10, [0.0, 0.0, 0.0], 0.0, 219, 0),
    new DemoDesc("ADMumi", "runaway_majuto.stb", [0], "runaway_majuto.stb", 11, [0, 0, 0], 0, 0, 0),
    new DemoDesc("ADMumi", "towerd.stb", [0], "towerd.stb", 8, [-50179.0, -1000.0, 7070.0], 90.0, 0, 0),
    new DemoDesc("ADMumi", "towerf.stb", [0], "towerf.stb", 8, [-50179.0, -1000.0, 7070.0], 90.0, 0, 0),
    new DemoDesc("ADMumi", "towern.stb", [0], "towern.stb", 8, [-50179.0, -1000.0, 7070.0], 90.0, 0, 0),
    new DemoDesc("A_mori", "meet_tetra.stb", [0], "meet_tetra.stb", 0, [0, 0, 0], 0, 0, 0),
    new DemoDesc("Adanmae", "howling.stb", [0], "howling.stb", 8, [0.0, 0.0, 0.0], 0.0, 0, 0),
    new DemoDesc("Atorizk", "dragontale.stb", [0], "dragontale.stb", 0, [0, 0, 0], 0, 0, 0),
    new DemoDesc("ENDumi", "ending.stb", [0], "ending.stb", 8, [0.0, 0.0, 0.0], 0.0, 0, 0),
    new DemoDesc("Edaichi", "dance_zola.stb", [0], "dance_zola.stb", 8, [0.0, 0.0, 0.0], 0, 226, 0),
    new DemoDesc("Ekaze", "dance_kokiri.stb", [0], "dance_kokiri.stb", 8, [0.0, 0.0, 0.0], 0, 229, 0),
    new DemoDesc("GTower", "g2before.stb", [0], "g2before.stb", 8, [0.0, 0.0, 0.0], 0.0, 0, 0),
    new DemoDesc("GTower", "endhr.stb", [0], "endhr.stb", 9, [0.0, 0.0, 0.0], 0.0, 0, 0),
    new DemoDesc("GanonK", "kugutu_ganon.stb", [0], "kugutu_ganon.stb", 8, [0.0, 0.0, 0.0], 0.0, 0, 0),
    new DemoDesc("GanonK", "to_roof.stb", [0], "to_roof.stb", 9, [0.0, 0.0, 0.0], 0.0, 4, 0),
    new DemoDesc("Hyroom", "rebirth_hyral.stb", [0], "rebirth_hyral.stb", 8, [0.0, -2100.0, 3910.0], 0.0, 249, 0),
    new DemoDesc("Hyrule", "warp_out.stb", [0], "warp_out.stb", 8, [0, 0, 0], 0, 201, 0),
    new DemoDesc("Hyrule", "seal.stb", [0], "seal.stb", 4, [0.0, 0.0, 0.0], 0, 0, 0),
    new DemoDesc("LinkRM", "tale.stb", [0], "tale.stb", 8, [0, 0, 0], 0, 0, 0),
    new DemoDesc("LinkRM", "tale_2.stb", [0], "tale_2.stb", 8, [0, 0, 0], 0, 0, 0),
    new DemoDesc("LinkRM", "get_shield.stb", [0], "get_shield.stb", 9, [0, 0, 0], 0, 201, 0),
    new DemoDesc("LinkRM", "tale_2.stb", [0], "tale_2.stb", 8, [0, 0, 0], 0, 0, 0),
    new DemoDesc("M2ganon", "attack_ganon.stb", [0], "attack_ganon.stb", 1, [2000.0, 11780.0, -8000.0], 0.0, 244, 0),
    new DemoDesc("M2tower", "rescue.stb", [0], "rescue.stb", 1, [3214.0, 3939.0, -3011.0], 57.5, 20, 0),
    new DemoDesc("M_DaiB", "pray_zola.stb", [0], "pray_zola.stb", 8, [0, 0, 0], 0, 229, 0),
    new DemoDesc("MajyuE", "maju_shinnyu.stb", [0], "maju_shinnyu.stb", 0, [0, 0, 0], 0, 0, 0),
    new DemoDesc("Mjtower", "find_sister.stb", [0], "find_sister.stb", 0, [4889.0, 0.0, -2635.0], 57.5, 0, 0),
    new DemoDesc("Obombh", "bombshop.stb", [0], "bombshop.stb", 0, [0.0, 0.0, 0.0], 0.0, 200, 0),
    new DemoDesc("Omori", "getperl_deku.stb", [0], "getperl_deku.stb", 9, [0, 0, 0], 0, 214, 0),
    new DemoDesc("Omori", "meet_deku.stb", [0], "meet_deku.stb", 8, [0, 0, 0], 0, 213, 0),
    new DemoDesc("Otkura", "awake_kokiri.stb", [0], "awake_kokiri.stb", 8, [0, 0, 0], 0, 0, 0),
    new DemoDesc("Pjavdou", "getperl_jab.stb", [0], "getperl_jab.stb", 8, [0.0, 0.0, 0.0], 0.0, 0, 0),
    new DemoDesc("kazeB", "pray_kokiri.stb", [0], "pray_kokiri.stb", 8, [0.0, 300.0, 0.0], 0.0, 232, 0),
    new DemoDesc("kenroom", "awake_zelda.stb", [0], "awake_zelda.stb", 9, [0.0, 0.0, 0.0], 0.0, 2, 0),
    new DemoDesc("kenroom", "master_sword.stb", [0], "master_sword.stb", 0, [-124.0, -3223.0, -7823.0], 180.0, 248, 0),
    new DemoDesc("kenroom", "swing_sword.stb", [0], "swing_sword.stb", 10, [-124.0, -3223.0, -7823.0], 180.0, 249, 0),

    // These are present in the sea_T event_list.dat, but not in the room's lbnk. They are only playable from "sea".
    new DemoDesc("sea_T", "Awaken", [0xFF], "awake.stb", 0, [-220000.0, 0.0, 320000.0], 0.0, 0, 0),
    new DemoDesc("sea_T", "Departure", [0xFF], "departure.stb", 0, [-200000.0, 0.0, 320000.0], 0.0, 0, 0),
    new DemoDesc("sea_T", "PirateZeldaFly", [0xFF], "kaizoku_zelda_fly.stb", 0, [-200000.0, 0.0, 320000.0], 180.0, 0, 0),

    // The game expects this STB file to be in Stage/Ocean/Stage.arc, but it is not. Must be a leftover. 
    new DemoDesc("Ocean", "counter.stb", [-1], "counter.stb", 0, [0, 0, 0], 0, 0, 0),
]

// Location names taken from CryZe's Debug Menu.
// https://github.com/CryZe/WindWakerDebugMenu/blob/master/src/warp_menu/consts.rs
const sceneDescs = [
    "The Great Sea",
    new SceneDesc("sea", "The Great Sea", [
        1,  2,  3,  4,  5,  6,  7,
        8,  9, 10, 11, 12, 13, 14,
       15, 16, 17, 18, 19, 20, 21,
       22, 23, 24, 25, 26, 27, 28,
       29, 30, 31, 32, 33, 34, 35,
       36, 37, 38, 39, 40, 41, 42,
       43, 44, 45, 46, 47, 48, 49,
    ]),

    new SceneDesc("Asoko", "Tetra's Ship"),
    new SceneDesc("Abship", "Submarine"),
    new SceneDesc("Abesso", "Cabana"),
    new SceneDesc("Ocean", "Boating Course"),
    new SceneDesc("ShipD", "Islet of Steel"),
    new SceneDesc("PShip", "Ghost Ship"),
    new SceneDesc("Obshop", "Beedle's Shop", [1]),

    "Cutscenes",
    new DemoDesc("sea_T", "Title Screen", [44], "title.stb", 0, [-220000.0, 0.0, 320000.0], 180.0, 0, 0),
    new DemoDesc("sea", "Awaken", [44], "awake.stb", 0, [-220000.0, 0.0, 320000.0], 0.0, 0, 0),
    new DemoDesc("sea", "Stolen Sister", [44], "stolensister.stb", 9, [0.0, 0.0, 20000.0], 0, 0, 0),
    new DemoDesc("sea", "Departure", [44], "departure.stb", 10, [-200000.0, 0.0, 320000.0], 0.0, 204, 0),

    "Outset Island",
    new SceneDesc("sea_T", "Title Screen", [44]),
    new SceneDesc("sea", "Outset Island", [44]),
    new SceneDesc("LinkRM", "Link's House"),
    new SceneDesc("LinkUG", "Under Link's House"),
    new SceneDesc("A_mori", "Forest of Fairies"),
    new SceneDesc("Ojhous", "Orca's House", [0]), // I forget who lives upstairs
    new SceneDesc("Omasao", "Mesa's House"),
    new SceneDesc("Onobuta", "Abe and Rose's House"),
    new SceneDesc("Pjavdou", "Jabun's Cavern"),

    "Forsaken Fortress",
    new SceneDesc("MajyuE", "Forsaken Fortress Exterior (First Visit)"),
    // new SceneDesc("sea", "Forsaken Fortress Exterior (Second & Third Visits)", [1]),
    new SceneDesc("majroom", "Interior (First Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("ma2room", "Interior (Second Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("ma3room", "Interior (Third  Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("Mjtower", "The Tower (First Visit)"),
    new SceneDesc("M2tower", "The Tower (Second Visit)"),
    new SceneDesc("M2ganon", "Ganondorf's Room"),

    "Windfall Island",
    new SceneDesc("sea", "Windfall Island", [11]),
    new SceneDesc("Kaisen", "Battleship Game Room"),
    new SceneDesc("Nitiyou", "School of Joy"),
    new SceneDesc("Obombh", "Bomb Shop"),
    new SceneDesc("Ocmera", "Lenzo's House"),
    new SceneDesc("Opub", "Cafe Bar"),
    new SceneDesc("Orichh", "House of Wealth"),
    new SceneDesc("Pdrgsh", "Chu Jelly Juice Shop"),
    new SceneDesc("Pnezumi", "Jail"),

    "Dragon Roost",
    new SceneDesc("sea", "Dragon Roost Island", [13]),
    new SceneDesc("Adanmae", "Pond"),
    new SceneDesc("Comori", "Komali's Room"),
    new SceneDesc("Atorizk", "Postal Service"),
    new SceneDesc("M_NewD2", "Dragon Roost Cavern", [0, 1, 2, -3, 4, -5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]),
    new SceneDesc("M_DragB", "Boss Room"),
    new SceneDesc("M_Dra09", "Mini Boss Room", [9]),

    "Forest Haven",
    new SceneDesc("sea", "Forest Haven Island", [41]),
    new SceneDesc("Omori", "Forest Haven Interior"),
    new SceneDesc("Ocrogh", "Potion Room"),
    new SceneDesc("Otkura", "Makar's Hiding Place"),

    "Forbidden Woods",
    new SceneDesc("kindan", "Forbidden Woods", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    new SceneDesc("kinBOSS", "Boss Room"),
    new SceneDesc("kinMB", "Mini Boss Room", [10]),

    "Tower of the Gods",
    new SceneDesc("Siren", "Tower of the Gods", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, -15, 16, 17, -18, 19, 20, 21, 22, -23]),
    new SceneDesc("SirenB", "Boss Room"),
    new SceneDesc("SirenMB", "Mini Boss Room", [23]),

    "Hyrule",
    new SceneDesc("Hyrule", "Hyrule Field"),
    new SceneDesc("Hyroom", "Hyrule Castle"),
    new SceneDesc("kenroom", "Master Sword Chamber"),

    "Earth Temple",
    new SceneDesc("Edaichi", "Entrance"),
    new SceneDesc("M_Dai", "Earth Temple", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
    new SceneDesc("M_DaiB", "Boss Room"),
    new SceneDesc("M_DaiMB", "Mini Boss Room", [12]),

    "Wind Temple",
    new SceneDesc("Ekaze", "Wind Temple Entrance"),
    new SceneDesc("kaze", "Wind Temple", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    new SceneDesc("kazeB", "Boss Room"),
    new SceneDesc("kazeMB", "Mini Boss Room", [6]),

    "Ganon's Tower",
    new SceneDesc("GanonA", "Entrance", [0, 1]),
    new SceneDesc("GanonB", "Room Towards Gohma"),
    new SceneDesc("GanonC", "Room Towards Molgera"),
    new SceneDesc("GanonD", "Room Towards Kalle Demos"),
    new SceneDesc("GanonE", "Room Towards Jalhalla"),
    new SceneDesc("GanonJ", "Phantom Ganon's Maze", [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13]),
    new SceneDesc("GanonK", "Puppet Ganon Fight"),
    new SceneDesc("GanonL", "Staircase Towards Puppet Ganon"),
    new SceneDesc("GanonM", "Main Room", [0, 1, 2]),
    new SceneDesc("GanonN", "Starcase to Main Room"),
    new SceneDesc("GTower", "Tower"),
    new SceneDesc("Xboss0", "Gohma Refight"),
    new SceneDesc("Xboss1", "Kalle Demos Refight"),
    new SceneDesc("Xboss2", "Jalhalla Refight"),
    new SceneDesc("Xboss3", "Molgera Refight"),

    "Grottos and Caverns",
    new SceneDesc("Cave01", "Bomb Island", [0, 1]),
    new SceneDesc("Cave02", "Star Island"),
    new SceneDesc("Cave03", "Cliff Plateau Isles"),
    new SceneDesc("Cave04", "Rock Spire Isle"),
    new SceneDesc("Cave05", "Horseshoe Island"),
    new SceneDesc("Cave07", "Pawprint Isle Wizzrobe"),
    new SceneDesc("ITest63", "Shark Island"),
    new SceneDesc("MiniHyo", "Ice Ring Isle"),
    new SceneDesc("MiniKaz", "Fire Mountain"),
    new SceneDesc("SubD42", "Needle Rock Isle"),
    new SceneDesc("SubD43", "Angular Isles"),
    new SceneDesc("SubD71", "Boating Course"),
    new SceneDesc("TF_01", "Stone Watcher Island", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("TF_02", "Overlook Island", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("TF_03", "Birds Peak Rock", [0, -1, -2, -3, -4, -5, -6]),
    new SceneDesc("TF_04", "Cabana Maze"),
    new SceneDesc("TF_06", "Dragon Roost Island"),
    new SceneDesc("TyuTyu", "Pawprint Isle Chuchu"),
    new SceneDesc("WarpD", "Diamond Steppe Island"),

    "Savage Labryinth",
    new SceneDesc("Cave09", "Entrance", [0]),
    new SceneDesc("Cave10", "Room 11"),
    new SceneDesc("Cave11", "Room 32"),
    new SceneDesc("Cave06", "End"),

    "Great Fairy Fountains",
    new SceneDesc("Fairy01", "North Fairy Fountain"),
    new SceneDesc("Fairy02", "East Fairy Fountain"),
    new SceneDesc("Fairy03", "West Fairy Fountain"),
    new SceneDesc("Fairy04", "Forest of Fairies"),
    new SceneDesc("Fairy05", "Thorned Fairy Fountain"),
    new SceneDesc("Fairy06", "South Fairy Fountain"),

    "Nintendo Gallery",
    new SceneDesc("Pfigure", "Main Room"),
    new SceneDesc("figureA", "Great Sea"),
    new SceneDesc("figureB", "Windfall Island"),
    new SceneDesc("figureC", "Outset Island"),
    new SceneDesc("figureD", "Forsaken Fortress"),
    new SceneDesc("figureE", "Secret Cavern"),
    new SceneDesc("figureF", "Dragon Roost Island"),
    new SceneDesc("figureG", "Forest Haven"),

    "Unused Test Maps",
    new SceneDesc("Cave08", "Early Wind Temple", [1, 2, 3]),
    new SceneDesc("H_test", "Pig Chamber"),
    new SceneDesc("Ebesso", "Island with House"),
    new SceneDesc("KATA_HB", "Bridge Room"),
    new SceneDesc("KATA_RM", "Large Empty Room"),
    new SceneDesc("kazan", "Fire Mountain"),
    new SceneDesc("Msmoke", "Smoke Test Room", [0, 1]),
    new SceneDesc("Mukao", "Early Headstone Island"),
    new SceneDesc("tincle", "Tingle's Room"),
    new SceneDesc("VrTest", "Early Environment Art Test"),
    new SceneDesc("Ojhous2", "Early Orca's House", [0, 1]),
    new SceneDesc("SubD44", "Early Stone Watcher Island Cavern", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("SubD51", "Early Bomb Island Cavern", [0, 1]),
    new SceneDesc("TF_07", "Stone Watcher Island Scenario Test", [1]),
    new SceneDesc("TF_05", "Early Battle Grotto", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("sea_T", "sea_T", [0, 44]),
    new SceneDesc("sea_E", "sea_E"),
    new SceneDesc("I_SubAN", "I_SubAN", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    new SceneDesc("ITest61", "ITest61"),
    new SceneDesc("ITest62", "ITest62"),
    new SceneDesc("E3ROOP", "E3ROOP"),
    new SceneDesc("K_Test2", "K_Test2"),
    new SceneDesc("K_Test3", "K_Test3"),
    new SceneDesc("K_Test4", "K_Test4"),
    new SceneDesc("K_Test5", "K_Test5"),
    new SceneDesc("K_Test6", "K_Test6"),
    new SceneDesc("K_Test8", "K_Test8"),
    new SceneDesc("K_Test9", "K_Test9"),
    new SceneDesc("K_Testa", "K_Testa"),
    new SceneDesc("K_Testb", "K_Testb"),
    new SceneDesc("K_Testc", "K_Testc"),
    new SceneDesc("K_Testd", "K_Testd"),
    new SceneDesc("K_Teste", "K_Teste"),
    new SceneDesc("DmSpot0", "DmSpot0"),
    new SceneDesc("Amos_T", "Amos_T"),
    new SceneDesc("A_umikz", "A_umikz"),
    new SceneDesc("I_TestM", "I_TestM"),
    new SceneDesc("I_TestR", "I_TestR"),
];

const id = "zww";
const name = "The Legend of Zelda: The Wind Waker";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
