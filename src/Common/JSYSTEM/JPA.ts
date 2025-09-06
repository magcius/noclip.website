
// Nintendo's JParticle engine, commonly abbreviated "JPA" for short.

// Has support for the following JPA versions, as seen in the following games:
//  * JEFFjpa1, as seen in Super Mario Sunshine
//  * JPAC1_00, as seen in The Legend of Zelda: The Wind Waker
//  * JPAC2_10, as seen in Super Mario Galaxy 1 & 2
//
// Known gaps in JPA2 support:
//  * Point shape types
//
// Known gaps in JPA1 support:
//  * Point shape types
//  * ETX1 SubTexture

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import * as GX from "../../gx/gx_enum.js";

import { assert, readString, assertExists, nArray, align } from "../../util.js";
import { vec3, mat4, vec2, ReadonlyVec3, ReadonlyMat4 } from "gl-matrix";
import { Endianness } from "../../endian.js";
import { GfxDevice, GfxInputLayout, GfxBuffer, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage, GfxBufferFrequencyHint, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferDescriptor, GfxTexture, GfxTextureDimension, GfxSamplerFormatKind, makeTextureDescriptor2D, GfxBindings, GfxBindingLayoutDescriptor } from "../../gfx/platform/GfxPlatform.js";
import { getPointHermite } from "../../Spline.js";
import { getVertexInputLocation, GX_Program } from "../../gx/gx_material.js";
import { type Color, colorNewFromRGBA, colorCopy, colorNewCopy, White, colorFromRGBA8, colorLerp, colorMult, colorNewFromRGBA8, colorToRGBA8 } from "../../Color.js";
import { MaterialParams, ColorKind, DrawParams, fillIndTexMtx, fillTextureSize, fillTextureBias } from "../../gx/gx_render.js";
import { GXMaterialHelperGfx } from "../../gx/gx_render.js";
import { computeModelMatrixSRT, computeModelMatrixR, lerp, MathConstants, normToLengthAndAdd, normToLength, isNearZeroVec3, transformVec3Mat4w1, transformVec3Mat4w0, setMatrixTranslation, setMatrixAxis, Vec3Zero, vec3SetAll, bitsAsFloat32, isNearZero } from "../../MathHelpers.js";
import { GfxRenderInst, GfxRenderInstManager, makeSortKeyTranslucent, GfxRendererLayer, setSortKeyBias, setSortKeyDepth } from "../../gfx/render/GfxRenderInstManager.js";
import { fillMatrix4x3, fillColor, fillMatrix4x2, fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../../Camera.js";
import { makeTriangleIndexBuffer, GfxTopology, getTriangleIndexCountForTopologyIndexCount } from "../../gfx/helpers/TopologyHelpers.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { TextureMapping } from "../../TextureHolder.js";
import { GXMaterialBuilder } from "../../gx/GXMaterialBuilder.js";
import { BTIData, BTI, BTI_Texture } from "./JUTTexture.js";
import { VertexAttributeInput } from "../../gx/gx_displaylist.js";
import { dfRange, dfShow } from "../../DebugFloaters.js";
import { Frustum } from "../../Geometry.js";
import { createBufferFromData } from "../../gfx/helpers/BufferHelpers.js";

const SORT_PARTICLES = false;
const USE_INSTANCING = true;

//#region JPA Engine
export interface JPAResourceRaw {
    resourceId: number;
    data: ArrayBufferSlice;
    texIdBase: number;
}

export interface JPAC {
    version: JPACVersion;
    effects: JPAResourceRaw[];
    textures: BTI[];
}

const enum VolumeType {
    Cube     = 0x00,
    Sphere   = 0x01,
    Cylinder = 0x02,
    Torus    = 0x03,
    Point    = 0x04,
    Circle   = 0x05,
    Line     = 0x06,
}

const enum EmitFlags {
    FixedDensity        = 0x01,
    FixedInterval       = 0x02,
    InheritScale        = 0x04,
    FollowEmitter       = 0x08,
    FollowEmitterChild  = 0x10,
}

interface JPADynamicsBlock {
    emitFlags: EmitFlags;
    volumeType: VolumeType;
    emitterScl: ReadonlyVec3;
    emitterRot: ReadonlyVec3;
    emitterTrs: ReadonlyVec3;
    emitterDir: ReadonlyVec3;
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
    airResistRndm: number;
    moment: number;
    momentRndm: number;
    accel: number;
    accelRndm: number;
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
    Y       = 0x00,
    X       = 0x01,
    Z       = 0x02,
    XYZ     = 0x03,
    YJiggle = 0x04,
}

const enum PlaneType {
    XY = 0x00,
    XZ = 0x01,
    X  = 0x02,
}

interface CommonShapeTypeFields {
    shapeType: ShapeType;
    dirType: DirType;
    rotType: RotType;
    planeType: PlaneType;
}

interface JPABaseShapeBlock {
    shapeType: ShapeType;
    dirType: DirType;
    rotType: RotType;
    planeType: PlaneType;
    baseSize: vec2;
    tilingS: number;
    tilingT: number;
    isDrawFwdAhead: boolean;
    isDrawPrntAhead: boolean;
    isNoDrawParent: boolean;
    isNoDrawChild: boolean;

    // TEV/PE Settings
    colorInSelect: number;
    alphaInSelect: number;
    blendModeFlags: number;
    alphaCompareFlags: number;
    alphaRef0: number;
    alphaRef1: number;
    zModeFlags: number;

    anmRndm: number;

    // Texture Palette Animation
    isEnableTexture: boolean;
    isGlblTexAnm: boolean;
    texCalcIdxType: CalcIdxType;
    texIdx: number;
    texIdxAnimData: Uint8Array | null;
    texIdxLoopOfstMask: number;

    // Texture Coordinate Animation
    isEnableProjection: boolean;
    isEnableTexScrollAnm: boolean;
    texInitTransX: number;
    texInitTransY: number;
    texInitScaleX: number;
    texInitScaleY: number;
    texInitRot: number;
    texIncTransX: number;
    texIncTransY: number;
    texIncScaleX: number;
    texIncScaleY: number;
    texIncRot: number;

    // Color Animation Settings
    isGlblClrAnm: boolean;
    isEnableAnmTone: boolean;
    colorCalcIdxType: CalcIdxType;
    colorPrm: Color;
    colorEnv: Color;
    colorPrmAnimData: Color[] | null;
    colorEnvAnimData: Color[] | null;
    colorAnimMaxFrm: number;
    colorLoopOfstMask: number;
}

const enum CalcIdxType {
    Normal  = 0x00,
    Repeat  = 0x01,
    Reverse = 0x02,
    Merge   = 0x03,
    Random  = 0x04,
}

const enum CalcScaleAnmType {
    Normal  = 0x00,
    Repeat  = 0x01,
    Reverse = 0x02,
}

const enum CalcAlphaWaveType {
    None    = -1,
    NrmSin  = 0x00,
    AddSin  = 0x01,
    MultSin = 0x02,
}

interface JPAExtraShapeBlock {
    isEnableScale: boolean;
    isDiffXY: boolean;
    isEnableScaleBySpeedX: boolean;
    isEnableScaleBySpeedY: boolean;
    scaleAnmTypeX: CalcScaleAnmType;
    scaleAnmTypeY: CalcScaleAnmType;
    isEnableRotate: boolean;
    isEnableAlpha: boolean;
    alphaWaveType: CalcAlphaWaveType;
    pivotX: number;
    pivotY: number;
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
    alphaWaveParam1: number;
    alphaWaveParam2: number;
    alphaWaveParam3: number;
    alphaWaveRandom: number;
    rotateAngle: number;
    rotateAngleRandom: number;
    rotateSpeed: number;
    rotateSpeedRandom: number;
    rotateDirection: number;
}

const enum IndTextureMode {
    Off    = 0x00,
    Normal = 0x01,
    Sub    = 0x02,
}

interface JPAExTexBlock {
    indTextureMode: IndTextureMode;
    indTextureMtx: Float32Array;
    indTextureID: number;
    subTextureID: number;
    secondTextureIndex: number;
}

interface JPAChildShapeBlock {
    isInheritedScale: boolean;
    isInheritedRGB: boolean;
    isInheritedAlpha: boolean;
    isEnableAlphaOut: boolean;
    isEnableField: boolean;
    isEnableRotate: boolean;
    isEnableScaleOut: boolean;
    shapeType: ShapeType;
    dirType: DirType;
    rotType: RotType;
    planeType: PlaneType;
    posRndm: number;
    baseVel: number;
    baseVelRndm: number;
    velInfRate: number;
    gravity: number;
    globalScale2D: vec2;
    inheritScale: number;
    inheritAlpha: number;
    inheritRGB: number;
    colorPrm: Color;
    colorEnv: Color;
    timing: number;
    life: number;
    rate: number;
    step: number;
    texIdx: number;
    rotateSpeed: number;
}

const enum FieldType {
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

const enum FieldAddType {
    FieldAccel    = 0x00,
    BaseVelocity  = 0x01,
    FieldVelocity = 0x02,
}

const enum FieldStatusFlag {
    // TODO(jstpierre): Air uses 0x01 flag
    LocalSpace     = 0x02,
    AirDrag        = 0x04,

    FadeUseEnTime  = 0x08,
    FadeUseDisTime = 0x10,
    FadeUseFadeIn  = 0x20,
    FadeUseFadeOut = 0x40,
    FadeFlagMask   = (FadeUseEnTime | FadeUseDisTime | FadeUseFadeIn | FadeUseFadeOut),

    UseMaxDist     = 0x80,
}

interface JPAFieldBlock {
    sttFlag: FieldStatusFlag;
    type: FieldType;
    addType: FieldAddType;
    // Used by JPA1 and JEFFjpa1
    maxDistSq: number;
    pos: ReadonlyVec3;
    dir: ReadonlyVec3;
    fadeIn: number;
    fadeOut: number;
    disTime: number;
    enTime: number;
    cycle: number;
    fadeInRate: number;
    fadeOutRate: number;

    // Used by Gravity, Air, Magnet, Newton, Vortex, Random, Drag, Convection, Spin
    mag: number;
    // Used by Drag
    magRndm: number;
    // Used by Newton, Air and Convection
    refDistance: number;
    // Used by Vortex and Spin
    innerSpeed: number;
    // Used by Vortex
    outerSpeed: number;
}

const enum JPAKeyType {
    None           = -1,
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

interface JPAKeyBlock {
    keyType: JPAKeyType;
    keyValues: Float32Array;
    isLoopEnable: boolean;
}

interface JPAResource {
    bem1: JPADynamicsBlock;
    bsp1: JPABaseShapeBlock;
    esp1: JPAExtraShapeBlock | null;
    etx1: JPAExTexBlock | null;
    ssp1: JPAChildShapeBlock | null;
    fld1: JPAFieldBlock[];
    kfa1: JPAKeyBlock[];
    tdb1: Uint16Array | null;
}

const st_bm: GX.BlendMode[]   = [ GX.BlendMode.NONE, GX.BlendMode.BLEND, GX.BlendMode.LOGIC ];
const st_bf: GX.BlendFactor[] = [ GX.BlendFactor.ZERO, GX.BlendFactor.ONE, GX.BlendFactor.SRCCLR, GX.BlendFactor.INVSRCCLR, GX.BlendFactor.SRCCLR, GX.BlendFactor.INVSRCCLR, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.BlendFactor.DSTALPHA, GX.BlendFactor.INVDSTALPHA ];
const st_c: GX.CompareType[]  = [ GX.CompareType.NEVER, GX.CompareType.LESS, GX.CompareType.LEQUAL, GX.CompareType.EQUAL, GX.CompareType.NEQUAL, GX.CompareType.GEQUAL, GX.CompareType.GREATER, GX.CompareType.ALWAYS ];
const st_ao: GX.AlphaOp[]     = [ GX.AlphaOp.AND, GX.AlphaOp.OR, GX.AlphaOp.XOR, GX.AlphaOp.XNOR ];
const st_ca: GX.CC[] = [
    GX.CC.ZERO, GX.CC.TEXC, GX.CC.ONE,  GX.CC.ZERO,
    GX.CC.ZERO, GX.CC.C0,   GX.CC.TEXC, GX.CC.ZERO,
    GX.CC.C0,   GX.CC.ONE,  GX.CC.TEXC, GX.CC.ZERO,
    GX.CC.C1,   GX.CC.C0,   GX.CC.TEXC, GX.CC.ZERO,
    GX.CC.ZERO, GX.CC.TEXC, GX.CC.C0,   GX.CC.C1  ,
    GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0  ,
];
const st_aa: GX.CA[] = [
    GX.CA.ZERO, GX.CA.TEXA, GX.CA.A0,   GX.CA.ZERO,
    GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A0  ,
];

function shapeTypeSupported(shapeType: ShapeType): boolean {
    return shapeType !== ShapeType.Point;
}

function isStripe(shapeType: ShapeType): boolean {
    return shapeType === ShapeType.Stripe || shapeType === ShapeType.StripeCross;
}

function isCross(shapeType: ShapeType): boolean {
    return shapeType === ShapeType.StripeCross || shapeType === ShapeType.DirectionCross || shapeType === ShapeType.RotationCross;
}

export class JPACData {
    // TODO(jstpierre): Use a global JPAResourceManager for textures.

    public texData: BTIData[] = [];
    public textureMapping: TextureMapping[] = [];

    constructor(public jpac: JPAC) {
    }

    public ensureTexture(cache: GfxRenderCache, index: number): void {
        assert(index !== undefined);
        if (this.texData[index] !== undefined)
            return;

        if (index >= 0) {
            this.texData[index] = new BTIData(cache.device, cache, this.jpac.textures[index].texture);
        } else {
            const imgData = new Uint8Array([
                0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x1A, 0xFF, 0x80, 0xFF, 0xD6, 0xFF,
                0x00, 0xFF, 0x80, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0xFF, 0xD6, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
                0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0xD6, 0xFF, 0x80, 0xFF, 0x1A, 0xFF, 0x00, 0xFF,
                0xFF, 0xFF, 0xFF, 0xFF, 0x80, 0xFF, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xD6, 0xFF, 0x00, 0xFF,
                0x00, 0xFF, 0xD6, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0xFF, 0x80, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
                0x00, 0xFF, 0x1A, 0xFF, 0x80, 0xFF, 0xD6, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF,
                0xFF, 0xFF, 0xFF, 0xFF, 0xD6, 0xFF, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x80, 0xFF, 0x00, 0xFF,
                0xD6, 0xFF, 0x80, 0xFF, 0x1A, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF,
            ]);
            const btiTexture: BTI_Texture = {
                name: 'JPADefaultTexture',
                width: 0x08, height: 0x08,
                format: GX.TexFormat.IA8,
                wrapS: GX.WrapMode.CLAMP,
                wrapT: GX.WrapMode.CLAMP,
                minFilter: GX.TexFilter.LINEAR,
                magFilter: GX.TexFilter.LINEAR,
                data: new ArrayBufferSlice(imgData.buffer),
                lodBias: 0, minLOD: 0, maxLOD: 100, mipCount: 1, maxAnisotropy: GX.Anisotropy._1,
                paletteData: null,
                paletteFormat: GX.TexPalette.IA8,
            };

            this.texData[index] = new BTIData(cache.device, cache, btiTexture);
        }

        if (this.textureMapping[index] === undefined) {
            this.textureMapping[index] = new TextureMapping();
            this.texData[index].fillTextureMapping(this.textureMapping[index]);
        }
    }

    public getTextureMappingReference(name: string): TextureMapping | null {
        for (let i = 0; i < this.jpac.textures.length; i++) {
            const bti = this.jpac.textures[i];
            if (bti.texture.name === name) {
                if (this.textureMapping[i] === undefined)
                    this.textureMapping[i] = new TextureMapping();
                return this.textureMapping[i];
            }
        }

        return null;
    }

    public fillTextureMapping(m: TextureMapping, index: number): void {
        m.copy(this.textureMapping[index]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = -1; i < this.texData.length; i++)
            if (this.texData[i] !== undefined)
                this.texData[i].destroy(device);
    }
}

export class JPAResourceData {
    public res: JPAResource;
    public supportedParticle: boolean = true;
    public supportedChild: boolean = true;
    public resourceId: number;
    public name: string;
    public materialHelperP: GXMaterialHelperGfx;
    public materialHelperC: GXMaterialHelperGfx | null = null;
    public usingInstancingP = false;
    public usingInstancingC = false;
    public textureIds: number[] = [];

    constructor(cache: GfxRenderCache, public jpacData: JPACData, resRaw: JPAResourceRaw) {
        this.res = parseResource(this.jpacData.jpac.version, resRaw);
        this.resourceId = resRaw.resourceId;

        const bsp1 = this.res.bsp1;
        const etx1 = this.res.etx1;
        const ssp1 = this.res.ssp1;

        if (!shapeTypeSupported(bsp1.shapeType)) {
            console.warn(`Unsupported particle shape type ${bsp1.shapeType}`);
            this.supportedParticle = false;
        }

        if (ssp1 !== null && !shapeTypeSupported(ssp1.shapeType)) {
            console.warn(`Unsupported child shape type ${ssp1.shapeType}`);
            this.supportedChild = false;
        }

        // Translate all of the texture data.
        const texIdBase = resRaw.texIdBase;
        if (bsp1.texIdxAnimData !== null) {
            for (let i = 0; i < bsp1.texIdxAnimData.length; i++)
                this.ensureTextureFromTDB1Index(cache, bsp1.texIdxAnimData[i], texIdBase);
        } else if (bsp1.isEnableTexture) {
            this.ensureTextureFromTDB1Index(cache, bsp1.texIdx, texIdBase);
        } else {
            this.textureIds[bsp1.texIdx] = -1;
            this.ensureTexture(cache, bsp1.texIdx);
        }

        if (etx1 !== null) {
            if (etx1.indTextureMode !== IndTextureMode.Off) {
                this.ensureTextureFromTDB1Index(cache, etx1.indTextureID, texIdBase);
                if (etx1.indTextureMode === IndTextureMode.Sub)
                    this.ensureTextureFromTDB1Index(cache, etx1.subTextureID, texIdBase);
            }

            if (etx1.secondTextureIndex !== -1)
                this.ensureTextureFromTDB1Index(cache, etx1.secondTextureIndex, texIdBase);
        }

        if (ssp1 !== null)
            this.ensureTextureFromTDB1Index(cache, ssp1.texIdx, texIdBase);

        this.createMaterial();
    }

    public createMaterial(): void {
        const bsp1 = this.res.bsp1;
        const etx1 = this.res.etx1;
        const ssp1 = this.res.ssp1;

        // Material.
        const mb = new GXMaterialBuilder(`JPA Material`);
        mb.setBlendMode(
            st_bm[(bsp1.blendModeFlags >>> 0) & 0x03],
            st_bf[(bsp1.blendModeFlags >>> 2) & 0x0F],
            st_bf[(bsp1.blendModeFlags >>> 6) & 0x0F],
        );
        mb.setZMode(
            !!((bsp1.zModeFlags >>> 0) & 0x01),
            st_c[(bsp1.zModeFlags >>> 1) & 0x07],
            !!((bsp1.zModeFlags >>> 4) & 0x01),
        );

        if (bsp1.isEnableAnmTone) {
            mb.setDynamicAlphaCompare(true);
            mb.setAlphaCompare(GX.CompareType.GEQUAL, 0, GX.AlphaOp.OR, GX.CompareType.NEVER, 0);
        } else {
            mb.setAlphaCompare(
                st_c[(bsp1.alphaCompareFlags >>> 0) & 0x07],
                bsp1.alphaRef0,
                st_ao[(bsp1.alphaCompareFlags >>> 3) & 0x03],
                st_c[(bsp1.alphaCompareFlags >>> 5) & 0x07],
                bsp1.alphaRef1,
            );
        }

        let texCoordId = GX.TexCoordID.TEXCOORD0;
        if (bsp1.isEnableProjection)
            mb.setTexCoordGen(texCoordId++, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX0);
        else
            mb.setTexCoordGen(texCoordId++, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        // GXSetTevColorIn(0) is called in JPABaseShape::setGX()
        mb.setTevColorIn(0,
            st_ca[bsp1.colorInSelect * 4 + 0],
            st_ca[bsp1.colorInSelect * 4 + 1],
            st_ca[bsp1.colorInSelect * 4 + 2],
            st_ca[bsp1.colorInSelect * 4 + 3],
        );
        // GXSetTevAlphaIn(0) is called in JPABaseShape::setGX()
        mb.setTevAlphaIn(0,
            st_aa[bsp1.alphaInSelect * 4 + 0],
            st_aa[bsp1.alphaInSelect * 4 + 1],
            st_aa[bsp1.alphaInSelect * 4 + 2],
            st_aa[bsp1.alphaInSelect * 4 + 3],
        );
        // GXSetTevColorOp(0) is called in JPAEmitterManager::draw()
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // ETX1 properties are read in JPAResource::setPTev()
        if (etx1 !== null) {
            if (etx1.indTextureMode !== IndTextureMode.Off) {
                const indTexCoordId = texCoordId++;
                mb.setTexCoordGen(indTexCoordId, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
                mb.setIndTexOrder(GX.IndTexStageID.STAGE0, indTexCoordId, GX.TexMapID.TEXMAP2);

                mb.setTevIndirect(0, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
            }

            if (etx1.secondTextureIndex !== -1) {
                const secondTexCoordId = texCoordId++;
                mb.setTexCoordGen(secondTexCoordId, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);

                mb.setTevOrder(1, secondTexCoordId, GX.TexMapID.TEXMAP3, GX.RasColorChannelID.COLOR_ZERO);
                mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.TEXC, GX.CC.CPREV, GX.CC.ZERO);
                mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
                mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            }
        }

        mb.setUsePnMtxIdx(false);

        let needsDynamicTextureIndex = false;
        if (bsp1.texIdxAnimData !== null && !bsp1.isGlblTexAnm) {
            assert(this.textureIds.length < 16);
            needsDynamicTextureIndex = true;
        }

        this.usingInstancingP = USE_INSTANCING && !isStripe(bsp1.shapeType);

        this.materialHelperP = new GXMaterialHelperGfx(mb.finish());
        if (this.usingInstancingP) {
            this.materialHelperP.material.userData = { needsDynamicTextureIndex };
            this.materialHelperP.createProgram(JPAInstancingProgram);
        }

        if (ssp1 !== null) {
            this.usingInstancingC = USE_INSTANCING && !isStripe(ssp1.shapeType);
            if (this.usingInstancingP !== this.usingInstancingC) {
                this.materialHelperC = new GXMaterialHelperGfx(mb.finish());
                if (this.usingInstancingC) {
                    this.materialHelperC.material.userData = { needsDynamicTextureIndex: false };
                    this.materialHelperC.createProgram(JPAInstancingProgram);
                }
            } else {
                this.materialHelperC = this.materialHelperP;
            }
        }
    }

    private ensureTexture(cache: GfxRenderCache, idx: number): void {
        this.jpacData.ensureTexture(cache, this.textureIds[idx]);
    }

    private ensureTextureFromTDB1Index(cache: GfxRenderCache, idx: number, tdb1Base: number): void {
        const texIndex = tdb1Base + ((this.res.tdb1 !== null) ? this.res.tdb1[idx] : idx);
        this.textureIds[idx] = texIndex;
        this.ensureTexture(cache, idx);
    }

    public fillTextureMapping(m: TextureMapping, idx: number): void {
        if (this.textureIds[idx] !== undefined)
            this.jpacData.fillTextureMapping(m, this.textureIds[idx]);
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

class JPAGlobalRes {
    public inputLayout: GfxInputLayout;

    public inputVertexQuad: GfxVertexBufferDescriptor[];
    public inputIndexQuad: GfxIndexBufferDescriptor;

    private vertexBufferQuad: GfxBuffer;
    private indexBufferQuad: GfxBuffer;

    constructor(cache: GfxRenderCache) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: getVertexInputLocation(VertexAttributeInput.POS),   format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0 },
            { location: getVertexInputLocation(VertexAttributeInput.TEX01), format: GfxFormat.F32_RG,  bufferIndex: 0, bufferByteOffset: 3*4 },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3*4+2*4, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        // The original JPA uses a number of different hardcoded vertex buffers
        // depending on PivotX/PivotY and PlaneType. We handle those differences with matrices
        // applied to this core quad.

        // Original code documentation:
        //
        // The used position array = BaseAddress + PivotOffs + (PlaneType * 0x6C)
        // PivotOffs = ((PivotY * 0x03) + PivotX) * 0x0C
        //
        // If the ESP1 block is missing, then PivotX/PivotY are assumed to be 1, so offset 0x30 is used.
        // Note that PlaneType is only used if the type is Direction or Rotation, so XZ plane types have
        // no Cross variants.
        //
        // Original data table as follows:
        //
        // Pivot X: 0  Pivot Y: 0  Plane Type: XY
        //   Offset  : 0x0000
        //   Normal  : [[0, 0, 0], [50, 0, 0], [50, -50, 0], [0, -50, 0]]
        //   Cross   : [[0, 0, 0], [0, 0, 50], [0, -50, 50], [0, -50, 0]]
        //
        // Pivot X: 0  Pivot Y: 0  Plane Type: XZ
        //   Offset  : 0x006c
        //   Normal  : [[0, 0, 0], [50, 0, 0], [50, 0, 50], [0, 0, 50]]
        //   Cross   : N/A
        //
        // Pivot X: 0  Pivot Y: 1  Plane Type: XY
        //   Offset  : 0x0024
        //   Normal  : [[0, 25, 0], [50, 25, 0], [50, -25, 0], [0, -25, 0]]
        //   Cross   : [[0, 25, 0], [0, 25, 50], [0, -25, 50], [0, -25, 0]]
        //
        // Pivot X: 0  Pivot Y: 1  Plane Type: XZ
        //   Offset  : 0x0090
        //   Normal  : [[0, 0, -25], [50, 0, -25], [50, 0, 25], [0, 0, 25]]
        //   Cross   : N/A
        //
        // Pivot X: 0  Pivot Y: 2  Plane Type: XY
        //   Offset  : 0x0048
        //   Normal  : [[0, 50, 0], [50, 50, 0], [50, 0, 0], [0, 0, 0]]
        //   Cross   : [[0, 50, 0], [0, 50, 50], [0, 0, 50], [0, 0, 0]]
        //
        // Pivot X: 0  Pivot Y: 2  Plane Type: XZ
        //   Offset  : 0x00b4
        //   Normal  : [[0, 0, -50], [50, 0, -50], [50, 0, 0], [0, 0, 0]]
        //   Cross   : N/A
        //
        // Pivot X: 1  Pivot Y: 0  Plane Type: XY
        //   Offset  : 0x000c
        //   Normal  : [[-25, 0, 0], [25, 0, 0], [25, -50, 0], [-25, -50, 0]]
        //   Cross   : [[0, 0, -25], [0, 0, 25], [0, -50, 25], [0, -50, -25]]
        //
        // Pivot X: 1  Pivot Y: 0  Plane Type: XZ
        //   Offset  : 0x0078
        //   Normal  : [[-25, 0, 0], [25, 0, 0], [25, 0, 50], [-25, 0, 50]]
        //   Cross   : N/A
        //
        // Pivot X: 1  Pivot Y: 1  Plane Type: XY
        //   Offset  : 0x0030
        //   Normal  : [[-25, 25, 0], [25, 25, 0], [25, -25, 0], [-25, -25, 0]]
        //   Cross   : [[0, 25, -25], [0, 25, 25], [0, -25, 25], [0, -25, -25]]
        //
        // Pivot X: 1  Pivot Y: 1  Plane Type: XZ
        //   Offset  : 0x009c
        //   Normal  : [[-25, 0, -25], [25, 0, -25], [25, 0, 25], [-25, 0, 25]]
        //   Cross   : N/A
        //
        // Pivot X: 1  Pivot Y: 2  Plane Type: XY
        //   Offset  : 0x0054
        //   Normal  : [[-25, 50, 0], [25, 50, 0], [25, 0, 0], [-25, 0, 0]]
        //   Cross   : [[0, 50, -25], [0, 50, 25], [0, 0, 25], [0, 0, -25]]
        //
        // Pivot X: 1  Pivot Y: 2  Plane Type: XZ
        //   Offset  : 0x00c0
        //   Normal  : [[-25, 0, -50], [25, 0, -50], [25, 0, 0], [-25, 0, 0]]
        //   Cross   : N/A
        //
        // Pivot X: 2  Pivot Y: 0  Plane Type: XY
        //   Offset  : 0x0018
        //   Normal  : [[-50, 0, 0], [0, 0, 0], [0, -50, 0], [-50, -50, 0]]
        //   Cross   : [[0, 0, -50], [0, 0, 0], [0, -50, 0], [0, -50, -50]]
        //
        // Pivot X: 2  Pivot Y: 0  Plane Type: XZ
        //   Offset  : 0x0084
        //   Normal  : [[-50, 0, 0], [0, 0, 0], [0, 0, 50], [-50, 0, 50]]
        //   Cross   : N/A
        //
        // Pivot X: 2  Pivot Y: 1  Plane Type: XY
        //   Offset  : 0x003c
        //   Normal  : [[-50, 25, 0], [0, 25, 0], [0, -25, 0], [-50, -25, 0]]
        //   Cross   : [[0, 25, -50], [0, 25, 0], [0, -25, 0], [0, -25, -50]]
        //
        // Pivot X: 2  Pivot Y: 1  Plane Type: XZ
        //   Offset  : 0x00a8
        //   Normal  : [[-50, 0, -25], [0, 0, -25], [0, 0, 25], [-50, 0, 25]]
        //   Cross   : N/A
        //
        // Pivot X: 2  Pivot Y: 2  Plane Type: XY
        //   Offset  : 0x0060
        //   Normal  : [[-50, 50, 0], [0, 50, 0], [0, 0, 0], [-50, 0, 0]]
        //   Cross   : [[0, 50, -50], [0, 50, 0], [0, 0, 0], [0, 0, -50]]
        //
        // Pivot X: 2  Pivot Y: 2  Plane Type: XZ
        //   Offset  : 0x00cc
        //   Normal  : [[-50, 0, -50], [0, 0, -50], [0, 0, 0], [-50, 0, 0]]
        //   Cross   : N/A

        // We handle both Pivot and Plane Type with special matrix transforms.

        const n0 =  25;
        const n1 = -25;

        const device = cache.device;
        this.vertexBufferQuad = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array([
            n0, n0, 0, 1, 0,
            n0, n1, 0, 1, 1,
            n1, n0, 0, 0, 0,
            n1, n1, 0, 0, 1,
            // Cross
            0, n0, n0, 1, 0,
            0, n1, n0, 1, 1,
            0, n0, n1, 0, 0,
            0, n1, n1, 0, 1,
        ]).buffer);
        this.indexBufferQuad = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, new Uint16Array([
            0, 1, 2, 2, 1, 3,
            4, 5, 6, 6, 5, 7,
        ]).buffer);

        this.inputVertexQuad = [{ buffer: this.vertexBufferQuad }];
        this.inputIndexQuad = { buffer: this.indexBufferQuad };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBufferQuad);
        device.destroyBuffer(this.indexBufferQuad);
    }
}

const instancingBindingLayouts: GfxBindingLayoutDescriptor[] = [{
    numSamplers: 16, numUniformBuffers: 3, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat, },
    ]
}];

