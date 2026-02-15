import { mat4 } from "gl-matrix";
import * as GXTexture from '../gx/gx_texture.js';
import * as Viewer from '../viewer.js';
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxBufferUsage, GfxBufferFrequencyHint, GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxInputLayout, GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { LoadedVertexLayout, LoadedVertexData } from "../gx/gx_displaylist";
import { GXMaterialHelperGfx, MaterialParams, GXTextureMapping, createInputLayout, DrawParams, loadTextureFromMipChain, ColorKind } from "../gx/gx_render";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX from '../gx/gx_enum.js';
import { setMatrixTranslation, scaleMatrix } from "../MathHelpers";
import { assert, assertExists } from "../util";
import { Shape, ShapeDrawCall, ShapeDrawType } from "./shape";
import { FileManager, FriendlyLoc } from "./util.js";
import { CTShapeDrawType } from "noclip-rust-support";

export class TextureCache {
    public textureMap: Map<string, Texture> = new Map();

    public addTexture(tex: Texture) {
        this.textureMap.set(tex.name, tex);
    }
}

export class Texture {
    public gxTexture: GXTexture.TextureInputGX;
    public gfxTexture: GfxTexture;
    public unks: Uint8Array;
    public loc: FriendlyLoc;
    public headerData: Uint8Array;

    constructor(public name: string, device: GfxDevice, manager: FileManager) {
        const texture = manager.fileStore.get_texture(name)!;
        this.loc = manager.getLoc(texture.header_loc())
        const data = manager.getData(texture.data_loc());
        const headerData = manager.getData(texture.header_loc());
        this.headerData = headerData.createTypedArray(Uint8Array);
        this.unks = new Uint8Array(texture.dbg_unks().buffer);
        this.gxTexture = {
            name,
            width: texture.width(),
            height: texture.height(),
            mipCount: 1, // ???
            format: texture.format(),
            data,
        };
        const mipChain = GXTexture.calcMipChain(this.gxTexture, this.gxTexture.mipCount);
        const loadedTexture = loadTextureFromMipChain(device, mipChain);
        this.gfxTexture = loadedTexture.gfxTexture;
    }

    public fillTextureMapping(dst: GXTextureMapping): boolean {
        dst.gfxTexture = this.gfxTexture;
        dst.width = this.gxTexture.width;
        dst.height = this.gxTexture.height;
        dst.flipY = false;
        return true;
    }
}

export interface MaterialDrawBatch {
    shapes: Shape[],

    vertexBuffers: ArrayBufferLike[],
    totalVertexCount: number;
    totalVertexByteCount: number,
    vertexBufferDescriptor?: GfxVertexBufferDescriptor,

    indexBuffers: ArrayBufferLike[],
    totalIndexCount: number,
    totalIndexByteCount: number;
    indexBufferDescriptor?: GfxIndexBufferDescriptor,
}

function patchPNMTXIDX(layout: LoadedVertexLayout, data: LoadedVertexData, idx: number): void {
    const stride = layout.vertexBufferStrides[0];
    let offs = layout.vertexAttributeOffsets[GX.Attr.POS]; // should always be 0, but, well, you know
    const view = new DataView(data.vertexBuffers[0]);
    for (let i = 0; i < data.totalVertexCount; i++) {
        // PNMTXIDX is stored in the fourth float of position data.
        view.setFloat32(offs + 0x0c, idx, true);
        offs += stride;
    }
}

function concatBuffers(bufs: ArrayBufferLike[], totalByteSize: number): Uint8Array {
    const result = new Uint8Array(totalByteSize);
    let offs = 0
    for (const buf of bufs) {
        result.set(new Uint8Array(buf), offs);
        offs += buf.byteLength;
    }
    return result;
}

const drawParams = new DrawParams();

export class Material {
    public batches: MaterialDrawBatch[] = [];
    public draws: ShapeDrawCall[] = [];
    public name: string;
    public visible = true;
    public drawType: CTShapeDrawType;
    public materialId: number;
    public gxLayout: LoadedVertexLayout;

    private inputLayout: GfxInputLayout;
    private materialParams = new MaterialParams();
    private materialHelper: GXMaterialHelperGfx;
    private finished = false;

