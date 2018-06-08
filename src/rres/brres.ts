
// Parses NintendoWare BRRES (Binary Revolution RESource) files.
// http://wiki.tockdom.com/wiki/BRRES

import * as GX from '../gx/gx_enum';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import * as GX_Material from '../gx/gx_material';

interface ResDicEntry {
    name: string;
    offs: number;
}

function parseResDic(buffer: ArrayBufferSlice, tableOffs: number): ResDicEntry[] {
    if (tableOffs === 0)
        return [];

    const view = buffer.createDataView();
    const tableSize = view.getUint32(tableOffs + 0x00);
    const tableCount = view.getUint32(tableOffs + 0x04);

    const entries: ResDicEntry[] = [];

    let tableIdx = tableOffs + 0x08;
    // Skip root entry.
    tableIdx += 0x10;
    for (let i = 0; i < tableCount; i++) {
        // There's a fancy search tree in here which I don't care about at all...
        const name = readString(buffer, tableOffs + view.getUint32(tableIdx + 0x08));
        const offs = tableOffs + view.getUint32(tableIdx + 0x0C);
        entries.push({ name, offs });
        tableIdx += 0x10;
    }

    return entries;
}

interface TEX0 {
    name: string;
    width: number;
    height: number;
    format: GX.TexFormat;
    numMipmaps: number;
    minLod: number;
    maxLod: number;
    data: ArrayBufferSlice;
}

function parseTEX0(buffer: ArrayBufferSlice): TEX0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'TEX0');
    const version = view.getUint32(0x08);
    assert(version === 0x03);

    const dataOffs = view.getUint32(0x10);
    const nameOffs = view.getUint32(0x14);
    const name = readString(buffer, nameOffs);

    const flags = view.getUint32(0x18);
    const width = view.getUint16(0x1C);
    const height = view.getUint16(0x1E);
    const format: GX.TexFormat = view.getUint32(0x20);
    const numMipmaps = view.getUint32(0x24);
    const minLod = view.getFloat32(0x28);
    const maxLod = view.getFloat32(0x2C);

    const data = buffer.subarray(dataOffs);
    return { name, width, height, format, numMipmaps, minLod, maxLod, data };
}

interface MDL0 {
    name: string;
}

class DisplayListRegisters {
    public bp: Uint32Array = new Uint32Array(0x100);
    public cp: Uint32Array = new Uint32Array(0x100);

    // Can have up to 16 values per register.
    public xf: Uint32Array = new Uint32Array(0x1000);

    // TEV colors are weird and are two things under the hood
    // with the same register address.
    public kc: Uint32Array = new Uint32Array(4 * 2 * 2);

    constructor() {
        // Initialize defaults.
        this.bp[GX.BPRegister.SS_MASK] = 0x00FFFFFF;
    }

    public bps(regBag: number): void {
        // First byte has register address, other 3 have value.
        const regAddr  = regBag >>> 24;

        const regWMask = this.bp[GX.BPRegister.SS_MASK];
        // Retrieve existing value, overwrite w/ mask.
        const regValue = (this.bp[regAddr] & ~regWMask) | (regBag & regWMask);
        // The mask resets after use.
        this.bp[GX.BPRegister.SS_MASK] = 0x00FFFFFF;
        // Set new value.
        this.bp[regAddr] = regValue;

        // Copy TEV colors internally.
        if (regAddr >= GX.BPRegister.TEV_REGISTERL_0_ID && regAddr <= GX.BPRegister.TEV_REGISTERL_0_ID + 4 * 2) {
            const kci = regAddr - GX.BPRegister.TEV_REGISTERL_0_ID;
            const bank = (regValue >>> 23) & 0x01;
            this.kc[bank * 4 * 2 + kci] = regValue;
        }
    }
    public xfs(idx: GX.XFRegister, sub: number, v: number): void {
        assert(idx >= 0x1000);
        idx -= 0x1000;
        this.xf[idx * 0x10 + sub] = v;
    }
    public xfg(idx: GX.XFRegister, sub: number = 0): number {
        assert(idx >= 0x1000);
        idx -= 0x1000;
        return this.xf[idx * 0x10 + sub];
    }
}

