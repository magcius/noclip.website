
// @ts-ignore
import { readFileSync } from 'fs';
import { FLVER, VertexInputSemantic, Material, Primitive, Batch } from "./flver";
import { GfxDevice, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxBufferUsage, GfxBuffer, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { coalesceBuffer, GfxCoalescedBuffer } from "../gfx/helpers/BufferHelpers";
import { convertToTriangleIndexBuffer, GfxTopology, getTriangleIndexCountForTopologyIndexCount } from "../gfx/helpers/TopologyHelpers";
import { makeSortKey, GfxRendererLayer, setSortKeyDepth } from "../gfx/render/GfxRenderer";
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import { DDSTextureHolder } from "./dds";
import { nArray, assert, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { mat4, vec4 } from "gl-matrix";
import * as Viewer from "../viewer";
import { Camera, computeViewMatrix, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import { fillMatrix4x4, fillMatrix4x3, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { AABB } from "../Geometry";
import { ModelHolder, MaterialDataHolder } from "./scenes";
import { MSB, Part } from "./msb";
import { MathConstants, computeNormalMatrix } from "../MathHelpers";
import { MTD } from './mtd';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer2';

function shouldRenderPrimitive(primitive: Primitive): boolean {
    return primitive.flags === 0;
}

class BatchData {
    public inputStates: GfxInputState[] = [];

    constructor(device: GfxDevice, flverData: FLVERData, public batch: Batch, vertexBuffer: GfxCoalescedBuffer, indexBuffers: GfxCoalescedBuffer[]) {
        const flverInputState = flverData.flver.inputStates[batch.inputStateIndex];
        const buffers: GfxVertexBufferDescriptor[] = [{ buffer: vertexBuffer.buffer, byteOffset: vertexBuffer.wordOffset * 0x04, byteStride: flverInputState.vertexSize }];

        for (let j = 0; j < batch.primitiveIndexes.length; j++) {
            const coaIndexBuffer = indexBuffers.shift();
            const indexBuffer: GfxVertexBufferDescriptor = { buffer: coaIndexBuffer.buffer, byteOffset: coaIndexBuffer.wordOffset * 0x04, byteStride: 0x02 };
            const inputState = device.createInputState(flverData.inputLayouts[flverInputState.inputLayoutIndex], buffers, indexBuffer);
            this.inputStates.push(inputState);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.inputStates.length; i++)
            device.destroyInputState(this.inputStates[i]);
    }
}

// TODO(jstpierre): Refactor with BatchData
export class FLVERData {
    public inputLayouts: GfxInputLayout[] = [];
    public batchData: BatchData[] = [];
    private indexBuffer: GfxBuffer;
    private vertexBuffer: GfxBuffer;

    constructor(device: GfxDevice, public flver: FLVER) {
        for (let i = 0; i < flver.inputLayouts.length; i++) {
            const inputLayout = flver.inputLayouts[i];

            const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

            for (let j = 0; j < inputLayout.vertexAttributes.length; j++) {
                const vertexAttributes = inputLayout.vertexAttributes[j];
                const location = this.translateSemantic(vertexAttributes.semantic);
                if (location < 0)
                    continue;

                vertexAttributeDescriptors.push({
                    location,
                    format: this.translateDataType(vertexAttributes.dataType),
                    bufferByteOffset: vertexAttributes.offset,
                    bufferIndex: 0,
                    frequency: GfxVertexAttributeFrequency.PER_VERTEX,
                });
            }

            this.inputLayouts[i] = device.createInputLayout({
                indexBufferFormat: GfxFormat.U16_R,
                vertexAttributeDescriptors,
            });
        }

        const vertexBufferDatas: ArrayBufferSlice[] = [];
        const indexBufferDatas: ArrayBufferSlice[] = [];
        for (let i = 0; i < flver.inputStates.length; i++)
            vertexBufferDatas.push(flver.inputStates[i].vertexData);
        const vertexBuffers = coalesceBuffer(device, GfxBufferUsage.VERTEX, vertexBufferDatas);
        this.vertexBuffer = vertexBuffers[0].buffer;

        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            for (let j = 0; j < batch.primitiveIndexes.length; j++) {
                const primitive = flver.primitives[batch.primitiveIndexes[j]];
                const triangleIndexData = convertToTriangleIndexBuffer(GfxTopology.TRISTRIP, primitive.indexData.createTypedArray(Uint16Array));
                indexBufferDatas.push(new ArrayBufferSlice(triangleIndexData.buffer));
            }
        }

        const indexBuffers = coalesceBuffer(device, GfxBufferUsage.INDEX, indexBufferDatas);
        this.indexBuffer = indexBuffers[0].buffer;

        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            const coaVertexBuffer = vertexBuffers[batch.inputStateIndex];
            const batchData = new BatchData(device, this, batch, coaVertexBuffer, indexBuffers);
            this.batchData.push(batchData);
        }
    }

    private translateSemantic(semantic: VertexInputSemantic): number {
        switch (semantic) {
        case VertexInputSemantic.Position:  return DKSProgram.a_Position;
        case VertexInputSemantic.Color:     return DKSProgram.a_Color;
        case VertexInputSemantic.UV:        return DKSProgram.a_TexCoord;
        case VertexInputSemantic.Normal:    return DKSProgram.a_Normal;
        case VertexInputSemantic.Tangent:   return DKSProgram.a_Tangent;
        case VertexInputSemantic.Bitangent: return DKSProgram.a_Bitangent;
        default: return -1;
        }
    }

    private translateDataType(dataType: number): GfxFormat {
        switch (dataType) {
            case 17:
                // Bone indices -- four bytes.
                return GfxFormat.U8_RGBA_NORM;
            case 19:
                // Colors and normals -- four bytes.
                return GfxFormat.U8_RGBA_NORM;
            case 21:
                // One set of UVs -- two shorts.
                return GfxFormat.S16_RG;
            case 22:
                // Two sets of UVs -- four shorts.
                return GfxFormat.S16_RGBA;
            case 26:
                // Bone weight -- four shorts.
                return GfxFormat.S16_RGBA_NORM;
            case 2:
            case 18:
            case 20:
            case 23:
            case 24:
            case 25:
                // Everything else -- three floats.
                return GfxFormat.F32_RGBA;
            default:
                throw "whoops";
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);

        for (let i = 0; i < this.inputLayouts.length; i++)
            device.destroyInputLayout(this.inputLayouts[i]);
        for (let i = 0; i < this.batchData.length; i++)
            this.batchData[i].destroy(device);
    }
}

class DKSProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_Normal = 3;
    public static a_Tangent = 4;
    public static a_Bitangent = 5;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    private static program = readFileSync('src/dks/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(DKSProgram.program);
    public both = DKSProgram.program;
}

function lookupTextureParameter(material: Material, paramName: string): string | null {
    const param = material.parameters.find((param) => param.name === paramName);
    if (param === undefined)
        return null;
    return param.value.split('\\').pop()!.replace(/\.tga|\.psd/, '');
}

const enum BlendMode {
    Normal,
    TexEdge,
    Blend,
    Water,
    Add,
    Sub,
    Mul,
    AddMul,
    SubMul,
    WaterWave,

    // Below are "linear space" variants, but as far as the community can tell, all lighting is in linear space.
    // It's likely that these were used at some point during development and the values were never removed.
    LSNormal = 0x20,
    LSTexEdge,
    LSBlend,
    LSWater,
    LSAdd,
    LSSub,
    LSMul,
    LSAddMul,
    LSSubMul,
    LSWaterWave,
};

function getMaterialParam(mtd: MTD, name: string): number[] | null {
    const params = mtd.params.find((param) => param.name === name);
    return params !== undefined ? params.value : null;
}

function getBlendMode(mtd: MTD): BlendMode {
    const v = assertExists(getMaterialParam(mtd, 'g_BlendMode'));
    assert(v.length === 1);
    let blendMode: BlendMode = v[0];

    // Remove LS
    if (blendMode >= BlendMode.LSNormal)
        blendMode -= BlendMode.LSNormal;

    return blendMode;
}

const scratchVec4 = vec4.create();
class BatchInstance {
    private visible = true;
    private diffuseColor = vec4.fromValues(1, 1, 1, 1);
    private texScroll = nArray(3, () => vec4.create());
    private textureMapping = nArray(5, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor>;
    private gfxProgram: GfxProgram;
    private sortKey: number;

    constructor(device: GfxDevice, private flverData: FLVERData, private batchData: BatchData, textureHolder: DDSTextureHolder, material: Material, mtd: MTD) {
        const program = new DKSProgram();

        // If this is a Phong shader, then turn on lighting.
        if (mtd.shaderPath.includes('_Phn_'))
            program.defines.set('USE_LIGHTING', '1');

        const diffuseTextureName = lookupTextureParameter(material, 'g_Diffuse');
        textureHolder.fillTextureMapping(this.textureMapping[0], diffuseTextureName);

        const bumpmapTextureName = lookupTextureParameter(material, 'g_Bumpmap');
        if (bumpmapTextureName !== null && textureHolder.hasTexture(bumpmapTextureName)) {
            program.defines.set('USE_BUMPMAP', '1');
            textureHolder.fillTextureMapping(this.textureMapping[1], bumpmapTextureName);
        }

        const diffuse2TextureName = lookupTextureParameter(material, 'g_Diffuse_2');
        if (diffuse2TextureName) {
            program.defines.set('USE_DIFFUSE_2', '1');
            textureHolder.fillTextureMapping(this.textureMapping[2], diffuse2TextureName);
        }

        const bumpmap2TextureName = lookupTextureParameter(material, 'g_Bumpmap_2');
        if (bumpmap2TextureName) {
            program.defines.set('USE_BUMPMAP_2', '1');
            textureHolder.fillTextureMapping(this.textureMapping[3], bumpmap2TextureName);
        }

        const lightmapTextureName = lookupTextureParameter(material, 'g_Lightmap');
        if (lightmapTextureName !== null && textureHolder.hasTexture(lightmapTextureName)) {
            program.defines.set('USE_LIGHTMAP', '1');
            textureHolder.fillTextureMapping(this.textureMapping[4], lightmapTextureName);
        }

        const blendMode = getBlendMode(mtd);
        let isTranslucent = false;
        if (blendMode === BlendMode.Normal) {
            // Default
            this.megaState = {};
        } else if (blendMode === BlendMode.Blend) {
            this.megaState = {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                depthWrite: false,
            };
            isTranslucent = true;
        } else if (blendMode === BlendMode.Add) {
            this.megaState = {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
                depthWrite: false,
            };
            isTranslucent = true;
        } else if (blendMode === BlendMode.TexEdge) {
            this.megaState = {};
            program.defines.set('USE_ALPHATEST', '1');
        } else {
            this.megaState = {};
            console.warn(`Unknown blend mode ${blendMode} in material ${material.mtdName}`);
        }

        const diffuseMapColor = getMaterialParam(mtd, 'g_DiffuseMapColor');
        if (diffuseMapColor !== undefined) {
            const diffuseMapColorPower = assertExists(getMaterialParam(mtd, `g_DiffuseMapColorPower`))[0];
            vec4.set(this.diffuseColor, diffuseMapColor[0], diffuseMapColor[1], diffuseMapColor[2], diffuseMapColorPower);
        }

        for (let i = 0; i < 3; i++) {
            const param = getMaterialParam(mtd, `g_TexScroll_${i}`);
            if (param)
                vec4.set(this.texScroll[i], param[0], param[1], 0, 0);
        }

        this.gfxProgram = device.createProgram(program);

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKey(layer, 0);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setGfxProgram(this.gfxProgram);

        let offs = template.allocateUniformBuffer(DKSProgram.ub_MeshFragParams, 12*3 + 4*4);
        const d = template.mapUniformBufferF32(DKSProgram.ub_MeshFragParams);

        computeViewMatrix(matrixScratch, viewerInput.camera);
        mat4.mul(matrixScratch, matrixScratch, modelMatrix);
        offs += fillMatrix4x3(d, offs, matrixScratch);

        computeNormalMatrix(matrixScratch, modelMatrix, false);
        offs += fillMatrix4x3(d, offs, matrixScratch);

        offs += fillMatrix4x3(d, offs, modelMatrix);

        offs += fillVec4v(d, offs, this.diffuseColor);

        const scrollTime = viewerInput.time / 120;
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[0], scrollTime));
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[1], scrollTime));
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[2], scrollTime));

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch);

        for (let j = 0; j < this.batchData.batch.primitiveIndexes.length; j++) {
            const primitive = this.flverData.flver.primitives[this.batchData.batch.primitiveIndexes[j]];
            if (!shouldRenderPrimitive(primitive))
                continue;

            const inputState = this.flverData.flver.inputStates[this.batchData.batch.inputStateIndex];
            const gfxInputState = this.batchData.inputStates[j];
            const gfxInputLayout = this.flverData.inputLayouts[inputState.inputLayoutIndex];

            const renderInst = renderInstManager.pushRenderInst();
            renderInst.setInputLayoutAndState(gfxInputLayout, gfxInputState);
            renderInst.setMegaStateFlags(this.megaState);
            if (primitive.cullMode)
                renderInst.getMegaStateFlags().cullMode = GfxCullMode.BACK;
            renderInst.drawIndexes(getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRISTRIP, primitive.indexCount));
            renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
    }
}

