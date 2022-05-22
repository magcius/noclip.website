import { noclipSpaceFromPrimeSpace, primeSpaceFromNoclipSpace } from '../render';
import { BaseGenerator, defaultParticleGlobals, GetBool, GetFlags, GetModel, Light, NumberHolder, Particle, ParticleGlobals } from './base_generator';
import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from 'gl-matrix';
import { GetIntElement, IntElement } from './int_element';
import { GetRealElement, RealElement } from './real_element';
import { GetVectorElement, VectorElement } from './vector_element';
import { ColorElement, GetColorElement } from './color_element';
import { EmitterElement, GetEmitterElement } from './emitter_element';
import { constantUvElements, GetUVElement, UVElement, UVElementSet } from './uv_element';
import { GetModVectorElement, ModVectorElement } from './mod_vector_element';
import { CMDL } from '../cmdl';
import { GetSwooshGeneratorDesc, SwooshDescription, SwooshGenerator } from './swoosh_generator';
import { ElectricDescription, ElectricGenerator, GetElectricGeneratorDesc } from './electric_generator';
import { InputStream } from '../stream';
import { ResourceSystem } from '../resource';
import { assert, assertExists, nArray } from '../../util';
import { PART } from '../part';
import { AABB } from '../../Geometry';
import { getMatrixAxisZ, getMatrixTranslation, MathConstants, transformVec3Mat4w0, transformVec3Mat4w1, Vec3UnitZ, Vec3Zero } from '../../MathHelpers';
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from '../../gfx/platform/GfxPlatform';
import { ColorKind, DrawParams, GXMaterialHelperGfx, GXShapeHelperGfx, MaterialParams } from '../../gx/gx_render';
import { computeViewMatrix } from '../../Camera';
import { GfxRendererLayer, GfxRenderInst, makeSortKey } from '../../gfx/render/GfxRenderInstManager';
import { Color, colorCopy, colorEqual, colorFromRGBA, colorNewFromRGBA, colorScale, colorToRGBA8, OpaqueBlack, White } from '../../Color';
import { GXMaterialBuilder } from '../../gx/GXMaterialBuilder';
import { compileLoadedVertexLayout, GX_VtxDesc, LoadedVertexLayout } from '../../gx/gx_displaylist';
import { GX_Program, lightSetSpot } from '../../gx/gx_material';
import * as GX from '../../gx/gx_enum';
import { TextureMapping } from '../../TextureHolder';
import * as Viewer from '../../viewer';
import * as GX_Material from '../../gx/gx_material';
import { RetroSceneRenderer } from '../scenes';
import { SWHC } from '../swhc';
import { ELSC } from '../elsc';
import { Endianness, getSystemEndianness } from '../../endian';
import { GfxTopology, makeTriangleIndexBuffer } from '../../gfx/helpers/TopologyHelpers';
import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';

const scratchMat4a = mat4.create();
const scratchMat4b = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchAABBa = new AABB();
const scratchAABBb = new AABB();
const scratchDrawParams = new DrawParams();
const scratchMaterialParams = new MaterialParams();
const scratchModelMatrix = mat4.create();
const scratchViewMatrix = mat4.create();
const scratchModelViewMatrix = mat4.create();
const scratchViewDirection = vec3.create();
const scratchViewPoint = vec3.create();

export class SpawnSystemKeyframeInfo {
    public description: GenDescription | SwooshDescription | ElectricDescription | null;

    constructor(stream: InputStream, resourceSystem: ResourceSystem) {
        const partId = stream.readAssetID();
        const partFourCC = stream.readFourCC();
        if (partFourCC === 'PART' || partFourCC == '\x00\x00\x00\x00') {
            this.description = assertExists(resourceSystem.loadAssetByID<PART>(partId, 'PART')).description;
        } else if (partFourCC === 'SWHC') {
            this.description = assertExists(resourceSystem.loadAssetByID<SWHC>(partId, 'SWHC')).description;
        } else if (partFourCC === 'ELSC') {
            this.description = assertExists(resourceSystem.loadAssetByID<ELSC>(partId, 'ELSC')).description;
        } else if (partFourCC === 'SPSC') {
            // TODO: SPSC
        } else {
            throw `Unexpected particle FourCC ${partFourCC}`;
        }
        stream.readUint32();
        stream.readUint32();
    }
}

export class SpawnSystemKeyframeSpawn {
    public frame: number;
    public infos: SpawnSystemKeyframeInfo[];

    constructor(stream: InputStream, resourceSystem: ResourceSystem) {
        this.frame = stream.readUint32();

        const count = stream.readUint32();
        this.infos = new Array(count);
        for (let i = 0; i < count; ++i) {
            this.infos[i] = new SpawnSystemKeyframeInfo(stream, resourceSystem);
        }
    }
}

export class SpawnSystemKeyframeData {
    public endFrame: number;
    public spawns: SpawnSystemKeyframeSpawn[];

    constructor(stream: InputStream, resourceSystem: ResourceSystem) {
        stream.readUint32();
        stream.readUint32();
        this.endFrame = stream.readUint32();
        stream.readUint32();

        const count = stream.readUint32();
        this.spawns = new Array(count);
        for (let i = 0; i < count; ++i) {
            this.spawns[i] = new SpawnSystemKeyframeSpawn(stream, resourceSystem);
        }
    }

    public GetSpawnedSystemsAtFrame(frame: number): SpawnSystemKeyframeInfo[] {
        if (frame >= this.endFrame)
            return [];
        for (let i = 0; i < this.spawns.length; ++i) {
            const spawn = this.spawns[i];
            if (spawn.frame === frame)
                return spawn.infos;
        }
        return [];
    }
}

export class GenDescription {
    public PSLT: IntElement | null = null;
    public PSWT: IntElement | null = null;
    public PSTS: RealElement | null = null;
    public POFS: VectorElement | null = null;
    public SEED: IntElement | null = null;
    public LENG: RealElement | null = null;
    public WIDT: RealElement | null = null;
    public MAXP: IntElement | null = null;
    public GRTE: RealElement | null = null;
    public COLR: ColorElement | null = null;
    public LTME: IntElement | null = null;
    public EMTR: EmitterElement | null = null;
    public SORT: boolean = false;
    public MBLR: boolean = false;
    public LINE: boolean = false;
    public LIT_: boolean = false;
    public AAPH: boolean = false;
    public ZBUF: boolean = false;
    public FXLL: boolean = false;
    public PMAB: boolean = false;
    public VMD4: boolean = false;
    public VMD3: boolean = false;
    public VMD2: boolean = false;
    public VMD1: boolean = false;
    public VMPC: boolean = false; // MP2
    public OPTS: boolean = false;
    public PMUS: boolean = false;
    public PMOO: boolean = true;
    public CIND: boolean = false;
    public INDM: boolean = false; // MP2
    public ORNT: boolean = false;
    public RSOP: boolean = false;
    public RDOP: boolean = false; // MP2
    public XTAD: IntElement | null = null; // MP2
    public MBSP: IntElement | null = null;
    public SIZE: RealElement | null = null;
    public ROTA: RealElement | null = null;
    public TEXR: UVElement | null = null;
    public TIND: UVElement | null = null;
    public PMDL: CMDL | null = null;
    public PMOP: VectorElement | null = null;
    public PMRT: VectorElement | null = null;
    public PMSC: VectorElement | null = null;
    public PMCL: ColorElement | null = null;
    public PMOV: VectorElement | null = null; // MP2
    public VEL1: ModVectorElement | null = null;
    public VEL2: ModVectorElement | null = null;
    public VEL3: ModVectorElement | null = null;
    public VEL4: ModVectorElement | null = null;
    public ICTS: GenDescription | null = null;
    public NCSY: IntElement | null = null;
    public CSSD: IntElement | null = null;
    public IDTS: GenDescription | null = null;
    public NDSY: IntElement | null = null;
    public IITS: GenDescription | null = null;
    public PISY: IntElement | null = null;
    public SISY: IntElement | null = null;
    public KSSM: SpawnSystemKeyframeData | null = null;
    public SSWH: SwooshDescription | null = null;
    public SSSD: IntElement | null = null;
    public SSPO: VectorElement | null = null;
    public SELC: ElectricDescription | null = null;
    public SESD: IntElement | null = null;
    public SEPO: VectorElement | null = null;
    public LTYP: IntElement | null = null;
    public LCLR: ColorElement | null = null;
    public LINT: RealElement | null = null;
    public LOFF: VectorElement | null = null;
    public LDIR: VectorElement | null = null;
    public LFOT: IntElement | null = null;
    public LFOR: RealElement | null = null;
    public LSLA: RealElement | null = null;
    public ADV1: RealElement | null = null;
    public ADV2: RealElement | null = null;
    public ADV3: RealElement | null = null;
    public ADV4: RealElement | null = null;
    public ADV5: RealElement | null = null;
    public ADV6: RealElement | null = null;
    public ADV7: RealElement | null = null;
    public ADV8: RealElement | null = null;

