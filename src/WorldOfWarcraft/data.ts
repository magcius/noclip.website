import { ReadonlyMat4, mat4, quat, vec3, vec4 } from "gl-matrix";
import { WowAABBox, WowAdt, WowAdtChunkDescriptor, WowAdtLiquidLayer, WowAdtWmoDefinition, WowArgb, WowBlp, WowDatabase, WowDoodad, WowDoodadDef, WowGlobalWmoDefinition, WowLightResult, WowLiquidResult, WowM2, WowM2AnimationManager, WowM2BlendingMode, WowM2BoneFlags, WowM2MaterialFlags, WowMapFileDataIDs, WowModelBatch, WowSkin, WowSkinSubmesh, WowVec3, WowWmo, WowWmoBspNode, WowWmoGroupFlags, WowWmoGroupInfo, WowWmoHeaderFlags, WowWmoLiquidResult, WowWmoMaterial, WowWmoMaterialBatch, WowWmoMaterialFlags, WowWmoMaterialPixelShader, WowWmoMaterialVertexShader, WowWmoPortal, WowWmoPortalRef } from "../../rust/pkg";
import { DataFetcher } from "../DataFetcher.js";
import { drawWorldSpaceLine, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { AABB, Frustum, Plane } from "../Geometry.js";
import { MathConstants, setMatrixTranslation } from "../MathHelpers.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import { fillMatrix4x4, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBlendFactor, GfxBlendMode, GfxBufferUsage, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInst, GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { rust } from "../rustlib.js";
import { assert } from "../util.js";
import { ModelProgram, WmoProgram } from "./program.js";
import { MapArray, View, adtSpaceFromPlacementSpace, modelSpaceFromPlacementSpace, noclipSpaceFromAdtSpace, placementSpaceFromAdtSpace, placementSpaceFromModelSpace } from "./scenes.js";
import { fetchDataByFileID, fetchFileByID, getFileDataId } from "./util.js";

export class Database {
  private inner: WowDatabase;

  constructor(public mapId: number) {
  }

  public async load(dataFetcher: DataFetcher) {
    let lightDbData = await fetchDataByFileID(1375579, dataFetcher);
    let lightDataDbData = await fetchDataByFileID(1375580, dataFetcher);
    let lightParamsDbData = await fetchDataByFileID(1334669, dataFetcher);
    let liquidTypes = await fetchDataByFileID(1371380, dataFetcher);
    let lightSkyboxData = await fetchDataByFileID(1308501, dataFetcher);
    this.inner = rust.WowDatabase.new(
      lightDbData,
      lightDataDbData,
      lightParamsDbData,
      liquidTypes,
      lightSkyboxData
    );
  }

  public getGlobalLightingData(coords: vec3, time: number): WowLightResult {
    return this.inner.get_lighting_data(this.mapId, coords[0], coords[1], coords[2], time);
  }

  public getLiquidType(liquidType: number): WowLiquidResult | undefined {
    return this.inner.get_liquid_type(liquidType);
  }
}

type LoadFunc<T> = (fileId: number) => Promise<T>;

export class WowCache {
  private promiseCache = new Map<number, Promise<unknown>>();
  private promiseCacheLiquidTypes = new Map<number, Promise<LiquidType>>(); // liquid types aren't fileIDs

  constructor(public dataFetcher: DataFetcher, public db: Database) {
  }

  public clear() {
    this.promiseCache.clear();
    this.promiseCacheLiquidTypes.clear();
  }

  private getOrLoad<T>(fileId: number, loadFunc: LoadFunc<T>, cache = this.promiseCache): Promise<T> {
    let promise = cache.get(fileId) as Promise<T>;
    if (promise === undefined) {
      promise = loadFunc(fileId);
      cache.set(fileId, promise);
    }
    return promise;
  }

  public async loadModel(fileId: number): Promise<ModelData> {
    return this.getOrLoad(fileId, async (fileId: number) => {
      const d = new ModelData(fileId);
      await d.load(this.dataFetcher, this);
      return d;
    });
  }

  public async loadWmo(fileId: number): Promise<WmoData> {
    return this.getOrLoad(fileId, async (fileId: number) => {
      const d = new WmoData(fileId);
      await d.load(this.dataFetcher, this);
      return d;
    });
  }

  public async loadWmoGroup(fileId: number): Promise<WmoGroupData> {
    return this.getOrLoad(fileId, async (fileId: number) => {
      const d = new WmoGroupData(fileId);
      await d.load(this.dataFetcher, this);
      return d;
    });
  }

  public async loadBlp(fileId: number): Promise<WowBlp> {
    return this.getOrLoad(fileId, async (fileId: number) => {
      return await fetchFileByID(fileId, this.dataFetcher, rust.WowBlp.new);
    });
  }

  public async loadLiquidType(type: number): Promise<LiquidType> {
    return this.getOrLoad(type, async (type: number) => {
      const liquidTypeDb = this.db.getLiquidType(type);
      if (!liquidTypeDb) {
        throw new Error(`WowDatabase didn't have LiquidType ${type}`);
      }
      const liquidType = new LiquidType(type, liquidTypeDb);
      await liquidType.load(this);
      return liquidType;
    }, this.promiseCacheLiquidTypes);
  }
}

export enum ProceduralTexture {
  River = 0,
  Ocean = 0,
  Wmo = 0,
}

export enum LiquidCategory {
  Water = 0,
  Ocean = 1,
  Lava = 2,
  Slime = 3,
}

export class LiquidType {
  public flags: number;
  public category: LiquidCategory;
  public name: string;
  public blps: Map<number, BlpData> = new Map();
  public animatedTextureIds: number[] | undefined;
  public proceduralTexture: ProceduralTexture | undefined;
  public textureIds: (number | undefined)[] = [];

  constructor(public type: number, liquid: WowLiquidResult) {
    this.flags = liquid.flags;
    this.name = liquid.name;
    if (this.name.includes('Slime')) {
      this.category = LiquidCategory.Slime;
    } else if (this.name.includes('Magma') || this.name.includes('Lava')) {
      this.category = LiquidCategory.Lava;
    } else if (this.name.includes('Ocean')) {
      this.category = LiquidCategory.Ocean;
    } else {
      this.category = LiquidCategory.Water;
    }
    const positionalTemplate = liquid.tex0;
    if (positionalTemplate) {
      const positionals = [];
      for (let i=1; i<31; i++) {
        const fileName = positionalTemplate.replace("%d", i.toString());
        try {
          const fileDataId = getFileDataId(fileName);
          assert(fileDataId !== undefined, "couldn't find positional texture");
          positionals.push(fileDataId);
        } catch (e) {
          if (i !== 1) {
            break;
          } else {
            throw e;
          }
        }
      }
      this.animatedTextureIds = positionals;
    }
    const maybeProcedural = liquid.tex1;
    if (maybeProcedural && maybeProcedural.startsWith('procedural')) {
      if (maybeProcedural.includes('River')) {
        this.proceduralTexture = ProceduralTexture.River;
      } else if (maybeProcedural.includes('Ocean')) {
        this.proceduralTexture = ProceduralTexture.Ocean;
      } else if (maybeProcedural.includes('Wmo')) {
        this.proceduralTexture = ProceduralTexture.Wmo;
      }
    } else {
      this.textureIds.push(this.pathToFileId(maybeProcedural));
    }
    this.textureIds.push(this.pathToFileId(liquid.tex2));
    this.textureIds.push(this.pathToFileId(liquid.tex3));
    this.textureIds.push(this.pathToFileId(liquid.tex4));
    this.textureIds.push(this.pathToFileId(liquid.tex5));
    liquid.free();
  }

  public async load(cache: WowCache): Promise<undefined> {
    if (this.animatedTextureIds) {
      for (let blpId of this.animatedTextureIds) {
        try {
          this.blps.set(blpId, new BlpData(blpId, await cache.loadBlp(blpId)));
        } catch(e) {
          console.error(`failed to load BLP ${blpId}: ${e}`);
        }
      }
    }
  }

  private pathToFileId(path: string): number | undefined {
    if (path === '') {
      return undefined;
    }
    return getFileDataId(this.fixPath(path));
  }

  private fixPath(path: string): string {
    if (!path.endsWith('.blp')) {
      path += '.blp';
    }
    return path;
  }
}

function convertWowVec3(wowVec3: WowVec3): vec3 {
  const result = vec3.fromValues(wowVec3.x, wowVec3.y, wowVec3.z);
  wowVec3.free();
  return result;
}

function convertWowAABB(aabb: WowAABBox): AABB {
    const min = aabb.min;
    const max = aabb.max;
    const result = new AABB(
      min.x,
      min.y,
      min.z,
      max.x,
      max.y,
      max.z,
    );
    aabb.free();
    min.free();
    max.free();
    return result;
}

const TEX_PIVOT: vec3 = [0.5, 0.5, 0];
const TEX_ANTIPIVOT: vec3 = [-0.5, -0.5, 0];
export class ModelData {
  public skins: WowSkin[] = [];
  public blps: BlpData[] = [];
  public vertexBuffer: Uint8Array;
  public vertexColors: Float32Array;
  public numTextureTransformations: number;
  public textureWeights: Float32Array;
  public textureRotations: Float32Array;
  public textureScalings: Float32Array;
  public textureTranslations: Float32Array;
  public numColors: number;
  public numBones: number;
  public boneRotations: Float32Array;
  public boneScalings: Float32Array;
  public boneTranslations: Float32Array;
  public textureTransforms: mat4[] = [];
  public boneTransforms: mat4[] = [];
  public bonePivots: mat4[] = [];
  public boneAntipivots: mat4[] = [];
  public texturePivot = mat4.create();
  public textureAntipivot = mat4.create();
  public boneParents: Int16Array;
  public boneFlags: WowM2BoneFlags[] = [];
  public materials: [WowM2BlendingMode, WowM2MaterialFlags][] = [];
  public animationManager: WowM2AnimationManager;
  public textureLookupTable: Uint16Array;
  public boneLookupTable: Uint16Array;
  public textureTransparencyLookupTable: Uint16Array;
  public textureTransformLookupTable: Uint16Array;
  public modelAABB: AABB;

  constructor(public fileId: number) {
    mat4.fromScaling(this.texturePivot, TEX_PIVOT);
    mat4.fromScaling(this.textureAntipivot, TEX_ANTIPIVOT);
  }

  private getTextureIds(cache: WowCache, m2: WowM2): number[] {
    if (m2.texture_ids.length !== 0) {
      return Array.from(m2.texture_ids);
    } else {
      const legacyTextures = m2.take_legacy_textures();
      const texture_ids: number[] = [];
      for (let tex of legacyTextures) {
        const txid = getFileDataId(tex.filename);
        texture_ids.push(txid);
        // FIXME should store flags somewhere
        tex.free();
      }
      return texture_ids;
    }
  }

  private loadTextures(cache: WowCache, m2: WowM2): Promise<BlpData[]> {
    // XXX(jstpierre): Blackrock Depths seems to have invalid texture IDs on world/khazmodan/blackrock/passivedoodads/golemparts/cannongolemwaist.m2
    const textureIds = this.getTextureIds(cache, m2).filter((fileID) => fileID !== 0);
    return Promise.all(textureIds.map(async (fileID) => {
      return new BlpData(fileID, await cache.loadBlp(fileID));
    }));
  }

  private loadSkins(cache: WowCache, m2: WowM2): Promise<WowSkin[]> {
    return Promise.all(Array.from(m2.skin_ids).map(async (fileId) => {
      return fetchFileByID(fileId, cache.dataFetcher, rust.WowSkin.new);
    }));
  }

  public async load(dataFetcher: DataFetcher, cache: WowCache): Promise<undefined> {
    const m2 = await fetchFileByID(this.fileId, dataFetcher, rust.WowM2.new);

    this.blps = await this.loadTextures(cache, m2);
    this.skins = await this.loadSkins(cache, m2);

    this.vertexBuffer = m2.take_vertex_data();
    this.modelAABB = convertWowAABB(m2.get_bounding_box());

    this.textureLookupTable = m2.take_texture_lookup();
    this.boneLookupTable = m2.take_bone_lookup();
    this.textureTransformLookupTable = m2.take_texture_transform_lookup();
    this.textureTransparencyLookupTable = m2.take_texture_transparency_lookup();

    const m2Materials = m2.materials;
    this.materials = m2Materials.map(mat => {
      return [mat.blending_mode, rust.WowM2MaterialFlags.new(mat.flags)];
    });
    m2Materials.forEach(mat => mat.free());

    this.animationManager = m2.take_animation_manager();
    this.textureWeights = new Float32Array(this.animationManager.get_num_texture_weights());
    this.numTextureTransformations = this.animationManager.get_num_transformations();
    this.textureTranslations = new Float32Array(this.numTextureTransformations * 3);
    this.textureRotations = new Float32Array(this.numTextureTransformations * 4);
    this.textureScalings = new Float32Array(this.numTextureTransformations * 3);
    this.numBones = this.animationManager.get_num_bones();
    this.boneTranslations = new Float32Array(this.numBones * 3);
    this.boneRotations = new Float32Array(this.numBones * 4);
    this.boneScalings = new Float32Array(this.numBones * 3);
    this.numColors = this.animationManager.get_num_colors();
    this.vertexColors = new Float32Array(this.numColors * 3);
    for (let i=0; i<this.numTextureTransformations; i++) {
      this.textureTransforms.push(mat4.create());
    }
    for (let i=0; i<this.numBones; i++) {
      this.boneTransforms.push(mat4.create());
    }
    this.boneParents = this.animationManager.get_bone_parents();
    this.boneFlags = this.animationManager.get_bone_flags();
    for (let pivot of this.animationManager.get_bone_pivots()) {
      this.bonePivots.push(mat4.fromTranslation(mat4.create(), [pivot.x, pivot.y, pivot.z]));
      this.boneAntipivots.push(mat4.fromTranslation(mat4.create(), [-pivot.x, -pivot.y, -pivot.z]));
      pivot.free();
    }
    m2.free();
  }

  public updateAnimation(view: View) {
    this.animationManager.update_animations(
      view.deltaTime,
      this.textureWeights,
      this.textureTranslations,
      this.textureRotations,
      this.textureScalings,
      this.boneTranslations,
      this.boneRotations,
      this.boneScalings,
      this.vertexColors
    );

    for (let i = 0; i < this.numTextureTransformations; i++) {
      mat4.fromRotationTranslationScale(this.textureTransforms[i],
        this.textureRotations.slice(i * 4, (i + 1) * 4),
        this.textureTranslations.slice(i * 3, (i + 1) * 3),
        this.textureScalings.slice(i * 3, (i + 1) * 3),
      );
    }

    for (let i = 0; i < this.numBones; i++) {
      const parentId = this.boneParents[i];
      assert(parentId < i, "bone parent > bone");
      mat4.fromRotationTranslationScale(this.boneTransforms[i],
        this.boneRotations.slice(i * 4, (i + 1) * 4),
        this.boneTranslations.slice(i * 3, (i + 1) * 3),
        this.boneScalings.slice(i * 3, (i + 1) * 3),
      );
      mat4.mul(this.boneTransforms[i], this.bonePivots[i], this.boneTransforms[i]);
      mat4.mul(this.boneTransforms[i], this.boneTransforms[i], this.boneAntipivots[i]);
      if (parentId >= 0) {
        mat4.mul(this.boneTransforms[i], this.boneTransforms[parentId], this.boneTransforms[i]);
      }
    }
  }

  public getVertexColor(index: number): vec4 {
    if (index * 4 < this.vertexColors.length) {
      return this.vertexColors.slice(index * 4, (index + 1) * 4);
    }
    return [1, 1, 1, 1];
  }

  public destroy() {
    this.animationManager.free();
    this.boneFlags.forEach(flags => flags.free());
  }
}

export class BlpData {
  constructor(public fileId: number, public inner: WowBlp) {
  }
}

export class WmoBatchData {
  public indexStart: number;
  public indexCount: number;
  public materialId: number;
  public material: WowWmoMaterial;
  public materialFlags: WowWmoMaterialFlags;
  public vertexShader: WowWmoMaterialVertexShader;
  public pixelShader: WowWmoMaterialPixelShader;
  public textures: (BlpData | null)[] = [];
  public megaStateFlags: Partial<GfxMegaStateDescriptor>;
  public visible = true;

  constructor(batch: WowWmoMaterialBatch, wmo: WmoData) {
    this.indexStart = batch.start_index;
    this.indexCount = batch.index_count;
    if (batch.use_material_id_large > 0) {
      this.materialId = batch.material_id_large;
    } else {
      this.materialId = batch.material_id;
    }
    this.material = wmo.materials[this.materialId];
    for (let blpId of [this.material.texture_1, this.material.texture_2, this.material.texture_3]) {
      if (blpId === 0) {
        this.textures.push(null);
      } else {
        this.textures.push(wmo.blps.get(blpId)!);
      }
    }
    this.materialFlags = rust.WowWmoMaterialFlags.new(this.material.flags);
    this.vertexShader = this.material.get_vertex_shader();
    this.pixelShader = this.material.get_pixel_shader();
    this.megaStateFlags = {
      cullMode: this.materialFlags.unculled ? GfxCullMode.None : GfxCullMode.Back,
      depthWrite: this.material.blend_mode <= 1,
    };
  }

  public setMegaStateFlags(renderInst: GfxRenderInst) {
    // TODO setSortKeyDepth based on distance to transparent object
    switch (this.material.blend_mode) {
      case rust.WowM2BlendingMode.Alpha: {
        setAttachmentStateSimple(this.megaStateFlags, {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.SrcAlpha,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT)
        break;
      }
      case rust.WowM2BlendingMode.NoAlphaAdd: {
        setAttachmentStateSimple(this.megaStateFlags, {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.One,
          blendDstFactor: GfxBlendFactor.One,
        });
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT)
        break;
      }
      case rust.WowM2BlendingMode.Add: {
        setAttachmentStateSimple(this.megaStateFlags, {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.SrcAlpha,
          blendDstFactor: GfxBlendFactor.One,
        });
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT)
        break;
      }
      case rust.WowM2BlendingMode.Mod: {
        setAttachmentStateSimple(this.megaStateFlags, {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.Dst,
          blendDstFactor: GfxBlendFactor.Zero,
        });
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT)
        break;
      }
      case rust.WowM2BlendingMode.Mod2x: {
        setAttachmentStateSimple(this.megaStateFlags, {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.Dst,
          blendDstFactor: GfxBlendFactor.Src,
        });
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT)
        break;
      }
      case rust.WowM2BlendingMode.BlendAdd: {
        setAttachmentStateSimple(this.megaStateFlags, {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.One,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT)
        break;
      }
      case rust.WowM2BlendingMode.Opaque:
      case rust.WowM2BlendingMode.AlphaKey:
        break;
    }
    renderInst.setMegaStateFlags(this.megaStateFlags);
  }
}

