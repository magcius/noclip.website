
import { TevStage, IndTexStage, TexGen, ColorChannelControl, GXMaterial, LightChannelControl, AlphaTest, RopInfo } from "./gx_material";
import * as GX from "./gx_enum";
import { autoOptimizeMaterial } from "./gx_render";

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
        indTexMatrix: tevStage.indTexMatrix,
        indTexWrapS: tevStage.indTexWrapS,
        indTexWrapT: tevStage.indTexWrapT,
        indTexAddPrev: tevStage.indTexAddPrev,
        indTexUseOrigLOD: tevStage.indTexUseOrigLOD,
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
        blendMode: ropInfo.blendMode,
        blendSrcFactor: ropInfo.blendSrcFactor,
        blendDstFactor: ropInfo.blendDstFactor,
        blendLogicOp: ropInfo.blendLogicOp,
        depthTest: ropInfo.depthTest,
        depthFunc: ropInfo.depthFunc,
        depthWrite: ropInfo.depthWrite,
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
    private cullMode: GX.CullMode = GX.CullMode.NONE;
    private lightChannels: LightChannelControl[] = [];
    private texGens: TexGen[] = [];
    private tevStages: TevStage[] = [];
    private indTexStages: IndTexStage[] = [];
    private alphaTest: AlphaTest;
    private ropInfo: RopInfo;
    private usePnMtxIdx?: boolean;

    constructor(private name: string | null = null) {
        this.alphaTest = {} as AlphaTest;
        this.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);

        this.ropInfo = {
        } as RopInfo;
        this.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.CLEAR);
        this.setZMode(true, GX.CompareType.LEQUAL, true);
    }

    public setCullMode(cullMode: GX.CullMode): void {
        this.cullMode = cullMode;
    }

    private ensureTexCoordGen(idx: GX.TexCoordID): TexGen {
        if (this.texGens[idx] === undefined) {
            this.texGens[idx] = {} as TexGen;
        }

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
            this.setTevColorIn(idx, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC),
            this.setTevAlphaIn(idx, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),

            this.setTevKColorSel(idx, GX.KonstColorSel.KCSEL_1_4);
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

    public setTevColorIn(idx: number, colorInA: GX.CombineColorInput, colorInB: GX.CombineColorInput, colorInC: GX.CombineColorInput, colorInD: GX.CombineColorInput): void {
        const tevStage = this.ensureTevStage(idx);
        tevStage.colorInA = colorInA;
        tevStage.colorInB = colorInB;
        tevStage.colorInC = colorInC;
        tevStage.colorInD = colorInD;
    }

    public setTevAlphaIn(idx: number, alphaInA: GX.CombineAlphaInput, alphaInB: GX.CombineAlphaInput, alphaInC: GX.CombineAlphaInput, alphaInD: GX.CombineAlphaInput): void {
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

    public setTevIndirect(tevStageIdx: number, indTexStage: GX.IndTexStageID, format: GX.IndTexFormat, biasSel: GX.IndTexBiasSel, matrixSel: GX.IndTexMtxID, wrapS: GX.IndTexWrap, wrapT: GX.IndTexWrap, addPrev: boolean, utcLod: boolean, alphaSel: GX.IndTexAlphaSel): void {
        const tevStage = this.ensureTevStage(tevStageIdx);
        tevStage.indTexStage = indTexStage;
        tevStage.indTexFormat = format;
        tevStage.indTexBiasSel = biasSel;
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

    public setUsePnMtxIdx(v: boolean): void {
        this.usePnMtxIdx = v;
    }

    public finish(name: string | null = null): GXMaterial {
        if (name === null)
            name = this.name;
        if (name === null)
            name = '';

        const material = {
            name: name,
            cullMode: this.cullMode,
            lightChannels: this.lightChannels.map(copyLightChannelControl),
            texGens: this.texGens.map(copyTexGen),
            tevStages: this.tevStages.map(copyTevStage),
            indTexStages: this.indTexStages.map(copyIndTexStage),
            alphaTest: copyAlphaTest(this.alphaTest),
            ropInfo: copyRopInfo(this.ropInfo),
            usePnMtxIdx: this.usePnMtxIdx,
        };
        autoOptimizeMaterial(material);
        return material;
    }
}
