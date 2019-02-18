
import { mat4, vec3, vec4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { readString, assertExists, hexzero, leftPad } from '../util';
import { fetchData } from '../fetch';

import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';
import * as UI from '../ui';

import * as GX_Material from '../gx/gx_material';

import { BMD, BTK, BRK, BCK, BTI, ANK1, TTK1, TRK1, LoopMode } from './j3d';
import * as RARC from './rarc';
import { J3DTextureHolder, BMDModelInstance, BMDModel } from './render';
import { Camera, computeViewMatrix, ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB } from '../Camera';
import { DeviceProgram } from '../Program';
import { colorToCSS, Color } from '../Color';
import { ColorKind, GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxRenderPass, GfxHostAccessPass, GfxBufferUsage, GfxFormat, GfxVertexAttributeFrequency, GfxInputLayout, GfxInputState, GfxBuffer, GfxProgram, GfxBindingLayoutDescriptor, GfxPrimitiveTopology, GfxCompareMode, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst, GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { BufferFillerHelper } from '../gfx/helpers/UniformBufferHelpers';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { RENDER_HACKS_ICON } from '../bk/scenes';
import AnimationController from '../AnimationController';
import { prepareFrameDebugOverlayCanvas2D } from '../DebugJunk';
import { AABB } from '../Geometry';

const TIME_OF_DAY_ICON = `<svg viewBox="0 0 100 100" height="20" fill="white"><path d="M50,93.4C74,93.4,93.4,74,93.4,50C93.4,26,74,6.6,50,6.6C26,6.6,6.6,26,6.6,50C6.6,74,26,93.4,50,93.4z M37.6,22.8  c-0.6,2.4-0.9,5-0.9,7.6c0,18.2,14.7,32.9,32.9,32.9c2.6,0,5.1-0.3,7.6-0.9c-4.7,10.3-15.1,17.4-27.1,17.4  c-16.5,0-29.9-13.4-29.9-29.9C20.3,37.9,27.4,27.5,37.6,22.8z"/></svg>`;

interface Colors {
    actorShadow: GX_Material.Color;
    actorAmbient: GX_Material.Color;
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

function getColorsFromDZS(buffer: ArrayBufferSlice, roomIdx: number, timeOfDay: number): Colors | undefined {
    const view = buffer.createDataView();
    const chunkHeaders = parseDZSHeaders(buffer);

    if (!chunkHeaders.has('Virt'))
        return undefined;

    const coloIdx = view.getUint8(chunkHeaders.get('EnvR').offs + (roomIdx * 0x08));
    const coloOffs = chunkHeaders.get('Colo').offs + (coloIdx * 0x0C);
    const whichPale = timeOfDay;
    const paleIdx = view.getUint8(coloOffs + whichPale);
    const paleOffs = chunkHeaders.get('Pale').offs + (paleIdx * 0x2C);
    const virtIdx = view.getUint8(paleOffs + 0x21);
    const virtOffs = chunkHeaders.get('Virt').offs + (virtIdx * 0x24);

    const actorShadowR = view.getUint8(paleOffs + 0x00) / 0xFF;
    const actorShadowG = view.getUint8(paleOffs + 0x01) / 0xFF;
    const actorShadowB = view.getUint8(paleOffs + 0x02) / 0xFF;
    const actorShadow = new GX_Material.Color(actorShadowR, actorShadowG, actorShadowB, 1);

    const actorAmbientR = view.getUint8(paleOffs + 0x03) / 0xFF;
    const actorAmbientG = view.getUint8(paleOffs + 0x04) / 0xFF;
    const actorAmbientB = view.getUint8(paleOffs + 0x05) / 0xFF;
    const actorAmbient = new GX_Material.Color(actorAmbientR, actorAmbientG, actorAmbientB, 1);

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

    return { actorShadow, actorAmbient, amb, light, wave, ocean, splash, splash2, doors, vr_back_cloud, vr_sky, vr_uso_umi, vr_kasumi_mae };
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

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchLight = new GX_Material.Light();
const bboxScratch = new AABB();
const screenProjection = new ScreenSpaceProjection();
class ObjectRenderer {
    public visible = true;
    public modelMatrix: mat4 = mat4.create();

    private childObjects: ObjectRenderer[] = [];
    private parentJointMatrix: mat4 | null = null;

    constructor(public modelInstance: BMDModelInstance) {
    }

    public bindANK1(ank1: ANK1, animationController?: AnimationController): void {
        this.modelInstance.bindANK1(ank1, animationController);
    }

    public bindTTK1(ttk1: TTK1, animationController?: AnimationController): void {
        this.modelInstance.bindTTK1(ttk1, animationController);
    }

    public bindTRK1(trk1: TRK1, animationController?: AnimationController): void {
        this.modelInstance.bindTRK1(trk1, animationController);
    }

    public setParentJoint(o: ObjectRenderer, jointName: string): void {
        this.parentJointMatrix = o.modelInstance.getJointMatrixReference(jointName);
        o.childObjects.push(this);
    }

    public setMaterialColorWriteEnabled(materialName: string, v: boolean): void {
        this.modelInstance.setMaterialColorWriteEnabled(materialName, v);
    }

    public setColors(colors: Colors): void {
        this.modelInstance.setColorOverride(ColorKind.C0, colors.actorShadow);
        this.modelInstance.setColorOverride(ColorKind.K0, colors.actorAmbient);

        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].setColors(colors);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, visible: boolean): void {
        this.modelInstance.visible = visible && this.visible;

        if (this.modelInstance.visible) {
            if (this.parentJointMatrix !== null) {
                mat4.mul(this.modelInstance.modelMatrix, this.parentJointMatrix, this.modelMatrix);
            } else {
                mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);

                // Don't compute screen area culling on child meshes (don't want heads to disappear before bodies.)
                bboxScratch.transform(this.modelInstance.bmdModel.bbox, this.modelInstance.modelMatrix);
                computeScreenSpaceProjectionFromWorldSpaceAABB(screenProjection, viewerInput.camera, bboxScratch);

                if (screenProjection.getScreenArea() <= 0.0002)
                    this.modelInstance.visible = false;
            }
        }

        GX_Material.lightSetWorldPosition(scratchLight, viewerInput.camera, 250, 250, 250);
        GX_Material.lightSetWorldDirection(scratchLight, viewerInput.camera, -250, -250, -250);
        // Toon lighting works by setting the color to red.
        scratchLight.Color.set(1, 0, 0, 0);
        vec3.set(scratchLight.CosAtten, 1.075, 0, 0);
        vec3.set(scratchLight.DistAtten, 1.075, 0, 0);
        this.modelInstance.setGXLight(0, scratchLight);

        this.modelInstance.prepareToRender(renderHelper, viewerInput);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].prepareToRender(renderHelper, viewerInput, this.modelInstance.visible);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].destroy(device);
    }
}

