import { mat4 } from 'gl-matrix';
import * as Viewer from '../viewer';
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import { fillSceneParams, fillSceneParamsData, GXMaterialHelperGfx, GXRenderHelperGfx, MaterialParams, PacketParams, SceneParams } from '../gx/gx_render';
import { GfxDevice, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from '../gfx/platform/GfxPlatform';
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { CameraController } from '../Camera';
import { pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrTemporalTexture } from '../gfx/render/GfxRenderGraph';
import { Color, colorFromRGBA, colorNewFromRGBA8, White } from '../Color';
import { TextureMapping } from '../TextureHolder';
import { nArray } from '../util';
import { TDDraw } from '../SuperMarioGalaxy/DDraw';

import { SFAAnimationController } from './animation';
import { MaterialBase, MaterialFactory, makeSceneMaterialTexture, getKonstColorSel, getTexGenSrc, getTexCoordID, getIndTexStageID, getIndTexMtxID, getKonstAlphaSel, MaterialRenderContext } from './materials';
import { mat4SetRowMajor, mat4SetValue } from './util';

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
        const texMap0 = this.genTexMap(makeSceneMaterialTexture());
        const texMap1 = this.genTexMap(this.factory.getWavyTexture());
        
        const k0 = this.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
            const alpha = matCtx.sceneCtx.animController.envAnimValue1 * 0xff; // TODO: adjusts strength of shimmer
            // const alpha = 0xff;
            colorFromRGBA(dst, 0, 0, 0x80/0xff, alpha/0xff);
        });
        const k1 = this.genKonstColor((dst: Color) => {
            colorFromRGBA(dst, 0x80/0xff, 0x80/0xff, 0, 0);
        });
        const k2 = this.genKonstColor((dst: Color) => {
            colorFromRGBA(dst, 0, 0x80/0xff, 0, 0);
        });
        const k3 = this.genKonstColor((dst: Color) => {
            colorFromRGBA(dst, 0x80/0xff, 0, 0x80/0xff, 0);
        });

        // Stage 0 is blank because ALPHA_BUMP_N cannot be used until later stages.
        const stage0 = this.genTevStage();
        this.mb.setTevDirect(stage0.id);
        this.setTevOrder(stage0);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        const texCoord0 = this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap0));

        this.texMtx[0] = (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.fromScaling(dst, [0.2, 0.2, 1.0]);
            mat4SetValue(dst, 1, 3, -matCtx.sceneCtx.animController.envAnimValue0);
        };
        const texCoord1 = this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap0), GX.TexGenMatrix.TEXMTX0);

        const rot45 = mat4.create();
        mat4.fromZRotation(rot45, Math.PI / 4);
        this.texMtx[1] = (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.fromScaling(dst, [0.25, 0.25, 1.0]);
            mat4.mul(dst, rot45, dst);
            mat4SetValue(dst, 0, 3, matCtx.sceneCtx.animController.envAnimValue1);
            mat4SetValue(dst, 1, 3, matCtx.sceneCtx.animController.envAnimValue1);
        };
        const texCoord2 = this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap0), GX.TexGenMatrix.TEXMTX1);

        const indStage0 = this.genIndTexStage();
        this.setIndTexOrder(indStage0, texCoord1, texMap1);
        this.mb.setIndTexScale(getIndTexStageID(indStage0), GX.IndTexScale._1, GX.IndTexScale._1);

        const indTexMtx0 = this.genIndTexMtx((dst: mat4) => {
            mat4SetRowMajor(dst, 
                0.5, 0.0, 0.0, 0.0,
                0.0, 0.5, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
        });

        const stage1 = this.genTevStage();
        this.mb.setTevIndirect(stage1.id, getIndTexStageID(indStage0), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx0), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.S);
        this.setTevOrder(stage1, undefined, undefined, GX.RasColorChannelID.ALPHA_BUMP_N);
        this.setTevColorFormula(stage1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);

        const indStage1 = this.genIndTexStage();
        this.setIndTexOrder(indStage1, texCoord2, texMap1);
        this.mb.setIndTexScale(getIndTexStageID(indStage1), GX.IndTexScale._1, GX.IndTexScale._1);
        
        const indTexMtx1 = this.genIndTexMtx((dst: mat4) => {
            mat4SetRowMajor(dst, 
                0.5, 0.0, 0.0, 0.0,
                0.0, 0.5, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
        });

        const stage2 = this.genTevStage();
        this.mb.setTevIndirect(stage2.id, getIndTexStageID(indStage1), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.S);
        this.setTevOrder(stage2, texCoord0, texMap0, GX.RasColorChannelID.ALPHA_BUMP_N);
        this.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        this.setTevAlphaFormula(stage2, GX.CA.APREV, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA, undefined, undefined, GX.TevScale.DIVIDE_2);

        const stage3 = this.genTevStage();
        this.mb.setTevDirect(stage3.id);
        this.setTevOrder(stage3);
        this.mb.setTevKColorSel(stage3.id, getKonstColorSel(k0));
        this.mb.setTevKAlphaSel(stage3.id, GX.KonstAlphaSel.KASEL_4_8);
        this.setTevColorFormula(stage3, GX.CC.ZERO, GX.CC.KONST, GX.CC.CPREV, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG0);
        this.setTevAlphaFormula(stage3, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV, GX.TevOp.SUB, undefined, GX.TevScale.SCALE_2, undefined, GX.Register.REG0);

        const stage4 = this.genTevStage();
        this.mb.setTevDirect(stage4.id);
        this.setTevOrder(stage4);
        this.mb.setTevKColorSel(stage4.id, getKonstColorSel(k1));
        this.mb.setTevKAlphaSel(stage4.id, GX.KonstAlphaSel.KASEL_4_8);
        this.setTevColorFormula(stage4, GX.CC.KONST, GX.CC.ZERO, GX.CC.CPREV, GX.CC.C0, undefined, undefined, undefined, undefined, GX.Register.REG0);
        this.setTevAlphaFormula(stage4, GX.CA.APREV, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST, GX.TevOp.SUB, undefined, GX.TevScale.SCALE_2, undefined, GX.Register.REG1);

        const stage5 = this.genTevStage();
        this.mb.setTevDirect(stage5.id);
        this.setTevOrder(stage5);
        this.mb.setTevKColorSel(stage5.id, getKonstColorSel(k2));
        this.setTevColorFormula(stage5, GX.CC.ZERO, GX.CC.KONST, GX.CC.CPREV, GX.CC.ZERO, undefined, undefined, undefined, undefined, GX.Register.REG1);
        this.setTevAlphaFormula(stage5, GX.CA.A0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A1);

        const stage6 = this.genTevStage();
        this.mb.setTevDirect(stage6.id);
        this.mb.setTevKColorSel(stage6.id, getKonstColorSel(k3));
        this.mb.setTevKAlphaSel(stage6.id, GX.KonstAlphaSel.KASEL_4_8);
        this.setTevOrder(stage6);
        this.setTevColorFormula(stage6, GX.CC.KONST, GX.CC.ZERO, GX.CC.CPREV, GX.CC.C1, undefined, undefined, undefined, undefined, GX.Register.REG1);
        this.setTevAlphaFormula(stage6, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

        const stage7 = this.genTevStage();
        this.mb.setTevDirect(stage7.id);
        this.mb.setTevKAlphaSel(stage7.id, getKonstAlphaSel(k0));
        this.setTevOrder(stage7);
        this.setTevColorFormula(stage7, GX.CC.C1, GX.CC.C0, GX.CC.APREV, GX.CC.ZERO);
        this.setTevAlphaFormula(stage7, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);

        this.mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        this.mb.setCullMode(GX.CullMode.NONE);
        this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        this.mb.setZMode(false, GX.CompareType.ALWAYS, false);
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
        this.shimmerddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.shimmerddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
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
                // FIXME: heat shimmer uses the opaque scene texture downscaled by 1/2
                pass.attachResolveTexture(mainColorResolveTextureID);

                pass.exec((passRenderer, scope) => {
                    this.opaqueSceneTextureMapping.gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                    renderLists.heatShimmer.resolveLateSamplerBinding('opaque-scene-texture', this.opaqueSceneTextureMapping);

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
        renderInstManager.setCurrentRenderInstList(renderLists.heatShimmer);

        // Call renderHelper.pushTemplateRenderInst (not renderInstManager)
        // to obtain a local SceneParams buffer
        const template = this.renderHelper.pushTemplateRenderInst();

        // Setup to draw in clip space
        fillSceneParams(scratchSceneParams, mat4.create(), sceneCtx.viewerInput.backbufferWidth, sceneCtx.viewerInput.backbufferHeight);
        let offs = template.getUniformBufferOffset(GX_Material.GX_Program.ub_SceneParams);
        const d = template.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams);
        fillSceneParamsData(d, offs, scratchSceneParams);

        this.shimmerddraw.beginDraw();
        this.shimmerddraw.begin(GX.Command.DRAW_QUADS);
        this.shimmerddraw.position3f32(-1, -1, -1);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.0);
        this.shimmerddraw.position3f32(-1, 1, -1);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 1.0);
        this.shimmerddraw.position3f32(1, 1, -1);
        this.shimmerddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 1.0);
        this.shimmerddraw.position3f32(1, -1, -1);
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