    constructor(stream: InputStream, resourceSystem: ResourceSystem) {
        while (true) {
            const field = stream.readFourCC();
            if (field === '_END')
                break;
            switch (field) {
            case 'PMCL':
                this.PMCL = GetColorElement(stream);
                break;
            case 'PMOV':
                this.PMOV = GetVectorElement(stream);
                break;
            case 'LFOR':
                this.LFOR = GetRealElement(stream);
                break;
            case 'IDTS':
                this.IDTS = GetChildGeneratorDesc(stream, resourceSystem);
                break;
            case 'EMTR':
                this.EMTR = GetEmitterElement(stream);
                break;
            case 'COLR':
                this.COLR = GetColorElement(stream);
                break;
            case 'CIND':
                this.CIND = GetBool(stream);
                break;
            case 'INDM':
                this.INDM = GetBool(stream);
                break;
            case 'AAPH':
                this.AAPH = GetBool(stream);
                break;
            case 'CSSD':
                this.CSSD = GetIntElement(stream);
                break;
            case 'GRTE':
                this.GRTE = GetRealElement(stream);
                break;
            case 'FXLL':
                this.FXLL = GetBool(stream);
                break;
            case 'ICTS':
                this.ICTS = GetChildGeneratorDesc(stream, resourceSystem);
                break;
            case 'KSSM': {
                this.KSSM = null;
                const cid = stream.readFourCC();
                if (cid !== 'CNST')
                    break;
                this.KSSM = new SpawnSystemKeyframeData(stream, resourceSystem);
                break;
            }
            case 'ILOC':
                GetVectorElement(stream);
                break;
            case 'IITS':
                this.IITS = GetChildGeneratorDesc(stream, resourceSystem);
                break;
            case 'IVEC':
                GetVectorElement(stream);
                break;
            case 'LDIR':
                this.LDIR = GetVectorElement(stream);
                break;
            case 'LCLR':
                this.LCLR = GetColorElement(stream);
                break;
            case 'LENG':
                this.LENG = GetRealElement(stream);
                break;
            case 'MAXP':
                this.MAXP = GetIntElement(stream);
                break;
            case 'LOFF':
                this.LOFF = GetVectorElement(stream);
                break;
            case 'LINT':
                this.LINT = GetRealElement(stream);
                break;
            case 'LINE':
                this.LINE = GetBool(stream);
                break;
            case 'LFOT':
                this.LFOT = GetIntElement(stream);
                break;
            case 'LIT_':
                this.LIT_ = GetBool(stream);
                break;
            case 'LTME':
                this.LTME = GetIntElement(stream);
                break;
            case 'LSLA':
                this.LSLA = GetRealElement(stream);
                break;
            case 'LTYP':
                this.LTYP = GetIntElement(stream);
                break;
            case 'NDSY':
                this.NDSY = GetIntElement(stream);
                break;
            case 'MBSP':
                this.MBSP = GetIntElement(stream);
                break;
            case 'XTAD':
                this.XTAD = GetIntElement(stream);
                break;
            case 'MBLR':
                this.MBLR = GetBool(stream);
                break;
            case 'NCSY':
                this.NCSY = GetIntElement(stream);
                break;
            case 'PISY':
                this.PISY = GetIntElement(stream);
                break;
            case 'OPTS':
                this.OPTS = GetBool(stream);
                break;
            case 'PMAB':
                this.PMAB = GetBool(stream);
                break;
            case 'SESD':
                this.SESD = GetIntElement(stream);
                break;
            case 'SEPO':
                this.SEPO = GetVectorElement(stream);
                break;
            case 'PSLT':
                this.PSLT = GetIntElement(stream);
                break;
            case 'PMSC':
                this.PMSC = GetVectorElement(stream);
                break;
            case 'PMOP':
                this.PMOP = GetVectorElement(stream);
                break;
            case 'PMDL':
                this.PMDL = GetModel(stream, resourceSystem);
                break;
            case 'PMRT':
                this.PMRT = GetVectorElement(stream);
                break;
            case 'POFS':
                this.POFS = GetVectorElement(stream);
                break;
            case 'PMUS':
                this.PMUS = GetBool(stream);
                break;
            case 'PSIV':
                GetVectorElement(stream);
                break;
            case 'ROTA':
                this.ROTA = GetRealElement(stream);
                break;
            case 'PSVM':
                GetModVectorElement(stream);
                break;
            case 'PSTS':
                this.PSTS = GetRealElement(stream);
                break;
            case 'PSOV':
                GetVectorElement(stream);
                break;
            case 'PSWT':
                this.PSWT = GetIntElement(stream);
                break;
            case 'SEED':
                this.SEED = GetIntElement(stream);
                break;
            case 'PMOO':
                this.PMOO = GetBool(stream);
                break;
            case 'SSSD':
                this.SSSD = GetIntElement(stream);
                break;
            case 'SORT':
                this.SORT = GetBool(stream);
                break;
            case 'SIZE':
                this.SIZE = GetRealElement(stream);
                break;
            case 'SISY':
                this.SISY = GetIntElement(stream);
                break;
            case 'SSPO':
                this.SSPO = GetVectorElement(stream);
                break;
            case 'TEXR': {
                const uvElement = GetUVElement(stream, resourceSystem);
                if (uvElement?.GetValueTexture(0, defaultParticleGlobals))
                    this.TEXR = uvElement;
                break;
            }
            case 'SSWH':
                this.SSWH = GetSwooshGeneratorDesc(stream, resourceSystem);
                break;
            case 'TIND': {
                const uvElement = GetUVElement(stream, resourceSystem);
                if (uvElement?.GetValueTexture(0, defaultParticleGlobals))
                    this.TIND = uvElement;
                break;
            }
            case 'VMD4':
                this.VMD4 = GetBool(stream);
                break;
            case 'VMD3':
                this.VMD3 = GetBool(stream);
                break;
            case 'VMD2':
                this.VMD2 = GetBool(stream);
                break;
            case 'VMD1':
                this.VMD1 = GetBool(stream);
                break;
            case 'VMPC':
                this.VMPC = GetBool(stream);
                break;
            case 'VEL4':
                this.VEL4 = GetModVectorElement(stream);
                break;
            case 'VEL3':
                this.VEL3 = GetModVectorElement(stream);
                break;
            case 'VEL2':
                this.VEL2 = GetModVectorElement(stream);
                break;
            case 'VEL1':
                this.VEL1 = GetModVectorElement(stream);
                break;
            case 'ZBUF':
                this.ZBUF = GetBool(stream);
                break;
            case 'WIDT':
                this.WIDT = GetRealElement(stream);
                break;
            case 'ORNT':
                this.ORNT = GetBool(stream);
                break;
            case 'RSOP':
                this.RSOP = GetBool(stream);
                break;
            case 'RDOP':
                this.RSOP = GetBool(stream);
                break;
            case 'ADV1':
                this.ADV1 = GetRealElement(stream);
                break;
            case 'ADV2':
                this.ADV2 = GetRealElement(stream);
                break;
            case 'ADV3':
                this.ADV3 = GetRealElement(stream);
                break;
            case 'ADV4':
                this.ADV4 = GetRealElement(stream);
                break;
            case 'ADV5':
                this.ADV5 = GetRealElement(stream);
                break;
            case 'ADV6':
                this.ADV6 = GetRealElement(stream);
                break;
            case 'ADV7':
                this.ADV7 = GetRealElement(stream);
                break;
            case 'ADV8':
                this.ADV8 = GetRealElement(stream);
                break;
            case 'SELC':
                this.SELC = GetElectricGeneratorDesc(stream, resourceSystem);
                break;
            case 'VAV1':
                GetVectorElement(stream);
                break;
            case 'FXBO':
                GetVectorElement(stream);
                break;
            case 'FXBR':
                GetRealElement(stream);
                break;
            case 'DFLG':
                GetFlags(stream);
                break;
            default:
                throw `unrecognized parameter ${field}`;
            }
        }
    }
}

export function GetChildGeneratorDesc(stream: InputStream, resourceSystem: ResourceSystem): GenDescription | null {
    const type = stream.readFourCC();
    if (type === 'NONE')
        return null;
    const partId = stream.readAssetID();
    const part = resourceSystem.loadAssetByID<PART>(partId, 'PART');
    if (!part)
        return null;
    return part.description;
}

export const enum ModelOrientationType {
    Normal,
    One
}

export const enum LightType {
    None,
    Custom,
    Directional,
    Spot,
}

export const enum FalloffType {
    Constant,
    Linear,
    Quadratic
}

//let g_ParticleAliveCount: number = 0;
//const MAX_PARTICLE_COUNT: number = 2560;

export class ElementGenerator extends BaseGenerator {
    particles: Particle[] = [];
    parentMatrices: mat4[] = [];
    advValues: NumberHolder[] = [];

