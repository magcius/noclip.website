
// INTELLIGENT SYSTEM's TTYD "d", stored in the "m" folder.
// I can only imagine "m" is "map", and "d" is "data".

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists } from "../util";
import { GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader, GX_Array, LoadedVertexData, LoadedVertexLayout, coalesceLoadedDatas } from '../gx/gx_displaylist';
import { mat4 } from 'gl-matrix';
import { AABB } from '../Geometry';

export interface TTYDWorld {
    information: Information;
    textureNameTable: string[];
    rootNode: SceneGraphNode;
    sNode: SceneGraphNode;
    materials: Material[];
}

export interface Information {
    versionStr: string;
    sNodeStr: string;
    aNodeStr: string;
    dateStr: string;
}

export interface Sampler {
    textureName: string;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
}

const enum MaterialLayer {
    OPAQUE = 0x00,
    ALPHA_TEST = 0x01,
    BLEND = 0x02,
    OPAQUE_PUNCHTHROUGH = 0x03,
    ALPHA_TEST_PUNCHTHROUGH = 0x04,
}

export interface Material {
    index: number;
    name: string;
    materialLayer: MaterialLayer;
    samplers: Sampler[];
    gxMaterial: GX_Material.GXMaterial;
    matColorReg: GX_Material.Color;
}

export interface Batch {
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
}

export interface SceneGraphPart {
    material: Material;
    batch: Batch;
}

export interface SceneGraphNode {
    nameStr: string;
    typeStr: string;
    bbox: AABB;
    modelMatrix: mat4;
    children: SceneGraphNode[];
    parts: SceneGraphPart[];
    isTranslucent: boolean;
    visible?: boolean;
}

