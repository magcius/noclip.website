
import { mat4, mat2d, vec4 } from "gl-matrix";
import { GfxFormat, GfxDevice, GfxProgram, GfxBindingLayoutDescriptor, GfxTexture, GfxBlendMode, GfxBlendFactor, GfxMipFilterMode, GfxTexFilterMode, GfxSampler, GfxMegaStateDescriptor, makeTextureDescriptor2D, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import * as Viewer from '../viewer.js';
import * as NITRO_GX from '../SuperMario64DS/nitro_gx.js';
import { readTexture, getFormatName, Texture, textureFormatIsTranslucent } from "../SuperMario64DS/nitro_tex.js";
import { NITRO_Program, VertexData } from '../SuperMario64DS/render.js';
import { GfxRenderInstManager, GfxRenderInst, GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderInstManager.js";
import { TextureMapping } from "../TextureHolder.js";
import { fillMatrix4x3, fillMatrix4x4, fillMatrix3x2, fillColor, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers.js";
import { computeViewMatrix } from "../Camera.js";
import AnimationController from "../AnimationController.js";
import { bindMPHT, MPHAnimation, MPHNodeAnimator, MPHTexCoordAnimator } from "./mph_anim.js";
import { nArray, assertExists } from "../util.js";
import { TEX0Texture, PAT0TexAnimator, TEX0 } from "../nns_g3d/NNS_G3D.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { MPHbin, MPHMaterial, MPHNode, MPHShape } from "./mph_binModel.js";
import { CalcBillboardFlags, Vec3Zero, calcBillboardMatrix } from "../MathHelpers.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { White, colorNewCopy } from "../Color.js";

function translateWrapMode(repeat: boolean, flip: boolean): GfxWrapMode {
    if (flip)
        return GfxWrapMode.Mirror;
    else if (repeat)
        return GfxWrapMode.Repeat;
    else
        return GfxWrapMode.Clamp;
}

function parseMPHTexImageParamWrapModeS(w0: number): GfxWrapMode {
    const repeatS = (((w0 >> 0) & 0x01) === 0x1);
    const flipS = (((w0 >> 1) & 0x01) === 0x1);
    return translateWrapMode(repeatS, flipS);
}

function parseMPHTexImageParamWrapModeT(w0: number): GfxWrapMode {
    const repeatT = (((w0 >> 8) & 0x01) === 0x1);
    const flipT = (((w0 >> 9) & 0x01) === 0x1);
    return translateWrapMode(repeatT, flipT);
}

const scratchTexMatrix = mat2d.create();
class MaterialInstance {
    private texture: TEX0Texture | null;
    private gfxTextures: GfxTexture[] = [];
    private textureNames: string[] = [];
    private gfxSampler: GfxSampler | null = null;
    private textureMappings: TextureMapping[] = nArray(1, () => new TextureMapping());
    public viewerTextures: Viewer.Texture[] = [];
    public baseCtx: NITRO_GX.Context;
    public pat0Animator: PAT0TexAnimator | null = null;
    private sortKey: number;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public lightMask = 0x0F;
    public diffuseColor = colorNewCopy(White);
    public ambientColor = colorNewCopy(White);
    public specularColor = colorNewCopy(White);
    public emissionColor = colorNewCopy(White);

    constructor(cache: GfxRenderCache, tex0: TEX0, public material: MPHMaterial, private texCoordAnimator: MPHTexCoordAnimator | null, entityModel: boolean) {
        function expand5to8(n: number): number {
            return (n << (8 - 5)) | (n >>> (10 - 8));
        }

        const device = cache.device;
        const texData = tex0.textures.find((t) => t.name === this.material.textureName);
        this.texture = texData !== undefined ? texData: null;
        this.translateTexture(device, tex0, this.material.textureName, this.material.paletteName, entityModel);
        this.baseCtx = { color: White, alpha: expand5to8(this.material.alpha) };
        if (entityModel) {
            this.diffuseColor = colorNewCopy(this.material.diffuseColor);
            this.ambientColor = colorNewCopy(this.material.ambientColor);
            this.specularColor = colorNewCopy(this.material.specularColor);
            this.lightMask = this.material.lightingEnabled ? 0x03 : 0;
            if (this.material.lightingEnabled)
                this.emissionColor.r = this.emissionColor.g = this.emissionColor.b = 0;
        }

        if (this.gfxTextures.length > 0) {
            this.gfxSampler = cache.createSampler({
                minFilter: GfxTexFilterMode.Point,
                magFilter: GfxTexFilterMode.Point,
                mipFilter: GfxMipFilterMode.Nearest,
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
            blendMode: GfxBlendMode.Add,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
        });
    }

    private translateTexture(device: GfxDevice, tex0: TEX0 | null, textureName: string | null, paletteName: string | null, entityModel: boolean) {
        if (textureName === null) {
            if (!entityModel)
                return;
            const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));
            device.uploadTextureData(gfxTexture, 0, [new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF])]);
            this.gfxTextures.push(gfxTexture);
            this.textureNames.push('(untextured)');
            return;
        }
        if (tex0 === null)
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

        device.uploadTextureData(gfxTexture, 0, [pixels]);

        const extraInfo = new Map<string, string>();
        extraInfo.set('Format', getFormatName(texture.format));
        this.viewerTextures.push({ gfxTexture, extraInfo });
    }

    public setOnRenderInst(template: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.texCoordAnimator !== null) {
            this.texCoordAnimator.calcTexMtx(scratchTexMatrix, this.material.texScaleS, this.material.texScaleT);
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

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_MaterialParams, 8+16);
        const materialParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_MaterialParams);
        offs += fillMatrix3x2(materialParamsMapped, offs, scratchTexMatrix);
        offs += fillColor(materialParamsMapped, offs, this.diffuseColor, 0);
        offs += fillColor(materialParamsMapped, offs, this.ambientColor, this.lightMask);
        offs += fillColor(materialParamsMapped, offs, this.specularColor);
        offs += fillColor(materialParamsMapped, offs, this.emissionColor);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTextures.length; i++)
            device.destroyTexture(this.gfxTextures[i]);
    }
}