export class BspTree {
  constructor(public nodes: WowWmoBspNode[]) {
  }

  public query(pos: vec3, nodes: WowWmoBspNode[], i = 0) {
    if (i < 0) {
      return undefined;
    }
    assert(i < this.nodes.length);
    if (this.nodes[i].is_leaf()) {
      nodes.push(this.nodes[i]);
      return;
    }
    const nodeDistance = this.nodes[i].plane_distance;
    const nodeType = this.nodes[i].get_axis_type();
    if (nodeType === rust.WowWmoBspAxisType.Z) {
      this.query(pos, nodes, this.nodes[i].negative_child);
      this.query(pos, nodes, this.nodes[i].positive_child);
    } else {
      let posComponent = nodeType === rust.WowWmoBspAxisType.X ? pos[0] : pos[1];
      if (posComponent - nodeDistance < 0) {
        this.query(pos, nodes, this.nodes[i].negative_child);
      } else {
        this.query(pos, nodes, this.nodes[i].positive_child);
      }
    }
  }
}

export class WmoGroupData {
  public innerBatches: WowWmoMaterialBatch[] = [];
  public flags: WowWmoGroupFlags;
  public name: string | undefined;
  public nameIndex: number;
  public description: string | undefined;
  public descriptionIndex: number;
  public portalStart: number;
  public portalCount: number;
  public doodadRefs: Uint16Array;
  public replacementForHeaderColor: WowArgb | undefined;
  public numUVBufs: number;
  public numVertices: number;
  public numColorBufs: number;
  public visible = true;
  public groupLiquidType: number;
  public liquids: LiquidInstance[] | undefined;
  public liquidMaterials: number[] | undefined;
  public numLiquids = 0;
  public liquidIndex = 0;
  public vertices: Float32Array;
  public normals: Uint8Array;
  public indices: Uint16Array;
  public uvs: Uint8Array;
  public colors: Uint8Array;
  public portalRefs: WowWmoPortalRef[];
  public bsp: BspTree;
  public bspIndices: Uint16Array;

