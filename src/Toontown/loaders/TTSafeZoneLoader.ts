import { type ReadonlyVec3, vec3 } from "gl-matrix";
import { HOOD_ID_TOONTOWN_CENTRAL } from "../Globals";
import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { Char } from "../objects";
import { SafeZoneLoader } from "./SafeZoneLoader";

export class TTSafeZoneLoader extends SafeZoneLoader {
  private _char: Char;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_TOONTOWN_CENTRAL);
    this.storageDNAFiles.push(
      "phase_4/dna/storage_TT",
      "phase_5/dna/storage_TT_town",
      "phase_4/dna/storage_TT_sz",
    );
    this.dnaFile = "phase_4/dna/toontown_central_sz";
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_4/audio/bgm/TC_nbrhood.mid";
  }

  override async load(): Promise<void> {
    await super.load();

    // Load Mickey
    this._char = new Char();
    await this._char.generateChar("mk");
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

const DROP_POINTS: [ReadonlyVec3, number][] = [
  // [vec3.fromValues(-60, -8, 1.3), -90], // veranda center
  [vec3.fromValues(-66, -9, 1.3), -274], // veranda off-center
  [vec3.fromValues(17, -28, 4.1), -44], // courtyard
  [vec3.fromValues(87.7, -22, 4), 66],
  [vec3.fromValues(-9.6, 61.1, 0), 132],
  [vec3.fromValues(-109.0, -2.5, -1.656), -90], // front of bridge
  [vec3.fromValues(-35.4, -81.3, 0.5), -4],
  [vec3.fromValues(-103, 72, 0), -141],
  [vec3.fromValues(93.5, -148.4, 2.5), 43],
  [vec3.fromValues(25, 123.4, 2.55), 272],
  [vec3.fromValues(48, 39, 4), 201], // facing library
  [vec3.fromValues(-80, -61, 0.1), -265],
  [vec3.fromValues(-46.875, 43.68, -1.05), 124],
  [vec3.fromValues(34, -105, 2.55), 45],
  [vec3.fromValues(16, -75, 2.55), 56],
  [vec3.fromValues(-27, -56, 0.1), 45],
  [vec3.fromValues(100, 27, 4.1), 150],
  [vec3.fromValues(-70, 4.6, -1.9), 90],
  [vec3.fromValues(-130.7, 50, 0.55), -111],
];
