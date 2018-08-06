
// Implements Retro's MREA format as seen in Metroid Prime 1.

import * as GX_Material from '../gx/gx_material';
import * as GX from '../gx/gx_enum';

import { TXTR } from './txtr';

import { ResourceSystem } from "./resource";
import { assert, readString, align } from "../util";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { compileVtxLoaderMultiVat, GX_VtxDesc, GX_VtxAttrFmt, GX_Array, LoadedVertexData, LoadedVertexLayout, VtxLoader, compileVtxLoader } from '../gx/gx_displaylist';
import { AABB } from '../Camera';
import { mat4 } from 'gl-matrix';
import * as Pako from 'pako';

export interface MREA {
    materialSet: MaterialSet;
    worldModels: WorldModel[];
}

export const enum UVAnimationType {
    INV_MAT_SKY = 0x00,
    INV_MAT     = 0x01,
    UV_SCROLL   = 0x02,
    ROTATION    = 0x03,
    FLIPBOOK_U  = 0x04,
    FLIPBOOK_V  = 0x05,
    MODEL_MAT   = 0x06,
    CYLINDER    = 0x07,
}

interface UVAnimation_Mat {
    type: UVAnimationType.INV_MAT_SKY | UVAnimationType.INV_MAT | UVAnimationType.MODEL_MAT;
}

interface UVAnimation_UVScroll {
    type: UVAnimationType.UV_SCROLL;
    offsetS: number;
    offsetT: number;
    scaleS: number;
    scaleT: number;
}

interface UVAnimation_Rotation {
    type: UVAnimationType.ROTATION;
    offset: number;
    scale: number;
}

interface UVAnimation_Flipbook {
    type: UVAnimationType.FLIPBOOK_U | UVAnimationType.FLIPBOOK_V;
    scale: number;
    numFrames: number;
    step: number;
    offset: number;
}

interface UVAnimation_Cylinder {
    type: UVAnimationType.CYLINDER;
    theta: number;
    phi: number;
}

export type UVAnimation = UVAnimation_Mat | UVAnimation_UVScroll | UVAnimation_Rotation | UVAnimation_Flipbook | UVAnimation_Cylinder;

export interface Material {
    isOccluder: boolean;
    isTransparent: boolean;
    flags: MaterialFlags;
    groupIndex: number;
    textureIndexes: number[];
    vtxAttrFormat: number;
    gxMaterial: GX_Material.GXMaterial;
    uvAnimations: UVAnimation[];
}

export interface MaterialSet {
    textures: TXTR[];
    // Deduplicate.
    textureRemapTable: number[];
    materials: Material[];
}

export const enum MaterialFlags {
    HAS_KONST      = 0x0008,
    IS_TRANSPARENT = 0x0010,
    PUNCHTHROUGH   = 0x0020,
    HAS_SAMUS_REFL = 0x0040,
    DEPTH_WRITE    = 0x0080,
    OCCLUDER       = 0x0200,
    HAS_INDTX_REFL = 0x0400,
    UV_SHORT       = 0x2000,
}

function parseMaterialSet_UVAnimations(buffer: ArrayBufferSlice, count: number): UVAnimation[] {
    const view = buffer.createDataView();
    const uvAnimations: UVAnimation[] = [];

    let offs = 0x00;
    for (let i = 0; i < count; i++) {
        const type: UVAnimationType = view.getUint32(offs + 0x00);
        offs += 0x04;

        switch (type) {
        case UVAnimationType.INV_MAT_SKY:
        case UVAnimationType.INV_MAT:
        case UVAnimationType.MODEL_MAT:
            uvAnimations.push({ type });
            // These guys have no parameters.
            break;
        case UVAnimationType.UV_SCROLL: {
            const offsetS = view.getFloat32(offs + 0x00);
            const offsetT = view.getFloat32(offs + 0x04);
            const scaleS = view.getFloat32(offs + 0x08);
            const scaleT = view.getFloat32(offs + 0x0C);
            uvAnimations.push({ type, offsetS, offsetT, scaleS, scaleT });
            offs += 0x10;
            break;
        }
        case UVAnimationType.ROTATION: {
            const offset = view.getFloat32(offs + 0x00);
            const scale = view.getFloat32(offs + 0x04);
            uvAnimations.push({ type, offset, scale });
            offs += 0x08;
            break;
        }
        case UVAnimationType.FLIPBOOK_U:
        case UVAnimationType.FLIPBOOK_V: {
            const scale = view.getFloat32(offs + 0x00);
            const numFrames = view.getFloat32(offs + 0x04);
            const step = view.getFloat32(offs + 0x08);
            const offset = view.getFloat32(offs + 0x0C);
            uvAnimations.push({ type, scale, numFrames, step, offset });
            offs += 0x10;
            break;
        }
        case UVAnimationType.CYLINDER: {
            const theta = view.getFloat32(offs + 0x00);
            const phi = view.getFloat32(offs + 0x04);
            uvAnimations.push({ type, theta, phi });
            offs += 0x08;
            break;
        }
        }
    }

    assert(offs === buffer.byteLength);
    return uvAnimations;
}