    internalStartFrame: number = 0;
    curFrame: number = 0;
    curSeconds: number = 0;
    timeDeltaScale: number = 0;
    prevFrame: number = -1;
    particleEmission: boolean = true;
    generatorRemainder: number = 0;
    MAXP: NumberHolder = { value: 0 };
    // TODO: Implement seeded random
    randomSeed: NumberHolder = { value: 0 };
    generatorRate: number = 1;
    externalVars: number[] = nArray(16, () => 0.0);

    translation: vec3 = vec3.create();
    globalTranslation: vec3 = vec3.create();
    POFS: vec3 = vec3.create();
    globalScale: vec3 = vec3.fromValues(1.0, 1.0, 1.0);
    globalScaleTransform: mat4 = mat4.create();
    globalScaleTransformInverse: mat4 = mat4.create();
    localScale: vec3 = vec3.fromValues(1.0, 1.0, 1.0);
    localScaleTransform: mat4 = mat4.create();
    localScaleTransformInverse: mat4 = mat4.create();
    orientation: mat4 = mat4.create();
    orientationInverse: mat4 = mat4.create();
    globalOrientation: mat4 = mat4.create();

    activeParticleCount: number = 0;
    cumulativeParticleCount: number = 0;
    recursiveParticleCount: number = 0;
    PSLT: NumberHolder = { value: 0 };
    translationDirty: boolean = false;
    LIT_: boolean = false;
    AAPH: boolean = false;
    ZBUF: boolean = false;
    ZTest: boolean = false;
    ORNT: boolean = false;
    MBLR: boolean = false;
    LINE: boolean = false;
    FXLL: boolean = false;
    warmedUp: boolean = false;
    modelsUseLights: boolean = false;
    enableADV: boolean = false;
    MBSP: NumberHolder = { value: 0 };
    backupLightsActive: number = 0;
    hasVMD: boolean[] = nArray(4, () => false);
    // TODO: Implement seeded random
    //randState: Random16 = new Random16();
    VELSources: (ModVectorElement|null)[] = nArray(4, () => null);

