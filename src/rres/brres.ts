
// Parses NintendoWare BRRES (Binary Revolution RESource) files.
// http://wiki.tockdom.com/wiki/BRRES

import * as GX from '../gx/gx_enum';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import * as GX_Material from '../gx/gx_material';
import { GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, compileVtxLoader, LoadedVertexLayout, getComponentSizeRaw, getComponentCountRaw } from '../gx/gx_displaylist';
import { vec3, mat4, quat } from 'gl-matrix';

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

export interface TEX0 {
    name: string;
    width: number;
    height: number;
    format: GX.TexFormat;
    mipCount: number;
    minLOD: number;
    maxLOD: number;
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
    const mipCount = view.getUint32(0x24);
    const minLOD = view.getFloat32(0x28) * 1/8;
    const maxLOD = view.getFloat32(0x2C) * 1/8;

    const data = buffer.subarray(dataOffs);
    return { name, width, height, format, mipCount, minLOD, maxLOD, data };
}

export interface MDL0 {
    name: string;
    materials: MDL0_MaterialEntry[];
    shapes: MDL0_ShapeEntry[];
    nodes: MDL0_NodeEntry[];
    sceneGraph: MDL0_SceneGraph;
}

class DisplayListRegisters {
    public bp: Uint32Array = new Uint32Array(0x100);
    public cp: Uint32Array = new Uint32Array(0x100);

    // Can have up to 16 values per register.
    private xf: Uint32Array = new Uint32Array(0x1000);

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
                r.xfs(regAddr, j, view.getUint32(i));
                i += 4;
            }

            // Clear out the other values.
            for (let j = len; j < 16; j++) {
                r.xfs(regAddr, j, 0);
            }

            break;
        }

        default:
            console.error(`Unknown command ${cmd} at ${i} (buffer: 0x${buffer.byteOffset.toString(16)})`);
            throw "whoops 1";
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
            throw "whoops 2";
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

    const dlOffs = 0x20;
    runDisplayListRegisters(r, buffer.subarray(dlOffs, 480));
}

interface MDL0_MaterialSamplerEntry {
    name: string;
    namePalette: string;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    lodBias: number;
}

interface SRT {
    scaleS: number;
    scaleT: number;
    rotation: number;
    translationS: number;
    translationT: number;
}

export interface MDL0_TexSrtEntry {
    texSrt: SRT;
    texMtx: mat4;
}

export interface MDL0_MaterialEntry {
    index: number;
    name: string;
    translucent: boolean;
    gxMaterial: GX_Material.GXMaterial;
    samplers: MDL0_MaterialSamplerEntry[];
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

    const numTexPltt = view.getUint32(0x2C);
    const texPlttOffs = view.getUint32(0x30);
    // fur
    // user data

    // Run the mat DLs.
    const r = new DisplayListRegisters();

    const matDLOffs = view.getUint32(0x3C);
    const matDLSize = 32 + 128 + 64 + 160;
    runDisplayListRegisters(r, buffer.subarray(matDLOffs, matDLSize));

    // Run the TEV registers as well.
    parseMDL0_TevEntry(buffer.subarray(tevOffs), r, numTevs);

    // Now combine the whole thing.

    // TexGens.
    const texGens: GX_Material.TexGen[] = [];

