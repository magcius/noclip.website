
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { DataFetcher } from '../DataFetcher.js';
import * as Viewer from '../viewer.js';
import * as BYML from '../byml.js';
import * as Yaz0 from '../Common/Compression/Yaz0.js';
import * as UI from '../ui.js';

import * as JPA from '../Common/JSYSTEM/JPA.js';
import * as RARC from '../Common/JSYSTEM/JKRArchive.js';
import { TextureMapping } from '../TextureHolder.js';
import { readString, leftPad, assertExists, assert, nArray, hexzero } from '../util.js';
import { GfxDevice, GfxRenderPass, GfxFormat } from '../gfx/platform/GfxPlatform.js';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render.js';
import { pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { SceneContext } from '../SceneBase.js';
import { range, getMatrixAxisZ } from '../MathHelpers.js';
import { mat4, vec3} from 'gl-matrix';
import { Camera, texProjCameraSceneTex, CameraController } from '../Camera.js';
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstManager, GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';

import { dRes_control_c, ResType } from './d_resorce.js';
import { dStage_stageDt_c, dStage_dt_c_stageLoader, dStage_dt_c_stageInitLoader, dStage_roomStatus_c, dStage_dt_c_roomLoader, dStage_dt_c_roomReLoader } from './d_stage.js';
import { dScnKy_env_light_c, dKy_tevstr_init, dKy__RegisterConstructors, dKankyo_create, dKy_reinitLight } from './d_kankyo.js';
import { dKyw__RegisterConstructors, mDoGph_bloom_c } from './d_kankyo_wether.js';
import { fGlobals, fpc_pc__ProfileList, fopScn, cPhs__Status, fpcCt_Handler, fopAcM_create, fpcM_Management, fopDw_Draw, fpcSCtRq_Request, fpc__ProcessName, fpcPf__Register, fpcLy_SetCurrentLayer, fopAc_ac_c } from './framework.js';
import { d_a__RegisterConstructors, dDlst_2DStatic_c } from './d_a.js';
import { LegacyActor__RegisterFallbackConstructor } from './LegacyActor.js';
import { dBgS } from '../WindWaker/d_bg.js';
import { TransparentBlack } from '../Color.js';
import { dPa_control_c } from './d_particle.js';
import { dDlst_list_Set, dDlst_list_c } from './d_drawlist.js';
import { dItem_itemResource, dItem_fieldItemResource, dItem_itemInfo, getItemResource, getFieldItemResource, getItemInfo } from './d_item_data.js'

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
        const strOffset = ptr - 0x80375de8;
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
    public tagsVisible = false;
    public showHiddenItems = false;
    public mirroredMaps = false;

    public renderHacksChanged = false;
}

export class dGlobals {
    public g_env_light = new dScnKy_env_light_c();
    public dlst: dDlst_list_c;

    // This is tucked away somewhere in dComInfoPlay
    public stageName: string;
    public dStage_dt = new dStage_stageDt_c();
    public roomStatus: dStage_roomStatus_c[] = nArray(64, () => new dStage_roomStatus_c());
    public particleCtrl: dPa_control_c;

    public bloom: mDoGph_bloom_c;

    public scnPlay: d_s_play;
    public counter = 0;

    // "Current" room number.
    public mStayNo: number = 0;

    // Whether in Twilight or not
    public world_dark: boolean = false;

    // g_dComIfG_gameInfo.mPlay.mpPlayer.mPos3
    public playerPosition = vec3.create();
    // g_dComIfG_gameInfo.mPlay.mCameraInfo[0].mpCamera
    public camera: Camera;
    public cameraPosition = vec3.create();
    public cameraFwd = vec3.create();

    public resCtrl: dRes_control_c;
    // TODO(jstpierre): Remove
    public renderer: TwilightPrincessRenderer;

    public quadStatic: dDlst_2DStatic_c;
    public renderHacks = new RenderHacks();

    private relNameTable: { [id: number]: string };
    private objectNameTable: dStage__ObjectNameTable;

    public item_resource: dItem_itemResource[] = [];
    public field_item_resource: dItem_fieldItemResource[] = [];
    public item_info: dItem_itemInfo[] = [];

