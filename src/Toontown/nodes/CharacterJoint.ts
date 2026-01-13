import { mat4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import {
  type BAMObject,
  CopyContext,
  readTypedRefs,
  registerBAMObject,
} from "./base";
import { type DebugInfo, dbgNum, dbgRef, dbgRefs, dbgStr } from "./debug";
import { MovingPartMatrix } from "./MovingPartMatrix";
import { PandaNode } from "./PandaNode";
import { Character } from "./Character";

/**
 * Stores transform matrices for skeletal animation.
 *
 * Version differences:
 * - BAM 6.4+: extra pointer to Character before net_nodes
 */
export class CharacterJoint extends MovingPartMatrix {
  public character: Character | null = null; // 6.4+ only TODO circular ref
  public netNodes: PandaNode[] = [];
  public localNodes: PandaNode[] = [];
  public initialNetTransformInverse = mat4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    if (this._version.compare(new AssetVersion(6, 4)) >= 0) {
      this.character = file.getTyped(data.readObjectId(), Character);
    }

    const numNetNodes = data.readUint16();
    this.netNodes = readTypedRefs(file, data, numNetNodes, PandaNode);

    const numLocalNodes = data.readUint16();
    this.localNodes = readTypedRefs(file, data, numLocalNodes, PandaNode);

    this.initialNetTransformInverse = data.readMat4();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.character = ctx.clone(this.character);
    target.netNodes = ctx.cloneArray(this.netNodes);
    target.localNodes = ctx.cloneArray(this.localNodes);
    mat4.copy(
      target.initialNetTransformInverse,
      this.initialNetTransformInverse,
    );
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(6, 4)) >= 0) {
      info.set("character", dbgRef(this.character));
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
