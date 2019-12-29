
import { mat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../../ArrayBufferSlice';
import { readString, assertExists, assert, nArray } from '../../util';
import { DataFetcher } from '../../DataFetcher';

import * as Viewer from '../../viewer';
import * as BYML from '../../byml';
import * as RARC from '../rarc';
import * as Yaz0 from '../../Common/Compression/Yaz0';
import * as UI from '../../ui';

import * as DZB from './DZB';
import * as JPA from '../../Common/JSYSTEM/JPA';
import { BMD, BTK, BRK, BCK } from '../../Common/JSYSTEM/J3D/J3DLoader';
import { J3DModelInstanceSimple, J3DModelData } from '../../Common/JSYSTEM/J3D/J3DGraphBase';
import { Camera, computeViewMatrix, texProjCameraSceneTex } from '../../Camera';
import { DeviceProgram } from '../../Program';
import { Color, colorNew, colorLerp, colorCopy, TransparentBlack, colorNewCopy } from '../../Color';
import { ColorKind, fillSceneParamsDataOnTemplate } from '../../gx/gx_render';
import { GXRenderHelperGfx } from '../../gx/gx_render';
import { GfxDevice, GfxRenderPass, GfxHostAccessPass, GfxBufferUsage, GfxFormat, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxBuffer, GfxProgram, GfxBindingLayoutDescriptor, GfxCompareMode, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor, GfxTexture, makeTextureDescriptor2D, GfxInputLayoutBufferDescriptor } from '../../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from '../../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, ColorTexture, noClearRenderPassDescriptor } from '../../gfx/helpers/RenderTargetHelpers';
import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';
import { fillMatrix4x4, fillMatrix4x3, fillColor } from '../../gfx/helpers/UniformBufferHelpers';
import { makeTriangleIndexBuffer, GfxTopology } from '../../gfx/helpers/TopologyHelpers';
import AnimationController from '../../AnimationController';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { Actor, ActorInfo, loadActor, ObjectRenderer, SymbolMap, settingTevStruct, LightTevColorType, PlacedActor, requestArchiveForActor } from './Actors';
import { SceneContext } from '../../SceneBase';
import { reverseDepthForCompareMode } from '../../gfx/helpers/ReversedDepthHelpers';
import { computeModelMatrixSRT, range } from '../../MathHelpers';
import { TextureMapping } from '../../TextureHolder';
import { EFB_WIDTH, EFB_HEIGHT } from '../../gx/gx_material';
import { BTIData, BTI } from '../../Common/JSYSTEM/JUTTexture';
import { FlowerPacket, TreePacket, GrassPacket } from './Grass';
import { getTextDecoder } from '../../util';

type ActorTable = { [name: string]: ActorInfo };

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

    constructor(device: GfxDevice, public ZAtoon: BTIData, public ZBtoonEX: BTIData) {
        this.ZAtoon.fillTextureMapping(this.textureMapping[0]);
        this.ZBtoonEX.fillTextureMapping(this.textureMapping[1]);
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

    public fillExtraTextures(modelInstance: J3DModelInstanceSimple): void {
        const ZAtoon_map = modelInstance.getTextureMappingReference('ZAtoon');
        if (ZAtoon_map !== null)
            ZAtoon_map.copy(this.textureMapping[0]);

        const ZBtoonEX_map = modelInstance.getTextureMappingReference('ZBtoonEX');
        if (ZBtoonEX_map !== null)
            ZBtoonEX_map.copy(this.textureMapping[1]);
    }

    public destroy(device: GfxDevice): void {
        this.ZAtoon.destroy(device);
        this.ZBtoonEX.destroy(device);
        this.dynToonTex.destroy(device);
    }
}

interface VirtColors {
    vr_back_cloud: Color;
    vr_sky: Color;
    vr_uso_umi: Color;
    vr_kasumi_mae: Color;
}

export interface KyankoColors {
    actorC0: Color;
    actorK0: Color;
    bg0C0: Color;
    bg0K0: Color;
    bg1C0: Color;
    bg1K0: Color;
    bg2C0: Color;
    bg2K0: Color;
    bg3C0: Color;
    bg3K0: Color;
    virtColors: VirtColors | null;
}

interface DZSChunkHeader {
    type: string;
    count: number;
    offs: number;
}

function parseDZSHeaders(buffer: ArrayBufferSlice): Map<string, DZSChunkHeader> {
    const view = buffer.createDataView();
    const chunkCount = view.getUint32(0x00);

    const chunkHeaders = new Map<string, DZSChunkHeader>();
    let chunkTableIdx = 0x04;
    for (let i = 0; i < chunkCount; i++) {
        const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
        const numEntries = view.getUint32(chunkTableIdx + 0x04);
        const offs = view.getUint32(chunkTableIdx + 0x08);
        chunkHeaders.set(type, { type, count: numEntries, offs });
        chunkTableIdx += 0x0C;
    }

    return chunkHeaders;
}

function kyankoColorsLerp(dst: KyankoColors, a: KyankoColors, b: KyankoColors, t: number): void {
    colorLerp(dst.actorK0, a.actorK0, b.actorK0, t);
    colorLerp(dst.actorC0, a.actorC0, b.actorC0, t);
    colorLerp(dst.bg0C0, a.bg0C0, b.bg0C0, t);
    colorLerp(dst.bg0K0, a.bg0K0, b.bg0K0, t);
    colorLerp(dst.bg1C0, a.bg1C0, b.bg1C0, t);
    colorLerp(dst.bg1K0, a.bg1K0, b.bg1K0, t);
    colorLerp(dst.bg2C0, a.bg2C0, b.bg2C0, t);
    colorLerp(dst.bg2K0, a.bg2K0, b.bg2K0, t);
    colorLerp(dst.bg3C0, a.bg3C0, b.bg3C0, t);
    colorLerp(dst.bg3K0, a.bg3K0, b.bg3K0, t);

    if (dst.virtColors !== null) {
        const aVirt = assertExists(a.virtColors);
        const bVirt = assertExists(b.virtColors);

        colorLerp(dst.virtColors.vr_back_cloud, aVirt.vr_back_cloud, bVirt.vr_back_cloud, t);
        colorLerp(dst.virtColors.vr_kasumi_mae, aVirt.vr_kasumi_mae, bVirt.vr_kasumi_mae, t);
        colorLerp(dst.virtColors.vr_sky, aVirt.vr_sky, bVirt.vr_sky, t);
        colorLerp(dst.virtColors.vr_uso_umi, aVirt.vr_uso_umi, bVirt.vr_uso_umi, t);
    }
}