// TODO(jstpierre): Move this to gx_displaylist.ts
function runDisplayListRegisters(r: DisplayListRegisters, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    for (let i = 0; i < buffer.byteLength;) {
        const cmd = view.getUint8(i++);
        switch (cmd) {
        case GX.Command.NOOP:
            continue;

        case GX.Command.LOAD_BP_REG: {
            const regBag = view.getUint32(i);
            i += 4;
            r.bps(regBag);
            break;
        }

        case GX.Command.LOAD_CP_REG: {
            const regAddr = view.getUint8(i);
            i++;
            const regValue = view.getUint32(i);
            i += 4;
            r.cp[regAddr] = regValue;
            break;
        }

        case GX.Command.LOAD_XF_REG: {
            const len = view.getUint16(i) + 1;
            i += 2;
            assert(len <= 0x10);

            const regAddr = view.getUint16(i);
            i += 2;

            for (let j = 0; j < len; j++) {
                r.xf[(regAddr * 0x10) + j] = view.getUint32(i);
                i += 4;
            }

            // Clear out the other values.
            for (let j = len; j < 16; j++) {
                r.xf[(regAddr * 0x10) + j] = 0;
            }

            break;
        }

        default:
            throw "whoops";
        }
    }
}

function findTevOp(bias: GX.TevBias, scale: GX.TevScale, sub: boolean): GX.TevOp {
    if (bias === GX.TevBias.$HWB_COMPARE) {
        switch (scale) {
        case GX.TevScale.$HWB_R8: return sub ? GX.TevOp.COMP_R8_EQ : GX.TevOp.COMP_R8_GT;
        case GX.TevScale.$HWB_GR16: return sub ? GX.TevOp.COMP_GR16_EQ : GX.TevOp.COMP_GR16_GT;
        case GX.TevScale.$HWB_BGR24: return sub ? GX.TevOp.COMP_BGR24_EQ : GX.TevOp.COMP_BGR24_GT;
        case GX.TevScale.$HWB_RGB8: return sub ? GX.TevOp.COMP_RGB8_EQ : GX.TevOp.COMP_RGB8_GT;
        default:
            throw "whoops";
        }
    } else {
        return sub ? GX.TevOp.SUB : GX.TevOp.ADD;
    }
}

function parseMDL0_TevEntry(buffer: ArrayBufferSlice, r: DisplayListRegisters, numStagesCheck: number): void {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);
    assert(size === 480 + 32);

    const index = view.getUint32(0x08);
    const numStages = view.getUint8(0x0C);
    assert(numStages === numStagesCheck);

    const dlOffs = 0x14;

    runDisplayListRegisters(r, buffer.subarray(dlOffs, 480));
}

interface MDL0_MaterialEntry {
    index: number;
    name: string;
    translucent: boolean;
    gxMaterial: GX_Material.GXMaterial;
}

