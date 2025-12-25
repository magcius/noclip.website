
import { mat4, vec3 } from "gl-matrix";
import { White, colorCopy, colorFromRGBA, colorNewCopy } from "../Color.js";
import { projectionMatrixForCuboid, saturate } from '../MathHelpers.js';
import { TSDraw } from "../SuperMarioGalaxy/DDraw.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers.js';
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxClipSpaceNearZ, GfxDevice, GfxInputLayout } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInst, GfxRenderInstExecutionOrder, GfxRenderInstList, GfxRenderInstManager, gfxRenderInstCompareNone, gfxRenderInstCompareSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder.js';
import { DisplayListRegisters, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, compileVtxLoader, displayListRegistersInitGX, displayListRegistersRun } from "../gx/gx_displaylist.js";
import * as GX from '../gx/gx_enum.js';
import { GX_Program, parseMaterial } from '../gx/gx_material.js';
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams, SceneParams, createInputLayout, fillSceneParamsData, ub_SceneParamsBufferSize } from "../gx/gx_render.js";
import { assert, nArray } from '../util.js';
import { ViewerRenderInput } from '../viewer.js';
import { SymbolMap, dGlobals } from './Main.js';
import { PeekZManager } from "./d_dlst_peekZ.js";
import { cBgS_PolyInfo } from "./d_bg.js";
import { BTI, BTI_Texture, BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { dKy_tevstr_c } from "./d_kankyo.js";
import { mDoMtx_YrotM } from "./m_do_mtx.js";
import { cM_s2rad } from "./SComponent.js";
import { dRes_control_c, ResType } from "./d_resorce.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";

export enum dDlst_alphaModel__Type {
    Bonbori,
    BonboriTwice,
    BeamCheck,
    Cube,
    Bonbori2,
    BonboriThrice,
}

class dDlst_alphaModelData_c {
    constructor(public type: dDlst_alphaModel__Type, public mtx: mat4, public alpha: number) {
    }
}

export class dDlst_BasicShape_c {
    public inputLayout: GfxInputLayout;
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public indexCount: number;

    constructor(cache: GfxRenderCache, loadedVertexLayout: LoadedVertexLayout, loadedVertexData: LoadedVertexData) {
        this.inputLayout = createInputLayout(cache, loadedVertexLayout);
        this.vertexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, loadedVertexData.vertexBuffers[0]);
        this.indexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, loadedVertexData.indexData);
        assert(loadedVertexData.draws.length === 1);
        assert(loadedVertexData.draws[0].indexOffset === 0);
        this.indexCount = loadedVertexData.draws[0].indexCount;
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setVertexInput(this.inputLayout, [{ buffer: this.vertexBuffer }], { buffer: this.indexBuffer });
        renderInst.setDrawCount(this.indexCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

const drawParams = new DrawParams();
const materialParams = new MaterialParams();
class dDlst_alphaModel_c {
    public color = colorNewCopy(White);
    private datas: dDlst_alphaModelData_c[] = [];

    private materialHelperBackRevZ: GXMaterialHelperGfx;
    private materialHelperFrontZ: GXMaterialHelperGfx;
    private bonboriShape: dDlst_BasicShape_c;

    private materialHelperDrawAlpha: GXMaterialHelperGfx;
    private orthoSceneParams = new SceneParams();
    private orthoQuad = new TSDraw();

    constructor(device: GfxDevice, cache: GfxRenderCache, symbolMap: SymbolMap) {
        const bonboriPos = symbolMap.findSymbolData(`d_drawlist.o`, `l_bonboriPos`);
        const bonboriDL = symbolMap.findSymbolData(`d_drawlist.o`, `l_bonboriDL`);

        const vat: GX_VtxAttrFmt[] = [];
        vat[GX.Attr.POS] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.POS_XYZ, compShift: 0 };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX8 };
        const bonboriVtxLoader = compileVtxLoader(vat, vcd);

        const shadowVtxArrays: GX_Array[] = [];
        shadowVtxArrays[GX.Attr.POS] = { buffer: bonboriPos, offs: 0, stride: 0x0C };
        const bonboriVertices = bonboriVtxLoader.runVertices(shadowVtxArrays, bonboriDL);
        this.bonboriShape = new dDlst_BasicShape_c(cache, bonboriVtxLoader.loadedVertexLayout, bonboriVertices);

        const matRegisters = new DisplayListRegisters();
        displayListRegistersInitGX(matRegisters);

        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_matDL$5108`));

        // Original game uses three different materials -- two add, one sub. We can reduce this to two draws.
        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_backRevZMat`));
        this.materialHelperBackRevZ = new GXMaterialHelperGfx(parseMaterial(matRegisters, `dDlst_alphaModel_c l_backRevZMat`));
        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_frontZMat`));
        const frontZ = parseMaterial(matRegisters, `dDlst_alphaModel_c l_frontZMat`);
        frontZ.ropInfo.blendMode = GX.BlendMode.SUBTRACT;
        frontZ.ropInfo.depthFunc = GX.CompareType.GREATER;
        this.materialHelperFrontZ = new GXMaterialHelperGfx(frontZ);

        assert(this.materialHelperBackRevZ.materialParamsBufferSize === this.materialHelperFrontZ.materialParamsBufferSize);

        const mb = new GXMaterialBuilder(`dDlst_alphaModel_c drawAlphaBuffer`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.DSTALPHA, GX.BlendFactor.ONE); // the magic is the DSTALPHA
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        this.materialHelperDrawAlpha = new GXMaterialHelperGfx(mb.finish());

        projectionMatrixForCuboid(this.orthoSceneParams.u_Projection, 0, 1, 0, 1, 0, 10);
        const clipSpaceNearZ = device.queryVendorInfo().clipSpaceNearZ;
        projectionMatrixConvertClipSpaceNearZ(this.orthoSceneParams.u_Projection, clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);

        this.orthoQuad.setVtxDesc(GX.Attr.POS, true);

        this.orthoQuad.beginDraw(cache);
        this.orthoQuad.begin(GX.Command.DRAW_QUADS, 4);
        this.orthoQuad.position3f32(0, 0, 0);
        this.orthoQuad.position3f32(1, 0, 0);
        this.orthoQuad.position3f32(1, 1, 0);
        this.orthoQuad.position3f32(0, 1, 0);
        this.orthoQuad.end();
        this.orthoQuad.endDraw(cache);
    }

    private reset(): void {
        this.datas.length = 0;
    }

    public set(type: dDlst_alphaModel__Type, mtx: mat4, alpha: number): void {
        this.datas.push(new dDlst_alphaModelData_c(type, mtx, alpha));
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.datas.length === 0)
            return;

        const cache = globals.modelCache.cache;

        for (let i = 0; i < this.datas.length; i++) {
            const data = this.datas[i];

            const template = renderInstManager.pushTemplate();

            if (data.type === dDlst_alphaModel__Type.Bonbori) {
                this.bonboriShape.setOnRenderInst(template);
                mat4.mul(drawParams.u_PosMtx[0], globals.camera.viewFromWorldMatrix, data.mtx);
                this.materialHelperBackRevZ.allocateDrawParamsDataOnInst(template, drawParams);

                materialParams.u_Color[ColorKind.MAT0].a = data.alpha / 0xFF;

                // These materials should all have the same buffer size (asserted for in constructor)
                this.materialHelperBackRevZ.allocateMaterialParamsDataOnInst(template, materialParams);

                const back = renderInstManager.newRenderInst();
                this.materialHelperBackRevZ.setOnRenderInst(cache, back);
                renderInstManager.submitRenderInst(back);

                const front = renderInstManager.newRenderInst();
                this.materialHelperFrontZ.setOnRenderInst(cache, front);
                renderInstManager.submitRenderInst(front);
            }

            renderInstManager.popTemplate();
        }

        // Blend onto main screen.
        const renderInst = renderInstManager.newRenderInst();
        const sceneParamsOffs = renderInst.allocateUniformBuffer(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(renderInst.mapUniformBufferF32(GX_Program.ub_SceneParams), sceneParamsOffs, this.orthoSceneParams);
        this.materialHelperDrawAlpha.setOnRenderInst(cache, renderInst);
        colorCopy(materialParams.u_Color[ColorKind.MAT0], this.color);
        this.materialHelperDrawAlpha.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        this.orthoQuad.setOnRenderInst(renderInst);
        mat4.identity(drawParams.u_PosMtx[0]);
        this.materialHelperDrawAlpha.allocateDrawParamsDataOnInst(renderInst, drawParams);
        renderInstManager.submitRenderInst(renderInst);

        this.reset();
    }

    public destroy(device: GfxDevice): void {
        this.bonboriShape.destroy(device);
        this.orthoQuad.destroy(device);
    }
}

export type dDlst_list_Set = [GfxRenderInstList, GfxRenderInstList];

export class dDlst_list_c {
    public sky: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];
    public sea = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards);
    public bg: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
    ];
    public wetherEffect = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards);
    public wetherEffectSet: dDlst_list_Set = [
        this.wetherEffect, this.wetherEffect,
    ]
    public effect: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
    ];
    public ui: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];

    // These correspond to 2DOpa and 2DXlu
    public ui2D: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards)
    ];

    public particle2DBack = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    public particle2DFore = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);

    public alphaModel = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    public shadow = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    public peekZ = new PeekZManager(128);
    public alphaModel0: dDlst_alphaModel_c;
    public shadowControl: dDlst_shadowControl_c;

    constructor(device: GfxDevice, cache: GfxRenderCache, resCtrl: dRes_control_c, symbolMap: SymbolMap) {
        this.alphaModel0 = new dDlst_alphaModel_c(device, cache, symbolMap);
        this.shadowControl = new dDlst_shadowControl_c(device, cache, resCtrl, symbolMap);
    }

    public destroy(device: GfxDevice): void {
        this.peekZ.destroy(device);
        this.alphaModel0.destroy(device);
        this.shadowControl.destroy(device);
    }
}

class dDlst_shadowSimple_c {
    public alpha: number = 0; // 0-255
    public tex: BTIData | null = null;
    public modelViewMtx = mat4.create();
    public texMtx = mat4.create();

    private static shadowVolumeShape: dDlst_BasicShape_c;
    private static shadowSealShape: dDlst_BasicShape_c;
    private static shadowSealTexShape: dDlst_BasicShape_c;

    private static frontMat: GXMaterialHelperGfx;
    private static backSubMat: GXMaterialHelperGfx;
    private static sealTexMat: GXMaterialHelperGfx;
    private static sealMat: GXMaterialHelperGfx;
    private static clearMat: GXMaterialHelperGfx;

    static compileDL(device: GfxDevice, cache: GfxRenderCache, symbolMap: SymbolMap) {
        const vat: GX_VtxAttrFmt[] = [];
        vat[GX.Attr.POS] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.POS_XYZ, compShift: 0 };
        vat[GX.Attr.TEX0] = { compType: GX.CompType.S8, compCnt: GX.CompCnt.TEX_ST, compShift: 0 };
        
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX8 };
        const shadowVtxLoader = compileVtxLoader(vat, vcd);

        // The `l_shadowSealDL` display list contains both register setting commands and draws. Split it up.
        const shadowSealMat = symbolMap.findSymbolData(`d_drawlist.o`, `l_shadowSealDL`).slice(0, 0x42);
        const shadowSealDrw = symbolMap.findSymbolData(`d_drawlist.o`, `l_shadowSealDL`).slice(0x42, 0);
        
        // Same for `l_shadowSealTexDL` ...
        const shadowSealTexMat = symbolMap.findSymbolData(`d_drawlist.o`, `l_shadowSealTexDL`).slice(0, 0x26);
        const shadowSealTexDrw = symbolMap.findSymbolData(`d_drawlist.o`, `l_shadowSealTexDL`).slice(0x26, 0);

        // A simple box shadow volume, providing verts within a [-1, 1] cube.
        const simpleShadowPos = symbolMap.findSymbolData(`d_drawlist.o`, `l_simpleShadowPos`);
        const shadowVtxArrays: GX_Array[] = [];
        shadowVtxArrays[GX.Attr.POS] = { buffer: simpleShadowPos, offs: 0, stride: 0x0C };

        // Construct a basic box shape representing the "simple" shadow volume.
        const shadowVolumeDL = symbolMap.findSymbolData(`d_drawlist.o`, `l_shadowVolumeDL`)
        const shadowVolVerts = shadowVtxLoader.runVertices(shadowVtxArrays, shadowVolumeDL);
        this.shadowVolumeShape = new dDlst_BasicShape_c(cache, shadowVtxLoader.loadedVertexLayout, shadowVolVerts);

        // Construct the "seal" shape using the same pos-only verts.
        const shadowSealVerts = shadowVtxLoader.runVertices(shadowVtxArrays, shadowSealDrw);
        this.shadowSealShape = new dDlst_BasicShape_c(cache, shadowVtxLoader.loadedVertexLayout, shadowSealVerts);
        
        // Construct the gobo seal shape which only applies alpha to the color buffer where the texture is opaque.
        vcd[GX.Attr.TEX0] = { type: GX.AttrType.DIRECT };
        const shadowTexVtxLoader = compileVtxLoader(vat, vcd)
        const shadowSealTexVerts = shadowTexVtxLoader.runVertices(shadowVtxArrays, shadowSealTexDrw);
        this.shadowSealTexShape = new dDlst_BasicShape_c(cache, shadowTexVtxLoader.loadedVertexLayout, shadowSealTexVerts);

        // Construct materials
        {
            const matRegisters = new DisplayListRegisters();
            displayListRegistersInitGX(matRegisters);

            // Writes GX_TEVREG0.a (0x40) on every front face that passes the depth test 
            // These are the first draw calls to write alpha each frame, so it assumes the alpha channel is empty
            displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_frontMat`));
            this.frontMat = new GXMaterialHelperGfx(parseMaterial(matRegisters, `dDlst_shadowSimple_c l_frontMat`));
            
            // Subtract GX_TEVREG0.a (0x40)on every back face that passes the depth test
            // The result after frontMat and backMat are rendered is 0x40 written everywhere the shadow should be drawn
            displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_backSubMat`));
            this.backSubMat = new GXMaterialHelperGfx(parseMaterial(matRegisters, `dDlst_shadowSimple_c l_backSubMat`));

            // Zero the alpha channel anywhere that the shadow texture is transparent
            displayListRegistersRun(matRegisters, shadowSealTexMat);
            const tempMat = parseMaterial(matRegisters, `dDlst_shadowSimple_c shadowSealTexMat`)
            tempMat.alphaTest.op = GX.AlphaOp.OR;
            tempMat.alphaTest.compareA = GX.CompareType.ALWAYS;
            tempMat.ropInfo.colorUpdate = true;
            tempMat.tevStages[0].colorInD = GX.CC.TEXC;
            tempMat.ropInfo.blendMode = 0;
            // tempMat.texGens[0] = { type: GX.TexGenType.MTX2x4, source: GX.TexGenSrc.TEX0, matrix: GX.TexGenMatrix.IDENTITY, normalize: true, postMatrix: GX.PostTexGenMatrix.PTIDENTITY };
            this.sealTexMat = new GXMaterialHelperGfx(tempMat);

            // Multiply buffer color by the alpha channel
            displayListRegistersRun(matRegisters, shadowSealMat);
            this.sealMat = new GXMaterialHelperGfx(parseMaterial(matRegisters, `dDlst_shadowSimple_c l_shadowSealDL`));

            // Write GX_TEVREG1.a (0x00) to everywhere the shadow volume was drawn 
            // Clears the alpha channel for future transparent object rendering
            displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_clearMat`));
            this.clearMat = new GXMaterialHelperGfx(parseMaterial(matRegisters, `dDlst_shadowSimple_c l_clearMat`));

            // TODO: Disable Alpha test via matRegisters so that it affects all above materials (instead of doing it manually here)
            this.sealMat.material.alphaTest.op = GX.AlphaOp.OR;
            this.sealMat.material.alphaTest.compareA = GX.CompareType.ALWAYS;
            this.sealMat.invalidateMaterial();
            this.frontMat.material.alphaTest.op = GX.AlphaOp.OR;
            this.frontMat.material.alphaTest.compareA = GX.CompareType.ALWAYS;
            this.frontMat.invalidateMaterial();
            this.backSubMat.material.alphaTest.op = GX.AlphaOp.OR;
            this.backSubMat.material.alphaTest.compareA = GX.CompareType.ALWAYS;
            this.backSubMat.invalidateMaterial();
        }
    }

    static destroy(device: GfxDevice): void {
        this.shadowVolumeShape.destroy(device);
        this.shadowSealShape.destroy(device);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager): void {
        const cache = globals.modelCache.cache;

        mat4.copy(drawParams.u_PosMtx[0], this.modelViewMtx);
        mat4.copy(drawParams.u_PosMtx[1], this.texMtx);
        colorFromRGBA(materialParams.u_Color[ColorKind.C0], 0, 0, 0, 0x40 / 0xFF);
        colorFromRGBA(materialParams.u_Color[ColorKind.C1], 0, 0, 0, 0);
        colorFromRGBA(materialParams.u_Color[ColorKind.C2], 1, 1, 1, 1);
        mat4.identity(materialParams.u_PostTexMtx[0]);
        if (this.tex) this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);

        // const template = renderInstManager.pushTemplate();
        // dDlst_shadowSimple_c.shadowVolumeShape.setOnRenderInst(template);
        // dDlst_shadowSimple_c.frontMat.allocateDrawParamsDataOnInst(template, drawParams);
        // dDlst_shadowSimple_c.sealTexMat.allocateMaterialParamsDataOnInst(template, materialParams);

        // Front face shadow volume (add 0.25 to alpha channel for front faces)
        // const front = renderInstManager.newRenderInst()
        // dDlst_shadowSimple_c.frontMat.setOnRenderInst(cache, front);
        // renderInstManager.submitRenderInst(front);

        // // Back face shadow volume (subtract 0.25 from alpha channel for back faces)
        // const back = renderInstManager.newRenderInst()
        // dDlst_shadowSimple_c.backSubMat.setOnRenderInst(cache, back);
        // renderInstManager.submitRenderInst(back);

        // If a texture is set, clear the alpha channel where the texture is transparent
        if (this.tex) {
            // TODO: This doesn't seem to be reading the texture
            const texSeal = renderInstManager.newRenderInst()
            mat4.copy(drawParams.u_PosMtx[0], this.texMtx);
            mat4.identity(materialParams.u_PostTexMtx[0]);
            this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
            dDlst_shadowSimple_c.sealTexMat.allocateDrawParamsDataOnInst(texSeal, drawParams);
            dDlst_shadowSimple_c.sealTexMat.allocateMaterialParamsDataOnInst(texSeal, materialParams);
            dDlst_shadowSimple_c.sealTexMat.setOnRenderInst(cache, texSeal);
            dDlst_shadowSimple_c.shadowSealTexShape.setOnRenderInst(texSeal)
            renderInstManager.submitRenderInst(texSeal);

            // @TODO: Handle non square shadows
            //        GXCallDisplayList(l_shadowSealTex2DL, 0x40);
        }

        // Multiply color by the alpha channel
        // const seal = renderInstManager.newRenderInst()
        // dDlst_shadowSimple_c.sealMat.setOnRenderInst(cache, seal);
        // // TODO: Why doesn't this just use the volume shape? Should we just do a fullscreen seal & clear pass like AlphaModel?
        // // dDlst_shadowSimple_c.shadowSealShape.setOnRenderInst(seal);
        // renderInstManager.submitRenderInst(seal);

        // // Clear the alpha channel for future transparent object rendering
        // const clear = renderInstManager.newRenderInst()
        // dDlst_shadowSimple_c.clearMat.setOnRenderInst(cache, clear);
        // dDlst_shadowSimple_c.shadowVolumeShape.setOnRenderInst(clear);
        // renderInstManager.submitRenderInst(clear);

        // renderInstManager.popTemplate();
        
    }

    public set(globals: dGlobals, pos: vec3, floorY: number, scaleXZ: number, floorNrm: vec3, rotY: number, scaleZ: number, tex: BTIData | null): void {
        const offsetY = scaleXZ * 16.0 * (1.0 - floorNrm[1]) + 1.0;
        
        // Build modelViewMtx
        mat4.fromTranslation(this.modelViewMtx, [pos[0], floorY + offsetY, pos[2]]);
        mat4.rotateY(this.modelViewMtx, this.modelViewMtx, cM_s2rad(rotY));
        mat4.scale(this.modelViewMtx, this.modelViewMtx, [scaleXZ, offsetY + offsetY + 16.0, scaleXZ * scaleZ]);
        mat4.mul(this.modelViewMtx, globals.camera.viewFromWorldMatrix, this.modelViewMtx);

        // Build texMtx (oriented to the floor plane)
        const xs = Math.sqrt(1.0 - floorNrm[0] * floorNrm[0]);
        let yy: number;
        let zz: number;
        if (xs !== 0.0) {
            yy = floorNrm[1] * xs;
            zz = -floorNrm[2] * xs;
        } else {
            yy = 0.0;
            zz = 0.0;
        }

        mat4.set(this.texMtx,
            xs, floorNrm[0], 0.0, 0.0,
            -floorNrm[0] * yy, floorNrm[1], zz, 0.0,
            floorNrm[0] * zz, floorNrm[2], yy, 0.0,
            pos[0], floorY, pos[2], 1.0
        );

        mat4.rotateY(this.texMtx, this.texMtx, cM_s2rad(rotY));
        mat4.scale(this.texMtx, this.texMtx, [scaleXZ, 1.0, scaleXZ * scaleZ]);
        mat4.mul(this.texMtx, globals.camera.viewFromWorldMatrix, this.texMtx);

        let opacity = 1.0 - saturate((pos[1] - floorY) * 0.0007);
        this.alpha = opacity * 64.0;
        this.tex = tex;
    }
}