    constructor(public context: SceneContext, public modelCache: ModelCache, private extraSymbolData: SymbolMap, public frameworkGlobals: fGlobals) {
        this.resCtrl = this.modelCache.resCtrl;

        this.relNameTable = createRelNameTable(extraSymbolData);
        this.objectNameTable = createActorTable(extraSymbolData);

        this.item_resource = getItemResource(this, extraSymbolData);
        this.field_item_resource = getFieldItemResource(this, extraSymbolData);
        this.item_info = getItemInfo(this);

        for (let i = 0; i < this.roomStatus.length; i++) {
            this.roomStatus[i].roomNo = i;
            dKy_tevstr_init(this.roomStatus[i].tevStr, i);
        }

        this.dlst = new dDlst_list_c();

        this.bloom = new mDoGph_bloom_c(this);
    }

    public dStage_searchName(name: string): dStage__ObjectNameTableEntry | null {
        const objName = this.objectNameTable[name];
        if (objName !== undefined)
            return objName;
        else
            return null;
    }

    public dStage__searchNameRev(processName: fpc__ProcessName, subtype: number): string | null {
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
    }
}

function fpcIsObject(n: fpc__ProcessName): boolean {
    if (n === fpc__ProcessName.d_a_bg)
        return false;

    return true;
}

export class TwilightPrincessRoom {
    public name: string;

    constructor(public roomNo: number, public visible: boolean) {
        this.name = `Room ${roomNo}`;
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }
}

const enum EffectDrawGroup {
    Main = 0,
    Indirect = 1,
}

const scratchMatrix = mat4.create();
export class TwilightPrincessRenderer implements Viewer.SceneGfx {
    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
    private opaqueSceneTextureMapping = new TextureMapping();

    private scenarioSelect: UI.SingleSelect | null = null;
    public currentLayer: number = -1;

    private bgAmbRatioSlider: UI.Slider;
    private actAmbRatioSlider: UI.Slider;

    public renderHelper: GXRenderHelperGfx;

    public rooms: TwilightPrincessRoom[] = [];
    public renderCache: GfxRenderCache;

    public time: number; // In milliseconds, affected by pause and time scaling

    public onstatechanged!: () => void;

    constructor(device: GfxDevice, public globals: dGlobals) {
        this.renderHelper = new GXRenderHelperGfx(device);

        
        this.renderCache = this.renderHelper.renderInstManager.gfxRenderCache;
        this.applyCurrentLayer();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(36/60);
    }

    // TODO: rework mirrored mode to work with new setup
    /* private setMirrored(mirror: boolean): void {
        const negScaleMatrix = mat4.create();
        computeModelMatrixS(negScaleMatrix, -1, 1, 1);

        for (let i = 0; i < this.modelInstances.length; i++) {
            mat4.mul(this.modelInstances[i].modelMatrix, negScaleMatrix, this.modelInstances[i].modelMatrix);
            for (let j = 0; j < this.modelInstances[i].materialInstances.length; j++)
                this.modelInstances[i].materialInstances[j].materialHelper.megaStateFlags.frontFace = mirror ? GfxFrontFaceMode.CCW : GfxFrontFaceMode.CW;
        }
    } */

    public setCurrentLayer(index: number): void {
        if (this.currentLayer === index)
            return;

        this.currentLayer = index;
        if (this.scenarioSelect !== null)
            this.scenarioSelect.setHighlighted(index);
        this.onstatechanged();
    }

    private applyCurrentLayer(): void {
        if (this.currentLayer < 0 || this.currentLayer >= 15)
            this.currentLayer = 0;

        // set twilight layers
        if (this.currentLayer === 13 || this.currentLayer === 14)
            this.globals.world_dark = true;
        else
            this.globals.world_dark = false;

        console.log(`Current Layer: ${this.currentLayer}\nTwilight?: ${this.globals.world_dark}`);
    }

