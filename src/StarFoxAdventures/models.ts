import * as Viewer from '../viewer';
import { nArray } from '../util';
import { mat4, vec3 } from 'gl-matrix';
import { GfxDevice, GfxSampler, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import { GX_VtxDesc, GX_VtxAttrFmt, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array } from '../gx/gx_displaylist';
import { GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams } from '../gx/gx_render';
import { Camera, computeViewMatrix } from '../Camera';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ColorTexture } from '../gfx/helpers/RenderTargetHelpers';
import { DataFetcher } from '../DataFetcher';
import * as GX from '../gx/gx_enum';

import { GameInfo } from './scenes';
import { SFAMaterial, ShaderAttrFlags } from './shaders';
import { TextureCollection } from './textures';
import { Shader, parseShader, ShaderFlags, BETA_MODEL_SHADER_FIELDS, SFA_SHADER_FIELDS, SFADEMO_MAP_SHADER_FIELDS, SFADEMO_MODEL_SHADER_FIELDS, buildMaterialFromShader, buildFurMaterial } from './shaders';
import { LowBitReader, dataSubarray } from './util';
import { BlockRenderer } from './blocks';
import { loadRes } from './resource';
import { FurMaps } from './fur';

export class ModelInstance {
    private loadedVertexLayout: LoadedVertexLayout;
    private loadedVertexData: LoadedVertexData;
    private shapeHelper: GXShapeHelperGfx | null = null;
    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();
    private packetParams = new PacketParams();
    private material: SFAMaterial;
    private sceneTextureSampler: GfxSampler | null = null;
    private pnMatrices: mat4[] = nArray(10, () => mat4.create());
    private furMaps?: FurMaps; // TODO: move this to a common location
    private furLayer: number = 0;
    private overrideIndMtx: (mat4 | undefined)[] = [];

