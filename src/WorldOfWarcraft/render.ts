import { mat4 } from "gl-matrix";
import { TextureMapping } from "../TextureHolder.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxTopology, convertToTriangleIndexBuffer, convertToTrianglesRange } from "../gfx/helpers/TopologyHelpers.js";
import { fillMatrix4x4, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBlendFactor, GfxBlendMode, GfxBufferUsage, GfxCullMode, GfxDevice, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform.js";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat.js";
import { GfxInputLayout } from "../gfx/platform/GfxPlatformImpl.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { rust } from "../rustlib.js";
import { assert } from "../util.js";
import { AdtData, BlpData, ChunkData, DoodadData, LiquidInstance, LiquidType, ModelData, ModelRenderPass, SkinData, WmoBatchData, WmoData, WmoDefinition, WmoGroupData } from "./data.js";
import { loadingAdtIndices, loadingAdtVertices, skyboxIndices, skyboxVertices } from "./mesh.js";
import { DebugWmoPortalProgram, LoadingAdtProgram, MAX_BONE_TRANSFORMS, MAX_DOODAD_INSTANCES, ModelProgram, SkyboxProgram, TerrainProgram, WaterProgram, WmoProgram } from "./program.js";
import { MAP_SIZE, MapArray, View } from "./scenes.js";
import { TextureCache } from "./tex.js";

type TextureMappingArray = (TextureMapping | null)[];

export class ModelRenderer {
  private skinData: SkinData[] = [];
  private vertexBuffer: GfxVertexBufferDescriptor;
  private indexBuffers: GfxIndexBufferDescriptor[] = [];
  private skinPassTextures: TextureMappingArray[][] = [];
  private inputLayout: GfxInputLayout;
  public visible = true;
  private scratchMat4 = mat4.create();

  constructor(device: GfxDevice, public model: ModelData, renderHelper: GfxRenderHelper, private textureCache: TextureCache) {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
      { location: ModelProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
      { location: ModelProgram.a_BoneWeights, bufferIndex: 0, bufferByteOffset: 12, format: GfxFormat.U8_RGBA_NORM, },
      { location: ModelProgram.a_BoneIndices, bufferIndex: 0, bufferByteOffset: 16, format: GfxFormat.U8_RGBA, },
      { location: ModelProgram.a_Normal,   bufferIndex: 0, bufferByteOffset: 20, format: GfxFormat.F32_RGB, },
      { location: ModelProgram.a_TexCoord0, bufferIndex: 0, bufferByteOffset: 32, format: GfxFormat.F32_RG, },
      { location: ModelProgram.a_TexCoord1, bufferIndex: 0, bufferByteOffset: 40, format: GfxFormat.F32_RG, },
    ];
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
      { byteStride: rust.WowM2.get_vertex_stride(), frequency: GfxVertexBufferFrequency.PerVertex, },
    ];
    const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
    this.inputLayout = renderHelper.renderCache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

    this.vertexBuffer = {
      buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.model.vertexBuffer.buffer),
      byteOffset: 0,
    };

    for (let i in this.model.skins) {
      const skinData = this.model.skins[i];
      this.indexBuffers.push({
        buffer: makeStaticDataBuffer(device, GfxBufferUsage.Index, skinData.indexBuffer.buffer),
        byteOffset: 0,
      });
      this.skinData.push(skinData);
      this.skinPassTextures[i] = [];
      for (let renderPass of skinData.renderPasses) {
        this.skinPassTextures[i].push(this.getRenderPassTextures(renderPass));
      }
    }
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

  private getTextureMapping(blpData: BlpData | null): TextureMapping | null {
    if (blpData === null)
      return null;

    const wrapS = !!(blpData.flags & 0x01);
    const wrapT = !!(blpData.flags & 0x02);
    return this.textureCache.getTextureMapping(blpData.fileId, blpData.inner, { wrapS, wrapT });
  }

  private getRenderPassTextures(renderPass: ModelRenderPass): TextureMappingArray {
    return [
      this.getTextureMapping(renderPass.tex0),
      this.getTextureMapping(renderPass.tex1),
      this.getTextureMapping(renderPass.tex2),
      this.getTextureMapping(renderPass.tex3),
    ];
  }

  public prepareToRenderModel(renderInstManager: GfxRenderInstManager, doodads: DoodadData[]): void {
    if (!this.isDrawable()) return;

    const visibleDoodads = doodads.filter(d => d.visible);

    for (let doodadChunk of chunk(visibleDoodads, MAX_DOODAD_INSTANCES)) {
      const template = renderInstManager.pushTemplateRenderInst();
      const numMat4s = 2;
      const numVec4s = 3;
      const instanceParamsSize = (16 * numMat4s + 4 * numVec4s);
      const boneParamsSize = (16 * 1 + 4 * 1);
      const baseOffs = template.allocateUniformBuffer(ModelProgram.ub_DoodadParams,
        instanceParamsSize * MAX_DOODAD_INSTANCES + boneParamsSize * MAX_BONE_TRANSFORMS);
      let offs = baseOffs;
      const mapped = template.mapUniformBufferF32(ModelProgram.ub_DoodadParams);
      for (let doodad of doodadChunk) {
        offs += fillMatrix4x4(mapped, offs, doodad.modelMatrix);
        offs += fillMatrix4x4(mapped, offs, doodad.normalMatrix);
        offs += fillVec4v(mapped, offs, doodad.ambientColor);
        offs += fillVec4(mapped, offs, 0);
        offs += fillVec4(mapped, offs,
          doodad.applyInteriorLighting ? 1.0 : 0.0,
          doodad.applyExteriorLighting ? 1.0 : 0.0,
          doodad.applyInteriorLighting ? 1.0 : 0.0,
          doodad.isSkybox ? 1.0 : 0.0
        );
      }
      offs = baseOffs + instanceParamsSize * MAX_DOODAD_INSTANCES;
      assert(this.model.boneTransforms.length < MAX_BONE_TRANSFORMS, `model got too many bones (${this.model.boneTransforms.length})`);
      mat4.identity(this.scratchMat4);
      for (let i=0; i<MAX_BONE_TRANSFORMS; i++) {
        if (i < this.model.boneTransforms.length) {
          offs += fillMatrix4x4(mapped, offs, this.model.boneTransforms[i]);
          offs += fillVec4(mapped, offs, this.model.boneFlags[i].spherical_billboard ? 1 : 0);
        } else {
          offs += fillMatrix4x4(mapped, offs, this.scratchMat4);
          offs += fillVec4(mapped, offs, 0);
        }
      }

      for (let i=0; i<this.skinData.length; i++) {
        const skinData = this.skinData[i];
        const indexBuffer = this.indexBuffers[i];
        for (let j=0; j < skinData.renderPasses.length; j++) {
          const renderPass = skinData.renderPasses[j];
          let renderInst = renderInstManager.newRenderInst();
          renderInst.setVertexInput(this.inputLayout, [this.vertexBuffer], indexBuffer);
          renderPass.setMegaStateFlags(renderInst);
          renderInst.setDrawCount(renderPass.submesh.index_count, renderPass.submesh.index_start, doodadChunk.length);
          const mappings = this.skinPassTextures[i][j];
          renderInst.setSamplerBindingsFromTextureMappings(mappings);
          renderPass.setModelParams(renderInst);
          renderInstManager.submitRenderInst(renderInst);
        }
      }
      renderInstManager.popTemplateRenderInst();
    }
  }

  public prepareToRenderSkybox(renderInstManager: GfxRenderInstManager) {
  }
  
  public destroy(device: GfxDevice): void {
    device.destroyBuffer(this.vertexBuffer.buffer);
    for (let indexBuffer of this.indexBuffers) {
      device.destroyBuffer(indexBuffer.buffer);
    }
  }
}