class WindWakerRoomRenderer {
    public model: BMDModelInstance;
    public model1: BMDModelInstance;
    public model2: BMDModelInstance;
    public model3: BMDModelInstance;
    public name: string;
    public visible: boolean = true;
    public objectRenderers: ObjectRenderer[] = [];

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
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(renderHelper, viewerInput, this.visible);
    }

    public setModelMatrix(modelMatrix: mat4): void {
        if (this.model)
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

            for (let i = 0; i < this.objectRenderers.length; i++)
                this.objectRenderers[i].setColors(colors);
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

    public setVertexColorsEnabled(v: boolean): void {
        if (this.model)
            this.model.setVertexColorsEnabled(v);
        if (this.model1)
            this.model1.setVertexColorsEnabled(v);
        if (this.model2)
            this.model2.setVertexColorsEnabled(v);
        if (this.model3)
            this.model3.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        if (this.model)
            this.model.setTexturesEnabled(v);
        if (this.model1)
            this.model1.setTexturesEnabled(v);
        if (this.model2)
            this.model2.setTexturesEnabled(v);
        if (this.model3)
            this.model3.setTexturesEnabled(v);
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
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
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
        mat4.fromScaling(this.modelMatrix, [2000000, 1, 2000000]);
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
        this.paramsBuffer.destroy(device);
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

    constructor(device: GfxDevice, public modelCache: ModelCache, public textureHolder: J3DTextureHolder, wantsSeaPlane: boolean, private isFullSea: boolean, private stageRarc: RARC.RARC) {
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
        timeOfDayPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        timeOfDayPanel.setTitle(TIME_OF_DAY_ICON, "Time of Day");

        const colorPresets = [ '(no palette)', 'Dusk', 'Morning', 'Day', 'Afternoon', 'Evening', 'Night' ];

        this.timeOfDaySelector = new UI.SingleSelect();
        this.timeOfDaySelector.setStrings(colorPresets);
        this.timeOfDaySelector.onselectionchange = (index: number) => {
            const timeOfDay = index - 1;
            this.setTimeOfDay(timeOfDay);
        };

        const dzsFile = this.stageRarc.findFile(`dzs/stage.dzs`);
        const flairs: UI.Flair[] = colorPresets.slice(1).map((presetName, i): UI.Flair | null => {
            const elemIndex = i + 1;
            const timeOfDay = i;
            const stageColors = getColorsFromDZS(dzsFile.buffer, 0, timeOfDay);
            if (stageColors === undefined)
                return null;
            else
                return { index: elemIndex, background: colorToCSS(stageColors.vr_sky) };
        }).filter((n) => n !== null);
        this.timeOfDaySelector.setFlairs(flairs);

        this.setTimeOfDay(2);
        timeOfDayPanel.contents.appendChild(this.timeOfDaySelector.elem);

        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.roomRenderers);

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
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

        return [timeOfDayPanel, layersPanel, renderHacksPanel];
    }

    private prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isFullSea)
            viewerInput.camera.setClipPlanes(20, 5000000);
        else
            viewerInput.camera.setClipPlanes(2, 50000);
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
        prepareFrameDebugOverlayCanvas2D();

        viewerInput.camera.setClipPlanes(20, 500000);

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.viewRenderer.prepareToRender(device);

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
        view.setInt8(offs++, this.currentTimeOfDay);
        return offs;
    }

    public deserializeSaveState(dst: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(dst);
        if (offs < byteLength)
            this.setTimeOfDay(view.getInt8(offs++));
        return offs;
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy(device);
        this.textureHolder.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
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
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].destroy(device);
        this.modelCache.destroy(device);
    }
}

