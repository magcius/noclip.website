import {
  GfxDevice
} from "../gfx/platform/GfxPlatform.js";
import { TextureHolder } from "../TextureHolder.js";
import { SCX } from './scx/types.js';
import { Texture } from './types.js';
import { SceneGfx, ViewerRenderInput } from "../viewer.js";

type Context = {
  basePath: string,
  scenes: Record<string, SCX.Scene>,
  textures: Texture[],
  envTextures: Texture[],
  cameras: [string, string][],
};

export default class Renderer implements SceneGfx {
  constructor(device: GfxDevice, context: Context, public textureHolder: TextureHolder<any>) {
    // TODO
  }
  
  render(device: GfxDevice, renderInput: ViewerRenderInput): void {
    // TODO
  }

  destroy(device: GfxDevice): void {
    // TODO
  }
}