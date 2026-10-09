// The big boy

import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert } from "../util.js";
import { Camera, CameraController, FPSCameraController, OrbitCameraController, OrthoCameraController } from "../Camera.js";
import { Color, colorFromRGBA, colorCopy, colorNewFromRGBA } from "../Color.js";
import { GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferDescriptor, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { GfxBufferCoalescerCombo } from "../gfx/helpers/BufferHelpers.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstList, GfxRenderInstManager, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph.js";
import { makeBackbufferDescSimple } from "../gfx/helpers/RenderGraphHelpers.js";
import { compareDepthValues, reverseDepthForClearValue } from "../gfx/helpers/ReversedDepthHelpers.js";
import { compileVtxLoader, GX_VtxAttrFmt, GX_VtxDesc } from "../gx/gx_displaylist.js";
import * as GX from "../gx/gx_enum.js";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder.js";
import { fogBlockSet, FogBlock, GX_Program, Light, lightSetWorldPosition } from "../gx/gx_material.js";
import { BasicGXRendererHelper, calcLODBias, ColorKind, createInputLayout, DrawParams, fillIndTexMtx, fillSceneParamsData, fillSceneParamsDataOnTemplate, GXMaterialHelperGfx, loadedDataCoalescerComboGfx, loadTextureFromMipChain, MaterialParams, SceneParams, translateTexFilterGfx, translateWrapModeGfx, ub_SceneParamsBufferSize } from "../gx/gx_render.js";
import { calcMipChain, decodeTexture as decodeGXTexture, MipChain } from "../gx/gx_texture.js";
import { CalcBillboardFlags, calcBillboardMatrix, getMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1 } from "../MathHelpers.js";
import { AABB, Frustum } from "../Geometry.js";
import type * as UI from "../ui.js";
import { ViewerRenderInput } from "../viewer.js";

import * as Cloud from "./Cloud.js";
import * as Env from "./Env.js";
import * as Fog from "./Fog.js";
import { DecodedMesh, GxVertex } from "./Gpl.js";
import * as Grass from "./Grass.js";
import * as HousePart from "./HousePart.js";
import * as Lamp from "./Lamp.js";
import * as Material from "./Material.js";
import * as Leaf from "./Leaf.js";
import * as Lod from "./Lod.js";
import * as Moon from "./Moon.js";
import { NORMAL_COUNT, getNormal } from "./Normals.js";
import * as Ptcl from "./Ptcl.js";
import * as Rain from "./Rain.js";
import InputManager from "../InputManager.js";
import * as Room from "./Room.js";
import * as Season from "./Season.js";
import * as Tv from "./Tv.js";
import * as Shadow from "./Shadow.js";
import * as Snow from "./Snow.js";
import * as Stars from "./Stars.js";
import * as Sun from "./Sun.js";
import * as Sway from "./Sway.js";
import { Tpl, TplTexture } from "./Tpl.js";
import * as Water from "./Water.js";
import * as Util from "./Util.js";
import * as Weather from "./Weather.js";
import * as Wind from "./Wind.js";
import { PeekZManager, PeekZResult } from "../ZeldaWindWaker/d_dlst_peekZ.js";

//#region Synthetic meshes

export function unitQuadMesh(uvRepeat: number = 1): DecodedMesh {
    const positions: [number, number, number][] = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]];
    const uvs: [number, number][] = [[0, uvRepeat], [uvRepeat, uvRepeat], [uvRepeat, 0], [0, 0]];
    const gv = (i: number): GxVertex => ({ positionIndex: i, normalIndex: 0, uvIndex: i, color0Index: null });
    return {
        positions, uvs,
        triangles: [[gv(0), gv(1), gv(2)], [gv(0), gv(2), gv(3)]],
        triangleOffsets: [0, 0],
    };
}

export function starBatchMesh(batch: Stars.StarBatch, pointSizePx: number): DecodedMesh {
    const positions: [number, number, number][] = [];
    const triangles: [GxVertex, GxVertex, GxVertex][] = [];
    const triangleOffsets: number[] = [];
    const uvs: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const gv = (positionIndex: number, uvIndex: number): GxVertex => ({ positionIndex, normalIndex: 0, uvIndex, color0Index: null });

    for (const inst of batch.instances) {
        const base = positions.length;
        for (const corner of Stars.starQuadCorners(inst.pos, pointSizePx))
            positions.push(corner);
        triangles.push([gv(base + 0, 0), gv(base + 1, 1), gv(base + 2, 2)]);
        triangles.push([gv(base + 0, 0), gv(base + 2, 2), gv(base + 3, 3)]);
        triangleOffsets.push(0, 0);
    }
    return { positions, uvs, triangles, triangleOffsets };
}

export function cloudQuadMesh(): DecodedMesh {
    const positions: [number, number, number][] = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]];
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const gv = (i: number): GxVertex => ({ positionIndex: i, normalIndex: 0, uvIndex: i, color0Index: null });
    return {
        positions, uvs,
        triangles: [[gv(0), gv(1), gv(2)], [gv(0), gv(2), gv(3)]],
        triangleOffsets: [0, 0],
    };
}

export function rainStreakMesh(): DecodedMesh {
    const positions: [number, number, number][] = [[-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0]];
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const colors: [number, number, number, number][] = [
        [255, 255, 255, 255], [255, 255, 255, 255],
        [255, 255, 255, 0], [255, 255, 255, 0],
    ];
    const gv = (i: number): GxVertex => ({ positionIndex: i, normalIndex: 0, uvIndex: i, color0Index: i });
    return {
        positions, uvs, colors,
        triangles: [[gv(0), gv(1), gv(2)], [gv(0), gv(2), gv(3)]],
        triangleOffsets: [0, 0],
    };
}

export function sunRayMesh(): DecodedMesh {
    const r = Sun.RAY_RIM_RADIUS_PIXELS;
    const positions: [number, number, number][] = [[0, -r, 0], [1, 0, 0], [0, r, 0], [0, 0, 0]];
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const colors: [number, number, number, number][] = [
        [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255],
    ];
    const gv = (i: number): GxVertex => ({ positionIndex: i, normalIndex: 0, uvIndex: i, color0Index: i });
    return {
        positions, uvs, colors,
        triangles: [[gv(0), gv(1), gv(2)], [gv(0), gv(2), gv(3)]],
        triangleOffsets: [0, 0],
    };
}

export function leafQuadMesh(): DecodedMesh {
    const h = Leaf.QUAD_HALF_SIZE;
    const positions: [number, number, number][] = [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]];
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const up = (i: number): GxVertex => ({ positionIndex: i, normalIndex: 0, uvIndex: i, color0Index: null });
    const down = (i: number): GxVertex => ({ positionIndex: i, normalIndex: NORMAL_COUNT - 1, uvIndex: i, color0Index: null });
    return {
        positions, uvs,
        triangles: [
            [up(0), up(1), up(2)], [up(0), up(2), up(3)],
            [down(3), down(2), down(1)], [down(3), down(1), down(0)],
        ],
        triangleOffsets: [0, 0, 0, 0],
    };
}

//#endregion

//#region Material keys

export function isLitMaterialKey(key: string): boolean {
    return key === "opaque" || key === "opaque-back" || key === "opaque-vtx" || key === "opaque-back-vtx"
        || key === "ground" || key === "ground-tint" || key === "leaf" || key === "room-additive";
}

const scratchNormal = vec3.create();
const scratchParticleScale = vec3.create();
const scratchSwayDir = vec3.create();
const scratchSwayAxis = vec3.create();

export const LAMP_LIT_ATLAS = `lamp-lit`;
export const LAMP_LIGHT_MAP_ATLAS = `lamp-light-map`;

let currentTimeSeconds = Env.DEFAULT_TIME_SECONDS;
let lampsLit = false;

let lodEnabled = true;
const lodCameraPos = vec3.create();
let swayAmount = 0;
const swayDirView = vec3.create();
const swayAxisView = vec3.create();
let grassSwayPhaseFrames = 0;
let grassWindSpeed = 0;
let grassWindBlend = 0;
const grassWindDirFrom = vec3.create();
const grassWindDirTo = vec3.create();
const grassMeasureView = vec3.create();
const plantBillboardYaw = mat4.create();

//#endregion

//#region GPU model data

export interface ModelPart {
    startIndex: number;
    indexCount: number;
    imageIndex: number;
    untextured: boolean;
    litImageIndex?: number;
    vertexColor: boolean;
}

export class ModelData {
    public inputLayout: GfxInputLayout;
    public vertexBuffers: GfxVertexBufferDescriptor[];
    public indexBuffer: GfxIndexBufferDescriptor;
    public parts: ModelPart[] = [];
    public matColor: Color | null = null;
    public boundsMin = vec3.fromValues(0, 0, 0);
    public boundsMax = vec3.fromValues(0, 0, 0);
    public aabb = new AABB();
    public boundsRadius = 0;
    public sortKey: number;

    private coalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, cache: GfxRenderCache, mesh: DecodedMesh, imageIndexByTriangle: (number | null)[], public atlasKey: string, public materialKey: string = "opaque", public billboard: boolean = false, public screenSpace: boolean = false, public screenAlignedBillboard: boolean = false, public litSwap: boolean = false) {
        this.sortKey = sortKeyForMaterial(materialKey);
        const hasVertexColors = mesh.colors !== undefined;
        if (mesh.matColor !== undefined)
            this.matColor = colorNewFromRGBA(mesh.matColor[0] / 255, mesh.matColor[1] / 255, mesh.matColor[2] / 255, mesh.matColor[3] / 255);
        const partIndexesColor = (triIndex: number): boolean => {
            if (!hasVertexColors || mesh.parts === undefined || mesh.trianglePart === undefined)
                return hasVertexColors;
            return ((mesh.parts[mesh.trianglePart[triIndex]].vcd >>> (3 * 2)) & 3) !== 0;
        };
        const hasNormals = isLitMaterialKey(materialKey);
        const cornerCount = mesh.triangles.length * 3;
        if (mesh.positions.length > 0) {
            vec3.set(this.boundsMin, Infinity, Infinity, Infinity);
            vec3.set(this.boundsMax, -Infinity, -Infinity, -Infinity);
            for (const p of mesh.positions) {
                vec3.min(this.boundsMin, this.boundsMin, p as vec3);
                vec3.max(this.boundsMax, this.boundsMax, p as vec3);
            }
        }
        this.aabb.set(this.boundsMin[0], this.boundsMin[1], this.boundsMin[2], this.boundsMax[0], this.boundsMax[1], this.boundsMax[2]);
        this.boundsRadius = Math.hypot(
            Math.max(Math.abs(this.boundsMin[0]), Math.abs(this.boundsMax[0])),
            Math.max(Math.abs(this.boundsMin[1]), Math.abs(this.boundsMax[1])),
            Math.max(Math.abs(this.boundsMin[2]), Math.abs(this.boundsMax[2])));
        const bytesPerVertex = 12 + (hasNormals ? 12 : 0) + (hasVertexColors ? 4 : 0) + 8;
        const dlBuf = new ArrayBuffer(3 + cornerCount * bytesPerVertex);
        const dlView = new DataView(dlBuf);
        dlView.setUint8(0, 0x90);
        assert(cornerCount <= 0xFFFF, `mesh has ${cornerCount} corners; GX primitive vertex count is u16`);
        dlView.setUint16(1, cornerCount, false);
        let off = 3;
        for (const tri of mesh.triangles) {
            for (const v of tri) {
                const p = mesh.positions[v.positionIndex];
                dlView.setFloat32(off, p[0], false); off += 4;
                dlView.setFloat32(off, p[1], false); off += 4;
                dlView.setFloat32(off, p[2], false); off += 4;
                if (hasNormals) {
                    if (mesh.normals !== undefined && v.normalIndex < mesh.normals.length)
                        vec3.set(scratchNormal, mesh.normals[v.normalIndex][0], mesh.normals[v.normalIndex][1], mesh.normals[v.normalIndex][2]);
                    else
                        getNormal(scratchNormal, v.normalIndex);
                    dlView.setFloat32(off, scratchNormal[0], false); off += 4;
                    dlView.setFloat32(off, scratchNormal[1], false); off += 4;
                    dlView.setFloat32(off, scratchNormal[2], false); off += 4;
                }
                if (hasVertexColors) {
                    const c = (v.color0Index !== null ? mesh.colors![v.color0Index] : undefined) ?? [255, 255, 255, 255];
                    dlView.setUint8(off, c[0]); off += 1;
                    dlView.setUint8(off, c[1]); off += 1;
                    dlView.setUint8(off, c[2]); off += 1;
                    dlView.setUint8(off, c[3]); off += 1;
                }
                const uv = mesh.uvs[v.uvIndex];
                dlView.setFloat32(off, uv[0], false); off += 4;
                dlView.setFloat32(off, uv[1], false); off += 4;
            }
        }

        const vat: GX_VtxAttrFmt[] = [];
        vat[GX.Attr.POS] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.POS_XYZ, compShift: 0 };
        vat[GX.Attr.TEX0] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.TEX_ST, compShift: 0 };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.DIRECT };
        vcd[GX.Attr.TEX0] = { type: GX.AttrType.DIRECT };
        if (hasNormals) {
            vat[GX.Attr.NRM] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.NRM_XYZ, compShift: 0 };
            vcd[GX.Attr.NRM] = { type: GX.AttrType.DIRECT };
        }
        if (hasVertexColors) {
            vat[GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compCnt: GX.CompCnt.CLR_RGBA, compShift: 0 };
            vcd[GX.Attr.CLR0] = { type: GX.AttrType.DIRECT };
        }

        const loader = compileVtxLoader(vat, vcd);
        const loadedVertexData = loader.runVertices([], new ArrayBufferSlice(dlBuf));

        this.inputLayout = createInputLayout(cache, loader.loadedVertexLayout);
        this.coalescer = loadedDataCoalescerComboGfx(device, [loadedVertexData]);
        const buffers = this.coalescer.coalescedBuffers[0];
        this.vertexBuffers = buffers.vertexBuffers;
        this.indexBuffer = buffers.indexBuffer;

        let i = 0;
        while (i < mesh.triangles.length) {
            const img = imageIndexByTriangle[i];
            let j = i + 1;
            while (j < mesh.triangles.length && imageIndexByTriangle[j] === img)
                j++;
            if (img === Material.UNTEXTURED_IMAGE) {
                this.parts.push({ startIndex: i * 3, indexCount: (j - i) * 3, imageIndex: 0, untextured: true, vertexColor: partIndexesColor(i) });
            } else if (img !== null) {
                const litImageIndex = litSwap ? Lamp.litAtlasImageIndex(img) : undefined;
                this.parts.push({ startIndex: i * 3, indexCount: (j - i) * 3, imageIndex: img, untextured: false, litImageIndex, vertexColor: partIndexesColor(i) });
            }
            i = j;
        }
    }

    public destroy(device: GfxDevice): void {
        this.coalescer.destroy(device);
    }
}