export function parseMaterialSet(resourceSystem: ResourceSystem, buffer: ArrayBufferSlice, offs: number): MaterialSet {
    const view = buffer.createDataView();

    const textureCount = view.getUint32(offs + 0x00);
    offs += 0x04;
    const textures: TXTR[] = [];
    const textureRemapTable: number[] = [];
    for (let i = 0; i < textureCount; i++) {
        const materialTXTRID = readString(buffer, offs, 0x04, false);
        const txtr: TXTR = resourceSystem.loadAssetByID(materialTXTRID, 'TXTR');
        const txtrIndex = textures.indexOf(txtr);
        if (txtrIndex >= 0) {
            textureRemapTable.push(txtrIndex);
        } else {
            const newIndex = textures.push(txtr) - 1;
            textureRemapTable.push(newIndex);
        }
        offs += 0x04;
    }

    const materialCount = view.getUint32(offs + 0x00);
    offs += 0x04;
    const materialEndTable: number[] = [];
    for (let i = 0; i < materialCount; i++) {
        const materialEndOffs = view.getUint32(offs);
        materialEndTable.push(materialEndOffs);
        offs += 0x04;
    }

    const materialsStart = offs;
    const materials: Material[] = [];
    for (let i = 0; i < materialCount; i++) {
        const flags: MaterialFlags = view.getUint32(offs + 0x00);
        const textureIndexCount = view.getUint32(offs + 0x04);
        offs += 0x08;

        const textureIndexes: number[] = [];
        assert(textureIndexCount < 8);
        for (let j = 0; j < textureIndexCount; j++) {
            const textureIndex = view.getUint32(offs);
            textureIndexes.push(textureIndex);
            offs += 0x04;
        }

        const vtxAttrFormat = view.getUint32(offs + 0x00);
        const groupIndex = view.getUint32(offs + 0x04);
        offs += 0x08;

        let colorConstants: GX_Material.Color[] = [];

        if (flags & MaterialFlags.HAS_KONST) {
            const konstCount = view.getUint32(offs);
            offs += 0x04;

            for (let j = 0; j < konstCount; j++) {
                const r = view.getUint8(offs + 0x00);
                const g = view.getUint8(offs + 0x01);
                const b = view.getUint8(offs + 0x02);
                const a = view.getUint8(offs + 0x03);
                colorConstants.push(new GX_Material.Color(r, g, b, a));
                offs += 0x04;
            }
        }

        for (let j = colorConstants.length; j < 4; j++) {
            // Push default colors.
            // XXX(jstpierre): Should this stuff be moved outside GXMaterial?
            colorConstants.push(new GX_Material.Color(0, 0, 0, 0));
        }

        const blendDstFactor: GX.BlendFactor = view.getUint16(offs + 0x00);
        const blendSrcFactor: GX.BlendFactor = view.getUint16(offs + 0x02);
        offs += 0x04;

        if (flags & MaterialFlags.HAS_INDTX_REFL) {
            const reflectionIndtexSlot = view.getUint32(offs);
            offs += 0x04;
        }

        const colorChannelFlagsTableCount = view.getUint32(offs);
        assert(colorChannelFlagsTableCount <= 4);
        offs += 0x04;

        const lightChannels: GX_Material.LightChannelControl[] = [];
        // Only color channel 1 is stored in the format.
        for (let j = 0; j < 1; j++) {
            const colorChannelFlags = view.getUint32(offs);
            const lightingEnabled = !!(colorChannelFlags & 0x01);
            const ambColorSource: GX.ColorSrc = (colorChannelFlags >>> 1) & 0x01;
            const matColorSource: GX.ColorSrc = (colorChannelFlags >>> 2) & 0x01;

            const colorChannel = { lightingEnabled, ambColorSource, matColorSource };
            // XXX(jstpierre): What's with COLOR0A0?
            const alphaChannel = { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG }
            lightChannels.push({ colorChannel, alphaChannel });
        }
        offs += 0x04 * colorChannelFlagsTableCount;

        // Fake other channel.
        lightChannels.push({
            colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG },
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG },
        });

        const tevStageCount = view.getUint32(offs);
        assert(tevStageCount <= 8);
        offs += 0x04;
        let tevOrderTableOffs = offs + tevStageCount * 0x14;

        const tevStages: GX_Material.TevStage[] = [];
        for (let j = 0; j < tevStageCount; j++) {
            const colorInputSel = view.getUint32(offs + 0x00);
            const alphaInputSel = view.getUint32(offs + 0x04);
            const colorCombineFlags = view.getUint32(offs + 0x08);
            const alphaCombineFlags = view.getUint32(offs + 0x0C);

            const konstAlphaSel: GX.KonstAlphaSel = view.getUint8(offs + 0x11);
            const konstColorSel: GX.KonstColorSel = view.getUint8(offs + 0x12);
            const channelId: GX.RasColorChannelID = GX_Material.getRasColorChannelID(view.getUint8(offs + 0x13));

            const colorInA: GX.CombineColorInput = (colorInputSel >>>  0) & 0x1F;
            const colorInB: GX.CombineColorInput = (colorInputSel >>>  5) & 0x1F;
            const colorInC: GX.CombineColorInput = (colorInputSel >>> 10) & 0x1F;
            const colorInD: GX.CombineColorInput = (colorInputSel >>> 15) & 0x1F;

            const alphaInA: GX.CombineAlphaInput = (alphaInputSel >>>  0) & 0x1F;
            const alphaInB: GX.CombineAlphaInput = (alphaInputSel >>>  5) & 0x1F;
            const alphaInC: GX.CombineAlphaInput = (alphaInputSel >>> 10) & 0x1F;
            const alphaInD: GX.CombineAlphaInput = (alphaInputSel >>> 15) & 0x1F;

            const colorOp: GX.TevOp       = (colorCombineFlags >>> 0) & 0x0F;
            const colorBias: GX.TevBias   = (colorCombineFlags >>> 4) & 0x03;
            const colorScale: GX.TevScale = (colorCombineFlags >>> 6) & 0x03;
            const colorClamp: boolean     = !!(colorCombineFlags >>> 8);
            const colorRegId: GX.Register = (colorCombineFlags >>> 9) & 0x03;

            const alphaOp: GX.TevOp       = (alphaCombineFlags >>> 0) & 0x0F;
            const alphaBias: GX.TevBias   = (alphaCombineFlags >>> 4) & 0x03;
            const alphaScale: GX.TevScale = (alphaCombineFlags >>> 6) & 0x03;
            const alphaClamp: boolean     = !!(alphaCombineFlags >>> 8);
            const alphaRegId: GX.Register = (alphaCombineFlags >>> 9) & 0x03;

            const texCoordId: GX.TexCoordID = view.getUint8(tevOrderTableOffs + 0x03);
            const texMap: number = view.getUint8(tevOrderTableOffs + 0x02);

            const index = j;

            const tevStage: GX_Material.TevStage = {
                index,
                colorInA, colorInB, colorInC, colorInD, colorOp, colorBias, colorScale, colorClamp, colorRegId,
                alphaInA, alphaInB, alphaInC, alphaInD, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId,
                texCoordId, texMap, channelId,
                konstColorSel, konstAlphaSel,

                // We don't use indtex.
                indTexStage: GX.IndTexStageID.STAGE0,
                indTexMatrix: GX.IndTexMtxID.OFF,
                indTexFormat: GX.IndTexFormat._8,
                indTexBiasSel: GX.IndTexBiasSel.NONE,
                indTexWrapS: GX.IndTexWrap.OFF,
                indTexWrapT: GX.IndTexWrap.OFF,
                indTexAddPrev: false,
                indTexUseOrigLOD: false,
            };

            tevStages.push(tevStage);

            offs += 0x14;
            tevOrderTableOffs += 0x04;
        }

        // Skip past TEV order table.
        offs = tevOrderTableOffs;

        const texGenCount = view.getUint32(offs);
        assert(texGenCount <= 8);
        offs += 0x04;
        const texGens: GX_Material.TexGen[] = [];
        for (let j = 0; j < texGenCount; j++) {
            const index = j;
            const flags = view.getUint32(offs);
            const type: GX.TexGenType = (flags >>> 0) & 0x0F;
            const source: GX.TexGenSrc = (flags >>> 4) & 0x0F;
            const matrix: GX.TexGenMatrix = ((flags >>> 9) & 0x1F) + 30;

            const normalize: boolean = !!(flags & 14);
            const postMatrix: GX.PostTexGenMatrix = ((flags >>> 15) & 0x3F) + 64;

            texGens.push({ index, type, source, matrix, normalize, postMatrix });
            offs += 0x04;
        }

        const uvAnimationsSize = view.getUint32(offs + 0x00) - 0x04;
        const uvAnimationsCount = view.getUint32(offs + 0x04);
        offs += 0x08;
        const uvAnimations: UVAnimation[] = parseMaterialSet_UVAnimations(buffer.subarray(offs, uvAnimationsSize), uvAnimationsCount);
        offs += uvAnimationsSize;

        const index = i;

        const name = `PrimeGen_${i}`;
        const cullMode = GX.CullMode.FRONT;

        const isTransparent = !!(flags & MaterialFlags.IS_TRANSPARENT);
        const isOccluder = !!(flags & MaterialFlags.OCCLUDER);
        const depthWrite = !!(flags & MaterialFlags.DEPTH_WRITE);

        const colorRegisters: GX_Material.Color[] = [];
        colorRegisters.push(new GX_Material.Color(0, 0, 0, 0));
        colorRegisters.push(new GX_Material.Color(1, 1, 1, 0));
        colorRegisters.push(new GX_Material.Color(1, 1, 1, 0));
        colorRegisters.push(new GX_Material.Color(0, 0, 0, 0));

        const alphaTest: GX_Material.AlphaTest = {
            op: GX.AlphaOp.OR,
            compareA: GX.CompareType.GREATER,
            referenceA: 0.25,
            compareB: GX.CompareType.NEVER,
            referenceB: 0,
        };

        const blendMode: GX_Material.BlendMode = {
            type: isTransparent ? GX.BlendMode.BLEND : GX.BlendMode.NONE,
            srcFactor: blendSrcFactor,
            dstFactor: blendDstFactor,
            logicOp: GX.LogicOp.CLEAR,
        };

        const ropInfo: GX_Material.RopInfo = {
            blendMode,
            depthTest: true,
            depthFunc: GX.CompareType.LESS,
            depthWrite: depthWrite && !isTransparent,
        };

        const gxMaterial: GX_Material.GXMaterial = {
            index, name,
            cullMode,
            colorRegisters,
            colorConstants,
            lightChannels,
            texGens,
            tevStages,
            alphaTest,
            ropInfo,
            indTexStages: [],
        };

        materials.push({ isOccluder, isTransparent, flags, groupIndex, textureIndexes, vtxAttrFormat, gxMaterial, uvAnimations });
        assert((offs - materialsStart) === materialEndTable[i]);
    }

    return { textures, textureRemapTable, materials };
}