    constructor(private cache: GfxRenderCache, public texture: Texture, draw: ShapeDrawCall) {
        this.gxLayout = draw.vertexLayout;
        this.drawType = draw.draw.draw_type;
        const dtStr = this.drawType === CTShapeDrawType.Opaque ? 'opaque' : this.drawType === CTShapeDrawType.Transparent ? 'transparent' : 'unk';
        this.materialId = draw.draw.material_id;
        this.name = `${texture.name} (mat ${dtStr} ${this.materialId})`
        this.inputLayout = createInputLayout(cache, this.gxLayout);

        const mb = new GXMaterialBuilder();
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(true);
        this.setMaterialParams(mb);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
        this.materialParams.m_TextureMapping[0] = new GXTextureMapping();
        // for (let i = 0; i < ColorKind.COUNT; i++) {
        //     this.materialParams.u_Color[i] = White;
        // }
        texture.fillTextureMapping(this.materialParams.m_TextureMapping[0]);
    }

    public setMaterialParams(mb: GXMaterialBuilder) {
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY, false, GX.PostTexGenMatrix.PTIDENTITY); // 0, 1, 4, 0x3c, 0, 0x7d
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE); // 4 0 1 1 0 0 2
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0); // 0 0 0 7
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0); // 0, 0, 0, 0
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO); // 0 0xf 8 0xa 0xf
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV); // 0 0 0 0 1 0

        if (this.drawType === CTShapeDrawType.Opaque) {
            mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.SET);
            mb.setAlphaCompare(GX.CompareType.ALWAYS, 0x00, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0x00);
            mb.setZMode(true, GX.CompareType.LEQUAL, true);
        } else if (this.drawType === CTShapeDrawType.Transparent) {
            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.SET);
            mb.setAlphaCompare(GX.CompareType.GREATER, 0x40, GX.AlphaOp.AND, GX.CompareType.GREATER, 0x40);
            mb.setZMode(true, GX.CompareType.LEQUAL, true);
        } else {
            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.SET);
            mb.setAlphaCompare(GX.CompareType.GREATER, 0x00, GX.AlphaOp.AND, GX.CompareType.GREATER, 0x00);
            // mb.setZMode(true, GX.CompareType.LEQUAL, true);
            // mb.setColorUpdate(true);
            // mb.setAlphaUpdate(false);
        }

        if (this.materialId === 2) {
            // setMaterial0(white)
            // setAmbientColor0(someGrayscale)
            mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE); // 2 0 0 0 0 0 0 2
            mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
            mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO); // 0 7 5 4 7
            mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV); // 0 0 0 0 1 0
        } else if (this.materialId === 3) {
            mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
            mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
            mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO);
            mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
            mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        } else if (this.materialId === 5) {
            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ZERO, GX.BlendFactor.SRCALPHA, GX.LogicOp.CLEAR);
            mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
            mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
            mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
            mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
            mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
            mb.setZMode(false, GX.CompareType.ALWAYS, false); // can't actually find this in the decomp, but it's needed or things are fucked
        } else {
            // TODO: the rest
            mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
            mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        }
    }

    public isCompatible(draw: ShapeDrawCall): boolean {
        const layoutMatch = JSON.stringify(this.gxLayout) === JSON.stringify(draw.vertexLayout);
        const drawTypeMatch = draw.draw.draw_type === this.drawType;
        const materialIdMatch = draw.draw.material_id === this.materialId;
        return layoutMatch && drawTypeMatch;
    }

    private getCurrentBatch(): MaterialDrawBatch {
        let batch = this.batches[this.batches.length - 1];
        if (this.batches.length === 0 || batch.shapes.length === 10) {
            batch = {
                shapes: [],
                totalIndexCount: 0,
                totalIndexByteCount: 0,
                totalVertexCount: 0,
                totalVertexByteCount: 0,
                vertexBuffers: [],
                indexBuffers: [],
            };
            this.batches.push(batch);
        }
        return batch;
    }

    public addDraw(shape: Shape, draw: ShapeDrawCall) {
        const vertexData = draw.vertexData;
        const batch = this.getCurrentBatch();
        batch.shapes.push(shape);
        this.draws.push(draw);

        // update the PNMTXIDX value for each vertex, which lets us use instancing
        patchPNMTXIDX(draw.vertexLayout, vertexData, batch.shapes.length - 1);

        // update the index values to the current total vertex count
        const indexBuffer = new Uint16Array(vertexData.indexData);
        for (let i = 0; i < indexBuffer.length; i++) {
            indexBuffer[i] += batch.totalVertexCount;
        }
        batch.totalVertexCount += vertexData.totalVertexCount;
        batch.indexBuffers.push(indexBuffer.buffer);
        batch.totalIndexByteCount += vertexData.indexData.byteLength;
        batch.vertexBuffers.push(vertexData.vertexBuffers[0]);
        batch.totalVertexByteCount += vertexData.vertexBuffers[0].byteLength;
        batch.totalIndexCount += vertexData.totalIndexCount;
    }

    public finish() {
        for (let batchIdx = 0; batchIdx < this.batches.length; batchIdx++) {
            const batch = this.batches[batchIdx];
            const indexBuffer = createBufferFromData(
                this.cache.device,
                GfxBufferUsage.Index,
                GfxBufferFrequencyHint.Static,
                concatBuffers(batch.indexBuffers, batch.totalIndexByteCount).buffer
            );
            batch.indexBufferDescriptor = { buffer: indexBuffer };

            const combinedVertexBuffer = concatBuffers(batch.vertexBuffers, batch.totalVertexByteCount);
            const vertexBuffer = createBufferFromData(
                this.cache.device,
                GfxBufferUsage.Vertex,
                GfxBufferFrequencyHint.Static,
                combinedVertexBuffer.buffer,
            );
            this.cache.device.uploadBufferData(
                vertexBuffer,
                0,
                combinedVertexBuffer,
            );
            batch.vertexBufferDescriptor = { buffer: vertexBuffer };
        }
        this.finished = true;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        assert(this.finished);
        if (!this.visible) return;
        for (const batch of this.batches) {
            if (batch.totalIndexCount === 0) continue;
            const renderInst = renderInstManager.newRenderInst();
            this.materialHelper.setOnRenderInst(this.cache, renderInst);
            for (let i = 0; i < batch.shapes.length; i++) {
                const shape = batch.shapes[i];
                const m = mat4.create();
                setMatrixTranslation(m, shape.pos);
                if (shape.visible) {
                    scaleMatrix(m, m, shape.scale[0]);
                } else {
                    scaleMatrix(m, m, 0);
                }
                if (shape.isSkybox) {
                    m[15] = 0;
                }
                mat4.mul(drawParams.u_PosMtx[i], viewerInput.camera.viewMatrix, m);
            }
            this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
            this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, this.materialParams);
            renderInst.setVertexInput(
                this.inputLayout,
                [assertExists(batch.vertexBufferDescriptor)],
                assertExists(batch.indexBufferDescriptor)
            );
            renderInst.setDrawCount(batch.totalIndexCount);
            renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice) {
        assert(this.finished);
        // Do not destroy inputLayout; it is owned by the render cache.
        for (const batch of this.batches) {
            device.destroyBuffer(batch.vertexBufferDescriptor!.buffer);
            device.destroyBuffer(batch.indexBufferDescriptor!.buffer);
        }
    }
}