    for (let i = 0; i < numTexGens; i++) {
        const v = r.xfg(GX.XFRegister.XF_TEX0_ID + i);

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

        texGens.push({ index: i, type: texGenType, source: texGenSrc, matrix, normalize, postMatrix });
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

        if (i*2+0 >= numTevs)
            break;

        const order0 = {
            texMapId: te0 ? ti0 : GX.TexMapID.TEXMAP_NULL,
            texCoordId: tc0,
            channelId: cc0,
        };
        tevOrders.push(order0);

        if (i*2+1 >= numTevs)
            break;

        const order1 = {
            texMapId: te1 ? ti1 : GX.TexMapID.TEXMAP_NULL,
            texCoordId: tc1,
            channelId: cc1,
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
        const colorSub: boolean =           !!((color >>> 18) & 0x01);
        const colorClamp: boolean =         !!((color >>> 19) & 0x01);
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
        const alphaSub: boolean =           !!((alpha >>> 18) & 0x01);
        const alphaClamp: boolean =         !!((alpha >>> 19) & 0x01);
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
        referenceA: ((ap >>>  0) & 0xFF) / 0xFF,
        referenceB: ((ap >>>  8) & 0xFF) / 0xFF,
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
    const lightChannels: GX_Material.LightChannelControl[] = [
        {
            colorChannel: { lightingFudge: '0.6 * $VTX$', lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.VTX },
            alphaChannel: { lightingFudge: '1.0 * $VTX$', lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.VTX },
        },
        {
            colorChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.VTX },
            alphaChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.VTX },
        },
    ];

    // TODO(jstpierre): Indirect texture stages
    const indTexStages: GX_Material.IndTexStage[] = [];

    const gxMaterial: GX_Material.GXMaterial = {
        index, name,
        lightChannels, cullMode,
        tevStages, texGens,
        colorRegisters, colorConstants,
        indTexStages, alphaTest, ropInfo,
    }

    // Samplers
    const samplers: MDL0_MaterialSamplerEntry[] = [];
    for (let i = 0; i < numTexPltt; i++) {
        const texPlttInfoOffs = texPlttOffs + i * 0x34;
        const nameTexOffs = view.getUint32(texPlttInfoOffs + 0x00);
        const namePltOffs = view.getUint32(texPlttInfoOffs + 0x04);
        // unk
        // unk
        const texMapId: GX.TexMapID = view.getUint32(texPlttInfoOffs + 0x10);
        const tlutId = view.getUint32(texPlttInfoOffs + 0x14);
        const wrapS: GX.WrapMode = view.getUint32(texPlttInfoOffs + 0x18);
        const wrapT: GX.WrapMode = view.getUint32(texPlttInfoOffs + 0x1C);
        const minFilter: GX.TexFilter = view.getUint32(texPlttInfoOffs + 0x20);
        const magFilter: GX.TexFilter = view.getUint32(texPlttInfoOffs + 0x24);
        const lodBias = view.getFloat32(texPlttInfoOffs + 0x28) * 1/8;
        const maxAniso = view.getUint32(texPlttInfoOffs + 0x2C);
        const biasClamp = view.getUint8(texPlttInfoOffs + 0x30);
        const edgeLod = view.getUint8(texPlttInfoOffs + 0x31);

        const name = readString(buffer, texPlttInfoOffs + nameTexOffs);
        const namePalette = (namePltOffs !== 0) ? readString(buffer, texPlttInfoOffs + namePltOffs) : null;
        samplers[texMapId] = { name, namePalette, lodBias, wrapS, wrapT, minFilter, magFilter };
    }

    // SRT
    const srtFlags = view.getUint32(0x1a8);
    const texMtxMode = view.getUint32(0x1ac);
    let texSrtTableIdx = 0x1b0;
    let texMtxTableIdx = 0x250;
    for (let i = 0; i < 8; i++) {
        const scaleS = view.getFloat32(texSrtTableIdx + 0x00);
        const scaleT = view.getFloat32(texSrtTableIdx + 0x04);
        const rotation = view.getFloat32(texSrtTableIdx + 0x08);
        const translationS = view.getFloat32(texSrtTableIdx + 0x0C);
        const translationT = view.getFloat32(texSrtTableIdx + 0x10);

        const refCamera = view.getInt8(texMtxTableIdx + 0x00);
        const refLight = view.getInt8(texMtxTableIdx + 0x01);
        const mapMode = view.getInt8(texMtxTableIdx + 0x02);
        const miscFlags = view.getInt8(texMtxTableIdx + 0x03);

        const m00 = view.getFloat32(texMtxTableIdx + 0x04);
        const m01 = view.getFloat32(texMtxTableIdx + 0x08);
        const m02 = view.getFloat32(texMtxTableIdx + 0x0C);
        const m03 = view.getFloat32(texMtxTableIdx + 0x10);
        const m10 = view.getFloat32(texMtxTableIdx + 0x14);
        const m11 = view.getFloat32(texMtxTableIdx + 0x18);
        const m12 = view.getFloat32(texMtxTableIdx + 0x1C);
        const m13 = view.getFloat32(texMtxTableIdx + 0x20);
        const m20 = view.getFloat32(texMtxTableIdx + 0x24);
        const m21 = view.getFloat32(texMtxTableIdx + 0x28);
        const m22 = view.getFloat32(texMtxTableIdx + 0x2C);
        const m23 = view.getFloat32(texMtxTableIdx + 0x30);
        const matrix = mat4.fromValues(
            m00, m10, m20, 0,
            m01, m11, m21, 0,
            m02, m12, m22, 0,
            m03, m13, m23, 1,
        );

        texSrtTableIdx += 0x14;
        texMtxTableIdx += 0x34;
    }

