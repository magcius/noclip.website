import { type ReadonlyVec3, vec3 } from "gl-matrix";
import { HOOD_ID_GOOFY_SPEEDWAY } from "../Globals";
import { LerpHprInterval } from "../interval/LerpHprInterval";
import { BlendType } from "../interval/LerpInterval";
import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { Char } from "../objects";
import { SafeZoneLoader } from "./SafeZoneLoader";

/**
 * Goofy Speedway
 */
export class GSSafeZoneLoader extends SafeZoneLoader {
  private _char: Char;
  private _blimpRoot: PandaNode | null = null;
  private _rotateBlimp: LerpHprInterval | null = null;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_GOOFY_SPEEDWAY);
    this.storageDNAFiles.push(
      "phase_6/dna/storage_GS",
      "phase_6/dna/storage_GS_sz",
    );
    this.dnaFile = "phase_6/dna/goofy_speedway_sz";
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_6/audio/bgm/GS_SZ.mid";
  }

  override async load(): Promise<void> {
    await super.load();

    // Load Goofy
    this._char = new Char();
    await this._char.generateChar("g");
    await this._char.init();
    this.scene.addChild(this._char);

    // Setup blimp animation
    this.setupBlimp();
  }

  /**
   * Sets up the blimp rotation animation.
   */
  private setupBlimp(): void {
    const blimp = this.scene.find("**/GS_blimp");
    if (!blimp) {
      console.warn("GSSafeZoneLoader: Could not find GS_blimp node");
      return;
    }

    // Create blimpRoot node
    this._blimpRoot = this.scene.attachNewNode("blimpRoot");
    this._blimpRoot.pos = vec3.fromValues(0, -70, 40);

    // Create blimpBase node
    const blimpBase = this._blimpRoot.attachNewNode("blimpBase");
    blimpBase.setPosHprScale(
      vec3.fromValues(0, -200, 25),
      vec3.fromValues(-40, 0, 0),
      vec3.fromValues(1, 1, 1),
    );
    blimp.reparentTo(blimpBase);

    // Position the blimp relative to blimpBase
    blimp.pos = vec3.fromValues(-70, 250, -70);

    // Create the rotation interval
    this._rotateBlimp = new LerpHprInterval(
      this._blimpRoot,
      360,
      BlendType.Linear,
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(360, 0, 0),
    );
  }

  override enter(): void {
    super.enter();
    this._char.walkToNextPoint();
    this._rotateBlimp?.loop();
  }

  override exit(): void {
    super.exit();
    this._char.stopWalking();
    this._rotateBlimp?.finish();
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    return DROP_POINTS;
  }
}

const DROP_POINTS: readonly [ReadonlyVec3, number][] = [
  [vec3.fromValues(-0.7, 62, 0.08), 182],
  [vec3.fromValues(-1, -30, 0.06), 183],
  [vec3.fromValues(-13, -120, 0), 307],
  [vec3.fromValues(16.4, -120, 0), 65],
  [vec3.fromValues(-0.5, -90, 0), 182],
  [vec3.fromValues(-30, -25, -0.373), 326],
  [vec3.fromValues(29, -17, -0.373), 32],
];