//#endregion

//#region Texture cache

const MAX_ANISOTROPY = 16;

function loadAlphaPairedTextureFromMipChain(device: GfxDevice, colorChain: MipChain, alphaChain: MipChain): GfxTexture {
    const firstMipLevel = colorChain.mipLevels[0];
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, firstMipLevel.width, firstMipLevel.height, colorChain.mipLevels.length));
    device.setResourceName(gfxTexture, colorChain.name);

    for (let i = 0; i < colorChain.mipLevels.length; i++) {
        const level = i;
        const alphaLevel = alphaChain.mipLevels[Math.min(i, alphaChain.mipLevels.length - 1)];
        Promise.all([decodeGXTexture(colorChain.mipLevels[i]), decodeGXTexture(alphaLevel)]).then(([color, alpha]) => {
            const pixels = color.pixels as Uint8Array;
            const alphaPixels = alpha.pixels as Uint8Array;
            const count = Math.min(pixels.length, alphaPixels.length) / 4;
            for (let p = 0; p < count; p++)
                pixels[p * 4 + 3] = alphaPixels[p * 4 + 0];
            device.uploadTextureData(gfxTexture, level, [pixels]);
        });
    }

    return gfxTexture;
}

interface CachedTexture {
    gfxTexture: GfxTexture;
    gfxSampler: GfxSampler;
    width: number;
    height: number;
    lodBias: number;
}

export class AtlasTextureCache {
    private textures = new Map<number, CachedTexture>();

    constructor(private device: GfxDevice, private cache: GfxRenderCache, public tpl: Tpl, private alphaTpl?: Tpl) {
    }

    public get(imageIndex: number): CachedTexture {
        let t = this.textures.get(imageIndex);
        if (t === undefined) {
            const tex: TplTexture = this.tpl.textures[imageIndex];
            if (tex === undefined)
                throw new Error(`atlas has no image ${imageIndex} (it has ${this.tpl.textures.length}) - if the .tpl was just edited, clear the stale DataFetcher cache: await caches.delete('request-cache-v1')`);
            const mipChain = calcMipChain(tex, tex.mipCount);
            const alphaTex = this.alphaTpl?.textures[imageIndex];
            const gfxTexture = alphaTex !== undefined
                ? loadAlphaPairedTextureFromMipChain(this.device, mipChain, calcMipChain(alphaTex, alphaTex.mipCount))
                : loadTextureFromMipChain(this.device, mipChain).gfxTexture;
            const [minFilter, mipFilter] = translateTexFilterGfx(tex.minFilter);
            const [magFilter] = translateTexFilterGfx(tex.magFilter);
            const gfxSampler = this.cache.createSampler({
                wrapS: translateWrapModeGfx(tex.wrapS),
                wrapT: translateWrapModeGfx(tex.wrapT),
                minFilter, magFilter, mipFilter,
                minLOD: tex.minLOD, maxLOD: tex.maxLOD,
                maxAnisotropy: (minFilter === GfxTexFilterMode.Bilinear && magFilter === GfxTexFilterMode.Bilinear && mipFilter === GfxMipFilterMode.Linear) ? MAX_ANISOTROPY : 1,
            });
            t = { gfxTexture, gfxSampler, width: tex.width, height: tex.height, lodBias: tex.lodBias };
            this.textures.set(imageIndex, t);
        }
        return t;
    }

    public destroy(device: GfxDevice): void {
        for (const t of this.textures.values())
            device.destroyTexture(t.gfxTexture);
    }
}

//#endregion

//#region Shared materials

export const SHADOW_ALPHA_LIGHT_INDEX = 2;

function setLitColorChannel(mb: GXMaterialBuilder, matSrc: GX.ColorSrc, colorLightMask: number, alphaLit: boolean = false): void {
    mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, matSrc, colorLightMask, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);
    if (alphaLit)
        mb.setChanCtrl(GX.ColorChannelID.ALPHA0, true, GX.ColorSrc.REG, matSrc, 1 << SHADOW_ALPHA_LIGHT_INDEX, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);
    else
        mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, matSrc, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
}

function createSharedMaterial(cullMode: GX.CullMode, lightMask: number, matSrc: GX.ColorSrc = GX.ColorSrc.REG): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder(`HarvestMoonAWL lit textured (${matSrc === GX.ColorSrc.VTX ? "vertex" : "register"} colour)`);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    setLitColorChannel(mb, matSrc, lightMask);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
    mb.setAlphaCompare(GX.CompareType.GREATER, 0x7f, GX.AlphaOp.OR, GX.CompareType.GREATER, 0x7f);
    mb.setZMode(true, GX.CompareType.LEQUAL, true);
    mb.setCullMode(cullMode);
    mb.setFog(Fog.FOG_TYPE, false);
    return new GXMaterialHelperGfx(mb.finish());
}

function createUntexturedMaterial(matSrc: GX.ColorSrc, cullMode: GX.CullMode, lightMask: number): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder(`HarvestMoonAWL lit untextured (${matSrc === GX.ColorSrc.VTX ? "vertex" : "register"} colour, ${cullMode === GX.CullMode.BACK ? "cull back" : "no cull"})`);
    setLitColorChannel(mb, matSrc, lightMask);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
    mb.setAlphaCompare(GX.CompareType.GREATER, 0x7f, GX.AlphaOp.OR, GX.CompareType.GREATER, 0x7f);
    mb.setZMode(true, GX.CompareType.LEQUAL, true);
    mb.setCullMode(cullMode);
    mb.setFog(Fog.FOG_TYPE, false);
    return new GXMaterialHelperGfx(mb.finish());
}

export interface PartMaterials {
    untextured: { reg: GXMaterialHelperGfx; vtx: GXMaterialHelperGfx; regBack: GXMaterialHelperGfx; vtxBack: GXMaterialHelperGfx; };
    vertexColorByKey: Map<string, GXMaterialHelperGfx>;
}
export function isBackCullMaterialKey(key: string): boolean {
    return key === "opaque-back" || key === "opaque-back-vtx" || key === "ground" || key === "leaf";
}

function createLampLitMaterial(lightMask: number): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL lamp-lit surface");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    setLitColorChannel(mb, GX.ColorSrc.REG, lightMask);

    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.RASC, GX.CC.ONE, GX.CC.TEXA, GX.CC.ZERO);
    mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
    mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_1);

    mb.setTevOrder(1, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
    mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.TEXC, GX.CC.CPREV, GX.CC.ZERO);
    mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
    mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevKAlphaSel(1, GX.KonstAlphaSel.KASEL_1);

    mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    mb.setZMode(true, GX.CompareType.LEQUAL, true);
    mb.setCullMode(GX.CullMode.BACK);
    mb.setFog(Fog.FOG_TYPE, false);
    return new GXMaterialHelperGfx(mb.finish());
}

function createGroundTintMaterial(lightMask: number): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL ground shading (projected shadow map x albedo)");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX3);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR0A0);
    setLitColorChannel(mb, GX.ColorSrc.VTX, lightMask, true);
    mb.setTevColorIn(0, GX.CC.TEXA, GX.CC.TEXC, GX.CC.RASA, GX.CC.RASC);
    mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.SUBHALF, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
    mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX4);
    mb.setTevOrder(1, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2, GX.RasColorChannelID.COLOR0A0);
    mb.setTevSwapMode(1, undefined, [GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R]);
    mb.setTevColorIn(1, GX.CC.HALF, GX.CC.TEXC, GX.CC.RASA, GX.CC.CPREV);
    mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.SUBHALF, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
    mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    mb.setTevOrder(2, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
    mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.TEXC, GX.CC.CPREV, GX.CC.ZERO);
    mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
    mb.setZMode(true, GX.CompareType.LEQUAL, true);
    mb.setCullMode(GX.CullMode.BACK);
    mb.setFog(Fog.FOG_TYPE, false);
    return new GXMaterialHelperGfx(mb.finish());
}

function createWaterMaterial(texGenSrc: GX.TexGenSrc): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder(`HarvestMoonAWL water (indirect bump-mapped, ${texGenSrc === GX.TexGenSrc.POS ? "position" : "uv"})`);
    mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, texGenSrc, GX.TexGenMatrix.TEXMTX0);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, texGenSrc, GX.TexGenMatrix.TEXMTX1);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX2);

    mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0);
    mb.setIndTexOrder(GX.IndTexStageID.STAGE1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP0);

    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
    mb.setTevIndirect(0, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.ST, GX.IndTexMtxID._0, GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);

    mb.setTevOrder(1, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
    mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
    mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
    mb.setTevIndirect(1, GX.IndTexStageID.STAGE1, GX.IndTexFormat._8, GX.IndTexBiasSel.ST, GX.IndTexMtxID._0, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(true, GX.CompareType.LEQUAL, false);
    mb.setCullMode(GX.CullMode.BACK);
    return new GXMaterialHelperGfx(mb.finish());
}

function createWaterTintPassMaterial(matSrc: GX.ColorSrc): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder(`HarvestMoonAWL water tint pass (${matSrc === GX.ColorSrc.VTX ? "vertex" : "register"} colour)`);
    mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, matSrc, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, matSrc, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
    mb.setTevSwapMode(0, undefined, [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.R]);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.A0, GX.CA.RASA, GX.CA.ZERO);
    mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
    mb.setZMode(true, GX.CompareType.LEQUAL, false);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.CLEAR);
    mb.setCullMode(GX.CullMode.BACK);
    return new GXMaterialHelperGfx(mb.finish());
}

function createWaterFoamMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL water foam overlay (shoreline surf)");
    mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);

    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ONE);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
    const FOAM_SWAP_A_TAKES_RED: [GX.TevColorChan, GX.TevColorChan, GX.TevColorChan, GX.TevColorChan] =
        [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.R];
    mb.setTevSwapMode(0, FOAM_SWAP_A_TAKES_RED, FOAM_SWAP_A_TAKES_RED);

    mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
    mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ONE);
    mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.A0, GX.CA.ZERO);

    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(true, GX.CompareType.LEQUAL, false);
    mb.setCullMode(GX.CullMode.BACK);
    return new GXMaterialHelperGfx(mb.finish());
}

const WATER_TEX_MTX2 = mat4.create();
mat4.set(WATER_TEX_MTX2,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0.5, 0.5, 0, 0,
);

const WATER_IND_MTX_SCALE = 2 ** (16 - 17);
const WATER_IND_TEX_MTX = mat4.create();
fillIndTexMtx(WATER_IND_TEX_MTX, new Float32Array([
    (512 / 1024) * WATER_IND_MTX_SCALE, 0, 0, 0, // a, c, tx, scale
    0, (512 / 1024) * WATER_IND_MTX_SCALE, 0,    // b, d, ty
]));

function createSkyMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL sky dome (day/night cross-fade)");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);

    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);

    mb.setTevOrder(1, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
    mb.setTevKColorSel(1, GX.KonstColorSel.KCSEL_K0);
    mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.TEXC, GX.CC.KONST, GX.CC.ZERO);
    mb.setTevAlphaIn(1, GX.CA.APREV, GX.CA.TEXA, GX.CA.KONST, GX.CA.ZERO);
    mb.setTevKAlphaSel(1, GX.KonstAlphaSel.KASEL_K0_R);

    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.FRONT);
    return new GXMaterialHelperGfx(mb.finish());
}

function createRoomAdditiveMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL room additive (light shafts, glass)");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
    mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
    mb.setZMode(true, GX.CompareType.LEQUAL, false);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setCullMode(GX.CullMode.BACK);
    return new GXMaterialHelperGfx(mb.finish());
}

function createTvScreenMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL TV screen (unlit, alpha-blended sprites)");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
    mb.setAlphaCompare(GX.CompareType.GREATER, 0x7f, GX.AlphaOp.OR, GX.CompareType.GREATER, 0x7f);
    mb.setZMode(true, GX.CompareType.LEQUAL, true);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.CLEAR);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createSunMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL sun (additive)");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createSunFlareMaterial(name: string = "HarvestMoonAWL sun flare (screen-space additive)"): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder(name);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.C1, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createSunRaysMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL sun rays (screen-space additive)");
    mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.RASC, GX.CC.C1, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createSunFlashMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL sun flash (screen-space whiteout)");
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C1);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A1);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createMoonMaterial(name: string = "HarvestMoonAWL moon (scaled additive)", depthTested: boolean = false): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder(name);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    if (depthTested)
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
    else
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createStarMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL star field (scaled additive)");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.C1, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.A1, GX.CA.ZERO);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createCloudMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL cloud deck");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.C1, GX.CC.C0, GX.CC.TEXC, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.A0, GX.CA.ZERO);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.CLEAR);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createRainMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL rain (scaled additive, depth-independent)");
    mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(false, GX.CompareType.ALWAYS, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

function createSnowMaterial(): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder("HarvestMoonAWL snow (scaled additive point sprites)");
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.C0, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A0);
    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR);
    mb.setZMode(true, GX.CompareType.LEQUAL, false);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

export function createParticleMaterial(blendMode: number, zTest: boolean, zWrite: boolean): GXMaterialHelperGfx {
    const mb = new GXMaterialBuilder(`HarvestMoonAWL particle (blend ${blendMode}, z ${zTest ? "test" : "off"}${zWrite ? "+write" : ""})`);
    mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
    mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
    mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.C1, GX.CC.ZERO);
    mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.A1, GX.CA.ZERO);
    switch (blendMode) {
    case 0: mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.CLEAR); break;
    case 1: mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE, GX.LogicOp.CLEAR); break;
    case 2: mb.setBlendMode(GX.BlendMode.SUBTRACT, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.CLEAR); break;
    default: mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCCLR, GX.BlendFactor.ZERO, GX.LogicOp.CLEAR); break;
    }
    mb.setZMode(zTest, GX.CompareType.LEQUAL, zWrite);
    mb.setCullMode(GX.CullMode.NONE);
    return new GXMaterialHelperGfx(mb.finish());
}

export function particleMaterialKeys(): [string, GXMaterialHelperGfx][] {
    const out: [string, GXMaterialHelperGfx][] = [];
    for (let blend = 0; blend < 4; blend++)
        for (const zTest of [true, false])
            for (const zWrite of [true, false])
                out.push([`particle:b${blend}:${zTest ? "zt" : "zn"}:${zWrite ? "zw" : "zr"}`, createParticleMaterial(blend, zTest, zWrite)]);
    return out;
}

//#endregion

//#region Frame queue

function sortKeyForMaterial(key: string): number {
    switch (key) {
    case "sky":                         return makeSortKey(GfxRendererLayer.BACKGROUND + 0);
    case "star":                        return makeSortKey(GfxRendererLayer.BACKGROUND + 1);
    case "sun": case "moon":            return makeSortKey(GfxRendererLayer.BACKGROUND + 2);
    case "cloud":                       return makeSortKey(GfxRendererLayer.BACKGROUND + 3);
    case "water": case "water-uv": case "water-foam":
    case "water-tint": case "water-tint-vtx":
    case "rain":                        return makeSortKey(GfxRendererLayer.TRANSLUCENT + 0);
    case "lamp-glow":                   return makeSortKey(GfxRendererLayer.TRANSLUCENT + 1);
    case "snow":                        return makeSortKey(GfxRendererLayer.TRANSLUCENT + 2);
    case "room-additive":               return makeSortKey(GfxRendererLayer.TRANSLUCENT + 3);
    case "sun-rays":                    return makeSortKey(GfxRendererLayer.TRANSLUCENT + 4);
    case "sun-flare":                   return makeSortKey(GfxRendererLayer.TRANSLUCENT + 5);
    case "sun-flash":                   return makeSortKey(GfxRendererLayer.TRANSLUCENT + 6);
    case "moon-glare":                  return makeSortKey(GfxRendererLayer.TRANSLUCENT + 7);
    case "tv-screen":                   return makeSortKey(GfxRendererLayer.TRANSLUCENT + 9);
    default:
        if (key.startsWith("particle:"))
            return makeSortKey(GfxRendererLayer.TRANSLUCENT + 8);
        return makeSortKey(GfxRendererLayer.OPAQUE);
    }
}

//#endregion

//#region Scratch state

const materialParams = new MaterialParams();

const MAT_COLOR_DEFAULT = colorNewFromRGBA(1, 1, 1, 1);
const scratchLightShaftColor = colorNewFromRGBA(1, 1, 1, 1);
const scratchRoomGlowColor = colorNewFromRGBA(1, 1, 1, 1);
const drawParams = new DrawParams();
const scratchCameraPos = vec3.create();
const scratchLightPos = vec3.create();
const scratchSunPos = vec3.create();
const scratchSunNdc: [number, number] = [0, 0];
let sunDiscAlpha = 1.0;
const scratchSunDiscColor = colorNewFromRGBA(1, 1, 1, 1);
const scratchMoonPos = vec3.create();
const scratchMoonNdc: [number, number] = [0, 0];
const scratchMoonGlareColor = colorNewFromRGBA(1, 1, 1, 1);
const scratchCloudOrigin = vec3.create();
const scratchRainCameraPos = vec3.create();
const scratchRainForward = vec3.create();
const scratchRainTranslate = vec3.create();
const scratchRainScale = vec3.create();
const scratchSnowSway = vec3.create();
const scratchLeafPos = vec3.create();
const scratchGrassPos = vec3.create();
const scratchGrassSwayPos = vec3.create();
const scratchTwinkleColors: Color[] = [];
for (let i = 0; i < Stars.TWINKLE_SLOT_COUNT; i++)
    scratchTwinkleColors.push(colorNewFromRGBA(1, 1, 1, 1));

function peekZUnoccluded(result: PeekZResult): boolean {
    if (result.triviallyCulled || result.value === null)
        return false;
    return !compareDepthValues(result.value, reverseDepthForClearValue(1.0), GfxCompareMode.Less);
}

const scratchFlareColor = colorNewFromRGBA(1, 1, 1, 1);
const scratchRayColor = colorNewFromRGBA(1, 1, 1, 1);
const scratchFlashColor = colorNewFromRGBA(1, 1, 1, 1);
const scratchFogBlock = new FogBlock();
const scratchFoamState: Water.FoamState = { alpha: 0, offsetX: 0 };
const scratchScreenSceneParams = new SceneParams();
const scratchShadowSceneParams = new SceneParams();
const shadowMaterialParams = new MaterialParams();
const scratchShadowLightDir = vec3.create();
const scratchShadowCameraPos = vec3.create();
const scratchCasterMtx = mat4.create();
const scratchShadowClipFromWorld = mat4.create();
const scratchPlantBillboard = mat4.create();
const scratchCasterCorner = vec3.create();
const scratchCasterPos = vec3.create();

function isBumpWaterMaterialKey(key: string): boolean {
    return key === "water" || key === "water-uv";
}

mat4.copy(materialParams.u_TexMtx[2], WATER_TEX_MTX2);
mat4.copy(materialParams.u_IndTexMtx[0], WATER_IND_TEX_MTX);

export function evalWaterTint(dst: Color, env: Env.EnvState, weatherLightFactor: number): void {
    const byte = (c: number) => Math.max(0, Math.min(255, Math.trunc(c * 255)));
    const sum = byte(env.ambient.r) + byte(env.ambient.g) + byte(env.ambient.b)
        + byte(env.keyLightColor.r) + byte(env.keyLightColor.g) + byte(env.keyLightColor.b);
    const grey = Math.min(255, Math.trunc(sum / 6));
    const scale = 0.5 * (1.0 + weatherLightFactor);
    const v = Math.trunc(grey * scale) / 255;
    colorFromRGBA(dst, v, v, v, 1.0);
}

const waterTintC0 = colorNewFromRGBA(1, 1, 1, 1);
export const waterTintPassC0 = colorNewFromRGBA(1, 1, 1, 1);

//#endregion

//#region Culling and sharing

const SWAY_CULL_SCALE = 1.25;
const SWAY_CULL_MARGIN = 1.0;
const scratchCullAABB = new AABB();
const scratchCullCenter = vec3.create();

function matrixMaxScale(m: ReadonlyMat4): number {
    const sx = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
    const sy = m[4] * m[4] + m[5] * m[5] + m[6] * m[6];
    const sz = m[8] * m[8] + m[9] * m[9] + m[10] * m[10];
    return Math.sqrt(Math.max(sx, sy, sz));
}

const materialBlockCache = new Map<GXMaterialHelperGfx, Map<CachedTexture | null, Map<number, number>>>();

function resetMaterialBlockCache(): void {
    materialBlockCache.clear();
}

function matColorKey(c: Color): number {
    return ((c.r * 255) << 24 | (c.g * 255) << 16 | (c.b * 255) << 8 | (c.a * 255)) >>> 0;
}

function lookupMaterialBlock(materialHelper: GXMaterialHelperGfx, tex: CachedTexture | null, matColor: Color): number | undefined {
    return materialBlockCache.get(materialHelper)?.get(tex)?.get(matColorKey(matColor));
}

function storeMaterialBlock(materialHelper: GXMaterialHelperGfx, tex: CachedTexture | null, matColor: Color, wordOffset: number): void {
    let byTex = materialBlockCache.get(materialHelper);
    if (byTex === undefined) {
        byTex = new Map();
        materialBlockCache.set(materialHelper, byTex);
    }
    let byColor = byTex.get(tex);
    if (byColor === undefined) {
        byColor = new Map();
        byTex.set(tex, byColor);
    }
    byColor.set(matColorKey(matColor), wordOffset);
}

const sceneDefaultLights: Light[] = [];
for (let i = 0; i < 8; i++)
    sceneDefaultLights.push(new Light());
const sceneDefaultAmbient = colorNewFromRGBA(1, 1, 1, 0);
let appliedLightRig: Room.RoomLighting | null = null;

function snapshotSceneDefaultLights(): void {
    for (let i = 0; i < sceneDefaultLights.length; i++)
        sceneDefaultLights[i].copy(materialParams.u_Lights[i]);
    colorCopy(sceneDefaultAmbient, materialParams.u_Color[ColorKind.AMB0]);
    appliedLightRig = null;
}

function lightSetFromRoomLight(dst: Light, viewMatrix: ReadonlyMat4, src: Light): void {
    transformVec3Mat4w1(dst.Position, viewMatrix, src.Position);
    transformVec3Mat4w0(dst.Direction, viewMatrix, src.Direction);
    vec3.normalize(dst.Direction, dst.Direction);
    vec3.copy(dst.CosAtten, src.CosAtten);
    vec3.copy(dst.DistAtten, src.DistAtten);
    colorCopy(dst.Color, src.Color);
}

function applyLightRig(rig: Room.RoomLighting | null, viewMatrix: ReadonlyMat4): void {
    if (rig === appliedLightRig)
        return;
    appliedLightRig = rig;
    resetMaterialBlockCache();
    if (rig === null) {
        for (let i = 0; i < sceneDefaultLights.length; i++)
            materialParams.u_Lights[i].copy(sceneDefaultLights[i]);
        colorCopy(materialParams.u_Color[ColorKind.AMB0], sceneDefaultAmbient);
        return;
    }
    for (let i = 0; i < materialParams.u_Lights.length; i++) {
        if (i < rig.lights.length)
            lightSetFromRoomLight(materialParams.u_Lights[i], viewMatrix, rig.lights[i]);
        else
            materialParams.u_Lights[i].reset();
    }
    colorCopy(materialParams.u_Color[ColorKind.AMB0], rig.ambient);
}

function bindMaterialParams(renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, materialHelper: GXMaterialHelperGfx, params: MaterialParams, tex: CachedTexture | null, shareable: boolean, matColor: Color): void {
    const wordCount = materialHelper.materialParamsBufferSize;
    const shared = shareable ? lookupMaterialBlock(materialHelper, tex, matColor) : undefined;
    if (shared !== undefined) {
        renderInst.setUniformBufferOffset(GX_Program.ub_MaterialParams, shared, wordCount);
        return;
    }
    const wordOffset = renderInst.allocateUniformBuffer(GX_Program.ub_MaterialParams, wordCount);
    materialHelper.fillMaterialParamsData(renderInstManager, wordOffset, params);
    if (shareable)
        storeMaterialBlock(materialHelper, tex, matColor, wordOffset);
}

//#endregion

//#region ModelInstance

export class ModelInstance {
    public modelMatrix = mat4.create();
    public visible = true;

    public sunFollow = false;

    public moonFollow = false;

    public followCameraGround = false;

    public imageIndexOverride: number | null = null;

    public colorOverride: Color | null = null;

    public colorOverrideC0: Color | null = null;

    public matColorOverride: Color | null = null;

    public waterAnim: Water.WaterAnim | null = null;

    public waterFoam: { phaseTicks: number, baseMatrix: mat4 } | null = null;

    public skyBlend: Env.SkyBlend | null = null;

    public lightRig: Room.RoomLighting | null = null;

    public shadowCaster = Shadow.CasterKind.None;

    public swayMode = Sway.SwayMode.Static;

    public grassSway = false;

    public lodFar: ModelData | null = null;
    public lodFarSwayMode = Sway.SwayMode.Static;