    activeChildren: BaseGenerator[] = [];
    CSSD: NumberHolder = { value: 0 };
    SISY: NumberHolder = { value: 16 };
    PISY: NumberHolder = { value: 16 };
    SSSD: NumberHolder = { value: 0 };
    SSPO: vec3 = vec3.create();
    SESD: NumberHolder = { value: 0 };
    SEPO: vec3 = vec3.create();
    localAABB: AABB = new AABB();
    maxSize: number = 0;
    globalAABB: AABB = new AABB();
    lightType: NumberHolder = { value: LightType.None };
    LCLR: Color = colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);
    LINT: NumberHolder = { value: 1 };
    LOFF: vec3 = vec3.create();
    LDIR: vec3 = vec3.fromValues(1.0, 0.0, 0.0);
    falloffType: NumberHolder = { value: FalloffType.Linear };
    LFOR: NumberHolder = { value: 1 };
    LSLA: NumberHolder = { value: 45 };
    moduColor: Color = colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);

    material: GXMaterialHelperGfx;
    materialPmus: GXMaterialHelperGfx;
    textureMapping: TextureMapping = new TextureMapping();
    shapeHelper: ElementGeneratorShapeHelper;

    constructor(private genDesc: GenDescription, private orientationType: ModelOrientationType,
                private enableOPTS: boolean, private renderer: RetroSceneRenderer) {
        super();

        // TODO: Seeded random
        if (genDesc.SEED)
            genDesc.SEED.GetValue(this.curFrame, defaultParticleGlobals, this.randomSeed);

        this.LIT_ = genDesc.LIT_;
        this.AAPH = genDesc.AAPH;
        this.ZBUF = genDesc.ZBUF;
        this.ZTest = true;
        this.ORNT = genDesc.ORNT;
        this.MBLR = genDesc.ORNT ? false : genDesc.MBLR;

        if (genDesc.MBSP)
            genDesc.MBSP.GetValue(this.curFrame, defaultParticleGlobals, this.MBSP);

        let velIdx = 0;
        if (genDesc.VEL1) {
            this.VELSources[velIdx] = genDesc.VEL1;
            this.hasVMD[velIdx++] = genDesc.VMD1;
        }
        if (genDesc.VEL2) {
            this.VELSources[velIdx] = genDesc.VEL2;
            this.hasVMD[velIdx++] = genDesc.VMD2;
        }
        if (genDesc.VEL3) {
            this.VELSources[velIdx] = genDesc.VEL3;
            this.hasVMD[velIdx++] = genDesc.VMD3;
        }
        if (genDesc.VEL4) {
            this.VELSources[velIdx] = genDesc.VEL4;
            this.hasVMD[velIdx++] = genDesc.VMD4;
        }

        if (genDesc.ADV1 || genDesc.ADV2 || genDesc.ADV3 || genDesc.ADV4 ||
            genDesc.ADV5 || genDesc.ADV6 || genDesc.ADV7 || genDesc.ADV8)
            this.enableADV = true;

        if (genDesc.CSSD)
            genDesc.CSSD.GetValue(0, defaultParticleGlobals, this.CSSD);

        if (genDesc.PISY) {
            genDesc.PISY.GetValue(0, defaultParticleGlobals, this.PISY);
            if (this.PISY.value <= 0)
                this.PISY.value = 1;
        }

        if (genDesc.SISY)
            genDesc.SISY.GetValue(0, defaultParticleGlobals, this.SISY);

        if (genDesc.SSSD)
            genDesc.SSSD.GetValue(0, defaultParticleGlobals, this.SSSD);

        if (genDesc.SSPO) {
            genDesc.SSPO.GetValue(0, defaultParticleGlobals, this.SSPO);
            if (!genDesc.SSPO.IsFastConstant())
                this.translationDirty = true;
        }

        if (genDesc.SESD)
            genDesc.SESD.GetValue(0, defaultParticleGlobals, this.SESD);

        if (genDesc.SEPO) {
            genDesc.SEPO.GetValue(0, defaultParticleGlobals, this.SEPO);
            if (!genDesc.SEPO.IsFastConstant())
                this.translationDirty = true;
        }

        if (genDesc.POFS) {
            genDesc.POFS.GetValue(0, defaultParticleGlobals, this.POFS);
            if (!genDesc.POFS.IsFastConstant())
                this.translationDirty = true;
        }

        if (genDesc.PSLT)
            genDesc.PSLT.GetValue(0, defaultParticleGlobals, this.PSLT);
        else
            this.PSLT.value = 0x7fffffff;

        if (genDesc.MAXP)
            genDesc.MAXP.GetValue(0, defaultParticleGlobals, this.MAXP);

        const maxCount = Math.min(256, this.MAXP.value);
        this.particles = nArray(maxCount, () => new Particle());
        if (this.enableADV)
            this.advValues = nArray(maxCount * 8, () => { return { value: 0 }; });
        if (this.orientationType === ModelOrientationType.One)
            this.parentMatrices = nArray(this.MAXP.value, () => mat4.create());

        this.LINE = genDesc.LINE;
        this.FXLL = genDesc.FXLL;

        if (genDesc.LTYP)
            genDesc.LTYP.GetValue(this.curFrame, defaultParticleGlobals, this.lightType);

        if (genDesc.LFOT)
            genDesc.LFOT.GetValue(this.curFrame, defaultParticleGlobals, this.falloffType);

        this.material = renderer.generatorMaterialHelpers.elementHelper.getMaterial(this.genDesc.TEXR !== null, this.ZTest, this.ZBUF && !this.AAPH, this.AAPH);
        this.materialPmus = renderer.generatorMaterialHelpers.elementHelper.getMaterial(this.genDesc.TEXR !== null, true, this.ZBUF && !this.genDesc.PMAB, this.genDesc.PMAB);

        if (this.genDesc.TEXR) {
            const texr = this.genDesc.TEXR.GetValueTexture(0, defaultParticleGlobals)!;
            renderer.textureHolder.addTextures(renderer.device, [texr]);
            renderer.textureHolder.fillTextureMapping(this.textureMapping, texr.name);
            this.textureMapping.gfxSampler = renderer.renderCache.createSampler({
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Linear,
                minLOD: 0,
                maxLOD: 100,
                wrapS: GfxWrapMode.Repeat,
                wrapT: GfxWrapMode.Repeat,
            });
            this.shapeHelper = ElementGeneratorShapeHelper.createTex(renderer, 256);
        } else {
            this.shapeHelper = ElementGeneratorShapeHelper.createNoTex(renderer, 256);
        }
    }

    private GetParticleCountAllInternal(): number {
        let ret = this.activeParticleCount;
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            if (child instanceof ElementGenerator)
                ret += child.GetParticleCountAll();
        }
        return ret;
    }

    public GetParticleCountAll(): number {
        return this.recursiveParticleCount;
    }

    public GetCumulativeParticleCount(): number {
        return this.cumulativeParticleCount;
    }

    public GetParticleCount(): number {
        return this.activeParticleCount;
    }

    public GetEmitterTime(): number {
        return this.curFrame;
    }

    public GetExternalVar(index: number): number {
        return this.externalVars[index];
    }

    public GetOrientation(): mat4 {
        return this.orientation;
    }

    public GetTranslation(): vec3 {
        return this.translation;
    }

    private AccumulateBounds(pos: vec3, size: number): void {
        this.localAABB.unionPoint(pos);
        this.maxSize = Math.max(this.maxSize, size);
    }

    private UpdateAdvanceAccessParameters(activeParticleCount: number, particleFrame: number, globals: ParticleGlobals): void {
        const advCount = this.advValues.length / 8;
        if (activeParticleCount >= advCount) {
            throw `activeParticleCount(${activeParticleCount}) >= advValues size (${advCount})`;
        }

        globals.particleAccessParameters = this.advValues;
        globals.particleAccessParametersGroup = activeParticleCount;

        if (this.genDesc.ADV1) {
            this.genDesc.ADV1.GetValue(particleFrame, globals, this.advValues[activeParticleCount * 8]);
        }
        if (this.genDesc.ADV2) {
            this.genDesc.ADV2.GetValue(particleFrame, globals, this.advValues[activeParticleCount * 8 + 1]);
        }
        if (this.genDesc.ADV3) {
            this.genDesc.ADV3.GetValue(particleFrame, globals, this.advValues[activeParticleCount * 8 + 2]);
        }
        if (this.genDesc.ADV4) {
            this.genDesc.ADV4.GetValue(particleFrame, globals, this.advValues[activeParticleCount * 8 + 3]);
        }
        if (this.genDesc.ADV5) {
            this.genDesc.ADV5.GetValue(particleFrame, globals, this.advValues[activeParticleCount * 8 + 4]);
        }
        if (this.genDesc.ADV6) {
            this.genDesc.ADV6.GetValue(particleFrame, globals, this.advValues[activeParticleCount * 8 + 5]);
        }
        if (this.genDesc.ADV7) {
            this.genDesc.ADV7.GetValue(particleFrame, globals, this.advValues[activeParticleCount * 8 + 6]);
        }
        if (this.genDesc.ADV8) {
            this.genDesc.ADV8.GetValue(particleFrame, globals, this.advValues[activeParticleCount * 8 + 7]);
        }
    }

    private CreateNewParticles(count: number, globals: ParticleGlobals): void {
        if (this.particles.length >= this.MAXP.value) {
            return;
        }

        if (count + this.particles.length > this.MAXP.value) {
            count = this.MAXP.value - this.particles.length;
        }

        //if (g_ParticleAliveCount + count > MAX_PARTICLE_COUNT) {
        //    count = MAX_PARTICLE_COUNT - g_ParticleAliveCount;
        //}

        // TODO: Random seeding

        if (this.enableADV && this.advValues.length / 8 < count + this.particles.length) {
            const numAdditional = (count + this.particles.length) * 8 - this.advValues.length;
            this.advValues = this.advValues.concat(nArray(numAdditional, () => { return { value: 0 }; }));
        }

        for (let i = 0; i < count; ++i) {
            const particle = new Particle();
            this.particles.push(particle);
            //++g_ParticleAliveCount;
            const particleIndex = this.particles.length - 1;
            ++this.activeParticleCount;
            ++this.cumulativeParticleCount;
            if (this.orientationType === ModelOrientationType.One) {
                mat4.copy(this.parentMatrices[particleIndex], this.orientation);
            }

            particle.startFrame = this.curFrame;
            if (this.genDesc.LTME) {
                this.genDesc.LTME.GetValue(0, globals, particle.endFrame);
            }
            globals.particleLifetime = particle.endFrame.value;
            globals.UpdateParticleLifetimeTweenValues(0);
            globals.currentParticle = particle;
            if (this.enableADV) {
                this.UpdateAdvanceAccessParameters(particleIndex, 0, globals);
            }
            particle.endFrame.value += this.curFrame;

            if (this.genDesc.COLR) {
                this.genDesc.COLR.GetValue(0, globals, particle.color);
            } else {
                colorFromRGBA(particle.color, 1.0, 1.0, 1.0, 1.0);
            }

            if (this.genDesc.EMTR) {
                this.genDesc.EMTR.GetValue(this.curFrame, globals, particle.pos, particle.vel);
                transformVec3Mat4w1(scratchVec3a, mat4.mul(scratchMat4a, this.globalScaleTransformInverse, this.localScaleTransformInverse), this.translation);
                transformVec3Mat4w0(scratchVec3b, this.orientation, particle.pos);
                vec3.add(particle.pos, vec3.add(scratchVec3a, scratchVec3a, scratchVec3b), this.POFS);
                transformVec3Mat4w0(particle.vel, this.orientation, particle.vel);
            } else {
                transformVec3Mat4w1(scratchVec3a, mat4.mul(scratchMat4a, this.globalScaleTransformInverse, this.localScaleTransformInverse), this.translation);
                vec3.add(particle.pos, scratchVec3a, this.POFS);
                vec3.zero(particle.vel);
            }
            vec3.copy(particle.prevPos, particle.pos);

            if (this.LINE) {
                if (this.genDesc.LENG) {
                    this.genDesc.LENG.GetValue(0, globals, particle.lineLengthOrSize);
                } else {
                    particle.lineLengthOrSize.value = 1.0;
                }
                if (this.genDesc.WIDT) {
                    this.genDesc.WIDT.GetValue(0, globals, particle.lineWidthOrRota);
                } else {
                    particle.lineWidthOrRota.value = 1.0;
                }
            } else {
                if (this.genDesc.ROTA) {
                    this.genDesc.ROTA.GetValue(0, globals, particle.lineWidthOrRota);
                } else {
                    particle.lineWidthOrRota.value = 0.0;
                }
                if (this.genDesc.SIZE) {
                    this.genDesc.SIZE.GetValue(0, globals, particle.lineLengthOrSize);
                } else {
                    particle.lineLengthOrSize.value = 0.1;
                }
            }

            this.AccumulateBounds(particle.pos, particle.lineLengthOrSize.value);
        }
    }

    private UpdateVelocitySource(idx: number, particleFrame: number, particle: Particle, globals: ParticleGlobals): boolean {
        let err: boolean;
        if (this.hasVMD[idx]) {
            const localVel = scratchVec3a;
            const localPos = scratchVec3b;
            transformVec3Mat4w0(localVel, this.orientationInverse, particle.vel);
            transformVec3Mat4w0(localPos, this.orientationInverse, vec3.sub(localPos, particle.pos, this.translation));
            err = this.VELSources[idx]!.GetValue(particleFrame, globals, localVel, localPos);
            transformVec3Mat4w0(particle.vel, this.orientation, localVel);
            transformVec3Mat4w0(localPos, this.orientation, localPos);
            vec3.add(particle.pos, localPos, this.translation);
        } else {
            err = this.VELSources[idx]!.GetValue(particleFrame, globals, particle.vel, particle.pos);
        }

        if (err) {
            particle.endFrame.value = -1;
            return true;
        }

        return false;
    }

    private UpdateExistingParticles(globals: ParticleGlobals): void {
        this.activeParticleCount = 0;
        globals.emitterTime = this.curFrame;
        globals.particleAccessParameters = null;

        for (let i = 0; i < this.particles.length;) {
            let particle = this.particles[i];

            if (particle.endFrame.value < this.curFrame) {
                //--g_ParticleAliveCount;
                if (i + 1 == this.particles.length) {
                    this.particles.pop();
                    break;
                } else {
                    this.particles[i] = this.particles[this.particles.length - 1];
                    if (this.orientationType === ModelOrientationType.One)
                        mat4.copy(this.parentMatrices[this.activeParticleCount], this.parentMatrices[this.particles.length - 1]);
                    if (this.enableADV) {
                        for (let j = 0; j < 8; ++j) {
                            this.advValues[this.activeParticleCount * 8 + j] = this.advValues[(this.particles.length - 1) * 8 + j];
                        }
                    }
                    this.particles.pop();
                    if (particle.endFrame.value < this.curFrame)
                        continue;
                }
            }

            vec3.copy(particle.prevPos, particle.pos);
            vec3.add(particle.pos, particle.pos, particle.vel);

            globals.currentParticle = particle;

            globals.particleLifetime = particle.endFrame.value - particle.startFrame;
            const particleFrame = this.curFrame - particle.startFrame;
            globals.UpdateParticleLifetimeTweenValues(particleFrame);

            if (this.enableADV) {
                this.UpdateAdvanceAccessParameters(this.activeParticleCount, particleFrame, globals);
            }

            ++this.activeParticleCount;

            for (let j = 0; j < this.VELSources.length; ++j) {
                if (!this.VELSources[j])
                    break;
                this.UpdateVelocitySource(j, particleFrame, particle, globals);
            }

            if (this.LINE) {
                if (this.genDesc.LENG) {
                    this.genDesc.LENG.GetValue(particleFrame, globals, particle.lineLengthOrSize);
                }
                if (this.genDesc.WIDT) {
                    this.genDesc.WIDT.GetValue(particleFrame, globals, particle.lineWidthOrRota);
                }
            } else {
                if (this.genDesc.ROTA) {
                    this.genDesc.ROTA.GetValue(particleFrame, globals, particle.lineWidthOrRota);
                }
                if (this.genDesc.SIZE) {
                    this.genDesc.SIZE.GetValue(particleFrame, globals, particle.lineLengthOrSize);
                }
            }

            if (this.genDesc.COLR) {
                this.genDesc.COLR.GetValue(particleFrame, globals, particle.color);
            }

            this.AccumulateBounds(particle.pos, particle.lineLengthOrSize.value);
            ++i;
        }

        if (this.particles.length) {
            for (let i = 0; i < this.modifierList.length; ++i) {
                const warp = this.modifierList[i];
                if (warp.UpdateWarp())
                    warp.ModifyParticles(this.particles);
            }
        }
    }

    private ConstructChildParticleSystem(desc: GenDescription): ElementGenerator {
        const gen = new ElementGenerator(desc, ModelOrientationType.Normal, this.enableOPTS, this.renderer);
        gen.modelsUseLights = this.modelsUseLights;
        gen.SetGlobalTranslation(this.globalTranslation);
        gen.SetGlobalOrientation(this.globalOrientation);
        gen.SetGlobalScale(this.globalScale);
        gen.SetLocalScale(this.localScale);
        gen.SetTranslation(this.translation);
        gen.SetOrientation(this.orientation);
        gen.SetParticleEmission(this.particleEmission);
        gen.SetModulationColor(this.moduColor);
        return gen;
    }

    private UpdateChildParticleSystems(device: GfxDevice, dt: number, globals: ParticleGlobals): void {
        // TODO: Random seeding

        if (this.genDesc.ICTS && this.prevFrame !== this.curFrame && this.CSSD.value === this.curFrame) {
            const ncsyVal = { value: 1 };
            if (this.genDesc.NCSY) {
                this.genDesc.NCSY.GetValue(this.curFrame, globals, ncsyVal);
            }

            if (!(this.enableOPTS && this.genDesc.ICTS.OPTS)) {
                for (let i = 0; i < ncsyVal.value; ++i) {
                    this.activeChildren.push(this.ConstructChildParticleSystem(this.genDesc.ICTS));
                }
            }
        }

        if (this.genDesc.IITS && this.prevFrame !== this.curFrame && this.curFrame < this.PSLT.value && this.particleEmission &&
            this.curFrame >= this.SISY.value && ((this.curFrame - this.SISY.value) % this.PISY.value) === 0) {
            if (!(this.enableOPTS && this.genDesc.IITS.OPTS)) {
                this.activeChildren.push(this.ConstructChildParticleSystem(this.genDesc.IITS));
            }
        }

        if (this.genDesc.KSSM && this.prevFrame !== this.curFrame && this.curFrame < this.PSLT.value) {
            // TODO: Random seed backup
            let incSeed = 0;
            const systems = this.genDesc.KSSM.GetSpawnedSystemsAtFrame(this.curFrame);
            for (let i = 0; i < systems.length; ++i) {
                const system = systems[i];
                // TODO: Other system types
                if (system.description instanceof GenDescription && !(this.enableOPTS && system.description.OPTS)) {
                    // TODO: Use incSeed
                    this.activeChildren.push(this.ConstructChildParticleSystem(system.description));
                }
                incSeed += 1;
            }
        }

        if (this.genDesc.IDTS && this.prevFrame !== this.curFrame && this.curFrame === this.PSLT.value) {
            const ndsyVal = { value: 1 };
            if (this.genDesc.NDSY) {
                this.genDesc.NDSY.GetValue(0, globals, ndsyVal);
            }

            if (!(this.enableOPTS && this.genDesc.IDTS.OPTS)) {
                for (let i = 0; i < ndsyVal.value; ++i) {
                    this.activeChildren.push(this.ConstructChildParticleSystem(this.genDesc.IDTS));
                }
            }
        }

        if (this.genDesc.SSWH && this.prevFrame !== this.curFrame && this.curFrame === this.SSSD.value) {
            const gen = new SwooshGenerator(this.genDesc.SSWH, 0);
            gen.SetGlobalTranslation(this.globalTranslation);
            gen.SetGlobalScale(this.globalScale);
            gen.SetLocalScale(this.localScale);
            gen.SetTranslation(vec3.add(scratchVec3a, this.translation, this.SSPO));
            gen.SetOrientation(this.orientation);
            gen.SetParticleEmission(this.particleEmission);
            this.activeChildren.push(gen);
        }

        if (this.genDesc.SELC && this.prevFrame !== this.curFrame && this.curFrame === this.SESD.value) {
            const gen = new ElectricGenerator(this.genDesc.SELC);
            gen.SetGlobalTranslation(this.globalTranslation);
            gen.SetGlobalScale(this.globalScale);
            gen.SetLocalScale(this.localScale);
            gen.SetTranslation(vec3.add(scratchVec3a, this.translation, this.SEPO));
            gen.SetOrientation(this.orientation);
            gen.SetParticleEmission(this.particleEmission);
            this.activeChildren.push(gen);
        }

        for (let i = 0; i < this.activeChildren.length;) {
            const child = this.activeChildren[i];

            child.Update(device, dt);
            if (child.IsSystemDeletable()) {
                child.Destroy(device);
                this.activeChildren.splice(i, 1);
                continue;
            }

            ++i;
        }

        this.prevFrame = this.curFrame;
    }

    private UpdatePSTranslationAndOrientation(globals: ParticleGlobals): void {
        // TODO: Random seeding
        // Particle systems never stop in noclip
        //if (this.PSLT.value < this.curFrame)
        //    return;

        if (this.genDesc.POFS) {
            this.genDesc.POFS.GetValue(this.curFrame, globals, this.POFS);
        }

        if (this.genDesc.SSPO) {
            this.genDesc.SSPO.GetValue(this.curFrame, globals, this.SSPO);
        }

        if (this.genDesc.SEPO) {
            this.genDesc.SEPO.GetValue(this.curFrame, globals, this.SEPO);
        }
    }

    private UpdateLightParameters(globals: ParticleGlobals): void {
        if (this.genDesc.LCLR) {
            this.genDesc.LCLR.GetValue(this.curFrame, globals, this.LCLR);
        }

        if (this.genDesc.LINT) {
            this.genDesc.LINT.GetValue(this.curFrame, globals, this.LINT);
        }

        switch (this.lightType.value) {
        case LightType.None:
        case LightType.Custom:
        case LightType.Spot: {
            if (this.genDesc.LOFF) {
                this.genDesc.LOFF.GetValue(this.curFrame, globals, this.LOFF);
            }
            if (this.genDesc.LFOR) {
                this.genDesc.LFOR.GetValue(this.curFrame, globals, this.LFOR);
            }
            if (this.lightType.value === LightType.Spot) {
                if (this.genDesc.LSLA) {
                    this.genDesc.LSLA.GetValue(this.curFrame, globals, this.LSLA);
                }
            }
            // fallthrough
        }
        case LightType.Directional:
            if (this.lightType.value !== LightType.Custom) {
                if (this.genDesc.LDIR) {
                    this.genDesc.LDIR.GetValue(this.curFrame, globals, this.LDIR);
                }
            }
        }
    }

    private BuildParticleSystemBounds(): void {
        this.recursiveParticleCount = this.GetParticleCountAllInternal();
        let accumulated: boolean = false;
        scratchAABBa.reset();

        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            const childBounds = child.GetBounds();
            if (childBounds) {
                accumulated = true;
                scratchAABBa.union(scratchAABBa, childBounds);
            }
        }

        this.recursiveParticleCount = this.GetParticleCountAllInternal();
        if (this.GetParticleCount() > 0) {
            const extents = vec3.scale(scratchVec3a, this.globalScale, this.maxSize);
            const xf = mat4.mul(scratchMat4a, mat4.mul(scratchMat4a, this.globalScaleTransform, this.globalOrientation), this.localScaleTransform);
            scratchAABBb.transform(this.localAABB, xf);
            scratchAABBb.offset(scratchAABBb, this.globalTranslation);
            this.globalAABB.expandByExtent(scratchAABBb, extents);
        } else {
            this.globalAABB.reset();
        }

        if (accumulated) {
            this.globalAABB.union(this.globalAABB, scratchAABBa);
        }
    }

    private InternalUpdate(device: GfxDevice, dt: number, globals: ParticleGlobals): boolean {
        // TODO: Random seeding
        let dt1 = 1.0 / 60.0;
        if (Math.abs(dt - 1.0 / 60.0) >= 1.0 / 60000.0)
            dt1 = dt;

        let t = this.curFrame / 60.0;
        globals.emitterTime = this.curFrame;

        if (this.genDesc.PSTS) {
            const PSTS = { value: 0 };
            this.genDesc.PSTS.GetValue(this.curFrame, globals, PSTS);
            dt1 = Math.max(0.0, PSTS.value * dt1);
        }

        this.curSeconds += dt1;

        if (this.MBLR && dt > 0.0 && this.genDesc.MBSP) {
            this.genDesc.MBSP.GetValue(this.curFrame, globals, this.MBSP);
        }

        let frameUpdateCount = 0;
        while (t < this.curSeconds && Math.abs(t - this.curSeconds) >= 1.0 / 60000.0) {
            this.localAABB.reset();
            this.maxSize = 0.0;
            globals.emitterTime = this.curFrame;
            this.UpdateExistingParticles(globals);
            globals.particleLifetime = this.PSLT.value;

            // Particle systems never stop in noclip
            if (/*this.curFrame < this.PSLT.value &&*/ this.particleEmission) {
                const grte = { value: 0 };
                if (this.genDesc.GRTE) {
                    if (this.genDesc.GRTE.GetValue(this.curFrame, globals, grte)) {
                        this.particles = [];
                        return true;
                    }
                }

                grte.value = Math.max(0.0, grte.value * this.generatorRate);
                this.generatorRemainder += grte.value;
                const genCount = Math.floor(this.generatorRemainder);
                this.generatorRemainder = this.generatorRemainder - genCount;

                if (this.genDesc.MAXP) {
                    this.genDesc.MAXP.GetValue(this.curFrame, globals, this.MAXP);
                }

                this.CreateNewParticles(genCount, globals);
            }

            if (this.translationDirty) {
                this.UpdatePSTranslationAndOrientation(globals);
            }

            if (this.lightType.value !== LightType.None) {
                this.UpdateLightParameters(globals);
            }

            this.UpdateChildParticleSystems(device, 1.0 / 60.0, globals);

            ++frameUpdateCount;
            ++this.curFrame;
            t += 1.0 / 60.0;
        }

        if (Math.abs(t - this.curSeconds) < 1.0 / 60000.0) {
            this.curSeconds = t;
            this.timeDeltaScale = 1.0;
        } else {
            this.UpdateChildParticleSystems(device, dt1 - frameUpdateCount / 60.0, globals);
            this.timeDeltaScale = 1.0 - (t - this.curSeconds) * 60.0;
        }

        this.BuildParticleSystemBounds();

        return false;
    }

    public SetGlobalTranslation(translation: ReadonlyVec3): void {
        vec3.copy(this.globalTranslation, translation);
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.SetGlobalTranslation(translation);
        }
    }

    public GetGlobalTranslation(): ReadonlyVec3 {
        return this.globalTranslation;
    }

    public SetGlobalOrientation(orientation: ReadonlyMat4): void {
        mat4.copy(this.globalOrientation, orientation);
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.SetGlobalOrientation(orientation);
        }
    }

    public GetGlobalOrientation(): ReadonlyMat4 {
        return this.globalOrientation;
    }

    public SetGlobalScale(scale: ReadonlyVec3): void {
        vec3.copy(this.globalScale, scale);
        mat4.fromScaling(this.globalScaleTransform, scale);
        mat4.fromScaling(this.globalScaleTransformInverse, vec3.inverse(scratchVec3a, scale));
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.SetGlobalScale(scale);
        }
    }

    public GetGlobalScale(): ReadonlyVec3 {
        return this.globalScale;
    }

    public SetTranslation(translation: ReadonlyVec3): void {
        vec3.copy(this.translation, translation);
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            if (child instanceof ElectricGenerator)
                child.SetTranslation(vec3.add(scratchVec3a, translation, this.SEPO));
            else if (child instanceof SwooshGenerator)
                child.SetTranslation(vec3.add(scratchVec3a, translation, this.SSPO));
            else
                child.SetTranslation(translation);
        }
    }

    public SetOrientation(orientation: ReadonlyMat4): void {
        mat4.copy(this.orientation, orientation);
        mat4.transpose(this.orientationInverse, orientation);
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.SetOrientation(orientation);
        }
    }

    public SetLocalScale(scale: ReadonlyVec3): void {
        vec3.copy(this.localScale, scale);
        mat4.fromScaling(this.localScaleTransform, scale);
        mat4.fromScaling(this.localScaleTransformInverse, vec3.inverse(scratchVec3a, scale));
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.SetLocalScale(scale);
        }
    }

    public SetParticleEmission(emission: boolean): void {
        this.particleEmission = emission;
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.SetParticleEmission(emission);
        }
    }

    public SetModulationColor(color: Color): void {
        colorCopy(this.moduColor, color);
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.SetModulationColor(color);
        }
    }

    public GetModulationColor(): Color {
        return this.moduColor;
    }

    public SetGeneratorRate(rate: number): void {
        this.generatorRate = Math.max(0.0, rate);
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            if (child instanceof ElementGenerator)
                child.SetGeneratorRate(this.generatorRate);
        }
    }

    public GetGeneratorRate(): number {
        return this.generatorRate;
    }

    public IsSystemDeletable(): boolean {
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            if (!child.IsSystemDeletable())
                return false;
        }
        // Particle systems never stop in noclip
        return false;
        //return this.PSLT.value < this.curFrame && this.activeParticleCount === 0;
    }

    public GetBounds(): AABB | null {
        if (this.GetParticleCountAll() === 0)
            return null;
        return this.globalAABB;
    }

    public SystemHasLight(): boolean {
        return this.lightType.value !== LightType.None;
    }

    public GetLight(): Light {
        const light = new GX_Material.Light();
        let custom = false;
        switch (this.lightType.value) {
        case LightType.Directional:
            vec3.normalize(light.Direction, this.LDIR);
            colorScale(light.Color, this.LCLR, this.LINT.value);
            break;
        case LightType.Spot:
            vec3.copy(light.Position, this.LOFF);
            vec3.normalize(light.Direction, this.LDIR);
            colorScale(light.Color, this.LCLR, this.LINT.value);
            lightSetSpot(light, this.LSLA.value, GX.SpotFunction.COS2);
            // angle
            break;
        default: {
            const quad = this.falloffType.value === FalloffType.Quadratic ? this.LFOR.value : 0.0;
            const linear = this.falloffType.value === FalloffType.Linear ? this.LFOR.value : 0.0;
            const constant = this.falloffType.value === FalloffType.Constant ? 1.0 : 0.0;
            vec3.copy(light.Position, this.LOFF);
            vec3.set(light.Direction, 1.0, 0.0, 0.0);
            colorCopy(light.Color, this.LCLR);
            light.DistAtten[0] = constant;
            light.DistAtten[1] = linear;
            light.DistAtten[2] = quad;
            light.CosAtten[0] = this.LINT.value;
            custom = true;
            break;
        }
        }
        return { gxLight: light, custom };
    }

    public Update(device: GfxDevice, dt: number): boolean {
        const globals = new ParticleGlobals();
        globals.currentParticleSystem = this;

        if (this.genDesc.PSWT && !this.warmedUp) {
            const pswt = { value: 0 };
            this.genDesc.PSWT.GetValue(this.curFrame, globals, pswt);
            this.InternalUpdate(device, (1.0 / 60.0) * pswt.value, globals);
            this.warmedUp = true;
        }

        return this.InternalUpdate(device, dt, globals);
    }

    private RenderModels(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput, globals: ParticleGlobals): void {
        globals.particleAccessParameters = null;
        // TODO: Light handling
        // TODO: Random seeding

        if (this.genDesc.PMUS) {
            if (this.genDesc.PMAB) {
                // depth write lequal, no z test
                // src alpha, one
            } else {
                // depth write lequal, z test
                // src alpha, inv src alpha
            }

            // no cull

            if (this.genDesc.TEXR) {
                const target = this.particles[0];
                const particleFrame = this.curFrame - target.startFrame;
                const texr = this.genDesc.TEXR.GetValueTexture(particleFrame, globals)!;
                // load tex
                const uvs = this.genDesc.TEXR.GetValueUV(particleFrame, globals);
            }
        }
    }

    private RenderLines(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput, globals: ParticleGlobals): void {
        // TODO: Line rendering
    }

    private RenderParticles(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput, globals: ParticleGlobals): void {
        mat4.mul(scratchModelMatrix, primeSpaceFromNoclipSpace, mat4.mul(scratchModelMatrix, viewerInput.camera.worldMatrix, noclipSpaceFromPrimeSpace));
        scratchModelMatrix[12] = 0.0;
        scratchModelMatrix[13] = 0.0;
        scratchModelMatrix[14] = 0.0;
        const systemCameraMatrix = mat4.mul(scratchMat4a, mat4.invert(scratchMat4a, scratchModelMatrix), this.globalOrientation);
        mat4.mul(scratchModelMatrix, mat4.mul(scratchModelMatrix, mat4.mul(scratchMat4b, mat4.fromTranslation(scratchMat4b, this.globalTranslation), this.globalScaleTransform), scratchModelMatrix), this.localScaleTransform);
        if (this.ORNT)
            mat4.mul(scratchModelMatrix, scratchModelMatrix, systemCameraMatrix);
        mat4.mul(scratchModelMatrix, noclipSpaceFromPrimeSpace, scratchModelMatrix);
        computeViewMatrix(scratchViewMatrix, viewerInput.camera);
        mat4.mul(scratchModelViewMatrix, scratchViewMatrix, scratchModelMatrix);

        let UVs: UVElementSet = constantUvElements;
        let constUVs: boolean = true;
        if (this.genDesc.TEXR) {
            const particle = this.particles[0];
            const particleFrame = this.curFrame - particle.startFrame;
            UVs = this.genDesc.TEXR.GetValueUV(particleFrame, globals);
            constUVs = this.genDesc.TEXR.HasConstantUV();
        }

        const calculateViewPoint = (out: vec3, particle: Particle): vec3 => {
            return vec3.add(out, vec3.scale(scratchVec3a, vec3.sub(scratchVec3a, particle.pos, particle.prevPos), this.timeDeltaScale), particle.prevPos);
        };

        const calculateCameraViewPoint = (out: vec3, particle: Particle): vec3 => {
            transformVec3Mat4w1(out, systemCameraMatrix, calculateViewPoint(scratchVec3a, particle));
            return out;
        };

        interface ParticleListItem {
            particleIdx: number;
            viewPoint: vec3;
        }
        let sortItems: ParticleListItem[] | null = null;
        if (this.genDesc.SORT) {
            sortItems = new Array(this.particles.length);
            for (let i = 0; i < this.particles.length; ++i) {
                const viewPoint = vec3.create();
                calculateCameraViewPoint(viewPoint, this.particles[i]);
                sortItems[i] = { particleIdx: i, viewPoint };
            }
            sortItems.sort((a: ParticleListItem, b: ParticleListItem) => vec3.squaredLength(b.viewPoint) - vec3.squaredLength(a.viewPoint));
        }

        const mbspVal = Math.max(1, this.MBSP.value);

        globals.emitterTime = this.curFrame;
        if (true || !this.MBLR) {
            if (!this.ORNT) {
                const setVertex = this.genDesc.TEXR ? (idx: number, posX: number, posY: number, posZ: number, color: Color, uvX: number, uvY: number) => {
                    this.shapeHelper.setTexVertex(idx, posX, posY, posZ, color, uvX, uvY);
                } : (idx: number, posX: number, posY: number, posZ: number, color: Color, uvX: number, uvY: number) => {
                    this.shapeHelper.setNoTexVertex(idx, posX, posY, posZ, color);
                };

                for (let i = 0; i < this.particles.length; ++i) {
                    const partIdx = this.genDesc.SORT ? sortItems![i].particleIdx : i;
                    const particle = this.particles[partIdx];
                    globals.currentParticle = particle;

                    const particleFrame = this.curFrame - particle.startFrame - 1;
                    const viewPoint = this.genDesc.SORT ? sortItems![i].viewPoint : calculateCameraViewPoint(scratchVec3a, particle);

                    if (!constUVs) {
                        globals.particleLifetime = particle.endFrame.value - particle.startFrame;
                        globals.UpdateParticleLifetimeTweenValues(particleFrame);
                        UVs = this.genDesc.TEXR!.GetValueUV(particleFrame, globals);
                    }

                    const size = 0.5 * particle.lineLengthOrSize.value;
                    if (particle.lineWidthOrRota.value === 0) {
                        setVertex(i * 4, viewPoint[0] - size, viewPoint[1], viewPoint[2] + size, particle.color, UVs.xMin, UVs.yMax);
                        setVertex(i * 4 + 1, viewPoint[0] - size, viewPoint[1], viewPoint[2] - size, particle.color, UVs.xMin, UVs.yMin);
                        setVertex(i * 4 + 2, viewPoint[0] + size, viewPoint[1], viewPoint[2] - size, particle.color, UVs.xMax, UVs.yMin);
                        setVertex(i * 4 + 3, viewPoint[0] + size, viewPoint[1], viewPoint[2] + size, particle.color, UVs.xMax, UVs.yMax);
                    } else {
                        const theta = MathConstants.DEG_TO_RAD * particle.lineWidthOrRota.value;
                        const sinT = Math.sin(theta) * size;
                        const cosT = Math.cos(theta) * size;
                        setVertex(i * 4, viewPoint[0] + (sinT - cosT), viewPoint[1], viewPoint[2] + (sinT + cosT), particle.color, UVs.xMin, UVs.yMax);
                        setVertex(i * 4 + 1, viewPoint[0] - (sinT + cosT), viewPoint[1], viewPoint[2] - (cosT - sinT), particle.color, UVs.xMin, UVs.yMin);
                        setVertex(i * 4 + 2, viewPoint[0] + (cosT - sinT), viewPoint[1], viewPoint[2] + (-cosT - sinT), particle.color, UVs.xMax, UVs.yMin);
                        setVertex(i * 4 + 3, viewPoint[0] + (sinT + cosT), viewPoint[1], viewPoint[2] + (cosT - sinT), particle.color, UVs.xMax, UVs.yMax);
                    }
                }
            } else {
                const setVertexVec = this.genDesc.TEXR ? (idx: number, pos: ReadonlyVec3, color: Color, uvX: number, uvY: number) => {
                    this.shapeHelper.setTexVertexVec(idx, pos, color, uvX, uvY);
                } : (idx: number, pos: ReadonlyVec3, color: Color, uvX: number, uvY: number) => {
                    this.shapeHelper.setNoTexVertexVec(idx, pos, color);
                };

                getMatrixAxisZ(scratchViewDirection, viewerInput.camera.worldMatrix);
                vec3.negate(scratchViewDirection, scratchViewDirection);
                transformVec3Mat4w0(scratchViewDirection, primeSpaceFromNoclipSpace, scratchViewDirection);
                getMatrixTranslation(scratchViewPoint, viewerInput.camera.worldMatrix);
                transformVec3Mat4w0(scratchViewPoint, primeSpaceFromNoclipSpace, scratchViewPoint);

                for (let i = 0; i < this.particles.length; ++i) {
                    const partIdx = this.genDesc.SORT ? sortItems![i].particleIdx : i;
                    const particle = this.particles[partIdx];
                    globals.currentParticle = particle;

                    const particleFrame = this.curFrame - particle.startFrame - 1;
                    const viewPoint = calculateViewPoint(scratchVec3a, particle);

                    const width = !this.genDesc.ROTA ? 1.0 : particle.lineWidthOrRota.value;
                    const dir = scratchVec3b;
                    if (!vec3.equals(particle.vel, Vec3Zero)) {
                        vec3.normalize(dir, particle.vel);
                    } else {
                        vec3.sub(dir, particle.pos, particle.prevPos);
                        if (!vec3.equals(dir, Vec3Zero)) {
                            vec3.normalize(dir, dir);
                        } else {
                            vec3.copy(dir, Vec3UnitZ);
                        }
                    }

                    const foreVec = vec3.scale(scratchVec3c, dir, particle.lineLengthOrSize.value);
                    const rightVec = scratchVec3d;
                    if (this.genDesc.RSOP) {
                        vec3.cross(rightVec, dir, scratchViewDirection);
                        if (!vec3.equals(rightVec, Vec3Zero)) {
                            vec3.scale(rightVec, vec3.normalize(rightVec, rightVec), particle.lineLengthOrSize.value * width);
                        } else {
                            vec3.cross(rightVec, dir, vec3.normalize(rightVec, vec3.sub(rightVec, scratchViewPoint, particle.pos)));
                            if (!vec3.equals(rightVec, Vec3Zero)) {
                                vec3.scale(rightVec, vec3.normalize(rightVec, rightVec), particle.lineLengthOrSize.value * width);
                            }
                        }
                    } else {
                        vec3.scale(rightVec, vec3.cross(rightVec, foreVec, scratchViewDirection), width);
                    }

                    if (!constUVs) {
                        globals.particleLifetime = particle.endFrame.value - particle.startFrame;
                        globals.UpdateParticleLifetimeTweenValues(particleFrame);
                        UVs = this.genDesc.TEXR!.GetValueUV(particleFrame, globals);
                    }

                    vec3.scale(foreVec, foreVec, 0.5);
                    const halfRightVec = vec3.scale(scratchVec3e, rightVec, 0.5);

                    vec3.sub(viewPoint, viewPoint, halfRightVec);
                    setVertexVec(i * 4, vec3.add(scratchVec3b, viewPoint, foreVec), particle.color, UVs.xMax, UVs.yMin);
                    setVertexVec(i * 4 + 1, vec3.sub(scratchVec3b, viewPoint, foreVec), particle.color, UVs.xMin, UVs.yMin);
                    vec3.add(viewPoint, viewPoint, rightVec);
                    setVertexVec(i * 4 + 2, vec3.sub(scratchVec3b, viewPoint, foreVec), particle.color, UVs.xMin, UVs.yMax);
                    setVertexVec(i * 4 + 3, vec3.add(scratchVec3b, viewPoint, foreVec), particle.color, UVs.xMax, UVs.yMax);
                }
            }
        } else {
            // TODO: MBLR
        }

        const renderInst = renderer.renderHelper.renderInstManager.newRenderInst();
        renderInst.debug = this;

        const materialParamsBlockOffs = this.material.allocateMaterialParamsBlock(renderer.renderHelper.renderInstManager);
        colorCopy(scratchMaterialParams.u_Color[ColorKind.AMB0], this.genDesc.TEXR && !colorEqual(this.moduColor, OpaqueBlack) ? this.moduColor : White);
        this.material.fillMaterialParamsData(renderer.renderHelper.renderInstManager, materialParamsBlockOffs, scratchMaterialParams);

        this.material.setOnRenderInst(renderer.device, renderer.renderCache, renderInst);
        renderInst.setUniformBufferOffset(GX_Program.ub_MaterialParams, materialParamsBlockOffs, this.material.materialParamsBufferSize);
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT, this.material.programKey);
        renderInst.setSamplerBindingsFromTextureMappings([this.textureMapping]);

        this.shapeHelper.uploadToDevice(renderer.device);
        this.shapeHelper.setOnRenderInst(renderInst, this.particles.length);
        mat4.copy(scratchDrawParams.u_PosMtx[0], scratchModelViewMatrix);
        this.material.allocateDrawParamsDataOnInst(renderInst, scratchDrawParams);

        renderer.renderHelper.renderInstManager.submitRenderInst(renderInst);
    }

    public Render(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.Render(renderer, viewerInput);
        }

        const globals = new ParticleGlobals();
        globals.currentParticleSystem = this;

        if (this.particles.length) {
            if (this.genDesc.PMDL || this.genDesc.PMUS) {
                this.RenderModels(renderer, viewerInput, globals);
            }

            if (this.LINE) {
                this.RenderLines(renderer, viewerInput, globals);
            } else {
                this.RenderParticles(renderer, viewerInput, globals);
            }
        }
    }

    public DestroyParticles() {
        //g_ParticleAliveCount -= this.particles.length;
        this.particles = [];
        this.parentMatrices = [];
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.DestroyParticles();
        }
    }

    public Destroy(device: GfxDevice): void {
        for (let i = 0; i < this.activeChildren.length; ++i) {
            const child = this.activeChildren[i];
            child.Destroy(device);
        }
        this.shapeHelper.destroy(device);
    }
}

