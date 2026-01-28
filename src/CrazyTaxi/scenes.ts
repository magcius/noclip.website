import * as Viewer from '../viewer.js';
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxProgram, GfxTexture, GfxVertexBufferDescriptor } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInst, gfxRenderInstCompareNone, GfxRenderInstExecutionOrder, GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { rust } from '../rustlib.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import * as GX from '../gx/gx_enum.js';
import * as GXTexture from '../gx/gx_texture.js';
import { DataFetcher, NamedArrayBufferSlice } from '../DataFetcher.js';
import { createInputLayout, DrawParams, fillSceneParamsData, fillSceneParamsDataOnTemplate, GXMaterialHelperGfx, GXRenderHelperGfx, GXTextureHolder, GXTextureMapping, MaterialParams } from '../gx/gx_render.js';
import { drawWorldSpaceAABB, drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D, hexdump } from '../DebugJunk.js';
import { CTFileLoc, CTFileStore, CTShape } from '../../rust/pkg/noclip_support.js';
import { compilePartialVtxLoader, compileVtxLoader, compileVtxLoaderMultiVat, getAttributeByteSize, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout, VtxLoader } from '../gx/gx_displaylist.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { assert, assertExists } from '../util.js';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder.js';
import { mat4, vec3 } from 'gl-matrix';
import { TextureHolder, TextureMapping } from '../TextureHolder.js';
import { CameraController } from '../Camera.js';
import { addVelocityAwayFromTarget } from '../SuperMarioGalaxy/ActorUtil.js';
import { Blue, Color, colorFromRGBA, colorNewFromRGBA, Green, Red } from '../Color.js';
import { AABB } from '../Geometry.js';
import { scaleMatrix, setMatrixTranslation } from '../MathHelpers.js';

interface GX {
    vat: GX_VtxAttrFmt[][];
    vcd: GX_VtxDesc[];
    vtxLoader: VtxLoader;
}

function addVAT(vats: GX_VtxAttrFmt[][], fmt: GX.VtxFmt, pos: GX_VtxAttrFmt, nrm: GX_VtxAttrFmt, clr0: GX_VtxAttrFmt, clr1: GX_VtxAttrFmt, tex0?: GX_VtxAttrFmt) {
    let vat = [];
    vat[GX.Attr.POS] = pos;
    vat[GX.Attr.NRM] = nrm;
    vat[GX.Attr.CLR0] = clr0;
    vat[GX.Attr.CLR1] = clr1;
    if (tex0)
        vat[GX.Attr.TEX0] = tex0;
    vats[fmt] = vat;
}

function createVATs(): GX_VtxAttrFmt[][] {
    const vats: GX_VtxAttrFmt[][] = [];
    addVAT(
        vats,
        GX.VtxFmt.VTXFMT0,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift: 0 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.F32, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift: 0 }
    );

    // VTXFMT1-4 are used widely
    addVAT(
        vats,
        GX.VtxFmt.VTXFMT1,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift: 0 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.U8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift: 0 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT2,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 8 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.S16, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.S16, compShift: 7 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT3,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 14 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.U8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.S16, compShift: 7 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT4,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 8 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.U8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT5,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift: 0 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.U8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT6,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 6 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.S16, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.S16, compShift: 8 },
    );

    addVAT(
        vats,
        GX.VtxFmt.VTXFMT7,
        { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 6 },
        { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.S16, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift: 0 },
        { compCnt: GX.CompCnt.CLR_RGB, compType: GX.CompType.RGB565, compShift: 0 },
        { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift: 0 },
    );

    return vats;
}

const VATS = createVATs();

interface MaterialInstance {
    isSkybox: boolean,
    pos: vec3,
    scale: vec3,
    loadedVertexData: LoadedVertexData,
}

interface MaterialDrawBatch {
    shapes: Shape[],
    vertexBufferDescriptors: GfxVertexBufferDescriptor[],
    indexBuffers: ArrayBufferLike[],
    indexBufferByteLength: number,
    indexBufferDescriptor?: GfxIndexBufferDescriptor,
    indexCount: number,
}