// TODO(jstpierre): Reuse VCD parsing code from BRRES?
export const vtxAttrFormats = [
    { vtxAttrib: GX.VertexAttribute.POS,  mask: 0x00000003 },
    { vtxAttrib: GX.VertexAttribute.NRM,  mask: 0x0000000C },
    { vtxAttrib: GX.VertexAttribute.CLR0, mask: 0x00000030 },
    { vtxAttrib: GX.VertexAttribute.CLR1, mask: 0x000000C0 },
    { vtxAttrib: GX.VertexAttribute.TEX0, mask: 0x00000300 },
    { vtxAttrib: GX.VertexAttribute.TEX1, mask: 0x00000C00 },
    { vtxAttrib: GX.VertexAttribute.TEX2, mask: 0x00003000 },
    { vtxAttrib: GX.VertexAttribute.TEX3, mask: 0x0000C000 },
    { vtxAttrib: GX.VertexAttribute.TEX4, mask: 0x00030000 },
    { vtxAttrib: GX.VertexAttribute.TEX5, mask: 0x000C0000 },
    { vtxAttrib: GX.VertexAttribute.TEX6, mask: 0x00300000 },
];

export interface Surface {
    materialIndex: number;
    loadedVertexData: LoadedVertexData;
    loadedVertexLayout: LoadedVertexLayout;
}

export interface WorldModel {
    geometry: Geometry;
    modelMatrix: mat4;
    bbox: AABB;
}

export interface Geometry {
    surfaces: Surface[];
}

