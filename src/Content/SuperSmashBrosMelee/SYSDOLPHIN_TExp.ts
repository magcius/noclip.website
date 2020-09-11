
import * as GX from "../../gx/gx_enum";
import { assert, nArray, assertExists } from "../../util";
import { SwapTable } from "../../gx/gx_material";
import { GXMaterialBuilder } from "../../gx/GXMaterialBuilder";

export enum HSD_TExpType {
    TE_ZERO = 0,
    TE_TEV = 1,
    TE_TEX = 2,
    TE_RAS = 3,
    TE_CNST = 4,
    TE_IMM = 5,
    TE_KONST = 6,
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

    TOBJ_START,
    TOBJ_CONSTANT_RGB = TOBJ_START,
    TOBJ_CONSTANT_R,
    TOBJ_CONSTANT_G,
    TOBJ_CONSTANT_B,
    TOBJ_CONSTANT_A,
    TOBJ_TEV0_RGB,
    TOBJ_TEV0_A,
    TOBJ_TEV1_RGB,
    TOBJ_TEV1_A,
    TOBJ_BLENDING,

    TOBJ_VAL_MASK  = 0xFFFF,
    TOBJ_IDX_SHIFT = 16,
}

class HSD_TEArg {
    public type: HSD_TExpType | null = null;
    public arg: number | null = null;
    public sel: HSD_TEInput = HSD_TEInput.TE_END;
    public exp: HSD_TExp | null = null;
}

class HSD_TETev {
    public type = HSD_TExpType.TE_TEV as const;

    public colorOp: GX.TevOp | null = null;
    public colorBias: GX.TevBias = GX.TevBias.ZERO;
    public colorScale: GX.TevScale = GX.TevScale.SCALE_1;
    public colorClamp: boolean = false;

    public alphaOp: GX.TevOp | null = null;
    public alphaBias: GX.TevBias = GX.TevBias.ZERO;
    public alphaScale: GX.TevScale = GX.TevScale.SCALE_1;
    public alphaClamp: boolean = false;

    public colorIn: HSD_TEArg[] = nArray(4, () => new HSD_TEArg());
    public alphaIn: HSD_TEArg[] = nArray(4, () => new HSD_TEArg());
    public kcsel: GX.KonstColorSel | null = null;
    public kasel: GX.KonstAlphaSel | null = null;

    public rasSwapTable: SwapTable | undefined = undefined;
    public texSwapTable: SwapTable | undefined = undefined;

    public tex: HSD_TExpTObj | null = null;
    public chan: GX.RasColorChannelID = GX.RasColorChannelID.COLOR_ZERO;

    public refColor: number = 0;
    public refAlpha: number = 0;

    public dstRegColor: number | null = null;
    public dstRegAlpha: number | null = null;
}

export class HSD_TECnst {
    public type = HSD_TExpType.TE_CNST as const;
    public reg: number | null = null;
    public idx: number | null = null;
    public ref: number = 0;

    constructor(public val: HSD_TExpCnstVal, public comp: HSD_TEInput) {
    }
}

type _HSD_TExpTex = -1;
type _HSD_TExpRas = -2;

export const HSD_TEXP_RAS: _HSD_TExpRas = -2;
export const HSD_TEXP_TEX: _HSD_TExpTex = -1;

export type HSD_TExp = HSD_TETev | HSD_TECnst | _HSD_TExpTex | _HSD_TExpRas;