export class ElementGeneratorMaterialHelper {
    public materialHelpers: GXMaterialHelperGfx[] = [];

    static buildMaterial(key: number): GXMaterialHelperGfx {
        const tex = (key & 1) !== 0;
        const ztest = (key & 2) !== 0;
        const zwrite = (key & 4) !== 0;
        const additive = (key & 8) !== 0;

        const materialBuilder = new GXMaterialBuilder(`ElementGenerator${tex ? 'Tex' : ''}${ztest ? 'ZTest' : ''}${zwrite ? 'ZWrite' : ''}${additive ? 'Additive' : ''}`);
        materialBuilder.setCullMode(GX.CullMode.NONE);
        materialBuilder.setChanCtrl(GX.ColorChannelID.COLOR0A0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        if (tex) {
            materialBuilder.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
            materialBuilder.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
            materialBuilder.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            materialBuilder.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            materialBuilder.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
            materialBuilder.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        } else {
            materialBuilder.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
            materialBuilder.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            materialBuilder.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            materialBuilder.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
            materialBuilder.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
        }

        materialBuilder.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, additive ? GX.BlendFactor.ONE : GX.BlendFactor.INVSRCALPHA);

        materialBuilder.setZMode(ztest, GX.CompareType.LEQUAL, zwrite);

        return new GXMaterialHelperGfx(materialBuilder.finish());
    }