export function parseGeometry(buffer: ArrayBufferSlice, materialSet: MaterialSet, sectionOffsTable: number[], hasUVShort: boolean, sectionIndex: number): [Geometry, number] {
    const view = buffer.createDataView();

    const posSectionOffs = sectionOffsTable[sectionIndex++];
    const nrmSectionOffs = sectionOffsTable[sectionIndex++];
    const clrSectionOffs = sectionOffsTable[sectionIndex++];
    const uvfSectionOffs = sectionOffsTable[sectionIndex++];
    const uvsSectionOffs = hasUVShort ? sectionOffsTable[sectionIndex++] : null;

    const surfaceTableOffs = sectionOffsTable[sectionIndex++];
    const firstSurfaceOffs = sectionOffsTable[sectionIndex];

    const surfaceCount = view.getUint32(surfaceTableOffs + 0x00);
    const surfaces: Surface[] = [];

    function fillVatFormat(nrmType: GX.CompType, tex0Type: GX.CompType, compShift: number): GX_VtxAttrFmt[] {
        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.VertexAttribute.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift };
        vatFormat[GX.VertexAttribute.NRM] = { compCnt: GX.CompCnt.NRM_XYZ, compType: nrmType, compShift };
        vatFormat[GX.VertexAttribute.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift };
        vatFormat[GX.VertexAttribute.CLR1] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift };
        vatFormat[GX.VertexAttribute.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compType: tex0Type, compShift };
        vatFormat[GX.VertexAttribute.TEX1] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift };
        vatFormat[GX.VertexAttribute.TEX2] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift };
        vatFormat[GX.VertexAttribute.TEX3] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift };
        vatFormat[GX.VertexAttribute.TEX4] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift };
        vatFormat[GX.VertexAttribute.TEX5] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift };
        vatFormat[GX.VertexAttribute.TEX6] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift };
        vatFormat[GX.VertexAttribute.TEX7] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift };
        return vatFormat;
    }

    for (let i = 0; i < surfaceCount; i++) {
        const surfaceOffs = sectionOffsTable[sectionIndex];
        const surfaceEnd = firstSurfaceOffs + view.getUint32(surfaceTableOffs + 0x04 + i * 0x04);

        const centerX = view.getFloat32(surfaceOffs + 0x00);
        const centerY = view.getFloat32(surfaceOffs + 0x04);
        const centerZ = view.getFloat32(surfaceOffs + 0x08);
        const materialIndex = view.getUint32(surfaceOffs + 0x0C);
        const mantissa = view.getUint16(surfaceOffs + 0x10);
        const displayListSizeExceptNotReally = view.getUint16(surfaceOffs + 0x12);
        const extraDataSize = view.getUint32(surfaceOffs + 0x1C);
        const normalX = view.getFloat32(surfaceOffs + 0x20);
        const normalY = view.getFloat32(surfaceOffs + 0x24);
        const normalZ = view.getFloat32(surfaceOffs + 0x28);

        // XXX(jstpierre): 0x30 or 0x2C?
        const surfaceHeaderEnd = surfaceOffs + 0x2C + extraDataSize;
        const primitiveDataOffs = align(surfaceHeaderEnd, 32);

        // Build our vertex format.
        const material = materialSet.materials[materialIndex];
        const vtxAttrFormat = material.vtxAttrFormat;

        const vat: GX_VtxAttrFmt[][] = [];

        const useUvsArray = (material.flags & MaterialFlags.UV_SHORT);

        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.VertexAttribute.POS]  = { buffer, offs: posSectionOffs };
        vtxArrays[GX.VertexAttribute.NRM]  = { buffer, offs: nrmSectionOffs };
        vtxArrays[GX.VertexAttribute.CLR0] = { buffer, offs: clrSectionOffs };
        vtxArrays[GX.VertexAttribute.CLR1] = { buffer, offs: clrSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX0] = { buffer, offs: useUvsArray ? uvsSectionOffs : uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX1] = { buffer, offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX2] = { buffer, offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX3] = { buffer, offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX4] = { buffer, offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX5] = { buffer, offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX6] = { buffer, offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX7] = { buffer, offs: uvfSectionOffs };

        const vcd: GX_VtxDesc[] = [];
        for (const format of vtxAttrFormats) {
            if (!(vtxAttrFormat & format.mask))
                continue;
            vcd[format.vtxAttrib] = { type: GX.AttrType.INDEX16 };
        }

        // GX_VTXFMT0 | GX_VA_NRM = GX_F32
        // GX_VTXFMT1 | GX_VA_NRM = GX_S16
        // GX_VTXFMT2 | GX_VA_NRM = GX_S16
        // GX_VTXFMT0 | GX_VA_TEX0 = GX_F32
        // GX_VTXFMT1 | GX_VA_TEX0 = GX_F32
        // GX_VTXFMT2 | GX_VA_TEX0 = GX_S16
        const compShift = Math.log2(mantissa);
        vat[GX.VtxFmt.VTXFMT0] = fillVatFormat(GX.CompType.F32, GX.CompType.F32, compShift);
        vat[GX.VtxFmt.VTXFMT1] = fillVatFormat(GX.CompType.S16, GX.CompType.F32, compShift);
        vat[GX.VtxFmt.VTXFMT2] = fillVatFormat(GX.CompType.S16, GX.CompType.S16, compShift);

        const vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        const dlData = buffer.slice(primitiveDataOffs, surfaceEnd);
        const loadedVertexLayout = vtxLoader.loadedVertexLayout;
        const loadedVertexData = vtxLoader.runVertices(vtxArrays, dlData);

        const surface: Surface = {
            materialIndex,
            loadedVertexData,
            loadedVertexLayout,
        };
        surfaces.push(surface);

        sectionIndex++;
    }

    const geometry: Geometry = { surfaces };
    return [geometry, sectionIndex];
}

function parse_MP1(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): MREA {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0xDEADBEEF);
    const version = view.getUint32(0x04);
    assert(version === 0x0F);

    // 0x08 - 0x34: Transform matrix

    const worldModelCount = view.getUint32(0x38);
    const dataSectionCount = view.getUint32(0x3C);
    const worldGeometrySectionIndex = view.getUint32(0x40);

    const dataSectionSizeTable: number[] = [];
    let dataSectionSizeTableIdx = 0x60;
    for (let i = 0; i < dataSectionCount; i++) {
        const size = view.getUint32(dataSectionSizeTableIdx + 0x00);
        dataSectionSizeTable.push(size);
        dataSectionSizeTableIdx += 0x04;
    }

    const firstDataSectionOffs = align(dataSectionSizeTableIdx, 32);
    const dataSectionOffsTable: number[] = [firstDataSectionOffs];
    for (let i = 1; i < dataSectionCount; i++) {
        const prevOffs = dataSectionOffsTable[i - 1];
        const prevSize = dataSectionSizeTable[i - 1];
        dataSectionOffsTable.push(align(prevOffs + prevSize, 32));
    }

    // In practice.
    assert(worldGeometrySectionIndex === 0);

    // The materials section is always the first index in the world geometry section indexes...
    const materialSectionOffs = dataSectionOffsTable[worldGeometrySectionIndex + 0];

    // Parse out materials.
    const materialSet = parseMaterialSet(resourceSystem, buffer, materialSectionOffs);

    let geometrySectionIndex = worldGeometrySectionIndex + 1;
    const worldModels: WorldModel[] = [];
    for (let i = 0; i < worldModelCount; i++) {
        // World model header.
        let worldModelHeaderOffs = dataSectionOffsTable[geometrySectionIndex];
        const visorFlags = view.getUint32(worldModelHeaderOffs + 0x00);
        const m00 = view.getFloat32(worldModelHeaderOffs + 0x04);
        const m01 = view.getFloat32(worldModelHeaderOffs + 0x08);
        const m02 = view.getFloat32(worldModelHeaderOffs + 0x0C);
        const m03 = view.getFloat32(worldModelHeaderOffs + 0x10);
        const m10 = view.getFloat32(worldModelHeaderOffs + 0x14);
        const m11 = view.getFloat32(worldModelHeaderOffs + 0x18);
        const m12 = view.getFloat32(worldModelHeaderOffs + 0x1C);
        const m13 = view.getFloat32(worldModelHeaderOffs + 0x20);
        const m20 = view.getFloat32(worldModelHeaderOffs + 0x24);
        const m21 = view.getFloat32(worldModelHeaderOffs + 0x28);
        const m22 = view.getFloat32(worldModelHeaderOffs + 0x2C);
        const m23 = view.getFloat32(worldModelHeaderOffs + 0x30);
        const modelMatrix = mat4.fromValues(
            m00, m10, m20, 0.0,
            m01, m11, m21, 0.0,
            m02, m12, m22, 0.0,
            m03, m13, m23, 1.0,
        );
        const bboxMinX = view.getFloat32(worldModelHeaderOffs + 0x34);
        const bboxMinY = view.getFloat32(worldModelHeaderOffs + 0x38);
        const bboxMinZ = view.getFloat32(worldModelHeaderOffs + 0x3C);
        const bboxMaxX = view.getFloat32(worldModelHeaderOffs + 0x40);
        const bboxMaxY = view.getFloat32(worldModelHeaderOffs + 0x44);
        const bboxMaxZ = view.getFloat32(worldModelHeaderOffs + 0x48);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
        worldModelHeaderOffs += 0x4C;

        geometrySectionIndex += 1;

        let geometry: Geometry;
        [geometry, geometrySectionIndex] = parseGeometry(buffer, materialSet, dataSectionOffsTable, true, geometrySectionIndex);
        worldModels.push({ geometry, modelMatrix, bbox });
    }

    return { materialSet, worldModels };
}

