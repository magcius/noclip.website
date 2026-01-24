import type { BAMFile } from "../BAMFile";
import { AssetVersion } from "../Common";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgNum, dbgRefs } from "./debug";
import { InternalName } from "./InternalName";
import { SparseArray } from "./SparseArray";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";
import { VertexSlider } from "./VertexSlider";

export interface SliderTableEntry {
  name: InternalName | null;
  slider: VertexSlider | null;
  rows: SparseArray;
}

export class SliderTable extends TypedObject {
  public sliders: SliderTableEntry[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    const numSliders = data.readUint16();
    this.sliders = new Array(numSliders);

    for (let i = 0; i < numSliders; i++) {
      const name = file.getTyped(data.readObjectId(), InternalName);
      const slider = file.getTyped(data.readObjectId(), VertexSlider);
      const rows = new SparseArray();
      if (this._version.compare(new AssetVersion(6, 7)) >= 0) {
        rows.load(data);
      }
      this.sliders[i] = { name, slider, rows };
      if (slider && !slider.name) {
        slider.name = name;
      }
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.sliders = this.sliders.map((entry) => ({
      name: ctx.clone(entry.name),
      slider: ctx.clone(entry.slider),
      rows: entry.rows,
    }));
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("numSliders", dbgNum(this.sliders.length));
    info.set("sliders", dbgRefs(this.sliders.map((entry) => entry.slider)));
    return info;
  }
}

registerTypedObject("SliderTable", SliderTable);