    public createPanels(): UI.Panel[] {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(UI.LAYER_ICON, 'Layer Select');
    
        this.scenarioSelect = new UI.SingleSelect();
        this.scenarioSelect.setStrings(range(0, 15).map((i) => `Layer ${i}`));
        this.scenarioSelect.onselectionchange = (index: number) => {
            this.setCurrentLayer(index);
            this.applyCurrentLayer();
            dKy_reinitLight(this.globals);
        };

        this.scenarioSelect.selectItem(0);
        scenarioPanel.contents.append(this.scenarioSelect.elem);

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

        const enableTags = new UI.Checkbox('Enable Tags', false);
        enableTags.onchanged = () => {
            this.globals.renderHacks.tagsVisible = enableTags.checked;
        };
        renderHacksPanel.contents.appendChild(enableTags.elem);

        const showHiddenItems = new UI.Checkbox('Show Hidden Items', false);
        showHiddenItems.onchanged = () => {
            this.globals.renderHacks.showHiddenItems = showHiddenItems.checked;
        };
        renderHacksPanel.contents.appendChild(showHiddenItems.elem);

        // come back to this later
        /* const mirrorMaps = new UI.Checkbox('Mirror Maps (Wii Mode)', false);
        mirrorMaps.onchanged = () => {
            this.globals.renderHacks.mirroredMaps = mirrorMaps.checked;
            this.globals.renderHacks.renderHacksChanged = true;
        };
        renderHacksPanel.contents.appendChild(mirrorMaps.elem); */

        // ENVIRONMENT DEBUG
        const environmentPanel = new UI.Panel();

        environmentPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        environmentPanel.setTitle(UI.RENDER_HACKS_ICON, 'Environment Debug');
        this.actAmbRatioSlider = new UI.Slider();
        this.actAmbRatioSlider.setRange(0, 1, 0.01);
        this.actAmbRatioSlider.setLabel("Actor Color Ratio: " + this.globals.g_env_light.actAmbColRatio);
        this.actAmbRatioSlider.setValue(this.globals.g_env_light.actAmbColRatio);
        this.actAmbRatioSlider.onvalue = () => {
            this.actAmbRatioSlider.setLabel("Actor Color Ratio: " + this.actAmbRatioSlider.getValue());
        };
        environmentPanel.contents.appendChild(this.actAmbRatioSlider.elem);

        this.bgAmbRatioSlider = new UI.Slider();
        this.bgAmbRatioSlider.setRange(0, 1, 0.01);
        this.bgAmbRatioSlider.setLabel("BG Color Ratio: " + this.globals.g_env_light.bgAmbColRatio);
        this.bgAmbRatioSlider.setValue(this.globals.g_env_light.bgAmbColRatio);
        this.bgAmbRatioSlider.onvalue = () => {
            this.bgAmbRatioSlider.setLabel("BG Color Ratio: " + this.bgAmbRatioSlider.getValue());
        };
        environmentPanel.contents.appendChild(this.bgAmbRatioSlider.elem);

        return [roomsPanel, scenarioPanel, renderHacksPanel, environmentPanel];
    }

    // For people to play around with.
    public cameraFrozen = false;

