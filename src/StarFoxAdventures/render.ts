
import { mat4, vec3 } from 'gl-matrix';
import { CameraController } from '../Camera.js';
import { colorNewFromRGBA8, White } from '../Color.js';
import { setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxDevice, GfxFormat, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrPass, GfxrPassScope, GfxrRenderTargetDescription, GfxrRenderTargetID, GfxrResolveTextureID, GfxrTemporalTexture } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import * as GX from '../gx/gx_enum.js';
import * as GX_Material from '../gx/gx_material.js';
import { DrawParams, fillSceneParamsData, GXMaterialHelperGfx, GXRenderHelperGfx, MaterialParams, SceneParams, ub_SceneParamsBufferSize } from '../gx/gx_render.js';
import { TDDraw } from '../SuperMarioGalaxy/DDraw.js';
import { TextureMapping } from '../TextureHolder.js';
import { nArray } from '../util.js';
import * as Viewer from '../viewer.js';

import { gfxDeviceNeedsFlipY } from '../gfx/helpers/GfxDeviceHelpers.js';
import { getMatrixAxisZ } from '../MathHelpers.js';
import { SceneContext } from '../SceneBase.js';
import { SFAAnimationController } from './animation.js';
import { BlurFilter } from './blur.js';
import { DepthResampler } from './depthresampler.js';
import { HeatShimmerMaterial, MaterialFactory, MaterialRenderContext } from './materials.js';
import { radsToAngle16, vecPitch } from './util.js';
import { World } from './world.js';

export interface SceneUpdateContext {
    viewerInput: Viewer.ViewerRenderInput;
}

export interface SceneRenderContext {
    viewerInput: Viewer.ViewerRenderInput;
    worldToViewMtx: mat4;
    viewToWorldMtx: mat4;
    animController: SFAAnimationController;
    flipYScale: number;
    world?: World;
}

const BACKGROUND_COLOR = colorNewFromRGBA8(0xCCCCCCFF);

export interface SFARenderLists {
    skyscape: GfxRenderInstList;
    world: GfxRenderInstList[/* 3 */];
    waters: GfxRenderInstList;
    furs: GfxRenderInstList;
}

const scratchVec0 = vec3.create();
const scratchSceneParams = new SceneParams();
const scratchDrawParams = new DrawParams();
const scratchMaterialParams = new MaterialParams();

export function setGXMaterialOnRenderInst(renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, materialHelper: GXMaterialHelperGfx, materialParams: MaterialParams, drawParams: DrawParams) {
    materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
    renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
    materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
}

export class SFARenderer implements Viewer.SceneGfx {
    protected world?: World;

    protected renderHelper: GXRenderHelperGfx;
    protected renderLists: SFARenderLists;
    
