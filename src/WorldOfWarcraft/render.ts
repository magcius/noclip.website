import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { invlerp, lerp } from "../MathHelpers.js";
import { TextureMapping } from "../TextureHolder.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import {
    GfxTopology,
    convertToTriangleIndexBuffer,
    makeTriangleIndexBuffer,
} from "../gfx/helpers/TopologyHelpers.js";
import {
    fillMatrix4x3,
    fillMatrix4x4,
    fillVec4,
    fillVec4v,
} from "../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxBlendFactor,
    GfxBlendMode,
    GfxBufferUsage,
    GfxCullMode,
    GfxDevice,
    GfxIndexBufferDescriptor,
    GfxInputLayoutBufferDescriptor,
    GfxMegaStateDescriptor,
    GfxVertexAttributeDescriptor,
    GfxVertexBufferDescriptor,
    GfxVertexBufferFrequency,
    makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat.js";
import { GfxBuffer, GfxInputLayout, GfxTexture } from "../gfx/platform/GfxPlatformImpl.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import {
    GfxRenderInstManager,
    GfxRendererLayer,
    makeSortKey,
} from "../gfx/render/GfxRenderInstManager.js";
import { rust } from "../rustlib.js";
import { assert, assertExists } from "../util.js";
import {
    AdtData,
    BlpData,
    BoneData,
    ChunkData,
    DoodadData,
    LiquidInstance,
    LiquidType,
    ModelBatch,
    ModelData,
    ParticleEmitter,
    SkinData,
    WmoBatchData,
    WmoData,
    getSkyboxDoodad,
} from "./data.js";
import {
    loadingAdtIndices,
    loadingAdtVertices,
    skyboxIndices,
    skyboxVertices,
} from "./mesh.js";
import {
    LoadingAdtProgram,
    MAX_BONE_TRANSFORMS,
    MAX_DOODAD_INSTANCES,
    ModelProgram,
    ParticleProgram,
    SkyboxProgram,
    TerrainProgram,
    WaterProgram,
    WmoProgram,
} from "./program.js";
import { FrameData, MAP_SIZE, MapArray, View, WdtScene } from "./scenes.js";
import { TextureCache } from "./tex.js";
import { WowWmoGroupDescriptor } from "../../rust/pkg/noclip_support";
import { drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";

type TextureMappingArray = (TextureMapping | null)[];

export class ModelRenderer {
    private skinData: SkinData[] = [];
    private vertexBuffer: GfxVertexBufferDescriptor;
    private indexBuffers: GfxIndexBufferDescriptor[] = [];
    private skinBatchTextures: TextureMappingArray[][] = [];
    private emitterTextures: TextureMappingArray[] = [];
    private particleQuadIndices: GfxIndexBufferDescriptor;
    private inputLayout: GfxInputLayout;
    private particleInputLayout: GfxInputLayout;
    private boneTexture: BoneTexture;
    public visible = true;

    constructor(
        private device: GfxDevice,
        public model: ModelData,
        renderHelper: GfxRenderHelper,
        private textureCache: TextureCache,
    ) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: ModelProgram.a_Position,
                bufferIndex: 0,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RGB,
            },
            {
                location: ModelProgram.a_BoneWeights,
                bufferIndex: 0,
                bufferByteOffset: 12,
                format: GfxFormat.U8_RGBA_NORM,
            },
            {
                location: ModelProgram.a_BoneIndices,
                bufferIndex: 0,
                bufferByteOffset: 16,
                format: GfxFormat.U8_RGBA,
            },
            {
                location: ModelProgram.a_Normal,
                bufferIndex: 0,
                bufferByteOffset: 20,
                format: GfxFormat.F32_RGB,
            },
            {
                location: ModelProgram.a_TexCoord0,
                bufferIndex: 0,
                bufferByteOffset: 32,
                format: GfxFormat.F32_RG,
            },
            {
                location: ModelProgram.a_TexCoord1,
                bufferIndex: 0,
                bufferByteOffset: 40,
                format: GfxFormat.F32_RG,
            },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {
                byteStride: rust.WowM2.get_vertex_stride(),
                frequency: GfxVertexBufferFrequency.PerVertex,
            },
        ];
        const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        this.inputLayout = renderHelper.renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });
        this.boneTexture = new BoneTexture(device, this.model.boneData.length);

        this.vertexBuffer = {
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Vertex,
                this.model.vertexBuffer.buffer,
            ),
            byteOffset: 0,
        };

        for (let i in this.model.skins) {
            const skinData = this.model.skins[i];
            this.indexBuffers.push({
                buffer: makeStaticDataBuffer(
                    device,
                    GfxBufferUsage.Index,
                    skinData.indexBuffer.buffer,
                ),
                byteOffset: 0,
            });
            this.skinData.push(skinData);
            this.skinBatchTextures[i] = [];
            for (let batch of skinData.batches) {
                this.skinBatchTextures[i].push(this.getBatchTextures(batch));
            }
        }

        let maxParticles = 0;
        for (const emitter of this.model.particleEmitters) {
            if (emitter.maxParticles() > maxParticles) {
                maxParticles = emitter.maxParticles();
            }
            this.emitterTextures.push(this.getEmitterTextures(device, emitter));
        }
        const particleIndexBuf = makeTriangleIndexBuffer(GfxTopology.Quads, 0, maxParticles * 4);
        this.particleQuadIndices = {
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Index,
                particleIndexBuf.buffer,
            ),
            byteOffset: 0,
        };
        this.particleInputLayout = renderHelper.renderCache.createInputLayout({
            vertexAttributeDescriptors: [],
            vertexBufferDescriptors: [],
            indexBufferFormat: GfxFormat.U16_R,
        });
    }

    public update(view: View) {
        this.model.updateAnimation(view);
    }

    public isDrawable(): boolean {
        let nBatches = 0;
        for (let skinData of this.skinData) {
            nBatches += skinData.batches.length;
        }
        return nBatches > 0 && this.visible;
    }

    private getEmitterTextures(
        device: GfxDevice,
        emitter: ParticleEmitter,
    ): TextureMappingArray {
        const dataMapping = new TextureMapping();
        dataMapping.gfxTexture = emitter.updateDataTex(device);
        return [
            this.getTextureMapping(emitter.textures[0]),
            this.getTextureMapping(emitter.textures[1]),
            this.getTextureMapping(emitter.textures[2]),
            dataMapping,
        ];
    }

    private getTextureMapping(blpData: BlpData | null): TextureMapping | null {
        if (blpData === null) return null;

        const wrapS = !!(blpData.flags & 0x01);
        const wrapT = !!(blpData.flags & 0x02);
        return this.textureCache.getTextureMapping(
            blpData.fileId,
            blpData.inner,
            { wrapS, wrapT },
        );
    }

    private getBatchTextures(batch: ModelBatch): TextureMappingArray {
        return [
            this.getTextureMapping(batch.tex0),
            this.getTextureMapping(batch.tex1),
            this.getTextureMapping(batch.tex2),
            this.getTextureMapping(batch.tex3),
        ];
    }

    public prepareToRenderModel(renderInstManager: GfxRenderInstManager, doodads: DoodadData[]) {
        if (!this.isDrawable())
            return;

        const visibleDoodads = doodads.filter((d) => d.visible);

        const device = renderInstManager.gfxRenderCache.device;
        // currently all instances share the same bones, but eventually it'd be
        // nice to animate them independently
        this.boneTexture.uploadMatrices(device, this.model.boneData);

        for (let doodadChunk of chunk(visibleDoodads, MAX_DOODAD_INSTANCES)) {
            const template = renderInstManager.pushTemplate();
            template.setAllowSkippingIfPipelineNotReady(false);
            const numVec4s = 3;
            const instanceParamsSize = 12 + 4 * numVec4s;
            const lightSize = 4 * 4;
            const baseOffs = template.allocateUniformBuffer(
                ModelProgram.ub_DoodadParams,
                lightSize * 4 + instanceParamsSize * MAX_DOODAD_INSTANCES,
            );
            let offs = baseOffs;
            const mapped = template.mapUniformBufferF32(
                ModelProgram.ub_DoodadParams,
            );
            for (let i = 0; i < 4; i++) {
                if (i < this.model.numLights) {
                    const colorIndex = 4 * i;
                    offs += fillVec4(
                        mapped,
                        offs,
                        this.model.ambientLightColors[colorIndex + 0],
                        this.model.ambientLightColors[colorIndex + 1],
                        this.model.ambientLightColors[colorIndex + 2],
                        this.model.ambientLightColors[colorIndex + 3],
                    );
                    offs += fillVec4(
                        mapped,
                        offs,
                        this.model.diffuseLightColors[colorIndex + 0],
                        this.model.diffuseLightColors[colorIndex + 1],
                        this.model.diffuseLightColors[colorIndex + 2],
                        this.model.diffuseLightColors[colorIndex + 3],
                    );
                    const posIndex = 3 * i;
                    offs += fillVec4(
                        mapped,
                        offs,
                        this.model.lightPositions[posIndex + 0],
                        this.model.lightPositions[posIndex + 1],
                        this.model.lightPositions[posIndex + 2],
                        this.model.lightBones[i],
                    );
                    offs += fillVec4(
                        mapped,
                        offs,
                        this.model.lightAttenuationStarts[i],
                        this.model.lightAttenuationEnds[i],
                        this.model.lightVisibilities[i],
                    );
                } else {
                    offs += fillVec4(mapped, offs, 0);
                    offs += fillVec4(mapped, offs, 0);
                    offs += fillVec4(mapped, offs, 0);
                    offs += fillVec4(mapped, offs, 0);
                }
            }
            offs = baseOffs + lightSize * 4;
            for (let doodad of doodadChunk) {
                offs += fillMatrix4x3(mapped, offs, doodad.modelMatrix);
                offs += fillVec4v(mapped, offs, doodad.ambientColor); // interiorAmbientColor
                if (doodad.color !== null) {
                    // interiorDirectColor
                    offs += fillVec4v(mapped, offs, doodad.color);
                } else {
                    offs += fillVec4(mapped, offs, 0);
                }
                offs += fillVec4(
                    mapped,
                    offs,
                    doodad.applyInteriorLighting ? 1.0 : 0.0,
                    doodad.applyExteriorLighting ? 1.0 : 0.0,
                    doodad.isSkybox ? doodad.skyboxBlend : doodad.applyInteriorLighting ? 1.0 : 0.0,
                    doodad.isSkybox ? 1.0 : 0.0,
                );
            }

            for (let i = 0; i < this.skinData.length; i++) {
                const skinData = this.skinData[i];
                const indexBuffer = this.indexBuffers[i];
                for (let j = 0; j < skinData.batches.length; j++) {
                    const batch = skinData.batches[j];
                    if (batch.getTextureWeight(0) === 0) {
                        continue;
                    }
                    const renderInst = renderInstManager.newRenderInst();
                    renderInst.setVertexInput(this.inputLayout, [this.vertexBuffer], indexBuffer);
                    batch.setMegaStateFlags(renderInst);
                    renderInst.setDrawCount(batch.submesh.index_count, batch.submesh.index_start);
                    renderInst.setInstanceCount(doodadChunk.length);
                    const mappings = this.skinBatchTextures[i][j];
                    mappings[4] = this.boneTexture.getTextureMapping();
                    renderInst.setSamplerBindingsFromTextureMappings(mappings);
                    batch.setModelParams(renderInst);
                    renderInstManager.submitRenderInst(renderInst);
                }
            }
            renderInstManager.popTemplate();
        }
    }

    public prepareToRenderSkybox(renderInstManager: GfxRenderInstManager, weight: number) {
        let doodad = getSkyboxDoodad();
        doodad.skyboxBlend = weight;
        this.prepareToRenderModel(renderInstManager, [doodad]);
    }

    public prepareToRenderParticles(renderInstManager: GfxRenderInstManager, doodads: DoodadData[]) {
        if (!this.isDrawable() || this.model.particleEmitters.length === 0)
            return;

        const visibleDoodads = doodads.filter((d) => d.visible);

        for (let doodadChunk of chunk(visibleDoodads, MAX_DOODAD_INSTANCES)) {
            const template = renderInstManager.pushTemplate();
            let offs = template.allocateUniformBuffer(
                ParticleProgram.ub_DoodadParams,
                12 * MAX_DOODAD_INSTANCES,
            );
            const mapped = template.mapUniformBufferF32(
                ParticleProgram.ub_DoodadParams,
            );
            for (let doodad of doodadChunk) {
                offs += fillMatrix4x3(mapped, offs, doodad.modelMatrix);
            }

            for (let i = 0; i < this.model.particleEmitters.length; i++) {
                const emitter = this.model.particleEmitters[i];
                if (emitter.numParticles() === 0) {
                    continue;
                }

                emitter.updateDataTex(this.device);

                let renderInst = renderInstManager.newRenderInst();
                let offs = renderInst.allocateUniformBuffer(
                    ParticleProgram.ub_EmitterParams,
                    4 * 2,
                );
                const mapped = renderInst.mapUniformBufferF32(
                    ParticleProgram.ub_EmitterParams,
                );
                offs += fillVec4(
                    mapped,
                    offs,
                    emitter.alphaTest,
                    emitter.fragShaderType,
                    emitter.blendMode,
                );
                offs += fillVec4(
                    mapped,
                    offs,
                    emitter.texScaleX,
                    emitter.texScaleY,
                );

                renderInst.setVertexInput(
                    this.particleInputLayout,
                    null,
                    this.particleQuadIndices,
                );
                renderInst.setDrawCount(emitter.numParticles() * 6, 0);
                emitter.setMegaStateFlags(renderInst);
                renderInst.setInstanceCount(doodadChunk.length);
                renderInst.setSamplerBindingsFromTextureMappings(
                    this.emitterTextures[i],
                );
                renderInstManager.submitRenderInst(renderInst);
            }
            renderInstManager.popTemplate();
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer.buffer);
        for (let indexBuffer of this.indexBuffers) {
            device.destroyBuffer(indexBuffer.buffer);
        }
        device.destroyBuffer(this.particleQuadIndices.buffer);
        this.boneTexture.destroy(device);
    }
}