function parseMDL0_MaterialEntry(buffer: ArrayBufferSlice): MDL0_MaterialEntry {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);

    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);
    const index = view.getUint32(0x0C);
    const flags = view.getUint32(0x10);
    const translucent = !!(flags & 0x80000000);

    // genMode
    const numTexGens = view.getUint8(0x14);
    const numChans = view.getUint8(0x15);
    const numTevs = view.getUint8(0x16);
    const numInds = view.getUint8(0x17);
    const cullMode: GX.CullMode = view.getUint32(0x18);
    // matMisc
    const zCompLoc = !!view.getUint8(0x1C);
    const lightset = view.getInt8(0x1D);
    const fogset = view.getInt8(0x1E);
    // pad
    const indMethod0 = view.getUint8(0x20);
    const indMethod1 = view.getUint8(0x21);
    const indMethod2 = view.getUint8(0x22);
    const indMethod3 = view.getUint8(0x23);
    const nrmRefLight0 = view.getUint8(0x24);
    const nrmRefLight1 = view.getUint8(0x25);
    const nrmRefLight2 = view.getUint8(0x26);
    const nrmRefLight3 = view.getUint8(0x27);

    const tevOffs = view.getUint32(0x28);
    assert(numTevs <= 16);

    const numPalettes = view.getUint32(0x2C);
    const paletteOffs = view.getUint32(0x30);
    // fur
    // user data

    // Run the mat DLs.
    const r = new DisplayListRegisters();

    const matDLOffs = view.getUint32(0x34);
    const matDLSize = 32 + 128 + 64 + 160;
    runDisplayListRegisters(r, buffer.subarray(matDLOffs, matDLSize));

    // Run the TEV registers as well.
    parseMDL0_TevEntry(buffer.subarray(tevOffs), r, numTevs);

    // Now combine the whole thing.

    // First up, validate.
    assert(r.xfg(GX.XFRegister.XF_NUMTEX_ID) === numTexGens);
    assert(r.xfg(GX.XFRegister.XF_NUMCOLORS_ID) === numChans);

    const genMode = r.bp[GX.BPRegister.GEN_MODE_ID];
    assert(((genMode >>>  0) & 0x0F) === numTexGens);
    assert(((genMode >>>  4) & 0x0F) === numChans);
    assert(((genMode >>> 10) & 0x0F) === numTevs);

    // Cull mode specifies which face we reject, genMode specifies which face we rasterize.
    const rastWhichFace = (genMode >>> 14) & 0x02;
    if (cullMode === GX.CullMode.BACK)
        assert(rastWhichFace === GX.CullMode.FRONT);
    else if (cullMode === GX.CullMode.FRONT)
        assert(rastWhichFace === GX.CullMode.BACK);
    else
        assert(rastWhichFace === cullMode);

    // TexGens.
    const texGens: GX_Material.TexGen[] = [];

    for (let i = 0; i < numTexGens; i++) {
        const v = r.xfg((GX.XFRegister.XF_TEX0_ID + i) * 0x10);

        const enum TexProjection {
            ST = 0x00,
            STQ = 0x01,
        }
        const enum TexForm {
            AB11 = 0x00,
            ABC1 = 0x01,
        }
        const enum TexGenType {
            REGULAR = 0x00,
            EMBOSS_MAP = 0x01,
            COLOR_STRGBC0 = 0x02,
            COLOR_STRGBC1 = 0x02,
        }
        const enum TexSourceRow {
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
        }

        // TODO(jstpierre): Figure out texgen matrices. Seems like in most cases BRRES
        // only supports postmtx.
        const matrix: GX.TexGenMatrix = GX.TexGenMatrix.IDENTITY;

        const dv = r.xfg(GX.XFRegister.XF_DUALTEX0_ID + i);
        const postMatrix: GX.PostTexGenMatrix = ((dv >>> 0) & 0xFF) + GX.PostTexGenMatrix.PTTEXMTX0;
        const normalize: boolean = !!((dv >>> 8) & 0x01);

        texGens.push({ index, type: texGenType, source: texGenSrc, matrix, normalize, postMatrix });
    }

    // TEV stages.
    const tevStages: GX_Material.TevStage[] = [];

    interface TevOrder {
        texMapId: GX.TexMapID;
        texCoordId: GX.TexCoordID;
        channelId: GX.RasColorChannelID;
    }

    const tevOrders: TevOrder[] = [];

    // First up, parse RAS1_TREF into tev orders.
    for (let i = 0; i < 8; i++) {
        const v = r.bp[GX.BPRegister.RAS1_TREF_0_ID + i];
        const ti0: GX.TexMapID =          (v >>>  0) & 0x07;
        const tc0: GX.TexCoordID =        (v >>>  3) & 0x07;
        const te0: boolean =           !!((v >>>  6) & 0x01);
        const cc0: GX.RasColorChannelID = (v >>>  7) & 0x07;
        // 7-10 = pad
        const ti1: GX.TexMapID =          (v >>> 12) & 0x07;
        const tc1: GX.TexCoordID =        (v >>> 15) & 0x07;
        const te1: boolean =           !!((v >>> 18) & 0x01);
        const cc1: GX.RasColorChannelID = (v >>> 19) & 0x07;

        // TEV stages should be sequential.
        if (!te0)
            break;

        const order0 = {
            texMapId: ti0,
            texCoordId: tc0,
            channelId: cc0,
        };
        tevOrders.push(order0);

        if (!te1)
            break;

        const order1 = {
            texMapId: ti0,
            texCoordId: tc0,
            channelId: cc0,
        };
        tevOrders.push(order1);
    }

    assert(tevOrders.length === numTevs);

    // Now parse out individual stages.
    for (let i = 0; i < tevOrders.length; i++) {
        const color = r.bp[GX.BPRegister.TEV_COLOR_ENV_0_ID + (i * 2)];

        const colorInD: GX.CombineColorInput = (color >>>  0) & 0x0F;
        const colorInC: GX.CombineColorInput = (color >>>  4) & 0x0F;
        const colorInB: GX.CombineColorInput = (color >>>  8) & 0x0F;
        const colorInA: GX.CombineColorInput = (color >>> 12) & 0x0F;
        const colorBias: GX.TevBias =          (color >>> 16) & 0x03;
        const colorSub: boolean =            !!(color >>> 18);
        const colorClamp: boolean =          !!(color >>> 19);
        const colorScale: GX.TevScale =        (color >>> 20) & 0x03;
        const colorRegId: GX.Register =        (color >>> 22) & 0x03;

        const colorOp: GX.TevOp = findTevOp(colorBias, colorScale, colorSub);

        // Find the op.
        const alpha = r.bp[GX.BPRegister.TEV_ALPHA_ENV_0_ID + (i * 2)];

        // TODO(jstpierre): swap table
        const alphaInD: GX.CombineAlphaInput = (alpha >>>  4) & 0x07;
        const alphaInC: GX.CombineAlphaInput = (alpha >>>  7) & 0x07;
        const alphaInB: GX.CombineAlphaInput = (alpha >>> 10) & 0x07;
        const alphaInA: GX.CombineAlphaInput = (alpha >>> 13) & 0x07;
        const alphaBias: GX.TevBias =          (alpha >>> 16) & 0x03;
        const alphaSub: boolean =            !!(alpha >>> 18);
        const alphaClamp: boolean =          !!(alpha >>> 19);
        const alphaScale: GX.TevScale =        (alpha >>> 20) & 0x03;
        const alphaRegId: GX.Register =        (alpha >>> 22) & 0x03;

        const alphaOp: GX.TevOp = findTevOp(alphaBias, alphaScale, alphaSub);

        const ksel = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (i >>> 1)];
        const konstColorSel: GX.KonstColorSel = ((i & 1) ? (ksel >>> 14) : (ksel >>> 4)) & 0x1F;
        const konstAlphaSel: GX.KonstAlphaSel = ((i & 1) ? (ksel >>> 19) : (ksel >>> 9)) & 0x1F;

        const indCmd = r.bp[GX.BPRegister.IND_CMD0_ID + i];
        const indTexStage: GX.IndTexStageID =   (indCmd >>>  0) & 0x03;
        const indTexFormat: GX.IndTexFormat =   (indCmd >>>  2) & 0x03;
        const indTexBiasSel: GX.IndTexBiasSel = (indCmd >>>  4) & 0x03;
        // alpha sel
        const indTexMatrix: GX.IndTexMtxID =    (indCmd >>>  9) & 0x0F;
        const indTexWrapS: GX.IndTexWrap =      (indCmd >>> 13) & 0x07;
        const indTexWrapT: GX.IndTexWrap =      (indCmd >>> 16) & 0x07;
        const indTexUseOrigLOD: boolean =    !!((indCmd >>> 19) & 0x01);
        const indTexAddPrev: boolean =       !!((indCmd >>> 20) & 0x01);

        const tevStage: GX_Material.TevStage = {
            index: i,

            colorInA, colorInB, colorInC, colorInD, colorOp, colorBias, colorClamp, colorScale, colorRegId,
            alphaInA, alphaInB, alphaInC, alphaInD, alphaOp, alphaBias, alphaClamp, alphaScale, alphaRegId,

            texCoordId: tevOrders[i].texCoordId,
            texMap: tevOrders[i].texMapId,
            channelId: tevOrders[i].channelId,

            konstColorSel, konstAlphaSel,

            indTexStage, indTexFormat, indTexBiasSel, indTexMatrix, indTexWrapS, indTexWrapT, indTexAddPrev, indTexUseOrigLOD,
        };

        tevStages.push(tevStage);
    }

    // Colors.
    const colorRegisters: GX_Material.Color[] = [];
    const colorConstants: GX_Material.Color[] = [];
    for (let i = 0; i < 8; i++) {
        const vl = r.kc[i * 2 + 0];
        const vh = r.kc[i * 2 + 1];

        const cr = ((vl >>>  0) & 0x7FF) / 0xFF;
        const ca = ((vl >>> 12) & 0x7FF) / 0xFF;
        const cb = ((vh >>>  0) & 0x7FF) / 0xFF;
        const cg = ((vh >>> 12) & 0x7FF) / 0xFF;
        const c = new GX_Material.Color(cr, cg, cb, ca);
        if (i < 4)
            colorRegisters[i] = c;
        else
            colorConstants[i - 4] = c;
    }

    // Alpha test.
    const ap = r.bp[GX.BPRegister.TEV_ALPHAFUNC_ID];
    const alphaTest: GX_Material.AlphaTest = {
        referenceA: ((ap >>>  0) & 0x0F) / 0xFF,
        referenceB: ((ap >>>  8) & 0x0F) / 0xFF,
        compareA:    (ap >>> 16) & 0x07,
        compareB:    (ap >>> 19) & 0x07,
        op:          (ap >>> 22) & 0x07,
    };

    const cm0 = r.bp[GX.BPRegister.PE_CMODE0_ID];
    const bmboe = (cm0 >>> 0) & 0x01;
    const bmloe = (cm0 >>> 1) & 0x01;
    const bmbop = (cm0 >>> 11) & 0x01;

    const blendType: GX.BlendMode =
        bmboe ? (bmbop ? GX.BlendMode.SUBTRACT : GX.BlendMode.BLEND) :
        bmloe ? GX.BlendMode.LOGIC : GX.BlendMode.NONE;;
    const dstFactor: GX.BlendFactor = (cm0 >>> 5) & 0x07;
    const srcFactor: GX.BlendFactor = (cm0 >>> 8) & 0x07;
    const logicOp: GX.LogicOp = (cm0 >>> 12) & 0x0F;
    const blendMode: GX_Material.BlendMode = {
        type: blendType,
        dstFactor, srcFactor, logicOp,
    };

    const zm = r.bp[GX.BPRegister.PE_ZMODE_ID];
    const depthTest = !!((zm >>> 0) & 0x01);
    const depthFunc = (zm >>> 1) & 0x07;
    const depthWrite = !!((zm >>> 4) & 0x01);
    const ropInfo: GX_Material.RopInfo = {
        blendMode, depthFunc, depthTest, depthWrite,
    };

    // TODO(jstpierre): Light channels
    const lightChannels: GX_Material.LightChannelControl[] = [];

    // TODO(jstpierre): Indirect texture stages
    const indTexStages: GX_Material.IndTexStage[] = [];

    const gxMaterial: GX_Material.GXMaterial = {
        index, name,
        lightChannels, cullMode,
        tevStages, texGens,
        colorRegisters, colorConstants,
        indTexStages, alphaTest, ropInfo,
    }

    return { index, name, translucent, gxMaterial };
}

