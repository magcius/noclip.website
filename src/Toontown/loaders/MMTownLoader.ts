import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { TownLoader } from "./TownLoader";

export class MMTownLoader extends TownLoader {
  constructor(scene: PandaNode, loader: ToontownLoader, branchZoneId: number) {
    super(scene, loader, branchZoneId);
    this.storageDNAFiles.push(
      "phase_6/dna/storage_MM",
      "phase_6/dna/storage_MM_town",
    );
    this.dnaFile = `phase_6/dna/minnies_melody_land_${branchZoneId}`;
    this.skyFile = "phase_6/models/props/MM_sky";
    this.musicFile = "phase_6/audio/bgm/MM_SZ.mid";
  }
}
