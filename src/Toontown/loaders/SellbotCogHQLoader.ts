import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import {
  SUIT_FONT_PATH,
  ZONE_ID_SELLBOT_FACTORY_EXT,
  ZONE_ID_SELLBOT_HQ,
  ZONE_ID_SELLBOT_LOBBY,
} from "../Globals";
import type { ToontownLoader } from "../Loader";
import { DecalEffect, type PandaNode, TransformState } from "../nodes";
import { TextAlignment } from "../text";
import { TextNode } from "../text/TextNode";
import { BaseLoader } from "./BaseLoader";

const ASPECT_SF = 0.7227;
const COG_SIGN_SF = 23;
const ELEVATOR_SIGN_SF = 15;

/**
 * Sellbot HQ
 */
export class SellbotCogHQLoader extends BaseLoader {
  private cogSignModel: PandaNode | null = null;

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
    if (baseZone === ZONE_ID_SELLBOT_LOBBY) {
      return "phase_9/audio/bgm/CHQ_FACT_bg.mid";
    }
    return "phase_9/audio/bgm/encntr_suit_HQ_nbrhood.mid";
  }

  override async load(): Promise<void> {
    // Load the cog sign model (shared between zones)
    this.cogSignModel = await this.loader.loadModel(
      "phase_4/models/props/sign_sellBotHeadHQ",
    );
    await this.loadPlaceGeom();
    await super.load();
  }

  private async loadPlaceGeom(): Promise<void> {
    const baseZone = this.zoneId - (this.zoneId % 100);
    if (baseZone === ZONE_ID_SELLBOT_HQ) {
      await this.loadSellbotHQExterior();
    } else if (baseZone === ZONE_ID_SELLBOT_FACTORY_EXT) {
      await this.loadSellbotFactoryExterior();
    } else if (baseZone === ZONE_ID_SELLBOT_LOBBY) {
      await this.loadSellbotHQLobby();
    } else {
      console.warn(`SellbotCogHQLoader: unclassified zone ${this.zoneId}`);
    }
  }

  /**
   * Loads the Sellbot HQ Exterior (Courtyard).
   * Zone ID: 11000
   */
  private async loadSellbotHQExterior(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_9/models/cogHQ/SellbotHQExterior",
    );
    geom.cloneTo(this.scene);

    // Rename the link tunnels so they will hook up properly
    const dgLinkTunnel = this.scene.find("**/Tunnel1");
    if (dgLinkTunnel) {
      dgLinkTunnel.name = "linktunnel_dg_5316_DNARoot";
    }

    const factoryLinkTunnel = this.scene.find("**/Tunnel2");
    if (factoryLinkTunnel) {
      factoryLinkTunnel.name = "linktunnel_sellhq_11200_DNARoot";
    }

    // Setup signs on link tunnels
    await this.setupDaisyGardensSign(dgLinkTunnel);
    await this.setupFactorySign(factoryLinkTunnel);

    // Setup door decals
    this.setupExteriorDoors();
  }

  /**
   * Sets up the "Daisy Gardens" sign on the tunnel to DG.
   */
  private async setupDaisyGardensSign(
    dgLinkTunnel: PandaNode | null,
  ): Promise<void> {
    if (!dgLinkTunnel || !this.cogSignModel) return;

    const cogSign = this.cogSignModel.find("**/sign_sellBotHeadHQ");
    if (!cogSign) return;

    const dgSign = cogSign.cloneTo(dgLinkTunnel);
    dgSign.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0.0, -291.5, 29),
      vec3.fromValues(180.0, 0.0, 0.0),
      vec3.fromValues(COG_SIGN_SF, COG_SIGN_SF, COG_SIGN_SF * ASPECT_SF),
    );
    dgSign.setEffect(new DecalEffect());

    // Create text
    const textNode = new TextNode("DaisyGardensSign");
    textNode.font = await this.loader.loadFont(SUIT_FONT_PATH);
    textNode.text = "DAISY GARDENS";
    textNode.textColor = vec4.fromValues(0, 0, 0, 1);
    textNode.align = TextAlignment.Center;

    const textGeom = textNode.generate();
    textGeom.reparentTo(dgSign);
    textGeom.setDepthWrite(false);
    textGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.3),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.1, 0.1, 0.1),
    );
  }

  /**
   * Sets up the "Sellbot Factory" sign on the tunnel to the factory exterior.
   */
  private async setupFactorySign(
    factoryLinkTunnel: PandaNode | null,
  ): Promise<void> {
    if (!factoryLinkTunnel || !this.cogSignModel) return;

    const cogSign = this.cogSignModel.find("**/sign_sellBotHeadHQ");
    if (!cogSign) return;

    const factorySign = cogSign.cloneTo(factoryLinkTunnel);
    factorySign.transform = TransformState.fromPosHprScale(
      vec3.fromValues(148.625, -155, 27),
      vec3.fromValues(-90.0, 0.0, 0.0),
      vec3.fromValues(COG_SIGN_SF, COG_SIGN_SF, COG_SIGN_SF * ASPECT_SF),
    );
    factorySign.setEffect(new DecalEffect());

    const font = await this.loader.loadFont(SUIT_FONT_PATH);

    // "SELLBOT" text
    const typeTextNode = new TextNode("SellbotText");
    typeTextNode.font = font;
    typeTextNode.text = "SELLBOT";
    typeTextNode.textColor = vec4.fromValues(0, 0, 0, 1);
    typeTextNode.align = TextAlignment.Center;

    const typeTextGeom = typeTextNode.generate();
    typeTextGeom.reparentTo(factorySign);
    typeTextGeom.setDepthWrite(false);
    typeTextGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.25),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.075, 0.075, 0.075),
    );

    // "FACTORY" text
    const factoryTextNode = new TextNode("FactoryText");
    factoryTextNode.font = font;
    factoryTextNode.text = "FACTORY";
    factoryTextNode.textColor = vec4.fromValues(0, 0, 0, 1);
    factoryTextNode.align = TextAlignment.Center;

    const factoryTextGeom = factoryTextNode.generate();
    factoryTextGeom.reparentTo(factorySign);
    factoryTextGeom.setDepthWrite(false);
    factoryTextGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.34),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.12, 0.12, 0.12),
    );
  }

  /**
   * Sets up decal effects on the exterior doors.
   */
  private setupExteriorDoors(): void {
    const doors = this.scene.find("**/doors");
    if (!doors) return;

    for (let i = 0; i < 4; i++) {
      const door = doors.find(`**/door_${i}`);
      if (!door) continue;

      const doorFrame = door.find("**/doorDoubleFlat/+GeomNode");
      if (doorFrame) {
        const holeLeft = door.find("**/doorFrameHoleLeft");
        const holeRight = door.find("**/doorFrameHoleRight");
        holeLeft?.wrtReparentTo(doorFrame);
        holeRight?.wrtReparentTo(doorFrame);
        doorFrame.setEffect(new DecalEffect());
      }
    }
  }

  /**
   * Loads the Sellbot Factory Exterior.
   * Zone ID: 11200
   */
  private async loadSellbotFactoryExterior(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_9/models/cogHQ/SellbotFactoryExterior",
    );
    geom.cloneTo(this.scene);

    // Rename and setup the link tunnel back to HQ
    const factoryLinkTunnel = this.scene.find("**/tunnel_group2");
    if (factoryLinkTunnel) {
      factoryLinkTunnel.name = "linktunnel_sellhq_11000_DNARoot";
      const sphere = factoryLinkTunnel.find("**/tunnel_sphere");
      if (sphere) {
        sphere.name = "tunnel_trigger";
      }
    }

    // Setup signs
    await this.setupHQSign(factoryLinkTunnel);
    await this.setupFrontEntranceSign();
    await this.setupSideEntranceSign();

    // Setup factory elevators
    await this.setupFactoryElevators();
  }

  /**
   * Sets up the two factory exterior elevators.
   */
  private async setupFactoryElevators(): Promise<void> {
    const elevatorModel = await this.loader.loadModel(
      "phase_4/models/modules/elevator",
    );

    const elevatorPositions: {
      pos: [number, number, number];
      hpr: [number, number, number];
    }[] = [
      // Entrance 0: Front of the factory (south entrance)
      { pos: [62.74, -85.31, 0.0], hpr: [2.0, 0.0, 0.0] },
      // Entrance 1: Side of the factory (west entrance)
      { pos: [-162.25, 26.43, 0.0], hpr: [269.0, 0.0, 0.0] },
    ];

    for (const { pos, hpr } of elevatorPositions) {
      const elevator = elevatorModel.cloneTo(this.scene);
      elevator.transform = TransformState.fromPosHprScale(
        vec3.fromValues(pos[0], pos[1], pos[2]),
        vec3.fromValues(hpr[0], hpr[1], hpr[2]),
        vec3.fromValues(1.05, 1.05, 1.05),
      );

      // Remove light panels
      elevator.find("**/light_panel")?.removeNode();
      elevator.find("**/light_panel_frame")?.removeNode();
    }
  }

  /**
   * Sets up the "Sellbot Headquarters" sign on the tunnel back to HQ.
   */
  private async setupHQSign(
    factoryLinkTunnel: PandaNode | null,
  ): Promise<void> {
    if (!factoryLinkTunnel || !this.cogSignModel) return;

    const cogSign = this.cogSignModel.find("**/sign_sellBotHeadHQ");
    if (!cogSign) return;

    const hqSign = cogSign.cloneTo(factoryLinkTunnel);
    hqSign.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0.0, -353, 27.5),
      vec3.fromValues(-180.0, 0.0, 0.0),
      vec3.fromValues(COG_SIGN_SF, COG_SIGN_SF, COG_SIGN_SF * ASPECT_SF),
    );
    hqSign.setEffect(new DecalEffect());

    const font = await this.loader.loadFont(SUIT_FONT_PATH);

    // "SELLBOT" text
    const typeTextNode = new TextNode("SellbotText");
    typeTextNode.font = font;
    typeTextNode.text = "SELLBOT";
    typeTextNode.textColor = vec4.fromValues(0, 0, 0, 1);
    typeTextNode.align = TextAlignment.Center;

    const typeTextGeom = typeTextNode.generate();
    typeTextGeom.reparentTo(hqSign);
    typeTextGeom.setDepthWrite(false);
    typeTextGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.25),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.075, 0.075, 0.075),
    );

    // "HEADQUARTERS" text
    const hqTextNode = new TextNode("HeadquartersText");
    hqTextNode.font = font;
    hqTextNode.text = "HEADQUARTERS";
    hqTextNode.textColor = vec4.fromValues(0, 0, 0, 1);
    hqTextNode.align = TextAlignment.Center;

    const hqTextGeom = hqTextNode.generate();
    hqTextGeom.reparentTo(hqSign);
    hqTextGeom.setDepthWrite(false);
    hqTextGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.34),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.1, 0.1, 0.1),
    );
  }

  /**
   * Sets up the "Factory - Front Entrance" sign.
   */
  private async setupFrontEntranceSign(): Promise<void> {
    if (!this.cogSignModel) return;

    const frontDoor = this.scene.find("**/doorway1");
    if (!frontDoor) return;

    const cogSign = this.cogSignModel.find("**/sign_sellBotHeadHQ");
    if (!cogSign) return;

    const fdSign = cogSign.cloneTo(frontDoor);
    fdSign.transform = TransformState.fromPosHprScale(
      vec3.fromValues(62.74, -87.99, 17.26),
      vec3.fromValues(2.72, 0.0, 0.0),
      vec3.fromValues(
        ELEVATOR_SIGN_SF,
        ELEVATOR_SIGN_SF,
        ELEVATOR_SIGN_SF * ASPECT_SF,
      ),
    );
    fdSign.setEffect(new DecalEffect());

    const font = await this.loader.loadFont(SUIT_FONT_PATH);

    // "FACTORY" text
    const typeTextNode = new TextNode("FactoryText");
    typeTextNode.font = font;
    typeTextNode.text = "FACTORY";
    typeTextNode.textColor = vec4.fromValues(0, 0, 0, 1);
    typeTextNode.align = TextAlignment.Center;

    const typeTextGeom = typeTextNode.generate();
    typeTextGeom.reparentTo(fdSign);
    typeTextGeom.setDepthWrite(false);
    typeTextGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.25),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.1, 0.1, 0.1),
    );

    // "Front Entrance" text
    const entranceTextNode = new TextNode("FrontEntranceText");
    entranceTextNode.font = font;
    entranceTextNode.text = "Front Entrance";
    entranceTextNode.textColor = vec4.fromValues(0, 0, 0, 1);
    entranceTextNode.align = TextAlignment.Center;

    const entranceTextGeom = entranceTextNode.generate();
    entranceTextGeom.reparentTo(fdSign);
    entranceTextGeom.setDepthWrite(false);
    entranceTextGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.34),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.1, 0.1, 0.1),
    );
  }

  /**
   * Sets up the "Factory - Side Entrance" sign.
   */
  private async setupSideEntranceSign(): Promise<void> {
    if (!this.cogSignModel) return;

    const sideDoor = this.scene.find("**/doorway2");
    if (!sideDoor) return;

    const cogSign = this.cogSignModel.find("**/sign_sellBotHeadHQ");
    if (!cogSign) return;

    const sdSign = cogSign.cloneTo(sideDoor);
    sdSign.transform = TransformState.fromPosHprScale(
      vec3.fromValues(-164.78, 26.28, 17.25),
      vec3.fromValues(-89.89, 0.0, 0.0),
      vec3.fromValues(
        ELEVATOR_SIGN_SF,
        ELEVATOR_SIGN_SF,
        ELEVATOR_SIGN_SF * ASPECT_SF,
      ),
    );
    sdSign.setEffect(new DecalEffect());

    const font = await this.loader.loadFont(SUIT_FONT_PATH);

    // "FACTORY" text
    const typeTextNode = new TextNode("FactoryText");
    typeTextNode.font = font;
    typeTextNode.text = "FACTORY";
    typeTextNode.textColor = vec4.fromValues(0, 0, 0, 1);
    typeTextNode.align = TextAlignment.Center;

    const typeTextGeom = typeTextNode.generate();
    typeTextGeom.reparentTo(sdSign);
    typeTextGeom.setDepthWrite(false);
    typeTextGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.25),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.075, 0.075, 0.075),
    );

    // "Side Entrance" text
    const entranceTextNode = new TextNode("SideEntranceText");
    entranceTextNode.font = font;
    entranceTextNode.text = "Side Entrance";
    entranceTextNode.textColor = vec4.fromValues(0, 0, 0, 1);
    entranceTextNode.align = TextAlignment.Center;

    const entranceTextGeom = entranceTextNode.generate();
    entranceTextGeom.reparentTo(sdSign);
    entranceTextGeom.setDepthWrite(false);
    entranceTextGeom.transform = TransformState.fromPosHprScale(
      vec3.fromValues(0, 0, -0.34),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0.1, 0.1, 0.1),
    );
  }

  /**
   * Loads the Sellbot HQ Lobby.
   * Zone ID: 11100
   */
  private async loadSellbotHQLobby(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_9/models/cogHQ/SellbotHQLobby",
    );
    geom.cloneTo(this.scene);

    // Setup decal effects on front wall and door
    const front = this.scene.find("**/frontWall");
    if (front) {
      front.setEffect(new DecalEffect());

      const door = this.scene.find("**/door_0");
      if (door) {
        const parent = door.parent;

        // Reparent door to front wall for decal rendering
        door.wrtReparentTo(front);

        const doorFrame = door.find("**/doorDoubleFlat/+GeomNode");
        if (doorFrame) {
          const holeLeft = door.find("**/doorFrameHoleLeft");
          const holeRight = door.find("**/doorFrameHoleRight");
          holeLeft?.wrtReparentTo(doorFrame);
          holeRight?.wrtReparentTo(doorFrame);
          doorFrame.setEffect(new DecalEffect());
        }

        // Reparent the door panels back to original parent
        if (parent) {
          door.find("**/leftDoor")?.wrtReparentTo(parent);
          door.find("**/rightDoor")?.wrtReparentTo(parent);
        }
      }
    }

    // Setup lobby elevator
    await this.setupLobbyElevator();
  }

  /**
   * Sets up the boss elevator in the Sellbot HQ Lobby.
   */
  private async setupLobbyElevator(): Promise<void> {
    const elevatorModel = await this.loader.loadModel(
      "phase_9/models/cogHQ/cogHQ_elevator",
    );

    const elevator = elevatorModel.cloneTo(this.scene);

    // Hide the big cog icon (only visible in boss room)
    elevator.find("**/big_frame")?.hide();

    // Position elevator using the locator node in the lobby geometry
    const locator = this.scene.find("**/elevator_locator");
    if (locator) {
      elevator.reparentTo(locator);
      elevator.setH(180);
    } else {
      console.warn("SellbotCogHQLoader: Could not find elevator_locator");
    }
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    const baseZone = this.zoneId - (this.zoneId % 100);
    if (baseZone === ZONE_ID_SELLBOT_HQ) {
      return DROP_POINTS;
    }
    return [];
  }
}

const DROP_POINTS: readonly [ReadonlyVec3, number][] = [
  [vec3.fromValues(64, -128, 0.26), 36],
  [vec3.fromValues(9, -140, 0.26), 0],
  [vec3.fromValues(-82, -112, 0.26), -127],
  [vec3.fromValues(-73, -213, 0.26), -23],
  [vec3.fromValues(-20, -243, 0.26), -9],
  [vec3.fromValues(79, -208, 0.26), 43],
];
