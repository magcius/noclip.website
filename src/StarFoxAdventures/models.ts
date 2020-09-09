import { nArray } from '../util';
import { mat4, vec3 } from 'gl-matrix';
import { GX_VtxDesc, GX_VtxAttrFmt, GX_Array } from '../gx/gx_displaylist';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { DataFetcher } from '../DataFetcher';
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import { GameInfo } from './scenes';
import { SFAMaterial, ShaderAttrFlags, ANCIENT_MAP_SHADER_FIELDS } from './materials';
import { SFAAnimationController } from './animation';
import { Shader, parseShader, ShaderFlags, BETA_MODEL_SHADER_FIELDS, SFA_SHADER_FIELDS, SFADEMO_MAP_SHADER_FIELDS, SFADEMO_MODEL_SHADER_FIELDS, MaterialFactory } from './materials';
import { LowBitReader, dataSubarray, arrayBufferSliceFromDataView, dataCopy, readVec3, readUint32, readUint16, mat4SetRowMajor } from './util';
import { loadRes } from './resource';
import { TextureFetcher } from './textures';
import { Shape, ShapeGeometry, CommonShapeMaterial } from './shapes';
import { SceneRenderContext } from './render';
import { Skeleton, SkeletonInstance } from './skeleton';

interface Joint {
    parent: number;
    boneNum: number;
    translation: vec3;
    bindTranslation: vec3;
}

interface CoarseBlend {
    joint0: number;
    influence0: number;
    joint1: number;
    influence1: number;
}

export enum ModelVersion {
    AncientMap,
    Beta,
    BetaMap, // Demo swapcircle
    Demo, // Most demo files
    Final,
}

interface DisplayListInfo {
    offset: number;
    size: number;
    specialBitAddress: number; // Command bit address for fur/grass or water
    // TODO: Also includes bounding box
}

function parseDisplayListInfo(data: DataView): DisplayListInfo {
    return {
        offset: data.getUint32(0x0),
        size: data.getUint16(0x4),
        specialBitAddress: data.getUint16(0x14),
    }
}

type CreateModelShapesFunc = () => ModelShapes;
type BuildMaterialFunc = (shader: Shader, texFetcher: TextureFetcher, texIds: number[], alwaysUseTex1: boolean, isMapBlock: boolean) => SFAMaterial;

interface FineSkinningConfig {
    numPieces: number;
    quantizeScale: number;
}

function parseFineSkinningConfig(data: DataView): FineSkinningConfig {
    return {
        numPieces: data.getUint16(0x2),
        quantizeScale: data.getUint8(0x6),
    };
}

const FineSkinningPiece_SIZE = 0x74;
interface FineSkinningPiece {
    skinDataSrcOffs: number;
    weightsSrc: number;
    bone0: number;
    bone1: number;
    weightsBlockCount: number;
    numVertices: number;
    skinMeOffset: number;
    skinSrcBlockCount: number; // A block is 32 bytes
}

function parseFineSkinningPiece(data: DataView): FineSkinningPiece {
    return {
        skinDataSrcOffs: data.getUint32(0x60),
        weightsSrc: data.getUint32(0x64),
        bone0: data.getUint8(0x6c),
        bone1: data.getUint8(0x6d),
        weightsBlockCount: data.getUint8(0x6f),
        numVertices: data.getUint16(0x70),
        skinMeOffset: data.getUint8(0x72),
        skinSrcBlockCount: data.getUint8(0x73),
    };
}

interface Fur {
    shape: Shape;
    numLayers: number;
}

interface Water {
    shape: Shape;
}

export interface ModelRenderContext {
    sceneCtx: SceneRenderContext;
    showDevGeometry: boolean;
    ambienceNum: number;
    setupLights: (lights: GX_Material.Light[], modelCtx: ModelRenderContext) => void;
}

class ModelShapes {
    // There is a Shape array for each draw step (opaques, translucents 1, and translucents 2)
    public shapes: Shape[][] = [];
    public furs: Fur[] = [];
    public waters: Water[] = [];

    constructor(public model: Model, public posBuffer: DataView) {
    }

    public reloadVertices() {
        // TODO: reload waters and furs
        for (let i = 0; i < this.shapes.length; i++) {
            const shapes = this.shapes[i];
            for (let j = 0; j < shapes.length; j++) {
                shapes[j].reloadVertices();
            }
        }
    }

    public getNumDrawSteps() {
        return this.shapes.length;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelCtx: ModelRenderContext, matrix: mat4, boneMatrices: mat4[], drawStep: number) {
        if (drawStep < 0 || drawStep >= this.shapes.length) {
            return;
        }

        const shapes = this.shapes[drawStep];
        for (let i = 0; i < shapes.length; i++) {
            if (shapes[i].isDevGeometry && !modelCtx.showDevGeometry) {
                continue;
            }

            mat4.fromTranslation(scratchMtx0, [0, this.model.yTranslate, 0]);
            mat4.translate(scratchMtx0, scratchMtx0, this.model.modelTranslate);
            mat4.mul(scratchMtx0, matrix, scratchMtx0);
            shapes[i].prepareToRender(device, renderInstManager, scratchMtx0, modelCtx, boneMatrices);
        }
    }
    
    public prepareToRenderWaters(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelCtx: ModelRenderContext, matrix: mat4, boneMatrices: mat4[]) {
        for (let i = 0; i < this.waters.length; i++) {
            const water = this.waters[i];

            mat4.fromTranslation(scratchMtx0, [0, this.model.yTranslate, 0]);
            mat4.translate(scratchMtx0, scratchMtx0, this.model.modelTranslate);
            mat4.mul(scratchMtx0, matrix, scratchMtx0);
            water.shape.prepareToRender(device, renderInstManager, scratchMtx0, modelCtx, boneMatrices);
        }
    }

