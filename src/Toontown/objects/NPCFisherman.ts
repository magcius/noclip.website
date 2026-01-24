import { NPCToonBase } from "./NPCToonBase";

export class NPCFisherman extends NPCToonBase {
  override async initToonState(): Promise<void> {
    this.setPlayRate(1.05, "neutral");
    this.loop("neutral");

    const origin = this.scene.find(
      `**/npc_fisherman_origin_${this.posIndex};+s`,
    );
    if (!origin)
      throw new Error(`npc_fisherman_origin_${this.posIndex} not found`);
    this.reparentTo(origin);
  }
}