  public scratchAABB = new AABB();
  private scratchVec3a = vec3.create();
  private scratchVec3b = vec3.create();
  private scratchVec3c = vec3.create();

  constructor(public fileId: number) {
  }

  public getBatches(wmo: WmoData): WmoBatchData[] {
    const batches: WmoBatchData[] = [];
    for (let batch of this.innerBatches) {
      batches.push(new WmoBatchData(batch, wmo))
    }
    return batches;
  }

  public getAmbientColor(wmoData: WmoData, doodadSetId: number): vec4 {
    if (!this.flags.exterior && !this.flags.exterior_lit) {
      if (this.replacementForHeaderColor) {
        return [
          this.replacementForHeaderColor.r / 255.0,
          this.replacementForHeaderColor.g / 255.0,
          this.replacementForHeaderColor.b / 255.0,
          1.0,
        ];
      } else {
        const color = wmoData.wmo.get_ambient_color(doodadSetId);
        return [
          color.r / 255.0,
          color.g / 255.0,
          color.b / 255.0,
          1.0,
        ];
      }
    }
    return [0, 0, 0, 0];
  }

  public getVertexBuffers(device: GfxDevice): GfxVertexBufferDescriptor[] {
    return [
      { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.vertices.buffer) },
      { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.normals.buffer) },
      { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.uvs.buffer) },
      { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.colors.buffer) },
    ];
  }

  public getInputLayout(renderCache: GfxRenderCache): GfxInputLayout {
    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
      { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex, },
      { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex, },
      { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex, },
      { byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex, },
    ];
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
      { location: WmoProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
      { location: WmoProgram.a_Normal,   bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
    ];
    for (let i=0; i<this.numUVBufs; i++) {
      vertexAttributeDescriptors.push({
        location: WmoProgram.a_TexCoord0 + i,
        bufferIndex: 2,
        bufferByteOffset: 8 * i * this.numVertices,
        format: GfxFormat.F32_RG,
      });
    }
    for (let i=0; i<this.numColorBufs; i++) {
      vertexAttributeDescriptors.push({
        location: WmoProgram.a_Color0 + i,
        bufferIndex: 3,
        bufferByteOffset: 4 * i * this.numVertices,
        format: GfxFormat.U8_RGBA,
      });
    }
    const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
    return renderCache.createInputLayout({
      vertexAttributeDescriptors,
      vertexBufferDescriptors,
      indexBufferFormat,
    });
  }

  public getIndexBuffer(device: GfxDevice): GfxIndexBufferDescriptor {
    return { byteOffset: 0, buffer: makeStaticDataBuffer(device, GfxBufferUsage.Index, this.indices.buffer) }
  }

  public async load(dataFetcher: DataFetcher, cache: WowCache): Promise<undefined> {
    const group = await fetchFileByID(this.fileId, dataFetcher, rust.WowWmoGroup.new);
    this.groupLiquidType = group.header.group_liquid;
    this.replacementForHeaderColor = group.replacement_for_header_color;
    this.nameIndex = group.header.group_name;
    this.descriptionIndex = group.header.descriptive_group_name;
    this.numVertices = group.num_vertices;
    this.numUVBufs = group.num_uv_bufs;
    this.numColorBufs = group.num_color_bufs;
    this.innerBatches = group.batches;
    this.vertices = group.take_vertices();
    this.normals = group.take_normals();
    this.colors = group.take_colors();
    this.portalStart = group.header.portal_start;
    this.portalCount = group.header.portal_count;
    this.uvs = group.take_uvs();
    this.bsp = new BspTree(group.take_bsp_nodes())
    this.bspIndices = group.take_bsp_indices();
    this.indices = group.take_indices();
    this.flags = rust.WowWmoGroupFlags.new(group.header.flags);
    if (this.flags.antiportal) {
      console.log(this);
    }
    this.doodadRefs = group.take_doodad_refs();
    const liquids = group.take_liquid_data();
    if (liquids) {
      this.liquids = [];
      this.liquidMaterials = [];
      this.numLiquids = liquids.length;
      for (let liquid of liquids) {
        this.liquidMaterials.push(liquid.material_id);
        this.liquids.push(LiquidInstance.fromWmoLiquid(liquid));
      }
    }
    group.free();
  }

  public drawBspNodes(pos: vec3, m: ReadonlyMat4, clipFromWorldMatrix: ReadonlyMat4) {
    let nodes: WowWmoBspNode[] = [];
    this.bsp.query(pos, nodes);
    if (nodes.length === 0) {
      return;
    }
    for (let node of nodes) {
      for (let i = node.faces_start; i < node.faces_start + node.num_faces; i++) {
        const index0 = this.indices[3 * this.bspIndices[i] + 0];
        const vertex0 = vec3.set(this.scratchVec3a,
          this.vertices[3 * index0 + 0],
          this.vertices[3 * index0 + 1],
          this.vertices[3 * index0 + 2],
        );
        const index1 = this.indices[3 * this.bspIndices[i] + 1];
        const vertex1 = vec3.set(this.scratchVec3b,
          this.vertices[3 * index1 + 0],
          this.vertices[3 * index1 + 1],
          this.vertices[3 * index1 + 2],
        );
        const index2 = this.indices[3 * this.bspIndices[i] + 2];
        const vertex2 = vec3.set(this.scratchVec3c,
          this.vertices[3 * index2 + 0],
          this.vertices[3 * index2 + 1],
          this.vertices[3 * index2 + 2],
        );
        vec3.transformMat4(vertex0, vertex0, m);
        vec3.transformMat4(vertex1, vertex1, m);
        vec3.transformMat4(vertex2, vertex2, m);
        drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, vertex0, vertex1);
        drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, vertex1, vertex2);
        drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, vertex2, vertex0);
      }
    }
  }

  public bspContainsModelSpacePoint(pos: vec3): boolean {
    let nodes: WowWmoBspNode[] = [];
    this.bsp.query(pos, nodes);
    if (nodes.length === 0) {
      return false;
    }
    this.scratchAABB.reset();
    for (let node of nodes) {
      for (let i = node.faces_start; i < node.faces_start + node.num_faces; i++) {
        const index0 = this.indices[3 * this.bspIndices[i] + 0];
        const vertex0 = vec3.set(this.scratchVec3a,
          this.vertices[3 * index0 + 0],
          this.vertices[3 * index0 + 1],
          this.vertices[3 * index0 + 2],
        );
        this.scratchAABB.unionPoint(vertex0);
        const index1 = this.indices[3 * this.bspIndices[i] + 1];
        const vertex1 = vec3.set(this.scratchVec3b,
          this.vertices[3 * index1 + 0],
          this.vertices[3 * index1 + 1],
          this.vertices[3 * index1 + 2],
        );
        this.scratchAABB.unionPoint(vertex1);
        const index2 = this.indices[3 * this.bspIndices[i] + 2];
        const vertex2 = vec3.set(this.scratchVec3c,
          this.vertices[3 * index2 + 0],
          this.vertices[3 * index2 + 1],
          this.vertices[3 * index2 + 2],
        );
        this.scratchAABB.unionPoint(vertex2);
      }
    }
    // add a bit of headroom to flat AABBs (which are likely just floor)
    if (this.scratchAABB.maxZ - this.scratchAABB.minZ < 10) {
      this.scratchAABB.maxZ += 15;
    }
    return this.scratchAABB.containsPoint(pos);
  }
}

