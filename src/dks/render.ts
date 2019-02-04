
import { FLVER, VertexInputSemantic, Material } from "./flver";
import { GfxDevice, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxBufferUsage, GfxBuffer, GfxVertexBufferDescriptor, GfxProgram, GfxHostAccessPass, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { coalesceBuffer } from "../gfx/helpers/BufferHelpers";
import { convertToTriangleIndexBuffer, GfxTopology, getTriangleIndexCountForTopologyIndexCount } from "../gfx/helpers/TopologyHelpers";
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyDepth } from "../gfx/render/GfxRenderer";
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import { DDSTextureHolder } from "./dds";
import { nArray, assert } from "../util";
import { TextureMapping } from "../TextureHolder";
import { mat4 } from "gl-matrix";
import * as Viewer from "../viewer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { Camera, computeViewMatrix, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import { fillMatrix4x4, fillMatrix4x3 } from "../gfx/helpers/UniformBufferHelpers";
import { AABB } from "../Geometry";

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
        case VertexInputSemantic.Position: return DKSProgram.a_Position;
        case VertexInputSemantic.Color:    return DKSProgram.a_Color;
        case VertexInputSemantic.UV:       return DKSProgram.a_TexCoord;
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

// @ts-ignore
import { readFileSync } from 'fs';

class DKSProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    private static program = readFileSync('src/dks/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(DKSProgram.program);
    public both = DKSProgram.program;
}

function lookupTextureParameter(material: Material, paramName: string): string | null {
    const param = material.parameters.find((param) => param.name === paramName);

    // XXX(jstpierre): wtf do I do?
    if (param == null)
        return null;

    return param.value.split('\\').pop().replace(/\.tga|\.psd/, '');
}

const matrixScratch = mat4.create();
const bboxScratch = new AABB();
export class FLVERInstance {
    private templateRenderInst: GfxRenderInst;
    private batchTemplateRenderInsts: GfxRenderInst[] = [];
    private renderInsts: GfxRenderInst[] = [];
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, textureHolder: DDSTextureHolder, public flverData: FLVERData) {
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, DKSProgram.ub_MeshFragParams);
        const textureMapping = nArray(2, () => new TextureMapping());

        let inputStateIndex = 0, nextInputStateIndex = 0;
        for (let i = 0; i < this.flverData.flver.batches.length; i++) {
            const batch = this.flverData.flver.batches[i];
            const material = this.flverData.flver.materials[batch.materialIndex];

            inputStateIndex = nextInputStateIndex;
            nextInputStateIndex += batch.primitiveIndexes.length;

            const diffuseTextureName = lookupTextureParameter(material, 'g_Diffuse');

            // XXX(jstpierre): wtf do I do?
            if (diffuseTextureName === null || !textureHolder.hasTexture(diffuseTextureName))
                continue;

            const batchTemplateRenderInst = renderInstBuilder.pushTemplateRenderInst();
            textureHolder.fillTextureMapping(textureMapping[0], diffuseTextureName);

            const program = new DKSProgram();

            let lightmapTextureName = lookupTextureParameter(material, 'g_Lightmap');
            if (lightmapTextureName !== null && textureHolder.hasTexture(lightmapTextureName)) {
                program.defines.set('USE_LIGHTMAP', '1');
                textureHolder.fillTextureMapping(textureMapping[1], lightmapTextureName);
            }

            // TODO(jstpierre): Until we can parse out MTDs, just rely on this hack for now.
            const hasAlphaBlend = material.mtdName.includes('_Add') || material.mtdName.includes('_Edge');
            if (hasAlphaBlend) {
                batchTemplateRenderInst.setMegaStateFlags({
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                    depthWrite: false,
                });
            }

            const hasAlphaTest = material.mtdName.includes('_Alp');
            if (hasAlphaTest) {
                program.defines.set('USE_ALPHATEST', '1');
            }

            batchTemplateRenderInst.gfxProgram = device.createProgram(program);
            batchTemplateRenderInst.setSamplerBindingsFromTextureMappings(textureMapping);

            const isTranslucent = hasAlphaBlend;
            const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
            batchTemplateRenderInst.sortKey = makeSortKey(layer, 0);

            for (let j = 0; j < batch.primitiveIndexes.length; j++) {
                const primitive = this.flverData.flver.primitives[batch.primitiveIndexes[j]];
                const renderInst = renderInstBuilder.pushRenderInst();
                renderInst.inputState = this.flverData.inputStates[inputStateIndex++];
                renderInst.drawIndexes(getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRISTRIP, primitive.indexCount));
                this.renderInsts.push(renderInst);
            }

            renderInstBuilder.popTemplateRenderInst();

            this.batchTemplateRenderInsts.push(batchTemplateRenderInst);
        }
        assert(nextInputStateIndex === this.flverData.inputStates.length);

        renderInstBuilder.popTemplateRenderInst();
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

        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i].visible = visible;

        if (visible) {
            const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch);

            for (let i = 0; i < this.renderInsts.length; i++)
                this.renderInsts[i].sortKey = setSortKeyDepth(this.renderInsts[i].sortKey, depth);

            computeViewMatrix(matrixScratch, viewerInput.camera);
            mat4.mul(matrixScratch, matrixScratch, this.modelMatrix);

            let offs = this.templateRenderInst.getUniformBufferOffset(DKSProgram.ub_MeshFragParams);
            const mapped = meshFragParamsBuffer.mapBufferF32(offs, 12);
            fillMatrix4x3(mapped, offs, matrixScratch);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.batchTemplateRenderInsts.length; i++)
            device.destroyProgram(this.batchTemplateRenderInsts[i].gfxProgram);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

export class SceneRenderer {
    private sceneParamsBuffer: GfxRenderBuffer;
    private meshFragParamsBuffer: GfxRenderBuffer;
    private templateRenderInst: GfxRenderInst;
    public renderInstBuilder: GfxRenderInstBuilder;
    public flverInstances: FLVERInstance[] = [];

    constructor(device: GfxDevice) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.meshFragParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MeshFragParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 2 }, // Shape
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.meshFragParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, DKSProgram.programReflection, bindingLayouts, uniformBuffers);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, DKSProgram.ub_SceneParams);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        const offs = this.templateRenderInst.uniformBufferOffsets[DKSProgram.ub_SceneParams];
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
