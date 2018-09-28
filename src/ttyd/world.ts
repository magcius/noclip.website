
// INTELLIGENT SYSTEM's TTYD "d", stored in the "m" folder.
// I can only imagine "m" is "map", and "d" is "data".

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists } from "../util";
import { GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader, GX_Array, LoadedVertexData, LoadedVertexLayout, coalesceLoadedDatas } from '../gx/gx_displaylist';
import { mat4 } from 'gl-matrix';
import { AABB } from '../Geometry';
import AnimationController from '../AnimationController';

export interface TTYDWorld {
    information: Information;
    textureNameTable: string[];
    rootNode: SceneGraphNode;
    sNode: SceneGraphNode;
    materials: Material[];
    animations: AnimationEntry[];
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
    texMtx: mat4[];
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

export interface AnimationEntry {
    name: string;
    duration: number;
    materialAnimation: MaterialAnimation | null;
    meshAnimation: MeshAnimation | null;
}

export interface AnimationTrackComponent {
    value: number;
    tangentIn: number;
    tangentOut: number;
    step: boolean;
}

interface MeshAnimation {
    tracks: MeshAnimationTrack[];
}

interface MeshAnimationTrack {
    meshName: string;
    translationOffsetX: number;
    translationOffsetY: number;
    translationOffsetZ: number;
    rotationOffsetX: number;
    rotationOffsetY: number;
    rotationOffsetZ: number;
    scaleDividerX: number;
    scaleDividerY: number;
    scaleDividerZ: number;
    frames: MeshAnimationTrackKeyframe[];
}

interface MeshAnimationTrackKeyframe {
    time: number;
    translationX: AnimationTrackComponent;
    translationY: AnimationTrackComponent;
    translationZ: AnimationTrackComponent;
    rotationX: AnimationTrackComponent;
    rotationY: AnimationTrackComponent;
    rotationZ: AnimationTrackComponent;
    scaleX: AnimationTrackComponent;
    scaleY: AnimationTrackComponent;
    scaleZ: AnimationTrackComponent;
}

interface MaterialAnimation {
    tracks: MaterialAnimationTrack[];
}

interface MaterialAnimationTrack {
    materialName: string;
    texGenIndex: number;
    skewS: number;
    skewT: number;
    frames: MaterialAnimationTrackKeyframe[];
}

interface MaterialAnimationTrackKeyframe {
    time: number;
    translationS: AnimationTrackComponent;
    translationT: AnimationTrackComponent;
    scaleS: AnimationTrackComponent;
    scaleT: AnimationTrackComponent;
    rotation: AnimationTrackComponent;
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

const trans1 = mat4.create(), trans2 = mat4.create(), rot = mat4.create(), scale = mat4.create();
function calcTexMtx(dst: mat4, translationS: number, translationT: number, scaleS: number, scaleT: number, rotation: number, skewS: number, skewT: number): void {
    mat4.fromTranslation(dst,    [ 0.5 * skewS * scaleS, ( 0.5 * skewT - 1.0) * scaleT, 0.0]);
    mat4.fromZRotation(rot, (Math.PI / 180) * -rotation);
    mat4.fromTranslation(trans1, [-0.5 * skewS * scaleS, (-0.5 * skewT - 1.0) * scaleT, 0.0]);
    mat4.mul(rot, rot, dst);
    mat4.mul(rot, trans1, rot);
    mat4.fromScaling(scale, [scaleS, scaleT, 1.0]);
    mat4.fromTranslation(trans2, [translationS, -translationT, 0.0]);
    mat4.mul(dst, scale, rot);
    mat4.mul(dst, trans2, dst);
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

    //#region animation_table
    const animationTableCount = view.getUint32(animation_tableOffs + 0x00);
    let animationTableIdx = animation_tableOffs + 0x04;
    const animations: AnimationEntry[] = [];
    for (let i = 0; i < animationTableCount; i++) {
        const animationEntryOffs = mainDataOffs + view.getUint32(animationTableIdx + 0x00);
        animationTableIdx += 0x04;
        const nameOffs = mainDataOffs + view.getUint32(animationEntryOffs + 0x00);
        const name = readString(buffer, nameOffs, 0x40, true);
        const duration = view.getFloat32(animationEntryOffs + 0x08);
        const meshTrackTableRelOffs = view.getUint32(animationEntryOffs + 0x0C);
        const materialTrackTableRelOffs = view.getUint32(animationEntryOffs + 0x10);

        let meshAnimation: MeshAnimation | null = null;
        let materialAnimation: MaterialAnimation | null = null;

        if (meshTrackTableRelOffs !== 0) {
            const meshTrackTableOffs = mainDataOffs + meshTrackTableRelOffs;
            const meshTrackTableCount = view.getUint32(meshTrackTableOffs + 0x00);
            let meshTrackTableIdx = meshTrackTableOffs + 0x04;
            const tracks: MeshAnimationTrack[] = [];
            for (let j = 0; j < meshTrackTableCount; j++) {
                let trackEntryIdx = mainDataOffs + view.getUint32(meshTrackTableIdx + 0x00);
                const meshNameOffs = mainDataOffs + view.getUint32(trackEntryIdx + 0x00);
                const meshName = readString(buffer, meshNameOffs, 0x40, true);
                const translationOffsetX = view.getFloat32(trackEntryIdx + 0x04);
                const translationOffsetY = view.getFloat32(trackEntryIdx + 0x08);
                const translationOffsetZ = view.getFloat32(trackEntryIdx + 0x0C);
                const rotationOffsetX = view.getFloat32(trackEntryIdx + 0x10);
                const rotationOffsetY = view.getFloat32(trackEntryIdx + 0x14);
                const rotationOffsetZ = view.getFloat32(trackEntryIdx + 0x18);
                const scaleDividerX = view.getFloat32(trackEntryIdx + 0x1C);
                const scaleDividerY = view.getFloat32(trackEntryIdx + 0x20);
                const scaleDividerZ = view.getFloat32(trackEntryIdx + 0x24);
                const frameCount = view.getUint32(trackEntryIdx + 0x58);
                trackEntryIdx += 0x5C;

                const frames: MeshAnimationTrackKeyframe[] = [];
                for (let k = 0; k < frameCount; k++) {
                    const time = view.getFloat32(trackEntryIdx + 0x00);
                    trackEntryIdx += 0x04;

                    const readComponent = (): AnimationTrackComponent => {
                        const value = view.getFloat32(trackEntryIdx + 0x00);
                        const tangentIn = view.getFloat32(trackEntryIdx + 0x04);
                        const tangentOut = view.getFloat32(trackEntryIdx + 0x08);
                        const step = !!view.getUint32(trackEntryIdx + 0x10);
                        trackEntryIdx += 0x14;
                        return { value, tangentIn, tangentOut, step };
                    };

                    const translationX = readComponent();
                    const translationY = readComponent();
                    const translationZ = readComponent();
                    const rotationX = readComponent();
                    const rotationY = readComponent();
                    const rotationZ = readComponent();
                    const scaleX = readComponent();
                    const scaleY = readComponent();
                    const scaleZ = readComponent();

                    // unk tracks
                    trackEntryIdx += 0x14 * 12;

                    frames.push({ time,
                        translationX, translationY, translationZ,
                        rotationX, rotationY, rotationZ,
                        scaleX, scaleY, scaleZ,
                    });
                }

                meshTrackTableIdx += 0x04;
                tracks.push({ meshName,
                    translationOffsetX, translationOffsetY, translationOffsetZ,
                    rotationOffsetX, rotationOffsetY, rotationOffsetZ,
                    scaleDividerX, scaleDividerY, scaleDividerZ,
                    frames,
                });
            }

            meshAnimation = { tracks };
        }

        if (materialTrackTableRelOffs !== 0) {
            const materialTrackTableOffs = mainDataOffs + materialTrackTableRelOffs;
            const materialTrackTableCount = view.getUint32(materialTrackTableOffs + 0x00);
            let materialTrackTableIdx = materialTrackTableOffs + 0x04;
            const tracks: MaterialAnimationTrack[] = [];
            for (let j = 0; j < materialTrackTableCount; j++) {
                let trackEntryIdx = mainDataOffs + view.getUint32(materialTrackTableIdx + 0x00);
                const materialNameOffs = mainDataOffs + view.getUint32(trackEntryIdx + 0x00);
                const materialName = readString(buffer, materialNameOffs, 0x40, true);
                const texGenIndex = view.getUint32(trackEntryIdx + 0x04);
                const skewS = view.getFloat32(trackEntryIdx + 0x08);
                const skewT = view.getFloat32(trackEntryIdx + 0x0C);
                const frameCount = view.getUint32(trackEntryIdx + 0x10);
                trackEntryIdx += 0x14;

                const frames: MaterialAnimationTrackKeyframe[] = [];
                for (let k = 0; k < frameCount; k++) {
                    const time = view.getFloat32(trackEntryIdx + 0x00);
                    trackEntryIdx += 0x04;

                    const readComponent = (): AnimationTrackComponent => {
                        const value = view.getFloat32(trackEntryIdx + 0x00);
                        const tangentIn = view.getFloat32(trackEntryIdx + 0x04);
                        const tangentOut = view.getFloat32(trackEntryIdx + 0x08);
                        const step = !!view.getUint32(trackEntryIdx + 0x10);
                        trackEntryIdx += 0x14;
                        return { value, tangentIn, tangentOut, step };
                    };

                    const translationS = readComponent();
                    const translationT = readComponent();
                    const scaleS = readComponent();
                    const scaleT = readComponent();
                    const rotation = readComponent();
                    frames.push({ time, translationS, translationT, scaleS, scaleT, rotation });
                }

                materialTrackTableIdx += 0x04;
                tracks.push({ materialName, texGenIndex, skewS, skewT, frames });
            }

            materialAnimation = { tracks };
        }

        animations.push({ name, duration, materialAnimation, meshAnimation });
        animationTableIdx + 0x04;
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
        const texMtx: mat4[] = [];
        let samplerEntryTableIdx = materialOffs + 0x0C;
        let xformTableIdx = materialOffs + 0x2C;
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
                matrix: texMatrices[backwardsIndex],
                normalize: false,
                postMatrix: GX.PostTexGenMatrix.PTIDENTITY
            };
            texGens[backwardsIndex] = texGen;
            samplers[backwardsIndex] = { textureName, wrapS, wrapT };

            const translationS = view.getFloat32(xformTableIdx + 0x00);
            const translationT = view.getFloat32(xformTableIdx + 0x04);
            const scaleS = view.getFloat32(xformTableIdx + 0x08);
            const scaleT = view.getFloat32(xformTableIdx + 0x0C);
            const rotation = view.getFloat32(xformTableIdx + 0x10);
            const skewS = view.getFloat32(xformTableIdx + 0x14);
            const skewT = view.getFloat32(xformTableIdx + 0x18);
            texMtx[backwardsIndex] = mat4.create();
            calcTexMtx(texMtx[backwardsIndex], translationS, translationT, scaleS, scaleT, rotation, skewS, skewT);

            samplerEntryTableIdx += 0x04;
            xformTableIdx += 0x1C;
        }