    constructor(public data: ModelData) {
    }

    private useFarLod(): boolean {
        return this.lodFar !== null && lodEnabled && Lod.isFar(this.modelMatrix, lodCameraPos);
    }

    public renderData(): ModelData {
        return this.useFarLod() ? this.lodFar! : this.data;
    }

    private isInFrustum(data: ModelData, swayMode: Sway.SwayMode, frustum: Frustum): boolean {
        if (data.screenSpace || this.sunFollow || this.moonFollow || this.followCameraGround)
            return true;
        const m = this.modelMatrix;
        if (swayMode !== Sway.SwayMode.Static || this.grassSway || data.billboard || data.screenAlignedBillboard) {
            vec3.set(scratchCullCenter, m[12], m[13], m[14]);
            return frustum.containsSphere(scratchCullCenter, data.boundsRadius * matrixMaxScale(m) * SWAY_CULL_SCALE + SWAY_CULL_MARGIN);
        }
        scratchCullAABB.transform(data.aabb, m);
        return frustum.contains(scratchCullAABB);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, materialHelper: GXMaterialHelperGfx, textureCache: AtlasTextureCache, bumpTextureCache?: AtlasTextureCache, lamp?: LampBindings, shadow?: ShadowBindings, partMaterials?: PartMaterials): void {
        if (!this.visible)
            return;

        const far = this.useFarLod();
        const data = far ? this.lodFar! : this.data;
        const swayMode = far ? this.lodFarSwayMode : this.swayMode;

        if (this.sunFollow) {
            Sun.sunWorldPosition(scratchSunPos, viewerInput, currentTimeSeconds);
            mat4.fromTranslation(this.modelMatrix, scratchSunPos);
            mat4.scale(this.modelMatrix, this.modelMatrix, [Sun.HALF_SIZE, Sun.HALF_SIZE, 1]);
            colorFromRGBA(scratchSunDiscColor, 1, 1, 1, sunDiscAlpha);
            this.matColorOverride = scratchSunDiscColor;
        } else if (this.moonFollow) {
            Moon.moonWorldPosition(scratchMoonPos, viewerInput, currentTimeSeconds);
            mat4.fromTranslation(this.modelMatrix, scratchMoonPos);
            mat4.scale(this.modelMatrix, this.modelMatrix, [Moon.HALF_SIZE, Moon.HALF_SIZE, 1]);
        } else if (this.followCameraGround) {
            Sun.arcCenterPosition(scratchCameraPos, viewerInput);
            mat4.fromTranslation(this.modelMatrix, scratchCameraPos);
        }

        if (!this.isInFrustum(data, swayMode, viewerInput.camera.frustum))
            return;

        if (data.screenSpace) {
            mat4.copy(drawParams.u_PosMtx[0], this.modelMatrix);
        } else {
            if (swayMode === Sway.SwayMode.BillboardSway) {
                Sway.fillBillboardWorldMatrix(scratchPlantBillboard, plantBillboardYaw, this.modelMatrix);
                mat4.mul(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchPlantBillboard);
            } else {
                mat4.mul(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix, this.modelMatrix);

                if (data.screenAlignedBillboard) {
                    calcBillboardMatrix(
                        drawParams.u_PosMtx[0], drawParams.u_PosMtx[0],
                        CalcBillboardFlags.UseZPlane | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseRollGlobal,
                    );
                } else if (data.billboard) {
                    calcBillboardMatrix(
                        drawParams.u_PosMtx[0], drawParams.u_PosMtx[0],
                        CalcBillboardFlags.UseZSphere | CalcBillboardFlags.PriorityY | CalcBillboardFlags.UseRollLocal,
                    );
                }
            }

            if (swayMode !== Sway.SwayMode.Static && swayAmount > 0)
                Sway.applySwayViewSpace(drawParams.u_PosMtx[0], swayAmount, swayDirView, swayAxisView);

            if (this.grassSway && grassWindSpeed > 0) {
                vec3.set(scratchGrassSwayPos, this.modelMatrix[12], this.modelMatrix[13], this.modelMatrix[14]);
                const amount = Sway.grassSwayAmount(grassSwayPhaseFrames, grassWindSpeed, grassWindDirFrom, grassWindDirTo, grassWindBlend, scratchGrassSwayPos);
                if (amount > 0)
                    Sway.applySwayViewSpace(drawParams.u_PosMtx[0], amount, grassMeasureView, swayDirView);
            }
        }

        applyLightRig(this.lightRig, viewerInput.camera.viewMatrix);

        const shareable = this.colorOverride === null && this.colorOverrideC0 === null && this.matColorOverride === null
            && this.skyBlend === null && this.waterAnim === null && this.waterFoam === null
            && !isBumpWaterMaterialKey(data.materialKey);

        for (const part of data.parts) {
            const useLit = lampsLit && part.litImageIndex !== undefined && lamp?.litAtlas !== undefined;
            const tex = part.untextured ? null : useLit
                ? lamp!.litAtlas!.get(part.litImageIndex!)
                : textureCache.get(this.imageIndexOverride !== null ? this.imageIndexOverride : part.imageIndex);
            let partMaterialHelper = materialHelper;
            if (part.untextured && partMaterials !== undefined) {
                const back = isBackCullMaterialKey(data.materialKey);
                partMaterialHelper = part.vertexColor ? (back ? partMaterials.untextured.vtxBack : partMaterials.untextured.vtx)
                    : (back ? partMaterials.untextured.regBack : partMaterials.untextured.reg);
            } else if (useLit && lamp?.litMaterial !== undefined) {
                partMaterialHelper = lamp.litMaterial;
            } else if (part.vertexColor && partMaterials !== undefined) {
                partMaterialHelper = partMaterials.vertexColorByKey.get(data.materialKey) ?? materialHelper;
            }

            const renderInst = renderInstManager.newRenderInst();
            renderInst.setVertexInput(data.inputLayout, data.vertexBuffers, data.indexBuffer);
            renderInst.setDrawCount(part.indexCount, part.startIndex);

            partMaterialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
            // materialParams is shared across every instance, so an override has to be undone
            // for anything not carrying one
            colorCopy(materialParams.u_Color[ColorKind.C1], this.colorOverride !== null ? this.colorOverride : MAT_COLOR_DEFAULT);
            const matColor = this.matColorOverride !== null ? this.matColorOverride : data.matColor !== null ? data.matColor : MAT_COLOR_DEFAULT;
            colorCopy(materialParams.u_Color[ColorKind.MAT0], matColor);
            if (this.colorOverrideC0 !== null)
                colorCopy(materialParams.u_Color[ColorKind.C0], this.colorOverrideC0);
            else if (this.waterAnim === null && this.waterFoam === null)
                colorCopy(materialParams.u_Color[ColorKind.C0], MAT_COLOR_DEFAULT);
            renderInst.sortKey = data.sortKey;

            if (isBumpWaterMaterialKey(data.materialKey) && bumpTextureCache !== undefined) {
                const bumpTex = bumpTextureCache.get(0);
                materialParams.m_TextureMapping[0].gfxTexture = bumpTex.gfxTexture;
                materialParams.m_TextureMapping[0].gfxSampler = bumpTex.gfxSampler;
                materialParams.m_TextureMapping[0].width = bumpTex.width;
                materialParams.m_TextureMapping[0].height = bumpTex.height;
                materialParams.m_TextureMapping[0].lodBias = bumpTex.lodBias;

                materialParams.m_TextureMapping[1].gfxTexture = tex!.gfxTexture;
                materialParams.m_TextureMapping[1].gfxSampler = tex!.gfxSampler;
                materialParams.m_TextureMapping[1].width = tex!.width;
                materialParams.m_TextureMapping[1].height = tex!.height;
                materialParams.m_TextureMapping[1].lodBias = tex!.lodBias;
            } else if (this.skyBlend !== null) {
                const a = textureCache.get(this.skyBlend.frameA);
                const b = textureCache.get(this.skyBlend.frameB);
                materialParams.m_TextureMapping[0].gfxTexture = a.gfxTexture;
                materialParams.m_TextureMapping[0].gfxSampler = a.gfxSampler;
                materialParams.m_TextureMapping[0].width = a.width;
                materialParams.m_TextureMapping[0].height = a.height;
                materialParams.m_TextureMapping[0].lodBias = a.lodBias;

                materialParams.m_TextureMapping[1].gfxTexture = b.gfxTexture;
                materialParams.m_TextureMapping[1].gfxSampler = b.gfxSampler;
                materialParams.m_TextureMapping[1].width = b.width;
                materialParams.m_TextureMapping[1].height = b.height;
                materialParams.m_TextureMapping[1].lodBias = b.lodBias;

                colorFromRGBA(materialParams.u_Color[ColorKind.K0], this.skyBlend.t, this.skyBlend.t, this.skyBlend.t, this.skyBlend.t);
            } else if (tex !== null) {
                materialParams.m_TextureMapping[0].gfxTexture = tex.gfxTexture;
                materialParams.m_TextureMapping[0].gfxSampler = tex.gfxSampler;
                materialParams.m_TextureMapping[0].width = tex.width;
                materialParams.m_TextureMapping[0].height = tex.height;
                materialParams.m_TextureMapping[0].lodBias = tex.lodBias;
            } else {
                materialParams.m_TextureMapping[0].gfxTexture = null;
                materialParams.m_TextureMapping[0].gfxSampler = null;
                materialParams.m_TextureMapping[0].width = 0;
                materialParams.m_TextureMapping[0].height = 0;
                materialParams.m_TextureMapping[0].lodBias = 0;
            }

            materialParams.m_TextureMapping[2].lateBinding = undefined;
            if (data.materialKey === "ground-tint" && lamp?.lightMap !== undefined && lamp.lightMapMtx !== null) {
                const light = lamp.lightMap.get(lampsLit ? Lamp.LIGHT_MAP_ON_IMAGE : Lamp.LIGHT_MAP_OFF_IMAGE);
                materialParams.m_TextureMapping[1].gfxTexture = light.gfxTexture;
                materialParams.m_TextureMapping[1].gfxSampler = light.gfxSampler;
                materialParams.m_TextureMapping[1].width = light.width;
                materialParams.m_TextureMapping[1].height = light.height;
                materialParams.m_TextureMapping[1].lodBias = light.lodBias;
                mat4.copy(materialParams.u_TexMtx[3], lamp.lightMapMtx);

                if (shadow !== undefined) {
                    materialParams.m_TextureMapping[2].gfxTexture = null;
                    materialParams.m_TextureMapping[2].gfxSampler = shadow.sampler;
                    materialParams.m_TextureMapping[2].width = Shadow.BUFFER_WIDTH;
                    materialParams.m_TextureMapping[2].height = Shadow.BUFFER_HEIGHT;
                    materialParams.m_TextureMapping[2].lodBias = 0;
                    materialParams.m_TextureMapping[2].lateBinding = Shadow.LATE_BINDING;
                    mat4.copy(materialParams.u_TexMtx[4], shadow.texMtx);
                }
            }
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
            bindMaterialParams(renderInstManager, renderInst, partMaterialHelper, materialParams, tex, shareable, matColor);
            partMaterialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);

            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public prepareShadowCast(renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, lightView: mat4, lightYaw: mat4, lightFrustum: Frustum, textureCache: AtlasTextureCache | undefined): void {
        if (this.shadowCaster === Shadow.CasterKind.Billboard) {
            mat4.getTranslation(scratchCasterPos, this.modelMatrix);
            if (!lightFrustum.containsSphere(scratchCasterPos, this.data.boundsRadius))
                return;
            mat4.fromTranslation(scratchCasterMtx, scratchCasterPos);
            mat4.mul(scratchCasterMtx, scratchCasterMtx, lightYaw);
            mat4.mul(drawParams.u_PosMtx[0], lightView, scratchCasterMtx);
        } else {
            scratchCullAABB.transform(this.data.aabb, this.modelMatrix);
            if (!lightFrustum.contains(scratchCullAABB))
                return;
            mat4.mul(drawParams.u_PosMtx[0], lightView, this.modelMatrix);
        }

        for (const part of this.data.parts) {
            let tex: CachedTexture | null = null;
            if (this.shadowCaster === Shadow.CasterKind.Billboard) {
                if (textureCache === undefined)
                    return;
                tex = textureCache.get(part.imageIndex);
                shadowMaterialParams.m_TextureMapping[0].gfxTexture = tex.gfxTexture;
                shadowMaterialParams.m_TextureMapping[0].gfxSampler = tex.gfxSampler;
                shadowMaterialParams.m_TextureMapping[0].width = tex.width;
                shadowMaterialParams.m_TextureMapping[0].height = tex.height;
            } else {
                shadowMaterialParams.m_TextureMapping[0].reset();
            }
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setVertexInput(this.data.inputLayout, this.data.vertexBuffers, this.data.indexBuffer);
            renderInst.setDrawCount(part.indexCount, part.startIndex);
            materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
            renderInst.setSamplerBindingsFromTextureMappings(shadowMaterialParams.m_TextureMapping);
            bindMaterialParams(renderInstManager, renderInst, materialHelper, shadowMaterialParams, tex, true, MAT_COLOR_DEFAULT);
            materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
            renderInstManager.submitRenderInst(renderInst);
        }
    }
}

//#endregion

//#region Model cache

export interface ShadowBindings {
    sampler: GfxSampler;
    texMtx: mat4;
}

export interface LampBindings {
    litAtlas: AtlasTextureCache | undefined;
    lightMap: AtlasTextureCache | undefined;
    lightMapMtx: mat4 | null;
    litMaterial: GXMaterialHelperGfx | undefined;
}

export interface BuiltModel {
    mesh: DecodedMesh;
    imageIndexByTriangle: (number | null)[];
    atlasKey: string;
    materialKey?: string;
    billboard?: boolean;
    screenSpace?: boolean;
    litSwap?: boolean;
    screenAlignedBillboard?: boolean;
}

export class ModelCache {
    private data = new Map<string, ModelData>();

