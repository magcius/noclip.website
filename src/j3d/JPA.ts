
// JParticle's JPAC2-10 resource file, as seen in Super Mario Galaxy, amongst other
// Nintendo games. JPAC1-00 is an older variant which is unsupported.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists } from "../util";
import { BTI, BTI_Texture } from "./j3d";
import { vec3, mat4, vec2 } from "gl-matrix";
import { Endianness } from "../endian";
import { GfxDevice, GfxProgram } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { BTIData } from "./render";
import { getPointHermite } from "../Spline";
import { GXMaterial, AlphaTest, RopInfo, TexGen, TevStage, GX_Program } from "../gx/gx_material";
import * as GX from "../gx/gx_enum";
import { Color, colorNew, colorCopy, colorNewCopy, White } from "../Color";

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

const enum JPABSPType {
    Point            = 0x00,
    Line             = 0x01,
    BillBoard        = 0x02,
    Directional      = 0x03,
    DirectionalCross = 0x04,
    Stripe           = 0x05,
    StripeCross      = 0x06,
    Rotation         = 0x07,
    Particle         = 0x08,
    DirBillBoard     = 0x09,
    YBillBoard       = 0x0A,
}

export interface JPABaseShapeBlock {
    flags: number;
    type: JPABSPType;
    texIdx: number;
    texIdxAnimData: Uint16Array | null;
    blendModeFlags: number;
    zModeFlags: number;
    alphaCompareFlags: number;
    alphaRef0: number;
    alphaRef1: number;
    texFlags: number;
    colorFlags: number;
    colorPrm: Color;
    colorEnv: Color;
}

export interface JPAExtraShapeBlock {
    flags: number;
}

export interface JPAExTexBlock {
}

export interface JPAChildShapeBlock {
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
    mag: number;
    magRndm: number;
    maxDist: number;
    fadeIn: number;
    fadeOut: number;
    disTime: number;
    enTime: number;
    cycle: boolean;
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

function getTIMGFromTDB1(jpac: JPAC, res: JPAResource, idx: number): BTI_Texture {
    return jpac.textures[res.tdb1[idx]].texture;
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

export class JPAResourceData {
    public res: JPAResource;
    public texData: BTIData[] = [];
    public program: GfxProgram;

    constructor(device: GfxDevice, cache: GfxRenderCache, private jpac: JPAC, resRaw: JPAResourceRaw) {
        this.res = parseResource(resRaw);

        const bsp1 = this.res.bsp1;

        // Translate all of the texture data.
        if (this.res.bsp1.texIdxAnimData !== null) {
            for (let i = 0; i < bsp1.texIdxAnimData.length; i++)
                this.texData.push(new BTIData(device, getTIMGFromTDB1(this.jpac, this.res, bsp1.texIdxAnimData[i])));
        } else {
            this.texData.push(new BTIData(device, getTIMGFromTDB1(this.jpac, this.res, bsp1.texIdx)));
        }

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

        // TODO(jstpierre): Translate TexGens (relies on flags)
        const texGens: TexGen[] = [];

        const tevStages: TevStage[] = [];
        const colorInSelect = (bsp1.flags >>> 0x10) & 0x07;
        const alphaInSelect = (bsp1.flags >>> 0x12) & 0x01;

        tevStages.push({
            index: 0,

            texCoordId: GX.TexCoordID.TEXCOORD0,
            texMap: GX.TexMapID.TEXMAP0,
            channelId: GX.RasColorChannelID.COLOR_ZERO,
            konstColorSel: GX.KonstColorSel.KCSEL_1,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

            // GXSetTevColorIn() is called in JPABaseShape::setGX()
            colorInA: st_ca[colorInSelect * 4 + 0],
            colorInB: st_ca[colorInSelect * 4 + 1],
            colorInC: st_ca[colorInSelect * 4 + 2],
            colorInD: st_ca[colorInSelect * 4 + 3],

            // GXSetTevAlphaIn() is called in JPABaseShape::setGX()
            alphaInA: st_aa[alphaInSelect * 4 + 0],
            alphaInB: st_aa[alphaInSelect * 4 + 1],
            alphaInC: st_aa[alphaInSelect * 4 + 2],
            alphaInD: st_aa[alphaInSelect * 4 + 3],

            // GXSetTevColorOp() is called in JPAEmitterManager::draw()
            alphaOp: GX.TevOp.ADD,
            alphaBias: GX.TevBias.ZERO,
            alphaScale: GX.TevScale.SCALE_1,
            alphaClamp: true,
            alphaRegId: GX.Register.PREV,

            // GXSetTevAlphaOp() is called in JPAEmitterManager::draw()
            colorOp: GX.TevOp.ADD,
            colorBias: GX.TevBias.ZERO,
            colorScale: GX.TevScale.SCALE_1,
            colorClamp: true,
            colorRegId: GX.Register.PREV,

            // GXSetTevDirect(0) is called in JPABaseShape::setGX()
            // TODO(jstpierre): JPAExTexShape can have indirect.
            ... noIndTex,
        });

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
            indTexStages: [],
            alphaTest,
            ropInfo,
        };

        const program = new GX_Program(gxMaterial);
        this.program = cache.createProgram(device, program);
    }

    private calcTexIdx(): void {
        const calcTexIdxType: CalcIdxType = (this.res.bsp1.texFlags >>> 2) & 0x07;
        const calcOnParticle = !!(this.res.bsp1.flags & 0x00004000);
    }

    private calcColor(): void {
        const calcPrmColor = !!(this.res.bsp1.colorFlags & 0x02);
        const calcEnvColor = !!(this.res.bsp1.colorFlags & 0x08);
        const calcColorIdxType: CalcIdxType = (this.res.bsp1.colorFlags >>> 4) & 0x07;
        const calcOnParticle = !!(this.res.bsp1.flags & 0x00001000);
    }

    private calcTexGen(): void {
        const isPrj = !!(this.res.bsp1.texFlags & 0x00100000);
        const isAnm = !!(this.res.bsp1.texFlags & 0x01000000);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.texData.length; i++)
            this.texData[i].destroy(device);
    }
}

