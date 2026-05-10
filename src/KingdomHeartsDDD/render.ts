import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxBufferFrequencyHint, GfxBufferUsage, GfxFormat, GfxSampler, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DreamDropPMO, DreamDropModelFlagBillboard, DreamDropPMP, DreamDropShapeAttributeDepthBias } from "./bin";
import { DreamDropRoomConfig } from "./config/room";
import { DreamDropShader } from "./shader";
import { computeLuxShiftMatrix, getLuxShortNibble, LuxMaterialInstance, LuxModel, LuxModelInfo, LuxModelRenderer, LuxOLOInstance, LuxPMP, LuxRoomObjects, LuxRoomRenderer, LuxShape, LuxShapeRenderer, LuxSkeletalAnimation, LuxTexture, LuxTextureAnimation, LuxTXA } from "./lux";

/**
 * Renderer for a room from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropRoomRenderer extends LuxRoomRenderer {
    constructor(cache: GfxRenderCache, pmp: DreamDropPMP, textures: LuxTexture[], objects: LuxRoomObjects, txas: LuxTXA[], config: DreamDropRoomConfig | undefined) {
        super(cache, pmp, textures, objects, txas);
        if (config && config.defaultSets) {
            for (const set of config.defaultSets) {
                this.onSetChanged(set, true);
            }
        } else {
            this.onSetChanged(0, true);
        }
    }

    protected override setRoomPart(cache: GfxRenderCache, pmp: LuxPMP, info: LuxModelInfo, i: number, textures: LuxTexture[], gfxSampler: GfxSampler, txas: LuxTXA[]): void {
        const model = info.pmo as DreamDropPMO;
        const materials: LuxMaterialInstance[] = Array(model.materials.length);
        const modelTXAs: LuxTXA[] = [];
        for (let j = 0; j < model.materials.length; j++) {
            if (!model.materials[j]) {
                continue;
            }
            const t = textures.filter(texture => texture.name.startsWith(model.materials[j].textureName));
            if (t.length > 0) {
                materials[j] = new LuxMaterialInstance(model.materials[j], t, gfxSampler);
                for (const txa of txas) {
                    if (txa.textureName === model.materials[j].textureName) {
                        modelTXAs.push(txa);
                        break;
                    }
                }
            }
        }
        this.parts[i] = new ModelRenderer(cache, model.name, model, materials, modelTXAs);
        this.parts[i].shiftMatrices = [computeLuxShiftMatrix(info.scale, info.rotation, info.position)];
    }

    protected override setRoomObject(cache: GfxRenderCache, model: LuxModel, instance: LuxOLOInstance, indices: number[], textures: LuxTexture[], gfxSampler: GfxSampler, txas: LuxTXA[], animation?: LuxSkeletalAnimation): void {
        const pmo = model as DreamDropPMO;
        const materials: LuxMaterialInstance[] = Array(pmo.materials.length);
        const modelTXAs: LuxTXA[] = [];
        for (let k = 0; k < pmo.materials.length; k++) {
            if (!pmo.materials[k]) {
                continue;
            }
            const t = textures.filter(texture => texture.name.startsWith(pmo.materials[k].textureName));
            if (t.length > 0) {
                materials[k] = new LuxMaterialInstance(pmo.materials[k], t, gfxSampler);
                for (const txa of txas) {
                    if (txa.textureName === pmo.materials[k].textureName) {
                        modelTXAs.push(txa);
                        break;
                    }
                }
            }
        }
        const renderer = new ModelRenderer(cache, instance.name, model, materials, modelTXAs, animation);
        renderer.shiftMatrices = [computeLuxShiftMatrix([1, 1, 1], instance.rotation, instance.position)];
        indices.push(this.objects.length);
        this.objects.push(renderer);
    }
}

class ModelRenderer extends LuxModelRenderer {
    protected override getIsBillboard(flags: number): boolean {
        return getLuxShortNibble(flags, 1) === DreamDropModelFlagBillboard.BILLBOARD;
    }

    protected override getShapeRenderer(cache: GfxRenderCache, model: LuxModel, shape: LuxShape, materials: LuxMaterialInstance[], txa?: LuxTextureAnimation): LuxShapeRenderer {
        return new ShapeRenderer(cache, shape, model.scale, materials[shape.textureIndex], txa, this.isSkybox, this.animation ? model.skeleton!.bones.length : 0);
    }
}

class ShapeRenderer extends LuxShapeRenderer {
    constructor(cache: GfxRenderCache, shape: LuxShape, scale: number, material: LuxMaterialInstance, txa?: LuxTextureAnimation, isSkybox: boolean = false, boneCount: number = 0) {
        super(cache, shape, scale, material, txa, isSkybox, boneCount);
    }

    protected override setMegaStateFlags(shape: LuxShape, transparent: boolean): void {
        this.megaStateFlags = {
            depthWrite: !transparent,
            polygonOffset: getLuxShortNibble(shape.attribute, 1) !== DreamDropShapeAttributeDepthBias.SET // need to look at this again...
        };
    }

    protected override setVertexBuffers(cache: GfxRenderCache, shape: LuxShape, scale: number): void {
        const inVertexAttributeDescriptors = [
            { location: DreamDropShader.a_Position, bufferIndex: DreamDropShader.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
            { location: DreamDropShader.a_Color, bufferIndex: DreamDropShader.a_Color, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
            { location: DreamDropShader.a_UV, bufferIndex: DreamDropShader.a_UV, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
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
            inVertexAttributeDescriptors.push({ location: DreamDropShader.a_Weight, bufferIndex: DreamDropShader.a_Weight, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 });
            inVertexAttributeDescriptors.push({ location: DreamDropShader.a_Joint, bufferIndex: DreamDropShader.a_Joint, format: GfxFormat.U8_RGBA, bufferByteOffset: 0 });
            inVertexBufferDescriptors.push({ byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex });
            inVertexBufferDescriptors.push({ byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex });
            this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.weights.buffer), byteOffset: 0 });
            this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Uint8Array(shape.joints.map(j => shape.boneIndices[j])).buffer), byteOffset: 0 });
        }

        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: inVertexAttributeDescriptors,
            vertexBufferDescriptors: inVertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U32_R
        });
    }

    protected override setShader(cache: GfxRenderCache, boneCount: number): void {
        this.gfxProgram = cache.createProgram(new DreamDropShader(this.vertexBufferDescriptors.length, boneCount));
    }
}