function calcModelMtx(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number, translationX: number, translationY: number, translationZ: number): void {
    const rX = Math.PI / 180 * rotationX;
    const rY = Math.PI / 180 * rotationY;
    const rZ = Math.PI / 180 * rotationZ;

    const sinX = Math.sin(rX), cosX = Math.cos(rX);
    const sinY = Math.sin(rY), cosY = Math.cos(rY);
    const sinZ = Math.sin(rZ), cosZ = Math.cos(rZ);

    dst[0] =  scaleX * (cosY * cosZ);
    dst[1] =  scaleX * (sinZ * cosY);
    dst[2] =  scaleX * (-sinY);
    dst[3] =  0.0;

    dst[4] =  scaleY * (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  scaleY * (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  scaleY * (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  scaleZ * (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  scaleZ * (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = scaleZ * (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = translationX;
    dst[13] = translationY;
    dst[14] = translationZ;
    dst[15] = 1.0;
}

function setTevOrder(texCoordId: GX.TexCoordID, texMap: GX.TexMapID, channelId: GX.RasColorChannelID) {
    return { texCoordId, texMap, channelId };
}

function setTevColorIn(colorInA: GX.CombineColorInput, colorInB: GX.CombineColorInput, colorInC: GX.CombineColorInput, colorInD: GX.CombineColorInput) {
    return { colorInA, colorInB, colorInC, colorInD };
}

function setTevAlphaIn(alphaInA: GX.CombineAlphaInput, alphaInB: GX.CombineAlphaInput, alphaInC: GX.CombineAlphaInput, alphaInD: GX.CombineAlphaInput) {
    return { alphaInA, alphaInB, alphaInC, alphaInD };
}

function setTevColorOp(colorOp: GX.TevOp, colorBias: GX.TevBias, colorScale: GX.TevScale, colorClamp: boolean, colorRegId: GX.Register) {
    return { colorOp, colorBias, colorScale, colorClamp, colorRegId };
}

function setTevAlphaOp(alphaOp: GX.TevOp, alphaBias: GX.TevBias, alphaScale: GX.TevScale, alphaClamp: boolean, alphaRegId: GX.Register) {
    return { alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId };
}

export function parse(buffer: ArrayBufferSlice): TTYDWorld {
    const view = buffer.createDataView();

    const fileSize = view.getUint32(0x00);
    const mainDataSize = view.getUint32(0x04);
    const pointerFixupTableCount = view.getUint32(0x08);
    const namedChunkTableCount = view.getUint32(0x0C);

    const mainDataOffs = 0x20;
    const pointerFixupTableOffs = mainDataOffs + mainDataSize;
    const namedChunkTableOffs = pointerFixupTableOffs + (pointerFixupTableCount * 0x04);

    const chunkNames = [
        'animation_table',
        'curve_table',
        'fog_table',
        'information',
        'light_table',
        'material_name_table',
        'texture_table',
        'vcd_table',
    ];
    assert(namedChunkTableCount === chunkNames.length);

    const chunkOffsets: number[] = [];

    // Read the chunks.
    let namedChunkTableIdx = namedChunkTableOffs;
    const namedChunkStringTableOffs = namedChunkTableOffs + (namedChunkTableCount * 0x08);
    for (let i = 0; i < namedChunkTableCount; i++) {
        const chunkOffs = mainDataOffs + view.getUint32(namedChunkTableIdx + 0x00);
        const chunkNameOffs = namedChunkStringTableOffs + view.getUint32(namedChunkTableIdx + 0x04);
        const chunkName = readString(buffer, chunkNameOffs, 0xFF, true);
        assert(chunkName === chunkNames[i]);
        chunkOffsets[i] = chunkOffs;
        namedChunkTableIdx += 0x08;
    }

    const [ animation_tableOffs, curve_tableOffs, fog_tableOffs, informationOffs, light_tableOffs, material_name_tableOffs, texture_tableOffs, vcd_tableOffs ] = chunkOffsets;

    //#region texture_table
    const textureTableCount = view.getUint32(texture_tableOffs + 0x00);
    let textureTableIdx = texture_tableOffs + 0x04;
    const textureNameTable: string[] = [];
    for (let i = 0; i < textureTableCount; i++) {
        const textureNameOffs = mainDataOffs + view.getUint32(textureTableIdx + 0x00);
        const textureName = readString(buffer, textureNameOffs, 0x40, true);
        textureNameTable[i] = textureName;
        textureTableIdx += 0x04;
    }
    //#endregion

    //#region material_name_table
    const materialTableCount = view.getUint32(material_name_tableOffs + 0x00);
    let materialTableIdx = material_name_tableOffs + 0x04;
    const materialMap = new Map<number, Material>();
    const materials: Material[] = [];
    for (let i = 0; i < materialTableCount; i++) {
        const materialName = readString(buffer, mainDataOffs + view.getUint32(materialTableIdx + 0x00));
        const materialOffs = mainDataOffs + view.getUint32(materialTableIdx + 0x04);
        materialTableIdx += 0x08;

        // Parse material.
        const materialName2 = readString(buffer, mainDataOffs + view.getUint32(materialOffs + 0x00));
        assert(materialName === materialName2);
        const matColorReg = new GX_Material.Color();
        matColorReg.copy32(view.getUint32(materialOffs + 0x04));
        const matColorSrc: GX.ColorSrc = view.getUint8(materialOffs + 0x08);

        let materialLayer: MaterialLayer = MaterialLayer.OPAQUE;

        const materialLayerFlags: MaterialLayer = view.getUint8(materialOffs + 0x0A);
        assert(materialLayerFlags <= MaterialLayer.BLEND);
        materialLayer = Math.max(materialLayer, materialLayerFlags);

        const samplerEntryTableCount = view.getUint8(materialOffs + 0x0B);

        const texGens: GX_Material.TexGen[] = [];
        const samplers: Sampler[] = [];
        let samplerEntryTableIdx = materialOffs + 0x0C;
        for (let i = 0; i < samplerEntryTableCount; i++) {
            const samplerOffs = mainDataOffs + view.getUint32(samplerEntryTableIdx);
            const textureEntryOffs = mainDataOffs + view.getUint32(samplerOffs + 0x00);

            const samplerUnk04 = view.getUint32(samplerOffs + 0x04);
            assert(samplerUnk04 === 0x00000000);

            const wrapS: GX.WrapMode = view.getUint8(samplerOffs + 0x08);
            const wrapT: GX.WrapMode = view.getUint8(samplerOffs + 0x09);

            const materialLayerFlags: MaterialLayer = view.getUint8(samplerOffs + 0x0A);
            assert(materialLayerFlags <= MaterialLayer.BLEND);
            materialLayer = Math.max(materialLayer, materialLayerFlags);

            const textureName = readString(buffer, mainDataOffs + view.getUint32(textureEntryOffs + 0x00));

            // Seems to be some byte. Flags?
            const textureEntryUnk04 = view.getUint8(textureEntryOffs + 0x04);
            const textureWidth = view.getUint16(textureEntryOffs + 0x08);
            const textureHeight = view.getUint16(textureEntryOffs + 0x0A);
            const textureEntryUnk0C = view.getUint8(textureEntryOffs + 0x0C);
            assert(textureEntryUnk0C === 0x00);

            // For some reason, the game sets up samplers backwards.
            const backwardsIndex = samplerEntryTableCount - i - 1;

            const texMatrices = [
                GX.TexGenMatrix.TEXMTX0,
                GX.TexGenMatrix.TEXMTX1,
                GX.TexGenMatrix.TEXMTX2,
                GX.TexGenMatrix.TEXMTX3,
                GX.TexGenMatrix.TEXMTX4,
                GX.TexGenMatrix.TEXMTX5,
                GX.TexGenMatrix.TEXMTX6,
                GX.TexGenMatrix.TEXMTX7,
            ];

            const texGen = {
                index: i,
                type: GX.TexGenType.MTX2x4,
                source: GX.TexGenSrc.TEX0 + backwardsIndex,
                matrix: texMatrices[i],
                normalize: false,
                postMatrix: GX.PostTexGenMatrix.PTIDENTITY
            };
            texGens[backwardsIndex] = texGen;
            samplers[backwardsIndex] = { textureName, wrapS, wrapT };

            samplerEntryTableIdx += 0x04;
        }

        const lightChannel0: GX_Material.LightChannelControl = {
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: matColorSrc },
            colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: matColorSrc },
        };

        const lightChannels: GX_Material.LightChannelControl[] = [lightChannel0, lightChannel0];

        const tevConfigRelOffs = view.getUint32(materialOffs + 0x110);
        let tevMode = 0;
        if (tevConfigRelOffs !== 0) {
            const tevConfigOffs = mainDataOffs + tevConfigRelOffs;
            tevMode = view.getUint8(tevConfigOffs + 0x00);
        }

        const noIndTex = {
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

        const tevStages: GX_Material.TevStage[] = [];
        if (samplerEntryTableCount === 0) {
            // rgba = ras.rgba
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.RASC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.RASA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        } else if (tevMode === 0x00) {
            // rgba = tex0.rgba * ras.rgba
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.RASC, GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        } else if (tevMode === 0x01) {
            // rgba = vec4(mix(tex0.rgb * tex1.rgb, tex1.a), tex0.a) * ras.rgba
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 1,

                ... setTevOrder(GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.CPREV, GX.CombineColorInput.TEXC, GX.CombineColorInput.TEXA, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            // Modulate against RASC
            tevStages.push({
                index: 2,

                ... setTevOrder(GX.TexCoordID.NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0),

                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.CPREV, GX.CombineColorInput.RASC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        } else if (tevMode === 0x02) {
            // rgba = tex0.rgba * tex1.aaaa * ras.rgba
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 1,

                ... setTevOrder(GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.CPREV, GX.CombineColorInput.TEXA, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            // Modulate against RASC
            tevStages.push({
                index: 2,

                ... setTevOrder(GX.TexCoordID.NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0),

                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.CPREV, GX.CombineColorInput.RASC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        } else if (tevMode === 0x03) {
            // rgba = tex0.rgba * (1.0 - tex1.aaaa) * ras.rgba
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 1,

                ... setTevOrder(GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.CPREV, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXA, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            // Modulate against RASC
            tevStages.push({
                index: 2,

                ... setTevOrder(GX.TexCoordID.NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0),

                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.CPREV, GX.CombineColorInput.RASC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        } else if (tevMode === 0x05) {
            // rgba = mix(tex0.rgba, tex1.rgba, tex2.aaaa) * ras.rgba
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG0),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG0),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 1,

                ... setTevOrder(GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG1),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG1),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 2,

                ... setTevOrder(GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.C0, GX.CombineColorInput.C1, GX.CombineColorInput.TEXA, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.A0, GX.CombineAlphaInput.A1, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 3,

                ... setTevOrder(GX.TexCoordID.NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.CPREV, GX.CombineColorInput.RASC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        } else if (tevMode === 0x06) {
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 1,

                ... setTevOrder(GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.CPREV, GX.CombineColorInput.TEXC, GX.CombineColorInput.APREV, GX.CombineColorInput.TEXC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 2,

                ... setTevOrder(GX.TexCoordID.NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.CPREV, GX.CombineColorInput.RASC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        } else if (tevMode === 0x07) {
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 1,

                ... setTevOrder(GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.CPREV, GX.CombineColorInput.TEXC, GX.CombineColorInput.TEXA, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 2,

                ... setTevOrder(GX.TexCoordID.NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.CPREV, GX.CombineColorInput.RASC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        } else {
            console.error(`Unimplemented TEV mode ${tevMode}`);

            // Push a tev mode 0.
            // rgba = tex0.rgba * ras.rgba
            tevStages.push({
                index: 0,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0),
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.RASC, GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.RASA, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });
        }

        let alphaTest: GX_Material.AlphaTest;
        let ropInfo: GX_Material.RopInfo;

        if (materialLayer === MaterialLayer.OPAQUE) {
            // Opaque.
            // GXSetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_OR);
            // GXSetAlphaCompare(GX_ALWAYS, 0, GX_AOP_AND, GX_ALWAYS, 0);
            // GXSetZMode(GX_TRUE, GX_LEQUAL, GX_TRUE);

            alphaTest = {
            op: GX.AlphaOp.AND,
                compareA: GX.CompareType.ALWAYS,
            compareB: GX.CompareType.ALWAYS,
                referenceA: 0.0,
            referenceB: 0.0,
        };

            ropInfo = {
                blendMode: {
            type: GX.BlendMode.NONE,
            srcFactor: GX.BlendFactor.ONE,
                    dstFactor: GX.BlendFactor.ZERO,
            logicOp: GX.LogicOp.CLEAR,
                },

                depthFunc: GX.CompareType.LEQUAL,
                depthTest: true,
                depthWrite: true,
            };
        } else if (materialLayer === MaterialLayer.ALPHA_TEST) {
            // Alpha test.
            // GXSetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
            // GXSetAlphaCompare(GX_GEQUAL, 0x80, GX_AOP_OR, GX_NEVER, 0);
            // GXSetZMode(GX_TRUE, GX_LEQUAL, GX_TRUE);

            alphaTest = {
                op: GX.AlphaOp.OR,
                compareA: GX.CompareType.GEQUAL,
                compareB: GX.CompareType.NEVER,
                referenceA: 0.5,
                referenceB: 0.0,
        };

            ropInfo = {
                blendMode: {
                    type: GX.BlendMode.NONE,
                    srcFactor: GX.BlendFactor.ONE,
                    dstFactor: GX.BlendFactor.ZERO,
                    logicOp: GX.LogicOp.CLEAR,
                },

                depthFunc: GX.CompareType.LEQUAL,
            depthTest: true,
            depthWrite: true,
        };
        } else if (materialLayer === MaterialLayer.BLEND) {
            // Transparent.
            // GXSetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
            // GXSetAlphaCompare(GX_ALWAYS, 0, GX_AOP_AND, GX_ALWAYS, 0);
            // GXSetZMode(GX_TRUE, GX_LEQUAL, GX_FALSE);

            alphaTest = {
                op: GX.AlphaOp.AND,
                compareA: GX.CompareType.ALWAYS,
                compareB: GX.CompareType.ALWAYS,
                referenceA: 0.0,
                referenceB: 0.0,
            };

            ropInfo = {
                blendMode: {
                    type: GX.BlendMode.BLEND,
                    srcFactor: GX.BlendFactor.SRCALPHA,
                    dstFactor: GX.BlendFactor.INVSRCALPHA,
                    logicOp: GX.LogicOp.CLEAR,
                },

                depthFunc: GX.CompareType.LEQUAL,
                depthTest: true,
                depthWrite: false,
            };
        }

        const gxMaterial: GX_Material.GXMaterial = {
            index: i, name: materialName,
            cullMode: GX.CullMode.BACK,
            lightChannels,
            texGens,
            tevStages,
            alphaTest,
            ropInfo,
            indTexStages: [],
        };

        const material: Material = { index: i, name: materialName, materialLayer, samplers, gxMaterial, matColorReg };
        materialMap.set(materialOffs, material);
        materials.push(material);
    }
    //#endregion

    //#region vcd_table
    const vtxArrays: GX_Array[] = [];
    // First element of the blocks is item count, so we add 0x04 to skip past it.

    vtxArrays[GX.VertexAttribute.POS] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x00) + 0x04 };
    // NRM, probably?
    vtxArrays[GX.VertexAttribute.NRM] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x04) + 0x04 };

    const clrCount = view.getUint32(vcd_tableOffs + 0x08);
    assert(clrCount === 0x01);

    vtxArrays[GX.VertexAttribute.CLR0] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x0C) + 0x04 };
    // vtxArrays[GX.VertexAttribute.CLR1] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x10) + 0x04 };
    assert(view.getUint32(vcd_tableOffs + 0x10) === 0);

    const texCoordCount = view.getUint32(vcd_tableOffs + 0x14);
    // assert(texCoordCount === 0x01);
    vtxArrays[GX.VertexAttribute.TEX0] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x18) + 0x04 };
    vtxArrays[GX.VertexAttribute.TEX1] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x1C) + 0x04 };
    //#endregion

    //#region information
    assert(informationOffs === 0x20);
    const versionStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x00));
    const sNodeStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x08));
    const aNodeStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x0C));
    const dateStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x10));

    // Read meshes.
    const sceneGraphRootOffs = mainDataOffs + view.getUint32(informationOffs + 0x04);

    interface SceneGraphNodeInternal extends SceneGraphNode {
        nextSibling: SceneGraphNodeInternal | null;
    }

    function readSceneGraph(offs: number, parentMatrix: mat4): SceneGraphNodeInternal {
        const nameStr = readString(buffer, mainDataOffs + view.getUint32(offs + 0x00));
        const typeStr = readString(buffer, mainDataOffs + view.getUint32(offs + 0x04));
        const parentOffs = view.getUint32(offs + 0x08);
        const firstChildOffs = view.getUint32(offs + 0x0C);
        const nextSiblingOffs = view.getUint32(offs + 0x10);
        const prevSiblingOffs = view.getUint32(offs + 0x14);

        const scaleX = view.getFloat32(offs + 0x18);
        const scaleY = view.getFloat32(offs + 0x1C);
        const scaleZ = view.getFloat32(offs + 0x20);
        const rotationX = view.getFloat32(offs + 0x24);
        const rotationY = view.getFloat32(offs + 0x28);
        const rotationZ = view.getFloat32(offs + 0x2C);
        const translationX = view.getFloat32(offs + 0x30);
        const translationY = view.getFloat32(offs + 0x34);
        const translationZ = view.getFloat32(offs + 0x38);
        const bboxMinX = view.getFloat32(offs + 0x3C);
        const bboxMinY = view.getFloat32(offs + 0x40);
        const bboxMinZ = view.getFloat32(offs + 0x44);
        const bboxMaxX = view.getFloat32(offs + 0x48);
        const bboxMaxY = view.getFloat32(offs + 0x4C);
        const bboxMaxZ = view.getFloat32(offs + 0x50);

        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
        const modelMatrix = mat4.create();
        calcModelMtx(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        mat4.mul(modelMatrix, parentMatrix, modelMatrix);

        const partTableCount = view.getUint32(offs + 0x5C);
        let partTableIdx = offs + 0x60;

        const parts: SceneGraphPart[] = [];
        let isTranslucent = false;
        for (let i = 0; i < partTableCount; i++) {
            const materialOffs = mainDataOffs + view.getUint32(partTableIdx + 0x00);
            const material = assertExists(materialMap.get(materialOffs));

            if (material.materialLayer === MaterialLayer.BLEND)
                isTranslucent = true;

            const meshOffs = mainDataOffs + view.getUint32(partTableIdx + 0x04);

            // Parse mesh.
            // VAT, perhaps? Doesn't seem like there's enough bits for that...
            const meshUnk00 = view.getUint32(meshOffs + 0x00);
            assert(meshUnk00 === 0x01000001);
            const displayListTableCount = view.getUint32(meshOffs + 0x04);
            const vcdBits = view.getUint32(meshOffs + 0x08);
            const arrayOffs = mainDataOffs + view.getUint32(meshOffs + 0x0C);
            assert(arrayOffs === vcd_tableOffs);

            const enum VcdBitFlags {
                POS  = 1 << 0,
                NRM  = 1 << 1,
                CLR0 = 1 << 2,
                CLR1 = 1 << 3,
                TEX0 = 1 << 4,
                TEX1 = 1 << 5,
                TEX2 = 1 << 6,
                TEX3 = 1 << 7,
                TEX4 = 1 << 8,
                TEX5 = 1 << 9,
                TEX6 = 1 << 10,
                TEX7 = 1 << 11,
            };

            let workingBits = vcdBits;

            const vat: GX_VtxAttrFmt[] = [];
            const vcd: GX_VtxDesc[] = [];

            assert((workingBits & VcdBitFlags.POS) !== 0);
            if ((workingBits & VcdBitFlags.POS) !== 0) {
                vat[GX.VertexAttribute.POS] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.POS_XYZ, compShift: view.getUint32(vcd_tableOffs + 0x44) };
                vcd[GX.VertexAttribute.POS] = { type: GX.AttrType.INDEX16 };
                workingBits &= ~VcdBitFlags.POS;
            }

            if ((workingBits & VcdBitFlags.NRM) !== 0) {
                vat[GX.VertexAttribute.NRM] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.NRM_XYZ, compShift: 0 };
                vcd[GX.VertexAttribute.NRM] = { type: GX.AttrType.INDEX16 };
                workingBits &= ~VcdBitFlags.NRM;
            }

            if ((workingBits & VcdBitFlags.CLR0) !== 0) {
                vat[GX.VertexAttribute.CLR0] = { compType: GX.CompType.RGBA8, compCnt: GX.CompCnt.CLR_RGBA, compShift: 0 };
                vcd[GX.VertexAttribute.CLR0] = { type: GX.AttrType.INDEX16 };
                workingBits &= ~VcdBitFlags.CLR0;
            }

            if ((workingBits & VcdBitFlags.TEX0) !== 0) {
                vat[GX.VertexAttribute.TEX0] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(vcd_tableOffs + 0x48) };
                vcd[GX.VertexAttribute.TEX0] = { type: GX.AttrType.INDEX16 };
                workingBits &= ~VcdBitFlags.TEX0;
            }

            if ((workingBits & VcdBitFlags.TEX1) !== 0) {
                vat[GX.VertexAttribute.TEX1] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(vcd_tableOffs + 0x4C) };
                vcd[GX.VertexAttribute.TEX1] = { type: GX.AttrType.INDEX16 };
                workingBits &= ~VcdBitFlags.TEX1;
            }

            // No bits leftover.
            assert(workingBits === 0);

            const vtxLoader = compileVtxLoader(vat, vcd);
            const loadedVertexLayout = vtxLoader.loadedVertexLayout;

            let displayListTableIdx = meshOffs + 0x10;
            const loadedDatas: LoadedVertexData[] = [];
            let vertexId = 0;
            for (let i = 0; i < displayListTableCount; i++) {
                const displayListOffs = mainDataOffs + view.getUint32(displayListTableIdx + 0x00);
                const displayListSize = view.getUint32(displayListTableIdx + 0x04);
                const loadedVertexData = vtxLoader.runVertices(vtxArrays, buffer.subarray(displayListOffs, displayListSize), { firstVertexId: vertexId });
                vertexId = loadedVertexData.vertexId;
                loadedDatas.push(loadedVertexData);
                displayListTableIdx += 0x08;
            }

            const loadedVertexData = coalesceLoadedDatas(loadedDatas);
            const batch: Batch = { loadedVertexLayout, loadedVertexData };

            parts.push({ material, batch });
            partTableIdx += 0x08;
        }

        const children: SceneGraphNode[] = [];
        if (firstChildOffs !== 0) {
            let child = readSceneGraph(mainDataOffs + firstChildOffs, modelMatrix);
            while (child !== null) {
                children.unshift(child);
                child = child.nextSibling;
            }
        }

        let nextSibling: SceneGraphNodeInternal | null = null;
        if (nextSiblingOffs !== 0)
            nextSibling = readSceneGraph(mainDataOffs + nextSiblingOffs, parentMatrix);

        return { nameStr, typeStr, modelMatrix, bbox, children, parts, isTranslucent, nextSibling };
    }

    const rootMatrix = mat4.create();
    const rootScale = 10;
    mat4.fromScaling(rootMatrix, [rootScale, rootScale, rootScale]);
    const rootNode = readSceneGraph(sceneGraphRootOffs, rootMatrix);
    assert(rootNode.nextSibling === null);

    // The root node contains (at least) two nodes, the "A" node and the "S" node (possibly "animated" and "static").
    // The "S" nodes appear to be the visual models we want, while "A" appear to mostly be collision meshes. Any
    // other nodes at the root appear to be unused (!). We only want the visual stuff, so we only take "S".
    const sNode = rootNode.children.find((child) => child.nameStr === sNodeStr);

    const information = { versionStr, aNodeStr, sNodeStr, dateStr };
    //#endregion

    return { information, textureNameTable, rootNode, sNode, materials };
}