function appendArrayBuffer(a: ArrayBufferLike, b: ArrayBufferLike): ArrayBufferLike {
    const result = new Uint8Array(a.byteLength + b.byteLength);
    result.set(new Uint8Array(a), 0);
    result.set(new Uint8Array(b), a.byteLength);
    return result.buffer;
}

class Material {
    public batches: MaterialDrawBatch[] = [];

    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();
    private inputLayout: GfxInputLayout;
    private finished = false;

    constructor(private cache: GfxRenderCache, public name: string, texture: GXTextureMapping, public gxLayout: LoadedVertexLayout) {
        this.inputLayout = createInputLayout(cache, gxLayout);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(true);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
        this.materialParams.m_TextureMapping[0] = texture;
    }

    private getCurrentBatch(): MaterialDrawBatch {
        let batch = this.batches[this.batches.length - 1];
        if (this.batches.length === 0 || batch.shapes.length === 10) {
            batch = {
                shapes: [],
                vertexBufferDescriptors: [],
                indexBufferByteLength: 0,
                indexBuffers: [],
                indexCount: 0,
            };
            this.batches.push(batch);
        }
        return batch;
    }

    public addDraw(shape: Shape, draw: ShapeDrawCall) {
        const vertexData = draw.vertexData;
        const batch = this.getCurrentBatch();
        batch.shapes.push(shape);
        for (let i = 0; i < vertexData.vertexBuffers.length; i++) {
            const vertexBuffer = createBufferFromData(
                this.cache.device,
                GfxBufferUsage.Vertex,
                GfxBufferFrequencyHint.Static,
                vertexData.vertexBuffers[i]
            );
            this.cache.device.uploadBufferData(
                vertexBuffer,
                0,
                new Uint8Array(vertexData.vertexBuffers[i])
            );
            batch.vertexBufferDescriptors.push({ buffer: vertexBuffer });
        }
        batch.indexBuffers.push(vertexData.indexData);
        batch.indexBufferByteLength += vertexData.indexData.byteLength;
        batch.indexCount += vertexData.totalIndexCount;
    }

    public finish() {
        // concatenate and create each index batch's index buffer
        for (const batch of this.batches) {
            const combinedBuffer = new Uint8Array(batch.indexBufferByteLength);
            let offs = 0;
            for (const buffer of batch.indexBuffers) {
                combinedBuffer.set(new Uint8Array(buffer), offs);
                offs += buffer.byteLength;
            }
            const indexBuffer = createBufferFromData(
                this.cache.device,
                GfxBufferUsage.Index,
                GfxBufferFrequencyHint.Static,
                combinedBuffer.buffer
            );
            batch.indexBufferDescriptor = { buffer: indexBuffer };
        }
        this.finished = true;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        assert(this.finished);
        for (const batch of this.batches) {
            if (batch.indexCount === 0) continue;
            const renderInst = renderInstManager.newRenderInst();
            this.materialHelper.setOnRenderInst(this.cache, renderInst);
            for (let i = 0; i < batch.shapes.length; i++) {
                const shape = batch.shapes[i];
                const m = mat4.create();
                setMatrixTranslation(m, shape.pos);
                scaleMatrix(m, m, shape.scale[0]);
                if (shape.isSkybox) {
                    m[15] = 0;
                }
                mat4.mul(drawParams.u_PosMtx[i], viewerInput.camera.viewMatrix, m);
            }
            this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
            this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, this.materialParams);
            renderInst.setVertexInput(
                this.inputLayout,
                batch.vertexBufferDescriptors,
                assertExists(batch.indexBufferDescriptor)
            );
            renderInst.setDrawCount(batch.indexCount);
            renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice) {
        assert(this.finished);
        // Do not destroy inputLayout; it is owned by the render cache.
        for (const batch of this.batches) {
            for (const desc of batch.vertexBufferDescriptors) {
                device.destroyBuffer(desc.buffer);
            }
            device.destroyBuffer(batch.indexBufferDescriptor!.buffer);
        }
    }
}

class MaterialCache {
    public materials: Map<string, Material> = new Map();

    constructor(private cache: GfxRenderCache, private textureHolder: GXTextureHolder) {
    }

