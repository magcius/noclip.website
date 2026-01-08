import { mat4, quat, vec3 } from "gl-matrix";
import type { CameraController } from "../Camera.js";
import type { DataFetcher } from "../DataFetcher.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import {
  makeBackbufferDescSimple,
  standardFullClearRenderPassDescriptor,
} from "../gfx/helpers/RenderGraphHelpers.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import {
  fillMatrix4x4,
  fillVec4,
} from "../gfx/helpers/UniformBufferHelpers.js";
import {
  type GfxBindingLayoutDescriptor,
  GfxBlendFactor,
  GfxBlendMode,
  type GfxBuffer,
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  GfxCompareMode,
  GfxCullMode,
  type GfxDevice,
  GfxFormat,
  type GfxInputLayout,
  GfxMipFilterMode,
  type GfxProgram,
  type GfxSampler,
  GfxTexFilterMode,
  type GfxTexture,
  GfxVertexBufferFrequency,
  GfxWrapMode,
  makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import {
  GfxRendererLayer,
  GfxRenderInstList,
  makeSortKey,
} from "../gfx/render/GfxRenderInstManager.js";
import { TextureMapping } from "../TextureHolder.js";
import type * as Viewer from "../viewer.js";
import type { BAMFile } from "./bam.js";
import { ColorAttrib, ColorType } from "./nodes/ColorAttrib.js";
import type { Geom } from "./nodes/Geom.js";
import type { GeomNode } from "./nodes/GeomNode.js";
import type { GeomPrimitive } from "./nodes/GeomPrimitive.js";
import type { GeomVertexArrayData } from "./nodes/GeomVertexArrayData.js";
import type { GeomVertexArrayFormat } from "./nodes/GeomVertexArrayFormat.js";
import type { GeomVertexData } from "./nodes/GeomVertexData.js";
import type { GeomVertexFormat } from "./nodes/GeomVertexFormat.js";
import { Contents, NumericType } from "./nodes/geomEnums.js";
import type { InternalName } from "./nodes/InternalName.js";
import type { PandaNode } from "./nodes/PandaNode.js";
import type { RenderState } from "./nodes/RenderState.js";
import { Texture } from "./nodes/Texture.js";
import { TextureAttrib } from "./nodes/TextureAttrib.js";
import type { TransformState } from "./nodes/TransformState.js";
import {
  TransparencyAttrib,
  TransparencyMode,
} from "./nodes/TransparencyAttrib.js";
import { CompressionMode, FilterType, WrapMode } from "./nodes/textureEnums.js";
import { ToontownProgram } from "./program.js";
import type { ToontownResourceLoader } from "./resources.js";
import {
  decodeImage,
  expandToRGBA,
  getImageFormat,
  mergeAlphaChannel,
} from "./textures.js";

export const pathBase = "Toontown";

// Binding layout: 2 uniform buffers (scene params, draw params), 1 sampler
const bindingLayouts: GfxBindingLayoutDescriptor[] = [
  { numUniformBuffers: 2, numSamplers: 1 },
];

// Coordinate system conversion: Panda3D Z-up to noclip Y-up
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
 * Material properties extracted from RenderState
 */
interface MaterialData {
  colorType: ColorType;
  flatColor: [number, number, number, number];
  transparencyMode: TransparencyMode;
  textureRef: number | null;
}

/**
 * Collected geometry ready for rendering
 */
interface CollectedGeometry {
  geom: Geom;
  geomNode: GeomNode;
  renderState: RenderState | null;
  netTransform: mat4;
}

/**
 * GPU-ready geometry data
 */
interface ToontownGeometryData {
  vertexBuffer: GfxBuffer;
  indexBuffer: GfxBuffer | null;
  inputLayout: GfxInputLayout;
  indexCount: number;
  indexFormat: GfxFormat;
  hasNormals: boolean;
  hasColors: boolean;
  hasTexCoords: boolean;
  modelMatrix: mat4;
  material: MaterialData;
  textureMapping: TextureMapping;
}

/**
 * Convert TransformState to mat4
 */
function transformStateToMat4(state: TransformState | null, out: mat4): void {
  if (state === null || state.isIdentity) {
    mat4.identity(out);
    return;
  }

  // If matrix is directly available, use it
  if (state.matrix.length === 16) {
    // Panda3D stores matrices in row-major order, gl-matrix uses column-major
    mat4.set(
      out,
      state.matrix[0],
      state.matrix[4],
      state.matrix[8],
      state.matrix[12],
      state.matrix[1],
      state.matrix[5],
      state.matrix[9],
      state.matrix[13],
      state.matrix[2],
      state.matrix[6],
      state.matrix[10],
      state.matrix[14],
      state.matrix[3],
      state.matrix[7],
      state.matrix[11],
      state.matrix[15],
    );
    return;
  }

  // Compose from components
  const pos = vec3.fromValues(
    state.position[0],
    state.position[1],
    state.position[2],
  );
  const scale = vec3.fromValues(state.scale[0], state.scale[1], state.scale[2]);

  // Convert quaternion or euler angles to quaternion
  const q = quat.create();
  if (
    state.quaternion[0] !== 0 ||
    state.quaternion[1] !== 0 ||
    state.quaternion[2] !== 0 ||
    state.quaternion[3] !== 1
  ) {
    // Panda3D quaternion is (i, j, k, r) = (x, y, z, w)
    quat.set(
      q,
      state.quaternion[0],
      state.quaternion[1],
      state.quaternion[2],
      state.quaternion[3],
    );
  } else if (
    state.rotation[0] !== 0 ||
    state.rotation[1] !== 0 ||
    state.rotation[2] !== 0
  ) {
    // HPR (heading, pitch, roll) to quaternion
    // Panda3D: H = rotation around Z, P = rotation around X, R = rotation around Y
    const h = (state.rotation[0] * Math.PI) / 180;
    const p = (state.rotation[1] * Math.PI) / 180;
    const r = (state.rotation[2] * Math.PI) / 180;

    // Create quaternion from HPR (Panda3D order)
    const qH = quat.create();
    quat.setAxisAngle(qH, [0, 0, 1], h);
    const qP = quat.create();
    quat.setAxisAngle(qP, [1, 0, 0], p);
    const qR = quat.create();
    quat.setAxisAngle(qR, [0, 1, 0], r);
    quat.multiply(q, qH, qP);
    quat.multiply(q, q, qR);
  }

  mat4.fromRotationTranslationScale(out, q, pos, scale);

  // TODO: Handle shear if needed
}

/**
 * Map Panda3D NumericType and component count to GfxFormat
 */
function getGfxFormat(
  numericType: NumericType,
  numComponents: number,
  contents: Contents,
): GfxFormat {
  // Handle color as normalized
  const isColor = contents === Contents.Color;

  switch (numericType) {
    case NumericType.F32:
    case NumericType.StdFloat:
      switch (numComponents) {
        case 1:
          return GfxFormat.F32_R;
        case 2:
          return GfxFormat.F32_RG;
        case 3:
          return GfxFormat.F32_RGB;
        case 4:
          return GfxFormat.F32_RGBA;
      }
      break;
    case NumericType.U8:
      if (isColor) {
        switch (numComponents) {
          case 3:
            return GfxFormat.U8_RGB_NORM;
          case 4:
            return GfxFormat.U8_RGBA_NORM;
        }
      }
      switch (numComponents) {
        case 1:
          return GfxFormat.U8_R;
        case 2:
          return GfxFormat.U8_RG;
        case 3:
          return GfxFormat.U8_RGB;
        case 4:
          return GfxFormat.U8_RGBA;
      }
      break;
    case NumericType.U16:
      return GfxFormat.U16_R;
    case NumericType.U32:
      return GfxFormat.U32_R;
    case NumericType.PackedDCBA:
    case NumericType.PackedDABC:
      // Packed colors are 4 bytes
      return GfxFormat.U8_RGBA_NORM;
  }

  // Default fallback
  console.warn(
    `Unknown format: numericType=${numericType}, numComponents=${numComponents}`,
  );
  return GfxFormat.F32_RGBA;
}

/**
 * Get attribute location from InternalName
 */
function getAttributeLocation(name: string): number {
  // Common Panda3D attribute names
  if (name === "vertex") return 0;
  if (name === "normal") return 1;
  if (name === "color") return 2;
  if (name === "texcoord" || name.startsWith("texcoord")) return 3;

  // Less common
  if (name === "tangent") return 4;
  if (name === "binormal") return 5;

  console.warn(`Unknown attribute name: ${name}, defaulting to location 0`);
  return 0;
}

/**
 * Extract material properties from RenderState
 */
function extractMaterial(
  file: BAMFile,
  renderState: RenderState | null,
): MaterialData {
  const material: MaterialData = {
    colorType: ColorType.Vertex,
    flatColor: [1, 1, 1, 1],
    transparencyMode: TransparencyMode.None,
    textureRef: null,
  };

  if (!renderState) return material;

  for (const [attribRef] of renderState.attribRefs) {
    const attrib = file.getObject(attribRef);
    if (!attrib) continue;

    if (attrib instanceof ColorAttrib) {
      material.colorType = attrib.colorType;
      material.flatColor = attrib.color;
    } else if (attrib instanceof TransparencyAttrib) {
      material.transparencyMode = attrib.mode;
    } else if (attrib instanceof TextureAttrib) {
      // Get texture reference - prefer onStages for modern format
      if (attrib.onStages.length > 0) {
        material.textureRef = attrib.onStages[0].textureRef;
      } else if (attrib.textureRef !== null) {
        material.textureRef = attrib.textureRef;
      }
    }
  }

  return material;
}

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
    case FilterType.LinearMipmapLinear:
    case FilterType.Default:
    default:
      return {
        texFilter: GfxTexFilterMode.Bilinear,
        mipFilter: GfxMipFilterMode.Linear,
      };
  }
}

