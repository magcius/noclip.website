
import { mat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../../ArrayBufferSlice';
import { readString, assertExists, hexzero, leftPad, assert, nArray } from '../../util';
import { DataFetcher } from '../../DataFetcher';

import * as Viewer from '../../viewer';
import * as BYML from '../../byml';
import * as RARC from '../rarc';
import * as Yaz0 from '../../Common/Compression/Yaz0';
import * as UI from '../../ui';

import * as DZB from './DZB';
import * as JPA from '../../Common/JSYSTEM/JPA';
import { BMD, BTK, BRK, BCK, LoopMode, BMT } from '../../Common/JSYSTEM/J3D/J3DLoader';
import { J3DModelInstanceSimple, J3DModelData, BMDModelMaterialData } from '../../Common/JSYSTEM/J3D/J3DGraphBase';
import { Camera, computeViewMatrix, texProjCameraSceneTex } from '../../Camera';
import { DeviceProgram } from '../../Program';
import { Color, colorNew, colorLerp, colorCopy, TransparentBlack, colorNewCopy } from '../../Color';
import { ColorKind, fillSceneParamsDataOnTemplate } from '../../gx/gx_render';
import { GXRenderHelperGfx } from '../../gx/gx_render';
import { GfxDevice, GfxRenderPass, GfxHostAccessPass, GfxBufferUsage, GfxFormat, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxBuffer, GfxProgram, GfxBindingLayoutDescriptor, GfxCompareMode, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor, GfxTexture, makeTextureDescriptor2D, GfxInputLayoutBufferDescriptor } from '../../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRendererLayer } from '../../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, ColorTexture, noClearRenderPassDescriptor } from '../../gfx/helpers/RenderTargetHelpers';
import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';
import { fillMatrix4x4, fillMatrix4x3, fillColor } from '../../gfx/helpers/UniformBufferHelpers';
import { makeTriangleIndexBuffer, GfxTopology } from '../../gfx/helpers/TopologyHelpers';
import AnimationController from '../../AnimationController';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { Actor, ObjectRenderer, BMDObjectRenderer, SymbolMap, settingTevStruct, LightTevColorType } from './Actors';
import { SceneContext } from '../../SceneBase';
import { reverseDepthForCompareMode } from '../../gfx/helpers/ReversedDepthHelpers';
import { computeModelMatrixSRT, range } from '../../MathHelpers';
import { TextureMapping } from '../../TextureHolder';
import { EFB_WIDTH, EFB_HEIGHT } from '../../gx/gx_material';
import { BTIData, BTI } from '../../Common/JSYSTEM/JUTTexture';
import { AGrass, FlowerPacket, TreePacket, GrassPacket } from './Grass';
import { getTextDecoder } from '../../util';

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

