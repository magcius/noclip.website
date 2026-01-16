import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import { type DebugInfo, dbgEnum } from "./debug";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

/**
 * TextureApplyAttrib - Legacy texture apply mode (pre-5.0)
 *
 * This was replaced by TextureStage in BAM 5.0+
 */
export enum TextureApplyMode {
  Modulate = 0,
  Decal = 1,
  Blend = 2,
  Replace = 3,
  Add = 4,
}

export class TextureApplyAttrib extends TypedObject {
  public mode = TextureApplyMode.Modulate;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.mode = data.readUint8() as TextureApplyMode;
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.mode = this.mode;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, TextureApplyMode));
    return info;
  }
}

registerTypedObject("TextureApplyAttrib", TextureApplyAttrib);