function combineBuffers(totalSize: number, buffers: Uint8Array[]): Uint8Array {
    const totalBuffer = new Uint8Array(totalSize);
    let idx = 0;
    for (let i = 0; i < buffers.length; i++) {
        totalBuffer.set(buffers[i], idx);
        idx += buffers[i].byteLength;
    }
    assert(idx === totalSize);
    return totalBuffer;
}

export const enum MaterialFlags_MP3 {
    BLEND = 0x08,
    PUNCHTHROUGH = 0x10,
    ADDITIVE_BLEND = 0x20,
    OCCLUDER = 0x100,
    WHITE_AMB = 0x80000,
}

function makeTevStageFromPass_MP3(passIndex: number, passType: string, passFlags: number, materialFlags: MaterialFlags_MP3, hasOPAC: boolean): GX_Material.TevStage {
    // Standard texture sample.
    const tevStage: GX_Material.TevStage = {
        index: passIndex,
        channelId: GX.RasColorChannelID.COLOR0A0,

        colorInA: GX.CombineColorInput.ZERO,
        colorInB: GX.CombineColorInput.ZERO,
        colorInC: GX.CombineColorInput.ZERO,
        colorInD: GX.CombineColorInput.CPREV,
        colorBias: GX.TevBias.ZERO,
        colorOp: GX.TevOp.ADD,
        colorClamp: true,
        colorScale: GX.TevScale.SCALE_1,
        colorRegId: GX.Register.PREV,

        alphaInA: GX.CombineAlphaInput.ZERO,
        alphaInB: GX.CombineAlphaInput.ZERO,
        alphaInC: GX.CombineAlphaInput.ZERO,
        alphaInD: GX.CombineAlphaInput.APREV,
        alphaBias: GX.TevBias.ZERO,
        alphaOp: GX.TevOp.ADD,
        alphaClamp: true,
        alphaScale: GX.TevScale.SCALE_1,
        alphaRegId: GX.Register.PREV,

        indTexAddPrev: false,
        indTexMatrix: GX.IndTexMtxID.OFF,
        indTexBiasSel: GX.IndTexBiasSel.NONE,
        indTexFormat: GX.IndTexFormat._8,
        indTexStage: GX.IndTexStageID.STAGE0,
        indTexUseOrigLOD: true,
        indTexWrapS: GX.IndTexWrap.OFF,
        indTexWrapT: GX.IndTexWrap.OFF,

        konstColorSel: GX.KonstColorSel.KCSEL_1,
        konstAlphaSel: GX.KonstAlphaSel.KASEL_1,
        texMap: GX.TexMapID.TEXMAP0 + passIndex,
        texCoordId: GX.TexCoordID.TEXCOORD0 + passIndex,
    };

    if (passType === 'DIFF') {
        tevStage.konstColorSel = GX.KonstColorSel.KCSEL_K0;
        tevStage.konstAlphaSel = GX.KonstAlphaSel.KASEL_K0_A;

        tevStage.colorInB = GX.CombineColorInput.KONST;
        tevStage.colorInC = GX.CombineColorInput.TEXC;
        tevStage.colorInD = GX.CombineColorInput.RASC;

        tevStage.alphaInD = GX.CombineAlphaInput.KONST;
    }

    if (passType === 'CLR ') {
        tevStage.colorInB = GX.CombineColorInput.CPREV;
        tevStage.colorInC = GX.CombineColorInput.TEXC;
        tevStage.colorInD = GX.CombineColorInput.ZERO;
        tevStage.alphaInD = (materialFlags & MaterialFlags_MP3.PUNCHTHROUGH) ? GX.CombineAlphaInput.TEXA : GX.CombineAlphaInput.APREV;
        tevStage.konstAlphaSel = GX.KonstAlphaSel.KASEL_K1_A;
    }

    if (passType === 'TRAN') {
        tevStage.konstAlphaSel = GX.KonstAlphaSel.KASEL_1;
        tevStage.texSwapTable = [ GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R, GX.TevColorChan.R ];

        // Invert.
        if (passFlags & 0x10)
            tevStage.alphaInA = GX.CombineAlphaInput.KONST;
        else
            tevStage.alphaInB = GX.CombineAlphaInput.KONST;
        tevStage.alphaInC = GX.CombineAlphaInput.TEXA;
        tevStage.alphaInD = GX.CombineAlphaInput.ZERO;
    }

    if (passType === 'INCA') {
        // Emissive.
        tevStage.colorInB = GX.CombineColorInput.TEXC;
        tevStage.colorInC = GX.CombineColorInput.ONE;
        tevStage.colorInD = GX.CombineColorInput.CPREV;
    }

    return tevStage;
}

