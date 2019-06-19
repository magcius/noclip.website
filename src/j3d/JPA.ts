
// JParticle's JPAC2-10 resource file, as seen in Super Mario Galaxy, amongst other
// Nintendo games. JPAC1-00 is an older variant which is unsupported.

import ArrayBufferSlice from "../ArrayBufferSlice";
import * as GX from "../gx/gx_enum";

import { assert, readString, assertExists, nArray } from "../util";
import { BTI } from "./j3d";
import { vec3, mat4, vec2 } from "gl-matrix";
import { Endianness } from "../endian";
import { GfxDevice, GfxInputLayout, GfxInputState, GfxBuffer, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxBufferUsage } from "../gfx/platform/GfxPlatform";
import { BTIData } from "./render";
import { getPointHermite } from "../Spline";
import { GXMaterial, AlphaTest, RopInfo, TexGen, TevStage, getVertexAttribLocation, IndTexStage, getMaterialParamsBlockSize } from "../gx/gx_material";
import { Color, colorNew, colorCopy, colorNewCopy, White, colorFromRGBA8, colorLerp, colorMult, colorNewFromRGBA8 } from "../Color";
import { MaterialParams, ColorKind, ub_PacketParams, u_PacketParamsBufferSize, PacketParams, ub_MaterialParams, u_MaterialParamsBufferSize, setIndTexOrder, setIndTexCoordScale, setTevIndirect, setTevOrder, setTevColorIn, setTevColorOp, setTevAlphaIn, setTevAlphaOp, fillIndTexMtx, fillTextureMappingInfo } from "../gx/gx_render";
import { GXMaterialHelperGfx, GXRenderHelperGfx } from "../gx/gx_render_2";
import { computeModelMatrixSRT, computeModelMatrixR, lerp, MathConstants } from "../MathHelpers";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { makeSortKeyTranslucent, GfxRendererLayer } from "../gfx/render/GfxRenderer";
import { fillMatrix4x3, fillColor, fillMatrix4x2 } from "../gfx/helpers/UniformBufferHelpers";

export interface JPAResourceRaw {
    resourceId: number;
    data: ArrayBufferSlice;
}

export interface JPAC {
    effects: JPAResourceRaw[];
    textures: BTI[];
}

const enum JPAVolumeType {
    Cube     = 0x00,
    Sphere   = 0x01,
    Cylinder = 0x02,
    Torus    = 0x03,
    Point    = 0x04,
    Circle   = 0x05,
    Line     = 0x06,
}

export interface JPADynamicsBlock {
    flags: number;
    volumeType: JPAVolumeType;
    emitterScl: vec3;
    emitterTrs: vec3;
    emitterDir: vec3;
    initialVelOmni: number;
    initialVelAxis: number;
    initialVelRndm: number;
    initialVelDir: number;
    spread: number;
    initialVelRatio: number;
    rate: number;
    rateRndm: number;
    lifeTimeRndm: number;
    volumeSweep: number;
    volumeMinRad: number;
    airResist: number;
    moment: number;
    emitterRot: vec3;
    maxFrame: number;
    startFrame: number;
    lifeTime: number;
    volumeSize: number;
    divNumber: number;
    rateStep: number;
}

const enum ShapeType {
    Point            = 0x00,
    Line             = 0x01,
    Billboard        = 0x02,
    Direction        = 0x03,
    DirectionCross   = 0x04,
    Stripe           = 0x05,
    StripeCross      = 0x06,
    Rotation         = 0x07,
    RotationCross    = 0x08,
    DirBillboard     = 0x09,
    YBillboard       = 0x0A,
}

const enum DirType {
    Vel      = 0,
    Pos      = 1,
    PosInv   = 2,
    EmtrDir  = 3,
    PrevPctl = 4,
}

const enum RotType {
    Y   = 0,
    X   = 1,
    Z   = 2,
    XYZ = 3,
}

const enum PlaneType {
    XY = 0,
    XZ = 1,
    X  = 2,
}

interface CommonShapeTypeFields {
    shapeType: ShapeType;
}

export interface JPABaseShapeBlock {
    flags: number;
    shapeType: ShapeType;
    dirType: DirType;
    rotType: RotType;
    planeType: PlaneType;
    texIdx: number;
    texIdxAnimData: Uint8Array | null;
    texCrdMtxAnimData: Float32Array | null;
    blendModeFlags: number;
    zModeFlags: number;
    alphaCompareFlags: number;
    alphaRef0: number;
    alphaRef1: number;
    texFlags: number;
    colorFlags: number;
    colorPrm: Color;
    colorEnv: Color;
    globalScale2D: vec2;
    colorPrmAnimData: Color[] | null;
    colorEnvAnimData: Color[] | null;
    colorRegAnmMaxFrm: number;
    anmRndm: number;
    colorAnmRndmMask: number;
    texAnmRndmMask: number;
}

export interface JPAExtraShapeBlock {
    flags: number;
    scaleInTiming: number;
    scaleOutTiming: number;
    scaleInValueX: number;
    scaleOutValueX: number;
    scaleInValueY: number;
    scaleOutValueY: number;
    scaleOutRandom: number;
    scaleAnmMaxFrameX: number;
    scaleAnmMaxFrameY: number;
    scaleIncreaseRateX: number;
    scaleIncreaseRateY: number;
    scaleDecreaseRateX: number;
    scaleDecreaseRateY: number;
    alphaInTiming: number;
    alphaOutTiming: number;
    alphaInValue: number;
    alphaBaseValue: number;
    alphaOutValue: number;
    alphaIncreaseRate: number;
    alphaDecreaseRate: number;
    alphaWaveAmplitude: number;
    alphaWaveRandom: number;
    alphaWaveFrequency: number;
    rotateAngle: number;
    rotateAngleRandom: number;
    rotateSpeed: number;
    rotateSpeedRandom: number;
    rotateDirection: number;
}

export interface JPAExTexBlock {
    flags: number;
    indTextureMtx: Float32Array;
    indTextureIdx: number;
    secondTextureIdx: number;
}

export interface JPAChildShapeBlock {
    flags: number;
    shapeType: ShapeType;
    posRndm: number;
    baseVel: number;
    baseVelRndm: number;
    velInfRndm: number;
    gravity: number;
    globalScale2D: vec2;
    inheritScale: number;
    inheritAlpha: number;
    inheritRGB: number;
    colorPrm: Color;
    colorEnv: Color;
    timing: number;
    life: number;
    childrenCount: number;
    rate: number;
    texIdx: number;
    rotateSpeed: number;
}

const enum JPAFieldType {
    Gravity    = 0x00,
    Air        = 0x01,
    Magnet     = 0x02,
    Newton     = 0x03,
    Vortex     = 0x04,
    Random     = 0x05,
    Drag       = 0x06,
    Convection = 0x07,
    Spin       = 0x08,
}

const enum JPAFieldVelType {
    Unk00 = 0x00,
    Unk01 = 0x01,
    Unk02 = 0x02,
}

export interface JPAFieldBlock {
    flags: number;
    type: JPAFieldType;
    velType: JPAFieldVelType;
    pos: vec3;
    dir: vec3;
    param1: number;
    param2: number;
    param3: number;
    fadeIn: number;
    fadeOut: number;
    disTime: number;
    enTime: number;
    cycle: number;
    fadeInRate: number;
    fadeOutRate: number;
}

const enum JPAKeyType {
    Rate           = 0x00,
    VolumeSize     = 0x01,
    VolumeSweep    = 0x02,
    VolumeMinRad   = 0x03,
    LifeTime       = 0x04,
    Moment         = 0x05,
    InitialVelOmni = 0x06,
    InitialVelAxis = 0x07,
    InitialVelDir  = 0x08,
    Spread         = 0x09,
    Scale          = 0x0A,
}

export interface JPAKeyBlock {
    keyType: JPAKeyType;
    keyValues: Float32Array;
    isLoopEnable: boolean;
}

export interface JPAResource {
    bem1: JPADynamicsBlock;
    bsp1: JPABaseShapeBlock;
    esp1: JPAExtraShapeBlock | null;
    etx1: JPAExTexBlock | null;
    ssp1: JPAChildShapeBlock | null;
    fld1: JPAFieldBlock[];
    kfa1: JPAKeyBlock[];
    tdb1: Uint16Array;
}

const st_bm: GX.BlendMode[]   = [ GX.BlendMode.NONE, GX.BlendMode.BLEND, GX.BlendMode.LOGIC ];
const st_bf: GX.BlendFactor[] = [ GX.BlendFactor.ZERO, GX.BlendFactor.ONE, GX.BlendFactor.SRCCLR, GX.BlendFactor.INVSRCCLR, GX.BlendFactor.SRCCLR, GX.BlendFactor.INVSRCCLR, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.BlendFactor.DSTALPHA, GX.BlendFactor.INVDSTALPHA ];
const st_c: GX.CompareType[]  = [ GX.CompareType.NEVER, GX.CompareType.LESS, GX.CompareType.LEQUAL, GX.CompareType.EQUAL, GX.CompareType.NEQUAL, GX.CompareType.GEQUAL, GX.CompareType.GREATER, GX.CompareType.ALWAYS ];
const st_ao: GX.AlphaOp[]     = [ GX.AlphaOp.AND, GX.AlphaOp.OR, GX.AlphaOp.XOR, GX.AlphaOp.XNOR ];
const st_ca: GX.CombineColorInput[] = [
    GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.ONE,  GX.CombineColorInput.ZERO,
    GX.CombineColorInput.ZERO, GX.CombineColorInput.C0,   GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO,
    GX.CombineColorInput.C0,   GX.CombineColorInput.ONE,  GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO,
    GX.CombineColorInput.C1,   GX.CombineColorInput.C0,   GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO,
    GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.C0,   GX.CombineColorInput.C1  ,
    GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.C0  ,
];
const st_aa: GX.CombineAlphaInput[] = [
    GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.A0,   GX.CombineAlphaInput.ZERO,
    GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.A0  ,
];

const noIndTex = {
    // We don't use indtex.
    indTexStage: GX.IndTexStageID.STAGE0,
    indTexMatrix: GX.IndTexMtxID.OFF,
    indTexFormat: GX.IndTexFormat._8,
    indTexBiasSel: GX.IndTexBiasSel.NONE,
    indTexWrapS: GX.IndTexWrap.OFF,
    indTexWrapT: GX.IndTexWrap.OFF,
    indTexAddPrev: false,
    indTexUseOrigLOD: false,
};

const enum CalcIdxType {
    Normal  = 0x00,
    Repeat  = 0x01,
    Reverse = 0x02,
    Random  = 0x03,
    Merge   = 0x04,
}

const enum CalcScaleAnmType {
    Normal  = 0x00,
    Repeat  = 0x01,
    Reverse = 0x02,
}

export class JPAResourceData {
    public res: JPAResource;
    public name: string;
    public texData: BTIData[] = [];
    public materialHelper: GXMaterialHelperGfx;

