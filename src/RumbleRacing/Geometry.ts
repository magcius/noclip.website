import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import {
  GfxVertexBufferFrequency,
  GfxBufferUsage,
  GfxBufferFrequencyHint,
  GfxDevice,
  GfxIndexBufferDescriptor,
  GfxSamplerBinding,
  GfxVertexBufferDescriptor,
} from "../gfx/platform/GfxPlatform";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxBuffer, GfxInputLayout } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { BlendMode } from "./asset/o3d/geometry";
import {
  ExcludeInfo,
  JsonBuffer,
  O3DData,
  ObfData,
  ObfJsonNode,
} from "./rumbleRacing";
import { TrackProgram } from "./TrackProgram";

// position (3), uv (2), normal (3), color (4).
const VERTEX_STRIDE = 12;

// One merged draw call: every source buffer that shared a material got
// concatenated into this one vertex/index buffer pair.
export interface DrawBatch {
  indexCount: number;
  textureId: number;
  hasVertexColors: boolean;
  blendMode: BlendMode;

  vertexBuffer: GfxBuffer;
  indexBuffer: GfxBuffer;

  // The descriptors handed to the render inst every frame. Built once and never
  // mutated, since GfxRenderInst holds onto the array it's given -- the submit
  // path shouldn't be allocating per draw call per frame.
  vertexBufferDescriptors: GfxVertexBufferDescriptor[];
  indexBufferDescriptor: GfxIndexBufferDescriptor;
  // Resolved from textureId once the scene's textures exist.
  samplerBindings: GfxSamplerBinding[] | null;
}

function collectBuffers(
  node: ObfJsonNode,
  exclude: ExcludeInfo,
  out: JsonBuffer[],
): void {
  if (node === undefined || node === null) return;

  if (node.buffers) {
    for (const buffer of node.buffers) {
      if (buffer.positions.length === 0) continue;

      // don't draw some unhandled textures
      if (exclude.textureIds?.has(buffer.textureId)) continue;

      out.push(buffer);
    }
  }

  if (node.children) {
    for (const child of node.children) collectBuffers(child, exclude, out);
  }
}

function buildBatch(device: GfxDevice, group: JsonBuffer[]): DrawBatch {
  let totalVertices = 0;
  let totalIndices = 0;
  for (const buffer of group) {
    totalVertices += buffer.positions.length;
    totalIndices += buffer.indices.length;
  }

  const vertexData = new Float32Array(totalVertices * VERTEX_STRIDE);
  const indexData = new Uint32Array(totalIndices);

  let vertexBase = 0;
  let indexOffs = 0;

  for (const buffer of group) {
    for (let i = 0; i < buffer.positions.length; i++) {
      let offs = (vertexBase + i) * VERTEX_STRIDE;

      vertexData[offs++] = buffer.positions[i][0];
      vertexData[offs++] = buffer.positions[i][1];
      vertexData[offs++] = buffer.positions[i][2];

      vertexData[offs++] = buffer.uvs[i][0];
      vertexData[offs++] = buffer.uvs[i][1];

      vertexData[offs++] = buffer.normals[i][0];
      vertexData[offs++] = buffer.normals[i][1];
      vertexData[offs++] = buffer.normals[i][2];

      vertexData[offs++] = buffer.colors[i].r;
      vertexData[offs++] = buffer.colors[i].g;
      vertexData[offs++] = buffer.colors[i].b;
      vertexData[offs++] = buffer.colors[i].a;
    }

    // Indices are per-buffer, so they have to be rebased onto the merged buffer.
    for (let i = 0; i < buffer.indices.length; i++)
      indexData[indexOffs++] = vertexBase + buffer.indices[i];

    vertexBase += buffer.positions.length;
  }

  const vertexBuffer = createBufferFromData(
    device,
    GfxBufferUsage.Vertex,
    GfxBufferFrequencyHint.Static,
    vertexData.buffer,
  );
  const indexBuffer = createBufferFromData(
    device,
    GfxBufferUsage.Index,
    GfxBufferFrequencyHint.Static,
    indexData.buffer,
  );

  return {
    indexCount: totalIndices,
    textureId: group[0].textureId,
    hasVertexColors: group[0].hasVertexColors,
    blendMode: group[0].blendMode,
    vertexBuffer,
    indexBuffer,
    vertexBufferDescriptors: [{ buffer: vertexBuffer, byteOffset: 0 }],
    indexBufferDescriptor: { buffer: indexBuffer, byteOffset: 0 },
    samplerBindings: null,
  };
}