export class JPAEmitterWorkData {
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
    public volumeEmitAngleMax: number = 1;
    public volumeEmitAngleCount: number = 0;
    public volumeEmitXCount: number = 0;
    public divNumber: number;

    public emitterTranslation = vec3.create();
    public emitterDirMtx = mat4.create();
    public emitterGlobalRotation = mat4.create();
    public emitterGlobalSR = mat4.create();
    public emitterGlobalScale = vec3.create();
    public emitterGlobalDir = vec3.create();
    public emitterGlobalCenterPos = vec3.create();
    public globalRotation = mat4.create();
    public globalDynamicsScale = vec3.create();
    public globalParticleScale = vec2.create();

    public pivotX: number = 1;
    public pivotY: number = 1;

    public ybbCamMtx = mat4.create();
    public posCamMtx = mat4.create();
    public texPrjMtx = mat4.create();
    public frustum: Frustum | null = null;
    public deltaTime: number = 0;

    public prevParticlePos = vec3.create();
    public particleSortKey = makeSortKeyTranslucent(GfxRendererLayer.TRANSLUCENT);
    public forceTexMtxIdentity: boolean = false;
    public usingInstancing = false;
    public childDraw = false;

    public materialParams = new MaterialParams();
    public drawParams = new DrawParams();
    public dataTexture: DataTexture;
    public dataTextureOffs = 0;
    public aliveParticleNum = 0;
    public materialHelper: GXMaterialHelperGfx;

    constructor() {
        // HACK for instancing
        this.materialParams.m_TextureMapping = nArray(16, () => new TextureMapping());
    }

    public fillEmitterRenderInst(renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst): void {
        const materialParams = this.materialParams;
        renderInst.setBindingLayouts(instancingBindingLayouts);

        this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);

        let materialOffs = renderInst.allocateUniformBuffer(GX_Program.ub_MaterialParams, this.materialHelper.materialParamsBufferSize);

        // TODO(jstpierre): Remove this
        let packetOffs = renderInst.allocateUniformBuffer(GX_Program.ub_DrawParams, this.materialHelper.drawParamsBufferSize);

        const d = renderInst.getUniformBuffer().mapBufferF32();
        // Skip MAT1, AMB0, AMB1, K0, K1, K2, K3, CPREV, C0, C1, C2.
        materialOffs += 4*12;
        // Skip u_TexMtx[0-9]
        materialOffs += 4*3*10;

        // All dynamic textures are assumed to be the same size if used with indtex.
        materialOffs += fillTextureSize(d, materialOffs, materialParams.m_TextureMapping[0]);
        // Skip u_TextureSize[1]
        materialOffs += 2;
        materialOffs += fillTextureSize(d, materialOffs, materialParams.m_TextureMapping[2]);
        materialOffs += fillTextureSize(d, materialOffs, materialParams.m_TextureMapping[3]);
        // Skip u_TextureSize[4-8]
        materialOffs += 2*4;

        materialOffs += fillTextureBias(d, materialOffs, materialParams.m_TextureMapping[0]);
        // Skip u_TextureBias[1]
        materialOffs += 1;
        materialOffs += fillTextureBias(d, materialOffs, materialParams.m_TextureMapping[2]);
        materialOffs += fillTextureBias(d, materialOffs, materialParams.m_TextureMapping[3]);
        // Skip u_TextureBias[4-8]
        materialOffs += 1*4;

        materialOffs += fillMatrix4x2(d, materialOffs, materialParams.u_IndTexMtx[0]);
        // Skip u_IndTexMtx[2-3]
        materialOffs += 4*2*2;

        if (this.materialHelper.material.hasDynamicAlphaTest)
            materialOffs += fillVec4(d, materialOffs, this.baseEmitter.globalColorPrm.a);

        materialParams.m_TextureMapping[15].gfxTexture = this.dataTexture.texture;
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }

    public fillParticleRenderInst(renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst): void {
        this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);

        const materialParams = this.materialParams;
        const drawParams = this.drawParams;

        // These should be one allocation.
        let materialOffs = renderInst.allocateUniformBuffer(GX_Program.ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
        let packetOffs = renderInst.allocateUniformBuffer(GX_Program.ub_DrawParams, this.materialHelper.drawParamsBufferSize);
        const d = renderInst.getUniformBuffer().mapBufferF32();

        // Since this is called quite a *lot*, we have hand-inlined variants of
        // fillMaterialParamsDataWithOptimizations and fillDrawParamsDataWithOptimizations for speed here.

        // Skip MAT0, MAT1, AMB0, AMB1, K0, K1, K2, K3, CPREV.
        materialOffs += 4*9;
        materialOffs += fillColor(d, materialOffs, materialParams.u_Color[ColorKind.C0]);
        materialOffs += fillColor(d, materialOffs, materialParams.u_Color[ColorKind.C1]);
        // Skip C2.
        materialOffs += 4*1;

        materialOffs += fillMatrix4x3(d, materialOffs, materialParams.u_TexMtx[0]);
        // Skip u_TexMtx[1-9]
        materialOffs += 4*3*9;

        materialOffs += fillTextureSize(d, materialOffs, materialParams.m_TextureMapping[0]);
        // Skip u_TextureSize[1]
        materialOffs += 2;
        materialOffs += fillTextureSize(d, materialOffs, materialParams.m_TextureMapping[2]);
        materialOffs += fillTextureSize(d, materialOffs, materialParams.m_TextureMapping[3]);
        // Skip u_TextureSize[4-8]
        materialOffs += 2*4;

        materialOffs += fillTextureBias(d, materialOffs, materialParams.m_TextureMapping[0]);
        // Skip u_TextureBias[1]
        materialOffs += 1;
        materialOffs += fillTextureBias(d, materialOffs, materialParams.m_TextureMapping[2]);
        materialOffs += fillTextureBias(d, materialOffs, materialParams.m_TextureMapping[3]);
        // Skip u_TextureBias[4-8]
        materialOffs += 1*4;

        materialOffs += fillMatrix4x2(d, materialOffs, materialParams.u_IndTexMtx[0]);
        // Skip u_IndTexMtx[2-3]
        materialOffs += 4*2*2;

        if (this.materialHelper.material.hasDynamicAlphaTest)
            materialOffs += fillVec4(d, materialOffs, this.baseEmitter.globalColorPrm.a);

        packetOffs += fillMatrix4x3(d, packetOffs, drawParams.u_PosMtx[0]);

        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }
}

export class JPADrawInfo {
    public posCamMtx: ReadonlyMat4;
    public texPrjMtx: ReadonlyMat4 | null = null;
    public frustum: Frustum | null = null;
}

class StripeEntry {
    private static USED_AGE = 4;
    public buffer: GfxBuffer;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public age = 0;
    public shadowBufferF32: Float32Array;
    public shadowBufferU8: Uint8Array;

    constructor(device: GfxDevice, public wordCount: number, public indexBufferDescriptor: GfxIndexBufferDescriptor) {
        this.shadowBufferF32 = new Float32Array(wordCount);
        this.shadowBufferU8 = new Uint8Array(this.shadowBufferF32.buffer);
        this.buffer = device.createBuffer(this.shadowBufferF32.byteLength, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
        this.vertexBufferDescriptors = [{ buffer: this.buffer }];
    }

    public markInUse(): void {
        this.age = StripeEntry.USED_AGE;
    }

    public markNotInUse(): void {
        assert(this.age === StripeEntry.USED_AGE);
        this.age--;
    }

    public canUse(wordCount: number) {
        return this.age < StripeEntry.USED_AGE && this.wordCount >= wordCount;
    }

    public prepareToRender(device: GfxDevice): boolean {
        if (this.age === StripeEntry.USED_AGE)
            device.uploadBufferData(this.buffer, 0, this.shadowBufferU8);
        return this.age-- > 0;
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.buffer);
    }
}

const MAX_STRIPE_VERTEX_COUNT = 65535;
class StripeBufferManager {
    public entry: StripeEntry[] = [];
    private indexBuffer: GfxBuffer;

    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    constructor(device: GfxDevice, public inputLayout: GfxInputLayout) {
        const tristripIndexData = makeTriangleIndexBuffer(GfxTopology.TriStrips, 0, MAX_STRIPE_VERTEX_COUNT);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, tristripIndexData.buffer);
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public allocateVertexBuffer(device: GfxDevice, vertexCount: number): StripeEntry {
        assert(vertexCount < MAX_STRIPE_VERTEX_COUNT);

        // Allocate all buffers to max size for now.
        const wordCount = MAX_STRIPE_VERTEX_COUNT * 5;

        for (let i = 0; i < this.entry.length; i++) {
            const entry = this.entry[i];
            if (entry.canUse(wordCount)) {
                entry.markInUse();
                return entry;
            }
        }

        const entry = new StripeEntry(device, wordCount, this.indexBufferDescriptor);
        entry.markInUse();
        this.entry.push(entry);
        return entry;
    }

    public prepareToRender(device: GfxDevice): void {
        for (let i = 0; i < this.entry.length; i++) {
            if (!this.entry[i].prepareToRender(device)) {
                this.entry[i].destroy(device);
                this.entry.splice(i--, 1);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.entry.length; i++)
            this.entry[i].destroy(device);
        device.destroyBuffer(this.indexBuffer);
    }
}

class DataTexture {
    // Layout:
    // 00  float4 mPosMtx[3];
    // 03  float4 mTexMtx[3];
    // 06  float4 mMisc; (contains packed ColorPrm, ColorEnv, TextureIdx)

    private static USED_AGE = 2;
    private static WIDTH = 7;
    public texture: GfxTexture;
    public data: Float32Array;
    public age = 0;

