
import * as GX from "../gx/gx_enum";
import { assert, nArray, assertExists } from "../util";
import { SwapTable } from "../gx/gx_material";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { texEnvMtx } from "../MathHelpers";

export const enum HSD_TExpType {
    TE_ZERO = 0,
    TE_TEV = 1,
    TE_TEX = 2,
    TE_RAS = 3,
    TE_CNST = 4,
    TE_IMM = 5,
    TE_KONST = 6,
    TE_ALL = 7,
}

export const enum HSD_TEInput {
    TE_END = 0,
    TE_RGB = 1,
    TE_R = 2,
    TE_G = 3,
    TE_B = 4,
    TE_A = 5,
    TE_X = 6,
    TE_0 = 7,
    TE_1 = 8,
    TE_1_8 = 9,
    TE_2_8 = 10,
    TE_3_8 = 11,
    TE_4_8 = 12,
    TE_5_8 = 13,
    TE_6_8 = 14,
    TE_7_8 = 15,
    TE_UNDEF = 0xFF,
}

// A pointer in the original code, we just enumerate all possibilities instead here...
export const enum HSD_TExpCnstVal {
    ONE,
    MOBJ_DIFFUSE,
    MOBJ_ALPHA,

    TOBJ_CONSTANT_START,
    TOBJ_CONSTANT_RGB = TOBJ_CONSTANT_START,
    TOBJ_CONSTANT_R,
    TOBJ_CONSTANT_G,
    TOBJ_CONSTANT_B,
    TOBJ_CONSTANT_A,
    TOBJ_TEV0_RGB,
    TOBJ_TEV0_A,
    TOBJ_TEV1_RGB,
    TOBJ_TEV1_A,
    TOBJ_BLENDING,

    TOBJ_IDX_SHIFT = 16,
}

class _HSD_TEArg {
    public type: HSD_TExpType = HSD_TExpType.TE_ZERO;
    public arg: number | null = null;
    public sel: HSD_TEInput = HSD_TEInput.TE_END;
    public exp: HSD_TExp | null = null;
}

class _HSD_TExpTev {
    public type = HSD_TExpType.TE_TEV as const;

    public colorOp: GX.TevOp | null = null;
    public colorBias: GX.TevBias = GX.TevBias.ZERO;
    public colorScale: GX.TevScale = GX.TevScale.SCALE_1;
    public colorClamp: boolean = false;

    public alphaOp: GX.TevOp | null = null;
    public alphaBias: GX.TevBias = GX.TevBias.ZERO;
    public alphaScale: GX.TevScale = GX.TevScale.SCALE_1;
    public alphaClamp: boolean = false;

    public colorIn: _HSD_TEArg[] = nArray(4, () => new _HSD_TEArg());
    public alphaIn: _HSD_TEArg[] = nArray(4, () => new _HSD_TEArg());
    public kcsel: GX.KonstColorSel | null = null;
    public kasel: GX.KonstAlphaSel | null = null;

    public rasSwapTable: SwapTable | undefined = undefined;
    public texSwapTable: SwapTable | undefined = undefined;

    public tex: HSD_TExpTObj | null = null;
    public chan: GX.ColorChannelID = GX.ColorChannelID.COLOR_NULL;
}

class _HSD_TExpCnst {
    public type = HSD_TExpType.TE_CNST as const;
    public reg: number | null = null;

    constructor(public val: HSD_TExpCnstVal, public comp: HSD_TEInput) {
    }
}

type _HSD_TExpTex = -1;
type _HSD_TExpRas = -2;

export const HSD_TEXP_RAS: _HSD_TExpRas = -2;
export const HSD_TEXP_TEX: _HSD_TExpTex = -1;

export type HSD_TExp = _HSD_TExpTev | _HSD_TExpCnst | _HSD_TExpTex | _HSD_TExpRas;

export class HSD_TExpList {
    public tevs: _HSD_TExpTev[] = [];
    public cnsts: _HSD_TExpCnst[] = [];
}

