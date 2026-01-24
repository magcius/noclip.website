import type { ReadonlyMat4 } from "gl-matrix";
import { AABB } from "../../Geometry";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
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
import { type CopyContext, registerTypedObject } from "./TypedObject";

export interface GeomEntry {
  geom: Geom;
  state: RenderState | null;
}

export class GeomNode extends PandaNode {
  public geoms: GeomEntry[] = [];

  private _aabb: AABB | null = null;

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

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.geoms = this.geoms.map(({ geom, state }) => ({
      geom: ctx.clone(geom),
      state: ctx.clone(state),
    }));
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

  override getBoundingBox(): AABB {
    if (!this._aabb) {
      this._aabb = new AABB();
      for (const { geom } of this.geoms) {
        this._aabb.union(this._aabb, geom.getBoundingBox());
      }
      this.unionChildrenBounds(this._aabb);
    }
    return this._aabb;
  }

  protected override accumulateBounds(
    aabb: AABB,
    netTransform: ReadonlyMat4,
  ): void {
    for (const { geom } of this.geoms) {
      geom.accumulateBounds(aabb, netTransform);
    }
    super.accumulateBounds(aabb, netTransform);
  }
}

registerTypedObject("GeomNode", GeomNode);
