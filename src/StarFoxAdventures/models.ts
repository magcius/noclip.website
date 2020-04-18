import * as Viewer from '../viewer';
import { nArray } from '../util';
import { mat4, vec3 } from 'gl-matrix';
import { GfxDevice, GfxSampler, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode, GfxVertexBufferDescriptor, GfxInputState, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxIndexBufferDescriptor, GfxBufferFrequencyHint } from '../gfx/platform/GfxPlatform';
import { GX_VtxDesc, GX_VtxAttrFmt, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array, VtxLoader, VertexAttributeInput, LoadedVertexPacket, compilePartialVtxLoader } from '../gx/gx_displaylist';
import { PacketParams, GXMaterialHelperGfx, MaterialParams, createInputLayout, ub_PacketParams, u_PacketParamsBufferSize, fillPacketParamsData, ColorKind } from '../gx/gx_render';
import { Camera, computeViewMatrix } from '../Camera';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { ColorTexture } from '../gfx/helpers/RenderTargetHelpers';
import { DataFetcher } from '../DataFetcher';
import * as GX from '../gx/gx_enum';

import { GameInfo } from './scenes';
import { SFAMaterial, ShaderAttrFlags } from './shaders';
import { SFAAnimationController } from './animation';
import { Shader, parseShader, ShaderFlags, BETA_MODEL_SHADER_FIELDS, SFA_SHADER_FIELDS, SFADEMO_MAP_SHADER_FIELDS, SFADEMO_MODEL_SHADER_FIELDS, MaterialFactory } from './shaders';
import { LowBitReader, dataSubarray, ViewState, arrayBufferSliceFromDataView, dataCopy, readVec3, getCamPos } from './util';
import { BlockRenderer } from './blocks';
import { loadRes } from './resource';
import { GXMaterial } from '../gx/gx_material';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { TextureFetcher } from './textures';
import { colorNewFromRGBA, Color, White, colorCopy } from '../Color';

class MyShapeHelper {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    private zeroBuffer: GfxBuffer | null = null;
    private vertexBuffers: GfxBuffer[] = [];
    private indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData, dynamicVertices: boolean, dynamicIndices: boolean) {
        let usesZeroBuffer = false;
        for (let attrInput: VertexAttributeInput = 0; attrInput < VertexAttributeInput.COUNT; attrInput++) {
            const attrib = loadedVertexLayout.singleVertexInputLayouts.find((attrib) => attrib.attrInput === attrInput);
            if (attrib === undefined) {
                usesZeroBuffer = true;
                break;
            }
        }

        const buffers: GfxVertexBufferDescriptor[] = [];
        for (let i = 0; i < loadedVertexData.vertexBuffers.length; i++) {
            const vertexBuffer = device.createBuffer((loadedVertexData.vertexBuffers[i].byteLength + 3) / 4, GfxBufferUsage.VERTEX,
                dynamicVertices ? GfxBufferFrequencyHint.DYNAMIC : GfxBufferFrequencyHint.STATIC);
            this.vertexBuffers.push(vertexBuffer);

            buffers.push({
                buffer: vertexBuffer,
                byteOffset: 0,
            });
        }

        if (usesZeroBuffer) {
            // TODO(jstpierre): Move this to a global somewhere?
            this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(16).buffer);
            buffers.push({
                buffer: this.zeroBuffer,
                byteOffset: 0,
            });
        }

        this.inputLayout = createInputLayout(device, cache, loadedVertexLayout);

        this.indexBuffer = device.createBuffer((loadedVertexData.indexData.byteLength + 3) / 4, GfxBufferUsage.INDEX,
            dynamicIndices ? GfxBufferFrequencyHint.DYNAMIC : GfxBufferFrequencyHint.STATIC);

        const indexBufferDesc: GfxIndexBufferDescriptor = {
            buffer: this.indexBuffer,
            byteOffset: 0,
        };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBufferDesc);

        this.uploadData(device, true, true);
    }

    public uploadData(device: GfxDevice, uploadVertices: boolean, uploadIndices: boolean) {
        const hostAccessPass = device.createHostAccessPass();

        if (uploadVertices) {
            for (let i = 0; i < this.loadedVertexData.vertexBuffers.length; i++) {
                hostAccessPass.uploadBufferData(this.vertexBuffers[i], 0, new Uint8Array(this.loadedVertexData.vertexBuffers[i]));
            }
        }

        if (uploadIndices) {
            hostAccessPass.uploadBufferData(this.indexBuffer, 0, new Uint8Array(this.loadedVertexData.indexData));
        }

        device.submitPass(hostAccessPass);
    }

    public setOnRenderInst(renderInst: GfxRenderInst, packet: LoadedVertexPacket | null = null): void {
        renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        if (packet !== null)
            renderInst.drawIndexes(packet.indexCount, packet.indexOffset);
        else
            renderInst.drawIndexes(this.loadedVertexData.totalIndexCount);
    }

    public fillPacketParams(packetParams: PacketParams, renderInst: GfxRenderInst): void {
        let offs = renderInst.getUniformBufferOffset(ub_PacketParams);
        const d = renderInst.mapUniformBufferF32(ub_PacketParams);
        fillPacketParamsData(d, offs, packetParams);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        if (this.zeroBuffer !== null)
            device.destroyBuffer(this.zeroBuffer);
    }
}