export class WmoData {
  public wmo: WowWmo;
  public flags: WowWmoHeaderFlags;
  public groups: WmoGroupData[] = [];
  public groupInfos: WowWmoGroupInfo[] = [];
  public groupIdToIndex: Map<number, number> = new Map();
  public groupDefAABBs: Map<number, AABB> = new Map();
  public portals: PortalData[] = [];
  public portalRefs: WowWmoPortalRef[] = [];
  public portalVertices: Float32Array;
  public blps: Map<number, BlpData> = new Map();
  public groupBsps: Map<number, BspTree> = new Map();
  public materials: WowWmoMaterial[] = [];
  public models: Map<number, ModelData> = new Map();
  public modelIds: Uint32Array;
  public liquidTypes: Map<number, LiquidType> = new Map();
  public liquids: LiquidInstance[] = [];

  constructor(public fileId: number) {
  }

  private loadTextures(cache: WowCache): Promise<unknown> {
    const textureSet = new Set<number>();
    for (const material of this.materials) {
      if (material.texture_1 !== 0)
        textureSet.add(material.texture_1);
      if (material.texture_2 !== 0)
        textureSet.add(material.texture_2);
      if (material.texture_3 !== 0)
        textureSet.add(material.texture_3);
    }

    return Promise.all(Array.from(textureSet).map(async (fileId) => {
      try {
        this.blps.set(fileId, new BlpData(fileId, await cache.loadBlp(fileId)));
      } catch (e) {
        console.error(`failed to fetch BLP: ${e}`);
      }
    }));
  }

  private loadModels(cache: WowCache): Promise<unknown> {
    return Promise.all(Array.from(this.modelIds).map(async (fileId) => {
      if (fileId === 0)
        return;
      this.models.set(fileId, await cache.loadModel(fileId));
    }));
  }

  private loadGroups(cache: WowCache): Promise<unknown> {
    this.groupInfos = this.wmo.group_infos;
    return Promise.all(Array.from(this.wmo.group_file_ids).map(async (fileId, i) => {
      const group = await cache.loadWmoGroup(fileId);
      group.portalRefs = this.portalRefs.slice(group.portalStart, group.portalStart + group.portalCount);

      if (group.liquids) {
        group.liquidIndex = this.liquids.length;
        this.liquids.push(...group.liquids);
        group.liquids = undefined;

        for (let liquid of this.liquids) {
          liquid.liquidType = calculateWmoLiquidType(this.flags, group, liquid.liquidType);
          this.liquidTypes.set(liquid.liquidType, await cache.loadLiquidType(liquid.liquidType));
        }
      }

      group.name = this.wmo.get_group_text(group.nameIndex);
      group.description = this.wmo.get_group_text(group.descriptionIndex);
      this.groupBsps.set(group.fileId, group.bsp);
      this.groupIdToIndex.set(group.fileId, i);
      this.groups[i] = group;

      const groupInfo = this.groupInfos[i];
      this.groupDefAABBs.set(group.fileId, convertWowAABB(groupInfo.bounding_box));
    }));
  }

  public async load(dataFetcher: DataFetcher, cache: WowCache): Promise<void> {
    this.wmo = await fetchFileByID(this.fileId, dataFetcher, rust.WowWmo.new);
    this.flags = this.wmo.header.get_flags();
    assert(!this.flags.lod, "wmo with lod");

    this.materials = this.wmo.textures;
    this.modelIds = this.wmo.doodad_file_ids;

    this.portalVertices = this.wmo.take_portal_vertices();
    this.portalRefs = this.wmo.take_portal_refs();
    const portals = this.wmo.take_portals();
    for (let portal of portals) {
      this.portals.push(PortalData.fromWowPortal(portal, this.portalVertices));
    }

    await Promise.all([
      this.loadTextures(cache),
      this.loadModels(cache),
      this.loadGroups(cache),
    ]);
  }

  public getGroup(groupId: number): WmoGroupData | undefined {
    const index = this.groupIdToIndex.get(groupId);
    if (index !== undefined){
      return this.groups[index];
    }
    return undefined;
  }

  public cullGroups(worldCamera: vec3, worldFrustum: Frustum) {

  }

  public portalCull(modelCamera: vec3, modelFrustum: Frustum, currentGroupId: number, visibleGroups: number[]) {
    if (visibleGroups.includes(currentGroupId)) return;
    visibleGroups.push(currentGroupId);
    const group = this.getGroup(currentGroupId)!;
    for (let portalRef of group.portalRefs) {
      const portal = this.portals[portalRef.portal_index];
      const otherGroup = this.groups[portalRef.group_index];
      if (visibleGroups.includes(otherGroup.fileId)) {
        continue;
      }
      if (!portal.inFrustum(modelFrustum)) {
        continue;
      }
      // check if the business end of the portal's facing us
      if (!portal.isPortalFacingUs(modelCamera, portalRef.side)) {
        continue;
      }
      let portalFrustum = portal.clipFrustum(modelCamera, modelFrustum, portalRef.side);
      this.portalCull(
        modelCamera,
        portalFrustum,
        otherGroup.fileId,
        visibleGroups,
      );
    }
  }
}

function calculateWmoLiquidType(wmoFlags: WowWmoHeaderFlags, group: WmoGroupData, type: number): number {
  const FIRST_NONBASIC_LIQUID_TYPE = 21;
  const GREEN_LAVA = 15;
  const MASKED_OCEAN = 1;
  const MASKED_MAGMA = 2;
  const MASKED_SLIME = 3;
  const LIQUID_WMO_MAGMA = 19;
  const LIQUID_WMO_OCEAN = 14;
  const LIQUID_WMO_WATER = 13;
  const LIQUID_WMO_SLIME = 20;
  let liquidToConvert;
  if (wmoFlags.use_liquid_type_dbc_id) {
    return group.groupLiquidType;
  } else {
    if (group.groupLiquidType === GREEN_LAVA) {
      liquidToConvert = type;
    } else if (group.groupLiquidType < FIRST_NONBASIC_LIQUID_TYPE) {
      liquidToConvert = group.groupLiquidType;
    } else {
      return group.groupLiquidType + 1;
    }
  }
  const maskedLiquid = liquidToConvert & 0x3;
  if (maskedLiquid === MASKED_OCEAN) {
    return LIQUID_WMO_OCEAN;
  } else if (maskedLiquid === MASKED_MAGMA) {
    return LIQUID_WMO_MAGMA;
  } else if (maskedLiquid === MASKED_SLIME) {
    return LIQUID_WMO_SLIME;
  } else if (group.flags.water_is_ocean) {
    return LIQUID_WMO_OCEAN;
  } else {
    return LIQUID_WMO_WATER;
  }
}

export class SkinData {
  public submeshes: WowSkinSubmesh[];
  public batches: WowModelBatch[];
  public indexBuffer: Uint16Array;
  public renderPasses: ModelRenderPass[];

  constructor(public skin: WowSkin, model: ModelData) {
    this.submeshes = skin.submeshes;
    this.batches = skin.batches;
    this.renderPasses = this.batches.map(batch => new ModelRenderPass(batch, this.skin, model));
    this.indexBuffer = skin.take_indices();
  }
}

export class ModelRenderPass {
  public vertexShaderId: number;
  public fragmentShaderId: number;
  public blendMode: WowM2BlendingMode;
  public materialFlags: WowM2MaterialFlags;
  public submesh: WowSkinSubmesh;
  public layer: number;
  public tex0: BlpData;
  public tex1: BlpData | null;
  public tex2: BlpData | null;
  public tex3: BlpData | null;
  private scratchMat4 = mat4.identity(mat4.create());

  constructor(public batch: WowModelBatch, public skin: WowSkin, public model: ModelData) {
    this.fragmentShaderId = batch.get_pixel_shader();
    this.vertexShaderId = batch.get_vertex_shader();
    this.submesh = skin.submeshes[batch.skin_submesh_index];
    [this.blendMode, this.materialFlags] = model.materials[this.batch.material_index];
    this.layer = this.batch.material_layer;
    this.tex0 = this.getBlp(0)!;
    this.tex1 = this.getBlp(1);
    this.tex2 = this.getBlp(2);
    this.tex3 = this.getBlp(3);
  }

