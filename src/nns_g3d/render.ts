
import { mat4, mat2d } from "gl-matrix";
import { GfxFormat, GfxDevice, GfxProgram, GfxBufferUsage, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxTexture, GfxBlendMode, GfxBlendFactor, GfxMipFilterMode, GfxTexFilterMode, GfxSampler, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import * as Viewer from '../viewer';
import * as NSBMD from './nsbmd';
import * as NSBTA from "./nsbta";
import * as NITRO_GX from '../sm64ds/nitro_gx';
import { readTexture, getFormatName, Texture, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT, textureFormatIsTranslucent } from "../sm64ds/nitro_tex";
import { NITRO_Program, Command_VertexData } from '../sm64ds/render';
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst, GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { TEX0, TEX0Texture } from "./nsbtx";
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { fillMatrix4x3, fillMatrix4x4, fillMatrix3x2 } from "../gfx/helpers/UniformBufferHelpers";
import { computeViewMatrix, computeViewMatrixSkybox } from "../Camera";
import { BasicRenderTarget, depthClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import AnimationController from "../AnimationController";

function textureToCanvas(bmdTex: TEX0Texture, pixels: Uint8Array, name: string): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = bmdTex.width;
    canvas.height = bmdTex.height;
    canvas.title = name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getFormatName(bmdTex.format));
    return { name, surfaces, extraInfo };
}

const scratchTexMatrix = mat2d.create();
class Command_Material {
    private texture: TEX0Texture | null = null;
    private gfxTexture: GfxTexture | null = null;
    private gfxSampler: GfxSampler | null = null;
    public templateRenderInst: GfxRenderInst;
    public viewerTexture: Viewer.Texture;
    public baseCtx: NITRO_GX.Context;
    public srt0Animator: NSBTA.SRT0TexMtxAnimator | null = null;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, hostAccessPass: GfxHostAccessPass, tex0: TEX0, public material: NSBMD.MDL0Material) {
        this.translateTexture(device, hostAccessPass, tex0);
        this.translateRenderInst(device, renderInstBuilder);
        this.baseCtx = { color: { r: 0xFF, g: 0xFF, b: 0xFF }, alpha: this.material.alpha };
    }

    public bindSRT0(animationController: AnimationController, srt0: NSBTA.SRT0): void {
        this.srt0Animator = NSBTA.bindSRT0(animationController, srt0, this.material.name);
    }

    private translateTexture(device: GfxDevice, hostAccessPass: GfxHostAccessPass, tex0: TEX0): void {
        const textureName = this.material.textureName;
        const paletteName = this.material.paletteName;

        this.texture = tex0.textures.find((t) => t.name === textureName);
        const palette = paletteName !== null ? tex0.palettes.find((t) => t.name === paletteName) : null;
        const finalTextureName = `${this.texture.name}${palette !== null ? `/${palette.name}` : ''}`;

        const inTexture: Texture = { ...this.texture, palData: palette !== null ? palette.data : null } as Texture;
        const pixels = readTexture(inTexture);
        this.gfxTexture = device.createTexture(GfxFormat.U8_RGBA, this.texture.width, this.texture.height, 1);;
        hostAccessPass.uploadTextureData(this.gfxTexture, 0, [pixels]);

        this.viewerTexture = textureToCanvas(this.texture, pixels, finalTextureName);
    }

    public prepareToRender(materialParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.srt0Animator !== null) {
            this.srt0Animator.calcTexMtx(scratchTexMatrix, this.material.texScaleS, this.material.texScaleT);
        } else {
            mat2d.copy(scratchTexMatrix, this.material.texMatrix);
        }

        const materialParamsMapped = materialParamsBuffer.mapBufferF32(this.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_MaterialParams], 8);
        let offs = this.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_MaterialParams];
        offs += fillMatrix3x2(materialParamsMapped, offs, scratchTexMatrix);
    }

    private translateRenderInst(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder): void {
        this.templateRenderInst = renderInstBuilder.newRenderInst();

        if (this.gfxTexture !== null) {
            this.gfxSampler = device.createSampler({
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.NO_MIP,
                wrapS: parseTexImageParamWrapModeS(this.material.texParams),
                wrapT: parseTexImageParamWrapModeT(this.material.texParams),
                minLOD: 0,
                maxLOD: 100,
            });

            const textureMapping = new TextureMapping();
            textureMapping.gfxTexture = this.gfxTexture;
            textureMapping.gfxSampler = this.gfxSampler;

            this.templateRenderInst.setSamplerBindingsFromTextureMappings([textureMapping]);
        }

        // NITRO's Rendering Engine uses two passes. Opaque, then Transparent.
        // A transparent polygon is one that has an alpha of < 0xFF, or uses
        // A5I3 / A3I5 textures.
        const isTranslucent = (this.material.alpha < 0xFF) || (this.texture && textureFormatIsTranslucent(this.texture.format));
        const xl = !!((this.material.polyAttribs >>> 11) & 0x01);
        const depthWrite = xl || !isTranslucent;

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.templateRenderInst.sortKey = makeSortKeyOpaque(layer, 0);
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, NITRO_Program.ub_MaterialParams);
        this.templateRenderInst.renderFlags.set({
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            depthWrite: depthWrite,
            cullMode: this.material.cullMode,
        });
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null)
            device.destroyTexture(this.gfxTexture);
        if (this.gfxSampler !== null)
            device.destroySampler(this.gfxSampler);
    }
}