class WindWakerRoomRenderer {
    public bg0: J3DModelInstanceSimple | null;
    public bg1: J3DModelInstanceSimple | null;
    public bg2: J3DModelInstanceSimple | null;
    public bg3: J3DModelInstanceSimple | null;
    public name: string;
    public visible: boolean = true;
    public objectsVisible = true;
    public objectRenderers: ObjectRenderer[] = [];
    public dzb: DZB.DZB;

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

const enum WindWakerPass {
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

class ModelCache {
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

const pathBase = `j3d/ww`;

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
class SceneDesc {
    public id: string;

    public constructor(public stageDir: string, public name: string, public rooms: number[] = [0]) {
        this.id = stageDir;

        // Garbage hack.
        if (this.stageDir === 'sea' && rooms.length === 1)
            this.id = `Room${rooms[0]}.arc`;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
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

        modelCache.fetchFileData(`${pathBase}/extra.crg1_arc`, 1);

        return modelCache.waitForLoad().then(() => {
            const systemArc = modelCache.getArchive(`${pathBase}/Object/System.arc`);

            const stageRarc = modelCache.getArchive(`${pathBase}/Stage/${this.stageDir}/Stage.arc`);
            const stageDzs = stageRarc.findFileData(`dzs/stage.dzs`)!;
            const stageDzsHeaders = parseDZSHeaders(stageDzs);
            const mult = stageDzsHeaders.get('MULT');
            
            const symbolMap = BYML.parse<SymbolMap>(modelCache.getFileData(`${pathBase}/extra.crg1_arc`), BYML.FileType.CRG1);
            const actorTable = this.createActorNameTable(symbolMap);
            const relTable = this.createRelNameTable(symbolMap);

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

            for (let i = 0; i < this.rooms.length; i++) {
                const roomIdx = Math.abs(this.rooms[i]);
                const roomRarc = modelCache.getArchive(`${pathBase}/Stage/${this.stageDir}/Room${roomIdx}.arc`);
                if (roomRarc.files.length === 0)
                    continue;

                const visible = this.rooms[i] >= 0;

                const modelMatrix = mat4.create();
                if (mult !== undefined)
                    this.getRoomMult(modelMatrix, stageDzs, mult, roomIdx);

                // Spawn the room.
                const roomRenderer = new WindWakerRoomRenderer(device, cache, renderer.extraTextures, roomIdx, roomRarc);
                roomRenderer.visible = visible;
                renderer.roomRenderers.push(roomRenderer);

                // HACK: for single-purpose sea levels, translate the objects instead of the model.
                if (isSea && !isFullSea) {
                    mat4.invert(modelMatrix, modelMatrix);
                } else {
                    roomRenderer.setModelMatrix(modelMatrix);
                    mat4.identity(modelMatrix);
                }

                mat4.copy(renderer.roomMatrix, modelMatrix);
                mat4.invert(renderer.roomInverseMatrix, renderer.roomMatrix);

                // Now spawn any objects that might show up in it.
                const dzr = roomRarc.findFileData('dzr/room.dzr')!;
                this.spawnObjectsFromDZR(device, renderer, roomRenderer, dzr, modelMatrix);
            }

            const jpac: JPA.JPAC[] = [];
            for (let i = 0; i < particleArchives.length; i++) {
                const jpacData = modelCache.getFileData(particleArchives[i]);
                jpac.push(JPA.parse(jpacData));
            }
            renderer.effectSystem = new SimpleEffectSystem(device, jpac);

            return modelCache.waitForLoad().then(() => {
                return renderer;
            });
        });
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

    private createActorNameTable(symbolMap: SymbolMap) {
        const entry = assertExists(symbolMap.SymbolData.find((e) => e.Filename === 'd_stage.o' && e.SymbolName === 'l_objectName'));
        const data = entry.Data;
        const bytes = data.createTypedArray(Uint8Array);
        const dataView = data.createDataView();
        const textDecoder = getTextDecoder('utf8') as TextDecoder;

        // The object table consists of null-terminated ASCII strings of length 12.
        // @NOTE: None are longer than 7 characters
        const kNameLength = 12;
        const objectCount = data.byteLength / kNameLength;
        const objectNames = [];
        const objectTable = {} as { [name: string]: { type: number, subtype: number, unknown1: number } };
        for (let i = 0; i < objectCount; i++) {
            const offset = i * kNameLength;
            const end = bytes.indexOf(0, offset); 
            const name = textDecoder.decode(bytes.subarray(offset, end));
            const type = dataView.getUint16(offset + 8, false);
            const subtype = bytes[offset + 10];
            const unknown1 = bytes[offset + 11];
            objectNames[i] = name;
            objectTable[name] = { type, subtype, unknown1 };
        }

        return objectNames;
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

    private async spawnObjectsForActor(device: GfxDevice, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, name: string, parameters: number, layer: number, localModelMatrix: mat4, worldModelMatrix: mat4, actor: Actor): Promise<void> {
        // TODO(jstpierre): Better actor implementations
        const modelCache = renderer.modelCache;
        const stageName = this.id;
        const roomIdx = roomRenderer.roomIdx;
        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;

        function fetchArchive(objArcName: string): Promise<RARC.RARC> {
            return renderer.modelCache.fetchArchive(`${pathBase}/Object/${objArcName}`);
        }

        function buildChildModel(rarc: RARC.RARC, modelPath: string): BMDObjectRenderer {
            const model = modelCache.getModel(device, cache, rarc, modelPath);
            const modelInstance = new J3DModelInstanceSimple(model);
            modelInstance.passMask = WindWakerPass.MAIN;
            renderer.extraTextures.fillExtraTextures(modelInstance);
            modelInstance.name = name;
            modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
            const objectRenderer = new BMDObjectRenderer(modelInstance);
            objectRenderer.layer = layer;
            return objectRenderer;
        }

        function setModelMatrix(m: mat4): void {
            mat4.mul(m, worldModelMatrix, localModelMatrix);
        }

        function buildModel(rarc: RARC.RARC, modelPath: string): BMDObjectRenderer {
            const objectRenderer = buildChildModel(rarc, modelPath);
            setModelMatrix(objectRenderer.modelMatrix);
            roomRenderer.objectRenderers.push(objectRenderer);
            return objectRenderer;
        }

        function buildModelBMT(rarc: RARC.RARC, modelPath: string, bmtPath: string): BMDObjectRenderer {
            const objectRenderer = buildModel(rarc, modelPath);
            const bmt = BMT.parse(rarc.findFileData(bmtPath)!);
            objectRenderer.modelInstance.setModelMaterialData(new BMDModelMaterialData(device, cache, bmt));
            renderer.extraTextures.fillExtraTextures(objectRenderer.modelInstance);
            return objectRenderer;
        }

        function createEmitter(resourceId: number): JPA.JPABaseEmitter {
            const emitter = renderer.effectSystem!.createBaseEmitter(device, cache, resourceId);
            // TODO(jstpierre): Scale, Rotation
            return emitter;
        }

        function parseBCK(rarc: RARC.RARC, path: string) { const g = BCK.parse(rarc.findFileData(path)!); g.loopMode = LoopMode.REPEAT; return g; }
        function parseBRK(rarc: RARC.RARC, path: string) { return BRK.parse(rarc.findFileData(path)!); }
        function parseBTK(rarc: RARC.RARC, path: string) { return BTK.parse(rarc.findFileData(path)!); }
        function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }

        // Tremendous special thanks to LordNed, Sage-of-Mirrors & LugoLunatic for their work on actor mapping
        // Heavily based on https://github.com/LordNed/Winditor/blob/master/Editor/resources/ActorDatabase.json

        if (name === 'item') {
            // Item table provided with the help of the incredible LugoLunatic <3.
            const itemId = (parameters & 0x000000FF);

            // Heart
            if (itemId === 0x00) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/vhrtl.bdl`));
            // Rupee (Green)
            else if (itemId === 0x01) fetchArchive(`Always.arc`).then((rarc) => {
                const m = buildModel(rarc, `bdlm/vlupl.bdl`);
                m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(0));
                m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
            });
            // Rupee (Blue)
            else if (itemId === 0x02) fetchArchive(`Always.arc`).then((rarc) => {
                const m = buildModel(rarc, `bdlm/vlupl.bdl`);
                m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(1));
                m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
            });
            // Rupee (Yellow)
            else if (itemId === 0x03) fetchArchive(`Always.arc`).then((rarc) => {
                const m = buildModel(rarc, `bdlm/vlupl.bdl`);
                m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(2));
                m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
            });
            // Rupee (Red)
            else if (itemId === 0x04) fetchArchive(`Always.arc`).then((rarc) => {
                const m = buildModel(rarc, `bdlm/vlupl.bdl`);
                m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(3));
                m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
            });
            // Small magic jar
            else if (itemId === 0x09) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdlm/mpoda.bdl`));
            else console.warn(`Unknown item: ${hexzero(itemId, 2)}`);
        }
        // Generic Torch
        else if (name === 'bonbori') {
            const rarc = await fetchArchive(`Ep.arc`);
            const ga = !!((parameters >>> 6) & 0x01);
            const obm = !!((parameters >>> 7) & 0x01);
            let type = (parameters & 0x3F);
            if (type === 0x3F)
                type = 0;

            setModelMatrix(scratchMatrix);
            vec3.set(scratchVec3a, 0, 0, 0);
            if (type === 0 || type === 3) {
                const m = buildModel(rarc, obm ? `bdl/obm_shokudai1.bdl` : `bdl/vktsd.bdl`);
                scratchVec3a[1] += 140;
            }
            vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMatrix);

            // Create particle systems.
            const pa = createEmitter(0x0001);
            vec3.copy(pa.globalTranslation, scratchVec3a);
            pa.globalTranslation[1] += -240 + 235 + 15;
            if (type !== 2) {
                const pb = createEmitter(0x4004);
                vec3.copy(pb.globalTranslation, pa.globalTranslation);
                pb.globalTranslation[1] += 20;
            }
            const pc = createEmitter(0x01EA);
            vec3.copy(pc.globalTranslation, scratchVec3a);
            pc.globalTranslation[1] += -240 + 235 + 8;
            // TODO(jstpierre): ga
        }
        // Hyrule Ocean Warp
        else if (name === 'Ghrwp') {
            const rarc = await fetchArchive(`Ghrwp.arc`);
            const a00 = buildModel(rarc, `bdlm/ghrwpa00.bdl`);
            a00.bindTTK1(parseBTK(rarc, `btk/ghrwpa00.btk`));
            const b00 = buildModel(rarc, `bdlm/ghrwpb00.bdl`);
            b00.bindTTK1(parseBTK(rarc, `btk/ghrwpb00.btk`));
            b00.bindTRK1(parseBRK(rarc, `brk/ghrwpb00.brk`));
        }
        // Outset Island: Jabun's barrier (six parts)
        else if (name === 'Ajav') fetchArchive(`Ajav.arc`).then((rarc) => {
            // Seems like there's one texture that's shared for all parts in ajava.bdl
            // ref. daObjAjav::Act_c::set_tex( (void))
            const ja = buildModel(rarc, `bdl/ajava.bdl`);
            const txa = ja.modelInstance.getTextureMappingReference('Txa_jav_a')!;
            const jb = buildModel(rarc, `bdl/ajavb.bdl`);
            jb.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
            const jc = buildModel(rarc, `bdl/ajavc.bdl`);
            jc.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
            const jd = buildModel(rarc, `bdl/ajavd.bdl`);
            jd.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
            const je = buildModel(rarc, `bdl/ajave.bdl`);
            je.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
            const jf = buildModel(rarc, `bdl/ajavf.bdl`);
            jf.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        });
        // NPCs
        // Aryll
        else if (name === 'Ls' || name === 'Ls1') fetchArchive(`Ls.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ls.bdl`);
            buildChildModel(rarc, `bdl/lshand.bdl`).setParentJoint(m, `handL`);
            buildChildModel(rarc, `bdl/lshand.bdl`).setParentJoint(m, `handR`);
            m.bindANK1(parseBCK(rarc, `bcks/ls_wait01.bck`));
        });
        // Beedle
        else if (name === 'Bs1') fetchArchive(`Bs.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bs.bdl`);
            m.bindANK1(parseBCK(rarc, `bcks/bs_wait01.bck`));
        });
        // Beedle (this time with helmet)
        else if (name === 'Bs2') fetchArchive(`Bs.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bs.bdl`);
            buildChildModel(rarc, `bdlm/bs_met.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/bs_wait01.bck`));
        });
        // Tingle
        else if (name === 'Tc') fetchArchive(`Tc.arc`).then((rarc) => buildModel(rarc, `bdlm/tc.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Grandma
        else if (name === 'Ba1') {
            // Only allow the sleeping grandma through, because how else can you live in life...
            if (parameters === 0x03) {
                const rarc = await fetchArchive(`Ba.arc`);
                const m = buildModel(rarc, `bdlm/ba.bdl`);
                m.bindANK1(parseBCK(rarc, `bcks/wait02.bck`));
            }
        }
        // Salvatore
        else if (name === 'Kg1' || name === 'Kg2') fetchArchive(`Kg.arc`).then((rarc) => buildModel(rarc, `bdlm/kg.bdl`).bindANK1(parseBCK(rarc, `bcks/kg_wait01.bck`)));
        // Orca
        else if (name === 'Ji1') fetchArchive(`Ji.arc`).then((rarc) => buildModel(rarc, `bdlm/ji.bdl`).bindANK1(parseBCK(rarc, `bck/ji_wait01.bck`)));
        // Medli
        else if (name === 'Md1') {
            const rarc = await fetchArchive(`Md.arc`);
            const m = buildModel(rarc, `bdlm/md.bdl`);
            m.bindANK1(parseBCK(rarc, `bcks/md_wait01.bck`));
            const armL = buildChildModel(rarc, `bdlm/mdarm.bdl`);
            armL.bindANK1(parseBCK(rarc, `bcks/mdarm_wait01.bck`));
            armL.modelInstance.setShapeVisible(1, false);
            armL.setParentJoint(m, `armL`);
            const armR = buildChildModel(rarc, `bdlm/mdarm.bdl`);
            armR.bindANK1(parseBCK(rarc, `bcks/mdarm_wait01.bck`));
            armR.modelInstance.setShapeVisible(0, false);
            armR.setParentJoint(m, `armR`);
        }
        // Makar
        else if (name === 'Cb1') fetchArchive(`Cb.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/cb.bdl`);
            buildChildModel(rarc, `bdl/cb_face.bdl`).setParentJoint(m, `backbone`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // The King of Hyrule
        else if (name === 'Hi1') fetchArchive(`Hi.arc`).then((rarc) => buildModel(rarc, `bdlm/hi.bdl`).bindANK1(parseBCK(rarc, `bcks/hi_wait01.bck`)));
        // Princess Zelda
        else if (name === 'p_zelda') fetchArchive(`Pz.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/pz.bdl`);            
            m.setMaterialColorWriteEnabled("m_pz_eyeLdamA", false);
            m.setMaterialColorWriteEnabled("m_pz_eyeLdamB", false);
            m.setMaterialColorWriteEnabled("m_pz_mayuLdamA", false);
            m.setMaterialColorWriteEnabled("m_pz_mayuLdamB", false);
            m.setMaterialColorWriteEnabled("m_pz_eyeRdamA", false);
            m.setMaterialColorWriteEnabled("m_pz_eyeRdamB", false);
            m.setMaterialColorWriteEnabled("m_pz_mayuRdamA", false);
            m.setMaterialColorWriteEnabled("m_pz_mayuRdamB", false);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
        });
        // The Great Deku Tree
        else if (name === 'De1') fetchArchive(`De.arc`).then((rarc) => buildModel(rarc, `bdl/de.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Prince Komali (Small Childe)
        else if (name === 'Co1') fetchArchive(`Co.arc`).then((rarc) => buildModel(rarc, `bdlm/co.bdl`).bindANK1(parseBCK(rarc, `bcks/co_wait00.bck`)));
        // Adult Komali
        else if (name === 'Ac1') fetchArchive(`Ac.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ac.bdl`);
            const armL = buildChildModel(rarc, `bdl/acarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/acarm_wait01.bck`));
            const armR = buildChildModel(rarc, `bdl/acarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/acarm_wait01.bck`));
            m.bindANK1(parseBCK(rarc, `bcks/ac_wait01.bck`));
        });
        // Rito Chieftan
        else if (name === 'Zk1') fetchArchive(`Zk.arc`).then((rarc) => buildModel(rarc, `bdlm/zk.bdl`).bindANK1(parseBCK(rarc, `bcks/zk_wait01.bck`)));
        // Rose
        else if (name === 'Ob1') fetchArchive(`Ob.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/ob.bdl`);
            buildChildModel(rarc, `bdlm/oba_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
        });
        // Mesa
        else if (name === 'Ym1') fetchArchive(`Ym.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ym.bdl`);
            buildChildModel(rarc, `bdlm/ymhead01.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
        });
        // Abe
        else if (name === 'Ym2') fetchArchive(`Ym.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdlm/ym.bdl`, `bmt/ym2.bmt`);
            buildChildModel(rarc, `bdlm/ymhead02.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
        });
        // Sturgeon
        else if (name === 'Aj1') fetchArchive(`Aj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/aj.bdl`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
        });
        // Quill
        else if (name === 'Bm1') fetchArchive(`Bm.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bm.bdl`);
            const head = buildChildModel(rarc, `bdlm/bmhead01.bdl`);
            head.setParentJoint(m, `head`);
            head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
            const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
        });
        // (Unnamed Rito)
        else if (name === 'Bm2') fetchArchive(`Bm.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bm.bdl`);
            const head = buildChildModel(rarc, `bdlm/bmhead02.bdl`);
            head.setParentJoint(m, `head`);
            head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
            const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
        });
        // (Unnamed Rito)
        else if (name === 'Bm3') fetchArchive(`Bm.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bm.bdl`);
            const head = buildChildModel(rarc, `bdlm/bmhead03.bdl`);
            head.setParentJoint(m, `head`);
            head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
            const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
        });
        // (Unnamed Rito)
        else if (name === 'Bm4') fetchArchive(`Bm.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bm.bdl`);
            const head = buildChildModel(rarc, `bdlm/bmhead04.bdl`);
            head.setParentJoint(m, `head`);
            head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
            const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
        });
        // (Unnamed Rito)
        else if (name === 'Bm5') fetchArchive(`Bm.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bm.bdl`);
            const head = buildChildModel(rarc, `bdlm/bmhead05.bdl`);
            head.setParentJoint(m, `head`);
            head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
            const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
            m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
        });
        // Baito (Sorting Game)
        else if (name === 'Btsw2') fetchArchive(`Btsw.arc`).then((rarc) => buildModel(rarc, `bdlm/bn.bdl`).bindANK1(parseBCK(rarc, `bcks/bn_wait01.bck`)));
        // Koboli (Sorting Game)
        else if (name === 'Bmsw') fetchArchive(`Bmsw.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bm.bdl`);
            buildChildModel(rarc, `bdlm/bmhead11.bdl`).setParentJoint(m, `head`);
            const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
            const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
            m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`))
        });
        // Obli
        else if (name === 'Bmcon1') fetchArchive(`Bmcon1.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/bm.bdl`);
            buildChildModel(rarc, `bdlm/bmhead08.bdl`).setParentJoint(m, `head`);
            const armL = buildChildModel(rarc, `bdl/bmarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
            const armR = buildChildModel(rarc, `bdl/bmarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
            m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
        });
        // Obli
        else if (name === 'Bmcon2') fetchArchive(`Bmcon1.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/bm.bdl`);
            buildChildModel(rarc, `bdlm/bmhead10.bdl`).setParentJoint(m, `head`);
            const armL = buildChildModel(rarc, `bdl/bmarm.bdl`);
            armL.setParentJoint(m, `armL`);
            armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
            const armR = buildChildModel(rarc, `bdl/bmarm.bdl`);
            armR.setParentJoint(m, `armR`);
            armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
            m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
        });
        // Zill
        else if (name === 'Ko1') fetchArchive(`Ko.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ko.bdl`);
            buildChildModel(rarc, `bdlm/kohead01.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ko_wait01.bck`));
        });
        // Joel
        else if (name === 'Ko2') fetchArchive(`Ko.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdlm/ko.bdl`, `bmt/ko02.bmt`);
            buildChildModel(rarc, `bdlm/kohead02.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ko_wait01.bck`));
        });
        // Sue-Belle
        else if (name === 'Yw1') fetchArchive(`Yw.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/yw.bdl`);
            buildChildModel(rarc, `bdlm/ywhead01.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
        });
        // Tetra
        else if (name === 'Zl1') fetchArchive(`Zl.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/zl.bdl`);
            m.setMaterialColorWriteEnabled("eyeLdamA", false);
            m.setMaterialColorWriteEnabled("eyeLdamB", false);
            m.setMaterialColorWriteEnabled("mayuLdamA", false);
            m.setMaterialColorWriteEnabled("mayuLdamB", false);
            m.setMaterialColorWriteEnabled("eyeRdamA", false);
            m.setMaterialColorWriteEnabled("eyeRdamB", false);
            m.setMaterialColorWriteEnabled("mayuRdamA", false);
            m.setMaterialColorWriteEnabled("mayuRdamB", false);
            m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
        });
        // Gonzo
        else if (name === 'P1a') fetchArchive(`P1.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/p1.bdl`);
            buildChildModel(rarc, `bdlm/p1a_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
        });
        // Senza
        else if (name === 'P1b') fetchArchive(`P1.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/p1.bdl`, `bmt/p1b_body.bmt`);
            buildChildModel(rarc, `bdlm/p1b_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
        });
        // Nudge
        else if (name === 'P1c') fetchArchive(`P1.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/p1.bdl`, `bmt/p1c_body.bmt`);
            buildChildModel(rarc, `bdlm/p1c_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
        });
        // Zuko
        else if (name === 'P2a') fetchArchive(`P2.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/p2.bdl`);
            buildChildModel(rarc, `bdlm/p2head01.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
        });
        // Niko
        else if (name === 'P2b') fetchArchive(`P2.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/p2.bdl`, `bmt/p2b.bmt`);
            buildChildModel(rarc, `bdlm/p2head02.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
        });
        // Mako
        else if (name === 'P2c') fetchArchive(`P2.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/p2.bdl`, `bmt/p2c.bmt`);
            buildChildModel(rarc, `bdlm/p2head03.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
        });
        // Old Man Ho-Ho
        else if (name === 'Ah') fetchArchive(`Ah.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ah.bdl`);
            m.bindANK1(parseBCK(rarc, `bcks/ah_wait01.bck`));
        });
        // Helmarock King
        else if (name === 'Dk') fetchArchive(`Dk.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/dk.bdl`);
            m.bindANK1(parseBCK(rarc, `bcks/fly1.bck`));
        });
        // Zunari
        else if (name === 'Rsh1') fetchArchive(`Rsh.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/rs.bdl`);
            m.bindANK1(parseBCK(rarc, `bck/rs_wait01.bck`));
        });
        // ???
        else if (name === 'Sa1') fetchArchive(`Sa.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/sa.bdl`);
            buildChildModel(rarc, `bdlm/sa01_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
        });
        // Gummy
        else if (name === 'Sa2') fetchArchive(`Sa.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa02.bmt`);
            buildChildModel(rarc, `bdlm/sa02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
        });
        // Kane
        else if (name === 'Sa3') fetchArchive(`Sa.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa03.bmt`);
            buildChildModel(rarc, `bdlm/sa03_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
        });
        // Candy
        else if (name === 'Sa4') fetchArchive(`Sa.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa04.bmt`);
            buildChildModel(rarc, `bdlm/sa04_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
        });
        // Dampa
        else if (name === 'Sa5') fetchArchive(`Sa.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa05.bmt`);
            buildChildModel(rarc, `bdlm/sa05_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
        });
        // Potova
        else if (name === 'Ug1') fetchArchive(`Ug.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/ug.bdl`);
            buildChildModel(rarc, `bdlm/ug01_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ug_wait01.bck`));
        });
        // Joanna
        else if (name === 'Ug2') fetchArchive(`Ug.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/ug.bdl`, `bmt/ug02.bmt`);
            buildChildModel(rarc, `bdlm/ug02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ug_wait01.bck`));
        });
        // Jin
        else if (name === 'UkB') fetchArchive(`Uk.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/uk.bdl`);
            buildChildModel(rarc, `bdl/ukhead_b.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
        });
        // Jan
        else if (name === 'UkC') fetchArchive(`Uk.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdlm/uk.bdl`, `bmt/uk_c.bmt`);
            buildChildModel(rarc, `bdlm/ukhead_c.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
        });
        // Jun-Roberto
        else if (name === 'UkD') fetchArchive(`Uk.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdlm/uk.bdl`, `bmt/uk_d.bmt`);
            buildChildModel(rarc, `bdl/ukhead_d.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
        });
        // Gilligan
        else if (name === 'Uw1') fetchArchive(`Uw.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/uw.bdl`);
            buildChildModel(rarc, `bdlm/uw01_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uw_wait01.bck`));
        });
        // Linda
        else if (name === 'Uw2') fetchArchive(`Uw.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/uw.bdl`, `bmt/uw02.bmt`);
            buildChildModel(rarc, `bdlm/uw02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uw_wait01.bck`));
        });
        // Kreeb
        else if (name === 'Um1') fetchArchive(`Um.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/um.bdl`);
            buildChildModel(rarc, `bdlm/um01_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
        });
        // Anton
        else if (name === 'Um2') fetchArchive(`Um.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/um.bdl`, `bmt/um02.bmt`);
            buildChildModel(rarc, `bdlm/um02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
        });
        // Kamo
        else if (name === 'Um3') fetchArchive(`Um.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/um.bdl`, `bmt/um03.bmt`);
            buildChildModel(rarc, `bdlm/um03_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
        });
        // Sam
        else if (name === 'Uo1') fetchArchive(`Uo.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/uo.bdl`);
            buildChildModel(rarc, `bdlm/uo01_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
        });
        // Gossack
        else if (name === 'Uo2') fetchArchive(`Uo.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/uo.bdl`, `bmt/uo02.bmt`);
            buildChildModel(rarc, `bdlm/uo02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
        });
        // Garrickson
        else if (name === 'Uo3') fetchArchive(`Uo.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/uo.bdl`, `bmt/uo03.bmt`);
            buildChildModel(rarc, `bdlm/uo03_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
        });
        // Vera
        else if (name === 'Ub1') fetchArchive(`Ub.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/ub.bdl`);
            buildChildModel(rarc, `bdlm/ub01_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
        });
        // Pompie
        else if (name === 'Ub2') fetchArchive(`Ub.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub02.bmt`);
            buildChildModel(rarc, `bdlm/ub02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
        });
        // Missy
        else if (name === 'Ub3') fetchArchive(`Ub.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub03.bmt`);
            buildChildModel(rarc, `bdlm/ub03_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
        });
        // Mineco
        else if (name === 'Ub4') fetchArchive(`Ub.arc`).then((rarc) => {
            const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub04.bmt`);
            buildChildModel(rarc, `bdlm/ub04_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
        });
        // Bomb-Master Cannon (1)
        else if (name === 'Bms1') fetchArchive(`Bms.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/by1.bdl`);
            buildChildModel(rarc, `bdlm/by_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/by1_wait01.bck`));
        });
        // Bomb-Master Cannon (1)
        else if (name === 'Bms2') fetchArchive(`Bms.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/by2.bdl`);
            buildChildModel(rarc, `bdlm/by_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/by2_wait00.bck`));
        });
        // Mrs. Marie
        else if (name === 'Ho') fetchArchive(`Ho.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ho.bdl`);
            buildChildModel(rarc, `bdl/ho_pend.bdl`).setParentJoint(m, `backbone`);
            m.bindANK1(parseBCK(rarc, `bcks/ho_wait01.bck`));
        });
        // Tott
        else if (name === 'Tt') fetchArchive(`Tt.arc`).then((rarc) => buildModel(rarc, `bdlm/tt.bdl`).bindANK1(parseBCK(rarc, `bck/wait01.bck`)));
        // Maggie's Father (Rich)
        else if (name === 'Gp1') fetchArchive(`Gp.arc`).then((rarc) => buildModel(rarc, `bdlm/gp.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Maggie's Father (Poor)
        else if (name === 'Pf1') fetchArchive(`Pf.arc`).then((rarc) => buildModel(rarc, `bdlm/pf.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Maggie (Rich)
        else if (name === 'Kp1') fetchArchive(`Kp.arc`).then((rarc) => buildModel(rarc, `bdlm/kp.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Mila (Poor)
        else if (name === 'Kk1') fetchArchive(`Kk.arc`).then((rarc) => buildModel(rarc, `bdlm/kk.bdl`).bindANK1(parseBCK(rarc, `bcks/kk_wait01.bck`)));
        // Mila's Father (Rich)
        else if (name === 'Kf1') fetchArchive(`Kf.arc`).then((rarc) => buildModel(rarc, `bdlm/kf.bdl`).bindANK1(parseBCK(rarc, `bcks/kf_wait01.bck`)));
        // Mila's Father (Poor)
        else if (name === 'Gk1') fetchArchive(`Gk.arc`).then((rarc) => buildModel(rarc, `bdlm/gk.bdl`).bindANK1(parseBCK(rarc, `bcks/gk_wait01.bck`)));
        // Ivan
        else if (name === 'Mk') fetchArchive(`Mk.arc`).then((rarc) => buildModel(rarc, `bdlm/mk.bdl`).bindANK1(parseBCK(rarc, `bcks/mk_wait.bck`)));
        // Lorenzo
        else if (name === 'Po') fetchArchive(`Po.arc`).then((rarc) => buildModel(rarc, `bdlm/po.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Doc Bandam
        else if (name === 'Ds1') fetchArchive(`Ds.arc`).then((rarc) => buildModel(rarc, `bdlm/ck.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Jabun
        else if (name === 'Jb1') fetchArchive(`Jb.arc`).then((rarc) => buildModel(rarc, `bdlm/jb.bdl`).bindANK1(parseBCK(rarc, `bcks/jb_wait01.bck`)));
        // Zephos
        else if (name === 'Hr') fetchArchive(`Hr.arc`).then((rarc) => buildModel(rarc, `bdlm/hr.bdl`).bindANK1(parseBCK(rarc, `bcks/r_wait01.bck`)));
        // Cyclos (same as Zephos)
        else if (name === 'Hr2') fetchArchive(`Hr.arc`).then((rarc) => buildModel(rarc, `bdlm/hr.bdl`).bindANK1(parseBCK(rarc, `bcks/r_wait01.bck`)));
        // Valoo
        else if (name === 'dragon') fetchArchive(`Dr.arc`).then((rarc) => buildModel(rarc, `bmd/dr1.bmd`).bindANK1(parseBCK(rarc, `bck/dr_wait1.bck`)));
        // Olivio (Korok)
        else if (name === 'Bj1') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj1_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // Aldo (Korok)
        else if (name === 'Bj2') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj2_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // Oakin (Korok)
        else if (name === 'Bj3') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj3_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // Drona (Korok)
        else if (name === 'Bj4') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj4_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // Irch (Korok)
        else if (name === 'Bj5') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj5_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // Rown (Korok)
        else if (name === 'Bj6') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj6_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // Hollo (Korok)
        else if (name === 'Bj7') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj7_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // Elma (Korok)
        else if (name === 'Bj8') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj8_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // Linder (Korok)
        else if (name === 'Bj9') fetchArchive(`Bj.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bj.bdl`);
            buildChildModel(rarc, `bdl/bj9_face.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
        });
        // Manny
        else if (name === 'Mn') fetchArchive(`Mn.arc`).then((rarc) => buildModel(rarc, `bdlm/mn.bdl`).bindANK1(parseBCK(rarc, `bcks/mn_wait01.bck`)));
        // Carlov
        else if (name === 'Mt') fetchArchive(`Niten.arc`).then((rarc) => buildModel(rarc, `bdlm/mt.bdl`).bindANK1(parseBCK(rarc, `bcks/mt_wait01.bck`)));
        // Great Fairy
        else if (name === 'BigElf') fetchArchive(`bigelf.arc`).then((rarc) => buildModel(rarc, `bdlm/dy.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Fairy
        else if (name === 'Sfairy') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/fa.bdl`).bindANK1(parseBCK(rarc, `bck/fa.bck`)));
        // Goron Merchants
        else if (name === 'RotenA') fetchArchive(`Ro.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ro.bdl`);
            buildChildModel(rarc, `bdl/ro_hat.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
        });
        else if (name === 'RotenB') fetchArchive(`Ro.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ro.bdl`);
            buildChildModel(rarc, `bdl/ro_hat2.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
        });
        else if (name === 'RotenC') fetchArchive(`Ro.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/ro.bdl`);
            buildChildModel(rarc, `bdl/ro_hat3.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
        });
        // Small decoration (Always)
        else if (name === 'kotubo') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/obm_kotubo1.bdl`));
        else if (name === 'ootubo1') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/obm_ootubo1.bdl`));
        else if (name === 'koisi1') fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdl/obm_ootubo1.bdl`));
        // Bigger trees
        else if (name === 'lwood') fetchArchive(`Lwood.arc`).then((rarc) => {
            const b = buildModel(rarc, `bdl/alwd.bdl`);
            b.lightTevColorType = LightTevColorType.BG0;
        });
        else if (name === 'Oyashi') fetchArchive(`Oyashi.arc`).then((rarc) => buildModel(rarc, `bdl/oyashi.bdl`));
        else if (name === 'Vyasi') fetchArchive(`Vyasi.arc`).then((rarc) => buildModel(rarc, `bdl/vyasi.bdl`));
        // Barrels
        else if (name === 'Ktaru') fetchArchive(`Ktaru_01.arc`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
        else if (name === 'Ktarux') fetchArchive(`Ktaru_01.arc`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
        else if (name === 'Ktaruo') fetchArchive(`Ktaru_01.arc`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
        // Wooden Crates
        else if (name === 'Kkiba') fetchArchive(`Kkiba_00.arc`).then((rarc) => buildModel(rarc, `bdl/kkiba_00.bdl`));
        else if (name === 'KkibaB') fetchArchive(`Kkiba_00.arc`).then((rarc) => buildModel(rarc, `bdl/kkiba_00.bdl`));
        // Breakable shelves
        else if (name === 'Otana') fetchArchive(`Otana.arc`).then((rarc) => buildModel(rarc, `bdl/otana.bdl`));
        // Fancy pots
        else if (name === 'Ptubo') fetchArchive(`Ptubo.arc`).then((rarc) => buildModel(rarc, `bdl/ptubo.bdl`));
        else if (name === 'Kmtub') fetchArchive(`Kmtub_00.arc`).then((rarc) => buildModel(rarc, `bdl/kmtub_00.bdl`));
        // Skull
        else if (name === 'Odokuro') fetchArchive(`Odokuro.arc`).then((rarc) => buildModel(rarc, `bdl/odokuro.bdl`));
        // Mailbox
        else if (name === 'Tpost') fetchArchive(`Toripost.arc`).then((rarc) => buildModel(rarc, `bdl/vpost.bdl`).bindANK1(parseBCK(rarc, `bcks/post_wait.bck`)));
        // Sign
        else if (name === 'Kanban') fetchArchive(`Kanban.arc`).then((rarc) => {
            const b = buildModel(rarc, `bdl/kanban.bdl`);
            b.lightTevColorType = LightTevColorType.BG0;
        });
        // Doors: TODO(jstpierre)
        else if (name === 'KNOB00') return;
        // Forsaken Fortress door
        else if (name === 'SMBdor') fetchArchive(`Mbdoor.arc`).then((rarc) => {
            // Frame
            const fu = buildModel(rarc, `bdl/s_mbdfu.bdl`);
            fu.lightTevColorType = LightTevColorType.BG0;
            // Left door
            const l = buildModel(rarc, `bdl/s_mbd_l.bdl`);
            l.lightTevColorType = LightTevColorType.BG0;
            // Right door
            const r = buildModel(rarc, `bdl/s_mbd_r.bdl`);
            r.lightTevColorType = LightTevColorType.BG0;
            // Barricade. Not set to the correct default unlocked position.
            const to = buildModel(rarc, `bdl/s_mbdto.bdl`);
            to.lightTevColorType = LightTevColorType.BG0;
        });
        // Forsaken Fortress water gate
        else if (name === 'MjDoor') fetchArchive(`S_MSPDo.arc`).then((rarc) => buildModel(rarc, `bdl/s_mspdo.bdl`));
        // Holes you can fall into
        else if (name === 'Pitfall') fetchArchive(`Aana.arc`).then((rarc) => buildModel(rarc, `bdl/aana.bdl`));
        // Warp Pot
        else if (name === 'Warpt' || name === 'Warpnt' || name === 'Warpts1' || name === 'Warpts2' || name === 'Warpts3') fetchArchive(`ltubw.arc`).then((rarc) => buildModel(rarc, `bdl/itubw.bdl`));
        else if (name === 'Warpgm') fetchArchive(`Gmjwp.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/gmjwp00.bdl`);
            m.bindANK1(parseBCK(rarc, `bck/gmjwp01.bck`));
            m.bindTTK1(parseBTK(rarc, `btk/gmjwp00.btk`));
            m.bindTRK1(parseBRK(rarc, `brk/gmjwp01.brk`));
        });
        // Hookshot Target (wtf Nintendo)
        else if (name === 'Hfuck1') fetchArchive(`Hfuck1.arc`).then((rarc) => buildModel(rarc, `bdl/hfuck1.bdl`));
        // Ladders
        else if (name === 'Mhsg4h') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg4h.bdl`));
        else if (name === 'Mhsg9') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg9.bdl`));
        else if (name === 'Mhsg15') fetchArchive(`Mhsg.arc`).then((rarc) => buildModel(rarc, `bdl/mhsg15.bdl`));
        // Bombable rock
        else if (name === 'Ebrock') fetchArchive(`Ebrock.arc`).then((rarc) => buildModel(rarc, `bdl/ebrock.bdl`));
        else if (name === 'Ebrock2') fetchArchive(`Ebrock.arc`).then((rarc) => buildModel(rarc, `bdl/ebrock2.bdl`));
        else if (name === 'Eskban') fetchArchive(`Eskban.arc`).then((rarc) => buildModel(rarc, `bdl/eskban.bdl`));
        else if (name === 'Esekh') fetchArchive(`Esekh.arc`).then((rarc) => buildModel(rarc, `bdl/esekh.bdl`));
        else if (name === 'Esekh2') fetchArchive(`Esekh.arc`).then((rarc) => buildModel(rarc, `bdl/esekh2.bdl`));
        else if (name === 'Ebomzo') fetchArchive(`Ebomzo.arc`).then((rarc) => buildModel(rarc, `bdl/ebomzo.bdl`));
        // Stone head rock
        else if (name === 'Ekao') fetchArchive(`Ekao.arc`).then((rarc) => buildModel(rarc, `bdl/ekao.bdl`));
        // Whirlpool
        else if (name === 'Auzu') fetchArchive(`Auzu.arc`).then((rarc) => buildModel(rarc, `bdlm/auzu.bdl`).bindTTK1(parseBTK(rarc, `btk/auzu.btk`)));
        // Floor Switch
        else if (name === 'Kbota_A' || name === 'Kbota_B' || name === 'KbotaC') fetchArchive(`Kbota_00.arc`).then((rarc) => buildModel(rarc, `bdl/kbota_00.bdl`));
        // Iron Boots Switch
        else if (name === 'Hhbot1' || name === 'Hhbot1N') fetchArchive(`Hhbot.arc`).then((rarc) => {
            buildModel(rarc, `bdl/hhbot1.bdl`);
            buildModel(rarc, `bdl/hhbot2.bdl`);
        });
        // Grapple Point
        else if (name === 'Kui') fetchArchive(`Kui.arc`).then((rarc) => buildModel(rarc, `bdl/obi_ropetag.bdl`));
        // Korok Tree
        else if (name === 'FTree') fetchArchive(`Vmr.arc`).then((rarc) => buildModel(rarc, `bdlm/vmrty.bdl`).bindANK1(parseBCK(rarc, `bck/vmrty.bck`)));
        // Animals
        else if (name === 'DmKmm') fetchArchive(`Demo_Kmm.arc`).then((rarc) => buildModel(rarc, `bmd/ka.bmd`).bindANK1(parseBCK(rarc, `bcks/ka_wait1.bck`)));
        else if (name === 'Kamome') fetchArchive(`Kamome.arc`).then((rarc) => buildModel(rarc, `bdl/ka.bdl`).bindANK1(parseBCK(rarc, `bck/ka_wait2.bck`)));
        else if (name === 'kani') fetchArchive(`Kn.arc`).then((rarc) => buildModel(rarc, `bdl/kn.bdl`));
        else if (name === 'Pig') fetchArchive(`Kb.arc`).then((rarc) => buildModel(rarc, `bdlm/pg.bdl`));
        else if (name === 'kani') fetchArchive(`Kn.arc`).then((rarc) => buildModel(rarc, `bdl/kn.bdl`).bindANK1(parseBCK(rarc, `bck/wait01.bck`)));
        else if (name === 'NpcSo') fetchArchive(`So.arc`).then((rarc) => buildModel(rarc, `bdlm/so.bdl`).bindANK1(parseBCK(rarc, `bcks/so_wait01.bck`)));
        // Enemies
        else if (name === 'Fganon') fetchArchive(`Fganon.arc`).then((rarc) => buildModel(rarc, `bdlm/bpg.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
        else if (name === 'keeth') fetchArchive(`Ki.arc`).then((rarc) => buildModel(rarc, `bdlm/ki.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
        else if (name === 'Fkeeth') fetchArchive(`Ki.arc`).then((rarc) => buildModel(rarc, `bdlm/fk.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
        else if (name === 'Puti') fetchArchive(`Pt.arc`).then((rarc) => buildModel(rarc, `bdlm/pt.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
        else if (name === 'Rdead1') fetchArchive(`Rd.arc`).then((rarc) => buildModel(rarc, `bdlm/rd.bdl`).bindANK1(parseBCK(rarc, `bcks/walk.bck`)));
        else if (name === 'Rdead2') fetchArchive(`Rd.arc`).then((rarc) => buildModel(rarc, `bdlm/rd.bdl`).bindANK1(parseBCK(rarc, `bcks/walk.bck`)));
        else if (name === 'wiz_r') fetchArchive(`Wz.arc`).then((rarc) => buildModel(rarc, `bdlm/wz.bdl`).bindANK1(parseBCK(rarc, `bck/s_demo_wait1.bck`)));
        else if (name === 'gmos') fetchArchive(`Gm.arc`).then((rarc) => buildModel(rarc, `bdlm/gm.bdl`).bindANK1(parseBCK(rarc, `bck/fly.bck`)));
        else if (name === 'mo2') fetchArchive(`Mo2.arc`).then((rarc) => buildModel(rarc, `bdlm/mo.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
        else if (name === 'Bb') fetchArchive(`Bb.arc`).then((rarc) => buildModel(rarc, `bdlm/bb.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
        else if (name === 'Bk') fetchArchive(`Bk.arc`).then((rarc) => buildModel(rarc, `bdlm/bk.bdl`).bindANK1(parseBCK(rarc, `bck/bk_wait.bck`)));
        else if (name === 'Oq') fetchArchive(`Oq.arc`).then((rarc) => buildModel(rarc, `bmdm/oq.bmd`).bindANK1(parseBCK(rarc, `bck/nom_wait.bck`)));
        else if (name === 'Oqw') fetchArchive(`Oq.arc`).then((rarc) => buildModel(rarc, `bmdm/red_oq.bmd`).bindANK1(parseBCK(rarc, `bck/umi_new_wait.bck`)));
        else if (name === 'Daiocta') fetchArchive(`Daiocta.arc`).then((rarc) => buildModel(rarc, `bdlm/do_main1.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
        else if (name === 'Fmastr1') fetchArchive(`fm.arc`).then((rarc) => buildModel(rarc, `bdl/fm.bdl`).bindANK1(parseBCK(rarc, `bcks/wait.bck`)));
        else if (name === 'Fmastr2') fetchArchive(`fm.arc`).then((rarc) => buildModel(rarc, `bdl/fm.bdl`).bindANK1(parseBCK(rarc, `bcks/wait.bck`)));
        else if (name === 'magtail') fetchArchive(`Mt.arc`).then((rarc) => buildModel(rarc, `bdlm/mg_head.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
        else if (name === 'bable') fetchArchive(`Bl.arc`).then((rarc) => buildModel(rarc, `bdlm/bl.bdl`));
        else if (name === 'nezumi') fetchArchive(`Nz.arc`).then((rarc) => buildModel(rarc, `bdlm/nz.bdl`));
        else if (name === 'moZOU') fetchArchive(`Mozo.arc`).then((rarc) => buildModel(rarc, `bdlm/moz.bdl`));
        else if (name === 'MtoriSU') fetchArchive(`MtoriSU.arc`).then((rarc) => buildModel(rarc, `bdl/mtorisu.bdl`));
        else if (name === 'Tn') fetchArchive(`Tn.arc`).then((rarc) => buildModel(rarc, `bmdm/tn_main.bmd`).bindANK1(parseBCK(rarc, `bck/await1.bck`)));
        else if (name === 'Stal') fetchArchive(`St.arc`).then((rarc) => buildModel(rarc, `bdlm/headb.bdl`));
        else if (name === 'p_hat') fetchArchive(`Ph.arc`).then((rarc) => {
            buildModel(rarc, `bdlm/phb.bdl`).bindANK1(parseBCK(rarc, 'bck/bfly.bck'));
            buildModel(rarc, `bdlm/php.bdl`).bindANK1(parseBCK(rarc, 'bck/pfly.bck'));
        });
        else if (name === 'bbaba') fetchArchive(`Bo.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/bo_sita1.bdl`);
            // TODO(jstpierre): animation?
        });
        else if (name === 'c_green' || name === 'c_red' || name === 'c_blue') fetchArchive(`Cc.arc`).then((rarc) => {
            // TODO(jstpierre): Colors?
            const cc = buildModel(rarc, `bmdm/cc.bmd`);
            cc.bindANK1(parseBCK(rarc, `bck/tachi_walk.bck`));
        });
        // Beedle's Shop Ship (in Tip Top Shape)
        else if (name === 'ikada_h') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vtsp.bdl`));
        // Helmeted Beedle's Shop Ship
        else if (name === 'ikada_u') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vtsp2.bdl`));
        // The Great Sea
        else if (name === 'Svsp') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vsvsp.bdl`));
        else if (name === 'Vtil1') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil1.bdl`));
        else if (name === 'Vtil2') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil2.bdl`));
        else if (name === 'Vtil3') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil3.bdl`));
        else if (name === 'Vtil4') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil4.bdl`));
        else if (name === 'Vtil5') fetchArchive(`Vtil.arc`).then((rarc) => buildModel(rarc, `bdl/vtil5.bdl`));
        else if (name === 'Ekskz') fetchArchive(`Ekskz.arc`).then((rarc) => {
            buildModel(rarc, `bdl/ekskz.bdl`);
            const yocwd00 = buildModel(rarc, `bdlm/yocwd00.bdl`);
            yocwd00.bindANK1(parseBCK(rarc, `bck/yocwd00.bck`));
            yocwd00.bindTRK1(parseBRK(rarc, `brk/yocwd00.brk`));
            yocwd00.bindTTK1(parseBTK(rarc, `btk/yocwd00.btk`));
        });
        else if (name === 'Ocanon') fetchArchive(`WallBom.arc`).then((rarc) => buildModel(rarc, `bdl/wallbom.bdl`));
        else if (name === 'Canon') fetchArchive(`Bomber.arc`).then((rarc) => buildModel(rarc, `bdl/vcank.bdl`));
        else if (name === 'Aygr') fetchArchive(`Aygr.arc`).then((rarc) => {
            buildModel(rarc, `bdl/aygr.bdl`);
            buildModel(rarc, `bdl/aygrh.bdl`);
        });
        else if (name === 'Ayush') fetchArchive(`Ayush.arc`).then((rarc) => buildModel(rarc, `bdlm/ayush.bdl`).bindTTK1(parseBTK(rarc, `btk/ayush.btk`)));
        else if (name === 'Ikada') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vikae.bdl`));
        else if (name === 'ikadaS') fetchArchive(`IkadaH.arc`).then((rarc) => buildModel(rarc, `bdl/vikah.bdl`));
        else if (name === 'Oship') fetchArchive(`Oship.arc`).then((rarc) => buildModel(rarc, `bdl/vbtsp.bdl`));
        else if (name === 'GiceL') fetchArchive(`GiceL.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdli/gicel00.bdl`);
            m.bindTTK1(parseBTK(rarc, `btk/gicel00_01.btk`));
            m.bindTRK1(parseBRK(rarc, `brk/gicel00.brk`));
        });
        else if (name === 'Qdghd') fetchArchive(`Qdghd.arc`).then((rarc) => buildModel(rarc, `bdl/qdghd.bdl`));
        else if (name === 'Qtkhd') fetchArchive(`Qtkhd.arc`).then((rarc) => buildModel(rarc, `bdl/qtkhd.bdl`));
        else if (name === 'Ylsic') fetchArchive(`Ylsic.arc`).then((rarc) => buildModel(rarc, `bdl/ylsic.bdl`));
        else if (name === 'Yllic') fetchArchive(`Yllic.arc`).then((rarc) => buildModel(rarc, `bdl/yllic.bdl`));
        else if (name === 'Ykzyg') fetchArchive(`Ykzyg.arc`).then((rarc) => {
            buildModel(rarc, `bdlm/qkzyg.bdl`).bindTTK1(parseBTK(rarc, `btk/qkzyg.btk`));
            // TODO(jstpierre): ymnkz00
        });
        else if (name === 'Ygush00' || name === 'Ygush01' || name === 'Ygush02') fetchArchive(`Ygush00.arc`).then((rarc) => buildModel(rarc, `bdlm/ygush00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygush00.btk`)));
        else if (name === 'Yboil00') fetchArchive(`Yboil.arc`).then((rarc) => buildModel(rarc, `bdlm/yboil00.bdl`).bindTTK1(parseBTK(rarc, `btk/yboil00.btk`)));
        else if (name === 'Ygstp00') fetchArchive(`Ygush00.arc`).then((rarc) => buildModel(rarc, `bdlm/ygstp00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygstp00.btk`)));
        else if (name === 'Ytrnd00') fetchArchive(`Trnd.arc`).then((rarc) => {
            buildModel(rarc, `bdlm/ytrnd00.bdl`).bindTTK1(parseBTK(rarc, `btk/ytrnd00.btk`));
            buildModel(rarc, `bdlm/ywuwt00.bdl`).bindTTK1(parseBTK(rarc, `btk/ywuwt00.btk`));
        });
        else if (name === 'Sarace') fetchArchive(`Sarace.arc`).then((rarc) => buildModel(rarc, `bdl/sa.bdl`));
        else if (name === 'Ocloud') fetchArchive(`BVkumo.arc`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)));
        // Triangle Island Statue: TODO(jstpierre): finish the submodels
        else if (name === 'Doguu') fetchArchive(`Doguu.arc`).then((rarc) => {
            const which = parameters & 0xFF;
            const bmtPaths = ['bmt/vgsmd.bmt', 'bmt/vgsmf.bmt', 'bmt/vgsmn.bmt'];
            const brkPaths = ['brk/vgsmd.brk', 'brk/vgsmf.brk', 'brk/vgsmn.brk'];
            const m = buildModelBMT(rarc, `bdlm/vgsma.bdl`, bmtPaths[which]);
            m.bindTRK1(parseBRK(rarc, brkPaths[which]));
        });
        // Outset Island
        else if (name === 'Lamp') fetchArchive(`Lamp.arc`).then((rarc) => {
            const m = buildModel(rarc, `bmd/lamp_00.bmd`);
            const scale = 0.5;
            mat4.scale(m.modelMatrix, m.modelMatrix, [scale, scale, scale]);
        });
        else if (name === 'MKoppu') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/koppu.bdl`));
        else if (name === 'MOsara') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/osara.bdl`));
        else if (name === 'MPot') fetchArchive(`Mshokki.arc`).then((rarc) => buildModel(rarc, `bdl/pot.bdl`));
        else if (name === 'Branch') fetchArchive(`Kwood_00.arc`).then((rarc) => buildModel(rarc, `bmdc/ws.bmd`));
        else if (name === 'Okioke') fetchArchive(`Okioke.arc`).then((rarc) => buildModel(rarc, `bdl/okioke.bdl`));
        else if (name === 'Ostool') fetchArchive(`Okmono.arc`).then((rarc) => buildModel(rarc, `bdl/ostool.bdl`));
        else if (name === 'Otble') fetchArchive(`Okmono.arc`).then((rarc) => buildModel(rarc, `bdl/otable.bdl`));
        else if (name === 'OtbleL') fetchArchive(`Okmono.arc`).then((rarc) => buildModel(rarc, `bdl/otablel.bdl`));
        else if (name === 'AjavW') {
            const rarc = await fetchArchive(`AjavW.arc`);
            const m = buildModel(rarc, `bdlm/ajavw.bdl`);
            m.lightTevColorType = LightTevColorType.BG1;
            m.bindTTK1(parseBTK(rarc, `btk/ajavw.btk`));
        } else if (name === 'Vdora') fetchArchive(`Vdora.arc`).then((rarc) => buildModel(rarc, `bdl/vdora.bdl`));
        // Windfall Island
        else if (name === 'Roten2') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten02.bdl`));
        else if (name === 'Roten3') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten03.bdl`));
        else if (name === 'Roten4') fetchArchive(`Roten.arc`).then((rarc) => buildModel(rarc, `bdl/roten04.bdl`));
        else if (name === 'Fdai') fetchArchive(`Fdai.arc`).then((rarc) => buildModel(rarc, `bdl/fdai.bdl`));
        else if (name === 'GBoard') fetchArchive(`Kaisen_e.arc`).then((rarc) => buildModel(rarc, `bdl/akbod.bdl`));
        else if (name === 'Nzfall') fetchArchive(`Pfall.arc`).then((rarc) => buildModel(rarc, `bdl/nz.bdl`).bindANK1(parseBCK(rarc, `bcks/nz_wait.bck`)));
        else if (name === 'Paper') fetchArchive(`Opaper.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/opaper.bdl`);
            mat4.rotateX(m.modelMatrix, m.modelMatrix, Math.PI / 2);
        });
        else if (name === 'Cafelmp') fetchArchive(`Cafelmp.arc`).then((rarc) => buildModel(rarc, `bdl/ylamp.bdl`));
        else if (name === 'Pbka') fetchArchive(`Pbka.arc`).then((rarc) => buildModel(rarc, `bdl/pbka.bdl`));
        else if (name === 'Plant') fetchArchive(`Plant.arc`).then((rarc) => buildModel(rarc, `bdl/yrmwd.bdl`));
        else if (name === 'Table') fetchArchive(`Table.arc`).then((rarc) => buildModel(rarc, `bdl/ytble.bdl`));
        else if (name === 'Ppos') fetchArchive(`Ppos.arc`).then((rarc) => buildModel(rarc, `bdl/ppos.bdl`));
        else if (name === 'Rflw') fetchArchive(`Rflw.arc`).then((rarc) => buildModel(rarc, `bdl/phana.bdl`));
        else if (name === 'Skanran') fetchArchive(`Skanran.arc`).then((rarc) => buildModel(rarc, `bdl/skanran.bdl`));
        else if (name === 'Stoudai') fetchArchive(`Skanran.arc`).then((rarc) => buildModel(rarc, `bdl/stoudai.bdl`));
        // Pirate stuff
        else if (name === 'Pirates') fetchArchive(`Kaizokusen.arc`).then((rarc) => buildModel(rarc, `bdl/oba_kaizoku_a.bdl`));
        else if (name === 'Ashut') fetchArchive(`Ashut.arc`).then((rarc) => buildModel(rarc, `bdl/ashut.bdl`));
        else if (name === 'Ospbox') fetchArchive(`Ospbox.arc`).then((rarc) => buildModel(rarc, `bdl/ospbox.bdl`));
        // The platforms in the pirate ship which go up and down.
        else if (name === 'Hlift') fetchArchive(`Hlift.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/hlift.bdl`);
            m.modelMatrix[13] += 350;
        });
        else if (name === 'Hliftb') fetchArchive(`Hlift.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/hliftb.bdl`);
            m.modelMatrix[13] += 300;
        });
        // Beedle's Ship
        else if (name === 'Ptco') fetchArchive(`Ptc.arc`).then((rarc) => buildModel(rarc, `bdl/ptco.bdl`));
        else if (name === 'Ptcu') fetchArchive(`Ptc.arc`).then((rarc) => buildModel(rarc, `bdl/ptcu.bdl`));
        // Forsaken Fortress
        else if (name === 'Gaship1') fetchArchive(`GaShip.arc`).then((rarc) => buildModel(rarc, `bdl/gaship.bdl`));
        else if (name === 'Gaship2') fetchArchive(`YakeRom.arc`).then((rarc) => buildModel(rarc, `bdl/yakerom.bdl`));
        else if (name === 'dmgroom') fetchArchive(`dmgroom.arc`).then((rarc) => buildModel(rarc, `bdlm/dmgroom.bdl`));
        else if (name === 'nezuana') fetchArchive(`Nzg.arc`).then((rarc) => buildModel(rarc, `bdl/kana_00.bdl`));
        else if (name === 'Shmrgrd') fetchArchive(`Shmrgrd.arc`).then((rarc) => buildModel(rarc, `bdl/shmrgrd.bdl`));
        else if (name === 'ATdoor') fetchArchive(`Atdoor.arc`).then((rarc) => buildModel(rarc, `bdl/sdoor01.bdl`));
        else if (name === 'Search') fetchArchive(`Search.arc`).then((rarc) => buildModel(rarc, `bdl/s_search.bdl`));
        else if (name === 'Ikari') fetchArchive(`Ikari.arc`).then((rarc) => buildModel(rarc, `bdl/s_ikari2.bdl`));
        else if (name === 'SMtoge') fetchArchive(`Mtoge.arc`).then((rarc) => buildModel(rarc, `bmd/s_mtoge.bmd`));
        // Dragon Roost Island
        else if (name === 'BFlower' || name === 'VbakH') fetchArchive(`VbakH.arc`).then((rarc) => {
            buildModel(rarc, `bdlm/vbakh.bdl`);
            buildModel(rarc, `bdlm/vbakm.bdl`);
        });
        else if (name === 'Rcloud') fetchArchive(`BVkumo.arc`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)))
        else if (name === 'TrFlag') fetchArchive(`Trflag.arc`).then((rarc) => buildModel(rarc, `bdl/ethata.bdl`));
        else if (name === 'Ecube') fetchArchive(`Ecube.arc`).then((rarc) => buildModel(rarc, `bdl/ecube.bdl`));
        else if (name === 'Piwa') fetchArchive(`Piwa.arc`).then((rarc) => buildModel(rarc, `bdl/piwa.bdl`));
        else if (name === 'osiBLK0') fetchArchive(`Osiblk.arc`).then((rarc) => buildModel(rarc, `bdl/obm_osihikiblk1.bdl`));
        else if (name === 'osiBLK1') fetchArchive(`Osiblk.arc`).then((rarc) => buildModel(rarc, `bdl/obm_osihikiblk2.bdl`));
        else if (name === 'Gryw00') fetchArchive(`Gryw00.arc`).then((rarc) => buildModel(rarc, `bdlm/gryw00.bdl`));
        else if (name === 'Eayogn') fetchArchive(`Eayogn.arc`).then((rarc) => buildModel(rarc, `bdl/eayogn.bdl`));
        else if (name === 'Mswing') fetchArchive(`Msw.arc`).then((rarc) => buildModel(rarc, `bdl/mswng.bdl`));
        else if (name === 'Dsaku') fetchArchive(`Knsak_00.arc`).then((rarc) => buildModel(rarc, `bdl/knsak_00.bdl`));
        else if (name === 'Ksaku') fetchArchive(`Ksaku_00.arc`).then((rarc) => buildModel(rarc, `bdl/ksaku_00.bdl`));
        else if (name === 'Mflft') fetchArchive(`Mflft.arc`).then((rarc) => buildModel(rarc, `bdl/mflft.bdl`));
        else if (name === 'Yfire00') fetchArchive(`Yfire_00.arc`).then((rarc) => {
            buildModel(rarc, `bmdm/yfire_00.bmd`);
            buildModel(rarc, `bmdm/yfirb_00.bmd`).bindTTK1(parseBTK(rarc, `btk/yfirb_00.btk`));
        });
        // Forest Haven
        else if (name === 'Ohatch') fetchArchive(`Ohatch.arc`).then((rarc) => buildModel(rarc, `bdl/ohatch.bdl`));
        else if (name === 'Ojtree') fetchArchive(`Ojtree.arc`).then((rarc) => buildModel(rarc, `bdl/ojtree.bdl`));
        else if (name === 'Olift') fetchArchive(`Olift.arc`).then((rarc) => buildModel(rarc, `bdl/olift.bdl`));
        else if (name === 'itemDek') fetchArchive(`Deku.arc`).then((rarc) => buildModel(rarc, `bdlm/vlfdm.bdl`));
        else if (name === 'ho') fetchArchive(`Himo3.arc`).then((rarc) => buildModel(rarc, `bmd/h3_ga.bmd`));
        else if (name === 'jbaba') fetchArchive(`Jbo.arc`).then((rarc) => buildModel(rarc, `bmdm/jh.bmd`));
        else if (name === 'VigaH') fetchArchive(`VigaH.arc`).then((rarc) => buildModel(rarc, `bdl/vigah.bdl`));
        else if (name === 'Ss') fetchArchive(`Ss.arc`).then((rarc) => buildModel(rarc, `bdl/sw.bdl`));
        else if (name === 'Sss') fetchArchive(`Sss.arc`).then((rarc) => buildModel(rarc, `bmd/sss_hand.bmd`));
        else if (name === 'Turu') fetchArchive(`Sk.arc`).then((rarc) => buildModel(rarc, `bdl/turu_00.bdl`));
        else if (name === 's_turu') fetchArchive(`Ssk.arc`).then((rarc) => buildModel(rarc, `bdl/turu_02.bdl`));
        else if (name === 'Turu2') fetchArchive(`Sk2.arc`).then((rarc) => buildModel(rarc, `bdlm/ksylf_00.bdl`));
        else if (name === 'Turu3') fetchArchive(`Sk2.arc`).then((rarc) => buildModel(rarc, `bdlm/ksylf_01.bdl`));
        else if (name === 'Kita') fetchArchive(`kita.arc`).then((rarc) => buildModel(rarc, `bdl/vhlif_00.bdl`));
        else if (name === 'Klft') fetchArchive(`Klft.arc`).then((rarc) => buildModel(rarc, `bdlm/lift_00.bdl`));
        else if (name === 'Kmi000x') fetchArchive(`Kmi00x.arc`).then((rarc) => buildModel(rarc, `bdlm/kmi_00x.bdl`));
        else if (name === 'Kmi02') fetchArchive(`Kmi00x.arc`).then((rarc) => buildModel(rarc, `bdlm/kmi_00x.bdl`));
        else if (name === 'Kokiie') fetchArchive(`Kokiie.arc`).then((rarc) => buildModel(rarc, `bdl/koki_00.bdl`));
        else if (name === 'Vpbot') fetchArchive(`Vpbot_00.arc`).then((rarc) => buildModel(rarc, `bdl/vpbot_00.bdl`));
        else if (name === 'Vochi') fetchArchive(`Vochi.arc`).then((rarc) => buildModel(rarc, `bdl/vochi.bdl`));
        else if (name === 'Kanat') fetchArchive(`Kanat.arc`).then((rarc) => buildModel(rarc, `bdl/kanat.bdl`));
        else if (name === 'Kryu00') fetchArchive(`Kryu.arc`).then((rarc) => buildModel(rarc, `bdl/ryu_00.bdl`));
        // Tower of the Gods
        else if (name === 'X_tower') fetchArchive(`X_tower.arc`).then((rarc) => buildModel(rarc, `bdl/x_tower.bdl`));
        else if (name === 'Wall') fetchArchive(`Hbw1.arc`).then((rarc) => buildModel(rarc, `bdl/hbw1.bdl`));
        else if (name === 'Hmon1d') fetchArchive(`Hseki.arc`).then((rarc) => buildModel(rarc, `bdlm/hmon1.bdl`).bindTRK1(parseBRK(rarc, `brk/hmon1.brk`)));
        else if (name === 'Hmon2d') fetchArchive(`Hseki.arc`).then((rarc) => buildModel(rarc, `bdlm/hmon2.bdl`).bindTRK1(parseBRK(rarc, `brk/hmon2.brk`)));
        else if (name === 'Hmos1') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos1.bdl`));
        else if (name === 'Hmos2') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos2.bdl`));
        else if (name === 'Hmos3') fetchArchive(`Hmos.arc`).then((rarc) => buildModel(rarc, `bdl/hmos3.bdl`));
        else if (name === 'amos') fetchArchive(`Am.arc`).then((rarc) => buildModel(rarc, `bdl/am.bdl`));
        else if (name === 'amos2') fetchArchive(`Am2.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/am2.bdl`);
            m.bindANK1(parseBCK(rarc, `bck/wait.bck`));
            m.bindTTK1(parseBTK(rarc, `btk/am2.btk`));
            m.bindTRK1(parseBRK(rarc, `brk/am2.brk`));
        });
        else if (name === 'Hha') fetchArchive(`Hha.arc`).then((rarc) => {
            buildModel(rarc, `bdlm/hha1.bdl`);
            buildModel(rarc, `bdlm/hha2.bdl`);
        });
        else if (name === 'Gkai00') fetchArchive(`Gkai00.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/gkai00.bdl`);
            m.bindANK1(parseBCK(rarc, `bck/gkai00.bck`));
            m.bindTRK1(parseBRK(rarc, `brk/gkai00.brk`));
            m.bindTTK1(parseBTK(rarc, `btk/gkai00.btk`));
        });
        else if (name === 'Gbrg00') fetchArchive(`Gbrg00.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/gbrg00.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/gbrg00.brk`));
            m.bindTTK1(parseBTK(rarc, `btk/gbrg00.btk`));
        });
        else if (name === 'Humi0z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi0.bdl`).bindTTK1(parseBTK(rarc, `btk/humi0.btk`)));
        else if (name === 'Humi2z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi2.bdl`).bindTTK1(parseBTK(rarc, `btk/humi2.btk`)));
        else if (name === 'Humi3z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi3.bdl`).bindTTK1(parseBTK(rarc, `btk/humi3.btk`)));
        else if (name === 'Humi4z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi4.bdl`).bindTTK1(parseBTK(rarc, `btk/humi4.btk`)));
        else if (name === 'Humi5z') fetchArchive(`Humi.arc`).then((rarc) => buildModel(rarc, `bdlm/humi5.bdl`).bindTTK1(parseBTK(rarc, `btk/humi5.btk`)));
        else if (name === 'Htetu1') fetchArchive(`Htetu1.arc`).then((rarc) => buildModel(rarc, `bdl/htetu1.bdl`));
        else if (name === 'Htobi1') fetchArchive(`Htobi1.arc`).then((rarc) => buildModel(rarc, `bdl/htobi1.bdl`));
        else if (name === 'Hbox2') fetchArchive(`Hbox2.arc`).then((rarc) => buildModel(rarc, `bdl/hbox2.bdl`));
        else if (name === 'Hbox2S') fetchArchive(`Hbox2.arc`).then((rarc) => buildModel(rarc, `bdl/hbox2.bdl`));
        else if (name === 'Hmlif') fetchArchive(`Hmlif.arc`).then((rarc) => buildModel(rarc, `bdlm/hmlif.bdl`));
        else if (name === 'Hdai1') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
        else if (name === 'Hdai2') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
        else if (name === 'Hdai3') fetchArchive(`Hdai1.arc`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
        else if (name === 'Hsh') fetchArchive(`Hsehi1.arc`).then((rarc) => buildModel(rarc, `bdl/hsehi1.bdl`));
        else if (name === 'Hsh2') fetchArchive(`Hsehi2.arc`).then((rarc) => buildModel(rarc, `bdl/hsehi2.bdl`));
        else if (name === 'Hyuf1') fetchArchive(`Hyuf1.arc`).then((rarc) => buildModel(rarc, `bdlm/hyuf1.bdl`));
        else if (name === 'Hyuf2') fetchArchive(`Hyuf2.arc`).then((rarc) => buildModel(rarc, `bdlm/hyuf2.bdl`));
        else if (name === 'Blift') fetchArchive(`Hten1.arc`).then((rarc) => buildModel(rarc, `bdl/hten1.bdl`));
        else if (name === 'Hcbh') fetchArchive(`Hcbh.arc`).then((rarc) => {
            buildModel(rarc, `bdl/hcbh1a.bdl`);
            buildModel(rarc, `bdl/hcbh1b.bdl`);
            buildModel(rarc, `bdl/hcbh1c.bdl`);
            buildModel(rarc, `bdl/hcbh1d.bdl`);
            buildModel(rarc, `bdl/hcbh2.bdl`);
        });
        else if (name === 'Hfbot1B') fetchArchive(`Hfbot.arc`).then((rarc) => buildModel(rarc, `bdlm/hfbot1.bdl`).bindTRK1(parseBRK(rarc, `brk/hfbot1.brk`)));
        else if (name === 'Hfbot1C') fetchArchive(`Hfbot.arc`).then((rarc) => buildModel(rarc, `bdlm/hfbot1.bdl`).bindTRK1(parseBRK(rarc, `brk/hfbot1.brk`)));
        else if (name === 'Hys') fetchArchive(`Hys.arc`).then((rarc) => buildModel(rarc, `bdlm/hys.bdl`));
        else if (name === 'Hys2') fetchArchive(`Hys.arc`).then((rarc) => buildModel(rarc, `bdlm/hys.bdl`));
        else if (name === 'Ywarp00') fetchArchive(`Ywarp00.arc`).then((rarc) => {
            const m = buildModel(rarc, `bmdm/ywarp00.bmd`);
            m.bindANK1(parseBCK(rarc, `bck/ywarp00.bck`));
            m.bindTRK1(parseBRK(rarc, `brk/ywarp00.brk`));
        });
        // Hyrule.
        else if (name === 'YLzou') fetchArchive(`YLzou.arc`).then((rarc) => buildModel(rarc, `bdl/ylzou.bdl`));
        else if (name === 'MtryB') fetchArchive(`MtryB.arc`).then((rarc) => buildModel(rarc, `bdl/mtryb.bdl`));
        else if (name === 'zouK' || name === 'zouK1' || name === 'zouK2' || name === 'zouK3' || name === 'zouK4') fetchArchive(`VzouK.arc`).then((rarc) => buildModel(rarc, `bdl/vzouk.bdl`));
        else if (name === 'VmsDZ') fetchArchive(`VmsDZ.arc`).then((rarc) => buildModel(rarc, `bdl/vmsdz.bdl`));
        else if (name === 'VmsMS') fetchArchive(`VmsMS.arc`).then((rarc) => buildModel(rarc, `bdl/vmsms.bdl`));
        else if (name === 'Yswdr00') fetchArchive(`Yswdr00.arc`).then((rarc) => buildModel(rarc, `bdlm/yswdr00.bdl`).bindTTK1(parseBTK(rarc, `btk/yswdr00.btk`)));
        // Earth Temple.
        else if (name === 'MhmrSW0') fetchArchive(`MhmrSW.arc`).then((rarc) => buildModel(rarc, `bdl/mhmrsw.bdl`));
        // Nintendo Gallery
        else if (name === 'Figure') {
            fetchArchive(`Figure.arc`).then((rarc) => buildModel(rarc, `bdlm/vf_bs.bdl`))
            const figureId = parameters & 0x000000FF;
            const baseFilename = `vf_${leftPad(''+figureId, 3)}`;
            const base = `bdl/${baseFilename}`;

            // Outset Island
            if (figureId >= 0x00 && figureId <= 0x0D) fetchArchive(`Figure0.arc`).then((rarc) => {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            });
            // Windfall Island
            else if (figureId >= 0x0E && figureId <= 0x28) fetchArchive(`Figure1.arc`).then((rarc) => {
                if (figureId === 16 || figureId === 18) {
                    buildModel(rarc, `${base}b.bdl`).modelMatrix[13] += 100;
                } else {
                    buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
                }
            });
            else if (figureId >= 0x29 && figureId <= 0x40) fetchArchive(`Figure2.arc`).then((rarc) => {
                // Nintendo is REALLY cool.
                if (figureId === 61) {
                    buildModel(rarc, `bdlm/${baseFilename}.bdl`).modelMatrix[13] += 100;
                } else {
                    buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
                }

                // TODO(jstpierre): What are Figure2a/b for? 
                // fetchArchive(`Figure2a.arc`).then((rarc) => console.log("2a", rarc));
                // fetchArchive(`Figure2b.arc`).then((rarc) => console.log("2b", rarc));
            });
            // Dragon Roost Island
            else if (figureId >= 0x41 && figureId <= 0x52) fetchArchive(`Figure3.arc`).then((rarc) => {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            });
            // Forest Haven
            else if (figureId >= 0x53 && figureId <= 0x60) fetchArchive(`Figure4.arc`).then((rarc) => {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            });
            // Secret Cavern
            else if (figureId >= 0x61 && figureId <= 0x73) fetchArchive(`Figure5.arc`).then((rarc) => {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            });
            // Forsaken Fortress
            else if (figureId >= 0x74 && figureId <= 0xFF) fetchArchive(`Figure6.arc`).then((rarc) => {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            });
        }
        // Treasure chests
        else if (name === 'takara' || name === 'takara2' || name === 'takara3' || name === 'takara4' || name === 'takara5' || name === 'takara6' || name === 'takara7' || name === 'takara8' ||
                 name === 'takaraK' || name === 'takaraI' || name === 'takaraM' || name === 'tkrASw' || name === 'tkrAGc' || name === 'tkrAKd' || name === 'tkrASw' || name === 'tkrAIk' ||
                 name === 'tkrBMs' || name === 'tkrCTf' || name === 'tkrAOc' || name === 'tkrAOs' || name === 'Bitem') {
            // The treasure chest name does not matter, everything is in the parameters.
            // https://github.com/LordNed/Winditor/blob/master/Editor/Editor/Entities/TreasureChest.cs
            const rarc = await fetchArchive('Dalways.arc');
            const type = (parameters >>> 20) & 0x0F;
            if (type === 0) {
                // Light Wood
                const m = buildModel(rarc, `bdli/boxa.bdl`);
            } else if (type === 1) {
                // Dark Wood
                const m = buildModel(rarc, `bdli/boxb.bdl`);
            } else if (type === 2) {
                // Metal
                const m = buildModel(rarc, `bdli/boxc.bdl`);
                const b = parseBRK(rarc, 'brk/boxc.brk');
                b.loopMode = LoopMode.ONCE;
                m.bindTRK1(b);
            } else if (type === 3) {
                // Big Key
                const m = buildModel(rarc, `bdli/boxd.bdl`);
            } else {
                // Might be something else, not sure.
                console.warn(`Unknown chest type: ${name} / ${roomRenderer.name} Layer ${layer} / ${hexzero(parameters, 8)}`);
            }
        }
        // Under-water treasure points. Perhaps spawn at some point?
        else if (name === 'Salvage' || name === 'Salvag2' || name === 'SalvagE' || name === 'SalvagN' || name === 'SalvFM') return;
        // Grass/Flowers/Small Trees. Procedurally generated by the engine.
        // https://github.com/LagoLunatic/WW-Hacking-Docs/blob/6e1ecdadbdf5124e7f6ff037106deb29a5f7238b/Entity%20DZx%20Formats.txt#L695
        else if (
            name === 'kusax1' || name === 'kusax7'  || name === 'kusax21' ||
            name === 'flower' || name === 'flwr7'   || name === 'flwr17' ||
            name === 'pflower'|| name === 'pflwrx7' || 
            name === 'swood'  || name === 'swood3'  || name === 'swood5'
        ) {
            if (actor.layer === -1 || actor.layer === 0)
                return AGrass.create(renderer, actor);
        }
        // Bushes. Procedurally generated by the engine.
        else if (name === 'woodb' || name === 'woodbx') return;
        // Rope. Procedurally generated by the engine.
        else if (name === 'RopeR') return;
        // Bridges. Procedurally generated by the engine.
        else if (name === 'bridge') return;
        // Gyorg spawners.
        else if (name === 'GyCtrl' || name === 'GyCtrlA' || name === 'GyCtrlB') return;
        // Markers for Tingle Tuner
        else if (name === 'agbTBOX' || name === 'agbMARK' || name === 'agbF' || name === 'agbA' || name === 'agbAT' || name === 'agbA2' || name === 'agbR' || name === 'agbB' || name === 'agbFA' || name === 'agbCSW') return;
        // Logic flags used for gameplay, not spawnable objects.
        else if (name === 'AND_SW0' || name === 'AND_SW1' || name === 'AND_SW2' || name === 'SW_HIT0' || name === 'ALLdie' || name === 'SW_C00') return;
        // SWitch SaLVaGe?
        else if (name === 'SwSlvg') return;
        // EVent SWitch
        else if (name === 'Evsw') return;
        // Tags for fishmen?
        else if (name === 'TagSo' || name === 'TagMSo') return;
        // Photo tags
        else if (name === 'TagPo') return;
        // Light tags?
        else if (name === 'LTag0' || name === 'LTag1' || name === 'LTagR0') return;
        // Environment tags (Kyanko)
        else if (name === 'kytag00' || name === 'ky_tag0' || name === 'ky_tag1' || name === 'ky_tag2' || name === 'kytag5' || name === 'kytag6' || name === 'kytag7') return;
        // Other tags?
        else if (name === 'TagEv' || name === 'TagKb' || name === 'TagIsl' || name === 'TagMk' || name === 'TagWp' || name === 'TagMd') return;
        else if (name === 'TagHt' || name === 'TagMsg' || name === 'TagMsg2' || name === 'ReTag0') return;
        else if (name === 'AttTag' || name === 'AttTagB') return;
        else if (name === 'VolTag' || name === 'WindTag') return;
        // Misc. gameplay data
        else if (name === 'HyoiKam') return;
        // Flags (only contains textures)
        else if (name === 'MtFlag' || name === 'SieFlag' || name === 'Gflag' || name === 'MjFlag') return;
        // Collision
        else if (name === 'Akabe') return;
        else
            console.warn(`Unknown object: ${name} / ${roomRenderer.name} Layer ${layer} / ${hexzero(parameters, 8)}`);
    }

    private spawnObjectsFromACTRLayer(device: GfxDevice, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, buffer: ArrayBufferSlice, layerIndex: number, actrHeader: DZSChunkHeader | undefined, worldModelMatrix: mat4): void {
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

            const localModelMatrix = mat4.create();
            computeModelMatrixSRT(localModelMatrix, 1, 1, 1, 0, rotY, 0, posX, posY, posZ);

            const actor: Actor = {
                name,
                parameters,
                roomIndex: roomRenderer.roomIdx,
                layer: layerIndex,
                pos: vec3.fromValues(posX, posY, posZ),
                scale: vec3.fromValues(1, 1, 1),
                rotationY: rotY
            };

            this.spawnObjectsForActor(device, renderer, roomRenderer, name, parameters, layerIndex, localModelMatrix, worldModelMatrix, actor);

            actrTableIdx += 0x20;
        }
    }

    private spawnObjectsFromSCOBLayer(device: GfxDevice, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, buffer: ArrayBufferSlice, layer: number, actrHeader: DZSChunkHeader | undefined, worldModelMatrix: mat4): void {
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

            const localModelMatrix = mat4.create();
            computeModelMatrixSRT(localModelMatrix, scaleX, scaleY, scaleZ, 0, rotY, 0, posX, posY, posZ);

            const actor: Actor = {
                name,
                parameters,
                roomIndex: roomRenderer.roomIdx,
                layer,
                pos: vec3.fromValues(posX, posY, posZ),
                scale: vec3.fromValues(scaleX, scaleY, scaleZ),
                rotationY: rotY,
            };

            this.spawnObjectsForActor(device, renderer, roomRenderer, name, parameters, layer, localModelMatrix, worldModelMatrix, actor);

            actrTableIdx += 0x24;
        }
    }

    private spawnObjectsFromDZR(device: GfxDevice, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, buffer: ArrayBufferSlice, modelMatrix: mat4): void {
        const chunkHeaders = parseDZSHeaders(buffer);

        function buildChunkLayerName(base: string, i: number): string {
            if (i === -1) {
                return base;
            } else {
                return base.slice(0, 3) + i.toString(16).toLowerCase();
            }
        }

        for (let i = -1; i < 16; i++) {
            this.spawnObjectsFromACTRLayer(device, renderer, roomRenderer, buffer, i, chunkHeaders.get(buildChunkLayerName('ACTR', i)), modelMatrix);
            this.spawnObjectsFromACTRLayer(device, renderer, roomRenderer, buffer, i, chunkHeaders.get(buildChunkLayerName('TGOB', i)), modelMatrix);
            this.spawnObjectsFromACTRLayer(device, renderer, roomRenderer, buffer, i, chunkHeaders.get(buildChunkLayerName('TRES', i)), modelMatrix);
            this.spawnObjectsFromSCOBLayer(device, renderer, roomRenderer, buffer, i, chunkHeaders.get(buildChunkLayerName('SCOB', i)), modelMatrix);
            this.spawnObjectsFromSCOBLayer(device, renderer, roomRenderer, buffer, i, chunkHeaders.get(buildChunkLayerName('TGSC', i)), modelMatrix);
        }
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
