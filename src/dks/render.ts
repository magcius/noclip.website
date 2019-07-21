
// @ts-ignore
import { readFileSync } from 'fs';
import { FLVER, VertexInputSemantic, Material, Primitive, Batch } from "./flver";
import { GfxDevice, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxBufferUsage, GfxBuffer, GfxVertexBufferDescriptor, GfxHostAccessPass, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { coalesceBuffer } from "../gfx/helpers/BufferHelpers";
import { convertToTriangleIndexBuffer, GfxTopology, getTriangleIndexCountForTopologyIndexCount } from "../gfx/helpers/TopologyHelpers";
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyDepth } from "../gfx/render/GfxRenderer";
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import { DDSTextureHolder } from "./dds";
import { nArray, assert, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { mat4, vec4 } from "gl-matrix";
import * as Viewer from "../viewer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { Camera, computeViewMatrix, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import { fillMatrix4x4, fillMatrix4x3, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { AABB } from "../Geometry";
import { ModelHolder, MaterialDataHolder } from "./scenes";
import { MSB, Part } from "./msb";
import { MathConstants, computeNormalMatrix } from "../MathHelpers";
import { MTD } from './mtd';

function shouldRenderPrimitive(primitive: Primitive): boolean {
    return primitive.flags === 0;
}

// TODO(jstpierre): Refactor with BatchData
export class FLVERData {
    public inputStates: GfxInputState[] = [];
    public inputLayouts: GfxInputLayout[] = [];
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

        let indexBufferIndex = 0;
        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            const flverInputState = flver.inputStates[batch.inputStateIndex];
            const coaVertexBuffer = vertexBuffers[batch.inputStateIndex];
            const buffers: GfxVertexBufferDescriptor[] = [{ buffer: coaVertexBuffer.buffer, byteOffset: coaVertexBuffer.wordOffset * 0x04, byteStride: flverInputState.vertexSize }];

            for (let j = 0; j < batch.primitiveIndexes.length; j++) {
                const coaIndexBuffer = indexBuffers[indexBufferIndex++];
                const indexBuffer: GfxVertexBufferDescriptor = { buffer: coaIndexBuffer.buffer, byteOffset: coaIndexBuffer.wordOffset * 0x04, byteStride: 0x02 };
                const inputState = device.createInputState(this.inputLayouts[flverInputState.inputLayoutIndex], buffers, indexBuffer);
                this.inputStates.push(inputState);
            }
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
        for (let i = 0; i < this.inputStates.length; i++)
            device.destroyInputState(this.inputStates[i]);
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
    LSNormal,
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

const textureMapping = nArray(5, () => new TextureMapping());
const scratchVec4 = vec4.create();
class BatchInstance {
    private visible = true;
    private templateRenderInst: GfxRenderInst;
    private renderInsts: GfxRenderInst[] = [];
    private diffuseColor = vec4.fromValues(1, 1, 1, 1);
    private texScroll = nArray(3, () => vec4.create());

    constructor(device: GfxDevice, flverData: FLVERData, renderInstBuilder: GfxRenderInstBuilder, textureHolder: DDSTextureHolder, batch: Batch, material: Material, mtd: MTD, inputStateIndex: number) {
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, DKSProgram.ub_MeshFragParams);

        const program = new DKSProgram();

        // If this is a Phong shader, then turn on lighting.
        if (mtd.shaderPath.includes('_Phn_'))
            program.defines.set('USE_LIGHTING', '1');

        const diffuseTextureName = lookupTextureParameter(material, 'g_Diffuse');
        textureHolder.fillTextureMapping(textureMapping[0], diffuseTextureName);

        const bumpmapTextureName = lookupTextureParameter(material, 'g_Bumpmap');
        if (bumpmapTextureName !== null && textureHolder.hasTexture(bumpmapTextureName)) {
            program.defines.set('USE_BUMPMAP', '1');
            textureHolder.fillTextureMapping(textureMapping[1], bumpmapTextureName);
        }

        const diffuse2TextureName = lookupTextureParameter(material, 'g_Diffuse_2');
        if (diffuse2TextureName) {
            program.defines.set('USE_DIFFUSE_2', '1');
            textureHolder.fillTextureMapping(textureMapping[2], diffuse2TextureName);
        }

        const bumpmap2TextureName = lookupTextureParameter(material, 'g_Bumpmap_2');
        if (bumpmap2TextureName) {
            program.defines.set('USE_BUMPMAP_2', '1');
            textureHolder.fillTextureMapping(textureMapping[3], diffuse2TextureName);
        }

        const lightmapTextureName = lookupTextureParameter(material, 'g_Lightmap');
        if (lightmapTextureName !== null && textureHolder.hasTexture(lightmapTextureName)) {
            program.defines.set('USE_LIGHTMAP', '1');
            textureHolder.fillTextureMapping(textureMapping[4], lightmapTextureName);
        }

        const blendMode = getBlendMode(mtd);
        let isTranslucent = false;
        if (blendMode === BlendMode.Normal) {
            // Default
        } else if (blendMode === BlendMode.Blend) {
            this.templateRenderInst.setMegaStateFlags({
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                depthWrite: false,
            });
            isTranslucent = true;
        } else if (blendMode === BlendMode.Add) {
            this.templateRenderInst.setMegaStateFlags({
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
                depthWrite: false,
            });
            isTranslucent = true;
        } else if (blendMode === BlendMode.TexEdge) {
            program.defines.set('USE_ALPHATEST', '1');
        } else {
            console.warn(`Unknown blend mode ${blendMode}`);
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

        this.templateRenderInst.setGfxProgram(device.createProgram(program));
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(textureMapping);

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.templateRenderInst.sortKey = makeSortKey(layer, 0);

        for (let j = 0; j < batch.primitiveIndexes.length; j++) {
            const primitive = flverData.flver.primitives[batch.primitiveIndexes[j]];
            const inputState = flverData.inputStates[inputStateIndex++];
            if (!shouldRenderPrimitive(primitive))
                continue;
            const renderInst = renderInstBuilder.pushRenderInst();
            renderInst.inputState = inputState;
            if (primitive.cullMode)
                renderInst.setMegaStateFlags({ cullMode: GfxCullMode.BACK });
            renderInst.drawIndexes(getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRISTRIP, primitive.indexCount));
            this.renderInsts.push(renderInst);
        }

        renderInstBuilder.popTemplateRenderInst();
    }

    public prepareToRender(meshFragParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput, visible: boolean, modelMatrix: mat4): void {
        visible = visible && this.visible;

        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i].visible = visible;

        if (visible) {
            const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch);

            for (let i = 0; i < this.renderInsts.length; i++)
                this.renderInsts[i].sortKey = setSortKeyDepth(this.renderInsts[i].sortKey, depth);

            let offs = this.templateRenderInst.getUniformBufferOffset(DKSProgram.ub_MeshFragParams);
            const d = meshFragParamsBuffer.mapBufferF32(offs, 12*2 + 4*4);

            computeViewMatrix(matrixScratch, viewerInput.camera);
            mat4.mul(matrixScratch, matrixScratch, modelMatrix);
            offs += fillMatrix4x3(d, offs, matrixScratch);

            computeNormalMatrix(matrixScratch, modelMatrix, false);
            offs += fillMatrix4x3(d, offs, matrixScratch);

            offs += fillMatrix4x3(d, offs, modelMatrix);

            offs += fillVec4v(d, offs, this.diffuseColor);

            const scrollTime = viewerInput.time / 30;
            offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[0], scrollTime));
            offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[1], scrollTime));
            offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[2], scrollTime));
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.templateRenderInst.gfxProgram!);
    }
}

