import { mat4, vec3 } from 'gl-matrix';
import { computeViewMatrix } from '../Camera';
import { Blue, Color, colorCopy, colorNewFromRGBA, Red, TransparentBlack, White } from '../Color';
import { GfxDevice, GfxFormat, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrPass, GfxrPassScope, GfxrRenderTargetDescription, GfxrRenderTargetID, GfxrResolveTextureID } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import { ColorKind, fillSceneParams, fillSceneParamsData, GXRenderHelperGfx, MaterialParams, DrawParams, SceneParams } from '../gx/gx_render';
import { projectionMatrixForCuboid } from '../MathHelpers';
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import { TextureMapping } from '../TextureHolder';
import { nArray } from '../util';
import { SFAMaterialBuilder } from './MaterialBuilder';
import { makeMaterialTexture, MaterialFactory } from './materials';
import { SceneRenderContext, setGXMaterialOnRenderInst } from './render';
import { TextureFetcher } from './textures';
import { mat4SetTranslation } from './util';
import { World } from './world';
import { LightType } from './WorldLights';

const scratchMaterialParams = new MaterialParams();
const scratchDrawParams = new DrawParams();
const scratchSceneParams = new SceneParams();
const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();
const scratchVec0 = vec3.create();
const scratchVec1 = vec3.create();

const REFLECTIVE_PROBE_FACTORS = [
    [0.5, 1.0],
    [0.5, 0.5],
    [0.4, 1.0],
    [0.3, 0.8],
    [0.2, 1.0],
    [0.4, 0.5],
]

const enum SphereMapType {
    // Sky light and ground light emitted against a sphere
    HemisphericProbe,
    // Encoded texture containing Red: sky light, Green: surroundings, Blue: ground light
    ReflectiveProbe,
}

interface SphereMapParams {
    type: SphereMapType,
    attenFactors: number[/* 2 */];
    matColorFactors: number[/* 2 */];
}

function setSpecularLightAtten(light: GX_Material.Light, atten: number) {
    const k0 = 0.5 * atten;
    vec3.set(light.DistAtten, k0, 0.0, 1.0 - k0);
    vec3.set(light.CosAtten, 0.0, 0.0, 1.0);
}

const SPHERE_MAP_DIM = 32;
const SPHERE_MAP_PROJECTION_MTX = mat4.create();
projectionMatrixForCuboid(SPHERE_MAP_PROJECTION_MTX, 1.0, -1.0, -1.0, 1.0, 1.0, 15.0); // Yes, left and right are meant to be 1 and -1, respectively.

function createHemisphericProbeMaterial(materialFactory: MaterialFactory): SFAMaterialBuilder<World> {
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

    mb.setAmbColor(0, (dst: Color, ctx: World) => ctx.envfxMan.getAmbientColor(dst, ctx.envfxMan.ambienceIdx));

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
    mb.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.RASC, GX.CC.RASA, GX.CC.TEXC);
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

interface RenderedSphereMap {
    textureMapping: TextureMapping;
    targetID: GfxrRenderTargetID;
    resolveID: GfxrResolveTextureID;
}

export class SphereMapManager {
    private targetDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private params: SphereMapParams[] = nArray(6, () => { return { type: SphereMapType.HemisphericProbe, attenFactors: [0, 0], matColorFactors: [0, 0] }; });
    private ddraw = new TDDraw();
    private hemisphericMaterial: SFAMaterialBuilder<World>;
    private reflectiveMaterial: SFAMaterialBuilder;
    
    private sphereMapSampler?: GfxSampler;
    private sphereMaps: RenderedSphereMap[] = nArray<RenderedSphereMap>(6, () => {
        return {
            textureMapping: new TextureMapping(),
            targetID: 0 as GfxrRenderTargetID,
            resolveID: 0 as GfxrResolveTextureID,
        };
    });

