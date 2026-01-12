import { type mat4, type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import { AABB } from "../Geometry";
import {
  type GfxBuffer,
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  GfxFormat,
  type GfxInputLayout,
  type GfxInputLayoutBufferDescriptor,
  type GfxVertexAttributeDescriptor,
  GfxVertexBufferFrequency,
} from "../gfx/platform/GfxPlatform";
import type { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { enumName } from "./common";
import {
  AlphaTestAttrib,
  BillboardEffect,
  BoundsType,
  ColorAttrib,
  ColorType,
  ColorWriteAttrib,
  ColorWriteChannels,
  Contents,
  CullBinAttrib,
  CullFaceAttrib,
  CullFaceMode,
  DecalEffect,
  DepthTestAttrib,
  DepthWriteAttrib,
  DepthWriteMode,
  type Geom,
  type GeomNode,
  GeomTriangles,
  GeomTrifans,
  GeomTristrips,
  type GeomVertexArrayFormat,
  type GeomVertexColumn,
  NumericType,
  PandaCompareFunc,
  type PandaNode,
  type RenderAttribEntry,
  type RenderState,
  type Texture,
  TextureAttrib,
  TransparencyAttrib,
  TransparencyMode,
} from "./nodes";

/**
 * GPU-ready geometry data
 */
export interface CachedGeometryData {
  vertexBuffer: GfxBuffer;
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
}

/**
 * Material properties extracted from RenderState
 */
export interface MaterialData {
  colorType: ColorType;
  flatColor: vec4;
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
  indices: Uint16Array | Uint32Array,
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
  indices: Uint16Array | Uint32Array,
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

  // Process each array format
  for (
    let arrayIdx = 0;
    arrayIdx < Math.min(format.arrays.length, 1);
    arrayIdx++
  ) {
    const arrayFormat = format.arrays[arrayIdx];

    vertexBufferDescriptors.push({
      byteStride: arrayFormat.stride,
      frequency: GfxVertexBufferFrequency.PerVertex,
    });

    for (const column of arrayFormat.columns) {
      const location = getAttributeLocation(column.contents);
      if (location === null) continue;
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
  if (vertexData.arrays.length === 0) {
    throw new Error("No vertex arrays");
  }

  if (vertexData.arrays.length > 1) {
    // console.log(collected);
    console.warn("Multiple vertex arrays not yet supported");
  }

  let buffer = vertexData.arrays[0].buffer;

  // Unpack DABC if necessary
  const arrayFormat = format.arrays[0];
  for (const column of arrayFormat.columns) {
    if (
      column.contents === Contents.Color &&
      column.numericType === NumericType.PackedDABC
    ) {
      buffer = unpackPackedColor(buffer, arrayFormat, column);
    }
  }

  // Create vertex buffer
  const device = renderCache.device;
  const vertexBuffer = device.createBuffer(
    buffer.byteLength,
    GfxBufferUsage.Vertex,
    GfxBufferFrequencyHint.Static,
  );
  device.uploadBufferData(vertexBuffer, 0, buffer);

  // Process primitives
  let totalIndexCount = 0;
  const allIndices: number[] = [];

  for (const primitive of geom.primitives) {
    // Get index data if present
    if (primitive.vertices) {
      let indices: Uint16Array | Uint32Array;
      if (primitive.indexType === NumericType.U16) {
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
    device.destroyBuffer(vertexBuffer);
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
  let effectiveBoundsType = geom.boundsType;
  if (
    effectiveBoundsType === BoundsType.Default ||
    effectiveBoundsType === BoundsType.Best
  ) {
    effectiveBoundsType = BoundsType.Sphere;
  }

  const cachedGeometryData: CachedGeometryData = {
    vertexBuffer,
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
    boundsType: effectiveBoundsType,
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
      return 0;
    case Contents.Normal:
      return 1;
    case Contents.Color:
      return 2;
    case Contents.TexCoord:
      return 3;
    default:
      console.warn(
        `Unknown attribute contents: ${enumName(contents, Contents)}`,
      );
      return null;
  }
}

/**
 * Extract material properties from RenderState
 */
export function extractMaterial(
  node: PandaNode,
  renderState: RenderState,
): MaterialData {
  const material: MaterialData = {
    colorType: ColorType.Vertex,
    flatColor: vec4.fromValues(1, 1, 1, 1),
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

  for (const effect of node.effects.effects) {
    if (effect instanceof BillboardEffect) {
      material.billboardEffect = effect;
    } else if (effect instanceof DecalEffect) {
      material.isDecal = true;
    } else {
      console.warn(
        `Unsupported RenderEffects effect type: ${effect.constructor.name}`,
      );
    }
  }

  for (const { attrib } of renderState.attribs) {
    if (attrib instanceof AlphaTestAttrib) {
      material.alphaTestMode = attrib.mode;
      material.alphaTestThreshold = attrib.referenceAlpha;
    } else if (attrib instanceof ColorAttrib) {
      material.colorType = attrib.colorType;
      material.flatColor = attrib.color;
    } else if (attrib instanceof TransparencyAttrib) {
      material.transparencyMode = attrib.mode;
    } else if (attrib instanceof TextureAttrib) {
      if (attrib.offAllStages)
        console.warn("TextureAttrib offAllStages unimplemented");
      if (attrib.offStageRefs.length > 0)
        console.warn(`TextureAttrib offStageRefs unimplemented`);
      if (attrib.onStages.length > 0) {
        if (attrib.onStages.length !== 1)
          console.warn(
            `Multiple texture stages unimplemented (${attrib.onStages.length})`,
          );
        if (!attrib.onStages[0].textureStage.isDefault)
          console.warn(`Non-default TextureStage unimplemented`);
        material.texture = attrib.onStages[0].texture;
      } else if (attrib.texture !== null) {
        material.texture = attrib.texture;
      }
    } else if (attrib instanceof CullBinAttrib) {
      material.cullBinName = attrib.binName;
      material.drawOrder = attrib.drawOrder;
    } else if (attrib instanceof CullFaceAttrib) {
      material.cullFaceMode = attrib.mode;
      material.cullReverse = attrib.reverse;
    } else if (attrib instanceof DepthTestAttrib) {
      material.depthTestMode = attrib.mode;
    } else if (attrib instanceof DepthWriteAttrib) {
      material.depthWrite = attrib.mode;
    } else if (attrib instanceof ColorWriteAttrib) {
      material.colorWriteChannels = attrib.channels;
    } else {
      console.warn(
        `Unsupported RenderState attribute type: ${attrib.constructor.name}`,
      );
    }
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
