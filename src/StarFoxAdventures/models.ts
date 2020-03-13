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

import { SFAMaterial } from './shaders';
import * as GX from '../gx/gx_enum';
import { TextureCollection } from './textures';
import { Shader, parseShader, SFA_SHADER_FIELDS, EARLY_SFA_SHADER_FIELDS, buildMaterialFromShader, makeMaterialTexture } from './shaders';
import { LowBitReader } from './util';
import { BlockRenderer } from './blocks';

export class ModelInstance {
    private loadedVertexLayout: LoadedVertexLayout;
    private loadedVertexData: LoadedVertexData;
    private shapeHelper: GXShapeHelperGfx | null = null;
    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();
    private packetParams = new PacketParams();
    private material: SFAMaterial;
    private sceneTextureSampler: GfxSampler | null = null;

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

    private computeModelView(dst: mat4, camera: Camera, modelMatrix: mat4): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, sceneTexture: ColorTexture) {
        if (this.shapeHelper === null) {
            const bufferCoalescer = loadedDataCoalescerComboGfx(device, [this.loadedVertexData]);
            this.shapeHelper = new GXShapeHelperGfx(device, renderInstManager.gfxRenderCache, bufferCoalescer.coalescedBuffers[0], this.loadedVertexLayout, this.loadedVertexData);
        }
        
        this.packetParams.clear();

        const renderInst = renderInstManager.newRenderInst();
        this.shapeHelper.setOnRenderInst(renderInst);
        const materialOffs = this.materialHelper.allocateMaterialParams(renderInst);

        for (let i = 0; i < 8; i++) {
            const tex = this.material.textures[i];
            if (tex === undefined || tex === null) {
                this.materialParams.m_TextureMapping[i].reset();
            } else if (tex.kind === 'fb-color-downscaled-8x') {
                // TODO: Downscale to 1/8th size and apply filtering
                this.materialParams.m_TextureMapping[i].gfxTexture = sceneTexture.gfxTexture;
                if (this.sceneTextureSampler === null) {
                    this.sceneTextureSampler = device.createSampler({
                        wrapS: GfxWrapMode.REPEAT,
                        wrapT: GfxWrapMode.REPEAT,
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
            }
        }
        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialOffs, this.materialParams);
        for (let i = 0; i < this.packetParams.u_PosMtx.length; i++) {
            this.computeModelView(this.packetParams.u_PosMtx[i], viewerInput.camera, modelMatrix);
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

export class Model implements BlockRenderer {
    // There is a ModelInstance array for each draw step (opaques, translucents 1, translucents 2)
    public models: ModelInstance[][] = [];
    public joints: Joint[] = [];
    public weights: Weight[] = [];
    public yTranslate: number = 0;

    constructor(device: GfxDevice, blockData: ArrayBufferSlice, texColl: TextureCollection, earlyFields: boolean = false) {
        let offs = 0;
        const blockDv = blockData.createDataView();

        let fields: any;
        if (earlyFields) {
            fields = {
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
                hasJoints: false,
                jointOffset: 0,
                jointCount: 0,
                shaderOffset: 0x64,
                shaderCount: 0xa0, // Polygon attributes and material information
                shaderFields: EARLY_SFA_SHADER_FIELDS,
                shaderSize: 0x40,
                listOffset: 0x68,
                listCount: 0x9f,
                listSize: 0x34,
                // FIXME: Yet another format occurs in sfademo/frontend!
                // numListBits: 6, // 6 is needed for mod12; 8 is needed for early crfort?!
                numListBits: 8, // ??? should be 6 according to decompilation of demo????
                numLayersOffset: 0x3b,
                bitsOffsets: [0x74], // Whoa...
                // FIXME: There are three bitstreams, probably for opaque and transparent objects
                bitsByteCounts: [0x84],
                oldVat: true,
                hasYTranslate: false,
                oldShaders: true,
            };
        } else {
            // FIXME: This field is NOT a model type and doesn't reliably indicate
            // the type of model.
            const modelType = blockDv.getUint16(4);
            switch (modelType) {
            case 0:
                // Used in character and object models
                fields = {
                    alwaysUseTex1: false,
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
                    hasJoints: true,
                    jointOffset: 0x3c,
                    jointCount: 0xf3,
                    weightOffset: 0x54,
                    weightCount: 0xf4,
                    shaderOffset: 0x38,
                    shaderCount: 0xf8,
                    shaderFields: SFA_SHADER_FIELDS,
                    listOffset: 0xd0,
                    listCount: 0xf5,
                    listSize: 0x1c,
                    numListBits: 8,
                    bitsOffsets: [0xd4],
                    bitsByteCounts: [0xd8],
                    oldVat: false,
                    hasYTranslate: false,
                    oldShaders: false,
                };
                break;
            case 8:
            case 264:
                // Used in map blocks
                fields = {
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
                    hasJoints: false,
                    jointOffset: 0,
                    jointCount: 0,
                    shaderOffset: 0x64,
                    shaderCount: 0xa2,
                    shaderFields: SFA_SHADER_FIELDS,
                    listOffset: 0x68,
                    listCount: 0xa1, // TODO
                    listSize: 0x1c,
                    numListBits: 8,
                    bitsOffsets: [0x78, 0x7c, 0x80],
                    bitsByteCounts: [0x84, 0x86, 0x88],
                    oldVat: false,
                    hasYTranslate: true,
                    oldShaders: false,
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
        // const posCount = blockDv.getUint16(fields.posCount);
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
        // const clrCount = blockDv.getUint16(fields.clrCount);
        // console.log(`Loading ${clrCount} colors from 0x${clrOffset.toString(16)}`);
        const clrBuffer = blockData.subarray(clrOffset);

        const texcoordOffset = blockDv.getUint32(fields.texcoordOffset);
        // const texcoordCount = blockDv.getUint16(fields.texcoordCount);
        // console.log(`Loading ${coordCount} texcoords from 0x${coordOffset.toString(16)}`);
        const texcoordBuffer = blockData.subarray(texcoordOffset);

        let jointCount = 0;
        if (fields.hasJoints) {
            const jointOffset = blockDv.getUint32(fields.jointOffset);
            jointCount = blockDv.getUint8(fields.jointCount);

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

            const weightOffset = blockDv.getUint32(fields.weightOffset);
            const weightCount = blockDv.getUint8(fields.weightCount);

            this.weights = [];
            for (let i = 0; i < jointCount; i++) {
                this.weights.push({
                    joint0: i, influence0: 1, joint1: 0, influence1: 0
                });
            }
            offs = weightOffset;
            for (let i = 0; i < weightCount; i++) {
                const split = blockDv.getUint8(offs + 0x3);
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

        const shaderOffset = blockDv.getUint32(fields.shaderOffset);
        const shaderCount = blockDv.getUint8(fields.shaderCount);

        const shaders: Shader[] = [];
        offs = shaderOffset;
        const shaderFields = fields.shaderFields;
        for (let i = 0; i < shaderCount; i++) {
            const shaderBin = blockData.subarray(offs, shaderFields.size).createDataView();
            const shader = parseShader(shaderBin, shaderFields);
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
        vat[3][GX.Attr.NBT] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_NBT };
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

        const listOffset = blockDv.getUint32(fields.listOffset);
        const listCount = blockDv.getUint8(fields.listCount);
        // console.log(`Loading ${chunkCount} display lists from 0x${chunkOffset.toString(16)}`);

        const bitsOffsets = [];
        const bitsByteCounts = [];
        for (let i = 0; i < fields.bitsOffsets.length; i++) {
            bitsOffsets.push(blockDv.getUint32(fields.bitsOffsets[i]));
            bitsByteCounts.push(blockDv.getUint16(fields.bitsByteCounts[i]));
        }

        let texMtxCount = 0;
        if (fields.hasJoints) {
            texMtxCount = blockDv.getUint8(0xfa);
        }

        if (fields.hasYTranslate) {
            this.yTranslate = blockDv.getInt16(0x8e);
        } else {
            this.yTranslate = 0;
        }

        const self = this;
        function runBitstream(bitsOffset: number, drawStep: number) {
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
                case 1: // Set shader
                    curShader = shaders[bits.get(6)];
                    break;
                case 2: // Call display list
                    const listNum = bits.get(fields.numListBits);
                    if (listNum >= listCount) {
                        console.warn(`Can't draw display list #${listNum} (out of range)`);
                        continue;
                    }
                    offs = listOffset + listNum * fields.listSize;
                    const dlOffset = blockDv.getUint32(offs);
                    const dlSize = blockDv.getUint16(offs + 4);
                    const displayList = blockData.subarray(dlOffset, dlSize);
    
                    const vtxArrays: GX_Array[] = [];
                    vtxArrays[GX.Attr.POS] = { buffer: vertBuffer, offs: 0, stride: 6 /*getAttributeByteSize(vat[0], GX.Attr.POS)*/ };
                    if (fields.hasNormals) {
                        vtxArrays[GX.Attr.NRM] = { buffer: nrmBuffer, offs: 0, stride: (nrmTypeFlags & 8) != 0 ? 9 : 3 /*getAttributeByteSize(vat[0], GX.Attr.NRM)*/ };
                    }
                    vtxArrays[GX.Attr.CLR0] = { buffer: clrBuffer, offs: 0, stride: 2 /*getAttributeByteSize(vat[0], GX.Attr.CLR0)*/ };
                    for (let t = 0; t < 8; t++) {
                        vtxArrays[GX.Attr.TEX0 + t] = { buffer: texcoordBuffer, offs: 0, stride: 4 /*getAttributeByteSize(vat[0], GX.Attr.TEX0)*/ };
                    }
    
                    try {
                        const newModel = new ModelInstance(vtxArrays, vcd, vat, displayList);
                        const material = buildMaterialFromShader(device, curShader, texColl, texIds, fields.alwaysUseTex1);
                        newModel.setMaterial(material);
                        models.push(newModel);
                    } catch (e) {
                        console.warn(`Failed to create model and shader instance due to exception:`);
                        console.error(e);
                    }
                    break;
                case 3: // Set vertex attributes
                    vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.NONE;
                    for (let i = 0; i < 8; i++) {
                        vcd[GX.Attr.TEX0MTXIDX + i].type = GX.AttrType.NONE;
                    }
    
                    if (fields.hasJoints && jointCount >= 2) {
                        vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.DIRECT;
                        let texmtxNum = 0;
                        // FIXME: what is this?
                        // if (shaders[curShader].hasTexmtx01) {
                        //     vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT; 
                        //     texmtxNum++;
                        //     vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                        //     texmtxNum++;
                        // }
                        vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                        texmtxNum++;
                        for (let i = 0; i < texMtxCount; i++) {
                            vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                            texmtxNum++;
                        }
                    }
    
                    const posDesc = bits.get(1);
                    vcd[GX.Attr.POS].type = posDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
    
                    if (fields.hasNormals && (curShader.attrFlags & 1) != 0) {
                        const nrmDesc = bits.get(1);
                        if ((nrmTypeFlags & 8) != 0) {
                            vcd[GX.Attr.NRM].type = GX.AttrType.NONE;
                            vcd[GX.Attr.NBT].type = nrmDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                        } else {
                            vcd[GX.Attr.NBT].type = GX.AttrType.NONE;
                            vcd[GX.Attr.NRM].type = nrmDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                        }
                    } else {
                        vcd[GX.Attr.NRM].type = GX.AttrType.NONE;
                    }
    
                    if ((curShader.attrFlags & 2) != 0) {
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
                case 4: // Set weights (skipped by SFA block renderer)
                    const numWeights = bits.get(4);
                    for (let i = 0; i < numWeights; i++) {
                        bits.get(8);
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

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, drawStep: number) {
        if (drawStep < 0 || drawStep >= this.models.length) {
            return;
        }

        const models = this.models[drawStep];
        for (let i = 0; i < models.length; i++) {
            const trans = mat4.create();
            mat4.fromTranslation(trans, [0, this.yTranslate, 0]);
            const matrix_ = mat4.create();
            mat4.mul(matrix_, matrix, trans);
            models[i].prepareToRender(device, renderInstManager, viewerInput, matrix_, sceneTexture);
        }
    }
}