function chunk<T>(arr: T[], chunkSize: number): T[][] {
  const ret: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize)
      ret.push(arr.slice(i, i + chunkSize));
  return ret;
}

export class WmoRenderer {
  private inputLayouts: GfxInputLayout[] = [];
  private vertexBuffers: GfxVertexBufferDescriptor[][] = [];
  private indexBuffers: GfxIndexBufferDescriptor[] = [];
  private groups: WmoGroupData[] = [];
  public batches: WmoBatchData[][] = [];
  public visible: boolean = true;
  public groupBatchTextureMappings: TextureMappingArray[][] = [];

  constructor(device: GfxDevice, private wmo: WmoData, private textureCache: TextureCache, renderHelper: GfxRenderHelper) {
    for (let group of this.wmo.groups) {
      this.inputLayouts.push(group.getInputLayout(renderHelper.renderCache));
      this.vertexBuffers.push(group.getVertexBuffers(device));
      this.indexBuffers.push(group.getIndexBuffer(device));
      this.batches.push(group.getBatches(this.wmo));
      this.groups.push(group);
    }
    for (let i in this.batches) {
      const batches = this.batches[i];
      this.groupBatchTextureMappings[i] = [];
      for (let batch of batches) {
        this.groupBatchTextureMappings[i].push(this.getBatchTextureMapping(batch));
      }
    }
  }

