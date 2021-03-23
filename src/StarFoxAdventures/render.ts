import { mat4, vec3 } from 'gl-matrix';
import * as Viewer from '../viewer';
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import { fillSceneParams, fillSceneParamsData, GXMaterialHelperGfx, GXRenderHelperGfx, MaterialParams, PacketParams, SceneParams } from '../gx/gx_render';
import { GfxDevice, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from '../gfx/platform/GfxPlatform';
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { CameraController } from '../Camera';
import { pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrTemporalTexture } from '../gfx/render/GfxRenderGraph';
import { Color, colorFromARGB8, colorFromRGBA, colorFromRGBA8, colorNewFromRGBA8, White } from '../Color';
import { TextureMapping } from '../TextureHolder';
import { nArray } from '../util';
import { TDDraw } from '../SuperMarioGalaxy/DDraw';

import { SFAAnimationController } from './animation';
import { MaterialBase, MaterialFactory, getKonstColorSel, getTexGenSrc, getTexCoordID, getIndTexStageID, getIndTexMtxID, getKonstAlphaSel, MaterialRenderContext, getPostTexGenMatrix, makeOpaqueColorTexture, makeOpaqueDepthTexture } from './materials';
import { mat4FromRowMajor, mat4SetRowMajor, mat4SetValue, radsToAngle16, vecPitch } from './util';
import { getMatrixAxisZ } from '../MathHelpers';

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
        const texMap0 = this.genTexMap(makeOpaqueColorTexture());
        const texMap1 = this.genTexMap(makeOpaqueDepthTexture());
        const texMap2 = this.genTexMap(this.factory.getWavyTexture());

        const texCoord0 = this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap0));

        const pttexmtx0 = this.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.fromScaling(dst, [7.0, 7.0, 1.0]);
            mat4SetValue(dst, 0, 3, matCtx.sceneCtx.animController.envAnimValue0 * 10.0);
            mat4SetValue(dst, 1, 3, -matCtx.sceneCtx.animController.envAnimValue1 * 10.0);
        });
        const texCoord1 = this.genTexCoord(GX.TexGenType.MTX3x4, getTexGenSrc(texMap0), undefined, undefined, getPostTexGenMatrix(pttexmtx0));

        const k0 = this.genKonstColor((dst: Color) => {
            colorFromRGBA(dst, 0xff, 0xff, 0xff, 0xfc);
        });

        const stage0 = this.genTevStage();
        this.mb.setTevDirect(stage0.id);
        this.setTevOrder(stage0, texCoord0, texMap1);
        // Sample depth texture as if it were I8 (i.e. copy R to all channels)
        const swap3: GX_Material.SwapTable = [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R];
        this.mb.setTevSwapMode(stage0.id, undefined, swap3);
        this.mb.setTevKAlphaSel(stage0.id, getKonstAlphaSel(k0));
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.setTevAlphaFormula(stage0, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA, GX.TevOp.SUB, undefined, GX.TevScale.SCALE_4);

        const indTexMtx0 = this.genIndTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            let s = 0.5 * Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue0 * 10.0);
            let c = 0.5 * Math.cos(3.142 * matCtx.sceneCtx.animController.envAnimValue0 * 10.0);
            mat4SetRowMajor(dst,
                c,   s,   0.0, 0.0, // TODO: This matrix can be tweaked to adjust the draw distance. This may be desirable on high-resolution displays.
                -s,  c,   0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
        });

        const indStage0 = this.genIndTexStage();
        this.setIndTexOrder(indStage0, texCoord1, texMap2);
        this.mb.setIndTexScale(getIndTexStageID(indStage0), GX.IndTexScale._1, GX.IndTexScale._1);

        const stage1 = this.genTevStage();
        this.mb.setTevIndirect(stage1.id, getIndTexStageID(indStage0), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx0), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
        this.setTevOrder(stage1, texCoord0, texMap0);
        this.setTevColorFormula(stage1, GX.CC.TEXC, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV, undefined, undefined, GX.TevScale.SCALE_4);

        const stage2 = this.genTevStage();
        this.mb.setTevDirect(stage2.id);
        this.setTevOrder(stage2, undefined, undefined, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        this.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO, undefined, undefined, GX.TevScale.SCALE_4);

        this.mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        this.mb.setZMode(true, GX.CompareType.GREATER /* FIXME: original game uses LESS? Z order might be reversed. */, false);
        this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    }
}

