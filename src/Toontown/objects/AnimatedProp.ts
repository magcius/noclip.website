import { getHoodId } from "../Globals";
import type { PandaNode } from "../nodes";

export class AnimatedProp {
  protected _zoneId: number;
  protected _hoodId: number;

  constructor(protected node: PandaNode) {
    this._zoneId = this.getZoneId();
    this._hoodId = getHoodId(this._zoneId);
  }

  async init() {}

  enter() {}

  exit() {}

  delete() {}

  private getZoneId(): number {
    let node = this.node.parent;
    while (node) {
      if (node.tags.get("DNAType") === "DNAVisGroup") {
        // 2000:safe_zone -> 2000
        const zoneIdStr = node.name.split(":")[0];
        const zoneId = parseInt(zoneIdStr, 10);
        if (!Number.isNaN(zoneId)) return zoneId;
      }
      node = node.parent;
    }
    return -1;
  }
}

export const animatedPropMap = new Map<
  string,
  new (
    node: PandaNode,
  ) => AnimatedProp
>();
