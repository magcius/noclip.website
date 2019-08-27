
// Implements Retro's MREA format as seen in Metroid Prime 1.

import * as GX_Material from '../gx/gx_material';
import * as GX from '../gx/gx_enum';

import * as Script from './script';
import * as Collision from './collision';
import { InputStream } from './stream'
import { TXTR } from './txtr';

import { ResourceSystem } from "./resource";
import { assert, readString, align } from "../util";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { compileVtxLoaderMultiVat, GX_VtxDesc, GX_VtxAttrFmt, GX_Array, LoadedVertexData, LoadedVertexLayout, VtxLoader, compileVtxLoader } from '../gx/gx_displaylist';
import { mat4, vec3 } from 'gl-matrix';
import * as Pako from 'pako';
import { AABB } from '../Geometry';
import { colorFromRGBA8 } from '../Color';
import { MathConstants } from '../MathHelpers';

export interface MREA {
    materialSet: MaterialSet;
    worldModels: WorldModel[];
    scriptLayers: Script.ScriptLayer[];
    collision: Collision.AreaCollision;
    lightLayers: AreaLightLayer[];
}

enum AreaVersion {
    MP1 = 0xF,
    MP2 = 0x19,
    MP3 = 0x1E,
    DKCR = 0x20
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
    colorRegisters: GX_Material.Color[];
    colorConstants: GX_Material.Color[];
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
    ALPHA_TEST     = 0x0020,
    HAS_SAMUS_REFL = 0x0040,
    DEPTH_WRITE    = 0x0080,
    OCCLUDER       = 0x0200,
    HAS_INDTX_REFL = 0x0400,
    UV_SHORT       = 0x2000,
}

function parseMaterialSet_UVAnimations(stream: InputStream, count: number): UVAnimation[] {
    const uvAnimations: UVAnimation[] = [];

    for (let i = 0; i < count; i++) {
        const type: UVAnimationType = stream.readUint32();

        switch (type) {
        case UVAnimationType.INV_MAT_SKY:
        case UVAnimationType.INV_MAT:
        case UVAnimationType.MODEL_MAT:
            uvAnimations.push({ type });
            // These guys have no parameters.
            break;
        case UVAnimationType.UV_SCROLL: {
            const offsetS = stream.readFloat32();
            const offsetT = stream.readFloat32();
            const scaleS = stream.readFloat32();
            const scaleT = stream.readFloat32();
            uvAnimations.push({ type, offsetS, offsetT, scaleS, scaleT });
            break;
        }
        case UVAnimationType.ROTATION: {
            const offset = stream.readFloat32();
            const scale = stream.readFloat32();
            uvAnimations.push({ type, offset, scale });
            break;
        }
        case UVAnimationType.FLIPBOOK_U:
        case UVAnimationType.FLIPBOOK_V: {
            const scale = stream.readFloat32();
            const numFrames = stream.readFloat32();
            const step = stream.readFloat32();
            const offset = stream.readFloat32();
            uvAnimations.push({ type, scale, numFrames, step, offset });
            break;
        }
        case UVAnimationType.CYLINDER: {
            const theta = stream.readFloat32();
            const phi = stream.readFloat32();
            uvAnimations.push({ type, theta, phi });
            break;
        }
        case 0x08: {
            // Unknown (DKCR)
            stream.skip(0x24);
            break;
        }
        }
    }

    return uvAnimations;
}

