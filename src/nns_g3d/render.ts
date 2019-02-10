
import { mat4, mat2d } from "gl-matrix";
import { GfxFormat, GfxDevice, GfxProgram, GfxBufferUsage, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxTexture, GfxBlendMode, GfxBlendFactor, GfxMipFilterMode, GfxTexFilterMode, GfxSampler, GfxRenderPass, GfxTextureDimension } from '../gfx/platform/GfxPlatform';
import * as Viewer from '../viewer';
import * as NSBMD from './nsbmd';
import * as NSBTA from "./nsbta";
import * as NSBTP from "./nsbtp";
import * as NITRO_GX from '../sm64ds/nitro_gx';
import { readTexture, getFormatName, Texture, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT, textureFormatIsTranslucent } from "../sm64ds/nitro_tex";
import { NITRO_Program, Command_VertexData, VertexData } from '../sm64ds/render';
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst, GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { TEX0, TEX0Texture } from "./nsbtx";
import { TextureMapping } from "../TextureHolder";
import { fillMatrix4x3, fillMatrix4x4, fillMatrix3x2, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { computeViewMatrix, computeViewMatrixSkybox } from "../Camera";
import AnimationController from "../AnimationController";
import { nArray } from "../util";

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
    private texture: TEX0Texture;
    private gfxTextures: GfxTexture[] = [];
    private textureNames: string[] = [];
    private gfxSampler: GfxSampler | null = null;
    private textureMappings: TextureMapping[] = nArray(1, () => new TextureMapping());
    public templateRenderInst: GfxRenderInst;
    public viewerTextures: Viewer.Texture[] = [];
    public baseCtx: NITRO_GX.Context;
    public srt0Animator: NSBTA.SRT0TexMtxAnimator | null = null;
    public pat0Animator: NSBTP.PAT0TexAnimator | null = null;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, hostAccessPass: GfxHostAccessPass, tex0: TEX0, public material: NSBMD.MDL0Material) {
        this.texture = tex0.textures.find((t) => t.name === this.material.textureName);
        this.translateTexture(device, hostAccessPass, tex0, this.material.textureName, this.material.paletteName);
        this.translateRenderInst(device, renderInstBuilder);
        this.baseCtx = { color: { r: 0xFF, g: 0xFF, b: 0xFF }, alpha: this.material.alpha };
    }

    public bindSRT0(animationController: AnimationController, srt0: NSBTA.SRT0): void {
        this.srt0Animator = NSBTA.bindSRT0(animationController, srt0, this.material.name);
    }

    public bindPAT0(animationController: AnimationController, pat0: NSBTP.PAT0): boolean {
        this.pat0Animator = NSBTP.bindPAT0(animationController, pat0, this.material.name);
        return this.pat0Animator !== null;
    }

    public translatePAT0Textures(device: GfxDevice, hostAccessPass: GfxHostAccessPass, tex0: TEX0): void {
        if (this.pat0Animator === null)
            return;

        while (this.gfxTextures.length > 1) {
            device.destroyTexture(this.gfxTextures.pop());
            this.textureNames.pop();
            this.viewerTextures.pop();
        }

        for (let i = 0; i < this.pat0Animator.matData.animationTrack.length; i++) {
            const { texName, plttName } = this.pat0Animator.matData.animationTrack[i];
            this.translateTexture(device, hostAccessPass, tex0, texName, plttName);
        }
    }

    private translateTexture(device: GfxDevice, hostAccessPass: GfxHostAccessPass, tex0: TEX0, textureName: string, paletteName: string) {
        const texture = tex0.textures.find((t) => t.name === textureName);
        const palette = paletteName !== null ? tex0.palettes.find((t) => t.name === paletteName) : null;
        const fullTextureName = `${textureName}/${paletteName}`;
        if (this.textureNames.indexOf(fullTextureName) >= 0)
            return;
        this.textureNames.push(fullTextureName);

        const inTexture: Texture = { ...texture, palData: palette !== null ? palette.data : null } as Texture;
        const pixels = readTexture(inTexture);
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: 1,
        });
        this.gfxTextures.push(gfxTexture);
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);

        this.viewerTextures.push(textureToCanvas(texture, pixels, fullTextureName));
    }

    public prepareToRender(materialParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.srt0Animator !== null) {
            this.srt0Animator.calcTexMtx(scratchTexMatrix, this.material.texScaleS, this.material.texScaleT);
        } else {
            mat2d.copy(scratchTexMatrix, this.material.texMatrix);
        }

        if (this.pat0Animator !== null) {
            const fullTextureName = this.pat0Animator.calcFullTextureName();
            let textureIndex = this.textureNames.indexOf(fullTextureName);
            if (textureIndex >= 0) {
                this.textureMappings[0].gfxTexture = this.gfxTextures[textureIndex];
                this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
            }
        }

        const materialParamsMapped = materialParamsBuffer.mapBufferF32(this.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_MaterialParams], 8);
        let offs = this.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_MaterialParams];
        offs += fillMatrix3x2(materialParamsMapped, offs, scratchTexMatrix);
        offs += fillVec4(materialParamsMapped, offs, 0);
    }

    private translateRenderInst(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder): void {
        this.templateRenderInst = renderInstBuilder.newRenderInst();

        if (this.gfxTextures.length > 0) {
            this.gfxSampler = device.createSampler({
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.NO_MIP,
                wrapS: parseTexImageParamWrapModeS(this.material.texParams),
                wrapT: parseTexImageParamWrapModeT(this.material.texParams),
                minLOD: 0,
                maxLOD: 100,
            });

            const textureMapping = this.textureMappings[0];
            textureMapping.gfxTexture = this.gfxTextures[0];
            textureMapping.gfxSampler = this.gfxSampler;

            this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
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
        this.templateRenderInst.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            depthWrite: depthWrite,
            cullMode: this.material.cullMode,
        });
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTextures.length; i++)
            device.destroyTexture(this.gfxTextures[i]);
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