const matrixScratch = mat4.create();
const bboxScratch = new AABB();
export class FLVERInstance {
    private batchInstances: BatchInstance[] = [];
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;

    constructor(device: GfxDevice, textureHolder: DDSTextureHolder, materialDataHolder: MaterialDataHolder, public flverData: FLVERData) {
        for (let i = 0; i < this.flverData.flver.batches.length; i++) {
            const batchData = this.flverData.batchData[i];
            const batch = batchData.batch;
            const material = this.flverData.flver.materials[batch.materialIndex];

            const diffuseTextureName = lookupTextureParameter(material, 'g_Diffuse');

            // TODO(jstpierre): Implement untextured materials.
            if (diffuseTextureName === null || !textureHolder.hasTexture(diffuseTextureName))
                continue;

            const mtdFilePath = material.mtdName;
            const mtdName = mtdFilePath.split('\\').pop();
            const mtd = materialDataHolder.getMaterial(mtdName);

            this.batchInstances.push(new BatchInstance(device, flverData, batchData, textureHolder, material, mtd));
        }
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        bboxScratch.transform(this.flverData.flver.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bboxScratch))
            return;

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].destroy(device);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 5 },
];

function modelMatrixFromPart(m: mat4, part: Part): void {
    const modelScale = 100;

    // Game uses +x = left convention for some reason.
    mat4.scale(m, m, [-modelScale, modelScale, modelScale]);

    mat4.translate(m, m, part.translation);
    mat4.rotateX(m, m, part.rotation[0] * MathConstants.DEG_TO_RAD);
    mat4.rotateY(m, m, part.rotation[1] * MathConstants.DEG_TO_RAD);
    mat4.rotateZ(m, m, part.rotation[2] * MathConstants.DEG_TO_RAD);
    mat4.scale(m, m, part.scale);
}

export class MSBRenderer {
    public flverInstances: FLVERInstance[] = [];

    constructor(device: GfxDevice, private textureHolder: DDSTextureHolder, private modelHolder: ModelHolder, private materialDataHolder: MaterialDataHolder, private msb: MSB) {
        for (let i = 0; i < msb.parts.length; i++) {
            const part = msb.parts[i];
            if (part.type === 0) {
                const flverData = this.modelHolder.flverData[part.modelIndex];
                if (flverData === undefined)
                    continue;

                const instance = new FLVERInstance(device, this.textureHolder, this.materialDataHolder, flverData);
                instance.name = part.name;
                modelMatrixFromPart(instance.modelMatrix, part);
                this.flverInstances.push(instance);
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        const offs = template.allocateUniformBuffer(DKSProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(DKSProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].destroy(device);
    }
}