function chunk<T>(arr: T[], chunkSize: number): T[][] {
    const ret: T[][] = [];
    for (let i = 0; i < arr.length; i += chunkSize)
        ret.push(arr.slice(i, i + chunkSize));
    return ret;
}

class BoneTexture {
    static RGBA_WIDTH: number = 3 + 3 + 1; // two 4x3 mats, one vec4 of params

    private texture: GfxTexture;
    private textureMapping = new TextureMapping();

    constructor(device: GfxDevice, private maxBones: number) {
        this.texture = device.createTexture(makeTextureDescriptor2D(
            GfxFormat.F32_RGBA,
            BoneTexture.RGBA_WIDTH,
            maxBones,
            1,
        ));
        this.textureMapping.gfxTexture = this.texture;
    }

    public uploadMatrices(device: GfxDevice, bones: BoneData[]) {
        const textureData = new Float32Array(bones.length * BoneTexture.RGBA_WIDTH * 4);
        for (let i = 0; i < bones.length; i++) {
            const bone = bones[i];
            let dstOffs = i * BoneTexture.RGBA_WIDTH * 4;
            dstOffs += fillVec4(textureData, dstOffs,
                bone.isSphericalBillboard ? 1.0 : 0.0,
            );
            dstOffs += fillMatrix4x3(textureData, dstOffs, bone.transform);
            dstOffs += fillMatrix4x3(textureData, dstOffs, bone.postBillboardTransform);
        }
        device.uploadTextureData(this.texture, 0, [textureData]);
    }

