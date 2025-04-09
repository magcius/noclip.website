
import { mat4, vec3 } from 'gl-matrix';
import { GfxClipSpaceNearZ, GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import * as GX from '../gx/gx_enum.js';
import * as GX_Material from '../gx/gx_material.js';
import { DrawParams, GXMaterialHelperGfx, GXRenderHelperGfx, MaterialParams, SceneParams, calcLODBias, fillSceneParamsData, fillSceneParamsDataOnTemplate, ub_SceneParamsBufferSize } from '../gx/gx_render.js';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder.js';
import { getMatrixAxisZ } from '../MathHelpers.js';
import { TDDraw } from "../SuperMarioGalaxy/DDraw.js";

import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers.js';
import { ObjectRenderContext } from './objects.js';
import { SFARenderLists, SceneRenderContext, setGXMaterialOnRenderInst } from './render.js';
import { getCamPos, vecPitch } from './util.js';
import { World } from './world.js';

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

        const template = renderInstManager.pushTemplate();

        // Setup to draw in clip space
        mat4.identity(scratchSceneParams.u_Projection);
        scratchSceneParams.u_SceneTextureLODBias = calcLODBias(sceneCtx.viewerInput.backbufferWidth, sceneCtx.viewerInput.backbufferHeight);
        projectionMatrixConvertClipSpaceNearZ(scratchSceneParams.u_Projection, device.queryVendorInfo().clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);
        const d = template.allocateUniformBufferF32(GX_Material.GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(d, 0, scratchSceneParams);

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

        this.skyddraw.beginDraw(renderInstManager.gfxRenderCache);
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

        const renderInst = this.skyddraw.endDrawAndMakeRenderInst(renderInstManager);

        drawParams.clear();
        setGXMaterialOnRenderInst(renderInstManager, renderInst, this.materialHelperSky, materialParams, drawParams);

        renderInstManager.popTemplate();
        
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
            renderInstManager.setCurrentList(renderLists.skyscape);

            const template = renderInstManager.pushTemplate();
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

            renderInstManager.popTemplate();
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