  private getBatchTextureMapping(batch: WmoBatchData): TextureMappingArray {
    const mappings = []
    for (let blp of batch.textures) {
      if (blp === null) {
        mappings.push(this.textureCache.getAllWhiteTextureMapping());
      } else {
        const wrapS = !batch.materialFlags.clamp_s;
        const wrapT = !batch.materialFlags.clamp_t;
        mappings.push(this.textureCache.getTextureMapping(blp.fileId, blp.inner, { wrapS, wrapT }));
      }
    }
    return mappings;
  }

  public prepareToRenderWmo(renderInstManager: GfxRenderInstManager, defs: WmoDefinition[]) {
    if (!this.visible) return;
    for (let def of defs) {
      if (!def.visible) continue;
      assert(def.wmoId === this.wmo.fileId, `WmoRenderer handed a WmoDefinition that doesn't belong to it (${def.wmoId} != ${this.wmo.fileId}`);
      const template = renderInstManager.pushTemplateRenderInst();
      let offs = template.allocateUniformBuffer(WmoProgram.ub_ModelParams, 2 * 16);
      const mapped = template.mapUniformBufferF32(WmoProgram.ub_ModelParams);
      offs += fillMatrix4x4(mapped, offs, def.modelMatrix);
      offs += fillMatrix4x4(mapped, offs, def.normalMatrix);

      for (let i=0; i<this.vertexBuffers.length; i++) {
        const group = this.groups[i];
        if (!def.isWmoGroupVisible(group.fileId)) continue;
        const ambientColor = def.groupAmbientColors.get(group.fileId)!;
        const applyInteriorLight = group.flags.interior && !group.flags.exterior_lit;
        const applyExteriorLight = true;
        template.setVertexInput(this.inputLayouts[i], this.vertexBuffers[i], this.indexBuffers[i]);
        for (let j in this.batches[i]) {
          const batch = this.batches[i][j];
          if (!batch.visible) continue;
          const renderInst = renderInstManager.newRenderInst();
          let offset = renderInst.allocateUniformBuffer(WmoProgram.ub_BatchParams, 4 * 4);
          const uniformBuf = renderInst.mapUniformBufferF32(WmoProgram.ub_BatchParams);
          offset += fillVec4(uniformBuf, offset,
            batch.vertexShader,
            batch.pixelShader,
            0,
            0
          );
          offset += fillVec4(uniformBuf, offset,
            batch.material.blend_mode,
            applyInteriorLight ? 1 : 0,
            applyExteriorLight ? 1 : 0,
            0
          );
          offset += fillVec4v(uniformBuf, offset, ambientColor);
          offset += fillVec4v(uniformBuf, offset, [0, 0, 0, 0]);
          batch.setMegaStateFlags(renderInst);
          renderInst.setSamplerBindingsFromTextureMappings(this.groupBatchTextureMappings[i][j]);
          renderInst.setDrawCount(batch.indexCount, batch.indexStart);
          renderInstManager.submitRenderInst(renderInst);
        }
      }
      renderInstManager.popTemplateRenderInst();
    }
  }

  public destroy(device: GfxDevice) {
    for (let i=0; i<this.vertexBuffers.length; i++) {
      this.vertexBuffers[i].forEach(buf => device.destroyBuffer(buf.buffer));
      device.destroyBuffer(this.indexBuffers[i].buffer);
    }
  }
}

export class TerrainRenderer {
  private inputLayout: GfxInputLayout;
  public indexBuffer: GfxIndexBufferDescriptor;
  public vertexBuffer: GfxVertexBufferDescriptor;
  public alphaTextureMappings: (TextureMapping | null)[] = [];
  public chunkTextureMappings: TextureMappingArray[] = [];