    public getTextureMapping(): TextureMapping {
        return this.textureMapping;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

export class WmoRenderer {
    private inputLayout: GfxInputLayout;
    private vertexBuffers: GfxVertexBufferDescriptor[][] = [];
    private indexBuffers: GfxIndexBufferDescriptor[] = [];
    private groups: WowWmoGroupDescriptor[] = [];
    private gfxVertexBuffer: GfxBuffer;
    private gfxIndexBuffer: GfxBuffer;
    public batches: WmoBatchData[][] = [];
    public visible: boolean = true;
    public groupBatchTextureMappings: TextureMappingArray[][] = [];
    private dayNight: number;

    constructor(device: GfxDevice, private wmo: WmoData, private textureCache: TextureCache, renderHelper: GfxRenderHelper) {
        this.inputLayout = this.getInputLayout(renderHelper.renderCache);
        this.gfxVertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.wmo.vertexBuffer.buffer);
        this.gfxIndexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, this.wmo.indexBuffer.buffer);

        for (let fileID of this.wmo.wmo.group_file_ids) {
            const groupDescriptor = this.wmo.wmo.get_group_descriptor(fileID);
            this.vertexBuffers.push(this.getGroupVertexBuffers(groupDescriptor));
            this.indexBuffers.push(this.getGroupIndexBuffer(groupDescriptor));
            this.batches.push(wmo.getBatches(groupDescriptor));
            this.groups.push(groupDescriptor);
        }

        for (let i in this.batches) {
            const batches = this.batches[i];
            this.groupBatchTextureMappings[i] = [];
            for (let batch of batches) {
                this.groupBatchTextureMappings[i].push(
                    this.getBatchTextureMapping(batch),
                );
            }
        }
    }

