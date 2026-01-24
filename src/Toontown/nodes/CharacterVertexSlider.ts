import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { CharacterSlider } from "./CharacterSlider";
import { type DebugInfo, dbgRef } from "./debug";
import { type CopyContext, registerTypedObject } from "./TypedObject";
import { VertexSlider } from "./VertexSlider";

export class CharacterVertexSlider extends VertexSlider {
  public slider: CharacterSlider | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.slider = file.getTyped(data.readObjectId(), CharacterSlider);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.slider = ctx.clone(this.slider);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("slider", dbgRef(this.slider));
    return info;
  }
}

registerTypedObject("CharacterVertexSlider", CharacterVertexSlider);