class Command_Node {
    public modelMatrix = mat4.create();

    constructor(public node: NSBMD.MDL0Node) {
    }

    public prepareToRender(baseModelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        mat4.mul(this.modelMatrix, baseModelMatrix, this.node.jointMatrix);
    }
}

const scratchViewMatrix = mat4.create();
class Command_Shape {
    public vertexDataCommand: Command_VertexData;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, materialCommand: Command_Material, public nodeCommand: Command_Node, public shape: NSBMD.MDL0Shape) {
        const baseCtx = materialCommand.baseCtx;
        const vertexData = NITRO_GX.readCmds(shape.dlBuffer, baseCtx);
        this.vertexDataCommand = new Command_VertexData(device, renderInstBuilder, vertexData, shape.name);
    }

    private computeModelView(viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): mat4 {
        const viewMatrix = scratchViewMatrix;

        if (isSkybox) {
            computeViewMatrixSkybox(viewMatrix, viewerInput.camera);
        } else {
            computeViewMatrix(viewMatrix, viewerInput.camera);
        }

        mat4.mul(viewMatrix, viewMatrix, this.nodeCommand.modelMatrix);
        return viewMatrix;
    }

    public prepareToRender(packetParamsBuffer: GfxRenderBuffer, isSkybox: boolean, viewerInput: Viewer.ViewerRenderInput): void {
        const packetParamsMapped = packetParamsBuffer.mapBufferF32(this.vertexDataCommand.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_PacketParams], 12);
        let offs = this.vertexDataCommand.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_PacketParams];
        offs += fillMatrix4x3(packetParamsMapped, offs, this.computeModelView(viewerInput, isSkybox));
    }

    public destroy(device: GfxDevice): void {
        this.vertexDataCommand.destroy(device);
    }
}

export enum MKDSPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

export class MDL0Renderer {
    public modelMatrix = mat4.create();
    public isSkybox: boolean = false;
    public pass: MKDSPass = MKDSPass.MAIN;
    public animationController = new AnimationController();

    private gfxProgram: GfxProgram;
    private templateRenderInst: GfxRenderInst;
    private materialCommands: Command_Material[] = [];
    private shapeCommands: Command_Shape[] = [];
    private nodeCommands: Command_Node[] = [];
    public viewerTextures: Viewer.Texture[] = [];

