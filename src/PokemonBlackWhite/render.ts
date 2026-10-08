import { mat2d, mat4 } from 'gl-matrix';
import AnimationController from '../AnimationController.js';
import { CameraController, computeViewMatrix, computeViewMatrixSkybox } from '../Camera.js';
import { White, colorNewCopy } from '../Color.js';
import { AABB } from '../Geometry.js';
import { Texture, getFormatName, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT, readTexture, textureFormatIsTranslucent } from '../SuperMario64DS/nitro_tex.js';
import { NITRO_Program, VertexData } from '../SuperMario64DS/render.js';
import { TextureMapping } from '../TextureHolder.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { fillColor, fillMatrix3x2, fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxDevice, GfxFormat, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager, GfxRendererLayer, makeSortKeyOpaque } from '../gfx/render/GfxRenderInstManager.js';
import { MDL0Material, MDL0Model, PAT0, SRT0, TEX0, TEX0Texture } from '../nns_g3d/NNS_G3D.js';
import { assertExists, nArray } from '../util.js';
import * as Viewer from '../viewer.js';
import { BWAnimationController, TextureMatrixAnimator, TexturePatternAnimator } from './animation.js';
import { compileModel, bakeDraw, ModelDraw } from './geometry.js';
import * as NITRO_GX from './nitro_gx.js';
import { JointAnimation, sampleJointAnimation } from './nsbca.js';

interface SharedGeometry {
    bounds: AABB;
    shapes: { draw: ModelDraw; vertices: VertexData }[];
}

interface SharedTexture extends Viewer.Texture { sortId: number; }

export class BWRenderResources {
    private nextTextureId = 1;
    private textures = new Map<TEX0Texture, Map<TEX0['palettes'][number] | null, SharedTexture>>();
    private geometry = new Map<MDL0Model, Map<boolean, SharedGeometry>>();

    constructor(public cache: GfxRenderCache) {}

    public getTexture(texture: TEX0Texture, palette: TEX0['palettes'][number] | null): SharedTexture {
        let variants = this.textures.get(texture);
        if (!variants) this.textures.set(texture, variants = new Map());
        let result = variants.get(palette);
        if (!result) {
            const device = this.cache.device;
            const pixels = readTexture({ ...texture, palData: palette?.data ?? null } as Texture);
            const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
            device.setResourceName(gfxTexture, texture.name);
            device.uploadTextureData(gfxTexture, 0, [pixels]);
            result = { gfxTexture, sortId: this.nextTextureId++, extraInfo: new Map([['Format', getFormatName(texture.format)]]) };
            variants.set(palette, result);
        }
        return result;
    }

    public getGeometry(model: MDL0Model, animated: boolean): SharedGeometry {
        let variants = this.geometry.get(model);
        if (!variants) this.geometry.set(model, variants = new Map());
        let result = variants.get(animated);
        if (!result) {
            result = { bounds: new AABB(), shapes: [] };
            result.bounds.reset();
            variants.set(animated, result);
            for (const draw of compileModel(model)) {
                const base = { color: White, alpha: model.materials[draw.materialIndex].alpha };
                const baked = bakeDraw(draw, base.color, base.alpha);
                const vertices = baked.packedVertexBuffer;
                for (let p = 0; p < vertices.length; p += NITRO_GX.VERTEX_SIZE)
                    result.bounds.unionPoint([vertices[p], vertices[p + 1], vertices[p + 2]]);
                const data = animated ? NITRO_GX.readCmds(draw.shape.dlBuffer, base) : baked;
                if (animated) for (let p = 12; p < data.packedVertexBuffer.length; p += NITRO_GX.VERTEX_SIZE)
                    if (data.packedVertexBuffer[p] < 0) data.packedVertexBuffer[p] = 31;
                result.shapes.push({ draw, vertices: new VertexData(this.cache, data) });
            }
        }
        return result;
    }

