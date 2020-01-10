
import { mat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, assertExists, assert, nArray, hexzero, getTextDecoder } from '../util';
import { DataFetcher, DataFetcherFlags } from '../DataFetcher';

import * as Viewer from '../viewer';
import * as BYML from '../byml';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import * as Yaz0 from '../Common/Compression/Yaz0';
import * as UI from '../ui';

import * as DZB from './DZB';
import * as JPA from '../Common/JSYSTEM/JPA';
import { J3DModelData, J3DModelInstance } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { Camera, computeViewMatrix, texProjCameraSceneTex } from '../Camera';
import { DeviceProgram } from '../Program';
import { colorCopy, TransparentBlack, colorNewCopy } from '../Color';
import { fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxRenderPass, GfxHostAccessPass, GfxBufferUsage, GfxFormat, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxBuffer, GfxProgram, GfxBindingLayoutDescriptor, GfxCompareMode, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor, GfxTexture, makeTextureDescriptor2D, GfxInputLayoutBufferDescriptor } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInstList, gfxRenderInstCompareNone, GfxRenderInstExecutionOrder, gfxRenderInstCompareSortKey } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, ColorTexture, noClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { fillMatrix4x4, fillMatrix4x3, fillColor } from '../gfx/helpers/UniformBufferHelpers';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';
import { range, getMatrixAxisZ } from '../MathHelpers';
import { TextureMapping } from '../TextureHolder';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';
import { BTIData } from '../Common/JSYSTEM/JUTTexture';
import { FlowerPacket, TreePacket, GrassPacket } from './Grass';
import { dRes_control_c, ResType, DZS, DZSChunkHeader } from './d_resorce';
import { dStage_stageDt_c, dStage_dt_c_initStageLoader, dStage_roomStatus_c } from './d_stage';
import { dScnKy_env_light_c, dKy_tevstr_init, dKy_setLight, dKy__RegisterConstructors, dKankyo_create } from './d_kankyo';
import { dKyw__RegisterConstructors } from './d_kankyo_wether';
import { fGlobals, fpc_pc__ProfileList, fopScn, cPhs__Status, fpcCt_Handler, fopAcM_create, fpcM_Management, fopDw_Draw, fpcSCtRq_Request, fpc__ProcessName, fpcPf__Register, fopAcM_prm_class, fpcLy_SetCurrentLayer } from './framework';
import { d_a__RegisterConstructors, dComIfGp_getMapTrans, MtxTrans, mDoMtx_YrotM, calc_mtx } from './d_a';
import { BMDObjectRenderer, PlacedActor, loadActor } from './LegacyActor';

type SymbolData = { Filename: string, SymbolName: string, Data: ArrayBufferSlice };
type SymbolMap = { SymbolData: SymbolData[] };

export interface dStage__ObjectNameTableEntry {
    pcName: number;
    subtype: number;
    gbaName: number;
};
type dStage__ObjectNameTable = { [name: string]: dStage__ObjectNameTableEntry };

function createRelNameTable(symbolMap: SymbolMap) {
    const nameTableBuf = assertExists(symbolMap.SymbolData.find((e) => e.Filename === 'c_dylink.o' && e.SymbolName === 'DynamicNameTable'));
    const stringsBuf = assertExists(symbolMap.SymbolData.find((e) => e.Filename === 'c_dylink.o' && e.SymbolName === '@stringBase0'));
    const textDecoder = getTextDecoder('utf8') as TextDecoder;

    const nameTableView = nameTableBuf.Data.createDataView();
    const stringsBytes = stringsBuf.Data.createTypedArray(Uint8Array);
    const entryCount = nameTableView.byteLength / 8;

    // The REL table maps the 2-byte ID's from the Actor table to REL names
    // E.g. ID 0x01B8 -> 'd_a_grass'
    const relTable: { [id: number]: string } = {};

    for (let i = 0; i < entryCount; i++) {
        const offset = i * 8;
        const id = nameTableView.getUint16(offset + 0);
        const ptr = nameTableView.getUint32(offset + 4);
        const strOffset = ptr - 0x8033a648;
        const endOffset = stringsBytes.indexOf(0, strOffset);
        const relName = textDecoder.decode(stringsBytes.subarray(strOffset, endOffset));
        relTable[id] = relName;
    }

    return relTable;
}

function createActorTable(symbolMap: SymbolMap): dStage__ObjectNameTable {
    const entry = assertExists(symbolMap.SymbolData.find((e) => e.Filename === 'd_stage.o' && e.SymbolName === 'l_objectName'));
    const data = entry.Data;
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

    public renderHacksChanged = false;
}

export type dDlst_list_Set = [GfxRenderInstList, GfxRenderInstList];

export class dDlst_list_c {
    public sky: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];
    public main: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
    ];
    public wetherEffect = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards);
    public effect: GfxRenderInstList[] = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
    ];

    public reset(): void {
        this.sky[0].reset();
        this.sky[1].reset();
        this.main[0].reset();
        this.main[1].reset();
        this.wetherEffect.reset();
        for (let i = 0; i < this.effect.length; i++)
            this.effect[i].reset();
    }
}