export function getKyankoColorsFromDZS(buffer: ArrayBufferSlice, roomIdx: number, timeOfDay: number): KyankoColors {
    const view = buffer.createDataView();
    const chunkHeaders = parseDZSHeaders(buffer);

    const coloIdx = view.getUint8(chunkHeaders.get('EnvR')!.offs + (roomIdx * 0x08));
    const coloOffs = chunkHeaders.get('Colo')!.offs + (coloIdx * 0x0C);
    const whichPale = timeOfDay;
    const paleIdx = view.getUint8(coloOffs + whichPale);
    const paleOffs = chunkHeaders.get('Pale')!.offs + (paleIdx * 0x2C);

    const actorShadowR = view.getUint8(paleOffs + 0x00) / 0xFF;
    const actorShadowG = view.getUint8(paleOffs + 0x01) / 0xFF;
    const actorShadowB = view.getUint8(paleOffs + 0x02) / 0xFF;
    const actorShadow = colorNew(actorShadowR, actorShadowG, actorShadowB, 1);

    const actorAmbientR = view.getUint8(paleOffs + 0x03) / 0xFF;
    const actorAmbientG = view.getUint8(paleOffs + 0x04) / 0xFF;
    const actorAmbientB = view.getUint8(paleOffs + 0x05) / 0xFF;
    const actorAmbient = colorNew(actorAmbientR, actorAmbientG, actorAmbientB, 1);

    const bg0C0R = view.getUint8(paleOffs + 0x06) / 0xFF;
    const bg0C0G = view.getUint8(paleOffs + 0x07) / 0xFF;
    const bg0C0B = view.getUint8(paleOffs + 0x08) / 0xFF;
    const bg0C0 = colorNew(bg0C0R, bg0C0G, bg0C0B, 1);

    const bg0K0R = view.getUint8(paleOffs + 0x09) / 0xFF;
    const bg0K0G = view.getUint8(paleOffs + 0x0A) / 0xFF;
    const bg0K0B = view.getUint8(paleOffs + 0x0B) / 0xFF;
    const bg0K0 = colorNew(bg0K0R, bg0K0G, bg0K0B, 1);

    const bg1C0R = view.getUint8(paleOffs + 0x0C) / 0xFF;
    const bg1C0G = view.getUint8(paleOffs + 0x0D) / 0xFF;
    const bg1C0B = view.getUint8(paleOffs + 0x0E) / 0xFF;
    const bg1C0 = colorNew(bg1C0R, bg1C0G, bg1C0B, 1);

    const bg1K0R = view.getUint8(paleOffs + 0x0F) / 0xFF;
    const bg1K0G = view.getUint8(paleOffs + 0x10) / 0xFF;
    const bg1K0B = view.getUint8(paleOffs + 0x11) / 0xFF;
    const bg1K0 = colorNew(bg1K0R, bg1K0G, bg1K0B, 1);

    const bg2C0R = view.getUint8(paleOffs + 0x12) / 0xFF;
    const bg2C0G = view.getUint8(paleOffs + 0x13) / 0xFF;
    const bg2C0B = view.getUint8(paleOffs + 0x14) / 0xFF;
    const bg2C0 = colorNew(bg2C0R, bg2C0G, bg2C0B, 1);

    const bg2K0R = view.getUint8(paleOffs + 0x15) / 0xFF;
    const bg2K0G = view.getUint8(paleOffs + 0x16) / 0xFF;
    const bg2K0B = view.getUint8(paleOffs + 0x17) / 0xFF;
    const bg2K0 = colorNew(bg2K0R, bg2K0G, bg2K0B, 1);

    const bg3C0R = view.getUint8(paleOffs + 0x18) / 0xFF;
    const bg3C0G = view.getUint8(paleOffs + 0x19) / 0xFF;
    const bg3C0B = view.getUint8(paleOffs + 0x1A) / 0xFF;
    const bg3C0 = colorNew(bg3C0R, bg3C0G, bg3C0B, 1);

    const bg3K0R = view.getUint8(paleOffs + 0x1B) / 0xFF;
    const bg3K0G = view.getUint8(paleOffs + 0x1C) / 0xFF;
    const bg3K0B = view.getUint8(paleOffs + 0x1D) / 0xFF;
    const bg3K0 = colorNew(bg3K0R, bg3K0G, bg3K0B, 1);

    let virtColors: VirtColors | null = null;
    if (chunkHeaders.has('Virt')) {
        const virtIdx = view.getUint8(paleOffs + 0x21);
        const virtOffs = chunkHeaders.get('Virt')!.offs + (virtIdx * 0x24);
        const vr_back_cloudR = view.getUint8(virtOffs + 0x10) / 0xFF;
        const vr_back_cloudG = view.getUint8(virtOffs + 0x11) / 0xFF;
        const vr_back_cloudB = view.getUint8(virtOffs + 0x12) / 0xFF;
        const vr_back_cloudA = view.getUint8(virtOffs + 0x13) / 0xFF;
        const vr_back_cloud = colorNew(vr_back_cloudR, vr_back_cloudG, vr_back_cloudB, vr_back_cloudA);

        const vr_skyR = view.getUint8(virtOffs + 0x18) / 0xFF;
        const vr_skyG = view.getUint8(virtOffs + 0x19) / 0xFF;
        const vr_skyB = view.getUint8(virtOffs + 0x1A) / 0xFF;
        const vr_sky = colorNew(vr_skyR, vr_skyG, vr_skyB, 1);

        const vr_uso_umiR = view.getUint8(virtOffs + 0x1B) / 0xFF;
        const vr_uso_umiG = view.getUint8(virtOffs + 0x1C) / 0xFF;
        const vr_uso_umiB = view.getUint8(virtOffs + 0x1D) / 0xFF;
        const vr_uso_umi = colorNew(vr_uso_umiR, vr_uso_umiG, vr_uso_umiB, 1);

        const vr_kasumi_maeG = view.getUint8(virtOffs + 0x1F) / 0xFF;
        const vr_kasumi_maeR = view.getUint8(virtOffs + 0x1E) / 0xFF;
        const vr_kasumi_maeB = view.getUint8(virtOffs + 0x20) / 0xFF;
        const vr_kasumi_mae = colorNew(vr_kasumi_maeR, vr_kasumi_maeG, vr_kasumi_maeB, 1);
        virtColors = { vr_back_cloud, vr_sky, vr_uso_umi, vr_kasumi_mae };
    } else {
        virtColors = null;
    }

    return {
        actorC0: actorShadow, actorK0: actorAmbient,
        bg0C0, bg0K0, bg1C0, bg1K0, bg2C0, bg2K0, bg3C0, bg3K0,
        virtColors,
    };
}

