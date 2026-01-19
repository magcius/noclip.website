import { type ReadonlyVec3, vec3 } from "gl-matrix";
import type { PandaNode } from "../nodes";
import { State } from "./Interval";
import { type BlendType, LerpInterval } from "./LerpInterval";

export class LerpHprInterval extends LerpInterval {
  constructor(
    private node: PandaNode,
    duration: number,
    blendType: BlendType,
    private startHpr: ReadonlyVec3 | null,
    private endHpr: ReadonlyVec3,
  ) {
    super(`LerpHpr-${node.name}`, duration, blendType);
  }

  override privInitialize(t: number): void {
    if (this.startHpr === null) this.startHpr = this.node.hpr;
    super.privInitialize(t);
  }

  override privInstant(): void {
    this.node.hpr = this.endHpr;
    this._state = State.Final;
  }

  override privStep(t: number): void {
    super.privStep(t);
    const d = this.computeDelta(t);
    const hpr = vec3.create();
    vec3.lerp(hpr, this.startHpr as ReadonlyVec3, this.endHpr, d);
    this.node.hpr = hpr;
  }
}
