
import { mat4, ReadonlyMat4, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Camera, computeViewMatrix } from '../Camera';
import { colorCopy, colorNewFromRGBA } from '../Color';
import { AABB } from '../Geometry';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor } from '../gfx/platform/GfxPlatform';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, setSortKeyDepth, setSortKeyLayer } from "../gfx/render/GfxRenderInstManager";
import { compilePartialVtxLoader, compileVtxLoaderMultiVat, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout, VertexAttributeInput, VtxLoader } from '../gx/gx_displaylist';
import { createInputLayout, MaterialParams, DrawParams } from '../gx/gx_render';
import { transformVec3Mat4w1 } from '../MathHelpers';
import { nArray } from '../util';
import * as GX_Material from '../gx/gx_material';
import { MaterialRenderContext, SFAMaterial, StandardMapMaterial } from './materials';
import { ModelRenderContext } from './models';
import { setGXMaterialOnRenderInst } from './render';
import { mat4SetTranslation } from './util';
import { LightType } from './WorldLights';

export interface ShapeRenderContext {
    modelCtx: ModelRenderContext;
    setupLights: (dst: GX_Material.Light[]) => void;
}

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
            const vertexBuffer = device.createBuffer((loadedVertexData.vertexBuffers[i].byteLength + 3) / 4, GfxBufferUsage.Vertex,
                dynamicVertices ? GfxBufferFrequencyHint.Dynamic : GfxBufferFrequencyHint.Static);
            this.vertexBuffers.push(vertexBuffer);

            buffers.push({
                buffer: vertexBuffer,
                byteOffset: 0,
            });
        }

        if (usesZeroBuffer) {
            // TODO(jstpierre): Move this to a global somewhere?
            this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Uint8Array(16).buffer);
            buffers.push({
                buffer: this.zeroBuffer,
                byteOffset: 0,
            });
        }

        this.inputLayout = createInputLayout(cache, loadedVertexLayout);

        this.indexBuffer = device.createBuffer((loadedVertexData.indexData.byteLength + 3) / 4, GfxBufferUsage.Index,
            dynamicIndices ? GfxBufferFrequencyHint.Dynamic : GfxBufferFrequencyHint.Static);

        const indexBufferDesc: GfxIndexBufferDescriptor = {
            buffer: this.indexBuffer,
            byteOffset: 0,
        };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBufferDesc);

        this.uploadData(device, true, true);
    }

    public uploadData(device: GfxDevice, uploadVertices: boolean, uploadIndices: boolean) {
        if (uploadVertices) {
            for (let i = 0; i < this.loadedVertexData.vertexBuffers.length; i++)
                device.uploadBufferData(this.vertexBuffers[i], 0, new Uint8Array(this.loadedVertexData.vertexBuffers[i]));
        }

        if (uploadIndices)
            device.uploadBufferData(this.indexBuffer, 0, new Uint8Array(this.loadedVertexData.indexData));
    }

    public setOnRenderInst(renderInst: GfxRenderInst, draw: LoadedVertexDraw | null = null): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        if (draw !== null)
            renderInst.drawIndexes(draw.indexCount, draw.indexOffset);
        else
            renderInst.drawIndexes(this.loadedVertexData.totalIndexCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        // Do not destroy inputLayout; it is owned by the render cache.
        if (this.zeroBuffer !== null)
            device.destroyBuffer(this.zeroBuffer);
        for (let buffer of this.vertexBuffers)
            device.destroyBuffer(buffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();
const scratchVec0 = vec3.create();

// The vertices and polygons of a shape.
export class ShapeGeometry {
    private vtxLoader: VtxLoader;
    private loadedVertexData: LoadedVertexData;

    private shapeHelper: MyShapeHelper | null = null;
    private drawParams = new DrawParams();
    private verticesDirty = true;

    public aabb?: AABB;
    private sortLayer?: number;

    public pnMatrixMap: number[] = nArray(10, () => 0);
    public normalMatrixInTexMatrixCount = 0;
    public hasSkinning = false;
    public hasFineSkinning = false;

    constructor(private vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: DataView, private isDynamic: boolean) {
        this.vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexData = this.vtxLoader.parseDisplayList(ArrayBufferSlice.fromView(displayList));
        this.vtxLoader = compilePartialVtxLoader(this.vtxLoader, this.loadedVertexData);
        this.reloadVertices();
    }

    public reloadVertices() {
        this.vtxLoader.loadVertexData(this.loadedVertexData, this.vtxArrays);
        this.verticesDirty = true;
    }

    // The bounding box is represented in model space.
    public setBoundingBox(aabb: AABB) {
        this.aabb = aabb.clone();
    }

    public setSortLayer(sortLayer: number) {
        this.sortLayer = sortLayer;
    }

    public setPnMatrixMap(pnMatrixMap: number[], hasSkinning: boolean, hasFineSkinning: boolean) {
        for (let i = 0; i < pnMatrixMap.length; i++)
            this.pnMatrixMap[i] = pnMatrixMap[i];
        this.normalMatrixInTexMatrixCount = pnMatrixMap.length;
        this.hasSkinning = hasSkinning;
        this.hasFineSkinning = hasFineSkinning;
    }

    public setOnRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst,
        modelToWorldMtx: ReadonlyMat4, matrixPalette: ReadonlyMat4[], camera: Camera, overrideSortDepth?: number, overrideSortLayer?: number)
    {
        if (this.shapeHelper === null) {
            this.shapeHelper = new MyShapeHelper(device, renderInstManager.gfxRenderCache,
                this.vtxLoader.loadedVertexLayout, this.loadedVertexData, this.isDynamic, false);
            this.verticesDirty = false;
        }
        
        if (this.verticesDirty) {
            this.shapeHelper.uploadData(device, true, false);
            this.verticesDirty = false;
        }

        this.shapeHelper.setOnRenderInst(renderInst);

        this.drawParams.clear();

        const worldToViewMtx = scratchMtx0;
        computeViewMatrix(worldToViewMtx, camera);

        const modelToViewMtx = scratchMtx1;
        mat4.mul(modelToViewMtx, worldToViewMtx, modelToWorldMtx);

        // Use GfxRendererLayer.TRANSLUCENT to force sorting behavior as in the game.
        // The translucent flag must be set before calling setSortKeyDepth, otherwise errors will occur.
        if (overrideSortLayer !== undefined)
            renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT + overrideSortLayer);
        else if (this.sortLayer !== undefined)
            renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT + this.sortLayer);
        else
            renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT);

        if (overrideSortDepth !== undefined)
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, overrideSortDepth);
        else if (this.aabb !== undefined) {
            // Set sort depth from center of AABB
            this.aabb.centerPoint(scratchVec0);
            // FIXME: Should aabb.transform be used instead?
            transformVec3Mat4w1(scratchVec0, modelToViewMtx, scratchVec0);
            const depth = -scratchVec0[2];

            // const debugCtx = getDebugOverlayCanvas2D();
            // drawWorldSpaceAABB(debugCtx, camera.clipFromWorldMatrix, this.aabb, modelToWorldMtx);

            // XXX: the game has a max sort-key of 0x7fffff, whereas we have a max of 0xffff.
            // Hopefully our depth range is adequate.
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        }

        for (let i = 0; i < this.drawParams.u_PosMtx.length; i++) {
            // If fine-skinning is enabled, matrix 9 is overridden with the model-view matrix,
            // and vertices marked with matrix 9 are skinned by software.
            if (this.hasFineSkinning && i === 9)
                mat4.copy(this.drawParams.u_PosMtx[i], modelToViewMtx);
            else
                mat4.mul(this.drawParams.u_PosMtx[i], modelToViewMtx, matrixPalette[this.pnMatrixMap[i]]);
        }
    }

    public getDrawParams() {
        return this.drawParams;
    }
    
    public destroy(device: GfxDevice) {
        if (this.shapeHelper !== null) {
            this.shapeHelper.destroy(device);
            this.shapeHelper = null;
        }
    }
}

