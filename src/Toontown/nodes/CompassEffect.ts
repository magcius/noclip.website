import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgFlags, dbgRef } from "./debug";
import { PandaNode } from "./PandaNode";
import { RenderEffect } from "./RenderEffects";

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
  public reference: PandaNode | null = null; // TODO should be a NodePath

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.properties = data.readUint16();
    if (this._version.compare(new AssetVersion(6, 43)) >= 0) {
      this.reference = file.getTyped(data.readObjectId(), PandaNode);
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.properties = this.properties;
    target.reference = this.reference; // TODO should find the cloned node
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

registerBAMObject("CompassEffect", CompassEffect);
