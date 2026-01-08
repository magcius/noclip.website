import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgFlags, dbgNum, dbgRefs } from "./debug";
import { PandaNode } from "./PandaNode";

const CollisionNodeFlags = {
  IntoCollideOff: 0x01,
};

export class CollisionNode extends PandaNode {
  public solidRefs: number[] = [];
  public fromCollideMask: number = 0;
  public collisionNodeFlags: number = 0;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // Read number of solids (extended format added in 6.x)
    let numSolids = data.readUint16();
    if (
      this._version.compare(new AssetVersion(5, 0)) >= 0 &&
      numSolids === 0xffff
    ) {
      numSolids = data.readUint32();
    }
    for (let i = 0; i < numSolids; i++) {
      this.solidRefs.push(data.readObjectId());
    }

    this.fromCollideMask = data.readUint32();

    // Pre-4.12: into_collide_mask and flags were in CollisionNode
    // 4.12+: into_collide_mask moved to PandaNode
    if (this._version.compare(new AssetVersion(4, 12)) < 0) {
      this.intoCollideMask = data.readUint32();
      this.collisionNodeFlags = data.readUint8();
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("solidRefs", dbgRefs(this.solidRefs));
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

registerBAMObject("CollisionNode", CollisionNode);