  constructor(device: GfxDevice, renderHelper: GfxRenderHelper, public adt: AdtData, private textureCache: TextureCache) {
    const adtVboInfo = rust.WowAdt.get_vbo_info();
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
      { location: TerrainProgram.a_ChunkIndex, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_R },
      { location: TerrainProgram.a_Position,   bufferIndex: 0, bufferByteOffset: adtVboInfo.vertex_offset, format: GfxFormat.F32_RGB, },
      { location: TerrainProgram.a_Normal,     bufferIndex: 0, bufferByteOffset: adtVboInfo.normal_offset, format: GfxFormat.F32_RGB, },
      { location: TerrainProgram.a_Color,      bufferIndex: 0, bufferByteOffset: adtVboInfo.color_offset, format: GfxFormat.F32_RGBA, },
      { location: TerrainProgram.a_Lighting,   bufferIndex: 0, bufferByteOffset: adtVboInfo.lighting_offset, format: GfxFormat.F32_RGBA, },
    ];
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
      { byteStride: adtVboInfo.stride, frequency: GfxVertexBufferFrequency.PerVertex },
    ];
    const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
    const cache = renderHelper.renderCache;
    this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    [this.vertexBuffer, this.indexBuffer] = this.adt.getBufsAndChunks(device);
    for (let i in this.adt.chunkData) {
      const chunk = this.adt.chunkData[i];
      this.chunkTextureMappings[i] = this.getChunkTextureMapping(chunk);

      if (chunk.alphaTexture) {
        const alphaMapping = textureCache.getAlphaTextureMapping(device, chunk.alphaTexture);
        chunk.alphaTexture = undefined;
        this.alphaTextureMappings.push(alphaMapping)
        this.chunkTextureMappings[i].push(alphaMapping);
      } else {
        this.chunkTextureMappings[i].push(textureCache.getDefaultAlphaTextureMapping());
      }
    }
  }

  private getChunkTextureMapping(chunk: ChunkData): TextureMappingArray {
    let mapping: TextureMappingArray = [null, null, null, null];
    chunk.textures.forEach((blp, i) => {
      if (blp) {
        mapping[i] = this.textureCache.getTextureMapping(blp.fileId, blp.inner);
      } else {
        mapping[i] = null;
      }
    })
    return mapping;
  }

  public prepareToRenderTerrain(renderInstManager: GfxRenderInstManager) {
    if (!this.adt.visible) return;
    const template = renderInstManager.pushTemplateRenderInst();
    template.setVertexInput(this.inputLayout, [this.vertexBuffer], this.indexBuffer);
    this.adt.chunkData.forEach((chunk, i) => {
      if (chunk.indexCount > 0 && chunk.visible) {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setSamplerBindingsFromTextureMappings(this.chunkTextureMappings[i]);
        renderInst.setDrawCount(chunk.indexCount, chunk.indexOffset);
        renderInstManager.submitRenderInst(renderInst);
      }
    })
    renderInstManager.popTemplateRenderInst();
  }

  public destroy(device: GfxDevice) {
    device.destroyInputLayout(this.inputLayout);
    device.destroyBuffer(this.vertexBuffer.buffer);
    device.destroyBuffer(this.indexBuffer.buffer);
    for (let mapping of this.alphaTextureMappings) {
      if (mapping) {
        destroyTextureMapping(device, mapping);
      }
    }
  }
}

export class DebugWmoPortalRenderer {
  private inputLayout: GfxInputLayout;
  private vertexBuffer: GfxVertexBufferDescriptor;
  private indexBuffer: GfxIndexBufferDescriptor;
  private portals: [number, number][] = [];
  private numIndices: number;

  constructor(device: GfxDevice, renderHelper: GfxRenderHelper, private wmo: WmoData) {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
      { location: LoadingAdtProgram.a_Position,   bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
    ];
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
      { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex, },
    ];
    const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
    this.inputLayout = renderHelper.renderCache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

    let numIndices = 0;
    for (let portal of this.wmo.portals) {
      assert(portal.vertexCount > 0);
      numIndices += (portal.vertexCount - 2) * 3;
    }

    const indices = new Uint16Array(numIndices);
    let offset = 0;
    for (let portal of this.wmo.portals) {
      const start = offset;
      convertToTrianglesRange(indices, offset, GfxTopology.TriFans, portal.vertexStart, portal.vertexCount);
      offset += (portal.vertexCount - 2) * 3;
      this.portals.push([start, offset - start])
    }
    this.numIndices = offset;

