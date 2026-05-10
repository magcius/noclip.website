import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxBufferFrequencyHint, GfxBufferUsage, GfxFormat, GfxSampler, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { computeLuxShiftMatrix, LuxMaterialInstance, LuxModel, LuxModelInfo, LuxModelRenderer, LuxOLOInstance, LuxPMP, LuxRoomObjects, LuxRoomRenderer, LuxShape, LuxShapeRenderer, LuxSkeletalAnimation, LuxTexture, LuxTextureAnimation, LuxTXA } from "./lux";
import { BBSModel, BBSPMP, BBSShape } from "./bin_bbs";
import { BBSShader } from "./shader_bbs";

export class BBSRoomRenderer extends LuxRoomRenderer {
    constructor(cache: GfxRenderCache, pmp: LuxPMP, textures: LuxTexture[], objects: LuxRoomObjects) {
        super(cache, pmp, textures, objects, []);
        this.onSetChanged(0, true);
    }

    protected override setRoomPart(cache: GfxRenderCache, pmp: LuxPMP, info: LuxModelInfo, i: number, textures: LuxTexture[], gfxSampler: GfxSampler, txas: LuxTXA[]): void {
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
        this.parts[i].shiftMatrices = [computeLuxShiftMatrix(info.scale, info.rotation, info.position)];
    }

    protected override setRoomObject(cache: GfxRenderCache, model: LuxModel, instance: LuxOLOInstance, indices: number[], textures: LuxTexture[], gfxSampler: GfxSampler, txas: LuxTXA[], animation?: LuxSkeletalAnimation): void {
        const bbsModel = model as BBSModel;
        const materials: LuxMaterialInstance[] = Array(bbsModel.tims.length);
        for (let i = 0; i < bbsModel.tims.length; i++) {
            const tim = bbsModel.tims[i];
            const globalIndex = textures.findIndex(t => t.name === tim.name);
            if (globalIndex >= 0) {
                materials[i] = new LuxMaterialInstance({ textureName: tim.name, scrollX: tim.scrollX, scrollY: tim.scrollY, textureOffset: 0 }, [textures[globalIndex]], gfxSampler);
            }
        }
        const renderer = new ModelRenderer(cache, instance.name, model, materials, [], undefined);
        renderer.shiftMatrices = [computeLuxShiftMatrix([1, 1, 1], instance.rotation, instance.position)];
        indices.push(this.objects.length);
        this.objects.push(renderer);
    }
}

class ModelRenderer extends LuxModelRenderer {
    // private preComputeBoneMatrices() {
    //     this.boneMatrices = new Array(this.bones.length);
    //     for (let i = 0; i < this.bones.length; i++) {
    //         this.boneMatrices[i] = this.bones[i].transform;
    //         if (this.bones[i].parentIndex < 0xFFFF) {
    //             mat4.mul(this.boneMatrices[i], this.boneMatrices[this.bones[i].parentIndex], this.boneMatrices[i]);
    //         }
    //     }
    // }
    protected override getShapeRenderer(cache: GfxRenderCache, model: LuxModel, shape: LuxShape, materials: LuxMaterialInstance[], txa?: LuxTextureAnimation): LuxShapeRenderer {
        return new ShapeRenderer(cache, shape as BBSShape, model.scale, materials[shape.textureIndex], this.isSkybox, 0);
    }
}

class ShapeRenderer extends LuxShapeRenderer {
    constructor(cache: GfxRenderCache, shape: BBSShape, scale: number, material: LuxMaterialInstance, isSkybox: boolean, boneCount: number = 0) {
        super(cache, shape, scale, material, undefined, isSkybox, boneCount);
    }

    protected override setMegaStateFlags(shape: LuxShape, transparent: boolean): void {
        this.megaStateFlags = {
            depthWrite: !transparent
        };
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

        // if (shape.weights.length > 0 && shape.joints.length > 0) {
        //     inVertexAttributeDescriptors.push({ location: BBSShader.a_Weight, bufferIndex: BBSShader.a_Weight, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 });
        //     inVertexAttributeDescriptors.push({ location: BBSShader.a_Joint, bufferIndex: BBSShader.a_Joint, format: GfxFormat.U8_RGBA, bufferByteOffset: 0 });
        //     inVertexAttributeDescriptors.push({ location: BBSShader.a_Weight2, bufferIndex: BBSShader.a_Weight2, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 });
        //     inVertexAttributeDescriptors.push({ location: BBSShader.a_Joint2, bufferIndex: BBSShader.a_Joint2, format: GfxFormat.U8_RGBA, bufferByteOffset: 0 });
        //     inVertexBufferDescriptors.push({ byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex });
        //     inVertexBufferDescriptors.push({ byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex });
        //     inVertexBufferDescriptors.push({ byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex });
        //     inVertexBufferDescriptors.push({ byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex });
        //     const weights1 = [];
        //     const weights2 = [];
        //     const joints1 = [];
        //     const joints2 = [];
        //     for (let i = 0; i < shape.vertexCount; i++) {
        //         for (let j = 0; j < 4; j++) {
        //             weights1.push(shape.weights[(i * 8) + j]);
        //             joints1.push(shape.joints[(i * 8) + j]);
        //         }
        //         for (let j = 4; j < 8; j++) {
        //             weights2.push(shape.weights[(i * 8) + j]);
        //             joints2.push(shape.joints[(i * 8) + j]);
        //         }
        //     }
        //     this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(weights1).buffer), byteOffset: 0 });
        //     this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Uint8Array(joints1).buffer), byteOffset: 0 });
        //     this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(weights2).buffer), byteOffset: 0 });
        //     this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Uint8Array(joints2).buffer), byteOffset: 0 });
        // }
        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: inVertexAttributeDescriptors,
            vertexBufferDescriptors: inVertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U32_R
        });
    }

    protected override setShader(cache: GfxRenderCache, boneCount: number): void {
        this.gfxProgram = cache.createProgram(new BBSShader(this.vertexBufferDescriptors.length, 0));
    }
}
