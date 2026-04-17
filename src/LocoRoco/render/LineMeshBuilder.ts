/*
 * Generates a mesh based on a list of line segments.
 *
 * petton-svn, 2026.
 */

import {
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  GfxFormat,
  GfxInputLayout,
  GfxVertexBufferFrequency,
} from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { createBufferFromData } from "../../gfx/helpers/BufferHelpers.js";
import { Color } from "../../Color.js";
import { GpuLineResources } from "../SceneTree.js";

/** Line data for collision visualization (world-space baked, not part of the scene tree). */
export interface LineData extends GpuLineResources {
  color: Color;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Per vertex: cornerT, cornerS, lineStart.x, lineStart.y, lineEnd.x, lineEnd.y
const FLOATS_PER_VERT = 6;
const BYTES_PER_VERT = FLOATS_PER_VERT * 4;

/**
 * Canonical vertex input layout for line-quad meshes. This is the single
 * source of truth — both the mesh builder below and every call site that
 * wants to render a line mesh MUST go through here, so the shader, mesh
 * builder, and input layout can never drift apart. (An earlier version of
 * this code kept a duplicate descriptor in SceneBuilder which silently broke
 * path lines for an entire refactor; don't reintroduce that.)
 *
 * `cache.createInputLayout` is structurally deduplicated, so calling this
 * repeatedly is cheap and returns the same `GfxInputLayout` instance.
 */
export function getLineInputLayout(cache: GfxRenderCache): GfxInputLayout {
  return cache.createInputLayout({
    indexBufferFormat: GfxFormat.U16_R,
    vertexAttributeDescriptors: [
      // a_Corner: (tPick ∈ {0,1}, sPick ∈ {-1,+1})
      { location: 0, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
      // a_LineStart (local xy)
      { location: 1, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 2 * 4 },
      // a_LineEnd (local xy)
      { location: 2, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 4 * 4 },
    ],
    vertexBufferDescriptors: [
      { byteStride: BYTES_PER_VERT, frequency: GfxVertexBufferFrequency.PerVertex },
    ],
  });
}

/**
 * Build a line quad mesh from segments. Each segment becomes a quad whose four
 * vertices carry the segment's endpoints plus a "corner" descriptor; the actual
 * quad expansion is performed in screen space by the vertex shader so it stays
 * projection-independent (works correctly under oblique / perspective cameras).
 *
 * Returns null if segments is empty.
 */
export function buildLineQuadMeshFromSegments(
  cache: GfxRenderCache,
  segments: Segment[],
): GpuLineResources | null {
  if (segments.length === 0) return null;

  const vertices = new Float32Array(segments.length * 4 * FLOATS_PER_VERT);
  const indices = new Uint16Array(segments.length * 6);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const vBase = i * 4 * FLOATS_PER_VERT;

    // v0: start, +perp side
    vertices[vBase + 0] = 0; vertices[vBase + 1] = +1;
    vertices[vBase + 2] = seg.x1; vertices[vBase + 3] = seg.y1;
    vertices[vBase + 4] = seg.x2; vertices[vBase + 5] = seg.y2;
    // v1: start, -perp side
    vertices[vBase + 6] = 0; vertices[vBase + 7] = -1;
    vertices[vBase + 8] = seg.x1; vertices[vBase + 9] = seg.y1;
    vertices[vBase + 10] = seg.x2; vertices[vBase + 11] = seg.y2;
    // v2: end, +perp side
    vertices[vBase + 12] = 1; vertices[vBase + 13] = +1;
    vertices[vBase + 14] = seg.x1; vertices[vBase + 15] = seg.y1;
    vertices[vBase + 16] = seg.x2; vertices[vBase + 17] = seg.y2;
    // v3: end, -perp side
    vertices[vBase + 18] = 1; vertices[vBase + 19] = -1;
    vertices[vBase + 20] = seg.x1; vertices[vBase + 21] = seg.y1;
    vertices[vBase + 22] = seg.x2; vertices[vBase + 23] = seg.y2;

    const iBase = i * 6;
    const vIdx = i * 4;
    indices[iBase + 0] = vIdx;
    indices[iBase + 1] = vIdx + 1;
    indices[iBase + 2] = vIdx + 2;
    indices[iBase + 3] = vIdx + 1;
    indices[iBase + 4] = vIdx + 3;
    indices[iBase + 5] = vIdx + 2;
  }

  const device = cache.device;
  const vbo = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer);
  const ibo = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);

  return {
    vertexBuffer: vbo,
    indexBuffer: ibo,
    inputLayout: getLineInputLayout(cache),
    vertexBufferDescriptors: [{ buffer: vbo, byteOffset: 0 }],
    indexBufferDescriptor: { buffer: ibo, byteOffset: 0 },
    indexCount: indices.length,
  };
}

export function buildLineQuadMeshFromPoints(
  cache: GfxRenderCache,
  paths: { x: number; y: number }[][],
): GpuLineResources | null {
  const segments: Segment[] = [];
  for (const points of paths)
    for (let i = 0; i < points.length - 1; i++)
      segments.push({ x1: points[i].x, y1: points[i].y, x2: points[i + 1].x, y2: points[i + 1].y });
  return buildLineQuadMeshFromSegments(cache, segments);
}