    return { index, name, translucent, gxMaterial, samplers };
}

interface VtxBufferData {
    name: string;
    id: number;

    compCnt: GX.CompCnt;
    compType: GX.CompType;
    compShift: number;
    stride: number;

    count: number;
    data: ArrayBufferSlice;
}

function parseMDL0_VtxData(buffer: ArrayBufferSlice, vtxAttrib: GX.VertexAttribute): VtxBufferData {
    const view = buffer.createDataView();
    const dataOffs = view.getUint32(0x08);
    const nameOffs = view.getUint32(0x0C);
    const name = readString(buffer, nameOffs);
    const id = view.getUint32(0x10);
    const compCnt: GX.CompCnt = view.getUint32(0x14);
    const compType: GX.CompType = view.getUint32(0x18);
    let compShift: number = view.getUint8(0x1C);
    let stride: number = view.getUint8(0x1D);
    const count: number = view.getUint16(0x1E);

    // Color attributes don't have shift -- they store stride in the shift field.
    if (vtxAttrib === GX.VertexAttribute.CLR0) {
        stride = compShift;
        compShift = 0;
    }

    const numComponents = getComponentCountRaw(vtxAttrib, compCnt);
    const compSize = getComponentSizeRaw(compType);
    const compByteSize = numComponents * compSize;
    const dataByteSize = compByteSize * count;

    const data: ArrayBufferSlice = buffer.subarray(dataOffs, dataByteSize);
    return { name, id, compCnt, compType, compShift, stride, count, data };
}

interface InputVertexBuffers {
    pos: VtxBufferData[];
    nrm: VtxBufferData[];
    clr: VtxBufferData[];
    txc: VtxBufferData[];
}

function parseInputBufferSet(buffer: ArrayBufferSlice, vtxAttrib: GX.VertexAttribute, resDic: ResDicEntry[]): VtxBufferData[] {
    const vtxBuffers: VtxBufferData[] = [];
    for (let i = 0; i < resDic.length; i++) {
        const entry = resDic[i];
        const vtxBufferData = parseMDL0_VtxData(buffer.subarray(entry.offs), vtxAttrib);
        assert(vtxBufferData.name === entry.name);
        assert(vtxBufferData.id === i);
        vtxBuffers.push(vtxBufferData);
    }
    return vtxBuffers;
}

function parseInputVertexBuffers(buffer: ArrayBufferSlice, vtxPosResDic: ResDicEntry[], vtxNrmResDic: ResDicEntry[], vtxClrResDic: ResDicEntry[], vtxTxcResDic: ResDicEntry[]): InputVertexBuffers {
    const pos = parseInputBufferSet(buffer, GX.VertexAttribute.POS, vtxPosResDic);
    const nrm = parseInputBufferSet(buffer, GX.VertexAttribute.NRM, vtxNrmResDic);
    const clr = parseInputBufferSet(buffer, GX.VertexAttribute.CLR0, vtxClrResDic);
    const txc = parseInputBufferSet(buffer, GX.VertexAttribute.TEX0, vtxTxcResDic);
    return { pos, nrm, clr, txc };
}