/**
 * Walk the scene graph and collect all GeomNodes with their transforms
 */
function collectGeometry(file: BAMFile): CollectedGeometry[] {
  const result: CollectedGeometry[] = [];

  // Find all PandaNodes and identify roots (nodes with no parents)
  const allNodes = new Map<number, PandaNode>();
  const rootNodes: PandaNode[] = [];

  for (const obj of file.getObjects()) {
    const typeName = file.getTypeName(obj.objectId);
    if (
      typeName === "PandaNode" ||
      typeName === "GeomNode" ||
      typeName === "ModelNode" ||
      typeName === "ModelRoot"
    ) {
      allNodes.set(obj.objectId, obj as PandaNode);
    }
  }

  // Identify root nodes (no parents or parent is objectId 0)
  for (const node of allNodes.values()) {
    if (
      node.parents.length === 0 ||
      (node.parents.length === 1 && node.parents[0] === 0)
    ) {
      rootNodes.push(node);
    }
  }

  // If no roots found, try all GeomNodes directly
  if (rootNodes.length === 0) {
    for (const obj of file.getObjects()) {
      const typeName = file.getTypeName(obj.objectId);
      if (typeName === "GeomNode") {
        const geomNode = obj as GeomNode;
        const transform = mat4.create();
        const transformState = file.getObject(geomNode.transformRef) as
          | TransformState
          | undefined;
        transformStateToMat4(transformState ?? null, transform);

        for (const [geomRef, stateRef] of geomNode.geomRefs) {
          const geom = file.getObject(geomRef) as Geom;
          const renderState = stateRef
            ? (file.getObject(stateRef) as RenderState)
            : null;
          if (geom) {
            result.push({
              geom,
              geomNode,
              renderState,
              netTransform: mat4.clone(transform),
            });
          }
        }
      }
    }
    return result;
  }

  // Recursive traversal function
  function traverse(node: PandaNode, parentTransform: mat4): void {
    // Get this node's transform
    const localTransform = mat4.create();
    const transformState = file.getObject(node.transformRef) as
      | TransformState
      | undefined;
    transformStateToMat4(transformState ?? null, localTransform);

    // Accumulate transform
    const netTransform = mat4.create();
    mat4.multiply(netTransform, parentTransform, localTransform);

    // If this is a GeomNode, collect its geometry
    const typeName = file.getTypeName(node.objectId);
    if (typeName === "GeomNode") {
      const geomNode = node as GeomNode;
      for (const [geomRef, stateRef] of geomNode.geomRefs) {
        const geom = file.getObject(geomRef) as Geom;
        const renderState = stateRef
          ? (file.getObject(stateRef) as RenderState)
          : null;
        if (geom) {
          result.push({
            geom,
            geomNode,
            renderState,
            netTransform: mat4.clone(netTransform),
          });
        }
      }
    }

    // Traverse children
    for (const [childRef, _sort] of node.children) {
      const child = file.getObject(childRef) as PandaNode | undefined;
      if (child && allNodes.has(child.objectId)) {
        traverse(child, netTransform);
      }
    }
  }

  // Start traversal from roots
  const identityMat = mat4.create();
  for (const root of rootNodes) {
    traverse(root, identityMat);
  }

  return result;
}

