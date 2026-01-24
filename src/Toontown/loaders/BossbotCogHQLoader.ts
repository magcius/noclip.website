import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import {
  SUIT_FONT_PATH,
  ZONE_ID_BOSSBOT_HQ,
  ZONE_ID_BOSSBOT_LOBBY,
} from "../Globals";
import type { ToontownLoader } from "../Loader";
import { DecalEffect, type PandaNode, TransformState } from "../nodes";
import { TextAlignment } from "../text";
import { TextNode } from "../text/TextNode";
import { BaseLoader } from "./BaseLoader";

// Sign configuration from BossbotCogHQLoader.makeSigns()
// Maps topStr, signStr to the text to display
const SIGN_CONFIG: {
  topStr: string;
  signStr: string;
  text: string;
}[] = [
  { topStr: "Gate_2", signStr: "Sign_6", text: "THE BACK NINE" },
  { topStr: "TunnelEntrance", signStr: "Sign_2", text: "CHIP 'N DALE'S" },
  { topStr: "Gate_3", signStr: "Sign_3", text: "THE MIDDLE SIX" },
  { topStr: "Gate_4", signStr: "Sign_4", text: "THE FRONT THREE" },
  { topStr: "GateHouse", signStr: "Sign_5", text: "THE CLUBHOUSE" },
];

// Cog kart positions from BossbotHQDataAI.createCogKarts()
const KART_POSITIONS: { pos: ReadonlyVec3; hpr: ReadonlyVec3 }[] = [
  {
    pos: vec3.fromValues(154.762, 37.169, 0),
    hpr: vec3.fromValues(110.815, 0, 0),
  },
  {
    pos: vec3.fromValues(141.403, -81.887, 0),
    hpr: vec3.fromValues(61.231, 0, 0),
  },
  {
    pos: vec3.fromValues(-48.44, 15.308, 0),
    hpr: vec3.fromValues(-105.481, 0, 0),
  },
];

const SIGN_SCALE = 1.12;

/**
 * Bossbot Cog HQ Loader.
 * Handles loading for BossbotHQ (Golf Hub) and BossbotLobby (Clubhouse/Courtyard).
 */
export class BossbotCogHQLoader extends BaseLoader {
  constructor(
    scene: PandaNode,
    loader: ToontownLoader,
    private zoneId: number,
  ) {
    super(scene, loader);
    // Cog HQs don't use DNA storage files
    this.storageDNAFiles = [];
    this.dnaFile = null;
    this.skyFile = "phase_9/models/cogHQ/cog_sky";
    this.musicFile = this.getMusicFile();
  }

  private getMusicFile(): string {
    // Random music file selection from original code
    const musicFiles = [
      "phase_12/audio/bgm/Bossbot_Entry_v1.mid",
      "phase_12/audio/bgm/Bossbot_Entry_v2.mid",
      "phase_12/audio/bgm/Bossbot_Entry_v3.mid",
    ];
    return musicFiles[Math.floor(Math.random() * musicFiles.length)];
  }

  override async load(): Promise<void> {
    await this.loadPlaceGeom();
    await super.load();
  }

  private async loadPlaceGeom(): Promise<void> {
    const baseZone = this.zoneId - (this.zoneId % 100);

    if (baseZone === ZONE_ID_BOSSBOT_HQ) {
      await this.loadBossbotHQ();
    } else if (baseZone === ZONE_ID_BOSSBOT_LOBBY) {
      await this.loadBossbotLobby();
    } else {
      console.warn(`BossbotCogHQLoader: unclassified zone ${this.zoneId}`);
    }
  }

  /**
   * Loads the Bossbot HQ (Golf Hub / Courtyard).
   * Zone ID: 10000
   */
  private async loadBossbotHQ(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_12/models/bossbotHQ/CogGolfHub",
    );
    geom.cloneTo(this.scene);

    // Rename the link tunnel so it hooks up properly
    const gzLinkTunnel = this.scene.find("**/LinkTunnel1");
    if (gzLinkTunnel) {
      gzLinkTunnel.name = "linktunnel_gz_17000_DNARoot";
    }