interface Material_MP3 extends Material {
    passTypes: string[];
}

function parseMaterialSet_MP3(resourceSystem: ResourceSystem, buffer: ArrayBufferSlice): MaterialSet {
    const view = buffer.createDataView();

    const materialCount = view.getUint32(0x00);
    let materialTableIdx = 0x04;

    const textures: TXTR[] = [];
    const textureRemapTable: number[] = [];
    const materials: Material_MP3[] = [];
    for (let i = 0; i < materialCount; i++) {
        const materialOffs = materialTableIdx;
        const materialSize = view.getUint32(materialTableIdx + 0x00);
        const materialFlags: MaterialFlags_MP3 = view.getUint32(materialTableIdx + 0x04);
        const groupIndex = view.getUint32(materialTableIdx + 0x08);
        const vtxAttrFormat = view.getUint32(materialTableIdx + 0x10);
        materialTableIdx += 0x20;

        let passIndex = 0;
        const colorConstants: GX_Material.Color[] = [];
        colorConstants.push(new GX_Material.Color(1, 1, 1, 1));
        colorConstants.push(new GX_Material.Color(0, 0, 0, 0));
        colorConstants.push(new GX_Material.Color(0, 0, 0, 0));
        colorConstants.push(new GX_Material.Color(0, 0, 0, 0));

        const texGens: GX_Material.TexGen[] = [];
        const tevStages: GX_Material.TevStage[] = [];
        const textureIndexes: number[] = [];
        const uvAnimations: UVAnimation[] = [];
        const passTypes: string[] = [];
        let hasOPAC = false;
        while(true) {
            const nodeType = readString(buffer, materialTableIdx + 0x00, 0x04, false);
            materialTableIdx += 0x04;
            if (nodeType === 'END ') {
                assert(materialTableIdx === materialOffs + 0x04 + materialSize);
                break;
            } else if (nodeType === 'PASS') {
                const passOffs = materialTableIdx;
                const passSize = view.getUint32(materialTableIdx + 0x00);
                const passType = readString(buffer, materialTableIdx + 0x04, 0x04, false);
                const passFlags = view.getUint32(materialTableIdx + 0x08);
                const materialTXTRID = readString(buffer, materialTableIdx + 0x0C, 0x08, false);
                const texGenSrc: GX.TexGenSrc = GX.TexGenSrc.TEX0 + view.getUint32(materialTableIdx + 0x14) & 0x0F;
                const uvAnimationSize = view.getUint32(materialTableIdx + 0x18);
                let uvAnimation: UVAnimation | null = null;
                materialTableIdx += 0x1C;
                if (uvAnimationSize !== 0) {
                    const unk1 = view.getUint16(materialTableIdx + 0x00);
                    const unk2 = view.getUint16(materialTableIdx + 0x02);
                    const uvAnimations: UVAnimation[] = parseMaterialSet_UVAnimations(buffer.subarray(materialTableIdx + 0x04, uvAnimationSize - 0x04), 1);
                    uvAnimation = uvAnimations[0];
                    materialTableIdx += uvAnimationSize;
                }
                assert(materialTableIdx === passOffs + 0x04 + passSize);

                const txtr: TXTR = resourceSystem.loadAssetByID(materialTXTRID, 'TXTR');
                let txtrIndex = textures.indexOf(txtr);
                if (txtrIndex < 0) {
                    txtrIndex = textures.push(txtr) - 1;
                    // TODO(jstpierre): Remove remap table.
                    textureRemapTable[txtrIndex] = txtrIndex;
                }

                texGens[passIndex] = {
                    index: passIndex,
                    type: GX.TexGenType.MTX2x4,
                    source: texGenSrc,
                    matrix: GX.TexGenMatrix.TEXMTX0 + (passIndex * 3),
                    postMatrix: GX.PostTexGenMatrix.PTTEXMTX0 + (passIndex * 3),
                    normalize: false,
                };
                tevStages[passIndex] = makeTevStageFromPass_MP3(passIndex, passType, passFlags, materialFlags, hasOPAC);
                textureIndexes[passIndex] = txtrIndex;
                uvAnimations[passIndex] = uvAnimation;
                passTypes[passIndex] = passType;
                passIndex++;
            } else if (nodeType === 'CLR ') {
                // Color
                const subtype = readString(buffer, materialTableIdx + 0x00, 0x04, false);
                const value = view.getUint32(materialTableIdx + 0x04);
                materialTableIdx += 0x08;
                if (subtype === 'DIFB') {
                    // Lightmap Diffuse Multiplier
                    colorConstants[0].copy32(value);
                }
            } else if (nodeType === 'INT ') {
                // Intensity
                const subtype = readString(buffer, materialTableIdx + 0x00, 0x04, false);
                const value = view.getUint32(materialTableIdx + 0x04);
                materialTableIdx += 0x08;
                if (subtype === 'OPAC') {
                    // Opacity
                    colorConstants[1].a = value;
                    hasOPAC = true;
                }
            } else {
                throw "whoops";
            }
        }

        assert(passIndex > 0);

        const index = i;
        const name = `Prime3Gen_${i}`;

        const cullMode = GX.CullMode.FRONT;

        const isOccluder = !!(materialFlags & MaterialFlags_MP3.OCCLUDER);
        const blend = !!(materialFlags & MaterialFlags_MP3.BLEND);
        const additiveBlend = !!(materialFlags & MaterialFlags_MP3.ADDITIVE_BLEND);
        const punchthrough = !!(materialFlags & MaterialFlags_MP3.PUNCHTHROUGH);
        const isTransparent = blend || additiveBlend;
        const depthWrite = true;

        const lightChannels: GX_Material.LightChannelControl[] = [];
        lightChannels.push({
            colorChannel: { lightingEnabled: true,  ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG },
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG },
        });
        lightChannels.push({
            colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG },
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG },
        });

        const colorRegisters: GX_Material.Color[] = [];
        colorRegisters.push(new GX_Material.Color(0, 0, 0, 0));
        colorRegisters.push(new GX_Material.Color(1, 1, 1, 0));
        colorRegisters.push(new GX_Material.Color(1, 1, 1, 0));
        colorRegisters.push(new GX_Material.Color(0, 0, 0, 0));

        const alphaTest: GX_Material.AlphaTest = {
            op: GX.AlphaOp.OR,
            compareA: punchthrough ? GX.CompareType.GREATER : GX.CompareType.ALWAYS,
            referenceA: 0.75,
            compareB: GX.CompareType.NEVER,
            referenceB: 0,
        };

        const blendMode: GX_Material.BlendMode = {
            type: isTransparent ? GX.BlendMode.BLEND : GX.BlendMode.NONE,
            srcFactor: GX.BlendFactor.SRCALPHA,
            dstFactor: additiveBlend ? GX.BlendFactor.ONE : GX.BlendFactor.INVSRCALPHA,
            logicOp: GX.LogicOp.CLEAR,
        };

        const ropInfo: GX_Material.RopInfo = {
            blendMode,
            depthTest: true,
            depthFunc: GX.CompareType.LESS,
            depthWrite: depthWrite && !isTransparent,
        };

        const gxMaterial: GX_Material.GXMaterial = {
            index, name,
            cullMode,
            colorRegisters,
            colorConstants,
            lightChannels,
            texGens,
            tevStages,
            alphaTest,
            ropInfo,
            indTexStages: [],
        };

        materials.push({ isOccluder, isTransparent, flags: 0, groupIndex, textureIndexes, vtxAttrFormat, gxMaterial, uvAnimations, passTypes });
    }

    return { textures, textureRemapTable, materials };
}

