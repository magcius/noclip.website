import { mat4 } from 'gl-matrix';
import * as GX from '../gx/gx_enum.js';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder.js";
import { GXMaterial, SwapTable } from '../gx/gx_material.js';
import { MaterialParams, ColorKind, GXMaterialHelperGfx } from '../gx/gx_render.js';
import { TextureMapping } from '../TextureHolder.js';

import { Color, colorCopy, TransparentBlack, White } from '../Color.js';
import { nArray } from '../util.js';

// Declare opaque types, as described in <https://evertpot.com/opaque-ts-types/>.
// These types compile as plain numbers, with no additional runtime overhead.
// TypeScript guards against mixing up objects of different types (although
// these types can be passed as plain numbers with zero friction).

declare const isTevStage: unique symbol;
export type TevStage = number & { [isTevStage]: true }
declare const isIndTexStage: unique symbol;
export type IndTexStage = number & { [isIndTexStage]: true }
declare const isTexMap: unique symbol;
export type TexMap = number & { [isTexMap]: true }
declare const isTexCoord: unique symbol;
export type TexCoord = number & { [isTexCoord]: true }
declare const isPostTexMtx: unique symbol;
export type PostTexMtx = number & { [isPostTexMtx]: true }
declare const isIndTexMtx: unique symbol;
export type IndTexMtx = number & { [isIndTexMtx]: true }
declare const isKonstColor: unique symbol;
export type KonstColor = number & { [isKonstColor]: true }

export function getGXIndTexStageID(indTexStage: IndTexStage): GX.IndTexStageID {
    return GX.IndTexStageID.STAGE0 + indTexStage;
}

export function getGXTexMapID(texMap: TexMap | null): GX.TexMapID {
    return texMap !== null ? GX.TexMapID.TEXMAP0 + texMap : GX.TexMapID.TEXMAP_NULL;
}

export function getGXTexCoordID(texCoord: TexCoord | null): GX.TexCoordID {
    return texCoord !== null ? GX.TexCoordID.TEXCOORD0 + texCoord : GX.TexCoordID.TEXCOORD_NULL;
}

export function getGXPostTexGenMatrix(postTexMtx: PostTexMtx): GX.PostTexGenMatrix {
    return GX.PostTexGenMatrix.PTTEXMTX0 + 3 * postTexMtx;
}

export function getGXIndTexMtxID(indTexMtx: IndTexMtx): GX.IndTexMtxID {
    return GX.IndTexMtxID._0 + indTexMtx;
}

export function getGXIndTexMtxID_S(indTexMtx: IndTexMtx): GX.IndTexMtxID {
    return GX.IndTexMtxID.S0 + indTexMtx;
}

export function getGXIndTexMtxID_T(indTexMtx: IndTexMtx): GX.IndTexMtxID {
    return GX.IndTexMtxID.T0 + indTexMtx;
}

export function getGXKonstColorSel(kcolor: KonstColor): GX.KonstColorSel {
    return GX.KonstColorSel.KCSEL_K0 + kcolor;
}

export function getGXKonstAlphaSel(kcolor: KonstColor): GX.KonstAlphaSel {
    return GX.KonstAlphaSel.KASEL_K0_A + kcolor;
}

export type TexFunc<RenderContext> = ((dst: TextureMapping, ctx: RenderContext) => void) | undefined;
export type MtxFunc<RenderContext> = ((dst: mat4, ctx: RenderContext) => void) | undefined;
export type ColorFunc<RenderContext> = ((dst: Color, ctx: RenderContext) => void) | undefined;

export class SFAMaterialBuilder<RenderContext = undefined> {
    private mb: GXMaterialBuilder;
    private tevStageNum: number;
    private indTexStageNum: number;
    private texCoordNum: number;
    private texMaps: TexFunc<RenderContext>[];
    private texMtxs: MtxFunc<RenderContext>[];
    private ambColors: ColorFunc<RenderContext>[];
    private matColors: ColorFunc<RenderContext>[];
    private postTexMtxs: MtxFunc<RenderContext>[];
    private indTexMtxs: MtxFunc<RenderContext>[];
    private konstColors: ColorFunc<RenderContext>[];
    private tevRegColors: ColorFunc<RenderContext>[];
    private texCoordUsesMtxIndex?: boolean[];
    
