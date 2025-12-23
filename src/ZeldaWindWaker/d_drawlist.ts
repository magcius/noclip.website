
import { mat4, vec3 } from "gl-matrix";
import { White, colorCopy, colorNewCopy } from "../Color.js";
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
import { BTI_Texture } from "../Common/JSYSTEM/JUTTexture.js";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { dKy_tevstr_c } from "./d_kankyo.js";

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

        setAttachmentStateSimple(this.materialHelperBackRevZ.megaStateFlags, { channelWriteMask: GfxChannelWriteMask.Alpha });
        setAttachmentStateSimple(this.materialHelperFrontZ.megaStateFlags, { channelWriteMask: GfxChannelWriteMask.Alpha });

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
    public peekZ = new PeekZManager(128);
    public alphaModel0: dDlst_alphaModel_c;

    public shadowControl = new dDlst_shadowControl_c();

    constructor(device: GfxDevice, cache: GfxRenderCache, symbolMap: SymbolMap) {
        this.alphaModel0 = new dDlst_alphaModel_c(device, cache, symbolMap);
    }

    public destroy(device: GfxDevice): void {
        this.peekZ.destroy(device);
        this.alphaModel0.destroy(device);
    }
}

class dDlst_shadowSimple_c {
    public alpha: number = 0; // 0-255
    public tex: BTI_Texture | null = null;
    public modelViewMtx = mat4.create();
    public texMtx = mat4.create();

    public draw(): void {
        // TODO: Implementation
    }

    public set(globals: dGlobals, pos: vec3, floorY: number, scaleXZ: number, floorNrm: vec3, angle: number, scaleZ: number, tex: BTI_Texture | null): void {
        const offsetY = scaleXZ * 16.0 * (1.0 - floorNrm[1]) + 1.0;
        
        // Build modelViewMtx
        mat4.fromTranslation(this.modelViewMtx, [pos[0], floorY + offsetY, pos[2]]);
        mat4.rotateY(this.modelViewMtx, this.modelViewMtx, angle);
        mat4.scale(this.modelViewMtx, this.modelViewMtx, [scaleXZ, offsetY + offsetY + 16.0, scaleXZ * scaleZ]);
        mat4.mul(this.modelViewMtx, globals.camera.viewFromWorldMatrix, this.modelViewMtx);

        // Build texMtx
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

        mat4.rotateY(this.texMtx, this.texMtx, angle);
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

    public static defaultSimpleTex: BTI_Texture;

    public reset(): void {
        // TODO: Implementation
    }

    public imageDraw(mtx: mat4): void {
        // TODO: Implementation
    }

    public draw(viewMtx: mat4): void {
        // TODO: Implementation
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

    public setSimple(globals: dGlobals, pPos: vec3, groundY: number, scaleXZ: number, floorNrm: vec3, angle: number, scaleZ: number, pTexObj: BTI_Texture): boolean {
        if (floorNrm === null || this.simpleCount >= this.simples.length)
            return false;

        const simple = this.simples[this.simpleCount++];
        simple.set(globals, pPos, groundY, scaleXZ, floorNrm, angle, scaleZ, pTexObj);
        return true;
    }
}

export function dComIfGd_setSimpleShadow2(globals: dGlobals, i_pos: vec3, groundY: number, scaleXZ: number, i_floorPoly: cBgS_PolyInfo,
    i_angle: number = 0, scaleZ: number = 1.0, i_tex: BTI_Texture = dDlst_shadowControl_c.defaultSimpleTex): boolean {
    if (i_floorPoly.ChkSetInfo() && groundY !== -1000000000.0) {
        const plane_p = globals.scnPlay.bgS.GetTriPla(i_floorPoly.bgIdx, i_floorPoly.triIdx);
        return globals.dlst.shadowControl.setSimple(globals, i_pos, groundY, scaleXZ, plane_p.n, i_angle, scaleZ, i_tex);
    } else {
        return false;
    }
}