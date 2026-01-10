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
import { Geom } from "./Geom";
import { PandaNode } from "./PandaNode";
import { RenderState } from "./RenderState";

export interface GeomEntry {
  geom: Geom;
  state: RenderState | null;
}

export class GeomNode extends PandaNode {
  public geoms: GeomEntry[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    // Cycler data
    const numGeoms = data.readUint16();
    this.geoms = new Array(numGeoms);
    for (let i = 0; i < numGeoms; i++) {
      const geomRef = data.readObjectId();
      const geom = file.getTyped(geomRef, Geom);
      if (!geom)
        throw new Error(`Geom reference @${geomRef} not found in file`);

      const stateRef = data.readObjectId();
      const state = file.getTyped(stateRef, RenderState);

      this.geoms[i] = { geom, state };
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.geoms = this.geoms; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set(
      "geoms",
      dbgArray(
        this.geoms.map(({ geom, state }) =>
          dbgObject(
            dbgFields([
              ["geom", dbgRef(geom)],
              ["state", dbgRef(state)],
            ]),
            // true, // compact
          ),
        ),
      ),
    );
    return info;
  }
}

registerBAMObject("GeomNode", GeomNode);