export class MaterialCache {
    public materialMap: Map<string, Material[]> = new Map();
    public materials: Material[] = [];
    public materialIds: Map<number, number> = new Map();

    constructor(private cache: GfxRenderCache, private textureCache: TextureCache) {
    }

    private findOrCreateMaterial(texture: Texture, draw: ShapeDrawCall): Material {
        let materials = this.materialMap.get(texture.name);
        if (materials === undefined) {
            materials = [];
            this.materialMap.set(texture.name, materials);
        }

        let material = materials.find(mat => mat.isCompatible(draw));
        if (material === undefined) {
            material = new Material(
                this.cache,
                texture,
                draw,
            );
            materials.push(material);
            this.materials.push(material);
        }
        return material;
    }

    public addShape(shape: Shape) {
        for (const draw of shape.draws) {
            let nMaterialIds = this.materialIds.get(draw.draw.material_id);
            if (!nMaterialIds) {
                this.materialIds.set(draw.draw.material_id, 0);
                nMaterialIds = 0;
            }
            this.materialIds.set(draw.draw.material_id, nMaterialIds + 1);
            const textureName = shape.textures[draw.draw.texture_index];
            const texture = assertExists(this.textureCache.textureMap.get(textureName));
            const material = this.findOrCreateMaterial(texture, draw);
            material.addDraw(shape, draw);
        }
    }

    public finish() {
        for (const material of this.materials) {
            material.finish();
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (const material of this.materials) {
            material.prepareToRender(renderInstManager, viewerInput);
        }
    }

    public destroy(device: GfxDevice) {
        for (const material of this.materials) {
            material.destroy(device);
        }
    }
}