export class MergedGeometry {
  public batches: DrawBatch[] = [];
  public inputLayout: GfxInputLayout;

  constructor(cache: GfxRenderCache, obfs: ObfData[], exclude: ExcludeInfo) {
    const device = cache.device;

    this.inputLayout = cache.createInputLayout({
      vertexAttributeDescriptors: [
        {
          location: TrackProgram.a_Position,
          format: GfxFormat.F32_RGB,
          bufferByteOffset: 0,
          bufferIndex: 0,
        },
        {
          location: TrackProgram.a_TexCoord,
          format: GfxFormat.F32_RG,
          bufferByteOffset: 3 * 4,
          bufferIndex: 0,
        },
        {
          location: TrackProgram.a_Normal,
          format: GfxFormat.F32_RGB,
          bufferByteOffset: 5 * 4,
          bufferIndex: 0,
        },
        {
          location: TrackProgram.a_Color,
          format: GfxFormat.F32_RGBA,
          bufferByteOffset: 8 * 4,
          bufferIndex: 0,
        },
      ],
      vertexBufferDescriptors: [
        {
          byteStride: VERTEX_STRIDE * 4,
          frequency: GfxVertexBufferFrequency.PerVertex,
        },
      ],
      indexBufferFormat: GfxFormat.U32_R,
    });

    const sourceBuffers: JsonBuffer[] = [];
    for (const obf of obfs) {
      if (obf && obf.rootNode) collectBuffers(obf.rootNode, exclude, sourceBuffers);
    }

    // The PS2 split geometry into buffers small enough to fit VU1's 16KB of
    // data memory, which works out to around 40 triangles apiece. Honouring that
    // split here costs one draw call per buffer -- several thousand a frame on
    // the bigger tracks -- for no benefit, so everything that would draw with
    // the same pipeline and texture gets concatenated into a single batch.
    const groups = new Map<string, JsonBuffer[]>();
    for (const buffer of sourceBuffers) {
      const key = `${buffer.textureId}|${buffer.blendMode}|${buffer.hasVertexColors ? 1 : 0}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = [];
        groups.set(key, group);
      }
      group.push(buffer);
    }

    for (const group of groups.values())
      this.batches.push(buildBatch(device, group));
  }

  public destroy(device: GfxDevice): void {
    for (const batch of this.batches) {
      device.destroyBuffer(batch.vertexBuffer);
      device.destroyBuffer(batch.indexBuffer);
    }
  }
}

export class O3DGeometry {
  // An animated o3d draws exactly one of its obfs per frame, so each one stays
  // separate. A static one draws all of them together, so they all merge.
  public frames: MergedGeometry[] = [];
  public animationFrame = 0;
  public isAnimated: boolean;

  constructor(cache: GfxRenderCache, o3d: O3DData, exclude: ExcludeInfo) {
    this.isAnimated = o3d.isAnimated;

    if (this.isAnimated) {
      for (const obf of o3d.obfs)
        this.frames.push(new MergedGeometry(cache, [obf], exclude));
    } else {
      this.frames.push(new MergedGeometry(cache, o3d.obfs, exclude));
    }
  }

  public destroy(device: GfxDevice): void {
    for (const frame of this.frames) frame.destroy(device);
  }
}
