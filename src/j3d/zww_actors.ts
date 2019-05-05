
import * as Viewer from '../viewer';
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import { mat4, vec3 } from "gl-matrix";
import { BMDModelInstance } from "./render";
import { ANK1, TTK1, TRK1, TEX1_TextureData } from "./j3d";
import AnimationController from "../AnimationController";
import { Colors } from "./zww_scenes";
import { ColorKind, GXRenderHelperGfx, GXTextureHolder, GXShapeHelperGfx, loadedDataCoalescerGfx, ub_PacketParams, PacketParams, MaterialParams, GXMaterialHelperGfx, translateWrapModeGfx } from "../gx/gx_render";
import { AABB } from '../Geometry';
import { ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB, computeViewMatrix } from '../Camera';
import { GfxDevice, GfxSampler, GfxTexFilterMode, GfxMipFilterMode } from '../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assertExists } from '../util';
import { DisplayListRegisters, runDisplayListRegisters, parseMaterialEntry } from '../rres/brres';
import { GX_Array, GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader } from '../gx/gx_displaylist';
import { GfxBufferCoalescer } from '../gfx/helpers/BufferHelpers';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderInst } from '../gfx/render/GfxRenderer';
import { colorFromRGBA } from '../Color';

// Special-case actors

export interface ObjectRenderer {
    prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, visible: boolean): void;
    setColors(colors: Colors): void;
    destroy(device: GfxDevice): void;
    setVertexColorsEnabled(v: boolean): void;
    setTexturesEnabled(v: boolean): void
}

const bboxScratch = new AABB();
const screenProjection = new ScreenSpaceProjection();
export class BMDObjectRenderer implements ObjectRenderer {
    public visible = true;
    public modelMatrix: mat4 = mat4.create();

    private childObjects: BMDObjectRenderer[] = [];
    private parentJointMatrix: mat4 | null = null;

    constructor(public modelInstance: BMDModelInstance) {
    }

    public bindANK1(ank1: ANK1, animationController?: AnimationController): void {
        this.modelInstance.bindANK1(ank1, animationController);
    }

    public bindTTK1(ttk1: TTK1, animationController?: AnimationController): void {
        this.modelInstance.bindTTK1(ttk1, animationController);
    }

    public bindTRK1(trk1: TRK1, animationController?: AnimationController): void {
        this.modelInstance.bindTRK1(trk1, animationController);
    }

    public setParentJoint(o: BMDObjectRenderer, jointName: string): void {
        this.parentJointMatrix = o.modelInstance.getJointMatrixReference(jointName);
        o.childObjects.push(this);
    }

    public setMaterialColorWriteEnabled(materialName: string, v: boolean): void {
        this.modelInstance.setMaterialColorWriteEnabled(materialName, v);
    }
    
    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
        this.childObjects.forEach((child)=> child.setVertexColorsEnabled(v));
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
        this.childObjects.forEach((child)=> child.setTexturesEnabled(v));
    }

    public setColors(colors: Colors): void {
        this.modelInstance.setColorOverride(ColorKind.C0, colors.actorShadow);
        this.modelInstance.setColorOverride(ColorKind.K0, colors.actorAmbient);

        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].setColors(colors);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, visible: boolean): void {
        this.modelInstance.visible = visible && this.visible;

        if (this.modelInstance.visible) {
            if (this.parentJointMatrix !== null) {
                mat4.mul(this.modelInstance.modelMatrix, this.parentJointMatrix, this.modelMatrix);
            } else {
                mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);

                // Don't compute screen area culling on child meshes (don't want heads to disappear before bodies.)
                bboxScratch.transform(this.modelInstance.bmdModel.bbox, this.modelInstance.modelMatrix);
                computeScreenSpaceProjectionFromWorldSpaceAABB(screenProjection, viewerInput.camera, bboxScratch);

                if (screenProjection.getScreenArea() <= 0.0002)
                    this.modelInstance.visible = false;
            }
        }

        const light = this.modelInstance.getGXLightReference(0);
        GX_Material.lightSetWorldPosition(light, viewerInput.camera, 250, 250, 250);
        GX_Material.lightSetWorldDirection(light, viewerInput.camera, -250, -250, -250);
        // Toon lighting works by setting the color to red.
        colorFromRGBA(light.Color, 1, 0, 0, 0);
        vec3.set(light.CosAtten, 1.075, 0, 0);
        vec3.set(light.DistAtten, 1.075, 0, 0);

        this.modelInstance.prepareToRender(renderHelper, viewerInput);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].prepareToRender(renderHelper, viewerInput, this.modelInstance.visible);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].destroy(device);
    }
}

