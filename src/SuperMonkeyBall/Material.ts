// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { GXMaterialHacks } from "../gx/gx_material";
import { DrawParams, GXMaterialHelperGfx, MaterialParams } from "../gx/gx_render";
import * as Gma from "./Gma";
import { TevLayerInst } from "./TevLayer";
import * as GX from "../gx/gx_enum";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxDevice } from "../gfx/platform/GfxPlatform";

const scratchMaterialParams = new MaterialParams();
export class MaterialInst {
    private tevLayers: TevLayerInst[];
    private materialHelper: GXMaterialHelperGfx;

    constructor(
        private materialData: Gma.Material,
        modelTevLayers: TevLayerInst[],
        private translucentShape: boolean
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
        // const lightChannel0: GX_Material.LightChannelControl = {
        //     alphaChannel: {
        //         lightingEnabled: false,
        //         ambColorSource: GX.ColorSrc.VTX,
        //         matColorSource: GX.ColorSrc.VTX,
        //         litMask: 0,
        //         diffuseFunction: GX.DiffuseFunction.NONE,
        //         attenuationFunction: GX.AttenuationFunction.NONE,
        //     },
        //     colorChannel: {
        //         lightingEnabled: false,
        //         ambColorSource: GX.ColorSrc.VTX,
        //         matColorSource: GX.ColorSrc.VTX,
        //         litMask: 0,
        //         diffuseFunction: GX.DiffuseFunction.NONE,
        //         attenuationFunction: GX.AttenuationFunction.NONE,
        //     },
        // };

        // const lightChannels: GX_Material.LightChannelControl[] = [lightChannel0, lightChannel0];
        // let mat_unk0x02 = this.materialData.unk0x02;
        // let mat_unk0x03 = this.materialData.unk0x03;

        const mb = new GXMaterialBuilder();
        const tevStageCount = this.materialData.tevLayerCount;
        let i = 0;
        for (i = 0; i < tevStageCount; i++) {
            mb.setTevDirect(i);
            let ambSrc = GX.ColorSrc.VTX;
            let matSrc = GX.ColorSrc.VTX;
            mb.setChanCtrl(
                GX.ColorChannelID.COLOR0A0,
                false,
                ambSrc,
                matSrc,
                0,
                GX.DiffuseFunction.NONE,
                GX.AttenuationFunction.NONE
            );
            mb.setTevOrder(
                i,
                (GX.TexCoordID.TEXCOORD0 + i) as GX.TexCoordID,
                (GX.TexMapID.TEXMAP0 + i) as GX.TexMapID,
                GX.RasColorChannelID.COLOR0A0
            );
            const tevLayerData = this.tevLayers[i].tevLayerData;
            const colorType = tevLayerData.colorType;
            const alphaType = tevLayerData.alphaType;

            // Color
            let colorInA = GX.CC.ZERO;
            let colorInB =
                (this.materialData.vtxAttrs & (1 << GX.Attr.CLR0)) !== 0 ? GX.CC.RASC : GX.CC.KONST;
            let colorInC = GX.CC.TEXC;
            let colorInD = GX.CC.ZERO;
            let colorOp = GX.TevOp.ADD;
            let TevOp = GX.TevBias.ZERO; // makes whiter or blacker
            let colorScale = GX.TevScale.SCALE_1;
            let colorRegId = GX.Register.PREV;
            let sel = GX.KonstColorSel.KCSEL_1; // Konst value

            if (i > 0) {
                // tev stage more than 1
                colorInB = GX.CC.CPREV;
            }
            if (colorType === 0x1) {
                // 0x1
                colorInC = GX.CC.ONE;
                colorInD = GX.CC.TEXC;
            }
            if (colorType === 0x2) {
                // 0x2 sub
                colorInD = colorInB;
                colorInB = GX.CC.ONE;
                colorOp = GX.TevOp.SUB;
            }
            if (colorType === 0x3) {
                // 0x3
                colorInC = colorInB;
                colorInB = GX.CC.ONE;
            }

            if (colorType === 0x4) {
                // 0x4
                colorInA = GX.CC.CPREV;
                colorInB = GX.CC.TEXC;
                colorInC = GX.CC.TEXA;
                colorInD = GX.CC.ZERO;
            }

            mb.setTevKColorSel(i, sel);
            mb.setTevColorIn(i, colorInA, colorInB, colorInC, colorInD);
            mb.setTevColorOp(i, colorOp, TevOp, colorScale, true, colorRegId);

            sel = GX.KonstColorSel.KCSEL_1;
            // Alpha
            let alphaInA = GX.CA.TEXA;
            let alphaInB = GX.CA.ZERO;
            let alphaInC = GX.CA.ZERO;
            let alphaInD = GX.CA.ZERO;
            let alphaOp = GX.TevOp.ADD;
            let alphaScale = GX.TevScale.SCALE_1;
            let alphaRegId = GX.Register.PREV;

            if ((alphaType & (1 << 0)) !== 0) {
                alphaInD = GX.CA.APREV;
            }
            if ((alphaType & (1 << 1)) !== 0) {
                // colorInD = GX.CC.CPREV;
                alphaInD = GX.CA.APREV;
            }
            if ((alphaType & (1 << 2)) !== 0) {
                // input swap?
                alphaOp = GX.TevOp.SUB;
            }
            // switch (alphaType){
            //     case(0):
            //         alphaInD = GX.CA.TEXA;
            //         break;
            //     case(1):
            //         alphaInA = GX.CA.TEXA;
            //         alphaInD = GX.CA.APREV;
            //         break;
            //     case(2):
            //         alphaInA = GX.CA.TEXA;
            //         alphaInD = GX.CA.APREV;
            //         colorOp = GX.TevOp.SUB;
            //         break;
            //     case(3):
            //         alphaInD = i === 0 ? GX.CA.TEXA : GX.CA.APREV;
            //         break;
            //     default:
            //         alphaInD = i === 0 ? GX.CA.KONST : GX.CA.APREV;
            //         break;
            // }

            mb.setTevAlphaIn(i, alphaInA, alphaInB, alphaInC, alphaInD);
            mb.setTevAlphaOp(i, alphaOp, TevOp, alphaScale, true, alphaRegId);
            mb.setTevKAlphaSel(i, GX.KonstAlphaSel.KASEL_1);

            // const uvWrap = tevLayerData.uvWrap;
            // const unk0x00 = tevLayerData.unk0x00;
            // mb.setTexCoordGen(
            //     i,
            //     GX.TexGenType.MTX2x4,
            //     (GX.TexGenSrc.TEX0 + i) as GX.TexGenSrc,
            //     (uvWrap & 1) !== 0 ? GX.TexGenMatrix.PNMTX0 : GX.TexGenMatrix.IDENTITY,
            //     false,
            //     (unk0x00 & (1 << 8)) !== 0
            //         ? GX.PostTexGenMatrix.PTTEXMTX0
            //         : GX.PostTexGenMatrix.PTIDENTITY
            // );
            mb.setTexCoordGen(
                i,
                GX.TexGenType.MTX2x4,
                (GX.TexGenSrc.TEX0 + i) as GX.TexGenSrc,
                GX.TexGenMatrix.IDENTITY
            );
        }

        // if ((material.vtxAttr & (1 << GX.Attr.CLR0)) !== 0){
        //     mb.setTevColorIn(i, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        // } else {
        //     mb.setTevColorIn(i, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);

        // unk0x03 << 0 : ???           0x00000001
        // unk0x03 << 1 : culling       0x00000002
        // unk0x03 << 2 : ???           0x00000004 relate Zmode??
        // unk0x03 << 3 : ???           0x00000008
        // unk0x03 << 4 : ???           0x00000010
        // unk0x03 << 5 : depthWrite?   0x00000020
        // unk0x03 << 6 : blend?        0x00000040  (relate 0x3C's 0x00000010)
        //
        // 0x63 blending
        // 0x65
        // mb.setZMode(true, GX.CompareType.LEQUAL, (mat_unk0x03 & (1 << 5)) !== 0 ? false : true);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);

        if (this.translucentShape) {
            // texture conatins "alpha" value
            mb.setAlphaCompare(
                GX.CompareType.GEQUAL,
                0x80,
                GX.AlphaOp.AND,
                GX.CompareType.LEQUAL,
                0xff
            );
        } else {
            mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        }

        // let dstFactor = GX.BlendFactor.INVSRCALPHA;
        // if ((mat_unk0x03 & (1 << 6)) !== 0) {
        //     // Blend Dsetination Factor?
        //     dstFactor = GX.BlendFactor.ONE;
        // }
        mb.setBlendMode(
            GX.BlendMode.BLEND,
            GX.BlendFactor.SRCALPHA,
            GX.BlendFactor.INVSRCALPHA,
            GX.LogicOp.CLEAR
        );

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
        this.materialHelper.allocateMaterialParamsDataOnInst(inst, materialParams);
        inst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        // Draw params
        this.materialHelper.allocateDrawParamsDataOnInst(inst, drawParams);
    }
}
