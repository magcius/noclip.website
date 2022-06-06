// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { mat4 } from "gl-matrix";
import { Color, colorCopy, colorMult, colorNewCopy, White } from "../Color";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX from "../gx/gx_enum";
import { GXMaterialHacks, SwapTable } from "../gx/gx_material";
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams } from "../gx/gx_render";
import { assertExists } from "../util";
import * as Gma from "./Gma";
import { RenderParams } from "./Model";
import { TevLayerInst } from "./TevLayer";

const SWAP_TABLES: SwapTable[] = [
    [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.A],
    [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.R], // Used for alpha textures
    [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.G],
    [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.B],
];

type BuildState = {
    stage: number;
    texCoord: GX.TexCoordID;
    texMap: GX.TexMapID;
    texGenSrc: GX.TexGenSrc;
};

function buildDiffuseLayer(mb: GXMaterialBuilder, state: BuildState, colorIn: GX.CC, alphaIn: GX.CA) {
    mb.setTevDirect(state.stage);
    mb.setTevSwapMode(state.stage, SWAP_TABLES[0], SWAP_TABLES[0]);
    mb.setTexCoordGen(state.texCoord, GX.TexGenType.MTX2x4, state.texGenSrc, GX.TexGenMatrix.TEXMTX1);
    mb.setTevOrder(state.stage, state.texCoord, state.texMap, GX.RasColorChannelID.COLOR0A0);

    mb.setTevColorIn(state.stage, GX.CC.ZERO, GX.CC.TEXC, colorIn, GX.CC.ZERO);
    mb.setTevColorOp(state.stage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(state.stage, GX.CA.ZERO, GX.CA.TEXA, alphaIn, GX.CA.ZERO);
    mb.setTevAlphaOp(state.stage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

    state.stage++;
    state.texCoord++;
    state.texMap++;
    state.texGenSrc++;
}

function buildAlphaBlendLayer(mb: GXMaterialBuilder, state: BuildState, colorIn: GX.CC, alphaIn: GX.CA) {
    mb.setTevDirect(state.stage);
    mb.setTevSwapMode(state.stage, SWAP_TABLES[0], SWAP_TABLES[1]);
    mb.setTexCoordGen(state.texCoord, GX.TexGenType.MTX2x4, state.texGenSrc, GX.TexGenMatrix.TEXMTX1);
    mb.setTevOrder(state.stage, state.texCoord, state.texMap, GX.RasColorChannelID.COLOR0A0);

    mb.setTevColorIn(state.stage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, colorIn);
    mb.setTevColorOp(state.stage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(state.stage, GX.CA.ZERO, GX.CA.TEXA, alphaIn, GX.CA.ZERO);
    mb.setTevAlphaOp(state.stage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

    state.stage++;
    state.texCoord++;
    state.texMap++;
    state.texGenSrc++;
}

function buildDummyPassthroughLayer(mb: GXMaterialBuilder, state: BuildState, colorIn: GX.CC, alphaIn: GX.CA) {
    mb.setTevDirect(state.stage);
    mb.setTevOrder(state.stage, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(state.stage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, colorIn);
    mb.setTevColorOp(state.stage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(state.stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, alphaIn);
    mb.setTevAlphaOp(state.stage, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

    state.stage++;
}

const scratchMaterialParams = new MaterialParams();
const scratchColor1: Color = colorNewCopy(White);
const scratchColor2: Color = colorNewCopy(White);
export class MaterialInst {
    private tevLayers: TevLayerInst[];
    private materialHelper: GXMaterialHelperGfx;

    constructor(
        private materialData: Gma.Material,
        modelTevLayers: TevLayerInst[],
        private translucentShape: boolean,
        private cullMode: GX.CullMode
    ) {
        this.tevLayers = [];

        for (let i = 0; i < materialData.tevLayerCount; i++) {
            const tevLayerIdx = materialData.tevLayerIdxs[i];
            this.tevLayers.push(modelTevLayers[tevLayerIdx]);
        }

        this.genGXMaterial();
    }

    private genGXMaterial(): void {
        const mb = new GXMaterialBuilder();

        mb.setCullMode(this.cullMode);

        // Set up lighting channel
        let colorIn: GX.CC = GX.CC.RASC;
        let alphaIn: GX.CA = GX.CA.RASA;
        if (this.materialData.flags & Gma.MaterialFlags.Unlit) {
            if (this.materialData.flags & Gma.MaterialFlags.VertColors) {
                mb.setChanCtrl(
                    GX.ColorChannelID.COLOR0A0,
                    false,
                    GX.ColorSrc.VTX, // Ambient src, no-op. With light channel disabled there is no ambient light
                    GX.ColorSrc.VTX, // Material source
                    0,
                    GX.DiffuseFunction.NONE,
                    GX.AttenuationFunction.NONE
                );
            } else {
                colorIn = GX.CC.C0;
                alphaIn = GX.CA.A0;
            }
        } else {
            if (this.materialData.flags & Gma.MaterialFlags.VertColors) {
                mb.setChanCtrl(
                    GX.ColorChannelID.ALPHA0, // chan
                    false, // enable
                    GX.ColorSrc.REG, // amb_src
                    GX.ColorSrc.VTX, // mat_src
                    0, // light_mask
                    GX.DiffuseFunction.NONE, // diff_fn
                    GX.AttenuationFunction.NONE // attn_fn
                ); // attn_fn
                // Enable alpha channel
                mb.setChanCtrl(
                    GX.ColorChannelID.COLOR0, // chan
                    true, // enable
                    GX.ColorSrc.REG, // amb_src
                    GX.ColorSrc.VTX, // mat_src
                    1, // light_mask, assuming we only have on directional light for now
                    GX.DiffuseFunction.CLAMP, // diff_fn
                    GX.AttenuationFunction.SPOT // attn_fn
                );
            } else {
                mb.setChanCtrl(
                    GX.ColorChannelID.ALPHA0, // chan
                    false, // enable
                    GX.ColorSrc.REG, // amb_src
                    GX.ColorSrc.REG, // mat_src
                    0, // light_mask
                    GX.DiffuseFunction.NONE, // diff_fn
                    GX.AttenuationFunction.NONE // attn_fn
                ); // attn_fn
                // Enable alpha channel
                mb.setChanCtrl(
                    GX.ColorChannelID.COLOR0, // chan
                    true, // enable
                    GX.ColorSrc.REG, // amb_src
                    GX.ColorSrc.REG, // mat_src
                    1, // light_mask, assuming we only have on directional light for now
                    GX.DiffuseFunction.CLAMP, // diff_fn
                    GX.AttenuationFunction.SPOT // attn_fn
                );
            }
        }

        const buildState: BuildState = {
            stage: 0,
            texCoord: GX.TexCoordID.TEXCOORD0,
            texMap: GX.TexMapID.TEXMAP0,
            texGenSrc: GX.TexGenSrc.TEX0,
        };

        if (this.materialData.flags & Gma.MaterialFlags.SimpleMaterial) {
            mb.setTevOrder(
                buildState.stage,
                GX.TexCoordID.TEXCOORD_NULL,
                GX.TexMapID.TEXMAP_NULL,
                GX.RasColorChannelID.COLOR0A0
            );
            mb.setTevColorIn(buildState.stage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, colorIn);
            mb.setTevColorOp(
                buildState.stage,
                GX.TevOp.ADD,
                GX.TevBias.ZERO,
                GX.TevScale.SCALE_1,
                true,
                GX.Register.PREV
            );
            mb.setTevAlphaIn(buildState.stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, alphaIn);
            mb.setTevAlphaOp(
                buildState.stage,
                GX.TevOp.ADD,
                GX.TevBias.ZERO,
                GX.TevScale.SCALE_1,
                true,
                GX.Register.PREV
            );
            buildState.stage++;
        } else {
            for (let layerIdx = 0; layerIdx < this.tevLayers.length; layerIdx++) {
                const layer = this.tevLayers[layerIdx];
                const layerTypeFlags =
                    layer.tevLayerData.flags &
                    (Gma.TevLayerFlags.TypeAlphaBlend |
                        Gma.TevLayerFlags.TypeViewSpecular |
                        Gma.TevLayerFlags.TypeWorldSpecular);
                if (layerTypeFlags === 0) {
                    buildDiffuseLayer(mb, buildState, colorIn, alphaIn);
                } else if (layerTypeFlags & Gma.TevLayerFlags.TypeAlphaBlend) {
                    buildAlphaBlendLayer(mb, buildState, colorIn, alphaIn);
                } else {
                    // TODO(complexplane): The other kinds of layers
                    buildDummyPassthroughLayer(mb, buildState, colorIn, alphaIn);
                }

                colorIn = GX.CC.CPREV;
                alphaIn = GX.CA.APREV;
            }
        }

        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);

        let srcBlendFactor = GX.BlendFactor.SRCALPHA;
        if (this.materialData.flags & Gma.MaterialFlags.CustomBlendSrc) {
            srcBlendFactor = this.materialData.blendFactors & 0xf;
        }
        let destBlendFactor = GX.BlendFactor.INVSRCALPHA;
        if (this.materialData.flags & Gma.MaterialFlags.CustomBlendDest) {
            destBlendFactor = (this.materialData.blendFactors >> 4) & 0xf;
        }
        mb.setBlendMode(GX.BlendMode.BLEND, srcBlendFactor, destBlendFactor, GX.LogicOp.CLEAR);

        mb.setZMode(true, GX.CompareType.LEQUAL, true);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        this.materialHelper.setMaterialHacks(hacks);
    }

    public setOnRenderInst(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        inst: GfxRenderInst,
        drawParams: DrawParams,
        renderParams: RenderParams
    ): void {
        // Shader program
        this.materialHelper.setOnRenderInst(device, renderCache, inst);

        // Sampler bindings
        const materialParams = scratchMaterialParams;
        materialParams.clear();
        for (let i = 0; i < this.tevLayers.length; i++) {
            this.tevLayers[i].fillTextureMapping(materialParams.m_TextureMapping[i]);
        }

        const lighting = assertExists(renderParams.lighting);

        // Ambient lighting color. Alpha should be irrelevant since alpha light channel is
        // always disabled
        const ambientColor = scratchColor2;
        if (this.materialData.flags & Gma.MaterialFlags.CustomMatAmbColors) {
            colorMult(ambientColor, this.materialData.ambientColor, lighting.ambientColor);
        } else {
            colorCopy(ambientColor, lighting.ambientColor);
        }

        // Material color
        const materialColor = scratchColor1;
        if (this.materialData.flags & (Gma.MaterialFlags.CustomMatAmbColors | Gma.MaterialFlags.SimpleMaterial)) {
            colorCopy(materialColor, this.materialData.materialColor);
        } else {
            colorCopy(materialColor, White);
        }
        materialColor.a = this.materialData.alpha * renderParams.alpha;

        mat4.copy(materialParams.u_TexMtx[1], renderParams.texMtx);

        colorCopy(materialParams.u_Color[ColorKind.MAT0], materialColor);
        colorCopy(materialParams.u_Color[ColorKind.AMB0], ambientColor);
        // Game uses TEVREG0 instead of RASC when lighting and vertex colors are disabled
        colorCopy(materialParams.u_Color[ColorKind.C0], materialColor);

        materialParams.u_Lights[0].copy(lighting.infLightViewSpace);

        this.materialHelper.allocateMaterialParamsDataOnInst(inst, materialParams);
        inst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        // Draw params
        this.materialHelper.allocateDrawParamsDataOnInst(inst, drawParams);
    }
}
