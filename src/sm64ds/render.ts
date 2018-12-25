
import { mat2d, mat4, vec3 } from 'gl-matrix';

import * as BYML from '../byml';
import * as LZ77 from './lz77';
import * as NITRO_BMD from './nitro_bmd';
import * as NITRO_GX from './nitro_gx';

import * as Viewer from '../viewer';

import { DeviceProgram } from '../Program';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { computeModelMatrixYBillboard, computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';
import { GfxFormat, GfxBufferUsage, GfxBufferFrequencyHint, GfxBlendMode, GfxBlendFactor, GfxDevice, GfxHostAccessPass, GfxProgram, GfxBindingLayoutDescriptor, GfxBuffer, GfxVertexAttributeFrequency, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxRenderPass, GfxInputState, GfxInputLayout, GfxVertexAttributeDescriptor } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x3, fillMatrix4x4, fillMatrix3x2 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst, makeSortKeyOpaque } from '../gfx/render/GfxRenderer';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import GfxArena from '../gfx/helpers/GfxArena';
import { getFormatName, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT } from './nitro_tex';

export class NITRO_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_UV = 1;
    public static a_Color = 2;

    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PacketParams = 2;

    public vert = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    mat4x2 u_TexMtx[1];
};

layout(row_major, std140) uniform ub_PacketParams {
    mat4x3 u_ModelView;
};

layout(location = ${NITRO_Program.a_Position}) in vec3 a_Position;
layout(location = ${NITRO_Program.a_UV}) in vec2 a_UV;
layout(location = ${NITRO_Program.a_Color}) in vec4 a_Color;
out vec4 v_Color;
out vec2 v_UV;

void main() {
    gl_Position = u_Projection * mat4(u_ModelView) * vec4(a_Position, 1.0);
    v_Color = a_Color;
    v_UV = (u_TexMtx[0] * vec4(a_UV, 1.0, 1.0)).st;
}
`;
    public frag = `
precision mediump float;
in vec2 v_UV;
in vec4 v_Color;
uniform sampler2D u_Texture;