function createModelInstance(device: GfxDevice, cache: GfxRenderCache, rarc: RARC.RARC, name: string, isSkybox: boolean = false): J3DModelInstanceSimple | null {
    let bdlFile = rarc.findFile(`bdl/${name}.bdl`);
    if (!bdlFile)
        bdlFile = rarc.findFile(`bmd/${name}.bmd`);
    if (!bdlFile)
        return null;
    const btkFile = rarc.findFile(`btk/${name}.btk`);
    const brkFile = rarc.findFile(`brk/${name}.brk`);
    const bckFile = rarc.findFile(`bck/${name}.bck`);
    const bdl = BMD.parse(bdlFile.buffer);
    const bmdModel = new J3DModelData(device, cache, bdl);
    const modelInstance = new J3DModelInstanceSimple(bmdModel);
    modelInstance.passMask = isSkybox ? WindWakerPass.SKYBOX : WindWakerPass.MAIN;

    if (btkFile !== null) {
        const btk = BTK.parse(btkFile.buffer);
        modelInstance.bindTTK1(btk);
    }

    if (brkFile !== null) {
        const brk = BRK.parse(brkFile.buffer);
        modelInstance.bindTRK1(brk);
    }

    if (bckFile !== null) {
        const bck = BCK.parse(bckFile.buffer);
        modelInstance.bindANK1(bck);
    }

    modelInstance.isSkybox = isSkybox;
    return modelInstance;
}

export class WindWakerRoomRenderer {
    public bg0: J3DModelInstanceSimple | null;
    public bg1: J3DModelInstanceSimple | null;
    public bg2: J3DModelInstanceSimple | null;
    public bg3: J3DModelInstanceSimple | null;
    public name: string;
    public visible: boolean = true;
    public objectsVisible = true;
    public objectRenderers: ObjectRenderer[] = [];
    public dzb: DZB.DZB;