    public addShape(shape: Shape) {
        for (const draw of shape.draws) {
            const textureName = shape.textures[draw.textureIndex];
            let material = this.materials.get(textureName);
            if (material === undefined) {
                const textureMapping = new GXTextureMapping();
                this.textureHolder.fillTextureMapping(textureMapping, textureName);
                material = new Material(
                    this.cache,
                    textureName,
                    textureMapping,
                    draw.vertexLayout
                );
                this.materials.set(textureName, material);
            } else {
                assert(draw.vertexLayout.indexFormat === material.gxLayout.indexFormat);
            }
            material.addDraw(shape, draw);
        }
    }

    public finish() {
        for (const material of this.materials.values()) {
            material.finish();
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (const material of this.materials.values()) {
            material.prepareToRender(renderInstManager, viewerInput);
        }
    }

    public destroy(device: GfxDevice) {
        for (const material of this.materials.values()) {
            material.destroy(device);
        }
    }
}

interface ShapeDrawCall {
    vertexData: LoadedVertexData,
    vertexLayout: LoadedVertexLayout,
    textureIndex: number,
}

interface Shape {
    name: string,
    pos: vec3,
    aabb: AABB,
    scale: vec3,
    isSkybox: boolean,
    draws: ShapeDrawCall[],
    vertexFormats: Set<GX.VtxFmt>,
    boundingRadius: number,
    textures: string[],
}

const drawParams = new DrawParams();

class ShapeRenderer {
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];
    public indexBufferDescriptors: GfxIndexBufferDescriptor[] = [];
    public name: string;
    public visible = true;
    public inputLayouts: GfxInputLayout[] = [];
    private vertexBuffers: GfxBuffer[] = [];
    private indexBuffers: GfxBuffer[] = [];
    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();

    constructor(private cache: GfxRenderCache, private textureHolder: GXTextureHolder, public shape: Shape) {
        this.name = this.shape.name;
        const device = cache.device;
        for (const draw of this.shape.draws) {
            this.inputLayouts.push(createInputLayout(cache, draw.vertexLayout));
            const data = draw.vertexData;
            for (let i = 0; i < data.vertexBuffers.length; i++) {
                const vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex,
                    GfxBufferFrequencyHint.Static,
                    data.vertexBuffers[i]);
                device.uploadBufferData(vertexBuffer, 0, new Uint8Array(data.vertexBuffers[i]));
                this.vertexBuffers.push(vertexBuffer);
                this.vertexBufferDescriptors.push({ buffer: vertexBuffer });
            }
            const indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, data.indexData);
            this.indexBuffers.push(indexBuffer);
            this.indexBufferDescriptors.push({ buffer: indexBuffer });
        }

        if (this.shape.textures.length === 0) {
            console.warn(`no textures`)
        }
        this.shape.textures.forEach(texture => {
            if (this.textureHolder.findTextureEntryIndex(texture) === -1) {
                console.warn(`missing texture ${texture}`)
            }
        })

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setCullMode(GX.CullMode.BACK);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) return;
        // drawWorldSpaceAABB(
        //     getDebugOverlayCanvas2D(),
        //     viewerInput.camera.clipFromWorldMatrix,
        //     aabb
        // );
        // drawWorldSpacePoint(
        //     getDebugOverlayCanvas2D(),
        //     viewerInput.camera.clipFromWorldMatrix,
        //     this.shape.p0,
        //     Red,
        //     20
        // )
        // drawWorldSpaceAABB(
        //     getDebugOverlayCanvas2D(),
        //     viewerInput.camera.clipFromWorldMatrix,
        //     this.shape.aabb
        // );
        for (let i = 0; i < this.indexBuffers.length; i++) {
            if (this.shape.draws[i].vertexData.totalIndexCount === 0)
                continue;
            const renderInst = renderInstManager.newRenderInst();
            this.materialHelper.setOnRenderInst(this.cache, renderInst);
            const m = mat4.create();
            setMatrixTranslation(m, this.shape.pos);
            scaleMatrix(m, m, this.shape.scale[0]);
            if (this.shape.isSkybox) {
                m[15] = 0;
            }
            mat4.mul(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix, m);
            this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
            this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, this.materialParams);
            const textureIndex = this.shape.draws[i].textureIndex;
            assert(this.textureHolder.fillTextureMapping(this.materialParams.m_TextureMapping[0], this.shape.textures[textureIndex]));
            renderInst.setVertexInput(this.inputLayouts[i], [this.vertexBufferDescriptors[i]], this.indexBufferDescriptors[i]);
            renderInst.setDrawCount(this.shape.draws[i].vertexData.totalIndexCount);
            renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice): void {
        // Do not destroy inputLayout; it is owned by the render cache.
        for (let buffer of this.vertexBuffers)
            device.destroyBuffer(buffer);
        for (let buffer of this.indexBuffers)
            device.destroyBuffer(buffer);
    }
}

