import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { BaseLoader } from "./BaseLoader";

export class TownLoader extends BaseLoader {
  constructor(
    scene: PandaNode,
    loader: ToontownLoader,
    protected branchZoneId: number,
  ) {
    super(scene, loader);
  }

  override async load(): Promise<void> {
    await super.load();

    // Spawn NPCs in each individual zone
    const promises: Promise<void>[] = [];
    for (const zoneNode of this.scene.findAllMatches(
      "*/=DNAType=DNAVisGroup",
    )) {
      const zoneId = parseInt(zoneNode.name.split(":")[0], 10);
      promises.push(this.spawnNpcs(zoneNode, zoneId));
    }
    await Promise.all(promises);
  }
}