    public roomToWorldMatrix = mat4.create();
    public worldToRoomMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, private extraTextures: ZWWExtraTextures, public roomIdx: number, public roomRarc: RARC.RARC) {
        this.name = `Room ${roomIdx}`;

        this.dzb = DZB.parse(assertExists(roomRarc.findFileData(`dzb/room.dzb`)));

        this.bg0 = createModelInstance(device, cache, roomRarc, `model`);

        // Ocean.
        this.bg1 = createModelInstance(device, cache, roomRarc, `model1`);

        // Special effects / Skybox as seen in Hyrule.
        this.bg2 = createModelInstance(device, cache, roomRarc, `model2`);

        // Windows / doors.
        this.bg3 = createModelInstance(device, cache, roomRarc, `model3`);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (this.bg0 !== null)
            this.bg0.prepareToRender(device, renderInstManager, viewerInput);
        if (this.bg1 !== null)
            this.bg1.prepareToRender(device, renderInstManager, viewerInput);
        if (this.bg2 !== null)
            this.bg2.prepareToRender(device, renderInstManager, viewerInput);
        if (this.bg3 !== null)
            this.bg3.prepareToRender(device, renderInstManager, viewerInput);

        if (this.objectsVisible) {
            for (let i = 0; i < this.objectRenderers.length; i++) {
                this.objectRenderers[i].setExtraTextures(this.extraTextures);
                this.objectRenderers[i].prepareToRender(device, renderInstManager, viewerInput);
            }
        }
    }

    public setModelMatrix(modelMatrix: mat4): void {
        if (this.bg0 !== null)
            mat4.copy(this.bg0.modelMatrix, modelMatrix);
        if (this.bg1 !== null)
            mat4.copy(this.bg1.modelMatrix, modelMatrix);
        if (this.bg3 !== null)
            mat4.copy(this.bg3.modelMatrix, modelMatrix);
    }

    public setKyankoColors(colors: KyankoColors): void {
        if (this.bg0 !== null)
            settingTevStruct(this.bg0, LightTevColorType.BG0, colors);

        if (this.bg1 !== null)
            settingTevStruct(this.bg1, LightTevColorType.BG1, colors);

        if (this.bg2 !== null)
            settingTevStruct(this.bg2, LightTevColorType.BG2, colors);

        if (this.bg3 !== null)
            settingTevStruct(this.bg3, LightTevColorType.BG3, colors);

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setKyankoColors(colors);
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
    public setVertexColorsEnabled(v: boolean): void {
        if (this.bg0 !== null)
            this.bg0.setVertexColorsEnabled(v);
        if (this.bg1 !== null)
            this.bg1.setVertexColorsEnabled(v);
        if (this.bg2 !== null)
            this.bg2.setVertexColorsEnabled(v);
        if (this.bg3 !== null)
            this.bg3.setVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        if (this.bg0 !== null)
            this.bg0.setTexturesEnabled(v);
        if (this.bg1 !== null)
            this.bg1.setTexturesEnabled(v);
        if (this.bg2 !== null)
            this.bg2.setTexturesEnabled(v);
        if (this.bg3 !== null)
            this.bg3.setTexturesEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setTexturesEnabled(v);
    }

    public destroy(device: GfxDevice): void {
        if (this.bg0 !== null)
            this.bg0.destroy(device);
        if (this.bg1 !== null)
            this.bg1.destroy(device);
        if (this.bg2 !== null)
            this.bg2.destroy(device);
        if (this.bg3 !== null)
            this.bg3.destroy(device);
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

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setBindingLayouts(seaPlaneBindingLayouts);
        renderInst.setMegaStateFlags({
            depthWrite: true,
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LESS),
        });
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.drawIndexes(6);
        renderInst.filterKey = WindWakerPass.MAIN;

        let offs = renderInst.allocateUniformBuffer(0, 32);
        const d = renderInst.mapUniformBufferF32(0);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        this.computeModelView(scratchMatrix, viewerInput.camera);
        offs += fillMatrix4x3(d, offs, scratchMatrix);
        offs += fillColor(d, offs, this.color);
    }

    public setKyankoColors(kyankoColors: KyankoColors): void {
        colorCopy(this.color, kyankoColors.bg1K0);
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
            emitter.drawGroupId = WindWakerPass.EFFECT_INDIRECT;
        } else {
            emitter.drawGroupId = WindWakerPass.EFFECT_MAIN;
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

const enum TimeOfDay {
    DAWN,
    MORNING,
    DAY,
    AFTERNOON,
    DUSK,
    NIGHT,
}

export const enum WindWakerPass {
    MAIN,
    SKYBOX,
    EFFECT_MAIN,
    EFFECT_INDIRECT,
}

class SkyEnvironment {
    private vr_sky: J3DModelInstanceSimple | null;
    private vr_uso_umi: J3DModelInstanceSimple | null;
    private vr_kasumi_mae: J3DModelInstanceSimple | null;
    private vr_back_cloud: J3DModelInstanceSimple | null;

    constructor(device: GfxDevice, cache: GfxRenderCache, stageRarc: RARC.RARC) {
        this.vr_sky = createModelInstance(device, cache, stageRarc, `vr_sky`, true);
        this.vr_uso_umi = createModelInstance(device, cache, stageRarc, `vr_uso_umi`, true);
        this.vr_kasumi_mae = createModelInstance(device, cache, stageRarc, `vr_kasumi_mae`, true);
        this.vr_back_cloud = createModelInstance(device, cache, stageRarc, `vr_back_cloud`, true);
    }

    public setKyankoColors(colors: KyankoColors): void {
        const virtColors = colors.virtColors;
        if (virtColors === null)
            return;

        if (this.vr_sky !== null)
            this.vr_sky.setColorOverride(ColorKind.K0, virtColors.vr_sky);
        if (this.vr_uso_umi !== null)
            this.vr_uso_umi.setColorOverride(ColorKind.K0, virtColors.vr_uso_umi);
        if (this.vr_kasumi_mae !== null)
            this.vr_kasumi_mae.setColorOverride(ColorKind.C0, virtColors.vr_kasumi_mae);
        if (this.vr_back_cloud !== null)
            this.vr_back_cloud.setColorOverride(ColorKind.K0, virtColors.vr_back_cloud, true);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.vr_sky !== null)
            this.vr_sky.prepareToRender(device, renderInstManager, viewerInput);
        if (this.vr_kasumi_mae !== null)
            this.vr_kasumi_mae.prepareToRender(device, renderInstManager, viewerInput);
        if (this.vr_uso_umi !== null)
            this.vr_uso_umi.prepareToRender(device, renderInstManager, viewerInput);
        if (this.vr_back_cloud !== null)
            this.vr_back_cloud.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        if (this.vr_sky !== null)
            this.vr_sky.destroy(device);
        if (this.vr_kasumi_mae !== null)
            this.vr_kasumi_mae.destroy(device);
        if (this.vr_uso_umi !== null)
            this.vr_uso_umi.destroy(device);
        if (this.vr_back_cloud !== null)
            this.vr_back_cloud.destroy(device);
    }
}

export class WindWakerRenderer implements Viewer.SceneGfx {
    private renderTarget = new BasicRenderTarget();
    public opaqueSceneTexture = new ColorTexture();
    public renderHelper: GXRenderHelperGfx;

    private seaPlane: SeaPlane | null = null;

    public skyEnvironment: SkyEnvironment | null = null;
    public roomRenderers: WindWakerRoomRenderer[] = [];
    public effectSystem: SimpleEffectSystem;
    public extraTextures: ZWWExtraTextures;
    public renderCache: GfxRenderCache;

    public flowerPacket: FlowerPacket;
    public treePacket: TreePacket;
    public grassPacket: GrassPacket;

    public roomMatrix = mat4.create();
    public roomInverseMatrix = mat4.create();
    public stage: string;
    public time: number; // In milliseconds, affected by pause and time scaling
    public frameCount: number; // Assumes 33 FPS, affected by pause and time scaling
    
    public currentColors: KyankoColors;

    private timeOfDayColors: KyankoColors[] = [];

    public onstatechanged!: () => void;

    constructor(public device: GfxDevice, public modelCache: ModelCache, public symbolMap: SymbolMap, wantsSeaPlane: boolean, private stageRarc: RARC.RARC) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.renderCache = this.renderHelper.renderInstManager.gfxRenderCache;

        if (wantsSeaPlane)
            this.seaPlane = new SeaPlane(device, this.renderCache);

        // Build color palette.
        const dzsBuffer = this.stageRarc.findFileData(`dzs/stage.dzs`)!;
        for (let i = 0; i < 6; i++)
            this.timeOfDayColors.push(getKyankoColorsFromDZS(dzsBuffer, 0, i));
        this.currentColors = getKyankoColorsFromDZS(dzsBuffer, 0, 0);

