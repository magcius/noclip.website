import { mat4, vec3 } from 'gl-matrix';
import { computeViewMatrix } from '../Camera';
import { Blue, Color, colorCopy, colorFromRGBA, colorNewCopy, colorNewFromRGBA, Red, TransparentBlack, White } from '../Color';
import { GfxDevice, GfxFormat } from '../gfx/platform/GfxPlatform';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInst, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import { ColorKind, fillSceneParams, fillSceneParamsData, GXMaterialHelperGfx, GXRenderHelperGfx, MaterialParams, PacketParams, SceneParams } from '../gx/gx_render';
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import { nArray } from '../util';
import { SFAMaterialBuilder } from './MaterialBuilder';
import { makeMaterialTexture, MaterialFactory } from './materials';
import { SceneRenderContext, setGXMaterialOnRenderInst } from './render';
import { SFATextureFetcher, TextureFetcher } from './textures';
import { mat4SetTranslation } from './util';
import { World } from './world';
import { createDirectionalLight, Light, LightType } from './WorldLights';

const scratchMaterialParams = new MaterialParams();
const scratchPacketParams = new PacketParams();
const scratchSceneParams = new SceneParams();
const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();
const scratchMtx2 = mat4.create();

const AMBIENT_PROBE_FACTORS = [
    [0.5, 1.0],
    [0.5, 0.5],
    [0.4, 1.0],
    [0.3, 0.8],
    [0.2, 1.0],
    [0.4, 0.5],
]

const enum ProbeType {
    // Sky light and ground light emitted against a spherical pattern
    Hemispheric,
    // Encoded texture containing Red: sky light, Green: surroundings, Blue: ground light
    Reflective,
}

interface AmbientProbeParams {
    type: ProbeType,
    attenFactors: number[/* 2 */];
    matColorFactors: number[/* 2 */];
}

function setSpecularLightAtten(light: GX_Material.Light, atten: number) {
    const k0 = 0.5 * atten;
    vec3.set(light.DistAtten, k0, 0.0, 1.0 - k0);
    vec3.set(light.CosAtten, 0.0, 0.0, 1.0);
}

const PROBE_TARGET_DIM = 32;
const PROBE_PROJECTION_MTX = mat4.create();
mat4.ortho(PROBE_PROJECTION_MTX, -1.0, 1.0, -1.0, 1.0, 1.0, 15.0);

function createHemisphericMaterial(materialFactory: MaterialFactory): SFAMaterialBuilder<World> {
    const mb = new SFAMaterialBuilder<World>('Ambient Hemispheric Probe Material');

    const stage = mb.genTevStage();
    mb.setTevDirect(stage);
    mb.setTevOrder(stage, null, null, GX.RasColorChannelID.COLOR0A0);
    mb.setTevKColorSel(stage, GX.KonstColorSel.KCSEL_1);
    mb.setTevKAlphaSel(stage, GX.KonstAlphaSel.KASEL_1);
    mb.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
    mb.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);

    mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 0xff, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);

    mb.setMatColor(0, (dst: Color) => colorCopy(dst, White));

    mb.setAmbColor(0, (dst: Color, ctx: World) => ctx.envfxMan.getAmbientColor(dst, 0)); // TODO: ambience selectable by object

    return mb;
}