const scratchMat4 = mat4.create();
class Command_Shape {
    private vertexData: VertexData;
    public vertexDataCommand: Command_VertexData;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, private materialCommand: Command_Material, public nodeCommand: Command_Node, public shape: NSBMD.MDL0Shape) {
        const baseCtx = materialCommand.baseCtx;
        const nitroVertexData = NITRO_GX.readCmds(shape.dlBuffer, baseCtx);
        this.vertexData = new VertexData(device, nitroVertexData);
        this.vertexDataCommand = new Command_VertexData(renderInstBuilder, this.vertexData, shape.name);
    }

    private computeModelView(dst: mat4, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        if (isSkybox) {
            computeViewMatrixSkybox(dst, viewerInput.camera);
        } else {
            computeViewMatrix(dst, viewerInput.camera);
        }

        mat4.mul(dst, dst, this.nodeCommand.modelMatrix);
    }

    public prepareToRender(packetParamsBuffer: GfxRenderBuffer, isSkybox: boolean, viewerInput: Viewer.ViewerRenderInput): void {
        const packetParamsMapped = packetParamsBuffer.mapBufferF32(this.vertexDataCommand.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_PacketParams], 12);
        let offs = this.vertexDataCommand.templateRenderInst.uniformBufferOffsets[NITRO_Program.ub_PacketParams];

        this.computeModelView(scratchMat4, viewerInput, isSkybox);
        offs += fillMatrix4x3(packetParamsMapped, offs, scratchMat4);
    }

    public destroy(device: GfxDevice): void {
        this.vertexData.destroy(device);
    }
}

export const enum G3DPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

export class MDL0Renderer {
    public modelMatrix = mat4.create();
    public isSkybox: boolean = false;
    public animationController = new AnimationController();

    private gfxProgram: GfxProgram;
    private templateRenderInst: GfxRenderInst;
    private materialCommands: Command_Material[] = [];
    private shapeCommands: Command_Shape[] = [];
    private nodeCommands: Command_Node[] = [];
    public viewerTextures: Viewer.Texture[] = [];
    private renderInstBuilder: GfxRenderInstBuilder;

    private sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
    private materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
    private packetParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_PacketParams`);

    constructor(device: GfxDevice, public model: NSBMD.MDL0Model, private tex0: TEX0) {
        this.gfxProgram = device.createProgram(new NITRO_Program());
        const posScale = model.posScale * 50;
        mat4.fromScaling(this.modelMatrix, [posScale, posScale, posScale]);

        const programReflection = device.queryProgram(this.gfxProgram);
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [];
        bindingLayouts[NITRO_Program.ub_SceneParams]    = { numUniformBuffers: 1, numSamplers: 0 };
        bindingLayouts[NITRO_Program.ub_MaterialParams] = { numUniformBuffers: 1, numSamplers: 1 };
        bindingLayouts[NITRO_Program.ub_PacketParams]   = { numUniformBuffers: 1, numSamplers: 0 };

        this.renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [this.sceneParamsBuffer, this.materialParamsBuffer, this.packetParamsBuffer]);
        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.gfxProgram = this.gfxProgram;
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, NITRO_Program.ub_SceneParams);

        const hostAccessPass = device.createHostAccessPass();
        for (let i = 0; i < this.model.materials.length; i++)
            this.materialCommands.push(new Command_Material(device, this.renderInstBuilder, hostAccessPass, this.tex0, this.model.materials[i]));
        device.submitPass(hostAccessPass);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        for (let i = 0; i < this.model.nodes.length; i++)
            this.nodeCommands.push(new Command_Node(this.model.nodes[i]));

        for (let i = 0; i < this.materialCommands.length; i++)
            if (this.materialCommands[i].viewerTextures.length > 0)
                this.viewerTextures.push(this.materialCommands[i].viewerTextures[0]);

        this.execSBC(device, this.renderInstBuilder);
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public bindSRT0(srt0: NSBTA.SRT0): void {
        for (let i = 0; i < this.materialCommands.length; i++)
            this.materialCommands[i].bindSRT0(this.animationController, srt0);
    }

    public bindPAT0(device: GfxDevice, pat0: NSBTP.PAT0): void {
        const hostAccessPass = device.createHostAccessPass();
        for (let i = 0; i < this.materialCommands.length; i++) {
            if (this.materialCommands[i].bindPAT0(this.animationController, pat0))
                this.materialCommands[i].translatePAT0Textures(device, hostAccessPass, this.tex0);
        }
        device.submitPass(hostAccessPass);
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
            } else if (cmd === Op.BB) {
                const nodeId = view.getUint8(idx++);
                let destIdx = -1, srcIdx = -1;
                if (opt & 0x01)
                    destIdx = view.getUint8(idx++);
                if (opt & 0x02)
                    srcIdx = view.getUint8(idx++);
            } else if (cmd === Op.BBY) {
                const nodeId = view.getUint8(idx++);
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
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        this.templateRenderInst.passMask = this.isSkybox ? G3DPass.SKYBOX : G3DPass.MAIN;

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
        for (let i = 0; i < this.shapeCommands.length; i++)
            this.shapeCommands[i].destroy(device);
    }
}