    private getInputLayout(renderCache: GfxRenderCache): GfxInputLayout {
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: WmoProgram.a_Position,
                bufferIndex: 0,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RGB,
            },
            {
                location: WmoProgram.a_Normal,
                bufferIndex: 1,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RGB,
            },
        ];
        for (let i = 0; i < 2; i++) {
            vertexAttributeDescriptors.push({
                location: WmoProgram.a_Color0 + i,
                bufferIndex: 2 + i,
                bufferByteOffset: 0,
                format: GfxFormat.U8_RGBA_NORM,
            });
        }
        for (let i = 0; i < 4; i++) {
            vertexAttributeDescriptors.push({
                location: WmoProgram.a_TexCoord0 + i,
                bufferIndex: 4 + i,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RG,
            });
        }
        const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        return renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });
    }

    private getGroupIndexBuffer(group: WowWmoGroupDescriptor): GfxIndexBufferDescriptor {
        return { buffer: this.gfxIndexBuffer, byteOffset: assertExists(group.index_buffer_offset) };
    }

    private getGroupVertexBuffers(group: WowWmoGroupDescriptor): GfxVertexBufferDescriptor[] {
        let offs = assertExists(group.vertex_buffer_offset);
        let buffers = [];
        buffers.push({ buffer: this.gfxVertexBuffer, byteOffset: offs }); // positions
        offs += group.num_vertices * 0x0C;
        buffers.push({ buffer: this.gfxVertexBuffer, byteOffset: offs }); // normals
        offs += group.num_vertices * 0x0C;
        for (let i = 0; i < 2; i++) {
            const hasBuffer = i < group.num_color_bufs;
            buffers.push({ buffer: this.gfxVertexBuffer, byteOffset: hasBuffer ? offs : 0 }); // colors
            if (hasBuffer)
                offs += group.num_vertices * 0x04;
        }
        for (let i = 0; i < 4; i++) {
            const hasBuffer = i < group.num_uv_bufs;
            buffers.push({ buffer: this.gfxVertexBuffer, byteOffset: hasBuffer ? offs : 0 }); // uvs
            if (hasBuffer)
                offs += group.num_vertices * 0x08;
        }
        return buffers;
    }

    private getBatchTextureMapping(batch: WmoBatchData): TextureMappingArray {
        const mappings = [];
        for (let blp of batch.textures) {
            if (blp === null) {
                mappings.push(this.textureCache.getAllWhiteTextureMapping());
            } else {
                const wrapS = !batch.materialFlags.clamp_s;
                const wrapT = !batch.materialFlags.clamp_t;
                mappings.push(
                    this.textureCache.getTextureMapping(blp.fileId, blp.inner, {
                        wrapS,
                        wrapT,
                    }),
                );
            }
        }
        return mappings;
    }

    public prepareToRenderWmo(renderInstManager: GfxRenderInstManager, frame: FrameData): void {
        if (!this.visible)
            return;

        for (let def of frame.wmoDefs.get(this.wmo.fileId)) {
            assert(
                def.wmoId === this.wmo.fileId,
                `WmoRenderer handed a WmoDefinition that doesn't belong to it (${def.wmoId} !== ${this.wmo.fileId}`,
            );
            const template = renderInstManager.pushTemplate();
            let offs = template.allocateUniformBuffer(WmoProgram.ub_ModelParams, 12);
            const mapped = template.mapUniformBufferF32(WmoProgram.ub_ModelParams);
            offs += fillMatrix4x3(mapped, offs, def.modelMatrix);

            const visibleGroups = frame.wmoDefGroups.get(def.uniqueId);
            for (let i = 0; i < this.vertexBuffers.length; i++) {
                const group = this.groups[i];
                if (!visibleGroups.includes(group.group_id))
                    continue;
                const ambientColor = def.groupAmbientColors.get(group.group_id)!;
                const applyInteriorLight = group.interior && !group.exterior_lit;
                const applyExteriorLight = true;
                template.setVertexInput(this.inputLayout, this.vertexBuffers[i], this.indexBuffers[i]);
                for (let j in this.batches[i]) {
                    const batch = this.batches[i][j];
                    if (!batch.visible) continue;
                    const renderInst = renderInstManager.newRenderInst();
                    let offset = renderInst.allocateUniformBuffer(
                        WmoProgram.ub_BatchParams,
                        6 * 4,
                    );
                    const uniformBuf = renderInst.mapUniformBufferF32(
                        WmoProgram.ub_BatchParams,
                    );
                    offset += fillVec4(
                        uniformBuf,
                        offset,
                        batch.vertexShader,
                        batch.pixelShader,
                        group.num_color_bufs,
                        0,
                    );
                    offset += fillVec4(
                        uniformBuf,
                        offset,
                        batch.material.blend_mode,
                        applyInteriorLight ? 1 : 0,
                        applyExteriorLight ? 1 : 0,
                        batch.materialFlags.unlit ? 1 : 0,
                    );
                    offset += fillVec4(
                        uniformBuf,
                        offset,
                        batch.materialFlags.unfogged ? 1 : 0,
                        batch.materialFlags.exterior_light ? 1 : 0,
                        batch.materialFlags.sidn ? this.getSIDN() : -1.0,
                        batch.materialFlags.window ? 1 : 0,
                    );
                    offset += fillVec4v(uniformBuf, offset, batch.sidnColor);
                    offset += fillVec4v(uniformBuf, offset, ambientColor);
                    offset += fillVec4v(uniformBuf, offset, [0, 0, 0, 0]);
                    batch.setMegaStateFlags(renderInst);
                    renderInst.setSamplerBindingsFromTextureMappings(
                        this.groupBatchTextureMappings[i][j],
                    );
                    renderInst.setDrawCount(batch.indexCount, batch.indexStart);
                    renderInstManager.submitRenderInst(renderInst);
                }
            }
            renderInstManager.popTemplate();
        }
    }

    private getSIDN(): number {
        const morningTransition = [0.25, 0.291667];
        const eveningTransition = [0.854167, 0.895833];
        if (
            this.dayNight >= morningTransition[0] &&
            this.dayNight <= morningTransition[1]
        ) {
            return lerp(
                1.0,
                0.0,
                invlerp(
                    morningTransition[0],
                    morningTransition[1],
                    this.dayNight,
                ),
            );
        } else if (
            this.dayNight >= eveningTransition[0] &&
            this.dayNight <= eveningTransition[1]
        ) {
            return lerp(
                0.0,
                1.0,
                invlerp(
                    eveningTransition[0],
                    eveningTransition[1],
                    this.dayNight,
                ),
            );
        } else {
            return this.dayNight > morningTransition[1] &&
                this.dayNight < eveningTransition[0]
                ? 0.0
                : 1.0;
        }
    }

    public update(view: View) {
        this.dayNight = view.dayNight;
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.gfxVertexBuffer);
        device.destroyBuffer(this.gfxIndexBuffer);
    }
}

