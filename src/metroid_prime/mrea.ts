
// Implements Retro's MREA format as seen in Metroid Prime 1.

import * as GX_Material from 'gx/gx_material';
import * as GX from 'gx/gx_enum';

import { TXTR } from './txtr';

import { ResourceSystem } from "./resource";
import { assert, readString, align } from "../util";
import ArrayBufferSlice from 'ArrayBufferSlice';
import { compileVtxLoader, compileVtxLoaderMultiVat, GX_VtxDesc, GX_VtxAttrFmt, GX_Array, LoadedVertexData, LoadedVertexLayout } from '../gx/gx_displaylist';
import { AABB } from '../Camera';

export interface MREA {
    materialSet: MaterialSet;
    worldModels: WorldModel[];
}

const enum UVAnimationType {
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
    offsetA: number;
    offsetB: number;
    scaleA: number;
    scaleB: number;
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

type UVAnimation = UVAnimation_Mat | UVAnimation_UVScroll | UVAnimation_Rotation | UVAnimation_Flipbook | UVAnimation_Cylinder;

export interface Material {
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
    UV_SHORT       = 0x2000,
    HAS_INDTX_REFL = 0x4000,
}

function parseMaterialSet(resourceSystem: ResourceSystem, buffer: ArrayBufferSlice, offs: number): MaterialSet {
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

        const uvAnimations: UVAnimation[] = [];
        const uvAnimationsSize = view.getUint32(offs + 0x00)
        const uvAnimationsCount = view.getUint32(offs + 0x04);
        offs += 0x08;
        for (let j = 0; j < uvAnimationsCount; j++) {
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
                const offsetA = view.getUint32(offs + 0x00);
                const offsetB = view.getUint32(offs + 0x04);
                const scaleA = view.getUint32(offs + 0x08);
                const scaleB = view.getUint32(offs + 0x0C);
                uvAnimations.push({ type, offsetA, offsetB, scaleA, scaleB });
                offs += 0x10;
                break;
            }
            case UVAnimationType.ROTATION: {
                const offset = view.getUint32(offs + 0x00);
                const scale = view.getUint32(offs + 0x04);
                uvAnimations.push({ type, offset, scale });
                offs += 0x08;
                break;
            }
            case UVAnimationType.FLIPBOOK_U:
            case UVAnimationType.FLIPBOOK_V: {
                const scale = view.getUint32(offs + 0x00);
                const numFrames = view.getUint32(offs + 0x04);
                const step = view.getUint32(offs + 0x08);
                const offset = view.getUint32(offs + 0x0C);
                uvAnimations.push({ type, scale, numFrames, step, offset });
                offs += 0x10;
                break;
            }
            case UVAnimationType.CYLINDER: {
                const theta = view.getUint32(offs + 0x00);
                const phi = view.getUint32(offs + 0x04);
                uvAnimations.push({ type, theta, phi });
                offs += 0x08;
                break;
            }
            }
        }

        const index = i;
        const translucent = flags & MaterialFlags.IS_TRANSPARENT;

        const name = `PrimeGen_${i}`;
        const cullMode = GX.CullMode.BACK;

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
            type: translucent ? GX.BlendMode.BLEND : GX.BlendMode.NONE,
            srcFactor: blendSrcFactor,
            dstFactor: blendDstFactor,
            logicOp: GX.LogicOp.CLEAR,
        };

        const ropInfo: GX_Material.RopInfo = {
            blendMode,
            depthTest: true,
            depthFunc: GX.CompareType.LESS,
            depthWrite: (!!(flags & MaterialFlags.DEPTH_WRITE)) && !translucent,
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

        materials.push({ flags, groupIndex, textureIndexes, vtxAttrFormat, gxMaterial, uvAnimations });
        assert((offs - materialsStart) === materialEndTable[i]);
    }

    return { textures, textureRemapTable, materials };
}

