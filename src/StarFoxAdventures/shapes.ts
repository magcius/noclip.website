
import { mat4 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Camera, computeViewMatrix } from '../Camera';
import { colorCopy, colorNewFromRGBA, White } from '../Color';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor } from '../gfx/platform/GfxPlatform';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { compilePartialVtxLoader, compileVtxLoaderMultiVat, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout, VertexAttributeInput, VtxLoader } from '../gx/gx_displaylist';
import { GXMaterial } from '../gx/gx_material';
import { ColorKind, createInputLayout, GXMaterialHelperGfx, MaterialParams, PacketParams } from '../gx/gx_render';
import { nArray } from '../util';
import { SFAAnimationController } from './animation';
import { SFAMaterial } from './materials';
import { ModelRenderContext } from './models';
import { computeModelView, ViewState } from './util';


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

    public setOnRenderInst(renderInst: GfxRenderInst, packet: LoadedVertexDraw | null = null): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        if (packet !== null)
            renderInst.drawIndexes(packet.indexCount, packet.indexOffset);
        else
            renderInst.drawIndexes(this.loadedVertexData.totalIndexCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        if (this.zeroBuffer !== null)
            device.destroyBuffer(this.zeroBuffer);
    }
}

interface ShapeConfig {
    matrix: mat4;
    boneMatrices: mat4[];
    camera: Camera;
}

const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();
const scratchMtx2 = mat4.create();

// The vertices and polygons of a shape.
export class ShapeGeometry {
    private vtxLoader: VtxLoader;
    private loadedVertexData: LoadedVertexData;

    private shapeHelper: MyShapeHelper | null = null;
    private packetParams = new PacketParams();
    private verticesDirty = true;

    public pnMatrixMap: number[] = nArray(10, () => 0);
    private hasFineSkinning = false;
    public hasBetaFineSkinning = false;

    constructor(private vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: ArrayBufferSlice, private isDynamic: boolean) {
        this.vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexData = this.vtxLoader.parseDisplayList(displayList);
        this.vtxLoader = compilePartialVtxLoader(this.vtxLoader, this.loadedVertexData);
        this.reloadVertices();
    }

    public reloadVertices() {
        this.vtxLoader.loadVertexData(this.loadedVertexData, this.vtxArrays);
        this.verticesDirty = true;
    }

    public setPnMatrixMap(pnMatrixMap: number[], hasFineSkinning: boolean) {
        for (let i = 0; i < pnMatrixMap.length; i++) {
            this.pnMatrixMap[i] = pnMatrixMap[i];
        }
        this.hasFineSkinning = hasFineSkinning;
    }

    public setOnRenderInst(device: GfxDevice, material: ShapeMaterial, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, config: ShapeConfig) {
        if (this.shapeHelper === null) {
            this.shapeHelper = new MyShapeHelper(device, renderInstManager.gfxRenderCache,
                this.vtxLoader.loadedVertexLayout, this.loadedVertexData, this.isDynamic, false);
            this.verticesDirty = false;
        } else if (this.verticesDirty) {
            this.shapeHelper.uploadData(device, true, false);
            this.verticesDirty = false;
        }

        this.shapeHelper.setOnRenderInst(renderInst);

        this.packetParams.clear();

        const viewMtx = scratchMtx0;
        computeViewMatrix(viewMtx, config.camera);
        const modelViewMtx = scratchMtx1;
        mat4.mul(modelViewMtx, viewMtx, config.matrix);
        const boneMtx = scratchMtx2;

        for (let i = 0; i < this.packetParams.u_PosMtx.length; i++) {
            // PNMTX 9 is used for fine-skinned vertices in models with fine-skinning enabled.
            if (this.hasFineSkinning && i === 9) {
                mat4.identity(boneMtx);
            } else {
                mat4.copy(boneMtx, config.boneMatrices[this.pnMatrixMap[i]]);
            }

            mat4.mul(this.packetParams.u_PosMtx[i], modelViewMtx, boneMtx);
        }

        material.allocatePacketParamsDataOnInst(renderInst, this.packetParams);
    }
}

