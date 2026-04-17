/*
 * SceneBuilder converts the BLV game files into SceneTree objects.
 *
 * petton-svn, 2026.
 */

import {
  BlvFile,
  Mesh,
  MeshVertexA,
  MeshVertexB,
  Material,
  Buffer as BlvBuffer,
  RootObject,
  SubRoot,
  LocoObject,
  Vec2,
  Vec3,
  Box,
  MaterialPtr,
  RotRect,
  Polygon,
  PropCollisionMesh,
  PropSpring,
  AnimationTrackFileSwitch,
  BufferPtr,
  File as LocoFile,
} from "./lib/blv.js";
import { Color, colorNewFromRGBA, colorNewCopy } from "../Color.js";
import { decodeTextureToRGBA } from "./lib/texture_format.js";
import { Garc } from "./lib/garc.js";
import { parseTimp } from "./lib/timp.js";
import {
  GfxBuffer,
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  GfxDevice,
  GfxFormat,
  GfxInputLayout,
  GfxSampler,
  GfxTexture,
  GfxVertexBufferFrequency,
  makeTextureDescriptor2D,
  GfxWrapMode,
  GfxTexFilterMode,
  GfxMipFilterMode,
} from "../gfx/platform/GfxPlatform.js";
import { TextureMapping } from "../TextureHolder.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";

/** Local wrapper for the common "upload a static vertex/index buffer" pattern. */
function makeStaticDataBuffer(
  device: GfxDevice,
  usage: GfxBufferUsage,
  data: ArrayBufferLike,
): GfxBuffer {
  return createBufferFromData(device, usage, GfxBufferFrequencyHint.Static, data);
}
import { vec2, mat4 } from "gl-matrix";
import {
  PICORI_BLOB_1_COLOR,
  PICORI_BLOB_10_COLOR,
  PICORI_BLOB_50_COLOR,
  PICORI_EYES_VERTS,
  PICORI_BODY_VERTS,
  PICORI_BLOB_1_VERTS,
  PICORI_BLOB_10_VERTS,
  PICORI_BLOB_50_VERTS,
} from "./render/constants/PicoriConstants.js";
import {
  GpuMeshResources,
  NodeMeshInstance,
  PathLine,
  SceneNode,
  SceneTree,
  NodeAnimation,
  PathLineRenderState,
  SceneNodeRenderState,
  NodeMeshInstanceRenderState,
} from "./SceneTree.js";
import { buildLineQuadMeshFromPoints } from "./render/LineMeshBuilder.js";

/** Mutable version of SceneNode used during tree construction. */
type MutableSceneNode = Omit<SceneNode, 'meshInstances' | 'pathLines' | 'children' | 'parent'> & {
  meshInstances: NodeMeshInstance[];
  pathLines: PathLine[];
  children: SceneNode[];
  parent: SceneNode | null;
};

function newSceneNodeRenderState(): SceneNodeRenderState {
  return {
    visible: true,
    localMatrix: mat4.create(),
    worldMatrix: mat4.create()
  }
}

function newPathLineRenderState(): PathLineRenderState {
  return {
    worldMatrix: mat4.create()
  }
}

function newMeshInstanceRenderState(): NodeMeshInstanceRenderState {
  return {
    z: 0.0,
    color: colorNewFromRGBA(1,1,1,1),
    uvOffset: vec2.create(),
    texture: null,
    isFocused: false,
  }
}

/** GPU resources for one mesh component, paired with its source material/file for animation matching. */
interface MeshEntry {
  gpuResources: GpuMeshResources;
  material: Material | undefined;
  file: LocoFile | undefined;
}

/**
 * Context used during node tree construction to cache and share resources.
 */
/** Half-size of cross marker arms in local units. */
const CROSS_MARKER_SIZE = 5;

class SceneTreeBuilder {
  private textureCache = new Map<BlvBuffer, GfxTexture>();
  private systemTextureCache = new Map<string, GfxTexture>();
  private inputLayoutCache = new Map<string, GfxInputLayout>();
  public samplerRepeat: GfxSampler;
  public samplerClamp: GfxSampler;

  constructor(
    public device: GfxDevice,
    public renderCache: any, // GfxRenderCache
    public whiteFallbackTexture: GfxTexture,
    public systemArc: Garc,
    private blvFile: BlvFile,
  ) {
    this.samplerRepeat = device.createSampler({
      wrapS: GfxWrapMode.Repeat,
      wrapT: GfxWrapMode.Repeat,
      minFilter: GfxTexFilterMode.Bilinear,
      magFilter: GfxTexFilterMode.Bilinear,
      mipFilter: GfxMipFilterMode.Nearest,
    });
    this.samplerClamp = device.createSampler({
      wrapS: GfxWrapMode.Clamp,
      wrapT: GfxWrapMode.Clamp,
      minFilter: GfxTexFilterMode.Bilinear,
      magFilter: GfxTexFilterMode.Bilinear,
      mipFilter: GfxMipFilterMode.Nearest,
    });
  }

  // ==================== Texture Creation ====================

  getOrCreateTexture(
    buffer: BlvBuffer,
    createFn: () => GfxTexture,
  ): GfxTexture {
    let texture = this.textureCache.get(buffer);
    if (!texture) {
      texture = createFn();
      this.textureCache.set(buffer, texture);
    }
    return texture;
  }
  createTextureForMaterial(material: Material | null): TextureMapping {
    const textureMapping = new TextureMapping();

    if (!material || !material.file || !material.file.buffer) {
      textureMapping.gfxTexture = this.whiteFallbackTexture;
      return textureMapping;
    }

    const buffer = material.file.buffer;
    const texture = this.getOrCreateTexture(buffer, () => {
      const format = buffer.textureFormat;
      const data = buffer.mips[0].data.data;
      const palette = buffer.palette ? buffer.palette.rawValues : null;
      const decoded = decodeTextureToRGBA(
        format,
        data,
        palette,
        buffer.width,
        buffer.height,
      );
      const texture = this.device.createTexture(
        makeTextureDescriptor2D(
          GfxFormat.U8_RGBA_NORM,
          buffer.width,
          buffer.height,
          1,
        ),
      );
      this.device.uploadTextureData(texture, 0, [decoded]);
      return texture;
    });

    textureMapping.gfxTexture = texture;
    textureMapping.gfxSampler =
      material.file.textureMode === 0x10203
        ? this.samplerClamp
        : this.samplerRepeat;
    return textureMapping;
  }

  getSystemTexture(filename: string): GfxTexture {
    let texture = this.systemTextureCache.get(filename);
    if (texture) return texture;

    const file = this.systemArc.getFile(filename);
    const timp = parseTimp(file.data);
    texture = this.device.createTexture(
      makeTextureDescriptor2D(
        GfxFormat.U8_RGBA_NORM,
        timp.width,
        timp.height,
        1,
      ),
    );
    this.device.uploadTextureData(texture, 0, [timp.rgba]);
    this.systemTextureCache.set(filename, texture);
    return texture;
  }

  // ==================== Input Layout ====================

  getOrCreateInputLayout(
    key: string,
    createFn: () => GfxInputLayout,
  ): GfxInputLayout {
    let layout = this.inputLayoutCache.get(key);
    if (!layout) {
      layout = createFn();
      this.inputLayoutCache.set(key, layout);
    }
    return layout;
  }

  getStandardInputLayout(): GfxInputLayout {
    return this.getOrCreateInputLayout("standard", () => {
      return this.renderCache.createInputLayout({
        indexBufferFormat: GfxFormat.U16_R,
        vertexAttributeDescriptors: [
          {
            location: 0,
            bufferIndex: 0,
            format: GfxFormat.F32_RGB,
            bufferByteOffset: 0,
          },
          {
            location: 1,
            bufferIndex: 0,
            format: GfxFormat.F32_RG,
            bufferByteOffset: 3 * 4,
          },
          {
            location: 2,
            bufferIndex: 0,
            format: GfxFormat.F32_RGBA,
            bufferByteOffset: 5 * 4,
          },
        ],
        vertexBufferDescriptors: [
          { byteStride: 9 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
        ],
      });
    });
  }

  // ==================== Helpers ====================

  po2Scale(x: number): number {
    const scaledUpToNextPow2 = Math.pow(2, Math.ceil(Math.log2(x)));
    return scaledUpToNextPow2 / x;
  }

  splitTrianglesByZLayer(
    vertices: number[], // flat array: x,y,z,u,v,r,g,b,a per vertex (stride 9)
    indices: number[], // triangle indices (length divisible by 3)
  ): { z: number; triangleIndices: number[] }[] {
    const trianglesByZ = new Map<number, number[]>();
    const mixedZTriangles: number[] = [];

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i],
        i1 = indices[i + 1],
        i2 = indices[i + 2];
      const z0 = vertices[i0 * 9 + 2];
      const z1 = vertices[i1 * 9 + 2];
      const z2 = vertices[i2 * 9 + 2];

      if (z0 === z1 && z1 === z2) {
        if (!trianglesByZ.has(z0)) {
          trianglesByZ.set(z0, []);
        }
        trianglesByZ.get(z0)!.push(i0, i1, i2);
      } else {
        mixedZTriangles.push(i0, i1, i2);
      }
    }

