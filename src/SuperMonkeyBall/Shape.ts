// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { transformVec3Mat4w1 } from "../MathHelpers.js";
import { GfxBufferCoalescerCombo } from "../gfx/helpers/BufferHelpers.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import {
    GX_Array,
    GX_VtxAttrFmt,
    GX_VtxDesc,
    LoadedVertexData,
    VtxLoader,
    compileVtxLoaderMultiVat
} from "../gx/gx_displaylist.js";
import * as GX from "../gx/gx_enum.js";
import { GXMaterialHacks } from "../gx/gx_material.js";
import { DrawParams, GXShapeHelperGfx, loadedDataCoalescerComboGfx } from "../gx/gx_render.js";
import * as Gma from "./Gma.js";
import { MaterialInst } from "./Material.js";
import { RenderParams, RenderSort } from "./Model.js";
import { RenderContext } from "./Render.js";
import { TevLayerInst } from "./TevLayer.js";

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

function generateLoadedVertexData(dlist: ArrayBufferSlice, loader: VtxLoader): LoadedVertexData {
    const arrays: GX_Array[] = [];
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
        const loadedVertexDatas = shapeData.dlists.map((dlist) =>
            generateLoadedVertexData(dlist.data.slice(1), loader)
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

    public prepareToRender(ctx: RenderContext, renderParams: RenderParams) {
        const drawParams = scratchDrawParams;
        mat4.copy(drawParams.u_PosMtx[0], renderParams.viewFromModel);

        for (let i = 0; i < this.subShapes.length; i++) {
            const inst = ctx.renderInstManager.newRenderInst();
            this.subShapes[i].material.setOnRenderInst(
                ctx.device,
                ctx.renderInstManager.gfxRenderCache,
                inst,
                drawParams,
                renderParams
            );
            this.subShapes[i].shapeHelper.setOnRenderInst(inst);

            if (
                (this.translucent && renderParams.sort === RenderSort.Translucent) ||
                renderParams.sort === RenderSort.All
            ) {
                const originViewSpace = scratchVec3a;
                transformVec3Mat4w1(originViewSpace, renderParams.viewFromModel, this.shapeData.origin);
                inst.sortKey = -(vec3.len(originViewSpace) + renderParams.depthOffset);
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