  public setMegaStateFlags(renderInst: GfxRenderInst, renderKey: number | undefined = undefined) {
    const defaultBlendState = {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.One,
        blendDstFactor: GfxBlendFactor.Zero,
    };
    let settings: Partial<GfxMegaStateDescriptor> = {
      cullMode: this.materialFlags.two_sided ? GfxCullMode.None : GfxCullMode.Back,
      depthWrite: this.materialFlags.depth_write,
      depthCompare: this.materialFlags.depth_tested ? reverseDepthForCompareMode(GfxCompareMode.LessEqual) : GfxCompareMode.Always,
      attachmentsState: [{
        channelWriteMask: GfxChannelWriteMask.RGB,
        rgbBlendState: defaultBlendState,
        alphaBlendState: defaultBlendState,
      }],
    };

    let sortKeyLayer = makeSortKey(GfxRendererLayer.TRANSLUCENT + this.layer);
    // if (renderKey !== undefined) {
    //   sortKeyLayer = makeSortKey(renderKey);
    // }

    // TODO setSortKeyDepth based on distance to transparent object
    switch (this.blendMode) {
      case rust.WowM2BlendingMode.Alpha: {
        settings.attachmentsState![0].rgbBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.SrcAlpha,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        };
        settings.attachmentsState![0].alphaBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.One,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        };
        settings.attachmentsState![0].channelWriteMask = GfxChannelWriteMask.AllChannels;
        renderInst.sortKey = sortKeyLayer
        break;
      }
      case rust.WowM2BlendingMode.NoAlphaAdd: {
        settings.attachmentsState![0].rgbBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.One,
          blendDstFactor: GfxBlendFactor.One,
        };
        settings.attachmentsState![0].alphaBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.Zero,
          blendDstFactor: GfxBlendFactor.One,
        };
        renderInst.sortKey = sortKeyLayer
        break;
      }
      case rust.WowM2BlendingMode.Add: {
        settings.attachmentsState![0].rgbBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.SrcAlpha,
          blendDstFactor: GfxBlendFactor.One,
        };
        settings.attachmentsState![0].alphaBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.Zero,
          blendDstFactor: GfxBlendFactor.One,
        };
        settings.attachmentsState![0].channelWriteMask = GfxChannelWriteMask.AllChannels;
        renderInst.sortKey = sortKeyLayer
        break;
      }
      case rust.WowM2BlendingMode.Mod: {
        settings.attachmentsState![0].rgbBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.Dst,
          blendDstFactor: GfxBlendFactor.Zero,
        };
        settings.attachmentsState![0].alphaBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.DstAlpha,
          blendDstFactor: GfxBlendFactor.Zero,
        };
        renderInst.sortKey = sortKeyLayer
        break;
      }
      case rust.WowM2BlendingMode.Mod2x: {
        settings.attachmentsState![0].rgbBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.Dst,
          blendDstFactor: GfxBlendFactor.Src,
        };
        settings.attachmentsState![0].alphaBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.DstAlpha,
          blendDstFactor: GfxBlendFactor.SrcAlpha,
        };
        renderInst.sortKey = sortKeyLayer
        break;
      }
      case rust.WowM2BlendingMode.BlendAdd: {
        settings.attachmentsState![0].rgbBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.One,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        };
        settings.attachmentsState![0].alphaBlendState = {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.One,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        };
        renderInst.sortKey = sortKeyLayer
        break;
      }
      case rust.WowM2BlendingMode.Opaque:
      case rust.WowM2BlendingMode.AlphaKey:
        break;
    }
    renderInst.setMegaStateFlags(settings);
  }

  private getBlp(n: number): BlpData | null {
    if (n < this.batch.texture_count) {
      const i = this.model.textureLookupTable[this.batch.texture_combo_index + n]!;
      if (this.model.blps[i]) {
        return this.model.blps[i];
      }
    }
    return null;
  }

  private getCurrentVertexColor(): vec4 {
    return this.model.getVertexColor(this.batch.color_index);
  }

  private getTextureTransform(texIndex: number): mat4 {
    const lookupIndex = this.batch.texture_transform_combo_index + texIndex;
    const transformIndex = this.model.textureTransformLookupTable[lookupIndex];
    if (transformIndex !== undefined) {
      if (transformIndex < this.model.textureTransforms.length) {
        return this.model.textureTransforms[transformIndex];
      }
    }
    return this.scratchMat4;
  }

  private getTextureWeight(texIndex: number): number {
    const lookupIndex = this.batch.texture_weight_combo_index + texIndex;
    const transparencyIndex = this.model.textureTransparencyLookupTable[lookupIndex];
    if (transparencyIndex !== undefined) {
      if (transparencyIndex < this.model.textureWeights.length) {
        return this.model.textureWeights[transparencyIndex];
      }
    }
    return 1.0;
  }

  private getAlphaTest(): number {
    if (this.blendMode == rust.WowM2BlendingMode.AlphaKey) {
      const color = this.getCurrentVertexColor();
      let finalTransparency = color[3];
      if (!(this.batch.flags & 0x40))
        finalTransparency *= this.getTextureWeight(0);
      // TODO skyboxes need another alpha value mixed in
      return (128/255) * finalTransparency;
    } else {
      return 1/255;
    }
  }

  public setModelParams(renderInst: GfxRenderInst) {
    const numVec4s = 4;
    const numMat4s = 3;
    let offset = renderInst.allocateUniformBuffer(ModelProgram.ub_MaterialParams, numVec4s * 4 + numMat4s * 16);
    const uniformBuf = renderInst.mapUniformBufferF32(ModelProgram.ub_MaterialParams);
    offset += fillVec4(uniformBuf, offset,
      this.fragmentShaderId,
      this.vertexShaderId,
      0,
      0
    );
    offset += fillVec4(uniformBuf, offset,
      this.blendMode,
      this.materialFlags.unfogged ? 1 : 0,
      this.materialFlags.unlit ? 1 : 0,
      this.getAlphaTest()
    );
    offset += fillVec4v(uniformBuf, offset, this.getCurrentVertexColor());
    offset += fillMatrix4x4(uniformBuf, offset, this.getTextureTransform(0));
    offset += fillMatrix4x4(uniformBuf, offset, this.getTextureTransform(1));
    const textureWeight: vec4 = [
      this.getTextureWeight(0),
      this.getTextureWeight(1),
      this.getTextureWeight(2),
      this.getTextureWeight(3),
    ];
    offset += fillVec4v(uniformBuf, offset, textureWeight);
  }
}

export class PortalData {
  public points: vec3[] = [];
  public plane = new Plane();
  public aabbPoints: vec3[] = [vec3.create(), vec3.create(), vec3.create(), vec3.create()];
  public aabb = new AABB();
  public vertexCount = 0;
  public vertexStart = 0;
  private scratchVec4 = vec4.create();
  private scratchVec3A = vec3.create();
  private scratchVec3B = vec3.create();
  private scratchVec3C = vec3.create();
  private scratchMat4 = mat4.create();

  constructor() {
  }

  static fromWowPortal(wowPortal: WowWmoPortal, vertices: Float32Array): PortalData {
    if (wowPortal.count < 3) {
      throw new Error(`found a portal w/ ${wowPortal.count} vertices!`);
    }
    const result = new PortalData();
    result.vertexStart = wowPortal.start_vertex;
    result.vertexCount = wowPortal.count;
    const start = result.vertexStart * 3;
    const end = start + result.vertexCount * 3;
    const verts = vertices.slice(start, end);
    result.points = [];
    for (let i=0; i < wowPortal.count; i++) {
      result.points.push([
        verts[i*3 + 0],
        verts[i*3 + 1],
        verts[i*3 + 2]
      ]);
    }
    result.aabb.setFromPoints(result.points);
    const wowPlane = wowPortal.plane;
    const wowPlaneNorm = wowPlane.normal;
    result.plane.n[0] = wowPlaneNorm.x;
    result.plane.n[1] = wowPlaneNorm.y;
    result.plane.n[2] = wowPlaneNorm.z;
    vec3.normalize(result.plane.n, result.plane.n);
    result.plane.d = wowPlane.distance;
    result.updateAABBPoints();
    wowPlaneNorm.free();
    wowPlane.free();
    wowPortal.free();
    return result;
  }

  // Assuming planar portal points, rotate them to XY plane, calculate the
  // bounding box, then rotate the box back to the plane
  private updateAABBPoints() {
    if (this.points.length === 4) {
      this.aabbPoints = this.points;
      return;
    }
    const xyPlane = vec3.set(this.scratchVec3A, 0, 0, 1);
    const theta = Math.acos(vec3.dot(xyPlane, this.plane.n));
    let rotationMat: mat4;
    if (theta === 0 || theta === 180) {
      rotationMat = mat4.identity(this.scratchMat4);
    } else {
      const rotationAxis = vec3.cross(this.scratchVec3B, xyPlane, this.plane.n);
      vec3.normalize(rotationAxis, rotationAxis);
      rotationMat = mat4.fromRotation(this.scratchMat4, theta, rotationAxis);
    }
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (let p of this.points) {
      vec3.transformMat4(p, p, rotationMat);
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    mat4.invert(rotationMat, rotationMat);
    for (let p of this.points) {
      vec3.transformMat4(p, p, rotationMat);
    }
  }

  public clone(): PortalData {
    const clone = new PortalData();
    for (let point of this.points) {
      clone.points.push(vec3.clone(point));
    }
    clone.plane.copy(this.plane);
    clone.vertexCount = this.vertexCount;
    clone.vertexStart = this.vertexStart;
    clone.aabb.copy(this.aabb);
    return clone;
  }

  public transform(m: ReadonlyMat4) {
    for (let point of this.points) {
      vec3.transformMat4(point, point, m);
    }
    this.aabb.transform(this.aabb, m);
    this.plane.transform(m);
  }

  public inFrustum(frustum: Frustum): boolean {
    return frustum.contains(this.aabb);
  }

  public getPointsInFrustum(frustum: Frustum): vec3[] {
    return this.points.filter(point => frustum.containsPoint(point));
  }

  public isPortalFacingUs(cameraPos: vec3, side: number) {
    const dist = this.plane.distanceVec3(cameraPos);
    if (side < 0 && dist > -0.01) {
      return false;
    } else if (side > 0 && dist < 0.01) {
      return false;
    }
    return true;
  }

  public clipFrustum(cameraPoint: vec3, currentFrustum: Frustum, side: number): Frustum {
    const result = new Frustum();
    const [p1, p2, p3, p4] = this.points;
    const planePoints = [
      [p4, p1, p2], // Left
      [p2, p3, p4], // Right
      [p1, p2, p3], // Top
      [p3, p4, p1], // Bottom
    ];
    let planeIndex = 0;
    for (let [a, b, testPoint] of planePoints) {
      result.planes[planeIndex].setTri(cameraPoint, a, b);
      let dist = result.planes[planeIndex].distanceVec3(testPoint);
      if (dist > 0) {
        result.planes[planeIndex].negate();
      }
      dist = result.planes[planeIndex].distanceVec3(testPoint);
      assert(dist <= 0);
      planeIndex += 1;
    }

    result.planes[4].copy(this.plane); // Near
    if (side < 0) {
      result.planes[4].negate(); // Far
    }
    result.planes[5].copy(currentFrustum.planes[5]); // Far

    return result;
  }
}

export class WmoDefinition {
  public modelMatrix: mat4 = mat4.create();
  public placementMatrix: mat4 = mat4.create();
  public invPlacementMatrix: mat4 = mat4.create();
  public invModelMatrix: mat4 = mat4.create();
  public normalMatrix: mat4 = mat4.create();