class dDlst_shadowControl_c {
    private simples = nArray(128, () => new dDlst_shadowSimple_c());
    // private mReal = nArray(8, () => new dDlst_shadowReal_c());
    private nextID: number = 0;
    private simpleCount = 0;
    private realCount = 0;

    public static defaultSimpleTex: BTIData;

    constructor(device: GfxDevice, cache: GfxRenderCache, resCtrl: dRes_control_c, symbolMap: SymbolMap) {
        dDlst_shadowSimple_c.compileDL(device, cache, symbolMap);
        
        const img = resCtrl.getObjectRes(ResType.Raw, `Always`, 0x71); // ALWAYS_I4_BALL128B
        const bti: BTI_Texture = {
            name: img.name,
            format: GX.TexFormat.I4,
            width: 128,
            height: 128,
            data: img,
            mipCount: 1,
            wrapS: GX.WrapMode.CLAMP,
            wrapT: GX.WrapMode.CLAMP,
            minFilter: GX.TexFilter.LINEAR,
            magFilter: GX.TexFilter.LINEAR,
            minLOD: 0,
            maxLOD: 0,
            lodBias: 0,
            maxAnisotropy: GX.Anisotropy._1,
            paletteFormat: 0,
            paletteData: null,
        };
        dDlst_shadowControl_c.defaultSimpleTex = new BTIData(device, cache, bti);
    }