function parseMDL0(buffer: ArrayBufferSlice): MDL0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'MDL0');
    const version = view.getUint32(0x08);
    assert(version === 0x0B);

    const byteCodeResDic = parseResDic(buffer, view.getUint32(0x10));
    const nodeResDic = parseResDic(buffer, view.getUint32(0x14));
    const vtxPosResDic = parseResDic(buffer, view.getUint32(0x18));
    const vtxNrmResDic = parseResDic(buffer, view.getUint32(0x1C));
    const vtxClrResDic = parseResDic(buffer, view.getUint32(0x20));
    const vtxTxcResDic = parseResDic(buffer, view.getUint32(0x24));
    const furVecResDic = parseResDic(buffer, view.getUint32(0x28));
    const furPosResDic = parseResDic(buffer, view.getUint32(0x2C));
    const materialResDic = parseResDic(buffer, view.getUint32(0x30));
    const tevResDic = parseResDic(buffer, view.getUint32(0x34));
    const shpResDic = parseResDic(buffer, view.getUint32(0x38));

    const nameOffs = view.getUint32(0x48);
    const name = readString(buffer, nameOffs);

    for (const tevEntry of tevResDic) {
        tevEntry.offs
    }

    return { name };
}

interface RRES {
    models: MDL0[];
    textures: TEX0[];
}

