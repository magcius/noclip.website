import * as Viewer from '../viewer';
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import { fillSceneParams, fillSceneParamsData, GXMaterialHelperGfx, GXRenderHelperGfx, MaterialParams, PacketParams, SceneParams } from '../gx/gx_render';
import { GfxDevice, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from '../gfx/platform/GfxPlatform';
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { CameraController } from '../Camera';
import { pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrTemporalTexture } from '../gfx/render/GfxRenderGraph';
import { colorNewFromRGBA8, White } from '../Color';
import { TextureMapping } from '../TextureHolder';
import { nArray } from '../util';
import { mat4 } from 'gl-matrix';

import { SFAAnimationController } from './animation';
import { MaterialBase, MaterialFactory } from './materials';
import { TDDraw } from '../SuperMarioGalaxy/DDraw';
import { ColorFlagStart } from '../PokemonSnap/room';
import { Material } from '../SuperMario64DS/sm64ds_bmd';

export interface SceneRenderContext {
    viewerInput: Viewer.ViewerRenderInput;
    animController: SFAAnimationController;
}

const BACKGROUND_COLOR = colorNewFromRGBA8(0xCCCCCCFF);

export interface SFARenderLists {
    atmosphere: GfxRenderInstList;
    skyscape: GfxRenderInstList;
    world: GfxRenderInstList[/* 3 */];
    heatShimmer: GfxRenderInstList;
    waters: GfxRenderInstList;
    furs: GfxRenderInstList;
}

class HeatShimmerMaterial extends MaterialBase {
    protected rebuildInternal() {
        // TODO
    }
}

const scratchSceneParams = new SceneParams();
const scratchMaterialParams = new MaterialParams();
const scratchPacketParams = new PacketParams();

export function submitScratchRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, renderInst: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput, noViewMatrix: boolean = false, materialParams: MaterialParams, packetParams: PacketParams): void {
    materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
    renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
    if (noViewMatrix)
        mat4.identity(packetParams.u_PosMtx[0]);
    else
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
    materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
    renderInstManager.submitRenderInst(renderInst);
}

export class SFARenderer implements Viewer.SceneGfx {
    protected renderHelper: GXRenderHelperGfx;
    protected renderLists: SFARenderLists;
    
