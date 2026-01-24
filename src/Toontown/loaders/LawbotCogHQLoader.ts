import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import {
  SUIT_FONT_PATH,
  ZONE_ID_LAWBOT_HQ,
  ZONE_ID_LAWBOT_LOBBY,
  ZONE_ID_LAWBOT_OFFICE_EXT,
} from "../Globals";
import type { ToontownLoader } from "../Loader";
import {
  CullBinAttrib,
  DecalEffect,
  type PandaNode,
  TransformState,
} from "../nodes";
import { TextAlignment } from "../text";
import { TextNode } from "../text/TextNode";
import { BaseLoader } from "./BaseLoader";

const OFFICE_NAMES = [
  "Lawbot A Office",
  "Lawbot B Office",
  "Lawbot C Office",
  "Lawbot D Office",
];

/**
 * Lawbot HQ
 */
export class LawbotCogHQLoader extends BaseLoader {
  constructor(
    scene: PandaNode,
    loader: ToontownLoader,
    private zoneId: number,
  ) {
    super(scene, loader);
    this.storageDNAFiles = [];
    this.dnaFile = null;
    this.skyFile = "phase_9/models/cogHQ/cog_sky";
    this.musicFile = this.getMusicFile();
  }

  private getMusicFile(): string {
    const baseZone = this.zoneId - (this.zoneId % 100);
    if (baseZone === ZONE_ID_LAWBOT_LOBBY) {
      return "phase_7/audio/bgm/encntr_suit_winning_indoor.mid";
    }
    return "phase_11/audio/bgm/LB_courtyard.mid";
  }

  override async load(): Promise<void> {
    await this.loadPlaceGeom();
    await super.load();
  }

  private async loadPlaceGeom(): Promise<void> {
    const baseZone = this.zoneId - (this.zoneId % 100);

    if (baseZone === ZONE_ID_LAWBOT_HQ) {
      await this.loadLawbotPlaza();
    } else if (baseZone === ZONE_ID_LAWBOT_LOBBY) {
      await this.loadLawbotLobby();
    } else if (baseZone === ZONE_ID_LAWBOT_OFFICE_EXT) {
      await this.loadLawbotOfficeExt();
    } else {
      console.warn(`LawbotCogHQLoader: unclassified zone ${this.zoneId}`);
    }
  }

  /**
   * Loads the Lawbot HQ Plaza (Courtyard).
   * Zone ID: 13000
   */
  private async loadLawbotPlaza(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_11/models/lawbotHQ/LawbotPlaza",
    );
    geom.cloneTo(this.scene);

    // Make sure the reflective floor renders properly
    this.scene
      .find("**/underground")
      ?.setAttrib(CullBinAttrib.create("ground", -10));

    // Rename the link tunnel so it hooks up properly
    const brLinkTunnel = this.scene.find("**/TunnelEntrance1");
    if (brLinkTunnel) {
      brLinkTunnel.name = "linktunnel_br_3326_DNARoot";
    }
  }

  /**
   * Loads the Lawbot Courthouse Lobby.
   * Zone ID: 13100
   */
  private async loadLawbotLobby(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_11/models/lawbotHQ/LB_CH_Lobby",
    );
    geom.cloneTo(this.scene);

    // Make sure the reflective floor renders properly
    this.scene
      .find("**/underground")
      ?.setAttrib(CullBinAttrib.create("ground", -10));

    // Setup lobby elevator (CJ elevator)
    await this.setupLobbyElevator();
  }

  /**
   * Loads the Lawbot DA's Office Lobby.
   * Zone ID: 13200
   */
  private async loadLawbotOfficeExt(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_11/models/lawbotHQ/LB_DA_Lobby",
    );
    geom.cloneTo(this.scene);

    // Make sure the reflective floor renders properly
    this.scene
      .find("**/underground")
      ?.setAttrib(CullBinAttrib.create("ground", -10));

    // Setup office elevators (4 elevators)
    await this.setupOfficeElevators();
  }

  /**
   * Sets up the CJ (Chief Justice) elevator in the Courthouse Lobby.
   */
  private async setupLobbyElevator(): Promise<void> {
    const elevatorModel = await this.loader.loadModel(
      "phase_11/models/lawbotHQ/LB_Elevator",
    );

    const elevator = elevatorModel.cloneTo(this.scene);

    // Position elevator using the locator node
    const locator = this.scene.find("**/elevator_locator");
    if (locator) {
      elevator.reparentTo(locator);
      elevator.transform = TransformState.makeIdentity();
    } else {
      console.warn("LawbotCogHQLoader: Could not find elevator_locator");
    }
  }

  /**
   * Sets up the four DA's Office elevators.
   */
  private async setupOfficeElevators(): Promise<void> {
    const elevatorModel = await this.loader.loadModel(
      "phase_10/models/cogHQ/mintElevator",
    );

    const font = await this.loader.loadFont(SUIT_FONT_PATH);

    for (let entranceId = 0; entranceId < 4; entranceId++) {
      // Find the locator for this elevator
      const locator = this.scene.find(`**/elevator_origin_${entranceId}`);
      if (!locator) {
        console.warn(
          `LawbotCogHQLoader: Could not find elevator_origin_${entranceId}`,
        );
        continue;
      }

      // Clone and position elevator
      const elevator = elevatorModel.cloneTo(this.scene);
      elevator.reparentTo(locator);
      elevator.transform = TransformState.makeIdentity();

      // Setup sign text
      const signLocator = this.scene.find(
        `**/elevator_signorigin_${entranceId}`,
      );
      const backgroundGeom = this.scene.find(
        `**/ElevatorFrameFront_${entranceId}`,
      );

      if (backgroundGeom) {
        backgroundGeom.setEffect(new DecalEffect());

        // Create sign text
        const textNode = new TextNode(`OfficeSign_${entranceId}`);
        textNode.font = font;
        textNode.text = OFFICE_NAMES[entranceId].toUpperCase();
        textNode.textColor = vec4.fromValues(0.87, 0.87, 0.87, 1);
        textNode.align = TextAlignment.Center;

        const textGeom = textNode.generate();
        textGeom.reparentTo(backgroundGeom);
        textGeom.setDepthWrite(false);

        if (signLocator) {
          textGeom.transform = signLocator
            .getTransform(backgroundGeom)
            .compose(
              TransformState.fromPosHprScale(
                null,
                null,
                vec3.fromValues(2, 2, 2),
              ),
            );
        } else {
          textGeom.transform = TransformState.fromPosHprScale(
            null,
            null,
            vec3.fromValues(2, 2, 2),
          );
        }
      }
    }
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    const baseZone = this.zoneId - (this.zoneId % 100);
    if (baseZone === ZONE_ID_LAWBOT_HQ) {
      return DROP_POINTS;
    }
    return []; // TODO
  }
}

const DROP_POINTS: readonly [ReadonlyVec3, number][] = [
  [vec3.fromValues(77.5, 129.13, -68.4), -166.6],
  [vec3.fromValues(-57.7, 80.75, -68.4), -139.2],
  [vec3.fromValues(203.3, 46.36, -68.4), -213.37],
  [vec3.fromValues(88.2, -336.52, -68.4), -720.4],
  [vec3.fromValues(232.77, -305.33, -68.4), -651],
  [vec3.fromValues(-20.16, -345.76, -68.4), -777.98],
];