export class TerrainRenderer {
    private inputLayout: GfxInputLayout;
    public indexBuffer: GfxIndexBufferDescriptor;
    public vertexBuffer: GfxVertexBufferDescriptor;
    public alphaTextureMappings: (TextureMapping | null)[] = [];
    public shadowTextureMappings: (TextureMapping | null)[] = [];
    public chunkTextureMappings: TextureMappingArray[] = [];

    constructor(
        device: GfxDevice,
        renderHelper: GfxRenderHelper,
        public adt: AdtData,
        private textureCache: TextureCache,
    ) {
        const adtVboInfo = rust.WowAdt.get_vbo_info();
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: TerrainProgram.a_ChunkIndex,
                bufferIndex: 0,
                bufferByteOffset: 0,
                format: GfxFormat.F32_R,
            },
            {
                location: TerrainProgram.a_Position,
                bufferIndex: 0,
                bufferByteOffset: adtVboInfo.vertex_offset,
                format: GfxFormat.F32_RGB,
            },
            {
                location: TerrainProgram.a_Normal,
                bufferIndex: 0,
                bufferByteOffset: adtVboInfo.normal_offset,
                format: GfxFormat.F32_RGB,
            },
            {
                location: TerrainProgram.a_Color,
                bufferIndex: 0,
                bufferByteOffset: adtVboInfo.color_offset,
                format: GfxFormat.F32_RGBA,
            },
            {
                location: TerrainProgram.a_Lighting,
                bufferIndex: 0,
                bufferByteOffset: adtVboInfo.lighting_offset,
                format: GfxFormat.F32_RGBA,
            },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {
                byteStride: adtVboInfo.stride,
                frequency: GfxVertexBufferFrequency.PerVertex,
            },
        ];
        const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        const cache = renderHelper.renderCache;
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });
        [this.vertexBuffer, this.indexBuffer] =
            this.adt.getBufsAndChunks(device);
        for (let i in this.adt.chunkData) {
            const chunk = this.adt.chunkData[i];
            this.chunkTextureMappings[i] = this.getChunkTextureMapping(chunk);

            if (chunk.alphaTexture) {
                const alphaMapping = textureCache.getAlphaTextureMapping(
                    device,
                    chunk.alphaTexture,
                );
                chunk.alphaTexture = undefined;
                this.alphaTextureMappings.push(alphaMapping);
                this.chunkTextureMappings[i].push(alphaMapping);
            } else {
                this.chunkTextureMappings[i].push(
                    textureCache.getDefaultAlphaTextureMapping(),
                );
            }

            if (chunk.shadowTexture) {
                const shadowMapping = textureCache.getShadowTextureMapping(
                    device,
                    chunk.shadowTexture,
                );
                chunk.shadowTexture = undefined;
                this.shadowTextureMappings.push(shadowMapping);
                this.chunkTextureMappings[i].push(shadowMapping);
            } else {
                this.chunkTextureMappings[i].push(
                    textureCache.getDefaultShadowTextureMapping(),
                );
            }
        }
    }

    private getChunkTextureMapping(chunk: ChunkData): TextureMappingArray {
        let mapping: TextureMappingArray = [null, null, null, null];
        chunk.textures.forEach((blp, i) => {
            if (blp) {
                mapping[i] = this.textureCache.getTextureMapping(
                    blp.fileId,
                    blp.inner,
                );
            } else {
                mapping[i] = null;
            }
        });
        return mapping;
    }

    public prepareToRenderTerrain(
        renderInstManager: GfxRenderInstManager,
        frame: FrameData,
    ) {
        const indices = frame.adtChunkIndices.get(this.adt.fileId);
        if (indices.length === 0) return;
        const template = renderInstManager.pushTemplate();
        template.setVertexInput(
            this.inputLayout,
            [this.vertexBuffer],
            this.indexBuffer,
        );
        for (let i of indices) {
            const chunk = this.adt.chunkData[i];
            if (chunk.indexCount === 0) continue;
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setSamplerBindingsFromTextureMappings(
                this.chunkTextureMappings[i],
            );
            renderInst.setDrawCount(chunk.indexCount, chunk.indexOffset);
            renderInstManager.submitRenderInst(renderInst);
        }
        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer.buffer);
        device.destroyBuffer(this.indexBuffer.buffer);
        const textureMappings = this.alphaTextureMappings.concat(
            this.shadowTextureMappings,
        );
        for (let mapping of textureMappings) {
            if (mapping) {
                destroyTextureMapping(device, mapping);
            }
        }
    }
}

