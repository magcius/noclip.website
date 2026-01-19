import type { PandaNode } from "../nodes";

export class AnimatedProp {
  constructor(protected node: PandaNode) {}

  async init() {}

  enter() {}

  exit() {}

  delete() {}
}

export const animatedPropMap = new Map<
  string,
  new (
    node: PandaNode,
  ) => AnimatedProp
>();
