import { GfxBuffer } from "../gfx/platform/GfxPlatformImpl";

export interface ExcludeInfo {
  textureIds?: Set<number>;
  nodeIds?: Set<number>;
}

export interface DrawCall {
  vertexBuffer: GfxBuffer;
  indexBuffer: GfxBuffer;
  indexCount: number;
  textureId: number;
}