function parse_DKCR(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): MREA {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0xDEADBEEF);
    const version = view.getUint32(0x04);
    assert(version === 0x20);

    // 0x08 - 0x34: Transform matrix

    const worldModelCount = view.getUint32(0x38);
    const scriptLayerCount = view.getUint32(0x3C);
    const dataSectionCount = view.getUint32(0x40);
    const compressedBlockCount = view.getUint32(0x44);
    const sectionNumberCount = view.getUint32(0x48);

    const dataSectionSizeTable: number[] = [];
    let dataSectionSizeTableIdx = 0x60;
    for (let i = 0; i < dataSectionCount; i++) {
        const size = view.getUint32(dataSectionSizeTableIdx + 0x00);
        dataSectionSizeTable.push(size);
        dataSectionSizeTableIdx += 0x04;
    }

    // TODO(jstpierre): Instead of decompressing blocks up-front, make something that can
    // decompress on-demand? We don't use a lot of data in here, so it might save some parse time...
    let compressedBlocksTableIdx = align(dataSectionSizeTableIdx, 0x20);
    let sectionNumbersTableIdx = align(compressedBlocksTableIdx + 0x10 * compressedBlockCount, 0x20);
    let compressedBlocksIdx = align(sectionNumbersTableIdx + 0x08 * sectionNumberCount, 0x20);
    const decompressedSegments: Uint8Array[] = [];
    let totalDecompressedSize = 0;
    for (let i = 0; i < compressedBlockCount; i++) {
        const blockBufferSize = view.getUint32(compressedBlocksTableIdx + 0x00);
        const blockDecompressedSize = view.getUint32(compressedBlocksTableIdx + 0x04);
        const blockCompressedSize = view.getUint32(compressedBlocksTableIdx + 0x08);
        const blockDataSectionCount = view.getUint32(compressedBlocksTableIdx + 0x0C);
        compressedBlocksTableIdx += 0x10;

        totalDecompressedSize += blockDecompressedSize;

        if (blockCompressedSize === 0) {
            // Uncompressed block.
            decompressedSegments.push(buffer.createTypedArray(Uint8Array, compressedBlocksIdx, blockDecompressedSize));
            compressedBlocksIdx += blockDecompressedSize;
        } else {
            // Compressed block.

            // Padding is at the start of the block for some reason.
            const blockPadding = align(blockCompressedSize, 0x20) - blockCompressedSize;

            compressedBlocksIdx += blockPadding;

            let remainingSize = blockDecompressedSize;
            while (remainingSize > 0) {
                let segmentSize_ = view.getInt16(compressedBlocksIdx);
                compressedBlocksIdx += 0x02;
                if (segmentSize_ < 0) {
                    // Uncompressed segment.
                    const segmentSize = -segmentSize_;
                    decompressedSegments.push(buffer.createTypedArray(Uint8Array, compressedBlocksIdx, segmentSize));
                    compressedBlocksIdx += segmentSize;
                    remainingSize -= segmentSize;
                } else {
                    // Compressed segment.
                    const segmentSize = segmentSize_;
                    const compressedSegment = buffer.createTypedArray(Uint8Array, compressedBlocksIdx, segmentSize);
                    const decompressedSegment = Pako.inflate(compressedSegment);
                    decompressedSegments.push(decompressedSegment);
                    compressedBlocksIdx += segmentSize;
                    remainingSize -= decompressedSegment.byteLength;
                }
            }
        }
    }

    const sectionsData = combineBuffers(totalDecompressedSize, decompressedSegments);
    const secBuffer = new ArrayBufferSlice(sectionsData.buffer);
    const secView = secBuffer.createDataView();

    const dataSectionOffsTable: number[] = [0];
    for (let i = 1; i < dataSectionCount; i++) {
        const prevOffs = dataSectionOffsTable[i - 1];
        const prevSize = dataSectionSizeTable[i - 1];
        dataSectionOffsTable.push(align(prevOffs + prevSize, 32));
    }

    let gpudSectionIndex = -1;
    let aabbSectionIndex = -1;
    for (let i = 0; i < sectionNumberCount; i++) {
        const sectionFourCC = readString(buffer, sectionNumbersTableIdx + 0x00, 0x04, false);
        const sectionIndex = view.getUint32(sectionNumbersTableIdx + 0x04);

        if (sectionFourCC === 'WOBJ') {
            assert(sectionIndex === 0);
        } else if (sectionFourCC === 'GPUD') {
            gpudSectionIndex = sectionIndex;
        } else if (sectionFourCC === 'AABB') {
            aabbSectionIndex = sectionIndex;
        }

        sectionNumbersTableIdx += 0x08;
    }

    const materialSectionIndex = 0;
    const materialSet = parseMaterialSet_MP3(resourceSystem, secBuffer.subarray(dataSectionOffsTable[materialSectionIndex], dataSectionSizeTable[materialSectionIndex]));

    // const gpudBuffer = buffer.subarray(dataSectionOffsTable[gpudSectionIndex], dataSectionSizeTable[gpudSectionIndex]);
    // const aabbBuffer = buffer.subarray(dataSectionOffsTable[aabbSectionIndex], dataSectionSizeTable[aabbSectionIndex]);

    let worldModelSectionIdx = materialSectionIndex + 1;
    const worldModels: WorldModel[] = [];
    for (let i = 0; i < worldModelCount; i++) {
        const worldModelHeaderOffs = dataSectionOffsTable[worldModelSectionIdx++];
        const surfaceDefinitionTableOffs = dataSectionOffsTable[worldModelSectionIdx++];
        const surfaceGroupIDTableOffs = worldModelSectionIdx++;
        const surfaceLookupTableOffs = worldModelSectionIdx++;

        const visorFlags = secView.getUint32(worldModelHeaderOffs + 0x00);
        const bboxMinX = secView.getFloat32(worldModelHeaderOffs + 0x34);
        const bboxMinY = secView.getFloat32(worldModelHeaderOffs + 0x38);
        const bboxMinZ = secView.getFloat32(worldModelHeaderOffs + 0x3C);
        const bboxMaxX = secView.getFloat32(worldModelHeaderOffs + 0x40);
        const bboxMaxY = secView.getFloat32(worldModelHeaderOffs + 0x44);
        const bboxMaxZ = secView.getFloat32(worldModelHeaderOffs + 0x48);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

        const posSectionOffs = dataSectionOffsTable[gpudSectionIndex++];
        const nrmSectionOffs = dataSectionOffsTable[gpudSectionIndex++];
        const clrSectionOffs = dataSectionOffsTable[gpudSectionIndex++];
        const uvfSectionOffs = dataSectionOffsTable[gpudSectionIndex++];
        const uvsSectionOffs = dataSectionOffsTable[gpudSectionIndex++];
        const firstSurfaceOffs = dataSectionOffsTable[gpudSectionIndex];

        const surfaceCount = secView.getUint32(surfaceDefinitionTableOffs + 0x00);
        let surfaceDefinitionTableIdx = surfaceDefinitionTableOffs + 0x04;
        const surfaces: Surface[] = [];
        for (let j = 0; j < surfaceCount; j++) {
            const surfaceOffs = dataSectionOffsTable[gpudSectionIndex++];
            const surfaceEnd = firstSurfaceOffs + secView.getUint32(surfaceDefinitionTableIdx + 0x00);
            surfaceDefinitionTableIdx += 0x04;

            const centerX = secView.getFloat32(surfaceOffs + 0x00);
            const centerY = secView.getFloat32(surfaceOffs + 0x04);
            const centerZ = secView.getFloat32(surfaceOffs + 0x08);
            const mantissa = secView.getUint16(surfaceOffs + 0x0C);
            const displayListSizeExceptNotReally = secView.getUint16(surfaceOffs + 0x0E);
            const skinMatrixBankIndex = secView.getUint16(surfaceOffs + 0x18);
            const materialIndex = secView.getUint16(surfaceOffs + 0x1A);
            const visibilityGroupIndex = secView.getUint8(surfaceOffs + 0x1D);
            const uvArrayIndex = secView.getUint8(surfaceOffs + 0x1E);
            const extraDataSize = secView.getUint8(surfaceOffs + 0x1F);

            // Build our vertex format.
            const material: Material_MP3 = <Material_MP3> materialSet.materials[materialIndex];
            const vtxAttrFormat = material.vtxAttrFormat;

            const surfaceHeaderEnd = surfaceOffs + 0x20 + extraDataSize;
            const primitiveDataOffs = align(surfaceHeaderEnd, 32);

            const vcd: GX_VtxDesc[] = [];
            for (const format of vtxAttrFormats) {
                if (!(vtxAttrFormat & format.mask))
                    continue;
                vcd[format.vtxAttrib] = { type: GX.AttrType.INDEX16 };
            }

            const vtxArrays: GX_Array[] = [];
            vtxArrays[GX.VertexAttribute.POS]  = { buffer: secBuffer, offs: posSectionOffs };
            vtxArrays[GX.VertexAttribute.NRM]  = { buffer: secBuffer, offs: nrmSectionOffs };
            vtxArrays[GX.VertexAttribute.CLR0] = { buffer: secBuffer, offs: clrSectionOffs };
            vtxArrays[GX.VertexAttribute.CLR1] = { buffer: secBuffer, offs: clrSectionOffs };

            const vatFormat: GX_VtxAttrFmt[] = [];
            vatFormat[GX.VertexAttribute.POS]  = { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift: 0 };
            vatFormat[GX.VertexAttribute.NRM]  = { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.F32, compShift: 0 };
            vatFormat[GX.VertexAttribute.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift: 0 };
            vatFormat[GX.VertexAttribute.CLR1] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift: 0 };

            // TODO(jstpierre): I assume in the real came this comes from the different VAT formats.
            const isShort = (uvArrayIndex === 1);
            for (let i = 0; i < 8; i++) {
                vatFormat[GX.VertexAttribute.TEX0 + i] = { compCnt: GX.CompCnt.TEX_ST, compType: isShort ? GX.CompType.S16 : GX.CompType.F32, compShift: Math.log2(0x2000) };
                vtxArrays[GX.VertexAttribute.TEX0 + i] = { buffer: secBuffer, offs: isShort ? uvsSectionOffs : uvfSectionOffs };
            }

            const vatFormats: GX_VtxAttrFmt[][] = [vatFormat, vatFormat, vatFormat, vatFormat];
            const vtxLoader = compileVtxLoaderMultiVat(vatFormats, vcd);
            const loadedVertexLayout = vtxLoader.loadedVertexLayout;
            const dlData = secBuffer.slice(primitiveDataOffs, surfaceEnd);
            const loadedVertexData = vtxLoader.runVertices(vtxArrays, dlData);

            surfaces.push({ materialIndex, loadedVertexData, loadedVertexLayout });
        }

        const geometry: Geometry = { surfaces };
        const modelMatrix = mat4.create();
        worldModels.push({ geometry, bbox, modelMatrix });
    }

    return { materialSet, worldModels };
}

export function parse(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): MREA {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0xDEADBEEF);
    const version = view.getUint32(0x04);

    // Metroid Prime 1
    if (version === 0x0F)
        return parse_MP1(resourceSystem, assetID, buffer);

    // Donkey Kong Country Returns
    if (version === 0x20)
        return parse_DKCR(resourceSystem, assetID, buffer);

    throw "whoops";
}
