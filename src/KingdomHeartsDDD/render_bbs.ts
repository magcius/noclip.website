import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxBufferFrequencyHint, GfxBufferUsage, GfxFormat, GfxSampler, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { computeLuxShiftMatrix, LuxMaterialInstance, LuxModel, LuxModelInfo, LuxModelRenderer, LuxOLOInstance, LuxPMP, LuxRoomRenderer, LuxShape, LuxShapeRenderer, LuxSkeletalAnimation, LuxTexture, LuxTextureAnimation, LuxTXA } from "./lux";
import { BBSModel, BBSPMP, BBSShape } from "./bin_bbs";
import { BBSShader } from "./shader";

export class BBSRoomRenderer extends LuxRoomRenderer {
    protected override setRoomPart(cache: GfxRenderCache, pmp: LuxPMP, info: LuxModelInfo, i: number, textures: LuxTexture[], gfxSampler: GfxSampler): void {
        const bbsPMP = pmp as BBSPMP;
        const model = info.pmo as BBSModel;
        const materials: LuxMaterialInstance[] = [];
        for (let textureName of model.textureNames) {
            const i = bbsPMP.tims.findIndex(t => t.name === textureName);
            if (i >= 0) {
                const tim = bbsPMP.tims[i];
                materials.push(new LuxMaterialInstance({ textureName: tim.name, scrollX: tim.scrollX, scrollY: tim.scrollY, textureOffset: 0 }, [textures[i]], gfxSampler));
            }
        }
        this.parts[i] = new ModelRenderer(cache, model.name, model, materials, [], undefined);
        this.parts[i].instances = [{ shiftMatrix: computeLuxShiftMatrix(info.scale, info.rotation, info.position), setId: -1 }];
    }

    protected override setRoomObject(cache: GfxRenderCache, model: LuxModel, setId: number, instance: LuxOLOInstance, textures: LuxTexture[], gfxSampler: GfxSampler, txas: LuxTXA[], animation?: LuxSkeletalAnimation): void {
        const i = this.objects.findIndex(r => r.name === instance.name);
        const modelInstance = { shiftMatrix: computeLuxShiftMatrix([1, 1, 1], instance.rotation, instance.position), setId };
        if (i > -1) {
            this.objects[i].instances.push(modelInstance);
        } else {
            const bbsModel = model as BBSModel;
            const materials: LuxMaterialInstance[] = Array(bbsModel.tims.length);
            for (let i = 0; i < bbsModel.tims.length; i++) {
                const tim = bbsModel.tims[i];
                const globalIndex = textures.findIndex(t => t.name === tim.name);
                if (globalIndex >= 0) {
                    materials[i] = new LuxMaterialInstance({ textureName: tim.name, scrollX: tim.scrollX, scrollY: tim.scrollY, textureOffset: 0 }, [textures[globalIndex]], gfxSampler);
                }
            }
            const renderer = new ModelRenderer(cache, instance.name, model, materials, [], animation);
            if (instance.name.toLowerCase().startsWith("p") && instance.name.substring(3, 5).toLowerCase() === "ex") {
                // hide player spawn locations by default to sync with ui panel
                renderer.visible = false;
            }
            renderer.instances = [modelInstance];
            this.objects.push(renderer);
        }
    }
}

class ModelRenderer extends LuxModelRenderer {
    protected override getShapeRenderer(cache: GfxRenderCache, model: LuxModel, shape: LuxShape, materials: LuxMaterialInstance[], txa?: LuxTextureAnimation): LuxShapeRenderer {
        return new ShapeRenderer(cache, shape as BBSShape, model.scale, materials[shape.textureIndex], this.isSkybox, this.animation ? model.skeleton!.bones.length : 0);
    }
}

class ShapeRenderer extends LuxShapeRenderer {
    constructor(cache: GfxRenderCache, shape: BBSShape, scale: number, material: LuxMaterialInstance, isSkybox: boolean, boneCount: number = 0) {
        super(cache, shape, scale, material, undefined, isSkybox, boneCount);
    }

    protected override setVertexBuffers(cache: GfxRenderCache, shape: LuxShape, scale: number): void {
        const inVertexAttributeDescriptors = [
            { location: BBSShader.a_Position, bufferIndex: BBSShader.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
            { location: BBSShader.a_Color, bufferIndex: BBSShader.a_Color, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
            { location: BBSShader.a_UV, bufferIndex: BBSShader.a_UV, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
        ];
        const inVertexBufferDescriptors = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex }
        ];
        this.vertexBufferDescriptors = [
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.vertices.map(v => v * scale).buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.colors.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.uvs.buffer), byteOffset: 0 }
        ];

