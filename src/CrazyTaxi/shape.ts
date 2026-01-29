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
}

export interface Shape {
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

export function createShape(fileManager: FileManager, name: string): Shape {
    const debug = name === "cz_chari.shp";
    const shape = fileManager.fileStore.get_shape(name)!;
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
    const drawsData = fileManager.getData(drawsLoc).createDataView();
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

        // awkward hack
        let vat = [];
        vat[vtxFormat] = fmtVat;
        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        const vertexData = vtxLoader.runVertices(vtxArrays, dlData);
        assert(vertexData.vertexBuffers.length === 1);
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