class ModelCache {
    private archiveProgressableCache = new Map<string, Progressable<RARC.RARC>>();
    private archiveCache = new Map<string, RARC.RARC>();
    private modelCache = new Map<string, BMDModel>();

    public waitForLoad(): Progressable<any> {
        return Progressable.all([... this.archiveProgressableCache.values()]);
    }

    public getArchive(archivePath: string): RARC.RARC {
        return assertExists(this.archiveCache.get(archivePath));
    }

    public fetchArchive(archivePath: string, abortSignal: AbortSignal): Progressable<RARC.RARC> {
        let p = this.archiveProgressableCache.get(archivePath);

        if (p === undefined) {
            p = fetchData(archivePath, abortSignal).then((data) => {
                if (readString(data, 0, 0x04) === 'Yaz0')
                    return Yaz0.decompress(data);
                else
                    return data;
            }).then((data) => {
                const arc = RARC.parse(data);
                this.archiveCache.set(archivePath, arc);
                return arc;
            });
            this.archiveProgressableCache.set(archivePath, p);
        }

        return p;
    }

    public getModel(device: GfxDevice, renderer: WindWakerRenderer, rarc: RARC.RARC, modelPath: string): BMDModel {
        let p = this.modelCache.get(modelPath);

        if (p === undefined) {
            const bmdData = rarc.findFileData(modelPath);
            const bmd = BMD.parse(bmdData);
            renderer.textureHolder.addJ3DTextures(device, bmd);
            p = new BMDModel(device, renderer.renderHelper, bmd);
            this.modelCache.set(modelPath, p);
        }

        return p;
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.modelCache.values())
            model.destroy(device);
    }
}

const pathBase = `j3d/ww`;

class SceneDesc {
    public id: string;