export function parseMaterialSet(stream: InputStream, resourceSystem: ResourceSystem, isEchoes: boolean): MaterialSet {
    const textureCount = stream.readUint32();
    const textures: TXTR[] = [];
    const textureRemapTable: number[] = [];
    for (let i = 0; i < textureCount; i++) {
        const materialTXTRID = stream.readAssetID();
        const txtr: TXTR = resourceSystem.loadAssetByID(materialTXTRID, 'TXTR');
        const txtrIndex = textures.indexOf(txtr);
        if (txtrIndex >= 0) {
            textureRemapTable.push(txtrIndex);
        } else {
            const newIndex = textures.push(txtr) - 1;
            textureRemapTable.push(newIndex);
        }
    }

    const materialCount = stream.readUint32();
    const materialEndTable: number[] = [];
    for (let i = 0; i < materialCount; i++) {
        const materialEndOffs = stream.readUint32();
        materialEndTable.push(materialEndOffs);
    }

    const materialsStart = stream.tell();
    const materials: Material[] = [];
    for (let i = 0; i < materialCount; i++) {
        const flags: MaterialFlags = stream.readUint32();
        const textureIndexCount = stream.readUint32();

        const textureIndexes: number[] = [];
        assert(textureIndexCount < 8);
        for (let j = 0; j < textureIndexCount; j++) {
            const textureIndex = stream.readUint32();
            textureIndexes.push(textureIndex);
        }

        const vtxAttrFormat = stream.readUint32();

        if (isEchoes) {
            stream.skip(8);
        }

        const groupIndex = stream.readUint32();

        let colorConstants: GX_Material.Color[] = [];

        if (flags & MaterialFlags.HAS_KONST) {
            const konstCount = stream.readUint32();

            for (let j = 0; j < konstCount; j++) {
                const r = stream.readUint8() / 255;
                const g = stream.readUint8() / 255;
                const b = stream.readUint8() / 255;
                const a = stream.readUint8() / 255;
                colorConstants.push(new GX_Material.Color(r, g, b, a));
            }
        }

        for (let j = colorConstants.length; j < 4; j++) {
            // Push default colors.
            // XXX(jstpierre): Should this stuff be moved outside GXMaterial?
            colorConstants.push(new GX_Material.Color(0, 0, 0, 0));
        }

        const blendDstFactor: GX.BlendFactor = stream.readUint16();
        const blendSrcFactor: GX.BlendFactor = stream.readUint16();

        if (flags & MaterialFlags.HAS_INDTX_REFL) {
            const reflectionIndtexSlot = stream.readUint32();
        }

        const colorChannelFlagsTableCount = stream.readUint32();
        assert(colorChannelFlagsTableCount <= 4);

        const lightChannels: GX_Material.LightChannelControl[] = [];
        // Only color channel 1 is stored in the format.
        for (let j = 0; j < 1; j++) {
            const colorChannelFlags = stream.readUint32();
            const lightingEnabled = !!(colorChannelFlags & 0x01);
            const ambColorSource: GX.ColorSrc = (colorChannelFlags >>> 1) & 0x01;
            const matColorSource: GX.ColorSrc = (colorChannelFlags >>> 2) & 0x01;
            const diffuseFunction: GX.DiffuseFunction = (colorChannelFlags >>> 11) & 0x03;
            const attenuationFunction: GX.AttenuationFunction = (colorChannelFlags >>> 13) & 0x03;

            const colorChannel = { lightingEnabled, ambColorSource, matColorSource, litMask: 0xFF, diffuseFunction, attenuationFunction };
            // XXX(jstpierre): What's with COLOR0A0?
            const alphaChannel = { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE };
            lightChannels.push({ colorChannel, alphaChannel });
        }
        stream.skip(0x04 * (colorChannelFlagsTableCount-1));

        // Fake other channel.
        lightChannels.push({
            colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
        });

        const tevStageCount = stream.readUint32();
        assert(tevStageCount <= 8);
        let tevOrderTableOffs = stream.tell() + tevStageCount * 0x14;

        const tevStages: GX_Material.TevStage[] = [];
        for (let j = 0; j < tevStageCount; j++) {
            const colorInputSel = stream.readUint32();
            const alphaInputSel = stream.readUint32();
            const colorCombineFlags = stream.readUint32();
            const alphaCombineFlags = stream.readUint32();

            stream.skip(1);
            const konstAlphaSel: GX.KonstAlphaSel = stream.readUint8();
            const konstColorSel: GX.KonstColorSel = stream.readUint8();
            const channelId: GX.RasColorChannelID = GX_Material.getRasColorChannelID(stream.readUint8());

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

            let curOffs = stream.tell();
            stream.goTo(tevOrderTableOffs + 0x2);
            const texMap: number = stream.readUint8();
            const texCoordId: GX.TexCoordID = stream.readUint8();
            stream.goTo(curOffs);
            tevOrderTableOffs += 4;

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
        }

        // Skip past TEV order table.
        stream.goTo(tevOrderTableOffs);

        const texGenCount = stream.readUint32();
        assert(texGenCount <= 8);

        const texGens: GX_Material.TexGen[] = [];
        for (let j = 0; j < texGenCount; j++) {
            const index = j;
            const flags = stream.readUint32();
            const type: GX.TexGenType = (flags >>> 0) & 0x0F;
            const source: GX.TexGenSrc = (flags >>> 4) & 0x0F;
            const matrix: GX.TexGenMatrix = ((flags >>> 9) & 0x1F) + 30;

            const normalize: boolean = !!((flags >>> 14) & 0x01);
            const postMatrix: GX.PostTexGenMatrix = ((flags >>> 15) & 0x3F) + 64;

            texGens.push({ index, type, source, matrix, normalize, postMatrix });
        }

        const uvAnimationsSize = stream.readUint32(); - 0x04;
        const uvAnimationsCount = stream.readUint32();

        const uvAnimations: UVAnimation[] = parseMaterialSet_UVAnimations(stream, uvAnimationsCount);
        const index = i;

        const name = `PrimeGen_${i}`;
        const cullMode = GX.CullMode.FRONT;

        const isTransparent = !!(flags & MaterialFlags.IS_TRANSPARENT);
        const isOccluder = !!(flags & MaterialFlags.OCCLUDER);
        const depthWrite = !!(flags & MaterialFlags.DEPTH_WRITE);
        const useAlphaTest = !!(flags & MaterialFlags.ALPHA_TEST);

        const colorRegisters: GX_Material.Color[] = [];
        colorRegisters.push(new GX_Material.Color(0, 0, 0, 0));
        colorRegisters.push(new GX_Material.Color(1, 1, 1, 0));
        colorRegisters.push(new GX_Material.Color(1, 1, 1, 0));
        colorRegisters.push(new GX_Material.Color(0, 0, 0, 0));

        const alphaTest: GX_Material.AlphaTest = {
            op: GX.AlphaOp.OR,
            compareA: useAlphaTest ? GX.CompareType.GREATER : GX.CompareType.ALWAYS,
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
            lightChannels,
            texGens,
            tevStages,
            alphaTest,
            ropInfo,
            indTexStages: [],
        };

        materials.push({
            isOccluder,
            isTransparent,
            flags,
            groupIndex,
            textureIndexes,
            vtxAttrFormat,
            gxMaterial,
            uvAnimations,
            colorRegisters,
            colorConstants,
         });
        assert((stream.tell() - materialsStart) === materialEndTable[i]);
    }

    return { textures, textureRemapTable, materials };
}

