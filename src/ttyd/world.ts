
// INTELLIGENT SYSTEM's TTYD "d", stored in the "m" folder.
// I can only imagine "m" is "map", and "d" is "data".

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists } from "../util";
import { GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader, GX_Array, LoadedVertexData, LoadedVertexLayout } from '../gx/gx_displaylist';
import { mat4, quat } from 'gl-matrix';

export interface TTYDWorld {
    information: Information;
    textureNameTable: string[];
    rootNode: SceneGraphNode;
    materials: Material[];
}

export interface Information {
    versionStr: string;
    nameStr: string;
    typeStr: string;
    dateStr: string;
}

export interface Material {
    index: number;
    name: string;
    textureName: string;
    gxMaterial: GX_Material.GXMaterial;
}

export interface Batch {
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
}

export interface SceneGraphPart {
    material: Material;
    batch: Batch;
}

interface TransformDebug {
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    rotateX: number;
    rotateY: number;
    rotateZ: number;
    translate1_X: number;
    translate1_Y: number;
    translate1_Z: number;
    translate2_X: number;
    translate2_Y: number;
    translate2_Z: number;
    translate3_X: number;
    translate3_Y: number;
    translate3_Z: number;
}

export interface SceneGraphNode {
    nameStr: string;
    typeStr: string;
    transformDebug: TransformDebug;
    modelMatrix: mat4;
    children: SceneGraphNode[];
    parts: SceneGraphPart[];
    visible?: boolean;
}