    // Fix tunnel_origin heading (HACK from original code)
    const tunnelEntrance = this.scene.find("**/TunnelEntrance");
    if (tunnelEntrance) {
      const origin = tunnelEntrance.find("**/tunnel_origin");
      if (origin) {
        origin.hpr = vec3.fromValues(-33.33, 0, 0);
      }
    }

    // Setup signs
    await this.makeSigns();

    // Setup cog karts
    await this.setupCogKarts();
  }

  /**
   * Creates the sign text on gates and tunnels.
   * Mirrors BossbotCogHQLoader.makeSigns()
   */
  private async makeSigns(): Promise<void> {
    const font = await this.loader.loadFont(SUIT_FONT_PATH);

    for (const config of SIGN_CONFIG) {
      const top = this.scene.find(`**/${config.topStr}`);
      if (!top) {
        console.warn(`BossbotCogHQLoader: Could not find ${config.topStr}`);
        continue;
      }

      const sign = top.find(`**/${config.signStr}/+GeomNode`);
      if (!sign) {
        console.warn(`BossbotCogHQLoader: Could not find ${config.signStr}`);
        continue;
      }

      const locator = top.find("**/sign_origin");
      if (!locator) {
        console.warn(`BossbotCogHQLoader: Could not find sign_origin`);
        continue;
      }

      // Enable decal effect on sign
      sign.setEffect(new DecalEffect());

      // Create text
      const textNode = new TextNode(`${config.topStr}_sign`);
      textNode.font = font;
      textNode.text = config.text;
      textNode.textColor = vec4.fromValues(0, 0, 0, 1);
      textNode.align = TextAlignment.Center;

      const textGeom = textNode.generate();
      textGeom.reparentTo(sign);
      textGeom.setDepthWrite(false);

      textGeom.transform = locator
        .getTransform(sign)
        .compose(
          TransformState.fromPosHprScale(
            vec3.fromValues(0, -0.1, -0.25),
            vec3.fromValues(0, 0, 0),
            vec3.fromValues(SIGN_SCALE, SIGN_SCALE, SIGN_SCALE),
          ),
        );
    }
  }

  /**
   * Sets up the cog golf karts.
   * Mirrors BossbotHQDataAI.createCogKarts() and DistributedCogKart
   */
  private async setupCogKarts(): Promise<void> {
    const kartModel = await this.loader.loadModel(
      "phase_12/models/bossbotHQ/Coggolf_cart3",
    );

    for (let i = 0; i < KART_POSITIONS.length; i++) {
      const { pos, hpr } = KART_POSITIONS[i];

      const kart = kartModel.cloneTo(this.scene);
      kart.name = `cogKart_${i}`;
      kart.transform = TransformState.fromPosHprScale(
        vec3.fromValues(pos[0], pos[1], pos[2]),
        vec3.fromValues(hpr[0], hpr[1], hpr[2]),
        vec3.fromValues(1, 1, 1),
      );
    }
  }

  /**
   * Loads the Bossbot Lobby (Clubhouse / Golf Courtyard).
   * Zone ID: 10100
   */
  private async loadBossbotLobby(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_12/models/bossbotHQ/CogGolfCourtyard",
    );
    geom.cloneTo(this.scene);

    // Setup CEO elevator
    await this.setupLobbyElevator();
  }

  /**
   * Sets up the CEO elevator in the Bossbot Lobby.
   * Mirrors DistributedBBElevator.setupElevator()
   */
  private async setupLobbyElevator(): Promise<void> {
    const elevatorModel = await this.loader.loadModel(
      "phase_12/models/bossbotHQ/BB_Elevator",
    );

    const elevator = elevatorModel.cloneTo(this.scene);

    // Position elevator using the locator node
    const locator = this.scene.find("**/elevator_locator");
    if (locator) {
      elevator.reparentTo(locator);
      elevator.transform = TransformState.makeIdentity();
    } else {
      console.warn("BossbotCogHQLoader: Could not find elevator_locator");
    }
  }
}