        if (shape.weights.length > 0 && shape.joints.length > 0) {
            let weight1Format: GfxFormat;
            let joint1Format: GfxFormat;
            let weight2Format: GfxFormat;
            let joint2Format: GfxFormat;
            let weight1Bytes = 4;
            let joint1Bytes = 1;
            let weight2Bytes = 4;
            let joint2Bytes = 1;
            const weightCount = shape.weights.length / shape.vertexCount;
            switch (weightCount) {
                case 1:
                    weight1Format = GfxFormat.F32_R;
                    joint1Format = GfxFormat.U8_R;
                    weight1Bytes = 4;
                    joint1Bytes = 1;
                    break;
                case 2:
                    weight1Format = GfxFormat.F32_RG;
                    joint1Format = GfxFormat.U8_RG;
                    weight1Bytes = 8;
                    joint1Bytes = 2;
                    break;
                case 3:
                    weight1Format = GfxFormat.F32_RGB;
                    joint1Format = GfxFormat.U8_RGB;
                    weight1Bytes = 12;
                    joint1Bytes = 3;
                    break;
                case 4:
                    weight1Format = GfxFormat.F32_RGBA;
                    joint1Format = GfxFormat.U8_RGBA;
                    weight1Bytes = 16;
                    joint1Bytes = 4;
                    break;
                case 5:
                    weight1Format = GfxFormat.F32_RGBA;
                    joint1Format = GfxFormat.U8_RGBA;
                    weight1Bytes = 16;
                    joint1Bytes = 4;
                    weight2Format = GfxFormat.F32_R;
                    joint2Format = GfxFormat.U8_R;
                    weight2Bytes = 4;
                    joint2Bytes = 1;
                    break;
                case 6:
                    weight1Format = GfxFormat.F32_RGBA;
                    joint1Format = GfxFormat.U8_RGBA;
                    weight1Bytes = 16;
                    joint1Bytes = 4;
                    weight2Format = GfxFormat.F32_RG;
                    joint2Format = GfxFormat.U8_RG;
                    weight2Bytes = 8;
                    joint2Bytes = 2;
                    break;
                case 7:
                    weight1Format = GfxFormat.F32_RGBA;
                    joint1Format = GfxFormat.U8_RGBA;
                    weight1Bytes = 16;
                    joint1Bytes = 4;
                    weight2Format = GfxFormat.F32_RGB;
                    joint2Format = GfxFormat.U8_RGB;
                    weight2Bytes = 12;
                    joint2Bytes = 3;
                    break;
                case 8:
                default:
                    weight1Format = GfxFormat.F32_RGBA;
                    joint1Format = GfxFormat.U8_RGBA;
                    weight1Bytes = 16;
                    joint1Bytes = 4;
                    weight2Format = GfxFormat.F32_RGBA;
                    joint2Format = GfxFormat.U8_RGBA;
                    weight2Bytes = 16;
                    joint2Bytes = 4;
                    break;
            }
            inVertexAttributeDescriptors.push({ location: BBSShader.a_Weight, bufferIndex: BBSShader.a_Weight, format: weight1Format, bufferByteOffset: 0 });
            inVertexAttributeDescriptors.push({ location: BBSShader.a_Joint, bufferIndex: BBSShader.a_Joint, format: joint1Format, bufferByteOffset: 0 });
            inVertexBufferDescriptors.push({ byteStride: weight1Bytes, frequency: GfxVertexBufferFrequency.PerVertex });
            inVertexBufferDescriptors.push({ byteStride: joint1Bytes, frequency: GfxVertexBufferFrequency.PerVertex });
            if (weightCount > 4) {
                inVertexAttributeDescriptors.push({ location: BBSShader.a_Weight2, bufferIndex: BBSShader.a_Weight2, format: weight2Format!, bufferByteOffset: 0 });
                inVertexAttributeDescriptors.push({ location: BBSShader.a_Joint2, bufferIndex: BBSShader.a_Joint2, format: joint2Format!, bufferByteOffset: 0 });
                inVertexBufferDescriptors.push({ byteStride: weight2Bytes, frequency: GfxVertexBufferFrequency.PerVertex });
                inVertexBufferDescriptors.push({ byteStride: joint2Bytes, frequency: GfxVertexBufferFrequency.PerVertex });
            }

            const weights1 = [];
            const joints1 = [];
            const weights2 = [];
            const joints2 = [];
            for (let i = 0; i < shape.vertexCount; i++) {
                for (let j = 0; j < Math.min(weightCount, 4); j++) {
                    weights1.push(shape.weights[(i * weightCount) + j]);
                    joints1.push(shape.joints[(i * weightCount) + j]);
                }
                for (let j = 4; j < Math.min(weightCount, 8); j++) {
                    weights2.push(shape.weights[(i * weightCount) + j]);
                    joints2.push(shape.joints[(i * weightCount) + j]);
                }
            }
            this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(weights1).buffer), byteOffset: 0 });
            this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Uint8Array(joints1).buffer), byteOffset: 0 });
            if (weightCount > 4) {
                this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(weights2).buffer), byteOffset: 0 });
                this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Uint8Array(joints2).buffer), byteOffset: 0 });
            }
        }

        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: inVertexAttributeDescriptors,
            vertexBufferDescriptors: inVertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U32_R
        });
    }

    protected override setShader(cache: GfxRenderCache, boneCount: number, weightCount: number, doRigidSkinning: boolean): void {
        this.gfxProgram = cache.createProgram(new BBSShader(this.vertexBufferDescriptors.length, boneCount, weightCount, doRigidSkinning));
    }
}