    private getRoomVisible(roomNo: number): boolean {
        if (roomNo === -1)
            return true;
        for (let i = 0; i < this.rooms.length; i++)
            if (this.rooms[i].roomNo === roomNo)
                return this.rooms[i].visible;
        throw "whoops";
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

    private executeList(passRenderer: GfxRenderPass, list: GfxRenderInstList): void {
        list.drawOnPassRenderer(this.renderCache, passRenderer);
    }

    private executeListSet(passRenderer: GfxRenderPass, listSet: dDlst_list_Set): void {
        this.executeList(passRenderer, listSet[0]);
        this.executeList(passRenderer, listSet[1]);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const globals = this.globals;
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        const dlst = globals.dlst;
        dlst.peekZ.beginFrame(device);

        this.globals.g_env_light.bgAmbColRatioGather = this.bgAmbRatioSlider.getValue();
        this.globals.g_env_light.actAmbColRatioGather = this.actAmbRatioSlider.getValue();

        this.time = viewerInput.time;
        globals.counter += viewerInput.deltaTime / 30.0;

        if (!this.cameraFrozen) {
            mat4.getTranslation(this.globals.cameraPosition, viewerInput.camera.worldMatrix);
            getMatrixAxisZ(this.globals.cameraFwd, viewerInput.camera.worldMatrix);
            vec3.negate(this.globals.cameraFwd, this.globals.cameraFwd);
            // Update the "player position" from the camera.
            vec3.copy(this.globals.playerPosition, this.globals.cameraPosition);
        }

        // noclip hack: if only one room is visible, make it the mStayNo
        const singleRoomVisibleNo = this.getSingleRoomVisible();
        if (singleRoomVisibleNo !== -1)
            this.globals.mStayNo = singleRoomVisibleNo;

        // Update actor visibility from settings.
        // TODO(jstpierre): Figure out a better place to put this?
        const fwGlobals = this.globals.frameworkGlobals;
        for (let i = 0; i < fwGlobals.dwQueue.length; i++) {
            for (let j = 0; j < fwGlobals.dwQueue[i].length; j++) {
                const ac = fwGlobals.dwQueue[i][j];
                if (ac instanceof fopAc_ac_c) {
                    ac.roomVisible = this.getRoomVisible(ac.roomNo) && (ac.roomLayer < 0 || this.currentLayer === ac.roomLayer);
                    if (ac.roomVisible && !this.globals.renderHacks.objectsVisible && fpcIsObject(ac.processName))
                        ac.roomVisible = false;
                }
            }
        }

        // Near/far planes are decided by the stage data.
        const stag = this.globals.dStage_dt.stag;

        // Pull in the near plane to decrease Z-fighting, some stages set it far too close...
        let nearPlane = Math.max(stag.nearPlane, 5);
        let farPlane = stag.farPlane;

        viewerInput.camera.setClipPlanes(nearPlane, farPlane);

        this.globals.camera = viewerInput.camera;

        fillSceneParamsDataOnTemplate(template, viewerInput);

        fpcM_Management(this.globals.frameworkGlobals, this.globals, renderInstManager, viewerInput);

        renderInstManager.setCurrentRenderInstList(dlst.alphaModel);
        renderInstManager.setCurrentRenderInstList(dlst.main[0]);
        {
            this.globals.particleCtrl.calc(viewerInput);

            for (let group = EffectDrawGroup.Main; group <= EffectDrawGroup.Indirect; group++) {
                let texPrjMtx: mat4 | null = null;

                if (group === EffectDrawGroup.Indirect) {
                    texPrjMtx = scratchMatrix;
                    texProjCameraSceneTex(texPrjMtx, viewerInput.camera, 1);
                }

                this.globals.particleCtrl.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, texPrjMtx, viewerInput.camera.frustum);
                renderInstManager.setCurrentRenderInstList(dlst.effect[group]);
                this.globals.particleCtrl.draw(device, this.renderHelper.renderInstManager, group);
            }

            renderInstManager.setCurrentRenderInstList(dlst.indirect[0]);
        }

        this.globals.renderHacks.renderHacksChanged = false;

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        setBackbufferDescSimple(this.mainColorDesc, viewerInput);
        this.mainColorDesc.colorClearColor = TransparentBlack;

        this.mainDepthDesc.copyDimensions(this.mainColorDesc);
        this.mainDepthDesc.depthClearValue = standardFullClearRenderPassDescriptor.depthClearValue!;

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
                this.executeListSet(passRenderer, dlst.main);

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
                dlst.indirect[0].resolveLateSamplerBinding('opaque-scene-texture', this.opaqueSceneTextureMapping);
                dlst.indirect[1].resolveLateSamplerBinding('opaque-scene-texture', this.opaqueSceneTextureMapping);
                this.executeListSet(passRenderer, dlst.indirect);
            });
        });
        this.globals.bloom.pushPasses(this.globals, builder, renderInstManager, mainColorTargetID);

        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorTargetID, viewerInput.mouseLocation);

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy();
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
        const archive = await this.fetchArchive(`res/Object/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resObj);
        return archive;
    }

    public async fetchMsgData(arcName: string) {
        const archive = await this.fetchArchive(`res/Msg/${arcName}.arc`);
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
        const archivePath = `res/Object/${arcName}.arc`;

        if (this.archiveCache.has(archivePath))
            return cPhs__Status.Complete;

        if (!this.archivePromiseCache.has(archivePath))
            this.fetchObjectData(arcName);

        return cPhs__Status.Loading;
    }

    public requestMsgData(arcName: string): cPhs__Status {
        const archivePath = `res/Msg/${arcName}.arc`;

        if (this.archiveCache.has(archivePath))
            return cPhs__Status.Complete;

        if (!this.archivePromiseCache.has(archivePath))
            this.fetchMsgData(arcName);

        return cPhs__Status.Loading;
    }

    public async fetchStageData(arcName: string): Promise<RARC.JKRArchive> {
        const archive = await this.fetchArchive(`res/Stage/${this.currentStage}/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resStg);
        return archive;
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy();
        this.resCtrl.destroy(device);
    }
}

const pathBase = `ZeldaTwilightPrincess`;

class d_s_play extends fopScn {
    public bgS = new dBgS();

    public vrboxLoaded: boolean = false;
    public layerNo = 0;

    public override load(globals: dGlobals, userData: any): cPhs__Status {
        super.load(globals, userData);

        globals.scnPlay = this;

        return cPhs__Status.Complete;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        // Grass/Flowers/Trees
        const frameCount = viewerInput.time / 1000.0 * 30;

        fopDw_Draw(globals.frameworkGlobals, globals, renderInstManager, viewerInput);
    }