        this.treePacket = new TreePacket(this);
        this.flowerPacket = new FlowerPacket(this);
        this.grassPacket = new GrassPacket(this);
    }

    public getRoomDZB(roomIdx: number): DZB.DZB {
        const roomRenderer = assertExists(this.roomRenderers.find((r) => r.roomIdx === roomIdx));
        return roomRenderer.dzb;
    }

    private setTimeOfDay(timeOfDay: number): void {
        const i0 = ((timeOfDay + 0) % 6) | 0;
        const i1 = ((timeOfDay + 1) % 6) | 0;
        const t = timeOfDay % 1;

        kyankoColorsLerp(this.currentColors, this.timeOfDayColors[i0], this.timeOfDayColors[i1], t);

        if (this.skyEnvironment !== null)
            this.skyEnvironment.setKyankoColors(this.currentColors);

        if (this.seaPlane !== null)
            this.seaPlane.setKyankoColors(this.currentColors);

        for (let i = 0; i < this.roomRenderers.length; i++) {
            // TODO(jstpierre): Use roomIdx for colors?
            // const roomColors = getColorsFromDZS(dzsBuffer, 0, timeOfDay);
            this.roomRenderers[i].setKyankoColors(this.currentColors);
        }
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
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setTexturesEnabled(enableTextures.checked);
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

        this.extraTextures.prepareToRender(device);

        template.filterKey = WindWakerPass.MAIN;

        fillSceneParamsDataOnTemplate(template, viewerInput);
        if (this.seaPlane)
            this.seaPlane.prepareToRender(renderInstManager, viewerInput);
        if (this.skyEnvironment !== null)
            this.skyEnvironment.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].prepareToRender(device, renderInstManager, viewerInput);

        // Grass/Flowers/Trees
        this.flowerPacket.calc();
        this.treePacket.calc();
        this.grassPacket.calc();

        this.flowerPacket.update();
        this.treePacket.update();
        this.grassPacket.update();

        this.flowerPacket.draw(renderInstManager, viewerInput, device);
        this.treePacket.draw(renderInstManager, viewerInput, device);
        this.grassPacket.draw(renderInstManager, viewerInput, device);

        {
            this.effectSystem.calc(viewerInput);
            this.effectSystem.setOpaqueSceneTexture(this.opaqueSceneTexture.gfxTexture!);

            for (let drawType = WindWakerPass.EFFECT_MAIN; drawType <= WindWakerPass.EFFECT_INDIRECT; drawType++) {
                const template = renderInstManager.pushTemplateRenderInst();
                template.filterKey = drawType;

                let texPrjMtx: mat4 | null = null;
                if (drawType === WindWakerPass.EFFECT_INDIRECT) {
                    texPrjMtx = scratchMatrix;
                    texProjCameraSceneTex(texPrjMtx, viewerInput.camera, viewerInput.viewport, 1);
                }

                this.effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, texPrjMtx);
                this.effectSystem.draw(device, this.renderHelper.renderInstManager, drawType);
                renderInstManager.popTemplateRenderInst();
            }
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.opaqueSceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const kStartTime = TimeOfDay.DAY;
        const kProgressTimeOfDay = true;
        const kDayLengthInSeconds = 60.0;
        const kTimeFactor = kProgressTimeOfDay ? 6 / (kDayLengthInSeconds * 1000.0) : 0.0;
        this.setTimeOfDay(kStartTime + viewerInput.time * kTimeFactor);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        renderInstManager.setVisibleByFilterKeyExact(WindWakerPass.SKYBOX);
        renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        renderInstManager.setVisibleByFilterKeyExact(WindWakerPass.MAIN);
        renderInstManager.drawOnPassRenderer(device, mainPassRenderer);
        renderInstManager.setVisibleByFilterKeyExact(WindWakerPass.EFFECT_MAIN);
        renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        mainPassRenderer.endPass(this.opaqueSceneTexture.gfxTexture);
        device.submitPass(mainPassRenderer);

        // Now indirect stuff.
        const indirectPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, noClearRenderPassDescriptor);
        renderInstManager.setVisibleByFilterKeyExact(WindWakerPass.EFFECT_INDIRECT);
        renderInstManager.drawOnPassRenderer(device, indirectPassRenderer);

        renderInstManager.resetRenderInsts();
        return indirectPassRenderer;
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy(device);
        this.opaqueSceneTexture.destroy(device);
        this.extraTextures.destroy(device);
        this.renderTarget.destroy(device);
        if (this.seaPlane)
            this.seaPlane.destroy(device);
        if (this.skyEnvironment !== null)
            this.skyEnvironment.destroy(device);
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].destroy(device);
        if (this.effectSystem !== null)
            this.effectSystem.destroy(device);
    }
}

interface Destroyable {
    destroy(device: GfxDevice): void;
}

export class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private archivePromiseCache = new Map<string, Promise<RARC.RARC>>();
    private archiveCache = new Map<string, RARC.RARC>();
    private modelCache = new Map<string, J3DModelData>();
    public extraCache = new Map<string, Destroyable>();
    public extraModels: J3DModelData[] = [];

    constructor(private dataFetcher: DataFetcher) {
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
        const p = this.dataFetcher.fetchData(fetchPath);
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

    public getArchive(archivePath: string): RARC.RARC {
        return assertExists(this.archiveCache.get(archivePath));
    }

    public fetchArchive(archivePath: string): Promise<RARC.RARC> {
        let p = this.archivePromiseCache.get(archivePath);
        if (p === undefined) {
            p = this.fetchFile(archivePath).then((data) => {
                if (readString(data, 0, 0x04) === 'Yaz0')
                    return Yaz0.decompress(data);
                else
                    return data;
            }).then((data) => {
                const arc = RARC.parse(data);
                this.archiveCache.set(archivePath, arc);
                return arc;
            });
            this.archivePromiseCache.set(archivePath, p);
        }

        return p;
    }

    public fetchObjectData(arcName: string): void {
        this.fetchArchive(`${pathBase}/Object/${arcName}.arc`);
    }

    public getObjectData(arcName: string): RARC.RARC {
        return this.getArchive(`${pathBase}/Object/${arcName}.arc`);
    }

    public getModel(device: GfxDevice, cache: GfxRenderCache, rarc: RARC.RARC, modelPath: string): J3DModelData {
        let p = this.modelCache.get(modelPath);

        if (p === undefined) {
            const bmdData = rarc.findFileData(modelPath)!;
            const bmd = BMD.parse(bmdData);
            p = new J3DModelData(device, cache, bmd);
            this.modelCache.set(modelPath, p);
        }

        return p;
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.modelCache.values())
            model.destroy(device);
        for (let i = 0; i < this.extraModels.length; i++)
            this.extraModels[i].destroy(device);
        for (const x of this.extraCache.values())
            x.destroy(device);
    }
}