export const vtxAttrFormats = [
    { vtxAttrib: GX.VertexAttribute.PNMTXIDX,   type: GX.AttrType.DIRECT, mask: 0x01000000 },
    { vtxAttrib: GX.VertexAttribute.TEX0MTXIDX, type: GX.AttrType.DIRECT, mask: 0x02000000 },
    { vtxAttrib: GX.VertexAttribute.TEX1MTXIDX, type: GX.AttrType.DIRECT, mask: 0x04000000 },
    { vtxAttrib: GX.VertexAttribute.TEX2MTXIDX, type: GX.AttrType.DIRECT, mask: 0x08000000 },
    { vtxAttrib: GX.VertexAttribute.TEX3MTXIDX, type: GX.AttrType.DIRECT, mask: 0x10000000 },
    { vtxAttrib: GX.VertexAttribute.TEX4MTXIDX, type: GX.AttrType.DIRECT, mask: 0x20000000 },
    { vtxAttrib: GX.VertexAttribute.TEX5MTXIDX, type: GX.AttrType.DIRECT, mask: 0x40000000 },
    { vtxAttrib: GX.VertexAttribute.TEX6MTXIDX, type: GX.AttrType.DIRECT, mask: 0x80000000 },
    { vtxAttrib: GX.VertexAttribute.POS,  type: GX.AttrType.INDEX16, mask: 0x00000003 },
    { vtxAttrib: GX.VertexAttribute.NRM,  type: GX.AttrType.INDEX16, mask: 0x0000000C },
    { vtxAttrib: GX.VertexAttribute.CLR0, type: GX.AttrType.INDEX16, mask: 0x00000030 },
    { vtxAttrib: GX.VertexAttribute.CLR1, type: GX.AttrType.INDEX16, mask: 0x000000C0 },
    { vtxAttrib: GX.VertexAttribute.TEX0, type: GX.AttrType.INDEX16, mask: 0x00000300 },
    { vtxAttrib: GX.VertexAttribute.TEX1, type: GX.AttrType.INDEX16, mask: 0x00000C00 },
    { vtxAttrib: GX.VertexAttribute.TEX2, type: GX.AttrType.INDEX16, mask: 0x00003000 },
    { vtxAttrib: GX.VertexAttribute.TEX3, type: GX.AttrType.INDEX16, mask: 0x0000C000 },
    { vtxAttrib: GX.VertexAttribute.TEX4, type: GX.AttrType.INDEX16, mask: 0x00030000 },
    { vtxAttrib: GX.VertexAttribute.TEX5, type: GX.AttrType.INDEX16, mask: 0x000C0000 },
    { vtxAttrib: GX.VertexAttribute.TEX6, type: GX.AttrType.INDEX16, mask: 0x00300000 },
];

export interface Surface {
    materialIndex: number;
    loadedVertexData: LoadedVertexData;
    loadedVertexLayout: LoadedVertexLayout;
    worldModelIndex: number;
}

export interface WorldModel {
    geometry: Geometry;
    modelMatrix: mat4;
    bbox: AABB;
}

export interface Geometry {
    surfaces: Surface[];
}

export function parseWorldModelHeader(stream: InputStream): [number, mat4, AABB] {
    const visorFlags = stream.readUint32();
    const m00 = stream.readFloat32();
    const m01 = stream.readFloat32();
    const m02 = stream.readFloat32();
    const m03 = stream.readFloat32();
    const m10 = stream.readFloat32();
    const m11 = stream.readFloat32();
    const m12 = stream.readFloat32();
    const m13 = stream.readFloat32();
    const m20 = stream.readFloat32();
    const m21 = stream.readFloat32();
    const m22 = stream.readFloat32();
    const m23 = stream.readFloat32();
    const modelMatrix = mat4.fromValues(
        m00, m10, m20, 0.0,
        m01, m11, m21, 0.0,
        m02, m12, m22, 0.0,
        m03, m13, m23, 1.0,
    );
    const bboxMinX = stream.readFloat32();
    const bboxMinY = stream.readFloat32();
    const bboxMinZ = stream.readFloat32();
    const bboxMaxX = stream.readFloat32();
    const bboxMaxY = stream.readFloat32();
    const bboxMaxZ = stream.readFloat32();
    const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

    return [visorFlags, modelMatrix, bbox];
}

function parseWorldModels_MP1(stream: InputStream, worldModelCount: number, sectionIndex: number, sectionOffsTable: number[], materialSet: MaterialSet, version: number): WorldModel[] {
    let worldModels: WorldModel[] = [];

    for (let i = 0; i < worldModelCount; i++) {
        // World model header.
        const worldModelHeaderOffs = sectionOffsTable[sectionIndex++];
        stream.goTo(worldModelHeaderOffs);

        let visorFlags: number, modelMatrix: mat4, bbox: AABB;
        [visorFlags, modelMatrix, bbox] = parseWorldModelHeader(stream);

        const worldModelIndex = worldModels.length;
        let geometry: Geometry;

        [geometry, sectionIndex] = parseGeometry(stream, materialSet, sectionOffsTable, true, version >= AreaVersion.MP2, sectionIndex, worldModelIndex);

        worldModels.push({ geometry, modelMatrix, bbox });
    }

    return worldModels;
}

function parseWorldModels_MP3(stream: InputStream, worldModelCount: number, wobjSectionIndex: number, gpudSectionIndex: number, sectionOffsTable: number[], materialSet: MaterialSet, version: number): WorldModel[] {
    let worldModels: WorldModel[] = [];

    for (let i = 0; i < worldModelCount; i++) {
        // World model header.
        const worldModelHeaderOffs = sectionOffsTable[wobjSectionIndex++];
        stream.goTo(worldModelHeaderOffs);

        let visorFlags: number, modelMatrix: mat4, bbox: AABB;
        [visorFlags, modelMatrix, bbox] = parseWorldModelHeader(stream);

        const worldModelIndex = worldModels.length;
        let geometry: Geometry;

        [geometry, wobjSectionIndex, gpudSectionIndex] = parseGeometry_MP3(stream, materialSet, sectionOffsTable, version === AreaVersion.DKCR, wobjSectionIndex, gpudSectionIndex, worldModelIndex);

        worldModels.push({ geometry, modelMatrix, bbox });
    }

    return worldModels;
}