    constructor(private world: World, private materialFactory: MaterialFactory) {
        this.targetDesc.setDimensions(SPHERE_MAP_DIM, SPHERE_MAP_DIM, 1);

        let k = 0;
        // 0, 1, 2
        for (let i = 0; i < 6; i++) {
            const factors = REFLECTIVE_PROBE_FACTORS[i];
            this.params[k].attenFactors[i & 1] = 2.146452 / Math.pow(factors[0], 2.520326);
            this.params[k].matColorFactors[i & 1] = 255.0 * factors[1];
            this.params[k].type = SphereMapType.ReflectiveProbe;
            if ((i & 1) !== 0)
                k++;
        }

        // 3, 4, 5
        this.params[k].type = SphereMapType.HemisphericProbe;
        k++;
        this.params[k].type = SphereMapType.HemisphericProbe;
        k++;
        this.params[k].type = SphereMapType.HemisphericProbe;
        k++;

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);

        this.hemisphericMaterial = createHemisphericProbeMaterial(this.materialFactory);
        this.reflectiveMaterial = createReflectiveProbeMaterial(this.materialFactory, this.world.resColl.texFetcher);
    }

    private setupToRenderHemisphericProbe(probeIdx: number, materialParams: MaterialParams, sceneCtx: SceneRenderContext): SFAMaterialBuilder<World> {
        const ambParams = this.params[probeIdx];
        this.world.envfxMan.setAmbience(5 - probeIdx);

        this.hemisphericMaterial.setOnMaterialParams(materialParams, this.world);

        // FIXME: should lights be adjusted by camera view?
        this.world.setupLightsForObject(materialParams.u_Lights, undefined, sceneCtx, LightType.DIRECTIONAL);

        return this.hemisphericMaterial;
    }

    private setupToRenderReflectiveProbe(probeIdx: number, materialParams: MaterialParams, sceneCtx: SceneRenderContext): SFAMaterialBuilder {
        const ambParams = this.params[probeIdx];
        this.world.envfxMan.setAmbience(probeIdx);

        this.reflectiveMaterial.setOnMaterialParams(materialParams, undefined);

        const matColor = colorNewFromRGBA(
            1.0 * ambParams.matColorFactors[0] / 255.0,
            0.0,
            1.0 * ambParams.matColorFactors[1] / 255.0,
            1.0
        );
        colorCopy(materialParams.u_Color[ColorKind.MAT0], matColor);
        colorCopy(materialParams.u_Color[ColorKind.MAT1], matColor);

        const skyLight = this.world.envfxMan.skyLight;
        const groundLight = this.world.envfxMan.groundLight;

        const worldView = scratchMtx0;
        computeViewMatrix(worldView, sceneCtx.viewerInput.camera);
        const worldViewSR = scratchMtx1;
        mat4.copy(worldViewSR, worldView);
        mat4SetTranslation(worldViewSR, 0, 0, 0);

        const skyLightVec = scratchVec0;
        vec3.transformMat4(skyLightVec, skyLight.direction, worldViewSR);
        const groundLightVec = scratchVec1;
        vec3.transformMat4(groundLightVec, groundLight.direction, worldViewSR);

        // Light 0: COLOR0
        materialParams.u_Lights[0].reset();
        vec3.copy(materialParams.u_Lights[0].Direction, skyLightVec);
        setSpecularLightAtten(materialParams.u_Lights[0], ambParams.attenFactors[0]);
        colorCopy(materialParams.u_Lights[0].Color, Red);

        // Light 1: COLOR0
        materialParams.u_Lights[1].reset();
        vec3.copy(materialParams.u_Lights[1].Direction, skyLightVec);
        setSpecularLightAtten(materialParams.u_Lights[1], ambParams.attenFactors[1]);
        colorCopy(materialParams.u_Lights[1].Color, Blue);

        // Light 2: ALPHA0
        materialParams.u_Lights[2].reset();
        // FIXME: original game scales by -100000.0 here, but that puts the light position on the opposite side of where it should go ... hmmm.
        vec3.scale(materialParams.u_Lights[2].Position, skyLightVec, 100000.0);
        colorCopy(materialParams.u_Lights[2].Color, Blue);
        vec3.set(materialParams.u_Lights[2].CosAtten, 1.5, 0.0, 0.0);

        // Light 3: COLOR1
        materialParams.u_Lights[3].reset();
        vec3.copy(materialParams.u_Lights[3].Direction, groundLightVec);
        setSpecularLightAtten(materialParams.u_Lights[3], ambParams.attenFactors[0]);
        colorCopy(materialParams.u_Lights[3].Color, Red);

        // Light 4: COLOR1
        materialParams.u_Lights[4].reset();
        vec3.copy(materialParams.u_Lights[4].Direction, groundLightVec);
        setSpecularLightAtten(materialParams.u_Lights[4], ambParams.attenFactors[1]);
        colorCopy(materialParams.u_Lights[4].Color, Blue);
        
        // Light 5: ALPHA1
        materialParams.u_Lights[5].reset();
        // FIXME: see above
        vec3.scale(materialParams.u_Lights[5].Position, groundLightVec, 100000.0);
        colorCopy(materialParams.u_Lights[5].Color, Blue);
        vec3.set(materialParams.u_Lights[5].CosAtten, 0.5, 0.0, 0.0);

        return this.reflectiveMaterial;
    }

    private renderMap(mapIdx: number, device: GfxDevice, builder: GfxrGraphBuilder, renderHelper: GXRenderHelperGfx, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext): GfxrRenderTargetID {
        // Call renderHelper.pushTemplateRenderInst (not renderInstManager.pushTemplateRenderInst)
        // to obtain a local SceneParams buffer
        const template = renderHelper.pushTemplateRenderInst();

        // Setup to draw in clip space
        fillSceneParams(scratchSceneParams, SPHERE_MAP_PROJECTION_MTX, SPHERE_MAP_DIM, SPHERE_MAP_DIM);
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

        scratchDrawParams.clear();
        scratchMaterialParams.clear();

        const ambParams = this.params[mapIdx]; // TODO: selectable per object
        let material: SFAMaterialBuilder<any>;
        if (ambParams.type === SphereMapType.HemisphericProbe)
            material = this.setupToRenderHemisphericProbe(mapIdx, scratchMaterialParams, sceneCtx);
        else // SphereMapType.ReflectiveProbe
            material = this.setupToRenderReflectiveProbe(mapIdx, scratchMaterialParams, sceneCtx);
        
        setGXMaterialOnRenderInst(device, renderInstManager, renderInst, material.getGXMaterialHelper(), scratchMaterialParams, scratchDrawParams);

        this.ddraw.endAndUpload(renderInstManager);

        renderInstManager.popTemplateRenderInst();

        const targetID = builder.createRenderTargetID(this.targetDesc, 'Sphere Map Target');

        builder.pushPass((pass) => {
            pass.setDebugName('Sphere Map');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, targetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            pass.exec((passRenderer, scope) => {
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        return targetID;
    }

    public renderMaps(device: GfxDevice, builder: GfxrGraphBuilder, renderHelper: GXRenderHelperGfx, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {
        for (let i = 0; i < 6; i++)
            this.sphereMaps[i].targetID = this.renderMap(i, device, builder, renderHelper, renderInstManager, sceneCtx);
    }

    public attachResolveTextures(builder: GfxrGraphBuilder, pass: GfxrPass) {
        for (let i = 0; i < 6; i++) {
            this.sphereMaps[i].resolveID = builder.resolveRenderTarget(this.sphereMaps[i].targetID);
            pass.attachResolveTexture(this.sphereMaps[i].resolveID);
        }
    }

    public resolveLateSamplerBindings(renderList: GfxRenderInstList, scope: GfxrPassScope, renderCache: GfxRenderCache) {
        if (this.sphereMapSampler === undefined) {
            this.sphereMapSampler = renderCache.createSampler({
                wrapS: GfxWrapMode.Clamp,
                wrapT: GfxWrapMode.Clamp,
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.NoMip,
                minLOD: 0,
                maxLOD: 100,
            });
        }

        for (let i = 0; i < 6; i++) {
            this.sphereMaps[i].textureMapping.gfxTexture = scope.getResolveTextureForID(this.sphereMaps[i].resolveID);
            this.sphereMaps[i].textureMapping.gfxSampler = this.sphereMapSampler;
            this.sphereMaps[i].textureMapping.width = SPHERE_MAP_DIM;
            this.sphereMaps[i].textureMapping.height = SPHERE_MAP_DIM;
            renderList.resolveLateSamplerBinding(`sphere-map-${i}`, this.sphereMaps[i].textureMapping);
        }
    }
}