    constructor(vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: ArrayBufferSlice) {
        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexLayout = vtxLoader.loadedVertexLayout;
        this.loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList);
    }

    // Caution: Material is referenced, not copied.
    public setMaterial(material: SFAMaterial) {
        this.material = material;

        this.materialHelper = new GXMaterialHelperGfx(material.material);
    }

    public setPnMatrices(mats: mat4[]) {
        this.pnMatrices = [];
        for (let i = 0; i < mats.length; i++) {
            this.pnMatrices.push(mat4.clone(mats[i]));
        }
    }

    public setFurLayer(layer: number) {
        this.furLayer = layer;
    }

    public setOverrideIndMtx(num: number, mtx?: mat4) {
        if (mtx !== undefined) {
            this.overrideIndMtx[num] = mat4.clone(mtx);
        } else {
            this.overrideIndMtx[num] = undefined;
        }
    }

    private computeModelView(dst: mat4, camera: Camera, modelMatrix: mat4): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, modelMatrix);
    }

    private scratchMtx = mat4.create();
    private modelViewMtx = mat4.create();

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, sceneTexture: ColorTexture) {
        if (this.shapeHelper === null) {
            const bufferCoalescer = loadedDataCoalescerComboGfx(device, [this.loadedVertexData]);
            this.shapeHelper = new GXShapeHelperGfx(device, renderInstManager.gfxRenderCache, bufferCoalescer.coalescedBuffers[0], this.loadedVertexLayout, this.loadedVertexData);
        }
        
        this.packetParams.clear();
        for (let i = 0; i < this.pnMatrices.length && i < this.packetParams.u_PosMtx.length; i++) {
            mat4.copy(this.packetParams.u_PosMtx[i], this.pnMatrices[i]);
        }

        const renderInst = renderInstManager.newRenderInst();
        this.shapeHelper.setOnRenderInst(renderInst);
        const materialOffs = this.materialHelper.allocateMaterialParams(renderInst);

        for (let i = 0; i < 8; i++) {
            const tex = this.material.textures[i];
            if (tex === undefined || tex === null) {
                this.materialParams.m_TextureMapping[i].reset();
            } else if (tex.kind === 'fb-color-downscaled-8x' || tex.kind === 'fb-color-downscaled-2x') {
                // TODO: Downscale to 1/8th size and apply filtering
                this.materialParams.m_TextureMapping[i].gfxTexture = sceneTexture.gfxTexture;
                if (this.sceneTextureSampler === null) {
                    this.sceneTextureSampler = device.createSampler({
                        wrapS: GfxWrapMode.CLAMP,
                        wrapT: GfxWrapMode.CLAMP,
                        minFilter: GfxTexFilterMode.BILINEAR,
                        magFilter: GfxTexFilterMode.BILINEAR,
                        mipFilter: GfxMipFilterMode.NO_MIP,
                        minLOD: 0,
                        maxLOD: 100,
                    });
                }
                this.materialParams.m_TextureMapping[i].gfxSampler = this.sceneTextureSampler;
                this.materialParams.m_TextureMapping[i].width = sceneTexture.width;
                this.materialParams.m_TextureMapping[i].height = sceneTexture.height;
                this.materialParams.m_TextureMapping[i].lodBias = 0.0;
            } else if (tex.kind === 'texture') {
                this.materialParams.m_TextureMapping[i].gfxTexture = tex.texture.gfxTexture;
                this.materialParams.m_TextureMapping[i].gfxSampler = tex.texture.gfxSampler;
                this.materialParams.m_TextureMapping[i].width = tex.texture.width;
                this.materialParams.m_TextureMapping[i].height = tex.texture.height;
                this.materialParams.m_TextureMapping[i].lodBias = 0.0;
            } else if (tex.kind === 'fur-map') {
                if (this.furMaps === undefined) {
                    this.furMaps = new FurMaps(device);
                }
                const furMap = this.furMaps.getLayer(this.furLayer);
                this.materialParams.m_TextureMapping[i].gfxTexture = furMap.gfxTexture;
                this.materialParams.m_TextureMapping[i].gfxSampler = furMap.gfxSampler;
                this.materialParams.m_TextureMapping[i].width = furMap.width;
                this.materialParams.m_TextureMapping[i].height = furMap.height;
                this.materialParams.m_TextureMapping[i].lodBias = 0.0;
            }
        }
        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);

        mat4.mul(this.scratchMtx, this.pnMatrices[0], modelMatrix);
        this.computeModelView(this.modelViewMtx, viewerInput.camera, this.scratchMtx);
        this.material.setupMaterialParams(this.materialParams, viewerInput, this.modelViewMtx);

        for (let i = 0; i < 3; i++) {
            if (this.overrideIndMtx[i] !== undefined) {
                mat4.copy(this.materialParams.u_IndTexMtx[i], this.overrideIndMtx[i]!);
            }
        }

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialOffs, this.materialParams);
        for (let i = 0; i < this.packetParams.u_PosMtx.length; i++) {
            mat4.mul(this.scratchMtx, modelMatrix, this.pnMatrices[i]);
            this.computeModelView(this.packetParams.u_PosMtx[i], viewerInput.camera, this.scratchMtx);
        }
        this.shapeHelper.fillPacketParams(this.packetParams, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }
}

interface Joint {
    parent: number;
    translation: vec3;
    worldTranslation: vec3;
}

interface Weight {
    joint0: number;
    influence0: number;
    joint1: number;
    influence1: number;
}

function readVec3(data: DataView, byteOffset: number = 0): vec3 {
    return vec3.fromValues(
        data.getFloat32(byteOffset + 0),
        data.getFloat32(byteOffset + 4),
        data.getFloat32(byteOffset + 8)
        );
}

export enum ModelVersion {
    Beta, // Demo swapcircle
    Demo, // Most demo files
    Final,
}

interface DisplayListInfo {
    offset: number;
    size: number;
    specialBitAddress: number; // Command bit address for fur/grass or fancy water
    // TODO: Also includes bounding box
}

function parseDisplayListInfo(data: DataView): DisplayListInfo {
    return {
        offset: data.getUint32(0x0),
        size: data.getUint16(0x4),
        specialBitAddress: data.getUint16(0x14),
    }
}

interface Fur {
    model: ModelInstance;
    numLayers: number;
}

