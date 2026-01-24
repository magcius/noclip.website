import { NPCToonBase } from "./NPCToonBase";

export class NPCPartyPerson extends NPCToonBase {
  override async initToonState(): Promise<void> {
    this.setPlayRate(1.05, "neutral");
    this.loop("neutral");

    const side = this.posIndex % 2 === 0 ? "left" : "right";
    const origin = this.scene.find(`**/party_person_${side};+s`);
    if (!origin) throw new Error(`party_person_${side} not found`);
    this.reparentTo(origin);
  }
}