export type SymbolData = { Filename: string, SymbolName: string, Data: ArrayBufferSlice };
export type SymbolMap = { SymbolData: SymbolData[] };

function findSymbol(symbolMap: SymbolMap, filename: string, symbolName: string): ArrayBufferSlice {
    const entry = assertExists(symbolMap.SymbolData.find((e) => e.Filename === filename && e.SymbolName === symbolName));
    return entry.Data;
}

export interface FlowerData {
    textureMapping: TextureMapping;
    gfxSampler: GfxSampler;
    shapeHelperMain: GXShapeHelperGfx;
    gxMaterial: GX_Material.GXMaterial;
    bufferCoalescer: GfxBufferCoalescer;
    destroy(device: GfxDevice): void;
}

export class WhiteFlowerData {
    public textureMapping = new TextureMapping();
    public gfxSampler: GfxSampler;
    public shapeHelperMain: GXShapeHelperGfx;
    public gxMaterial: GX_Material.GXMaterial;
    public bufferCoalescer: GfxBufferCoalescer;

    constructor(device: GfxDevice, symbolMap: SymbolMap, renderHelper: GXRenderHelperGfx, textureHolder: GXTextureHolder) {
        const l_matDL = findSymbol(symbolMap, `d_flower.o`, `l_matDL`);
        const l_Txo_ob_flower_white_64x64TEX = findSymbol(symbolMap, `d_flower.o`, `l_Txo_ob_flower_white_64x64TEX`);
        const l_pos = findSymbol(symbolMap, `d_flower.o`, `l_pos`);
        const l_texCoord = findSymbol(symbolMap, `d_flower.o`, `l_texCoord`);
        const l_OhanaDL = findSymbol(symbolMap, `d_flower.o`, `l_OhanaDL`);
        const l_color2 = findSymbol(symbolMap, `d_flower.o`, `l_color2`);

        const matRegisters = new DisplayListRegisters();
        runDisplayListRegisters(matRegisters, l_matDL);

        const genMode = matRegisters.bp[GX.BPRegister.GEN_MODE_ID];
        const numTexGens = (genMode >>> 0) & 0x0F;
        const numTevs = ((genMode >>> 10) & 0x0F) + 1;
        const numInds = ((genMode >>> 16) & 0x07);

        const hw2cm: GX.CullMode[] = [ GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL ];
        const cullMode = hw2cm[((genMode >>> 14)) & 0x03];

        this.gxMaterial = parseMaterialEntry(matRegisters, 0, 'l_matDL', numTexGens, numTevs, numInds);
        this.gxMaterial.cullMode = cullMode;

        const image0 = matRegisters.bp[GX.BPRegister.TX_SETIMAGE0_I0_ID];
        const width  = ((image0 >>>  0) & 0x3FF) + 1;
        const height = ((image0 >>> 10) & 0x3FF) + 1;
        const format: GX.TexFormat = (image0 >>> 20) & 0x0F;

        const texture: TEX1_TextureData = {
            name: 'l_Txo_ob_flower_white_64x64TEX',
            width, height, format,
            data: l_Txo_ob_flower_white_64x64TEX,
            // TODO(jstpierre): do we have mips?
            mipCount: 1,
            paletteFormat: GX.TexPalette.RGB565,
            paletteData: null,
        };
        textureHolder.addTextures(device, [texture]);
        textureHolder.fillTextureMapping(this.textureMapping, texture.name);

        const mode0 = matRegisters.bp[GX.BPRegister.TX_SETMODE0_I0_ID];
        const wrapS: GX.WrapMode = (mode0 >>> 0) & 0x03;
        const wrapT: GX.WrapMode = (mode0 >>> 2) & 0x03;

        this.gfxSampler = device.createSampler({
            wrapS: translateWrapModeGfx(wrapS),
            wrapT: translateWrapModeGfx(wrapT),
            minFilter: GfxTexFilterMode.BILINEAR, magFilter: GfxTexFilterMode.BILINEAR, mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 1, maxLOD: 1,
        });
        this.textureMapping.gfxSampler = this.gfxSampler;

        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.VertexAttribute.POS] = { buffer: l_pos, offs: 0 };
        vtxArrays[GX.VertexAttribute.CLR0] = { buffer: l_color2, offs: 0 };
        vtxArrays[GX.VertexAttribute.TEX0] = { buffer: l_texCoord, offs: 0 };
        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.VertexAttribute.POS] = { compCnt: GX.CompCnt.POS_XYZ, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.VertexAttribute.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.VertexAttribute.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compShift: 0, compType: GX.CompType.RGBA8 };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.VertexAttribute.POS] = { type: GX.AttrType.INDEX8 };
        vcd[GX.VertexAttribute.CLR0] = { type: GX.AttrType.INDEX8 };
        vcd[GX.VertexAttribute.TEX0] = { type: GX.AttrType.INDEX8 };
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        const vtx_l_OhanaDL = vtxLoader.runVertices(vtxArrays, l_OhanaDL);

        // TODO(jstpierre): light channels
        this.gxMaterial.lightChannels.push({
            colorChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
            alphaChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
        });

        this.bufferCoalescer = loadedDataCoalescerGfx(device, [ vtx_l_OhanaDL ]);
        this.shapeHelperMain = new GXShapeHelperGfx(device, renderHelper, this.bufferCoalescer.coalescedBuffers[0], vtxLoader.loadedVertexLayout, vtx_l_OhanaDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeHelperMain.destroy(device);
        device.destroySampler(this.gfxSampler);
    }
}

