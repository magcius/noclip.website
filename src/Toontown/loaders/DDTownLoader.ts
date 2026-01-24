import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { TownLoader } from "./TownLoader";

export class DDTownLoader extends TownLoader {
  constructor(scene: PandaNode, loader: ToontownLoader, branchZoneId: number) {
    super(scene, loader, branchZoneId);
    this.storageDNAFiles.push(
      "phase_6/dna/storage_DD",
      "phase_6/dna/storage_DD_town",
    );
    this.dnaFile = `phase_6/dna/donalds_dock_${branchZoneId}`;
    this.skyFile = "phase_3.5/models/props/BR_sky";
    this.musicFile = "phase_6/audio/bgm/DD_SZ.mid";
  }
}