export class Scene implements Viewer.SceneGfx {
    private renderHelper: GXRenderHelperGfx;
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListSky = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);

    private shapes: ShapeRenderer[] = [];
    private skyboxShapes: ShapeRenderer[] = [];
    private materials: MaterialCache;
    private scratchVec3a = vec3.create();
    private scratchVec3b = vec3.create();

    constructor(device: GfxDevice, private manager: FileManager, public textureHolder: GXTextureHolder, public debugPos: vec3[][], public shapeNames: string[]) {
        this.renderHelper = new GXRenderHelperGfx(device);

        console.log('creating shapes')
        this.materials = new MaterialCache(this.renderHelper.renderCache, this.textureHolder);
        for (const name of shapeNames) {
            const shape = this.manager.createShape(name);
            if (shape.name === "course_4b_048_a_ph.shp" || this.materials.materials.size < 4) {
                this.materials.addShape(shape);
            }
            const renderer = new ShapeRenderer(
                this.renderHelper.renderCache,
                this.textureHolder,
                shape,
            );
            if (shape.isSkybox) {
                this.skyboxShapes.push(renderer);
            } else {
                this.shapes.push(renderer);
            }
        }
        this.materials.finish();
        console.log('done')
    }

    private drawDebugPoints(points: vec3[], viewerInput: Viewer.ViewerRenderInput, color?: Color, connect?: boolean) {
        for (let i = 0; i < points.length; i++) {
            const pos = points[i];
            const t = i / points.length;
            drawWorldSpacePoint(
                getDebugOverlayCanvas2D(),
                viewerInput.camera.clipFromWorldMatrix,
                pos,
                color ? color : colorNewFromRGBA(t, t, 1),
                10,
            );
            if (connect) {
                let pos2 = points[i + 1];
                if (i+1 % 8 === 0 || i+1 === points.length) {
                    pos2 = points[i - 7];
                }
                if (vec3.sqrLen(pos2) < 0.01) {
                    continue;
                }
                drawWorldSpaceLine(
                    getDebugOverlayCanvas2D(),
                    viewerInput.camera.clipFromWorldMatrix,
                    pos, pos2,
                    color ? color : colorNewFromRGBA(t, t, 1),
                )
            }
        }
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);

        const cameraPos = mat4.getTranslation(this.scratchVec3a, viewerInput.camera.worldMatrix)
        renderInstManager.setCurrentList(this.renderInstListMain);
        this.materials.prepareToRender(renderInstManager, viewerInput);
        // for (const shape of this.shapes) {
        //     shape.shape.aabb.centerPoint(this.scratchVec3b);
        //     if (vec3.dist(cameraPos, this.scratchVec3b) < 10_000) {
        //         shape.prepareToRender(renderInstManager, viewerInput);
        //     }
        // }
        // renderInstManager.setCurrentList(this.renderInstListSky);
        // for (const shape of this.skyboxShapes) {
        //     shape.prepareToRender(renderInstManager, viewerInput);
        // }

        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    private debugDrawAxis(viewerInput: Viewer.ViewerRenderInput) {
        const l = 10000;
        const t = 10;
        drawWorldSpaceLine(
            getDebugOverlayCanvas2D(),
            viewerInput.camera.clipFromWorldMatrix,
            vec3.create(),
            vec3.fromValues(l, 0, 0),
            Red,
            t
        );
        drawWorldSpaceLine(
            getDebugOverlayCanvas2D(),
            viewerInput.camera.clipFromWorldMatrix,
            vec3.create(),
            vec3.fromValues(0, l, 0),
            Green,
            t
        );
        drawWorldSpaceLine(
            getDebugOverlayCanvas2D(),
            viewerInput.camera.clipFromWorldMatrix,
            vec3.create(),
            vec3.fromValues(0, 0, l),
            Blue,
            t
        );
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.1);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        viewerInput.camera.setClipPlanes(0.1);
        this.prepareToRender(device, viewerInput);
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Sky");
            const skyDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Sky Depth");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
        this.renderInstListSky.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
    }
}