export class Shape {
    private vtxLoader: VtxLoader;
    private loadedVertexData: LoadedVertexData;

    private shapeHelper: MyShapeHelper | null = null;
    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();
    private packetParams = new PacketParams();
    private material: SFAMaterial;
    private sceneTextureSampler: GfxSampler | null = null;
    private furLayer: number = 0;
    private overrideIndMtx: (mat4 | undefined)[] = [];
    private scratchMtx = mat4.create();
    private viewState: ViewState | undefined;
    private gxMaterial: GXMaterial | undefined;
    private verticesDirty = true;

    private pnMatrixMap: number[] = nArray(10, () => 0);
    private hasFineSkinning = false;
    public hasBetaFineSkinning = false;

    constructor(private device: GfxDevice, private vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], private displayList: ArrayBufferSlice, private animController: SFAAnimationController, private isDynamic: boolean, public isDevGeometry: boolean) {
        this.vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexData = this.vtxLoader.parseDisplayList(displayList);
        this.vtxLoader = compilePartialVtxLoader(this.vtxLoader, this.loadedVertexData);
        this.reloadVertices();
    }

    public reloadVertices() {
        this.vtxLoader.loadVertexData(this.loadedVertexData, this.vtxArrays);
        this.verticesDirty = true;
    }

    // Caution: Material is referenced, not copied.
    public setMaterial(material: SFAMaterial) {
        this.material = material;
        this.updateMaterialHelper();
    }

    private updateMaterialHelper() {
        if (this.gxMaterial !== this.material.gxMaterial) {
            this.gxMaterial = this.material.gxMaterial;
            this.materialHelper = new GXMaterialHelperGfx(this.gxMaterial);
        }
    }

    public setPnMatrixMap(pnMatrixMap: number[], hasFineSkinning: boolean) {
        for (let i = 0; i < pnMatrixMap.length; i++) {
            this.pnMatrixMap[i] = pnMatrixMap[i];
        }
        this.hasFineSkinning = hasFineSkinning;
    }

    public setFurLayer(layer: number) {
        this.furLayer = layer;
    }

    public setOverrideIndMtx(num: number, mtx?: mat4) {
        if (mtx !== undefined) {
            if (this.overrideIndMtx[num] !== undefined) {
                mat4.copy(this.overrideIndMtx[num]!, mtx);
            } else {
                this.overrideIndMtx[num] = mat4.clone(mtx);
            }
        } else {
            this.overrideIndMtx[num] = undefined;
        }
    }

    private computeModelView(dst: mat4, camera: Camera, modelMatrix: mat4): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, sceneTexture: ColorTexture, boneMatrices: mat4[], modelViewState: ModelViewState) {
        this.updateMaterialHelper();

        if (this.shapeHelper === null) {
            this.shapeHelper = new MyShapeHelper(device, renderInstManager.gfxRenderCache,
                this.vtxLoader.loadedVertexLayout, this.loadedVertexData, this.isDynamic, false);
            this.verticesDirty = false;
        } else if (this.verticesDirty) {
            this.shapeHelper.uploadData(device, true, false);
            this.verticesDirty = false;
        }

        this.packetParams.clear();

        const renderInst = renderInstManager.newRenderInst();
        this.shapeHelper.setOnRenderInst(renderInst);
        const materialOffs = this.materialHelper.allocateMaterialParams(renderInst);

        for (let i = 0; i < 8; i++) {
            const tex = this.material.getTexture(i);
            
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
                const furMap = this.material.factory.getFurFactory().getLayer(this.furLayer);
                this.materialParams.m_TextureMapping[i].gfxTexture = furMap.gfxTexture;
                this.materialParams.m_TextureMapping[i].gfxSampler = furMap.gfxSampler;
                this.materialParams.m_TextureMapping[i].width = furMap.width;
                this.materialParams.m_TextureMapping[i].height = furMap.height;
                this.materialParams.m_TextureMapping[i].lodBias = 0.0;
            }
        }
        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);

        if (this.viewState === undefined) {
            this.viewState = {
                viewerInput,
                animController: this.animController,
                modelViewMtx: mat4.create(),
                invModelViewMtx: mat4.create(),
                outdoorAmbientColor: colorNewFromRGBA(1.0, 1.0, 1.0, 1.0),
            };
        }

        this.viewState.viewerInput = viewerInput;
        this.viewState.outdoorAmbientColor = this.material.factory.getAmbientColor(modelViewState.ambienceNum);

        mat4.mul(this.scratchMtx, boneMatrices[this.pnMatrixMap[0]], modelMatrix);
        this.computeModelView(this.viewState.modelViewMtx, viewerInput.camera, this.scratchMtx);
        mat4.invert(this.viewState.invModelViewMtx, this.viewState.modelViewMtx);

        this.material.setupMaterialParams(this.materialParams, this.viewState);

        // XXX: test lighting
        // colorCopy(this.materialParams.u_Color[ColorKind.MAT0], White);
        // this.materialParams.u_Lights[0].Position = vec3.create(); // All light information is in view space. This centers the light on the camera.
        // this.materialParams.u_Lights[0].Color = colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);
        // this.materialParams.u_Lights[0].CosAtten = vec3.fromValues(1.0, 0.0, 0.0);
        // this.materialParams.u_Lights[0].DistAtten = vec3.fromValues(1.0, 1/800, 1/800000);

        for (let i = 0; i < 3; i++) {
            if (this.overrideIndMtx[i] !== undefined) {
                mat4.copy(this.materialParams.u_IndTexMtx[i], this.overrideIndMtx[i]!);
            }
        }

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialOffs, this.materialParams);
        for (let i = 0; i < this.packetParams.u_PosMtx.length; i++) {
            // PNMTX 9 is used for fine-skinned vertices in models with fine-skinning enabled.
            if (this.hasFineSkinning && i === 9) {
                mat4.identity(this.scratchMtx);
            } else {
                mat4.copy(this.scratchMtx, boneMatrices[this.pnMatrixMap[i]]);
            }

            mat4.mul(this.scratchMtx, modelMatrix, this.scratchMtx);

            this.computeModelView(this.packetParams.u_PosMtx[i], viewerInput.camera, this.scratchMtx);
        }
        this.shapeHelper.fillPacketParams(this.packetParams, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }
}

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
    Beta, // Demo swapcircle
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

