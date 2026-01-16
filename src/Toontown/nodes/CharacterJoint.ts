import { mat4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import { Character } from "./Character";
import { type DebugInfo, dbgMat4, dbgRef, dbgRefs } from "./debug";
import { MovingPartMatrix } from "./MovingPartMatrix";
import { PandaNode } from "./PandaNode";
import type { PartBundle } from "./PartBundle";
import type { PartGroup } from "./PartGroup";
import { TransformState } from "./TransformState";
import {
  type CopyContext,
  readTypedRefs,
  registerTypedObject,
} from "./TypedObject";
import type { VertexTransform } from "./VertexTransform";

/**
 * Stores transform matrices for skeletal animation.
 *
 * Version differences:
 * - BAM 6.4+: extra pointer to Character before net_nodes
 */
export class CharacterJoint extends MovingPartMatrix {
  public character: Character | null = null; // 6.4+ only
  public netNodes: PandaNode[] = [];
  public localNodes: PandaNode[] = [];
  public initialNetTransformInverse = mat4.create();

  // Runtime fields (not serialized, computed during animation)
  /** World-space transform, computed by chaining value with parent's netTransform */
  public netTransform = mat4.create();
  public vertexTransforms: VertexTransform[] = [];

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
      dbgMat4(this.initialNetTransformInverse),
    );
    return info;
  }

  protected override updateInternals(
    root: PartBundle,
    parent: PartGroup,
    selfChanged: boolean,
    parentChanged: boolean,
  ): boolean {
    let netChanged = false;
    if (parent instanceof CharacterJoint) {
      if (parentChanged || selfChanged) {
        mat4.multiply(this.netTransform, parent.netTransform, this.value);
        netChanged = true;
      }
    } else if (selfChanged) {
      mat4.multiply(this.netTransform, root.rootXform, this.value);
      netChanged = true;
    }

    let transform: TransformState | null = null;
    if (netChanged) {
      // Update any registered nodes to receive the new transform
      if (this.netNodes.length > 0) {
        transform = TransformState.fromMatrix(this.netTransform);
        for (const node of this.netNodes) {
          node.transform = transform;
        }
      }

      // Inform vertex transforms of change
      for (const transform of this.vertexTransforms) {
        transform.markModified();
      }
    }

    if (selfChanged && this.localNodes.length > 0) {
      if (transform === null)
        transform = TransformState.fromMatrix(this.netTransform);
      for (const node of this.localNodes) {
        node.transform = transform;
      }
    }

    return selfChanged || netChanged;
  }
}

registerTypedObject("CharacterJoint", CharacterJoint);