export class LoadingAdtRenderer {
    private inputLayout: GfxInputLayout;
    private vertexBuffer: GfxVertexBufferDescriptor;
    private indexBuffer: GfxIndexBufferDescriptor;
    private scratchMat4 = mat4.create();
    private time: number = 0.0;
    public frequency = 0.1;
    public numIndices: number;

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: LoadingAdtProgram.a_Position,
                bufferIndex: 0,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RGB,
            },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        this.inputLayout = renderHelper.renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });

        this.vertexBuffer = {
            byteOffset: 0,
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Vertex,
                loadingAdtVertices.buffer,
            ),
        };
        this.numIndices = loadingAdtIndices.length;
        this.indexBuffer = {
            byteOffset: 0,
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Index,
                loadingAdtIndices.buffer,
            ),
        };
    }

    public update(view: View) {
        this.time += view.deltaTime / 1000.0;
    }

    public prepareToRenderLoadingBox(
        renderInstManager: GfxRenderInstManager,
        loadingAdts: [number, number][],
    ) {
        for (let [x, y] of loadingAdts) {
            const renderInst = renderInstManager.newRenderInst();

            let offs = renderInst.allocateUniformBuffer(
                LoadingAdtProgram.ub_ModelParams,
                12 + 4,
            );
            const mapped = renderInst.mapUniformBufferF32(
                LoadingAdtProgram.ub_ModelParams,
            );
            mat4.identity(this.scratchMat4);
            const ADT_SIZE = 1600.0 / 3.0;
            mat4.translate(this.scratchMat4, this.scratchMat4, [
                MAP_SIZE - (y + 0.5) * ADT_SIZE,
                MAP_SIZE - (x + 0.5) * ADT_SIZE,
                0,
            ]);
            mat4.scale(this.scratchMat4, this.scratchMat4, [
                ADT_SIZE / 2,
                ADT_SIZE / 2,
                500,
            ]);
            offs += fillMatrix4x3(mapped, offs, this.scratchMat4);
            offs += fillVec4(mapped, offs, this.frequency * this.time);

            renderInst.setVertexInput(
                this.inputLayout,
                [this.vertexBuffer],
                this.indexBuffer,
            );
            renderInst.setBindingLayouts(LoadingAdtProgram.bindingLayouts);
            renderInst.setDrawCount(this.numIndices, 0);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer.buffer);
        device.destroyBuffer(this.indexBuffer.buffer);
    }
}

