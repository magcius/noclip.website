import { mat4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { type BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgNum, dbgRefs, dbgStr } from "./debug";
import { MovingPartMatrix } from "./MovingPartMatrix";

/**
 * Stores transform matrices for skeletal animation.
 *
 * Version differences:
 * - BAM 6.4+: extra pointer to Character before net_nodes
 */
export class CharacterJoint extends MovingPartMatrix {
  public characterRef = 0; // 6.4+ only TODO circular ref
  public netNodes: BAMObject[] = [];
  public localNodes: BAMObject[] = [];
  public initialNetTransformInverse = mat4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    if (this._version.compare(new AssetVersion(6, 4)) >= 0) {
      this.characterRef = data.readObjectId();
    }

    const numNetNodes = data.readUint16();
    this.netNodes = new Array(numNetNodes);
    for (let i = 0; i < numNetNodes; i++) {
      const ref = data.readObjectId();
      const obj = file.getObject(ref);
      if (!obj) throw new Error(`CharacterJoint: Invalid net node ref @${ref}`);
      this.netNodes[i] = obj;
    }

    const numLocalNodes = data.readUint16();
    this.localNodes = new Array(numLocalNodes);
    for (let i = 0; i < numLocalNodes; i++) {
      const ref = data.readObjectId();
      const obj = file.getObject(ref);
      if (!obj)
        throw new Error(`CharacterJoint: Invalid local node ref @${ref}`);
      this.localNodes[i] = obj;
    }

    this.initialNetTransformInverse = data.readMat4();
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    // target.characterRef = this.characterRef; TODO
    target.netNodes = this.netNodes.map((n) => n.clone());
    target.localNodes = this.localNodes.map((n) => n.clone());
    mat4.copy(
      target.initialNetTransformInverse,
      this.initialNetTransformInverse,
    );
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(6, 4)) >= 0) {
      info.set("characterRef", dbgNum(this.characterRef));
    }
    info.set("netNodes", dbgRefs(this.netNodes));
    info.set("localNodes", dbgRefs(this.localNodes));
    info.set(
      "initialNetTransformInverse",
      dbgStr(`[${Array.from(this.initialNetTransformInverse).join(", ")}]`),
    );
    return info;
  }
}

registerBAMObject("CharacterJoint", CharacterJoint);