void main() {
    gl_FragColor = texture2D(u_Texture, v_UV);
    gl_FragColor *= v_Color;
    if (gl_FragColor.a == 0.0)
        discard;
}
`;
}

function textureToCanvas(bmdTex: NITRO_BMD.Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = bmdTex.width;
    canvas.height = bmdTex.height;
    canvas.title = bmdTex.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(bmdTex.pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getFormatName(bmdTex.format));
    return { name: bmdTex.name, surfaces, extraInfo };
}

interface Animation {
    updateModelMatrix(time: number, modelMatrix: mat4): void;
}

class YSpinAnimation {
    constructor(public speed: number, public phase: number) {}

    public updateModelMatrix(time: number, modelMatrix: mat4) {
        const theta = this.phase + (time / 30 * this.speed);
        mat4.rotateY(modelMatrix, modelMatrix, theta);
    }
}

export class NITROTextureHolder extends TextureHolder<NITRO_BMD.Texture> {
    public addTextureGfx(device: GfxDevice, texture: NITRO_BMD.Texture): LoadedTexture {
        const gfxTexture = device.createTexture(GfxFormat.U8_RGBA, texture.width, texture.height, 1);
        device.setResourceName(gfxTexture, texture.name);

        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);

        device.submitPass(hostAccessPass);
        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

export class Command_VertexData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public templateRenderInst: GfxRenderInst;
    public renderInsts: GfxRenderInst[] = [];
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, public vertexData: NITRO_GX.VertexData, name: string) {
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.vertexData.packedVertexBuffer.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.vertexData.indexBuffer.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: NITRO_Program.a_Position, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_Color, format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 3*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_UV, format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 7*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];

        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: NITRO_GX.VERTEX_BYTES },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 });

        this.templateRenderInst.inputState = this.inputState;
        this.templateRenderInst.name = name;

        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, NITRO_Program.ub_PacketParams);

        for (let i = 0; i < this.vertexData.drawCalls.length; i++) {
            const renderInst = renderInstBuilder.pushRenderInst();
            renderInst.drawIndexes(this.vertexData.drawCalls[i].numIndices, this.vertexData.drawCalls[i].startIndex);
            this.renderInsts.push(renderInst);
        }

        renderInstBuilder.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

const enum SM64DSPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const scratchModelMatrix = mat4.create();
const scratchViewMatrix = mat4.create();
class BMDRenderer {
    public bmd: NITRO_BMD.BMD;
    public crg1Level: CRG1Level;
    public isSkybox: boolean;
    public localMatrix: mat4;
    public animation: Animation = null;

    private gfxProgram: GfxProgram;
    private templateRenderInst: GfxRenderInst;
    private vertexDataCommands: Command_VertexData[] = [];
    private prepareToRenderFuncs: ((hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput) => void)[] = [];
    private arena = new GfxArena();

    private sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
    private materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
    private packetParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_PacketParams`);

    constructor(device: GfxDevice, public textureHolder: NITROTextureHolder, bmd: NITRO_BMD.BMD, crg1Level: CRG1Level) {
        this.bmd = bmd;
        this.crg1Level = crg1Level;
        this.isSkybox = false;

        this.textureHolder.addTexturesGfx(device, bmd.textures);

        this.gfxProgram = device.createProgram(new NITRO_Program());

        const scaleFactor = this.bmd.scaleFactor;
        this.localMatrix = mat4.create();
        mat4.fromScaling(this.localMatrix, [scaleFactor, scaleFactor, scaleFactor]);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(this.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_SceneParams], 16);
        let offs = this.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_SceneParams];
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        this.templateRenderInst.passMask = this.isSkybox ? SM64DSPass.SKYBOX : SM64DSPass.MAIN;

        for (let i = 0; i < this.prepareToRenderFuncs.length; i++)
            this.prepareToRenderFuncs[i](hostAccessPass, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.packetParamsBuffer.prepareToRender(hostAccessPass);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        const programReflection = device.queryProgram(this.gfxProgram);
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [];
        bindingLayouts[NITRO_Program.ub_SceneParams]    = { numUniformBuffers: 1, numSamplers: 0 };
        bindingLayouts[NITRO_Program.ub_MaterialParams] = { numUniformBuffers: 1, numSamplers: 1 };
        bindingLayouts[NITRO_Program.ub_PacketParams]   = { numUniformBuffers: 1, numSamplers: 0 };
        const renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [this.sceneParamsBuffer, this.materialParamsBuffer, this.packetParamsBuffer]);
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.gfxProgram = this.gfxProgram;
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, NITRO_Program.ub_SceneParams);
        this.translateBMD(device, renderInstBuilder, this.bmd);
        renderInstBuilder.popTemplateRenderInst();
        renderInstBuilder.finish(device, viewRenderer);
    }

    private translateMaterial(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, material: NITRO_BMD.Material) {
        const texture = material.texture;
        const templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        const textureMapping = new TextureMapping();

        if (texture !== null) {
            this.textureHolder.fillTextureMapping(textureMapping, texture.name);
            textureMapping.gfxSampler = this.arena.trackSampler(device.createSampler({
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.NO_MIP,
                wrapS: parseTexImageParamWrapModeS(material.texParams),
                wrapT: parseTexImageParamWrapModeT(material.texParams),
                minLOD: 0,
                maxLOD: 100,
            }));
        }

        templateRenderInst.setSamplerBindingsFromTextureMappings([textureMapping]);

        // Find any possible material animations.
        const crg1mat = this.crg1Level ? this.crg1Level.TextureAnimations.find((c) => c.MaterialName === material.name) : undefined;
        const texAnimMat = mat2d.clone(material.texCoordMat);

        templateRenderInst.renderFlags.set({
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            depthWrite: material.depthWrite,
            cullMode: material.cullMode,
        });

        renderInstBuilder.newUniformBufferInstance(templateRenderInst, NITRO_Program.ub_MaterialParams);

        const layer = material.isTranslucent ? 1 : 0;
        const programKey = device.queryProgram(this.gfxProgram).uniqueKey;
        templateRenderInst.sortKey = makeSortKeyOpaque(layer, programKey);

        return (hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput) => {
            function selectArray(arr: Float32Array, time: number): number {
                return arr[(time | 0) % arr.length];
            }

            if (crg1mat !== undefined) {
                const time = viewerInput.time / 30;
                const scale = selectArray(crg1mat.Scale, time);
                const rotation = selectArray(crg1mat.Rotation, time);
                const x = selectArray(crg1mat.X, time);
                const y = selectArray(crg1mat.Y, time);
                mat2d.identity(texAnimMat);
                mat2d.scale(texAnimMat, texAnimMat, [scale, scale, scale]);
                mat2d.rotate(texAnimMat, texAnimMat, rotation / 180 * Math.PI);
                mat2d.translate(texAnimMat, texAnimMat, [-x, y, 0]);
                mat2d.mul(texAnimMat, texAnimMat, material.texCoordMat);
            }

            if (texture !== null) {
                const materialParamsMapped = this.materialParamsBuffer.mapBufferF32(templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_MaterialParams], 8);
                let offs = templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_MaterialParams];
                offs += fillMatrix3x2(materialParamsMapped, offs, texAnimMat);
            }
        };
    }

    public computeModelView(viewerInput: Viewer.ViewerRenderInput, isBillboard: boolean): mat4 {
        // Build model matrix
        const modelMatrix = scratchModelMatrix;
        if (isBillboard) {
            // Apply billboard model if necessary.
            computeModelMatrixYBillboard(modelMatrix, viewerInput.camera);
            mat4.mul(modelMatrix, this.localMatrix, modelMatrix);
        } else {
            mat4.copy(modelMatrix, this.localMatrix);
        }

        if (this.animation !== null)
            this.animation.updateModelMatrix(viewerInput.time, modelMatrix);

        // Build view matrix
        const viewMatrix = scratchViewMatrix;
        if (this.isSkybox) {
            computeViewMatrixSkybox(viewMatrix, viewerInput.camera);
        } else {
            computeViewMatrix(viewMatrix, viewerInput.camera);
        }

        mat4.mul(viewMatrix, viewMatrix, modelMatrix);
        return viewMatrix;
    }

    private translateBatch(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, model: NITRO_BMD.Model, batch: NITRO_BMD.Batch): void {
        const materialPrepareToRenderFunc = this.translateMaterial(device, renderInstBuilder, batch.material);
        const vertexDataCommand = new Command_VertexData(device, renderInstBuilder, batch.vertexData, model.name);
        this.vertexDataCommands.push(vertexDataCommand);
        renderInstBuilder.popTemplateRenderInst();

        const prepareToRenderFunc = (hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput) => {
            materialPrepareToRenderFunc(hostAccessPass, viewerInput);

            const packetParamsMapped = this.packetParamsBuffer.mapBufferF32(vertexDataCommand.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_PacketParams], 12);
            let offs = vertexDataCommand.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_PacketParams];
            offs += fillMatrix4x3(packetParamsMapped, offs, this.computeModelView(viewerInput, model.billboard));
        };

        this.prepareToRenderFuncs.push(prepareToRenderFunc);
    }

    private translateBMD(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, bmd: NITRO_BMD.BMD) {
        for (const model of bmd.models)
            for (const batch of model.batches)
                this.translateBatch(device, renderInstBuilder, model, batch);
    }

    public destroy(device: GfxDevice) {
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.packetParamsBuffer.destroy(device);
        for (let i = 0; i < this.vertexDataCommands.length; i++)
            this.vertexDataCommands[i].destroy(device);
        this.arena.destroy(device);
    }
}