export interface MaterialOptions {
    furLayer?: number;
}

const scratchBox0 = new AABB();

export class ShapeMaterial {
    private matCtx: MaterialRenderContext | undefined;

    public constructor(private material: SFAMaterial) {
    }

    // Caution: Material is referenced, not copied.
    public setMaterial(material: SFAMaterial) {
        this.material = material;
    }

    public setOnMaterialParams(params: MaterialParams, geom: ShapeGeometry, modelToWorldMtx: ReadonlyMat4, shapeCtx: ShapeRenderContext, matOptions: MaterialOptions) {
        if (this.matCtx === undefined) {
            this.matCtx = {
                sceneCtx: shapeCtx.modelCtx.sceneCtx,
                modelToViewMtx: mat4.create(),
                viewToModelMtx: mat4.create(),
                ambienceIdx: shapeCtx.modelCtx.ambienceIdx,
                outdoorAmbientColor: colorNewFromRGBA(1.0, 1.0, 1.0, 1.0),
                furLayer: matOptions.furLayer ?? 0,
            };
        }

        this.matCtx.sceneCtx = shapeCtx.modelCtx.sceneCtx;
        this.matCtx.ambienceIdx = shapeCtx.modelCtx.ambienceIdx;
        colorCopy(this.matCtx.outdoorAmbientColor, shapeCtx.modelCtx.outdoorAmbientColor);
        this.matCtx.furLayer = matOptions.furLayer ?? 0;

        mat4.mul(this.matCtx.modelToViewMtx, this.matCtx.sceneCtx.worldToViewMtx, modelToWorldMtx);
        mat4.invert(this.matCtx.viewToModelMtx, this.matCtx.modelToViewMtx);

        shapeCtx.setupLights(params.u_Lights);

        shapeCtx.modelCtx.mapLights = [];
        if (shapeCtx.modelCtx.sceneCtx.world !== undefined && geom.aabb !== undefined && this.material instanceof StandardMapMaterial) {
            scratchBox0.copy(geom.aabb);
            scratchBox0.transform(scratchBox0, modelToWorldMtx);
            const MAX_MAP_AFFECTING_LIGHTS = 2;
            const probedLights = shapeCtx.modelCtx.sceneCtx.world.worldLights.probeLightsOnMapBox(scratchBox0, LightType.POINT, MAX_MAP_AFFECTING_LIGHTS);
            for (let i = 0; i < probedLights.length && i < MAX_MAP_AFFECTING_LIGHTS; i++) {
                const viewPosition = scratchVec0;
                probedLights[i].getPosition(viewPosition);
                // const ctx = getDebugOverlayCanvas2D();
                // drawWorldSpacePoint(ctx, modelCtx.sceneCtx.viewerInput.camera.clipFromWorldMatrix, viewPosition);
                transformVec3Mat4w1(viewPosition, this.matCtx.sceneCtx.worldToViewMtx, viewPosition);
                shapeCtx.modelCtx.mapLights.push({
                    radius: probedLights[i].radius,
                    color: probedLights[i].color,
                    viewPosition: vec3.clone(viewPosition),
                });
            }
        }

        this.matCtx.mapLights = shapeCtx.modelCtx.mapLights;

        this.material.setOnMaterialParams(params, this.matCtx);
    }