    constructor(device: GfxDevice, public maxParticles: number) {
        this.texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.F32_RGBA, DataTexture.WIDTH, this.maxParticles, 1));
        this.data = new Float32Array(4 * DataTexture.WIDTH * this.maxParticles);
    }

    public prepareToRender(device: GfxDevice): boolean {
        if (this.age === DataTexture.USED_AGE)
            device.uploadTextureData(this.texture, 0, [this.data]);
        return this.age-- > 0;
    }

    public markInUse(): void {
        this.age = DataTexture.USED_AGE;
    }

    public markNotInUse(): void {
        assert(this.age === DataTexture.USED_AGE);
        this.age--;
    }

    public canUse(maxParticles: number) {
        return this.age < DataTexture.USED_AGE && this.maxParticles >= maxParticles;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

class DataTextureManager {
    private entry: DataTexture[] = [];

    public allocateTexture(device: GfxDevice, maxParticles: number): DataTexture {
        // Round up to the nearest multiple of 16.
        maxParticles = align(maxParticles, 16);

        for (let i = 0; i < this.entry.length; i++) {
            const texture = this.entry[i];
            if (texture.canUse(maxParticles)) {
                texture.markInUse();
                return texture;
            }
        }

        const entry = new DataTexture(device, maxParticles);
        entry.markInUse();
        this.entry.push(entry);
        return entry;
    }

    public returnTexture(texture: DataTexture): void {
        texture.markNotInUse();
    }

    public prepareToRender(device: GfxDevice): void {
        for (let i = 0; i < this.entry.length; i++) {
            if (!this.entry[i].prepareToRender(device)) {
                this.entry[i].destroy(device);
                this.entry.splice(i--, 1);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.entry.length; i++)
            this.entry[i].destroy(device);
    }
}

export class JPAEmitterManager {
    public workData = new JPAEmitterWorkData();
    public deadParticlePool: JPABaseParticle[] = [];
    public deadEmitterPool: JPABaseEmitter[] = [];
    public aliveEmitters: JPABaseEmitter[] = [];
    public globalRes: JPAGlobalRes;
    public stripeBufferManager: StripeBufferManager;
    public dataTextureManager: DataTextureManager;

    constructor(public cache: GfxRenderCache, public maxParticleCount: number, public maxEmitterCount: number) {
        this.workData.emitterManager = this;

        for (let i = 0; i < this.maxEmitterCount; i++)
            this.deadEmitterPool.push(new JPABaseEmitter(this));
        for (let i = 0; i < this.maxParticleCount; i++)
            this.deadParticlePool.push(new JPABaseParticle());

        this.globalRes = new JPAGlobalRes(cache);
        this.stripeBufferManager = new StripeBufferManager(cache.device, this.globalRes.inputLayout);
        this.dataTextureManager = new DataTextureManager();
    }

    public createEmitter(resData: JPAResourceData): JPABaseEmitter | null {
        if (this.deadEmitterPool.length === 0)
            return null;

        const emitter = assertExists(this.deadEmitterPool.pop());
        emitter.init(resData);
        assert(emitter.aliveParticlesBase.length === 0);
        this.aliveEmitters.push(emitter);
        return emitter;
    }

    public forceDeleteEmitter(emitter: JPABaseEmitter): void {
        emitter.deleteAllParticle();
        emitter.status |= JPAEmitterStatus.TERMINATE | JPAEmitterStatus.TERMINATE_FLAGGED;
        const i = this.aliveEmitters.indexOf(emitter);
        assert(i >= 0);
        this.aliveEmitters.splice(i, 1);
        this.deadEmitterPool.push(emitter);
    }

    public calc(deltaTime: number): void {
        // Clamp deltaTime to something reasonable so we don't get a combinatorial
        // explosion of particles at scene load...
        this.workData.deltaTime = Math.min(deltaTime, 1.5);

        if (this.workData.deltaTime === 0)
            return;

        for (let i = 0; i < this.aliveEmitters.length; i++) {
            const emitter = this.aliveEmitters[i];
            const alive = emitter.calc(this.workData);

            if (!alive && !(emitter.status & JPAEmitterStatus.TERMINATE_FLAGGED)) {
                emitter.deleteAllParticle();
                emitter.status |= JPAEmitterStatus.TERMINATE | JPAEmitterStatus.TERMINATE_FLAGGED;
                this.aliveEmitters.splice(i, 1);
                this.deadEmitterPool.push(emitter);
                i--;
            }
        }
    }

    private calcYBBMtx(): void {
        const posCamMtx = this.workData.posCamMtx;
        const dst = this.workData.ybbCamMtx;

        vec3.set(scratchVec3a, 0, posCamMtx[5], posCamMtx[6]);
        vec3.normalize(scratchVec3a, scratchVec3a);

        //dst[0] = 1;
        //dst[4] = 0;
        //dst[8] = 0;
        dst[12] = posCamMtx[12];

        //dst[1] = 0;
        dst[5] = scratchVec3a[1];
        dst[9] = -scratchVec3a[2];
        dst[13] = posCamMtx[13];

        //dst[2] = 0;
        dst[6] = scratchVec3a[2];
        dst[10] = scratchVec3a[1];
        dst[14] = posCamMtx[14];
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, drawInfo: Readonly<JPADrawInfo>, drawGroupId: number): void {
        if (this.aliveEmitters.length < 1)
            return;

        mat4.copy(this.workData.posCamMtx, drawInfo.posCamMtx);
        this.calcYBBMtx();
        if (drawInfo.texPrjMtx !== null)
            mat4.copy(this.workData.texPrjMtx, drawInfo.texPrjMtx);
        else
            mat4.identity(this.workData.texPrjMtx);
        this.workData.frustum = drawInfo.frustum;

        for (let i = 0; i < this.aliveEmitters.length; i++) {
            const emitter = this.aliveEmitters[i];
            if (emitter.drawGroupId === drawGroupId)
                this.aliveEmitters[i].draw(renderInstManager, this.workData);
        }
    }

    public prepareToRender(device: GfxDevice): void {
        this.stripeBufferManager.prepareToRender(device);
        this.dataTextureManager.prepareToRender(device);
    }

    public destroy(device: GfxDevice): void {
        this.globalRes.destroy(device);
        this.stripeBufferManager.destroy(device);
        this.dataTextureManager.destroy(device);
    }
}

export const enum JPAEmitterStatus {
    STOP_CREATE_PARTICLE = 0x0001,
    STOP_CALC_EMITTER    = 0x0002,
    STOP_DRAW_PARTICLE   = 0x0004,
    TERMINATED           = 0x0008,
    FIRST_EMISSION       = 0x0010,
    RATE_STEP_EMIT       = 0x0020,
    IMMORTAL             = 0x0040,
    CHILD_DRAW           = 0x0080,
    TERMINATE            = 0x0100,
    TERMINATE_FLAGGED    = 0x0200,
}

function JPAGetDirMtx(m: mat4, v: ReadonlyVec3, scratch: vec3 = scratchVec3a): void {
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

export function JPASetRMtxSTVecFromMtx(scale: vec3 | null, rot: mat4, trans: vec3, m: ReadonlyMat4): void {
    // Extract our three column vectors.
    mat4.identity(rot);

    const scaleX = Math.hypot(m[0], m[1], m[2]);
    const scaleY = Math.hypot(m[4], m[5], m[6]);
    const scaleZ = Math.hypot(m[8], m[9], m[10]);

    if (scale !== null)
        vec3.set(scale, scaleX, scaleY, scaleZ);

    if (scaleX !== 0) {
        const d = 1 / scaleX;
        rot[0] = m[0] * d;
        rot[1] = m[1] * d;
        rot[2] = m[2] * d;
    }

    if (scaleY !== 0) {
        const d = 1 / scaleY;
        rot[4] = m[4] * d;
        rot[5] = m[5] * d;
        rot[6] = m[6] * d;
    }

    if (scaleZ !== 0) {
        const d = 1 / scaleZ;
        rot[8] = m[8] * d;
        rot[9] = m[9] * d;
        rot[10] = m[10] * d;
    }

    trans[0] = m[12];
    trans[1] = m[13];
    trans[2] = m[14];
}

export function JPASetRMtxTVecfromMtx(m: ReadonlyMat4, rot: mat4, trans: vec3): void {
    JPASetRMtxSTVecFromMtx(null, rot, trans, m);
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

    const texIdxAnimData = assertExists(bsp1.texIdxAnimData);

    let anmIdx: number;
    if (bsp1.texCalcIdxType === CalcIdxType.Normal) {
        anmIdx = Math.min(texIdxAnimData.length - 1, tick | 0);
    } else if (bsp1.texCalcIdxType === CalcIdxType.Repeat) {
        anmIdx = ((tick | 0) + randomPhase) % texIdxAnimData.length;
    } else if (bsp1.texCalcIdxType === CalcIdxType.Reverse) {
        anmIdx = mirroredRepeat((tick | 0) + randomPhase, texIdxAnimData.length - 1);
    } else if (bsp1.texCalcIdxType === CalcIdxType.Merge) {
        anmIdx = (((time * texIdxAnimData.length) | 0) + randomPhase) % texIdxAnimData.length;
    } else if (bsp1.texCalcIdxType === CalcIdxType.Random) {
        anmIdx = randomPhase % texIdxAnimData.length;
    } else {
        throw "whoops";
    }

    return texIdxAnimData[anmIdx];
}

function calcColor(dstPrm: Color, dstEnv: Color, workData: JPAEmitterWorkData, tick: number, time: number, randomPhase: number): void {
    const bsp1 = workData.baseEmitter.resData.res.bsp1;

    let anmIdx = 0;
    if (bsp1.colorCalcIdxType === CalcIdxType.Normal) {
        anmIdx = Math.min(bsp1.colorAnimMaxFrm, tick | 0);
    } else if (bsp1.colorCalcIdxType === CalcIdxType.Repeat) {
        anmIdx = ((tick | 0) + randomPhase) % (bsp1.colorAnimMaxFrm + 1);
    } else if (bsp1.colorCalcIdxType === CalcIdxType.Reverse) {
        anmIdx = mirroredRepeat((tick | 0) + randomPhase, bsp1.colorAnimMaxFrm);
    } else if (bsp1.colorCalcIdxType === CalcIdxType.Merge) {
        anmIdx = (((time * (bsp1.colorAnimMaxFrm + 1)) | 0) + randomPhase) % (bsp1.colorAnimMaxFrm + 1);
    } else if (bsp1.colorCalcIdxType === CalcIdxType.Random) {
        anmIdx = randomPhase % (bsp1.colorAnimMaxFrm + 1);
    } else {
        throw "whoops";
    }

    if (bsp1.colorPrmAnimData !== null)
        colorCopy(dstPrm, bsp1.colorPrmAnimData[anmIdx]);

    if (bsp1.colorEnvAnimData !== null)
        colorCopy(dstEnv, bsp1.colorEnvAnimData[anmIdx]);
}

export class JPAEmitterCallBack {
    public execute(emitter: JPABaseEmitter): void {
    }

    public executeAfter(emitter: JPABaseEmitter): void {
    }

    public draw(emitter: JPABaseEmitter, device: GfxDevice, renderInstManager: GfxRenderInstManager): void {
    }
}

class JPAInstancingProgram extends GX_Program {
    public static Common = `
layout(binding = 8) uniform sampler2D u_Texture8;
layout(binding = 9) uniform sampler2D u_Texture9;
layout(binding = 10) uniform sampler2D u_Texture10;
layout(binding = 11) uniform sampler2D u_Texture11;
layout(binding = 12) uniform sampler2D u_Texture12;
layout(binding = 13) uniform sampler2D u_Texture13;
layout(binding = 14) uniform sampler2D u_Texture14;
layout(binding = 15) uniform sampler2D u_DataTexture;

struct ParticleData {
    mat4x3 mPosMtx;
    mat4x3 mTexMtx;
    vec4   mColorPrm;
    vec4   mColorEnv;
    int    mTexIdx;
};

mat4x3 UnpackMatrixFromTexture(int t_Column, int t_ParticleNo) {
    vec4 mx = texelFetch(TEXTURE(u_DataTexture), ivec2(t_Column + 0, t_ParticleNo), 0);
    vec4 my = texelFetch(TEXTURE(u_DataTexture), ivec2(t_Column + 1, t_ParticleNo), 0);
    vec4 mz = texelFetch(TEXTURE(u_DataTexture), ivec2(t_Column + 2, t_ParticleNo), 0);
    return mat4x3(transpose(mat4(mx, my, mz, vec4(0, 0, 0, 1))));
}

vec4 UnpackColor(float v_) {
    uint v = floatBitsToUint(v_);
    vec4 d;
    d.r = float((v >> 24u) & 0xFFu) / 255.0;
    d.g = float((v >> 16u) & 0xFFu) / 255.0;
    d.b = float((v >>  8u) & 0xFFu) / 255.0;
    d.a = float((v >>  0u) & 0xFFu) / 255.0;
    return d;
}

ParticleData FetchDataTexture(int t_ParticleNo) {
    ParticleData data;
    data.mPosMtx = UnpackMatrixFromTexture(0, t_ParticleNo);
    data.mTexMtx = UnpackMatrixFromTexture(3, t_ParticleNo);
    vec4 t_Misc = texelFetch(TEXTURE(u_DataTexture), ivec2(6, t_ParticleNo), 0);
    data.mColorPrm = UnpackColor(t_Misc.x);
    data.mColorEnv = UnpackColor(t_Misc.y);
    data.mTexIdx = int(t_Misc.z);
    return data;
}
`;

    public override generateExtraVertexGlobal(): string {
        return `${JPAInstancingProgram.Common}
flat out int v_TexIdx;
`;
    }

    protected override generatePosition(): string {
        return `
    ParticleData data = FetchDataTexture(int(gl_InstanceID));
    vec3 t_Position = data.mPosMtx * vec4(a_Position.xyz, 1.0);
`;
    }

    protected override generateColorVaryings(): string {
        return `
flat varying vec4 v_Color0;
flat varying vec4 v_Color1;
`;
    }

    protected override generateLightChannels(): string {
        return `
v_Color0 = data.mColorPrm;
v_Color1 = data.mColorEnv;
v_TexIdx = data.mTexIdx;
`;
    }

    protected override generateTexGenMatrixMult(texCoordGenIndex: number, src: string): string {
        if (texCoordGenIndex === 0) {
            return `(data.mTexMtx * ${src})`;
        } else {
            return super.generateTexGenMatrixMult(texCoordGenIndex, src);
        }
    }

    public override generateExtraPixelGlobal(): string {
        return `
${JPAInstancingProgram.Common}
flat in int v_TexIdx;

// TODO(jstpierre): This should really be using something like NURI.
// It also breaks in WebGPU because we can't easily forward the workgroupLoadUniform across through Naga.
vec4 SampleTextureIdx(int t_TexIdx, vec2 t_TexCoord, float t_LODBias) {
    if (t_TexIdx == 0)       return texture(SAMPLER_2D(u_Texture0), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 1)  return texture(SAMPLER_2D(u_Texture1), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 2)  return texture(SAMPLER_2D(u_Texture2), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 3)  return texture(SAMPLER_2D(u_Texture3), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 4)  return texture(SAMPLER_2D(u_Texture4), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 5)  return texture(SAMPLER_2D(u_Texture5), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 6)  return texture(SAMPLER_2D(u_Texture6), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 7)  return texture(SAMPLER_2D(u_Texture7), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 8)  return texture(SAMPLER_2D(u_Texture8), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 9)  return texture(SAMPLER_2D(u_Texture9), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 10) return texture(SAMPLER_2D(u_Texture10), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 11) return texture(SAMPLER_2D(u_Texture11), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 12) return texture(SAMPLER_2D(u_Texture12), t_TexCoord, t_LODBias);
    else if (t_TexIdx == 13) return texture(SAMPLER_2D(u_Texture13), t_TexCoord, t_LODBias);
    else                     return texture(SAMPLER_2D(u_Texture14), t_TexCoord, t_LODBias);
}
`;
    }

    protected override generateIndTexStages(): string {
        return `
t_Color0 = v_Color0;
t_Color1 = v_Color1;
${super.generateIndTexStages()}`;
    }

    protected override generateTextureSample(index: number, coord: string): string {
        if (index === 0) {
            const needsDynamicTextureIndex = this.material.userData!.needsDynamicTextureIndex;
            if (needsDynamicTextureIndex) {
                // Swap texture with dynamically fetched texture sample.
                return `SampleTextureIdx(v_TexIdx, ${coord}, TextureLODBias(${index}))`;
            } else {
                return `texture(SAMPLER_2D(u_Texture0), ${coord}, TextureLODBias(${index}))`;
            }
        } else if (index === 2) {
            return `texture(SAMPLER_2D(u_Texture13), ${coord}, TextureLODBias(${index}))`;
        } else if (index === 3) {
            return `texture(SAMPLER_2D(u_Texture14), ${coord}, TextureLODBias(${index}))`;
        } else {
            throw "whoops";
        }
    }
}

const scratchVec3Points = nArray(4, () => vec3.create());
export class JPABaseEmitter {
    private drawParticle = true;
    public status: JPAEmitterStatus;
    public resData: JPAResourceData;
    @dfRange(-5, 5)
    public localScale = vec3.create();
    @dfRange(-9999, 9999)
    public localTranslation = vec3.create();
    @dfRange(-1, 1)
    public localDirection = vec3.create();
    @dfRange(-Math.PI, Math.PI, 0.01)
    public localRotation = vec3.create();
    public maxFrame: number;
    public lifeTime: number;
    @dfRange(0, 5)
    private rate: number;
    @dfRange(0, 1000)
    private volumeSize: number;
    @dfRange(0, MathConstants.TAU, 0.01)
    private volumeMinRad: number;
    @dfRange(0, 1, 0.01)
    private volumeSweep: number;
    public moment: number;
    @dfRange(0, 10)
    public awayFromCenterSpeed: number;
    @dfRange(0, 10)
    public awayFromYAxisSpeed: number;
    @dfRange(0, 10)
    public directionalSpeed: number;
    @dfRange(0, 10)
    public randomDirectionSpeed: number;
    public spread: number;
    public age: number;
    public scaleOut: number;
    public random: JPARandom = new_rndm();
    @dfShow()
    public colorPrm: Color = colorNewCopy(White);
    @dfShow()
    public colorEnv: Color = colorNewCopy(White);
    public userData: unknown = null;

    // Internal state.
    private emitCount: number;
    private texAnmIdx: number;
    private waitTime: number;
    private rateStepTimer: number;

    public globalColorPrm: Color = colorNewCopy(White);
    public globalColorEnv: Color = colorNewCopy(White);

    // These are the public APIs to affect an emitter's placement.
    public globalRotation = mat4.create();
    public globalDynamicsScale = vec3.create();
    public globalTranslation = vec3.create();
    public globalParticleScale = vec2.create();

    public aliveParticlesBase: JPABaseParticle[] = [];
    public aliveParticlesChild: JPABaseParticle[] = [];
    public drawGroupId: number = 0;

    public emitterCallBack: JPAEmitterCallBack | null = null;

    constructor(public emitterManager: JPAEmitterManager) {
    }

    public stopCreateParticle(): void {
        this.status |= JPAEmitterStatus.STOP_CREATE_PARTICLE;
    }

    public playCreateParticle(): void {
        this.status &= ~JPAEmitterStatus.STOP_CREATE_PARTICLE;
    }

    public stopCalcEmitter(): void {
        this.status |= JPAEmitterStatus.STOP_CALC_EMITTER;
    }

    public playCalcEmitter(): void {
        this.status &= ~JPAEmitterStatus.STOP_CALC_EMITTER;
    }

    public stopDrawParticle(): void {
        this.status |= JPAEmitterStatus.STOP_DRAW_PARTICLE;
    }

    public playDrawParticle(): void {
        this.status &= ~JPAEmitterStatus.STOP_DRAW_PARTICLE;
    }

    public becomeInvalidEmitter(): void {
        this.stopCreateParticle();
        this.maxFrame = 1;
    }

    public becomeInvalidEmitterImmediate(): void {
        this.stopCreateParticle();
        this.maxFrame = -1;
    }

    public becomeImmortalEmitter(): void {
        this.status |= JPAEmitterStatus.IMMORTAL;
    }

    public getParticleNumber(): number {
        return this.aliveParticlesBase.length + this.aliveParticlesChild.length;
    }

    public isEnableDeleteEmitter(): boolean {
        return (!!(this.status & JPAEmitterStatus.TERMINATED)) && this.getParticleNumber() === 0;
    }

    public setGlobalTranslation(v: ReadonlyVec3): void {
        vec3.copy(this.globalTranslation, v);
    }

    public setGlobalScale(s: ReadonlyVec3): void {
        this.setGlobalDynamicsScale(s);
        this.setGlobalParticleScale(s);
    }

    public setGlobalDynamicsScale(s: ReadonlyVec3): void {
        vec3.copy(this.globalDynamicsScale, s);
    }

    public setGlobalParticleScale(s: ReadonlyVec3): void {
        vec2.set(this.globalParticleScale, s[0], s[1]);
    }

    public setDrawParticle(v: boolean): void {
        this.drawParticle = v;
    }

    public setVolumeSize(v: number): void {
        this.volumeSize = v;
    }

    public setRate(v: number): void {
        this.rate = v;
    }

    public setGlobalRTMatrix(m: mat4): void {
        JPASetRMtxTVecfromMtx(m, this.globalRotation, this.globalTranslation);
    }

    public setGlobalRotation(v: ReadonlyVec3): void {
        computeModelMatrixR(this.globalRotation, v[0], v[1], v[2]);
    }

    public init(resData: JPAResourceData): void {
        this.resData = resData;
        const bem1 = this.resData.res.bem1;
        const bsp1 = this.resData.res.bsp1;
        vec3.copy(this.localScale, bem1.emitterScl);
        vec3.copy(this.localTranslation, bem1.emitterTrs);
        vec3.copy(this.localDirection, bem1.emitterDir);
        vec3.copy(this.localRotation, bem1.emitterRot);
        this.maxFrame = bem1.maxFrame;
        this.lifeTime = bem1.lifeTime;
        this.rate = bem1.rate;
        this.volumeSize = bem1.volumeSize;
        this.volumeMinRad = bem1.volumeMinRad;
        this.volumeSweep = bem1.volumeSweep;
        this.awayFromCenterSpeed = bem1.initialVelOmni;
        this.awayFromYAxisSpeed = bem1.initialVelAxis;
        this.directionalSpeed = bem1.initialVelDir;
        this.randomDirectionSpeed = bem1.initialVelRndm;
        this.spread = bem1.spread;
        this.moment = bem1.moment;
        // Spin the random machine and copy the state.
        next_rndm(this.emitterManager.workData.random);
        copy_rndm(this.random, this.emitterManager.workData.random);
        mat4.identity(this.globalRotation);
        vec3SetAll(this.globalDynamicsScale, 1);
        vec3.zero(this.globalTranslation);
        vec2.set(this.globalParticleScale, 1, 1);
        colorCopy(this.globalColorPrm, White);
        colorCopy(this.globalColorEnv, White);
        colorCopy(this.colorPrm, bsp1.colorPrm);
        colorCopy(this.colorEnv, bsp1.colorEnv);
        this.scaleOut = 1;
        this.emitCount = 0;
        this.waitTime = 0;
        this.age = 0;
        this.rateStepTimer = 0;
        this.texAnmIdx = 0;
        this.status = JPAEmitterStatus.FIRST_EMISSION | JPAEmitterStatus.RATE_STEP_EMIT;

        if (!this.resData.supportedParticle)
            this.status |= JPAEmitterStatus.TERMINATED;

        this.emitterCallBack = null;
        this.userData = null;
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
            return;

        const particle = this.emitterManager.deadParticlePool.pop()!;
        this.aliveParticlesChild.push(particle);
        particle.init_c(this.emitterManager.workData, parent);
    }

    private calcKey(): void {
        for (let i = 0; i < this.resData.res.kfa1.length; i++) {
            const kfa1 = this.resData.res.kfa1[i];
            const v = kfa1Calc(kfa1, this.age);
            assert(v !== undefined);
            if (kfa1.keyType === JPAKeyType.Rate)
                this.rate = v;
            else if (kfa1.keyType === JPAKeyType.VolumeSize)
                this.volumeSize = v;
            else if (kfa1.keyType === JPAKeyType.VolumeSweep)
                this.volumeSweep = v;
            else if (kfa1.keyType === JPAKeyType.VolumeMinRad)
                this.volumeMinRad = v;
            else if (kfa1.keyType === JPAKeyType.LifeTime)
                this.lifeTime = v;
            else if (kfa1.keyType === JPAKeyType.Moment)
                this.moment = v;
            else if (kfa1.keyType === JPAKeyType.InitialVelOmni)
                this.awayFromCenterSpeed = v;
            else if (kfa1.keyType === JPAKeyType.InitialVelAxis)
                this.awayFromYAxisSpeed = v;
            else if (kfa1.keyType === JPAKeyType.InitialVelDir)
                this.directionalSpeed = v;
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
        vec3.mul(workData.velOmni, workData.volumePos, workData.emitterGlobalScale);
        vec3.set(workData.velAxis, workData.volumePos[0], 0.0, workData.volumePos[2]);
    }

    private calcVolumeSphere(workData: JPAEmitterWorkData): void {
        const bem1 = workData.baseEmitter.resData.res.bem1;

        let angle: number, x: number;
        if (!!(bem1.emitFlags & EmitFlags.FixedInterval)) {
            const startAngle = Math.PI;

            angle = startAngle;
            if (workData.volumeEmitAngleMax > 1)
                angle += workData.volumeSweep * (workData.volumeEmitAngleCount / (workData.volumeEmitAngleMax - 1)) * MathConstants.TAU;

            x = (Math.PI * 0.5) + (workData.volumeEmitXCount / (workData.divNumber - 1)) * Math.PI;
            // Fixed interval
            workData.volumeEmitAngleCount++;
            if (workData.volumeEmitAngleCount === workData.volumeEmitAngleMax) {
                workData.volumeEmitAngleCount = 0;
                workData.volumeEmitXCount++;

                if (workData.volumeEmitXCount * 2 < workData.divNumber) {
                    workData.volumeEmitAngleMax = (workData.volumeEmitAngleMax !== 1) ? workData.volumeEmitAngleMax + 4 : workData.volumeEmitAngleMax + 3;
                } else {
                    workData.volumeEmitAngleMax = (workData.volumeEmitAngleMax !== 4) ? workData.volumeEmitAngleMax - 4 : 1;
                }
            }
        } else {
            angle = workData.volumeSweep * get_r_zh(this.random) * MathConstants.TAU;
            x = (get_rndm_f(this.random) * Math.PI);
        }

        let distance = get_rndm_f(this.random);
        if (!!(bem1.emitFlags & EmitFlags.FixedDensity)) {
            // Fixed density
            distance = 1.0 - (distance ** 3.0);
        }

        const size = workData.volumeSize * lerp(workData.volumeMinRad, 1.0, distance);
        vec3.set(workData.volumePos,
            size * Math.cos(x) * Math.sin(angle),
            size * Math.sin(x),
            size * Math.cos(x) * Math.cos(angle),
        );
        vec3.mul(workData.velOmni, workData.volumePos, workData.emitterGlobalScale);
        vec3.set(workData.velAxis, workData.volumePos[0], 0, workData.volumePos[2]);
    }

    private calcVolumeCylinder(workData: JPAEmitterWorkData): void {
        const bem1 = workData.baseEmitter.resData.res.bem1;

        let distance = get_rndm_f(this.random);
        if (!!(bem1.emitFlags & EmitFlags.FixedDensity)) {
            // Fixed density
            distance = 1.0 - (distance * distance);
        }

        const sizeXZ = workData.volumeSize * lerp(workData.volumeMinRad, 1.0, distance);
        const angle = (workData.volumeSweep * get_r_zh(this.random)) * MathConstants.TAU;
        const height = workData.volumeSize * get_r_zp(this.random);
        vec3.set(workData.volumePos, sizeXZ * Math.sin(angle), height, sizeXZ * Math.cos(angle));
        vec3.mul(workData.velOmni, workData.volumePos, workData.emitterGlobalScale);
        vec3.set(workData.velAxis, workData.volumePos[0], 0, workData.volumePos[2]);
    }

    private calcVolumeTorus(workData: JPAEmitterWorkData): void {
        const size = workData.volumeSize * workData.volumeMinRad;
        const angle1 = (workData.volumeSweep * get_r_zh(this.random)) * MathConstants.TAU;
        const angle2 = get_r_zh(this.random) * MathConstants.TAU;
        vec3.set(workData.velAxis,
            size * Math.cos(angle1) * Math.cos(angle2),
            size * Math.sin(angle2),
            size * Math.cos(angle1) * Math.sin(angle2),
        );
        vec3.set(workData.volumePos,
            workData.velAxis[0] + workData.volumeSize * Math.sin(angle1),
            workData.velAxis[1],
            workData.velAxis[2] + workData.volumeSize * Math.cos(angle1),
        );
        vec3.mul(workData.velOmni, workData.volumePos, workData.emitterGlobalScale);
    }

    private calcVolumePoint(workData: JPAEmitterWorkData): void {
        vec3.zero(workData.volumePos);
        const rndX = get_rndm_f(this.random) - 0.5;
        const rndY = get_rndm_f(this.random) - 0.5;
        const rndZ = get_rndm_f(this.random) - 0.5;
        vec3.set(workData.velOmni, rndX, rndY, rndZ);
        vec3.set(workData.velAxis, workData.velOmni[0], 0.0, workData.velOmni[2]);
    }

    private calcVolumeCircle(workData: JPAEmitterWorkData): void {
        const bem1 = this.resData.res.bem1;

        let angle: number;
        if (!!(bem1.emitFlags & EmitFlags.FixedInterval)) {
            // Fixed interval
            const idx = workData.volumeEmitIdx++;
            const idxS = (idx / workData.volumeEmitCount) - 0.5;
            angle = workData.volumeSweep * idxS * MathConstants.TAU;
        } else {
            angle = workData.volumeSweep * get_r_zh(this.random) * MathConstants.TAU;
        }

        let distance = get_rndm_f(this.random);
        if (!!(bem1.emitFlags & EmitFlags.FixedDensity)) {
            // Fixed density
            distance = 1.0 - (distance * distance);
        }

        const sizeXZ = workData.volumeSize * lerp(workData.volumeMinRad, 1.0, distance);
        vec3.set(workData.volumePos, sizeXZ * Math.sin(angle), 0, sizeXZ * Math.cos(angle));
        vec3.set(workData.velAxis, workData.volumePos[0], 0, workData.volumePos[2]);
        vec3.mul(workData.velOmni, workData.velAxis, workData.emitterGlobalScale);
    }

    private calcVolumeLine(workData: JPAEmitterWorkData): void {
        const bem1 = this.resData.res.bem1;

        if (!!(bem1.emitFlags & EmitFlags.FixedInterval)) {
            // Fixed interval
            const idx = workData.volumeEmitIdx++;
            vec3.set(workData.volumePos, 0, 0, bem1.volumeSize * ((idx / (workData.volumeEmitCount - 1)) - 0.5));
        } else {
            vec3.set(workData.volumePos, 0, 0, bem1.volumeSize * get_r_zh(this.random));
        }

        vec3.set(workData.velAxis, 0, 0, workData.volumePos[2]);
        vec3.mul(workData.velOmni, workData.velAxis, workData.emitterGlobalScale);
    }

    private calcVolume(workData: JPAEmitterWorkData): void {
        const bem1 = this.resData.res.bem1;

        if (bem1.volumeType === VolumeType.Cube)
            this.calcVolumeCube(workData);
        else if (bem1.volumeType === VolumeType.Sphere)
            this.calcVolumeSphere(workData);
        else if (bem1.volumeType === VolumeType.Cylinder)
            this.calcVolumeCylinder(workData);
        else if (bem1.volumeType === VolumeType.Torus)
            this.calcVolumeTorus(workData);
        else if (bem1.volumeType === VolumeType.Point)
            this.calcVolumePoint(workData);
        else if (bem1.volumeType === VolumeType.Circle)
            this.calcVolumeCircle(workData);
        else if (bem1.volumeType === VolumeType.Line)
            this.calcVolumeLine(workData);
        else
            throw "whoops";
    }

    public createParticle(): JPABaseParticle | null {
        if (this.emitterManager.deadParticlePool.length === 0)
            return null;

        const particle = this.emitterManager.deadParticlePool.pop()!;
        this.aliveParticlesBase.push(particle);
        this.calcVolume(this.emitterManager.workData);
        particle.init_p(this.emitterManager.workData);
        return particle;
    }

    private create(): void {
        const workData = this.emitterManager.workData;

        // JPADynamicsBlock::create()

        const bem1 = this.resData.res.bem1;

        if (!!(this.status & JPAEmitterStatus.RATE_STEP_EMIT)) {
            if (!!(bem1.emitFlags & EmitFlags.FixedInterval)) {
                // Fixed Interval
                if (bem1.volumeType === VolumeType.Sphere)
                    this.emitCount = bem1.divNumber * bem1.divNumber * 4 + 2;
                else
                    this.emitCount = bem1.divNumber;
                workData.volumeEmitIdx = 0;
            } else {
                // Rate
                const emitCountIncr = this.rate * (1.0 + bem1.rateRndm * get_r_zp(this.random));
                this.emitCount += emitCountIncr;

                // If this is the first emission and we got extremely bad luck, force a particle.
                if (!!(this.status & JPAEmitterStatus.FIRST_EMISSION) && this.rate !== 0.0 && this.emitCount < 1.0)
                    this.emitCount = 1;
            }

            workData.volumeEmitCount = this.emitCount;

            if (!!(this.status & JPAEmitterStatus.STOP_CREATE_PARTICLE))
                this.emitCount = 0;

            while (this.emitCount >= 1) {
                this.createParticle();
                this.emitCount--;
            }
        }

        this.rateStepTimer += workData.deltaTime;
        if (this.rateStepTimer >= bem1.rateStep + 1) {
            this.rateStepTimer -= bem1.rateStep + 1;
            this.status |= JPAEmitterStatus.RATE_STEP_EMIT;
        } else {
            this.status &= ~JPAEmitterStatus.RATE_STEP_EMIT;
        }

        // Unmark as first emission.
        this.status &= ~JPAEmitterStatus.FIRST_EMISSION;
    }

    private processTillStartFrame(): boolean {
        if (this.waitTime >= this.resData.res.bem1.startFrame)
            return true;

        if (!(this.status & JPAEmitterStatus.STOP_CALC_EMITTER))
            this.waitTime += this.emitterManager.workData.deltaTime;

        return false;
    }

    private processTermination(): boolean {
        if (!!(this.status & JPAEmitterStatus.TERMINATE))
            return true;

        if (this.maxFrame === 0)
            return false;

        if (this.maxFrame < 0) {
            this.status |= JPAEmitterStatus.TERMINATED;
            return this.getParticleNumber() === 0;
        }

        if (this.age >= this.maxFrame) {
            this.status |= JPAEmitterStatus.TERMINATED;

            if (!!(this.status & JPAEmitterStatus.IMMORTAL))
                return false;

            return this.getParticleNumber() === 0;
        }

        return false;
    }

    private calcWorkData_c(workData: JPAEmitterWorkData): void {
        // Set up the work data for simulation.
        workData.volumeSize = this.volumeSize;
        workData.volumeMinRad = this.volumeMinRad;
        workData.volumeSweep = this.volumeSweep;
        workData.volumeEmitXCount = 0;
        workData.volumeEmitAngleCount = 0;
        workData.volumeEmitAngleMax = 1;
        workData.divNumber = this.resData.res.bem1.divNumber * 2 + 1;

        mat4.copy(workData.globalRotation, this.globalRotation);

        computeModelMatrixR(scratchMatrix, this.localRotation[0], this.localRotation[1], this.localRotation[2]);
        mat4.mul(workData.emitterGlobalRotation, workData.globalRotation, scratchMatrix);

        mat4.fromScaling(scratchMatrix, this.localScale);
        mat4.mul(workData.emitterGlobalSR, workData.emitterGlobalRotation, scratchMatrix);

        vec3.mul(workData.emitterGlobalScale, this.globalDynamicsScale, this.localScale);
        JPAGetDirMtx(workData.emitterDirMtx, this.localDirection);
        vec3.copy(workData.globalDynamicsScale, this.globalDynamicsScale);

        vec3.copy(workData.emitterTranslation, this.localTranslation);

        mat4.fromScaling(scratchMatrix, this.globalDynamicsScale);
        mat4.mul(scratchMatrix, workData.globalRotation, scratchMatrix);
        setMatrixTranslation(scratchMatrix, this.globalTranslation);
        transformVec3Mat4w1(workData.emitterGlobalCenterPos, scratchMatrix, this.localTranslation);
    }

    private calcWorkData_d(workData: JPAEmitterWorkData): void {
        // Set up the work data for drawing.
        computeModelMatrixR(scratchMatrix, this.localRotation[0], this.localRotation[1], this.localRotation[2]);
        mat4.mul(workData.emitterGlobalRotation, this.globalRotation, scratchMatrix);
        transformVec3Mat4w0(workData.emitterGlobalDir, workData.emitterGlobalRotation, this.localDirection);

        if (!SORT_PARTICLES) {
            this.calcEmitterGlobalPosition(scratchVec3a);
            const depth = computeViewSpaceDepthFromWorldSpacePoint(workData.posCamMtx, scratchVec3a);
            workData.particleSortKey = setSortKeyDepth(workData.particleSortKey, depth);
        }
    }

    public calc(workData: JPAEmitterWorkData): boolean {
        if (!this.processTillStartFrame())
            return true;

        if (this.processTermination())
            return false;

        workData.baseEmitter = this;

        if (!(this.status & JPAEmitterStatus.STOP_CALC_EMITTER)) {
            this.calcKey();

            // Reset fields.

            // Emitter callback +0x0c
            if (this.emitterCallBack !== null)
                this.emitterCallBack.execute(this);

            this.calcWorkData_c(workData);

            // mCalcEmitterFuncList
            const bsp1 = this.resData.res.bsp1;

            if (bsp1.texIdxAnimData !== null && bsp1.isGlblTexAnm)
                this.texAnmIdx = calcTexIdx(workData, this.age, 0, 0);

            if (bsp1.isGlblClrAnm)
                calcColor(this.colorPrm, this.colorEnv, workData, this.age, 0, 0);

            // mFieldBlocks

            if (!(this.status & JPAEmitterStatus.TERMINATED))
                this.create();

            // Emitter callback +0x10
            if (this.emitterCallBack !== null)
                this.emitterCallBack.executeAfter(this);

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

            this.age += workData.deltaTime;

            if (this.age < 0)
                this.age = 0.01;
        } else {
            // Emitter callback +0x10
            if (this.emitterCallBack !== null)
                this.emitterCallBack.executeAfter(this);
        }

        return true;
    }

    private calcEmitterGlobalPosition(v: vec3): void {
        mat4.scale(scratchMatrix, this.globalRotation, this.globalDynamicsScale);
        scratchMatrix[12] += this.globalTranslation[0];
        scratchMatrix[13] += this.globalTranslation[1];
        scratchMatrix[14] += this.globalTranslation[2];
        transformVec3Mat4w1(v, scratchMatrix, this.localTranslation);
    }

    private drawStripe(renderInstManager: GfxRenderInstManager, workData: JPAEmitterWorkData, particleList: JPABaseParticle[], sp1: CommonShapeTypeFields): void {
        const particleCount = particleList.length;

        if (particleCount < 2)
            return;

        const globalScaleX = 25 * workData.globalParticleScale[0];
        if (globalScaleX <= 0.0) {
            // Nothing to do.
            return;
        }
    
        const bsp1 = this.resData.res.bsp1;
        const reverseOrder = !bsp1.isDrawFwdAhead;

        const needsPrevPos = sp1.dirType === DirType.PrevPctl;
        if (needsPrevPos)
            this.calcEmitterGlobalPosition(workData.prevParticlePos);

        const pivotX = workData.pivotX - 1.0;
        const pivotY = workData.pivotY - 1.0;

        const px0 = globalScaleX * (1.0 + pivotX);
        const px1 = globalScaleX * (1.0 - pivotX);
        const py0 = globalScaleX * (1.0 + pivotY);
        const py1 = globalScaleX * (1.0 - pivotY);

        const isCross = sp1.shapeType === ShapeType.StripeCross;

        const oneStripVertexCount = particleCount * 2;
        const bufferVertexCount = isCross ? oneStripVertexCount * 2 : oneStripVertexCount;
        const device = workData.emitterManager.cache.device;
        const entry = workData.emitterManager.stripeBufferManager.allocateVertexBuffer(device, bufferVertexCount);

        scratchMatrix[12] = 0;
        scratchMatrix[13] = 0;
        scratchMatrix[14] = 0;

        const numPoints = isCross ? 4 : 2;
        let stripe0Idx = 0;
        let stripe1Idx = oneStripVertexCount * 5;
        for (let i = 0; i < particleCount; i++) {
            const particleIndex = reverseOrder ? particleCount - 1 - i : i;
            const p = particleList[particleIndex];

            applyDir(scratchVec3a, p, sp1.dirType, workData);
            if (isNearZeroVec3(scratchVec3a, 0.001))
                vec3.set(scratchVec3a, 0, 1, 0);
            else
                vec3.normalize(scratchVec3a, scratchVec3a);
            vec3.cross(scratchVec3b, p.axis, scratchVec3a);
            if (isNearZeroVec3(scratchVec3b, 0.001))
                vec3.set(scratchVec3b, 1, 0, 0);
            else
                vec3.normalize(scratchVec3b, scratchVec3b);
            vec3.cross(p.axis, scratchVec3a, scratchVec3b);
            vec3.normalize(p.axis, p.axis);

            setMatrixAxis(scratchMatrix, scratchVec3b, Vec3Zero, p.axis);

            const sx0 = px0 * -p.particleScale[0];
            const sx1 = px1 *  p.particleScale[0];
            const sin = Math.sin(p.rotateAngle), cos = Math.cos(p.rotateAngle);
            vec3.set(scratchVec3Points[0], sx0 * cos, 0, sx0 * sin);
            vec3.set(scratchVec3Points[1], sx1 * cos, 0, sx1 * sin);
            if (isCross) {
                const sy0 = py0 * -p.particleScale[1];
                const sy1 = py1 *  p.particleScale[1];
                vec3.set(scratchVec3Points[2], sy0 * -sin, 0, sy0 * cos);
                vec3.set(scratchVec3Points[3], sy1 * -sin, 0, sy1 * cos);
            }

            for (let j = 0; j < numPoints; j++)
                transformVec3Mat4w0(scratchVec3Points[j], scratchMatrix, scratchVec3Points[j]);

            const texT = i / (particleCount - 1);
            entry.shadowBufferF32[stripe0Idx++] = scratchVec3Points[0][0] + p.position[0];
            entry.shadowBufferF32[stripe0Idx++] = scratchVec3Points[0][1] + p.position[1];
            entry.shadowBufferF32[stripe0Idx++] = scratchVec3Points[0][2] + p.position[2];
            entry.shadowBufferF32[stripe0Idx++] = 0;
            entry.shadowBufferF32[stripe0Idx++] = texT;
            entry.shadowBufferF32[stripe0Idx++] = scratchVec3Points[1][0] + p.position[0];
            entry.shadowBufferF32[stripe0Idx++] = scratchVec3Points[1][1] + p.position[1];
            entry.shadowBufferF32[stripe0Idx++] = scratchVec3Points[1][2] + p.position[2];
            entry.shadowBufferF32[stripe0Idx++] = 1;
            entry.shadowBufferF32[stripe0Idx++] = texT;

            if (isCross) {
                entry.shadowBufferF32[stripe1Idx++] = scratchVec3Points[2][0] + p.position[0];
                entry.shadowBufferF32[stripe1Idx++] = scratchVec3Points[2][1] + p.position[1];
                entry.shadowBufferF32[stripe1Idx++] = scratchVec3Points[2][2] + p.position[2];
                entry.shadowBufferF32[stripe1Idx++] = 0;
                entry.shadowBufferF32[stripe1Idx++] = texT;
                entry.shadowBufferF32[stripe1Idx++] = scratchVec3Points[3][0] + p.position[0];
                entry.shadowBufferF32[stripe1Idx++] = scratchVec3Points[3][1] + p.position[1];
                entry.shadowBufferF32[stripe1Idx++] = scratchVec3Points[3][2] + p.position[2];
                entry.shadowBufferF32[stripe1Idx++] = 1;
                entry.shadowBufferF32[stripe1Idx++] = texT;
            }

            if (needsPrevPos)
                vec3.copy(workData.prevParticlePos, p.position);
        }

        const globalRes = workData.emitterManager.globalRes;

        const oneStripIndexCount = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriStrips, oneStripVertexCount);

        const renderInst1 = renderInstManager.newRenderInst();
        renderInst1.setDrawCount(oneStripIndexCount);
        renderInst1.sortKey = workData.particleSortKey;
        renderInst1.setVertexInput(globalRes.inputLayout, entry.vertexBufferDescriptors, entry.indexBufferDescriptor);
        workData.fillParticleRenderInst(renderInstManager, renderInst1);
        renderInstManager.submitRenderInst(renderInst1);

        if (isCross) {
            // Since we use a tristrip, that means that if we have 5 particles, we'll have 10 vertices (0-9), with the index
            // buffer doing something like this at the end: 6 7 8,  8 7 9,  8 9 10,  10 9 11,  10 11 12
            // In order to start a "new" tristrip after 10 vertices, we need to find that first "10 11 12", which should be
            // two index pairs (or 6 index values) after the last used index pair.
            const renderInst2 = renderInstManager.newRenderInst();
            renderInst2.copyFrom(renderInst1);
            renderInst2.setDrawCount(oneStripIndexCount, oneStripIndexCount + 6);
            renderInstManager.submitRenderInst(renderInst2);
        }
    }

    private drawQuads(renderInstManager: GfxRenderInstManager, workData: JPAEmitterWorkData, particleList: JPABaseParticle[], sp1: CommonShapeTypeFields): void {
        const n = particleList.length;
        if (n === 0)
            return;

        const needsPrevPos = sp1.dirType === DirType.PrevPctl;
        if (needsPrevPos)
            this.calcEmitterGlobalPosition(workData.prevParticlePos);

        let sortKeyBias = 0;

        const renderInst = workData.usingInstancing ? renderInstManager.newRenderInst() : renderInstManager.pushTemplate();

        const device = workData.emitterManager.cache.device;
        const globalRes = this.emitterManager.globalRes;
        renderInst.setVertexInput(globalRes.inputLayout, globalRes.inputVertexQuad, globalRes.inputIndexQuad);
        renderInst.setDrawCount(isCross(sp1.shapeType) ? 12 : 6);

        workData.aliveParticleNum = 0;
        workData.dataTexture = this.emitterManager.dataTextureManager.allocateTexture(device, n);
        workData.dataTextureOffs = 0;
        if (workData.usingInstancing)
            workData.fillEmitterRenderInst(renderInstManager, renderInst);

        const isDrawFwdAhead = this.resData.res.bsp1.isDrawFwdAhead;
        for (let i = 0; i < n; i++) {
            const index = isDrawFwdAhead ? i : n - 1 - i;
            workData.particleSortKey = setSortKeyBias(workData.particleSortKey, sortKeyBias++);
            particleList[index].draw(renderInstManager, workData);
            if (needsPrevPos)
                vec3.copy(workData.prevParticlePos, particleList[index].position);
        }

        if (workData.usingInstancing) {
            if (workData.aliveParticleNum > 0) {
                renderInst.setInstanceCount(workData.aliveParticleNum);
                renderInstManager.submitRenderInst(renderInst);
            } else {
                this.emitterManager.dataTextureManager.returnTexture(workData.dataTexture);
            }
        } else {
            renderInstManager.popTemplate();
        }
    }

    private drawP(renderInstManager: GfxRenderInstManager, workData: JPAEmitterWorkData): void {
        const bsp1 = this.resData.res.bsp1;
        const etx1 = this.resData.res.etx1;

        this.status &= ~JPAEmitterStatus.CHILD_DRAW;
        vec2.mul(workData.globalParticleScale, this.globalParticleScale, bsp1.baseSize);

        if (bsp1.shapeType === ShapeType.Point) {
            workData.globalParticleScale[0] *= 1.02;
        } else if (bsp1.shapeType === ShapeType.Line) {
            workData.globalParticleScale[0] *= 1.02;
            workData.globalParticleScale[1] *= 0.4;
        }

        // mpDrawEmitterFuncList

        workData.usingInstancing = this.resData.usingInstancingP;
        workData.materialHelper = this.resData.materialHelperP;

        const materialParams = workData.materialParams;
        const drawParams = workData.drawParams;
        const device = this.emitterManager.cache.device;

        if (bsp1.texIdxAnimData === null)
            this.resData.fillTextureMapping(materialParams.m_TextureMapping[0], bsp1.texIdx);
        else if (bsp1.isGlblTexAnm)
            this.resData.fillTextureMapping(materialParams.m_TextureMapping[0], this.texAnmIdx);
        else if (workData.usingInstancing) {
            for (let i = 0; i < this.resData.textureIds.length; i++)
                this.resData.fillTextureMapping(materialParams.m_TextureMapping[i], i);
        }

        if (etx1 !== null) {
            if (etx1.indTextureMode === IndTextureMode.Normal) {
                const dstIndex = workData.usingInstancing ? 13 : 2;
                this.resData.fillTextureMapping(materialParams.m_TextureMapping[dstIndex], etx1.indTextureID);
                fillIndTexMtx(materialParams.u_IndTexMtx[0], etx1.indTextureMtx);
                // TODO(jstpierre): Subtextures, a JPA1 feature, in JPADrawSetupTev::setupTev.
            }

            if (etx1.secondTextureIndex !== -1) {
                const dstIndex = workData.usingInstancing ? 14 : 3;
                this.resData.fillTextureMapping(materialParams.m_TextureMapping[dstIndex], etx1.secondTextureIndex);
                mat4.identity(materialParams.u_TexMtx[1]);
            }
        }

        workData.forceTexMtxIdentity = false;
        workData.childDraw = false;
        if (bsp1.shapeType === ShapeType.Point || bsp1.shapeType === ShapeType.Line)
            mat4.identity(materialParams.u_TexMtx[0]);
        else if (!bsp1.isEnableTexScrollAnm)
            calcTexCrdMtxIdt(materialParams.u_TexMtx[0], bsp1);

        // Setup stripe info if we need to, before we call the user callback.
        if (isStripe(bsp1.shapeType)) {
            colorMult(materialParams.u_Color[ColorKind.C0], this.colorPrm, workData.baseEmitter.globalColorPrm);
            colorMult(materialParams.u_Color[ColorKind.C1], this.colorEnv, workData.baseEmitter.globalColorEnv);

            mat4.copy(drawParams.u_PosMtx[0], workData.posCamMtx);
    
            if (!calcTexCrdMtxPrj(materialParams.u_TexMtx[0], workData, workData.posCamMtx, materialParams.m_TextureMapping[0].flipY)) {
                if (bsp1.isEnableTexScrollAnm)
                    calcTexCrdMtxAnm(materialParams.u_TexMtx[0], bsp1, workData.baseEmitter.age);
            }
        }

        // Emitter Callback 0x18

        if (this.emitterCallBack !== null)
            this.emitterCallBack.draw(this, device, renderInstManager);

        if (isStripe(bsp1.shapeType)) {
            this.drawStripe(renderInstManager, workData, this.aliveParticlesBase, bsp1);
        } else {
            this.drawQuads(renderInstManager, workData, this.aliveParticlesBase, bsp1);
        }
    }

    private drawC(renderInstManager: GfxRenderInstManager, workData: JPAEmitterWorkData): void {
        const bsp1 = this.resData.res.bsp1;
        const ssp1 = this.resData.res.ssp1!;

        const materialParams = workData.materialParams;

        this.status |= JPAEmitterStatus.CHILD_DRAW;

        if (ssp1.isInheritedScale)
            vec2.mul(workData.globalParticleScale, this.globalParticleScale, bsp1.baseSize);
        else
            vec2.mul(workData.globalParticleScale, this.globalParticleScale, ssp1.globalScale2D);

        if (ssp1.shapeType === ShapeType.Point) {
            workData.globalParticleScale[0] *= 1.02;
        } else if (ssp1.shapeType === ShapeType.Line) {
            workData.globalParticleScale[0] *= 1.02;
            workData.globalParticleScale[1] *= 0.4;
        }

        workData.forceTexMtxIdentity = true;
        workData.childDraw = true;
        workData.usingInstancing = this.resData.usingInstancingC;
        workData.materialHelper = this.resData.materialHelperC!;

        mat4.identity(materialParams.u_TexMtx[0]);
        mat4.identity(materialParams.u_TexMtx[1]);
        workData.baseEmitter.resData.fillTextureMapping(materialParams.m_TextureMapping[0], ssp1.texIdx);

        // mpDrawEmitterChildFuncList

        if (isStripe(ssp1.shapeType)) {
            colorMult(materialParams.u_Color[ColorKind.C0], ssp1.colorPrm, workData.baseEmitter.globalColorPrm);
            colorMult(materialParams.u_Color[ColorKind.C1], ssp1.colorEnv, workData.baseEmitter.globalColorEnv);

            this.drawStripe(renderInstManager, workData, this.aliveParticlesChild, ssp1);
        } else {
            this.drawQuads(renderInstManager, workData, this.aliveParticlesChild, ssp1);
        }
    }

    public draw(renderInstManager: GfxRenderInstManager, workData: JPAEmitterWorkData): void {
        if (!!(this.status & JPAEmitterStatus.STOP_DRAW_PARTICLE) || !this.drawParticle)
            return;

        const bsp1 = this.resData.res.bsp1;
        const ssp1 = this.resData.res.ssp1;

        workData.baseEmitter = this;

        this.calcWorkData_d(workData);

        if (!bsp1.isNoDrawChild && ssp1 !== null && bsp1.isDrawPrntAhead)
            this.drawC(renderInstManager, workData);
        if (!bsp1.isNoDrawParent)
            this.drawP(renderInstManager, workData);
        if (!bsp1.isNoDrawChild && ssp1 !== null && !bsp1.isDrawPrntAhead)
            this.drawC(renderInstManager, workData);
    }
}

function calcTexCrdMtxAnm(dst: mat4, bsp1: JPABaseShapeBlock, tick: number): void {
    const offsS = 0.5 * bsp1.tilingS;
    const offsT = 0.5 * bsp1.tilingT;

    const translationS = (bsp1.texInitTransX + tick * bsp1.texIncTransX) + offsS;
    const translationT = (bsp1.texInitTransY + tick * bsp1.texIncTransY) + offsT;
    const scaleS = (bsp1.texInitScaleX + tick * bsp1.texIncScaleX);
    const scaleT = (bsp1.texInitScaleY + tick * bsp1.texIncScaleY);
    const rotate = (bsp1.texInitRot + tick * bsp1.texIncRot) * MathConstants.TAU / 0xFFFF;

    const sinR = Math.sin(rotate);
    const cosR = Math.cos(rotate);

    // Normally, the setting of tiling is done by choosing a separate texcoord array through the GXSetArray call in setPTev.
    // If the tiling bit is on, then it uses a texcoord of 2.0 instead of 1.0. In our case, we just adjust the texture matirx.

    dst[0]  = bsp1.tilingS * scaleS *  cosR;
    dst[4]  = bsp1.tilingS * scaleS * -sinR;
    dst[8]  = 0.0;
    dst[12] = offsS + scaleS * (sinR * translationT - cosR * translationS);

    dst[1]  = bsp1.tilingT * scaleT *  sinR;
    dst[5]  = bsp1.tilingT * scaleT *  cosR;
    dst[9]  = 0.0;
    dst[13] = offsT + -scaleT * (sinR * translationS + cosR * translationT);

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = 1.0;
    dst[14] = 0.0;
}

function calcTexCrdMtxIdt(dst: mat4, bsp1: JPABaseShapeBlock): void {
    // Normally, the choice of tiling is done by choosing a separate texcoord array through the GXSetArray call in setPTev.
    // If the tiling bit is on, then it uses a texcoord of 2.0 instead of 1.0. In our case, we just adjust the texture matirx.

    const scaleS = bsp1.tilingS;
    const scaleT = bsp1.tilingT;

    dst[0]  = scaleS;
    dst[4]  = 0.0;
    dst[8]  = 0.0;
    dst[12] = 0.0;

    dst[1]  = 0.0;
    dst[5]  = scaleT;
    dst[9]  = 0.0;
    dst[13] = 0.0;

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

function calcTexCrdMtxPrj(dst: mat4, workData: JPAEmitterWorkData, posMtx: mat4, flipY: boolean): boolean {
    const bsp1 = workData.baseEmitter.resData.res.bsp1;

    if (bsp1.isEnableProjection) {
        if (bsp1.isEnableTexScrollAnm) {
            // loadPrjAnm
            calcTexCrdMtxAnm(dst, bsp1, workData.baseEmitter.age);
            mat4SwapTranslationColumns(dst);
            mat4.copy(scratchMatrix, workData.texPrjMtx);
            if (flipY) {
                scratchMatrix[5] *= -1;
                scratchMatrix[13] += 2;
            }
            mat4.mul(dst, dst, scratchMatrix);
            mat4.mul(dst, dst, posMtx);
        } else {
            // loadPrj
            mat4.copy(scratchMatrix, workData.texPrjMtx);
            if (flipY) {
                scratchMatrix[5] *= -1;
                scratchMatrix[13] += 2;
            }
            mat4.mul(dst, scratchMatrix, posMtx);
        }
    }

    return bsp1.isEnableProjection;
}

function applyDir(v: vec3, p: JPABaseParticle, dirType: DirType, workData: JPAEmitterWorkData): void {
    if (dirType === DirType.Vel)
        vec3.copy(v, p.velocity);
    else if (dirType === DirType.Pos)
        vec3.copy(v, p.localPosition);
    else if (dirType === DirType.PosInv)
        vec3.negate(v, p.localPosition);
    else if (dirType === DirType.EmtrDir)
        vec3.copy(v, workData.emitterGlobalDir);
    else if (dirType === DirType.PrevPctl)
        vec3.sub(v, workData.prevParticlePos, p.position);
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();

const planeXZSwizzle = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

const enum JPAParticleStatus {
    NONE                   = 0x00,
    DELETE_PARTICLE        = 0x02,
    STOP_FIELD_FADE_AFFECT = 0x04,
    INVISIBLE_PARTICLE     = 0x08,
    FOLLOW_EMITTER         = 0x20,
    STOP_FIELD_AFFECT      = 0x40,
}

export class JPABaseParticle {
    public status: JPAParticleStatus;
    public time: number;
    public age: number;
    public position = vec3.create();
    public localPosition = vec3.create();
    public globalPosition = vec3.create();
    public velocity = vec3.create();
    public baseVel = vec3.create();
    public fieldAccel = vec3.create();
    public fieldVel = vec3.create();
    public axis = vec3.create();
    public accel = vec3.create();

    public particleScale = vec2.create();
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
    public dragFieldEffect: number;
    public airResist: number;

    public init_p(workData: JPAEmitterWorkData): void {
        const baseEmitter = workData.baseEmitter;
        const bem1 = baseEmitter.resData.res.bem1;
        const bsp1 = baseEmitter.resData.res.bsp1;
        const esp1 = baseEmitter.resData.res.esp1;

        this.age = -1;
        this.status = 0;
        this.time = 0;

        const lifeTimeRndm = get_rndm_f(baseEmitter.random);
        this.lifeTime = baseEmitter.lifeTime * (1.0 - lifeTimeRndm * bem1.lifeTimeRndm);

        transformVec3Mat4w0(this.localPosition, workData.emitterGlobalSR, workData.volumePos);

        if (!!(bem1.emitFlags & EmitFlags.FollowEmitter))
            this.status |= JPAParticleStatus.FOLLOW_EMITTER;

        vec3.copy(this.globalPosition, workData.emitterGlobalCenterPos);

        this.position[0] = this.globalPosition[0] + this.localPosition[0] * workData.globalDynamicsScale[0];
        this.position[1] = this.globalPosition[1] + this.localPosition[1] * workData.globalDynamicsScale[1];
        this.position[2] = this.globalPosition[2] + this.localPosition[2] * workData.globalDynamicsScale[2];

        vec3.zero(this.baseVel);

        if (baseEmitter.awayFromCenterSpeed !== 0)
            normToLengthAndAdd(this.baseVel, workData.velOmni, baseEmitter.awayFromCenterSpeed);
        if (baseEmitter.awayFromYAxisSpeed !== 0)
            normToLengthAndAdd(this.baseVel, workData.velAxis, baseEmitter.awayFromYAxisSpeed);
        if (baseEmitter.directionalSpeed !== 0) {
            const randZ = next_rndm(baseEmitter.random) >>> 16;
            const randY = get_r_zp(baseEmitter.random);
            mat4.identity(scratchMatrix);
            computeModelMatrixR(scratchMatrix, 0.0, baseEmitter.spread * randY * Math.PI, randZ / 0xFFFF * Math.PI);
            mat4.mul(scratchMatrix, workData.emitterDirMtx, scratchMatrix);
            this.baseVel[0] += baseEmitter.directionalSpeed * scratchMatrix[8];
            this.baseVel[1] += baseEmitter.directionalSpeed * scratchMatrix[9];
            this.baseVel[2] += baseEmitter.directionalSpeed * scratchMatrix[10];
        }
        if (baseEmitter.randomDirectionSpeed !== 0) {
            const randZ = get_r_zh(baseEmitter.random);
            const randY = get_r_zh(baseEmitter.random);
            const randX = get_r_zh(baseEmitter.random);
            this.baseVel[0] += baseEmitter.randomDirectionSpeed * randX;
            this.baseVel[1] += baseEmitter.randomDirectionSpeed * randY;
            this.baseVel[2] += baseEmitter.randomDirectionSpeed * randZ;
        }
        const velRatio = 1.0 + get_r_zp(baseEmitter.random) * bem1.initialVelRatio;
        vec3.scale(this.baseVel, this.baseVel, velRatio);

        if (!!(bem1.emitFlags & EmitFlags.InheritScale))
            vec3.mul(this.baseVel, this.baseVel, baseEmitter.localScale);

        transformVec3Mat4w0(this.baseVel, workData.emitterGlobalRotation, this.baseVel);

        vec3.copy(this.accel, this.baseVel);
        const accel = bem1.accel * (1.0 + (get_r_zp(baseEmitter.random) * bem1.accelRndm));
        normToLength(this.accel, accel);

        vec3.zero(this.fieldAccel);

        this.drag = 1.0;
        this.airResist = Math.min(bem1.airResist + (bem1.airResistRndm * get_r_zh(baseEmitter.random)), 1);
        this.moment = baseEmitter.moment * (1.0 - (bem1.momentRndm * get_rndm_f(baseEmitter.random)));
        vec3.set(this.axis, workData.emitterGlobalRotation[4], workData.emitterGlobalRotation[5], workData.emitterGlobalRotation[6]);

        colorCopy(this.colorPrm, baseEmitter.colorPrm);
        colorCopy(this.colorEnv, baseEmitter.colorEnv);
        this.anmRandom = (get_rndm_f(baseEmitter.random) * bsp1.anmRndm) & 0xFF;

        // ScaleX/Y/Out
        if (esp1 !== null && esp1.isEnableScale) {
            this.scaleOut = baseEmitter.scaleOut * (1.0 + (esp1.scaleOutRandom * get_r_zp(baseEmitter.random)));
        } else {
            this.scaleOut = baseEmitter.scaleOut;
        }
        vec2.set(this.particleScale, this.scaleOut, this.scaleOut);

        this.prmColorAlphaAnm = 1.0;

        if (esp1 !== null && esp1.isEnableAlpha)
            this.alphaWaveRandom = 1.0 + (get_r_zp(baseEmitter.random) * esp1.alphaWaveRandom);
        else
            this.alphaWaveRandom = 1.0;

        if (esp1 !== null && esp1.isEnableRotate) {
            this.rotateAngle = esp1.rotateAngle + (get_rndm_f(baseEmitter.random) - 0.5) * esp1.rotateAngleRandom;
            this.rotateSpeed = esp1.rotateSpeed * (1.0 + (esp1.rotateSpeedRandom * get_r_zp(baseEmitter.random)));
            if (get_r_zp(baseEmitter.random) >= esp1.rotateDirection)
                this.rotateSpeed *= -1;
        } else {
            this.rotateAngle = 0;
            this.rotateSpeed = 0;
        }

        this.texAnmIdx = 0;

        this.initField(workData);
    }

    public init_c(workData: JPAEmitterWorkData, parent: JPABaseParticle): void {
        const baseEmitter = workData.baseEmitter;
        const bem1 = baseEmitter.resData.res.bem1;
        const ssp1 = baseEmitter.resData.res.ssp1!;

        this.age = -1;
        this.time = 0;
        this.status = JPAParticleStatus.STOP_FIELD_FADE_AFFECT;

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

        if (!!(bem1.emitFlags & EmitFlags.FollowEmitterChild))
            this.status |= JPAParticleStatus.FOLLOW_EMITTER;

        vec3.copy(this.globalPosition, parent.globalPosition);

        const velRndm = ssp1.baseVel * (1.0 + ssp1.baseVelRndm * get_rndm_f(baseEmitter.random));
        const rndX = get_rndm_f(baseEmitter.random) - 0.5;
        const rndY = get_rndm_f(baseEmitter.random) - 0.5;
        const rndZ = get_rndm_f(baseEmitter.random) - 0.5;
        vec3.set(scratchVec3a, rndX, rndY, rndZ);
        normToLength(scratchVec3a, velRndm);
        vec3.scaleAndAdd(this.baseVel, scratchVec3a, parent.baseVel, ssp1.velInfRate);
        vec3.scale(this.fieldAccel, parent.fieldVel, ssp1.velInfRate);

        this.moment = parent.moment;

        if (ssp1.isEnableField) {
            // isEnableField
            this.drag = parent.drag;
        } else {
            this.status |= JPAParticleStatus.STOP_FIELD_AFFECT;
            this.drag = 1.0;
        }

        vec3.copy(this.fieldVel, this.fieldAccel);

        vec3.add(this.velocity, this.baseVel, this.fieldVel);
        const totalMomentum = this.moment * this.drag;
        vec3.scale(this.velocity, this.velocity, totalMomentum);

        vec3.copy(this.axis, parent.axis);

        if (ssp1.isInheritedScale) {
            // isInheritedScale
            const scaleX = parent.particleScale[0] * ssp1.inheritScale;
            this.particleScale[0] = scaleX;
            const scaleY = parent.particleScale[1] * ssp1.inheritScale;
            this.particleScale[1] = scaleY;

            // On children particles, these fields are reused... ¯\_(ツ)_/¯
            this.scaleOut = scaleX;
            this.alphaWaveRandom = scaleY;
        } else {
            vec2.set(this.particleScale, 1, 1);
            this.scaleOut = 1;
            this.alphaWaveRandom = 1;
        }

        if (ssp1.isInheritedRGB) {
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

        if (ssp1.isInheritedAlpha) {
            this.colorPrm.a = (parent.colorPrm.a * parent.prmColorAlphaAnm) * ssp1.inheritAlpha;
        } else {
            this.colorPrm.a = ssp1.colorPrm.a;
        }

        this.rotateAngle = parent.rotateAngle;
        if (ssp1.isEnableRotate) {
            this.rotateSpeed = ssp1.rotateSpeed;
        } else {
            this.rotateSpeed = 0;
        }

        this.texAnmIdx = 0;
    }

    private calcFieldFadeAffect(field: JPAFieldBlock, time: number): number {
        if ((!!(field.sttFlag & FieldStatusFlag.FadeUseEnTime) && time < field.enTime) ||
            (!!(field.sttFlag & FieldStatusFlag.FadeUseDisTime) && time >= field.disTime)) {
            return 0;
        }

        if (!!(field.sttFlag & FieldStatusFlag.FadeUseFadeIn) && time < field.fadeIn)
            return (time - field.enTime) * field.fadeInRate;

        if (!!(field.sttFlag & FieldStatusFlag.FadeUseFadeOut) && time >= field.fadeOut)
            return (field.disTime - time) * field.fadeOutRate;

        return 1;
    }

    private calcFieldAffect(v: vec3, field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        if (!(this.status & JPAParticleStatus.STOP_FIELD_FADE_AFFECT) && !!(field.sttFlag & FieldStatusFlag.FadeFlagMask))
            vec3.scale(v, v, this.calcFieldFadeAffect(field, this.time));

        if (field.addType === FieldAddType.FieldAccel)
            vec3.scaleAndAdd(this.fieldAccel, this.fieldAccel, v, workData.deltaTime);
        else if (field.addType === FieldAddType.BaseVelocity)
            vec3.scaleAndAdd(this.baseVel, this.baseVel, v, workData.deltaTime);
        else if (field.addType === FieldAddType.FieldVelocity)
            vec3.scaleAndAdd(this.fieldVel, this.fieldVel, v, workData.deltaTime);
    }

    private calcFieldGravity(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare
        vec3.scale(scratchVec3a, field.dir, field.mag);
        if (!(field.sttFlag & FieldStatusFlag.LocalSpace))
            transformVec3Mat4w0(scratchVec3a, workData.globalRotation, scratchVec3a);

        // Calc
        this.calcFieldAffect(scratchVec3a, field, workData);
    }

    private calcFieldAir(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare
        vec3.scale(scratchVec3a, field.dir, field.mag);
        if (!(field.sttFlag & FieldStatusFlag.LocalSpace))
            transformVec3Mat4w0(scratchVec3a, workData.globalRotation, scratchVec3a);

        // Calc
        this.calcFieldAffect(scratchVec3a, field, workData);
        if (!!(field.sttFlag & FieldStatusFlag.AirDrag)) {
            if (vec3.squaredLength(this.baseVel) > field.refDistance ** 2.0)
                normToLength(this.baseVel, field.refDistance);
        }
    }

    private calcFieldMagnet(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        if (!!(field.sttFlag & FieldStatusFlag.LocalSpace)) {
            vec3.sub(scratchVec3a, field.pos, this.globalPosition);
        } else {
            // Convert to emitter space.
            vec3.sub(scratchVec3a, field.pos, workData.emitterTranslation);
            transformVec3Mat4w0(scratchVec3a, workData.globalRotation, scratchVec3a);
            vec3.sub(scratchVec3a, scratchVec3a, this.localPosition);
        }

        // Calc
        normToLength(scratchVec3a, field.mag);
        this.calcFieldAffect(scratchVec3a, field, workData);
    }

    private calcFieldNewton(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        if (!!(field.sttFlag & FieldStatusFlag.LocalSpace)) {
            vec3.sub(scratchVec3a, field.pos, this.globalPosition);
        } else {
            // Convert to emitter space.
            vec3.sub(scratchVec3a, field.pos, workData.emitterTranslation);
            transformVec3Mat4w0(scratchVec3a, workData.globalRotation, scratchVec3a);
            vec3.sub(scratchVec3a, scratchVec3a, this.localPosition);
        }

        const power = 10 * field.mag;
        const refDistanceSq = field.refDistance;

        // Calc
        const sqDist = vec3.squaredLength(scratchVec3a);
        if (sqDist <= refDistanceSq) {
            normToLength(scratchVec3a, power);
        } else {
            normToLength(scratchVec3a, refDistanceSq / sqDist * power);
        }

        this.calcFieldAffect(scratchVec3a, field, workData);
    }

    private calcFieldVortex(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        const forceDir = scratchVec3a;
        const forceVec = scratchVec3b;

        transformVec3Mat4w0(forceDir, workData.globalRotation, field.dir);
        vec3.normalize(forceDir, forceDir);

        const distance = field.pos[2];
        const sqVortexDist = distance ** 2.0;
        const innerSpeed = field.innerSpeed;
        const outerSpeed = field.outerSpeed;

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
        this.calcFieldAffect(forceVec, field, workData);
    }

    private calcFieldRandom(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        // Calc

        // Randomize on the first tick of each particle, or every cycles parameters.
        // Since we don't use integer frame timings, there's no great way to do this...
        // in theory this could skip a tick or few...
        const tickInt = (this.age | 0);
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
            vec3.scale(scratchVec3a, scratchVec3a, field.mag);
            this.calcFieldAffect(scratchVec3a, field, workData);
        }
    }

    private calcFieldDrag(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare

        // Calc
        if (!(this.status & JPAParticleStatus.STOP_FIELD_FADE_AFFECT)) {
            this.drag *= (1.0 - (this.calcFieldFadeAffect(field, this.time) * (1.0 - this.dragFieldEffect)));
        } else {
            this.drag *= this.dragFieldEffect;
        }
    }

    private calcFieldConvection(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare
        vec3.cross(scratchVec3c, field.pos, field.dir);
        vec3.cross(scratchVec3a, field.dir, scratchVec3c);

        transformVec3Mat4w0(scratchVec3a, workData.emitterGlobalRotation, scratchVec3a);
        transformVec3Mat4w0(scratchVec3b, workData.emitterGlobalRotation, field.dir);
        transformVec3Mat4w0(scratchVec3c, workData.emitterGlobalRotation, scratchVec3c);
        vec3.normalize(scratchVec3a, scratchVec3a);
        vec3.normalize(scratchVec3b, scratchVec3b);
        vec3.normalize(scratchVec3c, scratchVec3c);

        // Calc
        const aDotPos = vec3.dot(scratchVec3a, this.localPosition);
        vec3.scale(scratchVec3a, scratchVec3a, aDotPos);
        const cDotPos = vec3.dot(scratchVec3c, this.localPosition);
        vec3.scale(scratchVec3c, scratchVec3c, cDotPos);
        vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);

        const dist = vec3.length(scratchVec3a);
        if (dist === 0) {
            vec3.zero(scratchVec3a);
        } else {
            const scale = field.refDistance / dist;
            vec3.scale(scratchVec3a, scratchVec3a, scale);
        }

        vec3.sub(scratchVec3d, this.localPosition, scratchVec3a);
        vec3.cross(scratchVec3c, scratchVec3b, scratchVec3a);
        vec3.cross(scratchVec3a, scratchVec3c, scratchVec3d);
        normToLength(scratchVec3a, field.mag);
        this.calcFieldAffect(scratchVec3a, field, workData);
    }

    private calcFieldSpin(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        // Prepare
        transformVec3Mat4w0(scratchVec3a, workData.emitterGlobalRotation, field.dir);
        vec3.normalize(scratchVec3a, scratchVec3a);
        mat4.identity(scratchMatrix);
        mat4.rotate(scratchMatrix, scratchMatrix, field.innerSpeed, scratchVec3a);

        // Calc
        transformVec3Mat4w0(scratchVec3a, scratchMatrix, this.localPosition);
        vec3.sub(scratchVec3a, scratchVec3a, this.localPosition);
        this.calcFieldAffect(scratchVec3a, field, workData);
    }

    private calcField(workData: JPAEmitterWorkData): void {
        const fld1 = workData.baseEmitter.resData.res.fld1;
        for (let i = fld1.length - 1; i >= 0; i--) {
            const field = fld1[i];

            if (!!(field.sttFlag & FieldStatusFlag.UseMaxDist) && vec3.squaredDistance(field.pos, this.position) >= field.maxDistSq)
                continue;

            if (field.type === FieldType.Gravity)
                this.calcFieldGravity(field, workData);
            else if (field.type === FieldType.Air)
                this.calcFieldAir(field, workData);
            else if (field.type === FieldType.Magnet)
                this.calcFieldMagnet(field, workData);
            else if (field.type === FieldType.Newton)
                this.calcFieldNewton(field, workData);
            else if (field.type === FieldType.Vortex)
                this.calcFieldVortex(field, workData);
            else if (field.type === FieldType.Random)
                this.calcFieldRandom(field, workData);
            else if (field.type === FieldType.Drag)
                this.calcFieldDrag(field, workData);
            else if (field.type === FieldType.Convection)
                this.calcFieldConvection(field, workData);
            else if (field.type === FieldType.Spin)
                this.calcFieldSpin(field, workData);
            else
                throw "whoops";
        }
    }

    private initFieldDrag(field: JPAFieldBlock, workData: JPAEmitterWorkData): void {
        this.dragFieldEffect = field.mag + field.magRndm * get_r_zh(workData.random);
    }

    private initField(workData: JPAEmitterWorkData): void {
        const fld1 = workData.baseEmitter.resData.res.fld1;
        for (let i = fld1.length - 1; i >= 0; i--) {
            const field = fld1[i];
            if (field.type === FieldType.Drag)
                this.initFieldDrag(field, workData);
        }
    }

    private canCreateChild(workData: JPAEmitterWorkData): boolean {
        if (!workData.baseEmitter.resData.supportedChild)
            return false;

        const ssp1 = workData.baseEmitter.resData.res.ssp1!;

        const timing = this.age - ((this.lifeTime - 1) * ssp1.timing);
        if (timing < 0)
            return false;

        const timingInt = (timing | 0);

        const step = ssp1.step + 1;
        if ((timingInt % step) === 0)
            return true;

        return false;
    }

    private calcScaleAnm(type: CalcScaleAnmType, maxFrame: number): number {
        if (type === CalcScaleAnmType.Normal)
            return this.time;
        else if (type === CalcScaleAnmType.Repeat)
            return (this.age / maxFrame) % 1.0;
        else if (type === CalcScaleAnmType.Reverse)
            return 1.0 - this.time;
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
        if (this.age === -1)
            this.age++;
        else
            this.age += workData.deltaTime;

        if (this.age < 0 || this.age >= this.lifeTime)
            return false;

        const res = workData.baseEmitter.resData.res;

        this.time = this.age / this.lifeTime;

        if (!!(this.status & JPAParticleStatus.FOLLOW_EMITTER))
            vec3.copy(this.globalPosition, workData.emitterGlobalCenterPos);

        vec3.zero(this.fieldVel);
        vec3.scaleAndAdd(this.baseVel, this.baseVel, this.accel, workData.deltaTime);

        if (!(this.status & JPAParticleStatus.STOP_FIELD_AFFECT))
            this.calcField(workData);

        vec3.add(this.fieldVel, this.fieldVel, this.fieldAccel);
        vec3.scale(this.baseVel, this.baseVel, this.airResist);
        vec3.add(this.velocity, this.baseVel, this.fieldVel);
        const totalMomentum = this.moment * this.drag;
        vec3.scale(this.velocity, this.velocity, totalMomentum);

        // Particle callback 0x0C

        if (!(this.status & JPAParticleStatus.DELETE_PARTICLE)) {
            // mCalcParticleFuncList
            const bsp1 = res.bsp1;
            const esp1 = res.esp1;
            const ssp1 = res.ssp1;

            if (bsp1.texIdxAnimData !== null && !bsp1.isGlblTexAnm) {
                const randomPhase = this.anmRandom & bsp1.texIdxLoopOfstMask;
                this.texAnmIdx = calcTexIdx(workData, this.age, this.time, randomPhase);
            }

            if (!bsp1.isGlblClrAnm) {
                const randomPhase = this.anmRandom & bsp1.colorLoopOfstMask;
                calcColor(this.colorPrm, this.colorEnv, workData, this.age, this.time, randomPhase);
            } else {
                colorCopy(this.colorPrm, workData.baseEmitter.colorPrm);
                colorCopy(this.colorEnv, workData.baseEmitter.colorEnv);
            }

            if (esp1 !== null) {
                const hasScaleAnm = esp1.isEnableScale;
                if (hasScaleAnm) {
                    const scaleAnmX = this.calcScaleAnm(esp1.scaleAnmTypeX, esp1.scaleAnmMaxFrameX);
                    this.particleScale[0] = this.scaleOut * this.calcScaleFade(scaleAnmX, esp1, esp1.scaleInValueX, esp1.scaleIncreaseRateX, esp1.scaleDecreaseRateX);

                    if (esp1.isEnableScaleBySpeedX)
                        this.particleScale[0] *= vec3.length(this.velocity) * 0.01;

                    const hasScaleAnmY = esp1.isDiffXY;
                    if (hasScaleAnmY) {
                        const scaleAnmY = this.calcScaleAnm(esp1.scaleAnmTypeY, esp1.scaleAnmMaxFrameY);
                        this.particleScale[1] = this.scaleOut * this.calcScaleFade(scaleAnmY, esp1, esp1.scaleInValueY, esp1.scaleIncreaseRateY, esp1.scaleDecreaseRateY);

                        if (esp1.isEnableScaleBySpeedY)
                            this.particleScale[1] *= vec3.length(this.velocity) * 0.01;
                    } else {
                        this.particleScale[1] = this.particleScale[0];
                    }
                }

                if (esp1.isEnableAlpha || esp1.alphaWaveType !== CalcAlphaWaveType.None) {
                    let alpha: number;

                    if (this.time < esp1.alphaInTiming)
                        alpha = esp1.alphaInValue + this.time * esp1.alphaIncreaseRate;
                    else if (this.time > esp1.alphaOutTiming)
                        alpha = esp1.alphaBaseValue + ((this.time - esp1.alphaOutTiming) * esp1.alphaDecreaseRate);
                    else
                        alpha = esp1.alphaBaseValue;

                    const flickerWaveAmplitude = this.alphaWaveRandom * esp1.alphaWaveParam3;
                    const flickerWaveTime = this.alphaWaveRandom * this.age * MathConstants.TAU / 4;

                    if (esp1.alphaWaveType === CalcAlphaWaveType.NrmSin) {
                        const flickerWave = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam1));
                        const flickerMult = 1.0 + (flickerWaveAmplitude * (0.5 * (flickerWave - 1.0)));
                        this.prmColorAlphaAnm = alpha * flickerMult;
                    } else if (esp1.alphaWaveType === CalcAlphaWaveType.AddSin) {
                        const flickerWave1 = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam1));
                        const flickerWave2 = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam2));
                        const flickerWave = flickerWave1 + flickerWave2;
                        const flickerMult = 1.0 + (flickerWaveAmplitude * (0.5 * (flickerWave - 1.0)));
                        this.prmColorAlphaAnm = alpha * flickerMult;
                    } else if (esp1.alphaWaveType === CalcAlphaWaveType.MultSin) {
                        const flickerWave1 = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam1));
                        const flickerWave2 = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam2));
                        const flickerMult1 = 1.0 + (flickerWaveAmplitude * (0.5 * (flickerWave1 - 1.0)));
                        const flickerMult2 = 1.0 + (flickerWaveAmplitude * (0.5 * (flickerWave2 - 1.0)));
                        this.prmColorAlphaAnm = alpha * flickerMult1 * flickerMult2;
                    } else {
                        this.prmColorAlphaAnm = alpha;
                    }
                }
            }

            this.rotateAngle += this.rotateSpeed * workData.deltaTime;

            // Create children.
            if (ssp1 !== null && this.canCreateChild(workData))
                for (let i = 0; i < ssp1.rate; i++)
                    workData.baseEmitter.createChild(this);

            vec3.scaleAndAdd(this.localPosition, this.localPosition, this.velocity, workData.deltaTime);
            vec3.mul(this.position, this.localPosition, workData.globalDynamicsScale);
            vec3.add(this.position, this.position, this.globalPosition);

            return true;
        }

        return false;
    }

    public calc_c(workData: JPAEmitterWorkData): boolean {
        if (this.age === -1)
            this.age++;
        else
            this.age += workData.deltaTime;

        if (this.age < 0 || this.age >= this.lifeTime)
            return false;

        const res = workData.baseEmitter.resData.res;
        const ssp1 = res.ssp1!;

        this.time = this.age / this.lifeTime;

        if (this.age !== 0) {
            if (!!(this.status & JPAParticleStatus.FOLLOW_EMITTER))
                vec3.copy(this.globalPosition, workData.emitterGlobalCenterPos);

            this.baseVel[1] -= ssp1.gravity;
            vec3.zero(this.fieldVel);

            if (!(this.status & JPAParticleStatus.STOP_FIELD_AFFECT))
                this.calcField(workData);

            vec3.add(this.fieldVel, this.fieldVel, this.fieldAccel);
            vec3.scale(this.baseVel, this.baseVel, res.bem1.airResist);
            vec3.add(this.velocity, this.baseVel, this.fieldVel);
            const totalMomentum = this.moment * this.drag;
            vec3.scale(this.velocity, this.velocity, totalMomentum);
        }

        // Particle callback 0x0C

        if (!(this.status & JPAParticleStatus.DELETE_PARTICLE)) {
            // mCalcChildFuncList

            const invTime = (1.0 - this.time);

            if (ssp1.isEnableScaleOut) {
                this.particleScale[0] = this.scaleOut * invTime;
                this.particleScale[1] = this.alphaWaveRandom * invTime; 
            }

            if (ssp1.isEnableAlphaOut) {
                // isEnableAlphaOut
                this.prmColorAlphaAnm = invTime;
            }

            this.rotateAngle += this.rotateSpeed * workData.deltaTime;

            vec3.scaleAndAdd(this.localPosition, this.localPosition, this.velocity, workData.deltaTime);
            vec3.mul(this.position, this.localPosition, workData.globalDynamicsScale);
            vec3.add(this.position, this.position, this.globalPosition);

            return true;
        }

        return false;
    }

    private loadTexMtx(dst: mat4, textureMapping: TextureMapping, workData: JPAEmitterWorkData, posMtx: mat4): void {
        if (workData.forceTexMtxIdentity)
            return;

        if (!calcTexCrdMtxPrj(dst, workData, posMtx, textureMapping.flipY)) {
            const bsp1 = workData.baseEmitter.resData.res.bsp1;
            if (bsp1.isEnableTexScrollAnm)
                calcTexCrdMtxAnm(dst, bsp1, this.age);
        }
    }

    private applyPlane(m: mat4, plane: PlaneType, scaleX: number, scaleY: number): void {
        if (plane === PlaneType.XY) {
            m[0] *= scaleX;
            m[1] *= scaleX;
            m[2] *= scaleX;

            m[4] *= scaleY;
            m[5] *= scaleY;
            m[6] *= scaleY;
        } else if (plane === PlaneType.XZ) {
            m[0] *= scaleX;
            m[1] *= scaleX;
            m[2] *= scaleX;

            m[8] *= scaleY;
            m[9] *= scaleY;
            m[10] *= scaleY;

            mat4.mul(m, m, planeXZSwizzle);
        } else if (plane === PlaneType.X) {
            m[0] *= scaleX;
            m[1] *= scaleX;
            m[2] *= scaleX;

            m[4] *= scaleY;
            m[5] *= scaleY;
            m[6] *= scaleY;

            m[8] *= scaleX;
            m[9] *= scaleX;
            m[10] *= scaleX;
        }
    }

    private applyRot(dst: mat4, angle: number, rotType: RotType): void {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (rotType === RotType.X) {
            dst[0] = 1;
            dst[4] = 0;
            dst[8] = 0;
            dst[12] = 0;

            dst[1] = 0;
            dst[5] = cos;
            dst[9] = -sin;
            dst[13] = 0;

            dst[2] = 0;
            dst[6] = sin;
            dst[10] = cos;
            dst[14] = 0;
        } else if (rotType === RotType.Y) {
            dst[0] = cos;
            dst[4] = 0;
            dst[8] = -sin;
            dst[12] = 0;

            dst[1] = 0;
            dst[5] = 1;
            dst[9] = 0;
            dst[13] = 0;

            dst[2] = sin;
            dst[6] = 0;
            dst[10] = cos;
            dst[14] = 0;
        } else if (rotType === RotType.Z) {
            dst[0] = cos;
            dst[4] = -sin;
            dst[8] = 0;
            dst[12] = 0;

            dst[1] = sin;
            dst[5] = cos;
            dst[9] = 0;
            dst[13] = 0;

            dst[2] = 0;
            dst[6] = 0;
            dst[10] = 1;
            dst[14] = 0;
        } else if (rotType === RotType.XYZ) {
            // Rotate around all three angles.
            const rot = (1/3) * (1.0 - cos);
            const a = rot + cos, b = rot - (0.57735 * sin), c = rot + (0.57735 * sin);
            dst[0] = a;
            dst[4] = b;
            dst[8] = c;
            dst[12] = 0;

            dst[1] = b;
            dst[5] = a;
            dst[9] = c;
            dst[13] = 0;

            dst[2] = c;
            dst[6] = b;
            dst[10] = a;
            dst[14] = 0;
        } else if (rotType === RotType.YJiggle) {
            // Seems to be a 12deg rotation.
            const jiggleSin = 0.207912;
            const jiggleCos = 0.978148;
            dst[0] = cos;
            dst[4] = jiggleSin;
            dst[8] = -sin;
            dst[12] = 0;

            dst[1] = 0;
            dst[5] = jiggleCos;
            dst[9] = -jiggleSin;
            dst[13] = 0;

            dst[2] = sin;
            dst[6] = cos * jiggleSin;
            dst[10] = cos * jiggleCos;
            dst[14] = 0;
        }
    }

    private applyPivot(m: mat4, workData: JPAEmitterWorkData): void {
        // If pivot is 0, then the coords are 0 and 50.
        // If pivot is 1, then the coords are -25 and 25 (default).
        // If pivot is 2, then the coords are -50 and 0.

        const pivotX = workData.pivotX;
        if (pivotX === 0 || pivotX === 2) {
            mat4.identity(scratchMatrix);
            if (pivotX === 0)
                scratchMatrix[12] = -25;
            else if (pivotX === 2)
                scratchMatrix[12] = 25;
            mat4.mul(m, m, scratchMatrix);
        }

        const pivotY = workData.pivotY;
        if (pivotY === 0 || pivotY === 2) {
            mat4.identity(scratchMatrix);
            if (pivotY === 0)
                scratchMatrix[13] = -25;
            else if (pivotY === 2)
                scratchMatrix[13] = 25;
            mat4.mul(m, m, scratchMatrix);
        }
    }

    private fillDataTexture(workData: JPAEmitterWorkData): void {
        const d = workData.dataTexture.data;
        let offs = workData.dataTextureOffs;
        offs += fillMatrix4x3(d, offs, workData.drawParams.u_PosMtx[0]);
        offs += fillMatrix4x3(d, offs, workData.materialParams.u_TexMtx[0]);
        const colorPrm = colorToRGBA8(workData.materialParams.u_Color[ColorKind.C0]);
        const colorEnv = colorToRGBA8(workData.materialParams.u_Color[ColorKind.C1]);
        offs += fillVec4(d, offs, bitsAsFloat32(colorPrm), bitsAsFloat32(colorEnv), this.texAnmIdx);
        workData.dataTextureOffs = offs;
    }

    private drawCommon(renderInstManager: GfxRenderInstManager, workData: JPAEmitterWorkData, sp1: CommonShapeTypeFields): void {
        if (!!(this.status & JPAParticleStatus.INVISIBLE_PARTICLE))
            return;

        // We model all particles below as spheres with radius 25, which should cover all bases.
        // Stripes are an exception, but they are handled separately.
        if (workData.frustum !== null) {
            const scaleX = Math.abs(this.particleScale[0] * workData.globalParticleScale[0]);
            const scaleY = Math.abs(this.particleScale[1] * workData.globalParticleScale[1]);
            const radius = 25 * Math.max(scaleX, scaleY);
            if (!workData.frustum.containsSphere(this.position, radius))
                return;
        }

        workData.aliveParticleNum++;

        const esp1 = workData.baseEmitter.resData.res.esp1;
        const isRot = esp1 !== null && esp1.isEnableRotate;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.sortKey = workData.particleSortKey;

        if (SORT_PARTICLES) {
            const depth = computeViewSpaceDepthFromWorldSpacePoint(workData.posCamMtx, this.position);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        }

        const shapeType = sp1.shapeType;

        const materialParams = workData.materialParams;
        const drawParams = workData.drawParams;

        const scaleX = workData.globalParticleScale[0] * this.particleScale[0];
        const scaleY = workData.globalParticleScale[1] * this.particleScale[1];

        if (shapeType === ShapeType.Line) {
            // Draw a line from (this.position) to (this.position - this.velocity.norm() * scaleY).

            // Our quad is set up in the middle, so the center point is the midpoint of those two,
            // aka (this.position - this.velocity.norm * scaleY * 0.5).
            vec3.normalize(scratchVec3c, this.velocity);
            vec3.scaleAndAdd(scratchVec3b, this.position, scratchVec3c, -scaleY * 0.5);
            transformVec3Mat4w1(scratchVec3b, workData.posCamMtx, scratchVec3b);

            // To go from the center to reach either edge is just the half-extents of the velocity direction.
            transformVec3Mat4w0(scratchVec3a, workData.posCamMtx, scratchVec3c);
            vec3.scale(scratchVec3a, scratchVec3a, -0.5);

            const dst = drawParams.u_PosMtx[0];

            dst[0] = -scratchVec3a[1] * scaleX;
            dst[1] = scratchVec3a[0] * scaleX;
            dst[2] = 0;

            dst[4] = scratchVec3a[0] * scaleY;
            dst[5] = scratchVec3a[1] * scaleY;
            dst[6] = 0;

            // The Z+ axis should face the camera.
            dst[8] = 0;
            dst[9] = 0;
            dst[10] = 1;

            dst[12] = scratchVec3b[0];
            dst[13] = scratchVec3b[1];
            dst[14] = scratchVec3b[2];

            // No pivot on lines.
            this.loadTexMtx(materialParams.u_TexMtx[0], materialParams.m_TextureMapping[0], workData, dst);

            // The UV on the line should stretch from (0.0, 0.0) to (0.0, 1.0), so zero out the scale of the
            // texture matrix while keeping the rest the same.
            // TODO(jstpierre): This breaks on Line10 / Line20? Have to check how the original game works...
            // materialParams.u_TexMtx[0][0] = 0.0;
        } else if (shapeType === ShapeType.Billboard) {
            const rotateAngle = isRot ? this.rotateAngle : 0;

            transformVec3Mat4w1(scratchVec3a, workData.posCamMtx, this.position);
            computeModelMatrixSRT(drawParams.u_PosMtx[0],
                scaleX, scaleY, 1,
                0, 0, rotateAngle,
                scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
            this.applyPivot(drawParams.u_PosMtx[0], workData);
            this.loadTexMtx(materialParams.u_TexMtx[0], materialParams.m_TextureMapping[0], workData, drawParams.u_PosMtx[0]);
        } else if (shapeType === ShapeType.Direction || shapeType === ShapeType.DirectionCross) {
            applyDir(scratchVec3a, this, sp1.dirType, workData);
            if (isNearZeroVec3(scratchVec3a, 0.001))
                return;

            vec3.normalize(scratchVec3a, scratchVec3a);

            vec3.cross(scratchVec3b, this.axis, scratchVec3a);
            if (isNearZeroVec3(scratchVec3b, 0.001))
                return;

            vec3.normalize(scratchVec3b, scratchVec3b);

            vec3.cross(this.axis, scratchVec3a, scratchVec3b);
            vec3.normalize(this.axis, this.axis);

            const dst = drawParams.u_PosMtx[0];
            dst[0] = this.axis[0];
            dst[1] = this.axis[1];
            dst[2] = this.axis[2];
            dst[4] = scratchVec3a[0];
            dst[5] = scratchVec3a[1];
            dst[6] = scratchVec3a[2];
            dst[8] = scratchVec3b[0];
            dst[9] = scratchVec3b[1];
            dst[10] = scratchVec3b[2];

            dst[12] = this.position[0];
            dst[13] = this.position[1];
            dst[14] = this.position[2];

            // We want:
            //   View x Particle x Rot x Scale x PlaneSwizzle x Pivot

            if (isRot) {
                this.applyRot(scratchMatrix, this.rotateAngle, sp1.rotType);
                this.applyPlane(scratchMatrix, sp1.planeType, scaleX, scaleY);
                mat4.mul(dst, dst, scratchMatrix);
            } else {
                this.applyPlane(dst, sp1.planeType, scaleX, scaleY);
            }

            this.applyPivot(dst, workData);
            mat4.mul(dst, workData.posCamMtx, dst);
            this.loadTexMtx(materialParams.u_TexMtx[0], materialParams.m_TextureMapping[0], workData, dst);
        } else if (shapeType === ShapeType.Rotation || shapeType === ShapeType.RotationCross) {
            const dst = drawParams.u_PosMtx[0];
            this.applyRot(dst, this.rotateAngle, sp1.rotType);

            this.applyPlane(dst, sp1.planeType, scaleX, scaleY);
            dst[12] = this.position[0];
            dst[13] = this.position[1];
            dst[14] = this.position[2];
            this.applyPivot(dst, workData);
            mat4.mul(dst, workData.posCamMtx, dst);
            this.loadTexMtx(materialParams.u_TexMtx[0], materialParams.m_TextureMapping[0], workData, dst);
        } else if (shapeType === ShapeType.DirBillboard) {
            applyDir(scratchVec3a, this, sp1.dirType, workData);
            vec3.set(scratchVec3b, workData.posCamMtx[2], workData.posCamMtx[6], workData.posCamMtx[10]);

            vec3.cross(scratchVec3a, scratchVec3a, scratchVec3b);
            vec3.normalize(scratchVec3a, scratchVec3a);

            transformVec3Mat4w0(scratchVec3a, workData.posCamMtx, scratchVec3a);
            transformVec3Mat4w1(scratchVec3b, workData.posCamMtx, this.position);

            const dst = drawParams.u_PosMtx[0];
            dst[0] = scratchVec3a[0] * scaleX;
            dst[1] = scratchVec3a[1] * scaleX;
            dst[2] = 0;

            dst[4] = -scratchVec3a[1] * scaleY;
            dst[5] = scratchVec3a[0] * scaleY;
            dst[6] = 0;

            dst[8] = 0;
            dst[9] = 0;
            dst[10] = 1;

            dst[12] = scratchVec3b[0];
            dst[13] = scratchVec3b[1];
            dst[14] = scratchVec3b[2];
            this.applyPivot(dst, workData);
            this.loadTexMtx(materialParams.u_TexMtx[0], materialParams.m_TextureMapping[0], workData, dst);
        } else if (shapeType === ShapeType.YBillboard) {
            vec3.set(scratchVec3a, 0, workData.posCamMtx[1], workData.posCamMtx[2]);
            vec3.normalize(scratchVec3a, scratchVec3a);

            transformVec3Mat4w1(scratchVec3b, workData.posCamMtx, this.position);
            const dst = drawParams.u_PosMtx[0];

            if (isRot) {
                const sin = Math.sin(this.rotateAngle), cos = Math.cos(this.rotateAngle);
                dst[0] = cos * scaleX;
                dst[1] = sin * workData.ybbCamMtx[5] * scaleX;
                dst[2] = sin * scaleX * workData.ybbCamMtx[9];
                dst[4] = -sin * scaleY;
                dst[5] = cos * workData.ybbCamMtx[5] * scaleY;
                dst[6] = cos * scaleY * workData.ybbCamMtx[9];
                dst[8] = 0;
                dst[9] = -workData.ybbCamMtx[9];
                dst[10] = workData.ybbCamMtx[5];
            } else {
                dst[0] = scaleX;
                dst[1] = 0;
                dst[2] = 0;
                dst[4] = 0;
                dst[5] = workData.ybbCamMtx[5] * scaleY;
                dst[6] = workData.ybbCamMtx[6] * scaleY;
                dst[8] = 0;
                dst[9] = workData.ybbCamMtx[9];
                dst[10] = workData.ybbCamMtx[10];
            }
            dst[12] = scratchVec3b[0];
            dst[13] = scratchVec3b[1];
            dst[14] = scratchVec3b[2];
            this.applyPivot(dst, workData);
            this.loadTexMtx(materialParams.u_TexMtx[0], materialParams.m_TextureMapping[0], workData, dst);
        } else {
            throw "whoops";
        }

        colorMult(materialParams.u_Color[ColorKind.C0], this.colorPrm, workData.baseEmitter.globalColorPrm);
        materialParams.u_Color[ColorKind.C0].a *= this.prmColorAlphaAnm;
        colorMult(materialParams.u_Color[ColorKind.C1], this.colorEnv, workData.baseEmitter.globalColorEnv);

        if (workData.usingInstancing) {
            this.fillDataTexture(workData);
        } else {
            workData.fillParticleRenderInst(renderInstManager, renderInst);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public draw(renderInstManager: GfxRenderInstManager, workData: JPAEmitterWorkData): void {
        const resData = workData.baseEmitter.resData;
        const bsp1 = resData.res.bsp1;
        const esp1 = resData.res.esp1;
        const ssp1 = resData.res.ssp1;

        // mpDrawParticleFuncList
        // mpDrawParticleChildFuncList

        if (!workData.childDraw && !workData.usingInstancing && bsp1.texIdxAnimData !== null && !bsp1.isGlblTexAnm)
            resData.fillTextureMapping(workData.materialParams.m_TextureMapping[0], this.texAnmIdx);

        if (!workData.childDraw && esp1 !== null && esp1.isEnableScale) {
            workData.pivotX = esp1.pivotX;
            workData.pivotY = esp1.pivotY;
        } else {
            workData.pivotX = 1;
            workData.pivotY = 1;
        }

        this.drawCommon(renderInstManager, workData, workData.childDraw ? ssp1! : bsp1);
    }
}
//#endregion

//#region JPA Resource Parsing
const enum JPACVersion {
    JEFFjpa1 = 'JEFFjpa1',
    JPAC1_00 = 'JPAC1-00',
    JPAC2_10 = 'JPAC2-10',
    JPAC2_11 = 'JPAC2-11',
}

const scratchColor = colorNewFromRGBA(0, 0, 0, 0);
function makeColorTable(buffer: ArrayBufferSlice, entryCount: number, duration: number): Color[] {
    const view = buffer.createDataView();

    assert(entryCount > 0 && duration > 0);

    const dst = nArray(duration + 1, () => colorNewFromRGBA(0, 0, 0, 0));
    let dstIdx = 0;

    const color0 = view.getUint32(0x02);
    colorFromRGBA8(dst[dstIdx++], color0);

    const time0 = view.getUint16(0x00);
    for (let i = 1; i <= Math.min(time0, duration); i++)
        colorCopy(dst[dstIdx++], dst[0]);

    let time1: number = time0;
    for (let i = 1; i < entryCount; i++) {
        const entry0 = i - 1, entry1 = i;
        const time0 = view.getUint16(entry0 * 0x06 + 0x00);
        time1 = view.getUint16(entry1 * 0x06 + 0x00);
        assert(time0 === dstIdx - 1);

        colorFromRGBA8(scratchColor, view.getUint32(entry1 * 0x06 + 0x02));

        for (let j = time0 + 1; j <= Math.min(time1, duration); j++)
            colorLerp(dst[dstIdx++], dst[time0], scratchColor, (j - time0) / (time1 - time0));

        assert(dstIdx === Math.min(time1, duration) + 1);
    }

    for (let i = time1 + 1; i <= duration; i++)
        colorCopy(dst[i], dst[time1]);

    return dst;
}

function JPAConvertFixToFloat(n: number): number {
    return n / 0x8000;
}

function parseResource_JEFFjpa1(res: JPAResourceRaw): JPAResource {
    const buffer = res.data;
    const view = buffer.createDataView();

    const blockCount = view.getUint32(0x0C);

    let kfa1KeyTypeMask = 0;

    let bem1: JPADynamicsBlock | null = null;
    let bsp1: JPABaseShapeBlock | null = null;
    let esp1: JPAExtraShapeBlock | null = null;
    let etx1: JPAExTexBlock | null = null;
    let ssp1: JPAChildShapeBlock | null = null;
    let fld1: JPAFieldBlock[] = [];
    let kfa1: JPAKeyBlock[] = [];

    // Parse through the blocks.
    let tableIdx = 0x20;
    for (let j = 0; j < blockCount; j++) {
        // blockSize includes the header.
        const fourcc = readString(buffer, tableIdx + 0x00, 0x04, false);
        const blockSize = view.getUint32(tableIdx + 0x04);

        if (fourcc === 'BEM1') {
            // JPADynamicsBlock
            // Contains emitter settings and details about how the particle simulates.

            const emitterSclX = view.getFloat32(tableIdx + 0x0C);
            const emitterSclY = view.getFloat32(tableIdx + 0x10);
            const emitterSclZ = view.getFloat32(tableIdx + 0x14);
            const emitterScl = vec3.fromValues(emitterSclX, emitterSclY, emitterSclZ);

            const emitterTrsX = view.getFloat32(tableIdx + 0x18);
            const emitterTrsY = view.getFloat32(tableIdx + 0x1C);
            const emitterTrsZ = view.getFloat32(tableIdx + 0x20);
            const emitterTrs = vec3.fromValues(emitterTrsX, emitterTrsY, emitterTrsZ);

            const emitterRotX = (view.getInt16(tableIdx + 0x24) / 0x7FFF) * (MathConstants.TAU / 2.0);
            const emitterRotY = (view.getInt16(tableIdx + 0x26) / 0x7FFF) * (MathConstants.TAU / 2.0);
            const emitterRotZ = (view.getInt16(tableIdx + 0x28) / 0x7FFF) * (MathConstants.TAU / 2.0);
            const emitterRot = vec3.fromValues(emitterRotX, emitterRotY, emitterRotZ);

            const volumeType: VolumeType = view.getUint8(tableIdx + 0x2A);
            const rateStep = view.getUint8(tableIdx + 0x2B);
            const divNumber = view.getUint16(tableIdx + 0x2E);
            const rate = view.getFloat32(tableIdx + 0x30);
            const rateRndm = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x34));
            const maxFrame = view.getInt16(tableIdx + 0x36);
            const startFrame = view.getUint16(tableIdx + 0x38);
            const volumeSize = view.getUint16(tableIdx + 0x3A);
            const volumeSweep = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x3C));
            const volumeMinRad = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x3E));
            const lifeTime = view.getUint16(tableIdx + 0x40);
            const lifeTimeRndm = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x42));
            const dynamicsWeight = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x44));
            const dynamicsWeightRndm = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x46));
            const initialVelRatio = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x48));
            const accelRndm = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x4A));
            const airResist = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x4C));
            const airResistRndm = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x4E));
            const initialVelOmni = view.getFloat32(tableIdx + 0x50);
            const initialVelAxis = view.getFloat32(tableIdx + 0x54);
            const initialVelRndm = view.getFloat32(tableIdx + 0x58);
            const initialVelDir = view.getFloat32(tableIdx + 0x5C);
            const accel = view.getFloat32(tableIdx + 0x60);

            const emitterDirX = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x64));
            const emitterDirY = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x66));
            const emitterDirZ = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x68));
            const emitterDir = vec3.fromValues(emitterDirX, emitterDirY, emitterDirZ);
            vec3.normalize(emitterDir, emitterDir);

            const spread = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x6A));
            const flags = view.getUint32(tableIdx + 0x6C);
            kfa1KeyTypeMask = view.getUint32(tableIdx + 0x70);

            // This was renamed post-JEFFjpa1, it looks like.
            const moment = dynamicsWeight;
            const momentRndm = dynamicsWeightRndm;

            bem1 = {
                emitFlags: flags, volumeType, emitterScl, emitterTrs, emitterDir, emitterRot,
                volumeSweep, volumeMinRad, volumeSize, divNumber, spread, rate, rateRndm, rateStep,
                initialVelOmni, initialVelAxis, initialVelRndm, initialVelDir, initialVelRatio,
                lifeTime, lifeTimeRndm, maxFrame, startFrame, airResist, airResistRndm, moment, momentRndm, accel, accelRndm,
            };
        } else if (fourcc === 'BSP1') {
            // JPABaseShape
            // Contains particle draw settings.

            const baseSizeX = view.getFloat32(tableIdx + 0x18);
            const baseSizeY = view.getFloat32(tableIdx + 0x1C);
            const baseSize = vec2.fromValues(baseSizeX, baseSizeY);

            const anmRndm = view.getUint16(tableIdx + 0x20);
            const texAnmCalcFlags = view.getUint8(tableIdx + 0x22);
            const colorAnmCalcFlags = view.getUint8(tableIdx + 0x23);

            const texIdxLoopOfstMask = !!((texAnmCalcFlags >>> 0) & 0x01) ? 0xFFFF : 0x0000;
            const isGlblTexAnm       = !!((texAnmCalcFlags >>> 1) & 0x01);

            const colorLoopOfstMask  = !!((colorAnmCalcFlags >>> 0) & 0x01) ? 0xFFFF : 0x0000;
            const isGlblClrAnm       = !!((colorAnmCalcFlags >>> 1) & 0x01);

            // Does this exist in JEFFjpa1?
            const isEnableAnmTone = false;

            const shapeType: ShapeType = view.getUint8(tableIdx + 0x24);
            const dirType: DirType = view.getUint8(tableIdx + 0x25);
            const rotType: RotType = view.getUint8(tableIdx + 0x26);

            // planeType does not exist in JEFFjpa1.
            const planeType: PlaneType = PlaneType.XY;

            // stopDrawParent is in the SSP1 block in JEFFjpa1.
            const isNoDrawParent = false;
            // stopDrawChild does not exist in JEFFjpa1.
            const isNoDrawChild = false;

            const colorInSelect = view.getUint8(tableIdx + 0x30);

            // alphaInSelect was added in JEFFjpa1.
            const alphaInSelect = 0;

            const blendMode = view.getUint8(tableIdx + 0x35);
            const blendSrcFactor = view.getUint8(tableIdx + 0x36);
            const blendDstFactor = view.getUint8(tableIdx + 0x37);
            const logicOp = view.getUint8(tableIdx + 0x38);

            const alphaCmp0 = view.getUint8(tableIdx + 0x39);
            const alphaRef0 = view.getUint8(tableIdx + 0x3A);
            const alphaOp = view.getUint8(tableIdx + 0x3B);
            const alphaCmp1 = view.getUint8(tableIdx + 0x3C);
            const alphaRef1 = view.getUint8(tableIdx + 0x3D);

            // 0x3E is ZCompLoc
            const zTest = view.getUint8(tableIdx + 0x3F);
            const zCompare = view.getUint8(tableIdx + 0x40);
            const zWrite = view.getUint8(tableIdx + 0x41);

            // Pack into param bitfields.
            const blendModeFlags = (blendDstFactor << 6) | (blendSrcFactor << 2) | (blendMode << 0);
            const alphaCompareFlags = (alphaCmp1 << 5) | (alphaOp << 3) | (alphaCmp0 << 0);
            const zModeFlags = (zWrite << 4) | (zCompare << 1) | (zTest << 0);

            const isEnableProjection = !!view.getUint8(tableIdx + 0x43);
            const flags = view.getUint8(tableIdx + 0x44);
            const texAnimFlags = view.getUint8(tableIdx + 0x4C);
            const texCalcIdxType: CalcIdxType = view.getUint8(tableIdx + 0x4D);
            const texIdx = view.getUint8(tableIdx + 0x4F);

            let texIdxAnimData: Uint8Array | null = null;
            if (!!((texAnimFlags >>> 0) & 0x01)) {
                const texIdxAnimDataOffs = tableIdx + view.getUint16(tableIdx + 0x12);
                const texIdxAnimDataCount = view.getUint8(tableIdx + 0x4E);
                texIdxAnimData = buffer.createTypedArray(Uint8Array, texIdxAnimDataOffs, texIdxAnimDataCount, Endianness.BIG_ENDIAN);
            }

            const colorAnimMaxFrm = view.getUint16(tableIdx + 0x5C);
            const colorCalcIdxType: CalcIdxType = view.getUint8(tableIdx + 0x5E);
            const colorPrmAnimFlags = view.getUint8(tableIdx + 0x60);
            const colorEnvAnimFlags = view.getUint8(tableIdx + 0x61);

            let colorPrmAnimData: Color[] | null = null;
            if (!!((colorPrmAnimFlags >>> 1) & 0x01)) {
                const colorPrmAnimDataOffs = tableIdx + view.getUint16(tableIdx + 0x14);
                const colorPrmAnimDataCount = view.getUint8(tableIdx + 0x62);
                colorPrmAnimData = makeColorTable(buffer.slice(colorPrmAnimDataOffs), colorPrmAnimDataCount, colorAnimMaxFrm);
            }

            let colorEnvAnimData: Color[] | null = null;
            if (!!((colorEnvAnimFlags >>> 1) & 0x01)) {
                const colorEnvAnimDataOffs = tableIdx + view.getUint16(tableIdx + 0x16);
                const colorEnvAnimDataCount = view.getUint8(tableIdx + 0x63);
                colorEnvAnimData = makeColorTable(buffer.slice(colorEnvAnimDataOffs), colorEnvAnimDataCount, colorAnimMaxFrm);
            }

            const colorPrm = colorNewFromRGBA8(view.getUint32(tableIdx + 0x64));
            const colorEnv = colorNewFromRGBA8(view.getUint32(tableIdx + 0x68));

            const texInitTransX = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x80)) * 10;
            const texInitTransY = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x82)) * 10;
            const texInitScaleX = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x84)) * 10;
            const texInitScaleY = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x86)) * 10;
            const tilingS = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x88)) * 10;
            const tilingT = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x8A)) * 10;
            const texIncTransX = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x8C));
            const texIncTransY = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x8E));
            const texIncScaleX = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x90)) * 0.1;
            const texIncScaleY = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x92)) * 0.1;
            const texIncRot = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x94));
            // texStaticRotate was added in JPA2.
            const texInitRot = 0;

            const isEnableTexScrollAnm = !!view.getUint8(tableIdx + 0x96);

            const isDrawFwdAhead  = !!((flags >>> 0) & 0x01);
            const isDrawPrntAhead = !!((flags >>> 1) & 0x01);

            const isEnableTexture = true;

            bsp1 = {
                shapeType, dirType, rotType, planeType, baseSize, tilingS, tilingT, isDrawFwdAhead, isDrawPrntAhead, isNoDrawParent, isNoDrawChild,
                colorInSelect, alphaInSelect, blendModeFlags, alphaCompareFlags, alphaRef0, alphaRef1, zModeFlags,
                anmRndm,
                isEnableTexture, isGlblTexAnm, texCalcIdxType, texIdx, texIdxAnimData, texIdxLoopOfstMask,
                isEnableTexScrollAnm, isEnableProjection, isEnableAnmTone,
                texInitTransX, texInitTransY, texInitScaleX, texInitScaleY, texInitRot,
                texIncTransX, texIncTransY, texIncScaleX, texIncScaleY, texIncRot,
                isGlblClrAnm, colorCalcIdxType, colorPrm, colorEnv, colorEnvAnimData, colorPrmAnimData, colorAnimMaxFrm, colorLoopOfstMask,
            };
        } else if (fourcc === 'ESP1') {
            // JPAExtraShape
            // Contains misc. extra particle draw settings.

            const alphaInTiming = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x14));
            const alphaOutTiming = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x16));
            const alphaInValue = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x18));
            const alphaBaseValue = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x1A));
            const alphaOutValue = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x1C));
            const alphaAnmFlags = view.getUint8(tableIdx + 0x1E);

            const isEnableAlpha   = !!((alphaAnmFlags >>> 0) & 0x01);
            const isEnableSinWave = !!((alphaAnmFlags >>> 1) & 0x01);
            const alphaWaveTypeFlag = view.getUint8(tableIdx + 0x1F);
            const alphaWaveType: CalcAlphaWaveType = isEnableSinWave ? alphaWaveTypeFlag : CalcAlphaWaveType.None;

            let alphaIncreaseRate = 1;
            if (alphaInTiming > 0)
                alphaIncreaseRate = (alphaBaseValue - alphaInValue) / alphaInTiming;

            let alphaDecreaseRate = 1;
            if (alphaOutTiming < 1)
                alphaDecreaseRate = (alphaOutValue - alphaBaseValue) / (1.0 - alphaOutTiming);

            const alphaWaveParam1 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x20));
            const alphaWaveParam2 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x22));
            const alphaWaveParam3 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x24));
            const alphaWaveRandom = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x26));

            const scaleOutRandom = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x34));
            const scaleInTiming =  JPAConvertFixToFloat(view.getInt16(tableIdx + 0x36));
            const scaleOutTiming = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x38));

            const scaleInValueY =  JPAConvertFixToFloat(view.getInt16(tableIdx + 0x3A));
            const scaleOutValueY = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x3E));
            const pivotY = view.getUint8(tableIdx + 0x40);
            const anmTypeY = view.getUint8(tableIdx + 0x41);
            const scaleAnmMaxFrameY = view.getUint16(tableIdx + 0x42);

            const scaleInValueX =  JPAConvertFixToFloat(view.getInt16(tableIdx + 0x44));
            const scaleOutValueX = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x48));
            const pivotX = view.getUint8(tableIdx + 0x4A);
            const anmTypeX = view.getUint8(tableIdx + 0x4B);
            const scaleAnmMaxFrameX = view.getUint16(tableIdx + 0x4C);

            const scaleAnmFlags = view.getUint8(tableIdx + 0x4E);

            const isEnableScale         = !!((scaleAnmFlags >>> 1) & 0x01);
            const isDiffXY              = !!((scaleAnmFlags >>> 2) & 0x01);
            const isEnableScaleAnmY     = !!((scaleAnmFlags >>> 3) & 0x01);
            const isEnableScaleAnmX     = !!((scaleAnmFlags >>> 4) & 0x01);
            const isEnableScaleBySpeedY = !!((scaleAnmFlags >>> 5) & 0x01);
            const isEnableScaleBySpeedX = !!((scaleAnmFlags >>> 6) & 0x01);
            const scaleAnmTypeX = isEnableScaleAnmX ? anmTypeX ? CalcScaleAnmType.Reverse : CalcScaleAnmType.Repeat : CalcScaleAnmType.Normal;
            const scaleAnmTypeY = isEnableScaleAnmY ? anmTypeY ? CalcScaleAnmType.Reverse : CalcScaleAnmType.Repeat : CalcScaleAnmType.Normal;

            let scaleIncreaseRateX = 1, scaleIncreaseRateY = 1;
            if (scaleInTiming > 0) {
                scaleIncreaseRateX = (1.0 - scaleInValueX) / scaleInTiming;
                scaleIncreaseRateY = (1.0 - scaleInValueY) / scaleInTiming;
            }

            let scaleDecreaseRateX = 1, scaleDecreaseRateY = 1;
            if (scaleOutTiming < 1) {
                scaleDecreaseRateX = (scaleOutValueX - 1.0) / (1.0 - scaleOutTiming);
                scaleDecreaseRateY = (scaleOutValueY - 1.0) / (1.0 - scaleOutTiming);
            }

            const rotateAngle = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x5A)) * MathConstants.TAU;
            const rotateSpeed = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x5C)) * MathConstants.TAU;
            const rotateAngleRandom = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x5E)) * MathConstants.TAU;
            const rotateSpeedRandom = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x60));
            const rotateDirection = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x52));
            const isEnableRotate = !!view.getUint8(tableIdx + 0x64);

            esp1 = {
                isEnableScale, isDiffXY, scaleAnmTypeX, scaleAnmTypeY, isEnableScaleBySpeedX, isEnableScaleBySpeedY,
                isEnableAlpha, alphaWaveType, isEnableRotate, pivotX, pivotY,
                scaleInTiming, scaleOutTiming, scaleInValueX, scaleOutValueX, scaleInValueY, scaleOutValueY,
                scaleIncreaseRateX, scaleIncreaseRateY, scaleDecreaseRateX, scaleDecreaseRateY,
                scaleOutRandom, scaleAnmMaxFrameX, scaleAnmMaxFrameY,
                alphaInTiming, alphaOutTiming, alphaInValue, alphaBaseValue, alphaOutValue,
                alphaIncreaseRate, alphaDecreaseRate,
                alphaWaveParam1, alphaWaveParam2, alphaWaveParam3, alphaWaveRandom,
                rotateAngle, rotateAngleRandom, rotateSpeed, rotateSpeedRandom, rotateDirection,
            };
        } else if (fourcc === 'SSP1') {
            // JPAChildShape / JPASweepShape
            // Contains child particle draw settings.

            const shapeType: ShapeType = view.getUint8(tableIdx + 0x10);
            const dirType: DirType = view.getUint8(tableIdx + 0x11);
            const rotType: RotType = view.getUint8(tableIdx + 0x12);

            // planeType does not exist in JEFFjpa1.
            const planeType: PlaneType = PlaneType.XY;

            const life = view.getUint16(tableIdx + 0x14);
            const rate = view.getUint16(tableIdx + 0x16);
            const step = view.getUint8(tableIdx + 0x1A);
            const posRndm = view.getFloat32(tableIdx + 0x28);
            const baseVel = view.getFloat32(tableIdx + 0x2C);
            const isEnableField = !!view.getUint8(tableIdx + 0x36);

            const isEnableDrawParent = !!view.getUint8(tableIdx + 0x44);
            assertExists(bsp1).isNoDrawParent = !isEnableDrawParent;

            const isEnableScaleOut = !!view.getUint8(tableIdx + 0x45);
            const isEnableAlphaOut = !!view.getUint8(tableIdx + 0x46);
            const texIdx = view.getUint8(tableIdx + 0x47);

            const globalScale2DX = view.getFloat32(tableIdx + 0x4C);
            const globalScale2DY = view.getFloat32(tableIdx + 0x50);
            const globalScale2D = vec2.fromValues(globalScale2DX, globalScale2DY);

            const isEnableRotate = !!view.getUint8(tableIdx + 0x56);
            const flags = view.getUint8(tableIdx + 0x57);
            const isInheritedScale = !!((flags >>> 0) & 0x01);
            const isInheritedAlpha = !!((flags >>> 1) & 0x01);
            const isInheritedRGB   = !!((flags >>> 2) & 0x01);

            const colorPrm = colorNewFromRGBA8(view.getUint32(tableIdx + 0x58));
            const colorEnv = colorNewFromRGBA8(view.getUint32(tableIdx + 0x5C));

            const timing = JPAConvertFixToFloat(view.getUint16(tableIdx + 0x18));
            const velInfRate = JPAConvertFixToFloat(view.getUint16(tableIdx + 0x30));
            const baseVelRndm = JPAConvertFixToFloat(view.getUint16(tableIdx + 0x32));
            const gravity = JPAConvertFixToFloat(view.getUint16(tableIdx + 0x34));
            const inheritScale = JPAConvertFixToFloat(view.getUint16(tableIdx + 0x32));
            const inheritAlpha = JPAConvertFixToFloat(view.getUint16(tableIdx + 0x32));
            const inheritRGB = JPAConvertFixToFloat(view.getUint16(tableIdx + 0x32));
            const rotateSpeed = JPAConvertFixToFloat(view.getUint16(tableIdx + 0x32));

            ssp1 = {
                isEnableRotate, isEnableAlphaOut, isEnableScaleOut, isEnableField, isInheritedRGB, isInheritedAlpha, isInheritedScale,
                shapeType, dirType, rotType, planeType,
                posRndm, baseVel, baseVelRndm, velInfRate, gravity, globalScale2D,
                inheritScale, inheritAlpha, inheritRGB, colorPrm, colorEnv, timing,
                life, rate, step, texIdx, rotateSpeed,
            };
        } else if (fourcc === 'ETX1') {
            // JPAExTexShape
            // Contains extra texture draw settings.

            const indTextureMode: IndTextureMode = view.getUint8(tableIdx + 0x10);
            const indTextureMtxID = view.getUint8(tableIdx + 0x11);

            const p00 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x12));
            const p01 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x14));
            const p02 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x16));
            const p10 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x18));
            const p11 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x1A));
            const p12 = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x1C));
            const scale = Math.pow(2, view.getInt8(tableIdx + 0x1E));
            const indTextureMtx = new Float32Array([
                p00*scale, p01*scale, p02*scale, scale,
                p10*scale, p11*scale, p12*scale, 0.0,
            ]);

            const indTextureID = view.getUint8(tableIdx + 0x1F);
            const subTextureID = view.getUint8(tableIdx + 0x20);
            const secondTextureFlags = view.getUint8(tableIdx + 0x30);
            const secondTextureIndex = (!!((secondTextureFlags >>> 0) & 0x01)) ? view.getUint8(tableIdx + 0x33) : -1;

            etx1 = { indTextureMode, indTextureMtx, indTextureID, subTextureID, secondTextureIndex };
        } else if (fourcc === 'KFA1') {
            // JPAKeyBlock
            // Contains curve animations for various emitter parameters.

            assert(kfa1KeyTypeMask !== 0);

            // Look for the first set bit on the right-hand side.
            let keyType: JPAKeyType = -1;
            for (let i = 0; i < 16; i++) {
                if (kfa1KeyTypeMask & (1 << i)) {
                    keyType = i;
                    break;
                }
            }

            const keyCount = view.getUint8(tableIdx + 0x10);
            const isLoopEnable = !!view.getUint8(tableIdx + 0x12);

            // The curves are four floats per key, in typical time/value/tangent in/tangent out order.
            const keyValues = buffer.createTypedArray(Float32Array, tableIdx + 0x20, keyCount * 4, Endianness.BIG_ENDIAN);

            kfa1.push({ keyType, isLoopEnable, keyValues });

            // Now unset it from the mask so we don't find it again.
            kfa1KeyTypeMask = kfa1KeyTypeMask & ~(1 << keyType);
        } else if (fourcc === 'FLD1') {
            // JPAFieldBlock
            // Contains physics simulation fields that act on the particles.

            const type: FieldType = view.getUint8(tableIdx + 0x0C);
            const velType: FieldAddType = view.getUint8(tableIdx + 0x0E);
            const cycle = view.getUint8(tableIdx + 0x0F);
            const sttFlag = view.getUint8(tableIdx + 0x10);

            const mag = view.getFloat32(tableIdx + 0x14);
            const magRndm = view.getFloat32(tableIdx + 0x18);
            const maxDist = view.getFloat32(tableIdx + 0x1C);
            const maxDistSq = maxDist ** 2.0;

            const posX = view.getFloat32(tableIdx + 0x20);
            const posY = view.getFloat32(tableIdx + 0x24);
            const posZ = view.getFloat32(tableIdx + 0x28);
            const pos = vec3.fromValues(posX, posY, posZ);

            const dirX = view.getFloat32(tableIdx + 0x2C);
            const dirY = view.getFloat32(tableIdx + 0x30);
            const dirZ = view.getFloat32(tableIdx + 0x34);
            const dir = vec3.fromValues(dirX, dirY, dirZ);

            const param1 = view.getFloat32(tableIdx + 0x38);
            const param2 = view.getFloat32(tableIdx + 0x3C);
            const param3 = view.getFloat32(tableIdx + 0x40);

            const fadeIn = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x44));
            const fadeOut = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x46));
            const enTime = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x48));
            const disTime = JPAConvertFixToFloat(view.getInt16(tableIdx + 0x4A));

            let fadeInRate = 1;
            if (fadeIn > enTime)
                fadeInRate = 1 / (fadeIn - enTime);

            let fadeOutRate = 1;
            if (fadeOut < disTime)
                fadeOutRate = 1 / (disTime - fadeOut);

            let refDistance = -1;
            let innerSpeed = -1;
            let outerSpeed = -1;

            if (type === FieldType.Newton) {
                refDistance = param1 ** 2.0;
            }

            if (type === FieldType.Vortex) {
                innerSpeed = mag;
                outerSpeed = magRndm;
            }
    
            if (type === FieldType.Convection) {
                refDistance = param2;
            }

            if (type === FieldType.Spin) {
                innerSpeed = mag;
            }
    
            fld1.push({ sttFlag, type, addType: velType, pos, dir, maxDistSq, mag, magRndm, refDistance, innerSpeed, outerSpeed, fadeIn, fadeOut, enTime, disTime, cycle, fadeInRate, fadeOutRate });
        } else if (fourcc === 'TEX1') {
            // Textures were parsed beforehand; skip.
        } else {
            throw "whoops";
        }

        tableIdx += blockSize;
    }

    return {
        bem1: assertExists(bem1),
        bsp1: assertExists(bsp1),
        esp1,
        etx1,
        ssp1,
        fld1,
        kfa1,
        tdb1: null,
    };
}