    public destroy(device: GfxDevice): void {
        for (const variants of this.textures.values()) for (const texture of variants.values()) device.destroyTexture(texture.gfxTexture);
        for (const variants of this.geometry.values()) for (const geometry of variants.values())
            for (const shape of geometry.shapes) shape.vertices.destroy(device);
        this.textures.clear();
        this.geometry.clear();
    }
}

const scratchTexMatrix = mat2d.create();
class MaterialInstance {
    private textureNames: string[] = [];
    private gfxTextures: GfxTexture[] = [];
    private gfxSampler: GfxSampler | null = null;
    private textureMappings: TextureMapping[] = nArray(1, () => new TextureMapping());
    public viewerTextures: Viewer.Texture[] = [];
    public baseCtx: NITRO_GX.Context;
    public srt0Animator: TextureMatrixAnimator | null = null;
    public pat0Animator: TexturePatternAnimator | null = null;
    public lightMask = 0x0F;
    public diffuseColor = colorNewCopy(White);
    public ambientColor = colorNewCopy(White);
    public specularColor = colorNewCopy(White);
    public emissionColor = colorNewCopy(White);
    private sortKey: number;
    private textureSortId = 0;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public visible = true;

    constructor(private resources: BWRenderResources, tex0: TEX0, private model: MDL0Model, public material: MDL0Material) {
        const cache = resources.cache;
        this.baseCtx = { color: White, alpha: this.material.alpha };

        const device = cache.device;
        const texture = this.translateTexture(device, tex0, this.material.textureName, this.material.paletteName);
        if (texture !== null) {
            this.gfxSampler = cache.createSampler({
                minFilter: GfxTexFilterMode.Point,
                magFilter: GfxTexFilterMode.Point,
                mipFilter: GfxMipFilterMode.Nearest,
                wrapS: parseTexImageParamWrapModeS(this.material.texParams),
                wrapT: parseTexImageParamWrapModeT(this.material.texParams),
                minLOD: 0,
                maxLOD: 100,
            });

            const textureMapping = this.textureMappings[0];
            textureMapping.gfxTexture = this.gfxTextures[0];
            textureMapping.gfxSampler = this.gfxSampler;
        }

        const isTranslucent = (this.material.alpha < 0xFF) || (texture !== null && textureFormatIsTranslucent(texture.format));
        const xl = !!((this.material.polyAttribs >>> 11) & 0x01);
        const depthWrite = xl || !isTranslucent;

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKeyOpaque(layer, isTranslucent ? 0 : this.textureSortId);
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

    public bindSRT0(animationController: AnimationController, srt0: SRT0): void {
        const entry = srt0.entries.find((e) => e.name === this.material.name);
        this.srt0Animator = entry ? new TextureMatrixAnimator(animationController, srt0, entry) : null;
    }

    public bindPAT0(animationController: AnimationController, pat0: PAT0): boolean {
        const entry = pat0.entries.find((e) => e.name === this.material.name);
        this.pat0Animator = entry ? new TexturePatternAnimator(animationController, pat0, entry) : null;
        return this.pat0Animator !== null;
    }

    public translatePAT0Textures(device: GfxDevice, tex0: TEX0): void {
        if (this.pat0Animator === null)
            return;

        for (let i = 0; i < this.pat0Animator.matData.animationTrack.length; i++) {
            const { texName, plttName } = this.pat0Animator.matData.animationTrack[i];
            this.translateTexture(device, tex0, texName, plttName);
        }
    }

    private translateTexture(device: GfxDevice, tex0: TEX0 | null, textureName: string | null, paletteName: string | null): TEX0Texture | null {
        if (tex0 === null || textureName === null)
            return null;

        const texture = assertExists(tex0.textures.find((t) => t.name === textureName));
        const palette = paletteName !== null ? assertExists(tex0.palettes.find((t) => t.name === paletteName)) : null;
        const fullTextureName = `${textureName}/${paletteName}`;
        if (this.textureNames.indexOf(fullTextureName) >= 0)
            return texture;
        this.textureNames.push(fullTextureName);

        const shared = this.resources.getTexture(texture, palette);
        this.gfxTextures.push(shared.gfxTexture);
        if (this.gfxTextures.length === 1) this.textureSortId = shared.sortId;
        this.viewerTextures.push(shared);

        return texture;
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
            const textureIndex = this.textureNames.indexOf(fullTextureName);
            if (textureIndex >= 0)
                this.textureMappings[0].gfxTexture = this.gfxTextures[textureIndex];
        }

        template.setSamplerBindingsFromTextureMappings(this.textureMappings);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_MaterialParams, 8+16);
        const d = template.mapUniformBufferF32(NITRO_Program.ub_MaterialParams);
        offs += fillMatrix3x2(d, offs, scratchTexMatrix);
        offs += fillColor(d, offs, this.diffuseColor, 0);
        offs += fillColor(d, offs, this.ambientColor, this.lightMask);
        offs += fillColor(d, offs, this.specularColor);
        offs += fillColor(d, offs, this.emissionColor);
    }


}