/**
 * Convert triangle strips to triangle list indices
 */
function convertTriStripToTriangles(
  indices: Uint16Array | Uint32Array,
  ends: number[] | null,
): Uint32Array {
  const triangles: number[] = [];

  if (ends === null || ends.length === 0) {
    // Single strip
    for (let i = 0; i < indices.length - 2; i++) {
      if (i % 2 === 0) {
        triangles.push(indices[i], indices[i + 1], indices[i + 2]);
      } else {
        triangles.push(indices[i], indices[i + 2], indices[i + 1]);
      }
    }
  } else {
    // Multiple strips
    let start = 0;
    for (const end of ends) {
      for (let i = start; i < end - 2; i++) {
        const localIdx = i - start;
        if (localIdx % 2 === 0) {
          triangles.push(indices[i], indices[i + 1], indices[i + 2]);
        } else {
          triangles.push(indices[i], indices[i + 2], indices[i + 1]);
        }
      }
      start = end;
    }
  }

  return new Uint32Array(triangles);
}

/**
 * Convert triangle fans to triangle list indices
 */
function convertTriFanToTriangles(
  indices: Uint16Array | Uint32Array,
): Uint32Array {
  const triangles: number[] = [];
  const center = indices[0];

  for (let i = 1; i < indices.length - 1; i++) {
    triangles.push(center, indices[i], indices[i + 1]);
  }

  return new Uint32Array(triangles);
}

