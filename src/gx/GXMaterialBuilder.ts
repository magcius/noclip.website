
import { TevStage, IndTexStage, TexGen, ColorChannelControl, GXMaterial, LightChannelControl, AlphaTest, RopInfo, SwapTable } from "./gx_material.js";
import * as GX from "./gx_enum.js";
import { autoOptimizeMaterial } from "./gx_render.js";
import { DisplayListRegisters } from "./gx_displaylist.js";

function copyColorChannelControl(colorChannel: ColorChannelControl): ColorChannelControl {
    return {
        lightingEnabled: colorChannel.lightingEnabled,
        matColorSource: colorChannel.matColorSource,
        ambColorSource: colorChannel.ambColorSource,
        litMask: colorChannel.litMask,
        diffuseFunction: colorChannel.diffuseFunction,
        attenuationFunction: colorChannel.attenuationFunction,
    };
}

function copyLightChannelControl(lightChannel: LightChannelControl): LightChannelControl {
    return {
        alphaChannel: copyColorChannelControl(lightChannel.alphaChannel),
        colorChannel: copyColorChannelControl(lightChannel.colorChannel),
    };
}

function copyTexGen(texGen: TexGen): TexGen {
    return {
        type: texGen.type,
        source: texGen.source,
        matrix: texGen.matrix,
        normalize: texGen.normalize,
        postMatrix: texGen.postMatrix,
    };
}

function copyTevStage(tevStage: TevStage): TevStage {
    return {
        colorInA: tevStage.colorInA,
        colorInB: tevStage.colorInB,
        colorInC: tevStage.colorInC,
        colorInD: tevStage.colorInD,
        colorOp: tevStage.colorOp,
        colorBias: tevStage.colorBias,
        colorScale: tevStage.colorScale,
        colorClamp: tevStage.colorClamp,
        colorRegId: tevStage.colorRegId,
        alphaInA: tevStage.alphaInA,
        alphaInB: tevStage.alphaInB,
        alphaInC: tevStage.alphaInC,
        alphaInD: tevStage.alphaInD,
        alphaOp: tevStage.alphaOp,
        alphaBias: tevStage.alphaBias,
        alphaScale: tevStage.alphaScale,
        alphaClamp: tevStage.alphaClamp,
        alphaRegId: tevStage.alphaRegId,
        texCoordId: tevStage.texCoordId,
        texMap: tevStage.texMap,
        channelId: tevStage.channelId,
        konstColorSel: tevStage.konstColorSel,
        konstAlphaSel: tevStage.konstAlphaSel,
        indTexStage: tevStage.indTexStage,
        indTexFormat: tevStage.indTexFormat,
        indTexBiasSel: tevStage.indTexBiasSel,
        indTexAlphaSel: tevStage.indTexAlphaSel,
        indTexMatrix: tevStage.indTexMatrix,
        indTexWrapS: tevStage.indTexWrapS,
        indTexWrapT: tevStage.indTexWrapT,
        indTexAddPrev: tevStage.indTexAddPrev,
        indTexUseOrigLOD: tevStage.indTexUseOrigLOD,
        texSwapTable: tevStage.texSwapTable,
        rasSwapTable: tevStage.rasSwapTable,
    };
}

function copyIndTexStage(indStage: IndTexStage): IndTexStage {
    return {
        texture: indStage.texture,
        texCoordId: indStage.texCoordId,
        scaleS: indStage.scaleS,
        scaleT: indStage.scaleT,
    };
}

function copyRopInfo(ropInfo: RopInfo): RopInfo {
    return {
        fogType: ropInfo.fogType,
        fogAdjEnabled: ropInfo.fogAdjEnabled,
        blendMode: ropInfo.blendMode,
        blendSrcFactor: ropInfo.blendSrcFactor,
        blendDstFactor: ropInfo.blendDstFactor,
        blendLogicOp: ropInfo.blendLogicOp,
        depthTest: ropInfo.depthTest,
        depthFunc: ropInfo.depthFunc,
        depthWrite: ropInfo.depthWrite,
        dstAlpha: ropInfo.dstAlpha,
        colorUpdate: ropInfo.colorUpdate,
        alphaUpdate: ropInfo.alphaUpdate,
    }
}