    private gxMaterial: GXMaterial | undefined = undefined;
    private gxMaterialHelper: GXMaterialHelperGfx | undefined = undefined;

    constructor(private name: string | null = null) {
        this.reset();
    }

    public reset() {
        this.mb = new GXMaterialBuilder(this.name);
        this.tevStageNum = 0;
        this.indTexStageNum = 0;
        this.texCoordNum = 0;
        this.texMaps = [];
        this.texMtxs = [];
        this.ambColors = [];
        this.matColors = [];
        this.postTexMtxs = [];
        this.indTexMtxs = [];
        this.konstColors = [];
        this.tevRegColors = [];
        this.texCoordUsesMtxIndex = undefined;
        this.gxMaterial = undefined;
        this.gxMaterialHelper = undefined;
    }
    
    public genTevStage(): TevStage {
        const id = this.tevStageNum;
        if (id >= 16)
            throw Error(`Too many TEV stages`);
        this.tevStageNum++;
        return id as TevStage;
    }

    public getTevStageCount(): number {
        return this.tevStageNum;
    }

    public genIndTexStage(): IndTexStage {
        const id = this.indTexStageNum;
        if (id >= 4)
            throw Error(`Too many indirect texture stages`);
        this.indTexStageNum++;
        return id as IndTexStage;
    }

    public getIndTexStageCount(): number {
        return this.indTexStageNum;
    }

    public genTexMap(texture: TexFunc<RenderContext>): TexMap {
        const id = this.texMaps.length;
        if (id >= 8)
            throw Error(`Too many texture maps`);
        this.texMaps.push(texture);
        return id as TexMap;
    }

    public getTexMapCount(): number {
        return this.texMaps.length;
    }

    public genTexCoord(texGenType: GX.TexGenType, texGenSrc: GX.TexGenSrc, texMtx: GX.TexGenMatrix = GX.TexGenMatrix.IDENTITY, normalize: boolean = false, postTexMtx: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY): TexCoord {
        const texCoord = this.texCoordNum as TexCoord;
        if (texCoord >= 8)
            throw Error(`Too many texture coordinates`);
        this.texCoordNum++;
        this.mb.setTexCoordGen(getGXTexCoordID(texCoord), texGenType, texGenSrc, texMtx, normalize, postTexMtx);
        return texCoord;
    }

    public getTexCoordCount(): number {
        return this.texCoordNum;
    }

    public genPostTexMtx(func: MtxFunc<RenderContext>): PostTexMtx {
        const id = this.postTexMtxs.length;
        if (id >= 20)
            throw Error(`Too many post-transform texture matrices`);
        this.postTexMtxs.push(func);
        return id as PostTexMtx;
    }

    public genIndTexMtx(func: MtxFunc<RenderContext>): IndTexMtx {
        const id = this.indTexMtxs.length;
        if (id >= 3)
            throw Error(`Too many indirect texture matrices`);
        this.indTexMtxs.push(func);
        return id as IndTexMtx;
    }

    public genKonstColor(func: ColorFunc<RenderContext>): KonstColor {
        const id = this.konstColors.length;
        if (id >= 4)
            throw Error(`Too many konst colors`);
        this.konstColors.push(func);
        return id as KonstColor;
    }

    public getKonstColorCount(): number {
        return this.konstColors.length;
    }

    public setTevDirect(stage: TevStage) {
        this.mb.setTevDirect(stage);
    }

    public setTevOrder(stage: TevStage, texCoord: TexCoord | null = null, texMap: TexMap | null = null, channelId: GX.RasColorChannelID = GX.RasColorChannelID.COLOR_ZERO) {
        this.mb.setTevOrder(stage, getGXTexCoordID(texCoord), getGXTexMapID(texMap), channelId);
    }