  public aabb: AABB = new AABB();
  public worldAABB: AABB = new AABB();

  public visible = true;
  public doodads: (DoodadData | undefined)[] = [];
  public groupIdToVisibility: Map<number, boolean> = new Map();
  public groupIdToDoodadIndices: MapArray<number, number> = new MapArray();
  public groupAmbientColors: Map<number, vec4> = new Map();
  public groupIdToLiquidIndices: MapArray<number, number> = new MapArray();
  public liquidAABBs: AABB[] = [];
  public liquidVisibility: boolean[] = [];

  public setVisible(visible: boolean) {
    this.visible = visible;
    for (let groupId of this.groupIdToVisibility.keys()) {
      this.setGroupVisible(groupId, visible);
    }
  }

  static fromAdtDefinition(def: WowAdtWmoDefinition, wmo: WmoData) {
    const scale = def.scale / 1024;
    const position = convertWowVec3(def.position);
    const rotation = convertWowVec3(def.rotation);
    const aabb = convertWowAABB(def.extents);
    const fileId = def.name_id;
    const uniqueId = def.unique_id;
    const doodadSet = def.doodad_set;
    def.free();
    return new WmoDefinition(fileId, wmo, uniqueId, doodadSet, scale, position, rotation, aabb);
  }

  static fromGlobalDefinition(def: WowGlobalWmoDefinition, wmo: WmoData) {
    const scale = 1.0;
    const position = convertWowVec3(def.position);
    const rotation = convertWowVec3(def.rotation);
    const aabb = convertWowAABB(def.extents);
    const fileId = def.name_id;
    const uniqueId = def.unique_id;
    const doodadSet = def.doodad_set;
    def.free();
    return new WmoDefinition(fileId, wmo, uniqueId, doodadSet, scale, position, rotation, aabb);
  }

  // `extents` should be in placement space
  constructor(public wmoId: number, wmo: WmoData, public uniqueId: number, public doodadSet: number, scale: number, position: vec3, rotation: vec3, extents: AABB) {
    setMatrixTranslation(this.placementMatrix, position);
    mat4.scale(this.placementMatrix, this.placementMatrix, [scale, scale, scale]);
    mat4.rotateZ(this.placementMatrix, this.placementMatrix, MathConstants.DEG_TO_RAD * rotation[2]);
    mat4.rotateY(this.placementMatrix, this.placementMatrix, MathConstants.DEG_TO_RAD * rotation[1]);
    mat4.rotateX(this.placementMatrix, this.placementMatrix, MathConstants.DEG_TO_RAD * rotation[0]);
    mat4.mul(this.modelMatrix, this.placementMatrix, placementSpaceFromModelSpace);
    mat4.mul(this.modelMatrix, adtSpaceFromPlacementSpace, this.modelMatrix);

    mat4.invert(this.invModelMatrix, this.modelMatrix);
    mat4.invert(this.invPlacementMatrix, this.placementMatrix);
    mat4.mul(this.invPlacementMatrix, this.invPlacementMatrix, placementSpaceFromAdtSpace);
    mat4.mul(this.invPlacementMatrix, modelSpaceFromPlacementSpace, this.invPlacementMatrix);

    mat4.mul(this.normalMatrix, this.modelMatrix, placementSpaceFromModelSpace);
    mat4.invert(this.normalMatrix, this.normalMatrix);
    mat4.transpose(this.normalMatrix, this.normalMatrix);

    for (let i=0; i<wmo.groups.length; i++) {
      const group = wmo.groups[i];
      this.groupIdToVisibility.set(group.fileId, true);

      for (let i=group.liquidIndex; i<group.liquidIndex + group.numLiquids; i++) {
        this.groupIdToLiquidIndices.append(group.fileId, i);
      }
      this.groupAmbientColors.set(group.fileId, group.getAmbientColor(wmo, doodadSet));
    }

    for (let liquid of wmo.liquids) {
      const aabb = new AABB();
      aabb.transform(liquid.worldSpaceAABB, this.modelMatrix);
      this.liquidAABBs.push(aabb);
      this.liquidVisibility.push(true);
    }

    const doodads = wmo.wmo.get_doodad_set(this.doodadSet);
    if (doodads) {
      for (let wmoDoodad of doodads) {
        if (wmoDoodad.name_index === -1) {
          console.warn('skipping WMO doodad w/ name_index === -1');
          this.doodads.push(undefined);
          continue;
        }
        const doodad = DoodadData.fromWmoDoodad(wmoDoodad, wmo.modelIds, this.modelMatrix);
        const modelData = wmo.models.get(doodad.modelId)!;
        doodad.setBoundingBoxFromModel(modelData);
        this.doodads.push(doodad);
      }
    }

    // keep track of which doodads belong in which group for culling purposes
    const doodadRefs = wmo.wmo.get_doodad_set_refs(this.doodadSet);
    for (let group of wmo.groups) {
      for (let ref of group.doodadRefs) {
        const index = doodadRefs.indexOf(ref);
        if (index !== -1) {
          this.groupIdToDoodadIndices.append(group.fileId, index);
        }
      }

      for (let index of this.groupIdToDoodadIndices.get(group.fileId)) {
        const doodad = this.doodads[index];
        if (doodad === undefined) {
          continue;
        }
        doodad.ambientColor = this.groupAmbientColors.get(group.fileId)!;
        // FIXME this is wrong
        doodad.applyInteriorLighting = group.flags.interior && !group.flags.exterior_lit;
        doodad.applyExteriorLighting = true;
      }
    }

    this.aabb.transform(extents, this.invPlacementMatrix);
    this.aabb.transform(extents, modelSpaceFromPlacementSpace);
    this.worldAABB.transform(extents, adtSpaceFromPlacementSpace);
    this.visible = true;
  }

  public isWmoGroupVisible(groupFileId: number): boolean {
    return this.groupIdToVisibility.get(groupFileId)!;
  }

  public setGroupVisible(groupId: number, visible: boolean) {
    this.groupIdToVisibility.set(groupId, visible);
    if (this.groupIdToDoodadIndices.has(groupId)) {
      for (let index of this.groupIdToDoodadIndices.get(groupId)) {
        const doodad = this.doodads[index];
        if (doodad !== undefined)
          doodad.setVisible(visible);
      }
    }
    if (this.groupIdToLiquidIndices.has(groupId)) {
      for (let index of this.groupIdToLiquidIndices.get(groupId)) {
        this.liquidVisibility[index] = visible;
      }
    }
  }
}

export class AdtLodData {
  public modelIds: number[] = [];
  public models = new Map<number, ModelData>();
  public wmoDefs: WmoDefinition[] = [];
  public wmos = new Map<number, WmoData>();
  public doodads: DoodadData[] = [];

  private loadDoodads(cache: WowCache, data: WowAdt, lodLevel: number): Promise<unknown> {
    return Promise.all(data.get_doodads(lodLevel).map(async (adtDoodad) => {
      const doodad = DoodadData.fromAdtDoodad(adtDoodad);
      const modelData = await cache.loadModel(doodad.modelId);
      doodad.setBoundingBoxFromModel(modelData);
      doodad.applyExteriorLighting = true;
      this.doodads.push(doodad);
    }));
  }

  private loadModels(cache: WowCache, data: WowAdt, lodLevel: number): Promise<unknown> {
    return Promise.all(Array.from(data.get_model_file_ids(lodLevel)).map(async (modelId) => {
      this.models.set(modelId, await cache.loadModel(modelId));
      this.modelIds.push(modelId);
    }));
  }

  private loadWMOs(cache: WowCache, data: WowAdt, lodLevel: number): Promise<unknown> {
    return Promise.all(data.get_wmo_defs(lodLevel).map(async (wmoDef) => {
      const wmo = await cache.loadWmo(wmoDef.name_id);
      this.wmos.set(wmoDef.name_id, wmo);
      this.wmoDefs.push(WmoDefinition.fromAdtDefinition(wmoDef, wmo));
    }));
  }

  public async load(cache: WowCache, data: WowAdt, lodLevel: number): Promise<unknown> {
    return Promise.all([
      this.loadDoodads(cache, data, lodLevel),
      this.loadModels(cache, data, lodLevel),
      this.loadWMOs(cache, data, lodLevel),
    ]);
  }

  public setVisible(visible: boolean) {
    for (let doodad of this.doodads) {
      doodad.setVisible(visible);
    }
  }
}

export class LiquidInstance {
  private vertices: Float32Array | undefined;
  private indices: Uint16Array | undefined;
  public visible: boolean = true;

  constructor(vertices: Float32Array, indices: Uint16Array, public indexCount: number, public liquidType: number, public worldSpaceAABB: AABB) {
    this.vertices = vertices;
    this.indices = indices;
  }