    constructor() {
        for (let i = 0; i < 16; ++i) {
            this.materialHelpers[i] = ElementGeneratorMaterialHelper.buildMaterial(i);
        }
    }

    public getMaterial(tex: boolean, ztest: boolean, zwrite: boolean, additive: boolean): GXMaterialHelperGfx {
        const key = (tex ? 1 : 0) | (ztest ? 2 : 0) | (zwrite ? 4 : 0) | (additive ? 8 : 0);
        return this.materialHelpers[key];
    }
}

export class ElementGeneratorShapeHelper {
    public shapeHelper: GXShapeHelperGfx;
    private readonly shadowBuffer: DataView;
    private readonly vertexBuffer: GfxBuffer;
    private readonly indexBuffer: GfxBuffer;

    constructor(renderer: RetroSceneRenderer, vertexLayout: LoadedVertexLayout, private maxElementCount: number) {
        // Coincidentally multiplies to fit four vertices per generator element (particle quad)
        const wordCount = vertexLayout.vertexBufferStrides[0] * maxElementCount;
        const shadowBufferData = new ArrayBuffer(wordCount * 4);
        this.shadowBuffer = new DataView(shadowBufferData);
        this.vertexBuffer = renderer.device.createBuffer(wordCount, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);

        const indexData = makeTriangleIndexBuffer(GfxTopology.Quads, 0, maxElementCount * 4);
        this.indexBuffer = makeStaticDataBuffer(renderer.device, GfxBufferUsage.Index, indexData.buffer);

        this.shapeHelper = new GXShapeHelperGfx(renderer.device, renderer.renderCache, [{ buffer: this.vertexBuffer, byteOffset: 0 }], { buffer: this.indexBuffer, byteOffset: 0 }, vertexLayout);
    }

