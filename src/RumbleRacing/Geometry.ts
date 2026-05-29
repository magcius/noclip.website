import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import {
  GfxVertexBufferFrequency,
  GfxBufferUsage,
  GfxBufferFrequencyHint,
  GfxDevice,
} from "../gfx/platform/GfxPlatform";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxInputLayout } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { TrackProgram } from "./TrackProgram";
import { DrawCall, ObfData, ExcludeInfo, ObfJsonNode, O3DData } from "./types";

export class ObfGeometry {
  public drawCalls: DrawCall[] = [];
  public inputLayout: GfxInputLayout;

  constructor(cache: GfxRenderCache, obf: ObfData, exclude: ExcludeInfo) {
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
      ],
      vertexBufferDescriptors: [
        { byteStride: 8 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
      ],
      indexBufferFormat: GfxFormat.U32_R,
    });

    const parseNode = (node: ObfJsonNode) => {
      if (node && node.Buffers) {
        // don't draw some weird geometry
        if (exclude.nodeIds?.has(node.HeaderOffset)) {
          return;
        }

        for (const buffer of node.Buffers) {
          if (buffer.Vertices.length === 0) continue;

          // don't draw some unhandled textures
          if (exclude.textureIds?.has(buffer.TextureId)) {
            continue;
          }

          const data = new Float32Array(buffer.Vertices.length * 8);
          for (let i = 0; i < buffer.Vertices.length; i++) {
            data[i * 8 + 0] = buffer.Vertices[i][0];
            data[i * 8 + 1] = buffer.Vertices[i][1];
            data[i * 8 + 2] = buffer.Vertices[i][2];

            data[i * 8 + 3] = buffer.UVs[i][0];
            data[i * 8 + 4] = buffer.UVs[i][1];

            data[i * 8 + 5] = buffer.Normals[i][0];
            data[i * 8 + 6] = buffer.Normals[i][1];
            data[i * 8 + 7] = buffer.Normals[i][2];
          }

          const vBuf = createBufferFromData(
            device,
            GfxBufferUsage.Vertex,
            GfxBufferFrequencyHint.Static,
            data.buffer,
          );
          const iBuf = createBufferFromData(
            device,
            GfxBufferUsage.Index,
            GfxBufferFrequencyHint.Static,
            new Uint32Array(buffer.Indices).buffer,
          );

          this.drawCalls.push({
            vertexBuffer: vBuf,
            indexBuffer: iBuf,
            indexCount: buffer.Indices.length,
            textureId: buffer.TextureId,
          });
        }
      }
      if (node && node.Children) {
        for (const child of node.Children) parseNode(child);
      }
    };

    if (obf && obf.RootNode) {
      parseNode(obf.RootNode);
    }
  }

  public destroy(device: GfxDevice): void {
    for (const dc of this.drawCalls) {
      device.destroyBuffer(dc.vertexBuffer);
      device.destroyBuffer(dc.indexBuffer);
    }
  }
}
export class O3DGeometry {
  public obfGeometries: ObfGeometry[] = [];
  public animationFrame = 0;
  public isAnimated;

  constructor(cache: GfxRenderCache, o3d: O3DData, exclude: ExcludeInfo) {
    this.isAnimated = o3d.IsAnimated;
    for (const obf of o3d.Obfs) {
      this.obfGeometries.push(new ObfGeometry(cache, obf, exclude));
    }
  }

  public destroy(device: GfxDevice): void {
    for (const g of this.obfGeometries) g.destroy(device);
  }
}