export function parseSurfaces(  stream: InputStream,
                                surfaceCount: number,
                                sectionIndex: number,
                                posSectionOffs: number,
                                nrmSectionOffs: number,
                                clrSectionOffs: number,
                                uvfSectionOffs: number,
                                uvsSectionOffs: number,
                                sectionOffsTable: number[],
                                worldModelIndex: number,
                                materialSet: MaterialSet,
                                isEchoes: boolean
                            ): [Surface[], number]
{
    function fillVatFormat(nrmType: GX.CompType, tex0Type: GX.CompType, compShift: number): GX_VtxAttrFmt[] {
        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.VertexAttribute.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift };
        vatFormat[GX.VertexAttribute.NRM] = { compCnt: GX.CompCnt.NRM_XYZ, compType: nrmType, compShift: 14 };
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

    let surfaces: Surface[] = [];

    for (let i = 0; i < surfaceCount; i++) {
        const surfaceOffs = sectionOffsTable[sectionIndex];
        const surfaceEnd = sectionOffsTable[sectionIndex+1];
        stream.goTo(surfaceOffs);

        const centerX = stream.readFloat32();
        const centerY = stream.readFloat32();
        const centerZ = stream.readFloat32();
        const materialIndex = stream.readUint32();
        const mantissa = stream.readUint16();
        const displayListSizeExceptNotReally = stream.readUint16();
        stream.skip(8);
        const extraDataSize = stream.readUint32();
        const normalX = stream.readFloat32();
        const normalY = stream.readFloat32();
        const normalZ = stream.readFloat32();

        if (isEchoes) {
            stream.skip(4);
        }

        stream.skip(extraDataSize);
        stream.align(32);
        const primitiveDataOffs = stream.tell();

        // Build our vertex format.
        const material = materialSet.materials[materialIndex];
        const vtxAttrFormat = material.vtxAttrFormat;

        const vat: GX_VtxAttrFmt[][] = [];

        const useUvsArray = (material.flags & MaterialFlags.UV_SHORT);

        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.VertexAttribute.POS]  = { buffer: stream.getBuffer(), offs: posSectionOffs };
        vtxArrays[GX.VertexAttribute.NRM]  = { buffer: stream.getBuffer(), offs: nrmSectionOffs };
        vtxArrays[GX.VertexAttribute.CLR0] = { buffer: stream.getBuffer(), offs: clrSectionOffs };
        vtxArrays[GX.VertexAttribute.CLR1] = { buffer: stream.getBuffer(), offs: clrSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX0] = { buffer: stream.getBuffer(), offs: useUvsArray ? uvsSectionOffs : uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX1] = { buffer: stream.getBuffer(), offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX2] = { buffer: stream.getBuffer(), offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX3] = { buffer: stream.getBuffer(), offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX4] = { buffer: stream.getBuffer(), offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX5] = { buffer: stream.getBuffer(), offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX6] = { buffer: stream.getBuffer(), offs: uvfSectionOffs };
        vtxArrays[GX.VertexAttribute.TEX7] = { buffer: stream.getBuffer(), offs: uvfSectionOffs };

        const vcd: GX_VtxDesc[] = [];
        for (const format of vtxAttrFormats) {
            if (!(vtxAttrFormat & format.mask))
                continue;
            vcd[format.vtxAttrib] = { type: format.type, enableOutput: (format.mask <=0x00FFFFFF) };
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
        const dlData = stream.getBuffer().slice(primitiveDataOffs, surfaceEnd);
        const loadedVertexLayout = vtxLoader.loadedVertexLayout;
        const loadedVertexData = vtxLoader.runVertices(vtxArrays, dlData);

        const surface: Surface = {
            materialIndex,
            worldModelIndex,
            loadedVertexData,
            loadedVertexLayout,
        };
        surfaces.push(surface);

        sectionIndex++;
    }

    return [surfaces, sectionIndex];
}

export function parseGeometry(stream: InputStream, materialSet: MaterialSet, sectionOffsTable: number[], hasUVShort: boolean, isEchoes: boolean, sectionIndex: number, worldModelIndex: number): [Geometry, number] {
    const posSectionOffs = sectionOffsTable[sectionIndex++];
    const nrmSectionOffs = sectionOffsTable[sectionIndex++];
    const clrSectionOffs = sectionOffsTable[sectionIndex++];
    const uvfSectionOffs = sectionOffsTable[sectionIndex++];
    const uvsSectionOffs = hasUVShort ? sectionOffsTable[sectionIndex++] : null;

    const surfaceTableOffs = sectionOffsTable[sectionIndex++];
    stream.goTo(surfaceTableOffs);
    const surfaceCount = stream.readUint32();

    let surfaces: Surface[];
    [surfaces, sectionIndex] = parseSurfaces(stream, surfaceCount, sectionIndex, posSectionOffs, nrmSectionOffs, clrSectionOffs, uvfSectionOffs, uvsSectionOffs, sectionOffsTable, worldModelIndex, materialSet, isEchoes);

    const geometry: Geometry = { surfaces };
    return [geometry, sectionIndex];
}

export function parseGeometry_MP3(stream: InputStream, materialSet: MaterialSet, sectionOffsTable: number[], hasUVShort: boolean, wobjSectionIndex: number, gpudSectionIndex: number, worldModelIndex: number): [Geometry, number, number] {
    const posSectionOffs = sectionOffsTable[gpudSectionIndex++];
    const nrmSectionOffs = sectionOffsTable[gpudSectionIndex++];
    const clrSectionOffs = sectionOffsTable[gpudSectionIndex++];
    const uvfSectionOffs = sectionOffsTable[gpudSectionIndex++];
    const uvsSectionOffs = hasUVShort ? sectionOffsTable[gpudSectionIndex++] : null;

    const surfaceTableOffs = sectionOffsTable[wobjSectionIndex++];
    stream.goTo(surfaceTableOffs);
    const surfaceCount = stream.readUint32();
    wobjSectionIndex += 2;

    let surfaces: Surface[];
    [surfaces, gpudSectionIndex] = parseSurfaces(stream, surfaceCount, gpudSectionIndex, posSectionOffs, nrmSectionOffs, clrSectionOffs, uvfSectionOffs, uvsSectionOffs, sectionOffsTable, worldModelIndex, materialSet, true);

    const geometry: Geometry = { surfaces };
    return [geometry, wobjSectionIndex, gpudSectionIndex];
}

