import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgRef, dbgRefs, dbgStr } from "./debug";
import { MovingPartMatrix } from "./MovingPartMatrix";

/**
 * CharacterJoint - BAM character joint
 *
 * This extends MovingPartMatrix, which extends MovingPartBase, which extends PartGroup.
 * The inheritance chain is:
 *   CharacterJoint -> MovingPartMatrix -> MovingPartBase -> PartGroup
 *
 * CharacterJoint stores transform matrices for skeletal animation.
 *
 * Version differences:
 * - BAM 6.4+: extra pointer to Character before net_nodes
 */
export class CharacterJoint extends MovingPartMatrix {
  // CharacterJoint fields
  public characterRef: number = 0; // 6.4+ only
  public netNodeRefs: number[] = [];
  public localNodeRefs: number[] = [];
  public initialNetTransformInverse: Float32Array = new Float32Array(16);

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    // Parent reads: PartGroup (name, freeze-joint, children), MovingPartBase (forcedChannelRef),
    // MovingPartMatrix (value, initialValue)
    super(objectId, file, data);

    // CharacterJoint::fillin
    // In BAM 6.4+, there's a pointer to Character
    if (this._version.compare(new AssetVersion(6, 4)) >= 0) {
      this.characterRef = data.readObjectId();
    }

    const numNetNodes = data.readUint16();
    this.netNodeRefs = new Array(numNetNodes);
    for (let i = 0; i < numNetNodes; i++) {
      this.netNodeRefs[i] = data.readObjectId();
    }

    const numLocalNodes = data.readUint16();
    this.localNodeRefs = new Array(numLocalNodes);
    for (let i = 0; i < numLocalNodes; i++) {
      this.localNodeRefs[i] = data.readObjectId();
    }

    // LMatrix4f for initial_net_transform_inverse
    for (let i = 0; i < 16; i++) {
      this.initialNetTransformInverse[i] = data.readFloat32();
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(6, 4)) >= 0) {
      info.set("characterRef", dbgRef(this.characterRef));
    }
    info.set("netNodes", dbgRefs(this.netNodeRefs));
    info.set("localNodes", dbgRefs(this.localNodeRefs));
    info.set(
      "initialNetTransformInverse",
      dbgStr(`[${Array.from(this.initialNetTransformInverse).join(", ")}]`),
    );
    return info;
  }
}

registerBAMObject("CharacterJoint", CharacterJoint);
