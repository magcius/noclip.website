
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import { mat4, vec3, quat } from "gl-matrix";

import * as GX from "../gx/gx_enum";
import { compileVtxLoader, GX_VtxAttrFmt, GX_VtxDesc, GX_Array, LoadedVertexData, LoadedVertexLayout, getAttributeByteSize } from '../gx/gx_displaylist';
import * as GX_Material from '../gx/gx_material';
import { AABB } from "../Geometry";

export interface BIN {
    samplers: Sampler[];
    rootNode: SceneGraphNode;
    name: string;
}

interface Texture {
    width: number;
    height: number;
    format: GX.TexFormat;
    data: ArrayBufferSlice;
}

export interface Sampler {
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    texture: Texture;
}

export interface Material {
    gxMaterial: GX_Material.GXMaterial;
    samplerIndexes: number[];
}

export interface Batch {
    vat: GX_VtxAttrFmt[];
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
}

export interface SceneGraphPart {
    material: Material;
    batch: Batch;
}

export interface SceneGraphNode {
    children: SceneGraphNode[];
    modelMatrix: mat4;
    bbox: AABB | null;
    parts: SceneGraphPart[];
}

export function parse(buffer: ArrayBufferSlice, name: string): BIN {
    const view = buffer.createDataView();

    const version = view.getUint8(0x00);
    assert(version === 0x01 || version === 0x02);

    const internalName = readString(buffer, 0x01, 0x0B);

    const textureChunkOffs = view.getUint32(0x0C, false);
    const samplerChunkOffs = view.getUint32(0x10, false);
    const materialChunkOffs = view.getUint32(0x34, false);
    const batchChunkOffs = view.getUint32(0x38, false);
    const sceneGraphChunkOffs = view.getUint32(0x3C, false);

    const positionBufferOffs = view.getUint32(0x14, false);
    const tex0BufferOffs = view.getUint32(0x24, false);

    function parseTexture(index: number): Texture {
        const offs = textureChunkOffs + (0x0C * index);
        const width = view.getUint16(offs + 0x00, false);
        const height = view.getUint16(offs + 0x02, false);
        const format = view.getUint8(offs + 0x04);

        const textureDataOffs = view.getUint32(offs + 0x08, false);
        const data = buffer.slice(textureChunkOffs + textureDataOffs);
        return { width, height, format, data };
    }

    function parseSampler(index: number): Sampler {
        const offs = samplerChunkOffs + (0x14 * index);
        const textureIndex = view.getUint16(offs + 0x00);
        const texture = parseTexture(textureIndex);
        const wrapS: GX.WrapMode = view.getUint8(offs + 0x04);
        const wrapT: GX.WrapMode = view.getUint8(offs + 0x04);
        return { texture, wrapS, wrapT };
    }

    const samplers: Sampler[] = [];
    function ensureSampler(index: number) {
        if (!samplers[index])
            samplers[index] = parseSampler(index);
    }

    function parseBatch(index: number): Batch | null {
        const offs = batchChunkOffs + (0x18 * index);

        // Not used in-game.
        const triangleCount = view.getUint16(offs + 0x00, false);
        const displayListSize = view.getUint16(offs + 0x02, false) * 0x20;
        const attributes = view.getUint32(offs + 0x04, false);

        // WTF. Shouldn't this be in the material?
        const bumpMap = view.getUint8(offs + 0x08);
        const cullMode: GX.CullMode = view.getUint8(offs + 0x09);
        const texGenCount = view.getUint8(offs + 0x0A);
        const nbt3 = view.getUint8(offs + 0x0B);

        const displayListOffset = batchChunkOffs + view.getUint32(offs + 0x0C, false);

        const vat: GX_VtxAttrFmt[] = [];

        // Should always have position.
        assert((attributes & (1 << GX.VertexAttribute.POS)) !== 0);
        vat[GX.VertexAttribute.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.S16, compShift: 0 };
        // Should always have tex0.
        if (!(attributes & (1 << GX.VertexAttribute.TEX0))) {
            // If we don't have TEX0, then skip this batch...
            console.warn(`Batch ${index} does not have TEX0. WTF? / Attributes: ${attributes.toString(16)}`);
            return null;
        }
        vat[GX.VertexAttribute.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift: 0 };
        vat[GX.VertexAttribute.NRM] = { compCnt: nbt3 ? GX.CompCnt.NRM_NBT3 : GX.CompCnt.NRM_NBT, compType: GX.CompType.F32, compShift: 0 };

        // Set up our input vertex description.
        const vcd: GX_VtxDesc[] = [];
        for (let i = 0; i <= GX.VertexAttribute.MAX; i++) {
            if ((attributes & (1 << i)) !== 0) {
                // Only care about TEX0 and POS for now...
                const enableOutput = (i === GX.VertexAttribute.POS || i === GX.VertexAttribute.TEX0);
                vcd[i] = { type: GX.AttrType.INDEX16, enableOutput };
            }
        }

        const vtxLoader = compileVtxLoader(vat, vcd);
        const loadedVertexLayout = vtxLoader.loadedVertexLayout;
        const displayListBuffer = buffer.subarray(displayListOffset, displayListSize);

        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.VertexAttribute.POS] = { buffer, offs: positionBufferOffs,stride: getAttributeByteSize(vat, GX.VertexAttribute.POS) };
        vtxArrays[GX.VertexAttribute.TEX0] = { buffer, offs: tex0BufferOffs, stride: getAttributeByteSize(vat, GX.VertexAttribute.TEX0) };

        let loadedVertexData;
        try {
            loadedVertexData = vtxLoader.runVertices(vtxArrays, displayListBuffer);
        } catch(e) {
            // Could not parse batch.
            console.warn(`Batch ${index} had parse error: ${e} / Attributes: ${attributes.toString(16)}`);
            return null;
        }

        return { vat, loadedVertexLayout, loadedVertexData };
    }

    function parseMaterial(index: number): Material {
        const offs = materialChunkOffs + (0x28 * index);

        // TODO(jstpierre): diffuse color

        const samplerIndexes: number[] = [];
        for (let i = 0; i < 8; i++) {
            const samplerIndex = view.getInt16(offs + 0x08 + (i * 0x02), false);
            samplerIndexes.push(samplerIndex);

            if (samplerIndex >= 0)
                ensureSampler(samplerIndex);
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
            alphaChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: GX.ColorSrc.VTX, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
            colorChannel: { lightingEnabled: false, ambColorSource: GX.ColorSrc.VTX, matColorSource: GX.ColorSrc.VTX, litMask: 0, diffuseFunction: GX.DiffuseFunction.NONE, attenuationFunction: GX.AttenuationFunction.NONE },
        };

        const lightChannels: GX_Material.LightChannelControl[] = [lightChannel0, lightChannel0];

        const tevStage0: GX_Material.TevStage = {
            channelId: GX.RasColorChannelID.COLOR0A0,

            alphaInA: GX.CombineAlphaInput.ZERO,
            alphaInB: GX.CombineAlphaInput.ZERO,
            alphaInC: GX.CombineAlphaInput.ZERO,
            alphaInD: GX.CombineAlphaInput.TEXA,
            alphaOp: GX.TevOp.ADD,
            alphaBias: GX.TevBias.ZERO,
            alphaClamp: false,
            alphaScale: GX.TevScale.SCALE_1,
            alphaRegId: GX.Register.PREV,
            konstAlphaSel: GX.KonstAlphaSel.KASEL_1,

            colorInA: GX.CombineColorInput.ZERO,
            colorInB: GX.CombineColorInput.ZERO,
            colorInC: GX.CombineColorInput.ZERO,
            colorInD: GX.CombineColorInput.TEXC,
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
            name: `${name} unknown material ${index}`,
            cullMode: GX.CullMode.BACK,
            lightChannels,
            texGens,
            tevStages,
            alphaTest,
            ropInfo,
            indTexStages: [],
        };

        return { gxMaterial, samplerIndexes };
    }

    function traverseSceneGraph(parentNode: SceneGraphNode, nodeIndex: number): void {
        const nodeOffs = sceneGraphChunkOffs + (0x8C * nodeIndex);

        const parentIndex = view.getInt16(nodeOffs + 0x00, false);
        const firstChildIndex = view.getInt16(nodeOffs + 0x02, false);
        const nextSiblingIndex = view.getInt16(nodeOffs + 0x04, false);
        const prevSiblingIndex = view.getInt16(nodeOffs + 0x06, false);

        // view.getUint8(nodeOffs + 0x08);
        const flags = view.getUint8(nodeOffs + 0x09);
        // view.getUint16(node.offs + 0x0A);

        const modelMatrix = mat4.create();
        const scaleX = view.getFloat32(nodeOffs + 0x0C, false);
        const scaleY = view.getFloat32(nodeOffs + 0x10, false);
        const scaleZ = view.getFloat32(nodeOffs + 0x14, false);

        const rotationX = view.getFloat32(nodeOffs + 0x18, false);
        const rotationY = view.getFloat32(nodeOffs + 0x1C, false);
        const rotationZ = view.getFloat32(nodeOffs + 0x20, false);

        const translationX = view.getFloat32(nodeOffs + 0x24, false);
        const translationY = view.getFloat32(nodeOffs + 0x28, false);
        const translationZ = view.getFloat32(nodeOffs + 0x2C, false);

        const bboxMinX = view.getFloat32(nodeOffs + 0x30, false);
        const bboxMinY = view.getFloat32(nodeOffs + 0x34, false);
        const bboxMinZ = view.getFloat32(nodeOffs + 0x38, false);
        const bboxMaxX = view.getFloat32(nodeOffs + 0x3C, false);
        const bboxMaxY = view.getFloat32(nodeOffs + 0x40, false);
        const bboxMaxZ = view.getFloat32(nodeOffs + 0x44, false);
        // const unk = view.getFloat32(nodeOffs + 0x48, false);

        let bbox: AABB | null = null;
        if (bboxMinX !== 0 || bboxMinY !== 0 || bboxMinZ !== 0 || bboxMaxX !== 0 || bboxMaxY !== 0 || bboxMaxZ !== 0) {
            bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
        }

        const scale = vec3.fromValues(scaleX, scaleY, scaleZ);
        const rotation = quat.create();
        quat.fromEuler(rotation, rotationX, rotationY, rotationZ);
        const translation = vec3.fromValues(translationX, translationY, translationZ);

        mat4.fromRotationTranslationScale(modelMatrix, rotation, translation, scale);

        // Flatten matrix hierarchy.
        mat4.mul(modelMatrix, parentNode.modelMatrix, modelMatrix);

        const parts: SceneGraphPart[] = [];
        const partCount = view.getUint16(nodeOffs + 0x4C, false);
        let partTableIdx = sceneGraphChunkOffs + view.getUint32(nodeOffs + 0x50, false);
        for (let i = 0; i < partCount; i++) {
            const materialIndex: number = view.getUint16(partTableIdx + 0x00, false);
            const batchIndex: number = view.getUint16(partTableIdx + 0x02, false);

            partTableIdx += 0x04;

            const material = parseMaterial(materialIndex);
            const batch = parseBatch(batchIndex);
            if (batch === null)
                continue;

            parts.push({ material, batch });
        }

        const children: SceneGraphNode[] = [];
        const node: SceneGraphNode = { children, modelMatrix, bbox, parts };

        // Add ourselves to parent.
        parentNode.children.push(node);

        // Parse children
        if (firstChildIndex >= 0)
            traverseSceneGraph(node, firstChildIndex);

        // Advance to next sibling.
        if (nextSiblingIndex >= 0)
            traverseSceneGraph(parentNode, nextSiblingIndex);
    }

    // Create a fake root node to be parent to the root nodes.
    const rootNode: SceneGraphNode = { children: [], modelMatrix: mat4.create(), bbox: null, parts: [] };
    traverseSceneGraph(rootNode, 0);

    const bin: BIN = { rootNode, samplers, name };
    return bin;
}