export interface ShapeMaterial {
    setOnRenderInst: (device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, modelMatrix: mat4, modelCtx: ModelRenderContext) => void;
    allocatePacketParamsDataOnInst(renderInst: GfxRenderInst, packetParams: PacketParams): void;
}

export class CommonShapeMaterial implements ShapeMaterial {
    private material: SFAMaterial;
    private gxMaterial: GXMaterial | undefined;
    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();
    private furLayer: number = 0;
    private overrideIndMtx: (mat4 | undefined)[] = [];
    private viewState: ViewState | undefined;

    // Caution: Material is referenced, not copied.
    public setMaterial(material: SFAMaterial) {
        this.material = material;
        this.updateMaterialHelper();
    }

    private updateMaterialHelper() {
        if (this.gxMaterial !== this.material.getGXMaterial()) {
            this.gxMaterial = this.material.getGXMaterial();
            this.materialHelper = new GXMaterialHelperGfx(this.gxMaterial);
        }
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

    public setOnRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, modelMatrix: mat4, modelCtx: ModelRenderContext) {
        this.updateMaterialHelper();
        
        if (this.viewState === undefined) {
            this.viewState = {
                sceneCtx: modelCtx,
                modelViewMtx: mat4.create(),
                invModelViewMtx: mat4.create(),
                outdoorAmbientColor: colorNewFromRGBA(1.0, 1.0, 1.0, 1.0),
                furLayer: this.furLayer,
            };
        }

        this.viewState.sceneCtx = modelCtx;
        this.material.factory.getAmbientColor(this.viewState.outdoorAmbientColor, modelCtx.ambienceNum);
        this.viewState.furLayer = this.furLayer;

        computeModelView(this.viewState.modelViewMtx, modelCtx.viewerInput.camera, modelMatrix);
        mat4.invert(this.viewState.invModelViewMtx, this.viewState.modelViewMtx);

        for (let i = 0; i < 8; i++) {
            const tex = this.material.getTexture(i);
            if (tex !== undefined) {
                tex.setOnTextureMapping(this.materialParams.m_TextureMapping[i], this.viewState);
            } else {
                this.materialParams.m_TextureMapping[i].reset();
            }
        }

        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);

        this.material.setupMaterialParams(this.materialParams, this.viewState);

        // XXX: test lighting
        colorCopy(this.materialParams.u_Color[ColorKind.MAT0], White); // TODO
        modelCtx.setupLights(this.materialParams.u_Lights, modelCtx);

        for (let i = 0; i < 3; i++) {
            if (this.overrideIndMtx[i] !== undefined) {
                mat4.copy(this.materialParams.u_IndTexMtx[i], this.overrideIndMtx[i]!);
            }
        }

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, this.materialParams);
    }

    public allocatePacketParamsDataOnInst(renderInst: GfxRenderInst, packetParams: PacketParams): void {
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
    }
}

// The geometry and material of a shape.
export class Shape {
    public constructor(public geom: ShapeGeometry, public material: ShapeMaterial, public isDevGeometry: boolean) {
    }

    public reloadVertices() {
        this.geom.reloadVertices();
    }

    public setOnRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, modelMatrix: mat4, modelCtx: ModelRenderContext, boneMatrices: mat4[]) {
        this.geom.setOnRenderInst(device, this.material, renderInstManager, renderInst, {
            matrix: modelMatrix,
            boneMatrices: boneMatrices,
            camera: modelCtx.viewerInput.camera,
        });

        this.material.setOnRenderInst(device, renderInstManager, renderInst, modelMatrix, modelCtx);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: mat4, modelCtx: ModelRenderContext, boneMatrices: mat4[]) {
        const renderInst = renderInstManager.newRenderInst();
        this.setOnRenderInst(device, renderInstManager, renderInst, modelMatrix, modelCtx, boneMatrices);
        renderInstManager.submitRenderInst(renderInst);
    }
}