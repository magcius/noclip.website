import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { TownLoader } from "./TownLoader";

export class BRTownLoader extends TownLoader {
  constructor(scene: PandaNode, loader: ToontownLoader, branchZoneId: number) {
    super(scene, loader, branchZoneId);
    this.storageDNAFiles.push(
      "phase_8/dna/storage_BR",
      "phase_8/dna/storage_BR_town",
    );
    this.dnaFile = `phase_8/dna/the_burrrgh_${branchZoneId}`;
    this.skyFile = "phase_3.5/models/props/BR_sky";
    this.musicFile = "phase_8/audio/bgm/TB_SZ.mid";
  }
}