class FileManager {
    public fileStore: CTFileStore;
    private fileData: NamedArrayBufferSlice[] = [];

    constructor(public dataFetcher: DataFetcher, public fileNames: string[]) {
        this.fileStore = rust.CTFileStore.new();
    }

    public debugShape(name: string) {
        const shape = this.fileStore.get_shape(name)!;
        const displayListData = this.getData(shape.display_list_loc()!);
        const vtxCmd = displayListData.createDataView().getUint8(0) & 0xF8;
        const vtxFmt = displayListData.createDataView().getUint8(0) & 0x07;
        console.log(`${name} DL cmd 0x${vtxCmd.toString(16)} fmt ${vtxFmt}`)
        console.log(`pos:`);
        hexdump(this.getData(shape.pos_loc()));
        const otherData: [string, CTFileLoc | undefined][] = [
            ['nrm', shape.nrm_loc()],
            ['clr0', shape.clr_loc(0)],
            ['clr1', shape.clr_loc(1)],
            ['tex0', shape.tex_loc(0)],
            ['tex1', shape.tex_loc(1)],
            ['tex2', shape.tex_loc(2)],
            ['tex3', shape.tex_loc(3)],
            ['tex4', shape.tex_loc(4)],
            ['tex5', shape.tex_loc(5)],
            ['tex6', shape.tex_loc(6)],
            ['tex7', shape.tex_loc(7)],
        ];
        for (let [tag, loc] of otherData) {
            if (loc !== undefined) {
                console.log(`${tag}:`);
                hexdump(this.getData(loc));
            } else {
                console.log(`${tag}: N/A`);
            }
        }
    }