function createReflectiveProbeMaterial(materialFactory: MaterialFactory, texFetcher: TextureFetcher): SFAMaterialBuilder {
    const mb = new SFAMaterialBuilder('Ambient Reflective Probe Material');

    const stage0 = mb.genTevStage();
    mb.setTevDirect(stage0);
    mb.setTexMtx(0, (dst: mat4) => {
        mat4.fromScaling(dst, [0.5, -0.5, 0.5]);
        mat4SetTranslation(dst, 0.5, 0.5, 0.0);
    });
    const texCoord = mb.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.NRM, GX.TexGenMatrix.TEXMTX0);
    const texMap = mb.genTexMap(makeMaterialTexture(texFetcher.getTexture(materialFactory.device, 0x5dc, false)));
    mb.setTevOrder(stage0, texCoord, texMap, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.RASC, /*GX.CC.RASA*/GX.CC.ONE, GX.CC.TEXC);
    mb.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

    const stage1 = mb.genTevStage();
    mb.setTevDirect(stage1);
    mb.setTevOrder(stage1, null, null, GX.RasColorChannelID.COLOR1A1);
    mb.setTevColorFormula(stage1, GX.CC.ZERO, GX.CC.RASC, GX.CC.RASA, GX.CC.CPREV);
    mb.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

    mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, (1<<0)|(1<<1), GX.DiffuseFunction.NONE, GX.AttenuationFunction.SPEC);
    mb.setChanCtrl(GX.ColorChannelID.ALPHA0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, (1<<2), GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);
    mb.setChanCtrl(GX.ColorChannelID.COLOR1, true, GX.ColorSrc.REG, GX.ColorSrc.REG, (1<<3)|(1<<4), GX.DiffuseFunction.NONE, GX.AttenuationFunction.SPEC);
    mb.setChanCtrl(GX.ColorChannelID.ALPHA1, true, GX.ColorSrc.REG, GX.ColorSrc.REG, (1<<5), GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);

    mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
    mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    mb.setCullMode(GX.CullMode.NONE);
    mb.setZMode(false, GX.CompareType.EQUAL, false);

    mb.setAmbColor(0, (dst: Color) => colorCopy(dst, TransparentBlack));
    mb.setAmbColor(1, (dst: Color) => colorCopy(dst, TransparentBlack));

    return mb;
}

export class AmbientProbe {
    private targetDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private params: AmbientProbeParams[] = nArray(6, () => { return { type: ProbeType.Hemispheric, attenFactors: [0, 0], matColorFactors: [0, 0] }; });
    private ddraw = new TDDraw();
    private hemisphericMaterial: SFAMaterialBuilder<World>;
    private reflectiveMaterial: SFAMaterialBuilder;

    constructor(private world: World, private materialFactory: MaterialFactory) {
        this.targetDesc.setDimensions(PROBE_TARGET_DIM, PROBE_TARGET_DIM, 1);

        let k = 0;
        // 0, 1, 2
        for (let i = 0; i < 6; i++) {
            const factors = AMBIENT_PROBE_FACTORS[i];
            this.params[k].attenFactors[i & 1] = 2.146452 / Math.pow(factors[0], 2.520326);
            this.params[k].matColorFactors[i & 1] = 255.0 * factors[1];
            this.params[k].type = ProbeType.Reflective;
            if ((i & 1) !== 0)
                k++;
        }

        // 3, 4, 5
        this.params[k].type = ProbeType.Hemispheric;
        k++;
        this.params[k].type = ProbeType.Hemispheric;
        k++;
        this.params[k].type = ProbeType.Hemispheric;
        k++;

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.NRM, GX.CompCnt.NRM_XYZ);

