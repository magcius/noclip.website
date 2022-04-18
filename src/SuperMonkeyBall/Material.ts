// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { GXMaterialHacks } from "../gx/gx_material";
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams } from "../gx/gx_render";
import * as Gma from "./Gma";
import { TevLayerInst } from "./TevLayer";
import * as GX from "../gx/gx_enum";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxDevice } from "../gfx/platform/GfxPlatform";

type BuildState = {
    stage: number;
    texCoord: GX.TexCoordID;
    texMap: GX.TexMapID;
};

function buildDiffuseLayer(
    mb: GXMaterialBuilder,
    state: BuildState,
    colorIn: GX.CC,
    alphaIn: GX.CA
) {
    mb.setTevDirect(state.stage);
}

function buildDummyPassthroughLayer(
    mb: GXMaterialBuilder,
    state: BuildState,
    colorIn: GX.CC,
    alphaIn: GX.CA
) {
    mb.setTevDirect(state.stage);
    mb.setTevOrder(
        state.stage,
        GX.TexCoordID.TEXCOORD_NULL,
        GX.TexMapID.TEXMAP_NULL,
        GX.RasColorChannelID.COLOR0A0
    );
    mb.setTevColorIn(state.stage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, colorIn);
    mb.setTevColorOp(
        state.stage,
        GX.TevOp.ADD,
        GX.TevBias.ZERO,
        GX.TevScale.SCALE_1,
        true,
        GX.Register.PREV
    );
    mb.setTevAlphaIn(state.stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, alphaIn);
    mb.setTevAlphaOp(
        state.stage,
        GX.TevOp.ADD,
        GX.TevBias.ZERO,
        GX.TevScale.SCALE_1,
        true,
        GX.Register.PREV
    );

    state.stage++;
}

const scratchMaterialParams = new MaterialParams();
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
        for (let i = 0; i < materialData.tevLayerIdxs.length; i++) {
            const tevLayerIdx = materialData.tevLayerIdxs[i];
            // Materials can use 0 to 3 TEV layers defined in the model. The first -1 TEV layer  index
            // denotes the end of the list.
            if (tevLayerIdx < 0) break;
            this.tevLayers.push(modelTevLayers[tevLayerIdx]);
        }

        this.genGXMaterial();
    }

    private genGXMaterial(): void {
        const mb = new GXMaterialBuilder();

        mb.setCullMode(this.cullMode);

        // Set up lighting channel
        // Treat all shapes as unlit for now
        let colorIn: GX.CC = GX.CC.RASC;
        let alphaIn: GX.CA = GX.CA.RASA;
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
            // TODO(complexplane): "ambient" color from material
            colorIn = GX.CC.C0;
            alphaIn = GX.CA.A0;
        }

        const buildState: BuildState = {
            stage: 0,
            texCoord: GX.TexCoordID.TEXCOORD0,
            texMap: GX.TexMapID.TEXMAP0,
        };
        buildDummyPassthroughLayer(mb, buildState, colorIn, alphaIn);

        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
        mb.setBlendMode(
            GX.BlendMode.BLEND,
            GX.BlendFactor.SRCALPHA,
            GX.BlendFactor.INVSRCALPHA,
            GX.LogicOp.CLEAR
        );
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
        drawParams: DrawParams
    ): void {
        // Shader program
        this.materialHelper.setOnRenderInst(device, renderCache, inst);

        // Sampler bindings
        const materialParams = scratchMaterialParams;
        for (let i = 0; i < this.tevLayers.length; i++) {
            this.tevLayers[i].fillTextureMapping(materialParams.m_TextureMapping[i]);
        }

        // "Ambient" light when both light channel and vertex colors disabled
        materialParams.u_Color[ColorKind.C0] = { r: 1, g: 1, b: 1, a: 1 };

        this.materialHelper.allocateMaterialParamsDataOnInst(inst, materialParams);
        inst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        // Draw params
        this.materialHelper.allocateDrawParamsDataOnInst(inst, drawParams);
    }
}