    static createTex(renderer: RetroSceneRenderer, maxElementCount: number): ElementGeneratorShapeHelper {
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.DIRECT };
        vcd[GX.Attr.CLR0] = { type: GX.AttrType.DIRECT };
        vcd[GX.Attr.TEX0] = { type: GX.AttrType.DIRECT };
        const loadedVertexLayout = compileLoadedVertexLayout(vcd);
        assert(loadedVertexLayout.vertexBufferStrides[0] === 9*4);
        return new ElementGeneratorShapeHelper(renderer, loadedVertexLayout, maxElementCount);
    }

    static createNoTex(renderer: RetroSceneRenderer, maxElementCount: number): ElementGeneratorShapeHelper {
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.DIRECT };
        vcd[GX.Attr.CLR0] = { type: GX.AttrType.DIRECT };
        const loadedVertexLayout = compileLoadedVertexLayout(vcd);
        assert(loadedVertexLayout.vertexBufferStrides[0] === 5*4);
        return new ElementGeneratorShapeHelper(renderer, loadedVertexLayout, maxElementCount);
    }

    public setOnRenderInst(renderInst: GfxRenderInst, elementCount: number): void {
        this.shapeHelper.setOnRenderInst(renderInst, { indexOffset: 0, indexCount: Math.min(elementCount, this.maxElementCount) * 6, texMatrixTable: [], posMatrixTable: [] });
    }

    public setTexVertex(idx: number, posX: number, posY: number, posZ: number, color: Color, uvX: number, uvY: number): void {
        const e = (getSystemEndianness() === Endianness.LITTLE_ENDIAN);
        this.shadowBuffer.setFloat32(idx * 0x24 + 0x00, posX, e);
        this.shadowBuffer.setFloat32(idx * 0x24 + 0x04, posY, e);
        this.shadowBuffer.setFloat32(idx * 0x24 + 0x08, posZ, e);
        // this.shadowBuffer.setFloat32(idx * 0x24 + 0x0C, 0.0, e);
        // Always little-endian (R8G8B8A8)
        this.shadowBuffer.setUint32(idx * 0x24 + 0x10, colorToRGBA8(color), false);
        this.shadowBuffer.setFloat32(idx * 0x24 + 0x14, uvX, e);
        this.shadowBuffer.setFloat32(idx * 0x24 + 0x18, uvY, e);
        // TEX1 is unused.
    }

    public setTexVertexVec(idx: number, vec: ReadonlyVec3, color: Color, uvX: number, uvY: number): void {
        this.setTexVertex(idx, vec[0], vec[1], vec[2], color, uvX, uvY);
    }

    public setNoTexVertex(idx: number, posX: number, posY: number, posZ: number, color: Color): void {
        const e = (getSystemEndianness() === Endianness.LITTLE_ENDIAN);
        this.shadowBuffer.setFloat32(idx * 0x14 + 0x00, posX, e);
        this.shadowBuffer.setFloat32(idx * 0x14 + 0x00, posX, e);
        this.shadowBuffer.setFloat32(idx * 0x14 + 0x04, posY, e);
        this.shadowBuffer.setFloat32(idx * 0x14 + 0x08, posZ, e);
        // this.shadowBuffer.setFloat32(idx * 0x14 + 0x0C, 0.0, e);
        // Always little-endian (R8G8B8A8)
        this.shadowBuffer.setUint32(idx * 0x14 + 0x10, colorToRGBA8(color), false);
    }

    public setNoTexVertexVec(idx: number, vec: ReadonlyVec3, color: Color): void {
        this.setNoTexVertex(idx, vec[0], vec[1], vec[2], color);
    }

    public uploadToDevice(device: GfxDevice): void {
        device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.shadowBuffer.buffer));
    }

    public destroy(device: GfxDevice): void {
        this.shapeHelper.destroy(device);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}