    constructor(device: GfxDevice, private jpac: JPAC, resRaw: JPAResourceRaw) {
        this.res = parseResource(resRaw);

        const bsp1 = this.res.bsp1;
        const etx1 = this.res.etx1;
        const ssp1 = this.res.ssp1;

        // Translate all of the texture data.
        if (bsp1.texIdxAnimData !== null) {
            for (let i = 0; i < bsp1.texIdxAnimData.length; i++)
                this.translateTDB1Index(device, bsp1.texIdxAnimData[i]);
        } else {
            this.translateTDB1Index(device, bsp1.texIdx);
        }

        if (etx1 !== null) {
            if (!!(etx1.flags & 0x00000001))
                this.translateTDB1Index(device, etx1.indTextureIdx);

            if (!!(etx1.flags & 0x00000100))
                this.translateTDB1Index(device, etx1.secondTextureIdx);
        }

        if (ssp1 !== null)
            this.translateTDB1Index(device, ssp1.texIdx);

        const ropInfo: RopInfo = {
            blendMode: {
                type:      st_bm[(bsp1.blendModeFlags >>> 0) & 0x03],
                srcFactor: st_bf[(bsp1.blendModeFlags >>> 2) & 0x0F],
                dstFactor: st_bf[(bsp1.blendModeFlags >>> 6) & 0x0F],
                logicOp: GX.LogicOp.CLEAR,
            },

            depthTest: !!((bsp1.zModeFlags >>> 0) & 0x01),
            depthFunc: st_c[(bsp1.zModeFlags >>> 1) & 0x07],
            depthWrite: !!((bsp1.zModeFlags >>> 4) & 0x01),
        };

        const alphaTest: AlphaTest = {
            compareA: st_c [(bsp1.alphaCompareFlags >>> 0) & 0x07],
            referenceA: bsp1.alphaRef0,
            op:       st_ao[(bsp1.alphaCompareFlags >>> 3) & 0x03],
            compareB: st_c [(bsp1.alphaCompareFlags >>> 5) & 0x07],
            referenceB: bsp1.alphaRef1,
        };

        const texGens: TexGen[] = [];
        if (!!(bsp1.flags & 0x00100000))
            texGens.push({ index: 0, type: GX.TexGenType.MTX3x4, source: GX.TexGenSrc.POS,  matrix: GX.TexGenMatrix.TEXMTX0, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });
        else if (!!(bsp1.flags & 0x01000000))
            texGens.push({ index: 0, type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX0, matrix: GX.TexGenMatrix.TEXMTX0, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });
        else
            texGens.push({ index: 0, type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX0, matrix: GX.TexGenMatrix.IDENTITY, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });

        let texCoord3Id = GX.TexCoordID.TEXCOORD1;
        if (etx1 !== null) {
            if (!!(etx1.flags & 0x00000001)) {
                texGens.push({ index: 1, type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX0, matrix: GX.TexGenMatrix.IDENTITY, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });
                texCoord3Id = GX.TexCoordID.TEXCOORD2;
            }

            if (!!(etx1.flags & 0x00000100)) {
                texGens.push({ index: texCoord3Id, type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX0, matrix: GX.TexGenMatrix.IDENTITY, normalize: false, postMatrix: GX.PostTexGenMatrix.PTIDENTITY });
            }
        }

        const tevStages: TevStage[] = [];
        const colorInSelect = (bsp1.flags >>> 0x0F) & 0x07;
        const alphaInSelect = (bsp1.flags >>> 0x12) & 0x01;

        tevStages.push({
            index: 0,

            texCoordId: GX.TexCoordID.TEXCOORD0,
            texMap: GX.TexMapID.TEXMAP0,
            channelId: GX.RasColorChannelID.COLOR_ZERO,
            konstColorSel: GX.KonstColorSel.KCSEL_1,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

            // GXSetTevColorIn(0) is called in JPABaseShape::setGX()
            colorInA: st_ca[colorInSelect * 4 + 0],
            colorInB: st_ca[colorInSelect * 4 + 1],
            colorInC: st_ca[colorInSelect * 4 + 2],
            colorInD: st_ca[colorInSelect * 4 + 3],

            // GXSetTevAlphaIn(0) is called in JPABaseShape::setGX()
            alphaInA: st_aa[alphaInSelect * 4 + 0],
            alphaInB: st_aa[alphaInSelect * 4 + 1],
            alphaInC: st_aa[alphaInSelect * 4 + 2],
            alphaInD: st_aa[alphaInSelect * 4 + 3],

            // GXSetTevColorOp(0) is called in JPAEmitterManager::draw()
            ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
            ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

            // GXSetTevDirect(0) is called in JPABaseShape::setGX()
            ... noIndTex,
        });

        const indTexStages: IndTexStage[] = [];

        // ESP properties are read in JPAResource::setPTev()
        if (etx1 !== null) {
            if (!!(etx1.flags & 0x00000001)) {
                // Indirect.
                indTexStages.push({
                    index: GX.IndTexStageID.STAGE0,
                    ... setIndTexOrder(GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP2),
                    ... setIndTexCoordScale(GX.IndTexScale._1, GX.IndTexScale._1),
                });
                // Add the indirect stage to our TEV.
                Object.assign(tevStages[0], setTevIndirect(GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF));
            }

            if (!!(etx1.flags & 0x00000100)) {
                // GX
                // GXSetTevOrder(1, uVar10)
                tevStages.push({
                    index: 1,
                    ... setTevOrder(texCoord3Id, GX.TexMapID.TEXMAP3, GX.RasColorChannelID.COLOR_ZERO),
                    ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.CPREV, GX.CombineColorInput.ZERO),
                    ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.ZERO),
                    ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                    ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                    konstColorSel: GX.KonstColorSel.KCSEL_1,
                    konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
                    ... noIndTex,
                });
            }
        }

        // Translate the material.
        const gxMaterial: GXMaterial = {
            index: 0,
            name: 'JPA Material',
            // JPAEmitterManager::draw() calls GXSetCullMode(GX_CULL_NONE)
            cullMode: GX.CullMode.NONE,
            // JPAEmitterManager::draw() calls GXSetNumChans(0)
            lightChannels: [],
            texGens,
            tevStages,
            indTexStages,
            alphaTest,
            ropInfo,
            usePnMtxIdx: false,
            useTexMtxIdx: [],
            hasLightsBlock: false,
            hasPostTexMtxBlock: false,
        };

        this.materialHelper = new GXMaterialHelperGfx(gxMaterial);
    }

    private translateTDB1Index(device: GfxDevice, idx: number): void {
        const timg = this.jpac.textures[this.res.tdb1[idx]].texture;
        this.texData[idx] = new BTIData(device, timg);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.texData.length; i++)
            if (this.texData[i] !== undefined)
                this.texData[i].destroy(device);
        this.materialHelper.destroy(device);
    }
}

function hermiteInterpolate(k: Float32Array, i1: number, tn: number): number {
    const k0Idx = i1 - 4;
    const k1Idx = i1;
    const t0 = k[k0Idx + 0];
    const t1 = k[k1Idx + 0];
    const length = t1 - t0;
    const t = (tn - t0) / length;
    const p0 = k[k0Idx + 1];
    const p1 = k[k1Idx + 1];
    const s0 = k[k0Idx + 3] * length;
    const s1 = k[k1Idx + 2] * length;
    return getPointHermite(p0, p1, s0, s1, t);
}

function kfa1Findi1(kfa1: JPAKeyBlock, t: number): number {
    for (let i = 0; i < kfa1.keyValues.length; i += 4) {
        const kt = kfa1.keyValues[i + 0];
        // Find the first frame that's past us -- that's our i1.
        if (kt > t)
            return i;
    }
    return kfa1.keyValues.length - 4;
}

function kfa1Calc(kfa1: JPAKeyBlock, tick: number): number {
    if (kfa1.isLoopEnable) {
        const tickMax = kfa1.keyValues[kfa1.keyValues.length - 4];
        tick = tick % tickMax;
    }

    const i1 = kfa1Findi1(kfa1, tick);
    if (i1 === 0 || i1 >= kfa1.keyValues.length - 4)
        return kfa1.keyValues[i1 + 1];
    else
        return hermiteInterpolate(kfa1.keyValues, i1, tick);
}

interface JPARandom {
    state: number;
}

function new_rndm(): JPARandom {
    return { state: 0 };
}

function copy_rndm(dst: JPARandom, src: JPARandom): void {
    dst.state = src.state;
}

function next_rndm(random: JPARandom): number {
    // Numerical Recipes in C
    random.state = (random.state * 0x19660d + 0x3c6ef35f) >>> 0;
    return random.state;
}

// Return a random number between 0 and 1.
function get_rndm_f(random: JPARandom): number {
    return next_rndm(random) / 0xFFFFFFFF;
}

// Return a random number between -1 and 1.
function get_r_zp(random: JPARandom): number {
    return get_rndm_f(random) * 2 - 1;
}

// Return a random number between -0.5 and 0.5.
function get_r_zh(random: JPARandom): number {
    return get_rndm_f(random) - 0.5;
}

// Return a random number between 0 and 0xFFFF.
function get_r_ss(random: JPARandom): number {
    return (next_rndm(random) >>> 0x10) & 0xFFFF;
}

class JPAEmitterWorkData {
    public emitterManager: JPAEmitterManager;
    public baseEmitter: JPABaseEmitter;
    public random: JPARandom = new_rndm();

    public volumePos = vec3.create();
    public velOmni = vec3.create();
    public velAxis = vec3.create();
    public volumeSize: number;
    public volumeMinRad: number;
    public volumeSweep: number;
    public volumeEmitIdx: number;
    public volumeEmitCount: number;
    public divNumber: number;

    public emitterTrs = vec3.create();
    public emitterDirMtx = mat4.create();
    public emitterGlobalRot = mat4.create();
    public emitterGlobalSR = mat4.create();
    public emitterGlobalScl = vec3.create();
    public emitterGlobalDir = vec3.create();
    public emitterGlobalSRT = vec3.create();
    public globalRotation = mat4.create();
    public globalScale = vec3.create();
    public globalScale2D = vec2.create();

    public ybbCamMtx = mat4.create();
    public posCamMtx = mat4.create();
    public prjMtx = mat4.create();
    public texPrjMtx = mat4.create();
    public deltaTime: number = 0;
}

class JPAGlobalRes {
    public inputLayout: GfxInputLayout;
    public inputStateBillboard: GfxInputState;

    private vertexBufferBillboard: GfxBuffer;
    private indexBufferBillboard: GfxBuffer;

    constructor(device: GfxDevice) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: getVertexAttribLocation(GX.VertexAttribute.POS), format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: getVertexAttribLocation(GX.VertexAttribute.TEX0), format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 3*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
        });

        const x0 = -25;
        const x1 =  25;

        this.vertexBufferBillboard = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Float32Array([
            x0, x0, 0, 1, 1,
            x1, x0, 0, 0, 1,
            x0, x1, 0, 1, 0,
            x1, x1, 0, 0, 0,
        ]).buffer);
        this.indexBufferBillboard = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, new Uint16Array([
            0, 1, 2, 2, 1, 3,
        ]).buffer);

        this.inputStateBillboard = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBufferBillboard, byteOffset: 0, byteStride: 3*4+2*4 },
        ], { buffer: this.indexBufferBillboard, byteOffset: 0, byteStride: 2 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputStateBillboard);
        device.destroyBuffer(this.vertexBufferBillboard);
        device.destroyBuffer(this.indexBufferBillboard);
    }
}

export class JPADrawInfo {
    public posCamMtx: mat4;
    public prjMtx: mat4;
    public texPrjMtx: mat4 | null;
}

export class JPAEmitterManager {
    public workData = new JPAEmitterWorkData();
    public deadParticlePool: JPABaseParticle[] = [];
    public deadEmitterPool: JPABaseEmitter[] = [];
    public aliveEmitters: JPABaseEmitter[] = [];
    public globalRes: JPAGlobalRes;

    constructor(device: GfxDevice, private maxParticleCount: number, private maxEmitterCount: number) {
        this.workData.emitterManager = this;

        for (let i = 0; i < this.maxEmitterCount; i++)
            this.deadEmitterPool.push(new JPABaseEmitter(this));
        for (let i = 0; i < this.maxParticleCount; i++)
            this.deadParticlePool.push(new JPABaseParticle());

        this.globalRes = new JPAGlobalRes(device);
    }

    public createEmitter(resData: JPAResourceData): JPABaseEmitter | null {
        if (this.deadEmitterPool.length === 0)
            return null;

        const emitter = this.deadEmitterPool.pop();
        emitter.init(resData);
        assert(emitter.aliveParticlesBase.length === 0);
        this.aliveEmitters.push(emitter);
        return emitter;
    }

    public forceDeleteEmitter(emitter: JPABaseEmitter): void {
        emitter.deleteAllParticle();
        emitter.flags |= BaseEmitterFlags.TERMINATE | BaseEmitterFlags.TERMINATE_FLAGGED;
        const i = this.aliveEmitters.indexOf(emitter);
        assert(i >= 0);
        this.aliveEmitters.splice(i, 1);
        this.deadEmitterPool.push(emitter);
    }

    public calc(deltaTime: number): void {
        // Clamp deltaTime to something reasonable so we don't get a combinatorial
        // explosion of particles at scene load...
        this.workData.deltaTime = Math.min(deltaTime, 1.5);

        for (let i = 0; i < this.aliveEmitters.length; i++) {
            const emitter = this.aliveEmitters[i];
            const alive = emitter.calc(this.workData);

            if (!alive && (emitter.flags & BaseEmitterFlags.TERMINATE_FLAGGED) === 0) {
                emitter.deleteAllParticle();
                emitter.flags |= BaseEmitterFlags.TERMINATE | BaseEmitterFlags.TERMINATE_FLAGGED;
                this.aliveEmitters.splice(i, 1);
                this.deadEmitterPool.push(emitter);
                i--;
            }
        }
    }

    public draw(device: GfxDevice, renderHelper: GXRenderHelperGfx, drawInfo: JPADrawInfo, drawGroupId: number): void {
        mat4.copy(this.workData.posCamMtx, drawInfo.posCamMtx);
        mat4.copy(this.workData.prjMtx, drawInfo.prjMtx);
        if (drawInfo.texPrjMtx !== null)
            mat4.copy(this.workData.texPrjMtx, drawInfo.texPrjMtx);
        else
            mat4.identity(this.workData.texPrjMtx);

        for (let i = 0; i < this.aliveEmitters.length; i++) {
            const emitter = this.aliveEmitters[i];
            if (emitter.drawGroupId === drawGroupId)
                this.aliveEmitters[i].draw(device, renderHelper, this.workData);
        }
    }

    public destroy(device: GfxDevice): void {
        this.globalRes.destroy(device);
    }
}

export const enum BaseEmitterFlags {
    STOP_EMIT_PARTICLES = 0x0001,
    STOP_CALC_EMITTER   = 0x0002,
    STOP_DRAW_PARTICLE  = 0x0004,
    TERMINATED          = 0x0008,
    FIRST_EMISSION      = 0x0010,
    RATE_STEP_EMIT      = 0x0020,
    DO_NOT_TERMINATE    = 0x0040,
    TERMINATE           = 0x0100,
    TERMINATE_FLAGGED   = 0x0200,
}

function JPAGetXYZRotateMtx(m: mat4, v: vec3): void {
    const v0 = Math.PI * v[0];
    const v1 = Math.PI * v[1];
    const v2 = Math.PI * v[2];
    computeModelMatrixR(m, v0, v1, v2);
}

function JPAGetDirMtx(m: mat4, v: vec3, scratch: vec3 = scratchVec3a): void {
    // Perp
    vec3.set(scratch, v[1], -v[0], 0);
    const mag = vec3.length(scratch);
    vec3.normalize(scratch, scratch);

    const x = scratch[0], y = scratch[1], z = v[2];
    m[0]  = x*x + z * (1.0 - x*x);
    m[4]  = (1.0 - z) * (x * y);
    m[8]  = -y*mag;
    m[12] = 0.0;

    m[1]  = (1.0 - z) * (x * y);
    m[5]  = y*y + z * (1.0 - y*y);
    m[9]  = x*mag;
    m[13] = 0.0;

    m[2]  = y*mag;
    m[6]  = -x*mag;
    m[10] = z;
    m[14] = 0.0;
}

