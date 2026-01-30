import { vec3 } from "gl-matrix";
import { CTFileLoc } from "../../rust/pkg/noclip_support";
import { AABB } from "../Geometry";
import { LoadedVertexData, LoadedVertexLayout, GX_VtxDesc, GX_Array, getAttributeByteSize, compileVtxLoaderMultiVat, GX_VtxAttrFmt, VtxLoader } from "../gx/gx_displaylist"
import * as GX from '../gx/gx_enum.js';
import { assert } from "../util";
import { FileManager } from "./util.js";

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

export interface ShapeDrawCall {
    vertexData: LoadedVertexData,
    vertexLayout: LoadedVertexLayout,
    textureIndex: number,
    otherDrawData: number[],
}

export class Shape {
    public pos: vec3 = vec3.create();
    public aabb: AABB = new AABB();
    public visible = true;
    public scale: vec3 = vec3.create();
    public isSkybox: boolean;
    public draws: ShapeDrawCall[] = [];
    public boundingRadius: number;
    public vertexFormats: Set<GX.VtxFmt> = new Set();
    public textures: string[] = [];

    constructor(public name: string, fileManager: FileManager) {
        this.isSkybox = ['solla.shp', 'enkei4.shp'].includes(name);
        const shape = fileManager.fileStore.get_shape(name)!;
        this.boundingRadius = shape.bounding_radius();
        let x = shape.pos_and_scale();
        vec3.set(this.pos, x[0], x[1], -x[2]); // FIXME why do we negate here
        vec3.set(this.scale, x[3], x[4], x[5]);

        const textures = shape.textures;
        for (let i = 0; i < textures.length; i++) {
            this.textures[i] = textures[i].toLowerCase();
        }

        const dlAddrs = [];
        const textureIdxs = [];
        const otherDrawData: number[][] = [];
        const drawsLoc = shape.mystery_loc()!;
        const drawsData = fileManager.getData(drawsLoc).createDataView();
        const drawCount = Math.floor(drawsData.byteLength / 36);
        for (let i = 0; i < drawCount; i++) {
            const offs = i * 36;
            const dlAddr = drawsData.getUint32(offs + 0x0);
            if (dlAddr === 0x38) continue; // the first one seems to always be empty?
            const vtxAddr = drawsData.getUint32(offs + 0x4);
            const texIdx = drawsData.getUint32(offs + 0x8);
            const unkNum0 = drawsData.getUint32(offs + 0xc);
            const unkNum1 = drawsData.getUint32(offs + 0x10);
            const unkNum2 = drawsData.getUint32(offs + 0x14);
            const unkCount1 = drawsData.getUint32(offs + 0x18);
            const unkBytes = drawsData.buffer.slice(offs + 0x1c, offs + 36);
            dlAddrs.push(dlAddr);
            textureIdxs.push(texIdx);
            otherDrawData.push([
                unkNum0,
                unkNum1,
                unkNum2,
                unkCount1,
            ]);
            for (const byte of new Uint8Array(unkBytes)) {
                otherDrawData[otherDrawData.length - 1].push(byte);
            }
        }

        const sortedDLAddrs = dlAddrs.slice();
        sortedDLAddrs.sort((a, b) => a - b);
        const dlSizesByAddr: Map<number, number> = new Map();
        for (let i = 0; i < sortedDLAddrs.length - 1; i++) {
            const size = sortedDLAddrs[i + 1] - sortedDLAddrs[i];
            assert(size > 0);
            dlSizesByAddr.set(sortedDLAddrs[i], size);
        }

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

        const dlSection = fileManager.getData(shape.display_list_loc()!);
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
                    buffer: fileManager.getData(loc),
                    offs: 0,
                    stride: getAttributeByteSize(fmtVat, attr),
                };
            }

            let vat = [];
            vat[vtxFormat] = fmtVat;
            const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
            const vertexData = vtxLoader.runVertices(vtxArrays, dlData);
            assert(vertexData.vertexBuffers.length === 1);

            this.draws.push({
                vertexData,
                vertexLayout: vtxLoader.loadedVertexLayout,
                textureIndex,
                otherDrawData: otherDrawData[i],
            })
        }


        const p = vec3.create();
        if (vertexFormats.has(1)) {
            const prescaled = this.scale[0] === 1 && this.scale[1] === 1 && this.scale[2] === 1;
            const pretranslated = this.pos[0] === 0 && this.pos[1] === 0 && this.pos[2] === 0;
            assert(prescaled && pretranslated);
            for (const draw of this.draws) {
                for (const buf of draw.vertexData.vertexBuffers) {
                    const verts = new Float32Array(buf);
                    assert(verts.length % 3 === 0);
                    for (let i = 0; i < verts.length / 3; i += 3) {
                        vec3.set(p, verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
                        this.aabb.unionPoint(p);
                    }
                }
            }
        } else {
            this.aabb.setFromCenterAndHalfExtents(
                this.pos,
                vec3.fromValues(this.boundingRadius, this.boundingRadius, this.boundingRadius)
            );
        }
    }
}