export function parse(buffer: ArrayBufferSlice): TTYDWorld {
    const view = buffer.createDataView();

    const fileSize = view.getUint32(0x00);
    const mainDataSize = view.getUint32(0x04);
    const chunkTableCount = view.getUint32(0x08);
    const namedChunkTableCount = view.getUint32(0x0C);

    const mainDataOffs = 0x20;
    const chunkTableOffs = mainDataOffs + mainDataSize;
    const namedChunkTableOffs = chunkTableOffs + (chunkTableCount * 0x04);

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
        const color = view.getUint32(materialOffs + 0x04);
        // Probably counts of some sort?
        const materialUnk08 = view.getUint32(materialOffs + 0x08);
        const samplerOffsRel = view.getUint32(materialOffs + 0x0C);

        let textureName: string | null = null;
        if (samplerOffsRel !== 0) {
            const samplerOffs = mainDataOffs + samplerOffsRel;
            const textureEntryOffs = mainDataOffs + view.getUint32(samplerOffs + 0x00);
            const samplerUnk04 = view.getUint32(samplerOffs + 0x04);
            assert(samplerUnk04 === 0x00000000);
            // Again, counts or flags of some form?
            const samplerUnk08 = view.getUint32(samplerOffs + 0x08);

            textureName = readString(buffer, mainDataOffs + view.getUint32(textureEntryOffs + 0x00));
            // Seems to be some byte. Flags?
            const textureEntryUnk04 = view.getUint8(textureEntryOffs + 0x04);
            const textureWidth = view.getUint16(textureEntryOffs + 0x08);
            const textureHeight = view.getUint16(textureEntryOffs + 0x0A);
            const textureEntryUnk0C = view.getUint8(textureEntryOffs + 0x0C);
            assert(textureEntryUnk0C === 0x00);
        }

        // Fake a GX material.
        const texGen0 = {
            index: 0,
            type: GX.TexGenType.MTX2x4,
            source: GX.TexGenSrc.TEX0,
            matrix: GX.TexGenMatrix.IDENTITY,
            normalize: false,
            postMatrix: GX.PostTexGenMatrix.PTIDENTITY
        };
        const texGens = [texGen0];

        const lightChannel0: GX_Material.LightChannelControl = {
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: GX.ColorSrc.VTX },
            colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: GX.ColorSrc.VTX },
        };

        const lightChannels: GX_Material.LightChannelControl[] = [lightChannel0, lightChannel0];

        const tevStage0: GX_Material.TevStage = {
            index: 0,

            channelId: GX.RasColorChannelID.COLOR0A0,

            alphaInA: GX.CombineAlphaInput.ZERO,
            alphaInB: GX.CombineAlphaInput.RASA,
            alphaInC: textureName !== null ? GX.CombineAlphaInput.TEXA : GX.CombineAlphaInput.KONST,
            alphaInD: GX.CombineAlphaInput.ZERO,
            alphaOp: GX.TevOp.ADD,
            alphaBias: GX.TevBias.ZERO,
            alphaClamp: false,
            alphaScale: GX.TevScale.SCALE_1,
            alphaRegId: GX.Register.PREV,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

            colorInA: GX.CombineColorInput.ZERO,
            colorInB: GX.CombineColorInput.RASC,
            colorInC: textureName !== null ? GX.CombineColorInput.TEXC : GX.CombineColorInput.ONE,
            colorInD: GX.CombineColorInput.ZERO,
            colorOp: GX.TevOp.ADD,
            colorBias: GX.TevBias.ZERO,
            colorClamp: false,
            colorScale: GX.TevScale.SCALE_1,
            colorRegId: GX.Register.PREV,
            konstColorSel: GX.KonstColorSel.KCSEL_1,

            texCoordId: GX.TexCoordID.TEXCOORD0,
            texMap: GX.TexMapID.TEXMAP0,

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
        const tevStages: GX_Material.TevStage[] = [tevStage0];

        // Filter any pixels less than 0.1.
        const alphaTest: GX_Material.AlphaTest = {
            op: GX.AlphaOp.AND,
            compareA: GX.CompareType.GEQUAL,
            compareB: GX.CompareType.ALWAYS,
            referenceA: 0.1,
            referenceB: 0.0,
        };

        const blendMode: GX_Material.BlendMode = {
            type: GX.BlendMode.NONE,
            srcFactor: GX.BlendFactor.ONE,
            dstFactor: GX.BlendFactor.ONE,
            logicOp: GX.LogicOp.CLEAR,
        };

        const ropInfo: GX_Material.RopInfo = {
            blendMode,
            depthFunc: GX.CompareType.LESS,
            depthTest: true,
            depthWrite: true,
        };

        const gxMaterial: GX_Material.GXMaterial = {
            index: i, name: '',
            cullMode: GX.CullMode.BACK,
            lightChannels,
            texGens,
            tevStages,
            alphaTest,
            ropInfo,
            indTexStages: [],
        };

        const material: Material = { index: i, name: materialName, textureName, gxMaterial };
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
    const nameStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x08));
    const typeStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x0C));
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
        const rotateX = view.getFloat32(offs + 0x24) * Math.PI / 180;
        const rotateY = view.getFloat32(offs + 0x28) * Math.PI / 180;
        const rotateZ = view.getFloat32(offs + 0x2C) * Math.PI / 180;
        // TODO(jstpierre): Figure out what on earth all of this is.
        const translate1_X = view.getFloat32(offs + 0x30);
        const translate1_Y = view.getFloat32(offs + 0x34);
        const translate1_Z = view.getFloat32(offs + 0x38);
        const translate2_X = view.getFloat32(offs + 0x3C);
        const translate2_Y = view.getFloat32(offs + 0x40);
        const translate2_Z = view.getFloat32(offs + 0x44);
        const translate3_X = view.getFloat32(offs + 0x48);
        const translate3_Y = view.getFloat32(offs + 0x4C);
        const translate3_Z = view.getFloat32(offs + 0x50);

        const transformDebug = {
            scaleX, scaleY, scaleZ,
            rotateX, rotateY, rotateZ,
            translate1_X, translate1_Y, translate1_Z,
            translate2_X, translate2_Y, translate2_Z,
            translate3_X, translate3_Y, translate3_Z,
        };

        const modelMatrix = mat4.create();
        mat4.translate(modelMatrix, modelMatrix, [translate1_X, translate1_Y, translate1_Z]);
        // mat4.scale(modelMatrix, modelMatrix, [scaleX, scaleY, scaleZ]);
        mat4.translate(modelMatrix, modelMatrix, [translate2_X, translate2_Y, translate2_Z]);
        // mat4.rotateZ(modelMatrix, modelMatrix, rotateZ);
        // mat4.rotateY(modelMatrix, modelMatrix, rotateY);
        // mat4.rotateX(modelMatrix, modelMatrix, rotateX);
        mat4.translate(modelMatrix, modelMatrix, [translate3_X, translate3_Y, translate3_Z]);
        mat4.mul(modelMatrix, parentMatrix, modelMatrix);

        const partTableCount = view.getUint32(offs + 0x5C);
        let partTableIdx = offs + 0x60;

        const parts: SceneGraphPart[] = [];
        for (let i = 0; i < partTableCount; i++) {
            const materialOffs = mainDataOffs + view.getUint32(partTableIdx + 0x00);
            const material = assertExists(materialMap.get(materialOffs));

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
                // TODO(jstpierre): Validate, verify?
            };

            let workingBits = vcdBits;

            const vat: GX_VtxAttrFmt[] = [];
            const vcd: GX_VtxDesc[] = [];

            assert((workingBits & VcdBitFlags.POS) !== 0);
            if ((workingBits & VcdBitFlags.POS) !== 0) {
                vat[GX.VertexAttribute.POS] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.POS_XYZ, compShift: 0 };
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
                vat[GX.VertexAttribute.TEX0] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.TEX_ST, compShift: 7 };
                vcd[GX.VertexAttribute.TEX0] = { type: GX.AttrType.INDEX16 };
                workingBits &= ~VcdBitFlags.TEX0;
            }

            if ((workingBits & VcdBitFlags.TEX1) !== 0) {
                vat[GX.VertexAttribute.TEX1] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.TEX_ST, compShift: 7 };
                vcd[GX.VertexAttribute.TEX1] = { type: GX.AttrType.INDEX16 };
                workingBits &= ~VcdBitFlags.TEX1;
            }

            // No bits leftover.
            assert(workingBits === 0);

            const vtxLoader = compileVtxLoader(vat, vcd, { stopAtNull: false });
            const loadedVertexLayout = vtxLoader.loadedVertexLayout;

            interface DrawEntry {
                displayListOffs: number;
                displayListSize: number;
            }

            const drawEntries: DrawEntry[] = [];
            let displayListTableIdx = meshOffs + 0x10;
            for (let i = 0; i < displayListTableCount; i++) {
                const displayListOffs = mainDataOffs + view.getUint32(displayListTableIdx + 0x00);
                const displayListSize = view.getUint32(displayListTableIdx + 0x04);
                drawEntries[i] = { displayListOffs, displayListSize };
                displayListTableIdx += 0x08;
            }

            // Coalesce the entries together.
            for (let i = 1; i < drawEntries.length;) {
                const d0 = drawEntries[i - 1], d1 = drawEntries[i];
                if (d0.displayListOffs + d0.displayListSize === d1.displayListOffs) {
                    d0.displayListSize += d1.displayListSize;
                    drawEntries.splice(i, 1);
                } else {
                    i++;
                }
            }

            assert(drawEntries.length === 1);
            const { displayListOffs, displayListSize } = drawEntries[0];
            const loadedVertexData = vtxLoader.runVertices(vtxArrays, buffer.subarray(displayListOffs, displayListSize));

            const batch: Batch = { loadedVertexLayout, loadedVertexData };

            parts.push({ material, batch });
            partTableIdx += 0x08;
        }

        const children: SceneGraphNode[] = [];
        if (firstChildOffs !== 0) {
            let child = readSceneGraph(mainDataOffs + firstChildOffs, modelMatrix);
            while (child !== null) {
                children.push(child);
                const oldChild = child;
                child = child.nextSibling;
                delete oldChild.nextSibling;
            }
        }

        let nextSibling: SceneGraphNodeInternal | null = null;
        if (nextSiblingOffs !== 0)
            nextSibling = readSceneGraph(mainDataOffs + nextSiblingOffs, parentMatrix);

        return { nameStr, typeStr, transformDebug, modelMatrix, children, nextSibling, parts };
    }

    const rootMatrix = mat4.create();
    const rootNode = readSceneGraph(sceneGraphRootOffs, rootMatrix);
    assert(rootNode.nextSibling === null);
    delete rootNode.nextSibling;

    const information = { versionStr, nameStr, typeStr, dateStr };
    //#endregion

    return { information, textureNameTable, rootNode, materials };
}
