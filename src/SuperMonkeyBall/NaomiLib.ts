// NaomiLib (NL) model format support

// SMB1 supports rendering Arcade Monkey Ball stages to some extent, but every stage playable in the
// game without using debug menu (except Bonus Wave) is predominantly GMA-based. Some one-off NL
// models are used in some cases though, such as the LCD timer models on the goal and the goaltape.

import { TextureInputGX } from "../gx/gx_texture";
import { Color, colorNewFromRGBA, colorNewFromRGBA8 } from "../Color";

import { vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { AVTpl } from "./AVTpl";
import { parseVec2f, parseVec3f } from "./Utils";
import { assertExists } from "../util";
import { GXMaterialHelperGfx } from "../gx/gx_render";
import { LoadedTexture } from "../TextureHolder";
import { GfxSampler } from "../gfx/platform/GfxPlatformImpl";
import { TextureCache } from "./ModelCache";
import { GfxDevice, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { TSDraw } from "../SuperMarioGalaxy/DDraw";

const VTX_SIZE = 0x20;
const VTX_OFFSET_DESC_SIZE = 0x8;
const DISP_LIST_HEADER_SIZE = 0x8;

const enum TexFlags {
    ScaleFilterNear = (1 << 13) | (1 << 14), // If either set, min/mag scale is nearest, else linear
    TClamp = 1 << 15,
    SClamp = 1 << 16,
    TMirror = 1 << 17,
    SMirror = 1 << 18,
}

// Type A: no normal, vertex material colors, always unlit
type VtxTypeA = {
    pos: vec3;
    materialColor: Color;
    texCoord: vec2;
};

// Type B: has normal, no vertex material colors, can be lit or unlit
type VtxTypeB = {
    pos: vec3;
    normal: vec3;
    texCoord: vec2;
};

const enum DispListFlags {
    // Bits 0-1 are cull mode
    Quads = 1 << 2,
    Triangles = 1 << 3,
    TriangleStrip = 1 << 4,
}

type DispList<T> = {
    flags: DispListFlags;
    vertices: T[];
};

const enum MeshType {
    UnlitConstMatColor = -1,
    LitConstMatColor = -2, // These types aren't actually rendered but non-negative types are this
    UnlitVertMatColor = -3,
}

type Mesh<T> = {
    flags: number;
    texFlags: TexFlags;
    tex: TextureInputGX | null;
    meshType: MeshType;
    ambientColorScale: number;
    materialColor: Color;
    dispList: DispList<T>;
};

const enum ModelFlags {
    VtxTypeA, // All meshes in model have vertices of type A (type B if unset)
    Translucent, // Model has at least 1 translucent mesh
    Opaque, // Model has at least 1 opaque mesh
}

type Model = {
    flags: ModelFlags;
    boundSphereCenter: vec3;
    boundSphereRadius: number;
    meshList:
        | {
              kind: "A";
              meshes: Mesh<VtxTypeA>[];
          }
        | {
              kind: "B";
              meshes: Mesh<VtxTypeB>[];
          };
};

// NaomiLib model archive analogous to GMA
// There's model names too but I'm only considering model idx at this point
export type Obj = Map<number, Model>;

type ParseVtxFunc<T> = (view: DataView, offs: number) => T;

function parseVtxTypeA(view: DataView, vtxOffs: number): VtxTypeA {
    const pos = parseVec3f(view, vtxOffs + 0x0);
    const materialColor = colorNewFromRGBA8(view.getUint32(vtxOffs + 0x10));
    const texCoord = parseVec2f(view, vtxOffs + 0x18);
    return { pos, materialColor, texCoord };
}

function parseVtxTypeB(view: DataView, vtxOffs: number): VtxTypeB {
    const pos = parseVec3f(view, vtxOffs + 0x0);
    const normal = parseVec3f(view, vtxOffs + 0xc);
    const texCoord = parseVec2f(view, vtxOffs + 0x18);
    return { pos, normal, texCoord };
}

function parseDispList<T>(view: DataView, dispListOffs: number, parseVtxFunc: ParseVtxFunc<T>): DispList<T> {
    const flags = view.getUint32(dispListOffs + 0x0) as DispListFlags;
    const vtxOrFaceCount = view.getUint32(dispListOffs + 0x4);
    let vtxCount: number;
    if (flags & DispListFlags.Quads) {
        vtxCount = vtxOrFaceCount * 4;
    } else if (flags & DispListFlags.Triangles) {
        vtxCount = vtxOrFaceCount * 3;
    } else if (flags & DispListFlags.TriangleStrip) {
        vtxCount = vtxOrFaceCount;
    } else {
        throw new Error("Invalid NL display list primitive type");
    }

    const vertices: T[] = [];
    let vtxOffs = dispListOffs + DISP_LIST_HEADER_SIZE;
    for (let vtxIdx = 0; vtxIdx < vtxCount; vtxIdx++) {
        // Least significant bit of x pos float seems to be hijacked: if set this is a real vertex,
        // else it's an offset to the actual vertex
        const posXAsUint = view.getUint32(vtxOffs + 0x0);
        if (posXAsUint & 1) {
            vertices.push(parseVtxFunc(view, vtxOffs));
            vtxOffs += VTX_SIZE;
        } else {
            // Our "vertex" is a 0x8 structure, u32 at 0x4 gives offset to actual vertex relative to
            // where we currently are in disp list. Just copy the vtx if it's used twice, don't
            // bother to try to figure out index buffer stuff here.
            const relativeVtxOffs = view.getInt32(vtxOffs + 0x4); // Game reads as u32 but it's really signed
            const actualVtxOffs = vtxOffs + relativeVtxOffs + VTX_OFFSET_DESC_SIZE;
            vertices.push(parseVtxFunc(view, actualVtxOffs));
            vtxOffs += VTX_OFFSET_DESC_SIZE;
        }
    }
    return { flags, vertices };
}

// If this is a valid mesh (aka not the end-of-list marker), return it and the buffer offset to the next mesh.
// Otherwise return null.
function parseMeshList<T>(view: DataView, meshOffs: number, parseVtxFunc: ParseVtxFunc<T>, tpl: AVTpl): Mesh<T>[] {
    const meshes: Mesh<T>[] = [];
    let meshIdx = 0;

    while (true) {
        const valid = view.getInt32(meshOffs + 0x0);
        if (valid === 0) return meshes;

        const flags = view.getUint32(meshOffs + 0x4);
        const texFlags = view.getUint32(meshOffs + 0x8) as TexFlags;
        const tplTexIdx = view.getInt32(meshOffs + 0x20);
        const tex = tplTexIdx < 0 ? null : assertExists(tpl.get(tplTexIdx));
        const meshType = view.getInt32(meshOffs + 0x24) as MeshType;
        const ambientColorScale = view.getFloat32(meshOffs + 0x28);
        const materialColorA = view.getFloat32(meshOffs + 0x2c);
        const materialColorR = view.getFloat32(meshOffs + 0x30);
        const materialColorG = view.getFloat32(meshOffs + 0x34);
        const materialColorB = view.getFloat32(meshOffs + 0x38);
        const materialColor = colorNewFromRGBA(materialColorR, materialColorG, materialColorB, materialColorA);

        const dispListSize = view.getUint32(meshOffs + 0x4c);
        const dispListOffs = meshOffs + 0x50;
        const dispList = parseDispList(view, dispListOffs, parseVtxFunc);

        meshes.push({
            flags,
            texFlags,
            tex,
            meshType,
            ambientColorScale,
            materialColor,
            dispList,
        });

        meshOffs = dispListOffs + dispListSize;
        meshIdx++;
    }
}

// Parse model. Return null if it's marked invalid.
function parseModel(view: DataView, modelOffs: number, tpl: AVTpl): Model | null {
    const valid = view.getInt32(modelOffs + 0x0);
    if (valid === -1) return null;

    const flags = view.getUint32(modelOffs + 0x4) as ModelFlags;
    const boundSphereCenter = parseVec3f(view, modelOffs + 0x8);
    const boundSphereRadius = view.getFloat32(modelOffs + 0x14);

    if (flags & ModelFlags.VtxTypeA) {
        const meshes = parseMeshList(view, modelOffs + 0x18, parseVtxTypeA, tpl);
        return { flags, boundSphereCenter, boundSphereRadius, meshList: { kind: "A", meshes } };
    }

    // Vtx type B
    const meshes = parseMeshList(view, modelOffs + 0x18, parseVtxTypeB, tpl);
    return { flags, boundSphereCenter, boundSphereRadius, meshList: { kind: "B", meshes } };
}

export function parseObj(nlObjBuffer: ArrayBufferSlice, tpl: AVTpl): Obj {
    const view = nlObjBuffer.createDataView();
    const obj: Obj = new Map();
    let offs = 4;
    for (let i = 0; ; i++, offs += 4) {
        const modelOffs = view.getUint32(offs);
        if (modelOffs === 0) break;

        const model = parseModel(view, modelOffs, tpl);
        if (model !== null) {
            obj.set(i, model);
        }
    }
    return obj;
}

class MaterialInst {
    private loadedTex: LoadedTexture | null; // Null if we're using TEXMAP_NULL
    private gfxSampler: GfxSampler;
    private materialHelper: GXMaterialHelperGfx;

    private initSampler(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        meshData: Mesh<unknown>,
        textureCache: TextureCache
    ) {
        this.loadedTex = meshData.tex === null ? null : textureCache.getTexture(device, meshData.tex);

        let wrapS: GfxWrapMode;
        let wrapT: GfxWrapMode;
        if (meshData.texFlags & TexFlags.SClamp) {
            wrapS = GfxWrapMode.Clamp;
        } else if (meshData.texFlags & TexFlags.SMirror) {
            wrapS = GfxWrapMode.Mirror;
        } else {
            wrapS = GfxWrapMode.Repeat;
        }
        if (meshData.texFlags & TexFlags.TClamp) {
            wrapT = GfxWrapMode.Clamp;
        } else if (meshData.texFlags & TexFlags.TMirror) {
            wrapT = GfxWrapMode.Mirror;
        } else {
            wrapT = GfxWrapMode.Repeat;
        }

        const texFilter = (meshData.texFlags & 3) === 0 ? GfxTexFilterMode.Point : GfxTexFilterMode.Bilinear;

        this.gfxSampler = renderCache.createSampler({
            wrapS,
            wrapT,
            minFilter: texFilter,
            magFilter: texFilter,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 0,
        });
    }

    constructor(device: GfxDevice, renderCache: GfxRenderCache, meshData: Mesh<unknown>, textureCache: TextureCache) {
        this.initSampler(device, renderCache, meshData, textureCache);
        // TODO(complexplane): Init GX material
    }
}

class MeshInst {
    private tsDraw: TSDraw;
}

class ModelInst {
    constructor(device: GfxDevice, renderCache: GfxRenderCache, public modelData: Model, texHolder: TextureCache) {
        
    }
}