class Node {
    public modelMatrix = mat4.create();
    public drawMatrix = mat4.create();
    public parent: Node | null = null;
    public billboardMode: BillboardMode;
    private localMatrix = mat4.create();

    constructor(public node: MPHNode, public index: number) {
        this.billboardMode = node.billboardType;
    }

    public calcMatrix(baseModelMatrix: mat4, viewMatrix: mat4, nodeAnimator: MPHNodeAnimator | null): void {
        if (nodeAnimator !== null)
            nodeAnimator.calcNodeMatrix(this.localMatrix, this.index);
        else
            mat4.copy(this.localMatrix, this.node.transform);
        mat4.mul(this.modelMatrix, this.parent !== null ? this.parent.modelMatrix : baseModelMatrix, this.localMatrix);

        mat4.mul(this.drawMatrix, viewMatrix, this.modelMatrix);
        if (this.billboardMode === BillboardMode.BB)
            calcBillboardMatrix(this.drawMatrix, this.drawMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane);
        else if (this.billboardMode === BillboardMode.BBY)
            calcBillboardMatrix(this.drawMatrix, this.drawMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityY | CalcBillboardFlags.UseZPlane);
    }
}

const scratchViewMatrix = mat4.create();
const scratchLightDirection = vec4.create();
const scratchLightViewMatrix = mat4.create();
const MAX_MATRICES = 32;
class ShapeInstance {
    private vertexData: VertexData;
    private matrixNodes: Node[] = [];

    constructor(cache: GfxRenderCache, private materialInstance: MaterialInstance, public node: Node, public shape: MPHShape, matrixNodes: Map<number, Node>, numMatrices: number) {
        const baseCtx = this.materialInstance.baseCtx;
        for (let i = 0; i < numMatrices; i++)
            this.matrixNodes.push(matrixNodes.get(i) ?? node);
        this.vertexData = new VertexData(cache, NITRO_GX.readCmds(shape.dlBuffer, baseCtx, 1));
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.vertexData.inputLayout, this.vertexData.vertexBufferDescriptors, this.vertexData.indexBufferDescriptor);

