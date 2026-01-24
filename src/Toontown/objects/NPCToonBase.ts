import type { PandaNode } from "../nodes";
import { NametagColorCode } from "./Nametag3D";
import { Toon } from "./Toon";

export class NPCToonBase extends Toon {
  constructor(
    protected scene: PandaNode,
    protected npcId: number,
    protected posIndex: number,
  ) {
    super();
    this._playerType = NametagColorCode.NonPlayer;
  }

  override async init(): Promise<void> {
    await super.init();
    await this.initToonState();
  }

  async initToonState(): Promise<void> {
    this.setPlayRate(0.9, "neutral");
    this.loop("neutral");

    const origin = this.scene.find(`**/npc_origin_${this.posIndex}`);
    if (!origin) throw new Error(`npc_origin_${this.posIndex} not found`);
    this.reparentTo(origin);
  }
}