    public setTevColorFormula(stage: TevStage, a: GX.CC, b: GX.CC, c: GX.CC, d: GX.CC, op: GX.TevOp = GX.TevOp.ADD, bias: GX.TevBias = GX.TevBias.ZERO, scale: GX.TevScale = GX.TevScale.SCALE_1, clamp: boolean = true, reg: GX.Register = GX.Register.PREV) {
        this.mb.setTevColorIn(stage, a, b, c, d);
        this.mb.setTevColorOp(stage, op, bias, scale, clamp, reg);
    }
    
    public setTevAlphaFormula(stage: TevStage, a: GX.CA, b: GX.CA, c: GX.CA, d: GX.CA, op: GX.TevOp = GX.TevOp.ADD, bias: GX.TevBias = GX.TevBias.ZERO, scale: GX.TevScale = GX.TevScale.SCALE_1, clamp: boolean = true, reg: GX.Register = GX.Register.PREV) {
        this.mb.setTevAlphaIn(stage, a, b, c, d);
        this.mb.setTevAlphaOp(stage, op, bias, scale, clamp, reg);
    }

    public setTevSwapMode(stage: TevStage, rasSwapTable: SwapTable | undefined, texSwapTable: SwapTable | undefined) {
        this.mb.setTevSwapMode(stage, rasSwapTable, texSwapTable);
    }

    public setTevIndirect(stage: TevStage, indTexStage: IndTexStage, format: GX.IndTexFormat, biasSel: GX.IndTexBiasSel, matrixSel: GX.IndTexMtxID, wrapS: GX.IndTexWrap, wrapT: GX.IndTexWrap, addPrev: boolean, utcLod: boolean, alphaSel: GX.IndTexAlphaSel) {
        this.mb.setTevIndirect(stage, getGXIndTexStageID(indTexStage), format, biasSel, matrixSel, wrapS, wrapT, addPrev, utcLod, alphaSel);
    }

    public setIndTexOrder(stage: IndTexStage, texCoord: TexCoord | null = null, texMap: TexMap | null = null) {
        this.mb.setIndTexOrder(getGXIndTexStageID(stage), getGXTexCoordID(texCoord), getGXTexMapID(texMap));
    }

    public setIndTexScale(stage: IndTexStage, scaleS: GX.IndTexScale, scaleT: GX.IndTexScale) {
        this.mb.setIndTexScale(getGXIndTexStageID(stage), scaleS, scaleT);
    }

    public setTevKColorSel(stage: TevStage, sel: GX.KonstColorSel) {
        this.mb.setTevKColorSel(stage, sel);
    }

    public setTevKAlphaSel(stage: TevStage, sel: GX.KonstAlphaSel) {
        this.mb.setTevKAlphaSel(stage, sel);
    }

    public setUsePnMtxIdx(v: boolean) {
        this.mb.setUsePnMtxIdx(v);
    }

    public setChanCtrl(idx: GX.ColorChannelID, enable: boolean, ambSrc: GX.ColorSrc, matSrc: GX.ColorSrc, lightMask: number, diffFn: GX.DiffuseFunction, attnFn: GX.AttenuationFunction) {
        this.mb.setChanCtrl(idx, enable, ambSrc, matSrc, lightMask, diffFn, attnFn);
    }

    public setCullMode(cullMode: GX.CullMode) {
        this.mb.setCullMode(cullMode);
    }

    public setBlendMode(blendMode: GX.BlendMode, srcFactor: GX.BlendFactor, dstFactor: GX.BlendFactor, logicOp: GX.LogicOp = GX.LogicOp.CLEAR) {
        this.mb.setBlendMode(blendMode, srcFactor, dstFactor, logicOp);
    }

    public setZMode(depthTest: boolean, depthFunc: GX.CompareType, depthWrite: boolean) {
        this.mb.setZMode(depthTest, depthFunc, depthWrite);
    }