        const renderModeStructOffs = mainDataOffs + view.getUint32(materialOffs + 0x58);
        const cullMode: GX.CullMode = view.getUint8(renderModeStructOffs + 0x01);

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
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV),
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
        } else if (tevMode === 0x04) {
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
                ... setTevColorIn(GX.CombineColorInput.ZERO, GX.CombineColorInput.CPREV, GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.APREV, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            tevStages.push({
                index: 2,

                ... setTevOrder(GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO),
                ... setTevColorIn(GX.CombineColorInput.TEXC, GX.CombineColorInput.CPREV, GX.CombineColorInput.APREV, GX.CombineColorInput.ZERO),
                ... setTevAlphaIn(GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA),
                ... setTevColorOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),
                ... setTevAlphaOp(GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV),

                konstColorSel: GX.KonstColorSel.KCSEL_1,
                konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

                ... noIndTex,
            });

            // No modulation against RASC? wtf?
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
            cullMode,
            lightChannels,
            texGens,
            tevStages,
            alphaTest,
            ropInfo,
            indTexStages: [],
        };

        const material: Material = { index: i, name: materialName, materialLayer, samplers, gxMaterial, matColorReg, texMtx };
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
    assert(texCoordCount <= 0x03);
    vtxArrays[GX.VertexAttribute.TEX0] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x18) + 0x04 };
    vtxArrays[GX.VertexAttribute.TEX1] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x1C) + 0x04 };
    vtxArrays[GX.VertexAttribute.TEX2] = { buffer, offs: mainDataOffs + view.getUint32(vcd_tableOffs + 0x20) + 0x04 };
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

    function readSceneGraph(offs: number): SceneGraphNodeInternal {
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
            // assert(meshUnk00 === 0x01000001);
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

            if ((workingBits & VcdBitFlags.TEX2) !== 0) {
                vat[GX.VertexAttribute.TEX2] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(vcd_tableOffs + 0x50) };
                vcd[GX.VertexAttribute.TEX2] = { type: GX.AttrType.INDEX16 };
                workingBits &= ~VcdBitFlags.TEX2;
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
            let child = readSceneGraph(mainDataOffs + firstChildOffs);
            while (child !== null) {
                children.unshift(child);
                child = child.nextSibling;
            }
        }

        let nextSibling: SceneGraphNodeInternal | null = null;
        if (nextSiblingOffs !== 0)
            nextSibling = readSceneGraph(mainDataOffs + nextSiblingOffs);

        return { nameStr, typeStr, modelMatrix, bbox, children, parts, isTranslucent, nextSibling };
    }

    const rootNode = readSceneGraph(sceneGraphRootOffs);
    assert(rootNode.nextSibling === null);

    // The root node contains (at least) two nodes, the "A" node and the "S" node (possibly "animated" and "static").
    // The "S" nodes appear to be the visual models we want, while "A" appear to mostly be collision meshes. Any
    // other nodes at the root appear to be unused (!). We only want the visual stuff, so we only take "S".
    const sNode = rootNode.children.find((child) => child.nameStr === sNodeStr);

    const information = { versionStr, aNodeStr, sNodeStr, dateStr };
    //#endregion

    return { information, textureNameTable, rootNode, sNode, materials, animations };
}