    destroy(device: GfxDevice): void {
        dDlst_shadowSimple_c.destroy(device);
    }

    public reset(): void {
        // TODO: Reset real
        this.simpleCount = 0;
    }

    public imageDraw(mtx: mat4): void {
        // TODO: Implementation
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewMtx: mat4): void {
        // dKy_GxFog_set();
    
        // Draw simple shadows
        for (let i = 0; i < this.simpleCount; i++) {
            this.simples[i].draw(globals, renderInstManager);
        }

        this.reset();
    }

    public setReal(id: number, param2: number, pModel: J3DModelInstance, pPos: vec3, param5: number, param6: number, pTevStr: dKy_tevstr_c): number {
        // TODO: Implementation
        return 0;
    }

    public setReal2(id: number, param2: number, pModel: J3DModelInstance, pPos: vec3, param5: number, param6: number, pTevStr: dKy_tevstr_c): number {
        // TODO: Implementation
        return 0;
    }

    public addReal(id: number, pModel: J3DModelInstance): boolean {
        // TODO: Implementation
        return false;
    }

    public setSimple(globals: dGlobals, pPos: vec3, groundY: number, scaleXZ: number, floorNrm: vec3, angle: number, scaleZ: number, pTexObj: BTIData | null): boolean {
        if (floorNrm === null || this.simpleCount >= this.simples.length)
            return false;

        const simple = this.simples[this.simpleCount++];
        simple.set(globals, pPos, groundY, scaleXZ, floorNrm, angle, scaleZ, pTexObj);
        return true;
    }
}

export function dComIfGd_setSimpleShadow2(globals: dGlobals, pos: vec3, groundY: number, scaleXZ: number, floorPoly: cBgS_PolyInfo,
    rotY: number = 0, scaleZ: number = 1.0, i_tex: BTIData | null = dDlst_shadowControl_c.defaultSimpleTex): boolean {
    if (floorPoly.ChkSetInfo() && groundY !== -Infinity) {
        const plane_p = globals.scnPlay.bgS.GetTriPla(floorPoly.bgIdx, floorPoly.triIdx);
        return globals.dlst.shadowControl.setSimple(globals, pos, groundY, scaleXZ, plane_p.n, rotY, scaleZ, i_tex);
    } else {
        return false;
    }
}