export function HSD_TExpGetType(texp: HSD_TExp | null): HSD_TExpType {
    if (texp === null)
        return HSD_TExpType.TE_ZERO;
    else if (texp === HSD_TEXP_TEX)
        return HSD_TExpType.TE_TEX;
    else if (texp === HSD_TEXP_RAS)
        return HSD_TExpType.TE_RAS;
    return texp.type;
}

interface HSD_TExpTObj {
    texMapID: GX.TexMapID;
    texCoordID: GX.TexCoordID;
}

export function HSD_TExpOrder(tev: _HSD_TExpTev, tex: HSD_TExpTObj | null, chan: GX.ColorChannelID): void {
    tev.tex = tex;
    tev.chan = chan;
}

export function HSD_TExpColorOp(tev: _HSD_TExpTev, op: GX.TevOp, bias: GX.TevBias, scale: GX.TevScale, clamp: boolean): void {
    tev.colorOp = op;
    tev.colorClamp = clamp;

    if (op <= GX.TevOp.SUB) {
        tev.colorBias = bias;
        tev.colorScale = scale;
    } else {
        tev.colorBias = GX.TevBias.ZERO;
        tev.colorScale = GX.TevScale.SCALE_1;
    }
}

function HSD_TExpColorInSub(tev: _HSD_TExpTev, idx: number, sel: HSD_TEInput, exp: HSD_TExp | null): void {
    const input = tev.colorIn[idx];

    input.type = HSD_TExpGetType(exp);
    input.sel = sel;
    input.exp = exp;
    input.arg = null;

    if (sel === HSD_TEInput.TE_0) {
        input.type = HSD_TExpType.TE_ZERO;
    } else if (sel === HSD_TEInput.TE_1) {
        input.type = HSD_TExpType.TE_IMM;
        input.arg = GX.CombineColorInput.ONE;
        input.exp = null;
    } else if (sel === HSD_TEInput.TE_4_8) {
        input.type = HSD_TExpType.TE_IMM;
        input.arg = GX.CombineColorInput.HALF;
        input.exp = null;
    } else if (sel >= HSD_TEInput.TE_1_8 && sel <= HSD_TEInput.TE_7_8) {
        input.type = HSD_TExpType.TE_KONST;
        input.arg = GX.CombineColorInput.KONST;

        if (sel === HSD_TEInput.TE_1_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_1_8;
        else if (sel === HSD_TEInput.TE_2_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_1_4;
        else if (sel === HSD_TEInput.TE_3_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_3_8;
        else if (sel === HSD_TEInput.TE_5_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_5_8;
        else if (sel === HSD_TEInput.TE_6_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_3_4;
        else if (sel === HSD_TEInput.TE_7_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_7_8;
    }

    if (input.type === HSD_TExpType.TE_ZERO) {
        input.sel = HSD_TEInput.TE_0;
        input.arg = GX.CombineColorInput.ZERO;
    } else if (input.type === HSD_TExpType.TE_TEV) {
        assert(sel === HSD_TEInput.TE_RGB || sel === HSD_TEInput.TE_A);
        assert(HSD_TExpGetType(exp) === HSD_TExpType.TE_TEV);
        const expTev = exp as _HSD_TExpTev;
        assert(idx === 3 || sel !== HSD_TEInput.TE_RGB || expTev.colorClamp);
        assert(idx === 3 || sel !== HSD_TEInput.TE_A || expTev.alphaClamp);
    } else if (input.type === HSD_TExpType.TE_TEX) {
        if (sel === HSD_TEInput.TE_RGB) {
            input.arg = GX.CombineColorInput.TEXC;
        } else if (sel === HSD_TEInput.TE_R) {
            input.arg = GX.CombineColorInput.TEXC;
            tev.texSwapTable = [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R];
        } else if (sel === HSD_TEInput.TE_G) {
            input.arg = GX.CombineColorInput.TEXC;
            tev.texSwapTable = [GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G];
        } else if (sel === HSD_TEInput.TE_B) {
            input.arg = GX.CombineColorInput.TEXC;
            tev.texSwapTable = [GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B];
        } else if (sel === HSD_TEInput.TE_A) {
            input.arg = GX.CombineColorInput.TEXA;
        }
    } else if (input.type === HSD_TExpType.TE_RAS) {
        if (sel === HSD_TEInput.TE_RGB) {
            input.arg = GX.CombineColorInput.RASC;
        } else if (sel === HSD_TEInput.TE_R) {
            input.arg = GX.CombineColorInput.RASC;
            tev.rasSwapTable = [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R];
        } else if (sel === HSD_TEInput.TE_G) {
            input.arg = GX.CombineColorInput.RASC;
            tev.rasSwapTable = [GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G];
        } else if (sel === HSD_TEInput.TE_B) {
            input.arg = GX.CombineColorInput.RASC;
            tev.rasSwapTable = [GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B];
        } else if (sel === HSD_TEInput.TE_A) {
            input.arg = GX.CombineColorInput.RASA;
        }
    } else if (input.type === HSD_TExpType.TE_CNST) {
        assert(HSD_TExpGetType(exp) === HSD_TExpType.TE_CNST);
        const expCnst = exp as _HSD_TExpCnst;
        input.sel = expCnst.comp;
    }
}

export function HSD_TExpColorIn(tev: _HSD_TExpTev, selA: HSD_TEInput, expA: HSD_TExp | null, selB: HSD_TEInput, expB: HSD_TExp | null, selC: HSD_TEInput, expC: HSD_TExp | null, selD: HSD_TEInput, expD: HSD_TExp | null): void {
    HSD_TExpColorInSub(tev, 0, selA, expA);
    HSD_TExpColorInSub(tev, 1, selB, expB);
    HSD_TExpColorInSub(tev, 2, selC, expC);
    HSD_TExpColorInSub(tev, 3, selD, expD);
}

export function HSD_TExpAlphaOp(tev: _HSD_TExpTev, op: GX.TevOp, bias: GX.TevBias, scale: GX.TevScale, clamp: boolean): void {
    tev.alphaOp = op;
    tev.alphaClamp = clamp;

    if (op <= GX.TevOp.SUB) {
        tev.alphaBias = bias;
        tev.alphaScale = scale;
    } else {
        tev.alphaBias = GX.TevBias.ZERO;
        tev.alphaScale = GX.TevScale.SCALE_1;
    }
}

function HSD_TExpAlphaInSub(tev: _HSD_TExpTev, idx: number, sel: HSD_TEInput, exp: HSD_TExp | null): void {
    const input = tev.alphaIn[idx];

    input.type = HSD_TExpGetType(exp);
    input.sel = sel;
    input.exp = exp;
    input.arg = null;

    if (sel === HSD_TEInput.TE_0) {
        input.type = HSD_TExpType.TE_ZERO;
    } else if (sel >= HSD_TEInput.TE_1 && sel <= HSD_TEInput.TE_7_8) {
        input.type = HSD_TExpType.TE_KONST;
        input.arg = GX.CombineAlphaInput.KONST;

        if (sel === HSD_TEInput.TE_1_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_1_8;
        else if (sel === HSD_TEInput.TE_2_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_1_4;
        else if (sel === HSD_TEInput.TE_3_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_3_8;
        else if (sel === HSD_TEInput.TE_5_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_5_8;
        else if (sel === HSD_TEInput.TE_6_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_3_4;
        else if (sel === HSD_TEInput.TE_7_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_7_8;
    }

    if (input.type === HSD_TExpType.TE_ZERO) {
        input.sel = HSD_TEInput.TE_0;
        input.arg = GX.CombineColorInput.ZERO;
    } else if (input.type === HSD_TExpType.TE_TEV) {
        assert(sel === HSD_TEInput.TE_A);
        assert(HSD_TExpGetType(exp) === HSD_TExpType.TE_TEV);
        const expTev = exp as _HSD_TExpTev;
        assert(idx === 3 || expTev.alphaClamp);
    } else if (input.type === HSD_TExpType.TE_TEX) {
        input.arg = GX.CombineAlphaInput.TEXA;
    } else if (input.type === HSD_TExpType.TE_RAS) {
        input.arg = GX.CombineAlphaInput.RASA;
    } else if (input.type === HSD_TExpType.TE_CNST) {
        assert(sel === HSD_TEInput.TE_A || sel === HSD_TEInput.TE_X);
        assert(HSD_TExpGetType(exp) === HSD_TExpType.TE_CNST);
        const expCnst = exp as _HSD_TExpCnst;
        assert(expCnst.comp === HSD_TEInput.TE_X);
        input.sel = HSD_TEInput.TE_X;
    }
}

export function HSD_TExpAlphaIn(tev: _HSD_TExpTev, selA: HSD_TEInput, expA: HSD_TExp | null, selB: HSD_TEInput, expB: HSD_TExp | null, selC: HSD_TEInput, expC: HSD_TExp | null, selD: HSD_TEInput, expD: HSD_TExp | null): void {
    HSD_TExpAlphaInSub(tev, 0, selA, expA);
    HSD_TExpAlphaInSub(tev, 1, selB, expB);
    HSD_TExpAlphaInSub(tev, 2, selC, expC);
    HSD_TExpAlphaInSub(tev, 3, selD, expD);
}

export function HSD_TExpTev(list: HSD_TExpList): _HSD_TExpTev {
    const exp = new _HSD_TExpTev();
    list.tevs.unshift(exp);
    return exp;
}

function HSD_TExpCnstInternal(list: HSD_TExpList, val: HSD_TExpCnstVal, comp: HSD_TEInput): _HSD_TExpCnst {
    let cnst = list.cnsts.find((n) => n.val === val && n.comp === comp);
    if (cnst === undefined) {
        cnst = new _HSD_TExpCnst(val, comp);
        list.cnsts.push(cnst);
    }
    return cnst;
}

export function HSD_TExpCnst(list: HSD_TExpList, val: HSD_TExpCnstVal, comp: HSD_TEInput): _HSD_TExpCnst {
    // Try to find an existing one.
    assert(val < HSD_TExpCnstVal.TOBJ_CONSTANT_START);
    return HSD_TExpCnstInternal(list, val, comp);
}

export function HSD_TExpCnstTObj(list: HSD_TExpList, tobjIdx: number, val: HSD_TExpCnstVal, comp: HSD_TEInput): _HSD_TExpCnst {
    // Try to find an existing one.
    assert(val >= HSD_TExpCnstVal.TOBJ_CONSTANT_START);
    val = (tobjIdx << HSD_TExpCnstVal.TOBJ_IDX_SHIFT) | val;
    return HSD_TExpCnstInternal(list, val, comp);
}

function TEArg_Zero(dst: _HSD_TEArg): void {
    dst.type = HSD_TExpType.TE_ZERO;
    dst.sel = HSD_TEInput.TE_0;
    dst.arg = null;
    dst.exp = null;
}

function TEArg_Copy(dst: _HSD_TEArg, src: _HSD_TEArg): void {
    dst.type = src.type;
    dst.sel = src.sel;
    dst.arg = src.arg;
    dst.exp = src.exp;
}

function TEArg_Swap(a: _HSD_TEArg, b: _HSD_TEArg): void {
    const type = a.type;
    const sel = a.sel;
    const arg = a.arg;
    const exp = a.exp;
    TEArg_Copy(a, b);
    b.type = type;
    b.sel = sel;
    b.arg = arg;
    b.exp = exp;
}

function SimplifySrc(tev: _HSD_TExpTev): void {
    // TODO(jstpierre)
}

function SimplifyThis(tev: _HSD_TExpTev): void {
    while (true) {
        // First, clean up to better our chances of a rule match...
        let hasRas = false, hasTex = false;

        for (let i = 0; i < 4; i++) {
            const cin = tev.colorIn[i].type, ain = tev.alphaIn[i].type;
            if (cin === HSD_TExpType.TE_RAS || ain === HSD_TExpType.TE_RAS)
                hasRas = true;
            else if (cin === HSD_TExpType.TE_TEX || ain === HSD_TExpType.TE_TEX)
                hasTex = true;
        }

        if (!hasTex) {
            tev.tex = null;
            tev.texSwapTable = undefined;
        }

        if (!hasRas) {
            tev.chan = GX.ColorChannelID.COLOR_NULL;
            tev.rasSwapTable = undefined;
        }

        // Rules.
        let matched = false;
        if (tev.alphaOp === null || tev.alphaOp === GX.TevOp.COMP_A8_GT || tev.alphaOp === GX.TevOp.COMP_A8_EQ) {
            if (tev.colorOp === GX.TevOp.ADD || tev.colorOp === GX.TevOp.SUB) {
                if (tev.colorIn[2].sel === HSD_TEInput.TE_0) {
                    // C = 0, means we always choose A.

                    // No need for B.
                    if (tev.colorIn[1].sel !== HSD_TEInput.TE_0) {
                        TEArg_Zero(tev.colorIn[1]);
                        matched = true;
                    }

                    // If we're not even adding anything, then move A to D.
                    if (tev.colorOp === GX.TevOp.ADD && tev.colorIn[3].sel === HSD_TEInput.TE_0) {
                        TEArg_Copy(tev.colorIn[3], tev.colorIn[0]);
                        TEArg_Zero(tev.colorIn[0]);
                        tev.colorClamp = true;
                        matched = true;
                    }
                }

                if (tev.colorIn[2].sel === HSD_TEInput.TE_1) {
                    // C = 1, means we always choose B.

                    // No need for B.
                    if (tev.colorIn[0].sel !== HSD_TEInput.TE_0) {
                        TEArg_Zero(tev.colorIn[0]);
                        matched = true;
                    }

                    // If we're not even adding anything, then move B to D.
                    if (tev.colorOp === GX.TevOp.ADD && tev.colorIn[3].sel === HSD_TEInput.TE_0) {
                        TEArg_Copy(tev.colorIn[3], tev.colorIn[1]);
                        TEArg_Zero(tev.colorIn[1]);
                        matched = true;
                    }
                }

                if (tev.colorIn[0].sel === HSD_TEInput.TE_0 && tev.colorIn[1].sel === HSD_TEInput.TE_1) {
                    // A = 0, B = 1, means we can move C to A.
                    TEArg_Copy(tev.colorIn[0], tev.colorIn[2]);
                    TEArg_Zero(tev.colorIn[1]);
                    TEArg_Zero(tev.colorIn[2]);
                    matched = true;
                }

                if (tev.colorIn[0].sel === HSD_TEInput.TE_0 && tev.colorIn[1].sel === HSD_TEInput.TE_0 && tev.colorIn[3].sel === HSD_TEInput.TE_1 && tev.colorBias === GX.TevBias.ZERO) {
                    // A = 0, B = 0, D = 0, means the output is always 0. We can remove this operation.
                    tev.colorOp = null;
                }
            } else if (tev.colorOp === GX.TevOp.COMP_R8_GT || tev.colorOp === GX.TevOp.COMP_GR16_GT || tev.colorOp === GX.TevOp.COMP_BGR24_GT || tev.colorOp === GX.TevOp.COMP_RGB8_GT) {
                // TODO(jstpierre): Comp modes
            } else if (tev.colorOp === GX.TevOp.COMP_R8_EQ || tev.colorOp === GX.TevOp.COMP_GR16_EQ || tev.colorOp === GX.TevOp.COMP_BGR24_EQ || tev.colorOp === GX.TevOp.COMP_RGB8_EQ) {
                // TODO(jstpierre): Comp modes
            }
        } else {
            if (tev.alphaOp === GX.TevOp.ADD || tev.alphaOp === GX.TevOp.SUB) {
                if (tev.alphaIn[2].sel === HSD_TEInput.TE_0) {
                    // C = 0, means we always choose A.

                    // No need for B.
                    if (tev.alphaIn[1].sel !== HSD_TEInput.TE_0) {
                        TEArg_Zero(tev.alphaIn[1]);
                        matched = true;
                    }

                    // If we're not even adding anything, then move A to D.
                    if (tev.alphaOp === GX.TevOp.ADD && tev.alphaIn[3].sel === HSD_TEInput.TE_0) {
                        TEArg_Copy(tev.alphaIn[3], tev.alphaIn[0]);
                        TEArg_Zero(tev.alphaIn[0]);
                        matched = true;
                    }
                }

                if (tev.alphaIn[2].sel === HSD_TEInput.TE_1) {
                    // C = 1, means we always choose B.

                    // No need for B.
                    if (tev.alphaIn[0].sel !== HSD_TEInput.TE_0) {
                        TEArg_Zero(tev.alphaIn[0]);
                        matched = true;
                    }

                    // If we're not even adding anything, then move B to D.
                    if (tev.alphaOp === GX.TevOp.ADD && tev.alphaIn[3].sel === HSD_TEInput.TE_0) {
                        TEArg_Copy(tev.alphaIn[3], tev.alphaIn[1]);
                        TEArg_Zero(tev.alphaIn[1]);
                        matched = true;
                    }
                }

                if (tev.alphaIn[0].sel === HSD_TEInput.TE_0 && tev.alphaIn[1].sel === HSD_TEInput.TE_1) {
                    // A = 0, B = 1, means we can move C to A.
                    TEArg_Copy(tev.alphaIn[0], tev.alphaIn[2]);
                    TEArg_Zero(tev.alphaIn[1]);
                    TEArg_Zero(tev.alphaIn[2]);
                    matched = true;
                }

                if (tev.alphaIn[0].sel === HSD_TEInput.TE_0 && tev.alphaIn[1].sel === HSD_TEInput.TE_0 && tev.alphaIn[3].sel === HSD_TEInput.TE_1) {
                    // A = 0, B = 0, D = 0, means the output is always 0. We can remove this operation.
                    tev.alphaOp = null;
                }
            } else {
                // TODO(jstpierre): Comp modes
            }
        }

        if (!matched)
            break;
    }
}

function ResConflict(a: _HSD_TExpTev, b: _HSD_TExpTev): boolean {
    if (a.tex !== null && b.tex !== null || a.tex !== b.tex) {
        // Textures conflict.
        return true;
    }

    if (a.chan !== null && b.chan !== null || a.chan !== b.chan) {
        // Channels conflict.
        return true;
    }

    // No conflict!
    return false;
}

function CalcBias(op: GX.TevOp, b0: GX.TevBias, b1: GX.TevBias): GX.TevBias | null {
    let bias: number = 0;

    if (b1 === GX.TevBias.SUBHALF)
        bias--;
    else if (b1 === GX.TevBias.ADDHALF)
        bias++;

    if (op === GX.TevOp.SUB)
        bias = -bias;

    if (b0 === GX.TevBias.SUBHALF)
        bias--;
    else if (b0 === GX.TevBias.ADDHALF)
        bias++;

    if (bias === 0)
        return GX.TevBias.ZERO;
    else if (bias === 1)
        return GX.TevBias.ADDHALF;
    else if (bias === -1)
        return GX.TevBias.SUBHALF;
    else
        return null;
}

function MergeResources(dst: _HSD_TExpTev, src: _HSD_TExpTev): void {
    assert(!ResConflict(dst, src));

    if (dst.tex === null)
        dst.tex = src.tex;
    if (dst.chan === null)
        dst.chan = src.chan;
    if (dst.texSwapTable === undefined)
        dst.texSwapTable = src.texSwapTable;
    if (dst.rasSwapTable === undefined)
        dst.rasSwapTable = src.rasSwapTable;
}

function SimplifyByMerge(tev: _HSD_TExpTev): void {
    while (true) {
        let matched = false;

        if (!(tev.alphaOp === null || tev.alphaOp === GX.TevOp.COMP_A8_GT || tev.alphaOp === GX.TevOp.COMP_A8_EQ || tev.alphaOp === GX.TevOp.ADD || tev.alphaOp === GX.TevOp.SUB))
            break;

        if ((tev.colorOp === GX.TevOp.ADD || tev.colorOp === GX.TevOp.SUB) &&
            (tev.colorIn[1].sel === HSD_TEInput.TE_0 && tev.colorIn[2].sel === HSD_TEInput.TE_0 && HSD_TExpGetType(tev.colorIn[0].exp) !== HSD_TExpType.TE_CNST && HSD_TExpGetType(tev.colorIn[3].exp) !== HSD_TExpType.TE_CNST)) {
            // B = 0, C = 0, we always select LHS here...

            if (tev.colorOp === GX.TevOp.ADD && (tev.colorIn[0].type === HSD_TExpType.TE_TEX || tev.colorIn[0].type === HSD_TExpType.TE_RAS) && tev.colorIn[3].type === HSD_TExpType.TE_TEV) {
                // A = Tex/Ras, D = TEV... Swap so that A always contains the subchild. Makes future cleanups easier.
                const tev3 = tev.colorIn[3].exp as _HSD_TExpTev;
                if (((tev.colorIn[3].sel === HSD_TEInput.TE_RGB && tev3.colorClamp) || (tev.colorIn[3].sel === HSD_TEInput.TE_A && tev3.alphaClamp))) {
                    TEArg_Swap(tev.colorIn[0], tev.colorIn[3]);
                }
            }

            if (tev.colorIn[0].type === HSD_TExpType.TE_TEV && tev.colorIn[0].sel === HSD_TEInput.TE_RGB) {
                // If A = TEV, and that TEV expression has no D, then merge it into us if we can.
                const sub = tev.colorIn[0].exp as _HSD_TExpTev;
                if ((sub.colorOp === GX.TevOp.ADD || sub.colorOp === GX.TevOp.SUB) && sub.colorIn[3].sel === HSD_TEInput.TE_0 && sub.colorScale === GX.TevScale.SCALE_1 && !ResConflict(tev, sub)) {
                    const bias = CalcBias(sub.colorOp, tev.colorBias, sub.colorBias);
                    if (bias !== null) {
                        tev.colorBias = bias;
                        if (sub.colorOp === GX.TevOp.SUB)
                            tev.colorOp = (tev.colorOp === GX.TevOp.ADD) ? GX.TevOp.SUB : GX.TevOp.ADD;
                        for (let i = 0; i < 3; i++)
                            TEArg_Copy(tev.colorIn[i], sub.colorIn[i]);
                        MergeResources(tev, sub);
                        matched = true;
                    }
                }
            } else if (tev.colorIn[0].type !== HSD_TExpType.TE_TEV && tev.alphaOp === GX.TevOp.ADD && tev.colorIn[3].type === HSD_TExpType.TE_TEV && tev.colorIn[3].sel === HSD_TEInput.TE_RGB) {
                const sub = tev.colorIn[3].exp as _HSD_TExpTev;
                if (sub.colorScale === GX.TevScale.SCALE_1 && (tev.colorBias === GX.TevBias.ZERO || tev.colorBias !== sub.colorBias) && !ResConflict(tev, sub)) {
                    for (let i = 0; i < 4; i++)
                        TEArg_Copy(tev.colorIn[i], sub.colorIn[i]);
                    tev.colorOp = sub.colorOp;
                    tev.colorBias = assertExists(CalcBias(tev.colorOp!, tev.colorBias, sub.colorBias));
                    tev.colorClamp = tev.colorClamp || sub.colorClamp;
                    MergeResources(tev, sub);
                    matched = true;
                }
            }
        }

        if ((tev.alphaOp === GX.TevOp.ADD || tev.alphaOp === GX.TevOp.SUB) &&
            (tev.alphaIn[1].sel === HSD_TEInput.TE_0 && tev.alphaIn[2].sel === HSD_TEInput.TE_0 && HSD_TExpGetType(tev.alphaIn[0].exp) !== HSD_TExpType.TE_CNST && HSD_TExpGetType(tev.alphaIn[3].exp) !== HSD_TExpType.TE_CNST)) {
            // TODO(jstpierre): Second verse, same as the first...
        }

        if (!matched)
            break;
    }
}

function IsThroughColor(tev: _HSD_TExpTev): boolean {
    return tev.colorOp === GX.TevOp.ADD && tev.colorIn[0].sel === HSD_TEInput.TE_0 && tev.colorIn[1].sel === HSD_TEInput.TE_0 && tev.colorBias === GX.TevBias.ZERO && tev.colorScale === GX.TevScale.SCALE_1;
}

function IsThroughAlpha(tev: _HSD_TExpTev): boolean {
    return tev.alphaOp === GX.TevOp.ADD && tev.alphaIn[0].sel === HSD_TEInput.TE_0 && tev.alphaIn[1].sel === HSD_TEInput.TE_0 && tev.alphaBias === GX.TevBias.ZERO && tev.alphaScale === GX.TevScale.SCALE_1;
}

function HSD_TExpSimplify(root: HSD_TExp): void {
    if (HSD_TExpGetType(root) === HSD_TExpType.TE_TEV) {
        const tev = root as _HSD_TExpTev;
        SimplifySrc(tev);
        SimplifyThis(tev);
        SimplifyByMerge(tev);
    }
}

function HSD_TExpMakeDag(tev: HSD_TExp): void {
}

function HSD_TExpSimplify2(tev: _HSD_TExpTev): void {
    for (let i = 0; i < 4; i++) {
        if (tev.colorIn[i].type === HSD_TExpType.TE_TEV && tev.colorIn[i].sel === HSD_TEInput.TE_RGB) {
            const sub = tev.colorIn[i].exp as _HSD_TExpTev;
            if (IsThroughColor(sub)) {
                if (sub.colorIn[3].type === HSD_TExpType.TE_KONST) {
                    if (tev.kcsel === null)
                        tev.kcsel = sub.kcsel;
                    else if (tev.kcsel !== sub.kcsel)
                        continue;
                } else if (sub.colorIn[3].type !== HSD_TExpType.TE_IMM) {
                    continue;
                }

                TEArg_Copy(tev.colorIn[i], sub.colorIn[3]);
            }
        }
    }

    for (let i = 0; i < 4; i++) {
        if (tev.alphaIn[i].type === HSD_TExpType.TE_TEV && tev.alphaIn[i].sel === HSD_TEInput.TE_RGB) {
            const sub = tev.alphaIn[i].exp as _HSD_TExpTev;
            if (IsThroughAlpha(sub)) {
                if (sub.alphaIn[3].type === HSD_TExpType.TE_KONST) {
                    if (tev.kasel === null)
                        tev.kasel = sub.kasel;
                    else if (tev.kasel !== sub.kasel)
                        continue;
                } else if (sub.alphaIn[3].type !== HSD_TExpType.TE_IMM) {
                    continue;
                }

                TEArg_Copy(tev.alphaIn[i], sub.alphaIn[3]);
            }
        }
    }
}

export function HSD_TExpCompile(list: HSD_TExpList, mb: GXMaterialBuilder): void {
    const root = list.tevs[0];

    HSD_TExpSimplify(root);

    // dag, yo.
    HSD_TExpMakeDag(root);
}
