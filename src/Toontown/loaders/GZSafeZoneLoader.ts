import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import { HOOD_ID_GOLF_ZONE, SUIT_FONT_PATH } from "../Globals";
import type { ToontownLoader } from "../Loader";
import { DecalEffect, type PandaNode, TransformState } from "../nodes";
import { TextAlignment } from "../text";
import { TextNode } from "../text/TextNode";
import { SafeZoneLoader } from "./SafeZoneLoader";

const BOSSBOT_SIGN_SCALE = 1.5;

// Golf kart model path
const GOLF_KART_MODEL = "phase_6/models/golf/golf_cart3";

// Kart colors per golf course (RGB ranges from GolfGlobals.KartColors)
// Course 0 = Front Three (Green), Course 1 = Middle Six (Yellow), Course 2 = Back Nine (Red)
const KART_COLORS: ReadonlyVec3[] = [
  vec3.fromValues(25 / 255, 172 / 255, 42 / 255), // Course 0: Green (midpoint of ranges)
  vec3.fromValues(207 / 255, 207 / 255, 60 / 255), // Course 1: Yellow
  vec3.fromValues(207 / 255, 55 / 255, 55 / 255), // Course 2: Red
];

/**
 * Chip 'n Dale's MiniGolf
 */
export class GZSafeZoneLoader extends SafeZoneLoader {
  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_GOLF_ZONE);
    this.storageDNAFiles.push(
      "phase_6/dna/storage_GZ",
      "phase_6/dna/storage_GZ_sz",
    );
    this.dnaFile = "phase_6/dna/golf_zone_sz";
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_6/audio/bgm/GZ_SZ.mid";
  }

  override async load(): Promise<void> {
    await super.load();
    await this.setupBossbotSign();
    await this.setupGolfKarts();
  }

  /**
   * Sets up the Bossbot HQ sign text on the link tunnel.
   */
  private async setupBossbotSign(): Promise<void> {
    const top = this.scene.find("**/linktunnel_bosshq_10000_DNARoot");
    if (!top) {
      console.warn("GZSafeZoneLoader: Could not find Bossbot HQ tunnel");
      return;
    }

    const sign = top.find("**/Sign_5");
    if (!sign) {
      console.warn("GZSafeZoneLoader: Could not find Sign_5");
      return;
    }

    const locator = top.find("**/sign_origin");
    if (!locator) {
      console.warn("GZSafeZoneLoader: Could not find sign_origin");
      return;
    }

    // Enable decal effect on the sign for proper text rendering
    sign.setEffect(new DecalEffect());

    // Load the suit font and create the text
    const textNode = new TextNode("BossbotHQSign");
    textNode.font = await this.loader.loadFont(SUIT_FONT_PATH);
    textNode.text = "BOSSBOT HQ";
    textNode.textColor = vec4.fromValues(0, 0, 0, 1);
    textNode.align = TextAlignment.Center;

    const textGeom = textNode.generate();
    textGeom.reparentTo(sign);
    textGeom.setDepthWrite(false);
    textGeom.transform = locator
      .getTransform(sign)
      .compose(
        TransformState.fromPosHprScale(
          vec3.fromValues(0, 0, -0.3),
          vec3.fromValues(0, 0, 0),
          vec3.fromValues(
            BOSSBOT_SIGN_SCALE,
            BOSSBOT_SIGN_SCALE,
            BOSSBOT_SIGN_SCALE,
          ),
        ),
      );
  }

  /**
   * Sets up golf karts from DNA placement data.
   */
  private async setupGolfKarts(): Promise<void> {
    // Load the golf kart model
    const kartModel = await this.loader.loadModel(GOLF_KART_MODEL);

    // Find all golf_kart nodes placed by DNA
    // DNA creates nodes named like "golf_kart_0_0" where first number is course, second is kart index
    const golfKartNodes = this.scene.findAllMatches("**/golf_kart_*");

    for (const kartNode of golfKartNodes) {
      // Parse the golf course number from the node name (golf_kart_<course>_<index>)
      const nameParts = kartNode.name.split("_");
      if (nameParts.length < 3) {
        console.warn(
          `GZSafeZoneLoader: Invalid golf kart node name: ${kartNode.name}`,
        );
        continue;
      }
      const golfCourse = parseInt(nameParts[2], 10);
      if (Number.isNaN(golfCourse) || golfCourse < 0 || golfCourse > 2) {
        console.warn(
          `GZSafeZoneLoader: Invalid golf course number in: ${kartNode.name}`,
        );
        continue;
      }

      // Find the starting_block child to get position/hpr
      const startingBlock = kartNode.find("**/starting_block_*");
      if (!startingBlock) {
        console.warn(
          `GZSafeZoneLoader: No starting_block found for ${kartNode.name}`,
        );
        continue;
      }

      // Get the world transform of the starting block
      const worldTransform = startingBlock.netTransform;
      const pos = worldTransform.pos;
      const hpr = worldTransform.hpr;

      // Lift the kart off the ground slightly (from original code: pos += Point3(0, 0, 0.05))
      const adjustedPos = vec3.fromValues(pos[0], pos[1], pos[2] + 0.05);

      // Clone and position the kart
      const kart = kartModel.cloneTo(this.scene);
      kart.name = `golfKart_${golfCourse}_${nameParts[3] ?? "0"}`;
      kart.transform = TransformState.fromPosHprScale(
        adjustedPos,
        vec3.fromValues(hpr[0], 0, 0), // Only use heading, zero pitch/roll
        vec3.fromValues(1, 1, 1),
      );

      // Apply color based on golf course
      this.colorizeGolfKart(kart, golfCourse);

      // Hide the DNA placeholder node
      kartNode.hide();
    }

    console.log(`GZSafeZoneLoader: Set up ${golfKartNodes.length} golf karts`);
  }

  /**
   * Applies color to a golf kart based on the golf course.
   */
  private colorizeGolfKart(kart: PandaNode, golfCourse: number): void {
    const color = KART_COLORS[golfCourse] ?? KART_COLORS[0];

    // Color the main body
    const mainBody = kart.find("**/main_body");
    if (mainBody) {
      mainBody.setColorScale(vec4.fromValues(color[0], color[1], color[2], 1));
    }

    // Color the cart base with a desaturated version
    const cartBase = kart.find("**/cart_base*");
    if (cartBase) {
      // Desaturate by reducing saturation by 1/3 (from original HSV manipulation)
      const desaturated = this.desaturateColor(color, 0.67);
      cartBase.setColorScale(
        vec4.fromValues(desaturated[0], desaturated[1], desaturated[2], 1),
      );
    }
  }

  /**
   * Desaturates an RGB color by the given factor (0 = grayscale, 1 = original)
   */
  private desaturateColor(color: ReadonlyVec3, saturationFactor: number): vec3 {
    // Simple desaturation: blend with grayscale version
    const gray = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
    return vec3.fromValues(
      gray + (color[0] - gray) * saturationFactor,
      gray + (color[1] - gray) * saturationFactor,
      gray + (color[2] - gray) * saturationFactor,
    );
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    return DROP_POINTS;
  }
}

const DROP_POINTS: readonly [ReadonlyVec3, number][] = [
  [vec3.fromValues(-49.6, 102, 0), 162],
  [vec3.fromValues(-22.8, 36.6, 0), 157.5],
  [vec3.fromValues(40, 51, 0), 185],
  [vec3.fromValues(48.3, 122.2, 0), 192],
  [vec3.fromValues(106.3, 69.2, 0), 133],
  [vec3.fromValues(-81.5, 47.2, 0), 183],
  [vec3.fromValues(-80.5, -84.2, 0), 284],
  [vec3.fromValues(73, -111, 0), 354],
];