export class dGlobals {
    public g_env_light = new dScnKy_env_light_c();
    public dlst = new dDlst_list_c();

    // This is tucked away somewhere in dComInfoPlay
    public stageName: string;
    public dStage_dt = new dStage_stageDt_c();
    public roomStatus: dStage_roomStatus_c[] = nArray(64, () => new dStage_roomStatus_c());

    public scnPlay: d_s_play;

    // "Current" room number.
    public mStayNo: number = 0;

    // g_dComIfG_gameInfo.mPlay.mpPlayer.mPos3
    public playerPosition = vec3.create();
    // g_dComIfG_gameInfo.mPlay.mCameraInfo[0].mpCamera
    public camera: Camera;
    public cameraPosition = vec3.create();
    public cameraFwd = vec3.create();

    public resCtrl: dRes_control_c;
    // TODO(jstpierre): Remove
    public renderer: WindWakerRenderer;

    public renderHacks = new RenderHacks();

    private relNameTable: { [id: number]: string };
    private objectNameTable: dStage__ObjectNameTable;

    constructor(public modelCache: ModelCache, private extraSymbolData: SymbolMap, public frameworkGlobals: fGlobals) {
        this.resCtrl = this.modelCache.resCtrl;

        this.relNameTable = createRelNameTable(extraSymbolData);
        this.objectNameTable = createActorTable(extraSymbolData);

        for (let i = 0; i < this.roomStatus.length; i++)
            dKy_tevstr_init(this.roomStatus[i].tevStr, i);
    }

    public dStage_searchName(name: string): dStage__ObjectNameTableEntry | null {
        const objName = this.objectNameTable[name];
        if (objName !== undefined)
            return objName;
        else
            return null;
    }

    public objNameGetDbgName(objName: dStage__ObjectNameTableEntry): string {
        const pnameStr = `0x${hexzero(objName.pcName, 0x04)}`;
        const relName = this.relNameTable[objName.pcName] || 'built-in';
        return `${relName} (${pnameStr})`;
    }

