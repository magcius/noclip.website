import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgBool,
  dbgEnum,
  dbgNum,
  dbgObject,
  dbgRefs,
} from "./debug";
import { AnimationType } from "./geomEnums";

export class GeomVertexAnimationSpec {
  public animationType: AnimationType;
  public numTransforms: number;
  public indexedTransforms: boolean;

  constructor(data: DataStream) {
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

export class GeomVertexFormat extends BAMObject {
  public animation: GeomVertexAnimationSpec;
  public arrayRefs: number[] = [];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    this.animation = new GeomVertexAnimationSpec(data);

    const numArrays = data.readUint16();
    for (let i = 0; i < numArrays; i++) {
      this.arrayRefs.push(data.readObjectId());
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("animation", dbgObject(this.animation.getDebugInfo()));
    info.set("arrayRefs", dbgRefs(this.arrayRefs));
    return info;
  }
}

registerBAMObject("GeomVertexFormat", GeomVertexFormat);
