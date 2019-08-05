
import { mat4, mat2d } from "gl-matrix";
import { GfxFormat, GfxDevice, GfxProgram, GfxBufferUsage, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxTexture, GfxBlendMode, GfxBlendFactor, GfxMipFilterMode, GfxTexFilterMode, GfxSampler, GfxRenderPass, GfxTextureDimension, GfxMegaStateDescriptor } from '../gfx/platform/GfxPlatform';
import * as Viewer from '../viewer';
import * as NSBMD from './nsbmd';
import * as NSBTA from "./nsbta";
import * as NSBTP from "./nsbtp";
import * as NITRO_GX from '../sm64ds/nitro_gx';
import { readTexture, getFormatName, Texture, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT, textureFormatIsTranslucent } from "../sm64ds/nitro_tex";
import { NITRO_Program, VertexData } from '../sm64ds/render';
import { GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderer";
import { TEX0, TEX0Texture } from "./nsbtx";
import { TextureMapping } from "../TextureHolder";
import { fillMatrix4x3, fillMatrix4x4, fillMatrix3x2, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { computeViewMatrix, computeViewMatrixSkybox, computeModelMatrixYBillboard } from "../Camera";
import AnimationController from "../AnimationController";
import { nArray } from "../util";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer2";

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
class MaterialInstance {
    private texture: TEX0Texture;
    private gfxTextures: GfxTexture[] = [];
    private textureNames: string[] = [];
    private gfxSampler: GfxSampler | null = null;
    private textureMappings: TextureMapping[] = nArray(1, () => new TextureMapping());
    public viewerTextures: Viewer.Texture[] = [];
    public baseCtx: NITRO_GX.Context;
    public srt0Animator: NSBTA.SRT0TexMtxAnimator | null = null;
    public pat0Animator: NSBTP.PAT0TexAnimator | null = null;
    private sortKey: number;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(device: GfxDevice, tex0: TEX0, private model: NSBMD.MDL0Model, public material: NSBMD.MDL0Material) {
        this.texture = tex0.textures.find((t) => t.name === this.material.textureName);
        this.translateTexture(device, tex0, this.material.textureName, this.material.paletteName);
        this.baseCtx = { color: { r: 0xFF, g: 0xFF, b: 0xFF }, alpha: this.material.alpha };

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
        }

        // NITRO's Rendering Engine uses two passes. Opaque, then Transparent.
        // A transparent polygon is one that has an alpha of < 0xFF, or uses
        // A5I3 / A3I5 textures.
        const isTranslucent = (this.material.alpha < 0xFF) || (this.texture && textureFormatIsTranslucent(this.texture.format));
        const xl = !!((this.material.polyAttribs >>> 11) & 0x01);
        const depthWrite = xl || !isTranslucent;

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKeyOpaque(layer, 0);
        this.megaStateFlags = {
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            depthWrite: depthWrite,
            cullMode: this.material.cullMode,
        };
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
            this.translateTexture(device, tex0, texName, plttName);
        }
    }

    private translateTexture(device: GfxDevice, tex0: TEX0, textureName: string, paletteName: string) {
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
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        device.submitPass(hostAccessPass);

        this.viewerTextures.push(textureToCanvas(texture, pixels, fullTextureName));
    }

    public setOnRenderInst(template: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.srt0Animator !== null) {
            this.srt0Animator.calcTexMtx(scratchTexMatrix, this.model.texMtxMode, this.material.texScaleS, this.material.texScaleT);
        } else {
            mat2d.copy(scratchTexMatrix, this.material.texMatrix);
        }

        template.sortKey = this.sortKey;
        template.setMegaStateFlags(this.megaStateFlags);

        if (this.pat0Animator !== null) {
            const fullTextureName = this.pat0Animator.calcFullTextureName();
            let textureIndex = this.textureNames.indexOf(fullTextureName);
            if (textureIndex >= 0)
                this.textureMappings[0].gfxTexture = this.gfxTextures[textureIndex];
        }

        template.setSamplerBindingsFromTextureMappings(this.textureMappings);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_MaterialParams, 12);
        const materialParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_MaterialParams);
        offs += fillMatrix3x2(materialParamsMapped, offs, scratchTexMatrix);
        offs += fillVec4(materialParamsMapped, offs, 0);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTextures.length; i++)
            device.destroyTexture(this.gfxTextures[i]);
        if (this.gfxSampler !== null)
            device.destroySampler(this.gfxSampler);
    }
}

class Node {
    public modelMatrix = mat4.create();
    public billboardY: boolean = false;

    constructor(public node: NSBMD.MDL0Node) {
    }

    public calcMatrix(baseModelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.billboardY) {
            computeModelMatrixYBillboard(this.modelMatrix, viewerInput.camera);
            mat4.mul(this.modelMatrix, this.node.jointMatrix, this.modelMatrix);
        } else {
            mat4.copy(this.modelMatrix, this.node.jointMatrix);
        }

        mat4.mul(this.modelMatrix, baseModelMatrix, this.modelMatrix);
    }
}

const scratchMat4 = mat4.create();
class ShapeInstance {
    private vertexData: VertexData;