export interface MDL0_ShapeEntry {
    name: string;
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
};

function parseMDL0_ShapeEntry(buffer: ArrayBufferSlice, inputBuffers: InputVertexBuffers): MDL0_ShapeEntry {
    const view = buffer.createDataView();

    const mtxIdx = view.getInt32(0x08);

    // These offsets are relative to the start of the structure.
    const prePrimDLSize = view.getUint32(0x18);
    const prePrimDLCmdSize = view.getUint32(0x1C);
    const prePrimDLOffs = 0x18 + view.getUint32(0x20);

    const primDLSize = view.getUint32(0x24);
    const primDLCmdSize = view.getUint32(0x28);
    const primDLOffs = 0x24 + view.getUint32(0x2C);

    const enum VcdFlags {
        PNMTXIDX   = 1 << 0,
        TEX0MTXIDX = 1 << 1,
        TEX1MTXIDX = 1 << 2,
        TEX2MTXIDX = 1 << 3,
        TEX3MTXIDX = 1 << 4,
        TEX4MTXIDX = 1 << 5,
        TEX5MTXIDX = 1 << 6,
        TEX6MTXIDX = 1 << 7,
        TEX7MTXIDX = 1 << 8,
        POS        = 1 << 9,
        NRM        = 1 << 10,
        CLR0       = 1 << 11,
        CLR1       = 1 << 12,
        TEX0       = 1 << 13,
        TEX1       = 1 << 14,
        TEX2       = 1 << 15,
        TEX3       = 1 << 16,
        TEX4       = 1 << 17,
        TEX5       = 1 << 18,
        TEX6       = 1 << 19,
        TEX7       = 1 << 20,
    }
    const vcdFlags: VcdFlags = view.getUint32(0x30);
    const flags = view.getUint32(0x34);
    const nameOffs = view.getUint32(0x38);
    const name = readString(buffer, nameOffs);
    const id = view.getUint32(0x3C);

    const numVertices = view.getUint32(0x40);
    const numPolygons = view.getUint32(0x44);

    const idVtxPos = view.getInt16(0x48);
    assert(idVtxPos >= 0);
    const idVtxNrm = view.getInt16(0x4A);
    const idVtxClr0 = view.getInt16(0x4C);
    const idVtxClr1 = view.getInt16(0x4E);
    const idVtxTxc0 = view.getInt16(0x50);
    const idVtxTxc1 = view.getInt16(0x52);
    const idVtxTxc2 = view.getInt16(0x54);
    const idVtxTxc3 = view.getInt16(0x56);
    const idVtxTxc4 = view.getInt16(0x58);
    const idVtxTxc5 = view.getInt16(0x5A);
    const idVtxTxc6 = view.getInt16(0x5C);
    const idVtxTxc7 = view.getInt16(0x5E);
    const idVtxFurVec = view.getInt16(0x60);
    const idVtxFurPos = view.getInt16(0x62);
    const mtxSetOffs = view.getUint32(0x64);

    // Run preprim. This should get us our VAT / VCD.
    const r = new DisplayListRegisters();
    runDisplayListRegisters(r, buffer.subarray(prePrimDLOffs, prePrimDLSize));

    // VCD. Describes primitive data.
    const vcdL = r.cp[GX.CPRegister.VCD_LO_ID];
    const vcdH = r.cp[GX.CPRegister.VCD_HI_ID];
    const vcd: GX_VtxDesc[] = [];

    vcd[GX.VertexAttribute.PNMTXIDX] =   { type: (vcdL >>>  0) & 0x01 };
    vcd[GX.VertexAttribute.TEX0MTXIDX] = { type: (vcdL >>>  1) & 0x01 };
    vcd[GX.VertexAttribute.TEX1MTXIDX] = { type: (vcdL >>>  2) & 0x01 };
    vcd[GX.VertexAttribute.TEX2MTXIDX] = { type: (vcdL >>>  3) & 0x01 };
    vcd[GX.VertexAttribute.TEX3MTXIDX] = { type: (vcdL >>>  4) & 0x01 };
    vcd[GX.VertexAttribute.TEX4MTXIDX] = { type: (vcdL >>>  5) & 0x01 };
    vcd[GX.VertexAttribute.TEX5MTXIDX] = { type: (vcdL >>>  6) & 0x01 };
    vcd[GX.VertexAttribute.TEX6MTXIDX] = { type: (vcdL >>>  7) & 0x01 };
    vcd[GX.VertexAttribute.TEX7MTXIDX] = { type: (vcdL >>>  8) & 0x01 };
    vcd[GX.VertexAttribute.POS] =        { type: (vcdL >>>  9) & 0x03 };
    vcd[GX.VertexAttribute.NRM] =        { type: (vcdL >>> 11) & 0x03 };
    vcd[GX.VertexAttribute.CLR0] =       { type: (vcdL >>> 13) & 0x03 };
    vcd[GX.VertexAttribute.CLR1] =       { type: (vcdL >>> 15) & 0x03 };
    vcd[GX.VertexAttribute.TEX0] =       { type: (vcdH >>>  0) & 0x03 };
    vcd[GX.VertexAttribute.TEX1] =       { type: (vcdH >>>  2) & 0x03 };
    vcd[GX.VertexAttribute.TEX2] =       { type: (vcdH >>>  4) & 0x03 };
    vcd[GX.VertexAttribute.TEX3] =       { type: (vcdH >>>  6) & 0x03 };
    vcd[GX.VertexAttribute.TEX4] =       { type: (vcdH >>>  8) & 0x03 };
    vcd[GX.VertexAttribute.TEX5] =       { type: (vcdH >>> 10) & 0x03 };
    vcd[GX.VertexAttribute.TEX6] =       { type: (vcdH >>> 12) & 0x03 };
    vcd[GX.VertexAttribute.TEX7] =       { type: (vcdH >>> 14) & 0x03 };

    // Validate against our VCD flags.
    for (let attr: GX.VertexAttribute = 0; attr <= GX.VertexAttribute.TEX7; attr++) {
        const vcdFlagsEnabled = !!(vcdFlags & (1 << attr));
        const vcdEnabled = !!(vcd[attr].type !== GX.AttrType.NONE);
        assert(vcdFlagsEnabled === vcdEnabled);
    }

    // VAT. Describes attribute formats.
    // BRRES always uses VTXFMT0.
    const vatA = r.cp[GX.CPRegister.VAT_A_ID + GX.VtxFmt.VTXFMT0];
    const vatB = r.cp[GX.CPRegister.VAT_B_ID + GX.VtxFmt.VTXFMT0];
    const vatC = r.cp[GX.CPRegister.VAT_C_ID + GX.VtxFmt.VTXFMT0];

    function vatFmt(compCnt: GX.CompCnt, compType: GX.CompType, compShift: number): GX_VtxAttrFmt {
        return { compCnt, compType, compShift };
    }

    const vat: GX_VtxAttrFmt[] = [];
    //                                        compCnt               compType              compShift
    vat[GX.VertexAttribute.POS]      = vatFmt((vatA >>>  0) & 0x01, (vatA >>>  1) & 0x07, (vatA >>>  4) & 0x1F);
    const nrm3 = !!(vatA >>> 31);
    const nrmCnt = nrm3 ? GX.CompCnt.NRM_NBT3:(vatA >>>  9) & 0x01;
    vat[GX.VertexAttribute.NRM]      = vatFmt(nrmCnt,               (vatA >>> 10) & 0x07, 0);
    vat[GX.VertexAttribute.CLR0]     = vatFmt((vatA >>> 13) & 0x01, (vatA >>> 14) & 0x07, 0);
    vat[GX.VertexAttribute.CLR1]     = vatFmt((vatA >>> 17) & 0x01, (vatA >>> 18) & 0x07, 0);
    vat[GX.VertexAttribute.TEX0]     = vatFmt((vatA >>> 21) & 0x01, (vatA >>> 22) & 0x07, (vatA >>> 25) & 0x1F);
    vat[GX.VertexAttribute.TEX1]     = vatFmt((vatB >>>  0) & 0x01, (vatB >>>  1) & 0x07, (vatB >>>  4) & 0x1F);
    vat[GX.VertexAttribute.TEX2]     = vatFmt((vatB >>>  9) & 0x01, (vatB >>> 10) & 0x07, (vatB >>> 13) & 0x1F);
    vat[GX.VertexAttribute.TEX3]     = vatFmt((vatB >>> 18) & 0x01, (vatB >>> 19) & 0x07, (vatB >>> 22) & 0x1F);
    vat[GX.VertexAttribute.TEX4]     = vatFmt((vatB >>> 27) & 0x01, (vatB >>> 28) & 0x07, (vatC >>>  0) & 0x1F);
    vat[GX.VertexAttribute.TEX5]     = vatFmt((vatC >>>  5) & 0x01, (vatC >>>  6) & 0x07, (vatC >>>  9) & 0x1F);
    vat[GX.VertexAttribute.TEX6]     = vatFmt((vatC >>> 14) & 0x01, (vatC >>> 15) & 0x07, (vatC >>> 18) & 0x1F);
    vat[GX.VertexAttribute.TEX7]     = vatFmt((vatC >>> 23) & 0x01, (vatC >>> 24) & 0x07, (vatC >>> 27) & 0x1F);

    const vtxArrays: GX_Array[] = [];
    assert(idVtxPos >= 0);
    if (idVtxPos >= 0)
        vtxArrays[GX.VertexAttribute.POS] = { buffer: inputBuffers.pos[idVtxPos].data, offs: 0 };
    if (idVtxNrm >= 0)
        vtxArrays[GX.VertexAttribute.NRM] = { buffer: inputBuffers.nrm[idVtxNrm].data, offs: 0 };
    if (idVtxClr0 >= 0)
        vtxArrays[GX.VertexAttribute.CLR0] = { buffer: inputBuffers.clr[idVtxClr0].data, offs: 0 };
    if (idVtxClr1 >= 0)
        vtxArrays[GX.VertexAttribute.CLR1] = { buffer: inputBuffers.clr[idVtxClr1].data, offs: 0 };
    if (idVtxTxc0 >= 0)
        vtxArrays[GX.VertexAttribute.TEX0] = { buffer: inputBuffers.txc[idVtxTxc0].data, offs: 0 };
    if (idVtxTxc1 >= 0)
        vtxArrays[GX.VertexAttribute.TEX1] = { buffer: inputBuffers.txc[idVtxTxc1].data, offs: 0 };
    if (idVtxTxc2 >= 0)
        vtxArrays[GX.VertexAttribute.TEX2] = { buffer: inputBuffers.txc[idVtxTxc2].data, offs: 0 };
    if (idVtxTxc3 >= 0)
        vtxArrays[GX.VertexAttribute.TEX3] = { buffer: inputBuffers.txc[idVtxTxc3].data, offs: 0 };
    if (idVtxTxc4 >= 0)
        vtxArrays[GX.VertexAttribute.TEX4] = { buffer: inputBuffers.txc[idVtxTxc4].data, offs: 0 };
    if (idVtxTxc5 >= 0)
        vtxArrays[GX.VertexAttribute.TEX5] = { buffer: inputBuffers.txc[idVtxTxc5].data, offs: 0 };
    if (idVtxTxc6 >= 0)
        vtxArrays[GX.VertexAttribute.TEX6] = { buffer: inputBuffers.txc[idVtxTxc6].data, offs: 0 };
    if (idVtxTxc7 >= 0)
        vtxArrays[GX.VertexAttribute.TEX7] = { buffer: inputBuffers.txc[idVtxTxc7].data, offs: 0 };

    const vtxLoader = compileVtxLoader(vat, vcd);
    const loadedVertexLayout = vtxLoader.loadedVertexLayout;
    const loadedVertexData = vtxLoader.runVertices(vtxArrays, buffer.subarray(primDLOffs, primDLSize));
    assert(loadedVertexData.totalVertexCount === numVertices);

    return { name, loadedVertexLayout, loadedVertexData };
}

