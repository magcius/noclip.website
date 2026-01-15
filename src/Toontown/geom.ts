import {
  type mat4,
  type ReadonlyVec3,
  type ReadonlyVec4,
  vec3,
  vec4,
} from "gl-matrix";
import type { AABB } from "../Geometry";
import {
  type GfxBuffer,
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  type GfxDevice,
  GfxFormat,
  type GfxInputLayout,
  type GfxInputLayoutBufferDescriptor,
  type GfxVertexAttributeDescriptor,
  GfxVertexBufferFrequency,
} from "../gfx/platform/GfxPlatform";
import type { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { enumName } from "./common";
import {
  BillboardEffect,
  BoundsType,
  ColorType,
  ColorWriteChannels,
  Contents,
  CullFaceMode,
  DecalEffect,
  DepthWriteMode,
  type Geom,
  type GeomNode,
  GeomTriangles,
  GeomTrifans,
  GeomTristrips,
  type GeomVertexArrayFormat,
  type GeomVertexColumn,
  type GeomVertexData,
  NumericType,
  PandaCompareFunc,
  type PandaNode,
  type RenderAttribEntry,
  type RenderState,
  type Texture,
  TransparencyMode,
  VertexTransform,
} from "./nodes";
import { AttributeLocation } from "./program";

/**
 * GPU-ready geometry data
 */
export interface CachedGeometryData {
  vertexBuffers: GfxBuffer[];
  indexBuffer: GfxBuffer | null;
  inputLayout: GfxInputLayout;
  indexCount: number;
  indexFormat: GfxFormat;
  hasNormals: boolean;
  hasColors: boolean;
  hasTexCoords: boolean;
  aabb: AABB;
  // Bounding sphere (computed from AABB)
  sphereCenter: ReadonlyVec3;
  sphereRadius: number;
  // Which bounds type to use for culling
  boundsType: BoundsType;
  skinningBuffer: GfxBuffer | null;
  skinningTransforms: VertexTransform[];
}

/**
 * Material properties extracted from RenderState
 */
export interface MaterialData {
  colorType: ColorType;
  flatColor: ReadonlyVec4;
  colorScale: ReadonlyVec4;
  transparencyMode: TransparencyMode;
  texture: Texture | null;
  cullBinName: string | null;
  drawOrder: number | null;
  cullFaceMode: CullFaceMode;
  cullReverse: boolean;
  depthTestMode: PandaCompareFunc;
  depthWrite: DepthWriteMode;
  isDecal: boolean;
  billboardEffect: BillboardEffect | null;
  colorWriteChannels: number;
  alphaTestMode: PandaCompareFunc;
  alphaTestThreshold: number;
}

/**
 * Collected geometry ready for rendering
 */
export interface CollectedGeometry {
  node: GeomNode;
  geom: Geom;
  modelMatrix: mat4;
  localAABB: AABB;
  attribs: RenderAttribEntry[];
}

// Draw mask constants for visibility culling
// When cleared, hides from all cameras
const OVERALL_BIT = 1 << 31;
// Toontown camera bitmasks (from OTPRender.py)
const MainCameraBitmask = 1 << 0; // 0x1
const EnviroCameraBitmask = 1 << 5; // 0x20
// Camera mask for viewer
const CAMERA_MASK = MainCameraBitmask | EnviroCameraBitmask; // 0x21

/**
 * Compose draw masks during scene graph traversal.
 * Uncontrolled bits (control=0) pass through from parent.
 * Controlled bits (control=1) come from showMask.
 */
export function composeDrawMask(
  parentMask: number,
  controlMask: number,
  showMask: number,
): number {
  return (parentMask & ~controlMask) | (showMask & controlMask);
}

/**
 * Check if a node should be visible based on its composed draw mask.
 * Must pass both overall bit check and camera mask check.
 */
export function isNodeVisible(drawMask: number): boolean {
  return (drawMask & OVERALL_BIT) !== 0 && (drawMask & CAMERA_MASK) !== 0;
}

/**
 * Combine new render attributes into existing attribute list based on priority.
 */
export function combineAttributes(
  attribs: RenderAttribEntry[],
  newAttribs: RenderAttribEntry[],
): RenderAttribEntry[] {
  if (newAttribs.length === 0) {
    return attribs;
  }
  const result: RenderAttribEntry[] = attribs.slice();
  for (const entry of newAttribs) {
    const existing = result.findIndex(
      (a) => a.attrib.constructor.name === entry.attrib.constructor.name,
    );
    if (existing === -1) {
      result.push(entry);
    } else if (entry.priority >= result[existing].priority) {
      result[existing] = entry;
    }
  }
  return result;
}

/**
 * Convert triangle strips to triangle list indices
 */
function convertTriStripToTriangles(
  indices: Uint8Array | Uint16Array | Uint32Array,
  count: number = -1,
  ends: Int32Array | null,
): Uint32Array {
  let endIndex = count;
  if (count === -1) {
    endIndex = indices.length;
  }

  const triangles: number[] = [];
  if (ends === null || ends.length === 0) {
    // Single strip
    for (let i = 0; i < endIndex - 2; i++) {
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
      const loopEnd = Math.min(end, endIndex);
      for (let i = start; i < loopEnd - 2; i++) {
        const localIdx = i - start;
        if (localIdx % 2 === 0) {
          triangles.push(indices[i], indices[i + 1], indices[i + 2]);
        } else {
          triangles.push(indices[i], indices[i + 2], indices[i + 1]);
        }
      }
      start = end;
      if (start >= endIndex) {
        break;
      }
    }
  }

  return new Uint32Array(triangles);
}

/**
 * Convert triangle fans to triangle list indices
 */
function convertTriFanToTriangles(
  indices: Uint8Array | Uint16Array | Uint32Array,
): Uint32Array {
  const triangles: number[] = [];
  const center = indices[0];

  for (let i = 1; i < indices.length - 1; i++) {
    triangles.push(center, indices[i], indices[i + 1]);
  }

  return new Uint32Array(triangles);
}

export function createGeomData(
  geom: Geom,
  renderCache: GfxRenderCache,
  geomCache: Map<Geom, CachedGeometryData>,
): CachedGeometryData {
  const cached = geomCache.get(geom);
  if (cached) return cached;

  // Get vertex data
  const vertexData = geom.data;
  if (!vertexData) throw new Error("Missing vertex data for geom");

  // Get vertex format
  const format = vertexData.format;
  if (!format) throw new Error("Missing vertex format");

  // Build input layout from format
  const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
  const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

  let hasNormals = false;
  let hasColors = false;
  let hasTexCoords = false;

  // Find transform_blend column for skinned geometry
  let transformBlendColumn: GeomVertexColumn | null = null;
  let transformBlendArrayIndex = 0;
  for (let i = 0; i < format.arrays.length; i++) {
    const arrayFormat = format.arrays[i];
    for (const column of arrayFormat.columns) {
      if (column.contents === Contents.Index) {
        transformBlendColumn = column;
        transformBlendArrayIndex = i;
        break;
      }
    }
    if (transformBlendColumn) break;
  }

  // Process each array format
  const referencedArrays = new Set<number>();
  let currentBufferIndex = 0;
  for (let arrayIdx = 0; arrayIdx < format.arrays.length; arrayIdx++) {
    const arrayFormat = format.arrays[arrayIdx];

    let added = false;
    for (const column of arrayFormat.columns) {
      const location = getAttributeLocation(column.contents);
      if (location === null) continue;

      const gfxFormat = getGfxFormat(
        column.numericType,
        column.numComponents,
        column.contents,
      );
      if (arrayIdx > 0) {
        console.log(
          `Found ${enumName(column.contents, Contents)} in array idx ${arrayIdx}`,
          geom,
        );
      }

      vertexAttributeDescriptors.push({
        location,
        bufferIndex: currentBufferIndex,
        format: gfxFormat,
        bufferByteOffset: column.start,
      });
      added = true;

      if (column.contents === Contents.Normal) hasNormals = true;
      if (column.contents === Contents.Color) hasColors = true;
      if (column.contents === Contents.TexCoord) hasTexCoords = true;
    }

    if (added) {
      vertexBufferDescriptors.push({
        byteStride: arrayFormat.stride,
        frequency: GfxVertexBufferFrequency.PerVertex,
      });
      referencedArrays.add(arrayIdx);
      currentBufferIndex++;
    }
  }

  // Get vertex buffer data
  if (referencedArrays.size === 0) {
    throw new Error("No vertex arrays");
  }

  const device = renderCache.device;
  const vertexBuffers: GfxBuffer[] = [];
  for (const arrayIdx of referencedArrays) {
    let buffer = vertexData.arrays[arrayIdx].buffer;

    // Unpack DABC if necessary
    const arrayFormat = format.arrays[arrayIdx];
    for (const column of arrayFormat.columns) {
      if (
        column.contents === Contents.Color &&
        column.numericType === NumericType.PackedDABC
      ) {
        buffer = unpackPackedColor(buffer, arrayFormat, column);
      }
    }

    // Create vertex buffer
    const vertexBuffer = device.createBuffer(
      buffer.byteLength,
      GfxBufferUsage.Vertex,
      GfxBufferFrequencyHint.Static,
    );
    device.uploadBufferData(vertexBuffer, 0, buffer);
    vertexBuffers.push(vertexBuffer);
  }

  // Process primitives
  let totalIndexCount = 0;
  const allIndices: number[] = [];

  for (const primitive of geom.primitives) {
    // Get index data if present
    if (primitive.vertices) {
      let indices: Uint8Array | Uint16Array | Uint32Array;
      if (primitive.indexType === NumericType.U8) {
        indices = primitive.vertices.buffer;
      } else if (primitive.indexType === NumericType.U16) {
        indices = new Uint16Array(
          primitive.vertices.buffer.buffer,
          primitive.vertices.buffer.byteOffset,
          primitive.vertices.buffer.byteLength / 2,
        );
      } else if (primitive.indexType === NumericType.U32) {
        indices = new Uint32Array(
          primitive.vertices.buffer.buffer,
          primitive.vertices.buffer.byteOffset,
          primitive.vertices.buffer.byteLength / 4,
        );
      } else {
        throw new Error(
          `Unsupported index type: ${enumName(primitive.indexType, NumericType)}`,
        );
      }

      // Convert based on primitive type
      if (primitive instanceof GeomTristrips) {
        const converted = convertTriStripToTriangles(
          indices,
          primitive.numVertices,
          primitive.ends,
        );
        for (let i = 0; i < converted.length; i++) {
          allIndices.push(converted[i]);
        }
      } else if (primitive instanceof GeomTrifans) {
        const converted = convertTriFanToTriangles(indices);
        for (let i = 0; i < converted.length; i++) {
          allIndices.push(converted[i]);
        }
      } else if (primitive instanceof GeomTriangles) {
        let end = primitive.numVertices;
        if (end === -1) {
          end = indices.length;
        }
        for (let i = 0; i < end; i++) {
          allIndices.push(indices[i]);
        }
      } else {
        throw new Error(
          `Unsupported primitive type: ${primitive.constructor.name}`,
        );
      }
    } else if (primitive.numVertices > 0) {
      // Non-indexed drawing - generate indices
      const start = primitive.firstVertex;
      const count = primitive.numVertices;

      if (primitive instanceof GeomTristrips) {
        // Generate strip indices
        for (let i = 0; i < count - 2; i++) {
          if (i % 2 === 0) {
            allIndices.push(start + i, start + i + 1, start + i + 2);
          } else {
            allIndices.push(start + i, start + i + 2, start + i + 1);
          }
        }
      } else if (primitive instanceof GeomTrifans) {
        for (let i = 1; i < count - 1; i++) {
          allIndices.push(start, start + i, start + i + 1);
        }
      } else if (primitive instanceof GeomTriangles) {
        // Triangles - generate sequential indices
        for (let i = 0; i < count; i++) {
          allIndices.push(start + i);
        }
      } else {
        throw new Error(
          `Unsupported primitive type: ${primitive.constructor.name}`,
        );
      }
    }
  }

  totalIndexCount = allIndices.length;

  if (totalIndexCount === 0) {
    throw new Error("No indices generated");
  }

  // Create index buffer
  const indexData = new Uint32Array(allIndices);
  const indexBuffer = device.createBuffer(
    indexData.byteLength,
    GfxBufferUsage.Index,
    GfxBufferFrequencyHint.Static,
  );
  device.uploadBufferData(indexBuffer, 0, new Uint8Array(indexData.buffer));

  // Create skinning buffer if needed
  let skinningBuffer: GfxBuffer | null = null;
  let skinningTransforms: VertexTransform[] = [];
  if (transformBlendColumn) {
    const skinningResult = createSkinningBuffer(
      vertexData,
      transformBlendColumn,
      transformBlendArrayIndex,
      format.arrays[transformBlendArrayIndex],
      device,
    );
    skinningBuffer = skinningResult.buffer;
    skinningTransforms = skinningResult.transforms;

    // Add skinning buffer descriptor
    const bufferIndex = vertexBufferDescriptors.length;
    vertexBufferDescriptors.push({
      byteStride: skinningResult.stride,
      frequency: GfxVertexBufferFrequency.PerVertex,
    });

    // Add bone weights and indices descriptors
    vertexAttributeDescriptors.push({
      location: AttributeLocation.BoneWeights,
      bufferIndex,
      format: GfxFormat.F32_RGBA,
      bufferByteOffset: 0,
    });
    vertexAttributeDescriptors.push({
      location: AttributeLocation.BoneIndices,
      bufferIndex,
      format: GfxFormat.U8_RGBA,
      bufferByteOffset: 16,
    });
  }

  // Create input layout
  const inputLayout = renderCache.createInputLayout({
    indexBufferFormat: GfxFormat.U32_R,
    vertexAttributeDescriptors,
    vertexBufferDescriptors,
  });

  const aabb = geom.getBoundingBox();
  const { center: sphereCenter, radius: sphereRadius } =
    computeBoundingSphereFromAABB(aabb);

  // Resolve boundsType: Default/Best → Sphere (per Panda3D)
  let boundsType = geom.boundsType;
  if (boundsType === BoundsType.Default || boundsType === BoundsType.Best) {
    boundsType = BoundsType.Sphere;
  }

  const cachedGeometryData: CachedGeometryData = {
    vertexBuffers,
    indexBuffer,
    inputLayout,
    indexCount: totalIndexCount,
    indexFormat: GfxFormat.U32_R,
    hasNormals,
    hasColors,
    hasTexCoords,
    aabb,
    sphereCenter,
    sphereRadius,
    boundsType,
    skinningBuffer,
    skinningTransforms,
  };
  geomCache.set(geom, cachedGeometryData);
  return cachedGeometryData;
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
    // Already in RGBA format
    case NumericType.PackedDABC:
      // We'll unpack to RGBA
      return GfxFormat.U8_RGBA_NORM;
  }

  throw new Error(
    `Unknown format: numericType=${enumName(numericType, NumericType)}, numComponents=${numComponents}`,
  );
}