class SM64DSRenderer implements Viewer.Scene_Device {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();

    constructor(device: GfxDevice, public textureHolder: NITROTextureHolder, public mainBMD: BMDRenderer, public skyboxBMD: BMDRenderer, public extraBMDs: BMDRenderer[]) {
        this.mainBMD.addToViewRenderer(device, this.viewRenderer);
        if (this.skyboxBMD !== null)
            this.skyboxBMD.addToViewRenderer(device, this.viewRenderer);
        for (let i = 0; i < this.extraBMDs.length; i++)
            this.extraBMDs[i].addToViewRenderer(device, this.viewRenderer);
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.mainBMD.prepareToRender(hostAccessPass, viewerInput);
        if (this.skyboxBMD !== null)
            this.skyboxBMD.prepareToRender(hostAccessPass, viewerInput);
        for (let i = 0; i < this.extraBMDs.length; i++)
            this.extraBMDs[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, SM64DSPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, SM64DSPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);

        this.mainBMD.destroy(device);
        if (this.skyboxBMD)
            this.skyboxBMD.destroy(device);
        for (let i = 0; i < this.extraBMDs.length; i++)
            this.extraBMDs[i].destroy(device);
    }
}

interface CRG1TextureAnimation {
    MaterialName: string;
    Duration: number;
    Scale: Float32Array;
    Rotation: Float32Array;
    X: Float32Array;
    Y: Float32Array;
}

