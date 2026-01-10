import { mat4, vec4 } from "gl-matrix";
import {
  type CameraController,
  computeViewSpaceDepthFromWorldSpaceAABB,
} from "../Camera.js";
import type { DataFetcher } from "../DataFetcher.js";
import { AABB } from "../Geometry.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import {
  makeBackbufferDescSimple,
  standardFullClearRenderPassDescriptor,
} from "../gfx/helpers/RenderGraphHelpers.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import {
  fillMatrix4x4,
  fillVec4,
  fillVec4v,
} from "../gfx/helpers/UniformBufferHelpers.js";
import {
  type GfxBindingLayoutDescriptor,
  GfxBlendFactor,
  GfxBlendMode,
  GfxChannelWriteMask,
  GfxCompareMode,
  GfxCullMode,
  type GfxDevice,
  GfxFormat,
  GfxFrontFaceMode,
  GfxMipFilterMode,
  type GfxProgram,
  type GfxSampler,
  GfxTexFilterMode,
  type GfxTexture,
  GfxWrapMode,
  makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import type { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import {
  GfxRendererLayer,
  type GfxRenderInst,
  GfxRenderInstList,
  makeSortKey,
  setSortKeyDepth,
} from "../gfx/render/GfxRenderInstManager.js";
import { CalcBillboardFlags, calcBillboardMatrix } from "../MathHelpers.js";
import { TextureMapping } from "../TextureHolder.js";
import type * as Viewer from "../viewer.js";
import {
  collectGeometry,
  createGeometryData,
  type DecalGroup,
  type ToontownGeometryData,
} from "./geom.js";
import {
  ColorType,
  CompressionMode,
  CullFaceMode,
  FilterType,
  GeomNode,
  type PandaNode,
  type Texture,
  TextureAttrib,
  TransparencyMode,
  WrapMode,
} from "./nodes";
import { ToontownProgram } from "./program.js";
import type { ToontownResourceLoader } from "./resources.js";
import { expandToRGBA } from "./textures.js";

export const pathBase = "Toontown";

// Scratch AABB for frustum culling
const scratchAABB = new AABB();

// Binding layout: 2 uniform buffers (scene params, draw params), 1 sampler
const bindingLayouts: GfxBindingLayoutDescriptor[] = [
  { numUniformBuffers: 2, numSamplers: 1 },
];

// Panda3D: +X right, +Y forward, +Z up
// noclip:  +X right, +Y up, -Z forward
const pandaToNoclip = mat4.fromValues(
  1,
  0,
  0,
  0,
  0,
  0,
  -1,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
);

/**
 * Processed decal group with GPU-ready geometry
 */
interface ProcessedDecalGroup {
  group: DecalGroup;
  baseGeometryData: ToontownGeometryData[];
  decalGeometryData: ToontownGeometryData[];
}

/**
 * Identifies which pass of three-pass decal rendering
 */
enum DecalPass {
  None = 0,
  BaseFirst = 1, // Pass 1: Base geometry, depthWrite=OFF
  Decals = 2, // Pass 2: Decal geometry, depthWrite=OFF
  BaseSecond = 3, // Pass 3: Base geometry, colorWrite=OFF (depth fill)
}

// Decal layer constants between OPAQUE (0x20) and TRANSLUCENT (0x80)
const DECAL_LAYER_BASE_FIRST = 0x30;
const DECAL_LAYER_DECALS = 0x31;
const DECAL_LAYER_BASE_SECOND = 0x32;

// Alpha test thresholds for M_dual and M_binary transparency modes
const ALPHA_DUAL_THRESHOLD = 252 / 256; // Accounts for DXT compression
const ALPHA_BINARY_THRESHOLD = 0.5;

/**
 * Convert Panda3D wrap mode to GfxWrapMode
 */
function translateWrapMode(mode: WrapMode): GfxWrapMode {
  switch (mode) {
    case WrapMode.Clamp:
    case WrapMode.BorderColor:
      return GfxWrapMode.Clamp;
    case WrapMode.Repeat:
      return GfxWrapMode.Repeat;
    case WrapMode.Mirror:
    case WrapMode.MirrorOnce:
      return GfxWrapMode.Mirror;
    default:
      return GfxWrapMode.Repeat;
  }
}

/**
 * Convert Panda3D filter type to GfxTexFilterMode and GfxMipFilterMode
 */
function translateFilterType(filterType: FilterType): {
  texFilter: GfxTexFilterMode;
  mipFilter: GfxMipFilterMode;
} {
  switch (filterType) {
    case FilterType.Nearest:
      return {
        texFilter: GfxTexFilterMode.Point,
        mipFilter: GfxMipFilterMode.Nearest,
      };
    case FilterType.Linear:
      return {
        texFilter: GfxTexFilterMode.Bilinear,
        mipFilter: GfxMipFilterMode.Nearest,
      };
    case FilterType.NearestMipmapNearest:
      return {
        texFilter: GfxTexFilterMode.Point,
        mipFilter: GfxMipFilterMode.Nearest,
      };
    case FilterType.LinearMipmapNearest:
      return {
        texFilter: GfxTexFilterMode.Bilinear,
        mipFilter: GfxMipFilterMode.Nearest,
      };
    case FilterType.NearestMipmapLinear:
      return {
        texFilter: GfxTexFilterMode.Point,
        mipFilter: GfxMipFilterMode.Linear,
      };
    // case FilterType.LinearMipmapLinear:
    // case FilterType.Default:
    default:
      return {
        texFilter: GfxTexFilterMode.Bilinear,
        mipFilter: GfxMipFilterMode.Linear,
      };
  }
}

export class ToontownRenderer implements Viewer.SceneGfx {
  private renderHelper: GfxRenderHelper;
  private renderInstListMain = new GfxRenderInstList();
  private geometryData: ToontownGeometryData[] = [];
  private decalGroups: ProcessedDecalGroup[] = [];
  private gfxProgram: GfxProgram;
  private textureCache: Map<
    string,
    { texture: GfxTexture; sampler: GfxSampler }
  > = new Map();
  private whiteTexture: GfxTexture;
  private defaultSampler: GfxSampler;

  private constructor(device: GfxDevice) {
    this.renderHelper = new GfxRenderHelper(device);
    const cache = this.renderHelper.renderCache;

    // Create shader program
    const program = new ToontownProgram();
    this.gfxProgram = cache.createProgram(program);

    // Create white texture for when no texture is bound
    this.whiteTexture = device.createTexture(
      makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1),
    );
    const whiteData = new Uint8Array([255, 255, 255, 255]);
    device.uploadTextureData(this.whiteTexture, 0, [whiteData]);

    // Create default sampler
    this.defaultSampler = cache.createSampler({
      wrapS: GfxWrapMode.Repeat,
      wrapT: GfxWrapMode.Repeat,
      minFilter: GfxTexFilterMode.Bilinear,
      magFilter: GfxTexFilterMode.Bilinear,
      mipFilter: GfxMipFilterMode.Linear,
    });
  }

  public adjustCameraController(c: CameraController) {
    c.setSceneMoveSpeedMult(0.02);
  }

  /**
   * Create a renderer from a scene
   */
  public static async create(
    device: GfxDevice,
    scene: PandaNode,
    loader: ToontownResourceLoader,
    dataFetcher: DataFetcher,
  ): Promise<ToontownRenderer> {
    const renderer = new ToontownRenderer(device);
    const cache = renderer.renderHelper.renderCache;

    // Load all textures used in the scene
    await renderer.buildTextureCache(device, cache, scene, loader, dataFetcher);

    // Collect geometry from the scene graph
    const { regularGeometry, decalGroups } = collectGeometry(scene);

    // Process regular geometry
    for (const c of regularGeometry) {
      const data = createGeometryData(device, cache, c, renderer.textureCache);
      if (data) {
        renderer.geometryData.push(data);
      }
    }

    // Process decal groups
    for (const group of decalGroups) {
      const baseGeometryData: ToontownGeometryData[] = [];
      const decalGeometryData: ToontownGeometryData[] = [];

      for (const c of group.baseGeometries) {
        const data = createGeometryData(
          device,
          cache,
          c,
          renderer.textureCache,
        );
        if (data) {
          baseGeometryData.push(data);
        }
      }

      for (const c of group.decalGeometries) {
        const data = createGeometryData(
          device,
          cache,
          c,
          renderer.textureCache,
        );
        if (data) {
          decalGeometryData.push(data);
        }
      }

      if (baseGeometryData.length > 0) {
        renderer.decalGroups.push({
          group,
          baseGeometryData,
          decalGeometryData,
        });
      }
    }

    console.log(
      `Created ${renderer.geometryData.length} GPU geometry objects, ${renderer.decalGroups.length} decal groups`,
    );
    return renderer;
  }

  private async buildTextureCache(
    device: GfxDevice,
    cache: GfxRenderCache,
    scene: PandaNode,
    loader: ToontownResourceLoader,
    dataFetcher: DataFetcher,
  ): Promise<void> {
    const allTextures = new Map<string, Texture>();
    scene.traverse((node) => {
      if (!(node instanceof GeomNode)) return;
      for (const { state } of node.geoms) {
        if (!state) continue;
        const entry = state.attribs.find(
          ({ attrib }) => attrib instanceof TextureAttrib,
        );
        if (!entry) continue;
        const attrib = entry.attrib as TextureAttrib;
        for (const stage of attrib.onStages) {
          allTextures.set(stage.texture.name, stage.texture);
        }
        if (attrib.texture) {
          allTextures.set(attrib.texture.name, attrib.texture);
        }
      }
    });

    await Promise.all(
      Array.from(allTextures.values(), (texture) =>
        this.buildTexture(device, cache, texture, loader, dataFetcher),
      ),
    );
    console.debug(
      `Built texture cache with ${this.textureCache.size} textures`,
    );
  }

  private async buildTexture(
    device: GfxDevice,
    cache: GfxRenderCache,
    texture: Texture,
    loader: ToontownResourceLoader,
    dataFetcher: DataFetcher,
  ) {
    if (this.textureCache.has(texture.name)) return;

    // Try to load embedded raw data first
    if (texture.rawData && texture.rawData.ramImages.length > 0) {
      if (texture.rawData.ramImageCompression !== CompressionMode.Off) {
        throw new Error(
          `Failed to load texture ${texture.name}: compressed format not supported`,
        );
      }

      const rawData = texture.rawData;
      const [width, height] = rawData.size;
      const imageData = rawData.ramImages[0].data;
      const format = texture.pbufferFormat ?? texture.format;

      // Expand to RGBA
      const rgbaData = expandToRGBA(
        imageData,
        width,
        height,
        texture.numComponents,
        format,
      );

      // Create GPU texture
      const gfxTexture = device.createTexture(
        makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1),
      );
      device.uploadTextureData(gfxTexture, 0, [rgbaData]);
      device.setResourceName(gfxTexture, texture.name);

      const gfxSampler = this.createSamplerForTexture(cache, texture);
      this.textureCache.set(texture.name, {
        texture: gfxTexture,
        sampler: gfxSampler,
      });
    } else if (texture.filename) {
      await this.loadExternalTexture(
        device,
        cache,
        texture,
        loader,
        dataFetcher,
      );
    } else {
      throw new Error(
        `Failed to load texture ${texture.name}: no raw data or filename`,
      );
    }
  }

  private async loadExternalTexture(
    device: GfxDevice,
    cache: GfxRenderCache,
    texture: Texture,
    loader: ToontownResourceLoader,
    dataFetcher: DataFetcher,
  ): Promise<void> {
    try {
      const decoded = await loader.loadTexture(
        texture.filename,
        texture.alphaFilename,
        dataFetcher,
      );

      // Create GPU texture
      const gfxTexture = device.createTexture(
        makeTextureDescriptor2D(
          GfxFormat.U8_RGBA_NORM,
          decoded.width,
          decoded.height,
          1,
        ),
      );
      device.uploadTextureData(gfxTexture, 0, [decoded.data]);
      device.setResourceName(gfxTexture, texture.name);

      const gfxSampler = this.createSamplerForTexture(cache, texture);
      this.textureCache.set(texture.name, {
        texture: gfxTexture,
        sampler: gfxSampler,
      });
      console.debug(
        `Loaded external texture ${texture.name} from ${texture.filename} (${decoded.width}x${decoded.height})${texture.alphaFilename ? " with alpha" : ""}`,
      );
    } catch (e) {
      console.warn(`Failed to load external texture ${texture.name}:`, e);
    }
  }

  private createSamplerForTexture(
    cache: GfxRenderCache,
    texture: Texture,
  ): GfxSampler {
    const sampler = texture.defaultSampler;
    const minF = translateFilterType(sampler.minFilter);
    const magF = translateFilterType(sampler.magFilter);
    return cache.createSampler({
      wrapS: translateWrapMode(sampler.wrapU),
      wrapT: translateWrapMode(sampler.wrapV),
      wrapQ: translateWrapMode(sampler.wrapW),
      minFilter: minF.texFilter,
      magFilter: magF.texFilter,
      mipFilter: minF.mipFilter,
      minLOD: sampler.minLod,
      maxLOD: sampler.maxLod,
      maxAnisotropy: Math.max(sampler.anisoDegree, 1),
    });
  }

  /**
   * Create a sort key for decal rendering passes.
   * Encodes layer and group ID to ensure proper ordering.
   */
  private makeDecalSortKey(layer: number, groupId: number): number {
    // Layer in high byte, groupId in middle bytes
    return ((layer & 0xff) << 24) | ((groupId & 0xffff) << 8);
  }

  /**
   * Set up common render instance properties for geometry.
   * Returns the configured renderInst and metadata for further customization.
   * @param alphaThreshold - Alpha test threshold (0 = disabled, >0 = discard pixels with alpha < threshold)
   */
  private setupGeometryRenderInst(
    geomData: ToontownGeometryData,
    viewMatrix: mat4,
    alphaThreshold: number = 0,
  ): {
    renderInst: GfxRenderInst;
    hasTexture: boolean;
    isTransparent: boolean;
    cullMode: GfxCullMode;
    frontFace: GfxFrontFaceMode;
  } {
    const renderInstManager = this.renderHelper.renderInstManager;
    const renderInst = renderInstManager.newRenderInst();
    const { material } = geomData;
    const isTransparent = material.transparencyMode !== TransparencyMode.None;

    // Set vertex input
    renderInst.setVertexInput(
      geomData.inputLayout,
      [{ buffer: geomData.vertexBuffer, byteOffset: 0 }],
      geomData.indexBuffer
        ? { buffer: geomData.indexBuffer, byteOffset: 0 }
        : null,
    );

    // Determine culling
    let frontFace = GfxFrontFaceMode.CW;
    let cullMode = material.cullReverse ? GfxCullMode.Back : GfxCullMode.Front;
    switch (material.cullFaceMode) {
      case CullFaceMode.CullClockwise:
        break;
      case CullFaceMode.CullCounterClockwise:
        frontFace = GfxFrontFaceMode.CCW;
        break;
      case CullFaceMode.CullNone:
        cullMode = GfxCullMode.None;
        break;
    }

    // Set texture bindings
    const hasTexture = geomData.textureMapping.gfxTexture !== null;
    const textureMapping = new TextureMapping();
    if (hasTexture) {
      textureMapping.gfxTexture = geomData.textureMapping.gfxTexture;
      textureMapping.gfxSampler = geomData.textureMapping.gfxSampler;
    } else {
      textureMapping.gfxTexture = this.whiteTexture;
      textureMapping.gfxSampler = this.defaultSampler;
    }
    renderInst.setSamplerBindingsFromTextureMappings([textureMapping]);

    // Determine color based on ColorAttrib
    let color = vec4.fromValues(1, 1, 1, 1);
    let useVertexColors = geomData.hasColors;
    switch (material.colorType) {
      case ColorType.Flat:
        color = material.flatColor;
        useVertexColors = false;
        break;
      case ColorType.Off:
        useVertexColors = false;
        break;
      default:
        break;
    }

    const modelMatrix = mat4.clone(geomData.modelMatrix);

    // Apply billboard effect if present
    if (material.billboardEffect && !material.billboardEffect.off) {
      const modelViewMatrix = mat4.create();
      mat4.mul(modelViewMatrix, viewMatrix, modelMatrix);

      let flags: CalcBillboardFlags = CalcBillboardFlags.UseZSphere;
      if (!material.billboardEffect.eyeRelative) {
        flags |= CalcBillboardFlags.UseRollGlobal;
      }
      if (material.billboardEffect.axialRotate) {
        flags |= CalcBillboardFlags.PriorityY;
      }

      calcBillboardMatrix(modelMatrix, modelViewMatrix, flags);
      modelMatrix[8] = modelViewMatrix[8];
      modelMatrix[9] = modelViewMatrix[9];
      modelMatrix[10] = modelViewMatrix[10];

      const viewMatrixInv = mat4.create();
      mat4.invert(viewMatrixInv, viewMatrix);
      mat4.mul(modelMatrix, viewMatrixInv, modelMatrix);
    }

    // Allocate draw params UBO
    let offs = renderInst.allocateUniformBuffer(
      ToontownProgram.ub_DrawParams,
      16 + 4 + 4,
    );
    const drawParams = renderInst.mapUniformBufferF32(
      ToontownProgram.ub_DrawParams,
    );
    offs += fillMatrix4x4(drawParams, offs, modelMatrix);
    offs += fillVec4v(drawParams, offs, color);
    offs += fillVec4(
      drawParams,
      offs,
      hasTexture ? 1 : 0,
      useVertexColors ? 1 : 0,
      geomData.hasNormals ? 1 : 0,
      alphaThreshold,
    );

    renderInst.setDrawCount(geomData.indexCount);

    return { renderInst, hasTexture, isTransparent, cullMode, frontFace };
  }

  /**
   * Submit a render instance for decal geometry with the appropriate pass state.
   */
  private submitDecalRenderInst(
    geomData: ToontownGeometryData,
    viewMatrix: mat4,
    pass: DecalPass,
    groupId: number,
  ): void {
    const { renderInst, isTransparent, cullMode, frontFace } =
      this.setupGeometryRenderInst(geomData, viewMatrix);

    // Configure state based on pass
    switch (pass) {
      case DecalPass.BaseFirst:
      case DecalPass.Decals:
        // Pass 1 & 2: depthWrite=OFF, colorWrite=ON
        renderInst.setMegaStateFlags({
          cullMode,
          frontFace,
          depthWrite: false,
          depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
        });
        if (isTransparent) {
          setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
          });
        }
        break;

      case DecalPass.BaseSecond:
        // Pass 3: depthWrite=ON, colorWrite=OFF (depth fill only)
        renderInst.setMegaStateFlags({
          cullMode,
          frontFace,
          depthWrite: true,
          depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
        });
        setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
          channelWriteMask: GfxChannelWriteMask.None,
        });
        break;
    }

    let layer = DECAL_LAYER_BASE_FIRST;
    switch (pass) {
      case DecalPass.Decals:
        layer = DECAL_LAYER_DECALS;
        break;
      case DecalPass.BaseSecond:
        layer = DECAL_LAYER_BASE_SECOND;
        break;
      default:
        break;
    }
    renderInst.sortKey = this.makeDecalSortKey(layer, groupId);
    this.renderInstListMain.submitRenderInst(renderInst);
  }

  private prepareToRender(
    _device: GfxDevice,
    viewerInput: Viewer.ViewerRenderInput,
  ): void {
    const renderInstManager = this.renderHelper.renderInstManager;
    const template = this.renderHelper.pushTemplateRenderInst();
    template.setBindingLayouts(bindingLayouts);
    template.setGfxProgram(this.gfxProgram);
    template.setMegaStateFlags({
      depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
      // wireframe: true,
    });

    // Allocate scene params UBO
    let offs = template.allocateUniformBuffer(
      ToontownProgram.ub_SceneParams,
      16 + 16,
    );
    const sceneParams = template.mapUniformBufferF32(
      ToontownProgram.ub_SceneParams,
    );
    offs += fillMatrix4x4(
      sceneParams,
      offs,
      viewerInput.camera.projectionMatrix,
    );
    const viewMatrix = mat4.create();
    mat4.mul(viewMatrix, viewerInput.camera.viewMatrix, pandaToNoclip);
    offs += fillMatrix4x4(sceneParams, offs, viewMatrix);

    // Create render instances for each geometry
    const frustum = viewerInput.camera.frustum;
    for (const geomData of this.geometryData) {
      // Frustum culling: skip geometry that's not visible
      // Transform AABB to view space for culling (account for Panda3D coordinate system)
      scratchAABB.transform(geomData.worldAABB, pandaToNoclip);
      if (!frustum.contains(scratchAABB)) {
        continue;
      }

      const { material } = geomData;
      const drawOrder = material.drawOrder ?? 0;
      let frontFace = GfxFrontFaceMode.CW;
      let cullMode = material.cullReverse
        ? GfxCullMode.Back
        : GfxCullMode.Front;
      switch (material.cullFaceMode) {
        case CullFaceMode.CullClockwise:
          break;
        case CullFaceMode.CullCounterClockwise:
          frontFace = GfxFrontFaceMode.CCW;
          break;
        case CullFaceMode.CullNone:
          cullMode = GfxCullMode.None;
          break;
      }

      // Handle M_dual: two-pass rendering for better depth sorting
      if (material.transparencyMode === TransparencyMode.Dual) {
        // Pass 1: Opaque parts (α ≥ 0.984) with depth writes
        const opaqueResult = this.setupGeometryRenderInst(
          geomData,
          viewMatrix,
          ALPHA_DUAL_THRESHOLD,
        );
        opaqueResult.renderInst.setMegaStateFlags({
          depthWrite: true,
          depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
          cullMode,
          frontFace,
        });
        opaqueResult.renderInst.sortKey = makeSortKey(
          GfxRendererLayer.OPAQUE,
          drawOrder,
        );
        this.renderInstListMain.submitRenderInst(opaqueResult.renderInst);

        // Pass 2: Transparent parts (all pixels) with blending, depth writes off
        const transResult = this.setupGeometryRenderInst(
          geomData,
          viewMatrix,
          0,
        );
        transResult.renderInst.setMegaStateFlags({
          depthWrite: false,
          depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
          cullMode,
          frontFace,
        });
        setAttachmentStateSimple(transResult.renderInst.getMegaStateFlags(), {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.SrcAlpha,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(
          viewerInput.camera.viewMatrix,
          scratchAABB,
        );
        const sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT, drawOrder);
        transResult.renderInst.sortKey = setSortKeyDepth(sortKey, depth);
        this.renderInstListMain.submitRenderInst(transResult.renderInst);

        continue;
      }

      // Handle M_binary: single pass with alpha test, no blending
      if (material.transparencyMode === TransparencyMode.Binary) {
        const result = this.setupGeometryRenderInst(
          geomData,
          viewMatrix,
          ALPHA_BINARY_THRESHOLD,
        );
        result.renderInst.setMegaStateFlags({
          depthWrite: true,
          depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
          cullMode,
          frontFace,
        });
        result.renderInst.sortKey = makeSortKey(
          GfxRendererLayer.OPAQUE,
          drawOrder,
        );
        this.renderInstListMain.submitRenderInst(result.renderInst);

        continue;
      }

      // Normal handling for other transparency modes
      const { renderInst, isTransparent } = this.setupGeometryRenderInst(
        geomData,
        viewMatrix,
      );
      renderInst.setMegaStateFlags({
        cullMode,
        frontFace,
        depthWrite: material.depthWrite,
      });

      // Handle transparency blending
      if (isTransparent) {
        setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.SrcAlpha,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        renderInst.setMegaStateFlags({ depthWrite: false });
      }

      // Set sort key
      if (material.cullBinName === "background") {
        renderInst.sortKey = makeSortKey(
          GfxRendererLayer.BACKGROUND,
          drawOrder,
        );
      } else if (isTransparent) {
        // For transparent objects, compute depth for back-to-front sorting
        // Use the transformed AABB (already in scratchAABB from frustum test)
        // drawWorldSpaceAABB(
        //   getDebugOverlayCanvas2D(),
        //   viewerInput.camera.clipFromWorldMatrix,
        //   scratchAABB,
        // );
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(
          viewerInput.camera.viewMatrix,
          scratchAABB,
        );
        renderInst.sortKey = makeSortKey(
          GfxRendererLayer.TRANSLUCENT,
          drawOrder,
        );
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
      } else {
        renderInst.sortKey = makeSortKey(GfxRendererLayer.OPAQUE, drawOrder);
      }
      this.renderInstListMain.submitRenderInst(renderInst);
    }

    // Render decal groups with three-pass technique
    let decalGroupId = 0;
    for (const { group, baseGeometryData, decalGeometryData } of this
      .decalGroups) {
      // Frustum cull the entire group
      scratchAABB.transform(group.worldAABB, pandaToNoclip);
      if (!frustum.contains(scratchAABB)) {
        decalGroupId++;
        continue;
      }

      // Pass 1: Base geometry with depthWrite=false
      for (const geomData of baseGeometryData) {
        this.submitDecalRenderInst(
          geomData,
          viewMatrix,
          DecalPass.BaseFirst,
          decalGroupId,
        );
      }

      // Pass 2: Decal geometry with depthWrite=false
      for (const geomData of decalGeometryData) {
        this.submitDecalRenderInst(
          geomData,
          viewMatrix,
          DecalPass.Decals,
          decalGroupId,
        );
      }

      // Pass 3: Base geometry with colorWrite=false (depth fill)
      for (const geomData of baseGeometryData) {
        this.submitDecalRenderInst(
          geomData,
          viewMatrix,
          DecalPass.BaseSecond,
          decalGroupId,
        );
      }

      decalGroupId++;
    }

    renderInstManager.popTemplate();
    this.renderHelper.prepareToRender();
  }

  public render(
    device: GfxDevice,
    viewerInput: Viewer.ViewerRenderInput,
  ): void {
    const builder = this.renderHelper.renderGraph.newGraphBuilder();

    // Create render targets
    const mainColorDesc = makeBackbufferDescSimple(
      GfxrAttachmentSlot.Color0,
      viewerInput,
      standardFullClearRenderPassDescriptor,
    );
    const mainDepthDesc = makeBackbufferDescSimple(
      GfxrAttachmentSlot.DepthStencil,
      viewerInput,
      standardFullClearRenderPassDescriptor,
    );

    const mainColorTargetID = builder.createRenderTargetID(
      mainColorDesc,
      "Main Color",
    );
    const mainDepthTargetID = builder.createRenderTargetID(
      mainDepthDesc,
      "Main Depth",
    );

    // Main render pass
    builder.pushPass((pass) => {
      pass.setDebugName("Main");
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
      pass.attachRenderTargetID(
        GfxrAttachmentSlot.DepthStencil,
        mainDepthTargetID,
      );
      pass.exec((passRenderer) => {
        this.renderInstListMain.drawOnPassRenderer(
          this.renderHelper.renderCache,
          passRenderer,
        );
      });
    });

    // Resolve to screen
    builder.resolveRenderTargetToExternalTexture(
      mainColorTargetID,
      viewerInput.onscreenTexture,
    );

    // Prepare and execute
    this.prepareToRender(device, viewerInput);
    this.renderHelper.renderGraph.execute(builder);

    // Reset for next frame
    this.renderInstListMain.reset();
  }

  public destroy(device: GfxDevice): void {
    for (const geomData of this.geometryData) {
      device.destroyBuffer(geomData.vertexBuffer);
      if (geomData.indexBuffer) {
        device.destroyBuffer(geomData.indexBuffer);
      }
    }
    for (const { texture } of this.textureCache.values()) {
      device.destroyTexture(texture);
    }
    device.destroyTexture(this.whiteTexture);
    this.renderHelper.destroy();
  }
}