export class PinkFlowerData {
    public textureMapping = new TextureMapping();
    public gfxSampler: GfxSampler;
    public shapeHelperMain: GXShapeHelperGfx;
    public gxMaterial: GX_Material.GXMaterial;
    public bufferCoalescer: GfxBufferCoalescer;

    constructor(device: GfxDevice, symbolMap: SymbolMap, renderHelper: GXRenderHelperGfx, textureHolder: GXTextureHolder) {
        const l_matDL2 = findSymbol(symbolMap, `d_flower.o`, `l_matDL2`);
        const l_Txo_ob_flower_pink_64x64TEX = findSymbol(symbolMap, `d_flower.o`, `l_Txo_ob_flower_pink_64x64TEX`);
        const l_pos2 = findSymbol(symbolMap, `d_flower.o`, `l_pos2`);
        const l_texCoord2 = findSymbol(symbolMap, `d_flower.o`, `l_texCoord2`);
        const l_Ohana_highDL = findSymbol(symbolMap, `d_flower.o`, `l_Ohana_highDL`);
        const l_color2 = findSymbol(symbolMap, `d_flower.o`, `l_color2`);

        const matRegisters = new DisplayListRegisters();
        runDisplayListRegisters(matRegisters, l_matDL2);

        const genMode = matRegisters.bp[GX.BPRegister.GEN_MODE_ID];
        const numTexGens = (genMode >>> 0) & 0x0F;
        const numTevs = ((genMode >>> 10) & 0x0F) + 1;
        const numInds = ((genMode >>> 16) & 0x07);

        const hw2cm: GX.CullMode[] = [ GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL ];
        const cullMode = hw2cm[((genMode >>> 14)) & 0x03];

        this.gxMaterial = parseMaterialEntry(matRegisters, 0, 'l_matDL', numTexGens, numTevs, numInds);
        this.gxMaterial.cullMode = cullMode;

        const image0 = matRegisters.bp[GX.BPRegister.TX_SETIMAGE0_I0_ID];
        const width  = ((image0 >>>  0) & 0x3FF) + 1;
        const height = ((image0 >>> 10) & 0x3FF) + 1;
        const format: GX.TexFormat = (image0 >>> 20) & 0x0F;

        const texture: TEX1_TextureData = {
            name: 'l_Txo_ob_flower_pink_64x64TEX',
            width, height, format,
            data: l_Txo_ob_flower_pink_64x64TEX,
            // TODO(jstpierre): do we have mips?
            mipCount: 1,
            paletteFormat: GX.TexPalette.RGB565,
            paletteData: null,
        };
        textureHolder.addTextures(device, [texture]);
        textureHolder.fillTextureMapping(this.textureMapping, texture.name);

        const mode0 = matRegisters.bp[GX.BPRegister.TX_SETMODE0_I0_ID];
        const wrapS: GX.WrapMode = (mode0 >>> 0) & 0x03;
        const wrapT: GX.WrapMode = (mode0 >>> 2) & 0x03;

        this.gfxSampler = device.createSampler({
            wrapS: translateWrapModeGfx(wrapS),
            wrapT: translateWrapModeGfx(wrapT),
            minFilter: GfxTexFilterMode.BILINEAR, magFilter: GfxTexFilterMode.BILINEAR, mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 1, maxLOD: 1,
        });
        this.textureMapping.gfxSampler = this.gfxSampler;

        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.VertexAttribute.POS] = { buffer: l_pos2, offs: 0 };
        vtxArrays[GX.VertexAttribute.CLR0] = { buffer: l_color2, offs: 0 };
        vtxArrays[GX.VertexAttribute.TEX0] = { buffer: l_texCoord2, offs: 0 };
        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.VertexAttribute.POS] = { compCnt: GX.CompCnt.POS_XYZ, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.VertexAttribute.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.VertexAttribute.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compShift: 0, compType: GX.CompType.RGBA8 };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.VertexAttribute.POS] = { type: GX.AttrType.INDEX8 };
        vcd[GX.VertexAttribute.CLR0] = { type: GX.AttrType.INDEX8 };
        vcd[GX.VertexAttribute.TEX0] = { type: GX.AttrType.INDEX8 };
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        const vtx_l_OhanaDL = vtxLoader.runVertices(vtxArrays, l_Ohana_highDL);

        // TODO(jstpierre): light channels
        this.gxMaterial.lightChannels.push({
            colorChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
            alphaChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
        });

        this.bufferCoalescer = loadedDataCoalescerGfx(device, [ vtx_l_OhanaDL ]);
        this.shapeHelperMain = new GXShapeHelperGfx(device, renderHelper, this.bufferCoalescer.coalescedBuffers[0], vtxLoader.loadedVertexLayout, vtx_l_OhanaDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeHelperMain.destroy(device);
        device.destroySampler(this.gfxSampler);
    }
}