interface Fur {
    shape: Shape;
    numLayers: number;
}

interface Water {
    shape: Shape;
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

    private scratchMtx = mat4.create();
    private scratchMtx2 = mat4.create();

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, boneMatrices: mat4[], drawStep: number, modelViewState: ModelViewState) {
        if (drawStep < 0 || drawStep >= this.shapes.length) {
            return;
        }

        const shapes = this.shapes[drawStep];
        for (let i = 0; i < shapes.length; i++) {
            if (shapes[i].isDevGeometry && !modelViewState.showDevGeometry) {
                continue;
            }

            mat4.fromTranslation(this.scratchMtx, [0, this.model.yTranslate, 0]);
            mat4.translate(this.scratchMtx, this.scratchMtx, this.model.modelTranslate);
            mat4.mul(this.scratchMtx, matrix, this.scratchMtx);
            shapes[i].prepareToRender(device, renderInstManager, viewerInput, this.scratchMtx, sceneTexture, boneMatrices, modelViewState);
        }
    }
    
    public prepareToRenderWaters(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, boneMatrices: mat4[], modelViewState: ModelViewState) {
        for (let i = 0; i < this.waters.length; i++) {
            const water = this.waters[i];

            mat4.fromTranslation(this.scratchMtx, [0, this.model.yTranslate, 0]);
            mat4.translate(this.scratchMtx, this.scratchMtx, this.model.modelTranslate);
            mat4.mul(this.scratchMtx, matrix, this.scratchMtx);
            water.shape.prepareToRender(device, renderInstManager, viewerInput, this.scratchMtx, sceneTexture, boneMatrices, modelViewState);
        }
    }

    public prepareToRenderFurs(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, boneMatrices: mat4[], modelViewState: ModelViewState) {
        for (let i = 0; i < this.furs.length; i++) {
            const fur = this.furs[i];

            for (let j = 0; j < fur.numLayers; j++) {
                mat4.fromTranslation(this.scratchMtx, [0, this.model.yTranslate, 0]);
                mat4.translate(this.scratchMtx, this.scratchMtx, this.model.modelTranslate);
                mat4.translate(this.scratchMtx, this.scratchMtx, [0, 0.4 * (j + 1), 0]);
                mat4.mul(this.scratchMtx, matrix, this.scratchMtx);
                fur.shape.setFurLayer(j);
                const m00 = (j + 1) / 16 * 0.5;
                const m11 = m00;
                this.scratchMtx2 = mat4.fromValues(
                    m00, 0.0, 0.0, 0.0,
                    0.0, m11, 0.0, 0.0,
                    0.0, 0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0, 0.0
                );
                fur.shape.setOverrideIndMtx(0, this.scratchMtx2);
                fur.shape.prepareToRender(device, renderInstManager, viewerInput, this.scratchMtx, sceneTexture, boneMatrices, modelViewState);
                fur.shape.setOverrideIndMtx(0, undefined);
            }
        }
    }
}