export function parse(buffer: ArrayBufferSlice): RRES {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'bres');

    let littleEndian: boolean;
    switch (view.getUint16(0x04, false)) {
    case 0xFEFF:
        littleEndian = false;
        break;
    case 0xFFFE:
        littleEndian = true;
        break;
    default:
        throw new Error("Invalid BOM");
    }

    assert(!littleEndian);

    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    // Parse out root section.
    assert(readString(buffer, rootSectionOffs + 0x00, 0x04) === 'root');
    const rootResDic = parseResDic(buffer, rootSectionOffs + 0x08);

    // Models
    const models: MDL0[] = [];
    const modelsEntry = rootResDic.find((entry) => entry.name === '3DModels(NW4R)');
    if (modelsEntry) {
        const modelsResDic = parseResDic(buffer, modelsEntry.offs);
        for (const modelEntry of modelsResDic) {
            const model = parseMDL0(buffer.subarray(modelEntry.offs));
            assert(model.name === modelEntry.name);
            models.push(model);
        }
    }

    // Textures
    const textures: TEX0[] = [];
    const texturesEntry = rootResDic.find((entry) => entry.name === 'Textures(NW4R)');
    if (texturesEntry) {
        const texturesResDic = parseResDic(buffer, texturesEntry.offs);
        for (const textureEntry of texturesResDic) {
            const texture = parseTEX0(buffer.subarray(textureEntry.offs));
            assert(texture.name === textureEntry.name);
            textures.push(texture);
        }
    }

    return { models, textures };
}