        let offs = renderInst.allocateUniformBuffer(NITRO_Program.ub_DrawParams, 12*MAX_MATRICES);
        const drawParamsMapped = renderInst.mapUniformBufferF32(NITRO_Program.ub_DrawParams);

        for (let i = 0; i < this.matrixNodes.length; i++)
            offs += fillMatrix4x3(drawParamsMapped, offs, this.matrixNodes[i].drawMatrix);

        this.materialInstance.setOnRenderInst(renderInst, viewerInput);

        const drawCall = this.vertexData.nitroVertexData.drawCall;
        renderInst.setDrawCount(drawCall.numIndices, drawCall.startIndex);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.vertexData.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];

enum BillboardMode {
    NONE, BB, BBY,
}

export type MPHSceneMode =
    { kind: 'singlePlayer', geometrySet: number } |
    { kind: 'multiplayer', layout: 0 | 1, captureTheFlag?: boolean };

export interface MPHLighting {
    colors: readonly [readonly [number, number, number], readonly [number, number, number]];
    directions: readonly [readonly [number, number, number], readonly [number, number, number]];
}

export interface MPHRendererOptions {
    sceneMode?: MPHSceneMode;
    entityModel?: boolean;
    lighting?: MPHLighting;
    mapAnimationTime?: (timeInMilliseconds: number) => number;
}

// Uniform presentation scale for converting MPH world units to noclip space.
export const MPH_VIEWER_SCALE = 4;

function nodeIsVisibleInMode(name: string, mode: MPHSceneMode): boolean {
    let hasModeTag = false;
    let matchesMode = false;

    // FilterModelNodesByGameModeTags @ 0x0211B004:
    // check consecutive four-byte tags at the beginning of each node name.
    for (let offs = 0; name.charAt(offs) === '_'; offs += 4) {
        hasModeTag = true;
        const tag = name.slice(offs, offs + 4).toLowerCase();
        if (tag.startsWith('_s')) {
            const geometrySet = Number.parseInt(tag.slice(2), 10);
            matchesMode ||= mode.kind === 'singlePlayer' && geometrySet === mode.geometrySet;
        } else if (tag === '_mpu') {
            matchesMode ||= mode.kind === 'multiplayer';
        } else if (tag === '_ml0') {
            matchesMode ||= mode.kind === 'multiplayer' && mode.layout === 0;
        } else if (tag === '_ml1') {
            matchesMode ||= mode.kind === 'multiplayer' && mode.layout === 1;
        } else if (tag === '_ctf') {
            matchesMode ||= mode.kind === 'multiplayer' && mode.captureTheFlag === true;
        }
    }

    return !hasModeTag || matchesMode;
}

export class MPHRenderer {
    public modelMatrix = mat4.create();
    public isSkybox: boolean = false;
    public animationController = new AnimationController();