    public getGXMaterialHelper() {
        return this.material.getGXMaterialHelper();
    }
}

const scratchMaterialParams = new MaterialParams();

// The geometry and material of a shape.
export class Shape {
    public constructor(public geom: ShapeGeometry, public material: ShapeMaterial, public isDevGeometry: boolean) {
    }

    public reloadVertices() {
        this.geom.reloadVertices();
    }

    public setOnRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, modelToWorldMtx: ReadonlyMat4, shapeCtx: ShapeRenderContext, matOptions: MaterialOptions, matrixPalette: ReadonlyMat4[], overrideSortDepth?: number, overrideSortLayer?: number) {
        this.geom.setOnRenderInst(device, renderInstManager, renderInst, modelToWorldMtx, matrixPalette, shapeCtx.modelCtx.sceneCtx.viewerInput.camera, overrideSortDepth, overrideSortLayer);
        this.material.setOnMaterialParams(scratchMaterialParams, this.geom, modelToWorldMtx, shapeCtx, matOptions);

        const drawParams = this.geom.getDrawParams();

        // For environment mapping
        if (this.geom.hasSkinning && shapeCtx.modelCtx.object !== undefined) {
            const descaleMtx = mat4.create();
            const invScale = 1.0 / shapeCtx.modelCtx.object.scale;
            mat4.fromScaling(descaleMtx, [invScale, invScale, invScale])
            for (let i = 0; i < drawParams.u_PosMtx.length; i++) {
                // XXX: this is the game's peculiar way of creating normal matrices
                mat4.copy(scratchMaterialParams.u_TexMtx[i], drawParams.u_PosMtx[i]);
                mat4SetTranslation(scratchMaterialParams.u_TexMtx[i], 0, 0, 0);
                mat4.mul(scratchMaterialParams.u_TexMtx[i], scratchMaterialParams.u_TexMtx[i], descaleMtx);
                // The following line causes glitches due to an issue related to computeNormalMatrix's method of detecting uniform scaling.
                // computeNormalMatrix(scratchMaterialParams.u_TexMtx[i], drawParams.u_PosMtx[i]);
            }
        }

        const materialHelper = this.material.getGXMaterialHelper();

        setGXMaterialOnRenderInst(device, renderInstManager, renderInst, materialHelper, scratchMaterialParams, drawParams);
    }

    public addRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelToWorldMtx: ReadonlyMat4, shapeCtx: ShapeRenderContext, matOptions: MaterialOptions, matrixPalette: ReadonlyMat4[], overrideSortDepth?: number, overrideSortLayer?: number) {
        const renderInst = renderInstManager.newRenderInst();
        this.setOnRenderInst(device, renderInstManager, renderInst, modelToWorldMtx, shapeCtx, matOptions, matrixPalette, overrideSortDepth, overrideSortLayer);
        renderInstManager.submitRenderInst(renderInst);
    }
    
    public destroy(device: GfxDevice) {
        this.geom.destroy(device);
    }
}