    constructor(public device: GfxDevice, public cache: GfxRenderCache) {
    }

    public getOrCreate(key: string, build: () => BuiltModel | null): ModelData | null {
        let d = this.data.get(key);
        if (d === undefined) {
            const built = build();
            if (built === null)
                return null;
            d = new ModelData(this.device, this.cache, built.mesh, built.imageIndexByTriangle, built.atlasKey, built.materialKey ?? "opaque", built.billboard ?? false, built.screenSpace ?? false, built.screenAlignedBillboard ?? false, built.litSwap ?? false);
            this.data.set(key, d);
        }
        return d;
    }

    public destroy(device: GfxDevice): void {
        for (const d of this.data.values())
            d.destroy(device);
    }
}

//#endregion

//#region Particle groups

export class ParticleGroup {
    public instances: ModelInstance[] = [];

    constructor(public emitter: Ptcl.ParticleEmitter, data: ModelData) {
        for (let i = 0; i < emitter.particles.length; i++) {
            const inst = new ModelInstance(data);
            inst.visible = false;
            inst.colorOverride = colorNewFromRGBA(1, 1, 1, 1);
            this.instances.push(inst);
        }
    }

    public update(deltaTimeMs: number, windOctant: number, windSpeed: number): void {
        this.emitter.update(deltaTimeMs, windOctant, windSpeed);

        for (let i = 0; i < this.emitter.particles.length; i++) {
            const p = this.emitter.particles[i];
            const inst = this.instances[i];
            inst.visible = p.alive;
            if (!p.alive)
                continue;
            mat4.fromTranslation(inst.modelMatrix, p.pos);
            const halfExtent = p.size * Ptcl.SIZE_TO_HALF_EXTENT;
            vec3.set(scratchParticleScale, halfExtent, halfExtent, 1);
            mat4.scale(inst.modelMatrix, inst.modelMatrix, scratchParticleScale);
            mat4.mul(inst.modelMatrix, this.emitter.worldMatrix, inst.modelMatrix);
            colorCopy(inst.colorOverride!, p.color);
        }
    }
}

export interface SunFlareEntry {
    instance: ModelInstance;
    t: number;
    halfWidthPixels: number;
    halfHeightPixels: number;
}

export interface SunRayEntry {
    instance: ModelInstance;
    spoke: Sun.RaySpoke;
}

export interface ScreenSpaceQuad {
    instance: ModelInstance;
    halfWidthPixels: number;
    halfHeightPixels: number;
}

export interface StarBatchEntry {
    instance: ModelInstance;
    twinkleSlot: number;
}

export interface CloudDeck {
    instances: ModelInstance[];
    imageAspect: number[];
    colorC0: Color[];
    colorC1: Color[];
}

//#endregion

//#region Scene renderer

const CAMERA_SPEED_ACCUM_PER_SEC = 3600;

const CAMERA_FOCUS_SECONDS = 5;

export class HarvestMoonAWLRenderer extends BasicGXRendererHelper {

    //#region Scene state

    public instances: ModelInstance[] = [];
    public sunFlares: SunFlareEntry[] = [];
    public sunRays: SunRayEntry[] = [];
    public sunFlash: ModelInstance | null = null;
    public sunFlashEnabled = false;
    public moonGlare: ScreenSpaceQuad | null = null;
    public moonInstance: ModelInstance | null = null;
    public starBatches: StarBatchEntry[] = [];
    public cloudDeck: CloudDeck | null = null;
    public cloudField = new Cloud.CloudField(0x20a5);
    public weather = new Weather.WeatherState();
    public rainField = new Rain.RainField(0x51a7);
    public rainStreaks: ModelInstance[] = [];
    private rainColors: Color[] = [];
    public snowField = new Snow.SnowField(0x3c1e);
    public snowFlakes: ModelInstance[] = [];
    private snowColor = colorNewFromRGBA(1, 1, 1, 1);
    public leafField = new Leaf.LeafField(0x1eaf);
    public leafInstances: ModelInstance[] = [];
    public leafAnchorsBySeason: (Leaf.LeafAnchorSet | null)[] = [null, null, null, null];
    public grassField = new Grass.GrassField();
    public grassInstancesByStage: ModelInstance[][] = [];

    public roomLightShafts: ModelInstance[] = [];

    public roomPulseGlows: ModelInstance[] = [];
    private roomGlowMs = 0;

    public tvScreens: Tv.TvScreen[] = [];
    public inputManager: InputManager | null = null;

    public cropFieldsVisible = true;
    public setCropFieldsVisible: ((v: boolean) => void) | null = null;
    public setFarmSoil: ((state: number, tintIndex: number) => void) | null = null;
    public weatherCrossFade = false;

    //#region Automatic weather

    public autoWeather = false;
    public weatherSchedule = new Weather.WeatherSchedule();
    public windState = new Wind.WindState(this.weatherSchedule.rng);
    public onAutoWeatherChanged: (() => void) | null = null;
    private lastReportedAuto = "";
    public dayOfSeason = Season.DEFAULT_DAY;
    public onDateChanged: (() => void) | null = null;
    public advanceDayAtMidnight = true;
    public windOctant = Cloud.DEFAULT_WIND_OCTANT;
    public windSpeed = Cloud.DEFAULT_WIND_SPEED;
    public windOctantFrom = Cloud.DEFAULT_WIND_OCTANT;
    public windOctantTo = Cloud.DEFAULT_WIND_OCTANT;
    public windTurnBlend = 0.0;
    public swayField = new Sway.SwayField();
    public grassSwayField = new Sway.SwayField(Sway.GRASS_SWAY_PERIOD_FRAMES);
    public windmillField = new HousePart.SpinField();
    public windmillRotors: HousePart.Hinge[] = [];
    public doors: HousePart.Door[] = [];
    private flareFade = 0;
    private rayPhaseFrames = 0;
    public season = 0;
    private peekZ = new PeekZManager(2);
    private sunPeekResult = new PeekZResult();
    private moonPeekResult = new PeekZResult();
    private moonGlareFade = 0;
    private twinkleTicks = 0;
    public particleGroups: ParticleGroup[] = [];
    private waterTicks = 0;

    //#endregion

    //#region Day/night clock

    public timeSeconds = Env.DEFAULT_TIME_SECONDS;
    public dayIndex = 0;
    public timeScale = Env.DEFAULT_TIME_SCALE;
    public lightingEnabled = true;
    public waterTintEnabled = true;
    private envState = new Env.EnvState();
    public skyInstance: ModelInstance | null = null;
    private skyBlendState: Env.SkyBlend = { frameA: Env.SKY_FRAME_DAY, frameB: Env.SKY_FRAME_DAY, t: 0 };

    //#endregion

    //#region Outdoor lamps

    public lampGlowInstances: ModelInstance[] = [];
    public lampLightMapMtx: mat4 | null = null;
    private lampBindings: LampBindings = { litAtlas: undefined, lightMap: undefined, lightMapMtx: null, litMaterial: undefined };

    //#endregion

    //#region Shadow buffer

    private renderInstListShadow = new GfxRenderInstList();
    private shadowCamera = new Shadow.ShadowCamera();
    private shadowLightYaw = mat4.create();
    public shadowCasters: ModelInstance[] = [];
    private shadowBindings: ShadowBindings;
    private shadowDownsample: Shadow.ShadowDownsample;
    private shadowBoundsMin = vec3.create();
    private shadowBoundsMax = vec3.create();
    private shadowBoundsValid = false;
    public shadowStrength = Shadow.STRENGTH;
    private shadowFrustum = new Frustum();

    //#endregion

    public lodEnabled = true;

    public roomLightRigs: Room.RoomLighting[] = [];

    public modelCache: ModelCache;
    private atlasVariants = new Map<string, Map<string, AtlasTextureCache>>();
    private activeAtlasVariant = new Map<string, string>();

    public createPanels?: () => UI.Panel[];
    private partMaterials: PartMaterials | null = null;
    private materialHelpers: Map<string, GXMaterialHelperGfx>;

    private createMaterialHelpers(lightMask: number): Map<string, GXMaterialHelperGfx> {
        return new Map<string, GXMaterialHelperGfx>([
        ["opaque", createSharedMaterial(GX.CullMode.NONE, lightMask)],
        ["opaque-back", createSharedMaterial(GX.CullMode.BACK, lightMask)],
        ["ground", createSharedMaterial(GX.CullMode.BACK, lightMask)],
        ["opaque-vtx", createSharedMaterial(GX.CullMode.NONE, lightMask, GX.ColorSrc.VTX)],
        ["opaque-back-vtx", createSharedMaterial(GX.CullMode.BACK, lightMask, GX.ColorSrc.VTX)],
        ["untextured", createUntexturedMaterial(GX.ColorSrc.REG, GX.CullMode.NONE, lightMask)],
        ["untextured-vtx", createUntexturedMaterial(GX.ColorSrc.VTX, GX.CullMode.NONE, lightMask)],
        ["untextured-back", createUntexturedMaterial(GX.ColorSrc.REG, GX.CullMode.BACK, lightMask)],
        ["untextured-back-vtx", createUntexturedMaterial(GX.ColorSrc.VTX, GX.CullMode.BACK, lightMask)],
        ["leaf", createSharedMaterial(GX.CullMode.BACK, lightMask)],
        ["room-additive", createRoomAdditiveMaterial()],
        ["tv-screen", createTvScreenMaterial()],
        ["water", createWaterMaterial(GX.TexGenSrc.POS)],
        ["water-uv", createWaterMaterial(GX.TexGenSrc.TEX0)],
        ["water-foam", createWaterFoamMaterial()],
        ["water-tint", createWaterTintPassMaterial(GX.ColorSrc.REG)],
        ["water-tint-vtx", createWaterTintPassMaterial(GX.ColorSrc.VTX)],
        ["sky", createSkyMaterial()],
        ["sun", createSunMaterial()],
        ["sun-flare", createSunFlareMaterial()],
        ["sun-rays", createSunRaysMaterial()],
        ["sun-flash", createSunFlashMaterial()],
        ["moon", createMoonMaterial()],
        ["lamp-glow", createMoonMaterial("HarvestMoonAWL lamp glow (scaled additive)", true)],
        ["lamp-lit-surface", createLampLitMaterial(lightMask)],
        ["moon-glare", createSunFlareMaterial("HarvestMoonAWL moon glare (screen-space additive)")],
        ["star", createStarMaterial()],
        ["cloud", createCloudMaterial()],
        ["rain", createRainMaterial()],
        ["snow", createSnowMaterial()],
        ["ground-tint", createGroundTintMaterial(lightMask)],
        ["shadow-caster", Shadow.createCasterMaterial()],
        ["shadow-caster-billboard", Shadow.createBillboardCasterMaterial()],
        ...particleMaterialKeys(),
        ]);
    }

    //#endregion

    //#region Setup and atlases

    constructor(private device: GfxDevice, litLightCount: number = 1) {
        super(device);
        this.materialHelpers = this.createMaterialHelpers((1 << litLightCount) - 1);
        this.modelCache = new ModelCache(device, this.getCache());
        this.shadowBindings = {
            sampler: this.getCache().createSampler({
                wrapS: GfxWrapMode.Clamp, wrapT: GfxWrapMode.Clamp,
                minFilter: GfxTexFilterMode.Bilinear, magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Nearest, minLOD: 0, maxLOD: 0,
            }),
            texMtx: this.shadowCamera.texMtx,
        };
        this.shadowDownsample = new Shadow.ShadowDownsample(this.getCache());
    }

    public registerAtlas(key: string, tpl: Tpl, variant: string = "default", alphaTpl?: Tpl): void {
        let variants = this.atlasVariants.get(key);
        if (variants === undefined) {
            variants = new Map();
            this.atlasVariants.set(key, variants);
            this.activeAtlasVariant.set(key, variant);
        }
        variants.set(variant, new AtlasTextureCache(this.device, this.getCache(), tpl, alphaTpl));
    }

    public setAtlasVariant(variant: string): void {
        for (const [key, variants] of this.atlasVariants)
            if (variants.has(variant))
                this.activeAtlasVariant.set(key, variant);
    }

    private getActiveAtlas(key: string): AtlasTextureCache | undefined {
        const variants = this.atlasVariants.get(key);
        if (variants === undefined)
            return undefined;
        return variants.get(this.activeAtlasVariant.get(key)!);
    }

    //#endregion

    //#region Camera