/**
 * Get attribute location from InternalName
 */
function getAttributeLocation(contents: Contents): number | null {
  switch (contents) {
    case Contents.Point:
      return AttributeLocation.Position;
    case Contents.Normal:
      return AttributeLocation.Normal;
    case Contents.Color:
      return AttributeLocation.Color;
    case Contents.TexCoord:
      return AttributeLocation.TexCoord;
    case Contents.Index:
      // Index columns (like transform_blend) are handled separately
      // via skinning buffer, not as regular vertex attributes
      return null;
    case Contents.Vector:
      // Tangent and binormal are currently unsupported
      return null;
    default:
      console.warn(
        `Unknown attribute contents: ${enumName(contents, Contents)}`,
      );
      return null;
  }
}

const DEFAULT_MATERIAL: MaterialData = {
  colorType: ColorType.Vertex,
  flatColor: vec4.fromValues(1, 1, 1, 1),
  colorScale: vec4.fromValues(1, 1, 1, 1),
  transparencyMode: TransparencyMode.None,
  texture: null,
  cullBinName: null,
  drawOrder: null,
  cullFaceMode: CullFaceMode.CullClockwise,
  cullReverse: false,
  depthTestMode: PandaCompareFunc.Less,
  depthWrite: DepthWriteMode.On,
  isDecal: false,
  billboardEffect: null,
  colorWriteChannels: ColorWriteChannels.All,
  alphaTestMode: PandaCompareFunc.Always,
  alphaTestThreshold: 1,
};