export const pathBase = `j3d/ww`;

class SceneDesc {
    public id: string;

    public constructor(public stageDir: string, public name: string, public rooms: number[] = [0]) {
        this.id = stageDir;

        // Garbage hack.
        if (this.stageDir === 'sea' && rooms.length === 1)
            this.id = `Room${rooms[0]}.arc`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = new ModelCache(context.dataFetcher);
        context.destroyablePool.push(modelCache);

        modelCache.fetchArchive(`${pathBase}/Object/System.arc`);
        modelCache.fetchArchive(`${pathBase}/Stage/${this.stageDir}/Stage.arc`);

        const particleArchives = [
            `${pathBase}/Particle/common.jpc`,
            // `${pathBase}/Particle/Pscene000.jpc`,
            // `${pathBase}/Particle/Pscene001.jpc`,
            // `${pathBase}/Particle/Pscene004.jpc`,
            // `${pathBase}/Particle/Pscene005.jpc`,
            // `${pathBase}/Particle/Pscene011.jpc`,
            // `${pathBase}/Particle/Pscene013.jpc`,
            // `${pathBase}/Particle/Pscene014.jpc`,
            // `${pathBase}/Particle/Pscene020.jpc`,
            // `${pathBase}/Particle/Pscene021.jpc`,
            // `${pathBase}/Particle/Pscene022.jpc`,
            // `${pathBase}/Particle/Pscene023.jpc`,
            // `${pathBase}/Particle/Pscene026.jpc`,
            // `${pathBase}/Particle/Pscene030.jpc`,
            // `${pathBase}/Particle/Pscene035.jpc`,
            // `${pathBase}/Particle/Pscene036.jpc`,
            // `${pathBase}/Particle/Pscene043.jpc`,
            // `${pathBase}/Particle/Pscene044.jpc`,
            // `${pathBase}/Particle/Pscene050.jpc`,
            // `${pathBase}/Particle/Pscene051.jpc`,
            // `${pathBase}/Particle/Pscene060.jpc`,
            // `${pathBase}/Particle/Pscene061.jpc`,
            // `${pathBase}/Particle/Pscene070.jpc`,
            // `${pathBase}/Particle/Pscene071.jpc`,
            // `${pathBase}/Particle/Pscene078.jpc`,
            // `${pathBase}/Particle/Pscene080.jpc`,
            // `${pathBase}/Particle/Pscene081.jpc`,
            // `${pathBase}/Particle/Pscene082.jpc`,
            // `${pathBase}/Particle/Pscene083.jpc`,
            // `${pathBase}/Particle/Pscene084.jpc`,
            // `${pathBase}/Particle/Pscene085.jpc`,
            // `${pathBase}/Particle/Pscene086.jpc`,
            // `${pathBase}/Particle/Pscene090.jpc`,
            // `${pathBase}/Particle/Pscene127.jpc`,
            // `${pathBase}/Particle/Pscene150.jpc`,
            // `${pathBase}/Particle/Pscene199.jpc`,
            // `${pathBase}/Particle/Pscene200.jpc`,
            // `${pathBase}/Particle/Pscene201.jpc`,
            // `${pathBase}/Particle/Pscene202.jpc`,
            // `${pathBase}/Particle/Pscene203.jpc`,
            // `${pathBase}/Particle/Pscene204.jpc`,
            // `${pathBase}/Particle/Pscene205.jpc`,
            // `${pathBase}/Particle/Pscene206.jpc`,
            // `${pathBase}/Particle/Pscene207.jpc`,
            // `${pathBase}/Particle/Pscene208.jpc`,
            // `${pathBase}/Particle/Pscene209.jpc`,
            // `${pathBase}/Particle/Pscene210.jpc`,
            // `${pathBase}/Particle/Pscene211.jpc`,
            // `${pathBase}/Particle/Pscene213.jpc`,
            // `${pathBase}/Particle/Pscene217.jpc`,
            // `${pathBase}/Particle/Pscene218.jpc`,
            // `${pathBase}/Particle/Pscene219.jpc`,
            // `${pathBase}/Particle/Pscene220.jpc`,
            // `${pathBase}/Particle/Pscene221.jpc`,
            // `${pathBase}/Particle/Pscene222.jpc`,
            // `${pathBase}/Particle/Pscene223.jpc`,
            // `${pathBase}/Particle/Pscene224.jpc`,
            // `${pathBase}/Particle/Pscene254.jpc`,
        ];

        for (let i = 0; i < particleArchives.length; i++)
            modelCache.fetchFileData(particleArchives[i]);

        // XXX(jstpierre): This is really terrible code.
        for (let i = 0; i < this.rooms.length; i++) {
            const roomIdx = Math.abs(this.rooms[i]);
            modelCache.fetchArchive(`${pathBase}/Stage/${this.stageDir}/Room${roomIdx}.arc`);
        }

        modelCache.fetchFileData(`${pathBase}/extra.crg1_arc`, 2);

        await modelCache.waitForLoad();

        const systemArc = modelCache.getArchive(`${pathBase}/Object/System.arc`);

        const stageRarc = modelCache.getArchive(`${pathBase}/Stage/${this.stageDir}/Stage.arc`);
        const dzs = stageRarc.findFileData(`dzs/stage.dzs`)!;
        const dzsHeaders = parseDZSHeaders(dzs);
        const mult = dzsHeaders.get('MULT');

        const symbolMap = BYML.parse<SymbolMap>(modelCache.getFileData(`${pathBase}/extra.crg1_arc`), BYML.FileType.CRG1);
        const relTable = this.createRelNameTable(symbolMap);
        const actorTable = this.createActorTable(symbolMap, relTable);

        const isSea = this.stageDir === 'sea';
        const isFullSea = isSea && this.rooms.length > 1;
        const renderer = new WindWakerRenderer(device, modelCache, symbolMap, isSea, stageRarc);
        context.destroyablePool.push(renderer);

        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
        const ZAtoon = new BTIData(device, cache, BTI.parse(systemArc.findFileData(`dat/toon.bti`)!, `ZAtoon`).texture);
        const ZBtoonEX = new BTIData(device, cache, BTI.parse(systemArc.findFileData(`dat/toonex.bti`)!, `ZBtoonEX`).texture);
        renderer.extraTextures = new ZWWExtraTextures(device, ZAtoon, ZBtoonEX);

        renderer.skyEnvironment = new SkyEnvironment(device, cache, stageRarc);
        renderer.stage = this.stageDir;

        const jpac: JPA.JPAC[] = [];
        for (let i = 0; i < particleArchives.length; i++) {
            const jpacData = modelCache.getFileData(particleArchives[i]);
            jpac.push(JPA.parse(jpacData));
        }
        renderer.effectSystem = new SimpleEffectSystem(device, jpac);

        this.requestArchivesForActors(renderer, -1, dzs, actorTable);

        for (let i = 0; i < this.rooms.length; i++) {
            const roomIdx = Math.abs(this.rooms[i]);
            const roomRarc = modelCache.getArchive(`${pathBase}/Stage/${this.stageDir}/Room${roomIdx}.arc`);
            if (roomRarc.files.length === 0)
                continue;

            // Load any object archives.
            const dzr = roomRarc.findFileData('dzr/room.dzr')!;
            this.requestArchivesForActors(renderer, i, dzr, actorTable);
        }

        await modelCache.waitForLoad();

        for (let i = 0; i < this.rooms.length; i++) {
            const roomIdx = Math.abs(this.rooms[i]);
            const roomRarc = modelCache.getArchive(`${pathBase}/Stage/${this.stageDir}/Room${roomIdx}.arc`);
            if (roomRarc.files.length === 0)
                continue;

            const visible = this.rooms[i] >= 0;

            const modelMatrix = mat4.create();
            if (mult !== undefined)
                this.getRoomMult(modelMatrix, dzs, mult, roomIdx);

            // Spawn the room.
            const roomRenderer = new WindWakerRoomRenderer(device, cache, renderer.extraTextures, roomIdx, roomRarc);
            roomRenderer.visible = visible;
            renderer.roomRenderers.push(roomRenderer);

            // @HACK: Set up un-hacked room matrices
            roomRenderer.worldToRoomMatrix.set(modelMatrix);
            mat4.invert(roomRenderer.roomToWorldMatrix, roomRenderer.worldToRoomMatrix);

            // HACK: for single-purpose sea levels, translate the objects instead of the model.
            if (isSea && !isFullSea) {
                mat4.invert(modelMatrix, modelMatrix);
            } else {
                roomRenderer.setModelMatrix(modelMatrix);
                mat4.identity(modelMatrix);
            }

            mat4.copy(renderer.roomMatrix, modelMatrix);
            mat4.invert(renderer.roomInverseMatrix, renderer.roomMatrix);

            const dzr = roomRarc.findFileData('dzr/room.dzr')!;
            this.spawnActors(renderer, roomRenderer, dzr, modelMatrix, actorTable);
        }

        // HACK(jstpierre): We spawn stage actors on the first room renderer.
        mat4.identity(scratchMatrix);
        this.spawnActors(renderer, renderer.roomRenderers[0], dzs, scratchMatrix, actorTable);

        // TODO(jstpierre): Not all the actors load in the requestArchives phase...
        await modelCache.waitForLoad();

        return renderer;
    }