export const enum LoopMode {
    ONCE = 0,
    REPEAT = 2,
    MIRRORED_ONCE = 3,
    MIRRORED_REPEAT = 4,
}

function applyLoopMode(t: number, loopMode: LoopMode) {
    switch (loopMode) {
    case LoopMode.ONCE:
        return Math.min(t, 1);
    case LoopMode.REPEAT:
        return t % 1;
    case LoopMode.MIRRORED_ONCE:
        return 1 - Math.abs((Math.min(t, 2) - 1));
    case LoopMode.MIRRORED_REPEAT:
        return 1 - Math.abs((t % 2) - 1);
    }
}

function getAnimFrame(anim: AnimationEntry, frame: number): number {
    const lastFrame = anim.duration - 1;
    const normTime = frame / lastFrame;
    const animFrame = applyLoopMode(normTime, LoopMode.REPEAT) * lastFrame;
    return animFrame;
}

function cubicEval(cf0: number, cf1: number, cf2: number, cf3: number, t: number): number {
    return (((cf0 * t + cf1) * t + cf2) * t + cf3);
}

function interpKeyframes(k0: AnimationTrackComponent, k1: AnimationTrackComponent, t: number, d: number): number {
    if (k0.step)
        return k0.value;

    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangentOut * d;
    const s1 = k1.tangentIn * d;
    const cf0 = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1);
    const cf1 = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1);
    const cf2 = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0);
    const cf3 = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0);
    return cubicEval(cf0, cf1, cf2, cf3, t);
}