export const vtxAttrFormats = [
    { vtxAttrib: GX.VertexAttribute.POS,  mask: 0x00000003, compCount: 3 },
    { vtxAttrib: GX.VertexAttribute.NRM,  mask: 0x0000000C, compCount: 3 },
    { vtxAttrib: GX.VertexAttribute.CLR0, mask: 0x00000030, compCount: 4 },
    { vtxAttrib: GX.VertexAttribute.CLR1, mask: 0x000000C0, compCount: 4 },
    { vtxAttrib: GX.VertexAttribute.TEX0, mask: 0x00000300, compCount: 2 },
    { vtxAttrib: GX.VertexAttribute.TEX1, mask: 0x00000C00, compCount: 2 },
    { vtxAttrib: GX.VertexAttribute.TEX2, mask: 0x00003000, compCount: 2 },
    { vtxAttrib: GX.VertexAttribute.TEX3, mask: 0x0000C000, compCount: 2 },
    { vtxAttrib: GX.VertexAttribute.TEX4, mask: 0x00030000, compCount: 2 },
    { vtxAttrib: GX.VertexAttribute.TEX5, mask: 0x000C0000, compCount: 2 },
    { vtxAttrib: GX.VertexAttribute.TEX6, mask: 0x00300000, compCount: 2 },
];

export interface Surface {
    materialIndex: number;
    loadedVertexData: LoadedVertexData;
    loadedVertexLayout: LoadedVertexLayout;
}

export interface WorldModel {
    geometry: Geometry;
    bbox: AABB;
}

export interface Geometry {
    surfaces: Surface[];
}

interface SectionTables {
    dataSectionOffsTable: number[];
    dataSectionSizeTable: number[];
}

function parseGeometry(resourceSystem: ResourceSystem, buffer: ArrayBufferSlice, materialSet: MaterialSet, sectionTables: SectionTables, sectionIndex: number): [Geometry, number] {
    const sectionOffsTable = sectionTables.dataSectionOffsTable;
    const sectionSizeTable = sectionTables.dataSectionSizeTable;

    const view = buffer.createDataView();

    const posSectionOffs = sectionOffsTable[sectionIndex++];
    const nrmSectionOffs = sectionOffsTable[sectionIndex++];
    const clrSectionOffs = sectionOffsTable[sectionIndex++];
    const uvfSectionOffs = sectionOffsTable[sectionIndex++];
    const uvsSectionOffs = sectionOffsTable[sectionIndex++];

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

export function parse(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): MREA {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0xDEADBEEF);
    const version = view.getUint32(0x04);
    assert(version === 0x0F);

    // 0x10 - 0x34: Transform matrix

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

    // Now do geometry.
    const sectionTables = { dataSectionOffsTable, dataSectionSizeTable };

    let geometrySectionIndex = worldGeometrySectionIndex + 1;
    const worldModels: WorldModel[] = [];
    for (let i = 0; i < worldModelCount; i++) {
        // World model header.
        let worldModelHeaderOffs = dataSectionOffsTable[geometrySectionIndex];
        const visorFlags = view.getUint32(worldModelHeaderOffs + 0x00);
        worldModelHeaderOffs += 4 * 12; // World transform matrix
        const bboxMinX = view.getFloat32(worldModelHeaderOffs + 0x00);
        const bboxMinY = view.getFloat32(worldModelHeaderOffs + 0x04);
        const bboxMinZ = view.getFloat32(worldModelHeaderOffs + 0x08);
        const bboxMaxX = view.getFloat32(worldModelHeaderOffs + 0x0C);
        const bboxMaxY = view.getFloat32(worldModelHeaderOffs + 0x10);
        const bboxMaxZ = view.getFloat32(worldModelHeaderOffs + 0x14);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
        worldModelHeaderOffs += 0x14;

        geometrySectionIndex += 1;

        let geometry: Geometry;
        [geometry, geometrySectionIndex] = parseGeometry(resourceSystem, buffer, materialSet, sectionTables, geometrySectionIndex);
        worldModels.push({ geometry, bbox });
    }

    return { materialSet, worldModels };
}