    public prepareToRenderFurs(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelCtx: ModelRenderContext, matrix: mat4, boneMatrices: mat4[]) {
        for (let i = 0; i < this.furs.length; i++) {
            const fur = this.furs[i];

            for (let j = 0; j < fur.numLayers; j++) {
                mat4.fromTranslation(scratchMtx0, [0, this.model.yTranslate, 0]);
                mat4.translate(scratchMtx0, scratchMtx0, this.model.modelTranslate);
                mat4.translate(scratchMtx0, scratchMtx0, [0, 0.4 * (j + 1), 0]);
                mat4.mul(scratchMtx0, matrix, scratchMtx0);

                const mat = fur.shape.material as CommonShapeMaterial;
                mat.setFurLayer(j);
                const m00 = (j + 1) / 16 * 0.5;
                const m11 = m00;
                mat4SetRowMajor(scratchMtx1,
                    m00, 0.0, 0.0, 0.0,
                    0.0, m11, 0.0, 0.0,
                    0.0, 0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0, 0.0
                );
                mat.setOverrideIndMtx(0, scratchMtx1);
                fur.shape.prepareToRender(device, renderInstManager, scratchMtx0, modelCtx, boneMatrices);
                mat.setOverrideIndMtx(0, undefined);
            }
        }
    }
}