    private opaqueSceneTextureMapping = new TextureMapping();
    private sceneTexture = new GfxrTemporalTexture();

    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    protected mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);

    public materialFactory: MaterialFactory;
    protected ddraw = new TDDraw();
    private enableHeatShimmer: boolean = false; // TODO: set by camera triggers
    private heatShimmerMaterial: HeatShimmerMaterial | undefined = undefined;
    // TODO: Merge GXMaterialHelperGfx into SFAMaterial
    private heatShimmerMaterialHelper: GXMaterialHelperGfx | undefined = undefined;

    constructor(device: GfxDevice, protected animController: SFAAnimationController) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.renderHelper.renderInstManager.disableSimpleMode();

        this.materialFactory = new MaterialFactory(device);

        this.renderLists = {
            atmosphere: new GfxRenderInstList(),
            skyscape: new GfxRenderInstList(),
            world: nArray(3, () => new GfxRenderInstList()),
            heatShimmer: new GfxRenderInstList(),
            waters: new GfxRenderInstList(),
            furs: new GfxRenderInstList(),
        };

        const cache = this.renderHelper.getCache();
        this.opaqueSceneTextureMapping.gfxSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 3); // Slow down the default camera a bit
    }

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        this.animController.update(viewerInput);
    }

    protected addSkyRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {}
    protected addSkyRenderPasses(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, mainColorTargetID: number, mainDepthTargetID: number, sceneCtx: SceneRenderContext) {}

    protected addWorldRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {}

    private addWorldRenderPasses(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, mainColorTargetID: number, mainDepthTargetID: number, sceneCtx: SceneRenderContext) {
        builder.pushPass((pass) => {
            pass.setDebugName('World Opaque');
            pass.setViewport(sceneCtx.viewerInput.viewport);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.opaqueSceneTextureMapping.gfxTexture = this.sceneTexture.getTextureForSampling();
                renderLists.world[0].resolveLateSamplerBinding('previous-frame-texture', this.opaqueSceneTextureMapping);

                renderInstManager.drawListOnPassRenderer(renderLists.world[0], passRenderer);
                renderInstManager.drawListOnPassRenderer(renderLists.furs, passRenderer);
            });
        });

        // TODO: Downscale to 1/8th scale and apply filtering (?)
        const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);

        if (this.enableHeatShimmer) {
            builder.pushPass((pass) => {
                pass.setDebugName('Heat Shimmer');
                pass.setViewport(sceneCtx.viewerInput.viewport);
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                pass.attachResolveTexture(mainColorResolveTextureID);
                pass.exec((passRenderer) => {
                    renderInstManager.drawListOnPassRenderer(renderLists.heatShimmer, passRenderer);
                });
            });
        }

        builder.pushPass((pass) => {
            pass.setDebugName('World Translucents');
            pass.setViewport(sceneCtx.viewerInput.viewport);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                this.opaqueSceneTextureMapping.gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                renderLists.waters.resolveLateSamplerBinding('opaque-scene-texture', this.opaqueSceneTextureMapping);

                renderInstManager.drawListOnPassRenderer(renderLists.waters, passRenderer);
                renderInstManager.drawListOnPassRenderer(renderLists.world[1], passRenderer);
                renderInstManager.drawListOnPassRenderer(renderLists.world[2], passRenderer);
            });
        });
    }

    protected addHeatShimmerRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        renderInstManager.setCurrentRenderInstList(renderLists.atmosphere);

        // Call renderHelper.pushTemplateRenderInst (not renderInstManager)
        // to obtain a local SceneParams buffer
        const template = this.renderHelper.pushTemplateRenderInst();

        // Setup to draw in clip space
        fillSceneParams(scratchSceneParams, mat4.create(), sceneCtx.viewerInput.backbufferWidth, sceneCtx.viewerInput.backbufferHeight);
        let offs = template.getUniformBufferOffset(GX_Material.GX_Program.ub_SceneParams);
        const d = template.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams);
        fillSceneParamsData(d, offs, scratchSceneParams);

        this.ddraw.beginDraw();
        this.ddraw.begin(GX.Command.DRAW_QUADS);
        this.ddraw.position3f32(-1, -1, -1);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.0);
        this.ddraw.position3f32(-1, 1, -1);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 1.0);
        this.ddraw.position3f32(1, 1, -1);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 1.0);
        this.ddraw.position3f32(1, -1, -1);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.0);
        this.ddraw.end();

        const renderInst = this.ddraw.makeRenderInst(device, renderInstManager);

        if (this.heatShimmerMaterial === undefined) {
            this.heatShimmerMaterial = new HeatShimmerMaterial(this.materialFactory);
            this.heatShimmerMaterialHelper = new GXMaterialHelperGfx(this.heatShimmerMaterial.getGXMaterial());
        }

        this.heatShimmerMaterial!.setupMaterialParams(scratchMaterialParams, {
            sceneCtx,
            modelViewMtx: mat4.create(),
            invModelViewMtx: mat4.create(),
            outdoorAmbientColor: White,
            furLayer: 0,
        });
        submitScratchRenderInst(device, renderInstManager, this.heatShimmerMaterialHelper!, renderInst, sceneCtx.viewerInput, true, scratchMaterialParams, scratchPacketParams);

        this.ddraw.endAndUpload(device, renderInstManager);

        renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        this.update(viewerInput);

        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        const sceneCtx: SceneRenderContext = {
            viewerInput,
            animController: this.animController,
        };

        this.addSkyRenderInsts(device, renderInstManager, this.renderLists, sceneCtx);
        this.addWorldRenderInsts(device, renderInstManager, this.renderLists, sceneCtx);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        setBackbufferDescSimple(this.mainColorDesc, viewerInput);
        this.mainColorDesc.colorClearColor = BACKGROUND_COLOR;

        this.mainDepthDesc.copyDimensions(this.mainColorDesc);
        this.mainDepthDesc.depthClearValue = standardFullClearRenderPassDescriptor.depthClearValue;

        this.sceneTexture.setDescription(device, this.mainColorDesc);

        const mainColorTargetID = builder.createRenderTargetID(this.mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Main Depth');

        this.addSkyRenderPasses(builder, renderInstManager, this.renderLists, mainColorTargetID, mainDepthTargetID, sceneCtx);
        this.addWorldRenderPasses(builder, renderInstManager, this.renderLists, mainColorTargetID, mainDepthTargetID, sceneCtx);
        if (this.enableHeatShimmer)
            this.addHeatShimmerRenderInsts(device, renderInstManager, this.renderLists, sceneCtx);

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        // TODO(jstpierre): Make it so that we don't need an extra pass for this blit in the future?
        // Maybe have copyTextureToTexture as a native device method?
        builder.pushPass((pass) => {
            pass.setDebugName('Copy to Temporal Texture');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.sceneTexture.getTextureForResolving());

        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.sceneTexture.destroy(device);
    }
}