    this.vertexBuffer = { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.wmo.portalVertices.buffer )}
    this.indexBuffer = { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Index, new Uint16Array(indices).buffer )}
  }

  public prepareToRenderDebugPortals(renderInstManager: GfxRenderInstManager, defs: WmoDefinition[]) {
    for (let def of defs) {
      assert(def.wmoId === this.wmo.fileId, `WmoRenderer handed a WmoDefinition that doesn't belong to it (${def.wmoId} != ${this.wmo.fileId}`);
      const renderInst = renderInstManager.newRenderInst();
      let offs = renderInst.allocateUniformBuffer(DebugWmoPortalProgram.ub_ModelParams, 16);
      const mapped = renderInst.mapUniformBufferF32(DebugWmoPortalProgram.ub_ModelParams);
      offs += fillMatrix4x4(mapped, offs, def.modelMatrix);
      renderInst.setVertexInput(this.inputLayout, [this.vertexBuffer], this.indexBuffer);
      renderInst.setDrawCount(this.numIndices);
      renderInst.setMegaStateFlags({ cullMode: GfxCullMode.None });
      renderInstManager.submitRenderInst(renderInst);
    }
  }
}

export class LoadingAdtRenderer {
  private inputLayout: GfxInputLayout;
  private vertexBuffer: GfxVertexBufferDescriptor;
  private indexBuffer: GfxIndexBufferDescriptor;
  private scratchMat4 = mat4.create();
  private time: number = 0;
  public frequency = 0.1;
  public numIndices: number;

  constructor(device: GfxDevice, renderHelper: GfxRenderHelper) {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
      { location: LoadingAdtProgram.a_Position,   bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
    ];
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
      { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex, },
    ];
    const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
    this.inputLayout = renderHelper.renderCache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

