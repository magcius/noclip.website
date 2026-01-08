import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgFields,
  dbgNum,
  dbgObject,
  dbgRef,
} from "./debug";

export class RenderState extends BAMObject {
  public attribRefs: [number, number][] = [];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    const numAttribs = data.readUint16();
    for (let i = 0; i < numAttribs; i++) {
      const attribRef = data.readObjectId();
      const priority = data.readInt32();
      this.attribRefs.push([attribRef, priority]);
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set(
      "attribs",
      dbgArray(
        this.attribRefs.map(([ref, priority]) =>
          dbgObject(
            dbgFields([
              ["ref", dbgRef(ref)],
              ["priority", dbgNum(priority)],
            ]),
            true,
          ),
        ),
      ),
    );
    return info;
  }
}

registerBAMObject("RenderState", RenderState);