const enum NodeFlags {
    SRT_IDENTITY = 0x01,
    TRANS_ZERO   = 0x02,
    ROT_ZERO     = 0x04,
    SCALE_ONE    = 0x08,
    SCALE_HOMO   = 0x10,
}

const enum BillboardMode {
    NONE = 0,
    BILLBOARD,
    PERSP_BILLBOARD,
    ROT,
    PERSP_ROT,
    Y,
    PERSP_Y,
}

interface MDL0_NodeEntry {
    name: string;
    id: number;
    mtxId: number;
    flags: NodeFlags;
    billboardMode: BillboardMode;
    modelMatrix: mat4;
}

function parseMDL0_NodeEntry(buffer: ArrayBufferSlice): MDL0_NodeEntry {
    const view = buffer.createDataView();
    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);

    const id = view.getUint32(0x0C);
    const mtxId = view.getUint32(0x10);
    const flags: NodeFlags = view.getUint32(0x14);
    const billboardMode: BillboardMode = view.getUint32(0x18);
    const bbrefNodeId = view.getUint32(0x1C);

    const scaleX = view.getFloat32(0x20);
    const scaleY = view.getFloat32(0x24);
    const scaleZ = view.getFloat32(0x28);
    const rotationX = view.getFloat32(0x2C);
    const rotationY = view.getFloat32(0x30);
    const rotationZ = view.getFloat32(0x34);
    const translationX = view.getFloat32(0x38);
    const translationY = view.getFloat32(0x3C);
    const translationZ = view.getFloat32(0x40);

    const scale = vec3.fromValues(scaleX, scaleY, scaleZ);
    const rotation = quat.create();
    quat.fromEuler(rotation, rotationX, rotationY, rotationZ);
    const translation = vec3.fromValues(translationX, translationY, translationZ);

    const modelMatrix = mat4.create();
    mat4.fromRotationTranslationScale(modelMatrix, rotation, translation, scale);

    return { name, id, mtxId, flags, billboardMode, modelMatrix };
}