const matrixScratch = mat4.create();
const bboxScratch = new AABB();
export class FLVERInstance {
    private batchInstances: BatchInstance[] = [];
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, textureHolder: DDSTextureHolder, materialDataHolder: MaterialDataHolder, public flverData: FLVERData) {
        let inputStateIndex = 0, nextInputStateIndex = 0;
        for (let i = 0; i < this.flverData.flver.batches.length; i++) {
            const batch = this.flverData.flver.batches[i];
            const material = this.flverData.flver.materials[batch.materialIndex];
    
            inputStateIndex = nextInputStateIndex;
            nextInputStateIndex += batch.primitiveIndexes.length;

            const diffuseTextureName = lookupTextureParameter(material, 'g_Diffuse');

            // TODO(jstpierre): Implement untextured materials.
            if (diffuseTextureName === null || !textureHolder.hasTexture(diffuseTextureName))
                continue;

            const mtdFilePath = material.mtdName;
            const mtdName = mtdFilePath.split('\\').pop();
            const mtd = materialDataHolder.getMaterial(mtdName);

            this.batchInstances.push(new BatchInstance(device, flverData, renderInstBuilder, textureHolder, batch, material, mtd, inputStateIndex));
        }
        assert(nextInputStateIndex === this.flverData.inputStates.length);
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(meshFragParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput): void {
        let visible = this.visible;
        if (visible) {
            bboxScratch.transform(this.flverData.flver.bbox, this.modelMatrix);
            visible = viewerInput.camera.frustum.contains(bboxScratch);
        }

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(meshFragParamsBuffer, viewerInput, visible, this.modelMatrix);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].destroy(device);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

export class MSBRenderer {
    private sceneParamsBuffer: GfxRenderBuffer;
    private meshFragParamsBuffer: GfxRenderBuffer;
    private templateRenderInst: GfxRenderInst;
    public renderInstBuilder: GfxRenderInstBuilder;
    public flverInstances: FLVERInstance[] = [];

    constructor(device: GfxDevice, private textureHolder: DDSTextureHolder, private modelHolder: ModelHolder, private materialDataHolder: MaterialDataHolder, private msb: MSB) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.meshFragParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MeshFragParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 5 }, // Shape
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.meshFragParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, DKSProgram.programReflection, bindingLayouts, uniformBuffers);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, DKSProgram.ub_SceneParams);

        for (let i = 0; i < msb.parts.length; i++) {
            const part = msb.parts[i];
            if (part.type === 0) {
                const flverData = this.modelHolder.flverData[part.modelIndex];
                if (flverData === undefined)
                    continue;

                const instance = new FLVERInstance(device, this.renderInstBuilder, this.textureHolder, this.materialDataHolder, flverData);
                instance.name = part.name;
                this.modelMatrixFromPart(instance.modelMatrix, part);
                this.flverInstances.push(instance);
            }
        }
    }

    private modelMatrixFromPart(m: mat4, part: Part): void {
        const modelScale = 100;
        // Game uses +x = left convention for some reason.
        mat4.scale(m, m, [-modelScale, modelScale, modelScale]);

        mat4.translate(m, m, part.translation);
        mat4.rotateX(m, m, part.rotation[0] * MathConstants.DEG_TO_RAD);
        mat4.rotateY(m, m, part.rotation[1] * MathConstants.DEG_TO_RAD);
        mat4.rotateZ(m, m, part.rotation[2] * MathConstants.DEG_TO_RAD);
        mat4.scale(m, m, part.scale);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        const offs = this.templateRenderInst.getUniformBufferOffset(DKSProgram.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].prepareToRender(this.meshFragParamsBuffer, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.meshFragParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.meshFragParamsBuffer.destroy(device);

        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].destroy(device);
    }
}