export class Model implements BlockRenderer {
    // There is a ModelInstance array for each draw step (opaques, translucents 1, translucents 2)
    public models: ModelInstance[][] = [];
    public joints: Joint[] = [];
    public weights: Weight[] = [];
    public boneMatrices: mat4[] = []; // contains joint matrices followed by blended weight matrices
    public bindMatrices: mat4[] = [];
    public invBindMatrices: mat4[] = [];
    public yTranslate: number = 0;
    public modelTranslate: vec3 = vec3.create();
    public furs: Fur[] = [];

    public computeBoneMatrices() {
        this.boneMatrices = [];
        this.bindMatrices = [];
        this.invBindMatrices = [];

        // Compute joint bones
        // console.log(`computing ${this.joints.length} rigid joint bones`);
        for (let i = 0; i < this.joints.length; i++) {
            const joint = this.joints[i];
            const parentMtx = mat4.create();
            const parentWorldTrans = vec3.create();
            if (joint.parent != 0xff) {
                if (joint.parent >= i) {
                    throw Error(`Bad joint hierarchy in model`);
                }

                mat4.copy(parentMtx, this.boneMatrices[joint.parent]);
                vec3.copy(parentWorldTrans, this.joints[joint.parent].worldTranslation);
            }

            const bindTranslation = vec3.clone(joint.worldTranslation);
            if (this.modelVersion === ModelVersion.Beta) {
                vec3.sub(bindTranslation, bindTranslation, parentWorldTrans);
            }

            const bindMtx = mat4.create();
            mat4.fromTranslation(bindMtx, bindTranslation);
            this.bindMatrices.push(bindMtx);

            const invBind = mat4.create();
            mat4.invert(invBind, bindMtx);
            this.invBindMatrices.push(invBind);
            
            const mtx = mat4.create();
            mat4.fromTranslation(mtx, joint.translation);
            mat4.mul(mtx, mtx, parentMtx);
            if (this.modelVersion === ModelVersion.Beta) {
                mat4.mul(mtx, mtx, invBind);
            }
            this.boneMatrices.push(mtx);
        }

        // Compute blended bones
        // console.log(`computing ${this.weights.length} blended bones`);
        for (let i = 0; i < this.weights.length; i++) {
            const weight = this.weights[i];

            const invBind0 = this.invBindMatrices[weight.joint0];
            const invBind1 = this.invBindMatrices[weight.joint1];

            const mat0 = mat4.clone(this.boneMatrices[weight.joint0]);
            mat4.mul(mat0, mat0, invBind0);
            const mat1 = mat4.clone(this.boneMatrices[weight.joint1]);
            mat4.mul(mat1, mat1, invBind1);

            mat4.multiplyScalar(mat0, mat0, weight.influence0);
            mat4.multiplyScalar(mat1, mat1, weight.influence1);
            mat4.add(mat0, mat0, mat1);
            this.boneMatrices.push(mat0);
        }
    }

