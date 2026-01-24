import { type ReadonlyVec3, vec3 } from "gl-matrix";
import { HOOD_ID_THE_BRRRGH } from "../Globals";
import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { Char } from "../objects";
import { SafeZoneLoader } from "./SafeZoneLoader";

export class BRSafeZoneLoader extends SafeZoneLoader {
  private _char: Char;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_THE_BRRRGH);
    this.storageDNAFiles.push(
      "phase_8/dna/storage_BR",
      "phase_8/dna/storage_BR_town",
      "phase_8/dna/storage_BR_sz",
    );
    this.dnaFile = "phase_8/dna/the_burrrgh_sz";
    this.skyFile = "phase_3.5/models/props/BR_sky";
    this.musicFile = "phase_8/audio/bgm/TB_nbrhood.mid";
  }

  override async load(): Promise<void> {
    await super.load();

    // Load Pluto
    this._char = new Char();
    await this._char.generateChar("p");
    await this._char.init();
    this.scene.addChild(this._char);
  }

  override enter(): void {
    super.enter();
    this._char.walkToNextPoint();
  }

  override exit(): void {
    super.exit();
    this._char.stopWalking();
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    return DROP_POINTS;
  }
}

const DROP_POINTS: readonly [ReadonlyVec3, number][] = [
  [vec3.fromValues(35, -32, 6.2), 138],
  [vec3.fromValues(26, -105, 6.2), -339],
  [vec3.fromValues(-29, -139, 6.2), -385],
  [vec3.fromValues(-79, -123, 6.2), -369],
  [vec3.fromValues(-114, -86, 3), -54],
  [vec3.fromValues(-136, 9, 6.2), -125],
  [vec3.fromValues(-75, 92, 6.2), -187],
  [vec3.fromValues(-7, 75, 6.2), -187],
  [vec3.fromValues(-106, -42, 8.6), -111], // hilltop 1
  [vec3.fromValues(-116, -44, 8.3), -20], // hilltop 2
];
