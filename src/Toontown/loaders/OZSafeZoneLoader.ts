import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import { HOOD_ID_OUTDOOR_ZONE } from "../Globals";
import type { ToontownLoader } from "../Loader";
import { CullBinAttrib, type PandaNode } from "../nodes";
import { Actor, Char } from "../objects";
import { SafeZoneLoader } from "./SafeZoneLoader";

/**
 * Chip 'n Dale's Acorn Acres
 */
export class OZSafeZoneLoader extends SafeZoneLoader {
  private _char: Char;
  private _geyserActor: Actor | null = null;
  private _waterfallActor: Actor | null = null;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_OUTDOOR_ZONE);
    this.storageDNAFiles.push(
      "phase_6/dna/storage_OZ",
      "phase_6/dna/storage_OZ_sz",
    );
    this.dnaFile = "phase_6/dna/outdoor_zone_sz";
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_6/audio/bgm/OZ_SZ.mid";
  }

  override async load(): Promise<void> {
    await super.load();

    // Load Chip character
    this._char = new Char();
    await this._char.generateChar("ch");
    await this._char.init();
    this.scene.addChild(this._char);

    // Setup water transparency
    this.setupWater();

    // Setup geyser and waterfall
    await this.setupGeyser();
    await this.setupWaterfall();
  }

  /**
   * Sets up water transparency and render bins.
   */
  private setupWater(): void {
    // Make water transparent
    const water = this.scene.find("**/water1*");
    if (water) {
      water.setTransparency(true);
      water.setColorScale(vec4.fromValues(1.0, 1.0, 1.0, 1.0));
      water.setAttrib(CullBinAttrib.create("water", 51), 1);
    }

    // Make pool transparent
    const pool = this.scene.find("**/pPlane5*");
    if (pool) {
      pool.setTransparency(true);
      pool.setColorScale(vec4.fromValues(1.0, 1.0, 1.0, 1.0));
      pool.setAttrib(CullBinAttrib.create("water", 50), 1);
    }
  }

  /**
   * Loads and sets up the geyser animation.
   */
  private async setupGeyser(): Promise<void> {
    const geyserPlacer = this.scene.find("**/geyser*");
    if (!geyserPlacer) {
      console.warn("OZSafeZoneLoader: Could not find geyser placer node");
      return;
    }

    this._geyserActor = new Actor();
    await this._geyserActor.loadModel("phase_6/models/golf/golf_geyser_model");
    await this._geyserActor.loadAnims({
      idle: "phase_6/models/golf/golf_geyser",
    });

    this._geyserActor.reparentTo(this.scene);

    // Position at geyser placer, but lowered initially
    const geyserPos = geyserPlacer.worldPos;
    this._geyserActor.pos = vec3.fromValues(
      geyserPos[0],
      geyserPos[1],
      geyserPos[2] - 100.0,
    );

    // Set render properties
    this._geyserActor.setDepthWrite(false);
    this._geyserActor.setTwoSided(true);
    this._geyserActor.setColorScale(vec4.fromValues(1.0, 1.0, 1.0, 1.0));
    this._geyserActor.setAttrib(CullBinAttrib.create("fixed", 0));

    // TODO: TexProjectorEffect for UV animation
    // mesh = this.geyserActor.find('**/mesh_tide1')
    // joint = this.geyserActor.find('**/uvj_WakeWhiteTide1')
    // mesh.setTexProjector(mesh.findTextureStage('default'), joint, this.geyserActor)

    this._geyserActor.setPlayRate(8.6, "idle");
    this._geyserActor.loop("idle");
  }

  /**
   * Loads and sets up the waterfall animation.
   */
  private async setupWaterfall(): Promise<void> {
    const waterfallPlacer = this.scene.find("**/waterfall*");
    if (!waterfallPlacer) {
      console.warn("OZSafeZoneLoader: Could not find waterfall placer node");
      return;
    }

    this._waterfallActor = new Actor();
    await this._waterfallActor.loadModel(
      "phase_6/models/golf/golf_waterfall_model",
    );
    await this._waterfallActor.loadAnims({
      idle: "phase_6/models/golf/golf_waterfall",
    });

    this._waterfallActor.reparentTo(this.scene);

    // Position at waterfall placer
    this._waterfallActor.pos = waterfallPlacer.worldPos;

    // TODO: TexProjectorEffect for UV animation
    // mesh = this.waterfallActor.find('**/mesh_tide1')
    // joint = this.waterfallActor.find('**/uvj_WakeWhiteTide1')
    // mesh.setTexProjector(mesh.findTextureStage('default'), joint, this.waterfallActor)

    this._waterfallActor.setPlayRate(3.5, "idle");
    this._waterfallActor.loop("idle");
  }

  override enter(): void {
    super.enter();
    this._char.walkToNextPoint();
  }

  override exit(): void {
    super.exit();
    this._char.stopWalking();
    this._geyserActor?.stop();
    this._waterfallActor?.stop();
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    return DROP_POINTS;
  }
}

const DROP_POINTS: readonly [ReadonlyVec3, number][] = [
  [vec3.fromValues(-165.8, 108, 0.025), 252],
  [vec3.fromValues(21, 130, 0.16), 170],
  // [vec3.fromValues(93, 78.5, 0.23), 112],
  [vec3.fromValues(79, -1.6, 0.75), 163],
  [vec3.fromValues(10, 33, 5.32), 130.379],
  [vec3.fromValues(-200, -42, 0.025), 317.543],
  [vec3.fromValues(-21, -65, 0.335), -18],
  [vec3.fromValues(23, 68.5, 4.51), -22.808],
];
