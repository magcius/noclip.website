import { type ReadonlyVec3, vec3 } from "gl-matrix";
import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { TownLoader } from "./TownLoader";

export class TutorialTownLoader extends TownLoader {
  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, 20001);
    this.storageDNAFiles.push(
      "phase_4/dna/storage_TT",
      "phase_5/dna/storage_TT_town",
    );
    this.dnaFile = `phase_3.5/dna/tutorial_street`;
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_3/audio/bgm/tt_theme.mid";
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    return [[vec3.fromValues(20, 20, 5), -90]];
  }
}