export class MeshAnimator {
    constructor(public animationController: AnimationController, private animation: AnimationEntry, private track: MeshAnimationTrack) {}

    public calcModelMtx(dst: mat4): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.animation, frame);

        const frames = this.track.frames;
        let k0: MeshAnimationTrackKeyframe;
        let k1: MeshAnimationTrackKeyframe;
        if (frames.length === 1) {
            k0 = k1 = frames[0];
        } else {
            // Find the first frame.
            const idx1 = frames.findIndex((key) => (animFrame < key.time));
            if (idx1 < 0) {
                k0 = k1 = frames[frames.length - 1];
            } else {
                const idx0 = idx1 - 1;
                k0 = frames[idx0];
                k1 = frames[idx1];
            }
        }

        const d = (k1.time - k0.time);
        let t = d > 0 ? (animFrame - k0.time) / d : 0;
        const translationX = interpKeyframes(k0.translationX, k1.translationX, t, d) - this.track.translationOffsetX;
        const translationY = interpKeyframes(k0.translationY, k1.translationY, t, d) - this.track.translationOffsetY;
        const translationZ = interpKeyframes(k0.translationZ, k1.translationZ, t, d) - this.track.translationOffsetZ;
        const rotationX = interpKeyframes(k0.rotationX, k1.rotationX, t, d) - this.track.rotationOffsetX;
        const rotationY = interpKeyframes(k0.rotationY, k1.rotationY, t, d) - this.track.rotationOffsetY;
        const rotationZ = interpKeyframes(k0.rotationZ, k1.rotationZ, t, d) - this.track.rotationOffsetZ;
        const scaleX = interpKeyframes(k0.scaleX, k1.scaleX, t, d) / this.track.scaleDividerX;
        const scaleY = interpKeyframes(k0.scaleY, k1.scaleY, t, d) / this.track.scaleDividerY;
        const scaleZ = interpKeyframes(k0.scaleZ, k1.scaleZ, t, d) / this.track.scaleDividerZ;
        calcModelMtx(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
    }
}

