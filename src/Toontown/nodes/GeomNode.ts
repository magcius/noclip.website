import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgFields,
  dbgObject,
  dbgRef,
} from "./debug";
import { PandaNode } from "./PandaNode";

export class GeomNode extends PandaNode {
  public geomRefs: [number, number][] = [];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // Cycler data
    const numGeoms = data.readUint16();
    for (let i = 0; i < numGeoms; i++) {
      const geomRef = data.readObjectId();
      const renderStateRef = data.readObjectId();
      this.geomRefs.push([geomRef, renderStateRef]);
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set(
      "geomRefs",
      dbgArray(
        this.geomRefs.map(([geomRef, stateRef]) =>
          dbgObject(
            dbgFields([
              ["geom", dbgRef(geomRef)],
              ["state", dbgRef(stateRef)],
            ]),
            true, // compact
          ),
        ),
      ),
    );
    return info;
  }
}

registerBAMObject("GeomNode", GeomNode);