    public constructor(public stageDir: string, public name: string, public rooms: number[] = [0]) {
        this.id = stageDir;

        // Garbage hack.
        if (this.stageDir === 'sea' && rooms.length === 1)
            this.id = `Room${rooms[0]}.arc`;
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const modelCache = new ModelCache();

        // XXX(jstpierre): This is really terrible code.
        modelCache.fetchArchive(`${pathBase}/Object/System.arc`, abortSignal);
        modelCache.fetchArchive(`${pathBase}/Stage/${this.stageDir}/Stage.arc`, abortSignal);

        for (const r of this.rooms) {
            const roomIdx = Math.abs(r);
            modelCache.fetchArchive(`${pathBase}/Stage/${this.stageDir}/Room${roomIdx}.arc`, abortSignal);
        }

        return modelCache.waitForLoad().then(() => {
            const textureHolder = new J3DTextureHolder();

            const systemArc = modelCache.getArchive(`${pathBase}/Object/System.arc`);
            textureHolder.addBTITexture(device, BTI.parse(systemArc.findFileData(`dat/toon.bti`), `ZAtoon`));
            textureHolder.addBTITexture(device, BTI.parse(systemArc.findFileData(`dat/toonex.bti`), `ZBtoonEX`));

            const stageRarc = modelCache.getArchive(`${pathBase}/Stage/${this.stageDir}/Stage.arc`);
            const stageDzs = stageRarc.findFileData(`dzs/stage.dzs`);
            const stageDzsHeaders = parseDZSHeaders(stageDzs);
            const mult = stageDzsHeaders.get('MULT');

            const isSea = this.stageDir === 'sea';
            const isFullSea = isSea && this.rooms.length > 1;
            const renderer = new WindWakerRenderer(device, modelCache, textureHolder, isSea, isFullSea, stageRarc);
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
                const roomRenderer = new WindWakerRoomRenderer(device, renderer.renderHelper, renderer.textureHolder, roomIdx, roomRarc);
                roomRenderer.visible = visible;
                renderer.roomRenderers.push(roomRenderer);

                // HACK: for single-purpose sea levels, translate the objects instead of the model.
                if (isSea && !isFullSea) {
                    mat4.invert(modelMatrix, modelMatrix);
                } else {
                    roomRenderer.setModelMatrix(modelMatrix);
                    mat4.identity(modelMatrix);
                }

                // Now spawn any objects that might show up in it.
                const dzr = roomRarc.findFileData('dzr/room.dzr');
                this.spawnObjectsFromDZR(device, abortSignal, renderer, roomRenderer, dzr, modelMatrix);
            }

            return modelCache.waitForLoad().then(() => {
                renderer.finish(device);
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

    private spawnObjectsForActor(device: GfxDevice, abortSignal: AbortSignal, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, name: string, parameters: number, modelMatrix: mat4): void {
        const modelCache = renderer.modelCache;

        function fetchArchive(objArcName: string): Progressable<RARC.RARC> {
            return renderer.modelCache.fetchArchive(`${pathBase}/Object/${objArcName}`, abortSignal);
        }

        function buildChildModel(rarc: RARC.RARC, modelPath: string): ObjectRenderer {
            const model = modelCache.getModel(device, renderer, rarc, modelPath);
            const modelInstance = new BMDModelInstance(device, renderer.renderHelper, renderer.textureHolder, model);
            modelInstance.name = name;
            modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
            return new ObjectRenderer(modelInstance);
        }

        function buildModel(rarc: RARC.RARC, modelPath: string) {
            const objectRenderer = buildChildModel(rarc, modelPath);
            mat4.copy(objectRenderer.modelMatrix, modelMatrix);
            roomRenderer.objectRenderers.push(objectRenderer);
            return objectRenderer;
        }

        function parseBCK(rarc: RARC.RARC, path: string) { const g = BCK.parse(rarc.findFileData(path)).ank1; g.loopMode = LoopMode.REPEAT; return g; }
        function parseBRK(rarc: RARC.RARC, path: string) { return BRK.parse(rarc.findFileData(path)).trk1; }
        function parseBTK(rarc: RARC.RARC, path: string) { return BTK.parse(rarc.findFileData(path)).ttk1; }
        function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }

        // Tremendous special thanks to LordNed, Sage-of-Mirrors & LugoLunatic for their work on actor mapping
        // Heavily based on https://github.com/LordNed/Winditor/blob/master/Editor/resources/ActorDatabase.json

        if (name === 'item') {
            // Item table provided with the help of the incredible LugoLunatic <3.
            const itemId = (parameters & 0x000000FF);

            // Heart
            if (itemId === 0x00) fetchArchive(`Always.arc`).then((rarc) => buildModel(rarc, `bdlm/vlupl.bdl`));
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
            else console.warn(`Unknown item: ${hexzero(itemId, 2)}`);
        }
        // Hyrule Ocean Warp
        else if (name === 'Ghrwp') fetchArchive(`Ghrwp.arc`).then((rarc) => {
            const a00 = buildModel(rarc, `bdlm/ghrwpa00.bdl`);
            a00.bindTTK1(parseBTK(rarc, `btk/ghrwpa00.btk`));
            const b00 = buildModel(rarc, `bdlm/ghrwpb00.bdl`);
            b00.bindTTK1(parseBTK(rarc, `btk/ghrwpb00.btk`));
            b00.bindTRK1(parseBRK(rarc, `brk/ghrwpb00.brk`));
        });
        // Outset Island: Jabun's barrier (five parts)
        else if (name === 'Ajav') fetchArchive(`Ajav.arc`).then((rarc) => {
            buildModel(rarc, `bdl/ajava.bdl`);
            buildModel(rarc, `bdl/ajavb.bdl`);
            buildModel(rarc, `bdl/ajavc.bdl`);
            buildModel(rarc, `bdl/ajavd.bdl`);
            buildModel(rarc, `bdl/ajave.bdl`);
            buildModel(rarc, `bdl/ajavf.bdl`);
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
        else if (name === 'Ba1') fetchArchive(`Ba.arc`).then((rarc) => buildModel(rarc, `bdlm/ba.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
        // Salvatore
        else if (name === 'Kg1' || name === 'Kg2') fetchArchive(`Kg.arc`).then((rarc) => buildModel(rarc, `bdlm/kg.bdl`).bindANK1(parseBCK(rarc, `bcks/kg_wait01.bck`)));
        // Orca
        else if (name === 'Ji1') fetchArchive(`Ji.arc`).then((rarc) => buildModel(rarc, `bdlm/ji.bdl`).bindANK1(parseBCK(rarc, `bck/ji_wait01.bck`)));
        // Medli
        else if (name === 'Md1') fetchArchive(`Md.arc`).then((rarc) => buildModel(rarc, `bdlm/md.bdl`).bindANK1(parseBCK(rarc, `bcks/md_wait01.bck`)));
        // Makar
        else if (name === 'Cb1') fetchArchive(`Cb.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/cb.bdl`);
            buildChildModel(rarc, `bdl/cb_face.bdl`).setParentJoint(m, `backbone`);
            m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
        });
        // The King of Hyrule
        else if (name === 'Hi1') fetchArchive(`Hi.arc`).then((rarc) => buildModel(rarc, `bdlm/hi.bdl`).bindANK1(parseBCK(rarc, `bcks/hi_wait01.bck`)));
        // Princess Zelda
        else if (name === 'p_zelda') fetchArchive(`Pz.arc`).then((rarc) => buildModel(rarc, `bdlm/pz.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
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
            const m = buildModel(rarc, `bdlm/ym.bdl`);
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
            const m = buildModel(rarc, `bdlm/ko.bdl`);
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
            const m = buildModel(rarc, `bdl/p1.bdl`);
            buildChildModel(rarc, `bdlm/p1b_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
        });
        // Nudge
        else if (name === 'P1c') fetchArchive(`P1.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/p1.bdl`);
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
            const m = buildModel(rarc, `bdl/p2.bdl`);
            buildChildModel(rarc, `bdlm/p2head02.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
        });
        // Mako
        else if (name === 'P2c') fetchArchive(`P2.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/p2.bdl`);
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
            const m = buildModel(rarc, `bdl/sa.bdl`);
            buildChildModel(rarc, `bdlm/sa02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
        });
        // Kane
        else if (name === 'Sa3') fetchArchive(`Sa.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/sa.bdl`);
            buildChildModel(rarc, `bdlm/sa03_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
        });
        // Candy
        else if (name === 'Sa4') fetchArchive(`Sa.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/sa.bdl`);
            buildChildModel(rarc, `bdlm/sa04_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
        });
        // Dampa
        else if (name === 'Sa5') fetchArchive(`Sa.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/sa.bdl`);
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
            const m = buildModel(rarc, `bdl/ug.bdl`);
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
            const m = buildModel(rarc, `bdlm/uk.bdl`);
            buildChildModel(rarc, `bdlm/ukhead_c.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
        });
        // Jun-Roberto
        else if (name === 'UkD') fetchArchive(`Uk.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/uk.bdl`);
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
            const m = buildModel(rarc, `bdl/uw.bdl`);
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
            const m = buildModel(rarc, `bdl/um.bdl`);
            buildChildModel(rarc, `bdlm/um02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
        });
        // Kamo
        else if (name === 'Um3') fetchArchive(`Um.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/um.bdl`);
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
            const m = buildModel(rarc, `bdl/uo.bdl`);
            buildChildModel(rarc, `bdlm/uo02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
        });
        // Garrickson
        else if (name === 'Uo3') fetchArchive(`Uo.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/uo.bdl`);
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
            const m = buildModel(rarc, `bdl/ub.bdl`);
            buildChildModel(rarc, `bdlm/ub02_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
        });
        // Missy
        else if (name === 'Ub3') fetchArchive(`Ub.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/ub.bdl`);
            buildChildModel(rarc, `bdlm/ub03_head.bdl`).setParentJoint(m, `head`);
            m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
        });
        // Mineco
        else if (name === 'Ub4') fetchArchive(`Ub.arc`).then((rarc) => {
            const m = buildModel(rarc, `bdl/ub.bdl`);
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
        else if (name === 'lwood') fetchArchive(`Lwood.arc`).then((rarc) => buildModel(rarc, `bdl/alwd.bdl`));
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
        else if (name === 'Kanban') fetchArchive(`Kanban.arc`).then((rarc) => buildModel(rarc, `bdl/kanban.bdl`));
        // Doors: TODO(jstpierre)
        else if (name === 'KNOB00') return;
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
        else if (name === 'Ygstp00') fetchArchive(`Ygush00.arc`).then((rarc) => buildModel(rarc, `bdlm/ygstp00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygstp00.btk`)));
        else if (name === 'Ytrnd00') fetchArchive(`Trnd.arc`).then((rarc) => {
            buildModel(rarc, `bdlm/ytrnd00.bdl`).bindTTK1(parseBTK(rarc, `btk/ytrnd00.btk`));
            buildModel(rarc, `bdlm/ywuwt00.bdl`).bindTTK1(parseBTK(rarc, `btk/ywuwt00.btk`));
        });
        else if (name === 'Sarace') fetchArchive(`Sarace.arc`).then((rarc) => buildModel(rarc, `bdl/sa.bdl`));
        else if (name === 'Ocloud') fetchArchive(`BVkumo.arc`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)));
        // Triangle Island Statue: TODO(jstpierre): finish the submodels
        else if (name === 'Doguu') fetchArchive(`Doguu.arc`).then((rarc) => buildModel(rarc, `bdlm/vgsma.bdl`));
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
        else if (name === 'AjavW') fetchArchive(`AjavW.arc`).then((rarc) => buildModel(rarc, `bdlm/ajavw.bdl`).bindTTK1(parseBTK(rarc, `btk/ajavw.btk`)));
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
        // Grass. Procedurally generated by the engine.
        else if (name === 'kusax1' || name === 'kusax7' || name === 'kusax21') return;
        // Flowers. Procedurally generated by the engine.
        else if (name === 'flower' || name === 'flwr7' || name === 'flwr17' || name === 'pflwrx7' || name === 'pflower') return
        // Bushes. Procedurally generated by the engine.
        else if (name === 'woodb' || name === 'woodbx') return;
        // Small trees. Procedurally generated by the engine.
        else if (name === 'swood' || name === 'swood3' || name === 'swood5') return;
        // Rope. Procedurally generated by the engine.
        else if (name === 'RopeR') return;
        // Bridges. Procedurally generated by the engine.
        else if (name === 'bridge') return;
        // Logic flags used for gameplay, not spawnable objects.
        else if (name === 'AND_SW0' || name === 'AND_SW1' || name === 'AND_SW2' || name === 'SW_HIT0' || name === 'ALLdie') return;
        // EVent SWitch
        else if (name === 'Evsw') return;
        // Tags for fishmen?
        else if (name === 'TagSo' || name === 'TagMSo') return;
        // Photo tags
        else if (name === 'TagPo') return;
        // Light tags
        else if (name === 'LTag0' || name === 'LTag1' || name === 'LTagR0') return;
        // Other tags?
        else if (name === 'ky_tag2' || name === 'kytag6' || name === 'kytag7') return;
        // Flags (only contains textures)
        else if (name === 'SieFlag' || name === 'Gflag') return;
        else
            console.warn(`Unknown object: ${name} ${hexzero(parameters, 8)}`);
    }

    private spawnObjectsFromTGOBLayer(device: GfxDevice, abortSignal: AbortSignal, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, buffer: ArrayBufferSlice, tgobHeader: DZSChunkHeader | undefined, modelMatrix: mat4): void {
        if (tgobHeader === undefined)
            return;

        const view = buffer.createDataView();

        let actrTableIdx = tgobHeader.offs;
        for (let i = 0; i < tgobHeader.count; i++) {
            const name = readString(buffer, actrTableIdx + 0x00, 0x08, true);
            const parameters = view.getUint32(actrTableIdx + 0x08, false);
            const posX = view.getFloat32(actrTableIdx + 0x0C);
            const posY = view.getFloat32(actrTableIdx + 0x10);
            const posZ = view.getFloat32(actrTableIdx + 0x14);
            const rotY = view.getInt16(actrTableIdx + 0x1A) / 0x7FFF * Math.PI;

            const m = mat4.create();
            mat4.rotateY(m, m, rotY);
            m[12] += posX;
            m[13] += posY;
            m[14] += posZ;
            mat4.mul(m, modelMatrix, m);

            this.spawnObjectsForActor(device, abortSignal, renderer, roomRenderer, name, parameters, m);

            actrTableIdx += 0x20;
        }
    }

    private spawnObjectsFromACTRLayer(device: GfxDevice, abortSignal: AbortSignal, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, buffer: ArrayBufferSlice, actrHeader: DZSChunkHeader | undefined, modelMatrix: mat4): void {
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
            // const rotX = view.getInt16(actrTableIdx + 0x18) / 0x7FFF;
            const rotY = view.getInt16(actrTableIdx + 0x1A) / 0x7FFF * Math.PI;
            const flag = view.getUint16(actrTableIdx + 0x1C);
            const enemyNum = view.getUint16(actrTableIdx + 0x1E);

            const m = mat4.create();
            mat4.rotateY(m, m, rotY);
            m[12] += posX;
            m[13] += posY;
            m[14] += posZ;
            mat4.mul(m, modelMatrix, m);

            this.spawnObjectsForActor(device, abortSignal, renderer, roomRenderer, name, parameters, m);

            actrTableIdx += 0x20;
        }
    }

    private spawnObjectsFromDZR(device: GfxDevice, abortSignal: AbortSignal, renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, buffer: ArrayBufferSlice, modelMatrix: mat4): void {
        const chunkHeaders = parseDZSHeaders(buffer);

        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACTR'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT0'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT1'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT2'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT3'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT4'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT5'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT6'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT7'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT8'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACT9'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACTA'), modelMatrix);
        this.spawnObjectsFromACTRLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('ACTB'), modelMatrix);

        this.spawnObjectsFromTGOBLayer(device, abortSignal, renderer, roomRenderer, buffer, chunkHeaders.get('TGOB'), modelMatrix);
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