export const enum AreaLightType {
    LocalAmbient = 0,
    Directional = 1,
    Custom = 2,
    Spot = 3
}

export class AreaLight {
    public type: AreaLightType = AreaLightType.Custom;
    public radius: number = 0;
    public castShadows: boolean = false;
    public gxLight = new GX_Material.Light();
}

export interface AreaLightLayer {
    lights: AreaLight[];
    ambientColor: GX_Material.Color;
}

export interface EntityLights {
    lights: AreaLight[];
    ambientColor: GX_Material.Color;
}

export function parseLightLayer(stream: InputStream, version: number): AreaLightLayer {
    let ambientColor: GX_Material.Color = new GX_Material.Color;
    const epsilon = 1.192092896e-07;

    const lights: AreaLight[] = [];
    const lightCount = stream.readUint32();

    for (let i=0; i<lightCount; i++) {
        const lightType = stream.readUint32();
        const lightColorR = stream.readFloat32();
        const lightColorG = stream.readFloat32();
        const lightColorB = stream.readFloat32();
        if (version >= AreaVersion.MP3) stream.skip(0x4); // color alpha
        const posX = stream.readFloat32();
        const posY = stream.readFloat32();
        const posZ = stream.readFloat32();
        const dirX = stream.readFloat32();
        const dirY = stream.readFloat32();
        const dirZ = stream.readFloat32();
        if (version >= AreaVersion.MP3) stream.skip(0xC); // codirection
        const brightness = stream.readFloat32();
        const spotCutoff = stream.readFloat32() / 2;
        stream.skip(0x4);
        const castShadows = stream.readBool();
        stream.skip(0x4);
        const falloffType = stream.readUint32();
        stream.skip(0x4);
        if (version >= AreaVersion.MP3) stream.skip(0x14); // unknown data

        if (lightType == AreaLightType.LocalAmbient) {
            ambientColor.r = Math.min(lightColorR * brightness, 1);
            ambientColor.g = Math.min(lightColorG * brightness, 1);
            ambientColor.b = Math.min(lightColorB * brightness, 1);
            ambientColor.a = 1;
        } else {
            const light = new AreaLight();
            light.type = lightType;
            light.castShadows = castShadows;
            light.gxLight.Color.r = lightColorR;
            light.gxLight.Color.g = lightColorG;
            light.gxLight.Color.b = lightColorB;
            light.gxLight.Color.a = 1;
            vec3.set(light.gxLight.Position, posX, posY, posZ);
            vec3.set(light.gxLight.Direction, dirX, dirY, dirZ);
            vec3.normalize(light.gxLight.Direction, light.gxLight.Direction);
            vec3.negate(light.gxLight.Direction, light.gxLight.Direction);

            if (lightType == AreaLightType.Directional) {
                vec3.set(light.gxLight.DistAtten, 1, 0, 0);
                vec3.set(light.gxLight.CosAtten, 1, 0, 0);
            }
            else {
                const distAttenA = (falloffType == 0) ? (2.0 / brightness) : 0;
                const distAttenB = (falloffType == 1) ? (250.0 / brightness) : 0;
                const distAttenC = (falloffType == 2) ? (25000.0 / brightness) : 0;
                vec3.set(light.gxLight.DistAtten, distAttenA, distAttenB, distAttenC);

                if (lightType == AreaLightType.Spot) {

                    // Calculate angle atten
                    if (spotCutoff < 0 || spotCutoff > 90) {
                        vec3.set(light.gxLight.CosAtten, 1, 0, 0);
                    } else {
                        const radCutoff = spotCutoff * MathConstants.DEG_TO_RAD;
                        const cosCutoff = Math.cos(radCutoff);
                        const invCosCutoff = 1 - cosCutoff;
                        vec3.set(light.gxLight.CosAtten, 0, -cosCutoff / invCosCutoff, 1.0 / invCosCutoff);
                    }
                } else {
                    // All other values default to Custom (which are standard point lights)
                    vec3.set(light.gxLight.CosAtten, 1, 0, 0);
                }
            }
            
            // Calculate radius
            if (light.gxLight.DistAtten[1] < epsilon && light.gxLight.DistAtten[2] < epsilon) {
                // No distance attenuation curve, so the light is effectively a directional.
                light.radius = 3000000000000000000000000000000000000.0;
            } else {
                let intensity = Math.max(lightColorR, lightColorG, lightColorB);
                if (light.type === AreaLightType.Custom)
                    intensity *= light.gxLight.CosAtten[0];

                const lightRadAtten = 15.0/255.0;
                if (light.gxLight.DistAtten[2] > epsilon) {
                    if (intensity >= epsilon)
                        light.radius = Math.sqrt(intensity / (lightRadAtten * light.gxLight.DistAtten[2]));
                } else if (light.gxLight.DistAtten[1] > epsilon) {
                    light.radius = intensity / (lightRadAtten * light.gxLight.DistAtten[1]);
                }
            }

            lights.push(light);
        }
    }

    return { lights, ambientColor };
}