function findMeshAnimationTrack(animation: AnimationEntry, meshName: string): MeshAnimationTrack | null {
    if (animation.meshAnimation !== null) {
        const track = animation.meshAnimation.tracks.find((a) => a.meshName === meshName);
        if (track)
            return track;
    }

    return null;
}

export function bindMeshAnimator(animationController: AnimationController, animation: AnimationEntry, meshName: string): MeshAnimator | null {
    const track = findMeshAnimationTrack(animation, meshName);
    if (track !== null)
        return new MeshAnimator(animationController, animation, track);

    return null;
}

export class MaterialAnimator {
    constructor(public animationController: AnimationController, private animation: AnimationEntry, private track: MaterialAnimationTrack) {}

    public calcTexMtx(dst: mat4): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.animation, frame);

        const frames = this.track.frames;
        let k0: MaterialAnimationTrackKeyframe;
        let k1: MaterialAnimationTrackKeyframe;
        if (frames.length === 1) {
            k0 = k1 = frames[0];
        } else {
            // Find the first frame.
            const idx1 = frames.findIndex((key) => (animFrame < key.time));
            if (idx1 < 0) {
                k0 = k1 = frames[frames.length - 1];
            } else {
                const idx0 = idx1 - 1;
                k0 = frames[idx0];
                k1 = frames[idx1];
            }
        }

        const d = (k1.time - k0.time);
        let t = d > 0 ? (animFrame - k0.time) / d : 0;
        const skewS = this.track.skewS;
        const skewT = this.track.skewT;
        const scaleS = interpKeyframes(k0.scaleS, k1.scaleT, t, d);
        const scaleT = interpKeyframes(k0.scaleT, k1.scaleT, t, d);
        const rotation = interpKeyframes(k0.rotation, k1.rotation, t, d);
        const translationS = interpKeyframes(k0.translationS, k1.translationS, t, d);
        const translationT = interpKeyframes(k0.translationT, k1.translationT, t, d);
        calcTexMtx(dst, translationS, translationT, scaleS, scaleT, rotation, skewS, skewT);
    }
}

function materialNameMatches(trackName: string, materialName: string): boolean {
    if (trackName === materialName)
        return true;
    if (trackName === materialName.replace(/_[vx]/g, ''))
        return true;
    return false;
}

function findMaterialAnimationTrack(animation: AnimationEntry, materialName: string, texGenIndex: number): MaterialAnimationTrack | null {
    if (animation.materialAnimation !== null) {
        for (const track of animation.materialAnimation.tracks) {
            if (materialNameMatches(track.materialName, materialName) && texGenIndex === track.texGenIndex)
                return track;
        }
    }

    return null;
}

export function bindMaterialAnimator(animationController: AnimationController, animation: AnimationEntry, materialName: string, texGenIndex: number): MaterialAnimator | null {
    const track = findMaterialAnimationTrack(animation, materialName, texGenIndex);
    if (track !== null)
        return new MaterialAnimator(animationController, animation, track);

    return null;
}