    public createShape(name: string): Shape {
        const debug = name === "cz_chari.shp";
        const shape = this.fileStore.get_shape(name)!;
        const boundingRadius = shape.bounding_radius();
        let x = shape.pos_and_scale();
        let pos = vec3.fromValues(x[0], x[1], -x[2]); // FIXME why do we negate here
        let scale = vec3.fromValues(x[3], x[4], x[5]);

        const attrs: [GX.Attr, CTFileLoc | undefined][] = [
            [GX.Attr.POS, shape.pos_loc()],
            [GX.Attr.NRM, shape.nrm_loc()],
            [GX.Attr.CLR0, shape.clr_loc(0)],
            [GX.Attr.CLR1, shape.clr_loc(1)],
            [GX.Attr.TEX0, shape.tex_loc(0)],
            [GX.Attr.TEX1, shape.tex_loc(1)],
            [GX.Attr.TEX2, shape.tex_loc(2)],
            [GX.Attr.TEX3, shape.tex_loc(3)],
            [GX.Attr.TEX4, shape.tex_loc(4)],
            [GX.Attr.TEX5, shape.tex_loc(5)],
            [GX.Attr.TEX6, shape.tex_loc(6)],
            [GX.Attr.TEX7, shape.tex_loc(7)],
        ];

        const textures = shape.textures;
        for (let i = 0; i < textures.length; i++) {
            textures[i] = textures[i].toLowerCase();
        }

        const draws: ShapeDrawCall[] = [];
        const dlAddrs = [];
        const textureIdxs = [];
        const drawsLoc = shape.mystery_loc()!;
        const drawsData = this.getData(drawsLoc).createDataView();
        const drawCount = Math.floor(drawsData.byteLength / 36);
        for (let i = 0; i < drawCount; i++) {
            const offs = i * 36;
            const dlAddr = drawsData.getUint32(offs + 0x0);
            if (dlAddr === 0x38) continue; // the first one seems to always be empty?
            const vtxAddr = drawsData.getUint32(offs + 0x4);
            const texIdx = drawsData.getUint32(offs + 0x8);
            const unkNum0 = drawsData.getFloat32(offs + 0xc);
            const unkNum1 = drawsData.getFloat32(offs + 0x10);
            const unkNum2 = drawsData.getFloat32(offs + 0x14);
            const unkCount1 = drawsData.getUint32(offs + 0x18);
            const unkBytes = drawsData.buffer.slice(offs + 0x1c, offs + 36);
            dlAddrs.push(dlAddr);
            textureIdxs.push(texIdx);
        }

        const sortedDLAddrs = dlAddrs.slice();
        sortedDLAddrs.sort((a, b) => a - b);
        const dlSizesByAddr: Map<number, number> = new Map();
        for (let i = 0; i < sortedDLAddrs.length - 1; i++) {
            const size = sortedDLAddrs[i + 1] - sortedDLAddrs[i];
            assert(size > 0);
            dlSizesByAddr.set(sortedDLAddrs[i], size);
        }

        // parse each display list. each shape has several display lists
        // concatenated together and aligned on 0x20 blocks
        const dlSection = this.getData(shape.display_list_loc()!);
        const dlOffset = shape.display_list_offs();
        const vertexFormats: Set<GX.VtxFmt> = new Set();
        for (let i = 0; i < dlAddrs.length; i++) {
            const addr = dlAddrs[i];
            const textureIndex = textureIdxs[i];
            let dlData = dlSection.slice(addr - dlOffset);
            const size = dlSizesByAddr.get(addr);
            if (size) {
                dlData = dlData.slice(0, size);
            }
            const vtxFormat = dlData.createDataView().getUint8(0) & 0x07;
            vertexFormats.add(vtxFormat);
            const fmtVat = VATS[vtxFormat];
            const vcd: GX_VtxDesc[] = [];
            const vtxArrays: GX_Array[] = [];
            for (const [attr, loc] of attrs) {
                if (loc === undefined)
                    continue;
                vcd[attr] = { type: GX.AttrType.INDEX16 };
                vtxArrays[attr] = {
                    buffer: this.getData(loc),
                    offs: 0,
                    stride: getAttributeByteSize(fmtVat, attr),
                };
            }

            // awkward hack
            let vat = [];
            vat[vtxFormat] = fmtVat;
            const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
            const vertexData = vtxLoader.runVertices(vtxArrays, dlData);
            draws.push({
                vertexData,
                vertexLayout: vtxLoader.loadedVertexLayout,
                textureIndex,
            })
        }


        const aabb = new AABB();
        if (vertexFormats.has(1)) {
            const prescaled = scale[0] === 1 && scale[1] === 1 && scale[2] === 1;
            const pretranslated = pos[0] === 0 && pos[1] === 0 && pos[2] === 0;
            assert(prescaled && pretranslated);
            const p = vec3.create();
            for (const draw of draws) {
                for (const buf of draw.vertexData.vertexBuffers) {
                    const verts = new Float32Array(buf);
                    assert(verts.length % 3 === 0);
                    for (let i = 0; i < verts.length / 3; i += 3) {
                        vec3.set(p, verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
                        aabb.unionPoint(p);
                    }
                }
            }
        } else {
            aabb.setFromCenterAndHalfExtents(pos, vec3.fromValues(boundingRadius, boundingRadius, boundingRadius));
        }

        const isSkybox = ['solla.shp', 'enkei4.shp'].includes(name);

        return { name, pos, aabb, scale, isSkybox, draws, vertexFormats, boundingRadius, textures };
    }

    public createTexture(name: string): GXTexture.TextureInputGX {
        const texture = this.fileStore.get_texture(name)!;
        const data = this.getData(texture.data_loc());
        return {
            name,
            width: texture.width(),
            height: texture.height(),
            mipCount: 1, // ???
            format: texture.format(),
            data,
        };
    }

    public getData(loc: CTFileLoc): ArrayBufferSlice {
        const data = this.fileData[loc.file_id];
        return data.slice(loc.offset, loc.offset + loc.length);
    }

    async fetch() {
        const basePath = "CrazyTaxi/files/ct";
        for (const fileName of this.fileNames) {
            const data = await this.dataFetcher.fetchData(`${basePath}/${fileName}`);
            if (fileName.endsWith('.all')) {
                this.fileStore.append_archive(fileName, data.createTypedArray(Uint8Array));
            } else {
                this.fileStore.append_file(fileName, data.createTypedArray(Uint8Array));
            }
            this.fileData.push(data);
        }
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const manager = new FileManager(context.dataFetcher, [
            "poldc0.all",
            "texDC0.all",
            `pol${this.id}.all`,
            `pol${this.id}_stream.all`,
            `tex${this.id.toUpperCase()}.all`,
            "misc.all",
            "white.tex",
        ]);
        await manager.fetch();
        const mainData = await context.dataFetcher.fetchData("CrazyTaxi/sys/main.dol");
        const pos = [];
        const posData = mainData.slice(0x1e5aac).createDataView();
        const N_SHAPES = 982;
        const stride = 10 * 4;
        for (let i = 0; i < 982; i++) {
            const offs = i * stride;
            const x = posData.getFloat32(offs);
            const y = posData.getFloat32(offs + 0x4);
            const z = posData.getFloat32(offs + 0x8);
            const unk0 = posData.getUint32(offs + 0xc);
            const unk1 = posData.getUint32(offs + 0x10);
            const unk2 = posData.getFloat32(offs + 0x14);
            const unk3 = posData.getFloat32(offs + 0x18);
            const unk4 = posData.getFloat32(offs + 0x1c);
            const unk5 = posData.getUint32(offs + 0x20);
            const unk6 = posData.getUint32(offs + 0x24);
            pos.push(vec3.fromValues(x, y, z));
        }

        const pos2 = [];
        const pos2Data = mainData.slice(0xFB818, 0x101434).createDataView();
        let offs = 0;
        while (offs < pos2Data.byteLength) {
            pos2.push(vec3.fromValues(
                pos2Data.getFloat32(offs + 0),
                pos2Data.getFloat32(offs + 4),
                pos2Data.getFloat32(offs + 8),
            ));
            offs += 3 * 4;
        }

        const pos3: vec3[] = [];
        const pos3Data = mainData.slice(0xe4ecc, 0xe69e4).createDataView();
        offs = 0;
        while (offs < pos3Data.byteLength) {
            try {
                // pos3.push(vec3.fromValues(
                //     pos3Data.getFloat32(offs + 0),
                //     pos3Data.getFloat32(offs + 4),
                //     pos3Data.getFloat32(offs + 8),
                // ));
            } catch (err) { }
            offs += 3 * 4;
        }

        // const nameData = mainData.slice(0x12a884, 0x12fb40).createTypedArray(Uint8Array);
        // hexdump(mainData.slice(0x12a884));
        let names = [];
        // let offs = 0;
        // let name = '';
        // while (offs < nameData.byteLength) {
        //     if (nameData[offs] !== 0) {
        //         name += String.fromCharCode(nameData[offs]);
        //     } else if (name.length > 0) {
        //         names.push(name);
        //         name = '';
        //     }
        //     offs += 1;
        // }

        const indexNameData = mainData.slice(0x15f18c, 0x1942c0 + 0x44).createDataView();
        offs = 0;
        let fuck: [string, number][][] = [];
        while (offs < indexNameData.byteLength) {
            let name = '';
            let nameOffs = 0;
            while (indexNameData.getUint8(offs + nameOffs) !== 0) {
                name += String.fromCharCode(indexNameData.getUint8(offs + nameOffs));
                nameOffs += 1;
            }
            offs += 0x42;
            let index = indexNameData.getUint16(offs);
            if (index === 0) {
                fuck.push([]);
            }
            fuck[fuck.length - 1].push([name, index]);
            offs += 0x2;
        }

        console.log(fuck)

        const textures: GXTexture.TextureInputGX[] = [];
        for (const filename of manager.fileStore.list_textures()) {
            textures.push(manager.createTexture(filename.toLowerCase()));
        }
        names = [];
        for (const filename of manager.fileStore.list_shapes()) {
            if (['setdownbox.shp', 'grampus.shp'].includes(filename)) continue;
            names.push(filename);
        }
        const textureHolder = new GXTextureHolder();
        for (const texture of textures) {
            textureHolder.addTexture(gfxDevice, texture);
        }
        const scene = new Scene(gfxDevice, manager, textureHolder, [pos, pos2, pos3], names);
        return scene;
    }
}

const sceneDescs: SceneDesc[] = [
    new SceneDesc('dc1', 'Arcade'),
    new SceneDesc('dc2', 'Original'),
    new SceneDesc('dc3', 'Crazy Box'),
];

const name = "Crazy Taxi";
const id = "crazytaxi";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