    public createCameraController(): CameraController {
        return new FPSCameraController();
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(this.cameraMoveSpeed);

        const previous = this.cameraController;
        this.cameraController = c;
        if (previous !== null && !(previous instanceof FPSCameraController) && c instanceof FPSCameraController)
            this.resetFreeCamera = true;

        if (c instanceof OrbitCameraController || c instanceof OrthoCameraController) {
            if (this.defaultWorldMatrix !== null)
                getMatrixTranslation(c.translation, this.defaultWorldMatrix);
            const distance = this.cameraMoveSpeed * CAMERA_SPEED_ACCUM_PER_SEC * CAMERA_FOCUS_SECONDS;
            if (c instanceof OrbitCameraController) {
                c.z = c.zTarget = -distance;
            } else {
                const halfHeight = distance * Math.tan(Camera.DefaultFovY / 2);
                c.z = c.zTarget = -(halfHeight / (10 * this.cameraMoveSpeed));
            }
        }
    }

    private finishFreeCameraReset(camera: Camera): void {
        camera.setPerspective(camera.fovY, camera.aspect, Env.ROM_CAMERA_NEAR);
        if (this.defaultWorldMatrix !== null) {
            mat4.copy(camera.worldMatrix, this.defaultWorldMatrix);
            camera.worldMatrixUpdated();
        }
    }

    private cameraController: CameraController | null = null;
    private resetFreeCamera = false;

    public cameraMoveSpeed = 12 / 3600;

    public defaultWorldMatrix: mat4 | null = null;

    public getDefaultWorldMatrix(dst: mat4): void {
        if (this.defaultWorldMatrix !== null)
            mat4.copy(dst, this.defaultWorldMatrix);
        else
            mat4.identity(dst);
    }

    //#endregion

    //#region Clock, Weather, Wind

    private updateEnvironment(viewerInput: ViewerRenderInput): void {
        const light = materialParams.u_Lights[0];
        vec3.set(light.CosAtten, 1, 0, 0);
        vec3.set(light.DistAtten, 1, 0, 0);

        const shadowLight = materialParams.u_Lights[SHADOW_ALPHA_LIGHT_INDEX];
        vec3.set(shadowLight.CosAtten, 1, 0, 0);
        vec3.set(shadowLight.DistAtten, 1, 0, 0);
        for (let i = 0; i < materialParams.u_Lights.length; i++)
            if (i !== 0 && i !== SHADOW_ALPHA_LIGHT_INDEX)
                materialParams.u_Lights[i].reset();

        if (!this.lightingEnabled) {
            colorCopy(materialParams.u_Color[ColorKind.MAT0], MAT_COLOR_DEFAULT);
            colorFromRGBA(materialParams.u_Color[ColorKind.AMB0], 1, 1, 1, 1);
            sunDiscAlpha = 1.0;
            colorFromRGBA(light.Color, 0, 0, 0, 0);
            colorFromRGBA(shadowLight.Color, 0, 0, 0, 0);
            colorFromRGBA(waterTintC0, 1, 1, 1, 1);
            Water.tintPassColor(waterTintPassC0, waterTintC0);
            return;
        }

        const weatherLightFactor = Weather.lightFactor(this.weather.blend);
        sunDiscAlpha = weatherLightFactor;
        Env.evaluateEnv(this.envState, this.timeSeconds, weatherLightFactor);
        if (this.waterTintEnabled)
            evalWaterTint(waterTintC0, this.envState, weatherLightFactor);
        Water.tintPassColor(waterTintPassC0, waterTintC0);

        colorCopy(materialParams.u_Color[ColorKind.AMB0], this.envState.ambient);
        materialParams.u_Color[ColorKind.AMB0].a = 0.0;
        colorCopy(materialParams.u_Color[ColorKind.MAT0], MAT_COLOR_DEFAULT);

        colorCopy(light.Color, this.envState.keyLightColor);
        mat4.getTranslation(scratchLightPos, viewerInput.camera.worldMatrix);
        vec3.scaleAndAdd(scratchLightPos, scratchLightPos, this.envState.keyLightDirection, Env.LIGHT_DISTANCE);
        lightSetWorldPosition(light, viewerInput.camera.viewMatrix, scratchLightPos);

        colorFromRGBA(shadowLight.Color, 0, 0, 0, this.envState.shadowWeight);
        lightSetWorldPosition(shadowLight, viewerInput.camera.viewMatrix, scratchLightPos);
    }

    public setWeather(weather: number): void {
        this.weather.set(weather, this.weatherCrossFade);
    }

    private get absoluteTimeSeconds(): number {
        return this.dayIndex * Env.DAY_SEC + this.timeSeconds;
    }

    private advanceDate(days: number): void {
        const total = this.season * Season.DAYS_PER_SEASON + this.dayOfSeason + days;
        this.season = Math.floor(total / Season.DAYS_PER_SEASON) % Season.SEASON_COUNT;
        this.dayOfSeason = total % Season.DAYS_PER_SEASON;
        if (this.onDateChanged !== null)
            this.onDateChanged();
    }

    public setAutoWeather(on: boolean): void {
        if (on === this.autoWeather)
            return;
        this.autoWeather = on;
        if (!on)
            return;
        this.weatherCrossFade = true;
        this.windState.set(this.windOctant, this.windSpeed, this.timeSeconds);
        this.weatherSchedule.reschedule(this.absoluteTimeSeconds, this.dayIndex,
            Weather.seasonPhase(this.season, this.dayOfSeason), this.weather.target);
    }

    private updateAutoWeather(): void {
        if (!this.autoWeather) {
            this.windOctantFrom = this.windOctantTo = this.windOctant;
            this.windTurnBlend = 0.0;
            return;
        }

        const phase = Weather.seasonPhase(this.season, this.dayOfSeason);
        const change = this.weatherSchedule.update(this.absoluteTimeSeconds, this.dayIndex, phase, this.weather.target);
        if (change !== null)
            this.weather.set(change.state, true, change.elapsedSec);
        this.windState.update(this.timeSeconds, this.season);
        this.windOctant = this.windState.octant;
        this.windSpeed = this.windState.speed;
        this.windOctantFrom = this.windState.octantFrom;
        this.windOctantTo = this.windState.octantTo;
        this.windTurnBlend = this.windState.turnBlend;

        const reported = `${this.weather.target}/${Math.round(this.windOctant * 10)}/${Math.round(this.windSpeed * 10)}`;
        if (reported !== this.lastReportedAuto) {
            this.lastReportedAuto = reported;
            if (this.onAutoWeatherChanged !== null)
                this.onAutoWeatherChanged();
        }
    }

    //#endregion

    //#region Per-System Updates

    private updateClouds(viewerInput: ViewerRenderInput): void {
        const deltaSeconds = viewerInput.deltaTime / 1000;
        const blendState = this.weather.blend;

        this.cloudField.update(this.timeSeconds, blendState, this.windOctant, this.windSpeed, deltaSeconds);

        const deck = this.cloudDeck;
        if (deck === null)
            return;

        const lum = this.lightingEnabled
            ? Cloud.luminance(this.envState.ambient, this.envState.keyLightColor, 1.0)
            : 1.0;
        const weatherC = this.lightingEnabled ? Weather.curveC(blendState) : 1.0;

        Sun.arcCenterPosition(scratchCloudOrigin, viewerInput);

        const nodes = this.cloudField.nodes;
        for (let i = 0; i < deck.instances.length; i++) {
            const inst = deck.instances[i];
            const node = i < nodes.length ? nodes[i] : undefined;
            if (node === undefined) {
                inst.visible = false;
                continue;
            }
            const fade = Cloud.nodeFadeAlpha(node.state, Weather.fadeProgress(this.timeSeconds, node.spawnTimeSec, Cloud.TRANSITION_SECONDS));
            const alpha = fade * Cloud.distanceFade(Math.hypot(node.x, node.z));
            if (alpha <= 0) {
                inst.visible = false;
                continue;
            }
            inst.visible = true;
            inst.imageIndexOverride = node.imageIndex;
            Cloud.fillCloudColors(deck.colorC0[i], deck.colorC1[i], lum, weatherC, alpha);
            inst.colorOverrideC0 = deck.colorC0[i];
            inst.colorOverride = deck.colorC1[i];
            const aspect = deck.imageAspect[node.imageIndex] ?? 1;
            Cloud.fillCloudMatrix(inst.modelMatrix, node, blendState, this.windOctant, aspect, scratchCloudOrigin[0], scratchCloudOrigin[1], scratchCloudOrigin[2]);
        }
    }

    private updateRain(viewerInput: ViewerRenderInput): void {
        const deltaSeconds = viewerInput.deltaTime / 1000;

        Util.cameraRay(scratchRainCameraPos, scratchRainForward, viewerInput.camera.worldMatrix);

        this.rainField.update(this.timeSeconds, this.weather.remapped, scratchRainCameraPos, scratchRainForward, deltaSeconds);

        if (this.rainStreaks.length === 0)
            return;
        while (this.rainColors.length < this.rainStreaks.length)
            this.rainColors.push(colorNewFromRGBA(1, 1, 1, 1));

        const brightness = this.lightingEnabled
            ? Rain.sceneBrightness(this.envState.ambient, this.envState.keyLightColor)
            : 1.0;

        const drops = this.rainField.drops;
        const width0 = Rain.streakWorldWidth(1.0, viewerInput.camera.fovY, viewerInput.backbufferHeight);
        const cosCull = Math.cos(Math.min(Math.PI * 0.5, viewerInput.camera.fovY * 0.5 * Math.max(1.0, viewerInput.camera.aspect) + 0.25));

        for (let i = 0; i < this.rainStreaks.length; i++) {
            const inst = this.rainStreaks[i];
            const drop = i < drops.length ? drops[i] : undefined;
            if (drop === undefined) {
                inst.visible = false;
                continue;
            }

            const dx = drop.x - scratchRainCameraPos[0];
            const dy = drop.y - scratchRainCameraPos[1];
            const dz = drop.z - scratchRainCameraPos[2];
            const distance = Math.hypot(dx, dy, dz);
            const viewDepth = dx * scratchRainForward[0] + dy * scratchRainForward[1] + dz * scratchRainForward[2];
            if (distance < 1e-3 || viewDepth <= 0 || viewDepth / distance < cosCull) {
                inst.visible = false;
                continue;
            }

            const fade = Rain.dropFade(drop.state, Weather.fadeProgress(this.timeSeconds, drop.spawnTimeSec, this.weather.remapped.windowSeconds));
            const intensity = brightness * Rain.PEAK_INTENSITY * fade;
            if (intensity <= 0) {
                inst.visible = false;
                continue;
            }

            inst.visible = true;
            const c = this.rainColors[i];
            colorFromRGBA(c, intensity, intensity, intensity, 1.0);
            inst.colorOverrideC0 = c;

            vec3.set(scratchRainTranslate, drop.x, drop.y, drop.z);
            mat4.fromTranslation(inst.modelMatrix, scratchRainTranslate);
            vec3.set(scratchRainScale, width0 * viewDepth, Rain.STREAK_LENGTH, 1);
            mat4.scale(inst.modelMatrix, inst.modelMatrix, scratchRainScale);
        }
    }

    private updateSnow(viewerInput: ViewerRenderInput): void {
        const deltaSeconds = viewerInput.deltaTime / 1000;

        Util.cameraRay(scratchRainCameraPos, scratchRainForward, viewerInput.camera.worldMatrix);

        this.snowField.update(this.timeSeconds, this.weather.remapped, scratchRainCameraPos, scratchRainForward, this.windOctant, this.windSpeed, deltaSeconds);

        if (this.snowFlakes.length === 0)
            return;

        const brightness = this.lightingEnabled
            ? Rain.sceneBrightness(this.envState.ambient, this.envState.keyLightColor)
            : 1.0;
        colorFromRGBA(this.snowColor, brightness, brightness, brightness, 1.0);

        const flakes = this.snowField.flakes;
        const clock = this.snowField.frameClock;
        const cosCull = Math.cos(Math.min(Math.PI * 0.5, viewerInput.camera.fovY * 0.5 * Math.max(1.0, viewerInput.camera.aspect) + 0.35));

        for (let i = 0; i < this.snowFlakes.length; i++) {
            const inst = this.snowFlakes[i];
            const flake = i < flakes.length ? flakes[i] : undefined;
            if (flake === undefined || flake.state === Snow.FlakeState.FadingIn) {
                inst.visible = false;
                continue;
            }

            Snow.swayDirection(scratchSnowSway, flake.dirIndex);
            const sway = Snow.swayAmount(flake.wobbleSlot, clock);
            const px = flake.x + scratchSnowSway[0] * sway;
            const py = flake.y + scratchSnowSway[1] * sway;
            const pz = flake.z + scratchSnowSway[2] * sway;

            const dx = px - scratchRainCameraPos[0];
            const dy = py - scratchRainCameraPos[1];
            const dz = pz - scratchRainCameraPos[2];
            const viewDepth = dx * scratchRainForward[0] + dy * scratchRainForward[1] + dz * scratchRainForward[2];
            const halfSize = Snow.flakeHalfSize(viewDepth, viewerInput.camera.fovY);
            if (halfSize <= 0) {
                inst.visible = false;
                continue;
            }
            const distance = Math.hypot(dx, dy, dz);
            if (distance < 1e-3 || viewDepth / distance < cosCull) {
                inst.visible = false;
                continue;
            }

            inst.visible = true;
            inst.colorOverrideC0 = this.snowColor;
            vec3.set(scratchRainTranslate, px, py, pz);
            mat4.fromTranslation(inst.modelMatrix, scratchRainTranslate);
            vec3.set(scratchRainScale, halfSize, halfSize, 1);
            mat4.scale(inst.modelMatrix, inst.modelMatrix, scratchRainScale);
        }
    }

