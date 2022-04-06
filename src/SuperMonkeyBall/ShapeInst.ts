import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import {
    compileVtxLoaderMultiVat,
    getAttributeByteSize,
    GX_Array,
    GX_VtxAttrFmt,
    GX_VtxDesc,
    LoadedVertexData,
    LoadedVertexLayout,
} from "../gx/gx_displaylist";
import * as GX from "../gx/gx_enum";
import { hexzero } from "../util";
import * as Gcmf from "./Gcmf";
import { MaterialInst } from "./MaterialInst";
import { SamplerInst } from "./SamplerInst";

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
    isCW: boolean
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
    if (isCW) {
        // convert cw triangle-strip to ccw triangle-strip
        // todo(complexplane): Does game just draw back faces instead? Maybe do that instead
        const dstIndexData = new Uint16Array(loadedVertexData.indexData);
        for (let i = 1; i < loadedVertexData.totalIndexCount + 1; i++) {
            if (i % 3 == 0 && i > 0) {
                let temp_indexData = dstIndexData[i - 3];
                dstIndexData[i - 3] = dstIndexData[i - 1];
                dstIndexData[i - 1] = temp_indexData;
            }
        }
        loadedVertexData.indexData = dstIndexData.buffer;
    }
    return loadedVertexData;
}

export class ShapeInst {
    private loadedVertexLayout: LoadedVertexLayout;
    private loadedVertexDatas: LoadedVertexData[];
    private material: MaterialInst;

    constructor(
        device: GfxDevice,
        public shapeData: Gcmf.Shape,
        modelSamplers: SamplerInst[],
        modelAttrs: Gcmf.ModelAttrs,
        translucent: boolean,
    ) {
        const vtxAttr = shapeData.material.vtxAttr;
        const vcd: GX_VtxDesc[] = [];
        for (let i = 0; i <= GX.Attr.MAX; i++) {
            if ((vtxAttr & (1 << i)) !== 0) {
                vcd[i] = { type: GX.AttrType.DIRECT };
            }
        }
        const isNBT = (vtxAttr & (1 << GX.Attr._NBT)) !== 0;
        if (isNBT) {
            console.log("NBT detected");
            // console.log(`vtxAttr: ${hexzero(vtxAttr, 8)} submesh offset: ${hexzero(view.byteOffset, 8)}`);
            vcd[GX.Attr.NRM] = { type: GX.AttrType.DIRECT };
        }
        const vat: GX_VtxAttrFmt[][] = [];
        vat[GX.VtxFmt.VTXFMT0] = fillVatFormat(GX.CompType.F32, isNBT);
        vat[GX.VtxFmt.VTXFMT1] = fillVatFormat(GX.CompType.S16, isNBT);
        const loader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexLayout = loader.loadedVertexLayout;

        // 16-bit models use VTXFMT1
        const fmtVat = modelAttrs.value16Bit ? GX.VtxFmt.VTXFMT1 : GX.VtxFmt.VTXFMT0;
        let dlistOffs = 0x60;
        this.loadedVertexDatas = [];
        shapeData.dlistHeaders.forEach((dlistHeader) => {
            let dlistSizes = dlistHeader.dlistSizes;
            for (let i = 0; i < dlistSizes.length; i++) {
                let size = dlistSizes[i];
                if (size <= 0) {
                    continue;
                }
                let isCW = i % 2 == 1;
                let dlisEndOffs = dlistOffs + size;
                // todo(complexplane): Parse separate dlist slices beforehand, and clean this up?
                let dlist = shapeData.rawData.slice(dlistOffs + 0x01, dlisEndOffs);
                const loadedVertexData = generateLoadedVertexData(
                    dlist,
                    vat,
                    fmtVat,
                    isNBT,
                    loader,
                    isCW
                );
                this.loadedVertexDatas.push(loadedVertexData);

                dlistOffs = dlisEndOffs;
            }
        });

        this.material = new MaterialInst(shapeData.material, modelSamplers, translucent);
    }
}