export function JPASetRMtxSTVecFromMtx(scale: vec3, rot: mat4, trans: vec3, m: mat4): void {
    // Extract our three column vectors.
    mat4.identity(rot);

    scale[0] = Math.hypot(m[0], m[1], m[2]);
    scale[1] = Math.hypot(m[4], m[5], m[6]);
    scale[2] = Math.hypot(m[8], m[9], m[10]);

    if (scale[0] !== 0) {
        const d = 1 / scale[0];
        rot[0] = m[0] * d;
        rot[1] = m[1] * d;
        rot[2] = m[2] * d;
    }

    if (scale[1] !== 0) {
        const d = 1 / scale[1];
        rot[4] = m[4] * d;
        rot[5] = m[5] * d;
        rot[6] = m[6] * d;
    }

    if (scale[2] !== 0) {
        const d = 1 / scale[2];
        rot[8] = m[8] * d;
        rot[9] = m[9] * d;
        rot[10] = m[10] * d;
    }

    trans[0] = m[12];
    trans[1] = m[13];
    trans[2] = m[14];
}

function mirroredRepeat(t: number, duration: number): number {
    // Which loop are we on?
    const loopNum = (t / duration) | 0;
    const phase = t - loopNum * duration;

    // On odd iterations, we reverse.
    if ((loopNum % 2) === 1)
        return duration - phase;
    else
        return phase;
}

function calcTexIdx(workData: JPAEmitterWorkData, tick: number, time: number, randomPhase: number): number {
    const bsp1 = workData.baseEmitter.resData.res.bsp1;

    const texHasAnm = !!(bsp1.texFlags & 0x01);
    if (!texHasAnm)
        return bsp1.texIdx;

    const calcTexIdxType: CalcIdxType = (bsp1.texFlags >>> 2) & 0x07;
    let anmIdx: number;
    if (calcTexIdxType === CalcIdxType.Normal) {
        anmIdx = Math.min(bsp1.texIdxAnimData.length - 1, tick);
    } else if (calcTexIdxType === CalcIdxType.Repeat) {
        anmIdx = ((tick | 0) + randomPhase) % bsp1.texIdxAnimData.length;
    } else if (calcTexIdxType === CalcIdxType.Reverse) {
        anmIdx = mirroredRepeat((tick | 0) + randomPhase, bsp1.texIdxAnimData.length - 1);
    } else if (calcTexIdxType === CalcIdxType.Random) {
        anmIdx = randomPhase % bsp1.colorRegAnmMaxFrm;
    } else if (calcTexIdxType === CalcIdxType.Merge) {
        anmIdx = ((time | 0) + randomPhase) % bsp1.texIdxAnimData.length;
    } else {
        throw "whoops";
    }

    return bsp1.texIdxAnimData[anmIdx];
}

function calcColor(dstPrm: Color, dstEnv: Color, workData: JPAEmitterWorkData, tick: number, time: number, randomPhase: number): void {
    const bsp1 = workData.baseEmitter.resData.res.bsp1;

    const calcColorIdxType: CalcIdxType = (bsp1.colorFlags >>> 4) & 0x07;
    let anmIdx = 0;
    if (calcColorIdxType === CalcIdxType.Normal) {
        anmIdx = Math.min(bsp1.colorRegAnmMaxFrm, tick);
    } else if (calcColorIdxType === CalcIdxType.Repeat) {
        anmIdx = ((tick | 0) + randomPhase) % (bsp1.colorRegAnmMaxFrm + 1);
    } else if (calcColorIdxType === CalcIdxType.Reverse) {
        anmIdx = mirroredRepeat((tick | 0) + randomPhase, bsp1.colorRegAnmMaxFrm);
    } else if (calcColorIdxType === CalcIdxType.Random) {
        anmIdx = randomPhase % (bsp1.colorRegAnmMaxFrm + 1);
    } else if (calcColorIdxType === CalcIdxType.Merge) {
        anmIdx = ((time | 0) + randomPhase) % (bsp1.colorRegAnmMaxFrm + 1);
    } else {
        throw "whoops";
    }

    const calcPrmColor = !!(bsp1.colorFlags & 0x02);
    const calcEnvColor = !!(bsp1.colorFlags & 0x08);

    if (calcPrmColor)
        colorCopy(dstPrm, bsp1.colorPrmAnimData[anmIdx]);
    if (calcEnvColor)
        colorCopy(dstEnv, bsp1.colorEnvAnimData[anmIdx]);
}

const materialParams = new MaterialParams();
const packetParams = new PacketParams();
export class JPABaseEmitter {
    public flags: BaseEmitterFlags;
    public resData: JPAResourceData;
    public emitterScl = vec3.create();
    public emitterTrs = vec3.create();
    public emitterDir = vec3.create();
    public emitterRot = vec3.create();
    public maxFrame: number;
    public lifeTime: number;
    private rate: number;
    private volumeSize: number;
    private volumeMinRad: number;
    private volumeSweep: number;
    public initialVelOmni: number;
    public initialVelAxis: number;
    public initialVelDir: number;
    public initialVelRndm: number;
    public spread: number;
    public waitTime: number;
    public tick: number;
    public scaleOut: number;
    public texAnmIdx: number;
    public emitCount: number;
    public random: JPARandom = new_rndm();
    public rateStepTimer: number;
    public colorPrm: Color = colorNewCopy(White);
    public colorEnv: Color = colorNewCopy(White);
    public userData: any = null;

    public globalColorPrm: Color = colorNewCopy(White);
    public globalColorEnv: Color = colorNewCopy(White);

    // These are the public APIs to affect an emitter's placement.
    public globalRotation = mat4.create();
    public globalScale = vec3.create();
    public globalTranslation = vec3.create();
    public globalScale2D = vec2.create();

    public aliveParticlesBase: JPABaseParticle[] = [];
    public aliveParticlesChild: JPABaseParticle[] = [];
    public drawGroupId: number = 0;

    constructor(private emitterManager: JPAEmitterManager) {
    }

    public setGlobalScale(s: vec3): void {
        vec3.copy(this.globalScale, s);
        this.globalScale2D[0] = s[0];
        this.globalScale2D[1] = s[1];
    }

    public setDrawParticle(v: boolean): void {
        const stopDraw = !v;
        if (stopDraw)
            this.flags |= BaseEmitterFlags.STOP_DRAW_PARTICLE;
        else
            this.flags &= ~BaseEmitterFlags.STOP_DRAW_PARTICLE;
    }

    public getDrawParticle(): boolean {
        return !(this.flags & BaseEmitterFlags.STOP_DRAW_PARTICLE);
    }

    public init(resData: JPAResourceData): void {
        this.resData = resData;
        const bem1 = this.resData.res.bem1;
        const bsp1 = this.resData.res.bsp1;
        vec3.copy(this.emitterScl, bem1.emitterScl);
        vec3.copy(this.emitterTrs, bem1.emitterTrs);
        vec3.copy(this.emitterDir, bem1.emitterDir);
        vec3.copy(this.emitterRot, bem1.emitterRot);
        this.maxFrame = bem1.maxFrame;
        this.lifeTime = bem1.lifeTime;
        this.rate = bem1.rate;
        this.volumeSize = bem1.volumeSize;
        this.volumeMinRad = bem1.volumeMinRad;
        this.volumeSweep = bem1.volumeSweep;
        this.initialVelOmni = bem1.initialVelOmni;
        this.initialVelAxis = bem1.initialVelAxis;
        this.initialVelDir = bem1.initialVelDir;
        this.spread = bem1.spread;
        this.initialVelRndm = bem1.initialVelRndm;
        // Spin the random machine and copy the state.
        next_rndm(this.emitterManager.workData.random);
        copy_rndm(this.random, this.emitterManager.workData.random);
        mat4.identity(this.globalRotation);
        vec3.set(this.globalScale, 1, 1, 1);
        vec3.set(this.globalTranslation, 0, 0, 0);
        vec2.set(this.globalScale2D, 1, 1);
        colorCopy(this.globalColorPrm, White);
        colorCopy(this.globalColorEnv, White);
        colorCopy(this.colorPrm, bsp1.colorPrm);
        colorCopy(this.colorEnv, bsp1.colorEnv);
        this.scaleOut = 1;
        this.emitCount = 0;
        this.waitTime = 0;
        this.tick = 0;
        this.rateStepTimer = 0;
        this.texAnmIdx = 0;
        this.flags = BaseEmitterFlags.FIRST_EMISSION | BaseEmitterFlags.RATE_STEP_EMIT;
    }

    public deleteAllParticle(): void {
        for (let i = 0; i < this.aliveParticlesBase.length; i++)
            this.emitterManager.deadParticlePool.push(this.aliveParticlesBase[i]);
        this.aliveParticlesBase.length = 0;
        for (let i = 0; i < this.aliveParticlesChild.length; i++)
            this.emitterManager.deadParticlePool.push(this.aliveParticlesChild[i]);
        this.aliveParticlesChild.length = 0;
    }

    public createChild(parent: JPABaseParticle): void {
        if (this.emitterManager.deadParticlePool.length === 0)
            return null;

        const particle = this.emitterManager.deadParticlePool.pop();
        this.aliveParticlesChild.push(particle);
        particle.init_c(this.emitterManager.workData, parent);
    }

    private calcKey(): void {
        for (let i = 0; i < this.resData.res.kfa1.length; i++) {
            const kfa1 = this.resData.res.kfa1[i];
            const v = kfa1Calc(kfa1, this.tick);
            if (kfa1.keyType === JPAKeyType.Rate)
                this.rate = v;
            else if (kfa1.keyType === JPAKeyType.VolumeSize)
                this.volumeSize = v;
            else if (kfa1.keyType === JPAKeyType.VolumeSweep)
                throw "whoops"; // Was removed from JPA2.
            else if (kfa1.keyType === JPAKeyType.VolumeMinRad)
                this.volumeMinRad = v;
            else if (kfa1.keyType === JPAKeyType.LifeTime)
                this.lifeTime = v;
            else if (kfa1.keyType === JPAKeyType.Moment)
                throw "whoops"; // Was removed from JPA2.
            else if (kfa1.keyType === JPAKeyType.InitialVelOmni)
                this.initialVelOmni = v;
            else if (kfa1.keyType === JPAKeyType.InitialVelAxis)
                this.initialVelAxis = v;
            else if (kfa1.keyType === JPAKeyType.InitialVelDir)
                this.initialVelDir = v;
            else if (kfa1.keyType === JPAKeyType.Spread)
                this.spread = v;
            else if (kfa1.keyType === JPAKeyType.Scale)
                this.scaleOut = v;
            else
                throw "whoops";
        }
    }

    private calcVolumeCube(workData: JPAEmitterWorkData): void {
        const rndX = get_rndm_f(this.random) - 0.5;
        const rndY = get_rndm_f(this.random) - 0.5;
        const rndZ = get_rndm_f(this.random) - 0.5;
        vec3.set(workData.volumePos, rndX * this.volumeSize, rndY * this.volumeSize, rndZ * this.volumeSize);
        vec3.mul(workData.velOmni, workData.volumePos, workData.emitterGlobalScl);
        vec3.set(workData.velAxis, workData.volumePos[0], 0.0, workData.volumePos[2]);
    }

    private calcVolumeSphere(workData: JPAEmitterWorkData): void {
        const bem1 = workData.baseEmitter.resData.res.bem1;

        let angle: number, x: number;
        if (!!(bem1.flags & 0x02)) {
            // Fixed interval
            throw "whoops";
        } else {
            angle = workData.volumeSweep * get_rndm_f(this.random) * MathConstants.TAU;
            x = (Math.PI * 0.5) + (get_rndm_f(this.random) * Math.PI);
        }

        let distance = get_rndm_f(this.random);
        if (!!(bem1.flags & 0x01)) {
            // Fixed density
            distance = 1.0 - (distance * distance * distance);
        }

        const size = workData.volumeSize * lerp(workData.volumeMinRad, 1.0, distance);
        vec3.set(workData.volumePos,
            size * Math.cos(x) * Math.sin(angle),
            size * Math.sin(x),
            size * Math.cos(x) * Math.cos(angle),
        );
        vec3.mul(workData.velOmni, workData.volumePos, workData.emitterGlobalScl);
        vec3.set(workData.velAxis, workData.volumePos[0], 0, workData.volumePos[2]);
    }

    private calcVolumeCylinder(workData: JPAEmitterWorkData): void {
        const bem1 = workData.baseEmitter.resData.res.bem1;

        let distance = get_rndm_f(this.random);
        if (!!(bem1.flags & 0x01)) {
            // Fixed density
            distance = 1.0 - (distance * distance);
        }

        const sizeXZ = workData.volumeSize * lerp(workData.volumeMinRad, 1.0, distance);
        let angle = (workData.volumeSweep * get_rndm_f(this.random)) * MathConstants.TAU;
        // TODO(jstpierre): Why do we need this? Something's fishy in Beach Bowl Galaxy...
        // VolumeSweep is 0.74 but it doesn't look like it goes 3/4ths of the way around...
        angle -= Math.PI / 2;
        const height = workData.volumeSize * get_r_zp(this.random);
        vec3.set(workData.volumePos, sizeXZ * Math.sin(angle), height, sizeXZ * Math.cos(angle));
        vec3.mul(workData.velOmni, workData.volumePos, workData.emitterGlobalScl);
        vec3.set(workData.velAxis, workData.volumePos[0], 0, workData.volumePos[2]);
    }

