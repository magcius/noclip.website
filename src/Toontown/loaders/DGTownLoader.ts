import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { TownLoader } from "./TownLoader";

export class DGTownLoader extends TownLoader {
  constructor(scene: PandaNode, loader: ToontownLoader, branchZoneId: number) {
    super(scene, loader, branchZoneId);
    this.storageDNAFiles.push(
      "phase_8/dna/storage_DG",
      "phase_8/dna/storage_DG_town",
    );
    this.dnaFile = `phase_8/dna/daisys_garden_${branchZoneId}`;
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_8/audio/bgm/DG_SZ.mid";
  }
}