    this.vertexBuffer = { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, loadingAdtVertices.buffer )}
    this.numIndices = loadingAdtIndices.length;
    this.indexBuffer = { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Index, loadingAdtIndices.buffer) };
  }

  public update(view: View) {
    this.time = view.time;
  }

  public prepareToRenderLoadingBox(renderInstManager: GfxRenderInstManager, loadingAdts: [number, number][]) {
    for (let [x, y] of loadingAdts) {
      const renderInst = renderInstManager.newRenderInst();

      let offs = renderInst.allocateUniformBuffer(LoadingAdtProgram.ub_ModelParams, 16 + 4);
      const mapped = renderInst.mapUniformBufferF32(LoadingAdtProgram.ub_ModelParams);
      mat4.identity(this.scratchMat4);
      const ADT_SIZE = 1600.0 / 3.0;
      mat4.translate(this.scratchMat4, this.scratchMat4, [MAP_SIZE - (y + 0.5) * ADT_SIZE, MAP_SIZE - (x + 0.5) * ADT_SIZE, 0]);
      mat4.scale(this.scratchMat4, this.scratchMat4, [ADT_SIZE / 2, ADT_SIZE / 2, 500]);
      offs += fillMatrix4x4(mapped, offs, this.scratchMat4);
      offs += fillVec4(mapped, offs, this.frequency * this.time);

      renderInst.setVertexInput(this.inputLayout, [this.vertexBuffer], this.indexBuffer);
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
  public buffers: [GfxIndexBufferDescriptor, GfxVertexBufferDescriptor[], LiquidInstance, LiquidType][] = [];
  public liquidTexturesByType: MapArray<number, TextureMapping> = new MapArray();
  public megaStateFlags: Partial<GfxMegaStateDescriptor>;
  public time: number = 0;
  private scratchMat4 = mat4.identity(mat4.create());

  constructor(device: GfxDevice, renderHelper: GfxRenderHelper, public liquids: LiquidInstance[], public liquidTypes: Map<number, LiquidType>, private textureCache: TextureCache) {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
      { location: WaterProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
      { location: WaterProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 12, format: GfxFormat.F32_RG },
    ];
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
      { byteStride: 20, frequency: GfxVertexBufferFrequency.PerVertex },
    ];
    const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
    const cache = renderHelper.renderCache;
    this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    this.megaStateFlags = { cullMode: GfxCullMode.None };
    setAttachmentStateSimple(this.megaStateFlags, {
      blendMode: GfxBlendMode.Add,
      blendSrcFactor: GfxBlendFactor.SrcAlpha,
      blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
    });

    for (let layer of this.liquids) {
      const liquidType = this.liquidTypes.get(layer.liquidType);
      if (!liquidType) {
        throw new Error(`liquid with type ${layer.liquidType}, but no matching LiquidType provided`);
      }
      this.buffers.push([
        layer.takeIndices(device),
        [layer.takeVertices(device)],
        layer,
        liquidType
      ]);
    }

    for (let liquidType of this.liquidTypes.values()) {
      if (!liquidType.animatedTextureIds) continue;
      for (let blpId of liquidType.animatedTextureIds) {
        const blp = liquidType.blps.get(blpId);
        assert(blp !== undefined, `blp (id=${blpId}) didn't exist in LiquidType`);
        this.liquidTexturesByType.append(liquidType.type, this.textureCache.getTextureMapping(blpId, blp!.inner));
      }
    }
  }

  public update(view: View) {
    this.time = view.time;
  }

  public prepareToRenderWmoWater(renderInstManager: GfxRenderInstManager, defs: WmoDefinition[]) {
    for (let def of defs) {
      this.prepareToRenderWaterInner(renderInstManager, def.modelMatrix, def.liquidVisibility);
    }
  }

  public prepareToRenderAdtWater(renderInstManager: GfxRenderInstManager) {
    mat4.identity(this.scratchMat4);
    this.prepareToRenderWaterInner(renderInstManager, this.scratchMat4);
  }

  private prepareToRenderWaterInner(renderInstManager: GfxRenderInstManager, modelMatrix: mat4, visibilityArray: boolean[] | undefined = undefined) {
    if (visibilityArray) {
      assert(visibilityArray.length === this.buffers.length, "visibilityArray must match buffers array");
    }
    for (let i in this.buffers) {
      if (visibilityArray) {
        if (!visibilityArray[i]) continue;
      }
      const [indexBuffer, vertexBuffers, liquid, liquidType] = this.buffers[i];
      if (!liquid.visible) continue;
      const renderInst = renderInstManager.newRenderInst();

      let offs = renderInst.allocateUniformBuffer(WaterProgram.ub_WaterParams, 16 + 4);
      const mapped = renderInst.mapUniformBufferF32(WaterProgram.ub_WaterParams);
      offs += fillVec4(mapped, offs, liquidType.category);
      offs += fillMatrix4x4(mapped, offs, modelMatrix);

      const liquidTextures = this.liquidTexturesByType.get(liquid.liquidType);
      if (liquidTextures) {
        const texIndex = Math.floor(this.time % liquidTextures.length);
        renderInst.setSamplerBindingsFromTextureMappings([liquidTextures[texIndex]]);
      } else {
        console.warn(`no tex`)
      }
      renderInst.setVertexInput(this.inputLayout, vertexBuffers, indexBuffer);
      renderInst.setMegaStateFlags(this.megaStateFlags);
      renderInst.setDrawCount(liquid.indexCount);
      renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT)
      renderInstManager.submitRenderInst(renderInst);
    }
  }

  public destroy(device: GfxDevice) {
    device.destroyInputLayout(this.inputLayout);
  }
}

function destroyTextureMapping(device: GfxDevice, mapping: TextureMapping) {
  if (mapping.gfxSampler) {
    device.destroySampler(mapping.gfxSampler);
  }
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
      { location: SkyboxProgram.a_Position,   bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
      { location: SkyboxProgram.a_ColorIndex, bufferIndex: 0, bufferByteOffset: 3 * 4, format: GfxFormat.F32_R, },
    ];
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
      { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex, },
    ];
    const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
    this.inputLayout = renderHelper.renderCache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

    this.vertexBuffer = { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, skyboxVertices.buffer )}
    const convertedIndices = convertToTriangleIndexBuffer(GfxTopology.TriStrips, skyboxIndices);
    this.numIndices = convertedIndices.length;
    this.indexBuffer = { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Index, convertedIndices.buffer) };
  }

  public prepareToRenderSkybox(renderInstManager: GfxRenderInstManager) {
    const renderInst = renderInstManager.newRenderInst();
    renderInst.setVertexInput(this.inputLayout, [this.vertexBuffer], this.indexBuffer);
    renderInst.setBindingLayouts(SkyboxProgram.bindingLayouts);
    renderInst.setDrawCount(this.numIndices, 0);
    renderInstManager.submitRenderInst(renderInst);
  }

  public destroy(device: GfxDevice) {
    device.destroyBuffer(this.vertexBuffer.buffer);
    device.destroyBuffer(this.indexBuffer.buffer);
  }
}
