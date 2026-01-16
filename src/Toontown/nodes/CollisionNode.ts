import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import { CollisionSolid } from "./CollisionSolid";
import { type DebugInfo, dbgFlags, dbgNum, dbgRefs } from "./debug";
import { PandaNode } from "./PandaNode";
import {
  type CopyContext,
  readTypedRefs,
  registerTypedObject,
} from "./TypedObject";

const CollisionNodeFlags = {
  IntoCollideOff: 0x01,
};

export class CollisionNode extends PandaNode {
  public solids: CollisionSolid[] = [];
  public fromCollideMask = 0;
  public collisionNodeFlags = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    // Read number of solids (extended format added in 6.x)
    let numSolids = data.readUint16();
    if (
      this._version.compare(new AssetVersion(5, 0)) >= 0 &&
      numSolids === 0xffff
    ) {
      numSolids = data.readUint32();
    }
    this.solids = readTypedRefs(file, data, numSolids, CollisionSolid);

    this.fromCollideMask = data.readUint32();

    // Pre-4.12: into_collide_mask and flags were in CollisionNode
    // 4.12+: into_collide_mask moved to PandaNode
    if (this._version.compare(new AssetVersion(4, 12)) < 0) {
      this.intoCollideMask = data.readUint32();
      this.collisionNodeFlags = data.readUint8();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.solids = ctx.cloneArray(this.solids);
    target.fromCollideMask = this.fromCollideMask;
    target.collisionNodeFlags = this.collisionNodeFlags;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("solids", dbgRefs(this.solids));
    info.set("fromCollideMask", dbgNum(this.fromCollideMask));
    if (this._version.compare(new AssetVersion(4, 12)) < 0) {
      info.set(
        "collisionNodeFlags",
        dbgFlags(this.collisionNodeFlags, CollisionNodeFlags),
      );
    }
    return info;
  }
}

registerTypedObject("CollisionNode", CollisionNode);