    private getRoomMult(modelMatrix: mat4, buffer: ArrayBufferSlice, multHeader: DZSChunkHeader, roomIdx: number): void {
        const view = buffer.createDataView();

        let multIdx = multHeader.offs;
        for (let i = 0; i < multHeader.count; i++) {
            const translationX = view.getFloat32(multIdx + 0x00);
            const translationY = view.getFloat32(multIdx + 0x04);
            const rotY = view.getInt16(multIdx + 0x08) / 0x7FFF * Math.PI;
            const roomNo = view.getUint8(multIdx + 0x0A);
            const waveHeightAddition = view.getUint8(multIdx + 0x0B);
            multIdx += 0x0C;

            if (roomNo === roomIdx) {
                mat4.rotateY(modelMatrix, modelMatrix, rotY);
                modelMatrix[12] += translationX;
                modelMatrix[14] += translationY;
                break;
            }
        }
    }

    private createRelNameTable(symbolMap: SymbolMap) {
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

    private createActorTable(symbolMap: SymbolMap, relTable: { [id: number]: string }) {
        const entry = assertExists(symbolMap.SymbolData.find((e) => e.Filename === 'd_stage.o' && e.SymbolName === 'l_objectName'));
        const data = entry.Data;
        const bytes = data.createTypedArray(Uint8Array);
        const dataView = data.createDataView();
        const textDecoder = getTextDecoder('utf8') as TextDecoder;

        // The object table consists of null-terminated ASCII strings of length 12.
        // @NOTE: None are longer than 7 characters
        const kNameLength = 12;
        const actorCount = data.byteLength / kNameLength;
        const actorTable = {} as ActorTable;
        for (let i = 0; i < actorCount; i++) {
            const offset = i * kNameLength;
            const end = bytes.indexOf(0, offset); 
            const name = textDecoder.decode(bytes.subarray(offset, end));
            const id = dataView.getUint16(offset + 8, false);
            const subtype = bytes[offset + 10];
            const unknown1 = bytes[offset + 11];

            const relName = relTable[id];

            actorTable[name] = { relName, subtype, unknown1 };
        }

        return actorTable;
    }

    private iterActorLayerACTR(actorTable: ActorTable, roomIdx: number, layerIdx: number, buffer: ArrayBufferSlice, actrHeader: DZSChunkHeader | undefined, callback: (it: Actor) => void): void {
        if (actrHeader === undefined)
            return;

        const view = buffer.createDataView();

        let actrTableIdx = actrHeader.offs;
        for (let i = 0; i < actrHeader.count; i++) {
            const name = readString(buffer, actrTableIdx + 0x00, 0x08, true);
            const parameters = view.getUint32(actrTableIdx + 0x08, false);
            const posX = view.getFloat32(actrTableIdx + 0x0C);
            const posY = view.getFloat32(actrTableIdx + 0x10);
            const posZ = view.getFloat32(actrTableIdx + 0x14);
            // const auxParam = view.getInt16(actrTableIdx + 0x18);
            const rotY = view.getInt16(actrTableIdx + 0x1A) / 0x7FFF * Math.PI;
            const flag = view.getUint16(actrTableIdx + 0x1C);
            const enemyNum = view.getUint16(actrTableIdx + 0x1E);

            const actor: Actor = {
                name,
                info: actorTable[name],
                parameters,
                roomIndex: roomIdx,
                layer: layerIdx,
                pos: vec3.fromValues(posX, posY, posZ),
                scale: vec3.fromValues(1, 1, 1),
                rotationY: rotY,
            };

            callback(actor);

            actrTableIdx += 0x20;
        }
    }

    private iterActorLayerSCOB(actorTable: ActorTable, roomIdx: number, layerIdx: number, buffer: ArrayBufferSlice, actrHeader: DZSChunkHeader | undefined, callback: (it: Actor) => void): void {
        if (actrHeader === undefined)
            return;

        const view = buffer.createDataView();

        let actrTableIdx = actrHeader.offs;
        for (let i = 0; i < actrHeader.count; i++) {
            const name = readString(buffer, actrTableIdx + 0x00, 0x08, true);
            const parameters = view.getUint32(actrTableIdx + 0x08, false);
            const posX = view.getFloat32(actrTableIdx + 0x0C);
            const posY = view.getFloat32(actrTableIdx + 0x10);
            const posZ = view.getFloat32(actrTableIdx + 0x14);
            // const auxParam = view.getInt16(actrTableIdx + 0x18);
            const rotY = view.getInt16(actrTableIdx + 0x1A) / 0x7FFF * Math.PI;
            // const unk1 = view.getInt16(actrTableIdx + 0x1C);
            // const unk2 = view.getInt16(actrTableIdx + 0x1E);
            const scaleX = view.getUint8(actrTableIdx + 0x20) / 10.0;
            const scaleY = view.getUint8(actrTableIdx + 0x21) / 10.0;
            const scaleZ = view.getUint8(actrTableIdx + 0x22) / 10.0;
            // const pad = view.getUint8(actrTableIdx + 0x23);

            const actor: Actor = {
                name,
                info: actorTable[name],
                parameters,
                roomIndex: roomIdx,
                layer: layerIdx,
                pos: vec3.fromValues(posX, posY, posZ),
                scale: vec3.fromValues(scaleX, scaleY, scaleZ),
                rotationY: rotY,
            };

            callback(actor);

            actrTableIdx += 0x24;
        }
    }

    private iterActorLayers(actorTable: ActorTable, roomIdx: number, buffer: ArrayBufferSlice, callback: (it: Actor) => void): void {
        const chunkHeaders = parseDZSHeaders(buffer);

        function buildChunkLayerName(base: string, i: number): string {
            if (i === -1) {
                return base;
            } else {
                return base.slice(0, 3) + i.toString(16).toLowerCase();
            }
        }

        for (let i = -1; i < 16; i++) {
            this.iterActorLayerACTR(actorTable, roomIdx, i, buffer, chunkHeaders.get(buildChunkLayerName('ACTR', i)), callback);
            this.iterActorLayerACTR(actorTable, roomIdx, i, buffer, chunkHeaders.get(buildChunkLayerName('TGOB', i)), callback);
            this.iterActorLayerACTR(actorTable, roomIdx, i, buffer, chunkHeaders.get(buildChunkLayerName('TRES', i)), callback);
            this.iterActorLayerSCOB(actorTable, roomIdx, i, buffer, chunkHeaders.get(buildChunkLayerName('SCOB', i)), callback);
            this.iterActorLayerSCOB(actorTable, roomIdx, i, buffer, chunkHeaders.get(buildChunkLayerName('TGSC', i)), callback);
        }        
    }

    private spawnActors(renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, buffer: ArrayBufferSlice, modelMatrix: mat4, actorTable: ActorTable): void {
        this.iterActorLayers(actorTable, roomRenderer.roomIdx, buffer, (actor) => {
            const placedActor: PlacedActor = actor as PlacedActor;
            placedActor.modelMatrix = mat4.create();
            placedActor.roomRenderer = roomRenderer;
            computeModelMatrixSRT(placedActor.modelMatrix,
                actor.scale[0], actor.scale[1], actor.scale[2],
                0, actor.rotationY, 0,
                actor.pos[0], actor.pos[1], actor.pos[2]);

            loadActor(renderer, roomRenderer, modelMatrix, placedActor);
        });
    }

    private requestArchivesForActors(renderer: WindWakerRenderer, roomIdx: number, buffer: ArrayBufferSlice, actorTable: ActorTable): void {
        this.iterActorLayers(actorTable, roomIdx, buffer, (actor) => {
            requestArchiveForActor(renderer, actor);
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
    new SceneDesc("M_NewD2", "Dragon Roost Cavern", [0, 1, 2, -3, 4, -5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
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