/**
 * Create GPU geometry from Panda3D Geom
 */
function createGeometryData(
  device: GfxDevice,
  cache: GfxRenderHelper["renderCache"],
  file: BAMFile,
  collected: CollectedGeometry,
  textureCache: Map<number, { texture: GfxTexture; sampler: GfxSampler }>,
): ToontownGeometryData | null {
  const { geom, renderState, netTransform } = collected;

  // Extract material properties
  const material = extractMaterial(file, renderState);

  // Get vertex data
  const vertexData = file.getObject(geom.dataRef) as GeomVertexData | undefined;
  if (!vertexData) {
    console.warn("Missing vertex data for geom");
    return null;
  }

  // Get vertex format
  const format = file.getObject(vertexData.formatRef) as
    | GeomVertexFormat
    | undefined;
  if (!format) {
    console.warn("Missing vertex format");
    return null;
  }

  // Build input layout from format
  const vertexAttributeDescriptors: {
    location: number;
    bufferIndex: number;
    format: GfxFormat;
    bufferByteOffset: number;
  }[] = [];

  const vertexBufferDescriptors: {
    byteStride: number;
    frequency: GfxVertexBufferFrequency;
  }[] = [];

  let hasNormals = false;
  let hasColors = false;
  let hasTexCoords = false;

  // Process each array format
  for (let arrayIdx = 0; arrayIdx < format.arrayRefs.length; arrayIdx++) {
    const arrayFormat = file.getObject(format.arrayRefs[arrayIdx]) as
      | GeomVertexArrayFormat
      | undefined;
    if (!arrayFormat) continue;

    vertexBufferDescriptors.push({
      byteStride: arrayFormat.stride,
      frequency: GfxVertexBufferFrequency.PerVertex,
    });

    for (const column of arrayFormat.columns) {
      const internalName = file.getObject(column.nameRef) as
        | InternalName
        | undefined;
      const name = internalName?.name ?? "unknown";

      const location = getAttributeLocation(name);
      const gfxFormat = getGfxFormat(
        column.numericType,
        column.numComponents,
        column.contents,
      );

      vertexAttributeDescriptors.push({
        location,
        bufferIndex: arrayIdx,
        format: gfxFormat,
        bufferByteOffset: column.start,
      });

      if (column.contents === Contents.Normal) hasNormals = true;
      if (column.contents === Contents.Color) hasColors = true;
      if (column.contents === Contents.TexCoord) hasTexCoords = true;
    }
  }

  // Get vertex buffer data
  if (vertexData.arrayRefs.length === 0) {
    console.warn("No vertex arrays");
    return null;
  }

  // For now, assume single vertex buffer (most common case)
  const vertexArrayData = file.getObject(vertexData.arrayRefs[0]) as
    | GeomVertexArrayData
    | undefined;
  if (!vertexArrayData) {
    console.warn("Missing vertex array data");
    return null;
  }

  // Create vertex buffer
  const vertexBuffer = device.createBuffer(
    vertexArrayData.buffer.byteLength,
    GfxBufferUsage.Vertex,
    GfxBufferFrequencyHint.Static,
  );
  device.uploadBufferData(vertexBuffer, 0, vertexArrayData.buffer);

  // Process primitives
  let totalIndexCount = 0;
  const allIndices: number[] = [];

  for (const primRef of geom.primitiveRefs) {
    const primitive = file.getObject(primRef) as GeomPrimitive | undefined;
    if (!primitive) continue;

    const typeName = file.getTypeName(primRef);

    // Get index data if present
    if (primitive.verticesRef) {
      const indexArrayData = file.getObject(primitive.verticesRef) as
        | GeomVertexArrayData
        | undefined;
      if (indexArrayData) {
        // Determine index type
        let indices: Uint16Array | Uint32Array;
        if (primitive.indexType === NumericType.U16) {
          indices = new Uint16Array(
            indexArrayData.buffer.buffer,
            indexArrayData.buffer.byteOffset,
            indexArrayData.buffer.byteLength / 2,
          );
        } else if (primitive.indexType === NumericType.U32) {
          indices = new Uint32Array(
            indexArrayData.buffer.buffer,
            indexArrayData.buffer.byteOffset,
            indexArrayData.buffer.byteLength / 4,
          );
        } else {
          // Assume U16
          indices = new Uint16Array(
            indexArrayData.buffer.buffer,
            indexArrayData.buffer.byteOffset,
            indexArrayData.buffer.byteLength / 2,
          );
        }

        // Convert based on primitive type
        if (typeName === "GeomTristrips") {
          const converted = convertTriStripToTriangles(indices, primitive.ends);
          for (let i = 0; i < converted.length; i++) {
            allIndices.push(converted[i]);
          }
        } else if (typeName === "GeomTrifans") {
          const converted = convertTriFanToTriangles(indices);
          for (let i = 0; i < converted.length; i++) {
            allIndices.push(converted[i]);
          }
        } else {
          // GeomTriangles or other - use directly
          for (let i = 0; i < indices.length; i++) {
            allIndices.push(indices[i]);
          }
        }
      }
    } else if (primitive.numVertices > 0) {
      // Non-indexed drawing - generate indices
      const start = primitive.firstVertex;
      const count = primitive.numVertices;

      if (typeName === "GeomTristrips") {
        // Generate strip indices
        for (let i = 0; i < count - 2; i++) {
          if (i % 2 === 0) {
            allIndices.push(start + i, start + i + 1, start + i + 2);
          } else {
            allIndices.push(start + i, start + i + 2, start + i + 1);
          }
        }
      } else if (typeName === "GeomTrifans") {
        for (let i = 1; i < count - 1; i++) {
          allIndices.push(start, start + i, start + i + 1);
        }
      } else {
        // Triangles - generate sequential indices
        for (let i = 0; i < count; i++) {
          allIndices.push(start + i);
        }
      }
    }
  }

  totalIndexCount = allIndices.length;

  if (totalIndexCount === 0) {
    console.warn("No indices generated");
    device.destroyBuffer(vertexBuffer);
    return null;
  }

  // Create index buffer
  const indexData = new Uint32Array(allIndices);
  const indexBuffer = device.createBuffer(
    indexData.byteLength,
    GfxBufferUsage.Index,
    GfxBufferFrequencyHint.Static,
  );
  device.uploadBufferData(indexBuffer, 0, new Uint8Array(indexData.buffer));

  // Create input layout
  const inputLayout = cache.createInputLayout({
    indexBufferFormat: GfxFormat.U32_R,
    vertexAttributeDescriptors,
    vertexBufferDescriptors,
  });

  // Apply coordinate system transform to model matrix
  const modelMatrix = mat4.create();
  mat4.multiply(modelMatrix, pandaToNoclip, netTransform);

  // Setup texture mapping
  const textureMapping = new TextureMapping();
  if (material.textureRef !== null && textureCache.has(material.textureRef)) {
    const cached = textureCache.get(material.textureRef)!;
    textureMapping.gfxTexture = cached.texture;
    textureMapping.gfxSampler = cached.sampler;
  }

  return {
    vertexBuffer,
    indexBuffer,
    inputLayout,
    indexCount: totalIndexCount,
    indexFormat: GfxFormat.U32_R,
    hasNormals,
    hasColors,
    hasTexCoords,
    modelMatrix,
    material,
    textureMapping,
  };
}