    public getLayerNo(roomNo: number = -1): number {
        return this.layerNo;
    }

    public override delete(globals: dGlobals): void {
        super.delete(globals);

        const device = globals.modelCache.device;
    }
}

class TwilightPrincessSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public name: string, public stageDir: string, public rooms: number[] = [0]) {
        this.id = this.stageDir;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = await context.dataShare.ensureObject<ModelCache>(`${pathBase}/ModelCache`, async () => {
            return new ModelCache(context.device, context.dataFetcher);
        });

        modelCache.setCurrentStage(this.stageDir);

        modelCache.fetchObjectData(`Always`);
        modelCache.fetchStageData(`STG_00`);

        modelCache.fetchFileData(`extra.crg1_arc`);
        modelCache.fetchFileData(`f_pc_profiles.crg1_arc`, 1);

        const particleArchives = [
            `res/Particle/common.jpc`,
            `res/Particle/Pscene001.jpc`,
            `res/Particle/Pscene010.jpc`,
            `res/Particle/Pscene011.jpc`,
            `res/Particle/Pscene012.jpc`,
            `res/Particle/Pscene013.jpc`,
            `res/Particle/Pscene014.jpc`,
            `res/Particle/Pscene015.jpc`,
            `res/Particle/Pscene020.jpc`,
            `res/Particle/Pscene021.jpc`,
            `res/Particle/Pscene022.jpc`,
            `res/Particle/Pscene032.jpc`,
            `res/Particle/Pscene034.jpc`,
            `res/Particle/Pscene037.jpc`,
            `res/Particle/Pscene040.jpc`,
            `res/Particle/Pscene041.jpc`,
            `res/Particle/Pscene050.jpc`,
            `res/Particle/Pscene052.jpc`,
            `res/Particle/Pscene100.jpc`,
            `res/Particle/Pscene101.jpc`,
            `res/Particle/Pscene102.jpc`,
            `res/Particle/Pscene110.jpc`,
            `res/Particle/Pscene111.jpc`,
            `res/Particle/Pscene112.jpc`,
            `res/Particle/Pscene120.jpc`,
            `res/Particle/Pscene121.jpc`,
            `res/Particle/Pscene122.jpc`,
            `res/Particle/Pscene130.jpc`,
            `res/Particle/Pscene131.jpc`,
            `res/Particle/Pscene140.jpc`,
            `res/Particle/Pscene141.jpc`,
            `res/Particle/Pscene150.jpc`,
            `res/Particle/Pscene151.jpc`,
            `res/Particle/Pscene160.jpc`,
            `res/Particle/Pscene161.jpc`,
            `res/Particle/Pscene170.jpc`,
            `res/Particle/Pscene171.jpc`,
            `res/Particle/Pscene180.jpc`,
            `res/Particle/Pscene181.jpc`,
            `res/Particle/Pscene200.jpc`,
            `res/Particle/Pscene201.jpc`,
            `res/Particle/Pscene202.jpc`,
            `res/Particle/Pscene203.jpc`,
            `res/Particle/Pscene204.jpc`,
            `res/Particle/Pscene205.jpc`,
        ];

        for (let i = 0; i < particleArchives.length; i++)
            modelCache.fetchFileData(particleArchives[i]);

        // XXX(jstpierre): This is really terrible code.
        for (let i = 0; i < this.rooms.length; i++) {
            const roomIdx = Math.abs(this.rooms[i]);
            modelCache.fetchStageData(`R${leftPad(''+roomIdx, 2)}_00`);
        }

        await modelCache.waitForLoad();

        const f_pc_profiles = BYML.parse<fpc_pc__ProfileList>(modelCache.getFileData(`f_pc_profiles.crg1_arc`), BYML.FileType.CRG1);
        const framework = new fGlobals(f_pc_profiles);

        fpcPf__Register(framework, fpc__ProcessName.d_s_play, d_s_play);
        dKy__RegisterConstructors(framework);
        dKyw__RegisterConstructors(framework);
        d_a__RegisterConstructors(framework);
        LegacyActor__RegisterFallbackConstructor(framework);

        const symbolMap = new SymbolMap(modelCache.getFileData(`extra.crg1_arc`));
        const globals = new dGlobals(context, modelCache, symbolMap, framework);
        globals.stageName = this.stageDir;

        const renderer = new TwilightPrincessRenderer(device, globals);
        context.destroyablePool.push(renderer);
        globals.renderer = renderer;

