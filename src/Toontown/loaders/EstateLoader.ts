import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import type { ToontownLoader } from "../Loader";
import { CullBinAttrib, type PandaNode, TransformState } from "../nodes";
import { BaseLoader } from "./BaseLoader";

// House drop positions and rotations
const HOUSE_DROPS: { pos: ReadonlyVec3; hpr: ReadonlyVec3 }[] = [
  {
    pos: vec3.fromValues(-56.7788, -42.8756, 4.06471),
    hpr: vec3.fromValues(-90, 0, 0),
  },
  {
    pos: vec3.fromValues(83.3909, -77.5085, 0.0708361),
    hpr: vec3.fromValues(116.565, 0, 0),
  },
  {
    pos: vec3.fromValues(-69.077, -119.496, 0.025),
    hpr: vec3.fromValues(77.1957, 0, 0),
  },
  {
    pos: vec3.fromValues(63.4545, 11.0656, 8.05158),
    hpr: vec3.fromValues(356.6, 0, 0),
  },
  {
    pos: vec3.fromValues(43.9315, 76.72, 0.0377455),
    hpr: vec3.fromValues(248.962, 0, 0),
  },
  {
    pos: vec3.fromValues(-36.9122, 36.3429, 2.49382),
    hpr: vec3.fromValues(36.8699, 0, 0),
  },
];

// Wall colors for each house
const HOUSE_COLORS = [
  vec4.fromValues(0.892, 0.453, 0.39, 1), // red
  vec4.fromValues(0.276, 0.692, 0.539, 1), // green
  vec4.fromValues(0.639, 0.624, 0.882, 1), // purple
  vec4.fromValues(0.525, 0.78, 0.935, 1), // blue
  vec4.fromValues(0.953, 0.545, 0.757, 1), // pink
  vec4.fromValues(0.992, 0.843, 0.392, 1), // yellow
];

// Chimney colors (darker variants)
const CHIMNEY_COLORS = [
  vec4.fromValues(0.792, 0.353, 0.29, 1), // red
  vec4.fromValues(0.176, 0.592, 0.439, 1), // green
  vec4.fromValues(0.439, 0.424, 0.682, 1), // purple
  vec4.fromValues(0.325, 0.58, 0.835, 1), // blue
  vec4.fromValues(0.753, 0.345, 0.557, 1), // pink
  vec4.fromValues(0.992, 0.843, 0.392, 1), // yellow
];

/**
 * Estate loader.
 * Loads the estate scene with houses, mailboxes, and doors.
 */
export class EstateLoader extends BaseLoader {
  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader);
    this.storageDNAFiles.push("phase_5.5/dna/storage_estate");
    this.dnaFile = "phase_5.5/dna/estate_1";
    this.skyFile = "phase_3.5/models/props/TT_sky";
  }

  override async load(): Promise<void> {
    await super.load();

    // Ensure the foot path renders in ground cull bin
    this.scene
      .find("**/Path")
      ?.setAttrib(CullBinAttrib.create("ground", 10), 1);

    // Generate houses
    await this.generateHouses();
  }

  private async generateHouses(): Promise<void> {
    // Load shared models
    const houseModel = await this.loader.loadModel(
      "phase_5.5/models/estate/houseA",
    );
    const mailboxModel = await this.loader.loadModel(
      "phase_5.5/models/estate/mailboxHouse",
    );

    for (let i = 0; i < HOUSE_DROPS.length; i++) {
      const { pos, hpr } = HOUSE_DROPS[i];

      // Create base node for this house
      const baseNode = this.scene.attachNewNode(`esHouse_${i}`);
      baseNode.setPosHprScale(pos, hpr, vec3.fromValues(1, 1, 1));

      // Clone house model
      const house = houseModel.cloneTo(baseNode);

      // Set wall colors
      const houseColor = HOUSE_COLORS[i];
      const houseColorDark = vec4.fromValues(
        houseColor[0] * 0.8,
        houseColor[1] * 0.8,
        houseColor[2] * 0.8,
        1,
      );
      house.find("**/*back")?.setColor(houseColor);
      house.find("**/*front")?.setColor(houseColor);
      house.find("**/*right")?.setColor(houseColorDark);
      house.find("**/*left")?.setColor(houseColorDark);

      // Set attic color
      house.find("**/attic")?.setColor(vec4.fromValues(0.49, 0.314, 0.224, 1));

      // Set chimney color
      const chimneyColor = CHIMNEY_COLORS[i];
      house.findAllMatches("**/chim*").forEach((n) => {
        n.setColor(chimneyColor);
      });

      // Setup door
      this.setupDoor(house);

      // Setup floor mat
      house.find("**/mat")?.setColor(vec4.fromValues(0.4, 0.357, 0.259, 1));

      // Setup mailbox
      this.setupMailbox(mailboxModel, baseNode, house, i);
    }
  }

  private setupDoor(house: PandaNode): void {
    const doorOrigin = house.find("**/door_origin");
    if (!doorOrigin) {
      console.warn("EstateLoader: Door origin not found");
      return;
    }

    doorOrigin.setPosHprScale(
      doorOrigin.pos,
      vec3.fromValues(90, 0, 0),
      vec3.fromValues(0.6, 0.6, 0.8),
    );
    doorOrigin.transform = doorOrigin.transform.compose(
      TransformState.fromPos(vec3.fromValues(0.5, 0, 0)),
    );

    const doorModel = this.sceneBuilder.addGeometryFromCode(
      "door_double_round_ur",
      doorOrigin,
    );
    if (doorModel) {
      doorModel.setColor(vec4.fromValues(0.651, 0.376, 0.31, 1));
    }
  }

  private setupMailbox(
    mailboxModel: PandaNode,
    baseNode: PandaNode,
    house: PandaNode,
    houseIndex: number,
  ): void {
    const mailbox = mailboxModel.cloneTo(baseNode);

    // Z offset varies by house
    let zOffset = 0;
    if (houseIndex === 2) {
      zOffset = 0.5;
    }

    mailbox.transform = house.transform.compose(
      TransformState.fromPosHprScale(
        vec3.fromValues(19, -4, zOffset),
        vec3.fromValues(90, 0, 0),
        vec3.fromValues(1, 1, 1),
      ),
    );

    // Randomly set mailbox flag position
    const flag = mailbox.find("**/mailbox_flag");
    if (flag) {
      if (Math.floor(Math.random() * 2)) {
        // Flag up
        flag.p = 0;
      } else {
        // Flag down
        flag.p = -70;
      }
    }
  }
}