function parseResource_JPAC1_00(res: JPAResourceRaw): JPAResource {
    const buffer = res.data;
    const view = buffer.createDataView();

    const blockCount = view.getUint32(0x0C);
    const keyBlockCount = view.getUint8(0x14);
    const fieldBlockCount = view.getUint8(0x15);
    const tdb1Count = view.getUint8(0x16);

    let bem1: JPADynamicsBlock | null = null;
    let bsp1: JPABaseShapeBlock | null = null;
    let esp1: JPAExtraShapeBlock | null = null;
    let etx1: JPAExTexBlock | null = null;
    let ssp1: JPAChildShapeBlock | null = null;
    let fld1: JPAFieldBlock[] = [];
    let kfa1: JPAKeyBlock[] = [];
    let tdb1: Uint16Array | null = null;

    // Parse through the blocks.
    let tableIdx = 0x20;
    for (let j = 0; j < blockCount; j++) {
        // blockSize includes the header.
        const fourcc = readString(buffer, tableIdx + 0x00, 0x04, false);
        const blockSize = view.getUint32(tableIdx + 0x04);

        // Most JPA 1.0 code is written relative to the data begin, which is + 0x0C.
        const dataBegin = tableIdx + 0x0C;

        if (fourcc === 'BEM1') {
            // JPADynamicsBlock
            // Contains emitter settings and details about how the particle simulates.

            const flags = view.getUint32(dataBegin + 0x00);
            const volumeType: VolumeType = (flags >>> 8) & 0x07;

            const volumeSweep = view.getFloat32(dataBegin + 0x04);
            const volumeMinRad = view.getFloat32(dataBegin + 0x08);
            const volumeSize = view.getInt16(dataBegin + 0x0C);
            const divNumber = view.getInt16(dataBegin + 0x0E);
            const rate = view.getFloat32(dataBegin + 0x10);
            const rateRndm = view.getFloat32(dataBegin + 0x14);
            const rateStep = view.getUint8(dataBegin + 0x18);

            const maxFrame = view.getInt16(dataBegin + 0x1A);
            const startFrame = view.getInt16(dataBegin + 0x1C);
            const lifeTime = view.getInt16(dataBegin + 0x1E);
            const lifeTimeRndm = view.getFloat32(dataBegin + 0x20);

            const initialVelOmni = view.getFloat32(dataBegin + 0x24);
            const initialVelAxis = view.getFloat32(dataBegin + 0x28);
            const initialVelRndm = view.getFloat32(dataBegin + 0x2C);
            const initialVelDir  = view.getFloat32(dataBegin + 0x30);
            const initialVelRatio = view.getFloat32(dataBegin + 0x34);

            const spread = view.getFloat32(dataBegin + 0x38);
            const airResist = view.getFloat32(dataBegin + 0x3C);
            const airResistRndm = view.getFloat32(dataBegin + 0x40);

            const moment = view.getFloat32(dataBegin + 0x44);
            const momentRndm = view.getFloat32(dataBegin + 0x48);
            const accel = view.getFloat32(dataBegin + 0x4C);
            const accelRndm = view.getFloat32(dataBegin + 0x50);

            const emitterSclX = view.getFloat32(dataBegin + 0x54);
            const emitterSclY = view.getFloat32(dataBegin + 0x58);
            const emitterSclZ = view.getFloat32(dataBegin + 0x5C);
            const emitterScl = vec3.fromValues(emitterSclX, emitterSclY, emitterSclZ);

            const emitterTrsX = view.getFloat32(dataBegin + 0x60);
            const emitterTrsY = view.getFloat32(dataBegin + 0x64);
            const emitterTrsZ = view.getFloat32(dataBegin + 0x68);
            const emitterTrs = vec3.fromValues(emitterTrsX, emitterTrsY, emitterTrsZ);

            const emitterDirX = view.getFloat32(dataBegin + 0x6C);
            const emitterDirY = view.getFloat32(dataBegin + 0x70);
            const emitterDirZ = view.getFloat32(dataBegin + 0x74);
            const emitterDir = vec3.fromValues(emitterDirX, emitterDirY, emitterDirZ);
            vec3.normalize(emitterDir, emitterDir);

            const emitterRotX = view.getInt16(dataBegin + 0x78) * MathConstants.DEG_TO_RAD;
            const emitterRotY = view.getInt16(dataBegin + 0x7A) * MathConstants.DEG_TO_RAD;
            const emitterRotZ = view.getInt16(dataBegin + 0x7C) * MathConstants.DEG_TO_RAD;
            const emitterRot = vec3.fromValues(emitterRotX, emitterRotY, emitterRotZ);

            bem1 = {
                emitFlags: flags, volumeType, emitterScl, emitterTrs, emitterDir, emitterRot,
                volumeSweep, volumeMinRad, volumeSize, divNumber, spread, rate, rateRndm, rateStep,
                initialVelOmni, initialVelAxis, initialVelRndm, initialVelDir, initialVelRatio,
                lifeTime, lifeTimeRndm, maxFrame, startFrame, airResist, airResistRndm, moment, momentRndm, accel, accelRndm,
            };
        } else if (fourcc === 'BSP1') {
            // JPABaseShape
            // Contains particle draw settings.
            const flags = view.getUint32(dataBegin + 0x00);
            const shapeType: ShapeType =    (flags >>>  0) & 0x0F;
            const dirType: DirType     =    (flags >>>  4) & 0x07;
            const rotType: RotType     =    (flags >>>  7) & 0x07;
            let planeType: PlaneType   =    (flags >>> 10) & 0x01;
            const colorLoopOfstMask    =  -((flags >>> 11) & 0x01);
            const isGlblClrAnm         = !!((flags >>> 12) & 0x01);
            const texIdxLoopOfstMask   =  -((flags >>> 13) & 0x01);
            const isGlblTexAnm         = !!((flags >>> 14) & 0x01);
            const colorInSelect        =    (flags >>> 15) & 0x07;
            const alphaInSelect        =    (flags >>> 18) & 0x01;
            const isEnableAnmTone      = !!((flags >>> 19) & 0x01);
            const isEnableProjection   = !!((flags >>> 20) & 0x01);
            const isDrawFwdAhead       = !!((flags >>> 21) & 0x01);
            const isDrawPrntAhead      = !!((flags >>> 22) & 0x01);
            const isEnableClip         = !!((flags >>> 23) & 0x01);
            const isEnableTexScrollAnm = !!((flags >>> 24) & 0x01);

            if (shapeType === ShapeType.DirectionCross || shapeType === ShapeType.RotationCross)
                planeType = PlaneType.X;

            // stopDrawParent is in the SSP1 block in JPA1.
            const isNoDrawParent = false;
            // stopDrawChild does not exist in JPA1.
            const isNoDrawChild = false;

            const baseSizeX = view.getFloat32(dataBegin + 0x08);
            const baseSizeY = view.getFloat32(dataBegin + 0x0C);
            const baseSize = vec2.fromValues(baseSizeX, baseSizeY);

            const anmRndm = view.getInt16(dataBegin + 0x10);

            const blendModeFlags = view.getUint16(dataBegin + 0x12);
            const alphaCompareFlags = view.getUint8(dataBegin + 0x14);
            const alphaRef0 = view.getUint8(dataBegin + 0x15);
            const alphaRef1 = view.getUint8(dataBegin + 0x16);
            const zModeFlags = view.getUint8(dataBegin + 0x17);
            const texFlags = view.getUint8(dataBegin + 0x18);
            const texIdxAnimCount = view.getUint8(dataBegin + 0x19);
            const texIdx = view.getUint8(dataBegin + 0x1A);
            const colorFlags = view.getUint8(dataBegin + 0x1B);
            const colorAnimMaxFrm = view.getUint16(dataBegin + 0x1E);

            const colorPrm = colorNewFromRGBA8(view.getUint32(dataBegin + 0x20));
            const colorEnv = colorNewFromRGBA8(view.getUint32(dataBegin + 0x24));

            const isColorPrmAnm = !!((colorFlags >>> 1) & 0x01);
            const isColorEnvAnm = !!((colorFlags >>> 3) & 0x01);
            const colorCalcIdxType: CalcIdxType = (colorFlags >>> 4) & 0x07;

            let colorPrmAnimData: Color[] | null = null;
            if (isColorPrmAnm) {
                const colorPrmAnimDataOffs = tableIdx + view.getUint16(dataBegin + 0x04);
                const colorPrmAnimDataCount = view.getUint8(dataBegin + 0x1C);
                colorPrmAnimData = makeColorTable(buffer.slice(colorPrmAnimDataOffs), colorPrmAnimDataCount, colorAnimMaxFrm);
            }

            let colorEnvAnimData: Color[] | null = null;
            if (isColorEnvAnm) {
                const colorEnvAnimDataOffs = tableIdx + view.getUint16(dataBegin + 0x06);
                const colorEnvAnimDataCount = view.getUint8(dataBegin + 0x1D);
                colorEnvAnimData = makeColorTable(buffer.slice(colorEnvAnimDataOffs), colorEnvAnimDataCount, colorAnimMaxFrm);
            }

            const tilingS = view.getFloat32(dataBegin + 0x28);
            const tilingT = view.getFloat32(dataBegin + 0x2C);

            const texCalcIdxType: CalcIdxType = (texFlags >>> 2) & 0x07;

            const texInitTransX = view.getFloat32(dataBegin + 0x30);
            const texInitTransY = view.getFloat32(dataBegin + 0x34);
            const texInitScaleX = view.getFloat32(dataBegin + 0x38);
            const texInitScaleY = view.getFloat32(dataBegin + 0x3C);
            // texStaticRotate was added in JPA2.
            const texInitRot = 0;
            const texIncTransX = view.getFloat32(dataBegin + 0x40);
            const texIncTransY = view.getFloat32(dataBegin + 0x44);
            const texIncScaleX = view.getFloat32(dataBegin + 0x48);
            const texIncScaleY = view.getFloat32(dataBegin + 0x4C);
            const texIncRot = view.getFloat32(dataBegin + 0x50);

            let texIdxAnimData: Uint8Array | null = null;
            const isEnableTextureAnm = !!((texFlags >>> 0) & 0x01);
            if (isEnableTextureAnm)
                texIdxAnimData = buffer.createTypedArray(Uint8Array, tableIdx + 0x60, texIdxAnimCount, Endianness.BIG_ENDIAN);

            const isEnableTexture = !!((texFlags >>> 1) & 0x01);

            bsp1 = {
                shapeType, dirType, rotType, planeType, baseSize, tilingS, tilingT, isDrawFwdAhead, isDrawPrntAhead, isNoDrawParent, isNoDrawChild,
                colorInSelect, alphaInSelect, blendModeFlags, alphaCompareFlags, alphaRef0, alphaRef1, zModeFlags,
                anmRndm,
                isEnableTexture, isGlblTexAnm, texCalcIdxType, texIdx, texIdxAnimData, texIdxLoopOfstMask,
                isEnableTexScrollAnm, isEnableProjection, isEnableAnmTone,
                texInitTransX, texInitTransY, texInitScaleX, texInitScaleY, texInitRot,
                texIncTransX, texIncTransY, texIncScaleX, texIncScaleY, texIncRot,
                isGlblClrAnm, colorCalcIdxType, colorPrm, colorEnv, colorEnvAnimData, colorPrmAnimData, colorAnimMaxFrm, colorLoopOfstMask,
            };
        } else if (fourcc === 'ESP1') {
            // JPAExtraShape
            // Contains misc. extra particle draw settings.

            const flags = view.getUint32(dataBegin + 0x00);
            const isEnableAlpha         = !!((flags >>>  0) & 0x01);
            const isEnableSinWave       = !!((flags >>>  1) & 0x01);
            const alphaWaveTypeFlag     =    (flags >>>  2) & 0x03;
            const isEnableScale         = !!((flags >>>  8) & 0x01);
            const isDiffXY              = !!((flags >>>  9) & 0x01);
            const isEnableScaleAnmY     = !!((flags >>> 10) & 0x01);
            const isEnableScaleAnmX     = !!((flags >>> 11) & 0x01);
            const isEnableScaleBySpeedY = !!((flags >>> 12) & 0x01);
            const isEnableScaleBySpeedX = !!((flags >>> 13) & 0x01);
            const pivotX                =    (flags >>> 14) & 0x03;
            const pivotY                =    (flags >>> 16) & 0x03;
            const anmTypeX              = !!((flags >>> 18) & 0x01);
            const anmTypeY              = !!((flags >>> 19) & 0x01);
            const isEnableRotate        = !!((flags >>> 24) & 0x01);

            const alphaWaveType: CalcAlphaWaveType = isEnableSinWave ? alphaWaveTypeFlag : CalcAlphaWaveType.None;
            const scaleAnmTypeX = isEnableScaleAnmX ? anmTypeX ? CalcScaleAnmType.Reverse : CalcScaleAnmType.Repeat : CalcScaleAnmType.Normal;
            const scaleAnmTypeY = isEnableScaleAnmY ? anmTypeY ? CalcScaleAnmType.Reverse : CalcScaleAnmType.Repeat : CalcScaleAnmType.Normal;

            const alphaInTiming = view.getFloat32(dataBegin + 0x08);
            const alphaOutTiming = view.getFloat32(dataBegin + 0x0C);
            const alphaInValue = view.getFloat32(dataBegin + 0x10);
            const alphaBaseValue = view.getFloat32(dataBegin + 0x14);
            const alphaOutValue = view.getFloat32(dataBegin + 0x18);

            let alphaIncreaseRate = 1;
            if (alphaInTiming > 0)
                alphaIncreaseRate = (alphaBaseValue - alphaInValue) / alphaInTiming;

            let alphaDecreaseRate = 1;
            if (alphaOutTiming < 1)
                alphaDecreaseRate = (alphaOutValue - alphaBaseValue) / (1.0 - alphaOutTiming);

            const alphaWaveParam1 = view.getFloat32(dataBegin + 0x1C);
            const alphaWaveParam2 = view.getFloat32(dataBegin + 0x20);
            const alphaWaveParam3 = view.getFloat32(dataBegin + 0x24);
            const alphaWaveRandom = view.getFloat32(dataBegin + 0x28);

            const scaleInTiming =  view.getFloat32(dataBegin + 0x2C);
            const scaleOutTiming = view.getFloat32(dataBegin + 0x30);
            const scaleInValueX =  view.getFloat32(dataBegin + 0x34);
            const scaleOutValueX = view.getFloat32(dataBegin + 0x38);
            const scaleInValueY =  view.getFloat32(dataBegin + 0x3C);
            const scaleOutValueY = view.getFloat32(dataBegin + 0x40);
            const scaleOutRandom = view.getFloat32(dataBegin + 0x44);
            const scaleAnmMaxFrameX = view.getUint16(dataBegin + 0x48);
            const scaleAnmMaxFrameY = view.getUint16(dataBegin + 0x4A);

            let scaleIncreaseRateX = 1, scaleIncreaseRateY = 1;
            if (scaleInTiming > 0) {
                scaleIncreaseRateX = (1.0 - scaleInValueX) / scaleInTiming;
                scaleIncreaseRateY = (1.0 - scaleInValueY) / scaleInTiming;
            }

            let scaleDecreaseRateX = 1, scaleDecreaseRateY = 1;
            if (scaleOutTiming < 1) {
                scaleDecreaseRateX = (scaleOutValueX - 1.0) / (1.0 - scaleOutTiming);
                scaleDecreaseRateY = (scaleOutValueY - 1.0) / (1.0 - scaleOutTiming);
            }

            const rotateAngle = view.getFloat32(dataBegin + 0x4C) * MathConstants.TAU;
            const rotateSpeed = view.getFloat32(dataBegin + 0x50) * MathConstants.TAU;
            const rotateAngleRandom = view.getFloat32(dataBegin + 0x54) * MathConstants.TAU;
            const rotateSpeedRandom = view.getFloat32(dataBegin + 0x58);
            const rotateDirection = view.getFloat32(dataBegin + 0x5C);

            esp1 = {
                isEnableScale, isDiffXY, scaleAnmTypeX, scaleAnmTypeY, isEnableScaleBySpeedX, isEnableScaleBySpeedY,
                isEnableAlpha, alphaWaveType, isEnableRotate, pivotX, pivotY,
                scaleInTiming, scaleOutTiming, scaleInValueX, scaleOutValueX, scaleInValueY, scaleOutValueY,
                scaleIncreaseRateX, scaleIncreaseRateY, scaleDecreaseRateX, scaleDecreaseRateY,
                scaleOutRandom, scaleAnmMaxFrameX, scaleAnmMaxFrameY,
                alphaInTiming, alphaOutTiming, alphaInValue, alphaBaseValue, alphaOutValue,
                alphaIncreaseRate, alphaDecreaseRate,
                alphaWaveParam1, alphaWaveParam2, alphaWaveParam3, alphaWaveRandom,
                rotateAngle, rotateAngleRandom, rotateSpeed, rotateSpeedRandom, rotateDirection,
            };
        } else if (fourcc === 'SSP1') {
            // JPAChildShape / JPASweepShape
            // Contains child particle draw settings.

            const flags = view.getUint32(dataBegin + 0x00);
            const shapeType: ShapeType =    (flags >>>  0) & 0x0F;
            const dirType: DirType     =    (flags >>>  4) & 0x07;
            const rotType: RotType     =    (flags >>>  7) & 0x07;
            let planeType: PlaneType   =    (flags >>> 10) & 0x01;
            const isInheritedScale     = !!((flags >>> 16) & 0x01);
            const isInheritedAlpha     = !!((flags >>> 17) & 0x01);
            const isInheritedRGB       = !!((flags >>> 18) & 0x01);
            const isDrawParent         = !!((flags >>> 19) & 0x01);
            // 20 = unk
            const isEnableField        = !!((flags >>> 21) & 0x01);
            const isEnableScaleOut     = !!((flags >>> 22) & 0x01);
            const isEnableAlphaOut     = !!((flags >>> 23) & 0x01);
            const isEnableRotate       = !!((flags >>> 24) & 0x01);

            if (shapeType === ShapeType.DirectionCross || shapeType === ShapeType.RotationCross)
                planeType = PlaneType.X;

            assertExists(bsp1).isNoDrawParent = !isDrawParent;

            const posRndm = view.getFloat32(dataBegin + 0x04);
            const baseVel = view.getFloat32(dataBegin + 0x08);
            const baseVelRndm = view.getFloat32(dataBegin + 0x0C);
            const velInfRate = view.getFloat32(dataBegin + 0x10);
            const gravity = view.getFloat32(dataBegin + 0x14);
            const timing = view.getFloat32(dataBegin + 0x18);
            const life = view.getUint16(dataBegin + 0x1C);
            const rate = view.getUint16(dataBegin + 0x1E);
            const step = view.getUint8(dataBegin + 0x20);

            const globalScale2DX = view.getFloat32(dataBegin + 0x24);
            const globalScale2DY = view.getFloat32(dataBegin + 0x28);
            const globalScale2D = vec2.fromValues(globalScale2DX, globalScale2DY);

            const rotateSpeed = view.getFloat32(dataBegin + 0x2C);

            const inheritScale = view.getFloat32(dataBegin + 0x30);
            const inheritAlpha = view.getFloat32(dataBegin + 0x34);
            const inheritRGB = view.getFloat32(dataBegin + 0x38);
            const colorPrm = colorNewFromRGBA8(view.getUint32(dataBegin + 0x3C));
            const colorEnv = colorNewFromRGBA8(view.getUint32(dataBegin + 0x40));
            const texIdx = view.getUint8(dataBegin + 0x44);

            ssp1 = {
                isEnableRotate, isEnableAlphaOut, isEnableScaleOut, isEnableField, isInheritedRGB, isInheritedAlpha, isInheritedScale,
                shapeType, dirType, rotType, planeType,
                posRndm, baseVel, baseVelRndm, velInfRate, gravity, globalScale2D,
                inheritScale, inheritAlpha, inheritRGB, colorPrm, colorEnv, timing,
                life, rate, step, texIdx, rotateSpeed,
            };
        } else if (fourcc === 'ETX1') {
            // JPAExTexShape
            // Contains extra texture draw settings.

            const flags = view.getUint32(dataBegin + 0x00);

            const p00 = view.getFloat32(dataBegin + 0x04);
            const p01 = view.getFloat32(dataBegin + 0x08);
            const p02 = view.getFloat32(dataBegin + 0x0C);
            const p10 = view.getFloat32(dataBegin + 0x10);
            const p11 = view.getFloat32(dataBegin + 0x14);
            const p12 = view.getFloat32(dataBegin + 0x18);
            const scale = Math.pow(2, view.getInt8(dataBegin + 0x1C));
            const indTextureMtx = new Float32Array([
                p00*scale, p01*scale, p02*scale, scale,
                p10*scale, p11*scale, p12*scale, 0.0,
            ]);

            const indTextureMode: IndTextureMode = (flags >>> 0) & 0x03;
            const indTextureID = view.getUint8(dataBegin + 0x20);
            const subTextureID = view.getUint8(dataBegin + 0x21);
            const secondTextureIndex = (!!((flags >>> 8) & 0x01)) ? view.getUint8(dataBegin + 0x22) : -1;

            etx1 = { indTextureMode, indTextureMtx, indTextureID, subTextureID, secondTextureIndex };
        } else if (fourcc === 'KFA1') {
            // JPAKeyBlock
            // Contains curve animations for various emitter parameters.

            const keyType: JPAKeyType = view.getUint8(dataBegin + 0x00);
            const keyCount = view.getUint8(dataBegin + 0x04);
            const isLoopEnable = !!view.getUint8(dataBegin + 0x06);

            // The curves are four floats per key, in typical time/value/tangent in/tangent out order.
            const keyValues = buffer.createTypedArray(Float32Array, tableIdx + 0x20, keyCount * 4, Endianness.BIG_ENDIAN);

            kfa1.push({ keyType, isLoopEnable, keyValues });
        } else if (fourcc === 'FLD1') {
            // JPAFieldBlock
            // Contains physics simulation fields that act on the particles.

            const flags = view.getUint32(dataBegin + 0x00);
            const type: FieldType       = (flags >>> 0) & 0x0F;
            const velType: FieldAddType = (flags >>> 8) & 0x03;
            const sttFlag               = (flags >>> 16);

            const mag = view.getFloat32(dataBegin + 0x04);
            const magRndm = view.getFloat32(dataBegin + 0x08);
            const maxDist = view.getFloat32(dataBegin + 0x0C);
            const maxDistSq = maxDist ** 2.0;

            const posX = view.getFloat32(dataBegin + 0x10);
            const posY = view.getFloat32(dataBegin + 0x14);
            const posZ = view.getFloat32(dataBegin + 0x18);
            const pos = vec3.fromValues(posX, posY, posZ);

            const dirX = view.getFloat32(dataBegin + 0x1C);
            const dirY = view.getFloat32(dataBegin + 0x20);
            const dirZ = view.getFloat32(dataBegin + 0x24);
            const dir = vec3.fromValues(dirX, dirY, dirZ);

            const param1 = view.getFloat32(dataBegin + 0x28);
            const param2 = view.getFloat32(dataBegin + 0x2C);
            const param3 = view.getFloat32(dataBegin + 0x30);
            const fadeIn = view.getFloat32(dataBegin + 0x34);
            const fadeOut = view.getFloat32(dataBegin + 0x38);
            const enTime = view.getFloat32(dataBegin + 0x3C);
            const disTime = view.getFloat32(dataBegin + 0x40);
            const cycle = view.getUint8(dataBegin + 0x44);

            let fadeInRate = 1;
            if (fadeIn > enTime)
                fadeInRate = 1 / (fadeIn - enTime);

            let fadeOutRate = 1;
            if (fadeOut < disTime)
                fadeOutRate = 1 / (disTime - fadeOut);

            let refDistance = -1;
            let innerSpeed = -1;
            let outerSpeed = -1;

            if (type === FieldType.Newton) {
                refDistance = param1 ** 2.0;
            }

            if (type === FieldType.Vortex) {
                innerSpeed = mag;
                outerSpeed = magRndm;
            }
    
            if (type === FieldType.Air) {
                refDistance = magRndm;
            }

            if (type === FieldType.Convection) {
                refDistance = param2;
            }

            if (type === FieldType.Spin) {
                innerSpeed = mag;
            }

            fld1.push({ sttFlag, type, addType: velType, maxDistSq, pos, dir, mag, magRndm, refDistance, innerSpeed, outerSpeed, fadeIn, fadeOut, enTime, disTime, cycle, fadeInRate, fadeOutRate });
        } else if (fourcc === 'TDB1') {
            // Not a block. Stores a mapping of particle texture indexes
            // to JPAC texture indices -- I assume this is "Texture Database".
            tdb1 = buffer.subarray(dataBegin + 0x00).createTypedArray(Uint16Array, 0, tdb1Count, Endianness.BIG_ENDIAN);
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

function parseResource_JPAC2(res: JPAResourceRaw, version: JPACVersion): JPAResource {
    assert(version === JPACVersion.JPAC2_10 || version === JPACVersion.JPAC2_11);

    const buffer = res.data;
    const view = buffer.createDataView();

    const blockCount = view.getUint16(0x02);
    const fieldBlockCount = view.getUint8(0x04);
    const keyBlockCount = view.getUint8(0x05);
    const tdb1Count = view.getUint8(0x06);

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
            // JPADynamicsBlock
            // Contains emitter settings and details about how the particle simulates.
            // No Apparent Change in JPAC2_11
            const flags = view.getUint32(tableIdx + 0x08);
            const volumeType: VolumeType = (flags >>> 8) & 0x07;

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
            const momentRndm = view.getFloat32(tableIdx + 0x64);
            const emitterRotX = view.getInt16(tableIdx + 0x68) * MathConstants.DEG_TO_RAD;
            const emitterRotY = view.getInt16(tableIdx + 0x6A) * MathConstants.DEG_TO_RAD;
            const emitterRotZ = view.getInt16(tableIdx + 0x6C) * MathConstants.DEG_TO_RAD;
            const emitterRot = vec3.fromValues(emitterRotX, emitterRotY, emitterRotZ);
            const maxFrame = view.getInt16(tableIdx + 0x6E);
            const startFrame = view.getInt16(tableIdx + 0x70);
            const lifeTime = view.getInt16(tableIdx + 0x72);
            const volumeSize = view.getInt16(tableIdx + 0x74);
            const divNumber = view.getInt16(tableIdx + 0x76);
            const rateStep = view.getUint8(tableIdx + 0x78);

            // airResistRndm was removed in JPAC 2.0.
            const airResistRndm = 0.0;
            // moment is always 1.0 in JPAC 2.0.
            const moment = 1.0;
            // accel was removed in JPAC 2.0.
            const accel = 0.0;
            // accelRndm was removed in JPAC 2.0.
            const accelRndm = 0.0;

            bem1 = {
                emitFlags: flags, volumeType, emitterScl, emitterTrs, emitterDir, emitterRot,
                volumeSweep, volumeMinRad, volumeSize, divNumber, spread, rate, rateRndm, rateStep,
                initialVelOmni, initialVelAxis, initialVelRndm, initialVelDir, initialVelRatio,
                lifeTime, lifeTimeRndm, maxFrame, startFrame, airResist, airResistRndm, moment, momentRndm, accel, accelRndm,
            };
        } else if (fourcc === 'BSP1') {
            // JPABaseShape
            // Contains particle draw settings.

            const flags = view.getUint32(tableIdx + 0x08);
            const shapeType: ShapeType =    (flags >>>  0) & 0x0F;
            const dirType: DirType     =    (flags >>>  4) & 0x07;
            const rotType: RotType     =    (flags >>>  7) & 0x07;
            let planeType: PlaneType   =    (flags >>> 10) & 0x01;
            // 11 = unk
            const isGlblClrAnm         = !!((flags >>> 12) & 0x01);
            // 13 = unk
            const isGlblTexAnm         = !!((flags >>> 14) & 0x01);
            const colorInSelect        =    (flags >>> 15) & 0x07;
            const alphaInSelect        =    (flags >>> 18) & 0x01;
            // 19 = unk

            // Does this exist in JPA2?
            const isEnableAnmTone      = false;

            let isEnableProjection, isDrawFwdAhead, isDrawPrntAhead;
            let isEnableTexScrollAnm, tilingS, tilingT, isNoDrawParent;
            let isNoDrawChild;

            if (version === JPACVersion.JPAC2_10) {
                isEnableProjection   = !!((flags >>> 20) & 0x01);
                isDrawFwdAhead       = !!((flags >>> 21) & 0x01);
                isDrawPrntAhead      = !!((flags >>> 22) & 0x01);
                // 23 = unk
                isEnableTexScrollAnm = !!((flags >>> 24) & 0x01);
                tilingS              = !!((flags >>> 25) & 0x01) ? 2.0 : 1.0;
                tilingT              = !!((flags >>> 26) & 0x01) ? 2.0 : 1.0;
                isNoDrawParent       = !!((flags >>> 27) & 0x01);
                isNoDrawChild        = !!((flags >>> 28) & 0x01);
            } else if (version === JPACVersion.JPAC2_11) {
                // 20 = unk
                // 21 = unk
                // 22 = unk
                isEnableProjection   = !!((flags >>> 22) & 0x01);
                isDrawFwdAhead       = !!((flags >>> 23) & 0x01);
                isDrawPrntAhead      = !!((flags >>> 24) & 0x01);
                // 25 = unk
                isEnableTexScrollAnm = !!((flags >>> 26) & 0x01);
                tilingS              = !!((flags >>> 27) & 0x01) ? 2.0 : 1.0;
                tilingT              = !!((flags >>> 28) & 0x01) ? 2.0 : 1.0;
                isNoDrawParent       = !!((flags >>> 29) & 0x01);
                isNoDrawChild        = !!((flags >>> 30) & 0x01);
            } else {
                throw "whoops";
            }

            if (shapeType === ShapeType.DirectionCross || shapeType === ShapeType.RotationCross)
                planeType = PlaneType.X;

            const baseSizeX = view.getFloat32(tableIdx + 0x10);
            const baseSizeY = view.getFloat32(tableIdx + 0x14);
            const baseSize = vec2.fromValues(baseSizeX, baseSizeY);

            const blendModeFlags = view.getUint16(tableIdx + 0x18);
            const alphaCompareFlags = view.getUint8(tableIdx + 0x1A);
            const alphaRef0 = view.getUint8(tableIdx + 0x1B);
            const alphaRef1 = view.getUint8(tableIdx + 0x1C);
            const zModeFlags = view.getUint8(tableIdx + 0x1D);
            const texFlags = view.getUint8(tableIdx + 0x1E);
            const texIdxAnimCount = view.getUint8(tableIdx + 0x1F);
            const texIdx = view.getUint8(tableIdx + 0x20);
            const colorFlags = view.getUint8(tableIdx + 0x21);

            const colorPrm = colorNewFromRGBA8(view.getUint32(tableIdx + 0x26));
            const colorEnv = colorNewFromRGBA8(view.getUint32(tableIdx + 0x2A));

            const texCalcIdxType: CalcIdxType = (texFlags >>> 2) & 0x07;

            const anmRndm = view.getUint8(tableIdx + 0x2E);
            const colorLoopOfstMask = view.getUint8(tableIdx + 0x2F);
            const texIdxLoopOfstMask = view.getUint8(tableIdx + 0x30);

            let extraDataOffs = tableIdx + 0x34;

            let texInitTransX = 0;
            let texInitTransY = 0;
            let texInitScaleX = 0;
            let texInitScaleY = 0;
            let texInitRot = 0;
            let texIncTransX = 0;
            let texIncTransY = 0;
            let texIncScaleX = 0;
            let texIncScaleY = 0;
            let texIncRot = 0;

            if (isEnableTexScrollAnm) {
                texInitTransX = view.getFloat32(extraDataOffs + 0x00);
                texInitTransY = view.getFloat32(extraDataOffs + 0x04);
                texInitScaleX = view.getFloat32(extraDataOffs + 0x08);
                texInitScaleY = view.getFloat32(extraDataOffs + 0x0C);
                texInitRot = view.getFloat32(extraDataOffs + 0x10);
                texIncTransX = view.getFloat32(extraDataOffs + 0x14);
                texIncTransY = view.getFloat32(extraDataOffs + 0x18);
                texIncScaleX = view.getFloat32(extraDataOffs + 0x1C);
                texIncScaleY = view.getFloat32(extraDataOffs + 0x20);
                texIncRot = view.getFloat32(extraDataOffs + 0x24);
                extraDataOffs += 0x28;
            }

            let texIdxAnimData: Uint8Array | null = null;

            const isEnableTextureAnm = !!((texFlags >>> 0) & 0x01);
            if (isEnableTextureAnm)
                texIdxAnimData = buffer.createTypedArray(Uint8Array, extraDataOffs, texIdxAnimCount, Endianness.BIG_ENDIAN);

            const colorAnimMaxFrm = view.getUint16(tableIdx + 0x24);

            const isColorPrmAnm = !!((colorFlags >>> 1) & 0x01);
            const isColorEnvAnm = !!((colorFlags >>> 3) & 0x01);
            const colorCalcIdxType: CalcIdxType = (colorFlags >>> 4) & 0x07;

            let colorPrmAnimData: Color[] | null = null;
            if (isColorPrmAnm) {
                const colorPrmAnimDataOffs = tableIdx + view.getUint16(tableIdx + 0x0C);
                const colorPrmAnimDataCount = view.getUint8(tableIdx + 0x22);
                colorPrmAnimData = makeColorTable(buffer.slice(colorPrmAnimDataOffs), colorPrmAnimDataCount, colorAnimMaxFrm);
            }

            let colorEnvAnimData: Color[] | null = null;
            if (isColorEnvAnm) {
                const colorEnvAnimDataOffs = tableIdx + view.getUint16(tableIdx + 0x0E);
                const colorEnvAnimDataCount = view.getUint8(tableIdx + 0x23);
                colorEnvAnimData = makeColorTable(buffer.slice(colorEnvAnimDataOffs), colorEnvAnimDataCount, colorAnimMaxFrm);
            }

            const isEnableTexture = true;

            bsp1 = {
                shapeType, dirType, rotType, planeType, baseSize, tilingS, tilingT, isDrawFwdAhead, isDrawPrntAhead, isNoDrawParent, isNoDrawChild,
                colorInSelect, alphaInSelect, blendModeFlags, alphaCompareFlags, alphaRef0, alphaRef1, zModeFlags,
                anmRndm,
                isEnableTexture, isGlblTexAnm, texCalcIdxType, texIdx, texIdxAnimData, texIdxLoopOfstMask,
                isEnableTexScrollAnm, isEnableProjection, isEnableAnmTone,
                texInitTransX, texInitTransY, texInitScaleX, texInitScaleY, texInitRot,
                texIncTransX, texIncTransY, texIncScaleX, texIncScaleY, texIncRot,
                isGlblClrAnm, colorCalcIdxType, colorPrm, colorEnv, colorEnvAnimData, colorPrmAnimData, colorAnimMaxFrm, colorLoopOfstMask,
            };
        } else if (fourcc === 'ESP1') {
            // JPAExtraShape
            // Contains misc. extra particle draw settings.

            // JPAC2_11: Flags appear the same
            const flags = view.getUint32(tableIdx + 0x08);
            const isEnableScale   = !!((flags >>>  0) & 0x01);
            const isDiffXY        = !!((flags >>>  1) & 0x01);
            const scaleAnmTypeX   =    (flags >>>  8) & 0x03;
            const scaleAnmTypeY   =    (flags >>> 10) & 0x03;
            const pivotX          =    (flags >>> 12) & 0x03;
            const pivotY          =    (flags >>> 14) & 0x03;
            const isEnableAlpha   = !!((flags >>> 16) & 0x01);
            const isEnableSinWave = !!((flags >>> 17) & 0x01);
            const isEnableRotate  = !!((flags >>> 24) & 0x01);
            const alphaWaveType: CalcAlphaWaveType = isEnableSinWave ? CalcAlphaWaveType.NrmSin : CalcAlphaWaveType.None;
            // isEnableScaleBySpeedX was removed in JPA 2.0.
            const isEnableScaleBySpeedX = false;
            // isEnableScaleBySpeedY was removed in JPA 2.0.
            const isEnableScaleBySpeedY = false;

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
                scaleIncreaseRateY = (1.0 - scaleInValueY) / scaleInTiming;
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

            // Put in terms of JPA1 alpha wave parameters.
            const alphaWaveParam1 = alphaWaveFrequency;
            const alphaWaveParam2 = 0.0;
            const alphaWaveParam3 = alphaWaveAmplitude;

            const rotateAngle = view.getFloat32(tableIdx + 0x4C) * MathConstants.TAU / 0xFFFF;
            const rotateAngleRandom = view.getFloat32(tableIdx + 0x50) * MathConstants.TAU / 0xFFFF;
            const rotateSpeed = view.getFloat32(tableIdx + 0x54) * MathConstants.TAU / 0xFFFF;
            const rotateSpeedRandom = view.getFloat32(tableIdx + 0x58);
            const rotateDirection = view.getFloat32(tableIdx + 0x5C);

            esp1 = {
                isEnableScale, isDiffXY, scaleAnmTypeX, scaleAnmTypeY, isEnableScaleBySpeedX, isEnableScaleBySpeedY,
                isEnableAlpha, alphaWaveType, isEnableRotate, pivotX, pivotY,
                scaleInTiming, scaleOutTiming, scaleInValueX, scaleOutValueX, scaleInValueY, scaleOutValueY,
                scaleIncreaseRateX, scaleIncreaseRateY, scaleDecreaseRateX, scaleDecreaseRateY,
                scaleOutRandom, scaleAnmMaxFrameX, scaleAnmMaxFrameY,
                alphaInTiming, alphaOutTiming, alphaInValue, alphaBaseValue, alphaOutValue,
                alphaIncreaseRate, alphaDecreaseRate,
                alphaWaveParam1, alphaWaveParam2, alphaWaveParam3, alphaWaveRandom,
                rotateAngle, rotateAngleRandom, rotateSpeed, rotateSpeedRandom, rotateDirection,
            };
        } else if (fourcc === 'SSP1') {
            // JPAChildShape / JPASweepShape
            // Contains child particle draw settings.
            
            // JPAC2_11: Flags appear the same
            const flags = view.getUint32(tableIdx + 0x08);
            const shapeType: ShapeType =    (flags >>>  0) & 0x0F;
            const dirType: DirType     =    (flags >>>  4) & 0x07;
            const rotType: RotType     =    (flags >>>  7) & 0x07;
            let planeType: PlaneType   =    (flags >>> 10) & 0x01;
            const isInheritedScale     = !!((flags >>> 16) & 0x01);
            const isInheritedAlpha     = !!((flags >>> 17) & 0x01);
            const isInheritedRGB       = !!((flags >>> 18) & 0x01);
            const isEnableField        = !!((flags >>> 21) & 0x01);
            const isEnableScaleOut     = !!((flags >>> 22) & 0x01);
            const isEnableAlphaOut     = !!((flags >>> 23) & 0x01);
            const isEnableRotate       = !!((flags >>> 24) & 0x01);

            if (shapeType === ShapeType.DirectionCross || shapeType === ShapeType.RotationCross)
                planeType = PlaneType.X;

            const posRndm = view.getFloat32(tableIdx + 0x0C);
            const baseVel = view.getFloat32(tableIdx + 0x10);
            const baseVelRndm = view.getFloat32(tableIdx + 0x14);
            const velInfRate = view.getFloat32(tableIdx + 0x18);
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
            const rate = view.getUint16(tableIdx + 0x42);
            const step = view.getUint8(tableIdx + 0x44);
            const texIdx = view.getUint8(tableIdx + 0x45);
            const rotateSpeed = view.getUint16(tableIdx + 0x46) / 0xFFFF;

            ssp1 = {
                isEnableRotate, isEnableAlphaOut, isEnableScaleOut, isEnableField, isInheritedRGB, isInheritedAlpha, isInheritedScale,
                shapeType, dirType, rotType, planeType,
                posRndm, baseVel, baseVelRndm, velInfRate, gravity, globalScale2D,
                inheritScale, inheritAlpha, inheritRGB, colorPrm, colorEnv, timing,
                life, rate, step, texIdx, rotateSpeed,
            };
        } else if (fourcc === 'ETX1') {
            // JPAExTexShape
            // Contains extra texture draw settings.

            const flags = view.getUint32(tableIdx + 0x08);

            const p00 = view.getFloat32(tableIdx + 0x0C);
            const p01 = view.getFloat32(tableIdx + 0x10);
            const p02 = view.getFloat32(tableIdx + 0x14);
            const p10 = view.getFloat32(tableIdx + 0x18);
            const p11 = view.getFloat32(tableIdx + 0x1C);
            const p12 = view.getFloat32(tableIdx + 0x20);

            // JPAC2_11 adds extra (unknown) fields here.
            const offs = (version === JPACVersion.JPAC2_11) ? (0x4D - 0x24) : 0;

            const scale = Math.pow(2, view.getInt8(tableIdx + offs + 0x24));
            const indTextureMtx = new Float32Array([
                p00*scale, p01*scale, p02*scale, scale,
                p10*scale, p11*scale, p12*scale, 0.0,
            ]);

            const indTextureMode: IndTextureMode = ((flags >>> 0) & 0x01);
            // JPAC2_11: Code also checks to make sure offset 0x4C != 0
            const indTextureID = view.getUint8(tableIdx + offs + 0x25);
            const subTextureID = 0;
            const secondTextureIndex = (!!((flags >>> 8) & 0x01)) ? view.getUint8(tableIdx + offs + 0x26) : -1;

            etx1 = { indTextureMode, indTextureMtx, indTextureID, subTextureID, secondTextureIndex };
        } else if (fourcc === 'KFA1') {
            // JPAKeyBlock
            // Contains curve animations for various emitter parameters.

            const keyType: JPAKeyType = view.getUint8(tableIdx + 0x08);
            const keyCount = view.getUint8(tableIdx + 0x09);
            const isLoopEnable = !!view.getUint8(tableIdx + 0x0B);

            // The curves are four floats per key, in typical time/value/tangent in/tangent out order.
            const keyValues = buffer.createTypedArray(Float32Array, tableIdx + 0x0C, keyCount * 4, Endianness.BIG_ENDIAN);

            kfa1.push({ keyType, isLoopEnable, keyValues });
        } else if (fourcc === 'FLD1') {
            // JPAFieldBlock
            // Contains physics simulation fields that act on the particles.

            const flags = view.getUint32(tableIdx + 0x08);
            const type: FieldType       = (flags >>> 0) & 0x0F;
            const velType: FieldAddType = (flags >>> 8) & 0x03;
            const sttFlag               = (flags >>> 16);

            // maxDist does not exist in JPA2
            const maxDist = 0;
            const maxDistSq = maxDist ** 2.0;

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
            if (fadeIn > enTime)
                fadeInRate = 1 / (fadeIn - enTime);

            let fadeOutRate = 1;
            if (fadeOut < disTime)
                fadeOutRate = 1 / (disTime - fadeOut);

            // All of our parameters.
            let mag = 0;
            let magRndm = 0;
            let refDistance = -1;
            let innerSpeed = -1;
            let outerSpeed = -1;

            if (type === FieldType.Gravity || type === FieldType.Air || type === FieldType.Magnet || type === FieldType.Newton || type === FieldType.Random || type === FieldType.Drag || type === FieldType.Convection) {
                mag = param1;
            }

            // magRndm does not exist in JPA2
            magRndm = 0;

            if (type === FieldType.Newton) {
                refDistance = param3 ** 2.0;
            }

            if (type === FieldType.Vortex) {
                innerSpeed = param1;
                outerSpeed = param2;
            }

            if (type === FieldType.Air) {
                refDistance = param2;
            }

            if (type === FieldType.Convection) {
                refDistance = param3;
            }

            if (type === FieldType.Spin) {
                innerSpeed = param1;
            }

            fld1.push({ sttFlag, type, addType: velType, maxDistSq, pos, dir, mag, magRndm, refDistance, innerSpeed, outerSpeed, fadeIn, fadeOut, enTime, disTime, cycle, fadeInRate, fadeOutRate });
        } else if (fourcc === 'TDB1') {
            // Not a block. Stores a mapping of particle texture indexes
            // to JPAC texture indices -- I assume this is "Texture Database".
            tdb1 = buffer.subarray(tableIdx + 0x08).createTypedArray(Uint16Array, 0, tdb1Count, Endianness.BIG_ENDIAN);
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

function parseResource(version: JPACVersion, resRaw: JPAResourceRaw): JPAResource {
    if (version === JPACVersion.JEFFjpa1)
        return parseResource_JEFFjpa1(resRaw);
    else if (version === JPACVersion.JPAC1_00)
        return parseResource_JPAC1_00(resRaw);
    else if (version === JPACVersion.JPAC2_10 || version === JPACVersion.JPAC2_11)
        return parseResource_JPAC2(resRaw, version);
    else
        throw "whoops";
}

function parseJEFFjpa1(buffer: ArrayBufferSlice): JPAC {
    const view = buffer.createDataView();

    const version = readString(buffer, 0x00, 0x08) as JPACVersion;
    assert(version === JPACVersion.JEFFjpa1);

    // Fake a single effect.
    const effects: JPAResourceRaw[] = [];
    effects.push({ resourceId: 0, data: buffer, texIdBase: 0 });

    const textures: BTI[] = [];

    const blockCount = view.getUint32(0x0C);

    // Parse out textures.
    let effectTableIdx = 0x20;
    for (let j = 0; j < blockCount; j++) {
        const blockType = readString(buffer, effectTableIdx + 0x00, 0x04);
        const blockSize = view.getUint32(effectTableIdx + 0x04);

        if (blockType === 'TEX1') {
            const textureName = readString(buffer, effectTableIdx + 0x0C, 0x14, true);
            const texture = BTI.parse(buffer.slice(effectTableIdx + 0x20, effectTableIdx + blockSize), textureName);
            textures.push(texture);
        }

        // blockSize includes the header.
        effectTableIdx += blockSize;
    }

    return { version, effects, textures };
}

function parseJPAC1_00(buffer: ArrayBufferSlice): JPAC {
    const view = buffer.createDataView();

    const version = readString(buffer, 0x00, 0x08) as JPACVersion;
    assert(version === JPACVersion.JPAC1_00);

    const effectCount = view.getUint16(0x08);
    const textureCount = view.getUint16(0x0A);

    const effects: JPAResourceRaw[] = [];
    let effectTableIdx = 0x20;
    for (let i = 0; i < effectCount; i++) {
        const resourceBeginOffs = effectTableIdx;

        const blockCount = view.getUint32(effectTableIdx + 0x0C);
        const resourceId = view.getUint16(effectTableIdx + 0x18);

        effectTableIdx += 0x20;

        // Quickly skim through the blocks.
        for (let j = 0; j < blockCount; j++) {
            // blockSize includes the header.
            const blockSize = view.getUint32(effectTableIdx + 0x04);
            effectTableIdx += blockSize;
        }

        const data = buffer.slice(resourceBeginOffs, effectTableIdx);
        effects.push({ resourceId, data, texIdBase: 0 });
    }

    const textures: BTI[] = [];
    let textureTableIdx = effectTableIdx;
    for (let i = 0; i < textureCount; i++) {
        assert(readString(buffer, textureTableIdx + 0x00, 0x04, false) === 'TEX1');
        const blockSize = view.getUint32(textureTableIdx + 0x04);
        const textureName = readString(buffer, textureTableIdx + 0x0C, 0x14, true);
        const texture = BTI.parse(buffer.slice(textureTableIdx + 0x20, textureTableIdx + blockSize), textureName);
        textures.push(texture);
        textureTableIdx += blockSize;
    }

    return { version, effects, textures };
}

function parseJPAC2(buffer: ArrayBufferSlice): JPAC {
    const view = buffer.createDataView();

    const version = readString(buffer, 0x00, 0x08) as JPACVersion;
    assert(version === JPACVersion.JPAC2_10 || version === JPACVersion.JPAC2_11);

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
        effects.push({ resourceId, data, texIdBase: 0 });
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

    return { version, effects, textures };
}

export function parse(buffer: ArrayBufferSlice): JPAC {
    const version = readString(buffer, 0x00, 0x08) as JPACVersion;
    if (version === JPACVersion.JEFFjpa1)
        return parseJEFFjpa1(buffer);
    else if (version === JPACVersion.JPAC1_00)
        return parseJPAC1_00(buffer);
    else if (version === JPACVersion.JPAC2_10 || version === JPACVersion.JPAC2_11)
        return parseJPAC2(buffer);
    else
        throw "whoops";
}
//#endregion
