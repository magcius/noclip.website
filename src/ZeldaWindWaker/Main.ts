
import { mat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { DataFetcher } from '../DataFetcher.js';
import { assert, assertExists, hexzero, nArray, readString } from '../util.js';

import * as RARC from '../Common/JSYSTEM/JKRArchive.js';
import * as BYML from '../byml.js';
import * as UI from '../ui.js';
import * as Viewer from '../viewer.js';

import { texProjCameraSceneTex } from '../Camera.js';
import { TransparentBlack } from '../Color.js';
import * as Yaz0 from '../Common/Compression/Yaz0.js';
import { J2DGrafContext } from '../Common/JSYSTEM/J2Dv1.js';
import { J3DModelInstance } from '../Common/JSYSTEM/J3D/J3DGraphBase.js';
import * as JPA from '../Common/JSYSTEM/JPA.js';
import { BTIData } from '../Common/JSYSTEM/JUTTexture.js';
import { computeModelMatrixT, range } from '../MathHelpers.js';
import { SceneContext } from '../SceneBase.js';
import { setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxDevice, GfxFormat, GfxMipFilterMode, GfxRenderPass, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { GXRenderHelperGfx, GXTextureMapping } from '../gx/gx_render.js';
import { FlowerPacket, GrassPacket, TreePacket } from './Grass.js';
import { LegacyActor__RegisterFallbackConstructor } from './LegacyActor.js';
import { dDlst_2DStatic_c, d_a__RegisterConstructors } from './d_a.js';
import { d_a_sea } from './d_a_sea.js';
import { dBgS } from './d_bg.js';
import { CameraTrimHeight, dCamera_c } from './d_camera.js';
import { EDemoMode, dDemo_manager_c } from './d_demo.js';
import { dDlst_list_Set, dDlst_list_c } from './d_drawlist.js';
import { dKankyo_create, dKy__RegisterConstructors, dKy_setLight, dScnKy_env_light_c } from './d_kankyo.js';
import { dKyw__RegisterConstructors } from './d_kankyo_wether.js';
import { ParticleGroup, dPa_control_c } from './d_particle.js';
import { Placename, PlacenameState, dPn__update, d_pn__RegisterConstructors } from './d_place_name.js';
import { dProcName_e } from './d_procname.js';
import { ResType, dRes_control_c } from './d_resorce.js';
import { dStage_dt_c_roomLoader, dStage_dt_c_roomReLoader, dStage_dt_c_stageInitLoader, dStage_dt_c_stageLoader, dStage_roomControl_c, dStage_roomStatus_c, dStage_stageDt_c } from './d_stage.js';
import { WoodPacket } from './d_wood.js';
import { fopAcM_create, fopAcM_searchFromName, fopAc_ac_c } from './f_op_actor.js';
import { cPhs__Status, fGlobals, fopDw_Draw, fopScn, fpcCt_Handler, fpcLy_SetCurrentLayer, fpcM_Management, fpcPf__Register, fpcSCtRq_Request, fpc_pc__ProfileList } from './framework.js';

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
    public camera: dCamera_c;

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

        this.dlst = new dDlst_list_c(modelCache.device, modelCache.cache, modelCache.resCtrl, extraSymbolData);
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

export class ZWWExtraTextures {
    public textureMapping = nArray(2, () => new GXTextureMapping());

    constructor(device: GfxDevice, ZAtoon: BTIData, ZBtoonEX: BTIData) {
        ZAtoon.fillTextureMapping(this.textureMapping[0]);
        ZBtoonEX.fillTextureMapping(this.textureMapping[1]);
    }

    public fillExtraTextures(modelInstance: J3DModelInstance): void {
        const ZAtoon_map = modelInstance.getTextureMappingReference('ZAtoon');
        if (ZAtoon_map !== null)
            ZAtoon_map.copy(this.textureMapping[0]);

        const ZBtoonEX_map = modelInstance.getTextureMappingReference('ZBtoonEX');
        if (ZBtoonEX_map !== null)
            ZBtoonEX_map.copy(this.textureMapping[1]);
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

enum EffectDrawGroup {
    Main = 0,
    Indirect = 1,
}

const scratchMatrix = mat4.create();
export class WindWakerRenderer implements Viewer.SceneGfx {
    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
    private opaqueSceneTextureMapping = new GXTextureMapping();

    public renderHelper: GXRenderHelperGfx;

    public rooms: WindWakerRoom[] = [];
    public extraTextures: ZWWExtraTextures;
    public renderCache: GfxRenderCache;

    public time: number; // In milliseconds, affected by pause and time scaling
    public roomLayerMask: number = 1;

    // Time of day control
    private timeOfDayPanel: UI.TimeOfDayPanel | null = null;
    private useSystemTime: boolean = true;
    private readonly defaultTimeAdv: number = 0.02;

    public onstatechanged!: () => void;

    constructor(public device: GfxDevice, public globals: dGlobals) {
        this.renderHelper = new GXRenderHelperGfx(device, globals.sceneContext);

        this.renderCache = this.renderHelper.renderInstManager.gfxRenderCache;

        this.opaqueSceneTextureMapping.gfxSampler = this.renderCache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
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
        scenarioSelect.setItemsSelected(range(0, 12).map((i) => (this.roomLayerMask & (1 << i)) !== 0));
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

        const showDebugThumbnails = new UI.Checkbox('Show Debug Thumbnails', false);
        showDebugThumbnails.onchanged = () => {
            const v = showDebugThumbnails.checked;
            this.renderHelper.debugThumbnails.enabled = v;
        };
        renderHacksPanel.contents.appendChild(showDebugThumbnails.elem);

        if (this.renderHelper.device.queryLimits().wireframeSupported) {
            const wireframe = new UI.Checkbox('Wireframe', false);
            wireframe.onchanged = () => {
                this.globals.renderHacks.wireframe = wireframe.checked;
            };
            renderHacksPanel.contents.appendChild(wireframe.elem);
        }

        // Time of Day panel
        this.timeOfDayPanel = new UI.TimeOfDayPanel();
        this.timeOfDayPanel.setTime(this.globals.g_env_light.curTime / 360);

        this.timeOfDayPanel.onvaluechange = (t: number, useDynamicTime: boolean) => {
            this.useSystemTime = useDynamicTime;
            if (useDynamicTime) {
                // Re-enable dynamic time: restore time advance rate and sync to current hour
                this.globals.g_env_light.timeAdv = this.defaultTimeAdv;
                this.globals.g_env_light.curTime = 15 * new Date().getHours();
            } else {
                // Freeze time at the selected value
                this.globals.g_env_light.timeAdv = 0;
                this.globals.g_env_light.curTime = t * 360;
            }
        };

        return [roomsPanel, scenarioPanel, renderHacksPanel, this.timeOfDayPanel];
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

        // Update time-of-day panel display
        if (this.timeOfDayPanel !== null && this.useSystemTime) {
            this.timeOfDayPanel.setTime(globals.g_env_light.curTime / 360);
        }

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

        // Not sure exactly where this is ordered...
        dKy_setLight(globals);

        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        if (globals.renderHacks.wireframe)
            template.setMegaStateFlags({ wireframe: true });

        fpcM_Management(globals.frameworkGlobals, globals, renderInstManager, viewerInput);

        const dlst = globals.dlst;

        renderInstManager.setCurrentList(dlst.shadow);
        dlst.shadowControl.draw(globals, renderInstManager, viewerInput);

        renderInstManager.setCurrentList(dlst.alphaModel);
        dlst.alphaModel0.draw(globals, renderInstManager, viewerInput);

        renderInstManager.setCurrentList(dlst.bg[0]);
        {
            globals.particleCtrl.calc(globals, viewerInput);

            for (let group = ParticleGroup.Normal; group <= ParticleGroup.Wind; group++) {
                let texPrjMtx: mat4 | null = null;

                if (group === ParticleGroup.Projection) {
                    texPrjMtx = scratchMatrix;
                    texProjCameraSceneTex(texPrjMtx, globals.camera.clipFromViewMatrix, 1);
                }

                globals.particleCtrl.setDrawInfo(globals.camera.viewFromWorldMatrix, globals.camera.clipFromViewMatrix, texPrjMtx, globals.camera.frustum);
                renderInstManager.setCurrentList(dlst.effect[group === ParticleGroup.Projection ? EffectDrawGroup.Indirect : EffectDrawGroup.Main]);
                globals.particleCtrl.draw(device, this.renderHelper.renderInstManager, group);
            }

            // From mDoGph_Painter(). Draw the 2D particle groups with different view/proj matrices.
            {
                const orthoCtx = this.globals.scnPlay.currentGrafPort;
                const template = renderInstManager.pushTemplate();
                orthoCtx.setOnRenderInst(template);

                const viewMtx = scratchMatrix;
                computeModelMatrixT(viewMtx, orthoCtx.aspectRatioCorrection * 320, 240, 0);
                globals.particleCtrl.setDrawInfo(viewMtx, orthoCtx.sceneParams.u_Projection, null, null);

                renderInstManager.setCurrentList(dlst.particle2DBack);
                globals.particleCtrl.draw(device, this.renderHelper.renderInstManager, ParticleGroup.TwoDback);
                globals.particleCtrl.draw(device, this.renderHelper.renderInstManager, ParticleGroup.TwoDmenuBack);

                renderInstManager.setCurrentList(dlst.particle2DFore);
                globals.particleCtrl.draw(device, this.renderHelper.renderInstManager, ParticleGroup.TwoDfore);
                globals.particleCtrl.draw(device, this.renderHelper.renderInstManager, ParticleGroup.TwoDmenuFore);

                renderInstManager.popTemplate();
            }

            globals.particleCtrl.prepareToRender(device);
        }

        this.renderHelper.renderInstManager.popTemplate();
        globals.renderHacks.renderHacksChanged = false;
    }

    private executeList(passRenderer: GfxRenderPass, list: GfxRenderInstList, label: string): void {
        passRenderer.pushDebugGroup(label);
        list.drawOnPassRenderer(this.renderCache, passRenderer);
        passRenderer.popDebugGroup();
    }

    private executeListSet(passRenderer: GfxRenderPass, listSet: dDlst_list_Set, label: string): void {
        this.executeList(passRenderer, listSet[0], `${label} (Opa)`);
        this.executeList(passRenderer, listSet[1], `${label} (Xlu)`);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const dlst = this.globals.dlst;
        dlst.peekZ.beginFrame(device);

        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // From mDoGph_Painter,
        this.globals.scnPlay.currentGrafPort.setOrtho(-9.0, -21.0, 650.0, 503.0, 100000.0, -100000.0);
        this.globals.scnPlay.currentGrafPort.setPort(viewerInput.backbufferWidth, viewerInput.backbufferHeight);

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
                this.globals.camera.applyScissor(passRenderer);
                this.executeListSet(passRenderer, dlst.sky, 'Sky');
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Main Depth');

        builder.pushPass((pass) => {
            pass.setDebugName('BG');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.globals.camera.applyScissor(passRenderer);
                this.executeList(passRenderer, dlst.sea, 'Sea');
                this.executeList(passRenderer, dlst.bg[0], 'BG (Opa)');
            });
        });

        // Shadows expect depth from the BG/Sea, but nothing else. Must be applied before other alpha objects.
        dlst.shadowControl.pushPasses(this.globals, renderInstManager, builder, mainDepthTargetID, mainColorTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.globals.camera.applyScissor(passRenderer);

                this.executeList(passRenderer, dlst.alphaModel, 'AlphaModel');

                this.executeList(passRenderer, dlst.main[0], 'Main (Opa)');
                
                this.executeList(passRenderer, dlst.bg[1], 'BG (Xlu)');
                this.executeList(passRenderer, dlst.main[1], 'Main (Xlu)');
                
                this.executeList(passRenderer, dlst.effect[EffectDrawGroup.Main], 'Effect (Main)');
                this.executeList(passRenderer, dlst.wetherEffect, 'Effect (Wether)');

                this.executeList(passRenderer, dlst.particle2DBack, 'Particle 2D Back');
                this.executeListSet(passRenderer, dlst.ui, 'UI');
                this.executeListSet(passRenderer, dlst.ui2D, 'UI 2D');
                this.executeList(passRenderer, dlst.particle2DFore, 'Particle 2D Fore');
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
                this.executeList(passRenderer, dlst.effect[EffectDrawGroup.Indirect], 'Effect (Indirect)');
            });
        });

        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorTargetID, viewerInput.mouseLocation);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);

        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);
    }

    public destroy(device: GfxDevice): void {
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
    public linkDemoAnmNo: number = 0;

    public vrboxLoaded: boolean = false;
    public placenameIndex: Placename;
    public placenameState: PlacenameState;

    public currentGrafPort: J2DGrafContext;

    public override load(globals: dGlobals, userData: any): cPhs__Status {
        super.load(globals, userData);

        this.demo = new dDemo_manager_c(globals);

        this.treePacket = new TreePacket(globals);
        this.flowerPacket = new FlowerPacket(globals);
        this.grassPacket = new GrassPacket(globals);
        this.woodPacket = new WoodPacket(globals);

        this.currentGrafPort = new J2DGrafContext(globals.modelCache.device, 0.0, 0.0, 640.0, 480.0, -1.0, 1.0);

        globals.scnPlay = this;

        return cPhs__Status.Complete;
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.demo.update(deltaTimeFrames);

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

        modelCache.fetchFileData(`extra.crg1_arc`, 15);
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

        fpcPf__Register(framework, dProcName_e.d_camera, dCamera_c);
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

        globals.particleCtrl = new dPa_control_c(renderer.renderCache);
        globals.particleCtrl.createCommon(globals, JPA.parse(modelCache.getFileData(particleArchives[0])));
        globals.particleCtrl.createRoomScene(globals, JPA.parse(modelCache.getFileData(particleArchives[1])));

        const pcId = fpcSCtRq_Request(framework, null, dProcName_e.d_s_play, null);
        assert(pcId !== null);

        fpcCt_Handler(globals.frameworkGlobals, globals);
        assert(globals.scnPlay !== undefined);

        // Set the stage as the active layer.
        // Normally, all of this would be done in d_scn_play.
        fpcLy_SetCurrentLayer(globals.frameworkGlobals, globals.scnPlay.layer);

        // TODO: Use the RCAM/CAMR data from the stage to set the initial camera position
        const camId = fpcSCtRq_Request(framework, null, dProcName_e.d_camera, null);
        assert(camId !== null);

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
        public linkAnmNo: number,
        public offsetPos?: vec3,
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

        // Set noclip layer visiblity based on demo's layer
        globals.renderer.roomLayerMask = (1 << this.layer);
        
        // LkD00 and LkD01 archives contain Link's demo animations. Each demo requires only one of them to be loaded.
        // The file is LkD00 unless dComIfGs_isEventBit(0x2D01) is set, in which case it's LkD01. This bit is set 
        // during after Aryll is freed from the Forsaken Fortress (Demo23). The arc is loaded during phase_0() of d_s_play.
        // Since we can't check the event bit, we manually assign the demo anim index per-scene.
        globals.scnPlay.linkDemoAnmNo = this.linkAnmNo;

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
        if (!fopAcM_searchFromName(globals, 'Link', 0, 0)) {
            fopAcM_create(globals.frameworkGlobals, dProcName_e.d_a_py_lk, 0, null, globals.mStayNo, null, null, 0xFF, -1);
        }

        // From dStage_playerInit
        if (this.stbFilename === 'title.stb') {
            fopAcM_create(globals.frameworkGlobals, dProcName_e.d_a_title, 0, null, globals.mStayNo, null, null, 0xFF, -1);
        }

        // noclip modification: ensure all the actors are created before we load the cutscene
        await new Promise(resolve => {
            (function waitForActors() {
                if (globals.frameworkGlobals.ctQueue.length === 0) return resolve(null);
                setTimeout(waitForActors, 30);
            })();
        });

        // From dEvDtStaff_c::specialProcPackage()
        let demoData: ArrayBufferSlice | null = null;
        if (globals.roomCtrl.demoArcName)
            demoData = globals.modelCache.resCtrl.getObjectResByName(ResType.Stb, globals.roomCtrl.demoArcName, this.stbFilename);
        if (demoData === null)
            demoData = globals.modelCache.resCtrl.getStageResByName(ResType.Stb, "Stage", this.stbFilename);

        if (demoData !== null) {
            globals.scnPlay.demo.create(this.id, demoData, this.layer, this.offsetPos, this.rotY, this.startFrame);
            globals.camera.setTrimHeight(this.id !== 'title' ? CameraTrimHeight.Cinematic : CameraTrimHeight.Default)
            globals.camera.snapToCinematic();
        } else {
            console.warn('Failed to load demo data:', this.stbFilename);
        }
    }
}