export class WaterRenderer {
    private inputLayout: GfxInputLayout;
    public buffers: [
        GfxIndexBufferDescriptor,
        GfxVertexBufferDescriptor[],
        LiquidInstance,
        LiquidType,
    ][] = [];
    public liquidTexturesByType: MapArray<number, TextureMapping> =
        new MapArray();
    public megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public deltaTime: number = 0;
    private scratchMat4 = mat4.identity(mat4.create());
    public time = 0.0;

    constructor(
        device: GfxDevice,
        renderHelper: GfxRenderHelper,
        public liquids: LiquidInstance[],
        public liquidTypes: Map<number, LiquidType>,
        private textureCache: TextureCache,
    ) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: WaterProgram.a_Position,
                bufferIndex: 0,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RGB,
            },
            {
                location: WaterProgram.a_TexCoord,
                bufferIndex: 0,
                bufferByteOffset: 12,
                format: GfxFormat.F32_RG,
            },
            {
                location: WaterProgram.a_Depth,
                bufferIndex: 0,
                bufferByteOffset: 20,
                format: GfxFormat.F32_R,
            },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 24, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        const cache = renderHelper.renderCache;
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });
        this.megaStateFlags = { cullMode: GfxCullMode.None };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        for (let layer of this.liquids) {
            const liquidType = this.liquidTypes.get(layer.liquidType);
            if (!liquidType) {
                throw new Error(
                    `liquid with type ${layer.liquidType}, but no matching LiquidType provided`,
                );
            }
            this.buffers.push([
                layer.takeIndices(device),
                [layer.takeVertices(device)],
                layer,
                liquidType,
            ]);
        }

        for (let liquidType of this.liquidTypes.values()) {
            if (!liquidType.animatedTextureIds) continue;
            for (let blpId of liquidType.animatedTextureIds) {
                const blp = liquidType.blps.get(blpId);
                assert(
                    blp !== undefined,
                    `blp (id=${blpId}) didn't exist in LiquidType`,
                );
                this.liquidTexturesByType.append(
                    liquidType.type,
                    this.textureCache.getTextureMapping(blpId, blp!.inner),
                );
            }
        }
    }

    public update(view: View) {
        this.time += view.deltaTime / 50.0;
    }

    public prepareToRenderWmoWater(renderInstManager: GfxRenderInstManager, frame: FrameData, wmoId: number) {
        for (let def of frame.wmoDefs.get(wmoId)) {
            const indices = frame.wmoLiquids.get(def.uniqueId);
            this.prepareToRenderWaterInner(
                renderInstManager,
                def.modelMatrix,
                indices,
            );
        }
    }

    public prepareToRenderAdtWater(
        renderInstManager: GfxRenderInstManager,
        frame: FrameData,
        adtFileId: number,
    ) {
        mat4.identity(this.scratchMat4);
        const indices = frame.adtLiquids.get(adtFileId);
        this.prepareToRenderWaterInner(
            renderInstManager,
            this.scratchMat4,
            indices,
        );
    }

    private prepareToRenderWaterInner(
        renderInstManager: GfxRenderInstManager,
        modelMatrix: mat4,
        indices: number[],
    ) {
        for (let i of indices) {
            const [indexBuffer, vertexBuffers, liquid, liquidType] =
                this.buffers[i];
            const renderInst = renderInstManager.newRenderInst();

            let offs = renderInst.allocateUniformBuffer(
                WaterProgram.ub_WaterParams,
                4 + 12,
            );
            const mapped = renderInst.mapUniformBufferF32(
                WaterProgram.ub_WaterParams,
            );
            offs += fillVec4(mapped, offs, liquidType.category);
            offs += fillMatrix4x3(mapped, offs, modelMatrix);

            const liquidTextures = this.liquidTexturesByType.get(
                liquid.liquidType,
            );
            if (liquidTextures) {
                const texIndex = Math.floor(this.time % liquidTextures.length);
                renderInst.setSamplerBindingsFromTextureMappings([
                    liquidTextures[texIndex],
                ]);
            } else {
                console.warn(`no tex`);
            }
            renderInst.setVertexInput(
                this.inputLayout,
                vertexBuffers,
                indexBuffer,
            );
            renderInst.setMegaStateFlags(this.megaStateFlags);
            renderInst.setDrawCount(liquid.indexCount);
            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice) {
        for (const [indexBuffer, vertexBuffers] of this.buffers) {
            device.destroyBuffer(indexBuffer.buffer);
            for (const vertexBuffer of vertexBuffers)
                device.destroyBuffer(vertexBuffer.buffer);
        }
    }
}