    const layers: { z: number; triangleIndices: number[] }[] = [];

    if (mixedZTriangles.length > 0) {
      let minZ = Infinity;
      for (let i = 0; i < mixedZTriangles.length; i++) {
        const z = vertices[mixedZTriangles[i] * 9 + 2];
        minZ = Math.min(minZ, z);
      }
      layers.push({ z: minZ, triangleIndices: mixedZTriangles });
    }

    const sortedZs = Array.from(trianglesByZ.keys()).sort((a, b) => a - b);
    for (const z of sortedZs) {
      layers.push({ z, triangleIndices: trianglesByZ.get(z)! });
    }

    layers.sort((a, b) => a.z - b.z);
    return layers;
  }

  // ==================== Mesh Resource Creation ====================

  /**
   * Create GPU mesh resources for one or more BLV Mesh objects.
   * When multiple meshes are provided, components with the same texture are
   * merged into a single VBO/IBO, producing far fewer draw calls.
   * Returns an array of MeshEntry (one per Z-layer per texture group).
   */
  createMeshResources(meshes: Mesh[], bakeMaterialColor = false): MeshEntry[] {
    const results: MeshEntry[] = [];
    const inputLayout = this.getStandardInputLayout();

    // Group all components across all meshes by their texture mapping.
    // Components sharing a texture will be merged into one VBO/IBO.
    // Key by GfxTexture + GfxSampler unique IDs since createTextureForMaterial
    // returns a new TextureMapping object each time.
    const textureGroups = new Map<string, {
      textureMapping: TextureMapping;
      vertices: number[];
      indices: number[];
      material: Material | undefined;
      file: LocoFile | undefined;
    }>();

    for (const mesh of meshes) {
      for (const component of mesh.meshComponents) {
        let uvScaleU = 1.0;
        let uvScaleV = 1.0;
        if (
          component.material &&
          component.material.file &&
          component.material.file.buffer
        ) {
          const file = component.material.file;
          const buffer = file.buffer;
          uvScaleU = file.uScaling * this.po2Scale(buffer.width);
          uvScaleV = file.vScaling * this.po2Scale(buffer.height);
        }

        const textureMapping = this.createTextureForMaterial(component.material);
        const texId = textureMapping.gfxTexture?.ResourceUniqueId ?? -1;
        const samId = textureMapping.gfxSampler?.ResourceUniqueId ?? -1;
        const matName = bakeMaterialColor ? "baked" : (component.material?.name ?? "none");
        const groupKey = `${texId}:${samId}:${matName}`;

        let group = textureGroups.get(groupKey);
        if (!group) {
          group = {
            textureMapping,
            vertices: [],
            indices: [],
            material: component.material ?? undefined,
            file: component.material?.file ?? undefined,
          };
          textureGroups.set(groupKey, group);
        }

        for (const vertexBuffer of component.vertices) {
          const baseVertex = group.vertices.length / 9;
          for (const v of vertexBuffer.data) {
            group.vertices.push(v.x, v.y, v.z);
            group.vertices.push((v.u / 32768) * uvScaleU, (v.v / 32768) * uvScaleV);
            if (v instanceof MeshVertexB) {
              group.vertices.push(v.r / 255, v.g / 255, v.b / 255, v.a / 255);
            } else if (bakeMaterialColor && component.material) {
              const c = component.material.color;
              group.vertices.push(c.r, c.g, c.b, c.a);
            } else {
              group.vertices.push(1, 1, 1, 1);
            }
          }

          // Tristrips to triangles
          for (let i = 2; i < vertexBuffer.data.length; i++) {
            if (i % 2 === 0) {
              group.indices.push(
                baseVertex + i - 2,
                baseVertex + i - 1,
                baseVertex + i,
              );
            } else {
              group.indices.push(
                baseVertex + i - 2,
                baseVertex + i,
                baseVertex + i - 1,
              );
            }
          }
        }
      }
    }

    // Now create GPU resources for each texture group
    for (const group of textureGroups.values()) {
      const { textureMapping, vertices, indices, material, file } = group;
      if (vertices.length === 0 || indices.length === 0) continue;

      // Split by Z layers
      const layers = this.splitTrianglesByZLayer(vertices, indices);

      for (const layer of layers) {
        const layerIndices = layer.triangleIndices;
        if (layerIndices.length === 0) continue;

        // Calculate local AABB
        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity;
        for (const idx of layerIndices) {
          const x = vertices[idx * 9 + 0];
          const y = vertices[idx * 9 + 1];
          const z = vertices[idx * 9 + 2];
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }

        const vbo = makeStaticDataBuffer(
          this.device,
          GfxBufferUsage.Vertex,
          new Float32Array(vertices).buffer,
        );
        const ibo = makeStaticDataBuffer(
          this.device,
          GfxBufferUsage.Index,
          new Uint16Array(layerIndices).buffer,
        );

        results.push({
          gpuResources: {
            vertexBuffer: vbo,
            indexBuffer: ibo,
            inputLayout,
            vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
            indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
            drawCount: layerIndices.length,
            textureMapping,
            localZ: layer.z,
            localAABB: { minX, minY, maxX, maxY, minZ, maxZ },
          },
          material,
          file,
        });
      }
    }

    return results;
  }

  /**
   * Create a simple filled box mesh and add it to the node.
   */
  private addFilledBox(
    node: MutableSceneNode,
    x: number,
    y: number,
    w: number,
    h: number,
    z: number,
    material: Material | null,
    uvScaleX: number = 1,
    uvScaleY: number = 1,
  ): void {
    const textureMapping = this.createTextureForMaterial(material);
    const inputLayout = this.getStandardInputLayout();

    // Compute UV scale
    let uvScaleU = 1.0, uvScaleV = 1.0;
    if (material?.file?.buffer) {
      const file = material.file;
      const buffer = file.buffer;
      uvScaleU = file.uScaling * this.po2Scale(buffer.width);
      uvScaleV = file.vScaling * this.po2Scale(buffer.height);
    }

    let u0 = 0;
    let v0 = 0;
    let u1 = uvScaleU * uvScaleX;
    let v1 = uvScaleV * uvScaleY;

    if (u1 < 0) {
      // If the texture scaling is set to clamp, pretend there's a negative copy if we're flipped. Hacky.
      u1 = 1+u1;
      u0 = 1;
    }
    if (v1 < 0) {
      // If the texture scaling is set to clamp, pretend there's a negative copy if we're flipped. Hacky.
      v1 = 1+v1;
      v0 = 1;
    }

    const vertices = new Float32Array([
      x,     y,     z, u0, v1, 1, 1, 1, 1,
      x + w, y,     z, u1, v1, 1, 1, 1, 1,
      x + w, y + h, z, u1, v0, 1, 1, 1, 1,
      x,     y + h, z, u0, v0, 1, 1, 1, 1,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const vbo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Vertex,
      vertices.buffer,
    );
    const ibo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Index,
      indices.buffer,
    );

    node.meshInstances.push({
      node,
      gpuResources: {
        vertexBuffer: vbo,
        indexBuffer: ibo,
        inputLayout,
        vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
        indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
        drawCount: 6,
        textureMapping,
        localZ: z,
        localAABB: {
          minX: x,
          minY: y,
          maxX: x + w,
          maxY: y + h,
          minZ: z,
          maxZ: z,
        },
      },
      material: material ?? undefined,
      file: material?.file ?? undefined,
      isDebug: false,
      renderState: newMeshInstanceRenderState(),
    });
  }

  createTextureForBuffer(buf: BlvBuffer): GfxTexture {
    return this.getOrCreateTexture(buf, () => {
      const format = buf.textureFormat;
      const data = buf.mips[0].data.data;
      const palette = buf.palette ? buf.palette.rawValues : null;
      const decoded = decodeTextureToRGBA(
        format,
        data,
        palette,
        buf.width,
        buf.height,
      );
      const texture = this.device.createTexture(
        makeTextureDescriptor2D(
          GfxFormat.U8_RGBA_NORM,
          buf.width,
          buf.height,
          1,
        ),
      );
      this.device.uploadTextureData(texture, 0, [decoded]);
      return texture;
    });
  }

  getTextureCache(): Map<BlvBuffer, GfxTexture> {
    return this.textureCache;
  }

  getSystemTextureCache(): Map<string, GfxTexture> {
    return this.systemTextureCache;
  }

  // ==================== Overlay/Debug Resources ====================

  private static readonly TEXT_HEIGHT = 40;
  private overlayTextCache = new Map<string, { texture: GfxTexture; textWidthPx: number }>();

  /**
   * Generate an overlay texture containing only the text label.
   * The texture is sized exactly to the text (width x TEXT_HEIGHT).
   * Borders are drawn procedurally by the shader.
   */
  generateOverlayTexture(
    text: string,
    color: Color,
  ): { texture: GfxTexture; textWidthPx: number } {
    const cached = this.overlayTextCache.get(text);
    if (cached) return cached;

    const textHeight = SceneTreeBuilder.TEXT_HEIGHT;

    // Measure text width using a temporary canvas context
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 28px monospace";
    const textWidthPx = Math.ceil(ctx.measureText(text).width) + 8; // +8 for stroke outline

    // Size canvas to fit exactly the text
    canvas.width = textWidthPx;
    canvas.height = textHeight;
    ctx.clearRect(0, 0, textWidthPx, textHeight);

    // Re-set font after canvas resize (canvas resize resets context state)
    ctx.font = "bold 28px monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";

    const centerX = textWidthPx / 2;
    ctx.strokeStyle = `rgba(0, 0, 0, 1)`;
    ctx.lineWidth = 4;
    ctx.strokeText(text, centerX, 6);
    ctx.fillStyle = `rgba(255, 255, 255, 1)`;
    ctx.fillText(text, centerX, 6);

    const imageData = ctx.getImageData(0, 0, textWidthPx, textHeight);
    const rgba = new Uint8Array(imageData.data);

    const texture = this.device.createTexture(
      makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, textWidthPx, textHeight, 1),
    );
    this.device.uploadTextureData(texture, 0, [rgba]);
    const result = { texture, textWidthPx };
    this.overlayTextCache.set(text, result);
    return result;
  }

  /**
   * Overlay color map for debug visualizations
   */
  private static readonly OVERLAY_COLORS: { [key: string]: Color } = {
    area_trigger: colorNewFromRGBA(0xff / 255, 0x57 / 255, 0x33 / 255, 0.6),
    cam_area_trigger: colorNewFromRGBA(0xff / 255, 0x57 / 255, 0x33 / 255, 0.6),
    goalevent: colorNewFromRGBA(0x39 / 255, 0xff / 255, 0x33 / 255, 0.6),
    stay_area: colorNewFromRGBA(0x33 / 255, 0xd7 / 255, 0xff / 255, 0.6),
    cball_detect_area: colorNewFromRGBA(0x33 / 255, 0xd7 / 255, 0xff / 255, 0.6),
    mui_area: colorNewFromRGBA(0x33 / 255, 0xd7 / 255, 0xff / 255, 0.6),
    hint: colorNewFromRGBA(0xf5 / 255, 0x33 / 255, 0xff / 255, 0.6),
    poly_trigger: colorNewFromRGBA(0xff / 255, 0x57 / 255, 0x33 / 255, 0.6),
    toppu: colorNewFromRGBA(1.0, 1.0, 1.0, 0.6),
    kocchi: colorNewFromRGBA(0xf0 / 255, 0xff / 255, 0x33 / 255, 0.6),
    loco_katasa: colorNewFromRGBA(0xf0 / 255, 0xff / 255, 0x33 / 255, 0.6),
    pitching_toppu: colorNewFromRGBA(0xf0 / 255, 0xff / 255, 0x33 / 255, 0.6),
    uneune: colorNewFromRGBA(0xff / 255, 0xee / 255, 0x00 / 255, 0.6),
    uneplus: colorNewFromRGBA(0xff / 255, 0xee / 255, 0x00 / 255, 0.6),
    kaze: colorNewFromRGBA(0x33 / 255, 0xcc / 255, 0xff / 255, 1.0),
    soundline: colorNewFromRGBA(0xff / 255, 0x99 / 255, 0x33 / 255, 1.0),
    kawa: colorNewFromRGBA(0x33 / 255, 0x66 / 255, 0xff / 255, 1.0),
    kunakuna: colorNewFromRGBA(0xff / 255, 0x66 / 255, 0xff / 255, 1.0),
    soundpoint: colorNewFromRGBA(0x33 / 255, 0xcc / 255, 0x33 / 255, 0.6),
    mojya: colorNewFromRGBA(0x96 / 255, 0x96 / 255, 0x96 / 255, 0.6),
    split_immediate: colorNewFromRGBA(0x96 / 255, 0x96 / 255, 0x96 / 255, 0.6),
    pick_area: colorNewFromRGBA(0x96 / 255, 0x96 / 255, 0x96 / 255, 0.6),
    anim_camera: colorNewFromRGBA(0x33 / 255, 0x66 / 255, 0xff / 255, 0.6),
    fixed_camera: colorNewFromRGBA(0x33 / 255, 0x66 / 255, 0xff / 255, 0.6),

    start: colorNewFromRGBA(1.0, 1.0, 0.0, 1.0),
    petton_create: colorNewFromRGBA(0.0, 1.0, 1.0, 1.0),

    camera_offset: colorNewFromRGBA(1.0, 0.0, 0.0, 1.0),

    goalhole: colorNewFromRGBA(1.0, 1.0, 1.0, 1.0),
    pfx_emitter: colorNewFromRGBA(0.0, 1.0, 0.0, 1.0),
    fall_symbol: colorNewFromRGBA(0.0, 0.0, 1.0, 1.0),

    group_range_change: colorNewFromRGBA(1.0, 0.0, 1.0, 1.0),
  };

  private static readonly OVERLAY_COLOR_DEFAULT = colorNewFromRGBA(1, 0, 1, 0.6);

  getOverlayColor(overlayType: string): Color {
    return SceneTreeBuilder.OVERLAY_COLORS[overlayType] || SceneTreeBuilder.OVERLAY_COLOR_DEFAULT;
  }

  /**
   * Create overlay box resources (for debug visualization)
   */
  createOverlayBoxResources(
    overlayType: string,
    minX: number,
    minY: number,
    width: number,
    height: number,
    z: number,
  ): {
    gpuResources: GpuMeshResources;
    debugInfo: { color: Color; label: string };
  } | null {
    const color = this.getOverlayColor(overlayType);
    const inputLayout = this.getStandardInputLayout();

    const vertices = new Float32Array([
      minX,
      minY,
      z,
      0,
      0,
      color.r,
      color.g,
      color.b,
      color.a,
      minX + width,
      minY,
      z,
      1,
      0,
      color.r,
      color.g,
      color.b,
      color.a,
      minX + width,
      minY + height,
      z,
      1,
      1,
      color.r,
      color.g,
      color.b,
      color.a,
      minX,
      minY + height,
      z,
      0,
      1,
      color.r,
      color.g,
      color.b,
      color.a,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const vbo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Vertex,
      vertices.buffer,
    );
    const ibo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Index,
      indices.buffer,
    );

    const overlay = this.generateOverlayTexture(overlayType, color);
    const textureMapping = new TextureMapping();
    textureMapping.gfxTexture = overlay.texture;

    return {
      gpuResources: {
        vertexBuffer: vbo,
        indexBuffer: ibo,
        inputLayout,
        vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
        indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
        drawCount: 6,
        textureMapping,
        localZ: z,
        localAABB: {
          minX,
          minY,
          maxX: minX + width,
          maxY: minY + height,
          minZ: z,
          maxZ: z,
        },
      },
      debugInfo: { color, label: overlayType },
    };
  }

  /**
   * Create overlay circle resources (for debug visualization of circular ranges)
   */
  createOverlayCircleResources(
    overlayType: string,
    radius: number,
    z: number,
  ): {
    gpuResources: GpuMeshResources;
    debugInfo: {
      color: Color;
      label: string;
      textWidthPx: number;
    };
  } | null {
    const color = this.getOverlayColor(overlayType);
    const inputLayout = this.getStandardInputLayout();

    // Quad centered at origin, covering -radius to +radius
    const vertices = new Float32Array([
      -radius,
      -radius,
      z,
      0,
      0,
      color.r,
      color.g,
      color.b,
      color.a,
      radius,
      -radius,
      z,
      1,
      0,
      color.r,
      color.g,
      color.b,
      color.a,
      radius,
      radius,
      z,
      1,
      1,
      color.r,
      color.g,
      color.b,
      color.a,
      -radius,
      radius,
      z,
      0,
      1,
      color.r,
      color.g,
      color.b,
      color.a,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const vbo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Vertex,
      vertices.buffer,
    );
    const ibo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Index,
      indices.buffer,
    );

    const overlay = this.generateOverlayTexture(overlayType, color);
    const textureMapping = new TextureMapping();
    textureMapping.gfxTexture = overlay.texture;

    return {
      gpuResources: {
        vertexBuffer: vbo,
        indexBuffer: ibo,
        inputLayout,
        vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
        indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
        drawCount: 6,
        textureMapping,
        localZ: z,
        localAABB: {
          minX: -radius,
          minY: -radius,
          maxX: radius,
          maxY: radius,
          minZ: z,
          maxZ: z,
        },
      },
      debugInfo: { color, label: overlayType, textWidthPx: overlay.textWidthPx },
    };
  }

  /**
   * Create rotated overlay box resources
   */
  createRotatedOverlayBoxResources(
    overlayType: string,
    cx: number,
    cy: number,
    width: number,
    height: number,
    z: number,
    localRotation: number,
    arrowAngle: number = 999,
  ): {
    gpuResources: GpuMeshResources;
    debugInfo: {
      color: Color;
      label: string;
      arrowDirection: number;
    };
  } | null {
    const color = this.getOverlayColor(overlayType);
    const inputLayout = this.getStandardInputLayout();

    // Calculate rotated corners
    const halfW = width / 2;
    const halfH = height / 2;
    const cos = Math.cos(localRotation);
    const sin = Math.sin(localRotation);

    const corners = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ].map(([lx, ly]) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos]);

    const vertices = new Float32Array([
      corners[0][0],
      corners[0][1],
      z,
      0,
      0,
      color.r,
      color.g,
      color.b,
      color.a,
      corners[1][0],
      corners[1][1],
      z,
      1,
      0,
      color.r,
      color.g,
      color.b,
      color.a,
      corners[2][0],
      corners[2][1],
      z,
      1,
      1,
      color.r,
      color.g,
      color.b,
      color.a,
      corners[3][0],
      corners[3][1],
      z,
      0,
      1,
      color.r,
      color.g,
      color.b,
      color.a,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const vbo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Vertex,
      vertices.buffer,
    );
    const ibo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Index,
      indices.buffer,
    );

    const overlay = this.generateOverlayTexture(overlayType, color);
    const textureMapping = new TextureMapping();
    textureMapping.gfxTexture = overlay.texture;

    // Calculate AABB
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);

    return {
      gpuResources: {
        vertexBuffer: vbo,
        indexBuffer: ibo,
        inputLayout,
        vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
        indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
        drawCount: 6,
        textureMapping,
        localZ: z,
        localAABB: {
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys),
          minZ: z,
          maxZ: z,
        },
      },
      debugInfo: { color, label: overlayType, arrowDirection: arrowAngle },
    };
  }

  /**
   * Create a single picori mesh part (body, eyes, or blob)
   */
  createPicoriMeshResources(
    parsedVerts: MeshVertexA[],
    textureFile: string,
    color: Color,
    localOffsetY: number = 0,
    localOffsetZ: number = 0,
  ): GpuMeshResources | null {
    const inputLayout = this.getStandardInputLayout();

    if (parsedVerts.length < 3) return null;

    const vertices: number[] = [];
    for (const v of parsedVerts) {
      vertices.push(v.x, v.y + localOffsetY, v.z + localOffsetZ);
      vertices.push(v.u / 32768, v.v / 32768);
      vertices.push(color.r, color.g, color.b, color.a);
    }

    // Triangle strip to triangles
    const indices: number[] = [];
    for (let i = 2; i < parsedVerts.length; i++) {
      if (i % 2 === 0) {
        indices.push(i - 2, i - 1, i);
      } else {
        indices.push(i - 2, i, i - 1);
      }
    }

    const vbo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Vertex,
      new Float32Array(vertices).buffer,
    );
    const ibo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Index,
      new Uint16Array(indices).buffer,
    );

    const textureMapping = new TextureMapping();
    textureMapping.gfxTexture = this.getSystemTexture(textureFile);

    // Calculate AABB
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const v of parsedVerts) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y + localOffsetY);
      maxY = Math.max(maxY, v.y + localOffsetY);
      minZ = Math.min(minZ, v.z + localOffsetZ);
      maxZ = Math.max(maxZ, v.z + localOffsetZ);
    }

    return {
      vertexBuffer: vbo,
      indexBuffer: ibo,
      inputLayout,
      vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
      indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
      drawCount: indices.length,
      textureMapping,
      localZ: localOffsetZ,
      localAABB: { minX, minY, maxX, maxY, minZ, maxZ },
    };
  }

  /**
   * Create all picori mesh resources for a coin type
   */
  createPicoriResources(type: string): GpuMeshResources[] {
    const results: GpuMeshResources[] = [];
    const whiteColor: Color = colorNewFromRGBA(1, 1, 1, 1);

    // Body at z=-1
    const bodyRes = this.createPicoriMeshResources(
      PICORI_BODY_VERTS,
      "coin_body.tip",
      whiteColor,
      0,
      -1,
    );
    if (bodyRes) results.push(bodyRes);

    // Eyes at z=+1
    const eyesRes = this.createPicoriMeshResources(
      PICORI_EYES_VERTS,
      "coin_eye.tip",
      whiteColor,
      0,
      1,
    );
    if (eyesRes) results.push(eyesRes);

    // Blob varies by type
    let blobData: MeshVertexA[];
    let blobColor: Color;
    let blobY: number;
    let textureName: string;

    if (type === "coin_one" || type === "kcoin_one") {
      // [kcoin]s are "kakushi coins" (hidden) - can find them in bushes.
      blobData = PICORI_BLOB_1_VERTS;
      blobColor = PICORI_BLOB_1_COLOR;
      textureName = "coin_picori.tip";
      blobY = -2;
    } else if (type === "coin_ten" || type === "kcoin_ten") {
      blobData = PICORI_BLOB_10_VERTS;
      blobColor = PICORI_BLOB_10_COLOR;
      textureName = "coin_picori.tip";
      blobY = -4.6;
    } else if (type === "coin_fifty" || type === "kcoin_fifty") {
      blobData = PICORI_BLOB_50_VERTS;
      blobColor = PICORI_BLOB_50_COLOR;
      textureName = "coin_picori.tip";
      blobY = -2;
    } else if (
      type === "coin_item" ||
      type === "kcoin_item" ||
      type == "mcoin_item" ||
      type == "lscoin_item"
    ) {
      // [kcoin]s are "kakushi coins" (hidden).
      // [coin_item] is too big! See nightmare01.
      blobData = PICORI_BLOB_10_VERTS;
      blobColor = colorNewFromRGBA(1, 1, 1, 1);
      textureName = "coin_item.tip";
      blobY = -4.6;
    } else if (type === "coin_simple") {
      // When locoroco eats this variant, the eyes don't fly away. I think
      // these ones just render with a single quad.
      blobData = PICORI_BLOB_1_VERTS;
      blobColor = PICORI_BLOB_1_COLOR;
      textureName = "coin_picori.tip";
      blobY = -2;
    } else {
      throw Error("Unknown type of coin");
    }

    const blobRes = this.createPicoriMeshResources(
      blobData,
      textureName,
      blobColor,
      blobY,
      0,
    );
    if (blobRes) results.push(blobRes);

    return results;
  }

  // ==================== Hanage Resources ====================

  /**
   * Create hanage mesh resources
   */
  createHanageResources(
    z: number,
    material: Material | null,
  ): GpuMeshResources | null {
    const inputLayout = this.getStandardInputLayout();

    // Hanage geometry from Python: body (0 to 0.7) + head (0.7 to 0.8)
    const headWidth = 0.1;
    const bodyWidth = 0.8 - headWidth; // 0.70

    // Local vertices: 6 vertices forming body + head sections
    const localVerts = [
      [0.0, -1.0, z, 0.0, 0.0], // 0: bottom-left of body
      [0.0, 1.0, z, 0.0, 1.0], // 1: top-left of body
      [bodyWidth, -1.0, z, 0.5, 0.0], // 2: bottom-right of body
      [bodyWidth, 1.0, z, 0.5, 1.0], // 3: top-right of body
      [bodyWidth + headWidth, -1.0, z, 1.0, 0.0], // 4: bottom-right of head
      [bodyWidth + headWidth, 1.0, z, 1.0, 1.0], // 5: top-right of head
    ];

    // Get UV scale and color from material
    let uvScaleU = 1.0,
      uvScaleV = 1.0;
    if (material?.file?.buffer) {
      const file = material.file;
      const buffer = file.buffer;
      uvScaleU = file.uScaling * this.po2Scale(buffer.width);
      uvScaleV = file.vScaling * this.po2Scale(buffer.height);
    }

    // Build vertex buffer in local space
    const vertices = new Float32Array(6 * 9);
    for (let i = 0; i < 6; i++) {
      const v = localVerts[i];
      const offset = i * 9;
      vertices[offset + 0] = v[0]; // x
      vertices[offset + 1] = v[1]; // y
      vertices[offset + 2] = v[2]; // z
      vertices[offset + 3] = v[3] * uvScaleU; // u
      vertices[offset + 4] = v[4] * uvScaleV; // v
      vertices[offset + 5] = 1;
      vertices[offset + 6] = 1;
      vertices[offset + 7] = 1;
      vertices[offset + 8] = 1;
    }

    const indices = new Uint16Array([0, 1, 2, 2, 1, 3, 2, 3, 4, 3, 4, 5]);

    const vbo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Vertex,
      vertices.buffer,
    );
    const ibo = makeStaticDataBuffer(
      this.device,
      GfxBufferUsage.Index,
      indices.buffer,
    );

    const textureMapping = this.createTextureForMaterial(material);

    // Calculate AABB
    const xs = localVerts.map((v) => v[0]);
    const ys = localVerts.map((v) => v[1]);

    return {
      vertexBuffer: vbo,
      indexBuffer: ibo,
      inputLayout,
      vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
      indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
      drawCount: 12,
      textureMapping,
      localZ: z,
      localAABB: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
        minZ: z,
        maxZ: z,
      },
    };
  }

  // ==================== Collision Mesh Resources ====================

  /**
   * Create mesh resources from a PropCollisionMesh
   */
  createCollisionMeshResources(
    collisionMesh: PropCollisionMesh,
  ): GpuMeshResources[] {
    const results: GpuMeshResources[] = [];
    const inputLayout = this.getStandardInputLayout();

    if (!collisionMesh.unk2 || !collisionMesh.vertices) {
      return results;
    }

    const component = collisionMesh.unk2;
    const vertexData = collisionMesh.vertices.data;

    const vertices: number[] = [];
    const indices: number[] = [];

    let uvScaleU = 1.0,
      uvScaleV = 1.0;
    if (component.material?.file?.buffer) {
      const file = component.material.file;
      const buffer = file.buffer;
      uvScaleU = file.uScaling * this.po2Scale(buffer.width);
      uvScaleV = file.vScaling * this.po2Scale(buffer.height);
    }

    // Process all vertices
    for (const v of vertexData) {
      vertices.push(v.x, v.y, v.z);
      vertices.push((v.u / 32768) * uvScaleU, (v.v / 32768) * uvScaleV);
      if (v instanceof MeshVertexB) {
        vertices.push(v.r / 255, v.g / 255, v.b / 255, v.a / 255);
      } else {
        vertices.push(1, 1, 1, 1);
      }
    }

    // Process tristrips
    for (const tristrip of component.tristrips) {
      for (let i = 2; i < tristrip.length; i++) {
        if (i % 2 === 0) {
          indices.push(tristrip[i - 2], tristrip[i - 1], tristrip[i]);
        } else {
          indices.push(tristrip[i - 2], tristrip[i], tristrip[i - 1]);
        }
      }
    }

    if (vertices.length === 0 || indices.length === 0) return results;

    const textureMapping = this.createTextureForMaterial(component.material);

    // Split by Z layers
    const layers = this.splitTrianglesByZLayer(vertices, indices);

    for (const layer of layers) {
      if (layer.triangleIndices.length === 0) continue;

      // Calculate AABB
      let minX = Infinity,
        minY = Infinity,
        minZ = Infinity;
      let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;
      for (const idx of layer.triangleIndices) {
        const x = vertices[idx * 9 + 0];
        const y = vertices[idx * 9 + 1];
        const z = vertices[idx * 9 + 2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }

      const vbo = makeStaticDataBuffer(
        this.device,
        GfxBufferUsage.Vertex,
        new Float32Array(vertices).buffer,
      );
      const ibo = makeStaticDataBuffer(
        this.device,
        GfxBufferUsage.Index,
        new Uint16Array(layer.triangleIndices).buffer,
      );

      results.push({
        vertexBuffer: vbo,
        indexBuffer: ibo,
        inputLayout,
        vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
        indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
        drawCount: layer.triangleIndices.length,
        textureMapping,
        localZ: layer.z,
        localAABB: { minX, minY, maxX, maxY, minZ, maxZ },
      });
    }

    return results;
  }

  // ==================== Spring Mesh Resources ====================

  /**
   * Create mesh resources from a PropSpring
   */
  createSpringResources(spring: PropSpring): MeshEntry[] {
    const results: MeshEntry[] = [];
    const inputLayout = this.getStandardInputLayout();

    for (const collisionMesh of spring.unk2) {
      const material = collisionMesh.material;
      if (!material) continue;

      let uvScaleU = 1.0,
        uvScaleV = 1.0;
      if (material.file?.buffer) {
        const file = material.file;
        const buffer = file.buffer;
        uvScaleU = file.uScaling * this.po2Scale(buffer.width);
        uvScaleV = file.vScaling * this.po2Scale(buffer.height);
      }

      // Build vertices from spring.unk4
      const localVerts: {
        x: number;
        y: number;
        z: number;
        u: number;
        v: number;
      }[] = [];
      for (const vert of spring.unk4) {
        localVerts.push({
          x: vert.x,
          y: vert.y,
          z: vert.z,
          u: (vert.u / 32768) * uvScaleU,
          v: (vert.v / 32768) * uvScaleV,
        });
      }

      // Convert tristrips to triangles
      const triangleIndices: number[] = [];
      for (const tristrip of collisionMesh.tristrips) {
        for (let i = 2; i < tristrip.length; i++) {
          if (i % 2 === 0) {
            triangleIndices.push(tristrip[i - 2], tristrip[i - 1], tristrip[i]);
          } else {
            triangleIndices.push(tristrip[i - 2], tristrip[i], tristrip[i - 1]);
          }
        }
      }

      if (triangleIndices.length === 0) continue;

      // Split by Z layer
      const layers = new Map<number, number[]>();
      for (let i = 0; i < triangleIndices.length; i += 3) {
        const i0 = triangleIndices[i];
        const z = localVerts[i0].z;
        if (!layers.has(z)) layers.set(z, []);
        layers
          .get(z)!
          .push(
            triangleIndices[i],
            triangleIndices[i + 1],
            triangleIndices[i + 2],
          );
      }

      // Build vertex buffer
      const vertices = new Float32Array(localVerts.length * 9);
      for (let i = 0; i < localVerts.length; i++) {
        const v = localVerts[i];
        const offset = i * 9;
        vertices[offset + 0] = v.x;
        vertices[offset + 1] = v.y;
        vertices[offset + 2] = v.z;
        vertices[offset + 3] = v.u;
        vertices[offset + 4] = v.v;
        vertices[offset + 5] = 1;
        vertices[offset + 6] = 1;
        vertices[offset + 7] = 1;
        vertices[offset + 8] = 1;
      }

      const textureMapping = this.createTextureForMaterial(material);

      for (const [localZ, layerIndices] of Array.from(layers)) {
        // Calculate AABB
        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity;
        for (const idx of layerIndices) {
          const v = localVerts[idx];
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
          minZ = Math.min(minZ, v.z);
          maxZ = Math.max(maxZ, v.z);
        }

        const vbo = makeStaticDataBuffer(
          this.device,
          GfxBufferUsage.Vertex,
          vertices.buffer,
        );
        const ibo = makeStaticDataBuffer(
          this.device,
          GfxBufferUsage.Index,
          new Uint16Array(layerIndices).buffer,
        );

        results.push({
          gpuResources: {
            vertexBuffer: vbo,
            indexBuffer: ibo,
            inputLayout,
            vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
            indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
            drawCount: layerIndices.length,
            textureMapping,
            localZ,
            localAABB: { minX, minY, maxX, maxY, minZ, maxZ },
          },
          material,
          file: material.file ?? undefined,
        });
      }
    }

    return results;
  }

  // ==================== Scene Tree Construction ====================

  build(): SceneTree {
    const rootNode = this.createRootNode();

    let collisionPolygon: Polygon | null = null;
    if (
      this.blvFile.root instanceof RootObject &&
      this.blvFile.root.collision
    ) {
      collisionPolygon = this.blvFile.root.collision;
    }

    // Pre-upload all AnimationTrackFileType0 frame textures so the renderer
    // never needs to call back into the builder at runtime.
    this.preUploadAnimationTextures(rootNode);

    return {
      root: rootNode,
      collisionPolygon,
      textures: this.getTextureCache(),
    };
  }

  private preUploadAnimationTextures(node: SceneNode): void {
    for (const anim of node.animations) {
      for (const fileTrackPtr of anim.namedPart.part.fileAnimationTracks) {
        const track = fileTrackPtr.track;
        if (track instanceof AnimationTrackFileSwitch) {
          for (const bufPtr of track.data) {
            if (bufPtr instanceof BufferPtr && bufPtr.buffer) {
              this.createTextureForBuffer(bufPtr.buffer);
            }
          }
        }
      }
    }
    for (const child of node.children) {
      this.preUploadAnimationTextures(child);
    }
  }

  private createRootNode(): MutableSceneNode {
    const root: MutableSceneNode = {
      owner: this.blvFile.root,
      renderState: newSceneNodeRenderState(),
      baseTransform: {
        posX: 0,
        posY: 0,
        posZ: 0,
        rotZ: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
      },
      baseVisibility: true,
      objectType: "root",
      objectPath: "",
      name: "root",
      meshInstances: [],
      pathLines: [],

      parent: null,
      animations: [],
      children: [],
    };

    if (this.blvFile.root instanceof RootObject) {
      // Add LevelGrid meshes as children
      if (this.blvFile.root.levelGrid) {
        const levelGridNode = this.createLevelGridNode(this.blvFile.root.levelGrid);
        levelGridNode.parent = root;
        root.children.push(levelGridNode);
      }

      // Add SubRoot objects as children
      if (this.blvFile.root.subRoot) {
        const subRootNode = this.createSubRootNode(
          this.blvFile.root.subRoot,
          "subRoot",
        );
        subRootNode.parent = root;
        root.children.push(subRootNode);
      }
    } else if (this.blvFile.root instanceof SubRoot) {
      // Root is a SubRoot directly
      const subRootNode = this.createSubRootNode(this.blvFile.root, "root");
      subRootNode.parent = root;
      root.children.push(subRootNode);
    }

    return root;
  }

  private createLevelGridNode(levelGrid: any): MutableSceneNode {
    const node: MutableSceneNode = {
      owner: null,
      renderState: newSceneNodeRenderState(),
      baseTransform: {
        posX: 0,
        posY: 0,
        posZ: 0,
        rotZ: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
      },
      baseVisibility: true,
      objectType: "levelGrid",
      objectPath: "_LevelGrid",
      name: "LevelGrid",
      meshInstances: [],
      pathLines: [],

      parent: null,
      animations: [],
      children: [],
    };

    // Collect all LevelGrid meshes and create merged resources
    const allLevelGridMeshes: Mesh[] = [];
    for (const meshPtr of levelGrid.meshGrid) {
      if (meshPtr.mesh) {
        allLevelGridMeshes.push(meshPtr.mesh);
      }
    }
    const resources = this.createMeshResources(allLevelGridMeshes, true);
    for (const { gpuResources } of resources) {
      node.meshInstances.push({ node, gpuResources, isDebug: false, 
        renderState: newMeshInstanceRenderState() });
    }

    return node;
  }

  private createSubRootNode(
    subRoot: SubRoot,
    pathPrefix: string,
    miSubRoot?: SubRoot,
  ): MutableSceneNode {
    // Collect animations from this SubRoot
    const animations: NodeAnimation[] = [];
    if (subRoot.animations) {
      for (const animPtr of subRoot.animations.animations) {
        if (animPtr.animation?.namedPart?.part && subRoot.object) {
          animations.push({
            namedPart: animPtr.animation.namedPart,
            currentTime: 0,
            trackTimes: new Map(),
            isActive: false,
            isPlaying: false,
          });
        }
      }

      // Auto-play rules for SubRoot animations
      // Only one animation can be active per node; first match wins.
      let animationIdx = 0;
      for (let i = 0; i < animations.length; i++) {
        const anim = animations[i];
        if (
          anim.namedPart.name == "*first*" ||
          anim.namedPart.name == "idle" ||
          anim.namedPart.name == "sleep" ||
          anim.namedPart.name == "search"
        ) {
          animationIdx = i;
          break;
        }
      }
      if (animations.length > 0) {
        const anim = animations[animationIdx];
        anim.isActive = true;
        anim.isPlaying = true;
      }
    }

    const node: MutableSceneNode = {
      owner: subRoot.object,
      renderState: newSceneNodeRenderState(),
      baseTransform: {
        posX: 0,
        posY: 0,
        posZ: 0,
        rotZ: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
      },
      baseVisibility: true,
      objectType: "subRoot",
      objectPath: pathPrefix,
      name: pathPrefix,
      meshInstances: [],
      pathLines: [],

      parent: null,
      animations,
      children: [],
    };

    // Create child nodes from the SubRoot's object tree
    // Animations are NOT inherited - they are discovered during the DFS walk in updateAnimations
    if (subRoot.object) {
      const childNode = this.createLocoObjectNode(
        subRoot.object,
        pathPrefix,
        miSubRoot,
      );
      childNode.parent = node;
      node.children.push(childNode);
    }

    return node;
  }

  private createLocoObjectNode(
    obj: LocoObject,
    parentPath: string,
    miSubRoot?: SubRoot,
  ): MutableSceneNode {
    const objectType = obj.objectType || "";
    const currentPath = parentPath
      ? `${parentPath}|${obj.name}`
      : obj.name || "(unnamed)";

    // Build local transformation matrix
    const localMatrix = mat4.create();
    let posX = 0,
      posY = 0,
      posZ = 0;
    let rotZ = 0;
    let scaleX = 1,
      scaleY = 1,
      scaleZ = 1;

    const pos = obj.getProperty("pos");
    if (pos instanceof Vec2) {
      posX = pos.x;
      posY = pos.y;
    } else if (pos instanceof Vec3) {
      posX = pos.x;
      posY = pos.y;
      posZ = pos.z;
    }

    const scale = obj.getProperty("scale");
    if (scale instanceof Vec3) {
      scaleX = scale.x;
      scaleY = scale.y;
      scaleZ = scale.z;
    }

    const rotZProp = obj.getProperty("rotZ");
    if (rotZProp !== null) {
      rotZ = rotZProp;
    }

    if (objectType === "coin_item") {
      scaleX *= 0.3;
      scaleY *= 0.3;
      scaleZ *= 0.3;
      posY += 5;
    }

    // Build local matrix: T * R * S
    mat4.translate(localMatrix, localMatrix, [posX, posY, posZ]);
    mat4.rotateZ(localMatrix, localMatrix, rotZ);
    mat4.scale(localMatrix, localMatrix, [scaleX, scaleY, scaleZ]);

    // Collect animations that directly attach to this object (per-object animations)
    const nodeAnimations: NodeAnimation[] = [];
    if (obj.animation?.part) {
      // 'moving' objects are triggered by signals
      const shouldPlay = true; // obj.objectType != 'moving';
      nodeAnimations.push({
        namedPart: obj.animation,
        currentTime: 0,
        trackTimes: new Map(),
        isActive: shouldPlay,
        isPlaying: shouldPlay,
      });
    }

    const baseVisibility = obj.getProperty("visibility") !== false;

    const node: MutableSceneNode = {
      owner: obj,
      renderState: newSceneNodeRenderState(),
      baseTransform: { posX, posY, posZ, rotZ, scaleX, scaleY, scaleZ },
      baseVisibility,
      objectType,
      objectPath: currentPath,
      name: obj.name || "(unnamed)",
      meshInstances: [],
      pathLines: [],

      parent: null,
      animations: nodeAnimations,
      children: [],
    };

    // Create mesh instances from obj's mesh property
    const mesh = obj.getProperty("mesh");
    if (mesh instanceof Mesh) {
      const resources = this.createMeshResources([mesh]);
      for (const { gpuResources, material, file } of resources) {
        node.meshInstances.push({
          node,
          gpuResources,
          isDebug: false,
          material,
          file,
          renderState: newMeshInstanceRenderState(),
        });
      }
    }

    // Handle special object types
    this.handleSpecialObjectType(node, obj, objectType, scaleY);

    // Process SubRoot properties (nested SubRoots)
    if (objectType.startsWith("mi_")) {
      // For mi_ objects: find the 'mi' SubRoot, pass it into 'treeObject' so it
      // gets instantiated at each 'child_spot', and skip all other SubRoot properties.
      let miPropSubRoot: SubRoot | undefined;
      for (const prop of obj.properties) {
        if (prop.name === "miObject") {
          if (!(prop.value instanceof SubRoot))
            throw new Error(
              `Expected 'miObject' property to be a SubRoot, got ${typeof prop.value}`,
            );
          miPropSubRoot = prop.value;
          break;
        }
      }
      for (const prop of obj.properties) {
        if (prop.value instanceof SubRoot && prop.name === "treeObject") {
          const subRootNode = this.createSubRootNode(
            prop.value,
            `${currentPath}|treeObject`,
            miPropSubRoot,
          );
          subRootNode.parent = node;
          node.children.push(subRootNode);
        }
      }
    } else if (objectType === "bottyoro") {
      // For bottyoro objects, only show the 'object' property, skip 'togeObject'
      for (const prop of obj.properties) {
        if (prop.value instanceof SubRoot && prop.name === "object") {
          const subRootNode = this.createSubRootNode(
            prop.value,
            `${currentPath}|object`,
            miSubRoot,
          );
          subRootNode.parent = node;
          node.children.push(subRootNode);
        }
      }
    } else {
      for (const prop of obj.properties) {
        if (prop.value instanceof SubRoot) {
          const subRootNode = this.createSubRootNode(
            prop.value,
            `${currentPath}|${prop.name || "subroot"}`,
            miSubRoot,
          );
          subRootNode.parent = node;
          node.children.push(subRootNode);
        }
      }
    }

    // Instantiate the mi* object at child_spot positions
    if (objectType === "child_spot" && miSubRoot !== undefined) {
      const miNode = this.createSubRootNode(
        miSubRoot,
        `${currentPath}|miObject`,
      );
      miNode.parent = node;
      node.children.push(miNode);
    }

    // Process children - animations are NOT inherited, discovered during DFS walk
    for (const childPtr of obj.children) {
      if (childPtr.object) {
        const childNode = this.createLocoObjectNode(
          childPtr.object,
          currentPath,
          miSubRoot,
        );
        childNode.parent = node;
        node.children.push(childNode);
      }
    }

    return node;
  }

  /**
   * Handle special object types that need custom mesh creation (hana, coins, water, etc.)
   */
  private handleSpecialObjectType(
    node: MutableSceneNode,
    obj: LocoObject,
    objectType: string,
    scaleY: number,
  ): void {
    if (objectType === "hana") {
      const hanaMat = obj.getProperty("hana_mat");
      const kukiMat = obj.getProperty("kuki_mat");
      const happaMat = obj.getProperty("happa_mat");

      if (
        hanaMat instanceof MaterialPtr &&
        kukiMat instanceof MaterialPtr &&
        happaMat instanceof MaterialPtr
      ) {
        const hanaBoxRealHeight = 15 / scaleY;
        const happaBoxRealHeight = 30 / scaleY;

        this.addFilledBox(node,
          -30.2,
          98.3 - hanaBoxRealHeight / 2,
          60,
          hanaBoxRealHeight,
          0,
          hanaMat.material,
          -1,
          -1,
        );
        this.addFilledBox(node,
          -1.0,
          0.0,
          2,
          100,
          -1,
          kukiMat.material,
          1,
          -1,
        );
        this.addFilledBox(node,
          -33.6,
          0.38 - happaBoxRealHeight / 10,
          60,
          happaBoxRealHeight,
          0,
          happaMat.material,
          1,
          -1,
        );
      }
    } else if (objectType === "water") {
      const colmat = obj.getProperty("colmat");
      let material: Material | null = null;
      if (colmat instanceof MaterialPtr && colmat.material) {
        material = colmat.material;
      } else if (
        Array.isArray(colmat) &&
        colmat.length > 0 &&
        colmat[0] instanceof MaterialPtr
      ) {
        material = colmat[0].material;
      }
      if (material) {
        this.addFilledBox(node,
          -50,
          -100,
          100,
          100,
          0,
          material,
          1,
          1,
        );
      }
    } else if (objectType === "rope") {
      const tsuruMat = obj.getProperty("tsuru_mat");
      const sentanMat = obj.getProperty("sentan_mat");
      if (tsuruMat instanceof MaterialPtr && sentanMat instanceof MaterialPtr) {
        const ropeWidth = 15;
        const ropeHeight = 100;
        const sentanHeight = 7.5;
        this.addFilledBox(node,
          -ropeWidth / 2,
          -ropeHeight,
          ropeWidth,
          ropeHeight,
          0,
          tsuruMat.material,
          -1,
          (ropeHeight / ropeWidth) * 0.9,
        );
        this.addFilledBox(node,
          -ropeWidth / 2,
          -ropeHeight - sentanHeight,
          ropeWidth,
          sentanHeight,
          0,
          sentanMat.material,
          1,
          -1,
        );
      }
    } else if (
      objectType === "coin_one" ||
      objectType === "kcoin_one" ||
      objectType === "coin_ten" ||
      objectType === "kcoin_ten" ||
      objectType === "coin_fifty" ||
      objectType === "kcoin_fifty" ||
      objectType === "coin_item" ||
      objectType === "kcoin_item" ||
      objectType === "mcoin_item" ||
      objectType === "lscoin_item" ||
      objectType === "coin_simple"
    ) {
      // Picori (coins)
      const resources = this.createPicoriResources(objectType);
      for (const res of resources) {
        node.meshInstances.push({ gpuResources: res, isDebug: false, renderState: newMeshInstanceRenderState(), node });
      }
    } else if (objectType === "anim_camera" || objectType === "fixed_camera") {
      // Camera overlay
      const orthographicWidth = obj.getProperty("orthographicWidth");
      if (typeof orthographicWidth === "number") {
        const result = this.createOverlayBoxResources(
          objectType,
          -orthographicWidth / 2,
          -orthographicWidth / 2,
          orthographicWidth,
          orthographicWidth,
          0,
        );
        if (result) {
          node.meshInstances.push({
            node,
            gpuResources: result.gpuResources,
            isDebug: true,
            debugLabel: result.debugInfo.label,
            debugColor: result.debugInfo.color,
            debugWorldWidth: orthographicWidth,
            debugWorldHeight: orthographicWidth,
            renderState: newMeshInstanceRenderState(),
          });
        }
      }
    } else if (objectType === "area_trigger" || objectType === "poly_trigger") {
      const shoriBox = obj.getProperty("shori_box");
      if (shoriBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, shoriBox);
      }
    } else if (objectType === "cam_area_trigger") {
      const boundingBox = obj.getProperty("bounding_box");
      if (boundingBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, boundingBox);
      }
    } else if (objectType === "goalevent") {
      const eventBox = obj.getProperty("event_box");
      if (eventBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, eventBox);
      }
    } else if (objectType === "stay_area" || objectType === "mui_area") {
      const stayBox = obj.getProperty("stay_box");
      if (stayBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, stayBox);
      }
      if (objectType === "mui_area") {
        this.addCrossMarkerFromProperty(node, obj, "mui_pos", objectType);
      }
    } else if (objectType === "cball_detect_area") {
      const detectBox = obj.getProperty("detect_box");
      if (detectBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, detectBox);
      }
    } else if (objectType === "hint") {
      const hintBox = obj.getProperty("hint_box");
      if (hintBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, hintBox);
      }
      this.addCrossMarkerAtOrigin(node, objectType);
    } else if (
      objectType === "toppu" ||
      objectType === "kocchi" ||
      objectType === "loco_katasa" ||
      objectType === "pitching_toppu"
    ) {
      const rotrect = obj.getProperty("rotrect");
      if (rotrect instanceof RotRect) {
        const x1 = rotrect.x1,
          y1 = rotrect.y1;
        const x2 = rotrect.x2,
          y2 = rotrect.y2;
        const width = rotrect.width;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const height = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
        const rot = Math.atan2(y2 - y1, x2 - x1) - Math.PI / 2;

        let arrowAngle = 999;
        if (
          objectType === "toppu" ||
          objectType === "kocchi" ||
          objectType === "pitching_toppu"
        ) {
          const direction = obj.getProperty("direction");
          // direction is in world space — undo the box and object rotations
          const objRotZ = obj.getProperty("rotZ") ?? 0;
          arrowAngle =
            typeof direction === "number"
              ? -direction + rot + objRotZ
              : Math.PI;
        }

        const result = this.createRotatedOverlayBoxResources(
          objectType,
          cx,
          cy,
          width * 2,
          height,
          0,
          rot,
          arrowAngle,
        );
        if (result) {
          node.meshInstances.push({
            node,
            gpuResources: result.gpuResources,
            isDebug: true,
            debugLabel: result.debugInfo.label,
            debugColor: result.debugInfo.color,
            debugWorldWidth: width * 2,
            debugWorldHeight: height,
            debugArrowDirection: result.debugInfo.arrowDirection,
            renderState: newMeshInstanceRenderState(),
          });
        }
      }
    } else if (objectType === "uneune" || objectType === "uneplus") {
      // Collision mesh
      const collisionMesh = obj.getProperty("collisionmesh");
      if (collisionMesh instanceof PropCollisionMesh) {
        const mat = collisionMesh.unk2?.material;
        const resources = this.createCollisionMeshResources(collisionMesh);
        for (const res of resources) {
          node.meshInstances.push({ node, gpuResources: res, isDebug: false, material: mat ?? undefined, file: mat?.file ?? undefined, renderState: newMeshInstanceRenderState() });
        }
      }
      // Overlay box
      const uneBox = obj.getProperty("une_box");
      if (uneBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, uneBox);
      }
    } else if (objectType === "mojya") {
      const chaseBox = obj.getProperty("chase_box");
      const boundingBox = obj.getProperty("bounding_box");
      if (chaseBox instanceof Box) {
        this.addOverlayBoxFromBox(node, "mojya", chaseBox);
      }
      if (boundingBox instanceof Box) {
        this.addOverlayBoxFromBox(node, "mojya", boundingBox);
      }
    } else if (objectType === "hanage") {
      // Hanage (hair) object
      const material = obj.getProperty("material");
      if (material instanceof MaterialPtr && material.material) {
        const mat = material.material;
        const res = this.createHanageResources(0, mat);
        if (res) node.meshInstances.push({ node, gpuResources: res, isDebug: false, material: mat, file: mat.file ?? undefined, renderState: newMeshInstanceRenderState() });
      }
    } else if (objectType === "oneway") {
      const material = obj.getProperty("material");
      if (material instanceof MaterialPtr && material.material) {
        this.addFilledBox(node,
          -40,
          0,
          80,
          -40,
          0,
          material.material,
        );
      }
    } else if (objectType === "trampoline") {
      // Trampoline: filled box with material texture
      const material = obj.getProperty("material");
      if (material instanceof MaterialPtr && material.material) {
        const scale = obj.getProperty("scale");
        const scaleX = scale instanceof Vec3 ? scale.x : 1;
        this.addFilledBox(node,
          -40,
          -5,
          80,
          5,
          0,
          material.material,
          8.0 * scaleX,
          -1,
        );
      }
    } else if (
      objectType === "cball" ||
      objectType === "jumpbody" ||
      objectType === "softstage" ||
      objectType === "softbody"
    ) {
      // Collision mesh objects
      const collisionMesh = obj.getProperty("collisionmesh");
      if (collisionMesh instanceof PropCollisionMesh) {
        const mat = collisionMesh.unk2?.material;
        const resources = this.createCollisionMeshResources(collisionMesh);
        for (const res of resources) {
          node.meshInstances.push({ node, gpuResources: res, isDebug: false, material: mat ?? undefined, file: mat?.file ?? undefined, renderState: newMeshInstanceRenderState() });
        }
      }
    } else if (objectType === "bane") {
      // Spring object
      const spring = obj.getProperty("spring");
      if (spring instanceof PropSpring) {
        const resources = this.createSpringResources(spring);
        for (const { gpuResources, material, file } of resources) {
          node.meshInstances.push({
            node,
            gpuResources,
            isDebug: false,
            material,
            file,
            renderState: newMeshInstanceRenderState(),
          });
        }
      }
    } else if (
      objectType === "kaze" ||
      objectType === "soundline" ||
      objectType === "kawa" ||
      objectType === "kunakuna"
    ) {
      // Path-based objects: wind, sound line, river
      const path = obj.getProperty("path");
      if (Array.isArray(path) && path.length >= 2) {
        const color = this.getOverlayColor(objectType);
        const points = path
          .filter((p: any) => p instanceof Vec2)
          .map((p: Vec2) => ({ x: p.x, y: p.y }));
        if (points.length >= 2) {
          const gpuResources = buildLineQuadMeshFromPoints(this.renderCache, [points]);
          if (gpuResources) {
            node.pathLines.push({ node, strips: [points], color, dontScale: false, gpuResources, renderState: newPathLineRenderState() });
          }
        }
      }
    } else if (
      objectType === "start" ||
      objectType === "goalhole" ||
      objectType === "camera_offset" ||
      objectType === "pfx_emitter" ||
      objectType === "fall_symbol" ||
      objectType === "petton_create" ||
      objectType === "group_range_change" ||
      objectType === "petton_count"
    ) {
      // Simple cross marker at origin
      this.addCrossMarkerAtOrigin(node, objectType);
    } else if (objectType === "soundpoint") {
      // Sound point: circular range overlay
      const maxRange = obj.getProperty("max_range");
      if (typeof maxRange === "number" && maxRange > 0) {
        const result = this.createOverlayCircleResources(
          objectType,
          maxRange,
          0,
        );
        if (result) {
          const diameter = maxRange * 2;
          node.meshInstances.push({
            node,
            gpuResources: result.gpuResources,
            isDebug: true,
            debugLabel: result.debugInfo.label,
            debugColor: result.debugInfo.color,
            debugWorldWidth: diameter,
            debugWorldHeight: diameter,
            debugIsCircle: true,
            debugTextWidthPx: result.debugInfo.textWidthPx,
            renderState: newMeshInstanceRenderState(),
          });
        }
      }
    } else if (objectType === "split_immediate") {
      const boundingBox = obj.getProperty("bounding_box");
      if (boundingBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, boundingBox);
      }
    } else if (objectType === "pick_area") {
      const pickBox = obj.getProperty("pick_box");
      if (pickBox instanceof Box) {
        this.addOverlayBoxFromBox(node, objectType, pickBox);
      }
    }
  }

  /**
   * Helper to add an overlay box from a Box property
   */
  private addOverlayBoxFromBox(
    node: MutableSceneNode,
    overlayType: string,
    box: Box,
  ): void {
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    const z = (box.minZ + box.maxZ) / 2;
    const result = this.createOverlayBoxResources(
      overlayType,
      box.minX,
      box.minY,
      width,
      height,
      z,
    );
    if (result) {
      node.meshInstances.push({
        node,
        gpuResources: result.gpuResources,
        isDebug: true,
        debugLabel: result.debugInfo.label,
        debugColor: result.debugInfo.color,
        debugWorldWidth: width,
        debugWorldHeight: height,
        renderState: newMeshInstanceRenderState(),
      });
    }
  }

  /** Add a cross marker PathLine at a Vec2/Vec3 property position. */
  private addCrossMarkerFromProperty(
    node: MutableSceneNode,
    obj: LocoObject,
    propName: string,
    overlayType: string,
  ): void {
    const pos = obj.getProperty(propName);
    if (pos instanceof Vec2) {
      this.addCrossMarkerAt(node, overlayType, pos.x, pos.y);
    } else if (pos instanceof Vec3) {
      this.addCrossMarkerAt(node, overlayType, pos.x, pos.y);
    }
  }

  /** Add a cross marker PathLine at the node's local origin. */
  private addCrossMarkerAtOrigin(node: MutableSceneNode, overlayType: string): void {
    this.addCrossMarkerAt(node, overlayType, 0, 0);
  }

  private addCrossMarkerAt(node: MutableSceneNode, overlayType: string, x: number, y: number): void {
    const s = CROSS_MARKER_SIZE;
    const color = colorNewCopy(this.getOverlayColor(overlayType), 1.0);
    const strips = [
      [{ x: x - s, y: y - s }, { x: x + s, y: y + s }],
      [{ x: x + s, y: y - s }, { x: x - s, y: y + s }],
    ];
    // Share GPU resources for origin crosses; build unique for offset ones
    let gpuResources = buildLineQuadMeshFromPoints(this.renderCache, strips);
    if (gpuResources) {
      node.pathLines.push({ node, strips, color, dontScale: true, gpuResources, renderState: newPathLineRenderState() });
    }
  }
}

export function buildSceneTree(
  device: GfxDevice,
  renderCache: GfxRenderCache,
  whiteFallbackTexture: GfxTexture,
  systemArc: Garc,
  blvFile: BlvFile,
): SceneTree {
  return new SceneTreeBuilder(
    device,
    renderCache,
    whiteFallbackTexture,
    systemArc,
    blvFile,
  ).build();
}