    constructor(device: GfxDevice, blockData: ArrayBufferSlice, texColl: TextureCollection, private modelVersion: ModelVersion = ModelVersion.Final) {
        let offs = 0;
        const blockDv = blockData.createDataView();

        let fields: any;
        if (this.modelVersion === ModelVersion.Beta) {
            fields = {
                isAncient: true,
                isMapBlock: false, // TODO: support map blocks
                alwaysUseTex1: true,
                shaderFields: BETA_MODEL_SHADER_FIELDS,
                hasNormals: true,
                hasBones: true,
                texOffset: 0x1c,
                posOffset: 0x24,
                nrmOffset: 0x2c, // ???
                clrOffset: 0x2c,
                texcoordOffset: 0x30,
                shaderOffset: 0x34,
                jointOffset: 0x38,
                // weightOffset: 0x3c, // ???
                listOffsets: 0x6c,
                listSizes: 0x70,
                posCount: 0x9e,
                nrmCount: 0xa0,
                clrCount: 0xa2,
                texcoordCount: 0xa4,
                texCount: 0xaa,
                jointCount: 0xab,
                // weightCount: 0xad,
                shaderCount: 0xae,
                dlOffsets: 0x88,
                dlSizes: 0x8c,
                dlInfoCount: 0xac,
                numListBits: 6,
                bitsOffsets: [0x90],
                bitsByteCounts: [0x94],
                oldVat: true,
                hasYTranslate: false,
            }
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
        } else {
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
        }

        // @0x8: data size
        // @0xc: 4x3 matrix (placeholder; always zeroed in files)
        // @0x8e: y translation (up/down)

        const texOffset = blockDv.getUint32(fields.texOffset);
        const texCount = blockDv.getUint8(fields.texCount);
        // console.log(`Loading ${texCount} texture infos from 0x${texOffset.toString(16)}`);
        const texIds: number[] = [];
        for (let i = 0; i < texCount; i++) {
            const texIdFromFile = blockDv.getUint32(texOffset + i * 4);
            texIds.push(texIdFromFile);
        }

        const posOffset = blockDv.getUint32(fields.posOffset);
        const posCount = blockDv.getUint16(fields.posCount);
        // console.log(`Loading ${posCount} positions from 0x${posOffset.toString(16)}`);
        const vertBuffer = blockData.subarray(posOffset);

        let nrmBuffer = blockData;
        let nrmTypeFlags = 0;
        if (fields.hasNormals) {
            const nrmOffset = blockDv.getUint32(fields.nrmOffset);
            nrmBuffer = blockData.subarray(nrmOffset);
            nrmTypeFlags = blockDv.getUint8(0x24);
        }

        const clrOffset = blockDv.getUint32(fields.clrOffset);
        const clrCount = blockDv.getUint16(fields.clrCount);
        // console.log(`Loading ${clrCount} colors from 0x${clrOffset.toString(16)}`);
        const clrBuffer = blockData.subarray(clrOffset);

        const texcoordOffset = blockDv.getUint32(fields.texcoordOffset);
        const texcoordCount = blockDv.getUint16(fields.texcoordCount);
        // console.log(`Loading ${texcoordCount} texcoords from 0x${texcoordCount.toString(16)}`);
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
                    translation: readVec3(blockDv, offs + 0x4),
                    worldTranslation: readVec3(blockDv, offs + 0x10),
                });
                offs += 0x1c;
            }

            if (fields.weightOffset !== undefined) {
                const weightOffset = blockDv.getUint32(fields.weightOffset);
                const weightCount = blockDv.getUint8(fields.weightCount);
                // console.log(`Loading ${weightCount} weights from offset 0x${weightOffset.toString(16)}`);

                this.weights = [];
                offs = weightOffset;
                for (let i = 0; i < weightCount; i++) {
                    const split = blockDv.getUint8(offs + 0x2);
                    const influence0 = 0.25 * split;
                    this.weights.push({
                        joint0: blockDv.getUint8(offs),
                        joint1: blockDv.getUint8(offs + 0x1),
                        influence0,
                        influence1: 1 - influence0,
                    });
                    offs += 0x4;
                }
            }

            this.computeBoneMatrices();

            // const transIsPresent = blockDv.getUint32(0xa4);
            // if (transIsPresent != 0) {
            //     console.log(`transIsPresent was 0x${transIsPresent.toString(16)} in this model`);
            //     this.modelTranslate = readVec3(blockDv, 0x44);
            //     console.log(`trans: ${this.modelTranslate}`);
            // }
        }

        const shaderOffset = blockDv.getUint32(fields.shaderOffset);
        const shaderCount = blockDv.getUint8(fields.shaderCount);
        // console.log(`Loading ${shaderCount} shaders from offset 0x${shaderOffset.toString(16)}`);

        const shaders: Shader[] = [];
        offs = shaderOffset;
        const shaderFields = fields.shaderFields;
        for (let i = 0; i < shaderCount; i++) {
            const shaderBin = blockData.subarray(offs, shaderFields.size).createDataView();
            const shader = parseShader(shaderBin, shaderFields, texIds);
            shaders.push(shader);
            offs += shaderFields.size;
        }

        const vcd: GX_VtxDesc[] = [];
        const vat: GX_VtxAttrFmt[][] = nArray(8, () => []);
        for (let i = 0; i <= GX.Attr.MAX; i++) {
            vcd[i] = { type: GX.AttrType.NONE };
            for (let j = 0; j < 8; j++) {
                vat[j][i] = { compType: GX.CompType.U8, compShift: 0, compCnt: 0 };
            }
        }
        vcd[GX.Attr.NBT] = { type: GX.AttrType.NONE };

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

        vat[5][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: fields.oldVat ? 0 : 3, compCnt: GX.CompCnt.POS_XYZ };
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

        const dlInfos: DisplayListInfo[] = [];
        const dlInfoCount = blockDv.getUint8(fields.dlInfoCount);
        // console.log(`Loading ${dlInfoCount} display lists...`);
        if (this.modelVersion === ModelVersion.Beta) {
            for (let i = 0; i < dlInfoCount; i++) {
                const dlOffsetsOffs = blockDv.getUint32(fields.dlOffsets);
                const dlSizesOffs = blockDv.getUint32(fields.dlSizes);

                const dlOffset = blockDv.getUint32(dlOffsetsOffs + i * 4);
                const dlSize = blockDv.getUint16(dlSizesOffs + i * 2);
                dlInfos.push({
                    offset: dlOffset,
                    size: dlSize,
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

        const bitsOffsets = [];
        const bitsByteCounts = [];
        for (let i = 0; i < fields.bitsOffsets.length; i++) {
            bitsOffsets.push(blockDv.getUint32(fields.bitsOffsets[i]));
            bitsByteCounts.push(blockDv.getUint16(fields.bitsByteCounts[i]));
        }

        let texMtxCount = 0;
        if (fields.hasBones) {
            if (fields.isAncient) {
                texMtxCount = 1; // ??? breaks some models... where is this field?
            } else {
                texMtxCount = blockDv.getUint8(0xfa);
            }
        }

        if (fields.hasYTranslate) {
            this.yTranslate = blockDv.getInt16(0x8e);
        } else {
            this.yTranslate = 0;
        }

        this.computeBoneMatrices();

        const pnMatrices = nArray(0x10, () => mat4.create());

        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS] = { buffer: vertBuffer, offs: 0, stride: 6 /*getAttributeByteSize(vat[0], GX.Attr.POS)*/ };
        if (fields.hasNormals) {
            vtxArrays[GX.Attr.NRM] = { buffer: nrmBuffer, offs: 0, stride: (nrmTypeFlags & 8) != 0 ? 9 : 3 /*getAttributeByteSize(vat[0], GX.Attr.NRM)*/ };
        }
        vtxArrays[GX.Attr.CLR0] = { buffer: clrBuffer, offs: 0, stride: 2 /*getAttributeByteSize(vat[0], GX.Attr.CLR0)*/ };
        for (let t = 0; t < 8; t++) {
            vtxArrays[GX.Attr.TEX0 + t] = { buffer: texcoordBuffer, offs: 0, stride: 4 /*getAttributeByteSize(vat[0], GX.Attr.TEX0)*/ };
        }

        const self = this;

        function runFurBitstream(bitsOffset: number, bitAddress: number) {
            // console.log(`running fur bitstream at offset 0x${bitsOffset.toString(16)} bit-address 0x${bitAddress.toString(16)}`);

            const bits = new LowBitReader(blockDv, bitsOffset);
            bits.seekBit(bitAddress);

            bits.drop(4);
            const shaderNum = bits.get(6);
            const shader = shaders[shaderNum];
            const material = buildFurMaterial(device, shader, texColl, texIds, fields.alwaysUseTex1, fields.isMapBlock);

            bits.drop(4);
            { // Set descriptor
                // console.log(`Setting descriptor`);
                vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.NONE;
                for (let i = 0; i < 8; i++) {
                    vcd[GX.Attr.TEX0MTXIDX + i].type = GX.AttrType.NONE;
                }

                if (fields.hasBones && jointCount >= 2) {
                    vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.DIRECT;

                    let texmtxNum = 0;
                    if (shader.hasAuxTex0 || shader.hasAuxTex1) {
                        if (shader.auxTexNum !== 0xffffffff) {
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
            }

            bits.drop(4);
            const num = bits.get(4);
            for (let i = 0; i < num; i++) {
                bits.drop(8);
            }

            bits.drop(4);
            const listNum = bits.get(8);
            const dlInfo = dlInfos[listNum];
            // console.log(`Calling DL for fur #${listNum} at offset 0x${dlInfo.offset.toString(16)}, size 0x${dlInfo.size.toString(16)}`);
            const displayList = blockData.subarray(dlInfo.offset, dlInfo.size);

            const newModel = new ModelInstance(vtxArrays, vcd, vat, displayList);
            newModel.setMaterial(material);
            newModel.setPnMatrices(pnMatrices);

            let numFurLayers;
            if (shader.flags & ShaderFlags.ShortFur) {
                numFurLayers = 4;
            } else if (shader.flags & ShaderFlags.MediumFur) {
                numFurLayers = 8;
            } else { // curShader.flags & ShaderFlags.LongFur
                numFurLayers = 16;
            }

            self.furs.push({ model: newModel, numLayers: numFurLayers });
        }

        function runBitstream(bitsOffset: number, drawStep: number) {
            // console.log(`running bitstream at offset 0x${bitsOffset.toString(16)}`);
            const models: ModelInstance[] = [];
            self.models[drawStep] = models;

            if (bitsOffset === 0) {
                return;
            }

            const bits = new LowBitReader(blockDv, bitsOffset);
            let done = false;
            let curShader = shaders[0];
            while (!done) {
                const opcode = bits.get(4);
                switch (opcode) {
                case 1: { // Set shader
                    const shaderNum = bits.get(6);
                    // console.log(`Setting shader #${shaderNum}`);
                    curShader = shaders[shaderNum];
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
                        if ((curShader.flags & ShaderFlags.DevGeometry) != 0) {
                            // Draw call disabled by shader. Contains developer geometry (representations of kill planes, invisible walls, etc.)
                            // TODO: Implement an option to view this geometry
                        } else {
                            const newModel = new ModelInstance(vtxArrays, vcd, vat, displayList);
                            const material = buildMaterialFromShader(device, curShader, texColl, texIds, fields.alwaysUseTex1, fields.isMapBlock);
                            newModel.setMaterial(material);
                            newModel.setPnMatrices(pnMatrices);
                            models.push(newModel);
                        }

                        if (drawStep === 0 && (curShader.flags & (ShaderFlags.ShortFur | ShaderFlags.MediumFur | ShaderFlags.LongFur))) {
                            runFurBitstream(bitsOffset, dlInfo.specialBitAddress);
                        }
                    } catch (e) {
                        console.warn(`Failed to create model and shader instance due to exception:`);
                        console.error(e);
                    }
                    break;
                }
                case 3: { // Set descriptor
                    // console.log(`Setting descriptor`);
                    vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.NONE;
                    for (let i = 0; i < 8; i++) {
                        vcd[GX.Attr.TEX0MTXIDX + i].type = GX.AttrType.NONE;
                    }
    
                    if (fields.hasBones && jointCount >= 2) {
                        vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.DIRECT;

                        let texmtxNum = 0;
                        if (curShader.hasAuxTex0 || curShader.hasAuxTex1) {
                            if (curShader.auxTexNum !== 0xffffffff) {
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
    
                    if (fields.hasNormals && (curShader.attrFlags & ShaderAttrFlags.NRM)) {
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
    
                    if (curShader.attrFlags & ShaderAttrFlags.CLR) {
                        const clr0Desc = bits.get(1);
                        vcd[GX.Attr.CLR0].type = clr0Desc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                    } else {
                        vcd[GX.Attr.CLR0].type = GX.AttrType.NONE;
                    }
    
                    const texCoordDesc = bits.get(1);
                    if (curShader.layers.length > 0) {
                        // Note: texCoordDesc applies to all texture coordinates in the vertex
                        for (let t = 0; t < 8; t++) {
                            if (t < curShader.layers.length) {
                                vcd[GX.Attr.TEX0 + t].type = texCoordDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                            } else {
                                vcd[GX.Attr.TEX0 + t].type = GX.AttrType.NONE;
                            }
                        }
                    }
                    break;
                }
                case 4: // Set weights (skipped by SFA block renderer)
                    const numBones = bits.get(4);
                    if (numBones > self.boneMatrices.length) {
                        // Skip
                        for (let i = 0; i < numBones; i++) {
                            bits.get(8);
                        }
                    } else {
                        self.computeBoneMatrices();
                        for (let i = 0; i < numBones; i++) {
                            const boneId = bits.get(8);
                            if (boneId >= self.boneMatrices.length) {
                                throw Error(`Invalid bone ID ${boneId} / ${self.boneMatrices.length}`);
                            }
                            pnMatrices[i] = self.boneMatrices[boneId];
                        }
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

        runBitstream(bitsOffsets[0], 0); // Opaques
        for (let i = 1; i < bitsOffsets.length; i++) {
            runBitstream(bitsOffsets[i], i); // Translucents and waters
        }
    }

    public getNumDrawSteps() {
        return this.models.length;
    }

    private scratchMtx = mat4.create();

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, drawStep: number) {
        if (drawStep < 0 || drawStep >= this.models.length) {
            return;
        }

        const models = this.models[drawStep];
        for (let i = 0; i < models.length; i++) {
            mat4.fromTranslation(this.scratchMtx, [0, this.yTranslate, 0]);
            mat4.translate(this.scratchMtx, this.scratchMtx, this.modelTranslate);
            mat4.mul(this.scratchMtx, matrix, this.scratchMtx);
            models[i].prepareToRender(device, renderInstManager, viewerInput, this.scratchMtx, sceneTexture);
        }
    }

    public prepareToRenderFurs(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture) {
        for (let i = 0; i < this.furs.length; i++) {
            const fur = this.furs[i];

            for (let j = 0; j < fur.numLayers; j++) {
                mat4.fromTranslation(this.scratchMtx, [0, this.yTranslate, 0]);
                mat4.translate(this.scratchMtx, this.scratchMtx, this.modelTranslate);
                mat4.translate(this.scratchMtx, this.scratchMtx, [0, 0.4 * (j + 1), 0]);
                mat4.mul(this.scratchMtx, matrix, this.scratchMtx);
                fur.model.setFurLayer(j);
                const m00 = (j + 1) / 16 * 0.5;
                const m11 = m00;
                const indtexmtx = mat4.fromValues(
                    m00, 0.0, 0.0, 0.0,
                    0.0, m11, 0.0, 0.0,
                    0.0, 0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0, 0.0
                );
                fur.model.setOverrideIndMtx(0, indtexmtx);
                fur.model.prepareToRender(device, renderInstManager, viewerInput, this.scratchMtx, sceneTexture);
                fur.model.setOverrideIndMtx(0, undefined);
            }
        }
    }
}

export class ModelCollection {
    private modelsTab: DataView;
    private modelsBin: ArrayBufferSlice;
    private models: Model[] = [];

    constructor(private texColl: TextureCollection, private gameInfo: GameInfo) {
    }

    public async create(dataFetcher: DataFetcher, subdir: string) {
        const pathBase = this.gameInfo.pathBase;
        const [modelsTab, modelsBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.tab`),
            dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.bin`),
        ]);
        this.modelsTab = modelsTab.createDataView();
        this.modelsBin = modelsBin;
    }

    public loadModel(device: GfxDevice, num: number): Model {
        if (this.models[num] === undefined) {
            console.log(`Loading model #${num} ...`);
    
            const modelTabValue = this.modelsTab.getUint32(num * 4);
            if (modelTabValue === 0) {
                throw Error(`Model #${num} not found`);
            }
    
            const modelOffs = modelTabValue & 0xffffff;
            const modelData = loadRes(this.modelsBin.subarray(modelOffs + 0x24));
            this.models[num] = new Model(device, modelData, this.texColl);
        }

        return this.models[num];
    }
}