function destroyTextureMapping(device: GfxDevice, mapping: TextureMapping) {
    if (mapping.gfxTexture) {
        device.destroyTexture(mapping.gfxTexture);
    }
}

export class SkyboxRenderer {
    private inputLayout: GfxInputLayout;
    private vertexBuffer: GfxVertexBufferDescriptor;
    private indexBuffer: GfxIndexBufferDescriptor;
    public numIndices: number;

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: SkyboxProgram.a_Position,
                bufferIndex: 0,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RGB,
            },
            {
                location: SkyboxProgram.a_ColorIndex,
                bufferIndex: 0,
                bufferByteOffset: 3 * 4,
                format: GfxFormat.F32_R,
            },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        this.inputLayout = renderHelper.renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });

        this.vertexBuffer = {
            byteOffset: 0,
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Vertex,
                skyboxVertices.buffer,
            ),
        };
        const convertedIndices = convertToTriangleIndexBuffer(GfxTopology.TriStrips, skyboxIndices);
        this.numIndices = convertedIndices.length;
        this.indexBuffer = {
            byteOffset: 0,
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Index,
                convertedIndices.buffer,
            ),
        };
    }

    public prepareToRenderSkybox(renderInstManager: GfxRenderInstManager) {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(
            this.inputLayout,
            [this.vertexBuffer],
            this.indexBuffer,
        );
        renderInst.setMegaStateFlags({ depthWrite: false });
        renderInst.setBindingLayouts(SkyboxProgram.bindingLayouts);
        renderInst.setDrawCount(this.numIndices, 0);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer.buffer);
        device.destroyBuffer(this.indexBuffer.buffer);
    }
}
