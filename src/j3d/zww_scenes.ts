
import { mat4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { readString } from '../util';
import { fetchData } from '../fetch';

import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';
import * as UI from '../ui';

import * as GX_Material from '../gx/gx_material';

import { BMD, BTK, BRK, BCK } from './j3d';
import * as RARC from './rarc';
import { J3DTextureHolder, BMDModelInstance, BMDModel } from './render';
import { Camera, computeViewMatrix } from '../Camera';
import { DeviceProgram } from '../Program';
import { colorToCSS, Color } from '../Color';
import { ColorKind, GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxRenderPass, GfxHostAccessPass, GfxBufferUsage, GfxFormat, GfxVertexAttributeFrequency, GfxInputLayout, GfxInputState, GfxBuffer, GfxProgram, GfxBindingLayoutDescriptor, GfxPrimitiveTopology, GfxCompareMode, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { BufferFillerHelper } from '../gfx/helpers/UniformBufferHelpers';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';

const TIME_OF_DAY_ICON = `<svg viewBox="0 0 100 100" height="20" fill="white"><path d="M50,93.4C74,93.4,93.4,74,93.4,50C93.4,26,74,6.6,50,6.6C26,6.6,6.6,26,6.6,50C6.6,74,26,93.4,50,93.4z M37.6,22.8  c-0.6,2.4-0.9,5-0.9,7.6c0,18.2,14.7,32.9,32.9,32.9c2.6,0,5.1-0.3,7.6-0.9c-4.7,10.3-15.1,17.4-27.1,17.4  c-16.5,0-29.9-13.4-29.9-29.9C20.3,37.9,27.4,27.5,37.6,22.8z"/></svg>`;

interface Colors {
    amb: GX_Material.Color;
    light: GX_Material.Color;
    ocean: GX_Material.Color;
    wave: GX_Material.Color;
    splash: GX_Material.Color;
    splash2: GX_Material.Color;
    doors: GX_Material.Color;
    vr_back_cloud: GX_Material.Color;
    vr_sky: GX_Material.Color;
    vr_uso_umi: GX_Material.Color;
    vr_kasumi_mae: GX_Material.Color;
}

function getColorsFromDZS(buffer: ArrayBufferSlice, roomIdx: number, timeOfDay: number): Colors {
    const view = buffer.createDataView();
    const chunkCount = view.getUint32(0x00);

    const chunkOffsets = new Map<string, number>();
    let chunkTableIdx = 0x04;
    for (let i = 0; i < chunkCount; i++) {
        const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
        const offs = view.getUint32(chunkTableIdx + 0x08);
        chunkOffsets.set(type, offs);
        chunkTableIdx += 0x0C;
    }

    const coloIdx = view.getUint8(chunkOffsets.get('EnvR') + (roomIdx * 0x08));
    const coloOffs = chunkOffsets.get('Colo') + (coloIdx * 0x0C);
    const whichPale = timeOfDay;
    const paleIdx = view.getUint8(coloOffs + whichPale);
    const paleOffs = chunkOffsets.get('Pale') + (paleIdx * 0x2C);
    const virtIdx = view.getUint8(paleOffs + 0x21);
    const virtOffs = chunkOffsets.get('Virt') + (virtIdx * 0x24);

    const ambR = view.getUint8(paleOffs + 0x06) / 0xFF;
    const ambG = view.getUint8(paleOffs + 0x07) / 0xFF;
    const ambB = view.getUint8(paleOffs + 0x08) / 0xFF;
    const amb = new GX_Material.Color(ambR, ambG, ambB, 1);

    const lightR = view.getUint8(paleOffs + 0x09) / 0xFF;
    const lightG = view.getUint8(paleOffs + 0x0A) / 0xFF;
    const lightB = view.getUint8(paleOffs + 0x0B) / 0xFF;
    const light = new GX_Material.Color(lightR, lightG, lightB, 1);

    const waveR = view.getUint8(paleOffs + 0x0C) / 0xFF;
    const waveG = view.getUint8(paleOffs + 0x0D) / 0xFF;
    const waveB = view.getUint8(paleOffs + 0x0E) / 0xFF;
    const wave = new GX_Material.Color(waveR, waveG, waveB, 1);

    const oceanR = view.getUint8(paleOffs + 0x0F) / 0xFF;
    const oceanG = view.getUint8(paleOffs + 0x10) / 0xFF;
    const oceanB = view.getUint8(paleOffs + 0x11) / 0xFF;
    const ocean = new GX_Material.Color(oceanR, oceanG, oceanB, 1);

    const splashR = view.getUint8(paleOffs + 0x12) / 0xFF;
    const splashG = view.getUint8(paleOffs + 0x13) / 0xFF;
    const splashB = view.getUint8(paleOffs + 0x14) / 0xFF;
    const splash = new GX_Material.Color(splashR, splashG, splashB, 1);

    const splash2R = view.getUint8(paleOffs + 0x15) / 0xFF;
    const splash2G = view.getUint8(paleOffs + 0x16) / 0xFF;
    const splash2B = view.getUint8(paleOffs + 0x17) / 0xFF;
    const splash2 = new GX_Material.Color(splash2R, splash2G, splash2B, 1);

    const doorsR = view.getUint8(paleOffs + 0x18) / 0xFF;
    const doorsG = view.getUint8(paleOffs + 0x19) / 0xFF;
    const doorsB = view.getUint8(paleOffs + 0x1A) / 0xFF;
    const doors = new GX_Material.Color(doorsR, doorsG, doorsB, 1);

    const vr_back_cloudR = view.getUint8(virtOffs + 0x10) / 0xFF;
    const vr_back_cloudG = view.getUint8(virtOffs + 0x11) / 0xFF;
    const vr_back_cloudB = view.getUint8(virtOffs + 0x12) / 0xFF;
    const vr_back_cloudA = view.getUint8(virtOffs + 0x13) / 0xFF;
    const vr_back_cloud = new GX_Material.Color(vr_back_cloudR, vr_back_cloudG, vr_back_cloudB, vr_back_cloudA);

    const vr_skyR = view.getUint8(virtOffs + 0x18) / 0xFF;
    const vr_skyG = view.getUint8(virtOffs + 0x19) / 0xFF;
    const vr_skyB = view.getUint8(virtOffs + 0x1A) / 0xFF;
    const vr_sky = new GX_Material.Color(vr_skyR, vr_skyG, vr_skyB, 1);

    const vr_uso_umiR = view.getUint8(virtOffs + 0x1B) / 0xFF;
    const vr_uso_umiG = view.getUint8(virtOffs + 0x1C) / 0xFF;
    const vr_uso_umiB = view.getUint8(virtOffs + 0x1D) / 0xFF;
    const vr_uso_umi = new GX_Material.Color(vr_uso_umiR, vr_uso_umiG, vr_uso_umiB, 1);

    const vr_kasumi_maeG = view.getUint8(virtOffs + 0x1F) / 0xFF;
    const vr_kasumi_maeR = view.getUint8(virtOffs + 0x1E) / 0xFF;
    const vr_kasumi_maeB = view.getUint8(virtOffs + 0x20) / 0xFF;
    const vr_kasumi_mae = new GX_Material.Color(vr_kasumi_maeR, vr_kasumi_maeG, vr_kasumi_maeB, 1);

    return { amb, light, wave, ocean, splash, splash2, doors, vr_back_cloud, vr_sky, vr_uso_umi, vr_kasumi_mae };
}

function createScene(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, rarc: RARC.RARC, name: string, isSkybox: boolean = false): BMDModelInstance {
    let bdlFile = rarc.findFile(`bdl/${name}.bdl`);
    if (!bdlFile)
        bdlFile = rarc.findFile(`bmd/${name}.bmd`);
    if (!bdlFile)
        return null;
    const btkFile = rarc.findFile(`btk/${name}.btk`);
    const brkFile = rarc.findFile(`brk/${name}.brk`);
    const bckFile = rarc.findFile(`bck/${name}.bck`);
    const bdl = BMD.parse(bdlFile.buffer);
    textureHolder.addJ3DTextures(device, bdl);
    const bmdModel = new BMDModel(device, renderHelper, bdl, null);
    const scene = new BMDModelInstance(device, renderHelper, textureHolder, bmdModel);
    scene.passMask = isSkybox ? WindWakerPass.SKYBOX : WindWakerPass.MAIN;

    if (btkFile !== null) {
        const btk = BTK.parse(btkFile.buffer);
        scene.bindTTK1(btk.ttk1);
    }

    if (brkFile !== null) {
        const brk = BRK.parse(brkFile.buffer);
        scene.bindTRK1(brk.trk1);
    }

    if (bckFile !== null) {
        const bck = BCK.parse(bckFile.buffer);
        scene.bindANK1(bck.ank1);
    }

    scene.setIsSkybox(isSkybox);
    return scene;
}

class WindWakerRoomRenderer {
    public model: BMDModelInstance;
    public model1: BMDModelInstance;
    public model2: BMDModelInstance;
    public model3: BMDModelInstance;
    public name: string;
    public visible: boolean = true;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, public roomIdx: number, public roomRarc: RARC.RARC) {
        this.name = `Room ${roomIdx}`;

        this.model = createScene(device, renderHelper, textureHolder, roomRarc, `model`);

        // Ocean.
        this.model1 = createScene(device, renderHelper, textureHolder, roomRarc, `model1`);

        // Special effects / Skybox as seen in Hyrule.
        this.model2 = createScene(device, renderHelper, textureHolder, roomRarc, `model2`);

        // Windows / doors.
        this.model3 = createScene(device, renderHelper, textureHolder, roomRarc, `model3`);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.model)
            this.model.prepareToRender(renderHelper, viewerInput);
        if (this.model1)
            this.model1.prepareToRender(renderHelper, viewerInput);
        if (this.model2)
            this.model2.prepareToRender(renderHelper, viewerInput);
        if (this.model3)
            this.model3.prepareToRender(renderHelper, viewerInput);
    }

    public setModelMatrix(modelMatrix: mat4): void {
        mat4.copy(this.model.modelMatrix, modelMatrix);
        if (this.model1)
            mat4.copy(this.model1.modelMatrix, modelMatrix);
        if (this.model3)
            mat4.copy(this.model3.modelMatrix, modelMatrix);
    }

    public setColors(colors?: Colors): void {
        if (colors !== undefined) {
            if (this.model) {
                this.model.setColorOverride(ColorKind.K0, colors.light);
                this.model.setColorOverride(ColorKind.C0, colors.amb);
            }

            if (this.model1) {
                this.model1.setColorOverride(ColorKind.K0, colors.ocean);
                this.model1.setColorOverride(ColorKind.C0, colors.wave);
                this.model1.setColorOverride(ColorKind.C1, colors.splash);
                this.model1.setColorOverride(ColorKind.K1, colors.splash2);
            }
            if (this.model3)
                this.model3.setColorOverride(ColorKind.C0, colors.doors);
        } else {
            if (this.model) {
                this.model.setColorOverride(ColorKind.K0, undefined);
                this.model.setColorOverride(ColorKind.C0, undefined);
            }

            if (this.model1) {
                this.model1.setColorOverride(ColorKind.K0, undefined);
                this.model1.setColorOverride(ColorKind.C0, undefined);
                this.model1.setColorOverride(ColorKind.C1, undefined);
                this.model1.setColorOverride(ColorKind.K1, undefined);
            }
            if (this.model3)
                this.model3.setColorOverride(ColorKind.C0, undefined);
        }
    }

    public setVisible(v: boolean): void {
        this.visible = v;
        if (this.model)
            this.model.visible = v;
        if (this.model1)
            this.model1.visible = v;
        if (this.model2)
            this.model2.visible = v;
        if (this.model3)
            this.model3.visible = v;
    }

    public destroy(device: GfxDevice): void {
        if (this.model)
            this.model.destroy(device);
        if (this.model1)
            this.model1.destroy(device);
        if (this.model2)
            this.model2.destroy(device);
        if (this.model3)
            this.model3.destroy(device);
    }
}