  static fromAdtLiquid(liquid: WowAdtLiquidLayer): LiquidInstance {
    const vertices = liquid.take_vertices();
    const indices = liquid.take_indices();
    const indexCount = indices.length;
    const liquidType = liquid.get_liquid_type();
    const worldSpaceAABB = convertWowAABB(liquid.extents);
    return new LiquidInstance(vertices, indices, indexCount, liquidType, worldSpaceAABB);
  }

  static fromWmoLiquid(liquid: WowWmoLiquidResult): LiquidInstance {
    const vertices = liquid.take_vertices();
    const indices = liquid.take_indices();
    const indexCount = indices.length;
    const liquidType = liquid.liquid_type;
    const worldSpaceAABB = convertWowAABB(liquid.extents);
    return new LiquidInstance(vertices, indices, indexCount, liquidType, worldSpaceAABB);
  }

  public takeVertices(device: GfxDevice): GfxVertexBufferDescriptor {
    return {
      buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.vertices!.buffer),
      byteOffset: 0,
    };
  }

  public setVisible(visible: boolean) {
    this.visible = visible;
  }

  public takeIndices(device: GfxDevice): GfxIndexBufferDescriptor {
    return {
      buffer: makeStaticDataBuffer(device, GfxBufferUsage.Index, this.indices!.buffer),
      byteOffset: 0,
    };
  }
}

export class AdtData {
  public blps: Map<number, BlpData> = new Map();
  public models: Map<number, ModelData> = new Map();
  public wmos: Map<number, WmoData> = new Map();
  public worldSpaceAABB: AABB = new AABB();
  public hasBigAlpha: boolean;
  public hasHeightTexturing: boolean;
  public lodLevel: number;
  public lodData: AdtLodData[] = [];
  public visible = true;
  public chunkData: ChunkData[] = [];
  public liquids: LiquidInstance[] = [];
  public liquidTypes: Map<number, LiquidType> = new Map();
  public insideWmoCandidates: WmoDefinition[] = [];
  public visibleWmoCandidates: WmoDefinition[] = [];
  public skyboxModelData: ModelData | null = null;
  public skyboxFlags: number | undefined;
  private vertexBuffer: Float32Array;
  private indexBuffer: Uint16Array;
  private inner: WowAdt | null = null;

  constructor(public fileId: number, adt: WowAdt) {
    this.inner = adt;
  }

  public setVisible(visible: boolean) {
    this.visible = visible;
    this.lodData[this.lodLevel].setVisible(visible);
    for (let chunk of this.chunkData) {
      chunk.setVisible(visible);
    }
    for (let liquid of this.liquids) {
      liquid.setVisible(visible);
    }
  }

  public setLodLevel(lodLevel: number) {
    assert(lodLevel === 0 || lodLevel === 1, "lodLevel must be 0 or 1");
    if (this.lodLevel === lodLevel) return;
    this.lodLevel = lodLevel;
    const lodLevelToDisable = this.lodLevel === 0 ? 1 : 0;
    this.lodData[lodLevelToDisable].setVisible(false);
    for (let def of this.lodData[lodLevelToDisable].wmoDefs) {
      def.setVisible(false);
    }
  }

  private async loadTextures(cache: WowCache): Promise<unknown> {
    const textureIds = Array.from(this.inner!.get_texture_file_ids());
    return Promise.all(textureIds.map(async (fileId) => {
      try {
        this.blps.set(fileId, new BlpData(fileId, await cache.loadBlp(fileId)));
      } catch (e) {
        console.error(`failed to load BLP ${e}`);
      }
    }));
  }

  private async loadLODs(cache: WowCache): Promise<unknown> {
    return Promise.all(this.lodData.map(async (lodData, i) => {
      return lodData.load(cache, this.inner!, i);
    }));
  }

  public async load(cache: WowCache) {
    this.lodData.push(new AdtLodData()); // LOD Level 0
    this.lodData.push(new AdtLodData()); // LOD Level 1

    await Promise.all([
      this.loadTextures(cache),
      this.loadLODs(cache),
    ]);
    this.setLodLevel(0);

    for (const lodData of this.lodData) {
      for (const [k, v] of lodData.wmos)
        this.wmos.set(k, v);
      for (const [k, v] of lodData.models)
        this.models.set(k, v);
    }

    const renderResult = this.inner!.get_render_result(this.hasBigAlpha, this.hasHeightTexturing);
    this.worldSpaceAABB.transform(convertWowAABB(renderResult.extents), noclipSpaceFromAdtSpace);
    this.worldSpaceAABB.transform(this.worldSpaceAABB, adtSpaceFromPlacementSpace);
    this.vertexBuffer = renderResult.take_vertex_buffer();
    this.indexBuffer = renderResult.take_index_buffer();
    let i = 0;
    const worldSpaceChunkWidth = 100 / 3;
    for (let chunk of renderResult.chunks) {
      const x = 15 - Math.floor(i / 16);
      const y = 15 - i % 16;
      const chunkWorldSpaceAABB = new AABB();
      chunkWorldSpaceAABB.minX = this.worldSpaceAABB.minX + x * worldSpaceChunkWidth;
      chunkWorldSpaceAABB.minY = this.worldSpaceAABB.minY + y * worldSpaceChunkWidth;
      chunkWorldSpaceAABB.minZ = this.worldSpaceAABB.minZ;

      chunkWorldSpaceAABB.maxX = this.worldSpaceAABB.minX + (x + 1) * worldSpaceChunkWidth;
      chunkWorldSpaceAABB.maxY = this.worldSpaceAABB.minY + (y + 1) * worldSpaceChunkWidth;
      chunkWorldSpaceAABB.maxZ = this.worldSpaceAABB.maxZ;
      const textures = [];
      for (let blpId of chunk.texture_layers) {
        textures.push(this.blps.get(blpId)!);
      }

      this.chunkData.push(new ChunkData(chunk, textures, chunkWorldSpaceAABB));
      const liquidLayers = this.inner!.take_chunk_liquid_data(i);
      if (liquidLayers !== undefined) {
        for (let layer of liquidLayers) {
          const instanceData = LiquidInstance.fromAdtLiquid(layer);
          if (instanceData.liquidType === 100) {
            console.warn(`basic procedural water detected!!!!`);
          }
          if (!this.liquidTypes.has(instanceData.liquidType)) {
            this.liquidTypes.set(instanceData.liquidType, await cache.loadLiquidType(instanceData.liquidType));
          }
          this.liquids.push(instanceData);
        }
      }
      i += 1;
    }
    renderResult.free();

    let adtCenter = vec3.create();
    this.worldSpaceAABB.centerPoint(adtCenter);
    const lightingResult = cache.db.getGlobalLightingData(adtCenter, 0);
    if (lightingResult.skybox_filename !== undefined) {
      const modelFileId = getFileDataId(lightingResult.skybox_filename);
      if (modelFileId === undefined) {
        throw new Error(`couldn't find fileDataId for skybox "${lightingResult.skybox_filename}"`);
      }
      this.skyboxModelData = await cache.loadModel(modelFileId);
      this.skyboxFlags = lightingResult.skybox_flags;
    }

    this.inner!.free();
    this.inner = null;
  }

  public lodDoodads(): DoodadData[] {
    return this.lodData[this.lodLevel].doodads;
  }

  public lodWmoDefs(): WmoDefinition[] {
    return this.lodData[this.lodLevel].wmoDefs;
  }

  public getBufsAndChunks(device: GfxDevice): [GfxVertexBufferDescriptor, GfxIndexBufferDescriptor] {
    const vertexBuffer = {
      buffer: makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.vertexBuffer.buffer),
      byteOffset: 0,
    };
    const indexBuffer = {
      buffer: makeStaticDataBuffer(device, GfxBufferUsage.Index, this.indexBuffer.buffer),
      byteOffset: 0,
    };
    return [vertexBuffer, indexBuffer];
  }

  public setupWmoCandidates(worldCamera: vec3, worldFrustum: Frustum) {
    this.insideWmoCandidates = [];
    this.visibleWmoCandidates = [];
    for (let def of this.lodWmoDefs()) {
      if (def.worldAABB.containsPoint(worldCamera)) {
        this.insideWmoCandidates.push(def);
      } else if (worldFrustum.contains(def.worldAABB)) {
        this.visibleWmoCandidates.push(def);
      } else {
        def.setVisible(false);
      }
    }
  }
}

export class ChunkData {
  public alphaTexture: Uint8Array | undefined;
  public indexCount: number;
  public indexOffset: number;
  public visible = true;

  constructor(chunk: WowAdtChunkDescriptor, public textures: BlpData[], public worldSpaceAABB: AABB) {
    this.alphaTexture = chunk.alpha_texture;
    this.indexCount = chunk.index_count;
    this.indexOffset = chunk.index_offset;
    chunk.free();
  }

  public setVisible(visible: boolean) {
    this.visible = visible;
  }
}

export class DoodadData {
  public visible = true;
  public worldAABB = new AABB();
  public normalMatrix = mat4.create();
  public ambientColor: vec4 = [0, 0, 0, 0];
  public applyInteriorLighting = false;
  public applyExteriorLighting = false;
  public interiorExteriorBlend = 0;
  public isSkybox = false;

  constructor(public modelId: number, public modelMatrix: mat4, public color: number[] | null) {
    mat4.mul(this.normalMatrix, this.modelMatrix, placementSpaceFromModelSpace);
    mat4.mul(this.normalMatrix, adtSpaceFromPlacementSpace, this.modelMatrix);
    mat4.invert(this.normalMatrix, this.normalMatrix);
    mat4.transpose(this.normalMatrix, this.normalMatrix);
  }

