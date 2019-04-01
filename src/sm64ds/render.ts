
import { mat2d, mat4, vec3 } from 'gl-matrix';

import * as BYML from '../byml';
import * as LZ77 from './lz77';
import * as NITRO_BMD from './nitro_bmd';
import * as NITRO_GX from './nitro_gx';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import { DeviceProgram } from '../Program';
import Progressable from '../Progressable';
import { fetchData, getDataURLForPath } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { computeModelMatrixYBillboard, computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';
import { GfxFormat, GfxBufferUsage, GfxBufferFrequencyHint, GfxBlendMode, GfxBlendFactor, GfxDevice, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxBuffer, GfxVertexAttributeFrequency, GfxTexFilterMode, GfxMipFilterMode, GfxRenderPass, GfxInputState, GfxInputLayout, GfxVertexAttributeDescriptor, GfxTextureDimension } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x3, fillMatrix4x4, fillVec4, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { BasicRenderTarget, depthClearRenderPassDescriptor, transparentBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import GfxArena from '../gfx/helpers/GfxArena';
import { getFormatName, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT, Format } from './nitro_tex';
import { assert } from '../util';
import { RENDER_HACKS_ICON } from '../bk/scenes';

export class NITRO_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_UV = 1;
    public static a_Color = 2;
    public static a_Normal = 3;

    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PacketParams = 2;

    public static both = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    Mat4x2 u_TexMtx[1];
    vec4 u_Misc0;
};
#define u_TexCoordMode (u_Misc0.x)

layout(row_major, std140) uniform ub_PacketParams {
    Mat4x3 u_ModelView;
    vec4 u_Misc1;
};
#define u_PosScale (u_Misc1.x)

uniform sampler2D u_Texture;
`;

    public both = NITRO_Program.both;

    public vert = `
layout(location = ${NITRO_Program.a_Position}) in vec3 a_Position;
layout(location = ${NITRO_Program.a_UV}) in vec2 a_UV;
layout(location = ${NITRO_Program.a_Color}) in vec4 a_Color;
layout(location = ${NITRO_Program.a_Normal}) in vec3 a_Normal;
out vec4 v_Color;
out vec2 v_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position * u_PosScale, 1.0)));
    v_Color = a_Color;

    vec2 t_TexSpaceCoord;
    if (u_TexCoordMode == 2.0) { // TexCoordMode.NORMAL
        v_TexCoord = Mul(u_TexMtx[0], vec4(a_Normal, 1.0)).st;
    } else {
        v_TexCoord = Mul(u_TexMtx[0], vec4(a_UV, 1.0, 1.0)).st;
    }
}
`;
    public frag = `
precision mediump float;
in vec2 v_TexCoord;
in vec4 v_Color;

void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);

#ifdef USE_TEXTURE
    gl_FragColor *= texture2D(u_Texture, v_TexCoord);
#endif

#ifdef USE_VERTEX_COLOR
    gl_FragColor *= v_Color;