    private opaqueColorTextureMapping = new TextureMapping();
    private opaqueDepthTextureMapping = new TextureMapping();
    private temporalTextureMapping = new TextureMapping();
    private temporalTexture = new GfxrTemporalTexture();

    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    protected mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);

    private depthResampler: DepthResampler;

    private shimmerddraw = new TDDraw();
    private enableHeatShimmer: boolean = false; // TODO: set by camera triggers
    private heatShimmerMaterial: HeatShimmerMaterial | undefined = undefined;

    constructor(context: SceneContext, protected animController: SFAAnimationController, public materialFactory: MaterialFactory) {
        this.renderHelper = new GXRenderHelperGfx(context.device, context, this.materialFactory.cache);


        this.depthResampler = new DepthResampler(context.device, this.renderHelper.renderInstManager.gfxRenderCache);

        this.shimmerddraw.setVtxDesc(GX.Attr.POS, true);
        this.shimmerddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.shimmerddraw.setVtxDesc(GX.Attr.TEX0, true);

        this.renderLists = {
            skyscape: new GfxRenderInstList(),
            world: nArray(3, () => new GfxRenderInstList()),
            waters: new GfxRenderInstList(),
            furs: new GfxRenderInstList(),
        };

        const cache = this.renderHelper.renderCache;
        this.opaqueColorTextureMapping.gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.opaqueDepthTextureMapping.gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 3); // Slow down the default camera a bit
    }

    public getDefaultWorldMatrix(dst: mat4) {
        mat4.fromYRotation(dst, -Math.PI * 3 / 4); // Aim towards the map by default
    }

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        this.animController.update(viewerInput);
    }

    protected addSkyRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {}
    protected addSkyRenderPasses(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, mainColorTargetID: number, sceneCtx: SceneRenderContext) {}

    protected addWorldRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {}
    protected addWorldRenderPassesInner(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {}

    private renderHeatShimmer(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: GfxrRenderTargetID, sourceColorResolveTextureID: GfxrResolveTextureID, sourceDepthTargetID: GfxrRenderTargetID, sceneCtx: SceneRenderContext) {
        const template = renderInstManager.pushTemplate();

        // Setup to draw in screen space
        mat4.ortho(scratchSceneParams.u_Projection, 0.0, 640.0, 0.0, 480.0, 1.0, 100.0);
        scratchSceneParams.u_SceneTextureLODBias = 0;
        const d = template.allocateUniformBufferF32(GX_Material.GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(d, 0, scratchSceneParams);

        // Extract pitch
        const cameraFwd = scratchVec0;
        getMatrixAxisZ(cameraFwd, sceneCtx.viewerInput.camera.worldMatrix);
        vec3.negate(cameraFwd, cameraFwd);
        const camPitch16 = radsToAngle16(vecPitch(cameraFwd));
        let pitchFactor;
        if (camPitch16 < 0)
            pitchFactor = ((((camPitch16 & 0xffff) >> 8) - 0xc0) * 4) & 0xfc;
        else
            pitchFactor = 0xff;

        const strength = 0xff;
        // const strength = 0xff * ((Math.sin(sceneCtx.animController.envAnimValue0) + 1) / 2); // TODO: controlled by camera triggers
        const a1 = (strength * 0xff) >> 8;
        const a0 = (pitchFactor * strength) >> 8;

        this.shimmerddraw.beginDraw(renderInstManager.gfxRenderCache);
        this.shimmerddraw.begin(GX.Command.DRAW_QUADS);
        this.shimmerddraw.position3f32(0, 0, -8);
        this.shimmerddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, a0);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.0);
        this.shimmerddraw.position3f32(640, 0, -8);
        this.shimmerddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, a0);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.0);
        this.shimmerddraw.position3f32(640, 480, -8);
        this.shimmerddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, a1);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 1.0);
        this.shimmerddraw.position3f32(0, 480, -8);
        this.shimmerddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, a1);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 1.0);
        this.shimmerddraw.end();

        const renderInst = this.shimmerddraw.endDrawAndMakeRenderInst(renderInstManager);

        if (this.heatShimmerMaterial === undefined)
            this.heatShimmerMaterial = new HeatShimmerMaterial(this.materialFactory);

        const matCtx: MaterialRenderContext = {
            sceneCtx,
            modelToViewMtx: mat4.create(),
            viewToModelMtx: mat4.create(),
            ambienceIdx: 0,
            outdoorAmbientColor: White,
            furLayer: 0,
        };
        this.heatShimmerMaterial!.setOnMaterialParams(scratchMaterialParams, matCtx);

        scratchDrawParams.clear();
        setGXMaterialOnRenderInst(renderInstManager, renderInst, this.heatShimmerMaterial!.getGXMaterialHelper(), scratchMaterialParams, scratchDrawParams);

        renderInstManager.popTemplate();

        const resampledDepthTargetID = this.depthResampler.render(device, builder, renderInstManager, sourceDepthTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Heat Shimmer');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            const resampledDepthResolveTextureID = builder.resolveRenderTarget(resampledDepthTargetID);
            // FIXME: heat shimmer uses the opaque scene texture downscaled by 1/2
            pass.attachResolveTexture(sourceColorResolveTextureID);
            // FIXME: depth should also be downscaled by 1/2.
            pass.attachResolveTexture(resampledDepthResolveTextureID);

            pass.exec((passRenderer, scope) => {
                this.opaqueColorTextureMapping.gfxTexture = scope.getResolveTextureForID(sourceColorResolveTextureID);
                renderInst.resolveLateSamplerBinding('opaque-color-texture-downscale-2x', this.opaqueColorTextureMapping);
                this.opaqueDepthTextureMapping.gfxTexture = scope.getResolveTextureForID(resampledDepthResolveTextureID);
                renderInst.resolveLateSamplerBinding('opaque-depth-texture-downscale-2x', this.opaqueDepthTextureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }

    private blurFilter?: BlurFilter;

    private blurTemporalTexture(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager): GfxrRenderTargetID {
        if (this.blurFilter === undefined)
            this.blurFilter = new BlurFilter(this.renderHelper.renderCache);

        return this.blurFilter.render(builder, renderInstManager, this.mainColorDesc.width, this.mainColorDesc.height, this.temporalTexture.getTextureForSampling()!);
    }

    protected attachResolveTexturesForWorldOpaques(builder: GfxrGraphBuilder, pass: GfxrPass) {}
    protected resolveLateSamplerBindingsForWorldOpaques(renderList: GfxRenderInstList, scope: GfxrPassScope) {}

    private addWorldRenderPasses(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID, sceneCtx: SceneRenderContext) {
        this.addWorldRenderPassesInner(device, builder, renderInstManager, sceneCtx);

        let blurTargetID: GfxrRenderTargetID | undefined;
        if (renderLists.world[0].hasLateSamplerBinding('temporal-texture-downscale-8x'))
            blurTargetID = this.blurTemporalTexture(builder, renderInstManager);

        builder.pushPass((pass) => {
            pass.setDebugName('World Opaques');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            let blurResolveID: GfxrResolveTextureID;
            if (blurTargetID !== undefined) {
                blurResolveID = builder.resolveRenderTarget(blurTargetID);
                pass.attachResolveTexture(blurResolveID);
            }

            this.attachResolveTexturesForWorldOpaques(builder, pass);

            pass.exec((passRenderer, scope) => {
                if (blurTargetID !== undefined) {
                    this.temporalTextureMapping.gfxTexture = scope.getResolveTextureForID(blurResolveID);
                    renderLists.world[0].resolveLateSamplerBinding('temporal-texture-downscale-8x', this.temporalTextureMapping);
                }

                this.resolveLateSamplerBindingsForWorldOpaques(renderLists.world[0], scope);

                renderLists.world[0].drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
                renderLists.furs.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);

        if (this.enableHeatShimmer)
            this.renderHeatShimmer(device, builder, renderInstManager, mainColorTargetID, mainColorResolveTextureID, mainDepthTargetID, sceneCtx);

        builder.pushPass((pass) => {
            pass.setDebugName('World Translucents');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                this.opaqueColorTextureMapping.gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                renderLists.waters.resolveLateSamplerBinding('opaque-color-texture-downscale-2x', this.opaqueColorTextureMapping);

                renderLists.waters.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
                renderLists.world[1].drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
                renderLists.world[2].drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }

    protected addHeatShimmerRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        // viewerInput.camera.setClipPlanes(2.5, 10000); // Set near and far planes as in the original game in order to support heat shimmer (TODO: use depth resampler instead)

        this.update(viewerInput);

        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        const sceneCtx: SceneRenderContext = {
            viewerInput,
            worldToViewMtx: mat4.create(),
            viewToWorldMtx: mat4.create(),
            animController: this.animController,
            flipYScale: gfxDeviceNeedsFlipY(device) ? -1 : 1,
            world: this.world,
        };

        mat4.copy(sceneCtx.worldToViewMtx, viewerInput.camera.viewMatrix);
        mat4.invert(sceneCtx.viewToWorldMtx, sceneCtx.worldToViewMtx);

        this.addSkyRenderInsts(device, renderInstManager, this.renderLists, sceneCtx);
        this.addWorldRenderInsts(device, renderInstManager, this.renderLists, sceneCtx);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        setBackbufferDescSimple(this.mainColorDesc, viewerInput);
        this.mainColorDesc.clearColor = BACKGROUND_COLOR;

        this.mainDepthDesc.copyDimensions(this.mainColorDesc);
        this.mainDepthDesc.clearDepth = standardFullClearRenderPassDescriptor.clearDepth;

        this.temporalTexture.setDescription(device, this.mainColorDesc);

        const mainColorTargetID = builder.createRenderTargetID(this.mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Main Depth');

        this.addSkyRenderPasses(device, builder, renderInstManager, this.renderLists, mainColorTargetID, sceneCtx);
        this.addWorldRenderPasses(device, builder, renderInstManager, this.renderLists, mainColorTargetID, mainDepthTargetID, sceneCtx);
        if (this.enableHeatShimmer)
            this.addHeatShimmerRenderInsts(device, renderInstManager, this.renderLists, sceneCtx);
            
        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorTargetID, viewerInput.mouseLocation);

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        // TODO(jstpierre): Make it so that we don't need an extra pass for this blit in the future?
        // Maybe have copyTextureToTexture as a native device method?
        builder.pushPass((pass) => {
            pass.setDebugName('Copy to Temporal Texture');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.temporalTexture.getTextureForResolving());

        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);
    }

    public destroy(device: GfxDevice): void {
        this.materialFactory.destroy(device);
        this.renderHelper.destroy();
        this.temporalTexture.destroy(device);
    }
}