    public findExtraSymbolData(filename: string, symname: string): ArrayBufferSlice {
        return assertExists(this.extraSymbolData.SymbolData.find((e) => e.Filename === filename && e.SymbolName === symname)).Data;
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
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(this.gfxTexture, 0, this.textureData);
            device.submitPass(hostAccessPass);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class ZWWExtraTextures {
    public textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());
    public dynToonTex: DynToonTex;

    @UI.dfRange(1, 15, 0.01)
    public toonTexPower: number = 15;

    constructor(device: GfxDevice, ZAtoon: BTIData, ZBtoonEX: BTIData) {
        ZAtoon.fillTextureMapping(this.textureMapping[0]);
        ZBtoonEX.fillTextureMapping(this.textureMapping[1]);
        this.dynToonTex = new DynToonTex(device);
    }

    public powerPopup(): void {
        this.textureMapping[0].gfxTexture = this.dynToonTex.gfxTexture;
        this.textureMapping[1].gfxTexture = this.dynToonTex.gfxTexture;

        window.main.ui.bindSliders(this);
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

// Legacy
export class WindWakerRoomRenderer {
    public name: string;
    public visible: boolean = true;
    public objectsVisible = true;
    public objectRenderers: BMDObjectRenderer[] = [];
    public dzb: DZB.DZB;

    public extraTextures: ZWWExtraTextures;

    constructor(renderer: WindWakerRenderer, public roomNo: number) {
        this.name = `Room ${roomNo}`;

        const resCtrl = renderer.globals.modelCache.resCtrl;
        this.dzb = assertExists(resCtrl.getStageResByName(ResType.Dzb, `Room${roomNo}`, `room.dzb`));

        this.extraTextures = renderer.extraTextures;
    }

    public prepareToRender(globals: dGlobals, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (this.objectsVisible) {
            for (let i = 0; i < this.objectRenderers.length; i++) {
                this.objectRenderers[i].setExtraTextures(this.extraTextures);
                this.objectRenderers[i].prepareToRender(globals, device, renderInstManager, viewerInput);
            }
        }
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public setVisibleLayerMask(m: number): void {
        for (let i = 0; i < this.objectRenderers.length; i++) {
            const o = this.objectRenderers[i];
            if (o.layer >= 0) {
                const v = !!(m & (1 << o.layer));
                o.visible = v;
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

class PlaneColorProgram extends DeviceProgram {
    public static a_Position: number = 0;

    public both = `
precision mediump float;
layout(row_major, std140) uniform ub_Params {
    Mat4x4 u_Projection;
    Mat4x3 u_ModelView;
    vec4 u_PlaneColor;
};
#ifdef VERT
layout(location = ${PlaneColorProgram.a_Position}) in vec3 a_Position;
void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
}
#endif
#ifdef FRAG
void main() {
    gl_FragColor = u_PlaneColor;
}
#endif
`;
}

const scratchMatrix = mat4.create();
const seaPlaneBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 0 }];
class SeaPlane {
    private posBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private gfxProgram: GfxProgram;
    private modelMatrix = mat4.create();
    private color = colorNewCopy(TransparentBlack);

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.createBuffers(device);
        mat4.fromScaling(this.modelMatrix, [2000000, 1, 2000000]);
        mat4.translate(this.modelMatrix, this.modelMatrix, [0, -100, 0]);

        this.gfxProgram = cache.createProgram(device, new PlaneColorProgram());
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, this.modelMatrix);
    }

    public prepareToRender(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        colorCopy(this.color, globals.g_env_light.bgCol[1].K0);

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setBindingLayouts(seaPlaneBindingLayouts);
        renderInst.setMegaStateFlags({
            depthWrite: true,
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LESS),
        });
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.drawIndexes(6);

        let offs = renderInst.allocateUniformBuffer(0, 32);
        const d = renderInst.mapUniformBufferF32(0);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        this.computeModelView(scratchMatrix, viewerInput.camera);
        offs += fillMatrix4x3(d, offs, scratchMatrix);
        offs += fillColor(d, offs, this.color);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }

    private createBuffers(device: GfxDevice) {
        const posData = new Float32Array(4 * 3);
        posData[0]  = -1;
        posData[1]  = 0;
        posData[2]  = -1;
        posData[3]  = 1;
        posData[4]  = 0;
        posData[5]  = -1;
        posData[6]  = -1;
        posData[7]  = 0;
        posData[8]  = 1;
        posData[9]  = 1;
        posData[10] = 0;
        posData[11] = 1;
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, makeTriangleIndexBuffer(GfxTopology.TRISTRIP, 0, 4).buffer);
        this.posBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, posData.buffer);
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { format: GfxFormat.F32_RGB, location: PlaneColorProgram.a_Position, bufferByteOffset: 0, bufferIndex: 0 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.posBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }
}

function setTextureMappingIndirect(m: TextureMapping, sceneTexture: GfxTexture): void {
    m.gfxTexture = sceneTexture;
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = true;
}

const enum EffectDrawGroup {
    Main = 0,
    Indirect = 1,
}

class SimpleEffectSystem {
    private emitterManager: JPA.JPAEmitterManager;
    private drawInfo = new JPA.JPADrawInfo();
    private jpacData: JPA.JPACData[] = [];
    private resourceDatas = new Map<number, JPA.JPAResourceData>();

    constructor(device: GfxDevice, private jpac: JPA.JPAC[]) {
        this.emitterManager = new JPA.JPAEmitterManager(device, 6000, 300);
        for (let i = 0; i < this.jpac.length; i++)
            this.jpacData.push(new JPA.JPACData(this.jpac[i]));
    }

    private findResourceData(userIndex: number): [JPA.JPACData, JPA.JPAResourceRaw] | null {
        for (let i = 0; i < this.jpacData.length; i++) {
            const r = this.jpacData[i].jpac.effects.find((resource) => resource.resourceId === userIndex);
            if (r !== undefined)
                return [this.jpacData[i], r];
        }

        return null;
    }

    private getResourceData(device: GfxDevice, cache: GfxRenderCache, userIndex: number): JPA.JPAResourceData | null {
        if (!this.resourceDatas.has(userIndex)) {
            const data = this.findResourceData(userIndex);
            if (data !== null) {
                const [jpacData, jpaResRaw] = data;
                const resData = new JPA.JPAResourceData(device, cache, jpacData, jpaResRaw);
                this.resourceDatas.set(userIndex, resData);
            }
        }

        return this.resourceDatas.get(userIndex)!;
    }

    public setOpaqueSceneTexture(opaqueSceneTexture: GfxTexture): void {
        for (let i = 0; i < this.jpacData.length; i++) {
            const m = this.jpacData[i].getTextureMappingReference('AK_kagerouSwap00');
            if (m !== null)
                setTextureMappingIndirect(m, opaqueSceneTexture);
        }
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4, texPrjMtx: mat4 | null): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.prjMtx = prjMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
    }

    public calc(viewerInput: Viewer.ViewerRenderInput): void {
        const inc = viewerInput.deltaTime * 30/1000;
        this.emitterManager.calc(inc);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, drawGroupId: number): void {
        this.emitterManager.draw(device, renderInstManager, this.drawInfo, drawGroupId);
    }

    public createBaseEmitter(device: GfxDevice, cache: GfxRenderCache, resourceId: number): JPA.JPABaseEmitter {
        const resData = assertExists(this.getResourceData(device, cache, resourceId));
        const emitter = this.emitterManager.createEmitter(resData)!;

        // This seems to mark it as an indirect particle (???) for simple particles.
        // ref. d_paControl_c::readCommon / readRoomScene
        if (!!(resourceId & 0x4000)) {
            emitter.drawGroupId = EffectDrawGroup.Indirect;
        } else {
            emitter.drawGroupId = EffectDrawGroup.Main;
        }

        return emitter;
    }

    public createEmitterTest(resourceId: number = 0x14) {
        const device: GfxDevice = window.main.viewer.gfxDevice;
        const cache: GfxRenderCache = window.main.scene.renderHelper.getCache();
        const emitter = this.createBaseEmitter(device, cache, resourceId);
        if (emitter !== null) {
            emitter.globalTranslation[0] = -275;
            emitter.globalTranslation[1] = 150;
            emitter.globalTranslation[2] = 2130;

            const orig = vec3.clone(emitter.globalTranslation);
            let t = 0;
            function move() {
                t += 0.1;
                emitter!.globalTranslation[0] = orig[0] + Math.sin(t) * 50;
                emitter!.globalTranslation[1] = orig[1] + Math.sin(t * 0.777) * 50;
                emitter!.globalTranslation[2] = orig[2] + Math.cos(t) * 50;
                requestAnimationFrame(move);
            }
            requestAnimationFrame(move);
        }

        return emitter;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.jpacData.length; i++)
            this.jpacData[i].destroy(device);
        this.emitterManager.destroy(device);
    }
}

