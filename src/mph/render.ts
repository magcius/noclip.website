
import { mat4, mat2d, vec3 } from "gl-matrix";
import { GfxFormat, GfxDevice, GfxProgram, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxTexture, GfxBlendMode, GfxBlendFactor, GfxMipFilterMode, GfxTexFilterMode, GfxSampler, GfxTextureDimension, GfxMegaStateDescriptor, makeTextureDescriptor2D, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import * as Viewer from '../viewer';
import * as NITRO_GX from '../SuperMario64DS/nitro_gx';
import { readTexture, getFormatName, Texture, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT, textureFormatIsTranslucent } from "../SuperMario64DS/nitro_tex";
import { NITRO_Program, VertexData } from '../SuperMario64DS/render';
import { GfxRenderInstManager, GfxRenderInst, GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderer";
import { TextureMapping } from "../TextureHolder";
import { fillMatrix4x3, fillMatrix4x4, fillMatrix3x2, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { computeViewMatrix, computeViewMatrixSkybox, computeModelMatrixYBillboard } from "../Camera";
import AnimationController from "../AnimationController";
import { nArray, assertExists } from "../util";
import { TEX0Texture, SRT0TexMtxAnimator, PAT0TexAnimator, TEX0, MDL0Model, MDL0Material, SRT0, PAT0, bindPAT0, bindSRT0, MDL0Node, MDL0Shape } from "../nns_g3d/NNS_G3D";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { MPHbin } from "./mph_binModel";

function textureToCanvas(bmdTex: TEX0Texture, pixels: Uint8Array, name: string): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = bmdTex.width;
    canvas.height = bmdTex.height;
    canvas.title = name;

    const ctx = canvas.getContext("2d")!;
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
    public srt0Animator: SRT0TexMtxAnimator | null = null;
    public pat0Animator: PAT0TexAnimator | null = null;
    private sortKey: number;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(device: GfxDevice, tex0: TEX0, private model: MDL0Model, public material: MDL0Material) {

        function expand5to8(n: number): number {
            return (n << (8 - 5)) | (n >>> (10 - 8));
        }


        this.texture = assertExists(tex0.textures.find((t) => t.name === this.material.textureName));
        this.translateTexture(device, tex0, this.material.textureName, this.material.paletteName);
        this.baseCtx = { color: { r: 0xFF, g: 0xFF, b: 0xFF }, alpha: expand5to8(this.material.alpha) };

        if (this.gfxTextures.length > 0) {
            this.gfxSampler = device.createSampler({
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.NO_MIP,
                wrapS: parseMPHTexImageParamWrapModeS(this.material.texParams),
                wrapT: parseMPHTexImageParamWrapModeT(this.material.texParams),
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
        const isTranslucent = (this.material.alpha < 0x1F) || (this.texture && textureFormatIsTranslucent(this.texture.format));
        const xl = !!((this.material.polyAttribs >>> 11) & 0x01);
        const depthWrite = xl || !isTranslucent;

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKeyOpaque(layer, 0);
        this.megaStateFlags = {
            depthWrite: depthWrite,
            cullMode: this.material.cullMode,
        };

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
        });

        function translateWrapMode(repeat: boolean, flip: boolean): GfxWrapMode {
            if (flip)
                return GfxWrapMode.MIRROR;
            else if (repeat)
                return GfxWrapMode.REPEAT;
            else
                return GfxWrapMode.CLAMP;
        }

        function parseMPHTexImageParamWrapModeS(w0: number): GfxWrapMode {
            const repeatS = (((w0 >> 0) & 0x01) == 0x1);
            const flipS = (((w0 >> 1) & 0x01) == 0x1);
            return translateWrapMode(repeatS, flipS);
        }

        function parseMPHTexImageParamWrapModeT(w0: number): GfxWrapMode {
            const repeatT = (((w0 >> 8) & 0x01) == 0x1);
            const flipT = (((w0 >> 9) & 0x01) == 0x1);
            return translateWrapMode(repeatT, flipT);
        }
    }

    //public bindSRT0(animationController: AnimationController, srt0: SRT0): void {
    //    this.srt0Animator = bindSRT0(animationController, srt0, this.material.name);
    //}

    //public bindPAT0(animationController: AnimationController, pat0: PAT0): boolean {
    //    this.pat0Animator = bindPAT0(animationController, pat0, this.material.name);
    //    return this.pat0Animator !== null;
    //}

    //public translatePAT0Textures(device: GfxDevice, hostAccessPass: GfxHostAccessPass, tex0: TEX0): void {
    //    if (this.pat0Animator === null)
    //        return;

    //    while (this.gfxTextures.length > 1) {
    //        device.destroyTexture(this.gfxTextures.pop()!);
    //        this.textureNames.pop();
    //        this.viewerTextures.pop();
    //    }

    //    for (let i = 0; i < this.pat0Animator.matData.animationTrack.length; i++) {
    //        const { texName, plttName } = this.pat0Animator.matData.animationTrack[i];
    //        this.translateTexture(device, tex0, texName, plttName);
    //    }
    //}

    private translateTexture(device: GfxDevice, tex0: TEX0 | null, textureName: string | null, paletteName: string | null) {
        if (tex0 === null || textureName === null)
            return;

        const texture = assertExists(tex0.textures.find((t) => t.name === textureName));
        const palette = paletteName !== null ? assertExists(tex0.palettes.find((t) => t.name === paletteName)) : null;
        const fullTextureName = `${textureName}/${paletteName}`;
        if (this.textureNames.indexOf(fullTextureName) >= 0)
            return;
        this.textureNames.push(fullTextureName);

        const inTexture: Texture = { ...texture, palData: palette !== null ? palette.data : null } as Texture;
        const pixels = readTexture(inTexture);
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
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
    public billboardMode = BillboardMode.NONE;

    constructor(public node: MDL0Node) {
    }

    public calcMatrix(baseModelMatrix: mat4): void {
        mat4.mul(this.modelMatrix, baseModelMatrix, this.node.jointMatrix);
    }
}

function calcBBoardMtx(dst: mat4, m: mat4): void {
    // The column vectors lengths here are the scale.
    const mx = Math.hypot(m[0], m[1], m[2]);
    const my = Math.hypot(m[4], m[5], m[6]);
    const mz = Math.hypot(m[8], m[9], m[10]);

    dst[0] = mx;
    dst[4] = 0;
    dst[8] = 0;
    dst[12] = m[12];

    dst[1] = 0;
    dst[5] = my;
    dst[9] = 0;
    dst[13] = m[13];

    dst[2] = 0;
    dst[6] = 0;
    dst[10] = mz;
    dst[14] = m[14];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

const scratchVec3 = vec3.create();
function calcYBBoardMtx(dst: mat4, m: mat4, v: vec3 = scratchVec3): void {
    // The column vectors lengths here are the scale.
    const mx = Math.hypot(m[0], m[1], m[2]);
    const mz = Math.hypot(m[8], m[9], m[10]);

    vec3.set(v, 0.0, -m[6], m[5]);
    vec3.normalize(v, v);

    dst[0] = mx;
    dst[4] = m[4];
    dst[8] = 0;
    dst[12] = m[12];

    dst[1] = 0;
    dst[5] = m[5];
    dst[9] = v[1] * mz;
    dst[13] = m[13];

    dst[2] = 0;
    dst[6] = m[6];
    dst[10] = v[2] * mz;
    dst[14] = m[14];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    m[3] = 9999.0;
    m[7] = 9999.0;
    m[11] = 9999.0;
    m[15] = 9999.0;
}

const scratchMat4 = mat4.create();
class ShapeInstance {
    private vertexData: VertexData;

    constructor(device: GfxDevice, private materialInstance: MaterialInstance, public node: Node, public shape: MDL0Shape, posScale: number) {
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

        if (this.node.billboardMode === BillboardMode.BB)
            calcBBoardMtx(dst, dst);
        else if (this.node.billboardMode === BillboardMode.BBY)
            calcYBBoardMtx(dst, dst);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.vertexData.inputLayout, this.vertexData.inputState);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_PacketParams, 12*32);
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

const enum BillboardMode {
    NONE, BB, BBY,
}


export class MPHRenderer {
    public modelMatrix = mat4.create();
    public isSkybox: boolean = false;
    public animationController = new AnimationController();

    private gfxProgram: GfxProgram;
    private materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    private nodes: Node[] = [];
    public viewerTextures: Viewer.Texture[] = [];

    constructor(device: GfxDevice, public mphModel: MPHbin, private tex0: TEX0) {
        const program = new NITRO_Program();
        program.defines.set('USE_VERTEX_COLOR', '1');
        program.defines.set('USE_TEXTURE', '1');
        this.gfxProgram = device.createProgram(program);
        let posScale;
        if (mphModel.mtx_shmat <= 0) {
            posScale = 16;
        } else {
            posScale = mphModel.mtx_shmat * 16;
        }
        
        mat4.fromScaling(this.modelMatrix, [posScale, posScale, posScale]);

        const model = mphModel.models[0];

        for (let i = 0; i < model.materials.length; i++)
            this.materialInstances.push(new MaterialInstance(device, this.tex0, model, model.materials[i]));

        for (let i = 0; i < model.nodes.length; i++)
            this.nodes.push(new Node(model.nodes[i]));

        for (let i = 0; i < this.materialInstances.length; i++)
            if (this.materialInstances[i].viewerTextures.length > 0)
                this.viewerTextures.push(this.materialInstances[i].viewerTextures[0]);


        for (let i = 0; i < mphModel.meshs.length; i++) {

            const matIndex = mphModel.meshs[i].matID;
            const shapeIndex = mphModel.meshs[i].shapeID;

            this.shapeInstances.push(new ShapeInstance(device, this.materialInstances[matIndex], this.nodes[0], model.shapes[shapeIndex], posScale));
        }

    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        for (let i = 0; i < this.nodes.length; i++)
            this.nodes[i].calcMatrix(this.modelMatrix);

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
