import { type ReadonlyVec3, vec3 } from "gl-matrix";
import { HOOD_ID_DONALDS_DREAMLAND } from "../Globals";
import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { Char } from "../objects";
import { SafeZoneLoader } from "./SafeZoneLoader";

export class DLSafeZoneLoader extends SafeZoneLoader {
  private _char: Char;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_DONALDS_DREAMLAND);
    this.storageDNAFiles.push(
      "phase_8/dna/storage_DL",
      "phase_8/dna/storage_DL_town",
      "phase_8/dna/storage_DL_sz",
    );
    this.dnaFile = "phase_8/dna/donalds_dreamland_sz";
    this.skyFile = "phase_8/models/props/DL_sky";
    this.musicFile = "phase_8/audio/bgm/DL_nbrhood.mid";
  }

  override async load(): Promise<void> {
    await super.load();

    // Load Donald
    this._char = new Char();
    await this._char.generateChar("d");
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
  [vec3.fromValues(77, 91, 0.0), 124.4],
  [vec3.fromValues(29, 92, 0.0), -154.5],
  [vec3.fromValues(-28, 49, -16.4), -142.0],
  [vec3.fromValues(21, 40, -16.0), -65.1],
  [vec3.fromValues(48, 27, -15.4), -161.0],
  [vec3.fromValues(-2, -22, -15.2), -132.1],
  [vec3.fromValues(-92, -88, 0.0), -116.3],
  [vec3.fromValues(-56, -93, 0.0), -21.5],
  [vec3.fromValues(20, -88, 0.0), -123.4],
  [vec3.fromValues(76, -90, 0.0), 11.0],
];