    private calcVolumeTorus(workData: JPAEmitterWorkData): void {
        throw "whoops";
    }

    private calcVolumePoint(workData: JPAEmitterWorkData): void {
        vec3.set(workData.volumePos, 0, 0, 0);
        const rndX = get_rndm_f(this.random) - 0.5;
        const rndY = get_rndm_f(this.random) - 0.5;
        const rndZ = get_rndm_f(this.random) - 0.5;
        vec3.set(workData.velOmni, rndX, rndY, rndZ);
        vec3.set(workData.velAxis, workData.velOmni[0], 0.0, workData.velOmni[2]);
    }

    private calcVolumeCircle(workData: JPAEmitterWorkData): void {
        const bem1 = this.resData.res.bem1;

        let angle: number;
        if (!!(bem1.flags & 0x02)) {
            // Fixed interval
            const idx = workData.volumeEmitIdx++;
            angle = workData.volumeSweep * (idx / workData.volumeEmitCount) * MathConstants.TAU;
        } else {
            angle = workData.volumeSweep * get_rndm_f(this.random) * MathConstants.TAU;
        }

        let distance = get_rndm_f(this.random);
        if (!!(bem1.flags & 0x01)) {
            // Fixed density
            distance = 1.0 - (distance * distance);
        }

        const sizeXZ = workData.volumeSize * lerp(workData.volumeMinRad, 1.0, distance);
        vec3.set(workData.volumePos, sizeXZ * Math.sin(angle), 0, sizeXZ * Math.cos(angle));
        vec3.mul(workData.velOmni, workData.volumePos, workData.emitterGlobalScl);
        vec3.set(workData.velAxis, workData.volumePos[0], 0, workData.volumePos[2]);
    }

    private calcVolumeLine(workData: JPAEmitterWorkData): void {
        throw "whoops";
    }

    private calcVolume(workData: JPAEmitterWorkData): void {
        const bem1 = this.resData.res.bem1;

        if (bem1.volumeType === JPAVolumeType.Cube)
            this.calcVolumeCube(workData);
        else if (bem1.volumeType === JPAVolumeType.Sphere)
            this.calcVolumeSphere(workData);
        else if (bem1.volumeType === JPAVolumeType.Cylinder)
            this.calcVolumeCylinder(workData);
        else if (bem1.volumeType === JPAVolumeType.Torus)
            this.calcVolumeTorus(workData);
        else if (bem1.volumeType === JPAVolumeType.Point)
            this.calcVolumePoint(workData);
        else if (bem1.volumeType === JPAVolumeType.Circle)
            this.calcVolumeCircle(workData);
        else if (bem1.volumeType === JPAVolumeType.Line)
            this.calcVolumeLine(workData);
        else
            throw "whoops";
    }

    private createParticle(): JPABaseParticle | null {
        if (this.emitterManager.deadParticlePool.length === 0)
            return null;

        const particle = this.emitterManager.deadParticlePool.pop();
        this.aliveParticlesBase.push(particle);
        this.calcVolume(this.emitterManager.workData);
        particle.init_p(this.emitterManager.workData);
        return particle;
    }

    private create(): void {
        const workData = this.emitterManager.workData;

        // JPADynamicsBlock::create()

        const bem1 = this.resData.res.bem1;

        if (!!(this.flags & BaseEmitterFlags.RATE_STEP_EMIT)) {
            if (!!(bem1.flags & 0x02)) {
                // Fixed Interval
                if (bem1.volumeType === JPAVolumeType.Sphere)
                    this.emitCount = bem1.divNumber * bem1.divNumber * 4 + 2;
                else
                    this.emitCount = bem1.divNumber;
                workData.volumeEmitCount = this.emitCount;
                workData.volumeEmitIdx = 0;
            } else {
                // Rate
                const emitCountIncr = this.rate * (1.0 + bem1.rateRndm * get_r_zp(this.random)) * workData.deltaTime;
                this.emitCount += emitCountIncr;

                // If this is the first emission and we got extremely bad luck, force a particle.
                if (!!(this.flags & BaseEmitterFlags.FIRST_EMISSION) && this.rate != 0 && this.emitCount < 1.0)
                    this.emitCount = 1;
            }

            if (!!(this.flags & BaseEmitterFlags.STOP_EMIT_PARTICLES))
                this.emitCount = 0;

            while (this.emitCount > 1) {
                this.createParticle();
                this.emitCount--;
            }
        }

        this.rateStepTimer += workData.deltaTime;
        if (this.rateStepTimer >= bem1.rateStep + 1) {
            this.rateStepTimer -= bem1.rateStep + 1;
            this.flags |= BaseEmitterFlags.RATE_STEP_EMIT;
        } else {
            this.flags &= ~BaseEmitterFlags.RATE_STEP_EMIT;
        }

        // Unmark as first emission.
        this.flags &= ~BaseEmitterFlags.FIRST_EMISSION;
    }

    private processTillStartFrame(): boolean {
        if (this.waitTime >= this.resData.res.bem1.startFrame)
            return true;

        if (!(this.flags & BaseEmitterFlags.STOP_CALC_EMITTER))
            this.waitTime += this.emitterManager.workData.deltaTime;

        return false;
    }

    private processTermination(): boolean {
        if (!!(this.flags & BaseEmitterFlags.TERMINATE))
            return true;

        if (this.maxFrame == 0)
            return false;

        if (this.maxFrame < 0) {
            this.flags |= BaseEmitterFlags.TERMINATED;
            return (this.aliveParticlesBase.length === 0 && this.aliveParticlesChild.length === 0);
        }

        if (this.tick >= this.maxFrame) {
            this.flags |= BaseEmitterFlags.TERMINATED;

            if (!!(this.flags & BaseEmitterFlags.DO_NOT_TERMINATE))
                return false;

            return (this.aliveParticlesBase.length === 0 && this.aliveParticlesChild.length === 0);
        }

        return false;
    }

    private calcWorkData_c(workData: JPAEmitterWorkData): void {
        // Set up the work data for simulation.
        workData.volumeSize = this.volumeSize;
        workData.volumeMinRad = this.volumeMinRad;
        workData.volumeSweep = this.volumeSweep;
        workData.divNumber = this.resData.res.bem1.divNumber * 2 + 1;

        mat4.copy(workData.globalRotation, this.globalRotation);

        JPAGetXYZRotateMtx(scratchMatrix, this.emitterRot);
        mat4.mul(workData.emitterGlobalRot, workData.globalRotation, scratchMatrix);

        mat4.fromScaling(scratchMatrix, this.emitterScl);
        mat4.mul(workData.emitterGlobalSR, workData.emitterGlobalRot, scratchMatrix);

        vec3.mul(workData.emitterGlobalScl, this.globalScale, this.emitterScl);
        JPAGetDirMtx(workData.emitterDirMtx, this.emitterDir);
        vec3.copy(workData.globalScale, this.globalScale);

        vec3.copy(workData.emitterTrs, this.emitterTrs);

        mat4.fromScaling(scratchMatrix, this.globalScale);
        mat4.mul(scratchMatrix, this.globalRotation, scratchMatrix);
        scratchMatrix[12] = this.globalTranslation[0];
        scratchMatrix[13] = this.globalTranslation[1];
        scratchMatrix[14] = this.globalTranslation[2];
        vec3.transformMat4(workData.emitterGlobalSRT, this.emitterTrs, scratchMatrix);
    }

    private calcWorkData_d(workData: JPAEmitterWorkData): void {
        // Set up the work data for drawing.
        JPAGetXYZRotateMtx(scratchMatrix, this.emitterRot);
        mat4.mul(workData.emitterGlobalRot, workData.emitterGlobalRot, scratchMatrix);
        vec3.transformMat4(workData.emitterGlobalDir, this.emitterDir, workData.emitterGlobalRot);
    }

    public calc(workData: JPAEmitterWorkData): boolean {
        if (!this.processTillStartFrame())
            return true;

        if (this.processTermination())
            return false;

        workData.baseEmitter = this;

        if (!(this.flags & BaseEmitterFlags.STOP_CALC_EMITTER)) {
            this.calcKey();

            // Reset fields.

            // Emitter callback +0x0c

            this.calcWorkData_c(workData);

            // mCalcEmitterFuncList
            const bsp1 = this.resData.res.bsp1;

            const texCalcOnEmitter = !!(bsp1.flags & 0x00004000);
            if (texCalcOnEmitter)
                this.texAnmIdx = calcTexIdx(workData, this.tick, 0, 0);

            const colorCalcOnEmitter = !!(bsp1.flags & 0x00001000);
            if (colorCalcOnEmitter)
                calcColor(this.colorPrm, this.colorEnv, workData, this.tick, 0, 0);

            // mFieldBlocks

            if (!(this.flags & BaseEmitterFlags.TERMINATED))
                this.create();

            // Emitter callback +0x10

            for (let i = 0; i < this.aliveParticlesBase.length; i++) {
                const particle = this.aliveParticlesBase[i];
                const alive = particle.calc_p(workData);

                if (!alive) {
                    this.aliveParticlesBase.splice(i, 1);
                    workData.emitterManager.deadParticlePool.push(particle);
                    i--;
                }
            }

            for (let i = 0; i < this.aliveParticlesChild.length; i++) {
                const particle = this.aliveParticlesChild[i];
                const alive = particle.calc_c(workData);

                if (!alive) {
                    this.aliveParticlesChild.splice(i, 1);
                    workData.emitterManager.deadParticlePool.push(particle);
                    i--;
                }
            }

            this.tick += workData.deltaTime;
        } else {
            // Emitter callback +0x10
        }

        return true;
    }

    private genTexCrdMtxIdt(materialParams: MaterialParams): void {
        mat4.identity(materialParams.u_TexMtx[0]);
    }

    private drawP(device: GfxDevice, renderHelper: GXRenderHelperGfx, workData: JPAEmitterWorkData): void {
        const bsp1 = this.resData.res.bsp1;
        const etx1 = this.resData.res.etx1;

        this.flags = this.flags & 0xFFFFFF7F;
        vec2.mul(workData.globalScale2D, this.globalScale2D, bsp1.globalScale2D);

        if (bsp1.shapeType === ShapeType.Point) {
            workData.globalScale2D[0] *= 1.02;
        } else if (bsp1.shapeType === ShapeType.Line) {
            workData.globalScale2D[0] *= 1.02;
            workData.globalScale2D[1] *= 0.4;
        }

        // mpDrawEmitterFuncList

        const texCalcOnEmitter = !!(bsp1.flags & 0x00004000);
        if (texCalcOnEmitter)
            this.resData.texData[this.texAnmIdx].fillTextureMapping(materialParams.m_TextureMapping[0]);

        if (etx1 !== null) {
            if (!!(etx1.flags & 0x00000001)) {
                this.resData.texData[etx1.indTextureIdx].fillTextureMapping(materialParams.m_TextureMapping[2]);
                fillIndTexMtx(materialParams.u_IndTexMtx[0], etx1.indTextureMtx);
            }

            if (!!(etx1.flags & 0x00000100))
                this.resData.texData[etx1.secondTextureIdx].fillTextureMapping(materialParams.m_TextureMapping[3]);
        }

        if (bsp1.shapeType === ShapeType.Point || bsp1.shapeType === ShapeType.Line)
            this.genTexCrdMtxIdt(materialParams);
        else if (!(bsp1.flags & 0x01000000))
            this.genTexCrdMtxIdt(materialParams);

        if (!!(bsp1.flags & 0x200000)) {
            for (let i = 0; i < this.aliveParticlesBase.length; i++)
                this.aliveParticlesBase[i].drawP(device, renderHelper, workData, materialParams);
        } else {
            for (let i = this.aliveParticlesBase.length - 1; i >= 0; i--)
                this.aliveParticlesBase[i].drawP(device, renderHelper, workData, materialParams);
        }

        // Emitter Callback 0x18
    }

    private drawC(device: GfxDevice, renderHelper: GXRenderHelperGfx, workData: JPAEmitterWorkData): void {
        const bsp1 = this.resData.res.bsp1;
        const ssp1 = this.resData.res.ssp1;

        this.flags = this.flags | 0x00000080;

        if (!!(ssp1.flags & 0x00010000))
            vec2.mul(workData.globalScale2D, this.globalScale2D, bsp1.globalScale2D);
        else
            vec2.mul(workData.globalScale2D, this.globalScale2D, ssp1.globalScale2D);

        if (ssp1.shapeType === ShapeType.Point) {
            workData.globalScale2D[0] *= 1.02;
        } else if (ssp1.shapeType === ShapeType.Line) {
            workData.globalScale2D[0] *= 1.02;
            workData.globalScale2D[1] *= 0.4;
        }

        workData.baseEmitter.resData.texData[ssp1.texIdx].fillTextureMapping(materialParams.m_TextureMapping[0]);

        // mpDrawEmitterChildFuncList

        if (!!(bsp1.flags & 0x200000)) {
            for (let i = 0; i < this.aliveParticlesChild.length; i++)
                this.aliveParticlesChild[i].drawC(device, renderHelper, workData, materialParams);
        } else {
            for (let i = this.aliveParticlesChild.length - 1; i >= 0; i--)
                this.aliveParticlesChild[i].drawC(device, renderHelper, workData, materialParams);
        }
    }