/**
 * Extract material properties from RenderState
 */
export function extractMaterial(
  node: PandaNode,
  renderState: RenderState,
): MaterialData {
  const material: MaterialData = { ...DEFAULT_MATERIAL };

  for (const effect of node.effects.effects) {
    switch (effect.constructor) {
      case BillboardEffect:
        material.billboardEffect = effect as BillboardEffect;
        break;
      case DecalEffect:
        material.isDecal = true;
        break;
      default:
        console.warn(
          `Unsupported RenderEffects effect type: ${effect.constructor.name}`,
        );
    }
  }

  for (const { attrib } of renderState.attribs) {
    attrib.applyToMaterial(material);
  }

  return material;
}

/**
 * Compute bounding sphere from AABB (Panda3D algorithm).
 * Center = AABB center, Radius = distance from center to farthest corner.
 */
export function computeBoundingSphereFromAABB(aabb: AABB): {
  center: vec3;
  radius: number;
} {
  const center = vec3.create();
  aabb.centerPoint(center);

  // Radius = distance from center to corner (half diagonal)
  const halfExtents = vec3.create();
  vec3.sub(halfExtents, aabb.max, center);
  const radius = vec3.length(halfExtents);

  return { center, radius };
}

function unpackPackedColor(
  buffer: Uint8Array,
  arrayFormat: GeomVertexArrayFormat,
  column: GeomVertexColumn,
): Uint8Array {
  const result = new Uint8Array(buffer);
  const numVertices = buffer.length / arrayFormat.stride;
  if (column.numericType === NumericType.PackedDABC) {
    // Swap R and B
    for (let i = 0; i < numVertices; i++) {
      const offs = i * arrayFormat.stride + column.start;
      result[offs] = buffer[offs + 2];
      result[offs + 2] = buffer[offs];
    }
  } else {
    throw new Error(
      `Unsupported packed color type: ${enumName(column.numericType, NumericType)}`,
    );
  }
  return result;
}

