import { type ReadonlyVec3, vec3 } from "gl-matrix";
import { HOOD_ID_MINNIES_MELODYLAND } from "../Globals";
import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { Char } from "../objects";
import { SafeZoneLoader } from "./SafeZoneLoader";

export class MMSafeZoneLoader extends SafeZoneLoader {
  private _char: Char;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_MINNIES_MELODYLAND);
    this.storageDNAFiles.push(
      "phase_6/dna/storage_MM",
      "phase_6/dna/storage_MM_town",
      "phase_6/dna/storage_MM_sz",
    );
    this.dnaFile = "phase_6/dna/minnies_melody_land_sz";
    this.skyFile = "phase_6/models/props/MM_sky";
    this.musicFile = "phase_6/audio/bgm/MM_nbrhood.mid";
  }

  override async load(): Promise<void> {
    await super.load();

    // Load Minnie
    this._char = new Char();
    await this._char.generateChar("mn");
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
  [vec3.fromValues(86, 44, -13.5), 121.1],
  // [vec3.fromValues(88, -8, -13.5), 91],
  [vec3.fromValues(92, -76, -13.5), 62.5],
  [vec3.fromValues(53, -112, 6.5), 65.8],
  [vec3.fromValues(-69, -71, 6.5), -67.2],
  [vec3.fromValues(-75, 21, 6.5), -100.9],
  [vec3.fromValues(-21, 72, 6.5), -129.5],
  [vec3.fromValues(56, 72, 6.5), 138.2],
  [vec3.fromValues(-41, 47, 6.5), -98.9],
];
