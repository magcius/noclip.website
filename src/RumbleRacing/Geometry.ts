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
import {
  DrawCall,
  ExcludeInfo,
  O3DData,
  ObfData,
  ObfJsonNode,
} from "./rumbleRacing";
import { TrackProgram } from "./TrackProgram";

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
        {
          location: TrackProgram.a_Color,
          format: GfxFormat.F32_RGBA,
          bufferByteOffset: 8 * 4,
          bufferIndex: 0,
        },
      ],
      vertexBufferDescriptors: [
        { byteStride: 12 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
      ],
      indexBufferFormat: GfxFormat.U32_R,
    });

    const parseNode = (node: ObfJsonNode) => {
      if (node && node.buffers) {
        // don't draw some weird geometry
        if (exclude.nodeIds?.has(node.headerOffset)) {
          return;
        }

        for (const buffer of node.buffers) {
          if (buffer.positions.length === 0) continue;

          // don't draw some unhandled textures
          if (exclude.textureIds?.has(buffer.textureId)) {
            continue;
          }

          const data = new Float32Array(buffer.positions.length * 12);
          for (let i = 0; i < buffer.positions.length; i++) {
            data[i * 12 + 0] = buffer.positions[i][0];
            data[i * 12 + 1] = buffer.positions[i][1];
            data[i * 12 + 2] = buffer.positions[i][2];

            data[i * 12 + 3] = buffer.uvs[i][0];
            data[i * 12 + 4] = buffer.uvs[i][1];

            data[i * 12 + 5] = buffer.normals[i][0];
            data[i * 12 + 6] = buffer.normals[i][1];
            data[i * 12 + 7] = buffer.normals[i][2];

            data[i * 12 + 8] = buffer.colors[i].r;
            data[i * 12 + 9] = buffer.colors[i].g;
            data[i * 12 + 10] = buffer.colors[i].b;
            data[i * 12 + 11] = buffer.colors[i].a;
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
            new Uint32Array(buffer.indices).buffer,
          );

          this.drawCalls.push({
            vertexBuffer: vBuf,
            indexBuffer: iBuf,
            indexCount: buffer.indices.length,
            textureId: buffer.textureId,
            hasVertexColors: buffer.hasVertexColors,
            translucent: buffer.translucent,
          });
        }
      }
      if (node && node.children) {
        for (const child of node.children) parseNode(child);
      }
    };

    if (obf && obf.rootNode) {
      parseNode(obf.rootNode);
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
    this.isAnimated = o3d.isAnimated;
    for (const obf of o3d.obfs) {
      this.obfGeometries.push(new ObfGeometry(cache, obf, exclude));
    }
  }

  public destroy(device: GfxDevice): void {
    for (const g of this.obfGeometries) g.destroy(device);
  }
}