    constructor(device: GfxDevice, private materialInstance: MaterialInstance, public node: Node, public shape: NSBMD.MDL0Shape, posScale: number) {
        const baseCtx = this.materialInstance.baseCtx;
        const nitroVertexData = NITRO_GX.readCmds(shape.dlBuffer, baseCtx, posScale);
        this.vertexData = new VertexData(device, nitroVertexData);
    }

    private computeModelView(dst: mat4, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        if (isSkybox) {
            computeViewMatrixSkybox(dst, viewerInput.camera);
        } else {
            computeViewMatrix(dst, viewerInput.camera);
        }

        mat4.mul(dst, dst, this.node.modelMatrix);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.vertexData.inputLayout, this.vertexData.inputState);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_PacketParams, 12*16);
        const packetParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_PacketParams);

        this.computeModelView(scratchMat4, viewerInput, isSkybox);
        offs += fillMatrix4x3(packetParamsMapped, offs, scratchMat4);

        this.materialInstance.setOnRenderInst(template, viewerInput);

        for (let i = 0; i < this.vertexData.nitroVertexData.drawCalls.length; i++) {
            const drawCall = this.vertexData.nitroVertexData.drawCalls[i];
            const renderInst = renderInstManager.pushRenderInst();
            renderInst.drawIndexes(drawCall.numIndices, drawCall.startIndex);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.vertexData.destroy(device);
    }
}

export const enum G3DPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];

export class MDL0Renderer {
    public modelMatrix = mat4.create();
    public isSkybox: boolean = false;
    public animationController = new AnimationController();

    private gfxProgram: GfxProgram;
    private materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    private nodes: Node[] = [];
    public viewerTextures: Viewer.Texture[] = [];

    constructor(device: GfxDevice, public model: NSBMD.MDL0Model, private tex0: TEX0) {
        const program = new NITRO_Program();
        program.defines.set('USE_VERTEX_COLOR', '1');
        program.defines.set('USE_TEXTURE', '1');
        this.gfxProgram = device.createProgram(program);
        const posScale = 50;
        mat4.fromScaling(this.modelMatrix, [posScale, posScale, posScale]);

        for (let i = 0; i < this.model.materials.length; i++)
            this.materialInstances.push(new MaterialInstance(device, this.tex0, this.model, this.model.materials[i]));

        for (let i = 0; i < this.model.nodes.length; i++)
            this.nodes.push(new Node(this.model.nodes[i]));

        for (let i = 0; i < this.materialInstances.length; i++)
            if (this.materialInstances[i].viewerTextures.length > 0)
                this.viewerTextures.push(this.materialInstances[i].viewerTextures[0]);

        this.execSBC(device);
    }

    public bindSRT0(srt0: NSBTA.SRT0, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindSRT0(animationController, srt0);
    }

    public bindPAT0(device: GfxDevice, pat0: NSBTP.PAT0, animationController: AnimationController = this.animationController): void {
        const hostAccessPass = device.createHostAccessPass();
        for (let i = 0; i < this.materialInstances.length; i++) {
            if (this.materialInstances[i].bindPAT0(animationController, pat0))
                this.materialInstances[i].translatePAT0Textures(device, hostAccessPass, this.tex0);
        }
        device.submitPass(hostAccessPass);
    }

    private execSBC(device: GfxDevice) {
        const model = this.model;
        const view = model.sbcBuffer.createDataView();

        const enum Op {
            NOP, RET, NODE, MTX, MAT, SHP, NODEDESC, BB, BBY, NODEMIX, CALLDL, POSSCALE, ENVMAP, PRJMAP,
        };

        let idx = 0;
        let currentNode: Node;
        let currentMaterial: MaterialInstance;
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
                currentNode = this.nodes[nodeIdx];
            } else if (cmd === Op.MTX) {
                const mtxIdx = view.getUint8(idx++);
            } else if (cmd === Op.MAT) {
                const matIdx = view.getUint8(idx++);
                currentMaterial = this.materialInstances[matIdx];
            } else if (cmd === Op.SHP) {
                const shpIdx = view.getUint8(idx++);
                const shape = model.shapes[shpIdx];
                this.shapeInstances.push(new ShapeInstance(device, currentMaterial, currentNode, shape, this.model.posScale));
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
                const nodeIdx = view.getUint8(idx++);
                let destIdx = -1, srcIdx = -1;
                if (opt & 0x01)
                    destIdx = view.getUint8(idx++);
                if (opt & 0x02)
                    srcIdx = view.getUint8(idx++);

                if (opt === 0)
                    this.nodes[nodeIdx].billboardY = true;
            } else if (cmd === Op.POSSCALE) {
                //
            } else {
                throw new Error(`UNKNOWN SBC ${cmd.toString(16)}`);
            }
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        for (let i = 0; i < this.nodes.length; i++)
            this.nodes[i].calcMatrix(this.modelMatrix, viewerInput);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.filterKey = this.isSkybox ? G3DPass.SKYBOX : G3DPass.MAIN;
        template.setGfxProgram(this.gfxProgram);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(renderInstManager, viewerInput, this.isSkybox);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].destroy(device);
    }
}
