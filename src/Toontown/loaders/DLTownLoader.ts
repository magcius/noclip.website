import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { TownLoader } from "./TownLoader";

export class DLTownLoader extends TownLoader {
  constructor(scene: PandaNode, loader: ToontownLoader, branchZoneId: number) {
    super(scene, loader, branchZoneId);
    this.storageDNAFiles.push(
      "phase_8/dna/storage_DL",
      "phase_8/dna/storage_DL_town",
    );
    this.dnaFile = `phase_8/dna/donalds_dreamland_${branchZoneId}`;
    this.skyFile = "phase_8/models/props/DL_sky";
    this.musicFile = "phase_8/audio/bgm/DL_SZ.mid";
  }
}
