import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import {
  type DebugInfo,
  dbgBool,
  dbgEnum,
  dbgNum,
  dbgObject,
  dbgRefs,
} from "./debug";
import { GeomVertexArrayFormat } from "./GeomVertexArrayFormat";
import { AnimationType } from "./geomEnums";
import {
  type CopyContext,
  readTypedRefs,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

export class GeomVertexAnimationSpec {
  public animationType = AnimationType.None;
  public numTransforms = 0;
  public indexedTransforms = false;

  load(data: DataStream) {
    this.animationType = data.readUint8() as AnimationType;
    this.numTransforms = data.readUint16();
    this.indexedTransforms = data.readBool();
  }

  getDebugInfo(): DebugInfo {
    const info: DebugInfo = new Map();
    info.set("animationType", dbgEnum(this.animationType, AnimationType));
    info.set("numTransforms", dbgNum(this.numTransforms));
    info.set("indexedTransforms", dbgBool(this.indexedTransforms));
    return info;
  }
}

export class GeomVertexFormat extends TypedObject {
  public animation = new GeomVertexAnimationSpec();
  public arrays: GeomVertexArrayFormat[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.animation.load(data);
    const numArrays = data.readUint16();
    this.arrays = readTypedRefs(file, data, numArrays, GeomVertexArrayFormat);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.animation = this.animation; // Shared
    target.arrays = ctx.cloneArray(this.arrays);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this.animation) {
      info.set("animation", dbgObject(this.animation.getDebugInfo()));
    }
    info.set("arrays", dbgRefs(this.arrays));
    return info;
  }
}

registerTypedObject("GeomVertexFormat", GeomVertexFormat);