#endif

    if (gl_FragColor.a == 0.0)
        discard;
}
`;

    public static programReflection = DeviceProgram.parseReflectionDefinitions(NITRO_Program.both);
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
    updateNormalMatrix(time: number, normalMatrix: mat4): void;
}

class YSpinAnimation {
    constructor(public speed: number, public phase: number) {}

    public updateNormalMatrix(time: number, normalMatrix: mat4) {
        const theta = this.phase + (time / 30 * this.speed);
        mat4.rotateY(normalMatrix, normalMatrix, theta);
    }

    public updateModelMatrix(time: number, modelMatrix: mat4) {
        this.updateNormalMatrix(time, modelMatrix);
    }
}

export class NITROTextureHolder extends TextureHolder<NITRO_BMD.Texture> {
    public loadTexture(device: GfxDevice, texture: NITRO_BMD.Texture): LoadedTexture {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: 1,
        });
        device.setResourceName(gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
        device.submitPass(hostAccessPass);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

export class VertexData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public nitroVertexData: NITRO_GX.VertexData) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.nitroVertexData.packedVertexBuffer.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.nitroVertexData.indexBuffer.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: NITRO_Program.a_Position, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_Color, format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 3*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_UV, format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 7*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_Normal, format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 9*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];

        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: NITRO_GX.VERTEX_BYTES },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

export class Command_VertexData {
    public templateRenderInst: GfxRenderInst;
    public renderInsts: GfxRenderInst[] = [];

    constructor(renderInstBuilder: GfxRenderInstBuilder, public vertexData: VertexData, name: string) {
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.setSamplerBindingsInherit();
        this.templateRenderInst.inputState = this.vertexData.inputState;
        this.templateRenderInst.name = name;

        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, NITRO_Program.ub_PacketParams);

        const nitroData = this.vertexData.nitroVertexData;
        for (let i = 0; i < nitroData.drawCalls.length; i++) {
            const renderInst = renderInstBuilder.pushRenderInst();
            renderInst.setSamplerBindingsInherit();
            renderInst.drawIndexes(nitroData.drawCalls[i].numIndices, nitroData.drawCalls[i].startIndex);
            this.renderInsts.push(renderInst);
        }

        renderInstBuilder.popTemplateRenderInst();
    }
}

function mat4_from_mat2d(dst: mat4, m: mat2d): void {
    const ma = m[0], mb = m[1];
    const mc = m[2], md = m[3];
    const mx = m[4], my = m[5];
    dst[0] = ma;
    dst[1] = mc;
    dst[2] = 0;
    dst[3] = 0;
    dst[4] = mb;
    dst[5] = md;
    dst[6] = 0;
    dst[7] = 0;
    dst[8] = 0;
    dst[9] = 0;
    dst[10] = 1;
    dst[11] = 0;
    dst[12] = mx;
    dst[13] = my;
    dst[14] = 0;
    dst[15] = 1;
}

const enum SM64DSPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

class BMDData {
    public vertexData: VertexData[] = [];

    constructor(device: GfxDevice, public bmd: NITRO_BMD.BMD) {
        for (let i = 0; i < this.bmd.models.length; i++) {
            const model = this.bmd.models[i];
            for (let j = 0; j < model.batches.length; j++)
                this.vertexData.push(new VertexData(device, model.batches[j].vertexData));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.vertexData.length; i++)
            this.vertexData[i].destroy(device);
    }
}

const scratchModelMatrix = mat4.create();
const scratchMat4 = mat4.create();
class BMDRenderer {
    public name: string = '';
    public isSkybox: boolean = false;
    public modelMatrix = mat4.create();
    public normalMatrix = mat4.create();
    public extraTexCoordMat: mat2d | null = null;
    public animation: Animation | null = null;

    private templateRenderInst: GfxRenderInst;
    private vertexDataCommands: Command_VertexData[] = [];
    private prepareToRenderFuncs: ((hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput) => void)[] = [];
    private arena = new GfxArena();

    private sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
    private materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
    private packetParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_PacketParams`);

    private texturesEnabled: boolean = true;
    private vertexColorsEnabled: boolean = true;

    constructor(device: GfxDevice, public textureHolder: NITROTextureHolder, public bmdData: BMDData, public crg1Level: CRG1Level | null = null) {
        const bmd = this.bmdData.bmd;
        this.textureHolder.addTextures(device, bmd.textures);
    }

    private createProgram(): void {
        const program = new NITRO_Program();
        if (this.texturesEnabled)
            program.defines.set('USE_TEXTURE', '1');
        if (this.vertexColorsEnabled)
            program.defines.set('USE_VERTEX_COLOR', '1');
        this.templateRenderInst.setDeviceProgram(program);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        let offs = this.templateRenderInst.getUniformBufferOffset(NITRO_Program.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        this.templateRenderInst.passMask = this.isSkybox ? SM64DSPass.SKYBOX : SM64DSPass.MAIN;

        for (let i = 0; i < this.prepareToRenderFuncs.length; i++)
            this.prepareToRenderFuncs[i](hostAccessPass, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.packetParamsBuffer.prepareToRender(hostAccessPass);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [];
        bindingLayouts[NITRO_Program.ub_SceneParams]    = { numUniformBuffers: 1, numSamplers: 0 };
        bindingLayouts[NITRO_Program.ub_MaterialParams] = { numUniformBuffers: 1, numSamplers: 1 };
        bindingLayouts[NITRO_Program.ub_PacketParams]   = { numUniformBuffers: 1, numSamplers: 0 };
        const renderInstBuilder = new GfxRenderInstBuilder(device, NITRO_Program.programReflection, bindingLayouts, [this.sceneParamsBuffer, this.materialParamsBuffer, this.packetParamsBuffer]);
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.createProgram();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, NITRO_Program.ub_SceneParams);
        this.translateBMD(device, renderInstBuilder);
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
        const texCoordMat = mat4.create();

        templateRenderInst.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            depthWrite: material.depthWrite,
            cullMode: material.cullMode,
        });

        renderInstBuilder.newUniformBufferInstance(templateRenderInst, NITRO_Program.ub_MaterialParams);

        const layer = material.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        templateRenderInst.sortKey = makeSortKey(layer);

        const texCoordMode: NITRO_BMD.TexCoordMode = material.texParams >>> 30;

        const scratchMat2d = mat2d.create();
        return (hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput) => {
            function selectArray(arr: Float32Array, time: number): number {
                return arr[(time | 0) % arr.length];
            }

            if (texture !== null) {
                this.textureHolder.fillTextureMapping(textureMapping, texture.name);
                templateRenderInst.setSamplerBindingsFromTextureMappings([textureMapping]);
                const aftTexture: NITRO_BMD.Texture = this.textureHolder.findTexture(texture.name);

                if (texCoordMode === NITRO_BMD.TexCoordMode.NORMAL) {
                    // TODO(jstpierre): Verify that we want this in all cases. Is there some flag
                    // in the engine that turns on the spherical reflection mapping?
                    this.computeNormalMatrix(texCoordMat, viewerInput);
    
                    // Game seems to use this to offset the center of the reflection.
                    texCoordMat[12] += material.texCoordMat[4];
                    texCoordMat[13] += -material.texCoordMat[5];
    
                    // We shouldn't have any texture animations on normal-mapped textures.
                    assert(crg1mat === undefined);
                } else {
                    if (crg1mat !== undefined) {
                        const time = viewerInput.time / 30;
                        const scale = selectArray(crg1mat.Scale, time);
                        const rotation = selectArray(crg1mat.Rotation, time);
                        const x = selectArray(crg1mat.X, time);
                        const y = selectArray(crg1mat.Y, time);
                        mat2d.identity(scratchMat2d);
                        mat2d.scale(scratchMat2d, scratchMat2d, [scale, scale, scale]);
                        mat2d.rotate(scratchMat2d, scratchMat2d, rotation / 180 * Math.PI);
                        mat2d.translate(scratchMat2d, scratchMat2d, [-x, y, 0]);
                        mat2d.mul(scratchMat2d, scratchMat2d, material.texCoordMat);
                    } else {
                        mat2d.copy(scratchMat2d, material.texCoordMat);
                    }

                    if (this.extraTexCoordMat !== null)
                        mat2d.mul(scratchMat2d, scratchMat2d, this.extraTexCoordMat);

                    mat2d.mul(scratchMat2d, scratchMat2d, aftTexture.extraMat);

                    mat4_from_mat2d(texCoordMat, scratchMat2d);
                }

                let offs = templateRenderInst.getUniformBufferOffset(NITRO_Program.ub_MaterialParams);
                const materialParamsMapped = this.materialParamsBuffer.mapBufferF32(offs, 12);
                offs += fillMatrix4x2(materialParamsMapped, offs, texCoordMat);
                offs += fillVec4(materialParamsMapped, offs, texCoordMode);
            }
        };
    }

    public computeViewMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isSkybox) {
            computeViewMatrixSkybox(dst, viewerInput.camera);
        } else {
            computeViewMatrix(dst, viewerInput.camera);
        }
    }

    public computeModelView(dst: mat4, viewerInput: Viewer.ViewerRenderInput, isBillboard: boolean): void {
        // Build model matrix
        const modelMatrix = scratchModelMatrix;
        if (isBillboard) {
            // Apply billboard model if necessary.
            computeModelMatrixYBillboard(modelMatrix, viewerInput.camera);
            mat4.mul(modelMatrix, this.modelMatrix, modelMatrix);
        } else {
            mat4.copy(modelMatrix, this.modelMatrix);
        }

        if (this.animation !== null)
            this.animation.updateModelMatrix(viewerInput.time, modelMatrix);

        this.computeViewMatrix(dst, viewerInput);
        mat4.mul(dst, dst, modelMatrix);
    }

    public computeNormalMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        const normalMatrix = scratchModelMatrix;

        mat4.copy(normalMatrix, this.normalMatrix);
        if (this.animation !== null)
            this.animation.updateNormalMatrix(viewerInput.time, normalMatrix);

        this.computeViewMatrix(dst, viewerInput);
        dst[12] = 0;
        dst[13] = 0;
        dst[14] = 0;

        mat4.mul(dst, dst, normalMatrix);
    }

    private translateBMD(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder) {
        let vertexDataIndex = 0;
        const bmd = this.bmdData.bmd;
        for (let i = 0; i < bmd.models.length; i++) {
            const model = bmd.models[i];
            for (let j = 0; j < model.batches.length; j++) {
                const batch = model.batches[j];
                const materialPrepareToRenderFunc = this.translateMaterial(device, renderInstBuilder, batch.material);
                const vertexData = this.bmdData.vertexData[vertexDataIndex++];
                const vertexDataCommand = new Command_VertexData(renderInstBuilder, vertexData, model.name);
                this.vertexDataCommands.push(vertexDataCommand);
                renderInstBuilder.popTemplateRenderInst();

                const prepareToRenderFunc = (hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput) => {
                    materialPrepareToRenderFunc(hostAccessPass, viewerInput);

                    let offs = vertexDataCommand.templateRenderInst.getUniformBufferOffset(NITRO_Program.ub_PacketParams);
                    const packetParamsMapped = this.packetParamsBuffer.mapBufferF32(offs, 16);

                    this.computeModelView(scratchMat4, viewerInput, model.billboard);
                    offs += fillMatrix4x3(packetParamsMapped, offs, scratchMat4);
                    offs += fillVec4(packetParamsMapped, offs, this.bmdData.bmd.scaleFactor);
                };

                this.prepareToRenderFuncs.push(prepareToRenderFunc);
            }
        }
    }

    public destroy(device: GfxDevice) {
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.packetParamsBuffer.destroy(device);
        this.arena.destroy(device);
    }
}