// Generate vertex attribute tables.
// The game uses one table for everything. The final version of the game has a minor difference in
// VAT 5 compared to older versions.
function generateVat(old: boolean): GX_VtxAttrFmt[][] {
    const vat: GX_VtxAttrFmt[][] = nArray(8, () => []);
    for (let i = 0; i <= GX.Attr.MAX; i++) {
        for (let j = 0; j < 8; j++) {
            vat[j][i] = { compType: GX.CompType.U8, compShift: 0, compCnt: 0 };
        }
    }

    vat[0][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
    vat[0][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[0][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 7, compCnt: GX.CompCnt.TEX_ST };

    vat[1][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 2, compCnt: GX.CompCnt.POS_XYZ };
    vat[1][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[1][GX.Attr.TEX0] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };

    vat[2][GX.Attr.POS] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
    vat[2][GX.Attr.NRM] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[2][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[2][GX.Attr.TEX0] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };
    vat[2][GX.Attr.TEX1] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };

    vat[3][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
    vat[3][GX.Attr.NRM] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[3][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[3][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[3][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[3][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[3][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

    vat[4][GX.Attr.POS] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
    vat[4][GX.Attr.NRM] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[4][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[4][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 7, compCnt: GX.CompCnt.TEX_ST };

    // The final version uses a 1/8 quantization factor; older versions do not use quantization.
    vat[5][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: old ? 0 : 3, compCnt: GX.CompCnt.POS_XYZ };
    vat[5][GX.Attr.NRM] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[5][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[5][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
    vat[5][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
    vat[5][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
    vat[5][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };

    vat[6][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
    vat[6][GX.Attr.NRM] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[6][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[6][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[6][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[6][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[6][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

    vat[7][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
    vat[7][GX.Attr.NRM] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[7][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[7][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[7][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[7][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[7][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

    return vat;
}

const VAT = generateVat(false);
const OLD_VAT = generateVat(true);

export class Model {
    private createModelShapes: CreateModelShapesFunc;
    private sharedModelShapes: ModelShapes | null = null;

    public modelData: DataView;

    public joints: Joint[] = [];
    public coarseBlends: CoarseBlend[] = [];
    public invBindTranslations: vec3[] = [];

    public yTranslate: number = 0;
    public modelTranslate: vec3 = vec3.create();

    public materials: (SFAMaterial | undefined)[] = [];

    public originalPosBuffer: DataView;

    public posFineSkinningConfig: FineSkinningConfig | undefined = undefined;
    public posFineSkinningWeights: DataView | undefined = undefined;
    public posFineSkinningPieces: FineSkinningPiece[] = [];

    private nrmFineSkinningConfig: FineSkinningConfig | undefined = undefined;

    public hasFineSkinning: boolean = false;
    public hasBetaFineSkinning: boolean = false;
    public skeleton?: Skeleton;

    constructor(
        private materialFactory: MaterialFactory,
        blockData: ArrayBufferSlice,
        texFetcher: TextureFetcher,
        public modelVersion: ModelVersion = ModelVersion.Final
    ) {
        let offs = 0;
        const blockDv = blockData.createDataView();
        this.modelData = blockDv;

        let fields: any;
        if (this.modelVersion === ModelVersion.Beta) {
            fields = {
                isBeta: true,
                isMapBlock: false,
                alwaysUseTex1: true,
                shaderFields: BETA_MODEL_SHADER_FIELDS,
                hasNormals: true,
                hasBones: true,
                texOffset: 0x1c,
                posOffset: 0x24,
                nrmOffset: 0x28, // ???
                clrOffset: 0x2c,
                texcoordOffset: 0x30,
                shaderOffset: 0x34,
                jointOffset: 0x38,
                listOffsets: 0x6c,
                listSizes: 0x70,
                posCount: 0x9e,
                nrmCount: 0xa0,
                clrCount: 0xa2,
                texcoordCount: 0xa4,
                texCount: 0xaa,
                jointCount: 0xab,
                posFineSkinningConfig: 0x64,
                posFineSkinningPieces: 0x80,
                posFineSkinningWeights: 0x84,
                nrmFineSkinningConfig: 0xac, // ???
                // weightCount: 0xad,
                shaderCount: 0xae,
                texMtxCount: 0xaf,
                dlOffsets: 0x88,
                dlSizes: 0x8c,
                dlInfoCount: 0xac,
                numListBits: 6,
                bitsOffsets: [0x90],
                bitsByteCounts: [0x94],
                oldVat: true,
                hasYTranslate: false,
            };
        } else if (this.modelVersion === ModelVersion.AncientMap) {
            fields = {
                isBeta: true,
                isMapBlock: true,
                alwaysUseTex1: true,
                shaderFields: ANCIENT_MAP_SHADER_FIELDS,
                hasNormals: false,
                hasBones: false,
                texOffset: 0x58,
                posOffset: 0x5c,
                clrOffset: 0x60,
                texcoordOffset: 0x64,
                shaderOffset: 0x68,
                listOffsets: 0x6c,
                listSizes: 0x70,
                posCount: 0x90,
                clrCount: 0x94,
                texcoordCount: 0x96,
                texCount: 0xa0,
                shaderCount: 0x9a,
                dlOffsets: 0x6c,
                dlSizes: 0x70,
                dlInfoCount: 0x99,
                numListBits: 6,
                bitsOffsets: [0x7c],
                bitsByteCounts: [0x86],
                oldVat: true,
                hasYTranslate: false,
            };
        } else if (this.modelVersion === ModelVersion.BetaMap) {
            fields = {
                isBeta: true,
                isMapBlock: true,
                alwaysUseTex1: true,
                shaderFields: BETA_MODEL_SHADER_FIELDS,
                hasNormals: false,
                hasBones: false,
                texOffset: 0x58,
                posOffset: 0x5c,
                clrOffset: 0x60,
                texcoordOffset: 0x64,
                shaderOffset: 0x68,
                listOffsets: 0x6c,
                listSizes: 0x70,
                posCount: 0x9e,
                clrCount: 0xa2,
                texcoordCount: 0xa4,
                texCount: 0x98,
                shaderCount: 0x99, // ???
                texMtxCount: 0xaf,
                dlOffsets: 0x6c,
                dlSizes: 0x70,
                dlInfoCount: 0x99, // ???
                numListBits: 6,
                bitsOffsets: [0x7c],
                bitsByteCounts: [0x94], // ???
                oldVat: true,
                hasYTranslate: false,
            };
        } else if (this.modelVersion === ModelVersion.Demo) {
            const isMapModel = false; // TODO: detect
            if (isMapModel) {
                // TODO: verify for correctness
                fields = {
                    isMapBlock: true,
                    texOffset: 0x54,
                    texCount: 0xa0,
                    posOffset: 0x58,
                    posCount: 0x90,
                    hasNormals: false,
                    nrmOffset: 0,
                    nrmCount: 0,
                    clrOffset: 0x5c,
                    clrCount: 0x94,
                    texcoordOffset: 0x60,
                    texcoordCount: 0x96,
                    hasBones: false,
                    jointOffset: 0,
                    jointCount: 0,
                    shaderOffset: 0x64,
                    shaderCount: 0xa0, // Polygon attributes and material information
                    shaderFields: SFADEMO_MAP_SHADER_FIELDS,
                    dlInfoOffset: 0x68,
                    dlInfoCount: 0x9f,
                    dlInfoSize: 0x34,
                    // FIXME: Yet another format occurs in sfademo/frontend!
                    // numListBits: 6, // 6 is needed for mod12; 8 is needed for early crfort?!
                    numListBits: 8, // ??? should be 6 according to decompilation of demo????
                    bitsOffsets: [0x74], // Whoa...
                    // FIXME: There are three bitstreams, probably for opaque and transparent objects
                    bitsByteCounts: [0x84],
                    oldVat: true,
                    hasYTranslate: false,
                };
            } else {
                // TODO: verify for correctness
                fields = {
                    isMapBlock: false,
                    alwaysUseTex1: true,
                    texOffset: 0x20,
                    texCount: 0xf2,
                    posOffset: 0x28,
                    posCount: 0xe4,
                    hasNormals: true,
                    nrmOffset: 0x2c,
                    nrmCount: 0xe6,
                    clrOffset: 0x30,
                    clrCount: 0xe8,
                    texcoordOffset: 0x34,
                    texcoordCount: 0xea,
                    hasBones: true,
                    jointOffset: 0x3c,
                    jointCount: 0xf3,
                    weightOffset: 0x54,
                    weightCount: 0xf4,
                    posFineSkinningConfig: 0x88,
                    posFineSkinningPieces: 0xa4,
                    posFineSkinningWeights: 0xa8,
                    nrmFineSkinningConfig: 0xac,
                    shaderOffset: 0x38,
                    shaderCount: 0xf8, // Polygon attributes and material information
                    shaderFields: SFADEMO_MODEL_SHADER_FIELDS,
                    dlInfoOffset: 0xd0,
                    dlInfoCount: 0xf5,
                    dlInfoSize: 0x1c,
                    // FIXME: Yet another format occurs in sfademo/frontend!
                    // numListBits: 6, // 6 is needed for mod12; 8 is needed for early crfort?!
                    numListBits: 8, // ??? should be 6 according to decompilation of demo????
                    bitsOffsets: [0xd4], // Whoa...
                    // FIXME: There are three bitstreams, probably for opaque and transparent objects
                    bitsByteCounts: [0xd8],
                    oldVat: true,
                    hasYTranslate: false,
                };
            }
        } else if (this.modelVersion === ModelVersion.Final) {
            // FIXME: This field is NOT a model type and doesn't reliably indicate
            // the type of model.
            const modelType = blockDv.getUint16(4);
            switch (modelType) {
            case 0:
                // Used in character and object models
                fields = {
                    isMapBlock: false,
                    alwaysUseTex1: true,
                    texOffset: 0x20,
                    texCount: 0xf2,
                    posOffset: 0x28,
                    posCount: 0xe4,
                    hasNormals: true,
                    nrmOffset: 0x2c,
                    nrmCount: 0xe6,
                    clrOffset: 0x30,
                    clrCount: 0xe8,
                    texcoordOffset: 0x34,
                    texcoordCount: 0xea,
                    hasBones: true,
                    jointOffset: 0x3c,
                    jointCount: 0xf3,
                    weightOffset: 0x54,
                    weightCount: 0xf4,
                    posFineSkinningConfig: 0x88,
                    posFineSkinningPieces: 0xa4,
                    posFineSkinningWeights: 0xa8,
                    nrmFineSkinningConfig: 0xac,
                    shaderOffset: 0x38,
                    shaderCount: 0xf8,
                    shaderFields: SFA_SHADER_FIELDS,
                    dlInfoOffset: 0xd0,
                    dlInfoCount: 0xf5,
                    dlInfoSize: 0x1c,
                    numListBits: 8,
                    bitsOffsets: [0xd4],
                    bitsByteCounts: [0xd8],
                    oldVat: false,
                    hasYTranslate: false,
                };
                break;
            case 8:
            case 264:
                // Used in map blocks
                fields = {
                    isMapBlock: true,
                    alwaysUseTex1: true,
                    texOffset: 0x54,
                    texCount: 0xa0,
                    posOffset: 0x58,
                    posCount: 0x90,
                    hasNormals: false,
                    nrmOffset: 0,
                    nrmCount: 0,
                    clrOffset: 0x5c,
                    clrCount: 0x94,
                    texcoordOffset: 0x60,
                    texcoordCount: 0x96,
                    hasBones: false,
                    jointOffset: 0,
                    jointCount: 0,
                    shaderOffset: 0x64,
                    shaderCount: 0xa2,
                    shaderFields: SFA_SHADER_FIELDS,
                    dlInfoOffset: 0x68,
                    dlInfoCount: 0xa1, // TODO
                    dlInfoSize: 0x1c,
                    numListBits: 8,
                    bitsOffsets: [0x78, 0x7c, 0x80],
                    bitsByteCounts: [0x84, 0x86, 0x88],
                    oldVat: false,
                    hasYTranslate: true,
                };
                break;
            default:
                throw Error(`Model type ${modelType} not implemented`);
            }
        } else {
            throw Error(`Unhandled model version ${modelVersion}`);
        }

        if (fields.posFineSkinningConfig !== undefined) {
            this.posFineSkinningConfig = parseFineSkinningConfig(dataSubarray(blockDv, fields.posFineSkinningConfig));
            // console.log(`pos fine skinning config: ${JSON.stringify(this.posFineSkinningConfig, null, '\t')}`);
            if (this.posFineSkinningConfig.numPieces !== 0) {
                const weightsOffs = blockDv.getUint32(fields.posFineSkinningWeights);
                this.posFineSkinningWeights = dataSubarray(blockDv, weightsOffs);
                const piecesOffs = blockDv.getUint32(fields.posFineSkinningPieces);
                for (let i = 0; i < this.posFineSkinningConfig.numPieces; i++) {
                    const piece = parseFineSkinningPiece(dataSubarray(blockDv, piecesOffs + i * FineSkinningPiece_SIZE, FineSkinningPiece_SIZE));
                    // console.log(`piece ${i}: ${JSON.stringify(piece, null, '\t')}`);
                    this.posFineSkinningPieces.push(piece);
                }
            }

            this.nrmFineSkinningConfig = parseFineSkinningConfig(dataSubarray(blockDv, fields.nrmFineSkinningConfig));
            // TODO: implement fine skinning for normals
        }

        this.hasFineSkinning = this.posFineSkinningConfig !== undefined && this.posFineSkinningConfig.numPieces !== 0;
        this.hasBetaFineSkinning = this.hasFineSkinning && this.modelVersion === ModelVersion.Beta;

        const vat = fields.oldVat ? OLD_VAT : VAT;

        // @0x8: data size
        // @0xc: 4x3 matrix (placeholder; always zeroed in files)
        // @0x8e: y translation (up/down)

        const texOffset = blockDv.getUint32(fields.texOffset);
        const texCount = blockDv.getUint8(fields.texCount);
        // console.log(`Loading ${texCount} texture infos from 0x${texOffset.toString(16)}`);
        const texIds: number[] = [];
        for (let i = 0; i < texCount; i++) {
            const texIdFromFile = readUint32(blockDv, texOffset, i);
            texIds.push(texIdFromFile);
        }
        // console.log(`texids: ${texIds}`);

        const posOffset = blockDv.getUint32(fields.posOffset);
        const posCount = blockDv.getUint16(fields.posCount);
        // console.log(`Loading ${posCount} positions from 0x${posOffset.toString(16)}`);
        const originalPosBuffer = blockData.subarray(posOffset, posCount * 6);
        this.originalPosBuffer = originalPosBuffer.createDataView();
        // this.posBuffer = new DataView(originalPosBuffer.copyToBuffer());

        let nrmBuffer = blockData;
        let nrmTypeFlags = 0;
        if (fields.hasNormals) {
            const nrmCount = blockDv.getUint16(fields.nrmCount);
            const nrmOffset = blockDv.getUint32(fields.nrmOffset);
            // console.log(`Loading ${nrmCount} normals from 0x${nrmOffset.toString(16)}`);
            nrmBuffer = blockData.subarray(nrmOffset);
            nrmTypeFlags = blockDv.getUint8(0x24);
        }

        const clrOffset = blockDv.getUint32(fields.clrOffset);
        const clrCount = blockDv.getUint16(fields.clrCount);
        // console.log(`Loading ${clrCount} colors from 0x${clrOffset.toString(16)}`);
        const clrBuffer = blockData.subarray(clrOffset);

        const texcoordOffset = blockDv.getUint32(fields.texcoordOffset);
        const texcoordCount = blockDv.getUint16(fields.texcoordCount);
        // console.log(`Loading ${texcoordCount} texcoords from 0x${texcoordOffset.toString(16)}`);
        const texcoordBuffer = blockData.subarray(texcoordOffset);

        let jointCount = 0;
        if (fields.hasBones) {
            const jointOffset = blockDv.getUint32(fields.jointOffset);
            jointCount = blockDv.getUint8(fields.jointCount);
            // console.log(`Loading ${jointCount} joints from offset 0x${jointOffset.toString(16)}`);

            this.joints = [];
            let offs = jointOffset;
            for (let i = 0; i < jointCount; i++) {
                this.joints.push({
                    parent: blockDv.getUint8(offs),
                    boneNum: blockDv.getUint8(offs + 0x1) & 0x7f,
                    translation: readVec3(blockDv, offs + 0x4),
                    bindTranslation: readVec3(blockDv, offs + 0x10),
                });
                offs += 0x1c;
            }

            if (fields.weightOffset !== undefined) {
                const weightOffset = blockDv.getUint32(fields.weightOffset);
                const weightCount = blockDv.getUint8(fields.weightCount);
                // console.log(`Loading ${weightCount} weights from offset 0x${weightOffset.toString(16)}`);

                this.coarseBlends = [];
                offs = weightOffset;
                for (let i = 0; i < weightCount; i++) {
                    const split = blockDv.getUint8(offs + 0x2);
                    const influence0 = 0.25 * split;
                    this.coarseBlends.push({
                        joint0: blockDv.getUint8(offs),
                        joint1: blockDv.getUint8(offs + 0x1),
                        influence0,
                        influence1: 1 - influence0,
                    });
                    offs += 0x4;
                }
            }

            // const transIsPresent = blockDv.getUint32(0xa4);
            // if (transIsPresent != 0) {
            //     console.log(`transIsPresent was 0x${transIsPresent.toString(16)} in this model`);
            //     this.modelTranslate = readVec3(blockDv, 0x44);
            //     console.log(`trans: ${this.modelTranslate}`);
            // }

            this.skeleton = new Skeleton();
            this.invBindTranslations = nArray(this.joints.length, () => vec3.create());

            for (let i = 0; i < this.joints.length; i++) {
                const joint = this.joints[i];

                if (joint.boneNum !== i) {
                    throw Error(`wtf? joint's bone number doesn't match its index!`);
                }

                this.skeleton.addJoint(joint.parent != 0xff ? joint.parent : undefined, joint.translation);
                vec3.negate(this.invBindTranslations[i], joint.bindTranslation);
            }
        }

        const shaderOffset = blockDv.getUint32(fields.shaderOffset);
        const shaderCount = blockDv.getUint8(fields.shaderCount);
        // console.log(`Loading ${shaderCount} shaders from offset 0x${shaderOffset.toString(16)}`);

        const shaders: Shader[] = [];

        offs = shaderOffset;
        for (let i = 0; i < shaderCount; i++) {
            const shaderBin = blockData.subarray(offs, fields.shaderFields.size).createDataView();

            const shader = parseShader(shaderBin, fields.shaderFields, texIds);
            shaders.push(shader);

            offs += fields.shaderFields.size;
        }

        this.materials = [];

        const dlInfos: DisplayListInfo[] = [];
        const dlInfoCount = blockDv.getUint8(fields.dlInfoCount);
        // console.log(`Loading ${dlInfoCount} display lists...`);
        if (fields.isBeta) {
            for (let i = 0; i < dlInfoCount; i++) {
                const dlOffsetsOffs = blockDv.getUint32(fields.dlOffsets);
                const dlSizesOffs = blockDv.getUint32(fields.dlSizes);

                dlInfos.push({
                    offset: readUint32(blockDv, dlOffsetsOffs, i),
                    size: readUint16(blockDv, dlSizesOffs, i),
                    specialBitAddress: -1,
                });
            }
        } else {
            const dlInfoOffset = blockDv.getUint32(fields.dlInfoOffset);

            for (let i = 0; i < dlInfoCount; i++) {
                offs = dlInfoOffset + i * fields.dlInfoSize;
                const dlInfo = parseDisplayListInfo(dataSubarray(blockDv, offs, fields.dlInfoSize));
                dlInfos.push(dlInfo);
            }
        }

        const bitsOffsets: number[] = [];
        const bitsByteCounts = [];
        for (let i = 0; i < fields.bitsOffsets.length; i++) {
            bitsOffsets.push(blockDv.getUint32(fields.bitsOffsets[i]));
            bitsByteCounts.push(blockDv.getUint16(fields.bitsByteCounts[i]));
        }

        let texMtxCount = 0;
        if (fields.hasBones) {
            if (fields.isBeta) {
                texMtxCount = blockDv.getUint8(fields.texMtxCount);
            } else {
                texMtxCount = blockDv.getUint8(0xfa);
            }
        }

        if (fields.hasYTranslate) {
            this.yTranslate = blockDv.getInt16(0x8e);
        } else {
            this.yTranslate = 0;
        }

        const pnMatrixMap: number[] = nArray(10, () => 0);

        const getVtxArrays = (posBuffer: DataView) => {
            const vtxArrays: GX_Array[] = [];
            vtxArrays[GX.Attr.POS] = { buffer: arrayBufferSliceFromDataView(posBuffer), offs: 0, stride: 6 /*getAttributeByteSize(vat[0], GX.Attr.POS)*/ };
            if (fields.hasNormals) {
                vtxArrays[GX.Attr.NRM] = { buffer: nrmBuffer, offs: 0, stride: (nrmTypeFlags & 8) != 0 ? 9 : 3 /*getAttributeByteSize(vat[0], GX.Attr.NRM)*/ };
            }
            vtxArrays[GX.Attr.CLR0] = { buffer: clrBuffer, offs: 0, stride: 2 /*getAttributeByteSize(vat[0], GX.Attr.CLR0)*/ };
            for (let t = 0; t < 8; t++) {
                vtxArrays[GX.Attr.TEX0 + t] = { buffer: texcoordBuffer, offs: 0, stride: 4 /*getAttributeByteSize(vat[0], GX.Attr.TEX0)*/ };
            }
            return vtxArrays;
        }

        const readVertexDesc = (bits: LowBitReader, shader: Shader): GX_VtxDesc[] => {
            // console.log(`Setting descriptor`);
            const vcd: GX_VtxDesc[] = [];
            for (let i = 0; i <= GX.Attr.MAX; i++) {
                vcd[i] = { type: GX.AttrType.NONE };
            }
            vcd[GX.Attr.NBT] = { type: GX.AttrType.NONE };

            if (fields.hasBones && jointCount >= 2) {
                vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.DIRECT;

                let texmtxNum = 0;

                if (shader.hasAuxTex0 || shader.hasAuxTex1) {
                    if (shader.hasAuxTex2) {
                        vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                        texmtxNum++;
                        vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                        texmtxNum++;
                    }

                    vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                    texmtxNum++;
                }

                texmtxNum = 7;
                for (let i = 0; i < texMtxCount; i++) {
                    vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                    texmtxNum--;
                }
            }

            const posDesc = bits.get(1);
            vcd[GX.Attr.POS].type = posDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;

            if (fields.hasNormals && (shader.attrFlags & ShaderAttrFlags.NRM)) {
                const nrmDesc = bits.get(1);
                if (nrmTypeFlags & 8) {
                    // TODO: Enable NBT normals
                    // vcd[GX.Attr.NRM].type = GX.AttrType.NONE;
                    // vcd[GX.Attr.NBT].type = nrmDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                    vcd[GX.Attr.NRM].type = nrmDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                } else {
                    // vcd[GX.Attr.NBT].type = GX.AttrType.NONE;
                    vcd[GX.Attr.NRM].type = nrmDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                }
            } else {
                vcd[GX.Attr.NRM].type = GX.AttrType.NONE;
            }

            if (shader.attrFlags & ShaderAttrFlags.CLR) {
                const clr0Desc = bits.get(1);
                vcd[GX.Attr.CLR0].type = clr0Desc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
            } else {
                vcd[GX.Attr.CLR0].type = GX.AttrType.NONE;
            }

            const texCoordDesc = bits.get(1);
            if (shader.layers.length > 0) {
                // Note: texCoordDesc applies to all texture coordinates in the vertex
                for (let t = 0; t < 8; t++) {
                    if (t < shader.layers.length) {
                        vcd[GX.Attr.TEX0 + t].type = texCoordDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                    } else {
                        vcd[GX.Attr.TEX0 + t].type = GX.AttrType.NONE;
                    }
                }
            }

            return vcd;
        }

        const runSpecialBitstream = (bitsOffset: number, bitAddress: number, buildSpecialMaterial: BuildMaterialFunc, posBuffer: DataView): Shape => {
            // console.log(`running special bitstream at offset 0x${bitsOffset.toString(16)} bit-address 0x${bitAddress.toString(16)}`);

            const bits = new LowBitReader(blockDv, bitsOffset);
            bits.seekBit(bitAddress);

            bits.drop(4);
            const shaderNum = bits.get(6);
            const shader = shaders[shaderNum];
            const material = buildSpecialMaterial(shader, texFetcher, texIds, fields.alwaysUseTex1, fields.isMapBlock);

            bits.drop(4);
            const vcd = readVertexDesc(bits, shader);

            bits.drop(4);
            const num = bits.get(4);
            for (let i = 0; i < num; i++) {
                bits.drop(8);
            }

            bits.drop(4);
            const listNum = bits.get(8);
            const dlInfo = dlInfos[listNum];
            // console.log(`Calling special bitstream DL #${listNum} at offset 0x${dlInfo.offset.toString(16)}, size 0x${dlInfo.size.toString(16)}`);
            const displayList = blockData.subarray(dlInfo.offset, dlInfo.size);

            const vtxArrays = getVtxArrays(posBuffer);

            const newGeom = new ShapeGeometry(vtxArrays, vcd, vat, displayList, this.hasFineSkinning);
            newGeom.setPnMatrixMap(pnMatrixMap, this.hasFineSkinning);

            const newMat = new CommonShapeMaterial();
            newMat.setMaterial(material);

            return new Shape(newGeom, newMat, false);
        }

        const runBitstream = (modelShapes: ModelShapes, bitsOffset: number, drawStep: number, posBuffer: DataView) => {
            // console.log(`running bitstream at offset 0x${bitsOffset.toString(16)}`);
            modelShapes.shapes[drawStep] = [];
            const shapes = modelShapes.shapes[drawStep];

            if (bitsOffset === 0) {
                return;
            }

            let curShader = shaders[0];
            let curMaterial: SFAMaterial | undefined = undefined;

            const setShader = (num: number) => {
                curShader = shaders[num];
                if (this.materials[num] === undefined) {
                    this.materials[num] = this.materialFactory.buildMaterial(curShader, texFetcher, fields.isMapBlock);
                }
                curMaterial = this.materials[num];
            }

            setShader(0);

            const bits = new LowBitReader(blockDv, bitsOffset);
            let vcd: GX_VtxDesc[] = [];
            let done = false;
            while (!done) {
                const opcode = bits.get(4);
                switch (opcode) {
                case 1: { // Set shader
                    const shaderNum = bits.get(6);
                    // console.log(`Setting shader #${shaderNum}`);
                    setShader(shaderNum);
                    break;
                }
                case 2: { // Call display list
                    const listNum = bits.get(fields.numListBits);
                    if (listNum >= dlInfoCount) {
                        console.warn(`Can't draw display list #${listNum} (out of range)`);
                        continue;
                    }

                    const dlInfo = dlInfos[listNum];
                    // console.log(`Calling DL #${listNum} at offset 0x${dlInfo.offset.toString(16)}, size 0x${dlInfo.size.toString(16)}`);
                    const displayList = blockData.subarray(dlInfo.offset, dlInfo.size);
    
                    try {
                        if (curShader.flags & ShaderFlags.Water) {
                            const newShape = runSpecialBitstream(bitsOffset, dlInfo.specialBitAddress, this.materialFactory.buildWaterMaterial.bind(this.materialFactory), posBuffer);
                            modelShapes.waters.push({ shape: newShape });
                        } else {
                            const vtxArrays = getVtxArrays(posBuffer);

                            const newGeom = new ShapeGeometry(vtxArrays, vcd, vat, displayList, this.hasFineSkinning);
                            newGeom.setPnMatrixMap(pnMatrixMap, this.hasFineSkinning);

                            const newMat = new CommonShapeMaterial();
                            newMat.setMaterial(curMaterial!);

                            const newShape = new Shape(newGeom, newMat, !!(curShader.flags & ShaderFlags.DevGeometry));
                            shapes.push(newShape);

                            if (drawStep === 0 && (curShader.flags & (ShaderFlags.ShortFur | ShaderFlags.MediumFur | ShaderFlags.LongFur))) {
                                const newShape = runSpecialBitstream(bitsOffset, dlInfo.specialBitAddress, this.materialFactory.buildFurMaterial.bind(this.materialFactory), posBuffer);

                                let numFurLayers;
                                if (curShader.flags & ShaderFlags.ShortFur) {
                                    numFurLayers = 4;
                                } else if (curShader.flags & ShaderFlags.MediumFur) {
                                    numFurLayers = 8;
                                } else { // curShader.flags & ShaderFlags.LongFur
                                    numFurLayers = 16;
                                }
                    
                                modelShapes.furs.push({ shape: newShape, numLayers: numFurLayers });
                            }
                        }
                    } catch (e) {
                        console.warn(`Failed to create model and shader instance due to exception:`);
                        console.error(e);
                    }
                    break;
                }
                case 3: { // Set descriptor
                    vcd = readVertexDesc(bits, curShader);
                    break;
                }
                case 4: // Set matrix selectors (skipped by SFA block renderer)
                    const numBones = bits.get(4);
                    if (numBones > 10) {
                        throw Error(`Too many PN matrices`);
                    }

                    for (let i = 0; i < numBones; i++) {
                        pnMatrixMap[i] = bits.get(8);
                    }
                    break;
                case 5: // End
                    done = true;
                    break;
                default:
                    console.warn(`Skipping unknown model bits opcode ${opcode}`);
                    break;
                }
            }
        }

        this.createModelShapes = () => {
            let instancePosBuffer;
            if (this.hasFineSkinning) {
                instancePosBuffer = dataCopy(this.originalPosBuffer);
            } else {
                instancePosBuffer = this.originalPosBuffer;
            }

            const modelShapes = new ModelShapes(this, instancePosBuffer);

            runBitstream(modelShapes, bitsOffsets[0], 0, modelShapes.posBuffer); // Opaques
            for (let i = 1; i < bitsOffsets.length; i++) {
                runBitstream(modelShapes, bitsOffsets[i], i, modelShapes.posBuffer); // Translucents and waters
            }

            return modelShapes;
        }

        // If there is no fine skinning, we can share model shapes between instances.
        if (!this.hasFineSkinning) {
            this.sharedModelShapes = this.createModelShapes();
        }
    }

    public createInstanceShapes(): ModelShapes {
        if (this.hasFineSkinning) {
            // Fine-skinned models must use per-instance shapes
            return this.createModelShapes();
        } else {
            // Models without fine skinning can use per-model shapes
            return this.sharedModelShapes!;
        }
    }

    public getMaterials() {
        return this.materials;
    }
}

const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();
const scratchMtx2 = mat4.create();
const scratchMtx3 = mat4.create();
const scratchVec0 = vec3.create();

export enum DrawStep {
    Waters = -2,
    Furs = -1,
    Solids = 0,
    Translucents1 = 1,
    Translucents2 = 2,
}

export class ModelInstance {
    private modelShapes: ModelShapes;

    public skeletonInst?: SkeletonInstance;

    public matrixPalette: mat4[] = [];
    private skinningDirty: boolean = true;
    private amap: DataView;

    constructor(public model: Model) {
        const numBones = this.model.joints.length + this.model.coarseBlends.length;

        if (numBones !== 0) {
            this.skeletonInst = new SkeletonInstance(this.model.skeleton!);
            this.matrixPalette = nArray(numBones, () => mat4.create());
        } else {
            this.matrixPalette = [mat4.create()];
        }

        this.skinningDirty = true;

        this.modelShapes = model.createInstanceShapes();
    }

    public getAmap(modelAnimNum: number): DataView {
        const stride = (((this.model.joints.length + 8) / 8)|0) * 8;
        return dataSubarray(this.amap, modelAnimNum * stride, stride);
    }

    public setAmap(amap: DataView) {
        this.amap = amap;
    }

    public getMaterials() {
        return this.model.getMaterials();
    }

    public getNumDrawSteps() {
        return this.modelShapes.getNumDrawSteps();
    }
    
    public resetPose() {
        mat4.identity(scratchMtx0);

        for (let i = 0; i < this.model.joints.length; i++) {
            this.skeletonInst!.setPoseMatrix(i, scratchMtx0);
        }

        this.skinningDirty = true;
    }
    
    public setJointPose(jointNum: number, mtx: mat4) {
        if (jointNum < 0 || jointNum >= this.model.joints.length) {
            return;
        }

        this.skeletonInst!.setPoseMatrix(jointNum, mtx);
        this.skinningDirty = true;
    }
    
    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelCtx: ModelRenderContext, matrix: mat4) {
        this.updateSkinning();

        if (this.modelShapes.shapes.length !== 0) {
            for (let i = 0; i < 3; i++) {
                const template = renderInstManager.pushTemplateRenderInst();
                template.filterKey = i;
                this.modelShapes.prepareToRender(device, renderInstManager, modelCtx, matrix, this.matrixPalette, i);
                renderInstManager.popTemplateRenderInst();
            }
        }

        if (this.modelShapes.waters.length !== 0) {
            const template = renderInstManager.pushTemplateRenderInst();
            template.filterKey = DrawStep.Waters;
            this.modelShapes.prepareToRenderWaters(device, renderInstManager, modelCtx, matrix, this.matrixPalette);
            renderInstManager.popTemplateRenderInst();
        }

        if (this.modelShapes.furs.length !== 0) {
            const template = renderInstManager.pushTemplateRenderInst();
            template.filterKey = DrawStep.Furs;
            this.modelShapes.prepareToRenderFurs(device, renderInstManager, modelCtx, matrix, this.matrixPalette);
            renderInstManager.popTemplateRenderInst();
        }
    }
    
    private updateSkinning() {
        if (!this.skinningDirty) {
            return;
        }

        // Compute matrices for rigid joints (no blending)
        for (let i = 0; i < this.model.joints.length; i++) {
            const joint = this.model.joints[i];

            // For vertices with only one joint-influence, positions are stored in joint-local space
            // as an optimization.
            mat4.copy(this.matrixPalette[joint.boneNum], this.skeletonInst!.getJointMatrix(joint.boneNum));

            // FIXME: Check beta models
        }

        // Compute matrices for coarse blending
        for (let i = 0; i < this.model.coarseBlends.length; i++) {
            const blend = this.model.coarseBlends[i];

            // For vertices with more than one joint-influence, positions are stored in model space.
            // Therefore, inverse bind translations must be applied.
            mat4.translate(scratchMtx0, this.matrixPalette[blend.joint0], this.model.invBindTranslations[blend.joint0]);
            mat4.multiplyScalar(scratchMtx0, scratchMtx0, blend.influence0);
            mat4.translate(scratchMtx1, this.matrixPalette[blend.joint1], this.model.invBindTranslations[blend.joint1]);
            mat4.multiplyScalarAndAdd(this.matrixPalette[this.model.joints.length + i], scratchMtx0, scratchMtx1, blend.influence1)
        }

        this.performFineSkinning();

        this.skinningDirty = false;
    }

    private performFineSkinning() {
        if (!this.model.hasFineSkinning) {
            return;
        }

        if (this.model.posFineSkinningPieces.length === 0) {
            return;
        }

        const boneMtx0 = scratchMtx2;
        const boneMtx1 = scratchMtx3;
        const pos = scratchVec0;

        // The original game performs fine skinning on the CPU.
        // A more appropriate place for these calculations might be in a vertex shader.
        const quant = 1 << this.model.posFineSkinningConfig!.quantizeScale;
        const dequant = 1 / quant;
        for (let i = 0; i < this.model.posFineSkinningPieces.length; i++) {
            const piece = this.model.posFineSkinningPieces[i];

            mat4.copy(boneMtx0, this.matrixPalette[piece.bone0]);
            if (!this.model.hasBetaFineSkinning) {
                mat4.translate(boneMtx0, boneMtx0, this.model.invBindTranslations[piece.bone0]);
            }
            mat4.copy(boneMtx1, this.matrixPalette[piece.bone1]);
            if (!this.model.hasBetaFineSkinning) {
                mat4.translate(boneMtx1, boneMtx1, this.model.invBindTranslations[piece.bone1]);
            }

            const src = dataSubarray(this.model.originalPosBuffer, piece.skinDataSrcOffs, 32 * piece.skinSrcBlockCount);
            const dst = dataSubarray(this.modelShapes.posBuffer, piece.skinDataSrcOffs, 32 * piece.skinSrcBlockCount);
            const weights = dataSubarray(this.model.posFineSkinningWeights!, piece.weightsSrc, 32 * piece.weightsBlockCount);
            let srcOffs = piece.skinMeOffset;
            let dstOffs = piece.skinMeOffset;
            let weightOffs = 0;
            for (let j = 0; j < piece.numVertices; j++) {
                pos[0] = src.getInt16(srcOffs) * dequant;
                pos[1] = src.getInt16(srcOffs + 2) * dequant;
                pos[2] = src.getInt16(srcOffs + 4) * dequant;

                const weight0 = weights.getUint8(weightOffs) / 128;
                const weight1 = weights.getUint8(weightOffs + 1) / 128;
                mat4.multiplyScalar(scratchMtx0, boneMtx0, weight0);
                mat4.multiplyScalarAndAdd(scratchMtx0, scratchMtx0, boneMtx1, weight1);
                vec3.transformMat4(pos, pos, scratchMtx0);

                dst.setInt16(dstOffs, pos[0] * quant);
                dst.setInt16(dstOffs + 2, pos[1] * quant);
                dst.setInt16(dstOffs + 4, pos[2] * quant);

                srcOffs += 6;
                dstOffs += 6;
                weightOffs += 2;
            }
        }

        // Rerun all display lists
        this.modelShapes.reloadVertices();
    }
}

class ModelsFile {
    private tab: DataView;
    private bin: ArrayBufferSlice;
    private models: Model[] = [];

    private constructor(private device: GfxDevice, private materialFactory: MaterialFactory, private texFetcher: TextureFetcher, private animController: SFAAnimationController, private modelVersion: ModelVersion) {
    }

    private async init(gameInfo: GameInfo, dataFetcher: DataFetcher, subdir: string) {
        const pathBase = gameInfo.pathBase;
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.tab`),
            dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.bin`),
        ]);
        this.tab = tab.createDataView();
        this.bin = bin;
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, subdir: string, device: GfxDevice, materialFactory: MaterialFactory, texFetcher: TextureFetcher, animController: SFAAnimationController, modelVersion: ModelVersion): Promise<ModelsFile> {
        const self = new ModelsFile(device, materialFactory, texFetcher, animController, modelVersion);
        await self.init(gameInfo, dataFetcher, subdir);
        return self;
    }

    public hasModel(num: number): boolean {
        if (num < 0 || num * 4 >= this.tab.byteLength) {
            return false;
        }


        return readUint32(this.tab, 0, num) !== 0;
    }

    public getNumModels(): number {
        return (this.tab.byteLength / 4)|0;
    }

    public getModel(num: number): Model {
        if (this.models[num] === undefined) {
            console.log(`Loading model #${num} ...`);
    
            const modelTabValue = readUint32(this.tab, 0, num);
            if (modelTabValue === 0) {
                throw Error(`Model #${num} not found`);
            }
    
            const modelOffs = modelTabValue & 0xffffff;
            const modelData = loadRes(this.bin.subarray(modelOffs + 0x24));
            this.models[num] = new Model(this.materialFactory, modelData, this.texFetcher, this.modelVersion);
        }

        return this.models[num];
    }
}

export class ModelFetcher {
    private files: {[subdir: string]: ModelsFile} = {};

    private constructor(private device: GfxDevice, private gameInfo: GameInfo, private texFetcher: TextureFetcher, private materialFactory: MaterialFactory, private animController: SFAAnimationController, private modelVersion: ModelVersion) {
    }

    public static async create(device: GfxDevice, gameInfo: GameInfo, dataFetcher: DataFetcher, texFetcher: Promise<TextureFetcher>, materialFactory: MaterialFactory, animController: SFAAnimationController, modelVersion: ModelVersion = ModelVersion.Final): Promise<ModelFetcher> {
        const self = new ModelFetcher(device, gameInfo, await texFetcher, materialFactory, animController, modelVersion);

        return self;
    }

    private async loadSubdir(subdir: string, dataFetcher: DataFetcher) {
        if (this.files[subdir] === undefined) {
            this.files[subdir] = await ModelsFile.create(this.gameInfo, dataFetcher, subdir, this.device, this.materialFactory, this.texFetcher, this.animController, this.modelVersion);

            // XXX: These maps require additional model files to be loaded
            if (subdir === 'shipbattle') {
                await this.loadSubdir('', dataFetcher);
            } else if (subdir === 'shop') {
                await this.loadSubdir('swaphol', dataFetcher);
            }
        }
    }

    public async loadSubdirs(subdirs: string[], dataFetcher: DataFetcher) {
        const promises = [];
        for (let subdir of subdirs) {
            promises.push(this.loadSubdir(subdir, dataFetcher));
        }

        await Promise.all(promises);
    }

    public getNumModels() {
        let result = 0;
        for (let s in this.files) {
            const file = this.files[s];
            result = Math.max(result, file.getNumModels());
        }
        return result;
    }

    private getModelsFileWithModel(modelNum: number): ModelsFile | null {
        for (let s in this.files) {
            if (this.files[s].hasModel(modelNum)) {
                return this.files[s];
            }
        }

        return null;
    }

    public getModel(num: number): Model | null {
        const file = this.getModelsFileWithModel(num);
        if (file === null) {
            console.warn(`Model ID ${num} was not found in any loaded subdirectories (${Object.keys(this.files)})`);
            return null;
        }

        return file.getModel(num);
    }

    public createModelInstance(num: number): ModelInstance {
        const model = this.getModel(num);
        if (model === null) {
            throw Error(`Model ${num} not found`);
        }
        return new ModelInstance(model);
    }
}