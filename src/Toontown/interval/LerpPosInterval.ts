import { type ReadonlyVec3, vec3 } from "gl-matrix";
import type { PandaNode } from "../nodes";
import { State } from "./Interval";
import { type BlendType, LerpInterval } from "./LerpInterval";

export class LerpPosInterval extends LerpInterval {
  constructor(
    private node: PandaNode,
    duration: number,
    blendType: BlendType,
    private startPos: ReadonlyVec3 | null,
    private endPos: ReadonlyVec3,
  ) {
    super(`LerpPos-${node.name}`, duration, blendType);
  }

  override privInitialize(t: number): void {
    if (this.startPos === null) this.startPos = this.node.pos;
    super.privInitialize(t);
  }

  override privInstant(): void {
    this.node.pos = this.endPos;
    this._state = State.Final;
  }

  override privStep(t: number): void {
    super.privStep(t);
    const d = this.computeDelta(t);
    const pos = vec3.create();
    vec3.lerp(pos, this.startPos as ReadonlyVec3, this.endPos, d);
    this.node.pos = pos;
  }
}
