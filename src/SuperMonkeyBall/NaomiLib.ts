// NaomiLib (NL) model format support

// SMB1 supports rendering Arcade Monkey Ball stages to some extent, but every stage playable in the
// game without using debug menu (except Bonus Wave) is predominantly GMA-based. Some one-off NL
// models are used in some cases though, such as the LCD timer models on the goal and the goaltape.

import { mat4, vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color, colorCopy, colorNewFromRGBA, colorNewFromRGBA8, colorScale } from "../Color";
import { GfxDevice, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxSampler } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX from "../gx/gx_enum";
import { GXMaterialHacks } from "../gx/gx_material";
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams } from "../gx/gx_render";
import { TextureInputGX } from "../gx/gx_texture";
import { TSDraw } from "../SuperMarioGalaxy/DDraw";
import { LoadedTexture } from "../TextureHolder";
import { assertExists } from "../util";
import { AVTpl } from "./AVTpl";
import { RenderParams } from "./Model";
import { TextureCache } from "./ModelCache";
import { RenderContext } from "./Render";
import { parseVec2f, parseVec3f } from "./Utils";
import { ModelInterface } from "./World";

const VTX_SIZE = 0x20;
const VTX_OFFSET_DESC_SIZE = 0x8;
const DISP_LIST_HEADER_SIZE = 0x8;

const NL_TO_GX_COMPARE = [
    GX.CompareType.NEVER,
    GX.CompareType.GEQUAL,
    GX.CompareType.EQUAL,
    GX.CompareType.GEQUAL,
    GX.CompareType.LEQUAL,
    GX.CompareType.NEQUAL,
    GX.CompareType.LEQUAL,
    GX.CompareType.ALWAYS,
];

const NL_TO_GX_CULL_MODE = [GX.CullMode.ALL, GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT];

// prettier-ignore
const FLIP_T_TEX_MTX = mat4.fromValues(
    1, 0, 0, 0, 
    0, -1, 0, 0, 
    0, 0, 1, 0, 
    0, 0, 0, 1
);

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

const enum MeshFlags {
    DisableDepthWrite = 1 << 24,
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

type MeshWithType =
    | {
          kind: "A";
          mesh: Mesh<VtxTypeA>;
      }
    | {
          kind: "B";
          mesh: Mesh<VtxTypeB>;
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

const scratchMaterialParams = new MaterialParams();
class MaterialInst {
    private loadedTex: LoadedTexture | null; // Null if we're using TEXMAP_NULL
    private gfxSampler: GfxSampler | null;
    private materialHelper: GXMaterialHelperGfx;

    private initSampler(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        meshData: Mesh<unknown>,
        textureCache: TextureCache
    ): void {
        if (meshData.tex === null) {
            this.loadedTex = null;
            this.gfxSampler = null;
            return;
        }
        this.loadedTex = textureCache.getTexture(device, meshData.tex);

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

    private genGXMaterial(device: GfxDevice, renderCache: GfxRenderCache, meshData: Mesh<unknown>): void {
        const mb = new GXMaterialBuilder();

        mb.setCullMode(NL_TO_GX_CULL_MODE[meshData.dispList.flags & 3]);

        mb.setTevDirect(0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);

        mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO, GX.LogicOp.CLEAR);
        mb.setFog(GX.FogType.NONE, false);

        if (this.loadedTex === null) {
            mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        } else {
            switch ((meshData.texFlags >> 6) & 3) {
                case 0: {
                    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
                    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
                    mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
                    mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                    break;
                }
                case 1: {
                    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
                    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.RASC, GX.CC.TEXC, GX.CC.ZERO);
                    mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
                    mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                    break;
                }
                case 2: {
                    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
                    mb.setTevColorIn(0, GX.CC.RASC, GX.CC.TEXC, GX.CC.TEXA, GX.CC.ZERO);
                    mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
                    mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                    break;
                }
                case 3: {
                    // Equivalent to 1?
                    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
                    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
                    mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO);
                    mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
                    break;
                }
            }
        }

        switch (meshData.meshType) {
            case MeshType.UnlitConstMatColor: {
                mb.setChanCtrl(
                    GX.ColorChannelID.COLOR0A0,
                    false,
                    GX.ColorSrc.REG,
                    GX.ColorSrc.REG,
                    0,
                    GX.DiffuseFunction.CLAMP,
                    GX.AttenuationFunction.SPOT
                );
                break;
            }
            case MeshType.UnlitVertMatColor: {
                mb.setChanCtrl(
                    GX.ColorChannelID.COLOR0A0,
                    false,
                    GX.ColorSrc.VTX,
                    GX.ColorSrc.VTX,
                    0,
                    GX.DiffuseFunction.CLAMP,
                    GX.AttenuationFunction.SPOT
                );
                break;
            }
            default: {
                mb.setChanCtrl(
                    GX.ColorChannelID.COLOR0A0,
                    true,
                    GX.ColorSrc.REG,
                    GX.ColorSrc.REG,
                    1, // We only have one directional light for now
                    GX.DiffuseFunction.CLAMP,
                    GX.AttenuationFunction.SPOT
                );
                break;
            }
        }

        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);

        const zCompare = NL_TO_GX_COMPARE[meshData.flags >> 29];
        const depthWrite = !(meshData.flags & MeshFlags.DisableDepthWrite);
        mb.setZMode(true, zCompare, depthWrite);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        this.materialHelper.setMaterialHacks(hacks);
    }

    public setOnRenderInst(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        inst: GfxRenderInst,
        drawParams: DrawParams,
        renderParams: RenderParams
    ): void {
        // Shader program
        this.materialHelper.setOnRenderInst(device, renderCache, inst);

        // Sampler bindings
        const materialParams = scratchMaterialParams;
        materialParams.clear();
        if (this.loadedTex !== null && this.gfxSampler !== null) {
            materialParams.m_TextureMapping[0].gfxTexture = this.loadedTex.gfxTexture;
            materialParams.m_TextureMapping[0].gfxSampler = this.gfxSampler;
        }

        const lighting = assertExists(renderParams.lighting);

        const targetMatColor = materialParams.u_Color[ColorKind.MAT0];
        colorCopy(targetMatColor, this.meshData.materialColor);

        // Not 100% sure about alpha...
        const targetAmbColor = materialParams.u_Color[ColorKind.AMB0];
        colorScale(targetAmbColor, lighting.ambientColor, this.meshData.ambientColorScale);

        mat4.copy(materialParams.u_TexMtx[0], FLIP_T_TEX_MTX);

        materialParams.u_Lights[0].copy(lighting.infLightViewSpace);

        this.materialHelper.allocateMaterialParamsDataOnInst(inst, materialParams);
        inst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        // Draw params
        this.materialHelper.allocateDrawParamsDataOnInst(inst, drawParams);
    }

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        private meshData: Mesh<unknown>,
        textureCache: TextureCache
    ) {
        this.initSampler(device, renderCache, meshData, textureCache);
        this.genGXMaterial(device, renderCache, meshData);
    }
}