export class ToontownRenderer implements Viewer.SceneGfx {
  private renderHelper: GfxRenderHelper;
  private renderInstListMain = new GfxRenderInstList();
  private renderInstListTransparent = new GfxRenderInstList();
  private geometryData: ToontownGeometryData[] = [];
  private gfxProgram: GfxProgram;
  private textureCache: Map<
    number,
    { texture: GfxTexture; sampler: GfxSampler }
  > = new Map();
  private whiteTexture: GfxTexture;
  private defaultSampler: GfxSampler;

  private constructor(private device: GfxDevice) {
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
    c.setSceneMoveSpeedMult(0.1);
  }

  public static async create(
    device: GfxDevice,
    file: BAMFile,
    loader: ToontownResourceLoader,
    dataFetcher: DataFetcher,
  ): Promise<ToontownRenderer> {
    const renderer = new ToontownRenderer(device);
    const cache = renderer.renderHelper.renderCache;

    // Build texture cache from all textures in the BAM file
    await renderer.buildTextureCache(device, cache, file, loader, dataFetcher);

    // Collect and convert geometry
    const collected = collectGeometry(file);
    console.log(`Collected ${collected.length} geometries`);

    for (const c of collected) {
      const data = createGeometryData(
        device,
        cache,
        file,
        c,
        renderer.textureCache,
      );
      if (data) {
        renderer.geometryData.push(data);
      }
    }

    console.log(`Created ${renderer.geometryData.length} GPU geometry objects`);
    return renderer;
  }