    public draw(device: GfxDevice, renderHelper: GXRenderHelperGfx, workData: JPAEmitterWorkData): void {
        if (!!(this.flags & BaseEmitterFlags.STOP_DRAW_PARTICLE))
            return;

        const bsp1 = this.resData.res.bsp1;
        const ssp1 = this.resData.res.ssp1;

        workData.baseEmitter = this;

        this.calcWorkData_d(workData);

        const drawChildrenBefore = !!(bsp1.flags & 0x00400000);
        if (ssp1 !== null && drawChildrenBefore)
            this.drawC(device, renderHelper, workData);
        this.drawP(device, renderHelper, workData);
        if (ssp1 !== null && !drawChildrenBefore)
            this.drawC(device, renderHelper, workData);
    }
}

function normToLength(dst: vec3, len: number): void {
    const vlen = vec3.length(dst);
    if (vlen > 0) {
        const inv = len / vlen;
        dst[0] = dst[0] * inv;
        dst[1] = dst[1] * inv;
        dst[2] = dst[2] * inv;
    }
}

function normToLengthAndAdd(dst: vec3, a: vec3, len: number): void {
    const vlen = vec3.length(a);
    if (vlen > 0) {
        const inv = len / vlen;
        dst[0] += a[0] * inv;
        dst[1] += a[1] * inv;
        dst[2] += a[2] * inv;
    }
}

function calcTexCrdMtxAnm(dst: mat4, bsp1: JPABaseShapeBlock, tick: number): void {
    const animData = bsp1.texCrdMtxAnimData;
    const offsS = 0.5 * (1.0 + ((bsp1.flags >>> 0x19) & 0x01));
    const offsT = 0.5 * (1.0 + ((bsp1.flags >>> 0x1a) & 0x01));

    const texStaticTransX = animData[0];
    const texStaticTransY = animData[1];
    const texStaticScaleX = animData[2];
    const texStaticScaleY = animData[3];
    const texStaticRotate = animData[4];
    const texScrollTransX = animData[5];
    const texScrollTransY = animData[6];
    const texScrollScaleX = animData[7];
    const texScrollScaleY = animData[8];
    const texScrollRotate = animData[9];

    const translationS = offsS + texStaticTransX + tick * texScrollTransX;
    const translationT = offsT + texStaticTransY + tick * texScrollTransY;
    const scaleS = texStaticScaleX + tick * texScrollScaleX;
    const scaleT = texStaticScaleY + tick * texScrollScaleY;
    const rotate = (texStaticRotate + tick * texScrollRotate) * MathConstants.TAU / 0x3FFF;

    const sinR = Math.sin(rotate);
    const cosR = Math.cos(rotate);

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleS * -sinR;
    dst[8]  = 0.0;
    dst[12] = offsS + scaleS * (sinR * translationT - cosR * translationS);

    dst[1]  = scaleT *  sinR;
    dst[5]  = scaleT *  cosR;
    dst[9]  = 0.0;
    dst[13] = offsT + -scaleT * (sinR * translationS + cosR * translationT);

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = 1.0;
    dst[14] = 0.0;
}

