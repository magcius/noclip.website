import { mat4, type ReadonlyMat4, vec3, vec4 } from "gl-matrix";
import { AABB } from "../Geometry";
import {
  type GfxBuffer,
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  type GfxDevice,
  GfxFormat,
  type GfxInputLayout,
  type GfxInputLayoutBufferDescriptor,
  type GfxSampler,
  type GfxTexture,
  type GfxVertexAttributeDescriptor,
  GfxVertexBufferFrequency,
} from "../gfx/platform/GfxPlatform";
import type { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { TextureMapping } from "../TextureHolder";
import { enumName } from "./common";
import {
  BillboardEffect,
  ColorAttrib,
  ColorType,
  Contents,
  CullBinAttrib,
  CullFaceAttrib,
  CullFaceMode,
  DecalEffect,
  DepthWriteAttrib,
  DepthWriteMode,
  type Geom,
  GeomNode,
  GeomTriangles,
  GeomTrifans,
  GeomTristrips,
  type GeomVertexArrayFormat,
  type GeomVertexColumn,
  NumericType,
  type PandaNode,
  type RenderAttribEntry,
  type Texture,
  TextureAttrib,
  TransparencyAttrib,
  TransparencyMode,
} from "./nodes";

/**
 * GPU-ready geometry data
 */
export interface ToontownGeometryData {
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
  worldAABB: AABB;
}

/**
 * Material properties extracted from RenderState
 */
interface MaterialData {
  colorType: ColorType;
  flatColor: vec4;
  transparencyMode: TransparencyMode;
  texture: Texture | null;
  cullBinName: string | null;
  drawOrder: number | null;
  cullFaceMode: CullFaceMode;
  cullReverse: boolean;
  depthWrite: boolean;
  isDecal: boolean;
  billboardEffect: BillboardEffect | null;
}

/**
 * Collected geometry ready for rendering
 */
export interface CollectedGeometry {
  node: GeomNode;
  geom: Geom;
  netTransform: mat4;
  localAABB: AABB;
  attribs: RenderAttribEntry[];
}

/**
 * A group of base geometry and its associated decal geometry,
 * to be rendered using the three-pass decal technique.
 */
export interface DecalGroup {
  /** Base geometry (the parent GeomNode with DecalEffect) */
  baseGeometries: CollectedGeometry[];
  /** Decal geometries (children of the base GeomNode) */
  decalGeometries: CollectedGeometry[];
  /** Combined world AABB for frustum culling */
  worldAABB: AABB;
}

/**
 * Result of collecting scene geometry
 */
interface CollectedSceneData {
  regularGeometry: CollectedGeometry[];
  decalGroups: DecalGroup[];
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
function composeDrawMask(
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
function isNodeVisible(drawMask: number): boolean {
  return (drawMask & OVERALL_BIT) !== 0 && (drawMask & CAMERA_MASK) !== 0;
}

/**
 * Combine new render attributes into existing attribute list based on priority.
 */
function combineAttributes(
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
 * Collect geometry with optional node name filter
 * If nodeName is provided, only collect geometry from that node and its children
 */
export function collectGeometry(scene: PandaNode): CollectedSceneData {
  const regularGeometry: CollectedGeometry[] = [];
  const decalGroups: DecalGroup[] = [];

  // Recursive traversal function starting from the found node
  function traverse(
    node: PandaNode,
    parentTransform: ReadonlyMat4,
    parentDrawMask: number,
    parentAttribs: RenderAttribEntry[],
  ): void {
    // Compose draw mask for this node
    const runningDrawMask = composeDrawMask(
      parentDrawMask,
      node.drawControlMask,
      node.drawShowMask,
    );

    // Check visibility against camera mask
    if (!isNodeVisible(runningDrawMask)) {
      return;
    }

    // Accumulate transform
    const localTransform = node.transform.getMatrix();
    const netTransform = mat4.create();
    mat4.multiply(netTransform, parentTransform, localTransform);

    // Combine render attributes
    const attribs = combineAttributes(parentAttribs, node.state.attribs);

    // If this is a GeomNode, collect its geometry normally
    if (node instanceof GeomNode) {
      // If this has a DecalEffect, handle as decal group
      if (
        // extra?.forceDecal ||
        node.effects.effects.some((effect) => effect instanceof DecalEffect)
      ) {
        const group = collectDecalGroup(node, netTransform, attribs);
        if (group) {
          decalGroups.push(group);
        }
        return;
      }

      for (const { geom, state } of node.geoms) {
        const localAABB = computeAABBFromGeom(geom);
        let geomAttribs = attribs;
        if (state) geomAttribs = combineAttributes(attribs, state.attribs);
        regularGeometry.push({
          node,
          geom,
          netTransform,
          localAABB,
          attribs: geomAttribs,
        });
      }
    }

    // Traverse children
    for (const [child, _sort] of node.children) {
      traverse(child, netTransform, runningDrawMask, attribs);
    }
  }

  // Start traversal from the found node with all bits on (default visibility)
  traverse(scene, mat4.create(), 0xffffffff, []);

  return { regularGeometry, decalGroups };
}

/**
 * Collect a decal group starting from a GeomNode with DecalEffect.
 * The node's geoms become base geometry, and all children become decal geometry.
 */
function collectDecalGroup(
  baseNode: GeomNode,
  netTransform: mat4,
  baseAttribs: RenderAttribEntry[],
): DecalGroup | null {
  const baseGeometries: CollectedGeometry[] = [];
  const decalGeometries: CollectedGeometry[] = [];
  const combinedAABB = new AABB();

  // Collect base geometry (the GeomNode with DecalEffect)
  for (const { geom, state } of baseNode.geoms) {
    const localAABB = computeAABBFromGeom(geom);
    const worldAABB = new AABB();
    worldAABB.transform(localAABB, netTransform);
    combinedAABB.union(combinedAABB, worldAABB);

    let attribs = baseAttribs;
    if (state) attribs = combineAttributes(baseAttribs, state.attribs);

    baseGeometries.push({
      node: baseNode,
      geom,
      netTransform,
      localAABB,
      attribs,
    });
  }

  // Recursively collect all children as decal geometry
  function collectChildDecals(
    node: PandaNode,
    parentTransform: mat4,
    parentAttribs: RenderAttribEntry[],
  ): void {
    const localTransform = node.transform.getMatrix();
    const childNetTransform = mat4.create();
    mat4.multiply(childNetTransform, parentTransform, localTransform);

    // Combine render attributes
    const attribs = combineAttributes(parentAttribs, node.state.attribs);

    if (node instanceof GeomNode) {
      for (const { geom, state } of node.geoms) {
        const localAABB = computeAABBFromGeom(geom);
        const worldAABB = new AABB();
        worldAABB.transform(localAABB, childNetTransform);
        combinedAABB.union(combinedAABB, worldAABB);

        let geomAttribs = attribs;
        if (state) geomAttribs = combineAttributes(attribs, state.attribs);

        decalGeometries.push({
          node,
          geom,
          netTransform: mat4.clone(childNetTransform),
          localAABB,
          attribs: geomAttribs,
        });
      }
    }

    // Continue recursing
    for (const [child, _sort] of node.children) {
      collectChildDecals(child, childNetTransform, attribs);
    }
  }

  for (const [child, _sort] of baseNode.children) {
    collectChildDecals(child, netTransform, baseAttribs);
  }

  if (baseGeometries.length === 0) {
    return null;
  }

  return {
    baseGeometries,
    decalGeometries,
    worldAABB: combinedAABB,
  };
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

/**
 * Create GPU geometry from Panda3D Geom
 */
export function createGeometryData(
  device: GfxDevice,
  cache: GfxRenderCache,
  collected: CollectedGeometry,
  textureCache: Map<string, { texture: GfxTexture; sampler: GfxSampler }>,
): ToontownGeometryData | null {
  const { node, geom, netTransform, localAABB, attribs } = collected;

  // Extract material properties
  const material = extractMaterial(node, attribs);

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
  for (let arrayIdx = 0; arrayIdx < format.arrays.length; arrayIdx++) {
    const arrayFormat = format.arrays[arrayIdx];

    vertexBufferDescriptors.push({
      byteStride: arrayFormat.stride,
      frequency: GfxVertexBufferFrequency.PerVertex,
    });

    for (const column of arrayFormat.columns) {
      const location = getAttributeLocation(column.contents);
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
    console.warn("No vertex arrays");
    return null;
  }

  if (vertexData.arrays.length > 1) {
    throw new Error("Multiple vertex arrays not yet supported");
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

  // Setup texture mapping
  const textureMapping = new TextureMapping();
  if (material.texture) {
    const cached = textureCache.get(material.texture.name);
    if (!cached) {
      throw new Error(`Texture not cached: ${material.texture.name}`);
    }
    textureMapping.gfxTexture = cached.texture;
    textureMapping.gfxSampler = cached.sampler;
  }

  // Compute world-space AABB by transforming local AABB
  const worldAABB = new AABB();
  worldAABB.transform(localAABB, netTransform);

  return {
    vertexBuffer,
    indexBuffer,
    inputLayout,
    indexCount: totalIndexCount,
    indexFormat: GfxFormat.U32_R,
    hasNormals,
    hasColors,
    hasTexCoords,
    modelMatrix: netTransform,
    material,
    textureMapping,
    worldAABB,
  };
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
function getAttributeLocation(contents: Contents): number {
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
      throw new Error(
        `Unknown attribute contents: ${enumName(contents, Contents)}`,
      );
  }
}

/**
 * Extract material properties from RenderState
 */
function extractMaterial(
  node: PandaNode,
  attribs: RenderAttribEntry[],
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
    depthWrite: true,
    isDecal: false,
    billboardEffect: null,
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

  for (const { attrib } of attribs) {
    if (attrib instanceof ColorAttrib) {
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
    } else if (attrib instanceof DepthWriteAttrib) {
      material.depthWrite = attrib.mode === DepthWriteMode.On;
    } else {
      console.warn(
        `Unsupported RenderState attribute type: ${attrib.constructor.name}`,
      );
    }
  }

  if (node.tags.has("sky")) {
    // console.log("found sky!", material);
    // material.depthWrite = false;
    // material.cullBinName = "background";
  }

  return material;
}

/**
 * Compute AABB from vertex data by reading vertex positions
 */
function computeAABBFromGeom(geom: Geom): AABB {
  const aabb = new AABB();

  const vertexData = geom.data;
  if (!vertexData) throw new Error("Missing vertex data for geom");

  const format = vertexData.format;
  if (!format) throw new Error("Missing vertex format");

  // Find the vertex position column
  let positionColumn: GeomVertexColumn | null = null;
  let positionArrayIdx = -1;
  let positionArrayFormat: GeomVertexArrayFormat | null = null;

  for (let arrayIdx = 0; arrayIdx < format.arrays.length; arrayIdx++) {
    const arrayFormat = format.arrays[arrayIdx];
    for (const column of arrayFormat.columns) {
      if (column.contents === Contents.Point) {
        positionColumn = column;
        positionArrayIdx = arrayIdx;
        positionArrayFormat = arrayFormat;
        break;
      }
    }
    if (positionColumn) break;
  }

  if (!positionColumn || positionArrayIdx < 0 || !positionArrayFormat) {
    return aabb;
  }

  // Get the vertex array data
  if (positionArrayIdx >= vertexData.arrays.length) {
    return aabb;
  }

  const arrayData = vertexData.arrays[positionArrayIdx];
  const buffer = arrayData.buffer;
  const stride = positionArrayFormat.stride;
  const offset = positionColumn.start;
  const numComponents = positionColumn.numComponents;
  const numericType = positionColumn.numericType;

  // Calculate number of vertices
  const numVertices = Math.floor(buffer.byteLength / stride);
  if (numVertices === 0) return aabb;

  // Create a DataView for reading
  const dataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  // Read vertex positions and expand AABB
  const pos = vec3.create();
  if (
    numericType === NumericType.F32
    // || (!file.header.useDouble && numericType === NumericType.StdFloat)
  ) {
    if (numComponents === 2) {
      for (let i = 0; i < numVertices; i++) {
        const baseOffset = i * stride + offset;
        pos[0] = dataView.getFloat32(baseOffset, true);
        pos[1] = dataView.getFloat32(baseOffset + 4, true);
        aabb.unionPoint(pos);
      }
    } else if (numComponents === 3) {
      for (let i = 0; i < numVertices; i++) {
        const baseOffset = i * stride + offset;
        pos[0] = dataView.getFloat32(baseOffset, true);
        pos[1] = dataView.getFloat32(baseOffset + 4, true);
        pos[2] = dataView.getFloat32(baseOffset + 8, true);
        aabb.unionPoint(pos);
      }
    } else {
      throw new Error(
        `Unsupported number of components for vertex: ${numComponents}`,
      );
    }
  } else if (
    numericType === NumericType.F64
    // || (file.header.useDouble && numericType === NumericType.StdFloat)
  ) {
    if (numComponents === 2) {
      for (let i = 0; i < numVertices; i++) {
        const baseOffset = i * stride + offset;
        pos[0] = dataView.getFloat64(baseOffset, true);
        pos[1] = dataView.getFloat64(baseOffset + 8, true);
        aabb.unionPoint(pos);
      }
    } else if (numComponents === 3) {
      for (let i = 0; i < numVertices; i++) {
        const baseOffset = i * stride + offset;
        pos[0] = dataView.getFloat64(baseOffset, true);
        pos[1] = dataView.getFloat64(baseOffset + 8, true);
        pos[2] = dataView.getFloat64(baseOffset + 16, true);
        aabb.unionPoint(pos);
      }
    } else {
      throw new Error(
        `Unsupported number of components for vertex: ${numComponents}`,
      );
    }
  } else {
    throw new Error(`Unsupported numeric type for vertex: ${numericType}`);
  }

  return aabb;
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