export const enum ByteCodeOp {
    NOP = 0x00,
    RET = 0x01,
    NODEDESC = 0x02, // NodeID ParentMtxID
    NODEMIX = 0x03, // TODO
    DRAW = 0x04, // MatID ShpID NodeID
    EVPMTX = 0x05, // TODO
    MTXDUP = 0x06, // ToMtxID FromMtxID
};

export interface NodeDescOp {
    op: ByteCodeOp.NODEDESC;
    nodeId: number;
    parentMtxId: number;
}

export interface MtxDupOp {
    op: ByteCodeOp.MTXDUP;
    toMtxId: number;
    fromMtxId: number;
}

export type NodeTreeOp = NodeDescOp | MtxDupOp;

function parseMDL0_NodeTreeBytecode(buffer: ArrayBufferSlice): NodeTreeOp[] {
    const view = buffer.createDataView();

    const nodeTreeOps: NodeTreeOp[] = [];
    let i = 0;
    while (true) {
        const op: ByteCodeOp = view.getUint8(i);
        if (op === ByteCodeOp.RET) {
            break;
        } else if (op === ByteCodeOp.NODEDESC) {
            const nodeId = view.getUint16(i + 1);
            const parentMtxId = view.getUint16(i + 3);
            i += 5;
            nodeTreeOps.push({ op, nodeId, parentMtxId });
        } else if (op === ByteCodeOp.MTXDUP) {
            const toMtxId = view.getUint16(i + 1);
            const fromMtxId = view.getUint16(i + 3);
            i += 5;
            nodeTreeOps.push({ op, toMtxId, fromMtxId });
        } else {
            throw "whoops";
        }
    }
    return nodeTreeOps;
}