class SM64DSRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();

    constructor(device: GfxDevice, public modelCache: ModelCache, public textureHolder: NITROTextureHolder, public mainBMD: BMDRenderer, public skyboxBMD: BMDRenderer, public extraBMDs: BMDRenderer[]) {
        this.mainBMD.addToViewRenderer(device, this.viewRenderer);
        if (this.skyboxBMD !== null)
            this.skyboxBMD.addToViewRenderer(device, this.viewRenderer);
        for (let i = 0; i < this.extraBMDs.length; i++)
            this.extraBMDs[i].addToViewRenderer(device, this.viewRenderer);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            this.mainBMD.setVertexColorsEnabled(v);
            if (this.skyboxBMD !== null)
                this.skyboxBMD.setVertexColorsEnabled(v);
            for (let i = 0; i < this.extraBMDs.length; i++)
                this.extraBMDs[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            this.mainBMD.setTexturesEnabled(v);
            if (this.skyboxBMD !== null)
                this.skyboxBMD.setTexturesEnabled(v);
            for (let i = 0; i < this.extraBMDs.length; i++)
                this.extraBMDs[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [renderHacksPanel];
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

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, transparentBlackFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, SM64DSPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, SM64DSPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
        this.textureHolder.destroy(device);

        this.modelCache.destroy(device);
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

class ModelCache {
    public map: Map<string, Progressable<BMDData>> = new Map();
    private dataList: BMDData[] = [];

    public fetchModel(device: GfxDevice, filename: string): Progressable<BMDData> {
        if (!this.map.has(filename)) {
            const p = fetchData(filename).then((buffer) => {
                const result = LZ77.maybeDecompress(buffer);
                const bmd = NITRO_BMD.parse(result);
                const bmdData = new BMDData(device, bmd);
                this.dataList.push(bmdData);
                return bmdData;
            });
            this.map.set(filename, p);
        }
        return this.map.get(filename);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.dataList.length; i++)
            this.dataList[i].destroy(device);
    }
}

function fetchPNG(path: string): Progressable<ImageData> {
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.src = path;
    const p = img.decode().then(() => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
    });
    return new Progressable(p, 1);
}

function installAft(device: GfxDevice, textureHolder: NITROTextureHolder): Progressable<void> {
    const aftBase = `https://z.noclip.website/sm64ds/aft`;

    interface TexDef { k: string, v: string, scaleS: number, scaleT: number, transS: number, transT: number };
    function texDef(k: string, v: string, scaleS: number = 1, scaleT: number = 1): TexDef {
        return { k, v, scaleS, scaleT, transS: 0, transT: 0 };
    }

    function hootie(t: TexDef, n: number) {
        t.transS = n;
        return t;
    }

    const aftTextures = [
        texDef('mc_road', `SUPER MARIO 64#E361666A#0#2_all.png`),
        hootie(texDef('way', `SUPER MARIO 64#AEC008C0#0#2_rgb.png`, 0.5), 16),
        texDef('slope', `SUPER MARIO 64#73505869#0#2_all.png`),
        texDef('slope_grass', `SUPER MARIO 64#73505869#0#2_all.png`),
        texDef('slope_soil', `SUPER MARIO 64#73505869#0#2_all.png`),
        texDef('rock_cannon', `SUPER MARIO 64#B1F1CC42#0#2_all.png`, 2, 4),
        texDef('mc_grass', `SUPER MARIO 64#8296D820#0#2_rgb.png`),
        texDef('tonnel_grass', `SUPER MARIO 64#215CE254#0#2_rgb.png`),
        texDef('tonnel', `SUPER MARIO 64#215CE254#0#2_rgb.png`),
        texDef('soil', `SUPER MARIO 64#215CE254#0#2_rgb.png`),
        texDef('wall_grass_a', `SUPER MARIO 64#215CE254#0#2_rgb.png`),
        texDef('wall_grass_b', `SUPER MARIO 64#215CE254#0#2_rgb.png`),
        texDef('grass', `SUPER MARIO 64#8296D820#0#2_rgb.png`),
        texDef('fence_thorn', `SUPER MARIO 64#CBE026C4#0#2_all.png`),
        texDef('castle_tree_cmp4', `castle_tree_cmp4.png`),
        texDef('main_tree_cmp4', `castle_tree_cmp4.png`),
        texDef('flower_leaf', `SUPER MARIO 64#245EA00F#0#2_rgb.png`),
        texDef('water_cmp4', `SUPER MARIO 64#5095921B#0#2_rgb.png`),
        texDef('water', `SUPER MARIO 64#5095921B#0#2_rgb.png`),
        texDef('mc_fence', `SUPER MARIO 64#146F813F#0#2_all.png`),
        texDef('yuki_tree', `SUPER MARIO 64#3FB69C59#0#2_all.png`),
        hootie(texDef('wood', `SUPER MARIO 64#061A6C74#0#2_rgb.png`, 0.55, 1), 16),
        texDef('wood_paper', `SUPER MARIO 64#125E068D#0#2_rgb.png`),
        texDef('mc_window', `SUPER MARIO 64#C55C829F#0#2_all.png`),
        texDef('mc_tritile', `SUPER MARIO 64#370FC06B#0#2_rgb.png`),
        texDef('mc_til00', `SUPER MARIO 64#F8303731#0#2_rgb.png`),
        texDef('mc_til_str', `SUPER MARIO 64#D7D14C92#0#2_rgb.png`),
        texDef('mc_roof', `SUPER MARIO 64#D5BD2CF3#0#2_rgb.png`),
        texDef('peach', `peach.png`),
        texDef('mc_gake', `SUPER MARIO 64#4166F73D#0#2_rgb.png`),
        texDef('mc_yama', `SUPER MARIO 64#8296D820#0#2_rgb.png`),
        texDef('carpet_red', `SUPER MARIO 64#A6463A8D#0#2_rgb.png`),
        texDef('mc_sand', `SUPER MARIO 64#5F328955#0#2_rgb.png`),
        texDef('mc_bridge', `SUPER MARIO 64#968FA8CE#0#2_rgb.png`),
        texDef('hatena_box_16', `aftblk.png`),
        texDef('carpet', `SUPER MARIO 64#A6463A8D#0#2_rgb.png`),
        texDef('mokume', `SUPER MARIO 64#9BE30B6E#0#2_all.png`, 0.5, 0.5),
        texDef('renga', `SUPER MARIO 64#9BE30B6E#0#2_all.png`, 0.5, 0.5),
        texDef('yuka', `SUPER MARIO 64#6AA1BE26#0#2_rgb.png`),
        texDef('yuka_sun', `SUPER MARIO 64#54F2C81A#0#2_all.png`),
        texDef('re_kumo', `SUPER MARIO 64#1E520811#0#2_rgb.png`, 0.5),
        texDef('re_kusa', `SUPER MARIO 64#0303136F#0#2_rgb.png`, 0.5),
        texDef('tesuri', `SUPER MARIO 64#D10D7B85#0#2_all.png`, 0.5),
        texDef('for_bh', `aftfor_bh.png`),
        texDef('kanban', `SUPER MARIO 64#8EE5398C#0#2_all.png`),
        texDef('kabe', `SUPER MARIO 64#0D487556#0#2_rgb.png`, 0.5, 0.5),
        texDef('pole', `SUPER MARIO 64#6DA0B1B9#0#2_rgb.png`),
        texDef('rock_b', `SUPER MARIO 64#B7B83492#0#2_rgb.png`),
        texDef('start', `SUPER MARIO 64#602EF33F#0#2_all.png`),
        texDef('start_grass', `SUPER MARIO 64#602EF33F#0#2_all.png`, 1, 0.5),
        texDef('rock_a', `SUPER MARIO 64#602EF33F#0#2_all.png`),
        texDef('rock_a_grass', `SUPER MARIO 64#602EF33F#0#2_all.png`, 1, 0.5),
        texDef('fence', `SUPER MARIO 64#9026CBA3#0#2_all.png`, 0.5),
        texDef('bridge', `SUPER MARIO 64#6543184D#0#2_all.png`),
        texDef('brocken', `SUPER MARIO 64#6543184D#0#2_all.png`),
        texDef('woodwall', `SUPER MARIO 64#130CA9A8#0#2_rgb.png`),
        texDef('tesuri_koware', `SUPER MARIO 64#8DB2E5CA#0#2_all.png`),
        texDef('saku', `SUPER MARIO 64#8DB2E5CA#0#2_all.png`),
        texDef('snow', `SUPER MARIO 64#E1CA8B50#0#2_rgb.png`, 0.5),
        texDef('th_mado', `SUPER MARIO 64#B8F6006F#0#2_all.png`),
        texDef('th_huti00', `SUPER MARIO 64#4A4683BC#0#2_rgb.png`),
        texDef('th_tesuri00', `SUPER MARIO 64#C9E2883E#0#2_all.png`),
        texDef('th_kabe01', `SUPER MARIO 64#8899587D#0#2_rgb.png`),
        texDef('th_hasira', `SUPER MARIO 64#042DEE1B#0#2_rgb.png`),
        texDef('th_kiyuka', `SUPER MARIO 64#C99707D9#0#2_rgb.png`),
        texDef('th_pic_b', `SUPER MARIO 64#24767D89#0#2_all.png`),
        texDef('th_yuka01', `SUPER MARIO 64#0AD7A8F7#0#2_all.png`, 0.15, 0.15),
        texDef('th_hon00', `SUPER MARIO 64#15D30589#0#2_all.png`),
    ];

    const p = aftTextures.filter((texdef) => {
        return textureHolder.findTexture(texdef.k) !== null;
    }).map((texdef) => {
        return fetchPNG(`${aftBase}/${encodeURIComponent(texdef.v)}`).then((imgData) => {
            const extraMat = mat2d.create();
            mat2d.translate(extraMat, extraMat, [texdef.transS, texdef.transT]);
            mat2d.scale(extraMat, extraMat, [texdef.scaleS, texdef.scaleT]);

            const texture: NITRO_BMD.Texture = {
                name: texdef.k,
                format: Format.Tex_Direct,
                width: imgData.width,
                height: imgData.height,
                id: 0,
                isTranslucent: false,
                paletteName: '',
                pixels: new Uint8Array(imgData.data.buffer),
                params: 0,
                extraMat,
            };
            textureHolder.addTextures(device, [texture], true);
        });
    });

    return Progressable.all(p).then(() => null);
}

const GLOBAL_SCALE = 1500;
export class SceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public levelId: number, public name: string, private aft: boolean = false) {
        this.id = '' + this.levelId;
    }

    public createScene(device: GfxDevice): Progressable<Viewer.SceneGfx> {
        return fetchData('sm64ds/sm64ds.crg1').then((result: ArrayBufferSlice) => {
            const crg1 = BYML.parse<Sm64DSCRG1>(result, BYML.FileType.CRG1);
            const textureHolder = new NITROTextureHolder();
            return this._createSceneFromCRG1(device, textureHolder, crg1).then((scene) => {
                if (this.aft)
                    return installAft(device, textureHolder).then(() => scene);
                else
                    return scene;
            });
        });
    }

    private _createBMDRenderer(device: GfxDevice, modelCache: ModelCache, textureHolder: NITROTextureHolder, filename: string, scale: number, level: CRG1Level, isSkybox: boolean): Progressable<BMDRenderer> {
        return modelCache.fetchModel(device, `sm64ds/${filename}`).then((bmdData: BMDData) => {
            const renderer = new BMDRenderer(device, textureHolder, bmdData, level);
            mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [scale, scale, scale]);
            renderer.isSkybox = isSkybox;
            return renderer;
        });
    }

    private _createBMDObjRenderer(device: GfxDevice, modelCache: ModelCache, textureHolder: NITROTextureHolder, filename: string, translation: vec3, rotationY: number, scale: number = 1, spinSpeed: number = 0): Progressable<BMDRenderer> {
        return modelCache.fetchModel(device, `sm64ds/${filename}`).then((bmdData: BMDData) => {
            const renderer = new BMDRenderer(device, textureHolder, bmdData);
            renderer.name = filename;

            vec3.scale(translation, translation, GLOBAL_SCALE);
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, translation);

            mat4.rotateY(renderer.modelMatrix, renderer.modelMatrix, rotationY);

            // Don't ask, ugh.
            scale = scale * (GLOBAL_SCALE / 100);
            mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [scale, scale, scale]);

            mat4.rotateY(renderer.normalMatrix, renderer.normalMatrix, rotationY);

            if (spinSpeed > 0)
                renderer.animation = new YSpinAnimation(spinSpeed, 0);

            return renderer;
        });
    }

    private _createBMDRendererForObject(device: GfxDevice, modelCache: ModelCache, textureHolder: NITROTextureHolder, object: CRG1Object): Progressable<BMDRenderer> {
        const translation = vec3.fromValues(object.Position.X, object.Position.Y, object.Position.Z);
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
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_block/broken_block_l.bmd`, translation, rotationY, 0.8);
        case 24: // Brick Block Larger
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_block/broken_block_l.bmd`, translation, rotationY, 1.2);
        case 26: // Powerup inside block?
        case 29: // Cannon hatch
            return null;
        case 30: // Item Block
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_hatena_box/hatena_box.bmd`, translation, rotationY, 0.8);
        case 36: // Pole
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_pile/pile.bmd`, translation, rotationY, 0.8);
        case 37: // Coin
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/coin/coin_poly32.bmd`, translation, rotationY, 0.7, 0.1);
        case 38: // Red Coin
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/coin/coin_red_poly32.bmd`, translation, rotationY, 0.7, 0.1);
        case 39: // Blue Coin
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/coin/coin_blue_poly32.bmd`, translation, rotationY, 0.7, 0.1);
        case 41: { // Tree
            const treeType = (object.Parameters[0] >>> 4) & 0x07;
            const treeFilenames = ['bomb', 'toge', 'yuki', 'yashi', 'castle', 'castle', 'castle', 'castle'];
            const filename = `normal_obj/tree/${treeFilenames[treeType]}_tree.bmd`;
            return this._createBMDObjRenderer(device, modelCache, textureHolder, filename, translation, rotationY);
        }
        case 42: { // Castle Painting
            const painting = (object.Parameters[0] >>> 8) & 0x1F;
            const filenames = [
                'for_bh', 'for_bk', 'for_ki', 'for_sm', 'for_cv_ex5', 'for_fl', 'for_dl', 'for_wl', 'for_sl', 'for_wc',
                'for_hm', 'for_hs', 'for_td_tt', 'for_ct', 'for_ex_mario', 'for_ex_luigi', 'for_ex_wario', 'for_vs_cross', 'for_vs_island',
            ];
            const filename = `picture/${filenames[painting]}.bmd`;
            const scaleX = (object.Parameters[0] & 0xF)+1;
            const scaleY = ((object.Parameters[0] >> 4) & 0x0F) + 1;
            const rotationX = object.Parameters[1] / 0x7FFF * (Math.PI);
            const isMirrored = ((object.Parameters[0] >> 13) & 0x03) === 3;
            return this._createBMDObjRenderer(device, modelCache, textureHolder, filename, translation, rotationY, 0.8).then((renderer) => {
                mat4.rotateX(renderer.modelMatrix, renderer.modelMatrix, rotationX);
                mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [scaleX, scaleY, 1]);
                mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [0, 100/16, 0]);
                if (isMirrored) {
                    renderer.extraTexCoordMat = mat2d.create();
                    renderer.extraTexCoordMat[0] *= -1;
                }
                return renderer;
            });
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
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/star/obj_star_silver.bmd`, translation, rotationY, 0.8, 0.08);
        case 63: // Star
            let filename = `normal_obj/star/obj_star.bmd`;
            let startype = (object.Parameters[0] >>> 4) & 0x0F;
            let rotateSpeed = 0.08;
            switch (startype)
            {
                case 0:
                    filename = `normal_obj/star/star_base.bmd`;
                    break;
                case 1:
                case 4:
                case 6:
                    filename = `normal_obj/star_box/star_box.bmd`;
                    rotateSpeed = 0;
                    break;
            }
            return this._createBMDObjRenderer(device, modelCache, textureHolder, filename, translation, rotationY, 0.8, rotateSpeed);
        case 64: // Whomp
        case 65: // Big Whomp
        case 66: // Thwomp
        case 67: // Boo
        case 74: // Minigame Cabinet Trigger (Invisible)
            return null;
        case 75: // Wall sign
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_kanban/obj_kanban.bmd`, translation, rotationY, 0.8);
        case 76: // Signpost
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_tatefuda/obj_tatefuda.bmd`, translation, rotationY, 0.8);
        case 79: // Heart
        case 80: // Toad
        case 167: // Peach's Castle Tippy TTC Hour Hand
        case 168: // Peach's Castle Tippy TTC Minute Hand
        case 169: // Peach's Castle Tippy TTC Pendulum
            return null;
        case 187: // Left Arrow Sign
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_yajirusi_l/yajirusi_l.bmd`, translation, rotationY, 0.8);
        case 188: // Right Arrow Sign
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_yajirusi_r/yajirusi_r.bmd`, translation, rotationY, 0.8);
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
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `special_obj/bk_ukisima/bk_ukisima.bmd`, translation, rotationY, 1, 0.05);
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
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/obj_block/broken_block_ll.bmd`, translation, rotationY);
        case 293: // Water
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `special_obj/mc_water/mc_water.bmd`, translation, rotationY, 0.8);
        case 295: // Metal net
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `special_obj/mc_metalnet/mc_metalnet.bmd`, translation, rotationY, 0.8);
        case 298: // Flag
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `special_obj/mc_flag/mc_flag.bmd`, translation, rotationY, 0.8);
        case 303: // Castle Basement Water
        case 304: // Secret number thingy
            return null;
        case 305: // Blue Coin Switch
            return this._createBMDObjRenderer(device, modelCache, textureHolder, `normal_obj/b_coin_switch/b_coin_switch.bmd`, translation, rotationY, 0.8);
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

    private _createSceneFromCRG1(device: GfxDevice, textureHolder: NITROTextureHolder, crg1: Sm64DSCRG1): Progressable<Viewer.SceneGfx> {
        const level = crg1.Levels[this.levelId];
        const modelCache = new ModelCache();
        const renderers = [this._createBMDRenderer(device, modelCache, textureHolder, level.MapBmdFile, GLOBAL_SCALE, level, false)];
        if (level.VrboxBmdFile)
            renderers.push(this._createBMDRenderer(device, modelCache, textureHolder, level.VrboxBmdFile, 0.8, level, true));
        else
            renderers.push(Progressable.resolve(null));
        for (const object of level.Objects) {
            const objRenderer = this._createBMDRendererForObject(device, modelCache, textureHolder, object);
            if (objRenderer)
            renderers.push(objRenderer);
        }
        return Progressable.all(renderers).then(([mainBMD, skyboxBMD, ...extraBMDs]) => {
            return new SM64DSRenderer(device, modelCache, textureHolder, mainBMD, skyboxBMD, extraBMDs);
        });
    }
}