        this.hemisphericMaterial = createHemisphericMaterial(this.materialFactory);
        this.reflectiveMaterial = createReflectiveProbeMaterial(this.materialFactory, this.world.resColl.texFetcher);
    }

    public renderHemispheric(device: GfxDevice, builder: GfxrGraphBuilder, renderHelper: GXRenderHelperGfx, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext): GfxrRenderTargetID {
        // Call renderHelper.pushTemplateRenderInst (not renderInstManager.pushTemplateRenderInst)
        // to obtain a local SceneParams buffer
        const template = renderHelper.pushTemplateRenderInst();

        // Setup to draw in clip space
        fillSceneParams(scratchSceneParams, PROBE_PROJECTION_MTX, PROBE_TARGET_DIM, PROBE_TARGET_DIM);
        let offs = template.getUniformBufferOffset(GX_Material.GX_Program.ub_SceneParams);
        const d = template.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams);
        fillSceneParamsData(d, offs, scratchSceneParams);

        // TODO: generate geometry once and reuse it for future renders
        this.ddraw.beginDraw();
        for (let x = 0; x < 16; x++) {
            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP, 34);
            const fx0 = 2.0 * x / 15.0 - 1.0;
            const fx1 = 2.0 * (x + 1) / 15.0 - 1.0;

            for (let y = 0; y < 17; y++) {
                const fy = 2.0 * y / 15.0 - 1.0;

                this.ddraw.position3f32(fx0, fy, -2.0);
                let z0 = fx0 * fx0 + fy * fy;
                if (z0 >= 1.0)
                    z0 = 0.0;
                else
                    z0 = Math.sqrt(1.0 - z0);
                this.ddraw.normal3f32(fx0, fy, z0);

                this.ddraw.position3f32(fx1, fy, -2.0);
                let z1 = fx1 * fx1 + fy * fy;
                if (z1 >= 1.0)
                    z1 = 0.0;
                else
                    z1 = Math.sqrt(1.0 - z1);
                this.ddraw.normal3f32(fx1, fy, z1);
            }
            this.ddraw.end();
        }

        const renderInst = this.ddraw.makeRenderInst(renderInstManager);

        scratchPacketParams.clear();
        // FIXME: should lights be adjusted by camera view?

        scratchMaterialParams.clear();
        this.hemisphericMaterial.setOnMaterialParams(scratchMaterialParams, this.world);

        const ambParams = this.params[3]; // TODO: selectable per object

        this.world.worldLights.setupLights(scratchMaterialParams.u_Lights, sceneCtx, LightType.DIRECTIONAL);
        
        setGXMaterialOnRenderInst(device, renderInstManager, renderInst, this.hemisphericMaterial.getGXMaterialHelper(), scratchMaterialParams, scratchPacketParams);

        this.ddraw.endAndUpload(renderInstManager);

        renderInstManager.popTemplateRenderInst();

        const targetID = builder.createRenderTargetID(this.targetDesc, 'Ambient Probe Target');

        builder.pushPass((pass) => {
            pass.setDebugName('Ambient Probe');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, targetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            pass.exec((passRenderer, scope) => {
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        return targetID;
    }

    public renderReflective(device: GfxDevice, builder: GfxrGraphBuilder, renderHelper: GXRenderHelperGfx, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext): GfxrRenderTargetID {
        // Call renderHelper.pushTemplateRenderInst (not renderInstManager.pushTemplateRenderInst)
        // to obtain a local SceneParams buffer
        const template = renderHelper.pushTemplateRenderInst();

        // Setup to draw in clip space
        fillSceneParams(scratchSceneParams, PROBE_PROJECTION_MTX, PROBE_TARGET_DIM, PROBE_TARGET_DIM);
        let offs = template.getUniformBufferOffset(GX_Material.GX_Program.ub_SceneParams);
        const d = template.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams);
        fillSceneParamsData(d, offs, scratchSceneParams);

        // TODO: generate geometry once and reuse it for future renders
        this.ddraw.beginDraw();
        for (let x = 0; x < 16; x++) {
            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP, 34);
            const fx0 = 2.0 * x / 15.0 - 1.0;
            const fx1 = 2.0 * (x + 1) / 15.0 - 1.0;

            for (let y = 0; y < 17; y++) {
                const fy = 2.0 * y / 15.0 - 1.0;

                this.ddraw.position3f32(fx0, fy, -2.0);
                let z0 = fx0 * fx0 + fy * fy;
                if (z0 >= 1.0)
                    z0 = 0.0;
                else
                    z0 = Math.sqrt(1.0 - z0);
                this.ddraw.normal3f32(fx0, fy, z0);

                this.ddraw.position3f32(fx1, fy, -2.0);
                let z1 = fx1 * fx1 + fy * fy;
                if (z1 >= 1.0)
                    z1 = 0.0;
                else
                    z1 = Math.sqrt(1.0 - z1);
                this.ddraw.normal3f32(fx1, fy, z1);
            }
            this.ddraw.end();
        }

        const renderInst = this.ddraw.makeRenderInst(renderInstManager);

        scratchPacketParams.clear();
        // FIXME: should lights be adjusted by camera view?

        scratchMaterialParams.clear();
        this.reflectiveMaterial.setOnMaterialParams(scratchMaterialParams, undefined);

        const ambParams = this.params[0]; // TODO: selectable per object
        const matColor = colorNewFromRGBA(
            1.0 * ambParams.matColorFactors[0] / 255.0,
            0.0,
            1.0 * ambParams.matColorFactors[1] / 255.0,
            1.0
        );
        colorCopy(scratchMaterialParams.u_Color[ColorKind.MAT0], matColor);
        colorCopy(scratchMaterialParams.u_Color[ColorKind.MAT1], matColor);

        const n111 = vec3.fromValues(1, 1, 1);
        vec3.normalize(n111, n111);
        const nn111 = vec3.clone(n111);
        vec3.negate(nn111, nn111);
        const skyLight: Light = createDirectionalLight(n111, Red);
        const groundLight: Light = createDirectionalLight(nn111, Blue);

        // Light 0: COLOR0
        scratchMaterialParams.u_Lights[0].reset();
        vec3.copy(scratchMaterialParams.u_Lights[0].Direction, skyLight.direction);
        setSpecularLightAtten(scratchMaterialParams.u_Lights[0], ambParams.attenFactors[0]);
        colorCopy(scratchMaterialParams.u_Lights[0].Color, Red);

        // Light 1: COLOR0
        scratchMaterialParams.u_Lights[1].reset();
        vec3.copy(scratchMaterialParams.u_Lights[1].Direction, skyLight.direction);
        setSpecularLightAtten(scratchMaterialParams.u_Lights[1], ambParams.attenFactors[1]);
        colorCopy(scratchMaterialParams.u_Lights[1].Color, Blue);

        // Light 2: ALPHA0
        scratchMaterialParams.u_Lights[2].reset();
        vec3.scale(scratchMaterialParams.u_Lights[2].Position, skyLight.direction, -100000.0);
        colorCopy(scratchMaterialParams.u_Lights[2].Color, Blue);
        vec3.set(scratchMaterialParams.u_Lights[2].CosAtten, 1.5, 0.0, 0.0);

        // Light 3: COLOR1
        scratchMaterialParams.u_Lights[3].reset();
        vec3.copy(scratchMaterialParams.u_Lights[3].Direction, groundLight.direction);
        setSpecularLightAtten(scratchMaterialParams.u_Lights[3], ambParams.attenFactors[0]);
        colorCopy(scratchMaterialParams.u_Lights[3].Color, Red);

        // Light 4: COLOR1
        scratchMaterialParams.u_Lights[4].reset();
        vec3.copy(scratchMaterialParams.u_Lights[4].Direction, groundLight.direction);
        setSpecularLightAtten(scratchMaterialParams.u_Lights[4], ambParams.attenFactors[1]);
        colorCopy(scratchMaterialParams.u_Lights[4].Color, Blue);
        
        // Light 5: ALPHA1
        scratchMaterialParams.u_Lights[5].reset();
        vec3.scale(scratchMaterialParams.u_Lights[5].Position, groundLight.direction, -100000.0);
        colorCopy(scratchMaterialParams.u_Lights[5].Color, Blue);
        vec3.set(scratchMaterialParams.u_Lights[5].CosAtten, 0.5, 0.0, 0.0);
        
        setGXMaterialOnRenderInst(device, renderInstManager, renderInst, this.reflectiveMaterial.getGXMaterialHelper(), scratchMaterialParams, scratchPacketParams);

        this.ddraw.endAndUpload(renderInstManager);

        renderInstManager.popTemplateRenderInst();

        const targetID = builder.createRenderTargetID(this.targetDesc, 'Ambient Probe Target');

        builder.pushPass((pass) => {
            pass.setDebugName('Ambient Probe');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, targetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            pass.exec((passRenderer, scope) => {
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        return targetID;
    }
}