function hermiteInterpolate(k: Float32Array, i1: number, t: number): number {
    const k0Idx = i1 - 4;
    const k1Idx = i1;
    const length = k[k1Idx] - k[k0Idx];
    const p0 = k[k0Idx + 1];
    const p1 = k[k1Idx + 1];
    const s0 = k[k0Idx + 3] * length;
    const s1 = k[k1Idx + 2] * length;
    return getPointHermite(p0, p1, s0, s1, t);
}

function kfa1Findi1(kfa1: JPAKeyBlock, t: number): number {
    // TODO(jstpierre): isLoopEnable
    let i: number;
    for (i = 0; i < kfa1.keyValues.length; i += 4) {
        const kt = kfa1.keyValues[i + 0];
        // Find the first frame that's past us -- that's our i1.
        if (kt > t)
            break;
    }
    return i;
}

function kfa1Calc(kfa1: JPAKeyBlock, t: number): number {
    const i1 = kfa1Findi1(kfa1, t);
    if (i1 === 0)
        return kfa1.keyValues[i1 + 1];
    else
        return hermiteInterpolate(kfa1.keyValues, i1, t);
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

const enum BaseEmitterFlags {
    FIRST_EMISSION = 0x10,
    RATE_STEP_EMIT = 0x20,
}

class JPAEmitterWorkData {
    public baseEmitter: JPABaseEmitter;
    public random: JPARandom = new_rndm();

    public volumePos = vec3.create();
    public velOmni = vec3.create();
    public velAxis = vec3.create();
    public volumeSize: number;
    public volumeMinRad: number;
    public volumeSweep: number;

    public directionMtx = mat4.create();
    public rotationMatrix = mat4.create();
    public globalRotation = mat4.create();
    public globalSR = mat4.create();
    public emitterPosition = vec3.create();
    public globalScale = vec3.create();
    public globalEmitterDir = vec3.create();
    public publicScale = vec3.create();
    public globalPosition = vec3.create();
    public particleScaleX: number;
    public particleScaleY: number;

    public ybbCamMtx = mat4.create();
    public posCamMtx = mat4.create();
    public prjMtx = mat4.create();
}

class JPAEmitterManager {
    public workData = new JPAEmitterWorkData();
    public deadParticlePool: JPABaseParticle[] = [];
    public deadEmitterPool: JPABaseEmitter[] = [];
    public aliveEmitters: JPABaseEmitter[] = [];

    constructor(private maxParticleCount: number, private maxEmitterCount: number) {
        for (let i = 0; i < this.maxEmitterCount; i++)
            this.deadEmitterPool.push(new JPABaseEmitter(this));
        for (let i = 0; i < this.maxParticleCount; i++)
            this.deadParticlePool.push(new JPABaseParticle());
    }

    public createEmitter(resData: JPAResourceData): JPABaseEmitter | null {
        if (this.deadEmitterPool.length === 0)
            return null;

        const emitter = this.deadEmitterPool.pop();
        emitter.init(resData);
        this.aliveEmitters.push(emitter);
        return emitter;
    }
}

export class JPABaseEmitter {
    private flags: BaseEmitterFlags;
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
    public currentTime: number;
    public scaleOut: number;
    public texAnmIdx: number;
    public emitCount: number;
    public random: JPARandom = new_rndm();
    public rateStepTimer: number;
    public colorPrm: Color = colorNewCopy(White);
    public colorEnv: Color = colorNewCopy(White);

    public globalColorPrm: Color = colorNewCopy(White);
    public globalColorEnv: Color = colorNewCopy(White);

    // These are the public APIs to affect an emitter's placement.
    public globalRotation = mat4.create();
    public globalScale = vec3.create();
    public globalTranslation = vec3.create();
    public globalScale2D = vec2.create();

    constructor(private emitterManager: JPAEmitterManager) {
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
        vec2.set(this.globalScale2D, 0, 0);
        colorCopy(this.globalColorPrm, White);
        colorCopy(this.globalColorEnv, White);
        colorCopy(this.colorPrm, bsp1.colorPrm);
        colorCopy(this.colorEnv, bsp1.colorEnv);
        this.emitCount = 0;
        this.currentTime = 0;
        this.rateStepTimer = 0;
        this.texAnmIdx = 0;
        this.flags = BaseEmitterFlags.FIRST_EMISSION | BaseEmitterFlags.RATE_STEP_EMIT;
    }

    private calcKey(): void {
        for (let i = 0; i < this.resData.res.kfa1.length; i++) {
            const kfa1 = this.resData.res.kfa1[i];
            const v = kfa1Calc(kfa1, this.currentTime);
            if (kfa1.keyType === JPAKeyType.Rate)
                this.rate = v;
            else if (kfa1.keyType === JPAKeyType.VolumeSize)
                this.volumeSize = v;
            else if (kfa1.keyType === JPAKeyType.VolumeSweep)
                throw "whoops"; // this.volumeSweep = v;
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
            else if (kfa1.keyType === 0x0A)
                this.scaleOut = v; // Unknown
            else
                throw "whoops";
        }
    }

    private calcVolumeCube(workData: JPAEmitterWorkData): void {
        const rndX = get_rndm_f(this.random) - 0.5;
        const rndY = get_rndm_f(this.random) - 0.5;
        const rndZ = get_rndm_f(this.random) - 0.5;
        vec3.set(workData.volumePos, rndX * this.volumeSize, rndY * this.volumeSize, rndZ * this.volumeSize);
        vec3.mul(workData.velOmni, workData.volumePos, this.globalScale);
        vec3.set(workData.velAxis, workData.volumePos[0], 0.0, workData.volumePos[2]);
    }

    private calcVolumeSphere(workData: JPAEmitterWorkData): void {
        throw "whoops";
    }

    private calcVolumeCylinder(workData: JPAEmitterWorkData): void {
        throw "whoops";
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
        throw "whoops";
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
        this.calcVolume(this.emitterManager.workData);
        particle.init_p(this.emitterManager.workData);
        return particle;
    }

    private create(): void {
        // JPADynamicsBlock::create()

        const bem1 = this.resData.res.bem1;

        if (!!(this.flags & BaseEmitterFlags.RATE_STEP_EMIT)) {
            if (!!(bem1.flags & 0x02)) {
                // Fixed Interval
                if (bem1.volumeType === JPAVolumeType.Sphere)
                    this.emitCount = bem1.divNumber * bem1.divNumber * 4 + 2;
                else
                    this.emitCount = bem1.divNumber;
            } else {
                // Rate
                const emitCountIncr = bem1.rate + (bem1.rate * bem1.rateRndm * get_r_zp(this.random));
                this.emitCount += emitCountIncr;

                // If this is the first emission and we got extremely bad luck, force a particle.
                if (!!(this.flags & BaseEmitterFlags.FIRST_EMISSION) && this.rate != 0 && this.emitCount < 1.0)
                    this.emitCount = 1;
            }

            while (this.emitCount > 1.0) {
                this.createParticle();
                this.emitCount--;
            }
        }

        this.rateStepTimer++;
        if (this.rateStepTimer >= bem1.rateStep + 1) {
            this.rateStepTimer -= bem1.rateStep - 1;
            this.flags |= BaseEmitterFlags.RATE_STEP_EMIT;
        } else {
            this.flags &= ~BaseEmitterFlags.RATE_STEP_EMIT;
        }

        // Unmark as first emission.
        this.flags &= ~BaseEmitterFlags.FIRST_EMISSION;
    }
}

function normToLengthAndAdd(dst: vec3, a: vec3, len: number): void {
    const inv = len / vec3.length(a);
    dst[0] += a[0] * inv;
    dst[1] += a[1] * inv;
    dst[2] += a[2] * inv;
}

const scratchMatrix = mat4.create();
export class JPABaseParticle {
    public local = vec3.create();
    public localPosition = vec3.create();
    public globalPosition = vec3.create();
    public velocity = vec3.create();
    public velType1 = vec3.create();
    public velType0 = vec3.create();
    public velType2 = vec3.create();
    public upVector = vec3.create();

    public scaleX: number;
    public scaleY: number;
    public scaleOut: number;
    public alphaWaveRandom: number;
    public lifeTime: number;
    public time: number;
    public rotateAngle: number;
    public rotateSpeed: number;
    public colorPrm = colorNewCopy(White);
    public colorEnv = colorNewCopy(White);
    public texAnmIdx: number;
    public prmColorAlphaAnm: number;
    public moment: number;

    public init_p(workData: JPAEmitterWorkData): void {
        const baseEmitter = workData.baseEmitter;
        const bem1 = baseEmitter.resData.res.bem1;
        const esp1 = baseEmitter.resData.res.esp1;

        const lifeTimeRandom = get_rndm_f(baseEmitter.random);
        this.lifeTime = baseEmitter.lifeTime * (1.0 - lifeTimeRandom * bem1.lifeTimeRndm);
        vec3.transformMat4(this.localPosition, workData.volumePos, workData.globalSR);

        if (!!(bem1.flags & 0x08)) {
            // this->field_7c = this->field_7c | 0x20;
        }
        vec3.copy(this.globalPosition, workData.globalPosition);

        this.local[0] = this.globalPosition[0] + this.localPosition[0] * workData.publicScale[0];
        this.local[1] = this.globalPosition[1] + this.localPosition[1] * workData.publicScale[1];
        this.local[2] = this.globalPosition[2] + this.localPosition[2] * workData.publicScale[2];

        vec3.set(this.velType1, 0, 0, 0);

        if (baseEmitter.initialVelOmni !== 0)
            normToLengthAndAdd(this.velType1, workData.velOmni, baseEmitter.initialVelOmni);
        if (baseEmitter.initialVelAxis !== 0)
            normToLengthAndAdd(this.velType1, workData.velAxis, baseEmitter.initialVelAxis);
        if (baseEmitter.initialVelDir !== 0) {
            const randZ = next_rndm(baseEmitter.random) >>> 16;
            const randY = get_r_zp(baseEmitter.random);
            mat4.identity(scratchMatrix);
            mat4.rotateZ(scratchMatrix, scratchMatrix, randZ / 0xFFFF);
            mat4.rotateY(scratchMatrix, scratchMatrix, randY / 0xFFFF);
            mat4.mul(scratchMatrix, workData.directionMtx, scratchMatrix);
            this.velType1[0] += baseEmitter.initialVelDir * scratchMatrix[8];
            this.velType1[1] += baseEmitter.initialVelDir * scratchMatrix[9];
            this.velType1[2] += baseEmitter.initialVelDir * scratchMatrix[10];
        }
        if (baseEmitter.initialVelDir !== 0) {
            const randZ = get_rndm_f(baseEmitter.random) - 0.5;
            const randY = get_rndm_f(baseEmitter.random) - 0.5;
            const randX = get_rndm_f(baseEmitter.random) - 0.5;
            this.velType1[0] += randX;
            this.velType1[1] += randY;
            this.velType1[2] += randZ;
        }
        this.velType1[0] *= bem1.initialVelRatio;
        this.velType1[1] *= bem1.initialVelRatio;
        this.velType1[2] *= bem1.initialVelRatio;

        if (!!(bem1.flags & 0x04)) {
            this.velType1[0] *= baseEmitter.emitterScl[0];
            this.velType1[1] *= baseEmitter.emitterScl[1];
            this.velType1[2] *= baseEmitter.emitterScl[2];
        }

        vec3.transformMat4(this.velType1, this.velType1, workData.globalRotation);
        vec3.set(this.velType0, 0, 0, 0);

        this.moment = 1.0 - (bem1.moment * get_rndm_f(baseEmitter.random));
        vec3.set(this.upVector, workData.globalRotation[1], workData.globalRotation[5], workData.globalRotation[9]);

        colorCopy(this.colorPrm, baseEmitter.colorPrm);
        colorCopy(this.colorEnv, baseEmitter.colorEnv);

        // ScaleX/Y/Out
        // AlphaWaveRandom

        if (esp1 !== null && !!(esp1.flags & 0x01000000)) {
            //
        } else {
            this.rotateAngle = 0;
            this.rotateSpeed = 0;
        }

        this.time = 0.0;
    }
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
            const type: JPABSPType = flags & 0x0F;

            const texIdx = view.getUint8(tableIdx + 0x20);

            const blendModeFlags = view.getUint16(tableIdx + 0x18);
            const alphaCompareFlags = view.getUint8(tableIdx + 0x1A);
            const alphaRef0 = view.getUint8(tableIdx + 0x1B);
            const alphaRef1 = view.getUint8(tableIdx + 0x1C);
            const zModeFlags = view.getUint8(tableIdx + 0x1D);
            const texFlags = view.getUint8(tableIdx + 0x1E);
            const colorFlags = view.getUint8(tableIdx + 0x21);

            const colorPrmR = view.getUint8(tableIdx + 0x26) / 0xFF;
            const colorPrmG = view.getUint8(tableIdx + 0x27) / 0xFF;
            const colorPrmB = view.getUint8(tableIdx + 0x28) / 0xFF;
            const colorPrmA = view.getUint8(tableIdx + 0x29) / 0xFF;
            const colorPrm = colorNew(colorPrmR, colorPrmG, colorPrmB, colorPrmA);
            const colorEnvR = view.getUint8(tableIdx + 0x2A) / 0xFF;
            const colorEnvG = view.getUint8(tableIdx + 0x2B) / 0xFF;
            const colorEnvB = view.getUint8(tableIdx + 0x2C) / 0xFF;
            const colorEnvA = view.getUint8(tableIdx + 0x2D) / 0xFF;
            const colorEnv = colorNew(colorEnvR, colorEnvG, colorEnvB, colorEnvA);

            let extraDataOffs = 0x34;

            if (!!(flags & 0x1000000)) {
                // mpTexCrdMtxAnimData
                extraDataOffs += 0x28;
            }

            let texIdxAnimData: Uint16Array | null = null;
            if (!!(texFlags & 0x01)) {
                texIdxAnimData = buffer.createTypedArray(Uint16Array, extraDataOffs, undefined, Endianness.BIG_ENDIAN);
            }

            bsp1 = {
                flags, type, blendModeFlags, alphaCompareFlags, alphaRef0, alphaRef1, zModeFlags,
                texFlags, texIdx, texIdxAnimData,
                colorFlags, colorPrm, colorEnv,
            };
        } else if (fourcc === 'ESP1') {
            // J3DExtraShape

            // Contains misc. extra particle draw settings.

            esp1 = { flags: 0 };
        } else if (fourcc === 'SSP1') {
            // J3DChildShape

            // Contains child particle draw settings.

            ssp1 = {};
        } else if (fourcc === 'ETX1') {
            // J3DExTexShape

            // Contains extra texture draw settings.

            etx1 = {};
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

            const mag = view.getFloat32(tableIdx + 0x24);
            const magRndm = view.getFloat32(tableIdx + 0x28);
            const maxDist = view.getFloat32(tableIdx + 0x2C);
            const fadeIn = view.getFloat32(tableIdx + 0x30);
            const fadeOut = view.getFloat32(tableIdx + 0x34);
            const enTime = view.getFloat32(tableIdx + 0x38);
            const disTime = view.getFloat32(tableIdx + 0x3C);
            const cycle = !!view.getUint8(tableIdx + 0x40);

            fld1.push({ flags, type, velType, pos, dir, mag, magRndm, maxDist, fadeIn, fadeOut, enTime, disTime, cycle });
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