function decompressBuffers(stream: InputStream, compressedBlocksIdx: number, compressedBlockCount: number, usesLzo: boolean): Uint8Array {
    // TODO(jstpierre): Instead of decompressing blocks up-front, make something that can
    // decompress on-demand? We don't use a lot of data in here, so it might save some parse time...
    const decompressedSegments: Uint8Array[] = [];
    let totalDecompressedSize = 0;

    for (let i = 0; i < compressedBlockCount; i++) {
        const blockBufferSize = stream.readUint32();
        const blockDecompressedSize = stream.readUint32();
        const blockCompressedSize = stream.readUint32();
        const blockDataSectionCount = stream.readUint32();
        totalDecompressedSize += blockDecompressedSize;

        if (blockCompressedSize === 0) {
            // Uncompressed block.
            decompressedSegments.push(stream.getBuffer().createTypedArray(Uint8Array, compressedBlocksIdx, blockDecompressedSize));
            compressedBlocksIdx += blockDecompressedSize;
        } else {
            // Compressed block.

            // Padding is at the start of the block for some reason.
            const blockPadding = align(blockCompressedSize, 0x20) - blockCompressedSize;

            compressedBlocksIdx += blockPadding;
            stream.goTo(compressedBlocksIdx);

            let remainingSize = blockDecompressedSize;
            while (remainingSize > 0) {
                let segmentSize = stream.readInt16();
                compressedBlocksIdx += 0x02;
                if (segmentSize < 0) {
                    // Uncompressed segment.
                    segmentSize = -segmentSize;
                    decompressedSegments.push(stream.getBuffer().createTypedArray(Uint8Array, compressedBlocksIdx, segmentSize));
                    compressedBlocksIdx += segmentSize;
                    remainingSize -= segmentSize;
                } else {
                    // Compressed segment.
                    const compressedSegment = stream.getBuffer().createTypedArray(Uint8Array, compressedBlocksIdx, segmentSize);

                    if (!usesLzo) {
                        // zlib
                        const decompressedSegment = Pako.inflate(compressedSegment);
                        decompressedSegments.push(decompressedSegment);
                        compressedBlocksIdx += segmentSize;
                        remainingSize -= decompressedSegment.byteLength;
                    }
                    else {
                        // LZO1X
                        throw new Error("MREA data is compressed with LZO. This is currently unsupported.");
                    }
                }
            }
            compressedBlocksIdx += blockCompressedSize;
        }
    }

    // Combine buffers
    const totalBuffer = new Uint8Array(totalDecompressedSize);
    let idx = 0;
    for (let i = 0; i < decompressedSegments.length; i++) {
        totalBuffer.set(decompressedSegments[i], idx);
        idx += decompressedSegments[i].byteLength;
    }
    assert(idx === totalDecompressedSize);
    return totalBuffer;
}

function parse_MP1(stream: InputStream, resourceSystem: ResourceSystem): MREA {
    assert(stream.readUint32() === 0xDEADBEEF);
    const version = stream.readUint32();
    assert(version === AreaVersion.MP1 || version === AreaVersion.MP2 || version === AreaVersion.MP3);
    stream.assetIdLength = (version >= AreaVersion.MP3 ? 8 : 4);

    stream.skip(4*12); // Transform matrix

    const worldModelCount = stream.readUint32();
    let scriptLayerCount = ( version >= AreaVersion.MP2 ? stream.readUint32() : 0 );
    const dataSectionCount = stream.readUint32();

    let worldGeometrySectionIndex = -1;
    let worldGeometryGPUDataSectionIndex = -1;
    let scriptLayersSectionIndex = -1;
    let collisionSectionIndex = -1;
    let lightsSectionIndex = -1;

    if (version <= AreaVersion.MP2) {
        worldGeometrySectionIndex = stream.readUint32();
        scriptLayersSectionIndex = stream.readUint32();
        if (version >= AreaVersion.MP2) stream.skip(4);
        collisionSectionIndex = stream.readUint32();
        stream.skip(4);
        lightsSectionIndex = stream.readUint32();
        stream.skip( version === AreaVersion.MP2 ? 0x14 : 0xC );
    }

    const numCompressedBlocks = ( version >= AreaVersion.MP2 ? stream.readUint32() : 0 );
    const numSectionNumbers = ( version >= AreaVersion.MP3 ? stream.readUint32() : 0 );
    stream.align(32);

    const dataSectionSizeTable: number[] = [];
    for (let i = 0; i < dataSectionCount; i++) {
        const size = stream.readUint32();
        dataSectionSizeTable.push(size);
    }
    stream.align(32);

    // Decompress any compressed data
    let areaDataBuffer: ArrayBufferSlice = null;

    if (numCompressedBlocks > 0) {
        const compressedDataIdx = align(stream.tell() + align(numCompressedBlocks*16, 32) + align(numSectionNumbers*8, 32), 32);
        const decompressedBuffer = decompressBuffers(stream, compressedDataIdx, numCompressedBlocks, true);
        areaDataBuffer = new ArrayBufferSlice(decompressedBuffer.buffer);
        stream.align(32);
    }
    
    // Parse MP3 section numbers
    if (version >= AreaVersion.MP3) {
        for (let i = 0; i < numSectionNumbers; i++) {
            const sectionID = stream.readFourCC();
            const sectionNum = stream.  readUint32();

            switch (sectionID) {
                case "WOBJ": worldGeometrySectionIndex = sectionNum; break;
                case "GPUD": worldGeometryGPUDataSectionIndex = sectionNum; break;
                case "SOBJ": scriptLayersSectionIndex = sectionNum; break;
                case "COLI": collisionSectionIndex = sectionNum; break;
                case "LITE": lightsSectionIndex = sectionNum; break;
            }
        }
        stream.align(32);
    }

    // Continue on to parse area data
    if (areaDataBuffer !== null) {
        stream.setBuffer(areaDataBuffer);
    }

    const firstDataSectionOffs = stream.tell();
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
    stream.goTo(materialSectionOffs);
    let materialSet: MaterialSet;

    if (version < AreaVersion.MP3) {
        materialSet = parseMaterialSet(stream, resourceSystem, version === AreaVersion.MP2);
    }
    else {
        materialSet = parseMaterialSet_MP3(stream, resourceSystem);
    }

    // Parse out world models.
    let worldModels: WorldModel[];

    if (version < AreaVersion.MP3) {
        worldModels = parseWorldModels_MP1(stream, worldModelCount, worldGeometrySectionIndex+1, dataSectionOffsTable, materialSet, version);
    }
    else {
        worldModels = parseWorldModels_MP3(stream, worldModelCount, worldGeometrySectionIndex+1, worldGeometryGPUDataSectionIndex, dataSectionOffsTable, materialSet, version);
    }

    // Parse out script layers.
    const scriptLayers: Script.ScriptLayer[] = [];

    if (version === AreaVersion.MP1) {
        const scriptLayerOffs = dataSectionOffsTable[scriptLayersSectionIndex];
        stream.goTo(scriptLayerOffs);
        
        const sclyMagic = stream.readFourCC();
        const sclyVersion = stream.readUint32();
        assert(sclyMagic === 'SCLY');
        assert(sclyVersion === 1);

        scriptLayerCount = stream.readUint32();
        const scriptLayerSizes: number[] = [];

        for (let i = 0; i < scriptLayerCount; i++) {
            scriptLayerSizes.push(stream.readUint32());
        }

        for (let i = 0; i < scriptLayerCount; i++) {
            const layerEnd = stream.tell() + scriptLayerSizes[i];
            const layer = Script.parseScriptLayer_MP1(stream.getBuffer(), stream.tell(), resourceSystem);
            scriptLayers.push(layer);
            stream.goTo(layerEnd);
        }
    }
    else {
        let currentSection = scriptLayersSectionIndex;

        for (let i = 0; i < scriptLayerCount; i++) {
            const scriptLayerOffs = dataSectionOffsTable[currentSection];
            stream.goTo(scriptLayerOffs);
            currentSection++;

            const sclyMagic = stream.readFourCC();
            stream.skip(1);
            const sclyIndex = stream.readUint32();
            assert(sclyMagic == 'SCLY');
            assert(sclyIndex == i);

            const layer = Script.parseScriptLayer_MP2(stream, resourceSystem);
            scriptLayers.push(layer);
        }
    }

    // Parse out collision.
    const collisionOffs = dataSectionOffsTable[collisionSectionIndex];
    stream.goTo(collisionOffs);
    const collision = Collision.parseAreaCollision(stream);

    // Parse out lights.
    const lightOffs = dataSectionOffsTable[lightsSectionIndex];
    stream.goTo(lightOffs);

    const lightLayers: AreaLightLayer[] = [];
    const lightsMagic = stream.readUint32();
    assert(lightsMagic === 0xbabedead);

    const numLightLayers = (version <= AreaVersion.MP2 ? 2 :
                            version <= AreaVersion.MP3 ? 4 :
                            8);

    for (let i = 0; i < numLightLayers; i++) {
        const lightLayer: AreaLightLayer = parseLightLayer(stream, version);
        lightLayers.push(lightLayer);
    }

    return { materialSet, worldModels, scriptLayers, collision, lightLayers };
}