const scratchDrawParams = new DrawParams();

class MeshInst {
    private ddraw: TSDraw;
    private material: MaterialInst;

    constructor(device: GfxDevice, renderCache: GfxRenderCache, meshData: MeshWithType, textureCache: TextureCache) {
        this.material = new MaterialInst(device, renderCache, meshData.mesh, textureCache);
        this.ddraw = new TSDraw();

        if (meshData.kind === "A") {
            this.ddraw.setVtxDesc(GX.Attr.POS, true);
            this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
            this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
            meshData.mesh.dispList.vertices[0];
        } else {
            this.ddraw.setVtxDesc(GX.Attr.POS, true);
            this.ddraw.setVtxDesc(GX.Attr.NRM, true);
            this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        }

        this.ddraw.beginDraw();

        if (meshData.mesh.dispList.flags & DispListFlags.Triangles) {
            this.ddraw.begin(GX.Command.DRAW_TRIANGLES);
        } else if (meshData.mesh.dispList.flags & DispListFlags.Quads) {
            this.ddraw.begin(GX.Command.DRAW_QUADS);
        } else if (meshData.mesh.dispList.flags & DispListFlags.TriangleStrip) {
            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        } else {
            throw new Error("Invalid display list primitive type");
        }

        if (meshData.kind === "A") {
            for (const vtx of meshData.mesh.dispList.vertices) {
                this.ddraw.position3vec3(vtx.pos);
                this.ddraw.color4color(GX.Attr.CLR0, vtx.materialColor);
                this.ddraw.texCoord2vec2(GX.Attr.TEX0, vtx.texCoord);
            }
        } else {
            for (const vtx of meshData.mesh.dispList.vertices) {
                this.ddraw.position3vec3(vtx.pos);
                this.ddraw.normal3vec3(vtx.normal);
                this.ddraw.texCoord2vec2(GX.Attr.TEX0, vtx.texCoord);
            }
        }

        this.ddraw.end();
        this.ddraw.endDraw(renderCache);
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        this.material.setMaterialHacks(hacks);
    }

    public prepareToRender(ctx: RenderContext, renderParams: RenderParams) {
        const drawParams = scratchDrawParams;
        mat4.copy(drawParams.u_PosMtx[0], renderParams.viewFromModel);

        const inst = ctx.renderInstManager.newRenderInst();
        this.material.setOnRenderInst(ctx.device, ctx.renderInstManager.gfxRenderCache, inst, drawParams, renderParams);
        this.ddraw.setOnRenderInst(inst);
        ctx.opaqueInstList.submitRenderInst(inst); // TODO(complexplane): Translucent depth sort stuff
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

export class ModelInst implements ModelInterface {
    private meshes: MeshInst[] = [];
    constructor(device: GfxDevice, renderCache: GfxRenderCache, public modelData: Model, textureCache: TextureCache) {
        if (modelData.meshList.kind === "A") {
            this.meshes = modelData.meshList.meshes.map(
                (meshData) => new MeshInst(device, renderCache, { kind: "A", mesh: meshData }, textureCache)
            );
        } else {
            this.meshes = modelData.meshList.meshes.map(
                (meshData) => new MeshInst(device, renderCache, { kind: "B", mesh: meshData }, textureCache)
            );
        }
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        for (let i = 0; i < this.meshes.length; i++) {
            this.meshes[i].setMaterialHacks(hacks);
        }
    }

    public prepareToRender(ctx: RenderContext, renderParams: RenderParams): void {
        for (let i = 0; i < this.meshes.length; i++) {
            this.meshes[i].prepareToRender(ctx, renderParams);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshes.length; i++) {
            this.meshes[i].destroy(device);
        }
    }
}