        const pcId = fpcSCtRq_Request(framework, null, fpc__ProcessName.d_s_play, null);
        assert(pcId !== null);

        fpcCt_Handler(globals.frameworkGlobals, globals);
        assert(globals.scnPlay !== undefined);

        // Set the stage as the active layer.
        // Normally, all of this would be done in d_scn_play.
        fpcLy_SetCurrentLayer(globals.frameworkGlobals, globals.scnPlay.layer);

        const jpac: JPA.JPAC[] = [];
        for (let i = 0; i < particleArchives.length; i++) {
            const jpacData = modelCache.getFileData(particleArchives[i]);
            jpac.push(JPA.parse(jpacData));
        }
        globals.particleCtrl = new dPa_control_c(renderer.renderCache, jpac);

        dKankyo_create(globals);

        const resCtrl = modelCache.resCtrl;

        const dzs = assertExists(resCtrl.getStageResByName(ResType.Dzs, `STG_00`, `stage.dzs`));

        dStage_dt_c_stageInitLoader(globals, globals.dStage_dt, dzs);
        dStage_dt_c_stageLoader(globals, globals.dStage_dt, dzs);

        // If this is a single-room scene, then set mStayNo.
        if (this.rooms.length === 1)
            globals.mStayNo = Math.abs(this.rooms[0]);

        const vrbox = resCtrl.getStageResByName(ResType.Model, `STG_00`, `vrbox_sora.bmd`);
        if (vrbox !== null) {
            fpcSCtRq_Request(framework, null, fpc__ProcessName.d_a_vrbox, null);
            fpcSCtRq_Request(framework, null, fpc__ProcessName.d_a_vrbox2, null);
        }

        for (let i = 0; i < this.rooms.length; i++) {
            const roomNo = Math.abs(this.rooms[i]);

            const visible = this.rooms[i] >= 0;
            renderer.rooms.push(new TwilightPrincessRoom(roomNo, visible));

            // objectSetCheck

            // noclip modification: We pass in roomNo so it's attached to the room.
            fopAcM_create(framework, fpc__ProcessName.d_a_bg, roomNo, null, roomNo, null, null, 0xFF, -1);

            const dzr = assertExists(resCtrl.getStageResByName(ResType.Dzs, `R${leftPad(''+roomNo, 2)}_00`, `room.dzr`));
            dStage_dt_c_roomLoader(globals, globals.roomStatus[roomNo], dzr);
            dStage_dt_c_roomReLoader(globals, globals.roomStatus[roomNo], dzr);
        }

        return renderer;
    }
}

const id = "ztp";
const name = "The Legend of Zelda: Twilight Princess";