export class Model {
    private createModelShapes: CreateModelShapesFunc;
    private sharedModelShapes: ModelShapes | null = null;

    public modelData: DataView;

    public joints: Joint[] = [];
    public coarseBlends: CoarseBlend[] = [];
    public jointTfMatrices: mat4[] = [];
    public bindMatrices: mat4[] = [];
    public invBindMatrices: mat4[] = [];

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

    constructor(device: GfxDevice,
        private materialFactory: MaterialFactory,
        blockData: ArrayBufferSlice,
        texFetcher: TextureFetcher,
        private animController: SFAAnimationController,
        public modelVersion: ModelVersion = ModelVersion.Final
    ) {
        let offs = 0;
        const blockDv = blockData.createDataView();
        this.modelData = blockDv;

        let fields: any;
        if (this.modelVersion === ModelVersion.Beta) {
            fields = {
                isBeta: true,
                isMapBlock: false, // TODO: support map blocks
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
        } else { // this.modelVersion === ModelVersion.Final
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

            this.jointTfMatrices = nArray(this.joints.length, () => mat4.create());
            this.bindMatrices = nArray(this.joints.length, () => mat4.create());
            this.invBindMatrices = nArray(this.joints.length, () => mat4.create());
            for (let i = 0; i < this.joints.length; i++) {
                const joint = this.joints[i];
                if (joint.boneNum !== i) {
                    throw Error(`wtf? joint's bone number doesn't match its index!`);
                }

                mat4.fromTranslation(this.jointTfMatrices[i], joint.translation);
                mat4.fromTranslation(this.bindMatrices[i], joint.bindTranslation);
                mat4.invert(this.invBindMatrices[i], this.bindMatrices[i]);
            }
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

        this.materials = [];

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

        const self = this;

        function readVertexDesc(bits: LowBitReader, shader: Shader): GX_VtxDesc[] {
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

        function runSpecialBitstream(bitsOffset: number, bitAddress: number, buildSpecialMaterial: BuildMaterialFunc, posBuffer: DataView): Shape {
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
            const newShape = new Shape(device, vtxArrays, vcd, vat, displayList, self.animController, self.hasFineSkinning, false);
            newShape.setMaterial(material);
            newShape.setPnMatrixMap(pnMatrixMap, self.hasFineSkinning);

            return newShape;
        }

        function runBitstream(modelShapes: ModelShapes, bitsOffset: number, drawStep: number, posBuffer: DataView) {
            // console.log(`running bitstream at offset 0x${bitsOffset.toString(16)}`);
            modelShapes.shapes[drawStep] = [];
            const shapes = modelShapes.shapes[drawStep];

            if (bitsOffset === 0) {
                return;
            }

            let curShader = shaders[0];
            let curMaterial: SFAMaterial | undefined = undefined;
            function setShader(num: number) {
                curShader = shaders[num];
                if (self.materials[num] === undefined) {
                    self.materials[num] = self.materialFactory.buildMaterial(curShader, texFetcher, fields.isMapBlock);
                }
                curMaterial = self.materials[num];
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
                            const newShape = runSpecialBitstream(bitsOffset, dlInfo.specialBitAddress, self.materialFactory.buildWaterMaterial.bind(self.materialFactory), posBuffer);
                            modelShapes.waters.push({ shape: newShape });
                        } else {
                            const vtxArrays = getVtxArrays(posBuffer);
                            const newShape = new Shape(device, vtxArrays, vcd, vat, displayList, self.animController, self.hasFineSkinning, !!(curShader.flags & ShaderFlags.DevGeometry));
                            newShape.setMaterial(curMaterial!);
                            newShape.setPnMatrixMap(pnMatrixMap, self.hasFineSkinning);
                            shapes.push(newShape);

                            if (drawStep === 0 && (curShader.flags & (ShaderFlags.ShortFur | ShaderFlags.MediumFur | ShaderFlags.LongFur))) {
                                const newShape = runSpecialBitstream(bitsOffset, dlInfo.specialBitAddress, self.materialFactory.buildFurMaterial.bind(self.materialFactory), posBuffer);

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

export interface ModelViewState {
    showDevGeometry: boolean;
    ambienceNum: number;
}

export class ModelInstance implements BlockRenderer {
    private modelShapes: ModelShapes;

    private jointPoseMatrices: mat4[] = [];
    public boneMatrices: mat4[] = [];
    private skeletonDirty: boolean = true;
    private amap: DataView;

    constructor(public model: Model) {
        const numBones = this.model.joints.length + this.model.coarseBlends.length;
        if (numBones !== 0) {
            this.jointPoseMatrices = nArray(this.model.joints.length, () => mat4.create());
            this.boneMatrices = nArray(numBones, () => mat4.create());
        } else {
            this.boneMatrices = [mat4.create()];
        }

        this.modelShapes = model.createInstanceShapes();
        this.updateBoneMatrices();
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
        for (let i = 0; i < this.jointPoseMatrices.length; i++) {
            mat4.identity(this.jointPoseMatrices[i]);
        }
        this.skeletonDirty = true;
    }
    
    public setJointPose(jointNum: number, mtx: mat4) {
        if (jointNum < 0 || jointNum >= this.jointPoseMatrices.length) {
            return;
        }

        mat4.copy(this.jointPoseMatrices[jointNum], mtx);
        this.skeletonDirty = true;
    }
    
    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, drawStep: number, modelViewState: ModelViewState) {
        this.updateBoneMatrices();
        this.modelShapes.prepareToRender(device, renderInstManager, viewerInput, matrix, sceneTexture, this.boneMatrices, drawStep, modelViewState);
    }
    
    public prepareToRenderWaters(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, modelViewState: ModelViewState) {
        this.updateBoneMatrices();
        this.modelShapes.prepareToRenderWaters(device, renderInstManager, viewerInput, matrix, sceneTexture, this.boneMatrices, modelViewState);
    }
    
    public prepareToRenderFurs(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, sceneTexture: ColorTexture, modelViewState: ModelViewState) {
        this.updateBoneMatrices();
        this.modelShapes.prepareToRenderFurs(device, renderInstManager, viewerInput, matrix, sceneTexture, this.boneMatrices, modelViewState);
    }

    private scratch0 = mat4.create();
    private scratch1 = mat4.create();
    
    private updateBoneMatrices() {
        if (!this.skeletonDirty) {
            return;
        }

        // Compute joint bones
        // console.log(`computing ${this.joints.length} rigid joint bones`);
        for (let i = 0; i < this.model.joints.length; i++) {
            const joint = this.model.joints[i];

            const boneMtx = this.boneMatrices[joint.boneNum];
            mat4.identity(boneMtx);
            if (this.model.hasBetaFineSkinning) {
                mat4.mul(boneMtx, boneMtx, this.model.invBindMatrices[joint.boneNum]);
            }

            if (!this.model.hasBetaFineSkinning) {
                // FIXME: Use this code for beta models with fine skinning
                mat4.mul(boneMtx, this.jointPoseMatrices[joint.boneNum], boneMtx);
                mat4.mul(boneMtx, this.model.jointTfMatrices[joint.boneNum], boneMtx);
                if (joint.parent != 0xff) {
                    mat4.mul(boneMtx, this.boneMatrices[joint.parent], boneMtx);
                }
            } else {
                // FIXME: figure out what is broken about fine-skinned beta models that the following code is needed
                let jointWalker = joint;
                while (true) {
                    mat4.mul(boneMtx, this.jointPoseMatrices[jointWalker.boneNum], boneMtx);
                    mat4.mul(boneMtx, this.model.jointTfMatrices[jointWalker.boneNum], boneMtx);
                    if (jointWalker.parent === 0xff) {
                        break;
                    }
                    jointWalker = this.model.joints[jointWalker.parent];
                }
            }
        }

        // Compute coarse blended bones
        // console.log(`computing ${this.weights.length} blended bones`);
        for (let i = 0; i < this.model.coarseBlends.length; i++) {
            const blend = this.model.coarseBlends[i];

            mat4.copy(this.scratch0, this.boneMatrices[blend.joint0]);
            mat4.mul(this.scratch0, this.scratch0, this.model.invBindMatrices[blend.joint0]);
            mat4.multiplyScalar(this.scratch0, this.scratch0, blend.influence0);
            mat4.copy(this.scratch1, this.boneMatrices[blend.joint1]);
            mat4.mul(this.scratch1, this.scratch1, this.model.invBindMatrices[blend.joint1]);
            mat4.multiplyScalar(this.scratch1, this.scratch1, blend.influence1);

            const boneMtx = this.boneMatrices[this.model.joints.length + i];
            mat4.add(boneMtx, this.scratch0, this.scratch1);
        }

        this.performFineSkinning();

        this.skeletonDirty = false;
    }

    private performFineSkinning() {
        if (!this.model.hasFineSkinning) {
            return;
        }

        if (this.model.posFineSkinningPieces.length === 0) {
            return;
        }

        const boneMtx0 = mat4.create();
        const boneMtx1 = mat4.create();
        const pos = vec3.create();

        // The original game performs fine skinning on the CPU.
        // A more appropriate place for these calculations might be in a vertex shader.
        const quant = 1 << this.model.posFineSkinningConfig!.quantizeScale;
        const dequant = 1 / quant;
        for (let i = 0; i < this.model.posFineSkinningPieces.length; i++) {
            const piece = this.model.posFineSkinningPieces[i];

            mat4.copy(boneMtx0, this.boneMatrices[piece.bone0]);
            if (!this.model.hasBetaFineSkinning) {
                mat4.mul(boneMtx0, boneMtx0, this.model.invBindMatrices[piece.bone0]);
            }
            mat4.copy(boneMtx1, this.boneMatrices[piece.bone1]);
            if (!this.model.hasBetaFineSkinning) {
                mat4.mul(boneMtx1, boneMtx1, this.model.invBindMatrices[piece.bone1]);
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
                mat4.copy(this.scratch0, boneMtx0);
                mat4.multiplyScalar(this.scratch0, this.scratch0, weight0);
                mat4.copy(this.scratch1, boneMtx1);
                mat4.multiplyScalar(this.scratch1, this.scratch1, weight1);
                mat4.add(this.scratch0, this.scratch0, this.scratch1);
                vec3.transformMat4(pos, pos, this.scratch0);

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

export class ModelCollection {
    private modelsTab: DataView;
    private modelsBin: ArrayBufferSlice;
    private models: Model[] = [];

    private constructor(private texFetcher: TextureFetcher, private animController: SFAAnimationController, private gameInfo: GameInfo, private modelVersion: ModelVersion) {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, subdir: string, texFetcher: TextureFetcher, animController: SFAAnimationController, modelVersion: ModelVersion = ModelVersion.Final): Promise<ModelCollection> {
        const self = new ModelCollection(texFetcher, animController, gameInfo, modelVersion);

        const pathBase = self.gameInfo.pathBase;
        const [modelsTab, modelsBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.tab`),
            dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.bin`),
        ]);
        self.modelsTab = modelsTab.createDataView();
        self.modelsBin = modelsBin;

        return self;
    }

    public getNumModels() {
        return (this.modelsTab.byteLength / 4)|0;
    }

    public loadModel(device: GfxDevice, materialFactory: MaterialFactory, num: number): Model {
        if (this.models[num] === undefined) {
            console.log(`Loading model #${num} ...`);
    
            const modelTabValue = this.modelsTab.getUint32(num * 4);
            if (modelTabValue === 0) {
                throw Error(`Model #${num} not found`);
            }
    
            const modelOffs = modelTabValue & 0xffffff;
            const modelData = loadRes(this.modelsBin.subarray(modelOffs + 0x24));
            this.models[num] = new Model(device, materialFactory, modelData, this.texFetcher, this.animController, this.modelVersion);
        }

        return this.models[num];
    }

    public createModelInstance(device: GfxDevice, materialFactory: MaterialFactory, num: number): ModelInstance {
        const model = this.loadModel(device, materialFactory, num);
        return new ModelInstance(model);
    }
}