export class BessouFlowerData {
    public textureMapping = new TextureMapping();
    public gfxSampler: GfxSampler;
    public shapeHelperMain: GXShapeHelperGfx;
    public gxMaterial: GX_Material.GXMaterial;
    public bufferCoalescer: GfxBufferCoalescer;

    constructor(device: GfxDevice, symbolMap: SymbolMap, renderHelper: GXRenderHelperGfx, textureHolder: GXTextureHolder) {
        const l_matDL3 = findSymbol(symbolMap, `d_flower.o`, `l_matDL3`);
        const l_Txq_bessou_hanaTEX = findSymbol(symbolMap, `d_flower.o`, `l_Txq_bessou_hanaTEX`);
        const l_pos3 = findSymbol(symbolMap, `d_flower.o`, `l_pos3`);
        const l_texCoord3 = findSymbol(symbolMap, `d_flower.o`, `l_texCoord3`);
        const l_QbsfwDL = findSymbol(symbolMap, `d_flower.o`, `l_QbsfwDL`);
        const l_color2 = findSymbol(symbolMap, `d_flower.o`, `l_color2`);

        const matRegisters = new DisplayListRegisters();
        runDisplayListRegisters(matRegisters, l_matDL3);

        const genMode = matRegisters.bp[GX.BPRegister.GEN_MODE_ID];
        const numTexGens = (genMode >>> 0) & 0x0F;
        const numTevs = ((genMode >>> 10) & 0x0F) + 1;
        const numInds = ((genMode >>> 16) & 0x07);

        const hw2cm: GX.CullMode[] = [ GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL ];
        const cullMode = hw2cm[((genMode >>> 14)) & 0x03];

        this.gxMaterial = parseMaterialEntry(matRegisters, 0, 'l_matDL', numTexGens, numTevs, numInds);
        this.gxMaterial.cullMode = cullMode;

        const image0 = matRegisters.bp[GX.BPRegister.TX_SETIMAGE0_I0_ID];
        const width  = ((image0 >>>  0) & 0x3FF) + 1;
        const height = ((image0 >>> 10) & 0x3FF) + 1;
        const format: GX.TexFormat = (image0 >>> 20) & 0x0F;

        const texture: TEX1_TextureData = {
            name: 'l_Txq_bessou_hanaTEX',
            width, height, format,
            data: l_Txq_bessou_hanaTEX,
            // TODO(jstpierre): do we have mips?
            mipCount: 1,
            paletteFormat: GX.TexPalette.RGB565,
            paletteData: null,
        };
        textureHolder.addTextures(device, [texture]);
        textureHolder.fillTextureMapping(this.textureMapping, texture.name);

        const mode0 = matRegisters.bp[GX.BPRegister.TX_SETMODE0_I0_ID];
        const wrapS: GX.WrapMode = (mode0 >>> 0) & 0x03;
        const wrapT: GX.WrapMode = (mode0 >>> 2) & 0x03;

        this.gfxSampler = device.createSampler({
            wrapS: translateWrapModeGfx(wrapS),
            wrapT: translateWrapModeGfx(wrapT),
            minFilter: GfxTexFilterMode.BILINEAR, magFilter: GfxTexFilterMode.BILINEAR, mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 1, maxLOD: 1,
        });
        this.textureMapping.gfxSampler = this.gfxSampler;

        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.VertexAttribute.POS] = { buffer: l_pos3, offs: 0 };
        vtxArrays[GX.VertexAttribute.CLR0] = { buffer: l_color2, offs: 0 };
        vtxArrays[GX.VertexAttribute.TEX0] = { buffer: l_texCoord3, offs: 0 };
        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.VertexAttribute.POS] = { compCnt: GX.CompCnt.POS_XYZ, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.VertexAttribute.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.VertexAttribute.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compShift: 0, compType: GX.CompType.RGBA8 };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.VertexAttribute.POS] = { type: GX.AttrType.INDEX8 };
        vcd[GX.VertexAttribute.CLR0] = { type: GX.AttrType.INDEX8 };
        vcd[GX.VertexAttribute.TEX0] = { type: GX.AttrType.INDEX8 };
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        const vtx_l_OhanaDL = vtxLoader.runVertices(vtxArrays, l_QbsfwDL);

        // TODO(jstpierre): light channels
        this.gxMaterial.lightChannels.push({
            colorChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
            alphaChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
        });

        this.bufferCoalescer = loadedDataCoalescerGfx(device, [ vtx_l_OhanaDL ]);
        this.shapeHelperMain = new GXShapeHelperGfx(device, renderHelper, this.bufferCoalescer.coalescedBuffers[0], vtxLoader.loadedVertexLayout, vtx_l_OhanaDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeHelperMain.destroy(device);
        device.destroySampler(this.gfxSampler);
    }
}