    private sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
    private materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
    private packetParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_PacketParams`);

    constructor(device: GfxDevice, private tex0: TEX0, public model: NSBMD.MDL0Model) {
        this.gfxProgram = device.createProgram(new NITRO_Program());
        const posScale = model.posScale * 50;
        mat4.fromScaling(this.modelMatrix, [posScale, posScale, posScale]);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        const hostAccessPass = device.createHostAccessPass();

        const programReflection = device.queryProgram(this.gfxProgram);
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [];
        bindingLayouts[NITRO_Program.ub_SceneParams]    = { numUniformBuffers: 1, numSamplers: 0 };
        bindingLayouts[NITRO_Program.ub_MaterialParams] = { numUniformBuffers: 1, numSamplers: 1 };
        bindingLayouts[NITRO_Program.ub_PacketParams]   = { numUniformBuffers: 1, numSamplers: 0 };
        const renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [this.sceneParamsBuffer, this.materialParamsBuffer, this.packetParamsBuffer]);
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.passMask = this.pass;
        this.templateRenderInst.gfxProgram = this.gfxProgram;
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, NITRO_Program.ub_SceneParams);

        for (let i = 0; i < this.model.materials.length; i++)
            this.materialCommands.push(new Command_Material(device, renderInstBuilder, hostAccessPass, this.tex0, this.model.materials[i]));
        for (let i = 0; i < this.model.nodes.length; i++)
            this.nodeCommands.push(new Command_Node(this.model.nodes[i]));

        for (let i = 0; i < this.materialCommands.length; i++)
            if (this.materialCommands[i].viewerTexture !== null)
                this.viewerTextures.push(this.materialCommands[i].viewerTexture);

        this.execSBC(device, renderInstBuilder);
        device.submitPass(hostAccessPass);
        renderInstBuilder.popTemplateRenderInst();
        renderInstBuilder.finish(device, viewRenderer);
    }

    public bindSRT0(srt0: NSBTA.SRT0): void {
        for (let i = 0; i < this.materialCommands.length; i++)
            this.materialCommands[i].bindSRT0(this.animationController, srt0);
    }

    private execSBC(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder) {
        const model = this.model;
        const view = model.sbcBuffer.createDataView();

        const enum Op {
            NOP, RET, NODE, MTX, MAT, SHP, NODEDESC, BB, BBY, NODEMIX, CALLDL, POSSCALE, ENVMAP, PRJMAP,
        };

        let idx = 0;
        let currentNode: Command_Node;
        let currentMaterial: Command_Material;
        while (true) {
            const w0 = view.getUint8(idx++);
            const cmd = w0 & 0x1F;
            const opt = (w0 & 0xE0) >>> 5;
            if (cmd === Op.NOP)
                continue;
            else if (cmd === Op.RET)
                break;
            else if (cmd === Op.NODE) {
                const nodeIdx = view.getUint8(idx++);
                const visible = view.getUint8(idx++);
                currentNode = this.nodeCommands[nodeIdx];
            } else if (cmd === Op.MTX) {
                const mtxIdx = view.getUint8(idx++);
            } else if (cmd === Op.MAT) {
                const matIdx = view.getUint8(idx++);
                currentMaterial = this.materialCommands[matIdx];
            } else if (cmd === Op.SHP) {
                const shpIdx = view.getUint8(idx++);
                const shape = model.shapes[shpIdx];
                renderInstBuilder.pushTemplateRenderInst(currentMaterial.templateRenderInst);
                this.shapeCommands.push(new Command_Shape(device, renderInstBuilder, currentMaterial, currentNode, shape));
                renderInstBuilder.popTemplateRenderInst();
            } else if (cmd === Op.NODEDESC) {
                const idxNode = view.getUint8(idx++);
                const idxNodeParent = view.getUint8(idx++);
                const flags = view.getUint8(idx++);
                let destIdx = -1, srcIdx = -1;
                if (opt & 0x01)
                    destIdx = view.getUint8(idx++);
                if (opt & 0x02)
                    srcIdx = view.getUint8(idx++);
            } else if (cmd === Op.POSSCALE) {
                //
            } else {
                throw new Error(`UNKNOWN SBC ${cmd.toString(16)}`);
            }
        }
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.updateTime(viewerInput.time);

        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(this.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_SceneParams], 16);
        let offs = this.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_SceneParams];
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.nodeCommands.length; i++)
            this.nodeCommands[i].prepareToRender(this.modelMatrix, viewerInput);
        for (let i = 0; i < this.materialCommands.length; i++)
            this.materialCommands[i].prepareToRender(this.materialParamsBuffer, viewerInput);
        for (let i = 0; i < this.shapeCommands.length; i++)
            this.shapeCommands[i].prepareToRender(this.packetParamsBuffer, this.isSkybox, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.packetParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.packetParamsBuffer.destroy(device);
        for (let i = 0; i < this.materialCommands.length; i++)
            this.materialCommands[i].destroy(device);
    }
}

export class FakeTextureHolder extends TextureHolder<any> {
    public addTextureGfx(device: GfxDevice, entry: any): LoadedTexture { throw new Error(); }
}

export class CourseRenderer implements Viewer.Scene_Device {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();
    public textureHolder = new FakeTextureHolder();

    constructor(device: GfxDevice, public courseRenderer: MDL0Renderer, public skyboxRenderer: MDL0Renderer | null) {
        this.textureHolder.viewerTextures = this.courseRenderer.viewerTextures;
        this.courseRenderer.addToViewRenderer(device, this.viewRenderer);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.addToViewRenderer(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.courseRenderer.prepareToRender(hostAccessPass, viewerInput);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(hostAccessPass, viewerInput);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, MKDSPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, MKDSPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);

        this.courseRenderer.destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
    }
}