class PlaneColorProgram extends DeviceProgram {
    public static a_Position: number = 0;

    public both = `
precision mediump float;
layout(row_major, std140) uniform ub_Params {
    mat4 u_Projection;
    mat4x3 u_ModelView;
    vec4 u_PlaneColor;
};
#ifdef VERT
layout(location = ${PlaneColorProgram.a_Position}) in vec3 a_Position;
void main() {
    gl_Position = u_Projection * mat4(u_ModelView) * vec4(a_Position, 1.0);
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
class SeaPlane {
    private posBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private gfxProgram: GfxProgram;
    private renderInst: GfxRenderInst;
    private paramsBuffer: GfxRenderBuffer;
    private bufferFiller: BufferFillerHelper;
    private paramsBufferOffset: number;
    private modelMatrix = mat4.create();
    private color: Color;

    constructor(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer) {
        this.createBuffers(device);
        mat4.fromScaling(this.modelMatrix, [200000, 1, 200000]);
        mat4.translate(this.modelMatrix, this.modelMatrix, [0, -100, 0]);

        this.gfxProgram = device.createProgram(new PlaneColorProgram());

        const programReflection = device.queryProgram(this.gfxProgram);
        const paramsLayout = programReflection.uniformBufferLayouts[0];
        this.bufferFiller = new BufferFillerHelper(paramsLayout);
        this.paramsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 0 }];
        const renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [ this.paramsBuffer ]);
        this.renderInst = renderInstBuilder.pushRenderInst();
        this.renderInst.name = 'SeaPlane';
        this.renderInst.gfxProgram = this.gfxProgram;
        this.renderInst.inputState = this.inputState;
        this.renderInst.setMegaStateFlags({
            depthWrite: true,
            depthCompare: GfxCompareMode.LESS,
        });
        this.renderInst.drawIndexes(6, 0);
        this.paramsBufferOffset = renderInstBuilder.newUniformBufferInstance(this.renderInst, 0);
        renderInstBuilder.finish(device, viewRenderer);
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, this.modelMatrix);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.bufferFiller.reset();
        this.bufferFiller.fillMatrix4x4(viewerInput.camera.projectionMatrix);
        this.computeModelView(scratchMatrix, viewerInput.camera);
        this.bufferFiller.fillMatrix4x3(scratchMatrix);
        this.bufferFiller.fillColor(this.color);
        this.bufferFiller.endAndUpload(hostAccessPass, this.paramsBuffer, this.paramsBufferOffset);
        this.paramsBuffer.prepareToRender(hostAccessPass);
    }

    public setColor(color: GX_Material.Color): void {
        this.color = color;
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyProgram(this.gfxProgram);
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
            { format: GfxFormat.F32_RGB, location: PlaneColorProgram.a_Position, bufferByteOffset: 0, bufferIndex: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.posBuffer, byteOffset: 0, byteStride: 0 },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 });
    }
}

const enum WindWakerPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

class WindWakerRenderer implements Viewer.SceneGfx {
    private viewRenderer = new GfxRenderInstViewRenderer();
    private renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;

    private seaPlane: SeaPlane;
    private vr_sky: BMDModelInstance;
    private vr_uso_umi: BMDModelInstance;
    private vr_kasumi_mae: BMDModelInstance;
    private vr_back_cloud: BMDModelInstance;
    public roomRenderers: WindWakerRoomRenderer[] = [];

    private currentTimeOfDay: number;
    private timeOfDaySelector: UI.SingleSelect;

    public onstatechanged!: () => void;

    constructor(device: GfxDevice, public textureHolder: J3DTextureHolder, wantsSeaPlane: boolean, private stageRarc: RARC.RARC) {
        this.renderHelper = new GXRenderHelperGfx(device);

        if (wantsSeaPlane)
            this.seaPlane = new SeaPlane(device, this.viewRenderer);

        this.vr_sky = createScene(device, this.renderHelper, this.textureHolder, stageRarc, `vr_sky`, true);
        this.vr_uso_umi = createScene(device, this.renderHelper, this.textureHolder, stageRarc, `vr_uso_umi`, true);
        this.vr_kasumi_mae = createScene(device, this.renderHelper, this.textureHolder, stageRarc, `vr_kasumi_mae`, true);
        this.vr_back_cloud = createScene(device, this.renderHelper, this.textureHolder, stageRarc, `vr_back_cloud`, true);
    }

    private setTimeOfDay(timeOfDay: number): void {
        if (this.currentTimeOfDay === timeOfDay)
            return;

        this.currentTimeOfDay = timeOfDay;
        this.timeOfDaySelector.selectItem(timeOfDay + 1);
        this.onstatechanged();
        const dzsFile = this.stageRarc.findFile(`dzs/stage.dzs`);

        const colors = timeOfDay === -1 ? undefined : getColorsFromDZS(dzsFile.buffer, 0, timeOfDay);

        if (colors !== undefined) {
            if (this.seaPlane)
                this.seaPlane.setColor(colors.ocean);
            if (this.vr_sky)
                this.vr_sky.setColorOverride(ColorKind.K0, colors.vr_sky);
            if (this.vr_uso_umi)
                this.vr_uso_umi.setColorOverride(ColorKind.K0, colors.vr_uso_umi);
            if (this.vr_kasumi_mae)
                this.vr_kasumi_mae.setColorOverride(ColorKind.C0, colors.vr_kasumi_mae);
            if (this.vr_back_cloud)
                this.vr_back_cloud.setColorOverride(ColorKind.K0, colors.vr_back_cloud, true);
        } else {
            if (this.vr_sky)
                this.vr_sky.setColorOverride(ColorKind.K0, undefined);
            if (this.vr_uso_umi)
                this.vr_uso_umi.setColorOverride(ColorKind.K0, undefined);
            if (this.vr_kasumi_mae)
                this.vr_kasumi_mae.setColorOverride(ColorKind.C0, undefined);
            if (this.vr_back_cloud)
                this.vr_back_cloud.setColorOverride(ColorKind.K0, undefined);
        }

        for (const roomRenderer of this.roomRenderers) {
            const roomColors = timeOfDay === -1 ? undefined : getColorsFromDZS(dzsFile.buffer, 0, timeOfDay);
            roomRenderer.setColors(roomColors);
        }
    }

    public finish(device: GfxDevice): void {
        this.renderHelper.finishBuilder(device, this.viewRenderer);
    }

    public createPanels(): UI.Panel[] {
        const timeOfDayPanel = new UI.Panel();
        timeOfDayPanel.setTitle(TIME_OF_DAY_ICON, "Time of Day");

        const colorPresets = [ '(no palette)', 'Dusk', 'Morning', 'Day', 'Afternoon', 'Evening', 'Night' ];

        this.timeOfDaySelector = new UI.SingleSelect();
        this.timeOfDaySelector.setStrings(colorPresets);
        this.timeOfDaySelector.onselectionchange = (index: number) => {
            const timeOfDay = index - 1;
            this.setTimeOfDay(timeOfDay);
        };

        const dzsFile = this.stageRarc.findFile(`dzs/stage.dzs`);
        const flairs: UI.Flair[] = colorPresets.slice(1).map((presetName, i): UI.Flair => {
            const elemIndex = i + 1;
            const timeOfDay = i;
            const stageColors = getColorsFromDZS(dzsFile.buffer, 0, timeOfDay);
            return { index: elemIndex, background: colorToCSS(stageColors.vr_sky) };
        });
        this.timeOfDaySelector.setFlairs(flairs);

        this.setTimeOfDay(2);
        timeOfDayPanel.contents.appendChild(this.timeOfDaySelector.elem);

        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.roomRenderers);

        return [timeOfDayPanel, layersPanel];
    }

    private prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        this.renderHelper.fillSceneParams(viewerInput);
        if (this.seaPlane)
            this.seaPlane.prepareToRender(hostAccessPass, viewerInput);
        if (this.vr_sky)
            this.vr_sky.prepareToRender(this.renderHelper, viewerInput);
        if (this.vr_kasumi_mae)
            this.vr_kasumi_mae.prepareToRender(this.renderHelper, viewerInput);
        if (this.vr_uso_umi)
            this.vr_uso_umi.prepareToRender(this.renderHelper, viewerInput);
        if (this.vr_back_cloud)
            this.vr_back_cloud.prepareToRender(this.renderHelper, viewerInput);
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        viewerInput.camera.setClipPlanes(20, 500000);

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, WindWakerPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, WindWakerPass.MAIN);
        return mainPassRenderer;
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        view.setUint8(offs++, this.currentTimeOfDay);
        return offs;
    }

    public deserializeSaveState(dst: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(dst);
        if (offs < byteLength)
            this.setTimeOfDay(view.getUint8(offs++));
        return offs;
    }

    public destroy(device: GfxDevice) {
        this.textureHolder.destroy(device);
        if (this.vr_sky)
            this.vr_sky.destroy(device);
        if (this.vr_kasumi_mae)
            this.vr_kasumi_mae.destroy(device);
        if (this.vr_uso_umi)
            this.vr_uso_umi.destroy(device);
        if (this.vr_back_cloud)
            this.vr_back_cloud.destroy(device);
        if (this.seaPlane)
            this.seaPlane.destroy(device);
        for (const roomRenderer of this.roomRenderers)
            roomRenderer.destroy(device);
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

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const rarcs = [];

        // XXX(jstpierre): This is really terrible code.
        rarcs.push(this.fetchRarc(`j3d/ww/${this.stageDir}/Stage.arc`, abortSignal));
        for (const r of this.rooms) {
            const roomIdx = Math.abs(r);
            rarcs.push(this.fetchRarc(`j3d/ww/${this.stageDir}/Room${roomIdx}.arc`, abortSignal));
        }

        return Progressable.all(rarcs).then(([stageRarc, ...roomRarcs]) => {
            const textureHolder = new J3DTextureHolder();
            const wantsSeaPlane = this.stageDir === 'sea';
            const renderer = new WindWakerRenderer(device, textureHolder, wantsSeaPlane, stageRarc.rarc);
            for (const roomRarc of roomRarcs) {
                const roomIdx = parseInt(roomRarc.path.match(/Room(\d+)/)[1], 10);
                const visible = roomIdx === 0 || this.rooms.indexOf(-roomIdx) === -1;
                const roomRenderer = this.spawnRoom(device, renderer, roomIdx, roomRarc.rarc);
                roomRenderer.visible = visible;
                renderer.roomRenderers.push(roomRenderer);
            }
            renderer.finish(device);
            return renderer;
        });
    }

    protected spawnRoom(device: GfxDevice, renderer: WindWakerRenderer, roomIdx: number, roomRarc: RARC.RARC): WindWakerRoomRenderer {
        return new WindWakerRoomRenderer(device, renderer.renderHelper, renderer.textureHolder, roomIdx, roomRarc);
    }

    private fetchRarc(path: string, abortSignal: AbortSignal): Progressable<{ path: string, rarc: RARC.RARC }> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            if (readString(buffer, 0, 4) === 'Yaz0')
                return Yaz0.decompress(buffer);
            else
                return buffer;
        }).then((buffer: ArrayBufferSlice) => {
            const rarc = RARC.parse(buffer);
            return { path, rarc };
        });
    }
}

class FullSeaSceneDesc extends SceneDesc {
    // Place islands on sea.
    protected spawnRoom(device: GfxDevice, renderer: WindWakerRenderer, roomIdx: number, roomRarc: RARC.RARC): WindWakerRoomRenderer {
        const roomRenderer = super.spawnRoom(device, renderer, roomIdx, roomRarc);

        const modelMatrix = mat4.create();
        const scale = 0.4;
        const gridSize = 100000 * scale;

        const gridX = (roomIdx % 7) | 0;
        const gridY = (roomIdx / 7) | 0;
        const tx = (gridX - 3.5) * gridSize;
        const tz = (gridY - 3.5) * gridSize;
        mat4.fromTranslation(modelMatrix, [tx, 0, tz]);
        mat4.scale(modelMatrix, modelMatrix, [scale, scale, scale]);
        roomRenderer.setModelMatrix(modelMatrix);
        return roomRenderer;
    }
}

// Location names taken from CryZe's Debug Menu.
// https://github.com/CryZe/WindWakerDebugMenu/blob/master/src/warp_menu/consts.rs
const sceneDescs = [
    "The Great Sea",
    new FullSeaSceneDesc("sea", "The Great Sea", [
        1,  2,  3,  4,  5,  6,  7,
        8,  9, 10, 11, 12, 13, 14,
       15, 16, 17, 18, 19, 20, 21,
       22, 23, 24, 25,     27, 28,
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
    new SceneDesc("Obshop", "Beetle's Shop", [1]),

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
    new SceneDesc("M2Tower", "The Tower (Second Visit)"),

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
    new SceneDesc("Omori", "Forest Haven Exterior"),
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
    new SceneDesc("kazeMB", "Mini Boss Room"),

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
    new SceneDesc("figureA", "Great Sea"),
    new SceneDesc("figureB", "Windfall Island"),
    new SceneDesc("figureC", "Outset Island"),
    new SceneDesc("figureD", "Forsaken Fortress"),
    new SceneDesc("figureE", "Secret Cavern"),
    new SceneDesc("figureF", "Dragon Roost Island"),
    new SceneDesc("figureG", "Forest Haven"),
    new SceneDesc("Pfigure", "Main Room"),

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
];

const id = "zww";
const name = "The Legend of Zelda: The Wind Waker";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