export class WindWakerRenderer implements Viewer.SceneGfx {
    private renderTarget = new BasicRenderTarget();
    public opaqueSceneTexture = new ColorTexture();
    public renderHelper: GXRenderHelperGfx;

    private seaPlane: SeaPlane | null = null;

    public roomRenderers: WindWakerRoomRenderer[] = [];
    public effectSystem: SimpleEffectSystem;
    public extraTextures: ZWWExtraTextures;
    public renderCache: GfxRenderCache;

    public time: number; // In milliseconds, affected by pause and time scaling
    public frameCount: number; // Assumes 33 FPS, affected by pause and time scaling

    public onstatechanged!: () => void;

    constructor(public device: GfxDevice, public globals: dGlobals) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.renderHelper.renderInstManager.disableSimpleMode();

        this.renderCache = this.renderHelper.renderInstManager.gfxRenderCache;

        const wantsSeaPlane = globals.stageName === 'sea';
        if (wantsSeaPlane)
            this.seaPlane = new SeaPlane(device, this.renderCache);
    }

    public getRoomDZB(roomIdx: number): DZB.DZB {
        const roomRenderer = assertExists(this.roomRenderers.find((r) => r.roomNo === roomIdx));
        return roomRenderer.dzb;
    }

    private setVisibleLayerMask(m: number): void {
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].setVisibleLayerMask(m);
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
        roomsPanel.setLayers(this.roomRenderers);

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
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].objectsVisible = enableObjects.checked;
        };
        renderHacksPanel.contents.appendChild(enableObjects.elem);

        return [roomsPanel, scenarioPanel, renderHacksPanel];
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        this.time = viewerInput.time;
        this.frameCount = viewerInput.time / 1000.0 * 30;

        mat4.getTranslation(this.globals.cameraPosition, viewerInput.camera.worldMatrix);
        getMatrixAxisZ(this.globals.cameraFwd, viewerInput.camera.worldMatrix);
        vec3.negate(this.globals.cameraFwd, this.globals.cameraFwd);
        // Update the "player position" from the camera.
        vec3.copy(this.globals.playerPosition, this.globals.cameraPosition);
        this.globals.camera = viewerInput.camera;

        // Not sure exactly where this is ordered...
        dKy_setLight(this.globals);

        fpcM_Management(this.globals.frameworkGlobals, this.globals, renderInstManager, viewerInput);

        this.extraTextures.prepareToRender(device);

        fillSceneParamsDataOnTemplate(template, viewerInput);

        const dlst = this.globals.dlst;

        renderInstManager.setCurrentRenderInstList(dlst.main[0]);
        if (this.seaPlane)
            this.seaPlane.prepareToRender(this.globals, renderInstManager, viewerInput);

        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].prepareToRender(this.globals, device, renderInstManager, viewerInput);

        {
            this.effectSystem.calc(viewerInput);
            this.effectSystem.setOpaqueSceneTexture(this.opaqueSceneTexture.gfxTexture!);

            for (let group = EffectDrawGroup.Main; group <= EffectDrawGroup.Indirect; group++) {
                let texPrjMtx: mat4 | null = null;

                if (group === EffectDrawGroup.Indirect) {
                    texPrjMtx = scratchMatrix;
                    texProjCameraSceneTex(texPrjMtx, viewerInput.camera, viewerInput.viewport, 1);
                }

                this.effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, texPrjMtx);
                renderInstManager.setCurrentRenderInstList(dlst.effect[group]);
                this.effectSystem.draw(device, this.renderHelper.renderInstManager, group);
            }
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);

        this.globals.renderHacks.renderHacksChanged = false;
    }

    private executeList(device: GfxDevice, renderInstManager: GfxRenderInstManager, pass: GfxRenderPass, list: GfxRenderInstList): void {
        list.drawOnPassRenderer(device, renderInstManager.gfxRenderCache, pass);
    }

    private executeListSet(device: GfxDevice, renderInstManager: GfxRenderInstManager, pass: GfxRenderPass, listSet: dDlst_list_Set): void {
        this.executeList(device, renderInstManager, pass, listSet[0]);
        this.executeList(device, renderInstManager, pass, listSet[1]);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.opaqueSceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const dlst = this.globals.dlst;

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        this.executeListSet(device, renderInstManager, skyboxPassRenderer, dlst.sky);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);

        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        this.executeListSet(device, renderInstManager, mainPassRenderer, dlst.main);
        this.executeList(device, renderInstManager, mainPassRenderer, dlst.effect[EffectDrawGroup.Main]);
        this.executeList(device, renderInstManager, mainPassRenderer, dlst.wetherEffect);

        mainPassRenderer.endPass(this.opaqueSceneTexture.gfxTexture);
        device.submitPass(mainPassRenderer);

        // Now indirect stuff.
        const indirectPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, noClearRenderPassDescriptor);
        this.executeList(device, renderInstManager, mainPassRenderer, dlst.effect[EffectDrawGroup.Indirect]);

        dlst.reset();
        renderInstManager.resetRenderInsts();
        return indirectPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.opaqueSceneTexture.destroy(device);
        this.extraTextures.destroy(device);
        this.renderTarget.destroy(device);
        if (this.seaPlane)
            this.seaPlane.destroy(device);
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].destroy(device);
        if (this.effectSystem !== null)
            this.effectSystem.destroy(device);
        this.globals.frameworkGlobals.delete(this.globals);
    }
}