    private updateLeaves(viewerInput: ViewerRenderInput): void {
        if (this.leafInstances.length === 0)
            return;

        const frustum = viewerInput.camera.frustum;
        const isGroupVisible = (group: Leaf.LeafAnchorGroup) => frustum.containsSphere(group.center, group.radius);
        this.leafField.update(this.windOctant, this.windSpeed, viewerInput.deltaTime / 1000, isGroupVisible);

        const leaves = this.leafField.leaves;
        for (let i = 0; i < this.leafInstances.length; i++) {
            const inst = this.leafInstances[i];
            const leaf = i < leaves.length ? leaves[i] : undefined;
            if (leaf === undefined || !leaf.alive) {
                inst.visible = false;
                continue;
            }
            inst.visible = true;
            inst.imageIndexOverride = leaf.imageIndex;
            vec3.set(scratchLeafPos, leaf.drawX, leaf.drawY, leaf.drawZ);
            mat4.fromTranslation(inst.modelMatrix, scratchLeafPos);
            mat4.rotateX(inst.modelMatrix, inst.modelMatrix, leaf.tiltRadians);
        }
    }

    private updateGrass(viewerInput: ViewerRenderInput): void {
        if (this.grassInstancesByStage.length === 0)
            return;

        const field = this.grassField;
        const rebind = field.update();
        const frustum = viewerInput.camera.frustum;

        for (let stage = 0; stage < this.grassInstancesByStage.length; stage++) {
            const group = this.grassInstancesByStage[stage];
            for (let i = 0; i < group.length; i++) {
                const inst = group[i];
                if (rebind)
                    inst.imageIndexOverride = Grass.imageIndex(stage, field.variants[i]);
                const stageOn = stage === (field.cut[i] !== 0 ? Grass.CUT_STAGE : field.stage);
                if (!stageOn || (field.pondCutout && Grass.tileInPondCutout(i))) {
                    inst.visible = false;
                    continue;
                }
                Grass.tilePosition(scratchGrassPos, i);
                inst.visible = frustum.containsSphere(scratchGrassPos, Grass.TILE_CULL_RADIUS);
            }
        }
    }

    //#endregion

    //#region prepareToRender

    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        if (this.resetFreeCamera) {
            this.resetFreeCamera = false;
            this.finishFreeCameraReset(viewerInput.camera);
        }
        viewerInput.camera.setClipPlanes(Env.ROM_CAMERA_NEAR);

        //#region Day/night clock

        const advancedTime = this.timeSeconds + (viewerInput.deltaTime / 1000) * this.timeScale;
        if (advancedTime >= Env.DAY_SEC) {
            const daysPassed = Math.floor(advancedTime / Env.DAY_SEC);
            this.dayIndex += daysPassed;
            if (this.advanceDayAtMidnight)
                this.advanceDate(daysPassed);
        }
        this.timeSeconds = advancedTime % Env.DAY_SEC;
        currentTimeSeconds = this.timeSeconds;
        this.updateAutoWeather();
        this.swayField.update(viewerInput.deltaTime / 1000);
        swayAmount = Sway.swayAmount(this.swayField.phaseFrames, this.windSpeed);
        Sway.fillSwayBasis(scratchSwayDir, scratchSwayAxis, this.windOctant);
        Sway.toViewSpace(swayDirView, scratchSwayDir, viewerInput.camera.viewMatrix);
        Sway.toViewSpace(swayAxisView, scratchSwayAxis, viewerInput.camera.viewMatrix);
        this.grassSwayField.update(viewerInput.deltaTime / 1000);
        grassSwayPhaseFrames = this.grassSwayField.phaseFrames;
        grassWindSpeed = this.windSpeed;
        Sway.fillWindVector(grassWindDirFrom, this.windOctantFrom);
        Sway.fillWindVector(grassWindDirTo, this.windOctantTo);
        grassWindBlend = this.windTurnBlend;
        Sway.toViewSpace(grassMeasureView, Sway.GRASS_SWAY_MEASURE_AXIS, viewerInput.camera.viewMatrix);
        Sway.fillBillboardYaw(plantBillboardYaw, viewerInput.camera.viewMatrix);
        this.windmillField.update(viewerInput.deltaTime / 1000, this.windSpeed);
        HousePart.applyHinges(this.windmillRotors, this.windmillField.phase);
        this.weather.advance((viewerInput.deltaTime / 1000) * this.timeScale);

        this.updateEnvironment(viewerInput);
        
        for (const rig of this.roomLightRigs)
            rig.evaluate(this.timeSeconds);
        snapshotSceneDefaultLights();

        //#endregion

        //#region Window light shafts

        if (this.roomLightShafts.length > 0) {
            const shaftAlpha = Room.lightShaftIntensity(this.timeSeconds, Weather.lightFactor(this.weather.blend));
            for (const inst of this.roomLightShafts) {
                colorFromRGBA(scratchLightShaftColor, 1, 1, 1, shaftAlpha);
                inst.matColorOverride = scratchLightShaftColor;
            }
        }

        //#endregion

        //#region Pulse glows

        if (this.roomPulseGlows.length > 0) {
            this.roomGlowMs = (this.roomGlowMs + viewerInput.deltaTime) % Room.PULSE_GLOW_PERIOD_MS;
            colorFromRGBA(scratchRoomGlowColor, 1, 1, 1, Room.pulseGlowAlpha(this.roomGlowMs));
            for (const inst of this.roomPulseGlows)
                inst.matColorOverride = scratchRoomGlowColor;
        }

        //#endregion

        //#region Sickle easter egg

        if (this.grassInstancesByStage.length > 0 && this.inputManager !== null && this.inputManager.isKeyDownEventTriggered('KeyF'))
            this.grassField.cutAround(Grass.aimedTile(viewerInput.camera.worldMatrix));

        //#endregion

        //#region Door easter egg

        if (this.doors.length > 0) {
            if (this.inputManager !== null && this.inputManager.isKeyDownEventTriggered('KeyF')) {
                const door = HousePart.pickDoor(this.doors, viewerInput.camera.worldMatrix);
                if (door !== null)
                    door.trigger();
            }
            HousePart.updateDoors(this.doors, viewerInput.deltaTime / 1000);
        }

        //#endregion

        //#region TV easter egg

        if (this.tvScreens.length > 0) {
            const pressed = this.inputManager !== null && this.inputManager.isKeyDownEventTriggered('KeyF');
            for (const tv of this.tvScreens) {
                if (pressed && tv.enabled && Tv.isAimedAtScreen(viewerInput.camera.worldMatrix, tv.corners))
                    tv.advance();
                tv.update(viewerInput.deltaTime);
            }
        }

        //#endregion

        //#region World fog

        const weatherFog = Weather.fogFactor(this.weather.blend);
        const fogRange = Fog.evaluateFogRange(this.timeSeconds);
        Fog.evaluateFogColor(scratchFogBlock.Color, this.timeSeconds);
        Weather.applyFog(scratchFogBlock.Color, fogRange, weatherFog);
        fogBlockSet(scratchFogBlock, Fog.FOG_TYPE, fogRange.startZ, fogRange.endZ, Env.ROM_CAMERA_NEAR, Env.ROM_CAMERA_FAR);

        if (this.skyInstance !== null) {
            if (this.lightingEnabled)
                Env.skyBlend(this.skyBlendState, this.timeSeconds);
            else
                this.skyBlendState = { frameA: Env.SKY_FRAME_DAY, frameB: Env.SKY_FRAME_DAY, t: 0 };
            this.skyInstance.skyBlend = this.skyBlendState;
        }

        //#endregion

        //#region Moon

        if (this.moonInstance !== null) {
            this.moonInstance.visible = this.lightingEnabled && Moon.isNight(this.timeSeconds);
            this.moonInstance.imageIndexOverride = Moon.phaseImageIndex(this.dayIndex, this.timeSeconds);
        }

        //#endregion

        //#region Outdoor lamps

        lampsLit = this.lightingEnabled && Lamp.lampsOn(this.timeSeconds);
        this.lampBindings.litAtlas = this.getActiveAtlas(LAMP_LIT_ATLAS);
        this.lampBindings.lightMap = this.getActiveAtlas(LAMP_LIGHT_MAP_ATLAS);
        this.lampBindings.lightMapMtx = this.lampLightMapMtx;
        this.lampBindings.litMaterial = this.materialHelpers.get("lamp-lit-surface");

        Env.lightWorldDirection(scratchShadowLightDir, this.timeSeconds);
        Shadow.lightYaw(this.shadowLightYaw, scratchShadowLightDir);
        if (!this.shadowBoundsValid) {
            vec3.set(this.shadowBoundsMin, Infinity, Infinity, Infinity);
            vec3.set(this.shadowBoundsMax, -Infinity, -Infinity, -Infinity);
            for (let i = 0; i < this.shadowCasters.length; i++) {
                const inst = this.shadowCasters[i];
                if (inst.shadowCaster === Shadow.CasterKind.Billboard) {
                    mat4.getTranslation(scratchCasterPos, inst.modelMatrix);
                    const bmin = inst.data.boundsMin, bmax = inst.data.boundsMax;
                    const reach = Math.max(Math.abs(bmin[0]), Math.abs(bmax[0]), Math.abs(bmin[2]), Math.abs(bmax[2]));
                    vec3.set(scratchCasterCorner, scratchCasterPos[0] - reach, scratchCasterPos[1] + bmin[1], scratchCasterPos[2] - reach);
                    vec3.min(this.shadowBoundsMin, this.shadowBoundsMin, scratchCasterCorner);
                    vec3.set(scratchCasterCorner, scratchCasterPos[0] + reach, scratchCasterPos[1] + bmax[1], scratchCasterPos[2] + reach);
                    vec3.max(this.shadowBoundsMax, this.shadowBoundsMax, scratchCasterCorner);
                } else {
                    const bmin = inst.data.boundsMin, bmax = inst.data.boundsMax;
                    for (let c = 0; c < 8; c++) {
                        vec3.set(scratchCasterCorner, (c & 1) ? bmax[0] : bmin[0], (c & 2) ? bmax[1] : bmin[1], (c & 4) ? bmax[2] : bmin[2]);
                        vec3.transformMat4(scratchCasterCorner, scratchCasterCorner, inst.modelMatrix);
                        vec3.min(this.shadowBoundsMin, this.shadowBoundsMin, scratchCasterCorner);
                        vec3.max(this.shadowBoundsMax, this.shadowBoundsMax, scratchCasterCorner);
                    }
                }
            }
            if (!Number.isFinite(this.shadowBoundsMin[0])) {
                vec3.zero(this.shadowBoundsMin);
                vec3.zero(this.shadowBoundsMax);
            }
            this.shadowBoundsValid = true;
        }
        mat4.getTranslation(scratchShadowCameraPos, viewerInput.camera.worldMatrix);
        Shadow.fitLightCamera(this.shadowCamera, scratchShadowLightDir, this.shadowBoundsMin, this.shadowBoundsMax, scratchShadowCameraPos, this.device);
        mat4.mul(scratchShadowClipFromWorld, this.shadowCamera.projection, this.shadowCamera.view);
        this.shadowFrustum.updateClipFrustum(scratchShadowClipFromWorld, this.device.queryVendorInfo().clipSpaceNearZ);
        for (const inst of this.lampGlowInstances)
            inst.visible = lampsLit;

        //#endregion

        //#region Star field

        if (this.starBatches.length > 0) {
            this.twinkleTicks = (this.twinkleTicks + (viewerInput.deltaTime / 1000) * Env.ROM_LOGIC_FPS) % Stars.TWINKLE_PERIOD_FRAMES;
            const starNightFactor = this.lightingEnabled ? Stars.nightFactor(this.timeSeconds) : 0;
            for (let slot = 0; slot < Stars.TWINKLE_SLOT_COUNT; slot++)
                Stars.fillTwinkleColor(scratchTwinkleColors[slot], slot, this.twinkleTicks, starNightFactor);
            for (const batch of this.starBatches) {
                batch.instance.visible = starNightFactor > 0;
                batch.instance.colorOverride = scratchTwinkleColors[batch.twinkleSlot];
            }
        }

        //#endregion

        //#region Cloud deck

        this.updateClouds(viewerInput);
        this.updateRain(viewerInput);
        this.updateSnow(viewerInput);
        this.updateLeaves(viewerInput);
        this.updateGrass(viewerInput);

        for (const group of this.particleGroups)
            group.update(viewerInput.deltaTime, this.windOctant, this.windSpeed);

        this.waterTicks += (viewerInput.deltaTime / 1000) * Env.ROM_LOGIC_FPS;

        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);

        lodEnabled = this.lodEnabled;
        mat4.getTranslation(lodCameraPos, viewerInput.camera.worldMatrix);
        resetMaterialBlockCache();
        colorCopy(materialParams.u_FogBlock.Color, scratchFogBlock.Color);
        materialParams.u_FogBlock.A = scratchFogBlock.A;
        materialParams.u_FogBlock.B = scratchFogBlock.B;
        materialParams.u_FogBlock.C = scratchFogBlock.C;

