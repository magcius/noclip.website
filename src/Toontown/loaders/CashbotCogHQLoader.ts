import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import {
  SUIT_FONT_PATH,
  ZONE_ID_CASHBOT_HQ,
  ZONE_ID_CASHBOT_LOBBY,
} from "../Globals";
import type { ToontownLoader } from "../Loader";
import { DecalEffect, type PandaNode, TransformState } from "../nodes";
import { Train } from "../objects/Train";
import { TextAlignment } from "../text";
import { TextNode } from "../text/TextNode";
import { BaseLoader } from "./BaseLoader";

const TRACK_Z = -67;
const TRAIN_TRACKS: {
  start: ReadonlyVec3;
  end: ReadonlyVec3;
}[] = [
  {
    start: vec3.fromValues(-1000, -54.45, TRACK_Z),
    end: vec3.fromValues(2200, -54.45, TRACK_Z),
  },
  {
    start: vec3.fromValues(1800, -133.45, TRACK_Z),
    end: vec3.fromValues(-1200, -133.45, TRACK_Z),
  },
  {
    start: vec3.fromValues(-1000, -212.45, TRACK_Z),
    end: vec3.fromValues(2200, -212.45, TRACK_Z),
  },
  {
    start: vec3.fromValues(1800, -291.45, TRACK_Z),
    end: vec3.fromValues(-1200, -291.45, TRACK_Z),
  },
];

const MINT_NAMES = ["Coin Mint", "Dollar Mint", "Bullion Mint"];

/**
 * Cashbot HQ
 */
export class CashbotCogHQLoader extends BaseLoader {
  private trains: Train[] = [];

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
    if (baseZone === ZONE_ID_CASHBOT_LOBBY) {
      return "phase_9/audio/bgm/CHQ_FACT_bg.mid";
    }
    return "phase_9/audio/bgm/encntr_suit_HQ_nbrhood.mid";
  }

  override async load(): Promise<void> {
    await this.loadPlaceGeom();
    await super.load();
  }

  override enter(): void {
    super.enter();
    for (const train of this.trains) {
      train.enter();
    }
  }

  override exit(): void {
    super.exit();
    for (const train of this.trains) {
      train.exit();
    }
  }

  private async loadPlaceGeom(): Promise<void> {
    const baseZone = this.zoneId - (this.zoneId % 100);
    if (baseZone === ZONE_ID_CASHBOT_HQ) {
      await this.loadCashbotHQExterior();
    } else if (baseZone === ZONE_ID_CASHBOT_LOBBY) {
      await this.loadCashbotHQLobby();
    } else {
      console.warn(`CashbotCogHQLoader: unclassified zone ${this.zoneId}`);
    }
  }

  /**
   * Loads the Cashbot HQ Exterior (Train Yard / Shipping Station).
   * Zone ID: 12000
   */
  private async loadCashbotHQExterior(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_10/models/cogHQ/CashBotShippingStation",
    );
    geom.cloneTo(this.scene);

    // Setup mint elevators
    await this.setupMintElevators();

    // Setup trains
    await this.setupTrains();
  }

  /**
   * Sets up the three mint elevators.
   */
  private async setupMintElevators(): Promise<void> {
    const elevatorModel = await this.loader.loadModel(
      "phase_10/models/cogHQ/mintElevator",
    );

    const font = await this.loader.loadFont(SUIT_FONT_PATH);

    // CashbotMintIntA -> 1, CashbotMintIntB -> 2, CashbotMintIntC -> 0
    const originIds = [1, 2, 0];

    for (let i = 0; i < 3; i++) {
      const originId = originIds[i];

      // Find the elevator locator
      const locator = this.scene.find(`**/elevator_origin_${originId}`);
      if (!locator) {
        console.warn(
          `CashbotCogHQLoader: Could not find elevator_origin_${originId}`,
        );
        continue;
      }

      // Clone and position elevator
      const elevator = elevatorModel.cloneTo(this.scene);
      elevator.reparentTo(locator);
      elevator.transform = TransformState.makeIdentity();

      // Setup sign text
      const signLocator = this.scene.find(`**/elevator_signorigin_${originId}`);
      const backgroundGeom = this.scene.find(
        `**/ElevatorFrameFront_${originId}`,
      );

      if (backgroundGeom) {
        backgroundGeom.setEffect(new DecalEffect());

        // Create sign text
        const textNode = new TextNode(`MintSign_${originId}`);
        textNode.font = font;
        textNode.text = MINT_NAMES[i].toUpperCase();
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

  /**
   * Sets up the animated trains.
   */
  private async setupTrains(): Promise<void> {
    for (let i = 0; i < TRAIN_TRACKS.length; i++) {
      const track = TRAIN_TRACKS[i];
      const train = new Train(
        this.scene,
        track.start,
        track.end,
        i,
        TRAIN_TRACKS.length,
      );
      await train.init(this.loader);
      this.trains.push(train);
    }
  }

  /**
   * Loads the Cashbot HQ Lobby (Vault Lobby).
   * Zone ID: 12100
   */
  private async loadCashbotHQLobby(): Promise<void> {
    const geom = await this.loader.loadModel(
      "phase_10/models/cogHQ/VaultLobby",
    );
    geom.cloneTo(this.scene);

    // Setup CFO elevator
    await this.setupLobbyElevator();
  }

  /**
   * Sets up the CFO elevator in the Cashbot HQ Lobby.
   */
  private async setupLobbyElevator(): Promise<void> {
    const elevatorModel = await this.loader.loadModel(
      "phase_10/models/cogHQ/CFOElevator",
    );

    const elevator = elevatorModel.cloneTo(this.scene);

    // Position elevator using the locator node in the lobby geometry
    const locator = this.scene.find("**/elevator_locator");
    if (locator) {
      elevator.reparentTo(locator);
    } else {
      console.warn("CashbotCogHQLoader: Could not find elevator_locator");
    }
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    const baseZone = this.zoneId - (this.zoneId % 100);
    if (baseZone === ZONE_ID_CASHBOT_HQ) {
      return DROP_POINTS;
    }
    return [];
  }
}

const DROP_POINTS: readonly [ReadonlyVec3, number][] = [
  [vec3.fromValues(102, -437, -23.439), 0],
  [vec3.fromValues(124, -437, -23.439), 0],
  [vec3.fromValues(110, -446, -23.439), 0],
  [vec3.fromValues(132, -446, -23.439), 0],
];