interface CRG1Object {
    Area: number;
    Setup: number;
    ObjectId: number;
    Position: { X: number, Y: number, Z: number };
    Rotation: { Y: number };
    Parameters: number[];
}

interface CRG1Level {
    MapBmdFile: string;
    VrboxBmdFile: string;
    TextureAnimations: CRG1TextureAnimation[];
    Objects: CRG1Object[];
}

interface Sm64DSCRG1 {
    Levels: CRG1Level[];
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public levelId: number;

    constructor(name: string, levelId: number) {
        this.name = name;
        this.levelId = levelId;
        this.id = '' + this.levelId;
    }

    public createScene_Device(device: GfxDevice): Progressable<Viewer.Scene_Device> {
        return fetchData('data/sm64ds/sm64ds.crg1').then((result: ArrayBufferSlice) => {
            const crg1 = BYML.parse<Sm64DSCRG1>(result, BYML.FileType.CRG1);
            const textureHolder = new NITROTextureHolder();
            return this._createSceneFromCRG1(device, textureHolder, crg1);
        });
    }

    private _createBMDRenderer(device: GfxDevice, textureHolder: NITROTextureHolder, filename: string, scale: number, level: CRG1Level, isSkybox: boolean): PromiseLike<BMDRenderer> {
        return fetchData(`data/sm64ds/${filename}`).then((result: ArrayBufferSlice) => {
            result = LZ77.maybeDecompress(result);
            const bmd = NITRO_BMD.parse(result);
            const renderer = new BMDRenderer(device, textureHolder, bmd, level);
            mat4.scale(renderer.localMatrix, renderer.localMatrix, [scale, scale, scale]);
            renderer.isSkybox = isSkybox;
            return renderer;
        });
    }

    private _createBMDObjRenderer(device: GfxDevice, textureHolder: NITROTextureHolder, filename: string, translation: vec3, rotationY: number, scale: number = 1, spinSpeed: number = 0): PromiseLike<BMDRenderer> {
        return fetchData(`data/sm64ds/${filename}`).then((result: ArrayBufferSlice) => {
            result = LZ77.maybeDecompress(result);
            const bmd = NITRO_BMD.parse(result);
            const renderer = new BMDRenderer(device, textureHolder, bmd, null);
            vec3.scale(translation, translation, 16 / bmd.scaleFactor);
            mat4.translate(renderer.localMatrix, renderer.localMatrix, translation);
            mat4.rotateY(renderer.localMatrix, renderer.localMatrix, rotationY);
            mat4.scale(renderer.localMatrix, renderer.localMatrix, [scale, scale, scale]);

            if (spinSpeed > 0) {
                const spinPhase = Math.random() * Math.PI * 2;
                renderer.animation = new YSpinAnimation(spinSpeed, spinPhase);
            }

            return renderer;
        });
    }

