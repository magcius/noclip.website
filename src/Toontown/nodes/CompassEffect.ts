import type { BAMFile } from "../BAMFile";
import { AssetVersion } from "../Common";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgFlags, dbgRef } from "./debug";
import { PandaNode } from "./PandaNode";
import { RenderEffect } from "./RenderEffects";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export const CompassEffectProperties = {
  X: 0x1,
  Y: 0x2,
  Z: 0x4,
  Position: 0x7,
  Rotation: 0x8,
  ScaleX: 0x10,
  ScaleY: 0x20,
  ScaleZ: 0x40,
  Scale: 0x70,
  All: 0x7f,
};

export class CompassEffect extends RenderEffect {
  public properties = 0;
  public reference: PandaNode | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.properties = data.readUint16();
    if (this._version.compare(new AssetVersion(6, 43)) >= 0) {
      this.reference = file.getTyped(data.readObjectId(), PandaNode);
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.properties = this.properties;
    target.reference = ctx.clone(this.reference);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("properties", dbgFlags(this.properties, CompassEffectProperties));
    if (this._version.compare(new AssetVersion(6, 43)) >= 0) {
      info.set("reference", dbgRef(this.reference));
    }
    return info;
  }

  static create(properties: number, reference: PandaNode): CompassEffect {
    const effect = new CompassEffect();
    effect.properties = properties;
    effect.reference = reference;
    return effect;
  }
}

registerTypedObject("CompassEffect", CompassEffect);