export class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private archivePromiseCache = new Map<string, Promise<RARC.JKRArchive>>();
    private archiveCache = new Map<string, RARC.JKRArchive>();
    public cache = new GfxRenderCache();

    public resCtrl = new dRes_control_c();
    public currentStage: string;
    public onloadedcallback: (() => void) | null = null;

    constructor(public device: GfxDevice, private dataFetcher: DataFetcher, private yaz0Decompressor: Yaz0.Yaz0Decompressor) {
    }

    public waitForLoad(): Promise<any> {
        const v: Promise<any>[] = [... this.filePromiseCache.values(), ... this.archivePromiseCache.values()];
        return Promise.all(v);
    }

    private fetchFile(path: string, cacheBust: number = 0): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        let fetchPath = path;
        if (cacheBust > 0)
            fetchPath = `${path}?cache_bust=${cacheBust}`;
        const p = this.dataFetcher.fetchData(fetchPath, DataFetcherFlags.NONE, () => {
            this.filePromiseCache.delete(path);
        });
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
                if (this.onloadedcallback !== null)
                    this.onloadedcallback();
                return data;
            });
        }
    }

    public getFileData(path: string): ArrayBufferSlice {
        return assertExists(this.fileDataCache.get(path));
    }

    private async requestArchiveDataInternal(archivePath: string): Promise<RARC.JKRArchive> {
        let buffer: ArrayBufferSlice = await this.dataFetcher.fetchData(archivePath);

        if (readString(buffer, 0x00, 0x04) === 'Yaz0')
            buffer = Yaz0.decompressSync(this.yaz0Decompressor, buffer);

        const rarc = RARC.parse(buffer, this.yaz0Decompressor);
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
        const archive = await this.fetchArchive(`${pathBase}/Object/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resObj);
        return archive;
    }

    public requestObjectData(arcName: string): cPhs__Status {
        const archivePath = `${pathBase}/Object/${arcName}.arc`;

        if (this.archiveCache.has(archivePath))
            return cPhs__Status.Complete;

        if (!this.archivePromiseCache.has(archivePath))
            this.fetchObjectData(arcName);

        return cPhs__Status.Loading;
    }

    public async fetchStageData(arcName: string): Promise<void> {
        const archive = await this.fetchArchive(`${pathBase}/Stage/${this.currentStage}/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resStg);
    }

    // For compatibility.
    public getModel(archive: RARC.JKRArchive, modelPath: string): J3DModelData {
        const resInfo = assertExists(this.resCtrl.findResInfoByArchive(archive, this.resCtrl.resObj));
        const resEntry = assertExists(resInfo.res.find((g) => modelPath.endsWith(g.file.name)));
        return resEntry.res;
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy(device);
    }
}

export const pathBase = `j3d/ww`;

class d_s_play extends fopScn {
    public flowerPacket: FlowerPacket;
    public treePacket: TreePacket;
    public grassPacket: GrassPacket;

    public vrboxLoaded: boolean = false;

    public load(globals: dGlobals, userData: any): cPhs__Status {
        super.load(globals, userData);

        this.treePacket = new TreePacket(globals);
        this.flowerPacket = new FlowerPacket(globals);
        this.grassPacket = new GrassPacket(globals);

        globals.scnPlay = this;

        return cPhs__Status.Complete;
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        // Grass/Flowers/Trees
        const frameCount = viewerInput.time / 1000.0 * 30;

        this.flowerPacket.calc(frameCount);
        this.treePacket.calc(frameCount);
        this.grassPacket.calc(frameCount);

        this.flowerPacket.update(globals);
        this.treePacket.update(globals);
        this.grassPacket.update(globals);

        fopDw_Draw(globals.frameworkGlobals, globals, renderInstManager, viewerInput);

        this.flowerPacket.draw(globals, renderInstManager, viewerInput);
        this.treePacket.draw(globals, renderInstManager, viewerInput);
        this.grassPacket.draw(globals, renderInstManager, viewerInput);
    }