    private _createBMDRendererForObject(device: GfxDevice, textureHolder: NITROTextureHolder, object: CRG1Object): PromiseLike<BMDRenderer> {
        const translation = vec3.fromValues(object.Position.X, object.Position.Y, object.Position.Z);
        // WTF is with the Tau? And the object scales?
        vec3.scale(translation, translation, Math.PI * 2);

        const rotationY = object.Rotation.Y / 180 * Math.PI;

        switch (object.ObjectId) {
        case 7: // Up/down lift thingy
        case 9: // Pathlift?
        case 10: // Chain Chomp (copy/pasted)
        case 13: // LONELY ROLLING BALL
        case 15: // Goomba
        case 19: // Bob-omb
        case 20: // Friendly Bob-omb
        case 21: // Koopa
            return null;
        case 23: // Brick Block
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_block/broken_block_l.bmd`, translation, rotationY, 0.8);
        case 24: // Brick Block Larger
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_block/broken_block_l.bmd`, translation, rotationY, 1.2);
        case 26: // Powerup inside block?
        case 29: // Cannon hatch
            return null;
        case 30: // Item Block
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_hatena_box/hatena_box.bmd`, translation, rotationY, 0.8);
        case 36: // Pole
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_pile/pile.bmd`, translation, rotationY, 0.8);
        case 37: // Coin
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/coin/coin_poly32.bmd`, translation, rotationY, 0.8, 0.1);
        case 38: // Red Coin
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/coin/coin_red_poly32.bmd`, translation, rotationY, 0.8, 0.1);
        case 39: // Blue Coin
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/coin/coin_blue_poly32.bmd`, translation, rotationY, 0.8, 0.1);
        case 41: { // Tree
            const treeType = (object.Parameters[0] >>> 4) & 0x07;
            const treeFilenames = ['bomb', 'toge', 'yuki', 'yashi', 'castle', 'castle', 'castle', 'castle'];
            const filename = `normal_obj/tree/${treeFilenames[treeType]}_tree.bmd`;
            return this._createBMDObjRenderer(device, textureHolder, filename, translation, rotationY);
        }
        case 42: { // Castle Painting
            const painting = (object.Parameters[0] >>> 8) & 0x1F;
            const filenames = [
                'for_bh', 'for_bk', 'for_ki', 'for_sm', 'for_cv_ex5', 'for_fl', 'for_dl', 'for_wl', 'for_sl', 'for_wc',
                'for_hm', 'for_hs', 'for_td_tt', 'for_ct', 'for_ex_mario', 'for_ex_luigi', 'for_ex_wario', 'for_vs_cross', 'for_vs_island',
            ];
            const filename = `picture/${filenames[painting]}.bmd`;
            const scale = ((object.Parameters[0] & 0xF) + 1);
            translation[1] += scale * 0.3;
            return this._createBMDObjRenderer(device, textureHolder, filename, translation, rotationY, scale);
        }
        case 43: // Switch
        case 44: // Switch-powered Star
        case 45: // Switch-powered Trapdoor
        case 48: // Chain Chomp Unchained
        case 49: // 1-up
        case 50: // Cannon
        case 51: // Chain-chomp fence (BoB)
        case 52: // Water bombs (BoB)
        case 53: // Birds
        case 54: // Fish
        case 55: // Butterflies
        case 56: // Super Bob Fuckan Omb Bob-Omb In BoB (the summit)
        case 59: // Pirahna Plant
        case 60: // Star Camera Path
        case 61: // Star Target
            return null;
        case 62: // Silver Star
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/star/obj_star_silver.bmd`, translation, rotationY, 0.8, 0.08);
        case 63: // Star
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/star/obj_star.bmd`, translation, rotationY, 0.8, 0.08);
        case 64: // Whomp
        case 65: // Big Whomp
        case 66: // Thwomp
        case 67: // Boo
        case 74: // Minigame Cabinet Trigger (Invisible)
            return null;
        case 75: // Wall sign
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_kanban/obj_kanban.bmd`, translation, rotationY, 0.8);
        case 76: // Signpost
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_tatefuda/obj_tatefuda.bmd`, translation, rotationY, 0.8);
        case 79: // Heart
        case 80: // Toad
        case 167: // Peach's Castle Tippy TTC Hour Hand
        case 168: // Peach's Castle Tippy TTC Minute Hand
        case 169: // Peach's Castle Tippy TTC Pendulum
            return null;
        case 187: // Left Arrow Sign
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_yajirusi_l/yajirusi_l.bmd`, translation, rotationY, 0.8);
        case 188: // Right Arrow Sign
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_yajirusi_r/yajirusi_r.bmd`, translation, rotationY, 0.8);
        case 196: // WF
        case 197: // WF
        case 198: // WF
        case 199: // WF
        case 200: // WF
        case 201: // WF
        case 202: // WF
        case 203: // WF Tower
            return null;
        case 204: // WF Spinning Island
            return this._createBMDObjRenderer(device, textureHolder, `special_obj/bk_ukisima/bk_ukisima.bmd`, translation, rotationY, 1, 0.1);
        case 205: // WF
        case 206: // WF
        case 207: // WF
        case 208: // WF
        case 209: // WF
        case 228: // Switch Pillar
        case 237: // MIPS
        case 239: // That Stupid Owl™
        case 243: // Invisible pole hitbox
        case 244: // Lakitu
        case 254: // Mario's Iconic Cap
        case 264: // Red Flame
        case 265: // Blue Flame
        case 269: // 1-Up Mushroom Inside Block
        case 270: // Some brick thing?
        case 273: // Peach's Castle First Floor Trapdoor
        case 274: // Peach's Castle First Floor Light Beam
        case 275: // Peach's Castle First Floor Peach/Bowser Fade Painting
        case 281: // Koopa the Quick
        case 282: // Koopa the Quick Finish Flag
            return null;
        case 284: // Wario Block
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/obj_block/broken_block_ll.bmd`, translation, rotationY);
        case 293: // Water
            return this._createBMDObjRenderer(device, textureHolder, `special_obj/mc_water/mc_water.bmd`, translation, rotationY, 0.8);
        case 295: // Metal net
            return this._createBMDObjRenderer(device, textureHolder, `special_obj/mc_metalnet/mc_metalnet.bmd`, translation, rotationY, 0.8);
        case 298: // Flag
            return this._createBMDObjRenderer(device, textureHolder, `special_obj/mc_flag/mc_flag.bmd`, translation, rotationY, 0.8);
        case 303: // Castle Basement Water
        case 304: // Secret number thingy
            return null;
        case 305: // Blue Coin Switch
            return this._createBMDObjRenderer(device, textureHolder, `normal_obj/b_coin_switch/b_coin_switch.bmd`, translation, rotationY, 0.8);
        case 314: // Hidden Pirahna Plant
        case 315: // Enemy spawner trigger
        case 316: // Enemy spawner
        case 323: // Ambient sound effects
        case 324: // Music
        case 511: // Appears to be a bug in the level layout
            return null;
        default:
            console.warn(`Unknown object type ${object.ObjectId}`);
            return null;
        }
    }

    private _createSceneFromCRG1(device: GfxDevice, textureHolder: NITROTextureHolder, crg1: Sm64DSCRG1): PromiseLike<Viewer.Scene_Device> {
        const level = crg1.Levels[this.levelId];
        const renderers = [this._createBMDRenderer(device, textureHolder, level.MapBmdFile, 100, level, false)];
        if (level.VrboxBmdFile)
            renderers.push(this._createBMDRenderer(device, textureHolder, level.VrboxBmdFile, 0.8, level, true));
        else
            renderers.push(Promise.resolve(null));
        for (const object of level.Objects) {
            const objRenderer = this._createBMDRendererForObject(device, textureHolder, object);
            if (objRenderer)
            renderers.push(objRenderer);
        }
        return Promise.all(renderers).then(([mainBMD, skyboxBMD, ...extraBMDs]) => {
            return new SM64DSRenderer(device, textureHolder, mainBMD, skyboxBMD, extraBMDs);
        });
    }
}