    public setAlphaCompare(compareA: GX.CompareType, referenceA: number, op: GX.AlphaOp, compareB: GX.CompareType, referenceB: number) {
        this.mb.setAlphaCompare(compareA, referenceA, op, compareB, referenceB);
    }

    public setTexMtx(idx: number, func: MtxFunc<RenderContext>) {
        this.texMtxs[idx] = func;
    }

    public setAmbColor(idx: number, func: ColorFunc<RenderContext>) {
        this.ambColors[idx] = func;
    }

    public setMatColor(idx: number, func: ColorFunc<RenderContext>) {
        this.matColors[idx] = func;
    }

    public setTevRegColor(idx: number, func: ColorFunc<RenderContext>) {
        this.tevRegColors[idx] = func;
    }

    private rebuildGXMaterial() {
        this.gxMaterial = this.mb.finish(this.name);
        if (this.texCoordUsesMtxIndex !== undefined)
            this.gxMaterial.useTexMtxIdx = nArray(8, (i) => this.texCoordUsesMtxIndex![i]);
        this.gxMaterialHelper = new GXMaterialHelperGfx(this.gxMaterial);
    }

    // Enable if TexCoord uses a TEX*MTXIDX vertex attribute.
    public setTexCoordUsesMtxIdx(texCoord: TexCoord, enable: boolean) {
        if (this.texCoordUsesMtxIndex === undefined)
            this.texCoordUsesMtxIndex = nArray(8, () => false);
        this.texCoordUsesMtxIndex[texCoord] = enable;
    }

    public setOnMaterialParams(params: MaterialParams, ctx: RenderContext) {
        if (this.gxMaterial === undefined)
            this.rebuildGXMaterial();

        for (let i = 0; i < 8; i++) {
            const func = this.texMaps[i];
            if (func !== undefined)
                func(params.m_TextureMapping[i], ctx);
            else
                params.m_TextureMapping[i].reset();
        }
        
        for (let i = 0; i < this.texMtxs.length; i++) {
            const func = this.texMtxs[i];
            if (func !== undefined)
                func(params.u_TexMtx[i], ctx);
            else
                mat4.identity(params.u_TexMtx[i]);
        }

        for (let i = 0; i < this.indTexMtxs.length; i++) {
            const func = this.indTexMtxs[i];
            if (func !== undefined)
                func(params.u_IndTexMtx[i], ctx);
            else
                mat4.identity(params.u_IndTexMtx[i]);
        }

        for (let i = 0; i < this.postTexMtxs.length; i++) {
            const func = this.postTexMtxs[i];
            if (func !== undefined)
                func(params.u_PostTexMtx[i], ctx);
            else
                mat4.identity(params.u_PostTexMtx[i]);
        }

        for (let i = 0; i < 2; i++) {
            const func = this.ambColors[i];
            if (func !== undefined)
                func(params.u_Color[ColorKind.AMB0 + i], ctx);
            else
                colorCopy(params.u_Color[ColorKind.AMB0 + i], White);
        }

        for (let i = 0; i < 2; i++) {
            const func = this.matColors[i];
            if (func !== undefined)
                func(params.u_Color[ColorKind.MAT0 + i], ctx);
            else
                colorCopy(params.u_Color[ColorKind.MAT0 + i], White);
        }

        for (let i = 0; i < 4; i++) {
            const func = this.konstColors[i];
            if (func !== undefined)
                func(params.u_Color[ColorKind.K0 + i], ctx);
            else
                colorCopy(params.u_Color[ColorKind.K0 + i], White);
        }

        for (let i = 0; i < 3; i++) {
            const func = this.tevRegColors[i];
            if (func !== undefined)
                func(params.u_Color[ColorKind.C0 + i], ctx);
            else
                colorCopy(params.u_Color[ColorKind.C0 + i], TransparentBlack);
        }
    }

    public getGXMaterialHelper(): GXMaterialHelperGfx {
        if (this.gxMaterialHelper === undefined)
            this.rebuildGXMaterial();
        return this.gxMaterialHelper!;
    }
}