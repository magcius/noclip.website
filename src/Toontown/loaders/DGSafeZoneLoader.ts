import { type ReadonlyVec3, vec3 } from "gl-matrix";
import { HOOD_ID_DAISY_GARDENS } from "../Globals";
import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { Char } from "../objects";
import { SafeZoneLoader } from "./SafeZoneLoader";

export class DGSafeZoneLoader extends SafeZoneLoader {
  private _char: Char;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_DAISY_GARDENS);
    this.storageDNAFiles.push(
      "phase_8/dna/storage_DG",
      "phase_8/dna/storage_DG_town",
      "phase_8/dna/storage_DG_sz",
    );
    this.dnaFile = "phase_8/dna/daisys_garden_sz";
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_8/audio/bgm/DG_nbrhood.mid";
  }

  override async load(): Promise<void> {
    await super.load();

    // Load Daisy
    this._char = new Char();
    await this._char.generateChar("dd");
    await this._char.init();
    this.scene.addChild(this._char);

    // Spawn flower
    const flowerModel = await this.loader.loadModel(
      "phase_8/models/props/DG_flower-mod",
    );
    const flower = flowerModel.cloneTo(this.scene);
    flower.pos = vec3.fromValues(1.39, 92.91, 2.0);
    flower.scale = vec3.fromValues(2.5, 2.5, 2.5);
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
  [vec3.fromValues(0, 0, 0), -10.5],
  // [vec3.fromValues(76, 35, 1.1), -30.2],
  [vec3.fromValues(97, 106, 0.0), 51.4],
  [vec3.fromValues(51, 180, 10.0), 22.6],
  [vec3.fromValues(-14, 203, 10.0), 85.6],
  [vec3.fromValues(-58, 158, 10.0), -146.9],
  [vec3.fromValues(-86, 128, 0.0), -178.9],
  [vec3.fromValues(-64, 65, 0.0), 17.7],
  [vec3.fromValues(-13, 39, 0.0), -15.7],
  [vec3.fromValues(-12, 193, 0.0), -112.4],
  [vec3.fromValues(87, 128, 0.0), 45.4],
];