function mat4SwapTranslationColumns(m: mat4): void {
    const tx = m[12];
    m[12] = m[8];
    m[8] = tx;
    const ty = m[13];
    m[13] = m[9];
    m[9] = ty;
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export class JPABaseParticle {
    public flags: number;
    public time: number;
    public tick: number;
    public position = vec3.create();
    public localPosition = vec3.create();
    public globalPosition = vec3.create();
    public velocity = vec3.create();
    public velType1 = vec3.create();
    public velType0 = vec3.create();
    public velType2 = vec3.create();
    public axisY = vec3.create();

    public scale = vec2.create();
    public scaleOut: number;
    public alphaWaveRandom: number;
    public lifeTime: number;
    public rotateAngle: number;
    public rotateSpeed: number;
    public colorPrm = colorNewCopy(White);
    public colorEnv = colorNewCopy(White);
    public prmColorAlphaAnm: number;
    public anmRandom: number;
    public texAnmIdx: number;
    public moment: number;
    public drag: number;

    public init_p(workData: JPAEmitterWorkData): void {
        const baseEmitter = workData.baseEmitter;
        const bem1 = baseEmitter.resData.res.bem1;
        const bsp1 = baseEmitter.resData.res.bsp1;
        const esp1 = baseEmitter.resData.res.esp1;

        this.tick = -1;
        this.flags = 0;
        this.time = 0;

        const lifeTimeRandom = get_rndm_f(baseEmitter.random);
        this.lifeTime = baseEmitter.lifeTime * (1.0 - lifeTimeRandom * bem1.lifeTimeRndm);
        vec3.transformMat4(this.localPosition, workData.volumePos, workData.emitterGlobalSR);

        if (!!(bem1.flags & 0x08))
            this.flags = this.flags | 0x20;

        vec3.copy(this.globalPosition, workData.emitterGlobalSRT);

        this.position[0] = this.globalPosition[0] + this.localPosition[0] * workData.globalScale[0];
        this.position[1] = this.globalPosition[1] + this.localPosition[1] * workData.globalScale[1];
        this.position[2] = this.globalPosition[2] + this.localPosition[2] * workData.globalScale[2];

        vec3.set(this.velType1, 0, 0, 0);

        if (baseEmitter.initialVelOmni !== 0)
            normToLengthAndAdd(this.velType1, workData.velOmni, baseEmitter.initialVelOmni);
        if (baseEmitter.initialVelAxis !== 0)
            normToLengthAndAdd(this.velType1, workData.velAxis, baseEmitter.initialVelAxis);
        if (baseEmitter.initialVelDir !== 0) {
            const randZ = next_rndm(baseEmitter.random) >>> 16;
            const randY = get_r_zp(baseEmitter.random);
            mat4.identity(scratchMatrix);
            mat4.rotateZ(scratchMatrix, scratchMatrix, randZ / 0xFFFF * Math.PI);
            mat4.rotateY(scratchMatrix, scratchMatrix, baseEmitter.spread * randY * Math.PI);
            mat4.mul(scratchMatrix, workData.emitterDirMtx, scratchMatrix);
            this.velType1[0] += baseEmitter.initialVelDir * scratchMatrix[8];
            this.velType1[1] += baseEmitter.initialVelDir * scratchMatrix[9];
            this.velType1[2] += baseEmitter.initialVelDir * scratchMatrix[10];
        }
        if (baseEmitter.initialVelRndm !== 0) {
            const randZ = get_rndm_f(baseEmitter.random) - 0.5;
            const randY = get_rndm_f(baseEmitter.random) - 0.5;
            const randX = get_rndm_f(baseEmitter.random) - 0.5;
            this.velType1[0] += baseEmitter.initialVelRndm * randX;
            this.velType1[1] += baseEmitter.initialVelRndm * randY;
            this.velType1[2] += baseEmitter.initialVelRndm * randZ;
        }
        const velRatio = 1.0 + get_r_zp(baseEmitter.random) * bem1.initialVelRatio;
        this.velType1[0] *= velRatio;
        this.velType1[1] *= velRatio;
        this.velType1[2] *= velRatio;

        if (!!(bem1.flags & 0x04)) {
            this.velType1[0] *= baseEmitter.emitterScl[0];
            this.velType1[1] *= baseEmitter.emitterScl[1];
            this.velType1[2] *= baseEmitter.emitterScl[2];
        }

        vec3.transformMat4(this.velType1, this.velType1, workData.emitterGlobalRot);
        vec3.set(this.velType0, 0, 0, 0);

        this.drag = 1.0;
        this.moment = 1.0 - (bem1.moment * get_rndm_f(baseEmitter.random));
        vec3.set(this.axisY, workData.emitterGlobalRot[1], workData.emitterGlobalRot[5], workData.emitterGlobalRot[9]);

        colorCopy(this.colorPrm, baseEmitter.colorPrm);
        colorCopy(this.colorEnv, baseEmitter.colorEnv);
        this.anmRandom = (get_rndm_f(baseEmitter.random) * bsp1.anmRndm) & 0xFF;

        // ScaleX/Y/Out
        if (esp1 !== null && !!(esp1.flags & 0x00000001)) {
            this.scaleOut = baseEmitter.scaleOut * (1.0 + (esp1.scaleOutRandom * get_r_zp(baseEmitter.random)));
        } else {
            this.scaleOut = baseEmitter.scaleOut;
        }
        vec2.set(this.scale, this.scaleOut, this.scaleOut);

        this.prmColorAlphaAnm = 1.0;

        if (esp1 !== null && !!(esp1.flags & 0x00020000)) {
            this.alphaWaveRandom = 1.0 + (get_r_zp(baseEmitter.random) * esp1.alphaWaveRandom);
        } else {
            this.alphaWaveRandom = 1.0;
        }

        if (esp1 !== null && !!(esp1.flags & 0x01000000)) {
            this.rotateAngle = esp1.rotateAngle + (get_rndm_f(baseEmitter.random) - 0.5) * esp1.rotateAngleRandom;
            this.rotateSpeed = esp1.rotateSpeed + (1.0 + get_r_zp(baseEmitter.random) * esp1.rotateSpeedRandom);
            if (get_r_zp(baseEmitter.random) >= esp1.rotateDirection)
                this.rotateSpeed *= -1;

            // Convert to radians.
            this.rotateAngle *= Math.PI / 0x7FFF;
            this.rotateSpeed *= Math.PI / 0x7FFF;
        } else {
            this.rotateAngle = 0;
            this.rotateSpeed = 0;
        }
    }

    public init_c(workData: JPAEmitterWorkData, parent: JPABaseParticle): void {
        const baseEmitter = workData.baseEmitter;
        const bem1 = baseEmitter.resData.res.bem1;
        const ssp1 = baseEmitter.resData.res.ssp1;

        this.tick = -1;
        this.time = 0;
        this.flags = 0x04;

        this.lifeTime = ssp1.life;

        vec3.copy(this.localPosition, parent.localPosition);

        if (ssp1.posRndm !== 0) {
            const rndX = get_rndm_f(baseEmitter.random) - 0.5;
            const rndY = get_rndm_f(baseEmitter.random) - 0.5;
            const rndZ = get_rndm_f(baseEmitter.random) - 0.5;
            vec3.set(scratchVec3a, rndX, rndY, rndZ);
            const rndLength = get_rndm_f(baseEmitter.random) * ssp1.posRndm;
            normToLengthAndAdd(this.localPosition, scratchVec3a, rndLength);
        }

        if (!!(bem1.flags & 0x10))
            this.flags = this.flags | 0x20;

        vec3.copy(this.globalPosition, parent.globalPosition);

        const velRndm = ssp1.baseVel * (1.0 + ssp1.baseVelRndm * get_rndm_f(baseEmitter.random));
        const rndX = get_rndm_f(baseEmitter.random);
        const rndY = get_rndm_f(baseEmitter.random);
        const rndZ = get_rndm_f(baseEmitter.random);
        vec3.set(scratchVec3a, rndX, rndY, rndZ);
        normToLength(scratchVec3a, velRndm);
        vec3.scaleAndAdd(this.velType1, parent.velType1, scratchVec3a, ssp1.velInfRndm);
        vec3.scale(this.velType0, parent.velType2, ssp1.velInfRndm);

        this.moment = parent.moment;

        if (!!(ssp1.flags & 0x00200000)) {
            // isEnableField
            this.drag = parent.drag;
        } else {
            this.flags |= 0x40;
            this.drag = 1.0;
        }

        vec3.copy(this.velType2, this.velType0);

        vec3.add(this.velocity, this.velType1, this.velType2);
        const totalMomentum = this.moment * this.drag;
        vec3.scale(this.velocity, this.velocity, totalMomentum);

        vec3.copy(this.axisY, parent.axisY);

        if (!!(ssp1.flags & 0x00010000)) {
            // isInheritedScale
            const scaleX = parent.scale[0] * ssp1.inheritScale;
            this.scale[0] = scaleX;
            const scaleY = parent.scale[1] * ssp1.inheritScale;
            this.scale[1] = scaleY;

            // On children particles, these fields are reused... ¯\_(ツ)_/¯
            this.scaleOut = scaleX;
            this.alphaWaveRandom = scaleY;
        } else {
            vec2.set(this.scale, 1, 1);
            this.scaleOut = 1;
            this.alphaWaveRandom = 1;
        }

        if (!!(ssp1.flags & 0x00040000)) {
            // isInheritedRGB
            this.colorPrm.r = parent.colorPrm.r * ssp1.inheritRGB;
            this.colorPrm.g = parent.colorPrm.g * ssp1.inheritRGB;
            this.colorPrm.b = parent.colorPrm.b * ssp1.inheritRGB;
            this.colorEnv.r = parent.colorEnv.r * ssp1.inheritRGB;
            this.colorEnv.g = parent.colorEnv.g * ssp1.inheritRGB;
            this.colorEnv.b = parent.colorEnv.b * ssp1.inheritRGB;
        } else {
            colorCopy(this.colorPrm, ssp1.colorPrm);
            colorCopy(this.colorEnv, ssp1.colorEnv);
        }

        this.prmColorAlphaAnm = 1.0;
        if (!!(ssp1.flags & 0x00020000)) {
            // isInheritedAlpha
            this.colorPrm.a = (parent.colorPrm.a * parent.prmColorAlphaAnm) * ssp1.inheritAlpha;
        } else {
            this.colorPrm.a = ssp1.colorPrm.a;
        }

        this.rotateAngle = parent.rotateAngle;
        if (!!(ssp1.flags & 0x01000000)) {
            // isEnableRotate
            this.rotateSpeed = ssp1.rotateSpeed;
        } else {
            this.rotateSpeed = 0;
        }

        this.texAnmIdx = 0;
    }

    private calcFieldFadeAffect(field: JPAFieldBlock, time: number): number {
        const fieldFadeFlags = field.flags >>> 0x10;
        if ((!!(fieldFadeFlags & 0x08) && time < field.enTime) ||
            (!!(fieldFadeFlags & 0x10) && time >= field.disTime)) {
            return 0;
        }

        if (!!(fieldFadeFlags & 0x40) && time >= field.fadeOut)
            return (field.disTime - time) * field.fadeOutRate;

        if (!!(fieldFadeFlags & 0x20) && time >= field.fadeIn)
            return (time - field.enTime) * field.fadeInRate;

        return 1;
    }

    private calcFieldAffect(v: vec3, field: JPAFieldBlock): void {
        if (!(this.flags & 0x04) && !!((field.flags >>> 0x10) & 0x78)) {
            vec3.scale(v, v, this.calcFieldFadeAffect(field, this.time));
        }

        if (field.velType === JPAFieldVelType.Unk00)
            vec3.add(this.velType0, this.velType0, v);
        else if (field.velType === JPAFieldVelType.Unk01)
            vec3.add(this.velType1, this.velType1, v);
        else if (field.velType === JPAFieldVelType.Unk02)
            vec3.add(this.velType2, this.velType2, v);
    }

    private calcFieldGravity(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare
        if (!!((field.flags >>> 0x10) & 2)) {
            vec3.scale(scratchVec3a, field.dir, field.param1);
        } else {
            vec3.transformMat4(scratchVec3a, field.dir, workData.globalRotation);
            vec3.scale(scratchVec3a, scratchVec3a, field.param1);
        }

        // Calc
        this.calcFieldAffect(scratchVec3a, field);
    }

    private calcFieldAir(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare
        vec3.normalize(scratchVec3a, field.dir);
        if (!!((field.flags >>> 0x10) & 2)) {
            vec3.scale(scratchVec3a, scratchVec3a, field.param1);
        } else {
            vec3.transformMat4(scratchVec3a, scratchVec3a, workData.globalRotation);
            vec3.scale(scratchVec3a, scratchVec3a, field.param1);
        }

        // Calc
        this.calcFieldAffect(scratchVec3a, field);
    }

    private calcFieldNewton(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        // Convert to emitter space.
        vec3.sub(scratchVec3a, field.pos, workData.emitterTrs);
        vec3.transformMat4(scratchVec3a, scratchVec3a, workData.globalRotation);

        const power = 10 * field.param1;
        const refDistanceSq = field.param3 * field.param3;

        // Calc
        vec3.sub(scratchVec3a, scratchVec3a, this.localPosition);
        const sqDist = vec3.squaredLength(scratchVec3a);
        if (sqDist <= refDistanceSq) {
            normToLength(scratchVec3a, power);
        } else {
            normToLength(scratchVec3a, refDistanceSq / sqDist * power);
        }

        this.calcFieldAffect(scratchVec3a, field);
    }

    private calcFieldVortex(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        const forceDir = scratchVec3a;
        const forceVec = scratchVec3b;

        vec3.transformMat4(forceDir, field.dir, workData.emitterGlobalRot);
        vec3.normalize(forceDir, forceDir);

        const distance = field.pos[2];
        const sqVortexDist = distance*distance;
        const innerSpeed = field.param1;
        const outerSpeed = field.param2;

        // Calc
        vec3.scale(forceVec, forceDir, vec3.dot(forceDir, this.localPosition));
        vec3.sub(forceVec, this.localPosition, forceVec);

        const sqDist = vec3.squaredLength(forceVec);
        if (sqDist === 0)
            return;

        let power = 0;
        if (sqDist >= sqVortexDist) {
            power = outerSpeed;
        } else {
            power = lerp(innerSpeed, outerSpeed, sqDist / sqVortexDist);
        }

        vec3.normalize(forceVec, forceVec);

        vec3.cross(forceVec, forceVec, forceDir);
        vec3.scale(forceVec, forceVec, power);
        this.calcFieldAffect(forceVec, field);
    }

    private calcFieldRandom(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        // Calc

        // Randomize on the first tick of each particle, or every cycles parameters.
        // Since we don't use integer frame timings, there's no great way to do this...
        // in theory this could skip a tick or few...
        const tickInt = (this.tick | 0);
        let shouldRandomize = tickInt === 0;

        if (!shouldRandomize && field.cycle > 0) {
            // Check for every multiple of cycle as well...
            if ((tickInt % field.cycle) === 0)
                shouldRandomize = true;
        }

        if (shouldRandomize) {
            const x = get_r_zh(workData.baseEmitter.random);
            const y = get_r_zh(workData.baseEmitter.random);
            const z = get_r_zh(workData.baseEmitter.random);
            vec3.set(scratchVec3a, x, y, z);
            vec3.scale(scratchVec3a, scratchVec3a, field.param1);
            this.calcFieldAffect(scratchVec3a, field);
        }
    }

    private calcFieldDrag(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        // Calc
        if (!(this.flags & 0x04)) {
            this.drag *= (1.0 - (this.calcFieldFadeAffect(field, this.time) * (1.0 - field.param1)));
        } else {
            this.drag *= field.param1;
        }
    }

    private calcField(workData: JPAEmitterWorkData): void {
        const fld1 = workData.baseEmitter.resData.res.fld1;
        for (let i = fld1.length - 1; i >= 0; i--) {
            const field = fld1[i];
            if (field.type === JPAFieldType.Gravity)
                this.calcFieldGravity(field, workData);
            else if (field.type === JPAFieldType.Air)
                this.calcFieldAir(field, workData);
            else if (field.type === JPAFieldType.Newton)
                this.calcFieldNewton(field, workData);
            else if (field.type === JPAFieldType.Vortex)
                this.calcFieldVortex(field, workData);
            else if (field.type === JPAFieldType.Random)
                this.calcFieldRandom(field, workData);
            else if (field.type === JPAFieldType.Drag)
                this.calcFieldDrag(field, workData);
            else
                throw "whoops";
        }
    }

    private canCreateChild(workData: JPAEmitterWorkData): boolean {
        const ssp1 = workData.baseEmitter.resData.res.ssp1;

        const timing = (this.tick - (this.lifeTime - 1) * ssp1.timing) * workData.deltaTime;
        if (timing <= 0)
            return false;

        const timingInt = (timing | 0);

        const rate = ssp1.rate + 1;
        if ((timingInt % rate) === 0)
            return true;

        return false;
    }

    private calcScaleAnm(type: CalcScaleAnmType, maxFrame: number): number {
        if (type === CalcScaleAnmType.Normal)
            return this.time;
        else if (type === CalcScaleAnmType.Repeat)
            return (this.tick / maxFrame) % 1.0;
        else
            throw "whoops";
    }

    private calcScaleFade(scaleAnm: number, esp1: JPAExtraShapeBlock, base: number, increase: number, decrease: number): number {
        if (scaleAnm < esp1.scaleInTiming)
            return (scaleAnm * increase) + base;
        else if (scaleAnm > esp1.scaleOutTiming)
            return ((scaleAnm - esp1.scaleOutTiming) * decrease) + 1.0;
        else
            return 1;
    }

    public calc_p(workData: JPAEmitterWorkData): boolean {
        if (this.tick === -1)
            this.tick++;
        else
            this.tick += workData.deltaTime;

        if (this.tick < 0 || this.tick >= this.lifeTime)
            return false;

        const res = workData.baseEmitter.resData.res;

        this.time = this.tick / this.lifeTime;

        if (!!(this.flags & 0x20))
            vec3.copy(this.globalPosition, workData.emitterGlobalSRT);

        vec3.set(this.velType2, 0, 0, 0);

        if (!(this.flags & 0x40))
            this.calcField(workData);

        vec3.add(this.velType2, this.velType2, this.velType0);
        vec3.scale(this.velType1, this.velType1, res.bem1.airResist);
        vec3.add(this.velocity, this.velType1, this.velType2);
        const totalMomentum = this.moment * this.drag;
        vec3.scale(this.velocity, this.velocity, totalMomentum);

        // Particle callback 0x0C

        if (!(this.flags & 0x02)) {
            // mCalcParticleFuncList
            const bsp1 = res.bsp1;
            const esp1 = res.esp1;
            const ssp1 = res.ssp1;

            const texCalcOnEmitter = !!(bsp1.flags & 0x00004000);
            if (!texCalcOnEmitter) {
                const randomPhase = this.anmRandom & bsp1.texAnmRndmMask;
                this.texAnmIdx = calcTexIdx(workData, this.tick, this.time, randomPhase);
            }

            const colorCalcOnEmitter = !!(bsp1.flags & 0x00001000);
            if (!colorCalcOnEmitter) {
                const randomPhase = this.anmRandom & bsp1.colorAnmRndmMask;
                calcColor(this.colorPrm, this.colorEnv, workData, this.tick, this.time, randomPhase);
            } else {
                colorCopy(this.colorPrm, workData.baseEmitter.colorPrm);
                colorCopy(this.colorEnv, workData.baseEmitter.colorEnv);
            }

            if (esp1 !== null) {
                const hasScaleAnm = !!(esp1.flags & 0x01);
                if (hasScaleAnm) {
                    const scaleAnmTypeX: CalcScaleAnmType = (esp1.flags >>> 0x08) & 0x03;
                    const scaleAnmX = this.calcScaleAnm(scaleAnmTypeX, esp1.scaleAnmMaxFrameX);
                    this.scale[0] = this.scaleOut * this.calcScaleFade(scaleAnmX, esp1, esp1.scaleInValueX, esp1.scaleIncreaseRateX, esp1.scaleDecreaseRateX);

                    const hasScaleAnmY = !!(esp1.flags & 0x02);
                    if (hasScaleAnmY) {
                        const scaleAnmTypeY: CalcScaleAnmType = (esp1.flags >>> 0x0A) & 0x03;
                        const scaleAnmY = this.calcScaleAnm(scaleAnmTypeY, esp1.scaleAnmMaxFrameY);
                        this.scale[0] = this.scaleOut * this.calcScaleFade(scaleAnmY, esp1, esp1.scaleInValueY, esp1.scaleIncreaseRateY, esp1.scaleDecreaseRateY);
                    } else {
                        this.scale[1] = this.scale[0];
                    }
                }

                const hasAlphaAnm = !!(esp1.flags & 0x00010000);
                const hasAlphaFlickAnm = !!(esp1.flags & 0x00020000);

                if (hasAlphaAnm || hasAlphaAnm) {
                    let alpha: number;

                    if (this.time < esp1.alphaInTiming)
                        alpha = esp1.alphaInValue + this.time * esp1.alphaIncreaseRate;
                    else if (this.time > esp1.alphaOutTiming)
                        alpha = esp1.alphaBaseValue + ((this.time - esp1.alphaOutTiming) * esp1.alphaDecreaseRate);
                    else
                        alpha = esp1.alphaBaseValue;

                    if (hasAlphaFlickAnm) {
                        const theta = this.alphaWaveRandom * this.tick * (1.0 - esp1.alphaWaveFrequency) * MathConstants.TAU / 4;
                        const flickerMult = (0.5 * (Math.sin(theta) - 1.0) * esp1.alphaWaveAmplitude);
                        this.prmColorAlphaAnm = alpha * (1.0 + flickerMult);
                    } else {
                        this.prmColorAlphaAnm = alpha;
                    }
                }
            }

            this.rotateAngle += this.rotateSpeed * workData.deltaTime;

            // Create children.
            if (ssp1 !== null && this.canCreateChild(workData))
                for (let i = 0; i < ssp1.childrenCount; i++)
                    workData.baseEmitter.createChild(this);

            vec3.scaleAndAdd(this.localPosition, this.localPosition, this.velocity, workData.deltaTime);
            vec3.mul(this.position, this.localPosition, workData.globalScale);
            vec3.add(this.position, this.position, this.globalPosition);

            return true;
        }

        return false;
    }

    public calc_c(workData: JPAEmitterWorkData): boolean {
        if (this.tick === -1)
            this.tick++;
        else
            this.tick += workData.deltaTime;

        if (this.tick < 0 || this.tick >= this.lifeTime)
            return false;

        const res = workData.baseEmitter.resData.res;
        const ssp1 = res.ssp1;

        this.time = this.tick / this.lifeTime;

        if (this.tick != 0) {
            if (!!(this.flags & 0x20))
                vec3.copy(this.globalPosition, workData.emitterGlobalSRT);

            this.velType1[1] -= ssp1.gravity;
            vec3.set(this.velType2, 0, 0, 0);

            if (!(this.flags & 0x40))
                this.calcField(workData);

            vec3.add(this.velType2, this.velType2, this.velType0);
            vec3.scale(this.velType1, this.velType1, res.bem1.airResist);
            vec3.add(this.velocity, this.velType1, this.velType2);
            const totalMomentum = this.moment * this.drag;
            vec3.scale(this.velocity, this.velocity, totalMomentum);
        }

        // Particle callback 0x0C

        if (!(this.flags & 0x02)) {
            // mCalcChildFuncList

            const invTime = (1.0 - this.time);

            if (!!(ssp1.flags & 0x00400000)) {
                this.scale[0] = this.scaleOut * invTime;
                this.scale[1] = this.alphaWaveRandom * invTime; 
            }

            if (!!(ssp1.flags & 0x00800000)) {
                this.prmColorAlphaAnm = invTime;
            }

            this.rotateAngle += this.rotateSpeed * workData.deltaTime;

            vec3.scaleAndAdd(this.localPosition, this.localPosition, this.velocity, workData.deltaTime);
            vec3.mul(this.position, this.localPosition, workData.globalScale);
            vec3.add(this.position, this.position, this.globalPosition);

            return true;
        }

        return false;
    }

    private loadTexMtx(dst: mat4, workData: JPAEmitterWorkData, posMtx: mat4): void {
        const bsp1 = workData.baseEmitter.resData.res.bsp1;

        const isPrj = !!(bsp1.flags & 0x00100000);
        if (isPrj) {
            if (!!((bsp1.flags >>> 0x18) & 0x01)) {
                // loadPrjAnm
                calcTexCrdMtxAnm(dst, bsp1, workData.baseEmitter.tick);
                mat4SwapTranslationColumns(dst);
                mat4.mul(dst, dst, workData.texPrjMtx);
                mat4.mul(dst, dst, posMtx);
            } else {
                // loadPrj
                mat4.mul(dst, workData.texPrjMtx, posMtx);
            }
        } else {
            if (!!(bsp1.flags & 0x01000000))
                calcTexCrdMtxAnm(dst, bsp1, this.tick);
        }
    }

    private drawCommon(device: GfxDevice, renderHelper: GXRenderHelperGfx, workData: JPAEmitterWorkData, materialParams: MaterialParams, sp1: CommonShapeTypeFields): void {
        const esp1 = workData.baseEmitter.resData.res.esp1;
        const isRot = !!(esp1.flags & 0x01000000);

        const materialHelper = workData.baseEmitter.resData.materialHelper;
        const renderInstManager = renderHelper.renderInstManager;

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.sortKey = makeSortKeyTranslucent(GfxRendererLayer.TRANSLUCENT);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        colorMult(materialParams.u_Color[ColorKind.C0], this.colorPrm, workData.baseEmitter.globalColorPrm);
        materialParams.u_Color[ColorKind.C0].a *= this.prmColorAlphaAnm;
        colorMult(materialParams.u_Color[ColorKind.C1], this.colorEnv, workData.baseEmitter.globalColorEnv);

        const globalRes = workData.emitterManager.globalRes;
        const shapeType = sp1.shapeType;

        // TODO(jstpierre): Other shape types
        if (true || shapeType === ShapeType.Billboard) {
            const rotateAngle = isRot ? this.rotateAngle : 0;
            renderInst.setInputLayoutAndState(globalRes.inputLayout, globalRes.inputStateBillboard);
            renderInst.drawIndexes(6, 0);
            vec3.transformMat4(scratchVec3a, this.position, workData.posCamMtx);
            computeModelMatrixSRT(packetParams.u_PosMtx[0],
                this.scale[0] * workData.globalScale2D[0],
                this.scale[1] * workData.globalScale2D[1],
                1,
                0, 0, rotateAngle,
                scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
            this.loadTexMtx(materialParams.u_TexMtx[0], workData, packetParams.u_PosMtx[0]);
        } else {
            throw "whoops";
        }

        let materialOffs = renderInst.allocateUniformBuffer(ub_MaterialParams, materialHelper.materialParamsBufferSize);
        let packetOffs = renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        const d = renderHelper.uniformBuffer.mapBufferF32(materialOffs, materialHelper.materialParamsBufferSize);

        // Since this is called quite a *lot*, we have hand-crafted versions of
        // fillMaterialParamsData and fillPacketParamsData for speed here.

        // Skip AMB0, AMB1, MAT0, MAT1, K0, K1, K2, K3, CPREV.
        materialOffs += 4*9;
        materialOffs += fillColor(d, materialOffs, materialParams.u_Color[ColorKind.C0]);
        materialOffs += fillColor(d, materialOffs, materialParams.u_Color[ColorKind.C1]);
        // Skip C2.
        materialOffs += 4*1;

        materialOffs += fillMatrix4x3(d, materialOffs, materialParams.u_TexMtx[0]);
        // Skip u_TexMtx[1-9]
        materialOffs += 4*3*9;

        materialOffs += fillTextureMappingInfo(d, materialOffs, materialParams.m_TextureMapping[0]);
        materialOffs += fillTextureMappingInfo(d, materialOffs, materialParams.m_TextureMapping[1]);
        // Skip u_TextureInfo[2-8]
        materialOffs += 4*6;

        materialOffs += fillMatrix4x2(d, materialOffs, materialParams.u_IndTexMtx[0]);

        packetOffs += fillMatrix4x3(d, packetOffs, packetParams.u_PosMtx[0]);

        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }

    public drawP(device: GfxDevice, renderHelper: GXRenderHelperGfx, workData: JPAEmitterWorkData, materialParams: MaterialParams): void {
        const bsp1 = workData.baseEmitter.resData.res.bsp1;

        // mpDrawParticleFuncList

        const texCalcOnEmitter = !!(bsp1.flags & 0x00004000);
        if (!texCalcOnEmitter)
            workData.baseEmitter.resData.texData[this.texAnmIdx].fillTextureMapping(materialParams.m_TextureMapping[0]);

        this.drawCommon(device, renderHelper, workData, materialParams, bsp1);
    }

    public drawC(device: GfxDevice, renderHelper: GXRenderHelperGfx, workData: JPAEmitterWorkData, materialParams: MaterialParams): void {
        const ssp1 = workData.baseEmitter.resData.res.ssp1;

        // mpDrawParticleChildFuncList

        this.drawCommon(device, renderHelper, workData, materialParams, ssp1);
    }
}

function makeColorTable(buffer: ArrayBufferSlice, entryCount: number, duration: number): Color[] {
    const view = buffer.createDataView();

    assert(entryCount > 0 && duration > 0);

    const dst = nArray(duration + 1, () => colorNew(0, 0, 0, 0));
    let dstIdx = 0;

    const color0 = view.getUint32(0x02);
    colorFromRGBA8(dst[dstIdx++], color0);

    const time0 = view.getUint16(0x00);
    for (let i = 1; i <= time0; i++)
        colorCopy(dst[dstIdx++], dst[0]);

    for (let i = 1; i < entryCount; i++) {
        const entry0 = i - 1, entry1 = i;
        const time0 = view.getUint16(entry0 * 0x06 + 0x00);
        const time1 = view.getUint16(entry1 * 0x06 + 0x00);
        assert(time0 === dstIdx - 1);

        colorFromRGBA8(dst[time1], view.getUint32(entry1 * 0x06 + 0x02));

        // Lerp.
        const range = time1 - time0;
        for (let j = 1; j < range; j++)
            colorLerp(dst[dstIdx++], dst[time0], dst[time1], j / range);

        assert(dstIdx === time1);
        dstIdx++;
    }

    return dst;
}

function parseResource(res: JPAResourceRaw): JPAResource {
    const buffer = res.data;
    const view = buffer.createDataView();

    const blockCount = view.getUint16(0x02);
    const fieldBlockCount = view.getUint8(0x04);
    const keyBlockCount = view.getUint8(0x05);
    // Unknown at 0x06. Seemingly unused?

    let bem1: JPADynamicsBlock | null = null;
    let bsp1: JPABaseShapeBlock | null = null;
    let esp1: JPAExtraShapeBlock | null = null;
    let etx1: JPAExTexBlock | null = null;
    let ssp1: JPAChildShapeBlock | null = null;
    let fld1: JPAFieldBlock[] = [];
    let kfa1: JPAKeyBlock[] = [];
    let tdb1: Uint16Array | null = null;

    // Parse through the blocks.
    let tableIdx = 0x08;
    for (let j = 0; j < blockCount; j++) {
        // blockSize includes the header.
        const fourcc = readString(buffer, tableIdx + 0x00, 0x04, false);
        const blockSize = view.getUint32(tableIdx + 0x04);

        if (fourcc === 'BEM1') {
            // J3DDynamicsBlock

            // Contains emitter settings and details about how the particle simulates.

            const flags = view.getUint32(tableIdx + 0x08);
            const volumeType: JPAVolumeType = (flags >>> 8) & 0x07;

            // 0x08 = unk
            // 0x0C = unk
            const emitterSclX = view.getFloat32(tableIdx + 0x10);
            const emitterSclY = view.getFloat32(tableIdx + 0x14);
            const emitterSclZ = view.getFloat32(tableIdx + 0x18);
            const emitterScl = vec3.fromValues(emitterSclX, emitterSclY, emitterSclZ);

            const emitterTrsX = view.getFloat32(tableIdx + 0x1C);
            const emitterTrsY = view.getFloat32(tableIdx + 0x20);
            const emitterTrsZ = view.getFloat32(tableIdx + 0x24);
            const emitterTrs = vec3.fromValues(emitterTrsX, emitterTrsY, emitterTrsZ);

            const emitterDirX = view.getFloat32(tableIdx + 0x28);
            const emitterDirY = view.getFloat32(tableIdx + 0x2C);
            const emitterDirZ = view.getFloat32(tableIdx + 0x30);
            const emitterDir = vec3.fromValues(emitterDirX, emitterDirY, emitterDirZ);
            vec3.normalize(emitterDir, emitterDir);

            const initialVelOmni = view.getFloat32(tableIdx + 0x34);
            const initialVelAxis = view.getFloat32(tableIdx + 0x38);
            const initialVelRndm = view.getFloat32(tableIdx + 0x3C);
            const initialVelDir  = view.getFloat32(tableIdx + 0x40);

            const spread = view.getFloat32(tableIdx + 0x44);
            const initialVelRatio = view.getFloat32(tableIdx + 0x48);
            const rate = view.getFloat32(tableIdx + 0x4C);
            const rateRndm = view.getFloat32(tableIdx + 0x50);
            const lifeTimeRndm = view.getFloat32(tableIdx + 0x54);
            const volumeSweep = view.getFloat32(tableIdx + 0x58);
            const volumeMinRad = view.getFloat32(tableIdx + 0x5C);
            const airResist = view.getFloat32(tableIdx + 0x60);
            const moment = view.getFloat32(tableIdx + 0x64);
            const emitterRotX = view.getInt16(tableIdx + 0x68) / 0x7FFF;
            const emitterRotY = view.getInt16(tableIdx + 0x6A) / 0x7FFF;
            const emitterRotZ = view.getInt16(tableIdx + 0x6C) / 0x7FFF;
            const emitterRot = vec3.fromValues(emitterRotX, emitterRotY, emitterRotZ);
            const maxFrame = view.getInt16(tableIdx + 0x6E);
            const startFrame = view.getInt16(tableIdx + 0x70);
            const lifeTime = view.getInt16(tableIdx + 0x72);
            const volumeSize = view.getInt16(tableIdx + 0x74);
            const divNumber = view.getInt16(tableIdx + 0x76);
            const rateStep = view.getUint8(tableIdx + 0x78);

            bem1 = {
                flags, volumeType, emitterScl, emitterTrs, emitterDir, emitterRot,
                initialVelOmni, initialVelAxis, initialVelRndm, initialVelDir,
                spread, initialVelRatio, rate, rateRndm, lifeTimeRndm, volumeSweep,
                volumeMinRad, airResist, moment, maxFrame, startFrame, lifeTime,
                volumeSize, divNumber, rateStep,
            };
        } else if (fourcc === 'BSP1') {
            // J3DBaseShape

            // Contains particle draw settings.
            const flags = view.getUint32(tableIdx + 0x08);
            const shapeType: ShapeType = (flags >>> 0) & 0x0F;
            const dirType: DirType = (flags >>> 4) & 0x07;
            const rotType: RotType = (flags >>> 7) & 0x07;
            let planeType: PlaneType = (flags >>> 10) & 0x01;
            if (shapeType === ShapeType.DirectionCross || shapeType === ShapeType.RotationCross)
                planeType = PlaneType.X;

            const globalScale2DX = view.getFloat32(tableIdx + 0x10);
            const globalScale2DY = view.getFloat32(tableIdx + 0x14);
            const globalScale2D = vec2.fromValues(globalScale2DX, globalScale2DY);

            const texIdx = view.getUint8(tableIdx + 0x20);

            const blendModeFlags = view.getUint16(tableIdx + 0x18);
            const alphaCompareFlags = view.getUint8(tableIdx + 0x1A);
            const alphaRef0 = view.getUint8(tableIdx + 0x1B) / 0xFF;
            const alphaRef1 = view.getUint8(tableIdx + 0x1C) / 0xFF;
            const zModeFlags = view.getUint8(tableIdx + 0x1D);
            const texFlags = view.getUint8(tableIdx + 0x1E);
            const texIdxAnimCount = view.getUint8(tableIdx + 0x1F);
            const colorFlags = view.getUint8(tableIdx + 0x21);

            const colorPrm = colorNewFromRGBA8(view.getUint32(tableIdx + 0x26));
            const colorEnv = colorNewFromRGBA8(view.getUint32(tableIdx + 0x2A));

            const anmRndm = view.getUint8(tableIdx + 0x2E);
            const colorAnmRndmMask = view.getUint8(tableIdx + 0x2F);
            const texAnmRndmMask = view.getUint8(tableIdx + 0x30);

            let extraDataOffs = tableIdx + 0x34;

            let texCrdMtxAnimData: Float32Array | null = null;
            if (!!(flags & 0x01000000)) {
                texCrdMtxAnimData = buffer.createTypedArray(Float32Array, extraDataOffs, 10, Endianness.BIG_ENDIAN);
                extraDataOffs += 0x28;
            }

            let texIdxAnimData: Uint8Array | null = null;
            if (!!(texFlags & 0x01))
                texIdxAnimData = buffer.createTypedArray(Uint8Array, extraDataOffs, texIdxAnimCount, Endianness.BIG_ENDIAN);

            const colorRegAnmMaxFrm = view.getUint16(tableIdx + 0x24);

            let colorPrmAnimData: Color[] | null = null;
            if (!!(colorFlags & 0x02)) {
                const colorPrmAnimDataOffs = tableIdx + view.getUint16(tableIdx + 0x0C);
                const colorPrmAnimDataCount = view.getUint8(tableIdx + 0x22);
                colorPrmAnimData = makeColorTable(buffer.slice(colorPrmAnimDataOffs), colorPrmAnimDataCount, colorRegAnmMaxFrm);
            }

            let colorEnvAnimData: Color[] | null = null;
            if (!!(colorFlags & 0x08)) {
                const colorEnvAnimDataOffs = tableIdx + view.getUint16(tableIdx + 0x0E);
                const colorEnvAnimDataCount = view.getUint8(tableIdx + 0x23);
                colorEnvAnimData = makeColorTable(buffer.slice(colorEnvAnimDataOffs), colorEnvAnimDataCount, colorRegAnmMaxFrm);
            }

            bsp1 = {
                flags, shapeType, dirType, rotType, planeType, globalScale2D,
                blendModeFlags, alphaCompareFlags, alphaRef0, alphaRef1, zModeFlags,
                texFlags, texIdx, texIdxAnimData, texCrdMtxAnimData,
                colorFlags, colorPrm, colorEnv, colorEnvAnimData, colorPrmAnimData, colorRegAnmMaxFrm,
                anmRndm, texAnmRndmMask, colorAnmRndmMask,
            };
        } else if (fourcc === 'ESP1') {
            // J3DExtraShape

            // Contains misc. extra particle draw settings.
            const flags = view.getUint32(tableIdx + 0x08);

            const scaleInTiming =  view.getFloat32(tableIdx + 0x0C);
            const scaleOutTiming = view.getFloat32(tableIdx + 0x10);
            const scaleInValueX =  view.getFloat32(tableIdx + 0x14);
            const scaleOutValueX = view.getFloat32(tableIdx + 0x18);
            const scaleInValueY =  view.getFloat32(tableIdx + 0x1C);
            const scaleOutValueY = view.getFloat32(tableIdx + 0x20);
            const scaleOutRandom = view.getFloat32(tableIdx + 0x24);
            const scaleAnmMaxFrameX = view.getUint16(tableIdx + 0x28);
            const scaleAnmMaxFrameY = view.getUint16(tableIdx + 0x2A);

            let scaleIncreaseRateX = 1, scaleIncreaseRateY = 1;
            if (scaleInTiming > 0) {
                scaleIncreaseRateX = (1.0 - scaleInValueX) / scaleInTiming;
                scaleIncreaseRateY = (1.0 - scaleInValueX) / scaleInTiming;
            }

            let scaleDecreaseRateX = 1, scaleDecreaseRateY = 1;
            if (scaleOutTiming < 1) {
                scaleDecreaseRateX = (scaleOutValueX - 1.0) / (1.0 - scaleOutTiming);
                scaleDecreaseRateY = (scaleOutValueY - 1.0) / (1.0 - scaleOutTiming);
            }

            const alphaInTiming = view.getFloat32(tableIdx + 0x2C);
            const alphaOutTiming = view.getFloat32(tableIdx + 0x30);
            const alphaInValue = view.getFloat32(tableIdx + 0x34);
            const alphaBaseValue = view.getFloat32(tableIdx + 0x38);
            const alphaOutValue = view.getFloat32(tableIdx + 0x3C);

            let alphaIncreaseRate = 1;
            if (alphaInTiming > 0)
                alphaIncreaseRate = (alphaBaseValue - alphaInValue) / alphaInTiming;

            let alphaDecreaseRate = 1;
            if (alphaOutTiming < 1)
                alphaDecreaseRate = (alphaOutValue - alphaBaseValue) / (1.0 - alphaOutTiming);

            const alphaWaveFrequency = view.getFloat32(tableIdx + 0x40);
            const alphaWaveRandom = view.getFloat32(tableIdx + 0x44);
            const alphaWaveAmplitude = view.getFloat32(tableIdx + 0x48);

            const rotateAngle = view.getFloat32(tableIdx + 0x4C);
            const rotateAngleRandom = view.getFloat32(tableIdx + 0x50);
            const rotateSpeed = view.getFloat32(tableIdx + 0x54);
            const rotateSpeedRandom = view.getFloat32(tableIdx + 0x58);
            const rotateDirection = view.getFloat32(tableIdx + 0x5C);

            esp1 = { flags,
                scaleInTiming, scaleOutTiming, scaleInValueX, scaleOutValueX, scaleInValueY, scaleOutValueY,
                scaleIncreaseRateX, scaleIncreaseRateY, scaleDecreaseRateX, scaleDecreaseRateY,
                scaleOutRandom, scaleAnmMaxFrameX, scaleAnmMaxFrameY,
                alphaInTiming, alphaOutTiming, alphaInValue, alphaBaseValue, alphaOutValue,
                alphaIncreaseRate, alphaDecreaseRate,
                alphaWaveAmplitude, alphaWaveRandom, alphaWaveFrequency,
                rotateAngle, rotateAngleRandom, rotateSpeed, rotateSpeedRandom, rotateDirection,
            };
        } else if (fourcc === 'SSP1') {
            // J3DChildShape / J3DSweepShape

            // Contains child particle draw settings.

            const flags = view.getUint32(tableIdx + 0x08);
            const shapeType: ShapeType = (flags >>> 0) & 0x0F;
            const posRndm = view.getFloat32(tableIdx + 0x0C);
            const baseVel = view.getFloat32(tableIdx + 0x10);
            const baseVelRndm = view.getFloat32(tableIdx + 0x14);
            const velInfRndm = view.getFloat32(tableIdx + 0x18);
            const gravity = view.getFloat32(tableIdx + 0x1C);

            const globalScale2DX = view.getFloat32(tableIdx + 0x20);
            const globalScale2DY = view.getFloat32(tableIdx + 0x24);
            const globalScale2D = vec2.fromValues(globalScale2DX, globalScale2DY);

            const inheritScale = view.getFloat32(tableIdx + 0x28);
            const inheritAlpha = view.getFloat32(tableIdx + 0x2C);
            const inheritRGB = view.getFloat32(tableIdx + 0x30);
            const colorPrm = colorNewFromRGBA8(view.getUint32(tableIdx + 0x34));
            const colorEnv = colorNewFromRGBA8(view.getUint32(tableIdx + 0x38));
            const timing = view.getFloat32(tableIdx + 0x3C);
            const life = view.getUint16(tableIdx + 0x40);
            const childrenCount = view.getUint16(tableIdx + 0x42);
            const rate = view.getUint8(tableIdx + 0x44);
            const texIdx = view.getUint8(tableIdx + 0x45);
            const rotateSpeed = view.getUint16(tableIdx + 0x46) / 0xFFFF;

            ssp1 = { flags, shapeType,
                posRndm, baseVel, baseVelRndm, velInfRndm, gravity, globalScale2D,
                inheritScale, inheritAlpha, inheritRGB, colorPrm, colorEnv, timing,
                life, childrenCount, rate, texIdx, rotateSpeed,
            };
        } else if (fourcc === 'ETX1') {
            // J3DExTexShape

            // Contains extra texture draw settings.

            const flags = view.getUint32(tableIdx + 0x08);

            const p00 = view.getFloat32(tableIdx + 0x0C);
            const p01 = view.getFloat32(tableIdx + 0x10);
            const p02 = view.getFloat32(tableIdx + 0x14);
            const p10 = view.getFloat32(tableIdx + 0x18);
            const p11 = view.getFloat32(tableIdx + 0x1C);
            const p12 = view.getFloat32(tableIdx + 0x20);
            const scale = Math.pow(2, view.getInt8(tableIdx + 0x24));
            const indTextureMtx = new Float32Array([
                p00*scale, p01*scale, p02*scale, scale,
                p10*scale, p11*scale, p12*scale, 0.0,
            ]);

            const indTextureIdx = view.getUint8(tableIdx + 0x25);
            const secondTextureIdx = view.getUint8(tableIdx + 0x26);

            etx1 = { flags, indTextureMtx, indTextureIdx, secondTextureIdx };
        } else if (fourcc === 'KFA1') {
            // J3DKeyBlock

            // Contains curve animations for various emitter parameters.
            const keyType: JPAKeyType = view.getUint8(tableIdx + 0x08);
            const keyCount = view.getUint8(tableIdx + 0x09);
            const isLoopEnable = !!view.getUint8(tableIdx + 0x0B);

            // The curves are four floats per key, in typical time/value/tangent in/tangent out order.
            const keyValues = buffer.createTypedArray(Float32Array, tableIdx + 0x0C, keyCount * 4, Endianness.BIG_ENDIAN);

            kfa1.push({ keyType, isLoopEnable, keyValues });
        } else if (fourcc === 'FLD1') {
            // J3DFieldBlock

            // Contains physics simulation fields that act on the particles.
            const flags = view.getUint32(tableIdx + 0x08);
            const type: JPAFieldType = flags & 0x0F;
            const velType: JPAFieldVelType = (flags >>> 8) & 0x03;

            const posX = view.getFloat32(tableIdx + 0x0C);
            const posY = view.getFloat32(tableIdx + 0x10);
            const posZ = view.getFloat32(tableIdx + 0x14);
            const pos = vec3.fromValues(posX, posY, posZ);

            const dirX = view.getFloat32(tableIdx + 0x18);
            const dirY = view.getFloat32(tableIdx + 0x1C);
            const dirZ = view.getFloat32(tableIdx + 0x20);
            const dir = vec3.fromValues(dirX, dirY, dirZ);

            const param1 = view.getFloat32(tableIdx + 0x24);
            const param2 = view.getFloat32(tableIdx + 0x28);
            const param3 = view.getFloat32(tableIdx + 0x2C);
            const fadeIn = view.getFloat32(tableIdx + 0x30);
            const fadeOut = view.getFloat32(tableIdx + 0x34);
            const enTime = view.getFloat32(tableIdx + 0x38);
            const disTime = view.getFloat32(tableIdx + 0x3C);
            const cycle = view.getUint8(tableIdx + 0x40);

            let fadeInRate = 1;
            if (fadeIn > 0)
                fadeInRate = 1 / fadeIn;

            let fadeOutRate = 1;
            if (fadeOut > 0)
                fadeOutRate = 1 / fadeOut;
    
            fld1.push({ flags, type, velType, pos, dir, param1: param1, param2: param2, param3: param3, fadeIn, fadeOut, enTime, disTime, cycle, fadeInRate, fadeOutRate });
        } else if (fourcc === 'TDB1') {
            // Not a block. Stores a mapping of particle texture indexes
            // to JPAC texture indices -- I assume this is "Texture Database".
            tdb1 = buffer.subarray(tableIdx + 0x08, blockSize - 0x08).createTypedArray(Uint16Array, 0, undefined, Endianness.BIG_ENDIAN);
        } else {
            throw "whoops";
        }

        tableIdx += blockSize;
    }

    assert(fld1.length === fieldBlockCount);
    assert(kfa1.length === keyBlockCount);

    return {
        bem1: assertExists(bem1),
        bsp1: assertExists(bsp1),
        esp1,
        etx1,
        ssp1,
        fld1,
        kfa1,
        tdb1: assertExists(tdb1),
    };
}

export function parse(buffer: ArrayBufferSlice): JPAC {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x08) === 'JPAC2-10');

    const effectCount = view.getUint16(0x08);
    const textureCount = view.getUint16(0x0A);
    const textureTableOffs = view.getUint32(0x0C);

    const effects: JPAResourceRaw[] = [];
    let effectTableIdx = 0x10;
    for (let i = 0; i < effectCount; i++) {
        const resourceBeginOffs = effectTableIdx;

        const resourceId = view.getUint16(effectTableIdx + 0x00);
        const blockCount = view.getUint16(effectTableIdx + 0x02);

        effectTableIdx += 0x08;

        // Quickly skim through the blocks.
        for (let j = 0; j < blockCount; j++) {
            // blockSize includes the header.
            const blockSize = view.getUint32(effectTableIdx + 0x04);
            effectTableIdx += blockSize;
        }

        const data = buffer.slice(resourceBeginOffs, effectTableIdx);
        effects.push({ resourceId, data });
    }

    const textures: BTI[] = [];
    let textureTableIdx = textureTableOffs;
    for (let i = 0; i < textureCount; i++) {
        assert(readString(buffer, textureTableIdx + 0x00, 0x04, false) === 'TEX1');
        const blockSize = view.getUint32(textureTableIdx + 0x04);
        const textureName = readString(buffer, textureTableIdx + 0x0C, 0x14, true);
        const texture = BTI.parse(buffer.slice(textureTableIdx + 0x20, textureTableIdx + blockSize), textureName);
        textures.push(texture);
        textureTableIdx += blockSize;
    }

    return { effects, textures };
}
