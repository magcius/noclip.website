import { mat4, vec3 } from 'gl-matrix';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from '../gfx/render/GfxRenderGraph';
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { DrawParams, GXMaterialHelperGfx, MaterialParams, fillSceneParamsDataOnTemplate, SceneParams, fillSceneParams, fillSceneParamsData, GXRenderHelperGfx } from '../gx/gx_render';
import { getMatrixAxisZ } from '../MathHelpers';

import { ObjectRenderContext } from './objects';
import { SceneRenderContext, SFARenderLists, setGXMaterialOnRenderInst } from './render';
import { vecPitch } from './util';
import { getCamPos } from './util';
import { World } from './world';

const materialParams = new MaterialParams();
const drawParams = new DrawParams();
const scratchVec0 = vec3.create();
const scratchSceneParams = new SceneParams();

export class Sky {
    private skyddraw = new TDDraw();
    private materialHelperSky: GXMaterialHelperGfx;

    constructor(private world: World) {
        this.skyddraw.setVtxDesc(GX.Attr.POS, true);
        this.skyddraw.setVtxDesc(GX.Attr.TEX0, true);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevDirect(0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelperSky = new GXMaterialHelperGfx(mb.finish('atmosphere'));
    }

    private renderAtmosphere(device: GfxDevice, renderHelper: GXRenderHelperGfx, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: GfxrRenderTargetID, sceneCtx: SceneRenderContext) {
        // Draw atmosphere
        const tex = this.world.envfxMan.getAtmosphereTexture();
        if (tex === null || tex === undefined)
            return;

        // Call renderHelper.pushTemplateRenderInst (not renderInstManager.pushTemplateRenderInst)
        // to obtain a local SceneParams buffer
        const template = renderHelper.pushTemplateRenderInst();

        // Setup to draw in clip space
        fillSceneParams(scratchSceneParams, mat4.create(), sceneCtx.viewerInput.backbufferWidth, sceneCtx.viewerInput.backbufferHeight);
        let offs = template.getUniformBufferOffset(GX_Material.GX_Program.ub_SceneParams);
        const d = template.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams);
        fillSceneParamsData(d, offs, scratchSceneParams);

        materialParams.m_TextureMapping[0].gfxTexture = tex.gfxTexture;
        materialParams.m_TextureMapping[0].gfxSampler = tex.gfxSampler;
        materialParams.m_TextureMapping[0].width = tex.width;
        materialParams.m_TextureMapping[0].height = tex.height;
        materialParams.m_TextureMapping[0].lodBias = 0.0;
        mat4.identity(materialParams.u_TexMtx[0]);

        // Extract pitch
        const cameraFwd = scratchVec0;
        getMatrixAxisZ(cameraFwd, sceneCtx.viewerInput.camera.worldMatrix);
        vec3.negate(cameraFwd, cameraFwd);
        const camPitch = vecPitch(cameraFwd);
        const camRoll = Math.PI / 2;

        // FIXME: We should probably use a different technique since this one is poorly suited to VR.
        // TODO: Implement precise time of day. The game blends textures on the CPU to produce
        // an atmosphere texture for a given time of day.
        const fovRollFactor = 3.0 * (tex.height * 0.5 * sceneCtx.viewerInput.camera.fovY / Math.PI) * Math.sin(-camRoll);
        const pitchFactor = (0.5 * tex.height - 6.0) - (3.0 * tex.height * -camPitch / Math.PI);
        const t0 = (pitchFactor + fovRollFactor) / tex.height;
        const t1 = t0 - (fovRollFactor * 2.0) / tex.height;

        this.skyddraw.beginDraw();
        this.skyddraw.begin(GX.Command.DRAW_QUADS);
        this.skyddraw.position3f32(-1, -1, -1);
        this.skyddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t0);
        this.skyddraw.position3f32(-1, 1, -1);
        this.skyddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t1);
        this.skyddraw.position3f32(1, 1, -1);
        this.skyddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t1);
        this.skyddraw.position3f32(1, -1, -1);
        this.skyddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t0);
        this.skyddraw.end();

        const renderInst = this.skyddraw.makeRenderInst(renderInstManager);

        drawParams.clear();
        setGXMaterialOnRenderInst(device, renderInstManager, renderInst, this.materialHelperSky, materialParams, drawParams);

        this.skyddraw.endAndUpload(renderInstManager);

        renderInstManager.popTemplateRenderInst();
        
        builder.pushPass((pass) => {
            pass.setDebugName('Atmosphere');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.exec((passRenderer) => {
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }

    public addSkyRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        // Draw skyscape
        if (this.world.envfxMan.skyscape.objects.length !== 0) {
            renderInstManager.setCurrentRenderInstList(renderLists.skyscape);

            const template = renderInstManager.pushTemplateRenderInst();
            fillSceneParamsDataOnTemplate(template, sceneCtx.viewerInput);

            const objectCtx: ObjectRenderContext = {
                sceneCtx,
                showDevGeometry: false,
                setupLights: () => {}, // Lights are not used when rendering skyscape objects (?)
            }

            const eyePos = scratchVec0;
            getCamPos(eyePos, sceneCtx.viewerInput.camera);
            for (let i = 0; i < this.world.envfxMan.skyscape.objects.length; i++) {
                const obj = this.world.envfxMan.skyscape.objects[i];
                obj.setPosition(eyePos);
                obj.addRenderInsts(device, renderInstManager, null, objectCtx);
            }

            renderInstManager.popTemplateRenderInst();
        }
    }

    public addSkyRenderPasses(device: GfxDevice, renderHelper: GXRenderHelperGfx, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, mainColorTargetID: GfxrRenderTargetID, depthDesc: GfxrRenderTargetDescription, sceneCtx: SceneRenderContext) {
        this.renderAtmosphere(device, renderHelper, builder, renderInstManager, mainColorTargetID, sceneCtx);

        builder.pushPass((pass) => {
            pass.setDebugName('Skyscape');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyDepthTargetID = builder.createRenderTargetID(depthDesc, 'Skyscape Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyDepthTargetID);
            pass.exec((passRenderer) => {
                renderLists.skyscape.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }

    public destroy(device: GfxDevice) {
        this.skyddraw.destroy(device);
    }
}