function copyAlphaTest(alphaTest: AlphaTest): AlphaTest {
    return {
        compareA: alphaTest.compareA,
        referenceA: alphaTest.referenceA,
        op: alphaTest.op,
        compareB: alphaTest.compareB,
        referenceB: alphaTest.referenceB,
    }
}

export class GXMaterialBuilder {
    private cullMode: GX.CullMode;
    private lightChannels: LightChannelControl[] = [];
    private texGens: TexGen[] = [];
    private tevStages: TevStage[] = [];
    private indTexStages: IndTexStage[] = [];
    private alphaTest: AlphaTest;
    private ropInfo: RopInfo;
    private usePnMtxIdx: boolean;
    private hasDynamicAlphaTest: boolean;

    constructor(private name: string | null = null) {
        this.reset();
    }

    public reset(): void {
        this.cullMode = GX.CullMode.NONE;
        this.lightChannels.length = 0;
        this.texGens.length = 0;
        this.tevStages.length = 0;
        this.indTexStages.length = 0;

        this.alphaTest = {} as AlphaTest;
        this.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);

        this.ropInfo = {} as RopInfo;
        this.setFog(GX.FogType.NONE, false);
        this.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.CLEAR);
        this.setZMode(true, GX.CompareType.LEQUAL, true);
        this.setColorUpdate(true);
        this.setAlphaUpdate(false);

        this.usePnMtxIdx = true;
        this.hasDynamicAlphaTest = false;
    }

    public setCullMode(cullMode: GX.CullMode): void {
        this.cullMode = cullMode;
    }

    private ensureTexCoordGen(idx: GX.TexCoordID): TexGen {
        if (this.texGens[idx] === undefined)
            this.texGens[idx] = {} as TexGen;
        return this.texGens[idx];
    }

    public setTexCoordGen(idx: GX.TexCoordID, type: GX.TexGenType, source: GX.TexGenSrc, matrix: GX.TexGenMatrix, normalize: boolean = false, postMatrix: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY): void {
        const texGen = this.ensureTexCoordGen(idx);
        texGen.type = type;
        texGen.source = source;
        texGen.matrix = matrix;
        texGen.normalize = normalize;
        texGen.postMatrix = postMatrix;
    }

    private ensureLightChannel(idx: number): LightChannelControl {
        if (this.lightChannels[idx] === undefined) {
            this.lightChannels[idx] = {
                colorChannel: {} as ColorChannelControl,
                alphaChannel: {} as ColorChannelControl,
            };

            this.setChanCtrlInternal(this.lightChannels[idx].colorChannel, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            this.setChanCtrlInternal(this.lightChannels[idx].alphaChannel, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }

        return this.lightChannels[idx];
    }

    private setChanCtrlInternal(chanCtrl: ColorChannelControl, enable: boolean, ambSrc: GX.ColorSrc, matSrc: GX.ColorSrc, lightMask: number, diffFn: GX.DiffuseFunction, attnFn: GX.AttenuationFunction): void {
        chanCtrl.lightingEnabled = enable;
        chanCtrl.ambColorSource = ambSrc;
        chanCtrl.matColorSource = matSrc;
        chanCtrl.litMask = lightMask;
        chanCtrl.diffuseFunction = diffFn;
        chanCtrl.attenuationFunction = attnFn;
    }

    public setChanCtrl(idx: GX.ColorChannelID, enable: boolean, ambSrc: GX.ColorSrc, matSrc: GX.ColorSrc, lightMask: number, diffFn: GX.DiffuseFunction, attnFn: GX.AttenuationFunction): void {
        const lightChannel = this.ensureLightChannel(idx & 0x01);

        const set = (idx >>> 1) + 1;
        if (!!(set & 0x01))
            this.setChanCtrlInternal(lightChannel.colorChannel, enable, ambSrc, matSrc, lightMask, diffFn, attnFn);
        if (!!(set & 0x02))
            this.setChanCtrlInternal(lightChannel.alphaChannel, enable, ambSrc, matSrc, lightMask, diffFn, attnFn);
    }

    private ensureTevStage(idx: number): TevStage {
        if (this.tevStages[idx] === undefined) {
            this.tevStages[idx] = {} as TevStage;

            if (idx <= 7)
                this.setTevOrder(idx, GX.TexCoordID.TEXCOORD0 + idx, GX.TexMapID.TEXMAP0 + idx, GX.RasColorChannelID.COLOR0A0);
            else
                this.setTevOrder(idx, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);

            this.setTevColorOp(idx, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
            this.setTevAlphaOp(idx, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
            this.setTevColorIn(idx, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC),
            this.setTevAlphaIn(idx, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA),

            this.setTevKColorSel(idx, GX.KonstColorSel.KCSEL_2_8);
            this.setTevKAlphaSel(idx, GX.KonstAlphaSel.KASEL_1);

            this.setTevDirect(idx);
        }

        return this.tevStages[idx];
    }

    public setTevOrder(idx: number, texCoordID: GX.TexCoordID, texMap: GX.TexMapID, channelId: GX.RasColorChannelID): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.texCoordId = texCoordID;
        tevStage.texMap = texMap;
        tevStage.channelId = channelId;
    }

    public setTevColorOp(idx: number, colorOp: GX.TevOp, colorBias: GX.TevBias, colorScale: GX.TevScale, colorClamp: boolean, colorRegId: GX.Register): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.colorOp = colorOp;
        tevStage.colorBias = colorBias;
        tevStage.colorScale = colorScale;
        tevStage.colorClamp = colorClamp;
        tevStage.colorRegId = colorRegId;
    }

    public setTevAlphaOp(idx: number, alphaOp: GX.TevOp, alphaBias: GX.TevBias, alphaScale: GX.TevScale, alphaClamp: boolean, alphaRegId: GX.Register): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.alphaOp = alphaOp;
        tevStage.alphaBias = alphaBias;
        tevStage.alphaScale = alphaScale;
        tevStage.alphaClamp = alphaClamp;
        tevStage.alphaRegId = alphaRegId;
    }

    public setTevColorIn(idx: number, colorInA: GX.CC, colorInB: GX.CC, colorInC: GX.CC, colorInD: GX.CC): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.colorInA = colorInA;
        tevStage.colorInB = colorInB;
        tevStage.colorInC = colorInC;
        tevStage.colorInD = colorInD;
    }

    public setTevAlphaIn(idx: number, alphaInA: GX.CA, alphaInB: GX.CA, alphaInC: GX.CA, alphaInD: GX.CA): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.alphaInA = alphaInA;
        tevStage.alphaInB = alphaInB;
        tevStage.alphaInC = alphaInC;
        tevStage.alphaInD = alphaInD;
    }

    public setTevKColorSel(idx: number, sel: GX.KonstColorSel): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.konstColorSel = sel;
    }

    public setTevKAlphaSel(idx: number, sel: GX.KonstAlphaSel): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.konstAlphaSel = sel;
    }

    public setTevSwapMode(idx: number, rasSwapTable: SwapTable | undefined, texSwapTable: SwapTable | undefined): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.rasSwapTable = rasSwapTable;
        tevStage.texSwapTable = texSwapTable;
    }

    public setTevIndirect(tevStageIdx: number, indTexStage: GX.IndTexStageID, format: GX.IndTexFormat, biasSel: GX.IndTexBiasSel, matrixSel: GX.IndTexMtxID, wrapS: GX.IndTexWrap, wrapT: GX.IndTexWrap, addPrev: boolean, utcLod: boolean, alphaSel: GX.IndTexAlphaSel): void {
        const tevStage = this.ensureTevStage(tevStageIdx);
        tevStage.indTexStage = indTexStage;
        tevStage.indTexFormat = format;
        tevStage.indTexBiasSel = biasSel;
        tevStage.indTexAlphaSel = alphaSel;
        tevStage.indTexMatrix = matrixSel;
        tevStage.indTexWrapS = wrapS;
        tevStage.indTexWrapT = wrapT;
        tevStage.indTexAddPrev = addPrev;
        tevStage.indTexUseOrigLOD = utcLod;
    }

    public setTevIndWarp(tevStageIdx: number, indTexStage: GX.IndTexStageID, signedOffsets: boolean, replaceMode: boolean, matrixSel: GX.IndTexMtxID): void {
        const biasSel = signedOffsets ? GX.IndTexBiasSel.ST : GX.IndTexBiasSel.NONE;
        const wrap = replaceMode ? GX.IndTexWrap._0 : GX.IndTexWrap.OFF;
        this.setTevIndirect(tevStageIdx, indTexStage, GX.IndTexFormat._8, biasSel, matrixSel, wrap, wrap, false, false, GX.IndTexAlphaSel.OFF);
    }

    public setTevDirect(tevStageIdx: number): void {
        this.setTevIndirect(tevStageIdx, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.NONE, GX.IndTexMtxID.OFF, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
    }

    private ensureIndTexStage(idx: GX.IndTexStageID): IndTexStage {
        if (this.indTexStages[idx] === undefined) {
            this.indTexStages[idx] = {} as IndTexStage;
            // Don't set IndTexOrder -- the user should set it.
            this.setIndTexScale(idx, GX.IndTexScale._1, GX.IndTexScale._1);
        }

        return this.indTexStages[idx];
    }

    public setIndTexOrder(idx: GX.IndTexStageID, texcoord: GX.TexCoordID, texmap: GX.TexMapID): void {
        const indStage = this.ensureIndTexStage(idx);
        indStage.texCoordId = texcoord;
        indStage.texture = texmap;
    }

    public setIndTexScale(idx: GX.IndTexStageID, scaleS: GX.IndTexScale, scaleT: GX.IndTexScale): void {
        const indStage = this.ensureIndTexStage(idx);
        indStage.scaleS = scaleS;
        indStage.scaleT = scaleT;
    }

    public setAlphaCompare(compareA: GX.CompareType, referenceA: number, op: GX.AlphaOp, compareB: GX.CompareType, referenceB: number): void {
        this.alphaTest.compareA = compareA;
        this.alphaTest.referenceA = referenceA / 0xFF;
        this.alphaTest.op = op;
        this.alphaTest.compareB = compareB;
        this.alphaTest.referenceB = referenceB / 0xFF;
    }

    public setFog(fogType: GX.FogType, fogAdjEnabled: boolean): void {
        this.ropInfo.fogType = fogType;
        this.ropInfo.fogAdjEnabled = fogAdjEnabled;
    }

    public setBlendMode(blendMode: GX.BlendMode, srcFactor: GX.BlendFactor, dstFactor: GX.BlendFactor, logicOp: GX.LogicOp = GX.LogicOp.CLEAR): void {
        this.ropInfo.blendMode = blendMode;
        this.ropInfo.blendSrcFactor = srcFactor;
        this.ropInfo.blendDstFactor = dstFactor;
        this.ropInfo.blendLogicOp = logicOp;
    }

    public setZMode(depthTest: boolean, depthFunc: GX.CompareType, depthWrite: boolean): void {
        this.ropInfo.depthTest = depthTest;
        this.ropInfo.depthFunc = depthFunc;
        this.ropInfo.depthWrite = depthWrite;
    }

    public setDstAlpha(v?: number): void {
        this.ropInfo.dstAlpha = v;
    }

    public setColorUpdate(v: boolean): void {
        this.ropInfo.colorUpdate = v;
    }

    public setAlphaUpdate(v: boolean): void {
        this.ropInfo.alphaUpdate = v;
    }

    public setUsePnMtxIdx(v: boolean): void {
        this.usePnMtxIdx = v;
    }

    public setDynamicAlphaTest(v: boolean): void {
        this.hasDynamicAlphaTest = v;
    }

    public setTexGenFromRegisters(r: DisplayListRegisters, i: number): void {
        const v = r.xfGet(GX.XFRegister.XF_TEX0_ID + i);

        enum TexProjection {
            ST = 0x00,
            STQ = 0x01,
        }
        enum TexForm {
            AB11 = 0x00,
            ABC1 = 0x01,
        }
        enum TexGenType {
            REGULAR = 0x00,
            EMBOSS_MAP = 0x01,
            COLOR_STRGBC0 = 0x02,
            COLOR_STRGBC1 = 0x02,
        }
        enum TexSourceRow {
            GEOM = 0x00,
            NRM = 0x01,
            CLR = 0x02,
            BNT = 0x03,
            BNB = 0x04,
            TEX0 = 0x05,
            TEX1 = 0x06,
            TEX2 = 0x07,
            TEX3 = 0x08,
            TEX4 = 0x09,
            TEX5 = 0x0A,
            TEX6 = 0x0B,
            TEX7 = 0x0C,
        }

        const proj: TexProjection = (v >>>  1) & 0x01;
        const form: TexForm =       (v >>>  2) & 0x01;
        const tgType: TexGenType =  (v >>>  4) & 0x02;
        const src: TexSourceRow =   (v >>>  7) & 0x0F;
        const embossSrc =           (v >>> 12) & 0x07;
        const embossLgt =           (v >>> 15) & 0x07;

        let texGenType: GX.TexGenType;
        let texGenSrc: GX.TexGenSrc;

        if (tgType === TexGenType.REGULAR) {
            const srcLookup = [
                GX.TexGenSrc.POS,
                GX.TexGenSrc.NRM,
                GX.TexGenSrc.COLOR0,
                GX.TexGenSrc.BINRM,
                GX.TexGenSrc.TANGENT,
                GX.TexGenSrc.TEX0,
                GX.TexGenSrc.TEX1,
                GX.TexGenSrc.TEX2,
                GX.TexGenSrc.TEX3,
                GX.TexGenSrc.TEX4,
                GX.TexGenSrc.TEX5,
                GX.TexGenSrc.TEX6,
                GX.TexGenSrc.TEX7,
            ];

            texGenType = proj === TexProjection.ST ? GX.TexGenType.MTX2x4 : GX.TexGenType.MTX3x4;
            texGenSrc = srcLookup[src];
        } else if (tgType === TexGenType.EMBOSS_MAP) {
            texGenType = GX.TexGenType.BUMP0 + embossLgt;
            texGenSrc = GX.TexGenSrc.TEXCOORD0 + embossSrc;
        } else if (tgType === TexGenType.COLOR_STRGBC0) {
            texGenType = GX.TexGenType.SRTG;
            texGenSrc = GX.TexGenSrc.COLOR0;
        } else if (tgType === TexGenType.COLOR_STRGBC1) {
            texGenType = GX.TexGenType.SRTG;
            texGenSrc = GX.TexGenSrc.COLOR1;
        } else {
            throw "whoops";
        }

        // TODO(jstpierre): XF_MATRIXINDEX0_ID
        const matrix: GX.TexGenMatrix = GX.TexGenMatrix.IDENTITY;

        const dv = r.xfGet(GX.XFRegister.XF_DUALTEX0_ID + i);
        const postMatrix: GX.PostTexGenMatrix = ((dv >>> 0) & 0xFF) + GX.PostTexGenMatrix.PTTEXMTX0;
        const normalize: boolean = !!((dv >>> 8) & 0x01);

        this.setTexCoordGen(i, texGenType, texGenSrc, matrix, normalize, postMatrix);
    }

    public setColorChannelFromRegisters(r: DisplayListRegisters, i: number): void {
        const colorCntrl = r.xfGet(GX.XFRegister.XF_COLOR0CNTRL_ID + i);
        const alphaCntrl = r.xfGet(GX.XFRegister.XF_ALPHA0CNTRL_ID + i);

        const setChanCtrl = (dst: ColorChannelControl, chanCtrl: number) => {
            const matColorSource: GX.ColorSrc =           (chanCtrl >>>  0) & 0x01;
            const lightingEnabled: boolean =           !!((chanCtrl >>>  1) & 0x01);
            const litMaskL: number =                      (chanCtrl >>>  2) & 0x0F;
            const ambColorSource: GX.ColorSrc =           (chanCtrl >>>  6) & 0x01;
            const diffuseFunction: GX.DiffuseFunction =   (chanCtrl >>>  7) & 0x03;
            const attnEn: boolean =                    !!((chanCtrl >>>  9) & 0x01);
            const attnSelect: boolean =                !!((chanCtrl >>> 10) & 0x01);
            const litMaskH: number =                      (chanCtrl >>> 11) & 0x0F;

            const litMask: number =                       (litMaskH << 4) | litMaskL;
            const attenuationFunction = attnEn ? (attnSelect ? GX.AttenuationFunction.SPOT : GX.AttenuationFunction.SPEC) : GX.AttenuationFunction.NONE;

            this.setChanCtrlInternal(dst, lightingEnabled, ambColorSource, matColorSource, litMask, diffuseFunction, attenuationFunction);
        };

        const dstChannel = this.ensureLightChannel(i);
        setChanCtrl(dstChannel.colorChannel, colorCntrl);
        setChanCtrl(dstChannel.alphaChannel, alphaCntrl);
    }

    public setTevStageFromRegisters(r: DisplayListRegisters, i: number): void {
        const v = r.bp[GX.BPRegister.RAS1_TREF_0_ID + (i >>> 1)];
        const ti: GX.TexMapID =          (v >>>  ((i & 1) ? 12 : 0)) & 0x07;
        const tc: GX.TexCoordID =        (v >>>  ((i & 1) ? 15 : 3)) & 0x07;
        const te: boolean =           !!((v >>>  ((i & 1) ? 18 : 6)) & 0x01);
        const cc: GX.RasColorChannelID = (v >>>  ((i & 1) ? 19 : 7)) & 0x07;
        this.setTevOrder(i, tc, te ? ti : GX.TexMapID.TEXMAP_NULL, cc);

        const color = r.bp[GX.BPRegister.TEV_COLOR_ENV_0_ID + (i * 2)];

        const colorInD: GX.CC = (color >>>  0) & 0x0F;
        const colorInC: GX.CC = (color >>>  4) & 0x0F;
        const colorInB: GX.CC = (color >>>  8) & 0x0F;
        const colorInA: GX.CC = (color >>> 12) & 0x0F;
        const colorBias: GX.TevBias =          (color >>> 16) & 0x03;
        const colorSub: boolean =           !!((color >>> 18) & 0x01);
        const colorClamp: boolean =         !!((color >>> 19) & 0x01);
        const colorScale: GX.TevScale =        (color >>> 20) & 0x03;
        const colorRegId: GX.Register =        (color >>> 22) & 0x03;

        const colorOp: GX.TevOp = findTevOp(colorBias, colorScale, colorSub);

        function findTevOp(bias: GX.TevBias, scale: GX.TevScale, sub: boolean): GX.TevOp {
            if (bias === GX.TevBias.$HWB_COMPARE) {
                switch (scale) {
                case GX.TevScale.$HWB_R8: return sub ? GX.TevOp.COMP_R8_EQ : GX.TevOp.COMP_R8_GT;
                case GX.TevScale.$HWB_GR16: return sub ? GX.TevOp.COMP_GR16_EQ : GX.TevOp.COMP_GR16_GT;
                case GX.TevScale.$HWB_BGR24: return sub ? GX.TevOp.COMP_BGR24_EQ : GX.TevOp.COMP_BGR24_GT;
                case GX.TevScale.$HWB_RGB8: return sub ? GX.TevOp.COMP_RGB8_EQ : GX.TevOp.COMP_RGB8_GT;
                default:
                    throw "whoops 2";
                }
            } else {
                return sub ? GX.TevOp.SUB : GX.TevOp.ADD;
            }
        }

        // Find the op.
        const alpha = r.bp[GX.BPRegister.TEV_ALPHA_ENV_0_ID + (i * 2)];

        const rswap: number =                  (alpha >>>  0) & 0x03;
        const tswap: number =                  (alpha >>>  2) & 0x03;
        const alphaInD: GX.CA = (alpha >>>  4) & 0x07;
        const alphaInC: GX.CA = (alpha >>>  7) & 0x07;
        const alphaInB: GX.CA = (alpha >>> 10) & 0x07;
        const alphaInA: GX.CA = (alpha >>> 13) & 0x07;
        const alphaBias: GX.TevBias =          (alpha >>> 16) & 0x03;
        const alphaSub: boolean =           !!((alpha >>> 18) & 0x01);
        const alphaClamp: boolean =         !!((alpha >>> 19) & 0x01);
        const alphaScale: GX.TevScale =        (alpha >>> 20) & 0x03;
        const alphaRegId: GX.Register =        (alpha >>> 22) & 0x03;

        const alphaOp: GX.TevOp = findTevOp(alphaBias, alphaScale, alphaSub);

        this.setTevColorIn(i, colorInA, colorInB, colorInC, colorInD);
        this.setTevColorOp(i, colorOp, colorBias, colorScale, colorClamp, colorRegId);

        this.setTevAlphaIn(i, alphaInA, alphaInB, alphaInC, alphaInD);
        this.setTevAlphaOp(i, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId);

        const ksel = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (i >>> 1)];
        const konstColorSel: GX.KonstColorSel = ((i & 1) ? (ksel >>> 14) : (ksel >>> 4)) & 0x1F;
        const konstAlphaSel: GX.KonstAlphaSel = ((i & 1) ? (ksel >>> 19) : (ksel >>> 9)) & 0x1F;

        this.setTevKColorSel(i, konstColorSel);
        this.setTevKAlphaSel(i, konstAlphaSel);

        const indCmd = r.bp[GX.BPRegister.IND_CMD0_ID + i];
        const indTexStage: GX.IndTexStageID =     (indCmd >>>  0) & 0x03;
        const indTexFormat: GX.IndTexFormat =     (indCmd >>>  2) & 0x03;
        const indTexBiasSel: GX.IndTexBiasSel =   (indCmd >>>  4) & 0x07;
        const indTexAlphaSel: GX.IndTexAlphaSel = (indCmd >>>  7) & 0x03;
        const indTexMatrix: GX.IndTexMtxID =      (indCmd >>>  9) & 0x0F;
        const indTexWrapS: GX.IndTexWrap =        (indCmd >>> 13) & 0x07;
        const indTexWrapT: GX.IndTexWrap =        (indCmd >>> 16) & 0x07;
        const indTexUseOrigLOD: boolean =      !!((indCmd >>> 19) & 0x01);
        const indTexAddPrev: boolean =         !!((indCmd >>> 20) & 0x01);

        this.setTevIndirect(i, indTexStage, indTexFormat, indTexBiasSel, indTexMatrix, indTexWrapS, indTexWrapT, indTexAddPrev, indTexUseOrigLOD, indTexAlphaSel);

        const rasSwapTableRG = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (rswap * 2)];
        const rasSwapTableBA = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (rswap * 2) + 1];

        const rasSwapTable: SwapTable = [
            (rasSwapTableRG >>> 0) & 0x03,
            (rasSwapTableRG >>> 2) & 0x03,
            (rasSwapTableBA >>> 0) & 0x03,
            (rasSwapTableBA >>> 2) & 0x03,
        ];

        const texSwapTableRG = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (tswap * 2)];
        const texSwapTableBA = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (tswap * 2) + 1];

        const texSwapTable: SwapTable = [
            (texSwapTableRG >>> 0) & 0x03,
            (texSwapTableRG >>> 2) & 0x03,
            (texSwapTableBA >>> 0) & 0x03,
            (texSwapTableBA >>> 2) & 0x03,
        ];

        this.setTevSwapMode(i, rasSwapTable, texSwapTable);
    }

    public setIndTexStageFromRegisters(r: DisplayListRegisters, i: number): void {
        const iref = r.bp[GX.BPRegister.RAS1_IREF_ID];
        const ss = r.bp[GX.BPRegister.RAS1_SS0_ID + (i >>> 2)];
        const scaleS: GX.IndTexScale = (ss >>> ((0x08 * (i & 1)) + 0x00) & 0x0F);
        const scaleT: GX.IndTexScale = (ss >>> ((0x08 * (i & 1)) + 0x04) & 0x0F);
        const texture: GX.TexMapID = (iref >>> (0x06*i)) & 0x07;
        const texCoordId: GX.TexCoordID = (iref >>> (0x06*i)) & 0x07;
        this.setIndTexOrder(i, texCoordId, texture);
        this.setIndTexScale(i, scaleS, scaleT);
    }

    public setRopStateFromRegisters(r: DisplayListRegisters): void {
        // Fog state.
        // TODO(jstpierre): Support Fog
        const fogType = GX.FogType.NONE;
        const fogAdjEnabled = false;
    
        // Blend mode.
        if (r.bpRegIsSet(GX.BPRegister.PE_CMODE0_ID)) {
            const cm0 = r.bp[GX.BPRegister.PE_CMODE0_ID];
            const bmboe = (cm0 >>> 0) & 0x01;
            const bmloe = (cm0 >>> 1) & 0x01;
            // bit 2 = dither
            const colorUpdate = !!((cm0 >>> 3) & 0x01);
            const alphaUpdate = !!((cm0 >>> 4) & 0x01);
            this.setColorUpdate(colorUpdate);
            this.setAlphaUpdate(alphaUpdate);
            const bmbop = (cm0 >>> 11) & 0x01;
    
            const blendMode: GX.BlendMode =
                bmboe ? (bmbop ? GX.BlendMode.SUBTRACT : GX.BlendMode.BLEND) :
                bmloe ? GX.BlendMode.LOGIC : GX.BlendMode.NONE;;
            const blendDstFactor: GX.BlendFactor = (cm0 >>> 5) & 0x07;
            const blendSrcFactor: GX.BlendFactor = (cm0 >>> 8) & 0x07;
            const blendLogicOp: GX.LogicOp = (cm0 >>> 12) & 0x0F;
            this.setBlendMode(blendMode, blendSrcFactor, blendDstFactor, blendLogicOp);
        }
    
        // Depth state.
        if (r.bpRegIsSet(GX.BPRegister.PE_ZMODE_ID)) {
            const zm = r.bp[GX.BPRegister.PE_ZMODE_ID];
            const depthTest = !!((zm >>> 0) & 0x01);
            const depthFunc = (zm >>> 1) & 0x07;
            const depthWrite = !!((zm >>> 4) & 0x01);
            this.setZMode(depthTest, depthFunc, depthWrite);
        }
        //#endregion

        //#region Alpha Test
        if (r.bpRegIsSet(GX.BPRegister.TEV_ALPHAFUNC_ID)) {
            const ap = r.bp[GX.BPRegister.TEV_ALPHAFUNC_ID];
            const refA = (ap >>>  0) & 0xFF;
            const refB = (ap >>>  8) & 0xFF;
            const compareA = (ap >>> 16) & 0x07;
            const compareB = (ap >>> 19) & 0x07;
            const op = (ap >>> 22) & 0x07;
            this.setAlphaCompare(compareA, refA, op, compareB, refB);
        }
        //#endregion

        if (r.bpRegIsSet(GX.BPRegister.GEN_MODE_ID)) {
            const genMode = r.bp[GX.BPRegister.GEN_MODE_ID];
            const hw2cm: GX.CullMode[] = [ GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL ];
            const cullMode = hw2cm[((genMode >>> 14)) & 0x03];
            this.setCullMode(cullMode);
        }
    }

    public setFromRegisters(r: DisplayListRegisters): void {
        const genMode = r.bp[GX.BPRegister.GEN_MODE_ID];

        const numTexGens = (genMode >>> 0) & 0x0F;
        for (let i = 0; i < numTexGens; i++)
            this.setTexGenFromRegisters(r, i);

        const numTevStages = ((genMode >>> 10) & 0x0F) + 1;
        for (let i = 0; i < numTevStages; i++)
            this.setTevStageFromRegisters(r, i);

        const numInds = ((genMode >>> 16) & 0x07);
        for (let i = 0; i < numInds; i++)
            this.setIndTexStageFromRegisters(r, i);

        const numColors = r.xfGet(GX.XFRegister.XF_NUMCOLORS_ID);
        for (let i = 0; i < numColors; i++)
            this.setColorChannelFromRegisters(r, i);

        this.setRopStateFromRegisters(r);
    }

    public finish(name: string | null = null): GXMaterial {
        if (name === null)
            name = this.name;
        if (name === null)
            name = '';

        const material: GXMaterial = {
            name: name,
            cullMode: this.cullMode,
            lightChannels: this.lightChannels.map(copyLightChannelControl),
            texGens: this.texGens.map(copyTexGen),
            tevStages: this.tevStages.map(copyTevStage),
            indTexStages: this.indTexStages.map(copyIndTexStage),
            alphaTest: copyAlphaTest(this.alphaTest),
            ropInfo: copyRopInfo(this.ropInfo),
            usePnMtxIdx: this.usePnMtxIdx,
            hasDynamicAlphaTest: this.hasDynamicAlphaTest,
        };
        autoOptimizeMaterial(material);
        return material;
    }
}