/**
 * Maximum number of bone influences per vertex.
 */
const MAX_BONES_PER_VERTEX = 4;

/**
 * Stride of skinning buffer: 16 bytes weights + 4 bytes indices = 20 bytes
 */
const SKINNING_BUFFER_STRIDE = 20;

/**
 * Create a skinning buffer containing bone indices and weights for each vertex.
 *
 * The buffer layout per vertex is:
 * - Bytes 0-15: Bone weights (4x F32)
 * - Bytes 16-19: Bone indices (4x U8)
 */
function createSkinningBuffer(
  vertexData: GeomVertexData,
  blendColumn: GeomVertexColumn,
  blendArrayIndex: number,
  arrayFormat: GeomVertexArrayFormat,
  device: GfxDevice,
): { buffer: GfxBuffer; stride: number; transforms: VertexTransform[] } {
  const blendTable = vertexData.transformBlendTable!;
  const srcBuffer = vertexData.arrays[blendArrayIndex].buffer;
  const numVertices = srcBuffer.length / arrayFormat.stride;

  // Create skinning data: 8 bytes per vertex (4 weights + 4 indices)
  const skinningData = new Uint8Array(numVertices * SKINNING_BUFFER_STRIDE);

  // Build a mapping from VertexTransform to bone index
  // Use the TransformTable if available, otherwise build from unique transforms
  const transformToIndex = new Map<VertexTransform, number>();
  const transforms: VertexTransform[] = [];
  const addTransform = (transform: VertexTransform): number => {
    const existing = transformToIndex.get(transform);
    if (existing !== undefined) return existing;
    const index = transforms.length;
    transformToIndex.set(transform, index);
    transforms.push(transform);
    return index;
  };
  if (vertexData.transformTable) {
    const tableTransforms = vertexData.transformTable.transforms;
    transforms.length = tableTransforms.length;
    for (let i = 0; i < tableTransforms.length; i++) {
      const transform = tableTransforms[i];
      if (transform) {
        transformToIndex.set(transform, i);
        transforms[i] = transform;
      } else {
        transforms[i] = new VertexTransform();
      }
    }
  } else {
    // Build from unique transforms in blend table
    for (const blend of blendTable.blends) {
      for (const entry of blend.entries) {
        addTransform(entry.transform);
      }
    }
  }

  // Create a DataView for reading blend indices from source buffer
  const srcView = new DataView(
    srcBuffer.buffer,
    srcBuffer.byteOffset,
    srcBuffer.byteLength,
  );

  // Process each vertex
  for (let v = 0; v < numVertices; v++) {
    const srcOffset = v * arrayFormat.stride + blendColumn.start;
    const dstOffset = v * SKINNING_BUFFER_STRIDE;

    // Read the blend table index from the source vertex data
    let blendIndex: number;
    switch (blendColumn.numericType) {
      case NumericType.U8:
        blendIndex = srcBuffer[srcOffset];
        break;
      case NumericType.U16:
        blendIndex = srcView.getUint16(srcOffset, true);
        break;
      case NumericType.U32:
        blendIndex = srcView.getUint32(srcOffset, true);
        break;
      default:
        blendIndex = 0;
    }

    const outView = new DataView(skinningData.buffer, dstOffset);
    function writeBlend(weight: number, index: number, blendIndex: number) {
      outView.setFloat32(blendIndex * 4, weight, true);
      outView.setUint8(blendIndex + 16, index);
    }

    // Get the blend from the table
    const blend = blendTable.getBlend(blendIndex);
    if (!blend) {
      // No blend - set to identity (bone 0, weight 1)
      writeBlend(1, 0, 0);
      writeBlend(0, 0, 1);
      writeBlend(0, 0, 2);
      writeBlend(0, 0, 3);
      continue;
    }

    if (blend.entries.length > MAX_BONES_PER_VERTEX) {
      console.warn(
        `Truncating ${blend.entries.length} to ${MAX_BONES_PER_VERTEX} bones`,
      );
    }

    // Extract up to MAX_BONES_PER_VERTEX entries
    const numEntries = Math.min(blend.entries.length, MAX_BONES_PER_VERTEX);

    // Pack weights and indices
    for (let i = 0; i < MAX_BONES_PER_VERTEX; i++) {
      if (i < numEntries) {
        const entry = blend.entries[i];
        const boneIndex =
          transformToIndex.get(entry.transform) ?? addTransform(entry.transform);
        writeBlend(entry.weight, boneIndex, i);
      } else {
        // Unused slot
        writeBlend(0, 0, i);
      }
    }
  }

  // Create GPU buffer
  const buffer = device.createBuffer(
    skinningData.byteLength,
    GfxBufferUsage.Vertex,
    GfxBufferFrequencyHint.Static,
  );
  device.uploadBufferData(buffer, 0, skinningData);

  return { buffer, stride: SKINNING_BUFFER_STRIDE, transforms };
}