  private async buildTextureCache(
    device: GfxDevice,
    cache: GfxRenderHelper["renderCache"],
    file: BAMFile,
    loader: ToontownResourceLoader,
    dataFetcher: DataFetcher,
  ): Promise<void> {
    const texturePromises: Promise<void>[] = [];

    for (const obj of file.getObjects()) {
      if (!(obj instanceof Texture)) continue;
      const texture = obj;

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
        this.textureCache.set(texture.objectId, {
          texture: gfxTexture,
          sampler: gfxSampler,
        });
      } else if (texture.filename) {
        // Try to load external texture file
        const promise = this.loadExternalTexture(
          device,
          cache,
          texture,
          loader,
          dataFetcher,
        );
        texturePromises.push(promise);
      } else {
        throw new Error(
          `Failed to load texture ${texture.name}: no raw data or filename`,
        );
      }
    }

    // Wait for all external textures to load
    await Promise.all(texturePromises);
    console.log(`Built texture cache with ${this.textureCache.size} textures`);
  }

  private async loadExternalTexture(
    device: GfxDevice,
    cache: GfxRenderHelper["renderCache"],
    texture: Texture,
    loader: ToontownResourceLoader,
    dataFetcher: DataFetcher,
  ): Promise<void> {
    try {
      // Determine image format from extension
      const format = getImageFormat(texture.filename);
      if (!format) {
        throw new Error(
          `Failed to load texture ${texture.name}: unsupported format ${texture.filename}`,
        );
      }

      // Load the main texture file
      const fileData = await loader.loadFile(texture.filename, dataFetcher);
      const decoded = await decodeImage(fileData, format);

      // Check if there's a separate alpha file
      if (texture.alphaFilename) {
        const alphaFormat = getImageFormat(texture.alphaFilename);
        if (alphaFormat) {
          try {
            const alphaFileData = await loader.loadFile(
              texture.alphaFilename,
              dataFetcher,
            );
            const alphaDecoded = await decodeImage(alphaFileData, alphaFormat);
            mergeAlphaChannel(decoded, alphaDecoded);
          } catch (e) {
            throw new Error(
              `Failed to load alpha texture ${texture.alphaFilename}:`,
              { cause: e },
            );
          }
        }
      }

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
      this.textureCache.set(texture.objectId, {
        texture: gfxTexture,
        sampler: gfxSampler,
      });
      console.log(
        `Loaded external texture ${texture.name} from ${texture.filename} (${decoded.width}x${decoded.height})${texture.alphaFilename ? " with alpha" : ""}`,
      );
    } catch (e) {
      console.warn(`Failed to load external texture ${texture.name}:`, e);
    }
  }

  private createSamplerForTexture(
    cache: GfxRenderHelper["renderCache"],
    texture: Texture,
  ): GfxSampler {
    let wrapS = GfxWrapMode.Repeat;
    let wrapT = GfxWrapMode.Repeat;
    let minFilter = GfxTexFilterMode.Bilinear;
    let magFilter = GfxTexFilterMode.Bilinear;
    let mipFilter = GfxMipFilterMode.Nearest;

    if (texture.defaultSampler) {
      wrapS = translateWrapMode(texture.defaultSampler.wrapU);
      wrapT = translateWrapMode(texture.defaultSampler.wrapV);
      const minF = translateFilterType(texture.defaultSampler.minFilter);
      const magF = translateFilterType(texture.defaultSampler.magFilter);
      minFilter = minF.texFilter;
      mipFilter = minF.mipFilter;
      magFilter = magF.texFilter;
    } else {
      // Pre-5.0 format
      wrapS = translateWrapMode(texture.wrapU);
      wrapT = translateWrapMode(texture.wrapV);
      const minF = translateFilterType(texture.minFilter);
      const magF = translateFilterType(texture.magFilter);
      minFilter = minF.texFilter;
      mipFilter = minF.mipFilter;
      magFilter = magF.texFilter;
    }

    return cache.createSampler({
      wrapS,
      wrapT,
      minFilter,
      magFilter,
      mipFilter,
    });
  }

  private prepareToRender(
    device: GfxDevice,
    viewerInput: Viewer.ViewerRenderInput,
  ): void {
    const renderInstManager = this.renderHelper.renderInstManager;

    // Push template with common settings
    const template = this.renderHelper.pushTemplateRenderInst();
    template.setBindingLayouts(bindingLayouts);
    template.setGfxProgram(this.gfxProgram);
    template.setMegaStateFlags({
      depthWrite: true,
      depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
      cullMode: GfxCullMode.Back,
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
    offs += fillMatrix4x4(sceneParams, offs, viewerInput.camera.viewMatrix);

    // Create render instances for each geometry
    for (const geomData of this.geometryData) {
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

      // Handle transparency blending
      if (isTransparent) {
        setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
          blendMode: GfxBlendMode.Add,
          blendSrcFactor: GfxBlendFactor.SrcAlpha,
          blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        renderInst.setMegaStateFlags({ depthWrite: false });
      }

      // Determine color based on ColorAttrib
      let colorR = 1,
        colorG = 1,
        colorB = 1,
        colorA = 1;
      let useVertexColors = geomData.hasColors;

      switch (material.colorType) {
        case ColorType.Flat:
          // Use flat color, ignore vertex colors
          [colorR, colorG, colorB, colorA] = material.flatColor;
          useVertexColors = false;
          break;
        case ColorType.Off:
          // White color, ignore vertex colors
          colorR = colorG = colorB = colorA = 1;
          useVertexColors = false;
          break;
        case ColorType.Vertex:
        default:
          // Use vertex colors if available, otherwise white
          colorR = colorG = colorB = colorA = 1;
          break;
      }

      // Allocate draw params UBO
      offs = renderInst.allocateUniformBuffer(
        ToontownProgram.ub_DrawParams,
        16 + 4 + 4,
      );
      const drawParams = renderInst.mapUniformBufferF32(
        ToontownProgram.ub_DrawParams,
      );
      offs += fillMatrix4x4(drawParams, offs, geomData.modelMatrix);
      offs += fillVec4(drawParams, offs, colorR, colorG, colorB, colorA);
      offs += fillVec4(
        drawParams,
        offs,
        hasTexture ? 1 : 0,
        useVertexColors ? 1 : 0,
        geomData.hasNormals ? 1 : 0,
        0,
      );

      renderInst.setDrawCount(geomData.indexCount);

      if (isTransparent) {
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        this.renderInstListTransparent.submitRenderInst(renderInst);
      } else {
        renderInst.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
        this.renderInstListMain.submitRenderInst(renderInst);
      }
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

    // Main render pass - opaque geometry
    builder.pushPass((pass) => {
      pass.setDebugName("Main Opaque");
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

    // Transparent geometry pass
    builder.pushPass((pass) => {
      pass.setDebugName("Transparent");
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
      pass.attachRenderTargetID(
        GfxrAttachmentSlot.DepthStencil,
        mainDepthTargetID,
      );
      pass.exec((passRenderer) => {
        this.renderInstListTransparent.drawOnPassRenderer(
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
    this.renderInstListTransparent.reset();
  }

  public destroy(device: GfxDevice): void {
    // Destroy geometry buffers
    for (const geomData of this.geometryData) {
      device.destroyBuffer(geomData.vertexBuffer);
      if (geomData.indexBuffer) {
        device.destroyBuffer(geomData.indexBuffer);
      }
    }

    // Destroy textures
    for (const { texture } of this.textureCache.values()) {
      device.destroyTexture(texture);
    }
    device.destroyTexture(this.whiteTexture);

    this.renderHelper.destroy();
  }
}