  static skyboxDoodad(): DoodadData {
    let modelMatrix = mat4.identity(mat4.create());
    let doodad = new DoodadData(666, modelMatrix, null);
    doodad.isSkybox = true;
    return doodad;
  }

  public setVisible(visible: boolean) {
    this.visible = visible;
  }

  static fromAdtDoodad(doodad: WowDoodad): DoodadData {
    const doodadPos = doodad.position;
    let position: vec3 = [doodadPos.x, doodadPos.y, doodadPos.z];
    doodadPos.free();
    const doodadRot = doodad.rotation;
    let rotation: vec3 = [doodadRot.x, doodadRot.y, doodadRot.z];
    doodadRot.free();
    let scale = doodad.scale / 1024;
    const doodadMat = mat4.create();
    setMatrixTranslation(doodadMat, position);
    mat4.scale(doodadMat, doodadMat, [scale, scale, scale]);
    mat4.rotateY(doodadMat, doodadMat, MathConstants.DEG_TO_RAD * rotation[1]);
    mat4.rotateX(doodadMat, doodadMat, MathConstants.DEG_TO_RAD * rotation[0]);
    mat4.rotateZ(doodadMat, doodadMat, MathConstants.DEG_TO_RAD * rotation[2]);
    mat4.mul(doodadMat, doodadMat, placementSpaceFromModelSpace);
    mat4.mul(doodadMat, adtSpaceFromPlacementSpace, doodadMat);
    const fileId = doodad.name_id;
    doodad.free();
    return new DoodadData(fileId, doodadMat, null);
  }

  static fromWmoDoodad(doodad: WowDoodadDef, modelIds: Uint32Array, wmoDefModelMatrix: mat4): DoodadData {
    const doodadPos = doodad.position;
    let position: vec3 = [doodadPos.x, doodadPos.y, doodadPos.z];
    doodadPos.free();
    const doodadRot = doodad.orientation;
    let rotation: quat = [doodadRot.x, doodadRot.y, doodadRot.z, doodadRot.w];
    doodadRot.free();
    let scale = doodad.scale;
    const doodadColor = doodad.color;
    let color = [doodadColor.g, doodadColor.b, doodadColor.r, doodadColor.a]; // BRGA
    doodadColor.free();
    let modelId = modelIds[doodad.name_index];
    if (modelId === undefined) {
      throw new Error(`WMO doodad with invalid name_index ${doodad.name_index} (only ${modelIds.length} models)`);
    }
    let doodadMat = mat4.create();
    setMatrixTranslation(doodadMat, position);
    const rotMat = mat4.fromQuat(mat4.create(), rotation as quat);
    mat4.mul(doodadMat, doodadMat, rotMat);
    mat4.scale(doodadMat, doodadMat, [scale, scale, scale]);
    mat4.mul(doodadMat, wmoDefModelMatrix, doodadMat);
    doodad.free();
    return new DoodadData(modelId, doodadMat, color);
  }

  public setBoundingBoxFromModel(model: ModelData) {
    this.worldAABB.transform(model.modelAABB, this.modelMatrix);
  }
}

async function loadAdt(cache: WowCache, fileIDs: WowMapFileDataIDsLike): Promise<AdtData> {
  const [rootFile, obj0File, obj1File, texFile] = await Promise.all([
    fetchDataByFileID(fileIDs.root_adt, cache.dataFetcher),
    fetchDataByFileID(fileIDs.obj0_adt, cache.dataFetcher),
    fileIDs.obj1_adt !== 0 ? fetchDataByFileID(fileIDs.obj1_adt, cache.dataFetcher) : Promise.resolve(null!),
    fetchDataByFileID(fileIDs.tex0_adt, cache.dataFetcher),
  ]);

  const wowAdt = rust.WowAdt.new(rootFile);
  wowAdt.append_obj_adt(obj0File);
  if (obj1File !== null)
    wowAdt.append_lod_obj_adt(obj1File);
  wowAdt.append_tex_adt(texFile);

  const adt = new AdtData(fileIDs.root_adt, wowAdt);
  await adt.load(cache);
  return adt;
}

export type AdtCoord = [number, number];

export class LazyWorldData {
  public adts: AdtData[] = [];
  private loadedAdtCoords: AdtCoord[] = [];
  public globalWmo: WmoData | null = null;
  public globalWmoDef: WmoDefinition | null = null;
  public hasBigAlpha: boolean;
  public hasHeightTexturing: boolean;
  public adtFileIds: WowMapFileDataIDs[] = [];
  public loading = false;

  constructor(public fileId: number, public startAdtCoords: AdtCoord, public adtRadius = 2, private dataFetcher: DataFetcher, public cache: WowCache) {
  }

  public async load() {
    const wdt = await fetchFileByID(this.fileId, this.dataFetcher, rust.WowWdt.new);
    this.adtFileIds = wdt.get_all_map_data();
    const [centerX, centerY] = this.startAdtCoords;

    const promises = [];
    for (let x = centerX - this.adtRadius; x <= centerX + this.adtRadius; x++) {
      for (let y = centerY - this.adtRadius; y <= centerY + this.adtRadius; y++) {
        promises.push(this.ensureAdtLoaded(x, y).then((adt) => {
          if (adt !== undefined)
            this.adts.push(adt);
        }));
      }
    }
    await Promise.all(promises);

    this.hasBigAlpha = wdt.adt_has_big_alpha();
    this.hasHeightTexturing = wdt.adt_has_height_texturing();
    wdt.free();
  }

  public onEnterAdt([centerX, centerY]: AdtCoord, callback: (coord: AdtCoord, adt: AdtData) => void): AdtCoord[] {
    if (this.loading) {
      return [];
    }
    let adtCoords: AdtCoord[] = [];
    console.log(`loading area around ${centerX}, ${centerY}`)
    for (let x = centerX - this.adtRadius; x <= centerX + this.adtRadius; x++) {
      for (let y = centerY - this.adtRadius; y <= centerY + this.adtRadius; y++) {
        if (!this.hasLoadedAdt([x, y])) {
          adtCoords.push([x, y]);
        }
      }
    }
    setTimeout(async () => {
      this.loading = true;
      for (let [x, y] of adtCoords) {
        try {
          const maybeAdt = await this.ensureAdtLoaded(x, y);
          if (maybeAdt) {
            callback([x, y], maybeAdt);
            this.adts.push(maybeAdt);
          }
        } catch (e) {
          console.log('failed to load ADT: ', e);
        }
      }
      this.loading = false;
    }, 0);
    return adtCoords;
  }

  public hasLoadedAdt(coord: AdtCoord): boolean {
    for (let [x, y] of this.loadedAdtCoords) {
      if (x === coord[0] && y === coord[1]) {
        return true;
      }
    }
    return false;
  }

  public async ensureAdtLoaded(x: number, y: number): Promise<AdtData | undefined> {
    if (this.hasLoadedAdt([x, y])) {
      return undefined;
    }
    let fileIDs: WowMapFileDataIDsLike | undefined;
    // hardcode GM Island's ADT on Kalimdor
    if (this.fileId === 782779 && x === 1 && y === 1) {
      fileIDs = {
        root_adt: 782825,
        obj0_adt: 782826,
        obj1_adt: 782827,
        tex0_adt: 782828,
      };
    } else {
      fileIDs = this.adtFileIds[y * 64 + x];
    }
    if (fileIDs === undefined) {
      return undefined;
    }
    console.log(`loading coords ${x}, ${y}`)
    if (fileIDs.root_adt === 0) {
      console.error(`null ADTs in a non-global-WMO WDT`);
      return undefined;
    }

    const adt = await loadAdt(this.cache, fileIDs);
    adt.hasBigAlpha = this.hasBigAlpha;
    adt.hasHeightTexturing = this.hasHeightTexturing;
    return adt;
  }

  public getAdtCoords(fileId: number): AdtCoord | undefined {
    for (let i=0; i < this.adtFileIds.length; i++) {
      if (this.adtFileIds[i].root_adt === fileId) {
        const x = i % 64;
        const y = Math.floor(i / 64);
        return [x, y];
      }
    }
    return undefined;
  }
}

interface WowMapFileDataIDsLike {
  root_adt: number,
  obj0_adt: number,
  obj1_adt: number,
  tex0_adt: number,
}

export class WorldData {
  public adts: AdtData[] = [];
  public globalWmo: WmoData | null = null;
  public globalWmoDef: WmoDefinition | null = null;

  constructor(public fileId: number, public cache: WowCache) {
  }

  public async load(dataFetcher: DataFetcher, cache: WowCache) {
    const wdt = await fetchFileByID(this.fileId, dataFetcher, rust.WowWdt.new);
    const hasBigAlpha = wdt.adt_has_big_alpha();
    const hasHeightTexturing = wdt.adt_has_height_texturing();
    if (wdt.wdt_uses_global_map_obj()) {
      const def = wdt.global_wmo!;
      this.globalWmo = await cache.loadWmo(def.name_id);
      this.globalWmoDef = WmoDefinition.fromGlobalDefinition(def, this.globalWmo);
    } else {
      const adtFileIDs = wdt.get_loaded_map_data();
      for (let fileIDs of adtFileIDs) {
        if (fileIDs.root_adt === 0) {
          // throw new Error(`null ADTs in a non-global-WMO WDT`);
          continue;
        }

        const adt = await loadAdt(cache, fileIDs);
        adt.hasBigAlpha = hasBigAlpha;
        adt.hasHeightTexturing = hasHeightTexturing;
        this.adts.push(adt);
      }
    }
    wdt.free();
  }
}