    private gfxProgram: GfxProgram;
    private materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    private nodes: Node[] = [];
    public modelScale: number;
    private nodeDrawOrder: Node[] = [];
    private nodeAnimator: MPHNodeAnimator | null;
    private sceneMode: MPHSceneMode;
    private lighting: MPHLighting | undefined;
    private mapAnimationTime: MPHRendererOptions['mapAnimationTime'];
    public viewerTextures: Viewer.Texture[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public mphModel: MPHbin, private tex0: TEX0, mphAnimation: MPHAnimation | null, options: MPHRendererOptions) {
        this.sceneMode = options.sceneMode ?? { kind: 'singlePlayer', geometrySet: 1 };
        this.lighting = options.lighting;
        this.mapAnimationTime = options.mapAnimationTime;
        const entityModel = options.entityModel ?? false;
        const program = new NITRO_Program();
        program.defines.set('USE_VERTEX_COLOR', '1');
        program.defines.set('USE_TEXTURE', '1');
        this.gfxProgram = cache.createProgram(program);
        const nodeAnimation = mphAnimation?.node ?? null;
        this.nodeAnimator = nodeAnimation !== null ? new MPHNodeAnimator(this.animationController, nodeAnimation) : null;
        this.modelScale = mphModel.posScale * (1 << mphModel.scaleFactor) * MPH_VIEWER_SCALE;
        mat4.fromScaling(this.modelMatrix, [this.modelScale, this.modelScale, this.modelScale]);

        const texCoordAnimation = mphAnimation?.texCoord ?? null;

        for (let i = 0; i < mphModel.materials.length; i++) {
            const material = mphModel.materials[i];
            const texCoordAnimator = texCoordAnimation !== null ?
                bindMPHT(this.animationController, texCoordAnimation, material.name) : null;
            this.materialInstances.push(new MaterialInstance(cache, this.tex0, material, texCoordAnimator, entityModel));
        }

        for (let i = 0; i < mphModel.nodes.length; i++)
            this.nodes.push(new Node(mphModel.nodes[i], i));
        const addNodeDrawOrder = (index: number, parent: Node | null): void => {
            for (let i = index; i !== -1; i = mphModel.nodes[i].next) {
                const node = this.nodes[i];
                node.parent = parent;
                this.nodeDrawOrder.push(node);
                addNodeDrawOrder(mphModel.nodes[i].child, node);
            }
        };
        if (this.nodes.length !== 0)
            addNodeDrawOrder(0, null);

        const numMatrices = Math.min(Math.max(mphModel.matrixCount, 1), MAX_MATRICES);
        const drawnNodes = new Set(this.nodeDrawOrder);
        const matrixNodes = new Map<number, Node>();
        for (let i = 0; i < mphModel.matrixNodeIndices.length; i++) {
            const node = this.nodes[mphModel.matrixNodeIndices[i]];
            if (mphModel.matrixBlendCounts[i] < 2 && drawnNodes.has(node))
                matrixNodes.set(i, node);
        }

        for (let i = 0; i < this.materialInstances.length; i++)
            if (this.materialInstances[i].viewerTextures.length > 0)
                this.viewerTextures.push(this.materialInstances[i].viewerTextures[0]);

        for (const node of this.nodeDrawOrder) {
            if (!nodeIsVisibleInMode(node.node.name, this.sceneMode))
                continue;

            for (let j = 0; j < node.node.meshCount; j++) {
                const mesh = mphModel.meshs[node.node.meshStart + j];
                const shape = mphModel.shapes[mesh.shapeID];
                this.shapeInstances.push(new ShapeInstance(cache, this.materialInstances[mesh.matID], node, shape, matrixNodes, numMatrices));
            }
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(this.mapAnimationTime !== undefined ?
            this.mapAnimationTime(viewerInput.time) : viewerInput.time);
        computeViewMatrix(scratchViewMatrix, viewerInput.camera);
        for (const node of this.nodeDrawOrder)
            node.calcMatrix(this.modelMatrix, scratchViewMatrix, this.nodeAnimator);

        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.gfxProgram);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16+32);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        computeViewMatrix(scratchLightViewMatrix, viewerInput.camera);
        for (let i = 0; i < 4; i++) {
            const source = this.lighting?.directions[i];
            if (source !== undefined) {
                vec4.set(scratchLightDirection, source[0], source[1], source[2], 0);
                vec4.transformMat4(scratchLightDirection, scratchLightDirection, scratchLightViewMatrix);
            } else {
                vec4.zero(scratchLightDirection);
            }
            offs += fillVec4v(sceneParamsMapped, offs, scratchLightDirection);
        }
        for (let i = 0; i < 4; i++) {
            const color = this.lighting?.colors[i] ?? Vec3Zero;
            offs += fillVec4(sceneParamsMapped, offs, color[0], color[1], color[2], 1);
        }
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(renderInstManager, viewerInput);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].destroy(device);
    }
}