const scratchMat4 = mat4.create();
const scratchDrawMatrix = mat4.create();
class ShapeInstance {
    public animatedDraw: ModelDraw | null;

    constructor(private materialInstance: MaterialInstance, private vertexData: VertexData, draw: ModelDraw, animated: boolean) {
        this.animatedDraw = animated ? draw : null;
    }

    private computeModelView(dst: mat4, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, modelMatrix: mat4): void {
        if (isSkybox) {
            computeViewMatrixSkybox(dst, viewerInput.camera);
        } else {
            computeViewMatrix(dst, viewerInput.camera);
        }

        mat4.mul(dst, dst, modelMatrix);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, modelMatrix: mat4): void {
        if (!this.materialInstance.visible)
            return;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.vertexData.inputLayout, this.vertexData.vertexBufferDescriptors, this.vertexData.indexBufferDescriptor);

        if (this.animatedDraw !== null) {
            let offs = renderInst.allocateUniformBuffer(NITRO_Program.ub_DrawParams, 12 * 32);
            const drawParamsMapped = renderInst.mapUniformBufferF32(NITRO_Program.ub_DrawParams);
            this.computeModelView(scratchMat4, viewerInput, isSkybox, modelMatrix);
            for (let i = 0; i < 32; i++) {
                mat4.mul(scratchDrawMatrix, scratchMat4, this.animatedDraw.matrices[i] ?? this.animatedDraw.currentMatrix);
                offs += fillMatrix4x3(drawParamsMapped, offs, scratchDrawMatrix);
            }
        }

        this.materialInstance.setOnRenderInst(renderInst, viewerInput);

        const drawCall = this.vertexData.nitroVertexData.drawCall;
        renderInst.setDrawCount(drawCall.numIndices, drawCall.startIndex);
        renderInstManager.submitRenderInst(renderInst);
    }


}

export const nnsG3dBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];

export class MDL0Renderer {
    private visible = true;
    public modelMatrix = mat4.create();
    public isSkybox: boolean = false;
    public animationController = new BWAnimationController();

    private gfxProgram: GfxProgram;
    public materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    public viewerTextures: Viewer.Texture[] = [];
    public bbox: AABB | null = null;
    public localBounds = new AABB();

    constructor(private resources: BWRenderResources, public model: MDL0Model, private tex0: TEX0, public jointAnimation?: JointAnimation) {
        const cache = resources.cache;
        const program = new NITRO_Program();
        program.defines.set('USE_VERTEX_COLOR', '1');
        program.defines.set('USE_TEXTURE', '1');
        this.gfxProgram = cache.createProgram(program);

        for (let i = 0; i < this.model.materials.length; i++)
            this.materialInstances.push(new MaterialInstance(resources, this.tex0, this.model, this.model.materials[i]));

        for (let i = 0; i < this.materialInstances.length; i++)
            if (this.materialInstances[i].viewerTextures.length > 0)
                this.viewerTextures.push(this.materialInstances[i].viewerTextures[0]);

        this.localBounds.reset();
        this.execSBC();
    }

