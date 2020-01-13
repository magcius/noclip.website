import ArrayBufferSlice from "../ArrayBufferSlice";
import { TexMtxMode, TEX0 } from "../nns_g3d/NNS_G3D";
import { GfxCullMode } from "../gfx/platform/GfxPlatform";
import { mat4, mat2d } from "gl-matrix";

export interface binNode {
    name: string;
    jointMatrix: mat4;
}

export interface binMaterial {
    name: string;
    textureName: string | null;
    paletteName: string | null;
    cullMode: GfxCullMode;
    alpha: number;
    polyAttribs: number;
    texParams: number;
    texMatrix: mat2d;
    texScaleS: number;
    texScaleT: number;
}

export interface binShape {
    name: string;
    dlBuffer: ArrayBufferSlice;
}

export interface binModel {
    name: string;
    nodes: binNode[];
    materials: binMaterial[];
    shapes: binShape[];
    sbcBuffer: ArrayBufferSlice;
    posScale: number;
    texMtxMode: TexMtxMode;
}

export interface MPHbin {
    models: binModel[];
    tex0: TEX0 | null;
}

function parseModel(buffer: ArrayBufferSlice): binModel {
    const view = buffer.createDataView();

    const mtx_shamt = view.getUint32(0x00, true);
    const modelSetSize = mtx_shamt * view.getUint32(0x04, true) / 4096.0;



}

export function parseMPHbin(buffer: ArrayBufferSlice): MPHbin {
    const view = buffer.createDataView();

    const models: binModel[] = [];
    models.push(parseModel(buffer));

    let tex0: TEX0 | null = null;
    //if (dataBlocks > 1) {
    //    // Textures.
    //    // TODO(jstpierre): Finish
    //    const tex0Offs = view.getUint32(0x14, true);
    //    tex0 = parseTex0Block(buffer.slice(tex0Offs));
    //}

    return { models, tex0 };
}