const scratchVec0 = vec3.create();
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
    
    private opaqueColorTextureMapping = new TextureMapping();
    private opaqueDepthTextureMapping = new TextureMapping();
    private temporalTextureMapping = new TextureMapping();
    private temporalTexture = new GfxrTemporalTexture();

    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    protected mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);

    public materialFactory: MaterialFactory;
    private shimmerddraw = new TDDraw();
    private enableHeatShimmer: boolean = true; // TODO: set by camera triggers
    private heatShimmerMaterial: HeatShimmerMaterial | undefined = undefined;
    // TODO: Merge GXMaterialHelperGfx into SFAMaterial
    private heatShimmerMaterialHelper: GXMaterialHelperGfx | undefined = undefined;

    constructor(device: GfxDevice, protected animController: SFAAnimationController) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.renderHelper.renderInstManager.disableSimpleMode();

        this.materialFactory = new MaterialFactory(device);
        
        this.shimmerddraw.setVtxDesc(GX.Attr.POS, true);
        this.shimmerddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.shimmerddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.shimmerddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.shimmerddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.shimmerddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        this.renderLists = {
            atmosphere: new GfxRenderInstList(),
            skyscape: new GfxRenderInstList(),
            world: nArray(3, () => new GfxRenderInstList()),
            heatShimmer: new GfxRenderInstList(),
            waters: new GfxRenderInstList(),
            furs: new GfxRenderInstList(),
        };

        const cache = this.renderHelper.getCache();
        this.opaqueColorTextureMapping.gfxSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });
        this.opaqueDepthTextureMapping.gfxSampler = cache.createSampler(device, {
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
            pass.setDebugName('World Opaques');
            pass.setViewport(sceneCtx.viewerInput.viewport);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.temporalTextureMapping.gfxTexture = this.temporalTexture.getTextureForSampling();
                renderLists.world[0].resolveLateSamplerBinding('temporal-texture', this.temporalTextureMapping);

                renderInstManager.drawListOnPassRenderer(renderLists.world[0], passRenderer);
                renderInstManager.drawListOnPassRenderer(renderLists.furs, passRenderer);
            });
        });

        // TODO: Downscale to 1/8th scale and apply filtering (?)
        const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);

        if (this.enableHeatShimmer) {
            const mainDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);

            builder.pushPass((pass) => {
                pass.setDebugName('Heat Shimmer');
                pass.setViewport(sceneCtx.viewerInput.viewport);
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                // FIXME: heat shimmer uses the opaque scene texture downscaled by 1/2
                pass.attachResolveTexture(mainColorResolveTextureID);
                // FIXME: depth should also be downscaled by 1/2.
                pass.attachResolveTexture(mainDepthResolveTextureID);

                pass.exec((passRenderer, scope) => {
                    this.opaqueColorTextureMapping.gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                    renderLists.heatShimmer.resolveLateSamplerBinding('opaque-color-texture', this.opaqueColorTextureMapping);
                    this.opaqueDepthTextureMapping.gfxTexture = scope.getResolveTextureForID(mainDepthResolveTextureID);
                    renderLists.heatShimmer.resolveLateSamplerBinding('opaque-depth-texture', this.opaqueDepthTextureMapping);

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
                this.opaqueColorTextureMapping.gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                renderLists.waters.resolveLateSamplerBinding('opaque-color-texture', this.opaqueColorTextureMapping);

                renderInstManager.drawListOnPassRenderer(renderLists.waters, passRenderer);
                renderInstManager.drawListOnPassRenderer(renderLists.world[1], passRenderer);
                renderInstManager.drawListOnPassRenderer(renderLists.world[2], passRenderer);
            });
        });
    }

    protected addHeatShimmerRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        renderInstManager.setCurrentRenderInstList(renderLists.heatShimmer);

        // Call renderHelper.pushTemplateRenderInst (not renderInstManager)
        // to obtain a local SceneParams buffer
        const template = this.renderHelper.pushTemplateRenderInst();

        // Setup to draw in clip space
        fillSceneParams(scratchSceneParams, mat4.create(), sceneCtx.viewerInput.backbufferWidth, sceneCtx.viewerInput.backbufferHeight);
        let offs = template.getUniformBufferOffset(GX_Material.GX_Program.ub_SceneParams);
        const d = template.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams);
        fillSceneParamsData(d, offs, scratchSceneParams);
        
        // Extract pitch
        const cameraFwd = scratchVec0;
        getMatrixAxisZ(cameraFwd, sceneCtx.viewerInput.camera.worldMatrix);
        vec3.negate(cameraFwd, cameraFwd);
        const camPitch16 = radsToAngle16(vecPitch(cameraFwd));
        let factor;
        if (camPitch16 < 0)
            factor = ((((camPitch16 & 0xffff) >> 8) - 0xc0) * 4) & 0xfc;
        else
            factor = 0xff;

        const strength = 0xff * ((Math.sin(sceneCtx.animController.envAnimValue0) + 1) / 2); // TODO: controlled by camera triggers
        const a1 = (strength * 0xff) >> 8;
        const a0 = (factor * strength) >> 8;

        this.shimmerddraw.beginDraw();
        this.shimmerddraw.begin(GX.Command.DRAW_QUADS);
        this.shimmerddraw.position3f32(-1, -1, -1);
        this.shimmerddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, a0);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.0);
        this.shimmerddraw.position3f32(-1, 1, -1);
        this.shimmerddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, a0);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 1.0);
        this.shimmerddraw.position3f32(1, 1, -1);
        this.shimmerddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, a1);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 1.0);
        this.shimmerddraw.position3f32(1, -1, -1);
        this.shimmerddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, a1);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.0);
        this.shimmerddraw.end();

        const renderInst = this.shimmerddraw.makeRenderInst(device, renderInstManager);

        if (this.heatShimmerMaterial === undefined) {
            this.heatShimmerMaterial = new HeatShimmerMaterial(this.materialFactory);
            this.heatShimmerMaterialHelper = new GXMaterialHelperGfx(this.heatShimmerMaterial.getGXMaterial());
        }

        const matCtx = {
            sceneCtx,
            modelViewMtx: mat4.create(),
            invModelViewMtx: mat4.create(),
            outdoorAmbientColor: White,
            furLayer: 0,
        };
        this.heatShimmerMaterial!.setupMaterialParams(scratchMaterialParams, matCtx);
        for (let i = 0; i < 8; i++) {
            const tex = this.heatShimmerMaterial!.getTexture(i);
            if (tex !== undefined)
                tex.setOnTextureMapping(scratchMaterialParams.m_TextureMapping[i], matCtx);
            else
                scratchMaterialParams.m_TextureMapping[i].reset();
        }
        submitScratchRenderInst(device, renderInstManager, this.heatShimmerMaterialHelper!, renderInst, sceneCtx.viewerInput, true, scratchMaterialParams, scratchPacketParams);

        this.shimmerddraw.endAndUpload(device, renderInstManager);

        renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        viewerInput.camera.setClipPlanes(2.5, 10000); // Set near and far planes as in the original game in order to support heat shimmer (FIXME: should be more generous?)

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

        this.temporalTexture.setDescription(device, this.mainColorDesc);

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
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.temporalTexture.getTextureForResolving());

        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.temporalTexture.destroy(device);
    }
}