    public bindSRT0(srt0: SRT0, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindSRT0(animationController, srt0);
    }

    public bindPAT0(device: GfxDevice, pat0: PAT0, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++) {
            if (this.materialInstances[i].bindPAT0(animationController, pat0))
                this.materialInstances[i].translatePAT0Textures(device, this.tex0);
        }
    }

    private execSBC(): void {
        const geometry = this.resources.getGeometry(this.model, this.jointAnimation !== undefined);
        this.localBounds.copy(geometry.bounds);
        for (const { draw, vertices } of geometry.shapes)
            this.shapeInstances.push(new ShapeInstance(assertExists(this.materialInstances[draw.materialIndex]), vertices, draw, this.jointAnimation !== undefined));
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;
        if (!this.jointAnimation && this.bbox !== null && !viewerInput.camera.frustum.contains(this.bbox))
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(nnsG3dBindingLayouts);
        template.setGfxProgram(this.gfxProgram);

        if (!this.jointAnimation) {
            if (this.isSkybox) computeViewMatrixSkybox(scratchMat4, viewerInput.camera);
            else computeViewMatrix(scratchMat4, viewerInput.camera);
            mat4.mul(scratchMat4, scratchMat4, this.modelMatrix);
            const offset = template.allocateUniformBuffer(NITRO_Program.ub_DrawParams, 12 * 32);
            fillMatrix4x3(template.mapUniformBufferF32(NITRO_Program.ub_DrawParams), offset, scratchMat4);
        }

        if (this.jointAnimation) {
            const draws = compileModel(this.model, sampleJointAnimation(this.jointAnimation, this.model, this.animationController.getTimeInFrames()));
            for (let i = 0; i < draws.length; i++) this.shapeInstances[i].animatedDraw = draws[i];
        }
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(renderInstManager, viewerInput, this.isSkybox, this.modelMatrix);

        renderInstManager.popTemplate();
    }


}

export class PokemonBlackWhiteRenderer implements Viewer.SceneGfx {
    public modelRenderers: MDL0Renderer[] = [];
    public renderHelper: GfxRenderHelper;
    public resources: BWRenderResources;
    private renderInstList = new GfxRenderInstList();
    private destroyed = false;
    public target: [number, number, number] = [0, 0, 0];
    public distance = 1200;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
        this.resources = new BWRenderResources(this.renderHelper.renderCache);
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(4);
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        const [x, y, z] = this.target;
        mat4.targetTo(dst, [x, y + this.distance, z + this.distance], this.target, [0, 1, 0]);
    }

    public render(device: GfxDevice, input: Viewer.ViewerRenderInput): void {
        input.camera.setClipPlanes(1, 100000);
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const color = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, input, standardFullClearRenderPassDescriptor), 'Main Color');
        const depth = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, input, standardFullClearRenderPassDescriptor), 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Unova');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, color);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, depth);
            pass.exec((renderer) => this.renderInstList.drawOnPassRenderer(this.renderHelper.renderCache, renderer));
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, input, color);
        builder.resolveRenderTargetToExternalTexture(color, input.onscreenTexture);
        const manager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(nnsG3dBindingLayouts);
        template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 48);
        const params = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        params.fill(0);
        fillMatrix4x4(params, 0, input.camera.projectionMatrix);
        manager.setCurrentList(this.renderInstList);
        for (const object of this.modelRenderers) object.prepareToRender(manager, input);
        manager.popTemplate();
        this.renderHelper.prepareToRender();
        builder.execute();
        this.renderInstList.reset();
    }

    public destroy(device: GfxDevice): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.modelRenderers.length = 0;
        this.resources.destroy(device);
        this.renderHelper.destroy();
    }
}