// Special thanks to Jawchewa and SkrillerArt for helping me with naming the maps.
const sceneDescs = [
    "Hyrule Field",
    new TwilightPrincessSceneDesc("Hyrule Field", "F_SP121", [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]),

    "Ordon",
    new TwilightPrincessSceneDesc("Ordon Village", "F_SP103"),
    new TwilightPrincessSceneDesc("Outside Link's House", "F_SP103", [1]),
    new TwilightPrincessSceneDesc("Ordon Ranch", "F_SP00"),
    new TwilightPrincessSceneDesc("Ordon Spring", "F_SP104", [1]),
    new TwilightPrincessSceneDesc("Bo's House", "R_SP01", [0]),
    new TwilightPrincessSceneDesc("Sera's Sundries", "R_SP01", [1]),
    new TwilightPrincessSceneDesc("Jaggle's House", "R_SP01", [2]),
    new TwilightPrincessSceneDesc("Link's House", "R_SP01", [4, 7]),
    new TwilightPrincessSceneDesc("Rusl's House", "R_SP01", [5]),

    "Faron",
    new TwilightPrincessSceneDesc("South Faron Woods", "F_SP108", [0, 1, 2, 3, 4, 5, 8, 11, 14]),
    new TwilightPrincessSceneDesc("North Faron Woods", "F_SP108", [6]),
    new TwilightPrincessSceneDesc("Lost Woods", "F_SP117", [3]),
    new TwilightPrincessSceneDesc("Sacred Grove", "F_SP117", [1]),
    new TwilightPrincessSceneDesc("Temple of Time (Past)", "F_SP117", [2]),
    new TwilightPrincessSceneDesc("Faron Woods Cave", "D_SB10"),
    new TwilightPrincessSceneDesc("Coro's House", "R_SP108"),

    "Eldin",
    new TwilightPrincessSceneDesc("Kakariko Village", "F_SP109"),
    new TwilightPrincessSceneDesc("Death Mountain Trail", "F_SP110", [0, 1, 2, 3]),
    new TwilightPrincessSceneDesc("Kakariko Graveyard", "F_SP111"),
    new TwilightPrincessSceneDesc("Hidden Village", "F_SP128"),
    new TwilightPrincessSceneDesc("Renado's Sanctuary", "R_SP109", [0]),
    new TwilightPrincessSceneDesc("Sanctuary Basement", "R_SP209", [7]),
    new TwilightPrincessSceneDesc("Barnes' Bombs", "R_SP109", [1]),
    new TwilightPrincessSceneDesc("Elde Inn", "R_SP109", [2]),
    new TwilightPrincessSceneDesc("Malo Mart", "R_SP109", [3]),
    new TwilightPrincessSceneDesc("Lookout Tower", "R_SP109", [4]),
    new TwilightPrincessSceneDesc("Bomb Warehouse", "R_SP109", [5]),
    new TwilightPrincessSceneDesc("Abandoned House", "R_SP109", [6]),
    new TwilightPrincessSceneDesc("Goron Elder's Hall", "R_SP110"),

    "Lanayru",
    new TwilightPrincessSceneDesc("Outside Castle Town - West", "F_SP122", [8]),
    new TwilightPrincessSceneDesc("Outside Castle Town - South", "F_SP122", [16]),
    new TwilightPrincessSceneDesc("Outside Castle Town - East", "F_SP122", [17]),
    new TwilightPrincessSceneDesc("Castle Town", "F_SP116", [0, 1, 2, 3, 4]),
    new TwilightPrincessSceneDesc("Zora's River", "F_SP112", [1]),
    new TwilightPrincessSceneDesc("Zora's Domain", "F_SP113", [0, 1]),
    new TwilightPrincessSceneDesc("Lake Hylia", "F_SP115"),
    new TwilightPrincessSceneDesc("Lanayru Spring", "F_SP115", [1]),
    new TwilightPrincessSceneDesc("Upper Zora's River", "F_SP126", [0]),
    new TwilightPrincessSceneDesc("Fishing Pond", "F_SP127", [0]),
    new TwilightPrincessSceneDesc("Castle Town Sewers", "R_SP107", [0, 1, 2, 3]),
    new TwilightPrincessSceneDesc("Telma's Bar / Secret Passage", "R_SP116", [5, 6]),
    new TwilightPrincessSceneDesc("Hena's Cabin", "R_SP127", [0]),
    new TwilightPrincessSceneDesc("Impaz's House", "R_SP128", [0]),
    new TwilightPrincessSceneDesc("Malo Mart", "R_SP160", [0]),
    new TwilightPrincessSceneDesc("Fanadi's Palace", "R_SP160", [1]),
    new TwilightPrincessSceneDesc("Medical Clinic", "R_SP160", [2]),
    new TwilightPrincessSceneDesc("Agitha's Castle", "R_SP160", [3]),
    new TwilightPrincessSceneDesc("Goron Shop", "R_SP160", [4]),
    new TwilightPrincessSceneDesc("Jovani's House", "R_SP160", [5]),
    new TwilightPrincessSceneDesc("STAR Tent", "R_SP161", [7]),

    "Gerudo Desert",
    new TwilightPrincessSceneDesc("Bulblin Camp", "F_SP118", [0, 1, 3]),
    new TwilightPrincessSceneDesc("Bulblin Camp Beta Room", "F_SP118", [2]),
    new TwilightPrincessSceneDesc("Gerudo Desert", "F_SP124", [0]),
    new TwilightPrincessSceneDesc("Mirror Chamber", "F_SP125", [4]),

    "Snowpeak",
    new TwilightPrincessSceneDesc("Snowpeak Mountain", "F_SP114", [0, 1, 2]),  

    "Forest Temple",
    new TwilightPrincessSceneDesc("Forest Temple", "D_MN05", [0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 19, 22]),
    new TwilightPrincessSceneDesc("Diababa Arena", "D_MN05A", [50]),
    new TwilightPrincessSceneDesc("Ook Arena", "D_MN05B", [51]),

    "Goron Mines",
    new TwilightPrincessSceneDesc("Goron Mines", "D_MN04", [1, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 16, 17]),
    new TwilightPrincessSceneDesc("Fyrus Arena", "D_MN04A", [50]),
    new TwilightPrincessSceneDesc("Dangoro Arena", "D_MN04B", [51]),

    "Lakebed Temple",
    new TwilightPrincessSceneDesc("Lakebed Temple", "D_MN01", [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
    new TwilightPrincessSceneDesc("Morpheel Arena", "D_MN01A", [50]),
    new TwilightPrincessSceneDesc("Deku Toad Arena", "D_MN01B", [51]),

    "Arbiter's Grounds",
    new TwilightPrincessSceneDesc("Arbiter's Grounds", "D_MN10", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    new TwilightPrincessSceneDesc("Stallord Arena", "D_MN10A", [50]),
    new TwilightPrincessSceneDesc("Death Sword Arena", "D_MN10B", [51]),

    "Snowpeak Ruins",
    new TwilightPrincessSceneDesc("Snowpeak Ruins", "D_MN11", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13]),
    new TwilightPrincessSceneDesc("Blizzeta Arena", "D_MN11A", [50]),
    new TwilightPrincessSceneDesc("Darkhammer Arena", "D_MN11B", [51]),
    new TwilightPrincessSceneDesc("Darkhammer Beta Arena", "D_MN11B", [49]),

    "Temple of Time",
    new TwilightPrincessSceneDesc("Temple of Time", "D_MN06", [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    new TwilightPrincessSceneDesc("Armogohma Arena", "D_MN06A", [50]),
    new TwilightPrincessSceneDesc("Darknut Arena", "D_MN06B", [51]),

    "City in the Sky",
    new TwilightPrincessSceneDesc("City in the Sky", "D_MN07", [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]),
    new TwilightPrincessSceneDesc("Argorok Arena", "D_MN07A", [50]),
    new TwilightPrincessSceneDesc("Aeralfos Arena", "D_MN07B", [51]),

    "Palace of Twilight",
    new TwilightPrincessSceneDesc("Palace of Twilight", "D_MN08", [0, 1, 2, 4, 5, 7, 8, 9, 10, 11]),
    new TwilightPrincessSceneDesc("Palace of Twilight Throne Room", "D_MN08A", [10]),
    new TwilightPrincessSceneDesc("Phantom Zant Arena 1", "D_MN08B", [51]),
    new TwilightPrincessSceneDesc("Phantom Zant Arena 2", "D_MN08C", [52]),
    new TwilightPrincessSceneDesc("Zant Arenas", "D_MN08D", [50, 53, 54, 55, 56, 57, 60]),

    "Hyrule Castle",
    new TwilightPrincessSceneDesc("Hyrule Castle", "D_MN09", [1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 13, 14, 15]),
    new TwilightPrincessSceneDesc("Hyrule Castle Throne Room", "D_MN09A", [50, 51]),
    new TwilightPrincessSceneDesc("Horseback Ganondorf Arena", "D_MN09B", [0]),
    new TwilightPrincessSceneDesc("Dark Lord Ganondorf Arena", "D_MN09C", [0]),

    "Mini-Dungeons and Grottos",
    new TwilightPrincessSceneDesc("Ice Cavern", "D_SB00", [0]),
    new TwilightPrincessSceneDesc("Cave Of Ordeals", "D_SB01",
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
     10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
     20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
     30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
     40, 41, 42, 43, 44, 45, 46, 47, 48, 49,]),
    new TwilightPrincessSceneDesc("Kakariko Gorge Cavern", "D_SB02", [0]),
    new TwilightPrincessSceneDesc("Lake Hylia Cavern", "D_SB03", [0]),
    new TwilightPrincessSceneDesc("Goron Stockcave", "D_SB04", [10]),
    new TwilightPrincessSceneDesc("Grotto 1", "D_SB05"),
    new TwilightPrincessSceneDesc("Grotto 2", "D_SB06", [1]),
    new TwilightPrincessSceneDesc("Grotto 3", "D_SB07", [2]),
    new TwilightPrincessSceneDesc("Grotto 4", "D_SB08", [3]),
    new TwilightPrincessSceneDesc("Grotto 5", "D_SB09", [4]),

    "Misc",
    new TwilightPrincessSceneDesc("Title Screen / King Bulblin 1", "F_SP102"),
    new TwilightPrincessSceneDesc("King Bulblin 2", "F_SP123", [13]),
    new TwilightPrincessSceneDesc("Wolf Howling Cutscene Map", "F_SP200"),
    // new TwilightPrincessSceneDesc("Cutscene: Light Arrow Area", "R_SP300"),
    new TwilightPrincessSceneDesc("Cutscene: Hyrule Castle Throne Room", "R_SP301"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