export const enum MaterialFlags_MP3 {
    BLEND = 0x08,
    MASKED = 0x10,
    ADDITIVE_BLEND = 0x20,
    OCCLUDER = 0x100,
    WHITE_AMB = 0x80000,
}

function makeTevStageFromPass_MP3(passIndex: number, passType: string, passFlags: number, materialFlags: MaterialFlags_MP3, hasDIFF: boolean, hasOPAC: boolean): GX_Material.TevStage {
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
        tevStage.colorInB = (hasDIFF ? GX.CombineColorInput.CPREV : GX.CombineColorInput.RASC);
        tevStage.colorInC = GX.CombineColorInput.TEXC;
        tevStage.colorInD = GX.CombineColorInput.ZERO;
        tevStage.alphaInD = (materialFlags & MaterialFlags_MP3.MASKED) ? GX.CombineAlphaInput.TEXA : GX.CombineAlphaInput.APREV;
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

    if (passType === 'BLOL') {
        // Bloom lightmap.
        // This actually works by drawing to the framebuffer alpha channel. During the post-process pass, the alpha channel
        // is sampled to determine the intensity of the bloom effect at this pixel. We don't support bloom for MP3, so instead
        // we just essentially multiply the color by 2 to simulate the increase in brightness that the bloom effect provides.
        tevStage.texSwapTable = [GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G, GX.TevColorChan.G];
        tevStage.colorInB = GX.CombineColorInput.CPREV;
        tevStage.colorInC = GX.CombineColorInput.ONE;
        tevStage.colorInD = GX.CombineColorInput.CPREV;
    }

    return tevStage;
}

interface Material_MP3 extends Material {
    passTypes: string[];
}