    public delete(globals: dGlobals): void {
        super.delete(globals);

        const device = globals.modelCache.device;
        this.flowerPacket.destroy(device);
        this.treePacket.destroy(device);
        this.grassPacket.destroy(device);
    }
}

class SceneDesc {
    public id: string;

    public constructor(public stageDir: string, public name: string, public rooms: number[] = [0]) {
        this.id = stageDir;

        // Garbage hack.
        if (this.stageDir === 'sea' && rooms.length === 1)
            this.id = `Room${rooms[0]}.arc`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = await context.dataShare.ensureObject<ModelCache>(`${pathBase}/ModelCache`, async () => {
            const yaz0Decompressor = await Yaz0.decompressor();
            return new ModelCache(context.device, context.dataFetcher, yaz0Decompressor);
        });

        modelCache.onloadedcallback = null;
        modelCache.setCurrentStage(this.stageDir);

        modelCache.fetchObjectData(`System`);
        modelCache.fetchObjectData(`Always`);
        modelCache.fetchStageData(`Stage`);

        modelCache.fetchFileData(`${pathBase}/extra.crg1_arc`, 5);
        modelCache.fetchFileData(`${pathBase}/f_pc_profiles.crg1_arc`);

        const particleArchives = [
            `${pathBase}/Particle/common.jpc`,
        ];

        for (let i = 0; i < particleArchives.length; i++)
            modelCache.fetchFileData(particleArchives[i]);

        // XXX(jstpierre): This is really terrible code.
        for (let i = 0; i < this.rooms.length; i++) {
            const roomIdx = Math.abs(this.rooms[i]);
            modelCache.fetchStageData(`Room${roomIdx}`);
        }

        await modelCache.waitForLoad();

        const f_pc_profiles = BYML.parse<fpc_pc__ProfileList>(modelCache.getFileData(`${pathBase}/f_pc_profiles.crg1_arc`), BYML.FileType.CRG1);
        const framework = new fGlobals(f_pc_profiles);

        fpcPf__Register(framework, fpc__ProcessName.d_s_play, d_s_play);
        dKy__RegisterConstructors(framework);
        dKyw__RegisterConstructors(framework);
        d_a__RegisterConstructors(framework);

        const symbolMap = BYML.parse<SymbolMap>(modelCache.getFileData(`${pathBase}/extra.crg1_arc`), BYML.FileType.CRG1);
        const globals = new dGlobals(modelCache, symbolMap, framework);
        globals.stageName = this.stageDir;

        const renderer = new WindWakerRenderer(device, globals);
        context.destroyablePool.push(renderer);
        globals.renderer = renderer;

        modelCache.onloadedcallback = () => {
            fpcCt_Handler(globals.frameworkGlobals, globals);
        };

        const ret = fpcSCtRq_Request(framework, null, fpc__ProcessName.d_s_play, null);
        assert(ret);

        fpcCt_Handler(globals.frameworkGlobals, globals);
        assert(globals.scnPlay !== undefined);

        // Set the stage as the active layer.
        // Normally, all of this would be done in d_scn_play.
        fpcLy_SetCurrentLayer(globals.frameworkGlobals, globals.scnPlay.layer);

        const resCtrl = modelCache.resCtrl;

        const sysRes = assertExists(resCtrl.findResInfo(`System`, resCtrl.resObj));
        const ZAtoon   = sysRes.getResByID(ResType.Bti, 0x03);
        const ZBtoonEX = sysRes.getResByID(ResType.Bti, 0x04);

        const dzs = assertExists(resCtrl.getStageResByName(ResType.Dzs, `Stage`, `stage.dzs`));

        dStage_dt_c_initStageLoader(globals.dStage_dt, dzs);

        const isSea = this.stageDir === 'sea';
        const isFullSea = isSea && this.rooms.length > 1;

        renderer.extraTextures = new ZWWExtraTextures(device, ZAtoon, ZBtoonEX);

        const jpac: JPA.JPAC[] = [];
        for (let i = 0; i < particleArchives.length; i++) {
            const jpacData = modelCache.getFileData(particleArchives[i]);
            jpac.push(JPA.parse(jpacData));
        }
        renderer.effectSystem = new SimpleEffectSystem(device, jpac);

        // dStage_Create
        dKankyo_create(globals);

        // mRoomCtrl::init()
        // dStage_dt_c_stageLoader()
        // dMap_c::create()

        const vrbox = resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_sky.bdl`);
        if (vrbox !== null) {
            fpcSCtRq_Request(framework, null, fpc__ProcessName.d_a_vrbox, null);
            fpcSCtRq_Request(framework, null, fpc__ProcessName.d_a_vrbox2, null);
        }

        let actorMultMtx: mat4 | null = null;
        for (let i = 0; i < this.rooms.length; i++) {
            const roomNo = Math.abs(this.rooms[i]);

            const visible = this.rooms[i] >= 0;
            const roomRenderer = new WindWakerRoomRenderer(renderer, roomNo);
            roomRenderer.visible = visible;
            renderer.roomRenderers.push(roomRenderer);

            // The MULT affects BG actors only, but not actors.
            const mult = dComIfGp_getMapTrans(globals, roomNo);

            // Actors are stored in world-space normally.
            actorMultMtx = null;

            if (isSea && !isFullSea && mult !== null) {
                // HACK(jstpierre): For non-full sea levels, we apply the inverse of the MULT, so that
                // the room is located at 0, 0. This is for convenience and back-compat with existing
                // savestates.

                MtxTrans(vec3.fromValues(mult.transX, 0, mult.transZ), false);
                mDoMtx_YrotM(calc_mtx, mult.rotY);

                const roomMultMtx = calc_mtx;

                actorMultMtx = mat4.create();
                mat4.invert(actorMultMtx, roomMultMtx);

                // Hack up the DZB as well.
                const dzb = roomRenderer.dzb;
                vec3.transformMat4(dzb.pos, dzb.pos, roomMultMtx);

                // Now reset MULT to 0.
                mult.transX = 0;
                mult.transZ = 0;
                mult.rotY = 0;
            }

            // objectSetCheck
            fopAcM_create(framework, fpc__ProcessName.d_a_bg, roomNo, null, -1, null, null, 0xFF, -1);

            const dzr = assertExists(resCtrl.getStageResByName(ResType.Dzs, `Room${roomNo}`, `room.dzr`));
            this.spawnActors(renderer, roomRenderer, dzr, actorMultMtx);
        }

        // HACK(jstpierre): We spawn stage actors on the first room renderer.
        this.spawnActors(renderer, renderer.roomRenderers[0], dzs);

        // TODO(jstpierre): Not all the actors load in the requestArchives phase...
        await modelCache.waitForLoad();

        return renderer;
    }

    private iterActorLayerACTR(roomNo: number, layer: number, dzs: DZS, actrHeader: DZSChunkHeader | undefined, callback: (actorName: string, it: fopAcM_prm_class) => void): void {
        if (actrHeader === undefined)
            return;

        const buffer = dzs.buffer;
        const view = buffer.createDataView();

        let actrTableIdx = actrHeader.offs;
        for (let i = 0; i < actrHeader.count; i++) {
            const name = readString(buffer, actrTableIdx + 0x00, 0x08, true);
            const parameter = view.getUint32(actrTableIdx + 0x08, false);
            const posX = view.getFloat32(actrTableIdx + 0x0C);
            const posY = view.getFloat32(actrTableIdx + 0x10);
            const posZ = view.getFloat32(actrTableIdx + 0x14);
            const angleX = view.getInt16(actrTableIdx + 0x18);
            const angleY = view.getInt16(actrTableIdx + 0x1A);
            const angleZ = view.getInt16(actrTableIdx + 0x1C);
            const enemyNo = view.getUint16(actrTableIdx + 0x1E);

            const actor: fopAcM_prm_class = {
                parameters: parameter,
                roomNo,
                pos: vec3.fromValues(posX, posY, posZ),
                rot: vec3.fromValues(angleX, angleY, angleZ),
                enemyNo,
                scale: vec3.fromValues(1, 1, 1),
                subtype: 0,
                gbaName: 0,
                parentPcId: 0xFFFFFFFF,
                layer,
            };

            callback(name, actor);
            actrTableIdx += 0x20;
        }
    }

    private iterActorLayerSCOB(roomNo: number, layer: number, dzs: DZS, actrHeader: DZSChunkHeader | undefined, callback: (name: string, it: fopAcM_prm_class) => void): void {
        if (actrHeader === undefined)
            return;

        const buffer = dzs.buffer;
        const view = buffer.createDataView();

        let actrTableIdx = actrHeader.offs;
        for (let i = 0; i < actrHeader.count; i++) {
            const name = readString(buffer, actrTableIdx + 0x00, 0x08, true);
            const parameter = view.getUint32(actrTableIdx + 0x08, false);
            const posX = view.getFloat32(actrTableIdx + 0x0C);
            const posY = view.getFloat32(actrTableIdx + 0x10);
            const posZ = view.getFloat32(actrTableIdx + 0x14);
            const angleX = view.getInt16(actrTableIdx + 0x18);
            const angleY = view.getInt16(actrTableIdx + 0x1A);
            const angleZ = view.getInt16(actrTableIdx + 0x1C);
            const enemyNo = view.getUint16(actrTableIdx + 0x1E);
            const scaleX = view.getUint8(actrTableIdx + 0x20) / 10.0;
            const scaleY = view.getUint8(actrTableIdx + 0x21) / 10.0;
            const scaleZ = view.getUint8(actrTableIdx + 0x22) / 10.0;
            // const pad = view.getUint8(actrTableIdx + 0x23);

            const actor: fopAcM_prm_class = {
                parameters: parameter,
                roomNo,
                pos: vec3.fromValues(posX, posY, posZ),
                rot: vec3.fromValues(angleX, angleY, angleZ),
                enemyNo,
                scale: vec3.fromValues(scaleX, scaleY, scaleZ),
                subtype: 0,
                gbaName: 0,
                parentPcId: 0xFFFFFFFF,
                layer,
            };

            callback(name, actor);
            actrTableIdx += 0x24;
        }
    }

    private iterActorLayers(roomIdx: number, dzs: DZS, callback: (actorName: string, it: fopAcM_prm_class) => void): void {
        const chunkHeaders = dzs.headers;

        function buildChunkLayerName(base: string, i: number): string {
            if (i === -1) {
                return base;
            } else {
                return base.slice(0, 3) + i.toString(16).toLowerCase();
            }
        }

        for (let i = -1; i < 16; i++) {
            this.iterActorLayerACTR(roomIdx, i, dzs, chunkHeaders.get(buildChunkLayerName('ACTR', i)), callback);
            this.iterActorLayerACTR(roomIdx, i, dzs, chunkHeaders.get(buildChunkLayerName('TGOB', i)), callback);
            this.iterActorLayerACTR(roomIdx, i, dzs, chunkHeaders.get(buildChunkLayerName('TRES', i)), callback);
            this.iterActorLayerSCOB(roomIdx, i, dzs, chunkHeaders.get(buildChunkLayerName('SCOB', i)), callback);
            this.iterActorLayerSCOB(roomIdx, i, dzs, chunkHeaders.get(buildChunkLayerName('TGSC', i)), callback);
            this.iterActorLayerSCOB(roomIdx, i, dzs, chunkHeaders.get(buildChunkLayerName('DOOR', i)), callback);
        }
    }

    private spawnActors(renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, dzs: DZS, actorMultMtx: mat4 | null = null): void {
        this.iterActorLayers(roomRenderer.roomNo, dzs, (processName, actor) => {
            const placedActor: PlacedActor = actor as PlacedActor;
            placedActor.rotationY = actor.rot![1] / 0x7FFF * Math.PI;
            if (actorMultMtx !== null)
                vec3.transformMat4(actor.pos!, actor.pos!, actorMultMtx);
            placedActor.roomRenderer = roomRenderer;
            loadActor(renderer.globals, roomRenderer, processName, placedActor);
        });
    }
}

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

    "Outset Island",
    new SceneDesc("sea", "Outset Island", [44]),
    new SceneDesc("LinkRM", "Link's House"),
    new SceneDesc("LinkUG", "Under Link's House"),
    new SceneDesc("A_mori", "Forest of Fairies"),
    new SceneDesc("Ojhous", "Orca's House", [0]), // I forget who lives upstairs
    new SceneDesc("Omasao", "Mesa's House"),
    new SceneDesc("Onobuta", "Abe and Rose's House"),
    new SceneDesc("Pjavdou", "Jabun's Cavern"),

    "Forsaken Fortress",
    new SceneDesc("M2ganon", "Ganondorf's Room"),
    new SceneDesc("MajyuE", "Exterior"),
    new SceneDesc("majroom", "Interior (First Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("ma2room", "Interior (Second Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("ma3room", "Interior (Third  Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("Mjtower", "The Tower (First Visit)"),
    new SceneDesc("M2tower", "The Tower (Second Visit)"),

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
    new SceneDesc("GanonA", "Entrance"),
    new SceneDesc("GanonB", "Room Towards Gohma"),
    new SceneDesc("GanonC", "Room Towards Molgera"),
    new SceneDesc("GanonD", "Room Towards Kalle Demos"),
    new SceneDesc("GanonE", "Room Towards Jalhalla"),
    new SceneDesc("GanonJ", "Phantom Ganon's Maze"),
    new SceneDesc("GanonK", "Puppet Ganon Fight"),
    new SceneDesc("GanonL", "Staircase Towards Puppet Ganon"),
    new SceneDesc("GanonM", "Main Room"),
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
    new SceneDesc("Cave09", "Entrance"),
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
    // new SceneDesc("kazan", "Fire Mountain"),
    new SceneDesc("Msmoke", "Smoke Test Room", [0, 1]),
    new SceneDesc("Mukao", "Early Headstone Island"),
    new SceneDesc("tincle", "Tingle's Room"),
    new SceneDesc("VrTest", "Early Environment Art Test"),
    new SceneDesc("Ojhous2", "Early Orca's House", [0, 1]),
    new SceneDesc("SubD44", "Early Stone Watcher Island Cavern", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("SubD51", "Early Bomb Island Cavern", [0, 1]),
    new SceneDesc("TF_07", "Stone Watcher Island Scenario Test", [1]),
    new SceneDesc("TF_05", "Early Battle Grotto", [0, 1, 2, 3, 4, 5, 6]),
];

const id = "zww";
const name = "The Legend of Zelda: The Wind Waker";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