        for (let i = 0; i < this.instances.length; i++) {
            const inst = this.instances[i];
            if (!inst.visible)
                continue;
            const data = inst.renderData();
            const textureCache = this.getActiveAtlas(data.atlasKey);
            const materialHelper = this.materialHelpers.get(data.materialKey);
            const bumpTextureCache = isBumpWaterMaterialKey(data.materialKey) ? this.getActiveAtlas("water-bump") : undefined;
            if (inst.waterAnim !== null) {
                Water.fillTexMtx(materialParams.u_TexMtx[0], inst.waterAnim, 0, this.waterTicks);
                Water.fillTexMtx(materialParams.u_TexMtx[1], inst.waterAnim, 1, this.waterTicks);
                colorCopy(materialParams.u_Color[ColorKind.C0], waterTintC0);
            }
            if (inst.waterFoam !== null) {
                Water.foamState(scratchFoamState, this.waterTicks, inst.waterFoam.phaseTicks);
                mat4.copy(inst.modelMatrix, inst.waterFoam.baseMatrix);
                inst.modelMatrix[12] += scratchFoamState.offsetX;
                colorFromRGBA(materialParams.u_Color[ColorKind.C0], 0, 0, 0, scratchFoamState.alpha);
            }
            if (textureCache !== undefined && materialHelper !== undefined) {
                if (this.partMaterials === null) {
                    this.partMaterials = {
                        untextured: {
                            reg: this.materialHelpers.get("untextured")!, vtx: this.materialHelpers.get("untextured-vtx")!,
                            regBack: this.materialHelpers.get("untextured-back")!, vtxBack: this.materialHelpers.get("untextured-back-vtx")!,
                        },
                        vertexColorByKey: new Map([
                            ["opaque", this.materialHelpers.get("opaque-vtx")!],
                            ["opaque-back", this.materialHelpers.get("opaque-back-vtx")!],
                        ]),
                    };
                }
                inst.prepareToRender(renderInstManager, viewerInput, materialHelper, textureCache, bumpTextureCache, this.lampBindings, this.shadowBindings, this.partMaterials);
            }
        }

        //#endregion

        //#region Shadow caster pass

        const casterMaterial = this.materialHelpers.get("shadow-caster");
        const billboardCasterMaterial = this.materialHelpers.get("shadow-caster-billboard");
        if (casterMaterial !== undefined && billboardCasterMaterial !== undefined) {
            mat4.copy(scratchShadowSceneParams.u_Projection, this.shadowCamera.projection);
            scratchShadowSceneParams.u_SceneTextureLODBias = Shadow.CASTER_LOD_BIAS;
            const shadowSceneParams = template.allocateUniformBufferF32(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
            fillSceneParamsData(shadowSceneParams, 0, scratchShadowSceneParams);

            const red = Shadow.casterRed(this.shadowStrength);
            renderInstManager.setCurrentList(this.renderInstListShadow);
            for (let pass = 0; pass < 2; pass++) {
                const kind = pass === 0 ? Shadow.CasterKind.Solid : Shadow.CasterKind.Billboard;
                if (kind === Shadow.CasterKind.Solid) {
                    colorFromRGBA(shadowMaterialParams.u_Color[ColorKind.C0], red, 0, 0, 1.0);
                } else {
                    colorFromRGBA(shadowMaterialParams.u_Color[ColorKind.C0], red, red, 0, 1.0);
                }
                const material = kind === Shadow.CasterKind.Solid ? casterMaterial : billboardCasterMaterial;
                for (let i = 0; i < this.shadowCasters.length; i++) {
                    const inst = this.shadowCasters[i];
                    if (inst.shadowCaster !== kind)
                        continue;
                    if (!inst.visible)
                        continue;
                    const textureCache = kind === Shadow.CasterKind.Billboard ? this.getActiveAtlas(inst.data.atlasKey) : undefined;
                    inst.prepareShadowCast(renderInstManager, material, this.shadowCamera.view, this.shadowLightYaw, this.shadowFrustum, textureCache);
                }
            }
            shadowMaterialParams.m_TextureMapping[0].reset();
            renderInstManager.setCurrentList(this.renderInstListMain);
        }

        //#endregion

        //#region Screen-space pass

        const curveA = this.lightingEnabled ? Weather.lightFactor(this.weather.blend) : 1.0;
        const curveC = this.lightingEnabled ? Weather.curveC(this.weather.blend) : 1.0;

        let flareIntensity = 0.0, rayIntensity = 0.0, flashIntensity = 0.0;
        if (this.sunFlares.length > 0 || this.sunRays.length > 0 || this.sunFlash !== null) {
            Sun.sunWorldPosition(scratchSunPos, viewerInput, currentTimeSeconds);

            const sunVisible = Sun.projectToNdc(scratchSunNdc, scratchSunPos, viewerInput);

            let rising = false;
            if (sunVisible) {
                this.peekZ.newData(this.sunPeekResult, scratchSunNdc[0], scratchSunNdc[1]);
                rising = peekZUnoccluded(this.sunPeekResult);
            }
            this.flareFade = Sun.stepFlareFade(this.flareFade, rising, viewerInput.deltaTime / 1000);
            this.rayPhaseFrames = Sun.stepRayPhase(this.rayPhaseFrames, viewerInput.deltaTime / 1000);

            const sunUp = sunVisible && Sun.isRegistered(currentTimeSeconds);

            rayIntensity = sunUp ? Sun.rayIntensity(curveA, curveC, this.flareFade) : 0.0;
            flareIntensity = sunUp
                ? Sun.flareIntensity(curveA, curveC, this.flareFade, Sun.flareCentreFalloff(scratchSunNdc, scratchSunPos[1], viewerInput))
                : 0.0;
            flashIntensity = sunUp && this.sunFlashEnabled ? Sun.flashIntensity(flareIntensity) : 0.0;
        }

        let moonGlareIntensity = 0.0;
        if (this.moonGlare !== null) {
            Moon.moonWorldPosition(scratchMoonPos, viewerInput, currentTimeSeconds);
            const moonVisible = this.lightingEnabled && Moon.isNight(this.timeSeconds) && Sun.projectToNdc(scratchMoonNdc, scratchMoonPos, viewerInput);
            let moonRising = false;
            if (moonVisible) {
                this.peekZ.newData(this.moonPeekResult, scratchMoonNdc[0], scratchMoonNdc[1]);
                moonRising = peekZUnoccluded(this.moonPeekResult);
            }
            this.moonGlareFade = Moon.stepGlareFade(this.moonGlareFade, moonRising, viewerInput.deltaTime / 1000);
            moonGlareIntensity = moonVisible ? Moon.glareIntensity(curveC, this.moonGlareFade) : 0.0;
        }

        if (rayIntensity > 0.0 || flareIntensity > 0.0 || flashIntensity > 0.0 || moonGlareIntensity > 0.0) {
            mat4.identity(scratchScreenSceneParams.u_Projection);
            scratchScreenSceneParams.u_SceneTextureLODBias = calcLODBias(viewerInput.backbufferWidth, viewerInput.backbufferHeight);
            const d = template.allocateUniformBufferF32(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
            fillSceneParamsData(d, 0, scratchScreenSceneParams);

            const raysMaterialHelper = this.materialHelpers.get("sun-rays");
            if (rayIntensity > 0.0 && this.sunRays.length > 0 && raysMaterialHelper !== undefined) {
                const rayTextureCache = this.getActiveAtlas(this.sunRays[0].instance.data.atlasKey);
                if (rayTextureCache !== undefined) {
                    colorFromRGBA(scratchRayColor, rayIntensity, rayIntensity, rayIntensity, 1.0);
                    const seasonScale = Sun.RAY_LENGTH_SEASON_SCALE[this.season] ?? 1.0;
                    for (const ray of this.sunRays) {
                        const length = Sun.rayLengthPixels(ray.spoke, this.rayPhaseFrames, seasonScale);
                        Sun.fillRayMatrix(ray.instance.modelMatrix, scratchSunNdc, ray.spoke, length, viewerInput);
                        ray.instance.colorOverride = scratchRayColor;
                        ray.instance.prepareToRender(renderInstManager, viewerInput, raysMaterialHelper, rayTextureCache);
                    }
                }
            }

            const sunTextureCache = this.getActiveAtlas("sun");
            const flareMaterialHelper = this.materialHelpers.get("sun-flare");
            if (flareIntensity > 0.0 && sunTextureCache !== undefined && flareMaterialHelper !== undefined) {
                colorFromRGBA(scratchFlareColor, flareIntensity, flareIntensity, flareIntensity, 1.0);
                for (const flare of this.sunFlares) {
                    const fx = -scratchSunNdc[0] * flare.t;
                    const fy = -scratchSunNdc[1] * flare.t;
                    mat4.fromTranslation(flare.instance.modelMatrix, [fx, fy, 0]);
                    vec3.set(scratchParticleScale, Sun.halfExtentNdcX(flare.halfWidthPixels, viewerInput), Sun.halfExtentNdcY(flare.halfHeightPixels, viewerInput), 1);
                    mat4.scale(flare.instance.modelMatrix, flare.instance.modelMatrix, scratchParticleScale);
                    flare.instance.colorOverride = scratchFlareColor;
                    flare.instance.prepareToRender(renderInstManager, viewerInput, flareMaterialHelper, sunTextureCache);
                }
            }

            const flashMaterialHelper = this.materialHelpers.get("sun-flash");
            if (flashIntensity > 0.0 && this.sunFlash !== null && flashMaterialHelper !== undefined) {
                const flashTextureCache = this.getActiveAtlas(this.sunFlash.data.atlasKey);
                if (flashTextureCache !== undefined) {
                    colorFromRGBA(scratchFlashColor, 1.0, 1.0, 1.0, flashIntensity);
                    mat4.identity(this.sunFlash.modelMatrix);
                    this.sunFlash.colorOverride = scratchFlashColor;
                    this.sunFlash.prepareToRender(renderInstManager, viewerInput, flashMaterialHelper, flashTextureCache);
                }
            }

            const moonTextureCache = this.getActiveAtlas("moon");
            const glareMaterialHelper = this.materialHelpers.get("moon-glare");
            if (moonGlareIntensity > 0.0 && this.moonGlare !== null && moonTextureCache !== undefined && glareMaterialHelper !== undefined) {
                colorFromRGBA(scratchMoonGlareColor, moonGlareIntensity, moonGlareIntensity, moonGlareIntensity, 1.0);
                const glare = this.moonGlare;
                mat4.fromTranslation(glare.instance.modelMatrix, [scratchMoonNdc[0], scratchMoonNdc[1], 0]);
                mat4.scale(glare.instance.modelMatrix, glare.instance.modelMatrix, [
                    Sun.halfExtentNdcX(glare.halfWidthPixels, viewerInput),
                    Sun.halfExtentNdcY(glare.halfHeightPixels, viewerInput), 1,
                ]);
                glare.instance.colorOverride = scratchMoonGlareColor;
                glare.instance.prepareToRender(renderInstManager, viewerInput, glareMaterialHelper, moonTextureCache);
            }
        }

        //#endregion

        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    //#endregion

    //#region Render and teardown

    public override render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.peekZ.beginFrame(device);
        this.prepareToRender(device, viewerInput);

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");

        const casterWidth = Shadow.BUFFER_WIDTH * Shadow.CASTER_SUPERSAMPLE;
        const casterHeight = Shadow.BUFFER_HEIGHT * Shadow.CASTER_SUPERSAMPLE;
        const casterDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);
        casterDesc.setDimensions(casterWidth, casterHeight, 1);
        casterDesc.clearColor = Shadow.CLEAR_COLOR;
        const casterTargetID = builder.createRenderTargetID(casterDesc, "Shadow Casters");
        builder.pushPass((pass) => {
            pass.setDebugName("Shadow Casters");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, casterTargetID);
            pass.exec((passRenderer) => {
                const guard = Shadow.CASTER_GUARD_BAND;
                passRenderer.setScissor(guard, guard, casterWidth - 2 * guard, casterHeight - 2 * guard);
                this.renderInstListShadow.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                // WebGL's scissor test is global state that outlives the pass.
                passRenderer.setScissor(0, 0, casterWidth, casterHeight);
            });
        });

        const shadowDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);
        shadowDesc.setDimensions(Shadow.BUFFER_WIDTH, Shadow.BUFFER_HEIGHT, 1);
        shadowDesc.clearColor = Shadow.CLEAR_COLOR;
        const shadowTargetID = builder.createRenderTargetID(shadowDesc, "Shadow Buffer");
        this.shadowDownsample.pushPass(builder, this.renderHelper, casterTargetID, shadowTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            const shadowResolveID = builder.resolveRenderTarget(shadowTargetID);
            pass.attachResolveTexture(shadowResolveID);
            pass.exec((passRenderer, scope) => {
                this.renderInstListMain.resolveLateSamplerBinding(Shadow.LATE_BINDING, { gfxTexture: scope.getResolveTextureForID(shadowResolveID), gfxSampler: null });
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        this.peekZ.pushPasses(this.renderHelper.renderInstManager, builder, mainDepthTargetID);
        this.peekZ.peekData(device);

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        builder.execute();
        this.renderInstListMain.reset();
        this.renderInstListShadow.reset();
    }

    public destroyed = false;

    public override destroy(device: GfxDevice): void {
        this.destroyed = true;
        super.destroy(device);
        this.peekZ.destroy(device);
        this.modelCache.destroy(device);
        for (const variants of this.atlasVariants.values())
            for (const tc of variants.values())
                tc.destroy(device);
    }

    //#endregion

}

//#endregion