export function parseMaterialSet_MP3(stream: InputStream, resourceSystem: ResourceSystem): MaterialSet {
    const materialCount = stream.readUint32();

    const textures: TXTR[] = [];
    const textureRemapTable: number[] = [];
    const materials: Material_MP3[] = [];
    for (let i = 0; i < materialCount; i++) {
        const materialSize = stream.readUint32();
        const materialEnd = stream.tell() + materialSize;
        const materialFlags: MaterialFlags_MP3 = stream.readUint32();
        const groupIndex = stream.readUint32();
        stream.skip(4);
        const vtxAttrFormat = stream.readUint32();
        stream.skip(0xC);

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
        let hasDIFF = false;
        while(true) {
            const nodeType = stream.readFourCC();
            if (nodeType === 'END ') {
                assert(stream.tell() === materialEnd);
                break;
            } else if (nodeType === 'PASS') {
                const passSize = stream.readUint32();
                const passEnd = stream.tell() + passSize;
                const passType = stream.readFourCC();
                const passFlags = stream.readUint32();
                const materialTXTRID = stream.readAssetID();
                const texGenSrc: GX.TexGenSrc = GX.TexGenSrc.TEX0 + stream.readUint32() & 0x0F;
                const uvAnimationSize = stream.readUint32();
                let uvAnimation: UVAnimation | null = null;
                
                if (uvAnimationSize !== 0) {
                    const uvAnimationEnd = stream.tell() + uvAnimationSize;
                    const unk1 = stream.readUint16();
                    const unk2 = stream.readUint16();
                    const uvAnimations: UVAnimation[] = parseMaterialSet_UVAnimations(stream, 1);
                    if (uvAnimations.length !== 0)
                        uvAnimation = uvAnimations[0];
                    
                    stream.goTo(uvAnimationEnd);
                }
                assert(stream.tell() === passEnd);

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
                tevStages[passIndex] = makeTevStageFromPass_MP3(passIndex, passType, passFlags, materialFlags, hasDIFF, hasOPAC);
                textureIndexes[passIndex] = txtrIndex;
                uvAnimations[passIndex] = uvAnimation;
                passTypes[passIndex] = passType;
                passIndex++;

                if (passType === "DIFF") {
                    hasDIFF = true;
                }
            } else if (nodeType === 'CLR ') {
                // Color
                const subtype = stream.readFourCC();
                const value = stream.readUint32();

                if (subtype === 'DIFB') {
                    // Lightmap Diffuse Multiplier
                    colorFromRGBA8(colorConstants[0], value);
                }
            } else if (nodeType === 'INT ') {
                // Intensity
                const subtype = stream.readFourCC();
                const value = stream.readUint32();

                if (subtype === 'OPAC') {
                    // Opacity
                    colorConstants[1].a = value;
                    hasOPAC = true;
                }
            } else {
                throw "whoops";
            }
        }

        // some materials don't have any passes apparently?
        // just make a dummy tev stage in this case
        if (passIndex === 0) {
            texGens[0] = { 
                index: 0,
                type: GX.TexGenType.MTX2x4,
                source: GX.TexGenSrc.TEX0,
                matrix: GX.TexGenMatrix.TEXMTX0,
                postMatrix: GX.PostTexGenMatrix.PTTEXMTX0,
                normalize: false,
            };

            tevStages[0] = makeTevStageFromPass_MP3(0, 'NULL', 0, materialFlags, hasDIFF, hasOPAC);
            uvAnimations[0] = null;
            passTypes[0] = 'NULL';
            passIndex++;
        }

        const index = i;
        const name = `Prime3Gen_${i}`;

        const cullMode = GX.CullMode.FRONT;

        const isOccluder = !!(materialFlags & MaterialFlags_MP3.OCCLUDER);
        const blend = !!(materialFlags & MaterialFlags_MP3.BLEND);
        const additiveBlend = !!(materialFlags & MaterialFlags_MP3.ADDITIVE_BLEND);
        const masked = !!(materialFlags & MaterialFlags_MP3.MASKED);
        const isTransparent = blend || additiveBlend;
        const depthWrite = true;

        const lightChannels: GX_Material.LightChannelControl[] = [];
        lightChannels.push({
            colorChannel: { lightingEnabled: true,  ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG, litMask: 0xFF, diffuseFunction: GX.DiffuseFunction.CLAMP, attenuationFunction: GX.AttenuationFunction.SPOT },
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
        });
        lightChannels.push({
            colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.REG, matColorSource: GX.ColorSrc.REG, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
        });

        const colorRegisters: GX_Material.Color[] = [];
        colorRegisters.push(new GX_Material.Color(0, 0, 0, 0));
        colorRegisters.push(new GX_Material.Color(1, 1, 1, 0));
        colorRegisters.push(new GX_Material.Color(1, 1, 1, 0));
        colorRegisters.push(new GX_Material.Color(0, 0, 0, 0));

        const alphaTest: GX_Material.AlphaTest = {
            op: GX.AlphaOp.OR,
            compareA: masked ? GX.CompareType.GREATER : GX.CompareType.ALWAYS,
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
            lightChannels,
            texGens,
            tevStages,
            alphaTest,
            ropInfo,
            indTexStages: [],
        };

        materials.push({
            isOccluder,
            isTransparent,
            flags: 0,
            groupIndex,
            textureIndexes,
            vtxAttrFormat,
            gxMaterial,
            uvAnimations,
            passTypes,
            colorRegisters,
            colorConstants,
        });
    }

    return { textures, textureRemapTable, materials };
}

function parse_DKCR(stream: InputStream, resourceSystem: ResourceSystem): MREA {
    /*const view = buffer.createDataView();

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

    const sectionsData = decompressBuffers(stream, combineBuffers(totalDecompressedSize, decompressedSegments);
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

        const worldModelIndex: number = worldModels.length;

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
            const material: Material_MP3 = materialSet.materials[materialIndex] as Material_MP3;
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

            // TODO(jstpierre): I assume in the real game this comes from the different VAT formats.
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

            surfaces.push({ materialIndex, worldModelIndex, loadedVertexData, loadedVertexLayout });
        }

        const geometry: Geometry = { surfaces };
        const modelMatrix = mat4.create();
        worldModels.push({ geometry, bbox, modelMatrix });
    }

    const scriptLayers: Script.ScriptLayer[] = [];
    const lightLayers: AreaLightLayer[] = [];
    return { materialSet, worldModels, scriptLayers, lightLayers };*/
    return null;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): MREA {
    assert(stream.readUint32() == 0xDEADBEEF);
    const version = stream.readUint32();
    stream.skip(-8);

    // Metroid Prime 1
    if (version === AreaVersion.MP1 || version === AreaVersion.MP2 || version === AreaVersion.MP3)
        return parse_MP1(stream, resourceSystem);

    // Donkey Kong Country Returns
    if (version === 0x20)
        return parse_DKCR(stream, resourceSystem);

    throw new Error(`Unrecognized MREA version: ${version}`);
}