export interface DrawOp {
    matId: number;
    shpId: number;
    nodeId: number;
}

function parseMDL0_DrawBytecode(buffer: ArrayBufferSlice): DrawOp[] {
    const view = buffer.createDataView();

    const drawOps: DrawOp[] = [];
    let i = 0;
    while (true) {
        const op: ByteCodeOp = view.getUint8(i);
        if (op === ByteCodeOp.RET) {
            break;
        } else if (op === ByteCodeOp.DRAW) {
            const matId = view.getUint16(i + 1);
            const shpId = view.getUint16(i + 3);
            const nodeId = view.getUint16(i + 5);
            i += 8;
            drawOps.push({ matId, shpId, nodeId });
        } else {
            throw "whoops";
        }
    }
    return drawOps;
}

interface MDL0_SceneGraph {
    nodeTreeOps: NodeTreeOp[];
    drawOpaOps: DrawOp[];
    drawXluOps: DrawOp[];
}

function parseMDL0_SceneGraph(buffer: ArrayBufferSlice, byteCodeResDic: ResDicEntry[]): MDL0_SceneGraph {
    const nodeTreeResDicEntry = byteCodeResDic.find((entry) => entry.name === "NodeTree");
    assert(nodeTreeResDicEntry !== null);
    const nodeTreeBuffer = buffer.subarray(nodeTreeResDicEntry.offs);
    const nodeTreeOps = parseMDL0_NodeTreeBytecode(nodeTreeBuffer);

    let drawOpaOps: DrawOp[] = [];
    const drawOpaResDicEntry = byteCodeResDic.find((entry => entry.name === "DrawOpa"));
    if (drawOpaResDicEntry) {
        const drawOpaBuffer = buffer.subarray(drawOpaResDicEntry.offs);
        drawOpaOps = parseMDL0_DrawBytecode(drawOpaBuffer);
    }

    let drawXluOps: DrawOp[] = [];
    const drawXluResDicEntry = byteCodeResDic.find((entry => entry.name === "DrawXlu"));
    if (drawXluResDicEntry) {
        const drawXluBuffer = buffer.subarray(drawXluResDicEntry.offs);
        drawXluOps = parseMDL0_DrawBytecode(drawXluBuffer);
    }

    return { nodeTreeOps, drawOpaOps, drawXluOps };
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

    const materials: MDL0_MaterialEntry[] = [];
    for (const materialResDicEntry of materialResDic) {
        const material = parseMDL0_MaterialEntry(buffer.subarray(materialResDicEntry.offs));
        assert(material.name === materialResDicEntry.name);
        materials.push(material);
    }

    const inputBuffers = parseInputVertexBuffers(buffer, vtxPosResDic, vtxNrmResDic, vtxClrResDic, vtxTxcResDic);

    const shapes: MDL0_ShapeEntry[] = [];
    for (let i = 0; i < shpResDic.length; i++) {
        const shpResDicEntry = shpResDic[i];
        const shape = parseMDL0_ShapeEntry(buffer.subarray(shpResDicEntry.offs), inputBuffers);
        assert(shape.name === shpResDicEntry.name);
        shapes.push(shape);
    }

    const nodes: MDL0_NodeEntry[] = [];
    for (const nodeResDicEntry of nodeResDic) {
        const node = parseMDL0_NodeEntry(buffer.subarray(nodeResDicEntry.offs));
        assert(node.name === nodeResDicEntry.name);
        nodes.push(node);
    }

    const sceneGraph = parseMDL0_SceneGraph(buffer, byteCodeResDic);

    return { name, materials, shapes, nodes, sceneGraph };
}

export interface RRES {
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
        for (let i = 0; i < modelsResDic.length; i++) {
            const modelEntry = modelsResDic[i];
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