// Move these into sceneDescs once they are complete enough to be worth viewing.
// Extracted from the game using a modified version of the excellent wwrando/wwlib/stage_searcher.py script from LagoLunatic
// Most of this data comes from the PLAY action of the PACKAGE actor in an event from a Stage's event_list.dat. This
// action has properties for the room and layer that these cutscenes are designed for. HOWEVER, this data is often missing.
// It has been reconstructed by cross-referencing each Room's lbnk section (which points to a Demo*.arc file for each layer),
// the .stb files contained in each of those Objects/Demo*.arc files, and the FileName attribute from the event action.
//
// A reference video for all cutscenes can be found at https://youtu.be/4P4QUKaH8GU
// Append the timestamp comment at the end of each line to jump to the relevant part of the video.
const demoDescs = [
    // Outset Island
    new DemoDesc("LinkRM", "Grandma's Tale (Second Playthrough)", [0], "tale_2.stb", 8, 0, [0, 0, 0], 0, 0, 0),
    new DemoDesc("sea", "Tetra Kidnapped", [44], "kaizoku_zelda_fly.stb", 0, 0, [-200000.0, 0.0, 320000.0], 180.0, 0, 0), // ?t=425s
    new DemoDesc("A_mori", "Meet Tetra", [0], "meet_tetra.stb", 0, 0, [0, 0, 0], 0, 0, 0), // ?t=643s

    // Forsaken Fortress
    new DemoDesc("MajyuE", "Forsaken Fortress Infiltration", [0], "maju_shinnyu.stb", 0, 0, [0, 0, 0], 0, 0, 0), // ?t=1011s
    new DemoDesc("Mjtower", "Reunion With Little Sister", [0], "find_sister.stb", 0, 0, [4889.0, 0.0, -2635.0], 57.5, 0, 0), // ?t=1169s

    // Windfall Island
    new DemoDesc("sea", "Meet the King of Red Lions", [11], "meetshishioh.stb", 8, 0, [0.0, 0.0, -200000.0], 0, 128, 0), // ?t=1271s
    
    // Dragon Roost Island
    new DemoDesc("Atorizk", "A Dragon Tale", [0], "dragontale.stb", 0, 0, [0, 0, 0], 0, 0, 0), // ?t=1726s
    new DemoDesc("Adanmae", "Valoo Howling", [0], "howling.stb", 8, 1, [0.0, 0.0, 0.0], 0.0, 0, 0), // ?t=2131s
    new DemoDesc("sea", "Komori Pearl Acquired", [13], "getperl_komori.stb", 9, 0, [200000.0, 0.0, -200000.0], 0, 0, 0), // ?t=2159s

    // Forest Haven
    new DemoDesc("Omori", "Meet the Deku Tree", [0], "meet_deku.stb", 8, 0, [0, 0, 0], 0, 213, 0), // ?t=2353s
    new DemoDesc("Omori", "Deku Pearl Acquired", [0], "getperl_deku.stb", 9, 0, [0, 0, 0], 0, 214, 0), // ?t=2612s

    new DemoDesc("Obombh", "Bomb Shop", [0], "bombshop.stb", 0, 0, [0.0, 0.0, 0.0], 0.0, 200, 0), // ?t=2865s
    
    new DemoDesc("Pjavdou", "Jabun's Pearl", [0], "getperl_jab.stb", 8, 0, [0.0, 0.0, 0.0], 0.0, 0, 0), // ?t=3191s
    
    // Tower of the Gods, before visiting Hyrule
    // These use different spawn locations to differentiate themselves, which we are not currently tracking
    new DemoDesc("ADMumi", "Tower of the Gods Appears - Din", [0], "towerd.stb", 8, 0, [-50179.0, -1000.0, 7070.0], 90.0, 0, 0), // Spawn 0 ?t=3403s
    new DemoDesc("ADMumi", "Tower of the Gods Appears - Farore", [0], "towerf.stb", 8, 0, [-50179.0, -1000.0, 7070.0], 90.0, 0, 0),  // Spawn 1
    new DemoDesc("ADMumi", "Tower of the Gods Appears - Nayru", [0], "towern.stb", 8, 0, [-50179.0, -1000.0, 7070.0], 90.0, 0, 0), // Spawn 2
    new DemoDesc("ADMumi", "Tower of the Gods Portal Appears", [0], "warp_in.stb", 9, 0, [0.0, 0.0, 0.0], 0.0, 200, 0), // ?t=3651s
    
    // Hyrule
    new DemoDesc("Hyrule", "Hyrule Discovery", [0], "warp_out.stb", 8, 0, [0, 0, 0], 0, 201, 0), // ?t=3701s
    new DemoDesc("kenroom", "Master Sword Acquired", [0], "master_sword.stb", 0, 0, [-124.0, -3223.0, -7823.0], 180.0, 248, 0), // ?t=3870s
    new DemoDesc("Hyroom", "Hyrule Rebirth", [0], "rebirth_hyral.stb", 8, 0, [0.0, -2100.0, 3910.0], 0.0, 249, 0), // ?t=3899s
    new DemoDesc("kenroom", "Master Sword Swing", [0], "swing_sword.stb", 10, 0, [-124.0, -3223.0, -7823.0], 180.0, 249, 0), // ?t=3935s

    // Forsaken Fortress, after visiting Hyrule
    new DemoDesc("M2tower", "Little Sister Rescue", [0], "rescue.stb", 1, 0, [3214.0, 3939.0, -3011.0], 57.5, 20, 0), // ?t=3984s
    new DemoDesc("M2ganon", "Ganon Battle (Failure)", [0], "attack_ganon.stb", 1, 1, [2000.0, 11780.0, -8000.0], 0.0, 244, 0), // ?t=4165s
    
    new DemoDesc("ADMumi", "Rescued by Valoo", [0], "runaway_majuto.stb", 11, 1, [0, 0, 0], 0, 0, 0), // ?t=4352s
    new DemoDesc("kenroom", "Zelda Awakens", [0], "awake_zelda.stb", 9, 1, [0.0, 0.0, 0.0], 0.0, 2, 0), // ?t=4474s
    
    // Fairy Fountain
    new DemoDesc("sea", "Fairy Fountain (Second Playthrough)", [9], "fairy_flag_on.stb", 8, 1, [-180000.0, 740.0, -199937.0], 25.0, 2, 0),

    // Dragon Roost Island, after visiting Hyrule
    new DemoDesc("Edaichi", "Song of the Zora", [0], "dance_zola.stb", 8, 1, [0.0, 0.0, 0.0], 0, 226, 0), // ?t=5138s
    new DemoDesc("sea", "Zora Sage Awakens", [13], "awake_zola.stb", 8, 1, [200000.0, 0.0, -200000.0], 0, 227, 0), // ?t=5212s
    new DemoDesc("M_DaiB", "Zora Prayer", [0], "pray_zola.stb", 8, 1, [0, 0, 0], 0, 229, 0), // ?t=5505s

    // Forest Haven, after visiting Hyrule
    new DemoDesc("Ekaze", "Song of the Kokiri", [0], "dance_kokiri.stb", 8, 1, [0.0, 0.0, 0.0], 0, 229, 0), // ?t=5073s
    new DemoDesc("Otkura", "Kokiri Tribe Awakens", [0], "awake_kokiri.stb", 8, 1, [0, 0, 0], 0, 0, 0), // ?t=5665s
    new DemoDesc("kazeB", "Kokiri Prayer", [0], "pray_kokiri.stb", 8, 1, [0.0, 300.0, 0.0], 0.0, 232, 0), // ?t=5772s

    // Tower of the Gods, after visiting Hyrule
    new DemoDesc("ADMumi", "Tower of the Gods with Triforce", [0], "warphole.stb", 10, 1, [0.0, 0.0, 0.0], 0.0, 219, 0), // ?t=5944s
    
    // Final Battle(s)
    new DemoDesc("Hyrule", "Hyrule Barrier Break", [0], "seal.stb", 4, 1, [0.0, 0.0, 0.0], 0, 0, 0), // ?t=6046s
    new DemoDesc("GanonK", "Before Bedroom Ganon Fight", [0], "kugutu_ganon.stb", 8, 1, [0.0, 0.0, 0.0], 0.0, 0, 0), // ?t=6071s
    new DemoDesc("GanonK", "After Bedroom Ganon Fight", [0], "to_roof.stb", 9, 1, [0.0, 0.0, 0.0], 0.0, 4, 0), // ?t=6192s
    new DemoDesc("GTower", "Before Final Ganon Fight", [0], "g2before.stb", 8, 1, [0.0, 0.0, 0.0], 0.0, 0, 0), // ?t=6216s
    new DemoDesc("GTower", "After Final Ganon Fight", [0], "endhr.stb", 9, 1, [0.0, 0.0, 0.0], 0.0, 0, 0), // ?t=6487s
    new DemoDesc("ENDumi", "Ending", [0], "ending.stb", 8, 1, [0.0, 0.0, 0.0], 0.0, 0, 0), // ?t=6643s

    // These are present in the sea_T event_list.dat, but not in the room's lbnk. They are only playable from "sea".
    new DemoDesc("sea_T", "Awaken", [0xFF], "awake.stb", 0, 0, [-220000.0, 0.0, 320000.0], 0.0, 0, 0),
    new DemoDesc("sea_T", "Departure", [0xFF], "departure.stb", 0, 0, [-200000.0, 0.0, 320000.0], 0.0, 0, 0),
    new DemoDesc("sea_T", "PirateZeldaFly", [0xFF], "kaizoku_zelda_fly.stb", 0, 0, [-200000.0, 0.0, 320000.0], 180.0, 0, 0),

    // The game expects this STB file to be in Stage/Ocean/Stage.arc, but it is not. Must be a leftover.
    new DemoDesc("Ocean", "counter.stb", [-1], "counter.stb", 0, 0, [0, 0, 0], 0, 0, 0),
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
    new DemoDesc("sea_T", "Title Screen", [44], "title.stb", 0, 0, [-220000.0, 0.0, 320000.0], 180.0, 0, 0),
    new DemoDesc("sea", "Awaken", [44], "awake.stb", 0, 0, [-220000.0, 0.0, 320000.0], 0.0, 0, 0), // ?t=215
    new DemoDesc("LinkRM", "Grandma's Tale", [0], "tale.stb", 8, 0, [0, 0, 0], 0, 0, 0), // ?t=312s
    new DemoDesc("sea", "Stolen Sister", [44], "stolensister.stb", 9, 0, [0.0, 0.0, 20000.0], 0, 0, 0), // ?t=701
    new DemoDesc("LinkRM", "Grandma Gives Link His Shield", [0], "get_shield.stb", 9, 0, [0, 0, 0], 0, 201, 0), // ?t=887s
    new DemoDesc("sea", "Departure", [44], "departure.stb", 10, 0, [-200000.0, 0.0, 320000.0], 0.0, 204, 0), // ?t=929
    new DemoDesc("sea", "Fairy Fountain", [9], "fairy.stb", 8, 1, [-180000.0, 740.0, -199937.0], 25.0, 2, 0), // ?t=4955s
    new DemoDesc("Hyrule", "Hyrule Barrier Break", [0], "seal.stb", 4, 1, [0.0, 0.0, 0.0], 0, 0, 0), // ?t=6046s

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
