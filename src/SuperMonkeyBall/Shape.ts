// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { mat4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxBufferCoalescerCombo } from "../gfx/helpers/BufferHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import {
    compileVtxLoaderMultiVat,
    getAttributeByteSize,
    GX_Array,
    GX_VtxAttrFmt,
    GX_VtxDesc,
    LoadedVertexData,
    VtxLoader,
} from "../gx/gx_displaylist";
import * as GX from "../gx/gx_enum";
import { GXMaterialHacks } from "../gx/gx_material";
import { DrawParams, GXShapeHelperGfx, loadedDataCoalescerComboGfx } from "../gx/gx_render";
import { ViewerRenderInput } from "../viewer";
import * as Gma from "./Gma";
import { MaterialInst } from "./Material";
import { TevLayerInst } from "./TevLayer";

function fillVatFormat(vtxType: GX.CompType, isNBT: boolean): GX_VtxAttrFmt[] {
    const vatFormat: GX_VtxAttrFmt[] = [];
    const compShift = vtxType == GX.CompType.S16 ? 0x0d : 0x00;
    vatFormat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: vtxType, compShift };
    vatFormat[GX.Attr.NRM] = {
        compCnt: isNBT ? GX.CompCnt.NRM_NBT : GX.CompCnt.NRM_XYZ,
        compType: vtxType,
        compShift,
    };
    vatFormat[GX.Attr.CLR0] = {
        compCnt: GX.CompCnt.CLR_RGBA,
        compType: GX.CompType.RGBA8,
        compShift,
    };
    vatFormat[GX.Attr.CLR1] = {
        compCnt: GX.CompCnt.CLR_RGBA,
        compType: GX.CompType.RGBA8,
        compShift,
    };
    vatFormat[GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };
    vatFormat[GX.Attr.TEX1] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };
    vatFormat[GX.Attr.TEX2] = { compCnt: GX.CompCnt.TEX_ST, compType: vtxType, compShift };

    return vatFormat;
}

function generateLoadedVertexData(
    dlist: ArrayBufferSlice,
    vat: GX_VtxAttrFmt[][],
    fmtVat: GX.VtxFmt.VTXFMT0 | GX.VtxFmt.VTXFMT1,
    isNBT: boolean,
    loader: VtxLoader,
): LoadedVertexData {
    const arrays: GX_Array[] = [];
    arrays[GX.Attr.POS] = {
        buffer: dlist,
        offs: 0x00,
        stride: getAttributeByteSize(vat[fmtVat], GX.Attr.POS),
    };
    arrays[GX.Attr.NRM] = {
        buffer: dlist,
        offs: 0x00,
        stride: getAttributeByteSize(vat[fmtVat], GX.Attr.NRM) * (isNBT ? 3 : 1),
    };
    arrays[GX.Attr.CLR0] = {
        buffer: dlist,
        offs: 0x00,
        stride: getAttributeByteSize(vat[fmtVat], GX.Attr.CLR0),
    };
    arrays[GX.Attr.CLR1] = {
        buffer: dlist,
        offs: 0x00,
        stride: getAttributeByteSize(vat[fmtVat], GX.Attr.CLR1),
    };
    arrays[GX.Attr.TEX0] = {
        buffer: dlist,
        offs: 0x00,
        stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX0),
    };
    arrays[GX.Attr.TEX1] = {
        buffer: dlist,
        offs: 0x00,
        stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX1),
    };
    arrays[GX.Attr.TEX2] = {
        buffer: dlist,
        offs: 0x00,
        stride: getAttributeByteSize(vat[fmtVat], GX.Attr.TEX2),
    };
    const loadedVertexData = loader.runVertices(arrays, dlist);
    return loadedVertexData;
}

const scratchDrawParams = new DrawParams();
export class ShapeInst {
    private material: MaterialInst;
    private bufferCoalescer: GfxBufferCoalescerCombo;
    private shapeHelpers: GXShapeHelperGfx[];

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        public shapeData: Gma.Shape,
        modelTevLayers: TevLayerInst[],
        modelFlags: Gma.ModelFlags,
        translucent: boolean
    ) {
        const vtxAttr = shapeData.material.vtxAttrs;
        const vcd: GX_VtxDesc[] = [];
        for (let i = 0; i <= GX.Attr.MAX; i++) {
            if ((vtxAttr & (1 << i)) !== 0) {
                vcd[i] = { type: GX.AttrType.DIRECT };
            }
        }
        const isNBT = (vtxAttr & (1 << GX.Attr._NBT)) !== 0;
        if (isNBT) {
            vcd[GX.Attr.NRM] = { type: GX.AttrType.DIRECT };
        }
        const vat: GX_VtxAttrFmt[][] = [];
        vat[GX.VtxFmt.VTXFMT0] = fillVatFormat(GX.CompType.F32, isNBT);
        vat[GX.VtxFmt.VTXFMT1] = fillVatFormat(GX.CompType.S16, isNBT);
        const loader = compileVtxLoaderMultiVat(vat, vcd);
        const loadedVertexLayout = loader.loadedVertexLayout;

        // 16-bit models use VTXFMT1
        const vtxFmt = modelFlags & Gma.ModelFlags.Vat16Bit ? GX.VtxFmt.VTXFMT1 : GX.VtxFmt.VTXFMT0;
        const loadedVertexDatas: LoadedVertexData[] = [];
        const dlists = [
            shapeData.frontCulledDlist,
            shapeData.backCulledDlist,
            shapeData.extraFrontCulledDlist,
            shapeData.extraBackCulledDlist,
        ];
        for (let i = 0; i < dlists.length; i++) {
            if (dlists[i] === null) continue;
            const loadedVertexData = generateLoadedVertexData(
                dlists[i]!.slice(1),
                vat,
                vtxFmt,
                isNBT,
                loader,
            );
            loadedVertexDatas.push(loadedVertexData);
        }

        // TODO(complexplane): Either get rid of GfxBufferCoalescer or go ham and coalesce all shape
        // buffers in model (is cross-model buffer coalescing possible?)
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, loadedVertexDatas);
        this.shapeHelpers = this.bufferCoalescer.coalescedBuffers.map(
            (buf, i) =>
                new GXShapeHelperGfx(
                    device,
                    renderCache,
                    buf.vertexBuffers,
                    buf.indexBuffer,
                    loadedVertexLayout,
                    loadedVertexDatas[i]
                )
        );

        this.material = new MaterialInst(shapeData.material, modelTevLayers, translucent);
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        this.material.setMaterialHacks(hacks);
    }

    public prepareToRender(
        device: GfxDevice,
        renderInstManager: GfxRenderInstManager,
        viewerInput: ViewerRenderInput,
        viewFromModel: mat4
    ) {
        const template = renderInstManager.pushTemplateRenderInst();
        const drawParams = scratchDrawParams;
        mat4.copy(drawParams.u_PosMtx[0], viewFromModel);
        this.material.setOnRenderInst(
            device,
            renderInstManager.gfxRenderCache,
            template,
            drawParams
        );

        for (let i = 0; i < this.shapeHelpers.length; i++) {
            const inst = renderInstManager.newRenderInst();
            this.shapeHelpers[i].setOnRenderInst(inst);
            renderInstManager.submitRenderInst(inst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapeHelpers.length; i++) {
            this.shapeHelpers[i].destroy(device);
        }
        this.bufferCoalescer.destroy(device);
    }
}