const packetParams = new PacketParams();
const materialParams = new MaterialParams();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export class FlowerObjectRenderer implements ObjectRenderer {
    public modelMatrix = mat4.create();

    private materialHelper: GXMaterialHelperGfx;
    private renderInst: GfxRenderInst;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, private flowerData: FlowerData) {
        const renderInstBuilder = renderHelper.renderInstBuilder;

        this.materialHelper = new GXMaterialHelperGfx(device, renderHelper, this.flowerData.gxMaterial);

        renderInstBuilder.pushTemplateRenderInst(this.materialHelper.templateRenderInst);
        this.renderInst = flowerData.shapeHelperMain.buildRenderInst(renderInstBuilder);
        renderInstBuilder.pushRenderInst(this.renderInst);
        renderInstBuilder.popTemplateRenderInst();
    }

    public setVertexColorsEnabled(v: boolean): void {
    }

    public setTexturesEnabled(v: boolean): void {
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, visible: boolean): void {
        this.renderInst.visible = visible;

        // Do some basic distance culling.
        mat4.getTranslation(scratchVec3a, viewerInput.camera.worldMatrix);
        mat4.getTranslation(scratchVec3b, this.modelMatrix);

        // If we're too far, just kill us entirely.
        const distSq = vec3.squaredDistance(scratchVec3a, scratchVec3b);
        const maxDist = 5000;
        const maxDistSq = maxDist*maxDist;
        if (distSq >= maxDistSq)
            this.renderInst.visible = false;

        if (this.renderInst.visible) {
            materialParams.m_TextureMapping[0].copy(this.flowerData.textureMapping);
            colorFromRGBA(materialParams.u_Color[ColorKind.C0], 1.0, 1.0, 1.0, 1.0);
            colorFromRGBA(materialParams.u_Color[ColorKind.C1], 1.0, 1.0, 1.0, 1.0);
            const S = 0.5;
            mat4.fromScaling(materialParams.u_PostTexMtx[0], [S, S, S]);
            this.materialHelper.fillMaterialParams(materialParams, renderHelper);

            const m = packetParams.u_PosMtx[0];
            computeViewMatrix(m, viewerInput.camera);
            mat4.mul(m, m, this.modelMatrix);
            renderHelper.fillPacketParams(packetParams, this.renderInst.getUniformBufferOffset(ub_PacketParams));
        }
    }

    public setColors(colors: Colors): void {
    }

    public destroy(device: GfxDevice): void {
        this.materialHelper.destroy(device);
    }
}
