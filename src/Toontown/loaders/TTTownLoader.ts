import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { TownLoader } from "./TownLoader";

export class TTTownLoader extends TownLoader {
  constructor(scene: PandaNode, loader: ToontownLoader, branchZoneId: number) {
    super(scene, loader, branchZoneId);
    this.storageDNAFiles.push(
      "phase_4/dna/storage_TT",
      "phase_5/dna/storage_TT_town",
    );
    this.dnaFile = `phase_5/dna/toontown_central_${branchZoneId}`;
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_3.5/audio/bgm/TC_SZ.mid";
  }
}
