// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { mat4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { GfxBufferCoalescerCombo } from "../gfx/helpers/BufferHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstList, GfxRenderInstManager, makeDepthKey } from "../gfx/render/GfxRenderInstManager";
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
import { RenderContext } from "./Renderer";
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
    loader: VtxLoader
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

// Each display list needs its own material as different GXCullMode's may need to be set
type SubShapeInst = {
    shapeHelper: GXShapeHelperGfx;
    material: MaterialInst;
};

const scratchDrawParams = new DrawParams();
const scratchVec3a = vec3.create();
export class ShapeInst {
    private bufferCoalescer: GfxBufferCoalescerCombo;
    private subShapes: SubShapeInst[];

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        public shapeData: Gma.Shape,
        modelTevLayers: TevLayerInst[],
        modelFlags: Gma.ModelFlags,
        private translucent: boolean
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
        const loadedVertexDatas = shapeData.dlists.map((dlist) =>
            generateLoadedVertexData(dlist.data.slice(1), vat, vtxFmt, isNBT, loader)
        );
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, loadedVertexDatas);
        this.subShapes = shapeData.dlists.map((dlist, i) => {
            const buf = this.bufferCoalescer.coalescedBuffers[i];
            const shapeHelper = new GXShapeHelperGfx(
                device,
                renderCache,
                buf.vertexBuffers,
                buf.indexBuffer,
                loadedVertexLayout,
                loadedVertexDatas[i]
            );
            const material = new MaterialInst(shapeData.material, modelTevLayers, translucent, dlist.cullMode);
            return { shapeHelper, material };
        });
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        for (let i = 0; i < this.subShapes.length; i++) {
            this.subShapes[i].material.setMaterialHacks(hacks);
        }
    }

    public prepareToRender(ctx: RenderContext, viewFromModel: mat4) {
        const drawParams = scratchDrawParams;
        mat4.copy(drawParams.u_PosMtx[0], viewFromModel);

        for (let i = 0; i < this.subShapes.length; i++) {
            const inst = ctx.instMan.newRenderInst();
            this.subShapes[i].material.setOnRenderInst(ctx.device, ctx.instMan.gfxRenderCache, inst, drawParams);
            this.subShapes[i].shapeHelper.setOnRenderInst(inst);

            if (this.translucent) {
                const origin_rt_view = scratchVec3a;
                vec3.transformMat4(origin_rt_view, this.shapeData.origin, viewFromModel);
                inst.sortKey = origin_rt_view[2];
                ctx.translucentInstList.submitRenderInst(inst);
            } else {
                ctx.opaqueInstList.submitRenderInst(inst);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.subShapes.length; i++) {
            this.subShapes[i].shapeHelper.destroy(device);
        }
        this.bufferCoalescer.destroy(device);
    }
}