export class HSD_TExpList {
    public debug: boolean = false;
    public root: HSD_TExp;
    public tevs: HSD_TETev[] = [];
    public cnsts: HSD_TECnst[] = [];
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

function HSD_TExpRef(exp: HSD_TExp | null, sel: HSD_TEInput): void {
    const type = HSD_TExpGetType(exp);
    if (type === HSD_TExpType.TE_CNST) {
        const cnst = exp as HSD_TECnst;
        cnst.ref++;
    } else if (type === HSD_TExpType.TE_TEV) {
        const tev = exp as HSD_TETev;
        if (sel === HSD_TEInput.TE_RGB)
            tev.refColor++;
        else
            tev.refAlpha++;
    }
}

function HSD_TExpUnref(exp: HSD_TExp | null, sel: HSD_TEInput): void {
    const type = HSD_TExpGetType(exp);
    if (type === HSD_TExpType.TE_CNST) {
        const cnst = exp as HSD_TECnst;
        cnst.ref--;
    } else if (type === HSD_TExpType.TE_TEV) {
        const tev = exp as HSD_TETev;
        if (sel === HSD_TEInput.TE_RGB) {
            if (tev.refColor > 0)
                tev.refColor--;
        } else {
            if (tev.refAlpha > 0)
                tev.refAlpha--;
        }

        if (tev.refColor === 0 && tev.refAlpha === 0) {
            for (let i = 0; i < 4; i++) {
                HSD_TExpUnref(tev.colorIn[i].exp, tev.colorIn[i].sel);
                HSD_TExpUnref(tev.alphaIn[i].exp, tev.alphaIn[i].sel);
            }
        }
    }
}

export function HSD_TExpOrder(tev: HSD_TETev, tex: HSD_TExpTObj | null, chan: GX.RasColorChannelID): void {
    tev.tex = tex;
    tev.chan = chan;
}

export function HSD_TExpColorOp(tev: HSD_TETev, op: GX.TevOp, bias: GX.TevBias, scale: GX.TevScale, clamp: boolean): void {
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

function HSD_TExpColorInSub(tev: HSD_TETev, idx: number, sel: HSD_TEInput, exp: HSD_TExp | null): void {
    const input = tev.colorIn[idx];
    HSD_TExpUnref(input.exp, input.sel);

    input.type = HSD_TExpGetType(exp);
    input.sel = sel;
    input.exp = exp;
    input.arg = null;
    assert(exp !== tev);

    if (sel === HSD_TEInput.TE_0) {
        input.type = HSD_TExpType.TE_ZERO;
    } else if (sel === HSD_TEInput.TE_1) {
        input.type = HSD_TExpType.TE_IMM;
        input.arg = GX.CC.ONE;
        input.exp = null;
    } else if (sel === HSD_TEInput.TE_4_8) {
        input.type = HSD_TExpType.TE_IMM;
        input.arg = GX.CC.HALF;
        input.exp = null;
    } else if (sel >= HSD_TEInput.TE_1_8 && sel <= HSD_TEInput.TE_7_8) {
        input.type = HSD_TExpType.TE_KONST;
        input.arg = GX.CC.KONST;

        if (sel === HSD_TEInput.TE_1_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_1_8;
        else if (sel === HSD_TEInput.TE_2_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_2_8;
        else if (sel === HSD_TEInput.TE_3_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_3_8;
        else if (sel === HSD_TEInput.TE_5_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_5_8;
        else if (sel === HSD_TEInput.TE_6_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_6_8;
        else if (sel === HSD_TEInput.TE_7_8)
            tev.kcsel = GX.KonstColorSel.KCSEL_7_8;
    }

    if (input.type === HSD_TExpType.TE_ZERO) {
        input.sel = HSD_TEInput.TE_0;
        input.arg = GX.CC.ZERO;
    } else if (input.type === HSD_TExpType.TE_TEV) {
        assert(sel === HSD_TEInput.TE_RGB || sel === HSD_TEInput.TE_A);
        assert(HSD_TExpGetType(exp) === HSD_TExpType.TE_TEV);
        const expTev = exp as HSD_TETev;
        assert(idx === 3 || sel !== HSD_TEInput.TE_RGB || expTev.colorClamp);
        assert(idx === 3 || sel !== HSD_TEInput.TE_A || expTev.alphaClamp);
        HSD_TExpRef(input.exp, input.sel);
    } else if (input.type === HSD_TExpType.TE_TEX) {
        if (sel === HSD_TEInput.TE_RGB) {
            input.arg = GX.CC.TEXC;
        } else if (sel === HSD_TEInput.TE_R) {
            input.arg = GX.CC.TEXC;
            tev.texSwapTable = [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R];
        } else if (sel === HSD_TEInput.TE_G) {
            input.arg = GX.CC.TEXC;
            tev.texSwapTable = [GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G];
        } else if (sel === HSD_TEInput.TE_B) {
            input.arg = GX.CC.TEXC;
            tev.texSwapTable = [GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B];
        } else if (sel === HSD_TEInput.TE_A) {
            input.arg = GX.CC.TEXA;
        }
    } else if (input.type === HSD_TExpType.TE_RAS) {
        if (sel === HSD_TEInput.TE_RGB) {
            input.arg = GX.CC.RASC;
        } else if (sel === HSD_TEInput.TE_R) {
            input.arg = GX.CC.RASC;
            tev.rasSwapTable = [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R];
        } else if (sel === HSD_TEInput.TE_G) {
            input.arg = GX.CC.RASC;
            tev.rasSwapTable = [GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G];
        } else if (sel === HSD_TEInput.TE_B) {
            input.arg = GX.CC.RASC;
            tev.rasSwapTable = [GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B, GX.TevColorChan.B];
        } else if (sel === HSD_TEInput.TE_A) {
            input.arg = GX.CC.RASA;
        }
    } else if (input.type === HSD_TExpType.TE_CNST) {
        assert(HSD_TExpGetType(exp) === HSD_TExpType.TE_CNST);
        const expCnst = exp as HSD_TECnst;
        input.sel = expCnst.comp;
        HSD_TExpRef(input.exp, input.sel);
    }
}

export function HSD_TExpColorIn(tev: HSD_TETev, selA: HSD_TEInput, expA: HSD_TExp | null, selB: HSD_TEInput, expB: HSD_TExp | null, selC: HSD_TEInput, expC: HSD_TExp | null, selD: HSD_TEInput, expD: HSD_TExp | null): void {
    HSD_TExpColorInSub(tev, 0, selA, expA);
    HSD_TExpColorInSub(tev, 1, selB, expB);
    HSD_TExpColorInSub(tev, 2, selC, expC);
    HSD_TExpColorInSub(tev, 3, selD, expD);
}

export function HSD_TExpAlphaOp(tev: HSD_TETev, op: GX.TevOp, bias: GX.TevBias, scale: GX.TevScale, clamp: boolean): void {
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

function HSD_TExpAlphaInSub(tev: HSD_TETev, idx: number, sel: HSD_TEInput, exp: HSD_TExp | null): void {
    const input = tev.alphaIn[idx];
    HSD_TExpUnref(input.exp, input.sel);

    input.type = HSD_TExpGetType(exp);
    input.sel = sel;
    input.exp = exp;
    input.arg = null;
    assert(exp !== tev);

    if (sel === HSD_TEInput.TE_0) {
        input.type = HSD_TExpType.TE_ZERO;
    } else if (sel >= HSD_TEInput.TE_1 && sel <= HSD_TEInput.TE_7_8) {
        input.type = HSD_TExpType.TE_KONST;
        input.arg = GX.CA.KONST;

        if (sel === HSD_TEInput.TE_1_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_1_8;
        else if (sel === HSD_TEInput.TE_2_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_2_8;
        else if (sel === HSD_TEInput.TE_3_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_3_8;
        else if (sel === HSD_TEInput.TE_5_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_5_8;
        else if (sel === HSD_TEInput.TE_6_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_6_8;
        else if (sel === HSD_TEInput.TE_7_8)
            tev.kasel = GX.KonstAlphaSel.KASEL_7_8;
    }

    if (input.type === HSD_TExpType.TE_ZERO) {
        input.sel = HSD_TEInput.TE_0;
        input.arg = GX.CA.ZERO;
    } else if (input.type === HSD_TExpType.TE_TEV) {
        assert(sel === HSD_TEInput.TE_A);
        assert(HSD_TExpGetType(exp) === HSD_TExpType.TE_TEV);
        const expTev = exp as HSD_TETev;
        assert(idx === 3 || expTev.alphaClamp);
        HSD_TExpRef(input.exp, input.sel);
    } else if (input.type === HSD_TExpType.TE_TEX) {
        input.arg = GX.CA.TEXA;
    } else if (input.type === HSD_TExpType.TE_RAS) {
        input.arg = GX.CA.RASA;
    } else if (input.type === HSD_TExpType.TE_CNST) {
        assert(sel === HSD_TEInput.TE_A || sel === HSD_TEInput.TE_X);
        assert(HSD_TExpGetType(exp) === HSD_TExpType.TE_CNST);
        const expCnst = exp as HSD_TECnst;
        assert(expCnst.comp === HSD_TEInput.TE_X);
        input.sel = HSD_TEInput.TE_X;
        HSD_TExpRef(input.exp, input.sel);
    }
}

export function HSD_TExpAlphaIn(tev: HSD_TETev, selA: HSD_TEInput, expA: HSD_TExp | null, selB: HSD_TEInput, expB: HSD_TExp | null, selC: HSD_TEInput, expC: HSD_TExp | null, selD: HSD_TEInput, expD: HSD_TExp | null): void {
    HSD_TExpAlphaInSub(tev, 0, selA, expA);
    HSD_TExpAlphaInSub(tev, 1, selB, expB);
    HSD_TExpAlphaInSub(tev, 2, selC, expC);
    HSD_TExpAlphaInSub(tev, 3, selD, expD);
}

export function HSD_TExpTev(list: HSD_TExpList): HSD_TETev {
    const exp = new HSD_TETev();
    list.tevs.unshift(exp);
    return exp;
}

function HSD_TExpCnstInternal(list: HSD_TExpList, val: HSD_TExpCnstVal, comp: HSD_TEInput): HSD_TECnst {
    let cnst = list.cnsts.find((n) => n.val === val && n.comp === comp);
    if (cnst === undefined) {
        cnst = new HSD_TECnst(val, comp);
        list.cnsts.push(cnst);
    }
    return cnst;
}

export function HSD_TExpCnst(list: HSD_TExpList, val: HSD_TExpCnstVal, comp: HSD_TEInput): HSD_TECnst {
    // Try to find an existing one.
    assert(val < HSD_TExpCnstVal.TOBJ_START);
    return HSD_TExpCnstInternal(list, val, comp);
}

export function HSD_TExpCnstTObj(list: HSD_TExpList, tobjIdx: number, val: HSD_TExpCnstVal, comp: HSD_TEInput): HSD_TECnst {
    // Try to find an existing one.
    assert(val >= HSD_TExpCnstVal.TOBJ_START);
    assert((val & HSD_TExpCnstVal.TOBJ_VAL_MASK) === val);
    val = (tobjIdx << HSD_TExpCnstVal.TOBJ_IDX_SHIFT) | val;
    return HSD_TExpCnstInternal(list, val, comp);
}

function TEArg_Zero(dst: HSD_TEArg): void {
    HSD_TExpUnref(dst.exp, dst.sel);
    dst.type = HSD_TExpType.TE_ZERO;
    dst.sel = HSD_TEInput.TE_0;
    dst.arg = null;
    dst.exp = null;
}

function TEArg_Copy(dst: HSD_TEArg, src: HSD_TEArg): void {
    HSD_TExpRef(src.exp, src.sel);
    HSD_TExpUnref(dst.exp, dst.sel);

    dst.type = src.type;
    dst.sel = src.sel;
    dst.arg = src.arg;
    dst.exp = src.exp;
}

function TEArg_Swap(a: HSD_TEArg, b: HSD_TEArg): void {
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

function SimplifySrc(tev: HSD_TETev): void {
    // TODO(jstpierre)
}

function SimplifyThis(tev: HSD_TETev): void {
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
            tev.chan = GX.RasColorChannelID.COLOR_ZERO;
            tev.rasSwapTable = undefined;
        }

        // Rules.
        let matched = false;
        if (tev.alphaOp === null || tev.alphaOp === GX.TevOp.COMP_A8_GT || tev.alphaOp === GX.TevOp.COMP_A8_EQ) {
            if (tev.colorOp !== null && tev.refColor === 0) {
                tev.colorOp = null;
                for (let i = 0; i < 4; i++)
                    TEArg_Zero(tev.colorIn[i]);
                matched = true;
            }

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

function ResConflict(a: HSD_TETev, b: HSD_TETev): boolean {
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

function MergeResources(dst: HSD_TETev, src: HSD_TETev): void {
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

function SimplifyByMerge(tev: HSD_TETev): void {
    while (true) {
        let matched = false;

        if (!(tev.alphaOp === null || tev.alphaOp === GX.TevOp.COMP_A8_GT || tev.alphaOp === GX.TevOp.COMP_A8_EQ || tev.alphaOp === GX.TevOp.ADD || tev.alphaOp === GX.TevOp.SUB))
            break;

        if ((tev.colorOp === GX.TevOp.ADD || tev.colorOp === GX.TevOp.SUB) &&
            (tev.colorIn[1].sel === HSD_TEInput.TE_0 && tev.colorIn[2].sel === HSD_TEInput.TE_0 && HSD_TExpGetType(tev.colorIn[0].exp) !== HSD_TExpType.TE_CNST && HSD_TExpGetType(tev.colorIn[3].exp) !== HSD_TExpType.TE_CNST)) {
            // B = 0, C = 0, we always select LHS here...

            if (tev.colorOp === GX.TevOp.ADD && (tev.colorIn[0].type === HSD_TExpType.TE_TEX || tev.colorIn[0].type === HSD_TExpType.TE_RAS) && tev.colorIn[3].type === HSD_TExpType.TE_TEV) {
                // A = Tex/Ras, D = TEV... Swap so that A always contains the subchild. Makes future cleanups easier.
                const tev3 = tev.colorIn[3].exp as HSD_TETev;
                if (((tev.colorIn[3].sel === HSD_TEInput.TE_RGB && tev3.colorClamp) || (tev.colorIn[3].sel === HSD_TEInput.TE_A && tev3.alphaClamp))) {
                    TEArg_Swap(tev.colorIn[0], tev.colorIn[3]);
                }
            }

            if (tev.colorIn[0].type === HSD_TExpType.TE_TEV && tev.colorIn[0].sel === HSD_TEInput.TE_RGB) {
                // If A = TEV, and that TEV expression has no D, then merge it into us if we can.
                const sel = tev.colorIn[0].sel;
                const child = tev.colorIn[0].exp as HSD_TETev;
                if ((child.colorOp === GX.TevOp.ADD || child.colorOp === GX.TevOp.SUB) && child.colorIn[3].sel === HSD_TEInput.TE_0 && child.colorScale === GX.TevScale.SCALE_1 && !ResConflict(tev, child)) {
                    const bias = CalcBias(child.colorOp, tev.colorBias, child.colorBias);
                    if (bias !== null) {
                        tev.colorBias = bias;
                        if (child.colorOp === GX.TevOp.SUB)
                            tev.colorOp = (tev.colorOp === GX.TevOp.ADD) ? GX.TevOp.SUB : GX.TevOp.ADD;
                        for (let i = 0; i < 3; i++)
                            TEArg_Copy(tev.colorIn[i], child.colorIn[i]);
                        MergeResources(tev, child);
                        HSD_TExpUnref(tev, sel);
                        matched = true;
                    }
                }
            } else if (tev.colorIn[0].type !== HSD_TExpType.TE_TEV && tev.alphaOp === GX.TevOp.ADD && tev.colorIn[3].type === HSD_TExpType.TE_TEV && tev.colorIn[3].sel === HSD_TEInput.TE_RGB) {
                const sel = tev.colorIn[3].sel;
                const child = tev.colorIn[3].exp as HSD_TETev;
                if (child.colorScale === GX.TevScale.SCALE_1 && (tev.colorBias === GX.TevBias.ZERO || tev.colorBias !== child.colorBias) && !ResConflict(tev, child)) {
                    for (let i = 0; i < 4; i++)
                        TEArg_Copy(tev.colorIn[i], child.colorIn[i]);
                    tev.colorOp = child.colorOp;
                    tev.colorBias = assertExists(CalcBias(tev.colorOp!, tev.colorBias, child.colorBias));
                    tev.colorClamp = tev.colorClamp || child.colorClamp;
                    MergeResources(tev, child);
                    HSD_TExpUnref(child, sel);
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

function IsThroughColor(tev: HSD_TETev): boolean {
    return tev.colorOp === GX.TevOp.ADD && tev.colorIn[0].sel === HSD_TEInput.TE_0 && tev.colorIn[1].sel === HSD_TEInput.TE_0 && tev.colorBias === GX.TevBias.ZERO && tev.colorScale === GX.TevScale.SCALE_1;
}

function IsThroughAlpha(tev: HSD_TETev): boolean {
    return tev.alphaOp === GX.TevOp.ADD && tev.alphaIn[0].sel === HSD_TEInput.TE_0 && tev.alphaIn[1].sel === HSD_TEInput.TE_0 && tev.alphaBias === GX.TevBias.ZERO && tev.alphaScale === GX.TevScale.SCALE_1;
}

function HSD_TExpSimplify(root: HSD_TExp): void {
    if (HSD_TExpGetType(root) === HSD_TExpType.TE_TEV) {
        const tev = root as HSD_TETev;
        SimplifySrc(tev);
        SimplifyThis(tev);
        SimplifyByMerge(tev);
    }
}

function CalcDistance(dst: number[], tevs: HSD_TETev[], tev: HSD_TETev, depth: number): void {
    const i = tevs.indexOf(tev);
    assert(i >= 0);

    // Calculate *maximum* depth from the root.
    dst[i] = Math.max(dst[i], depth);

    for (let j = 0; j < 4; j++) {
        if (tev.colorIn[j].type === HSD_TExpType.TE_TEV)
            CalcDistance(dst, tevs, tev.colorIn[j].exp as HSD_TETev, depth + 1);
        if (tev.alphaIn[j].type === HSD_TExpType.TE_TEV) {
            assert(tev.alphaIn[j].exp !== tev);
            CalcDistance(dst, tevs, tev.alphaIn[j].exp as HSD_TETev, depth + 1);
        }
    }
}

interface HSD_TExpDag {
    tev: HSD_TETev;
    idx: number;
    dependencies: HSD_TExpDag[];
}

function HSD_TExpMakeDag(root: HSD_TExp): HSD_TExpDag[] {
    assert(HSD_TExpGetType(root) === HSD_TExpType.TE_TEV);

    const tev = root as HSD_TETev;
    const tevs: HSD_TETev[] = [tev];

    // Linearize all TEVs.

    // This should be the same as the TEVs in the list, but might not be if they are unused.
    // TODO(jstpierre): Check for differences?
    for (let i = 0; i < tevs.length; i++) {
        for (let j = 0; j < 4; j++) {
            if (tevs[i].colorIn[j].type === HSD_TExpType.TE_TEV) {
                const child = tevs[i].colorIn[j].exp as HSD_TETev;
                if (!tevs.includes(child))
                    tevs.push(child);
            }

            if (tevs[i].alphaIn[j].type === HSD_TExpType.TE_TEV) {
                const child = tevs[i].alphaIn[j].exp as HSD_TETev;
                if (!tevs.includes(child))
                    tevs.push(child);
            }
        }
    }

    const dist = nArray(tevs.length, () => -1);
    CalcDistance(dist, tevs, tevs[0], 0);

    // Sort TEVs by distance, ascending.
    const tevsRaw = tevs.slice();
    tevs.sort((a, b) => dist[tevsRaw.indexOf(a)] - dist[tevsRaw.indexOf(b)]);

    // Sanity check.
    /*
    const distSorted = tevsSorted.map((tev) => dist[tevs.indexOf(tev)]);
    console.log(distSorted, tevsSorted);
    */

    const dags: HSD_TExpDag[] = nArray(tevs.length, () => ({ tev: null!, idx: -1, dependencies: [] }));
    for (let i = tevs.length - 1; i >= 0; i--) {
        const tev = tevs[i], dag = dags[i];
        dag.tev = tev;
        dag.idx = i;
        for (let j = 0; j < 4; j++) {
            if (tev.colorIn[j].type === HSD_TExpType.TE_TEV) {
                // Find child index and push dependency if it doesn't already exist...
                const childIndex = tevs.indexOf(tev.colorIn[j].exp as HSD_TETev, i);
                if (!dag.dependencies.includes(dags[childIndex]))
                    dag.dependencies.push(dags[childIndex]);
            }

            if (tev.alphaIn[j].type === HSD_TExpType.TE_TEV) {
                const childIndex = tevs.indexOf(tev.alphaIn[j].exp as HSD_TETev, i);
                if (!dag.dependencies.includes(dags[childIndex]))
                    dag.dependencies.push(dags[childIndex]);
            }
        }
    }

    return dags;
}

function make_dependency_mtx(dags: HSD_TExpDag[]): number[] {
    const mtx = nArray(dags.length, () => 0);
    for (let i = 0; i < dags.length; i++) {
        const dag = dags[i];
        for (let j = 0; j < dag.dependencies.length; j++)
            mtx[i] |= (1 << dag.dependencies[j].idx);
    }
    return mtx;
}

function make_full_dependency_mtx(mtx: number[]): number[] {
    const full = mtx.slice();

    while (true) {
        let changed = false;

        for (let i = 0; i < full.length; i++) {
            for (let j = 0; j < full.length; j++) {
                if ((((1 << i) & full[j]) !== 0) && (full[j] & full[i]) !== full[i]) {
                    full[j] |= full[i];
                    changed = true;
                }
            }
        }

        if (!changed)
            break;
    }

    return full;
}

function assign_reg(dags: HSD_TExpDag[], order: number[]): number {
    let maxColorUsed = 4;
    let maxAlphaUsed = 4;

    const regColorRef: number[] = [0, 0, 0, 0];
    const regAlphaRef: number[] = [0, 0, 0, 0];

    for (let i = dags.length - 1; i >= 0; i--) {
        const tev = dags[order[i]].tev;

        // Unref registers used by children.
        for (let j = 0; j < 4; j++) {
            if (HSD_TExpGetType(tev.colorIn[j].exp) === HSD_TExpType.TE_TEV) {
                const child = tev.colorIn[j].exp as HSD_TETev;

                if (tev.colorIn[j].sel === HSD_TEInput.TE_RGB)
                    regColorRef[child.dstRegColor!]--;
                else
                    regAlphaRef[child.dstRegAlpha!]--;
            }

            if (HSD_TExpGetType(tev.alphaIn[j].exp) === HSD_TExpType.TE_TEV) {
                const child = tev.alphaIn[j].exp as HSD_TETev;
                regAlphaRef[child.dstRegAlpha!]--;
            }
        }

        // Now assign free registers
        if (tev.refColor > 0) {
            for (let j = 3; j >= 0; j--) {
                if (regColorRef[j] === 0) {
                    regColorRef[j] = tev.refColor;
                    tev.dstRegColor = j;
                    maxColorUsed = Math.min(j, maxColorUsed);
                    break;
                }
            }
        }

        if (tev.refAlpha > 0) {
            for (let j = 3; j >= 0; j--) {
                if (regAlphaRef[j] === 0) {
                    regAlphaRef[j] = tev.refAlpha;
                    tev.dstRegAlpha = j;
                    maxAlphaUsed = Math.min(j, maxAlphaUsed);
                    break;
                }
            }
        }
    }

    // The number of allocated registers.
    return (4 - maxColorUsed) + (4 - maxAlphaUsed);
}

interface OrderDagResult {
    bestRegsUsed: number;
    bestOrder: number[];
}

function order_dag_internal(res: OrderDagResult, dags: HSD_TExpDag[], order: number[], depMtx: number[], fullDepMtx: number[], depth: number, idx: number, doneSet: number, readySet: number): void {
    // Search through to find a minimal register order.

    doneSet = doneSet | (1 << idx);
    order[depth] = idx;

    depth++;
    if (depth >= depMtx.length) {
        // Done building the order... try assigning registers.
        const regsUsed = assign_reg(dags, order);

        if (regsUsed < res.bestRegsUsed) {
            // New best! Save this configuration...
            res.bestRegsUsed = regsUsed;
            res.bestOrder = order.slice();
        }
    } else {
        let totalDep = (readySet & ~(1 << idx)) | depMtx[idx];
        let bits = 0;
        for (let i = 0; i < dags.length; i++)
            if (!!(totalDep & (1 << i)))
                bits |= fullDepMtx[i];
        totalDep &= ~bits;

        // Brute-force all orderings.
        if (dags[idx].dependencies.length === 1 && !!(totalDep & depMtx[idx])) {
            order_dag_internal(res, dags, order, depMtx, fullDepMtx, depth, dags[idx].dependencies[0].idx, doneSet, totalDep);
        } else {
            for (let i = 0; i < dags.length; i++) {
                if (!!(totalDep & (1 << i)))
                    order_dag_internal(res, dags, order, depMtx, fullDepMtx, depth, i, doneSet, totalDep);
            }
        }
    }
}

function order_dag(dags: HSD_TExpDag[], depMtx: number[], fullDepMtx: number[]): number[] {
    const res: OrderDagResult = {
        bestRegsUsed: 5,
        bestOrder: [],
    };

    const order = nArray(dags.length, () => -1);
    order_dag_internal(res, dags, order, depMtx, fullDepMtx, 0, 0, 0, 0);
    return res.bestOrder;
}

interface HSD_TExpRes {
    regsColor: number[];
    regsAlpha: number[];
}

function HSD_TExpSchedule(resource: HSD_TExpRes, dags: HSD_TExpDag[]): HSD_TETev[] {
    const depMtx = make_dependency_mtx(dags);
    const fullDepMtx = make_full_dependency_mtx(depMtx);
    const order = order_dag(dags, depMtx, fullDepMtx);

    const colorInRGB = [ GX.CC.C0, GX.CC.C1, GX.CC.C2, GX.CC.CPREV ];
    const colorInA   = [ GX.CC.A0, GX.CC.A1, GX.CC.A2, GX.CC.APREV ];
    const alphaIn    = [ GX.CA.A0, GX.CA.A1, GX.CA.A2, GX.CA.APREV ];

    const result: HSD_TETev[] = [];
    for (let i = 0; i < order.length; i++) {
        const tev = dags[order[i]].tev;
        result[i] = tev;

        if (tev.dstRegColor !== null) {
            resource.regsColor[tev.dstRegColor + 4] = 3;

            for (let j = 0; j < 4; j++) {
                if (HSD_TExpGetType(tev.colorIn[j].exp) === HSD_TExpType.TE_TEV) {
                    const child = tev.colorIn[j].exp as HSD_TETev;
                    if (tev.colorIn[j].sel === HSD_TEInput.TE_RGB)
                        tev.colorIn[j].arg = assertExists(colorInRGB[child.dstRegColor!]);
                    else
                        tev.colorIn[j].arg = assertExists(colorInA[child.dstRegAlpha!]);
                }
            }
        }

        if (tev.dstRegAlpha !== null) {
            resource.regsAlpha[tev.dstRegAlpha + 4] = 1;

            for (let j = 0; j < 4; j++) {
                if (HSD_TExpGetType(tev.alphaIn[j].exp) === HSD_TExpType.TE_TEV) {
                    const child = tev.alphaIn[j].exp as HSD_TETev;
                    tev.alphaIn[j].arg = assertExists(alphaIn[child.dstRegAlpha!]);
                }
            }
        }
    }

    return result;
}

function AssignColorKonst(tev: HSD_TETev, idx: number, resource: HSD_TExpRes): boolean {
    const xsel = [
        [ GX.KonstColorSel.KCSEL_K0_R, GX.KonstColorSel.KCSEL_K0_G, GX.KonstColorSel.KCSEL_K0_B, GX.KonstColorSel.KCSEL_K0_A ],
        [ GX.KonstColorSel.KCSEL_K1_R, GX.KonstColorSel.KCSEL_K1_G, GX.KonstColorSel.KCSEL_K1_B, GX.KonstColorSel.KCSEL_K1_A ],
        [ GX.KonstColorSel.KCSEL_K2_R, GX.KonstColorSel.KCSEL_K2_G, GX.KonstColorSel.KCSEL_K2_B, GX.KonstColorSel.KCSEL_K2_A ],
        [ GX.KonstColorSel.KCSEL_K3_R, GX.KonstColorSel.KCSEL_K3_G, GX.KonstColorSel.KCSEL_K3_B, GX.KonstColorSel.KCSEL_K3_A ],
    ];
    const csel = [ GX.KonstColorSel.KCSEL_K0, GX.KonstColorSel.KCSEL_K1, GX.KonstColorSel.KCSEL_K2, GX.KonstColorSel.KCSEL_K3 ];

    const cnst = tev.colorIn[idx].exp as HSD_TECnst;

    // Allocate constant if necessary.
    if (cnst.reg === null) {
        if (cnst.comp === HSD_TEInput.TE_X) {
            // First look through alphas...
            for (let i = 1; i < 4; i++) {
                if (resource.regsAlpha[i] === 0) {
                    cnst.reg = i;
                    cnst.idx = 3;
                    resource.regsAlpha[i] = 1;
                    break;
                }
            }

            // Now search colors...
            for (let i = 0; i < 4; i++) {
                if (resource.regsColor[i] < 3) {
                    cnst.reg = i;
                    cnst.idx = resource.regsAlpha[i];
                    resource.regsColor[i]++;
                    break;
                }
            }
        } else {
            for (let i = 0; i < 4; i++) {
                if (resource.regsColor[i] === 0) {
                    cnst.reg = i;
                    cnst.idx = 0;
                    resource.regsColor[i] = 3;
                    break;
                }
            }
        }
    }

    if (cnst.reg !== null && cnst.reg < 4 && cnst.idx !== null) {
        // Constant allocated, just set on TEV.
        tev.colorIn[idx].type = HSD_TExpType.TE_KONST;
        tev.colorIn[idx].arg = GX.CC.KONST;
        if (cnst.comp === HSD_TEInput.TE_X)
            tev.kcsel = xsel[cnst.reg][cnst.idx];
        else
            tev.kcsel = csel[cnst.reg];
        return true;
    } else {
        // Could not allocate...
        return false;
    }
}

function AssignColorReg(tev: HSD_TETev, idx: number, resource: HSD_TExpRes): boolean {
    const cin = [ GX.CC.C0, GX.CC.C1, GX.CC.C2, GX.CC.CPREV ];
    const ain = [ GX.CC.A0, GX.CC.A1, GX.CC.A2, GX.CC.APREV ];

    const cnst = tev.colorIn[idx].exp as HSD_TECnst;

    if (cnst.reg === null) {
        if (cnst.comp === HSD_TEInput.TE_X) {
            for (let i = 4; i < 8; i++) {
                if (resource.regsAlpha[i] === 0) {
                    cnst.reg = i;
                    cnst.idx = 3;
                    resource.regsAlpha[i] = 1;
                    break;
                }
            }
        } else {
            for (let i = 4; i < 8; i++) {
                if (resource.regsColor[i] === 0) {
                    cnst.reg = i;
                    cnst.idx = 0;
                    resource.regsColor[i] = 3;
                    break;
                }
            }
        }
    }

    if (cnst.reg !== null && cnst.reg >= 4 && cnst.idx !== null) {
        // Constant allocated, just set on TEV.
        tev.colorIn[idx].type = HSD_TExpType.TE_IMM;
        if (cnst.comp === HSD_TEInput.TE_X)
            tev.colorIn[idx].arg = ain[cnst.reg - 4];
        else
            tev.colorIn[idx].arg = cin[cnst.reg - 4];
        return true;
    } else {
        // Could not allocate...
        return false;
    }
}

function AssignAlphaKonst(tev: HSD_TETev, idx: number, resource: HSD_TExpRes): boolean {
    const xsel = [
        [ GX.KonstAlphaSel.KASEL_K0_R, GX.KonstAlphaSel.KASEL_K0_G, GX.KonstAlphaSel.KASEL_K0_B, GX.KonstAlphaSel.KASEL_K0_A ],
        [ GX.KonstAlphaSel.KASEL_K1_R, GX.KonstAlphaSel.KASEL_K1_G, GX.KonstAlphaSel.KASEL_K1_B, GX.KonstAlphaSel.KASEL_K1_A ],
        [ GX.KonstAlphaSel.KASEL_K2_R, GX.KonstAlphaSel.KASEL_K2_G, GX.KonstAlphaSel.KASEL_K2_B, GX.KonstAlphaSel.KASEL_K2_A ],
        [ GX.KonstAlphaSel.KASEL_K3_R, GX.KonstAlphaSel.KASEL_K3_G, GX.KonstAlphaSel.KASEL_K3_B, GX.KonstAlphaSel.KASEL_K3_A ],
    ];

    const cnst = tev.alphaIn[idx].exp as HSD_TECnst;

    // Allocate constant if necessary.
    if (cnst.reg === null) {
        // First look through alphas...
        for (let i = 1; i < 4; i++) {
            if (resource.regsAlpha[i] === 0) {
                cnst.reg = i;
                cnst.idx = 3;
                resource.regsAlpha[i] = 1;
                break;
            }
        }

        // Now search colors...
        for (let i = 0; i < 4; i++) {
            if (resource.regsColor[i] < 3) {
                cnst.reg = i;
                cnst.idx = resource.regsAlpha[i];
                resource.regsColor[i]++;
                break;
            }
        }
    }

    if (cnst.reg !== null && cnst.reg < 4 && cnst.idx !== null) {
        // Constant allocated, just set on TEV.
        tev.alphaIn[idx].type = HSD_TExpType.TE_KONST;
        tev.alphaIn[idx].arg = GX.CA.KONST;
        tev.kasel = xsel[cnst.reg][cnst.idx];
        return true;
    } else {
        // Could not allocate...
        return false;
    }
}

function AssignAlphaReg(tev: HSD_TETev, idx: number, resource: HSD_TExpRes): boolean {
    const ain = [ GX.CA.A0, GX.CA.A1, GX.CA.A2, GX.CA.APREV ];

    const cnst = tev.alphaIn[idx].exp as HSD_TECnst;

    if (cnst.reg === null) {
        for (let i = 4; i < 8; i++) {
            if (resource.regsAlpha[i] === 0) {
                cnst.reg = i;
                cnst.idx = 3;
                resource.regsAlpha[i] = 1;
                if (window.debug)
                    console.log('assigning alpha reg!', i);
                break;
            }
        }
    }

    if (cnst.reg !== null && cnst.reg >= 4 && cnst.idx !== null) {
        // Constant allocated, just set on TEV.
        tev.alphaIn[idx].type = HSD_TExpType.TE_IMM;
        tev.alphaIn[idx].arg = ain[cnst.reg - 4];
        return true;
    } else {
        // Could not allocate...
        return false;
    }
}

function TExpAssignReg(tev: HSD_TETev, resource: HSD_TExpRes): boolean {
    if (tev.refColor > 0) {
        if (tev.kcsel === null) {
            if (!IsThroughColor(tev) || tev.colorIn[3].type !== HSD_TExpType.TE_CNST) {
                for (let i = 0; i < 4; i++) {
                    if (tev.colorIn[i].type === HSD_TExpType.TE_CNST) {
                        // TODO(jstpierre): This doesn't seem right...
                        if (!AssignColorKonst(tev, i, resource))
                            return AssignColorReg(tev, i, resource);
                    }
                }
            } else {
                if (!AssignColorKonst(tev, 3, resource))
                    return AssignColorReg(tev, 3, resource);
            }
        } else {
            for (let i = 0; i < 4; i++) {
                if (tev.colorIn[i].type === HSD_TExpType.TE_CNST)
                    return AssignColorReg(tev, i, resource);
            }
        }
    }

    if (tev.refAlpha > 0) {
        if (tev.kasel === null) {
            if (!IsThroughAlpha(tev) || tev.alphaIn[3].type !== HSD_TExpType.TE_CNST) {
                for (let i = 0; i < 4; i++) {
                    if (tev.alphaIn[i].type === HSD_TExpType.TE_CNST) {
                        if (!AssignAlphaKonst(tev, i, resource))
                            return AssignAlphaReg(tev, i, resource);
                    }
                }
            } else {
                if (!AssignAlphaReg(tev, 3, resource))
                    return AssignAlphaKonst(tev, 3, resource);
            }
        } else {
            for (let i = 0; i < 4; i++) {
                if (tev.alphaIn[i].type === HSD_TExpType.TE_CNST)
                    return AssignAlphaReg(tev, i, resource);
            }
        }
    }

    return true;
}

function HSD_TExpSimplify2(tev: HSD_TETev): void {
    for (let i = 0; i < 4; i++) {
        if (tev.colorIn[i].type === HSD_TExpType.TE_TEV && tev.colorIn[i].sel === HSD_TEInput.TE_RGB) {
            const child = tev.colorIn[i].exp as HSD_TETev;
            if (IsThroughColor(child)) {
                if (child.colorIn[3].type === HSD_TExpType.TE_KONST) {
                    if (tev.kcsel === null)
                        tev.kcsel = child.kcsel;
                    else if (tev.kcsel !== child.kcsel)
                        continue;
                } else if (child.colorIn[3].type !== HSD_TExpType.TE_IMM) {
                    continue;
                }

                TEArg_Copy(tev.colorIn[i], child.colorIn[3]);
            }
        }
    }

    for (let i = 0; i < 4; i++) {
        if (tev.alphaIn[i].type === HSD_TExpType.TE_TEV) {
            const child = tev.alphaIn[i].exp as HSD_TETev;
            if (IsThroughAlpha(child)) {
                if (child.alphaIn[3].type === HSD_TExpType.TE_KONST) {
                    if (tev.kasel === null)
                        tev.kasel = child.kasel;
                    else if (tev.kasel !== child.kasel)
                        continue;
                } else if (child.alphaIn[3].type !== HSD_TExpType.TE_IMM) {
                    continue;
                }

                TEArg_Copy(tev.alphaIn[i], child.alphaIn[3]);
            }
        }
    }
}

interface TExp2TevDescInit {
    initCPREV: boolean;
    initAPREV: boolean;
}

function TExp2TevDesc(mb: GXMaterialBuilder, i: number, tev: HSD_TETev, init: TExp2TevDescInit): void {
    if (tev.tex !== null)
        mb.setTevOrder(i, tev.tex.texCoordID, tev.tex.texMapID, tev.chan);
    else
        mb.setTevOrder(i, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, tev.chan);

    mb.setTevSwapMode(i, tev.rasSwapTable, tev.texSwapTable);
    mb.setTevKColorSel(i, tev.kcsel ?? GX.KonstColorSel.KCSEL_1);
    mb.setTevKAlphaSel(i, tev.kasel ?? GX.KonstAlphaSel.KASEL_1);

    const dstReg = [ GX.Register.REG0, GX.Register.REG1, GX.Register.REG2, GX.Register.PREV ];

    if (tev.colorOp === null || (tev.refColor === 0 && tev.alphaOp !== GX.TevOp.COMP_R8_GT && tev.alphaOp !== GX.TevOp.COMP_R8_EQ && tev.alphaOp !== GX.TevOp.COMP_GR16_GT && tev.alphaOp !== GX.TevOp.COMP_GR16_EQ && tev.alphaOp !== GX.TevOp.COMP_BGR24_GT && tev.alphaOp !== GX.TevOp.COMP_BGR24_EQ)) {
        mb.setTevColorOp(i, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevColorIn(i, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, init.initCPREV ? GX.CC.ZERO : GX.CC.CPREV);
        init.initCPREV = false;
    } else {
        const dstRegColor = dstReg[tev.dstRegColor!];
        mb.setTevColorOp(i, tev.colorOp, tev.colorBias, tev.colorScale, tev.colorClamp, dstRegColor);
        mb.setTevColorIn(i,
            tev.colorIn[0].arg ?? GX.CC.ZERO,
            tev.colorIn[1].arg ?? GX.CC.ZERO,
            tev.colorIn[2].arg ?? GX.CC.ZERO,
            tev.colorIn[3].arg ?? GX.CC.ZERO);
        if (dstRegColor === GX.Register.PREV)
            init.initCPREV = false;
    }

    if (tev.alphaOp === null || tev.refAlpha === 0) {
        mb.setTevAlphaOp(i, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(i, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, init.initAPREV ? GX.CA.ZERO : GX.CA.APREV);
        init.initAPREV = false;
    } else {
        const dstRegAlpha = dstReg[tev.dstRegAlpha!];
        mb.setTevAlphaOp(i, tev.alphaOp, tev.alphaBias, tev.alphaScale, tev.alphaClamp, dstRegAlpha);
        mb.setTevAlphaIn(i,
            tev.alphaIn[0].arg ?? GX.CA.ZERO,
            tev.alphaIn[1].arg ?? GX.CA.ZERO,
            tev.alphaIn[2].arg ?? GX.CA.ZERO,
            tev.alphaIn[3].arg ?? GX.CA.ZERO);
        if (dstRegAlpha === GX.Register.PREV)
            init.initAPREV = false;
    }
}

function DumpTExp(root: HSD_TExp): void {
    function DumpTEType(exp: HSD_TExp | null, type: HSD_TExpType | null = HSD_TExpGetType(exp), arg: number | null = null, sel: HSD_TEInput | null = null, indent: string = ''): string {
        function DumpTEArg(arg: HSD_TEArg): string {
            return DumpTEType(arg.exp, arg.type, arg.arg, arg.sel, indent + '    ');
        }

        if (type === HSD_TExpType.TE_ZERO) {
            return `TE_ZERO `;
        } else if (type === HSD_TExpType.TE_TEV) {
            const tev = exp as HSD_TETev;
            assert(arg === null);
            return `TE_TEV  {
${indent}  CA: ${DumpTEArg(tev.colorIn[0])}
${indent}  CB: ${DumpTEArg(tev.colorIn[1])}
${indent}  CC: ${DumpTEArg(tev.colorIn[2])}
${indent}  CD: ${DumpTEArg(tev.colorIn[3])}
${indent}  
${indent}  AA: ${DumpTEArg(tev.alphaIn[0])}
${indent}  AB: ${DumpTEArg(tev.alphaIn[1])}
${indent}  AC: ${DumpTEArg(tev.alphaIn[2])}
${indent}  AD: ${DumpTEArg(tev.alphaIn[3])}
${indent}}`;
        } else if (type === HSD_TExpType.TE_TEX) {
            assert(sel === HSD_TEInput.TE_RGB || sel === HSD_TEInput.TE_A);
            return `TE_TEX  <${sel === HSD_TEInput.TE_RGB ? 'RGB' : 'A'}>`;
        } else if (type === HSD_TExpType.TE_RAS) {
            assert(sel === HSD_TEInput.TE_RGB || sel === HSD_TEInput.TE_A);
            return `TE_RAS  <${sel === HSD_TEInput.TE_RGB ? 'RGB' : 'A'}>`;
        } else if (type === HSD_TExpType.TE_CNST) {
            const cnst = exp as HSD_TECnst;
            assert(arg === null);
            assert(sel === HSD_TEInput.TE_RGB || sel === HSD_TEInput.TE_X);
            return `TE_CNST <${cnst.val}, ${sel === HSD_TEInput.TE_RGB ? 'RGB' : 'X'}>`;
        } else if (type === HSD_TExpType.TE_IMM) {
            assert(arg !== null);
            assert(sel !== null);
            return `TE_IMM  <${sel} / ${arg}>`;
        } else {
            return `UNDEF`;
        }
    }

    console.log(DumpTEType(root));
}

function DumpTExpSchedule(order: HSD_TETev[]): void {
    function DumpTEArg(arg: HSD_TEArg): string {
        if (arg.type === HSD_TExpType.TE_TEV)
            return `${HSD_TExpType[arg.type]} / ${arg.arg} / ${order.length - order.indexOf(arg.exp as HSD_TETev) - 1}`;
        else
            return `${arg.type === null ? 'UNDEF' : HSD_TExpType[arg.type]} / ${arg.arg}`;
    }

    function DumpTExp(tev: HSD_TETev, i: number): string {
        return `[${i}] = TE_TEV {
  CRef: ${tev.refColor}
  CDst: ${tev.dstRegColor}
  COp: ${tev.colorOp}
  CA: ${DumpTEArg(tev.colorIn[0])}
  CB: ${DumpTEArg(tev.colorIn[1])}
  CC: ${DumpTEArg(tev.colorIn[2])}
  CD: ${DumpTEArg(tev.colorIn[3])}

  AA: ${DumpTEArg(tev.alphaIn[0])}
  AB: ${DumpTEArg(tev.alphaIn[1])}
  AC: ${DumpTEArg(tev.alphaIn[2])}
  AD: ${DumpTEArg(tev.alphaIn[3])}
}`;
    }

    let str = '';
    for (let i = 0; i < order.length; i++)
        str += DumpTExp(order[order.length - i - 1], i) + '\n';
    console.log(str);
}

export function HSD_TExpCompile(list: HSD_TExpList, mb: GXMaterialBuilder): void {
    const root = list.root;

    if (list.debug) {
        console.log("Unsimplified");
        DumpTExp(root);
    }

    HSD_TExpRef(root, HSD_TEInput.TE_RGB);
    HSD_TExpRef(root, HSD_TEInput.TE_A);

    HSD_TExpSimplify(root);

    if (list.debug) {
        console.log("Simplify 1");
        DumpTExp(root);
    }

    const resource: HSD_TExpRes = {
        regsColor: nArray(8, () => 0),
        regsAlpha: nArray(8, () => 0),
    };

    // dag, yo.
    const dags1 = HSD_TExpMakeDag(root);
    const order1 = HSD_TExpSchedule(resource, dags1);
    assert(order1.length >= 1);

    if (list.debug) {
        console.log("Schedule 1 Pre");
        DumpTExpSchedule(order1);
    }

    for (let i = 0; i < order1.length; i++) {
        const ret = TExpAssignReg(order1[i], resource);
        assert(ret);
    }

    if (list.debug) {
        console.log("Schedule 1 Assign");
        DumpTExpSchedule(order1);
    }

    for (let i = order1.length - 1; i >= 0; i--)
        HSD_TExpSimplify2(order1[i]);

    if (list.debug) {
        console.log("Simplify2");
        DumpTExpSchedule(order1);
    }

    const dags2 = HSD_TExpMakeDag(root);
    const order2 = HSD_TExpSchedule(resource, dags2);

    if (list.debug) {
        console.log("Schedule 2");
        DumpTExpSchedule(order2);
        debugger;
    }

    // Final ordering. Compile to GXMaterialBuilder.
    const init: TExp2TevDescInit = { initCPREV: true, initAPREV: true };
    for (let i = 0; i < order2.length; i++)
        TExp2TevDesc(mb, i, order2[order2.length - i - 1], init);
}
